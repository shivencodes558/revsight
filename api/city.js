// Grouped function: city-sales, city-filters, sku-matrix.
// See api/_dispatch.js for why these routes share one file, and
// vercel.json for the /api/<name> → /api/city?route=<name> rewrites.
import { router } from './_dispatch.js';
import { fetchCitySales, fetchCityFilters } from './_city_sales.js';
import { fetchSkuMatrix } from './_sku_matrix.js';

export default router({
  // GET /api/city-sales?from&to[&grain&rowBy&measure&statusMode&channels&states&cities&skus&categories&subCategories&topN]
  // City/state sales pivot from STATE_CITY_QTY, day or week grain.
  'city-sales': async (req, res, q) => {
    const data = await fetchCitySales(q || {});
    res.status(200).json({ ok: true, ...data });
  },

  // GET /api/city-filters
  // Distinct channel / state / city / category / sub-category / SKU lists for
  // the City Wise Sales controls. Cached separately from the grid.
  'city-filters': async (req, res) => {
    const data = await fetchCityFilters();
    res.status(200).json({ ok: true, ...data });
  },

  // GET /api/sku-matrix?endMonth=YYYY-MM&months=12
  // SKU × month fact grid (units / MRP / SP) powering the All Channels
  // month-over-month matrices. Category tables are grouped from these rows in
  // the frontend, so category and SKU totals always reconcile.
  'sku-matrix': async (req, res, q) => {
    const { endMonth, months } = q;
    const data = await fetchSkuMatrix(endMonth, months);
    res.status(200).json({ ok: true, ...data });
  },
});
