import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, Legend,
} from 'recharts';
import { getJSON } from '../lib/api.js';
import { inrShort, countShort, pct, signedPct, longDate } from '../lib/format.js';
import { Kpi, Delta, KpiSkeletons, ErrorBox } from '../components/ui.jsx';
import { ChannelLogo } from '../components/viz.jsx';
import { todayIST, shiftYMD } from '../dateUtils.js';

const logoKey = n => ({ 'Swiggy': 'Instamart', 'Swiggy IM': 'Instamart', 'Amazon Now': 'Amazon', 'Flipkart Minutes': 'Flipkart' }[n] || n);
const num = (v, d = 2) => (v == null || isNaN(v) ? '—' : v.toFixed(d));

// window selector: 'mtd' primary, 'sel' for the day
const WIN = { mtd: 'mtd', sel: 'sel' };

function sumWin(rows, w, field) { let t = 0; for (const r of rows) t += (r[w] && r[w][field]) || 0; return t; }

// percent change, or null when there is no prior to divide by
const pctChg = (cur, prev) =>
  (prev == null || prev === 0 || cur == null ? null : ((cur - prev) / Math.abs(prev)) * 100);

function MoM({ cur, prev, invert = false, suffix = '' }) {
  if (prev == null || prev === 0 || cur == null) return <span className="delta flat">—</span>;
  const d = pctChg(cur, prev);
  const good = invert ? d < 0 : d > 0;
  const cls = Math.abs(d) < 0.5 ? 'flat' : good ? 'up' : 'down';
  const arrow = d > 0.5 ? '▲' : d < -0.5 ? '▼' : '→';
  // arrow carries the direction; the number is magnitude only
  const mag = Math.abs(d);
  return <span className={'delta ' + cls}>{arrow} {(mag >= 100 ? Math.round(mag) : mag.toFixed(1)) + '%'}{suffix}</span>;
}

export default function Marketplace() {
  const [date, setDate] = useState(shiftYMD(todayIST(), -1));
  const [win, setWin] = useState('mtd');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  useEffect(() => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/marketplace', { date })
      .then(res => { if (my === reqId.current) { setData(res); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  }, [date]);

  const rows = data ? data.rows : [];
  const w = WIN[win];

  // executive roll-up across all marketplaces
  const exec = useMemo(() => {
    if (!rows.length) return null;
    const g = f => sumWin(rows, w, f), gp = f => sumWin(rows, 'pm', f);
    const sec = g('sec'), adRev = g('adRev'), spend = g('spend'), units = g('units'), mrp = g('mrp');
    const organic = sec - adRev;
    const psec = gp('sec'), padRev = gp('adRev'), pspend = gp('spend'), punits = gp('units');
    return {
      sec, adRev, organic, spend, units, mrp,
      organicShare: sec > 0 ? (organic / sec) * 100 : 0,
      roas: spend > 0 ? adRev / spend : 0, tacos: sec > 0 ? (spend / sec) * 100 : 0,
      acos: adRev > 0 ? (spend / adRev) * 100 : 0, asp: units > 0 ? sec / units : 0,
      psec, padRev, porganic: psec - padRev, pspend, punits,
      proas: pspend > 0 ? padRev / pspend : 0, ptacos: psec > 0 ? (pspend / psec) * 100 : 0,
      pasp: punits > 0 ? psec / punits : 0,
    };
  }, [rows, w]);

  const ranked = useMemo(() => {
    const arr = [...rows].sort((a, b) => (b[w].sec || 0) - (a[w].sec || 0));
    const tot = arr.reduce((s, r) => s + (r[w].sec || 0), 0) || 1;
    return arr.map(r => ({ ...r, contribution: ((r[w].sec || 0) / tot) * 100 }));
  }, [rows, w]);

  // RCA insights — auto-surfaced anomalies
  const insights = useMemo(() => {
    const out = [];
    for (const r of rows) {
      const c = r[w], p = r.pm;
      if (!p || p.sec === 0) continue;
      const secG = ((c.sec - p.sec) / p.sec) * 100;
      const spendG = p.spend > 0 ? ((c.spend - p.spend) / p.spend) * 100 : null;
      // spend up, sales flat/down
      if (spendG != null && spendG > 15 && secG < 5)
        out.push({ kind: 'bad', ch: r.channel, text: <>spend up <b>{signedPct(spendG)}</b> but secondary sales only <b>{signedPct(secG)}</b> — efficiency leak</> });
      // ROAS deterioration
      if (c.roas != null && p.roas != null && p.roas > 0 && (c.roas - p.roas) / p.roas < -0.2)
        out.push({ kind: 'bad', ch: r.channel, text: <>ROAS fell to <b>{num(c.roas)}x</b> from {num(p.roas)}x</> });
      // TACOS spike
      if (c.tacos != null && p.tacos != null && c.tacos - p.tacos > 3)
        out.push({ kind: 'bad', ch: r.channel, text: <>TACOS climbed <b>+{num(c.tacos - p.tacos, 1)}pts</b> to {num(c.tacos, 1)}%</> });
      // strong growth
      if (secG > 25)
        out.push({ kind: 'good', ch: r.channel, text: <>secondary sales up <b>{signedPct(secG)}</b> to {inrShort(c.sec)}</> });
    }
    return out.sort((a, b) => (a.kind === 'bad' ? -1 : 1)).slice(0, 8);
  }, [rows, w]);

  // freshness / D-2 staleness
  const staleAlerts = useMemo(() => {
    if (!data) return [];
    return data.freshness.filter(f => {
      const lag = f.salesLastUpdated ? Math.round((new Date(date) - new Date(f.salesLastUpdated)) / 86400000) : 99;
      return lag >= 2;
    });
  }, [data, date]);

  return (
    <>
      <div className="filterbar rise" style={{ marginTop: -4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input className="date-in" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Report date" />
          <div className="seg">
            <button className={win === 'mtd' ? 'on' : ''} onClick={() => setWin('mtd')}>MTD</button>
            <button className={win === 'sel' ? 'on' : ''} onClick={() => setWin('sel')}>Selected Day</button>
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          Nykaa · Flipkart · Purplle · Amazon Now shown on D-2 basis, as in Hex
        </span>
      </div>

      {loading && <KpiSkeletons />}
      {!loading && error && <ErrorBox error={error} onRetry={() => setDate(d => d)} />}

      {!loading && !error && exec && (
        <>
          {/* ── EXECUTIVE OVERVIEW ── */}
          <div className="kpis hero rise">
            <div className="kpi big">
              <div className="lbl">Total Secondary Sales</div>
              <div className="kpi-row">
                <span className="val tnum">{inrShort(exec.sec)}</span>
                <MoM cur={exec.sec} prev={exec.psec} />
              </div>
              <div className="sub">{win === 'mtd' ? 'MTD' : longDate(date)} · MoM</div>
              <div className="kpi-pairs">
                <div><span className="k">Ad</span><b className="tnum">{inrShort(exec.adRev)}</b></div>
                <div><span className="k">Organic</span><b className="tnum">{inrShort(exec.organic)}</b><span className="kpi-pair-n">{pct(exec.organicShare, 0)}</span></div>
              </div>
            </div>
            <Kpi label="Ad Spend" value={inrShort(exec.spend)} delta={pctChg(exec.spend, exec.pspend)} invertDelta sub="MoM" />
            <Kpi label="ROAS" value={num(exec.roas) + 'x'} delta={pctChg(exec.roas, exec.proas)} sub={`vs ${num(exec.proas)}x last month`} />
            <Kpi label="TACOS" value={pct(exec.tacos, 1)} delta={pctChg(exec.tacos, exec.ptacos)} invertDelta sub="MoM" />
            <Kpi label="ASP" value={inrShort(exec.asp)} delta={pctChg(exec.asp, exec.pasp)} sub={`${countShort(exec.units)} units`} />
          </div>

          {/* organic vs ad split bar */}
          <div className="card rise d1" style={{ marginBottom: 14 }}>
            <div className="card-head"><h3>Ad vs Organic contribution</h3><span className="meta">{win === 'mtd' ? 'month-to-date' : 'selected day'}</span></div>
            <div style={{ display: 'flex', height: 34, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
              <div style={{ width: pct(100 - exec.organicShare), background: 'linear-gradient(90deg,#4B5BD7,#6B79E6)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, fontWeight: 600 }}>
                Ad {pct(100 - exec.organicShare, 0)}
              </div>
              <div style={{ width: pct(exec.organicShare), background: 'var(--up-soft)', display: 'grid', placeItems: 'center', color: 'var(--up)', fontSize: 12, fontWeight: 600 }}>
                Organic {pct(exec.organicShare, 0)}
              </div>
            </div>
            <p className="card-sub" style={{ marginTop: 8, marginBottom: 0 }}>
              Ad sales {inrShort(exec.adRev)} · Organic {inrShort(exec.organic)} · a higher organic share means less dependence on paid spend.
            </p>
          </div>

          {/* ── RCA INSIGHTS ── */}
          {(insights.length > 0 || staleAlerts.length > 0) && (
            <>
              <div className="section rise d1"><h2>What needs attention</h2><span className="note">auto-surfaced vs same days last month</span></div>
              <div className="insights rise d1" style={{ marginBottom: 8 }}>
                {staleAlerts.map(f => (
                  <div className="card insight bad" key={'stale' + f.channel}>
                    <div className="glyph">⏱</div>
                    <div><h4>{f.channel} data is stale</h4><p>Last sales update {longDate(f.salesLastUpdated)} — numbers may understate actuals.</p></div>
                  </div>
                ))}
                {insights.map((it, i) => (
                  <div className={'card insight ' + it.kind} key={i}>
                    <div className="glyph">{it.kind === 'good' ? '↗' : '⚠'}</div>
                    <div><h4>{it.ch}</h4><p>{it.text}</p></div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── MARKETPLACE PERFORMANCE ── */}
          <div className="section rise d2"><h2>Marketplace performance</h2><span className="note">ranked by secondary sales · efficiency side by side</span></div>
          <div className="card rise d2" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Marketplace</th><th>Secondary</th><th>MoM</th><th>Contrib</th>
                  <th>Ad Sales</th><th>Organic %</th><th>Spend</th><th>ROAS</th><th>TACOS</th><th>ACOS</th><th>ASP</th><th>DRR</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(r => {
                  const c = r[w];
                  return (
                    <tr key={r.channel}>
                      <td>
                        <span className="ch"><ChannelLogo channel={logoKey(r.channel)} size={20} />{r.channel}
                          {r.offset > 0 && <span className="tag" style={{ marginLeft: 4 }}>D-{r.offset + 1}</span>}
                          {!r.hasAds && <span className="tag" style={{ marginLeft: 4, color: 'var(--ink-3)' }}>no ads</span>}
                        </span>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{inrShort(c.sec)}</td>
                      <td style={{ textAlign: 'right' }}><MoM cur={c.sec} prev={r.pm.sec} /></td>
                      <td className="tnum bar-cell" style={{ textAlign: 'right' }}>
                        {pct(r.contribution, 1)}
                        <div className="track"><div className="fill" style={{ width: pct(r.contribution), background: '#4B5BD7' }} /></div>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{c.adRev > 0 ? inrShort(c.adRev) : '—'}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{c.organicShare != null ? pct(c.organicShare, 0) : '—'}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{c.spend > 0 ? inrShort(c.spend) : '—'}</td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 600, color: c.roas != null ? (c.roas >= 3 ? 'var(--up)' : c.roas < 1.5 ? 'var(--down)' : 'var(--ink)') : 'var(--ink-3)' }}>{c.roas != null ? num(c.roas) + 'x' : '—'}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{c.tacos != null ? pct(c.tacos, 1) : '—'}</td>
                      <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{c.acos != null ? pct(c.acos, 0) : '—'}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{c.asp != null ? inrShort(c.asp) : '—'}</td>
                      <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{r.drr != null ? countShort(Math.round(r.drr)) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* efficiency scatter-ish: ROAS by spend as bars */}
          <div className="section rise d3"><h2>Spend efficiency</h2><span className="note">ROAS by channel · bar height = ROAS, sorted</span></div>
          <div className="card rise d3">
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ranked.filter(r => r[w].roas != null).map(r => ({ name: r.channel, roas: +(r[w].roas).toFixed(2), spend: r[w].spend }))}
                          margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={54} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={v => v + 'x'} />
                  <Tooltip formatter={(v, n) => n === 'roas' ? [v + 'x', 'ROAS'] : [inrShort(v), 'Spend']} />
                  <Bar dataKey="roas" radius={[5, 5, 0, 0]}>
                    {ranked.filter(r => r[w].roas != null).map((r, i) => (
                      <Cell key={i} fill={r[w].roas >= 3 ? '#12886A' : r[w].roas < 1.5 ? '#C23B33' : '#4B5BD7'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="card-sub" style={{ marginTop: 6, marginBottom: 0 }}>Green ≥ 3x (efficient) · red &lt; 1.5x (review) · a low ROAS with high spend is the first place to cut.</p>
          </div>
        </>
      )}
    </>
  );
}
