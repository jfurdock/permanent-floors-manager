import { bad, str, int, num, nowIso, round2, round4, localDate, addDays, isDate, customerName, forbidden } from '../util.js';
import { PAYMENT_METHODS, productName, saleToStock, stockToSale } from '../calc.js';
import {
  must, updateFields, recalcDoc, nextNumber, getLines, getRooms, userName, refreshMaterialStage, syncLineMaterial, liveAllocations, lineCoverage, MANAGERS, EVERYONE,
} from './shared.js';

const ORDER_FIELDS = {
  title: (v) => str(v, 160),
  job_address: (v) => str(v, 160), job_city: (v) => str(v, 80), job_state: (v) => str(v, 20), job_zip: (v) => str(v, 20),
  customer_po: (v) => str(v, 60),
  notes: (v) => str(v, 4000), internal_notes: (v) => str(v, 4000), install_notes: (v) => str(v, 4000),
  sales_rep_id: (v) => int(v),
};
const MONEY_FIELDS = {
  discount: (v) => Math.max(0, round2(num(v))),
  tax_rate: (v) => Math.max(0, num(v)),
};

// Shared checks for discount and tax edits.
export function checkMoney(body, subtotal) {
  if ('discount' in body) {
    const d = num(body.discount, NaN);
    if (!Number.isFinite(d) || d < 0) bad('Enter the discount as a dollar amount.');
    if (d > round2(subtotal) + 0.004) bad(`The discount can’t be more than the ${round2(subtotal).toFixed(2)} subtotal.`);
  }
  if ('tax_rate' in body) {
    const t = num(body.tax_rate, NaN);
    if (!Number.isFinite(t) || t < 0 || t > 25) bad('Enter a sales tax rate between 0 and 25 percent.');
  }
}

export function lineMaterial(db, lines) {
  for (const l of lines) {
    const txs = db.all(
      `SELECT t.id, t.type, t.qty, t.ref_id, t.created_at, i.id AS inventory_id, i.tag, i.dye_lot, i.location, i.width_ft, i.kind
         FROM inventory_tx t JOIN inventory i ON i.id = t.inventory_id
        WHERE t.line_id = ? AND t.type IN ('cut','pull','return') ORDER BY t.id`, l.id);
    const returned = new Set(txs.filter((t) => t.type === 'return').map((t) => t.ref_id));
    // Only material that is still pulled for this item (returns cancel the pull they reference).
    l.allocations = txs.filter((t) => t.type !== 'return' && !returned.has(t.id));
    l.po_lines = db.all(
      `SELECT pl.id, pl.qty, pl.unit, pl.received_qty, po.id AS po_id, po.number AS po_number, po.status AS po_status, po.expected_date
         FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id WHERE pl.order_line_id = ?`, l.id);
    let allocated = 0;
    for (const a of l.allocations) allocated += stockToSale(l, Math.abs(a.qty), a.width_ft);
    l.allocated_qty = round2(allocated);
    l.stock_needed = l.stock_type && l.stock_type !== 'none' ? saleToStock(l, l.qty) : null;
  }
  return lines;
}

export function orderDetail(db, id) {
  const o = must(db.get('SELECT * FROM orders WHERE id = ?', id), 'Order');
  const customer = db.get('SELECT * FROM customers WHERE id = ?', o.customer_id);
  const lines = lineMaterial(db, getLines(db, 'order', id));
  const payments = db.all('SELECT p.*, u.name AS user_name FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.order_id = ? ORDER BY p.date, p.id', id);
  const appointments = db.all(
    `SELECT a.*, i.name AS installer_name, i.color AS installer_color FROM appointments a
       LEFT JOIN installers i ON i.id = a.installer_id WHERE a.order_id = ? ORDER BY a.date, a.start_time`, id);
  const pos = db.all(
    `SELECT DISTINCT po.id, po.number, po.status, po.expected_date, v.name AS vendor_name FROM po_lines pl
       JOIN purchase_orders po ON po.id = pl.po_id JOIN vendors v ON v.id = po.vendor_id WHERE pl.order_id = ? ORDER BY po.id`, id);
  const notes = db.all(
    `SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.entity_type = 'order' AND n.entity_id = ? ORDER BY n.id DESC`, id);
  const activity = db.all(
    `SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'order' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 40`, id);
  const quote = o.quote_id ? db.get('SELECT id, number, signed_name, signed_at, signature FROM quotes WHERE id = ?', o.quote_id) : null;
  return {
    ...o,
    balance: round2(o.total - o.paid_total),
    customer: customer ? { ...customer, display_name: customerName(customer) } : null,
    sales_rep_name: userName(db, o.sales_rep_id),
    lines, rooms: getRooms(db, 'order', id), payments, appointments, pos, note_items: notes, activity, quote,
  };
}

export function register(r) {
  r.get('/orders', ({ db, query }) => {
    const conds = [];
    const params = [];
    if (query.stage === 'open') conds.push("o.stage NOT IN ('paid','cancelled')");
    else if (query.stage === 'balance') conds.push("o.invoiced_at IS NOT NULL AND o.stage != 'cancelled' AND o.total - o.paid_total > 0.004");
    else if (query.stage) { conds.push('o.stage = ?'); params.push(query.stage); }
    if (query.rep) { conds.push('o.sales_rep_id = ?'); params.push(int(query.rep)); }
    if (query.customer_id) { conds.push('o.customer_id = ?'); params.push(int(query.customer_id)); }
    for (const t of String(query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 4)) {
      const like = `%${t}%`;
      conds.push('(o.number LIKE ? OR o.title LIKE ? OR o.customer_po LIKE ? OR o.invoice_number LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company LIKE ?)');
      params.push(like, like, like, like, like, like, like);
    }
    const rows = db.all(
      `SELECT o.id, o.number, o.stage, o.order_date, o.title, o.total, o.paid_total, o.invoice_number, o.invoiced_at, o.due_date, o.created_at, o.updated_at,
              o.sales_rep_id, u.name AS sales_rep_name, o.job_city,
              c.id AS customer_id, c.first_name, c.last_name, c.company, c.phone,
              (SELECT MIN(a.date) FROM appointments a WHERE a.order_id = o.id AND a.type = 'install' AND a.status NOT IN ('cancelled')) AS install_date,
              (SELECT COUNT(*) FROM lines l WHERE l.doc_type = 'order' AND l.doc_id = o.id AND l.material_status IN ('needed','ordered')) AS waiting_lines
         FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.sales_rep_id
        ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
        ORDER BY o.id DESC LIMIT ?`, ...params, Math.min(int(query.limit, 300), 2000));
    return rows.map((x) => ({ ...x, customer_name: customerName(x), balance: round2(x.total - x.paid_total) }));
  });

  r.post('/orders', ({ db, body, user, settings, log }) => {
    const customer = must(db.get('SELECT * FROM customers WHERE id = ?', int(body.customer_id)), 'Customer');
    const s = settings();
    const now = nowIso();
    const number = `SO-${nextNumber(db, 'order')}`;
    const id = db.run(
      `INSERT INTO orders (number, customer_id, sales_rep_id, stage, order_date, title, job_address, job_city, job_state, job_zip, tax_rate, created_at, updated_at)
       VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      number, customer.id, int(body.sales_rep_id) || customer.sales_rep_id || user.id, localDate(), str(body.title, 160),
      customer.address, customer.city, customer.state, customer.zip, num(s.tax_rate, 0), now, now,
    ).lastInsertRowid;
    db.run('UPDATE customers SET updated_at = ? WHERE id = ?', now, customer.id);
    log('order', id, 'created');
    return orderDetail(db, id);
  });

  r.get('/orders/:id', ({ db, params }) => orderDetail(db, params.id));

  r.put('/orders/:id', ({ db, params, body }) => {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', params.id), 'Order');
    updateFields(db, 'orders', o.id, body, ORDER_FIELDS);
    if (('discount' in body || 'tax_rate' in body)) {
      if (o.stage === 'cancelled') bad('This order is cancelled.');
      if (o.invoiced_at) bad('This order is invoiced. Reopen the invoice to change the discount or tax.');
      checkMoney(body, o.subtotal);
      updateFields(db, 'orders', o.id, body, MONEY_FIELDS);
    }
    recalcDoc(db, 'order', o.id);
    return orderDetail(db, o.id);
  });

  r.post('/orders/:id/stage', ({ db, params, body, log }) => {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', params.id), 'Order');
    const stage = body.stage;
    if (!['new', 'ordered', 'ready', 'scheduled', 'installed'].includes(stage)) bad('Choose a stage. Invoicing and payments set the last stages for you.');
    if (o.invoiced_at) bad('This order is invoiced. Reopen the invoice first.');
    db.run('UPDATE orders SET stage = ?, cancelled_at = NULL, updated_at = ? WHERE id = ?', stage, nowIso(), o.id);
    log('order', o.id, 'stage', stage);
    return orderDetail(db, o.id);
  });

  r.post('/orders/:id/cancel', ({ db, params, body, log }) => {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', params.id), 'Order');
    if (o.invoiced_at) bad('This order is invoiced. Reopen the invoice before cancelling.');
    if (round2(o.paid_total) !== 0) bad('This order has payments. Record a refund so the payments add up to $0, then cancel.');
    const pulled = db.get(
      `SELECT COALESCE(SUM(CASE WHEN t.type = 'return' THEN -1 ELSE 1 END), 0) AS n FROM inventory_tx t
        WHERE t.order_id = ? AND t.type IN ('cut','pull','return')`, o.id).n;
    if (pulled > 0) bad('Material is pulled for this order. Return it to stock first.');
    // Material on purchase orders: drop it from drafts; sent ones must be cancelled with the vendor first.
    const onPos = db.all(
      `SELECT pl.id, pl.po_id, pl.received_qty, po.number, po.status FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
        WHERE pl.order_id = ? AND po.status IN ('draft','sent','partial')`, o.id);
    const sent = onPos.filter((p) => p.status !== 'draft');
    if (sent.length) {
      bad(`Material for this order is on ${[...new Set(sent.map((p) => p.number))].join(', ')}, which was already sent. Cancel it with the vendor and remove it from the purchase order first.`);
    }
    for (const p of onPos) {
      db.run('DELETE FROM po_lines WHERE id = ?', p.id);
      db.run('UPDATE purchase_orders SET total = (SELECT COALESCE(SUM(total), 0) FROM po_lines WHERE po_id = ?), updated_at = ? WHERE id = ?', p.po_id, nowIso(), p.po_id);
    }
    db.run("UPDATE orders SET stage = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), o.id);
    db.run("UPDATE appointments SET status = 'cancelled' WHERE order_id = ? AND status NOT IN ('done')", o.id);
    log('order', o.id, 'cancelled', str(body.reason, 300));
    return orderDetail(db, o.id);
  });

  r.post('/orders/:id/invoice', ({ db, params, body, settings, log }) => {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', params.id), 'Order');
    if (o.stage === 'cancelled') bad('This order is cancelled.');
    if (o.invoiced_at) bad('This order is already invoiced.');
    const n = db.get("SELECT COUNT(*) AS n FROM lines WHERE doc_type = 'order' AND doc_id = ?", o.id).n;
    if (!n) bad('Add items before invoicing.');
    const date = isDate(body.date) ? body.date : localDate();
    const due = addDays(date, int(settings().invoice_due_days, 0));
    db.run('UPDATE orders SET invoice_number = ?, invoiced_at = ?, due_date = ?, updated_at = ? WHERE id = ?',
      o.number.replace(/^SO-/, 'INV-'), date, due, nowIso(), o.id);
    db.run("UPDATE orders SET stage = 'invoiced' WHERE id = ?", o.id);
    log('order', o.id, 'invoiced');
    recalcDoc(db, 'order', o.id);
    return orderDetail(db, o.id);
  });

  r.post('/orders/:id/reopen', ({ db, params, log }) => {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', params.id), 'Order');
    if (!o.invoiced_at) bad('This order isn’t invoiced.');
    db.run("UPDATE orders SET invoiced_at = NULL, due_date = NULL, closed_at = NULL, stage = 'installed', updated_at = ? WHERE id = ?", nowIso(), o.id);
    log('order', o.id, 'reopened');
    return orderDetail(db, o.id);
  }, { roles: MANAGERS });

  // ---------- payments ----------
  r.post('/orders/:id/payments', ({ db, params, body, user, log }) => {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', params.id), 'Order');
    if (o.stage === 'cancelled') bad('This order is cancelled.');
    const amount = round2(num(body.amount));
    if (!amount) bad('Enter the payment amount.');
    if (Math.abs(amount) > 10000000) bad('That amount is too large. Check the number and try again.');
    if (amount < 0 && !MANAGERS.includes(user.role)) bad('Ask a manager to record refunds.');
    const balance = round2(o.total - o.paid_total);
    if (amount > 0 && amount > balance + 0.004) {
      bad(balance > 0 ? `That’s more than the ${balance.toFixed(2)} balance. Enter ${balance.toFixed(2)} or less.` : 'This order is already paid in full.');
    }
    if (amount < 0 && -amount > o.paid_total + 0.004) bad(`You can refund up to ${o.paid_total.toFixed(2)}, the amount paid so far.`);
    const method = PAYMENT_METHODS.some((m) => m.id === body.method) ? body.method : 'card';
    const date = isDate(body.date) ? body.date : localDate();
    const recent = db.get(
      `SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND amount = ? AND method = ? AND date = ?
         AND COALESCE(reference, '') = ? AND created_at > ?`,
      o.id, amount, method, date, str(body.reference, 80) || '', new Date(Date.now() - 15000).toISOString()).n;
    if (recent) bad('This payment was just recorded. Check the payments list before adding it again.');
    db.run('INSERT INTO payments (order_id, date, amount, method, reference, note, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      o.id, date, amount, method, str(body.reference, 80), str(body.note, 300), user.id, nowIso());
    log('order', o.id, amount < 0 ? 'refund' : 'payment', `${amount.toFixed(2)} ${method}`);
    recalcDoc(db, 'order', o.id);
    return orderDetail(db, o.id);
  });

  r.del('/payments/:id', ({ db, params, log }) => {
    const p = must(db.get('SELECT * FROM payments WHERE id = ?', params.id), 'Payment');
    db.run('DELETE FROM payments WHERE id = ?', p.id);
    log('order', p.order_id, 'payment deleted', `${p.amount.toFixed(2)} ${p.method}`);
    recalcDoc(db, 'order', p.order_id);
    return orderDetail(db, p.order_id);
  }, { roles: MANAGERS });

  r.get('/payments', ({ db, query }) => {
    const from = isDate(query.from) ? query.from : localDate();
    const to = isDate(query.to) ? query.to : from;
    const rows = db.all(
      `SELECT p.*, o.number AS order_number, o.id AS order_id, c.first_name, c.last_name, c.company, u.name AS user_name
         FROM payments p JOIN orders o ON o.id = p.order_id JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = p.user_id
        WHERE p.date BETWEEN ? AND ? ORDER BY p.date DESC, p.id DESC`, from, to);
    const byMethod = {};
    for (const p of rows) byMethod[p.method] = round2((byMethod[p.method] || 0) + p.amount);
    return {
      from, to,
      payments: rows.map((p) => ({ ...p, customer_name: customerName(p) })),
      by_method: byMethod,
      total: round2(rows.reduce((s, p) => s + p.amount, 0)),
    };
  });

  // ---------- material ----------
  // Put every line that still needs material onto a draft PO for its vendor.
  r.post('/orders/:id/order-material', ({ db, params, body, user, log }) => {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', params.id), 'Order');
    if (o.stage === 'cancelled') bad('This order is cancelled.');
    const lines = getLines(db, 'order', o.id).filter((l) => l.material_status === 'needed');
    const lineIds = Array.isArray(body.line_ids) && body.line_ids.length ? body.line_ids.map(Number) : null;
    const todo = lineIds ? lines.filter((l) => lineIds.includes(l.id)) : lines;
    if (!todo.length) bad('Nothing on this order needs to be ordered.');
    const noVendor = todo.filter((l) => !l.vendor_id);
    const byVendor = {};
    for (const l of todo.filter((x) => x.vendor_id)) (byVendor[l.vendor_id] ||= []).push(l);
    const touched = [];
    const now = nowIso();
    for (const [vendorId, vlines] of Object.entries(byVendor)) {
      let po = db.get("SELECT * FROM purchase_orders WHERE vendor_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1", vendorId);
      if (!po) {
        const number = `PO-${nextNumber(db, 'po')}`;
        const pid = db.run("INSERT INTO purchase_orders (number, vendor_id, status, created_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?)",
          number, vendorId, user.id, now, now).lastInsertRowid;
        po = db.get('SELECT * FROM purchase_orders WHERE id = ?', pid);
      }
      for (const l of vlines) {
        const cov = lineCoverage(db, l);
        let qty = round4(Math.max(0, l.qty - cov.allocated));
        if (qty <= 0) continue;
        let unit = l.unit;
        let cost = l.cost;
        let note = null;
        if (l.stock_type === 'box' && l.coverage_per_box > 0 && l.unit !== 'BOX') {
          qty = Math.ceil(qty / l.coverage_per_box - 1e-9);
          unit = 'BOX';
          cost = round4(l.cost * l.coverage_per_box);
        } else if (l.stock_type === 'roll') {
          const ft = saleToStock(l, qty);
          const w = l.roll_width_ft || 12;
          const whole = Math.floor(ft + 1e-9);
          const inch = Math.round((ft - whole) * 12);
          note = `Cut ${w}' x ${whole}'${inch ? ` ${inch}"` : ''}`;
        }
        db.run(
          `INSERT INTO po_lines (po_id, product_id, description, unit, qty, cost, total, order_id, order_line_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          po.id, l.product_id, l.description || productName(l), unit, round4(qty), cost, round2(qty * cost), o.id, l.id,
          [note, `For ${o.number}`].filter(Boolean).join(' — '));
        db.run("UPDATE lines SET material_status = 'ordered' WHERE id = ?", l.id);
      }
      db.run('UPDATE purchase_orders SET total = (SELECT COALESCE(SUM(total), 0) FROM po_lines WHERE po_id = ?), updated_at = ? WHERE id = ?', po.id, now, po.id);
      touched.push(po.id);
    }
    refreshMaterialStage(db, user, o.id);
    if (touched.length) log('order', o.id, 'material ordered', `${touched.length} purchase order(s)`);
    return {
      po_ids: touched,
      missing_vendor: noVendor.map((l) => l.description),
      order: orderDetail(db, o.id),
    };
  });

  // Mark a line as not needing material handling (e.g. customer supplied) or back to needed.
  r.post('/lines/:id/material-status', ({ db, params, body, user }) => {
    const l = must(db.get("SELECT * FROM lines WHERE id = ? AND doc_type = 'order'", params.id), 'Item');
    const o = db.get('SELECT stage FROM orders WHERE id = ?', l.doc_id);
    if (o.stage === 'cancelled') bad('This order is cancelled.');
    const status = body.status;
    if (!['needed', 'none'].includes(status)) bad('Unknown material status.');
    if (status === 'none') {
      if (liveAllocations(db, l.id).length) bad('Material is pulled for this item. Return it to stock first.');
      const open = db.get(
        `SELECT COUNT(*) AS n FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
          WHERE pl.order_line_id = ? AND po.status IN ('draft','sent','partial')`, l.id).n;
      if (open) bad('This item is on a purchase order. Remove it from the purchase order first.');
      db.run("UPDATE lines SET material_status = 'none' WHERE id = ?", l.id);
    } else {
      db.run("UPDATE lines SET material_status = 'needed' WHERE id = ?", l.id);
      syncLineMaterial(db, l.id);
    }
    refreshMaterialStage(db, user, l.doc_id);
    return orderDetail(db, l.doc_id);
  });

  // Work order for installers: everything they need, no prices.
  r.get('/orders/:id/workorder', ({ db, params, user }) => {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', params.id), 'Order');
    if (user.role === 'installer') {
      const assigned = db.get("SELECT COUNT(*) AS n FROM appointments WHERE order_id = ? AND installer_id = ? AND status != 'cancelled'", o.id, user.installer_id || -1).n;
      if (!assigned) forbidden('This job isn’t assigned to you.');
    }
    const customer = db.get('SELECT * FROM customers WHERE id = ?', o.customer_id);
    const lines = lineMaterial(db, getLines(db, 'order', o.id)).map((l) => ({
      id: l.id, kind: l.kind, description: l.description, area: l.area, qty: l.qty, unit: l.unit, notes: l.notes,
      material_status: l.material_status, allocations: l.allocations, category: l.category,
    }));
    const appointments = db.all(
      `SELECT a.*, i.name AS installer_name FROM appointments a LEFT JOIN installers i ON i.id = a.installer_id
        WHERE a.order_id = ? AND a.status != 'cancelled' ORDER BY a.date`, o.id);
    return {
      id: o.id, number: o.number, title: o.title, stage: o.stage,
      job_address: o.job_address, job_city: o.job_city, job_state: o.job_state, job_zip: o.job_zip,
      install_notes: o.install_notes, notes: o.notes,
      customer: customer ? { display_name: customerName(customer), phone: customer.phone, phone2: customer.phone2, email: customer.email } : null,
      lines, rooms: getRooms(db, 'order', o.id), appointments,
      balance: user.role === 'installer' ? undefined : round2(o.total - o.paid_total),
    };
  }, { roles: EVERYONE });
}
