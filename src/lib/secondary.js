// ─────────────────────────────────────────────────────────────────────────
//  secondary.js — pure derivations for the Secondary Sales tab.
//
//  These are the analytics the Hex notebook does not do. They live outside
//  the view because each one is a claim about the business that has to be
//  arithmetically right: a sign error in the mix/rate split would tell you
//  prices fell when the truth is the basket got cheaper.
// ─────────────────────────────────────────────────────────────────────────

const pctChange = (cur, prev) =>
  prev != null && prev !== 0 && cur != null ? ((cur - prev) / Math.abs(prev)) * 100 : null;

/* ── ASP: mix vs rate ───────────────────────────────────────────────────
   Average selling price can fall for two completely different reasons:
   every product got cheaper (RATE), or the basket shifted toward cheaper
   products at unchanged prices (MIX). They call for opposite responses, so
   reading a mix shift as a price cut is an expensive mistake.

   With unit share w and per-group ASP a:
     rate        = Σ w_prev  · (a_cur − a_prev)      prices moved
     mix         = Σ (w_cur − w_prev) ·  a_prev      basket moved
     interaction = Σ (w_cur − w_prev) · (a_cur − a_prev)
   and prevASP + rate + mix + interaction = curASP, exactly.

   Interaction is reported rather than folded into mix: it is the part that
   genuinely cannot be attributed to one or the other, and hiding it inside
   mix would overstate a basket effect that is really joint.
   ─────────────────────────────────────────────────────────────────────── */
export function mixRateSplit(rows) {
  let curUnits = 0, prevUnits = 0, curVal = 0, prevVal = 0;
  for (const r of rows) {
    curUnits += r.cur.units || 0;
    prevUnits += r.prev.units || 0;
    curVal += r.cur.revenue || 0;
    prevVal += r.prev.revenue || 0;
  }
  if (!curUnits || !prevUnits) return null;

  const curAsp = curVal / curUnits;
  const prevAsp = prevVal / prevUnits;
  let rate = 0, mix = 0, interaction = 0;

  for (const r of rows) {
    const cu = r.cur.units || 0, pu = r.prev.units || 0;
    const wc = cu / curUnits, wp = pu / prevUnits;
    const ownCur = cu > 0 ? (r.cur.revenue || 0) / cu : null;
    const ownPrev = pu > 0 ? (r.prev.revenue || 0) / pu : null;
    // A group present on only one side has no price on the other, so it
    // cannot have had a price MOVE. Mirroring its own price across the gap
    // (rather than substituting the period average) sends its whole effect
    // to MIX, where a launch or a delist belongs, and leaves rate and
    // interaction at zero for it. The identity still closes exactly: its
    // contribution wc·a is precisely its share of the ASP change.
    const ac = ownCur ?? ownPrev ?? curAsp;
    const ap = ownPrev ?? ownCur ?? prevAsp;
    rate += wp * (ac - ap);
    mix += (wc - wp) * ap;
    interaction += (wc - wp) * (ac - ap);
  }

  return {
    prevAsp, curAsp,
    delta: curAsp - prevAsp,
    rate, mix, interaction,
    // Residual should be ~0; surfaced so a future refactor cannot break the
    // identity silently.
    residual: (curAsp - prevAsp) - (rate + mix + interaction),
  };
}

/* ── price / volume ──────────────────────────────────────────────────────
   Does discounting actually buy volume? Two readings, because they answer
   different questions and can disagree:

   · `fit` — an ordinary least-squares line through the daily (discount %,
     units) points, with Pearson r. This is a within-window association: on
     the days we discounted harder, did more units move?

   · `elasticity` — arc elasticity between the two period means,
     %Δunits / %ΔASP. Negative is the textbook expectation (cheaper → more).
     A POSITIVE value means units fell even as price fell, which no discount
     can explain and points at demand, stock or mix instead.

   Elasticity is withheld when %ΔASP is under 0.5%, because dividing by a
   near-zero denominator manufactures huge numbers from noise.
   ─────────────────────────────────────────────────────────────────────── */
export function priceVolume(daily, totals) {
  const points = (daily || [])
    .filter(d => d.units > 0 && d.discountPct != null && isFinite(d.discountPct))
    .map(d => ({ key: d.key, x: d.discountPct, y: d.units, asp: d.asp }));

  let fit = null;
  if (points.length >= 4) {
    const n = points.length;
    const mx = points.reduce((s, p) => s + p.x, 0) / n;
    const my = points.reduce((s, p) => s + p.y, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const p of points) {
      sxy += (p.x - mx) * (p.y - my);
      sxx += (p.x - mx) ** 2;
      syy += (p.y - my) ** 2;
    }
    if (sxx > 0 && syy > 0) {
      const slope = sxy / sxx;
      fit = {
        slope,                            // units per extra discount point
        intercept: my - slope * mx,
        r: sxy / Math.sqrt(sxx * syy),
        n,
        xMin: Math.min(...points.map(p => p.x)),
        xMax: Math.max(...points.map(p => p.x)),
      };
    }
  }

  let elasticity = null;
  if (totals && totals.cur && totals.prev) {
    const dAsp = pctChange(totals.cur.asp, totals.prev.asp);
    const dUnits = pctChange(totals.cur.units, totals.prev.units);
    if (dAsp != null && dUnits != null && Math.abs(dAsp) >= 0.5) {
      elasticity = { value: dUnits / dAsp, dAsp, dUnits };
    }
  }

  return { points, fit, elasticity };
}

/* ── day-of-week rhythm ─────────────────────────────────────────────────
   Derived from the daily series rather than a separate query. Promo cycles
   are weekly, so a weekend discount spike is a plan, not an anomaly — and
   an average that ignores the cycle reads it as noise. */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function dowProfile(daily) {
  const buckets = DOW.map(d => ({ dow: d, days: 0, units: 0, revenue: 0, mrpValue: 0 }));
  for (const d of daily || []) {
    const t = Date.parse(d.key + 'T00:00:00');
    if (!isFinite(t)) continue;
    const b = buckets[new Date(t).getDay()];
    b.days += 1;
    b.units += d.units || 0;
    b.revenue += d.revenue || 0;
    b.mrpValue += d.mrpValue || 0;
  }
  return buckets
    .filter(b => b.days > 0)
    .map(b => ({
      dow: b.dow,
      days: b.days,
      avgUnits: b.units / b.days,
      asp: b.units > 0 ? b.revenue / b.units : null,
      discountPct: b.mrpValue > 0 ? ((b.mrpValue - b.revenue) / b.mrpValue) * 100 : null,
    }));
}

/* ── discount-band mix ──────────────────────────────────────────────────
   Converts per-day unit counts by band into per-day SHARES. The average
   discount hides the distribution: 30% average could be everything at 30,
   or half at zero and half at 60 — a uniform markdown and a deep clearance
   look identical in the mean and are nothing alike in practice. */
export function bandShares(bands, bandOrder) {
  return (bands || []).map(row => {
    const out = { key: row.key, total: row.total || 0 };
    for (const b of bandOrder) {
      out[b] = row.total > 0 ? ((row[b] || 0) / row.total) * 100 : 0;
    }
    return out;
  });
}

/* Weighted mean band share across the whole window — the headline split. */
export function bandTotals(bands, bandOrder) {
  const sums = Object.fromEntries(bandOrder.map(b => [b, 0]));
  let total = 0;
  for (const row of bands || []) {
    for (const b of bandOrder) sums[b] += row[b] || 0;
    total += row.total || 0;
  }
  return bandOrder.map(b => ({
    band: b,
    units: sums[b],
    share: total > 0 ? (sums[b] / total) * 100 : 0,
  }));
}

/* ── movers ─────────────────────────────────────────────────────────────
   Ranked by how far a row's discount moved, in percentage POINTS, with a
   volume floor. Without the floor the list fills with SKUs that sold four
   units and swung 40 points — arithmetically true, commercially noise. */
export function discountMovers(rows, { minUnits = 500, limit = 8 } = {}) {
  const eligible = (rows || []).filter(r =>
    r.cur.units >= minUnits && r.prev.units >= minUnits &&
    r.cur.discountPct != null && r.prev.discountPct != null);
  const withDelta = eligible.map(r => ({
    ...r,
    discountDelta: r.cur.discountPct - r.prev.discountPct,
    aspDelta: pctChange(r.cur.asp, r.prev.asp),
    unitsDelta: pctChange(r.cur.units, r.prev.units),
  }));
  return {
    deeper: [...withDelta].sort((a, b) => b.discountDelta - a.discountDelta).slice(0, limit),
    shallower: [...withDelta].sort((a, b) => a.discountDelta - b.discountDelta).slice(0, limit),
  };
}

/* Rows whose discount deepened AND whose units still fell — the pattern
   worth a second look, since the markdown bought nothing. */
export function ineffectiveDiscounts(rows, { minUnits = 500, limit = 6 } = {}) {
  return (rows || [])
    .filter(r => r.cur.units >= minUnits && r.prev.units >= minUnits &&
      r.cur.discountPct != null && r.prev.discountPct != null &&
      r.cur.discountPct - r.prev.discountPct > 1 &&
      r.cur.units < r.prev.units)
    .map(r => ({
      ...r,
      discountDelta: r.cur.discountPct - r.prev.discountPct,
      unitsDelta: pctChange(r.cur.units, r.prev.units),
    }))
    .sort((a, b) => (b.discountDelta - b.unitsDelta) - (a.discountDelta - a.unitsDelta))
    .slice(0, limit);
}

export { pctChange };
