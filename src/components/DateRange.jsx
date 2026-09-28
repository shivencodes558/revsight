import React, { useState, useRef, useEffect } from 'react';

// "01 Aug 26" — the compact mono form the header uses. September is "Sept",
// matching Adsight's header (and the usual Indian short form).
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
export function shortYMD(ymd) {
  if (!ymd) return '—';
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[3]} ${M[+m[2] - 1]} ${m[1].slice(2)}`;
}

export const PRESETS = ['Custom', 'Single Day', 'MTD', 'L7D', 'LM'];

const dayCount = (a, b) => {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 86400000;
  return Number.isFinite(d) ? Math.round(d) + 1 : null;
};

/* Close on outside click / Escape. One hook per popover, each scoped to its
   own wrapper, so clicking the other trigger closes this one. */
function useDismiss(open, close, ref) {
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close, ref]);
}

/* ═══════════════════════════════════════════════════════════════════════
   The header's two date controls, laid out as Adsight has them: matching
   bordered boxes — TIME PERIOD and COMPARE WITH — each with a mono readout
   and its own caret/popover.

   The comparison still DERIVES from the period by default; the second box
   exposes that derived window and lets you override it, rather than being a
   second thing you must set. So it reads as one decision with a visible
   consequence, not two independent pickers.
   ═══════════════════════════════════════════════════════════════════════ */
export default function DateRange({
  preset, setPreset, from, to, customFrom, customTo, setCustomFrom, setCustomTo,
  prevFrom, prevTo, compareLabel,
  cmpMode, setCmpMode, cmpFrom, cmpTo, setCmpFrom, setCmpTo,
  anchor, dataTill, niceDate,
}) {
  const [openP, setOpenP] = useState(false);
  const [openC, setOpenC] = useState(false);
  const pRef = useRef(null);
  const cRef = useRef(null);
  useDismiss(openP, () => setOpenP(false), pRef);
  useDismiss(openC, () => setOpenC(false), cRef);

  // A comparison window of a different length makes every % change misleading,
  // so say so rather than letting it pass silently.
  const curLen = dayCount(from, to);
  const cmpLen = dayCount(prevFrom, prevTo);
  const lengthWarning =
    curLen && cmpLen && cmpLen !== curLen
      ? `${cmpLen} days vs ${curLen} in the selected period — percentage changes will not be like-for-like.`
      : null;

  // Both date pairs are always editable. Editing the selected window switches
  // the preset to Custom rather than silently contradicting it.
  const onSelFrom = v => { setCustomFrom(v); if (preset !== 'Custom' && preset !== 'Single Day') setPreset('Custom'); };
  const onSelTo   = v => { setCustomTo(v);   if (preset !== 'Custom') setPreset('Custom'); };
  // Editing a comparison date means you want that window, so flip to custom.
  const onCmpFrom = v => { setCmpFrom(v); if (cmpMode !== 'custom') setCmpMode('custom'); };
  const onCmpTo   = v => { setCmpTo(v);   if (cmpMode !== 'custom') setCmpMode('custom'); };

  const partial = anchor && dataTill && dataTill > anchor;

  return (
    <>
      {/* ── TIME PERIOD ── */}
      <div className="dr-wrap" ref={pRef}>
        <button className={'rangebox dr-trigger' + (openP ? ' open' : '')}
          onClick={() => { setOpenP(o => !o); setOpenC(false); }}
          aria-expanded={openP} aria-haspopup="dialog">
          <span className="rk">Time Period <i className="rk-sep">·</i> <em>{preset}</em></span>
          <span className="rv">
            {shortYMD(from)} <span className="cv">→</span> {shortYMD(to)}
            <span className="cv dr-caret">▾</span>
          </span>
        </button>

        {openP && (
          <div className="dr-pop" role="dialog" aria-label="Select time period">
            <div className="dr-pop-k">Time Period</div>
            <div className="dr-presets">
              {PRESETS.map(p => (
                <button key={p} className={'dr-preset' + (preset === p ? ' on' : '')}
                  onClick={() => setPreset(p)}>{p}</button>
              ))}
            </div>

            <div className="dr-dates">
              <input type="date" value={from || ''} max={to || undefined}
                onChange={e => onSelFrom(e.target.value)} aria-label="From date" />
              <span className="dr-arrow">→</span>
              <input type="date" value={to || ''} min={from || undefined}
                disabled={preset === 'Single Day'}
                onChange={e => onSelTo(e.target.value)} aria-label="To date" />
            </div>
            <p className="dr-hint">
              {preset === 'Single Day'
                ? <>One day — set the start date; the end follows it.</>
                : preset === 'Custom'
                  ? <>Editing either date keeps you on <b>Custom</b>.</>
                  : <>Set by <b>{preset}</b>, ending at the last complete day of data. Editing a date switches to <b>Custom</b>.</>}
            </p>

            {/* Data freshness lives here rather than in the header, so the
                header stays two clean boxes without losing the caveat. */}
            {anchor && niceDate && (
              <p className="dr-foot">
                Data complete through <b>{niceDate(anchor)}</b>
                {partial
                  ? <> — {niceDate(dataTill)} has landed but is only part-loaded, so windows stop short of it.</>
                  : <> — revenue lands a day behind.</>}
              </p>
            )}

            <button className="dr-done" onClick={() => setOpenP(false)}>Done</button>
          </div>
        )}
      </div>

      {/* ── COMPARE WITH ── */}
      <div className="dr-wrap" ref={cRef}>
        <button className={'rangebox dr-trigger' + (openC ? ' open' : '')}
          onClick={() => { setOpenC(o => !o); setOpenP(false); }}
          aria-expanded={openC} aria-haspopup="dialog"
          title={'Comparison window — ' + compareLabel}>
          <span className="rk">
            Compare with
            {cmpMode === 'custom' && <> <i className="rk-sep">·</i> <em>Custom</em></>}
          </span>
          <span className="rv">
            {shortYMD(prevFrom)} <span className="cv">→</span> {shortYMD(prevTo)}
            <span className="cv dr-caret">▾</span>
          </span>
        </button>

        {openC && (
          <div className="dr-pop dr-pop-cmp" role="dialog" aria-label="Set comparison window">
            <div className="dr-compare-head">
              <span className="dr-pop-k" style={{ marginBottom: 0 }}>Compares against</span>
              <span className="dr-modes">
                <button className={cmpMode === 'auto' ? 'on' : ''}
                  onClick={() => setCmpMode('auto')}>Auto</button>
                <button className={cmpMode === 'custom' ? 'on' : ''}
                  onClick={() => setCmpMode('custom')}>Custom</button>
              </span>
            </div>

            <div className="dr-dates">
              <input type="date" value={cmpFrom || ''} max={cmpTo || undefined}
                onChange={e => onCmpFrom(e.target.value)} aria-label="Comparison from date" />
              <span className="dr-arrow">→</span>
              <input type="date" value={cmpTo || ''} min={cmpFrom || undefined}
                onChange={e => onCmpTo(e.target.value)} aria-label="Comparison to date" />
            </div>

            <p className="dr-hint">
              {cmpMode === 'auto'
                ? <>Derived from the selected period — <b>{compareLabel}</b>. Editing a date switches to <b>Custom</b>.</>
                : <>Your own window. Switch to <b>Auto</b> to track the period again.</>}
            </p>

            {lengthWarning && <p className="dr-warn">{lengthWarning}</p>}

            <button className="dr-done" onClick={() => setOpenC(false)}>Done</button>
          </div>
        )}
      </div>
    </>
  );
}
