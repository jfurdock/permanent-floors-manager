// Measure rooms, pick flooring, and add the material plus pad, labor and extras in one step.
import { useMemo, useState } from 'react';
import { Plus, Trash2, Repeat } from 'lucide-react';
import { CATEGORY, estimate, parseFeet, formatFeet, roomArea, productName } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { money, num, unitLabel } from '../lib/format.js';
import { Sheet, useAction } from './overlay.jsx';
import { Button, Field, Select, Check, NumberInput, Segmented, Notice, IconButton } from './kit.jsx';
import { ProductPicker } from './pickers.jsx';
import RoomDiagram, { DiagramLegend } from './RoomDiagram.jsx';

const plural = (type) => (type === 'quote' ? 'quotes' : 'orders');
const toInput = (ft) => (ft ? formatFeet(ft).replace('"', '').trim() : '');

const LABOR_MATCH = {
  carpet: /carpet/i, pad: /carpet/i, lvp: /lvp|laminate|vinyl plank/i, laminate: /laminate|lvp/i, hardwood: /hardwood|wood/i, tile: /tile/i, sheet_vinyl: /sheet|vinyl/i,
};

export default function RoomCalculator({ doc, type, onClose, onAdded, onRoomsChanged }) {
  const [rooms, setRooms] = useState(() => {
    const saved = (doc.rooms || []).map((r) => ({ key: `r${r.id}`, id: r.id, name: r.name, length: toInput(r.length_ft), width: toInput(r.width_ft), on: true, dirty: false }));
    return saved.length ? saved : [{ key: 'n1', name: '', length: '', width: '', on: true, dirty: true }];
  });
  const [product, setProduct] = useState(null);
  const [picking, setPicking] = useState(false);
  const [method, setMethod] = useState('roll');
  const [waste, setWaste] = useState('');
  const [addons, setAddons] = useState({});
  const catalog = useData('/products', { limit: 1000 });
  const [run, busy] = useAction();

  const parsed = rooms.map((r) => ({ ...r, length_ft: parseFeet(r.length), width_ft: parseFeet(r.width) }));
  const valid = parsed.filter((r) => r.on && r.length_ft > 0 && r.width_ft > 0);
  const cat = product ? CATEGORY[product.category] : null;
  const isRoll = product?.stock_type === 'roll';
  const wastePct = waste === '' ? (cat?.waste ?? 10) : Number(waste) || 0;
  const est = product && valid.length ? estimate({ rooms: valid, product, wastePct, method: isRoll ? method : 'area' }) : null;
  const areaSf = valid.reduce((s, r) => s + roomArea(r), 0);
  const perimeter = valid.reduce((s, r) => s + 2 * (r.length_ft + r.width_ft), 0);
  const areaText = valid.map((r) => r.name || 'Room').join(', ').slice(0, 200);

  const products = catalog.data || [];
  const byCat = (c) => products.filter((p) => p.category === c);
  const suggestions = useMemo(() => {
    if (!product || !est) return [];
    const out = [];
    const qtyFor = (p) => {
      if (!p) return 0;
      if (p.unit === 'SY') return product.unit === 'SY' ? est.qty : Math.ceil((areaSf / 9) * 100) / 100;
      if (p.unit === 'SF') return Math.ceil(areaSf);
      if (p.unit === 'LF') return Math.ceil(perimeter * 1.1);
      return valid.length;
    };
    if (product.category === 'carpet') {
      const pads = byCat('pad');
      if (pads.length) out.push({ key: 'pad', label: 'Carpet pad', options: pads, qty: (p) => (p.unit === 'SY' ? est.qty : qtyFor(p)) });
    }
    const labor = byCat('labor').filter((p) => (LABOR_MATCH[product.category] || /./).test(p.style));
    const laborAll = byCat('labor');
    if (laborAll.length) out.push({ key: 'labor', label: 'Installation', options: labor.length ? [...labor, ...laborAll.filter((x) => !labor.includes(x))] : laborAll, qty: qtyFor });
    const services = byCat('service');
    const tear = services.filter((p) => /remove|tear/i.test(p.style));
    if (tear.length) out.push({ key: 'tearout', label: 'Remove old flooring', options: tear, qty: qtyFor });
    const furn = services.filter((p) => /furniture/i.test(p.style));
    if (furn.length) out.push({ key: 'furniture', label: 'Move furniture', options: furn, qty: () => valid.length });
    if (['lvp', 'laminate', 'hardwood'].includes(product.category)) {
      const trim = byCat('trim').filter((p) => /quarter|shoe|base/i.test(p.style));
      if (trim.length) out.push({ key: 'trim', label: 'Quarter round', options: trim, qty: (p) => (p.unit === 'LF' ? Math.ceil(perimeter * 1.1) : Math.ceil((perimeter * 1.1) / 8)), hint: '8 ft pieces around the room' });
    }
    if (product.category === 'tile') {
      const sundry = byCat('sundry');
      const thinset = sundry.filter((p) => /thinset|mortar/i.test(p.style));
      if (thinset.length) out.push({ key: 'thinset', label: 'Thinset', options: thinset, qty: () => Math.max(1, Math.ceil(areaSf / 50)), hint: 'About 50 sq ft per bag' });
      const grout = sundry.filter((p) => /grout/i.test(p.style));
      if (grout.length) out.push({ key: 'grout', label: 'Grout', options: grout, qty: () => Math.max(1, Math.ceil(areaSf / 100)), hint: 'About 100 sq ft per bag' });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, est?.qty, areaSf, perimeter, valid.length, products.length]);

  const addonState = (s) => addons[s.key] || { on: s.key !== 'furniture' && s.key !== 'tearout', productId: s.options[0]?.id };
  const chosen = suggestions.map((s) => {
    const st = addonState(s);
    const p = s.options.find((o) => o.id === Number(st.productId)) || s.options[0];
    return { s, st, p, qty: p ? s.qty(p) : 0 };
  });
  const count = (est ? 1 : 0) + chosen.filter((c) => c.st.on && c.p && c.qty > 0).length;
  const estTotal = (est ? est.qty * product.price : 0) + chosen.filter((c) => c.st.on && c.p).reduce((sum, c) => sum + c.qty * c.p.price, 0);

  const updateRoom = (key, patch) => setRooms((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, dirty: patch.on === undefined ? true : r.dirty } : r)));
  const removeRoom = (r) => run(async () => {
    if (r.id) { await api.del(`/rooms/${r.id}`); onRoomsChanged?.(); }
    setRooms((rs) => rs.filter((x) => x.key !== r.key));
  });

  // Save new or changed rooms, then add the lines.
  const add = () => run(async () => {
    const toSave = parsed.filter((r) => r.dirty && r.length_ft > 0 && r.width_ft > 0);
    for (const r of toSave) {
      const body = { name: r.name || 'Room', length_ft: r.length, width_ft: r.width };
      if (r.id) await api.put(`/rooms/${r.id}`, body);
      else await api.post(`/${plural(type)}/${doc.id}/rooms`, body);
    }
    const lines = [];
    if (est) {
      const note = est.layout ? `${est.layout.rooms.reduce((s, x) => s + x.drops, 0)} drops, ${est.layout.seams} ${est.layout.seams === 1 ? 'seam' : 'seams'}, ${formatFeet(est.layout.linearFt)} of ${formatFeet(est.layout.rollWidth)} roll`
        : est.boxes ? `${est.boxes} boxes, ${wastePct}% waste` : null;
      lines.push({ product_id: product.id, qty: est.qty, area: areaText, notes: note });
    }
    for (const c of chosen) if (c.st.on && c.p && c.qty > 0) lines.push({ product_id: c.p.id, qty: c.qty, area: c.s.key === 'labor' || c.s.key === 'pad' ? areaText : null });
    await api.post(`/${plural(type)}/${doc.id}/lines`, { lines });
    onAdded();
  }, `${count} ${count === 1 ? 'item' : 'items'} added`);

  const saveRoomsOnly = () => run(async () => {
    for (const r of parsed.filter((x) => x.dirty && x.length_ft > 0 && x.width_ft > 0)) {
      const body = { name: r.name || 'Room', length_ft: r.length, width_ft: r.width };
      if (r.id) await api.put(`/rooms/${r.id}`, body);
      else await api.post(`/${plural(type)}/${doc.id}/rooms`, body);
    }
    onRoomsChanged?.();
    onClose();
  }, 'Rooms saved');

  const pattern = !product ? 'plain' : ['lvp', 'laminate', 'hardwood'].includes(product.category) ? 'plank' : product.category === 'tile' ? 'tile' : 'plain';

  return (
    <Sheet title="Measure & add" onClose={onClose} wide initialFocus={false}
      footer={(
        <>
          {!product && <Button onClick={saveRoomsOnly} busy={busy} disabled={!parsed.some((r) => r.dirty && r.length_ft > 0 && r.width_ft > 0)}>Save rooms only</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!est || !est.qty} onClick={add}>
            {est ? `Add ${count} ${count === 1 ? 'item' : 'items'}, about ${money(estTotal)}` : 'Add items'}
          </Button>
        </>
      )}>
      <section className="stack">
        <div className="spread"><h3>1. Rooms</h3><span className="small muted num">{num(areaSf, 1)} sq ft selected</span></div>
        <datalist id="calc-room-names">
          {['Living room', 'Family room', 'Dining room', 'Kitchen', 'Primary bedroom', 'Bedroom 2', 'Bedroom 3', 'Hall', 'Stairs', 'Basement', 'Office', 'Bathroom', 'Laundry', 'Entry'].map((n) => <option key={n} value={n} />)}
        </datalist>
        <div className="room-list">
          {parsed.map((r, i) => (
            <div key={r.key} className="room-row">
              <Field label="Room">
                <div className="hstack" style={{ gap: 6 }}>
                  <input type="checkbox" aria-label={`Include ${r.name || 'room'}`} checked={r.on} onChange={(e) => updateRoom(r.key, { on: e.target.checked })} style={{ width: 20, height: 20, accentColor: 'var(--brand-fill)', flex: 'none' }} />
                  <input className="input" value={r.name} placeholder="Living room" list="calc-room-names" onChange={(e) => updateRoom(r.key, { name: e.target.value })} aria-label="Room name" />
                </div>
              </Field>
              <Field label="Length" error={r.length && r.length_ft === null ? 'e.g. 14 6' : null}>
                <input className="input num" inputMode="decimal" value={r.length} placeholder="14 6" onChange={(e) => updateRoom(r.key, { length: e.target.value })} aria-label="Length in feet and inches" />
              </Field>
              <Field label="Width" error={r.width && r.width_ft === null ? 'e.g. 12' : null}>
                <input className="input num" inputMode="decimal" value={r.width} placeholder="12" onChange={(e) => updateRoom(r.key, { width: e.target.value })} aria-label="Width in feet and inches" />
              </Field>
              <IconButton icon={Trash2} label="Remove room" onClick={() => removeRoom(r)} />
            </div>
          ))}
        </div>
        <div className="hstack wrap">
          <Button size="sm" icon={Plus} onClick={() => setRooms((rs) => [...rs, { key: `n${Date.now()}`, name: '', length: '', width: '', on: true, dirty: true }])}>Add another room</Button>
          <span className="xs faint">Type feet then inches: 14 6 means 14' 6"</span>
        </div>
      </section>

      <section className="stack">
        <h3>2. Flooring</h3>
        {product ? (
          <div className="spread panel" style={{ padding: '10px 12px' }}>
            <div className="grow">
              <div className="strong">{productName(product)}</div>
              <div className="small muted">{money(product.price)} per {unitLabel(product.unit)}{isRoll ? `, ${formatFeet(product.roll_width_ft || 12)} wide rolls` : product.coverage_per_box ? `, ${num(product.coverage_per_box)} sq ft per box` : ''}</div>
            </div>
            <Button size="sm" icon={Repeat} onClick={() => setPicking(true)}>Change</Button>
          </div>
        ) : <Button variant="primary" onClick={() => setPicking(true)}>Choose the flooring</Button>}
        {product && (
          <div className="hstack wrap">
            {isRoll && <Segmented label="How to calculate" value={method} onChange={setMethod} options={[{ value: 'roll', label: 'Lay out the roll' }, { value: 'area', label: 'Area plus waste' }]} />}
            {(!isRoll || method === 'area') && (
              <div style={{ width: 150 }}><Field label="Waste"><NumberInput value={waste === '' ? String(cat?.waste ?? 10) : waste} onChange={setWaste} suffix="%" /></Field></div>
            )}
          </div>
        )}
      </section>

      {product && est && (
        <section className="stack">
          <h3>3. Result</h3>
          <div className="calc-result">
            <div className="calc-big">{num(est.qty)}<small>{unitLabel(product.unit)}</small></div>
            <div className="small muted">
              {est.layout
                ? `${formatFeet(est.layout.linearFt)} off the roll, ${est.layout.seams} ${est.layout.seams === 1 ? 'seam' : 'seams'}, ${num(est.layout.wastePct, 0)}% over the floor area`
                : est.boxes ? `${est.boxes} boxes covers ${num(est.qty)} sq ft, ${num(areaSf, 1)} sq ft of floor plus ${wastePct}% waste`
                  : `${num(areaSf, 1)} sq ft of floor plus ${wastePct}% waste`}
            </div>
            <div className="strong num">{money(est.qty * product.price)}</div>
          </div>
          <div className="diagram-wrap">
            <RoomDiagram rooms={valid} layout={est.layout} pattern={pattern} title="Rooms with the carpet layout" />
          </div>
          <DiagramLegend roll={!!est.layout} />
          {est.layout && est.layout.wastePct > 25 && (
            <Notice tone="warn">This layout leaves a lot of extra carpet. Try {product.roll_width_ft === 12 ? 'a 15-foot roll or ' : ''}area plus waste if you plan to use fill pieces.</Notice>
          )}
        </section>
      )}

      {product && est && suggestions.length > 0 && (
        <section className="stack">
          <h3>4. Add with it</h3>
          <div className="stack">
            {chosen.map(({ s, st, p, qty }) => (
              <div key={s.key} className="addon">
                <Check checked={st.on} onChange={(on) => setAddons((a) => ({ ...a, [s.key]: { ...st, on } }))}>{s.label}</Check>
                <span className="small num nowrap">{num(qty)} {p?.unit}</span>
                <div className="addon-product">
                  {s.options.length > 1 ? (
                    <Select value={st.productId} onChange={(v) => setAddons((a) => ({ ...a, [s.key]: { ...st, productId: v } }))}
                      options={s.options.map((o) => ({ value: o.id, label: `${productName(o)}, ${money(o.price)}/${o.unit}` }))} aria-label={`${s.label} product`} />
                  ) : <span className="small muted">{productName(p)}, {money(p.price)}/{p.unit}</span>}
                  {s.hint && <span className="xs faint">{s.hint}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {picking && (
        <ProductPicker title="Choose the flooring" stockedOnly onClose={() => setPicking(false)}
          onPick={(p) => { setPicking(false); setProduct(p); setWaste(''); setMethod(p.stock_type === 'roll' ? 'roll' : 'area'); setAddons({}); }} />
      )}
    </Sheet>
  );
}

