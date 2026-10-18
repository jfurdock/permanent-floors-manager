import { useCallback, useEffect, useState } from 'react';
import { Delete, ChevronRight, LockKeyhole } from 'lucide-react';
import { ROLES } from '@core/calc.js';
import { DEMO_USERS } from '@core/seed.js';
import { api, enterAccessCode } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Button, Field, Input, Notice, Loading, ErrorNote } from '../ui/kit.jsx';
import { BrandMark, StoreName, Avatar } from '../ui/Brand.jsx';

const roleLabel = (r) => ROLES.find((x) => x.id === r)?.label || r;

function Frame({ storeName, children, sub }) {
  return (
    <div className="login">
      <div className="login-box">
        <div className="login-brand">
          <BrandMark size={52} />
          <StoreName name={storeName} className="login-name" />
          {sub && <p className="login-sub">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function AccessCode({ onDone }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await enterAccessCode(code); await onDone(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Frame storeName="Permanent Floors Carpet One" sub="Enter the store code to use this device. You only need to do this once.">
      <form className="login-card stack" onSubmit={submit}>
        <Field label="Store code">
          <Input value={code} onChange={setCode} autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button variant="primary" block busy={busy} type="submit" icon={LockKeyhole} disabled={!code.trim()}>Continue</Button>
      </form>
      <p className="login-foot">Don’t have the code? Ask the store owner.</p>
    </Frame>
  );
}

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

  if (error) return <Frame storeName="Store Manager"><ErrorNote error={error} retry={load} /></Frame>;
  if (!info) return <div className="login"><Loading plain label={__DEMO__ ? 'Setting up the demo store…' : 'Loading…'} /></div>;
  if (info.setup_needed) return <Setup onDone={signIn} storeName={info.store_name} />;
  const sample = __DEMO__ || info.demo;

  if (person) {
    return (
      <Frame storeName={info.store_name}>
        <PinEntry person={person} onBack={() => setPerson(null)} onDone={signIn} hint={sample ? DEMO_USERS.find((u) => u.name === person.name)?.pin : null} />
      </Frame>
    );
  }
  return (
    <Frame storeName={info.store_name} sub="Tap your name to sign in.">
      <div className="login-card people">
        {info.users.map((u) => (
          <button key={u.id} type="button" className="person" onClick={() => setPerson(u)}>
            <Avatar name={u.name} />
            <span className="grow"><span className="person-name">{u.name}</span><span className="small muted">{roleLabel(u.role)}</span></span>
            <ChevronRight size={18} className="faint" aria-hidden="true" />
          </button>
        ))}
      </div>
      {sample && (
        <div className="demo-hint">
          <b>This store is filled with sample data.</b> Sign in as Ryan with PIN 1234 to see everything,
          or as Luis with 5555 to see what an installer sees. Other PINs: {DEMO_USERS.filter((u) => !['Ryan', 'Luis'].includes(u.name.split(' ')[0])).map((u) => `${u.name.split(' ')[0]} ${u.pin}`).join(', ')}.
        </div>
      )}
    </Frame>
  );
}

function PinEntry({ person, onBack, onDone, hint }) {
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

  const press = useCallback((d) => { setError(null); setPin((p) => (p.length >= 8 ? p : p + d)); }, []);
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
    <div className="login-card stack-lg">
      <div className="pin-who">
        <Avatar name={person.name} size={48} />
        <div className="grow">
          <div className="person-name">{person.name}</div>
          <button type="button" className="link-btn small" onClick={onBack}>Not you?</button>
        </div>
      </div>
      <div className={`pin-dots ${error ? 'pin-error' : ''}`} aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: dots }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : hint ? <p className="small muted center">Sample PIN: {hint}</p> : <p className="small muted center">Enter your PIN</p>}
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="key" onClick={() => press(d)}>{d}</button>
        ))}
        <span />
        <button type="button" className="key" onClick={() => press('0')}>0</button>
        <button type="button" className="key key-quiet" aria-label="Delete digit" onClick={() => setPin((p) => p.slice(0, -1))}><Delete aria-hidden="true" /></button>
      </div>
      <Button variant="primary" block busy={busy} disabled={pin.length < 4} onClick={() => submit(pin)}>Sign in</Button>
    </div>
  );
}

function Setup({ onDone, storeName }) {
  const [f, setF] = useState({ store_name: storeName || 'Permanent Floors Carpet One', name: '', pin: '', pin2: '' });
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
    <Frame storeName={f.store_name} sub="Create the owner account. You can add your team after this.">
      <form className="login-card stack" onSubmit={submit}>
        <Field label="Store name"><Input value={f.store_name} onChange={set('store_name')} /></Field>
        <Field label="Your name"><Input value={f.name} onChange={set('name')} autoComplete="name" /></Field>
        <div className="form-grid">
          <Field label="Choose a PIN" hint="4 to 8 digits"><Input type="password" inputMode="numeric" value={f.pin} onChange={set('pin')} autoComplete="new-password" /></Field>
          <Field label="Type it again"><Input type="password" inputMode="numeric" value={f.pin2} onChange={set('pin2')} autoComplete="new-password" /></Field>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button variant="primary" block busy={busy} type="submit">Create owner account</Button>
      </form>
    </Frame>
  );
}
