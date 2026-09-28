import React, { useMemo } from 'react';
import { METRICS, inRange, byChannel, sumField, trendByDay } from '../lib/metrics.js';
import { inrShort, countShort, pct, longDate } from '../lib/format.js';
import { Kpi, Delta } from '../components/ui.jsx';
import { Sparkline, ChannelLogo } from '../components/viz.jsx';
import { todayIST } from '../dateUtils.js';

// ─────────────────────────────────────────────────────────────────────────
//  OPTIONAL MONTHLY TARGETS (₹ at the selected metric's basis).
//  There is no target data in Snowflake yet — add entries here and the page
//  automatically shows attainment + required daily pace to close the gap.
//  e.g.  '2026-08': 60000000   // ₹6 Cr for Aug 2026
// ─────────────────────────────────────────────────────────────────────────
const MONTHLY_TARGETS = {};

function monthMeta(today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7), d = +today.slice(8, 10);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const pdim = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const p2 = n => String(n).padStart(2, '0');
  return {
    ym: `${y}-${p2(m)}`, day: d, dim,
    from: `${y}-${p2(m)}-01`, to: today,
    pym: `${py}-${p2(pm)}`, pdim,
    pFrom: `${py}-${p2(pm)}-01`,
    pSame: `${py}-${p2(pm)}-${p2(Math.min(d, pdim))}`,
    pTo: `${py}-${p2(pm)}-${p2(pdim)}`,
  };
}

export default function MtdPacing({ data, meta, metric }) {
  const M = METRICS[metric];
  const field = M.field;
  const fmt = M.money ? inrShort : countShort;
  const colorOf = c => (meta && meta.channelColors && meta.channelColors[c]) || '#9AA0AC';

  const mm = useMemo(() => monthMeta(todayIST()), []);
  const mtd = useMemo(() => inRange(data, mm.from, mm.to), [data, mm]);
  const prevMtd = useMemo(() => inRange(data, mm.pFrom, mm.pSame), [data, mm]);
  const prevFull = useMemo(() => inRange(data, mm.pFrom, mm.pTo), [data, mm]);

  const mtdVal = sumField(mtd, field);
  const prevMtdVal = sumField(prevMtd, field);
  const prevFullVal = sumField(prevFull, field);
  const paceDelta = prevMtdVal > 0 ? ((mtdVal - prevMtdVal) / prevMtdVal) * 100 : null;
  const projection = (mtdVal / mm.day) * mm.dim;
  const projDelta = prevFullVal > 0 ? ((projection - prevFullVal) / prevFullVal) * 100 : null;
  const monthPct = (mm.day / mm.dim) * 100;

  const target = MONTHLY_TARGETS[mm.ym] || null;
  const attainment = target ? (mtdVal / target) * 100 : null;
  const reqDaily = target ? Math.max(target - mtdVal, 0) / Math.max(mm.dim - mm.day, 1) : null;

  const spark = useMemo(() => trendByDay(mtd, field).map(p => p.value), [mtd, field]);

  const channels = useMemo(() => {
    const cur = byChannel(mtd, field);
    const prevMap = new Map(byChannel(prevMtd, field).map(c => [c.channel, c.value]));
    const prevFullMap = new Map(byChannel(prevFull, field).map(c => [c.channel, c.value]));
    return cur.map(c => {
      const pv = prevMap.get(c.channel) || 0;
      const pf = prevFullMap.get(c.channel) || 0;
      const proj = (c.value / mm.day) * mm.dim;
      return {
        ...c, prevMtd: pv,
        deltaPct: pv > 0 ? ((c.value - pv) / pv) * 100 : null,
        proj, prevFull: pf,
        projDelta: pf > 0 ? ((proj - pf) / pf) * 100 : null,
        spark: trendByDay(mtd.filter(r => r.channel === c.channel), field).map(p => p.value),
      };
    });
  }, [mtd, prevMtd, prevFull, field, mm]);

  if (!mtd.length) return <div className="empty">No revenue yet this month.</div>;

  return (
    <>
      <div className="banner rise" style={{ background: 'var(--accent-soft)', borderColor: '#C9CFF5', color: 'var(--accent-ink)' }}>
        <span className="b-ic">◔</span>
        <span>This view always shows the <b>current calendar month</b> ({longDate(mm.from)} → {longDate(mm.to)}) and compares against the same days of last month — independent of the date filter above.</span>
      </div>

      <div className="kpis hero rise">
        <div className="kpi big">
          <div className="lbl">MTD {M.label}</div>
          <div className="kpi-row">
            <span className="val tnum">{fmt(mtdVal)}</span>
            <Delta value={paceDelta} />
          </div>
          <div className="sub">Day {mm.day} of {mm.dim} · vs {fmt(prevMtdVal)} same days last month</div>
          <div className="spark"><Sparkline data={spark} color="var(--accent-2)" width={150} height={40} /></div>
        </div>
        <Kpi label="Full-Month Projection" value={fmt(projection)} delta={projDelta} sub={`vs ${fmt(prevFullVal)} last month`} />
        <Kpi label="Daily Run Rate" value={fmt(mtdVal / mm.day)} sub="MTD average per day" />
        <Kpi label="Month Elapsed" value={pct(monthPct, 0)} sub={`${mm.dim - mm.day} days remaining`} />
        {target ? (
          <Kpi label="Target Attainment" value={pct(attainment, 0)} sub={`need ${fmt(reqDaily)}/day to close`} />
        ) : (
          <Kpi label="Target" value="—" sub="add monthly targets in MtdPacing.jsx" />
        )}
      </div>

      {target && (
        <div className="card rise d1" style={{ marginBottom: 14 }}>
          <div className="card-head"><h3>Progress to target</h3><span className="meta">{fmt(mtdVal)} of {fmt(target)}</span></div>
          <div className="pace" style={{ marginTop: 10 }}>
            <div className="fill" style={{ width: pct(Math.min(attainment, 100)) }} />
            <div className="marker" style={{ left: pct(monthPct) }} title={`Month elapsed: ${pct(monthPct, 0)}`} />
          </div>
          <p className="card-sub" style={{ marginTop: 8, marginBottom: 0 }}>
            The dark marker is where attainment should be if revenue landed evenly across the month.
          </p>
        </div>
      )}

      <div className="section rise d1">
        <h2>Channel pacing</h2>
        <span className="note">MTD vs same {mm.day} days last month · projection vs last full month</span>
      </div>
      <div className="card rise d1">
        <table className="tbl">
          <thead>
            <tr>
              <th>Channel</th><th style={{ textAlign: 'left' }}>MTD trend</th>
              <th>MTD {M.label}</th><th>vs Last MTD</th>
              <th>Projected Month</th><th>vs Last Full Month</th>
            </tr>
          </thead>
          <tbody>
            {channels.filter(c => c.value > 0 || c.prevMtd > 0).map(c => (
              <tr key={c.channel}>
                <td><span className="ch"><ChannelLogo channel={c.channel} color={colorOf(c.channel)} />{c.channel}</span></td>
                <td><Sparkline data={c.spark} color={colorOf(c.channel)} width={90} height={24} /></td>
                <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(c.value)}</td>
                <td style={{ textAlign: 'right' }}><Delta value={c.deltaPct} /></td>
                <td className="tnum" style={{ textAlign: 'right' }}>{fmt(c.proj)}</td>
                <td style={{ textAlign: 'right' }}><Delta value={c.projDelta} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
