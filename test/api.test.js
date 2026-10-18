// End-to-end checks of the business rules: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApi } from '../core/api/index.js';
import { seedDemo } from '../core/seed.js';
import { parseFeet, formatFeet, rollLayout, estimate } from '../core/calc.js';

function setup() {
  const db = openDb(':memory:');
  const api = createApi(db);
  let token = null;
  const call = async (method, path, body, opts = {}) => {
    const res = await api.handle({ method, path, body: method === 'GET' ? {} : body, query: method === 'GET' ? body || {} : {}, token: opts.token ?? token });
    if (!opts.expectError && res.status !== 200) throw new Error(`${method} ${path} -> ${res.status} ${res.body.error}`);
    return opts.expectError ? res : res.body;
  };
  return { db, api, call, setToken: (t) => { token = t; } };
}

test('feet and inches parsing', () => {
  assert.equal(parseFeet('12'), 12);
  assert.equal(parseFeet("12'6"), 12.5);
  assert.equal(parseFeet('12 6'), 12.5);
  assert.equal(parseFeet('12-6'), 12.5);
  assert.equal(parseFeet('12′ 6″'), 12.5);
  assert.equal(parseFeet('150"'), 12.5);
  assert.equal(parseFeet('12.25'), 12.25);
  assert.equal(parseFeet('12 14'), null);
  assert.equal(parseFeet('12in'), 1);
  assert.equal(parseFeet('150 in'), 12.5);
  assert.equal(parseFeet(-10), null);
  assert.equal(formatFeet(-1.5), `-1' 6"`);
  assert.equal(parseFeet('abc'), null);
  assert.equal(formatFeet(12.5), `12' 6"`);
  assert.equal(formatFeet(13), "13'");
});

test('roll layout picks the direction with the least waste', () => {
  // 14 x 18.5 room on 12' roll: 2 drops of 18'6"+3"x2 along length, or 2 drops of 14'+6" along width
  const r = rollLayout([{ length_ft: 18.5, width_ft: 14 }], 12);
  assert.equal(r.rooms[0].drops, 2);
  assert.equal(r.rooms[0].runsAlong, 'width');
  assert.equal(r.linearFt, 29);
  assert.equal(r.seams, 1);
  assert.equal(r.sy, 38.67);
  // A room narrower than the roll needs one drop and no seam
  const one = rollLayout([{ length_ft: 12, width_ft: 4 }], 12);
  assert.equal(one.rooms[0].drops, 1);
  assert.equal(one.seams, 0);
});

test('box goods round up to whole boxes', () => {
  const e = estimate({ rooms: [{ length_ft: 14, width_ft: 12 }], product: { unit: 'SF', stock_type: 'box', coverage_per_box: 23.64 }, wastePct: 10 });
  assert.equal(e.boxes, 8); // 168 sf * 1.1 = 184.8 -> 7.82 boxes -> 8
  assert.equal(e.qty, 189.12);
});

test('quote to paid order, with special-order material', async () => {
  const { call, setToken, db } = setup();
  const setup1 = await call('POST', '/auth/setup', { name: 'Owner', pin: '1234', store_name: 'Test Store' });
  setToken(setup1.token);
  await call('PUT', '/settings', { tax_rate: '8' });

  const vendor = await call('POST', '/vendors', { name: 'Mill' });
  const carpet = await call('POST', '/products', { category: 'carpet', vendor_id: vendor.id, style: 'Twist', color: 'Sand', unit: 'SY', stock_type: 'roll', roll_width_ft: 12, cost: 10, price: 20 });
  const labor = await call('POST', '/products', { category: 'labor', style: 'Install', unit: 'SY', cost: 5, price: 8 });
  assert.equal(labor.taxable, 0, 'labor defaults to non-taxable');
  const customer = await call('POST', '/customers', { first_name: 'Ann', last_name: 'Lee', phone: '555-0100' });

  const q = await call('POST', '/quotes', { customer_id: customer.id, title: 'Bedroom' });
  await call('POST', `/quotes/${q.id}/rooms`, { name: 'Bedroom', length_ft: '12', width_ft: '12' });
  await call('POST', `/quotes/${q.id}/lines`, { lines: [{ product_id: carpet.id, qty: 16.67 }, { product_id: labor.id, qty: 16 }] });
  const q2 = await call('GET', `/quotes/${q.id}`);
  assert.equal(q2.subtotal, 333.4 + 128);
  assert.equal(q2.tax, 26.67); // 8% of 333.40 carpet only
  assert.equal(q2.total, 488.07);

  // Discount is spread across taxable and non-taxable items
  await call('PUT', `/quotes/${q.id}`, { discount: 46.14 });
  const q3 = await call('GET', `/quotes/${q.id}`);
  assert.equal(q3.total, round(461.4 - 46.14 + 333.4 * 0.9 * 0.08));

  const accepted = await call('POST', `/quotes/${q.id}/accept`, { signed_name: 'Ann Lee', signature: 'data:image/png;base64,AAAA' });
  const orderId = accepted.order_id;
  let o = await call('GET', `/orders/${orderId}`);
  assert.equal(o.stage, 'new');
  assert.equal(o.total, q3.total);
  assert.equal(o.rooms.length, 1);
  assert.equal(o.lines.find((l) => l.product_id === carpet.id).material_status, 'needed');
  assert.equal(o.lines.find((l) => l.product_id === labor.id).material_status, 'none');

  // Can't edit an accepted quote
  const blocked = await call('POST', `/quotes/${q.id}/lines`, { description: 'x', qty: 1, price: 1 }, { expectError: true });
  assert.equal(blocked.status, 400);

  // Deposit
  o = await call('POST', `/orders/${orderId}/payments`, { amount: 200, method: 'card' });
  assert.equal(o.paid_total, 200);

  // Order material -> draft PO, order moves to "ordered"
  const mat = await call('POST', `/orders/${orderId}/order-material`, {});
  assert.equal(mat.po_ids.length, 1);
  assert.equal(mat.order.stage, 'ordered');
  const po = await call('GET', `/pos/${mat.po_ids[0]}`);
  assert.equal(po.lines.length, 1);
  assert.match(po.lines[0].notes, /Cut 12/);
  await call('POST', `/pos/${po.id}/status`, { status: 'sent' });

  // Receive a longer piece than needed: the job gets its cut, the rest stays in stock
  const received = await call('POST', `/pos/${po.id}/receive`, { items: [{ po_line_id: po.lines[0].id, length_ft: '20', width_ft: '12', tag: 'R1', dye_lot: 'A1', location: 'Rack' }] });
  assert.equal(received.status, 'received');
  o = await call('GET', `/orders/${orderId}`);
  assert.equal(o.stage, 'ready');
  const cl = o.lines.find((l) => l.product_id === carpet.id);
  assert.equal(cl.material_status, 'received');
  assert.equal(cl.allocations.length, 1);
  const item = db.get('SELECT * FROM inventory WHERE tag = ?', 'R1');
  assert.ok(item.qty > 7 && item.qty < 8, `leftover ${item.qty} ft`);
  assert.equal(item.is_remnant, 1);

  // Schedule and complete the install
  const appt = await call('POST', '/appointments', { type: 'install', order_id: orderId, date: '2030-01-10', start_time: '08:00' });
  assert.equal((await call('GET', `/orders/${orderId}`)).stage, 'scheduled');
  await call('POST', `/appointments/${appt.id}/complete`, { notes: 'done' });
  assert.equal((await call('GET', `/orders/${orderId}`)).stage, 'installed');

  // Invoice and collect the balance
  o = await call('POST', `/orders/${orderId}/invoice`, {});
  assert.equal(o.stage, 'invoiced');
  assert.match(o.invoice_number, /^INV-/);
  const editInvoiced = await call('POST', `/orders/${orderId}/lines`, { description: 'x', qty: 1, price: 1 }, { expectError: true });
  assert.equal(editInvoiced.status, 400);
  o = await call('POST', `/orders/${orderId}/payments`, { amount: o.balance, method: 'check', reference: '1001' });
  assert.equal(o.stage, 'paid');
  assert.equal(o.balance, 0);

  const ar = await call('GET', '/reports/ar');
  assert.equal(ar.total, 0);
  const sales = await call('GET', '/reports/sales', {});
  assert.equal(sales.totals.count, 1);
});

test('a failed request saves nothing', async () => {
  const { call, setToken, db } = setup();
  setToken((await call('POST', '/auth/setup', { name: 'Owner', pin: '1234' })).token);
  const c = await call('POST', '/customers', { last_name: 'Smith' });
  const q = await call('POST', '/quotes', { customer_id: c.id });
  const res = await call('POST', `/quotes/${q.id}/lines`, { lines: [{ description: 'Good line', qty: 1, price: 10 }, { description: '', qty: 1 }] }, { expectError: true });
  assert.equal(res.status, 400);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM lines WHERE doc_type = 'quote'").n, 0);
});

test('stock cut, remnant flag, and return to stock', async () => {
  const { call, setToken, db } = setup();
  setToken((await call('POST', '/auth/setup', { name: 'Owner', pin: '1234' })).token);
  const p = await call('POST', '/products', { category: 'carpet', style: 'Loop', unit: 'SY', stock_type: 'roll', roll_width_ft: 12, cost: 10, price: 20 });
  const roll = await call('POST', '/inventory', { product_id: p.id, length_ft: '50', tag: 'R9' });
  assert.equal(roll.is_remnant, 0);
  const c = await call('POST', '/customers', { last_name: 'Jones' });
  const o = await call('POST', '/orders', { customer_id: c.id });
  await call('POST', `/orders/${o.id}/lines`, { product_id: p.id, qty: 40 });
  let det = await call('GET', `/orders/${o.id}`);
  const line = det.lines[0];
  assert.equal(line.stock_needed, 30);
  det = await call('POST', `/lines/${line.id}/allocate`, { inventory_id: roll.id, qty: '30' });
  assert.equal(det.stage, 'ready');
  let item = db.get('SELECT * FROM inventory WHERE id = ?', roll.id);
  assert.equal(item.qty, 20);
  assert.equal(item.is_remnant, 1);
  const tooMuch = await call('POST', `/lines/${line.id}/allocate`, { inventory_id: roll.id, qty: '25' }, { expectError: true });
  assert.equal(tooMuch.status, 400);
  det = await call('POST', `/inventory-tx/${det.lines[0].allocations[0].id}/return`, {});
  item = db.get('SELECT * FROM inventory WHERE id = ?', roll.id);
  assert.equal(item.qty, 50);
  assert.equal(item.is_remnant, 0);
  assert.equal(det.lines[0].material_status, 'needed');
});

test('installers only see their own jobs', async () => {
  const { call, setToken, api } = setup();
  setToken((await call('POST', '/auth/setup', { name: 'Owner', pin: '1234' })).token);
  const crewA = await call('POST', '/installers', { name: 'Crew A' });
  const crewB = await call('POST', '/installers', { name: 'Crew B' });
  const installer = await call('POST', '/users', { name: 'Ivan', role: 'installer', pin: '9999', installer_id: crewA.id });
  const c = await call('POST', '/customers', { last_name: 'Park' });
  await call('POST', '/appointments', { type: 'install', customer_id: c.id, installer_id: crewA.id, date: '2030-02-01' });
  await call('POST', '/appointments', { type: 'install', customer_id: c.id, installer_id: crewB.id, date: '2030-02-01' });
  const login = await api.handle({ method: 'POST', path: '/auth/login', body: { user_id: installer.id, pin: '9999' } });
  assert.equal(login.status, 200);
  const t = login.body.token;
  const mine = await api.handle({ method: 'GET', path: '/appointments', query: { from: '2030-02-01', to: '2030-02-01' }, token: t });
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].installer_id, crewA.id);
  const customers = await api.handle({ method: 'GET', path: '/customers', token: t });
  assert.equal(customers.status, 403);
  const wrongPin = await api.handle({ method: 'POST', path: '/auth/login', body: { user_id: installer.id, pin: '0000' } });
  assert.equal(wrongPin.status, 400);
});

test('sample data loads and the dashboard works', async () => {
  const { api } = setup();
  await seedDemo(api, {});
  const login = await api.handle({ method: 'POST', path: '/auth/login', body: { user_id: 1, pin: '1234' } });
  const dash = await api.handle({ method: 'GET', path: '/dashboard', token: login.body.token });
  assert.equal(dash.status, 200);
  assert.ok(dash.body.appointments.length >= 1);
  assert.ok(dash.body.month.count >= 0);
  for (const p of ['/reports/sales', '/reports/ar', '/reports/inventory', '/reports/quotes', '/reports/installers', '/customers', '/quotes', '/orders', '/pos', '/inventory', '/products', '/vendors', '/users', '/admin/export']) {
    const res = await api.handle({ method: 'GET', path: p, token: login.body.token });
    assert.equal(res.status, 200, `${p}: ${res.body.error}`);
  }
});

test('partial material is not counted as in, and stages follow the material', async () => {
  const { call, setToken, db } = setup();
  setToken((await call('POST', '/auth/setup', { name: 'Owner', pin: '1234' })).token);
  const vendor = await call('POST', '/vendors', { name: 'Mill' });
  const p = await call('POST', '/products', { category: 'lvp', vendor_id: vendor.id, style: 'Plank', unit: 'SF', stock_type: 'box', coverage_per_box: 20, cost: 2, price: 4 });
  const lot = await call('POST', '/inventory', { product_id: p.id, qty: 5 });
  const c = await call('POST', '/customers', { last_name: 'Gray' });
  const o = await call('POST', '/orders', { customer_id: c.id });
  await call('POST', `/orders/${o.id}/lines`, { product_id: p.id, qty: 200 });
  let det = await call('GET', `/orders/${o.id}`);
  const line = det.lines[0];
  // Pull 5 of the 10 boxes needed
  det = await call('POST', `/lines/${line.id}/allocate`, { inventory_id: lot.id, qty: 5 });
  assert.equal(det.lines[0].material_status, 'needed');
  assert.equal(det.stage, 'new');
  // Order the rest: only the missing 5 boxes go on the PO
  const mat = await call('POST', `/orders/${o.id}/order-material`, {});
  const po = await call('GET', `/pos/${mat.po_ids[0]}`);
  assert.equal(po.lines[0].qty, 5);
  assert.equal(po.lines[0].unit, 'BOX');
  assert.equal(mat.order.stage, 'ordered');
  // Cancelling the PO puts the item back to needed and the order back to new
  await call('POST', `/pos/${po.id}/status`, { status: 'cancelled' });
  det = await call('GET', `/orders/${o.id}`);
  assert.equal(det.lines[0].material_status, 'needed');
  assert.equal(det.stage, 'new');
  const revive = await call('POST', `/pos/${po.id}/status`, { status: 'sent' }, { expectError: true });
  assert.equal(revive.status, 400);
  // Raising the quantity after a full pull makes it short again
  const lot2 = await call('POST', '/inventory', { product_id: p.id, qty: 5 });
  det = await call('POST', `/lines/${line.id}/allocate`, { inventory_id: lot2.id, qty: 5 });
  assert.equal(det.lines[0].material_status, 'received');
  assert.equal(det.stage, 'ready');
  await call('PUT', `/lines/${line.id}`, { qty: 400 });
  det = await call('GET', `/orders/${o.id}`);
  assert.equal(det.lines[0].material_status, 'needed');
  assert.equal(det.stage, 'new');
  void db;
});

test('discounts, payments and inputs are checked', async () => {
  const { call, setToken, api } = setup();
  setToken((await call('POST', '/auth/setup', { name: 'Owner', pin: '1234' })).token);
  const c = await call('POST', '/customers', { last_name: 'Hill' });
  const o = await call('POST', '/orders', { customer_id: c.id });
  await call('POST', `/orders/${o.id}/lines`, { description: 'Install', qty: 1, price: 100, taxable: 0 });
  const tooBig = await call('PUT', `/orders/${o.id}`, { discount: 500 }, { expectError: true });
  assert.equal(tooBig.status, 400);
  const badQty = await call('POST', `/orders/${o.id}/lines`, { description: 'x', qty: -5, price: 1 }, { expectError: true });
  assert.equal(badQty.status, 400);
  const badTax = await call('PUT', `/orders/${o.id}`, { tax_rate: 'abc' }, { expectError: true });
  assert.equal(badTax.status, 400);
  const over = await call('POST', `/orders/${o.id}/payments`, { amount: 150, method: 'cash' }, { expectError: true });
  assert.equal(over.status, 400);
  await call('POST', `/orders/${o.id}/payments`, { amount: 40, method: 'cash' });
  const dup = await call('POST', `/orders/${o.id}/payments`, { amount: 40, method: 'cash' }, { expectError: true });
  assert.equal(dup.status, 400);
  // Sales can't record refunds or change product prices
  await call('POST', '/users', { name: 'Sam', role: 'sales', pin: '2222' });
  const users = await call('GET', '/users');
  const sam = users.find((u) => u.name === 'Sam');
  const t = (await api.handle({ method: 'POST', path: '/auth/login', body: { user_id: sam.id, pin: '2222' } })).body.token;
  const refund = await api.handle({ method: 'POST', path: `/orders/${o.id}/payments`, body: { amount: -10, method: 'cash' }, token: t });
  assert.equal(refund.status, 400);
  const prod = await call('POST', '/products', { category: 'labor', style: 'Labor', unit: 'SF', cost: 1, price: 2 });
  const edit = await api.handle({ method: 'PUT', path: `/products/${prod.id}`, body: { price: 0.01 }, token: t });
  assert.equal(edit.status, 403);
});

function round(n) { return Math.round(n * 100) / 100; }
