import { bad, str, int, num, bool, nowIso, round2, localDate } from '../util.js';
import { CATEGORY, stockToSale, UNITS, parseFeet } from '../calc.js';
import { must, updateFields, MANAGERS, EVERYONE } from './shared.js';

const PRODUCT_FIELDS = {
  sku: (v) => str(v, 60),
  category: (v) => (CATEGORY[v] ? v : 'sundry'),
  vendor_id: (v) => int(v),
  manufacturer: (v) => str(v, 80),
  style: (v) => str(v, 120),
  color: (v) => str(v, 80),
  description: (v) => str(v, 1000),
  unit: (v) => (UNITS.includes(v) ? v : 'EA'),
  stock_type: (v) => (['roll', 'box', 'unit', 'none'].includes(v) ? v : 'none'),
  roll_width_ft: (v) => { const f = parseFeet(v); return f > 0 ? f : null; },
  coverage_per_box: (v) => (num(v, 0) > 0 ? num(v) : null),
  cost: (v) => Math.max(0, num(v)),
  price: (v) => Math.max(0, num(v)),
  taxable: bool,
  reorder_point: (v) => (v === '' || v === null || v === undefined ? null : num(v)),
  active: bool,
};

export function onHandByProduct(db, productIds = null) {
  const rows = db.all(
    `SELECT i.product_id, i.qty, i.width_ft, i.unit_cost, i.is_remnant, p.stock_type, p.unit, p.roll_width_ft, p.coverage_per_box
       FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.qty > 0.0001`);
  const out = {};
  for (const r of rows) {
    if (productIds && !productIds.has(r.product_id)) continue;
    const sale = stockToSale(r, r.qty, r.width_ft);
    const o = (out[r.product_id] ||= { on_hand: 0, stock_qty: 0, value: 0, pieces: 0, remnants: 0 });
    o.on_hand += sale;
    o.stock_qty += r.qty;
    o.value += sale * r.unit_cost;
    o.pieces += 1;
    if (r.is_remnant) o.remnants += 1;
  }
  for (const o of Object.values(out)) { o.on_hand = round2(o.on_hand); o.value = round2(o.value); o.stock_qty = round2(o.stock_qty); }
  return out;
}

function cleanProduct(data) {
  if (!data.style) bad('Enter a style or product name.');
  if (data.stock_type === 'roll' && !data.roll_width_ft) data.roll_width_ft = CATEGORY[data.category]?.width || 12;
  if (data.stock_type === 'box' && !data.coverage_per_box) bad('Enter the square feet per box.');
  return data;
}

export function register(r) {
  // ---------- products ----------
  r.get('/products', ({ db, query }) => {
    const conds = [];
    const params = [];
    if (query.active !== 'all') conds.push('p.active = 1');
    if (query.category) { conds.push('p.category = ?'); params.push(query.category); }
    if (query.vendor_id) { conds.push('p.vendor_id = ?'); params.push(int(query.vendor_id)); }
    if (query.stocked === '1') conds.push("p.stock_type != 'none'");
    for (const t of String(query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
      conds.push('(p.style LIKE ? OR p.color LIKE ? OR p.sku LIKE ? OR p.manufacturer LIKE ? OR p.description LIKE ?)');
      const like = `%${t}%`;
      params.push(like, like, like, like, like);
    }
    const rows = db.all(
      `SELECT p.*, v.name AS vendor_name FROM products p LEFT JOIN vendors v ON v.id = p.vendor_id
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
       ORDER BY p.category, p.manufacturer, p.style, p.color LIMIT ?`, ...params, Math.min(int(query.limit, 500), 2000));
    const stock = onHandByProduct(db);
    return rows.map((p) => ({ ...p, ...(stock[p.id] || { on_hand: 0, value: 0, pieces: 0, remnants: 0 }) }));
  });

  r.post('/products', ({ db, body }) => {
    const data = {};
    for (const [k, clean] of Object.entries(PRODUCT_FIELDS)) data[k] = clean(body[k]);
    if (body.active === undefined) data.active = 1;
    if (body.taxable === undefined) data.taxable = data.category === 'labor' || data.category === 'service' ? 0 : 1;
    cleanProduct(data);
    const now = nowIso();
    const keys = Object.keys(data);
    const id = db.run(
      `INSERT INTO products (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, ?, ?)`,
      ...keys.map((k) => data[k]), now, now).lastInsertRowid;
    return db.get('SELECT * FROM products WHERE id = ?', id);
  });

  r.get('/products/:id', ({ db, params }) => {
    const p = must(db.get('SELECT p.*, v.name AS vendor_name FROM products p LEFT JOIN vendors v ON v.id = p.vendor_id WHERE p.id = ?', params.id), 'Product');
    const items = db.all('SELECT * FROM inventory WHERE product_id = ? AND qty > 0.0001 ORDER BY is_remnant, received_at DESC, id DESC', p.id);
    const onOrder = db.all(
      `SELECT pl.*, po.number AS po_number, po.status AS po_status, po.expected_date FROM po_lines pl
         JOIN purchase_orders po ON po.id = pl.po_id
        WHERE pl.product_id = ? AND po.status IN ('draft','sent','partial') AND pl.received_qty < pl.qty`, p.id);
    const stock = onHandByProduct(db)[p.id] || { on_hand: 0, value: 0, pieces: 0, remnants: 0 };
    return { ...p, ...stock, items, on_order: onOrder };
  });

  const CATALOG_EDITORS = ['admin', 'manager', 'warehouse'];

  r.put('/products/:id', ({ db, params, body }) => {
    const before = must(db.get('SELECT * FROM products WHERE id = ?', params.id), 'Product');
    const merged = { ...before };
    for (const [k, clean] of Object.entries(PRODUCT_FIELDS)) if (k in body) merged[k] = clean(body[k]);
    cleanProduct(merged);
    const payload = {};
    for (const k of Object.keys(PRODUCT_FIELDS)) if (k in body || k === 'roll_width_ft') payload[k] = merged[k];
    const identity = Object.fromEntries(Object.keys(payload).map((k) => [k, (v) => v]));
    updateFields(db, 'products', params.id, payload, identity);
    return db.get('SELECT * FROM products WHERE id = ?', params.id);
  }, { roles: CATALOG_EDITORS });

  r.del('/products/:id', ({ db, params }) => {
    must(db.get('SELECT id FROM products WHERE id = ?', params.id), 'Product');
    const used = db.get(
      'SELECT (SELECT COUNT(*) FROM lines WHERE product_id = ?) + (SELECT COUNT(*) FROM inventory WHERE product_id = ?) + (SELECT COUNT(*) FROM po_lines WHERE product_id = ?) AS n',
      params.id, params.id, params.id).n;
    if (used) {
      db.run('UPDATE products SET active = 0, updated_at = ? WHERE id = ?', nowIso(), params.id);
      return { ok: true, archived: true };
    }
    db.run('DELETE FROM products WHERE id = ?', params.id);
    return { ok: true, deleted: true };
  }, { roles: CATALOG_EDITORS });

  // ---------- vendors ----------
  const VENDOR_FIELDS = {
    name: (v) => str(v, 120), contact: (v) => str(v, 80), phone: (v) => str(v, 40), email: (v) => str(v, 120),
    account_number: (v) => str(v, 60), address: (v) => str(v, 300), notes: (v) => str(v, 2000), active: bool,
  };

  r.get('/vendors', ({ db, query }) => db.all(
    `SELECT v.*,
       (SELECT COUNT(*) FROM products p WHERE p.vendor_id = v.id AND p.active = 1) AS product_count,
       (SELECT COUNT(*) FROM purchase_orders po WHERE po.vendor_id = v.id AND po.status IN ('draft','sent','partial')) AS open_pos
     FROM vendors v ${query.active === 'all' ? '' : 'WHERE v.active = 1'} ORDER BY v.name`));

  r.post('/vendors', ({ db, body }) => {
    const name = str(body.name, 120);
    if (!name) bad('Enter the vendor name.');
    const data = {};
    for (const [k, clean] of Object.entries(VENDOR_FIELDS)) data[k] = clean(body[k]);
    data.active = body.active === undefined ? 1 : data.active;
    const keys = Object.keys(data);
    const id = db.run(`INSERT INTO vendors (${keys.join(', ')}, created_at) VALUES (${keys.map(() => '?').join(', ')}, ?)`,
      ...keys.map((k) => data[k]), nowIso()).lastInsertRowid;
    return db.get('SELECT * FROM vendors WHERE id = ?', id);
  });

  r.get('/vendors/:id', ({ db, params }) => {
    const v = must(db.get('SELECT * FROM vendors WHERE id = ?', params.id), 'Vendor');
    const pos = db.all('SELECT id, number, status, total, created_at, expected_date FROM purchase_orders WHERE vendor_id = ? ORDER BY id DESC LIMIT 50', v.id);
    const products = db.all('SELECT id, category, manufacturer, style, color, price, unit FROM products WHERE vendor_id = ? AND active = 1 ORDER BY style LIMIT 200', v.id);
    return { ...v, pos, products };
  });

  r.put('/vendors/:id', ({ db, params, body }) => {
    must(db.get('SELECT id FROM vendors WHERE id = ?', params.id), 'Vendor');
    if ('name' in body && !str(body.name)) bad('Enter the vendor name.');
    updateFields(db, 'vendors', params.id, body, VENDOR_FIELDS);
    return db.get('SELECT * FROM vendors WHERE id = ?', params.id);
  });

  r.del('/vendors/:id', ({ db, params }) => {
    must(db.get('SELECT id FROM vendors WHERE id = ?', params.id), 'Vendor');
    const used = db.get('SELECT (SELECT COUNT(*) FROM products WHERE vendor_id = ?) + (SELECT COUNT(*) FROM purchase_orders WHERE vendor_id = ?) AS n', params.id, params.id).n;
    if (used) { db.run('UPDATE vendors SET active = 0 WHERE id = ?', params.id); return { ok: true, archived: true }; }
    db.run('DELETE FROM vendors WHERE id = ?', params.id);
    return { ok: true, deleted: true };
  }, { roles: MANAGERS });

  // ---------- installers ----------
  const INSTALLER_FIELDS = {
    name: (v) => str(v, 80), phone: (v) => str(v, 40), email: (v) => str(v, 120),
    color: (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null),
    specialties: (v) => str(v, 300), notes: (v) => str(v, 2000), active: bool,
  };

  r.get('/installers', ({ db, query }) => db.all(
    `SELECT i.*,
       (SELECT COUNT(*) FROM appointments a WHERE a.installer_id = i.id AND a.status NOT IN ('done','cancelled') AND a.date >= ?) AS upcoming
     FROM installers i ${query.active === 'all' ? '' : 'WHERE i.active = 1'} ORDER BY i.name`, localDate()), { roles: EVERYONE });

  r.post('/installers', ({ db, body }) => {
    const name = str(body.name, 80);
    if (!name) bad('Enter the installer or crew name.');
    const data = {};
    for (const [k, clean] of Object.entries(INSTALLER_FIELDS)) data[k] = clean(body[k]);
    data.active = body.active === undefined ? 1 : data.active;
    if (!data.color) {
      const palette = ['#2f6f9f', '#7a5195', '#3d8361', '#c46b1f', '#a23b5a', '#4c6a92', '#8a7a2a'];
      data.color = palette[db.get('SELECT COUNT(*) AS n FROM installers').n % palette.length];
    }
    const keys = Object.keys(data);
    const id = db.run(`INSERT INTO installers (${keys.join(', ')}, created_at) VALUES (${keys.map(() => '?').join(', ')}, ?)`,
      ...keys.map((k) => data[k]), nowIso()).lastInsertRowid;
    return db.get('SELECT * FROM installers WHERE id = ?', id);
  }, { roles: MANAGERS.concat('sales', 'warehouse') });

  r.put('/installers/:id', ({ db, params, body }) => {
    must(db.get('SELECT id FROM installers WHERE id = ?', params.id), 'Installer');
    if ('name' in body && !str(body.name)) bad('Enter the installer or crew name.');
    updateFields(db, 'installers', params.id, body, INSTALLER_FIELDS);
    return db.get('SELECT * FROM installers WHERE id = ?', params.id);
  });

  r.del('/installers/:id', ({ db, params }) => {
    must(db.get('SELECT id FROM installers WHERE id = ?', params.id), 'Installer');
    const used = db.get('SELECT COUNT(*) AS n FROM appointments WHERE installer_id = ?', params.id).n
      + db.get('SELECT COUNT(*) AS n FROM users WHERE installer_id = ?', params.id).n;
    if (used) { db.run('UPDATE installers SET active = 0 WHERE id = ?', params.id); return { ok: true, archived: true }; }
    db.run('DELETE FROM installers WHERE id = ?', params.id);
    return { ok: true, deleted: true };
  }, { roles: MANAGERS });
}
