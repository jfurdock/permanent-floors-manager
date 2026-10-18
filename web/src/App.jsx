import { useEffect, useLayoutEffect } from 'react';
import { SessionProvider, useSession } from './lib/session.jsx';
import { useRoute, match, lastNavigation, savedScroll } from './lib/router.jsx';
import { FeedbackProvider } from './ui/overlay.jsx';
import { Shell } from './ui/Shell.jsx';
import { Loading, ErrorNote, Empty } from './ui/kit.jsx';
import Login, { AccessCode } from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import { CustomersPage, CustomerPage } from './pages/Customers.jsx';
import { QuotesPage } from './pages/Quotes.jsx';
import QuotePage from './pages/QuoteEditor.jsx';
import { OrdersPage } from './pages/Orders.jsx';
import OrderPage from './pages/OrderDetail.jsx';
import SchedulePage from './pages/Schedule.jsx';
import InventoryPage from './pages/Inventory.jsx';
import { PurchasingPage, PoPage, VendorPage } from './pages/Purchasing.jsx';
import { ProductsPage, ProductPage } from './pages/Products.jsx';
import PaymentsPage from './pages/Payments.jsx';
import ReportsPage from './pages/Reports.jsx';
import SettingsPage from './pages/Settings.jsx';
import { MorePage, SearchPage } from './pages/More.jsx';
import JobPage from './pages/Job.jsx';
import PrintPage from './pages/Print.jsx';
import { Screen } from './ui/Shell.jsx';

const ROUTES = [
  ['/', Home],
  ['/search', SearchPage],
  ['/more', MorePage],
  ['/customers', CustomersPage],
  ['/customers/:id', CustomerPage],
  ['/quotes', QuotesPage],
  ['/quotes/:id', QuotePage],
  ['/orders', OrdersPage],
  ['/orders/:id', OrderPage],
  ['/jobs/:id', JobPage],
  ['/schedule', SchedulePage],
  ['/inventory', InventoryPage],
  ['/purchasing', PurchasingPage],
  ['/purchasing/:id', PoPage],
  ['/vendors/:id', VendorPage],
  ['/products', ProductsPage],
  ['/products/:id', ProductPage],
  ['/payments', PaymentsPage],
  ['/reports', ReportsPage],
  ['/settings', SettingsPage],
  ['/print/:kind/:id', PrintPage],
];

const INSTALLER_ROUTES = ['/', '/schedule', '/settings', '/jobs/:id'];

function Router() {
  const { path, query, full } = useRoute();
  const { isInstaller } = useSession();
  useLayoutEffect(() => {
    if (lastNavigation() === 'back') {
      const y = savedScroll(full);
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else window.scrollTo(0, 0);
  }, [full]);
  for (const [pattern, Page] of ROUTES) {
    const params = match(pattern, path);
    if (params && isInstaller && !INSTALLER_ROUTES.includes(pattern)) {
      return (
        <Screen title="My jobs" back="/">
          <Empty title="This page is for the office">Your jobs, schedule and account are in the menu below.</Empty>
        </Screen>
      );
    }
    if (params) return <Page key={path} params={params} query={query} />;
  }
  return (
    <Screen title="Not found" back="/">
      <Empty title="This page doesn’t exist">Use the menu to find what you need.</Empty>
    </Screen>
  );
}

function Gate() {
  const session = useSession();
  useEffect(() => {
    if (session.settings?.store_name) document.title = session.settings.store_name;
  }, [session.settings?.store_name]);
  if (session.status === 'loading') return <div className="login"><Loading plain label={__DEMO__ ? 'Setting up the demo store…' : 'Loading…'} /></div>;
  if (session.status === 'error') return <div className="login"><div className="login-box"><ErrorNote error={session.error} retry={session.refresh} /></div></div>;
  if (session.status === 'access') return <AccessCode onDone={session.refresh} />;
  if (session.status === 'signed-out') return <Login />;
  return <Shell><Router /></Shell>;
}

export default function App() {
  return (
    <SessionProvider>
      <FeedbackProvider>
        <Gate />
      </FeedbackProvider>
    </SessionProvider>
  );
}
