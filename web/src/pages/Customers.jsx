import { useState } from 'react';
import { Users, UserPlus, Phone, MessageSquare, Mail, MapPin, FileText, ClipboardList, CalendarPlus, Pencil, Trash2 } from 'lucide-react';
import { ORDER_STAGES, QUOTE_STATUSES, APPOINTMENT_TYPES, PAYMENT_METHODS } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { Link, navigate } from '../lib/router.jsx';
import { money, money0, date, telHref, smsHref, mapsHref, fullAddress, time12 } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, Badge, Loading, ErrorNote, Empty, SearchBox, Chips, Figures, useDebounced } from '../ui/kit.jsx';
import { useAction, useFeedback } from '../ui/overlay.jsx';
import { CustomerForm } from '../ui/pickers.jsx';
import { NotesPanel } from './shared.jsx';
import { AppointmentSheet } from './Schedule.jsx';

const stageLabel = (s) => (s === 'cancelled' ? 'Cancelled' : ORDER_STAGES.find((x) => x.id === s)?.label || s);
const quoteLabel = (s) => QUOTE_STATUSES.find((x) => x.id === s)?.label || s;

export function CustomersPage({ query }) {
  const [q, setQ] = useState(query.q || '');
  const [type, setType] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useData('/customers', { q: dq, type });
  const [adding, setAdding] = useState(false);
  return (
    <Screen title="Customers">
      <div className="page-head">
        <h1>Customers</h1>
        <div className="page-actions"><Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>New customer</Button></div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Name, phone, email, or street" />
      <Chips value={type} onChange={setType} options={[
        { value: '', label: 'Everyone' }, { value: 'residential', label: 'Homeowners' }, { value: 'commercial', label: 'Commercial' }, { value: 'builder', label: 'Builders' },
      ]} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="panel rows">
          {(data || []).map((c) => (
            <Link key={c.id} to={`/customers/${c.id}`} className="row">
              <div className="row-main">
                <span className="row-title">{c.display_name}</span>
                <span className="row-sub">{[c.phone, c.city].filter(Boolean).join(', ') || 'No phone on file'}</span>
              </div>
              <div className="row-meta">
                {c.balance > 0.004 && <Badge tone="danger">Owes {money0(c.balance)}</Badge>}
                {c.open_quotes > 0 && <Badge tone="info">{c.open_quotes} open {c.open_quotes === 1 ? 'quote' : 'quotes'}</Badge>}
                {!c.open_quotes && !(c.balance > 0.004) && c.order_count > 0 && <span className="xs faint">{c.order_count} {c.order_count === 1 ? 'order' : 'orders'}</span>}
              </div>
            </Link>
          ))}
          {data && !data.length && (
            <Empty icon={Users} title={q ? 'No customers match' : 'No customers yet'} action={<Button icon={UserPlus} onClick={() => setAdding(true)}>Add a customer</Button>}>
              {q ? 'Check the spelling, or search by phone number.' : 'Add your first customer to start a quote.'}
            </Empty>
          )}
        </div>
      )}
      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); navigate(`/customers/${c.id}`); }} />}
    </Screen>
  );
}

export function CustomerPage({ params }) {
  const { data: c, error, loading, reload } = useData(`/customers/${params.id}`);
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  if (loading && !c) return <Screen title="Customer" back="/customers"><Loading /></Screen>;
  if (error) return <Screen title="Customer" back="/customers"><ErrorNote error={error} retry={reload} /></Screen>;
  const address = fullAddress(c);
  const newDoc = (kind) => run(async () => {
    const doc = await api.post(kind === 'quote' ? '/quotes' : '/orders', { customer_id: c.id });
    navigate(`/${kind === 'quote' ? 'quotes' : 'orders'}/${doc.id}`);
  });
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this customer?', message: 'This removes the customer and their notes. It can’t be undone.', confirmLabel: 'Delete customer' }))) return;
    run(async () => { await api.del(`/customers/${c.id}`); navigate('/customers', { replace: true }); }, 'Customer deleted');
  };
  return (
    <Screen title={c.display_name} back="/customers" actions={<Button size="sm" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}>
      <div className="page-head">
        <div className="grow">
          <h1>{c.display_name}</h1>
          <div className="page-sub">
            {c.type !== 'residential' && <Badge>{c.type === 'builder' ? 'Builder' : 'Commercial'}</Badge>}{' '}
            Customer since {date(c.created_at, { year: true })}{c.sales_rep_name ? `, salesperson ${c.sales_rep_name}` : ''}
          </div>
        </div>
      </div>
      <div className="quick-actions">
        <button type="button" className="quick-action primary" aria-disabled={busy} onClick={() => newDoc('quote')}><FileText aria-hidden="true" />New quote</button>
        <button type="button" className="quick-action" aria-disabled={busy} onClick={() => newDoc('order')}><ClipboardList aria-hidden="true" />New order</button>
        <button type="button" className="quick-action" onClick={() => setScheduling(true)}><CalendarPlus aria-hidden="true" />Schedule measure</button>
      </div>
      <div className="cols">
        <div className="stack-lg">
          <Panel title="Quotes" action={<span className="small faint">{c.quotes.length}</span>}>
            <div className="rows">
              {c.quotes.map((q) => (
                <Link key={q.id} to={`/quotes/${q.id}`} className="row">
                  <div className="row-main"><span className="row-title">{q.number}{q.title ? ` ${q.title}` : ''}</span><span className="row-sub">{date(q.created_at)}</span></div>
                  <div className="row-meta"><span className="row-amount">{money(q.total)}</span><Badge status={q.status}>{quoteLabel(q.status)}</Badge></div>
                </Link>
              ))}
              {!c.quotes.length && <div className="list-empty">No quotes yet.</div>}
            </div>
          </Panel>
          <Panel title="Orders" action={<span className="small faint">{c.orders.length}</span>}>
            <div className="rows">
              {c.orders.map((o) => (
                <Link key={o.id} to={`/orders/${o.id}`} className="row">
                  <div className="row-main"><span className="row-title">{o.number}{o.title ? ` ${o.title}` : ''}</span><span className="row-sub">{date(o.created_at)}</span></div>
                  <div className="row-meta"><span className="row-amount">{money(o.total)}</span><Badge status={o.stage}>{stageLabel(o.stage)}</Badge></div>
                </Link>
              ))}
              {!c.orders.length && <div className="list-empty">No orders yet.</div>}
            </div>
          </Panel>
          <Panel title="Appointments">
            <div className="rows">
              {c.appointments.map((a) => (
                <Link key={a.id} to={a.order_id ? `/orders/${a.order_id}` : `/schedule?appt=${a.id}`} className="row">
                  <div className="row-main">
                    <span className="row-title">{APPOINTMENT_TYPES.find((t) => t.id === a.type)?.label} on {date(a.date)}{a.start_time ? ` at ${time12(a.start_time)}` : ''}</span>
                    <span className="row-sub">{a.installer_name || a.title || a.notes || ''}</span>
                  </div>
                  <Badge status={a.status}>{a.status === 'done' ? 'Done' : a.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}</Badge>
                </Link>
              ))}
              {!c.appointments.length && <div className="list-empty">Nothing scheduled.</div>}
            </div>
          </Panel>
          {c.payments.length > 0 && (
            <Panel title="Payments">
              <div className="rows">
                {c.payments.map((p) => (
                  <Link key={p.id} to={`/orders/${p.order_id}`} className="row">
                    <div className="row-main"><span className="row-title">{money(p.amount)} {PAYMENT_METHODS.find((m) => m.id === p.method)?.label.toLowerCase()}</span><span className="row-sub">{date(p.date)}, {p.order_number}{p.reference ? `, #${p.reference}` : ''}</span></div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
        </div>
        <div className="stack-lg">
          <Panel>
            <Figures items={[
              { label: 'Lifetime sales', value: money0(c.lifetime) },
              { label: 'Balance due', value: money(c.balance) },
            ]} />
          </Panel>
          <Panel title="Contact">
            <div className="panel-body">
              <dl className="kv">
                {c.phone && <><dt>Mobile</dt><dd className="num">{c.phone}</dd></>}
                {c.phone2 && <><dt>Other phone</dt><dd className="num">{c.phone2}</dd></>}
                {c.email && <><dt>Email</dt><dd>{c.email}</dd></>}
                {address && <><dt>Address</dt><dd>{address}</dd></>}
                {c.source && <><dt>Found us</dt><dd>{c.source}</dd></>}
              </dl>
              <div className="quick-actions" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(64px, 1fr))' }}>
                {c.phone && <a className="quick-action" href={telHref(c.phone)}><Phone aria-hidden="true" />Call</a>}
                {c.phone && <a className="quick-action" href={smsHref(c.phone)}><MessageSquare aria-hidden="true" />Text</a>}
                {c.email && <a className="quick-action" href={`mailto:${c.email}`}><Mail aria-hidden="true" />Email</a>}
                {address && <a className="quick-action" href={mapsHref(address)} target="_blank" rel="noreferrer"><MapPin aria-hidden="true" />Map</a>}
              </div>
              {c.notes && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div>}
            </div>
          </Panel>
          <NotesPanel entityType="customer" entityId={c.id} notes={c.note_items} onChange={reload} />
          {!c.quotes.length && !c.orders.length && <Button variant="ghost" className="btn-danger" icon={Trash2} onClick={remove}>Delete customer</Button>}
        </div>
      </div>
      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {scheduling && <AppointmentSheet initial={{ type: 'measure', customer_id: c.id, customer_name: c.display_name }} onClose={() => setScheduling(false)} onSaved={() => { setScheduling(false); reload(); }} />}
    </Screen>
  );
}
