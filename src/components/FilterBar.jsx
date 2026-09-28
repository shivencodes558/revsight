import React, { useState, useRef, useEffect, useMemo } from 'react';
import { logoFor } from './Sidebar.jsx';

/* ═══════════════════════════════════════════════════════════════════════
   Two filter controls, each matched to what it is filtering.

   · ChannelIcons — channels are BRANDS. A row of logos is recognised
     pre-attentively, which no amount of reading a list achieves, and it is
     the pattern already established in the rail. Labels stay because the
     secondary feed splits Myntra into SJIT and Direct: same logo, different
     channel, and a logo alone could not tell them apart.

     It is SINGLE-select, not multi: picking a second channel used to add it
     to the set rather than replace the first, so two clicks silently built a
     combination nobody asked to see and the result read as "which of these
     am I even looking at?". One channel at a time, click again to go back to
     "all" — the same toggle a radio group gives you.

   · MultiSelect — categories, sub-categories and ABC classes are WORDS
     with no visual identity, and sub-category runs to 22 values. As chips
     they were three wrapped rows of visual noise above the data; behind one
     trigger they cost a single line and read as "2 selected".

   Same job, different affordance, because the content differs.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── channel logo row (single-select) ───────────────────────────────────── */
export function ChannelIcons({ label = 'Channel', options, value, onChange }) {
  if (!options || !options.length) return null;
  // `value` is a single channel name or null ("all channels"). Clicking the
  // already-selected one clears back to all; clicking another replaces it —
  // never adds to it.
  const pick = k => onChange(value === k ? null : k);
  const anyOn = value != null;
  return (
    <div className="fb-block fb-chan">
      <div className="fb-head">
        <span className="fb-k">{label}</span>
        {anyOn
          ? <button className="fb-clear" onClick={() => onChange(null)}>all channels</button>
          : <span className="fb-hint">all</span>}
      </div>
      <div className="fb-icons" role="radiogroup" aria-label={label}>
        {options.map(o => {
          const src = logoFor(o);
          const on = value === o;
          // With nothing selected every channel is included, so dimming the
          // unselected ones would imply the opposite. Dim only once a single
          // channel is actually in force.
          const dim = anyOn && !on;
          return (
            <button key={o} type="button"
              className={'fb-icon' + (on ? ' on' : '') + (dim ? ' dim' : '')}
              onClick={() => pick(o)}
              role="radio"
              aria-checked={on}
              title={on ? `${o} — click to show all channels` : `Show ${o} only`}>
              <span className="fb-icon-art">
                {src ? <img src={src} alt="" /> : <span className="fb-icon-init">{initials(o)}</span>}
                {on && <span className="fb-icon-tick">✓</span>}
              </span>
              <span className="fb-icon-lbl">{shortName(o)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const initials = n => String(n).split(/[\s-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
// Myntra SJIT / Myntra Direct share a logo, so the caption carries the part
// that distinguishes them rather than repeating the brand.
const SHORT = { 'Myntra SJIT': 'SJIT', 'Myntra Direct': 'Direct', 'Swiggy IM': 'Instamart', 'Tata Cliq': 'Tata Cliq' };
const shortName = n => SHORT[n] || n;

/* ── multi-select dropdown ──────────────────────────────────────────────── */
export function MultiSelect({
  label, options, value, onChange, searchAfter = 12, placeholder = 'All',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? options.filter(o => o.toLowerCase().includes(n)) : options;
  }, [options, q]);

  if (!options || !options.length) return null;
  const toggle = k => onChange(value.includes(k) ? value.filter(v => v !== k) : [...value, k]);

  // One selection reads better as its own name than as "1 selected".
  const summary = value.length === 0 ? placeholder
    : value.length === 1 ? value[0]
      : `${value.length} selected`;

  return (
    <div className="fb-block" ref={ref}>
      <div className="fb-head">
        <span className="fb-k">{label}</span>
        {value.length > 0 && (
          <button className="fb-clear" onClick={() => onChange([])}>clear</button>
        )}
      </div>
      <button type="button" className={'fb-trigger' + (open ? ' open' : '') + (value.length ? ' active' : '')}
        onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="listbox">
        <span className="fb-trigger-v">{summary}</span>
        <span className="fb-caret">▾</span>
      </button>

      {open && (
        <div className="fb-pop" role="listbox" aria-multiselectable="true" aria-label={label}>
          {options.length > searchAfter && (
            <input className="fb-search" value={q} placeholder={`Filter ${options.length}…`}
              onChange={e => setQ(e.target.value)} autoFocus aria-label={`Search ${label}`} />
          )}
          <div className="fb-list">
            {shown.map(o => {
              const on = value.includes(o);
              return (
                <button key={o} type="button" role="option" aria-selected={on}
                  className={'fb-opt' + (on ? ' on' : '')} onClick={() => toggle(o)}>
                  <span className="fb-box">{on ? '✓' : ''}</span>
                  <span className="fb-opt-l">{o}</span>
                </button>
              );
            })}
            {!shown.length && <div className="fb-none">No match for “{q}”.</div>}
          </div>
          <div className="fb-pop-foot">
            <button onClick={() => onChange([])} disabled={!value.length}>Clear</button>
            <button onClick={() => onChange([...options])} disabled={value.length === options.length}>Select all</button>
          </div>
        </div>
      )}
    </div>
  );
}
