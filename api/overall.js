// GET /api/overall?from=YYYY-MM-DD&to=YYYY-MM-DD
// Channel × day revenue rollup at Volume / MRP / SP bases.
import { fetchOverall } from './_snowflake.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { from, to } = req.query || {};
    const { rows, meta } = await fetchOverall(from, to);
    res.status(200).json({ ok: true, count: rows.length, rows, meta });
  } catch (err) {
    console.error('[/api/overall]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
