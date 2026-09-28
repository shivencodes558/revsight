import React from 'react';
import { METRICS, METRIC_ORDER } from '../lib/metrics.js';
import { ChannelLogo } from './viz.jsx';

// Compact basis toggle (MRP / SP / Vol) — the reference's teal pill control.
// Short codes keep the header dense; the full label rides in the tooltip.
const BASIS_CODE = { mrp: 'MRP', sp: 'SP', volume: 'VOL' };
export function MetricToggle({ metric, setMetric }) {
  return (
    <div className="basis" role="tablist" aria-label="Metric basis">
      {METRIC_ORDER.map(id => (
        <button key={id} className={metric === id ? 'on' : ''} onClick={() => setMetric(id)}
          role="tab" aria-selected={metric === id} title={METRICS[id].label + ' — ' + METRICS[id].hint}>
          {BASIS_CODE[id] || METRICS[id].label}
        </button>
      ))}
    </div>
  );
}

const PRESETS = ['MTD', '30D', '90D', 'YTD'];
export function RangeControl({ preset, setPreset, from, to, setFrom, setTo, prevFrom, prevTo }) {
  const fmt = d => { const [y,m,dd]=d.split('-'); return `${+dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]}`; };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div className="seg">
        <button className={preset === 'MTD' ? 'on' : ''} onClick={() => setPreset('MTD')}>MTD</button>
        <button className={preset === 'Custom' ? 'on' : ''} onClick={() => setPreset('Custom')}>Custom</button>
      </div>
      {preset === 'Custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} className="rise">
          <input className="date-in" type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" />
          <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>→</span>
          <input className="date-in" type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date" />
        </span>
      )}
      <span className="range-note">
        <b>{fmt(from)} – {fmt(to)}</b>&nbsp; vs {fmt(prevFrom)} – {fmt(prevTo)}
      </span>
    </div>
  );
}

/* ▲/▼ pill. `invert` flips the colour for cost-like metrics, where a rise is
   the bad direction — CAC going up is not a win. */
export function Delta({ value, invert = false }) {
  if (value == null || !isFinite(value)) return <span className="delta flat">—</span>;
  const flat = Math.abs(value) <= 0.05;
  const good = invert ? value < 0 : value > 0;
  const cls = flat ? 'flat' : good ? 'up' : 'down';
  const arrow = flat ? '→' : value > 0 ? '▲' : '▼';
  const mag = Math.abs(value);
  // The arrow carries the direction, so the number must not also carry a
  // sign: "▼ +9.8%" says both down and up at once. Magnitude only.
  return (
    <span className={'delta ' + cls}>
      {arrow} {(mag >= 100 ? Math.round(mag) : mag.toFixed(1)) + '%'}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MetricCard — the one KPI card, used everywhere.

   Structure is fixed, and that is the point: a mono label on its own line,
   then the value and its delta on one row with the delta pushed right, then
   an optional caption. Before this, views hand-rolled the card with inline
   <span>s, so label, value, caption and delta all flowed as one paragraph
   and wrapped mid-phrase — leaving orphans like "month" alone on line two,
   and no two cards the same height.

   Putting the delta on the VALUE row rather than inside the caption is what
   makes a row of these scannable: every change sits at the same x, so you
   compare five metrics by reading straight down the right edge.
   ═══════════════════════════════════════════════════════════════════════ */
export function MetricCard({
  label, value, delta, invertDelta = false, sub, big = false,
  hint, children, className = '',
}) {
  return (
    <div className={'kpi' + (big ? ' big' : '') + (className ? ' ' + className : '')}>
      <div className="lbl" title={hint || undefined}>
        {label}{hint && <i className="lbl-q">?</i>}
      </div>
      <div className="kpi-row">
        <span className="val tnum">{value}</span>
        {delta !== undefined && <Delta value={delta} invert={invertDelta} />}
      </div>
      {sub && <div className="sub">{sub}</div>}
      {children}
    </div>
  );
}

// Back-compat alias: `Kpi` was the old name and several views still call it.
export function Kpi(props) { return <MetricCard {...props} />; }

export function KpiSkeletons() {
  return (
    <div className="kpis">
      {[0, 1, 2, 3].map(i => <div key={i} className="skeleton sk-kpi" />)}
    </div>
  );
}

export function ChartSkeleton() {
  return <div className="skeleton sk-chart" />;
}

export function ChannelSelect({ channels, value, onChange, colorOf }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <ChannelLogo channel={value} size={28} color={(colorOf && colorOf(value)) || 'var(--accent)'} />
      <select
        className="date-in"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={{ fontWeight: 600, fontSize: 13.5, paddingRight: 28, cursor: 'pointer', minWidth: 150 }}
        aria-label="Select channel"
      >
        {channels.map(c => (
          <option key={c.channel} value={c.channel}>
            {c.channel}{c.group ? ` · ${c.group}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="errbox">
      <b>Couldn't load revenue data</b>
      <div style={{ marginBottom: 10 }}><code>{String(error)}</code></div>
      <div style={{ fontSize: 12.5, color: '#9A4A42' }}>
        Check that the API is running (<code>node server.js</code>) and your Snowflake credentials in <code>.env</code> are set.
      </div>
      {onRetry && <button className="chip" style={{ marginTop: 12 }} onClick={onRetry}>Retry</button>}
    </div>
  );
}
