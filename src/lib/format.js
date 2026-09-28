// ─────────────────────────────────────────────────────────────────────────
//  format.js — Indian number system + L/Cr abbreviations.
//  Ports the Hex notebook's format_indian_number logic (12,34,56,789), plus
//  the L/Cr short forms execs expect in KPIs. Intl.NumberFormat('en-IN') gives
//  the grouping but NOT the L/Cr abbreviations, so those are done by hand.
// ─────────────────────────────────────────────────────────────────────────

// 123456789 → "12,34,56,789"  (Indian grouping: last 3, then 2s)
export function indianGroup(n) {
  if (n == null || isNaN(n)) return '0';
  const neg = n < 0;
  let s = String(Math.round(Math.abs(n)));
  if (s.length <= 3) return (neg ? '-' : '') + s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts = [];
  while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
  if (rest) parts.unshift(rest);
  return (neg ? '-' : '') + parts.join(',') + ',' + last3;
}

// 12345678 → "₹1.23Cr" · 123456 → "₹1.23L" · 1234 → "₹1,234"
export function inrShort(n, { currency = true } = {}) {
  if (n == null || isNaN(n)) return currency ? '₹0' : '0';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const pre = currency ? '₹' : '';
  if (a >= 1e7)  return sign + pre + (a / 1e7).toFixed(2).replace(/\.00$/, '') + 'Cr';
  if (a >= 1e5)  return sign + pre + (a / 1e5).toFixed(2).replace(/\.00$/, '') + 'L';
  if (a >= 1e3)  return sign + pre + indianGroup(a);
  return sign + pre + indianGroup(a);
}

// short form for plain counts (units): 1234567 → "12.35L", 1234 → "1,234"
export function countShort(n) {
  if (n == null || isNaN(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e7) return sign + (a / 1e7).toFixed(2).replace(/\.00$/, '') + 'Cr';
  if (a >= 1e5) return sign + (a / 1e5).toFixed(2).replace(/\.00$/, '') + 'L';
  return sign + indianGroup(a);
}

export function pct(n, digits = 1) {
  if (n == null || isNaN(n)) return '0%';
  return n.toFixed(digits) + '%';
}

// signed delta with arrow, for PoP KPI chips
export function signedPct(n, digits = 1) {
  if (n == null || isNaN(n)) return '—';
  const s = (n > 0 ? '+' : '') + n.toFixed(digits) + '%';
  return s;
}

// "2026-08-04" → "4 Aug"
export function shortDate(ymd) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  if (isNaN(d)) return ymd;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// "2026-08-04" → "4 Aug 2026"
export function longDate(ymd) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  if (isNaN(d)) return ymd;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// "2026-08" → "Aug 2026"  (month-grain axis labels)
export function monthLabel(ym) {
  if (!ym) return '';
  const d = new Date(ym + '-01T00:00:00');
  if (isNaN(d)) return ym;
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
