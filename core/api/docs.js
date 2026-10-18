// Quotes, plus the line items and rooms shared by quotes and orders.

import { bad, str, int, num, bool, nowIso, round2, round4, localDate, addDays, customerName } from '../util.js';
import { productName, parseFeet } from '../calc.js';
import { must, updateFields, recalcDoc, nextNumber, getLines, getRooms, userName, refreshMaterialStage, syncLineMaterial } from './shared.js';
import { checkMoney } from './orders.js';

const TYPES = { quotes: 'quote', orders: 'order' };

export function assertEditable(db, type, id) {
  if (type === 'quote') {
    const q = must(db.get('SELECT * FROM quotes WHERE id = ?', id), 'Quote');
    if (q.status === 'accepted') bad('This quote was accepted and turned into an order. Make changes on the order, or duplicate the quote.');
    return q;
  }
  const o = must(db.get('SELECT * FROM orders WHERE id = ?', id), 'Order');
  if (o.stage === 'cancelled') bad('This order is cancelled.');
  if (o.invoiced_at) bad('This order is invoiced. Reopen the invoice to change items.');
  return o;
}

function kindFor(product, fallback) {
  if (!product) return ['material', 'labor', 'other'].includes(fallback) ? fallback : 'other';
  if (product.category === 'labor') return 'labor';
  if (product.category === 'service') return 'other';
  return 'material';
}

// Quantities must be positive. Prices may be negative for a credit line; costs may not.
export function checkLineNumbers({ qty, price, cost }, what = 'this item') {
  if (!Number.isFinite(qty) || qty <= 0) bad(`Enter a quantity for ${what}.`);
  if (qty > 1000000) bad(`The quantity for ${what} is too large.`);
  if (!Number.isFinite(price) || Math.abs(price) > 1000000) bad(`Enter a price for ${what}.`);
  if (!Number.isFinite(cost) || cost < 0 || cost > 1000000) bad(`Enter a cost of $0 or more for ${what}.`);
}

export function insertLine(db, type, docId, body) {
  const product = int(body.product_id) ? db.get('SELECT * FROM products WHERE id = ?', int(body.product_id)) : null;
  if (body.product_id && !product) bad('That product no longer exists.');
  const description = str(body.description, 300) || (product ? productName(product) : null);
  if (!description) bad('Enter a description or pick a product.');
  const qty = round4(num(body.qty, product ? NaN : 1));
  const price = body.price !== undefined && body.price !== '' ? round4(num(body.price, NaN)) : (product?.price ?? 0);
  const cost = body.cost !== undefined && body.cost !== '' ? round4(num(body.cost, NaN)) : (product?.cost ?? 0);
  checkLineNumbers({ qty, price, cost }, description);
  const taxable = body.taxable !== undefined ? bool(body.taxable) : (product ? product.taxable : 1);
  const unit = str(body.unit, 10) || product?.unit || 'EA';
  const kind = kindFor(product, body.kind);
  const materialStatus = type === 'order' && product && product.stock_type !== 'none' ? 'needed' : 'none';
  const sort = (db.get('SELECT COALESCE(MAX(sort), 0) AS m FROM lines WHERE doc_type = ? AND doc_id = ?', type, docId).m || 0) + 10;
  const id = db.run(
    `INSERT INTO lines (doc_type, doc_id, sort, product_id, kind, description, area, unit, qty, price, cost, taxable, total, material_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    type, docId, sort, product?.id ?? null, kind, description, str(body.area, 200), unit, qty, price, cost, taxable,
    round2(qty * price), materialStatus, str(body.notes, 1000),
  ).lastInsertRowid;
  return id;
}

function insertRoom(db, type, docId, body) {
  const name = str(body.name, 80) || 'Room';
  const length = parseFeet(body.length_ft);
  const width = parseFeet(body.width_ft);
  if (!(length > 0) || !(width > 0) || length > 1000 || width > 1000) bad('Enter length and width in feet and inches, like 14 or 14 6.');
  const sort = (db.get('SELECT COALESCE(MAX(sort), 0) AS m FROM rooms WHERE doc_type = ? AND doc_id = ?', type, docId).m || 0) + 10;
  return db.run('INSERT INTO rooms (doc_type, doc_id, name, length_ft, width_ft, sort, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    type, docId, name, round4(length), round4(width), sort, str(body.notes, 500)).lastInsertRowid;
}

export function quoteDetail(db, id) {
  const q = must(db.get('SELECT * FROM quotes WHERE id = ?', id), 'Quote');
  const customer = db.get('SELECT * FROM customers WHERE id = ?', q.customer_id);
  const notes = db.all(
    `SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.entity_type = 'quote' AND n.entity_id = ? ORDER BY n.id DESC`, id);
  const order = q.order_id ? db.get('SELECT id, number, stage FROM orders WHERE id = ?', q.order_id) : null;
  return {
    ...q,
    customer: customer ? { ...customer, display_name: customerName(customer) } : null,
    sales_rep_name: userName(db, q.sales_rep_id),
    lines: getLines(db, 'quote', id),
    rooms: getRooms(db, 'quote', id),
    note_items: notes,
    order,
  };
}

const QUOTE_FIELDS = {
  title: (v) => str(v, 160),
  job_address: (v) => str(v, 160), job_city: (v) => str(v, 80), job_state: (v) => str(v, 20), job_zip: (v) => str(v, 20),
  valid_until: (v) => str(v, 10),
  notes: (v) => str(v, 4000), internal_notes: (v) => str(v, 4000),
  discount: (v) => Math.max(0, round2(num(v))),
  tax_rate: (v) => Math.max(0, num(v)),
  sales_rep_id: (v) => int(v),
};

// Turn a quote into an order (copies rooms and lines).
export function convertQuote(db, user, quoteId, extra = {}) {
  const q = must(db.get('SELECT * FROM quotes WHERE id = ?', quoteId), 'Quote');
  if (q.order_id) bad('This quote already has an order.');
  if (q.status === 'declined') bad('This quote is marked lost. Reopen it before the customer accepts.');
  const lineCount = db.get("SELECT COUNT(*) AS n FROM lines WHERE doc_type = 'quote' AND doc_id = ?", quoteId).n;
  if (!lineCount) bad('Add at least one item before creating an order.');
  const now = nowIso();
  const number = `SO-${nextNumber(db, 'order')}`;
  const orderId = db.run(
    `INSERT INTO orders (number, quote_id, customer_id, sales_rep_id, stage, order_date, title, job_address, job_city, job_state, job_zip,
       notes, internal_notes, discount, tax_rate, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    number, q.id, q.customer_id, q.sales_rep_id, extra.order_date || localDate(), q.title, q.job_address, q.job_city, q.job_state, q.job_zip,
    q.notes, q.internal_notes, q.discount, q.tax_rate, now, now,
  ).lastInsertRowid;
  for (const l of db.all("SELECT * FROM lines WHERE doc_type = 'quote' AND doc_id = ? ORDER BY sort, id", quoteId)) {
    const p = l.product_id ? db.get('SELECT stock_type FROM products WHERE id = ?', l.product_id) : null;
    db.run(
      `INSERT INTO lines (doc_type, doc_id, sort, product_id, kind, description, area, unit, qty, price, cost, taxable, total, material_status, notes)
       VALUES ('order', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      orderId, l.sort, l.product_id, l.kind, l.description, l.area, l.unit, l.qty, l.price, l.cost, l.taxable, l.total,
      p && p.stock_type !== 'none' ? 'needed' : 'none', l.notes);
  }
  for (const rm of db.all("SELECT * FROM rooms WHERE doc_type = 'quote' AND doc_id = ? ORDER BY sort, id", quoteId)) {
    db.run("INSERT INTO rooms (doc_type, doc_id, name, length_ft, width_ft, sort, notes) VALUES ('order', ?, ?, ?, ?, ?, ?)",
      orderId, rm.name, rm.length_ft, rm.width_ft, rm.sort, rm.notes);
  }
  db.run("UPDATE quotes SET status = 'accepted', order_id = ?, signed_name = COALESCE(?, signed_name), signature = COALESCE(?, signature), signed_at = COALESCE(?, signed_at), updated_at = ? WHERE id = ?",
    orderId, extra.signed_name || null, extra.signature || null, extra.signed_name ? now : null, now, quoteId);
  recalcDoc(db, 'order', orderId);
  db.run('UPDATE customers SET updated_at = ? WHERE id = ?', now, q.customer_id);
  db.run('INSERT INTO activity (entity_type, entity_id, action, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    'order', orderId, 'created', `From quote ${q.number}`, user?.id ?? null, now);
  return orderId;
}

export function register(r) {
  // ---------- quotes ----------
  r.get('/quotes', ({ db, query }) => {
    const conds = [];
    const params = [];
    if (query.status === 'open') conds.push("q.status IN ('draft','sent')");
    else if (query.status) { conds.push('q.status = ?'); params.push(query.status); }
    if (query.rep) { conds.push('q.sales_rep_id = ?'); params.push(int(query.rep)); }
    if (query.customer_id) { conds.push('q.customer_id = ?'); params.push(int(query.customer_id)); }
    for (const t of String(query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 4)) {
      const like = `%${t}%`;
      conds.push('(q.number LIKE ? OR q.title LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company LIKE ?)');
      params.push(like, like, like, like, like);
    }
    const rows = db.all(
      `SELECT q.id, q.number, q.status, q.quote_date, q.title, q.total, q.subtotal, q.cost_total, q.discount, q.valid_until, q.sent_at, q.created_at, q.updated_at,
              q.order_id, q.sales_rep_id, u.name AS sales_rep_name,
              c.id AS customer_id, c.first_name, c.last_name, c.company, c.city
         FROM quotes q JOIN customers c ON c.id = q.customer_id LEFT JOIN users u ON u.id = q.sales_rep_id
        ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
        ORDER BY q.id DESC LIMIT ?`, ...params, Math.min(int(query.limit, 300), 2000));
    return rows.map((x) => ({ ...x, customer_name: customerName(x) }));
  });

  r.post('/quotes', ({ db, body, user, settings, log }) => {
    const customer = must(db.get('SELECT * FROM customers WHERE id = ?', int(body.customer_id)), 'Customer');
    const s = settings();
    const now = nowIso();
    const number = `Q-${nextNumber(db, 'quote')}`;
    const id = db.run(
      `INSERT INTO quotes (number, customer_id, sales_rep_id, status, quote_date, title, job_address, job_city, job_state, job_zip, valid_until, tax_rate, notes, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      number, customer.id, int(body.sales_rep_id) || customer.sales_rep_id || user.id, localDate(), str(body.title, 160),
      str(body.job_address) || customer.address, str(body.job_city) || customer.city, str(body.job_state) || customer.state, str(body.job_zip) || customer.zip,
      addDays(localDate(), int(s.quote_valid_days, 30)), num(s.tax_rate, 0), null, now, now,
    ).lastInsertRowid;
    db.run('UPDATE customers SET updated_at = ? WHERE id = ?', now, customer.id);
    log('quote', id, 'created');
    return quoteDetail(db, id);
  });

  r.get('/quotes/:id', ({ db, params }) => quoteDetail(db, params.id));

  r.put('/quotes/:id', ({ db, params, body }) => {
    const current = assertEditable(db, 'quote', params.id);
    checkMoney(body, current.subtotal);
    updateFields(db, 'quotes', params.id, body, QUOTE_FIELDS);
    if ('customer_id' in body) {
      must(db.get('SELECT id FROM customers WHERE id = ?', int(body.customer_id)), 'Customer');
      db.run('UPDATE quotes SET customer_id = ? WHERE id = ?', int(body.customer_id), params.id);
    }
    recalcDoc(db, 'quote', params.id);
    return quoteDetail(db, params.id);
  });

  r.del('/quotes/:id', ({ db, params }) => {
    const q = must(db.get('SELECT * FROM quotes WHERE id = ?', params.id), 'Quote');
    if (q.order_id) bad('This quote has an order, so it can’t be deleted. Mark it lost instead.');
    db.run("DELETE FROM lines WHERE doc_type = 'quote' AND doc_id = ?", q.id);
    db.run("DELETE FROM rooms WHERE doc_type = 'quote' AND doc_id = ?", q.id);
    db.run("DELETE FROM notes WHERE entity_type = 'quote' AND entity_id = ?", q.id);
    db.run('DELETE FROM quotes WHERE id = ?', q.id);
    return { ok: true };
  });

  r.post('/quotes/:id/status', ({ db, params, body, log }) => {
    const q = must(db.get('SELECT * FROM quotes WHERE id = ?', params.id), 'Quote');
    const status = body.status;
    if (!['draft', 'sent', 'declined'].includes(status)) bad('Use "Accept" to accept a quote.');
    if (q.status === 'accepted') bad('This quote is already accepted.');
    db.run('UPDATE quotes SET status = ?, sent_at = CASE WHEN ? = \'sent\' THEN COALESCE(sent_at, ?) ELSE sent_at END, updated_at = ? WHERE id = ?',
      status, status, nowIso(), nowIso(), q.id);
    log('quote', q.id, 'status', status);
    return quoteDetail(db, q.id);
  });

  // Customer accepts (optionally signs) and an order is created.
  r.post('/quotes/:id/accept', ({ db, params, body, user }) => {
    const sig = body.signature ? String(body.signature) : null;
    if (sig && (!sig.startsWith('data:image/') || sig.length > 400000)) bad('That signature couldn’t be saved. Clear it and sign again.');
    const name = str(body.signed_name, 120);
    if (sig && !name) bad('Type the customer’s name under the signature.');
    const orderId = convertQuote(db, user, params.id, { signed_name: name, signature: sig });
    return { order_id: orderId, quote: quoteDetail(db, params.id) };
  });

  r.post('/quotes/:id/duplicate', ({ db, params, user, settings }) => {
    const q = must(db.get('SELECT * FROM quotes WHERE id = ?', params.id), 'Quote');
    const s = settings();
    const now = nowIso();
    const number = `Q-${nextNumber(db, 'quote')}`;
    const id = db.run(
      `INSERT INTO quotes (number, customer_id, sales_rep_id, status, quote_date, title, job_address, job_city, job_state, job_zip, valid_until,
         notes, internal_notes, discount, tax_rate, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      number, q.customer_id, q.sales_rep_id || user.id, localDate(), q.title ? `${q.title} (copy)` : null, q.job_address, q.job_city, q.job_state, q.job_zip,
      addDays(localDate(), int(s.quote_valid_days, 30)), q.notes, q.internal_notes, q.discount, q.tax_rate, now, now,
    ).lastInsertRowid;
    db.run(`INSERT INTO lines (doc_type, doc_id, sort, product_id, kind, description, area, unit, qty, price, cost, taxable, total, material_status, notes)
            SELECT 'quote', ?, sort, product_id, kind, description, area, unit, qty, price, cost, taxable, total, 'none', notes
              FROM lines WHERE doc_type = 'quote' AND doc_id = ?`, id, q.id);
    db.run(`INSERT INTO rooms (doc_type, doc_id, name, length_ft, width_ft, sort, notes)
            SELECT 'quote', ?, name, length_ft, width_ft, sort, notes FROM rooms WHERE doc_type = 'quote' AND doc_id = ?`, id, q.id);
    recalcDoc(db, 'quote', id);
    return quoteDetail(db, id);
  });

  // ---------- lines (quotes and orders) ----------
  for (const [plural, type] of Object.entries(TYPES)) {
    r.post(`/${plural}/:id/lines`, ({ db, params, body }) => {
      assertEditable(db, type, params.id);
      const items = Array.isArray(body.lines) ? body.lines : [body];
      if (!items.length) bad('Nothing to add.');
      const ids = items.map((item) => insertLine(db, type, params.id, item));
      recalcDoc(db, type, params.id);
      if (type === 'order') refreshMaterialStage(db, null, params.id);
      return { ids };
    });

    r.post(`/${plural}/:id/rooms`, ({ db, params, body }) => {
      assertEditable(db, type, params.id);
      const items = Array.isArray(body.rooms) ? body.rooms : [body];
      const ids = items.map((item) => insertRoom(db, type, params.id, item));
      return { ids, rooms: getRooms(db, type, params.id) };
    });
  }

  r.put('/lines/:id', ({ db, params, body }) => {
    const line = must(db.get('SELECT * FROM lines WHERE id = ?', params.id), 'Item');
    assertEditable(db, line.doc_type, line.doc_id);
    const fields = {
      description: (v) => str(v, 300) || line.description,
      area: (v) => str(v, 200),
      unit: (v) => str(v, 10) || line.unit,
      qty: (v) => round4(num(v)),
      price: (v) => round4(num(v)),
      cost: (v) => round4(num(v)),
      taxable: bool,
      notes: (v) => str(v, 1000),
    };
    const next = {
      qty: 'qty' in body ? round4(num(body.qty, NaN)) : line.qty,
      price: 'price' in body ? round4(num(body.price, NaN)) : line.price,
      cost: 'cost' in body ? round4(num(body.cost, NaN)) : line.cost,
    };
    checkLineNumbers(next, line.description);
    updateFields(db, 'lines', line.id, body, fields);
    const l = db.get('SELECT qty, price FROM lines WHERE id = ?', line.id);
    db.run('UPDATE lines SET total = ? WHERE id = ?', round2(l.qty * l.price), line.id);
    recalcDoc(db, line.doc_type, line.doc_id);
    if (line.doc_type === 'order' && ('qty' in body || 'unit' in body)) {
      syncLineMaterial(db, line.id);
      refreshMaterialStage(db, null, line.doc_id);
    }
    return db.get('SELECT * FROM lines WHERE id = ?', line.id);
  });

  r.del('/lines/:id', ({ db, params }) => {
    const line = must(db.get('SELECT * FROM lines WHERE id = ?', params.id), 'Item');
    assertEditable(db, line.doc_type, line.doc_id);
    if (line.doc_type === 'order') {
      const alloc = db.get("SELECT COUNT(*) AS n FROM inventory_tx WHERE line_id = ? AND type IN ('cut','pull')", line.id).n;
      const returned = db.get("SELECT COUNT(*) AS n FROM inventory_tx WHERE line_id = ? AND type = 'return'", line.id).n;
      if (alloc > returned) bad('Material is pulled for this item. Return it to stock first.');
      const onPos = db.all(
        `SELECT pl.id, pl.po_id, pl.received_qty, po.number, po.status FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
          WHERE pl.order_line_id = ?`, line.id);
      const live = onPos.filter((p) => ['sent', 'partial'].includes(p.status) && p.received_qty === 0);
      if (live.length) bad(`This item is on ${live[0].number}, which was already sent. Cancel it with the vendor and remove it from that purchase order first.`);
      for (const p of onPos) {
        if (p.status === 'draft') {
          db.run('DELETE FROM po_lines WHERE id = ?', p.id);
          db.run('UPDATE purchase_orders SET total = (SELECT COALESCE(SUM(total), 0) FROM po_lines WHERE po_id = ?), updated_at = ? WHERE id = ?', p.po_id, nowIso(), p.po_id);
        } else {
          db.run('UPDATE po_lines SET order_line_id = NULL, order_id = NULL WHERE id = ?', p.id);
        }
      }
    }
    db.run('DELETE FROM lines WHERE id = ?', line.id);
    recalcDoc(db, line.doc_type, line.doc_id);
    if (line.doc_type === 'order') refreshMaterialStage(db, null, line.doc_id);
    return { ok: true };
  });

  r.post('/lines/:id/move', ({ db, params, body }) => {
    const line = must(db.get('SELECT * FROM lines WHERE id = ?', params.id), 'Item');
    assertEditable(db, line.doc_type, line.doc_id);
    const siblings = db.all('SELECT id, sort FROM lines WHERE doc_type = ? AND doc_id = ? ORDER BY sort, id', line.doc_type, line.doc_id);
    const i = siblings.findIndex((s) => s.id === line.id);
    const j = body.dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return { ok: true };
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    siblings.forEach((s, k) => db.run('UPDATE lines SET sort = ? WHERE id = ?', (k + 1) * 10, s.id));
    return { ok: true };
  });

  r.put('/rooms/:id', ({ db, params, body }) => {
    const room = must(db.get('SELECT * FROM rooms WHERE id = ?', params.id), 'Room');
    assertEditable(db, room.doc_type, room.doc_id);
    const length = 'length_ft' in body ? parseFeet(body.length_ft) : room.length_ft;
    const width = 'width_ft' in body ? parseFeet(body.width_ft) : room.width_ft;
    if (!(length > 0) || !(width > 0) || length > 1000 || width > 1000) bad('Enter length and width in feet and inches, like 14 or 14 6.');
    db.run('UPDATE rooms SET name = ?, length_ft = ?, width_ft = ?, notes = ? WHERE id = ?',
      str(body.name, 80) || room.name, round4(length), round4(width), 'notes' in body ? str(body.notes, 500) : room.notes, room.id);
    return db.get('SELECT * FROM rooms WHERE id = ?', room.id);
  });

  r.del('/rooms/:id', ({ db, params }) => {
    const room = must(db.get('SELECT * FROM rooms WHERE id = ?', params.id), 'Room');
    assertEditable(db, room.doc_type, room.doc_id);
    db.run('DELETE FROM rooms WHERE id = ?', room.id);
    return { ok: true };
  });

}
