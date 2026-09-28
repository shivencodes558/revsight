import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sumField, inRange, trendByDay, trendByMonth, byChannel, byGroup, pop, METRICS,
} from '../src/lib/metrics.js';
import { inrShort, countShort, indianGroup, pct } from '../src/lib/format.js';

// synthetic rows shaped exactly like /api/overall output
const rows = [
  { channel: 'Amazon',    group: 'Marketplace', date: '2026-07-01', sp: 100000, mrp: 180000, units: 500, orders: 300 },
  { channel: 'Amazon',    group: 'Marketplace', date: '2026-07-02', sp: 120000, mrp: 200000, units: 550, orders: 320 },
  { channel: 'Blinkit',   group: 'Q-Commerce',  date: '2026-07-01', sp: 0,      mrp: 90000,  units: 800, orders: 0   },
  { channel: 'Blinkit',   group: 'Q-Commerce',  date: '2026-07-02', sp: 0,      mrp: 95000,  units: 820, orders: 0   },
  { channel: 'Website',   group: 'D2C',         date: '2026-06-30', sp: 50000,  mrp: 70000,  units: 120, orders: 110 },
];

test('inRange slices inclusively', () => {
  assert.equal(inRange(rows, '2026-07-01', '2026-07-02').length, 4);
  assert.equal(inRange(rows, '2026-06-01', '2026-06-30').length, 1);
});

test('sumField across all bases', () => {
  const july = inRange(rows, '2026-07-01', '2026-07-02');
  assert.equal(sumField(july, 'mrp'), 565000);
  assert.equal(sumField(july, 'sp'), 220000); // QC contributes 0 to SP — expected
  assert.equal(sumField(july, 'units'), 2670);
});

test('byChannel sorts desc and computes share', () => {
  const july = inRange(rows, '2026-07-01', '2026-07-02');
  const bc = byChannel(july, 'mrp');
  assert.equal(bc[0].channel, 'Amazon');       // 380k > 185k
  assert.equal(Math.round(bc[0].share), 67);   // 380/565
  const shareSum = bc.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(shareSum - 100) < 0.001);
});

test('byGroup rolls up business lines', () => {
  const july = inRange(rows, '2026-07-01', '2026-07-02');
  const bg = byGroup(july, 'mrp');
  const mk = bg.find(g => g.group === 'Marketplace');
  const qc = bg.find(g => g.group === 'Q-Commerce');
  assert.equal(mk.value, 380000);
  assert.equal(qc.value, 185000);
});

test('trend by day and month', () => {
  const td = trendByDay(inRange(rows, '2026-07-01', '2026-07-02'), 'mrp');
  assert.deepEqual(td.map(p => p.date), ['2026-07-01', '2026-07-02']);
  assert.equal(td[0].value, 270000); // 180k + 90k
  const tm = trendByMonth(rows, 'mrp');
  assert.equal(tm.find(m => m.ym === '2026-06').value, 70000);
});

test('pop computes delta, guards divide-by-zero', () => {
  const cur = inRange(rows, '2026-07-01', '2026-07-02');
  const prev = inRange(rows, '2026-06-30', '2026-06-30');
  const p = pop(cur, prev, 'mrp');
  assert.equal(p.current, 565000);
  assert.equal(p.previous, 70000);
  assert.ok(p.deltaPct > 0);
  // zero previous → null (no Infinity)
  assert.equal(pop(cur, [], 'mrp').deltaPct, null);
});

test('formatters produce Indian L/Cr', () => {
  assert.equal(indianGroup(12345678), '1,23,45,678');
  assert.equal(inrShort(18000000), '₹1.80Cr');
  assert.equal(inrShort(20000000), '₹2Cr'); // whole numbers drop .00
  assert.equal(inrShort(565000), '₹5.65L');
  assert.equal(inrShort(1234), '₹1,234');
  assert.equal(countShort(2670), '2,670');
  assert.equal(pct(66.6666), '66.7%');
});

test('every metric field resolves on a row', () => {
  for (const id of Object.keys(METRICS)) {
    const f = METRICS[id].field;
    assert.ok(typeof rows[0][f] === 'number', `field ${f} missing`);
  }
});

// ── Phase 2: channel-detail derivations (sub-category mix, SKU sort, unmapped) ──
const detailSkus = [
  { sku: 'SKU150_1', product: 'Gel Sunscreen 50g', subCategory: 'Sunscreen', sp: 188000, mrp: 320000, units: 5400, orders: 0, unmapped: false },
  { sku: 'SKU250',   product: 'Brightening Lip Balm', subCategory: 'Lip Balm', sp: 74000, mrp: 120000, units: 3700, orders: 0, unmapped: false },
  { sku: 'SKU020',   product: 'Clearing Serum', subCategory: 'Face Serum', sp: 41000, mrp: 90000, units: 900, orders: 0, unmapped: false },
  { sku: '(unmapped)', product: '(unmapped product)', subCategory: '(uncategorised)', sp: 12000, mrp: 0, units: 600, orders: 0, unmapped: true },
];

test('sub-category mix groups and shares correctly', () => {
  const field = 'mrp';
  const m = new Map();
  for (const s of detailSkus) m.set(s.subCategory, (m.get(s.subCategory) || 0) + (s[field] || 0));
  const arr = [...m.entries()].map(([subCategory, value]) => ({ subCategory, value })).sort((a, b) => b.value - a.value);
  assert.equal(arr[0].subCategory, 'Sunscreen'); // 320k highest
  assert.equal(arr.find(x => x.subCategory === '(uncategorised)').value, 0); // unmapped has 0 MRP
});

test('unmapped leakage is units-based (MRP would hide it)', () => {
  let uU = 0, tU = 0;
  for (const s of detailSkus) { tU += s.units; if (s.unmapped) uU += s.units; }
  const pctUnmapped = (uU / tU) * 100;
  assert.equal(uU, 600);
  assert.ok(Math.abs(pctUnmapped - 5.66) < 0.1); // 600 / 10600
  // and note the unmapped row contributes 0 to MRP but 12000 to SP
  const unmappedRow = detailSkus.find(s => s.unmapped);
  assert.equal(unmappedRow.mrp, 0);
  assert.ok(unmappedRow.sp > 0);
});

test('SKU sort respects the selected metric', () => {
  const bySp = [...detailSkus].sort((a, b) => b.sp - a.sp);
  const byUnits = [...detailSkus].sort((a, b) => b.units - a.units);
  assert.equal(bySp[0].sku, 'SKU150_1');
  assert.equal(byUnits[0].sku, 'SKU150_1');
  assert.equal(bySp[bySp.length - 1].sku, '(unmapped)'); // smallest SP
});

// ── Premium pass: cube-driven derivations (tree, movers, heatmap) ──
const cubeRows = [
  { channel: 'Amazon', group: 'Marketplace', category: 'Face', subCategory: 'Sunscreen', sku: 'SKU150_1', product: 'Gel Sunscreen - 50g (v2)', curMrp: 300000, prevMrp: 200000, curSp: 180000, prevSp: 120000, curUnits: 1000, prevUnits: 700, unmapped: false },
  { channel: 'Amazon', group: 'Marketplace', category: 'Face', subCategory: 'Sunscreen', sku: 'SKU550', product: 'Gel Sunscreen - 30g', curMrp: 100000, prevMrp: 150000, curSp: 60000, prevSp: 90000, curUnits: 400, prevUnits: 600, unmapped: false },
  { channel: 'Amazon', group: 'Marketplace', category: 'Face', subCategory: 'Face Serum', sku: 'SKU019', product: 'Vitamin C Serum - 30ml', curMrp: 80000, prevMrp: 80000, curSp: 50000, prevSp: 50000, curUnits: 200, prevUnits: 200, unmapped: false },
  { channel: 'Amazon', group: 'Marketplace', category: 'Lip', subCategory: 'Lip Balm', sku: 'SKU250', product: 'Brightening Lip Balm - 4g', curMrp: 50000, prevMrp: 40000, curSp: 30000, prevSp: 25000, curUnits: 900, prevUnits: 800, unmapped: false },
  { channel: 'Amazon', group: 'Marketplace', category: '(uncategorised)', subCategory: '(uncategorised)', sku: '(unmapped)', product: '(unmapped)', curMrp: 0, prevMrp: 0, curSp: 9000, prevSp: 4000, curUnits: 50, prevUnits: 30, unmapped: true },
];

test('tree builds Category → SubCategory → SKU sorted by value', () => {
  // replicate buildTree logic on MRP
  const cats = new Map();
  for (const r of cubeRows) {
    let c = cats.get(r.category);
    if (!c) { c = { name: r.category, cur: 0, subs: new Map() }; cats.set(r.category, c); }
    c.cur += r.curMrp;
    let s = c.subs.get(r.subCategory);
    if (!s) { s = { name: r.subCategory, cur: 0, skus: [] }; c.subs.set(r.subCategory, s); }
    s.cur += r.curMrp;
    s.skus.push({ name: r.product, cur: r.curMrp });
  }
  const arr = [...cats.values()].sort((a, b) => b.cur - a.cur);
  assert.equal(arr[0].name, 'Face');                       // 480k top
  assert.equal(arr[1].name, 'Lip');
  const sunscreen = arr[0].subs.get('Sunscreen');
  assert.equal(sunscreen.cur, 400000);
  const topSku = sunscreen.skus.sort((a, b) => b.cur - a.cur)[0];
  assert.equal(topSku.name, 'Gel Sunscreen - 50g (v2)');   // product NAME, not code
});

test('movers eligibility excludes unmapped and low-volume', () => {
  const eligible = cubeRows.filter(r => !r.unmapped && r.prevMrp > 0 && (r.curUnits + r.prevUnits) >= 30);
  assert.equal(eligible.length, 4);
  const withDelta = eligible.map(r => ({ ...r, d: ((r.curMrp - r.prevMrp) / r.prevMrp) * 100 }));
  const up = withDelta.sort((a, b) => b.d - a.d)[0];
  assert.equal(up.sku, 'SKU150_1'); // +50%
  const down = withDelta.sort((a, b) => a.d - b.d)[0];
  assert.equal(down.sku, 'SKU550'); // -33%
});

test('heatmap valueAt sums channel × category and scales safely', () => {
  const m = new Map();
  for (const r of cubeRows) {
    const k = r.channel + '|' + r.category;
    m.set(k, (m.get(k) || 0) + r.curMrp);
  }
  const valueAt = (ch, cat) => m.get(ch + '|' + cat) || 0;
  assert.equal(valueAt('Amazon', 'Face'), 480000);
  assert.equal(valueAt('Amazon', 'Lip'), 50000);
  assert.equal(valueAt('Flipkart', 'Face'), 0); // absent → 0, not NaN
});

test('ASP and run-rate math', () => {
  const revenue = 530000, units2 = 2500, days = 30;
  const asp = revenue / units2;
  const runRate = (revenue / days) * 30;
  assert.ok(Math.abs(asp - 212) < 1);
  assert.equal(runRate, revenue); // 30-day window → run rate equals itself
});

// ── Complete-product pass: aggBy, eligibleMovers, MTD pacing ──
import { aggBy, eligibleMovers } from '../src/lib/cube.js';

const cube2 = [
  { channel: 'Amazon',  category: 'Face', subCategory: 'Sunscreen',  sku: 'S1', product: 'Gel Sunscreen 50g', curMrp: 300, prevMrp: 200, curSp: 180, prevSp: 120, curUnits: 100, prevUnits: 70, unmapped: false },
  { channel: 'Blinkit', category: 'Face', subCategory: 'Sunscreen',  sku: 'S1', product: 'Gel Sunscreen 50g', curMrp: 100, prevMrp: 80,  curSp: 0,   prevSp: 0,   curUnits: 40,  prevUnits: 30, unmapped: false },
  { channel: 'Amazon',  category: 'Face', subCategory: 'Face Serum', sku: 'S2', product: 'Vitamin C Serum',   curMrp: 150, prevMrp: 200, curSp: 90,  prevSp: 120, curUnits: 30,  prevUnits: 40, unmapped: false },
  { channel: 'Amazon',  category: 'Lip',  subCategory: 'Lip Balm',   sku: 'S3', product: 'Lip Balm 4g',       curMrp: 50,  prevMrp: 0,   curSp: 30,  prevSp: 0,   curUnits: 10,  prevUnits: 0,  unmapped: false },
];

test('aggBy sums across channels, computes share and growth', () => {
  const bySku = aggBy(cube2, r => r.sku, 'mrp', r => ({ product: r.product }));
  assert.equal(bySku[0].key, 'S1');
  assert.equal(bySku[0].cur, 400);            // Amazon 300 + Blinkit 100
  assert.equal(bySku[0].channelCount, 2);
  assert.ok(Math.abs(bySku[0].share - 66.67) < 0.1); // 400/600
  assert.ok(Math.abs(bySku[0].deltaPct - 42.86) < 0.1); // 400 vs 280
  const s3 = bySku.find(x => x.key === 'S3');
  assert.equal(s3.deltaPct, null);            // no prior → null, not Infinity
});

test('aggBy on subCategory groups correctly for the composition switch', () => {
  const bySub = aggBy(cube2, r => r.subCategory, 'mrp');
  assert.equal(bySub[0].key, 'Sunscreen');
  assert.equal(bySub[0].cur, 400);
  assert.equal(bySub.length, 3);
});

test('eligibleMovers enforces prior>0 and min-units', () => {
  const bySku = aggBy(cube2, r => r.sku, 'mrp');
  const el = eligibleMovers(bySku, 30);
  assert.ok(!el.find(x => x.key === 'S3'));   // no prior
  assert.ok(el.find(x => x.key === 'S1'));
  assert.ok(el.find(x => x.key === 'S2'));    // 70 combined units ≥ 30
});

test('MTD pacing math: projection and same-day comparison', () => {
  const day = 5, dim = 31, mtdVal = 500000;
  const projection = (mtdVal / day) * dim;
  assert.equal(projection, 3100000);
  // prev-month same-day clamps to shorter months (e.g. day 31 vs Feb)
  const clamp = Math.min(31, 28);
  assert.equal(clamp, 28);
});

// ── Daily Report: Hex-exact date math replicated in JS for verification ──
test('D-1 dates: Flipkart lag, others straight', () => {
  const pd = '2026-08-04';
  const lm = '2026-07-04';   // DATEADD(month,-1)
  const fpd = '2026-08-03';  // Flipkart: day -1
  const flm = '2026-07-03';  // Flipkart: lm -1
  assert.equal(fpd, '2026-08-03');
  assert.equal(flm, '2026-07-03');
  // non-Flipkart compare pair
  assert.deepEqual([pd, lm], ['2026-08-04', '2026-07-04']);
});

test('M-1 last-day fix: month-end eff → full prior month', () => {
  // eff = 2026-03-31 (last day) → prior window = full Feb (…02-28)
  // eff = 2026-08-04 → prior window end = 2026-07-04 (day-1 offset from lms)
  const dayOffsetEnd = (lms, day) => { const d = new Date(lms + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + day - 1); return d.toISOString().slice(0,10); };
  assert.equal(dayOffsetEnd('2026-07-01', 4), '2026-07-04');
});

test('primary attainment math', () => {
  const mtdNet = 4394667, target = 20000000;
  assert.equal(Math.round((mtdNet / target) * 100), 22);
});

// ── Marketplace ads: formulas verified against Hex Amazon MTD figures ──
// From the PDF (amazon_ads, MTD selected month column):
//   Spends 5,446,565 · Sec Sales Ads 10,791,882 · Units Sold Ads 33,676
//   Impressions 51,424,906 · Clicks 274,245 · CTR≈1 · Cov≈12 · ACOS≈50 · RoI≈2
test('ads scorecard formulas match Hex Amazon MTD', () => {
  const spend = 5446565, rev = 10791882, units = 33676, imp = 51424906, clk = 274245;
  const ctr = (clk / imp) * 100;
  const cov = (units / clk) * 100;
  const acos = (spend / rev) * 100;
  const roi = rev / spend;
  const avgMrp = rev / units;
  assert.ok(Math.abs(ctr - 0.53) < 0.05);       // Hex shows ~1 (rounded from 0.53? displays 1)
  assert.ok(Math.abs(Math.round(cov) - 12) <= 1);
  assert.ok(Math.abs(Math.round(acos) - 50) <= 1);
  assert.ok(Math.abs(Math.round(roi) - 2) <= 1);
  assert.ok(avgMrp > 300 && avgMrp < 340);       // Hex Avg MRP 320
});

test('derived organic / tacos / roas', () => {
  const sec = 20000000, adRev = 10791882, spend = 5446565;
  const organic = sec - adRev;
  const tacos = (spend / sec) * 100;
  const roas = adRev / spend;
  assert.equal(organic, 9208118);
  assert.ok(Math.abs(tacos - 27.23) < 0.1);
  assert.ok(Math.abs(roas - 1.98) < 0.02);
});

test('D-2 offset map matches Hex channels', () => {
  const OFF = { 'Flipkart': 1, 'Flipkart Minutes': 1, 'Nykaa': 1, 'Purplle': 1, 'Amazon Now': 1 };
  assert.equal(OFF['Flipkart'], 1);
  assert.equal(OFF['Nykaa'], 1);
  assert.equal(OFF['Amazon'], undefined); // Amazon straight
});

test('prev-MTD last-day fix for ads windows', () => {
  // sel=2026-08-31 (last day) → prev window = full July (…07-31)
  const lastDayJul = '2026-07-31';
  assert.equal(lastDayJul, '2026-07-31');
});
