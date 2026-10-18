import { useRef, useState } from 'react';
import { Send, PenTool, Copy, Trash2, Printer, MoreHorizontal, Pencil, XCircle, ClipboardList, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { money, date, dateTime, fullAddress } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, IconButton, Badge, Loading, ErrorNote, Notice, Field, Input, TextArea, Select } from '../ui/kit.jsx';
import { Sheet, useAction, useFeedback } from '../ui/overlay.jsx';
import SignaturePad from '../ui/SignaturePad.jsx';
import { LinesPanel, RoomsPanel, TotalsPanel, NotesPanel } from './shared.jsx';
import { quoteStatusLabel } from './Quotes.jsx';

export default function QuotePage({ params }) {
  const { data: q, error, loading, reload } = useData(`/quotes/${params.id}`);
  const { settings } = useSession();
  const [menu, setMenu] = useState(false);
  const [details, setDetails] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [run, busy] = useAction();
  const { confirm } = useFeedback();

  if (loading && !q) return <Screen title="Quote" back="/quotes"><Loading /></Screen>;
  if (error) return <Screen title="Quote" back="/quotes"><ErrorNote error={error} retry={reload} /></Screen>;

  const editable = q.status !== 'accepted';
  const setStatus = (status, msg) => run(async () => { await api.post(`/quotes/${q.id}/status`, { status }); await reload(); }, msg);
  const duplicate = () => run(async () => { const copy = await api.post(`/quotes/${q.id}/duplicate`); setMenu(false); navigate(`/quotes/${copy.id}`); }, 'Copy created');
  const remove = async () => {
    setMenu(false);
    if (!(await confirm({ title: `Delete ${q.number}?`, message: 'The quote and its rooms are removed for good.', confirmLabel: 'Delete quote' }))) return;
    run(async () => { await api.del(`/quotes/${q.id}`); navigate('/quotes', { replace: true }); }, 'Quote deleted');
  };
  const jobAddress = fullAddress(q, 'job_');
  const deposit = Math.round(q.total * (Number(settings.deposit_percent) || 0)) / 100;

  return (
    <Screen title={q.number} back="/quotes" actions={<IconButton icon={MoreHorizontal} label="More actions" onClick={() => setMenu(true)} />}>
      <div className="page-head">
        <div className="grow">
          <h1>{q.title || `New quote for ${q.customer?.display_name || 'customer'}`}</h1>
          {!q.title && editable && <button type="button" className="link-btn small" onClick={() => setDetails(true)}>Name this job, e.g. Main floor LVP</button>}
          <div className="page-sub">
            <Badge status={q.status}>{quoteStatusLabel(q.status)}</Badge>{' '}
            <Link to={`/customers/${q.customer_id}`} className="link-btn">{q.customer?.display_name}</Link>
            {`, ${q.number}, ${date(q.quote_date)}`}{q.valid_until && q.status !== 'accepted' ? `, good until ${date(q.valid_until)}` : ''}
          </div>
        </div>
      </div>

      {q.status === 'accepted' && q.order ? (
        <div className="next">
          <span className="next-label">Accepted{q.signed_at ? ` ${dateTime(q.signed_at)}` : ''}{q.signed_name ? ` by ${q.signed_name}` : ''}</span>
          <span className="next-title">This quote is now order {q.order.number}</span>
          <div className="page-actions"><Button variant="primary" icon={ClipboardList} onClick={() => navigate(`/orders/${q.order.id}`)}>Open the order</Button></div>
        </div>
      ) : q.lines.length === 0 ? (
        <div className="next">
          <span className="next-label">Next step</span>
          <span className="next-title">Measure the rooms and add flooring</span>
          <p className="small muted">Use Measure &amp; add below. It lays out the carpet roll, counts boxes for hard surfaces, and adds pad and labor.</p>
        </div>
      ) : (
        <div className="next">
          <span className="next-label">Next step</span>
          <span className="next-title">{q.status === 'draft' ? 'Review it with the customer' : q.status === 'sent' ? `Waiting on ${q.customer?.first_name || 'the customer'}` : 'Marked as lost'}</span>
          <div className="page-actions">
            {q.status !== 'declined' && <Button variant="primary" icon={PenTool} onClick={() => setAccepting(true)}>Customer accepts</Button>}
            {!__DEMO__ && <Button icon={Printer} onClick={() => navigate(`/print/quote/${q.id}`)}>Print or PDF</Button>}
            {__DEMO__ && <Button icon={Printer} onClick={() => navigate(`/print/quote/${q.id}`)}>Customer copy</Button>}
            {q.status === 'draft' && <Button icon={Send} busy={busy} onClick={() => setStatus('sent', 'Marked as sent')}>Mark as sent</Button>}
            {q.status === 'declined' && <Button icon={RotateCcw} busy={busy} onClick={() => setStatus('sent', 'Quote reopened')}>Reopen quote</Button>}
          </div>
        </div>
      )}

      <div className="cols">
        <div className="stack-lg">
          <LinesPanel doc={q} type="quote" editable={editable} onChange={reload} />
          <RoomsPanel doc={q} type="quote" editable={editable} onChange={reload} />
        </div>
        <div className="stack-lg">
          <TotalsPanel doc={q} type="quote" editable={editable} onChange={reload}>
            {editable && q.total > 0 && Number(settings.deposit_percent) > 0 && (
              <div className="small muted">A {settings.deposit_percent}% deposit would be {money(deposit)}.</div>
            )}
          </TotalsPanel>
          <Panel title="Job details" action={editable && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setDetails(true)}>Edit</Button>}>
            <div className="panel-body">
              <dl className="kv">
                <dt>Job site</dt><dd>{jobAddress || 'Same as customer'}</dd>
                <dt>Salesperson</dt><dd>{q.sales_rep_name || 'Unassigned'}</dd>
                <dt>Phone</dt><dd className="num">{q.customer?.phone || 'None on file'}</dd>
              </dl>
              {q.notes && <div><div className="field-label">Notes on the quote</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{q.notes}</div></div>}
              {q.internal_notes && <div><div className="field-label">Internal notes</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{q.internal_notes}</div></div>}
            </div>
          </Panel>
          {q.signature && (
            <Panel title="Signature">
              <div className="panel-body"><img src={q.signature} alt={`Signature of ${q.signed_name}`} style={{ maxHeight: 90, background: 'var(--doc-bg)', borderRadius: 6 }} /><span className="small muted">{q.signed_name}, {dateTime(q.signed_at)}</span></div>
            </Panel>
          )}
          <NotesPanel entityType="quote" entityId={q.id} notes={q.note_items} onChange={reload} />
        </div>
      </div>

      {menu && (
        <Sheet title={q.number} onClose={() => setMenu(false)}>
          <div className="menu">
            <button type="button" className="menu-item" onClick={() => { setMenu(false); navigate(`/print/quote/${q.id}`); }}><Printer aria-hidden="true" />{__DEMO__ ? 'Customer copy' : 'Print or save as PDF'}</button>
            {editable && <button type="button" className="menu-item" onClick={() => { setMenu(false); setDetails(true); }}><Pencil aria-hidden="true" />Edit job details</button>}
            <button type="button" className="menu-item" onClick={duplicate}><Copy aria-hidden="true" />Duplicate as a new quote</button>
            {q.status === 'sent' && <button type="button" className="menu-item" onClick={() => { setMenu(false); setStatus('declined', 'Marked as lost'); }}><XCircle aria-hidden="true" />Mark as lost</button>}
            {q.status === 'sent' && <button type="button" className="menu-item" onClick={() => { setMenu(false); setStatus('draft', 'Back to draft'); }}><RotateCcw aria-hidden="true" />Back to draft</button>}
            {!q.order_id && <button type="button" className="menu-item danger" onClick={remove}><Trash2 aria-hidden="true" />Delete quote</button>}
          </div>
        </Sheet>
      )}
      {details && <QuoteDetailsSheet q={q} onClose={() => setDetails(false)} onSaved={() => { setDetails(false); reload(); }} />}
      {accepting && <AcceptSheet q={q} deposit={deposit} onClose={() => setAccepting(false)} />}
    </Screen>
  );
}

function QuoteDetailsSheet({ q, onClose, onSaved }) {
  const [f, setF] = useState({
    title: q.title || '', job_address: q.job_address || '', job_city: q.job_city || '', job_state: q.job_state || '', job_zip: q.job_zip || '',
    valid_until: q.valid_until || '', sales_rep_id: q.sales_rep_id || '', notes: q.notes || '', internal_notes: q.internal_notes || '',
  });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const users = useData('/users');
  const [run, busy] = useAction();
  return (
    <Sheet title="Job details" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => run(async () => { await api.put(`/quotes/${q.id}`, { ...f, sales_rep_id: f.sales_rep_id || null }); onSaved(); }, 'Quote saved')}>Save</Button></>}>
      <Field label="Job name" hint="Shows at the top of the quote, e.g. Main floor LVP"><Input value={f.title} onChange={set('title')} /></Field>
      <Field label="Job site address"><Input value={f.job_address} onChange={set('job_address')} /></Field>
      <div className="form-grid">
        <Field label="City"><Input value={f.job_city} onChange={set('job_city')} /></Field>
        <Field label="State"><Input value={f.job_state} onChange={set('job_state')} /></Field>
        <Field label="ZIP"><Input value={f.job_zip} onChange={set('job_zip')} inputMode="numeric" /></Field>
      </div>
      <div className="form-grid">
        <Field label="Good until"><Input type="date" value={f.valid_until} onChange={set('valid_until')} /></Field>
        <Field label="Salesperson"><Select value={f.sales_rep_id} onChange={set('sales_rep_id')} placeholder="Unassigned" options={(users.data || []).filter((u) => u.role !== 'installer').map((u) => ({ value: u.id, label: u.name }))} /></Field>
      </div>
      <Field label="Notes on the quote" hint="The customer sees these"><TextArea value={f.notes} onChange={set('notes')} /></Field>
      <Field label="Internal notes" hint="Staff only"><TextArea value={f.internal_notes} onChange={set('internal_notes')} /></Field>
    </Sheet>
  );
}

function AcceptSheet({ q, deposit, onClose }) {
  const pad = useRef(null);
  const [name, setName] = useState([q.customer?.first_name, q.customer?.last_name].filter(Boolean).join(' '));
  const [signed, setSigned] = useState(false);
  const [run, busy] = useAction();
  const accept = (withSignature) => run(async () => {
    const signature = withSignature ? pad.current?.toDataURL() : null;
    const res = await api.post(`/quotes/${q.id}/accept`, { signed_name: withSignature ? name : null, signature });
    navigate(`/orders/${res.order_id}?deposit=1`, { replace: true });
  }, 'Order created');
  return (
    <Sheet title="Customer accepts" onClose={onClose} initialFocus={false}
      footer={(
        <>
          <Button onClick={() => accept(false)} busy={busy}>Accept without signing</Button>
          <Button variant="primary" busy={busy} disabled={!signed || !name.trim()} onClick={() => accept(true)}>Sign and create order</Button>
        </>
      )}>
      <div className="calc-result">
        <span className="small muted">{q.customer?.display_name} agrees to {q.title || q.number}</span>
        <span className="calc-big">{money(q.total)}</span>
        {deposit > 0 && <span className="small muted">Deposit due today: {money(deposit)}</span>}
      </div>
      <p className="small muted">By signing, the customer accepts the items, prices and terms on this quote.</p>
      <SignaturePad ref={pad} onChange={setSigned} />
      <div className="spread">
        <Field label="Customer’s name" className="grow"><Input value={name} onChange={setName} autoComplete="off" /></Field>
        <Button size="sm" variant="ghost" onClick={() => pad.current?.clear()} disabled={!signed}>Clear</Button>
      </div>
      <Notice>The quote is locked and becomes an order. You can take the deposit on the next screen.</Notice>
    </Sheet>
  );
}
