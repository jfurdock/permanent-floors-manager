import { bad, str, int, nowIso, forbidden } from '../util.js';
import { ROLES } from '../calc.js';
import { DEFAULT_SETTINGS } from '../schema.js';
import { must, getSettings, MANAGERS, EVERYONE } from './shared.js';
import { setPin, publicUser } from './auth.js';

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

export function register(r) {
  r.get('/settings', ({ settings }) => settings(), { roles: EVERYONE });

  r.put('/settings', ({ db, body }) => {
    const NUMERIC = { tax_rate: [0, 25, 'Sales tax rate'], deposit_percent: [0, 100, 'Deposit'], quote_valid_days: [0, 365, 'Quote days'], invoice_due_days: [0, 365, 'Invoice due days'], remnant_max_ft: [0, 200, 'Remnant cutoff'] };
    for (const [key, [min, max, label]] of Object.entries(NUMERIC)) {
      if (key in body) {
        const n = Number(body[key]);
        if (body[key] === '' || !Number.isFinite(n) || n < min || n > max) bad(`${label} must be a number from ${min} to ${max}.`);
      }
    }
    for (const key of SETTING_KEYS) {
      if (key in body) {
        const v = body[key] === null || body[key] === undefined ? '' : String(body[key]).slice(0, 4000);
        db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, v);
      }
    }
    if (!getSettings(db).store_name) bad('Enter the store name.');
    return getSettings(db);
  }, { roles: MANAGERS });

  // ---------- users ----------
  r.get('/users', ({ db, query }) => db.all(
    `SELECT u.id, u.name, u.role, u.email, u.phone, u.installer_id, u.active, u.created_at, i.name AS installer_name,
            (u.pin_hash IS NOT NULL) AS has_pin
       FROM users u LEFT JOIN installers i ON i.id = u.installer_id
      ${query.active === 'all' ? '' : 'WHERE u.active = 1'} ORDER BY u.active DESC, u.name`));

  r.post('/users', async ({ db, body, user }) => {
    const name = str(body.name, 80);
    if (!name) bad('Enter a name.');
    const role = ROLES.some((x) => x.id === body.role) ? body.role : 'sales';
    if (role === 'admin' && user.role !== 'admin') forbidden('Only an owner can add another owner.');
    const installerId = int(body.installer_id);
    if (role === 'installer' && !installerId) bad('Link installer logins to an installer or crew.');
    const id = db.run('INSERT INTO users (name, role, email, phone, installer_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
      name, role, str(body.email, 120), str(body.phone, 40), role === 'installer' ? installerId : null, nowIso()).lastInsertRowid;
    await setPin(db, id, body.pin);
    return publicUser(db.get('SELECT * FROM users WHERE id = ?', id));
  }, { roles: MANAGERS });

  r.put('/users/:id', ({ db, params, body, user }) => {
    const u = must(db.get('SELECT * FROM users WHERE id = ?', params.id), 'User');
    if (u.role === 'admin' && user.role !== 'admin') forbidden('Only an owner can change an owner.');
    const role = 'role' in body ? (ROLES.some((x) => x.id === body.role) ? body.role : u.role) : u.role;
    if (role === 'admin' && user.role !== 'admin') forbidden('Only an owner can make someone an owner.');
    const active = 'active' in body ? (body.active ? 1 : 0) : u.active;
    if (u.role === 'admin' && (role !== 'admin' || !active)) {
      const admins = db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?", u.id).n;
      if (!admins) bad('Keep at least one active owner account.');
    }
    const installerId = 'installer_id' in body ? int(body.installer_id) : u.installer_id;
    if (role === 'installer' && !installerId) bad('Link installer logins to an installer or crew.');
    db.run('UPDATE users SET name = ?, role = ?, email = ?, phone = ?, installer_id = ?, active = ? WHERE id = ?',
      str(body.name, 80) || u.name, role, 'email' in body ? str(body.email, 120) : u.email, 'phone' in body ? str(body.phone, 40) : u.phone,
      role === 'installer' ? installerId : null, active, u.id);
    if (!active) db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    return publicUser(db.get('SELECT * FROM users WHERE id = ?', u.id));
  }, { roles: MANAGERS });

  r.post('/users/:id/pin', async ({ db, params, body, user }) => {
    const u = must(db.get('SELECT * FROM users WHERE id = ?', params.id), 'User');
    if (u.role === 'admin' && user.role !== 'admin') forbidden('Only an owner can reset an owner’s PIN.');
    await setPin(db, u.id, body.pin);
    db.run('DELETE FROM sessions WHERE user_id = ? AND user_id != ?', u.id, user.id);
    return { ok: true };
  }, { roles: MANAGERS });

  // Anyone can change their own PIN.
  r.post('/me/pin', async ({ db, body, user }) => {
    await setPin(db, user.id, body.pin);
    return { ok: true };
  }, { roles: EVERYONE });

  // Full data export (JSON) for backups or moving to another system.
  r.get('/admin/export', ({ db }) => {
    const tables = ['settings', 'counters', 'installers', 'customers', 'vendors', 'products', 'quotes', 'orders', 'lines', 'rooms',
      'payments', 'purchase_orders', 'po_lines', 'inventory', 'inventory_tx', 'appointments', 'notes', 'activity'];
    const out = { exported_at: nowIso(), app: 'permanent-floors-manager', version: 1, tables: {} };
    for (const t of tables) out.tables[t] = db.all(`SELECT * FROM ${t}`);
    out.tables.users = db.all('SELECT id, name, role, email, phone, installer_id, active, created_at FROM users');
    return out;
  }, { roles: MANAGERS });
}
