// ─────────────────────────────────────────────────────────────────────────
//  _city_sales.js — City Wise Sales.
//
//  Source: SELLERS_DB.SELLERS.STATE_CITY_QTY
//  (~9.0M rows, Feb 2026 → today, 8 channels, 47 states, 3,012 cities,
//  268 SKUs, 21 order statuses.)
//
//  Reproduces the Hex "City Wise Sales" notebook's two pivots — day-on-day
//  and week-on-week units by place — and fixes two things that make the
//  notebook's city ranking wrong:
//
//  1. CITY ALIASES. The feed carries the same city under two names, and the
//     split is not marginal: BANGALORE (75,014 units) and BENGALURU (55,697)
//     are one city reported twice, so the notebook shows it in 2nd and 4th
//     place instead of 1st. Five more pairs do the same. Canonicalising in
//     SQL means the GROUP BY merges them into one row instead of the reader
//     having to remember to add them up.
//
//  2. CITY IS NOT A KEY. KOTA, UDAIPUR, BHARATPUR and others appear in two
//     states each. Rows are keyed on STATE + CITY throughout.
//
//  ── The columns the notebook never used ──
//  The table also carries GROSS_SALES, NET_SALES and PINCODE. The notebook
//  charts QTY only, so "city wise sales" was really city-wise volume; gross
//  value is available and is offered as a measure.
//
//  NET_SALES is offered too but is NOT safe to read blind: it is exactly
//  zero for Flipkart (₹0 against ₹17.59Cr gross), the largest channel by
//  value. `meta.netCoverage` reports which channels report it so the view
//  can say so rather than quietly under-counting by a quarter.
// ─────────────────────────────────────────────────────────────────────────
import { runQuery, makeGetter, num, strv } from './_snowflake.js';

const T = 'SELLERS_DB.SELLERS.STATE_CITY_QTY';
const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

/* Same city, two spellings. Verified present in the feed with both variants
   carrying real volume — this is a merge, not a guess. Extend as new
   variants appear; the canonical form is the one in current official use. */
export const CITY_ALIASES = {
  BENGALURU: 'BANGALORE',              // 55,697 + 75,014 units
  GURUGRAM: 'GURGAON',                 //  3,371 + 13,970
  PUDUCHERRY: 'PONDICHERRY',           //  1,397 +  7,601
  THIRUVANANTHAPURAM: 'TRIVANDRUM',    //  8,121 +  1,479
  MYSURU: 'MYSORE',                    //  1,014 +  7,139
  PRAYAGRAJ: 'ALLAHABAD',              //  1,705 +  2,906
  // Historic names, included defensively — harmless if absent.
  BOMBAY: 'MUMBAI', CALCUTTA: 'KOLKATA', MADRAS: 'CHENNAI',
  POONA: 'PUNE', BARODA: 'VADODARA', SIMLA: 'SHIMLA',
};

// SQL expression that folds aliases at group time, so Bangalore/Bengaluru
// become one row rather than two the reader must sum.
const CITY_EXPR = (() => {
  const whens = Object.entries(CITY_ALIASES)
    .map(([from, to]) => `WHEN '${from}' THEN '${to}'`).join('\n        ');
  return `CASE UPPER(TRIM(COALESCE(CITY, '')))
        ${whens}
        WHEN '' THEN '(unknown)'
        ELSE UPPER(TRIM(CITY)) END`;
})();
const STATE_EXPR = `CASE WHEN STATE IS NULL OR TRIM(STATE) = '' THEN '(unknown)' ELSE UPPER(TRIM(STATE)) END`;

// Not a sale. Pattern-matched so a new variant is caught rather than counted.
const FAIL_PATTERNS = ['%RETURN%', '%DAMAGED%', '%REJECTED%', '%UNDELIVERABLE%',
  '%LOST%', '%CANCEL%', 'RTO%'];
const NET_STATUS_FILTER =
  `AND NOT (${FAIL_PATTERNS.map(p => `UPPER(ORDER_STATUS) LIKE '${p}'`).join(' OR ')})`;

const MEASURES = {
  units: { sql: 'QTY', label: 'Units', fmt: 'int' },
  gross: { sql: 'COALESCE(GROSS_SALES, 0)', label: 'Gross Sales', fmt: 'inr' },
  net:   { sql: 'COALESCE(NET_SALES, 0)',   label: 'Net Sales',   fmt: 'inr' },
};

// Row identity options. `city` is the default because 2,607 cities a month is
// already a long tail; city × SKU is ~54,000 combinations, which is a pivot
// no browser should be asked to hold.
const ROW_BY = {
  state:      { cols: [STATE_EXPR], names: ['state'] },
  city:       { cols: [STATE_EXPR, CITY_EXPR], names: ['state', 'city'] },
  'city-sku': { cols: [STATE_EXPR, CITY_EXPR, 'SKU', 'PRODUCT'], names: ['state', 'city', 'sku', 'product'] },
};

function dimFilter(opts) {
  const parts = [];
  const binds = [];
  const add = (expr, list, upper = false) => {
    const arr = (Array.isArray(list) ? list : String(list || '').split(','))
      .map(s => strv(s)).filter(Boolean);
    if (!arr.length) return;
    parts.push(`AND ${expr} IN (${arr.map(() => '?').join(', ')})`);
    binds.push(...arr.map(v => (upper ? v.toUpperCase() : v)));
  };
  add('CHANNEL', opts.channels);
  add(STATE_EXPR, opts.states, true);
  add(CITY_EXPR, opts.cities, true);
  add('SKU', opts.skus);
  add('CATEGORY', opts.categories);
  add('SUB_CATEGORY', opts.subCategories);
  return { sql: parts.join('\n      '), binds };
}

/**
 * @param grain   'day' | 'week' — column grain. Weeks are labelled by their
 *                start date rather than a week NUMBER: "%Y-W%U" as the
 *                notebook uses is ambiguous across year boundaries and tells
 *                you nothing about when the week actually was.
 * @param rowBy   'state' | 'city' | 'city-sku'
 * @param measure 'units' | 'gross' | 'net'
 * @param topN    rows returned; the remainder is folded into one "(other …)"
 *                row so the column totals still reconcile exactly.
 */
export async function fetchCitySales(opts = {}) {
  const { from, to, grain = 'day', rowBy = 'city', measure = 'units',
    statusMode = 'all' } = opts;
  for (const [k, v] of Object.entries({ from, to })) {
    if (!v || !YMD_RX.test(v)) throw new Error(`Invalid or missing date param: ${k}`);
  }
  const M = MEASURES[measure] || MEASURES.units;
  const R = ROW_BY[rowBy] || ROW_BY.city;
  const topN = Math.max(20, Math.min(600, Number(opts.topN) || 400));
  const net = statusMode === 'net' ? NET_STATUS_FILTER : '';
  const dim = dimFilter(opts);

  const colExpr = grain === 'week'
    ? `TO_CHAR(DATE_TRUNC('WEEK', DATE), 'YYYY-MM-DD')`
    : `TO_CHAR(DATE, 'YYYY-MM-DD')`;

  const where = `
    WHERE DATE BETWEEN TO_DATE(?) AND TO_DATE(?)
      ${net}
      ${dim.sql}`;
  const binds = [from, to, ...dim.binds];

  const rowKeySql = R.cols.map((c, i) => `${c} AS k${i}`).join(',\n      ');
  const rowKeyGroup = R.cols.map((_, i) => `k${i}`).join(', ');

  // ── 1 · the pivot body, long-form (row identity × column × measure) ──
  // Ranked server-side so only the top rows cross the wire; everything past
  // the cut is summed into one bucket rather than dropped, which is what
  // keeps the TOTAL row honest.
  const qGrid = () => runQuery(
    `WITH base AS (
       SELECT ${rowKeySql}, ${colExpr} AS col, SUM(${M.sql}) AS v
       FROM ${T} ${where}
       GROUP BY ${rowKeyGroup}, col
     ),
     ranked AS (
       SELECT ${rowKeyGroup}, SUM(v) AS tot,
              ROW_NUMBER() OVER (ORDER BY SUM(v) DESC) AS rn
       FROM base GROUP BY ${rowKeyGroup}
     )
     SELECT b.${R.cols.map((_, i) => `k${i}`).join(', b.')},
            b.col, b.v, r.rn, r.tot
     FROM base b JOIN ranked r USING (${rowKeyGroup})
     WHERE r.rn <= ${topN}`,
    binds);

  // ── 2 · everything past the cut, as one row ──
  const qOther = () => runQuery(
    `WITH base AS (
       SELECT ${rowKeySql}, ${colExpr} AS col, SUM(${M.sql}) AS v
       FROM ${T} ${where}
       GROUP BY ${rowKeyGroup}, col
     ),
     ranked AS (
       SELECT ${rowKeyGroup}, SUM(v) AS tot,
              ROW_NUMBER() OVER (ORDER BY SUM(v) DESC) AS rn
       FROM base GROUP BY ${rowKeyGroup}
     )
     SELECT b.col, SUM(b.v) AS v
     FROM base b JOIN ranked r USING (${rowKeyGroup})
     WHERE r.rn > ${topN}
     GROUP BY b.col`,
    binds);

  // ── 3 · headline totals + reach, and the same for the comparison window ──
  const qTotals = () => runQuery(
    `SELECT
       SUM(${M.sql})                                      AS v,
       SUM(QTY)                                           AS units,
       SUM(COALESCE(GROSS_SALES, 0))                      AS gross,
       COUNT(DISTINCT ${CITY_EXPR} || '|' || ${STATE_EXPR}) AS cities,
       COUNT(DISTINCT ${STATE_EXPR})                      AS states,
       COUNT(DISTINCT DATE)                               AS days,
       -- Distinct row identities at the CHOSEN grain, so the "(other)" row
       -- can say how many rows it stands for. Counting inside the per-column
       -- tail query instead would count per DAY and understate the tail.
       COUNT(DISTINCT ${R.cols.join(" || '|' || ")})       AS row_keys
     FROM ${T} ${where}`, binds);

  // ── 4 · which channels actually populate NET_SALES ──
  // Flipkart reports zero, so a naive "net sales by city" would show its
  // cities as empty. The view needs this to warn instead of under-count.
  const qNetCoverage = () => runQuery(
    `SELECT CHANNEL,
       SUM(COALESCE(GROSS_SALES, 0)) AS gross,
       SUM(COALESCE(NET_SALES, 0))   AS net
     FROM ${T} ${where} GROUP BY 1 ORDER BY 2 DESC`, binds);

  // ── 5 · channel × place, for the mix panel ──
  const qByChannel = () => runQuery(
    `SELECT CHANNEL, SUM(${M.sql}) AS v FROM ${T} ${where} GROUP BY 1 ORDER BY 2 DESC`, binds);

  const [gridRaw, otherRaw, totalsRaw, netRaw, chanRaw] =
    await Promise.all([qGrid(), qOther(), qTotals(), qNetCoverage(), qByChannel()]);

  // ── pivot long → wide ──
  const colSet = new Set();
  for (const r of gridRaw) colSet.add(strv(r.COL));
  for (const r of otherRaw) colSet.add(strv(r.COL));
  // Newest first, matching the notebook's descending sort.
  const columns = [...colSet].sort().reverse();
  const idx = new Map(columns.map((c, i) => [c, i]));
  const zero = () => new Array(columns.length).fill(0);

  const byRow = new Map();
  for (const r of gridRaw) {
    const g = makeGetter(r);
    const key = R.names.map((_, i) => strv(g('k' + i))).join('|');
    let row = byRow.get(key);
    if (!row) {
      row = { key, values: zero(), rank: num(g('rn')), total: num(g('tot')) };
      R.names.forEach((n, i) => { row[n] = strv(g('k' + i)); });
      byRow.set(key, row);
    }
    const i = idx.get(strv(g('col')));
    if (i != null) row.values[i] += num(g('v'));
  }
  const rows = [...byRow.values()].sort((a, b) => a.rank - b.rank);

  // The tail, as one row — so the pivot's TOTAL still equals the window's.
  // How many identities the tail stands for. Derived from the window's total
  // distinct row keys minus the rows returned — counting inside the tail
  // query would group by column and report the biggest single DAY's tail,
  // which understates it badly (1,273 instead of 2,216 for one August).
  const tg0 = makeGetter(totalsRaw[0] || {});
  const tailCount = Math.max(0, num(tg0('row_keys')) - rows.length);

  let other = null;
  if (otherRaw.length) {
    const values = zero();
    for (const r of otherRaw) {
      const g = makeGetter(r);
      const i = idx.get(strv(g('col')));
      if (i != null) values[i] += num(g('v'));
    }
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum !== 0) {
      const label = tailCount > 0
        ? '(' + tailCount.toLocaleString('en-IN') + ' more)'
        : '(other)';
      other = { key: '(other)', state: '(other)', city: label, sku: '', product: '',
        values, count: tailCount, isOther: true };
    }
  }

  // Column totals, summed from exactly the rows the view renders (top-N plus
  // the tail bucket) so nothing is silently missing from the total.
  const totals = zero();
  for (const r of [...rows, ...(other ? [other] : [])]) {
    for (let i = 0; i < columns.length; i++) totals[i] += r.values[i];
  }

  const tg = tg0;
  const netCoverage = netRaw.map(r => {
    const g = makeGetter(r);
    return { channel: strv(g('channel')), gross: num(g('gross')), net: num(g('net')) };
  });

  return {
    window: { from, to },
    grain, rowBy, measure,
    measureLabel: M.label, measureFmt: M.fmt,
    columns, rows, other, totals,
    rowNames: R.names,
    byChannel: chanRaw.map(r => {
      const g = makeGetter(r);
      return { channel: strv(g('channel')), value: num(g('v')) };
    }),
    reach: {
      value: num(tg('v')),
      units: num(tg('units')),
      gross: num(tg('gross')),
      cities: num(tg('cities')),
      states: num(tg('states')),
      days: num(tg('days')),
    },
    meta: {
      table: T,
      statusMode,
      topN,
      truncated: !!other,
      netCoverage,
      // Channels reporting no net value at all — reading a net-sales map
      // without knowing this understates it silently.
      netMissing: netCoverage.filter(c => c.gross > 0 && c.net === 0).map(c => c.channel),
      aliasesApplied: Object.entries(CITY_ALIASES).map(([a, b]) => `${a}→${b}`),
      weekNote: grain === 'week'
        ? 'Weeks are labelled by their start date (Monday-based DATE_TRUNC), not a week number.'
        : null,
      note: 'Rows are keyed on state + city: several city names occur in more than one state.',
    },
  };
}

/* Filter option lists. Split from the grid so choosing a filter never
   re-queries the list it was chosen from. */
export async function fetchCityFilters() {
  const [ch, st, ct, cat, sub, sku] = await Promise.all([
    runQuery(`SELECT DISTINCT CHANNEL V FROM ${T} WHERE CHANNEL IS NOT NULL ORDER BY 1`, []),
    runQuery(`SELECT ${STATE_EXPR} V, SUM(QTY) U FROM ${T} GROUP BY 1 ORDER BY U DESC`, []),
    // Cities are 3,000+; rank by volume so the picker opens on the ones that matter.
    runQuery(`SELECT ${CITY_EXPR} V, SUM(QTY) U FROM ${T}
              WHERE DATE >= DATEADD(month, -6, CURRENT_DATE()) GROUP BY 1 ORDER BY U DESC LIMIT 400`, []),
    runQuery(`SELECT DISTINCT CATEGORY V FROM ${T} WHERE CATEGORY IS NOT NULL ORDER BY 1`, []),
    runQuery(`SELECT DISTINCT SUB_CATEGORY V FROM ${T} WHERE SUB_CATEGORY IS NOT NULL ORDER BY 1`, []),
    runQuery(`SELECT SKU V, SUM(QTY) U FROM ${T}
              WHERE SKU IS NOT NULL AND DATE >= DATEADD(month, -6, CURRENT_DATE())
              GROUP BY 1 ORDER BY U DESC`, []),
  ]);
  const pick = rows => rows.map(r => strv(r.V)).filter(Boolean);
  return {
    channels: pick(ch), states: pick(st), cities: pick(ct),
    categories: pick(cat), subCategories: pick(sub), skus: pick(sku),
  };
}
