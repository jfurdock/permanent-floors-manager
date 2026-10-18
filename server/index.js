// Store Manager server: serves the web app and the API from one small Node process.
// No packages needed at runtime. Data lives in DATA_DIR/store.db (SQLite).
//
// Settings (environment variables):
//   PORT              port to listen on (default 3000)
//   HOST              address to listen on (default 0.0.0.0)
//   DATA_DIR          folder for store.db and daily backups (default ./data)
//   ACCESS_CODE       when set, every device must enter this store code once before anyone can sign in
//   SEED_SAMPLE_DATA  "true" loads the sample store the first time the database is empty
//   TRUST_PROXY       "true" when running behind a hosting proxy (Render, Fly, Caddy) so client IPs are read correctly

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi } from '../core/api/index.js';
import { wipeAll } from '../core/schema.js';
import { seedDemo } from '../core/seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const DIST = path.join(root, 'dist');
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const SEED_SAMPLE = /^(1|true|yes)$/i.test(process.env.SEED_SAMPLE_DATA || '');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUPS_KEPT = 14;

fs.mkdirSync(DATA_DIR, { recursive: true });
const dbFile = path.join(DATA_DIR, 'store.db');
const db = openDb(dbFile);
const api = createApi(db);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
};

function headersFor(req) {
  const https = TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https');
  return https ? { ...SECURITY_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' } : SECURITY_HEADERS;
}

function send(req, res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headersFor(req), ...headers });
  res.end(data);
}

function readBody(req, limit = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const clientIp = (req) => (TRUST_PROXY && req.headers['x-forwarded-for']
  ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
  : req.socket.remoteAddress || 'unknown');

function tokenFrom(req, url) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return url.searchParams.get('token');
}

// ---------- store access code ----------
// A device that enters the code gets a signed token. Changing ACCESS_CODE signs every device out.
const deviceKey = ACCESS_CODE ? crypto.createHash('sha256').update(`pf-device:${ACCESS_CODE}`).digest() : null;
const signDevice = (id) => crypto.createHmac('sha256', deviceKey).update(id).digest('hex');
function deviceOk(req) {
  if (!ACCESS_CODE) return true;
  const t = String(req.headers['x-device-token'] || '');
  const [id, sig] = t.split('.');
  if (!id || !sig || sig.length !== 64) return false;
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signDevice(id), 'hex'));
}
function codeMatches(code) {
  const a = crypto.createHash('sha256').update(String(code || '').trim().toLowerCase()).digest();
  const b = crypto.createHash('sha256').update(ACCESS_CODE.toLowerCase()).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- rate limiting for sign-in ----------
const attempts = new Map(); // ip -> { count, start }
const WINDOW_MS = 15 * 60 * 1000;
function tooMany(ip, max) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.start > WINDOW_MS) { attempts.set(ip, { count: 1, start: now }); return false; }
  a.count += 1;
  return a.count > max;
}
setInterval(() => { const now = Date.now(); for (const [ip, a] of attempts) if (now - a.start > WINDOW_MS) attempts.delete(ip); }, 60000).unref();

// ---------- backups ----------
function backupTo(file) {
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}
function dailyBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `store-${stamp}.db`);
    if (!fs.existsSync(file)) backupTo(file);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^store-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(BACKUPS_KEPT);
    for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f));
  } catch (e) { console.error('Backup failed:', e.message); }
}
setTimeout(dailyBackup, 60 * 1000).unref();
setInterval(dailyBackup, 60 * 60 * 1000).unref();

async function whoIs(token) {
  const me = await api.handle({ method: 'GET', path: '/auth/me', token });
  return me.status === 200 ? me.body.user : null;
}

async function loadSampleData() {
  await seedDemo(api, { storeName: 'Permanent Floors Carpet One' });
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_mode', '1')");
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const apiPath = url.pathname.slice(4) || '/';
  const token = tokenFrom(req, url);
  const ip = clientIp(req);

  if (apiPath === '/health') {
    try { db.get('SELECT 1 AS ok'); return send(req, res, 200, { ok: true }); } catch { return send(req, res, 503, { ok: false }); }
  }

  if (apiPath === '/access') {
    if (req.method === 'GET') return send(req, res, 200, { required: !!ACCESS_CODE, ok: deviceOk(req) }, { 'Cache-Control': 'no-store' });
    if (req.method === 'POST') {
      if (!ACCESS_CODE) return send(req, res, 200, { device_token: null });
      if (tooMany(`code:${ip}`, 10)) return send(req, res, 429, { error: 'Too many tries. Wait 15 minutes and try again.' });
      let body = {};
      try { body = await readBody(req, 10000); } catch { /* empty */ }
      if (!codeMatches(body.code)) return send(req, res, 400, { error: 'That store code isn’t right. Check with the store owner.' });
      const id = crypto.randomBytes(12).toString('hex');
      return send(req, res, 200, { device_token: `${id}.${signDevice(id)}` });
    }
  }

  if (!deviceOk(req)) return send(req, res, 401, { error: 'Enter the store code to continue.', access_required: true }, { 'Cache-Control': 'no-store' });

  if ((apiPath === '/auth/login' || apiPath === '/auth/setup') && req.method === 'POST' && tooMany(`login:${ip}`, 30)) {
    return send(req, res, 429, { error: 'Too many sign-in attempts from this device. Wait 15 minutes and try again.' });
  }

  // Raw database backup for owners and managers.
  if (req.method === 'GET' && apiPath === '/backup') {
    const user = await whoIs(token);
    if (!user || !['admin', 'manager'].includes(user.role)) return send(req, res, 403, { error: 'Only owners and managers can download backups.' });
    const tmp = path.join(os.tmpdir(), `pf-backup-${Date.now()}.db`);
    backupTo(tmp);
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, { ...headersFor(req), 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="store-backup-${stamp}.db"` });
    fs.createReadStream(tmp).on('close', () => fs.rm(tmp, () => {})).pipe(res);
    return;
  }

  // Owner only: reload the sample store, or erase everything and start with an empty store.
  if (req.method === 'POST' && apiPath === '/admin/reset') {
    const user = await whoIs(token);
    if (!user || user.role !== 'admin') return send(req, res, 403, { error: 'Only the owner can do this.' });
    let body = {};
    try { body = await readBody(req, 10000); } catch { /* empty */ }
    if (!['sample', 'empty'].includes(body.mode)) return send(req, res, 400, { error: 'Choose sample data or an empty store.' });
    if (body.confirm !== 'ERASE') return send(req, res, 400, { error: 'Type ERASE to confirm.' });
    try { backupTo(path.join(DATA_DIR, `before-reset-${Date.now()}.db`)); } catch (e) { console.error(e); }
    wipeAll(db);
    if (body.mode === 'sample') await loadSampleData();
    return send(req, res, 200, { ok: true, mode: body.mode });
  }

  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { body = await readBody(req); } catch (e) { return send(req, res, e.status || 400, { error: e.message }); }
  }
  const query = Object.fromEntries(url.searchParams.entries());
  const result = await api.handle({ method: req.method, path: apiPath, query, body, token });
  send(req, res, result.status, result.body, { 'Cache-Control': 'no-store' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return send(req, res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    return send(req, res, 503, 'The web app has not been built yet. Run "npm run build" and restart.', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    ...headersFor(req),
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(req, res, 500, { error: 'Server error' });
  }
});

if (SEED_SAMPLE && db.get('SELECT COUNT(*) AS n FROM users').n === 0) {
  await loadSampleData();
  console.log('Loaded the sample store (SEED_SAMPLE_DATA is on).');
}

server.listen(PORT, HOST, () => {
  const addrs = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log('\nStore Manager is running.');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  On phones (Wi-Fi):  http://${a}:${PORT}`);
  console.log(`  Data file:          ${dbFile}`);
  console.log(`  Store code:         ${ACCESS_CODE ? 'required (ACCESS_CODE is set)' : 'off'}\n`);
});

const shutdown = () => {
  server.close();
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* closed */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
