/** Server: what is running, where it keeps things, what it has sent since it started, and the settings as it read them. */
import { h, fill, fmt, table, toast, download, DIRS } from './ui.js';
import { api } from './api.js';

const KINDS = { page: 'The page and its script', files: 'Asset files (trees)', sheets: 'Sheets', images: 'Images', sounds: 'Sounds', other: 'Everything else' };

export function serverTab(host) {
  let timer = null;
  const facts = (pairs) => h('dl', { class: 'facts' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
  const refresh = async () => {
    const [o, mine] = await Promise.all([api('/overview'), api('/custom')]);
    const WHAT = { map: 'Maps', npc: 'NPCs', equip: 'Equips', item: 'Items' };
    const any = Object.values(mine.kinds).some((k) => k.published);
    const kinds = Object.entries(o.web.kinds).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => ({ k, ...v }));
    fill(host,
      h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Running')), facts([
        ['Build', o.build || '-'],
        ['Up for', `${fmt.span(o.now - o.started)} (since ${fmt.day(o.started)})`],
        ['Game page', `http://${o.host}:${o.port}`],
        ['Admin page', `port ${o.adminPort}`],
        ['Game servers', Object.entries(o.servers).map(([name, addr]) => `${name} (${addr})`).join(', ')],
        ['Node', `${o.node} on ${o.platform}, ${o.cpus} cores`],
        ['Memory', `${fmt.bytes(o.memory.rss)} used by the server (${fmt.bytes(o.memory.heap)} of it JavaScript); the machine has ${fmt.bytes(o.memory.free)} of ${fmt.bytes(o.memory.total)} free`],
        ['Load', o.load.map((v) => v.toFixed(2)).join(', ')],
      ])),
      h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Folders')), facts([
        ['Assets', o.assetsDir],
        ['Cache', `${o.cacheDir} (${o.sheets.on ? `sheets on, ${fmt.count(o.sheets.made)} made since the start` : 'sheets off'})`],
        ['Settings', o.configFiles.join(', ')],
      ])),
      h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'What you have made'),
        h('button', { type: 'button', disabled: !any, title: any ? 'A zip of every published thing as the files the Cosmic server reads' : 'Nothing is published yet', onclick: async () => {
          try { const res = await api('/export', { raw: true }); download(await res.blob(), 'cosmic-custom.zip'); toast('Exported. The zip says where its files go.'); } catch (e) { toast(e.message, true); }
        } }, 'Export everything for Cosmic')),
        h('p', { class: 'muted' }, `Kept in ${mine.dir}, a folder for each kind. The assets folder is never written to.`),
        table([{ name: 'Kind', cell: (r) => WHAT[r[0]] }, { name: 'Folder', cell: (r) => DIRS[r[0]] }, { name: 'Drafts', num: true, cell: (r) => r[1].drafts }, { name: 'Published', num: true, cell: (r) => r[1].published }, { name: 'Pictures', num: true, cell: (r) => r[1].pictures }],
          Object.entries(mine.kinds))),
      h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Sent since the start')),
        facts([
          ['Through the relay', `${fmt.bytes(o.relay.toBrowser)} to players in ${fmt.count(o.relay.msgs)} messages, ${fmt.bytes(o.relay.toServer)} from them; ${fmt.count(o.relay.opened)} connections opened, ${o.relay.now} open now`],
          ['By the web server', `${fmt.bytes(o.web.bytes)} in ${fmt.count(o.web.n)} requests`],
        ]),
        table([
          { name: 'Kind', cell: (r) => KINDS[r.k] || r.k }, { name: 'Requests', num: true, cell: (r) => r.n.toLocaleString('en-US') },
          { name: 'Sent', num: true, cell: (r) => fmt.bytes(r.bytes) }, { name: 'Each', num: true, cell: (r) => fmt.bytes(r.n ? r.bytes / r.n : 0) },
        ], kinds, 'Nothing asked for yet.')),
      h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Settings as read')),
        h('p', { class: 'muted' }, 'From client.conf. A change there takes a restart of the server. A setting that is not listed has its default.'),
        table([{ name: 'Setting', cell: (r) => r[0] }, { name: 'Value', cell: (r) => String(r[1]) }], Object.entries(o.config).sort((a, b) => a[0].localeCompare(b[0])), 'No settings read.')));
  };
  return {
    show() { refresh().catch((e) => toast(e.message, true)); timer = setInterval(() => refresh().catch(() => {}), 10000); },
    hide() { clearInterval(timer); },
  };
}
