import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarPlus, Trash2, CheckCircle2, Ban, HardHat, ClipboardList, MapPin } from 'lucide-react';
import { APPOINTMENT_TYPES } from '@core/calc.js';
import { addDays } from '@core/util.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { todayStr, parseDate, weekday, dateLong, date, time12, mapsHref } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, IconButton, Badge, Loading, ErrorNote, Chips, Field, Input, Select, TextArea, Segmented, NumberInput, Notice } from '../ui/kit.jsx';
import { Sheet, useAction, useFeedback } from '../ui/overlay.jsx';
import { CustomerPicker, OrderPicker } from '../ui/pickers.jsx';
import { ApptRow } from './Home.jsx';
import { CompleteSheet } from './Job.jsx';

const typeLabel = (t) => APPOINTMENT_TYPES.find((x) => x.id === t)?.label || t;

export default function SchedulePage({ query }) {
  const { isInstaller } = useSession();
  const today = todayStr();
  const [start, setStart] = useState(today);
  const [crew, setCrew] = useState('');
  const [selected, setSelected] = useState(null); // appointment being viewed
  const [creating, setCreating] = useState(query.new === '1' ? {} : null);
  const end = addDays(start, 6);
  const appts = useData('/appointments', { from: start, to: end, installer_id: crew });
  const installers = useData('/installers');
  const ready = useData(isInstaller ? null : '/orders', { stage: 'ready' });

  useEffect(() => {
    if (query.appt) api.get(`/appointments/${query.appt}`).then(setSelected).catch(() => {});
  }, [query.appt]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const byDay = useMemo(() => {
    const m = Object.fromEntries(days.map((d) => [d, []]));
    for (const a of appts.data || []) {
      for (const d of days) if (a.date <= d && (a.end_date || a.date) >= d) m[d].push(a);
    }
    return m;
  }, [appts.data, days]);
  const crewOptions = [{ value: '', label: 'All crews' }, ...(installers.data || []).map((i) => ({ value: String(i.id), label: i.name, color: i.color })), { value: 'none', label: 'No crew' }];
  const range = `${date(start)} to ${date(end)}`;

  return (
    <Screen title="Schedule">
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <div className="page-sub">{range}</div>
        </div>
        <div className="page-actions">
          <IconButton icon={ChevronLeft} label="Previous 7 days" onClick={() => setStart(addDays(start, -7))} />
          <Button size="sm" onClick={() => setStart(today)}>Today</Button>
          <IconButton icon={ChevronRight} label="Next 7 days" onClick={() => setStart(addDays(start, 7))} />
          {!isInstaller && <Button variant="primary" icon={CalendarPlus} onClick={() => setCreating({})}>New</Button>}
        </div>
      </div>
      <div className="week-strip" role="group" aria-label="Days this week">
        {days.map((d) => (
          <button key={d} type="button" className="day-cell" aria-current={d === today ? 'date' : undefined}
            onClick={() => document.getElementById(`day-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <span>{weekday(d)}</span>
            <b>{parseDate(d).getDate()}</b>
            <span className="dots">{byDay[d].slice(0, 4).map((a) => <i key={a.id} style={{ background: a.installer_color || 'var(--ink-3)' }} />)}</span>
          </button>
        ))}
      </div>
      {!isInstaller && <Chips value={crew} onChange={setCrew} options={crewOptions} label="Crew" />}
      <ErrorNote error={appts.error} retry={appts.reload} />
      <div className="cols">
        <div className="panel rows">
          {appts.loading && !appts.data ? <Loading /> : days.map((d) => (
            <div key={d} id={`day-${d}`} className="rows" style={{ scrollMarginTop: 'calc(var(--topbar-h) + 12px)' }}>
              <div className="day-head">
                <span className="grow">{dateLong(d)}{d === today && <> <Badge tone="brand">Today</Badge></>}</span>
                {!byDay[d].length && <span className="faint" style={{ fontWeight: 500 }}>Nothing scheduled</span>}
              </div>
              {byDay[d].map((a) => <ApptRow key={`${a.id}-${d}`} a={a} today={today} onOpen={setSelected} />)}
            </div>
          ))}
        </div>
        {!isInstaller && (
          <div className="stack-lg">
            <Panel title="Waiting for an install date">
              <div className="rows">
                {(ready.data || []).map((o) => (
                  <button key={o.id} type="button" className="row" onClick={() => setCreating({ type: 'install', order_id: o.id, customer_id: o.customer_id, customer_name: o.customer_name, order_number: o.number })}>
                    <div className="row-main"><span className="row-title">{o.customer_name}</span><span className="row-sub">{o.number} {o.title}, material is in</span></div>
                    <span className="link-btn small">Schedule</span>
                  </button>
                ))}
                {ready.data && !ready.data.length && <div className="list-empty">Every job with material in has a date.</div>}
              </div>
            </Panel>
            <Panel title="Crews">
              <div className="rows">
                {(installers.data || []).map((i) => (
                  <div key={i.id} className="row">
                    <span className="row-lead" style={{ background: i.color }} />
                    <div className="row-main"><span className="row-title">{i.name}</span><span className="row-sub">{[i.specialties, i.phone].filter(Boolean).join(', ')}</span></div>
                    <span className="small faint">{i.upcoming} upcoming</span>
                  </div>
                ))}
              </div>
              <div className="row-more"><Link to="/settings#crews" className="link-btn">Manage crews</Link></div>
            </Panel>
          </div>
        )}
      </div>
      {selected && (
        <AppointmentSheet appt={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); appts.reload(); ready.reload(); }} />
      )}
      {creating && (
        <AppointmentSheet initial={{ date: today >= start && today <= end ? today : start, ...creating }} onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); appts.reload(); ready.reload(); }} />
      )}
    </Screen>
  );
}

export function AppointmentSheet({ appt, initial = {}, onClose, onSaved }) {
  const { isInstaller } = useSession();
  const existing = !!appt?.id;
  const [editing, setEditing] = useState(!existing);
  const [completing, setCompleting] = useState(false);
  const installers = useData('/installers');
  const [f, setF] = useState(() => ({
    type: 'install', date: todayStr(), end_date: '', start_time: '08:00', duration_hours: '', installer_id: '', title: '', address: '', notes: '',
    order_id: null, customer_id: null, customer_name: '', order_number: '',
    ...initial,
    ...(appt ? {
      ...appt, end_date: appt.end_date || '', start_time: appt.start_time || '', duration_hours: appt.duration_hours ?? '',
      installer_id: appt.installer_id ? String(appt.installer_id) : '', customer_name: appt.customer_name || '', order_number: appt.order_number || '',
    } : {}),
  }));
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [picker, setPicker] = useState(null);
  const [run, busy] = useAction();
  const { toast, confirm } = useFeedback();
  const [multi, setMulti] = useState(!!f.end_date);

  const save = () => run(async () => {
    const body = { ...f, end_date: multi ? f.end_date : '', installer_id: f.installer_id === '' ? null : f.installer_id };
    const res = existing ? await api.put(`/appointments/${appt.id}`, body) : await api.post('/appointments', body);
    if (res.conflicts?.length) toast(`${res.installer_name} already has ${res.conflicts.length} other ${res.conflicts.length === 1 ? 'job' : 'jobs'} that day`, { tone: 'error' });
    else toast(existing ? 'Appointment saved' : 'Scheduled');
    onSaved();
  });
  const setStatus = (status, msg) => run(async () => { await api.post(`/appointments/${appt.id}/status`, { status }); onSaved(); }, msg);
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this appointment?', confirmLabel: 'Delete appointment' }))) return;
    run(async () => { await api.del(`/appointments/${appt.id}`); onSaved(); }, 'Appointment deleted');
  };

  if (completing) return <CompleteSheet appt={appt} onClose={() => setCompleting(false)} onDone={onSaved} />;
  if (picker === 'customer') return <CustomerPicker onClose={() => setPicker(null)} onPick={(c) => { setF((s) => ({ ...s, customer_id: c.id, customer_name: c.display_name, order_id: null, order_number: '', address: '' })); setPicker(null); }} />;
  if (picker === 'order') return <OrderPicker onClose={() => setPicker(null)} onPick={(o) => { setF((s) => ({ ...s, order_id: o.id, order_number: o.number, customer_id: o.customer_id, customer_name: o.customer_name, address: '' })); setPicker(null); }} />;

  if (existing && !editing) {
    const a = appt;
    return (
      <Sheet title={`${typeLabel(a.type)}: ${a.customer_name || a.title || ''}`} onClose={onClose}
        footer={(
          <>
            {!isInstaller && <Button onClick={() => setEditing(true)}>Edit</Button>}
            {a.status !== 'done' && a.status !== 'cancelled' && <Button variant="primary" icon={CheckCircle2} onClick={() => setCompleting(true)}>Mark complete</Button>}
          </>
        )}>
        <div className="hstack wrap"><Badge status={a.status}>{a.status === 'done' ? 'Done' : a.status === 'cancelled' ? 'Cancelled' : a.status === 'in_progress' ? 'Started' : 'Scheduled'}</Badge>{a.order_number && <span className="small muted">{a.order_number}</span>}</div>
        <dl className="kv">
          <dt>When</dt><dd>{dateLong(a.date)}{a.end_date ? ` to ${dateLong(a.end_date)}` : ''}{a.start_time ? `, ${time12(a.start_time)}` : ''}{a.duration_hours ? ` for ${a.duration_hours} hr` : ''}</dd>
          <dt>Crew</dt><dd>{a.installer_name || 'None assigned'}</dd>
          {a.customer_phone && <><dt>Customer phone</dt><dd className="num">{a.customer_phone}</dd></>}
          {a.address && <><dt>Address</dt><dd>{a.address} <a className="link-btn small" href={mapsHref(a.address)} target="_blank" rel="noreferrer"><MapPin size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> Map</a></dd></>}
        </dl>
        {a.notes && <div style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</div>}
        {a.completion_notes && <Notice>Completed: {a.completion_notes}</Notice>}
        <div className="menu">
          {a.order_id && <button type="button" className="menu-item" onClick={() => { onClose(); navigate(`/jobs/${a.order_id}`); }}><HardHat aria-hidden="true" />Open the work order</button>}
          {a.order_id && !isInstaller && <button type="button" className="menu-item" onClick={() => { onClose(); navigate(`/orders/${a.order_id}`); }}><ClipboardList aria-hidden="true" />Open the order</button>}
          {!isInstaller && a.status !== 'cancelled' && a.status !== 'done' && <button type="button" className="menu-item" onClick={() => setStatus('cancelled', 'Appointment cancelled')}><Ban aria-hidden="true" />Cancel appointment</button>}
          {!isInstaller && (a.status === 'cancelled' || a.status === 'done') && <button type="button" className="menu-item" onClick={() => setStatus('scheduled', 'Back on the schedule')}><CalendarPlus aria-hidden="true" />Put back on the schedule</button>}
          {!isInstaller && <button type="button" className="menu-item danger" onClick={remove}><Trash2 aria-hidden="true" />Delete appointment</button>}
        </div>
      </Sheet>
    );
  }

  const fixedOrder = !!initial.order_id && !existing;
  return (
    <Sheet title={existing ? 'Edit appointment' : f.type === 'install' ? 'Schedule install' : 'New appointment'} onClose={onClose}
      footer={<><Button onClick={existing ? () => setEditing(false) : onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{existing ? 'Save' : 'Schedule'}</Button></>}>
      <Segmented label="Type" value={f.type} onChange={set('type')} options={APPOINTMENT_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
      {!fixedOrder && (
        <div className="form-grid">
          <Field label="Customer">
            <button type="button" className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setPicker('customer')}>{f.customer_name || 'Choose a customer'}</button>
          </Field>
          <Field label="Order (optional)">
            <button type="button" className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setPicker('order')}>{f.order_number || 'Link an order'}</button>
          </Field>
        </div>
      )}
      {fixedOrder && <div className="small muted">{f.order_number}, {f.customer_name}</div>}
      <div className="form-grid">
        <Field label={multi ? 'First day' : 'Date'}><Input type="date" value={f.date} onChange={set('date')} /></Field>
        {multi && <Field label="Last day"><Input type="date" value={f.end_date} min={f.date} onChange={set('end_date')} /></Field>}
        <Field label="Start time"><Input type="time" value={f.start_time} onChange={set('start_time')} step={900} /></Field>
        <Field label="Hours"><NumberInput value={f.duration_hours} onChange={set('duration_hours')} placeholder="4" /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={multi} onChange={(e) => { setMulti(e.target.checked); if (e.target.checked && !f.end_date) set('end_date')(addDays(f.date, 1)); }} />Takes more than one day</label>
      <Field label="Crew">
        <Select value={f.installer_id} onChange={set('installer_id')} placeholder={f.type === 'measure' ? 'Salesperson will measure' : 'No crew yet'}
          options={(installers.data || []).map((i) => ({ value: String(i.id), label: `${i.name}${i.specialties ? ` (${i.specialties})` : ''}` }))} />
      </Field>
      {!f.customer_id && <Field label="Title"><Input value={f.title} onChange={set('title')} placeholder="Showroom delivery" /></Field>}
      <Field label="Address" hint={f.customer_id && !f.address ? 'Leave blank to use the job or customer address' : null}><Input value={f.address} onChange={set('address')} /></Field>
      <Field label="Notes for the crew"><TextArea value={f.notes} onChange={set('notes')} /></Field>
    </Sheet>
  );
}

