// GET /api/adspend?from=&to=&prevFrom=&prevTo= — spend/adRev per channel, both windows
import { fetchAdSpendRange } from './_snowflake.js';
export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { from, to, prevFrom, prevTo } = req.query || {};
    const [cur, prev] = await Promise.all([
      fetchAdSpendRange(from, to),
      prevFrom && prevTo ? fetchAdSpendRange(prevFrom, prevTo) : Promise.resolve([]),
    ]);
    res.status(200).json({ ok: true, cur, prev });
  } catch (err) {
    console.error('[/api/adspend]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
