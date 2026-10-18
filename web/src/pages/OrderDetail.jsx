import { useEffect, useRef, useState } from 'react';
import {
  Check as CheckIcon, MoreHorizontal, PackageSearch, CalendarPlus, Receipt, Wallet, Printer, HardHat, Pencil, Ban, RotateCcw,
  ListChecks, Truck, Undo2, Scissors, MapPin, CheckCircle2, Trash2,
} from 'lucide-react';
import { ORDER_STAGES, ORDER_STAGE_INDEX, PAYMENT_METHODS, APPOINTMENT_TYPES, parseFeet, formatFeet, saleToStock, stockToSale } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { money, date, dateTime, dateLong, time12, num, fullAddress, mapsHref, todayStr, stockQtyLabel, unitLabel } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, IconButton, Badge, Loading, ErrorNote, Notice, Field, Input, TextArea, Select, MoneyInput, Segmented } from '../ui/kit.jsx';
import { Sheet, useAction, useFeedback } from '../ui/overlay.jsx';
import { LinesPanel, RoomsPanel, TotalsPanel, NotesPanel } from './shared.jsx';
import { AppointmentSheet } from './Schedule.jsx';
import { CompleteSheet } from './Job.jsx';
import { stageLabel } from './Orders.jsx';

const methodLabel = (m) => PAYMENT_METHODS.find((x) => x.id === m)?.label || m;
const typeLabel = (t) => APPOINTMENT_TYPES.find((x) => x.id === t)?.label || t;

export default function OrderPage({ params, query }) {
  const { data: o, error, loading, reload, setData } = useData(`/orders/${params.id}`);
  const { settings, isManager } = useSession();
  const [sheet, setSheet] = useState(null); // {kind, ...}
  const [run, busy] = useAction();
  const { confirm, toast } = useFeedback();
  const askedDeposit = useRef(false);
  const stepperRef = useRef(null);
  useEffect(() => {
    const el = stepperRef.current;
    const cur = el?.querySelector('.step-current');
    if (el && cur) el.scrollLeft = cur.offsetLeft - el.clientWidth / 2 + cur.clientWidth / 2;
  });

  useEffect(() => {
    if (o && query.deposit === '1' && !askedDeposit.current && o.paid_total === 0) {
      askedDeposit.current = true;
      setSheet({ kind: 'payment', deposit: true });
    }
  }, [o, query.deposit]);

  if (loading && !o) return <Screen title="Order" back="/orders"><Loading /></Screen>;
  if (error) return <Screen title="Order" back="/orders"><ErrorNote error={error} retry={reload} /></Screen>;

  const cancelled = o.stage === 'cancelled';
  const editable = !cancelled && !o.invoiced_at;
  const close = () => setSheet(null);
  const apply = (fresh) => { if (fresh && fresh.id === o.id && fresh.lines) setData(fresh); else reload(); };
  const needed = o.lines.filter((l) => l.material_status === 'needed');
  const ordered = o.lines.filter((l) => l.material_status === 'ordered');
  const installs = o.appointments.filter((a) => a.type === 'install' && a.status !== 'cancelled');
  const nextInstall = installs.find((a) => a.status !== 'done');
  const depositDue = Math.round(o.total * (Number(settings.deposit_percent) || 0)) / 100;

  const orderMaterial = (lineIds) => run(async () => {
    const res = await api.post(`/orders/${o.id}/order-material`, { line_ids: lineIds });
    apply(res.order);
    if (res.missing_vendor.length) toast(`Set a vendor on: ${res.missing_vendor.join(', ')}`, { tone: 'error' });
    else toast(`Added to ${res.po_ids.length} purchase ${res.po_ids.length === 1 ? 'order' : 'orders'}`);
  });
  const invoice = () => run(async () => { apply(await api.post(`/orders/${o.id}/invoice`, {})); }, 'Invoice created');

  let next;
  if (cancelled) {
    next = { label: 'Cancelled', title: 'This order was cancelled', actions: [] };
  } else if (o.stage === 'paid') {
    next = { label: 'Complete', title: 'Paid in full', actions: [{ label: __DEMO__ ? 'View invoice' : 'Print invoice', icon: Printer, onClick: () => navigate(`/print/invoice/${o.id}`) }] };
  } else if (o.invoiced_at) {
    next = { label: 'Next step', title: `Collect ${money(o.balance)}`, actions: [
      { label: 'Take payment', icon: Wallet, primary: true, onClick: () => setSheet({ kind: 'payment' }) },
      { label: __DEMO__ ? 'View invoice' : 'Print invoice', icon: Printer, onClick: () => navigate(`/print/invoice/${o.id}`) },
    ] };
  } else if (o.stage === 'installed') {
    next = { label: 'Next step', title: 'Installed. Send the invoice.', actions: [{ label: 'Create invoice', icon: Receipt, primary: true, onClick: invoice }] };
  } else if (nextInstall) {
    next = { label: 'Next step', title: `Install ${dateLong(nextInstall.date)}${nextInstall.installer_name ? ` with ${nextInstall.installer_name}` : ''}`, actions: [
      { label: 'Mark install complete', icon: CheckCircle2, primary: true, onClick: () => setSheet({ kind: 'complete', appt: nextInstall }) },
      { label: 'Work order', icon: HardHat, onClick: () => navigate(`/jobs/${o.id}`) },
    ] };
  } else if (needed.length) {
    next = { label: 'Next step', title: `Get material for ${needed.length} ${needed.length === 1 ? 'item' : 'items'}`, text: 'Order from the vendor, or pull it from stock on each item below.', actions: [
      { label: 'Order material', icon: Truck, primary: true, onClick: () => orderMaterial(needed.map((l) => l.id)) },
    ] };
  } else if (ordered.length) {
    const pos = o.pos.filter((p) => ['draft', 'sent', 'partial'].includes(p.status));
    next = { label: 'Waiting on material', title: pos.map((p) => `${p.number} from ${p.vendor_name}${p.status === 'draft' ? ' (not sent yet)' : p.expected_date ? `, due ${date(p.expected_date)}` : ''}`).join('; ') || 'On order',
      actions: [
        ...pos.slice(0, 2).map((p) => ({ label: p.status === 'draft' ? `Send ${p.number}` : `Receive ${p.number}`, icon: Truck, primary: true, onClick: () => navigate(`/purchasing/${p.id}`) })),
        { label: 'Schedule anyway', icon: CalendarPlus, onClick: () => setSheet({ kind: 'appt' }) },
      ] };
  } else {
    next = { label: 'Next step', title: 'Schedule the install', actions: [{ label: 'Schedule install', icon: CalendarPlus, primary: true, onClick: () => setSheet({ kind: 'appt' }) }] };
  }
  if (!cancelled && !o.invoiced_at && o.paid_total === 0 && o.total > 0 && depositDue > 0) {
    next.actions.push({ label: `Take ${money(depositDue)} deposit`, icon: Wallet, onClick: () => setSheet({ kind: 'payment', deposit: true }) });
  }

  const renderMaterial = (l) => (
    <MaterialRow line={l} editable={editable} busy={busy}
      onOrder={() => orderMaterial([l.id])}
      onPull={() => setSheet({ kind: 'pull', line: l })}
      onReturn={async (a) => {
        if (!(await confirm({ title: 'Return this to stock?', message: `${a.tag || 'Material'} goes back on the shelf and this item needs material again.`, confirmLabel: 'Return to stock' }))) return;
        run(async () => apply(await api.post(`/inventory-tx/${a.id}/return`, {})), 'Returned to stock');
      }}
      onCustomerSupplied={() => run(async () => apply(await api.post(`/lines/${l.id}/material-status`, { status: 'none' })), 'Marked as not needing material')} />
  );

  const stageIdx = ORDER_STAGE_INDEX[o.stage] ?? -1;
  return (
    <Screen title={o.number} back="/orders" actions={<IconButton icon={MoreHorizontal} label="More actions" onClick={() => setSheet({ kind: 'menu' })} />}>
      <div className="page-head">
        <div className="grow">
          <h1>{o.title || o.customer?.display_name}</h1>
          <div className="page-sub">
            <Badge status={o.stage}>{stageLabel(o.stage)}</Badge>{' '}
            <Link to={`/customers/${o.customer_id}`} className="link-btn">{o.customer?.display_name}</Link>
            {`, ${o.number}, ordered ${date(o.order_date)}`}
            {o.quote && <>{', from '}<Link to={`/quotes/${o.quote.id}`} className="link-btn">{o.quote.number}</Link></>}
            {o.customer_po ? `, customer PO ${o.customer_po}` : ''}
          </div>
        </div>
      </div>

      {!cancelled && (
        <ol className="stepper" aria-label="Order progress" ref={stepperRef}>
          {ORDER_STAGES.map((s, i) => (
            <li key={s.id} className={`step ${i < stageIdx ? 'step-done' : i === stageIdx ? 'step-current' : ''}`} aria-current={i === stageIdx ? 'step' : undefined}>
              <span className="step-dot">{i < stageIdx && <CheckIcon aria-hidden="true" strokeWidth={3} />}</span>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      <div className="next">
        <span className="next-label">{next.label}</span>
        <span className="next-title">{next.title}</span>
        {next.text && <p className="small muted">{next.text}</p>}
        {next.actions.length > 0 && (
          <div className="page-actions">
            {next.actions.map((a) => <Button key={a.label} variant={a.primary ? 'primary' : 'secondary'} icon={a.icon} busy={busy && a.primary} onClick={a.onClick}>{a.label}</Button>)}
          </div>
        )}
      </div>

      {o.invoiced_at && <Notice>Invoice {o.invoice_number} dated {date(o.invoiced_at)}{o.due_date ? `, due ${date(o.due_date)}` : ''}. Items are locked.{isManager ? ' Reopen it from the menu to make changes.' : ''}</Notice>}

      <div className="cols">
        <div className="stack-lg">
          <LinesPanel doc={o} type="order" editable={editable} onChange={reload} renderMaterial={renderMaterial} />
          <RoomsPanel doc={o} type="order" editable={editable} onChange={reload} />
          <SchedulePanel o={o} onAdd={() => setSheet({ kind: 'appt' })} onOpen={(a) => setSheet({ kind: 'appt', appt: a })} />
        </div>
        <div className="stack-lg">
          <TotalsPanel doc={o} type="order" editable={editable} onChange={reload} />
          <PaymentsPanel o={o} canDelete={isManager} onAdd={() => setSheet({ kind: 'payment' })} onChange={apply} />
          <Panel title="Job details" action={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setSheet({ kind: 'details' })}>Edit</Button>}>
            <div className="panel-body">
              <dl className="kv">
                <dt>Job site</dt><dd>{fullAddress(o, 'job_') || 'No address'}{fullAddress(o, 'job_') && <> <a className="link-btn small" href={mapsHref(fullAddress(o, 'job_'))} target="_blank" rel="noreferrer"><MapPin size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> Map</a></>}</dd>
                <dt>Phone</dt><dd className="num">{o.customer?.phone || 'None on file'}</dd>
                <dt>Salesperson</dt><dd>{o.sales_rep_name || 'Unassigned'}</dd>
                {o.customer_po && <><dt>Customer PO</dt><dd>{o.customer_po}</dd></>}
              </dl>
              {o.install_notes && <div><div className="field-label">For the installers</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{o.install_notes}</div></div>}
              {o.notes && <div><div className="field-label">Notes on the invoice</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{o.notes}</div></div>}
              {o.internal_notes && <div><div className="field-label">Internal notes</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{o.internal_notes}</div></div>}
            </div>
          </Panel>
          {o.pos.length > 0 && (
            <Panel title="Purchase orders">
              <div className="rows">
                {o.pos.map((p) => (
                  <Link key={p.id} to={`/purchasing/${p.id}`} className="row">
                    <div className="row-main"><span className="row-title">{p.number} {p.vendor_name}</span><span className="row-sub">{p.expected_date ? `Expected ${date(p.expected_date)}` : 'No date yet'}</span></div>
                    <Badge status={p.status}>{p.status === 'draft' ? 'Not sent' : p.status === 'sent' ? 'Sent' : p.status === 'partial' ? 'Partly in' : p.status === 'received' ? 'Received' : 'Cancelled'}</Badge>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          <NotesPanel entityType="order" entityId={o.id} notes={o.note_items} onChange={reload} />
          {o.activity.length > 0 && (
            <Panel title="History">
              <div className="rows">
                {o.activity.slice(0, 12).map((a) => (
                  <div key={a.id} className="note">
                    <span className="small">{activityText(a)}</span>
                    <span className="note-meta">{a.user_name || 'System'}, {dateTime(a.created_at)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {sheet?.kind === 'menu' && (
        <Sheet title={o.number} onClose={close}>
          <div className="menu">
            <button type="button" className="menu-item" onClick={() => { close(); navigate(`/print/invoice/${o.id}`); }}><Printer aria-hidden="true" />{o.invoiced_at ? 'Invoice' : 'Order confirmation'}{__DEMO__ ? '' : ': print or PDF'}</button>
            <button type="button" className="menu-item" onClick={() => { close(); navigate(`/jobs/${o.id}`); }}><HardHat aria-hidden="true" />Installer work order</button>
            {!__DEMO__ && <button type="button" className="menu-item" onClick={() => { close(); navigate(`/print/workorder/${o.id}`); }}><Printer aria-hidden="true" />Print work order</button>}
            <button type="button" className="menu-item" onClick={() => setSheet({ kind: 'details' })}><Pencil aria-hidden="true" />Edit job details</button>
            {!cancelled && !o.invoiced_at && <button type="button" className="menu-item" onClick={() => setSheet({ kind: 'stage' })}><ListChecks aria-hidden="true" />Change stage</button>}
            {!cancelled && !o.invoiced_at && o.lines.length > 0 && <button type="button" className="menu-item" onClick={() => { close(); invoice(); }}><Receipt aria-hidden="true" />Create invoice now</button>}
            {o.invoiced_at && isManager && <button type="button" className="menu-item" onClick={() => { close(); run(async () => apply(await api.post(`/orders/${o.id}/reopen`, {})), 'Invoice reopened'); }}><RotateCcw aria-hidden="true" />Reopen invoice</button>}
            {!cancelled && !o.invoiced_at && <button type="button" className="menu-item danger" onClick={() => setSheet({ kind: 'cancel' })}><Ban aria-hidden="true" />Cancel order</button>}
            {cancelled && <button type="button" className="menu-item" onClick={() => { close(); run(async () => apply(await api.post(`/orders/${o.id}/stage`, { stage: 'new' })), 'Order restored'); }}><RotateCcw aria-hidden="true" />Restore order</button>}
          </div>
        </Sheet>
      )}
      {sheet?.kind === 'payment' && <PaymentSheet o={o} deposit={sheet.deposit ? depositDue : null} onClose={close} onSaved={(fresh) => { close(); apply(fresh); }} />}
      {sheet?.kind === 'pull' && <PullSheet line={sheet.line} onClose={close} onSaved={(fresh) => { close(); apply(fresh); }} />}
      {sheet?.kind === 'appt' && (
        <AppointmentSheet appt={sheet.appt} initial={{ type: 'install', order_id: o.id, customer_id: o.customer_id, customer_name: o.customer?.display_name, order_number: o.number }}
          onClose={close} onSaved={() => { close(); reload(); }} />
      )}
      {sheet?.kind === 'complete' && <CompleteSheet appt={sheet.appt} onClose={close} onDone={() => { close(); reload(); }} />}
      {sheet?.kind === 'details' && <OrderDetailsSheet o={o} onClose={close} onSaved={(fresh) => { close(); apply(fresh); }} />}
      {sheet?.kind === 'stage' && (
        <Sheet title="Change stage" onClose={close}>
          <p className="small muted">The stage moves on its own as you order, receive, schedule and invoice. Change it here if something happened outside the app.</p>
          <div className="menu">
            {ORDER_STAGES.filter((s) => !['invoiced', 'paid'].includes(s.id)).map((s) => (
              <button key={s.id} type="button" className="menu-item" onClick={() => run(async () => { apply(await api.post(`/orders/${o.id}/stage`, { stage: s.id })); close(); }, `Moved to ${s.label.toLowerCase()}`)}>
                {o.stage === s.id ? <CheckIcon aria-hidden="true" /> : <span style={{ width: 20 }} />}
                <span className="grow"><span className="strong">{s.label}</span><span className="row-sub" style={{ display: 'block' }}>{s.hint}</span></span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet?.kind === 'cancel' && <CancelSheet o={o} onClose={close} onSaved={(fresh) => { close(); apply(fresh); }} />}
    </Screen>
  );
}

function activityText(a) {
  const d = a.detail || '';
  const moneyDetail = () => { const [amt, method] = d.split(' '); return `${money(Math.abs(Number(amt)))} by ${methodLabel(method).toLowerCase()}`; };
  switch (a.action) {
    case 'stage': return `Moved to ${stageLabel(d).toLowerCase()}`;
    case 'payment': return `Payment of ${moneyDetail()}`;
    case 'refund': return `Refund of ${moneyDetail()}`;
    case 'payment deleted': return `Deleted a payment of ${moneyDetail()}`;
    case 'scheduled': return `Scheduled ${d.replace(/(\d{4}-\d{2}-\d{2})/, (m) => date(m))}`;
    case 'created': return d ? `Order created ${d.charAt(0).toLowerCase()}${d.slice(1)}` : 'Order created';
    case 'install completed': return d ? `Install completed: ${d}` : 'Install completed';
    case 'material ordered': return `Material ordered on ${d.replace('purchase order(s)', d.startsWith('1 ') ? 'purchase order' : 'purchase orders')}`;
    case 'cancelled': return d ? `Cancelled: ${d}` : 'Cancelled';
    case 'invoiced': return 'Invoice created';
    case 'reopened': return 'Invoice reopened';
    default: return d ? `${a.action}: ${d}` : a.action;
  }
}

function MaterialRow({ line: l, editable, busy, onOrder, onPull, onReturn, onCustomerSupplied }) {
  const live = l.allocations;
  const short = l.material_status === 'received' && l.allocated_qty > 0 && l.allocated_qty < l.qty * 0.97 - 0.01;
  return (
    <div className="line-actions">
      {l.material_status === 'needed' && editable && (
        <>
          <Button size="sm" icon={Truck} busy={busy} onClick={onOrder}>Order it</Button>
          <Button size="sm" icon={PackageSearch} onClick={onPull}>Pull from stock</Button>
          <Button size="sm" variant="ghost" onClick={onCustomerSupplied}>Customer supplies it</Button>
        </>
      )}
      {l.material_status === 'ordered' && (
        <>
          {l.po_lines.map((p) => <Link key={p.id} to={`/purchasing/${p.po_id}`} className="link-btn small">{p.po_number}{p.expected_date ? `, due ${date(p.expected_date)}` : ''}</Link>)}
          {editable && <Button size="sm" variant="ghost" icon={PackageSearch} onClick={onPull}>Pull from stock instead</Button>}
        </>
      )}
      {live.map((a) => (
        <span key={a.id} className="hstack small" style={{ gap: 6 }}>
          <Scissors size={14} aria-hidden="true" className="faint" />
          <span>{[a.tag, a.dye_lot && `lot ${a.dye_lot}`, a.location].filter(Boolean).join(', ')}: {a.kind === 'roll' ? formatFeet(Math.abs(a.qty)) : `${num(Math.abs(a.qty))} ${a.kind === 'box' ? 'boxes' : unitLabel(l.unit)}`}</span>
          {editable && <button type="button" className="link-btn xs" onClick={() => onReturn(a)}><Undo2 size={12} aria-hidden="true" /> Return</button>}
        </span>
      ))}
      {short && editable && <Button size="sm" variant="ghost" onClick={onPull}>Short {num(l.qty - l.allocated_qty)} {l.unit}: pull more</Button>}
    </div>
  );
}

function SchedulePanel({ o, onAdd, onOpen }) {
  return (
    <Panel title="Schedule" action={o.stage !== 'cancelled' && <Button size="sm" variant="ghost" icon={CalendarPlus} onClick={onAdd}>Add</Button>}>
      <div className="rows">
        {o.appointments.map((a) => (
          <button key={a.id} type="button" className="row" onClick={() => onOpen(a)}>
            <span className="row-lead" style={{ background: a.installer_color || 'var(--line-strong)' }} />
            <div className="row-main">
              <span className="row-title">{typeLabel(a.type)} {dateLong(a.date)}{a.end_date ? ` to ${date(a.end_date)}` : ''}</span>
              <span className="row-sub">{[a.start_time && time12(a.start_time), a.installer_name || 'No crew assigned'].filter(Boolean).join(', ')}</span>
            </div>
            <Badge status={a.status}>{a.status === 'done' ? 'Done' : a.status === 'cancelled' ? 'Cancelled' : a.status === 'in_progress' ? 'Started' : 'Scheduled'}</Badge>
          </button>
        ))}
        {!o.appointments.length && <div className="list-empty">Nothing scheduled yet.</div>}
      </div>
    </Panel>
  );
}

function PaymentsPanel({ o, canDelete, onAdd, onChange }) {
  const [run] = useAction();
  const { confirm } = useFeedback();
  const remove = async (p) => {
    if (!(await confirm({ title: `Delete this ${money(p.amount)} payment?`, message: 'Use this only to fix a mistake. For money given back, record a refund instead.', confirmLabel: 'Delete payment' }))) return;
    run(async () => onChange(await api.del(`/payments/${p.id}`)), 'Payment deleted');
  };
  return (
    <Panel title="Payments" action={o.stage !== 'cancelled' && <Button size="sm" variant="ghost" icon={Wallet} onClick={onAdd}>Take payment</Button>}>
      <div className="rows">
        {o.payments.map((p) => (
          <div key={p.id} className="row">
            <div className="row-main">
              <span className="row-title">{money(p.amount)} {methodLabel(p.method).toLowerCase()}{p.amount < 0 ? ' refund' : ''}</span>
              <span className="row-sub">{date(p.date)}{p.reference ? `, #${p.reference}` : ''}{p.user_name ? `, ${p.user_name}` : ''}{p.note ? `, ${p.note}` : ''}</span>
            </div>
            {canDelete && <IconButton icon={Trash2} label="Delete payment" onClick={() => remove(p)} />}
          </div>
        ))}
        {!o.payments.length && <div className="list-empty">No payments yet.</div>}
      </div>
    </Panel>
  );
}

function PaymentSheet({ o, deposit, onClose, onSaved }) {
  const { isManager } = useSession();
  const balance = Math.round((o.total - o.paid_total) * 100) / 100;
  const [kind, setKind] = useState('payment');
  const [f, setF] = useState({ amount: String(deposit || balance || ''), method: 'card', reference: '', date: todayStr(), note: deposit ? 'Deposit' : '' });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [run, busy] = useAction();
  const amount = Number(String(f.amount).replace(/[$,]/g, '')) || 0;
  const save = () => run(async () => {
    const fresh = await api.post(`/orders/${o.id}/payments`, { ...f, amount: kind === 'refund' ? -Math.abs(amount) : amount });
    onSaved(fresh);
  }, kind === 'refund' ? 'Refund recorded' : 'Payment recorded');
  return (
    <Sheet title={kind === 'refund' ? 'Record a refund' : deposit ? 'Take the deposit' : 'Take a payment'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!amount} onClick={save}>{kind === 'refund' ? `Record ${money(amount)} refund` : `Record ${money(amount)}`}</Button></>}>
      <div className="calc-result">
        <div className="spread"><span className="muted">Order total</span><span className="num">{money(o.total)}</span></div>
        <div className="spread"><span className="muted">Paid so far</span><span className="num">{money(o.paid_total)}</span></div>
        <div className="spread strong"><span>Balance</span><span className="num">{money(balance)}</span></div>
      </div>
      {isManager && o.paid_total > 0 && <Segmented label="Payment or refund" value={kind} onChange={setKind} options={[{ value: 'payment', label: 'Payment' }, { value: 'refund', label: 'Refund' }]} />}
      <Field label="Amount"><MoneyInput value={f.amount} onChange={set('amount')} data-autofocus /></Field>
      <div className="hstack wrap">
        {deposit > 0 && <Button size="sm" onClick={() => set('amount')(String(deposit))}>Deposit {money(deposit)}</Button>}
        {balance > 0 && <Button size="sm" onClick={() => set('amount')(String(balance))}>Full balance {money(balance)}</Button>}
      </div>
      <Field label="How they paid">
        <Segmented label="Method" value={f.method} onChange={set('method')} options={PAYMENT_METHODS.map((m) => ({ value: m.id, label: m.label }))} />
      </Field>
      <div className="form-grid">
        <Field label={f.method === 'check' ? 'Check number' : f.method === 'card' ? 'Last 4 or approval code' : 'Reference'}><Input value={f.reference} onChange={set('reference')} /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={set('date')} /></Field>
      </div>
      <Field label="Note"><Input value={f.note} onChange={set('note')} /></Field>
      <p className="xs faint">This records the payment. Run the card on your terminal as usual.</p>
    </Sheet>
  );
}

function PullSheet({ line, onClose, onSaved }) {
  const stock = useData('/inventory', { product_id: line.product_id });
  const [item, setItem] = useState(null);
  const [qty, setQty] = useState('');
  const [run, busy] = useAction();
  const allocatedStock = line.allocations.reduce((s, a) => s + Math.abs(a.qty), 0);
  const choose = (it) => {
    setItem(it);
    const width = it.width_ft || line.roll_width_ft;
    const need = Math.max(0, saleToStock(line, line.qty, width) - allocatedStock);
    if (it.kind === 'roll') setQty(formatFeet(Math.min(need || it.qty, it.qty)).replace('"', ''));
    else setQty(String(Math.min(Math.ceil(need) || 1, it.qty)));
  };
  const parsed = item?.kind === 'roll' ? parseFeet(qty) : Number(qty);
  const lots = new Set(line.allocations.filter((a) => a.dye_lot).map((a) => a.dye_lot));
  const save = () => run(async () => onSaved(await api.post(`/lines/${line.id}/allocate`, { inventory_id: item.id, qty })),
    item?.kind === 'roll' ? 'Cut recorded' : 'Pulled from stock');
  return (
    <Sheet title={item ? (item.kind === 'roll' ? 'Cut from this roll' : 'Pull from stock') : 'Pick stock'} onClose={onClose}
      footer={item && <><Button onClick={() => setItem(null)}>Pick different stock</Button><Button variant="primary" busy={busy} disabled={!parsed || parsed <= 0} onClick={save}>{item.kind === 'roll' ? `Cut ${parsed ? formatFeet(parsed) : ''}` : `Pull ${qty || ''}`}</Button></>}>
      <div className="small muted">{line.description}: {num(line.qty)} {line.unit} needed{line.allocated_qty > 0 ? `, ${num(line.allocated_qty)} already pulled` : ''}</div>
      {!item && (
        stock.loading && !stock.data ? <Loading /> : (
          <div className="panel rows">
            {(stock.data || []).map((it) => (
              <button key={it.id} type="button" className="row" onClick={() => choose(it)}>
                <div className="row-main">
                  <span className="row-title">{stockQtyLabel(it)}{it.is_remnant ? ' remnant' : ''}</span>
                  <span className="row-sub">{[it.tag, it.dye_lot && `dye lot ${it.dye_lot}`, it.location].filter(Boolean).join(', ') || 'No tag'}</span>
                </div>
                <div className="row-meta">
                  <span className="small num">{num(it.sale_qty)} {it.unit}</span>
                  {lots.size > 0 && it.dye_lot && !lots.has(it.dye_lot) && <Badge tone="warn">Different dye lot</Badge>}
                </div>
              </button>
            ))}
            {stock.data && !stock.data.length && <div className="list-empty">None of this product is in stock. Order it instead.</div>}
          </div>
        )
      )}
      {item && (
        <>
          <div className="calc-result">
            <span className="strong">{[item.tag, item.dye_lot && `dye lot ${item.dye_lot}`].filter(Boolean).join(', ') || 'Untagged stock'}</span>
            <span className="small muted">{stockQtyLabel(item)} on hand{item.location ? ` in ${item.location}` : ''}</span>
          </div>
          <Field label={item.kind === 'roll' ? 'Cut length' : `How many ${item.kind === 'box' ? 'boxes' : item.unit}`}
            hint={item.kind === 'roll' && parsed ? `${formatFeet(item.width_ft || 12)} × ${formatFeet(parsed)} = ${num(stockToSale(line, parsed, item.width_ft))} ${line.unit}; ${formatFeet(Math.max(0, item.qty - parsed))} left on the roll` : null}>
            <Input value={qty} onChange={setQty} inputMode="decimal" data-autofocus />
          </Field>
        </>
      )}
    </Sheet>
  );
}

function OrderDetailsSheet({ o, onClose, onSaved }) {
  const [f, setF] = useState({
    title: o.title || '', job_address: o.job_address || '', job_city: o.job_city || '', job_state: o.job_state || '', job_zip: o.job_zip || '',
    customer_po: o.customer_po || '', sales_rep_id: o.sales_rep_id || '', install_notes: o.install_notes || '', notes: o.notes || '', internal_notes: o.internal_notes || '',
  });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const users = useData('/users');
  const [run, busy] = useAction();
  return (
    <Sheet title="Job details" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => run(async () => onSaved(await api.put(`/orders/${o.id}`, { ...f, sales_rep_id: f.sales_rep_id || null })), 'Order saved')}>Save</Button></>}>
      <Field label="Job name"><Input value={f.title} onChange={set('title')} /></Field>
      <Field label="Job site address"><Input value={f.job_address} onChange={set('job_address')} /></Field>
      <div className="form-grid">
        <Field label="City"><Input value={f.job_city} onChange={set('job_city')} /></Field>
        <Field label="State"><Input value={f.job_state} onChange={set('job_state')} /></Field>
        <Field label="ZIP"><Input value={f.job_zip} onChange={set('job_zip')} inputMode="numeric" /></Field>
      </div>
      <div className="form-grid">
        <Field label="Customer PO number"><Input value={f.customer_po} onChange={set('customer_po')} /></Field>
        <Field label="Salesperson"><Select value={f.sales_rep_id} onChange={set('sales_rep_id')} placeholder="Unassigned" options={(users.data || []).filter((u) => u.role !== 'installer').map((u) => ({ value: u.id, label: u.name }))} /></Field>
      </div>
      <Field label="For the installers" hint="Shows on the work order: parking, pets, lockbox, special instructions"><TextArea value={f.install_notes} onChange={set('install_notes')} /></Field>
      <Field label="Notes on the invoice" hint="The customer sees these"><TextArea value={f.notes} onChange={set('notes')} /></Field>
      <Field label="Internal notes" hint="Staff only"><TextArea value={f.internal_notes} onChange={set('internal_notes')} /></Field>
    </Sheet>
  );
}

function CancelSheet({ o, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  return (
    <Sheet title={`Cancel ${o.number}?`} onClose={onClose}
      footer={<><Button onClick={onClose}>Keep the order</Button><Button variant="primary" busy={busy} onClick={() => run(async () => onSaved(await api.post(`/orders/${o.id}/cancel`, { reason })), 'Order cancelled')}>Cancel order</Button></>}>
      <p className="muted">Scheduled appointments are cancelled too. Payments must be refunded first, and pulled material returned to stock.</p>
      <Field label="Reason"><Input value={reason} onChange={setReason} placeholder="Customer changed their mind" /></Field>
    </Sheet>
  );
}
