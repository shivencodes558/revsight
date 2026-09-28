import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts';
import { METRICS, inRange, trendByDay, trendByMonth, byChannel, byGroup, pop } from '../lib/metrics.js';
import { inrShort, countShort, pct, shortDate, monthLabel, longDate } from '../lib/format.js';
import { getJSON } from '../lib/api.js';
import { Kpi, Delta } from '../components/ui.jsx';
import { Sparkline, Heatmap, Rank, ChannelLogo } from '../components/viz.jsx';

const GROUP_COLORS = ['#4B5BD7', '#12886A', '#F0A500', '#C23B33'];
// Heat ramp for the two matrices: dark gold, so intensity reads in the brand
// hue rather than the leftover indigo, and stays a single-hue sequential
// scale (the only kind that encodes "more" without implying a category).
const HEAT_ACCENT = '138, 106, 0';

// cube metric field resolution: metric id → cur/prev field names
const CUBE_FIELDS = { mrp: ['curMrp', 'prevMrp'], sp: ['curSp', 'prevSp'], volume: ['curUnits', 'prevUnits'] };

export default function CrossChannel({ data, cube, cubeLoading, meta, from, to, prevFrom, prevTo, metric }) {
  const M = METRICS[metric];
  const field = M.field;
  const fmt = M.money ? inrShort : countShort;
  const axisFmt = M.money ? (v => inrShort(v, { currency: false })) : (v => countShort(v));
  const colorOf = c => (meta && meta.channelColors && meta.channelColors[c]) || '#9AA0AC';
  const [CF, PF] = CUBE_FIELDS[metric];

  const cur = useMemo(() => inRange(data, from, to), [data, from, to]);
  const prev = useMemo(() => inRange(data, prevFrom, prevTo), [data, prevFrom, prevTo]);

  // ── hero KPIs ──
  const total = pop(cur, prev, field);
  const units = pop(cur, prev, 'units');
  const mrpNow = useMemo(() => cur.reduce((s, r) => s + (r.mrp || 0), 0), [cur]);
  const asp = units.current > 0 ? mrpNow / units.current : 0;
  const nDays = new Set(cur.map(r => r.date)).size || 1;
  const runRate = (total.current / nDays) * 30;

  // sparkline for the hero card (daily totals of selected metric)
  const heroSpark = useMemo(() => trendByDay(cur, field).map(p => p.value), [cur, field]);

  // ── channel leaderboard with PoP + per-channel sparkline ──
  const channels = useMemo(() => {
    const arr = byChannel(cur, field);
    const prevByCh = new Map(byChannel(prev, field).map(c => [c.channel, c.value]));
    return arr.map(c => {
      const pv = prevByCh.get(c.channel) || 0;
      const spark = trendByDay(cur.filter(r => r.channel === c.channel), field).map(p => p.value);
      return { ...c, prevValue: pv, deltaPct: pv > 0 ? ((c.value - pv) / pv) * 100 : null, spark };
    });
  }, [cur, prev, field]);
  const topChannel = channels[0];
  const attention = useMemo(
    () => [...channels].filter(c => c.deltaPct != null && c.value > 0).sort((a, b) => a.deltaPct - b.deltaPct)[0],
    [channels]
  );

  // ── "Where revenue comes from" — primary NET revenue vs prorated target ──
  // Independent of the page's MRP/SP/Volume toggle above: this leaderboard is
  // always REVENUE (₹), because "where revenue comes from" ranked by unit
  // count doesn't mean anything. Source is PRIMARY_SALES (the same table the
  // Daily Business Report's D-1/MTD figures come from), joined to the same
  // gs_primary_targets sheet, prorated across the selected window.
  const [rev, setRev] = useState(null);
  const revReqId = useRef(0);
  useEffect(() => {
    if (!from || !to || !prevFrom || !prevTo) return;
    const my = ++revReqId.current;
    getJSON('/channel-revenue', { from, to, prevFrom, prevTo })
      .then(r => { if (my === revReqId.current) setRev(r.rows); })
      .catch(() => { if (my === revReqId.current) setRev([]); });
  }, [from, to, prevFrom, prevTo]);

  const revLeaderboard = useMemo(() => {
    if (!rev) return null;
    const byName = new Map(rev.map(r => [r.channel, r]));
    return channels
      .map(c => {
        const r = byName.get(c.channel);
        if (!r || r.revenue <= 0) return null;
        const hasTarget = r.target != null && r.target > 0;
        return {
          channel: c.channel, group: c.group, spark: c.spark,
          revenue: r.revenue,
          achievementPct: hasTarget ? (r.revenue / r.target) * 100 : null,
          deltaPct: r.prevRevenue > 0 ? ((r.revenue - r.prevRevenue) / r.prevRevenue) * 100 : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.revenue - a.revenue);
  }, [rev, channels]);

  // ── trend (cur vs prior overlay) ──
  const spanDays = nDays;
  const useMonthly = spanDays > 92;
  const trend = useMemo(() => {
    const c = useMonthly ? trendByMonth(cur, field) : trendByDay(cur, field);
    const p = useMonthly ? trendByMonth(prev, field) : trendByDay(prev, field);
    return c.map((pt, i) => ({ x: useMonthly ? pt.ym : pt.date, value: pt.value, prev: p[i] ? p[i].value : null }));
  }, [cur, prev, field, useMonthly]);

  const groups = useMemo(() => byGroup(cur, field), [cur, field]);

  // ── cube-driven: composition rollups, matrices, movers ──
  // One helper for both grains: the cube carries `category` (7 broad) and
  // `subCategory` (16 fine), and the two matrices differ only in which key
  // they group on, so deriving them separately would duplicate the maths.
  const rollup = (dimKey) => {
    if (!cube) return [];
    const m = new Map();
    for (const r of cube) {
      const k = r[dimKey];
      let e = m.get(k);
      if (!e) { e = { name: k, cur: 0, prev: 0 }; m.set(k, e); }
      e.cur += r[CF] || 0; e.prev += r[PF] || 0;
    }
    const arr = [...m.values()].sort((a, b) => b.cur - a.cur).filter(c => c.cur > 0);
    const tot = arr.reduce((s, c) => s + c.cur, 0) || 1;
    return arr.map(c => ({ ...c, share: (c.cur / tot) * 100, deltaPct: c.prev > 0 ? ((c.cur - c.prev) / c.prev) * 100 : null }));
  };

  const cats = useMemo(() => rollup('subCategory'), [cube, CF, PF]);
  const broadCats = useMemo(() => rollup('category'), [cube, CF, PF]);

  // Channel × <dimension>. Rows are the top channels, columns the top values
  // of that dimension; anything past the cut is dropped rather than lumped
  // into an "Other" column, because a heat cell for "Other" encodes nothing
  // you can act on.
  const matrix = (dimKey, dimRows, nCols) => {
    if (!cube) return null;
    const chTop = channels.slice(0, 8).map(c => c.channel);
    const colTop = dimRows.slice(0, nCols).map(c => c.name);
    const m = new Map();
    for (const r of cube) {
      if (!chTop.includes(r.channel) || !colTop.includes(r[dimKey])) continue;
      const k = r.channel + '|' + r[dimKey];
      m.set(k, (m.get(k) || 0) + (r[CF] || 0));
    }
    return { rows: chTop, cols: colTop, valueAt: (ch, c) => m.get(ch + '|' + c) || 0 };
  };

  // 7 broad categories all fit; sub-categories are capped at 10 of 16 so the
  // cells stay wide enough to read a rupee figure in.
  const heatCat = useMemo(() => matrix('category', broadCats, 7), [cube, channels, broadCats, CF]);
  const heat = useMemo(() => matrix('subCategory', cats, 10), [cube, channels, cats, CF]);

  const movers = useMemo(() => {
    if (!cube) return { up: [], down: [] };
    // aggregate SKU across channels on product identity
    const m = new Map();
    for (const r of cube) {
      if (r.unmapped) continue;
      let e = m.get(r.sku);
      if (!e) { e = { sku: r.sku, product: r.product, subCategory: r.subCategory, cur: 0, prev: 0, curUnits: 0, prevUnits: 0 }; m.set(r.sku, e); }
      e.cur += r[CF] || 0; e.prev += r[PF] || 0;
      e.curUnits += r.curUnits || 0; e.prevUnits += r.prevUnits || 0;
    }
    const eligible = [...m.values()].filter(x => x.prev > 0 && (x.curUnits + x.prevUnits) >= 30);
    for (const x of eligible) x.deltaPct = ((x.cur - x.prev) / x.prev) * 100;
    const up = [...eligible].sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 6);
    const down = [...eligible].sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 6);
    return { up, down };
  }, [cube, CF, PF]);

  if (!cur.length) {
    return <div className="empty">No revenue in this range. Try widening the dates or switching metric.</div>;
  }

  return (
    <>
      {/* ── HERO ── */}
      <div className="kpis hero rise">
        <div className="kpi big">
          <div className="lbl">{M.label}</div>
          <div className="kpi-row">
            <span className="val tnum">{fmt(total.current)}</span>
            <Delta value={total.deltaPct} />
          </div>
          <div className="sub">{longDate(from)} → {longDate(to)} · vs {fmt(total.previous)} prior period</div>
          <div className="spark"><Sparkline data={heroSpark} color="var(--accent-2)" width={150} height={40} /></div>
        </div>
        <Kpi label="Units Sold" value={countShort(units.current)} delta={units.deltaPct} sub="all channels" />
        <Kpi label="ASP (MRP)" value={inrShort(asp)} sub="revenue ÷ units" />
        <Kpi label="30-Day Run Rate" value={fmt(runRate)} sub={`off ${nDays}-day pace`} />
        <Kpi label="Needs Attention" value={attention ? attention.channel : '—'}
             delta={attention ? attention.deltaPct : undefined}
             sub={attention ? 'slowest trend of any channel' : 'no laggards'} />
      </div>

      {/* ── WHERE REVENUE COMES FROM ──
          Always Revenue (₹), regardless of the MRP/SP/Volume toggle above —
          "where revenue comes from" ranked by unit count wouldn't mean
          anything. Basis is primary (sell-in) NET revenue, the same figure
          the Daily Business Report's D-1/MTD cards use, so this ties to
          that tab rather than to the MRP/SP numbers shown elsewhere on this
          page. ── */}
      <div className="section rise d1">
        <h2>Where revenue comes from</h2>
        <span className="note">
          {revLeaderboard ? `${revLeaderboard.length} active channels` : 'loading…'} · Revenue (net, primary/sell-in basis)
        </span>
      </div>
      <div className="grid-2 rise d1">
        <div className="card">
          {!revLeaderboard ? (
            <div className="empty" style={{ padding: 24 }}>Loading revenue vs target…</div>
          ) : (
          <table className="lb">
            <thead>
              <tr>
                <th></th>
                <th>Channel</th>
                <th>Trend</th>
                <th>Revenue</th>
                <th title={`Target is the monthly sheet figure prorated across ${longDate(from)} → ${longDate(to)}`}>
                  Target Achieved
                </th>
                <th title={`This channel's own revenue vs the compare window (${longDate(prevFrom)} → ${longDate(prevTo)})`}>
                  vs Compare
                </th>
              </tr>
            </thead>
            <tbody>
              {revLeaderboard.map((c, i) => {
                const hasTarget = c.achievementPct != null;
                const achClamped = hasTarget ? Math.min(c.achievementPct, 100) : 0;
                const achColor = !hasTarget ? 'var(--ink-4)' : c.achievementPct >= 100 ? 'var(--up)' : c.achievementPct >= 70 ? 'var(--warn)' : 'var(--down)';
                const deltaTitle = c.deltaPct == null ? undefined
                  : c.deltaPct > 0 ? 'Growth vs the compare window' : c.deltaPct < 0 ? 'Degrowth vs the compare window' : 'Flat vs the compare window';
                return (
                  <tr key={c.channel}>
                    <td style={{ width: 30 }}><Rank n={i + 1} /></td>
                    <td>
                      <span className="ch"><ChannelLogo channel={c.channel} color={colorOf(c.channel)} />{c.channel}</span>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1, marginLeft: 30 }}>{c.group}</div>
                    </td>
                    <td style={{ width: 104 }}><Sparkline data={c.spark} color={colorOf(c.channel)} width={96} height={26} /></td>
                    <td className="tnum" style={{ width: 84, textAlign: 'right', fontWeight: 650 }}>{inrShort(c.revenue)}</td>
                    <td className="tnum vbar" style={{ width: 130 }}>
                      <div className="track" title={hasTarget ? `${pct(c.achievementPct)} of target` : 'No target set for this channel'}>
                        <div className="fill" style={{ width: pct(achClamped), background: achColor }} />
                      </div>
                      <span style={{ color: hasTarget ? achColor : 'var(--ink-4)', fontSize: 12, fontWeight: 620 }}>
                        {hasTarget ? pct(c.achievementPct) : 'no target'}
                      </span>
                    </td>
                    <td style={{ width: 84, textAlign: 'right' }} title={deltaTitle}><Delta value={c.deltaPct} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h3>Business-line mix</h3></div>
          <p className="card-sub">Marketplace vs Quick Commerce vs D2C</p>
          <div style={{ height: 190 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={groups} dataKey="value" nameKey="group" innerRadius={54} outerRadius={84} paddingAngle={2} stroke="none">
                  {groups.map((g, i) => <Cell key={i} fill={GROUP_COLORS[i % GROUP_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="legend">
            {groups.map((g, i) => (
              <span className="li" key={g.group}>
                <span className="dot" style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }} />
                {g.group} · {pct(g.share)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── MOMENTUM ── */}
      <div className="section rise d2">
        <h2>Momentum</h2>
        <span className="note">{useMonthly ? 'monthly' : 'daily'} grain · dashed = prior period</span>
      </div>
      {/* Full width: the trend is the one chart here you read for shape, and
          a 90-day series in a half-column compresses every move into noise. */}
      <div className="rise d2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head">
            <h3>{M.label} trend</h3>
            <span className="meta">{trend.length} {useMonthly ? 'months' : 'days'} · dashed = prior period</span>
          </div>
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 6, right: 12, left: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="gHero" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-2)" stopOpacity={0.26} />
                    <stop offset="100%" stopColor="var(--accent-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="x" tickFormatter={useMonthly ? monthLabel : shortDate} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tickFormatter={axisFmt} tickLine={false} axisLine={false} width={56} />
                <Tooltip formatter={(v, n) => [fmt(v), n === 'prev' ? 'Prior' : M.label]}
                  labelFormatter={l => (useMonthly ? monthLabel(l) : longDate(l))}
                  contentStyle={{ background: '#fff', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 11.5 }} />
                <Area type="monotone" dataKey="prev" stroke="var(--g4)" strokeWidth={1.5} strokeDasharray="4 4" fill="none" dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="value" stroke="var(--accent-2)" strokeWidth={2.2} fill="url(#gHero)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── COMPOSITION (cube) ── */}
      <div className="section rise d3">
        <h2>Channel composition</h2>
        <span className="note">{M.label.toLowerCase()} · coarse then fine · hover a cell for the exact value</span>
      </div>
      {/* Stacked, not side by side: a matrix needs horizontal room for its
          columns, and halving the width would shrink the cells below the
          point where a rupee figure fits inside one. */}
      <div className="rise d3" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head">
            <h3>Channel × Category</h3>
            <span className="meta">{broadCats.length} categories</span>
          </div>
          <p className="card-sub">
            The coarse cut — which broad categories each channel actually sells.
          </p>
          {cubeLoading || !heatCat ? <div className="skeleton" style={{ height: 240, borderRadius: 8 }} /> : (
            <Heatmap rows={heatCat.rows} cols={heatCat.cols} valueAt={heatCat.valueAt}
                     accent={HEAT_ACCENT}
                     fmt={v => (M.money ? inrShort(v) : countShort(v))} />
          )}
        </div>
      </div>

      <div className="rise d3" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head">
            <h3>Channel × Sub-category</h3>
            <span className="meta">top {heat ? heat.cols.length : 0} of {cats.length}</span>
          </div>
          <p className="card-sub">Where each channel's revenue concentrates</p>
          {cubeLoading || !heat ? <div className="skeleton" style={{ height: 240, borderRadius: 8 }} /> : (
            <Heatmap rows={heat.rows} cols={heat.cols} valueAt={heat.valueAt}
                     accent={HEAT_ACCENT}
                     fmt={v => (M.money ? inrShort(v) : countShort(v))} />
          )}
        </div>
      </div>

      {/* ── MOVERS (cube) ── */}
      <div className="section rise d4">
        <h2>Product movers</h2>
        <span className="note">vs prior period · min 30 units combined</span>
      </div>
      <div className="movers rise d4">
        <div className="card">
          <div className="card-head"><h3>Fastest growing</h3><span className="meta">↑ top 6</span></div>
          {cubeLoading || !cube ? <div className="skeleton" style={{ height: 220, borderRadius: 8 }} /> :
            movers.up.length === 0 ? <div className="empty" style={{ padding: 24 }}>No qualifying products.</div> :
            movers.up.map(x => (
              <div className="mover-row" key={x.sku}>
                <div className="mover-name">
                  <div className="p">{x.product}</div>
                  <div className="s">{x.subCategory}</div>
                </div>
                <div className="mover-val tnum">{fmt(x.cur)}<div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>from {fmt(x.prev)}</div></div>
                <Delta value={x.deltaPct} />
              </div>
            ))}
        </div>
        <div className="card">
          <div className="card-head"><h3>Losing steam</h3><span className="meta">↓ bottom 6</span></div>
          {cubeLoading || !cube ? <div className="skeleton" style={{ height: 220, borderRadius: 8 }} /> :
            movers.down.length === 0 ? <div className="empty" style={{ padding: 24 }}>No qualifying products.</div> :
            movers.down.map(x => (
              <div className="mover-row" key={x.sku}>
                <div className="mover-name">
                  <div className="p">{x.product}</div>
                  <div className="s">{x.subCategory}</div>
                </div>
                <div className="mover-val tnum">{fmt(x.cur)}<div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>from {fmt(x.prev)}</div></div>
                <Delta value={x.deltaPct} />
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
