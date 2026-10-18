import { useEffect, useRef, useState } from 'react';
import {
  Home, FileText, ClipboardList, CalendarDays, Menu, Users, Boxes, Truck, Tag, Wallet, BarChart3, Settings, Plus,
  Search as SearchIcon, UserPlus, CalendarPlus, PackagePlus, HardHat, LogOut,
} from 'lucide-react';
import { Link, navigate, useRoute } from '../lib/router.jsx';
import { useSession } from '../lib/session.jsx';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { BrandMark, StoreName, Avatar } from './Brand.jsx';
import { BackButton, IconButton, Button, useDebounced } from './kit.jsx';
import { Sheet, useAction } from './overlay.jsx';
import { CustomerPicker, CustomerForm } from './pickers.jsx';

const STAFF_NAV = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/quotes', label: 'Quotes', icon: FileText },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays },
  { to: '/customers', label: 'Customers', icon: Users },
  { sep: true },
  { to: '/inventory', label: 'Inventory', icon: Boxes },
  { to: '/purchasing', label: 'Purchasing', icon: Truck },
  { to: '/products', label: 'Products', icon: Tag },
  { sep: true },
  { to: '/payments', label: 'Payments', icon: Wallet },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];
const INSTALLER_NAV = [
  { to: '/', label: 'My jobs', icon: HardHat },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays },
  { to: '/settings', label: 'Account', icon: Settings },
];

function isActive(to, path) {
  if (to === '/') return path === '/';
  return path === to || path.startsWith(`${to}/`);
}

export function Shell({ children }) {
  const { user, settings, isInstaller, signOut, demo } = useSession();
  const { path } = useRoute();
  const [creating, setCreating] = useState(false);
  const nav = isInstaller ? INSTALLER_NAV : STAFF_NAV;
  const tabs = isInstaller ? INSTALLER_NAV : [STAFF_NAV[0], STAFF_NAV[1], STAFF_NAV[2], STAFF_NAV[3], { to: '/more', label: 'More', icon: Menu }];
  const moreActive = !isInstaller && !tabs.slice(0, 4).some((t) => isActive(t.to, path));
  const printing = path.startsWith('/print/');
  const showFab = !isInstaller && path === '/';

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="side-brand">
          <BrandMark size={38} />
          <StoreName name={settings.store_name} />
        </div>
        {!isInstaller && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} className="btn-block" style={{ marginBottom: 10 }}>New</Button>}
        {nav.map((n, i) => (n.sep ? <div key={`s${i}`} className="side-sep" /> : (
          <Link key={n.to} to={n.to} className="side-link" aria-current={isActive(n.to, path) ? 'page' : undefined}>
            <n.icon aria-hidden="true" />{n.label}
          </Link>
        )))}
        <div className="side-foot">
          {demo && <span className="badge badge-warn" style={{ justifySelf: 'start' }}>Sample data</span>}
          <div className="hstack"><Avatar name={user?.name} size={32} /><span className="grow ellipsis">{user?.name}</span></div>
          <Button size="sm" variant="ghost" icon={LogOut} onClick={signOut}>Sign out</Button>
        </div>
      </nav>
      <div className={`main ${showFab ? 'has-fab' : ''}`}>
        {children}
      </div>
      {!printing && (
        <nav className="tabbar" aria-label="Main" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <Link key={t.to} to={t.to} className="tab" aria-current={(t.to === '/more' ? moreActive : isActive(t.to, path)) ? 'page' : undefined}>
              <t.icon aria-hidden="true" />{t.label}
            </Link>
          ))}
        </nav>
      )}
      {showFab && (
        <button type="button" className="fab" aria-label="Create new" onClick={() => setCreating(true)}><Plus aria-hidden="true" /></button>
      )}
      {creating && <CreateMenu onClose={() => setCreating(false)} />}
    </div>
  );
}

// Page frame: sticky top bar with back button, title, search and actions.
export function Screen({ title, back, actions, children, narrow, wide }) {
  const { settings, isInstaller } = useSession();
  const { path } = useRoute();
  const root = !back;
  useEffect(() => {
    document.title = `${title ? `${title} – ` : ''}${settings.store_name || 'Store Manager'}`;
  }, [title, settings.store_name]);
  return (
    <>
      <header className="topbar">
        {back && <BackButton fallback={back} />}
        <div className="topbar-title">
          {root ? (
            <>
              <span className="topbar-store topbar-store-mobile">{title}<small>{settings.store_name}</small></span>
              <span className="desk-only">{title}</span>
            </>
          ) : title}
        </div>
        {!isInstaller && <div className="topbar-search"><GlobalSearch /></div>}
        {actions}
        {root && !isInstaller && path !== '/search' && (
          <span className="topbar-store-mobile"><IconButton icon={SearchIcon} label="Search" onClick={() => navigate('/search')} /></span>
        )}
      </header>
      <main className={`page ${narrow ? 'page-narrow' : ''}`} style={wide ? { maxWidth: 1280 } : undefined}>
        {children}
      </main>
    </>
  );
}

export function GlobalSearch({ autoFocus, inline }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState(null);
  const dq = useDebounced(q, 200);
  const box = useRef(null);
  useEffect(() => {
    let live = true;
    if (dq.trim().length < 2) { setRes(null); return undefined; }
    api.get('/search', { q: dq }).then((r) => { if (live) setRes(r); }).catch(() => {});
    return () => { live = false; };
  }, [dq]);
  useEffect(() => {
    if (inline) return undefined;
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [inline]);
  const go = (to) => { setOpen(false); setQ(''); navigate(to); };
  const groups = res ? [
    ['Customers', res.customers.map((c) => ({ key: `c${c.id}`, to: `/customers/${c.id}`, title: c.display_name, sub: [c.phone, c.city].filter(Boolean).join(', ') }))],
    ['Orders', res.orders.map((o) => ({ key: `o${o.id}`, to: `/orders/${o.id}`, title: `${o.number} ${o.customer_name}`, sub: o.title, right: money(o.total) }))],
    ['Quotes', res.quotes.map((o) => ({ key: `q${o.id}`, to: `/quotes/${o.id}`, title: `${o.number} ${o.customer_name}`, sub: o.title, right: money(o.total) }))],
    ['Products', res.products.map((p) => ({ key: `p${p.id}`, to: `/products/${p.id}`, title: [p.manufacturer, p.style, p.color].filter(Boolean).join(' '), sub: p.sku, right: money(p.price) }))],
    ['Purchase orders', res.pos.map((p) => ({ key: `po${p.id}`, to: `/purchasing/${p.id}`, title: p.number, sub: p.vendor_name }))],
  ].filter(([, items]) => items.length) : [];
  const results = (
    <div className={inline ? 'stack' : 'panel'} style={inline ? undefined : { position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 40, boxShadow: 'var(--shadow)', maxHeight: '70vh', overflowY: 'auto' }}>
      {groups.length === 0 && <div className="list-empty">{dq.trim().length < 2 ? 'Type at least two letters.' : 'Nothing found. Try a phone number, last name, or order number.'}</div>}
      {groups.map(([label, items]) => (
        <div key={label} className={inline ? 'panel' : ''}>
          <div className="day-head">{label}</div>
          <div className="rows">
            {items.map((it) => (
              <button key={it.key} type="button" className="row" onClick={() => go(it.to)}>
                <div className="row-main"><span className="row-title">{it.title}</span>{it.sub && <span className="row-sub">{it.sub}</span>}</div>
                {it.right && <span className="row-amount small">{it.right}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div ref={box} style={{ position: 'relative' }} className={inline ? 'stack' : ''}>
      <div className="search">
        <SearchIcon aria-hidden="true" />
        <input className="input" type="search" placeholder="Search customers, orders, quotes, products" value={q} autoFocus={autoFocus}
          aria-label="Search" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} enterKeyHint="search" autoComplete="off" />
      </div>
      {(inline || (open && q.trim().length > 0)) && results}
    </div>
  );
}

function CreateMenu({ onClose }) {
  const [step, setStep] = useState(null);
  const [run] = useAction();
  if (step === 'quote' || step === 'order') {
    return (
      <CustomerPicker title={step === 'quote' ? 'New quote for…' : 'New order for…'} onClose={onClose}
        onPick={(c) => run(async () => {
          const doc = await api.post(step === 'quote' ? '/quotes' : '/orders', { customer_id: c.id });
          onClose();
          navigate(`/${step === 'quote' ? 'quotes' : 'orders'}/${doc.id}`);
        })} />
    );
  }
  if (step === 'customer') {
    return <CustomerForm onClose={onClose} onSaved={(c) => { onClose(); navigate(`/customers/${c.id}`); }} />;
  }
  const items = [
    { key: 'quote', icon: FileText, label: 'New quote', hint: 'Measure rooms and price a job' },
    { key: 'order', icon: ClipboardList, label: 'New order', hint: 'Cash-and-carry or an order without a quote' },
    { key: 'customer', icon: UserPlus, label: 'New customer' },
    { key: 'appt', icon: CalendarPlus, label: 'Schedule a measure or install', to: '/schedule?new=1' },
    { key: 'stock', icon: PackagePlus, label: 'Add stock to inventory', to: '/inventory?add=1' },
  ];
  return (
    <Sheet title="Create" onClose={onClose}>
      <div className="menu">
        {items.map((it) => (
          <button key={it.key} type="button" className="menu-item" onClick={() => { if (it.to) { onClose(); navigate(it.to); } else setStep(it.key); }}>
            <it.icon aria-hidden="true" />
            <span className="grow"><span className="strong">{it.label}</span>{it.hint && <span className="row-sub" style={{ display: 'block' }}>{it.hint}</span>}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
