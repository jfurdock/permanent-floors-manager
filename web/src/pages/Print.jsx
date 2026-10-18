import { Printer, Mail } from 'lucide-react';
import { roomArea, formatFeet, PAYMENT_METHODS } from '@core/calc.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { money, num, date, dateLong, time12, fullAddress, unitLabel } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Button, Loading, ErrorNote, Notice } from '../ui/kit.jsx';
import RoomDiagram from '../ui/RoomDiagram.jsx';

const SOURCES = { quote: (id) => `/quotes/${id}`, invoice: (id) => `/orders/${id}`, workorder: (id) => `/orders/${id}/workorder`, po: (id) => `/pos/${id}` };
const BACK = { quote: (id) => `/quotes/${id}`, invoice: (id) => `/orders/${id}`, workorder: (id) => `/orders/${id}`, po: (id) => `/purchasing/${id}` };

export default function PrintPage({ params }) {
  const { kind, id } = params;
  const { settings } = useSession();
  const { data, error, loading, reload } = useData(SOURCES[kind] ? SOURCES[kind](id) : null);
  const title = { quote: 'Quote', invoice: 'Invoice', workorder: 'Work order', po: 'Purchase order' }[kind] || 'Document';
  const back = BACK[kind] ? BACK[kind](id) : '/';
  if (!SOURCES[kind]) return <Screen title="Document" back="/"><ErrorNote error={new Error('Unknown document type.')} /></Screen>;
  if (loading && !data) return <Screen title={title} back={back}><Loading /></Screen>;
  if (error) return <Screen title={title} back={back}><ErrorNote error={error} retry={reload} /></Screen>;
  const email = kind === 'quote' || kind === 'invoice' ? data.customer?.email : kind === 'po' ? data.vendor?.email : null;
  const docTitle = kind === 'invoice' && !data.invoiced_at ? 'Order confirmation' : title;
  const number = kind === 'invoice' ? (data.invoice_number || data.number) : data.number;
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent(`${docTitle} ${number} from ${settings.store_name}`)}&body=${encodeURIComponent(summary(kind, data, settings))}` : null;
  return (
    <Screen title={`${docTitle} ${number}`} back={back}
      actions={!__DEMO__ && <Button size="sm" variant="primary" icon={Printer} onClick={() => window.print()}>Print</Button>}>
      <div className="doc-tools no-print">
        {__DEMO__
          ? <Notice>This is the customer copy. In the installed app, Print saves it as a PDF to email or text.</Notice>
          : <span className="small muted">Use Print, then “Save as PDF” to email or text it.</span>}
        {mailto && <a className="btn btn-sm" href={mailto}><Mail aria-hidden="true" />Email a summary</a>}
      </div>
      <div className="doc-page" style={{ padding: 0 }}>
        <article className="doc">
          <DocHead settings={settings} title={docTitle} number={number} data={data} kind={kind} />
          {kind === 'quote' && <QuoteBody q={data} settings={settings} />}
          {kind === 'invoice' && <InvoiceBody o={data} settings={settings} />}
          {kind === 'workorder' && <WorkOrderBody w={data} />}
          {kind === 'po' && <PoBody po={data} settings={settings} />}
        </article>
      </div>
    </Screen>
  );
}

function DocHead({ settings, title, number, data, kind }) {
  const storeAddr = [settings.store_address, [settings.store_city, [settings.store_state, settings.store_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean);
  const dateLabel = kind === 'quote' ? date(data.quote_date, { year: true }) : kind === 'invoice' ? date(data.invoiced_at || data.order_date, { year: true }) : kind === 'po' ? date(data.created_at, { year: true }) : null;
  return (
    <header className="doc-head">
      <div className="doc-store">
        <b>{settings.store_name}</b>
        {storeAddr.map((l) => <div key={l} className="doc-muted">{l}</div>)}
        <div className="doc-muted">{[settings.store_phone, settings.store_email].filter(Boolean).join('  ')}</div>
        {settings.store_website && <div className="doc-muted">{settings.store_website}</div>}
      </div>
      <div className="doc-meta">
        <h1>{title}</h1>
        <div className="strong">{number}</div>
        {dateLabel && <div className="doc-muted">{dateLabel}</div>}
        {kind === 'quote' && data.valid_until && <div className="doc-muted">Good until {date(data.valid_until, { year: true })}</div>}
        {kind === 'invoice' && data.due_date && <div className="doc-muted">Due {date(data.due_date, { year: true })}</div>}
      </div>
    </header>
  );
}

function Parties({ customer, job, title, extra }) {
  return (
    <section className="doc-parties">
      <div>
        <h3>Customer</h3>
        <div className="strong">{customer?.display_name}</div>
        <div>{fullAddress(customer)}</div>
        <div className="doc-muted">{[customer?.phone, customer?.email].filter(Boolean).join('  ')}</div>
      </div>
      <div>
        <h3>Job site</h3>
        {title && <div className="strong">{title}</div>}
        <div>{job || 'Same as customer address'}</div>
        {extra}
      </div>
    </section>
  );
}

function LinesTable({ lines, prices = true }) {
  return (
    <div className="doc-wrap-x">
      <table className="doc-table">
        <thead><tr><th>Description</th><th className="r">Quantity</th>{prices && <><th className="r">Price</th><th className="r">Amount</th></>}</tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}{(l.area || l.notes) && <div className="sub">{[l.area, l.notes].filter(Boolean).join('. ')}</div>}</td>
              <td className="r">{num(l.qty)} {unitLabel(l.unit)}</td>
              {prices && <><td className="r">{money(l.price)}</td><td className="r">{money(l.total)}</td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ d, paid }) {
  return (
    <div className="doc-totals">
      <div className="spread"><span>Subtotal</span><span>{money(d.subtotal)}</span></div>
      {d.discount > 0 && <div className="spread"><span>Discount</span><span>−{money(d.discount)}</span></div>}
      <div className="spread"><span>Sales tax ({num(d.tax_rate, 3)}%)</span><span>{money(d.tax)}</span></div>
      <div className="spread grand"><span>Total</span><span>{money(d.total)}</span></div>
      {paid && <div className="spread"><span>Paid</span><span>{money(d.paid_total)}</span></div>}
      {paid && <div className="spread strong"><span>Balance due</span><span>{money(d.total - d.paid_total)}</span></div>}
    </div>
  );
}

function Rooms({ rooms }) {
  if (!rooms?.length) return null;
  return (
    <section className="stack">
      <h3 style={{ fontSize: 15 }}>Rooms measured</h3>
      <div className="doc-rooms">
        {rooms.map((r) => <span key={r.id}>{r.name}: {formatFeet(r.length_ft)} × {formatFeet(r.width_ft)} ({num(roomArea(r), 1)} sq ft)</span>)}
      </div>
    </section>
  );
}

function QuoteBody({ q, settings }) {
  return (
    <>
      <Parties customer={q.customer} job={fullAddress(q, 'job_')} title={q.title} extra={q.sales_rep_name && <div className="doc-muted">Your salesperson: {q.sales_rep_name}</div>} />
      <LinesTable lines={q.lines} />
      <Totals d={q} />
      {Number(settings.deposit_percent) > 0 && <div className="doc-muted">Deposit due to order: {money(Math.round(q.total * Number(settings.deposit_percent)) / 100)} ({settings.deposit_percent}%)</div>}
      <Rooms rooms={q.rooms} />
      {q.notes && <div style={{ whiteSpace: 'pre-wrap' }}>{q.notes}</div>}
      {settings.quote_terms && <div className="doc-terms">{settings.quote_terms}</div>}
      <section className="doc-sign">
        <div>
          {q.signature ? <img src={q.signature} alt="Customer signature" /> : <div style={{ height: 48 }} />}
          <span className="sign-line">Customer signature{q.signed_name ? `: ${q.signed_name}` : ''}</span>
        </div>
        <div>
          <div style={{ height: 48, display: 'flex', alignItems: 'flex-end' }}>{q.signed_at ? date(q.signed_at, { year: true }) : ''}</div>
          <span className="sign-line">Date</span>
        </div>
      </section>
    </>
  );
}

function InvoiceBody({ o, settings }) {
  return (
    <>
      <Parties customer={o.customer} job={fullAddress(o, 'job_')} title={o.title} extra={o.customer_po && <div className="doc-muted">Your PO: {o.customer_po}</div>} />
      <LinesTable lines={o.lines} />
      <Totals d={o} paid />
      {o.payments.length > 0 && (
        <section className="stack">
          <h3 style={{ fontSize: 15 }}>Payments received</h3>
          <div className="doc-wrap-x">
            <table className="doc-table">
              <tbody>{o.payments.map((p) => <tr key={p.id}><td>{date(p.date, { year: true })}</td><td>{PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method}{p.reference ? ` #${p.reference}` : ''}</td><td className="r">{money(p.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      {o.notes && <div style={{ whiteSpace: 'pre-wrap' }}>{o.notes}</div>}
      {settings.invoice_terms && <div className="doc-terms">{settings.invoice_terms}</div>}
    </>
  );
}

function WorkOrderBody({ w }) {
  const address = fullAddress(w, 'job_');
  return (
    <>
      <section className="doc-parties">
        <div><h3>Customer</h3><div className="strong">{w.customer?.display_name}</div><div>{[w.customer?.phone, w.customer?.phone2].filter(Boolean).join('  ')}</div></div>
        <div><h3>Job site</h3><div className="strong">{w.title}</div><div>{address}</div></div>
        <div><h3>Scheduled</h3>{w.appointments.map((a) => <div key={a.id}>{dateLong(a.date)}{a.start_time ? `, ${time12(a.start_time)}` : ''}{a.installer_name ? `, ${a.installer_name}` : ''}</div>)}{!w.appointments.length && <div>Not scheduled</div>}</div>
      </section>
      {(w.install_notes || w.notes) && <div style={{ whiteSpace: 'pre-wrap' }}><span className="strong">Notes: </span>{[w.install_notes, w.notes].filter(Boolean).join('\n')}</div>}
      <div className="doc-wrap-x">
        <table className="doc-table">
          <thead><tr><th>Item</th><th className="r">Quantity</th><th>Material</th></tr></thead>
          <tbody>
            {w.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}{(l.area || l.notes) && <div className="sub">{[l.area, l.notes].filter(Boolean).join('. ')}</div>}</td>
                <td className="r">{num(l.qty)} {unitLabel(l.unit)}</td>
                <td className="sub">{(l.allocations || []).map((a) => [a.tag, a.dye_lot && `lot ${a.dye_lot}`, a.location].filter(Boolean).join(', ')).join('; ') || (l.material_status === 'none' ? '' : l.material_status === 'received' ? 'In warehouse' : 'Not in yet')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Rooms rooms={w.rooms} />
      {w.rooms?.length > 0 && <RoomDiagram rooms={w.rooms} />}
      <section className="doc-sign">
        <div><div style={{ height: 40 }} /><span className="sign-line">Installer</span></div>
        <div><div style={{ height: 40 }} /><span className="sign-line">Customer: work completed to my satisfaction</span></div>
      </section>
    </>
  );
}

function PoBody({ po, settings }) {
  return (
    <>
      <section className="doc-parties">
        <div><h3>Vendor</h3><div className="strong">{po.vendor?.name}</div><div>{po.vendor?.address}</div><div className="doc-muted">{[po.vendor?.phone, po.vendor?.email].filter(Boolean).join('  ')}</div>{po.vendor?.account_number && <div>Account {po.vendor.account_number}</div>}</div>
        <div><h3>Ship to</h3><div className="strong">{settings.store_name}</div><div>{[settings.store_address, settings.store_city, settings.store_state, settings.store_zip].filter(Boolean).join(', ')}</div>{po.expected_date && <div className="doc-muted">Needed by {date(po.expected_date, { year: true })}</div>}</div>
      </section>
      <div className="doc-wrap-x">
        <table className="doc-table">
          <thead><tr><th>Item</th><th className="r">Quantity</th><th className="r">Cost</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}{(l.sku || l.notes) && <div className="sub">{[l.sku, l.notes].filter(Boolean).join('. ')}</div>}</td>
                <td className="r">{num(l.qty)} {unitLabel(l.unit)}</td>
                <td className="r">{money(l.cost)}</td>
                <td className="r">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="doc-totals"><div className="spread grand"><span>Total</span><span>{money(po.total)}</span></div></div>
      {po.notes && <div style={{ whiteSpace: 'pre-wrap' }}>{po.notes}</div>}
    </>
  );
}

function summary(kind, d, settings) {
  const lines = (d.lines || []).map((l) => `- ${l.description}: ${num(l.qty)} ${l.unit}${kind === 'po' ? '' : `, ${money(l.total)}`}`);
  if (kind === 'po') return [`Purchase order ${d.number}`, '', ...lines, '', d.notes || '', settings.store_name].join('\n');
  const head = kind === 'quote' ? `Here is your quote ${d.number}${d.title ? ` for ${d.title}` : ''}.` : `Here is invoice ${d.invoice_number || d.number}${d.title ? ` for ${d.title}` : ''}.`;
  const tail = kind === 'quote' ? `Total: ${money(d.total)}` : `Total: ${money(d.total)}\nBalance due: ${money(d.total - d.paid_total)}`;
  return [`Hi ${d.customer?.first_name || ''},`, '', head, '', ...lines, '', tail, '', 'Thank you,', settings.store_name, settings.store_phone || ''].join('\n');
}
