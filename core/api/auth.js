import { bad, ApiError, randomToken, hashPin, nowIso, str, int } from '../util.js';
import { EVERYONE } from './shared.js';

const SESSION_DAYS = 30;
const failures = new Map(); // user_id -> { count, until }

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, role: u.role, email: u.email, phone: u.phone, installer_id: u.installer_id };
}

export function authenticate(db, token) {
  if (!token) return null;
  const row = db.get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    token, nowIso(),
  );
  return row || null;
}

export async function setPin(db, userId, pin) {
  const p = String(pin || '');
  if (!/^\d{4,8}$/.test(p)) bad('PIN must be 4 to 8 digits.');
  const salt = randomToken(16);
  const hash = await hashPin(p, salt);
  db.run('UPDATE users SET pin_hash = ?, pin_salt = ? WHERE id = ?', hash, salt, userId);
}

function startSession(db, userId) {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, userId, now.toISOString(), expires.toISOString());
  db.run('DELETE FROM sessions WHERE expires_at < ?', now.toISOString());
  return token;
}

export function register(r) {
  r.get('/auth/users', ({ db, settings }) => {
    const users = db.all(
      `SELECT id, name, role FROM users WHERE active = 1
        ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'sales' THEN 2 WHEN 'warehouse' THEN 3 ELSE 4 END, name`);
    const s = settings();
    return { users, setup_needed: users.length === 0, store_name: s.store_name, demo: s.demo_mode === '1' };
  }, { public: true });

  // First run: create the owner account.
  r.post('/auth/setup', async ({ db, body }) => {
    const count = db.get('SELECT COUNT(*) AS n FROM users').n;
    if (count > 0) bad('Setup is already done. Sign in instead.');
    const name = str(body.name, 80);
    if (!name) bad('Enter your name.');
    const id = db.run("INSERT INTO users (name, role, active, created_at) VALUES (?, 'admin', 1, ?)", name, nowIso()).lastInsertRowid;
    await setPin(db, id, body.pin);
    if (str(body.store_name)) db.run("UPDATE settings SET value = ? WHERE key = 'store_name'", str(body.store_name, 120));
    const user = db.get('SELECT * FROM users WHERE id = ?', id);
    return { token: startSession(db, id), user: publicUser(user) };
  }, { public: true });

  r.post('/auth/login', async ({ db, body }) => {
    const id = int(body.user_id);
    const user = id ? db.get('SELECT * FROM users WHERE id = ? AND active = 1', id) : null;
    if (!user) bad('Choose your name to sign in.');
    const f = failures.get(id);
    if (f && f.until > Date.now()) {
      const secs = Math.ceil((f.until - Date.now()) / 1000);
      throw new ApiError(429, `Too many tries. Wait ${secs > 90 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`} and try again.`);
    }
    const hash = user.pin_salt ? await hashPin(String(body.pin || ''), user.pin_salt) : null;
    if (!hash || hash !== user.pin_hash) {
      // 5 wrong PINs locks this person out for a minute; every 5 after that, for 15 minutes.
      const next = { count: (f?.count || 0) + 1, until: 0, rounds: f?.rounds || 0 };
      if (next.count >= 5) {
        next.rounds += 1;
        next.until = Date.now() + (next.rounds > 1 ? 15 * 60000 : 60000);
        next.count = 0;
      }
      failures.set(id, next);
      bad('That PIN didn’t match. Try again.');
    }
    failures.delete(id);
    return { token: startSession(db, id), user: publicUser(user) };
  }, { public: true });

  r.post('/auth/logout', ({ db, token }) => {
    db.run('DELETE FROM sessions WHERE token = ?', token);
    return { ok: true };
  }, { roles: EVERYONE });

  r.get('/auth/me', ({ user, settings }) => {
    const s = settings();
    return { user: publicUser(user), settings: s };
  }, { roles: EVERYONE });
}
