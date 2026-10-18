import { useState } from 'react';
import { Download } from 'lucide-react';
import { toCsv } from '@core/util.js';
import { useData } from '../lib/data.js';
import { downloadText } from '../lib/api.js';
import { Link } from '../lib/router.jsx';
import { money, money0, pct, num, date, parseDate } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Button, Loading, ErrorNote, Chips, Segmented, Figures, Badge } from '../ui/kit.jsx';
import { BarChart, Meter } from '../ui/Chart.jsx';
import { RangePicker, presetRange } from './Payments.jsx';

const short$ = (v) => (v >= 1000 ? `$${num(v / 1000, 1)}k` : `$${Math.round(v)}`);

function CsvButton({ rows, columns, name }) {
  if (__DEMO__ || !rows?.length) return null;
  return <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadText(toCsv(rows, columns), `${name}.csv`)}>CSV</Button>;
}

function SalesTable({ title, column, rows, name }) {
  const max = Math.max(1, ...rows.map((r) => r.net));
  return (
    <Panel title={title} action={<CsvButton rows={rows} name={name} columns={[{ label: title, key: 'label' }, { label: 'Net sales', key: 'net' }, { label: 'Cost', key: 'cost' }, { label: 'Gross profit', key: 'profit' }, { label: 'Margin %', key: 'margin' }]} />}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{column}</th><th className="r">Net sales</th><th className="r">Profit</th><th className="r">Margin</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ minWidth: 140 }}><div className="stack" style={{ gap: 4 }}><span>{r.label}</span><Meter value={r.net} max={max} /></div></td>
                <td className="r">{money0(r.net)}</td>
                <td className="r">{money0(r.profit)}</td>
                <td className="r">{pct(r.margin)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted">No sales in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Sales() {
  const [range, setRange] = useState({ preset: 'year', ...presetRange('year') });
  const [basis, setBasis] = useState('booked');
  const { data, error, loading, reload } = useData('/reports/sales', { from: range.from, to: range.to, basis });
  const months = (data?.by_month || []).map((m) => ({ label: parseDate(`${m.key}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), short: parseDate(`${m.key}-01`).toLocaleDateString('en-US', { month: 'short' }), value: m.net }));
  return (
    <div className="stack-lg">
      <div className="stack">
        <RangePicker value={range} onChange={setRange} />
        <Segmented label="Count sales when" value={basis} onChange={setBasis} options={[{ value: 'booked', label: 'Order is placed' }, { value: 'invoiced', label: 'Invoice is sent' }]} />
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel>
            <Figures items={[
              { label: 'Net sales', value: money0(data.totals.net), note: 'After discounts, before tax' },
              { label: 'Gross profit', value: money0(data.totals.profit) },
              { label: 'Margin', value: pct(data.totals.margin) },
              { label: 'Orders', value: num(data.totals.count), note: data.totals.count ? `${money0(data.totals.net / data.totals.count)} average` : null },
            ]} />
          </Panel>
          {months.length > 0 && (
            <Panel title="Net sales by month">
              <div className="panel-body"><BarChart data={months} format={short$} label="Net sales by month" /></div>
            </Panel>
          )}
          <div className="cols">
            <SalesTable title="By salesperson" column="Salesperson" rows={data.by_rep} name="sales-by-salesperson" />
            <SalesTable title="By customer type" column="Customer type" rows={data.by_type} name="sales-by-customer-type" />
          </div>
          <SalesTable title="By category" column="Category" rows={data.by_category} name="sales-by-category" />
          <p className="xs faint">Category totals are before order-level discounts.</p>
        </>
      )}
    </div>
  );
}

function Receivables() {
  const { data, error, loading, reload } = useData('/reports/ar');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} retry={reload} />;
  const b = data.buckets;
  return (
    <div className="stack-lg">
      <Panel>
        <Figures items={[
          { label: 'Total owed', value: money0(data.total) },
          { label: 'Not yet due', value: money0(b.current) },
          { label: '1 to 30 days late', value: money0(b['1_30']) },
          { label: '31 to 60', value: money0(b['31_60']) },
          { label: '61 to 90', value: money0(b['61_90']) },
          { label: 'Over 90', value: money0(b['90_plus']) },
        ]} />
      </Panel>
      <Panel title="Unpaid invoices" action={<CsvButton rows={data.rows} name="unpaid-invoices" columns={[{ label: 'Invoice', key: 'invoice_number' }, { label: 'Customer', key: 'customer_name' }, { label: 'Phone', key: 'phone' }, { label: 'Invoiced', key: 'invoiced_at' }, { label: 'Due', key: 'due_date' }, { label: 'Days late', key: 'days_past_due' }, { label: 'Balance', key: 'balance' }]} />}>
        <div className="rows">
          {data.rows.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="row">
              <div className="row-main">
                <span className="row-title">{o.customer_name}</span>
                <span className="row-sub">{o.invoice_number}, invoiced {date(o.invoiced_at)}{o.phone ? `, ${o.phone}` : ''}</span>
              </div>
              <div className="row-meta">
                <span className="row-amount">{money(o.balance)}</span>
                {o.days_past_due > 0 ? <Badge tone={o.days_past_due > 30 ? 'danger' : 'warn'}>{o.days_past_due} days late</Badge> : <Badge>Not due</Badge>}
              </div>
            </Link>
          ))}
          {!data.rows.length && <div className="list-empty">No unpaid invoices.</div>}
        </div>
      </Panel>
      <Panel title={`Deposits held, ${money0(data.deposits_total)}`}>
        <div className="rows">
          {data.deposits.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="row">
              <div className="row-main"><span className="row-title">{o.customer_name}</span><span className="row-sub">{o.number} {o.title}, {money(o.total)} order</span></div>
              <span className="row-amount">{money(o.paid_total)}</span>
            </Link>
          ))}
          {!data.deposits.length && <div className="list-empty">No deposits on open orders.</div>}
        </div>
      </Panel>
    </div>
  );
}

function Quotes() {
  const [range, setRange] = useState({ preset: '90', ...presetRange('90') });
  const { data, error, loading, reload } = useData('/reports/quotes', { from: range.from, to: range.to });
  return (
    <div className="stack-lg">
      <RangePicker value={range} onChange={setRange} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel>
            <Figures items={[
              { label: 'Quotes written', value: num(data.totals.count), note: money0(data.totals.value) },
              { label: 'Won', value: num(data.totals.won), note: money0(data.totals.won_value) },
              { label: 'Close rate', value: pct(data.totals.close_rate) },
              { label: 'Still open', value: num(data.totals.open) },
            ]} />
          </Panel>
          <Panel title="By salesperson">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Salesperson</th><th className="r">Quotes</th><th className="r">Won</th><th className="r">Lost</th><th className="r">Close rate</th><th className="r">Won value</th></tr></thead>
                <tbody>
                  {data.by_rep.map((r) => (
                    <tr key={r.key}><td>{r.label}</td><td className="r">{r.count}</td><td className="r">{r.won}</td><td className="r">{r.lost}</td><td className="r">{pct(r.close_rate)}</td><td className="r">{money0(r.won_value)}</td></tr>
                  ))}
                  {!data.by_rep.length && <tr><td colSpan={6} className="muted">No quotes in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Inventory() {
  const { data, error, loading, reload } = useData('/reports/inventory');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} retry={reload} />;
  const max = Math.max(1, ...data.by_category.map((c) => c.value));
  return (
    <div className="stack-lg">
      <Panel>
        <Figures items={[
          { label: 'Stock at cost', value: money0(data.total_value) },
          { label: 'Pieces on hand', value: num(data.pieces) },
          { label: 'Remnants', value: num(data.remnants), note: <Link to="/inventory?remnants=1" className="link-btn">See remnants</Link> },
        ]} />
      </Panel>
      <Panel title="By category">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Category</th><th className="r">Pieces</th><th className="r">Value at cost</th></tr></thead>
            <tbody>
              {data.by_category.map((c) => (
                <tr key={c.key}><td style={{ minWidth: 140 }}><div className="stack" style={{ gap: 4 }}><span>{c.label}</span><Meter value={c.value} max={max} /></div></td><td className="r">{c.pieces}</td><td className="r">{money0(c.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Below reorder point">
        <div className="rows">
          {data.low_stock.map((p) => (
            <Link key={p.id} to={`/products/${p.id}`} className="row">
              <div className="row-main"><span className="row-title">{p.name}</span><span className="row-sub">Reorder at {num(p.reorder_point)} {p.unit}</span></div>
              <span className="row-amount">{num(p.on_hand)} {p.unit}</span>
            </Link>
          ))}
          {!data.low_stock.length && <div className="list-empty">Everything is above its reorder point.</div>}
        </div>
      </Panel>
    </div>
  );
}

function Crews() {
  const [range, setRange] = useState({ preset: 'month', ...presetRange('month') });
  const { data, error, loading, reload } = useData('/reports/installers', { from: range.from, to: range.to });
  return (
    <div className="stack-lg">
      <RangePicker value={range} onChange={setRange} />
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <Panel title="Jobs by crew">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Crew</th><th className="r">Done</th><th className="r">Still open</th><th className="r">Total</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}><td><span className="hstack"><span className="dot" style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, display: 'inline-block' }} />{r.name}</span></td><td className="r">{r.done}</td><td className="r">{r.open}</td><td className="r">{r.total}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

export default function ReportsPage({ query }) {
  const [tab, setTab] = useState(query.tab || 'sales');
  return (
    <Screen title="Reports">
      <div className="page-head"><h1>Reports</h1></div>
      <Chips value={tab} onChange={setTab} label="Report" options={[
        { value: 'sales', label: 'Sales' }, { value: 'ar', label: 'Money owed' }, { value: 'quotes', label: 'Quotes' },
        { value: 'inventory', label: 'Inventory' }, { value: 'crews', label: 'Crews' },
      ]} />
      {tab === 'sales' && <Sales />}
      {tab === 'ar' && <Receivables />}
      {tab === 'quotes' && <Quotes />}
      {tab === 'inventory' && <Inventory />}
      {tab === 'crews' && <Crews />}
    </Screen>
  );
}
