// GET /api/city-filters
// Distinct channel / state / city / category / sub-category / SKU lists for
// the City Wise Sales controls. Cached separately from the grid.
import { fetchCityFilters } from './_city_sales.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await fetchCityFilters();
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/city-filters]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
