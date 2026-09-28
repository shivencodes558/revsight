import React, { useEffect, useRef, useState } from 'react';

// ── count-up hook: numbers ease to their value; re-animates on change ──
export function useCountUp(value, duration = 750) {
  const [v, setV] = useState(value || 0);
  const fromRef = useRef(0); const raf = useRef(0);
  useEffect(() => {
    const from = fromRef.current, to = value || 0, t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const tick = now => {
      const p = Math.min((now - t0) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (to - from) * e);
      if (p < 1) raf.current = requestAnimationFrame(tick); else fromRef.current = to;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return v;
}
import { LOGOS } from '../logos.js';

// ── ChannelLogo — round white chip with the platform mark; colored-dot fallback ──
export function ChannelLogo({ channel, size = 22, color = '#9AA0AC' }) {
  const src = LOGOS[channel];
  if (!src) return <span className="dot" style={{ background: color, width: Math.max(8, size * 0.4), height: Math.max(8, size * 0.4) }} />;
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', background: '#fff',
      border: '1px solid var(--line)', display: 'inline-grid', placeItems: 'center',
      overflow: 'hidden', flex: 'none', boxShadow: '0 1px 3px rgba(20,21,26,.08)',
    }}>
      <img src={src} alt={channel} style={{ width: '82%', height: '82%', objectFit: 'contain', borderRadius: '50%' }} />
    </span>
  );
}

// ── Sparkline — hand-rolled SVG, light enough to render 13 per table ──
export function Sparkline({ data, color = '#4B5BD7', width = 96, height = 28, area = true }) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => [pad + i * step, pad + (height - pad * 2) * (1 - (v - min) / span)]);
  const line = pts.map(p => p.join(',')).join(' ');
  const areaPath = `M ${pts[0][0]},${height - pad} L ${line.split(' ').join(' L ')} L ${pts[pts.length - 1][0]},${height - pad} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {area && <path d={areaPath} fill={color} opacity="0.10" />}
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={color} />
    </svg>
  );
}

/* ── Heatmap — channels × categories matrix, colour intensity = value share ──

   Every cell prints its number, so the tint is the secondary cue and the
   digits must stay readable in all of them. The old ramp ran to 88% alpha
   and swapped to white text partway up, which put white on a mid-tone cell
   at about 2:1 — the worst contrast landed exactly on the busiest cells.

   Swapping text colour mid-ramp cannot be fixed by moving the threshold:
   for a single-hue tint over white, the crossover where white and dark text
   are equally legible sits near 3.1:1, so SOME cell is always marginal.
   Capping the ramp at 55% and keeping one dark text colour throughout
   removes the crossover altogether — the faintest cell reads, the strongest
   reads at 4.4:1, and the tint still spans white to a clear mid-tone, which
   is all the gradient a matrix of printed numbers needs. */
const MAX_TINT = 0.55;

export function Heatmap({ rows, cols, valueAt, fmt, accent = '75, 91, 215' }) {
  let max = 0;
  for (const r of rows) for (const c of cols) max = Math.max(max, valueAt(r, c));
  if (max <= 0) max = 1;
  return (
    <div className="heat" style={{ gridTemplateColumns: `120px repeat(${cols.length}, 1fr)` }}>
      <div className="heat-corner" />
      {cols.map(c => <div key={c} className="heat-col" title={c}>{c}</div>)}
      {rows.map(r => (
        <React.Fragment key={r}>
          <div className="heat-row" title={r}>{r}</div>
          {cols.map(c => {
            const v = valueAt(r, c);
            const t = v / max;
            return (
              <div
                key={r + c}
                className="heat-cell tnum"
                title={`${r} × ${c}: ${fmt(v)}`}
                style={{
                  background: v > 0 ? `rgba(${accent}, ${0.05 + t * MAX_TINT})` : 'var(--panel-2)',
                  color: v > 0 ? 'var(--ink)' : 'var(--ink-4)',
                  fontWeight: t > 0.5 ? 620 : 500,
                }}
              >
                {v > 0 ? fmt(v) : '·'}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── StatCard — premium KPI card: mono label, serif count-up value, sparkline,
//    MoM delta, optional locked state for metrics awaiting a data source ──
export function StatCard({ label, value, fmt, spark, delta, sublabel, accent = '#0F9E74', locked, requires, tone }) {
  const v = useCountUp(locked ? 0 : (value || 0));
  const deltaCls = delta == null ? 'flat' : delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
  const arrow = delta == null ? '' : delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '→';
  const sgn = delta == null ? '' : (Math.abs(delta) >= 100 ? Math.round(Math.abs(delta)) : Math.abs(delta).toFixed(1)) + '%';
  const chip = delta != null && !locked
    ? <span className={'delta ' + deltaCls}>{arrow} {sgn}</span> : null;
  return (
    <div className={'stat' + (tone ? ' ' + tone : '')}>
      <div className="stat-top"><span className="stat-lbl">{label}</span></div>
      {locked ? (
        <div className="stat-locked">— <span className="lockpill">requires {requires}</span></div>
      ) : (
        /* Delta beside the value, not up beside the label: across a strip of
           these the changes then line up on one baseline and can be read as
           a column. */
        <div className="kpi-row" style={{ margin: '9px 0 6px' }}>
          <span className="stat-val tnum" style={{ margin: 0 }}>{fmt(v)}</span>
          {chip}
        </div>
      )}
      <div className="stat-foot">
        {sublabel && <span className="stat-sub">{sublabel}</span>}
        {spark && spark.length > 1 && !locked && (
          <span style={{ marginLeft: 'auto' }}><Sparkline data={spark} color={accent} width={78} height={24} /></span>
        )}
      </div>
    </div>
  );
}

// ── Rank chip for leaderboards ──
export function Rank({ n }) {
  const medal = n === 1 ? '#F0A500' : n === 2 ? '#9AA0AC' : n === 3 ? '#C08A5A' : null;
  return (
    <span className="rank" style={medal ? { background: medal, color: '#fff', borderColor: 'transparent' } : undefined}>
      {n}
    </span>
  );
}
