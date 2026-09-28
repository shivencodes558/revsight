// GET /api/marketplace?date=YYYY-MM-DD
// Merges ads + sales-snapshot per channel into the marketplace scorecard,
// deriving Organic / TACOS / ACOS / ROAS. Powers Executive Overview and
// Marketplace Performance.
import { fetchAdsAll, fetchSalesSnapAll, fetchMktFreshness, fetchPrimaryTargets, ADS_DATE_OFFSET } from './_snowflake.js';

// case-insensitive channel merge (ads 'Swiggy' vs sales 'Swiggy', etc.)
const norm = s => String(s || '').trim().toLowerCase();

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { date } = req.query || {};
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
  } catch (err) {
    console.error('[/api/marketplace]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
