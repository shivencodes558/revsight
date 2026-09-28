// ─────────────────────────────────────────────────────────────────────────
//  matrix.js — pure derivations for the month-over-month SKU/category grids.
//  Kept out of the view so the share and rollup maths are unit-testable:
//  a silent off-by-one here would misstate every contribution column.
// ─────────────────────────────────────────────────────────────────────────

/**
 * value[i] ÷ total[i] × 100, position by position.
 *
 * A month with a zero total yields null, not 0. "No sales that month" and
 * "0% of that month's sales" are different claims, and rendering the second
 * when you mean the first invents a denominator that never existed.
 */
export function asShare(values, totals) {
  return values.map((v, i) => {
    const t = totals ? totals[i] : 0;
    return t > 0 ? (v / t) * 100 : null;
  });
}

/**
 * Roll SKU rows up to sub-category, summing one measure across months.
 * Rows that are all-zero over the whole window are dropped — they are
 * retired categories that would otherwise pad the table with empty rows.
 */
export function rollupByCategory(skus, measure, nMonths) {
  const m = new Map();
  for (const s of skus) {
    let e = m.get(s.subCategory);
    if (!e) {
      e = { key: s.subCategory, subCategory: s.subCategory, values: new Array(nMonths).fill(0) };
      m.set(s.subCategory, e);
    }
    const src = s[measure] || [];
    for (let i = 0; i < nMonths; i++) e.values[i] += src[i] || 0;
  }
  return [...m.values()].filter(r => r.values.some(v => v !== 0));
}

/**
 * Column totals across whatever rows are given — used for the TOTAL row, so
 * it describes the rows actually on screen.
 *
 * A total that ignores the table's filter is worse than no total: you pick
 * three SKUs, the rows narrow, and the row above them still reports the whole
 * catalogue, so every share read off the table is against the wrong
 * denominator. Summing the visible set makes the total answer the question
 * the filter just asked.
 *
 * Null-safe per column: a month where no row reported anything stays null
 * rather than collapsing to 0, because "no rows reported" and "the rows
 * reported zero" are different facts — the same distinction asShare() makes.
 *
 * Unfiltered this equals the warehouse total exactly: /api/sku-matrix builds
 * its totals by summing these same SKU rows, and the only rows the view drops
 * are all-zero ones, which contribute nothing.
 */
export function sumColumns(rows, nMonths) {
  const out = new Array(nMonths).fill(null);
  for (const r of rows || []) {
    const vals = r.values || [];
    for (let i = 0; i < nMonths; i++) {
      const v = vals[i];
      if (v == null || !Number.isFinite(v)) continue;
      out[i] = (out[i] || 0) + v;
    }
  }
  return out;
}

/** SKU rows for one measure, dropping SKUs with nothing in the window. */
export function skuRowsFor(skus, measure) {
  return skus
    .map(s => ({
      key: s.sku,
      sku: s.sku,
      product: s.product,
      subCategory: s.subCategory,
      unmapped: s.unmapped,
      values: s[measure] || [],
    }))
    .filter(r => r.values.some(v => v !== 0));
}
