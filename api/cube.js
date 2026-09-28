// GET /api/cube?from=&to=&prevFrom=&prevTo=
// Channel × category × sub-category × SKU cube with current + prior totals.
import { fetchCube } from './_snowflake.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { from, to, prevFrom, prevTo } = req.query || {};
    const { rows } = await fetchCube(from, to, prevFrom, prevTo);
    res.status(200).json({ ok: true, count: rows.length, rows });
  } catch (err) {
    console.error('[/api/cube]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
