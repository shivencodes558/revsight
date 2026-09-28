// Grouped function: health, overall, cube, channel-detail.
// See api/_dispatch.js for why these routes share one file, and
// vercel.json for the /api/<name> → /api/core?route=<name> rewrites.
import { router } from './_dispatch.js';
import { runQuery, fetchOverall, fetchChannelDetail, fetchCube } from './_snowflake.js';

export default router({
  // GET /api/health — confirms the function is up and Snowflake is reachable.
  health: async (req, res) => {
    const rows = await runQuery('SELECT CURRENT_VERSION() AS V, CURRENT_WAREHOUSE() AS W', []);
    res.status(200).json({ ok: true, snowflake: rows[0] || null });
  },

  // GET /api/overall?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Channel × day revenue rollup at Volume / MRP / SP bases.
  overall: async (req, res, q) => {
    const { from, to } = q;
    const { rows, meta } = await fetchOverall(from, to);
    res.status(200).json({ ok: true, count: rows.length, rows, meta });
  },

  // GET /api/cube?from=&to=&prevFrom=&prevTo=
  // Channel × category × sub-category × SKU cube with current + prior totals.
  cube: async (req, res, q) => {
    const { from, to, prevFrom, prevTo } = q;
    const { rows } = await fetchCube(from, to, prevFrom, prevTo);
    res.status(200).json({ ok: true, count: rows.length, rows });
  },

  // GET /api/channel-detail?name=Amazon&from=YYYY-MM-DD&to=YYYY-MM-DD
  // SKU-level rollup for one channel over a date window.
  'channel-detail': async (req, res, q) => {
    const { name, from, to } = q;
    if (!name) return res.status(400).json({ ok: false, error: 'Missing ?name=' });
    const data = await fetchChannelDetail(name, from, to);
    res.status(200).json({ ok: true, ...data, count: data.skus.length });
  },
});
