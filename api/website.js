// Grouped function: website-daily, gokwik, gokwik-filters.
// See api/_dispatch.js for why these routes share one file, and
// vercel.json for the /api/<name> → /api/website?route=<name> rewrites.
import { router } from './_dispatch.js';
import { fetchWebsiteDaily, fetchWebsiteFreshness, fetchWebsiteDOD, fetchWebsiteProductSummary, fetchWebsiteTarget } from './_snowflake.js';
import { fetchGokwik, fetchGokwikFilters } from './_gokwik.js';

export default router({
  // GET /api/website-daily?date=YYYY-MM-DD
  // D2C website daily scorecards (Website Orders Summary + Performance Summary,
  // GoKwik/DB breakdown, customer mix, DOD trend, product-wise summary) across
  // selected date / MTD / MTD-previous. Mirrors the Hex "Website Daily Report".
  'website-daily': async (req, res, q) => {
    const { date } = q;
    if (!date) return res.status(400).json({ ok: false, error: 'Missing ?date=' });
    const [data, freshness, dod, products, targetMtd] = await Promise.all([
      fetchWebsiteDaily(date),
      fetchWebsiteFreshness().catch(() => []),
      fetchWebsiteDOD(date).catch(() => []),
      fetchWebsiteProductSummary(date).catch(() => []),
      fetchWebsiteTarget(date).catch(() => null),
    ]);
    res.status(200).json({ ok: true, ...data, freshness, dod, products, targetMtd });
  },

  // GET /api/gokwik?from&to&prevFrom&prevTo[&channels&sources&campaigns]
  // GoKwik Engage retention: campaigns + abandoned cart + automations, unioned.
  gokwik: async (req, res, q) => {
    const data = await fetchGokwik(q || {});
    res.status(200).json({ ok: true, ...data });
  },

  // GET /api/gokwik-filters
  // Channel / source / campaign lists for the GoKwik Retention controls.
  'gokwik-filters': async (req, res) => {
    const data = await fetchGokwikFilters();
    res.status(200).json({ ok: true, ...data });
  },
});
