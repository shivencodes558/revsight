// Frontend date helpers (pure YMD math). Mirrors the pure functions in
// api/dates.js but kept separate so the browser bundle carries no server code.

function fmt(y, mo, d) {
  return String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// today in IST as YYYY-MM-DD (all revenue dates are IST)
export function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60000);
  return fmt(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

export function shiftYMD(ymd, days) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// ── month arithmetic, for calendar-aligned comparisons ────────────────────
const parse = ymd => {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
};
export function lastDayOfMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();   // mo is 1-based
}
export function startOfMonth(ymd) {
  const p = parse(ymd); if (!p) return null;
  return fmt(p.y, p.mo, 1);
}
export function endOfMonth(ymd) {
  const p = parse(ymd); if (!p) return null;
  return fmt(p.y, p.mo, lastDayOfMonth(p.y, p.mo));
}
// shift by whole months, clamping the day to the target month's length
export function shiftMonth(ymd, months) {
  const p = parse(ymd); if (!p) return null;
  const total = p.y * 12 + (p.mo - 1) + months;
  const y = Math.floor(total / 12), mo = (total % 12) + 1;
  return fmt(y, mo, Math.min(p.d, lastDayOfMonth(y, mo)));
}
// Same span one calendar month earlier — the "MTD vs same period last month"
// comparison. If `to` is its month's last day, the prior window is the FULL
// previous month, so a complete month is never compared against a partial one.
export function sameSpanPrevMonth(from, to) {
  const pf = parse(from), pt = parse(to);
  if (!pf || !pt) return { prevFrom: null, prevTo: null };
  const prevFrom = shiftMonth(from, -1);
  const isMonthEnd = pt.d === lastDayOfMonth(pt.y, pt.mo);
  const prevTo = isMonthEnd ? endOfMonth(shiftMonth(to, -1)) : shiftMonth(to, -1);
  return { prevFrom, prevTo };
}

export function daysBetween(a, b) {
  const pa = String(a).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const pb = String(b).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!pa || !pb) return 0;
  const da = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const db = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((db - da) / 86400000) + 1;
}
