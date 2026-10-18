import { useState } from 'react';
import { Wallet, Download } from 'lucide-react';
import { PAYMENT_METHODS } from '@core/calc.js';
import { addDays, toCsv } from '@core/util.js';
import { useData } from '../lib/data.js';
import { downloadText } from '../lib/api.js';
import { Link } from '../lib/router.jsx';
import { money, date, todayStr, parseDate } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, Loading, ErrorNote, Empty, Chips, Field, Input, Figures } from '../ui/kit.jsx';

export function presetRange(preset, today = todayStr()) {
  const d = parseDate(today);
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'week': return { from: addDays(today, -((d.getDay() + 6) % 7)), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last_month': {
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const last = new Date(d.getFullYear(), d.getMonth(), 0);
      return { from: iso(first), to: iso(last) };
    }
    case '90': return { from: addDays(today, -89), to: today };
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default: return null;
  }
}

export function RangePicker({ value, onChange, presets = ['today', 'week', 'month', 'last_month', '90', 'year'] }) {
  const labels = { today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', last_month: 'Last month', 90: 'Last 90 days', year: 'This year', custom: 'Pick dates' };
  return (
    <div className="stack">
      <Chips value={value.preset} onChange={(p) => onChange(p === 'custom' ? { ...value, preset: 'custom' } : { preset: p, ...presetRange(p) })}
        options={[...presets, 'custom'].map((p) => ({ value: p, label: labels[p] }))} label="Date range" />
      {value.preset === 'custom' && (
        <div className="form-grid" style={{ maxWidth: 420 }}>
          <Field label="From"><Input type="date" value={value.from} onChange={(v) => onChange({ ...value, from: v })} /></Field>
          <Field label="To"><Input type="date" value={value.to} onChange={(v) => onChange({ ...value, to: v })} /></Field>
        </div>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  const [range, setRange] = useState({ preset: 'today', ...presetRange('today') });
  const { data, error, loading, reload } = useData('/payments', { from: range.from, to: range.to });
  const exportCsv = () => downloadText(toCsv(data.payments, [
    { label: 'Date', key: 'date' }, { label: 'Order', key: 'order_number' }, { label: 'Customer', key: 'customer_name' },
    { label: 'Method', key: 'method' }, { label: 'Reference', key: 'reference' }, { label: 'Amount', key: 'amount' }, { label: 'Taken by', key: 'user_name' }, { label: 'Note', key: 'note' },
  ]), `payments-${range.from}-to-${range.to}.csv`);
  return (
    <Screen title="Payments">
      <div className="page-head">
        <div><h1>Payments</h1><div className="page-sub">Money taken, for closing out the drawer and the card batch</div></div>
        {!__DEMO__ && data?.payments.length > 0 && <div className="page-actions"><Button icon={Download} onClick={exportCsv}>Export CSV</Button></div>}
      </div>
      <RangePicker value={range} onChange={setRange} presets={['today', 'yesterday', 'week', 'month', 'last_month']} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel>
            <Figures items={[
              { label: 'Total', value: money(data.total), note: `${data.payments.length} payments` },
              ...PAYMENT_METHODS.filter((m) => data.by_method[m.id]).map((m) => ({ label: m.label, value: money(data.by_method[m.id]) })),
            ]} />
          </Panel>
          <Panel title={range.from === range.to ? date(range.from) : `${date(range.from)} to ${date(range.to)}`}>
            <div className="rows">
              {data.payments.map((p) => (
                <Link key={p.id} to={`/orders/${p.order_id}`} className="row">
                  <div className="row-main">
                    <span className="row-title">{p.customer_name}</span>
                    <span className="row-sub">{[p.order_number, date(p.date), PAYMENT_METHODS.find((m) => m.id === p.method)?.label, p.reference && `#${p.reference}`, p.user_name].filter(Boolean).join(', ')}</span>
                  </div>
                  <span className="row-amount">{money(p.amount)}</span>
                </Link>
              ))}
              {!data.payments.length && <Empty icon={Wallet} title="No payments in this range">Payments taken on orders show up here.</Empty>}
            </div>
          </Panel>
        </>
      )}
    </Screen>
  );
}
