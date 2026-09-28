import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { getJSON, peek, prefetch } from '../lib/api.js';
import { ErrorBox } from '../components/ui.jsx';
import WbrMetricTable from '../components/WbrMetricTable.jsx';
import StackedTrend from '../components/StackedTrend.jsx';
import { MultiSelect } from '../components/FilterBar.jsx';
import { inrShort, countShort, indianGroup, shortDate, longDate } from '../lib/format.js';

/* ═══════════════════════════════════════════════════════════════════════
   GoKwik Engage — retention messaging on the website.

   Campaigns + abandoned-cart recovery + lifecycle automations, unioned as
   the Hex notebook does. Its scorecard is reproduced on the shared
   WbrMetricTable (metric per row, comparison vs selected, % change in basis
   points for rates) and extended with the funnel rates it omits.
   ═══════════════════════════════════════════════════════════════════════ */

const C = {
  sent: '#3B6FD4', seen: '#2FA98C', clicks: '#E9BC15',
  sales: '#8A6A00', unsub: '#C2362B',
};
const CHANNEL_COLORS = { whatsapp: '#25D366', sms: '#3B6FD4', rcs: '#8A6A00', 'voice-call': '#6B6F76', email: '#C2362B', instagram: '#B23A82' };

const pctS = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d) + '%');
const rupee = v => (v == null || !isFinite(v) ? '—' : '₹' + indianGroup(Math.round(v)));
const int = v => (v == null || !isFinite(v) ? '—' : indianGroup(Math.round(v)));

export default function GokwikRetention({ from, to, prevFrom, prevTo }) {
  const [sel, setSel] = useState({ channels: [], sources: [], campaigns: [] });
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => { getJSON('/gokwik-filters', {}).then(setFilters).catch(() => {}); }, []);

  const params = useMemo(() => {
    const p = { from, to, prevFrom, prevTo };
    for (const [k, v] of Object.entries(sel)) if (v.length) p[k] = v.join(',');
    return p;
  }, [from, to, prevFrom, prevTo, sel]);

  const load = () => {
    if (!from || !to || !prevFrom || !prevTo) return;
    const my = ++reqId.current;
    const warm = peek('/gokwik', params);
    if (warm) { setData(warm); setLoading(false); setError(null); return; }
    setLoading(true); setError(null);
    getJSON('/gokwik', params)
      .then(r => { if (my === reqId.current) { setData(r); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, [JSON.stringify(params)]);

  // Warm every single-channel variant in the background so picking one
  // messaging channel from the dropdown is a cache hit by the time it lands.
  useEffect(() => {
    if (!data || !filters || !from || !to || !prevFrom || !prevTo) return;
    const base = { from, to, prevFrom, prevTo };
    prefetch(filters.channels.map(c => ['/gokwik', { ...base, channels: c }]), () => alive.current);
  }, [filters, from, to, prevFrom, prevTo, !!data]);

  /* The notebook's nine metrics, then the funnel rates it leaves out.
     `pct: true` makes WbrMetricTable report the move in basis points, which
     is the only honest way to express a change in a percentage. */
  const metricRows = useMemo(() => {
    if (!data) return [];
    const { sel: s, prev: p } = data;
    const R = (key, label, fmt, opts = {}) =>
      ({ key, label, sel: s[key], prev: p[key], fmt, ...opts });
    return [
      R('sent', 'Sent', 'int'),
      R('delivered', 'Delivered', 'int'),
      R('seen', 'Seen', 'int'),
      R('clicks', 'Clicks', 'int'),
      R('sales', 'Sales', 'rupee'),
      R('spends', 'Spends', 'rupee', { invert: true }),
      R('orders', 'Orders', 'int'),
      R('ctr', 'CTR % (of seen)', 'pct1', { pct: true }),
      R('roas', 'ROI', 'x'),
      // ── beyond the notebook ──
      R('deliveryRate', 'Delivery rate (of sent)', 'pct1', { pct: true }),
      R('seenRate', 'Seen rate (of delivered)', 'pct1', { pct: true }),
      R('ctrTracked', 'CTR % · open-tracking channels only', 'pct1', { pct: true }),
      R('clickRate', 'Click rate (of delivered)', 'pct1', { pct: true }),
      R('clickToOrder', 'Click → order', 'pct1', { pct: true }),
      R('orderPerSend', 'Orders per 100 sends', 'pct3', { pct: true }),
      R('buyers', 'Buyers', 'int'),
      R('aov', 'AOV', 'rupee'),
      R('costPerOrder', 'Cost per order', 'rupee', { invert: true }),
      R('revenuePerSend', 'Revenue per send', 'rupee'),
      // Unsubscribes are the cost of the sends: a programme that lifts
      // revenue while burning the list is not working.
      R('unsubs', 'Unsubscribes', 'int', { invert: true }),
      R('unsubRate', 'Unsubscribe rate (of sent)', 'pct3', { pct: true, invert: true }),
    ].filter(r => r.sel != null || r.prev != null);
  }, [data]);

  const funnel = useMemo(() => {
    if (!data) return null;
    const s = data.sel;
    return [
      { k: 'Sent', v: s.sent, rate: null, color: C.sent },
      { k: 'Delivered', v: s.delivered, rate: s.deliveryRate, of: 'sent', color: C.sent },
      { k: 'Seen', v: s.seen, rate: s.seenRate, of: 'delivered', color: C.seen },
      { k: 'Clicks', v: s.clicks, rate: s.clickRate, of: 'delivered', color: C.clicks },
      { k: 'Orders', v: s.orders, rate: s.clickToOrder, of: 'clicks', color: C.sales },
    ];
  }, [data]);

  const activeFilters = Object.values(sel).reduce((a, v) => a + v.length, 0);

  if (loading && !data) {
    return (
      <>
        <div className="nsec"><div className="txt"><h2>GoKwik Retention</h2>
          <p>campaigns, cart recovery and automations</p></div></div>
        <div className="kstrip">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 78, borderRadius: 14 }} />)}</div>
        <div className="skeleton" style={{ height: 360, borderRadius: 16, marginTop: 14 }} />
      </>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data || !funnel) return null;

  const s = data.sel, p = data.prev, m = data.meta;
  const ot = m.openTracking;
  const maxSent = funnel[0].v || 1;

  return (
    <>
      {/* ══ header ══ */}
      <div className="nsec">
        <div className="txt">
          <h2>GoKwik Retention</h2>
          <p>{longDate(from)} → {longDate(to)} · vs {longDate(prevFrom)} → {longDate(prevTo)}
            {' '}· {data.campaigns.length} campaigns across {data.channels.filter(c => c.cur.sent > 0).length} channels</p>
        </div>
      </div>

      <p className="mx-caveat">
        Three GoKwik sheets unioned — <b>campaigns</b>, <b>abandoned-cart recovery</b> and
        <b> lifecycle automations</b>. Cart recovery contributes <em>recovered amount</em> as
        sales and <em>recovered carts</em> as orders, so the headline blends cart
        recovery with campaign sales; Sources below splits them.
        {m.excluded.rows > 0 && <> <b>{int(m.excluded.rows)} rows
        ({countShort(m.excluded.sent)} sends)</b> whose name starts with "Order" are
        excluded as transactional notifications — order confirmations and delivery
        updates, not retention marketing.</>}
      </p>

      {/* The CTR denominator is the one number here that can mislead, so it is
          called out rather than footnoted. */}
      {ot.untracked.length > 0 && ot.untrackedClickShare > 1 && (
        <p className="mx-caveat warn">
          <b>CTR is clicks ÷ seen</b>, as in the Hex notebook — but {ot.untracked.join(' and ')} cannot
          report opens, so {pctS(ot.untrackedSendShare)} of sends have no <em>seen</em> at
          all while their clicks still count. That pushes the blended CTR
          to <b>{pctS(s.ctr, 2)}</b>, above every individual channel, which no weighted
          average can be. Like-for-like across open-tracking channels only
          it is <b>{pctS(s.ctrTracked, 2)}</b>; on delivered — comparable across all
          channels — <b>{pctS(s.clickRate, 2)}</b>.
        </p>
      )}

      {/* ══ filters ══ */}
      {filters && (
        <div className="ss-filters">
          <div className="fb-drops">
            <MultiSelect label="Channel" options={filters.channels} value={sel.channels}
              onChange={v => setSel(x => ({ ...x, channels: v }))} />
            <MultiSelect label="Source" options={filters.sources} value={sel.sources}
              onChange={v => setSel(x => ({ ...x, sources: v }))} />
            <MultiSelect label="Campaign" options={filters.campaigns} value={sel.campaigns}
              onChange={v => setSel(x => ({ ...x, campaigns: v }))} placeholder="All campaigns" />
          </div>
          <div className="fb-actions">
            {loading && <span className="ss-loading">updating…</span>}
            {activeFilters > 0 && (
              <button className="ss-resetall"
                onClick={() => setSel({ channels: [], sources: [], campaigns: [] })}>
                Reset all ({activeFilters})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══ KPI strip ══ */}
      <div className="kstrip ss-kstrip">
        {[
          { l: 'Sent', v: countShort(s.sent), c: s.sent, p: p.sent, sub: `${pctS(s.deliveryRate)} delivered` },
          { l: 'Clicks', v: countShort(s.clicks), c: s.clicks, p: p.clicks, sub: `${pctS(s.clickRate, 2)} of delivered` },
          { l: 'Orders', v: int(s.orders), c: s.orders, p: p.orders, sub: `${pctS(s.clickToOrder, 1)} of clicks` },
          { l: 'Sales', v: inrShort(s.sales), c: s.sales, p: p.sales, sub: `AOV ${rupee(s.aov)}` },
          { l: 'ROI', v: s.roas == null ? '—' : s.roas.toFixed(2) + 'x', c: s.roas, p: p.roas, sub: `on ${inrShort(s.spends)} spend` },
        ].map(k => {
          const dpct = k.p ? ((k.c - k.p) / Math.abs(k.p)) * 100 : null;
          const good = dpct == null ? null : dpct > 0;
          return (
            <div className="kcard" key={k.l}>
              <span className="kl">{k.l}</span>
              <div className="ss-kv">
                <b>{k.v}</b>
                <span className={'ss-chg ' + (dpct == null ? 'flat' : Math.abs(dpct) < 0.05 ? 'flat' : good ? 'up' : 'down')}>
                  {dpct == null ? '—' : (dpct >= 0 ? '▲ ' : '▼ ') + Math.abs(dpct).toFixed(1) + '%'}
                </span>
              </div>
              <span className="ss-ks">{k.sub}</span>
            </div>
          );
        })}
      </div>

      {/* ══ funnel ══ */}
      <div className="card">
        <div className="card-head"><h3>Message funnel</h3>
          <span className="meta">selected period</span></div>
        <p className="card-sub">
          Each step as a share of the one above it. The drop from delivered to
          seen is where a retention programme is usually won or lost.
        </p>
        <div className="gk-funnel">
          {funnel.map((f, i) => (
            <div className="gk-step" key={f.k}>
              <span className="l">{f.k}</span>
              <span className="track">
                <span className="b" style={{ width: Math.max(0.6, (f.v / maxSent) * 100) + '%', background: f.color }} />
              </span>
              <span className="v tnum">{int(f.v)}</span>
              <span className="r">
                {f.rate == null
                  ? <i>—</i>
                  : <><b>{pctS(f.rate, f.rate < 10 ? 2 : 1)}</b> <i>of {f.of}</i></>}
              </span>
            </div>
          ))}
        </div>
        <p className="ss-foot">
          End to end, <b>{pctS(s.orderPerSend, 3)}</b> of sends became an order
          — {int(s.orders)} orders from {countShort(s.sent)} messages, worth <b>{inrShort(s.sales)}</b>.
          Unsubscribes cost <b>{int(s.unsubs)}</b> contacts ({pctS(s.unsubRate, 3)} of sends).
        </p>
      </div>

      {/* ══ the notebook's scorecard ══ */}
      <div className="nsec"><div className="num">01</div><div className="txt">
        <h2>Metric comparison</h2><p>selected vs comparison period · rates move in basis points</p></div></div>
      <WbrMetricTable rows={metricRows}
        selLabel={`${shortDate(from)} – ${shortDate(to)}`}
        prevLabel={`${shortDate(prevFrom)} – ${shortDate(prevTo)}`} />

      {/* ══ trend ══ */}
      <div className="nsec"><div className="num">02</div><div className="txt">
        <h2>Daily trend</h2><p>{data.daily.length} days in the selected window</p></div></div>
      <div className="card">
        <StackedTrend
          data={data.daily} xFormatter={shortDate} labelFormatter={longDate}
          panels={[
            { key: 'sent', label: 'Sent', color: C.sent, area: true,
              tickFormatter: countShort, valueFormatter: int },
            { key: 'clicks', label: 'Clicks', color: C.clicks,
              tickFormatter: countShort, valueFormatter: int },
            { key: 'orders', label: 'Orders', color: C.sales,
              tickFormatter: v => Math.round(v), valueFormatter: int },
            { key: 'sales', label: 'Sales', unit: '₹', color: C.sales, area: true,
              tickFormatter: v => inrShort(v, { currency: false }), valueFormatter: v => inrShort(v) },
            { key: 'unsubs', label: 'Unsubscribes', color: C.unsub,
              tickFormatter: v => Math.round(v), valueFormatter: int },
          ]}
        />
      </div>

      {/* ══ sources & channels ══ */}
      <div className="nsec"><div className="num">03</div><div className="txt">
        <h2>Where it comes from</h2><p>by source and by channel</p></div></div>
      <div className="grid-2">
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <div className="card-head" style={{ padding: '18px 20px 0' }}>
            <h3>By source</h3><span className="meta">campaign type</span>
          </div>
          <DimTable rows={data.sources} />
        </div>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <div className="card-head" style={{ padding: '18px 20px 0' }}>
            <h3>By channel</h3><span className="meta">delivery medium</span>
          </div>
          <DimTable rows={data.channels.filter(c => c.cur.sent > 0 || c.prev.sent > 0)} colorBy />
        </div>
      </div>

      {/* ══ campaigns ══ */}
      <div className="nsec"><div className="num">04</div><div className="txt">
        <h2>Campaigns</h2><p>ranked by sales in the selected period</p></div></div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tbl ss-tbl">
          <thead>
            <tr>
              <th>Campaign</th>
              <th className="r">Sent</th><th className="r">Delivered</th>
              <th className="r">Clicks</th><th className="r">Click rate</th>
              <th className="r">Orders</th><th className="r">Sales</th>
              <th className="r">Spend</th><th className="r">ROI</th>
              <th className="r">Unsubs</th>
            </tr>
          </thead>
          <tbody>
            {data.campaigns.slice(0, 40).map(c => (
              <tr key={c.key}>
                <td style={{ fontWeight: 550, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  title={c.key}>{c.key}</td>
                <td className="r tnum">{countShort(c.cur.sent)}</td>
                <td className="r tnum">{countShort(c.cur.delivered)}</td>
                <td className="r tnum">{int(c.cur.clicks)}</td>
                <td className="r tnum">{pctS(c.cur.clickRate, 2)}</td>
                <td className="r tnum">{int(c.cur.orders)}</td>
                <td className="r tnum">{inrShort(c.cur.sales)}</td>
                <td className="r tnum">{inrShort(c.cur.spends)}</td>
                <td className="r tnum">{c.cur.roas == null ? '—' : c.cur.roas.toFixed(2) + 'x'}</td>
                <td className="r tnum">{int(c.cur.unsubs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.campaigns.length > 40 && (
          <p className="card-sub" style={{ padding: '10px 20px 16px', margin: 0 }}>
            Top 40 of {data.campaigns.length} campaigns by sales.
          </p>
        )}
      </div>

      <p className="mx-caveat" style={{ marginTop: 14 }}>
        {m.ctrBasis} Source: three sheets under <code>{m.tables[0].split('.').slice(0, 2).join('.')}</code>.
      </p>
    </>
  );
}

/* Compact source/channel table — same metrics, one row per dimension value. */
function DimTable({ rows, colorBy = false }) {
  if (!rows.length) return <div className="empty" style={{ padding: 24 }}>Nothing in this window.</div>;
  const CHANNEL_C = { whatsapp: '#25D366', sms: '#3B6FD4', rcs: '#8A6A00', 'voice-call': '#6B6F76', email: '#C2362B', instagram: '#B23A82' };
  return (
    <table className="tbl ss-tbl">
      <thead>
        <tr>
          <th />
          <th className="r">Sent</th><th className="r">Clicks</th>
          <th className="r">Orders</th><th className="r">Sales</th>
          <th className="r">ROI</th><th className="r">Unsub %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key}>
            <td style={{ fontWeight: 550 }}>
              {colorBy && (
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                  marginRight: 7, background: CHANNEL_C[r.key] || 'var(--g4)',
                }} />
              )}
              {r.key}
            </td>
            <td className="r tnum">{countShort(r.cur.sent)}</td>
            <td className="r tnum">{int(r.cur.clicks)}</td>
            <td className="r tnum">{int(r.cur.orders)}</td>
            <td className="r tnum">{inrShort(r.cur.sales)}</td>
            <td className="r tnum">{r.cur.roas == null ? '—' : r.cur.roas.toFixed(2) + 'x'}</td>
            <td className="r tnum">{pctS(r.cur.unsubRate, 3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
