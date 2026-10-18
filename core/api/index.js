// The whole API as a plain function: handle({ method, path, query, body, token }).
// The Node server and the in-browser demo both call this, so business rules live in one place.

import { ApiError, forbidden } from '../util.js';
import { migrate } from '../schema.js';
import { STAFF, getSettings, log } from './shared.js';
import * as auth from './auth.js';
import * as customers from './customers.js';
import * as catalog from './catalog.js';
import * as docs from './docs.js';
import * as orders from './orders.js';
import * as purchasing from './purchasing.js';
import * as inventory from './inventory.js';
import * as schedule from './schedule.js';
import * as reports from './reports.js';
import * as admin from './admin.js';

export function createApi(db, options = {}) {
  migrate(db);
  const routes = [];
  const add = (method) => (pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, opts });
  };
  const r = { get: add('GET'), post: add('POST'), put: add('PUT'), del: add('DELETE') };

  for (const mod of [auth, customers, catalog, docs, orders, purchasing, inventory, schedule, reports, admin]) mod.register(r);

  function match(method, path) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = path.match(route.re);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route, params };
      }
    }
    return null;
  }

  // Writes run one at a time inside a transaction, so a failed request leaves nothing half-saved.
  let queue = Promise.resolve();
  function handle(req) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET') return run({ ...req, method }, false);
    const next = queue.then(() => run({ ...req, method }, true));
    queue = next.catch(() => {});
    return next;
  }

  async function run({ method, path, query = {}, body = {}, token = null }, write) {
    let inTx = false;
    try {
      if (write) { db.exec('BEGIN'); inTx = true; }
      const result = await dispatch({ method, path, query, body, token });
      if (inTx) { db.exec('COMMIT'); inTx = false; }
      return result;
    } catch (e) {
      if (inTx) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } }
      if (e instanceof ApiError) return { status: e.status, body: { error: e.message, ...(e.extra || {}) } };
      console.error(e);
      return { status: 500, body: { error: `Something went wrong: ${e.message}` } };
    } finally {
      if (write && options.afterWrite) options.afterWrite();
    }
  }

  async function dispatch({ method, path, query, body, token }) {
    const found = match(method, path);
    if (!found) throw new ApiError(404, `No such endpoint: ${method} ${path}`);
    const { route, params } = found;
    const ctx = {
      db,
      params,
      query: query || {},
      body: body || {},
      token,
      user: null,
      settings: () => getSettings(db),
      log: (type, id, action, detail) => log(db, ctx.user, type, id, action, detail),
    };
    if (!route.opts.public) {
      ctx.user = auth.authenticate(db, token);
      if (!ctx.user) throw new ApiError(401, 'Please sign in.');
      const roles = route.opts.roles || STAFF;
      if (!roles.includes(ctx.user.role)) forbidden();
    }
    const result = await route.handler(ctx);
    return { status: 200, body: result === undefined ? { ok: true } : result };
  }

  return { handle, db };
}
