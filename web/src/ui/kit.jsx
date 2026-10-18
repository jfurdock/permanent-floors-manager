import { useEffect, useId, useRef, useState } from 'react';
import { Search as SearchIcon, X, Info, AlertTriangle, AlertCircle, ChevronLeft } from 'lucide-react';
import { parseFeet, formatFeet } from '@core/calc.js';
import { back } from '../lib/router.jsx';

export function Button({ variant = 'secondary', size, block, icon: Icon, children, className = '', busy, ...rest }) {
  const cls = ['btn', variant !== 'secondary' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={busy || rest.disabled} {...rest}>
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, ...rest }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} {...rest}>
      <Icon aria-hidden="true" />
    </button>
  );
}

export function BackButton({ fallback = '/' }) {
  return <IconButton icon={ChevronLeft} label="Back" onClick={() => back(fallback)} />;
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ value, onChange, ...rest }) {
  return <input className="input" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />;
}

export function TextArea({ value, onChange, ...rest }) {
  return <textarea className="textarea" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />;
}

export function Select({ value, onChange, options, placeholder, ...rest }) {
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value ?? o.id} value={o.value ?? o.id}>{o.label}</option>
      ))}
    </select>
  );
}

export function MoneyInput({ value, onChange, ...rest }) {
  return (
    <div className="input-affix">
      <span>$</span>
      <input className="input num" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />
    </div>
  );
}

export function NumberInput({ value, onChange, suffix, ...rest }) {
  if (!suffix) return <input className="input num" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />;
  return (
    <div className="input-affix suffix">
      <input className="input num" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest} />
      <span>{suffix}</span>
    </div>
  );
}

// Accepts 12, 12.5, 12'6, 12 6 and shows how it was read.
export function FeetInput({ value, onChange, label, placeholder = 'e.g. 12 6', ...rest }) {
  const parsed = parseFeet(value);
  const showHint = value !== '' && value !== null && value !== undefined;
  return (
    <Field label={label} hint={showHint ? (parsed === null ? 'Use feet and inches, like 12 6' : formatFeet(parsed)) : 'feet inches'} error={showHint && parsed === null ? 'Use feet and inches, like 12 6' : null}>
      <input className="input num" inputMode="decimal" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)} {...rest} />
    </Field>
  );
}

export function Check({ checked, onChange, children, ...rest }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} {...rest} />
      <span>{children}</span>
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search', autoFocus, onKeyDown }) {
  const id = useId();
  return (
    <div className="search">
      <SearchIcon aria-hidden="true" />
      <label htmlFor={id} className="sr-only">{placeholder}</label>
      <input id={id} className="input" type="search" value={value} placeholder={placeholder} autoFocus={autoFocus} onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)} enterKeyHint="search" autoComplete="off" />
    </div>
  );
}

export function Chips({ options, value, onChange, label = 'Filter' }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="chip" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.color && <span className="dot" style={{ background: o.color }} />}
          {o.label}
          {o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className={options.length > 3 ? 'pills' : 'segmented'} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

const TONES = {
  draft: '', sent: 'info', accepted: 'ok', declined: 'danger',
  new: 'brand', ordered: 'warn', ready: 'info', scheduled: 'info', installed: 'warn', invoiced: 'warn', paid: 'ok', cancelled: 'danger',
  partial: 'warn', received: 'ok',
  needed: 'danger', none: '', confirmed: 'info', in_progress: 'warn', done: 'ok',
};
export function Badge({ tone, status, children }) {
  const t = tone ?? TONES[status] ?? '';
  return <span className={`badge ${t ? `badge-${t}` : ''}`}>{children}</span>;
}

export function Notice({ tone = 'info', children, action }) {
  const Icon = tone === 'danger' ? AlertCircle : tone === 'warn' ? AlertTriangle : Info;
  return (
    <div className={`notice ${tone !== 'info' ? `notice-${tone}` : ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon aria-hidden="true" />
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <Icon aria-hidden="true" />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading" role="status">{label}</div>;
}

export function ErrorNote({ error, retry }) {
  if (!error) return null;
  return (
    <Notice tone="danger" action={retry && <Button size="sm" onClick={retry}>Try again</Button>}>
      {error.message || String(error)}
    </Notice>
  );
}

export function Panel({ title, action, children, className = '', id }) {
  return (
    <section className={`panel ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || action) && (
        <div className="panel-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action && <div className="hstack">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHead({ title, sub, actions }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Figures({ items }) {
  return (
    <div className="figures">
      {items.map((f) => (
        <div className="figure" key={f.label}>
          <span className="figure-label">{f.label}</span>
          <span className="figure-value">{f.value}</span>
          {f.note && <span className="figure-note">{f.note}</span>}
        </div>
      ))}
    </div>
  );
}

export function ClearButton({ onClick }) {
  return <IconButton icon={X} label="Clear" onClick={onClick} />;
}

// Debounced value for search boxes.
export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return m;
}

export function useLatest(value) {
  const r = useRef(value);
  r.current = value;
  return r;
}
