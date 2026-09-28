import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, ReferenceLine, Legend, PieChart, Pie,
} from 'recharts';
import { inRange, sumField } from '../lib/metrics.js';
import { inrShort, shortDate, longDate } from '../lib/format.js';
import { ChannelLogo } from '../components/viz.jsx';
import { fetchAdSpend } from '../lib/api.js';
import {
  buildPLFromChannels, estimateChannelPL, ratiosFor, ratioStability,
  businessHealthScore, BASES, PL_HISTORY, JULY_CHANNEL, CHANNEL_TO_PL, GST_DIVISOR,
  unitEconomics,
} from '../lib/pl.js';

// ── Estimated-vs-actual provenance chip. Every derived figure carries one, so a
//    reader never has to guess whether they're looking at accounting or a model.
const KIND_META = {
  actual:      { tag: null,     title: 'Actual — measured from the dashboard\'s own revenue/ads data' },
  derived:     { tag: null,     title: 'Derived arithmetically from actuals (no assumption applied)' },
  estimated:   { tag: 'EST.',   title: null },
  user:        { tag: 'INPUT',  title: 'Supplied by you in the Assumptions panel — not from the tracker' },
  unavailable: { tag: 'N/A',    title: 'Insufficient data to derive reliably' },
};
function Kind({ kind, basisLabel }) {
  const m = KIND_META[kind]; if (!m || !m.tag) return null;
  const title = m.title || `Estimated using ${basisLabel} P&L-derived expense ratios.`;
  return <span className={'estchip ' + kind} title={title}>{m.tag}</span>;
}

const pctS = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d) + '%');
const money = v => (v == null ? '—' : inrShort(v));
const OVERHEAD_KEY = 'revsight.overheads';

// ── chart palette: near-monochrome, with ONE blue reserved for the series that
//    carries the punchline (CM3 / contribution). Colour therefore always means
//    something rather than decorating. Semantic red/green stay for up/down only.
const CH = {
  ink: '#1A1B1F', grey2: '#4A4C53', grey3: '#85888F',
  grey4: '#B6B8BE', grey5: '#D8D9DD', grey6: '#ECECEF',
  blue: '#EFBF20', blueSoft: '#FBEFC4',
};

/* ═══════════════════════════════════════════════════════════════════════
   MarginBridge — the P&L cascade, horizontally.

   Replaces the vertical waterfall, which had thirteen categories crammed on
   one axis with their labels rotated 32°. Rotated text is measurably slower
   to read, and the floating grey bars gave no sense of scale: you could see
   that something was deducted but not how much of the whole it was.

   Turning it on its side fixes both. Labels sit horizontally at their
   natural reading size, each row gets a full line for its value and share,
   and — the part that makes it click — the bar visibly SHRINKS down the
   page. Every deduction is drawn as the slice being removed from the bar
   above it, with a dashed guide carrying the running balance downward, so
   the chart reads as one quantity being eaten rather than as thirteen
   unrelated bars.

   Percentages are of GROSS revenue, deliberately: the bar widths are
   proportional to gross, so the number always agrees with what you can see.
   The margin milestones additionally carry their standard margin-on-net,
   which is the figure that gets quoted.

   Built in HTML/CSS rather than SVG (or Recharts, which has no waterfall
   primitive) because thirteen labelled rows are a layout problem, not a
   drawing one — and CSS gives crisp text, real hover targets, and no
   label-collision fights.
   ═══════════════════════════════════════════════════════════════════════ */
function MarginBridge({ steps, gross, net, marginPct }) {
  if (!(gross > 0) || !steps.length) {
    return <div className="empty" style={{ padding: 28 }}>No revenue in this window to cascade.</div>;
  }
  const x = v => Math.max(0, Math.min(100, (v / gross) * 100));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="mb">
      {/* scale, once, at the top — thirteen rows do not each need an axis */}
      <div className="mb-axis">
        <span className="mb-lbl" />
        <span className="mb-track">
          {ticks.map(t => (
            <span className="mb-tick" key={t} style={{ left: t * 100 + '%' }}>
              <i>{inrShort(gross * t, { currency: false })}</i>
            </span>
          ))}
        </span>
        <span className="mb-val">Value</span>
        <span className="mb-pct">of gross</span>
      </div>

      <div className="mb-rows">
        {steps.map((s, i) => {
          const isCost = s.type === 'cost';
          // A deduction occupies the segment it removes: from the balance
          // that survives it, out to the balance before it.
          const left = isCost ? x(s.after) : 0;
          const width = isCost ? Math.max(0.4, x(s.before) - x(s.after)) : Math.max(0.4, x(s.value));
          const share = (Math.abs(s.value) / gross) * 100;
          return (
            <div className={'mb-row ' + s.type + (s.final ? ' final' : '') + (s.phase ? ' ' + s.phase : '')}
              key={s.name}
              title={`${s.name}: ${money(s.value)} · ${share.toFixed(1)}% of gross revenue`}>
              <span className="mb-lbl">
                {s.name}
                {s.marginOfNet != null && (
                  <em className="mb-chip">{(s.marginOfNet * 100).toFixed(1)}% of net</em>
                )}
              </span>
              <span className="mb-track">
                {/* dashed guide carrying the running balance down from the row
                    above, so the cascade reads as one continuous quantity */}
                {i > 0 && <span className="mb-conn" style={{ left: x(s.before) + '%' }} />}
                <span className="mb-bar" style={{ left: left + '%', width: width + '%' }} />
              </span>
              <span className="mb-val tnum">{isCost ? '−' : ''}{money(Math.abs(s.value))}</span>
              <span className="mb-pct tnum">{share.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>

      <p className="mb-foot">
        Bars are proportional to <b>gross revenue</b>, so each share matches the
        width you see. Grey rows above <b>Net Revenue</b> are revenue that never
        reaches the business — returns, platform discounts and GST; the darker
        rows below it are the cost of trading. The gold bar is what survives:
        <b> {marginPct == null ? '—' : (marginPct * 100).toFixed(1) + '% of net revenue'}</b>.
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   UnitEconomicsPie — the investor-deck view: where ₹100 of net revenue goes.

   A donut rather than a full pie, because the hole carries the punchline —
   the margin left over — which is the one number an investor looks for and
   would otherwise have to hunt for in the legend.

   Costs are ordered along the P&L, not by size, so the ring reads in the
   same sequence as the statement it comes from. Margin is placed last and
   is the only slice given the accent; the costs run down a single grey ramp
   so no cost accidentally looks more important than another because of hue.
   ═══════════════════════════════════════════════════════════════════════ */
const UE_COST_COLORS = [CH.ink, CH.grey2, CH.grey3, CH.grey4, CH.grey5, '#C9B375'];

/* Measure an element, live.

   Recharts' ResponsiveContainer does not reliably recover from mounting at
   zero width — if the card renders while its column is collapsed (a narrow
   or minimised window, a hidden pane), the donut stays blank even after the
   window is resized, and only comes back on a full remount. Measuring here
   and handing the chart explicit pixels removes that failure mode: the chart
   simply is not rendered until there is space, and re-renders when there is.  */
function useMeasure() {
  // A CALLBACK ref, not an object ref. This card returns early while the P&L
  // is still loading, so the measured element does not exist on first render.
  // An object ref plus a mount-once effect would observe null and — with no
  // dependency to re-run on — never attach when the element finally appears.
  // React calls a callback ref with the node itself, so the effect re-runs the
  // moment there is something to measure.
  const [node, setNode] = useState(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!node) return;
    const read = () => {
      const r = node.getBoundingClientRect();
      setBox(b => (Math.abs(b.w - r.width) > 1 || Math.abs(b.h - r.height) > 1
        ? { w: r.width, h: r.height } : b));
    };
    // Seed immediately: if the card mounts at its final size no resize ever
    // fires, and waiting for one would leave the chart blank forever.
    read();

    // Two triggers, because neither alone is sufficient. ResizeObserver
    // catches layout changes the window never sees (a sibling collapsing,
    // the rail toggling) but is suppressed in some embedded/non-compositing
    // contexts. The window listener catches the ordinary case — someone
    // resizing their browser — even where RO is unavailable.
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(read);
      ro.observe(node);
    }
    window.addEventListener('resize', read);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', read); };
  }, [node]);
  return [setNode, box];
}

function UnitEconomicsPie({ u, basisLabel }) {
  const [chartRef, box] = useMeasure();
  if (!u) {
    return <div className="empty" style={{ padding: 28 }}>
      No net revenue in this window, so there is no ₹100 to divide up.
    </div>;
  }
  // A negative margin cannot be a slice. Show the cost ring alone and state
  // the shortfall in words — a fabricated wedge would be worse than no wedge.
  const slices = [
    ...u.groups.map((g, i) => ({ name: g.label, value: g.value, pct: g.pct, fill: UE_COST_COLORS[i % UE_COST_COLORS.length], cost: true })),
    ...(u.profitable ? [{ name: u.marginLabel, value: u.margin, pct: u.marginPct, fill: CH.blue, cost: false }] : []),
  ];
  const per100 = v => '₹' + ((v / u.net) * 100).toFixed(1);

  return (
    <div className="ue">
      <div className="ue-chart" ref={chartRef}>
        {box.w > 0 && box.h > 0 && (
          <PieChart width={box.w} height={box.h}>
            <Pie data={slices} dataKey="value" nameKey="name"
              innerRadius="58%" outerRadius="86%" paddingAngle={1.5}
              stroke="var(--panel)" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s, i) => <Cell key={i} fill={s.fill} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 11.5 }}
              formatter={(v, n, p) => [
                `${money(v)} · ${p.payload.pct.toFixed(1)}% · ${per100(v)} per ₹100`, n,
              ]} />
          </PieChart>
        )}
        {/* centre readout — the punchline in the hole of the donut */}
        <div className="ue-hole">
          <span className="ue-hole-k">{u.profitable ? u.marginLabel : 'Shortfall'}</span>
          <b className={u.profitable ? '' : 'neg'}>{u.marginPct.toFixed(1)}%</b>
          <span className="ue-hole-v">{money(u.margin)}</span>
        </div>
      </div>

      <div className="ue-legend">
        <div className="ue-row ue-head">
          <span className="c" />
          <span className="l">Per ₹100 of net revenue</span>
          <span className="p">Share</span>
          <span className="v">Value</span>
        </div>
        {slices.map((s, i) => (
          <div className={'ue-row' + (s.cost ? '' : ' margin')} key={s.name}>
            <span className="c" style={{ background: s.fill }} />
            <span className="l">{s.name}</span>
            <span className="p tnum">{per100(s.value)}</span>
            <span className="v tnum">{money(s.value)}</span>
          </div>
        ))}
        <div className="ue-row ue-total">
          <span className="c" />
          <span className="l">{u.profitable ? 'Net revenue' : 'Total cost'}</span>
          <span className="p tnum">{u.profitable ? '₹100.0' : per100(u.totalCost)}</span>
          <span className="v tnum">{money(u.profitable ? u.net : u.totalCost)}</span>
        </div>
        {!u.profitable && (
          <p className="ue-warn">
            Costs are <b>{u.costPct.toFixed(1)}%</b> of net revenue — this window
            loses <b>{per100(Math.abs(u.margin)).replace('₹', '₹')}</b> on every ₹100.
            There is no margin slice to draw.
          </p>
        )}
        <p className="ue-foot">
          {u.hasOpex
            ? <>Includes the fixed overhead you entered, so the residual is a net margin.</>
            : <>No overhead figure is set, so the residual is <b>Contribution Margin 3</b> —
              money before fixed costs, <b>not</b> net profit. Enter overheads in
              Assumptions to carry this down to a net margin.</>}
          {' '}Cost ratios are estimated from the <b>{basisLabel}</b> P&amp;L;
          revenue and ad spend are actual.
        </p>
        {/* Per-unit is the true unit economic here, because quantity is the
            one denominator every channel reports. */}
        {u.perUnit && (
          <p className="ue-foot">
            Per unit: <b>{money(u.perUnit(u.net))}</b> net revenue
            and <b>{money(u.perUnit(u.margin))}</b> {u.hasOpex ? 'net margin' : 'CM3'}
            {' '}across {u.units.toLocaleString('en-IN')} units.
            {u.perOrder
              ? <> Per order: <b>{money(u.perOrder(u.net))}</b> net revenue
                and <b>{money(u.perOrder(u.margin))}</b> {u.hasOpex ? 'net margin' : 'CM3'}
                {' '}across {u.orders.toLocaleString('en-IN')} orders.</>
              : u.orderCoverage != null && (
                <> <b>Per-order is not shown</b>: only {u.orderCoverage.toFixed(0)}% of revenue
                  comes from channels that report an order number
                  {u.ordersSeen > 0 && <> ({u.ordersSeen.toLocaleString('en-IN')} orders)</>},
                  so dividing all the revenue by them would overstate basket value.</>
              )}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Segmented arc gauge. Places today's CM3 margin inside the business's own
//    16-month observed range, so "good" is defined by its own history rather
//    than an arbitrary target. Pure SVG — no extra dependency.
function MarginGauge({ value, min, max, label, sub }) {
  const N = 34, START = -218, SWEEP = 256;   // leaves a gap at the bottom
  const frac = value == null || max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const lit = Math.round(frac * N);
  const cx = 116, cy = 112, rIn = 62, rOut = 92;
  const seg = i => {
    const a = ((START + (SWEEP * i) / (N - 1)) * Math.PI) / 180;
    return {
      x1: cx + rIn * Math.cos(a), y1: cy + rIn * Math.sin(a),
      x2: cx + rOut * Math.cos(a), y2: cy + rOut * Math.sin(a),
    };
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="232" height="150" viewBox="0 0 232 150" role="img" aria-label={`${label} ${value == null ? 'unavailable' : value.toFixed(1) + '%'}`}>
        {Array.from({ length: N }, (_, i) => {
          const s = seg(i);
          const on = i < lit;
          return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeWidth={5.4} strokeLinecap="round"
            stroke={on ? (value < 0 ? 'var(--down)' : CH.ink) : CH.grey6} />;
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" style={{ font: '700 27px var(--font)', letterSpacing: '-0.03em' }}
          fill={value == null ? CH.grey3 : value < 0 ? 'var(--down)' : CH.ink}>
          {value == null ? '—' : value.toFixed(1) + '%'}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" style={{ font: '500 11px var(--font)' }} fill={CH.grey3}>{label}</text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: 200, fontSize: 10.5, color: 'var(--ink-3)', marginTop: -6 }}>
        <span>{min.toFixed(1)}%</span><span>16M range</span><span>{max.toFixed(1)}%</span>
      </div>
      {sub && <p className="card-sub" style={{ marginTop: 10, marginBottom: 0, textAlign: 'center', maxWidth: 250 }}>{sub}</p>}
    </div>
  );
}

export default function Profitability({ data, meta, from, to, prevFrom, prevTo }) {
  const [baseKey, setBaseKey] = useState('july');
  const [trendMode, setTrendMode] = useState('value');   // 'value' | 'margin'
  const [showAssume, setShowAssume] = useState(false);
  // The P&L carries a lot of ground. Sub-tabs keep one screen readable at a time
  // instead of stacking eleven sections; the score + KPIs stay pinned above them.
  const [tab, setTab] = useState('pnl');
  // fixed overheads are NOT in the tracker — user-supplied, persisted locally
  const [overheads, setOverheads] = useState(() => {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(OVERHEAD_KEY) : null;
    return v ? Number(v) : '';
  });
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (overheads === '' || overheads == null) localStorage.removeItem(OVERHEAD_KEY);
    else localStorage.setItem(OVERHEAD_KEY, String(overheads));
  }, [overheads]);

  const basis = BASES.find(b => b.key === baseKey) || BASES[0];
  const cur = useMemo(() => inRange(data, from, to), [data, from, to]);
  const prev = useMemo(() => inRange(data, prevFrom, prevTo), [data, prevFrom, prevTo]);

  // ── actual ad spend (Performance Marketing) for both windows ──
  const [ads, setAds] = useState(null);
  const adsReq = useRef(0);
  useEffect(() => {
    const my = ++adsReq.current;
    fetchAdSpend(from, to, prevFrom, prevTo)
      .then(r => { if (my === adsReq.current) setAds(r); })
      .catch(() => { if (my === adsReq.current) setAds({ cur: [], prev: [] }); });
  }, [from, to, prevFrom, prevTo]);

  // period length in months, to scale the fixed overhead
  const months = useMemo(() => {
    if (!from || !to) return 1;
    const d = (new Date(to) - new Date(from)) / 86400000 + 1;
    return Math.max(d / 30.44, 0.1);
  }, [from, to]);

  const rollup = rows => {
    const by = new Map();
    for (const r of rows) {
      let e = by.get(r.channel); if (!e) { e = { channel: r.channel, mrp: 0, sp: 0, units: 0, orders: 0 }; by.set(r.channel, e); }
      e.mrp += r.mrp || 0; e.sp += r.sp || 0; e.units += r.units || 0; e.orders += r.orders || 0;
    }
    return [...by.values()];
  };
  const curCh = useMemo(() => rollup(cur), [cur]);
  const prevCh = useMemo(() => rollup(prev), [prev]);
  const spendCur = useMemo(() => new Map((ads ? ads.cur : []).map(a => [a.channel, a.spend])), [ads]);
  const spendPrev = useMemo(() => new Map((ads ? ads.prev : []).map(a => [a.channel, a.spend])), [ads]);

  const oh = overheads === '' || overheads == null ? null : Number(overheads);
  const P = useMemo(() => buildPLFromChannels({ channelRows: curCh, spendByChannel: ads ? spendCur : null, baseKey, overheads: oh, months }), [curCh, spendCur, ads, baseKey, oh, months]);
  const PP = useMemo(() => buildPLFromChannels({ channelRows: prevCh, spendByChannel: ads ? spendPrev : null, baseKey, overheads: oh, months }), [prevCh, spendPrev, ads, baseKey, oh, months]);
  const L = P.lines, PL_ = PP.lines;

  /* Unit economics: the same P&L expressed per ₹100 of net revenue.

     Per-UNIT is safe — every channel reports quantity. Per-ORDER is not:
     Flipkart, Nykaa and the quick-commerce feeds carry no order_number, so
     they contribute revenue with zero orders. Dividing total revenue by the
     orders that DID land would charge all the revenue against a fraction of
     the baskets and roughly double the true figure. So per-order is passed
     only when the channels reporting orders cover essentially all revenue,
     and the coverage is stated either way. */
  const unitEcon = useMemo(() => {
    const units = curCh.reduce((a, c) => a + (c.units || 0), 0);
    const orders = curCh.reduce((a, c) => a + (c.orders || 0), 0);
    const revAll = curCh.reduce((a, c) => a + (c[baseKey === 'sp' ? 'sp' : 'mrp'] || 0), 0);
    const revWithOrders = curCh.reduce(
      (a, c) => a + ((c.orders || 0) > 0 ? (c[baseKey === 'sp' ? 'sp' : 'mrp'] || 0) : 0), 0);
    const coverage = revAll > 0 ? (revWithOrders / revAll) * 100 : 0;
    const u = unitEconomics(L, { units, orders: coverage >= 95 ? orders : 0 });
    return u ? { ...u, orderCoverage: coverage, ordersSeen: orders } : u;
  }, [L, curCh, baseKey]);

  const growth = (c, p) => (p && p !== 0 ? ((c - p) / Math.abs(p)) * 100 : null);
  const revGrowth = growth(L.grossRevenue.value, PL_.grossRevenue.value);

  const health = useMemo(() => businessHealthScore({
    cm1Pct: L.cm1.pct != null ? L.cm1.pct * 100 : null,
    cm2Pct: L.cm2.pct != null ? L.cm2.pct * 100 : null,
    cm3Pct: L.cm3.pct != null ? L.cm3.pct * 100 : null,
    cogsPct: L.cogs.pct != null ? L.cogs.pct * 100 : null,
    perfMktPct: L.perfMkt.pct != null ? L.perfMkt.pct * 100 : null,
    revGrowthPct: revGrowth,
  }), [L, revGrowth]);

  // ── waterfall: running balance, stacked-bar technique ──
  const waterfall = useMemo(() => {
    const steps = [
      ['Gross Revenue', L.grossRevenue.value, 'total'],
      ['Returns', L.returns.value, 'cost'],
      ['Discounts & B2B Margin', L.deductions.value, 'cost'],
      ['GST', L.gst.value, 'cost'],
      ['Net Revenue', L.netRevenue.value, 'total'],
      ['COGS', L.cogs.value, 'cost'],
      ['Platform & Commission', L.b2cComm.value + L.websiteExp.value + L.b2bSecDisc.value, 'cost'],
      ['Logistics, WH & Packaging', L.freightForward.value + L.warehousing.value + L.tertiaryPackaging.value, 'cost'],
      ['CM1', L.cm1.value, 'total'],
      ['Performance Marketing', L.perfMkt.value + L.retentionMkt.value, 'cost'],
      ['CM2', L.cm2.value, 'total'],
      ['Brand Marketing & GWP', L.brandMkt.value + L.freebiesGWP.value, 'cost'],
      ['CM3', L.cm3.value, 'total'],
    ];
    if (L.netProfit.value != null) {
      steps.push(['Fixed / Operating Expenses', L.fixedOpex.value, 'cost']);
      steps.push(['Estimated Net Profit', L.netProfit.value, 'total']);
    }
    // Carry the running balance explicitly as before/after, so the bridge can
    // draw each deduction as the segment it removes rather than re-deriving
    // the geometry at render time.
    let run = 0;
    let pastNet = false;
    const margins = { CM1: L.cm1.pct, CM2: L.cm2.pct, CM3: L.cm3.pct, 'Estimated Net Profit': L.netProfit.pct };
    const out = steps.map(([name, value, type]) => {
      const before = run;
      if (type === 'total') {
        run = value;
        if (name === 'Net Revenue') pastNet = true;
        return { name, value, type, before, after: value,
          marginOfNet: margins[name] != null ? margins[name] : null,
          phase: pastNet ? 'trading' : 'leak' };
      }
      run = run + value;                                    // costs are negative
      return { name, value, type, before, after: run, phase: pastNet ? 'trading' : 'leak' };
    });
    // The last milestone is the punchline; mark it so it can carry the accent.
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].type === 'total') { out[i].final = true; break; }
    }
    return out;
  }, [L]);

  // ── monthly trend from the tracker's own history (actual P&L, not estimated) ──
  const trend = useMemo(() => PL_HISTORY.slice().reverse().map(m => ({
    month: m.month,
    revenue: m.nrSP, netRevenue: m.nr, cm1: m.cm1, cm2: m.cm2, cm3: m.cm3,
    cm1m: (m.cm1 / m.nr) * 100, cm2m: (m.cm2 / m.nr) * 100, cm3m: (m.cm3 / m.nr) * 100,
  })), []);

  // ── Ad Spend vs Contribution, month by month (tracker actuals).
  //    Answers "is each extra rupee of marketing buying contribution?" — bars are
  //    the two marketing blocks, the blue line is the CM2 that survives them.
  const adVsContrib = useMemo(() => PL_HISTORY.slice().reverse().map(m => ({
    month: m.month,
    perfMkt: m.perfMkt, brandMkt: m.brandMkt,
    cm1: m.cm1, cm2: m.cm2,
    marketingPct: ((m.perfMkt + m.brandMkt) / m.nr) * 100,
    cm2Pct: (m.cm2 / m.nr) * 100,
  })), []);

  // ── Revenue growth vs profit growth, MoM. Diverging bars make the divergence
  //    (revenue up while profit down) immediately visible.
  const growthPairs = useMemo(() => {
    const h = PL_HISTORY.slice().reverse();
    return h.slice(1).map((m, i) => {
      const p = h[i];
      const g = (c, pv) => (pv && pv !== 0 ? ((c - pv) / Math.abs(pv)) * 100 : null);
      return {
        month: m.month,
        revG: g(m.nr, p.nr),
        cm2G: g(m.cm2, p.cm2),
        cm3Delta: (m.cm3 / m.nr) * 100 - (p.cm3 / p.nr) * 100,
      };
    });
  }, []);

  // ── expense mix ──
  const expenseMix = useMemo(() => {
    const items = [
      ['COGS', -L.cogs.value, CH.ink],
      ['Performance Marketing', -(L.perfMkt.value + L.retentionMkt.value), CH.blue],
      ['Brand Marketing & GWP', -(L.brandMkt.value + L.freebiesGWP.value), CH.grey2],
      ['Platform & Commission', -(L.b2cComm.value + L.websiteExp.value + L.b2bSecDisc.value), CH.grey3],
      ['Logistics, WH & Packaging', -(L.freightForward.value + L.warehousing.value + L.tertiaryPackaging.value), CH.grey4],
    ];
    if (L.fixedOpex.value != null) items.push(['Fixed / Operating', -L.fixedOpex.value, CH.grey5]);
    const tot = items.reduce((s, i) => s + i[1], 0);
    return items.map(([name, value, fill]) => ({ name, value, fill, share: tot ? value / tot : 0 }));
  }, [L]);

  // ── channel profitability, using each channel's OWN tracker economics ──
  const chanRows = useMemo(() => curCh.map(r => {
    const e = estimateChannelPL({ channel: r.channel, grossMrp: r.mrp, netSp: CHANNEL_TO_PL[r.channel] && (JULY_CHANNEL.find(c => c.channel === CHANNEL_TO_PL[r.channel]) || {}).basis === 'B2C' ? r.sp : 0, adSpend: spendCur.get(r.channel) || null, baseKey });
    const spend = spendCur.get(r.channel) || 0;
    return {
      channel: r.channel, matched: e.matched, plChannel: e.plChannel, plBasis: e.plBasis,
      marketingAllocated: e.marketingAllocated !== false, basisNote: e.basisNote,
      gross: r.mrp, netRevenue: e.netRevenue, spend,
      cogs: e.cogs, cm1: e.cm1, cm2: e.cm2, cm3: e.cm3,
      cm1Pct: e.cm1Pct, cm2Pct: e.cm2Pct, cm3Pct: e.cm3Pct,
      // ROAS follows the TRACKER's definition (row 76): Net Revenue ÷ Performance
      // Marketing — a blended return, not an ad-attributed one. July total = 4.82x.
      // TACOS is spend ÷ net revenue on the same base, so the two are reciprocal.
      tacos: e.netRevenue > 0 ? (spend / e.netRevenue) * 100 : null,
      roas: spend > 0 ? e.netRevenue / spend : null,
    };
  }).filter(r => r.gross > 0).sort((a, b) => b.cm2 - a.cm2), [curCh, spendCur, baseKey]);

  // ── management insights: generated only where the data supports them ──
  const insights = useMemo(() => {
    const out = [];
    const cm3p = L.cm3.pct != null ? L.cm3.pct * 100 : null;
    const pcm3p = PL_.cm3.pct != null ? PL_.cm3.pct * 100 : null;
    if (revGrowth != null && cm3p != null && pcm3p != null) {
      if (revGrowth > 2 && cm3p < pcm3p - 0.5) out.push({ tone: 'bad', head: 'Revenue is growing, but profitability is not keeping pace', body: `Gross revenue ${revGrowth > 0 ? 'grew' : 'fell'} ${Math.abs(revGrowth).toFixed(1)}% versus the prior window, while estimated CM3 margin moved from ${pcm3p.toFixed(1)}% to ${cm3p.toFixed(1)}%.` });
      else if (revGrowth < -2 && cm3p > pcm3p + 0.5) out.push({ tone: 'ok', head: 'Revenue declined but margin improved', body: `Gross revenue fell ${Math.abs(revGrowth).toFixed(1)}% while estimated CM3 margin rose from ${pcm3p.toFixed(1)}% to ${cm3p.toFixed(1)}% — a deliberate quality-over-volume shift, or lower discounting.` });
      else if (revGrowth > 2 && cm3p >= pcm3p) out.push({ tone: 'good', head: 'Profitable growth', body: `Revenue grew ${revGrowth.toFixed(1)}% and estimated CM3 margin held at ${cm3p.toFixed(1)}%.` });
    }
    const spendC = [...spendCur.values()].reduce((s, v) => s + v, 0);
    const spendP = [...spendPrev.values()].reduce((s, v) => s + v, 0);
    const sg = growth(spendC, spendP), cg = growth(L.cm1.value, PL_.cm1.value);
    if (sg != null && cg != null && sg > 5 && cg < sg - 5) out.push({ tone: 'bad', head: 'Ad spend is outpacing contribution', body: `Performance marketing ${sg > 0 ? 'rose' : 'fell'} ${Math.abs(sg).toFixed(1)}% while estimated CM1 ${cg >= 0 ? 'grew' : 'fell'} ${Math.abs(cg).toFixed(1)}% — each incremental rupee of spend is buying less contribution.` });
    if (cm3p != null && cm3p < 0) out.push({ tone: 'bad', head: 'Estimated CM3 is negative for this period', body: `After COGS, platform, logistics and all marketing, the business is an estimated ${money(Math.abs(L.cm3.value))} below breakeven at the CM3 line — before any fixed overheads.` });
    const brandShare = L.cm2.value ? (-(L.brandMkt.value + L.freebiesGWP.value)) / L.cm2.value : null;
    if (brandShare != null && brandShare > 0.85) out.push({ tone: 'bad', head: 'Brand marketing is consuming nearly all contribution', body: `Brand marketing and GWP equal ${(brandShare * 100).toFixed(0)}% of estimated CM2 (${pctS(L.brandMkt.pct)} of net revenue). This is the single largest swing factor in the tracker's history — it ranged 9.2% to 35.4% across 16 months.` });
    const worst = chanRows.filter(c => c.marketingAllocated).slice().sort((a, b) => a.cm2 - b.cm2)[0];
    if (worst && worst.cm2 < 0) out.push({ tone: 'bad', head: `${worst.channel} is contribution-negative after advertising`, body: `${worst.channel} shows ${money(worst.gross)} gross revenue but an estimated CM2 of ${money(worst.cm2)} (${pctS(worst.cm2Pct)}) on its own July economics${worst.roas ? `, despite a ${worst.roas.toFixed(2)}x ROAS` : ''}.` });
    const best = chanRows.filter(c => c.marketingAllocated && c.cm2 > 0)[0];
    if (best) out.push({ tone: 'good', head: `${best.channel} is the strongest profit engine`, body: `Estimated CM2 of ${money(best.cm2)} at ${pctS(best.cm2Pct)} of net revenue${best.roas ? ` on a ${best.roas.toFixed(2)}x ROAS` : ''}.` });
    return out;
  }, [L, PL_, revGrowth, spendCur, spendPrev, chanRows]);

  const R = ratiosFor(baseKey);
  const stability = useMemo(() => ratioStability(), []);
  const bandClass = { healthy: 'hs-good', watch: 'hs-warn', risk: 'hs-bad', unknown: 'hs-warn' }[health.band];
  const bandDot = { healthy: '🟢', watch: '🟡', risk: '🔴', unknown: '⚪' }[health.band];

  // `cost` lines are stored negative (they're deductions in the waterfall) but a
  // KPI tile reads better as a magnitude — the label already says it's a cost.
  const KPI = ({ label, line, sub, big, cost }) => (
    <div className={'stat' + (big ? ' accent' : '')}>
      <div className="stat-top">
        <span className="stat-lbl">{label}</span>
        <Kind kind={line.kind} basisLabel={basis.label} />
      </div>
      {line.kind === 'unavailable'
        ? <div className="stat-locked">— <span className="lockpill">insufficient data</span></div>
        : <div className="stat-val tnum">{money(cost ? Math.abs(line.value) : line.value)}</div>}
      <div className="stat-foot"><span className="stat-sub">{sub || (line.pct != null ? pctS(line.pct) + ' of net revenue' : '')}</span></div>
    </div>
  );

  return (
    <>
      {/* ── BASIS CONTROL ── */}
      <div className="filterbar rise" style={{ marginTop: -4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono-lbl">P&amp;L basis</span>
          {BASES.map(b => (
            <button key={b.key} className={'chip' + (baseKey === b.key ? ' on' : '')} onClick={() => setBaseKey(b.key)} title={b.note}>{b.label}</button>
          ))}
          <button className="chip" onClick={() => setShowAssume(s => !s)}>{showAssume ? 'Hide assumptions' : 'Assumptions & transparency'}</button>
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {shortDate(from)} – {shortDate(to)} · ratios from <b>{basis.label}</b> ({basis.note})
        </span>
      </div>

      <div className="banner rise">
        <span className="b-ic">⚠</span>
        <span>
          This is a <b>management estimation model, not statutory accounting</b>. Revenue and ad spend are actual; every
          expense line is estimated from the Weekly P&amp;L Tracker's <b>{basis.label}</b> ratios and carries an <b>EST.</b> chip.
          The tracker ends at <b>Contribution Margin 3</b> and contains no fixed-cost block, so <b>Net Profit is not derivable</b> from
          it — enter monthly overheads in Assumptions to model it. This does not replace the finance team's official P&amp;L.
        </span>
      </div>

      {/* ── HEALTH SCORE ── */}
      <div className="health-hero rise">
        <div className={'hs-card ' + bandClass}>
          <span className="hero-eyebrow">Business Health Score</span>
          <div className="hs-num">{health.score == null ? '—' : Math.round(health.score)}<small>/100</small></div>
          <div className="hs-band">{bandDot} {health.label}</div>
          <p className="hs-note">
            Each factor is scored against this business's own <b>16-month observed range</b> (Apr'25–Jul'26) — the worst month
            on record is 0, the best is 100. Not an arbitrary index.
          </p>
        </div>
        <div className="card" style={{ padding: '16px 18px' }}>
          <div className="card-head"><h3>What's driving the score</h3><span className="meta">weighted contributors</span></div>
          <table className="tbl hs-tbl">
            <thead><tr><th>Factor</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>Score</th><th style={{ textAlign: 'right' }}>Weight</th><th>Anchored to</th></tr></thead>
            <tbody>
              {health.factors.map(f => (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{f.value == null ? '—' : f.value.toFixed(1) + '%'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {f.score == null ? '—' : (
                      <span className="hs-bar" title={Math.round(f.score) + '/100'}>
                        <span className="hs-bar-fill" style={{ width: Math.max(2, f.score) + '%', background: f.score >= 65 ? 'var(--up)' : f.score >= 40 ? 'var(--warn)' : 'var(--down)' }} />
                        <b>{Math.round(f.score)}</b>
                      </span>
                    )}
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{(f.weight * 100).toFixed(0)}%</td>
                  <td style={{ fontSize: 11, color: 'var(--ink-3)' }}>{f.anchor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── PRIMARY KPIs ── */}
      <div className="section rise d1"><h2>Business Health</h2><span className="note">actual revenue · estimated economics on {basis.label} ratios</span></div>
      <div className="stat-strip rise d1">
        <KPI label="Gross Revenue" line={L.grossRevenue} sub="MRP basis · actual" />
        <KPI label="Net Revenue" line={L.netRevenue} sub={`after discounts, B2B margin & GST`} />
        <KPI label="COGS" line={L.cogs} cost />
        <KPI label="Contribution Margin 1" line={L.cm1} big />
      </div>
      <div className="stat-strip rise d1">
        <KPI label="Total Ad Spend" line={L.perfMkt} cost sub={L.perfMkt.kind === 'actual' ? 'actual — marketplace + D2C ads' : 'estimated'} />
        <KPI label="Contribution Margin 2" line={L.cm2} big />
        <KPI label="Contribution Margin 3" line={L.cm3} big />
        <KPI label="Estimated Net Profit" line={L.netProfit} sub={L.netProfit.kind === 'unavailable' ? 'needs fixed overheads' : 'CM3 less fixed overheads'} />
      </div>
      <div className="stat-strip rise d2">
        {[
          ['CM1 %', L.cm1.pct], ['CM2 %', L.cm2.pct], ['CM3 %', L.cm3.pct],
          ['COGS %', L.cogs.pct], ['Ad Spend % of Net Rev', L.perfMkt.pct],
          ['Net Margin %', L.netProfit.pct],
        ].map(([lbl, v]) => (
          <div className="stat" key={lbl}>
            <div className="stat-top"><span className="stat-lbl">{lbl}</span><Kind kind={lbl === 'Net Margin %' && v == null ? 'unavailable' : 'estimated'} basisLabel={basis.label} /></div>
            <div className="stat-val tnum">{pctS(v)}</div>
            <div className="stat-foot"><span className="stat-sub">of net revenue</span></div>
          </div>
        ))}
      </div>

      {/* ── SUB-TABS ── */}
      <div className="subtabs rise d2" role="tablist" aria-label="Business overview sections">
        {[
          ['pnl', 'P&L'],
          ['trends', 'Trends'],
          ['channels', 'Quality, Expense Mix & Channels'],
          ['means', 'What This Means'],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id}
            className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── P&L TAB ── */}
      {tab === 'pnl' && <>
      {/* ── UNIT ECONOMICS ── */}
      <div className="section rise d1">
        <h2>Unit Economics</h2>
        <span className="note">where ₹100 of net revenue goes · {longDate(from)} → {longDate(to)}</span>
      </div>
      <div className="card rise d1">
        <UnitEconomicsPie u={unitEcon} basisLabel={basis.label} />
      </div>

      {/* ── WATERFALL ── */}
      <div className="section rise d2">
        <h2>Margin Bridge</h2>
        <span className="note">gross revenue → what survives, step by step</span>
      </div>
      <div className="card rise d2">
        <MarginBridge steps={waterfall} gross={L.grossRevenue.value}
          net={L.netRevenue.value}
          marginPct={L.netProfit.value != null ? L.netProfit.pct : L.cm3.pct} />
        <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
          Every deduction below Net Revenue is estimated on {basis.label} ratios.
          {P.mixedBasis && <> Primary-basis <b>(P)</b> channels use their own tracker ratios rather than the dashboard's secondary SP — see Assumptions.</>}
        </p>
      </div>

      </>}

      {/* ── TRENDS TAB ── */}
      {tab === 'trends' && <>
      {/* ── AD SPEND vs CONTRIBUTION ── */}
      <div className="section rise d3"><h2>Ad Spend vs Contribution</h2><span className="note">is each extra rupee of marketing buying contribution?</span></div>
      <div className="grid-2 rise d3">
        <div className="card">
          <div className="card-head"><h3>Marketing spend against the contribution it leaves behind</h3><span className="meta">tracker actuals · ₹ Cr</span></div>
          <div style={{ height: 296 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={adVsContrib} margin={{ top: 8, right: 10, left: 4, bottom: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-32} textAnchor="end" height={54} />
                <YAxis tickFormatter={v => v.toFixed(0) + 'Cr'} tickLine={false} axisLine={false} width={44} />
                <Tooltip formatter={(v, n) => ['₹' + Number(v).toFixed(2) + ' Cr', n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="perfMkt" name="Performance Mktg" stackId="m" fill={CH.grey3} radius={[0, 0, 0, 0]} />
                <Bar dataKey="brandMkt" name="Brand Mktg" stackId="m" fill={CH.grey5} radius={[3, 3, 0, 0]} />
                <Line dataKey="cm2" name="CM2 (what survives)" stroke={CH.blue} strokeWidth={2.4} dot={{ r: 2.5, fill: CH.blue }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="card-sub" style={{ marginTop: 4, marginBottom: 0 }}>
            When the stacked bars grow faster than the blue line, marketing is buying revenue rather than contribution.
          </p>
        </div>
        <div className="card">
          <div className="card-head"><h3>Margin position</h3><span className="meta">CM3 vs own history</span></div>
          <MarginGauge
            value={L.cm3.pct != null ? L.cm3.pct * 100 : null}
            min={Math.min(...PL_HISTORY.map(m => (m.cm3 / m.nr) * 100))}
            max={Math.max(...PL_HISTORY.map(m => (m.cm3 / m.nr) * 100))}
            label="Estimated CM3 margin"
            sub={`Where this period's estimated CM3 margin sits inside the 16 months the tracker records. Filled segments show the position, not a target.`}
          />
        </div>
      </div>

      {/* ── REVENUE GROWTH vs PROFIT GROWTH ── */}
      <div className="section rise d3"><h2>Revenue Growth vs Profit Growth</h2><span className="note">does revenue growth translate into profit growth?</span></div>
      <div className="card rise d3">
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={growthPairs} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-32} textAnchor="end" height={54} />
              <YAxis tickFormatter={v => v.toFixed(0) + '%'} tickLine={false} axisLine={false} width={46} />
              <Tooltip formatter={(v, n) => [Number(v).toFixed(1) + '%', n]} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke={CH.grey3} />
              <Bar dataKey="revG" name="Net Revenue growth MoM" fill={CH.grey4} radius={[3, 3, 0, 0]} />
              <Bar dataKey="cm2G" name="CM2 growth MoM" radius={[3, 3, 0, 0]}>
                {growthPairs.map((d, i) => <Cell key={i} fill={d.cm2G != null && d.revG != null && d.cm2G < d.revG ? 'var(--down)' : CH.ink} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="card-sub" style={{ marginTop: 4, marginBottom: 0 }}>
          Grey is revenue growth, dark is contribution growth. <b style={{ color: 'var(--down)' }}>Red</b> marks months where contribution grew
          slower than revenue — growth that cost margin.
        </p>
      </div>

      {/* ── TREND ── */}
      <div className="section rise d3">
        <h2>Profitability Trend</h2>
        <span className="note">
          <button className={'chip' + (trendMode === 'value' ? ' on' : '')} onClick={() => setTrendMode('value')}>₹ Value</button>{' '}
          <button className={'chip' + (trendMode === 'margin' ? ' on' : '')} onClick={() => setTrendMode('margin')}>Margin %</button>
        </span>
      </div>
      <div className="card rise d3">
        <div className="card-head"><h3>{trendMode === 'value' ? 'Revenue, CM1, CM2 and CM3' : 'CM1, CM2 and CM3 margin'}</h3><span className="meta">actual monthly P&amp;L from the tracker — not estimated</span></div>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ top: 8, right: 12, left: 6, bottom: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10.5 }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={52} />
              <YAxis tickFormatter={v => trendMode === 'value' ? v.toFixed(0) + 'Cr' : v.toFixed(0) + '%'} tickLine={false} axisLine={false} width={48} />
              <Tooltip formatter={(v, n) => [trendMode === 'value' ? '₹' + Number(v).toFixed(2) + ' Cr' : Number(v).toFixed(1) + '%', n]} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11.5 }} />
              <ReferenceLine y={0} stroke="var(--down)" strokeDasharray="3 3" />
              {trendMode === 'value' ? (
                <>
                  <Bar dataKey="netRevenue" name="Net Revenue" fill={CH.grey5} radius={[3, 3, 0, 0]} />
                  <Line dataKey="cm1" name="CM1" stroke={CH.grey3} strokeWidth={1.8} dot={false} />
                  <Line dataKey="cm2" name="CM2" stroke={CH.grey2} strokeWidth={1.8} dot={false} />
                  <Line dataKey="cm3" name="CM3" stroke={CH.blue} strokeWidth={2.4} dot={{ r: 2.5, fill: CH.blue }} />
                </>
              ) : (
                <>
                  <Line dataKey="cm1m" name="CM1 %" stroke={CH.grey3} strokeWidth={1.8} dot={false} />
                  <Line dataKey="cm2m" name="CM2 %" stroke={CH.grey2} strokeWidth={1.8} dot={false} />
                  <Line dataKey="cm3m" name="CM3 %" stroke={CH.blue} strokeWidth={2.4} dot={{ r: 2.5, fill: CH.blue }} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="card-sub" style={{ marginTop: 6, marginBottom: 0 }}>
          The business ran <b>CM3-negative from Feb'26 through Jun'26</b> (as low as −14.6% in May) and returned to +2.1% in July'26.
          The swing is driven almost entirely by brand marketing, which moved from 9.2% to 35.4% of net revenue across this history.
        </p>
      </div>

      </>}

      {/* ── QUALITY & CHANNELS TAB ── */}
      {tab === 'channels' && <>
      {/* ── REVENUE QUALITY ── */}
      <div className="section rise d3"><h2>Revenue Quality</h2><span className="note">how much of the revenue is actually valuable to the business</span></div>
      <div className="card rise d3">
        <table className="tbl">
          <thead><tr><th>Stage</th><th style={{ textAlign: 'right' }}>This period</th><th style={{ textAlign: 'right' }}>Prior period</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>% of gross revenue</th></tr></thead>
          <tbody>
            {[
              ['Gross Revenue', L.grossRevenue, PL_.grossRevenue],
              ['Net Revenue', L.netRevenue, PL_.netRevenue],
              ['Contribution Margin 1', L.cm1, PL_.cm1],
              ['Contribution Margin 2', L.cm2, PL_.cm2],
              ['Contribution Margin 3', L.cm3, PL_.cm3],
              ['Estimated Net Profit', L.netProfit, PL_.netProfit],
            ].map(([lbl, c, p]) => {
              const g = growth(c.value, p.value);
              const shareOfGross = c.value != null && L.grossRevenue.value ? c.value / L.grossRevenue.value : null;
              return (
                <tr key={lbl}>
                  <td><b>{lbl}</b> <Kind kind={c.kind} basisLabel={basis.label} /></td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{c.kind === 'unavailable' ? '—' : money(c.value)}</td>
                  <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{p.kind === 'unavailable' ? '—' : money(p.value)}</td>
                  <td style={{ textAlign: 'right' }}>{g == null ? '—' : <span className={'delta ' + (Math.abs(g) < 0.5 ? 'flat' : g > 0 ? 'up' : 'down')}>{(g > 0 ? '↑ ' : '↓ ') + Math.abs(g).toFixed(1) + '%'}</span>}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{shareOfGross == null ? '—' : pctS(shareOfGross)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── EXPENSE MIX ── */}
      <div className="section rise d4"><h2>Expense Mix</h2><span className="note">where the money goes</span></div>
      <div className="card rise d4">
        <div className="mixbar">
          {expenseMix.map(m => m.share > 0 && (
            <span key={m.name} className="mixseg" style={{ width: (m.share * 100) + '%', background: m.fill }} title={`${m.name} — ${money(m.value)} (${pctS(m.share, 0)})`} />
          ))}
        </div>
        <div className="mixlegend">
          {expenseMix.map(m => (
            <span key={m.name}><i className="dot" style={{ background: m.fill }} />{m.name} <b>{pctS(m.share, 0)}</b> <small>{money(m.value)}</small></span>
          ))}
        </div>
        {L.fixedOpex.value == null && <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>Fixed / operating expenses are <b>not in the tracker</b> and are therefore absent from this mix — the shares above are of <i>variable</i> cost only.</p>}
      </div>

      {/* ── CHANNEL PROFITABILITY ── */}
      <div className="section rise d4"><h2>Channel Profitability</h2><span className="note">each channel on its own July'26 economics — ranked by estimated CM2</span></div>
      <div className="card rise d4">
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chanRows} margin={{ top: 8, right: 12, left: 6, bottom: 56 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="channel" tick={{ fontSize: 10.5 }} angle={-28} textAnchor="end" interval={0} height={68} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => inrShort(v, { currency: false })} tickLine={false} axisLine={false} width={54} />
              <Tooltip formatter={(v, n) => [money(v), n === 'netRevenue' ? 'Net Revenue' : n === 'cm2' ? 'Est. CM2' : n]} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11.5 }} formatter={v => v === 'netRevenue' ? 'Net Revenue (actual)' : 'Estimated CM2'} />
              <ReferenceLine y={0} stroke="var(--ink-3)" />
              <Bar dataKey="netRevenue" fill={CH.grey5} radius={[3, 3, 0, 0]} />
              <Bar dataKey="cm2" radius={[3, 3, 0, 0]}>
                {chanRows.map((d, i) => <Cell key={i} fill={d.cm2 >= 0 ? CH.ink : 'var(--down)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── BUSINESS vs ADVERTISING HEALTH ── */}
      <div className="section rise d4"><h2>Business vs Advertising Health</h2><span className="note">is advertising generating profitable revenue, or just revenue?</span></div>
      <div className="card rise d4" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl chanpl">
          <thead>
            <tr>
              <th>Channel</th>
              <th style={{ textAlign: 'right' }}>Net Revenue</th>
              <th style={{ textAlign: 'right' }}>Ad Spend</th>
              <th style={{ textAlign: 'right' }}>ROAS</th>
              <th style={{ textAlign: 'right' }}>TACOS</th>
              <th style={{ textAlign: 'right' }}>Est. COGS</th>
              <th style={{ textAlign: 'right' }}>Est. CM1</th>
              <th style={{ textAlign: 'right' }}>Est. CM2</th>
              <th style={{ textAlign: 'right' }}>CM2 %</th>
              <th>Read</th>
            </tr>
          </thead>
          <tbody>
            {chanRows.map(c => {
              const verdict = !c.marketingAllocated ? { t: 'no ads allocated', cls: 'flat' }
                : c.cm2 < 0 ? { t: 'destroys margin', cls: 'down' }
                : c.roas != null && c.roas >= 4 && c.cm2Pct >= 0.25 ? { t: 'profitable engine', cls: 'up' }
                : c.roas != null && c.roas >= 4 && c.cm2Pct < 0.15 ? { t: 'high ROAS, thin margin', cls: 'down' }
                : c.cm2Pct >= 0.30 ? { t: 'scale opportunity', cls: 'up' }
                : { t: 'needs optimisation', cls: 'flat' };
              return (
                <tr key={c.channel}>
                  <td><span className="ch"><ChannelLogo channel={c.channel} size={19} />{c.channel}
                    {c.plBasis === 'B2B' && <span className="tag" title="measured on a primary (sell-in) basis in the tracker">P</span>}
                    {!c.matched && <span className="tag" title="no matching channel in the tracker — blended ratios used">blended</span>}
                  </span></td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{money(c.netRevenue)}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{c.spend > 0 ? money(c.spend) : '—'}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{c.roas != null ? c.roas.toFixed(2) + 'x' : '—'}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{c.tacos != null ? c.tacos.toFixed(1) + '%' : '—'}</td>
                  <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{money(c.cogs)}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{money(c.cm1)}</td>
                  <td className="tnum" style={{ textAlign: 'right', color: c.cm2 < 0 ? 'var(--down)' : 'var(--ink)', fontWeight: 600 }}>{money(c.cm2)}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{pctS(c.cm2Pct)}</td>
                  <td><span className={'delta ' + verdict.cls}>{verdict.t}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="card-sub" style={{ margin: '10px 14px 12px' }}>
          <b>ROAS follows the tracker's own definition</b> — Net Revenue ÷ Performance Marketing (blended, not ad-attributed;
          the tracker's July blended total was 4.82x). TACOS is the reciprocal on the same base. Both use actual spend. COGS, CM1 and CM2 apply each channel's
          own July'26 tracker ratios — which differ enormously (Nykaa CM1 8.2% vs Amazon 45.2%), so a blended rate would be misleading.
          Channels marked <b>P</b> are primary-basis in the tracker. Channels with no marketing allocated in the tracker show overstated CM2.
        </p>
      </div>

      </>}

      {/* ── WHAT IT MEANS TAB ── */}
      {tab === 'means' && <>
      {/* ── MANAGEMENT INSIGHTS ── */}
      {insights.length > 0 && (
        <>
          <div className="section rise d4"><h2>Management Insights</h2><span className="note">generated only where the data supports the claim</span></div>
          <div className="card rise d4">
            {insights.map((i, n) => (
              <div className="focus-item" key={n}>
                <span className="n" style={{ color: i.tone === 'bad' ? 'var(--down)' : i.tone === 'good' ? 'var(--up)' : 'var(--ink-3)' }}>{i.tone === 'bad' ? '▲' : i.tone === 'good' ? '▼' : '■'}</span>
                <p><b>{i.head}.</b> {i.body}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── SO WHAT ── */}
      <div className="section rise d4"><h2>What This Means for the Business</h2><span className="note">decision-oriented summary</span></div>
      <div className="card rise d4 sowhat">
        {[
          ['Are we profitable?', L.cm3.value == null ? 'Not determinable.' : `At the CM3 line — after COGS, platform fees, logistics and all marketing — the estimate is ${money(L.cm3.value)} (${pctS(L.cm3.pct)} of net revenue) for this period. ${L.netProfit.value == null ? 'True net profit cannot be stated: the tracker has no fixed-cost block, so overheads are not included.' : `After the ₹${(Number(oh) / 1e5).toFixed(1)}L/month overheads you entered, estimated net profit is ${money(L.netProfit.value)} (${pctS(L.netProfit.pct)}).`}`],
          ['Is profitability improving or deteriorating?', (() => {
            const c = L.cm3.pct, p = PL_.cm3.pct;
            if (c == null || p == null) return 'Not comparable for these windows.';
            const d = (c - p) * 100;
            return `Estimated CM3 margin moved from ${pctS(p)} to ${pctS(c)} (${d >= 0 ? '+' : ''}${d.toFixed(1)}pp) versus the prior window. Across the tracker's own 16 months, CM3 has ranged −14.6% to +16.1%.`;
          })()],
          ['What is putting the most pressure on margins?', (() => {
            const items = expenseMix.slice().sort((a, b) => b.value - a.value);
            const top = items[0], second = items[1];
            return `${top.name} is the largest cost at ${money(top.value)} (${pctS(top.share, 0)} of variable cost), followed by ${second.name} at ${pctS(second.share, 0)}. Combined marketing (performance + brand) is ${pctS((-(L.perfMkt.value + L.retentionMkt.value + L.brandMkt.value + L.freebiesGWP.value)) / (L.netRevenue.value || 1))} of net revenue.`;
          })()],
          ['Which channels are actually contributing profit?', (() => {
            const pos = chanRows.filter(c => c.marketingAllocated && c.cm2 > 0);
            const neg = chanRows.filter(c => c.marketingAllocated && c.cm2 < 0);
            return `${pos.length ? pos.slice(0, 3).map(c => `${c.channel} (${money(c.cm2)})`).join(', ') : 'None'} contribute positively after advertising.${neg.length ? ` ${neg.map(c => c.channel).join(', ')} ${neg.length === 1 ? 'is' : 'are'} contribution-negative.` : ''}`;
          })()],
          ['Is advertising helping or hurting profitability?', (() => {
            const spendC = [...spendCur.values()].reduce((s, v) => s + v, 0);
            if (!spendC) return 'No ad spend recorded for this window.';
            const cm1 = L.cm1.value, cm2 = L.cm2.value;
            return `Advertising consumes ${pctS(spendC / (cm1 || 1), 0)} of estimated CM1, taking contribution from ${money(cm1)} down to ${money(cm2)}. ${cm2 > 0 ? 'It remains net-accretive at the CM2 line' : 'It pushes the business below breakeven at the CM2 line'} on this period's economics.`;
          })()],
          ['What should management focus on?', (() => {
            const worst = chanRows.filter(c => c.marketingAllocated).slice().sort((a, b) => a.cm2Pct - b.cm2Pct)[0];
            const brandPct = L.brandMkt.pct;
            return `${brandPct != null && brandPct > 0.15 ? `Brand marketing at ${pctS(brandPct)} of net revenue is the single largest controllable swing factor — it alone explains the Feb–Jun CM3 losses. ` : ''}${worst ? `${worst.channel} has the weakest contribution at ${pctS(worst.cm2Pct)} CM2 and is the clearest optimisation target. ` : ''}Confirming the fixed-cost base with finance would convert this from a contribution model into a true profit model.`;
          })()],
        ].map(([q, a]) => (
          <div className="sw-item" key={q}>
            <h4>{q}</h4>
            <p>{a}</p>
          </div>
        ))}
      </div>

      </>}

      {/* ── ASSUMPTIONS ── */}
      {showAssume && (
        <>
          <div className="section rise"><h2>Assumptions &amp; Transparency</h2><span className="note">exactly how every estimated figure is calculated</span></div>

          <div className="card rise">
            <div className="card-head"><h3>Fixed / Operating Expenses</h3><span className="meta">not present in the tracker</span></div>
            <p className="card-sub">
              All 19 sheets of the Weekly P&amp;L Tracker were searched for salary, rent, overhead, manpower, depreciation, EBITDA,
              interest and tax lines — <b>none exist</b>. The P&amp;L terminates at Contribution Margin 3. Enter a monthly fixed-overhead
              figure from finance to model Estimated Net Profit; leave it blank and the dashboard will keep reporting
              "insufficient data" rather than a fabricated number.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono-lbl">Fixed overheads ₹ / month</span>
              <input className="date-in" type="number" min="0" step="100000" placeholder="e.g. 20000000" value={overheads}
                onChange={e => setOverheads(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 190 }} />
              {overheads !== '' && <button className="chip" onClick={() => setOverheads('')}>Clear</button>}
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                scaled by {months.toFixed(2)} months for this window{overheads !== '' && ` → ${money(Number(overheads) * months)}`}
              </span>
            </div>
          </div>

          <div className="card rise d1">
            <div className="card-head"><h3>Ratios in use — {basis.label}</h3><span className="meta">{R.months.join(', ')}</span></div>
            <table className="tbl">
              <thead><tr><th>Line</th><th style={{ textAlign: 'right' }}>% of Net Revenue</th><th>Source</th></tr></thead>
              <tbody>
                {[
                  ['COGS', R.detail.cogs], ['B2C Commission & Platform Expenses', R.detail.b2cComm],
                  ['Website Expenses', R.detail.websiteExp], ['B2B Secondary Discounts', R.detail.b2bSecDisc],
                  ['Freight Forward', R.detail.freightForward], ['Warehousing', R.detail.warehousing],
                  ['Tertiary Packaging', R.detail.tertiaryPackaging], ['Performance Marketing', R.detail.perfMkt],
                  ['Retention Marketing', R.detail.retentionMkt], ['Brand Marketing', R.detail.brandMkt],
                  ['Freebies (GWP)', R.detail.freebiesGWP],
                ].map(([lbl, v]) => (
                  <tr key={lbl}><td>{lbl}</td><td className="tnum" style={{ textAlign: 'right' }}>{pctS(v, 2)}</td>
                    <td style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{R.detail.exact ? "Channel PL FTM, July'26 — exact" : `${basis.label} roll-up, split by July's internal mix`}</td></tr>
                ))}
                <tr><td>Returns</td><td className="tnum" style={{ textAlign: 'right' }}>{pctS(R.returnsOfGross, 2)}</td><td style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>of Gross Revenue · from {R.grossChainFrom}</td></tr>
                <tr><td>Net Revenue at SP ÷ Gross Revenue</td><td className="tnum" style={{ textAlign: 'right' }}>{pctS(R.netSpOfGross, 2)}</td><td style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>single measured wedge · from {R.grossChainFrom}</td></tr>
                <tr><td>GST</td><td className="tnum" style={{ textAlign: 'right' }}>÷ {GST_DIVISOR}</td><td style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>exact divisor, verified against the tracker</td></tr>
              </tbody>
            </table>
            {!R.detail.exact && (
              <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
                Only <b>Channel PL FTM (July'26)</b> carries the individual lines. `Plan vs Proj` records the rolling months at
                roll-up level only, so on this basis the <b>roll-up totals are real</b> and the split within them uses July's internal
                proportions. The Gross→Net chain always comes from {R.grossChainFrom}.
              </p>
            )}
          </div>

          <div className="card rise d1">
            <div className="card-head"><h3>Is July representative?</h3><span className="meta">stability across 16 months</span></div>
            <table className="tbl">
              <thead><tr><th>Line</th><th style={{ textAlign: 'right' }}>Jul'26</th><th style={{ textAlign: 'right' }}>3M</th><th style={{ textAlign: 'right' }}>6M</th><th style={{ textAlign: 'right' }}>16M</th><th style={{ textAlign: 'right' }}>Range</th><th>Verdict</th></tr></thead>
              <tbody>
                {stability.map(s => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{s.july.toFixed(1)}%</td>
                    <td className="tnum" style={{ textAlign: 'right' }}>{s.m3.toFixed(1)}%</td>
                    <td className="tnum" style={{ textAlign: 'right' }}>{s.m6.toFixed(1)}%</td>
                    <td className="tnum" style={{ textAlign: 'right' }}>{s.m16.toFixed(1)}%</td>
                    <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{s.min.toFixed(1)} – {s.max.toFixed(1)}</td>
                    <td><span className={'delta ' + (s.verdict === 'stable' ? 'up' : s.verdict === 'moderate' ? 'flat' : 'down')}>{s.verdict}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
              <b>July was the strongest month in six on most lines</b> — COGS 3.2pp below the 6-month average, brand marketing 5.8pp below,
              performance marketing at a 16-month low. B2C Commission is the exception, at an all-time high of 11.6% vs a 4.1% 6-month
              average, which looks like a reclassification rather than a cost spike. Using July alone therefore reads <b>optimistically</b>;
              switch the basis above to stress-test.
            </p>
          </div>

          <div className="card rise d2">
            <div className="card-head"><h3>Revenue basis reconciliation</h3><span className="meta">why dashboard revenue ≠ tracker revenue</span></div>
            <p className="card-sub">
              The tracker mixes two measurement bases. <b>B2C channels</b> (Website, Amazon, Flipkart, Myntra, Meesho) are secondary
              (sell-out) — the same basis as this dashboard, so their actual MRP→SP wedge is used as the real discount.
              <b> Primary <i>(P)</i> channels</b> (Nykaa, Purplle, Blinkit, Zepto, Swiggy, Reliance, Amazon Now, Flipkart Minutes) are
              sell-in and carry a B2B Margin deduction that does not exist in secondary data — for these the engine takes actual MRP as
              Gross and applies that channel's own tracker ratio.
            </p>
            <table className="tbl">
              <thead><tr><th>Measure</th><th style={{ textAlign: 'right' }}>Dashboard (secondary, Jul'26)</th><th style={{ textAlign: 'right' }}>Tracker (Jul'26)</th><th style={{ textAlign: 'right' }}>Delta</th></tr></thead>
              <tbody>
                <tr><td>Gross Revenue / MRP</td><td className="tnum" style={{ textAlign: 'right' }}>₹26.44 Cr</td><td className="tnum" style={{ textAlign: 'right' }}>₹29.10 Cr</td><td style={{ textAlign: 'right' }}><span className="delta down">−9.1%</span></td></tr>
                <tr><td>Net Revenue at SP</td><td className="tnum" style={{ textAlign: 'right' }}>₹22.30 Cr</td><td className="tnum" style={{ textAlign: 'right' }}>₹20.18 Cr</td><td style={{ textAlign: 'right' }}><span className="delta up">+10.5%</span></td></tr>
                <tr><td>Website gross (control)</td><td className="tnum" style={{ textAlign: 'right' }}>₹4.4080 Cr</td><td className="tnum" style={{ textAlign: 'right' }}>₹4.4080 Cr</td><td style={{ textAlign: 'right' }}><span className="delta up">exact</span></td></tr>
                <tr><td>Performance Marketing</td><td className="tnum" style={{ textAlign: 'right' }}>₹3.0299 Cr</td><td className="tnum" style={{ textAlign: 'right' }}>₹3.4900 Cr</td><td style={{ textAlign: 'right' }}><span className="delta down">−13.2%</span></td></tr>
              </tbody>
            </table>
            <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
              <b>Ad spend is actual</b>, unioned from both performance sources the tracker's Performance Marketing line represents —
              marketplace retail media plus D2C Facebook/Google (Website ₹1.17 Cr actual vs ₹1.20 Cr in the tracker). Of the −13.2%
              residual, ₹16.75L is Flipkart <b>ad credits</b> the tracker adds back; the rest sits almost entirely in Nykaa
              (₹2.6L actual vs ₹19.2L) and Purplle (₹2.4L vs ₹11.7L), whose retail-media spend appears to be booked outside the ads
              tables. Amazon (₹60.22L vs ₹60.27L) and Meesho (₹13.89L both) reconcile almost exactly.
            </p>
            <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
              The gross gap is substantially explained by four primary-basis channels absent from the secondary view
              (Purplle, Reliance, Amazon Now, Flipkart Minutes ≈ ₹2.95 Cr). The SP gap is the B2B Margin (₹3.49 Cr) that primary
              channels deduct and secondary data does not. Website reconciles exactly, confirming the mapping.
              {P.unmatched.length > 0 && <> Channels with no tracker match in this window: <b>{[...new Set(P.unmatched)].join(', ')}</b> — blended ratios applied.</>}
            </p>
          </div>
        </>
      )}
    </>
  );
}
