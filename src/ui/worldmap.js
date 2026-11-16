import { sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';
import { UI_W, UI_H } from '../view.js';

/**
 * The world map. UI/UIWindow.img/WorldMap is only a frame: Border 0-7 (corners 7px, a 33px title
 * bar, an 18px foot) and the "WORLD MAP" title at (10, 10). Inside sits a Map/WorldMap/WorldMapXXX.img:
 *   BaseImg/0 (640x470, origin at its centre), placed at (7, 33)
 *   MapList: spot (relative to the centre), type (Map/MapHelper.img/worldMap/mapImage/<type>), mapNo[],
 *     title / desc, and a path image shown while the spot is hovered
 *   MapLink: linkImg, a highlight over a region that opens linkMap; info/parentMap is one level up
 * Everything is drawn at centre + spot (or centre - origin). Right-click goes back up a level.
 */
const BX = 7, BY = 33, W = 654, H = 521;
const CUR_FRAME_MS = 180;   // curPos / partyPos / lovePos: 4 frames of 180ms each (MapHelper.img)
/** Client text markup off a plain-text tooltip: "#cHenesys Pig Farm#." -> "Henesys Pig Farm." (codes: colours b r g d k c, bold e/n). */
const plain = (t) => String(t).replace(/#[brgdkcne]/g, '').replace(/#/g, '');

export class WorldMapWin extends Win {
  constructor(mgr) {
    super(mgr, null, Math.round((UI_W - W) / 2), Math.round((UI_H - H) / 2));
    this.w = W; this.h = H;
    this.openSound = 'UI/WorldmapOpen'; this.closeSound = 'UI/WorldmapClose';
    this.closeBtn.x = W - 20; this.closeBtn.y = 10; this.closePinned = true;   // the frame's 33px title bar
    this.F = mgr.W.WorldMap;
    this.name = null; this.data = null; this.hover = null;
    this.spots = []; this.links = []; this.npcSpots = [];   // the map's static parts, built once per show()
    this.walked = null; this.finds = new Map();             // the WorldMap graph, and the lookup into it
    mgr.assets.json('Map/MapHelper.img').then((h) => { this.helper = h?.worldMap; mgr.assets.preload(allCanvases(this.helper)); this.build(); });
    mgr.assets.json('String/Map.img').then((s) => { this.strMap = s; });
  }
  frames() { return [...super.frames(), this.F.title, ...allCanvases(this.F.Border)]; }

  // ---------------------------------------------------------------- which map to show
  /** Opening shows the most detailed world map that lists the map you are on. */
  async onOpen() {
    const here = this.g.map?.id;
    if (this.foundFor !== here) { this.foundFor = here; this.show((await this.find(here))?.name || 'WorldMap'); }
  }
  /**
   * The most detailed world map that lists `id`, as { name, depth }, or null. The graph is walked once per window and
   * each answer is memoised, so the status bar's availability probe and the open share the one walk.
   */
  async find(id) {
    if (this.finds.has(id)) return this.finds.get(id);
    await this.walk();
    let best = null;
    for (const e of this.walked) if (this.spotOf(e.data, id) && (!best || e.depth > best.depth)) best = e;
    const r = best ? { name: best.name, depth: best.depth } : null;
    this.finds.set(id, r);
    return r;
  }
  /** BFS over MapLink[].link.linkMap from WorldMap: [{ name, data, depth }]. The JSON layer caches the files. */
  async walk() {
    if (this.walked) return this.walked;
    const out = [], seen = new Set(), queue = [['WorldMap', 0]];
    while (queue.length) {
      const [name, depth] = queue.shift();
      if (seen.has(name)) continue;
      seen.add(name);
      const data = await this.load(name);
      if (!data) continue;
      out.push({ name, data, depth });
      for (const l of Object.values(data.MapLink || {})) if (l?.link?.linkMap) queue.push([l.link.linkMap, depth + 1]);
    }
    this.walked = out;
    return out;
  }
  load(name) { return this.mgr.assets.json(`Map/WorldMap/${name}.img`); }
  /**
   * Mark NPC (the quest log): a world map of its own, over everything until it is closed, on the most detailed world
   * map that lists one of the NPC's maps, with MapHelper.img/worldMap/npcPos<spot type> pulsing on every spot that
   * holds one. False when no world map lists any of them.
   */
  static async searchNpc(mgr, maps) {
    const w = new WorldMapWin(mgr);
    // every one of the NPC's maps, not the first that hits: the deepest world map wins, whichever order `maps` is in
    let name = null, depth = -1;
    const seen = new Set();
    for (const id of maps) {
      if (seen.has(id)) continue;
      seen.add(id);
      const f = await w.find(id);
      if (f && f.depth > depth) { name = f.name; depth = f.depth; }
    }
    if (!name) return false;
    w.modal = true; w.npcMaps = new Set(maps);
    await w.show(name);
    mgr.show(w, w.openSound);
    return true;
  }
  async show(name) {
    const data = await this.load(name);
    if (!data) { this.hover = null; return; }
    await this.mgr.assets.preload(allCanvases(data));
    this.name = name; this.data = data; this.hover = null;
    this.build();
    this.mgr.tip = null;                    // the old view's tooltip until the mouse moves again
  }
  /** The map's static parts, once per show(): the spots, the link regions and the spots the marked NPC sits on. */
  build() {
    const d = this.data, art = this.helper?.mapImage;
    // a spot with no art for its type is not drawn, so it must not be hoverable either; until the helper lands, keep all
    this.spots = Object.values(d?.MapList || {}).filter((s) => s?.spot && (!art || art[s.type]));
    this.links = Object.values(d?.MapLink || {}).filter((l) => l?.link?.linkImg);
    this.npcSpots = this.npcMaps ? this.spots.filter((s) => Object.values(s.mapNo || {}).some((no) => this.npcMaps.has(no))) : [];
    this._pick = null;
  }
  spotOf(data, id) {
    for (const s of Object.values(data?.MapList || {})) if (s?.spot && Object.values(s.mapNo || {}).includes(id)) return s;
    return null;
  }
  back() { const p = this.data?.info?.parentMap; if (p) { sfx.play('UI/BtMouseClick'); this.show(p); } }
  rclick() { this.back(); }

  // ---------------------------------------------------------------- frame
  get centre() { const o = this.data?.BaseImg?.[0]?.origin || [320, 235]; return [BX + o[0], BY + o[1]]; }
  at(node, x, y) { const o = node?.origin || [0, 0]; return [Math.round(x - o[0]), Math.round(y - o[1])]; }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), B = this.F.Border, b = (i) => im(B[i]);
    // frame: corners, then the edges stretched between them
    if (b(0) && b(7)) {
      ctx.drawImage(b(0), 0, 0); ctx.drawImage(b(1), 7, 0, W - 14, 33); ctx.drawImage(b(2), W - 7, 0);
      ctx.drawImage(b(3), 0, 33, 7, H - 51); ctx.drawImage(b(4), W - 7, 32, 7, H - 50);
      ctx.drawImage(b(5), 0, H - 18); ctx.drawImage(b(6), 7, H - 18, W - 14, 18); ctx.drawImage(b(7), W - 7, H - 18);
    }
    if (im(this.F.title)) ctx.drawImage(im(this.F.title), 10, 10);
    const d = this.data;
    if (!d) return;
    const [cx, cy] = this.centre;
    const draw = (node, x, y) => { const i = im(node); if (i) ctx.drawImage(i, ...this.at(node, x, y)); };
    draw(d.BaseImg?.[0], cx, cy);
    if (this.hover?.link) draw(this.hover.link.link.linkImg, cx, cy);
    if (this.hover?.spot?.path) draw(this.hover.spot.path, cx, cy);
    const H2 = this.helper || {};
    for (const s of this.spots) draw(H2.mapImage?.[s.type], cx + s.spot[0], cy + s.spot[1]);
    // one mark per spot (each bobs through 4 frames): curPos where you are; else partyPos or lovePos, whichever of
    // your party members elsewhere on this channel and your spouse (NOTIFY_MARRIED_PARTNER_MAP_TRANSFER) comes last
    const f = Math.floor(performance.now() / CUR_FRAME_MS) % 4;
    const marks = [{ map: this.g.map?.id, kind: 'curPos' }];
    for (const pm of this.g.party?.members || []) if (pm.id !== this.g.player.id && pm.channel === this.g.channel) marks.push({ map: pm.map, kind: 'partyPos' });
    if (this.g.spouseMap) marks.push({ map: this.g.spouseMap, kind: 'lovePos' });   // last: it beats partyPos on a shared spot
    for (const s of this.spots) {
      let kind = null;
      for (const no of Object.values(s.mapNo || {})) for (const m of marks) if (m.map === no && kind !== 'curPos') kind = m.kind;
      if (kind) draw(H2[kind]?.[f], cx + s.spot[0], cy + s.spot[1]);
    }
    // the NPC being looked for: 7 frames, 20ms each
    if (this.npcMaps) {
      const n = Math.floor(performance.now() / 20) % 7;
      for (const s of this.npcSpots) draw(H2[`npcPos${s.type ?? 0}`]?.[n], cx + s.spot[0], cy + s.spot[1]);
    }
  }

  // ---------------------------------------------------------------- mouse
  /**
   * The link region under the cursor wins where it is opaque, so a spot inside a region cannot shadow it; only where
   * no region covers the pixel does the nearest spot within 11px count.
   */
  pick(lx, ly) {
    if (!this.data) return null;
    const [cx, cy] = this.centre;
    // regions: the smallest highlight under the cursor that is opaque there
    let link = null, area = Infinity;
    for (const l of this.links) {
      const n = l.link.linkImg;
      if (n._w == null || n._h == null) continue;   // art not decoded: no bounds to test, and opaque() would say false
      const [x, y] = this.at(n, cx, cy);
      if (lx < x || ly < y || lx >= x + n._w || ly >= y + n._h || !this.opaque(n, lx - x, ly - y)) continue;
      if (n._w * n._h < area) { area = n._w * n._h; link = l; }
    }
    if (link) return { link };
    let spot = null, best = 11 * 11;
    for (const s of this.spots) {
      const dd = (lx - cx - s.spot[0]) ** 2 + (ly - cy - s.spot[1]) ** 2;
      if (dd < best) { best = dd; spot = s; }
    }
    return spot ? { spot } : null;
  }
  opaque(node, x, y) {
    const img = this.mgr.image(node);
    if (!img) return false;
    let c = (this.alpha ??= new Map()).get(node._canvas);
    if (!c) {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      c = g.getImageData(0, 0, img.width, img.height).data; this.alpha.set(node._canvas, c);
    }
    return c[(Math.floor(y) * img.width + Math.floor(x)) * 4 + 3] > 16;
  }
  /** The pick at a pointer position, cached: the manager calls move() and tooltip() with the same point. */
  pickAt(lx, ly) {
    const c = this._pick;
    if (c && c.x === lx && c.y === ly) return c.p;
    const p = this.pick(lx, ly);
    this._pick = { x: lx, y: ly, p };
    return p;
  }
  move(lx, ly) { this.hover = this.pickAt(lx, ly); }
  down(lx, ly) {
    const p = this.pickAt(lx, ly);
    if (p?.link?.link?.linkMap) { sfx.play('UI/BtMouseClick'); this.show(p.link.link.linkMap); }
  }
  tooltip(lx, ly) {
    const p = this.pickAt(lx, ly);
    if (p?.link) return { title: p.link.toolTip || '', lines: [] };
    if (!p?.spot) return null;
    const s = p.spot, first = Object.values(s.mapNo || {})[0];
    let title = s.title, street = '';
    if (!title) for (const r of Object.values(this.strMap || {})) if (r?.[first]) { title = r[first].mapName; street = r[first].streetName; break; }
    // the data's desc carries client markup ("There is a portal that leads to #cHenesys Pig Farm#."), and drawTip
    // draws plain text: strip it rather than show a literal #c
    return { title: title || '', lines: [street, s.desc && plain(s.desc)].filter(Boolean) };
  }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
}
