// Grouped function: mp-wbr, mp-wbr-channel, web-wbr.
// See api/_dispatch.js for why these routes share one file, and
// vercel.json for the /api/<name> → /api/wbr?route=<name> rewrites.
import { router } from './_dispatch.js';
import { fetchMarketplaceWbr } from './_marketplace_wbr.js';
import { fetchMarketplaceChannelWbr } from './_marketplace_channel.js';
import { fetchWebsiteWbr } from './_website_wbr.js';

export default router({
  // GET /api/mp-wbr?selStart=&selEnd=&prevStart=&prevEnd=
  // Marketplace WBR headline table — sales vs comparison window, prorated target,
  // achievement, discount and per-platform TACOS. Mirrors the Hex "WBR -
  // Marketplace" notebook's OVERALL-MP output.
  'mp-wbr': async (req, res, q) => {
    const { selStart, selEnd, prevStart, prevEnd } = q;
    const data = await fetchMarketplaceWbr(selStart, selEnd, prevStart, prevEnd);
    res.status(200).json({ ok: true, ...data });
  },

  // GET /api/mp-wbr-channel?channel=&selStart=&selEnd=&prevStart=&prevEnd=
  // One marketplace's WBR scorecard. Mirrors the per-channel sections of the
  // Hex "WBR - Marketplace" notebook; Amazon additionally carries storefront
  // traffic and DSP spend.
  'mp-wbr-channel': async (req, res, q) => {
    const { channel, selStart, selEnd, prevStart, prevEnd } = q;
    const data = await fetchMarketplaceChannelWbr(channel, selStart, selEnd, prevStart, prevEnd);
    res.status(200).json({ ok: true, ...data });
  },

  // GET /api/web-wbr?selStart=&selEnd=&prevStart=&prevEnd=
  // D2C website WBR scorecard over the selected window vs its comparison.
  'web-wbr': async (req, res, q) => {
    const { selStart, selEnd, prevStart, prevEnd } = q;
    const data = await fetchWebsiteWbr(selStart, selEnd, prevStart, prevEnd);
    res.status(200).json({ ok: true, ...data });
  },
});
