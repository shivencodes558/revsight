import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, ScatterChart, Scatter, Line, Area, Bar,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Cell, BarChart,
} from 'recharts';
import { getJSON, peek, prefetch } from '../lib/api.js';
import { ErrorBox } from '../components/ui.jsx';
import StackedTrend from '../components/StackedTrend.jsx';
import { ChannelIcons, MultiSelect } from '../components/FilterBar.jsx';
import { inrShort, countShort, indianGroup, monthLabel, shortDate, longDate } from '../lib/format.js';
import {
  mixRateSplit, priceVolume, dowProfile, bandShares, bandTotals,
  discountMovers, ineffectiveDiscounts, pctChange,
} from '../lib/secondary.js';

/* ═══════════════════════════════════════════════════════════════════════
   Secondary Sales Trend Analysis — sell-OUT (platform → consumer).

   The Hex notebook's two combined charts are reproduced faithfully under
   Trends. Everything else answers the question those charts raise but
   cannot settle: units, price and discount move together, so which one is
   driving, and where.
   ═══════════════════════════════════════════════════════════════════════ */

const C = {
  units: '#3B6FD4',      // the notebook's blue
  asp: '#D8503E',        // its red
  discount: '#2FA98C',   // its teal
  revenue: '#8A6A00',    // gold, for the metric it never charted
};
const BAND_COLORS = ['#177A4C', '#5EA97F', '#B7C9A8', '#FBD333', '#E9A020', '#D8503E', '#8E2A20'];

const pctFmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d) + '%');
const rupee = v => (v == null || !isFinite(v) ? '—' : '₹' + indianGroup(Math.round(v)));

// Percentage metrics move in percentage POINTS; value metrics move in percent.
// Reporting a discount going 15%→19% as "+22%" is the classic way to make a
// 4-point markdown sound like a rounding error, or vice versa.
const Chg = ({ cur, prev, points = false, invert = false, digits = 1 }) => {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return <span className="ss-chg flat">—</span>;
  const raw = points ? cur - prev : pctChange(cur, prev);
  if (raw == null || !isFinite(raw)) return <span className="ss-chg flat">—</span>;
  const good = invert ? raw < 0 : raw > 0;
  const cls = Math.abs(raw) < (points ? 0.05 : 0.05) ? 'flat' : good ? 'up' : 'down';
  const txt = (raw >= 0 ? '+' : '') + raw.toFixed(digits) + (points ? ' pp' : '%');
  return <span className={'ss-chg ' + cls}>{txt}</span>;
};

function Kc({ label, value, cur, prev, points, invert, sub }) {
  return (
    <div className="kcard">
      <span className="kl">{label}</span>
      <div className="ss-kv">
        <b>{value}</b>
        <Chg cur={cur} prev={prev} points={points} invert={invert} />
      </div>
      {sub && <span className="ss-ks">{sub}</span>}
    </div>
  );
}

export default function SecondarySales({ from, to, prevFrom, prevTo }) {
  const [tab, setTab] = useState('trends');
  const [statusMode, setStatusMode] = useState('all');
  // `channel` is single-select (one brand at a time, or null for all) — the
  // other dimensions stay multi-select word lists.
  const [sel, setSel] = useState({ channel: null, categories: [], subCategories: [], classifications: [], skus: [] });
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Option lists are independent of the window and the selection, so they
  // load once and never refetch when a filter changes.
  useEffect(() => {
    getJSON('/secondary-filters', {}).then(setFilters).catch(() => {});
  }, []);

  const params = useMemo(() => {
    const p = { from, to, prevFrom, prevTo, statusMode };
    if (sel.channel) p.channels = sel.channel;
    for (const [k, v] of Object.entries(sel)) if (Array.isArray(v) && v.length) p[k] = v.join(',');
    return p;
  }, [from, to, prevFrom, prevTo, statusMode, sel]);

  const load = () => {
    if (!from || !to || !prevFrom || !prevTo) return;
    const my = ++reqId.current;
    // A channel click that's already warm (see the prefetch effect below)
    // commits synchronously — no skeleton, no spinner, just new numbers.
    const warm = peek('/secondary-sales', params);
    if (warm) { setData(warm); setLoading(false); setError(null); return; }
    setLoading(true); setError(null);
    getJSON('/secondary-sales', params)
      .then(r => { if (my === reqId.current) { setData(r); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, [JSON.stringify(params)]);

  // Once the unfiltered view is in and the channel list is known, quietly
  // warm every single-channel variant in the background. By the time the
  // user actually clicks a logo, that click is almost always a cache hit.
  useEffect(() => {
    if (!data || !filters || !from || !to || !prevFrom || !prevTo) return;
    const base = { from, to, prevFrom, prevTo, statusMode };
    prefetch(filters.channels.map(c => ['/secondary-sales', { ...base, channels: c }]), () => alive.current);
  }, [filters, from, to, prevFrom, prevTo, statusMode, !!data]);

  // ── derivations ──
  const d = useMemo(() => {
    if (!data) return null;
    const pv = priceVolume(data.daily, data.totals);
    return {
      pv,
      dow: dowProfile(data.daily),
      bandRows: bandShares(data.bands, data.bandOrder),
      bandTot: bandTotals(data.bands, data.bandOrder),
      mixCat: mixRateSplit(data.subCategories || []),
      mixChan: mixRateSplit(data.channels || []),
      skuMovers: discountMovers(data.skus, { minUnits: 500, limit: 8 }),
      chanMovers: discountMovers(data.channels, { minUnits: 200, limit: 14 }),
      wasted: ineffectiveDiscounts(data.skus, { minUnits: 500, limit: 6 }),
    };
  }, [data]);

  const activeFilters = (sel.channel ? 1 : 0)
    + Object.values(sel).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);

  if (loading && !data) {
    return (
      <>
        <div className="nsec"><div className="txt"><h2>Secondary Sales Trends</h2>
          <p>sell-out · units, price and discount</p></div></div>
        <div className="kstrip">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 78, borderRadius: 14 }} />)}</div>
        <div className="skeleton" style={{ height: 420, borderRadius: 16, marginTop: 14 }} />
      </>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data || !d) return null;

  const T = data.totals;
  const m = data.meta;
  // Days the window SPANS vs days that actually carry rows. A filtered
  // channel whose feed lags reports fewer, and conflating the two would
  // silently relabel the window as shorter than it is.
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const nDays = data.daily.length;
  const dailyFmt = k => shortDate(k);
  const dailyLabel = k => longDate(k);

  return (
    <>
      {/* ══ header ══ */}
      <div className="nsec">
        <div className="txt">
          <h2>Secondary Sales Trends</h2>
          <p>
            sell-out · {longDate(from)} → {longDate(to)} · {spanDays} days
            vs {longDate(prevFrom)} → {longDate(prevTo)}
            {nDays < spanDays && ` · only ${nDays} carry data`}
          </p>
        </div>
        <div className="spacer" />
        <div className="tools">
          <span className="mx-span" title="Order statuses included">
            <button className={statusMode === 'all' ? 'on' : ''} onClick={() => setStatusMode('all')}>ALL</button>
            <button className={statusMode === 'net' ? 'on' : ''} onClick={() => setStatusMode('net')}>NET</button>
          </span>
        </div>
      </div>

      {/* ══ the two things about this dataset you must know ══ */}
      <p className={'mx-caveat' + (statusMode === 'all' ? ' warn' : '')}>
        <b>Secondary = sell-out</b>, what the platform sold to the shopper. Every
        other Revsight tab is <b>primary</b> (sell-in, what we invoiced the
        platform). They are not expected to tie — primary moves in purchase-order
        steps, secondary with demand.
        {' '}{statusMode === 'all'
          ? <>This view counts <b>all order statuses</b>, matching the Hex notebook, so it is
            orders <b>placed</b>: {countShort(m.excluded.failUnits)} units
            ({pctFmt((m.excluded.failUnits / (T.cur.units || 1)) * 100)}) are cancellations,
            returns or RTO. Switch to <b>NET</b> to remove them.</>
          : <>Showing <b>net</b> of cancellations, returns, RTO, lost, damaged, rejected and
            undeliverable lines — this no longer matches the Hex notebook, which counts all statuses.</>}
        {m.excluded.droppedUnits > 0 && <> Freebie SKUs are excluded
        throughout ({countShort(m.excluded.droppedUnits)} unit{m.excluded.droppedUnits === 1 ? '' : 's'}):
        they carry no MRP and would otherwise register as a 100% discount.</>}
      </p>

      {/* ══ filters ══
          Channels get logos (they are brands, recognised at a glance);
          the word-based dimensions get dropdowns, which is also what keeps
          22 sub-categories from becoming three rows of chips. ══ */}
      {filters && (
        <div className="ss-filters">
          <ChannelIcons options={filters.channels} value={sel.channel}
            onChange={v => setSel(s => ({ ...s, channel: v }))} />
          <div className="fb-drops">
            <MultiSelect label="Category" options={filters.categories} value={sel.categories}
              onChange={v => setSel(s => ({ ...s, categories: v }))} />
            <MultiSelect label="Sub-category" options={filters.subCategories} value={sel.subCategories}
              onChange={v => setSel(s => ({ ...s, subCategories: v }))} />
            <MultiSelect label="ABC class" options={filters.classifications} value={sel.classifications}
              onChange={v => setSel(s => ({ ...s, classifications: v }))} />
            <MultiSelect label="SKU" options={filters.skus} value={sel.skus}
              onChange={v => setSel(s => ({ ...s, skus: v }))} placeholder="All 300+" />
          </div>
          <div className="fb-actions">
            {loading && <span className="ss-loading">updating…</span>}
            {activeFilters > 0 && (
              <button className="ss-resetall"
                onClick={() => setSel({ channel: null, categories: [], subCategories: [], classifications: [], skus: [] })}>
                Reset all ({activeFilters})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══ KPI strip ══ */}
      <div className="kstrip ss-kstrip">
        <Kc label="Units Sold" value={countShort(T.cur.units)} cur={T.cur.units} prev={T.prev.units}
          sub={`from ${countShort(T.prev.units)}`} />
        <Kc label="Secondary Revenue" value={inrShort(T.cur.revenue)} cur={T.cur.revenue} prev={T.prev.revenue}
          sub="units × selling price" />
        <Kc label="Avg Selling Price" value={rupee(T.cur.asp)} cur={T.cur.asp} prev={T.prev.asp}
          sub={`from ${rupee(T.prev.asp)}`} />
        <Kc label="Discount %" value={pctFmt(T.cur.discountPct)} cur={T.cur.discountPct} prev={T.prev.discountPct}
          points invert sub={`of ${inrShort(T.cur.mrpValue)} MRP value`} />
        <Kc label="Orders" value={countShort(T.cur.orders)} cur={T.cur.orders} prev={T.prev.orders}
          sub={T.cur.unitsPerOrder ? T.cur.unitsPerOrder.toFixed(2) + ' units/order' : null} />
      </div>

      {/* ══ sub-tabs ══ */}
      <div className="subtabs" role="tablist" aria-label="Secondary sales sections">
        {[
          ['trends', 'Trends'],
          ['price', 'Price & Volume'],
          ['channels', 'Channels'],
          ['mix', 'Mix & SKUs'],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id}
            className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ═══════════════ TRENDS ═══════════════ */}
      {tab === 'trends' && (
        <>
          <div className="card">
            <div className="card-head"><h3>Daily Secondary Sales Metrics</h3>
              <span className="meta">{nDays} days</span></div>
            <p className="card-sub">
              Separate panels on a shared date axis — the three metrics span
              tens of thousands, hundreds and a percentage, so one axis would
              flatten two of them into a straight line.
            </p>
            <StackedTrend
              data={data.daily} xFormatter={dailyFmt} labelFormatter={dailyLabel}
              panels={[
                { key: 'units', label: 'Units Sold', color: C.units, area: true,
                  tickFormatter: countShort, valueFormatter: v => indianGroup(Math.round(v)) },
                { key: 'asp', label: 'Avg Selling Price', unit: '₹', color: C.asp,
                  tickFormatter: v => '₹' + Math.round(v), valueFormatter: rupee },
                { key: 'discountPct', label: 'Discount', unit: '%', color: C.discount,
                  tickFormatter: v => v.toFixed(0) + '%', valueFormatter: v => pctFmt(v, 2) },
                { key: 'revenue', label: 'Secondary Revenue', unit: '₹', color: C.revenue, area: true,
                  tickFormatter: v => inrShort(v, { currency: false }), valueFormatter: v => inrShort(v) },
              ]}
              refLines={{ discountPct: T.prev.discountPct, asp: T.prev.asp }}
            />
            <p className="ss-foot">
              Dashed lines mark the comparison period's average ASP ({rupee(T.prev.asp)})
              and discount ({pctFmt(T.prev.discountPct)}), so a level shift is visible
              rather than something you have to remember.
            </p>
          </div>

          <div className="card">
            <div className="card-head"><h3>Monthly Secondary Sales Metrics</h3>
              <span className="meta">trailing {data.monthly.length} months</span></div>
            <p className="card-sub">{m.monthlyNote} The newest month is partial until it closes.</p>
            <StackedTrend
              data={data.monthly} xFormatter={monthLabel} labelFormatter={monthLabel}
              panels={[
                { key: 'units', label: 'Units Sold', color: C.units, dot: true,
                  tickFormatter: countShort, valueFormatter: v => indianGroup(Math.round(v)) },
                { key: 'asp', label: 'Avg Selling Price', unit: '₹', color: C.asp, dot: true,
                  tickFormatter: v => '₹' + Math.round(v), valueFormatter: rupee },
                { key: 'discountPct', label: 'Discount', unit: '%', color: C.discount, dot: true,
                  tickFormatter: v => v.toFixed(0) + '%', valueFormatter: v => pctFmt(v, 2) },
              ]}
            />
          </div>
        </>
      )}

      {/* ═══════════════ PRICE & VOLUME ═══════════════ */}
      {tab === 'price' && (
        <>
          <div className="grid-2">
            <div className="card">
              <div className="card-head"><h3>Does discounting buy volume?</h3></div>
              <p className="card-sub">
                One dot per day: discount depth against units moved. The line is
                an ordinary least-squares fit.
              </p>
              {d.pv.fit ? (
                <>
                  <div style={{ height: 250 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 8, right: 14, left: 4, bottom: 18 }}>
                        <CartesianGrid stroke="var(--line)" />
                        <XAxis type="number" dataKey="x" name="Discount"
                          tickFormatter={v => v.toFixed(0) + '%'} tickLine={false} axisLine={false}
                          tick={{ fontSize: 9.5 }} domain={['dataMin - 1', 'dataMax + 1']}
                          label={{ value: 'Discount %', position: 'insideBottom', offset: -10, fontSize: 10, fill: 'var(--ink-3)' }} />
                        <YAxis type="number" dataKey="y" name="Units"
                          tickFormatter={countShort} tickLine={false} axisLine={false}
                          tick={{ fontSize: 9.5 }} width={52} />
                        <Tooltip
                          contentStyle={{ background: '#fff', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 11.5 }}
                          formatter={(v, n) => (n === 'Discount' ? pctFmt(v, 2) : indianGroup(Math.round(v)))}
                          labelFormatter={() => ''}
                          content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const p = payload[0].payload;
                            return (
                              <div className="ss-tip">
                                <b>{longDate(p.key)}</b>
                                <span>{indianGroup(Math.round(p.y))} units</span>
                                <span>{pctFmt(p.x, 2)} discount</span>
                                <span>{rupee(p.asp)} ASP</span>
                              </div>
                            );
                          }} />
                        <Scatter data={d.pv.points} fill={C.units} fillOpacity={0.62} isAnimationActive={false} />
                        <Scatter
                          data={[
                            { x: d.pv.fit.xMin, y: d.pv.fit.intercept + d.pv.fit.slope * d.pv.fit.xMin },
                            { x: d.pv.fit.xMax, y: d.pv.fit.intercept + d.pv.fit.slope * d.pv.fit.xMax },
                          ]}
                          line={{ stroke: C.asp, strokeWidth: 1.8 }} shape={() => null} legendType="none" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="ss-readout">
                    <div>
                      <span className="k">Slope</span>
                      <b>{(d.pv.fit.slope >= 0 ? '+' : '') + indianGroup(Math.round(d.pv.fit.slope))}</b>
                      <i>units per extra discount point</i>
                    </div>
                    <div>
                      <span className="k">Correlation</span>
                      <b>{d.pv.fit.r.toFixed(2)}</b>
                      <i>{Math.abs(d.pv.fit.r) < 0.3 ? 'weak — discount explains little'
                        : Math.abs(d.pv.fit.r) < 0.6 ? 'moderate' : 'strong'} · n={d.pv.fit.n}</i>
                    </div>
                    <div>
                      <span className="k">Elasticity</span>
                      <b>{d.pv.elasticity ? d.pv.elasticity.value.toFixed(2) : '—'}</b>
                      <i>{d.pv.elasticity
                        ? (d.pv.elasticity.value < 0
                          ? 'cheaper did sell more'
                          : 'price and units fell together — not a price story')
                        : 'ASP moved too little to divide by'}</i>
                    </div>
                  </div>
                  <p className="ss-foot">
                    Association within the window, not proof of cause — a festival
                    week raises discount and demand at once. Elasticity compares the
                    two period averages ({pctFmt(d.pv.elasticity?.dUnits)} units
                    against {pctFmt(d.pv.elasticity?.dAsp)} ASP).
                    {d.pv.fit.n < 14 && <> <b>Only {d.pv.fit.n} days in this window</b> — that is
                    too few for the fit to mean much. Widen the date range before
                    reading the slope as a rule.</>}
                  </p>
                </>
              ) : <div className="empty" style={{ padding: 26 }}>Not enough days in this window to fit a line.</div>}
            </div>

            <div className="card">
              <div className="card-head"><h3>Gross to net</h3></div>
              <p className="card-sub">Where MRP value ends up, in rupees.</p>
              {(() => {
                const mrp = T.cur.mrpValue, rev = T.cur.revenue, disc = mrp - rev;
                const pMrp = T.prev.mrpValue, pRev = T.prev.revenue, pDisc = pMrp - pRev;
                const rows = [
                  { k: 'MRP value of units sold', v: mrp, p: pMrp, tone: 'base' },
                  { k: 'Discount given', v: -disc, p: -pDisc, tone: 'neg' },
                  { k: 'Secondary revenue', v: rev, p: pRev, tone: 'pos' },
                ];
                return (
                  <>
                    <div className="ss-g2n">
                      {rows.map(r => (
                        <div className={'ss-g2n-row ' + r.tone} key={r.k}>
                          <span className="l">{r.k}</span>
                          <span className="b" style={{ width: Math.max(2, Math.abs(r.v) / mrp * 100) + '%' }} />
                          <span className="v tnum">{inrShort(r.v)}</span>
                          <Chg cur={Math.abs(r.v)} prev={Math.abs(r.p)} invert={r.tone === 'neg'} />
                        </div>
                      ))}
                    </div>
                    <p className="ss-foot">
                      Discount cost <b>{inrShort(disc)}</b> this window
                      versus <b>{inrShort(pDisc)}</b> before — {pctFmt(T.cur.discountPct)} of MRP
                      value against {pctFmt(T.prev.discountPct)}. Every extra point of
                      discount at this volume is about <b>{inrShort(mrp / 100)}</b>.
                    </p>
                  </>
                );
              })()}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Discount depth mix</h3>
              <span className="meta">share of units by band</span></div>
            <p className="card-sub">
              An average of 30% could be everything at 30, or half at zero and
              half at 60. Those are a uniform markdown and a deep clearance, and
              they look identical in the mean.
            </p>
            <div style={{ height: 224 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.bandRows} margin={{ top: 4, right: 10, left: 4, bottom: 2 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="key" tickFormatter={dailyFmt} tickLine={false} axisLine={false}
                    minTickGap={34} tick={{ fontSize: 9.5 }} />
                  {/* Round the tick: floating-point shares stack to
                      100.00000000000003, and string-concatenating that
                      prints the whole thing into a 44px gutter. */}
                  <YAxis tickFormatter={v => Math.round(v) + '%'} tickLine={false} axisLine={false}
                    width={44} domain={[0, 100]} allowDataOverflow tick={{ fontSize: 9.5 }} />
                  <Tooltip labelFormatter={dailyLabel} formatter={(v, n) => [pctFmt(v), n]}
                    contentStyle={{ background: '#fff', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 11 }} />
                  {data.bandOrder.map((b, i) => (
                    <Area key={b} type="monotone" dataKey={b} stackId="1" name={b}
                      stroke={BAND_COLORS[i]} fill={BAND_COLORS[i]} fillOpacity={0.85} strokeWidth={0.4}
                      isAnimationActive={false} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="legend ss-legend">
              {d.bandTot.map((b, i) => (
                <span className="li" key={b.band}>
                  <span className="dot" style={{ background: BAND_COLORS[i] }} />
                  {b.band} · <b>{pctFmt(b.share)}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Weekly rhythm</h3>
              <span className="meta">average per weekday</span></div>
            <p className="card-sub">
              Promo cycles run weekly, so a weekend discount spike is a plan, not
              an anomaly — an average that ignores the cycle reads it as noise.
            </p>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.dow} margin={{ top: 6, right: 12, left: 4, bottom: 2 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="dow" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="u" tickFormatter={countShort} tickLine={false} axisLine={false}
                    width={50} tick={{ fontSize: 9.5 }} />
                  <YAxis yAxisId="d" orientation="right" tickFormatter={v => v.toFixed(0) + '%'}
                    tickLine={false} axisLine={false} width={42} tick={{ fontSize: 9.5 }} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 11.5 }}
                    formatter={(v, n) => (n === 'Discount %' ? pctFmt(v, 2) : indianGroup(Math.round(v)))} />
                  <Legend wrapperStyle={{ fontSize: 10.5 }} />
                  <Bar yAxisId="u" dataKey="avgUnits" name="Avg units" fill={C.units} fillOpacity={0.8} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Line yAxisId="d" type="monotone" dataKey="discountPct" name="Discount %"
                    stroke={C.discount} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════ CHANNELS ═══════════════ */}
      {tab === 'channels' && (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="tbl ss-tbl">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="r">Units</th>
                  <th className="r">Δ</th>
                  <th className="r">Revenue</th>
                  <th className="r">Δ</th>
                  <th className="r">ASP</th>
                  <th className="r">Δ</th>
                  <th className="r">Discount %</th>
                  <th className="r">Δ pp</th>
                  <th className="r">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.channels.map(c => (
                  <tr key={c.key}>
                    <td style={{ fontWeight: 560 }}>{c.key}</td>
                    <td className="r tnum">{countShort(c.cur.units)}</td>
                    <td className="r"><Chg cur={c.cur.units} prev={c.prev.units} digits={0} /></td>
                    <td className="r tnum">{inrShort(c.cur.revenue)}</td>
                    <td className="r"><Chg cur={c.cur.revenue} prev={c.prev.revenue} digits={0} /></td>
                    <td className="r tnum">{rupee(c.cur.asp)}</td>
                    <td className="r"><Chg cur={c.cur.asp} prev={c.prev.asp} digits={0} /></td>
                    <td className="r tnum">{pctFmt(c.cur.discountPct)}</td>
                    <td className="r"><Chg cur={c.cur.discountPct} prev={c.prev.discountPct} points invert /></td>
                    <td className="r tnum" style={{ color: 'var(--ink-3)' }}>
                      {pctFmt((c.cur.units / (T.cur.units || 1)) * 100)}
                    </td>
                  </tr>
                ))}
                <tr className="ss-total">
                  <td>TOTAL</td>
                  <td className="r tnum">{countShort(T.cur.units)}</td>
                  <td className="r"><Chg cur={T.cur.units} prev={T.prev.units} digits={0} /></td>
                  <td className="r tnum">{inrShort(T.cur.revenue)}</td>
                  <td className="r"><Chg cur={T.cur.revenue} prev={T.prev.revenue} digits={0} /></td>
                  <td className="r tnum">{rupee(T.cur.asp)}</td>
                  <td className="r"><Chg cur={T.cur.asp} prev={T.prev.asp} digits={0} /></td>
                  <td className="r tnum">{pctFmt(T.cur.discountPct)}</td>
                  <td className="r"><Chg cur={T.cur.discountPct} prev={T.prev.discountPct} points invert /></td>
                  <td className="r tnum">100.0%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-head"><h3>Who moved the discount</h3>
                <span className="meta">percentage points vs prior</span></div>
              <p className="card-sub">
                Deepest markdowns first. A total discount move is an average of
                these, so it can hide one channel going hard while others hold.
              </p>
              <div style={{ height: Math.max(190, d.chanMovers.deeper.length * 26 + 24) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[...d.chanMovers.deeper].sort((a, b) => a.discountDelta - b.discountDelta)}
                    layout="vertical" margin={{ top: 4, right: 42, left: 4, bottom: 4 }}>
                    <CartesianGrid stroke="var(--line)" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => v.toFixed(0) + 'pp'} tickLine={false}
                      axisLine={false} tick={{ fontSize: 9.5 }} />
                    <YAxis type="category" dataKey="key" width={92} tickLine={false} axisLine={false}
                      tick={{ fontSize: 10 }} />
                    <Tooltip formatter={v => [(v >= 0 ? '+' : '') + v.toFixed(2) + ' pp', 'Discount move']}
                      contentStyle={{ background: '#fff', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 11.5 }} />
                    <ReferenceLine x={0} stroke="var(--ink-3)" />
                    <Bar dataKey="discountDelta" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                      {d.chanMovers.deeper.map((r, i) => (
                        <Cell key={i} fill={r.discountDelta >= 0 ? C.asp : C.discount} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Channel mix vs pricing</h3></div>
              <p className="card-sub">
                Splits the total ASP move into channels changing price
                (rate) and volume shifting between channels at unchanged
                prices (mix). The two call for opposite responses.
              </p>
              {d.mixChan ? <MixWaterfall s={d.mixChan} /> :
                <div className="empty" style={{ padding: 24 }}>Not enough overlap to decompose.</div>}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Feed freshness</h3>
              <span className="meta">last row per channel</span></div>
            <p className="card-sub">
              A channel with no recent rows drags every average down silently —
              it reads as zero demand rather than as missing data.
            </p>
            <div className="ss-fresh">
              {data.freshness.map(f => {
                const lag = Math.round((Date.parse(to) - Date.parse(f.lastDate)) / 86400000);
                const tone = lag <= 2 ? 'ok' : lag <= 10 ? 'warn' : 'bad';
                return (
                  <div className={'ss-fresh-row ' + tone} key={f.channel}>
                    <span className="c">{f.channel}</span>
                    <span className="d tnum">{f.lastDate}</span>
                    <span className="l">{lag <= 0 ? 'current' : lag + 'd behind'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ═══════════════ MIX & SKUS ═══════════════ */}
      {tab === 'mix' && (
        <>
          <div className="grid-2">
            <div className="card">
              <div className="card-head"><h3>Why ASP moved</h3>
                <span className="meta">sub-category decomposition</span></div>
              <p className="card-sub">
                ASP falls for two unrelated reasons: everything got cheaper
                (<b>rate</b>), or the basket shifted to cheaper lines at
                unchanged prices (<b>mix</b>). Reading one as the other is an
                expensive mistake.
              </p>
              {d.mixCat ? <MixWaterfall s={d.mixCat} /> :
                <div className="empty" style={{ padding: 24 }}>Not enough overlap to decompose.</div>}
            </div>

            <div className="card">
              <div className="card-head"><h3>ABC class &amp; new products</h3></div>
              <p className="card-sub">
                The source table's own classification. NPD lines are expected to
                discount harder while they build rate of sale; A-lines doing the
                same is a different conversation.
              </p>
              <table className="tbl ss-tbl">
                <thead><tr><th>Class</th><th className="r">Units</th><th className="r">Δ</th>
                  <th className="r">ASP</th><th className="r">Discount %</th><th className="r">Δ pp</th></tr></thead>
                <tbody>
                  {data.classifications.map(c => (
                    <tr key={c.key}>
                      <td style={{ fontWeight: 560 }}>{c.key}</td>
                      <td className="r tnum">{countShort(c.cur.units)}</td>
                      <td className="r"><Chg cur={c.cur.units} prev={c.prev.units} digits={0} /></td>
                      <td className="r tnum">{rupee(c.cur.asp)}</td>
                      <td className="r tnum">{pctFmt(c.cur.discountPct)}</td>
                      <td className="r"><Chg cur={c.cur.discountPct} prev={c.prev.discountPct} points invert /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div className="card-head" style={{ padding: '18px 20px 0' }}>
              <h3>Sub-category detail</h3><span className="meta">{data.subCategories.length} rows</span>
            </div>
            <table className="tbl ss-tbl">
              <thead><tr><th>Sub-category</th><th className="r">Units</th><th className="r">Δ</th>
                <th className="r">Revenue</th><th className="r">ASP</th><th className="r">Δ</th>
                <th className="r">Discount %</th><th className="r">Δ pp</th><th className="r">Unit share</th></tr></thead>
              <tbody>
                {data.subCategories.map(c => (
                  <tr key={c.key}>
                    <td style={{ fontWeight: 560 }}>{c.key}</td>
                    <td className="r tnum">{countShort(c.cur.units)}</td>
                    <td className="r"><Chg cur={c.cur.units} prev={c.prev.units} digits={0} /></td>
                    <td className="r tnum">{inrShort(c.cur.revenue)}</td>
                    <td className="r tnum">{rupee(c.cur.asp)}</td>
                    <td className="r"><Chg cur={c.cur.asp} prev={c.prev.asp} digits={0} /></td>
                    <td className="r tnum">{pctFmt(c.cur.discountPct)}</td>
                    <td className="r"><Chg cur={c.cur.discountPct} prev={c.prev.discountPct} points invert /></td>
                    <td className="r tnum" style={{ color: 'var(--ink-3)' }}>
                      {pctFmt((c.cur.units / (T.cur.units || 1)) * 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-head"><h3>Deepest markdowns</h3>
                <span className="meta">SKUs · min 500 units both periods</span></div>
              <p className="card-sub">
                The volume floor matters: without it this fills with SKUs that
                sold four units and swung forty points.
              </p>
              <MoverList rows={d.skuMovers.deeper} />
            </div>
            <div className="card">
              <div className="card-head"><h3>Discount pulled back</h3>
                <span className="meta">SKUs holding price</span></div>
              <p className="card-sub">Where price discipline improved most.</p>
              <MoverList rows={d.skuMovers.shallower} />
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Markdowns that bought nothing</h3>
              <span className="meta">deeper discount, fewer units</span></div>
            <p className="card-sub">
              These SKUs discounted harder and still sold less than last period.
              That is margin given away without volume in return — the most
              actionable list on this page.
            </p>
            {d.wasted.length ? (
              <table className="tbl ss-tbl">
                <thead><tr><th>SKU</th><th className="r">Discount then → now</th>
                  <th className="r">Δ pp</th><th className="r">Units</th><th className="r">Δ units</th></tr></thead>
                <tbody>
                  {d.wasted.map(r => (
                    <tr key={r.key}>
                      <td>{r.key}</td>
                      <td className="r tnum">{pctFmt(r.prev.discountPct)} → {pctFmt(r.cur.discountPct)}</td>
                      <td className="r"><span className="ss-chg down">+{r.discountDelta.toFixed(1)} pp</span></td>
                      <td className="r tnum">{countShort(r.cur.units)}</td>
                      <td className="r"><span className="ss-chg down">{r.unitsDelta.toFixed(0)}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty" style={{ padding: 22 }}>
                No SKU above the volume floor discounted deeper and sold less — on
                this window, markdowns did move units.
              </div>
            )}
          </div>
        </>
      )}

      <p className="mx-caveat" style={{ marginTop: 14 }}>
        {m.basis}. {m.discountNote} Source <code>{m.table}</code>.
      </p>
    </>
  );
}

/* ── mix / rate waterfall ───────────────────────────────────────────────── */
function MixWaterfall({ s }) {
  const steps = [
    { k: 'Prior ASP', v: s.prevAsp, kind: 'base' },
    { k: 'Rate (prices moved)', v: s.rate, kind: 'step' },
    { k: 'Mix (basket moved)', v: s.mix, kind: 'step' },
    { k: 'Interaction', v: s.interaction, kind: 'step' },
    { k: 'Current ASP', v: s.curAsp, kind: 'base' },
  ];
  const span = Math.max(s.prevAsp, s.curAsp) || 1;
  return (
    <>
      <div className="ss-wf">
        {steps.map(st => (
          <div className={'ss-wf-row ' + st.kind + (st.kind === 'step' ? (st.v >= 0 ? ' pos' : ' neg') : '')} key={st.k}>
            <span className="l">{st.k}</span>
            <span className="track">
              <span className="b" style={{ width: Math.min(100, Math.abs(st.v) / span * 100) + '%' }} />
            </span>
            <span className="v tnum">
              {st.kind === 'step' && st.v >= 0 ? '+' : ''}{rupeeSigned(st.v)}
            </span>
          </div>
        ))}
      </div>
      <p className="ss-foot">
        {Math.abs(s.rate) >= Math.abs(s.mix)
          ? <><b>Rate dominates</b> — this is a real price move, not a basket shift.</>
          : <><b>Mix dominates</b> — prices held; the basket moved toward {s.mix < 0 ? 'cheaper' : 'pricier'} lines.</>}
        {' '}Interaction is the part that cannot be attributed to either alone.
        {Math.abs(s.residual) > 0.01 && <> Residual {rupeeSigned(s.residual)} — the split should close exactly, so this is a bug.</>}
      </p>
    </>
  );
}
const rupeeSigned = v =>
  (v == null || !isFinite(v) ? '—' : (v < 0 ? '−₹' : '₹') + indianGroup(Math.abs(Math.round(v * 100)) / 100));

/* ── SKU mover list ─────────────────────────────────────────────────────── */
function MoverList({ rows }) {
  if (!rows || !rows.length) return <div className="empty" style={{ padding: 22 }}>No SKU clears the volume floor.</div>;
  return (
    <div className="ss-movers">
      {rows.map(r => (
        <div className="ss-mover" key={r.key}>
          <div className="n">
            <b>{r.key}</b>
            <i>{r.subCategory}{r.classification && r.classification !== '(none)' ? ' · ' + r.classification : ''}</i>
          </div>
          <div className="d tnum">
            {pctFmt(r.prev.discountPct)} → <b>{pctFmt(r.cur.discountPct)}</b>
          </div>
          <span className={'ss-chg ' + (r.discountDelta > 0 ? 'down' : 'up')}>
            {(r.discountDelta >= 0 ? '+' : '') + r.discountDelta.toFixed(1)} pp
          </span>
          <span className={'ss-chg ' + (r.unitsDelta >= 0 ? 'up' : 'down')}>
            {r.unitsDelta == null ? '—' : (r.unitsDelta >= 0 ? '+' : '') + r.unitsDelta.toFixed(0) + '% u'}
          </span>
        </div>
      ))}
    </div>
  );
}
