import React, { useState, useEffect, useRef } from 'react';
import { getJSON } from '../lib/api.js';
import { ErrorBox } from '../components/ui.jsx';
import { logoFor } from '../components/Sidebar.jsx';

const money = v => (v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN'));
const pct0 = v => (v == null ? '—' : Math.round(v) + '%');
const pct1 = v => (v == null ? '—' : v.toFixed(1) + '%');

/* ═══════════════════════════════════════════════════════════════════════
   OVERALL-MP — the notebook's headline marketplace table.

   Colouring follows the notebook: CHANGE green when positive, and PCT_ACH
   green at or above 100 (target hit) rather than on sign, since 99% is a miss
   however positive it looks.
   ═══════════════════════════════════════════════════════════════════════ */
export default function WbrMarketplaceTable({ selStart, selEnd, prevStart, prevEnd }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  const load = () => {
    if (!selStart || !selEnd || !prevStart || !prevEnd) return;
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/mp-wbr', { selStart, selEnd, prevStart, prevEnd })
      .then(r => { if (my === reqId.current) { setData(r); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, [selStart, selEnd, prevStart, prevEnd]);

  if (loading) return <div className="skeleton sk-chart rise" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data || !data.rows.length) return <div className="empty">No marketplace rows for this window.</div>;

  const cell = (v, good) => ({
    background: v == null ? undefined : good ? '#E8F4EC' : '#FCEDEB',
    color:      v == null ? undefined : good ? '#1A7F4B' : '#C0392B',
    fontWeight: 620,
  });

  return (
    <>
      <div className="card rise" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Platform</th>
              <th style={{ textAlign: 'right' }}>Sales</th>
              <th style={{ textAlign: 'right' }}>Prev</th>
              <th style={{ textAlign: 'right' }}>Change</th>
              <th style={{ textAlign: 'right' }}>Target</th>
              <th style={{ textAlign: 'right' }}>% Ach</th>
              <th style={{ textAlign: 'right' }}>Discount</th>
              <th style={{ textAlign: 'right' }}>TACOS</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.platform} style={r.isTotal ? { background: 'var(--panel-2)', fontWeight: 680 } : undefined}>
                <td>
                  <span className="ch">
                    {!r.isTotal && logoFor(r.platform) && (
                      <img src={logoFor(r.platform)} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />
                    )}
                    {r.platform}
                  </span>
                </td>
                <td className="tnum" style={{ textAlign: 'right' }}>{money(r.sales)}</td>
                <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{money(r.prevSales)}</td>
                <td className="tnum" style={{ textAlign: 'right', ...cell(r.change, r.change > 0) }}>
                  {r.change == null ? '—' : (r.change > 0 ? '+' : '') + Math.round(r.change) + '%'}
                </td>
                <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{money(r.target)}</td>
                {/* target hit is the ≥100 line, not the sign */}
                <td className="tnum" style={{ textAlign: 'right', ...cell(r.pctAch, r.pctAch >= 100) }}>{pct0(r.pctAch)}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{pct1(r.discount)}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{pct1(r.tacos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-sub rise d1" style={{ marginTop: 9 }}>
        Targets are the monthly net targets prorated across the window. TACOS is measured on MRP for Nykaa,
        Swiggy IM and Zepto and on secondary sales elsewhere, with Zepto netting off its fixed monthly
        retainer first — the notebook's conventions, kept as-is. {data.meta.note}
      </p>
    </>
  );
}
