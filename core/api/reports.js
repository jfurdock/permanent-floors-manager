import { round2, localDate, addDays, isDate, daysBetween, customerName } from '../util.js';
import { categoryLabel, stockToSale, productName } from '../calc.js';
import { onHandByProduct } from './catalog.js';

function range(query, defaultDays = 30) {
  const to = isDate(query.to) ? query.to : localDate();
  const from = isDate(query.from) ? query.from : addDays(to, -defaultDays + 1);
  return { from, to };
}

const monthStart = (d) => `${d.slice(0, 7)}-01`;

function salesTotals(rows) {
  const net = round2(rows.reduce((s, o) => s + (o.subtotal - o.discount), 0));
  const cost = round2(rows.reduce((s, o) => s + o.cost_total, 0));
  return { count: rows.length, net, cost, profit: round2(net - cost), margin: net ? round2(((net - cost) / net) * 100) : 0, total: round2(rows.reduce((s, o) => s + o.total, 0)) };
}

export function register(r) {
  r.get('/dashboard', ({ db, settings }) => {
    const today = localDate();
    const s = settings();
    const appointments = db.all(
      `SELECT a.*, i.name AS installer_name, i.color AS installer_color, c.first_name, c.last_name, c.company, o.number AS order_number
         FROM appointments a LEFT JOIN installers i ON i.id = a.installer_id LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN orders o ON o.id = a.order_id
        WHERE a.date <= ? AND COALESCE(a.end_date, a.date) >= ? AND a.status != 'cancelled'
        ORDER BY COALESCE(a.start_time, '99:99'), a.id`, today, today)
      .map((a) => ({ ...a, customer_name: a.customer_id ? customerName(a) : null }));
    const weekCount = db.get(
      "SELECT COUNT(*) AS n FROM appointments WHERE date > ? AND date <= ? AND status NOT IN ('cancelled','done')", today, addDays(today, 7)).n;

    const openQuotes = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM quotes WHERE status IN ('draft','sent')");
    const followUps = db.all(
      `SELECT q.id, q.number, q.title, q.total, q.sent_at, c.first_name, c.last_name, c.company, c.phone
         FROM quotes q JOIN customers c ON c.id = q.customer_id
        WHERE q.status = 'sent' AND q.sent_at <= ? ORDER BY q.sent_at LIMIT 6`, new Date(Date.now() - 4 * 86400000).toISOString())
      .map((q) => ({ ...q, customer_name: customerName(q), days: daysBetween(q.sent_at.slice(0, 10), today) }));

    const stages = {};
    for (const row of db.all("SELECT stage, COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE stage NOT IN ('paid','cancelled') GROUP BY stage")) {
      stages[row.stage] = { count: row.n, value: round2(row.v) };
    }
    const listStage = (stage, limit = 5) => db.all(
      `SELECT o.id, o.number, o.title, o.total, o.paid_total, o.updated_at, c.first_name, c.last_name, c.company
         FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.stage = ? ORDER BY o.updated_at LIMIT ?`, stage, limit)
      .map((o) => ({ ...o, customer_name: customerName(o), balance: round2(o.total - o.paid_total) }));

    const overdue = db.all(
      `SELECT o.id, o.number, o.title, o.total, o.paid_total, o.due_date, o.invoiced_at, c.first_name, c.last_name, c.company, c.phone
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.invoiced_at IS NOT NULL AND o.stage != 'cancelled' AND o.total - o.paid_total > 0.004 AND o.due_date < ?
        ORDER BY o.due_date LIMIT 6`, today)
      .map((o) => ({ ...o, customer_name: customerName(o), balance: round2(o.total - o.paid_total), days: daysBetween(o.due_date, today) }));
    const ar = db.get("SELECT COALESCE(SUM(total - paid_total), 0) AS v FROM orders WHERE invoiced_at IS NOT NULL AND stage != 'cancelled'").v;
    const deposits = db.get("SELECT COALESCE(SUM(paid_total), 0) AS v FROM orders WHERE invoiced_at IS NULL AND stage != 'cancelled'").v;

    const latePos = db.all(
      `SELECT po.id, po.number, po.expected_date, v.name AS vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
        WHERE po.status IN ('sent','partial') AND po.expected_date IS NOT NULL AND po.expected_date < ? ORDER BY po.expected_date LIMIT 5`, today);
    const draftPos = db.get("SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'draft'").n;

    const ms = monthStart(today);
    const month = salesTotals(db.all("SELECT subtotal, discount, cost_total, total FROM orders WHERE stage != 'cancelled' AND order_date >= ? AND order_date <= ?", ms, today));
    const monthPayments = round2(db.get('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE date >= ? AND date <= ?', ms, today).v);
    const todayPayments = round2(db.get('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE date = ?', today).v);

    const stock = onHandByProduct(db);
    const lowStock = db.all("SELECT id, category, manufacturer, style, color, unit, reorder_point FROM products WHERE active = 1 AND reorder_point IS NOT NULL AND stock_type != 'none'")
      .map((p) => ({ ...p, on_hand: stock[p.id]?.on_hand || 0 }))
      .filter((p) => p.on_hand < p.reorder_point)
      .slice(0, 6);

    return {
      today,
      appointments,
      week_count: weekCount,
      quotes: { open_count: openQuotes.n, open_value: round2(openQuotes.v), follow_ups: followUps },
      stages,
      ready_to_schedule: listStage('ready'),
      to_invoice: listStage('installed'),
      new_orders: listStage('new'),
      overdue,
      ar: round2(ar),
      deposits: round2(deposits),
      late_pos: latePos,
      draft_pos: draftPos,
      month: { ...month, payments: monthPayments },
      today_payments: todayPayments,
      low_stock: lowStock,
      setup_needed: !s.store_phone || !s.store_address,
    };
  });

  r.get('/reports/sales', ({ db, query }) => {
    const { from, to } = range(query, 90);
    const basis = query.basis === 'invoiced' ? 'invoiced' : 'booked';
    const dateCol = basis === 'invoiced' ? 'o.invoiced_at' : 'o.order_date';
    const rows = db.all(
      `SELECT o.*, ${dateCol} AS d, u.name AS rep_name, c.type AS customer_type
         FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.sales_rep_id
        WHERE o.stage != 'cancelled' AND ${dateCol} IS NOT NULL AND ${dateCol} >= ? AND ${dateCol} <= ?`, from, to);
    const group = (keyFn, labelFn = (k) => k) => {
      const m = new Map();
      for (const o of rows) {
        const k = keyFn(o);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(o);
      }
      return [...m.entries()].map(([k, list]) => ({ key: k, label: labelFn(k), ...salesTotals(list) }));
    };
    const byMonth = group((o) => o.d.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key));
    const byRep = group((o) => o.rep_name || 'Unassigned').sort((a, b) => b.net - a.net);
    const byType = group((o) => o.customer_type || 'residential', (k) => k[0].toUpperCase() + k.slice(1)).sort((a, b) => b.net - a.net);
    const ids = rows.map((o) => o.id);
    const catMap = new Map();
    if (ids.length) {
      const lines = db.all(
        `SELECT l.qty, l.price, l.cost, l.total, COALESCE(p.category, CASE l.kind WHEN 'labor' THEN 'labor' ELSE 'service' END) AS category
           FROM lines l LEFT JOIN products p ON p.id = l.product_id
          WHERE l.doc_type = 'order' AND l.doc_id IN (${ids.map(() => '?').join(',')})`, ...ids);
      for (const l of lines) {
        const c = catMap.get(l.category) || { key: l.category, label: categoryLabel(l.category), net: 0, cost: 0 };
        c.net += l.total;
        c.cost += l.qty * l.cost;
        catMap.set(l.category, c);
      }
    }
    const byCategory = [...catMap.values()].map((c) => ({ ...c, net: round2(c.net), cost: round2(c.cost), profit: round2(c.net - c.cost), margin: c.net ? round2(((c.net - c.cost) / c.net) * 100) : 0 }))
      .sort((a, b) => b.net - a.net);
    return { from, to, basis, totals: salesTotals(rows), by_month: byMonth, by_rep: byRep, by_category: byCategory, by_type: byType };
  });

  r.get('/reports/ar', ({ db }) => {
    const today = localDate();
    const rows = db.all(
      `SELECT o.id, o.number, o.invoice_number, o.title, o.total, o.paid_total, o.invoiced_at, o.due_date,
              c.id AS customer_id, c.first_name, c.last_name, c.company, c.phone
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.invoiced_at IS NOT NULL AND o.stage != 'cancelled' AND o.total - o.paid_total > 0.004
        ORDER BY o.due_date`)
      .map((o) => {
        const days = Math.max(0, daysBetween(o.due_date || o.invoiced_at, today));
        const bucket = days <= 0 ? 'current' : days <= 30 ? '1_30' : days <= 60 ? '31_60' : days <= 90 ? '61_90' : '90_plus';
        return { ...o, customer_name: customerName(o), balance: round2(o.total - o.paid_total), days_past_due: days, bucket };
      });
    const buckets = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
    for (const o of rows) buckets[o.bucket] = round2(buckets[o.bucket] + o.balance);
    const deposits = db.all(
      `SELECT o.id, o.number, o.title, o.total, o.paid_total, o.stage, c.first_name, c.last_name, c.company
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.invoiced_at IS NULL AND o.stage != 'cancelled' AND o.paid_total > 0 ORDER BY o.id`)
      .map((o) => ({ ...o, customer_name: customerName(o) }));
    return {
      today, rows, buckets,
      total: round2(rows.reduce((s, o) => s + o.balance, 0)),
      deposits,
      deposits_total: round2(deposits.reduce((s, o) => s + o.paid_total, 0)),
    };
  });

  r.get('/reports/inventory', ({ db }) => {
    const items = db.all(
      `SELECT i.*, p.category, p.unit, p.stock_type, p.roll_width_ft, p.coverage_per_box, p.manufacturer, p.style, p.color
         FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.qty > 0.0001`);
    const cats = new Map();
    let total = 0;
    for (const i of items) {
      const sale = stockToSale(i, i.qty, i.width_ft);
      const value = sale * i.unit_cost;
      total += value;
      const c = cats.get(i.category) || { key: i.category, label: categoryLabel(i.category), pieces: 0, value: 0, remnants: 0 };
      c.pieces += 1;
      c.value += value;
      if (i.is_remnant) c.remnants += 1;
      cats.set(i.category, c);
    }
    const stock = onHandByProduct(db);
    const products = db.all("SELECT id, category, manufacturer, style, color, unit, reorder_point FROM products WHERE active = 1 AND stock_type != 'none'")
      .map((p) => ({ ...p, name: productName(p), on_hand: stock[p.id]?.on_hand || 0, value: stock[p.id]?.value || 0 }));
    return {
      total_value: round2(total),
      pieces: items.length,
      remnants: items.filter((i) => i.is_remnant).length,
      by_category: [...cats.values()].map((c) => ({ ...c, value: round2(c.value) })).sort((a, b) => b.value - a.value),
      low_stock: products.filter((p) => p.reorder_point !== null && p.on_hand < p.reorder_point),
      top_value: products.sort((a, b) => b.value - a.value).slice(0, 10),
    };
  });

  r.get('/reports/quotes', ({ db, query }) => {
    const { from, to } = range(query, 90);
    const rows = db.all(
      `SELECT q.status, q.total, u.name AS rep_name FROM quotes q LEFT JOIN users u ON u.id = q.sales_rep_id
        WHERE q.quote_date >= ? AND q.quote_date <= ?`, from, to);
    const summarize = (list) => {
      const won = list.filter((q) => q.status === 'accepted');
      const lost = list.filter((q) => q.status === 'declined');
      const decided = won.length + lost.length;
      return {
        count: list.length,
        value: round2(list.reduce((s, q) => s + q.total, 0)),
        won: won.length,
        won_value: round2(won.reduce((s, q) => s + q.total, 0)),
        lost: lost.length,
        open: list.length - decided,
        close_rate: list.length ? round2((won.length / list.length) * 100) : 0,
      };
    };
    const reps = new Map();
    for (const q of rows) {
      const k = q.rep_name || 'Unassigned';
      if (!reps.has(k)) reps.set(k, []);
      reps.get(k).push(q);
    }
    return {
      from, to,
      totals: summarize(rows),
      by_rep: [...reps.entries()].map(([k, list]) => ({ key: k, label: k, ...summarize(list) })).sort((a, b) => b.won_value - a.won_value),
    };
  });

  r.get('/reports/installers', ({ db, query }) => {
    const { from, to } = range(query, 30);
    const rows = db.all(
      `SELECT i.id, i.name, i.color,
              SUM(CASE WHEN a.status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN a.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS open,
              COUNT(a.id) AS total
         FROM installers i LEFT JOIN appointments a ON a.installer_id = i.id AND a.status != 'cancelled' AND a.date >= ? AND a.date <= ?
        WHERE i.active = 1 GROUP BY i.id ORDER BY i.name`, from, to);
    return { from, to, rows };
  });

}
