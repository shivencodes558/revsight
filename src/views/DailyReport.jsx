import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getJSON } from '../lib/api.js';
import { inrShort, countShort, indianGroup, pct, longDate } from '../lib/format.js';
import { KpiSkeletons, ErrorBox } from '../components/ui.jsx';
import { ChannelLogo } from '../components/viz.jsx';
import Freshness from '../components/Freshness.jsx';
import { todayIST, shiftYMD } from '../dateUtils.js';

// primary channel name → logo key (strip the (P)/Now suffixes; unknown → dot)
function logoKey(name) {
  const map = {
    'Nykaa (P)': 'Nykaa', 'Purplle (P)': 'Purplle', 'Blinkit (P)': 'Blinkit',
    'Zepto (P)': 'Zepto', 'Instamart (P)': 'Instamart', 'Website': 'Website',
    'Amazon': 'Amazon', 'Flipkart': 'Flipkart', 'Myntra': 'Myntra',
    'Meesho': 'Meesho', 'Smytten': 'Smytten', 'Cred': 'Cred', 'Tata Cliq': 'Tata Cliq',
    'Flipkart Minutes (P)': 'Flipkart', 'Amazon_Now(P)': 'Amazon', 'Myntra_Now(P)': 'Myntra',
  };
  return map[name] || name;
}

// Hex-style integer % chip: -13%, +42%, 0%
// Same ▲/▼ pill as everywhere else — arrow for direction, magnitude only.
// A missing prior is "—", not "0%": no baseline is not a flat month.
function ChipPct({ cur, prev }) {
  if (prev == null || prev === 0 || cur == null) return <span className="delta flat">—</span>;
  const p = ((cur - prev) / prev) * 100;
  const flat = Math.abs(p) <= 0.5;
  const cls = flat ? 'flat' : p > 0 ? 'up' : 'down';
  const arrow = flat ? '→' : p > 0 ? '▲' : '▼';
  const mag = Math.abs(p);
  return (
    <span className={'delta ' + cls}>
      {arrow} {(mag >= 100 ? Math.round(mag) : mag.toFixed(1)) + '%'}
    </span>
  );
}

function totals(rows) {
  const t = { uSel: 0, uPrev: 0, gSel: 0, gPrev: 0, nSel: 0, nPrev: 0 };
  for (const r of rows) for (const k of Object.keys(t)) t[k] += r[k] || 0;
  return t;
}

function GroupCard({ title, t }) {
  return (
    <div className="kpi">
      <div className="lbl">{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
        {[['Units', countShort(t.uSel), <ChipPct key="u" cur={t.uSel} prev={t.uPrev} />],
          ['Gross', inrShort(t.gSel), <ChipPct key="g" cur={t.gSel} prev={t.gPrev} />],
          ['Net', inrShort(t.nSel), <ChipPct key="n" cur={t.nSel} prev={t.nPrev} />]].map(([l, v, c]) => (
          <div key={l}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
            <div className="tnum" style={{ fontSize: 16.5, fontWeight: 660, margin: '2px 0' }}>{v}</div>
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryTable({ rows, targets, showTargets }) {
  const t = totals(rows);
  const targetOf = ch => { const m = targets && targets.find(x => x.channel === ch); return m ? m.netTarget : 0; };
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Channel</th><th>Group</th>
          <th>Units</th><th>Prev</th><th>Δ</th>
          <th>Gross (MRP)</th><th>Prev</th><th>Δ</th>
          <th>Net (SP)</th><th>Prev</th><th>Δ</th>
          {showTargets && <><th>Net Target</th><th>Attain</th></>}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const tgt = showTargets ? targetOf(r.channel) : 0;
          return (
            <tr key={r.group + r.channel}>
              <td><span className="ch"><ChannelLogo channel={logoKey(r.channel)} size={20} />{r.channel}</span></td>
              <td><span className="tag">{r.group}</span></td>
              <td className="tnum" style={{ textAlign: 'right' }}>{indianGroup(r.uSel)}</td>
              <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{indianGroup(r.uPrev)}</td>
              <td style={{ textAlign: 'right' }}><ChipPct cur={r.uSel} prev={r.uPrev} /></td>
              <td className="tnum" style={{ textAlign: 'right' }}>{inrShort(r.gSel)}</td>
              <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{inrShort(r.gPrev)}</td>
              <td style={{ textAlign: 'right' }}><ChipPct cur={r.gSel} prev={r.gPrev} /></td>
              <td className="tnum" style={{ textAlign: 'right' }}>{inrShort(r.nSel)}</td>
              <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{inrShort(r.nPrev)}</td>
              <td style={{ textAlign: 'right' }}><ChipPct cur={r.nSel} prev={r.nPrev} /></td>
              {showTargets && <>
                <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{tgt ? inrShort(tgt) : '—'}</td>
                <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{tgt ? pct((r.nSel / tgt) * 100, 0) : '—'}</td>
              </>}
            </tr>
          );
        })}
        <tr style={{ background: 'var(--panel-2)', fontWeight: 680 }}>
          <td>Total</td><td />
          <td className="tnum" style={{ textAlign: 'right' }}>{indianGroup(t.uSel)}</td>
          <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{indianGroup(t.uPrev)}</td>
          <td style={{ textAlign: 'right' }}><ChipPct cur={t.uSel} prev={t.uPrev} /></td>
          <td className="tnum" style={{ textAlign: 'right' }}>{inrShort(t.gSel)}</td>
          <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{inrShort(t.gPrev)}</td>
          <td style={{ textAlign: 'right' }}><ChipPct cur={t.gSel} prev={t.gPrev} /></td>
          <td className="tnum" style={{ textAlign: 'right' }}>{inrShort(t.nSel)}</td>
          <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{inrShort(t.nPrev)}</td>
          <td style={{ textAlign: 'right' }}><ChipPct cur={t.nSel} prev={t.nPrev} /></td>
          {showTargets && (() => {
            const tt = rows.reduce((s, r) => s + (targets && targets.find(x => x.channel === r.channel) ? targets.find(x => x.channel === r.channel).netTarget : 0), 0);
            return <>
              <td className="tnum" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{tt ? inrShort(tt) : '—'}</td>
              <td className="tnum" style={{ textAlign: 'right' }}>{tt ? pct((t.nSel / tt) * 100, 0) : '—'}</td>
            </>;
          })()}
        </tr>
      </tbody>
    </table>
  );
}

export default function DailyReport() {
  const [date, setDate] = useState(shiftYMD(todayIST(), -1)); // Hex default: yesterday
  const [dataset, setDataset] = useState('snapshot');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  useEffect(() => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/daily', { date, dataset })
      .then(res => { if (my === reqId.current) { setData(res); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  }, [date, dataset]);

  const groups = useMemo(() => {
    if (!data) return null;
    const by = g => data.d1.filter(r => r.group === g);
    return { all: totals(data.d1), b2c: totals(by('B2C')), b2b: totals(by('B2B')), qc: totals(by('Q-Commerce')) };
  }, [data]);

  const staleness = ymd => {
    if (!ymd) return null;
    const days = Math.round((new Date(date) - new Date(ymd)) / 86400000);
    return days;
  };

  return (
    <>
      <div className="filterbar rise" style={{ marginTop: -4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input className="date-in" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Report date" />
          <div className="seg">
            <button className={dataset === 'snapshot' ? 'on' : ''} onClick={() => setDataset('snapshot')}>Snapshot</button>
            <button className={dataset === 'attributed' ? 'on' : ''} onClick={() => setDataset('attributed')}>Attributed</button>
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {dataset === 'snapshot' ? 'Same-day view · no cancellations or attribution applied' : 'Attributed view · cancellations & attribution applied'}
        </span>
      </div>

      <div className="banner rise" style={{ background: 'var(--accent-soft)', borderColor: '#C9CFF5', color: 'var(--accent-ink)' }}>
        <span className="b-ic">◐</span>
        <span>Primary sales (sell-in) vs <b>same day last month</b> · Flipkart compared with a 1-day lag, exactly as in Hex · independent of the global date filter.</span>
      </div>

      {loading && <KpiSkeletons />}
      {!loading && error && <ErrorBox error={error} onRetry={() => setDate(d => d)} />}

      {!loading && !error && data && groups && (
        <>
          <div className="kpis rise" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi big">
              <div className="lbl">All Channels · Gross</div>
              <div className="kpi-row">
                <span className="val tnum">{inrShort(groups.all.gSel)}</span>
                <ChipPct cur={groups.all.gSel} prev={groups.all.gPrev} />
              </div>
              <div className="sub">{longDate(date)} vs same day last month</div>
              {/* Net and units were crammed into the caption with their own
                  chips, which read as a sentence rather than as figures. As
                  labelled pairs they line up and can be compared. */}
              <div className="kpi-pairs">
                <div>
                  <span className="k">Net</span>
                  <b className="tnum">{inrShort(groups.all.nSel)}</b>
                  <ChipPct cur={groups.all.nSel} prev={groups.all.nPrev} />
                </div>
                <div>
                  <span className="k">Units</span>
                  <b className="tnum">{countShort(groups.all.uSel)}</b>
                  <ChipPct cur={groups.all.uSel} prev={groups.all.uPrev} />
                </div>
              </div>
            </div>
            <GroupCard title="B2C" t={groups.b2c} />
            <GroupCard title="B2B" t={groups.b2b} />
            <GroupCard title="Q-Commerce" t={groups.qc} />
          </div>

          <div className="section rise d1"><h2>D-1 Summary</h2><span className="note">selected date vs same day last month · Flipkart D-1 lag applied</span></div>
          <div className="card rise d1" style={{ overflowX: 'auto' }}>
            <SummaryTable rows={data.d1} targets={data.targets} showTargets={false} />
          </div>

          <div className="section rise d2"><h2>M-1 Summary · MTD</h2><span className="note">month-to-date vs same days last month · with monthly net targets</span></div>
          <div className="card rise d2" style={{ overflowX: 'auto' }}>
            <SummaryTable rows={data.mtd} targets={data.targets} showTargets={true} />
          </div>

          <Freshness
            headers={['Channel', 'Group', 'Last updated', 'Lag']}
            note="Last order date per channel in this dataset."
            rows={data.freshness.map(f => ({
              key: f.group + f.channel,
              label: f.channel,
              node: <span className="ch"><ChannelLogo channel={logoKey(f.channel)} size={16} />{f.channel}</span>,
              lag: staleness(f.lastUpdated),
              cells: [
                { value: <span className="tag">{f.group}</span> },
                { value: longDate(f.lastUpdated) },
              ],
            }))}
          />

          <p className="card-sub rise d4" style={{ marginTop: 14 }}>
            Order-status exclusions replicate the Hex filter ({data.meta.excludedStatuses.slice(0, 4).join(', ')}… {data.meta.excludedStatuses.length} values, editable in one list in <code>api/_snowflake.js</code>). Confirm against the full 16-value chip in Hex.
          </p>
        </>
      )}
    </>
  );
}
