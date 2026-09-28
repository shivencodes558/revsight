// GET /api/web-wbr?selStart=&selEnd=&prevStart=&prevEnd=
// D2C website WBR scorecard over the selected window vs its comparison.
import { fetchWebsiteWbr } from './_website_wbr.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { selStart, selEnd, prevStart, prevEnd } = req.query || {};
    const data = await fetchWebsiteWbr(selStart, selEnd, prevStart, prevEnd);
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/web-wbr]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
