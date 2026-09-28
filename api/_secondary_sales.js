// ─────────────────────────────────────────────────────────────────────────
//  _secondary_sales.js — Secondary Sales Trend Analysis.
//
//  SECONDARY sales = sell-OUT: what the platform sold to the end consumer.
//  Revsight's other tabs run on PRIMARY sales (sell-IN: what we invoiced to
//  the platform). The two never tie, and are not meant to: primary moves in
//  purchase-order steps, secondary moves with consumer demand. Keeping that
//  distinction visible is why this tab is separate rather than another basis
//  toggle on an existing one.
//
//  Source: SELLERS_DB.SELLERS.MARKETPLACE_SECONDARY_SALES_RPT
//  (~9.0M order lines, Nov 2022 → today, 14 channels, 309 SKUs.)
//
//  ── Faithful to the Hex notebook, with the two catches surfaced ──
//  The notebook's "Daily Metrics" cell is:
//    SUM(QTY)                                                       AS units
//    SUM(SP*QTY) / NULLIF(SUM(QTY),0)                               AS avg_selling_price
//    SUM((MAPPER_MRP-SP)*QTY) / NULLIF(SUM(MAPPER_MRP*QTY),0)       AS discount_pct
//    WHERE MAPPER_MRP_PER_UNIT > 0
//  and that is reproduced exactly here. Two things about it are worth saying
//  out loud, because neither is visible in the notebook:
//
//  1. ORDER_STATUS is NOT filtered. The table carries 38 statuses including
//     CANCELLED, RTO_*, Returned and Lost, so the default figure is orders
//     PLACED, not orders that stuck. That is a legitimate demand signal, but
//     it is ~2.7% above net. `statusMode:'net'` drops the failure statuses so
//     both readings are available; 'all' is the default so this tab
//     reconciles with the notebook out of the box.
//
//  2. MAPPER_MRP_PER_UNIT > 0 silently excludes Freebie SKUs — 5ml sachets
//     and similar, which carry no MRP. That exclusion is correct (a freebie
//     would otherwise register as a 100% discount and drag the average down
//     for free), but it means this tab's unit count is below a raw SUM(QTY).
//     `meta.excluded` reports what it costs.
// ─────────────────────────────────────────────────────────────────────────
import { runQuery, makeGetter, num, strv } from './_snowflake.js';

const T = 'SELLERS_DB.SELLERS.MARKETPLACE_SECONDARY_SALES_RPT';
const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

// Statuses that are not a sale. Matched by pattern rather than an explicit
// list so a newly-appearing variant ("Shipped - Returned to Warehouse") is
// caught instead of quietly counting as revenue.
const FAIL_PATTERNS = ['%CANCEL%', '%RETURN%', 'RTO%', '%LOST%', '%DISPOSED%',
  '%FAILED%', '%DAMAGED%', '%REJECTED%', '%UNDELIVERABLE%'];
const NET_FILTER = `AND NOT (${FAIL_PATTERNS.map(p => `UPPER(ORDER_STATUS) LIKE '${p}'`).join(' OR ')})`;

// The three notebook metrics, as SQL fragments so every grain computes them
// identically. Discount is a share of MRP VALUE (not a mean of per-line
// discounts) — value-weighted, which is the only version that aggregates.
const METRICS = `
  ROUND(SUM(QTY), 2)                                                   AS units,
  ROUND(SUM(SELLING_PRICE_PER_UNIT * QTY), 2)                          AS sp_value,
  ROUND(SUM(MAPPER_MRP_PER_UNIT * QTY), 2)                             AS mrp_value,
  COUNT(DISTINCT NULLIF(ORDER_NUMBER, ''))                             AS orders`;

// cur/prev conditional aggregation, for the comparison-bearing breakdowns
const SPLIT_METRICS = `
  ROUND(SUM(CASE WHEN D BETWEEN p.cf AND p.ct THEN QTY ELSE 0 END), 2)                            AS cur_units,
  ROUND(SUM(CASE WHEN D BETWEEN p.cf AND p.ct THEN SELLING_PRICE_PER_UNIT * QTY ELSE 0 END), 2)   AS cur_sp,
  ROUND(SUM(CASE WHEN D BETWEEN p.cf AND p.ct THEN MAPPER_MRP_PER_UNIT * QTY ELSE 0 END), 2)      AS cur_mrp,
  ROUND(SUM(CASE WHEN D BETWEEN p.pf AND p.pt THEN QTY ELSE 0 END), 2)                            AS prev_units,
  ROUND(SUM(CASE WHEN D BETWEEN p.pf AND p.pt THEN SELLING_PRICE_PER_UNIT * QTY ELSE 0 END), 2)   AS prev_sp,
  ROUND(SUM(CASE WHEN D BETWEEN p.pf AND p.pt THEN MAPPER_MRP_PER_UNIT * QTY ELSE 0 END), 2)      AS prev_mrp`;

/* Build the dimension filter clause + its binds. Values arrive from the
   client, so they go in as binds — never interpolated. */
function dimFilter({ channels, categories, subCategories, skus, classifications }) {
  const parts = [];
  const binds = [];
  const add = (col, list) => {
    const arr = (Array.isArray(list) ? list : String(list || '').split(','))
      .map(s => strv(s)).filter(Boolean);
    if (!arr.length) return;
    parts.push(`AND ${col} IN (${arr.map(() => '?').join(', ')})`);
    binds.push(...arr);
  };
  add('CHANNEL_NAME', channels);
  add('CATEGORY', categories);
  add('SUB_CATEGORY', subCategories);
  add('PRODUCT_NAME', skus);
  add('CLASSIFICATION', classifications);
  return { sql: parts.join('\n      '), binds };
}

const asPct = (numer, denom) => (denom > 0 ? (numer / denom) * 100 : null);
const asAsp = (value, units) => (units > 0 ? value / units : null);

// One daily/period row → the notebook's three metrics plus revenue.
function shape(units, spValue, mrpValue, orders) {
  return {
    units,
    revenue: spValue,                       // secondary revenue = SP × qty
    mrpValue,
    orders,
    asp: asAsp(spValue, units),
    discountPct: asPct(mrpValue - spValue, mrpValue),
    unitsPerOrder: orders > 0 ? units / orders : null,
  };
}

export async function fetchSecondarySales(opts = {}) {
  const { from, to, prevFrom, prevTo, statusMode = 'all', monthsBack = 13 } = opts;
  for (const [k, v] of Object.entries({ from, to, prevFrom, prevTo })) {
    if (!v || !YMD_RX.test(v)) throw new Error(`Invalid or missing date param: ${k}`);
  }
  const net = statusMode === 'net' ? NET_FILTER : '';
  const dim = dimFilter(opts);
  const nMonths = Math.max(3, Math.min(24, Number(monthsBack) || 13));

  // Every query shares this shape: normalise the date once, apply the MRP
  // gate, the status mode, and the dimension filters.
  const src = (dateClause, extraBinds = []) => ({
    where: `
      WHERE MAPPER_MRP_PER_UNIT > 0
        ${dateClause}
        ${net}
        ${dim.sql}`,
    binds: [...extraBinds, ...dim.binds],
  });

  // ── 1 · daily series over the selected window ──
  const qDaily = () => {
    const s = src('AND ORDER_DATE BETWEEN TO_DATE(?) AND TO_DATE(?)', [from, to]);
    return runQuery(
      `SELECT TO_CHAR(ORDER_DATE,'YYYY-MM-DD') AS d, ${METRICS}
       FROM ${T} ${s.where} GROUP BY 1 ORDER BY 1`, s.binds);
  };

  // ── 2 · window totals, current AND comparison in one pass ──
  const qTotals = () => {
    const s = src('AND ORDER_DATE BETWEEN TO_DATE(?) AND TO_DATE(?)', [prevFrom, to]);
    return runQuery(
      `WITH p AS (SELECT TO_DATE(?) cf, TO_DATE(?) ct, TO_DATE(?) pf, TO_DATE(?) pt)
       SELECT ${SPLIT_METRICS},
         COUNT(DISTINCT CASE WHEN D BETWEEN p.cf AND p.ct THEN NULLIF(ORDER_NUMBER,'') END) AS cur_orders,
         COUNT(DISTINCT CASE WHEN D BETWEEN p.pf AND p.pt THEN NULLIF(ORDER_NUMBER,'') END) AS prev_orders
       FROM (SELECT ORDER_DATE AS D, ORDER_NUMBER, QTY, SELLING_PRICE_PER_UNIT, MAPPER_MRP_PER_UNIT,
                    CHANNEL_NAME, CATEGORY, SUB_CATEGORY, PRODUCT_NAME, CLASSIFICATION, ORDER_STATUS
             FROM ${T} ${s.where}) CROSS JOIN p`,
      [from, to, prevFrom, prevTo, ...s.binds]);
  };

  // ── 3 · monthly series ──
  // Deliberately NOT bounded by the selected window. The notebook charts
  // months inside a 3-month range, which yields three points and no trend;
  // a trailing 13 months is the same chart doing its job. Dimension filters
  // still apply, so "monthly for Nykaa" behaves as expected.
  const qMonthly = () => {
    const s = src(`AND ORDER_DATE >= DATEADD(month, -${nMonths - 1}, DATE_TRUNC('month', TO_DATE(?)))
        AND ORDER_DATE <= TO_DATE(?)`, [to, to]);
    return runQuery(
      `SELECT TO_CHAR(ORDER_DATE,'YYYY-MM') AS ym, ${METRICS}
       FROM ${T} ${s.where} GROUP BY 1 ORDER BY 1`, s.binds);
  };

  // ── 4 · per-channel, cur vs prev, plus each channel's own last date ──
  const qChannels = () => {
    const s = src('AND ORDER_DATE BETWEEN TO_DATE(?) AND TO_DATE(?)', [prevFrom, to]);
    return runQuery(
      `WITH p AS (SELECT TO_DATE(?) cf, TO_DATE(?) ct, TO_DATE(?) pf, TO_DATE(?) pt)
       SELECT CHANNEL_NAME AS k, ${SPLIT_METRICS}
       FROM (SELECT ORDER_DATE AS D, QTY, SELLING_PRICE_PER_UNIT, MAPPER_MRP_PER_UNIT,
                    CHANNEL_NAME, CATEGORY, SUB_CATEGORY, PRODUCT_NAME, CLASSIFICATION, ORDER_STATUS
             FROM ${T} ${s.where}) CROSS JOIN p
       GROUP BY 1 HAVING cur_units <> 0 OR prev_units <> 0`,
      [from, to, prevFrom, prevTo, ...s.binds]);
  };

  // ── 5 · category / sub-category / classification, cur vs prev ──
  // GROUPING SETS returns all three breakdowns in one scan instead of three.
  const qDims = () => {
    const s = src('AND ORDER_DATE BETWEEN TO_DATE(?) AND TO_DATE(?)', [prevFrom, to]);
    return runQuery(
      `WITH p AS (SELECT TO_DATE(?) cf, TO_DATE(?) ct, TO_DATE(?) pf, TO_DATE(?) pt)
       SELECT
         COALESCE(CATEGORY, '(none)')       AS cat,
         COALESCE(SUB_CATEGORY, '(none)')   AS subcat,
         COALESCE(CLASSIFICATION, '(none)') AS cls,
         ${SPLIT_METRICS}
       FROM (SELECT ORDER_DATE AS D, QTY, SELLING_PRICE_PER_UNIT, MAPPER_MRP_PER_UNIT,
                    CHANNEL_NAME, CATEGORY, SUB_CATEGORY, PRODUCT_NAME, CLASSIFICATION, ORDER_STATUS
             FROM ${T} ${s.where}) CROSS JOIN p
       GROUP BY GROUPING SETS ((cat), (subcat), (cls))`,
      [from, to, prevFrom, prevTo, ...s.binds]);
  };

  // ── 6 · SKUs, cur vs prev ──
  const qSkus = () => {
    const s = src('AND ORDER_DATE BETWEEN TO_DATE(?) AND TO_DATE(?)', [prevFrom, to]);
    return runQuery(
      `WITH p AS (SELECT TO_DATE(?) cf, TO_DATE(?) ct, TO_DATE(?) pf, TO_DATE(?) pt)
       SELECT COALESCE(PRODUCT_NAME,'(unnamed)') AS k,
              MAX(COALESCE(SUB_CATEGORY,'(none)')) AS subcat,
              MAX(COALESCE(CLASSIFICATION,'(none)')) AS cls,
              ${SPLIT_METRICS}
       FROM (SELECT ORDER_DATE AS D, QTY, SELLING_PRICE_PER_UNIT, MAPPER_MRP_PER_UNIT,
                    CHANNEL_NAME, CATEGORY, SUB_CATEGORY, PRODUCT_NAME, CLASSIFICATION, ORDER_STATUS
             FROM ${T} ${s.where}) CROSS JOIN p
       GROUP BY 1 HAVING cur_units <> 0 OR prev_units <> 0
       ORDER BY cur_units DESC LIMIT 300`,
      [from, to, prevFrom, prevTo, ...s.binds]);
  };

  // ── 7 · discount-band mix by day ──
  // An average discount of 30% can be everything-at-30 or half-at-0 and
  // half-at-60, and those are completely different commercial situations.
  // Banding at the ORDER-LINE level is the only way to tell them apart.
  const qBands = () => {
    const s = src('AND ORDER_DATE BETWEEN TO_DATE(?) AND TO_DATE(?)', [from, to]);
    return runQuery(
      `SELECT TO_CHAR(ORDER_DATE,'YYYY-MM-DD') AS d,
         CASE
           WHEN SELLING_PRICE_PER_UNIT >= MAPPER_MRP_PER_UNIT THEN '0%'
           WHEN (MAPPER_MRP_PER_UNIT - SELLING_PRICE_PER_UNIT) / MAPPER_MRP_PER_UNIT < 0.10 THEN '1-10%'
           WHEN (MAPPER_MRP_PER_UNIT - SELLING_PRICE_PER_UNIT) / MAPPER_MRP_PER_UNIT < 0.20 THEN '10-20%'
           WHEN (MAPPER_MRP_PER_UNIT - SELLING_PRICE_PER_UNIT) / MAPPER_MRP_PER_UNIT < 0.30 THEN '20-30%'
           WHEN (MAPPER_MRP_PER_UNIT - SELLING_PRICE_PER_UNIT) / MAPPER_MRP_PER_UNIT < 0.40 THEN '30-40%'
           WHEN (MAPPER_MRP_PER_UNIT - SELLING_PRICE_PER_UNIT) / MAPPER_MRP_PER_UNIT < 0.50 THEN '40-50%'
           ELSE '50%+'
         END AS band,
         ROUND(SUM(QTY), 2) AS units
       FROM ${T} ${s.where} GROUP BY 1, 2`, s.binds);
  };

  // ── 8 · freshness + what the MRP gate costs, over the selected window ──
  const qAudit = () => {
    const s = src('AND ORDER_DATE BETWEEN TO_DATE(?) AND TO_DATE(?)', [from, to]);
    // NOTE: deliberately re-derived WITHOUT the MRP gate, to measure it.
    const bare = `
      WHERE 1 = 1
        AND ORDER_DATE BETWEEN TO_DATE(?) AND TO_DATE(?)
        ${net}
        ${dim.sql}`;
    return Promise.all([
      // Bounded to ~13 months: enough to prove a feed has gone quiet, and it
      // keeps this off a full 9M-row scan just to read a MAX(date).
      runQuery(`SELECT CHANNEL_NAME AS k, TO_CHAR(MAX(ORDER_DATE),'YYYY-MM-DD') AS last_d
                FROM ${T}
                WHERE MAPPER_MRP_PER_UNIT > 0
                  AND ORDER_DATE >= DATEADD(month, -13, TO_DATE(?))
                  ${dim.sql}
                GROUP BY 1`, [to, ...dim.binds]),
      // One pass for both audit numbers: what the MRP gate costs, and how
      // many units are cancellations/returns inside the kept set.
      runQuery(
        `SELECT
           ROUND(SUM(CASE WHEN MAPPER_MRP_PER_UNIT > 0 THEN QTY ELSE 0 END), 2) AS kept_units,
           ROUND(SUM(CASE WHEN NOT (MAPPER_MRP_PER_UNIT > 0) THEN QTY ELSE 0 END), 2) AS dropped_units,
           COUNT(DISTINCT CASE WHEN NOT (MAPPER_MRP_PER_UNIT > 0) THEN SUB_CATEGORY END) AS dropped_subcats,
           MAX(CASE WHEN NOT (MAPPER_MRP_PER_UNIT > 0) THEN SUB_CATEGORY END) AS dropped_example,
           ROUND(SUM(CASE WHEN MAPPER_MRP_PER_UNIT > 0
                           AND (${FAIL_PATTERNS.map(p => `UPPER(ORDER_STATUS) LIKE '${p}'`).join(' OR ')})
                          THEN QTY ELSE 0 END), 2) AS fail_units
         FROM ${T} ${bare}`, [from, to, ...dim.binds]),
    ]);
  };

  const [dailyRaw, totalsRaw, monthlyRaw, channelsRaw, dimsRaw, skusRaw, bandsRaw, auditRaw] =
    await Promise.all([qDaily(), qTotals(), qMonthly(), qChannels(), qDims(), qSkus(), qBands(), qAudit()]);

  // ── shape the daily / monthly series ──
  const series = rows => rows.map(r => {
    const g = makeGetter(r);
    return { key: strv(g('d') || g('ym')), ...shape(num(g('units')), num(g('sp_value')), num(g('mrp_value')), num(g('orders'))) };
  });
  const daily = series(dailyRaw);
  const monthly = series(monthlyRaw);

  // ── cur/prev breakdown rows ──
  const split = rows => rows.map(r => {
    const g = makeGetter(r);
    const cu = num(g('cur_units')), cs = num(g('cur_sp')), cm = num(g('cur_mrp'));
    const pu = num(g('prev_units')), ps = num(g('prev_sp')), pm = num(g('prev_mrp'));
    return {
      key: strv(g('k')),
      subCategory: g('subcat') != null ? strv(g('subcat')) : undefined,
      classification: g('cls') != null ? strv(g('cls')) : undefined,
      cur: shape(cu, cs, cm, 0),
      prev: shape(pu, ps, pm, 0),
    };
  });

  const channels = split(channelsRaw).sort((a, b) => b.cur.units - a.cur.units);
  const skus = split(skusRaw);

  // GROUPING SETS puts each breakdown on its own rows; the non-grouped keys
  // come back as the COALESCE default, so split them by which one is real.
  const dims = { categories: [], subCategories: [], classifications: [] };
  for (const r of dimsRaw) {
    const g = makeGetter(r);
    const cu = num(g('cur_units')), cs = num(g('cur_sp')), cm = num(g('cur_mrp'));
    const pu = num(g('prev_units')), ps = num(g('prev_sp')), pm = num(g('prev_mrp'));
    const row = { cur: shape(cu, cs, cm, 0), prev: shape(pu, ps, pm, 0) };
    // Exactly one of the three is non-NULL per grouping set.
    if (r.CAT != null) dims.categories.push({ key: strv(r.CAT), ...row });
    else if (r.SUBCAT != null) dims.subCategories.push({ key: strv(r.SUBCAT), ...row });
    else if (r.CLS != null) dims.classifications.push({ key: strv(r.CLS), ...row });
  }
  for (const k of Object.keys(dims)) dims[k].sort((a, b) => b.cur.units - a.cur.units);

  // ── discount bands → one row per day with a units-by-band map ──
  const BAND_ORDER = ['0%', '1-10%', '10-20%', '20-30%', '30-40%', '40-50%', '50%+'];
  const bandByDay = new Map();
  for (const r of bandsRaw) {
    const g = makeGetter(r);
    const d = strv(g('d'));
    let e = bandByDay.get(d);
    if (!e) { e = { key: d, total: 0 }; BAND_ORDER.forEach(b => { e[b] = 0; }); bandByDay.set(d, e); }
    const b = strv(g('band'));
    e[b] = (e[b] || 0) + num(g('units'));
    e.total += num(g('units'));
  }
  const bands = [...bandByDay.values()].sort((a, b) => (a.key < b.key ? -1 : 1));

  // ── totals ──
  const tg = makeGetter(totalsRaw[0] || {});
  const totals = {
    cur: shape(num(tg('cur_units')), num(tg('cur_sp')), num(tg('cur_mrp')), num(tg('cur_orders'))),
    prev: shape(num(tg('prev_units')), num(tg('prev_sp')), num(tg('prev_mrp')), num(tg('prev_orders'))),
  };

  // ── audit ──
  const [freshRaw, gateRaw] = auditRaw;
  const freshness = freshRaw.map(r => ({ channel: strv(r.K), lastDate: strv(r.LAST_D) }))
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
  const ag = makeGetter(gateRaw[0] || {});
  const excluded = {
    keptUnits: num(ag('kept_units')),
    droppedUnits: num(ag('dropped_units')),
    droppedSubCategories: num(ag('dropped_subcats')),
    droppedExample: strv(ag('dropped_example')) || null,
    failUnits: num(ag('fail_units')),
  };

  return {
    window: { from, to, prevFrom, prevTo },
    totals, daily, monthly, channels, skus, bands, bandOrder: BAND_ORDER,
    categories: dims.categories,
    subCategories: dims.subCategories,
    classifications: dims.classifications,
    freshness,
    meta: {
      table: T,
      basis: 'secondary (sell-out) order lines · MAPPER_MRP_PER_UNIT > 0',
      statusMode,
      statusNote: statusMode === 'net'
        ? 'Net of cancelled, returned, RTO, lost, damaged, rejected and undeliverable lines.'
        : 'All order statuses, exactly as the Hex notebook — this is orders PLACED, and includes cancellations and returns.',
      failPatterns: FAIL_PATTERNS,
      excluded,
      monthsBack: nMonths,
      monthlyNote: `Monthly covers a trailing ${nMonths} months ending ${to}, not the selected window — three points is not a trend.`,
      discountNote: 'Discount % is MRP value minus SP value over MRP value — value-weighted, so it aggregates correctly across days and SKUs.',
      primaryVsSecondary: 'Secondary = sell-out to the consumer. Revsight\'s other tabs are primary (sell-in). They are not expected to tie.',
    },
  };
}

/* Distinct filter values. Split from the metrics so the (slow) fact scan and
   the (fast) dimension lists cache on separate keys — changing a filter must
   not re-fetch the option lists it was chosen from. */
export async function fetchSecondaryFilters() {
  const one = (col) => runQuery(
    `SELECT DISTINCT ${col} AS V FROM ${T} WHERE ${col} IS NOT NULL ORDER BY 1`, []);
  const [ch, cat, sub, cls] = await Promise.all([
    one('CHANNEL_NAME'), one('CATEGORY'), one('SUB_CATEGORY'), one('CLASSIFICATION'),
  ]);
  // SKUs are 300+; restrict to ones that actually sold recently so the picker
  // is not padded with retired codes.
  const sku = await runQuery(
    `SELECT PRODUCT_NAME AS V, SUM(QTY) AS U FROM ${T}
     WHERE PRODUCT_NAME IS NOT NULL AND MAPPER_MRP_PER_UNIT > 0
       AND ORDER_DATE >= DATEADD(month, -13, CURRENT_DATE())
     GROUP BY 1 ORDER BY U DESC`, []);
  const pick = rows => rows.map(r => strv(r.V)).filter(Boolean);
  return {
    channels: pick(ch),
    categories: pick(cat),
    subCategories: pick(sub),
    classifications: pick(cls),
    skus: pick(sku),
  };
}
