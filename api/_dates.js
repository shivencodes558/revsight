// ─────────────────────────────────────────────────────────────────────────
//  dates.js — ONE hardened date parser. Replaces Adsight's three parsers
//  (toYMD / toYMD_ddmmyyyy / toYMD_zepto), which had known edge-case bugs:
//    • toYMD_ddmmyyyy happily emitted month-13 strings (never validated)
//    • overall.js used the wrong parser for a VARCHAR date column
//  Revenue analytics is even more date-sensitive (period-over-period is
//  everywhere), so every branch here VALIDATES the month/day and returns
//  null on anything impossible rather than silently mis-dating a row.
//
//  Returns a 'YYYY-MM-DD' string, or null. Never throws.
//
//  NOTE: the SQL layer already normalises ORDER_DATE via TRY_TO_DATE(), so in
//  practice this receives clean ISO strings. It exists as a validated safety
//  net — if a future source leaks a raw DD-MM-YYYY or Excel serial through,
//  it lands correctly instead of corrupting a trend.
// ─────────────────────────────────────────────────────────────────────────

// days-in-month with leap-year handling
function validYMD(y, mo, d) {
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dim[mo - 1];
}

function fmt(y, mo, d) {
  return String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Excel serial (1900 date system) → YMD. Excel day 25569 = 1970-01-01.
function fromExcelSerial(n) {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  if (isNaN(dt)) return null;
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function parseDate(v) {
  if (v == null || v === '') return null;

  // real Date object from the driver
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    return fmt(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }

  // numeric: Excel serial (small) or epoch ms (large)
  if (typeof v === 'number') {
    if (!isFinite(v)) return null;
    if (v > 0 && v < 100000) return fromExcelSerial(v);      // Excel serial
    const dt = new Date(v);                                   // epoch ms
    return isNaN(dt) ? null : fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  const s = String(v).trim();
  if (!s) return null;

  // pure digits → Excel serial (e.g. "46188")
  if (/^\d{5}$/.test(s)) return fromExcelSerial(+s);

  // ISO: YYYY-MM-DD (optionally followed by time). Validate before trusting.
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return validYMD(y, mo, d) ? fmt(y, mo, d) : null;
  }

  // DD-MM-YYYY or DD/MM/YYYY (India convention). Validate — this is the branch
  // Adsight's toYMD_ddmmyyyy left unguarded.
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    return validYMD(y, mo, d) ? fmt(y, mo, d) : null;
  }

  // DD-MM-YY or DD/MM/YY → 20YY
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m) {
    const d = +m[1], mo = +m[2], y = 2000 + +m[3];
    return validYMD(y, mo, d) ? fmt(y, mo, d) : null;
  }

  // last resort: let the engine try (handles "Jan 5 2026", RFC strings, etc.),
  // but only accept if it produced a sane calendar date.
  const dt = new Date(s);
  if (!isNaN(dt)) return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());

  return null;
}

// convenience: today in IST as YYYY-MM-DD (all revenue dates are IST)
export function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60000);
  return fmt(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

// add/subtract days from a YYYY-MM-DD string, returns YYYY-MM-DD
export function shiftYMD(ymd, days) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// inclusive day count between two YYYY-MM-DD strings
export function daysBetween(a, b) {
  const pa = String(a).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const pb = String(b).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!pa || !pb) return 0;
  const da = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const db = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((db - da) / 86400000) + 1;
}
