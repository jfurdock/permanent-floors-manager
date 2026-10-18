// Pieces shared by quotes and orders: line items, rooms, totals and notes.
import { useState } from 'react';
import { Ruler, PackagePlus, PenLine, Trash2, ArrowUp, ArrowDown, Plus, Pencil } from 'lucide-react';
import { UNITS, CATEGORY, productName, roomArea, formatFeet, saleToStock, stockUnitLabel } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { money, num, pct, dateTime, unitLabel } from '../lib/format.js';
import { Panel, Button, Field, Input, Select, TextArea, MoneyInput, NumberInput, Check, FeetInput, Segmented, Notice } from '../ui/kit.jsx';
import { Sheet, useAction, useFeedback } from '../ui/overlay.jsx';
import { ProductPicker } from '../ui/pickers.jsx';
import RoomDiagram from '../ui/RoomDiagram.jsx';
import RoomCalculator from '../ui/RoomCalculator.jsx';

const plural = (type) => (type === 'quote' ? 'quotes' : 'orders');

// ---------------- notes ----------------
export function NotesPanel({ entityType, entityId, notes = [], onChange, title = 'Notes' }) {
  const { user, isManager } = useSession();
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const add = () => run(async () => {
    await api.post('/notes', { entity_type: entityType, entity_id: entityId, body: text });
    setText('');
    onChange?.();
  });
  return (
    <Panel title={title}>
      <div className="panel-body">
        <Field label="Add a note">
          <TextArea value={text} onChange={setText} placeholder="Calls, promises, measurements, anything to remember" rows={2} />
        </Field>
        <div><Button size="sm" busy={busy} disabled={!text.trim()} onClick={add}>Save note</Button></div>
      </div>
      {notes.length > 0 && (
        <div className="rows" style={{ borderTop: '1px solid var(--line)' }}>
          {notes.map((n) => (
            <div key={n.id} className="note">
              <div className="note-body">{n.body}</div>
              <div className="spread">
                <span className="note-meta">{n.user_name || 'Someone'}, {dateTime(n.created_at)}</span>
                {(n.user_id === user.id || isManager) && (
                  <button type="button" className="link-btn xs" onClick={() => run(async () => { await api.del(`/notes/${n.id}`); onChange?.(); })}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------- line items ----------------
function materialChip(l) {
  if (l.material_status === 'none') return null;
  if (l.material_status === 'received') return { tone: 'ok', label: 'Material in' };
  if (l.material_status === 'ordered') return { tone: 'warn', label: l.po_lines?.[0] ? `On ${l.po_lines[0].po_number}` : 'On order' };
  return { tone: 'danger', label: 'Needs ordering' };
}

export function LinesPanel({ doc, type, editable, onChange, renderMaterial }) {
  const [editing, setEditing] = useState(null); // line object or {new: true, product}
  const [picking, setPicking] = useState(false);
  const [calc, setCalc] = useState(false);
  const lines = doc.lines || [];
  return (
    <Panel title="Items" action={<span className="small faint">{lines.length} {lines.length === 1 ? 'item' : 'items'}</span>}>
      <div className="rows">
        {lines.map((l) => {
          const chip = type === 'order' ? materialChip(l) : null;
          const Tag = editable ? 'button' : 'div';
          return (
            <div key={l.id} className="line-wrap">
              <Tag type={editable ? 'button' : undefined} className="line" onClick={editable ? () => setEditing(l) : undefined}>
                <span className="line-desc">{l.description}</span>
                <span className="line-total">{money(l.total)}</span>
                <span className="line-meta">
                  <span>{num(l.qty)} {unitLabel(l.unit)} × {money(l.price)}</span>
                  {l.area && <span>{l.area}</span>}
                  {!l.taxable && <span>No tax</span>}
                  {chip && <span className={`badge badge-${chip.tone}`}>{chip.label}</span>}
                </span>
                {l.notes && <span className="line-meta">{l.notes}</span>}
              </Tag>
              {renderMaterial && l.material_status !== 'none' && renderMaterial(l)}
            </div>
          );
        })}
        {!lines.length && (
          <div className="list-empty">
            {editable ? 'No items yet. Measure the rooms to calculate carpet, pad and labor, or add products one at a time.' : 'No items.'}
          </div>
        )}
      </div>
      {editable && (
        <div className="add-bar">
          <Button variant="primary" icon={Ruler} onClick={() => setCalc(true)}>Measure &amp; add</Button>
          <Button icon={PackagePlus} onClick={() => setPicking(true)}>Add product</Button>
          <Button icon={PenLine} onClick={() => setEditing({ isNew: true })}>Custom item</Button>
        </div>
      )}
      {picking && (
        <ProductPicker onClose={() => setPicking(false)}
          onCustom={() => { setPicking(false); setEditing({ isNew: true }); }}
          onPick={(p) => { setPicking(false); setEditing({ isNew: true, product: p }); }} />
      )}
      {editing && (
        <LineSheet type={type} doc={doc} line={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChange(); }} />
      )}
      {calc && <RoomCalculator doc={doc} type={type} onClose={() => setCalc(false)} onAdded={() => { setCalc(false); onChange(); }} onRoomsChanged={onChange} />}
    </Panel>
  );
}

function LineSheet({ type, doc, line, onClose, onSaved }) {
  const isNew = !!line.isNew;
  const p = line.product;
  const [f, setF] = useState(() => (isNew ? {
    description: p ? productName(p) : '',
    area: '', unit: p?.unit || 'EA', qty: '', price: p ? String(p.price) : '', cost: p ? String(p.cost) : '',
    taxable: p ? !!p.taxable : true, notes: '', kind: 'material',
  } : {
    description: line.description, area: line.area || '', unit: line.unit, qty: String(line.qty), price: String(line.price),
    cost: String(line.cost), taxable: !!line.taxable, notes: line.notes || '',
  }));
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const total = (Number(f.qty) || 0) * (Number(String(f.price).replace(/[$,]/g, '')) || 0);
  const product = p || (line.product_id ? { stock_type: line.stock_type, unit: line.unit, coverage_per_box: line.coverage_per_box, roll_width_ft: line.roll_width_ft } : null);
  const stockHint = product && product.stock_type !== 'none' && Number(f.qty) > 0 ? (() => {
    const s = saleToStock(product, Number(f.qty));
    if (product.stock_type === 'roll') return `${formatFeet(s)} off a ${formatFeet(product.roll_width_ft || 12)} roll`;
    if (product.stock_type === 'box') return `${num(s)} ${s === 1 ? 'box' : 'boxes'}${product.coverage_per_box ? ` at ${num(product.coverage_per_box)} sq ft each` : ''}`;
    return `${num(s)} ${stockUnitLabel(product)}`;
  })() : null;
  // Round box goods up to full boxes
  const roundBoxes = product?.stock_type === 'box' && product.coverage_per_box > 0 && Number(f.qty) > 0 && product.unit !== 'BOX'
    ? Math.round(Math.ceil(Number(f.qty) / product.coverage_per_box - 1e-9) * product.coverage_per_box * 100) / 100 : null;

  const save = () => run(async () => {
    const body = { ...f, taxable: f.taxable ? 1 : 0 };
    if (isNew) {
      await api.post(`/${plural(type)}/${doc.id}/lines`, { ...body, product_id: p?.id || null, kind: p ? undefined : f.kind });
    } else {
      await api.put(`/lines/${line.id}`, body);
    }
    onSaved();
  }, isNew ? 'Item added' : 'Item saved');
  const remove = async () => {
    if (!(await confirm({ title: 'Remove this item?', message: line.description, confirmLabel: 'Remove item' }))) return;
    run(async () => { await api.del(`/lines/${line.id}`); onSaved(); }, 'Item removed');
  };
  const move = (dir) => run(async () => { await api.post(`/lines/${line.id}/move`, { dir }); onSaved(); });

  return (
    <Sheet title={isNew ? (p ? 'Add item' : 'Custom item') : 'Edit item'} onClose={onClose}
      footer={(
        <>
          {!isNew && <Button variant="ghost" className="btn-danger" icon={Trash2} onClick={remove}>Remove</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>{isNew ? 'Add item' : 'Save item'}</Button>
        </>
      )}>
      {isNew && !p && (
        <Segmented label="Kind of item" value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v, taxable: v === 'material' }))}
          options={[{ value: 'material', label: 'Material' }, { value: 'labor', label: 'Labor' }, { value: 'other', label: 'Fee or service' }]} />
      )}
      <Field label="Description"><Input value={f.description} onChange={set('description')} data-autofocus={isNew && !p ? true : undefined} /></Field>
      <div className="form-grid">
        <Field label="Quantity" hint={stockHint}>
          <NumberInput value={f.qty} onChange={set('qty')} data-autofocus={isNew && p ? true : undefined} />
        </Field>
        <Field label="Unit">
          <Select value={f.unit} onChange={set('unit')} options={UNITS.map((u) => ({ value: u, label: `${u} (${unitLabel(u)})` }))} />
        </Field>
      </div>
      {roundBoxes !== null && roundBoxes !== Number(f.qty) && (
        <Notice action={<Button size="sm" onClick={() => set('qty')(String(roundBoxes))}>Use {num(roundBoxes)}</Button>}>
          Sold by the box. Full boxes come to {num(roundBoxes)} sq ft.
        </Notice>
      )}
      <div className="form-grid">
        <Field label={`Price per ${unitLabel(f.unit)}`}><MoneyInput value={f.price} onChange={set('price')} /></Field>
        <Field label={`Cost per ${unitLabel(f.unit)}`} hint="Used for margin. Customers never see it."><MoneyInput value={f.cost} onChange={set('cost')} /></Field>
      </div>
      <Field label="Rooms or area" hint="Shows on the quote, e.g. Living room, hall"><Input value={f.area} onChange={set('area')} /></Field>
      <Check checked={f.taxable} onChange={set('taxable')}>Charge sales tax on this item</Check>
      <Field label="Item notes"><TextArea value={f.notes} onChange={set('notes')} rows={2} /></Field>
      <div className="spread"><span className="muted">Line total</span><span className="strong num">{money(total)}</span></div>
      {!isNew && (
        <div className="hstack">
          <Button size="sm" variant="ghost" icon={ArrowUp} onClick={() => move('up')}>Move up</Button>
          <Button size="sm" variant="ghost" icon={ArrowDown} onClick={() => move('down')}>Move down</Button>
        </div>
      )}
    </Sheet>
  );
}

// ---------------- totals ----------------
export function TotalsPanel({ doc, type, editable, onChange, children }) {
  const [editing, setEditing] = useState(false);
  const net = doc.subtotal - doc.discount;
  const profit = net - doc.cost_total;
  return (
    <Panel title="Totals" action={editable && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Discount &amp; tax</Button>}>
      <div className="panel-body">
        <div className="totals">
          <div className="spread"><span>Subtotal</span><span>{money(doc.subtotal)}</span></div>
          {doc.discount > 0 && <div className="spread"><span>Discount</span><span>−{money(doc.discount)}</span></div>}
          <div className="spread"><span>Sales tax ({num(doc.tax_rate, 3)}%)</span><span>{money(doc.tax)}</span></div>
          <div className="spread totals-grand"><span>Total</span><span>{money(doc.total)}</span></div>
          {type === 'order' && (
            <>
              <div className="spread"><span>Paid</span><span>{money(doc.paid_total)}</span></div>
              <div className="spread strong"><span>Balance due</span><span>{money(doc.total - doc.paid_total)}</span></div>
            </>
          )}
          <div className="spread small faint"><span>Gross profit (staff only)</span><span>{money(profit)}{net > 0 ? `, ${pct((profit / net) * 100)}` : ''}</span></div>
        </div>
        {children}
      </div>
      {editing && <AdjustSheet doc={doc} type={type} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChange(); }} />}
    </Panel>
  );
}

function AdjustSheet({ doc, type, onClose, onSaved }) {
  const [discount, setDiscount] = useState(String(doc.discount || ''));
  const [mode, setMode] = useState('amount');
  const [rate, setRate] = useState(String(doc.tax_rate));
  const [run, busy] = useAction();
  const discountAmt = mode === 'percent' ? Math.round(doc.subtotal * (Number(discount) || 0)) / 100 : Number(String(discount).replace(/[$,]/g, '')) || 0;
  return (
    <Sheet title="Discount and tax" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => run(async () => { await api.put(`/${plural(type)}/${doc.id}`, { discount: discountAmt, tax_rate: rate }); onSaved(); }, 'Totals updated')}>Save</Button></>}>
      <Segmented label="Discount type" value={mode} onChange={(m) => {
        if (m === mode) return;
        if (m === 'percent') setDiscount(doc.subtotal > 0 && discountAmt ? String(Math.round((discountAmt / doc.subtotal) * 10000) / 100) : '');
        else setDiscount(discountAmt ? String(discountAmt) : '');
        setMode(m);
      }} options={[{ value: 'amount', label: 'Dollar amount' }, { value: 'percent', label: 'Percent' }]} />
      <Field label={mode === 'percent' ? 'Discount percent' : 'Discount'} hint={mode === 'percent' ? `${money(discountAmt)} off ${money(doc.subtotal)}` : 'Taken off before tax'}>
        {mode === 'percent' ? <NumberInput value={discount} onChange={setDiscount} suffix="%" /> : <MoneyInput value={discount} onChange={setDiscount} />}
      </Field>
      <Field label="Sales tax rate" hint="Applies to taxable items only. Labor is usually not taxed.">
        <NumberInput value={rate} onChange={setRate} suffix="%" />
      </Field>
    </Sheet>
  );
}

// ---------------- rooms ----------------
export function RoomsPanel({ doc, type, editable, onChange }) {
  const [editing, setEditing] = useState(null);
  const rooms = doc.rooms || [];
  const total = rooms.reduce((s, r) => s + roomArea(r), 0);
  if (!rooms.length && !editable) return null;
  return (
    <Panel title="Rooms" action={editable && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setEditing({})}>Add room</Button>}>
      <div className="rows">
        {rooms.map((r) => {
          const Tag = editable ? 'button' : 'div';
          return (
            <Tag key={r.id} type={editable ? 'button' : undefined} className="row" onClick={editable ? () => setEditing(r) : undefined}>
              <div className="row-main"><span className="row-title">{r.name}</span><span className="row-sub num">{formatFeet(r.length_ft)} × {formatFeet(r.width_ft)}</span></div>
              <span className="row-amount small">{num(roomArea(r), 1)} sq ft</span>
            </Tag>
          );
        })}
        {!rooms.length && <div className="list-empty">Add rooms to calculate materials and show a diagram on the quote.</div>}
      </div>
      {rooms.length > 0 && (
        <>
          <div className="row-more spread"><span className="muted">Total floor area</span><span className="strong num">{num(total, 1)} sq ft ({num(total / 9, 1)} sq yd)</span></div>
          <div className="panel-body" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="diagram-wrap"><RoomDiagram rooms={rooms} /></div>
          </div>
        </>
      )}
      {editing && <RoomSheet room={editing} doc={doc} type={type} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
    </Panel>
  );
}

export function RoomSheet({ room, doc, type, onClose, onSaved }) {
  const [f, setF] = useState({ name: room.name || '', length_ft: room.id ? formatFeet(room.length_ft).replace('"', '') : '', width_ft: room.id ? formatFeet(room.width_ft).replace('"', '') : '', notes: room.notes || '' });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const save = () => run(async () => {
    if (room.id) await api.put(`/rooms/${room.id}`, f);
    else await api.post(`/${plural(type)}/${doc.id}/rooms`, f);
    onSaved();
  }, room.id ? 'Room saved' : 'Room added');
  const remove = async () => {
    if (!(await confirm({ title: `Remove ${room.name}?`, confirmLabel: 'Remove room' }))) return;
    run(async () => { await api.del(`/rooms/${room.id}`); onSaved(); }, 'Room removed');
  };
  return (
    <Sheet title={room.id ? 'Edit room' : 'Add room'} onClose={onClose}
      footer={<>{room.id && <Button variant="ghost" className="btn-danger" icon={Trash2} onClick={remove}>Remove</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{room.id ? 'Save room' : 'Add room'}</Button></>}>
      <Field label="Room name"><Input value={f.name} onChange={set('name')} placeholder="Living room" list="room-names" /></Field>
      <RoomNames />
      <div className="form-grid">
        <FeetInput label="Length" value={f.length_ft} onChange={set('length_ft')} />
        <FeetInput label="Width" value={f.width_ft} onChange={set('width_ft')} />
      </div>
      <Field label="Room notes" hint="Closets, transitions, floor vents"><Input value={f.notes} onChange={set('notes')} /></Field>
    </Sheet>
  );
}

export function RoomNames() {
  return (
    <datalist id="room-names">
      {['Living room', 'Family room', 'Dining room', 'Kitchen', 'Primary bedroom', 'Bedroom 2', 'Bedroom 3', 'Hall', 'Stairs', 'Basement', 'Office', 'Bathroom', 'Laundry', 'Entry', 'Closet'].map((n) => <option key={n} value={n} />)}
    </datalist>
  );
}

export const categoryOf = (l) => CATEGORY[l.category];
