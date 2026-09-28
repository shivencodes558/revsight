// ─────────────────────────────────────────────────────────────────────────
//  _dispatch.js — shared CORS/OPTIONS/error-envelope wrapper for the grouped
//  route functions (core, mkt-daily, wbr, website, secondary, city).
//
//  Vercel's Hobby plan caps a deployment at 12 Serverless Functions; this API
//  has 20 GET routes, so they are grouped into 6 files by feature area, each
//  exposing several routes behind ONE function. vercel.json rewrites each
//  original path (e.g. /api/overall) to its group with a `route` marker
//  (e.g. /api/core?route=overall&from=...&to=...) — the browser-visible URL,
//  and every other query param, is unchanged, so the frontend needed zero
//  changes for this split.
//
//  `routes` maps route-name → async (req, res, query) => { ...res.json(...) }.
//  This only removes the copy-pasted CORS/OPTIONS/try-catch boilerplate that
//  used to live in each of the 20 standalone files — the handler bodies
//  themselves are unchanged.
// ─────────────────────────────────────────────────────────────────────────
export function router(routes) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    const { route, ...query } = req.query || {};
    const fn = routes[route];
    if (!fn) return res.status(404).json({ ok: false, error: `Unknown route: ${route}` });
    try {
      await fn(req, res, query);
    } catch (err) {
      console.error(`[/api/*?route=${route}]`, err.message);
      if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
    }
  };
}
