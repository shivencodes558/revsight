import React, { useState, useEffect } from 'react';
import { LOGOS, LOGO_DECON } from '../logos.js';

// ── Marketplace channels, grouped by the same `channel_group` the warehouse
//    already uses (Q-Commerce vs Marketplace) rather than an invented taxonomy.
//    Website is excluded — it gets its own top-level section.
export const CHANNEL_FAMILIES = [
  { key: 'QComm', label: 'QComm', channels: ['Blinkit', 'Zepto', 'Instamart'] },
  { key: 'ECom',  label: 'ECom',  channels: ['Amazon', 'Flipkart', 'Myntra', 'Nykaa', 'Purplle', 'Meesho', 'Tata Cliq', 'Smytten', 'Cred'] },
];
export const MARKETPLACE_CHANNELS = CHANNEL_FAMILIES.flatMap(f => f.channels);

// Raw warehouse channel names → the logo they should wear. The secondary
// feed keeps Myntra's two fulfilment models as separate channels, and both
// are still Myntra to look at.
const LOGO_ALIAS = {
  'Flipkart Minutes': 'Flipkart', 'Amazon Now': 'Amazon', 'Swiggy IM': 'Instamart',
  'Myntra SJIT': 'Myntra', 'Myntra Direct': 'Myntra', 'TataCliq': 'Tata Cliq',
};
export const logoFor = n => LOGOS[n] || LOGOS[LOGO_ALIAS[n]] || null;

// A channel view is addressed as "ch:<Channel>" so one route covers all of them.
export const CHANNEL_PREFIX = 'ch:';
export const channelOf = view =>
  (String(view).startsWith(CHANNEL_PREFIX) ? String(view).slice(CHANNEL_PREFIX.length) : null);

// ── Navigation: three standalone entries, then three expandable sections.
//    `kind: 'item'` renders a row; `kind: 'section'` renders a collapsible group.
export const NAV = [
  { kind: 'item', id: 'overview', label: 'Business Overview',    ic: '◈' },
  { kind: 'item', id: 'daily',    label: 'Daily Business Report', ic: '◐' },
  { kind: 'item', id: 'allch',    label: 'All Channels',          ic: '◎' },
  // Secondary (sell-out) sits beside All Channels rather than inside a
  // channel section: it spans every channel, and its basis differs from the
  // primary-sales tabs, so burying it under one of them would imply it ties.
  { kind: 'item', id: 'secondary', label: 'Secondary Sales Trends', ic: '◭' },
  {
    // channels render as a selectable logo grid, split across family tabs,
    // rather than 12 stacked rows.
    kind: 'section', key: 'Marketplace', label: 'Marketplace', ic: '▦',
    families: CHANNEL_FAMILIES,
    items: [
      { id: 'mkt-daily', label: 'Daily Report', ic: '◈' },
      { id: 'mkt-city', label: 'City Wise Sales', ic: '◍' },
    ],
  },
  {
    kind: 'section', key: 'Website', label: 'Website', ic: '◍',
    items: [
      { id: 'web-daily', label: 'Daily Report', ic: '◈' },
      { id: 'web-kwik', label: 'GoKwik Retention', ic: '✦' },
    ],
  },
  {
    kind: 'section', key: 'WBR', label: 'WBR', ic: '▣',
    items: [
      { id: 'wbr-brand', label: 'Brand', ic: '◆' },
      { id: 'wbr-mkt', label: 'Marketplace', ic: '▦' },
      { id: 'wbr-web', label: 'Website',     ic: '◍' },
    ],
  },
];

export const DEFAULT_VIEW = 'overview';

// which section holds a given view, so the right group opens on load / navigation
const SECTION_OF = {};
const FAMILY_OF = {};   // channel view id → which family tab holds it
for (const n of NAV) {
  if (n.kind !== 'section') continue;
  for (const it of n.items || []) SECTION_OF[it.id] = n.key;
  for (const f of n.families || []) {
    for (const ch of f.channels) {
      SECTION_OF[CHANNEL_PREFIX + ch] = n.key;
      FAMILY_OF[CHANNEL_PREFIX + ch] = f.key;
    }
  }
}

export default function Sidebar({ view, setView, collapsed, setCollapsed, user }) {
  const initials = (user && user.name ? user.name : 'D').slice(0, 1).toUpperCase();
  const [open, setOpen] = useState(() => ({ [SECTION_OF[view] || 'Marketplace']: true }));
  const toggle = key => setOpen(o => ({ ...o, [key]: !o[key] }));
  // which family tab is showing; follows the selected channel so the active
  // chip is never hidden behind the other tab
  const [family, setFamily] = useState(() => FAMILY_OF[view] || CHANNEL_FAMILIES[0].key);
  useEffect(() => { if (FAMILY_OF[view]) setFamily(FAMILY_OF[view]); }, [view]);

  const Row = ({ it }) => (
    <div
      className={'nav-item' + (view === it.id ? ' active' : '') + (it.divide ? ' divide' : '')}
      onClick={() => setView(it.id)}
      title={it.label}
    >
      {it.logo && logoFor(it.logo)
        ? <img className="nav-logo" src={logoFor(it.logo)} alt="" />
        : <span className="ic">{it.ic || '·'}</span>}
      <span className="lbl">{it.label}</span>
      {it.flag ? <span className="nav-flag">{it.flag}</span> : null}
    </div>
  );

  return (
    <div className="rail">
      <div className="rail-top">
        <div className="rail-mark"><img src={LOGO_DECON} alt="Deconstruct" /></div>
        {!collapsed && <div className="rail-name">Revsight<small>Deconstruct · BI</small></div>}
      </div>

      <div className="rail-scroll">
        {NAV.map(n => {
          if (n.kind === 'item') return <Row key={n.id} it={n} />;
          const isOpen = collapsed || !!open[n.key];
          const holdsActive = [...(n.grid || []), ...(n.items || [])].some(it => it.id === view);
          return (
            <div className="rail-group" key={n.key}>
              {!collapsed && (
                <button className={'rail-ghead' + (holdsActive ? ' has-active' : '')}
                  onClick={() => toggle(n.key)} aria-expanded={isOpen}>
                  <span className="gic">{n.ic}</span>
                  <span className="gname">{n.label}</span>
                  <span className="gtoggle">{isOpen ? '−' : '+'}</span>
                </button>
              )}
              {(isOpen || holdsActive) && (
                <div className="rail-items">
                  {n.families && (
                    <>
                      <div className="famtabs" role="tablist" aria-label="Channel family">
                        {n.families.map(f => (
                          <button key={f.key} role="tab" aria-selected={family === f.key}
                            className={family === f.key ? 'on' : ''}
                            onClick={() => setFamily(f.key)}>
                            {f.label}
                            <span className="famcount">{f.channels.length}</span>
                          </button>
                        ))}
                      </div>
                      <div className="chgrid" role="listbox" aria-label={family + ' channels'}>
                        {(n.families.find(f => f.key === family) || n.families[0]).channels.map(ch => {
                          const id = CHANNEL_PREFIX + ch;
                          const on = view === id;
                          return (
                            <button
                              key={id} role="option" aria-selected={on}
                              className={'chchip' + (on ? ' on' : '')}
                              onClick={() => setView(id)}
                              title={ch} aria-label={ch}
                            >
                              {logoFor(ch)
                                ? <img src={logoFor(ch)} alt="" />
                                : <span className="chinit">{ch.slice(0, 2)}</span>}
                              {on && <span className="chtick" aria-hidden="true">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {(n.items || []).map(it => <Row key={it.id} it={it} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rail-foot">
        {collapsed
          ? <div className="rail-avatar" title={user && user.email}>{initials}</div>
          : <span className="railcredit">Built for {(user && user.name) || 'Deconstruct'}</span>}
        <button className="collapse-btn" onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? '»' : '«'}
        </button>
      </div>
    </div>
  );
}
