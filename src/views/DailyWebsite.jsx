import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getJSON } from '../lib/api.js';
import { inrShort, indianGroup, longDate, shortDate } from '../lib/format.js';
import { KpiSkeletons, ErrorBox, MetricCard } from '../components/ui.jsx';
import Freshness from '../components/Freshness.jsx';
import { todayIST, shiftYMD } from '../dateUtils.js';

// fmt-tag → formatter. The backend tags each metric ('inr','int','rupee',
// 'pct0/1/2','x'); functions can't cross JSON, so the mapping lives here.
const FMT = {
  inr:   v => inrShort(v),
  int:   v => indianGroup(Math.round(v)),
  rupee: v => '₹' + indianGroup(Math.round(v)),
  pct0:  v => v.toFixed(0) + '%',
  pct1:  v => v.toFixed(1) + '%',
  pct2:  v => v.toFixed(2) + '%',
  x:     v => v.toFixed(2) + 'x',
};
const fmtVal = (v, f) => (v == null || isNaN(v) ? '—' : (FMT[f] || FMT.int)(v));
const momOf = r => (r && r.pm ? ((r.mtd - r.pm) / Math.abs(r.pm)) * 100 : null);

// MoM cell — MTD vs MTD-previous, coloured; `invert` flips good/bad (cost-like)
function MoMCell({ cur, prev, invert }) {
  if (prev == null || prev === 0 || cur == null) return <td className="mom-cell null">—</td>;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  const good = invert ? d < 0 : d > 0;
  const cls = Math.abs(d) < 0.5 ? 'flat' : good ? 'pos' : 'neg';
  return <td className={'mom-cell ' + cls}>{(d > 0 ? '+' : '') + d.toFixed(Math.abs(d) >= 100 ? 0 : 1)}%</td>;
}

function Scorecard({ title, rows, badge }) {
  return (
    <div className="mtable">
      <div className="mtable-head">
        <span className="mtable-title">{title}</span>
        {badge && <span className="tag">{badge}</span>}
      </div>
      <table className="mt">
        <thead>
          <tr>
            <th>Metric</th><th>Selected date</th><th>MTD selected</th><th>MTD previous</th><th>% Change MoM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td className="m-name">{r.label}{r.hint && <span className="m-hint" title={r.hint}>?</span>}</td>
              <td className="tnum">{fmtVal(r.sel, r.fmt)}</td>
              <td className="tnum">{fmtVal(r.mtd, r.fmt)}</td>
              <td className="tnum">{fmtVal(r.pm, r.fmt)}</td>
              <MoMCell cur={r.mtd} prev={r.pm} invert={r.invert} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DailyWebsite() {
  const [date, setDate] = useState(shiftYMD(todayIST(), -1));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  useEffect(() => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/website-daily', { date })
      .then(res => { if (my === reqId.current) { setData(res); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  }, [date]);

  const hero = useMemo(() => {
    if (!data) return null;
    const o = Object.fromEntries(data.orderRows.map(r => [r.key, r]));
    const p = Object.fromEntries(data.perfRows.map(r => [r.key, r]));
    return { o, p };
  }, [data]);

  const b = data && data.bounds;

  return (
    <>
      <div className="filterbar rise" style={{ marginTop: -4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input className="date-in" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Report date" />
          {b && <span className="tag">MTD {shortDate(b.mStart)}–{shortDate(b.d)}</span>}
          {b && <span className="tag">vs {shortDate(b.pmStart)}–{shortDate(b.pmEnd)}</span>}
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          D2C website · sales, organic split, and performance marketing — matching the Hex report
        </span>
      </div>

      <div className="banner rise">
        <span className="b-ic">◷</span>
        <span>Windows are <b>selected date</b>, <b>MTD</b>, and <b>MTD previous month</b> (same-day capped, with the month-end fix). Organic = sales minus google/facebook-attributed swift orders; cost grosses ad spend up by 18% GST, as in Hex.</span>
      </div>

      {loading && <KpiSkeletons />}
      {!loading && error && <ErrorBox error={error} onRetry={() => setDate(d => d)} />}

      {!loading && !error && data && hero && (
        <>
          {/* ── HERO — MTD executive read ── */}
          <div className="kpis hero rise">
            <MetricCard big
              label="Sales · MTD"
              value={fmtVal(hero.o.sales.mtd, 'inr')}
              delta={momOf(hero.o.sales)}
              sub={<>{b ? <>{shortDate(b.mStart)}–{shortDate(b.d)} · </> : null}vs previous month</>}
            >
              {/* organic vs paid mix */}
              {(() => {
                const share = hero.o.orgShare.mtd;
                const org = Math.max(0, Math.min(100, share == null ? 0 : share));
                return (
                  <div className="revmix" title={`Organic ${org.toFixed(0)}% · Paid ${(100 - org).toFixed(0)}%`}>
                    <div className="revmix-bar">
                      <span className="revmix-org" style={{ width: org + '%' }} />
                      <span className="revmix-paid" style={{ width: (100 - org) + '%' }} />
                    </div>
                    <div className="revmix-legend">
                      <span><i className="dot org" /> Organic {org.toFixed(0)}%</span>
                      <span><i className="dot paid" /> Paid {(100 - org).toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })()}
            </MetricCard>

            {[
              { r: hero.o.orders, label: 'Orders · MTD', fmt: 'int' },
              { r: hero.o.aov, label: 'AOV · MTD', fmt: 'rupee' },
              // CAC is a cost: a rise is the bad direction, so its delta
              // colour is inverted rather than reading green on a worse number.
              { r: hero.o.cac, label: 'CAC · MTD', fmt: 'rupee', invert: true },
              { r: hero.p.roas, label: 'ROAS · MTD', fmt: 'x' },
            ].map(({ r, label, fmt, invert }) => (
              <MetricCard key={label} label={label}
                value={fmtVal(r.mtd, fmt)} delta={momOf(r)} invertDelta={!!invert}
                sub="vs previous month" />
            ))}
          </div>

          {/* ── SCORECARDS ── */}
          <div className="section rise d1">
            <h2>Website Orders Summary</h2>
            <span className="note">sales, economics and organic split</span>
          </div>
          <div className="card rise d1" style={{ padding: 0, overflow: 'hidden' }}>
            <Scorecard title="Orders &amp; economics" rows={data.orderRows} badge="secondary sales basis" />
          </div>

          <div className="section rise d2">
            <h2>Performance Summary</h2>
            <span className="note">Facebook + Google — spend, efficiency and platform-reported conversions</span>
          </div>
          <div className="card rise d2" style={{ padding: 0, overflow: 'hidden' }}>
            <Scorecard title="Advertising" rows={data.perfRows} badge="cost incl. 18% GST" />
          </div>

          {/* ── FRESHNESS — collapsed provenance footnote ── */}
          {data.freshness && data.freshness.length > 0 && (
            <Freshness
              headers={['Source', 'Last date', 'Lag']}
              rows={data.freshness.map(f => ({
                key: f.source,
                label: f.source,
                lag: f.lastUpdated ? Math.round((new Date(date) - new Date(f.lastUpdated)) / 86400000) : null,
                cells: [{ value: f.lastUpdated ? longDate(f.lastUpdated) : '—' }],
              }))}
            />
          )}
        </>
      )}
    </>
  );
}
