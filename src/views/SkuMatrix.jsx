import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getJSON } from '../lib/api.js';
import { ErrorBox } from '../components/ui.jsx';
import MatrixTable from '../components/MatrixTable.jsx';
import { monthLabel, countShort } from '../lib/format.js';
import { asShare, rollupByCategory, skuRowsFor } from '../lib/matrix.js';

/* ═══════════════════════════════════════════════════════════════════════
   SKU & Category matrices — the "All Channels : Data" tables, month over
   month. Nine tables in three sections: Volume, Sales · MRP, Sales · SP.

   All nine come from ONE /api/sku-matrix fetch. The category tables are
   grouped from the same SKU rows the SKU tables render, so a category total
   can never disagree with the SKU rows beneath it — which is the failure
   mode of running a separate query per table.
   ═══════════════════════════════════════════════════════════════════════ */

const SKU_COLS = [
  { head: 'SKU', get: r => r.sku },
  { head: 'PRODUCT_NAME', get: r => r.product },
  { head: 'SUB_CATEGORY', get: r => r.subCategory },
];
const CAT_COLS = [{ head: 'SUB_CATEGORY', get: r => r.subCategory }];

export default function SkuMatrix({ endMonth, months = 12 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [span, setSpan] = useState(months);
  const reqId = useRef(0);

  const load = () => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/sku-matrix', { endMonth, months: span })
      .then(r => { if (my === reqId.current) { setData(r); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, [endMonth, span]);

  // ── SKU rows per measure, and categories grouped from those same rows ──
  const derived = useMemo(() => {
    if (!data) return null;
    const { months: ms, skus, totals } = data;
    const n = ms.length;
    return {
      months: ms,
      totals,
      skuUnits: skuRowsFor(skus, 'units'),
      skuMrp:   skuRowsFor(skus, 'mrp'),
      skuSp:    skuRowsFor(skus, 'sp'),
      catUnits: rollupByCategory(skus, 'units', n),
      catMrp:   rollupByCategory(skus, 'mrp', n),
      catSp:    rollupByCategory(skus, 'sp', n),
    };
  }, [data]);

  // Share tables, derived from the value tables against the column totals.
  const shares = useMemo(() => {
    if (!derived) return null;
    const t = derived.totals;
    const mk = (rows, tot) => rows.map(r => ({ ...r, values: asShare(r.values, tot) }));
    return {
      skuUnitsW: mk(derived.skuUnits, t.units),   // "Demand Weight"
      catUnitsC: mk(derived.catUnits, t.units),
      catMrpC:   mk(derived.catMrp,   t.mrp),
      catSpC:    mk(derived.catSp,    t.sp),
    };
  }, [derived]);

  if (loading) {
    return (
      <>
        <div className="nsec"><div className="txt"><h2>SKU &amp; Category Matrices</h2>
          <p>month over month · all channels</p></div></div>
        <div className="skeleton" style={{ height: 300, borderRadius: 8, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 300, borderRadius: 8 }} />
      </>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!derived || !shares) return null;

  const ms = derived.months;
  // A share table's column total is 100% by construction, so that is its
  // reference: filtering to a few rows then reads "12.4% of 100.00%", i.e.
  // this subset is 12.4% of the column.
  const FULL_SHARE = ms.map(() => 100);
  const unmapped = data.skus.find(s => s.unmapped);
  const spanLabel = `${monthLabel(ms[ms.length - 1])} → ${monthLabel(ms[0])}`;
  const spCav = (data.meta.spCaveat || []).map(c => `${c.channel} ${monthLabel(c.from)}`).join(', ');

  return (
    <>
      {/* ── section header + span control ── */}
      <div className="nsec">
        <div className="txt">
          <h2>SKU &amp; Category Matrices</h2>
          <p>{spanLabel} · newest month first · all channels · Freebie/Others excluded</p>
        </div>
        <div className="spacer" />
        <div className="tools">
          <span className="mx-span">
            {[6, 12, 18].map(n => (
              <button key={n} className={span === n ? 'on' : ''} onClick={() => setSpan(n)}>{n}M</button>
            ))}
          </span>
        </div>
      </div>

      <p className="mx-caveat">
        Columns are calendar months, not the header's date range — these tables
        are a trend view, so the selected window does not apply to them. The
        newest month is partial until it closes.
        {unmapped && <> An <b>(unmapped)</b> row carries {countShort(unmapped.units[1] || unmapped.units[0])} units
        in {monthLabel(ms[1] || ms[0])} that the SKU mapper does not recognise. It is shown rather
        than dropped: those units are real sales, but they carry no MRP, so they
        inflate volume relative to MRP until the mapping is fixed.</>}
      </p>

      {/* ══ VOLUME ══ */}
      <div className="nsec"><div className="num">01</div><div className="txt">
        <h2>Volume</h2><p>units sold</p></div></div>

      <MatrixTable label="SKU-wise Volume" sub="units per SKU per month"
        months={ms} rows={derived.skuUnits} totals={derived.totals.units}
        idCols={SKU_COLS} fmt="int" />

      <MatrixTable label="SKU-wise Demand Weight" sub="each SKU's share of that month's total units"
        months={ms} rows={shares.skuUnitsW} totals={FULL_SHARE}
        idCols={SKU_COLS} fmt="pct" heat />

      <MatrixTable label="Category-wise Volume" sub="units per sub-category per month"
        months={ms} rows={derived.catUnits} totals={derived.totals.units}
        idCols={CAT_COLS} fmt="int" />

      <MatrixTable label="Category-wise Volume Contribution" sub="each sub-category's share of that month's total units"
        months={ms} rows={shares.catUnitsC} totals={FULL_SHARE}
        idCols={CAT_COLS} fmt="pct" heat />

      {/* ══ MRP ══ */}
      <div className="nsec"><div className="num">02</div><div className="txt">
        <h2>Sales · MRP</h2><p>gross value at list price, from the SKU mapper</p></div></div>

      <MatrixTable label="SKU-wise MRP Sales" sub="MRP value per SKU per month"
        months={ms} rows={derived.skuMrp} totals={derived.totals.mrp}
        idCols={SKU_COLS} fmt="inr" />

      <MatrixTable label="Category-wise MRP Sales" sub="MRP value per sub-category per month"
        months={ms} rows={derived.catMrp} totals={derived.totals.mrp}
        idCols={CAT_COLS} fmt="inr" />

      <MatrixTable label="Category-wise MRP Sales Contribution" sub="each sub-category's share of that month's MRP"
        months={ms} rows={shares.catMrpC} totals={FULL_SHARE}
        idCols={CAT_COLS} fmt="pct" heat />

      {/* ══ SP ══ */}
      <div className="nsec"><div className="num">03</div><div className="txt">
        <h2>Sales · SP</h2><p>net value at realised selling price</p></div></div>

      <p className="mx-caveat warn">
        SP starts partway through the history for quick commerce — {spCav}. Months
        before those dates hold no SP for that channel, so early SP columns and
        their shares are understated. Read MRP for the long trend.
      </p>

      <MatrixTable label="SKU-wise SP Sales" sub="SP value per SKU per month"
        months={ms} rows={derived.skuSp} totals={derived.totals.sp}
        idCols={SKU_COLS} fmt="inr" />

      <MatrixTable label="Category-wise SP Sales" sub="SP value per sub-category per month"
        months={ms} rows={derived.catSp} totals={derived.totals.sp}
        idCols={CAT_COLS} fmt="inr" />

      <MatrixTable label="Category-wise SP Sales Contribution" sub="each sub-category's share of that month's SP"
        months={ms} rows={shares.catSpC} totals={FULL_SHARE}
        idCols={CAT_COLS} fmt="pct" heat />

      <p className="mx-caveat">{data.meta.basis}. {data.meta.note}</p>
    </>
  );
}
