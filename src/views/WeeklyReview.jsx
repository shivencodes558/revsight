import React, { useMemo } from 'react';
import { METRICS, inRange, byChannel, byGroup, sumField, pop } from '../lib/metrics.js';
import { aggBy, eligibleMovers } from '../lib/cube.js';
import { inrShort, countShort, pct, signedPct, longDate } from '../lib/format.js';
import { Delta } from '../components/ui.jsx';

// `segment` narrows the review to one side of the business:
//   'marketplace' → every channel except the D2C site
//   'website'     → the D2C site only
//   null          → everything (unsegmented)
const SEGMENTS = {
  marketplace: { label: 'Marketplace', keep: ch => ch !== 'Website' },
  website:     { label: 'Website',     keep: ch => ch === 'Website' },
};

export default function WeeklyReview({ data, cube, cubeLoading, from, to, prevFrom, prevTo, metric, segment = null }) {
  const M = METRICS[metric];
  const field = M.field;
  const fmt = M.money ? inrShort : countShort;
  const seg = SEGMENTS[segment] || null;

  const segData = useMemo(
    () => (!seg || !data ? data : data.filter(r => seg.keep(r.channel))),
    [data, seg]);
  const segCube = useMemo(
    () => (!seg || !cube ? cube : cube.filter(r => seg.keep(r.channel))),
    [cube, seg]);

  const cur = useMemo(() => inRange(segData, from, to), [segData, from, to]);
  const prev = useMemo(() => inRange(segData, prevFrom, prevTo), [segData, prevFrom, prevTo]);

  const R = useMemo(() => {
    if (!cur.length) return null;
    const total = pop(cur, prev, field);
    const units = pop(cur, prev, 'units');

    // channels
    const chans = byChannel(cur, field);
    const prevMap = new Map(byChannel(prev, field).map(c => [c.channel, c.value]));
    const enriched = chans.map(c => {
      const pv = prevMap.get(c.channel) || 0;
      return { ...c, prevValue: pv, deltaPct: pv > 0 ? ((c.value - pv) / pv) * 100 : null };
    });
    const top = enriched[0];
    const meaningful = enriched.filter(c => c.share >= 2 && c.deltaPct != null);
    const grower = [...meaningful].sort((a, b) => b.deltaPct - a.deltaPct)[0] || null;
    const decliner = [...meaningful].sort((a, b) => a.deltaPct - b.deltaPct)[0] || null;

    // groups (QC share shift)
    const gNow = byGroup(cur, field);
    const gPrev = byGroup(prev, field);
    const qcNow = gNow.find(g => g.group === 'Q-Commerce');
    const qcPrev = gPrev.find(g => g.group === 'Q-Commerce');
    const qcShift = qcNow && qcPrev ? qcNow.share - qcPrev.share : null;

    // cube-derived
    let subUp = null, subDown = null, prodUp = null, prodDown = null, unmappedPct = 0, concentration = null;
    if (segCube && segCube.length) {
      const subs = eligibleMovers(aggBy(segCube, r => r.subCategory, metric), 50).filter(s => s.share >= 1);
      subUp = [...subs].sort((a, b) => b.deltaPct - a.deltaPct)[0] || null;
      subDown = [...subs].sort((a, b) => a.deltaPct - b.deltaPct)[0] || null;

      const prods = eligibleMovers(
        aggBy(segCube.filter(r => !r.unmapped), r => r.sku, metric, r => ({ product: r.product, subCategory: r.subCategory })), 30);
      prodUp = [...prods].sort((a, b) => b.deltaPct - a.deltaPct)[0] || null;
      prodDown = [...prods].sort((a, b) => a.deltaPct - b.deltaPct)[0] || null;

      let uU = 0, tU = 0;
      for (const r of segCube) { tU += r.curUnits || 0; if (r.unmapped) uU += r.curUnits || 0; }
      unmappedPct = tU > 0 ? (uU / tU) * 100 : 0;

      const skuAgg = aggBy(segCube.filter(r => !r.unmapped), r => r.sku, metric, r => ({ product: r.product }));
      const top5 = skuAgg.slice(0, 5).reduce((s, x) => s + x.share, 0);
      concentration = { top5, top1: skuAgg[0] || null };
    }

    return { total, units, top, grower, decliner, qcNow, qcShift, subUp, subDown, prodUp, prodDown, unmappedPct, concentration, channelsActive: enriched.filter(c => c.value > 0).length };
  }, [cur, prev, field, segCube, metric]);

  if (!R) return <div className="empty">No revenue in this range.</div>;

  const dir = R.total.deltaPct == null ? 'flat' : R.total.deltaPct >= 3 ? 'up' : R.total.deltaPct <= -3 ? 'down' : 'flat';
  const headline =
    dir === 'up' ? `${M.label} grew ${signedPct(R.total.deltaPct)} to ${fmt(R.total.current)}, led by ${R.top.channel}${R.grower && R.grower.channel !== R.top.channel ? `, with ${R.grower.channel} accelerating fastest` : ''}.`
    : dir === 'down' ? `${M.label} declined ${signedPct(Math.abs(R.total.deltaPct)).replace('+','')} to ${fmt(R.total.current)}${R.decliner ? `, with ${R.decliner.channel} driving most of the drop` : ''}.`
    : `${M.label} held steady at ${fmt(R.total.current)}${R.grower ? `, with ${R.grower.channel} quietly gaining share` : ''}.`;

  // focus list — ranked, rule-based
  const focus = [];
  if (R.decliner && R.decliner.deltaPct != null && R.decliner.deltaPct < -5)
    focus.push(<><b>{R.decliner.channel}</b> is down <b>{signedPct(Math.abs(R.decliner.deltaPct)).replace('+','')}</b> vs prior ({fmt(R.decliner.value)} from {fmt(R.decliner.prevValue)}) — worth a root-cause this week: availability, pricing, or visibility.</>);
  if (R.subDown && R.subDown.deltaPct < -10)
    focus.push(<><b>{R.subDown.key}</b> sub-category is fading ({signedPct(R.subDown.deltaPct)}) while still holding {pct(R.subDown.share)} of revenue — check SKU-level within it on the Deep-Dive.</>);
  if (R.prodUp && R.prodUp.deltaPct > 25)
    focus.push(<><b>{R.prodUp.meta.product}</b> is breaking out ({signedPct(R.prodUp.deltaPct)}, now {fmt(R.prodUp.cur)}) — consider scaling inventory and ad support before momentum cools.</>);
  if (R.unmappedPct > 2)
    focus.push(<><b>{pct(R.unmappedPct)}</b> of units are unmapped SKUs contributing zero MRP — a mapper fix in <b>gs_channel_wise_mapper_updated</b> recovers reporting accuracy for free.</>);
  if (R.concentration && R.concentration.top5 > 55)
    focus.push(<>Top 5 products carry <b>{pct(R.concentration.top5, 0)}</b> of revenue{R.concentration.top1 ? <> ({R.concentration.top1.meta.product} alone at {pct(R.concentration.top1.share)})</> : null} — concentration is efficient but fragile; the movers list is where diversification candidates live.</>);
  if (R.qcShift != null && Math.abs(R.qcShift) >= 1.5)
    focus.push(<>Quick commerce share moved <b>{signedPct(R.qcShift)}</b> pts to {pct(R.qcNow.share)} of the mix — {R.qcShift > 0 ? 'rebalance inventory allocation toward dark stores if the trend holds' : 'check QC availability (OSA) before assuming demand softened'}.</>);
  if (!focus.length)
    focus.push(<>No red flags this period — channels, sub-categories, and top products are all tracking within normal bands. A good week to invest in experiments.</>);

  const chips = [
    { l: 'Revenue', v: fmt(R.total.current), d: R.total.deltaPct },
    { l: 'Units', v: countShort(R.units.current), d: R.units.deltaPct },
    { l: 'Active channels', v: String(R.channelsActive), d: null },
    R.qcNow ? { l: 'QC share', v: pct(R.qcNow.share), d: null } : null,
  ].filter(Boolean);

  return (
    <>
      <div className="wbr-hero rise">
        <div className="eyebrow">
          {seg ? seg.label : 'Business'} review · {longDate(from)} → {longDate(to)} · vs equal prior period
        </div>
        <h2>{headline}</h2>
        <div className="chips">
          {chips.map(c => (
            <div className="wbr-chip" key={c.l}>
              {c.l}: <b>{c.v}</b>{c.d != null && <span style={{ marginLeft: 6, color: c.d >= 0 ? '#5EDBB4' : '#F09A93' }}>{signedPct(c.d)}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="section rise d1"><h2>What moved</h2><span className="note">auto-generated from the period's data</span></div>
      {cubeLoading && !segCube ? <div className="skeleton sk-chart rise d1" /> : (
        <div className="insights rise d1">
          <div className="card insight good">
            <div className="glyph">↗</div>
            <div>
              <h4>Leading the period</h4>
              <p><b>{R.top.channel}</b> contributed <b>{fmt(R.top.value)}</b> ({pct(R.top.share)} of total)
                {R.top.deltaPct != null && <>, {R.top.deltaPct >= 0 ? 'up' : 'down'} {signedPct(Math.abs(R.top.deltaPct)).replace('+','')} vs prior</>}.</p>
            </div>
          </div>

          {R.grower && (
            <div className="card insight good">
              <div className="glyph">⚡</div>
              <div>
                <h4>Fastest-growing channel</h4>
                <p><b>{R.grower.channel}</b> grew <b>{signedPct(R.grower.deltaPct)}</b> to {fmt(R.grower.value)} — the steepest climb among channels above 2% share.</p>
              </div>
            </div>
          )}

          {R.subUp && (
            <div className="card insight good">
              <div className="glyph">▲</div>
              <div>
                <h4>Sub-category winner</h4>
                <p><b>{R.subUp.key}</b> is up <b>{signedPct(R.subUp.deltaPct)}</b> ({fmt(R.subUp.cur)}, {pct(R.subUp.share)} of revenue).</p>
              </div>
            </div>
          )}

          {R.prodUp && (
            <div className="card insight good">
              <div className="glyph">★</div>
              <div>
                <h4>Breakout product</h4>
                <p><b>{R.prodUp.meta.product}</b> ({R.prodUp.meta.subCategory}) jumped <b>{signedPct(R.prodUp.deltaPct)}</b> to {fmt(R.prodUp.cur)}.</p>
              </div>
            </div>
          )}

          {R.decliner && R.decliner.deltaPct != null && R.decliner.deltaPct < 0 && (
            <div className="card insight bad">
              <div className="glyph">▼</div>
              <div>
                <h4>Channel under pressure</h4>
                <p><b>{R.decliner.channel}</b> fell <b>{signedPct(Math.abs(R.decliner.deltaPct)).replace('+','')}</b> to {fmt(R.decliner.value)} — the weakest trend among meaningful channels.</p>
              </div>
            </div>
          )}

          {R.prodDown && R.prodDown.deltaPct < 0 && (
            <div className="card insight bad">
              <div className="glyph">↘</div>
              <div>
                <h4>Product losing steam</h4>
                <p><b>{R.prodDown.meta.product}</b> dropped <b>{signedPct(Math.abs(R.prodDown.deltaPct)).replace('+','')}</b> to {fmt(R.prodDown.cur)} — worth checking availability and ad spend before it compounds.</p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="section rise d2"><h2>Where to focus next</h2><span className="note">ranked by likely impact</span></div>
      <div className="card rise d2">
        {focus.map((f, i) => (
          <div className="focus-item" key={i}>
            <span className="n">{String(i + 1).padStart(2, '0')}</span>
            <p>{f}</p>
          </div>
        ))}
      </div>
    </>
  );
}
