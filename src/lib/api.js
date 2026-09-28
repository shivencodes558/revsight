// ─────────────────────────────────────────────────────────────────────────
//  api.js — thin fetch wrapper. The frontend always calls "/api/...".
//  Dev: Vite proxies /api → localhost:8788 (see vite.config.js).
//  Prod: /api hits the Vercel serverless functions on the same origin.
//  So there is NO environment-specific base URL to manage.
//
//  ── Response cache ────────────────────────────────────────────────────
//  Views unmount when you switch tabs, so without a cache every return trip
//  re-runs its Snowflake query — several of which take 10-20s. The cache is
//  keyed by the full URL, so a different date window is a different key and
//  can never serve stale numbers for the window you are looking at.
//
//  It also de-duplicates IN-FLIGHT requests: two components asking for the
//  same URL at the same time share one round trip instead of racing.
//
//  `refreshAll()` empties it, which is what the header's ↻ button does — so
//  "give me current data" is still one click away.
// ─────────────────────────────────────────────────────────────────────────

const TTL_MS = 10 * 60 * 1000;      // data lands daily; 10 min is plenty fresh
const cache = new Map();            // url → { at, body }
const inflight = new Map();         // url → Promise

// Keys are SORTED so the cache key depends on what was asked for, not on the
// order the caller happened to build the object in. Without this, a prefetch
// that spells the params in a different order warms a key the view will never
// look up, and the warm-up silently buys nothing.
function buildUrl(path, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return '/api' + path + (qs ? '?' + qs : '');
}

async function fetchFresh(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  let body;
  try { body = await res.json(); }
  catch { throw new Error(`Non-JSON response from ${url} (HTTP ${res.status})`); }
  if (!res.ok || body.ok === false) {
    throw new Error(body && body.error ? body.error : `Request failed (HTTP ${res.status})`);
  }
  return body;
}

export async function getJSON(path, params = {}, opts = {}) {
  const url = buildUrl(path, params);

  if (!opts.force) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
    const pending = inflight.get(url);
    if (pending) return pending;      // someone else is already asking
  }

  const p = fetchFresh(url)
    .then(body => { cache.set(url, { at: Date.now(), body }); return body; })
    // a failure must not be cached, or one blip poisons the tab until TTL
    .finally(() => { inflight.delete(url); });

  inflight.set(url, p);
  return p;
}

/* Synchronous cache read. `getJSON` resolves a cached body through a promise,
   so a component that always routes through it flips to `loading` and back
   across a microtask — a visible "updating…" flicker on data it already had.
   `peek` lets a view commit a warm slice in the same render, which is the
   difference between a filter that feels instant and one that blinks. */
export function peek(path, params = {}) {
  const hit = cache.get(buildUrl(path, params));
  return hit && Date.now() - hit.at < TTL_MS ? hit.body : undefined;
}

// Drop everything so the next read goes to the warehouse.
export function refreshAll() {
  cache.clear();
  inflight.clear();
}

// Warm the cache without blocking anything. Runs sequentially on purpose:
// firing every heavy query at once would queue them behind each other in the
// warehouse anyway and make the visible tab slower. Failures are ignored —
// this is opportunistic, and the view will fetch normally if it misses.
//
// `alive` is checked between jobs so leaving the tab or moving the date window
// abandons the queue instead of spending the warehouse on answers nobody will
// ask for.
export async function prefetch(jobs, alive) {
  for (const [path, params] of jobs) {
    if (alive && !alive()) return;
    try { await getJSON(path, params); } catch { /* opportunistic */ }
  }
}

export function cacheStats() {
  return { entries: cache.size, inflight: inflight.size };
}

export const fetchOverall = (from, to) => getJSON('/overall', { from, to });
export const fetchChannelDetail = (name, from, to) => getJSON('/channel-detail', { name, from, to });
export const fetchCube = (from, to, prevFrom, prevTo) => getJSON('/cube', { from, to, prevFrom, prevTo });
export const fetchAdSpend = (from, to, prevFrom, prevTo) => getJSON('/adspend', { from, to, prevFrom, prevTo });
export const fetchHealth = () => getJSON('/health');
