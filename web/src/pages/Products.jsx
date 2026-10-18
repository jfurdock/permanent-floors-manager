import { useState } from 'react';
import { Tag, Plus, Pencil, Archive } from 'lucide-react';
import { CATEGORIES, CATEGORY, UNITS, STOCK_TYPES, categoryLabel, productName, formatFeet } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { Link, navigate } from '../lib/router.jsx';
import { useSession } from '../lib/session.jsx';
import { money, num, pct, date, stockQtyLabel, unitLabel } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, Badge, Loading, ErrorNote, Empty, SearchBox, Chips, Field, Input, Select, TextArea, MoneyInput, NumberInput, Check, Figures, useDebounced } from '../ui/kit.jsx';
import { Sheet, useAction, useFeedback } from '../ui/overlay.jsx';

export function ProductsPage() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useData('/products', { q: dq, category: cat });
  const [editing, setEditing] = useState(null);
  return (
    <Screen title="Products">
      <div className="page-head">
        <div><h1>Products</h1>{data && <div className="page-sub">{data.length} products and services</div>}</div>
        <div className="page-actions"><Button variant="primary" icon={Plus} onClick={() => setEditing({ category: cat || 'carpet' })}>New product</Button></div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Style, color, SKU, or brand" />
      <Chips value={cat} onChange={setCat} options={[{ value: '', label: 'All' }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="panel rows">
          {(data || []).map((p) => (
            <Link key={p.id} to={`/products/${p.id}`} className="row">
              <div className="row-main">
                <span className="row-title">{productName(p)}</span>
                <span className="row-sub">{[categoryLabel(p.category), p.sku, p.vendor_name].filter(Boolean).join(', ')}</span>
              </div>
              <div className="row-meta">
                <span className="row-amount">{money(p.price)}<span className="faint small"> / {unitLabel(p.unit)}</span></span>
                {p.stock_type !== 'none' && <span className="xs faint num">{p.on_hand ? `${num(p.on_hand)} ${p.unit} on hand` : 'Special order'}</span>}
              </div>
            </Link>
          ))}
          {data && !data.length && <Empty icon={Tag} title="No products here" action={<Button icon={Plus} onClick={() => setEditing({ category: cat || 'carpet' })}>Add a product</Button>}>Add flooring, pad, trim, labor and fees so they’re one tap away on a quote.</Empty>}
        </div>
      )}
      {editing && <ProductSheet product={editing} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); navigate(`/products/${p.id}`); }} />}
    </Screen>
  );
}

export function ProductPage({ params }) {
  const { data: p, error, loading, reload } = useData(`/products/${params.id}`);
  const { user } = useSession();
  const canEdit = ['admin', 'manager', 'warehouse'].includes(user?.role);
  const [editing, setEditing] = useState(false);
  const [run] = useAction();
  const { confirm } = useFeedback();
  if (loading && !p) return <Screen title="Product" back="/products"><Loading /></Screen>;
  if (error) return <Screen title="Product" back="/products"><ErrorNote error={error} retry={reload} /></Screen>;
  const margin = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;
  const archive = async () => {
    if (!(await confirm({ title: 'Remove this product?', message: 'Products already on quotes or orders are archived instead, so history stays intact.', confirmLabel: 'Remove product' }))) return;
    run(async () => { await api.del(`/products/${p.id}`); navigate('/products', { replace: true }); }, 'Product removed');
  };
  return (
    <Screen title={p.style} back="/products" actions={canEdit && <Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}>
      <div className="page-head">
        <div>
          <h1>{productName(p)}</h1>
          <div className="page-sub">{[categoryLabel(p.category), p.sku, p.vendor_name].filter(Boolean).join(', ')}{!p.active && <> <Badge tone="danger">Archived</Badge></>}</div>
        </div>
      </div>
      <Panel>
        <Figures items={[
          { label: `Price per ${unitLabel(p.unit)}`, value: money(p.price) },
          { label: 'Cost', value: money(p.cost), note: `${pct(margin)} margin` },
          ...(p.stock_type !== 'none' ? [{ label: 'On hand', value: `${num(p.on_hand)} ${p.unit}`, note: `${p.pieces} ${p.pieces === 1 ? 'piece' : 'pieces'}, ${money(p.value)} at cost` }] : []),
        ]} />
      </Panel>
      <div className="cols">
        <div className="stack-lg">
          {p.stock_type !== 'none' && (
            <Panel title="In stock" action={<Link to="/inventory?add=1" className="link-btn small">Add stock</Link>}>
              <div className="rows">
                {p.items.map((it) => (
                  <div key={it.id} className="row">
                    <div className="row-main"><span className="row-title num">{stockQtyLabel({ ...it, unit: p.unit })}</span><span className="row-sub">{[it.tag, it.dye_lot && `dye lot ${it.dye_lot}`, it.location].filter(Boolean).join(', ')}</span></div>
                    {it.is_remnant ? <Badge tone="brand">Remnant</Badge> : null}
                  </div>
                ))}
                {!p.items.length && <div className="list-empty">None in stock. It will be ordered from the vendor when sold.</div>}
              </div>
            </Panel>
          )}
          {p.on_order.length > 0 && (
            <Panel title="On order">
              <div className="rows">
                {p.on_order.map((l) => (
                  <Link key={l.id} to={`/purchasing/${l.po_id}`} className="row">
                    <div className="row-main"><span className="row-title">{l.po_number}</span><span className="row-sub">{num(l.qty - l.received_qty)} {l.unit} coming{l.expected_date ? `, expected ${date(l.expected_date)}` : ''}</span></div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
        </div>
        <Panel title="Details">
          <div className="panel-body">
            <dl className="kv">
              <dt>Sold by</dt><dd>{unitLabel(p.unit)}</dd>
              <dt>Stock</dt><dd>{STOCK_TYPES.find((s) => s.id === p.stock_type)?.label}</dd>
              {p.stock_type === 'roll' && <><dt>Roll width</dt><dd>{formatFeet(p.roll_width_ft)}</dd></>}
              {p.stock_type === 'box' && <><dt>Per box</dt><dd>{num(p.coverage_per_box)} sq ft</dd></>}
              <dt>Sales tax</dt><dd>{p.taxable ? 'Taxed' : 'Not taxed'}</dd>
              {p.reorder_point !== null && <><dt>Reorder at</dt><dd>{num(p.reorder_point)} {p.unit}</dd></>}
            </dl>
            {p.description && <div className="small">{p.description}</div>}
            {canEdit ? <div><Button size="sm" variant="ghost" className="btn-danger" icon={Archive} onClick={archive}>Remove product</Button></div>
              : <div className="xs faint">Ask a manager or the warehouse to change prices.</div>}
          </div>
        </Panel>
      </div>
      {editing && <ProductSheet product={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </Screen>
  );
}

export function ProductSheet({ product, onClose, onSaved }) {
  const isNew = !product.id;
  const startCat = CATEGORY[product.category] || CATEGORY.carpet;
  const [f, setF] = useState(() => ({
    category: startCat.id, manufacturer: '', style: '', color: '', sku: '', vendor_id: '', unit: startCat.unit, stock_type: startCat.stock,
    roll_width_ft: startCat.width ? String(startCat.width) : '', coverage_per_box: '', cost: '', price: '', taxable: !['labor', 'service'].includes(startCat.id),
    reorder_point: '', description: '', active: true,
    ...(isNew ? {} : {
      ...product, vendor_id: product.vendor_id || '', roll_width_ft: product.roll_width_ft ?? '', coverage_per_box: product.coverage_per_box ?? '',
      cost: String(product.cost), price: String(product.price), taxable: !!product.taxable, reorder_point: product.reorder_point ?? '', active: !!product.active,
    }),
  }));
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const vendors = useData('/vendors');
  const [run, busy] = useAction();
  const changeCategory = (id) => {
    const c = CATEGORY[id];
    setF((s) => ({ ...s, category: id, unit: c.unit, stock_type: c.stock, roll_width_ft: c.width ? String(c.width) : '', taxable: !['labor', 'service'].includes(id) }));
  };
  const cost = Number(f.cost) || 0;
  const price = Number(f.price) || 0;
  const margin = price > 0 ? ((price - cost) / price) * 100 : null;
  const save = () => run(async () => {
    const body = { ...f, vendor_id: f.vendor_id || null, taxable: f.taxable ? 1 : 0, active: f.active ? 1 : 0 };
    onSaved(isNew ? await api.post('/products', body) : await api.put(`/products/${product.id}`, body));
  }, isNew ? 'Product added' : 'Product saved');
  const priceAt = (m) => set('price')(String(Math.ceil((cost / (1 - m / 100)) * 100) / 100));
  return (
    <Sheet title={isNew ? 'New product' : 'Edit product'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{isNew ? 'Add product' : 'Save product'}</Button></>}>
      <Field label="Category"><Select value={f.category} onChange={changeCategory} options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} /></Field>
      <div className="form-grid">
        <Field label="Brand"><Input value={f.manufacturer} onChange={set('manufacturer')} /></Field>
        <Field label={['labor', 'service'].includes(f.category) ? 'Name' : 'Style'}><Input value={f.style} onChange={set('style')} /></Field>
        {!['labor', 'service'].includes(f.category) && <Field label="Color"><Input value={f.color} onChange={set('color')} /></Field>}
        <Field label="SKU"><Input value={f.sku} onChange={set('sku')} /></Field>
      </div>
      {!['labor', 'service'].includes(f.category) && (
        <Field label="Vendor"><Select value={f.vendor_id} onChange={set('vendor_id')} placeholder="None" options={(vendors.data || []).map((v) => ({ value: v.id, label: v.name }))} /></Field>
      )}
      <div className="form-grid">
        <Field label="Sold by"><Select value={f.unit} onChange={set('unit')} options={UNITS.map((u) => ({ value: u, label: `${u} (${unitLabel(u)})` }))} /></Field>
        <Field label="Stock"><Select value={f.stock_type} onChange={set('stock_type')} options={STOCK_TYPES.map((s) => ({ value: s.id, label: s.label }))} /></Field>
        {f.stock_type === 'roll' && <Field label="Roll width" hint="Feet, e.g. 12 or 13 6"><Input value={f.roll_width_ft} onChange={set('roll_width_ft')} inputMode="decimal" /></Field>}
        {f.stock_type === 'box' && <Field label="Sq ft per box"><NumberInput value={f.coverage_per_box} onChange={set('coverage_per_box')} /></Field>}
      </div>
      <div className="form-grid">
        <Field label={`Cost per ${unitLabel(f.unit)}`}><MoneyInput value={f.cost} onChange={set('cost')} /></Field>
        <Field label={`Price per ${unitLabel(f.unit)}`} hint={margin !== null ? `${pct(margin)} margin` : null}><MoneyInput value={f.price} onChange={set('price')} /></Field>
      </div>
      {cost > 0 && (
        <div className="hstack wrap"><span className="small muted">Set price for</span>{[40, 45, 50].map((m) => <Button key={m} size="sm" onClick={() => priceAt(m)}>{m}% margin</Button>)}</div>
      )}
      {f.stock_type !== 'none' && <Field label="Reorder when below" hint={`In ${unitLabel(f.unit)}. Leave blank to skip low-stock alerts.`}><NumberInput value={f.reorder_point} onChange={set('reorder_point')} /></Field>}
      <Check checked={f.taxable} onChange={set('taxable')}>Charge sales tax</Check>
      <Field label="Description"><TextArea value={f.description} onChange={set('description')} rows={2} /></Field>
      {!isNew && <Check checked={f.active} onChange={set('active')}>Available to sell</Check>}
    </Sheet>
  );
}
