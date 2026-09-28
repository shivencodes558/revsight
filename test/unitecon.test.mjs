import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitEconomics, estimatePL } from '../src/lib/pl.js';

// Cost lines are stored NEGATIVE in the P&L (they are deductions), which is
// the detail unitEconomics has to get right — a sign slip would subtract a
// cost twice or add it back.
const mk = (over = {}) => ({
  netRevenue: { value: 1000, kind: 'actual' },
  cogs: { value: -250, kind: 'estimated' },
  b2cComm: { value: -100, kind: 'estimated' },
  websiteExp: { value: -20, kind: 'estimated' },
  b2bSecDisc: { value: -10, kind: 'estimated' },
  freightForward: { value: -60, kind: 'estimated' },
  warehousing: { value: -25, kind: 'estimated' },
  tertiaryPackaging: { value: -15, kind: 'estimated' },
  perfMkt: { value: -200, kind: 'actual' },
  retentionMkt: { value: -20, kind: 'estimated' },
  brandMkt: { value: -180, kind: 'estimated' },
  freebiesGWP: { value: -20, kind: 'estimated' },
  fixedOpex: { value: null, kind: 'unavailable' },
  cm3: { value: 100, kind: 'estimated' },
  ...over,
});

test('groups the tracker lines into economic buckets', () => {
  const u = unitEconomics(mk());
  assert.deepEqual(u.groups.map(g => g.key), ['cogs', 'platform', 'fulfil', 'perf', 'brand']);
  const by = Object.fromEntries(u.groups.map(g => [g.key, g.value]));
  assert.equal(by.cogs, 250);
  assert.equal(by.platform, 130);   // 100 + 20 + 10
  assert.equal(by.fulfil, 100);     // 60 + 25 + 15
  assert.equal(by.perf, 220);       // 200 + 20
  assert.equal(by.brand, 200);      // 180 + 20
});

test('costs are magnitudes, never negative', () => {
  const u = unitEconomics(mk());
  for (const g of u.groups) assert.ok(g.value > 0, `${g.key} should be positive, got ${g.value}`);
});

test('slices plus margin sum to exactly 100% of net revenue', () => {
  const u = unitEconomics(mk());
  const sum = u.groups.reduce((a, g) => a + g.pct, 0) + u.marginPct;
  assert.ok(Math.abs(sum - 100) < 1e-9, `slices summed to ${sum}`);
  assert.equal(u.totalCost + u.margin, u.net);
});

test('residual reconciles the pie against the P&L\'s own CM3', () => {
  // The guarantee that matters: the chart cannot drift from the statement.
  const u = unitEconomics(mk());
  assert.ok(Math.abs(u.residual) < 1e-9, `residual ${u.residual}`);
  assert.equal(u.margin, 100);
});

test('without overheads the residual is CM3, NOT net profit', () => {
  const u = unitEconomics(mk());
  assert.equal(u.hasOpex, false);
  assert.equal(u.marginLabel, 'Contribution margin 3');
});

test('with overheads it becomes net margin and opex joins the slices', () => {
  const u = unitEconomics(mk({ fixedOpex: { value: -50, kind: 'user' } }));
  assert.ok(u.groups.some(g => g.key === 'opex' && g.value === 50));
  assert.equal(u.hasOpex, true);
  assert.equal(u.marginLabel, 'Net margin');
  assert.equal(u.margin, 50);        // 100 CM3 − 50 opex
  const sum = u.groups.reduce((a, g) => a + g.pct, 0) + u.marginPct;
  assert.ok(Math.abs(sum - 100) < 1e-9);
});

test('flags a loss-making window instead of drawing a negative slice', () => {
  // Costs above 100% of revenue: a pie cannot render that, so the caller
  // needs to know rather than being handed a broken wedge.
  const u = unitEconomics(mk({ brandMkt: { value: -400, kind: 'estimated' } }));
  assert.equal(u.profitable, false);
  assert.ok(u.margin < 0);
  assert.ok(u.costPct > 100);
});

test('marks a group actual only when EVERY line in it is actual', () => {
  const u = unitEconomics(mk());
  // perfMkt is actual but retentionMkt is estimated ⇒ the bucket is not actual
  assert.equal(u.groups.find(g => g.key === 'perf').actual, false);
  const solo = unitEconomics(mk({ retentionMkt: { value: null, kind: 'unavailable' } }));
  assert.equal(solo.groups.find(g => g.key === 'perf').actual, true);
});

test('returns null when there is no net-revenue base to share out', () => {
  assert.equal(unitEconomics(mk({ netRevenue: { value: 0 } })), null);
  assert.equal(unitEconomics(mk({ netRevenue: { value: -5 } })), null);
  assert.equal(unitEconomics(null), null);
  assert.equal(unitEconomics({}), null);
});

test('skips lines that are absent rather than counting them as zero cost', () => {
  const u = unitEconomics(mk({
    websiteExp: { value: null, kind: 'unavailable' },
    b2bSecDisc: { value: null, kind: 'unavailable' },
  }));
  assert.equal(u.groups.find(g => g.key === 'platform').value, 100);
  const sum = u.groups.reduce((a, g) => a + g.pct, 0) + u.marginPct;
  assert.ok(Math.abs(sum - 100) < 1e-9);
});

test('per-unit and per-order helpers only exist when a denominator does', () => {
  const none = unitEconomics(mk());
  assert.equal(none.perUnit, null);
  assert.equal(none.perOrder, null);
  const withDen = unitEconomics(mk(), { units: 100, orders: 40 });
  assert.equal(withDen.perUnit(250), 2.5);
  assert.equal(withDen.perOrder(200), 5);
  assert.equal(unitEconomics(mk(), { units: 0 }).perUnit, null);
});

test('reconciles against a real estimatePL run, not just fixtures', () => {
  const P = estimatePL({ grossMrp: 2e7, netSp: 1.2e7, baseKey: 'july' });
  const u = unitEconomics(P.lines);
  assert.ok(u, 'should build from a real P&L');
  const sum = u.groups.reduce((a, g) => a + g.pct, 0) + u.marginPct;
  assert.ok(Math.abs(sum - 100) < 1e-6, `real P&L slices summed to ${sum}`);
  assert.ok(Math.abs(u.residual) < 1, `real P&L residual ${u.residual}`);
  assert.ok(Math.abs(u.margin - P.lines.cm3.value) < 1,
    `margin ${u.margin} should equal CM3 ${P.lines.cm3.value}`);
});
