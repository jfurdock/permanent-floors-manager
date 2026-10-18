import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { QUOTE_STATUSES } from '@core/calc.js';
import { api } from '../lib/api.js';
import { useData } from '../lib/data.js';
import { Link, navigate } from '../lib/router.jsx';
import { money, date } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Button, Badge, Loading, ErrorNote, Empty, SearchBox, Chips, useDebounced } from '../ui/kit.jsx';
import { useAction } from '../ui/overlay.jsx';
import { CustomerPicker } from '../ui/pickers.jsx';

export const quoteStatusLabel = (s) => QUOTE_STATUSES.find((x) => x.id === s)?.label || s;

export function QuotesPage({ query }) {
  const [status, setStatus] = useState(query.status || 'open');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useData('/quotes', { status: status === 'all' ? '' : status, q: dq });
  const [picking, setPicking] = useState(false);
  const [run] = useAction();
  const create = (c) => run(async () => {
    const quote = await api.post('/quotes', { customer_id: c.id });
    navigate(`/quotes/${quote.id}`);
  });
  const total = (data || []).reduce((s, x) => s + x.total, 0);
  return (
    <Screen title="Quotes">
      <div className="page-head">
        <div>
          <h1>Quotes</h1>
          {data && <div className="page-sub">{data.length} {data.length === 1 ? 'quote' : 'quotes'}, {money(total)}</div>}
        </div>
        <div className="page-actions"><Button variant="primary" icon={Plus} onClick={() => setPicking(true)}>New quote</Button></div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Customer, quote number, or job" />
      <Chips value={status} onChange={setStatus} options={[
        { value: 'open', label: 'Open' }, { value: 'draft', label: 'Drafts' }, { value: 'sent', label: 'Sent' },
        { value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Lost' }, { value: 'all', label: 'All' },
      ]} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="panel rows">
          {(data || []).map((x) => (
            <Link key={x.id} to={`/quotes/${x.id}`} className="row">
              <div className="row-main">
                <span className="row-title">{x.customer_name}</span>
                <span className="row-sub">{[x.number, x.title].filter(Boolean).join(' ')}, {date(x.quote_date || x.created_at)}{x.sales_rep_name ? `, ${x.sales_rep_name}` : ''}</span>
              </div>
              <div className="row-meta">
                <span className="row-amount">{money(x.total)}</span>
                <Badge status={x.status}>{quoteStatusLabel(x.status)}</Badge>
              </div>
            </Link>
          ))}
          {data && !data.length && (
            <Empty icon={FileText} title="No quotes here" action={<Button icon={Plus} onClick={() => setPicking(true)}>Start a quote</Button>}>
              Start a quote, measure the rooms, and the calculator works out carpet, pad and labor.
            </Empty>
          )}
        </div>
      )}
      {picking && <CustomerPicker title="New quote for…" onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); create(c); }} />}
    </Screen>
  );
}
