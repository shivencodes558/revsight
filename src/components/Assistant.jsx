import React, { useState, useRef, useEffect } from 'react';
import { getJSON } from '../lib/api.js';
import { estimatePL } from '../lib/pl.js';
import { inrShort, indianGroup } from '../lib/format.js';
import { shiftYMD, daysBetween } from '../dateUtils.js';

/*════════════════════════════════════════════════════════════════════════
  ASK REVIS — structured query engine (no AI, no external calls).
  Same mechanism as Adsight's "Ask Decode": a rule-based parser resolves a
  free-text question into a structured query, then answers it by aggregating
  data ALREADY loaded in the dashboard (no new round trips, except ad spend
  and P&L lines, which are cheap cached/derived lookups). Every number is
  computed from the same sources the dashboard itself renders from — nothing
  is invented.

  Two data shapes, used for different dimensions:
    • `rows`  — channel × day, {sp, mrp, units, orders}, full history
                (fetchOverall). Powers CHANNEL-level questions over ANY
                period, since the full date range is already loaded.
    • `cube`  — channel × category × subCategory × product, cur/prev totals
                for the app's ACTIVE date window only (fetchCube). Powers
                CATEGORY / SUB-CATEGORY / PRODUCT questions, but only within
                whatever window is currently selected up top — flagged in a
                caveat when a question asks for a different period.
════════════════════════════════════════════════════════════════════════*/
const ASSISTANT_NAME = 'Rev';

const ASST_METRICS = ['mrpSales', 'spSales', 'units', 'orders', 'aov', 'discount', 'netRevenue', 'cm1', 'cm2', 'cm3', 'tacos', 'roas'];
const ASST_DIMS = [
  { id: 'channel', label: 'Channel' }, { id: 'category', label: 'Category' },
  { id: 'subCategory', label: 'Sub-category' }, { id: 'product', label: 'Product' },
];
// metrics only resolvable at channel grain (need `orders`, ad spend, or P&L ratios —
// none of which exist per category/sub-category/product in the loaded cube)
const CHANNEL_ONLY_METRICS = ['orders', 'aov', 'netRevenue', 'cm1', 'cm2', 'cm3', 'tacos', 'roas'];

const MLABEL = {
  mrpSales: 'MRP Sales', spSales: 'Sec Sales', units: 'Units', orders: 'Orders', aov: 'AOV',
  discount: 'Discount %', netRevenue: 'Net Revenue', cm1: 'CM1 %', cm2: 'CM2 %', cm3: 'CM3 %',
  tacos: 'TACOS %', roas: 'ROAS',
};
const money = v => (v == null || isNaN(v) ? '—' : inrShort(v));
const MFMT = {
  mrpSales: money, spSales: money, netRevenue: money,
  units: v => (v == null ? '—' : indianGroup(Math.round(v))),
  orders: v => (v == null ? '—' : indianGroup(Math.round(v))),
  aov: v => (v == null ? '—' : '₹' + indianGroup(Math.round(v))),
  discount: v => (v == null ? '—' : v.toFixed(1) + '%'),
  cm1: v => (v == null ? '—' : v.toFixed(1) + '%'),
  cm2: v => (v == null ? '—' : v.toFixed(1) + '%'),
  cm3: v => (v == null ? '—' : v.toFixed(1) + '%'),
  tacos: v => (v == null ? '—' : v.toFixed(1) + '%'),
  roas: v => (v == null ? '—' : v.toFixed(2) + 'x'),
};
const mLabel = m => MLABEL[m] || m;
const mFmt = (m, v) => (MFMT[m] ? MFMT[m](v) : (v == null ? '—' : String(v)));
const GOOD_LOW = new Set(['discount', 'tacos']);           // lower reads better for these
const dimLabel = id => (ASST_DIMS.find(d => d.id === id) || {}).label || id;

// ── derived fields shared by every aggregate bucket ──
function withDerived(a) {
  return {
    ...a,
    aov: a.orders ? a.sp / a.orders : null,
    discount: a.mrp ? (1 - a.sp / a.mrp) * 100 : null,
  };
}
const EMPTY_BUCKET = { sp: 0, mrp: 0, units: 0, orders: 0 };

// sum `rows` (channel/day grain) over [start,end], optionally grouped by `dim` (channel only)
function aggRows(rows, start, end, dim) {
  if (!dim) {
    const a = { ...EMPTY_BUCKET };
    for (const r of rows) { if (r.date < start || r.date > end) continue;
      a.sp += r.sp || 0; a.mrp += r.mrp || 0; a.units += r.units || 0; a.orders += r.orders || 0; }
    return withDerived(a);
  }
  const m = {};
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    const k = r[dim]; if (k == null) continue;
    const a = m[k] || (m[k] = { ...EMPTY_BUCKET });
    a.sp += r.sp || 0; a.mrp += r.mrp || 0; a.units += r.units || 0; a.orders += r.orders || 0;
  }
  const out = {};
  for (const k in m) out[k] = withDerived(m[k]);
  return out;
}

// sum `cube` rows (category/subCategory/product grain) for the app's active window,
// optionally grouped by `dim`. `which`: 'cur' | 'prev'.
function aggCube(cube, dim, which) {
  const pick = r => ({ sp: r[which + 'Sp'] || 0, mrp: r[which + 'Mrp'] || 0, units: r[which + 'Units'] || 0, orders: 0 });
  if (!dim) {
    const a = { ...EMPTY_BUCKET };
    for (const r of cube) { const p = pick(r); a.sp += p.sp; a.mrp += p.mrp; a.units += p.units; }
    return withDerived(a);
  }
  const m = {};
  for (const r of cube) {
    const k = r[dim]; if (k == null || k === '' || k === '(unmapped)') continue;
    const p = pick(r);
    const a = m[k] || (m[k] = { ...EMPTY_BUCKET });
    a.sp += p.sp; a.mrp += p.mrp; a.units += p.units;
  }
  const out = {};
  for (const k in m) out[k] = withDerived(m[k]);
  return out;
}

const metricVal = (m, agg) => (agg ? agg[m] : null);

// ── entity name matching — scans the ACTUAL loaded data, never a hardcoded list ──
function uniqVals(rows, cube, dim) {
  const s = new Set();
  if (dim === 'channel') { (rows || []).forEach(r => { if (r.channel) s.add(r.channel); }); }
  else { (cube || []).forEach(r => { if (r[dim]) s.add(String(r[dim])); }); }
  return [...s];
}
function matchEntity(low, rows, cube) {
  for (const dim of ['channel', 'product', 'subCategory', 'category']) {
    const vals = uniqVals(rows, cube, dim).sort((a, b) => b.length - a.length);
    const hit = vals.find(v => { const vl = v.toLowerCase().trim(); return vl.length >= 3 && low.includes(vl); });
    if (hit) return { dim, val: hit };
  }
  return null;
}

// ── free-text → structured query (no AI) ──
function asstParse(text) {
  const t = ' ' + text.toLowerCase().replace(/[^a-z0-9% ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const q = {};
  const metricKw = [
    ['mrpSales', ['mrp sales', 'mrp', 'gross sales', 'gross revenue']],
    ['spSales', ['sec sales', 'sp sales', 'secondary sales', 'net sales', 'sales']],
    ['units', ['unit', 'units', 'volume']],
    ['orders', ['order', 'orders']],
    ['aov', ['aov', 'asp', 'average order']],
    ['discount', ['discount']],
    ['netRevenue', ['net revenue']],
    ['cm1', ['cm1', 'contribution margin 1', 'unit economics']],
    ['cm2', ['cm2', 'contribution margin 2']],
    ['cm3', ['cm3', 'contribution margin 3', 'profitability']],
    ['tacos', ['tacos']],
    ['roas', ['roas', 'return on ad']],
  ];
  for (const [m, ks] of metricKw) { if (ks.some(k => t.includes(' ' + k + ' ') || t.includes(' ' + k))) { q.metric = m; break; } }
  const dimKw = [
    ['channel', ['channel', 'channels', 'marketplace', 'platform']],
    ['product', ['product', 'products', 'sku', 'skus']],
    ['subCategory', ['sub category', 'sub-category', 'subcategory']],
    ['category', ['category', 'categories']],
  ];
  for (const [d, ks] of dimKw) { if (ks.some(k => t.includes(' ' + k))) { q.dimension = d; break; } }
  if (/\btop\b|\bbottom\b/.test(t)) { q.qtype = 'topn'; const n = t.match(/\b(top|bottom)\s+(\d+)/); q.n = n ? +n[2] : 5; q.direction = /\bbottom\b/.test(t) ? 'worst' : 'best'; }
  else if (/\bbest\b|\bworst\b|\bhighest\b|\blowest\b|\bwhich\b/.test(t)) { q.qtype = 'ranking'; q.direction = (/\bworst\b|\blowest\b/.test(t)) ? 'worst' : 'best'; }
  else if (/\bcompare\b|\bacross\b|\bby (channel|category|sku|product|sub.?category)/.test(t)) { q.qtype = 'comparison'; }
  else if (/\bchange\b|\bwow\b|\bmom\b|\bgrow|\bdrop|\bdeclin|\bincreas|\bvs\b|\bversus\b/.test(t)) { q.qtype = 'change'; }
  else if (/\bbelow\b|\babove\b|\bunder\b|\bover\b|\bless than\b|\bmore than\b/.test(t)) { q.qtype = 'threshold'; q.op = (/\babove\b|\bover\b|\bmore than\b/.test(t)) ? 'gt' : 'lt'; const num = t.match(/(\d+(\.\d+)?)/); q.threshold = num ? +num[1] : 0; }
  else q.qtype = 'lookup';
  return q;
}

// month name → {start,end,label}, resolved against the most recent calendar
// occurrence at or before `maxDate` (not a hardcoded year, unlike a quick hack would be)
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function parsePeriod(text, maxDate) {
  const t = text.toLowerCase();
  const max = maxDate ? new Date(maxDate + 'T00:00:00') : new Date();
  const ymRange = (y, mIdx) => {
    const start = new Date(y, mIdx, 1), end = new Date(y, mIdx + 1, 0);
    const f = d => d.toISOString().slice(0, 10);
    return { start: f(start), end: f(end) };
  };
  if (/\blast month\b/.test(t)) { const d = new Date(max.getFullYear(), max.getMonth() - 1, 1); return { ...ymRange(d.getFullYear(), d.getMonth()), label: MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear() }; }
  if (/\bthis month\b/.test(t)) { return { ...ymRange(max.getFullYear(), max.getMonth()), label: MONTH_NAMES[max.getMonth()] + ' ' + max.getFullYear() + ' (MTD)', end: maxDate }; }
  for (const mk in MONTHS) {
    if (new RegExp('\\b' + mk + '[a-z]*\\b').test(t)) {
      let y = max.getFullYear(), mIdx = MONTHS[mk];
      if (mIdx > max.getMonth()) y -= 1; // most recent past occurrence
      const yrMatch = t.match(/\b(20\d{2})\b/); if (yrMatch) y = +yrMatch[1];
      return { ...ymRange(y, mIdx), label: MONTH_NAMES[mIdx] + ' ' + y };
    }
  }
  return null;
}

/*════════════════════════ core resolver ════════════════════════*/
function asstResolve(q, { rows, cube, from, to, activeLabel }) {
  const usingCube = CHANNEL_ONLY_METRICS.includes(q.metric) ? false : (q.dimension && q.dimension !== 'channel');
  const caveats = [];
  let period = q.period || { start: from, end: to, label: activeLabel };
  if (usingCube && q.period) {
    caveats.push(dimLabel(q.dimension) + ' breakdowns are only available for the active window (' + activeLabel + '); showing that instead of ' + q.period.label + '.');
    period = { start: from, end: to, label: activeLabel };
  }

  const getAgg = (dim) => usingCube
    ? aggCube(cube || [], dim, 'cur')
    : aggRows(rows || [], period.start, period.end, dim);

  if (q.qtype === 'lookup') {
    const agg = getAgg(null);
    const v = metricVal(q.metric, agg);
    return { text: mLabel(q.metric) + ' across all channels in ' + period.label + ' was ' + mFmt(q.metric, v) + '.', caveats };
  }

  if (q.qtype === 'ranking' || q.qtype === 'topn') {
    const groups = getAgg(q.dimension);
    let arr = Object.keys(groups).map(k => ({ k, agg: groups[k] })).filter(x => metricVal(q.metric, x.agg) != null);
    if (!arr.length) return { text: 'No ' + dimLabel(q.dimension) + ' data to rank for ' + period.label + '.', caveats };
    const goodLow = GOOD_LOW.has(q.metric);
    arr.sort((a, b) => goodLow ? metricVal(q.metric, a.agg) - metricVal(q.metric, b.agg) : metricVal(q.metric, b.agg) - metricVal(q.metric, a.agg));
    if (q.qtype === 'ranking') {
      const want = q.direction === 'worst' ? arr[arr.length - 1] : arr[0];
      const runnerUp = q.direction === 'worst' ? arr[arr.length - 2] : arr[1];
      let txt = (q.direction === 'worst' ? 'Lowest ' : 'Best ') + mLabel(q.metric) + ' by ' + dimLabel(q.dimension) + ' in ' + period.label + ': ' + want.k + ' at ' + mFmt(q.metric, metricVal(q.metric, want.agg));
      if (runnerUp) txt += ', ' + (q.direction === 'worst' ? 'then ' : 'ahead of ') + runnerUp.k + ' (' + mFmt(q.metric, metricVal(q.metric, runnerUp.agg)) + ')';
      return { text: txt + '.', caveats };
    }
    if (q.direction === 'worst') arr.reverse();
    const n = q.n || 5; const top = arr.slice(0, n);
    const lines = top.map((x, i) => (i + 1) + '. ' + x.k + ' — ' + mFmt(q.metric, metricVal(q.metric, x.agg)));
    return { rich: { blocks: [['Top ' + top.length + ' by ' + mLabel(q.metric) + ' in ' + period.label, lines]], ctx: period.label }, caveats };
  }

  if (q.qtype === 'comparison') {
    const groups = getAgg(q.dimension);
    const arr = Object.keys(groups).map(k => ({ k, agg: groups[k] })).filter(x => metricVal(q.metric, x.agg) != null);
    const goodLow = GOOD_LOW.has(q.metric);
    arr.sort((a, b) => goodLow ? metricVal(q.metric, a.agg) - metricVal(q.metric, b.agg) : metricVal(q.metric, b.agg) - metricVal(q.metric, a.agg));
    const lines = arr.map(x => x.k + ' — ' + mFmt(q.metric, metricVal(q.metric, x.agg)));
    return { rich: { blocks: [[mLabel(q.metric) + ' by ' + dimLabel(q.dimension) + ' in ' + period.label, lines]], ctx: period.label }, caveats };
  }

  if (q.qtype === 'threshold') {
    const groups = getAgg(q.dimension);
    const arr = Object.keys(groups).map(k => ({ k, agg: groups[k] })).filter(x => metricVal(q.metric, x.agg) != null);
    const op = q.op || 'lt'; const thr = q.threshold;
    const hits = arr.filter(x => op === 'lt' ? metricVal(q.metric, x.agg) < thr : metricVal(q.metric, x.agg) > thr);
    if (!hits.length) return { text: 'No ' + dimLabel(q.dimension) + ' had ' + mLabel(q.metric) + (op === 'lt' ? ' below ' : ' above ') + thr + ' in ' + period.label + '.', caveats };
    const lines = hits.map(x => x.k + ' — ' + mFmt(q.metric, metricVal(q.metric, x.agg)));
    return { rich: { blocks: [[dimLabel(q.dimension) + 's with ' + mLabel(q.metric) + (op === 'lt' ? ' below ' : ' above ') + thr + ' in ' + period.label, lines]], ctx: period.label }, caveats };
  }

  if (q.qtype === 'change') {
    if (usingCube) {
      const curA = getAgg(null), prevA = aggCube(cube || [], null, 'prev');
      const c = metricVal(q.metric, curA), p = metricVal(q.metric, prevA);
      if (c == null || p == null) return { text: 'Not enough data to compute that change.', caveats };
      const d = p ? ((c - p) / Math.abs(p)) * 100 : null;
      return { text: mLabel(q.metric) + ' was ' + mFmt(q.metric, c) + ' in the active window, ' + (d == null ? 'no prior data' : ((d >= 0 ? 'up ' : 'down ') + Math.abs(d).toFixed(1) + '% vs the comparison window')) + '.', caveats };
    }
    const days = daysBetween(period.start, period.end);
    const prevEnd = shiftYMD(period.start, -1), prevStart = shiftYMD(prevEnd, -(days - 1));
    const curAgg = aggRows(rows || [], period.start, period.end, null);
    const prevAgg = aggRows(rows || [], prevStart, prevEnd, null);
    const c = metricVal(q.metric, curAgg), p = metricVal(q.metric, prevAgg);
    if (c == null || p == null) return { text: 'Not enough prior data to compute that change.', caveats };
    const d = p ? ((c - p) / Math.abs(p)) * 100 : null;
    return { text: mLabel(q.metric) + ' was ' + mFmt(q.metric, c) + ' in ' + period.label + ', ' + (d == null ? 'no prior data' : ((d >= 0 ? 'up ' : 'down ') + Math.abs(d).toFixed(1) + '% vs the preceding ' + days + '-day period')) + '.', caveats };
  }

  return { text: "I couldn't map that to a question I can answer yet." };
}

// ── channel-level executive summary, built the same way deconContextSummary
//    does it in Adsight: deterministic, reuses the same aggregates, never
//    invents a number. Grounded in the app's own active TIME PERIOD / COMPARE
//    WITH window, so it always matches what's on screen. ──
function contextSummary(rows, from, to, prevFrom, prevTo) {
  if (!rows || !rows.length) return { summary: ['No data loaded yet.'], drivers: [], actions: [] };
  const a = aggRows(rows, from, to, null);
  const b = (prevFrom && prevTo) ? aggRows(rows, prevFrom, prevTo, null) : null;
  const pc = (c, p) => (p == null || p === 0) ? null : ((c - p) / Math.abs(p)) * 100;
  const sa = p => p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(0) + '%';
  const dMrp = b ? pc(a.mrp, b.mrp) : null, dSp = b ? pc(a.sp, b.sp) : null;
  const byChannel = aggRows(rows, from, to, 'channel');
  const byChannelPrev = b ? aggRows(rows, prevFrom, prevTo, 'channel') : {};
  const movers = Object.keys(byChannel).map(k => {
    const c = byChannel[k], p = byChannelPrev[k];
    return { k, sp: c.sp, dSp: p ? pc(c.sp, p.sp) : null };
  }).filter(x => x.sp > 0);
  const top = [...movers].sort((x, y) => y.sp - x.sp)[0];
  const gainers = movers.filter(x => x.dSp != null && x.dSp > 0).sort((x, y) => y.dSp - x.dSp).slice(0, 2);
  const decliners = movers.filter(x => x.dSp != null && x.dSp < 0).sort((x, y) => x.dSp - y.dSp).slice(0, 2);

  let pl = null;
  try { pl = estimatePL({ grossMrp: a.mrp, netSp: a.sp }); } catch { /* best-effort */ }

  const summary = [], drivers = [], actions = [];
  if (b) {
    summary.push('Sec Sales ' + (dSp >= 0 ? 'grew' : 'softened') + ' ' + sa(dSp) + ' to ' + money(a.sp) + ' vs the comparison window' + (dMrp != null ? (', on ' + (dMrp >= 0 ? 'higher' : 'lower') + ' MRP Sales (' + sa(dMrp) + ')') : '') + '.');
  } else {
    summary.push('Sec Sales for the active window: ' + money(a.sp) + ' on ' + money(a.mrp) + ' MRP Sales — no comparison window set, so this is a current-period read-out.');
  }
  if (pl) {
    const cm1Txt = pl.lines.cm1.pct != null ? (pl.lines.cm1.pct * 100).toFixed(1) + '%' : '—';
    summary.push('Net Revenue ~' + money(pl.lines.netRevenue.value) + ', CM1 ~' + cm1Txt + ' (estimated from July ratios, same basis as Business Overview).');
  }
  if (top) drivers.push(top.k + ' is the largest channel by Sec Sales (' + money(top.sp) + ').');
  if (gainers.length) drivers.push('Growth led by ' + gainers.map(g => g.k + ' (' + sa(g.dSp) + ')').join(', ') + '.');
  if (decliners.length) drivers.push('Drag from ' + decliners.map(g => g.k + ' (' + sa(g.dSp) + ')').join(', ') + '.');
  if (decliners.length) actions.push('Review ' + decliners[0].k + ' — Sec Sales ' + sa(decliners[0].dSp) + ' vs the comparison window.');
  if (a.discount != null && a.discount > 30) actions.push('Discount is running at ' + a.discount.toFixed(1) + '% of MRP — worth checking which channels are driving it.');
  return { summary, drivers, actions };
}

/*════════════════════════ UI ════════════════════════*/
function AnswerCard({ data }) {
  const { blocks, ctx } = data;
  return (
    <div className="ask-card">
      <div className="ask-card-head">
        <span className="ask-card-tag">{ASSISTANT_NAME.toUpperCase()}</span>
        {ctx && <span className="ask-card-ctx">{ctx}</span>}
      </div>
      {blocks.map((blk, bi) => {
        const [title, items] = blk;
        if (!items || !items.length) return null;
        return (
          <div key={bi} className="ask-card-block">
            <div className="ask-card-title">{title}</div>
            <ul>{items.map((it, ii) => <li key={ii}>{it}</li>)}</ul>
          </div>
        );
      })}
      <div className="ask-card-foot">{ASSISTANT_NAME} · grounded in your live dashboard data · figures are computed, not generated</div>
    </div>
  );
}

const SUGGESTIONS = [
  'What changed versus the comparison period?',
  'Top 5 channels by Sec Sales',
  'Which channels need attention?',
  "What's our CM1% this window?",
  'Compare discount % across channels',
  "What's the TACOS across all channels?",
  'Which categories are growing?',
  'Where should I focus next?',
];

export default function Assistant({ rows, cube, from, to, prevFrom, prevTo }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const greeting = { role: 'asst', text: "Hi, I'm " + ASSISTANT_NAME + " — your revenue intelligence copilot. I read your active dashboard context automatically. Ask me about sales, discount, TACOS, CM1–3 or any channel/category/product breakdown — or tap a suggestion below." };
  const [msgs, setMsgs] = useState([greeting]);
  const endRef = useRef(null);
  useEffect(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, [msgs, open, typing]);

  const maxDate = (rows && rows.length) ? rows[rows.length - 1].date : to;
  const fmtP = s => { if (!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); };
  const activeLabel = fmtP(from) + '–' + fmtP(to);
  const ctxLabel = activeLabel + (prevFrom && prevTo ? (' vs ' + fmtP(prevFrom) + '–' + fmtP(prevTo)) : '');

  const pushAsst = (payload) => { setTyping(true); setTimeout(() => { setTyping(false); setMsgs(m => [...m, { role: 'asst', ...payload }]); }, 520); };

  const answerContext = (intent) => {
    const r = contextSummary(rows, from, to, prevFrom, prevTo);
    let blocks;
    if (intent === 'changed') blocks = [['What changed', r.summary]];
    else if (intent === 'drivers') blocks = [['Key drivers', r.drivers.length ? r.drivers : ['No standout movers in the active window.']]];
    else if (intent === 'focus') blocks = [['Where to focus', r.actions.length ? r.actions : ['No clear signal in the active window.']]];
    else blocks = [['Summary', r.summary], ['Key drivers', r.drivers], ['Recommended actions', r.actions]];
    pushAsst({ rich: { blocks, ctx: ctxLabel } });
  };

  const answerRanked = (dim, dir) => {
    const groups = aggRows(rows || [], from, to, dim);
    const meanDiscount = aggRows(rows || [], from, to, null).discount;
    let arr = Object.keys(groups).map(k => ({ k, agg: groups[k] })).filter(x => x.agg.sp > 0);
    const label = dimLabel(dim);
    let title, lines;
    if (dir === 'attention') {
      arr = arr.filter(x => x.agg.discount != null).sort((a, b) => b.agg.discount - a.agg.discount).slice(0, 5);
      title = label + 's needing attention (highest discount)';
      lines = arr.map(x => x.k + ' — ' + x.agg.discount.toFixed(1) + '% discount on ' + money(x.agg.sp) + ' Sec Sales' + (meanDiscount != null && x.agg.discount > meanDiscount ? ' (above the ' + meanDiscount.toFixed(1) + '% portfolio line)' : ''));
    } else {
      arr = arr.sort((a, b) => b.agg.sp - a.agg.sp).slice(0, 5);
      title = 'Top ' + label.toLowerCase() + 's by Sec Sales';
      lines = arr.map(x => x.k + ' — ' + money(x.agg.sp) + ' Sec Sales, ' + (x.agg.discount != null ? x.agg.discount.toFixed(1) + '% discount' : '—'));
    }
    pushAsst({ rich: { blocks: [[title, lines]], ctx: ctxLabel } });
  };

  const answerEntity = (low) => {
    const m = matchEntity(low, rows, cube); if (!m) return false;
    let cur, prev, label;
    if (m.dim === 'channel') {
      cur = aggRows((rows || []).filter(r => r.channel === m.val), from, to, null);
      prev = (prevFrom && prevTo) ? aggRows((rows || []).filter(r => r.channel === m.val), prevFrom, prevTo, null) : null;
      label = 'Channel';
    } else {
      const curAll = aggCube(cube || [], m.dim, 'cur'), prevAll = aggCube(cube || [], m.dim, 'prev');
      cur = curAll[m.val]; prev = prevAll[m.val];
      label = m.dim === 'product' ? 'Product' : m.dim === 'subCategory' ? 'Sub-category' : 'Category';
    }
    if (!cur) { pushAsst({ text: 'No data for "' + m.val + '" in the active window.' }); return true; }
    const pct = (c, p) => (prev && p) ? (((c - p) / Math.abs(p)) * 100) : null;
    const dtxt = (c, p) => { const pc = pct(c, p); return pc == null ? '' : (' (' + (pc >= 0 ? '+' : '') + pc.toFixed(0) + '% vs comparison)'); };
    const lines = [
      'MRP Sales: ' + money(cur.mrp) + (prev ? dtxt(cur.mrp, prev.mrp) : ''),
      'Sec Sales: ' + money(cur.sp) + (prev ? dtxt(cur.sp, prev.sp) : ''),
      'Units: ' + indianGroup(Math.round(cur.units)) + (prev ? dtxt(cur.units, prev.units) : ''),
      'Discount %: ' + (cur.discount != null ? cur.discount.toFixed(1) + '%' : '—'),
    ];
    if (cur.orders) lines.splice(2, 0, 'Orders: ' + indianGroup(Math.round(cur.orders)) + (prev ? dtxt(cur.orders, prev.orders) : ''), 'AOV: ' + (cur.aov != null ? '₹' + indianGroup(Math.round(cur.aov)) : '—'));
    pushAsst({ rich: { blocks: [[label + ': ' + m.val, lines]], ctx: ctxLabel } });
    return true;
  };

  const answerTACOS = async (low) => {
    try {
      const res = await getJSON('/adspend', { from, to, prevFrom, prevTo });
      const cur = res.cur || [], prev = res.prev || [];
      const salesByCh = aggRows(rows || [], from, to, 'channel');
      const prevSalesByCh = (prevFrom && prevTo) ? aggRows(rows || [], prevFrom, prevTo, 'channel') : {};
      const scopeCh = matchEntity(low, rows, []);
      const wantCh = scopeCh && scopeCh.dim === 'channel' ? scopeCh.val : null;
      const lines = [];
      const chans = wantCh ? [wantCh] : [...new Set(cur.map(r => r.channel))];
      chans.forEach(ch => {
        const spend = (cur.find(r => r.channel === ch) || {}).spend || 0;
        const sales = (salesByCh[ch] || {}).sp || 0;
        if (!sales && !spend) return;
        const tac = sales ? (spend / sales) * 100 : null;
        const pSpend = (prev.find(r => r.channel === ch) || {}).spend || 0;
        const pSales = (prevSalesByCh[ch] || {}).sp || 0;
        const pTac = pSales ? (pSpend / pSales) * 100 : null;
        const d = (tac != null && pTac != null) ? tac - pTac : null;
        lines.push(ch + ': ' + (tac != null ? tac.toFixed(1) + '%' : '—') + (d != null ? (' (' + (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp vs comparison' + (d <= 0 ? ' — improving' : ' — rising') + ')') : ''));
      });
      if (!lines.length) { pushAsst({ text: "Ad spend data isn't available for the active window yet." }); return; }
      pushAsst({ rich: { blocks: [['TACOS % (ad spend ÷ Sec Sales)' + (wantCh ? ' · ' + wantCh : ' · all channels'), lines]], ctx: ctxLabel } });
    } catch {
      pushAsst({ text: "Couldn't load ad spend data just now — try again in a moment." });
    }
  };

  const answerCM = async (metric) => {
    const a = aggRows(rows || [], from, to, null);
    let adSpend = null;
    try { const res = await getJSON('/adspend', { from, to, prevFrom, prevTo }); adSpend = (res.cur || []).reduce((s, r) => s + (r.spend || 0), 0); } catch { /* best-effort, P&L falls back to estimated */ }
    const pl = estimatePL({ grossMrp: a.mrp, netSp: a.sp, adSpend });
    const line = pl.lines[metric];
    if (!line) { pushAsst({ text: "Couldn't compute that P&L line." }); return; }
    const pctTxt = line.pct != null ? (line.pct * 100).toFixed(1) + '%' : '—';
    pushAsst({ rich: { blocks: [[line.label, [money(line.value) + ' (' + pctTxt + ' of Net Revenue) · ' + line.kind + ' basis']]], ctx: ctxLabel } });
  };

  const askText = (forced) => {
    const t = (forced != null ? forced : text);
    if (!t.trim()) return;
    setMsgs(m => [...m, { role: 'user', text: t }]); setText('');
    const low = t.toLowerCase();

    if (/tacos|total ad cost|ad cost of sale/.test(low)) { answerTACOS(low); return; }
    if (/\bcm1\b|unit economics/.test(low)) { answerCM('cm1'); return; }
    if (/\bcm2\b/.test(low)) { answerCM('cm2'); return; }
    if (/\bcm3\b|profitability/.test(low)) { answerCM('cm3'); return; }
    if (/net revenue/.test(low)) { answerCM('netRevenue'); return; }

    const lookupPhrase = /how (is|are|.?s)|how.?s|metrics for|stats for|performance of|show me|tell me about|what about|breakdown for|numbers for|doing|perform/.test(low);
    const metricWord = /mrp|sec sales|sp sales|sales|revenue|units|orders|discount|aov/.test(low);
    if (lookupPhrase || metricWord) { if (answerEntity(low)) return; }

    const dimOf = /category|categories/.test(low) ? 'category' : /sub.?category/.test(low) ? 'subCategory' : /sku|product/.test(low) ? 'product' : /channel|marketplace/.test(low) ? 'channel' : null;
    if (dimOf && /(attention|worst|weak|underperform|losing|problem|fix|struggl|bad|poor|down|declin|drop)/.test(low)) { answerRanked(dimOf, 'attention'); return; }
    if (dimOf && /(best|top|strong|winning|leading|good|great|high|growing)/.test(low)) { answerRanked(dimOf, 'best'); return; }

    if (/what changed|what.?s changed|changed (vs|versus)|how did we do|how are we doing|how.?s it going|how.?s performance|whats up|what.?s new|any change/.test(low)) { answerContext('changed'); return; }
    if (/drove|driver|growth|contribut|what.?s working|what.?s driving|reason/.test(low)) { answerContext('drivers'); return; }
    if (/where (should|to|do|can).*focus|what should i (optimi|do|focus)|optimi|improve|where can i|what next|recommend|suggestion|advice|action/.test(low)) { answerContext('focus'); return; }
    if (/summar|read ?out|overview|recap|this week|this period|tl;?dr|brief|snapshot|status/.test(low)) { answerContext('summary'); return; }

    const q = asstParse(t);
    if (!q.metric) { answerContext('summary'); return; }
    if (!q.dimension && (q.qtype === 'ranking' || q.qtype === 'comparison' || q.qtype === 'topn' || q.qtype === 'threshold')) q.dimension = 'channel';
    const period = parsePeriod(t, maxDate);
    if (period) q.period = period;
    const res = asstResolve(q, { rows: rows || [], cube: cube || [], from, to, activeLabel });
    if (res.rich) { pushAsst(res); return; }
    const out = res.text + (res.caveats && res.caveats.length ? ('\n\n' + res.caveats.map(c => '⚠ ' + c).join('\n')) : '');
    pushAsst({ text: out });
  };

  const closePanel = () => { setClosing(true); setTimeout(() => { setClosing(false); setOpen(false); }, 260); };

  return (
    <>
      <button className="askfab" onClick={() => open ? closePanel() : setOpen(true)} title={'Ask ' + ASSISTANT_NAME}>
        <span style={{ fontSize: 17 }}>{open ? '×' : '✦'}</span>{!open && ('Ask ' + ASSISTANT_NAME)}
      </button>
      {open && (
        <div className={'ask-panel' + (closing ? ' closing' : '')}>
          <div className="ask-panel-head">
            <div className="ask-panel-head-row">
              <span className="ask-avatar">✦</span>
              <div style={{ flex: 1 }}>
                <div className="ask-panel-title">
                  {ASSISTANT_NAME.toUpperCase()}
                  <span className="ask-ready"><i /> Ready to assist</span>
                </div>
                <div className="ask-panel-sub">Your Revenue Intelligence Copilot</div>
              </div>
              <button className="ask-close" onClick={closePanel}>×</button>
            </div>
            <div className="ask-ctx-row">
              <span className="ask-ctx-lbl">Context</span>
              <span className="ask-ctx-chip">{ctxLabel}</span>
            </div>
          </div>
          <div className="ask-msgs" ref={endRef}>
            {msgs.map((m, i) => (
              <div key={i} className={'ask-msg-wrap' + (m.role === 'user' ? ' user' : '')}>
                {m.rich ? <AnswerCard data={m.rich} /> : <div className={'ask-msg' + (m.role === 'user' ? ' user' : '')}>{m.text}</div>}
              </div>
            ))}
            {typing && <div className="ask-typing"><i /><i /><i /></div>}
            {msgs.length <= 1 && !typing && (
              <div className="ask-suggestions-wrap">
                <div className="ask-suggestions-lbl">Suggested</div>
                <div className="ask-suggestions">
                  {SUGGESTIONS.map(s => <button key={s} onClick={() => askText(s)}>{s}</button>)}
                </div>
              </div>
            )}
          </div>
          <div className="ask-input-row">
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') askText(); }}
              placeholder={'Ask ' + ASSISTANT_NAME + ' about your performance…'} aria-label={'Ask ' + ASSISTANT_NAME} />
            <button onClick={() => askText()} aria-label="Send">↵</button>
          </div>
        </div>
      )}
    </>
  );
}
