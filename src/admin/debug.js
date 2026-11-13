/**
 * Console & analytics: how the server is doing now (the figures at the top), over the last hour (the charts, a
 * sample every five seconds), and what it is saying (its console, with the errors players' browsers report). All of
 * it is news from the server's live stream while the tab is looked at.
 */
import { h, fill, fmt, table, toast } from './ui.js';
import { api, live } from './api.js';
import { LineChart } from './chart.js';

const RANGES = [['5 min', 5 * 60000], ['15 min', 15 * 60000], ['1 hour', 60 * 60000]];
const SHOWN = 1500;   // console lines on the page at once

export function debugTab(host) {
  let samples = [], lines = [], range = RANGES[1][1], stop = null, follow = true, src = 'all', level = 'all', find = '';

  // ---------------------------------------------------------------- the figures
  const tile = (label) => {
    const value = h('div', { class: 'tile-value' }, '-'), sub = h('div', { class: 'tile-sub' });
    return { el: h('div', { class: 'tile' }, h('div', { class: 'tile-label' }, label), value, sub), value, sub };
  };
  const tiles = {
    players: tile('Players online'), out: tile('Sent to players'), req: tile('Web requests'),
    fps: tile('Players’ frame rate'), hitches: tile('Hitches reported'), cpu: tile('Server'),
  };
  const figures = () => {
    const s = samples[samples.length - 1];
    if (!s) return;
    tiles.players.value.textContent = fmt.count(s.players); tiles.players.sub.textContent = `${s.conns} connection${s.conns === 1 ? '' : 's'} in all`;
    tiles.out.value.textContent = fmt.rate(s.out); tiles.out.sub.textContent = `${fmt.rate(s.in)} from them, ${fmt.count(s.msgs)} messages/s`;
    tiles.req.value.textContent = `${fmt.num(s.req)}/s`; tiles.req.sub.textContent = fmt.rate(s.web);
    tiles.fps.value.textContent = s.fps === null ? '-' : `${Math.round(s.fps)} fps`;
    tiles.fps.sub.textContent = s.reporting ? `lowest ${Math.round(s.low)}, from ${s.reporting} browser${s.reporting === 1 ? '' : 's'}` : 'no browser reporting';
    tiles.hitches.value.textContent = fmt.count(s.hitches); tiles.hitches.sub.textContent = 'in their last half minute';
    tiles.cpu.value.textContent = `${fmt.num(s.cpu)}% CPU`; tiles.cpu.sub.textContent = `${fmt.bytes(s.rss)} memory, load ${s.load.toFixed(2)}`;
  };

  // ---------------------------------------------------------------- the charts
  const charts = [
    new LineChart({ title: 'Players online', series: [{ key: 'players', name: 'Players' }], format: (v) => fmt.count(v), top: 4, whole: true }),
    new LineChart({ title: 'Relay traffic', series: [{ key: 'out', name: 'To players' }, { key: 'in', name: 'From players' }], format: (v) => fmt.rate(v), top: 1024 }),
    new LineChart({ title: 'Web requests a second', series: [{ key: 'req', name: 'Requests' }], top: 1 }),
    new LineChart({ title: 'Players’ frame rate', series: [{ key: 'fps', name: 'Average' }, { key: 'low', name: 'Lowest' }], format: (v) => `${Math.round(v)} fps`, top: 60 }),
    new LineChart({ title: 'Hitches reported', series: [{ key: 'hitches', name: 'Hitches' }], format: (v) => fmt.count(v), top: 4, whole: true }),
    new LineChart({ title: 'Server CPU', series: [{ key: 'cpu', name: 'CPU' }], format: (v) => `${fmt.num(v)}%`, top: 10 }),
    new LineChart({ title: 'Server memory', series: [{ key: 'rss', name: 'Memory' }], format: (v) => fmt.bytes(v), top: 64 << 20 }),
  ];
  const rows = h('div');
  const plot = () => {
    const to = samples.length ? samples[samples.length - 1].t : Date.now();
    for (const c of charts) c.set(samples, to - range, to);
    if (!details.open) return;
    fill(rows, table([
      { name: 'Time', cell: (s) => fmt.clock(s.t) }, { name: 'Players', num: true, cell: (s) => s.players }, { name: 'Connections', num: true, cell: (s) => s.conns },
      { name: 'To players', num: true, cell: (s) => fmt.rate(s.out) }, { name: 'From players', num: true, cell: (s) => fmt.rate(s.in) },
      { name: 'Requests/s', num: true, cell: (s) => fmt.num(s.req) }, { name: 'Frame rate', num: true, cell: (s) => (s.fps === null ? '-' : Math.round(s.fps)) },
      { name: 'Lowest', num: true, cell: (s) => (s.low === null ? '-' : Math.round(s.low)) }, { name: 'Hitches', num: true, cell: (s) => s.hitches },
      { name: 'CPU', num: true, cell: (s) => `${fmt.num(s.cpu)}%` }, { name: 'Memory', num: true, cell: (s) => fmt.bytes(s.rss) },
    ], samples.filter((s) => s.t >= to - range).slice(-120).reverse(), 'No samples yet.'));
  };
  const details = h('details', { class: 'as-table', ontoggle: () => plot() }, h('summary', null, 'The same as a table'), rows);
  const pick = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Time shown' }, RANGES.map(([name, ms]) => h('button', {
    type: 'button', class: ms === range ? 'on' : null, 'aria-pressed': ms === range,
    onclick: (e) => { range = ms; for (const b of pick.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', b === e.currentTarget); } plot(); },
  }, name)));

  // ---------------------------------------------------------------- the console
  const list = h('div', { class: 'console', tabindex: 0, role: 'log', 'aria-label': 'Console' });
  const count = h('span', { class: 'muted' });
  const wanted = (l) => (src === 'all' || l.src === src) && (level === 'all' || l.level === 'error' || (level === 'warn' && l.level === 'warn')) && (!find || l.text.toLowerCase().includes(find));
  const row = (l) => h('div', { class: `line ${l.level}` }, h('time', null, fmt.clock(l.t)), h('span', { class: 'src' }, l.src),
    l.level === 'log' ? null : h('span', { class: 'level' }, l.level === 'warn' ? 'warning' : 'error'), h('span', { class: 'text' }, l.text));
  const render = () => {
    const shown = lines.filter(wanted);
    fill(list, shown.slice(-SHOWN).map(row));
    count.textContent = `${shown.length.toLocaleString('en-US')} line${shown.length === 1 ? '' : 's'}${shown.length > SHOWN ? ` (the last ${SHOWN} shown)` : ''}`;
    if (follow) list.scrollTop = list.scrollHeight;
  };
  const add = (l) => {
    lines.push(l);
    if (lines.length > 3000) lines.shift();
    if (!wanted(l)) return;
    list.append(row(l));
    while (list.childElementCount > SHOWN) list.firstElementChild.remove();
    if (follow) list.scrollTop = list.scrollHeight;
  };
  list.addEventListener('scroll', () => { follow = list.scrollHeight - list.scrollTop - list.clientHeight < 30; followBox.checked = follow; });
  const followBox = h('input', { type: 'checkbox', checked: true, onchange: (e) => { follow = e.target.checked; if (follow) list.scrollTop = list.scrollHeight; } });
  const select = (label, options, set) => h('label', null, label, h('select', { onchange: (e) => { set(e.target.value); render(); } }, options.map(([v, n]) => h('option', { value: v }, n))));
  const bar = h('div', { class: 'toolbar' },
    select('From', [['all', 'Everything'], ['server', 'The server'], ['client', 'Players’ browsers'], ['admin', 'This page']], (v) => { src = v; }),
    select('Show', [['all', 'All lines'], ['warn', 'Warnings and errors'], ['error', 'Errors']], (v) => { level = v; }),
    h('label', null, 'Find', h('input', { type: 'search', placeholder: 'text in a line', oninput: (e) => { find = e.target.value.trim().toLowerCase(); render(); } })),
    h('label', { class: 'check' }, followBox, 'Follow'),
    h('button', { type: 'button', onclick: async () => {
      const text = lines.filter(wanted).map((l) => `${new Date(l.t).toISOString()} [${l.src}${l.level === 'log' ? '' : ` ${l.level}`}] ${l.text}`).join('\n');
      try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('The browser would not let the page copy.', true); }
    } }, 'Copy'),
    count);

  fill(host,
    h('section', { class: 'tiles' }, Object.values(tiles).map((t) => t.el)),
    h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'The last hour'), pick), h('div', { class: 'charts' }, charts.map((c) => c.el)), details),
    h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Console')), bar, list));

  const load = async () => {
    const after = lines.length ? lines[lines.length - 1].n : 0;
    const [got, more] = await Promise.all([api('/samples'), api(`/log?after=${after}`)]);
    samples = got; lines = lines.concat(more).slice(-3000);
    figures(); plot(); render();
  };
  return {
    show() {
      load().catch((e) => toast(e.message, true));
      stop = live({
        sample: (s) => { if (samples.length && s.t <= samples[samples.length - 1].t) return; samples.push(s); if (samples.length > 720) samples.shift(); figures(); plot(); },
        log: (l) => { if (!lines.length || l.n > lines[lines.length - 1].n) add(l); },
      });
    },
    hide() { stop?.(); stop = null; },
  };
}
