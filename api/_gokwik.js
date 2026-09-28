// ─────────────────────────────────────────────────────────────────────────
//  _gokwik.js — GoKwik Engage retention dashboard.
//
//  Retention messaging on the D2C website: WhatsApp / SMS / RCS / email /
//  voice campaigns, abandoned-cart recovery, and lifecycle automations.
//
//  THREE source sheets, unioned — the Hex notebook does the same, and the
//  union is the point: the three are one programme measured in three places.
//    gs_kwik_engage_campaign_data           one-off campaign blasts
//    gs_kwik_engage_gokwik_abc_data         abandoned-cart recovery
//    gs_kwik_engage_other_automations_data  lifecycle automations
//
//  Column naming differs across them and the mapping is NOT cosmetic:
//  the ABC sheet reports `recovered_amount` / `recovered_carts` where the
//  others report `sales` / `orders`. Cart recovery and campaign sales are
//  different events; the notebook rolls them into one figure and so does
//  this, but `bySource` keeps them separable so the blend can be unpicked.
//
//  ── `WHERE "name" NOT ILIKE 'Order%'` ──
//  Carried over from the notebook, and it earns its place: it drops 1,776
//  rows of TRANSACTIONAL notifications — Order Confirmation, Order
//  Delivered, Out for Delivery, Order Cancelled. Those are operational
//  messages every buyer gets, not retention marketing, and leaving them in
//  would swamp the funnel with traffic nobody chose to send. `meta.excluded`
//  reports what it costs so the filter is visible rather than folklore.
//
//  ── What the notebook leaves out ──
//  Its scorecard stops at Sent / Delivered / Seen / Clicks / Sales / Spends
//  / Orders / CTR% / ROI. The sheets also carry `unsubscribers` and
//  `buyers`. For a RETENTION dashboard the unsubscribe rate is close to the
//  whole point — it is the cost of the sends, and a programme that lifts
//  revenue while burning the list is not working. Both are surfaced here.
// ─────────────────────────────────────────────────────────────────────────
import { runQuery, makeGetter, num, strv } from './_snowflake.js';

const D = 'DECONSTRUCT_DC.DATACHANNEL';
const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

// The union, written once. Each arm normalises that sheet's column names to
// one shape and tags its source, so every downstream aggregate is a plain
// GROUP BY rather than three special cases.
const N = c => `TRY_TO_DOUBLE(TO_VARCHAR("${c}"))`;
const ARM = (table, source, salesCol, ordersCol) => `
  SELECT
    '${source}'                              AS source,
    strv_name                                AS campaign,
    LOWER(TRIM(TO_VARCHAR("channel")))       AS channel,
    TRY_TO_DATE(TO_VARCHAR("date"))          AS dt,
    ${N('sent')}                             AS sent,
    ${N('delivered')}                        AS delivered,
    ${N('seen')}                             AS seen,
    ${N('clicks')}                           AS clicks,
    ${N(salesCol)}                           AS sales,
    ${N('cost')}                             AS spends,
    ${N(ordersCol)}                          AS orders,
    ${N('buyers')}                           AS buyers,
    ${N('unsubscribers')}                    AS unsubs
  FROM (SELECT *, TRIM(TO_VARCHAR("name")) AS strv_name FROM ${D}.${table})
  WHERE strv_name NOT ILIKE 'Order%'`;

const BASE = `
  ${ARM('GS_KWIK_ENGAGE_CAMPAIGN_DATA', 'Campaigns', 'sales', 'orders')}
  UNION ALL
  ${ARM('GS_KWIK_ENGAGE_GOKWIK_ABC_DATA', 'Abandoned cart', 'recovered_amount', 'recovered_carts')}
  UNION ALL
  ${ARM('GS_KWIK_ENGAGE_OTHER_AUTOMATIONS_DATA', 'Other automations', 'sales', 'orders')}`;

const SUMS = `
  ROUND(SUM(COALESCE(sent, 0)), 2)      AS sent,
  ROUND(SUM(COALESCE(delivered, 0)), 2) AS delivered,
  ROUND(SUM(COALESCE(seen, 0)), 2)      AS seen,
  ROUND(SUM(COALESCE(clicks, 0)), 2)    AS clicks,
  ROUND(SUM(COALESCE(sales, 0)), 2)     AS sales,
  ROUND(SUM(COALESCE(spends, 0)), 2)    AS spends,
  ROUND(SUM(COALESCE(orders, 0)), 2)    AS orders,
  ROUND(SUM(COALESCE(buyers, 0)), 2)    AS buyers,
  ROUND(SUM(COALESCE(unsubs, 0)), 2)    AS unsubs`;

const div = (a, b) => (b > 0 ? a / b : null);

/* Shape one window's sums into the funnel and its derived rates.

   Every rate names its own denominator, because they differ and the choice
   matters. CTR here is clicks ÷ SEEN, matching the notebook — not the more
   common clicks ÷ delivered, which would report roughly half the number.
   Calling both "CTR" without saying which is how two dashboards end up
   disagreeing about the same programme. */
function shape(r) {
  const g = makeGetter(r || {});
  const sent = num(g('sent')), delivered = num(g('delivered')), seen = num(g('seen'));
  const clicks = num(g('clicks')), sales = num(g('sales')), spends = num(g('spends'));
  const orders = num(g('orders')), buyers = num(g('buyers')), unsubs = num(g('unsubs'));
  return {
    sent, delivered, seen, clicks, sales, spends, orders, buyers, unsubs,
    deliveryRate: pctOf(delivered, sent),      // of sent
    seenRate: pctOf(seen, delivered),          // of delivered
    ctr: pctOf(clicks, seen),                  // of SEEN — the notebook's definition
    clickRate: pctOf(clicks, delivered),       // of DELIVERED — comparable across channels
    clickToOrder: pctOf(orders, clicks),       // of clicks
    orderPerSend: pctOf(orders, sent),         // of sent — end-to-end yield
    unsubRate: pctOf(unsubs, sent),            // of sent — the cost of the send
    roas: div(sales, spends),
    aov: div(sales, orders),
    costPerOrder: div(spends, orders),
    revenuePerSend: div(sales, sent),
  };
}
const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : null);

export async function fetchGokwik(opts = {}) {
  const { from, to, prevFrom, prevTo } = opts;
  for (const [k, v] of Object.entries({ from, to, prevFrom, prevTo })) {
    if (!v || !YMD_RX.test(v)) throw new Error(`Invalid or missing date param: ${k}`);
  }

  // Client-supplied values go in as binds, never interpolated.
  const parts = [];
  const fBinds = [];
  const add = (col, list) => {
    const arr = (Array.isArray(list) ? list : String(list || '').split(','))
      .map(s => strv(s)).filter(Boolean);
    if (!arr.length) return;
    parts.push(`AND ${col} IN (${arr.map(() => '?').join(', ')})`);
    fBinds.push(...arr);
  };
  add('channel', opts.channels);
  add('source', opts.sources);
  add('campaign', opts.campaigns);
  const filt = parts.join('\n      ');

  const scoped = `
    WITH base AS (${BASE}),
    f AS (SELECT * FROM base WHERE dt IS NOT NULL ${filt})`;

  // Two passes for the two windows, rather than one CASE-heavy query. Both
  // hit the same small CTE (~8k rows after the union) so the second is
  // effectively free, and the SQL stays readable.
  const qWindow = (a, b) => runQuery(
    `${scoped} SELECT ${SUMS} FROM f WHERE dt BETWEEN TO_DATE(?) AND TO_DATE(?)`,
    [...fBinds, a, b]);

  const qDaily = () => runQuery(
    `${scoped}
     SELECT TO_CHAR(dt, 'YYYY-MM-DD') AS d, ${SUMS}
     FROM f WHERE dt BETWEEN TO_DATE(?) AND TO_DATE(?)
     GROUP BY 1 ORDER BY 1`, [...fBinds, from, to]);

  // Per-dimension cur/prev. Written out rather than generated by regex from
  // SUMS: a silent mismatch between the two prefixes would put one window's
  // numbers under the other's label, which no test on the totals would catch.
  const FIELDS = ['sent', 'delivered', 'seen', 'clicks', 'sales', 'spends', 'orders', 'buyers', 'unsubs'];
  const winSum = prefix => FIELDS
    .map(f => `ROUND(SUM(CASE WHEN dt BETWEEN TO_DATE(?) AND TO_DATE(?) THEN COALESCE(${f}, 0) ELSE 0 END), 2) AS ${prefix}_${f}`)
    .join(',\n       ');
  const qDim = (col) => {
    // One (from, to) pair per field, in field order, then the same for prev.
    const curDates = FIELDS.flatMap(() => [from, to]);
    const prevDates = FIELDS.flatMap(() => [prevFrom, prevTo]);
    const lo = prevFrom < from ? prevFrom : from;
    const hi = prevTo > to ? prevTo : to;
    return runQuery(
      `${scoped}
       SELECT ${col} AS k,
       ${winSum('cur')},
       ${winSum('prev')}
       FROM f WHERE dt BETWEEN TO_DATE(?) AND TO_DATE(?)
       GROUP BY 1`,
      [...fBinds, ...curDates, ...prevDates, lo, hi]);
  };

  // What the 'Order%' filter costs, so the exclusion is inspectable.
  const qExcluded = () => runQuery(
    `SELECT COUNT(*) AS rows_, ROUND(SUM(${N('sent')}), 0) AS sent
     FROM (
       SELECT "sent", "name" FROM ${D}.GS_KWIK_ENGAGE_CAMPAIGN_DATA
       UNION ALL SELECT "sent", "name" FROM ${D}.GS_KWIK_ENGAGE_GOKWIK_ABC_DATA
       UNION ALL SELECT "sent", "name" FROM ${D}.GS_KWIK_ENGAGE_OTHER_AUTOMATIONS_DATA
     ) WHERE TRIM(TO_VARCHAR("name")) ILIKE 'Order%'`, []);

  const [selRaw, cmpRaw, dailyRaw, chanRaw, srcRaw, campRaw, exclRaw] = await Promise.all([
    qWindow(from, to), qWindow(prevFrom, prevTo), qDaily(),
    qDim('channel'), qDim('source'), qDim('campaign'), qExcluded(),
  ]);

  const sel = shape(selRaw[0]);
  const prev = shape(cmpRaw[0]);

  const daily = dailyRaw.map(r => ({ key: strv(makeGetter(r)('d')), ...shape(r) }));

  // cur/prev per dimension, reusing shape() so a rate is never computed two
  // different ways in two different panels.
  const splitDim = rows => rows.map(r => {
    const g = makeGetter(r);
    const pickPrefix = p => {
      const o = {};
      for (const k of FIELDS) o[k.toUpperCase()] = num(g(p + '_' + k));
      return o;
    };
    return { key: strv(g('k')), cur: shape(pickPrefix('cur')), prev: shape(pickPrefix('prev')) };
  }).filter(r => r.cur.sent > 0 || r.prev.sent > 0);

  const channels = splitDim(chanRaw).sort((a, b) => b.cur.sent - a.cur.sent);
  const sources = splitDim(srcRaw).sort((a, b) => b.cur.sales - a.cur.sales);
  const campaigns = splitDim(campRaw).sort((a, b) => b.cur.sales - a.cur.sales);

  const eg = makeGetter(exclRaw[0] || {});

  /* ── the CTR denominator problem ──────────────────────────────────────
     SMS and voice cannot report opens, so their `seen` is 0 while their
     clicks are real. Clicks ÷ Seen therefore puts those clicks in the
     numerator with nothing beneath them, and the blend comes out ABOVE
     every individual channel: 10.80% against WhatsApp's 9.36% and RCS's
     3.55%, which is arithmetically impossible as a weighted average.

     The notebook's CTR is kept so this tab reconciles with it, but the
     like-for-like figure — clicks from open-tracking channels only, over
     the same channels' seen — is computed alongside, and the share of
     clicks coming from untracked channels is reported so the gap is
     explainable rather than mysterious. */
  const trackedCtr = (rows, side) => {
    let seen = 0, clicks = 0, untrackedClicks = 0, untrackedSent = 0;
    for (const r of rows) {
      const s = r[side];
      if (s.seen > 0) { seen += s.seen; clicks += s.clicks; }
      else { untrackedClicks += s.clicks; untrackedSent += s.sent; }
    }
    return {
      ctrTracked: pctOf(clicks, seen),
      untrackedClicks, untrackedSent,
      untrackedClickShare: pctOf(untrackedClicks, clicks + untrackedClicks),
    };
  };
  const selTracked = trackedCtr(channels, 'cur');
  const prevTracked = trackedCtr(channels, 'prev');
  sel.ctrTracked = selTracked.ctrTracked;
  prev.ctrTracked = prevTracked.ctrTracked;

  return {
    window: { from, to, prevFrom, prevTo },
    sel, prev, daily, channels, sources, campaigns,
    meta: {
      tables: [
        `${D}.GS_KWIK_ENGAGE_CAMPAIGN_DATA`,
        `${D}.GS_KWIK_ENGAGE_GOKWIK_ABC_DATA`,
        `${D}.GS_KWIK_ENGAGE_OTHER_AUTOMATIONS_DATA`,
      ],
      excluded: { rows: num(eg('rows_')), sent: num(eg('sent')) },
      ctrBasis: 'Clicks ÷ Seen, as in the Hex notebook — not clicks ÷ delivered.',
      openTracking: {
        tracked: channels.filter(c => c.cur.seen > 0).map(c => c.key),
        untracked: channels.filter(c => c.cur.sent > 0 && !(c.cur.seen > 0)).map(c => c.key),
        untrackedClickShare: selTracked.untrackedClickShare,
        untrackedSendShare: pctOf(selTracked.untrackedSent, sel.sent),
      },
      abcNote: 'Abandoned cart contributes recovered_amount as sales and recovered_carts as orders; cart recovery and campaign sales are blended in the headline but split under Sources.',
      excludedNote: "Rows whose campaign name starts with \"Order\" are excluded: they are transactional notifications (Order Confirmation, Delivered, Out for Delivery), not retention marketing.",
    },
  };
}

/* Filter option lists, ranked by volume so the pickers open on what matters. */
export async function fetchGokwikFilters() {
  const rows = await runQuery(
    `WITH base AS (${BASE})
     SELECT 'channel' AS kind, channel AS v, SUM(COALESCE(sent,0)) AS u FROM base GROUP BY 1,2
     UNION ALL
     SELECT 'source', source, SUM(COALESCE(sent,0)) FROM base GROUP BY 1,2
     UNION ALL
     SELECT 'campaign', campaign, SUM(COALESCE(sent,0)) FROM base GROUP BY 1,2
     ORDER BY 3 DESC`, []);
  const out = { channels: [], sources: [], campaigns: [] };
  const key = { channel: 'channels', source: 'sources', campaign: 'campaigns' };
  for (const r of rows) {
    const g = makeGetter(r);
    const v = strv(g('v'));
    if (v) out[key[strv(g('kind'))]].push(v);
  }
  return out;
}
