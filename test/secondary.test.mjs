import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mixRateSplit, priceVolume, dowProfile, bandShares, bandTotals,
  discountMovers, ineffectiveDiscounts,
} from '../src/lib/secondary.js';

const grp = (cu, cAsp, pu, pAsp, extra = {}) => ({
  cur: { units: cu, revenue: cu * cAsp, discountPct: extra.cd ?? null, asp: cAsp },
  prev: { units: pu, revenue: pu * pAsp, discountPct: extra.pd ?? null, asp: pAsp },
  ...extra,
});

test('mixRateSplit: pure rate move — prices fall, basket unchanged', () => {
  // Both groups halve in price; shares stay 50/50. All rate, no mix.
  const s = mixRateSplit([grp(100, 50, 100, 100), grp(100, 150, 100, 300)]);
  assert.equal(Math.round(s.prevAsp), 200);
  assert.equal(Math.round(s.curAsp), 100);
  assert.ok(Math.abs(s.mix) < 1e-9, `mix should be 0, got ${s.mix}`);
  assert.ok(Math.abs(s.interaction) < 1e-9);
  assert.ok(Math.abs(s.rate - -100) < 1e-9);
});

test('mixRateSplit: pure mix move — prices unchanged, basket shifts cheap', () => {
  // Prices identical on both sides; volume moves from the ₹300 line to ₹100.
  const s = mixRateSplit([grp(150, 100, 50, 100), grp(50, 300, 150, 300)]);
  assert.ok(Math.abs(s.rate) < 1e-9, `rate should be 0, got ${s.rate}`);
  assert.ok(Math.abs(s.interaction) < 1e-9);
  assert.ok(s.mix < 0, 'shifting to the cheaper line must lower ASP via mix');
  assert.ok(Math.abs(s.delta - s.mix) < 1e-9);
});

test('mixRateSplit: identity holds — prev + rate + mix + interaction = cur', () => {
  // Messy case: both prices and shares move, in opposite directions.
  const s = mixRateSplit([grp(300, 120, 100, 100), grp(80, 260, 220, 300), grp(40, 75, 60, 90)]);
  assert.ok(Math.abs(s.residual) < 1e-9, `residual ${s.residual} must vanish`);
  assert.ok(Math.abs((s.prevAsp + s.rate + s.mix + s.interaction) - s.curAsp) < 1e-9);
});

test('mixRateSplit: a group that only exists now lands in mix, not rate', () => {
  // The new line has no prior price, so calling it a price MOVE would be a
  // fabrication — it is a basket change. Incumbent unchanged at ₹100, new
  // line 50 units at ₹400 ⇒ ASP 100 → 200, all of it mix.
  const s = mixRateSplit([grp(100, 100, 100, 100), grp(50, 400, 0, 0)]);
  assert.ok(Math.abs(s.residual) < 1e-9);
  assert.ok(Math.abs(s.rate) < 1e-9, `no existing price moved, got rate ${s.rate}`);
  assert.ok(Math.abs(s.interaction) < 1e-9, `should not leak into interaction, got ${s.interaction}`);
  assert.ok(Math.abs(s.mix - 100) < 1e-9, `whole ₹100 lift is mix, got ${s.mix}`);
});

test('mixRateSplit: a delisted group leaves through mix too', () => {
  // Mirror image: the ₹400 line stops selling, so ASP falls back to ₹100.
  const s = mixRateSplit([grp(100, 100, 100, 100), grp(0, 0, 50, 400)]);
  assert.ok(Math.abs(s.residual) < 1e-9);
  assert.ok(Math.abs(s.rate) < 1e-9);
  assert.ok(s.mix < 0, 'losing a premium line lowers ASP via mix');
  assert.ok(Math.abs(s.delta - s.mix) < 1e-9);
});

test('mixRateSplit: returns null when a side is empty', () => {
  assert.equal(mixRateSplit([grp(0, 0, 0, 0)]), null);
  assert.equal(mixRateSplit([]), null);
});

test('priceVolume: fit recovers a known positive slope', () => {
  // units = 1000 + 100 × discount, exactly.
  const daily = [10, 20, 30, 40, 50].map(d => ({ key: '2026-08-0' + (d / 10), discountPct: d, units: 1000 + 100 * d, asp: 300 - d }));
  const { fit } = priceVolume(daily, null);
  assert.ok(Math.abs(fit.slope - 100) < 1e-6, `slope ${fit.slope}`);
  assert.ok(Math.abs(fit.r - 1) < 1e-9, 'perfect line ⇒ r = 1');
  assert.equal(fit.n, 5);
});

test('priceVolume: elasticity is negative when cheaper sells more', () => {
  const totals = { cur: { asp: 90, units: 120 }, prev: { asp: 100, units: 100 } };
  const { elasticity } = priceVolume([], totals);
  // −10% price, +20% units ⇒ −2
  assert.ok(Math.abs(elasticity.value - -2) < 1e-9, `got ${elasticity.value}`);
});

test('priceVolume: elasticity is POSITIVE when price and units fall together', () => {
  // The pathological case worth flagging: discounting did not buy volume.
  const totals = { cur: { asp: 90, units: 80 }, prev: { asp: 100, units: 100 } };
  const { elasticity } = priceVolume([], totals);
  assert.ok(elasticity.value > 0, 'both falling ⇒ positive, i.e. not a price story');
});

test('priceVolume: withholds elasticity when the price barely moved', () => {
  // 0.1% ASP move would divide by near-zero and invent a huge number.
  const totals = { cur: { asp: 100.1, units: 140 }, prev: { asp: 100, units: 100 } };
  assert.equal(priceVolume([], totals).elasticity, null);
});

test('priceVolume: too few points ⇒ no fit, no crash', () => {
  const r = priceVolume([{ key: '2026-08-01', discountPct: 10, units: 5 }], null);
  assert.equal(r.fit, null);
  assert.equal(r.points.length, 1);
});

test('dowProfile: buckets by weekday and averages per occurrence', () => {
  // 2026-08-01 is a Saturday; +7 days is the next Saturday.
  const daily = [
    { key: '2026-08-01', units: 100, revenue: 30000, mrpValue: 40000 },
    { key: '2026-08-08', units: 200, revenue: 60000, mrpValue: 80000 },
    { key: '2026-08-03', units: 50, revenue: 20000, mrpValue: 22000 },
  ];
  const p = dowProfile(daily);
  const sat = p.find(x => x.dow === 'Sat');
  assert.equal(sat.days, 2);
  assert.equal(sat.avgUnits, 150);
  assert.equal(sat.discountPct, 25);          // (120000-90000)/120000
  const mon = p.find(x => x.dow === 'Mon');
  assert.equal(mon.days, 1);
  assert.equal(mon.avgUnits, 50);
});

test('bandShares: each day sums to 100%', () => {
  const order = ['0%', '10-20%', '50%+'];
  const rows = [{ key: '2026-08-01', total: 200, '0%': 50, '10-20%': 100, '50%+': 50 }];
  const s = bandShares(rows, order);
  assert.equal(s[0]['0%'], 25);
  assert.equal(s[0]['10-20%'], 50);
  assert.ok(Math.abs(order.reduce((a, b) => a + s[0][b], 0) - 100) < 1e-9);
});

test('bandShares: a zero-unit day yields zeros, not NaN', () => {
  const order = ['0%', '50%+'];
  const s = bandShares([{ key: 'd', total: 0, '0%': 0, '50%+': 0 }], order);
  assert.equal(s[0]['0%'], 0);
  assert.ok(!Number.isNaN(s[0]['50%+']));
});

test('bandTotals: aggregates across days and shares sum to 100', () => {
  const order = ['0%', '50%+'];
  const rows = [
    { key: 'a', total: 100, '0%': 80, '50%+': 20 },
    { key: 'b', total: 100, '0%': 20, '50%+': 80 },
  ];
  const t = bandTotals(rows, order);
  assert.equal(t.find(x => x.band === '0%').units, 100);
  assert.ok(Math.abs(t.reduce((a, b) => a + b.share, 0) - 100) < 1e-9);
});

test('discountMovers: enforces the volume floor on BOTH periods', () => {
  const rows = [
    { key: 'big', cur: { units: 5000, discountPct: 40, asp: 100 }, prev: { units: 5000, discountPct: 10, asp: 150 } },
    { key: 'tiny', cur: { units: 4, discountPct: 90, asp: 10 }, prev: { units: 3, discountPct: 0, asp: 100 } },
    { key: 'new', cur: { units: 9000, discountPct: 50, asp: 90 }, prev: { units: 2, discountPct: 5, asp: 200 } },
  ];
  const { deeper } = discountMovers(rows, { minUnits: 500, limit: 5 });
  assert.deepEqual(deeper.map(r => r.key), ['big']);
  assert.equal(deeper[0].discountDelta, 30);
});

test('discountMovers: shallower is the opposite end, not a reversed slice', () => {
  const rows = [
    { key: 'up', cur: { units: 1000, discountPct: 30, asp: 100 }, prev: { units: 1000, discountPct: 10, asp: 120 } },
    { key: 'down', cur: { units: 1000, discountPct: 5, asp: 140 }, prev: { units: 1000, discountPct: 25, asp: 110 } },
  ];
  const m = discountMovers(rows, { minUnits: 100, limit: 1 });
  assert.equal(m.deeper[0].key, 'up');
  assert.equal(m.shallower[0].key, 'down');
});

test('ineffectiveDiscounts: only rows where deeper discount lost volume', () => {
  const rows = [
    // deeper AND fewer units — the case we want
    { key: 'bad', cur: { units: 800, discountPct: 35 }, prev: { units: 1200, discountPct: 15 } },
    // deeper and MORE units — working as intended, excluded
    { key: 'good', cur: { units: 2000, discountPct: 35 }, prev: { units: 1200, discountPct: 15 } },
    // fewer units but discount unchanged — not a discount story, excluded
    { key: 'flat', cur: { units: 800, discountPct: 15.2 }, prev: { units: 1200, discountPct: 15 } },
  ];
  const out = ineffectiveDiscounts(rows, { minUnits: 100 });
  assert.deepEqual(out.map(r => r.key), ['bad']);
  assert.ok(out[0].unitsDelta < 0);
});
