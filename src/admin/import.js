/**
 * Import: pictures of your own, for the things you make. They are kept in the custom folder (never in the assets),
 * one folder of pictures for each kind of thing. Any picture a browser can show can be brought in; it is kept as a
 * PNG. Pictures for maps become the object set and the background set named "custom" in the map editor; the others
 * are picked on the Items and NPCs tabs.
 */
import { h, fill, fmt, toast, DIRS, pictureUrl } from './ui.js';
import { api, sendPicture } from './api.js';

const KINDS = [
  ['map', 'Maps', 'Scenery for maps. In the map editor: Add, then Object or Background, and pick the set named custom.'],
  ['npc', 'NPCs', 'What an NPC of your own looks like: pick one for it on the NPCs tab.'],
  ['equip', 'Equips', 'An equip’s icon: pick one for it on the Items tab.'],
  ['item', 'Items', 'An item’s icon: pick one for it on the Items tab.'],
];
const cleanName = (n) => n.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 40) || 'picture';
async function toPng(file) {
  const bmp = await createImageBitmap(file);
  if (bmp.width > 8192 || bmp.height > 8192) throw new Error('it is larger than 8192 pixels a side');
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('the browser could not make a PNG of it'))), 'image/png'));
}

export function importTab(host) {
  let kind = 'map';
  const grid = h('div', { class: 'pic-grid' }), blurb = h('p', { class: 'muted' }), where = h('p', { class: 'muted' });
  const refresh = async () => {
    const [list, info] = await Promise.all([api(`/pictures/${kind}`), api('/custom')]);
    blurb.textContent = KINDS.find((k) => k[0] === kind)[2];
    where.textContent = `Kept in ${info.dir}/${DIRS[kind]}/pictures`;
    fill(grid, list.length ? list.map((p) => h('figure', { class: 'pic' },
      h('div', { class: 'pic-frame' }, h('img', { alt: '', loading: 'lazy', src: pictureUrl(kind, p.name, p.at) })),
      h('figcaption', null, h('strong', null, p.name), h('span', { class: 'muted' }, `${p.w} × ${p.h}, ${fmt.bytes(p.bytes)}${p.no !== undefined && p.no !== null ? `, background ${p.no}` : ''}`),
        h('button', { type: 'button', class: 'quiet danger', onclick: async () => {
          if (!confirm(`Delete the picture ${p.name}? Anything that uses it will show nothing in its place.`)) return;
          try { await api(`/pictures/${kind}/${p.name}`, { method: 'DELETE' }); refresh(); } catch (e) { toast(e.message, true); }
        } }, 'Delete')))) : h('p', { class: 'empty' }, 'No pictures here yet.'));
  };
  const take = async (files) => {
    let ok = 0;
    for (const file of files) {
      const name = cleanName(file.name);
      try { await sendPicture(`/pictures/${kind}/${name}`, await toPng(file)); ok++; } catch (e) { toast(`${file.name} was not brought in: ${e.message}.`, true); }
    }
    if (ok) toast(`${ok} picture${ok === 1 ? '' : 's'} brought in.`);
    refresh().catch(() => {});
  };
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { take([...e.target.files]); e.target.value = ''; } });
  const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', 'aria-label': 'Bring pictures in',
    onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); take([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); } },
  h('strong', null, 'Drop pictures here, or click to choose them'), h('span', { class: 'muted' }, 'PNG, GIF, JPEG or WebP. A picture is named after its file; one of the same name is replaced.'));
  const pick = h('div', { class: 'segmented', role: 'group', 'aria-label': 'What the pictures are for' }, KINDS.map(([k, name]) => h('button', {
    type: 'button', class: k === kind ? 'on' : null, 'aria-pressed': k === kind,
    onclick: (e) => { kind = k; for (const b of pick.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', b === e.currentTarget); } refresh().catch((err) => toast(err.message, true)); },
  }, name)));
  fill(host, h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', null, 'Pictures of your own'), pick), blurb, drop, input, where, grid));
  return { show() { refresh().catch((e) => toast(e.message, true)); } };
}
