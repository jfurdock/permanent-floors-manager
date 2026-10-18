// Sample data for the demo and for trying the app. Built through the API so every rule is applied.

import { localDate, addDays } from './util.js';

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_USERS = [
  { name: 'Dana Whitfield', role: 'admin', pin: '1234' },
  { name: 'Marcus Reyes', role: 'sales', pin: '2222' },
  { name: 'Priya Shah', role: 'sales', pin: '3333' },
  { name: 'Tom Kowalski', role: 'warehouse', pin: '4444' },
  { name: 'Luis Ortega', role: 'installer', pin: '5555', installer: 'Ortega Flooring' },
];

export async function seedDemo(api, { today = localDate(), storeName } = {}) {
  const db = api.db;
  const d = (n) => addDays(today, n);
  const rand = rng(20261018);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  let token = null;
  const call = async (method, path, body) => {
    const res = await api.handle({ method, path, body, token, query: method === 'GET' ? body || {} : {} });
    if (res.status !== 200) throw new Error(`${method} ${path}: ${res.body.error}`);
    return res.body;
  };

  // Owner account and store settings
  const owner = DEMO_USERS[0];
  token = (await call('POST', '/auth/setup', { name: owner.name, pin: owner.pin, store_name: storeName })).token;
  await call('PUT', '/settings', {
    store_address: '1200 Main Street',
    store_city: 'Springfield',
    store_state: 'OH',
    store_zip: '44100',
    store_phone: '(555) 010-4400',
    store_email: 'hello@example.com',
  });

  // Installers
  const installers = {};
  for (const i of [
    { name: 'Ortega Flooring', phone: '(555) 010-2201', specialties: 'Carpet, LVP, laminate', color: '#2f6f9f' },
    { name: 'Brennan Hardwood Co.', phone: '(555) 010-2202', specialties: 'Hardwood, stairs', color: '#7a5195' },
    { name: 'Kim Tile & Stone', phone: '(555) 010-2203', specialties: 'Tile, backsplash, showers', color: '#3d8361' },
    { name: 'Rapid Carpet Crew', phone: '(555) 010-2204', specialties: 'Carpet, commercial', color: '#c46b1f' },
  ]) installers[i.name] = (await call('POST', '/installers', i)).id;

  // Staff logins
  const users = { [owner.name]: db.get('SELECT id FROM users WHERE name = ?', owner.name).id };
  for (const u of DEMO_USERS.slice(1)) {
    const created = await call('POST', '/users', { name: u.name, role: u.role, pin: u.pin, installer_id: u.installer ? installers[u.installer] : null });
    users[u.name] = created.id;
  }
  const reps = [users['Marcus Reyes'], users['Priya Shah'], users['Dana Whitfield']];

  // Vendors
  const vendors = {};
  for (const v of [
    { name: 'Shaw Floors', contact: 'Regional order desk', phone: '(555) 010-3301', email: 'orders@example.com', account_number: 'PF-11820' },
    { name: 'Mohawk Flooring', contact: 'Customer service', phone: '(555) 010-3302', email: 'orders@example.com', account_number: 'PF-77310' },
    { name: 'Mannington Mills', contact: 'Rep: Allison', phone: '(555) 010-3303', email: 'orders@example.com', account_number: 'PF-30944' },
    { name: 'Daltile', contact: 'Branch counter', phone: '(555) 010-3304', email: 'orders@example.com', account_number: 'PF-55102' },
    { name: 'Great Lakes Flooring Supply', contact: 'Will call desk', phone: '(555) 010-3305', email: 'orders@example.com', account_number: 'PF-90021' },
  ]) vendors[v.name] = (await call('POST', '/vendors', v)).id;

  // Products
  const P = {};
  const product = async (key, p) => { P[key] = await call('POST', '/products', p); };
  await product('twistSand', { category: 'carpet', vendor_id: vendors['Shaw Floors'], manufacturer: 'Shaw', style: 'Northfield Twist', color: 'Sandstone', sku: 'SH-NT-210', unit: 'SY', stock_type: 'roll', roll_width_ft: 12, cost: 14.5, price: 29.99, reorder_point: 40 });
  await product('twistPewter', { category: 'carpet', vendor_id: vendors['Shaw Floors'], manufacturer: 'Shaw', style: 'Northfield Twist', color: 'Pewter', sku: 'SH-NT-540', unit: 'SY', stock_type: 'roll', roll_width_ft: 12, cost: 14.5, price: 29.99 });
  await product('harbor', { category: 'carpet', vendor_id: vendors['Mohawk Flooring'], manufacturer: 'Mohawk', style: 'Soft Harbor', color: 'Driftwood', sku: 'MO-SH-88', unit: 'SY', stock_type: 'roll', roll_width_ft: 12, cost: 18, price: 36.99 });
  await product('plush', { category: 'carpet', vendor_id: vendors['Mohawk Flooring'], manufacturer: 'Mohawk', style: 'Cloudsoft Plush', color: 'Ivory', sku: 'MO-CP-01', unit: 'SY', stock_type: 'roll', roll_width_ft: 15, cost: 22, price: 44.99 });
  await product('loop', { category: 'carpet', vendor_id: vendors['Shaw Floors'], manufacturer: 'Shaw', style: 'Windmere Loop', color: 'Granite', sku: 'SH-WL-77', unit: 'SY', stock_type: 'roll', roll_width_ft: 12, cost: 11.25, price: 23.99 });
  await product('rebond', { category: 'pad', vendor_id: vendors['Great Lakes Flooring Supply'], manufacturer: 'Great Lakes', style: '8 lb rebond pad', color: '7/16 in', unit: 'SY', stock_type: 'roll', roll_width_ft: 6, cost: 2.4, price: 5.99, reorder_point: 100 });
  await product('memory', { category: 'pad', vendor_id: vendors['Great Lakes Flooring Supply'], manufacturer: 'Great Lakes', style: 'Memory foam pad', color: '1/2 in', unit: 'SY', stock_type: 'roll', roll_width_ft: 6, cost: 4.1, price: 8.99 });
  await product('cedar', { category: 'lvp', vendor_id: vendors['Mannington Mills'], manufacturer: 'Mannington', style: 'Cedar Ridge', color: 'Weathered Oak', sku: 'MN-CR-14', unit: 'SF', stock_type: 'box', coverage_per_box: 23.64, cost: 2.35, price: 4.79, reorder_point: 400 });
  await product('coastal', { category: 'lvp', vendor_id: vendors['Shaw Floors'], manufacturer: 'Shaw', style: 'Coastal Plank', color: 'Grey Birch', sku: 'SH-CP-05', unit: 'SF', stock_type: 'box', coverage_per_box: 21.5, cost: 2.1, price: 4.29 });
  await product('laminate', { category: 'laminate', vendor_id: vendors['Mohawk Flooring'], manufacturer: 'Mohawk', style: 'Stonebrook', color: 'Hickory Smoke', sku: 'MO-SB-31', unit: 'SF', stock_type: 'box', coverage_per_box: 19.63, cost: 1.85, price: 3.69 });
  await product('oak', { category: 'hardwood', vendor_id: vendors['Shaw Floors'], manufacturer: 'Shaw', style: 'Heritage Oak 5 in', color: 'Natural', sku: 'SH-HO-5N', unit: 'SF', stock_type: 'box', coverage_per_box: 22, cost: 4.25, price: 8.49 });
  await product('marble', { category: 'tile', vendor_id: vendors['Daltile'], manufacturer: 'Daltile', style: 'Marble Mist 12x24', color: 'Bianco', sku: 'DT-MM-1224', unit: 'SF', stock_type: 'box', coverage_per_box: 15.5, cost: 2.1, price: 4.49 });
  await product('slate', { category: 'tile', vendor_id: vendors['Daltile'], manufacturer: 'Daltile', style: 'Slate Plank 6x24', color: 'Charcoal', sku: 'DT-SP-624', unit: 'SF', stock_type: 'box', coverage_per_box: 14, cost: 2.65, price: 5.29 });
  await product('sheet', { category: 'sheet_vinyl', vendor_id: vendors['Mannington Mills'], manufacturer: 'Mannington', style: 'Kitchen Classic', color: 'Pebble', unit: 'SY', stock_type: 'roll', roll_width_ft: 12, cost: 9, price: 18.99 });
  await product('stairnose', { category: 'trim', vendor_id: vendors['Mannington Mills'], manufacturer: 'Mannington', style: 'Stair nose', color: 'Weathered Oak', unit: 'EA', stock_type: 'unit', cost: 22, price: 45 });
  await product('tmold', { category: 'trim', vendor_id: vendors['Great Lakes Flooring Supply'], style: 'T-molding 78 in', color: 'Match', unit: 'EA', stock_type: 'unit', cost: 14, price: 32 });
  await product('quarter', { category: 'trim', vendor_id: vendors['Great Lakes Flooring Supply'], style: 'Quarter round 8 ft', color: 'Primed white', unit: 'EA', stock_type: 'unit', cost: 4, price: 9.5, reorder_point: 20 });
  await product('thinset', { category: 'sundry', vendor_id: vendors['Daltile'], style: 'Thinset mortar 50 lb', unit: 'EA', stock_type: 'unit', cost: 18, price: 34 });
  await product('grout', { category: 'sundry', vendor_id: vendors['Daltile'], style: 'Sanded grout 25 lb', color: 'Warm grey', unit: 'EA', stock_type: 'unit', cost: 16, price: 29 });
  await product('rug', { category: 'rug', style: 'Bound rug 8 x 10', color: 'Made from remnants', unit: 'EA', stock_type: 'none', cost: 120, price: 299 });
  await product('laborCarpet', { category: 'labor', style: 'Carpet & pad installation', unit: 'SY', cost: 5.5, price: 8.5 });
  await product('laborLvp', { category: 'labor', style: 'LVP / laminate installation', unit: 'SF', cost: 1.5, price: 2.75 });
  await product('laborWood', { category: 'labor', style: 'Hardwood installation (nail down)', unit: 'SF', cost: 2.75, price: 4.5 });
  await product('laborTile', { category: 'labor', style: 'Tile installation', unit: 'SF', cost: 5, price: 8 });
  await product('laborStairs', { category: 'labor', style: 'Stair installation', description: 'Per step', unit: 'EA', cost: 12, price: 25 });
  await product('tearout', { category: 'service', style: 'Remove & dispose old flooring', unit: 'SF', cost: 0.35, price: 0.85 });
  await product('furniture', { category: 'service', style: 'Furniture moving', description: 'Per room', unit: 'EA', cost: 15, price: 35 });
  await product('prep', { category: 'service', style: 'Floor prep & leveling', unit: 'SF', cost: 0.75, price: 1.75 });
  await product('delivery', { category: 'service', style: 'Delivery', unit: 'EA', cost: 0, price: 75, taxable: 0 });

  // Stock on hand
  const stock = async (key, item) => (await call('POST', '/inventory', { product_id: P[key].id, ...item })).id;
  const rollSand = await stock('twistSand', { tag: 'R-4521', dye_lot: '7731A', location: 'Rack A1', width_ft: 12, length_ft: 148 });
  await stock('twistSand', { tag: 'R-4388', dye_lot: '7702C', location: 'Remnant rack', width_ft: 12, length_ft: '13 6' });
  await stock('twistPewter', { tag: 'R-4410', dye_lot: '6610B', location: 'Rack A2', width_ft: 12, length_ft: 62 });
  await stock('harbor', { tag: 'R-4602', dye_lot: 'M-2290', location: 'Rack A3', width_ft: 12, length_ft: 87 });
  await stock('loop', { tag: 'R-4120', dye_lot: '5501', location: 'Remnant rack', width_ft: 12, length_ft: 11 });
  await stock('loop', { tag: 'R-4134', dye_lot: '5520', location: 'Remnant rack', width_ft: 12, length_ft: '16 4' });
  await stock('plush', { tag: 'R-4577', dye_lot: 'M-8812', location: 'Remnant rack', width_ft: 15, length_ft: 9 });
  const padRoll = await stock('rebond', { tag: 'P-110', location: 'Pad bay', width_ft: 6, length_ft: 270, is_remnant: 0 });
  await stock('memory', { tag: 'P-114', location: 'Pad bay', width_ft: 6, length_ft: 90, is_remnant: 0 });
  const cedarLot = await stock('cedar', { tag: 'L-CR-0921', dye_lot: 'CR0921', location: 'Aisle 3', qty: 44 });
  await stock('coastal', { tag: 'L-CP-1104', dye_lot: 'CP1104', location: 'Aisle 3', qty: 18 });
  await stock('laminate', { tag: 'L-SB-0815', dye_lot: 'SB0815', location: 'Aisle 4', qty: 26 });
  await stock('marble', { tag: 'L-MM-22', dye_lot: 'MM22-B', location: 'Tile wall', qty: 31 });
  await stock('stairnose', { location: 'Trim bin 2', qty: 6 });
  await stock('tmold', { location: 'Trim bin 1', qty: 9 });
  await stock('quarter', { location: 'Trim bin 3', qty: 14 });
  await stock('thinset', { location: 'Sundries', qty: 12 });
  await stock('grout', { location: 'Sundries', qty: 8 });

  // Customers
  const C = {};
  const customer = async (key, c) => { C[key] = (await call('POST', '/customers', c)).id; };
  await customer('hendricks', { first_name: 'Karen', last_name: 'Hendricks', phone: '(555) 014-2290', email: 'karen.h@example.com', address: '418 Elmwood Ave', city: 'Springfield', state: 'OH', zip: '44101', source: 'Repeat customer', sales_rep_id: reps[0] });
  await customer('nguyen', { first_name: 'David', last_name: 'Nguyen', phone: '(555) 014-7781', email: 'dnguyen@example.com', address: '77 Lakeview Dr', city: 'Riverside', state: 'OH', zip: '44102', source: 'Google', sales_rep_id: reps[1] });
  await customer('patel', { first_name: 'Anita', last_name: 'Patel', phone: '(555) 014-3302', email: 'anita.patel@example.com', address: '2310 Fulton Rd', city: 'Springfield', state: 'OH', zip: '44101', source: 'Walk-in', sales_rep_id: reps[1] });
  await customer('obrien', { first_name: 'Sean', last_name: "O'Brien", phone: '(555) 014-9045', address: '15 Belle Ave', city: 'Westfield', state: 'OH', zip: '44105', source: 'Referral', sales_rep_id: reps[0] });
  await customer('martinez', { first_name: 'Rosa', last_name: 'Martinez', phone: '(555) 014-6610', email: 'rosa.m@example.com', address: '902 Clifton Blvd', city: 'Springfield', state: 'OH', zip: '44101', source: 'Home show', sales_rep_id: reps[2] });
  await customer('baker', { first_name: 'James', last_name: 'Baker', phone: '(555) 014-1187', address: '3311 Warren Rd', city: 'Oak Grove', state: 'OH', zip: '44107', source: 'Google', sales_rep_id: reps[0] });
  await customer('kowal', { first_name: 'Ellen', last_name: 'Kowal', phone: '(555) 014-5523', email: 'ekowal@example.com', address: '58 Grace Ave', city: 'Riverside', state: 'OH', zip: '44102', source: 'Repeat customer', sales_rep_id: reps[1] });
  await customer('lakeside', { type: 'commercial', company: 'Lakeside Dental Group', first_name: 'Maria', last_name: 'Gomez', phone: '(555) 014-8800', email: 'office@example.com', address: '14800 Detroit Ave, Suite 200', city: 'Springfield', state: 'OH', zip: '44101', source: 'Commercial bid', sales_rep_id: reps[2] });
  await customer('summit', { type: 'builder', company: 'Summit Ridge Homes', first_name: 'Greg', last_name: 'Albrecht', phone: '(555) 014-4410', email: 'greg@example.com', address: '600 Commerce Pkwy', city: 'Westfield', state: 'OH', zip: '44105', source: 'Builder program', sales_rep_id: reps[2] });
  await customer('fischer', { first_name: 'Tom', last_name: 'Fischer', phone: '(555) 014-2047', address: '1240 Hilliard Blvd', city: 'Oak Grove', state: 'OH', zip: '44107', source: 'Facebook', sales_rep_id: reps[0] });
  await customer('washington', { first_name: 'Brenda', last_name: 'Washington', phone: '(555) 014-7312', email: 'bwash@example.com', address: '19 Arthur Ave', city: 'Springfield', state: 'OH', zip: '44101', source: 'Referral', sales_rep_id: reps[1] });
  await customer('chen', { first_name: 'Michael', last_name: 'Chen', phone: '(555) 014-9981', email: 'mchen@example.com', address: '4401 Madison Ave', city: 'Riverside', state: 'OH', zip: '44102', source: 'Google', sales_rep_id: reps[0] });
  await customer('russo', { first_name: 'Gina', last_name: 'Russo', phone: '(555) 014-3349', address: '88 Cohassett Ave', city: 'Westfield', state: 'OH', zip: '44105', source: 'Walk-in', sales_rep_id: reps[2] });

  // Helpers to build jobs
  const addRooms = (path, rooms) => call('POST', `${path}/rooms`, { rooms });
  const addLines = (path, lines) => call('POST', `${path}/lines`, { lines });
  const L = (key, qty, extra = {}) => ({ product_id: P[key].id, qty, ...extra });
  const setDates = (orderId, date) => db.run('UPDATE orders SET order_date = ?, created_at = ? WHERE id = ?', date, `${date}T15:00:00.000Z`, orderId);
  const quoteDate = (quoteId, date, sentDate) => db.run('UPDATE quotes SET quote_date = ?, created_at = ?, sent_at = ?, valid_until = ? WHERE id = ?',
    date, `${date}T15:00:00.000Z`, sentDate ? `${sentDate}T16:00:00.000Z` : null, addDays(date, 30), quoteId);

  const makeQuote = async (cust, title, rooms, lines, { date = today, rep } = {}) => {
    const q = await call('POST', '/quotes', { customer_id: C[cust], title, sales_rep_id: rep });
    if (rooms) await addRooms(`/quotes/${q.id}`, rooms);
    await addLines(`/quotes/${q.id}`, lines);
    quoteDate(q.id, date, null);
    return q.id;
  };
  const pay = async (orderId, amount, method, date) => {
    await call('POST', `/orders/${orderId}/payments`, { amount, method, date, reference: method === 'check' ? String(1000 + Math.floor(rand() * 8000)) : null });
  };
  const deposit = async (orderId, method, date) => {
    const o = await call('GET', `/orders/${orderId}`);
    await pay(orderId, Math.round(o.total * 0.5 * 100) / 100, method, date);
  };
  const acceptQuote = async (quoteId, signedName, date) => {
    const res = await call('POST', `/quotes/${quoteId}/accept`, { signed_name: signedName });
    setDates(res.order_id, date);
    db.run('UPDATE quotes SET signed_at = ? WHERE id = ?', signedName ? `${date}T17:00:00.000Z` : null, quoteId);
    return res.order_id;
  };

  // 1. Paid, done three weeks ago (pulled from stock roll)
  {
    const q = await makeQuote('hendricks', 'Living room & hall carpet',
      [{ name: 'Living room', length_ft: '18 6', width_ft: '14' }, { name: 'Hall', length_ft: '12', width_ft: '4' }],
      [L('twistSand', 37.67, { area: 'Living room, Hall' }), L('rebond', 37.67), L('laborCarpet', 37.67), L('furniture', 1)],
      { date: d(-34), rep: reps[0] });
    const o = await acceptQuote(q, 'Karen Hendricks', d(-33));
    await deposit(o, 'card', d(-33));
    const det = await call('GET', `/orders/${o}`);
    const carpetLine = det.lines.find((l) => l.product_id === P.twistSand.id);
    const padLine = det.lines.find((l) => l.product_id === P.rebond.id);
    await call('POST', `/lines/${carpetLine.id}/allocate`, { inventory_id: rollSand, qty: '28 3' });
    await call('POST', `/lines/${padLine.id}/allocate`, { inventory_id: padRoll, qty: 57 });
    const a = await call('POST', '/appointments', { type: 'install', order_id: o, installer_id: installers['Ortega Flooring'], date: d(-22), start_time: '08:30', duration_hours: 5 });
    await call('POST', `/appointments/${a.id}/complete`, { notes: 'Seam in hall. Customer happy.' });
    await call('POST', `/orders/${o}/invoice`, { date: d(-22) });
    const det2 = await call('GET', `/orders/${o}`);
    await pay(o, det2.balance, 'check', d(-21));
  }

  // 2. Invoiced, balance overdue
  let overdueOrder;
  {
    const q = await makeQuote('obrien', 'Basement LVP',
      [{ name: 'Basement', length_ft: '28', width_ft: '22' }],
      [L('coastal', 688), L('laborLvp', 616), L('prep', 616), L('tmold', 2)], { date: d(-58), rep: reps[0] });
    const o = await acceptQuote(q, "Sean O'Brien", d(-57));
    overdueOrder = o;
    await deposit(o, 'card', d(-57));
    db.run("UPDATE lines SET material_status = 'received' WHERE doc_type = 'order' AND doc_id = ? AND material_status != 'none'", o);
    const a = await call('POST', '/appointments', { type: 'install', order_id: o, installer_id: installers['Ortega Flooring'], date: d(-44), end_date: d(-43), start_time: '08:00' });
    await call('POST', `/appointments/${a.id}/complete`, {});
    await call('POST', `/orders/${o}/invoice`, { date: d(-43) });
    db.run('UPDATE orders SET due_date = ? WHERE id = ?', d(-43), o);
    await pay(o, 500, 'check', d(-30));
    await call('POST', '/notes', { entity_type: 'order', entity_id: o, body: 'Called about balance, said check is coming next week.' });
  }

  // 3. Installed yesterday, needs invoice
  {
    const q = await makeQuote('kowal', 'Kitchen sheet vinyl',
      [{ name: 'Kitchen', length_ft: '13', width_ft: '11 6' }],
      [L('sheet', 18.44), L('laborCarpet', 18.44, { description: 'Sheet vinyl installation', unit: 'SY' }), L('tearout', 150)], { date: d(-25), rep: reps[1] });
    const o = await acceptQuote(q, 'Ellen Kowal', d(-24));
    await deposit(o, 'card', d(-24));
    db.run("UPDATE lines SET material_status = 'received' WHERE doc_type = 'order' AND doc_id = ? AND material_status != 'none'", o);
    const a = await call('POST', '/appointments', { type: 'install', order_id: o, installer_id: installers['Rapid Carpet Crew'], date: d(-1), start_time: '09:00', duration_hours: 4 });
    await call('POST', `/appointments/${a.id}/complete`, { notes: 'Done. Left extra piece with customer.' });
  }

  // 4. Install tomorrow (carpet pulled from stock)
  {
    const q = await makeQuote('nguyen', 'Bedrooms carpet',
      [{ name: 'Primary bedroom', length_ft: '15', width_ft: '13' }, { name: 'Bedroom 2', length_ft: '11', width_ft: '10 6' }],
      [L('harbor', 37.17, { area: 'Primary, Bedroom 2' }), L('memory', 37.17), L('laborCarpet', 37.17), L('tearout', 311), L('furniture', 2)],
      { date: d(-12), rep: reps[1] });
    const o = await acceptQuote(q, 'David Nguyen', d(-11));
    await deposit(o, 'card', d(-11));
    const det = await call('GET', `/orders/${o}`);
    const roll = db.get("SELECT id FROM inventory WHERE tag = 'R-4602'").id;
    await call('POST', `/lines/${det.lines.find((l) => l.product_id === P.harbor.id).id}/allocate`, { inventory_id: roll, qty: '27 10' });
    const memRoll = db.get("SELECT id FROM inventory WHERE tag = 'P-114'").id;
    await call('POST', `/lines/${det.lines.find((l) => l.product_id === P.memory.id).id}/allocate`, { inventory_id: memRoll, qty: 56 });
    await call('POST', '/appointments', { type: 'install', order_id: o, installer_id: installers['Ortega Flooring'], date: d(1), start_time: '08:00', duration_hours: 6, notes: 'Two cats. Keep bedroom doors closed.' });
    await call('PUT', `/orders/${o}`, { install_notes: 'Park in driveway. Old carpet goes to dumpster at store.' });
  }

  // 5. Install today (LVP from stock)
  {
    const q = await makeQuote('patel', 'Main floor LVP',
      [{ name: 'Kitchen', length_ft: '14', width_ft: '12' }, { name: 'Dining', length_ft: '12', width_ft: '11' }, { name: 'Entry', length_ft: '8', width_ft: '6' }],
      [L('cedar', 425.52, { area: 'Kitchen, Dining, Entry' }), L('laborLvp', 360), L('quarter', 9), L('stairnose', 1), L('tearout', 360)],
      { date: d(-16), rep: reps[1] });
    const o = await acceptQuote(q, 'Anita Patel', d(-15));
    await deposit(o, 'financing', d(-15));
    const det = await call('GET', `/orders/${o}`);
    await call('POST', `/lines/${det.lines.find((l) => l.product_id === P.cedar.id).id}/allocate`, { inventory_id: cedarLot, qty: 18 });
    const qr = db.get('SELECT id FROM inventory WHERE product_id = ?', P.quarter.id).id;
    await call('POST', `/lines/${det.lines.find((l) => l.product_id === P.quarter.id).id}/allocate`, { inventory_id: qr, qty: 9 });
    const sn = db.get('SELECT id FROM inventory WHERE product_id = ?', P.stairnose.id).id;
    await call('POST', `/lines/${det.lines.find((l) => l.product_id === P.stairnose.id).id}/allocate`, { inventory_id: sn, qty: 1 });
    await call('POST', '/appointments', { type: 'install', order_id: o, installer_id: installers['Ortega Flooring'], date: today, start_time: '08:00', duration_hours: 8 });
  }

  // 6. Ready to schedule: special order hardwood received
  {
    const q = await makeQuote('martinez', 'Hardwood living & dining',
      [{ name: 'Living room', length_ft: '20', width_ft: '15' }, { name: 'Dining', length_ft: '13', width_ft: '12' }],
      [L('oak', 528, { area: 'Living, Dining' }), L('laborWood', 456), L('quarter', 10), L('furniture', 2)],
      { date: d(-20), rep: reps[2] });
    const o = await acceptQuote(q, 'Rosa Martinez', d(-19));
    await deposit(o, 'check', d(-19));
    const res = await call('POST', `/orders/${o}/order-material`, {});
    for (const poId of res.po_ids) {
      await call('POST', `/pos/${poId}/status`, { status: 'sent' });
      db.run('UPDATE purchase_orders SET expected_date = ?, created_at = ?, sent_at = ? WHERE id = ?', d(-6), `${d(-18)}T15:00:00.000Z`, `${d(-18)}T16:00:00.000Z`, poId);
      const po = await call('GET', `/pos/${poId}`);
      const items = po.lines.map((pl) => ({ po_line_id: pl.id, qty: pl.qty, dye_lot: pl.unit === 'BOX' ? 'HO-5521' : null, tag: pl.unit === 'BOX' ? 'L-HO-5521' : null, location: 'Staging: Martinez' }));
      await call('POST', `/pos/${poId}/receive`, { items, date: d(-5) });
    }
  }

  // 7. Material ordered, waiting on vendor (commercial)
  {
    const q = await makeQuote('lakeside', 'Waiting room & hallway carpet',
      [{ name: 'Waiting room', length_ft: '32', width_ft: '24' }, { name: 'Hallway', length_ft: '40', width_ft: '5' }],
      [L('loop', 118.67, { area: 'Waiting room, Hallway' }), L('laborCarpet', 107.56, { description: 'Commercial glue-down installation' }), L('tearout', 968), L('prep', 200)],
      { date: d(-10), rep: reps[2] });
    const o = await acceptQuote(q, 'Maria Gomez', d(-8));
    db.run('UPDATE orders SET customer_po = ? WHERE id = ?', 'LDG-2026-114', o);
    await deposit(o, 'check', d(-8));
    const res = await call('POST', `/orders/${o}/order-material`, {});
    for (const poId of res.po_ids) {
      await call('POST', `/pos/${poId}/status`, { status: 'sent' });
      db.run('UPDATE purchase_orders SET expected_date = ? WHERE id = ?', d(5), poId);
    }
    await call('POST', '/notes', { entity_type: 'order', entity_id: o, body: 'Install must be after hours or on a Saturday.' });
  }

  // 8. Signed today, needs material ordered
  {
    const q = await makeQuote('washington', 'Stairs & upstairs hall',
      [{ name: 'Upstairs hall', length_ft: '16', width_ft: '4' }],
      [L('twistPewter', 26, { area: 'Stairs (13), Hall', notes: 'Waterfall on stairs' }), L('rebond', 26), L('laborStairs', 13), L('laborCarpet', 8)],
      { date: d(-3), rep: reps[1] });
    const o = await acceptQuote(q, 'Brenda Washington', today);
    await deposit(o, 'card', today);
  }

  // 9. Builder order: tile, new
  {
    const o = (await call('POST', '/orders', { customer_id: C.summit, title: 'Lot 14 primary bath & laundry', sales_rep_id: reps[2] })).id;
    await addRooms(`/orders/${o}`, [{ name: 'Primary bath', length_ft: '11', width_ft: '9' }, { name: 'Laundry', length_ft: '8', width_ft: '7' }]);
    await addLines(`/orders/${o}`, [L('slate', 182), L('laborTile', 155), L('thinset', 4), L('grout', 2)]);
    setDates(o, d(-2));
    await call('PUT', `/orders/${o}`, { customer_po: 'SRH-L14-07', install_notes: 'Builder super: Greg. Lockbox code on file at office.' });
  }

  // Open quotes
  {
    const q1 = await makeQuote('baker', 'Family room carpet',
      [{ name: 'Family room', length_ft: '22', width_ft: '16' }],
      [L('plush', 41.73), L('memory', 41.73), L('laborCarpet', 41.73), L('furniture', 1)], { date: d(-7), rep: reps[0] });
    await call('POST', `/quotes/${q1}/status`, { status: 'sent' });
    quoteDate(q1, d(-7), d(-6));
    const q2 = await makeQuote('fischer', 'Whole house laminate',
      [{ name: 'Living', length_ft: '18', width_ft: '15' }, { name: 'Kitchen', length_ft: '12', width_ft: '12' }, { name: 'Hall', length_ft: '20', width_ft: '3 6' }],
      [L('laminate', 589, { area: 'Living, Kitchen, Hall' }), L('laborLvp', 484), L('quarter', 18), L('tearout', 484)], { date: d(-2), rep: reps[0] });
    await call('POST', `/quotes/${q2}/status`, { status: 'sent' });
    quoteDate(q2, d(-2), d(-2));
    await makeQuote('chen', 'Guest bath tile', [{ name: 'Guest bath', length_ft: '8', width_ft: '5' }],
      [L('marble', 46.5), L('laborTile', 40), L('thinset', 1), L('grout', 1)], { date: today, rep: reps[0] });
    const q4 = await makeQuote('russo', 'Bedroom carpet', [{ name: 'Bedroom', length_ft: '12', width_ft: '11' }],
      [L('twistSand', 15.33), L('rebond', 15.33), L('laborCarpet', 15.33)], { date: d(-40), rep: reps[2] });
    await call('POST', `/quotes/${q4}/status`, { status: 'declined' });
    quoteDate(q4, d(-40), d(-39));
  }

  // Measures and other appointments
  await call('POST', '/appointments', { type: 'measure', customer_id: C.chen, date: today, start_time: '15:30', duration_hours: 1, notes: 'Check subfloor in guest bath.' });
  await call('POST', '/appointments', { type: 'measure', customer_id: C.russo, date: d(2), start_time: '10:00', duration_hours: 1 });
  await call('POST', '/appointments', { type: 'service', customer_id: C.hendricks, installer_id: installers['Ortega Flooring'], date: d(3), start_time: '13:00', duration_hours: 1, title: 'Restretch hall seam' });

  // Stock reorder waiting to be sent
  await call('POST', '/pos', { vendor_id: vendors['Great Lakes Flooring Supply'], notes: 'Stock reorder', lines: [{ product_id: P.quarter.id, qty: 40 }, { product_id: P.rebond.id, qty: 180 }] });

  // Six months of finished jobs for the reports
  const historyCustomers = [];
  const first = ['Linda', 'Robert', 'Susan', 'Kevin', 'Nancy', 'Brian', 'Laura', 'Gary', 'Megan', 'Paul', 'Diane', 'Eric', 'Heather', 'Scott', 'Julie', 'Mark', 'Amy', 'Chris'];
  const last = ['Sullivan', 'Novak', 'Brooks', 'Hughes', 'Price', 'Jensen', 'Reed', 'Morgan', 'Kelly', 'Foster', 'Ward', 'Bennett', 'Gray', 'Murphy', 'Ross', 'Coleman', 'Perry', 'Long'];
  for (let i = 0; i < 18; i++) {
    historyCustomers.push((await call('POST', '/customers', {
      first_name: first[i], last_name: last[i], phone: `(555) 015-${String(1000 + i * 37).slice(-4)}`,
      address: `${100 + i * 23} ${pick(['Oak', 'Maple', 'Cedar', 'Park', 'Lake', 'Hill'])} ${pick(['St', 'Ave', 'Rd', 'Dr'])}`,
      city: pick(['Springfield', 'Riverside', 'Westfield', 'Oak Grove']), state: 'OH', zip: '4410' + (i % 8), source: pick(['Google', 'Referral', 'Walk-in', 'Repeat customer', 'Facebook']),
      sales_rep_id: pick(reps),
    })).id);
  }
  const jobs = [
    () => { const sy = 30 + Math.round(rand() * 40); return [L(pick(['twistSand', 'twistPewter', 'harbor', 'plush']), sy), L(pick(['rebond', 'memory']), sy), L('laborCarpet', sy), L('furniture', 1 + Math.floor(rand() * 3))]; },
    () => { const sf = 250 + Math.round(rand() * 600); return [L(pick(['cedar', 'coastal', 'laminate']), Math.round(sf * 1.1)), L('laborLvp', sf), L('tearout', sf), L('quarter', Math.round(sf / 40))]; },
    () => { const sf = 300 + Math.round(rand() * 500); return [L('oak', Math.round(sf * 1.1)), L('laborWood', sf), L('quarter', Math.round(sf / 40))]; },
    () => { const sf = 40 + Math.round(rand() * 160); return [L(pick(['marble', 'slate']), Math.round(sf * 1.15)), L('laborTile', sf), L('thinset', 2), L('grout', 1)]; },
  ];
  const crews = Object.values(installers);
  for (let i = 0; i < 34; i++) {
    const date = d(-(20 + Math.floor(rand() * 160)));
    const kind = Math.floor(rand() * 10);
    const lines = jobs[kind < 4 ? 0 : kind < 7 ? 1 : kind < 9 ? 2 : 3]();
    const cust = pick(historyCustomers);
    const rep = pick(reps);
    const title = pick(['Bedrooms', 'Main floor', 'Basement', 'Kitchen', 'Living room', 'Bath', 'Whole house', 'Stairs & hall']);
    let o;
    if (rand() < 0.75) {
      const qid = (await call('POST', '/quotes', { customer_id: cust, sales_rep_id: rep, title })).id;
      await addLines(`/quotes/${qid}`, lines);
      quoteDate(qid, addDays(date, -3), addDays(date, -2));
      o = (await call('POST', `/quotes/${qid}/accept`, {})).order_id;
    } else {
      o = (await call('POST', '/orders', { customer_id: cust, sales_rep_id: rep, title })).id;
      await addLines(`/orders/${o}`, lines);
    }
    if (rand() < 0.3) await call('PUT', `/orders/${o}`, { discount: 50 + Math.floor(rand() * 4) * 50 });
    setDates(o, date);
    db.run("UPDATE lines SET material_status = 'received' WHERE doc_type = 'order' AND doc_id = ? AND material_status != 'none'", o);
    await deposit(o, pick(['card', 'card', 'check', 'financing']), date);
    const a = await call('POST', '/appointments', { type: 'install', order_id: o, installer_id: pick(crews), date: addDays(date, 9 + Math.floor(rand() * 8)), start_time: '08:00' });
    await call('POST', `/appointments/${a.id}/complete`, {});
    const inv = addDays(date, 14 + Math.floor(rand() * 6));
    if (inv < today) {
      await call('POST', `/orders/${o}/invoice`, { date: inv });
      const det = await call('GET', `/orders/${o}`);
      const payDate = addDays(inv, Math.floor(rand() * 5));
      await pay(o, det.balance, pick(['card', 'check', 'card']), payDate <= today ? payDate : today);
    }
  }

  // Quotes over the same period so close rate has history
  for (let i = 0; i < 14; i++) {
    const date = d(-(20 + Math.floor(rand() * 160)));
    const q = (await call('POST', '/quotes', { customer_id: pick(historyCustomers), sales_rep_id: pick(reps), title: pick(['Bedroom carpet', 'Kitchen LVP', 'Basement', 'Stairs']) })).id;
    await addLines(`/quotes/${q}`, jobs[Math.floor(rand() * 2)]());
    await call('POST', `/quotes/${q}/status`, { status: 'declined' });
    quoteDate(q, date, addDays(date, 1));
  }

  // Make the overdue reminder realistic
  db.run('UPDATE orders SET updated_at = ? WHERE id = ?', `${d(-30)}T15:00:00.000Z`, overdueOrder);
  return { users: DEMO_USERS };
}
