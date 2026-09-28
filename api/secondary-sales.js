// GET /api/secondary-sales?from&to&prevFrom&prevTo[&statusMode&channels&categories&subCategories&skus&classifications&monthsBack]
// Secondary (sell-out) sales trends from MARKETPLACE_SECONDARY_SALES_RPT.
import { fetchSecondarySales } from './_secondary_sales.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await fetchSecondarySales(req.query || {});
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/secondary-sales]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
