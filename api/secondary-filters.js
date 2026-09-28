// GET /api/secondary-filters
// Distinct channel / category / sub-category / classification / SKU lists for
// the Secondary Sales filter controls. Cached separately from the metrics so
// picking a filter never re-fetches the list it was picked from.
import { fetchSecondaryFilters } from './_secondary_sales.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await fetchSecondaryFilters();
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/secondary-filters]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
