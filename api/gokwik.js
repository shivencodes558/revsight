// GET /api/gokwik?from&to&prevFrom&prevTo[&channels&sources&campaigns]
// GoKwik Engage retention: campaigns + abandoned cart + automations, unioned.
import { fetchGokwik } from './_gokwik.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await fetchGokwik(req.query || {});
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/gokwik]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
