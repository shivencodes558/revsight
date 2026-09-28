// GET /api/channel-detail?name=Amazon&from=YYYY-MM-DD&to=YYYY-MM-DD
// SKU-level rollup for one channel over a date window.
import { fetchChannelDetail } from './_snowflake.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { name, from, to } = req.query || {};
    if (!name) return res.status(400).json({ ok: false, error: 'Missing ?name=' });
    const data = await fetchChannelDetail(name, from, to);
    res.status(200).json({ ok: true, ...data, count: data.skus.length });
  } catch (err) {
    console.error('[/api/channel-detail]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
