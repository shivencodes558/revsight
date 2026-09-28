import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { getJSON } from '../lib/api.js';
import { KpiSkeletons, ErrorBox } from '../components/ui.jsx';
import { logoFor } from '../components/Sidebar.jsx';

const GOLD = '#EFBF20';
// one line per channel: gold for the leader, greys behind, so the chart stays
// readable at seven series without turning into a rainbow
const LINE_COLORS = ['#EFBF20', '#1B1C16', '#4C4D45', '#86867E', '#B7B7AE', '#C9A227', '#6E6E62'];

const pctS = v => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%');
const monthLabel = ym => {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = String(ym).match(/^(\d{4})-(\d{2})/);
  return m ? `${M[+m[2] - 1]} '${m[1].slice(2)}` : ym;
};

// heat tint for a share cell — scaled within the category, since a 12% lip-balm
// share and a 1% face-wash share are not comparable on one absolute ramp
function heat(v, max) {
  if (v == null || !max) return 'transparent';
  const t = Math.max(0, Math.min(1, v / max));
  return `rgba(239, 191, 32, ${(t * 0.55).toFixed(3)})`;
}

/* ═══════════════════════════════════════════════════════════════════════
   City detail. Quick commerce only, because the marketplace share sheets are
   national. Shares are offtake-weighted, so the "All cities" row is a real
   roll-up rather than an average of city percentages.
   ═══════════════════════════════════════════════════════════════════════ */
function CityShare({ category }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [channel, setChannel] = useState('All');
  const reqId = useRef(0);

  const load = () => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/brand-city')
      .then(r => { if (my === reqId.current) { setData(r); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, []);

  const latest = data && data.months.length ? data.months[data.months.length - 1] : null;
  const prior  = data && data.months.length > 1 ? data.months[data.months.length - 2] : null;

  // offtake-weighted roll-up for a (city, month) across the selected channels
  const roll = useMemo(() => {
    if (!data || !latest) return [];
    const pick = (mo) => {
      const m = new Map();
      for (const r of data.rows) {
        if (r.month !== mo || r.category !== category) continue;
        if (channel !== 'All' && r.channel !== channel) continue;
        if (!r.share) continue;
        const e = m.get(r.city) || { city: r.city, off: 0, size: 0 };
        e.off += r.offtake;
        e.size += r.offtake / r.share;      // implied category size
        m.set(r.city, e);
      }
      return m;
    };
    const cur = pick(latest), prv = prior ? pick(prior) : new Map();
    const out = [...cur.values()].map(e => {
      const p = prv.get(e.city);
      return {
        city: e.city,
        share: e.size > 0 ? e.off / e.size : null,
        offtake: e.off,
        prevShare: p && p.size > 0 ? p.off / p.size : null,
      };
    });
    return out.sort((a, b) => b.offtake - a.offtake);
  }, [data, latest, prior, category, channel]);

  const total = useMemo(() => {
    const off = roll.reduce((s, r) => s + r.offtake, 0);
    const size = roll.reduce((s, r) => s + (r.share ? r.offtake / r.share : 0), 0);
    return { off, share: size > 0 ? off / size : null };
  }, [roll]);

  const maxShare = Math.max(0, ...roll.map(r => r.share || 0));

  return (
    <>
      <div className="nsec rise d3">
        <span className="num">03</span>
        <div className="txt">
          <h2>City detail · {category}</h2>
          <p>
            quick commerce only · {latest ? monthLabel(latest) : '—'} · offtake-weighted share
          </p>
        </div>
        <span className="spacer" />
        <span className="tools">
          <span className="seg">
            {['All', 'Blinkit', 'Instamart', 'Zepto'].map(c => (
              <button key={c} className={channel === c ? 'on' : ''} onClick={() => setChannel(c)}>{c}</button>
            ))}
          </span>
        </span>
      </div>

      {loading && <div className="skeleton sk-chart rise d3" />}
      {!loading && error && <ErrorBox error={error} onRetry={load} />}
      {!loading && !error && !roll.length && (
        <div className="empty rise d3" style={{ padding: 26, fontSize: 12.5 }}>
          No city readings for {category}{channel !== 'All' ? ' on ' + channel : ''} in {latest ? monthLabel(latest) : 'this month'}.
        </div>
      )}

      {!loading && !error && roll.length > 0 && (
        <div className="card rise d3" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>City</th>
                <th style={{ textAlign: 'right' }}>Share</th>
                <th style={{ width: '34%' }}>vs best city</th>
                <th style={{ textAlign: 'right' }}>MoM</th>
                <th style={{ textAlign: 'right' }}>Offtake (SP)</th>
              </tr>
            </thead>
            <tbody>
              {roll.map(r => {
                const d = r.prevShare != null && r.share != null ? (r.share - r.prevShare) * 100 : null;
                return (
                  <tr key={r.city}>
                    <td>{r.city}</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 620 }}>{pctS(r.share)}</td>
                    <td>
                      <div className="track" style={{ height: 6, background: 'var(--line-2)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 3, background: GOLD,
                          width: maxShare > 0 ? ((r.share || 0) / maxShare) * 100 + '%' : '0%',
                        }} />
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {d == null ? <span style={{ color: 'var(--ink-3)' }}>—</span> : (
                        <span className={'kpill ' + (Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down')}>
                          {d > 0 ? '▲' : d < 0 ? '▼' : ''} {Math.abs(d).toFixed(2)}pp
                        </span>
                      )}
                    </td>
                    <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>
                      {'₹' + Math.round(r.offtake).toLocaleString('en-IN')}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--panel-2)', fontWeight: 680 }}>
                <td>All cities</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{pctS(total.share)}</td>
                <td />
                <td />
                <td className="tnum" style={{ textAlign: 'right' }}>{'₹' + Math.round(total.off).toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && data && (
        <p className="card-sub rise d3" style={{ marginTop: 8 }}>
          {data.meta.scope}. Rolled up by offtake, not averaged — {data.meta.lineage}.
        </p>
      )}
    </>
  );
}

export default function WbrBrand() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('Sunscreen');
  const [monthsBack, setMonthsBack] = useState(12);
  const reqId = useRef(0);

  const load = () => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/brand-share')
      .then(r => { if (my === reqId.current) { setData(r); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, []);

  // months actually in play, most recent last
  const months = useMemo(() => (data ? data.months.slice(-monthsBack) : []), [data, monthsBack]);
  const latest = months.length ? months[months.length - 1] : null;
  const prior = months.length > 1 ? months[months.length - 2] : null;

  const at = useMemo(() => {
    const m = new Map();
    if (data) for (const r of data.rows) m.set(r.channel + '|' + r.category + '|' + r.month, r.share);
    return m;
  }, [data]);
  const get = (ch, cat, mo) => (at.has(ch + '|' + cat + '|' + mo) ? at.get(ch + '|' + cat + '|' + mo) : null);

  // trend for the selected category, one series per channel
  const trend = useMemo(() => {
    if (!data) return [];
    return months.map(mo => {
      const row = { month: monthLabel(mo) };
      for (const ch of data.channels) {
        const v = get(ch, category, mo);
        if (v != null) row[ch] = +(v * 100).toFixed(2);
      }
      return row;
    });
  }, [data, months, category, at]);

  // channels that actually have data for this category, ranked by latest share
  const liveChannels = useMemo(() => {
    if (!data || !latest) return [];
    return data.channels
      .map(ch => ({ ch, v: get(ch, category, latest) }))
      .filter(x => x.v != null)
      .sort((a, b) => b.v - a.v);
  }, [data, latest, category, at]);

  // per-category max across channels in the latest month, for the heat scale
  const catMax = useMemo(() => {
    const m = {};
    if (data && latest) for (const cat of data.categories) {
      m[cat] = Math.max(0, ...data.channels.map(ch => get(ch, cat, latest) || 0));
    }
    return m;
  }, [data, latest, at]);

  if (loading) return <KpiSkeletons />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data || !data.rows.length) return <div className="empty">No market-share data available.</div>;

  return (
    <>
      <div className="banner rise">
        <span className="b-ic">◷</span>
        <span>
          Brand share of category, as reported by the panel feeds — <b>not</b> derived from our own sales.
          Marketplace history comes from the share sheets; Amazon switches to the panel feed from Apr 2026;
          quick commerce is the weekly panel, where a channel's share is the sum of its SKU shares.
        </span>
      </div>

      {/* ── latest-month share, per channel, for the selected category ── */}
      <div className="nsec rise">
        <span className="num">01</span>
        <div className="txt">
          <h2>Market share · {category}</h2>
          <p>{latest ? monthLabel(latest) : '—'} · brand share of category by channel</p>
        </div>
        <span className="spacer" />
        <span className="tools">
          <span className="mchips">
            {data.categories.map(c => (
              <button key={c} className={'mchip' + (category === c ? ' on' : '')} onClick={() => setCategory(c)}>
                {category === c && <i className="md" />}{c}
              </button>
            ))}
          </span>
        </span>
      </div>

      <div className="kstrip rise d1">
        {liveChannels.slice(0, 5).map(({ ch, v }) => {
          const p = prior ? get(ch, category, prior) : null;
          const d = p != null && p !== 0 ? (v - p) * 100 : null;   // percentage-POINT move
          return (
            <div className="kcard" key={ch}>
              <span className="kl">{ch}</span>
              <div className="krow">
                <span className="kv">{pctS(v)}</span>
                {d != null && (
                  <span className={'kpill ' + (Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down')}>
                    {d > 0 ? '▲' : d < 0 ? '▼' : ''} {Math.abs(d).toFixed(2)}pp
                  </span>
                )}
              </div>
              <span className="kf">vs {prior ? monthLabel(prior) : '—'}</span>
            </div>
          );
        })}
      </div>

      {/* ── trend ── */}
      <div className="nsec rise d2">
        <span className="num">02</span>
        <div className="txt">
          <h2>Share trend</h2>
          <p>{category} · last {months.length} months · one line per channel</p>
        </div>
        <span className="spacer" />
        <span className="tools">
          <span className="seg">
            {[6, 12, 24].map(n => (
              <button key={n} className={monthsBack === n ? 'on' : ''} onClick={() => setMonthsBack(n)}>{n}M</button>
            ))}
          </span>
        </span>
      </div>
      <div className="card rise d2">
        <div style={{ height: 330 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 14, left: 4, bottom: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                interval={Math.max(0, Math.floor(trend.length / 8) - 1)} angle={-30} textAnchor="end" height={54} />
              <YAxis tickFormatter={v => v.toFixed(0) + '%'} tickLine={false} axisLine={false} width={44} />
              <Tooltip formatter={(v, n) => [Number(v).toFixed(2) + '%', n]} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              {liveChannels.map(({ ch }, i) => (
                <Line key={ch} dataKey={ch} name={ch} stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={i === 0 ? 2.6 : 1.7} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="card-sub" style={{ marginTop: 4, marginBottom: 0 }}>
          Gaps mean the source has no reading for that month — the line bridges them rather than dropping to zero.
        </p>
      </div>

      {/* ── city detail (quick commerce only) ── */}
      <CityShare category={category} />

      {/* ── the full matrix, as the notebook's pivot ── */}
      <div className="nsec rise d3">
        <span className="num">04</span>
        <div className="txt">
          <h2>Channel × category matrix</h2>
          <p>{latest ? monthLabel(latest) : '—'} · shaded within each category column</p>
        </div>
      </div>
      <div className="card rise d3" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Channel</th>
              {data.categories.map(c => <th key={c} style={{ textAlign: 'right' }}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.channels.map(ch => {
              const any = data.categories.some(c => get(ch, c, latest) != null);
              if (!any) return null;
              return (
                <tr key={ch}>
                  <td>
                    <span className="ch">
                      {logoFor(ch) && <img src={logoFor(ch)} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />}
                      {ch}
                    </span>
                  </td>
                  {data.categories.map(c => {
                    const v = get(ch, c, latest);
                    return (
                      <td key={c} className="tnum" style={{ textAlign: 'right', background: heat(v, catMax[c]) }}>
                        {v == null ? <span style={{ color: 'var(--ink-3)' }}>—</span> : pctS(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="card-sub rise d4" style={{ marginTop: 10 }}>
        Sources — {data.meta.lineage}. Flipkart and Meesho end when their share sheets do, so a blank is a missing
        reading rather than a zero share.
      </p>
    </>
  );
}
