// Small helpers shared by the server, the browser demo and the UI.

export class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (message, extra) => { throw new ApiError(400, message, extra); };
export const notFound = (what = 'Record') => { throw new ApiError(404, `${what} not found`); };
export const forbidden = (message = 'You don’t have access to this.') => { throw new ApiError(403, message); };

export const round2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;
export const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

export function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function int(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function str(v, max = 2000) {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
}

export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

export const nowIso = () => new Date().toISOString();

// Local calendar date as YYYY-MM-DD.
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return localDate(dt);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const digits = (s) => String(s || '').replace(/\D/g, '');

export function customerName(c) {
  if (!c) return '';
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ');
  if (c.company && person) return `${c.company} (${person})`;
  return c.company || person || 'Unnamed customer';
}

// Random hex token using Web Crypto (available in Node 20+ and browsers).
export function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(pin, saltHex) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120000 }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return [head, ...body].join('\n');
}
