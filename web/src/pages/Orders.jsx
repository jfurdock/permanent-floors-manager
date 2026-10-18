import { useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { ORDER_STAGES } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { Link, navigate } from '../lib/router.jsx';
import { money, date } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Button, Badge, Loading, ErrorNote, Empty, SearchBox, Chips, useDebounced } from '../ui/kit.jsx';
import { useAction } from '../ui/overlay.jsx';
import { CustomerPicker } from '../ui/pickers.jsx';

export const stageLabel = (s) => (s === 'cancelled' ? 'Cancelled' : ORDER_STAGES.find((x) => x.id === s)?.label || s);

export function OrdersPage({ query }) {
  const [stage, setStage] = useState(query.stage || 'open');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useData('/orders', { stage: stage === 'all' ? '' : stage, q: dq });
  const [picking, setPicking] = useState(false);
  const [run] = useAction();
  const create = (c) => run(async () => {
    const o = await api.post('/orders', { customer_id: c.id });
    navigate(`/orders/${o.id}`);
  });
  const total = (data || []).reduce((s, x) => s + x.total, 0);
  const balance = (data || []).reduce((s, x) => s + (x.invoiced_at ? x.balance : 0), 0);
  return (
    <Screen title="Orders">
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          {data && <div className="page-sub">{data.length} {data.length === 1 ? 'order' : 'orders'}, {money(total)}{balance > 0 ? `, ${money(balance)} invoiced and unpaid` : ''}</div>}
        </div>
        <div className="page-actions"><Button variant="primary" icon={Plus} onClick={() => setPicking(true)}>New order</Button></div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Customer, order, invoice, or PO number" />
      <Chips value={stage} onChange={setStage} options={[
        { value: 'open', label: 'Open' },
        ...ORDER_STAGES.filter((s) => s.id !== 'paid').map((s) => ({ value: s.id, label: s.label })),
        { value: 'balance', label: 'Balance due' },
        { value: 'paid', label: 'Paid' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'all', label: 'All' },
      ]} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="panel rows">
          {(data || []).map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="row">
              <div className="row-main">
                <span className="row-title">{o.customer_name}</span>
                <span className="row-sub">
                  {[o.number, o.title].filter(Boolean).join(' ')}
                  {o.install_date ? `, install ${date(o.install_date)}` : `, ordered ${date(o.order_date)}`}
                </span>
              </div>
              <div className="row-meta">
                <span className="row-amount">{money(o.total)}</span>
                <span className="hstack" style={{ gap: 4 }}>
                  {o.waiting_lines > 0 && ['new', 'ordered'].includes(o.stage) && <Badge tone="warn">{o.waiting_lines} waiting</Badge>}
                  {o.invoiced_at && o.balance > 0.004 ? <Badge tone="danger">{money(o.balance)} due</Badge> : <Badge status={o.stage}>{stageLabel(o.stage)}</Badge>}
                </span>
              </div>
            </Link>
          ))}
          {data && !data.length && (
            <Empty icon={ClipboardList} title="No orders here">Orders are created when a customer accepts a quote. You can also start one directly.</Empty>
          )}
        </div>
      )}
      {picking && <CustomerPicker title="New order for…" onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); create(c); }} />}
    </Screen>
  );
}
