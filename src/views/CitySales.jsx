import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, Line,
} from 'recharts';
import { getJSON, peek, prefetch } from '../lib/api.js';
import { ErrorBox } from '../components/ui.jsx';
import MatrixTable from '../components/MatrixTable.jsx';
import { ChannelIcons, MultiSelect } from '../components/FilterBar.jsx';
import { inrShort, countShort, indianGroup, shortDate, longDate } from '../lib/format.js';

/* ═══════════════════════════════════════════════════════════════════════
   City Wise Sales — where demand actually is.

   The Hex notebook's two pivots (day-on-day and week-on-week by state /
   city / SKU) reproduced on the shared MatrixTable, which already handles
   the hard parts of a wide grid: sticky identity columns, a TOTAL row that
   follows the filter, month-column sorting and CSV.

   Two corrections to the notebook, both load-bearing for a city report:
   · BANGALORE and BENGALURU are one city reported twice — merged, which
     moves it from 3rd and 5th place to 2nd. Five more pairs behave the same.
   · City is not unique: KOTA, UDAIPUR and others exist in two states, so
     every row is keyed on state + city.
   ═══════════════════════════════════════════════════════════════════════ */

const C = { bar: '#3B6FD4', accent: '#E9BC15', ink: '#1A1B1F', grey: '#B6B8BE' };

const pctS = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d) + '%');

export default function CitySales({ from, to }) {
  const [grain, setGrain] = useState('day');
  const [rowBy, setRowBy] = useState('city');
  const [measure, setMeasure] = useState('units');
  const [statusMode, setStatusMode] = useState('all');
  // `channel` is single-select (one brand at a time, or null for all).
  const [sel, setSel] = useState({ channel: null, states: [], cities: [], skus: [], categories: [], subCategories: [] });
  const [day, setDay] = useState(null);
  const [week, setWeek] = useState(null);
  const [filters, setFilters] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => { getJSON('/city-filters', {}).then(setFilters).catch(() => {}); }, []);

  const params = useMemo(() => {
    const p = { from, to, rowBy, measure, statusMode };
    if (sel.channel) p.channels = sel.channel;
    for (const [k, v] of Object.entries(sel)) if (Array.isArray(v) && v.length) p[k] = v.join(',');
    return p;
  }, [from, to, rowBy, measure, statusMode, sel]);

  const load = () => {
    if (!from || !to) return;
    const my = ++reqId.current;
    const dayP = { ...params, grain: 'day' }, weekP = { ...params, grain: 'week' };
    // If both grains are already warm (a channel click revisiting a state,
    // or the background prefetch below having beaten the user to it), commit
    // instantly with no loading flash.
    const wDay = peek('/city-sales', dayP), wWeek = peek('/city-sales', weekP);
    if (wDay && wWeek) { setDay(wDay); setWeek(wWeek); setLoading(false); setError(null); return; }
    setLoading(true); setError(null);
    // Both grains in parallel: they are the same scan at two column widths,
    // and the notebook shows them together.
    Promise.all([getJSON('/city-sales', dayP), getJSON('/city-sales', weekP)])
      .then(([d, w]) => { if (my === reqId.current) { setDay(d); setWeek(w); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, [JSON.stringify(params)]);

  // Warm every single-channel variant in the background once the unfiltered
  // view has landed, so clicking a channel logo is a cache hit by the time
  // the user gets there.
  useEffect(() => {
    if (!day || !week || !filters || !from || !to) return;
    const base = { from, to, rowBy, measure, statusMode };
    const jobs = filters.channels.flatMap(c => [
      ['/city-sales', { ...base, channels: c, grain: 'day' }],
      ['/city-sales', { ...base, channels: c, grain: 'week' }],
    ]);
    prefetch(jobs, () => alive.current);
  }, [filters, from, to, rowBy, measure, statusMode, !!day, !!week]);

  const d = day;
  const isMoney = d && d.measureFmt === 'inr';
  const fmtV = v => (isMoney ? inrShort(v) : countShort(v));

  // ── leaderboard + concentration, from the rows already fetched ──
  const lead = useMemo(() => {
    if (!d) return null;
    const total = d.totals.reduce((a, b) => a + b, 0);
    const rows = d.rows.map(r => {
      const v = r.values.reduce((a, b) => a + b, 0);
      return { ...r, v, share: total > 0 ? (v / total) * 100 : 0 };
    }).filter(r => r.v > 0);
    // Cumulative share, to say how few places carry the business.
    let run = 0;
    const cum = rows.map(r => { run += r.share; return { ...r, cum: run }; });
    const atLeast = p => cum.findIndex(r => r.cum >= p) + 1 || null;
    return {
      total, rows: cum,
      top: cum.slice(0, 12),
      n50: atLeast(50), n80: atLeast(80),
      otherShare: d.other && total > 0
        ? (d.other.values.reduce((a, b) => a + b, 0) / total) * 100 : 0,
    };
  }, [d]);

  const activeFilters = (sel.channel ? 1 : 0)
    + Object.values(sel).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);

  // Identity columns follow the chosen row grain.
  const idCols = useMemo(() => {
    const all = {
      state: { head: 'STATE', get: r => r.state },
      city: { head: 'CITY', get: r => r.city },
      sku: { head: 'SKU', get: r => r.sku },
      product: { head: 'PRODUCT', get: r => r.product },
    };
    return (d ? d.rowNames : ['state', 'city']).map(n => all[n]).filter(Boolean);
  }, [d]);

  if (loading && !d) {
    return (
      <>
        <div className="nsec"><div className="txt"><h2>City Wise Sales</h2>
          <p>where demand is · state and city</p></div></div>
        <div className="kstrip">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 78, borderRadius: 14 }} />)}</div>
        <div className="skeleton" style={{ height: 360, borderRadius: 16, marginTop: 14 }} />
      </>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!d || !lead) return null;

  const m = d.meta;
  const netBlind = measure === 'net' && m.netMissing.length > 0;
  const matrixRows = [...d.rows, ...(d.other ? [d.other] : [])];

  return (
    <>
      {/* ══ header ══ */}
      <div className="nsec">
        <div className="txt">
          <h2>City Wise Sales</h2>
          <p>{longDate(from)} → {longDate(to)} · {d.reach.cities.toLocaleString('en-IN')} cities
            across {d.reach.states} states</p>
        </div>
        <div className="spacer" />
        <div className="tools">
          <span className="mx-span" title="Measure">
            {[['units', 'UNITS'], ['gross', 'GROSS ₹'], ['net', 'NET ₹']].map(([k, l]) => (
              <button key={k} className={measure === k ? 'on' : ''} onClick={() => setMeasure(k)}>{l}</button>
            ))}
          </span>
          <span className="mx-span" title="Row grain">
            {[['state', 'STATE'], ['city', 'CITY'], ['city-sku', 'CITY×SKU']].map(([k, l]) => (
              <button key={k} className={rowBy === k ? 'on' : ''} onClick={() => setRowBy(k)}>{l}</button>
            ))}
          </span>
          <span className="mx-span" title="Order statuses included">
            {[['all', 'ALL'], ['net', 'NET']].map(([k, l]) => (
              <button key={k} className={statusMode === k ? 'on' : ''} onClick={() => setStatusMode(k)}>{l}</button>
            ))}
          </span>
        </div>
      </div>

      {/* ══ what you must know about this feed ══ */}
      <p className="mx-caveat">
        Rows are keyed on <b>state + city</b> — several city names occur in more
        than one state. <b>{m.aliasesApplied.length} name variants are merged</b> before
        grouping: Bangalore/Bengaluru are one city reported twice, and splitting
        them moves it from 2nd place to 3rd and 5th.
        {statusMode === 'all'
          ? <> All order statuses are counted, including returns and undelivered — switch to <b>NET</b> to drop them.</>
          : <> Net of returns, damaged, rejected, undeliverable, lost and cancelled lines.</>}
      </p>

      {netBlind && (
        <p className="mx-caveat warn">
          <b>{m.netMissing.join(', ')} {m.netMissing.length === 1 ? 'reports' : 'report'} no
          net value at all</b> in this feed ({m.netMissing.length === 1 ? 'its' : 'their'} NET_SALES
          is zero against real gross), so a net-sales read shows
          {m.netMissing.length === 1 ? ' its' : ' those'} cities as empty and understates
          every total. Use <b>GROSS ₹</b> or <b>UNITS</b>, or filter to the channels
          that do report net.
        </p>
      )}

      {/* ══ filters ══ */}
      {filters && (
        <div className="ss-filters">
          <ChannelIcons options={filters.channels} value={sel.channel}
            onChange={v => setSel(s => ({ ...s, channel: v }))} />
          <div className="fb-drops">
            <MultiSelect label="State" options={filters.states} value={sel.states}
              onChange={v => setSel(s => ({ ...s, states: v }))} />
            <MultiSelect label="City" options={filters.cities} value={sel.cities}
              onChange={v => setSel(s => ({ ...s, cities: v }))} placeholder="All (top 400)" />
            <MultiSelect label="Category" options={filters.categories} value={sel.categories}
              onChange={v => setSel(s => ({ ...s, categories: v }))} />
            <MultiSelect label="Sub-category" options={filters.subCategories} value={sel.subCategories}
              onChange={v => setSel(s => ({ ...s, subCategories: v }))} />
            <MultiSelect label="SKU" options={filters.skus} value={sel.skus}
              onChange={v => setSel(s => ({ ...s, skus: v }))} placeholder="All" />
          </div>
          <div className="fb-actions">
            {loading && <span className="ss-loading">updating…</span>}
            {activeFilters > 0 && (
              <button className="ss-resetall"
                onClick={() => setSel({ channel: null, states: [], cities: [], skus: [], categories: [], subCategories: [] })}>
                Reset all ({activeFilters})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══ KPI strip ══ */}
      <div className="kstrip ss-kstrip">
        <div className="kcard">
          <span className="kl">{d.measureLabel}</span>
          <div className="ss-kv"><b>{fmtV(lead.total)}</b></div>
          <span className="ss-ks">{d.reach.days} days of data</span>
        </div>
        <div className="kcard">
          <span className="kl">Cities reached</span>
          <div className="ss-kv"><b>{d.reach.cities.toLocaleString('en-IN')}</b></div>
          <span className="ss-ks">in {d.reach.states} states</span>
        </div>
        <div className="kcard">
          <span className="kl">Top city</span>
          <div className="ss-kv"><b>{lead.top[0] ? lead.top[0].city : '—'}</b></div>
          <span className="ss-ks">{lead.top[0] ? `${fmtV(lead.top[0].v)} · ${pctS(lead.top[0].share)} of total` : ''}</span>
        </div>
        <div className="kcard">
          <span className="kl">Half the business</span>
          <div className="ss-kv"><b>{lead.n50 ?? '—'}</b></div>
          <span className="ss-ks">cities carry the first 50%</span>
        </div>
        <div className="kcard">
          <span className="kl">Long tail</span>
          <div className="ss-kv"><b>{pctS(lead.otherShare)}</b></div>
          <span className="ss-ks">
            {d.other ? `${d.other.count.toLocaleString('en-IN')} cities outside the top ${m.topN}` : 'all cities shown'}
          </span>
        </div>
      </div>

      {/* ══ leaderboard ══ */}
      <div className="card">
        <div className="card-head">
          <h3>Top {rowBy === 'state' ? 'states' : 'cities'}</h3>
          <span className="meta">{d.measureLabel} · share of total</span>
        </div>
        <p className="card-sub">
          {lead.n80
            ? <>The first <b>{lead.n80}</b> {rowBy === 'state' ? 'states' : 'cities'} carry 80% of
              this measure — concentration is the point of a city report, so it is
              stated rather than left to be counted off a chart.</>
            : <>Ranked by {d.measureLabel.toLowerCase()} over the window.</>}
        </p>
        <div style={{ height: Math.max(220, lead.top.length * 27 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            {/* Not reversed: Recharts places the first datum at the top of a
                vertical-layout chart, so the ranked order is already right —
                reversing it put the smallest city at the top of a chart
                titled "Top cities". */}
            <BarChart data={lead.top} layout="vertical"
              margin={{ top: 4, right: 68, left: 4, bottom: 4 }}>
              <CartesianGrid stroke="var(--line)" horizontal={false} />
              <XAxis type="number" tickFormatter={v => (isMoney ? inrShort(v, { currency: false }) : countShort(v))}
                tickLine={false} axisLine={false} tick={{ fontSize: 9.5 }} />
              <YAxis type="category" dataKey={rowBy === 'state' ? 'state' : 'city'}
                width={124} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 11.5 }}
                formatter={(v, n, p) => [`${fmtV(v)} · ${pctS(p.payload.share)} of total`, d.measureLabel]}
                labelFormatter={l => l} />
              <Bar dataKey="v" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {lead.top.map((r, i) => (
                  <Cell key={i} fill={i === 0 ? C.accent : C.bar} fillOpacity={0.86} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ══ the two notebook pivots ══ */}
      <div className="nsec"><div className="num">01</div><div className="txt">
        <h2>Day on Day</h2><p>{d.columns.length} days · newest first</p></div></div>

      <MatrixTable
        label={`Day-on-Day · ${d.measureLabel}`}
        sub={`${d.measureLabel.toLowerCase()} by ${d.rowNames.join(' × ')}, per day`}
        months={d.columns} rows={matrixRows} totals={d.totals}
        idCols={idCols} fmt={d.measureFmt} />

      {week && (
        <>
          <div className="nsec"><div className="num">02</div><div className="txt">
            <h2>Week on Week</h2><p>{week.columns.length} weeks · labelled by week start</p></div></div>

          <MatrixTable
            label={`Week-on-Week · ${week.measureLabel}`}
            sub={`${week.measureLabel.toLowerCase()} by ${week.rowNames.join(' × ')}, per week commencing`}
            months={week.columns}
            rows={[...week.rows, ...(week.other ? [week.other] : [])]}
            totals={week.totals} idCols={idCols} fmt={week.measureFmt} />
        </>
      )}

      <p className="mx-caveat" style={{ marginTop: 14 }}>
        {m.truncated && <>Showing the top <b>{m.topN}</b> rows by {d.measureLabel.toLowerCase()};
          everything below is folded into one <b>(other)</b> row so the TOTAL still
          reconciles to the window exactly. </>}
        {m.weekNote}{m.weekNote ? ' ' : ''}
        Source <code>{m.table}</code>.
      </p>
    </>
  );
}
