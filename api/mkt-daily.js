// Grouped function: daily, marketplace, adspend, brand-city, brand-share,
// channel-revenue.
// See api/_dispatch.js for why these routes share one file, and
// vercel.json for the /api/<name> → /api/mkt-daily?route=<name> rewrites.
import { router } from './_dispatch.js';
import {
  fetchPrimaryD1, fetchPrimaryMTD, fetchPrimaryFreshness, fetchPrimaryTargets, PRIMARY_EXCLUDE_STATUSES,
  fetchAdsAll, fetchSalesSnapAll, fetchMktFreshness, ADS_DATE_OFFSET,
  fetchAdSpendRange, fetchBrandCityShare, fetchBrandShare, fetchPrimaryChannelTargets,
} from './_snowflake.js';

// case-insensitive channel merge (ads 'Swiggy' vs sales 'Swiggy', etc.)
const norm = s => String(s || '').trim().toLowerCase();

export default router({
  // GET /api/daily?date=YYYY-MM-DD&dataset=snapshot|attributed
  // The Daily Business Report payload: D-1 summary, M-1 (MTD) summary,
  // per-channel freshness, and the month's primary targets.
  daily: async (req, res, q) => {
    const { date, dataset = 'snapshot' } = q;
    if (!date) return res.status(400).json({ ok: false, error: 'Missing ?date=' });
    const ym = String(date).slice(0, 7);
    const [d1, mtd, freshness, targets] = await Promise.all([
      fetchPrimaryD1(dataset, date),
      fetchPrimaryMTD(dataset, date),
      fetchPrimaryFreshness(dataset),
      fetchPrimaryTargets(ym),
    ]);
    res.status(200).json({ ok: true, d1, mtd, freshness, targets,
      meta: { dataset, excludedStatuses: PRIMARY_EXCLUDE_STATUSES } });
  },

  // GET /api/marketplace?date=YYYY-MM-DD
  // Merges ads + sales-snapshot per channel into the marketplace scorecard,
  // deriving Organic / TACOS / ACOS / ROAS. Powers Executive Overview and
  // Marketplace Performance.
  marketplace: async (req, res, q) => {
    const { date } = q;
    if (!date) return res.status(400).json({ ok: false, error: 'Missing ?date=' });
    const [ads, sales, freshness, targets] = await Promise.all([
      fetchAdsAll(date), fetchSalesSnapAll(date), fetchMktFreshness(),
      fetchPrimaryTargets(String(date).slice(0, 7)).catch(() => []),
    ]);
    const adsBy = new Map(ads.map(a => [norm(a.channel), a]));
    const rows = sales.map(s => {
      const a = adsBy.get(norm(s.channel)) || null;
      const win = w => {
        const sec = s[w].sec, mrp = s[w].mrp, units = s[w].units;
        const adRev = a ? a[w].rev : 0, spend = a ? a[w].spend : 0, adUnits = a ? a[w].units : 0;
        const imp = a ? a[w].imp : 0, clk = a ? a[w].clk : 0, views = a ? (a[w].views || 0) : 0;
        const organic = sec - adRev;
        return {
          // ── sales block (Hex order) ──
          mrp, units, sec,
          avgMrp: units > 0 ? mrp / units : null,
          asp: units > 0 ? sec / units : null,
          discount: mrp > 0 ? ((mrp - sec) / mrp) * 100 : null,
          tacos: sec > 0 ? (spend / sec) * 100 : null,
          organic, organicShare: sec > 0 ? (organic / sec) * 100 : null,
          // ── ads block (Hex order) ──
          spend, adRev, adUnits, imp, clk, views,
          adAvgMrp: adUnits > 0 ? adRev / adUnits : null,
          ctr: imp > 0 ? (clk / imp) * 100 : null,
          cov: clk > 0 ? (adUnits / clk) * 100 : null,
          acos: adRev > 0 ? (spend / adRev) * 100 : null,
          roas: spend > 0 ? adRev / spend : null,
        };
      };
      const drr = s.selDay > 0 ? s.mtd.units / s.selDay : null;
      return { channel: s.channel, offset: ADS_DATE_OFFSET[s.channel] || 0,
        hasAds: !!a, sel: win('sel'), mtd: win('mtd'), pm: win('pm'), drr };
    }).filter(r => r.mtd.sec > 0 || r.mtd.mrp > 0 || r.mtd.spend > 0);
    res.status(200).json({ ok: true, rows, freshness, targets, meta: { date, d2Channels: Object.keys(ADS_DATE_OFFSET), targetBasis: 'gs_primary_targets (primary-sales basis)' } });
  },

  // GET /api/adspend?from=&to=&prevFrom=&prevTo= — spend/adRev per channel, both windows
  adspend: async (req, res, q) => {
    const { from, to, prevFrom, prevTo } = q;
    const [cur, prev] = await Promise.all([
      fetchAdSpendRange(from, to),
      prevFrom && prevTo ? fetchAdSpendRange(prevFrom, prevTo) : Promise.resolve([]),
    ]);
    res.status(200).json({ ok: true, cur, prev });
  },

  // GET /api/brand-city
  // Brand share of category resolved to city, quick commerce only. Mirrors the
  // city lineage in the Hex "WBR - Brand" notebook.
  'brand-city': async (req, res) => {
    const data = await fetchBrandCityShare();
    res.status(200).json({ ok: true, ...data });
  },

  // GET /api/brand-share
  // Brand share of category by channel × category × month, stitched from the
  // marketplace share sheets, the Amazon panel feed, and the quick-commerce
  // weekly panel. Mirrors the Hex "WBR - Brand" notebook's df_market_share.
  'brand-share': async (req, res) => {
    const data = await fetchBrandShare();
    res.status(200).json({ ok: true, ...data });
  },

  // GET /api/channel-revenue?from=&to=&prevFrom=&prevTo=
  // Per-channel primary (sell-in) NET revenue for the window, plus its
  // monthly target prorated across that same window. Powers the "Where
  // revenue comes from" achievement-vs-target bar on the All Channels tab.
  'channel-revenue': async (req, res, q) => {
    const { from, to, prevFrom, prevTo } = q;
    const rows = await fetchPrimaryChannelTargets(from, to, prevFrom, prevTo);
    res.status(200).json({ ok: true, rows });
  },
});
