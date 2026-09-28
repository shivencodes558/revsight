// ─────────────────────────────────────────────────────────────────────────
//  metrics.js — the three revenue bases and the aggregation helpers that turn
//  the flat /api/overall rows (channel × day) into the shapes each chart wants.
//  Mirrors the Hex notebook's three parallel worlds: Volume / MRP / SP.
// ─────────────────────────────────────────────────────────────────────────
import { inrShort, countShort } from './format.js';

// metric registry — the global toggle. `field` maps to a row key from the API.
export const METRICS = {
  mrp:    { id: 'mrp',    label: 'MRP Sales', field: 'mrp',   money: true,  hint: 'Gross offtake at MRP · all channels incl. quick commerce' },
  sp:     { id: 'sp',     label: 'SP Sales',  field: 'sp',    money: true,  hint: 'Net realised selling price · marketplace + D2C (quick commerce reports zero SP)' },
  volume: { id: 'volume', label: 'Volume',    field: 'units', money: false, hint: 'Units sold across all channels' },
};

export const METRIC_ORDER = ['mrp', 'sp', 'volume'];

export function fmtMetric(metricId, v) {
  return METRICS[metricId].money ? inrShort(v) : countShort(v);
}

// sum a metric field over a set of rows
export function sumField(rows, field) {
  let t = 0;
  for (const r of rows) t += r[field] || 0;
  return t;
}

// filter rows to an inclusive [from,to] date window
export function inRange(rows, from, to) {
  return rows.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
}

// daily trend: [{date, value}] summed across channels for the chosen field
export function trendByDay(rows, field) {
  const m = new Map();
  for (const r of rows) m.set(r.date, (m.get(r.date) || 0) + (r[field] || 0));
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

// month-grain trend: [{ym, value}]
export function trendByMonth(rows, field) {
  const m = new Map();
  for (const r of rows) {
    const ym = r.date.slice(0, 7);
    m.set(ym, (m.get(ym) || 0) + (r[field] || 0));
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([ym, value]) => ({ ym, value }));
}

// per-channel totals for the chosen field, sorted desc, with % share
export function byChannel(rows, field) {
  const m = new Map(); // channel → {channel, group, value}
  for (const r of rows) {
    let e = m.get(r.channel);
    if (!e) { e = { channel: r.channel, group: r.group, value: 0, units: 0, orders: 0 }; m.set(r.channel, e); }
    e.value += r[field] || 0;
    e.units += r.units || 0;
    e.orders += r.orders || 0;
  }
  const arr = [...m.values()].sort((a, b) => b.value - a.value);
  const total = arr.reduce((s, x) => s + x.value, 0) || 1;
  arr.forEach(x => { x.share = (x.value / total) * 100; });
  return arr;
}

// per-group totals (Marketplace / Q-Commerce / D2C)
export function byGroup(rows, field) {
  const m = new Map();
  for (const r of rows) m.set(r.group, (m.get(r.group) || 0) + (r[field] || 0));
  const arr = [...m.entries()].map(([group, value]) => ({ group, value })).sort((a, b) => b.value - a.value);
  const total = arr.reduce((s, x) => s + x.value, 0) || 1;
  arr.forEach(x => { x.share = (x.value / total) * 100; });
  return arr;
}

// period-over-period: given current window rows + previous window rows, return
// { current, previous, deltaPct } for a field.
export function pop(curRows, prevRows, field) {
  const current = sumField(curRows, field);
  const previous = sumField(prevRows, field);
  const deltaPct = previous > 0 ? ((current - previous) / previous) * 100 : null;
  return { current, previous, deltaPct };
}
