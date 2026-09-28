// Grouped function: secondary-sales, secondary-filters.
// See api/_dispatch.js for why these routes share one file, and
// vercel.json for the /api/<name> → /api/secondary?route=<name> rewrites.
import { router } from './_dispatch.js';
import { fetchSecondarySales, fetchSecondaryFilters } from './_secondary_sales.js';

export default router({
  // GET /api/secondary-sales?from&to&prevFrom&prevTo[&statusMode&channels&categories&subCategories&skus&classifications&monthsBack]
  // Secondary (sell-out) sales trends from MARKETPLACE_SECONDARY_SALES_RPT.
  'secondary-sales': async (req, res, q) => {
    const data = await fetchSecondarySales(q || {});
    res.status(200).json({ ok: true, ...data });
  },

  // GET /api/secondary-filters
  // Distinct channel / category / sub-category / classification / SKU lists for
  // the Secondary Sales filter controls. Cached separately from the metrics so
  // picking a filter never re-fetches the list it was picked from.
  'secondary-filters': async (req, res) => {
    const data = await fetchSecondaryFilters();
    res.status(200).json({ ok: true, ...data });
  },
});
