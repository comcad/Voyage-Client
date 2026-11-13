/**
 * Items (with equips), NPCs and quests: change one of the game's, or make one of your own from a copy. What can be
 * changed is its words (name, description), its numbers (an equip's or an item's stats, what a potion does) and its
 * pictures (from the ones brought in on the Import tab); for a quest, everything the game keeps for one: what the
 * quest window says, which NPC gives it and which takes it back, what it needs, what it gives, what is said. As with maps: Save keeps a draft only this page sees,
 * Publish gives it to players, and the export is for the Cosmic server, which decides what an item really does.
 */
import { h, fill, toast, dialog, settled, download, pickFromList, DIRS, pictureUrl } from './ui.js';
import { api } from './api.js';

const FAMILY = { equip: 'Character', item: 'Item', npc: 'Npc', quest: 'Quest' };
const NAMES = { equip: 'Equip', item: 'Item', npc: 'NPC', quest: 'Quest' };
/** A quest of your own to start from: the four parts the game keeps for one, each with its start (0) and its end (1). */
const EMPTY_QUEST = () => ({ QuestInfo: { name: 'A new quest', 0: '', 1: '', 2: '' }, Check: { 0: { npc: 0, lvmin: 1 }, 1: { npc: 0 } }, Act: { 0: {}, 1: { exp: 0 } }, Say: { 0: { 0: '' }, 1: { 0: '' } } });
const WORDS = { name: 'Name', desc: 'Description', func: 'Line under its name' };
/** What each may be given besides what it has (offered under "Add a field"). */
const MORE = {
  equip: ['reqLevel', 'reqJob', 'reqSTR', 'reqDEX', 'reqINT', 'reqLUK', 'incSTR', 'incDEX', 'incINT', 'incLUK', 'incPAD', 'incMAD', 'incPDD', 'incMDD', 'incACC', 'incEVA', 'incSpeed', 'incJump', 'incMHP', 'incMMP',
    'tuc', 'price', 'cash', 'attackSpeed', 'tradeBlock', 'only', 'notSale', 'timeLimited', 'knockback', 'equipTradeBlock', 'expireOnLogout', 'reqPOP'],
  item: ['price', 'slotMax', 'tradeBlock', 'only', 'quest', 'notSale', 'cash', 'timeLimited', 'success', 'cursed', 'incSTR', 'incDEX', 'incINT', 'incLUK', 'incPAD', 'incMAD', 'incPDD', 'incMDD', 'incACC', 'incEVA', 'incSpeed', 'incJump', 'incMHP', 'incMMP', 'reqLevel'],
  spec: ['hp', 'mp', 'hpR', 'mpR', 'time', 'pad', 'mad', 'pdd', 'mdd', 'acc', 'eva', 'speed', 'jump', 'moveTo', 'thaw', 'prob'],
  npc: [],
};
const HINTS = {
  reqLevel: 'The level needed to wear or use it.', reqJob: 'Which jobs may wear it (0: all).', reqSTR: 'STR needed.', reqDEX: 'DEX needed.', reqINT: 'INT needed.', reqLUK: 'LUK needed.',
  incSTR: 'STR it adds.', incDEX: 'DEX it adds.', incINT: 'INT it adds.', incLUK: 'LUK it adds.', incPAD: 'Weapon attack it adds.', incMAD: 'Magic attack it adds.', incPDD: 'Weapon defense it adds.', incMDD: 'Magic defense it adds.',
  incACC: 'Accuracy it adds.', incEVA: 'Avoidability it adds.', incSpeed: 'Speed it adds.', incJump: 'Jump it adds.', incMHP: 'Max HP it adds.', incMMP: 'Max MP it adds.',
  tuc: 'How many scrolls it can take.', price: 'What it sells for.', cash: '1: a Cash item.', attackSpeed: 'How fast it swings (lower is faster).', tradeBlock: '1: can’t be traded.', only: '1: only one can be owned.',
  notSale: '1: can’t be sold.', slotMax: 'How many fit in one slot.', success: 'A scroll’s chance to work, in percent.', cursed: 'A scroll’s chance to destroy the item, in percent.',
  hp: 'HP it restores.', mp: 'MP it restores.', hpR: 'HP it restores, in percent.', mpR: 'MP it restores, in percent.', time: 'How long it lasts, in milliseconds.',
  pad: 'Weapon attack while it lasts.', mad: 'Magic attack while it lasts.', pdd: 'Weapon defense while it lasts.', mdd: 'Magic defense while it lasts.', acc: 'Accuracy while it lasts.', eva: 'Avoidability while it lasts.',
  speed: 'Speed while it lasts.', jump: 'Jump while it lasts.', moveTo: 'The map it takes you to.',
};
const isCanvas = (v) => v !== null && typeof v === 'object' && typeof v._canvas === 'string';

/** `kinds`: the kinds this tab works on ([['item', 'Items'], ['equip', 'Equips']]); `blurb`: a line about them. */
export function thingsTab(host, kinds, blurb) {
  let kind = kinds[0][0], rec = null, changed = false;
  const list = h('div', { class: 'thing-list' }), editor = h('div', { class: 'thing-editor' });

  // ---------------------------------------------------------------- finding
  const lookup = settled(async (q) => {
    let rows = [];
    try { rows = await api(`/c/${kind}?q=${encodeURIComponent(q)}`); } catch (e) { toast(e.message, true); }
    fill(list, rows.length ? rows.map((r) => h('button', { type: 'button', class: rec && rec.id === r.id && rec.kind === kind ? 'on' : null, onclick: () => open(kind, r.id) },
      h('span', null, h('strong', null, r.id), ' ', r.name || '(no name)', r.sub ? h('span', { class: 'muted' }, `  ${r.sub}`) : null),
      r.live ? h('span', { class: 'chip on' }, 'published') : null, r.draft ? h('span', { class: 'chip' }, 'draft') : null))
      : h('p', { class: 'empty' }, q ? 'Nothing by that number or name.' : `You have none of your own yet. Find one of the game’s by number or name.`));
  });
  const find = h('input', { type: 'search', placeholder: 'Number or name', oninput: (e) => lookup(e.target.value) });
  const pickKind = kinds.length > 1 ? h('div', { class: 'segmented', role: 'group', 'aria-label': 'Which kind' }, kinds.map(([k, name]) => h('button', {
    type: 'button', class: k === kind ? 'on' : null, 'aria-pressed': k === kind,
    onclick: (e) => { kind = k; for (const b of pickKind.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', b === e.currentTarget); } lookup(find.value); },
  }, name))) : null;

  const leave = () => !changed || confirm('It has changes that aren’t saved. Leave them?');
  async function open(k, id) {
    if (!leave()) return;
    try { rec = await api(`/c/${k}/${id}`); changed = false; draw(); lookup(find.value); } catch (e) { toast(e.message, true); }
  }
  const touch = () => { if (!changed) { changed = true; drawHead(); } };
  const body = () => ({ tree: rec.tree, words: rec.words, folder: rec.folder });

  // ---------------------------------------------------------------- saving, publishing, exporting
  async function save() { try { rec.state = await api(`/c/${rec.kind}/${rec.id}`, { method: 'PUT', body: body() }); changed = false; drawHead(); lookup(find.value); toast('Saved as a draft.'); } catch (e) { toast(e.message, true); } }
  async function publish() {
    try {
      rec.state = await api(`/c/${rec.kind}/${rec.id}/publish`, { method: 'POST', body: body() }); changed = false; drawHead(); lookup(find.value);
      toast('Published. Players get it the next time they load the page. The game server needs it too: Export for Cosmic.');
    } catch (e) { toast(e.message, true); }
  }
  async function exportIt() {
    try { const res = await api(`/c/${rec.kind}/${rec.id}/export`, { method: 'POST', body: body(), raw: true }); download(await res.blob(), `cosmic-${rec.kind}-${rec.id}.zip`); toast('Exported. The zip says where its files go.'); }
    catch (e) { toast(e.message, true); }
  }
  async function discard() {
    if (!confirm(rec.state.draft ? 'Throw away your draft? What is published stays.' : 'Throw away the changes made since it was opened?')) return;
    try {
      if (rec.state.draft) await api(`/c/${rec.kind}/${rec.id}/draft`, { method: 'DELETE' });
      const { kind: k, id } = rec, there = rec.state.assets || rec.state.live;
      changed = false; rec = null;
      if (there) await open(k, id); else { draw(); lookup(find.value); }
    } catch (e) { toast(e.message, true); }
  }
  async function unpublish() {
    if (!confirm(rec.state.assets ? 'Stop publishing it? Players get the game’s own again.' : 'Stop publishing it? Players will no longer have it.')) return;
    try { rec.state = await api(`/c/${rec.kind}/${rec.id}/live`, { method: 'DELETE' }); drawHead(); lookup(find.value); toast('No longer published.'); } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------- a new one
  function pickPicture(k) {
    return dialog('Which picture?', (close) => {
      const grid = h('div', { class: 'pick-grid' }, h('p', { class: 'empty' }, 'Loading...'));
      api(`/pictures/${k}`).then((pics) => fill(grid, pics.length ? pics.map((p) => h('button', { type: 'button', title: `${p.name} (${p.w} × ${p.h})`, onclick: () => close(p) }, h('img', { alt: '', loading: 'lazy', src: pictureUrl(k, p.name, p.at) }), h('span', null, p.name)))
        : h('p', { class: 'empty' }, 'No pictures have been brought in for these yet. ', h('a', { href: '#import', onclick: () => close(undefined) }, 'Bring some in on the Import tab'), '.')), (e) => toast(e.message, true));
      return grid;
    }, { wide: true });
  }
  const canvasOf = (k, p, origin) => ({ origin, _w: p.w, _h: p.h, _canvas: `_custom/${DIRS[k]}/${p.name}.png` });
  function newOne() {
    if (!leave()) return;
    const k = kind, id = h('input', { type: 'number', required: true, min: 1 }), note = h('p', { class: 'error', role: 'alert' });
    let source = null, picture = null, empty = false;
    const from = h('button', { type: 'button', onclick: async () => { const r = await pickFromList(`A copy of which ${NAMES[k].toLowerCase()}?`, async (q) => (await api(`/c/${k}?q=${encodeURIComponent(q)}`)).map((x) => ({ id: x.id, label: `${x.name || '(no name)'}${x.sub ? `  (${x.sub})` : ''}`, sub: x.sub })));
      if (r) { source = r; picture = null; empty = false; from.textContent = `${r.id} ${r.label}`; if (pic) pic.textContent = k === 'quest' ? 'Start empty' : 'From a picture...'; } } }, 'A copy of...');
    const pic = k === 'npc' ? h('button', { type: 'button', onclick: async () => { const p = await pickPicture('npc'); if (p) { picture = p; source = null; pic.textContent = `The picture ${p.name}`; from.textContent = 'A copy of...'; } } }, 'From a picture...')
      : k === 'quest' ? h('button', { type: 'button', onclick: () => { empty = true; source = null; pic.textContent = 'Starting empty'; from.textContent = 'A copy of...'; } }, 'Start empty') : null;
    const range = k === 'quest' ? 'A quest\u2019s number has up to five digits. Take one the game doesn\u2019t use: you are told if it is taken. A copy of a quest like the one you want is the easiest start: it has everything the game expects of one.'
      : k === 'npc' ? 'An NPC’s number has up to seven digits. Take one the game doesn’t use: you are told if it is taken.'
      : k === 'equip' ? 'An equip’s number has seven digits and starts like the one it copies (a sword 130xxxx, a hat 100xxxx): the first three say what kind of equip it is.'
        : 'An item’s number has seven digits and starts with 2 (use), 3 (set-up), 4 (etc) or 5 (cash); its first three say which of the game’s files it joins.';
    dialog(`A new ${NAMES[k].toLowerCase()}`, (close) => h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      const n = Number(id.value);
      try {
        if (!source && !picture && !empty) { note.textContent = k === 'npc' ? 'Say what it starts as: a copy of an NPC, or a picture.' : k === 'quest' ? 'Say what it starts as: a copy of a quest, or empty.' : 'Say which one it is a copy of.'; return; }
        const there = await api(`/c/${k}/${n}/state`);
        if (there.assets || there.draft || there.live) { note.textContent = `${NAMES[k]} ${n} is there already. Take a free number, or open that one to change it.`; return; }
        if (source) {
          const src = await api(`/c/${k}/${source.id}`);
          if (k === 'equip' && Math.floor(n / 10000) !== Math.floor(source.id / 10000)) { note.textContent = `Its number has to start with ${Math.floor(source.id / 10000)}, as the one it copies does.`; return; }
          close({ id: n, kind: k, tree: src.tree, words: { ...src.words }, folder: src.folder, state: { assets: false, draft: false, live: false } });
        } else if (empty) close({ id: n, kind: k, tree: EMPTY_QUEST(), words: {}, state: { assets: false, draft: false, live: false } });
        else close({ id: n, kind: k, tree: { info: {}, stand: { 0: { ...canvasOf('npc', picture, [Math.round(picture.w / 2), picture.h]), z: 0, delay: 200 } } }, words: { name: picture.name, func: '' }, state: { assets: false, draft: false, live: false } });
      } catch (err) { note.textContent = err.message; }
    } }, h('label', null, 'Number', id), h('p', { class: 'muted' }, range), h('div', { class: 'side-buttons' }, from, pic), note,
    h('div', { class: 'dialog-foot' }, h('button', { class: 'primary', type: 'submit' }, 'Make it')))).then((made) => { if (made) { rec = made; changed = true; draw(); toast('A new one. Save it to keep it.'); } });
  }

  // ---------------------------------------------------------------- the editor
  const head = h('div', { class: 'thing-head' });
  function drawHead() {
    if (!rec) { fill(head); return; }
    fill(head, h('h2', null, `${NAMES[rec.kind]} ${rec.id}${rec.kind === 'quest' && rec.tree?.QuestInfo?.name ? `: ${rec.tree.QuestInfo.name}` : ''}`),
      h('span', { class: `chip${changed ? ' warn' : ''}` }, changed ? 'changes not saved' : rec.state.draft ? 'draft saved' : 'as it was opened'),
      h('span', { class: `chip${rec.state.live ? ' on' : ''}` }, rec.state.live ? 'published' : rec.state.assets ? 'players get the game’s own' : 'not published'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'primary', onclick: save }, 'Save'), h('button', { type: 'button', onclick: publish }, 'Publish'), h('button', { type: 'button', onclick: exportIt }, 'Export for Cosmic'),
      h('button', { type: 'button', class: 'quiet', onclick: discard }, 'Throw the draft away'), rec.state.live ? h('button', { type: 'button', class: 'quiet', onclick: unpublish }, 'Stop publishing') : null);
  }
  /** Rows to change a node's own values. */
  function fields(node, more) {
    const rows = [];
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('_') || (v !== null && typeof v === 'object')) continue;
      const input = typeof v === 'number'
        ? h('input', { type: 'number', step: 'any', value: v, onchange: (e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) { node[k] = n; touch(); } else e.target.value = node[k]; } })
        : h('input', { type: 'text', value: v, onchange: (e) => { node[k] = e.target.value; touch(); } });
      rows.push(h('label', { class: 'field', title: HINTS[k] || null }, h('span', null, k), input,
        h('button', { type: 'button', class: 'quiet', title: `Take ${k} off`, 'aria-label': `Take ${k} off`, onclick: () => { delete node[k]; touch(); draw(); } }, '×')));
    }
    const left = more.filter((k) => !(k in node));
    const adder = left.length ? h('select', { class: 'adder', 'aria-label': 'Add a field', onchange: (e) => { if (!e.target.value) return; node[e.target.value] = 0; touch(); draw(); } },
      h('option', { value: '' }, 'Add a field...'), left.map((k) => h('option', { value: k }, `${k}${HINTS[k] ? `  (${HINTS[k]})` : ''}`))) : null;
    const custom = h('input', { type: 'text', placeholder: 'another field’s name', class: 'adder' });
    const groups = Object.entries(node).filter(([k, v]) => !k.startsWith('_') && v !== null && typeof v === 'object' && !isCanvas(v) && typeof v._uol !== 'string').map(([k]) => k);
    return h('div', { class: 'fields' }, rows, adder,
      h('form', { class: 'adder-row', onsubmit: (e) => { e.preventDefault(); const k = custom.value.trim(); if (/^[A-Za-z][A-Za-z0-9_]*$/.test(k) && !(k in node)) { node[k] = 0; touch(); draw(); } } }, custom, h('button', { type: 'submit' }, 'Add')),
      groups.length ? h('p', { class: 'muted' }, `Also has ${groups.join(', ')} (kept as it is).`) : null);
  }
  /** One picture of it: what it shows now, where its point is, and a button to put one of yours in its place. */
  function pictureRow(holder, key, label, origin) {
    const node = holder[key], linked = node && typeof node._uol === 'string';
    const show = isCanvas(node) ? h('img', { alt: '', src: `/assets/${FAMILY[rec.kind]}/${node._canvas}` }) : h('span', { class: 'muted' }, linked ? 'the same as another' : 'none');
    const point = isCanvas(node) ? ['x', 'y'].map((axis, i) => h('label', { class: 'mini' }, axis, h('input', { type: 'number', value: node.origin?.[i] ?? 0, title: 'Where its point is in the picture (what is put at its place).',
      onchange: (e) => { node.origin = [...(node.origin || [0, 0])]; node.origin[i] = Number(e.target.value) || 0; touch(); } }))) : null;
    return h('div', { class: 'pic-row' }, h('div', { class: 'pic-frame small' }, show), h('div', { class: 'pic-what' }, h('strong', null, label),
      isCanvas(node) ? h('span', { class: 'muted' }, `${node._w} × ${node._h}`) : null, h('div', { class: 'pic-point' }, point)),
    h('button', { type: 'button', onclick: async () => {
      const p = await pickPicture(rec.kind);
      if (!p) return;
      const keep = isCanvas(node) ? Object.fromEntries(Object.entries(node).filter(([k]) => !['origin', '_w', '_h', '_canvas', '_at'].includes(k))) : {};
      holder[key] = { ...keep, ...canvasOf(rec.kind, p, origin(p)) };
      touch(); draw();
    } }, 'Use a picture...'));
  }
  function pictures() {
    const t = rec.tree, rows = [];
    if (rec.kind === 'npc') {
      for (const [act, frames] of Object.entries(t)) {
        if (act === 'info' || act.startsWith('_') || !frames || typeof frames !== 'object') continue;
        for (const [f, node] of Object.entries(frames)) if (/^\d+$/.test(f) && node && typeof node === 'object') rows.push(pictureRow(frames, f, `${act} ${f}`, (p) => [Math.round(p.w / 2), p.h]));
        if (rows.length > 60) break;
      }
      return [rows, h('p', { class: 'muted' }, 'An NPC stands on its point: the middle of the picture’s bottom edge for one you bring in.')];
    }
    t.info ??= {};
    return [pictureRow(t.info, 'icon', 'icon', (p) => [0, p.h]), pictureRow(t.info, 'iconRaw', 'iconRaw', (p) => [0, p.h]),
      h('p', { class: 'muted' }, 'The game keeps two of every icon, icon and iconRaw; give both the same picture unless you have two. An icon is 32 by 32 or a little less.'),
      rec.kind === 'equip' ? h('p', { class: 'muted' }, 'How it looks worn stays the one it was copied from.') : null];
  }
  /** A node of any shape: its values to change, its groups to open, and more to add. */
  function tree(node, depth = 0) {
    const rows = [], keys = Object.keys(node).filter((k) => !k.startsWith('_'));
    const drop = (k) => h('button', { type: 'button', class: 'quiet', title: `Take ${k} off`, 'aria-label': `Take ${k} off`, onclick: (e) => { e.preventDefault(); delete node[k]; if (Array.isArray(node._order)) node._order = node._order.filter((x) => String(x) !== k); touch(); draw(); } }, '\u00d7');
    for (const k of keys) {
      const v = node[k];
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const n = Object.keys(v).filter((x) => !x.startsWith('_')).length;
        rows.push(h('details', { class: 'group', open: depth < 1 || n <= 4 }, h('summary', null, h('span', { class: 'group-name' }, k), h('span', { class: 'muted' }, n ? `${n} inside` : 'empty'), drop(k)), tree(v, depth + 1)));
      } else if (typeof v === 'number') rows.push(h('label', { class: 'field', title: HINTS[k] || null }, h('span', null, k),
        h('input', { type: 'number', step: 'any', value: v, onchange: (e) => { const x = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(x)) { node[k] = x; touch(); } else e.target.value = node[k]; } }), drop(k)));
      else if (typeof v === 'string') rows.push(h('label', { class: `field${v.length > 40 || v.includes('\n') ? ' long' : ''}` }, h('span', null, k),
        v.length > 40 || v.includes('\n') ? h('textarea', { rows: Math.min(8, 2 + Math.floor(v.length / 70)), value: v, oninput: (e) => { node[k] = e.target.value; touch(); } }) : h('input', { type: 'text', value: v, oninput: (e) => { node[k] = e.target.value; touch(); } }), drop(k)));
    }
    // more: a list (its keys are numbers) takes the next number by itself
    const list = keys.length > 0 && keys.every((k) => /^\d+$/.test(k)), next = String(keys.reduce((m, k) => (/^\d+$/.test(k) ? Math.max(m, Number(k) + 1) : m), 0));
    const name = h('input', { type: 'text', placeholder: list ? next : 'a name', 'aria-label': 'The name of what to add' });
    const type = h('select', { 'aria-label': 'What kind of value' }, h('option', { value: 'number' }, 'a number'), h('option', { value: 'text' }, 'words'), h('option', { value: 'group' }, 'a group'));
    rows.push(h('form', { class: 'adder-row', onsubmit: (e) => {
      e.preventDefault();
      const k = name.value.trim() || (list ? next : '');
      if (!k || k.startsWith('_') || k in node) { name.focus(); return; }
      node[k] = type.value === 'number' ? 0 : type.value === 'text' ? '' : {};
      touch(); draw();
    } }, name, type, h('button', { type: 'submit' }, 'Add')));
    return h('div', { class: 'tree' }, rows);
  }
  const names = new Map();   // NPCs' names by number, as they are asked for
  /** Which NPC a quest is given by or handed in to: its number and name, and a button to pick another. */
  function npcRow(label, holder) {
    const id = holder.npc, who = h('span', { class: 'muted' }, id ? names.get(id) ?? '' : 'nobody yet');
    if (id && !names.has(id)) api(`/c/npc?q=${id}`).then((rows) => { names.set(id, rows.find((r) => r.id === id)?.name || '(not an NPC the game or you have)'); who.textContent = names.get(id); }, () => {});
    return h('div', { class: 'npc-row' }, h('strong', null, label), h('span', null, id ? String(id) : ''), who,
      h('button', { type: 'button', onclick: async () => { const r = await pickFromList('Which NPC?', async (q) => (await api(`/c/npc?q=${encodeURIComponent(q)}`)).map((x) => ({ id: x.id, label: x.name || '(no name)' }))); if (r) { holder.npc = r.id; names.set(r.id, r.label); touch(); draw(); } } }, 'Pick an NPC...'));
  }
  /** Adds { id, count: 1 } to a list of a quest (items to bring, monsters to hunt, items given). */
  const addTo = (holder, key, title, search) => h('button', { type: 'button', onclick: async () => {
    const r = await pickFromList(title, search);
    if (!r) return;
    const listNode = (holder[key] ??= {});
    listNode[String(Object.keys(listNode).reduce((m, k) => (/^\d+$/.test(k) ? Math.max(m, Number(k) + 1) : m), 0))] = { id: r.id, count: 1 };
    touch(); draw();
  } }, title);
  const findItem = async (q) => (await Promise.all(['item', 'equip'].map((k) => api(`/c/${k}?q=${encodeURIComponent(q)}`)))).flat().map((x) => ({ id: x.id, label: `${x.name || '(no name)'}${x.sub ? `  (${x.sub})` : ''}` }));
  const findMob = async (q) => (await api(`/names/mob?q=${encodeURIComponent(q)}`)).map((x) => ({ id: x.id, label: x.name || '(no name)' }));
  function quest() {
    const q = rec.tree;
    for (const part of ['QuestInfo', 'Check', 'Act', 'Say']) if (!q[part] || typeof q[part] !== 'object') q[part] = {};
    for (const part of ['Check', 'Act', 'Say']) for (const end of ['0', '1']) if (!q[part][end] || typeof q[part][end] !== 'object') q[part][end] = {};
    const info = q.QuestInfo, text = (key, label) => h('label', { class: 'word' }, label, h('textarea', { rows: 3, value: typeof info[key] === 'string' ? info[key] : '', oninput: (e) => { info[key] = e.target.value; touch(); } }));
    const panel = (title, ...kids) => h('section', { class: 'panel' }, h('h3', null, title), kids);
    return [
      panel('The quest', h('label', { class: 'word' }, 'Name', h('input', { type: 'text', value: typeof info.name === 'string' ? info.name : '', oninput: (e) => { info.name = e.target.value; touch(); drawHead(); } })),
        text('0', 'In the quest window before it is started'), text('1', 'While it is under way'), text('2', 'Once it is done'),
        h('details', { class: 'group' }, h('summary', null, h('span', { class: 'group-name' }, 'Everything the game keeps about it (QuestInfo)')), tree(info, 1))),
      panel('Who gives it, and who takes it back', npcRow('Given by', q.Check[0]), npcRow('Handed in to', q.Check[1]),
        h('p', { class: 'muted' }, 'An NPC of your own works too. What the NPC says is below; anything more than that is a script on the game server (scripts/quest/<its number>.js).')),
      panel('To start it (Check 0)', h('p', { class: 'muted' }, 'What a player needs before the NPC offers it: lvmin and lvmax for the level, job, quest for others to have done first.'), tree(q.Check[0])),
      panel('To finish it (Check 1)', h('div', { class: 'side-buttons' }, addTo(q.Check[1], 'item', 'Add an item to bring...', findItem), addTo(q.Check[1], 'mob', 'Add a monster to hunt...', findMob)), tree(q.Check[1])),
      panel('What finishing it gives (Act 1)', h('p', { class: 'muted' }, 'exp, money, pop (fame), and items: a count below zero takes the item away.'), h('div', { class: 'side-buttons' }, addTo(q.Act[1], 'item', 'Add an item to give...', findItem)), tree(q.Act[1])),
      panel('What starting it gives (Act 0)', tree(q.Act[0])),
      panel('What is said at the start (Say 0)', h('p', { class: 'muted' }, 'The NPC\u2019s lines in order: 0, 1, 2...'), tree(q.Say[0])),
      panel('What is said at the end (Say 1)', tree(q.Say[1])),
    ];
  }
  function draw() {
    drawHead();
    if (rec?.kind === 'quest') { fill(editor, quest()); return; }
    if (!rec) { fill(editor, h('div', { class: 'thing-empty' }, h('h2', null, kinds.map((k) => k[1]).join(' and ')), h('p', null, blurb))); return; }
    const t = rec.tree, words = Object.keys(rec.words).map((w) => h('label', { class: 'word' }, WORDS[w] || w,
      w === 'desc' ? h('textarea', { rows: 3, value: rec.words[w], oninput: (e) => { rec.words[w] = e.target.value; touch(); } }) : h('input', { type: 'text', value: rec.words[w], maxLength: 100, oninput: (e) => { rec.words[w] = e.target.value; touch(); } })));
    const sections = [h('section', { class: 'panel' }, h('h3', null, 'Words'), words, rec.kind !== 'npc' ? h('p', { class: 'muted' }, 'In a description, \\n starts a new line.') : null),
      h('section', { class: 'panel' }, h('h3', null, 'Pictures'), pictures())];
    if (rec.kind === 'equip') sections.push(h('section', { class: 'panel' }, h('h3', null, `Stats (info)${rec.folder ? `, a ${rec.folder}` : ''}`), fields((t.info ??= {}), MORE.equip)));
    else if (rec.kind === 'item') {
      sections.push(h('section', { class: 'panel' }, h('h3', null, 'About it (info)'), fields((t.info ??= {}), MORE.item)));
      sections.push(h('section', { class: 'panel' }, h('h3', null, 'What using it does (spec)'), t.spec && typeof t.spec === 'object' ? fields(t.spec, MORE.spec)
        : h('button', { type: 'button', onclick: () => { t.spec = {}; touch(); draw(); } }, 'Give it something to do')));
    } else sections.push(h('section', { class: 'panel' }, h('h3', null, 'Settings (info)'), fields((t.info ??= {}), MORE.npc),
      h('p', { class: 'muted' }, 'What an NPC says and does is a script on the game server (scripts/npc/<its number>.js); put it on a map in the map editor.')));
    fill(editor, sections);
  }

  fill(host, h('div', { class: 'things' },
    h('aside', { class: 'thing-side' }, pickKind, find, h('button', { type: 'button', onclick: newOne }, 'New...'), list),
    h('div', { class: 'thing-main' }, head, editor)));
  draw();
  return { unsaved: () => changed, show() { lookup(find.value); } };
}
