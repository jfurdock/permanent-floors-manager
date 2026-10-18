import { useState } from 'react';
import { UserPlus, Package, PenLine } from 'lucide-react';
import { CATEGORIES, categoryLabel, productName } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { money, num, unitLabel } from '../lib/format.js';
import { Sheet, useAction } from './overlay.jsx';
import { Button, Field, Input, Select, TextArea, SearchBox, Chips, Segmented, Loading, ErrorNote, useDebounced, Badge } from './kit.jsx';

const SOURCES = ['Walk-in', 'Referral', 'Repeat customer', 'Google', 'Facebook', 'Home show', 'Builder program', 'Commercial bid', 'Other'];

export function CustomerForm({ customer, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    type: 'residential', first_name: '', last_name: '', company: '', phone: '', phone2: '', email: '',
    address: '', city: '', state: '', zip: '', source: '', sales_rep_id: '', notes: '', ...(customer || {}),
  }));
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const users = useData('/users');
  const [run, busy] = useAction();
  const save = () => run(async () => {
    const body = { ...f, sales_rep_id: f.sales_rep_id || null };
    const saved = customer?.id ? await api.put(`/customers/${customer.id}`, body) : await api.post('/customers', body);
    onSaved?.(saved);
  }, customer?.id ? 'Customer saved' : 'Customer added');
  const business = f.type !== 'residential';
  return (
    <Sheet title={customer?.id ? 'Edit customer' : 'New customer'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{customer?.id ? 'Save customer' : 'Add customer'}</Button></>}>
      <Segmented label="Customer type" value={f.type} onChange={set('type')}
        options={[{ value: 'residential', label: 'Homeowner' }, { value: 'commercial', label: 'Commercial' }, { value: 'builder', label: 'Builder' }]} />
      {business && <Field label="Company"><Input value={f.company} onChange={set('company')} autoComplete="organization" /></Field>}
      <div className="form-grid">
        <Field label={business ? 'Contact first name' : 'First name'}><Input value={f.first_name} onChange={set('first_name')} autoComplete="given-name" /></Field>
        <Field label={business ? 'Contact last name' : 'Last name'}><Input value={f.last_name} onChange={set('last_name')} autoComplete="family-name" /></Field>
      </div>
      <div className="form-grid">
        <Field label="Mobile phone"><Input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></Field>
        <Field label="Email"><Input type="email" inputMode="email" value={f.email} onChange={set('email')} autoComplete="email" /></Field>
      </div>
      <Field label="Street address"><Input value={f.address} onChange={set('address')} autoComplete="street-address" /></Field>
      <div className="form-grid">
        <Field label="City"><Input value={f.city} onChange={set('city')} autoComplete="address-level2" /></Field>
        <Field label="State"><Input value={f.state} onChange={set('state')} autoComplete="address-level1" maxLength={20} /></Field>
        <Field label="ZIP"><Input value={f.zip} onChange={set('zip')} inputMode="numeric" autoComplete="postal-code" /></Field>
      </div>
      <div className="form-grid">
        <Field label="How they found us">
          <Select value={f.source} onChange={set('source')} placeholder="Choose" options={SOURCES.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Salesperson">
          <Select value={f.sales_rep_id || ''} onChange={set('sales_rep_id')} placeholder="Unassigned"
            options={(users.data || []).filter((u) => u.role !== 'installer').map((u) => ({ value: u.id, label: u.name }))} />
        </Field>
      </div>
      <Field label="Other phone"><Input type="tel" inputMode="tel" value={f.phone2} onChange={set('phone2')} /></Field>
      <Field label="Notes" hint="Gate codes, pets, preferences"><TextArea value={f.notes} onChange={set('notes')} /></Field>
    </Sheet>
  );
}

export function CustomerPicker({ title = 'Choose a customer', onClose, onPick }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useData('/customers', { q: dq, limit: 40 });
  const [creating, setCreating] = useState(false);
  if (creating) {
    return <CustomerForm customer={q ? guessName(q) : null} onClose={() => setCreating(false)} onSaved={(c) => onPick(c)} />;
  }
  return (
    <Sheet title={title} onClose={onClose}>
      <SearchBox value={q} onChange={setQ} placeholder="Name, phone, or address" autoFocus />
      <Button icon={UserPlus} onClick={() => setCreating(true)}>New customer{q ? `: ${q}` : ''}</Button>
      <ErrorNote error={list.error} />
      {list.loading && !list.data ? <Loading /> : (
        <div className="rows panel">
          {(list.data || []).map((c) => (
            <button key={c.id} type="button" className="row" onClick={() => onPick(c)}>
              <div className="row-main">
                <span className="row-title">{c.display_name}</span>
                <span className="row-sub">{[c.phone, c.address, c.city].filter(Boolean).join(', ')}</span>
              </div>
              {c.type !== 'residential' && <Badge>{c.type === 'builder' ? 'Builder' : 'Commercial'}</Badge>}
            </button>
          ))}
          {list.data && !list.data.length && <div className="list-empty">No customers match “{q}”. Add them as a new customer.</div>}
        </div>
      )}
    </Sheet>
  );
}

function guessName(q) {
  if (/\d{3}/.test(q)) return { phone: q };
  const parts = q.trim().split(/\s+/);
  if (parts.length === 1) return { last_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

export function ProductPicker({ title = 'Add a product', onClose, onPick, onCustom, stockedOnly, initialCategory = '' }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(initialCategory);
  const dq = useDebounced(q);
  const list = useData('/products', { q: dq, category: cat, stocked: stockedOnly ? '1' : '', limit: 120 });
  const cats = [{ value: '', label: 'All' }, ...CATEGORIES.filter((c) => !stockedOnly || c.stock !== 'none').map((c) => ({ value: c.id, label: c.label }))];
  return (
    <Sheet title={title} onClose={onClose} wide>
      <SearchBox value={q} onChange={setQ} placeholder="Style, color, SKU, or brand" autoFocus />
      <Chips options={cats} value={cat} onChange={setCat} label="Category" />
      {onCustom && <Button icon={PenLine} onClick={onCustom}>Custom item (not in the catalog)</Button>}
      <ErrorNote error={list.error} />
      {list.loading && !list.data ? <Loading /> : (
        <div className="rows panel">
          {(list.data || []).map((p) => (
            <button key={p.id} type="button" className="row" onClick={() => onPick(p)}>
              <div className="row-main">
                <span className="row-title">{productName(p)}</span>
                <span className="row-sub">{[categoryLabel(p.category), p.sku, p.vendor_name].filter(Boolean).join(', ')}</span>
              </div>
              <div className="row-meta">
                <span className="row-amount">{money(p.price)}<span className="faint small"> / {unitLabel(p.unit)}</span></span>
                {p.stock_type !== 'none' && <span className="xs faint">{p.on_hand ? `${num(p.on_hand)} ${p.unit} in stock` : 'None in stock'}</span>}
              </div>
            </button>
          ))}
          {list.data && !list.data.length && (
            <div className="list-empty"><Package size={16} style={{ verticalAlign: -3 }} /> Nothing matches. Try another word, or add it in Products.</div>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function OrderPicker({ title = 'Choose an order', onClose, onPick, stage = 'open' }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useData('/orders', { q: dq, stage, limit: 40 });
  return (
    <Sheet title={title} onClose={onClose}>
      <SearchBox value={q} onChange={setQ} placeholder="Order number or customer" autoFocus />
      <ErrorNote error={list.error} />
      {list.loading && !list.data ? <Loading /> : (
        <div className="rows panel">
          {(list.data || []).map((o) => (
            <button key={o.id} type="button" className="row" onClick={() => onPick(o)}>
              <div className="row-main">
                <span className="row-title">{o.customer_name}</span>
                <span className="row-sub">{[o.number, o.title].filter(Boolean).join(', ')}</span>
              </div>
              <div className="row-meta"><span className="row-amount">{money(o.total)}</span></div>
            </button>
          ))}
          {list.data && !list.data.length && <div className="list-empty">No open orders match.</div>}
        </div>
      )}
    </Sheet>
  );
}
