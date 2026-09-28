// GET /api/mp-wbr?selStart=&selEnd=&prevStart=&prevEnd=
// Marketplace WBR headline table — sales vs comparison window, prorated target,
// achievement, discount and per-platform TACOS. Mirrors the Hex "WBR -
// Marketplace" notebook's OVERALL-MP output.
import { fetchMarketplaceWbr } from './_marketplace_wbr.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { selStart, selEnd, prevStart, prevEnd } = req.query || {};
    const data = await fetchMarketplaceWbr(selStart, selEnd, prevStart, prevEnd);
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/mp-wbr]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
