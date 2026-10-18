import { UNIT_LABEL, formatFeet } from '@core/calc.js';

const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money0Fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const money = (n) => moneyFmt.format(Number(n) || 0);
export const money0 = (n) => money0Fmt.format(Math.round(Number(n) || 0));
export const pct = (n) => `${(Number(n) || 0).toFixed(Math.abs(n) >= 10 ? 0 : 1)}%`;

export function num(n, digits = 2) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function qty(n, unit) {
  const u = unit ? ` ${unit}` : '';
  return `${num(n)}${u}`;
}

export const unitLabel = (u) => UNIT_LABEL[u] || (u || '').toLowerCase();

export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function date(s, opts = {}) {
  const d = parseDate(s);
  if (!d) return '';
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(thisYear && !opts.year ? {} : { year: 'numeric' }) });
}

export const dateLong = (s) => parseDate(s)?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) || '';
export const weekday = (s) => parseDate(s)?.toLocaleDateString('en-US', { weekday: 'short' }) || '';

export function dateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function time12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
}

export function relDay(s, today) {
  const d = parseDate(s);
  const t = parseDate(today);
  if (!d || !t) return '';
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return date(s);
}

export const telHref = (p) => (p ? `tel:${String(p).replace(/[^\d+]/g, '')}` : null);
export const smsHref = (p) => (p ? `sms:${String(p).replace(/[^\d+]/g, '')}` : null);
export const mapsHref = (addr) => (addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null);

export function fullAddress(o, prefix = '') {
  const get = (k) => o?.[`${prefix}${k}`];
  const line2 = [get('city'), [get('state'), get('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [get('address'), line2].filter(Boolean).join(', ');
}

export const feet = formatFeet;

export function rollSize(item) {
  if (item.kind !== 'roll') return null;
  return `${formatFeet(item.width_ft || 12)} × ${formatFeet(item.qty)}`;
}

export function stockQtyLabel(item) {
  if (item.kind === 'roll') return rollSize(item);
  if (item.kind === 'box') return `${num(item.qty)} ${Number(item.qty) === 1 ? 'box' : 'boxes'}`;
  return `${num(item.qty)} ${unitLabel(item.unit)}`;
}

export function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
