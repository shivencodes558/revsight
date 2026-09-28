import React, { useState, useEffect, useRef } from 'react';
import { getJSON } from '../lib/api.js';
import { ErrorBox } from '../components/ui.jsx';
import WbrMetricTable from '../components/WbrMetricTable.jsx';

// The D2C website's WBR scorecard over the selected window vs its comparison.
export default function WbrWebsite({ selStart, selEnd, prevStart, prevEnd }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  const load = () => {
    if (!selStart || !selEnd || !prevStart || !prevEnd) return;
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/web-wbr', { selStart, selEnd, prevStart, prevEnd })
      .then(r => { if (my === reqId.current) { setData(r); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, [selStart, selEnd, prevStart, prevEnd]);

  if (loading) return <div className="skeleton sk-chart rise" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!data) return null;

  const { selDays, prevDays } = data.window;
  return (
    <>
      <WbrMetricTable rows={data.rows} />
      <p className="card-sub rise d1" style={{ marginTop: 9 }}>
        {selDays}-day window vs {prevDays}-day comparison. {data.meta.basis}. {data.meta.note}
        {selDays !== prevDays && (
          <> <b style={{ color: 'var(--warn)' }}>The two windows are different lengths, so absolute
          comparisons are not like-for-like.</b></>
        )}
      </p>
    </>
  );
}
