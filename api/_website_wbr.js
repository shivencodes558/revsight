// ═════════════════════════════════════════════════════════════════════════
//  WEBSITE WBR
//  The Hex "WBR - Website" metric list over two arbitrary windows, rather than
//  the daily report's fixed selected-date / MTD / MTD-previous triple. Same
//  sources and conventions as fetchWebsiteDaily so the two reconcile:
//
//   • Sales  → MARKETPLACE_SECONDARY_SALES_RPT, channel 'Website', restricted
//     to orders with a New/Repeating customer record.
//   • Ads    → FACEBOOK_GOOGLE_ADS_RPT, split Google ('Google_ads') vs Meta
//     ('Facebook','Instagram','Meta').
//   • Organic = sales − paid swift revenue, where paid is the WBR's UTM rule
//     (medium cpc/paid, or source fb/facebook/google/snapchat/criteo/jiohotstar).
//   • Cost grosses ad spend up by 18% GST; ROI and TACOS run off cost, not
//     raw spend.
//
//  Percentage metrics carry `pct: true` so the UI reports their change in
//  basis points rather than as a percent-of-a-percent.
// ═════════════════════════════════════════════════════════════════════════
import { runQuery, makeGetter, num } from './_snowflake.js';

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;
const GST = 1.18;

export async function fetchWebsiteWbr(selStart, selEnd, prevStart, prevEnd) {
  for (const [k, v] of Object.entries({ selStart, selEnd, prevStart, prevEnd })) {
    if (!v || !YMD_RX.test(v)) throw new Error(`Invalid or missing date param: ${k}`);
  }

  const sql = `
    WITH dw AS (
      SELECT TO_DATE(?) AS s1, TO_DATE(?) AS s2, TO_DATE(?) AS p1, TO_DATE(?) AS p2,
             DATEDIFF(day, TO_DATE(?), TO_DATE(?)) + 1 AS sel_days,
             DATEDIFF(day, TO_DATE(?), TO_DATE(?)) + 1 AS prev_days
    ),
    web AS (
      SELECT s.order_date AS dt,
        CASE WHEN s.order_status = 'sales' THEN TRY_TO_DOUBLE(TO_VARCHAR(s.selling_price_per_unit)) * TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) ELSE 0 END AS net,
        CASE WHEN LOWER(TRIM(s.order_status)) = 'returns' THEN TRY_TO_DOUBLE(TO_VARCHAR(s.selling_price_per_unit)) * TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) ELSE 0 END AS rnet,
        CASE WHEN s.order_status = 'sales' THEN TRY_TO_DOUBLE(TO_VARCHAR(s.mapper_mrp_per_unit)) * TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) ELSE 0 END AS gross,
        CASE WHEN LOWER(TRIM(s.order_status)) = 'returns' THEN TRY_TO_DOUBLE(TO_VARCHAR(s.mapper_mrp_per_unit)) * TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) ELSE 0 END AS rgross,
        s.order_number, s.order_status
      FROM SELLERS_DB.SELLERS.MARKETPLACE_SECONDARY_SALES_RPT s
      WHERE s.channel_name = 'Website'
        AND EXISTS (
          SELECT 1 FROM SELLERS_DB.SELLERS.WEBSITE_NEW_REPEAT_CUSTOMER nrc
          WHERE REPLACE(nrc.order_name, '#', '') = REPLACE(s.order_number, '#', '')
            AND nrc.customer_status IN ('New','Repeating')
        )
    ),
    web_agg AS (
      SELECT
        SUM(CASE WHEN dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw) THEN net + rnet ELSE 0 END) AS sel_sales,
        SUM(CASE WHEN dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw) THEN net + rnet ELSE 0 END) AS prev_sales,
        SUM(CASE WHEN dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw) THEN gross + rgross ELSE 0 END) AS sel_gross,
        SUM(CASE WHEN dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw) THEN gross + rgross ELSE 0 END) AS prev_gross,
        COUNT(DISTINCT CASE WHEN dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw) AND order_status='sales' THEN order_number END) AS sel_orders,
        COUNT(DISTINCT CASE WHEN dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw) AND order_status='sales' THEN order_number END) AS prev_orders
      FROM web
    ),
    ads AS (
      SELECT CAST(TO_DATE(TO_VARCHAR("DATE")) AS DATE) AS dt, TO_VARCHAR(channel) AS ch,
             TRY_TO_DOUBLE(TO_VARCHAR(impressions))      AS imp,
             TRY_TO_DOUBLE(TO_VARCHAR(link_clicks))       AS clk,
             TRY_TO_DOUBLE(TO_VARCHAR(ad_spend))          AS sp,
             TRY_TO_DOUBLE(TO_VARCHAR(conversions))       AS cv,
             TRY_TO_DOUBLE(TO_VARCHAR(conversion_value))  AS cval
      FROM SELLERS_DB.SELLERS.FACEBOOK_GOOGLE_ADS_RPT
    ),
    ads_agg AS (
      SELECT
        SUM(IFF(dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), imp, 0))  AS sel_imp,
        SUM(IFF(dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), imp, 0))  AS prev_imp,
        SUM(IFF(dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), clk, 0))  AS sel_clk,
        SUM(IFF(dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), clk, 0))  AS prev_clk,
        SUM(IFF(dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), sp, 0))   AS sel_spend,
        SUM(IFF(dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), sp, 0))   AS prev_spend,
        SUM(IFF(dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), cv, 0))   AS sel_conv,
        SUM(IFF(dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), cv, 0))   AS prev_conv,
        SUM(IFF(dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), cval, 0)) AS sel_cval,
        SUM(IFF(dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), cval, 0)) AS prev_cval,
        SUM(IFF(ch='Google_ads' AND dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), imp, 0)) AS sel_gimp,
        SUM(IFF(ch='Google_ads' AND dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), imp, 0)) AS prev_gimp,
        SUM(IFF(ch='Google_ads' AND dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), clk, 0)) AS sel_gclk,
        SUM(IFF(ch='Google_ads' AND dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), clk, 0)) AS prev_gclk,
        SUM(IFF(ch='Google_ads' AND dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), sp, 0))  AS sel_gsp,
        SUM(IFF(ch='Google_ads' AND dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), sp, 0))  AS prev_gsp,
        SUM(IFF(ch IN ('Facebook','Instagram','Meta') AND dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), imp, 0)) AS sel_mimp,
        SUM(IFF(ch IN ('Facebook','Instagram','Meta') AND dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), imp, 0)) AS prev_mimp,
        SUM(IFF(ch IN ('Facebook','Instagram','Meta') AND dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), clk, 0)) AS sel_mclk,
        SUM(IFF(ch IN ('Facebook','Instagram','Meta') AND dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), clk, 0)) AS prev_mclk,
        SUM(IFF(ch IN ('Facebook','Instagram','Meta') AND dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), sp, 0))  AS sel_msp,
        SUM(IFF(ch IN ('Facebook','Instagram','Meta') AND dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), sp, 0))  AS prev_msp
      FROM ads
    ),
    swift AS (
      SELECT DISTINCT REPLACE("shopify_order_name", '#', '') AS oid,
             CAST(TRY_TO_TIMESTAMP("created_at", 'DD/MM/YYYY HH12:MI AM') AS DATE) AS dt,
             TRY_TO_DOUBLE(TO_VARCHAR("grand_total")) AS val
      FROM DECONSTRUCT_DC.DATACHANNEL.GD_GOKWIK_ORDERS_RPT
      WHERE LOWER(TRIM("utm_medium")) IN ('cpc','paid')
         OR LOWER(TRIM("utm_source")) IN ('fb','facebook','google','snapchat','criteo','jiohotstar')
    ),
    swift_agg AS (
      SELECT
        SUM(IFF(dt BETWEEN (SELECT s1 FROM dw) AND (SELECT s2 FROM dw), val, 0)) AS sel_swrev,
        SUM(IFF(dt BETWEEN (SELECT p1 FROM dw) AND (SELECT p2 FROM dw), val, 0)) AS prev_swrev
      FROM swift
    )
    SELECT w.*, a.*, s.*, (SELECT sel_days FROM dw) AS sel_days, (SELECT prev_days FROM dw) AS prev_days
    FROM web_agg w CROSS JOIN ads_agg a CROSS JOIN swift_agg s
  `;

  const raw = await runQuery(sql, [selStart, selEnd, prevStart, prevEnd, selStart, selEnd, prevStart, prevEnd]);
  const g = makeGetter(raw[0] || {});
  const N = k => num(g(k));
  const div = (a, b) => (b ? a / b : null);

  const win = (p, days) => {
    const sales = N(p + 'sales'), gross = N(p + 'gross'), orders = N(p + 'orders');
    const spend = N(p + 'spend'), cost = spend * GST, swrev = N(p + 'swrev');
    return {
      sales, gross, orders, spend, cost, swrev, days,
      imp: N(p + 'imp'), clk: N(p + 'clk'), conv: N(p + 'conv'), cval: N(p + 'cval'),
      gimp: N(p + 'gimp'), gclk: N(p + 'gclk'), gsp: N(p + 'gsp'),
      mimp: N(p + 'mimp'), mclk: N(p + 'mclk'), msp: N(p + 'msp'),
      org: sales - swrev,
    };
  };
  const S = win('sel_', N('sel_days') || 1);
  const P = win('prev_', N('prev_days') || 1);

  const R = (key, label, fmt, sel, prev, extra = {}) => ({ key, label, fmt, sel, prev, ...extra });
  const rows = [
    R('mrpSales', 'MRP Sales', 'inr', S.gross, P.gross),
    R('orders',   'Orders',    'int', S.orders, P.orders),
    R('secSales', 'Sec Sales', 'inr', S.sales, P.sales),
    R('drr',      'DRR-Orders','int', div(S.orders, S.days), div(P.orders, P.days)),
    R('asp',      'ASP',       'rupee', div(S.sales, S.orders), div(P.sales, P.orders)),
    R('discount', 'Discount %','pct', S.gross ? (1 - S.sales / S.gross) * 100 : null,
                                      P.gross ? (1 - P.sales / P.gross) * 100 : null, { pct: true, invert: true }),

    R('imp',   'Overall Impressions', 'int', S.imp,  P.imp),
    R('gimp',  'Google Impressions',  'int', S.gimp, P.gimp),
    R('mimp',  'Meta Impressions',    'int', S.mimp, P.mimp),
    R('clk',   'Overall Clicks',      'int', S.clk,  P.clk),
    R('gclk',  'Google Clicks',       'int', S.gclk, P.gclk),
    R('mclk',  'Meta Clicks',         'int', S.mclk, P.mclk),
    R('ctr',   'Overall CTR %',  'pct1', S.imp  ? (S.clk / S.imp) * 100   : null, P.imp  ? (P.clk / P.imp) * 100   : null, { pct: true }),
    R('gctr',  'Google CTR %',   'pct1', S.gimp ? (S.gclk / S.gimp) * 100 : null, P.gimp ? (P.gclk / P.gimp) * 100 : null, { pct: true }),
    R('mctr',  'Meta CTR %',     'pct1', S.mimp ? (S.mclk / S.mimp) * 100 : null, P.mimp ? (P.mclk / P.mimp) * 100 : null, { pct: true }),
    R('cvr',   'Overall CVR %',  'pct1', S.clk  ? (S.orders / S.clk) * 100 : null, P.clk ? (P.orders / P.clk) * 100 : null, { pct: true }),

    R('tacos',    'TACOS %',    'pct', S.sales ? (S.cost / S.sales) * 100 : null, P.sales ? (P.cost / P.sales) * 100 : null, { pct: true, invert: true }),
    R('orgSales', 'Org Sales',  'inr', S.org, P.org),
    R('orgShare', 'Org Share %','pct', S.sales ? (S.org / S.sales) * 100 : null, P.sales ? (P.org / P.sales) * 100 : null, { pct: true }),
    R('acos',     'ACOS %',     'pct', S.cval ? (S.cost / S.cval) * 100 : null, P.cval ? (P.cost / P.cval) * 100 : null, { pct: true, invert: true }),
    R('adsCvr',   'Ads CVR %',  'pct1', S.clk ? (S.conv / S.clk) * 100 : null, P.clk ? (P.conv / P.clk) * 100 : null, { pct: true }),
    R('roi',      'Overall ROI','x',   div(S.sales, S.cost), div(P.sales, P.cost)),
    R('adsSales', 'Ads Sales',  'inr', S.cval, P.cval),
    R('adsSpend', 'Ads Spend',  'inr', S.spend, P.spend, { invert: true }),
    R('gspend',   'Google Ad Spend', 'inr', S.gsp, P.gsp, { invert: true }),
    R('mspend',   'Meta Ad Spend',   'inr', S.msp, P.msp, { invert: true }),
    R('cost',     'Cost (incl. GST)','inr', S.cost, P.cost, { invert: true }),
  ];

  return {
    rows,
    window: { selStart, selEnd, prevStart, prevEnd, selDays: S.days, prevDays: P.days },
    meta: {
      basis: 'D2C website · secondary sales incl. returns; cost = ad spend × 1.18 GST',
      note: 'Organic is sales minus paid-attributed swift orders. Percentage metrics change in basis points.',
    },
  };
}
