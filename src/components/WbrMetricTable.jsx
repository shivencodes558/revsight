import React from 'react';
import { inrShort, indianGroup } from '../lib/format.js';

const FMT = {
  inr:   v => inrShort(v),
  int:   v => indianGroup(Math.round(v)),
  rupee: v => '₹' + indianGroup(Math.round(v)),
  pct:   v => v.toFixed(1) + '%',
  pct0:  v => v.toFixed(0) + '%',
  pct1:  v => v.toFixed(1) + '%',
  // Sub-1% rates need the extra places: an unsubscribe rate of 0.071% renders
  // as "0.1%" at one decimal and, on the int fallback, as a flat "0".
  pct2:  v => v.toFixed(2) + '%',
  pct3:  v => v.toFixed(3) + '%',
  x:     v => v.toFixed(2) + 'x',
};
// An unrecognised tag silently formatted as an integer is how a percentage
// ends up displayed as "0", so shout about it in development instead.
export const fmtVal = (v, f) => {
  if (v == null || !isFinite(v)) return '—';
  const fn = FMT[f];
  if (!fn) {
    if (typeof console !== 'undefined' && f) console.warn('[WbrMetricTable] unknown fmt tag:', f);
    return FMT.int(v);
  }
  return fn(v);
};

/* A percentage metric's change is a percentage-POINT move, reported in basis
   points; a value metric's is a percent change. Conflating the two is how a
   TACOS move of 15% → 12% gets misreported as −20% instead of −300 bps. */
export function metricChange(row) {
  const { sel, prev, pct } = row;
  if (sel == null || prev == null || !isFinite(sel) || !isFinite(prev)) return null;
  if (pct) return { text: (sel - prev >= 0 ? '+' : '') + Math.round((sel - prev) * 100) + ' bps', up: sel > prev };
  if (prev === 0) return null;
  const d = ((sel - prev) / Math.abs(prev)) * 100;
  return { text: (d >= 0 ? '+' : '') + Math.round(d) + '%', up: d > 0 };
}

// Shared metric-per-row scorecard used by every WBR section.
export default function WbrMetricTable({ rows, selLabel = 'Selected period', prevLabel = 'Previous period' }) {
  return (
    <div className="card rise" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Metric</th>
            <th style={{ textAlign: 'right' }}>{prevLabel}</th>
            <th style={{ textAlign: 'right' }}>{selLabel}</th>
            <th style={{ textAlign: 'right' }}>% Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const c = metricChange(r);
            // `invert` metrics (cost-like) are good when they fall
            const good = c == null ? null : (r.invert ? !c.up : c.up);
            return (
              <tr key={r.key}>
                <td style={{ fontWeight: 550 }}>{r.label}</td>
                <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{fmtVal(r.prev, r.fmt)}</td>
                <td className="tnum" style={{ textAlign: 'right', fontWeight: 620 }}>{fmtVal(r.sel, r.fmt)}</td>
                <td className="tnum" style={{
                  textAlign: 'right',
                  background: c == null ? undefined : good ? '#E8F4EC' : '#FCEDEB',
                  color:      c == null ? undefined : good ? '#1A7F4B' : '#C0392B',
                  fontWeight: 620,
                }}>{c ? c.text : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
