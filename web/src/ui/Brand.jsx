// Store mark, store name and people avatars.
import { initials } from '../lib/format.js';

// A rolled-out stack of flooring: three lengths, the bottom one cut short like a remnant.
export function BrandMark({ size = 36 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="10" className="brand-mark-bg" />
      <rect x="9" y="11" width="22" height="4.5" rx="2.25" className="brand-mark-fg" />
      <rect x="9" y="18" width="22" height="4.5" rx="2.25" className="brand-mark-fg" />
      <rect x="9" y="25" width="13" height="4.5" rx="2.25" className="brand-mark-fg" />
      <circle cx="28" cy="27.25" r="2.6" className="brand-mark-fg" />
    </svg>
  );
}

// "Permanent Floors Carpet One" reads as the store's name plus its co-op; show it that way.
export function StoreName({ name, className = '' }) {
  const n = name || 'Store Manager';
  const m = n.match(/^(.*?)\s+(Carpet One.*)$/i);
  return (
    <span className={`store-name ${className}`}>
      <b>{m ? m[1] : n}</b>
      {m && <span>{m[2]}</span>}
    </span>
  );
}

const TINTS = ['#2f6f9f', '#7a5195', '#3d8361', '#b3202e', '#c46b1f', '#4c6a92', '#8a7a2a'];
export function Avatar({ name, size = 40 }) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const color = TINTS[h % TINTS.length];
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), '--tint': color }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
