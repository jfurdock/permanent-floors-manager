// Demo only: runs the real API against SQLite compiled to JavaScript, saved in this browser.
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { createApi } from '@core/api/index.js';
import { seedDemo } from '@core/seed.js';

const DB_NAME = 'pf-demo';
const STORE = 'files';
const KEY = 'store-v2';

function idb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
async function loadBytes() {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function saveBytes(bytes) {
  try {
    const db = await idb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, KEY);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch { /* storage unavailable: the demo still works for this visit */ }
}

function wrap(raw) {
  const state = { inTx: false };
  const bind = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const all = (sql, ...p) => {
    const st = raw.prepare(sql);
    try {
      st.bind(bind(p));
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally { st.free(); }
  };
  return {
    state,
    all,
    get: (sql, ...p) => all(sql, ...p)[0],
    run: (sql, ...p) => {
      raw.run(sql, bind(p));
      const changes = raw.getRowsModified();
      const id = raw.exec('SELECT last_insert_rowid()')[0]?.values?.[0]?.[0] ?? 0;
      return { changes, lastInsertRowid: Number(id) };
    },
    exec: (sql) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('BEGIN')) state.inTx = true;
      if (s.startsWith('COMMIT') || s.startsWith('ROLLBACK')) state.inTx = false;
      raw.exec(sql);
    },
  };
}

export async function createDemoBackend() {
  const SQL = await initSqlJs();
  let raw;
  let db;
  let api;
  let timer = null;

  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (db.state.inTx) { persist(); return; }
      const bytes = raw.export();
      raw.exec('PRAGMA foreign_keys = ON');
      saveBytes(bytes);
    }, 400);
  };

  async function open(bytes) {
    raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
    raw.exec('PRAGMA foreign_keys = ON');
    db = wrap(raw);
    api = createApi(db, { afterWrite: persist });
    if (!db.get('SELECT COUNT(*) AS n FROM users').n) {
      await seedDemo(api, { storeName: 'Permanent Floors Carpet One' });
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_mode', '1')");
      persist();
    }
  }

  const saved = await loadBytes();
  try { await open(saved); } catch { await open(null); }

  return {
    handle: (req) => api.handle(req),
    async reset() {
      clearTimeout(timer);
      try { raw.close(); } catch { /* closed */ }
      await open(null);
      const bytes = raw.export();
      raw.exec('PRAGMA foreign_keys = ON');
      await saveBytes(bytes);
    },
  };
}
