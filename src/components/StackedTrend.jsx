import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════════
   StackedTrend — N metrics as stacked panels over one shared X axis.

   This is the Hex notebook's "Combined Chart": units, ASP and discount in
   separate panels rather than one chart with three Y axes. That choice is
   right and worth keeping — the three live on incompatible scales (tens of
   thousands, hundreds, and a percentage), so a shared axis either flattens
   two of them to a straight line or needs three axes nobody can read.

   Stacked panels keep every series legible at its own scale while the
   aligned X axis still lets you read down a date and see all three at once,
   which is the entire point of looking at them together.

   Each panel gets its own tooltip; the shared X labels are drawn once, on
   the last panel, so the stack does not repeat the date row N times.
   ═══════════════════════════════════════════════════════════════════════ */

export default function StackedTrend({
  data, panels, xKey = 'key', xFormatter, labelFormatter,
  height = 132, lastHeight, grid = true, refLines = {},
}) {
  return (
    <div className="st-wrap">
      {panels.map((p, i) => {
        const last = i === panels.length - 1;
        const h = last ? (lastHeight || height + 22) : height;
        return (
          <div className="st-panel" key={p.key}>
            <div className="st-cap">
              <span className="st-dot" style={{ background: p.color }} />
              {p.label}
              {p.unit && <i>{p.unit}</i>}
            </div>
            <div style={{ height: h }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 4, right: 10, left: 4, bottom: last ? 2 : 0 }}>
                  {grid && <CartesianGrid stroke="var(--line)" vertical={false} />}
                  <XAxis
                    dataKey={xKey}
                    tickFormatter={xFormatter}
                    tickLine={false} axisLine={false}
                    minTickGap={34}
                    /* Ticks only on the bottom panel — the axis is shared, so
                       repeating it under each panel is three times the ink
                       for the same information. */
                    tick={last ? { fontSize: 9.5 } : false}
                    height={last ? 20 : 4}
                  />
                  <YAxis
                    tickFormatter={p.tickFormatter}
                    tickLine={false} axisLine={false}
                    width={52}
                    domain={p.domain || ['auto', 'auto']}
                    tick={{ fontSize: 9.5 }}
                  />
                  <Tooltip
                    formatter={(v) => [p.valueFormatter ? p.valueFormatter(v) : v, p.label]}
                    labelFormatter={labelFormatter}
                    contentStyle={{
                      background: '#fff', border: '1px solid var(--line-2)',
                      borderRadius: 8, fontSize: 11.5, padding: '7px 10px',
                    }}
                  />
                  {refLines[p.key] != null && (
                    <ReferenceLine y={refLines[p.key]} stroke="var(--ink-4)" strokeDasharray="3 3" />
                  )}
                  {p.area ? (
                    <>
                      <defs>
                        <linearGradient id={'stg-' + p.key} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={p.color} stopOpacity={0.22} />
                          <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey={p.key} stroke={p.color} strokeWidth={1.8}
                        fill={'url(#stg-' + p.key + ')'} dot={false} isAnimationActive={false}
                        connectNulls={false} />
                    </>
                  ) : (
                    <Line type="monotone" dataKey={p.key} stroke={p.color} strokeWidth={1.8}
                      dot={p.dot ? { r: 2.5, fill: p.color, strokeWidth: 0 } : false}
                      isAnimationActive={false} connectNulls={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
