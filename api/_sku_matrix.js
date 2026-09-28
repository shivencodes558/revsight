// ─────────────────────────────────────────────────────────────────────────
//  _sku_matrix.js — the "All Channels : Data" month-over-month matrices.
//
//  Replicates the Hex notebook's nine stacked tables (SKU-wise Volume,
//  Demand Weight, Category-wise Volume + Contribution, then the same for MRP
//  and SP sales) in ONE scan. The notebook runs a separate query per table;
//  that is nine warehouse round trips for what is really one fact grid.
//
//  Grain returned: SKU × month, with units / MRP / SP side by side. Every
//  category table in the UI is derived by grouping THESE rows, which is the
//  point — the category totals are then guaranteed to reconcile with the SKU
//  totals rather than being a second query that can drift from the first.
//
//  Filters match /api/overall exactly (same view, same statusFilterSQL, same
//  Freebie/Others exclusion) so this tab reconciles with the rest of Revsight.
//
//  ── SP caveat, carried through to the UI ──
//  SP (net selling price) only starts for the quick-commerce channels partway
//  through the history: Blinkit from Jul 2024, Zepto from Dec 2024, Instamart
//  from Feb 2025. Earlier months therefore understate SP through no fault of
//  the query. `meta.spCaveat` carries this so the view can say so rather than
//  letting someone read a fake collapse in early SP.
// ─────────────────────────────────────────────────────────────────────────
import { runQuery, SALES_VIEW, statusFilterSQL, makeGetter, num, strv } from './_snowflake.js';

const YM_RX = /^\d{4}-\d{2}$/;

// The quick-commerce SP start dates above, as a machine-readable note.
export const SP_STARTS = [
  { channel: 'Blinkit', from: '2024-07' },
  { channel: 'Zepto', from: '2024-12' },
  { channel: 'Instamart', from: '2025-02' },
];

/**
 * @param endMonth  'YYYY-MM' — the newest column. Defaults to the current month.
 * @param months    how many columns, counting back from endMonth (2-24).
 */
export async function fetchSkuMatrix(endMonth, months) {
  const end = YM_RX.test(String(endMonth || '')) ? String(endMonth) : null;
  const n = Math.max(2, Math.min(24, Number(months) || 12));

  // Month columns, newest first — the notebook's column order.
  const monthList = [];
  {
    const base = end ? end : new Date().toISOString().slice(0, 7);
    let [y, m] = base.split('-').map(Number);
    for (let i = 0; i < n; i++) {
      monthList.push(`${y}-${String(m).padStart(2, '0')}`);
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
    }
  }
  const startMonth = monthList[monthList.length - 1];

  // Bounds are bound params on the FIRST of each month; the upper bound uses
  // LAST_DAY so a partial current month still comes through in full.
  const sql = `
    WITH src AS (
      SELECT
        TRY_TO_DATE(TO_VARCHAR(order_date))                  AS D,
        TO_VARCHAR(order_status)                             AS order_status,
        TO_VARCHAR(sub_category)                             AS sub_category,
        TO_VARCHAR(sku)                                      AS sku,
        TO_VARCHAR(product_name)                             AS product_name,
        TRY_TO_DOUBLE(TO_VARCHAR(selling_price_per_unit))    AS sp_unit,
        TRY_TO_DOUBLE(TO_VARCHAR(mapper_mrp_per_unit))       AS mrp_unit,
        TRY_TO_DOUBLE(TO_VARCHAR(qty))                       AS qty
      FROM ${SALES_VIEW}
    )
    SELECT
      TO_CHAR(D, 'YYYY-MM')                                  AS ym,
      COALESCE(sku, '(unmapped)')                            AS sku,
      COALESCE(product_name, COALESCE(sku, '(unmapped)'))    AS product,
      COALESCE(sub_category, '(uncategorised)')              AS subcat,
      ROUND(SUM(COALESCE(qty, 0)), 2)                             AS units,
      ROUND(SUM(COALESCE(mrp_unit, 0) * COALESCE(qty, 0)), 2)     AS mrp,
      ROUND(SUM(COALESCE(sp_unit, 0)  * COALESCE(qty, 0)), 2)     AS sp
    FROM src
    WHERE D IS NOT NULL
      AND D >= TO_DATE(? || '-01')
      AND D <= LAST_DAY(TO_DATE(? || '-01'))
      AND (sub_category IS NULL OR sub_category NOT IN ('Freebie', 'Others'))
      ${statusFilterSQL()}
    GROUP BY 1, 2, 3, 4
    HAVING units <> 0 OR mrp <> 0 OR sp <> 0
  `;

  const raw = await runQuery(sql, [startMonth, monthList[0]]);

  // ── pivot to one row per SKU with month-aligned arrays ──
  // Arrays (not objects keyed by month) keep the payload small: ~300 SKUs × 12
  // months × 3 measures as bare numbers, no repeated month keys.
  const idx = new Map(monthList.map((m, i) => [m, i]));
  const zero = () => new Array(monthList.length).fill(0);
  const bySku = new Map();

  for (const r of raw) {
    const g = makeGetter(r);
    const i = idx.get(strv(g('ym')));
    if (i == null) continue;                     // outside the window
    const sku = strv(g('sku'));
    let row = bySku.get(sku);
    if (!row) {
      row = {
        sku,
        product: strv(g('product')),
        subCategory: strv(g('subcat')),
        units: zero(), mrp: zero(), sp: zero(),
        unmapped: sku === '(unmapped)',
      };
      bySku.set(sku, row);
    }
    // A SKU's sub-category can be re-tagged mid-history; keep the most recent
    // label (months are newest-first, so the lowest index wins) so a SKU does
    // not appear under a category it was moved out of months ago.
    const sc = strv(g('subcat'));
    if (sc && sc !== '(uncategorised)' && i <= (row._scAt ?? Infinity)) {
      row.subCategory = sc; row._scAt = i;
    }
    row.units[i] += num(g('units'));
    row.mrp[i]   += num(g('mrp'));
    row.sp[i]    += num(g('sp'));
  }

  const skus = [...bySku.values()];
  for (const s of skus) delete s._scAt;

  // Sort by newest month's units desc, then by name — the notebook's order,
  // and it puts the SKUs that matter now at the top of page 1.
  skus.sort((a, b) => (b.units[0] - a.units[0]) || a.sku.localeCompare(b.sku));

  // Column totals, summed from the same rows the UI renders.
  const totals = { units: zero(), mrp: zero(), sp: zero() };
  for (const s of skus) {
    for (let i = 0; i < monthList.length; i++) {
      totals.units[i] += s.units[i];
      totals.mrp[i]   += s.mrp[i];
      totals.sp[i]    += s.sp[i];
    }
  }

  return {
    months: monthList,
    skus,
    totals,
    meta: {
      view: SALES_VIEW,
      basis: 'order-line grain, Freebie/Others excluded, same status filter as /api/overall',
      spCaveat: SP_STARTS,
      unmappedSkus: skus.filter(s => s.unmapped).length,
      note: 'Category rows are grouped from these SKU rows, so category and SKU totals always agree.',
    },
  };
}
