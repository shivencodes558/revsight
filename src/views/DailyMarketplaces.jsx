import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell } from 'recharts';
import { getJSON } from '../lib/api.js';
import { inrShort, indianGroup, countShort, pct, longDate } from '../lib/format.js';
import { KpiSkeletons, ErrorBox } from '../components/ui.jsx';
import { ChannelLogo } from '../components/viz.jsx';
import Freshness from '../components/Freshness.jsx';
import { todayIST, shiftYMD } from '../dateUtils.js';

// Hex display order of channel blocks
const BLOCK_ORDER = [
  'Amazon', 'Flipkart', 'Nykaa', 'Purplle', 'Myntra SJIT', 'Myntra', 'Meesho',
  'Blinkit', 'Swiggy IM', 'Zepto', 'Amazon Now', 'Flipkart Minutes', 'Reliance Tira',
];
const logoKey = n => ({
  'Swiggy IM': 'Instamart', 'Swiggy': 'Instamart', 'Myntra SJIT': 'Myntra',
  'Amazon Now': 'Amazon', 'Flipkart Minutes': 'Flipkart', 'Reliance Tira': 'Nykaa',
}[n] || n);

// targets are keyed by primary channel names; map to marketplace display names
const TARGET_KEY = { 'Nykaa': 'Nykaa (P)', 'Purplle': 'Purplle (P)', 'Blinkit': 'Blinkit (P)', 'Zepto': 'Zepto (P)', 'Swiggy IM': 'Instamart (P)', 'Myntra SJIT': 'Myntra', 'Flipkart Minutes': 'Flipkart Minutes (P)', 'Amazon Now': 'Amazon_Now(P)' };

const n2 = (v, d = 2) => (v == null || isNaN(v) ? null : v.toFixed(d));

// MoM cell — Hex renders %_Change_MoM (mtd vs mtd_prev) with red/green fill
function MoMCell({ cur, prev, invert = false }) {
  if (prev == null || prev === 0 || cur == null) return <td className="mom-cell null">null</td>;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  const good = invert ? d < 0 : d > 0;
  const cls = Math.abs(d) < 0.5 ? 'flat' : good ? 'pos' : 'neg';
  return <td className={'mom-cell ' + cls}>{(d > 0 ? '+' : '') + d.toFixed(d > 100 || d < -100 ? 0 : 2)}%</td>;
}

// one metric row across the three Hex windows
function MRow({ label, sel, mtd, pm, fmt, invert, hint }) {
  const f = v => (v == null || isNaN(v) ? 'null' : fmt(v));
  return (
    <tr>
      <td className="m-name">{label}{hint && <span className="m-hint" title={hint}>?</span>}</td>
      <td className="tnum">{f(sel)}</td>
      <td className="tnum">{f(mtd)}</td>
      <td className="tnum">{f(pm)}</td>
      <MoMCell cur={mtd} prev={pm} invert={invert} />
    </tr>
  );
}

function MetricTable({ title, rows, badge }) {
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
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function ChannelBlock({ r, open, onToggle }) {
  const money = inrShort, int = v => indianGroup(Math.round(v));
  const salesRows = [
    <MRow key="mrp" label="MRP Sales" sel={r.sel.mrp} mtd={r.mtd.mrp} pm={r.pm.mrp} fmt={money} />,
    <MRow key="u" label="Units Sold" sel={r.sel.units} mtd={r.mtd.units} pm={r.pm.units} fmt={int} />,
    <MRow key="sec" label="Secondary Sales" sel={r.sel.sec} mtd={r.mtd.sec} pm={r.pm.sec} fmt={money} />,
    <MRow key="drr" label="DRR" sel={r.sel.units} mtd={r.drr} pm={null} fmt={int} hint="MTD units ÷ day of month" />,
    <MRow key="amrp" label="Avg MRP" sel={r.sel.avgMrp} mtd={r.mtd.avgMrp} pm={r.pm.avgMrp} fmt={v => '₹' + Math.round(v)} />,
    <MRow key="asp" label="ASP" sel={r.sel.asp} mtd={r.mtd.asp} pm={r.pm.asp} fmt={v => '₹' + Math.round(v)} />,
    <MRow key="disc" label="Discount %" sel={r.sel.discount} mtd={r.mtd.discount} pm={r.pm.discount} fmt={v => n2(v, 1) + '%'} invert />,
    <MRow key="tac" label="TACOS %" sel={r.sel.tacos} mtd={r.mtd.tacos} pm={r.pm.tacos} fmt={v => n2(v, 1) + '%'} invert />,
    <MRow key="org" label="Organic Sales" sel={r.sel.organic} mtd={r.mtd.organic} pm={r.pm.organic} fmt={money} />,
    <MRow key="orgs" label="Organic Share %" sel={r.sel.organicShare} mtd={r.mtd.organicShare} pm={r.pm.organicShare} fmt={v => n2(v, 0) + '%'} />,
  ];
  const adsRows = [
    <MRow key="sp" label="Spends" sel={r.sel.spend} mtd={r.mtd.spend} pm={r.pm.spend} fmt={money} invert />,
    <MRow key="mrpa" label="MRP Sales Ads" sel={r.sel.mrpSalesAds} mtd={r.mtd.mrpSalesAds} pm={r.pm.mrpSalesAds} fmt={money} />,
    <MRow key="ua" label="Units Sold Ads" sel={r.sel.adUnits} mtd={r.mtd.adUnits} pm={r.pm.adUnits} fmt={int} />,
    <MRow key="seca" label="Sec Sales Ads" sel={r.sel.adRev} mtd={r.mtd.adRev} pm={r.pm.adRev} fmt={money} />,
    <MRow key="amrpa" label="Avg MRP" sel={r.sel.adUnits > 0 ? r.sel.adRev / r.sel.adUnits : null} mtd={r.mtd.adUnits > 0 ? r.mtd.adRev / r.mtd.adUnits : null} pm={r.pm.adUnits > 0 ? r.pm.adRev / r.pm.adUnits : null} fmt={v => '₹' + Math.round(v)} />,
    <MRow key="imp" label="Impressions" sel={r.sel.imp} mtd={r.mtd.imp} pm={r.pm.imp} fmt={int} />,
    <MRow key="clk" label="Clicks" sel={r.sel.clk} mtd={r.mtd.clk} pm={r.pm.clk} fmt={int} />,
    <MRow key="vw" label="Views" sel={r.sel.views} mtd={r.mtd.views} pm={r.pm.views} fmt={int} />,
    <MRow key="ctr" label="CTR %" sel={r.sel.ctr} mtd={r.mtd.ctr} pm={r.pm.ctr} fmt={v => n2(v) + '%'} />,
    <MRow key="cov" label="Cov %" sel={r.sel.cov} mtd={r.mtd.cov} pm={r.pm.cov} fmt={v => n2(v) + '%'} />,
    <MRow key="acos" label="Acos %" sel={r.sel.acos} mtd={r.mtd.acos} pm={r.pm.acos} fmt={v => n2(v) + '%'} invert />,
    <MRow key="roi" label="RoI" sel={r.sel.roas} mtd={r.mtd.roas} pm={r.pm.roas} fmt={v => n2(v) + 'x'} />,
  ];

  const secMoM = r.pm.sec > 0 ? ((r.mtd.sec - r.pm.sec) / r.pm.sec) * 100 : null;

  return (
    <div className={'cblock' + (open ? ' open' : '')}>
      <button className="cblock-head" onClick={onToggle}>
        <span className={'chev' + (open ? ' open' : '')}>▸</span>
        <ChannelLogo channel={logoKey(r.channel)} size={24} />
        <span className="cblock-name">{r.channel}</span>
        {r.offset > 0 && <span className="tag">D-2</span>}
        {!r.hasAds && <span className="tag">no ads</span>}
        <span className="cblock-stats">
          <span><span className="mono-lbl">MTD Sec</span> <b className="tnum">{inrShort(r.mtd.sec)}</b></span>
          <span className={'delta ' + (secMoM == null ? 'flat' : secMoM > 0.5 ? 'up' : secMoM < -0.5 ? 'down' : 'flat')}>
            {secMoM == null ? '—' : (secMoM > 0 ? '↑ ' : '↓ ') + Math.abs(secMoM).toFixed(1) + '%'}
          </span>
          <span><span className="mono-lbl">ROAS</span> <b className="tnum">{r.mtd.roas != null ? n2(r.mtd.roas) + 'x' : '—'}</b></span>
          <span><span className="mono-lbl">TACOS</span> <b className="tnum">{r.mtd.tacos != null ? n2(r.mtd.tacos, 1) + '%' : '—'}</b></span>
        </span>
      </button>
      {open && (
        <div className="cblock-body rise">
          <MetricTable title="Sales" rows={salesRows} />
          {r.hasAds
            ? <MetricTable title="Ads" rows={adsRows} badge="from ads snapshot" />
            : <div className="empty" style={{ padding: 26 }}>No advertising data reported for {r.channel}.</div>}
        </div>
      )}
    </div>
  );
}

export default function DailyMarketplaces() {
  const [date, setDate] = useState(shiftYMD(todayIST(), -1));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openCh, setOpenCh] = useState(new Set());
  const reqId = useRef(0);

  useEffect(() => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/marketplace', { date })
      .then(res => {
        if (my !== reqId.current) return;
        setData(res); setLoading(false);
        const first = (res.rows || []).slice().sort((a, b) => b.mtd.sec - a.mtd.sec)[0];
        if (first) setOpenCh(new Set([first.channel]));
      })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  }, [date]);

  const rows = useMemo(() => {
    if (!data) return [];
    const idx = c => { const i = BLOCK_ORDER.indexOf(c); return i < 0 ? 900 : i; };
    return [...data.rows].sort((a, b) => idx(a.channel) - idx(b.channel));
  }, [data]);

  // Target MTD vs Secondary MTD — targets come from gs_primary_targets
  const targetChart = useMemo(() => {
    if (!data) return [];
    const tmap = new Map((data.targets || []).map(t => [t.channel, t.netTarget]));
    return rows.map(r => {
      const key = TARGET_KEY[r.channel] || r.channel;
      return { name: r.channel, target: tmap.get(key) || 0, secondary: r.mtd.sec };
    }).filter(d => d.target > 0 || d.secondary > 0);
  }, [rows, data]);

  const toggle = ch => setOpenCh(s => { const n = new Set(s); n.has(ch) ? n.delete(ch) : n.add(ch); return n; });
  const allOpen = rows.length > 0 && openCh.size === rows.length;

  return (
    <>
      <div className="filterbar rise" style={{ marginTop: -4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input className="date-in" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Report date" />
          <button className="chip" onClick={() => setOpenCh(allOpen ? new Set() : new Set(rows.map(r => r.channel)))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          Nykaa · Flipkart · Purplle · Amazon Now report on a D-2 basis, as in Hex
        </span>
      </div>

      <div className="banner rise">
        <span className="b-ic">◷</span>
        <span>Data shown is for the selected date (default: yesterday). Change the date and every block updates. Windows are <b>selected date</b>, <b>MTD</b>, and <b>MTD previous month</b> — matching the Hex report exactly.</span>
      </div>

      {loading && <KpiSkeletons />}
      {!loading && error && <ErrorBox error={error} onRetry={() => setDate(d => d)} />}

      {!loading && !error && data && (
        <>
          {/* ── TARGET vs SECONDARY MTD ── */}
          <div className="section rise" style={{ marginTop: 4 }}>
            <h2>Target vs Secondary · MTD</h2>
            <span className="note">targets from gs_primary_targets (primary basis) vs secondary actuals</span>
          </div>
          <div className="card rise">
            <div style={{ height: 292 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={targetChart} margin={{ top: 8, right: 10, left: 6, bottom: 4 }} barGap={3}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10.5 }} tickLine={false} axisLine={false} angle={-22} textAnchor="end" height={62} interval={0} />
                  <YAxis tickFormatter={v => inrShort(v, { currency: false })} tickLine={false} axisLine={false} width={54} />
                  <Tooltip formatter={(v, n) => [inrShort(v), n === 'target' ? 'Target MTD' : 'Secondary MTD']} />
                  <Legend formatter={v => (v === 'target' ? 'Target MTD' : 'Secondary MTD')} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="target" fill="#9AA0AC" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="secondary" radius={[4, 4, 0, 0]}>
                    {targetChart.map((d, i) => (
                      <Cell key={i} fill={d.target > 0 && d.secondary >= d.target ? '#12886A' : '#12886A'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="card-sub" style={{ marginTop: 6, marginBottom: 0 }}>
              Targets are sourced from the primary-sales target sheet; channels without a target row show secondary only.
            </p>
          </div>

          {/* ── PER-CHANNEL BLOCKS ── */}
          <div className="section rise d1">
            <h2>Channel reports</h2>
            <span className="note">{rows.length} channels · click to expand sales and ads detail</span>
          </div>
          <div className="rise d1">
            {rows.map(r => (
              <ChannelBlock key={r.channel} r={r} open={openCh.has(r.channel)} onToggle={() => toggle(r.channel)} />
            ))}
          </div>

          {/* ── FRESHNESS — a collapsed provenance footnote, not a section ── */}
          <Freshness
            headers={['Channel', 'Sales table', 'Ads table', 'Lag']}
            note="Lag is measured against the selected report date."
            rows={data.freshness.map(f => ({
              key: f.channel,
              label: f.channel,
              node: <span className="ch"><ChannelLogo channel={logoKey(f.channel)} size={16} />{f.channel}</span>,
              lag: f.salesLastUpdated ? Math.round((new Date(date) - new Date(f.salesLastUpdated)) / 86400000) : null,
              cells: [
                { value: f.salesLastUpdated ? longDate(f.salesLastUpdated) : '—' },
                { value: f.adsLastUpdated ? longDate(f.adsLastUpdated) : 'null', muted: !f.adsLastUpdated },
              ],
            }))}
          />
        </>
      )}
    </>
  );
}
