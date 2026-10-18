import { useMemo, useState } from 'react';
import { Boxes, PackagePlus } from 'lucide-react';
import { CATEGORIES, categoryLabel, productName, parseFeet, formatFeet, stockToSale } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { Link } from '../lib/router.jsx';
import { useSession } from '../lib/session.jsx';
import { money, money0, num, date, dateTime, stockQtyLabel, unitLabel } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Button, Badge, Loading, ErrorNote, Empty, SearchBox, Chips, Field, Input, MoneyInput, Check, Notice, useDebounced } from '../ui/kit.jsx';
import { Sheet, useAction } from '../ui/overlay.jsx';
import { ProductPicker } from '../ui/pickers.jsx';

export default function InventoryPage({ query }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(query.remnants === '1' ? 'remnants' : '');
  const dq = useDebounced(q);
  const params = { q: dq, remnants: filter === 'remnants' ? '1' : '', category: filter && filter !== 'remnants' ? filter : '' };
  const { data, error, loading, reload } = useData('/inventory', params);
  const [item, setItem] = useState(null);
  const [adding, setAdding] = useState(query.add === '1');

  const groups = useMemo(() => {
    const m = new Map();
    for (const it of data || []) {
      if (!m.has(it.product_id)) m.set(it.product_id, { product: it, items: [], onHand: 0, value: 0 });
      const g = m.get(it.product_id);
      g.items.push(it);
      g.onHand += it.sale_qty;
      g.value += it.value;
    }
    return [...m.values()];
  }, [data]);
  const totalValue = groups.reduce((s, g) => s + g.value, 0);
  const stocked = CATEGORIES.filter((c) => c.stock !== 'none');

  return (
    <Screen title="Inventory">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          {data && <div className="page-sub">{data.length} pieces on hand, {money0(totalValue)} at cost</div>}
        </div>
        <div className="page-actions"><Button variant="primary" icon={PackagePlus} onClick={() => setAdding(true)}>Add stock</Button></div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Style, color, roll tag, dye lot, or location" />
      <Chips value={filter} onChange={setFilter} options={[{ value: '', label: 'All stock' }, { value: 'remnants', label: 'Remnants' }, ...stocked.map((c) => ({ value: c.id, label: c.label }))]} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : groups.length ? (
        <div className="panel rows">
          {groups.map((g) => (
            <div key={g.product.product_id} className="rows">
              <Link to={`/products/${g.product.product_id}`} className="day-head" style={{ textDecoration: 'none', justifyContent: 'space-between' }}>
                <span className="ellipsis">{productName(g.product)}<span className="faint" style={{ fontWeight: 500 }}> {categoryLabel(g.product.category)}</span></span>
                <span className="num nowrap">{num(g.onHand)} {g.product.unit}</span>
              </Link>
              {g.items.map((it) => (
                <button key={it.id} type="button" className="row" onClick={() => setItem(it)}>
                  <div className="row-main">
                    <span className="row-title num">{stockQtyLabel(it)}</span>
                    <span className="row-sub">{[it.tag, it.dye_lot && `dye lot ${it.dye_lot}`, it.location].filter(Boolean).join(', ') || 'No tag or location'}</span>
                  </div>
                  <div className="row-meta">
                    {it.is_remnant ? <Badge tone="brand">Remnant</Badge> : null}
                    <span className="xs faint num">{num(it.sale_qty)} {it.unit}, {money0(it.value)}</span>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty icon={Boxes} title={filter === 'remnants' ? 'No remnants' : 'Nothing in stock here'} action={<Button icon={PackagePlus} onClick={() => setAdding(true)}>Add stock</Button>}>
            Stock comes in when you receive a purchase order. You can also add rolls and boxes you already have.
          </Empty>
        </div>
      )}
      {item && <ItemSheet id={item.id} onClose={() => setItem(null)} onChanged={reload} />}
      {adding && <AddStockSheet onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </Screen>
  );
}

const TX_LABEL = { receive: 'Received', cut: 'Cut', pull: 'Pulled', adjust: 'Count adjusted', return: 'Returned' };

function ItemSheet({ id, onClose, onChanged }) {
  const { data: it, reload } = useData(`/inventory/${id}`);
  const [f, setF] = useState(null);
  const [count, setCount] = useState('');
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  if (!it) return <Sheet title="Stock" onClose={onClose}><Loading /></Sheet>;
  const form = f || { tag: it.tag || '', dye_lot: it.dye_lot || '', location: it.location || '', is_remnant: !!it.is_remnant, unit_cost: String(it.unit_cost), notes: it.notes || '' };
  const set = (k) => (v) => setF({ ...form, [k]: v });
  const save = () => run(async () => { await api.put(`/inventory/${id}`, form); setF(null); await reload(); onChanged(); }, 'Stock updated');
  const adjust = () => run(async () => { await api.post(`/inventory/${id}/adjust`, { qty: count, note: reason }); setCount(''); setReason(''); await reload(); onChanged(); }, 'Count updated');
  const newQty = it.kind === 'roll' ? parseFeet(count) : Number(count);
  return (
    <Sheet title={productName(it)} onClose={onClose}
      footer={f && <><Button onClick={() => setF(null)}>Undo changes</Button><Button variant="primary" busy={busy} onClick={save}>Save changes</Button></>}>
      <div className="calc-result">
        <span className="calc-big" style={{ fontSize: 30 }}>{stockQtyLabel(it)}</span>
        <span className="small muted">{num(it.sale_qty)} {unitLabel(it.unit)} on hand, {money(it.value)} at cost{it.received_at ? `, received ${date(it.received_at)}` : ''}{it.po ? ` on ${it.po.number}` : ''}</span>
      </div>
      <div className="form-grid">
        <Field label={it.kind === 'roll' ? 'Roll tag' : 'Lot or tag'}><Input value={form.tag} onChange={set('tag')} /></Field>
        <Field label="Dye lot"><Input value={form.dye_lot} onChange={set('dye_lot')} /></Field>
        <Field label="Location"><Input value={form.location} onChange={set('location')} placeholder="Rack A1" /></Field>
        <Field label={`Cost per ${unitLabel(it.unit)}`}><MoneyInput value={form.unit_cost} onChange={set('unit_cost')} /></Field>
      </div>
      {it.kind === 'roll' && <Check checked={form.is_remnant} onChange={set('is_remnant')}>This is a remnant</Check>}
      <section className="stack">
        <h3>Count is off?</h3>
        <div className="form-grid">
          <Field label={it.kind === 'roll' ? 'Length left on the roll' : it.kind === 'box' ? 'Boxes on the shelf' : 'Count on hand'} hint={it.kind === 'roll' && newQty ? formatFeet(newQty) : null}>
            <Input value={count} onChange={setCount} inputMode="decimal" placeholder={it.kind === 'roll' ? '42 6' : String(it.qty)} />
          </Field>
          <Field label="Reason"><Input value={reason} onChange={setReason} placeholder="Physical count" /></Field>
        </div>
        <div><Button busy={busy} disabled={count === '' || newQty === null || Number.isNaN(newQty)} onClick={adjust}>Update count</Button></div>
      </section>
      <section className="stack">
        <h3>History</h3>
        <div className="panel rows">
          {it.history.map((t) => (
            <div key={t.id} className="row">
              <div className="row-main">
                <span className="row-title">{TX_LABEL[t.type] || t.type} {it.kind === 'roll' ? formatFeet(Math.abs(t.qty)) : num(Math.abs(t.qty))}{t.order_number ? ` for ${t.order_number}` : ''}</span>
                <span className="row-sub">{[t.note, t.user_name, dateTime(t.created_at)].filter(Boolean).join(', ')}</span>
              </div>
              <span className={`small num ${t.qty < 0 ? 'muted' : ''}`}>{t.qty > 0 ? '+' : '−'}{it.kind === 'roll' ? formatFeet(Math.abs(t.qty)) : num(Math.abs(t.qty))}</span>
            </div>
          ))}
        </div>
      </section>
    </Sheet>
  );
}

function AddStockSheet({ onClose, onSaved }) {
  const { settings } = useSession();
  const [product, setProduct] = useState(null);
  const [f, setF] = useState({ tag: '', dye_lot: '', location: '', width_ft: '', length_ft: '', qty: '', unit_cost: '', is_remnant: false });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [run, busy] = useAction();
  if (!product) return <ProductPicker title="What are you adding?" stockedOnly onClose={onClose} onPick={(p) => { setProduct(p); setF((s) => ({ ...s, width_ft: p.roll_width_ft ? String(p.roll_width_ft) : '', unit_cost: String(p.cost) })); }} />;
  const roll = product.stock_type === 'roll';
  const len = parseFeet(f.length_ft);
  const width = parseFeet(f.width_ft) || product.roll_width_ft || 12;
  const sale = roll ? (len ? stockToSale(product, len, width) : 0) : stockToSale(product, Number(f.qty) || 0);
  const save = () => run(async () => { await api.post('/inventory', { ...f, product_id: product.id, is_remnant: f.is_remnant ? 1 : undefined }); onSaved(); }, 'Added to stock');
  return (
    <Sheet title="Add stock" onClose={onClose}
      footer={<><Button onClick={() => setProduct(null)}>Change product</Button><Button variant="primary" busy={busy} onClick={save}>Add to stock</Button></>}>
      <div className="strong">{productName(product)}</div>
      {roll ? (
        <div className="form-grid">
          <Field label="Roll width" hint={formatFeet(width)}><Input value={f.width_ft} onChange={set('width_ft')} inputMode="decimal" /></Field>
          <Field label="Length" hint={len ? `${formatFeet(len)}, ${num(sale)} ${product.unit}` : 'feet inches, like 42 6'}><Input value={f.length_ft} onChange={set('length_ft')} inputMode="decimal" data-autofocus /></Field>
        </div>
      ) : (
        <Field label={product.stock_type === 'box' ? 'Boxes' : `Quantity (${unitLabel(product.unit)})`} hint={product.stock_type === 'box' && f.qty ? `${num(sale)} sq ft` : null}>
          <Input value={f.qty} onChange={set('qty')} inputMode="decimal" data-autofocus />
        </Field>
      )}
      <div className="form-grid">
        <Field label={roll ? 'Roll tag' : 'Lot or tag'}><Input value={f.tag} onChange={set('tag')} /></Field>
        <Field label="Dye lot"><Input value={f.dye_lot} onChange={set('dye_lot')} /></Field>
        <Field label="Location"><Input value={f.location} onChange={set('location')} placeholder="Rack A1" /></Field>
        <Field label={`Cost per ${unitLabel(product.unit)}`}><MoneyInput value={f.unit_cost} onChange={set('unit_cost')} /></Field>
      </div>
      {roll && <Check checked={f.is_remnant} onChange={set('is_remnant')}>This is a remnant</Check>}
      {roll && <Notice>Pieces {settings.remnant_max_ft || 20} ft or shorter are marked as remnants automatically. Change the cutoff in Settings.</Notice>}
    </Sheet>
  );
}
