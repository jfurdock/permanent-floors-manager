import { Users, Boxes, Truck, Tag, Wallet, BarChart3, Settings, Scissors, LogOut } from 'lucide-react';
import { Link } from '../lib/router.jsx';
import { useSession } from '../lib/session.jsx';
import { Screen, GlobalSearch } from '../ui/Shell.jsx';
import { Panel } from '../ui/kit.jsx';

const ITEMS = [
  { to: '/customers', icon: Users, label: 'Customers', hint: 'Contact info, history and balances' },
  { to: '/inventory', icon: Boxes, label: 'Inventory', hint: 'Rolls, boxes and what’s on the shelf' },
  { to: '/inventory?remnants=1', icon: Scissors, label: 'Remnants', hint: 'Short pieces ready to sell' },
  { to: '/purchasing', icon: Truck, label: 'Purchasing', hint: 'Purchase orders, receiving and vendors' },
  { to: '/products', icon: Tag, label: 'Products', hint: 'Catalog, prices and labor rates' },
  { to: '/payments', icon: Wallet, label: 'Payments', hint: 'Today’s money and the card batch' },
  { to: '/reports', icon: BarChart3, label: 'Reports', hint: 'Sales, margin, money owed and close rate' },
  { to: '/settings', icon: Settings, label: 'Settings', hint: 'Store details, team, crews and your PIN' },
];

export function MorePage() {
  const { signOut, user } = useSession();
  return (
    <Screen title="More">
      <Panel>
        <div className="menu" style={{ padding: '0 14px' }}>
          {ITEMS.map((it) => (
            <Link key={it.to} to={it.to} className="menu-item">
              <it.icon aria-hidden="true" />
              <span className="grow"><span className="strong">{it.label}</span><span className="row-sub" style={{ display: 'block' }}>{it.hint}</span></span>
            </Link>
          ))}
          <button type="button" className="menu-item" onClick={signOut}><LogOut aria-hidden="true" /><span className="grow">Sign out <span className="muted">({user?.name})</span></span></button>
        </div>
      </Panel>
    </Screen>
  );
}

export function SearchPage() {
  return (
    <Screen title="Search" back="/">
      <GlobalSearch autoFocus inline />
    </Screen>
  );
}
