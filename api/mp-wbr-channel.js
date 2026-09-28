// GET /api/mp-wbr-channel?channel=&selStart=&selEnd=&prevStart=&prevEnd=
// One marketplace's WBR scorecard. Mirrors the per-channel sections of the
// Hex "WBR - Marketplace" notebook; Amazon additionally carries storefront
// traffic and DSP spend.
import { fetchMarketplaceChannelWbr } from './_marketplace_channel.js';

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { channel, selStart, selEnd, prevStart, prevEnd } = req.query || {};
    const data = await fetchMarketplaceChannelWbr(channel, selStart, selEnd, prevStart, prevEnd);
    res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error('[/api/mp-wbr-channel]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
