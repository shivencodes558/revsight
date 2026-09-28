import React, { useMemo, useState, useEffect } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { METRICS, inRange, trendByDay, trendByMonth, pop } from '../lib/metrics.js';
import { inrShort, countShort, pct, shortDate, monthLabel, longDate } from '../lib/format.js';
import { Kpi, Delta, ChannelSelect, KpiSkeletons } from '../components/ui.jsx';
import { Sparkline } from '../components/viz.jsx';

const CUBE_FIELDS = { mrp: ['curMrp', 'prevMrp'], sp: ['curSp', 'prevSp'], volume: ['curUnits', 'prevUnits'] };

// build Category → Sub-Category → SKU tree from cube rows of one channel
function buildTree(rows, CF, PF) {
  const cats = new Map();
  for (const r of rows) {
    let c = cats.get(r.category);
    if (!c) { c = { name: r.category, cur: 0, prev: 0, units: 0, subs: new Map() }; cats.set(r.category, c); }
    c.cur += r[CF] || 0; c.prev += r[PF] || 0; c.units += r.curUnits || 0;
    let s = c.subs.get(r.subCategory);
    if (!s) { s = { name: r.subCategory, cur: 0, prev: 0, units: 0, skus: [] }; c.subs.set(r.subCategory, s); }
    s.cur += r[CF] || 0; s.prev += r[PF] || 0; s.units += r.curUnits || 0;
    s.skus.push({
      name: r.product || r.sku, sku: r.sku, unmapped: r.unmapped,
      cur: r[CF] || 0, prev: r[PF] || 0, units: r.curUnits || 0,
    });
  }
  const catArr = [...cats.values()]
    .map(c => ({
      ...c,
      subs: [...c.subs.values()]
        .map(s => ({ ...s, skus: s.skus.sort((a, b) => b.cur - a.cur) }))
        .sort((a, b) => b.cur - a.cur),
    }))
    .sort((a, b) => b.cur - a.cur)
    .filter(c => c.cur !== 0 || c.prev !== 0);
  const total = catArr.reduce((s, c) => s + c.cur, 0) || 1;
  return { cats: catArr, total };
}

function GrowthCell({ cur, prev }) {
  const d = prev > 0 ? ((cur - prev) / prev) * 100 : null;
  return <Delta value={d} />;
}

export default function ChannelDeepDive({ allRows, cube, cubeLoading, meta, from, to, prevFrom, prevTo, metric, forceChannel = null }) {
  const M = METRICS[metric];
  const field = M.field;
  const fmt = M.money ? inrShort : countShort;
  const axisFmt = M.money ? (v => inrShort(v, { currency: false })) : (v => countShort(v));
  const colorOf = c => (meta && meta.channelColors && meta.channelColors[c]) || '#9AA0AC';
  const [CF, PF] = CUBE_FIELDS[metric];

  // channel list ranked by selected metric
  const channelList = useMemo(() => {
    const m = new Map();
    for (const r of allRows) {
      let e = m.get(r.channel);
      if (!e) { e = { channel: r.channel, group: r.group, value: 0 }; m.set(r.channel, e); }
      e.value += r[field] || 0;
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }, [allRows, field]);

  // When the route names a channel (Marketplace › Amazon), that wins and the
  // in-view picker is hidden — the nav is the selector.
  const [channel, setChannel] = useState(forceChannel);
  useEffect(() => {
    if (forceChannel) { setChannel(forceChannel); return; }
    if (!channel && channelList.length) setChannel(channelList[0].channel);
  }, [forceChannel, channel, channelList]);

  // KPIs + trend from overall rows (instant)
  const chRows = useMemo(() => allRows.filter(r => r.channel === channel), [allRows, channel]);
  const cur = useMemo(() => inRange(chRows, from, to), [chRows, from, to]);
  const prev = useMemo(() => inRange(chRows, prevFrom, prevTo), [chRows, prevFrom, prevTo]);
  const total = pop(cur, prev, field);
  const units = pop(cur, prev, 'units');
  const mrpNow = useMemo(() => cur.reduce((s, r) => s + (r.mrp || 0), 0), [cur]);
  const asp = units.current > 0 ? mrpNow / units.current : 0;

  const useMonthly = new Set(cur.map(r => r.date)).size > 92;
  const trend = useMemo(() => {
    const t = useMonthly ? trendByMonth(cur, field) : trendByDay(cur, field);
    return t.map(pt => ({ x: useMonthly ? pt.ym : pt.date, value: pt.value }));
  }, [cur, field, useMonthly]);

  // cube slice for this channel → tree + movers + unmapped
  const chCube = useMemo(() => (cube || []).filter(r => r.channel === channel), [cube, channel]);
  const tree = useMemo(() => buildTree(chCube, CF, PF), [chCube, CF, PF]);

  const unmapped = useMemo(() => {
    let uU = 0, tU = 0;
    for (const r of chCube) { tU += r.curUnits || 0; if (r.unmapped) uU += r.curUnits || 0; }
    return { units: uU, pct: tU > 0 ? (uU / tU) * 100 : 0 };
  }, [chCube]);

  const movers = useMemo(() => {
    const eligible = chCube.filter(r => !r.unmapped && (r[PF] || 0) > 0 && ((r.curUnits || 0) + (r.prevUnits || 0)) >= 20)
      .map(r => ({ ...r, deltaPct: (((r[CF] || 0) - r[PF]) / r[PF]) * 100 }));
    return {
      up: [...eligible].sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 5),
      down: [...eligible].sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 5),
    };
  }, [chCube, CF, PF]);

  // expand/collapse state — keys "cat" and "cat|sub"
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => {
    // when channel changes, open the top category by default so the drill-down invites exploration
    if (tree.cats.length) setOpen(new Set([tree.cats[0].name]));
  }, [channel, tree.cats.length && tree.cats[0].name]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (!channel) return <KpiSkeletons />;

  return (
    <>
      <div className="filterbar rise" style={{ marginTop: -4 }}>
        {/* when the route names the channel, the nav is the selector — omit the picker */}
        {forceChannel
          ? <span />
          : <ChannelSelect channels={channelList} value={channel} onChange={setChannel} colorOf={colorOf} />}
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{longDate(from)} → {longDate(to)}</span>
      </div>

      {!cur.length ? (
        <div className="empty">No {channel} revenue in this range. Try widening the dates.</div>
      ) : (
        <>
          <div className="kpis rise">
            <Kpi label={`${M.label} · ${channel}`} value={fmt(total.current)} delta={total.deltaPct} sub={`vs ${fmt(total.previous)} prior`} />
            <Kpi label="Units Sold" value={countShort(units.current)} delta={units.deltaPct} sub="this channel" />
            <Kpi label="ASP (MRP)" value={inrShort(asp)} sub="revenue ÷ units" />
            <Kpi label="Unmapped SKUs" value={pct(unmapped.pct)} sub={`${countShort(unmapped.units)} units · zero MRP`} />
          </div>

          <div className="grid-2 rise d1">
            <div className="card">
              <div className="card-head">
                <h3>{channel} · {M.label} trend</h3>
                <span className="meta">{useMonthly ? 'monthly' : 'daily'}</span>
              </div>
              <div style={{ height: 236 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 6, right: 8, left: 6, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gDD" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colorOf(channel)} stopOpacity={0.2} />
                        <stop offset="100%" stopColor={colorOf(channel)} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#EEF0F4" vertical={false} />
                    <XAxis dataKey="x" tickFormatter={useMonthly ? monthLabel : shortDate} tickLine={false} axisLine={false} minTickGap={28} />
                    <YAxis tickFormatter={axisFmt} tickLine={false} axisLine={false} width={52} />
                    <Tooltip formatter={(v) => [fmt(v), M.label]} labelFormatter={l => (useMonthly ? monthLabel(l) : longDate(l))} />
                    <Area type="monotone" dataKey="value" stroke={colorOf(channel)} strokeWidth={2.2} fill="url(#gDD)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Movers within {channel}</h3><span className="meta">vs prior</span></div>
              {cubeLoading ? <div className="skeleton" style={{ height: 220, borderRadius: 8 }} /> : (
                <>
                  {[...movers.up.slice(0, 3), ...movers.down.slice(0, 3)].map((x, i) => (
                    <div className="mover-row" key={x.sku + i}>
                      <div className="mover-name">
                        <div className="p">{x.product}</div>
                        <div className="s">{x.subCategory}</div>
                      </div>
                      <div className="mover-val tnum">{fmt(x[CF])}</div>
                      <Delta value={x.deltaPct} />
                    </div>
                  ))}
                  {!movers.up.length && !movers.down.length && (
                    <div className="empty" style={{ padding: 24 }}>Not enough prior-period data for movers.</div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Category → Sub-Category → SKU drill-down ── */}
          <div className="section rise d2">
            <h2>Revenue hierarchy</h2>
            <span className="note">Category → Sub-category → Product · click a row to drill down</span>
          </div>
          <div className="card rise d2" style={{ paddingTop: 8 }}>
            {unmapped.pct > 2 && (
              <div className="banner" style={{ marginTop: 10 }}>
                <span className="b-ic">⚠</span>
                <span><b>{pct(unmapped.pct)}</b> of units are unmapped — they appear under <b>(uncategorised)</b> with zero MRP. A mapper fix in <code>gs_channel_wise_mapper_updated</code> recovers them.</span>
              </div>
            )}
            {cubeLoading ? (
              <div className="skeleton" style={{ height: 320, borderRadius: 8, marginTop: 8 }} />
            ) : tree.cats.length === 0 ? (
              <div className="empty" style={{ marginTop: 8 }}>No category data for this channel in range.</div>
            ) : (
              <table className="tree">
                <thead>
                  <tr>
                    <th>Category / Sub-category / Product</th>
                    <th>{M.label}</th>
                    <th>Share</th>
                    <th>Growth</th>
                    <th>Units</th>
                  </tr>
                </thead>
                <tbody>
                  {tree.cats.map(cat => {
                    const catOpen = open.has(cat.name);
                    const catShare = (cat.cur / tree.total) * 100;
                    return (
                      <React.Fragment key={cat.name}>
                        <tr className="lvl0" onClick={() => toggle(cat.name)} style={{ cursor: 'pointer' }}>
                          <td>
                            <span className="name-cell">
                              <span className={'chev' + (catOpen ? ' open' : '')}>▸</span>
                              <span className="nm">{cat.name}</span>
                              <span className="count-chip">{cat.subs.length} sub</span>
                            </span>
                          </td>
                          <td className="tnum vbar">
                            {fmt(cat.cur)}
                            <div className="track"><div className="fill" style={{ width: pct(catShare), background: colorOf(channel) }} /></div>
                          </td>
                          <td className="tnum" style={{ textAlign: 'right' }}>{pct(catShare)}</td>
                          <td style={{ textAlign: 'right' }}><GrowthCell cur={cat.cur} prev={cat.prev} /></td>
                          <td className="tnum" style={{ textAlign: 'right' }}>{countShort(cat.units)}</td>
                        </tr>
                        {catOpen && cat.subs.map(sub => {
                          const k = cat.name + '|' + sub.name;
                          const subOpen = open.has(k);
                          const subShare = (sub.cur / (cat.cur || 1)) * 100;
                          return (
                            <React.Fragment key={k}>
                              <tr className="lvl1" onClick={() => toggle(k)} style={{ cursor: 'pointer' }}>
                                <td>
                                  <span className="name-cell">
                                    <span className={'chev' + (subOpen ? ' open' : '')}>▸</span>
                                    <span className="nm">{sub.name}</span>
                                    <span className="count-chip">{sub.skus.length} SKU</span>
                                  </span>
                                </td>
                                <td className="tnum" style={{ textAlign: 'right' }}>{fmt(sub.cur)}</td>
                                <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{pct(subShare)} of cat</td>
                                <td style={{ textAlign: 'right' }}><GrowthCell cur={sub.cur} prev={sub.prev} /></td>
                                <td className="tnum" style={{ textAlign: 'right' }}>{countShort(sub.units)}</td>
                              </tr>
                              {subOpen && sub.skus.map(sk => (
                                <tr className="lvl2" key={k + sk.sku} style={sk.unmapped ? { background: '#FFFCF3' } : undefined}>
                                  <td><span className="name-cell"><span className="nm" title={sk.sku}>{sk.name}</span></span></td>
                                  <td className="tnum" style={{ textAlign: 'right' }}>{fmt(sk.cur)}</td>
                                  <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{pct((sk.cur / (sub.cur || 1)) * 100)} of sub</td>
                                  <td style={{ textAlign: 'right' }}><GrowthCell cur={sk.cur} prev={sk.prev} /></td>
                                  <td className="tnum" style={{ textAlign: 'right' }}>{countShort(sk.units)}</td>
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
        </>
      )}
    </>
  );
}
