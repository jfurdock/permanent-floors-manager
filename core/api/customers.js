import { bad, str, int, nowIso, digits, customerName } from '../util.js';
import { must, updateFields, userName, EVERYONE } from './shared.js';

const CUSTOMER_FIELDS = {
  type: (v) => (['residential', 'commercial', 'builder'].includes(v) ? v : 'residential'),
  first_name: (v) => str(v, 80),
  last_name: (v) => str(v, 80),
  company: (v) => str(v, 120),
  email: (v) => str(v, 120),
  phone: (v) => str(v, 40),
  phone2: (v) => str(v, 40),
  address: (v) => str(v, 160),
  city: (v) => str(v, 80),
  state: (v) => str(v, 20),
  zip: (v) => str(v, 20),
  source: (v) => str(v, 80),
  sales_rep_id: (v) => int(v),
  notes: (v) => str(v, 4000),
};

function searchClause(q, cols) {
  const terms = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const where = [];
  const params = [];
  for (const t of terms) {
    const like = `%${t}%`;
    const parts = cols.map((c) => `${c} LIKE ?`);
    const d = digits(t);
    if (d.length >= 3 && cols.includes('c.phone')) {
      parts.push("REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.phone,''),'-',''),' ',''),'(',''),')','') LIKE ?");
      params.push(...cols.map(() => like), `%${d}%`);
    } else {
      params.push(...cols.map(() => like));
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  return { where: where.join(' AND '), params };
}

export function register(r) {
  r.get('/customers', ({ db, query }) => {
    const conds = [];
    const params = [];
    if (query.q) {
      const s = searchClause(query.q, ['c.first_name', 'c.last_name', 'c.company', 'c.email', 'c.phone', 'c.address', 'c.city']);
      conds.push(s.where);
      params.push(...s.params);
    }
    if (query.type) { conds.push('c.type = ?'); params.push(query.type); }
    const limit = Math.min(int(query.limit, 200), 1000);
    const rows = db.all(
      `SELECT c.*,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.stage != 'cancelled') AS order_count,
         (SELECT COUNT(*) FROM quotes q WHERE q.customer_id = c.id AND q.status IN ('draft','sent')) AS open_quotes,
         (SELECT COALESCE(SUM(o.total - o.paid_total), 0) FROM orders o WHERE o.customer_id = c.id AND o.invoiced_at IS NOT NULL AND o.stage != 'cancelled') AS balance
       FROM customers c ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
       ORDER BY c.updated_at DESC LIMIT ?`,
      ...params, limit,
    );
    return rows.map((c) => ({ ...c, display_name: customerName(c) }));
  });

  r.post('/customers', ({ db, body, user, log }) => {
    const data = {};
    for (const [k, clean] of Object.entries(CUSTOMER_FIELDS)) data[k] = clean(body[k]);
    if (!data.first_name && !data.last_name && !data.company) bad('Enter a name or company.');
    if (!data.sales_rep_id && user.role === 'sales') data.sales_rep_id = user.id;
    const now = nowIso();
    const keys = Object.keys(data);
    const id = db.run(
      `INSERT INTO customers (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, ?, ?)`,
      ...keys.map((k) => data[k]), now, now,
    ).lastInsertRowid;
    log('customer', id, 'created');
    const c = db.get('SELECT * FROM customers WHERE id = ?', id);
    return { ...c, display_name: customerName(c) };
  });

  r.get('/customers/:id', ({ db, params }) => {
    const c = must(db.get('SELECT * FROM customers WHERE id = ?', params.id), 'Customer');
    const quotes = db.all('SELECT id, number, status, title, total, created_at FROM quotes WHERE customer_id = ? ORDER BY id DESC', c.id);
    const orders = db.all('SELECT id, number, stage, title, total, paid_total, invoiced_at, created_at FROM orders WHERE customer_id = ? ORDER BY id DESC', c.id);
    const appointments = db.all(
      `SELECT a.*, i.name AS installer_name FROM appointments a LEFT JOIN installers i ON i.id = a.installer_id
        WHERE a.customer_id = ? ORDER BY a.date DESC LIMIT 50`, c.id);
    const payments = db.all(
      `SELECT p.*, o.number AS order_number FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.customer_id = ? ORDER BY p.date DESC, p.id DESC`, c.id);
    const notes = db.all(
      `SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id
        WHERE n.entity_type = 'customer' AND n.entity_id = ? ORDER BY n.id DESC`, c.id);
    const balance = orders.filter((o) => o.invoiced_at && o.stage !== 'cancelled').reduce((s, o) => s + (o.total - o.paid_total), 0);
    const lifetime = orders.filter((o) => o.stage !== 'cancelled').reduce((s, o) => s + o.total, 0);
    return {
      ...c,
      display_name: customerName(c),
      sales_rep_name: userName(db, c.sales_rep_id),
      quotes, orders, appointments, payments, note_items: notes,
      balance: Math.round(balance * 100) / 100,
      lifetime: Math.round(lifetime * 100) / 100,
    };
  });

  r.put('/customers/:id', ({ db, params, body }) => {
    must(db.get('SELECT id FROM customers WHERE id = ?', params.id), 'Customer');
    updateFields(db, 'customers', params.id, body, CUSTOMER_FIELDS);
    const c = db.get('SELECT * FROM customers WHERE id = ?', params.id);
    if (!c.first_name && !c.last_name && !c.company) bad('Enter a name or company.');
    return { ...c, display_name: customerName(c) };
  });

  r.del('/customers/:id', ({ db, params }) => {
    must(db.get('SELECT id FROM customers WHERE id = ?', params.id), 'Customer');
    const used = db.get('SELECT (SELECT COUNT(*) FROM quotes WHERE customer_id = ?) + (SELECT COUNT(*) FROM orders WHERE customer_id = ?) AS n', params.id, params.id).n;
    if (used) bad('This customer has quotes or orders, so it can’t be deleted.');
    db.run("DELETE FROM notes WHERE entity_type = 'customer' AND entity_id = ?", params.id);
    db.run('UPDATE appointments SET customer_id = NULL WHERE customer_id = ?', params.id);
    db.run('DELETE FROM customers WHERE id = ?', params.id);
    return { ok: true };
  });

  // ---- notes on any record ----
  r.post('/notes', ({ db, body, user }) => {
    const type = str(body.entity_type, 20);
    const id = int(body.entity_id);
    const text = str(body.body, 4000);
    if (!['customer', 'quote', 'order', 'po', 'appointment'].includes(type) || !id) bad('Notes need a record to attach to.');
    if (!text) bad('Write something first.');
    if (user.role === 'installer') {
      const ok = type === 'order'
        ? db.get("SELECT COUNT(*) AS n FROM appointments WHERE order_id = ? AND installer_id = ? AND status != 'cancelled'", id, user.installer_id || -1).n
        : type === 'appointment'
          ? db.get("SELECT COUNT(*) AS n FROM appointments WHERE id = ? AND installer_id = ?", id, user.installer_id || -1).n
          : 0;
      if (!ok) bad('You can only add notes to your own jobs.');
    }
    const nid = db.run('INSERT INTO notes (entity_type, entity_id, body, user_id, created_at) VALUES (?, ?, ?, ?, ?)', type, id, text, user.id, nowIso()).lastInsertRowid;
    return db.get('SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = ?', nid);
  }, { roles: EVERYONE });

  r.del('/notes/:id', ({ db, params, user }) => {
    const n = must(db.get('SELECT * FROM notes WHERE id = ?', params.id), 'Note');
    if (n.user_id !== user.id && !['admin', 'manager'].includes(user.role)) bad('Only the person who wrote a note can delete it.');
    db.run('DELETE FROM notes WHERE id = ?', params.id);
    return { ok: true };
  }, { roles: EVERYONE });

  // ---- global search ----
  r.get('/search', ({ db, query }) => {
    const q = String(query.q || '').trim();
    if (q.length < 2) return { customers: [], quotes: [], orders: [], products: [], pos: [] };
    const like = `%${q}%`;
    const cs = searchClause(q, ['c.first_name', 'c.last_name', 'c.company', 'c.email', 'c.phone', 'c.address']);
    const customers = db.all(`SELECT c.* FROM customers c WHERE ${cs.where} ORDER BY c.updated_at DESC LIMIT 8`, ...cs.params)
      .map((c) => ({ id: c.id, display_name: customerName(c), phone: c.phone, city: c.city }));
    const quotes = db.all(
      `SELECT q.id, q.number, q.title, q.status, q.total, c.first_name, c.last_name, c.company
         FROM quotes q JOIN customers c ON c.id = q.customer_id
        WHERE q.number LIKE ? OR q.title LIKE ? OR c.last_name LIKE ? OR c.company LIKE ? OR c.first_name LIKE ?
        ORDER BY q.id DESC LIMIT 8`, like, like, like, like, like)
      .map((x) => ({ ...x, customer_name: customerName(x) }));
    const orders = db.all(
      `SELECT o.id, o.number, o.title, o.stage, o.total, o.invoice_number, c.first_name, c.last_name, c.company
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.number LIKE ? OR o.title LIKE ? OR o.customer_po LIKE ? OR o.invoice_number LIKE ? OR c.last_name LIKE ? OR c.company LIKE ? OR c.first_name LIKE ?
        ORDER BY o.id DESC LIMIT 8`, like, like, like, like, like, like, like)
      .map((x) => ({ ...x, customer_name: customerName(x) }));
    const products = db.all(
      `SELECT id, sku, category, manufacturer, style, color, price, unit FROM products
        WHERE active = 1 AND (style LIKE ? OR color LIKE ? OR sku LIKE ? OR manufacturer LIKE ?) ORDER BY style LIMIT 8`,
      like, like, like, like);
    const pos = db.all(
      `SELECT po.id, po.number, po.status, v.name AS vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
        WHERE po.number LIKE ? OR v.name LIKE ? ORDER BY po.id DESC LIMIT 5`, like, like);
    return { customers, quotes, orders, products, pos };
  });
}
