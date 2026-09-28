// GET /api/sku-matrix?endMonth=YYYY-MM&months=12
// SKU × month fact grid (units / MRP / SP) powering the All Channels
// month-over-month matrices. Category tables are grouped from these rows in
// the frontend, so category and SKU totals always reconcile.
import { fetchSkuMatrix } from './_sku_matrix.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { endMonth, months } = req.query;
    const data = await fetchSkuMatrix(endMonth, months);
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/sku-matrix]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
