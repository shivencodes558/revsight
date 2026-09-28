import React, { useMemo, useState } from 'react';
import { METRICS } from '../lib/metrics.js';
import { aggBy, CUBE_FIELDS } from '../lib/cube.js';
import { inrShort, countShort, pct, longDate } from '../lib/format.js';
import { ChannelLogo } from '../components/viz.jsx';

export default function ChannelSkuSplit({ cube, cubeLoading, meta, from, to, metric }) {
  const M = METRICS[metric];
  const fmt = M.money ? inrShort : countShort;
  const [CF] = CUBE_FIELDS[metric];
  const colorOf = c => (meta && meta.channelColors && meta.channelColors[c]) || '#4B5BD7';
  const [q, setQ] = useState('');

  // columns: channels ranked by value (max 9)
  const channelCols = useMemo(() => {
    if (!cube) return [];
    return aggBy(cube, r => r.channel, metric).slice(0, 9).map(c => c.key);
  }, [cube, metric]);

  // rows: products with per-channel values
  const products = useMemo(() => {
    if (!cube) return [];
    const m = new Map();
    for (const r of cube) {
      if (r.unmapped) continue;
      let e = m.get(r.sku);
      if (!e) { e = { sku: r.sku, product: r.product, subCategory: r.subCategory, total: 0, by: {} }; m.set(r.sku, e); }
      const v = r[CF] || 0;
      e.total += v;
      e.by[r.channel] = (e.by[r.channel] || 0) + v;
    }
    return [...m.values()].filter(p => p.total > 0).sort((a, b) => b.total - a.total);
  }, [cube, CF]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(p => p.product.toLowerCase().includes(needle) || p.subCategory.toLowerCase().includes(needle));
  }, [products, q]);

  const shown = filtered.slice(0, 30);
  const cellMax = useMemo(() => {
    let mx = 0;
    for (const p of shown) for (const c of channelCols) mx = Math.max(mx, p.by[c] || 0);
    return mx || 1;
  }, [shown, channelCols]);

  if (cubeLoading || !cube) return <div className="skeleton sk-chart rise" style={{ height: 460 }} />;

  return (
    <>
      <div className="card rise">
        <div className="card-head">
          <h3>Where each product sells</h3>
          <span className="meta">{longDate(from)} → {longDate(to)} · {M.label.toLowerCase()} · colour intensity = value</span>
        </div>
        <div className="filterbar" style={{ margin: '8px 0 10px' }}>
          <input className="search" placeholder="Search product or sub-category…" value={q} onChange={e => setQ(e.target.value)} />
          <span className="meta" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            top {shown.length} of {filtered.length} products · {channelCols.length} channels
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="mx">
            <thead>
              <tr>
                <th>Product</th>
                {channelCols.map(c => (
                  <th key={c}>
                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                      <ChannelLogo channel={c} size={20} />
                      {c}
                    </span>
                  </th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.sku}>
                  <td className="p" title={`${p.product} · ${p.subCategory} · ${p.sku}`}>{p.product}</td>
                  {channelCols.map(c => {
                    const v = p.by[c] || 0;
                    const t = v / cellMax;
                    return (
                      <td key={c} className="c tnum" title={`${p.product} on ${c}: ${fmt(v)} (${pct((v / p.total) * 100)} of product)`}
                          style={{
                            background: v > 0 ? `rgba(75, 91, 215, ${0.05 + t * 0.85})` : 'var(--panel-2)',
                            color: t > 0.5 ? '#fff' : v > 0 ? 'var(--ink-2)' : 'var(--ink-3)',
                          }}>
                        {v > 0 ? fmt(v) : '·'}
                      </td>
                    );
                  })}
                  <td className="t tnum">{fmt(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 30 && <p className="card-sub" style={{ marginTop: 12, marginBottom: 0 }}>Showing top 30 by total — search to find specific products.</p>}
      </div>

      <div className="card rise d1" style={{ marginTop: 14 }}>
        <div className="card-head"><h3>How to read this</h3></div>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          Each row is a product, each column a channel. A bright row concentrated in one column means single-channel dependence — a distribution
          opportunity. A product bright on quick commerce but dark on marketplaces (or vice-versa) suggests an indexation gap worth closing.
          Hover any cell for the exact value and the share of that product's revenue it represents.
        </p>
      </div>
    </>
  );
}
