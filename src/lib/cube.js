// ─────────────────────────────────────────────────────────────────────────
//  cube.js — shared aggregation over /api/cube rows.
//  aggBy groups by any key and returns sorted entries with value, prior,
//  share-of-total, growth %, and units — the shape every leaderboard,
//  scatter, matrix, and narrative in the app consumes.
// ─────────────────────────────────────────────────────────────────────────

export const CUBE_FIELDS = { mrp: ['curMrp', 'prevMrp'], sp: ['curSp', 'prevSp'], volume: ['curUnits', 'prevUnits'] };

export function aggBy(rows, keyFn, metric, metaFn) {
  const [CF, PF] = CUBE_FIELDS[metric];
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    let e = m.get(k);
    if (!e) {
      e = { key: k, cur: 0, prev: 0, curUnits: 0, prevUnits: 0, channels: new Set(), meta: metaFn ? metaFn(r) : null };
      m.set(k, e);
    }
    e.cur += r[CF] || 0;
    e.prev += r[PF] || 0;
    e.curUnits += r.curUnits || 0;
    e.prevUnits += r.prevUnits || 0;
    e.channels.add(r.channel);
  }
  const arr = [...m.values()].filter(e => e.cur !== 0 || e.prev !== 0);
  arr.sort((a, b) => b.cur - a.cur);
  const total = arr.reduce((s, e) => s + Math.max(e.cur, 0), 0) || 1;
  for (const e of arr) {
    e.share = (Math.max(e.cur, 0) / total) * 100;
    e.deltaPct = e.prev > 0 ? ((e.cur - e.prev) / e.prev) * 100 : null;
    e.channelCount = e.channels.size;
    delete e.channels;
  }
  return arr;
}

// eligibility rule for "movers" lists — shared so every view agrees
export function eligibleMovers(entries, minUnits = 30) {
  return entries.filter(e => e.prev > 0 && (e.curUnits + e.prevUnits) >= minUnits && e.deltaPct != null);
}
