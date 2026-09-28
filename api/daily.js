// GET /api/daily?date=YYYY-MM-DD&dataset=snapshot|attributed
// The Daily Business Report payload: D-1 summary, M-1 (MTD) summary,
// per-channel freshness, and the month's primary targets.
import { fetchPrimaryD1, fetchPrimaryMTD, fetchPrimaryFreshness, fetchPrimaryTargets, PRIMARY_EXCLUDE_STATUSES } from './_snowflake.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { date, dataset = 'snapshot' } = req.query || {};
    if (!date) return res.status(400).json({ ok: false, error: 'Missing ?date=' });
    const ym = String(date).slice(0, 7);
    const [d1, mtd, freshness, targets] = await Promise.all([
      fetchPrimaryD1(dataset, date),
      fetchPrimaryMTD(dataset, date),
      fetchPrimaryFreshness(dataset),
      fetchPrimaryTargets(ym),
    ]);
    res.status(200).json({ ok: true, d1, mtd, freshness, targets,
      meta: { dataset, excludedStatuses: PRIMARY_EXCLUDE_STATUSES } });
  } catch (err) {
    console.error('[/api/daily]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
