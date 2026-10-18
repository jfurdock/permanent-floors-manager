import { round2, nowIso, notFound, localDate } from '../util.js';
import { ORDER_STAGE_INDEX, stockToSale } from '../calc.js';

export const STAFF = ['admin', 'manager', 'sales', 'warehouse'];
export const MANAGERS = ['admin', 'manager'];
export const EVERYONE = ['admin', 'manager', 'sales', 'warehouse', 'installer'];

export function getSettings(db) {
  const out = {};
  for (const row of db.all('SELECT key, value FROM settings')) out[row.key] = row.value;
  return out;
}

export function nextNumber(db, name) {
  const row = db.get('SELECT value FROM counters WHERE name = ?', name);
  const value = row ? Number(row.value) : 1;
  db.run('INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', name, value + 1);
  return value;
}

export function log(db, user, entityType, entityId, action, detail = null) {
  db.run(
    'INSERT INTO activity (entity_type, entity_id, action, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    entityType, entityId, action, detail, user?.id ?? null, nowIso(),
  );
}

export function must(row, what) {
  if (!row) notFound(what);
  return row;
}

// Build and run an UPDATE from a whitelist of fields present in body.
export function updateFields(db, table, id, body, fields) {
  const sets = [];
  const vals = [];
  for (const [key, clean] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      sets.push(`${key} = ?`);
      vals.push(clean(body[key]));
    }
  }
  if (!sets.length) return 0;
  const hasUpdated = db.all(`PRAGMA table_info(${table})`).some((c) => c.name === 'updated_at');
  if (hasUpdated) { sets.push('updated_at = ?'); vals.push(nowIso()); }
  vals.push(id);
  return db.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, ...vals).changes;
}

const DOC_TABLE = { quote: 'quotes', order: 'orders' };
export const docTable = (type) => DOC_TABLE[type];

// Recompute totals for a quote or order from its lines (and payments for orders).
export function recalcDoc(db, type, id) {
  const table = docTable(type);
  const doc = db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!doc) return null;
  const lines = db.all('SELECT qty, price, cost, taxable FROM lines WHERE doc_type = ? AND doc_id = ?', type, id);
  let subtotal = 0;
  let taxable = 0;
  let cost = 0;
  for (const l of lines) {
    const t = round2(l.qty * l.price);
    subtotal += t;
    if (l.taxable) taxable += t;
    cost += (Number(l.qty) || 0) * (Number(l.cost) || 0);
  }
  subtotal = round2(subtotal);
  // A discount can never be more than the items it comes off.
  const discount = Math.max(0, Math.min(round2(doc.discount || 0), Math.max(0, subtotal)));
  const taxableAfter = subtotal > 0 ? taxable * (1 - discount / subtotal) : 0;
  const tax = round2(taxableAfter * (Number(doc.tax_rate) || 0) / 100);
  const total = round2(subtotal - discount + tax);
  db.run(`UPDATE ${table} SET subtotal = ?, discount = ?, tax = ?, total = ?, cost_total = ?, updated_at = ? WHERE id = ?`,
    subtotal, discount, tax, total, round2(cost), nowIso(), id);
  if (type === 'order') {
    const paid = round2(db.get('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE order_id = ?', id).s);
    db.run('UPDATE orders SET paid_total = ? WHERE id = ?', paid, id);
    const fresh = db.get('SELECT * FROM orders WHERE id = ?', id);
    if (fresh.invoiced_at && fresh.stage !== 'cancelled') {
      if (round2(fresh.total - paid) <= 0 && fresh.stage !== 'paid') {
        db.run("UPDATE orders SET stage = 'paid', closed_at = ? WHERE id = ?", nowIso(), id);
      } else if (round2(fresh.total - paid) > 0 && fresh.stage === 'paid') {
        db.run("UPDATE orders SET stage = 'invoiced', closed_at = NULL WHERE id = ?", id);
      }
    }
  }
  return db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
}

// Move an order forward to `stage` if it is currently behind it. Never moves backward.
export function advanceStage(db, user, orderId, stage) {
  const o = db.get('SELECT id, stage FROM orders WHERE id = ?', orderId);
  if (!o || o.stage === 'cancelled') return false;
  if ((ORDER_STAGE_INDEX[o.stage] ?? 0) >= ORDER_STAGE_INDEX[stage]) return false;
  db.run('UPDATE orders SET stage = ?, updated_at = ? WHERE id = ?', stage, nowIso(), orderId);
  log(db, user, 'order', orderId, 'stage', stage);
  return true;
}

// Material pulled for an order line that hasn't been returned to stock.
export function liveAllocations(db, lineId) {
  const txs = db.all(
    `SELECT t.id, t.type, t.qty, t.ref_id, t.inventory_id, i.width_ft
       FROM inventory_tx t JOIN inventory i ON i.id = t.inventory_id
      WHERE t.line_id = ? AND t.type IN ('cut','pull','return') ORDER BY t.id`, lineId);
  const returned = new Set(txs.filter((t) => t.type === 'return').map((t) => t.ref_id));
  return txs.filter((t) => t.type !== 'return' && !returned.has(t.id));
}

// How much of an order line's material is in hand, in the line's own unit.
export function lineCoverage(db, line) {
  const product = line.product_id ? db.get('SELECT * FROM products WHERE id = ?', line.product_id) : null;
  if (!product || product.stock_type === 'none') return { product, needed: 0, allocated: 0 };
  let allocated = 0;
  for (const a of liveAllocations(db, line.id)) allocated += stockToSale(product, Math.abs(a.qty), a.width_ft);
  // Convert to the line's unit if it was changed between square yards and square feet.
  if (line.unit === 'SF' && product.unit === 'SY') allocated *= 9;
  else if (line.unit === 'SY' && product.unit === 'SF') allocated /= 9;
  return { product, needed: Number(line.qty) || 0, allocated };
}

// Is the line's material in (enough pulled), on order, or still needed?
// Rolls are cut to the inch, so a few percent short still counts as in.
export function syncLineMaterial(db, lineId) {
  const line = db.get("SELECT * FROM lines WHERE id = ? AND doc_type = 'order'", lineId);
  if (!line || line.material_status === 'none') return null;
  const { product, needed, allocated } = lineCoverage(db, line);
  let status;
  if (!product || product.stock_type === 'none') status = 'none';
  else if (needed > 0 && allocated >= needed * 0.97 - 0.01) status = 'received';
  else {
    const onOrder = db.get(
      `SELECT COUNT(*) AS n FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
        WHERE pl.order_line_id = ? AND po.status IN ('draft','sent','partial') AND pl.received_qty < pl.qty - 0.001`, line.id).n;
    status = onOrder ? 'ordered' : 'needed';
  }
  if (status !== line.material_status) db.run('UPDATE lines SET material_status = ? WHERE id = ?', status, line.id);
  return status;
}

// Keep the early stages in step with the material: New -> Material ordered -> Ready to schedule.
// Moves both ways, but never touches an order that is scheduled or later.
export function refreshMaterialStage(db, user, orderId) {
  const o = db.get('SELECT id, stage FROM orders WHERE id = ?', orderId);
  if (!o || !['new', 'ordered', 'ready'].includes(o.stage)) return;
  const rows = db.all("SELECT material_status FROM lines WHERE doc_type = 'order' AND doc_id = ? AND material_status != 'none'", orderId);
  if (!rows.length) return;
  let target = 'new';
  if (rows.every((r) => r.material_status === 'received')) target = 'ready';
  else if (rows.some((r) => r.material_status === 'ordered' || r.material_status === 'received')) target = 'ordered';
  if (target !== o.stage) {
    db.run('UPDATE orders SET stage = ?, updated_at = ? WHERE id = ?', target, nowIso(), orderId);
    log(db, user, 'order', orderId, 'stage', target);
  }
}

export function getRooms(db, type, id) {
  return db.all('SELECT * FROM rooms WHERE doc_type = ? AND doc_id = ? ORDER BY sort, id', type, id);
}

export function getLines(db, type, id) {
  return db.all(
    `SELECT l.*, p.category, p.stock_type, p.roll_width_ft, p.coverage_per_box, p.vendor_id, p.sku,
            p.manufacturer, p.style, p.color
       FROM lines l LEFT JOIN products p ON p.id = l.product_id
      WHERE l.doc_type = ? AND l.doc_id = ? ORDER BY l.sort, l.id`,
    type, id,
  );
}

export function userName(db, id) {
  if (!id) return null;
  return db.get('SELECT name FROM users WHERE id = ?', id)?.name ?? null;
}

export const today = () => localDate();
