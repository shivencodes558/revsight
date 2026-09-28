import React, { useState, useEffect, useRef } from 'react';
import { getJSON } from '../lib/api.js';
import { ErrorBox } from '../components/ui.jsx';
import { logoFor } from '../components/Sidebar.jsx';
import WbrMetricTable from '../components/WbrMetricTable.jsx';

export const MP_CHANNELS = [
  'Amazon', 'Flipkart', 'Nykaa', 'Myntra', 'Meesho', 'Purplle', 'Blinkit', 'Zepto', 'Swiggy IM',
];

export default function WbrChannelScorecard({ selStart, selEnd, prevStart, prevEnd }) {
  const [channel, setChannel] = useState('Amazon');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  const load = () => {
    if (!selStart || !selEnd || !prevStart || !prevEnd) return;
    const my = ++reqId.current;
    setLoading(true); setError(null);
    getJSON('/mp-wbr-channel', { channel, selStart, selEnd, prevStart, prevEnd })
      .then(r => { if (my === reqId.current) { setData(r); setLoading(false); } })
      .catch(e => { if (my === reqId.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(load, [channel, selStart, selEnd, prevStart, prevEnd]);

  return (
    <>
      <div className="cstrip rise" style={{ marginBottom: 12 }}>
        {MP_CHANNELS.map(c => (
          <button key={c} className={'ctab' + (channel === c ? ' on' : '')}
            onClick={() => setChannel(c)} style={{ minWidth: 118 }}>
            <span className="cname" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {logoFor(c) && <img src={logoFor(c)} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />}
              {c}
            </span>
          </button>
        ))}
      </div>

      {loading && <div className="skeleton sk-chart rise" />}
      {!loading && error && <ErrorBox error={error} onRetry={load} />}

      {!loading && !error && data && (
        <>
          <WbrMetricTable rows={data.rows} />
          <p className="card-sub rise d1" style={{ marginTop: 9 }}>
            {data.rangeDays}-day window. {data.meta.note}
            {data.meta.hasTraffic
              ? ' Storefront sessions, page views and DSP spend are Amazon-only feeds.'
              : ' Storefront traffic and DSP spend are not reported for this channel.'}
          </p>
        </>
      )}
    </>
  );
}
