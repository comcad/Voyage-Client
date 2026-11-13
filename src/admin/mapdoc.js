/**
 * A map being edited: its tree exactly as the file has it (so it saves and exports as one), with what the editor
 * does to it. Nothing here draws or touches the page.
 *
 * What a map holds, by where it is in the tree:
 *   life/<n>                        an NPC ("n") or a monster's spawn ("m"), standing on foothold fh at (x, cy)
 *   portal/<n>                      a portal: its name pn, its type pt, where it leads (map tm, portal tn)
 *   foothold/<layer>/<group>/<id>   a piece of ground from (x1, y1) to (x2, y2), chained to prev and next by id
 *   ladderRope/<n>                  a ladder (l = 1) or a rope at x from y1 down to y2
 *   seat/<n>                        a seat, as [x, y]
 *   reactor/<n>                     a reactor
 *   <layer>/obj/<n>, <layer>/tile/<n>   the scenery of layers 0 to 7 (a layer's tiles all come from its info/tS)
 *   back/<n>                        a background
 *   info                            the map's own settings
 */

export const KINDS = {
  life: 'NPC or monster', portal: 'Portal', foothold: 'Foothold', rope: 'Ladder or rope', seat: 'Seat', reactor: 'Reactor', obj: 'Object', tile: 'Tile', back: 'Background',
};
/** The kinds the "game data" side of the editor works on, and the scenery side. */
export const DATA_KINDS = ['life', 'portal', 'reactor', 'seat', 'rope', 'foothold'], SCENERY_KINDS = ['obj', 'tile'];
/** A portal's type, as the map editor's own art names them (MapHelper.img/portal/editor), by pt. */
export const PORTAL_TYPES = ['sp', 'pi', 'pv', 'pc', 'pg', 'pgi', 'tp', 'ps', 'psi', 'pcs', 'ph', 'psh', 'pcj', 'pci', 'pcig'];
export const PORTAL_NOTES = { 0: 'where players arrive', 1: 'invisible', 2: 'visible', 6: 'where a town portal opens', 7: 'runs a script', 8: 'script, invisible', 9: 'script, by touching it', 10: 'hidden until you are near', 11: 'hidden, with a script' };
export const NO_MAP = 999999999;

/** The fields a new one starts with, and what else it may have (offered under "Add a field"). */
export const FIELDS = {
  life: { more: ['mobTime', 'hide', 'team', 'limitedname'] },
  portal: { more: ['script', 'delay', 'hideTooltip', 'onlyOnce', 'horizontalImpact', 'verticalImpact', 'image', 'hRange', 'vRange'] },
  foothold: { more: ['forbidFallDown', 'cantThrough', 'force'] },
  rope: { more: [] },
  reactor: { more: ['reactorTime', 'name'] },
  obj: { more: ['r', 'name', 'tags', 'hide', 'flow', 'rx', 'ry', 'cx', 'cy', 'force', 'forbidFallDown', 'reactor'] },
  tile: { more: [] },
  back: { more: [] },
  info: { more: ['fieldLimit', 'swim', 'fly', 'VRTop', 'VRLeft', 'VRBottom', 'VRRight', 'VRLimit', 'onFirstUserEnter', 'onUserEnter', 'fieldType', 'noMapCmd', 'timeLimit', 'lvLimit', 'lvForceMove', 'decHP', 'protectItem',
    'fixedMobCapacity', 'createMobInterval', 'dropExpire', 'partyOnly', 'personalShop', 'everlast', 'recovery', 'fs', 'link', 'effect', 'miniMapOnOff', 'autoLieDetector', 'timeOut', 'reactorShuffle'] },
};
/** The fields that are words, not numbers, when one is added. */
const WORDS = new Set(['script', 'image', 'name', 'tags', 'limitedname', 'onFirstUserEnter', 'onUserEnter', 'effect', 'bgm', 'mapDesc', 'mapMark', 'bS', 'oS', 'l0', 'l1', 'l2', 'u', 'pn', 'tn', 'id', 'type']);
export const isWord = (key) => WORDS.has(key);
/** What a field is, in a few words (the property panel's hints). */
export const HINTS = {
  type: 'n: an NPC. m: a monster’s spawn.', id: 'Which NPC, monster or reactor.', cy: 'The height of the ground it stands on.', fh: 'The foothold it stands on (0: none).',
  rx0: 'How far left it may walk.', rx1: 'How far right it may walk.', f: '1: turned to face the other way.', mobTime: 'Seconds before a monster comes back (0: the server’s usual; -1: never).', hide: '1: not shown.',
  pn: 'The portal’s name: what other maps lead to (tn).', pt: 'The kind of portal.', tm: `The map it leads to (${NO_MAP}: nowhere).`, tn: 'The name of the portal it leads to on that map.', script: 'The script the server runs for it.',
  x1: 'Where it starts.', x2: 'Where it ends.', prev: 'The foothold before it (0: none).', next: 'The foothold after it (0: none).',
  l: '1: a ladder. 0: a rope.', uf: '1: you can climb off the top.', page: 'The layer it belongs to.', y1: 'Its top.', y2: 'Its bottom.',
  z: 'Its order among the layer’s objects.', zM: 'Its order among pieces that overlap.', u: 'The kind of piece.', no: 'Which piece of that kind.',
  bS: 'The background set.', rx: 'How it moves with the view, across.', ry: 'How it moves with the view, up and down.', cx: 'How far apart copies are, across (0: its own width).', cy_back: '', a: 'How solid it is (255: fully).',
  front: '1: in front of everything.', ani: '1: animated (from the set’s ani).', returnMap: 'Where you go when you die or use a return scroll.', forcedReturn: `Where you are put when you log in here (${NO_MAP}: here).`,
  mobRate: 'How fast monsters come back.', bgm: 'The music, as Bgm00/GoPicnic.', town: '1: a town.', fieldLimit: 'What can’t be done here (a sum of flags).', mapMark: 'The mark shown by the minimap.',
  VRLeft: 'The left edge of what the view may show.', VRRight: 'The right edge.', VRTop: 'The top edge.', VRBottom: 'The bottom edge.', swim: '1: everyone swims.', hideMinimap: '1: no minimap.',
  reactorTime: 'Seconds before it comes back.',
};

const entries = (o) => (o && typeof o === 'object' ? Object.entries(o).filter(([k, v]) => !k.startsWith('_') && v !== null && typeof v === 'object') : []);
/** The next free number among a node's children. */
export const nextKey = (o) => String(Object.keys(o || {}).reduce((m, k) => (/^\d+$/.test(k) ? Math.max(m, Number(k) + 1) : m), 0));

export class MapDoc {
  constructor({ id, tree, name }) {
    this.id = id; this.tree = tree; this.name = { streetName: name?.streetName || '', mapName: name?.mapName || '' };
    this.past = []; this.future = []; this.changed = false;
  }
  /** Before a change: what it was, kept for undo. */
  mark() {
    this.past.push(JSON.stringify({ tree: this.tree, name: this.name }));
    if (this.past.length > 80) this.past.shift();
    this.future.length = 0; this.changed = true;
  }
  /** Takes back the mark just made (a drag that went nowhere). */
  unmark() { this.past.pop(); }
  undo() { return this.swap(this.past, this.future); }
  redo() { return this.swap(this.future, this.past); }
  swap(from, to) {
    if (!from.length) return false;
    to.push(JSON.stringify({ tree: this.tree, name: this.name }));
    const was = JSON.parse(from.pop());
    this.tree = was.tree; this.name = was.name; this.changed = true;
    return true;
  }
  at(path) { let n = this.tree; for (const k of path) n = n?.[k]; return n; }

  // ---------------------------------------------------------------- what is on the map
  /** Every foothold: { id, layer, group, n }. */
  footholds() {
    const out = [];
    for (const [layer, groups] of entries(this.tree.foothold)) for (const [group, list] of entries(groups)) for (const [id, n] of entries(list)) out.push({ id: Number(id), layer, group, n, path: ['foothold', layer, group, id] });
    return out;
  }
  /** The ground under (x, y): the highest foothold at or below it (a few pixels of give), as { id, y }; null over nothing. */
  groundBelow(x, y) {
    let best = null;
    for (const f of this.footholds()) {
      const { x1, y1, x2, y2 } = f.n;
      if (x1 === x2 || x < Math.min(x1, x2) || x > Math.max(x1, x2)) continue;
      const fy = y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
      if (fy >= y - 12 && (!best || fy < best.y)) best = { id: f.id, y: Math.round(fy), layer: Number(f.layer) };
    }
    return best;
  }
  /**
   * The things the editor can pick, each { kind, path, n, x, y } (and x2, y2 for what has two ends). `sizes` gives
   * a picture's place round its point ({ l, t, r, b }, from the art) for objects, tiles, reactors and life; without
   * it they get a box of a usual size.
   */
  items(sizes = () => null) {
    const out = [], t = this.tree;
    const boxed = (it, fallback) => { const s = sizes(it) || fallback; it.box = { l: it.x + s.l, t: it.y + s.t, r: it.x + s.r, b: it.y + s.b }; return it; };
    for (const [k, n] of entries(t.life)) out.push(boxed({ kind: 'life', path: ['life', k], n, x: Number(n.x) || 0, y: Number(n.cy ?? n.y) || 0 }, { l: -22, t: -66, r: 22, b: 0 }));
    for (const [k, n] of entries(t.portal)) out.push(boxed({ kind: 'portal', path: ['portal', k], n, x: Number(n.x) || 0, y: Number(n.y) || 0 }, { l: -19, t: -50, r: 19, b: 0 }));
    for (const [k, n] of entries(t.reactor)) out.push(boxed({ kind: 'reactor', path: ['reactor', k], n, x: Number(n.x) || 0, y: Number(n.y) || 0 }, { l: -22, t: -44, r: 22, b: 0 }));
    for (const [k, n] of Object.entries(t.seat || {})) if (!k.startsWith('_') && Array.isArray(n)) out.push(boxed({ kind: 'seat', path: ['seat', k], n, x: n[0], y: n[1] }, { l: -9, t: -9, r: 9, b: 9 }));
    for (const [k, n] of entries(t.ladderRope)) out.push({ kind: 'rope', path: ['ladderRope', k], n, x: n.x, y: n.y1, x2: n.x, y2: n.y2, box: { l: n.x - 7, t: Math.min(n.y1, n.y2), r: n.x + 7, b: Math.max(n.y1, n.y2) } });
    for (const f of this.footholds()) out.push({ kind: 'foothold', path: f.path, n: f.n, x: f.n.x1, y: f.n.y1, x2: f.n.x2, y2: f.n.y2, box: { l: Math.min(f.n.x1, f.n.x2), t: Math.min(f.n.y1, f.n.y2), r: Math.max(f.n.x1, f.n.x2), b: Math.max(f.n.y1, f.n.y2) } });
    for (let l = 0; l < 8; l++) {
      for (const [k, n] of entries(t[l]?.obj)) out.push(boxed({ kind: 'obj', path: [String(l), 'obj', k], n, x: Number(n.x) || 0, y: Number(n.y) || 0, layer: l }, { l: -20, t: -20, r: 20, b: 20 }));
      for (const [k, n] of entries(t[l]?.tile)) out.push(boxed({ kind: 'tile', path: [String(l), 'tile', k], n, x: Number(n.x) || 0, y: Number(n.y) || 0, layer: l }, { l: 0, t: 0, r: 90, b: 60 }));
    }
    for (const [k, n] of entries(t.back)) out.push({ kind: 'back', path: ['back', k], n, x: Number(n.x) || 0, y: Number(n.y) || 0, box: null });
    return out;
  }
  /** The stretch the map covers: the view's limits where the map gives them, else round its footholds. */
  bounds() {
    const i = this.tree.info || {};
    if (Number.isFinite(i.VRLeft) && Number.isFinite(i.VRRight) && i.VRRight > i.VRLeft) return { l: i.VRLeft, t: i.VRTop, r: i.VRRight, b: i.VRBottom };
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const f of this.footholds()) { l = Math.min(l, f.n.x1, f.n.x2); r = Math.max(r, f.n.x1, f.n.x2); t = Math.min(t, f.n.y1, f.n.y2); b = Math.max(b, f.n.y1, f.n.y2); }
    return Number.isFinite(l) ? { l: l - 100, t: t - 400, r: r + 100, b: b + 150 } : { l: -400, t: -300, r: 400, b: 300 };
  }

  // ---------------------------------------------------------------- changes (the caller marks first)
  /** Moves an item by (dx, dy); `end` 1 or 2 moves one end of a foothold or a rope. What is joined to it comes along. */
  move(it, dx, dy, end = 0) {
    const n = it.n;
    if (it.kind === 'seat') { n[0] += dx; n[1] += dy; }
    else if (it.kind === 'rope') {
      if (end !== 2) n.y1 += dy;
      if (end !== 1) n.y2 += dy;
      n.x += dx;
    } else if (it.kind === 'foothold') {
      const all = new Map(this.footholds().map((f) => [f.id, f.n]));
      if (end !== 2) { const p = all.get(n.prev); if (p && p.x2 === n.x1 && p.y2 === n.y1) { p.x2 += dx; p.y2 += dy; } n.x1 += dx; n.y1 += dy; }
      if (end !== 1) { const q = all.get(n.next); if (q && q.x1 === n.x2 && q.y1 === n.y2) { q.x1 += dx; q.y1 += dy; } n.x2 += dx; n.y2 += dy; }
    } else if (it.kind === 'life') {
      n.x += dx; n.y += dy; n.cy = (Number(n.cy) || 0) + dy;
      if (Number.isFinite(n.rx0)) n.rx0 += dx;
      if (Number.isFinite(n.rx1)) n.rx1 += dx;
    } else { n.x = (Number(n.x) || 0) + dx; n.y = (Number(n.y) || 0) + dy; }
  }
  /** Stands an NPC or a monster on the ground under it (its foothold and height). */
  settle(n) {
    const g = this.groundBelow(n.x, Number(n.cy ?? n.y) || 0);
    if (!g) { n.fh = 0; return false; }
    n.cy = g.y; n.y = g.y; n.fh = g.id;
    return true;
  }
  remove(it) {
    const parent = this.at(it.path.slice(0, -1)), key = it.path[it.path.length - 1];
    if (!parent) return;
    if (it.kind === 'foothold') {
      const id = Number(key);
      for (const f of this.footholds()) { if (f.n.prev === id) f.n.prev = 0; if (f.n.next === id) f.n.next = 0; }
      for (const [, n] of entries(this.tree.life)) if (n.fh === id) n.fh = 0;
    }
    delete parent[key];
    if (Array.isArray(parent._order)) parent._order = parent._order.filter((k) => String(k) !== key);
    // (a group or a layer of footholds left empty goes with its last piece)
    if (it.kind === 'foothold') {
      const [, layer, group] = it.path, groups = this.tree.foothold[layer];
      if (groups && !entries(groups[group]).length) delete groups[group];
    }
  }
  /** Adds a node under `path` (made where it is missing) at the next free number; returns its path. */
  add(path, node) {
    let parent = this.tree;
    for (const k of path) parent = (parent[k] ??= {});
    const key = nextKey(parent);
    parent[key] = node;
    return [...path, key];
  }
  addLife(type, id, x, y) {
    const n = { type, id: String(id), x: Math.round(x), y: Math.round(y), mobTime: 0, f: 0, hide: 0, fh: 0, cy: Math.round(y), rx0: Math.round(x) - 50, rx1: Math.round(x) + 50 };
    this.settle(n);
    return this.add(['life'], n);
  }
  addPortal(x, y) {
    const names = new Set(entries(this.tree.portal).map(([, p]) => p.pn));
    let i = 0; while (names.has(`p${String(i).padStart(2, '0')}`)) i++;
    return this.add(['portal'], { pn: `p${String(i).padStart(2, '0')}`, pt: 2, x: Math.round(x), y: Math.round(y), tm: NO_MAP, tn: '' });
  }
  addSpawn(x, y) { return this.add(['portal'], { pn: 'sp', pt: 0, x: Math.round(x), y: Math.round(y), tm: NO_MAP, tn: '' }); }
  addSeat(x, y) { return this.add(['seat'], [Math.round(x), Math.round(y)]); }
  addRope(x, y1, y2, ladder, page) { return this.add(['ladderRope'], { l: ladder ? 1 : 0, uf: 1, x: Math.round(x), y1: Math.round(Math.min(y1, y2)), y2: Math.round(Math.max(y1, y2)), page }); }
  addReactor(id, x, y) { return this.add(['reactor'], { id: String(id), x: Math.round(x), y: Math.round(y), reactorTime: 0, f: 0, name: '' }); }
  addObj(layer, pick, x, y) {
    const z = entries(this.tree[layer]?.obj).reduce((m, [, o]) => Math.max(m, Number(o.z) || 0), 0);
    return this.add([String(layer), 'obj'], { oS: pick.oS, l0: pick.l0, l1: pick.l1, l2: pick.l2, x: Math.round(x), y: Math.round(y), z, f: 0, zM: 0 });
  }
  addTile(layer, pick, x, y) {
    ((this.tree[layer] ??= {}).info ??= {}).tS = pick.tS;
    return this.add([String(layer), 'tile'], { x: Math.round(x), y: Math.round(y), u: pick.u, no: Number(pick.no), zM: 0 });
  }
  addBack(bS, no) { return this.add(['back'], { no: Number(no) || 0, x: 0, y: 0, rx: 0, ry: 0, type: 0, cx: 0, cy: 0, bS, a: 255, front: 0, ani: 0, f: 0 }); }
  /** A run of footholds through these points, in order, as a new group of `layer`; returns the paths. */
  addFootholds(layer, points) {
    if (points.length < 2) return [];
    const all = this.footholds(), groups = ((this.tree.foothold ??= {})[layer] ??= {});
    let id = all.reduce((m, f) => Math.max(m, f.id), 0) + 1;
    const group = nextKey(groups) === '0' ? '1' : nextKey(groups), list = (groups[group] = {}), out = [];
    for (let i = 0; i + 1 < points.length; i++, id++) {
      list[id] = { x1: Math.round(points[i].x), y1: Math.round(points[i].y), x2: Math.round(points[i + 1].x), y2: Math.round(points[i + 1].y), prev: i ? id - 1 : 0, next: i + 2 < points.length ? id + 1 : 0 };
      out.push(['foothold', String(layer), group, String(id)]);
    }
    return out;
  }
  /** A copy of an item, a little to the side; returns its path (footholds aren't copied: draw a new run). */
  duplicate(it) {
    if (it.kind === 'foothold') return null;
    const copy = JSON.parse(JSON.stringify(it.n));
    if (it.kind === 'seat') { copy[0] += 30; return this.add(['seat'], copy); }
    copy.x = (Number(copy.x) || 0) + 30;
    if (it.kind === 'life') { if (Number.isFinite(copy.rx0)) copy.rx0 += 30; if (Number.isFinite(copy.rx1)) copy.rx1 += 30; this.settle(copy); }
    if (it.kind === 'portal' && copy.pt !== 0) copy.pn = `${copy.pn}_copy`;
    return this.add(it.path.slice(0, -1), copy);
  }

  // ---------------------------------------------------------------- is it fit to play on?
  /** What would go wrong on this map: [{ bad (the server can't load it, or nobody can get in), text, path }]. */
  problems() {
    const out = [], t = this.tree, fhs = this.footholds(), ids = new Set(fhs.map((f) => f.id));
    if (!t.info || typeof t.info !== 'object') out.push({ bad: true, text: 'The map has no info.' });
    if (!fhs.length) out.push({ bad: true, text: 'There is no ground: the map needs at least one foothold.' });
    if (!t.portal || !entries(t.portal).some(([, p]) => p.pt === 0)) out.push({ bad: true, text: 'There is no place to arrive: add a portal of type 0 (sp).' });
    if (t.info && !Number.isFinite(t.info.returnMap)) out.push({ bad: true, text: 'info has no returnMap.' });
    if (!t.miniMap && !(Number.isFinite(t.info?.VRLeft) && t.info.VRRight > t.info.VRLeft)) out.push({ bad: false, text: 'The map has neither view limits (VRLeft, VRRight, VRTop, VRBottom) nor a minimap, so the server can’t tell how big it is.' });
    const dup = new Set();
    for (const f of fhs) { if (dup.has(f.id)) out.push({ bad: true, text: `Two footholds are numbered ${f.id}.`, path: f.path }); dup.add(f.id); }
    for (const f of fhs) {
      if (f.n.x1 === f.n.x2 && f.n.y1 === f.n.y2) out.push({ bad: false, text: `Foothold ${f.id} has no length.`, path: f.path });
      for (const k of ['prev', 'next']) if (f.n[k] && !ids.has(f.n[k])) out.push({ bad: false, text: `Foothold ${f.id}’s ${k} is ${f.n[k]}, which isn’t there.`, path: f.path });
    }
    for (const [k, n] of entries(t.life)) {
      if (!/^\d+$/.test(String(n.id))) out.push({ bad: true, text: `Life ${k} has no id.`, path: ['life', k] });
      if (!ids.has(n.fh)) out.push({ bad: false, text: `${n.type === 'm' ? 'Monster' : 'NPC'} ${n.id} (life ${k}) stands on no foothold.`, path: ['life', k] });
      for (const f of ['x', 'y', 'cy', 'fh', 'rx0', 'rx1']) if (!Number.isFinite(n[f])) { out.push({ bad: true, text: `Life ${k} has no ${f}: the server needs it.`, path: ['life', k] }); break; }
    }
    const names = new Map();
    for (const [k, p] of entries(t.portal)) {
      if (p.pt !== 0 && p.pt !== 6) { if (names.has(p.pn)) out.push({ bad: false, text: `Two portals are named ${p.pn}.`, path: ['portal', k] }); names.set(p.pn, k); }
      for (const f of ['pt', 'x', 'y', 'tm']) if (!Number.isFinite(p[f])) { out.push({ bad: true, text: `Portal ${k} has no ${f}: the server needs it.`, path: ['portal', k] }); break; }
    }
    return out;
  }
}

/** A map with nothing on it but a stretch of ground and a place to arrive. */
export function blankMap(id, width = 1600, height = 800) {
  const w = Math.max(400, Math.round(width / 2)), tree = {};
  for (let l = 0; l < 8; l++) tree[l] = { info: {}, tile: {}, obj: {} };
  Object.assign(tree, {
    info: { version: 10, cloud: 0, town: 0, returnMap: id, forcedReturn: NO_MAP, mobRate: 1, bgm: 'Bgm00/GoPicnic', mapDesc: '', hideMinimap: 0, moveLimit: 0, mapMark: 'None', fieldLimit: 0,
      VRTop: -Math.round(height) + 150, VRLeft: -w, VRBottom: 150, VRRight: w },
    back: {}, life: {}, reactor: {},
    foothold: { 0: { 1: { 1: { x1: -w + 50, y1: 0, x2: w - 50, y2: 0, prev: 0, next: 0 } } } },
    ladderRope: {},
    portal: { 0: { pn: 'sp', pt: 0, x: 0, y: -10, tm: NO_MAP, tn: '' } },
  });
  return tree;
}
