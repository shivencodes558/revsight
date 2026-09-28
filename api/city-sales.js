// GET /api/city-sales?from&to[&grain&rowBy&measure&statusMode&channels&states&cities&skus&categories&subCategories&topN]
// City/state sales pivot from STATE_CITY_QTY, day or week grain.
import { fetchCitySales } from './_city_sales.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await fetchCitySales(req.query || {});
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/city-sales]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
