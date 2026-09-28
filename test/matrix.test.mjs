import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asShare, rollupByCategory, skuRowsFor, sumColumns } from '../src/lib/matrix.js';

// Shaped exactly like /api/sku-matrix output: month-aligned arrays, newest first.
const MONTHS = ['2026-09', '2026-08', '2026-07'];
const skus = [
  { sku: 'A1', product: 'Gel Sunscreen 50g', subCategory: 'Sunscreen',  units: [100, 200, 300], mrp: [1000, 2000, 3000], sp: [0, 1600, 2400], unmapped: false },
  { sku: 'A2', product: 'Gel Sunscreen 30g', subCategory: 'Sunscreen',  units: [50,  100, 0],   mrp: [400,  800,  0],    sp: [0, 640,  0],    unmapped: false },
  { sku: 'B1', product: 'Lip Balm 4g',       subCategory: 'Lip Balm',   units: [50,  100, 100], mrp: [600,  1200, 1000], sp: [0, 960,  800],  unmapped: false },
  { sku: 'Z9', product: 'Retired',           subCategory: 'Face Wash',  units: [0,   0,   0],   mrp: [0,    0,    0],    sp: [0, 0,    0],    unmapped: false },
];
const totals = {
  units: [200, 400, 400],
  mrp:   [2000, 4000, 4000],
  sp:    [0, 3200, 3200],       // SP absent in the newest month — the real feed does this
};

test('asShare converts to percent of the column total', () => {
  assert.deepEqual(asShare([100, 200, 300], [200, 400, 400]), [50, 50, 75]);
});

test('asShare returns null — not 0% — for a zero-total month', () => {
  // The SP feed genuinely has no data for some months. Reporting 0% there
  // would assert a denominator that does not exist.
  const s = asShare([0, 1600, 2400], totals.sp);
  assert.equal(s[0], null);
  assert.equal(s[1], 50);
  assert.equal(s[2], 75);
});

test('asShare tolerates a missing totals array', () => {
  assert.deepEqual(asShare([1, 2], undefined), [null, null]);
});

test('every contribution column sums to 100% when the total is real', () => {
  const cats = rollupByCategory(skus, 'units', MONTHS.length);
  for (let i = 0; i < MONTHS.length; i++) {
    const sum = cats.reduce((a, c) => a + (asShare(c.values, totals.units)[i] || 0), 0);
    assert.ok(Math.abs(sum - 100) < 1e-9, `${MONTHS[i]} summed to ${sum}`);
  }
});

test('rollupByCategory sums SKUs into their sub-category', () => {
  const cats = rollupByCategory(skus, 'units', MONTHS.length);
  const sun = cats.find(c => c.subCategory === 'Sunscreen');
  assert.deepEqual(sun.values, [150, 300, 300]);   // A1 + A2
  const lip = cats.find(c => c.subCategory === 'Lip Balm');
  assert.deepEqual(lip.values, [50, 100, 100]);
});

test('rollupByCategory drops categories that are all-zero across the window', () => {
  const cats = rollupByCategory(skus, 'units', MONTHS.length);
  assert.equal(cats.find(c => c.subCategory === 'Face Wash'), undefined);
  assert.equal(cats.length, 2);
});

test('category rollup reconciles to the column totals exactly', () => {
  // This is the guarantee that makes deriving categories from SKU rows worth
  // it: a separate category query could drift from the SKU tables above it.
  for (const measure of ['units', 'mrp', 'sp']) {
    const cats = rollupByCategory(skus, measure, MONTHS.length);
    for (let i = 0; i < MONTHS.length; i++) {
      const sum = cats.reduce((a, c) => a + c.values[i], 0);
      assert.equal(sum, totals[measure][i], `${measure} ${MONTHS[i]}`);
    }
  }
});

test('sumColumns of ALL rows reproduces the warehouse column totals', () => {
  // This is the guarantee that makes a filter-following TOTAL safe: with no
  // filter the client-side sum must equal the figure the API reported, or the
  // total would silently change just by opening the table.
  const rows = skuRowsFor(skus, 'units');
  assert.deepEqual(sumColumns(rows, MONTHS.length), totals.units);
  assert.deepEqual(sumColumns(skuRowsFor(skus, 'mrp'), MONTHS.length), totals.mrp);
});

test('sumColumns of a FILTERED subset totals only those rows', () => {
  const justSunscreen = skuRowsFor(skus, 'units').filter(r => r.subCategory === 'Sunscreen');
  assert.deepEqual(sumColumns(justSunscreen, MONTHS.length), [150, 300, 300]);
  const one = skuRowsFor(skus, 'units').filter(r => r.sku === 'B1');
  assert.deepEqual(sumColumns(one, MONTHS.length), [50, 100, 100]);
});

test('sumColumns on share rows gives the subset share of the column', () => {
  // Filtering the Demand Weight table to two SKUs should report what those
  // two are worth together, not 100%.
  const shareRows = skuRowsFor(skus, 'units')
    .map(r => ({ ...r, values: asShare(r.values, totals.units) }));
  const all = sumColumns(shareRows, MONTHS.length);
  for (const v of all) assert.ok(Math.abs(v - 100) < 1e-9, `unfiltered shares must total 100, got ${v}`);
  const subset = sumColumns(shareRows.filter(r => r.sku === 'A1'), MONTHS.length);
  assert.deepEqual(subset.map(v => +v.toFixed(4)), [50, 50, 75]);
});

test('sumColumns keeps a no-data column null instead of zeroing it', () => {
  // The SP feed genuinely has no rows for some months; reporting 0 there
  // would assert a real zero that was never measured.
  const rows = [{ values: [null, 5, null] }, { values: [null, 7, null] }];
  assert.deepEqual(sumColumns(rows, 3), [null, 12, null]);
});

test('sumColumns distinguishes a real zero from missing data', () => {
  const rows = [{ values: [0, null] }];
  assert.deepEqual(sumColumns(rows, 2), [0, null]);
});

test('sumColumns on no rows is all-null, not all-zero', () => {
  // The empty-filter state must not render a row of confident zeroes.
  assert.deepEqual(sumColumns([], 3), [null, null, null]);
  assert.deepEqual(sumColumns(undefined, 2), [null, null]);
});

test('sumColumns ignores non-finite values rather than poisoning the column', () => {
  const rows = [{ values: [10, NaN, Infinity] }, { values: [5, 3, 2] }];
  assert.deepEqual(sumColumns(rows, 3), [15, 3, 2]);
});

test('skuRowsFor keeps identity fields and drops empty SKUs', () => {
  const rows = skuRowsFor(skus, 'units');
  assert.equal(rows.length, 3);                       // Z9 dropped
  assert.equal(rows[0].key, 'A1');
  assert.equal(rows[0].product, 'Gel Sunscreen 50g');
  assert.equal(rows[0].subCategory, 'Sunscreen');
  assert.deepEqual(rows[0].values, [100, 200, 300]);
});

test('a SKU with sales in only one measure survives that measure only', () => {
  // A2 has no SP in the newest month but does in Aug, so it stays in the SP
  // table; a SKU with no SP at all would be dropped from it but kept in units.
  const noSp = [{ sku: 'C1', product: 'Freebie-ish', subCategory: 'Combo', units: [5, 5, 5], mrp: [0, 0, 0], sp: [0, 0, 0] }];
  assert.equal(skuRowsFor(noSp, 'units').length, 1);
  assert.equal(skuRowsFor(noSp, 'sp').length, 0);
});
