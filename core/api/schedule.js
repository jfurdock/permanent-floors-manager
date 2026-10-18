import { bad, str, int, num, nowIso, localDate, addDays, isDate, customerName, forbidden } from '../util.js';
import { APPOINTMENT_TYPES } from '../calc.js';
import { must, advanceStage, EVERYONE } from './shared.js';

const SELECT = `SELECT a.*, i.name AS installer_name, i.color AS installer_color, i.phone AS installer_phone,
       c.first_name, c.last_name, c.company, c.phone AS customer_phone,
       o.number AS order_number, o.title AS order_title, o.stage AS order_stage
  FROM appointments a
  LEFT JOIN installers i ON i.id = a.installer_id
  LEFT JOIN customers c ON c.id = a.customer_id
  LEFT JOIN orders o ON o.id = a.order_id`;

const addressLine = (street, city, state, zip) => [street, [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null;

const shape = (a) => ({ ...a, customer_name: a.customer_id ? customerName(a) : null });

function clean(db, body, existing = {}) {
  const out = {};
  const merged = { ...existing, ...body };
  out.type = APPOINTMENT_TYPES.some((t) => t.id === merged.type) ? merged.type : 'install';
  out.date = isDate(merged.date) ? merged.date : null;
  if (!out.date) bad('Pick a date.');
  out.end_date = isDate(merged.end_date) && merged.end_date > out.date ? merged.end_date : null;
  out.start_time = /^\d{2}:\d{2}$/.test(String(merged.start_time || '')) ? merged.start_time : null;
  out.duration_hours = merged.duration_hours === '' || merged.duration_hours === null || merged.duration_hours === undefined ? null : Math.max(0, num(merged.duration_hours));
  out.installer_id = int(merged.installer_id);
  if (out.installer_id) must(db.get('SELECT id FROM installers WHERE id = ?', out.installer_id), 'Installer');
  out.order_id = int(merged.order_id);
  out.customer_id = int(merged.customer_id);
  out.title = str(merged.title, 160);
  out.address = str(merged.address, 300);
  out.notes = str(merged.notes, 2000);
  if (out.order_id) {
    const o = must(db.get('SELECT * FROM orders WHERE id = ?', out.order_id), 'Order');
    if (o.stage === 'cancelled' && existing.order_id !== o.id) bad('This order is cancelled.');
    out.customer_id = o.customer_id;
    if (!out.address) out.address = addressLine(o.job_address, o.job_city, o.job_state, o.job_zip);
  }
  if (out.customer_id && !out.address) {
    const c = db.get('SELECT * FROM customers WHERE id = ?', out.customer_id);
    if (c) out.address = addressLine(c.address, c.city, c.state, c.zip);
  }
  if (!out.customer_id && !out.title) bad('Add a customer or a title.');
  return out;
}

function conflicts(db, appt, excludeId = 0) {
  if (!appt.installer_id) return [];
  const end = appt.end_date || appt.date;
  return db.all(
    `${SELECT} WHERE a.installer_id = ? AND a.id != ? AND a.status NOT IN ('cancelled','done')
       AND a.date <= ? AND COALESCE(a.end_date, a.date) >= ?`, appt.installer_id, excludeId, end, appt.date).map(shape);
}

function canTouch(db, user, appt) {
  if (user.role !== 'installer') return true;
  return user.installer_id && appt.installer_id === user.installer_id;
}

export function register(r) {
  r.get('/appointments', ({ db, query, user }) => {
    const from = isDate(query.from) ? query.from : localDate();
    const to = isDate(query.to) ? query.to : addDays(from, 6);
    const conds = ['a.date <= ?', 'COALESCE(a.end_date, a.date) >= ?'];
    const params = [to, from];
    if (user.role === 'installer') { conds.push('a.installer_id = ?'); params.push(user.installer_id || -1); }
    else if (query.installer_id === 'none') conds.push('a.installer_id IS NULL');
    else if (query.installer_id) { conds.push('a.installer_id = ?'); params.push(int(query.installer_id)); }
    if (query.type) { conds.push('a.type = ?'); params.push(query.type); }
    if (query.order_id) { conds.push('a.order_id = ?'); params.push(int(query.order_id)); }
    if (query.include_cancelled !== '1') conds.push("a.status != 'cancelled'");
    return db.all(`${SELECT} WHERE ${conds.join(' AND ')} ORDER BY a.date, COALESCE(a.start_time, '99:99'), a.id`, ...params).map(shape);
  }, { roles: EVERYONE });

  r.get('/appointments/:id', ({ db, params, user }) => {
    const a = must(db.get(`${SELECT} WHERE a.id = ?`, params.id), 'Appointment');
    if (!canTouch(db, user, a)) forbidden('This job isn’t assigned to you.');
    return shape(a);
  }, { roles: EVERYONE });

  r.post('/appointments', ({ db, body, user, log }) => {
    const data = clean(db, body);
    const now = nowIso();
    const id = db.run(
      `INSERT INTO appointments (type, status, order_id, customer_id, installer_id, date, end_date, start_time, duration_hours, title, address, notes, created_by, created_at, updated_at)
       VALUES (?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.type, data.order_id, data.customer_id, data.installer_id, data.date, data.end_date, data.start_time, data.duration_hours,
      data.title, data.address, data.notes, user.id, now, now).lastInsertRowid;
    if (data.order_id && data.type === 'install') advanceStage(db, user, data.order_id, 'scheduled');
    if (data.order_id) log('order', data.order_id, 'scheduled', `${data.type} on ${data.date}`);
    const appt = shape(db.get(`${SELECT} WHERE a.id = ?`, id));
    return { ...appt, conflicts: conflicts(db, appt, id) };
  });

  r.put('/appointments/:id', ({ db, params, body, user }) => {
    const a = must(db.get('SELECT * FROM appointments WHERE id = ?', params.id), 'Appointment');
    const data = clean(db, body, a);
    db.run(
      `UPDATE appointments SET type = ?, order_id = ?, customer_id = ?, installer_id = ?, date = ?, end_date = ?, start_time = ?, duration_hours = ?,
         title = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?`,
      data.type, data.order_id, data.customer_id, data.installer_id, data.date, data.end_date, data.start_time, data.duration_hours,
      data.title, data.address, data.notes, nowIso(), a.id);
    if (data.order_id && data.type === 'install') advanceStage(db, user, data.order_id, 'scheduled');
    const appt = shape(db.get(`${SELECT} WHERE a.id = ?`, a.id));
    return { ...appt, conflicts: conflicts(db, appt, a.id) };
  });

  r.post('/appointments/:id/status', ({ db, params, body, user }) => {
    const a = must(db.get('SELECT * FROM appointments WHERE id = ?', params.id), 'Appointment');
    if (!canTouch(db, user, a)) forbidden('This job isn’t assigned to you.');
    const status = body.status;
    if (!['scheduled', 'confirmed', 'in_progress', 'cancelled'].includes(status)) bad('Unknown status.');
    if (user.role === 'installer' && status === 'cancelled') forbidden('Ask the office to cancel a job.');
    db.run('UPDATE appointments SET status = ?, completed_at = NULL, updated_at = ? WHERE id = ?', status, nowIso(), a.id);
    return shape(db.get(`${SELECT} WHERE a.id = ?`, a.id));
  }, { roles: EVERYONE });

  r.post('/appointments/:id/complete', ({ db, params, body, user, log }) => {
    const a = must(db.get('SELECT * FROM appointments WHERE id = ?', params.id), 'Appointment');
    if (!canTouch(db, user, a)) forbidden('This job isn’t assigned to you.');
    if (a.status === 'cancelled') bad('This appointment is cancelled.');
    db.run("UPDATE appointments SET status = 'done', completed_at = ?, completion_notes = ?, updated_at = ? WHERE id = ?",
      nowIso(), str(body.notes, 2000), nowIso(), a.id);
    if (a.order_id && a.type === 'install') {
      advanceStage(db, user, a.order_id, 'installed');
      log('order', a.order_id, 'install completed', str(body.notes, 300));
    }
    return shape(db.get(`${SELECT} WHERE a.id = ?`, a.id));
  }, { roles: EVERYONE });

  r.del('/appointments/:id', ({ db, params }) => {
    must(db.get('SELECT id FROM appointments WHERE id = ?', params.id), 'Appointment');
    db.run('DELETE FROM appointments WHERE id = ?', params.id);
    return { ok: true };
  });
}
