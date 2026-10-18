import { useCallback, useEffect, useState } from 'react';
import { Delete, ChevronLeft } from 'lucide-react';
import { ROLES } from '@core/calc.js';
import { DEMO_USERS } from '@core/seed.js';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { initials } from '../lib/format.js';
import { Button, Field, Input, Notice, Loading, ErrorNote } from '../ui/kit.jsx';

const roleLabel = (r) => ROLES.find((x) => x.id === r)?.label || r;

export default function Login() {
  const { signIn } = useSession();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [person, setPerson] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.get('/auth/users').then(setInfo).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="login"><div className="login-box"><ErrorNote error={error} retry={load} /></div></div>;
  if (!info) return <div className="login"><Loading label={__DEMO__ ? 'Setting up the demo store…' : 'Loading…'} /></div>;
  if (info.setup_needed) return <Setup onDone={signIn} />;

  return (
    <div className="login">
      <div className="login-box">
        <div className="login-brand">
          <b>{info.store_name}</b>
          <span>{person ? `Enter your PIN, ${person.name.split(' ')[0]}.` : 'Who’s signing in?'}</span>
        </div>
        {person ? <PinEntry person={person} onBack={() => setPerson(null)} onDone={signIn} /> : (
          <>
            <div className="people">
              {info.users.map((u) => (
                <button key={u.id} type="button" className="person" onClick={() => setPerson(u)}>
                  <span className="avatar">{initials(u.name)}</span>
                  <span className="grow"><span className="strong" style={{ display: 'block' }}>{u.name}</span><span className="small muted">{roleLabel(u.role)}</span></span>
                </button>
              ))}
            </div>
            {__DEMO__ && (
              <div className="demo-hint">
                This is a demo with sample data. PINs: {DEMO_USERS.map((u) => `${u.name.split(' ')[0]} ${u.pin}`).join(', ')}.
                Try Luis to see the installer view.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PinEntry({ person, onBack, onDone }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = useCallback(async (value) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/auth/login', { user_id: person.id, pin: value });
      await onDone(res.token);
    } catch (e) {
      setError(e.message);
      setPin('');
    } finally { setBusy(false); }
  }, [busy, person.id, onDone]);

  const press = useCallback((d) => setPin((p) => (p.length >= 8 ? p : p + d)), []);
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit(pin);
      else if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pin, press, submit, onBack]);

  const dots = Math.max(4, pin.length);
  return (
    <div className="stack-lg">
      <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: dots }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="key" onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className="key key-quiet" onClick={onBack}><ChevronLeft size={18} aria-hidden="true" /> Back</button>
        <button type="button" className="key" onClick={() => press('0')}>0</button>
        <button type="button" className="key key-quiet" aria-label="Delete digit" onClick={() => setPin((p) => p.slice(0, -1))}><Delete aria-hidden="true" /></button>
      </div>
      <Button variant="primary" block busy={busy} disabled={pin.length < 4} onClick={() => submit(pin)}>Sign in</Button>
    </div>
  );
}

function Setup({ onDone }) {
  const [f, setF] = useState({ store_name: 'Permanent Floors Carpet One', name: '', pin: '', pin2: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (f.pin !== f.pin2) { setError('The two PINs don’t match.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/auth/setup', { store_name: f.store_name, name: f.name, pin: f.pin });
      await onDone(res.token);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <div className="login-brand">
          <b>Set up your store</b>
          <span>Create the owner account. You can add your team after this.</span>
        </div>
        <Field label="Store name"><Input value={f.store_name} onChange={set('store_name')} /></Field>
        <Field label="Your name"><Input value={f.name} onChange={set('name')} autoComplete="name" /></Field>
        <div className="form-grid">
          <Field label="Choose a PIN" hint="4 to 8 digits"><Input type="password" inputMode="numeric" value={f.pin} onChange={set('pin')} autoComplete="new-password" /></Field>
          <Field label="Type it again"><Input type="password" inputMode="numeric" value={f.pin2} onChange={set('pin2')} autoComplete="new-password" /></Field>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button variant="primary" block busy={busy} type="submit">Create owner account</Button>
      </form>
    </div>
  );
}
