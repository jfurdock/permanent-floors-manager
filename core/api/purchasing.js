import { bad, str, int, num, nowIso, round2, round4, localDate, isDate } from '../util.js';
import { parseFeet, productName, stockToSale, saleToStock } from '../calc.js';
import { must, nextNumber, refreshMaterialStage, syncLineMaterial, getSettings } from './shared.js';

function poTotal(db, poId) {
  db.run('UPDATE purchase_orders SET total = (SELECT COALESCE(SUM(total), 0) FROM po_lines WHERE po_id = ?), updated_at = ? WHERE id = ?', poId, nowIso(), poId);
}

export function poDetail(db, id) {
  const po = must(db.get('SELECT * FROM purchase_orders WHERE id = ?', id), 'Purchase order');
  const vendor = db.get('SELECT * FROM vendors WHERE id = ?', po.vendor_id);
  const lines = db.all(
    `SELECT pl.*, p.stock_type, p.unit AS product_unit, p.roll_width_ft, p.coverage_per_box, p.sku, p.category,
            o.number AS order_number, o.id AS order_id
       FROM po_lines pl LEFT JOIN products p ON p.id = pl.product_id LEFT JOIN orders o ON o.id = pl.order_id
      WHERE pl.po_id = ? ORDER BY pl.id`, id);
  const receipts = db.all(
    `SELECT i.*, p.style, p.color, p.manufacturer FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.po_id = ? ORDER BY i.id`, id);
  const notes = db.all(
    `SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.entity_type = 'po' AND n.entity_id = ? ORDER BY n.id DESC`, id);
  return { ...po, vendor, lines, receipts, note_items: notes };
}

function assertDraftish(po) {
  if (['received', 'cancelled'].includes(po.status)) bad(`This purchase order is ${po.status}.`);
}

function addPoLine(db, po, body) {
  const product = int(body.product_id) ? must(db.get('SELECT * FROM products WHERE id = ?', int(body.product_id)), 'Product') : null;
  const description = str(body.description, 300) || (product ? productName(product) : null);
  if (!description) bad('Pick a product or enter a description.');
  const qty = round4(num(body.qty));
  if (qty <= 0) bad('Enter a quantity.');
  let unit = str(body.unit, 10) || product?.unit || 'EA';
  let cost = body.cost !== undefined && body.cost !== '' ? round4(num(body.cost)) : (product?.cost ?? 0);
  if (product?.stock_type === 'box' && product.coverage_per_box > 0 && !body.unit) {
    unit = 'BOX';
    if (body.cost === undefined || body.cost === '') cost = round4(product.cost * product.coverage_per_box);
  }
  db.run('INSERT INTO po_lines (po_id, product_id, description, unit, qty, cost, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    po.id, product?.id ?? null, description, unit, qty, cost, round2(qty * cost), str(body.notes, 500));
}

// Call after a PO line goes away (deleted or its PO cancelled) so the order item shows it still needs material.
function resyncOrderLines(db, user, orderLineIds) {
  const orders = new Set();
  for (const id of orderLineIds.filter(Boolean)) {
    const l = db.get("SELECT id, doc_id FROM lines WHERE id = ? AND doc_type = 'order'", id);
    if (!l) continue;
    syncLineMaterial(db, l.id);
    orders.add(l.doc_id);
  }
  for (const o of orders) refreshMaterialStage(db, user, o);
}

export function register(r) {
  r.get('/pos', ({ db, query }) => {
    const conds = [];
    const params = [];
    if (query.status === 'open') conds.push("po.status IN ('draft','sent','partial')");
    else if (query.status) { conds.push('po.status = ?'); params.push(query.status); }
    if (query.vendor_id) { conds.push('po.vendor_id = ?'); params.push(int(query.vendor_id)); }
    if (query.q) {
      const like = `%${String(query.q).trim()}%`;
      conds.push('(po.number LIKE ? OR v.name LIKE ?)');
      params.push(like, like);
    }
    return db.all(
      `SELECT po.*, v.name AS vendor_name,
         (SELECT COUNT(*) FROM po_lines pl WHERE pl.po_id = po.id) AS line_count,
         (SELECT GROUP_CONCAT(DISTINCT o.number) FROM po_lines pl JOIN orders o ON o.id = pl.order_id WHERE pl.po_id = po.id) AS order_numbers
         FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
        ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
        ORDER BY CASE po.status WHEN 'draft' THEN 0 WHEN 'sent' THEN 1 WHEN 'partial' THEN 2 ELSE 3 END, po.id DESC
        LIMIT ?`, ...params, Math.min(int(query.limit, 300), 2000));
  });

  r.post('/pos', ({ db, body, user }) => {
    const vendor = must(db.get('SELECT * FROM vendors WHERE id = ?', int(body.vendor_id)), 'Vendor');
    const now = nowIso();
    const number = `PO-${nextNumber(db, 'po')}`;
    const id = db.run(
      "INSERT INTO purchase_orders (number, vendor_id, status, expected_date, notes, created_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)",
      number, vendor.id, isDate(body.expected_date) ? body.expected_date : null, str(body.notes, 2000), user.id, now, now).lastInsertRowid;
    if (Array.isArray(body.lines)) {
      const po = db.get('SELECT * FROM purchase_orders WHERE id = ?', id);
      for (const l of body.lines) addPoLine(db, po, l);
      poTotal(db, id);
    }
    return poDetail(db, id);
  });

  r.get('/pos/:id', ({ db, params }) => poDetail(db, params.id));

  r.put('/pos/:id', ({ db, params, body }) => {
    const po = must(db.get('SELECT * FROM purchase_orders WHERE id = ?', params.id), 'Purchase order');
    if ('expected_date' in body) db.run('UPDATE purchase_orders SET expected_date = ? WHERE id = ?', isDate(body.expected_date) ? body.expected_date : null, po.id);
    if ('notes' in body) db.run('UPDATE purchase_orders SET notes = ? WHERE id = ?', str(body.notes, 2000), po.id);
    if ('vendor_id' in body && int(body.vendor_id) !== po.vendor_id) {
      if (po.status !== 'draft') bad('Only draft purchase orders can change vendor.');
      must(db.get('SELECT id FROM vendors WHERE id = ?', int(body.vendor_id)), 'Vendor');
      db.run('UPDATE purchase_orders SET vendor_id = ? WHERE id = ?', int(body.vendor_id), po.id);
    }
    db.run('UPDATE purchase_orders SET updated_at = ? WHERE id = ?', nowIso(), po.id);
    return poDetail(db, po.id);
  });

  r.del('/pos/:id', ({ db, params, user }) => {
    const po = must(db.get('SELECT * FROM purchase_orders WHERE id = ?', params.id), 'Purchase order');
    if (po.status !== 'draft') bad('Only draft purchase orders can be deleted. Cancel it instead.');
    const linked = db.all('SELECT order_line_id FROM po_lines WHERE po_id = ?', po.id).map((x) => x.order_line_id);
    db.run('DELETE FROM po_lines WHERE po_id = ?', po.id);
    db.run("DELETE FROM notes WHERE entity_type = 'po' AND entity_id = ?", po.id);
    db.run('DELETE FROM purchase_orders WHERE id = ?', po.id);
    resyncOrderLines(db, user, linked);
    return { ok: true };
  });

  r.post('/pos/:id/lines', ({ db, params, body }) => {
    const po = must(db.get('SELECT * FROM purchase_orders WHERE id = ?', params.id), 'Purchase order');
    assertDraftish(po);
    addPoLine(db, po, body);
    poTotal(db, po.id);
    return poDetail(db, po.id);
  });

  r.put('/po-lines/:id', ({ db, params, body }) => {
    const pl = must(db.get('SELECT * FROM po_lines WHERE id = ?', params.id), 'Line');
    const po = db.get('SELECT * FROM purchase_orders WHERE id = ?', pl.po_id);
    assertDraftish(po);
    const qty = 'qty' in body ? round4(num(body.qty)) : pl.qty;
    if (qty <= 0) bad('Enter a quantity.');
    const cost = 'cost' in body ? round4(num(body.cost)) : pl.cost;
    db.run('UPDATE po_lines SET qty = ?, cost = ?, total = ?, description = ?, notes = ? WHERE id = ?',
      qty, cost, round2(qty * cost), str(body.description, 300) || pl.description, 'notes' in body ? str(body.notes, 500) : pl.notes, pl.id);
    poTotal(db, po.id);
    return poDetail(db, po.id);
  });

  r.del('/po-lines/:id', ({ db, params, user }) => {
    const pl = must(db.get('SELECT * FROM po_lines WHERE id = ?', params.id), 'Line');
    const po = db.get('SELECT * FROM purchase_orders WHERE id = ?', pl.po_id);
    assertDraftish(po);
    if (pl.received_qty > 0) bad('Part of this line was received, so it can’t be removed.');
    db.run('DELETE FROM po_lines WHERE id = ?', pl.id);
    poTotal(db, po.id);
    resyncOrderLines(db, user, [pl.order_line_id]);
    return poDetail(db, po.id);
  });

  r.post('/pos/:id/status', ({ db, params, body, user }) => {
    const po = must(db.get('SELECT * FROM purchase_orders WHERE id = ?', params.id), 'Purchase order');
    const status = body.status;
    if (!['draft', 'sent', 'cancelled'].includes(status)) bad('Unknown status.');
    if (po.status === 'received') bad('This purchase order is fully received.');
    if (po.status === 'cancelled') bad('This purchase order is cancelled. Start a new one instead.');
    if (po.status === 'partial' && status !== 'cancelled') bad('Part of this order is already in. Receive the rest when it arrives.');
    if (status === 'sent' && !db.get('SELECT COUNT(*) AS n FROM po_lines WHERE po_id = ?', po.id).n) bad('Add items before sending.');
    if (status === 'cancelled') {
      if (db.get('SELECT COUNT(*) AS n FROM po_lines WHERE po_id = ? AND received_qty > 0', po.id).n) bad('Part of this order was received, so it can’t be cancelled.');
    }
    db.run('UPDATE purchase_orders SET status = ?, sent_at = CASE WHEN ? = \'sent\' THEN COALESCE(sent_at, ?) ELSE sent_at END, updated_at = ? WHERE id = ?',
      status, status, nowIso(), nowIso(), po.id);
    if (status === 'cancelled') resyncOrderLines(db, user, db.all('SELECT order_line_id FROM po_lines WHERE po_id = ?', po.id).map((x) => x.order_line_id));
    return poDetail(db, po.id);
  });

  // Receive material. Creates inventory; anything bought for a customer order is pulled for it right away.
  r.post('/pos/:id/receive', ({ db, params, body, user }) => {
    const po = must(db.get('SELECT * FROM purchase_orders WHERE id = ?', params.id), 'Purchase order');
    if (['received', 'cancelled'].includes(po.status)) bad(`This purchase order is already ${po.status}.`);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) bad('Enter what arrived.');
    const settings = getSettings(db);
    const remnantMax = num(settings.remnant_max_ft, 20);
    const now = nowIso();
    const today = isDate(body.date) ? body.date : localDate();
    const ordersTouched = new Set();
    let count = 0;
    for (const item of items) {
      const pl = db.get('SELECT * FROM po_lines WHERE id = ? AND po_id = ?', int(item.po_line_id), po.id);
      if (!pl) bad('That line isn’t on this purchase order.');
      const product = pl.product_id ? db.get('SELECT * FROM products WHERE id = ?', pl.product_id) : null;
      if (!product || product.stock_type === 'none') {
        const q = num(item.qty);
        if (q > 0) { db.run('UPDATE po_lines SET received_qty = received_qty + ? WHERE id = ?', q, pl.id); count += 1; }
        continue;
      }
      let stockQty;
      let received;
      let width = null;
      let length = null;
      if (product.stock_type === 'roll') {
        length = parseFeet(item.length_ft);
        if (!length) continue;
        width = parseFeet(item.width_ft) || product.roll_width_ft || 12;
        stockQty = length;
        received = stockToSale(product, length, width);
      } else {
        const q = num(item.qty);
        if (!(q > 0)) continue;
        received = q; // in the PO line's unit
        stockQty = product.stock_type === 'box' && pl.unit !== 'BOX' ? saleToStock(product, q) : q;
      }
      const unitCost = pl.unit === 'BOX' && product.coverage_per_box > 0 && product.unit !== 'BOX' ? pl.cost / product.coverage_per_box : pl.cost;
      const invId = db.run(
        `INSERT INTO inventory (product_id, kind, tag, dye_lot, location, width_ft, length_ft, qty, unit_cost, is_remnant, po_id, received_at, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        product.id, product.stock_type, str(item.tag, 60), str(item.dye_lot, 60), str(item.location, 60),
        width, length, round4(stockQty), round4(unitCost), po.id, today, str(item.notes, 300), now, now).lastInsertRowid;
      db.run("INSERT INTO inventory_tx (inventory_id, type, qty, note, user_id, created_at) VALUES (?, 'receive', ?, ?, ?, ?)",
        invId, round4(stockQty), `Received on ${po.number}`, user.id, now);
      db.run('UPDATE po_lines SET received_qty = received_qty + ? WHERE id = ?', round4(received), pl.id);
      count += 1;

      // Special order: pull it for the customer's order.
      const line = pl.order_line_id ? db.get("SELECT * FROM lines WHERE id = ? AND doc_type = 'order'", pl.order_line_id) : null;
      const order = line ? db.get('SELECT * FROM orders WHERE id = ?', line.doc_id) : null;
      let take = 0;
      if (line && order && order.stage !== 'cancelled') {
        const neededStock = saleToStock(product, line.qty, width);
        const already = db.all("SELECT type, qty FROM inventory_tx WHERE line_id = ? AND type IN ('cut','pull','return')", line.id)
          .reduce((s, t) => s + (t.type === 'return' ? -Math.abs(t.qty) : Math.abs(t.qty)), 0);
        const remaining = neededStock - already;
        take = remaining > 0 ? Math.min(stockQty, remaining) : 0;
        if (product.stock_type === 'roll' && take > 0 && stockQty - take < 1) take = stockQty; // trim allowance, not a remnant
        take = round4(take);
      }
      if (line && order && order.stage !== 'cancelled' && take > 0) {
        db.run(`INSERT INTO inventory_tx (inventory_id, type, qty, order_id, line_id, note, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          invId, product.stock_type === 'roll' ? 'cut' : 'pull', -take, order.id, line.id, `For ${order.number}`, user.id, now);
        const left = round4(stockQty - take);
        db.run('UPDATE inventory SET qty = ?, is_remnant = ? WHERE id = ?', left,
          product.stock_type === 'roll' && left > 0 && left <= remnantMax ? 1 : 0, invId);
        ordersTouched.add(order.id);
      }
    }
    if (!count) bad('Enter a quantity or length for at least one line.');
    const open = db.all('SELECT qty, received_qty FROM po_lines WHERE po_id = ?', po.id).some((l) => l.received_qty < l.qty - 0.01);
    db.run('UPDATE purchase_orders SET status = ?, received_at = CASE WHEN ? THEN NULL ELSE ? END, updated_at = ? WHERE id = ?',
      open ? 'partial' : 'received', open ? 1 : 0, today, now, po.id);
    // Re-check every order item this PO feeds, including ones that only got part of what they need.
    for (const pl of db.all('SELECT order_line_id FROM po_lines WHERE po_id = ? AND order_line_id IS NOT NULL', po.id)) {
      const l = db.get("SELECT id, doc_id FROM lines WHERE id = ? AND doc_type = 'order'", pl.order_line_id);
      if (l) { syncLineMaterial(db, l.id); ordersTouched.add(l.doc_id); }
    }
    for (const oid of ordersTouched) refreshMaterialStage(db, user, oid);
    return poDetail(db, po.id);
  });
}
