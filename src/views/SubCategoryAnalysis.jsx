import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  ScatterChart, Scatter, ZAxis, ReferenceLine, CartesianGrid,
} from 'recharts';
import { METRICS } from '../lib/metrics.js';
import { aggBy } from '../lib/cube.js';
import { inrShort, countShort, pct, longDate, signedPct } from '../lib/format.js';
import { Delta } from '../components/ui.jsx';

const CAT_COLORS = ['#4B5BD7', '#12886A', '#F0A500', '#C23B33', '#8B2C8F', '#0EA5A5', '#E0662B', '#5B6472', '#B23A82', '#3B7DD8', '#6C5CE7', '#2C9C6A'];

export default function SubCategoryAnalysis({ cube, cubeLoading, from, to, metric }) {
  const M = METRICS[metric];
  const fmt = M.money ? inrShort : countShort;
  const axisFmt = M.money ? (v => inrShort(v, { currency: false })) : (v => countShort(v));

  const subs = useMemo(() => {
    if (!cube) return [];
    return aggBy(cube, r => r.subCategory, metric, r => ({ category: r.category }));
  }, [cube, metric]);

  const scatterData = useMemo(
    () => subs.filter(s => s.deltaPct != null && s.cur > 0).map((s, i) => ({
      name: s.key, x: s.share, y: Math.max(Math.min(s.deltaPct, 200), -100), units: s.curUnits, cur: s.cur, i,
    })),
    [subs]
  );

  if (cubeLoading || !cube) {
    return (<><div className="skeleton sk-chart rise" /><div className="skeleton sk-chart rise d1" style={{ marginTop: 14 }} /></>);
  }
  if (!subs.length) return <div className="empty">No sub-category data in this range.</div>;

  const winners = scatterData.filter(d => d.y > 0 && d.x >= 5).length;
  const risks = scatterData.filter(d => d.y < 0 && d.x >= 5).length;

  return (
    <>
      <div className="section rise" style={{ marginTop: 0 }}>
        <h2>Portfolio map</h2>
        <span className="note">{longDate(from)} → {longDate(to)} · bubble size = units · growth capped at ±100/200% for readability</span>
      </div>
      <div className="grid-2 rise">
        <div className="card">
          <div className="card-head">
            <h3>Growth vs contribution</h3>
            <span className="meta">{winners} scale winners · {risks} at-risk</span>
          </div>
          <p className="card-sub">Top-right = big and growing (invest) · bottom-right = big and declining (fix first)</p>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#EEF0F4" />
                <XAxis type="number" dataKey="x" name="Share" unit="%" tickLine={false} axisLine={false}
                       label={{ value: 'Share of revenue →', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#8B909C' }} />
                <YAxis type="number" dataKey="y" name="Growth" unit="%" tickLine={false} axisLine={false} width={46}
                       label={{ value: 'Growth vs prior →', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#8B909C' }} />
                <ZAxis type="number" dataKey="units" range={[70, 420]} />
                <ReferenceLine y={0} stroke="#C7CBD6" strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  formatter={(v, n) => n === 'Share' ? [pct(v), 'Share'] : n === 'Growth' ? [signedPct(v), 'Growth'] : [countShort(v), 'Units']}
                  labelFormatter={() => ''}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 16px rgba(20,21,26,.08)' }}>
                        <div style={{ fontWeight: 650, marginBottom: 3 }}>{d.name}</div>
                        <div>{fmt(d.cur)} · {pct(d.x)} share</div>
                        <div style={{ color: d.y >= 0 ? 'var(--up)' : 'var(--down)' }}>{signedPct(d.y)} vs prior</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} isAnimationActive animationDuration={600}>
                  {scatterData.map((d, i) => (
                    <Cell key={i} fill={d.y >= 0 ? 'rgba(18,136,106,0.75)' : 'rgba(194,59,51,0.75)'} stroke="#fff" strokeWidth={1} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Ranked by {M.label.toLowerCase()}</h3></div>
          <div style={{ height: 322 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={subs.slice(0, 12).map(s => ({ name: s.key, value: s.cur }))} layout="vertical" margin={{ top: 0, right: 56, left: 4, bottom: 0 }}>
                <XAxis type="number" tickFormatter={axisFmt} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={104} tickLine={false} axisLine={false} tick={{ fontSize: 11.5 }} />
                <Tooltip formatter={(v) => [fmt(v), M.label]} cursor={{ fill: 'rgba(75,91,215,0.05)' }} />
                <Bar dataKey="value" radius={[0, 5, 5, 0]} isAnimationActive animationDuration={600}
                     label={{ position: 'right', formatter: (v) => fmt(v), fontSize: 10.5, fill: '#5A5F6B' }}>
                  {subs.slice(0, 12).map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="section rise d1">
        <h2>Sub-category detail</h2>
        <span className="note">growth vs equal-length prior period</span>
      </div>
      <div className="card rise d1">
        <table className="tbl">
          <thead>
            <tr><th>Sub-category</th><th>Category</th><th>{M.label}</th><th>Share</th><th>Growth</th><th>Units</th><th>Channels</th></tr>
          </thead>
          <tbody>
            {subs.map((s, i) => (
              <tr key={s.key}>
                <td>
                  <span className="ch"><span className="dot" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />{s.key}</span>
                </td>
                <td><span className="tag">{s.meta.category}</span></td>
                <td className="tnum vbar" style={{ textAlign: 'right', fontWeight: 600 }}>
                  {fmt(s.cur)}
                  <div className="track"><div className="fill" style={{ width: pct(s.share), background: CAT_COLORS[i % CAT_COLORS.length] }} /></div>
                </td>
                <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{pct(s.share)}</td>
                <td style={{ textAlign: 'right' }}><Delta value={s.deltaPct} /></td>
                <td className="tnum" style={{ textAlign: 'right' }}>{countShort(s.curUnits)}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{s.channelCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
