import React, { useEffect, useState } from 'react';
import { LOGOS, LOGO_DECON } from './logos.js';

// Branded splash, Adsight-style: platform logo tiles pop in staggered around
// the brand mark, then the whole scene zooms out into the workspace.
const TILE_ORDER = [
  'Amazon', 'Flipkart', 'Myntra', 'Nykaa', 'Purplle', 'Meesho',
  'Blinkit', 'Zepto', 'Instamart', 'Cred', 'Smytten', 'Tata Cliq',
];

export default function SplashScreen({ onDone }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 1900);
    const t2 = setTimeout(() => onDone && onDone(), 2450);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'radial-gradient(120% 120% at 50% 40%, #202234 0%, #14151A 60%)',
      display: 'grid', placeItems: 'center',
      opacity: leaving ? 0 : 1, transform: leaving ? 'scale(1.05)' : 'scale(1)',
      transition: 'opacity .55s ease, transform .55s ease',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ textAlign: 'center' }}>
        {/* brand mark */}
        <div style={{
          width: 62, height: 62, borderRadius: 16, margin: '0 auto 16px',
          background: '#fff', display: 'grid', placeItems: 'center',
          boxShadow: '0 8px 30px rgba(75,91,215,.45)', overflow: 'hidden',
          animation: 'sPop .5s cubic-bezier(.2,.7,.3,1) both',
        }}>
          <img src={LOGO_DECON} alt="Deconstruct" style={{ width: '78%', height: '78%', objectFit: 'contain' }} />
        </div>
        <div style={{ color: '#fff', fontSize: 21, fontWeight: 650, letterSpacing: '-0.02em' }}>
          Revenue Analytics
        </div>
        <div style={{ color: '#9AA0AC', fontSize: 13, marginTop: 5 }}>
          Consolidating every channel…
        </div>

        {/* platform tile grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(6, 52px)', gap: 12,
          marginTop: 26, justifyContent: 'center',
        }}>
          {TILE_ORDER.map((ch, i) => (
            <div key={ch} title={ch} style={{
              width: 52, height: 52, borderRadius: 13, background: '#fff',
              display: 'grid', placeItems: 'center', overflow: 'hidden',
              boxShadow: '0 4px 14px rgba(0,0,0,.35)',
              animation: `sPop .45s cubic-bezier(.2,.7,.3,1) ${0.35 + i * 0.07}s both`,
            }}>
              <img src={LOGOS[ch]} alt={ch} style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes sPop { from { transform: scale(.4) translateY(8px); opacity: 0 } to { transform: scale(1) translateY(0); opacity: 1 } }`}</style>
    </div>
  );
}
