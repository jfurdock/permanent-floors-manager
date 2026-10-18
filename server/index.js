// Store Manager server: serves the web app and the API from one small Node process.
// No packages needed at runtime. Data lives in ./data/store.db (SQLite).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi } from '../core/api/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const DIST = path.join(root, 'dist');

fs.mkdirSync(DATA_DIR, { recursive: true });
const dbFile = path.join(DATA_DIR, 'store.db');
const db = openDb(dbFile);
const api = createApi(db);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
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

function tokenFrom(req, url) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return url.searchParams.get('token');
}

async function handleApi(req, res, url) {
  const apiPath = url.pathname.slice(4) || '/';
  const token = tokenFrom(req, url);

  // Raw database backup for owners and managers.
  if (req.method === 'GET' && apiPath === '/backup') {
    const me = await api.handle({ method: 'GET', path: '/auth/me', token });
    if (me.status !== 200 || !['admin', 'manager'].includes(me.body.user.role)) return send(res, 403, { error: 'Only owners and managers can download backups.' });
    const tmp = path.join(os.tmpdir(), `pf-backup-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="store-backup-${stamp}.db"` });
    fs.createReadStream(tmp).on('close', () => fs.rm(tmp, () => {})).pipe(res);
    return;
  }

  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  }
  const query = Object.fromEntries(url.searchParams.entries());
  const result = await api.handle({ method: req.method, path: apiPath, query, body, token });
  send(res, result.status, result.body, { 'Cache-Control': 'no-store' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    return send(res, 503, 'The web app has not been built yet. Run "npm run build" and restart.', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  const addrs = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log('\nStore Manager is running.');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  On phones (Wi-Fi):  http://${a}:${PORT}`);
  console.log(`  Data file:          ${dbFile}\n`);
});

const shutdown = () => { server.close(); try { db.close(); } catch { /* closed */ } process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
