// GET /api/health — confirms the function is up and Snowflake is reachable.
import { runQuery } from './_snowflake.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const rows = await runQuery('SELECT CURRENT_VERSION() AS V, CURRENT_WAREHOUSE() AS W', []);
    res.status(200).json({ ok: true, snowflake: rows[0] || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
