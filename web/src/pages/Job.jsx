import { useState } from 'react';
import { Phone, MessageSquare, MapPin, CheckCircle2, Play, Printer } from 'lucide-react';
import { APPOINTMENT_TYPES, categoryLabel } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { Link } from '../lib/router.jsx';
import { telHref, smsHref, mapsHref, num, dateLong, time12, feet, fullAddress } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, Badge, Loading, ErrorNote, Field, TextArea, Notice } from '../ui/kit.jsx';
import { Sheet, useAction } from '../ui/overlay.jsx';
import RoomDiagram from '../ui/RoomDiagram.jsx';

const typeLabel = (t) => APPOINTMENT_TYPES.find((x) => x.id === t)?.label || t;

export default function JobPage({ params }) {
  const { isInstaller, user } = useSession();
  const { data: job, error, loading, reload } = useData(`/orders/${params.id}/workorder`);
  const [completing, setCompleting] = useState(null);
  const [note, setNote] = useState('');
  const [run, busy] = useAction();

  if (loading && !job) return <Screen title="Job" back="/"><Loading /></Screen>;
  if (error) return <Screen title="Job" back="/"><ErrorNote error={error} retry={reload} /></Screen>;
  const address = fullAddress(job, 'job_');
  const mine = job.appointments.filter((a) => !isInstaller || a.installer_id === user.installer_id);
  const materials = job.lines.filter((l) => l.kind === 'material');
  const work = job.lines.filter((l) => l.kind !== 'material');
  const sendNote = () => run(async () => {
    await api.post('/notes', { entity_type: 'order', entity_id: job.id, body: note });
    setNote('');
  }, 'Note sent to the office');

  return (
    <Screen title={job.customer?.display_name || 'Job'} back={isInstaller ? '/' : `/orders/${job.id}`}
      actions={!isInstaller && !__DEMO__ && <Link to={`/print/workorder/${job.id}`} className="icon-btn" aria-label="Print work order"><Printer aria-hidden="true" /></Link>}>
      <div className="page-head">
        <div>
          <h1>{job.customer?.display_name}</h1>
          <div className="page-sub">{[job.number, job.title].filter(Boolean).join(', ')}</div>
        </div>
      </div>
      <Panel>
        <div className="panel-body">
          <div className="strong">{address || 'No job address on file'}</div>
          {job.customer?.phone && <div className="muted small">Customer phone: <span className="num">{job.customer.phone}</span></div>}
          <div className="quick-actions">
            {job.customer?.phone && <a className="quick-action" href={telHref(job.customer.phone)}><Phone aria-hidden="true" />Call</a>}
            {job.customer?.phone && <a className="quick-action" href={smsHref(job.customer.phone)}><MessageSquare aria-hidden="true" />Text</a>}
            {address && <a className="quick-action primary" href={mapsHref(address)} target="_blank" rel="noreferrer"><MapPin aria-hidden="true" />Directions</a>}
          </div>
        </div>
      </Panel>

      {mine.map((a) => (
        <Panel key={a.id} title={`${typeLabel(a.type)}: ${dateLong(a.date)}`} action={<Badge status={a.status}>{a.status === 'done' ? 'Done' : a.status === 'in_progress' ? 'Started' : a.start_time ? time12(a.start_time) : 'Scheduled'}</Badge>}>
          <div className="panel-body">
            {a.installer_name && <div className="small muted">Crew: {a.installer_name}{a.end_date ? `, through ${dateLong(a.end_date)}` : ''}</div>}
            {a.notes && <div style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</div>}
            {a.status === 'done' ? (
              <Notice tone="info">Marked complete{a.completion_notes ? `: ${a.completion_notes}` : '.'}</Notice>
            ) : (
              <div className="hstack wrap">
                {a.status !== 'in_progress' && (
                  <Button icon={Play} busy={busy} onClick={() => run(async () => { await api.post(`/appointments/${a.id}/status`, { status: 'in_progress' }); await reload(); }, 'Job started')}>Start job</Button>
                )}
                <Button variant="primary" icon={CheckCircle2} onClick={() => setCompleting(a)}>Mark complete</Button>
              </div>
            )}
          </div>
        </Panel>
      ))}

      {(job.install_notes || job.notes) && (
        <Panel title="Notes from the office">
          <div className="panel-body" style={{ whiteSpace: 'pre-wrap' }}>{[job.install_notes, job.notes].filter(Boolean).join('\n\n')}</div>
        </Panel>
      )}

      <Panel title="Materials">
        <div className="rows">
          {materials.map((l) => (
            <div key={l.id} className="line">
              <span className="line-desc">{l.description}</span>
              <span className="line-total num">{num(l.qty)} {l.unit}</span>
              <div className="line-meta">{[categoryLabel(l.category), l.area].filter(Boolean).join(', ')}</div>
              <div className="line-material">
                {l.material_status === 'received' ? <Badge status="received">In the warehouse</Badge>
                  : l.material_status === 'ordered' ? <Badge status="ordered">On order</Badge>
                    : l.material_status === 'needed' ? <Badge status="needed">Not ordered yet</Badge> : null}
                {(l.allocations || []).filter((x) => x.type !== 'return').map((x) => (
                  <span key={x.id} className="small muted">
                    {[x.tag && `Tag ${x.tag}`, x.dye_lot && `dye lot ${x.dye_lot}`, x.location, x.kind === 'roll' ? `${feet(Math.abs(x.qty))} cut` : `${num(Math.abs(x.qty))} pulled`].filter(Boolean).join(', ')}
                  </span>
                ))}
              </div>
              {l.notes && <div className="line-meta">{l.notes}</div>}
            </div>
          ))}
          {!materials.length && <div className="list-empty">No materials on this job.</div>}
        </div>
      </Panel>

      {work.length > 0 && (
        <Panel title="Work to do">
          <div className="rows">
            {work.map((l) => (
              <div key={l.id} className="line">
                <span className="line-desc">{l.description}</span>
                <span className="line-total num">{num(l.qty)} {l.unit}</span>
                {(l.area || l.notes) && <div className="line-meta">{[l.area, l.notes].filter(Boolean).join(', ')}</div>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {job.rooms.length > 0 && (
        <Panel title="Rooms">
          <div className="panel-body">
            <div className="diagram-wrap"><RoomDiagram rooms={job.rooms} /></div>
          </div>
        </Panel>
      )}

      <Panel title="Send a note to the office">
        <div className="panel-body">
          <Field label="Note" hint="Subfloor problems, extra work, anything the office should know">
            <TextArea value={note} onChange={setNote} />
          </Field>
          <div><Button busy={busy} disabled={!note.trim()} onClick={sendNote}>Send note</Button></div>
        </div>
      </Panel>

      {completing && <CompleteSheet appt={completing} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); reload(); }} />}
    </Screen>
  );
}

export function CompleteSheet({ appt, onClose, onDone }) {
  const [notes, setNotes] = useState('');
  const [run, busy] = useAction();
  return (
    <Sheet title="Mark job complete" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => run(async () => { await api.post(`/appointments/${appt.id}/complete`, { notes }); onDone(); }, 'Marked complete')}>Mark complete</Button></>}>
      <p className="muted">The office will see this right away{appt.type === 'install' ? ' and can send the invoice' : ''}.</p>
      <Field label="Completion notes" hint="Leftover material, seams, anything the customer asked about">
        <TextArea value={notes} onChange={setNotes} />
      </Field>
    </Sheet>
  );
}
