import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { getJSON } from '../lib/api.js';
import { inrShort, indianGroup, longDate, shortDate } from '../lib/format.js';
import { KpiSkeletons, ErrorBox, MetricCard } from '../components/ui.jsx';
import Freshness from '../components/Freshness.jsx';
import { todayIST, shiftYMD } from '../dateUtils.js';
import { copyChannelImage, copyImageLabel } from '../lib/copyImage.js';

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

// "Website(Go Swift) DOD Revenue and Orders Summary" — trailing 30 days,
// newest first. Organic/Paid split by the same rule as the Orders Summary's
// Organic Sales row, just at a per-day grain.
function DodTable({ rows }) {
  const money = v => '₹' + indianGroup(Math.round(v));
  const int = v => indianGroup(Math.round(v));
  return (
    <div className="mtable">
      <div className="mtable-head">
        <span className="mtable-title">Daily Revenue Summary</span>
        <span className="tag">trailing {rows.length} days</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="mt">
          <thead>
            <tr>
              <th>Date</th><th>Day</th><th>Organic Revenue</th><th>Paid Revenue</th>
              <th>Organic Orders</th><th>Paid Orders</th><th>Total Revenue</th><th>Total Orders</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.date}>
                <td className="m-name">{shortDate(r.date)}</td>
                <td>{r.dayName}</td>
                <td className="tnum">{money(r.organicRevenue)}</td>
                <td className="tnum">{money(r.paidRevenue)}</td>
                <td className="tnum">{int(r.organicOrders)}</td>
                <td className="tnum">{int(r.paidOrders)}</td>
                <td className="tnum">{money(r.totalRevenue)}</td>
                <td className="tnum">{int(r.totalOrders)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// "Website Product Wise Summary" — Units-Volume / SP-Sales, ranked by MTD,
// with a search box and simple pagination (these run to 100+ rows).
function ProductTable({ title, rows, metric, badge }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const PER_PAGE = 20;
  const fmt = metric === 'qty' ? (v => indianGroup(Math.round(v))) : (v => '₹' + indianGroup(Math.round(v)));

  const sorted = useMemo(() => [...rows].sort((a, b) => b[metric].mtd - a[metric].mtd), [rows, metric]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return sorted;
    return sorted.filter(r => (r.product + r.category + r.subCategory).toLowerCase().includes(n));
  }, [sorted, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const p = Math.min(page, pages - 1);
  const shown = filtered.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);

  return (
    <div className="mtable">
      <div className="mtable-head">
        <span className="mtable-title">{title}</span>
        {badge && <span className="tag">{badge}</span>}
        <input className="mx-find" value={q} placeholder="Filter products…"
          onChange={e => { setQ(e.target.value); setPage(0); }} aria-label={`Filter ${title}`} />
        <span className="mx-count">{filtered.length} of {rows.length} products</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="mt">
          <thead>
            <tr>
              <th>Product</th><th>Category</th><th>Sub Category</th>
              <th>Selected date</th><th>MTD selected</th><th>MTD previous</th><th>% Change MoM</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.category + '|' + r.subCategory + '|' + r.product}>
                <td className="m-name">{r.product}</td>
                <td>{r.category}</td>
                <td>{r.subCategory}</td>
                <td className="tnum">{fmt(r[metric].sel)}</td>
                <td className="tnum">{fmt(r[metric].mtd)}</td>
                <td className="tnum">{fmt(r[metric].pm)}</td>
                <MoMCell cur={r[metric].mtd} prev={r[metric].pm} />
              </tr>
            ))}
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

// One "Copy image" button + white capture card per table, so each table in
// the report can be screenshotted and pasted into an email on its own —
// same affordance as the Marketplace Daily Report's per-channel button.
function CopyableCard({ subtitle, children }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('idle');
  const label = copyImageLabel(status);
  return (
    <>
      <div className="copy-toolbar rise">
        <button type="button" className={'copy-img-btn' + (status !== 'idle' ? ' ' + status : '')}
          onClick={() => copyChannelImage(ref.current, setStatus)} disabled={status === 'copying'}>
          {label}
        </button>
      </div>
      <div className="cblock-shot rise" ref={ref} data-channel={subtitle}>
        <div className="cblock-shot-title">
          Website
          <span className="sub">· {subtitle}</span>
        </div>
        {children}
      </div>
    </>
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
          {/* ── TARGET vs NET SALES · MTD ── */}
          {data.targetMtd != null && (
            <>
              <div className="section rise" style={{ marginTop: 4 }}>
                <h2>Target vs Net Sales · MTD</h2>
                <span className="note">target from gs_primary_targets (primary basis) vs net sales actuals</span>
              </div>
              <div className="card rise">
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[{ name: shortDate(date), target: data.targetMtd, sales: hero.o.sales.mtd }]}
                      layout="vertical" margin={{ top: 8, right: 60, left: 10, bottom: 4 }}
                    >
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={v => inrShort(v, { currency: false })} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={70} />
                      <Tooltip formatter={(v, n) => [inrShort(v), n === 'target' ? 'Target MTD' : 'Net Sales MTD']} />
                      <Legend formatter={v => (v === 'target' ? 'Target MTD' : 'Net Sales MTD')} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="target" fill="#9AA0AC" radius={[0, 4, 4, 0]} barSize={28} />
                      <Bar dataKey="sales" fill="var(--accent)" radius={[0, 4, 4, 0]} barSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}

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
              { r: hero.p.dbRoas, label: 'ROAS · MTD', fmt: 'x' },
            ].map(({ r, label, fmt, invert }) => (
              <MetricCard key={label} label={label}
                value={fmtVal(r.mtd, fmt)} delta={momOf(r)} invertDelta={!!invert}
                sub="vs previous month" />
            ))}
          </div>

          {/* ── DOD TABLE — Go Swift daily organic/paid trend ── */}
          {data.dod && data.dod.length > 0 && (
            <>
              <div className="section rise">
                <h2>Website(Go Swift) DOD Revenue and Orders Summary</h2>
                <span className="note">day-by-day, organic vs paid — trailing 30 days, newest first</span>
              </div>
              <CopyableCard subtitle={`Daily Report · ${longDate(date)}`}>
                <DodTable rows={data.dod} />
              </CopyableCard>
            </>
          )}

          {/* ── SCORECARDS — each its own copyable table now ── */}
          <div className="section rise d1">
            <h2>Website Orders Summary</h2>
            <span className="note">sales, economics and organic split</span>
          </div>
          <CopyableCard subtitle={`Website Orders Summary · ${longDate(date)}`}>
            <Scorecard title="Orders &amp; economics" rows={data.orderRows} badge="secondary sales basis" />
          </CopyableCard>

          <div className="section rise d2">
            <h2>Performance Summary</h2>
            <span className="note">Facebook + Google — spend, efficiency, GoKwik and platform-reported (DB) conversions</span>
          </div>
          <CopyableCard subtitle={`Performance Summary · ${longDate(date)}`}>
            <Scorecard title="Advertising" rows={data.perfRows} badge="cost incl. 18% GST" />
          </CopyableCard>

          {/* ── CUSTOMER MIX ── */}
          {data.custMixRows && data.custMixRows.length > 0 && (
            <>
              <div className="section rise">
                <h2>Customer mix</h2>
                <span className="note">New vs Repeating customers, by order date</span>
              </div>
              <CopyableCard subtitle={`Customer mix · ${longDate(date)}`}>
                <Scorecard title="Customer mix" rows={data.custMixRows} />
              </CopyableCard>
            </>
          )}

          {/* ── PRODUCT WISE SUMMARY ── */}
          {data.products && data.products.length > 0 && (
            <>
              <div className="section rise">
                <h2>Website Product Wise Summary</h2>
                <span className="note">ranked by MTD · same windows as the rest of this report</span>
              </div>
              <CopyableCard subtitle={`Units - Volume · ${longDate(date)}`}>
                <ProductTable title="Units - Volume" rows={data.products} metric="qty" />
              </CopyableCard>
              <CopyableCard subtitle={`SP - Sales · ${longDate(date)}`}>
                <ProductTable title="SP - Sales" rows={data.products} metric="sp" />
              </CopyableCard>
            </>
          )}

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
