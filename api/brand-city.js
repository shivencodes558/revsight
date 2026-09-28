// GET /api/brand-city
// Brand share of category resolved to city, quick commerce only. Mirrors the
// city lineage in the Hex "WBR - Brand" notebook.
import { fetchBrandCityShare } from './_snowflake.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await fetchBrandCityShare();
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/brand-city]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
