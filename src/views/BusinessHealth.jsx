import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, BarChart, ReferenceLine,
} from 'recharts';
import { inRange, trendByDay, trendByMonth, byChannel, pop, sumField } from '../lib/metrics.js';
import { aggBy } from '../lib/cube.js';
import { inrShort, countShort, pct, signedPct, shortDate, monthLabel, longDate } from '../lib/format.js';
import { Delta } from '../components/ui.jsx';
import { ChannelLogo, useCountUp, Sparkline, StatCard } from '../components/viz.jsx';
import { fetchAdSpend } from '../lib/api.js';

const sum = (rows, f) => rows.reduce((s, r) => s + (r[f] || 0), 0);

function CountNum({ value, fmt, className, style }) {
  const v = useCountUp(value);
  return <span className={className} style={style}>{fmt(v)}</span>;
}

// ── profitability ladder row ──
function Ladder({ rows }) {
  return (
    <div className="ladder">
      {rows.map((r, i) => (
        <div key={i} className={'ladder-row' + (r.result ? ' result' : '') + (r.locked ? ' locked' : '')}>
          <span className="op">{r.op || ''}</span>
          <span className="nm">{r.name}{r.note && <small>{r.note}</small>}</span>
          {r.locked
            ? <span className="amt">— <span className="lockpill">requires {r.requires}</span></span>
            : <CountNum className="amt tnum" value={r.value} fmt={inrShort} />}
          <span className="pctm">{r.pct != null ? r.pct : ''}</span>
        </div>
      ))}
    </div>
  );
}

export default function BusinessHealth({ data, cube, cubeLoading, meta, from, to, prevFrom, prevTo }) {
  const colorOf = c => (meta && meta.channelColors && meta.channelColors[c]) || '#4B5BD7';

  const cur = useMemo(() => inRange(data, from, to), [data, from, to]);
  const prev = useMemo(() => inRange(data, prevFrom, prevTo), [data, prevFrom, prevTo]);

  // ── ad spend for both windows (independent fetch; stale-friendly) ──
  const [ads, setAds] = useState(null);
  const adsReq = useRef(0);
  useEffect(() => {
    const my = ++adsReq.current;
    fetchAdSpend(from, to, prevFrom, prevTo)
      .then(r => { if (my === adsReq.current) setAds(r); })
      .catch(() => { if (my === adsReq.current) setAds({ cur: [], prev: [] }); });
  }, [from, to, prevFrom, prevTo]);

  const spendCur = ads ? sum(ads.cur, 'spend') : 0;
  const spendPrev = ads ? sum(ads.prev, 'spend') : 0;
  const spendByCh = useMemo(() => new Map((ads ? ads.cur : []).map(a => [a.channel, a.spend])), [ads]);

  // ── the honest P&L ladder ──
  const H = useMemo(() => {
    const gross = sumField(cur, 'mrp'), net = sumField(cur, 'sp');
    const pGross = sumField(prev, 'mrp'), pNet = sumField(prev, 'sp');
    const units = sumField(cur, 'units'), pUnits = sumField(prev, 'units');
    const orders = sumField(cur, 'orders'), pOrders = sumField(prev, 'orders');
    const discount = gross - net, pDiscount = pGross - pNet;
    const contrib = net - spendCur, pContrib = pNet - spendPrev;
    const g = (c, p) => (p > 0 ? ((c - p) / p) * 100 : null);
    return {
      gross, net, discount, contrib, units, orders,
      discountPct: gross > 0 ? (discount / gross) * 100 : 0,
      pDiscountPct: pGross > 0 ? (pDiscount / pGross) * 100 : 0,
      contribPct: net > 0 ? (contrib / net) * 100 : 0,
      pContribPct: pNet > 0 ? (pContrib / pNet) * 100 : 0,
      aov: orders > 0 ? net / orders : 0,
      pAov: pOrders > 0 ? pNet / pOrders : 0,
      tacos: net > 0 ? (spendCur / net) * 100 : 0,
      netG: g(net, pNet), grossG: g(gross, pGross), contribG: g(contrib, pContrib),
      unitsG: g(units, pUnits), ordersG: g(orders, pOrders),
      aovG: pOrders > 0 && orders > 0 ? g(net / orders, pNet / pOrders) : null,
      pNet, pContrib,
    };
  }, [cur, prev, spendCur, spendPrev]);

  // ── per-metric daily sparklines for the KPI strip ──
  const sparks = useMemo(() => {
    const net = trendByDay(cur, 'sp').map(p => p.value);
    const gross = trendByDay(cur, 'mrp').map(p => p.value);
    const orders = trendByDay(cur, 'orders').map(p => p.value);
    const units = trendByDay(cur, 'units').map(p => p.value);
    // discount + aov derived per day from paired mrp/sp/orders
    const byDay = new Map();
    for (const r of cur) {
      let e = byDay.get(r.date); if (!e) { e = { mrp: 0, sp: 0, orders: 0 }; byDay.set(r.date, e); }
      e.mrp += r.mrp || 0; e.sp += r.sp || 0; e.orders += r.orders || 0;
    }
    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, e]) => e);
    return {
      net, gross, orders, units,
      discount: days.map(e => e.mrp - e.sp),
      aov: days.map(e => (e.orders > 0 ? e.sp / e.orders : 0)),
    };
  }, [cur]);

  // ── channels with contribution economics ──
  const channels = useMemo(() => {
    const arr = byChannel(cur, 'sp');
    const prevBy = new Map(byChannel(prev, 'sp').map(c => [c.channel, c.value]));
    const maxV = Math.max(...arr.map(c => c.value), 1);
    return arr.filter(c => c.value > 0).map(c => {
      const pv = prevBy.get(c.channel) || 0;
      const spend = spendByCh.get(c.channel) || 0;
      const contrib = c.value - spend;
      return {
        ...c, prevValue: pv, spend, contrib,
        contribMargin: c.value > 0 ? (contrib / c.value) * 100 : 0,
        deltaPct: pv > 0 ? ((c.value - pv) / pv) * 100 : null,
        w: (c.value / maxV) * 100, spendX: (spend / maxV) * 100,
        spark: trendByDay(cur.filter(r => r.channel === c.channel), 'sp').map(p => p.value),
      };
    });
  }, [cur, prev, spendByCh]);

  // ── alerts (meaningful exceptions only) ──
  const alerts = useMemo(() => {
    const out = [];
    const dDelta = H.discountPct - H.pDiscountPct;
    if (dDelta > 1.5) out.push({ tone: 'red', text: <>Margin compression — discounting up <b>{dDelta.toFixed(1)}pts</b> to {pct(H.discountPct, 1)} of gross</> });
    const decl = channels.filter(c => c.deltaPct != null && c.deltaPct < -10 && c.share > 3);
    if (decl.length) out.push({ tone: 'amber', text: <>Channel decline — <b>{decl.map(d => d.channel).slice(0, 2).join(', ')}</b> down {signedPct(Math.abs(decl[0].deltaPct)).replace('+','')}</> });
    const top1 = channels[0];
    if (top1 && top1.share > 45) out.push({ tone: 'amber', text: <>Concentration — <b>{top1.channel}</b> is {pct(top1.share, 0)} of revenue</> });
    if (H.netG != null && H.contribG != null && H.netG - H.contribG > 8)
      out.push({ tone: 'red', text: <>Revenue up {signedPct(H.netG)} but contribution only {signedPct(H.contribG)} — spend is outpacing growth</> });
    const grow = channels.filter(c => c.deltaPct != null && c.deltaPct > 25 && c.share > 2);
    if (grow.length) out.push({ tone: 'green', text: <>Momentum — <b>{grow[0].channel}</b> up {signedPct(grow[0].deltaPct)}</> });
    if (!out.length) out.push({ tone: 'green', text: <>All clear — no exceptions vs prior period</> });
    return out.slice(0, 4);
  }, [H, channels]);

  // ── trajectory: revenue vs post-ad contribution (contribution approximated
  //    by allocating range spend across days pro-rata to daily revenue) ──
  const useMonthly = new Set(cur.map(r => r.date)).size > 92;
  const trajectory = useMemo(() => {
    const t = useMonthly ? trendByMonth(cur, 'sp') : trendByDay(cur, 'sp');
    const tot = t.reduce((s, p) => s + p.value, 0) || 1;
    return t.map(p => ({
      x: useMonthly ? p.ym : p.date,
      revenue: p.value,
      contribution: p.value - spendCur * (p.value / tot),
    }));
  }, [cur, spendCur, useMonthly]);

  // ── revenue bridge: prev → channel deltas → current ──
  const bridge = useMemo(() => {
    const deltas = channels
      .map(c => ({ name: c.channel, d: c.value - c.prevValue }))
      .filter(x => Math.abs(x.d) > 0)
      .sort((a, b) => b.d - a.d);
    const top = deltas.slice(0, 4);
    const rest = deltas.slice(4).reduce((s, x) => s + x.d, 0);
    const steps = [{ name: 'Prior period', v: H.pNet, kind: 'base' }];
    let run = H.pNet;
    for (const t of top) { steps.push({ name: t.name, v: t.d, base: t.d >= 0 ? run : run + t.d, kind: t.d >= 0 ? 'up' : 'down' }); run += t.d; }
    if (Math.abs(rest) > 0) { steps.push({ name: 'Others', v: rest, base: rest >= 0 ? run : run + rest, kind: rest >= 0 ? 'up' : 'down' }); run += rest; }
    steps.push({ name: 'This period', v: run, kind: 'base' });
    return steps.map(s => ({ ...s, range: s.kind === 'base' ? [0, s.v] : [s.base, s.base + Math.abs(s.v)] }));
  }, [channels, H.pNet]);

  // ── management brief ──
  const brief = useMemo(() => {
    const out = [];
    if (H.netG != null && H.contribG != null)
      out.push(<>Net revenue is <b>{signedPct(H.netG)}</b> vs prior at <b>{inrShort(H.net)}</b>, while post-ad contribution moved <b>{signedPct(H.contribG)}</b>{H.netG - H.contribG > 5 ? <> — growth is being partly bought with ad spend</> : H.contribG - H.netG > 5 ? <> — efficiency improved faster than revenue</> : null}.</>);
    const gainers = channels.filter(c => c.deltaPct != null && c.value - c.prevValue > 0).sort((a, b) => (b.value - b.prevValue) - (a.value - a.prevValue)).slice(0, 2);
    if (gainers.length) out.push(<>Growth led by <b>{gainers.map(g => g.channel).join(' and ')}</b>, together adding {inrShort(gainers.reduce((s, g) => s + g.value - g.prevValue, 0))}.</>);
    const losers = channels.filter(c => c.value - c.prevValue < 0).sort((a, b) => (a.value - a.prevValue) - (b.value - b.prevValue)).slice(0, 1);
    if (losers.length) out.push(<><b>{losers[0].channel}</b> declined {signedPct(Math.abs(losers[0].deltaPct || 0)).replace('+','')}, a {inrShort(Math.abs(losers[0].value - losers[0].prevValue))} drag on the period.</>);
    const dDelta = H.discountPct - H.pDiscountPct;
    if (Math.abs(dDelta) > 0.5) out.push(<>Effective discounting {dDelta > 0 ? 'widened' : 'tightened'} <b>{Math.abs(dDelta * 100).toFixed(0)} bps</b> to {pct(H.discountPct, 1)} of gross.</>);
    if (H.aovG != null && Math.abs(H.aovG) > 1) out.push(<>AOV {H.aovG > 0 ? 'improved' : 'deteriorated'} <b>{signedPct(Math.abs(H.aovG)).replace('+','')}</b> to {inrShort(H.aov)} — {H.ordersG != null && H.unitsG != null && H.ordersG > H.unitsG ? 'order growth is outpacing units' : 'watch volume-vs-price mix'}.</>);
    if (cube && cube.length) {
      const skus = aggBy(cube.filter(r => !r.unmapped), r => r.sku, 'sp', r => ({ p: r.product }));
      const top5 = skus.slice(0, 5).reduce((s, x) => s + x.share, 0);
      if (top5 > 0) out.push(<>Top 5 SKUs contribute <b>{pct(top5, 0)}</b> of revenue{top5 > 55 ? ' — concentration worth monitoring' : ''}.</>);
    }
    return out;
  }, [H, channels, cube]);

  // ── drill-down: channel → category → subcat → SKU (progressive drawer) ──
  const [drill, setDrill] = useState(null); // channel name
  const [open, setOpen] = useState(() => new Set());
  const drillTree = useMemo(() => {
    if (!drill || !cube) return null;
    const rows = cube.filter(r => r.channel === drill);
    const cats = new Map();
    for (const r of rows) {
      let c = cats.get(r.category); if (!c) { c = { name: r.category, v: 0, subs: new Map() }; cats.set(r.category, c); }
      c.v += r.curSp || 0;
      let sN = c.subs.get(r.subCategory); if (!sN) { sN = { name: r.subCategory, v: 0, skus: [] }; c.subs.set(r.subCategory, sN); }
      sN.v += r.curSp || 0;
      sN.skus.push({ name: r.product || r.sku, v: r.curSp || 0 });
    }
    return [...cats.values()].map(c => ({ ...c, subs: [...c.subs.values()].map(s2 => ({ ...s2, skus: s2.skus.sort((a, b) => b.v - a.v).slice(0, 12) })).sort((a, b) => b.v - a.v) })).sort((a, b) => b.v - a.v).filter(c => c.v > 0);
  }, [drill, cube]);
  const toggle = k => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (!cur.length) return <div className="empty">No revenue in this range yet.</div>;

  const ladderRows = [
    { name: 'Gross Revenue', note: 'MRP basis', value: H.gross, pct: '100%' },
    { op: '−', name: 'Discounts', note: `${pct(H.discountPct, 1)} of gross`, value: H.discount },
    { op: '=', name: 'Net Revenue', note: 'selling-price basis', value: H.net, pct: pct((H.net / (H.gross || 1)) * 100, 1), result: false },
    { op: '−', name: 'Ad Spend', note: `TACOS ${pct(H.tacos, 1)}`, value: spendCur },
    { op: '=', name: 'Post-Ad Contribution', note: 'before COGS & platform costs', value: H.contrib, pct: pct(H.contribPct, 1), result: true },
    { op: '−', name: 'COGS → Gross Profit', locked: true, requires: 'COGS feed' },
    { op: '−', name: 'Platform & Ops costs → Net Profit', locked: true, requires: 'cost ledger' },
  ];

  return (
    <>
      {/* ── ALERTS ── */}
      <div className="alert-strip rise">
        {alerts.map((a, i) => (
          <span key={i} className={'alert-chip ' + a.tone}><span className="dot2" />{a.text}</span>
        ))}
      </div>

      {/* ── KPI STRIP: sparkline cards for the headline economics ── */}
      <div className="stat-strip rise">
        <StatCard label="Net Revenue" value={H.net} fmt={inrShort} spark={sparks.net} delta={H.netG} sublabel="selling-price basis" accent="#12886A" />
        <StatCard label="Gross Revenue" value={H.gross} fmt={inrShort} spark={sparks.gross} delta={H.grossG} sublabel="MRP basis" accent="#4B5BD7" />
        <StatCard label="Discounting" value={H.discount} fmt={inrShort} spark={sparks.discount} delta={H.discountPct - H.pDiscountPct > 0 ? (H.discountPct - H.pDiscountPct) : (H.discountPct - H.pDiscountPct)} sublabel={`${pct(H.discountPct, 1)} of gross`} accent="#F0A500" tone="warn" />
        <StatCard label="Ad Spend" value={spendCur} fmt={inrShort} spark={null} delta={spendPrev > 0 ? ((spendCur - spendPrev) / spendPrev) * 100 : null} sublabel={`TACOS ${pct(H.tacos, 1)}`} accent="#4B5BD7" />
        <StatCard label="Post-Ad Contribution" value={H.contrib} fmt={inrShort} spark={null} delta={H.contribG} sublabel={`${pct(H.contribPct, 1)} margin`} accent="#12886A" tone="accent" />
        <StatCard label="Orders" value={H.orders} fmt={countShort} spark={sparks.orders} delta={H.ordersG} sublabel="distinct orders" accent="#4B5BD7" />
        <StatCard label="AOV" value={H.aov} fmt={inrShort} spark={sparks.aov} delta={H.aovG} sublabel="net ÷ orders" accent="#12886A" />
        <StatCard label="Net Profit" value={0} fmt={inrShort} locked requires="COGS + cost ledger" />
      </div>

      {/* ── HERO: health + ladder ── */}
      <div className="health-hero rise d1">
        <div className="hero-panel">
          <div className="hero-eyebrow">Net Revenue · {longDate(from)} → {longDate(to)}</div>
          <CountNum className="hero-num tnum" value={H.net} fmt={inrShort} />
          <div className="hero-cap">
            <Delta value={H.netG} /> vs prior · Gross <CountNum value={H.gross} fmt={inrShort} className="tnum" style={{ color: 'var(--ink-2)' }} />
            · <span>{countShort(H.orders)} orders</span> <Delta value={H.ordersG} />
            · <span>AOV {inrShort(H.aov)}</span> <Delta value={H.aovG} />
          </div>
          <div style={{ marginTop: 18 }}>
            <div className="mono-lbl" style={{ marginBottom: 6 }}>Where a rupee of revenue goes</div>
            <div style={{ display: 'flex', height: 12, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--line)' }}>
              <div title={`Discounts ${pct(H.discountPct,1)}`} style={{ width: pct((H.discount / (H.gross || 1)) * 100), background: 'rgba(242,196,100,.65)' }} />
              <div title={`Ad spend ${pct((spendCur/(H.gross||1))*100,1)}`} style={{ width: pct((spendCur / (H.gross || 1)) * 100), background: 'rgba(111,167,255,.6)' }} />
              <div title={`Contribution ${pct((H.contrib/(H.gross||1))*100,1)}`} style={{ width: pct((H.contrib / (H.gross || 1)) * 100), background: 'var(--accent)' }} />
            </div>
            <div className="legend">
              <span className="li"><span className="dot" style={{ background: 'rgba(242,196,100,.85)' }} />Discounts</span>
              <span className="li"><span className="dot" style={{ background: 'rgba(111,167,255,.85)' }} />Ad spend</span>
              <span className="li"><span className="dot" style={{ background: 'var(--accent)' }} />Contribution</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="card-head"><h3>Profitability ladder</h3><span className="meta">honest to the data</span></div>
          <Ladder rows={ladderRows} />
        </div>
      </div>

      {/* ── TRAJECTORY + BRIDGE ── */}
      <div className="grid-2 rise d2">
        <div className="card">
          <div className="card-head"><h3>Revenue vs contribution trajectory</h3><span className="meta">{useMonthly ? 'monthly' : 'daily'}</span></div>
          <p className="card-sub">The gap between the lines is what advertising costs to sustain revenue.</p>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trajectory} margin={{ top: 6, right: 8, left: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4B5BD7" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#4B5BD7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="x" tickFormatter={useMonthly ? monthLabel : shortDate} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tickFormatter={v => inrShort(v, { currency: false })} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v, n) => [inrShort(v), n === 'revenue' ? 'Net revenue' : 'Post-ad contribution']} labelFormatter={l => (useMonthly ? monthLabel(l) : longDate(l))} />
                <Area type="monotone" dataKey="revenue" stroke="#4B5BD7" strokeWidth={2} fill="url(#gRev)" dot={false} />
                <Line type="monotone" dataKey="contribution" stroke="#12886A" strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Revenue bridge</h3><span className="meta">prior → this period, by channel movement</span></div>
          <p className="card-sub">What actually moved the number — the four biggest channel swings plus the rest.</p>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bridge} margin={{ top: 8, right: 8, left: 6, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={52} />
                <YAxis tickFormatter={v => inrShort(v, { currency: false })} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v, n, p) => [inrShort(p.payload.kind === 'base' ? p.payload.v : Math.abs(p.payload.v)), p.payload.kind === 'up' ? 'added' : p.payload.kind === 'down' ? 'lost' : 'total']} />
                <Bar dataKey="range" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={650}>
                  {bridge.map((s, i) => (
                    <Cell key={i} fill={s.kind === 'up' ? '#3DD68C' : s.kind === 'down' ? '#F2555A' : 'rgba(255,255,255,.25)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── CHANNEL INTELLIGENCE ── */}
      <div className="section rise d3">
        <h2>Channel intelligence</h2>
        <span className="note">bar = net revenue · gold tick = ad spend · click a channel to drill down</span>
      </div>
      <div className="card rise d3">
        <div className="chboard-row" style={{ borderBottom: '1px solid var(--line)', padding: '4px 6px 8px' }}>
          <span className="mono-lbl">Channel</span><span className="mono-lbl">Revenue vs spend</span>
          <span className="mono-lbl" style={{ textAlign: 'right' }}>Net / Contribution</span>
          <span className="mono-lbl" style={{ textAlign: 'right' }}>Margin*</span>
          <span className="mono-lbl" style={{ textAlign: 'right' }}>Growth</span>
        </div>
        {channels.map(c => (
          <div key={c.channel} className="chboard-row" style={{ cursor: 'pointer' }}
               onClick={() => { setDrill(drill === c.channel ? null : c.channel); setOpen(new Set()); }}>
            <span className="ch"><ChannelLogo channel={c.channel} size={22} color={colorOf(c.channel)} />{c.channel}
              <span className="tag" style={{ marginLeft: 2 }}>{pct(c.share, 0)}</span></span>
            <div className="chbar">
              <div className="rev" style={{ width: pct(c.w), background: `linear-gradient(90deg, ${colorOf(c.channel)}CC, ${colorOf(c.channel)}55)` }} />
              {c.spend > 0 && <div className="spend" style={{ left: pct(c.spendX) }} title={`Ad spend ${inrShort(c.spend)}`} />}
            </div>
            <div className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>
              {inrShort(c.value)}
              <div style={{ fontSize: 10.5, color: c.contrib >= 0 ? 'var(--accent-ink)' : 'var(--down)' }}>{inrShort(c.contrib)}</div>
            </div>
            <div className="tnum" style={{ textAlign: 'right', color: c.contribMargin >= 85 ? 'var(--up)' : c.contribMargin < 60 ? 'var(--gold)' : 'var(--ink-2)' }}>
              {pct(c.contribMargin, 0)}
            </div>
            <div style={{ textAlign: 'right' }}><Delta value={c.deltaPct} /></div>
          </div>
        ))}
        <p className="card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
          *Post-ad contribution margin — net revenue minus ad spend only; platform commissions and COGS are not yet in the data layer.
        </p>

        {/* progressive drill-down drawer */}
        {drill && (
          <div className="rise" style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="card-head">
              <h3>{drill} · Category → Sub-category → SKU</h3>
              <button className="collapse-btn" style={{ width: 'auto', padding: '4px 12px', marginTop: 0 }} onClick={() => setDrill(null)}>Close</button>
            </div>
            {cubeLoading || !drillTree ? <div className="skeleton" style={{ height: 180, marginTop: 10 }} /> : (
              <table className="tree" style={{ marginTop: 8 }}>
                <tbody>
                  {drillTree.map(cat => {
                    const co = open.has(cat.name);
                    return (
                      <React.Fragment key={cat.name}>
                        <tr className="lvl0" onClick={() => toggle(cat.name)} style={{ cursor: 'pointer' }}>
                          <td><span className="name-cell"><span className={'chev' + (co ? ' open' : '')}>▸</span><span className="nm">{cat.name}</span></span></td>
                          <td className="tnum" style={{ textAlign: 'right' }}>{inrShort(cat.v)}</td>
                        </tr>
                        {co && cat.subs.map(s2 => {
                          const k = cat.name + '|' + s2.name, so = open.has(k);
                          return (
                            <React.Fragment key={k}>
                              <tr className="lvl1" onClick={() => toggle(k)} style={{ cursor: 'pointer' }}>
                                <td><span className="name-cell"><span className={'chev' + (so ? ' open' : '')}>▸</span><span className="nm">{s2.name}</span></span></td>
                                <td className="tnum" style={{ textAlign: 'right' }}>{inrShort(s2.v)}</td>
                              </tr>
                              {so && s2.skus.map(sk => (
                                <tr className="lvl2" key={k + sk.name}>
                                  <td><span className="name-cell"><span className="nm">{sk.name}</span></span></td>
                                  <td className="tnum" style={{ textAlign: 'right' }}>{inrShort(sk.v)}</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── MANAGEMENT BRIEF ── */}
      <div className="section rise d4"><h2>Management brief</h2><span className="note">computed from this period's data — nothing generic</span></div>
      <div className="card rise d4">
        {brief.map((b, i) => (
          <div className="focus-item" key={i}><span className="n">{String(i + 1).padStart(2, '0')}</span><p>{b}</p></div>
        ))}
      </div>
    </>
  );
}
