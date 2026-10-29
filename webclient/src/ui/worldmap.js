import { sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';

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
const CUR_FRAME_MS = 150;

export class WorldMapWin extends Win {
  constructor(mgr) {
    super(mgr, null, Math.round((800 - W) / 2), Math.round((600 - H) / 2));
    this.w = W; this.h = H;
    this.closeBtn.x = W - 40; this.closeBtn.y = 9;
    this.F = mgr.W.WorldMap;
    this.name = null; this.data = null; this.hover = null;
    mgr.assets.json('Map/MapHelper.img').then((h) => { this.helper = h?.worldMap; mgr.assets.preload(allCanvases(this.helper)); });
    mgr.assets.json('String/Map.img').then((s) => { this.strMap = s; });
  }
  frames() { return [...super.frames(), this.F.title, ...allCanvases(this.F.Border)]; }

  // ---------------------------------------------------------------- which map to show
  /** Opening shows the most detailed world map that lists the map you are on. */
  async onOpen() {
    const here = this.g.map?.id;
    if (this.foundFor !== here) { this.foundFor = here; this.show((await this.find(here)) || 'WorldMap'); }
  }
  async find(id) {
    let best = null, depth = -1;
    const seen = new Set(), queue = [['WorldMap', 0]];
    while (queue.length) {
      const [name, d] = queue.shift();
      if (seen.has(name)) continue;
      seen.add(name);
      const data = await this.load(name);
      if (!data) continue;
      if (d > depth && this.spotOf(data, id)) { best = name; depth = d; }
      for (const l of Object.values(data.MapLink || {})) if (l?.link?.linkMap) queue.push([l.link.linkMap, d + 1]);
    }
    return best;
  }
  load(name) { return this.mgr.assets.json(`Map/WorldMap/${name}.img`); }
  async show(name) {
    const data = await this.load(name);
    if (!data) return;
    await this.mgr.assets.preload(allCanvases(data));
    this.name = name; this.data = data; this.hover = null;
    this.mgr.tip = null;                    // the old view's tooltip until the mouse moves again
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
    for (const s of Object.values(d.MapList || {})) if (s?.spot) draw(H2.mapImage?.[s.type], cx + s.spot[0], cy + s.spot[1]);
    // party members elsewhere on this channel, then you (both bob through 4 frames)
    const f = Math.floor(performance.now() / CUR_FRAME_MS) % 4;
    for (const pm of this.g.party?.members || []) {
      if (pm.id === this.g.player.id || pm.channel !== this.g.channel) continue;
      const s = this.spotOf(d, pm.map);
      if (s) draw(H2.partyPos?.[f], cx + s.spot[0], cy + s.spot[1]);
    }
    const me = this.spotOf(d, this.g.map?.id);
    if (me) draw(H2.curPos?.[f], cx + me.spot[0], cy + me.spot[1]);
  }

  // ---------------------------------------------------------------- mouse
  pick(lx, ly) {
    const d = this.data;
    if (!d) return null;
    const [cx, cy] = this.centre;
    let spot = null, best = 11 * 11;
    for (const s of Object.values(d.MapList || {})) {
      if (!s?.spot) continue;
      const dd = (lx - cx - s.spot[0]) ** 2 + (ly - cy - s.spot[1]) ** 2;
      if (dd < best) { best = dd; spot = s; }
    }
    if (spot) return { spot };
    // regions: the smallest highlight under the cursor that is opaque there
    let link = null, area = Infinity;
    for (const l of Object.values(d.MapLink || {})) {
      const n = l?.link?.linkImg;
      if (!n) continue;
      const [x, y] = this.at(n, cx, cy);
      if (lx < x || ly < y || lx >= x + n._w || ly >= y + n._h || !this.opaque(n, lx - x, ly - y)) continue;
      if (n._w * n._h < area) { area = n._w * n._h; link = l; }
    }
    return link ? { link } : null;
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
  move(lx, ly) { this.hover = this.pick(lx, ly); }
  down(lx, ly) {
    const p = this.pick(lx, ly);
    if (p?.link?.link?.linkMap) { sfx.play('UI/BtMouseClick'); this.show(p.link.link.linkMap); }
  }
  tooltip(lx, ly) {
    const p = this.pick(lx, ly);
    if (p?.link) return { title: p.link.toolTip || '', lines: [] };
    if (!p?.spot) return null;
    const s = p.spot, first = Object.values(s.mapNo || {})[0];
    let title = s.title, street = '';
    if (!title) for (const r of Object.values(this.strMap || {})) if (r?.[first]) { title = r[first].mapName; street = r[first].streetName; break; }
    return { title: title || '', lines: [street, s.desc].filter(Boolean) };
  }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
}
