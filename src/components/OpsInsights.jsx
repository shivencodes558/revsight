import React, { useMemo, useState, useRef } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from 'recharts';
import { METRICS } from '../lib/metrics.js';
import { inrShort, indianGroup } from '../lib/format.js';
import { LOGOS } from '../logos.js';

const LOGO_ALIAS = { 'Flipkart Minutes': 'Flipkart', 'Amazon Now': 'Amazon', 'Swiggy IM': 'Instamart' };
const logoFor = n => LOGOS[n] || LOGOS[LOGO_ALIAS[n]] || null;

const CGOLD = '#EFBF20';
const monthKey = ymd => String(ymd).slice(0, 7);
const monthLabel = ym => {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = String(ym).split('-');
  return `${M[+m - 1]}'${y.slice(2)}`;
};

// ── aggregate a window by channel on the chosen basis ──
function byChannel(rows, a, b, field) {
  const m = new Map();
  for (const r of rows) {
    if (r.date < a || r.date > b) continue;
    const e = m.get(r.channel) || { channel: r.channel, val: 0, units: 0, orders: 0 };
    e.val += r[field] || 0; e.units += r.units || 0; e.orders += r.orders || 0;
    m.set(r.channel, e);
  }
  return m;
}

/* ═══════════════════════════════════════════════════════════════════════
   Insights — the reference's hashtag tabs + scrolling card carousel, driven
   by real channel movement rather than a curated list. A card only appears
   when the prior window has a non-zero base to compare against.
   ═══════════════════════════════════════════════════════════════════════ */
export function OpsInsights({ rows, from, to, prevFrom, prevTo, metric }) {
  const [tab, setTab] = useState('drain');
  const [open, setOpen] = useState(true);
  const trackRef = useRef(null);
  const M = METRICS[metric];

  const buckets = useMemo(() => {
    if (!rows) return { drain: [], gain: [], vol: [], mix: [] };
    const cur = byChannel(rows, from, to, M.field);
    const prv = byChannel(rows, prevFrom, prevTo, M.field);
    const totCur = [...cur.values()].reduce((s, e) => s + e.val, 0);

    const moves = [];
    for (const [ch, c] of cur) {
      const p = prv.get(ch);
      if (!p || p.val <= 0) continue;                      // no comparable base
      const delta = c.val - p.val;
      moves.push({
        channel: ch, cur: c.val, prev: p.val, delta,
        pct: (delta / p.val) * 100,
        share: totCur > 0 ? (c.val / totCur) * 100 : 0,
        units: c.units, orders: c.orders,
        aov: c.orders > 0 ? c.val / c.orders : null,
        aovPrev: p.orders > 0 ? p.val / p.orders : null,
      });
    }
    const drain = moves.filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta);
    const gain  = moves.filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta);
    // AOV erosion / expansion — a different failure mode from raw revenue
    const vol = moves.filter(m => m.aov != null && m.aovPrev > 0 && m.aov < m.aovPrev)
      .sort((a, b) => (a.aov / a.aovPrev) - (b.aov / b.aovPrev));
    const mix = moves.filter(m => m.aov != null && m.aovPrev > 0 && m.aov > m.aovPrev)
      .sort((a, b) => (b.aov / b.aovPrev) - (a.aov / a.aovPrev));
    return { drain, gain, vol, mix };
  }, [rows, from, to, prevFrom, prevTo, M.field]);

  const TABS = [
    { id: 'drain', label: '#Top Drainers',  list: buckets.drain },
    { id: 'gain',  label: '#Top Gainers',   list: buckets.gain },
    { id: 'vol',   label: '#AOV Erosion',   list: buckets.vol },
    { id: 'mix',   label: '#AOV Expansion', list: buckets.mix },
  ];
  const active = TABS.find(t => t.id === tab) || TABS[0];
  const cards = active.list.slice(0, 8);
  const isGain = tab === 'gain' || tab === 'mix';

  const scroll = dir => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * 352, behavior: 'smooth' });
  };
  const fmt = v => (M.money ? inrShort(v) : indianGroup(Math.round(v)));

  return (
    <div className="opanel">
      <div className="opanel-head">
        <span className="opanel-title">
          <span className="opanel-ic">✦</span> Insights
          <span className="powered">powered by<b>Revsight</b></span>
        </span>
        <span className="opanel-tools">
          <button className="collapse-x" onClick={() => setOpen(o => !o)}
            title={open ? 'Collapse' : 'Expand'} aria-expanded={open}>{open ? '⌃' : '⌄'}</button>
        </span>
      </div>

      {open && (
        <>
          <div className="htabs">
            {TABS.map(t => (
              <button key={t.id} className={'htab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
                {t.label} <span className="hcount">{t.list.length}</span>
              </button>
            ))}
          </div>

          {cards.length === 0 ? (
            <div className="opanel-body">
              <div className="empty" style={{ padding: 26, fontSize: 12.5 }}>
                No {active.label.replace('#', '').toLowerCase()} in this window — every channel with a comparable
                prior base moved the other way.
              </div>
            </div>
          ) : (
            <div className="carousel">
              {cards.length > 3 && <>
                <button className="cnav l" onClick={() => scroll(-1)} aria-label="Scroll left">‹</button>
                <button className="cnav r" onClick={() => scroll(1)} aria-label="Scroll right">›</button>
              </>}
              <div className="carousel-track" ref={trackRef}>
                {cards.map((c, i) => (
                  <div className="icard" key={c.channel}>
                    <div className="icard-top">
                      <span className={'irank' + (isGain ? ' gain' : '')}>
                        {active.label.replace('#', '')} {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="icat">Share: {c.share.toFixed(1)}%</span>
                    </div>
                    <div className="icard-mid">
                      <span className="ithumb">
                        {logoFor(c.channel) ? <img src={logoFor(c.channel)} alt="" /> : '◈'}
                      </span>
                      <span className="icard-txt">
                        <span className="iname" title={c.channel}>{c.channel}</span>
                        <span className="ipills">
                          <span className="ipill"><i className="pd" />{fmt(c.cur)}</span>
                          <span className="ipill">{indianGroup(Math.round(c.units))} units</span>
                        </span>
                      </span>
                    </div>
                    <table className="itbl">
                      <thead>
                        <tr><th>Movement</th><th>{M.label}</th></tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>vs prior window</td>
                          <td>
                            <span className="amt">{fmt(c.cur)}</span>
                            <span className={'dlt ' + (c.delta < 0 ? 'neg' : 'pos')}>
                              {c.delta < 0 ? '▾' : '▴'} {Math.abs(c.pct).toFixed(1)}% ({fmt(Math.abs(c.delta))})
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td>AOV</td>
                          <td>
                            <span className="amt">{c.aov == null ? '—' : '₹' + indianGroup(Math.round(c.aov))}</span>
                            {c.aov != null && c.aovPrev > 0 && (
                              <span className={'dlt ' + (c.aov < c.aovPrev ? 'neg' : 'pos')}>
                                {c.aov < c.aovPrev ? '▾' : '▴'} {Math.abs(((c.aov - c.aovPrev) / c.aovPrev) * 100).toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Overview — three metric cards, each with a monthly area sparkline. The
   dashed tail marks the current (incomplete) month so a partial period is
   never mistaken for a decline.
   ═══════════════════════════════════════════════════════════════════════ */
export function OpsOverview({ rows, from, to, prevFrom, prevTo, metric }) {
  const M = METRICS[metric];

  const { cards, series } = useMemo(() => {
    if (!rows) return { cards: [], series: [] };
    const win = (a, b) => {
      let val = 0, orders = 0, units = 0;
      for (const r of rows) {
        if (r.date < a || r.date > b) continue;
        val += r[M.field] || 0; orders += r.orders || 0; units += r.units || 0;
      }
      return { val, orders, units, aov: orders > 0 ? val / orders : null };
    };
    const c = win(from, to), p = win(prevFrom, prevTo);

    // monthly series across everything we hold, for the sparklines
    const byM = new Map();
    for (const r of rows) {
      const k = monthKey(r.date);
      const e = byM.get(k) || { m: k, val: 0, orders: 0, units: 0 };
      e.val += r[M.field] || 0; e.orders += r.orders || 0; e.units += r.units || 0;
      byM.set(k, e);
    }
    const s = [...byM.values()].sort((a, b) => (a.m < b.m ? -1 : 1)).slice(-12)
      .map(e => ({ ...e, label: monthLabel(e.m), aov: e.orders > 0 ? e.val / e.orders : 0 }));

    const mk = (label, key, cv, pv, fmt, hint) => ({
      label, key, value: cv, prev: pv, fmt, hint,
      pct: pv > 0 ? ((cv - pv) / pv) * 100 : null,
      abs: cv - pv,
    });
    return {
      series: s,
      cards: [
        mk(M.label, 'val', c.val, p.val, v => (M.money ? inrShort(v) : indianGroup(Math.round(v))), M.hint),
        mk('Orders', 'orders', c.orders, p.orders, v => indianGroup(Math.round(v)), 'Distinct orders in the window'),
        mk('AOV', 'aov', c.aov || 0, p.aov || 0, v => '₹' + indianGroup(Math.round(v)), M.label + ' ÷ distinct orders'),
      ],
    };
  }, [rows, from, to, prevFrom, prevTo, M]);

  if (!cards.length) return null;
  const lastKey = series.length ? series[series.length - 1].m : null;

  return (
    <div className="mcards">
      {cards.map(c => (
        <div className="mcard" key={c.key}>
          <span className="mcard-lbl">{c.label} <span className="info" title={c.hint}>i</span></span>
          <div className="mcard-val">{c.fmt(c.value)} <small>for this window</small></div>
          <div className="mcard-dlt">
            {c.pct == null
              ? <span className="vs">no comparable prior window</span>
              : <>
                  <b className={c.pct < 0 ? 'neg' : 'pos'}>
                    {c.pct < 0 ? '▾' : '▴'} {Math.abs(c.pct).toFixed(1)}% ({c.fmt(Math.abs(c.abs))})
                  </b>
                  <span className="vs">vs previous period</span>
                </>}
          </div>
          <div className="mcard-spark">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id={'sp-' + c.key} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CGOLD} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={CGOLD} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                  interval={Math.max(0, Math.floor(series.length / 5) - 1)} />
                <Tooltip formatter={v => [c.fmt(v), c.label]}
                  labelFormatter={l => l + (series.find(s => s.label === l)?.m === lastKey ? ' (month in progress)' : '')} />
                <Area type="monotone" dataKey={c.key} stroke={CGOLD} strokeWidth={1.9}
                  fill={'url(#sp-' + c.key + ')'} dot={false} activeDot={{ r: 3, fill: CGOLD }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
}
