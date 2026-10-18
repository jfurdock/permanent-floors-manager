// SQLite for the server, using Node's built-in driver (no native packages to install).
import { DatabaseSync } from 'node:sqlite';

const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      if (cache.size > 400) cache.clear();
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  return {
    all: (sql, ...p) => stmt(sql).all(...norm(p)),
    get: (sql, ...p) => stmt(sql).get(...norm(p)),
    run: (sql, ...p) => {
      const r = stmt(sql).run(...norm(p));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    exec: (sql) => raw.exec(sql),
    close: () => raw.close(),
    raw,
  };
}
