import { bad, str, int, num, bool, nowIso, round2, round4, localDate } from '../util.js';
import { parseFeet, stockToSale, productName } from '../calc.js';
import { must, refreshMaterialStage, syncLineMaterial, getSettings } from './shared.js';
import { orderDetail } from './orders.js';

function withSale(row) {
  const sale = stockToSale(row, row.qty, row.width_ft);
  return { ...row, sale_qty: round2(sale), value: round2(sale * row.unit_cost), product_name: productName(row) };
}

const ITEM_SELECT = `SELECT i.*, p.category, p.manufacturer, p.style, p.color, p.sku, p.unit, p.stock_type, p.roll_width_ft,
       p.coverage_per_box, p.price, v.name AS vendor_name
  FROM inventory i JOIN products p ON p.id = i.product_id LEFT JOIN vendors v ON v.id = p.vendor_id`;

function remnantFlag(db, kind, qty) {
  const max = num(getSettings(db).remnant_max_ft, 20);
  return kind === 'roll' && qty > 0 && qty <= max ? 1 : 0;
}

export function register(r) {
  r.get('/inventory', ({ db, query }) => {
    const conds = ['i.qty > 0.0001'];
    const params = [];
    if (query.remnants === '1') conds.push('i.is_remnant = 1');
    if (query.category) { conds.push('p.category = ?'); params.push(query.category); }
    if (query.product_id) { conds.push('i.product_id = ?'); params.push(int(query.product_id)); }
    for (const t of String(query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
      const like = `%${t}%`;
      conds.push('(p.style LIKE ? OR p.color LIKE ? OR p.sku LIKE ? OR p.manufacturer LIKE ? OR i.tag LIKE ? OR i.dye_lot LIKE ? OR i.location LIKE ?)');
      params.push(like, like, like, like, like, like, like);
    }
    const rows = db.all(`${ITEM_SELECT} WHERE ${conds.join(' AND ')} ORDER BY p.category, p.style, p.color, i.is_remnant, i.id LIMIT ?`,
      ...params, Math.min(int(query.limit, 500), 3000));
    return rows.map(withSale);
  });

  r.post('/inventory', ({ db, body, user }) => {
    const product = must(db.get('SELECT * FROM products WHERE id = ?', int(body.product_id)), 'Product');
    if (product.stock_type === 'none') bad('This product isn’t tracked in stock. Change its stock type first.');
    let qty;
    let width = null;
    let length = null;
    if (product.stock_type === 'roll') {
      length = parseFeet(body.length_ft);
      width = parseFeet(body.width_ft) || product.roll_width_ft || 12;
      if (!length) bad('Enter the roll length in feet and inches, like 42 or 42 6.');
      qty = length;
    } else {
      qty = num(body.qty);
      if (!(qty > 0)) bad('Enter how many are on hand.');
    }
    const now = nowIso();
    const isRemnant = body.is_remnant !== undefined ? bool(body.is_remnant) : remnantFlag(db, product.stock_type, qty);
    const id = db.run(
      `INSERT INTO inventory (product_id, kind, tag, dye_lot, location, width_ft, length_ft, qty, unit_cost, is_remnant, received_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      product.id, product.stock_type, str(body.tag, 60), str(body.dye_lot, 60), str(body.location, 60), width, length, round4(qty),
      body.unit_cost !== undefined && body.unit_cost !== '' ? round4(num(body.unit_cost)) : product.cost,
      isRemnant, localDate(), str(body.notes, 300), now, now).lastInsertRowid;
    db.run("INSERT INTO inventory_tx (inventory_id, type, qty, note, user_id, created_at) VALUES (?, 'receive', ?, ?, ?, ?)",
      id, round4(qty), str(body.note, 200) || 'Added to stock', user.id, now);
    return withSale(db.get(`${ITEM_SELECT} WHERE i.id = ?`, id));
  });

  r.get('/inventory/:id', ({ db, params }) => {
    const item = must(db.get(`${ITEM_SELECT} WHERE i.id = ?`, params.id), 'Stock item');
    const history = db.all(
      `SELECT t.*, u.name AS user_name, o.number AS order_number FROM inventory_tx t
         LEFT JOIN users u ON u.id = t.user_id LEFT JOIN orders o ON o.id = t.order_id
        WHERE t.inventory_id = ? ORDER BY t.id DESC`, item.id);
    const po = item.po_id ? db.get('SELECT id, number FROM purchase_orders WHERE id = ?', item.po_id) : null;
    return { ...withSale(item), history, po };
  });

  r.put('/inventory/:id', ({ db, params, body }) => {
    const item = must(db.get('SELECT * FROM inventory WHERE id = ?', params.id), 'Stock item');
    const sets = [];
    const vals = [];
    for (const k of ['tag', 'dye_lot', 'location', 'notes']) if (k in body) { sets.push(`${k} = ?`); vals.push(str(body[k], 300)); }
    if ('is_remnant' in body) { sets.push('is_remnant = ?'); vals.push(bool(body.is_remnant)); }
    if ('unit_cost' in body) { sets.push('unit_cost = ?'); vals.push(round4(num(body.unit_cost))); }
    if ('width_ft' in body && item.kind === 'roll') {
      const w = parseFeet(body.width_ft);
      if (!w) bad('Enter the roll width.');
      sets.push('width_ft = ?'); vals.push(w);
    }
    if (sets.length) db.run(`UPDATE inventory SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...vals, nowIso(), item.id);
    return withSale(db.get(`${ITEM_SELECT} WHERE i.id = ?`, item.id));
  });

  // Count correction: set what is actually on hand.
  r.post('/inventory/:id/adjust', ({ db, params, body, user }) => {
    const item = must(db.get('SELECT * FROM inventory WHERE id = ?', params.id), 'Stock item');
    const newQty = item.kind === 'roll' ? parseFeet(body.qty) : num(body.qty, NaN);
    if (newQty === null || !Number.isFinite(newQty) || newQty < 0) bad(item.kind === 'roll' ? 'Enter the length left on the roll.' : 'Enter the count on hand.');
    const delta = round4(newQty - item.qty);
    if (!delta) return withSale(db.get(`${ITEM_SELECT} WHERE i.id = ?`, item.id));
    db.run("INSERT INTO inventory_tx (inventory_id, type, qty, note, user_id, created_at) VALUES (?, 'adjust', ?, ?, ?, ?)",
      item.id, delta, str(body.note, 200) || 'Count adjusted', user.id, nowIso());
    db.run('UPDATE inventory SET qty = ?, is_remnant = CASE WHEN ? = 1 THEN 1 ELSE is_remnant END, updated_at = ? WHERE id = ?',
      round4(newQty), remnantFlag(db, item.kind, newQty), nowIso(), item.id);
    return withSale(db.get(`${ITEM_SELECT} WHERE i.id = ?`, item.id));
  });

  // Pull stock (or cut a roll) for an order line.
  r.post('/lines/:id/allocate', ({ db, params, body, user }) => {
    const line = must(db.get("SELECT * FROM lines WHERE id = ? AND doc_type = 'order'", params.id), 'Item');
    const order = db.get('SELECT * FROM orders WHERE id = ?', line.doc_id);
    if (order.stage === 'cancelled') bad('This order is cancelled.');
    const item = must(db.get('SELECT * FROM inventory WHERE id = ?', int(body.inventory_id)), 'Stock item');
    if (line.product_id && item.product_id !== line.product_id && !body.allow_substitute) {
      bad('That stock is a different product than this item.');
    }
    const qty = item.kind === 'roll' ? parseFeet(body.qty) : num(body.qty);
    if (!qty || qty <= 0) bad(item.kind === 'roll' ? 'Enter the cut length.' : 'Enter how many to pull.');
    if (qty > item.qty + 0.001) bad(`Only ${item.kind === 'roll' ? `${round2(item.qty)} ft` : round2(item.qty)} left on this ${item.kind === 'roll' ? 'roll' : 'item'}.`);
    const now = nowIso();
    db.run('INSERT INTO inventory_tx (inventory_id, type, qty, order_id, line_id, note, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      item.id, item.kind === 'roll' ? 'cut' : 'pull', -round4(qty), order.id, line.id, str(body.note, 200) || `For ${order.number}`, user.id, now);
    const left = round4(Math.max(0, item.qty - qty));
    db.run('UPDATE inventory SET qty = ?, is_remnant = CASE WHEN ? = 1 THEN 1 ELSE is_remnant END, updated_at = ? WHERE id = ?',
      left, remnantFlag(db, item.kind, left), now, item.id);
    if (line.material_status === 'none') db.run("UPDATE lines SET material_status = 'needed' WHERE id = ?", line.id);
    syncLineMaterial(db, line.id);
    refreshMaterialStage(db, user, order.id);
    return orderDetail(db, order.id);
  });

  // Put pulled material back into stock.
  r.post('/inventory-tx/:id/return', ({ db, params, user }) => {
    const tx = must(db.get("SELECT * FROM inventory_tx WHERE id = ? AND type IN ('cut','pull')", params.id), 'Pulled material');
    const returned = db.get("SELECT COUNT(*) AS n FROM inventory_tx WHERE type = 'return' AND ref_id = ?", tx.id).n;
    if (returned) bad('That material was already returned.');
    const item = db.get('SELECT * FROM inventory WHERE id = ?', tx.inventory_id);
    const qty = Math.abs(tx.qty);
    const now = nowIso();
    db.run("INSERT INTO inventory_tx (inventory_id, type, qty, order_id, line_id, ref_id, note, user_id, created_at) VALUES (?, 'return', ?, ?, ?, ?, ?, ?, ?)",
      item.id, round4(qty), tx.order_id, tx.line_id, tx.id, 'Returned to stock', user.id, now);
    const newQty = round4(item.qty + qty);
    db.run('UPDATE inventory SET qty = ?, is_remnant = ?, updated_at = ? WHERE id = ?', newQty, remnantFlag(db, item.kind, newQty), now, item.id);
    if (tx.line_id) syncLineMaterial(db, tx.line_id);
    if (tx.order_id) {
      refreshMaterialStage(db, user, tx.order_id);
      return orderDetail(db, tx.order_id);
    }
    return { ok: true };
  });

}
