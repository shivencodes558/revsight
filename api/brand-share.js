// GET /api/brand-share
// Brand share of category by channel × category × month, stitched from the
// marketplace share sheets, the Amazon panel feed, and the quick-commerce
// weekly panel. Mirrors the Hex "WBR - Brand" notebook's df_market_share.
import { fetchBrandShare } from './_snowflake.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await fetchBrandShare();
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/brand-share]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
