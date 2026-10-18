import { useState } from 'react';
import { Truck, Plus, Send, PackageCheck, MoreHorizontal, Printer, Ban, Trash2, Mail, Pencil, Store } from 'lucide-react';
import { PO_STATUSES, productName, parseFeet, formatFeet } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { money, num, date, todayStr, unitLabel } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, IconButton, Badge, Loading, ErrorNote, Empty, Chips, Segmented, Field, Input, TextArea, MoneyInput, NumberInput, Notice } from '../ui/kit.jsx';
import { Sheet, useAction, useFeedback } from '../ui/overlay.jsx';
import { ProductPicker } from '../ui/pickers.jsx';
import { NotesPanel } from './shared.jsx';

export const poStatusLabel = (s) => PO_STATUSES.find((x) => x.id === s)?.label || s;

export function PurchasingPage({ query }) {
  const [tab, setTab] = useState(query.tab === 'vendors' ? 'vendors' : 'pos');
  return (
    <Screen title="Purchasing">
      <div className="page-head">
        <h1>Purchasing</h1>
        <Segmented label="Show" value={tab} onChange={setTab} options={[{ value: 'pos', label: 'Purchase orders' }, { value: 'vendors', label: 'Vendors' }]} />
      </div>
      {tab === 'pos' ? <PoList initialStatus={query.status} /> : <VendorList />}
    </Screen>
  );
}

function PoList({ initialStatus }) {
  const [status, setStatus] = useState(initialStatus || 'open');
  const { data, error, loading, reload } = useData('/pos', { status: status === 'all' ? '' : status });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="spread wrap">
        <Chips value={status} onChange={setStatus} options={[
          { value: 'open', label: 'Open' }, { value: 'draft', label: 'Not sent' }, { value: 'sent', label: 'Sent' },
          { value: 'partial', label: 'Partly received' }, { value: 'received', label: 'Received' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'all', label: 'All' },
        ]} />
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New purchase order</Button>
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="panel rows">
          {(data || []).map((p) => (
            <Link key={p.id} to={`/purchasing/${p.id}`} className="row">
              <div className="row-main">
                <span className="row-title">{p.number} {p.vendor_name}</span>
                <span className="row-sub">
                  {p.line_count} {p.line_count === 1 ? 'line' : 'lines'}
                  {p.order_numbers ? `, for ${p.order_numbers.split(',').join(', ')}` : ', stock'}
                  {p.expected_date ? `, expected ${date(p.expected_date)}` : ''}
                </span>
              </div>
              <div className="row-meta">
                <span className="row-amount">{money(p.total)}</span>
                <Badge status={p.status}>{poStatusLabel(p.status)}</Badge>
              </div>
            </Link>
          ))}
          {data && !data.length && <Empty icon={Truck} title="No purchase orders here">Use “Order material” on a customer order, or start a stock order.</Empty>}
        </div>
      )}
      {creating && <VendorPickSheet onClose={() => setCreating(false)} />}
    </>
  );
}

function VendorPickSheet({ onClose }) {
  const vendors = useData('/vendors');
  const [run] = useAction();
  return (
    <Sheet title="Order from which vendor?" onClose={onClose}>
      <div className="panel rows">
        {(vendors.data || []).map((v) => (
          <button key={v.id} type="button" className="row" onClick={() => run(async () => { const po = await api.post('/pos', { vendor_id: v.id }); onClose(); navigate(`/purchasing/${po.id}`); })}>
            <div className="row-main"><span className="row-title">{v.name}</span><span className="row-sub">{[v.account_number && `Account ${v.account_number}`, v.phone].filter(Boolean).join(', ')}</span></div>
          </button>
        ))}
        {vendors.data && !vendors.data.length && <div className="list-empty">Add a vendor first, under Purchasing, Vendors.</div>}
      </div>
    </Sheet>
  );
}

export function PoPage({ params }) {
  const { data: po, error, loading, reload, setData } = useData(`/pos/${params.id}`);
  const { settings } = useSession();
  const [sheet, setSheet] = useState(null);
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  if (loading && !po) return <Screen title="Purchase order" back="/purchasing"><Loading /></Screen>;
  if (error) return <Screen title="Purchase order" back="/purchasing"><ErrorNote error={error} retry={reload} /></Screen>;
  const editable = ['draft', 'sent', 'partial'].includes(po.status);
  const open = po.lines.filter((l) => l.received_qty < l.qty - 0.01);
  const close = () => setSheet(null);
  const setStatus = (status, msg) => run(async () => setData(await api.post(`/pos/${po.id}/status`, { status })), msg);
  const mailBody = encodeURIComponent([
    `Purchase order ${po.number} from ${settings.store_name}`,
    po.vendor?.account_number ? `Account ${po.vendor.account_number}` : '',
    '',
    ...po.lines.map((l) => `${num(l.qty)} ${l.unit}  ${l.description}${l.sku ? ` (${l.sku})` : ''}${l.notes ? `  ${l.notes}` : ''}`),
    '',
    po.notes || '',
    `Ship to: ${[settings.store_address, settings.store_city, settings.store_state, settings.store_zip].filter(Boolean).join(', ')}`,
    settings.store_phone ? `Phone: ${settings.store_phone}` : '',
  ].join('\n'));
  const remove = async () => {
    close();
    if (!(await confirm({ title: `Delete ${po.number}?`, message: 'Items on customer orders go back to needing material.', confirmLabel: 'Delete purchase order' }))) return;
    run(async () => { await api.del(`/pos/${po.id}`); navigate('/purchasing', { replace: true }); }, 'Purchase order deleted');
  };

  return (
    <Screen title={po.number} back="/purchasing" actions={<IconButton icon={MoreHorizontal} label="More actions" onClick={() => setSheet({ kind: 'menu' })} />}>
      <div className="page-head">
        <div className="grow">
          <h1>{po.vendor?.name}</h1>
          <div className="page-sub"><Badge status={po.status}>{poStatusLabel(po.status)}</Badge>{` ${po.number}, created ${date(po.created_at)}`}{po.expected_date ? `, expected ${date(po.expected_date)}` : ''}</div>
        </div>
      </div>
      {po.status === 'draft' && (
        <div className="next">
          <span className="next-label">Next step</span>
          <span className="next-title">Send it to {po.vendor?.name}</span>
          <p className="small muted">Call it in, email it, or place it on the vendor’s site, then mark it as sent.</p>
          <div className="page-actions">
            <Button variant="primary" icon={Send} busy={busy} disabled={!po.lines.length} onClick={() => setStatus('sent', 'Marked as sent')}>Mark as sent</Button>
            {po.vendor?.email && <a className="btn" href={`mailto:${po.vendor.email}?subject=${encodeURIComponent(`${po.number} from ${settings.store_name}`)}&body=${mailBody}`}><Mail aria-hidden="true" />Email it</a>}
          </div>
          {po.vendor?.phone && <span className="small muted">Order desk: <span className="num">{po.vendor.phone}</span>{po.vendor.account_number ? `, account ${po.vendor.account_number}` : ''}</span>}
        </div>
      )}
      {['sent', 'partial'].includes(po.status) && (
        <div className="next">
          <span className="next-label">{po.status === 'partial' ? 'Partly received' : 'Waiting on the vendor'}</span>
          <span className="next-title">{open.length} {open.length === 1 ? 'line' : 'lines'} still to come in</span>
          <div className="page-actions"><Button variant="primary" icon={PackageCheck} onClick={() => setSheet({ kind: 'receive' })}>Receive material</Button></div>
        </div>
      )}
      <div className="cols">
        <div className="stack-lg">
          <Panel title="Lines" action={editable && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setSheet({ kind: 'pick' })}>Add</Button>}>
            <div className="rows">
              {po.lines.map((l) => {
                const Tag = editable && l.received_qty === 0 ? 'button' : 'div';
                return (
                  <Tag key={l.id} type={Tag === 'button' ? 'button' : undefined} className="line" onClick={Tag === 'button' ? () => setSheet({ kind: 'line', line: l }) : undefined}>
                    <span className="line-desc">{l.description}</span>
                    <span className="line-total">{money(l.total)}</span>
                    <span className="line-meta">
                      <span>{num(l.qty)} {unitLabel(l.unit)} × {money(l.cost)}</span>
                      {l.sku && <span>{l.sku}</span>}
                      {l.order_number && <Link to={`/orders/${l.order_id}`} className="link-btn" onClick={(e) => e.stopPropagation()}>For {l.order_number}</Link>}
                      {l.received_qty > 0 && <span className={`badge ${l.received_qty >= l.qty - 0.01 ? 'badge-ok' : 'badge-warn'}`}>{num(l.received_qty)} of {num(l.qty)} in</span>}
                    </span>
                    {l.notes && <span className="line-meta">{l.notes}</span>}
                  </Tag>
                );
              })}
              {!po.lines.length && <div className="list-empty">No lines yet. Add what you’re ordering.</div>}
            </div>
            <div className="row-more spread"><span className="muted">Total at cost</span><span className="strong num">{money(po.total)}</span></div>
          </Panel>
          {po.receipts.length > 0 && (
            <Panel title="Received into stock">
              <div className="rows">
                {po.receipts.map((r) => (
                  <div key={r.id} className="row">
                    <div className="row-main">
                      <span className="row-title">{[r.manufacturer, r.style, r.color].filter(Boolean).join(' ')}</span>
                      <span className="row-sub">{[r.tag, r.dye_lot && `dye lot ${r.dye_lot}`, r.location, r.received_at && date(r.received_at)].filter(Boolean).join(', ')}</span>
                    </div>
                    <span className="small num">{r.kind === 'roll' ? `${formatFeet(r.width_ft)} × ${formatFeet(r.length_ft)}` : `${num(r.qty)} left`}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
        <div className="stack-lg">
          <Panel title="Details" action={editable && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setSheet({ kind: 'details' })}>Edit</Button>}>
            <div className="panel-body">
              <dl className="kv">
                <dt>Vendor</dt><dd><Link to={`/vendors/${po.vendor_id}`} className="link-btn">{po.vendor?.name}</Link></dd>
                {po.vendor?.account_number && <><dt>Account</dt><dd>{po.vendor.account_number}</dd></>}
                {po.vendor?.phone && <><dt>Phone</dt><dd className="num">{po.vendor.phone}</dd></>}
                <dt>Expected</dt><dd>{po.expected_date ? date(po.expected_date) : 'Not set'}</dd>
                {po.sent_at && <><dt>Sent</dt><dd>{date(po.sent_at)}</dd></>}
              </dl>
              {po.notes && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{po.notes}</div>}
            </div>
          </Panel>
          <NotesPanel entityType="po" entityId={po.id} notes={po.note_items} onChange={reload} />
        </div>
      </div>

      {sheet?.kind === 'menu' && (
        <Sheet title={po.number} onClose={close}>
          <div className="menu">
            <button type="button" className="menu-item" onClick={() => { close(); navigate(`/print/po/${po.id}`); }}><Printer aria-hidden="true" />{__DEMO__ ? 'View purchase order' : 'Print or save as PDF'}</button>
            {editable && <button type="button" className="menu-item" onClick={() => setSheet({ kind: 'details' })}><Pencil aria-hidden="true" />Edit expected date and notes</button>}
            {po.status === 'sent' && <button type="button" className="menu-item" onClick={() => { close(); setStatus('draft', 'Back to not sent'); }}><Send aria-hidden="true" />Mark as not sent</button>}
            {['draft', 'sent'].includes(po.status) && <button type="button" className="menu-item danger" onClick={() => { close(); setStatus('cancelled', 'Purchase order cancelled'); }}><Ban aria-hidden="true" />Cancel purchase order</button>}
            {po.status === 'draft' && <button type="button" className="menu-item danger" onClick={remove}><Trash2 aria-hidden="true" />Delete purchase order</button>}
          </div>
        </Sheet>
      )}
      {sheet?.kind === 'pick' && <ProductPicker title="Add to purchase order" onClose={close} onPick={(p) => setSheet({ kind: 'line', product: p })} />}
      {sheet?.kind === 'line' && <PoLineSheet po={po} line={sheet.line} product={sheet.product} onClose={close} onSaved={(fresh) => { close(); setData(fresh); }} />}
      {sheet?.kind === 'details' && <PoDetailsSheet po={po} onClose={close} onSaved={(fresh) => { close(); setData(fresh); }} />}
      {sheet?.kind === 'receive' && <ReceiveSheet po={po} onClose={close} onSaved={(fresh) => { close(); setData(fresh); }} />}
    </Screen>
  );
}

function PoLineSheet({ po, line, product, onClose, onSaved }) {
  const boxed = product?.stock_type === 'box' && product.coverage_per_box > 0;
  const [f, setF] = useState(() => (line
    ? { qty: String(line.qty), cost: String(line.cost), description: line.description, notes: line.notes || '' }
    : { qty: '', cost: String(boxed ? Math.round(product.cost * product.coverage_per_box * 100) / 100 : product?.cost ?? ''), description: product ? productName(product) : '', notes: '' }));
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [run, busy] = useAction();
  const unit = line ? line.unit : boxed ? 'BOX' : product?.unit;
  const save = () => run(async () => onSaved(line ? await api.put(`/po-lines/${line.id}`, f) : await api.post(`/pos/${po.id}/lines`, { ...f, product_id: product?.id })), line ? 'Line saved' : 'Line added');
  const remove = () => run(async () => onSaved(await api.del(`/po-lines/${line.id}`)), 'Line removed');
  return (
    <Sheet title={line ? 'Edit line' : 'Add line'} onClose={onClose}
      footer={<>{line && !line.order_line_id && <Button variant="ghost" className="btn-danger" icon={Trash2} onClick={remove}>Remove</Button>}{line?.order_line_id && <Button variant="ghost" className="btn-danger" icon={Trash2} onClick={remove}>Remove from PO</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{line ? 'Save line' : 'Add line'}</Button></>}>
      <Field label="Description"><Input value={f.description} onChange={set('description')} /></Field>
      <div className="form-grid">
        <Field label={`Quantity (${unitLabel(unit)})`} hint={boxed && f.qty ? `${num(Number(f.qty) * product.coverage_per_box)} sq ft` : null}><NumberInput value={f.qty} onChange={set('qty')} data-autofocus /></Field>
        <Field label={`Cost per ${unitLabel(unit)}`}><MoneyInput value={f.cost} onChange={set('cost')} /></Field>
      </div>
      <Field label="Notes for the vendor" hint="Cut size, dye lot to match, ship-to"><Input value={f.notes} onChange={set('notes')} /></Field>
      {line?.order_line_id && <Notice>This line is for {line.order_number}. Removing it puts that item back to needing material.</Notice>}
    </Sheet>
  );
}

function PoDetailsSheet({ po, onClose, onSaved }) {
  const [f, setF] = useState({ expected_date: po.expected_date || '', notes: po.notes || '' });
  const [run, busy] = useAction();
  return (
    <Sheet title="Purchase order details" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => run(async () => onSaved(await api.put(`/pos/${po.id}`, f)), 'Saved')}>Save</Button></>}>
      <Field label="Expected delivery"><Input type="date" value={f.expected_date} onChange={(v) => setF((s) => ({ ...s, expected_date: v }))} /></Field>
      <Field label="Notes"><TextArea value={f.notes} onChange={(v) => setF((s) => ({ ...s, notes: v }))} /></Field>
    </Sheet>
  );
}

function ReceiveSheet({ po, onClose, onSaved }) {
  const open = po.lines.filter((l) => l.received_qty < l.qty - 0.01);
  const [location, setLocation] = useState('');
  const [date0, setDate0] = useState(todayStr());
  const [rows, setRows] = useState(() => open.map((l) => ({
    key: `l${l.id}`, po_line_id: l.id, line: l, include: open.length === 1 || l.stock_type === 'roll',
    qty: l.stock_type === 'roll' ? '' : String(Math.round((l.qty - l.received_qty) * 100) / 100),
    width_ft: l.roll_width_ft ? String(l.roll_width_ft) : '', length_ft: '', tag: '', dye_lot: '',
  })));
  const [run, busy] = useAction();
  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addPiece = (r) => setRows((rs) => {
    const i = rs.findIndex((x) => x.key === r.key);
    const copy = { ...r, key: `${r.key}-${Date.now()}`, length_ft: '', tag: '' };
    return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
  });
  const items = rows.filter((r) => r.include && (r.line.stock_type === 'roll' ? parseFeet(r.length_ft) > 0 : Number(r.qty) > 0))
    .map((r) => ({ po_line_id: r.po_line_id, qty: r.qty, width_ft: r.width_ft, length_ft: r.length_ft, tag: r.tag, dye_lot: r.dye_lot, location }));
  return (
    <Sheet title={`Receive ${po.number}`} onClose={onClose} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!items.length} onClick={() => run(async () => onSaved(await api.post(`/pos/${po.id}/receive`, { items, date: date0 })), 'Received into stock')}>{items.length ? `Receive ${items.length} ${items.length === 1 ? 'piece' : 'pieces'}` : 'Enter what arrived'}</Button></>}>
      <div className="form-grid">
        <Field label="Put away at" hint="Rack or bin for everything below"><Input value={location} onChange={setLocation} placeholder="Rack A1" /></Field>
        <Field label="Date received"><Input type="date" value={date0} onChange={setDate0} /></Field>
      </div>
      <div className="spread wrap">
        <span className="small muted">Check each line that came in and enter what arrived.</span>
        <Button size="sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: true })))}>Everything arrived</Button>
      </div>
      <Notice>Material bought for a customer order is pulled for that order as soon as it’s received.</Notice>
      {rows.map((r) => {
        const l = r.line;
        const roll = l.stock_type === 'roll';
        const len = parseFeet(r.length_ft);
        return (
          <div key={r.key} className="panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
            <div className="spread">
              <label className="check" style={{ minHeight: 0 }}><input type="checkbox" checked={r.include} onChange={(e) => update(r.key, { include: e.target.checked })} /><span className="strong">{l.description}</span></label>
              <span className="small muted nowrap">{num(l.qty - l.received_qty)} {l.unit} to come{l.order_number ? `, for ${l.order_number}` : ''}</span>
            </div>
            {l.notes && <span className="xs faint">{l.notes}</span>}
            {r.include && (
              <div className="form-grid">
                {roll ? (
                  <>
                    <Field label="Width" hint={parseFeet(r.width_ft) ? formatFeet(parseFeet(r.width_ft)) : null}><Input value={r.width_ft} onChange={(v) => update(r.key, { width_ft: v })} inputMode="decimal" /></Field>
                    <Field label="Length" hint={len ? formatFeet(len) : 'like 42 6'}><Input value={r.length_ft} onChange={(v) => update(r.key, { length_ft: v })} inputMode="decimal" /></Field>
                  </>
                ) : (
                  <Field label={l.unit === 'BOX' ? 'Boxes' : `Quantity (${unitLabel(l.unit)})`}><Input value={r.qty} onChange={(v) => update(r.key, { qty: v })} inputMode="decimal" /></Field>
                )}
                {l.stock_type && l.stock_type !== 'none' && (
                  <>
                    <Field label={roll ? 'Roll tag' : 'Lot or tag'}><Input value={r.tag} onChange={(v) => update(r.key, { tag: v })} /></Field>
                    <Field label="Dye lot"><Input value={r.dye_lot} onChange={(v) => update(r.key, { dye_lot: v })} /></Field>
                  </>
                )}
              </div>
            )}
            {r.include && roll && <div><Button size="sm" variant="ghost" icon={Plus} onClick={() => addPiece(r)}>Another roll for this line</Button></div>}
          </div>
        );
      })}
    </Sheet>
  );
}

// ---------------- vendors ----------------
function VendorList() {
  const { data, error, loading, reload } = useData('/vendors');
  const [editing, setEditing] = useState(null);
  return (
    <>
      <div className="spread"><span className="muted small">{data ? `${data.length} vendors` : ''}</span><Button variant="primary" icon={Plus} onClick={() => setEditing({})}>New vendor</Button></div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="panel rows">
          {(data || []).map((v) => (
            <Link key={v.id} to={`/vendors/${v.id}`} className="row">
              <div className="row-main"><span className="row-title">{v.name}</span><span className="row-sub">{[v.contact, v.phone, v.account_number && `Account ${v.account_number}`].filter(Boolean).join(', ')}</span></div>
              <div className="row-meta"><span className="xs faint">{v.product_count} products</span>{v.open_pos > 0 && <Badge tone="warn">{v.open_pos} open</Badge>}</div>
            </Link>
          ))}
          {data && !data.length && <Empty icon={Store} title="No vendors yet">Add the mills and distributors you buy from.</Empty>}
        </div>
      )}
      {editing && <VendorSheet vendor={editing} onClose={() => setEditing(null)} onSaved={(v) => { setEditing(null); navigate(`/vendors/${v.id}`); }} />}
    </>
  );
}

export function VendorPage({ params }) {
  const { data: v, error, loading, reload } = useData(`/vendors/${params.id}`);
  const [editing, setEditing] = useState(false);
  const [run] = useAction();
  if (loading && !v) return <Screen title="Vendor" back="/purchasing?tab=vendors"><Loading /></Screen>;
  if (error) return <Screen title="Vendor" back="/purchasing?tab=vendors"><ErrorNote error={error} retry={reload} /></Screen>;
  return (
    <Screen title={v.name} back="/purchasing?tab=vendors" actions={<Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}>
      <div className="page-head">
        <div><h1>{v.name}</h1><div className="page-sub">{[v.contact, v.account_number && `Account ${v.account_number}`].filter(Boolean).join(', ')}</div></div>
        <div className="page-actions"><Button variant="primary" icon={Plus} onClick={() => run(async () => { const po = await api.post('/pos', { vendor_id: v.id }); navigate(`/purchasing/${po.id}`); })}>New purchase order</Button></div>
      </div>
      <div className="cols">
        <div className="stack-lg">
          <Panel title="Purchase orders">
            <div className="rows">
              {v.pos.map((p) => (
                <Link key={p.id} to={`/purchasing/${p.id}`} className="row">
                  <div className="row-main"><span className="row-title">{p.number}</span><span className="row-sub">{date(p.created_at)}{p.expected_date ? `, expected ${date(p.expected_date)}` : ''}</span></div>
                  <div className="row-meta"><span className="row-amount">{money(p.total)}</span><Badge status={p.status}>{poStatusLabel(p.status)}</Badge></div>
                </Link>
              ))}
              {!v.pos.length && <div className="list-empty">No purchase orders yet.</div>}
            </div>
          </Panel>
          <Panel title="Products">
            <div className="rows">
              {v.products.map((p) => (
                <Link key={p.id} to={`/products/${p.id}`} className="row">
                  <div className="row-main"><span className="row-title">{productName(p)}</span></div>
                  <span className="small num">{money(p.price)} / {unitLabel(p.unit)}</span>
                </Link>
              ))}
              {!v.products.length && <div className="list-empty">No products from this vendor.</div>}
            </div>
          </Panel>
        </div>
        <Panel title="Contact">
          <div className="panel-body">
            <dl className="kv">
              {v.phone && <><dt>Phone</dt><dd className="num">{v.phone}</dd></>}
              {v.email && <><dt>Email</dt><dd>{v.email}</dd></>}
              {v.address && <><dt>Address</dt><dd>{v.address}</dd></>}
            </dl>
            {v.notes && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{v.notes}</div>}
          </div>
        </Panel>
      </div>
      {editing && <VendorSheet vendor={v} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </Screen>
  );
}

function VendorSheet({ vendor, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', contact: '', phone: '', email: '', account_number: '', address: '', notes: '', ...vendor });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [run, busy] = useAction();
  return (
    <Sheet title={vendor.id ? 'Edit vendor' : 'New vendor'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => run(async () => onSaved(vendor.id ? await api.put(`/vendors/${vendor.id}`, f) : await api.post('/vendors', f)), 'Vendor saved')}>Save vendor</Button></>}>
      <Field label="Vendor name"><Input value={f.name} onChange={set('name')} /></Field>
      <div className="form-grid">
        <Field label="Contact"><Input value={f.contact} onChange={set('contact')} /></Field>
        <Field label="Our account number"><Input value={f.account_number} onChange={set('account_number')} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} type="tel" /></Field>
        <Field label="Order email"><Input value={f.email} onChange={set('email')} type="email" /></Field>
      </div>
      <Field label="Address"><TextArea value={f.address} onChange={set('address')} rows={2} /></Field>
      <Field label="Notes" hint="Freight terms, cutoff times, rep's cell"><TextArea value={f.notes} onChange={set('notes')} rows={2} /></Field>
    </Sheet>
  );
}

