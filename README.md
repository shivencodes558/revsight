# Revenue Analytics — Deconstruct BI

A premium enterprise revenue dashboard, built in the Adsight architecture
(Vite + React SPA, local Express twin + Vercel serverless, Snowflake key-pair
auth). Single source of truth: `SELLERS_DB.SELLERS.MARKETPLACE_SECONDARY_SALES_RPT`.

---

## Run locally

```bash
# 1. install
npm install

# 2. credentials — copy the template and fill in your Snowflake values
cp .env.example .env
#    (use the same key-pair values as your Adsight project)

# 3. start the API (terminal 1)
npm run server        # → http://localhost:8788

# 4. start the frontend (terminal 2)
npm run dev           # → http://localhost:5174
```

Open http://localhost:5174. The Vite dev server proxies `/api/*` to the Express
server on :8788, so the frontend code is identical to what runs on Vercel later.

**Sanity checks**
- API health: http://localhost:8788/api/health (confirms Snowflake connects)
- Raw data: http://localhost:8788/api/overall?from=2026-01-01

```bash
npm test              # runs the date-parser + data-pipeline unit tests
```

---

## What Phase 1 ships

**Cross-Channel Revenue** — the flagship page:
- Global metric toggle: **MRP Sales / SP Sales / Volume** (mirrors your Hex notebook's three parallel worlds)
- Date presets (MTD / 30D / 90D / YTD) + custom range, with automatic prior-period comparison
- KPI cards with period-over-period deltas
- Revenue trend (daily, auto-switches to monthly for wide ranges) with prior period overlaid
- Channel-group mix (Marketplace / Q-Commerce / D2C)
- Channel breakdown table with share bars, units, and orders

The other sidebar sections are scaffolded and arrive in later phases.

---

## Revenue conventions (from the Hex notebook)

- **SP Sales** = `SUM(SELLING_PRICE_PER_UNIT × QTY)` — net realised. Quick commerce
  reports zero SP, so SP represents marketplace + D2C.
- **MRP Sales** = `SUM(MAPPER_MRP_PER_UNIT × QTY)` — gross offtake at MRP, works
  across every channel including quick commerce. Uses the **mapper** MRP (not the
  source `MRP_PER_UNIT`), which is why MRP is populated for Amazon/Flipkart/Website too.
- **Volume** = `SUM(QTY)`.
- `Freebie` and `Others` sub-categories are excluded.
- Myntra SJIT + Myntra Direct are merged into **Myntra**; Swiggy IM → **Instamart**.

## ⚠ One thing to confirm before trusting the totals

The **order-status filter** is provisional. It currently **excludes**
`cancelled / failed / lost / rto / returned / returns` and keeps everything else.
Your Hex app exposes a 37-value multi-select (`orders_status_select`); once you
give me the exact default set your WBR uses, it's a **one-line change** in
`api/_snowflake.js` (`STATUS_MODE` + `STATUS_SET`). Until then a banner in the UI
flags that the number is provisional.

---

## Architecture notes

- **No twin duplication.** Adsight kept `server.js` and `api/_snowflake.js` as two
  byte-identical copies that had to be edited in lockstep. Here `server.js`
  imports the same `api/_snowflake.js` the Vercel functions use — one source of truth.
- **One hardened date parser** (`api/dates.js`) with unit tests, replacing
  Adsight's three parsers (one of which emitted impossible month-13 dates).
- **Aggregation happens in SQL.** The source view is order-line grain; pulling it
  raw would blow the function timeout. `/api/overall` groups by channel × day
  server-side and returns a few thousand rows.
- **Frontend always calls `/api`** — Vite proxies in dev, same-origin on Vercel.
  No environment-specific base URL.

## Structure

```
api/
  _snowflake.js   shared: connection, runQuery, CHANNEL registry, /api/overall logic
  dates.js        hardened date parser (tested)
  overall.js      Vercel handler → /api/overall
  health.js       Vercel handler → /api/health
server.js         local Express twin (imports api/_snowflake.js)
src/
  App.jsx         shell, splash, sidebar, filter bar, prior-period logic, routing
  views/CrossChannel.jsx   the Phase 1 page
  components/     Sidebar, ui (KPI/toggle/range/skeletons)
  lib/            api, metrics, format, dateUtils
test/             date + pipeline unit tests
```
