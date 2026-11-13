/**
 * Maps: the map editor. Open a map of the game's (or start one of your own), change what is on it, save it (a draft
 * only this page sees), publish it (players get it in place of the assets' own) and export it for the Cosmic
 * server, which has to know the same map. The canvas is mapview.js, the map itself mapdoc.js; this is the bar above
 * them, the panel beside them and the windows that pick things.
 */
import { h, fill, toast, dialog, settled, download } from './ui.js';
import { api } from './api.js';
import { MapDoc, blankMap, KINDS, FIELDS, HINTS, PORTAL_TYPES, PORTAL_NOTES, NO_MAP, isWord } from './mapdoc.js';
import { MapView } from './mapview.js';
import { config } from '../config.js';
import { isCanvas, frames } from '../assets.js';

const pad9 = (id) => String(id).padStart(9, '0');
const mapLabel = (m) => `${m.id}  ${[m.sub, m.name].filter(Boolean).join(' : ') || '(no name)'}`;

export function mapsTab(host) {
  let doc = null, state = { assets: false, draft: false, live: false }, view = null, strings = {};
  const canvas = h('canvas', { class: 'map-canvas', tabindex: 0, 'aria-label': 'The map. Drag to move things or the view; the wheel zooms.' });
  const side = h('aside', { class: 'map-side' });
  const status = { state: h('span'), hint: h('span', { class: 'map-hint' }), at: h('span', { class: 'map-at' }) };
  const bar = h('div', { class: 'map-bar' });
  const at = { x: 0, y: 0, zoom: 100 }, where = () => { status.at.textContent = `${at.x}, ${at.y}   ${at.zoom}%`; };
  const empty = h('div', { class: 'map-empty' }, h('h2', null, 'Map editor'), h('p', null, 'Find a map by its number or its name to change it, or start a new one.'));

  // ---------------------------------------------------------------- finding and opening
  const results = h('div', { class: 'map-results', hidden: true });
  let asking = 0;
  const lookup = settled(async (q) => {
    const mine = ++asking;
    let list = [];
    try { list = await api(`/c/map?q=${encodeURIComponent(q)}`); } catch (e) { toast(e.message, true); }
    if (mine !== asking || document.activeElement !== find) return;
    fill(results, list.length ? list.map((m) => h('button', { type: 'button', onclick: () => { asking++; results.hidden = true; find.value = ''; openMap(m.id); } },
      h('span', null, mapLabel(m)), m.live ? h('span', { class: 'chip on' }, 'published') : null, m.draft ? h('span', { class: 'chip' }, 'draft') : null))
      : h('p', { class: 'empty' }, q ? 'No map has that number or name.' : 'You have no maps of your own yet.'));
    results.hidden = false;
  });
  const find = h('input', { type: 'search', placeholder: 'Find a map: number or name', class: 'map-find', oninput: (e) => lookup(e.target.value), onfocus: (e) => lookup(e.target.value),
    onkeydown: (e) => { if (e.key === 'Escape') results.hidden = true; if (e.key === 'Enter' && /^\d{1,9}$/.test(e.target.value.trim())) { asking++; results.hidden = true; openMap(Number(e.target.value.trim())); e.target.value = ''; e.target.blur(); } } });
  document.addEventListener('pointerdown', (e) => { if (!results.contains(e.target) && e.target !== find) results.hidden = true; });

  const leave = () => !doc?.changed || confirm('This map has changes that aren’t saved. Leave them?');
  async function openMap(id) {
    if (!leave()) return;
    try {
      const m = await api(`/c/map/${id}`);
      await show(new MapDoc({ id: m.id, tree: m.tree, name: m.words }), m.state);
      status.hint.textContent = m.from === 'draft' ? 'Opened your draft.' : m.from === 'live' ? 'Opened the published map.' : 'Opened the map as the assets have it.';
    } catch (e) { toast(e.message, true); }
  }
  async function show(next, st) {
    doc = next; state = st;
    if (!view) {
      try { config.sheets = !!(await api('/overview')).sheets.on; } catch { config.sheets = false; }
      view = new MapView(canvas, {
        onPick: (it, moving) => { if (!moving) inspect(it); else moveFields(it); }, onChange: () => refresh(), onView: () => { at.zoom = Math.round(view.zoom * 100); where(); },
        onMouse: (x, y) => { at.x = x; at.y = y; where(); },
        onTool: (t) => { status.hint.textContent = t?.hint || ''; }, onUndo: (again) => undo(again), onSave: () => save(),
      });
    }
    empty.hidden = true; canvas.hidden = false; side.hidden = false;
    refresh(); inspect(null);
    await view.open(doc);
    for (const kind of ['Npc', 'Mob']) strings[kind] ??= await view.assets.json(`String/${kind}.img`);
    inspect(view.item());
    if (doc.tree.info?.link) toast(`This map takes everything but its info from map ${doc.tree.info.link} (info/link): edit that one for what is on it.`);
  }

  // ---------------------------------------------------------------- saving, publishing, exporting
  const body = () => ({ tree: doc.tree, words: doc.name });
  async function save() {
    if (!doc) return;
    try { state = await api(`/c/map/${doc.id}`, { method: 'PUT', body: body() }); doc.changed = false; refresh(); toast('Saved as a draft.'); } catch (e) { toast(e.message, true); }
  }
  /** The map's problems in a window; resolves true to go on. `then` names what going on does. */
  function check(then) {
    const list = doc.problems();
    if (!list.length && then) return Promise.resolve(true);
    return dialog(list.length ? 'What would go wrong on this map' : 'Nothing wrong found', (close) => [
      list.length ? h('ul', { class: 'problems' }, list.map((p) => h('li', { class: p.bad ? 'bad' : null },
        h('strong', null, p.bad ? 'Must fix: ' : 'Worth a look: '), p.text, p.path ? h('button', { type: 'button', class: 'link', onclick: () => { close(false); view.mode = p.path[0] === 'foothold' || p.path.length === 2 ? 'data' : view.mode; view.goTo(p.path); refreshView(); } }, 'show') : null)))
        : h('p', null, 'The map has ground, a place to arrive, and everything stands on something.'),
      h('div', { class: 'dialog-foot' }, then ? h('button', { type: 'button', class: 'primary', onclick: () => close(true) }, `${then} anyway`) : null, h('button', { type: 'button', onclick: () => close(false) }, then ? 'Go back' : 'Close')),
    ]).then((v) => !!v);
  }
  async function publish() {
    if (!doc || !(await check('Publish'))) return;
    try {
      state = await api(`/c/map/${doc.id}/publish`, { method: 'POST', body: body() }); doc.changed = false; refresh();
      toast('Published. Players get it the next time they load the page. The game server needs it too: Export for Cosmic.');
    } catch (e) { toast(e.message, true); }
  }
  async function exportMap() {
    if (!doc || !(await check('Export'))) return;
    try {
      const res = await api(`/c/map/${doc.id}/export`, { method: 'POST', body: body(), raw: true });
      download(await res.blob(), `cosmic-map-${pad9(doc.id)}.zip`);
      toast('Exported. The zip holds the files for the Cosmic server’s wz folder, and says where they go.');
    } catch (e) { toast(e.message, true); }
  }
  async function discard() {
    if (!doc || !confirm(state.draft ? 'Throw away your draft of this map? What is published stays.' : 'Throw away the changes made since it was opened?')) return;
    try { if (state.draft) await api(`/c/map/${doc.id}/draft`, { method: 'DELETE' }); doc.changed = false; const id = doc.id, has = state.assets || state.live; doc = null; if (has) await openMap(id); else closeMap(); } catch (e) { toast(e.message, true); }
  }
  async function unpublish() {
    if (!doc || !confirm(state.assets ? 'Stop publishing this map? Players get the assets’ own again.' : 'Stop publishing this map? Players will no longer have it.')) return;
    try { state = await api(`/c/map/${doc.id}/live`, { method: 'DELETE' }); refresh(); toast('No longer published.'); } catch (e) { toast(e.message, true); }
  }
  function closeMap() { doc = null; canvas.hidden = true; side.hidden = true; empty.hidden = false; refresh(); }
  function undo(again) {
    if (!doc || !(again ? doc.redo() : doc.undo())) return;
    view.listItems();
    if (view.picked && !view.item()) view.picked = null;
    refresh(); inspect(view.item()); view.rebuild();
  }

  // ---------------------------------------------------------------- a new map
  function newMap() {
    if (!leave()) return;
    const id = h('input', { type: 'number', min: 0, max: 999999999, required: true, placeholder: 'e.g. 910000100' });
    const street = h('input', { type: 'text', maxLength: 100 }), name = h('input', { type: 'text', maxLength: 100, required: true });
    const from = h('input', { type: 'number', min: 0, max: 999999999, placeholder: 'a map’s number' });
    const w = h('input', { type: 'number', value: 1600, min: 400, max: 20000 }), ht = h('input', { type: 'number', value: 800, min: 300, max: 20000 });
    const kind = { blank: h('input', { type: 'radio', name: 'start', checked: true }), copy: h('input', { type: 'radio', name: 'start' }) };
    const note = h('p', { class: 'error', role: 'alert' });
    dialog('A new map', (close) => h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      const n = Number(id.value);
      try {
        const there = await api(`/c/map/${n}/state`);
        if (there.assets || there.draft || there.live) { note.textContent = `Map ${n} is there already. Pick a free number, or open that map to change it.`; return; }
        let tree;
        if (kind.copy.checked) { tree = (await api(`/c/map/${Number(from.value)}`)).tree; if (tree.info) tree.info.returnMap = tree.info.returnMap ?? n; }
        else tree = blankMap(n, Number(w.value) || 1600, Number(ht.value) || 800);
        close({ id: n, tree, name: { streetName: street.value.trim(), mapName: name.value.trim() } });
      } catch (err) { note.textContent = err.message; }
    } },
    h('label', null, 'Number', id), h('p', { class: 'muted' }, 'Up to nine digits, one no map has. Its first digit decides which Map folder it is kept in on the game server.'),
    h('label', null, 'Street name', street), h('label', null, 'Map name', name),
    h('label', { class: 'check' }, kind.blank, 'Start empty, ', w, ' wide and ', ht, ' high'),
    h('label', { class: 'check' }, kind.copy, 'Start as a copy of map ', from),
    note, h('div', { class: 'dialog-foot' }, h('button', { class: 'primary', type: 'submit' }, 'Make it')))).then(async (made) => {
      if (!made) return;
      const d = new MapDoc(made); d.changed = true;
      await show(d, { assets: false, draft: false, live: false });
      status.hint.textContent = 'A new map. Save it to keep it.';
    });
  }

  // ---------------------------------------------------------------- picking things to add
  /** A window with a search box and a list; resolves with the row picked. */
  function pickRow(title, search, hint) {
    return dialog(title, (close) => {
      const list = h('div', { class: 'pick-list' });
      const run = settled(async (q) => {
        let rows = [];
        try { rows = await search(q); } catch (e) { toast(e.message, true); }
        fill(list, rows.length ? rows.map((r) => h('button', { type: 'button', onclick: () => close(r) }, h('strong', null, r.id), ' ', r.label)) : h('p', { class: 'empty' }, 'Nothing by that number or name.'));
      });
      const box = h('input', { type: 'search', placeholder: hint, oninput: (e) => run(e.target.value) });
      setTimeout(() => { box.focus(); run(''); }, 0);
      return [box, list];
    });
  }
  const pickLife = (kind) => pickRow(kind === 'npc' ? 'Which NPC?' : 'Which monster?', async (q) => (await api(`${kind === 'npc' ? '/c/npc' : '/names/mob'}?q=${encodeURIComponent(q)}`)).map((r) => ({ id: r.id, label: r.name || '(no name)' })), 'number or name');
  const pickMap = (title) => pickRow(title, async (q) => (await api(`/c/map?q=${encodeURIComponent(q)}`)).map((m) => ({ id: m.id, label: [m.sub, m.name].filter(Boolean).join(' : ') || '(no name)' })), 'a map’s number or name');
  /** A window of pictures from one of the game's sets (objects, tiles, backgrounds); resolves with the one picked. */
  function pickArt(title, kind, list, start, rowsOf) {
    return dialog(title, (close) => {
      const grid = h('div', { class: 'pick-grid' });
      const sets = h('select', { onchange: () => load() }, list.map((s) => h('option', { value: s, selected: s === start }, s)));
      const load = async () => {
        fill(grid, h('p', { class: 'empty' }, 'Loading...'));
        const set = await view.assets.json(`Map/${kind}/${sets.value}.img`).catch(() => null);
        const rows = set ? rowsOf(set, sets.value) : [];
        fill(grid, rows.length ? rows.slice(0, 600).map((r) => h('button', { type: 'button', title: r.label, onclick: () => close(r) },
          h('img', { loading: 'lazy', alt: '', src: `/assets/${r.node._canvas}` }), h('span', null, r.label))) : h('p', { class: 'empty' }, 'This set has no pictures.'));
      };
      setTimeout(load, 0);
      return [h('label', null, 'Set', sets), grid];
    }, { wide: true });
  }
  const objRows = (set, oS) => {
    const rows = [];
    for (const [l0, a] of Object.entries(set)) if (a && typeof a === 'object') for (const [l1, b] of Object.entries(a)) if (b && typeof b === 'object') for (const [l2, c] of Object.entries(b)) {
      const node = isCanvas(c) ? c : frames(c)[0];
      if (isCanvas(node)) rows.push({ pick: { oS, l0, l1, l2 }, node, label: `${l0} / ${l1} / ${l2}` });
    }
    return rows;
  };
  const tileRows = (set, tS) => {
    const rows = [];
    for (const [u, a] of Object.entries(set)) if (u !== 'info' && a && typeof a === 'object') for (const [no, node] of Object.entries(a)) if (isCanvas(node)) rows.push({ pick: { tS, u, no }, node, label: `${u} ${no}` });
    return rows;
  };
  const backRows = (set, bS) => Object.entries(set.back || {}).filter(([, n]) => isCanvas(n)).map(([no, node]) => ({ pick: { bS, no }, node, label: `${no}` }));
  const layerOf = () => (view.layer >= 0 ? view.layer : 0);

  const ADD = [
    ['NPC...', async () => { const r = await pickLife('npc'); if (r) tool({ what: 'npc', id: r.id, hint: `Click where ${r.label} stands. It drops onto the ground under it.` }, 'data'); }],
    ['Monster...', async () => { const r = await pickLife('mob'); if (r) tool({ what: 'mob', id: r.id, again: true, hint: `Click where ${r.label} comes out. Click again for more; Escape when done.` }, 'data'); }],
    ['Portal', () => tool({ what: 'portal', hint: 'Click where the portal goes. Then say where it leads, in the panel.' }, 'data')],
    ['Place to arrive (sp)', () => tool({ what: 'spawn', hint: 'Click where players arrive.' }, 'data')],
    ['Ground (footholds)', () => tool({ kind: 'footholds', layer: layerOf(), points: [], hint: 'Click along the ground from left to right, point by point. Double-click or Enter to finish, Escape to give up.' }, 'data')],
    ['Rope', () => tool({ kind: 'rope', ladder: false, page: layerOf(), hint: 'Drag from the rope’s top to its bottom.' }, 'data')],
    ['Ladder', () => tool({ kind: 'rope', ladder: true, page: layerOf(), hint: 'Drag from the ladder’s top to its bottom.' }, 'data')],
    ['Seat', () => tool({ what: 'seat', again: true, hint: 'Click where the seat is. Click again for more; Escape when done.' }, 'data')],
    ['Reactor...', async () => { const ids = await api('/sets/reactor'); const r = await pickRow('Which reactor?', async (q) => ids.filter((i) => i.includes(q.trim())).slice(0, 80).map((i) => ({ id: Number(i), label: '' })), 'number'); if (r) tool({ what: 'reactor', id: r.id, hint: 'Click where the reactor goes.' }, 'data'); }],
    ['Object...', async () => {
      const used = Object.values(doc.tree[layerOf()]?.obj || {}).find((o) => o?.oS)?.oS, r = await pickArt(`An object for layer ${layerOf()}`, 'Obj', await api('/sets/obj'), used, objRows);
      if (r) { view.assets.preload([r.node]); tool({ what: 'obj', layer: layerOf(), pick: r.pick, node: r.node, again: true, hint: `Click to put it on layer ${layerOf()}. Click again for more; Escape when done.` }, 'scenery'); }
    }],
    ['Tile...', async () => {
      const l = layerOf(), has = Object.keys(doc.tree[l]?.tile || {}).some((k) => !k.startsWith('_')), tS = doc.tree[l]?.info?.tS;
      // a layer's tiles all come from one set: once it has some, that set is the only choice
      const r = await pickArt(`A tile for layer ${l}`, 'Tile', has && tS ? [tS] : await api('/sets/tile'), tS, tileRows);
      if (r) { view.assets.preload([r.node]); tool({ what: 'tile', layer: l, pick: r.pick, node: r.node, again: true, hint: `Click to put it on layer ${l}. Click again for more; Escape when done.` }, 'scenery'); }
    }],
    ['Background...', async () => {
      const r = await pickArt('A background', 'Back', await api('/sets/back'), Object.values(doc.tree.back || {}).find((b) => b?.bS)?.bS, backRows);
      if (r) { doc.mark(); view.changed(doc.addBack(r.pick.bS, r.pick.no)); }
    }],
  ];
  function tool(t, mode) { view.mode = mode; view.setTool({ kind: 'place', ...t }); refreshView(); canvas.focus(); }

  // ---------------------------------------------------------------- wiring a portal to another map
  async function wire(it) {
    const target = await pickMap('Which map does it lead to?');
    if (!target) return;
    let there;
    try { there = await api(`/c/map/${target.id}`); } catch (e) { toast(e.message, true); return; }
    const portals = Object.entries(there.tree.portal || {}).filter(([, p]) => p && p.pt !== 0 && p.pt !== 6 && p.pn);
    const here = it.n.pn, back = h('input', { type: 'checkbox', checked: true });
    const to = h('select', null, h('option', { value: '' }, 'where players arrive (sp)'), portals.map(([, p]) => h('option', { value: p.pn }, `${p.pn}${p.tm !== NO_MAP ? `  (now leads to ${p.tm}${p.tn ? ` ${p.tn}` : ''})` : ''}`)));
    const ok = await dialog(`To ${target.id} ${target.label}`, (close) => h('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); close(true); } },
      h('label', null, 'Come out at', to),
      h('label', { class: 'check' }, back, `Make that portal lead back here (to ${here} on this map)`),
      h('p', { class: 'muted' }, 'The way back is saved as a draft of that map: open it and publish it as well.'),
      h('div', { class: 'dialog-foot' }, h('button', { class: 'primary', type: 'submit' }, 'Wire it'))));
    if (!ok) return;
    doc.mark();
    it.n.tm = target.id; it.n.tn = to.value;
    view.changed(it.path);
    if (back.checked && to.value && target.id !== doc.id) {
      try {
        const [, p] = portals.find(([, q]) => q.pn === to.value);
        p.tm = doc.id; p.tn = here;
        await api(`/c/map/${target.id}`, { method: 'PUT', body: { tree: there.tree, words: there.words } });
        toast(`Map ${target.id} has a draft with the way back. Open it and publish it too.`);
      } catch (e) { toast(`The way back could not be saved: ${e.message}`, true); }
    } else if (back.checked && to.value) {
      const other = view.items.find((x) => x.kind === 'portal' && x.n.pn === to.value);
      if (other) { other.n.tm = doc.id; other.n.tn = here; view.changed(it.path); }
    }
  }

  // ---------------------------------------------------------------- the panel beside the canvas
  const lifeName = (n) => strings[n.type === 'm' ? 'Mob' : 'Npc']?.[Number(n.id)]?.name || '';
  /** Rows to change a node's own values; `kind` says which more it may be given. */
  function fields(node, kind, path) {
    const set = (k, v) => { doc.mark(); node[k] = v; view.changed(path); };
    const rows = [];
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('_') || (v !== null && typeof v === 'object')) continue;
      let input;
      if (k === 'pt') input = h('select', { onchange: (e) => set(k, Number(e.target.value)) }, PORTAL_TYPES.map((name, i) => h('option', { value: i, selected: i === v }, `${i}  ${name}${PORTAL_NOTES[i] ? `  (${PORTAL_NOTES[i]})` : ''}`)));
      else if (k === 'type' && kind === 'life') input = h('select', { onchange: (e) => set(k, e.target.value) }, [['n', 'n  (an NPC)'], ['m', 'm  (a monster)']].map(([val, name]) => h('option', { value: val, selected: val === v }, name)));
      else if (typeof v === 'number') input = h('input', { type: 'number', step: 'any', value: v, 'data-field': k, onchange: (e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) set(k, n); else e.target.value = node[k]; } });
      else input = h('input', { type: 'text', value: v, 'data-field': k, onchange: (e) => set(k, e.target.value) });
      const drop = FIELDS[kind]?.more.includes(k) ? h('button', { type: 'button', class: 'quiet', title: `Take ${k} off`, 'aria-label': `Take ${k} off`, onclick: () => { doc.mark(); delete node[k]; view.changed(path); } }, '×') : null;
      rows.push(h('label', { class: 'field', title: HINTS[k] || null }, h('span', null, k), input, drop));
    }
    const more = (FIELDS[kind]?.more || []).filter((k) => !(k in node));
    const adder = more.length ? h('select', { class: 'adder', 'aria-label': 'Add a field', onchange: (e) => { const k = e.target.value; if (!k) return; doc.mark(); node[k] = isWord(k) ? '' : 0; view.changed(path); } },
      h('option', { value: '' }, 'Add a field...'), more.map((k) => h('option', { value: k }, k))) : null;
    const groups = Object.entries(node).filter(([k, v]) => !k.startsWith('_') && v !== null && typeof v === 'object' && !Array.isArray(v)).map(([k]) => k);
    return [rows, adder, groups.length ? h('p', { class: 'muted' }, `Also has ${groups.join(', ')} (kept as it is; not changed here).`) : null];
  }
  /** While something is dragged, only its numbers change: write them into the boxes that are there. */
  function moveFields(it) {
    if (!it) return;
    for (const el of side.querySelectorAll('input[data-field]')) { const v = it.n[el.dataset.field]; if (v !== undefined && document.activeElement !== el) el.value = v; }
  }
  function inspect(it) {
    if (!doc) return;
    if (!it) {
      const count = (k) => view.items.filter((x) => x.kind === k).length, t = doc.tree;
      const nameBox = (key, label) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'text', value: doc.name[key], maxLength: 100, onchange: (e) => { doc.mark(); doc.name[key] = e.target.value; refresh(); } }));
      const backs = view.items.filter((x) => x.kind === 'back');
      fill(side,
        h('h3', null, `Map ${doc.id}`), nameBox('streetName', 'Street'), nameBox('mapName', 'Name'),
        h('p', { class: 'muted' }, `${count('life')} NPCs and monsters, ${count('portal')} portals, ${count('foothold')} footholds, ${count('rope')} ropes and ladders, ${count('obj')} objects, ${count('tile')} tiles.`),
        h('button', { type: 'button', onclick: () => check(null) }, 'Check the map'),
        h('h3', null, 'Settings (info)'), t.info ? fields(t.info, 'info', null) : h('button', { type: 'button', onclick: () => { doc.mark(); t.info = blankMap(doc.id).info; view.changed(null); } }, 'Give it settings'),
        h('h3', null, 'Backgrounds'), backs.length ? h('div', { class: 'back-list' }, backs.map((b) => h('button', { type: 'button', onclick: () => view.pick(b.path) }, `${b.path[1]}  ${b.n.bS || '(none)'} ${b.n.no}${b.n.front ? '  (in front)' : ''}`))) : h('p', { class: 'muted' }, 'None. Add one from the Add menu.'));
      return;
    }
    const n = it.n, title = it.kind === 'life' ? `${n.type === 'm' ? 'Monster' : 'NPC'} ${n.id}${lifeName(n) ? `: ${lifeName(n)}` : ''}` : it.kind === 'foothold' ? `Foothold ${it.path[3]}` : `${KINDS[it.kind]} ${it.path[it.path.length - 1]}`;
    const where = it.kind === 'foothold' ? `Layer ${it.path[1]}, run ${it.path[2]}. Drag an end to reshape it; what joins it comes along.` : it.layer !== undefined ? `On layer ${it.layer}.` : it.kind === 'life' ? 'Dragged, it drops onto the ground under it (hold Shift to leave it in the air).' : '';
    const extra = [];
    if (it.kind === 'portal') extra.push(h('button', { type: 'button', class: 'primary', onclick: () => wire(it) }, 'Lead to a map...'),
      n.tm !== NO_MAP && n.tm !== undefined ? h('button', { type: 'button', onclick: () => openMap(n.tm) }, `Open map ${n.tm}`) : null);
    if (it.kind === 'life') extra.push(h('button', { type: 'button', onclick: async () => { const r = await pickLife(n.type === 'm' ? 'mob' : 'npc'); if (r) { doc.mark(); n.id = String(r.id); view.changed(it.path); } } }, 'Another one...'),
      h('button', { type: 'button', onclick: () => { doc.mark(); if (!doc.settle(n)) toast('There is no ground under it.', true); view.changed(it.path); } }, 'Stand it on the ground'));
    const seat = it.kind === 'seat' ? ['x', 'y'].map((label, i) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'number', value: n[i], onchange: (e) => { doc.mark(); n[i] = Number(e.target.value) || 0; view.changed(it.path); } }))) : null;
    fill(side,
      h('h3', null, title), where ? h('p', { class: 'muted' }, where) : null,
      extra.length ? h('div', { class: 'side-buttons' }, extra) : null,
      seat || fields(n, it.kind, it.path),
      h('div', { class: 'side-buttons' },
        it.kind === 'foothold' ? null : h('button', { type: 'button', onclick: () => view.duplicate() }, 'Copy'),
        h('button', { type: 'button', class: 'danger', onclick: () => view.remove() }, 'Delete'),
        h('button', { type: 'button', class: 'quiet', onclick: () => view.pick(null) }, 'Done')));
  }

  // ---------------------------------------------------------------- the bar
  const button = (label, fn, cls = null, title = null) => h('button', { type: 'button', class: cls, title, onclick: fn }, label);
  const menu = (label, rows) => {
    const list = h('div', { class: 'menu-list', hidden: true }, rows.map(([name, fn]) => h('button', { type: 'button', onclick: () => { list.hidden = true; fn(); } }, name)));
    const wrap = h('div', { class: 'menu' }, h('button', { type: 'button', 'aria-haspopup': 'true', onclick: () => { list.hidden = !list.hidden; } }, `${label} ▾`), list);
    document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target)) list.hidden = true; });
    return wrap;
  };
  const SHOW = [['backs', 'Backgrounds'], ['scenery', 'Tiles and objects'], ['life', 'NPCs and monsters'], ['footholds', 'Footholds'], ['ropes', 'Ropes and ladders'], ['portals', 'Portals'], ['seats', 'Seats'], ['reactors', 'Reactors']];
  const parts = {};
  function buildBar() {
    parts.save = button('Save', save, 'primary', 'Keep it as a draft (Ctrl+S)');
    parts.publish = button('Publish', publish, null, 'Give it to players in place of the assets’ own');
    parts.export = button('Export for Cosmic', exportMap, null, 'A zip of the files the game server reads');
    parts.undo = button('Undo', () => undo(false), null, 'Ctrl+Z'); parts.redo = button('Redo', () => undo(true), null, 'Ctrl+Shift+Z');
    parts.mode = h('div', { class: 'segmented', role: 'group', 'aria-label': 'What the mouse picks' }, [['data', 'Game data'], ['scenery', 'Scenery']].map(([m, name]) => h('button', { type: 'button', 'data-mode': m, onclick: () => { view.mode = m; view.pick(null); refreshView(); } }, name)));
    parts.layer = h('select', { 'aria-label': 'Layer', onchange: (e) => { view.layer = Number(e.target.value); view.redraw(); } }, h('option', { value: -1 }, 'All layers'), [0, 1, 2, 3, 4, 5, 6, 7].map((l) => h('option', { value: l }, `Layer ${l}`)));
    parts.show = h('div', { class: 'menu' });
    const showList = h('div', { class: 'menu-list checks', hidden: true }, SHOW.map(([k, name]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { view.show[k] = e.target.checked; view.redraw(); } }), name)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { view.animate = e.target.checked; view.redraw(); } }), 'Animate the scenery'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { view.snap = e.target.checked; } }), 'Scenery snaps to 30 pixels'));
    parts.show.append(h('button', { type: 'button', 'aria-haspopup': 'true', onclick: () => { showList.hidden = !showList.hidden; } }, 'Show ▾'), showList);
    document.addEventListener('pointerdown', (e) => { if (!parts.show.contains(e.target)) showList.hidden = true; });
    parts.more = menu('More', [['Check the map', () => check(null)], ['Throw the draft away', discard], ['Stop publishing', unpublish], ['Close the map', () => { if (leave()) closeMap(); }]]);
    parts.add = menu('Add', ADD);
    parts.tools = h('div', { class: 'map-tools' }, parts.save, parts.publish, parts.export, parts.more, h('span', { class: 'sep' }), parts.undo, parts.redo, h('span', { class: 'sep' }), parts.add, parts.mode, parts.layer, parts.show,
      h('span', { class: 'sep' }), button('−', () => view.zoomAt(view.w / 2, view.h / 2, 1 / 1.25), null, 'Zoom out'), button('+', () => view.zoomAt(view.w / 2, view.h / 2, 1.25), null, 'Zoom in'), button('Fit', () => view.fit(), null, 'The whole map (F)'));
    fill(bar, h('div', { class: 'map-open' }, find, results), button('New...', newMap), parts.tools);
  }
  function refreshView() { if (!view) return; for (const b of parts.mode.children) { const on = b.dataset.mode === view.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); } }
  function refresh() {
    parts.tools.hidden = !doc;
    if (!doc) { fill(status.state, ''); status.hint.textContent = ''; status.at.textContent = ''; return; }
    parts.undo.disabled = !doc.past.length; parts.redo.disabled = !doc.future.length;
    fill(status.state, h('strong', null, `${doc.id} ${[doc.name.streetName, doc.name.mapName].filter(Boolean).join(' : ')}`),
      h('span', { class: `chip${doc.changed ? ' warn' : ''}` }, doc.changed ? 'changes not saved' : state.draft ? 'draft saved' : 'as it was opened'),
      h('span', { class: `chip${state.live ? ' on' : ''}` }, state.live ? 'published' : state.assets ? 'players get the assets’ own' : 'not published'));
    refreshView();
  }

  buildBar();
  canvas.hidden = true; side.hidden = true;
  fill(host, bar, h('div', { class: 'map-main' }, h('div', { class: 'map-stage' }, empty, canvas), side), h('div', { class: 'map-status' }, status.state, status.hint, status.at));
  refresh();
  host.editor = { get view() { return view; }, get doc() { return doc; } };   // (for looking at it from the browser's console)
  return {
    unsaved: () => !!doc?.changed,
    show() {
      if (!view) return;
      for (const file of ['String/Npc.img', 'String/Map.img', 'Map/Obj/custom.img', 'Map/Back/custom.img']) view.assets.jsonCache.delete(file);
      strings = {};
      if (doc) view.rebuild().then(async () => { for (const kind of ['Npc', 'Mob']) strings[kind] ??= await view.assets.json(`String/${kind}.img`); inspect(view.item()); });
    },
  };
}
