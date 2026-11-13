/**
 * Players: who is connected through the relay (the server only sees addresses and bytes: what is inside is between
 * the player and the game server), what their browsers say about how the game runs for them, and the /fps reports
 * they sent in. A browser's report carries its character's name, which is how a connection gets one here: by the
 * address they share.
 */
import { h, fill, fmt, table, toast } from './ui.js';
import { api, live } from './api.js';
import { LineChart } from './chart.js';

export function playersTab(host) {
  let timer = null, stop = null, build = '', picked = null, open = null;
  const conns = h('div'), browsers = h('div'), reports = h('div'), detail = h('div');
  const chart = new LineChart({ title: 'Frame rate', series: [{ key: 'fps', name: 'Average' }, { key: 'low', name: 'Lowest second' }], format: (v) => `${Math.round(v)} fps`, top: 60, gap: 95000 });

  const refresh = async () => {
    const [list, clients] = await Promise.all([api('/connections'), api('/clients')]);
    const now = Date.now();
    const names = new Map();
    for (const c of clients) if (c.name && now - c.last < 120000) names.set(c.ip, [...(names.get(c.ip) || []), c.name]);
    fill(conns, table([
      { name: 'Player', cell: (c) => (c.kind === 'login' ? h('span', { class: 'muted' }, 'at the login screen') : [...new Set(names.get(c.ip) || [])].join(', ') || h('span', { class: 'muted' }, 'not reported')) },
      { name: 'Address', cell: (c) => c.ip },
      { name: 'Connected to', cell: (c) => `${c.server} : ${c.port}` },
      { name: 'For', num: true, cell: (c) => fmt.span(now - c.since) },
      { name: 'Sent to it', num: true, cell: (c) => `${fmt.bytes(c.toBrowser)} (${fmt.rate(c.rate)})` },
      { name: 'From it', num: true, cell: (c) => fmt.bytes(c.toServer) },
      // what the server has written that the browser hasn't taken yet: it grows when the player's link can't keep up
      { name: 'Waiting', num: true, cell: (c) => (c.waiting > 65536 ? h('strong', { class: 'flag', title: 'The link to this player is not keeping up.' }, `${fmt.bytes(c.waiting)} held up`) : fmt.bytes(c.waiting)) },
      { name: '', cell: (c) => h('button', { type: 'button', class: 'quiet danger', onclick: async () => {
        if (!confirm(`Close the connection from ${c.ip}? The player is disconnected from the game.`)) return;
        try { await api(`/connections/${c.id}/close`, { method: 'POST' }); toast('Closed.'); refresh(); } catch (e) { toast(e.message, true); }
      } }, 'Close') },
    ], list.sort((a, b) => a.since - b.since), 'Nobody is connected.'));
    fill(browsers, table([
      { name: 'Player', cell: (c) => h('button', { type: 'button', class: 'link', onclick: () => { picked = c.id; history(); } }, c.name || 'no character yet') },
      { name: 'Address', cell: (c) => c.ip },
      { name: 'Browser', cell: (c) => fmt.browser(c.ua) },
      { name: 'Build', cell: (c) => (build && c.build && c.build !== build ? h('span', { class: 'flag', title: `The server has ${build}: this page needs a reload.` }, `${c.build} (old)`) : c.build || '-') },
      { name: 'Map', num: true, cell: (c) => c.map || '-' },
      { name: 'Players there', num: true, cell: (c) => c.now?.players ?? '-' },
      { name: 'Frame rate', num: true, cell: (c) => (!c.now ? '-' : c.now.hidden ? 'tab hidden' : `${Math.round(c.now.fps)} (low ${Math.round(c.now.low)})`) },
      { name: 'Hitches', num: true, cell: (c) => c.now?.hitches ?? '-' },
      { name: 'Errors', num: true, cell: (c) => (c.errors ? h('strong', { class: 'flag' }, c.errors) : 0) },
      { name: 'Heard from', num: true, cell: (c) => fmt.ago(c.last, now) },
    ], clients.sort((a, b) => b.last - a.last), 'No browser has reported yet. A page reports every half minute while someone plays.'));
    if (picked) history();
  };
  const history = async () => {
    try {
      const pts = await api(`/clients/${picked}`);
      const shown = pts.map((p) => (p.hidden ? { t: p.t, fps: null, low: null } : p));
      const to = Date.now();
      chart.set(shown, to - 3600000, to);
      if (!detail.firstChild) detail.append(chart.el);
    } catch { picked = null; fill(detail); }
  };
  const listReports = async () => {
    const list = (await api('/fps')).reverse();
    fill(reports, list.length ? list.map((r) => {
      const view = h('pre', { class: 'report', hidden: open !== r.t }, r.text);
      return h('div', { class: 'report-row' },
        h('div', { class: 'report-head' }, h('strong', null, r.name || r.ip), h('span', { class: 'muted' }, fmt.day(r.t)),
          h('button', { type: 'button', class: 'quiet', onclick: () => { view.hidden = !view.hidden; open = view.hidden ? null : r.t; } }, 'Show'),
          h('button', { type: 'button', class: 'quiet', onclick: async () => { try { await navigator.clipboard.writeText(r.text); toast('Copied.'); } catch { toast('The browser would not let the page copy.', true); } } }, 'Copy')),
        view);
    }) : h('p', { class: 'empty' }, 'None yet. A player’s /fps copy sends its report here as well as to the clipboard.'));
  };

  fill(host,
    h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Connected through the relay')), conns),
    h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'How the game runs for them')),
      h('p', { class: 'muted' }, 'What each browser reported last. Pick a player for the last hour.'), browsers, detail),
    h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, '/fps reports sent in')), reports));

  const tick = () => refresh().catch(() => {});
  return {
    show() {
      api('/overview').then((o) => { build = o.build; tick(); }, () => tick());
      listReports().catch((e) => toast(e.message, true));
      timer = setInterval(tick, 3000);
      stop = live({ fps: () => listReports().catch(() => {}) });
    },
    hide() { clearInterval(timer); stop?.(); stop = null; },
  };
}
