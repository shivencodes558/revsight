import React, { useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   Freshness footnote. Data provenance matters, but it is not the headline —
   so it collapses to one line that states the worst lag, and only expands to
   the full per-source table on request. `rows` are pre-shaped by the caller:
     { key, label, node?, lag, cells: [...] }
   where `lag` is whole days behind the report date (null = unknown).
   ═══════════════════════════════════════════════════════════════════════ */
export function lagClass(lag) {
  if (lag == null) return 'flat';
  return lag <= 1 ? 'up' : lag <= 3 ? 'flat' : 'down';
}
export function lagText(lag) {
  if (lag == null) return '—';
  return lag <= 0 ? 'current' : lag + 'd';
}

export default function Freshness({ headers, rows, defaultOpen = false, note }) {
  const [open, setOpen] = useState(defaultOpen);

  // summarise: how many are current, and what is the worst lag
  const known = rows.filter(r => r.lag != null);
  const stale = known.filter(r => r.lag > 1);
  const worst = known.length ? known.reduce((a, b) => (b.lag > a.lag ? b : a)) : null;
  const summary = !known.length
    ? <>No update timestamps available</>
    : stale.length === 0
      ? <><b>All {rows.length} sources current</b></>
      : <><b>{stale.length} of {rows.length}</b> behind · oldest <b>{worst.label}</b> at {lagText(worst.lag)}</>;

  return (
    <div className="fresh rise d2">
      <button className="fresh-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="fresh-k">Last updated</span>
        <span className="fresh-sum">{summary}</span>
        <span className="fresh-chev">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <table className="tbl compact">
            <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td>{r.node || r.label}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="tnum" style={{ textAlign: 'right', color: c.muted ? 'var(--ink-3)' : undefined }}>
                      {c.value}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right' }}>
                    <span className={'delta ' + lagClass(r.lag)}>{lagText(r.lag)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {note && <p className="card-sub" style={{ margin: '8px 13px 11px' }}>{note}</p>}
        </>
      )}
    </div>
  );
}
