// Talks to the store server, or (in the demo build) to the same API running inside the browser.

export const storage = {
  get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k, v) {
    try { if (v === null || v === undefined) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

const TOKEN_KEY = __DEMO__ ? 'pf_demo_token' : 'pf_token';
let token = storage.get(TOKEN_KEY);
export const getToken = () => token;
export function setToken(t) { token = t || null; storage.set(TOKEN_KEY, token); }

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function toQuery(params) {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

async function httpBackend(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
  } catch {
    throw new ApiError('Can’t reach the store server. Check the connection and try again.', 0);
  }
  let data;
  try { data = await res.json(); } catch { data = { error: 'The server sent an unexpected response.' }; }
  return { status: res.status, body: data };
}

let demoBackend = null;
async function backend(method, path, body) {
  if (!__DEMO__) return httpBackend(method, path, body);
  if (!demoBackend) demoBackend = (await import('./demo-backend.js')).createDemoBackend();
  const b = await demoBackend;
  const [p, qs] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || '').entries());
  return b.handle({ method, path: p, query, body: method === 'GET' ? {} : body, token });
}

export async function request(method, path, body) {
  const res = await backend(method, path, body);
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/setup')) {
    setToken(null);
    window.dispatchEvent(new Event('pf:signed-out'));
  }
  if (res.status !== 200) throw new ApiError(res.body?.error || 'Something went wrong.', res.status);
  return res.body;
}

export const api = {
  get: (path, params) => request('GET', path + toQuery(params)),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};

export async function resetDemo() {
  if (!__DEMO__) return;
  const b = await (demoBackend || (demoBackend = (await import('./demo-backend.js')).createDemoBackend()));
  await b.reset();
  setToken(null);
}

// Server-only: download a file that needs the sign-in token.
export async function downloadFile(path, filename) {
  if (__DEMO__) return;
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg = 'Download failed.';
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text, filename, type = 'text/csv') {
  if (__DEMO__) return;
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
