// GET /api/gokwik-filters
// Channel / source / campaign lists for the GoKwik Retention controls.
import { fetchGokwikFilters } from './_gokwik.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await fetchGokwikFilters();
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/gokwik-filters]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
