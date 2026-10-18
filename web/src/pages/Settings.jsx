import { useEffect, useState } from 'react';
import { Plus, KeyRound, LogOut, Download, RotateCcw, Database } from 'lucide-react';
import { ROLES } from '@core/calc.js';
import { api, downloadFile, downloadText, resetDemo, storage } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { useRoute } from '../lib/router.jsx';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, Badge, Field, Input, Select, TextArea, NumberInput, Check, Segmented, Notice } from '../ui/kit.jsx';
import { Sheet, useAction, useFeedback } from '../ui/overlay.jsx';
import { initials } from '../lib/format.js';

const roleLabel = (r) => ROLES.find((x) => x.id === r)?.label || r;

export function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
}
applyTheme(storage.get('pf_theme'));

export default function SettingsPage() {
  const { isManager, isInstaller, user, demo } = useSession();
  const { anchor } = useRoute();
  useEffect(() => {
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }), 250);
  }, [anchor]);
  return (
    <Screen title={isInstaller ? 'Account' : 'Settings'}>
      <div className="page-head"><h1>{isInstaller ? 'Account' : 'Settings'}</h1></div>
      {isManager && <StoreSettings />}
      {isManager && <TeamPanel me={user} />}
      {!isInstaller && <CrewsPanel />}
      <AccountPanel />
      {isManager && !demo && <DataPanel />}
      {demo && <DemoPanel />}
    </Screen>
  );
}

function StoreSettings() {
  const { settings, setSettings } = useSession();
  const [f, setF] = useState(settings);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [run, busy] = useAction();
  const dirty = JSON.stringify(f) !== JSON.stringify(settings);
  const save = () => run(async () => setSettings(await api.put('/settings', f)), 'Settings saved');
  return (
    <>
      <Panel title="Store">
        <div className="panel-body">
          <p className="small muted">This prints at the top of quotes, invoices and purchase orders.</p>
          <Field label="Store name"><Input value={f.store_name} onChange={set('store_name')} /></Field>
          <Field label="Street address"><Input value={f.store_address} onChange={set('store_address')} /></Field>
          <div className="form-grid">
            <Field label="City"><Input value={f.store_city} onChange={set('store_city')} /></Field>
            <Field label="State"><Input value={f.store_state} onChange={set('store_state')} /></Field>
            <Field label="ZIP"><Input value={f.store_zip} onChange={set('store_zip')} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Phone"><Input value={f.store_phone} onChange={set('store_phone')} type="tel" /></Field>
            <Field label="Email"><Input value={f.store_email} onChange={set('store_email')} type="email" /></Field>
            <Field label="Website"><Input value={f.store_website} onChange={set('store_website')} /></Field>
          </div>
        </div>
      </Panel>
      <Panel title="Pricing and paperwork">
        <div className="panel-body">
          <div className="form-grid">
            <Field label="Sales tax rate" hint="Used on new quotes and orders"><NumberInput value={f.tax_rate} onChange={set('tax_rate')} suffix="%" /></Field>
            <Field label="Deposit" hint="Suggested when a quote is accepted"><NumberInput value={f.deposit_percent} onChange={set('deposit_percent')} suffix="%" /></Field>
            <Field label="Quotes are good for"><NumberInput value={f.quote_valid_days} onChange={set('quote_valid_days')} suffix="days" /></Field>
            <Field label="Invoices are due in" hint="0 means due on completion"><NumberInput value={f.invoice_due_days} onChange={set('invoice_due_days')} suffix="days" /></Field>
            <Field label="Remnant cutoff" hint="Roll pieces this short or shorter are remnants"><NumberInput value={f.remnant_max_ft} onChange={set('remnant_max_ft')} suffix="ft" /></Field>
          </div>
          <Field label="Terms on quotes"><TextArea value={f.quote_terms} onChange={set('quote_terms')} rows={4} /></Field>
          <Field label="Terms on invoices"><TextArea value={f.invoice_terms} onChange={set('invoice_terms')} rows={2} /></Field>
          <div><Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>Save settings</Button></div>
        </div>
      </Panel>
    </>
  );
}

function TeamPanel({ me }) {
  const users = useData('/users', { active: 'all' });
  const [editing, setEditing] = useState(null);
  return (
    <Panel title="Team" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setEditing({})}>Add person</Button>}>
      <div className="rows">
        {(users.data || []).map((u) => (
          <button key={u.id} type="button" className="row" onClick={() => setEditing(u)}>
            <span className="avatar" style={{ width: 36, height: 36, fontSize: 14 }}>{initials(u.name)}</span>
            <div className="row-main"><span className="row-title">{u.name}{u.id === me.id ? ' (you)' : ''}</span><span className="row-sub">{roleLabel(u.role)}{u.installer_name ? `, ${u.installer_name}` : ''}</span></div>
            {!u.active && <Badge tone="danger">Can’t sign in</Badge>}
          </button>
        ))}
      </div>
      <div className="row-more small muted">Everyone signs in by tapping their name and entering a PIN. Installers only see their own jobs.</div>
      {editing && <UserSheet user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); users.reload(); }} />}
    </Panel>
  );
}

function UserSheet({ user, onClose, onSaved }) {
  const isNew = !user.id;
  const { user: me } = useSession();
  const installers = useData('/installers');
  const [f, setF] = useState({ name: '', role: 'sales', email: '', phone: '', installer_id: '', active: true, pin: '', ...user, installer_id: user.installer_id || '', active: user.active === undefined ? true : !!user.active });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [pin, setPin] = useState('');
  const [run, busy] = useAction();
  const roles = ROLES.filter((r) => r.id !== 'admin' || me.role === 'admin');
  const save = () => run(async () => {
    const body = { ...f, installer_id: f.installer_id || null, active: f.active ? 1 : 0 };
    if (isNew) await api.post('/users', body); else await api.put(`/users/${user.id}`, body);
    onSaved();
  }, isNew ? 'Person added' : 'Saved');
  const resetPin = () => run(async () => { await api.post(`/users/${user.id}/pin`, { pin }); setPin(''); }, 'PIN changed');
  return (
    <Sheet title={isNew ? 'Add a person' : user.name} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>{isNew ? 'Add person' : 'Save'}</Button></>}>
      <Field label="Name"><Input value={f.name} onChange={set('name')} /></Field>
      <Field label="Role"><Select value={f.role} onChange={set('role')} options={roles.map((r) => ({ value: r.id, label: r.label }))} /></Field>
      {f.role === 'installer' && (
        <Field label="Crew" hint="They see jobs scheduled for this crew"><Select value={f.installer_id} onChange={set('installer_id')} placeholder="Choose a crew" options={(installers.data || []).map((i) => ({ value: i.id, label: i.name }))} /></Field>
      )}
      <div className="form-grid">
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} type="tel" /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} type="email" /></Field>
      </div>
      {isNew ? (
        <Field label="PIN" hint="4 to 8 digits. Share it with them in person."><Input value={f.pin} onChange={set('pin')} inputMode="numeric" type="password" autoComplete="new-password" /></Field>
      ) : (
        <>
          <Check checked={f.active} onChange={set('active')}>Can sign in</Check>
          <div className="stack">
            <h3>Reset PIN</h3>
            <div className="hstack">
              <div className="grow"><Input value={pin} onChange={setPin} inputMode="numeric" type="password" placeholder="New PIN" autoComplete="new-password" aria-label="New PIN" /></div>
              <Button icon={KeyRound} busy={busy} disabled={pin.length < 4} onClick={resetPin}>Set PIN</Button>
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

function CrewsPanel() {
  const crews = useData('/installers', { active: 'all' });
  const [editing, setEditing] = useState(null);
  return (
    <Panel id="crews" title="Installers and crews" action={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setEditing({})}>Add crew</Button>}>
      <div className="rows">
        {(crews.data || []).map((c) => (
          <button key={c.id} type="button" className="row" onClick={() => setEditing(c)}>
            <span className="row-lead" style={{ background: c.color }} />
            <div className="row-main"><span className="row-title">{c.name}</span><span className="row-sub">{[c.specialties, c.phone].filter(Boolean).join(', ')}</span></div>
            {!c.active && <Badge>Inactive</Badge>}
          </button>
        ))}
        {crews.data && !crews.data.length && <div className="list-empty">Add your installers or crews to schedule jobs.</div>}
      </div>
      {editing && <CrewSheet crew={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); crews.reload(); }} />}
    </Panel>
  );
}

const CREW_COLORS = ['#2f6f9f', '#7a5195', '#3d8361', '#c46b1f', '#a23b5a', '#4c6a92', '#8a7a2a', '#5b6b73'];

function CrewSheet({ crew, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', color: CREW_COLORS[0], specialties: '', notes: '', active: true, ...crew, active: crew.active === undefined ? true : !!crew.active });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [run, busy] = useAction();
  const save = () => run(async () => {
    const body = { ...f, active: f.active ? 1 : 0 };
    if (crew.id) await api.put(`/installers/${crew.id}`, body); else await api.post('/installers', body);
    onSaved();
  }, 'Crew saved');
  return (
    <Sheet title={crew.id ? crew.name : 'Add crew'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save crew</Button></>}>
      <Field label="Installer or crew name"><Input value={f.name} onChange={set('name')} /></Field>
      <div className="form-grid">
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} type="tel" /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} type="email" /></Field>
      </div>
      <Field label="What they install"><Input value={f.specialties} onChange={set('specialties')} placeholder="Carpet, LVP, stairs" /></Field>
      <div className="field">
        <span className="field-label">Calendar color</span>
        <div className="hstack wrap">
          {CREW_COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={f.color === c} onClick={() => set('color')(c)}
              style={{ width: 34, height: 34, borderRadius: '50%', background: c, border: f.color === c ? '3px solid var(--ink)' : '3px solid transparent', cursor: 'pointer' }} />
          ))}
        </div>
      </div>
      <Field label="Notes" hint="Insurance expiry, rates, availability"><TextArea value={f.notes} onChange={set('notes')} rows={2} /></Field>
      {crew.id && <Check checked={f.active} onChange={set('active')}>Available for new jobs</Check>}
    </Sheet>
  );
}

function AccountPanel() {
  const { user, signOut } = useSession();
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [theme, setTheme] = useState(storage.get('pf_theme') || 'system');
  const [run, busy] = useAction();
  const { toast } = useFeedback();
  const change = () => {
    if (pin !== pin2) { toast('The two PINs don’t match.', { tone: 'error' }); return; }
    run(async () => { await api.post('/me/pin', { pin }); setPin(''); setPin2(''); }, 'Your PIN was changed');
  };
  return (
    <Panel title="My account">
      <div className="panel-body">
        <div className="hstack"><span className="avatar">{initials(user.name)}</span><div><div className="strong">{user.name}</div><div className="small muted">{roleLabel(user.role)}</div></div></div>
        <Field label="Appearance">
          <Segmented label="Appearance" value={theme} onChange={(t) => { setTheme(t); storage.set('pf_theme', t === 'system' ? null : t); applyTheme(t); }}
            options={[{ value: 'system', label: 'Match device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Field>
        <div className="form-grid">
          <Field label="New PIN"><Input value={pin} onChange={setPin} inputMode="numeric" type="password" autoComplete="new-password" /></Field>
          <Field label="Type it again"><Input value={pin2} onChange={setPin2} inputMode="numeric" type="password" autoComplete="new-password" /></Field>
        </div>
        <div className="hstack wrap">
          <Button icon={KeyRound} busy={busy} disabled={pin.length < 4} onClick={change}>Change my PIN</Button>
          <Button variant="ghost" icon={LogOut} onClick={signOut}>Sign out</Button>
        </div>
      </div>
    </Panel>
  );
}

function DataPanel() {
  const [run, busy] = useAction();
  return (
    <Panel title="Backups">
      <div className="panel-body">
        <p className="small muted">Everything lives in one file on the computer running the app. Download a copy regularly and keep it somewhere safe.</p>
        <div className="hstack wrap">
          <Button icon={Database} busy={busy} onClick={() => run(() => downloadFile('/backup', `store-backup-${new Date().toISOString().slice(0, 10)}.db`), 'Backup downloaded')}>Download backup</Button>
          <Button icon={Download} busy={busy} onClick={() => run(async () => downloadText(JSON.stringify(await api.get('/admin/export'), null, 1), `store-export-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'), 'Export downloaded')}>Export all data (JSON)</Button>
        </div>
      </div>
    </Panel>
  );
}

function DemoPanel() {
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const reset = async () => {
    if (!(await confirm({ title: 'Start the demo over?', message: 'Your changes are erased and the sample store is loaded again.', confirmLabel: 'Reset demo' }))) return;
    run(async () => { await resetDemo(); window.dispatchEvent(new Event('pf:signed-out')); }, 'Demo reset');
  };
  return (
    <Panel title="Demo">
      <div className="panel-body">
        <Notice>This demo runs entirely in your browser with sample data. Changes are saved on this device only.</Notice>
        <div><Button icon={RotateCcw} busy={busy} onClick={reset}>Reset sample data</Button></div>
      </div>
    </Panel>
  );
}
