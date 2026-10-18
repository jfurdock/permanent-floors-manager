import { AlertTriangle, PackageSearch, CalendarPlus, Receipt, PhoneCall, Truck, Boxes, Store, ClipboardCheck, ChevronRight } from 'lucide-react';
import { ORDER_STAGES, APPOINTMENT_TYPES } from '@core/calc.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { Link } from '../lib/router.jsx';
import { money, money0, pct, time12, dateLong, date, relDay } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Figures, Badge, Loading, ErrorNote, Empty } from '../ui/kit.jsx';
import MyJobs from './MyJobs.jsx';

const typeLabel = (t) => APPOINTMENT_TYPES.find((x) => x.id === t)?.label || t;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function ApptRow({ a, showDate, today, jobLink, onOpen }) {
  const to = jobLink
    ? (a.order_id ? `/jobs/${a.order_id}` : `/schedule?appt=${a.id}`)
    : (a.order_id ? `/orders/${a.order_id}` : `/schedule?appt=${a.id}`);
  if (onOpen) {
    return (
      <button type="button" className="row" onClick={() => onOpen(a)}>
        <ApptRowBody a={a} showDate={showDate} today={today} />
      </button>
    );
  }
  return <Link to={to} className="row"><ApptRowBody a={a} showDate={showDate} today={today} /></Link>;
}

function ApptRowBody({ a, showDate, today }) {
  return (
    <>
      <span className="row-lead" style={{ background: a.installer_color || 'var(--line-strong)' }} />
      <div className="appt-time">
        {showDate ? relDay(a.date, today) : (a.start_time ? time12(a.start_time) : 'Any time')}
        {showDate && a.start_time && <small>{time12(a.start_time)}</small>}
        {!showDate && a.duration_hours ? <small>{a.duration_hours} hr</small> : null}
      </div>
      <div className="row-main">
        <span className="row-title">{a.customer_name || a.title || 'Appointment'}</span>
        <span className="row-sub">{[a.order_number, a.installer_name || (a.type === 'measure' ? 'Sales measure' : 'No crew yet'), a.address].filter(Boolean).join(', ')}</span>
      </div>
      <div className="row-meta">
        <Badge tone={a.type === 'install' ? 'info' : a.type === 'measure' ? 'brand' : ''}>{typeLabel(a.type)}</Badge>
        {a.status === 'done' && <Badge status="done">Done</Badge>}
        {a.status === 'in_progress' && <Badge status="in_progress">Started</Badge>}
      </div>
    </>
  );
}

export default function Home() {
  const { user, isInstaller, isManager } = useSession();
  if (isInstaller) return <MyJobs />;
  return <Dashboard user={user} isManager={isManager} />;
}

function Dashboard({ user, isManager }) {
  const { data, error, loading, reload } = useData('/dashboard');
  const firstName = user?.name?.split(' ')[0] || '';
  return (
    <Screen title="Home">
      <div className="page-head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <div className="page-sub">{data ? dateLong(data.today) : ' '}</div>
        </div>
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel title="This month" action={<Link to="/reports" className="link-btn small">Reports</Link>}>
            <Figures items={[
              { label: 'Sales booked', value: money0(data.month.net), note: `${data.month.count} ${data.month.count === 1 ? 'order' : 'orders'}` },
              { label: 'Gross margin', value: pct(data.month.margin), note: `${money0(data.month.profit)} profit` },
              { label: 'Collected', value: money0(data.month.payments), note: `${money0(data.today_payments)} today` },
              { label: 'Balance due', value: money0(data.ar), note: `${money0(data.deposits)} in deposits` },
            ]} />
          </Panel>
          <div className="cols">
            <div className="stack-lg">
              <Panel title="Today" action={<Link to="/schedule" className="link-btn small">Schedule</Link>}>
                <div className="rows">
                  {data.appointments.map((a) => <ApptRow key={a.id} a={a} today={data.today} />)}
                  {!data.appointments.length && <div className="list-empty">Nothing on the calendar today.</div>}
                </div>
                {data.week_count > 0 && <div className="row-more muted">{data.week_count} more {data.week_count === 1 ? 'appointment' : 'appointments'} in the next 7 days</div>}
              </Panel>
              <Attention data={data} isManager={isManager} />
            </div>
            <div className="stack-lg">
              <Panel title="Jobs in progress" action={<Link to="/orders" className="link-btn small">All orders</Link>}>
                <div className="rows">
                  {ORDER_STAGES.filter((s) => s.id !== 'paid').map((s) => {
                    const st = data.stages[s.id] || { count: 0, value: 0 };
                    return (
                      <Link key={s.id} to={`/orders?stage=${s.id}`} className="row">
                        <div className="row-main"><span className="row-title">{s.label}</span><span className="row-sub">{s.hint}</span></div>
                        <div className="row-meta"><span className="row-amount">{st.count}</span><span className="xs faint">{money0(st.value)}</span></div>
                        <ChevronRight size={18} className="faint" aria-hidden="true" />
                      </Link>
                    );
                  })}
                  <Link to="/quotes?status=open" className="row">
                    <div className="row-main"><span className="row-title">Open quotes</span><span className="row-sub">Drafts and quotes waiting on the customer</span></div>
                    <div className="row-meta"><span className="row-amount">{data.quotes.open_count}</span><span className="xs faint">{money0(data.quotes.open_value)}</span></div>
                    <ChevronRight size={18} className="faint" aria-hidden="true" />
                  </Link>
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}
    </Screen>
  );
}

function Attention({ data, isManager }) {
  const items = [];
  for (const o of data.new_orders) items.push({ key: `n${o.id}`, icon: PackageSearch, to: `/orders/${o.id}`, title: `Order material for ${o.customer_name}`, sub: `${o.number}${o.title ? `, ${o.title}` : ''}` });
  for (const o of data.ready_to_schedule) items.push({ key: `r${o.id}`, icon: CalendarPlus, to: `/orders/${o.id}`, title: `Schedule ${o.customer_name}`, sub: `${o.number}: material is in` });
  for (const o of data.to_invoice) items.push({ key: `i${o.id}`, icon: Receipt, to: `/orders/${o.id}`, title: `Invoice ${o.customer_name}`, sub: `${o.number}: installed, ${money(o.balance)} still due` });
  for (const o of data.overdue) items.push({ key: `o${o.id}`, icon: AlertTriangle, tone: 'danger', to: `/orders/${o.id}`, title: `${o.customer_name} owes ${money(o.balance)}`, sub: `${o.number}: ${o.days} ${o.days === 1 ? 'day' : 'days'} past due` });
  for (const q of data.quotes.follow_ups) items.push({ key: `q${q.id}`, icon: PhoneCall, to: `/quotes/${q.id}`, title: `Follow up with ${q.customer_name}`, sub: `${q.number} sent ${q.days} days ago, ${money(q.total)}` });
  for (const p of data.late_pos) items.push({ key: `p${p.id}`, icon: Truck, tone: 'warn', to: `/purchasing/${p.id}`, title: `${p.number} from ${p.vendor_name} is late`, sub: `Expected ${date(p.expected_date)}` });
  if (data.draft_pos) items.push({ key: 'dp', icon: Truck, to: '/purchasing?status=draft', title: `${data.draft_pos} purchase ${data.draft_pos === 1 ? 'order' : 'orders'} not sent yet`, sub: 'Review and send to the vendor' });
  for (const p of data.low_stock) items.push({ key: `l${p.id}`, icon: Boxes, to: `/products/${p.id}`, title: `Low stock: ${[p.style, p.color].filter(Boolean).join(' ')}`, sub: `${p.on_hand} ${p.unit} on hand, reorder at ${p.reorder_point}` });
  if (data.setup_needed && isManager) items.push({ key: 'setup', icon: Store, to: '/settings', title: 'Finish your store details', sub: 'Your address and phone print on quotes and invoices' });
  return (
    <Panel title="Needs attention">
      {items.length ? (
        <div className="rows">
          {items.map((it) => (
            <Link key={it.key} to={it.to} className="row">
              <it.icon size={20} aria-hidden="true" style={{ color: it.tone === 'danger' ? 'var(--danger)' : it.tone === 'warn' ? 'var(--warn)' : 'var(--ink-2)', flex: 'none' }} />
              <div className="row-main"><span className="row-title">{it.title}</span><span className="row-sub">{it.sub}</span></div>
              <ChevronRight size={18} className="faint" aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : <Empty icon={ClipboardCheck} title="All caught up">Nothing needs a follow-up right now.</Empty>}
    </Panel>
  );
}

