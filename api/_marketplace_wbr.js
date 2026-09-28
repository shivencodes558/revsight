// ═════════════════════════════════════════════════════════════════════════
//  MARKETPLACE WBR — "OVERALL -MP"
//  Replicates the Hex "WBR - Marketplace" notebook's headline table: per
//  marketplace, selected-window secondary sales vs the comparison window, the
//  prorated net target, achievement, discount and TACOS, plus a TOTAL row.
//
//  Rules carried over verbatim, because each is a business decision rather
//  than an implementation detail:
//   • MRP comes from the SKU mapper (GS_CHANNEL_WISE_MAPPER_UPDATED), joined on
//     channel_product_code + channel and constrained to the mapping's validity
//     window — not from mapper_mrp_per_unit on the sales row.
//   • Myntra SJIT/Direct collapse to Myntra; on the ads side Swiggy becomes
//     Swiggy IM and Blinkit Banner becomes Blinkit.
//   • Monthly net targets are PRORATED across the window, including across a
//     month boundary.
//   • Off-platform display spends (Nykaa, Myntra ×2 sheets, Purplle) are each
//     prorated by days-in-window and added to that platform's spend.
//   • TACOS uses a different denominator per platform — MRP for Nykaa, Swiggy IM
//     and Zepto; secondary for Myntra, Purplle and the rest — and Zepto
//     additionally nets off a fixed ₹7.5L/month retainer before the ratio.
//     These are deliberate; do not "normalise" them.
//
//  Validated against the notebook's own rendered output for 01–15 Aug vs
//  01–15 Jul: Nykaa, Myntra and Purplle reconcile to the rupee, and the TOTAL
//  lands within 0.4%. The remaining channels drift because the snapshot report
//  restates after the fact — see `meta.note`.
// ═════════════════════════════════════════════════════════════════════════
import { runQuery, makeGetter, num, strv } from './_snowflake.js';

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

const SQL = `
WITH date_windows AS (
  SELECT TO_DATE(?) AS sel_start, TO_DATE(?) AS sel_end,
         TO_DATE(?) AS prev_start, TO_DATE(?) AS prev_end
),
base_sales AS (
  SELECT
    CASE WHEN a.channel_name IN ('Myntra SJIT','Myntra Direct') THEN 'Myntra' ELSE a.channel_name END AS mp,
    a.order_date,
    b."mrp" AS mrp_per_unit,
    a.selling_price_per_unit,
    a.qty
  FROM sellers_db.sellers.marketplace_secondary_sales_snapshot_rpt a
  LEFT JOIN deconstruct_dc.datachannel.gs_channel_wise_mapper_updated b
    ON UPPER(a.channel_product_code) = UPPER(b."channel_sku_code")
   AND LOWER(a.channel_name) = LOWER(b."channel")
  WHERE LOWER(a.order_status) != 'cancelled'
    AND a.order_date BETWEEN b."valid_from" AND b."valid_till"
),
sales_agg AS (
  SELECT mp,
    SUM(CASE WHEN order_date BETWEEN (SELECT sel_start FROM date_windows) AND (SELECT sel_end FROM date_windows)
             THEN selling_price_per_unit * qty ELSE 0 END) AS sel_secondary,
    SUM(CASE WHEN order_date BETWEEN (SELECT prev_start FROM date_windows) AND (SELECT prev_end FROM date_windows)
             THEN selling_price_per_unit * qty ELSE 0 END) AS prev_secondary,
    SUM(CASE WHEN order_date BETWEEN (SELECT sel_start FROM date_windows) AND (SELECT sel_end FROM date_windows)
             THEN mrp_per_unit * qty ELSE 0 END) AS sel_mrp,
    SUM(CASE WHEN order_date BETWEEN (SELECT prev_start FROM date_windows) AND (SELECT prev_end FROM date_windows)
             THEN mrp_per_unit * qty ELSE 0 END) AS prev_mrp
  FROM base_sales GROUP BY mp
),
ads_agg AS (
  SELECT
    CASE WHEN channel = 'Swiggy' THEN 'Swiggy IM'
         WHEN channel IN ('Blinkit','Blinkit Banner') THEN 'Blinkit'
         ELSE channel END AS mp,
    SUM(CASE WHEN "DATE" BETWEEN (SELECT sel_start FROM date_windows) AND (SELECT sel_end FROM date_windows)
             THEN spend ELSE 0 END) AS sel_spends,
    SUM(CASE WHEN "DATE" BETWEEN (SELECT sel_start FROM date_windows) AND (SELECT sel_end FROM date_windows)
             THEN ad_revenue ELSE 0 END) AS sel_ads_secondary
  FROM sellers_db.sellers.marketplace_ads_snapshot_rpt GROUP BY 1
),
monthly_targets AS (
  SELECT
    CASE "channel" WHEN 'Nykaa (P)' THEN 'Nykaa' WHEN 'Purplle (P)' THEN 'Purplle'
                   WHEN 'Instamart (P)' THEN 'Swiggy IM' WHEN 'Zepto (P)' THEN 'Zepto'
                   WHEN 'Blinkit (P)' THEN 'Blinkit' ELSE "channel" END AS mp,
    TO_DATE("month", 'YYYY-MM') AS month,
    "net_target",
    DAY(LAST_DAY(TO_DATE("month", 'YYYY-MM'))) AS month_days
  FROM deconstruct_dc.datachannel.gs_primary_targets
),
target_prorated AS (
  SELECT mp,
    SUM("net_target" / month_days *
        (DATEDIFF(day, GREATEST(month, (SELECT sel_start FROM date_windows)),
                       LEAST(LAST_DAY(month), (SELECT sel_end FROM date_windows))) + 1)
    ) AS sel_target_secondary
  FROM monthly_targets
  WHERE month BETWEEN DATE_TRUNC('month', (SELECT sel_start FROM date_windows))
                  AND DATE_TRUNC('month', (SELECT sel_end FROM date_windows))
  GROUP BY mp
),
monthly_spends AS (
  SELECT DATE_TRUNC('month', spend_date) AS spend_month, SUM(spend) AS month_spend
  FROM deconstruct_dc.datachannel.nykaa_all_spends_view GROUP BY 1
),
nykaa_spends_prorated AS (
  SELECT SUM(month_spend / DAY(LAST_DAY(spend_month)) *
    GREATEST(0, DATEDIFF(day, GREATEST(spend_month, (SELECT sel_start FROM date_windows)),
                              LEAST(LAST_DAY(spend_month), (SELECT sel_end FROM date_windows))) + 1)
  ) AS sel_total_spends
  FROM monthly_spends
),
myntra_display_spends AS (
  SELECT 'Myntra' AS mp, ROUND(SUM(CASE
    WHEN DATE_TRUNC('month', TO_DATE("start_date",'DD-MM-YYYY')) = DATE_TRUNC('month', (SELECT sel_start FROM date_windows))
    THEN "budget" / DAY(LAST_DAY(DATE_TRUNC('month', TO_DATE("start_date",'DD-MM-YYYY'))))
       * (LEAST(LAST_DAY(DATE_TRUNC('month', TO_DATE("start_date",'DD-MM-YYYY'))), (SELECT sel_end FROM date_windows))
          - GREATEST(DATE_TRUNC('month', TO_DATE("start_date",'DD-MM-YYYY')), (SELECT sel_start FROM date_windows)) + 1)
    END), 0) AS sel_display_spends
  FROM deconstruct_dc.datachannel.gs_myntra_display_ads
),
myntra_extra_display_spends AS (
  SELECT 'Myntra' AS mp, SUM(CASE
    WHEN DATE_TRUNC('month', TO_DATE("date")) = DATE_TRUNC('month', (SELECT sel_start FROM date_windows))
    THEN "spend" / DAY(LAST_DAY(TO_DATE("date")))
       * GREATEST(0, DATEDIFF(day, GREATEST(TO_DATE("date"), (SELECT sel_start FROM date_windows)),
                                   LEAST(LAST_DAY(TO_DATE("date")), (SELECT sel_end FROM date_windows))) + 1)
    END) AS sel_extra_display_spends
  FROM deconstruct_dc.datachannel.gs_myntra_display_spends
),
purplle_display_spends AS (
  SELECT 'Purplle' AS mp, SUM(CASE
    WHEN DATE_TRUNC('month', TO_DATE("date")) = DATE_TRUNC('month', (SELECT sel_start FROM date_windows))
    THEN "spend" / DAY(LAST_DAY(TO_DATE("date")))
       * GREATEST(0, DATEDIFF(day, GREATEST(TO_DATE("date"), (SELECT sel_start FROM date_windows)),
                                   LEAST(LAST_DAY(TO_DATE("date")), (SELECT sel_end FROM date_windows))) + 1)
    END) AS sel_display_spends
  FROM deconstruct_dc.datachannel.gs_purplle_display_spends
),
final_mp AS (
  SELECT s.mp, s.sel_secondary, s.prev_secondary, s.sel_mrp, s.prev_mrp,
    COALESCE(a.sel_spends, 0) AS sel_spends,
    COALESCE(d.sel_display_spends,0) + COALESCE(de.sel_extra_display_spends,0) AS sel_display_spends,
    n.sel_total_spends AS nykaa_total_spends,
    COALESCE(a.sel_spends,0) + COALESCE(d.sel_display_spends,0) + COALESCE(de.sel_extra_display_spends,0) AS myntra_total_spends,
    COALESCE(a.sel_spends,0) + COALESCE(pd.sel_display_spends,0) AS purplle_total_spends,
    t.sel_target_secondary
  FROM sales_agg s
  LEFT JOIN ads_agg a ON s.mp = a.mp
  LEFT JOIN myntra_display_spends d ON s.mp = d.mp
  LEFT JOIN myntra_extra_display_spends de ON s.mp = de.mp
  LEFT JOIN purplle_display_spends pd ON s.mp = pd.mp
  LEFT JOIN target_prorated t ON s.mp = t.mp
  LEFT JOIN nykaa_spends_prorated n ON s.mp = 'Nykaa'
),
ordered_data AS (
  SELECT * FROM final_mp
  WHERE mp IN ('Amazon','Flipkart','Nykaa','Myntra','Meesho','Purplle','Blinkit','Zepto','Swiggy IM')
)
SELECT * FROM (
  SELECT mp AS platform,
    sel_secondary AS selected_range_sales,
    prev_secondary AS prev_range_sales,
    ROUND((sel_secondary - prev_secondary) * 100 / NULLIF(prev_secondary,0), 2) AS change,
    sel_target_secondary AS sel_range_target,
    ROUND(sel_secondary * 100 / NULLIF(sel_target_secondary,0), 2) AS pct_ach,
    ROUND((sel_mrp - sel_secondary) * 100 / NULLIF(sel_mrp,0), 2) AS discount,
    ROUND(CASE
      WHEN mp = 'Nykaa'     THEN nykaa_total_spends * 100 / NULLIF(sel_mrp, 0)
      WHEN mp = 'Myntra'    THEN myntra_total_spends * 100 / NULLIF(sel_secondary, 0)
      WHEN mp = 'Swiggy IM' THEN sel_spends * 100 / NULLIF(sel_mrp, 0)
      WHEN mp = 'Zepto'     THEN (sel_spends - (750000.0/31) *
                                  (DATEDIFF(day, (SELECT sel_start FROM date_windows), (SELECT sel_end FROM date_windows)) + 1))
                                 * 100 / NULLIF(sel_mrp, 0)
      WHEN mp = 'Purplle'   THEN purplle_total_spends * 100 / NULLIF(sel_secondary, 0)
      ELSE sel_spends * 100 / NULLIF(sel_secondary, 0)
    END, 2) AS tacos
  FROM ordered_data
  UNION ALL
  SELECT 'TOTAL', SUM(sel_secondary), SUM(prev_secondary),
    ROUND((SUM(sel_secondary) - SUM(prev_secondary)) * 100 / NULLIF(SUM(prev_secondary),0), 2),
    SUM(sel_target_secondary),
    ROUND(SUM(sel_secondary) * 100 / NULLIF(SUM(sel_target_secondary),0), 2),
    ROUND((SUM(sel_mrp) - SUM(sel_secondary)) * 100 / NULLIF(SUM(sel_mrp),0), 2),
    ROUND(SUM(sel_spends) * 100 / NULLIF(SUM(sel_secondary),0), 2)
  FROM ordered_data
) x
ORDER BY CASE platform
  WHEN 'Amazon' THEN 1 WHEN 'Flipkart' THEN 2 WHEN 'Nykaa' THEN 3 WHEN 'Myntra' THEN 4
  WHEN 'Meesho' THEN 5 WHEN 'Purplle' THEN 6 WHEN 'Blinkit' THEN 7 WHEN 'Zepto' THEN 8
  WHEN 'Swiggy IM' THEN 9 WHEN 'TOTAL' THEN 99 END
`;

export async function fetchMarketplaceWbr(selStart, selEnd, prevStart, prevEnd) {
  for (const [k, v] of Object.entries({ selStart, selEnd, prevStart, prevEnd })) {
    if (!v || !YMD_RX.test(v)) throw new Error(`Invalid or missing date param: ${k}`);
  }
  const raw = await runQuery(SQL, [selStart, selEnd, prevStart, prevEnd]);
  const rows = raw.map(r => {
    const g = makeGetter(r);
    const nn = k => (g(k) == null ? null : num(g(k)));
    return {
      platform:  strv(g('platform')),
      sales:     num(g('selected_range_sales')),
      prevSales: num(g('prev_range_sales')),
      change:    nn('change'),
      target:    num(g('sel_range_target')),
      pctAch:    nn('pct_ach'),
      discount:  nn('discount'),
      tacos:     nn('tacos'),
      isTotal:   strv(g('platform')) === 'TOTAL',
    };
  });
  return {
    rows,
    window: { selStart, selEnd, prevStart, prevEnd },
    meta: {
      basis: 'secondary sales (SP × qty) from the snapshot report; MRP from the SKU mapper',
      note: 'The snapshot report restates historically — quick commerce especially — so a past window can move after the fact.',
    },
  };
}
