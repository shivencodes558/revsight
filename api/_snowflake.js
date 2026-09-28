// ─────────────────────────────────────────────────────────────────────────
//  _snowflake.js — shared backend logic for the Revenue dashboard.
//  Imported by BOTH server.js (local Express) and every function under /api
//  (Vercel serverless). Single source of truth — no twin duplication.
//
//  Contains: key-pair auth, runQuery, cell helpers, the CHANNEL registry,
//  the order-status filter, and the aggregation queries.
//
//  Source of truth: SELLERS_DB.SELLERS.MARKETPLACE_SECONDARY_SALES_RPT
//  Revenue conventions (from the Hex "All Channels : Data" notebook):
//    • SP  Sales  = SUM(SELLING_PRICE_PER_UNIT * QTY)
//    • MRP Sales  = SUM(MAPPER_MRP_PER_UNIT   * QTY)   ← mapper MRP, not source
//    • Volume     = SUM(QTY)
//    • SUB_CATEGORY is the breakdown dim; Freebie/Others are excluded
//  Credentials come from env vars (.env locally, Vercel env in prod).
// ─────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import snowflake from 'snowflake-sdk';
import { parseDate } from './_dates.js';

// ── silence the SDK's own logging in serverless (keeps Vercel logs clean) ──
try { snowflake.configure({ logLevel: 'ERROR' }); } catch (_) {}

const SALES_VIEW = 'SELLERS_DB.SELLERS.MARKETPLACE_SECONDARY_SALES_RPT';

// ─────────────────────────────────────────────────────────────────────────
//  ORDER-STATUS FILTER  ← CONFIRMED from the Hex "All Channels : Data"
//  notebook's orders_status_select default (22 statuses). This is the
//  authoritative "what counts as revenue" definition and reconciles the
//  dashboard with the WBR. It is a GROSS convention: shipped orders that later
//  returned/bounced (Shipped - Returned to Seller, Returning to Seller,
//  Rejected by Buyer, Undeliverable, Lost in Transit, Pending - Label
//  Cancelled) are deliberately included — revenue recognised at dispatch.
//
//  Matched EXACTLY (case-sensitive): the view mixes casing per channel
//  (DELIVERED vs Shipped vs sales vs WP), and this list already contains the
//  precise variants Hex ticks, so we must not lowercase or we'd pull in
//  statuses that weren't selected.
// ─────────────────────────────────────────────────────────────────────────
const STATUS_MODE = 'include'; // 'include' | 'exclude' | 'all'
const STATUS_SET = [
  'Completed',
  'DELIVERED',
  'Pending - Label Cancelled',
  'Pending - Waiting for Pick Up',
  'Picked Up',
  'READY_TO_SHIP',
  'SHIPPED',
  'Shipped',
  'Shipped - Delivered to Buyer',
  'Shipped - Damaged',
  'Shipped - Lost in Transit',
  'Shipped - Out for Delivery',
  'Shipped - Picked Up',
  'Shipped - Rejected by Buyer',
  'Shipped - Returned to Seller',
  'Shipped - Returning to Seller',
  'Shipped - Undeliverable',
  'Shipping',
  'Confirmed',
  'sales',
  'Pending',
  'WP',
];


// ── cell helpers (Snowflake returns UPPERCASE keys unless quoted) ──
const num = v => (v == null || v === '' ? 0 : (typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0));
const strv = v => (v == null ? '' : String(v).trim());
function makeGetter(row) {
  const keys = Object.keys(row);
  return (name) => {
    const want = String(name).toLowerCase();
    const k = keys.find(k => k.toLowerCase() === want);
    return k == null ? null : row[k];
  };
}

// ── private key: inline contents (SNOWFLAKE_PRIVATE_KEY) or file path ──
function loadPrivateKey() {
  const inline = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (inline && inline.trim()) {
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }
  const p = process.env.SNOWFLAKE_PRIVATE_KEY_PATH;
  if (!p) throw new Error('Set SNOWFLAKE_PRIVATE_KEY (contents) or SNOWFLAKE_PRIVATE_KEY_PATH (file path) in .env');
  if (!fs.existsSync(p)) throw new Error('Private key file not found at: ' + p);
  return fs.readFileSync(p, 'utf8');
}

function makeConnection() {
  const opts = {
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USERNAME,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: loadPrivateKey(),
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
  };
  if (process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE) {
    opts.privateKeyPass = process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
  }
  return snowflake.createConnection(opts);
}

// ── run a query, resolve rows as array of objects. Connection per request,
//    destroyed on completion (same pattern as Adsight — fine for serverless). ──
function runQuery(sqlText, binds = []) {
  return new Promise((resolve, reject) => {
    const conn = makeConnection();
    conn.connect((err, c) => {
      if (err) return reject(new Error('Connect failed: ' + err.message));
      c.execute({
        sqlText, binds,
        complete: (e2, stmt, rows) => {
          try { c.destroy(() => {}); } catch (_) {}
          if (e2) return reject(new Error('Query failed: ' + e2.message));
          resolve(rows || []);
        },
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  CHANNEL REGISTRY — the analog of Adsight's PLATFORMS config.
//  Maps the raw CHANNEL_NAME values in the view to canonical display names,
//  merges Myntra SJIT/Direct → Myntra, renames Swiggy IM → Instamart, and
//  carries display metadata (group + accent colour). Add a channel by adding
//  one entry; unknown channels fall through with their raw name + a warning.
// ─────────────────────────────────────────────────────────────────────────
const CHANNEL_META = {
  // canonical:            { group,          color }
  'Amazon':      { group: 'Marketplace', color: '#FF9900' },
  'Flipkart':    { group: 'Marketplace', color: '#2874F0' },
  'Myntra':      { group: 'Marketplace', color: '#FF3E6C' },
  'Nykaa':       { group: 'Marketplace', color: '#FC2779' },
  'Purplle':     { group: 'Marketplace', color: '#8B2C8F' },
  'Meesho':      { group: 'Marketplace', color: '#F43397' },
  'Cred':        { group: 'Marketplace', color: '#111111' },
  'Smytten':     { group: 'Marketplace', color: '#6C5CE7' },
  'Tata Cliq':   { group: 'Marketplace', color: '#E01A22' },
  'Blinkit':     { group: 'Q-Commerce',  color: '#F8CB46' },
  'Zepto':       { group: 'Q-Commerce',  color: '#4E2A84' },
  'Instamart':   { group: 'Q-Commerce',  color: '#FC8019' },
  'Website':     { group: 'D2C',         color: '#00B8A9' },
};

// canonical → the raw CHANNEL_NAME value(s) in the view. Only the merged ones
// differ; everything else is its own source name. Used to filter the view when
// a deep-dive selects a channel (e.g. "Myntra" → both SJIT and Direct rows).
const CHANNEL_SOURCES = {
  'Myntra':    ['Myntra SJIT', 'Myntra Direct'],
  'Instamart': ['Swiggy IM'],
};
function sourceNamesFor(canon) {
  return CHANNEL_SOURCES[canon] || [canon];
}

// raw CHANNEL_NAME (lowercased) → canonical display name
const CHANNEL_ALIASES = {
  'myntra sjit':   'Myntra',
  'myntra direct': 'Myntra',
  'swiggy im':     'Instamart',
  'cred':          'Cred',
};

function canonChannel(rawName) {
  const raw = strv(rawName);
  const key = raw.toLowerCase();
  if (CHANNEL_ALIASES[key]) return CHANNEL_ALIASES[key];
  // exact meta match (case-insensitive)
  const hit = Object.keys(CHANNEL_META).find(c => c.toLowerCase() === key);
  return hit || raw; // unknown → pass raw through (visible, not dropped)
}
function channelGroup(canon, rawType) {
  if (CHANNEL_META[canon]) return CHANNEL_META[canon].group;
  // fall back to the view's CHANNEL_TYPE, normalised
  const t = strv(rawType).toLowerCase();
  if (t.includes('q_commerce') || t.includes('q-commerce')) return 'Q-Commerce';
  if (t.includes('d2c')) return 'D2C';
  return 'Marketplace';
}

// ── build the status WHERE fragment. Matched EXACTLY (no lowercasing) against
//    the confirmed Hex list. No user input flows here — STATUS_SET is a server
//    constant — so inlining is injection-safe. ──
function statusFilterSQL() {
  if (STATUS_MODE === 'all') return '';
  const list = STATUS_SET.map(s => `'${String(s).replace(/'/g, "''")}'`).join(', ');
  const op = STATUS_MODE === 'include' ? 'IN' : 'NOT IN';
  return `AND order_status ${op} (${list})`;
}

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────
//  /api/overall — channel × day rollup at all three bases.
//  Aggregates in SQL (order-line grain would blow the function timeout if
//  pulled raw), normalises ORDER_DATE via TRY_TO_DATE so mixed DATE/VARCHAR
//  branches in the UNION all land cleanly, excludes Freebie/Others, applies
//  the status filter, and merges Myntra variants channel-side in JS.
// ─────────────────────────────────────────────────────────────────────────
async function fetchOverall(from, to) {
  const binds = [];
  let dateFilter = '';
  if (from && YMD_RX.test(from)) { dateFilter += ' AND D >= TO_DATE(?)'; binds.push(from); }
  if (to && YMD_RX.test(to))     { dateFilter += ' AND D <= TO_DATE(?)'; binds.push(to); }

  // Every numeric is wrapped in TRY_TO_DOUBLE: several branches of the view emit
  // qty/prices as VARCHAR ('1', text), which makes a bare `price * qty` throw a
  // "Numeric value ... is not recognized" error at aggregation. TRY_ coerces
  // safely (bad values → NULL → ignored by SUM) instead of failing the query.
  const sql = `
    WITH src AS (
      SELECT
        TO_VARCHAR(channel_type)                             AS channel_type,
        TO_VARCHAR(channel_name)                             AS channel_name,
        TRY_TO_DATE(TO_VARCHAR(order_date))                  AS D,
        TO_VARCHAR(order_status)                             AS order_status,
        TO_VARCHAR(sub_category)                             AS sub_category,
        TRY_TO_DOUBLE(TO_VARCHAR(selling_price_per_unit))    AS sp_unit,
        TRY_TO_DOUBLE(TO_VARCHAR(mapper_mrp_per_unit))       AS mrp_unit,
        TRY_TO_DOUBLE(TO_VARCHAR(qty))                       AS qty,
        TO_VARCHAR(order_number)                             AS order_number
      FROM ${SALES_VIEW}
    )
    SELECT
      channel_type,
      channel_name,
      TO_CHAR(D, 'YYYY-MM-DD')                              AS d,
      SUM(COALESCE(sp_unit, 0)  * COALESCE(qty, 0))         AS sp_total,
      SUM(COALESCE(mrp_unit, 0) * COALESCE(qty, 0))         AS mrp_total,
      SUM(COALESCE(qty, 0))                                 AS units,
      COUNT(DISTINCT NULLIF(order_number, ''))              AS orders
    FROM src
    WHERE D IS NOT NULL
      AND (sub_category IS NULL OR LOWER(sub_category) NOT IN ('freebie', 'others'))
      ${statusFilterSQL()}
      ${dateFilter}
    GROUP BY channel_type, channel_name, D
    ORDER BY D
  `;

  const raw = await runQuery(sql, binds);

  // ── map to canonical channels, merging Myntra variants / renaming Swiggy.
  //    Keyed by canonical channel + date so merges sum correctly. ──
  const byKey = new Map();
  const unknown = {};
  for (const r of raw) {
    const g = makeGetter(r);
    const rawName = g('channel_name');
    const canon = canonChannel(rawName);
    if (!CHANNEL_META[canon]) { unknown[strv(rawName) || '(empty)'] = (unknown[strv(rawName) || '(empty)'] || 0) + 1; }
    const group = channelGroup(canon, g('channel_type'));
    const date = parseDate(g('d')); // already ISO from SQL; validated safety net
    if (!date) continue;
    const key = canon + '|' + date;
    let row = byKey.get(key);
    if (!row) {
      row = { channel: canon, group, date, sp: 0, mrp: 0, units: 0, orders: 0 };
      byKey.set(key, row);
    }
    row.sp += num(g('sp_total'));
    row.mrp += num(g('mrp_total'));
    row.units += num(g('units'));
    row.orders += num(g('orders'));
  }

  if (Object.keys(unknown).length) {
    console.log('[overall] channels not in CHANNEL_META (passed through raw):',
      Object.entries(unknown).map(([c, n]) => `${c} (${n})`).join(' | '));
  }

  const rows = [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    rows,
    meta: {
      view: SALES_VIEW,
      statusMode: STATUS_MODE,
      statusConfirmed: true, // locked to Hex orders_status_select default
      statusSet: STATUS_MODE === 'all' ? null : STATUS_SET,
      channelColors: Object.fromEntries(Object.entries(CHANNEL_META).map(([k, v]) => [k, v.color])),
      channelGroups: Object.fromEntries(Object.entries(CHANNEL_META).map(([k, v]) => [k, v.group])),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  /api/channel-detail — SKU-level rollup for ONE channel over a date window.
//  Powers the Channel Deep-Dive's SKU table and sub-category mix. Aggregated
//  server-side (period totals per SKU, ~300 rows), same view + status filter
//  as /api/overall so it reconciles. Unmapped SKUs are kept (grouped under
//  '(unmapped)') and surfaced, not dropped — MRP relies on the mapper join, so
//  unmapped rows contribute 0 MRP while still counting in SP/units.
// ─────────────────────────────────────────────────────────────────────────
async function fetchChannelDetail(name, from, to) {
  // validate the channel against the known registry (name comes from the client)
  const canon = Object.keys(CHANNEL_META).find(c => c.toLowerCase() === strv(name).toLowerCase());
  if (!canon) throw new Error(`Unknown channel: ${strv(name) || '(empty)'}`);

  const sources = sourceNamesFor(canon).map(s => `'${s.replace(/'/g, "''")}'`).join(', ');

  const binds = [];
  let dateFilter = '';
  if (from && YMD_RX.test(from)) { dateFilter += ' AND D >= TO_DATE(?)'; binds.push(from); }
  if (to && YMD_RX.test(to))     { dateFilter += ' AND D <= TO_DATE(?)'; binds.push(to); }

  const sql = `
    WITH src AS (
      SELECT
        TO_VARCHAR(channel_name)                             AS channel_name,
        TRY_TO_DATE(TO_VARCHAR(order_date))                  AS D,
        TO_VARCHAR(order_status)                             AS order_status,
        TO_VARCHAR(sub_category)                             AS sub_category,
        TO_VARCHAR(sku)                                      AS sku,
        TO_VARCHAR(product_name)                             AS product_name,
        TRY_TO_DOUBLE(TO_VARCHAR(selling_price_per_unit))    AS sp_unit,
        TRY_TO_DOUBLE(TO_VARCHAR(mapper_mrp_per_unit))       AS mrp_unit,
        TRY_TO_DOUBLE(TO_VARCHAR(qty))                       AS qty,
        TO_VARCHAR(order_number)                             AS order_number
      FROM ${SALES_VIEW}
    )
    SELECT
      COALESCE(sku, '(unmapped)')                          AS sku,
      COALESCE(product_name, '(unmapped product)')         AS product_name,
      COALESCE(sub_category, '(uncategorised)')            AS sub_category,
      SUM(COALESCE(sp_unit, 0)  * COALESCE(qty, 0))        AS sp_total,
      SUM(COALESCE(mrp_unit, 0) * COALESCE(qty, 0))        AS mrp_total,
      SUM(COALESCE(qty, 0))                                AS units,
      COUNT(DISTINCT NULLIF(order_number, ''))             AS orders
    FROM src
    WHERE D IS NOT NULL
      AND channel_name IN (${sources})
      AND (sub_category IS NULL OR sub_category NOT IN ('Freebie', 'Others'))
      ${statusFilterSQL()}
      ${dateFilter}
    GROUP BY 1, 2, 3
    ORDER BY mrp_total DESC
  `;

  const raw = await runQuery(sql, binds);
  const skus = raw.map(r => {
    const g = makeGetter(r);
    return {
      sku: strv(g('sku')),
      product: strv(g('product_name')),
      subCategory: strv(g('sub_category')),
      sp: num(g('sp_total')),
      mrp: num(g('mrp_total')),
      units: num(g('units')),
      orders: num(g('orders')),
      unmapped: strv(g('sku')) === '(unmapped)',
    };
  });

  return { channel: canon, group: (CHANNEL_META[canon] || {}).group || 'Marketplace', skus };
}

// ─────────────────────────────────────────────────────────────────────────
//  /api/cube — the analytics cube powering the executive page and deep-dive.
//  One scan returns channel × category × sub-category × SKU with BOTH the
//  current and prior window totals (conditional aggregation), so the frontend
//  derives leaderboards, treemaps, heatmaps, movers, and the drill-down
//  hierarchy from a single fetch — every interaction after load is instant.
//  A params CTE keeps it to 4 binds instead of repeating dates per aggregate.
// ─────────────────────────────────────────────────────────────────────────
async function fetchCube(from, to, prevFrom, prevTo) {
  for (const [k, v] of Object.entries({ from, to, prevFrom, prevTo })) {
    if (!v || !YMD_RX.test(v)) throw new Error(`Invalid or missing date param: ${k}`);
  }

  const sql = `
    WITH params AS (
      SELECT TO_DATE(?) AS cf, TO_DATE(?) AS ct, TO_DATE(?) AS pf, TO_DATE(?) AS pt
    ),
    src AS (
      SELECT
        TO_VARCHAR(channel_type)                             AS channel_type,
        TO_VARCHAR(channel_name)                             AS channel_name,
        TRY_TO_DATE(TO_VARCHAR(order_date))                  AS D,
        TO_VARCHAR(order_status)                             AS order_status,
        TO_VARCHAR(category)                                 AS category,
        TO_VARCHAR(sub_category)                             AS sub_category,
        TO_VARCHAR(sku)                                      AS sku,
        TO_VARCHAR(product_name)                             AS product_name,
        TRY_TO_DOUBLE(TO_VARCHAR(selling_price_per_unit))    AS sp_unit,
        TRY_TO_DOUBLE(TO_VARCHAR(mapper_mrp_per_unit))       AS mrp_unit,
        TRY_TO_DOUBLE(TO_VARCHAR(qty))                       AS qty
      FROM ${SALES_VIEW}
    )
    SELECT
      channel_type,
      channel_name,
      COALESCE(category, '(uncategorised)')                  AS cat,
      COALESCE(sub_category, '(uncategorised)')              AS subcat,
      COALESCE(sku, '(unmapped)')                            AS sku,
      COALESCE(product_name, COALESCE(sku, '(unmapped)'))    AS product,
      ROUND(SUM(CASE WHEN D BETWEEN p.cf AND p.ct THEN COALESCE(sp_unit,0)*COALESCE(qty,0)  ELSE 0 END), 2) AS cur_sp,
      ROUND(SUM(CASE WHEN D BETWEEN p.cf AND p.ct THEN COALESCE(mrp_unit,0)*COALESCE(qty,0) ELSE 0 END), 2) AS cur_mrp,
      ROUND(SUM(CASE WHEN D BETWEEN p.cf AND p.ct THEN COALESCE(qty,0)                      ELSE 0 END), 2) AS cur_units,
      ROUND(SUM(CASE WHEN D BETWEEN p.pf AND p.pt THEN COALESCE(sp_unit,0)*COALESCE(qty,0)  ELSE 0 END), 2) AS prev_sp,
      ROUND(SUM(CASE WHEN D BETWEEN p.pf AND p.pt THEN COALESCE(mrp_unit,0)*COALESCE(qty,0) ELSE 0 END), 2) AS prev_mrp,
      ROUND(SUM(CASE WHEN D BETWEEN p.pf AND p.pt THEN COALESCE(qty,0)                      ELSE 0 END), 2) AS prev_units
    FROM src CROSS JOIN params p
    WHERE D IS NOT NULL
      AND D >= p.pf AND D <= p.ct
      AND (sub_category IS NULL OR sub_category NOT IN ('Freebie', 'Others'))
      ${statusFilterSQL()}
    GROUP BY 1, 2, 3, 4, 5, 6
    HAVING cur_mrp <> 0 OR cur_sp <> 0 OR cur_units <> 0
        OR prev_mrp <> 0 OR prev_sp <> 0 OR prev_units <> 0
  `;

  const raw = await runQuery(sql, [from, to, prevFrom, prevTo]);

  // canonical-channel merge (Myntra SJIT + Direct → Myntra, Swiggy IM → Instamart):
  // the same SKU can appear under both source names, so re-key and sum.
  const byKey = new Map();
  for (const r of raw) {
    const g = makeGetter(r);
    const canon = canonChannel(g('channel_name'));
    const group = channelGroup(canon, g('channel_type'));
    const cat = strv(g('cat'));
    const subcat = strv(g('subcat'));
    const sku = strv(g('sku'));
    const key = [canon, cat, subcat, sku].join('|');
    let row = byKey.get(key);
    if (!row) {
      row = {
        channel: canon, group, category: cat, subCategory: subcat,
        sku, product: strv(g('product')),
        curSp: 0, curMrp: 0, curUnits: 0, prevSp: 0, prevMrp: 0, prevUnits: 0,
        unmapped: sku === '(unmapped)',
      };
      byKey.set(key, row);
    }
    row.curSp += num(g('cur_sp'));     row.curMrp += num(g('cur_mrp'));   row.curUnits += num(g('cur_units'));
    row.prevSp += num(g('prev_sp'));   row.prevMrp += num(g('prev_mrp')); row.prevUnits += num(g('prev_units'));
  }

  return { rows: [...byKey.values()] };
}

export {
  runQuery, fetchOverall, fetchChannelDetail, fetchCube, SALES_VIEW,
  CHANNEL_META, canonChannel, channelGroup, statusFilterSQL,
  makeGetter, num, strv,
};

// ═════════════════════════════════════════════════════════════════════════
//  PRIMARY SALES (Daily Business Report) — replicates the Hex notebook
//  exactly: D-1 summary (selected date vs same day last month, Flipkart
//  compared one extra day back), M-1 MTD summary (per-channel month windows,
//  Flipkart effective end = date-1, last-day fix), freshness, and targets.
//  Snapshot vs Attributed = two source tables, chosen per request.
// ═════════════════════════════════════════════════════════════════════════
const PRIMARY_VIEWS = {
  snapshot:   'SELLERS_DB.SELLERS.PRIMARY_SALES',
  attributed: 'SELLERS_DB.SELLERS.PRIMARY_SALES_ATTRIBUTED',
};

// ── ORDER_STATUS exclusions ← PROVISIONAL. Hex shows "not one of Cancelled,
//    F, +13" (16 values) but the chip is collapsed in the screenshot. These
//    are the visible + most likely values; correct this ONE list once you
//    read the full chip in Hex. Matching is exact (Hex filter is exact). ──
const PRIMARY_EXCLUDE_STATUSES = [
  'Cancelled', 'CANCELLED', 'cancelled',
  'F', 'Failed', 'FAILED',
  'Lost', 'LOST',
  'RTO', 'Returned', 'RETURNED', 'Returns', 'Return',
  'DISPOSED', 'HOLD', 'Open',
];

// Hex channel ordering — group order then channel order, Total last.
const PRIMARY_GROUP_ORDER = { 'B2C': 1, 'B2B': 2, 'Q-Commerce': 3, 'Total': 4 };
const PRIMARY_CHANNEL_ORDER = [
  'Website', 'Flipkart', 'Amazon', 'Myntra', 'Meesho', 'Smytten', 'Cred',
  'Tata Cliq', 'Pharmeasy-API', 'Nykaa (P)', 'Purplle (P)', 'Reliance (P)',
  'Blinkit (P)', 'Bigbasket (P)', 'Zepto (P)', 'Instamart (P)',
  'Flipkart Minutes (P)', 'Amazon_Now(P)', 'Myntra_Now(P)',
];
function primarySort(a, b) {
  const g = (PRIMARY_GROUP_ORDER[a.group] || 99) - (PRIMARY_GROUP_ORDER[b.group] || 99);
  if (g !== 0) return g;
  const ia = PRIMARY_CHANNEL_ORDER.indexOf(a.channel); const ib = PRIMARY_CHANNEL_ORDER.indexOf(b.channel);
  return (ia < 0 ? 900 : ia) - (ib < 0 ? 900 : ib);
}

function primaryExcludeSQL() {
  return PRIMARY_EXCLUDE_STATUSES.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
}

// shared normalised source CTE (Smytten-New merge, TRY casts, Hex row filters:
// mapper MRP not null · Freebie/Others out · status exclusions)
function primarySrcSQL(view) {
  return `
    src AS (
      SELECT
        CASE WHEN TO_VARCHAR(channel_name) = 'Smytten-New' THEN 'Smytten' ELSE TO_VARCHAR(channel_name) END AS ch,
        TO_VARCHAR(channel_group)                          AS grp,
        TRY_TO_DATE(TO_VARCHAR(order_date))                AS d,
        TRY_TO_DOUBLE(TO_VARCHAR(qty))                     AS qty,
        TRY_TO_DOUBLE(TO_VARCHAR(net))                     AS net,
        TRY_TO_DOUBLE(TO_VARCHAR(mapper_mrp_per_unit))     AS mrp_u
      FROM ${view}
      WHERE mapper_mrp_per_unit IS NOT NULL
        AND (sub_category IS NULL OR TO_VARCHAR(sub_category) NOT IN ('Freebie', 'Others'))
        AND TO_VARCHAR(order_status) NOT IN (${primaryExcludeSQL()})
    )`;
}

// D-1: selected date vs same day last month; Flipkart uses date-1 / (lm)-1.
async function fetchPrimaryD1(dataset, projectDate) {
  const view = PRIMARY_VIEWS[dataset] || PRIMARY_VIEWS.snapshot;
  if (!projectDate || !YMD_RX.test(projectDate)) throw new Error('Invalid date');
  const sql = `
    WITH params AS (
      SELECT TO_DATE(?) AS pd,
             DATEADD(month, -1, TO_DATE(?)) AS lm,
             DATEADD(day, -1, TO_DATE(?))   AS fpd,
             DATEADD(day, -1, DATEADD(month, -1, TO_DATE(?))) AS flm
    ),
    ${primarySrcSQL(view)},
    f AS (
      SELECT s.*,
        CASE WHEN s.ch = 'Flipkart' THEN p.fpd ELSE p.pd END AS cd,
        CASE WHEN s.ch = 'Flipkart' THEN p.flm ELSE p.lm END AS pv,
        CASE WHEN s.ch = 'Meesho' THEN COALESCE(s.net,0)*COALESCE(s.qty,0) ELSE COALESCE(s.net,0) END AS netv
      FROM src s CROSS JOIN params p
      WHERE s.d IS NOT NULL
        AND s.d IN (CASE WHEN s.ch='Flipkart' THEN p.fpd ELSE p.pd END,
                    CASE WHEN s.ch='Flipkart' THEN p.flm ELSE p.lm END)
    )
    SELECT grp, ch,
      SUM(CASE WHEN d = cd THEN COALESCE(qty,0)   ELSE 0 END) AS u_sel,
      SUM(CASE WHEN d = pv THEN COALESCE(qty,0)   ELSE 0 END) AS u_prev,
      SUM(CASE WHEN d = cd THEN COALESCE(mrp_u,0)*COALESCE(qty,0) ELSE 0 END) AS g_sel,
      SUM(CASE WHEN d = pv THEN COALESCE(mrp_u,0)*COALESCE(qty,0) ELSE 0 END) AS g_prev,
      SUM(CASE WHEN d = cd THEN netv ELSE 0 END) AS n_sel,
      SUM(CASE WHEN d = pv THEN netv ELSE 0 END) AS n_prev
    FROM f GROUP BY grp, ch
  `;
  const raw = await runQuery(sql, [projectDate, projectDate, projectDate, projectDate]);
  return raw.map(r => { const g = makeGetter(r); return {
    group: strv(g('grp')), channel: strv(g('ch')),
    uSel: num(g('u_sel')), uPrev: num(g('u_prev')),
    gSel: num(g('g_sel')), gPrev: num(g('g_prev')),
    nSel: num(g('n_sel')), nPrev: num(g('n_prev')),
  }; }).sort(primarySort);
}

// M-1: MTD vs same-length prior MTD; Flipkart effective end = date-1;
// last-day fix (eff at month end → full prior month).
async function fetchPrimaryMTD(dataset, projectDate) {
  const view = PRIMARY_VIEWS[dataset] || PRIMARY_VIEWS.snapshot;
  if (!projectDate || !YMD_RX.test(projectDate)) throw new Error('Invalid date');
  const sql = `
    WITH params AS ( SELECT TO_DATE(?) AS pd ),
    ${primarySrcSQL(view)},
    f AS (
      SELECT s.*,
        CASE WHEN s.ch='Flipkart' THEN DATEADD(day,-1,p.pd) ELSE p.pd END AS eff,
        CASE WHEN s.ch = 'Meesho' THEN COALESCE(s.net,0)*COALESCE(s.qty,0) ELSE COALESCE(s.net,0) END AS netv
      FROM src s CROSS JOIN params p WHERE s.d IS NOT NULL
    ),
    w AS (
      SELECT f.*,
        DATE_TRUNC('month', eff) AS tms,
        DATE_TRUNC('month', DATEADD(month,-1,eff)) AS lms,
        CASE WHEN eff = LAST_DAY(eff)
             THEN LAST_DAY(DATE_TRUNC('month', DATEADD(month,-1,eff)))
             ELSE DATEADD(day, DAY(eff)-1, DATE_TRUNC('month', DATEADD(month,-1,eff)))
        END AS lme
      FROM f
    )
    SELECT grp, ch,
      SUM(CASE WHEN d BETWEEN tms AND eff THEN COALESCE(qty,0) ELSE 0 END) AS u_sel,
      SUM(CASE WHEN d BETWEEN lms AND lme THEN COALESCE(qty,0) ELSE 0 END) AS u_prev,
      SUM(CASE WHEN d BETWEEN tms AND eff THEN COALESCE(mrp_u,0)*COALESCE(qty,0) ELSE 0 END) AS g_sel,
      SUM(CASE WHEN d BETWEEN lms AND lme THEN COALESCE(mrp_u,0)*COALESCE(qty,0) ELSE 0 END) AS g_prev,
      SUM(CASE WHEN d BETWEEN tms AND eff THEN netv ELSE 0 END) AS n_sel,
      SUM(CASE WHEN d BETWEEN lms AND lme THEN netv ELSE 0 END) AS n_prev
    FROM w
    WHERE d BETWEEN lms AND eff
    GROUP BY grp, ch
  `;
  const raw = await runQuery(sql, [projectDate]);
  return raw.map(r => { const g = makeGetter(r); return {
    group: strv(g('grp')), channel: strv(g('ch')),
    uSel: num(g('u_sel')), uPrev: num(g('u_prev')),
    gSel: num(g('g_sel')), gPrev: num(g('g_prev')),
    nSel: num(g('n_sel')), nPrev: num(g('n_prev')),
  }; }).sort(primarySort);
}

async function fetchPrimaryFreshness(dataset) {
  const view = PRIMARY_VIEWS[dataset] || PRIMARY_VIEWS.snapshot;
  const sql = `
    WITH ${primarySrcSQL(view).replace(/^\s*/, '')}
    SELECT grp, ch, TO_CHAR(MAX(d), 'YYYY-MM-DD') AS lu
    FROM src WHERE d IS NOT NULL GROUP BY grp, ch
  `;
  const raw = await runQuery(sql, []);
  return raw.map(r => { const g = makeGetter(r); return {
    group: strv(g('grp')), channel: strv(g('ch')), lastUpdated: strv(g('lu')),
  }; }).sort(primarySort);
}

// monthly primary targets (gsheet table → quoted lowercase identifiers)
async function fetchPrimaryTargets(ym) {
  if (!/^\d{4}-\d{2}$/.test(String(ym))) throw new Error('Invalid month');
  const sql = `
    SELECT "month" AS m, "channel" AS ch, "net_target" AS t,
           "net_target" / DAY(LAST_DAY(TO_DATE("month", 'YYYY-MM'))) AS pdt
    FROM deconstruct_dc.datachannel.gs_primary_targets
    WHERE "month" = ?
  `;
  const raw = await runQuery(sql, [ym]);
  return raw.map(r => { const g = makeGetter(r); return {
    month: strv(g('m')), channel: strv(g('ch')), netTarget: num(g('t')), perDay: num(g('pdt')),
  }; });
}

// ─────────────────────────────────────────────────────────────────────────
//  Per-channel primary (sell-in) NET revenue for an arbitrary window, vs a
//  target prorated across that same window — powers the "Where revenue
//  comes from" leaderboard's achievement bar on the All Channels tab.
//
//  Target proration mirrors _marketplace_wbr.js's target_prorated CTE
//  (SUM(net_target / month_days * overlapping_days), summed across every
//  month the window touches, including a month boundary).
//
//  gs_primary_targets."channel" already uses the SAME raw names as
//  PRIMARY_SALES.channel_name for panel-sourced channels — e.g. both say
//  "Blinkit (P)", "Nykaa (P)", "Zepto (P)", "Instamart (P)" — so this joins
//  on an EXACT match, no remapping needed (verified against a live probe
//  query: every one of those channels carries real, non-zero net revenue
//  here). The " (P)" suffix is stripped only in the JS return value, so the
//  caller can match it against the unsuffixed names /api/overall uses.
// ─────────────────────────────────────────────────────────────────────────
async function fetchPrimaryChannelTargets(from, to, prevFrom, prevTo) {
  for (const d of [from, to, prevFrom, prevTo]) {
    if (!YMD_RX.test(String(d))) throw new Error('Invalid date');
  }
  const sql = `
    WITH date_windows AS (
      SELECT TO_DATE(?) AS sel_start, TO_DATE(?) AS sel_end,
             TO_DATE(?) AS prev_start, TO_DATE(?) AS prev_end
    ),
    ${primarySrcSQL(PRIMARY_VIEWS.snapshot)},
    agg AS (
      SELECT ch, grp,
        SUM(CASE WHEN d BETWEEN (SELECT sel_start FROM date_windows) AND (SELECT sel_end FROM date_windows)
                 THEN net ELSE 0 END) AS sel_net,
        SUM(CASE WHEN d BETWEEN (SELECT prev_start FROM date_windows) AND (SELECT prev_end FROM date_windows)
                 THEN net ELSE 0 END) AS prev_net
      FROM src
      GROUP BY ch, grp
    ),
    monthly_targets AS (
      SELECT "channel" AS ch, TO_DATE("month", 'YYYY-MM') AS month, "net_target",
             DAY(LAST_DAY(TO_DATE("month", 'YYYY-MM'))) AS month_days
      FROM deconstruct_dc.datachannel.gs_primary_targets
    ),
    target_prorated AS (
      SELECT ch,
        SUM("net_target" / month_days *
            (DATEDIFF(day, GREATEST(month, (SELECT sel_start FROM date_windows)),
                           LEAST(LAST_DAY(month), (SELECT sel_end FROM date_windows))) + 1)
        ) AS sel_target
      FROM monthly_targets
      WHERE month BETWEEN DATE_TRUNC('month', (SELECT sel_start FROM date_windows))
                      AND DATE_TRUNC('month', (SELECT sel_end FROM date_windows))
      GROUP BY ch
    )
    SELECT a.ch, a.grp, a.sel_net, a.prev_net, t.sel_target
    FROM agg a
    LEFT JOIN target_prorated t ON t.ch = a.ch
    ORDER BY a.sel_net DESC
  `;
  const raw = await runQuery(sql, [from, to, prevFrom, prevTo]);
  return raw.map(r => {
    const g = makeGetter(r);
    const rawChannel = strv(g('ch'));
    return {
      channel: rawChannel.replace(/\s*\(P\)$/, ''),   // display/join key, e.g. "Blinkit (P)" → "Blinkit"
      rawChannel,
      group: strv(g('grp')),
      revenue: num(g('sel_net')),
      prevRevenue: num(g('prev_net')),
      target: g('sel_target') == null ? null : num(g('sel_target')),
    };
  });
}

export {
  fetchPrimaryD1, fetchPrimaryMTD, fetchPrimaryFreshness, fetchPrimaryTargets,
  fetchPrimaryChannelTargets,
  PRIMARY_VIEWS, PRIMARY_EXCLUDE_STATUSES,
};

// ═════════════════════════════════════════════════════════════════════════
//  MARKETPLACE ADS + PERFORMANCE (Daily Reporting – Marketplaces)
//  Replicates the Hex per-channel ads blocks generically. Ads table:
//  MARKETPLACE_ADS_SNAPSHOT_RPT (channel,date,spend,impressions,clicks,
//  ad_revenue,views,units). Formulas confirmed from Hex SQL:
//    SecSalesAds=ad_revenue · UnitsAds=units · CTR=clk/imp · Cov=units/clk
//    ACOS=spend/ad_revenue · RoI=ad_revenue/spend · AvgMRP=ad_revenue/units
//  Three windows (selected date, MTD, prev-MTD w/ last-day fix); MoM%.
//  D-2 channels compare one day back (Hex uses {{date}}-1) — encoded per
//  channel below and applied to sel_date so every window cascades.
// ═════════════════════════════════════════════════════════════════════════
const ADS_VIEW    = 'SELLERS_DB.SELLERS.MARKETPLACE_ADS_SNAPSHOT_RPT';
const SALES_SNAP  = 'SELLERS_DB.SELLERS.MARKETPLACE_SECONDARY_SALES_SNAPSHOT_RPT';

// per-channel selected-date offset in days (Hex: these read {{date}}-1)
const ADS_DATE_OFFSET = {
  'Flipkart': 1, 'Flipkart Minutes': 1, 'Nykaa': 1, 'Purplle': 1, 'Amazon Now': 1,
};
function adsOffset(ch) { return ADS_DATE_OFFSET[ch] || 0; }

// One scan over the ads table → per-channel three-window aggregates.
// Offset is applied in-SQL via a per-row effective sel_date so windows align.
async function fetchAdsAll(selDate) {
  if (!selDate || !YMD_RX.test(selDate)) throw new Error('Invalid date');
  const offsetCase = Object.entries(ADS_DATE_OFFSET)
    .map(([c, d]) => `WHEN channel = '${c.replace(/'/g, "''")}' THEN DATEADD(day, -${d}, TO_DATE(?))`)
    .join(' ');
  // binds: one TO_DATE(?) per offset channel, then one for the ELSE
  const binds = Object.keys(ADS_DATE_OFFSET).map(() => selDate);
  binds.push(selDate);

  const sql = `
    WITH base AS (
      SELECT
        TO_VARCHAR(channel) AS channel,
        CAST(TO_DATE(TO_VARCHAR("DATE")) AS DATE) AS dt,
        TRY_TO_DOUBLE(TO_VARCHAR(spend))       AS spend,
        TRY_TO_DOUBLE(TO_VARCHAR(impressions)) AS imp,
        TRY_TO_DOUBLE(TO_VARCHAR(clicks))      AS clk,
        TRY_TO_DOUBLE(TO_VARCHAR(ad_revenue))  AS rev,
        TRY_TO_DOUBLE(TO_VARCHAR(views))       AS views,
        TRY_TO_DOUBLE(TO_VARCHAR(units))       AS units
      FROM ${ADS_VIEW}
    ),
    ch AS ( SELECT DISTINCT channel FROM base ),
    w AS (
      SELECT channel,
        CASE ${offsetCase} ELSE TO_DATE(?) END AS sel,
        DATE_TRUNC('month', CASE ${offsetCase} ELSE TO_DATE(?) END) AS ms
      FROM ch
    ),
    win AS (
      SELECT channel, sel, ms,
        sel AS sel_mtd_end,
        DATEADD(month, -1, ms) AS pms,
        CASE WHEN sel = LAST_DAY(sel) THEN LAST_DAY(DATEADD(month, -1, sel))
             ELSE LEAST(DATEADD(day, DAY(sel)-1, DATEADD(month, -1, ms)),
                        LAST_DAY(DATEADD(month, -1, ms))) END AS pme
      FROM w
    )
    SELECT b.channel,
      SUM(CASE WHEN b.dt = wn.sel THEN b.spend ELSE 0 END) AS spend_sel,
      SUM(CASE WHEN b.dt = wn.sel THEN b.imp   ELSE 0 END) AS imp_sel,
      SUM(CASE WHEN b.dt = wn.sel THEN b.clk   ELSE 0 END) AS clk_sel,
      SUM(CASE WHEN b.dt = wn.sel THEN b.rev   ELSE 0 END) AS rev_sel,
      SUM(CASE WHEN b.dt = wn.sel THEN b.units ELSE 0 END) AS units_sel,
      SUM(CASE WHEN b.dt = wn.sel THEN b.views ELSE 0 END) AS views_sel,
      SUM(CASE WHEN b.dt BETWEEN wn.ms  AND wn.sel_mtd_end THEN b.spend ELSE 0 END) AS spend_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.ms  AND wn.sel_mtd_end THEN b.imp   ELSE 0 END) AS imp_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.ms  AND wn.sel_mtd_end THEN b.clk   ELSE 0 END) AS clk_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.ms  AND wn.sel_mtd_end THEN b.rev   ELSE 0 END) AS rev_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.ms  AND wn.sel_mtd_end THEN b.units ELSE 0 END) AS units_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.ms  AND wn.sel_mtd_end THEN b.views ELSE 0 END) AS views_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.ms  AND wn.sel_mtd_end THEN b.views ELSE 0 END) AS views_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN b.spend ELSE 0 END) AS spend_pm,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN b.imp   ELSE 0 END) AS imp_pm,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN b.clk   ELSE 0 END) AS clk_pm,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN b.rev   ELSE 0 END) AS rev_pm,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN b.units ELSE 0 END) AS units_pm,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN b.views ELSE 0 END) AS views_pm,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN b.views ELSE 0 END) AS views_pm
    FROM base b JOIN win wn ON b.channel = wn.channel
    WHERE b.dt BETWEEN wn.pms AND wn.sel_mtd_end
    GROUP BY b.channel
  `;
  const raw = await runQuery(sql, [...binds, ...binds]); // offsetCase appears twice (sel + ms)
  return raw.map(r => { const g = makeGetter(r); const N = k => num(g(k));
    return {
      channel: strv(g('channel')), offset: adsOffset(strv(g('channel'))),
      sel:  { spend: N('spend_sel'), imp: N('imp_sel'), clk: N('clk_sel'), rev: N('rev_sel'), units: N('units_sel'), views: N('views_sel') },
      mtd:  { spend: N('spend_mtd'), imp: N('imp_mtd'), clk: N('clk_mtd'), rev: N('rev_mtd'), units: N('units_mtd'), views: N('views_mtd') },
      pm:   { spend: N('spend_pm'),  imp: N('imp_pm'),  clk: N('clk_pm'),  rev: N('rev_pm'),  units: N('units_pm'),  views: N('views_pm') },
    };
  });
}

// sales-side snapshot metrics per channel, same three windows.
// SecSales = SUM(sp) ; MRPSales = SUM(mrp*qty) ; units = SUM(qty).
// Reuses the secondary status filter + Freebie/Others exclusion.
async function fetchSalesSnapAll(selDate) {
  if (!selDate || !YMD_RX.test(selDate)) throw new Error('Invalid date');
  const offsetCase = Object.entries(ADS_DATE_OFFSET)
    .map(([c, d]) => `WHEN channel = '${c.replace(/'/g, "''")}' THEN DATEADD(day, -${d}, TO_DATE(?))`)
    .join(' ');
  const binds = Object.keys(ADS_DATE_OFFSET).map(() => selDate); binds.push(selDate);

  const sql = `
    WITH base AS (
      SELECT
        CASE WHEN LOWER(TO_VARCHAR(channel_name)) LIKE 'myntra%' THEN 'Myntra'
             WHEN LOWER(TO_VARCHAR(channel_name)) LIKE 'swiggy%' THEN 'Swiggy'
             WHEN LOWER(TO_VARCHAR(channel_name)) LIKE 'meesho%' THEN 'Meesho'
             ELSE TO_VARCHAR(channel_name) END AS channel,
        CAST(TRY_TO_DATE(TO_VARCHAR(order_date)) AS DATE) AS dt,
        TRY_TO_DOUBLE(TO_VARCHAR(qty))                    AS qty,
        TRY_TO_DOUBLE(TO_VARCHAR(selling_price_per_unit)) AS sp,
        TRY_TO_DOUBLE(TO_VARCHAR(mapper_mrp_per_unit))    AS mrp_u
      FROM ${SALES_SNAP}
      WHERE mapper_mrp_per_unit IS NOT NULL
        AND (sub_category IS NULL OR TO_VARCHAR(sub_category) NOT IN ('Freebie','Others'))
        AND order_status IN (${STATUS_SET.map(s => `'${s.replace(/'/g, "''")}'`).join(', ')})
    ),
    ch AS ( SELECT DISTINCT channel FROM base ),
    w AS (
      SELECT channel, CASE ${offsetCase} ELSE TO_DATE(?) END AS sel,
        DATE_TRUNC('month', CASE ${offsetCase} ELSE TO_DATE(?) END) AS ms FROM ch
    ),
    win AS (
      SELECT channel, sel, ms, sel AS sel_mtd_end, DATEADD(month,-1,ms) AS pms,
        CASE WHEN sel = LAST_DAY(sel) THEN LAST_DAY(DATEADD(month,-1,sel))
             ELSE LEAST(DATEADD(day, DAY(sel)-1, DATEADD(month,-1,ms)), LAST_DAY(DATEADD(month,-1,ms))) END AS pme
      FROM w
    )
    SELECT b.channel,
      SUM(CASE WHEN b.dt=wn.sel THEN COALESCE(b.sp,0)*COALESCE(b.qty,0) ELSE 0 END) AS sec_sel,
      SUM(CASE WHEN b.dt=wn.sel THEN COALESCE(b.mrp_u,0)*COALESCE(b.qty,0) ELSE 0 END) AS mrp_sel,
      SUM(CASE WHEN b.dt=wn.sel THEN COALESCE(b.qty,0) ELSE 0 END) AS u_sel,
      SUM(CASE WHEN b.dt BETWEEN wn.ms AND wn.sel_mtd_end THEN COALESCE(b.sp,0)*COALESCE(b.qty,0) ELSE 0 END) AS sec_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.ms AND wn.sel_mtd_end THEN COALESCE(b.mrp_u,0)*COALESCE(b.qty,0) ELSE 0 END) AS mrp_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.ms AND wn.sel_mtd_end THEN COALESCE(b.qty,0) ELSE 0 END) AS u_mtd,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN COALESCE(b.sp,0)*COALESCE(b.qty,0) ELSE 0 END) AS sec_pm,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN COALESCE(b.mrp_u,0)*COALESCE(b.qty,0) ELSE 0 END) AS mrp_pm,
      SUM(CASE WHEN b.dt BETWEEN wn.pms AND wn.pme THEN COALESCE(b.qty,0) ELSE 0 END) AS u_pm,
      DAY(MAX(wn.sel)) AS sel_day
    FROM base b JOIN win wn ON b.channel = wn.channel
    WHERE b.dt BETWEEN wn.pms AND wn.sel_mtd_end AND b.dt IS NOT NULL
    GROUP BY b.channel
  `;
  const raw = await runQuery(sql, [...binds, ...binds]);
  return raw.map(r => { const g = makeGetter(r); const N = k => num(g(k));
    return { channel: strv(g('channel')), selDay: N('sel_day'),
      sel: { sec: N('sec_sel'), mrp: N('mrp_sel'), units: N('u_sel') },
      mtd: { sec: N('sec_mtd'), mrp: N('mrp_mtd'), units: N('u_mtd') },
      pm:  { sec: N('sec_pm'),  mrp: N('mrp_pm'),  units: N('u_pm') },
    };
  });
}

async function fetchMktFreshness() {
  const sql = `
    SELECT s.ch AS channel, TO_CHAR(MAX(s.dt),'YYYY-MM-DD') AS sales_lu, TO_CHAR(MAX(a.dt),'YYYY-MM-DD') AS ads_lu
    FROM (
      SELECT CASE WHEN LOWER(TO_VARCHAR(channel_name)) LIKE 'myntra%' THEN 'Myntra'
                  WHEN LOWER(TO_VARCHAR(channel_name)) LIKE 'swiggy%' THEN 'Swiggy'
                  WHEN LOWER(TO_VARCHAR(channel_name)) LIKE 'meesho%' THEN 'Meesho'
                  ELSE TO_VARCHAR(channel_name) END AS ch,
             CAST(TRY_TO_DATE(TO_VARCHAR(order_date)) AS DATE) AS dt
      FROM ${SALES_SNAP} WHERE order_date <= CURRENT_DATE
        AND LOWER(TO_VARCHAR(channel_name)) NOT IN ('smytten','website','tata cliq','cred')
    ) s
    LEFT JOIN ( SELECT TO_VARCHAR(channel) AS ch, CAST(TO_DATE(TO_VARCHAR("DATE")) AS DATE) AS dt FROM ${ADS_VIEW} WHERE "DATE" <= CURRENT_DATE ) a
      ON LOWER(s.ch) = LOWER(a.ch)
    GROUP BY s.ch ORDER BY MAX(s.dt) DESC
  `;
  const raw = await runQuery(sql, []);
  return raw.map(r => { const g = makeGetter(r);
    return { channel: strv(g('channel')), salesLastUpdated: strv(g('sales_lu')), adsLastUpdated: strv(g('ads_lu')) };
  });
}

export { fetchAdsAll, fetchSalesSnapAll, fetchMktFreshness, ADS_VIEW, SALES_SNAP, ADS_DATE_OFFSET };

// ── ad spend per channel over a date range (Business Health contribution).
//    Unions BOTH performance-marketing sources, which is what the Weekly P&L
//    Tracker's "Performance Marketing" line represents:
//      • MARKETPLACE_ADS_SNAPSHOT_RPT — marketplace/retail-media spend
//      • FACEBOOK_GOOGLE_ADS_RPT      — D2C website spend, booked as 'Website'
//    Reading only the marketplace table understated total spend by roughly half
//    (10.6% vs the tracker's 20.4% of net revenue) and materially inflated CM2/CM3. ──
async function fetchAdSpendRange(from, to) {
  for (const v of [from, to]) if (!v || !YMD_RX.test(v)) throw new Error('Invalid date');
  const sql = `
    SELECT ch, SUM(spend) AS spend, SUM(ad_rev) AS ad_rev FROM (
      SELECT TO_VARCHAR(channel) AS ch,
             TRY_TO_DOUBLE(TO_VARCHAR(spend))      AS spend,
             TRY_TO_DOUBLE(TO_VARCHAR(ad_revenue)) AS ad_rev
      FROM ${ADS_VIEW}
      WHERE TO_DATE(TO_VARCHAR("DATE")) BETWEEN TO_DATE(?) AND TO_DATE(?)
      UNION ALL
      SELECT 'Website' AS ch,
             TRY_TO_DOUBLE(TO_VARCHAR(ad_spend))         AS spend,
             TRY_TO_DOUBLE(TO_VARCHAR(conversion_value)) AS ad_rev
      FROM ${WEB_ADS}
      WHERE CAST(TO_DATE(TO_VARCHAR("DATE")) AS DATE) BETWEEN TO_DATE(?) AND TO_DATE(?)
    ) GROUP BY ch
  `;
  const raw = await runQuery(sql, [from, to, from, to]);
  // map ads channel names → canonical dashboard channels
  const MAPN = { 'swiggy': 'Instamart', 'swiggy im': 'Instamart' };
  return raw.map(r => { const g = makeGetter(r);
    const name = strv(g('ch'));
    const canon = MAPN[name.trim().toLowerCase()] || name;
    return { channel: canon, spend: num(g('spend')), adRev: num(g('ad_rev')) };
  });
}
export { fetchAdSpendRange };

// ═════════════════════════════════════════════════════════════════════════
//  WEBSITE (D2C) DAILY REPORTING  — replicates the Hex "Website Daily Report"
//  notebook. Two scorecards, both across selected date / MTD / MTD-previous:
//
//   1. Website Orders Summary : Sales, Orders, AOV, Discount %, Org Sales,
//      Org Share %, CAC, Overall ROI
//   2. Performance Summary    : Impressions, Clicks, CTR, CPC, CPM, Ad Spend,
//      Cost (incl 18% GST), Conversions, Conv. Value, ROAS
//
//  Sources (confirmed live):
//    • Sales  → MARKETPLACE_SECONDARY_SALES_RPT, CHANNEL_NAME='Website'
//               (statuses are only 'sales' / 'returns'); a New/Repeating
//               customer record must exist (WEBSITE_NEW_REPEAT_CUSTOMER).
//    • Ads    → FACEBOOK_GOOGLE_ADS_RPT (Facebook + Google_ads = D2C perf mktg)
//    • Organic split → GD_GOKWIK_ORDERS_RPT, google/facebook UTM = "paid"
//               (swift_revenue); Org = Sales − Paid. Covers 2024-07 onward.
//    • CAC customers → WEBSITE_NEW_REPEAT_CUSTOMER (New + Repeating)
//
//  Conventions from the Hex SQL:
//    Sales   = SP×qty for 'sales'  +  SP×qty for 'returns'  (incl refunds)
//    Gross   = MRP×qty (mapper MRP)   Discount% = (1 − net/gross)×100
//    Cost    = ad_spend × 1.18  (GST gross-up)   ROI = Sales / Cost
//    CAC     = Cost / (New + Repeating customers)
//    MTD-previous uses the same last-day fix as the marketplace report:
//    if the selected date is its month's last day, the prior window is the
//    FULL previous month; else it is the prior month capped to the same DOM.
//  Notes / deliberate departures from the Hex draft:
//    • The Hex query LEFT JOINs the customer table (fanning ~1% of orders that
//      have duplicate rows, double-counting their revenue). We use EXISTS
//      (semi-join) so revenue is counted once — same population, no inflation.
//    • The Hex ads sub-query carries a collapsed CAMPAIGN_NAME filter we can't
//      read; we include all Facebook/Google_ads campaigns. Swap in the exact
//      exclusion here once it's confirmed.
// ═════════════════════════════════════════════════════════════════════════
const WEB_SALES  = 'SELLERS_DB.SELLERS.MARKETPLACE_SECONDARY_SALES_RPT';
const WEB_ADS    = 'SELLERS_DB.SELLERS.FACEBOOK_GOOGLE_ADS_RPT';
const WEB_NRC    = 'SELLERS_DB.SELLERS.WEBSITE_NEW_REPEAT_CUSTOMER';
const WEB_SWIFT  = 'DECONSTRUCT_DC.DATACHANNEL.GD_GOKWIK_ORDERS_RPT';
const GST_GROSS  = 1.18;            // ad cost gross-up used across the Hex report
const WEB_CUST_STATUSES = ['New', 'Repeating'];

// one scan per source, all three windows via IFF flags, combined by CROSS JOIN
// (each aggregate is a single row). `date` is the selected date (default: D-1).
async function fetchWebsiteDaily(date) {
  if (!date || !YMD_RX.test(date)) throw new Error('Invalid date');
  const custList = WEB_CUST_STATUSES.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');

  const sql = `
    WITH params AS (
      SELECT TO_DATE(?) AS d,
             DATE_TRUNC('month', TO_DATE(?)) AS m_start,
             DATEADD(month, -1, DATE_TRUNC('month', TO_DATE(?))) AS pm_start
    ),
    bounds AS (
      SELECT d, m_start, pm_start,
        CASE WHEN d = LAST_DAY(d) THEN LAST_DAY(pm_start)
             ELSE LEAST(DATEADD(day, EXTRACT(day FROM d) - 1, pm_start), LAST_DAY(pm_start))
        END AS pm_end
      FROM params
    ),
    /* ── Website sales (semi-joined to the customer table) ── */
    web AS (
      SELECT
        s.order_date AS dt,
        CASE WHEN s.order_status = 'sales'              THEN TRY_TO_DOUBLE(TO_VARCHAR(s.selling_price_per_unit)) * TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) ELSE 0 END AS net,
        CASE WHEN LOWER(TRIM(s.order_status)) = 'returns' THEN TRY_TO_DOUBLE(TO_VARCHAR(s.selling_price_per_unit)) * TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) ELSE 0 END AS rnet,
        CASE WHEN s.order_status = 'sales'              THEN TRY_TO_DOUBLE(TO_VARCHAR(s.mapper_mrp_per_unit)) * TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) ELSE 0 END AS gross,
        CASE WHEN LOWER(TRIM(s.order_status)) = 'returns' THEN TRY_TO_DOUBLE(TO_VARCHAR(s.mapper_mrp_per_unit)) * TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) ELSE 0 END AS rgross,
        TRY_TO_DOUBLE(TO_VARCHAR(s.qty)) AS qty,
        s.order_number, s.order_status
      FROM ${WEB_SALES} s
      WHERE s.channel_name = 'Website'
        AND EXISTS (
          SELECT 1 FROM ${WEB_NRC} nrc
          WHERE REPLACE(nrc.order_name, '#', '') = REPLACE(s.order_number, '#', '')
            AND nrc.customer_status IN (${custList})
        )
    ),
    webf AS (
      SELECT w.*, b.d, b.m_start, b.pm_start, b.pm_end,
        IFF(w.dt = b.d, 1, 0)                        AS is_d,
        IFF(w.dt BETWEEN b.m_start  AND b.d,     1, 0) AS is_m,
        IFF(w.dt BETWEEN b.pm_start AND b.pm_end, 1, 0) AS is_p
      FROM web w CROSS JOIN bounds b
      WHERE w.dt BETWEEN b.pm_start AND b.d
    ),
    web_agg AS (
      SELECT
        SUM(IFF(is_d=1, net+rnet, 0)) AS sales_d, SUM(IFF(is_m=1, net+rnet, 0)) AS sales_m, SUM(IFF(is_p=1, net+rnet, 0)) AS sales_p,
        SUM(IFF(is_d=1, net,      0)) AS net_d,   SUM(IFF(is_m=1, net,      0)) AS net_m,   SUM(IFF(is_p=1, net,      0)) AS net_p,
        SUM(IFF(is_d=1, gross,    0)) AS gross_d, SUM(IFF(is_m=1, gross,    0)) AS gross_m, SUM(IFF(is_p=1, gross,    0)) AS gross_p,
        /* incl. returns on both sides — the WBR's Discount % basis */
        SUM(IFF(is_d=1, gross+rgross, 0)) AS grossi_d, SUM(IFF(is_m=1, gross+rgross, 0)) AS grossi_m, SUM(IFF(is_p=1, gross+rgross, 0)) AS grossi_p,
        SUM(IFF(is_d=1, qty,      0)) AS qty_d,   SUM(IFF(is_m=1, qty,      0)) AS qty_m,   SUM(IFF(is_p=1, qty,      0)) AS qty_p,
        COUNT(DISTINCT IFF(is_d=1 AND order_status='sales', order_number, NULL)) AS ord_d,
        COUNT(DISTINCT IFF(is_m=1 AND order_status='sales', order_number, NULL)) AS ord_m,
        COUNT(DISTINCT IFF(is_p=1 AND order_status='sales', order_number, NULL)) AS ord_p
      FROM webf
    ),
    /* ── Facebook + Google performance ads.
         Split by platform exactly as the Hex "D2C - WBR" notebook does:
         Google = channel 'Google_ads'; Meta = ('Facebook','Instagram','Meta').
         Confirmed live: only 'Facebook' and 'Google_ads' occur in this table. ── */
    ads_src AS (
      SELECT CAST(TO_DATE(TO_VARCHAR("DATE")) AS DATE) AS dt,
             TO_VARCHAR(channel)                          AS ch,
             TRY_TO_DOUBLE(TO_VARCHAR(impressions))       AS imp,
             TRY_TO_DOUBLE(TO_VARCHAR(link_clicks))        AS clk,
             TRY_TO_DOUBLE(TO_VARCHAR(ad_spend))           AS spend,
             TRY_TO_DOUBLE(TO_VARCHAR(conversions))        AS conv,
             TRY_TO_DOUBLE(TO_VARCHAR(conversion_value))   AS convval
      FROM ${WEB_ADS}
    ),
    ads_agg AS (
      SELECT
        SUM(IFF(a.dt=b.d, imp,0))     AS imp_d,     SUM(IFF(a.dt BETWEEN b.m_start AND b.d, imp,0))     AS imp_m,     SUM(IFF(a.dt BETWEEN b.pm_start AND b.pm_end, imp,0))     AS imp_p,
        SUM(IFF(a.dt=b.d, clk,0))     AS clk_d,     SUM(IFF(a.dt BETWEEN b.m_start AND b.d, clk,0))     AS clk_m,     SUM(IFF(a.dt BETWEEN b.pm_start AND b.pm_end, clk,0))     AS clk_p,
        SUM(IFF(a.dt=b.d, spend,0))   AS spend_d,   SUM(IFF(a.dt BETWEEN b.m_start AND b.d, spend,0))   AS spend_m,   SUM(IFF(a.dt BETWEEN b.pm_start AND b.pm_end, spend,0))   AS spend_p,
        SUM(IFF(a.dt=b.d, conv,0))    AS conv_d,    SUM(IFF(a.dt BETWEEN b.m_start AND b.d, conv,0))    AS conv_m,    SUM(IFF(a.dt BETWEEN b.pm_start AND b.pm_end, conv,0))    AS conv_p,
        SUM(IFF(a.dt=b.d, convval,0)) AS convval_d, SUM(IFF(a.dt BETWEEN b.m_start AND b.d, convval,0)) AS convval_m, SUM(IFF(a.dt BETWEEN b.pm_start AND b.pm_end, convval,0)) AS convval_p,
        /* Google */
        SUM(IFF(a.ch='Google_ads' AND a.dt=b.d, imp,0)) AS gimp_d, SUM(IFF(a.ch='Google_ads' AND a.dt BETWEEN b.m_start AND b.d, imp,0)) AS gimp_m, SUM(IFF(a.ch='Google_ads' AND a.dt BETWEEN b.pm_start AND b.pm_end, imp,0)) AS gimp_p,
        SUM(IFF(a.ch='Google_ads' AND a.dt=b.d, clk,0)) AS gclk_d, SUM(IFF(a.ch='Google_ads' AND a.dt BETWEEN b.m_start AND b.d, clk,0)) AS gclk_m, SUM(IFF(a.ch='Google_ads' AND a.dt BETWEEN b.pm_start AND b.pm_end, clk,0)) AS gclk_p,
        SUM(IFF(a.ch='Google_ads' AND a.dt=b.d, spend,0)) AS gsp_d, SUM(IFF(a.ch='Google_ads' AND a.dt BETWEEN b.m_start AND b.d, spend,0)) AS gsp_m, SUM(IFF(a.ch='Google_ads' AND a.dt BETWEEN b.pm_start AND b.pm_end, spend,0)) AS gsp_p,
        /* Meta */
        SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt=b.d, imp,0)) AS mimp_d, SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt BETWEEN b.m_start AND b.d, imp,0)) AS mimp_m, SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt BETWEEN b.pm_start AND b.pm_end, imp,0)) AS mimp_p,
        SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt=b.d, clk,0)) AS mclk_d, SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt BETWEEN b.m_start AND b.d, clk,0)) AS mclk_m, SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt BETWEEN b.pm_start AND b.pm_end, clk,0)) AS mclk_p,
        SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt=b.d, spend,0)) AS msp_d, SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt BETWEEN b.m_start AND b.d, spend,0)) AS msp_m, SUM(IFF(a.ch IN ('Facebook','Instagram','Meta') AND a.dt BETWEEN b.pm_start AND b.pm_end, spend,0)) AS msp_p
      FROM ads_src a CROSS JOIN bounds b
      WHERE a.dt BETWEEN b.pm_start AND b.d
    ),
    /* ── Paid swift orders → organic split.
         Classification is the Hex "D2C - WBR" rule, which is broader than a bare
         google/facebook source check: Paid = utm_medium in ('cpc','paid') OR
         utm_source in (fb, facebook, google, snapchat, criteo, jiohotstar);
         everything else (direct, email, sms, whatsapp, influencer/affiliate
         partners, chatgpt.com, …) is Organic. Verified live: for Aug'26 this
         returns exactly the same paid revenue as the narrower rule (₹1.04 Cr) —
         no Snapchat/Criteo/JioHotstar traffic yet — so it is future-proofing,
         not a restatement. ── */
    swift_src AS (
      SELECT DISTINCT
        REPLACE("shopify_order_name", '#', '') AS oid,
        CAST(TRY_TO_TIMESTAMP("created_at", 'DD/MM/YYYY HH12:MI AM') AS DATE) AS dt,
        TRY_TO_DOUBLE(TO_VARCHAR("grand_total")) AS val
      FROM ${WEB_SWIFT}
      WHERE LOWER(TRIM("utm_medium")) IN ('cpc', 'paid')
         OR LOWER(TRIM("utm_source")) IN ('fb', 'facebook', 'google', 'snapchat', 'criteo', 'jiohotstar')
    ),
    swift_agg AS (
      SELECT
        SUM(IFF(s.dt=b.d, val,0)) AS swrev_d, SUM(IFF(s.dt BETWEEN b.m_start AND b.d, val,0)) AS swrev_m, SUM(IFF(s.dt BETWEEN b.pm_start AND b.pm_end, val,0)) AS swrev_p,
        COUNT(DISTINCT IFF(s.dt=b.d, s.oid, NULL)) AS sword_d,
        COUNT(DISTINCT IFF(s.dt BETWEEN b.m_start AND b.d, s.oid, NULL)) AS sword_m,
        COUNT(DISTINCT IFF(s.dt BETWEEN b.pm_start AND b.pm_end, s.oid, NULL)) AS sword_p
      FROM swift_src s CROSS JOIN bounds b
      WHERE s.dt BETWEEN b.pm_start AND b.d
    ),
    /* ── New + Repeating customers (CAC denominator) ── */
    nc_src AS (
      SELECT DISTINCT REPLACE(order_name, '#', '') AS oid, created_date AS dt
      FROM ${WEB_NRC}
      WHERE customer_status IN (${custList})
    ),
    nc_agg AS (
      SELECT
        COUNT(DISTINCT IFF(n.dt=b.d, n.oid, NULL)) AS cust_d,
        COUNT(DISTINCT IFF(n.dt BETWEEN b.m_start AND b.d, n.oid, NULL)) AS cust_m,
        COUNT(DISTINCT IFF(n.dt BETWEEN b.pm_start AND b.pm_end, n.oid, NULL)) AS cust_p
      FROM nc_src n CROSS JOIN bounds b
      WHERE n.dt BETWEEN b.pm_start AND b.d
    )
    SELECT
      TO_CHAR(bounds.d,'YYYY-MM-DD') AS d, TO_CHAR(bounds.m_start,'YYYY-MM-DD') AS m_start,
      TO_CHAR(bounds.pm_start,'YYYY-MM-DD') AS pm_start, TO_CHAR(bounds.pm_end,'YYYY-MM-DD') AS pm_end,
      web_agg.*, ads_agg.*, swift_agg.*, nc_agg.*
    FROM web_agg CROSS JOIN ads_agg CROSS JOIN swift_agg CROSS JOIN nc_agg CROSS JOIN bounds
  `;

  const raw = await runQuery(sql, [date, date, date]);
  const g = makeGetter(raw[0] || {});
  const N = k => num(g(k));
  const w = {
    // sales
    salesD: N('sales_d'), salesM: N('sales_m'), salesP: N('sales_p'),
    netD: N('net_d'),     netM: N('net_m'),     netP: N('net_p'),
    grossD: N('gross_d'), grossM: N('gross_m'), grossP: N('gross_p'),
    grossiD: N('grossi_d'), grossiM: N('grossi_m'), grossiP: N('grossi_p'),
    qtyD: N('qty_d'),     qtyM: N('qty_m'),     qtyP: N('qty_p'),
    ordD: N('ord_d'),     ordM: N('ord_m'),     ordP: N('ord_p'),
    // ads
    impD: N('imp_d'),         impM: N('imp_m'),         impP: N('imp_p'),
    clkD: N('clk_d'),         clkM: N('clk_m'),         clkP: N('clk_p'),
    spendD: N('spend_d'),     spendM: N('spend_m'),     spendP: N('spend_p'),
    convD: N('conv_d'),       convM: N('conv_m'),       convP: N('conv_p'),
    convvalD: N('convval_d'), convvalM: N('convval_m'), convvalP: N('convval_p'),
    // per-platform (Google vs Meta), as the WBR splits them
    gimpD: N('gimp_d'), gimpM: N('gimp_m'), gimpP: N('gimp_p'),
    gclkD: N('gclk_d'), gclkM: N('gclk_m'), gclkP: N('gclk_p'),
    gspD:  N('gsp_d'),  gspM:  N('gsp_m'),  gspP:  N('gsp_p'),
    mimpD: N('mimp_d'), mimpM: N('mimp_m'), mimpP: N('mimp_p'),
    mclkD: N('mclk_d'), mclkM: N('mclk_m'), mclkP: N('mclk_p'),
    mspD:  N('msp_d'),  mspM:  N('msp_m'),  mspP:  N('msp_p'),
    // swift / organic + customers
    swrevD: N('swrev_d'), swrevM: N('swrev_m'), swrevP: N('swrev_p'),
    swordD: N('sword_d'), swordM: N('sword_m'), swordP: N('sword_p'),
    custD: N('cust_d'),   custM: N('cust_m'),   custP: N('cust_p'),
  };
  return {
    date,
    bounds: { d: strv(g('d')), mStart: strv(g('m_start')), pmStart: strv(g('pm_start')), pmEnd: strv(g('pm_end')) },
    windows: w,
    ...buildWebsiteMetrics(w),
  };
}

// pure derivation → the two scorecards. Each row: { key, label, fmt, invert?,
// hint?, sel, mtd, pm }. `fmt` is a string tag the frontend maps to a formatter
// (functions can't cross JSON). `invert` marks metrics where lower is better.
function buildWebsiteMetrics(w) {
  const div = (a, b) => (b ? a / b : null);
  const per = suf => ({
    sales: w['sales' + suf], orders: w['ord' + suf], gross: w['gross' + suf], net: w['net' + suf],
    grossi: w['grossi' + suf],
    qty: w['qty' + suf], imp: w['imp' + suf], clk: w['clk' + suf], spend: w['spend' + suf],
    conv: w['conv' + suf], convval: w['convval' + suf], swrev: w['swrev' + suf],
    sword: w['sword' + suf], cust: w['cust' + suf],
    gimp: w['gimp' + suf], gclk: w['gclk' + suf], gsp: w['gsp' + suf],
    mimp: w['mimp' + suf], mclk: w['mclk' + suf], msp: w['msp' + suf],
  });
  const D = per('D'), M = per('M'), P = per('P');
  const cost = x => x.spend * GST_GROSS;
  const org  = x => x.sales - x.swrev;

  const orderRows = [
    { key: 'mrpSales', label: 'MRP Sales',    fmt: 'inr',  hint: 'mapper MRP × qty — the WBR\'s gross',
      sel: D.gross, mtd: M.gross, pm: P.gross },
    { key: 'sales',    label: 'Sec Sales',    fmt: 'inr',  hint: 'SP × qty incl. returns',
      sel: D.sales, mtd: M.sales, pm: P.sales },
    { key: 'orders',   label: 'Orders',       fmt: 'int',
      sel: D.orders, mtd: M.orders, pm: P.orders },
    // AOV is the Daily Report's term; the WBR calls the identical ratio "ASP"
    // (Sec Sales ÷ orders). Shown once to avoid two identical rows.
    { key: 'aov',      label: 'AOV / ASP',    fmt: 'rupee', hint: 'Sec Sales ÷ orders — "AOV" in the Daily Report, "ASP" in the WBR',
      sel: div(D.sales, D.orders), mtd: div(M.sales, M.orders), pm: div(P.sales, P.orders) },
    // Hex "D2C - WBR" definition: 1 − (revenue + returns_net) ÷ (gross + returns_gross),
    // i.e. returns are included on BOTH sides rather than stripped from each.
    { key: 'discount', label: 'Discount %',   fmt: 'pct1', invert: true, hint: '1 − sales ÷ gross, returns included on both sides (WBR basis)',
      sel: D.grossi ? (1 - D.sales / D.grossi) * 100 : null,
      mtd: M.grossi ? (1 - M.sales / M.grossi) * 100 : null,
      pm:  P.grossi ? (1 - P.sales / P.grossi) * 100 : null },
    { key: 'orgSales', label: 'Organic Sales', fmt: 'inr', hint: 'Sales − paid (google/facebook) swift revenue',
      sel: org(D), mtd: org(M), pm: org(P) },
    { key: 'orgShare', label: 'Organic Share %', fmt: 'pct0',
      sel: div(org(D), D.sales) != null ? div(org(D), D.sales) * 100 : null,
      mtd: div(org(M), M.sales) != null ? div(org(M), M.sales) * 100 : null,
      pm:  div(org(P), P.sales) != null ? div(org(P), P.sales) * 100 : null },
    { key: 'cac',      label: 'CAC',          fmt: 'rupee', invert: true, hint: 'Cost (incl. GST) ÷ (new + repeating customers)',
      sel: div(cost(D), D.cust), mtd: div(cost(M), M.cust), pm: div(cost(P), P.cust) },
    { key: 'roi',      label: 'Overall ROI',  fmt: 'x', hint: 'Sales ÷ cost (ad spend × 1.18)',
      sel: div(D.sales, cost(D)), mtd: div(M.sales, cost(M)), pm: div(P.sales, cost(P)) },
  ];

  const perfRows = [
    { key: 'imp',     label: 'Overall Impressions', fmt: 'int',   sel: D.imp, mtd: M.imp, pm: P.imp },
    { key: 'gimp',    label: 'Google Impressions',  fmt: 'int',   sel: D.gimp, mtd: M.gimp, pm: P.gimp },
    { key: 'mimp',    label: 'Meta Impressions',    fmt: 'int',   sel: D.mimp, mtd: M.mimp, pm: P.mimp },
    { key: 'clk',     label: 'Overall Clicks',      fmt: 'int',   sel: D.clk, mtd: M.clk, pm: P.clk },
    { key: 'gclk',    label: 'Google Clicks',       fmt: 'int',   sel: D.gclk, mtd: M.gclk, pm: P.gclk },
    { key: 'mclk',    label: 'Meta Clicks',         fmt: 'int',   sel: D.mclk, mtd: M.mclk, pm: P.mclk },
    { key: 'ctr',     label: 'Overall CTR %',       fmt: 'pct2',
      sel: D.imp ? (D.clk / D.imp) * 100 : null, mtd: M.imp ? (M.clk / M.imp) * 100 : null, pm: P.imp ? (P.clk / P.imp) * 100 : null },
    { key: 'gctr',    label: 'Google CTR %',        fmt: 'pct2',
      sel: D.gimp ? (D.gclk / D.gimp) * 100 : null, mtd: M.gimp ? (M.gclk / M.gimp) * 100 : null, pm: P.gimp ? (P.gclk / P.gimp) * 100 : null },
    { key: 'mctr',    label: 'Meta CTR %',          fmt: 'pct2',
      sel: D.mimp ? (D.mclk / D.mimp) * 100 : null, mtd: M.mimp ? (M.mclk / M.mimp) * 100 : null, pm: P.mimp ? (P.mclk / P.mimp) * 100 : null },
    { key: 'cvr',     label: 'Overall CVR %',       fmt: 'pct2', hint: 'orders ÷ clicks (WBR)',
      sel: D.clk ? (D.orders / D.clk) * 100 : null, mtd: M.clk ? (M.orders / M.clk) * 100 : null, pm: P.clk ? (P.orders / P.clk) * 100 : null },
    { key: 'cpc',     label: 'CPC',         fmt: 'rupee', invert: true, hint: 'Cost ÷ clicks',
      sel: div(cost(D), D.clk), mtd: div(cost(M), M.clk), pm: div(cost(P), P.clk) },
    { key: 'cpm',     label: 'CPM',         fmt: 'rupee', invert: true, hint: 'Cost ÷ impressions × 1000',
      sel: D.imp ? cost(D) / D.imp * 1000 : null, mtd: M.imp ? cost(M) / M.imp * 1000 : null, pm: P.imp ? cost(P) / P.imp * 1000 : null },
    { key: 'spend',   label: 'Ad Spend',        fmt: 'inr', invert: true, sel: D.spend, mtd: M.spend, pm: P.spend },
    { key: 'gspend',  label: 'Google Ad Spend', fmt: 'inr', invert: true, sel: D.gsp, mtd: M.gsp, pm: P.gsp },
    { key: 'mspend',  label: 'Meta Ad Spend',   fmt: 'inr', invert: true, sel: D.msp, mtd: M.msp, pm: P.msp },
    { key: 'cost',    label: 'Cost (incl. GST)', fmt: 'inr', invert: true, hint: 'Ad spend × 1.18',
      sel: cost(D), mtd: cost(M), pm: cost(P) },
    { key: 'conv',    label: 'Conversions', fmt: 'int', hint: 'Platform-reported (DB) orders',
      sel: D.conv, mtd: M.conv, pm: P.conv },
    { key: 'convVal', label: 'Conv. Value', fmt: 'inr', hint: 'Platform-reported (DB) revenue',
      sel: D.convval, mtd: M.convval, pm: P.convval },
    { key: 'roas',    label: 'ROAS',        fmt: 'x', hint: 'Conversion value ÷ cost',
      sel: div(D.convval, cost(D)), mtd: div(M.convval, cost(M)), pm: div(P.convval, cost(P)) },
  ];

  return { orderRows, perfRows };
}

// last-updated per source, so the report is honest about lag
async function fetchWebsiteFreshness() {
  const sql = `
    SELECT 'Website sales' AS src, TO_CHAR(MAX(TRY_TO_DATE(TO_VARCHAR(order_date))),'YYYY-MM-DD') AS lu
      FROM ${WEB_SALES} WHERE channel_name='Website'
    UNION ALL
    SELECT 'Performance ads', TO_CHAR(MAX(CAST(TO_DATE(TO_VARCHAR("DATE")) AS DATE)),'YYYY-MM-DD') FROM ${WEB_ADS}
    UNION ALL
    SELECT 'Swift orders (paid)', TO_CHAR(MAX(CAST(TRY_TO_TIMESTAMP("created_at",'DD/MM/YYYY HH12:MI AM') AS DATE)),'YYYY-MM-DD') FROM ${WEB_SWIFT}
    UNION ALL
    SELECT 'Customer status', TO_CHAR(MAX(created_date),'YYYY-MM-DD') FROM ${WEB_NRC}
  `;
  const raw = await runQuery(sql, []);
  return raw.map(r => { const g = makeGetter(r); return { source: strv(g('src')), lastUpdated: strv(g('lu')) }; });
}

export { fetchWebsiteDaily, buildWebsiteMetrics, fetchWebsiteFreshness };

// ═════════════════════════════════════════════════════════════════════════
//  BRAND MARKET SHARE (WBR - Brand)
//  Replicates the Hex "WBR - Brand" notebook's df_market_share: brand share
//  of category, by channel × category × month, stitched from three lineages:
//
//   1. Marketplace history — four wide Google-Sheet tables (one column per
//      month, values like "5.52%"), flattened with OBJECT_CONSTRUCT + LATERAL
//      FLATTEN and filtered to keys matching ^_mmm_yy$. Amazon's sheet is cut
//      at 2026-04 because the panel feed takes over from there; Flipkart,
//      Meesho and Nykaa run to the end of their sheets.
//   2. Amazon panel — GD_AMAZON_GOBBLECUBE_PAN_DATA from 2026-04 onward,
//      AVG(market_share_sp_) / 100.
//   3. Quick commerce — GD_QUICKCOM_PAN_DATA_WEEKLY. Rows are SKU-level, so a
//      week's brand share is the SUM of its SKUs' est_category_share_sp_, then
//      averaged across the weeks in a month. Verified against the notebook's
//      own pivot (Blinkit Lip Balm 7.07%, Instamart Sunscreen 11.4%).
//
//  Every source reports share on a 0-100 scale; this returns 0-1 fractions,
//  matching the notebook's `value` column.
// ═════════════════════════════════════════════════════════════════════════
const SHARE_CATEGORIES = ['Sunscreen', 'Serum', 'Lip Balm', 'Moisturiser', 'Face Wash'];

// each sheet names the same five categories differently
const CAT_CASE = `
  CASE LOWER(TRIM(cat_raw))
    WHEN 'sunscreen'          THEN 'Sunscreen'
    WHEN 'face sunscreen'     THEN 'Sunscreen'
    WHEN 'serum'              THEN 'Serum'
    WHEN 'serums'             THEN 'Serum'
    WHEN 'skin serum'         THEN 'Serum'
    WHEN 'face serum'         THEN 'Serum'
    WHEN 'face oil & serums'  THEN 'Serum'
    WHEN 'lip balm'           THEN 'Lip Balm'
    WHEN 'lip balms'          THEN 'Lip Balm'
    WHEN 'moisturiser'        THEN 'Moisturiser'
    WHEN 'moisturizer'        THEN 'Moisturiser'
    WHEN 'skin moisturizer'   THEN 'Moisturiser'
    WHEN 'face moisturizers'  THEN 'Moisturiser'
    WHEN 'face wash'          THEN 'Face Wash'
    WHEN 'skin cleanser'      THEN 'Face Wash'
    ELSE NULL
  END`;

// one wide sheet → (channel, raw category, month key, raw value)
function sheetCTE(channel, table) {
  return `
    SELECT '${channel}' AS ch, t."category" AS cat_raw, f.key AS k, f.value AS v
    FROM ( SELECT "category", OBJECT_CONSTRUCT(*) AS obj
           FROM deconstruct_dc.datachannel.${table} ) t,
         LATERAL FLATTEN(input => t.obj) f`;
}

async function fetchBrandShare() {
  const sql = `
    WITH sheets AS (
      ${sheetCTE('Amazon',   'gs_amazon_marketplace_share')}
      UNION ALL
      ${sheetCTE('Flipkart', 'gs_flipkart_marketplace_share')}
      UNION ALL
      ${sheetCTE('Meesho',   'gs_meesho_marketshare_share')}
      UNION ALL
      ${sheetCTE('Nykaa',    'gs_nykaa_marketplace_share')}
    ),
    sheet_rows AS (
      SELECT ch,
        ${CAT_CASE.replace('cat_raw', 'cat_raw')} AS cat,
        TO_DATE(SPLIT_PART(k, '_', 2) || ' 01 20' || SPLIT_PART(k, '_', 3), 'MON DD YYYY') AS mdate,
        TRY_TO_DOUBLE(REPLACE(REPLACE(TO_VARCHAR(v), '"', ''), '%', '')) / 100 AS val
      FROM sheets
      /* only the month columns: _mmm_yy. Meesho also carries unprefixed
         duplicates (may_26) and column_1..11 junk — both excluded here. */
      WHERE REGEXP_LIKE(k, '^_[a-z]{3}_[0-9]{2}$')
    ),
    sheet_final AS (
      SELECT ch, cat, mdate, val FROM sheet_rows
      WHERE cat IS NOT NULL AND mdate IS NOT NULL AND val IS NOT NULL
        /* Amazon's sheet stops where the panel feed begins */
        AND NOT (ch = 'Amazon' AND mdate >= '2026-04-01')
    ),
    amazon_panel AS (
      SELECT 'Amazon' AS ch,
        ${CAT_CASE.replace('cat_raw', '"category"')} AS cat,
        DATE_TRUNC('month', TRY_TO_DATE("date")) AS mdate,
        AVG("market_share_sp_") / 100 AS val
      FROM deconstruct_dc.datachannel.gd_amazon_gobblecube_pan_data
      WHERE TRIM("platform") = 'Amazon'
        AND TRY_TO_DATE("date") >= '2026-04-01'
      GROUP BY 1, 2, 3
    ),
    qc_week AS (
      /* SKU rows → one brand share per channel × category × week */
      SELECT TRIM("platform") AS ch,
        ${CAT_CASE.replace('cat_raw', '"category"')} AS cat,
        COALESCE(TRY_TO_DATE("date", 'YYYY-MM-DD'), TRY_TO_DATE("date", 'MM/DD/YY')) AS dt,
        SUM("est_category_share_sp_") AS week_share
      FROM deconstruct_dc.datachannel.gd_quickcom_pan_data_weekly
      WHERE "brand" = 'Deconstruct'
      GROUP BY 1, 2, 3
    ),
    qc AS (
      SELECT ch, cat, DATE_TRUNC('month', dt) AS mdate, AVG(week_share) / 100 AS val
      FROM qc_week
      WHERE cat IS NOT NULL AND dt IS NOT NULL AND week_share IS NOT NULL
      GROUP BY 1, 2, 3
    ),
    all_rows AS (
      SELECT * FROM sheet_final
      UNION ALL SELECT ch, cat, mdate, val FROM amazon_panel WHERE cat IS NOT NULL AND mdate IS NOT NULL AND val IS NOT NULL
      UNION ALL SELECT ch, cat, mdate, val FROM qc
    )
    SELECT ch AS channel, cat AS category,
           TO_CHAR(mdate, 'YYYY-MM-DD') AS month,
           TO_CHAR(mdate, 'MON-YY')     AS month_label,
           ROUND(AVG(val), 6)           AS share
    FROM all_rows
    GROUP BY 1, 2, 3, 4
    ORDER BY channel, category, month
  `;
  const raw = await runQuery(sql, []);
  const rows = raw.map(r => { const g = makeGetter(r); return {
    channel: strv(g('channel')), category: strv(g('category')),
    month: strv(g('month')), monthLabel: strv(g('month_label')),
    share: num(g('share')),
  }; });
  const months = [...new Set(rows.map(r => r.month))].sort();
  const channels = [...new Set(rows.map(r => r.channel))].sort();
  return {
    rows, months, channels, categories: SHARE_CATEGORIES,
    meta: {
      basis: 'brand share of category, 0-1 fraction',
      lineage: 'GS_*_MARKETPLACE_SHARE sheets (history) · GD_AMAZON_GOBBLECUBE_PAN_DATA (Amazon, 2026-04+) · GD_QUICKCOM_PAN_DATA_WEEKLY (quick commerce)',
    },
  };
}

export { fetchBrandShare, SHARE_CATEGORIES };

// ═════════════════════════════════════════════════════════════════════════
//  BRAND SHARE BY CITY (WBR - Brand, city detail)
//  Same brand-share measure as fetchBrandShare, resolved to city. Quick
//  commerce only — the marketplace share sheets are national.
//
//  Two feeds, spliced per category exactly as the notebook does:
//    • QUICK_COM_CITY_SUNSCREEN_RPT  — monthly grain, DD-MM-YYYY dates.
//      Used for Sunscreen before 2025-12 and everything else before 2026-03.
//    • GD_QUICKCOM_CITY_DATA         — SKU × city × DAY. Used from those
//      cutoffs onward.
//
//  Share is offtake-weighted, never averaged:
//      share = SUM(offtake) / SUM(offtake / (share_pct / 100))
//  The denominator reconstructs the category's size from our own offtake and
//  share, so cities of different sizes combine correctly. Collapsing the new
//  feed to DAY grain first matters: SKU shares only sum to a brand share
//  within one day, so summing them across a month multiplies it by the number
//  of days. Verified against the national panel — Aug'26 Sunscreen rolls up to
//  6.33% Blinkit / 11.98% Instamart vs 6.29% / 11.83% from the pan feed.
// ═════════════════════════════════════════════════════════════════════════
const CITY_CAT_CASE = `CASE raw_cat
    WHEN 'Sunscreen'   THEN 'Sunscreen'
    WHEN 'Face Serum'  THEN 'Serum'
    WHEN 'Lip Balms'   THEN 'Lip Balm'
    WHEN 'Lip Balm'    THEN 'Lip Balm'
    WHEN 'Moisturizer' THEN 'Moisturiser'
    WHEN 'Moisturiser' THEN 'Moisturiser'
    WHEN 'Face Wash'   THEN 'Face Wash'
    ELSE NULL END`;

async function fetchBrandCityShare() {
  const sql = `
    WITH old_raw AS (
      SELECT TRIM(CHANNEL) AS ch, TRIM(CITY) AS city, TRIM(BGR) AS raw_cat,
             DATE_TRUNC('month', TRY_TO_DATE(DATE, 'DD-MM-YYYY')) AS mdate,
             SUM(REPORTED_OFFTAKE_SP)                     AS off,
             SUM(TRY_TO_DOUBLE("Est. Category Share SP")) AS share_pct
      FROM sellers_db.sellers.quick_com_city_sunscreen_rpt
      WHERE BRAND = 'Deconstruct'
        AND TRIM(CHANNEL) IN ('Blinkit','Instamart','Zepto')
        AND TRIM(BGR) IN ('Sunscreen','Face Serum','Lip Balms','Moisturizer','Face Wash')
        AND (   (TRIM(BGR) =  'Sunscreen' AND TRY_TO_DATE(DATE,'DD-MM-YYYY') < '2025-12-01')
             OR (TRIM(BGR) <> 'Sunscreen' AND TRY_TO_DATE(DATE,'DD-MM-YYYY') < '2026-03-01') )
      GROUP BY 1,2,3,4
    ),
    new_day AS (
      SELECT TRIM("platform") AS ch, TRIM("city") AS city, TRIM("category") AS raw_cat,
             TRY_TO_DATE("date") AS dt,
             SUM(TRY_TO_DOUBLE("offtake_sp_"))            AS off,
             SUM(TRY_TO_DOUBLE("est_category_share_sp_")) AS share_pct
      FROM deconstruct_dc.datachannel.gd_quickcom_city_data
      WHERE LOWER(TRIM("brand")) = 'deconstruct'
        AND TRIM("platform") IN ('Blinkit','Instamart','Zepto')
        AND TRIM("category") IN ('Sunscreen','Face Serum','Lip Balms','Lip Balm','Moisturizer','Moisturiser','Face Wash')
        AND (   (TRIM("category") =  'Sunscreen' AND TRY_TO_DATE("date") >= '2025-12-01')
             OR (TRIM("category") <> 'Sunscreen' AND TRY_TO_DATE("date") >= '2026-03-01') )
      GROUP BY 1,2,3,4
    ),
    u AS (
      SELECT ch, city, raw_cat, mdate, off, share_pct FROM old_raw
      UNION ALL
      SELECT ch, city, raw_cat, DATE_TRUNC('month', dt), off, share_pct FROM new_day
    )
    SELECT ch AS channel, city, ${CITY_CAT_CASE} AS category,
           TO_CHAR(mdate,'YYYY-MM-DD') AS month,
           ROUND(SUM(off))                                                      AS offtake,
           ROUND(SUM(off) / NULLIF(SUM(off / NULLIF(share_pct/100, 0)), 0), 6)  AS share
    FROM u
    WHERE mdate IS NOT NULL AND ${CITY_CAT_CASE} IS NOT NULL AND off > 0
    GROUP BY 1,2,3,4
    ORDER BY month, category, channel, city
  `;
  const raw = await runQuery(sql, []);
  const rows = raw.map(r => { const g = makeGetter(r); return {
    channel: strv(g('channel')), city: strv(g('city')), category: strv(g('category')),
    month: strv(g('month')), offtake: num(g('offtake')), share: num(g('share')),
  }; });
  return {
    rows,
    months:   [...new Set(rows.map(r => r.month))].sort(),
    cities:   [...new Set(rows.map(r => r.city))].sort(),
    channels: [...new Set(rows.map(r => r.channel))].sort(),
    categories: SHARE_CATEGORIES,
    meta: {
      basis: 'offtake-weighted brand share of category, 0-1 fraction',
      scope: 'quick commerce only (Blinkit · Instamart · Zepto) — the marketplace share sheets are national',
      lineage: 'QUICK_COM_CITY_SUNSCREEN_RPT (to the per-category cutoff) · GD_QUICKCOM_CITY_DATA (after it)',
    },
  };
}

export { fetchBrandCityShare };

