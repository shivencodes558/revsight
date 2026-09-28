import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { METRICS } from '../lib/metrics.js';
import { aggBy } from '../lib/cube.js';
import { inrShort, countShort, pct, longDate } from '../lib/format.js';
import { Delta } from '../components/ui.jsx';
import { Rank } from '../components/viz.jsx';

const BAR_COLORS = ['#4B5BD7', '#5B6AE0', '#6B79E6', '#7B88EB', '#8B97F0', '#9AA5F3', '#A9B3F6', '#B8C0F8', '#C7CEFA', '#D6DBFC'];

export default function SkuAnalysis({ cube, cubeLoading, from, to, metric }) {
  const M = METRICS[metric];
  const fmt = M.money ? inrShort : countShort;
  const axisFmt = M.money ? (v => inrShort(v, { currency: false })) : (v => countShort(v));
  const [q, setQ] = useState('');

  const skus = useMemo(() => {
    if (!cube) return [];
    return aggBy(cube.filter(r => !r.unmapped), r => r.sku, metric,
      r => ({ product: r.product, subCategory: r.subCategory, category: r.category }));
  }, [cube, metric]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return skus;
    return skus.filter(s =>
      (s.meta.product || '').toLowerCase().includes(needle) ||
      (s.meta.subCategory || '').toLowerCase().includes(needle) ||
      s.key.toLowerCase().includes(needle));
  }, [skus, q]);

  const top10 = skus.slice(0, 10).map(s => ({ name: s.meta.product, value: s.cur }));

  if (cubeLoading || !cube) {
    return (<><div className="skeleton sk-kpi rise" style={{ height: 300 }} /><div className="skeleton sk-chart rise d1" style={{ marginTop: 14 }} /></>);
  }

  return (
    <>
      <div className="card rise">
        <div className="card-head">
          <h3>Top 10 revenue products</h3>
          <span className="meta">{longDate(from)} → {longDate(to)} · {M.label.toLowerCase()}</span>
        </div>
        <div style={{ height: 296 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top10} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 0 }}>
              <XAxis type="number" tickFormatter={axisFmt} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={230} tickLine={false} axisLine={false}
                     tick={{ fontSize: 11.5 }} />
              <Tooltip formatter={(v) => [fmt(v), M.label]} cursor={{ fill: 'rgba(75,91,215,0.05)' }} />
              <Bar dataKey="value" radius={[0, 5, 5, 0]} isAnimationActive animationDuration={600}
                   label={{ position: 'right', formatter: (v) => fmt(v), fontSize: 11, fill: '#5A5F6B' }}>
                {top10.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="section rise d1">
        <h2>All products</h2>
        <span className="note">{skus.length} products across all channels</span>
      </div>
      <div className="card rise d1">
        <div className="filterbar" style={{ marginBottom: 10 }}>
          <input className="search" placeholder="Search product, sub-category, or SKU…" value={q} onChange={e => setQ(e.target.value)} />
          <span className="meta" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{filtered.length} shown</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th><th>Product</th><th>Sub-category</th>
              <th>Channels</th><th>{M.label}</th><th>Share</th><th>Growth</th><th>Units</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map((s, i) => (
              <tr key={s.key}>
                <td><Rank n={skus.indexOf(s) + 1} /></td>
                <td style={{ fontWeight: 550, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.key}>{s.meta.product}</td>
                <td><span className="tag">{s.meta.subCategory}</span></td>
                <td className="tnum" style={{ textAlign: 'right' }}>{s.channelCount}</td>
                <td className="tnum vbar" style={{ textAlign: 'right', fontWeight: 600 }}>
                  {fmt(s.cur)}
                  <div className="track"><div className="fill" style={{ width: pct(Math.min(s.share * 2.2, 100)), background: '#4B5BD7' }} /></div>
                </td>
                <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{pct(s.share)}</td>
                <td style={{ textAlign: 'right' }}><Delta value={s.deltaPct} /></td>
                <td className="tnum" style={{ textAlign: 'right' }}>{countShort(s.curUnits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 60 && <p className="card-sub" style={{ marginTop: 12, marginBottom: 0 }}>Showing top 60 — refine the search to narrow further.</p>}
      </div>
    </>
  );
}
