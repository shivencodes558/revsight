import React, { useState, useEffect, useMemo, useCallback } from 'react';
import SplashScreen from './SplashScreen.jsx';
import Sidebar, { NAV, DEFAULT_VIEW, channelOf, logoFor } from './components/Sidebar.jsx';
import { MetricToggle, KpiSkeletons, ChartSkeleton, ErrorBox } from './components/ui.jsx';
import DateRange from './components/DateRange.jsx';
import { OpsInsights, OpsOverview } from './components/OpsInsights.jsx';
import CrossChannel from './views/CrossChannel.jsx';
import ChannelDeepDive from './views/ChannelDeepDive.jsx';
import WeeklyReview from './views/WeeklyReview.jsx';
import WbrBrand from './views/WbrBrand.jsx';
import WbrMarketplaceTable from './views/WbrMarketplaceTable.jsx';
import WbrChannelScorecard from './views/WbrChannelScorecard.jsx';
import WbrWebsite from './views/WbrWebsite.jsx';
import DailyReport from './views/DailyReport.jsx';
import Profitability from './views/Profitability.jsx';
import DailyMarketplaces from './views/DailyMarketplaces.jsx';
import DailyWebsite from './views/DailyWebsite.jsx';
import SkuMatrix from './views/SkuMatrix.jsx';
import SecondarySales from './views/SecondarySales.jsx';
import CitySales from './views/CitySales.jsx';
import GokwikRetention from './views/GokwikRetention.jsx';
import { fetchOverall, fetchCube, refreshAll, prefetch } from './lib/api.js';
import { METRICS } from './lib/metrics.js';
import { shiftYMD, daysBetween, todayIST, startOfMonth, endOfMonth, shiftMonth, sameSpanPrevMonth } from './dateUtils.js';

// view-crash isolation so one broken view never takes down the shell (Adsight pattern)
class ViewBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.viewKey !== this.props.viewKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (this.state.err) return <div className="errbox"><b>This view hit an error</b><code>{String(this.state.err.message || this.state.err)}</code></div>;
    return this.props.children;
  }
}

// ── presets → concrete [from, to] ────────────────────────────────────────
//  Windows end at `anchor` — the last day whose data looks COMPLETE — never at
//  today. Revenue lands a day behind, and the most recent day is often only
//  part-loaded, so ending on either drags every average down. The month is
//  taken from the anchor rather than from today, so on the 1st of a month
//  "MTD" resolves to the month that just finished instead of a zero-day range.
function resolvePreset(preset, customFrom, customTo, anchor) {
  switch (preset) {
    case 'MTD':        return { from: startOfMonth(anchor), to: anchor };
    case 'L7D':        return { from: shiftYMD(anchor, -6), to: anchor };
    case 'LM': {       // the whole month before the anchor's month
      const lm = shiftMonth(anchor, -1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
    case 'Single Day': return { from: customFrom, to: customFrom };
    default:           return { from: customFrom, to: customTo };   // Custom
  }
}

// ── the comparison window is DERIVED from the preset, never picked separately.
//    Month-shaped periods compare to the same span one calendar month back —
//    "MTD vs same period last month", which is how the Hex reports and the
//    reference dashboard both read it. Everything else compares to the
//    equal-length window immediately before. ──
function priorWindow(preset, from, to) {
  if (!from || !to) return { prevFrom: null, prevTo: null, label: '' };
  if (preset === 'MTD' || preset === 'LM') {
    const { prevFrom, prevTo } = sameSpanPrevMonth(from, to);
    return { prevFrom, prevTo, label: 'same span, previous calendar month' };
  }
  const len = daysBetween(from, to);           // inclusive
  const prevTo = shiftYMD(from, -1);
  const prevFrom = shiftYMD(prevTo, -(len - 1));
  return { prevFrom, prevTo, label: `preceding ${len} day${len === 1 ? '' : 's'}` };
}

// h1 names the page; `crumb` names the section it sits under. The two must not
// repeat each other — the header renders them as "h1 · crumb".
const VIEW_TITLES = {
  overview:    { h1: 'Business Overview',        crumb: 'P&L' },
  daily:       { h1: 'Daily Business Report',    crumb: 'Primary sales' },
  allch:       { h1: 'All Channels',             crumb: 'Cross-channel' },
  secondary:   { h1: 'Secondary Sales Trends',   crumb: 'Sell-out' },
  'mkt-daily': { h1: 'Daily Report',             crumb: 'Marketplace' },
  'mkt-city':  { h1: 'City Wise Sales',          crumb: 'Marketplace' },
  'web-daily': { h1: 'Daily Report',             crumb: 'Website' },
  'web-kwik':  { h1: 'GoKwik Retention',         crumb: 'Website' },
  'wbr-brand': { h1: 'Brand Market Share',       crumb: 'WBR' },
  'wbr-mkt':   { h1: 'Weekly Business Review',   crumb: 'Marketplace' },
  'wbr-web':   { h1: 'Weekly Business Review',   crumb: 'Website' },
};

// "01 Aug'26" — the compact date form the context header uses
function niceDate(ymd) {
  if (!ymd) return '—';
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[3]} ${M[+m[2] - 1]}'${m[1].slice(2)}`;
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [metric, setMetric] = useState('mrp');
  // A channel route ("ch:Amazon") is itself the scope — no separate control.
  const activeChannel = channelOf(view);

  // ── the revenue rows, declared up here because the date presets anchor to
  //    the last complete day IN the data rather than to the calendar. ──
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // date range
  const [preset, setPreset] = useState('MTD');
  // custom defaults also end a day back, for the same reason the presets do
  const [customFrom, setCustomFrom] = useState(shiftYMD(todayIST(), -30));
  const [customTo, setCustomTo] = useState(shiftYMD(todayIST(), -1));

  // ── Anchor = the newest day whose volume looks COMPLETE. The last loaded day
  //    is routinely a partial dump (we have seen ~8% of a normal day), which
  //    would drag every window's averages down and read as a crash. Walk back
  //    from the newest day until one clears half the trailing median, capped at
  //    a week so a genuine slump can never strand the anchor in the past.
  //    Falls back to D-1 before the data arrives. ──
  const dailyTotals = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) m.set(r.date, (m.get(r.date) || 0) + (r.sp || 0) + (r.mrp || 0));
    return m;
  }, [rows]);

  const anchor = useMemo(() => {
    const fallback = shiftYMD(todayIST(), -1);
    const days = [...dailyTotals.keys()].filter(d => dailyTotals.get(d) > 0).sort();
    if (!days.length) return fallback;
    const recent = days.slice(-15).map(d => dailyTotals.get(d)).sort((a, b) => a - b);
    const median = recent[Math.floor(recent.length / 2)] || 0;
    for (let i = days.length - 1; i >= 0 && i >= days.length - 7; i--) {
      if (!median || dailyTotals.get(days[i]) >= median * 0.5) return days[i];
    }
    return days[days.length - 1];
  }, [dailyTotals]);

  // The SKU/category matrices are a calendar-month trend, so they key off the
  // anchor's MONTH rather than the picker — the newest column is the current
  // month, still filling, exactly as the Hex notebook shows it.
  const matrixEndMonth = (anchor || todayIST()).slice(0, 7);

  const { from, to } = resolvePreset(preset, customFrom, customTo, anchor);

  // ── comparison window: derived by default, but overridable. `cmpMode` decides
  //    which one is in force; cmpFrom/cmpTo track the derived pair while on auto
  //    so switching to custom starts from what is already on screen. ──
  const [cmpMode, setCmpMode] = useState('auto');   // 'auto' | 'custom'
  const [cmpFrom, setCmpFrom] = useState(null);
  const [cmpTo, setCmpTo] = useState(null);

  const auto = priorWindow(preset, from, to);
  useEffect(() => {
    if (cmpMode === 'auto') { setCmpFrom(auto.prevFrom); setCmpTo(auto.prevTo); }
  }, [cmpMode, auto.prevFrom, auto.prevTo]);

  const isCustomCmp = cmpMode === 'custom' && cmpFrom && cmpTo;
  const prevFrom = isCustomCmp ? cmpFrom : auto.prevFrom;
  const prevTo   = isCustomCmp ? cmpTo   : auto.prevTo;
  const compareLabel = isCustomCmp ? 'custom comparison window' : auto.label;

  // when the user edits a date input we flip to Custom; keep customFrom/To synced from presets
  useEffect(() => {
    if (preset !== 'Custom') { setCustomFrom(from); setCustomTo(to); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // ── data: fetch the whole span once (from the earliest window we might show),
  //    then slice client-side per range. One round-trip; snappy range switching.
  //    State is declared above, since the date presets depend on it. ──
  const FETCH_FROM = '2025-01-01'; // pull generously; API caps by this floor

  const load = useCallback(async ({ force = false } = {}) => {
    setError(null);
    setLoading(l => l);            // stale-while-revalidate: keep old rows on refresh
    if (force) refreshAll();       // the ↻ button means "go back to the warehouse"
    try {
      const res = await fetchOverall(FETCH_FROM, todayIST());
      setRows(res.rows);
      setMeta(res.meta);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const hardRefresh = useCallback(() => load({ force: true }), [load]);

  // ── Warm the other tabs' endpoints once the first paint has settled, so a
  //    tab's FIRST visit is fast too, not just the return trips. Sequential and
  //    deliberately late: these are heavy warehouse queries, and racing them
  //    against the visible tab's own fetches would only slow that tab down.
  //    Everything lands in the same cache the views read, so a warmed tab
  //    renders without a spinner. Failures are silent by design. ──
  const warmed = React.useRef('');
  useEffect(() => {
    if (loading || error || !rows || !from || !to || !prevFrom || !prevTo) return;
    const key = [from, to, prevFrom, prevTo].join('|');
    if (warmed.current === key) return;      // already warmed for this window
    warmed.current = key;
    const dailyDate = shiftYMD(todayIST(), -1);
    const id = setTimeout(() => {
      prefetch([
        ['/mp-wbr',        { selStart: from, selEnd: to, prevStart: prevFrom, prevEnd: prevTo }],
        ['/web-wbr',       { selStart: from, selEnd: to, prevStart: prevFrom, prevEnd: prevTo }],
        ['/adspend',       { from, to, prevFrom, prevTo }],
        ['/mp-wbr-channel',{ channel: 'Amazon', selStart: from, selEnd: to, prevStart: prevFrom, prevEnd: prevTo }],
        ['/brand-share',   {}],
        ['/marketplace',   { date: dailyDate }],
        ['/website-daily', { date: dailyDate }],
        ['/daily',         { date: dailyDate, dataset: 'snapshot' }],
        ['/brand-city',    {}],
        ['/sku-matrix',    { endMonth: matrixEndMonth, months: 12 }],
        ['/secondary-filters', {}],
        ['/secondary-sales',   { from, to, prevFrom, prevTo, statusMode: 'all' }],
        ['/city-filters',      {}],
        ['/city-sales',        { from, to, grain: 'day', rowBy: 'city', measure: 'units', statusMode: 'all' }],
        ['/gokwik-filters',    {}],
        ['/gokwik',            { from, to, prevFrom, prevTo }],
      ]);
    }, 2500);
    return () => clearTimeout(id);
  }, [loading, error, rows, from, to, prevFrom, prevTo, matrixEndMonth]);

  // ── cube: channel × category × sub-category × SKU with cur + prior totals.
  //    Refetches when the window changes; powers treemap/heatmap/movers/drill-down. ──
  const [cube, setCube] = useState(null);
  const [cubeLoading, setCubeLoading] = useState(true);
  const cubeReq = React.useRef(0);
  useEffect(() => {
    if (!from || !to || !prevFrom || !prevTo) return;
    const myId = ++cubeReq.current;
    setCubeLoading(true);
    fetchCube(from, to, prevFrom, prevTo)
      .then(res => { if (myId === cubeReq.current) { setCube(res.rows); setCubeLoading(false); } })
      .catch(() => { if (myId === cubeReq.current) { setCube([]); setCubeLoading(false); } });
  }, [from, to, prevFrom, prevTo]);

  const t = activeChannel
    ? { h1: activeChannel, crumb: 'Marketplace' }
    : (VIEW_TITLES[view] || { h1: 'Revsight', crumb: '' });
  const statusNote = meta && meta.statusMode && meta.statusMode !== 'all' && !meta.statusConfirmed;

  // ── a channel route scopes the data for every panel on that page ──
  const vRows = useMemo(
    () => (!rows || !activeChannel ? rows : rows.filter(r => r.channel === activeChannel)),
    [rows, activeChannel]);
  const vCube = useMemo(
    () => (!cube || !activeChannel ? cube : cube.filter(r => r.channel === activeChannel)),
    [cube, activeChannel]);

  // ── Latest date that actually carries revenue, read from the loaded rows.
  //    The presets assume a one-day lag; if the pipeline falls further behind
  //    this makes that visible instead of letting the window quietly include
  //    empty days. ──
  const dataTill = useMemo(() => {
    if (!rows || !rows.length) return null;
    let mx = null;
    for (const r of rows) if ((r.mrp || r.sp) && (!mx || r.date > mx)) mx = r.date;
    return mx;
  }, [rows]);
  const lagDays = useMemo(() => {
    if (!dataTill) return null;
    return Math.round((Date.parse(todayIST()) - Date.parse(dataTill)) / 86400000);
  }, [dataTill]);

  // header counters, derived from the window actually on screen
  const channelCount = useMemo(() => {
    if (!vRows) return 0;
    const s = new Set();
    for (const r of vRows) if (r.date >= from && r.date <= to && (r.mrp || r.sp)) s.add(r.channel);
    return s.size;
  }, [vRows, from, to]);

  // "insights" = channels whose current-window revenue moved >10% vs the prior
  // window. A real count of things worth looking at, not a decorative badge.
  const insightCount = useMemo(() => {
    if (!vRows) return 0;
    const agg = (a, b) => {
      const m = new Map();
      for (const r of vRows) if (r.date >= a && r.date <= b) m.set(r.channel, (m.get(r.channel) || 0) + (r.sp || 0));
      return m;
    };
    const c = agg(from, to), p = agg(prevFrom, prevTo);
    let n = 0;
    for (const [ch, cv] of c) {
      const pv = p.get(ch) || 0;
      if (pv > 0 && Math.abs((cv - pv) / pv) > 0.10) n++;
    }
    return n;
  }, [vRows, from, to, prevFrom, prevTo]);

  // ── CSV export of the current window's channel × day rows. Kept honest: it
  //    ships the actual data behind the view, not a re-rendered summary. ──
  const onExport = useCallback(() => {
    const inWin = (rows || []).filter(r => r.date >= from && r.date <= to);
    if (!inWin.length) return;
    const cols = ['date', 'channel', 'group', 'mrp', 'sp', 'units', 'orders'];
    const esc = v => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [cols.join(','), ...inWin.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `revsight_${view}_${from}_to_${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [rows, from, to, view]);

  return (
    <>
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}

      <div className={'app' + (collapsed ? ' collapsed' : '')}>
        <Sidebar view={view} setView={setView} collapsed={collapsed} setCollapsed={setCollapsed}
          user={{ name: 'Deconstruct', email: 'database@thedeconstruct.in' }} />

        <div className="main">
          {/* ── header: title block + the two mono range controls ── */}
          <div className="topbar">
            <div className="pagehead">
              <div>
                <h1>
                  {activeChannel && logoFor(activeChannel) && (
                    <img className="ctx-scope-ic" src={logoFor(activeChannel)} alt=""
                      style={{ width: 20, height: 20, borderRadius: 4 }} />
                  )}
                  {t.h1}
                  <span className="sub">· {t.crumb || 'Revenue intelligence'}</span>
                </h1>
                <p>All your revenue and profitability data, in one place.</p>
              </div>
            </div>

            <div className="right">
              {/* Two matching boxes — period, then the window it compares
                  against. The comparison is still derived from the period;
                  its box exposes and overrides that, it is not a second
                  independent picker. Data freshness moved into the period
                  popover so the header stays two clean controls. */}
              <DateRange
                preset={preset} setPreset={setPreset}
                from={from} to={to}
                customFrom={customFrom} customTo={customTo}
                setCustomFrom={setCustomFrom} setCustomTo={setCustomTo}
                prevFrom={prevFrom} prevTo={prevTo} compareLabel={compareLabel}
                cmpMode={cmpMode} setCmpMode={setCmpMode}
                cmpFrom={cmpFrom} cmpTo={cmpTo} setCmpFrom={setCmpFrom} setCmpTo={setCmpTo}
                anchor={anchor} dataTill={dataTill} niceDate={niceDate}
              />

              <button className="roundbtn" onClick={hardRefresh}
                title="Discard cached responses and re-query" aria-label="Refresh data">↻</button>
              <button className="roundbtn" onClick={onExport} title="Download this view as CSV" aria-label="Export CSV">↓</button>
              <span className="byline">By Deconstruct</span>
            </div>
          </div>

          {/* ── filters strip: scope + metric-basis toggle ── */}
          <div className="filterstrip">
            <div className="fs-left">
              <span className="fs-label">Filters</span>
              {activeChannel && (
                <button className="fchip on" onClick={() => setView('allch')}
                  title="Clear the channel filter and return to All Channels">
                  <span className="plus">✕</span> {activeChannel}
                </button>
              )}
            </div>
            <div className="fs-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="metric-hint" style={{ marginTop: 0 }}>{METRICS[metric].hint}</span>
              <MetricToggle metric={metric} setMetric={setMetric} />
            </div>
          </div>

          <div className="page">

            {statusNote && (
              <div className="banner">
                <span className="b-ic">⚠</span>
                <span>
                  Revenue currently <b>{meta.statusMode === 'exclude' ? 'excludes' : 'includes only'}</b> order
                  statuses {meta.statusSet ? `(${meta.statusSet.slice(0, 4).join(', ')}${meta.statusSet.length > 4 ? '…' : ''})` : ''} — a provisional
                  filter. Confirm the exact set from your WBR so these totals reconcile.
                </span>
              </div>
            )}

            <ViewBoundary viewKey={view + metric}>
              <div key={view} className="view-anim">
              {loading && (
                <>
                  <KpiSkeletons />
                  <div className="grid-2">
                    <ChartSkeleton />
                    <ChartSkeleton />
                  </div>
                </>
              )}

              {!loading && error && <ErrorBox error={error} onRetry={load} />}

              {/* 1 · BUSINESS OVERVIEW — the company P&L */}
              {!loading && !error && vRows && view === 'overview' && (
                <Profitability data={vRows} meta={meta}
                  from={from} to={to} prevFrom={prevFrom} prevTo={prevTo} />
              )}

              {/* 2 · DAILY BUSINESS REPORT */}
              {view === 'daily' && <DailyReport />}

              {/* 3 · ALL CHANNELS — insights + overview + cross-channel detail */}
              {!loading && !error && vRows && view === 'allch' && (
                <>
                  <OpsInsights rows={vRows} from={from} to={to}
                    prevFrom={prevFrom} prevTo={prevTo} metric={metric} />
                  <div className="opanel">
                    <div className="opanel-head">
                      <span className="opanel-title">
                        <span className="opanel-ic">◈</span> Overview
                        <span className="opanel-at">at <span className="atchip">{METRICS[metric].label}</span>
                          for <span className="atchip neutral">all channels</span></span>
                      </span>
                      <span className="opanel-tools">
                        <span className="infopill">{niceDate(from)} – {niceDate(to)}</span>
                      </span>
                    </div>
                    <div className="opanel-body">
                      <OpsOverview rows={vRows} from={from} to={to}
                        prevFrom={prevFrom} prevTo={prevTo} metric={metric} />
                    </div>
                  </div>
                  <CrossChannel
                    data={vRows} cube={vCube} cubeLoading={cubeLoading} meta={meta}
                    from={from} to={to} prevFrom={prevFrom} prevTo={prevTo}
                    metric={metric}
                  />
                  {/* month-over-month SKU/category matrices — calendar months,
                      so they anchor on the last complete month, not the picker */}
                  <SkuMatrix endMonth={matrixEndMonth} months={12} />
                </>
              )}

              {/* 3b · SECONDARY SALES — sell-out trends, its own basis */}
              {view === 'secondary' && (
                <SecondarySales from={from} to={to} prevFrom={prevFrom} prevTo={prevTo} />
              )}

              {/* 4 · MARKETPLACE › one channel */}
              {!loading && !error && vRows && activeChannel && (
                <ChannelDeepDive
                  key={activeChannel}
                  forceChannel={activeChannel}
                  allRows={rows} cube={cube} cubeLoading={cubeLoading} meta={meta}
                  from={from} to={to} prevFrom={prevFrom} prevTo={prevTo}
                  metric={metric}
                />
              )}

              {/* 4b · MARKETPLACE › daily report */}
              {view === 'mkt-daily' && <DailyMarketplaces />}

              {/* 4c · MARKETPLACE > city-wise sales */}
              {view === 'mkt-city' && <CitySales from={from} to={to} />}

              {/* 5b - WEBSITE > GoKwik retention */}
              {view === 'web-kwik' && (
                <GokwikRetention from={from} to={to} prevFrom={prevFrom} prevTo={prevTo} />
              )}

              {/* 5 · WEBSITE › daily report */}
              {view === 'web-daily' && <DailyWebsite />}

              {/* 6 · WBR › brand */}
              {view === 'wbr-brand' && <WbrBrand />}

              {/* 6b · WBR › marketplace — the notebook's OVERALL-MP table, then
                     the narrative review beneath it */}
              {view === 'wbr-mkt' && (
                <>
                  <div className="nsec rise">
                    <span className="num">01</span>
                    <div className="txt">
                      <h2>Overall · Marketplace</h2>
                      <p>{niceDate(from)} → {niceDate(to)} vs {niceDate(prevFrom)} → {niceDate(prevTo)} · target prorated to the window</p>
                    </div>
                  </div>
                  <WbrMarketplaceTable
                    selStart={from} selEnd={to} prevStart={prevFrom} prevEnd={prevTo} />

                  <div className="nsec rise d1">
                    <span className="num">02</span>
                    <div className="txt">
                      <h2>Channel scorecards</h2>
                      <p>pick a marketplace · percentage metrics change in basis points</p>
                    </div>
                  </div>
                  <WbrChannelScorecard
                    selStart={from} selEnd={to} prevStart={prevFrom} prevEnd={prevTo} />

                  <div className="nsec rise d2">
                    <span className="num">03</span>
                    <div className="txt">
                      <h2>What moved</h2>
                      <p>auto-generated narrative for the same window</p>
                    </div>
                  </div>
                </>
              )}

              {view === 'wbr-web' && (
                <>
                  <div className="nsec rise">
                    <span className="num">01</span>
                    <div className="txt">
                      <h2>Website scorecard</h2>
                      <p>{niceDate(from)} → {niceDate(to)} vs {niceDate(prevFrom)} → {niceDate(prevTo)} · percentage metrics change in basis points</p>
                    </div>
                  </div>
                  <WbrWebsite selStart={from} selEnd={to} prevStart={prevFrom} prevEnd={prevTo} />
                  <div className="nsec rise d2">
                    <span className="num">02</span>
                    <div className="txt">
                      <h2>What moved</h2>
                      <p>auto-generated narrative for the same window</p>
                    </div>
                  </div>
                </>
              )}

              {/* 6c · WBR › narrative review (both segments) */}
              {!loading && !error && vRows && (view === 'wbr-mkt' || view === 'wbr-web') && (
                <WeeklyReview key={view} segment={view === 'wbr-web' ? 'website' : 'marketplace'}
                  data={vRows} cube={vCube} cubeLoading={cubeLoading} meta={meta}
                  from={from} to={to} prevFrom={prevFrom} prevTo={prevTo} metric={metric} />
              )}
              </div>
            </ViewBoundary>
          </div>

          {/* jumps to the auto-written narrative for the current window */}
          <button className="askfab" onClick={() => setView('wbr-mkt')}
            title={insightCount + ' channels moved more than 10% this window'}>
            ✦ Ask Revsight
          </button>
        </div>
      </div>
    </>
  );
}
