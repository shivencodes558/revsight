// ═════════════════════════════════════════════════════════════════════════
//  pl.js — the Estimated P&L Engine.
//
//  SOURCE OF TRUTH: "Weekly PL Tracker - July'26.xlsx", sheets `Channel PL FTM`
//  (July channel-level P&L) and `Plan vs Proj` (16 months of history, Apr'25 →
//  Jul'26, sourced from "Revised MIS"). Every ratio below was derived from that
//  file and reconciled to the rupee — none are industry benchmarks.
//
//  The tracker's P&L terminates at CONTRIBUTION MARGIN 3. It contains NO fixed
//  cost block (no salaries, rent, depreciation, overheads, interest or tax —
//  all 19 sheets were searched). Therefore Net Profit CANNOT be derived from it
//  and is reported as "insufficient data" unless the user supplies a monthly
//  fixed-overhead figure via `overheads` (see estimatePL).
//
//  TERMINOLOGY IS THE TRACKER'S, VERBATIM. Do not rename these lines.
//
//  ── The verified P&L chain (July'26 GRAND TOTAL, ₹) ──
//    Gross Revenue                            29,10,22,085
//      − Returns                    (7.35% of gross)
//    = Adjusted Gross Revenue                 26,96,29,352
//      − Adjusted Discounts        (11.34% of adj. gross)   [net of cashback]
//      − B2B Margin                (12.94% of adj. gross)
//    = Net Revenue at SP                      20,17,50,925
//      − GST                        (exactly ÷ 1.18)
//    = Net Revenue                            17,09,75,360  ← ratio denominator
//      − COGS                      (25.68%)
//    = Gross Margin                           12,70,70,320
//      − B2C Commission & Platform Expenses (11.38%)
//      − B2B Secondary Discounts    (7.58%)
//      − Website Expenses           (0.20%)
//      − Freight Forward            (7.38%)
//      − Warehousing                (2.50%)
//      − Tertiary Packaging         (0.80%)
//    = Contribution Margin 1                   7,60,31,550  (44.47%)
//      − Performance Marketing     (20.41%)   [incl. ₹16.75L ad credits]
//      − Retention Marketing        (0.35%)
//    = Contribution Margin 2                   4,05,31,933  (23.71%)
//      − Brand Marketing           (21.09%)
//      − Freebies (GWP)             (0.55%)
//    = Contribution Margin 3                     35,23,309  ( 2.06%)
//      − Fixed / Operating Expenses  ⚠ NOT IN TRACKER
//    = Net Profit                              ⚠ NOT DERIVABLE
// ═════════════════════════════════════════════════════════════════════════

// ── 16-month history from `Plan vs Proj` (₹ Cr as stored in the sheet) ──────
// Columns C (Jul'26 projection) and J→X (Jun'26 → Apr'25, from Revised MIS).
// nrSP = Net Revenue at SP · nr = Net Revenue (excl. GST) · rest are absolute.
export const PL_HISTORY = [
  { month: "Jul'26", nrSP: 20.1750925, nr: 17.0975360, cogs: 4.39, b2cComm: 1.98, b2bDisc: 1.30, ffwhtpm: 1.83, cm1: 7.60, perfMkt: 3.55, cm2: 4.05, brandMkt: 3.70, cm3: 0.3523, source: 'Projection (channel P&L)' },
  { month: "Jun'26", nrSP: 22.834062, nr: 19.3509, cogs: 5.76, b2cComm: 0.6078, b2bDisc: 1.01, ffwhtpm: 2.44, cm1: 9.53, perfMkt: 4.41, cm2: 5.12, brandMkt: 5.14, cm3: -0.0219, source: 'Revised MIS' },
  { month: "May'26", nrSP: 23.905266, nr: 20.2587, cogs: 6.00, b2cComm: 0.6316, b2bDisc: 1.58, ffwhtpm: 2.39, cm1: 9.66, perfMkt: 5.43, cm2: 4.23, brandMkt: 7.18, cm3: -2.95, source: 'Revised MIS' },
  { month: "Apr'26", nrSP: 28.10996, nr: 23.822, cogs: 7.17, b2cComm: 0.60, b2bDisc: 1.30, ffwhtpm: 3.00, cm1: 11.76, perfMkt: 5.53, cm2: 6.23, brandMkt: 7.23, cm3: -1.01, source: 'Revised MIS' },
  { month: "Mar'26", nrSP: 23.03714, nr: 19.523, cogs: 5.81, b2cComm: 0.30, b2bDisc: 1.00, ffwhtpm: 2.40, cm1: 10.01, perfMkt: 5.10, cm2: 4.91, brandMkt: 5.70, cm3: -0.789, source: 'Revised MIS' },
  { month: "Feb'26", nrSP: 17.41326, nr: 14.757, cogs: 4.16, b2cComm: 0.60, b2bDisc: 1.00, ffwhtpm: 2.20, cm1: 6.80, perfMkt: 4.30, cm2: 2.50, brandMkt: 2.50, cm3: -0.005, source: 'Revised MIS' },
  { month: "Jan'26", nrSP: 14.31694, nr: 12.133, cogs: 2.73, b2cComm: 0.50, b2bDisc: 0.70, ffwhtpm: 1.60, cm1: 6.61, perfMkt: 3.00, cm2: 3.61, brandMkt: 2.30, cm3: 1.31, source: 'Revised MIS' },
  { month: "Dec'25", nrSP: 13.28916, nr: 11.262, cogs: 2.41, b2cComm: 0.40, b2bDisc: 0.80, ffwhtpm: 1.80, cm1: 5.86, perfMkt: 3.10, cm2: 2.76, brandMkt: 1.20, cm3: 1.56, source: 'Revised MIS' },
  { month: "Nov'25", nrSP: 14.09392, nr: 11.944, cogs: 2.55, b2cComm: 0.70, b2bDisc: 1.10, ffwhtpm: 1.60, cm1: 6.00, perfMkt: 3.40, cm2: 2.60, brandMkt: 1.10, cm3: 1.50, source: 'Revised MIS' },
  { month: "Oct'25", nrSP: 15.54709, nr: 13.1755, cogs: 2.88, b2cComm: 0.90, b2bDisc: 0.90, ffwhtpm: 1.80, cm1: 6.69, perfMkt: 3.20, cm2: 3.49, brandMkt: 1.70, cm3: 1.79, source: 'Revised MIS' },
  { month: "Sep'25", nrSP: 15.9536, nr: 13.52, cogs: 2.95, b2cComm: 1.00, b2bDisc: 0.90, ffwhtpm: 1.80, cm1: 6.87, perfMkt: 3.80, cm2: 3.07, brandMkt: 1.50, cm3: 1.57, source: 'Revised MIS' },
  { month: "Aug'25", nrSP: 13.7883, nr: 11.685, cogs: 2.56, b2cComm: 1.00, b2bDisc: 1.00, ffwhtpm: 1.60, cm1: 5.53, perfMkt: 3.40, cm2: 2.13, brandMkt: 1.60, cm3: 0.526, source: 'Revised MIS' },
  { month: "Jul'25", nrSP: 12.328522, nr: 10.4479, cogs: 2.17, b2cComm: 0.70, b2bDisc: 1.10, ffwhtpm: 1.40, cm1: 5.08, perfMkt: 3.10, cm2: 1.98, brandMkt: 1.20, cm3: 0.7789, source: 'Revised MIS' },
  { month: "Jun'25", nrSP: 14.30868, nr: 12.126, cogs: 2.40, b2cComm: 1.20, b2bDisc: 0.60, ffwhtpm: 2.20, cm1: 5.72, perfMkt: 3.50, cm2: 2.22, brandMkt: 1.40, cm3: 0.824, source: 'Revised MIS' },
  { month: "May'25", nrSP: 18.344516, nr: 15.5462, cogs: 3.33, b2cComm: 1.30, b2bDisc: 1.20, ffwhtpm: 3.00, cm1: 6.71, perfMkt: 4.30, cm2: 2.41, brandMkt: 1.80, cm3: 0.6142, source: 'Revised MIS' },
  { month: "Apr'25", nrSP: 23.177796, nr: 19.6422, cogs: 4.49, b2cComm: 1.50, b2bDisc: 0.80, ffwhtpm: 3.50, cm1: 9.36, perfMkt: 4.10, cm2: 5.26, brandMkt: 2.10, cm3: 3.16, source: 'Revised MIS' },
];

// GST is an exact divisor in the tracker: Net Revenue = Net Revenue at SP / 1.18
export const GST_DIVISOR = 1.18;

// ── July'26 detailed ratios, from `Channel PL FTM` GRAND TOTAL (col R) ──────
// Denominator is Net Revenue except where the key says otherwise. These are the
// finest-grained ratios available; the rolling bases below can only resolve to
// the coarser roll-ups that `Plan vs Proj` carries month by month.
export const JULY_DETAIL = {
  // ── Gross Revenue → Net Revenue at SP ──
  // NOTE: the tracker's own %-formulas use INCONSISTENT denominators —
  // Discount % is `R14/R5` (÷ Gross Revenue) while B2B Margin % is `R16/R10`
  // (÷ Adjusted Gross Revenue). Rather than compose two ratios that don't share
  // a base, `netSpOfGross` is the single measured wedge (Net Revenue at SP ÷
  // Gross Revenue) and is what the engine inverts when only one side is known.
  returnsOfGross:      0.07350897,  // Returns ÷ Gross Revenue
  discountOfGross:     0.11337604,  // Adjusted Discounts ÷ Gross Revenue   (tracker's R14/R5)
  b2bMarginOfAdjGross: 0.12937574,  // B2B Margin ÷ Adjusted Gross Revenue  (tracker's R16/R10)
  netSpOfGross:        0.69324953,  // Net Revenue at SP ÷ Gross Revenue
  // ── % of Net Revenue ──
  cogs:                0.256791624,
  b2cComm:             0.113824928,  // B2C Commission & Platform Expenses
  b2bSecDisc:          0.075846118,  // B2B Secondary Discounts
  websiteExp:          0.002037645,  // Website Expenses (PG charges + others)
  freightForward:      0.073810187,
  warehousing:         0.024997327,
  tertiaryPackaging:   0.007999145,
  perfMkt:             0.204121763,  // Performance Marketing (incl. ad credits)
  retentionMkt:        0.003508254,  // Retention Marketing
  brandMkt:            0.210907584,
  freebiesGWP:         0.005548308,  // Freebies (GWP)
};

// ── Per-channel July'26 economics, from `Channel PL FTM` ────────────────────
// Channel names are the tracker's. `(P)` channels are measured on a PRIMARY
// (sell-in) basis with a B2B Margin deduction; the rest are B2C/secondary.
// Ratios are of that channel's own Net Revenue. Channels with no marketing
// allocated (Reliance, Amazon Now, Flipkart Minutes) show inflated CM2/CM3 —
// `marketingAllocated` flags them so the UI can caveat rather than mislead.
export const JULY_CHANNEL = [
  { channel: 'Website',              basis: 'B2C', gross: 44080172, nr: 24499447, nrOfGross: 0.5558, cogs: 0.2883, b2cComm: 0,      b2bSecDisc: 0,      ffwhtpm: 0.1230, cm1: 0.5745, perfMkt: 0.4917, cm2: 0.0583, brandMkt: 0.1945, cm3: -0.1749, marketingAllocated: true },
  { channel: 'Amazon',               basis: 'B2C', gross: 52425575, nr: 33962352, nrOfGross: 0.6478, cogs: 0.2188, b2cComm: 0.0280, b2bSecDisc: 0,      ffwhtpm: 0.3014, cm1: 0.4518, perfMkt: 0.1775, cm2: 0.2744, brandMkt: 0.1945, cm3: 0.0799,  marketingAllocated: true },
  { channel: 'Flipkart',             basis: 'B2C', gross: 56125965, nr: 35479773, nrOfGross: 0.6321, cogs: 0.2230, b2cComm: 0.3815, b2bSecDisc: 0,      ffwhtpm: 0.0461, cm1: 0.3494, perfMkt: 0.1556, cm2: 0.1938, brandMkt: 0.1473, cm3: 0.0465,  marketingAllocated: true },
  { channel: 'Myntra',               basis: 'B2C', gross: 16450523, nr: 10908793, nrOfGross: 0.6631, cogs: 0.2314, b2cComm: 0.2440, b2bSecDisc: 0,      ffwhtpm: 0.0462, cm1: 0.4784, perfMkt: 0.1174, cm2: 0.3610, brandMkt: 0.1595, cm3: 0.2015,  marketingAllocated: true },
  { channel: 'Meesho',               basis: 'B2C', gross: 21721343, nr: 10757500, nrOfGross: 0.4953, cogs: 0.2394, b2cComm: 0.2150, b2bSecDisc: 0,      ffwhtpm: 0.0330, cm1: 0.5126, perfMkt: 0.1291, cm2: 0.3835, brandMkt: 0.1945, cm3: 0.1890,  marketingAllocated: true },
  { channel: 'Nykaa (P)',            basis: 'B2B', gross: 24972926, nr: 13479956, nrOfGross: 0.5398, cogs: 0.3161, b2cComm: 0,      b2bSecDisc: 0.5569, ffwhtpm: 0.0449, cm1: 0.0821, perfMkt: 0.1426, cm2: -0.0605, brandMkt: 0.4356, cm3: -0.4961, marketingAllocated: true },
  { channel: 'Purplle (P)',          basis: 'B2B', gross: 10487527, nr: 5777019,  nrOfGross: 0.5508, cogs: 0.3425, b2cComm: 0,      b2bSecDisc: 0.2654, ffwhtpm: 0.0466, cm1: 0.3455, perfMkt: 0.2028, cm2: 0.1428, brandMkt: 0.3697, cm3: -0.2269, marketingAllocated: true },
  { channel: 'Blinkit (P)',          basis: 'B2B', gross: 29827270, nr: 16430303, nrOfGross: 0.5508, cogs: 0.2832, b2cComm: 0,      b2bSecDisc: 0.1477, ffwhtpm: 0.0466, cm1: 0.5225, perfMkt: 0.1790, cm2: 0.3435, brandMkt: 0.2644, cm3: 0.0790,  marketingAllocated: true },
  { channel: 'Zepto (P)',            basis: 'B2B', gross: 12556289, nr: 6916536,  nrOfGross: 0.5508, cogs: 0.2844, b2cComm: 0,      b2bSecDisc: 0.1448, ffwhtpm: 0.0460, cm1: 0.5248, perfMkt: 0.1939, cm2: 0.3309, brandMkt: 0.3147, cm3: 0.0162,  marketingAllocated: true },
  { channel: 'Swiggy (P)',           basis: 'B2B', gross: 3339551,  nr: 1863514,  nrOfGross: 0.5580, cogs: 0.2501, b2cComm: 0,      b2bSecDisc: 0.2684, ffwhtpm: 0.0461, cm1: 0.4354, perfMkt: 0.3344, cm2: 0.1010, brandMkt: 0.5883, cm3: -0.4873, marketingAllocated: true },
  { channel: 'Reliance (P)',         basis: 'B2B', gross: 4597918,  nr: 2727575,  nrOfGross: 0.5932, cogs: 0.2736, b2cComm: 0,      b2bSecDisc: 0,      ffwhtpm: 0.0428, cm1: 0.6836, perfMkt: 0,      cm2: 0.6836, brandMkt: 0,      cm3: 0.6836,  marketingAllocated: false },
  { channel: 'Amazon Now (P)',       basis: 'B2B', gross: 7783448,  nr: 5012714,  nrOfGross: 0.6440, cogs: 0.2453, b2cComm: 0,      b2bSecDisc: 0,      ffwhtpm: 0.0424, cm1: 0.7123, perfMkt: 0,      cm2: 0.7123, brandMkt: 0,      cm3: 0.7123,  marketingAllocated: false },
  { channel: 'Flipkart Minutes (P)', basis: 'B2B', gross: 6630640,  nr: 3141597,  nrOfGross: 0.4738, cogs: 0.3474, b2cComm: 0,      b2bSecDisc: 0,      ffwhtpm: 0.0455, cm1: 0.6071, perfMkt: 0.2030, cm2: 0.4041, brandMkt: 0,      cm3: 0.4041,  marketingAllocated: false },
  { channel: 'Other B2C',            basis: 'B2C', gross: 22938,    nr: 18281,    nrOfGross: 0.7970, cogs: 0.3168, b2cComm: 0,      b2bSecDisc: 0,      ffwhtpm: 0,      cm1: 0.6832, perfMkt: 0,      cm2: 0.6832, brandMkt: 0.1945, cm3: 0.4887,  marketingAllocated: false },
];

// map the dashboard's canonical channel names → tracker channel names.
// The dashboard merges Myntra SJIT/Direct and renames Swiggy IM → Instamart.
export const CHANNEL_TO_PL = {
  'Website': 'Website', 'Amazon': 'Amazon', 'Flipkart': 'Flipkart',
  'Myntra': 'Myntra', 'Meesho': 'Meesho', 'Nykaa': 'Nykaa (P)',
  'Purplle': 'Purplle (P)', 'Blinkit': 'Blinkit (P)', 'Zepto': 'Zepto (P)',
  'Instamart': 'Swiggy (P)', 'Cred': 'Other B2C', 'Smytten': 'Other B2C',
  'Tata Cliq': 'Other B2C',
};

// ── ratio bases ────────────────────────────────────────────────────────────
export const BASES = [
  { key: 'july', label: "July'26", note: "the tracker's reference month (channel-level P&L)" },
  { key: 'r3',   label: '3M rolling', note: "May'26–Jul'26 average" },
  { key: 'r6',   label: '6M rolling', note: "Feb'26–Jul'26 average" },
  { key: 'r16',  label: '16M average', note: "Apr'25–Jul'26, the full history" },
];
const BASE_MONTHS = { july: 1, r3: 3, r6: 6, r16: 16 };

// Roll-up ratios for a basis, as fractions of Net Revenue. For multi-month
// bases we sum rupees across months and divide by summed Net Revenue — a
// revenue-weighted ratio, not a mean of ratios (which would over-weight small
// months). The `july` basis additionally exposes JULY_DETAIL's finer lines.
export function ratiosFor(baseKey = 'july') {
  const n = BASE_MONTHS[baseKey] || 1;
  const win = PL_HISTORY.slice(0, n);
  const sum = k => win.reduce((s, m) => s + (m[k] || 0), 0);
  const nr = sum('nr');
  const w = k => (nr ? sum(k) / nr : 0);

  const roll = {
    cogs:      w('cogs'),
    b2cComm:   w('b2cComm'),   // incl. Website Expenses (as rolled in Plan vs Proj)
    b2bDisc:   w('b2bDisc'),
    ffwhtpm:   w('ffwhtpm'),   // Freight Forward + Warehousing + Tertiary Packaging
    perfMkt:   w('perfMkt'),   // incl. Retention Marketing
    brandMkt:  w('brandMkt'),  // incl. Freebies (GWP)
    cm1:       w('cm1'),
    cm2:       w('cm2'),
    cm3:       w('cm3'),
  };

  // Gross→Net ratios: only `Channel PL FTM` (July) carries the returns /
  // discount / B2B-margin split, so those come from July on every basis.
  // Flagged via `grossChainFrom` so the UI can disclose it.
  return {
    base: baseKey,
    months: win.map(m => m.month),
    grossChainFrom: "July'26",
    returnsOfGross:      JULY_DETAIL.returnsOfGross,
    discountOfGross:     JULY_DETAIL.discountOfGross,
    b2bMarginOfAdjGross: JULY_DETAIL.b2bMarginOfAdjGross,
    netSpOfGross:        JULY_DETAIL.netSpOfGross,
    ...roll,
    // finer breakdown: exact for July, else apportioned within the roll-up by
    // July's internal mix so the waterfall can still show component detail.
    detail: detailFor(baseKey, roll),
  };
}

// Split a basis's roll-ups into the tracker's individual lines. For July these
// are the actual ratios. For rolling bases the roll-up total is authoritative
// and is divided using July's internal proportions — the split is presentational,
// the total is real. `exact` says which case applies.
function detailFor(baseKey, roll) {
  const J = JULY_DETAIL;
  if (baseKey === 'july') {
    return {
      exact: true,
      cogs: J.cogs,
      b2cComm: J.b2cComm, websiteExp: J.websiteExp,
      b2bSecDisc: J.b2bSecDisc,
      freightForward: J.freightForward, warehousing: J.warehousing, tertiaryPackaging: J.tertiaryPackaging,
      perfMkt: J.perfMkt, retentionMkt: J.retentionMkt,
      brandMkt: J.brandMkt, freebiesGWP: J.freebiesGWP,
    };
  }
  const share = (part, whole) => (whole ? part / whole : 0);
  const commTot = J.b2cComm + J.websiteExp;
  const ffTot   = J.freightForward + J.warehousing + J.tertiaryPackaging;
  const perfTot = J.perfMkt + J.retentionMkt;
  const brandTot = J.brandMkt + J.freebiesGWP;
  return {
    exact: false,
    cogs: roll.cogs,
    b2cComm:    roll.b2cComm * share(J.b2cComm, commTot),
    websiteExp: roll.b2cComm * share(J.websiteExp, commTot),
    b2bSecDisc: roll.b2bDisc,
    freightForward:    roll.ffwhtpm * share(J.freightForward, ffTot),
    warehousing:       roll.ffwhtpm * share(J.warehousing, ffTot),
    tertiaryPackaging: roll.ffwhtpm * share(J.tertiaryPackaging, ffTot),
    perfMkt:      roll.perfMkt * share(J.perfMkt, perfTot),
    retentionMkt: roll.perfMkt * share(J.retentionMkt, perfTot),
    brandMkt:     roll.brandMkt * share(J.brandMkt, brandTot),
    freebiesGWP:  roll.brandMkt * share(J.freebiesGWP, brandTot),
  };
}

// ═════════════════════════════════════════════════════════════════════════
//  estimatePL — the engine.
//
//  Drive it with ACTUALS from the dashboard and it returns the full P&L with
//  each line tagged 'actual' | 'estimated' | 'unavailable'.
//
//  inputs:
//    grossMrp   actual MRP-basis revenue  → maps to the tracker's Gross Revenue
//    netSp      actual SP-basis revenue   → maps to Net Revenue at SP
//    adSpend    actual performance-marketing spend (ads tables), or null
//    baseKey    which ratio basis to apply
//    overheads  monthly fixed operating expenses in ₹ — NOT in the tracker.
//               null/0 → Net Profit stays 'unavailable'.
//    months     period length in months, to scale the fixed overhead
// ═════════════════════════════════════════════════════════════════════════
export function estimatePL({ grossMrp = 0, netSp = 0, adSpend = null, baseKey = 'july', overheads = null, months = 1 } = {}) {
  const R = ratiosFor(baseKey);
  const D = R.detail;

  // ── Gross Revenue → Net Revenue ──
  // Prefer actual MRP and SP when both exist: the discount/returns wedge is then
  // measured, not assumed. Fall back to July's ratio chain when only one is known.
  const hasBoth = grossMrp > 0 && netSp > 0;
  // invert the single measured wedge when only SP is known — never compose the
  // tracker's two %-lines, whose denominators differ (see JULY_DETAIL).
  const grossRevenue = grossMrp > 0 ? grossMrp : (netSp > 0 ? netSp / R.netSpOfGross : 0);

  let returns, adjGross, deductions, netRevSp;
  if (hasBoth) {
    // actual wedge between MRP and SP: everything between Gross and Net Rev at SP
    returns    = grossRevenue * R.returnsOfGross;          // estimated split
    adjGross   = grossRevenue - returns;
    netRevSp   = netSp;                                     // ACTUAL
    deductions = Math.max(0, adjGross - netRevSp);           // actual residual
  } else {
    returns    = grossRevenue * R.returnsOfGross;
    adjGross   = grossRevenue - returns;
    netRevSp   = grossRevenue * R.netSpOfGross;
    deductions = Math.max(0, adjGross - netRevSp);
  }
  const gst        = netRevSp - netRevSp / GST_DIVISOR;
  const netRevenue = netRevSp / GST_DIVISOR;

  const x = r => netRevenue * r;

  // ── CM1 block ──
  const cogs              = x(D.cogs);
  const grossMargin       = netRevenue - cogs;
  const b2cComm           = x(D.b2cComm);
  const websiteExp        = x(D.websiteExp);
  const b2bSecDisc        = x(D.b2bSecDisc);
  const freightForward    = x(D.freightForward);
  const warehousing       = x(D.warehousing);
  const tertiaryPackaging = x(D.tertiaryPackaging);
  const cm1 = grossMargin - b2cComm - websiteExp - b2bSecDisc - freightForward - warehousing - tertiaryPackaging;

  // ── CM2 block. Performance Marketing is ACTUAL when the ads tables cover the
  //    period; retention marketing is never in the dashboard, so it stays estimated.
  const perfMktActual = adSpend != null && adSpend > 0;
  const perfMkt      = perfMktActual ? adSpend : x(D.perfMkt);
  const retentionMkt = x(D.retentionMkt);
  const cm2 = cm1 - perfMkt - retentionMkt;

  // ── CM3 block ──
  const brandMkt    = x(D.brandMkt);
  const freebiesGWP = x(D.freebiesGWP);
  const cm3 = cm2 - brandMkt - freebiesGWP;

  // ── below CM3: not in the tracker ──
  const hasOverheads = overheads != null && overheads > 0;
  const fixedOpex  = hasOverheads ? overheads * months : null;
  const netProfit  = hasOverheads ? cm3 - fixedOpex : null;

  const pct = v => (netRevenue ? v / netRevenue : null);
  return {
    base: R.base, basisMonths: R.months, ratios: R, detailExact: D.exact,
    grossChainFrom: R.grossChainFrom, actualWedge: hasBoth,
    lines: {
      grossRevenue:      { value: grossRevenue,      kind: grossMrp > 0 ? 'actual' : 'estimated', label: 'Gross Revenue' },
      returns:           { value: -returns,          kind: 'estimated', label: 'Less: Returns', pct: returns / (grossRevenue || 1), pctOf: 'gross' },
      adjustedGross:     { value: adjGross,          kind: grossMrp > 0 ? 'derived' : 'estimated', label: 'Adjusted Gross Revenue' },
      deductions:        { value: -deductions,       kind: hasBoth ? 'actual' : 'estimated', label: hasBoth ? 'Less: Discounts & B2B Margin' : 'Less: Adjusted Discounts + B2B Margin' },
      netRevenueAtSp:    { value: netRevSp,          kind: netSp > 0 ? 'actual' : 'estimated', label: 'Net Revenue at SP' },
      gst:               { value: -gst,              kind: 'derived',   label: 'Less: GST' },
      netRevenue:        { value: netRevenue,        kind: netSp > 0 ? 'actual' : 'estimated', label: 'Net Revenue' },
      cogs:              { value: -cogs,             kind: 'estimated', label: 'Less: COGS', pct: pct(cogs) },
      grossMarginLine:   { value: grossMargin,       kind: 'estimated', label: 'Gross Margin', pct: pct(grossMargin) },
      b2cComm:           { value: -b2cComm,          kind: 'estimated', label: 'Less: B2C Commission & Platform Expenses', pct: pct(b2cComm) },
      websiteExp:        { value: -websiteExp,       kind: 'estimated', label: 'Less: Website Expenses', pct: pct(websiteExp) },
      b2bSecDisc:        { value: -b2bSecDisc,       kind: 'estimated', label: 'Less: B2B Secondary Discounts', pct: pct(b2bSecDisc) },
      freightForward:    { value: -freightForward,   kind: 'estimated', label: 'Less: Freight Forward', pct: pct(freightForward) },
      warehousing:       { value: -warehousing,      kind: 'estimated', label: 'Less: Warehousing', pct: pct(warehousing) },
      tertiaryPackaging: { value: -tertiaryPackaging, kind: 'estimated', label: 'Less: Tertiary Packaging', pct: pct(tertiaryPackaging) },
      cm1:               { value: cm1,               kind: 'estimated', label: 'Contribution Margin 1', pct: pct(cm1) },
      perfMkt:           { value: -perfMkt,          kind: perfMktActual ? 'actual' : 'estimated', label: 'Less: Performance Marketing', pct: pct(perfMkt) },
      retentionMkt:      { value: -retentionMkt,     kind: 'estimated', label: 'Less: Retention Marketing', pct: pct(retentionMkt) },
      cm2:               { value: cm2,               kind: 'estimated', label: 'Contribution Margin 2', pct: pct(cm2) },
      brandMkt:          { value: -brandMkt,         kind: 'estimated', label: 'Less: Brand Marketing', pct: pct(brandMkt) },
      freebiesGWP:       { value: -freebiesGWP,      kind: 'estimated', label: 'Less: Freebies (GWP)', pct: pct(freebiesGWP) },
      cm3:               { value: cm3,               kind: 'estimated', label: 'Contribution Margin 3', pct: pct(cm3) },
      fixedOpex:         { value: fixedOpex == null ? null : -fixedOpex, kind: hasOverheads ? 'user' : 'unavailable', label: 'Less: Fixed / Operating Expenses' },
      netProfit:         { value: netProfit,         kind: hasOverheads ? 'estimated' : 'unavailable', label: 'Estimated Net Profit', pct: netProfit == null ? null : pct(netProfit) },
    },
  };
}

// ── channel-level estimate. Uses that channel's OWN July ratios when the
//    tracker has it (economics differ enormously — Nykaa CM1 8% vs Amazon 45%),
//    else falls back to the blended basis. `matched` reports which happened.
export function estimateChannelPL({ channel, grossMrp = 0, netSp = 0, adSpend = null, baseKey = 'july' }) {
  const plName = CHANNEL_TO_PL[channel] || channel;
  const c = JULY_CHANNEL.find(r => r.channel === plName);
  if (!c) {
    const est = estimatePL({ grossMrp, netSp, adSpend, baseKey });
    return { channel, plChannel: null, matched: false, basis: 'blended', ...est };
  }
  // channel ratios are July-only in the tracker; a rolling basis can't be
  // resolved per channel, so we say so rather than silently blending.
  const netRevenue = netSp > 0 ? netSp / GST_DIVISOR : (grossMrp * c.nrOfGross) / GST_DIVISOR;
  const x = r => netRevenue * r;
  const cogs = x(c.cogs);
  const cm1  = x(c.cm1);
  const perfMktActual = adSpend != null && adSpend > 0;
  const perfMkt = perfMktActual ? adSpend : x(c.perfMkt);
  const cm2 = cm1 - perfMkt;
  const brandMkt = x(c.brandMkt);
  const cm3 = cm2 - brandMkt;
  return {
    channel, plChannel: plName, matched: true, basis: "July'26 channel P&L",
    basisNote: c.marketingAllocated ? null : 'no marketing allocated in tracker — CM2/CM3 overstated',
    marketingAllocated: c.marketingAllocated, plBasis: c.basis,
    netRevenue, cogs, cm1, perfMkt, perfMktActual, cm2, brandMkt, cm3,
    cogsPct: c.cogs, cm1Pct: c.cm1, cm2Pct: netRevenue ? cm2 / netRevenue : null,
    cm3Pct: netRevenue ? cm3 / netRevenue : null, perfMktPct: netRevenue ? perfMkt / netRevenue : null,
  };
}

// ═════════════════════════════════════════════════════════════════════════
//  buildPLFromChannels — the channel-aware aggregate the dashboard actually uses.
//
//  WHY THIS EXISTS. The tracker mixes two measurement bases:
//    • B2C channels (Website, Amazon, Flipkart, Myntra, Meesho) are measured on
//      SECONDARY (sell-out) — the same basis as the dashboard. Here the actual
//      MRP→SP wedge IS the real discount, so we use both actuals and measure it.
//    • `(P)` channels (Nykaa, Purplle, Blinkit, Zepto, Swiggy, Reliance, Amazon
//      Now, Flipkart Minutes) are measured on PRIMARY (sell-in) and carry a B2B
//      Margin deduction that simply does not exist in secondary data. Using the
//      dashboard's secondary SP for these would overstate Net Revenue — verified:
//      dashboard SP ran +10.5% vs the tracker for July because of exactly this.
//      So for these we take actual MRP as Gross and apply that channel's own
//      tracker ratio to reach Net Revenue at SP.
//
//  Reconciliation for July'26 (measured, not assumed):
//    dashboard secondary MRP 26.44 Cr vs tracker Gross Revenue 29.10 Cr (−9.1%),
//    substantially explained by four primary-basis channels absent from the
//    secondary view (≈2.95 Cr). Website ties exactly at 4.4080 Cr on both sides.
//
//  channelRows: [{ channel, mrp, sp }]   spendByChannel: Map(channel → spend)
// ═════════════════════════════════════════════════════════════════════════
export function buildPLFromChannels({ channelRows = [], spendByChannel = null, baseKey = 'july', overheads = null, months = 1 } = {}) {
  const R = ratiosFor(baseKey);
  let grossRevenue = 0, netRevSp = 0;
  const unmatched = [], perChannel = [];

  for (const row of channelRows) {
    const mrp = row.mrp || 0, sp = row.sp || 0;
    if (mrp <= 0 && sp <= 0) continue;
    const plName = CHANNEL_TO_PL[row.channel] || row.channel;
    const c = JULY_CHANNEL.find(k => k.channel === plName);
    let g = mrp > 0 ? mrp : sp / R.netSpOfGross;
    let n;
    if (!c) {
      unmatched.push(row.channel);
      n = sp > 0 ? sp : g * R.netSpOfGross;          // blended fallback
    } else if (c.basis === 'B2C') {
      n = sp > 0 ? sp : g * (c.nrOfGross * GST_DIVISOR); // actual wedge
    } else {
      n = g * (c.nrOfGross * GST_DIVISOR);            // primary basis → ratio
    }
    grossRevenue += g; netRevSp += n;
    perChannel.push({ channel: row.channel, plChannel: c ? plName : null, basis: c ? c.basis : 'blended', gross: g, netSp: n, spend: spendByChannel ? (spendByChannel.get(row.channel) || 0) : 0 });
  }

  const adSpend = spendByChannel ? [...spendByChannel.values()].reduce((s, v) => s + (v || 0), 0) : null;
  const est = estimatePL({ grossMrp: grossRevenue, netSp: netRevSp, adSpend, baseKey, overheads, months });
  return { ...est, perChannel, unmatched, mixedBasis: perChannel.some(p => p.basis === 'B2B') };
}

// ═════════════════════════════════════════════════════════════════════════
//  businessHealthScore — NOT an arbitrary index.
//
//  Every indicator is scored by where it sits inside THIS business's own
//  observed 16-month range (Apr'25–Jul'26) from `Plan vs Proj`: the worst month
//  on record scores 0, the best scores 100, and today's value is placed
//  linearly between them. Cost-side lines are inverted (lower = better).
//  Revenue growth is the one indicator with no P&L history to anchor to, so it
//  uses an explicit ±25% band — disclosed via `anchor`.
//
//  Weights reflect how decision-relevant each line is to profitability, and are
//  surfaced in the UI so the score can be argued with rather than trusted blindly.
// ═════════════════════════════════════════════════════════════════════════
export function businessHealthScore({ cm1Pct, cm2Pct, cm3Pct, cogsPct, perfMktPct, revGrowthPct }) {
  const hist = k => { const r = PL_HISTORY.map(m => (m[k] / m.nr) * 100); return { min: Math.min(...r), max: Math.max(...r) }; };
  const H = { cm1: hist('cm1'), cm2: hist('cm2'), cm3: hist('cm3'), cogs: hist('cogs'), perfMkt: hist('perfMkt') };
  const norm = (v, lo, hi, invert = false) => {
    if (v == null || !isFinite(v) || hi === lo) return null;
    let s = ((v - lo) / (hi - lo)) * 100;
    if (invert) s = 100 - s;
    return Math.max(0, Math.min(100, s));
  };
  const factors = [
    { key: 'cm3',    label: 'Profitability (CM3 %)',      weight: 0.30, value: cm3Pct,      score: norm(cm3Pct, H.cm3.min, H.cm3.max),            anchor: `16M range ${H.cm3.min.toFixed(1)}% → ${H.cm3.max.toFixed(1)}%`, good: 'higher' },
    { key: 'cm2',    label: 'Contribution after ads (CM2 %)', weight: 0.20, value: cm2Pct,  score: norm(cm2Pct, H.cm2.min, H.cm2.max),            anchor: `16M range ${H.cm2.min.toFixed(1)}% → ${H.cm2.max.toFixed(1)}%`, good: 'higher' },
    { key: 'cm1',    label: 'Unit economics (CM1 %)',     weight: 0.15, value: cm1Pct,      score: norm(cm1Pct, H.cm1.min, H.cm1.max),            anchor: `16M range ${H.cm1.min.toFixed(1)}% → ${H.cm1.max.toFixed(1)}%`, good: 'higher' },
    { key: 'growth', label: 'Revenue growth',             weight: 0.15, value: revGrowthPct, score: norm(revGrowthPct, -25, 25),                  anchor: 'band −25% → +25% (no P&L history to anchor)', good: 'higher' },
    { key: 'adEff',  label: 'Ad efficiency (Perf Mktg % of NR)', weight: 0.10, value: perfMktPct, score: norm(perfMktPct, H.perfMkt.min, H.perfMkt.max, true), anchor: `16M range ${H.perfMkt.min.toFixed(1)}% → ${H.perfMkt.max.toFixed(1)}% (inverted)`, good: 'lower' },
    { key: 'burden', label: 'Expense burden (COGS % of NR)', weight: 0.10, value: cogsPct,  score: norm(cogsPct, H.cogs.min, H.cogs.max, true),   anchor: `16M range ${H.cogs.min.toFixed(1)}% → ${H.cogs.max.toFixed(1)}% (inverted)`, good: 'lower' },
  ];
  const usable = factors.filter(f => f.score != null);
  const wsum = usable.reduce((s, f) => s + f.weight, 0);
  const score = wsum > 0 ? usable.reduce((s, f) => s + f.score * f.weight, 0) / wsum : null;
  const band = score == null ? 'unknown' : score >= 65 ? 'healthy' : score >= 40 ? 'watch' : 'risk';
  return {
    score, band, factors,
    coverage: usable.length / factors.length,
    label: { healthy: 'Healthy', watch: 'Watch', risk: 'At Risk', unknown: 'Unknown' }[band],
  };
}

// ── stability of each line across the history, so the UI can show which
//    ratios are trustworthy. CV = stdev ÷ |mean| of the monthly % of Net Revenue.
export function ratioStability() {
  const lines = [
    ['COGS', 'cogs'], ['B2C Comm & Platform', 'b2cComm'], ['B2B Secondary Discounts', 'b2bDisc'],
    ['FF / WH / TPM', 'ffwhtpm'], ['Contribution Margin 1', 'cm1'], ['Performance Marketing', 'perfMkt'],
    ['Contribution Margin 2', 'cm2'], ['Brand Marketing', 'brandMkt'], ['Contribution Margin 3', 'cm3'],
  ];
  return lines.map(([label, k]) => {
    const r = PL_HISTORY.map(m => (m[k] / m.nr) * 100);
    const mean = r.reduce((s, v) => s + v, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length);
    const cv = Math.abs(mean) > 1e-9 ? sd / Math.abs(mean) : Infinity;
    const avg = n => { const w = PL_HISTORY.slice(0, n); return w.reduce((s, m) => s + m[k], 0) / w.reduce((s, m) => s + m.nr, 0) * 100; };
    return {
      label, key: k, july: r[0], m3: avg(3), m6: avg(6), m16: avg(16),
      min: Math.min(...r), max: Math.max(...r), cv,
      verdict: cv < 0.10 ? 'stable' : cv < 0.25 ? 'moderate' : 'unstable',
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   UNIT ECONOMICS — where ₹100 of net revenue goes.

   The investor-deck view of the same P&L: one base (net revenue = 100),
   every cost as a share of it, and what survives as margin. Net revenue is
   the right base rather than gross — gross still contains returns, platform
   discounts and GST, none of which the business ever collects, so shares of
   gross flatter every cost line.

   The slices sum to exactly 100% by construction, because CM3 is defined as
   net revenue minus precisely these costs. `residual` reports any drift so a
   future change to the P&L cannot quietly desynchronise the chart from the
   statement it is drawn from.

   Fixed opex is included ONLY when the user has entered an overhead figure.
   Revsight has no overhead source, so inventing one to complete the picture
   would turn a real contribution margin into a fictional net margin.
   ═══════════════════════════════════════════════════════════════════════ */

// Cost groups, in P&L order. Several tracker lines belong to one economic
// bucket — an investor reads "fulfilment", not "freight forward + tertiary
// packaging + warehousing" as three separate wedges.
export const UNIT_ECON_GROUPS = [
  { key: 'cogs',     label: 'COGS',                  parts: ['cogs'] },
  { key: 'platform', label: 'Platform & commission', parts: ['b2bSecDisc', 'b2cComm', 'websiteExp'] },
  { key: 'fulfil',   label: 'Fulfilment & logistics', parts: ['freightForward', 'warehousing', 'tertiaryPackaging'] },
  { key: 'perf',     label: 'Performance marketing', parts: ['perfMkt', 'retentionMkt'] },
  { key: 'brand',    label: 'Brand marketing',        parts: ['brandMkt', 'freebiesGWP'] },
  { key: 'opex',     label: 'Fixed / operating',      parts: ['fixedOpex'] },
];

export function unitEconomics(lines, { units = null, orders = null } = {}) {
  if (!lines || !lines.netRevenue) return null;
  const net = lines.netRevenue.value;
  if (!(net > 0)) return null;              // no base ⇒ no share of it

  const groups = [];
  for (const g of UNIT_ECON_GROUPS) {
    let value = 0;
    let anyPresent = false;
    let allActual = true;
    for (const p of g.parts) {
      const line = lines[p];
      if (!line || line.value == null) continue;
      anyPresent = true;
      // cost lines are stored negative; unit economics wants magnitudes
      value += Math.abs(line.value);
      if (line.kind !== 'actual') allActual = false;
    }
    if (!anyPresent || value === 0) continue;
    groups.push({ key: g.key, label: g.label, value, pct: (value / net) * 100, actual: allActual });
  }

  const totalCost = groups.reduce((a, g) => a + g.value, 0);
  const margin = net - totalCost;
  // Which margin this is depends on whether overheads were supplied: without
  // them the residual is CM3, and calling it net profit would be a lie.
  const hasOpex = groups.some(g => g.key === 'opex');
  const marginLabel = hasOpex ? 'Net margin' : 'Contribution margin 3';

  return {
    net,
    groups,
    totalCost,
    costPct: (totalCost / net) * 100,
    margin,
    marginPct: (margin / net) * 100,
    marginLabel,
    hasOpex,
    profitable: margin >= 0,
    // per ₹100 of net revenue, and per unit / per order where known
    per100: g => (g.value / net) * 100,
    perUnit: units > 0 ? v => v / units : null,
    perOrder: orders > 0 ? v => v / orders : null,
    units, orders,
    // Should be ~0: CM3 is net revenue minus exactly these costs.
    residual: lines.cm3 && lines.cm3.value != null && !hasOpex
      ? margin - lines.cm3.value : 0,
  };
}
