import React, { useState, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/* ────────────────────────────────────────────────────────────────────────────
   SplashScreen — cinematic boot sequence for Revsight.

   Ported from Adsight's splash (same structure, timing, and motion) — only
   the accent colour changes, from Adsight's gold to an indigo/blue, so the
   two dashboards read as siblings rather than twins.

   Renders as a FIXED OVERLAY above the already-mounted workspace, so the exit
   "zooms through" the splash directly into the live dashboard — no cut, no
   flicker, and channel data starts fetching underneath from t=0.

   Sequence (≈2.05s total):
     1. Dark background (instant).
     2. Brand pill + "Revsight" title: fade + scale + upward motion.
     3. Channel families revealed one by one (QComm → ECom), logos staggering
        in within each group.
     4. Exit ("zoom-through"):
          • groups + credit fade and drift toward the title (merge to focal point)
          • brief anticipation pause on the title
          • camera-like accelerating zoom (scale → 9) as the title fades
          • backdrop dissolves in sync, revealing the dashboard beneath
     5. onComplete() fires exactly once → App unmounts the overlay.

   Props:
     onComplete : () => void                          (required)
     groups     : [{ title, items:[{ id, src }] }]
     title      : string   (default 'Revsight')
     subtitle   : string   (default below)

   Notes:
     • Animation is opacity/transform only → GPU-composited. Motion blur is
       intentionally omitted (CSS filter animation is not composited and can
       drop frames while the dashboard boots underneath); the accelerating
       ease-in zoom reads as motion blur perceptually.
     • Respects prefers-reduced-motion: collapses to a quick fade.
     • Click / tap / any key skips straight to the exit.
     • Purely presentational — no data fetching, no side effects beyond timers.
   ──────────────────────────────────────────────────────────────────────────── */

const EASE_OUT = [0.22, 1, 0.36, 1];   // smooth deceleration for entrances
const EASE_IO  = [0.65, 0, 0.35, 1];   // symmetric ease for small exits
const EASE_ZOOM = [0.7, 0, 0.84, 0];   // hard accelerating ease-in → camera push

// Timeline (ms)
const T = {
  title: 0,          // title starts immediately
  groupBase: 340,    // first group header appears
  groupGap: 300,     // gap between successive groups
  logoStagger: 50,   // per-logo stagger inside a group
  hold: 1450,        // when the exit phase begins (last logo settles at ~1440ms)
  zoomDur: 600,      // duration of the zoom-through (incl. anticipation pause)
  bgDelay: 240,      // backdrop starts dissolving this long into the zoom
  bgFade: 340,       // backdrop dissolve duration (ends ~2030ms, with the zoom)
};

// Entrance durations (s) — kept here so the timeline above stays readable.
const DUR = { title: 0.45, header: 0.3, logo: 0.32, logoLead: 0.08, credit: 0.34, glow: 0.7 };

export default function SplashScreen({
  onComplete,
  groups = [],
  title = 'Revsight',
  subtitle = 'Revenue Intelligence Dashboard — every channel, one view.',
}) {
  const [phase, setPhase] = useState('in');       // 'in' → 'out'
  const doneRef = useRef(false);                  // guarantee onComplete fires once
  const reduced = useReducedMotion();

  // Phase timer: after the hold, begin the zoom-through.
  useEffect(() => {
    const holdMs = reduced ? 350 : T.hold;
    const t = setTimeout(() => setPhase('out'), holdMs);
    return () => clearTimeout(t);
  }, [reduced]);

  // Skip: click/tap or any key jumps straight to the exit zoom. Never skips
  // past the handoff itself — it just starts the exit early, so the reveal
  // into the dashboard stays identical.
  useEffect(() => {
    const skip = () => setPhase(p => (p === 'in' ? 'out' : p));
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  // Hard fallback: if the exit animation is ever interrupted (backgrounded
  // tab throttles rAF, etc.), still hand off to the app.
  useEffect(() => {
    const failSafe = setTimeout(() => finish(), reduced ? 900 : 3000);
    return () => clearTimeout(failSafe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (typeof onComplete === 'function') onComplete();
  };

  const D = {
    bg: '#0B0C0E', panel: '#15171A', line: '#23262B', line2: '#30343A',
    t1: '#F4F5F6', t2: '#B5BAC1', t3: '#7E848C',
    acc: '#6472FF',
  };
  const DISPLAY = "'Plus Jakarta Sans',system-ui,sans-serif";
  const BODY = "'Inter',system-ui,sans-serif";
  const MONO = "'JetBrains Mono',ui-monospace,monospace";

  const out = phase === 'out';
  const zoomS = T.zoomDur / 1000;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, overflow: 'hidden', pointerEvents: out ? 'none' : 'auto' }}>

      {/* ── Backdrop: dissolves partway into the zoom, revealing the dashboard beneath ── */}
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: out ? 0 : 1 }}
        transition={out
          ? { duration: reduced ? 0.22 : T.bgFade / 1000, delay: reduced ? 0 : T.bgDelay / 1000, ease: 'easeIn' }
          : { duration: 0 }}
        onAnimationComplete={(def) => { if (def && def.opacity === 0) finish(); }}
        style={{ position: 'absolute', inset: 0, background: D.bg, willChange: 'opacity' }}
      >
        {/* ambient glow (lives on the backdrop so it dissolves with it) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DUR.glow, ease: 'easeOut' }}
          style={{
            position: 'absolute', top: '-18%', left: '30%', width: 560, height: 560,
            borderRadius: '50%', filter: 'blur(150px)',
            background: 'radial-gradient(circle, rgba(100,114,255,.14), transparent 70%)',
          }}
        />
      </motion.div>

      {/* ── Composition: everything that zooms. transformOrigin = screen center. ── */}
      <motion.div
        initial={false}
        animate={out
          ? { scale: reduced ? 1 : [1, 1.04, 9], opacity: [1, 1, 0] }
          : { scale: 1, opacity: 1 }}
        transition={out
          ? { duration: reduced ? 0.22 : zoomS, times: [0, 0.28, 1], ease: ['easeOut', EASE_ZOOM] }
          : { duration: 0 }}
        style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', transformOrigin: '50% 46%', willChange: 'transform, opacity',
        }}
      >
        <div style={{ position: 'relative', textAlign: 'center', padding: '0 28px', maxWidth: 560, width: '100%' }}>

          {/* ── Title block: entrance fade + scale + rise; becomes the zoom's focal point ── */}
          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: DUR.title, delay: T.title / 1000, ease: EASE_OUT }}
            style={{ willChange: 'transform, opacity' }}
          >
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16,
              padding: '6px 14px', borderRadius: 999, background: D.panel, border: '1px solid ' + D.line,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: D.acc, boxShadow: '0 0 8px ' + D.acc }} />
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.3em', color: D.t2, textTransform: 'uppercase' }}>Deconstruct</span>
            </div>
            <h1 style={{ fontFamily: DISPLAY, fontSize: 40, fontWeight: 700, lineHeight: 1.1, margin: '0 0 10px', color: D.t1, letterSpacing: '-0.02em' }}>
              {title}
            </h1>
            <p style={{ fontFamily: BODY, fontSize: 13.5, color: D.t2, margin: 0 }}>{subtitle}</p>
          </motion.div>

          {/* ── Channel families: staggered reveal; on exit they drift up into the
                 title and fade — merging the composition into one focal point ── */}
          <motion.div
            initial={false}
            animate={out ? { opacity: 0, y: -26, scale: 0.96 } : { opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: EASE_IO }}
            style={{ marginTop: 34, willChange: 'transform, opacity' }}
          >
            {groups.map((grp, gi) => {
              const groupDelay = reduced ? 0.06 : (T.groupBase + gi * T.groupGap) / 1000;
              return (
                <div key={grp.title} style={{ marginBottom: 18 }}>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: DUR.header, delay: groupDelay, ease: EASE_OUT }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, justifyContent: 'center' }}
                  >
                    <span style={{ width: 26, height: 1, background: D.line2 }} />
                    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.22em', color: D.t3, textTransform: 'uppercase' }}>{grp.title}</span>
                    <span style={{ width: 26, height: 1, background: D.line2 }} />
                  </motion.div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
                    {grp.items.map((p, pi) => (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, scale: 0.7, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{
                          duration: DUR.logo,
                          delay: reduced ? 0.06 : groupDelay + DUR.logoLead + pi * (T.logoStagger / 1000),
                          ease: EASE_OUT,
                        }}
                        style={{
                          width: 46, height: 46, borderRadius: 12, background: '#fff',
                          border: '1px solid ' + D.line2, overflow: 'hidden',
                          boxShadow: '0 2px 10px rgba(0,0,0,.3)',
                          willChange: 'transform, opacity',
                        }}
                      >
                        {p.src
                          ? <img src={p.src} alt={p.id} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <span style={{ display: 'block', width: '100%', height: '100%', background: '#E5E7EB' }} />}
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </motion.div>

          {/* ── footer credit: fades with the groups on exit ── */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: out ? 0 : 1 }}
            transition={{ duration: out ? 0.16 : DUR.credit, delay: out ? 0 : 0.5, ease: 'easeOut' }}
            style={{ fontFamily: MONO, fontSize: 9, color: D.acc, letterSpacing: '.14em', textTransform: 'uppercase', margin: '26px 0 0' }}
          >
            Designed &amp; Developed by Shivendra
          </motion.p>
        </div>
      </motion.div>
    </div>
  );
}
