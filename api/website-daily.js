// GET /api/website-daily?date=YYYY-MM-DD
// D2C website daily scorecards (Website Orders Summary + Performance Summary)
// across selected date / MTD / MTD-previous. Mirrors the Hex "Website Daily
// Report" notebook. Serverless twin of the /api/website-daily route in server.js.
import { fetchWebsiteDaily, fetchWebsiteFreshness } from './_snowflake.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { date } = req.query || {};
    if (!date) return res.status(400).json({ ok: false, error: 'Missing ?date=' });
    const [data, freshness] = await Promise.all([
      fetchWebsiteDaily(date),
      fetchWebsiteFreshness().catch(() => []),
    ]);
    res.status(200).json({ ok: true, ...data, freshness });
  } catch (err) {
    console.error('[/api/website-daily]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
