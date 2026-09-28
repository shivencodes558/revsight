import React, { useState, useMemo } from 'react';
import { indianGroup, inrShort, countShort, monthLabel } from '../lib/format.js';
import { sumColumns } from '../lib/matrix.js';

/* ═══════════════════════════════════════════════════════════════════════
   MatrixTable — one row per SKU or category, one column per month.

   This is the shape the Hex "All Channels : Data" notebook uses for all nine
   of its tables, so it is built once here and configured per table rather
   than copied nine times.

   Behaviour that matters:
   · The identity columns are sticky, so scrolling twelve months sideways
     never leaves you looking at a row you can't identify.
   · TOTAL is a pinned header row, not row 0 of the body, so it survives
     sorting, filtering, and paging — the notebook's TOTAL disappears the
     moment you page, which makes the shares on page 2 unreadable.
   · Cells show the compact form (₹1.2Cr / 12.3L) and carry the exact value
     as a tooltip; CSV export writes exact values. A twelve-column table of
     fully grouped Indian numbers does not fit on any screen.
   · Sorting is by month column — click a month to rank by it.
   ═══════════════════════════════════════════════════════════════════════ */

const PAGE = 15;

const FMT = {
  int: v => countShort(v),
  inr: v => inrShort(v),
  pct: v => (v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%'),
};
const EXACT = {
  int: v => indianGroup(Math.round(v)),
  inr: v => '₹' + indianGroup(Math.round(v)),
  pct: v => (v == null || !isFinite(v) ? '—' : v.toFixed(2) + '%'),
};

function toCsv(label, months, rows, totals, idCols, totalLabel) {
  const esc = s => {
    const t = String(s ?? '');
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const head = [...idCols.map(c => c.head), ...months];
  const body = [head.map(esc).join(',')];
  if (totals) body.push([totalLabel, ...idCols.slice(1).map(() => ''), ...totals.map(v => (v == null ? '' : v))].map(esc).join(','));
  for (const r of rows) {
    body.push([...idCols.map(c => c.get(r)), ...r.values.map(v => (v == null ? '' : v))].map(esc).join(','));
  }
  return body.join('\n');
}


export default function MatrixTable({
  label, sub, months, rows, totals, idCols, fmt = 'int', heat = false,
}) {
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [sortAt, setSortAt] = useState(0);      // month index to rank by

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? rows.filter(r => idCols.some(c => String(c.get(r) || '').toLowerCase().includes(needle)))
      : rows;
    // Rank by the chosen month, descending. Ties keep the incoming order.
    // Aggregate rows (an "(other)" bucket standing for hundreds of places)
    // always sort last: they are larger than any individual row by
    // construction, so ranking them together would put a bucket at the top
    // of what reads as a leaderboard.
    return [...base].sort((a, b) => {
      if (!!a.isOther !== !!b.isOther) return a.isOther ? 1 : -1;
      return (b.values[sortAt] || 0) - (a.values[sortAt] || 0);
    });
  }, [rows, q, sortAt, idCols]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const p = Math.min(page, pages - 1);
  const slice = filtered.slice(p * PAGE, p * PAGE + PAGE);

  // Heat scale for the share/weight tables: normalise against the largest
  // value on screen so the tint stays meaningful as you page.
  const peak = useMemo(() => {
    if (!heat) return 0;
    let m = 0;
    for (const r of filtered) for (const v of r.values) if (v > m) m = v;
    return m;
  }, [heat, filtered]);

  // The total row always describes the rows on screen. `totals` (the
  // full-universe figure from the API) is kept only to say what share the
  // filtered subset represents.
  const filtering = q.trim().length > 0;
  const shown = useMemo(() => sumColumns(filtered, months.length), [filtered, months.length]);
  const totalLabel = filtering ? 'FILTERED' : 'TOTAL';

  const download = () => {
    const csv = toCsv(label, months, filtered, shown, idCols,
      filtering ? `FILTERED (${filtered.length} of ${rows.length} rows: "${q.trim()}")` : 'TOTAL');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = label.replace(/[^\w]+/g, '-').toLowerCase()
      + (filtering ? '-' + q.trim().replace(/[^\w]+/g, '-').toLowerCase() : '') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cell = v => (v == null ? '—' : FMT[fmt](v));
  const exact = v => (v == null ? 'no data' : EXACT[fmt](v));

  return (
    <div className="mx">
      <div className="mx-head">
        <div className="mx-titles">
          <h3>{label}</h3>
          {sub && <p>{sub}</p>}
        </div>
        <div className="mx-tools">
          <input className="mx-find" value={q} placeholder="Filter…"
            onChange={e => { setQ(e.target.value); setPage(0); }} aria-label={`Filter ${label}`} />
          <span className="mx-count">
            {filtering ? `${filtered.length} of ${rows.length} rows` : `${rows.length} rows`}
          </span>
          <button className="mx-dl" onClick={download} title={`Download ${label} as CSV`}>↓ CSV</button>
        </div>
      </div>

      <div className="mx-scroll">
        <table className="mx-tbl">
          <thead>
            <tr>
              <th className="mx-ix">#</th>
              {idCols.map((c, i) => (
                <th key={c.head} className={'mx-id mx-id' + i}>{c.head}</th>
              ))}
              {months.map((m, i) => (
                <th key={m} className={'mx-m' + (i === sortAt ? ' on' : '')}
                  onClick={() => { setSortAt(i); setPage(0); }}
                  title={`Rank by ${monthLabel(m)}`}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Always present, including on the share tables: unfiltered it
                reads 100% and confirms the column is complete; filtered it is
                the subset's share, which is the number you actually wanted. */}
            {filtered.length > 0 && (
              <tr className={'mx-total' + (filtering ? ' mx-filtered' : '')}>
                <td className="mx-ix" />
                <td className="mx-id mx-id0" title={filtering
                  ? `${filtered.length} of ${rows.length} rows matching "${q.trim()}"`
                  : `all ${rows.length} rows`}>{totalLabel}</td>
                {idCols.slice(1).map((c, i) => <td key={i} className={'mx-id mx-id' + (i + 1)} />)}
                {shown.map((v, i) => {
                  const whole = totals ? totals[i] : null;
                  // A share table's value already IS the share of the column,
                  // so appending "of 100%" would only restate it.
                  const share = filtering && fmt !== 'pct' && whole > 0 && v != null
                    ? (v / whole) * 100 : null;
                  return (
                    <td key={i} className="tnum" title={
                      exact(v) + (share != null ? ` · ${share.toFixed(1)}% of ${EXACT[fmt](whole)}` : '')
                    }>{cell(v)}</td>
                  );
                })}
              </tr>
            )}
            {slice.map((r, ri) => (
              <tr key={r.key}
                className={r.key === '(unmapped)' || r.isOther ? 'mx-unmapped' : undefined}>
                <td className="mx-ix">{p * PAGE + ri + 1}</td>
                {idCols.map((c, i) => (
                  <td key={c.head} className={'mx-id mx-id' + i} title={String(c.get(r) ?? '')}>{c.get(r)}</td>
                ))}
                {r.values.map((v, i) => (
                  <td key={i} className="tnum" title={exact(v)}
                    style={heat && peak > 0 && v > 0
                      ? { background: `rgba(239,191,32,${(0.06 + 0.44 * (v / peak)).toFixed(3)})` }
                      : undefined}>{cell(v)}</td>
                ))}
              </tr>
            ))}
            {!slice.length && (
              <tr><td className="mx-empty" colSpan={1 + idCols.length + months.length}>
                No rows match “{q}”.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mx-foot">
          <button disabled={p === 0} onClick={() => setPage(p - 1)} aria-label="Previous page">‹</button>
          <span>{p + 1} <i>/ {pages}</i></span>
          <button disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label="Next page">›</button>
        </div>
      )}
    </div>
  );
}
