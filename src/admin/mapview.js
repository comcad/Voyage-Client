/**
 * The map editor's canvas. The map is drawn by the game's own renderer (GameMap), from the tree as it is being
 * edited, so what is seen here is what a player gets; over it go the things a player never sees (footholds, ropes,
 * every portal, where each NPC and monster stands) and the editor's own marks. The mouse picks, drags, pans and
 * places; the wheel zooms.
 */
import { GameMap, mapPath } from '../map.js';
import { Assets, prepare, frames, isCanvas, pad } from '../assets.js';
import { DATA_KINDS, SCENERY_KINDS, PORTAL_TYPES } from './mapdoc.js';

const key = (path) => path.join('/');
const COLORS = { foothold: '#19d3f3', rope: '#ffa630', portal: '#ffffff', life: '#ff7ad9', seat: '#7dff8a', reactor: '#c9a0ff', obj: '#ffd400', tile: '#ffd400', picked: '#ffd400', bounds: '#ff5d5d' };
const GRID = 30;

export class MapView {
  constructor(canvas, hooks) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hooks = hooks;
    this.assets = new Assets('/assets');
    this.doc = null; this.map = null; this.items = []; this.sizes = new Map(); this.asked = new Set();
    this.cam = { x: -400, y: -300 }; this.zoom = 1; this.gen = 0;
    this.show = { backs: true, scenery: true, life: true, footholds: true, ropes: true, portals: true, seats: true, reactors: true };
    this.mode = 'data'; this.layer = -1; this.snap = false; this.animate = false;
    this.picked = null; this.tool = null; this.drag = null; this.mouse = null; this.busy = '';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.moved(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => { this.drag = null; });
    canvas.addEventListener('dblclick', () => { if (this.tool?.kind === 'footholds') this.finishFootholds(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = this.spot(e); this.zoomAt(p.x, p.y, Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * (e.ctrlKey ? 0.01 : 0.002))); }, { passive: false });
    canvas.addEventListener('keydown', (e) => this.keyed(e));
    new ResizeObserver(() => this.redraw()).observe(canvas);
    let last = 0;
    const frame = (t) => {
      requestAnimationFrame(frame);
      if (this.animate && this.map && !canvas.hidden && canvas.offsetParent) {
        const life = this.map.life;   // (monsters would wander off their spawns: only the scenery moves)
        this.map.life = []; this.map.update(Math.min(0.05, (t - last) / 1000)); this.map.life = life;
        this.dirty = true;
      }
      last = t;
      if (this.dirty) { this.dirty = false; this.draw(); }
    };
    requestAnimationFrame(frame);
  }
  redraw() { this.dirty = true; }

  // ---------------------------------------------------------------- the map
  /** A map to edit (a MapDoc); fits it to the canvas. */
  async open(doc) {
    this.doc = doc; this.picked = null; this.tool = null; this.map = null; this.items = [];
    this.helper ??= await this.assets.json('Map/MapHelper.img');
    if (this.helper?.portal?.editor) this.assets.preload(Object.values(this.helper.portal.editor).filter(isCanvas));
    await this.rebuild();
    this.fit();
  }
  /** The picture again from the tree as it is now (after every change). */
  async rebuild() {
    const doc = this.doc, gen = ++this.gen;
    if (!doc) return;
    this.listItems();
    this.busy = this.map ? '' : 'Loading the map’s pictures...';
    this.redraw();
    this.assets.jsonCache.set(mapPath(doc.id), Promise.resolve(prepare(structuredClone(doc.tree), 'Map')));
    const map = new GameMap(this.assets, doc.id);
    try { await map.load((s) => { if (gen === this.gen && !this.map) { this.busy = s; this.redraw(); } }); }
    catch (e) { if (gen === this.gen) { this.busy = `This map can’t be drawn: ${e.message}`; this.redraw(); } return; }
    if (gen !== this.gen) return;   // (changed again meanwhile: the later one is on its way)
    this.map = map; this.busy = '';
    this.listItems();
    this.redraw();
  }
  /** The things on the map again, with the sizes of their pictures that are known so far. */
  listItems() {
    this.items = this.doc.items((it) => this.sizeOf(it));
    this.byKey = new Map(this.items.map((it) => [key(it.path), it]));
  }
  item(k = this.picked) { return k ? this.byKey?.get(k) || null : null; }

  /** A picture's place round its point, once its art is known (asked for the first time it is wanted). */
  sizeOf(it) {
    const n = it.n, t = this.doc.tree;
    const art = it.kind === 'obj' ? `obj/${n.oS}/${n.l0}/${n.l1}/${n.l2}/${n.f ? 1 : 0}` : it.kind === 'tile' ? `tile/${t[it.layer]?.info?.tS}/${n.u}/${n.no}`
      : it.kind === 'life' ? `life/${n.type}/${n.id}/${n.f ? 1 : 0}` : it.kind === 'reactor' ? `reactor/${n.id}/${n.f ? 1 : 0}` : null;
    if (!art) return null;
    const have = this.sizes.get(art);
    if (have !== undefined) return have;
    if (!this.asked.has(art)) {
      this.asked.add(art);
      this.findArt(it).then((node) => {
        if (!isCanvas(node)) { this.sizes.set(art, null); return; }
        const o = node.origin || [0, 0], w = node._w || 0, h = node._h || 0, flip = !!n.f && it.kind !== 'tile';
        const l = flip ? o[0] - w : -o[0];
        this.sizes.set(art, { l, t: -o[1], r: l + w, b: h - o[1], node, flip });
        this.assets.preload([node]).then(() => this.redraw());
        if (this.doc) { this.listItems(); this.redraw(); }
      }, () => this.sizes.set(art, null));
    }
    return null;
  }
  async findArt(it) {
    const n = it.n, a = this.assets;
    if (it.kind === 'obj') { const node = (await a.json(`Map/Obj/${n.oS}.img`))?.[n.l0]?.[n.l1]?.[n.l2]; return isCanvas(node) ? node : frames(node)[0]; }
    if (it.kind === 'tile') return (await a.json(`Map/Tile/${this.doc.tree[it.layer]?.info?.tS}.img`))?.[n.u]?.[n.no];
    if (it.kind === 'reactor') {
      let src = await a.json(`Reactor/${pad(n.id, 7)}.img`);
      if (src?.info?.link) src = (await a.json(`Reactor/${pad(src.info.link, 7)}.img`)) || src;
      return frames(src?.[0])[0];
    }
    let src = await a.json(`${n.type === 'm' ? 'Mob' : 'Npc'}/${pad(n.id, 7)}.img`);
    if (src?.info?.link) src = (await a.json(`${n.type === 'm' ? 'Mob' : 'Npc'}/${pad(src.info.link, 7)}.img`)) || src;
    const act = src?.stand || src?.fly || Object.values(src || {}).find((v) => isCanvas(frames(v)[0]));
    return frames(act)[0];
  }

  // ---------------------------------------------------------------- the view
  get w() { return this.canvas.clientWidth || 1; }
  get h() { return this.canvas.clientHeight || 1; }
  /** Where on the canvas an event is (from the page's own measure: an event's offsetX isn't to be trusted on a scaled page). */
  spot(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  world(e) { const p = this.spot(e); return { x: this.cam.x + p.x / this.zoom, y: this.cam.y + p.y / this.zoom }; }
  zoomAt(px, py, k) {
    const z = Math.min(4, Math.max(0.05, this.zoom * k)), wx = this.cam.x + px / this.zoom, wy = this.cam.y + py / this.zoom;
    this.zoom = z; this.cam.x = wx - px / z; this.cam.y = wy - py / z;
    this.hooks.onView?.(); this.redraw();
  }
  /** The whole map in view. */
  fit() {
    const b = this.doc.bounds(), z = Math.min(1, (this.w - 40) / Math.max(1, b.r - b.l), (this.h - 40) / Math.max(1, b.b - b.t));
    this.zoom = Math.max(0.05, z);
    this.cam.x = (b.l + b.r) / 2 - this.w / this.zoom / 2; this.cam.y = (b.t + b.b) / 2 - this.h / this.zoom / 2;
    this.hooks.onView?.(); this.redraw();
  }
  /** Brings an item to the middle of the view and picks it. */
  goTo(path) {
    const it = this.byKey?.get(key(path));
    this.pick(path);
    if (!it || !it.box) return;
    this.cam.x = (it.box.l + it.box.r) / 2 - this.w / this.zoom / 2; this.cam.y = (it.box.t + it.box.b) / 2 - this.h / this.zoom / 2;
    this.redraw();
  }
  pick(path) {
    this.picked = path ? key(path) : null;
    this.hooks.onPick?.(this.item());
    this.redraw();
  }
  setTool(tool) { this.tool = tool; this.hooks.onTool?.(tool); this.canvas.style.cursor = tool ? 'crosshair' : ''; this.redraw(); }
  visible(kind) { return { foothold: this.show.footholds, rope: this.show.ropes, portal: this.show.portals, life: this.show.life, seat: this.show.seats, reactor: this.show.reactors, obj: this.show.scenery, tile: this.show.scenery }[kind]; }

  /** What is under a point of the map: { it, end } (end 1 or 2: an end of the picked foothold or rope). */
  hit(wx, wy) {
    const tol = 7 / this.zoom, near = (x, y) => Math.abs(wx - x) <= tol && Math.abs(wy - y) <= tol;
    const cur = this.item();
    if (cur && (cur.kind === 'foothold' || cur.kind === 'rope')) { if (near(cur.x, cur.y)) return { it: cur, end: 1 }; if (near(cur.x2, cur.y2)) return { it: cur, end: 2 }; }
    const kinds = this.mode === 'data' ? DATA_KINDS : SCENERY_KINDS;
    for (const kind of kinds) {
      if (!this.visible(kind)) continue;
      // the last drawn is on top: the highest layer first, and within it the last listed
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        if (it.kind !== kind || (it.layer !== undefined && this.layer >= 0 && it.layer !== this.layer)) continue;
        if (kind === 'foothold') {
          const dx = it.x2 - it.x, dy = it.y2 - it.y, len = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((wx - it.x) * dx + (wy - it.y) * dy) / len));
          if (Math.hypot(wx - (it.x + u * dx), wy - (it.y + u * dy)) <= tol) return { it, end: 0 };
        } else if (wx >= it.box.l - tol / 2 && wx <= it.box.r + tol / 2 && wy >= it.box.t - tol / 2 && wy <= it.box.b + tol / 2) return { it, end: 0 };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- the mouse and the keys
  down(e) {
    this.canvas.focus();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* a pointer the browser doesn't know: the drag still works over the canvas */ }
    const w = this.world(e);
    if (e.button !== 0 || e.altKey) { this.drag = { pan: true, sx: e.clientX, sy: e.clientY, cam: { ...this.cam }, far: true }; return; }
    if (this.tool) { this.toolDown(w); return; }
    const hit = this.hit(w.x, w.y);
    if (hit) { this.pick(hit.it.path); this.drag = { it: hit.it, end: hit.end, last: { x: Math.round(w.x), y: Math.round(w.y) }, far: false }; }
    else this.drag = { pan: true, sx: e.clientX, sy: e.clientY, cam: { ...this.cam }, far: false };
  }
  moved(e) {
    const w = this.world(e), d = this.drag;
    this.mouse = w;
    this.hooks.onMouse?.(Math.round(w.x), Math.round(w.y));
    if (d?.pan) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.far = true;
      this.cam.x = d.cam.x - (e.clientX - d.sx) / this.zoom; this.cam.y = d.cam.y - (e.clientY - d.sy) / this.zoom;
    } else if (d?.it) {
      const grid = this.snap && (d.it.kind === 'obj' || d.it.kind === 'tile') ? GRID : 1;
      const dx = Math.round((w.x - d.last.x) / grid) * grid, dy = Math.round((w.y - d.last.y) / grid) * grid;
      if (dx || dy) {
        if (!d.far) { this.doc.mark(); d.far = true; }
        this.doc.move(d.it, dx, dy, d.end);
        d.last = { x: d.last.x + dx, y: d.last.y + dy };
        this.listItems();
        this.hooks.onPick?.(this.item(), true);
      }
    } else if (d?.rope) d.to = w;
    this.redraw();
  }
  up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.pan) { if (!d.far && !this.tool) this.pick(null); return; }
    if (d.rope) {
      const to = this.world(e);
      if (Math.abs(to.y - d.from.y) >= 10) { this.doc.mark(); const path = this.doc.addRope(d.from.x, d.from.y, to.y, this.tool.ladder, this.tool.page); this.setTool(null); this.changed(path); }
      return;
    }
    if (d.it && d.far) {
      if (d.it.kind === 'life' && !e.shiftKey) this.doc.settle(d.it.n);   // (Shift leaves it where it was dropped)
      this.changed(d.it.path);
    }
  }
  /** After a change to the tree: everyone told, the picture made again. */
  changed(path) {
    this.listItems();
    if (path !== undefined) this.picked = path ? key(path) : null;
    this.hooks.onChange?.();
    this.hooks.onPick?.(this.item());
    this.rebuild();
  }
  toolDown(w) {
    const t = this.tool, doc = this.doc, grid = this.snap && (t.what === 'obj' || t.what === 'tile') ? GRID : 1;
    const x = Math.round(w.x / grid) * grid, y = Math.round(w.y / grid) * grid;
    if (t.kind === 'footholds') { t.points.push({ x, y }); this.redraw(); return; }
    if (t.kind === 'rope') { this.drag = { rope: true, from: { x, y }, to: { x, y } }; return; }
    doc.mark();
    let path;
    if (t.what === 'npc') path = doc.addLife('n', t.id, x, y);
    else if (t.what === 'mob') path = doc.addLife('m', t.id, x, y);
    else if (t.what === 'portal') path = doc.addPortal(x, y);
    else if (t.what === 'spawn') path = doc.addSpawn(x, y);
    else if (t.what === 'seat') path = doc.addSeat(x, y);
    else if (t.what === 'reactor') path = doc.addReactor(t.id, x, y);
    else if (t.what === 'obj') path = doc.addObj(t.layer, t.pick, x, y);
    else if (t.what === 'tile') path = doc.addTile(t.layer, t.pick, x, y);
    if (!t.again) this.setTool(null);
    this.changed(path);
  }
  finishFootholds() {
    const t = this.tool;
    if (t?.kind !== 'footholds') return;
    // (a double click adds its point twice)
    const pts = t.points.filter((p, i) => !i || p.x !== t.points[i - 1].x || p.y !== t.points[i - 1].y);
    this.setTool(null);
    if (pts.length < 2) return;
    this.doc.mark();
    const paths = this.doc.addFootholds(t.layer, pts);
    this.changed(paths[0]);
  }
  keyed(e) {
    const it = this.item(), mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { if (this.tool) this.setTool(null); else this.pick(null); }
    else if (e.key === 'Enter' && this.tool?.kind === 'footholds') this.finishFootholds();
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); this.hooks.onUndo?.(e.shiftKey); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.hooks.onUndo?.(true); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.hooks.onSave?.(); }
    else if (mod && e.key.toLowerCase() === 'd' && it) { e.preventDefault(); this.duplicate(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && it) { e.preventDefault(); this.remove(); }
    else if (e.key.startsWith('Arrow') && it) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
      this.doc.mark(); this.doc.move(it, dx, dy); this.changed(it.path);
    } else if (e.key === 'f' || e.key === 'F') this.fit();
  }
  remove() { const it = this.item(); if (!it) return; this.doc.mark(); this.doc.remove(it); this.changed(null); }
  duplicate() { const it = this.item(); if (!it) return; this.doc.mark(); const path = this.doc.duplicate(it); if (path) this.changed(path); else this.doc.unmark(); }

  // ---------------------------------------------------------------- drawing
  draw() {
    const c = this.canvas, ctx = this.ctx, dpr = Math.min(2, window.devicePixelRatio || 1), W = this.w, H = this.h;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2b2d31'; ctx.fillRect(0, 0, c.width, c.height);
    const z = this.zoom, cam = { x: this.cam.x, y: this.cam.y, w: W / z, h: H / z }, map = this.map;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
    ctx.imageSmoothingEnabled = z < 1;
    if (map) {
      try {
        if (this.show.backs) map.drawBacks(ctx, cam, false);
        if (this.show.scenery) for (let l = 0; l < 8; l++) { ctx.globalAlpha = this.layer >= 0 && l !== this.layer ? 0.3 : 1; map.drawLayer(ctx, cam, l); }
        ctx.globalAlpha = 1;
        if (this.show.reactors) for (const it of this.items) if (it.kind === 'reactor') this.art(ctx, cam, it);
        if (this.show.life) for (const e of map.life) e.draw(ctx, cam, this.assets);
        if (this.show.scenery) map.drawPortals(ctx, cam);
        if (this.show.backs) map.drawBacks(ctx, cam, true);
      } catch (e) { for (let i = 0; i < 16; i++) ctx.restore(); ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0); this.busy = `This map can’t be drawn: ${e.message}`; }
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    this.marks(ctx, z);
    ctx.restore();
    if (this.busy) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '13px system-ui, sans-serif'; ctx.textBaseline = 'top';
      const tw = ctx.measureText(this.busy).width;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(10, 10, tw + 16, 26); ctx.fillStyle = '#fff'; ctx.fillText(this.busy, 18, 16);
    }
  }
  /** An item's own picture at its place (reactors, and what is being dragged or placed). */
  art(ctx, cam, it, alpha = 1) {
    const s = this.sizeOf(it), img = s && this.assets.image(s.node);
    if (!img) return false;
    ctx.save();
    ctx.globalAlpha = alpha;
    const x = it.x - (cam ? cam.x : 0), y = it.y - (cam ? cam.y : 0);
    if (s.flip) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -(s.node.origin?.[0] ?? 0), s.t); }
    else ctx.drawImage(img, x + s.l, y + s.t);
    ctx.restore();
    return true;
  }
  /** Everything a player doesn't see, in the map's own coordinates. */
  marks(ctx, z) {
    const px = 1 / z, doc = this.doc;
    if (!doc) return;
    const line = (x1, y1, x2, y2, color, width = 2) => {
      ctx.lineWidth = (width + 2) * px; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.lineWidth = width * px; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const label = (text, x, y, color = '#fff') => {
      ctx.font = `${11 * px}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const w = ctx.measureText(text).width + 6 * px;
      ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x - w / 2, y, w, 14 * px);
      ctx.fillStyle = color; ctx.fillText(text, x, y + 1.5 * px);
    };
    const dot = (x, y, color, r = 4) => { ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.arc(x, y, (r + 1.5) * px, 0, 7); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r * px, 0, 7); ctx.fill(); };
    // the map's edges
    const b = doc.bounds();
    ctx.setLineDash([8 * px, 6 * px]); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = COLORS.bounds; ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t); ctx.setLineDash([]);
    const names = z >= 0.45, cur = this.item(), dim = (it) => it.layer !== undefined && this.layer >= 0 && it.layer !== this.layer;
    for (const it of this.items) {
      if (it.kind === 'back' || !this.visible(it.kind)) continue;
      if (it.kind === 'foothold') { line(it.x, it.y, it.x2, it.y2, COLORS.foothold); if (z >= 0.8) { dot(it.x, it.y, COLORS.foothold, 2.5); dot(it.x2, it.y2, COLORS.foothold, 2.5); } }
      else if (it.kind === 'rope') line(it.x, it.y, it.x2, it.y2, COLORS.rope, it.n.l ? 5 : 3);
      else if (it.kind === 'seat') dot(it.x, it.y, COLORS.seat, 5);
      else if (it.kind === 'portal') {
        const icon = this.helper?.portal?.editor?.[PORTAL_TYPES[it.n.pt]], img = icon && this.assets.image(icon);
        if (img) ctx.drawImage(img, it.x - (icon.origin?.[0] ?? 0) / 2, it.y - (icon.origin?.[1] ?? 0) / 2, img.width / 2, img.height / 2); else dot(it.x, it.y - 20, COLORS.portal, 7);
        if (names) label(it.n.pt === 0 ? 'sp' : `${it.n.pn}${it.n.tm !== undefined && it.n.tm !== 999999999 ? ` → ${it.n.tm}` : ''}`, it.x, it.y + 4 * px);
      } else if (it.kind === 'life') {
        if (Number.isFinite(it.n.rx0) && Number.isFinite(it.n.rx1) && it.n.type === 'm') line(it.n.rx0, it.y + 6 * px, it.n.rx1, it.y + 6 * px, COLORS.life, 1);
        dot(it.x, it.y, COLORS.life, 3.5);
        if (names && it.n.type === 'm') label(`${it.n.id}`, it.x, it.y + 9 * px, COLORS.life);
      } else if (it.kind === 'reactor') { dot(it.x, it.y, COLORS.reactor, 4); if (names) label(`reactor ${it.n.id}`, it.x, it.y + 6 * px, COLORS.reactor); }
      else if (this.mode === 'scenery' && !dim(it) && z >= 0.5) { ctx.lineWidth = px; ctx.strokeStyle = 'rgba(255,212,0,0.28)'; ctx.strokeRect(it.box.l, it.box.t, it.box.r - it.box.l, it.box.b - it.box.t); }
    }
    // what is picked: its box, its ends, and its own picture while it is dragged
    if (cur) {
      if ((cur.kind === 'obj' || cur.kind === 'tile') && this.drag?.it && this.drag.far) this.art(ctx, null, cur, 0.75);
      if (cur.kind === 'foothold' || cur.kind === 'rope') { line(cur.x, cur.y, cur.x2, cur.y2, COLORS.picked, 3); dot(cur.x, cur.y, '#fff', 5); dot(cur.x2, cur.y2, '#fff', 5); }
      else if (cur.box) {
        ctx.lineWidth = 4 * px; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeRect(cur.box.l - 2 * px, cur.box.t - 2 * px, cur.box.r - cur.box.l + 4 * px, cur.box.b - cur.box.t + 4 * px);
        ctx.lineWidth = 2 * px; ctx.strokeStyle = COLORS.picked; ctx.strokeRect(cur.box.l - 2 * px, cur.box.t - 2 * px, cur.box.r - cur.box.l + 4 * px, cur.box.b - cur.box.t + 4 * px);
      }
    }
    // what is being drawn or placed
    const t = this.tool, m = this.mouse;
    if (t?.kind === 'footholds') {
      for (let i = 0; i + 1 < t.points.length; i++) line(t.points[i].x, t.points[i].y, t.points[i + 1].x, t.points[i + 1].y, COLORS.picked, 3);
      const lastPt = t.points[t.points.length - 1];
      if (lastPt && m) line(lastPt.x, lastPt.y, m.x, m.y, 'rgba(255,212,0,0.6)', 2);
      for (const p of t.points) dot(p.x, p.y, '#fff', 4);
    } else if (this.drag?.rope) line(this.drag.from.x, this.drag.from.y, this.drag.from.x, this.drag.to.y, COLORS.picked, 4);
    else if (t && m && (t.what === 'obj' || t.what === 'tile') && t.node) {
      const img = this.assets.image(t.node), o = t.node.origin || [0, 0], grid = this.snap ? GRID : 1;
      if (img) { ctx.globalAlpha = 0.7; ctx.drawImage(img, Math.round(m.x / grid) * grid - o[0], Math.round(m.y / grid) * grid - o[1]); ctx.globalAlpha = 1; }
    }
  }
}
