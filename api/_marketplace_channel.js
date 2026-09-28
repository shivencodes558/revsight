// ═════════════════════════════════════════════════════════════════════════
//  PER-CHANNEL SCORECARD (WBR - Marketplace, channel sections)
//  Every channel section in the notebook is the same template with a
//  `WHERE channel_name = '<Channel>'`, so this is one generic query rather
//  than nine hand-written ones. Amazon alone carries three extras — storefront
//  traffic (sessions / page views / CVR) and DSP spend — returned as null for
//  other channels rather than faked.
//
//  Percentage metrics report their change in BASIS POINTS (a percentage-point
//  move), value metrics in percent — the notebook's convention, and the honest
//  one: TACOS moving 15% → 12% is −300bps, not −20%.
// ═════════════════════════════════════════════════════════════════════════
import { runQuery, makeGetter, num } from './_snowflake.js';

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

// sales-side channel_name values that collapse into one display channel
const SALES_PRED = { Myntra: `IN ('Myntra SJIT','Myntra Direct')` };
// ads-side channel values that collapse
const ADS_PRED = {
  'Swiggy IM': `IN ('Swiggy')`,
  Blinkit:     `IN ('Blinkit','Blinkit Banner')`,
};

export const MP_CHANNELS = [
  'Amazon', 'Flipkart', 'Nykaa', 'Myntra', 'Meesho', 'Purplle', 'Blinkit', 'Zepto', 'Swiggy IM',
];

export async function fetchMarketplaceChannelWbr(channel, selStart, selEnd, prevStart, prevEnd) {
  for (const [k, v] of Object.entries({ selStart, selEnd, prevStart, prevEnd })) {
    if (!v || !YMD_RX.test(v)) throw new Error(`Invalid or missing date param: ${k}`);
  }
  if (!MP_CHANNELS.includes(channel)) throw new Error(`Unknown channel: ${channel}`);

  const salesPred = SALES_PRED[channel] || `= '${channel.replace(/'/g, "''")}'`;
  const adsPred   = ADS_PRED[channel]   || `= '${channel.replace(/'/g, "''")}'`;
  const isAmazon  = channel === 'Amazon';

  const amazonCtes = `
    , traffic AS (
      SELECT
        COALESCE(SUM(CASE WHEN d BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN sessions ELSE 0 END),0) AS sel_sessions,
        COALESCE(SUM(CASE WHEN d BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN sessions ELSE 0 END),0) AS prev_sessions,
        COALESCE(SUM(CASE WHEN d BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN pv ELSE 0 END),0) AS sel_pv,
        COALESCE(SUM(CASE WHEN d BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN pv ELSE 0 END),0) AS prev_pv
      FROM (
        SELECT COALESCE(TRY_TO_DATE("date",'DD-MM-YYYY'), TRY_TO_DATE("date",'YYYY-MM-DD')) AS d,
               TRY_TO_DOUBLE(TO_VARCHAR("trafficbyasin_sessions"))  AS sessions,
               TRY_TO_DOUBLE(TO_VARCHAR("trafficbyasin_pageviews")) AS pv
        FROM deconstruct_dc.datachannel.asc_sales_and_traffic_report_by_asin
      )
    ), dsp AS (
      SELECT
        COALESCE(SUM(CASE WHEN d BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN sp ELSE 0 END),0) AS sel_dsp,
        COALESCE(SUM(CASE WHEN d BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN sp ELSE 0 END),0) AS prev_dsp
      FROM (
        SELECT COALESCE(TRY_TO_DATE("date",'DD-MM-YYYY'), TRY_TO_DATE("date",'YYYY-MM-DD')) AS d,
               TRY_TO_DOUBLE(TO_VARCHAR("spend")) AS sp
        FROM deconstruct_dc.datachannel.gs_amazon_dsp_spends
      )
    )`;

  // Off-platform display spend, prorated across the window. Only three channels
  // report it; the rest get a null Display Spends row rather than a fake zero.
  const DISPLAY = {
    Myntra: `
      , display AS (
        SELECT
          COALESCE(SUM(CASE WHEN d BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN sp ELSE 0 END),0) AS sel_display,
          COALESCE(SUM(CASE WHEN d BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN sp ELSE 0 END),0) AS prev_display
        FROM (
          SELECT TO_DATE("date") AS d, TRY_TO_DOUBLE(TO_VARCHAR("spend")) AS sp
          FROM deconstruct_dc.datachannel.gs_myntra_display_spends
          UNION ALL
          SELECT TO_DATE("start_date",'DD-MM-YYYY') AS d, TRY_TO_DOUBLE(TO_VARCHAR("budget")) AS sp
          FROM deconstruct_dc.datachannel.gs_myntra_display_ads
        )
      )`,
    Purplle: `
      , display AS (
        SELECT
          COALESCE(SUM(CASE WHEN d BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN sp ELSE 0 END),0) AS sel_display,
          COALESCE(SUM(CASE WHEN d BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN sp ELSE 0 END),0) AS prev_display
        FROM (
          SELECT TO_DATE("date") AS d, TRY_TO_DOUBLE(TO_VARCHAR("spend")) AS sp
          FROM deconstruct_dc.datachannel.gs_purplle_display_spends
        )
      )`,
    Nykaa: `
      , display AS (
        SELECT
          COALESCE(SUM(CASE WHEN spend_date BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN spend ELSE 0 END),0) AS sel_display,
          COALESCE(SUM(CASE WHEN spend_date BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN spend ELSE 0 END),0) AS prev_display
        FROM deconstruct_dc.datachannel.nykaa_all_spends_view
      )`,
  };
  const displayCte = DISPLAY[channel] || '';
  const hasDisplay = !!displayCte;

  const sql = `
    WITH dw AS (
      SELECT TO_DATE(?) AS sel_start, TO_DATE(?) AS sel_end,
             TO_DATE(?) AS prev_start, TO_DATE(?) AS prev_end,
             DATEDIFF(day, TO_DATE(?), TO_DATE(?)) + 1 AS range_days
    ),
    base AS (
      SELECT a.order_date, b."mrp" AS mrp_per_unit, a.selling_price_per_unit, a.qty
      FROM sellers_db.sellers.marketplace_secondary_sales_snapshot_rpt a
      LEFT JOIN deconstruct_dc.datachannel.gs_channel_wise_mapper_updated b
        ON UPPER(a.channel_product_code) = UPPER(b."channel_sku_code")
       AND LOWER(a.channel_name) = LOWER(b."channel")
      WHERE LOWER(a.order_status) != 'cancelled'
        AND a.order_date BETWEEN b."valid_from" AND b."valid_till"
        AND a.channel_name ${salesPred}
    ),
    sales_agg AS (
      SELECT
        SUM(CASE WHEN order_date BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN qty ELSE 0 END) AS sel_units,
        SUM(CASE WHEN order_date BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN qty ELSE 0 END) AS prev_units,
        SUM(CASE WHEN order_date BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN selling_price_per_unit * qty ELSE 0 END) AS sel_secondary,
        SUM(CASE WHEN order_date BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN selling_price_per_unit * qty ELSE 0 END) AS prev_secondary,
        SUM(CASE WHEN order_date BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN mrp_per_unit * qty ELSE 0 END) AS sel_mrp,
        SUM(CASE WHEN order_date BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN mrp_per_unit * qty ELSE 0 END) AS prev_mrp
      FROM base
    ),
    ads_agg AS (
      SELECT
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN spend ELSE 0 END),0) AS sel_spends,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN spend ELSE 0 END),0) AS prev_spends,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN ad_revenue ELSE 0 END),0) AS sel_ads_mrp,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN ad_revenue ELSE 0 END),0) AS prev_ads_mrp,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN clicks ELSE 0 END),0) AS sel_clicks,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN clicks ELSE 0 END),0) AS prev_clicks,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN units ELSE 0 END),0) AS sel_ads_units,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN units ELSE 0 END),0) AS prev_ads_units,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT sel_start FROM dw) AND (SELECT sel_end FROM dw) THEN impressions ELSE 0 END),0) AS sel_imp,
        COALESCE(SUM(CASE WHEN "DATE" BETWEEN (SELECT prev_start FROM dw) AND (SELECT prev_end FROM dw) THEN impressions ELSE 0 END),0) AS prev_imp
      FROM sellers_db.sellers.marketplace_ads_snapshot_rpt
      WHERE channel ${adsPred}
    )${isAmazon ? amazonCtes : ''}${displayCte}
    SELECT s.*, a.*, (SELECT range_days FROM dw) AS range_days
      ${isAmazon ? ', t.sel_sessions, t.prev_sessions, t.sel_pv, t.prev_pv, p.sel_dsp, p.prev_dsp' : ''}
      ${hasDisplay ? ', dsps.sel_display, dsps.prev_display' : ''}
    FROM sales_agg s CROSS JOIN ads_agg a
      ${isAmazon ? 'CROSS JOIN traffic t CROSS JOIN dsp p' : ''}
      ${hasDisplay ? 'CROSS JOIN display dsps' : ''}
  `;

  const raw = await runQuery(sql, [selStart, selEnd, prevStart, prevEnd, selStart, selEnd]);
  const g = makeGetter(raw[0] || {});
  const N = k => num(g(k));
  const days = N('range_days') || 1;
  const div = (a, b) => (b ? a / b : null);

  const win = p => ({
    units: N(p + 'units'), sec: N(p + 'secondary'), mrp: N(p + 'mrp'),
    spends: N(p + 'spends'), adsMrp: N(p + 'ads_mrp'),
    clicks: N(p + 'clicks'), adsUnits: N(p + 'ads_units'), imp: N(p + 'imp'),
    sessions: isAmazon ? N(p + 'sessions') : null,
    pv: isAmazon ? N(p + 'pv') : null,
    dsp: isAmazon ? N(p + 'dsp') : null,
    display: hasDisplay ? N(p + 'display') : null,
  });
  const S = win('sel_'), P = win('prev_');
  // total spend = platform ads + any off-platform display
  const tot = w => w.spends + (w.display || 0) + (w.dsp || 0);

  // `pct: true` → change reported in basis points; `invert` → down is good
  const rows = [
    { key: 'mrpSales', label: 'MRP Sales',  fmt: 'inr',   sel: S.mrp,   prev: P.mrp },
    { key: 'units',    label: 'Units Sold', fmt: 'int',   sel: S.units, prev: P.units },
    { key: 'secSales', label: 'Sec Sales',  fmt: 'inr',   sel: S.sec,   prev: P.sec },
    { key: 'drr',      label: 'DRR units',  fmt: 'int',   sel: div(S.units, days), prev: div(P.units, days) },
    { key: 'avgMrp',   label: 'Avg MRP',    fmt: 'rupee', sel: div(S.mrp, S.units), prev: div(P.mrp, P.units) },
    { key: 'asp',      label: 'ASP',        fmt: 'rupee', sel: div(S.sec, S.units), prev: div(P.sec, P.units) },
    { key: 'discount', label: 'Discount %', fmt: 'pct', pct: true, invert: true,
      sel:  S.mrp ? ((S.mrp - S.sec) / S.mrp) * 100 : null,
      prev: P.mrp ? ((P.mrp - P.sec) / P.mrp) * 100 : null },
  ];

  if (isAmazon) rows.push(
    { key: 'sessions', label: 'Overall Sessions', fmt: 'int', sel: S.sessions, prev: P.sessions },
    { key: 'pv',       label: 'Overall PV',       fmt: 'int', sel: S.pv,       prev: P.pv },
    { key: 'cvr',      label: 'Overall CVR %',    fmt: 'pct', pct: true,
      sel:  S.sessions ? (S.units / S.sessions) * 100 : null,
      prev: P.sessions ? (P.units / P.sessions) * 100 : null });

  rows.push(
    { key: 'tacos', label: 'TACOS %', fmt: 'pct', pct: true, invert: true,
      sel: S.sec ? (S.spends / S.sec) * 100 : null, prev: P.sec ? (P.spends / P.sec) * 100 : null },
    { key: 'organic', label: 'Organic Share %', fmt: 'pct', pct: true,
      sel: S.sec ? ((S.sec - S.adsMrp) / S.sec) * 100 : null,
      prev: P.sec ? ((P.sec - P.adsMrp) / P.sec) * 100 : null },
    { key: 'acos', label: 'ACOS %', fmt: 'pct', pct: true, invert: true,
      sel: S.adsMrp ? (S.spends / S.adsMrp) * 100 : null,
      prev: P.adsMrp ? (P.spends / P.adsMrp) * 100 : null },
    { key: 'adsCvr', label: 'Ads CVR %', fmt: 'pct1', pct: true,
      sel: S.clicks ? (S.adsUnits / S.clicks) * 100 : null,
      prev: P.clicks ? (P.adsUnits / P.clicks) * 100 : null },
    { key: 'roi',       label: 'Ads ROI',    fmt: 'x',   sel: div(S.adsMrp, S.spends), prev: div(P.adsMrp, P.spends) },
    { key: 'adsSales',  label: 'Ads Sales',  fmt: 'inr', sel: S.adsMrp, prev: P.adsMrp },
    { key: 'adsUnits',  label: 'Ads Units',  fmt: 'int', sel: S.adsUnits, prev: P.adsUnits },
    { key: 'adsSpends', label: 'Ads Spends', fmt: 'inr', invert: true, sel: S.spends, prev: P.spends },
    { key: 'imp',       label: 'Impressions', fmt: 'int', sel: S.imp, prev: P.imp },
    { key: 'clicks',    label: 'Clicks',      fmt: 'int', sel: S.clicks, prev: P.clicks },
    { key: 'ctr',       label: 'CTR %', fmt: 'pct1', pct: true,
      sel: S.imp ? (S.clicks / S.imp) * 100 : null, prev: P.imp ? (P.clicks / P.imp) * 100 : null },
  );

  if (isAmazon) rows.push(
    { key: 'dsp', label: 'DSP Spends', fmt: 'inr', invert: true, sel: S.dsp, prev: P.dsp });
  if (hasDisplay) rows.push(
    { key: 'display', label: 'Display Spends', fmt: 'inr', invert: true, sel: S.display, prev: P.display });
  if (isAmazon || hasDisplay) rows.push(
    { key: 'totalSpends', label: 'Total Spends', fmt: 'inr', invert: true, sel: tot(S), prev: tot(P) },
    { key: 'totalTacos', label: 'Total TACOS %', fmt: 'pct', pct: true, invert: true,
      sel: S.sec ? (tot(S) / S.sec) * 100 : null, prev: P.sec ? (tot(P) / P.sec) * 100 : null });

  return {
    channel, rows, rangeDays: days,
    window: { selStart, selEnd, prevStart, prevEnd },
    meta: { hasTraffic: isAmazon, note: 'Percentage metrics report change in basis points.' },
  };
}
