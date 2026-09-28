// ─────────────────────────────────────────────────────────────────────────
//  server.js — local dev backend. Run: `node server.js` (port 8788).
//  This is the Adsight dual-backend pattern, improved: instead of duplicating
//  the query/mapper logic (Adsight kept two byte-identical twins that had to
//  be edited in lockstep), this imports the SAME ./api/_snowflake.js module
//  the Vercel functions use. One source of truth → the twins can't drift.
//
//  Credentials come from .env (never hard-coded, never committed).
// ─────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fetchMarketplaceWbr } from './api/_marketplace_wbr.js';
import { fetchMarketplaceChannelWbr } from './api/_marketplace_channel.js';
import { fetchWebsiteWbr } from './api/_website_wbr.js';
import { fetchSkuMatrix } from './api/_sku_matrix.js';
import { fetchSecondarySales, fetchSecondaryFilters } from './api/_secondary_sales.js';
import { fetchCitySales, fetchCityFilters } from './api/_city_sales.js';
import { fetchGokwik, fetchGokwikFilters } from './api/_gokwik.js';
import { fetchOverall, fetchChannelDetail, fetchCube, runQuery, fetchPrimaryD1, fetchPrimaryMTD, fetchPrimaryFreshness, fetchPrimaryTargets, PRIMARY_EXCLUDE_STATUSES, fetchAdsAll, fetchSalesSnapAll, fetchMktFreshness, ADS_DATE_OFFSET, fetchAdSpendRange, fetchWebsiteDaily, fetchWebsiteFreshness, fetchBrandShare, fetchBrandCityShare, fetchPrimaryChannelTargets } from './api/_snowflake.js';

const _norm = x => String(x||'').trim().toLowerCase();
function buildMarketplace(ads, sales, freshness, date, targets) {
  const adsBy = new Map(ads.map(a => [_norm(a.channel), a]));
  const rows = sales.map(s => {
    const a = adsBy.get(_norm(s.channel)) || null;
    const win = w => { const sec=s[w].sec, mrp=s[w].mrp, units=s[w].units;
      const adRev=a?a[w].rev:0, spend=a?a[w].spend:0, adUnits=a?a[w].units:0;
      const imp=a?a[w].imp:0, clk=a?a[w].clk:0, views=a?(a[w].views||0):0;
      const organic=sec-adRev;
      return { mrp, units, sec,
        avgMrp: units>0?mrp/units:null, asp: units>0?sec/units:null,
        discount: mrp>0?((mrp-sec)/mrp)*100:null, tacos: sec>0?(spend/sec)*100:null,
        organic, organicShare: sec>0?(organic/sec)*100:null,
        spend, adRev, adUnits, imp, clk, views,
        adAvgMrp: adUnits>0?adRev/adUnits:null,
        ctr: imp>0?(clk/imp)*100:null, cov: clk>0?(adUnits/clk)*100:null,
        acos: adRev>0?(spend/adRev)*100:null, roas: spend>0?adRev/spend:null };
    };
    const drr = s.selDay>0 ? s.mtd.units/s.selDay : null;
    return { channel:s.channel, offset:ADS_DATE_OFFSET[s.channel]||0, hasAds:!!a, sel:win('sel'), mtd:win('mtd'), pm:win('pm'), drr };
  }).filter(r => r.mtd.sec>0 || r.mtd.mrp>0 || r.mtd.spend>0);
  return { ok:true, rows, freshness, targets: targets||[], meta:{ date, d2Channels:Object.keys(ADS_DATE_OFFSET), targetBasis:'gs_primary_targets (primary-sales basis)' } };
}

const app = express();
app.use(cors());                          // allow the Vite dev server (:5174) to call this
const PORT = process.env.PORT || 8788;    // 8788 so it won't clash with Adsight's 8787

app.get('/api/health', async (req, res) => {
  try {
    const rows = await runQuery('SELECT CURRENT_VERSION() AS V, CURRENT_WAREHOUSE() AS W', []);
    res.json({ ok: true, snowflake: rows[0] || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/overall', async (req, res) => {
  try {
    const { from, to } = req.query;
    const { rows, meta } = await fetchOverall(from, to);
    res.json({ ok: true, count: rows.length, rows, meta });
  } catch (err) {
    console.error('[/api/overall]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/channel-detail', async (req, res) => {
  try {
    const { name, from, to } = req.query;
    if (!name) return res.status(400).json({ ok: false, error: 'Missing ?name=' });
    const data = await fetchChannelDetail(name, from, to);
    res.json({ ok: true, ...data, count: data.skus.length });
  } catch (err) {
    console.error('[/api/channel-detail]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get('/api/cube', async (req, res) => {
  try {
    const { from, to, prevFrom, prevTo } = req.query;
    const { rows } = await fetchCube(from, to, prevFrom, prevTo);
    res.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('[/api/cube]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get('/api/daily', async (req, res) => {
  try {
    const { date, dataset = 'snapshot' } = req.query;
    if (!date) return res.status(400).json({ ok: false, error: 'Missing ?date=' });
    const ym = String(date).slice(0, 7);
    const [d1, mtd, freshness, targets] = await Promise.all([
      fetchPrimaryD1(dataset, date),
      fetchPrimaryMTD(dataset, date),
      fetchPrimaryFreshness(dataset),
      fetchPrimaryTargets(ym),
    ]);
    res.json({ ok: true, d1, mtd, freshness, targets, meta: { dataset, excludedStatuses: PRIMARY_EXCLUDE_STATUSES } });
  } catch (err) {
    console.error('[/api/daily]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get('/api/marketplace', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ ok: false, error: 'Missing ?date=' });
    const [ads, sales, freshness, targets] = await Promise.all([ fetchAdsAll(date), fetchSalesSnapAll(date), fetchMktFreshness(), fetchPrimaryTargets(String(date).slice(0,7)).catch(() => []) ]);
    res.json(buildMarketplace(ads, sales, freshness, date, targets));
  } catch (err) { console.error('[/api/marketplace]', err.message); res.status(500).json({ ok:false, error: err.message }); }
});


app.get('/api/adspend', async (req, res) => {
  try {
    const { from, to, prevFrom, prevTo } = req.query;
    const [cur, prev] = await Promise.all([
      fetchAdSpendRange(from, to),
      prevFrom && prevTo ? fetchAdSpendRange(prevFrom, prevTo) : Promise.resolve([]),
    ]);
    res.json({ ok: true, cur, prev });
  } catch (err) { console.error('[/api/adspend]', err.message); res.status(500).json({ ok:false, error: err.message }); }
});

app.get('/api/website-daily', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ ok: false, error: 'Missing ?date=' });
    const [data, freshness] = await Promise.all([
      fetchWebsiteDaily(date),
      fetchWebsiteFreshness().catch(() => []),
    ]);
    res.json({ ok: true, ...data, freshness });
  } catch (err) {
    console.error('[/api/website-daily]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/gokwik', async (req, res) => {
  try {
    const data = await fetchGokwik(req.query);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/gokwik]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/gokwik-filters', async (req, res) => {
  try {
    const data = await fetchGokwikFilters();
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/gokwik-filters]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/city-sales', async (req, res) => {
  try {
    const data = await fetchCitySales(req.query);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/city-sales]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/city-filters', async (req, res) => {
  try {
    const data = await fetchCityFilters();
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/city-filters]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/secondary-sales', async (req, res) => {
  try {
    const data = await fetchSecondarySales(req.query);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/secondary-sales]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/secondary-filters', async (req, res) => {
  try {
    const data = await fetchSecondaryFilters();
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/secondary-filters]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/sku-matrix', async (req, res) => {
  try {
    const { endMonth, months } = req.query;
    const data = await fetchSkuMatrix(endMonth, months);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/sku-matrix]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/brand-city', async (req, res) => {
  try {
    const data = await fetchBrandCityShare();
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/brand-city]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/brand-share', async (req, res) => {
  try {
    const data = await fetchBrandShare();
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/brand-share]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/channel-revenue', async (req, res) => {
  try {
    const { from, to, prevFrom, prevTo } = req.query;
    const rows = await fetchPrimaryChannelTargets(from, to, prevFrom, prevTo);
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('[/api/channel-revenue]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/mp-wbr', async (req, res) => {
  try {
    const { selStart, selEnd, prevStart, prevEnd } = req.query;
    const data = await fetchMarketplaceWbr(selStart, selEnd, prevStart, prevEnd);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/mp-wbr]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/mp-wbr-channel', async (req, res) => {
  try {
    const { channel, selStart, selEnd, prevStart, prevEnd } = req.query;
    const data = await fetchMarketplaceChannelWbr(channel, selStart, selEnd, prevStart, prevEnd);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/mp-wbr-channel]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/web-wbr', async (req, res) => {
  try {
    const { selStart, selEnd, prevStart, prevEnd } = req.query;
    const data = await fetchWebsiteWbr(selStart, selEnd, prevStart, prevEnd);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/web-wbr]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Revenue API running → http://localhost:${PORT}`);
  console.log(`  health : http://localhost:${PORT}/api/health`);
  console.log(`  overall: http://localhost:${PORT}/api/overall?from=2026-01-01`);
});
