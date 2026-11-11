import { pad, isCanvas, frames } from './assets.js';
import { Footholds, PHYS, accelerate, approach, swimVelocity } from './physics.js';
import { BASE_W, BASE_H, snapPx, PIXEL_SCALE } from './view.js';

const HTILE = new Set([1, 3, 4, 6, 7]);
const VTILE = new Set([2, 3, 5, 6, 7]);
const HSCROLL = new Set([4, 6]);
const VSCROLL = new Set([5, 7]);

export function mapPath(id) {
  return `Map/Map/Map${Math.floor(id / 100000000)}/${pad(id, 9)}.img`;
}

/**
 * Animation over numbered canvas frames, each with its own `delay`.
 * Frames may fade: alpha goes from `a0` to `a1` (0-255) across the frame's delay, and zoom from `z0` to `z1` (%).
 * A last frame without a delay is held (e.g. the title logo fades in once and stays).
 */
export class Anim {
  constructor(node, loop = true) {
    this.frames = isCanvas(node) ? [node] : frames(node).filter(isCanvas);
    this.loop = loop; this.i = 0; this.t = 0; this.done = false;
    this.repeat = 0; this.loops = 0;   // repeat > 0: a looping animation plays that many times, then holds its last frame
    this.defaultDelay = 100;   // for frames without a delay (an NPC's is 180, set by Life)
    this.blend = !!node?.blend; // additive ("lighter") blending, used by some UI effects
    const last = this.frames[this.frames.length - 1];
    // only fades hold: plain looping animations often omit delay and rely on the default
    this.holdLast = this.frames.length > 1 && last && last.delay === undefined && (last.a0 !== undefined || last.a1 !== undefined);
  }
  get node() { return this.frames[this.i]; }
  get alpha() {
    const f = this.node;
    if (!f || (f.a0 === undefined && f.a1 === undefined)) return 1;
    const a0 = f.a0 ?? 255, a1 = f.a1 ?? a0;
    const k = Math.min(1, this.t / (f.delay || this.defaultDelay));
    return Math.max(0, Math.min(1, (a0 + (a1 - a0) * k) / 255));
  }
  /** Zoom: from `z0` to `z1` percent across the frame's delay (1 = actual size). */
  get zoom() {
    const f = this.node;
    if (!f || (f.z0 === undefined && f.z1 === undefined)) return 1;
    const z0 = f.z0 ?? 100, z1 = f.z1 ?? z0;
    const k = Math.min(1, this.t / (f.delay || this.defaultDelay));
    return Math.max(0, (z0 + (z1 - z0) * k) / 100);
  }
  update(dtMs) {
    // a single still frame only moves on when it plays once (then it ends after its delay, e.g. a
    // one-frame swing trail or death), a looping one just stays
    if (this.done || (this.frames.length < 2 && this.loop) || !this.frames.length) return;
    this.t += dtMs;
    while (this.t >= (this.node.delay || this.defaultDelay)) {
      if (this.holdLast && this.i === this.frames.length - 1) { this.t = 0; return; }
      this.t -= this.node.delay || this.defaultDelay;
      if (this.i + 1 < this.frames.length) this.i++;
      else if (this.loop && !(this.repeat > 0 && ++this.loops >= this.repeat)) this.i = 0;
      else { this.done = true; return; }
    }
  }
  reset() { this.i = 0; this.t = 0; this.done = false; this.loops = 0; }
}

/** A map object's animation: looping, or played `repeat` times when its node sets one. */
function objAnim(node) {
  const a = new Anim(node);
  if (a.frames.length > 1) a.repeat = Math.max(0, Number(node?.repeat) || 0);
  return a;
}

export class GameMap {
  constructor(assets, id) {
    this.assets = assets; this.id = id;
    this.backs = []; this.layers = []; this.life = []; this.portals = []; this.objTags = new Map(); this.namedObjs = new Map();
    this.scroll = 0;
  }

  /** Build an NPC/mob from its WZ data. spawn: {id, x, cy, f, fh, rx0, rx1}. */
  async createLife(kind, spawn) {
    const a = this.assets;
    let src = await a.json(`${kind}/${pad(spawn.id, 7)}.img`);
    const hideName = !!Number(src?.info?.hideName);
    if (src?.info?.link) src = (await a.json(`${kind}/${pad(src.info.link, 7)}.img`)) || src;
    if (!src) return null;
    const strings = this.strings?.[kind];
    const name = strings?.[Number(spawn.id)]?.name || '';
    const fh = this.fh.get(spawn.fh) || this.fh.below(spawn.x, spawn.cy - 5, 60);
    const e = new Life(kind, spawn, src, name, fh, this.fh);
    if (kind === 'Npc' && src.info?.MapleTV) e.tv = mapleTV(await a.json('UI/MapleTV.img'), src.info);
    if (kind === 'Npc') {
      e.picks = npcPicks(src, strings?.[Number(spawn.id)]);
      e.npcLists = npcLists(src, strings?.[Number(spawn.id)]);
      e.hideName = hideName; e.func = strings?.[Number(spawn.id)]?.func || '';
    }
    await a.preload(e.allFrames());
    return e;
  }

  async load(onStatus, opts = {}) {
    const a = this.assets;
    onStatus?.('Loading map data...');
    // opts.path loads a map-format .img from elsewhere (e.g. UI/MapLogin.img for the login scene)
    let data = await a.json(opts.path || mapPath(this.id));
    if (!data) throw new Error(`Map ${this.id} not found`);
    // info/link: everything but the map's own info (footholds, life, portals, tiles, the miniMap) is the linked map's
    if (!opts.path && data.info?.link) {
      const linked = await a.json(mapPath(Number(data.info.link)));
      if (linked) data = { ...linked, info: data.info };
    }
    this.data = data;
    this.info = data.info || {};
    this.fh = new Footholds(data.foothold);
    this.fh.swimming = (x, y) => this.swimming(x, y);
    // info/VRLimit keeps you inside the view range: walls at VRLeft + 20 / VRRight - 20, the top at VRTop + 65
    if (Number(data.info?.VRLimit)) {
      const vl = Number(data.info.VRLeft) || 0, vr = Number(data.info.VRRight) || 0, vt = Number(data.info.VRTop) || 0;
      if (vl) this.fh.wallL = Math.max(this.fh.wallL, vl + 20);
      if (vr) this.fh.wallR = Math.min(this.fh.wallR, vr - 20);
      if (vt) this.fh.ceiling = Math.max(this.fh.ceiling, vt + 65);
      const vb = Number(data.info.VRBottom) || 0;
      if (vb) this.fh.ground = Math.min(this.fh.ground, vb);
    }
    this.fh.fs = Number(data.info?.fs) || 1;   // the map's drag (1 when unset)
    this.ladders = Object.entries(data.ladderRope || {}).map(([id, l]) => ({ ...l, id: Number(id) }));   // the id goes in movement

    // Bounds: VR* when present, else derived from footholds.
    const i = this.info;
    this.bounds = i.VRLeft !== undefined
      ? { left: i.VRLeft, right: i.VRRight, top: i.VRTop, bottom: i.VRBottom }
      : { left: this.fh.left + 10, right: this.fh.right - 10, top: this.fh.top - 360, bottom: this.fh.bottom + 110 };

    const [strMap, strNpc, strMob, helper] = await Promise.all([
      a.json('String/Map.img'), a.json('String/Npc.img'), a.json('String/Mob.img'), a.json('Map/MapHelper.img'),
    ]);
    this.name = findMapName(strMap, this.id);

    onStatus?.('Loading backgrounds...');
    for (const [k, b] of Object.entries(data.back || {})) {
      if (!b.bS) continue;
      const set = await a.json(`Map/Back/${b.bS}.img`);
      const node = set?.[b.ani === 1 ? 'ani' : 'back']?.[b.no];
      if (!node || b.ani === 2) continue;
      this.backs.push({ ...b, idx: Number(k), node, anim: new Anim(node) });
    }

    onStatus?.('Loading tiles and objects...');
    for (let l = 0; l < 8; l++) {
      const layer = data[l] || {};
      const objs = [], tiles = [];
      for (const o of Object.values(layer.obj || {})) {
        const set = await a.json(`Map/Obj/${o.oS}.img`);
        const node = set?.[o.l0]?.[o.l1]?.[o.l2];
        if (!node) continue;
        // `hide` starts it hidden; its `tags` (comma-separated) let the server show or hide it (SET_MAP_OBJECT_VISIBLE)
        const obj = { ...o, anim: objAnim(node), visible: !Number(o.hide), tags: String(o.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean) };
        // its states: the node itself, then s1, s2...; a named one is switched by the server (FIELD_OBSTACLE_ONOFF,
        // FIELD_EFFECT 2) and shows nothing until then, unless its first state has autoActive
        obj.states = [node];
        for (let s = 1; node[`s${s}`] && typeof node[`s${s}`] === 'object'; s++) obj.states.push(node[`s${s}`]);
        obj.state = 0;
        obj.active = !o.name || !!Number(node.autoActive);
        if (o.name) this.namedObjs.set(String(o.name), obj);
        objs.push(obj);
        for (const t of obj.tags) { if (!this.objTags.has(t)) this.objTags.set(t, []); this.objTags.get(t).push(obj); }
      }
      const tS = layer.info?.tS;
      if (tS) {
        const set = await a.json(`Map/Tile/${tS}.img`);
        for (const t of Object.values(layer.tile || {})) {
          const node = set?.[t.u]?.[t.no];
          if (isCanvas(node)) tiles.push({ ...t, node });
        }
      }
      objs.sort((p, q) => p.z - q.z || (p.zM ?? 0) - (q.zM ?? 0));
      tiles.sort((p, q) => (p.node.z ?? 0) - (q.node.z ?? 0));
      this.layers.push({ objs, tiles });
    }

    this.strings = { Mob: strMob, Npc: strNpc };
    await this.loadToolTips(data.ToolTip);
    if (opts.life !== false) {
      onStatus?.('Loading NPCs and monsters...');
      for (const l of Object.values(data.life || {})) {
        if (l.hide) continue;
        const e = await this.createLife(l.type === 'm' ? 'Mob' : 'Npc', l);
        if (e) this.life.push(e);
      }
    }

    // MapHelper.img/portal/game (openms, docs/ingame-portals.md): pv loops on types 2, 4 and 7; hidden portals
    // (10, 11) show only while you are near, from ph (type 11 starts and ends with psh but continues with ph)
    const g = helper?.portal?.game;
    for (const [k, p] of Object.entries(data.portal || {})) {
      const anim = [2, 4, 7].includes(p.pt) ? new Anim(g?.pv) : null;
      let hidden = null;
      if (p.pt === 10 || p.pt === 11) {
        const ph = g?.ph?.[p.image || 'default'] || g?.ph?.default, psh = g?.psh?.[p.image || 'default'] || g?.psh?.default;
        const ends = p.pt === 11 ? psh : ph;
        hidden = { start: ends?.portalStart, cont: ph?.portalContinue, exit: ends?.portalExit };
      }
      this.portals.push({ ...p, idx: Number(k), anim, hidden });
    }

    onStatus?.('Loading images...');
    await a.preload(this.canvases(), (d, n) => onStatus?.(`Loading images... ${d}/${n}`));
  }

  canvases() {
    const out = [];
    for (const b of this.backs) out.push(...b.anim.frames);
    for (const l of this.layers) { for (const o of l.objs) out.push(...o.anim.frames); for (const t of l.tiles) out.push(t.node); }
    for (const e of this.life) out.push(...e.allFrames());
    for (const p of this.portals) if (p.anim) out.push(...p.anim.frames);
    for (const p of this.portals) if (p.hidden) for (const n of Object.values(p.hidden)) out.push(...new Anim(n).frames);
    if (this.data?.miniMap?.canvas) out.push(this.data.miniMap.canvas);
    return out;
  }

  spawnPortal(name) {
    return this.portals.find((p) => p.pn === name) || this.portals.find((p) => p.pt === 0) || this.portals[0] || { x: 0, y: 0 };
  }

  portalById(idx) {
    return this.portals.find((p) => p.idx === idx) || this.spawnPortal(null);
  }

  /** The portal Up takes you through: the client's [x-20, x+20) x [y-50, y+50) round your feet, last listed first. */
  portalAt(x, y) {
    x = Math.trunc(x); y = Math.trunc(y);
    return this.portals.findLast((p) => p.pt !== 0 && p.pt !== 6 && (p.tm !== 999999999 || p.script)
      && x >= p.x - 20 && x < p.x + 20 && y >= p.y - 50 && y < p.y + 50);
  }
  /** The script touch portal (type 9) whose hRange x vRange box (100 x 100 by default) holds this point, last listed first. */
  scriptPortalAt(x, y) { return this.boxPortalAt(x, y, 9); }
  /** The portal of type pt whose hRange x vRange box (100 x 100 by default) holds this point, last listed first. */
  boxPortalAt(x, y, pt) {
    return this.portals.findLast((p) => {
      if (p.pt !== pt) return false;
      const hw = Math.trunc((p.hRange ?? 100) / 2), hh = Math.trunc((p.vRange ?? 100) / 2);
      return x >= p.x - hw && x < p.x + hw && y >= p.y - hh && y < p.y + hh;
    });
  }

  /**
   * Hidden portals show while you are within [x-100, x+100) x [y-50, y+50) of one: portalStart, then portalContinue
   * looping; walking off plays portalExit (a Start still running is not reversed).
   */
  updateHidden(x, y) {
    const near = this.portals.find((p) => p.hidden && x >= p.x - 100 && x < p.x + 100 && y >= p.y - 50 && y < p.y + 50) || null;
    if (near === this.shownHidden) return;
    const old = this.shownHidden;
    if (old) { old.anim = new Anim(old.hidden.exit, false); old.phase = 'exit'; }
    if (near) { near.anim = new Anim(near.hidden.start, false); near.phase = 'start'; }
    this.shownHidden = near;
  }

  /** In water: everywhere on a swim map (info/swim), else inside one of its info/swimArea boxes. */
  swimming(x, y) {
    if (Number(this.info.swim) === 1) return true;
    this.swimAreas ??= Object.values(this.info.swimArea || {}).map((r) => ({ x1: Number(r.x1), y1: Number(r.y1), x2: Number(r.x2), y2: Number(r.y2) }));
    return this.swimAreas.some((r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2);
  }

  /** The first ladder / rope within 10px of the x span from (x1, y1) to (x2, y2) whose height overlaps the y span. */
  ladderIn(x1, y1, x2, y2) {
    const left = Math.min(x1, x2) - 10, right = Math.max(x1, x2) + 10, top = Math.min(y1, y2), bottom = Math.max(y1, y2);
    return this.ladders.find((l) => l.x >= left && l.x <= right && top <= l.y2 && l.y1 <= bottom);
  }

  update(dt) {
    const ms = dt * 1000;
    this.scroll += dt;
    for (const b of this.backs) {
      b.anim.update(ms);
      const f = b.fade;
      if (f) { f.t += ms; b.alpha = f.t >= f.ms ? f.to : f.from + (f.to - f.from) * (f.t / f.ms); if (f.t >= f.ms) b.fade = null; }
    }
    for (const l of this.layers) for (const o of l.objs) o.anim.update(ms);
    for (const p of this.portals) {
      p.anim?.update(ms);
      if (p.phase === 'start' && p.anim.done) { p.anim = new Anim(p.hidden.cont); p.phase = 'cont'; }
      else if (p.phase === 'exit' && p.anim.done) { p.anim = null; p.phase = null; }
    }
    for (const e of this.life) e.update(dt);
  }

  /**
   * Backgrounds, from the camera as it is (not a whole pixel), each at its own rate, placed on the canvas's own pixel
   * grid so they glide as the view does. Layers that share a scale other than 1 are drawn together into a canvas of
   * their own at about the canvas's density, which is then scaled onto the view as one picture: scaled one by one,
   * pieces meant to meet inside a scaled image (Ellinia's light beams) would meet on fractional pixels and leave a 1px
   * line where they overlap or part.
   */
  drawBacks(ctx, cam, front) {
    const list = this.backs.filter((b) => !!b.front === front);
    if (!front) this.bufStats = { n: 0, px: 0 };   // for the /fps meter
    GRID = PIXEL_SCALE;
    for (let i = 0; i < list.length;) {
      const m = this.backScale(cam, list[i]);
      let j = i + 1;
      while (j < list.length && this.backScale(cam, list[j]) === m) j++;
      const box = j - i > 1 && m !== 1 ? this.runBox(cam, list.slice(i, j), m) : null;
      if (box) this.drawBackRun(ctx, cam, list.slice(i, j), m, box);
      else for (let n = i; n < j; n++) this.drawBack(ctx, cam, list[n], m);
      i = j;
    }
    GRID = 1;
  }
  /**
   * Whether a run of scaled layers needs to be drawn as one picture, and over what part of the view: only when its
   * pieces slide over each other (different scroll rates: Ellinia's light beams), the box round what of them shows.
   * Otherwise (null) they go straight onto the canvas: pieces that keep their places meet on the same canvas pixels.
   */
  runBox(cam, run, m) {
    // how it moves: by time or with the view, on each axis (tiling doesn't change that)
    const rate = (q) => `${HSCROLL.has(q.type) ? 't' : 'v'}${q.rx}/${VSCROLL.has(q.type) ? 't' : 'v'}${q.ry}`;
    if (!run.some((b) => rate(b) !== rate(run[0]))) return null;
    const rects = [];
    for (const b of run) {
      const p = this.backPlace(cam, b, m, false);
      if (p) for (const y of p.ys) for (const x of p.xs) rects.push({ x, y, r: x + p.w, b: y + p.h });
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of rects) {
      if (q.r <= 0 || q.b <= 0 || q.x >= cam.w || q.y >= cam.h) continue;
      x0 = Math.min(x0, Math.max(0, q.x)); y0 = Math.min(y0, Math.max(0, q.y)); x1 = Math.max(x1, Math.min(cam.w, q.r)); y1 = Math.max(y1, Math.min(cam.h, q.b));
    }
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
  }
  drawBackRun(ctx, cam, run, m, box) {
    // D buffer pixels per unit, the canvas's own density (cheap: the buffer is 1/m^2 of the box on the canvas); the
    // stretch by m to the screen is smoothed, so the picture doesn't crawl as it moves. Only the box is drawn.
    const D = PIXEL_SCALE;
    const ux0 = Math.floor((box.x / m) * D) / D, uy0 = Math.floor((box.y / m) * D) / D;
    const bw = Math.ceil(((box.x + box.w) / m) * D) - ux0 * D, bh = Math.ceil(((box.y + box.h) / m) * D) - uy0 * D;
    if (bw <= 0 || bh <= 0) return;
    if (this.bufStats) { this.bufStats.n++; this.bufStats.px += bw * bh; }
    const c = (this.backCanvas ??= document.createElement('canvas'));
    // it only ever grows (each run uses its top-left part), so runs of other sizes don't reallocate it every frame
    if (c.width < bw || c.height < bh) { c.width = Math.max(c.width, bw); c.height = Math.max(c.height, bh); }
    const o = c.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, bw, bh);
    o.setTransform(D, 0, 0, D, -ux0 * D, -uy0 * D); o.imageSmoothingEnabled = false;
    GRID = D;
    for (const b of run) this.drawBack(o, cam, b, m, true);
    GRID = PIXEL_SCALE;
    ctx.save();
    ctx.imageSmoothingEnabled = Math.abs(m * PIXEL_SCALE - D) > 1e-3;
    ctx.drawImage(c, 0, 0, bw, bh, ux0 * m, uy0 * m, (bw / D) * m, (bh / D) * m);
    ctx.restore();
  }

  /**
   * Backgrounds are made for an 800x600 view. On a bigger one each is scaled up by as much as it holds still on
   * screen (an axis it tiles along counts as still): one fixed to the screen fills the view as it would fill 800x600,
   * one that moves with the map keeps its size and place in it. Only its placement grows with it, not how fast it
   * scrolls, and every piece of one back is scaled alike so pieces that meet still meet.
   */
  backScale(cam, b) {
    const k = Math.max(cam.w / BASE_W, cam.h / BASE_H);
    if (k <= 1) return 1;
    const still = (tiled, r) => (tiled ? 1 : Math.max(0, Math.min(1, 1 + r / 100)));
    return 1 + (k - 1) * Math.min(still(HTILE.has(b.type), b.rx), still(VTILE.has(b.type), b.ry));
  }
  /** unit: drawn at 1x into a canvas the view is 1/m of (see drawBacks). */
  drawBack(ctx, cam, b, m = this.backScale(cam, b), unit = false) {
    const p = this.backPlace(cam, b, m, unit);
    if (!p) return;
    ctx.save();
    ctx.globalAlpha = ((b.alpha ?? b.a ?? 255) / 255) * b.anim.alpha;
    for (const dy of p.ys) for (const dx of p.xs) drawImg(ctx, p.img, dx, dy, b.f, p.w, p.h);
    ctx.restore();
  }
  /** Where back b's copies go this frame (view coordinates, or the unit ones of a run's buffer), and their size. */
  backPlace(cam, b, m, unit) {
    const node = b.anim.node;
    const img = this.assets.image(node);
    if (!img) return null;
    const o = node.origin || [0, 0];
    let W = cam.w, H = cam.h, x, y;
    if (HSCROLL.has(b.type)) x = b.x + this.scroll * b.rx * 5 - cam.x;
    else x = b.x + (cam.x + W / 2) * (100 + b.rx) / 100 - cam.x;
    if (VSCROLL.has(b.type)) y = b.y + this.scroll * b.ry * 5 - cam.y;
    else y = b.y + (cam.y + H / 2) * (100 + b.ry) / 100 - cam.y;
    x += (m - 1) * b.x; y += (m - 1) * b.y;
    let z = m;
    if (unit) { x /= m; y /= m; W /= m; H /= m; z = 1; }
    const w = img.width * z, h = img.height * z;
    x -= o[0] * z; y -= o[1] * z;
    if (b.f) x -= (img.width - 2 * o[0]) * z;

    const cx = (b.cx || img.width) * z, cy = (b.cy || img.height) * z;
    let xs = [x], ys = [y];
    if (HTILE.has(b.type) && cx > 0) { xs = []; for (let s = ((x % cx) + cx) % cx - cx; s < W; s += cx) xs.push(s); }
    if (VTILE.has(b.type) && cy > 0) { ys = []; for (let s = ((y % cy) + cy) % cy - cy; s < H; s += cy) ys.push(s); }
    return { img, xs, ys, w, h };
  }

  /**
   * The map's ToolTip node: rects N (x1/y1/x2/y2, map coordinates) and, for some, an Nchar rect. Their Title / Desc
   * come from String/ToolTipHelp.img/Mapobject/<map id>/N. Hovering rect N shows its tooltip at the cursor; standing
   * inside Nchar shows it at rect N's (x2, y2).
   */
  async loadToolTips(node) {
    this.tips = []; this.charTips = new Map();
    if (!node) return;
    const byKey = new Map();
    for (const [k, t] of Object.entries(node)) {
      const rect = { left: Number(t.x1) || 0, top: Number(t.y1) || 0, right: Number(t.x2) || 0, bottom: Number(t.y2) || 0 };
      if (k.length >= 4 && k.endsWith('char')) this.charTips.set(k.slice(0, -4), rect);
      else { const tip = { key: k, ...rect, title: '', desc: '' }; this.tips.push(tip); byKey.set(k, tip); }
    }
    const help = (await this.assets.json('String/ToolTipHelp.img'))?.Mapobject?.[this.id] || {};
    for (const [k, h] of Object.entries(help)) {
      const tip = byKey.get(k);
      if (tip) { tip.title = String(h?.Title ?? ''); tip.desc = String(h?.Desc ?? ''); }
    }
  }
  /** The first ToolTip rect holding a map point (right and bottom edges excluded), or null. */
  tipAt(x, y) { return this.tips?.find((t) => x >= t.left && x < t.right && y >= t.top && y < t.bottom) || null; }
  /** The ToolTip rects whose Nchar rect holds a map point. */
  charTipsAt(x, y) {
    const out = [];
    for (const t of this.tips || []) {
      const r = this.charTips.get(t.key);
      if (r && x >= r.left && x < r.right && y >= r.top && y < r.bottom) out.push(t);
    }
    return out;
  }

  /** SET_BACK_EFFECT: background back/<idx> goes from its alpha now to `to` (0-255) over ms. */
  fadeBack(idx, to, ms) {
    for (const b of this.backs) {
      if (b.idx !== idx) continue;
      const from = b.alpha ?? b.a ?? 255;
      b.fade = ms > 0 ? { from, to, t: 0, ms } : null;
      if (!b.fade) b.alpha = to;
    }
  }
  /** CLEAR_BACK_EFFECT: the backgrounds are made again from the map, as they were when it loaded. */
  resetBacks() { for (const b of this.backs) { b.alpha = undefined; b.fade = null; b.anim = new Anim(b.node); } }

  /** Shows or hides every object with this tag. */
  setObjectVisible(tag, on) { for (const o of this.objTags.get(tag) || []) o.visible = on; }
  /**
   * Switch a named object to one of its states (0: itself, n: its sN; -1: the one it is in), restarting that state's
   * animation and playing its sfx (Sound/Field.img/...). Returns the state node, or null for an unknown name or state.
   */
  setObjectState(name, state) {
    const o = this.namedObjs.get(String(name));
    if (o && state === -1) state = o.state;
    if (!o || state < 0 || state >= o.states.length) return null;
    o.state = state;
    o.active = true;
    o.anim = objAnim(o.states[state]);
    return o.states[state];
  }
  /**
   * The obstacles in play: each object whose current state has `obstacle`, from its current frame's lt / rb (mirrored
   * when it is flipped) where it stands, while the frame is shown (alpha over 125) and at least 5px across or high.
   * info is the state's node (damage, mobdamage, dir, disease, level, forceHP, targetField).
   */
  obstacles() {
    const out = [];
    for (const l of this.layers) {
      for (const o of l.objs) {
        const info = o.states?.[o.state];
        if (!o.visible || !o.active || !info || !Number(info.obstacle)) continue;
        const f = o.anim.node, lt = f?.lt, rb = f?.rb;
        if (!lt || !rb || o.anim.alpha * 255 <= 125) continue;
        if (rb[0] - lt[0] < 5 && rb[1] - lt[1] < 5) continue;
        const rect = o.f ? { left: o.x - rb[0], top: o.y + lt[1], right: o.x - lt[0], bottom: o.y + rb[1] }
          : { left: o.x + lt[0], top: o.y + lt[1], right: o.x + rb[0], bottom: o.y + rb[1] };
        out.push({ rect, info, obj: o });
      }
    }
    return out;
  }

  drawLayer(ctx, cam, l) {
    const layer = this.layers[l];
    if (!layer) return;
    // only what is on screen (a pixel to spare): a wide map has a thousand pieces and most are far off
    const vw = (cam.w ?? Infinity) + 2, vh = (cam.h ?? Infinity) + 2;
    const off = (x, y, img) => x > vw || y > vh || x + img.width < -2 || y + img.height < -2;
    for (const o of layer.objs) {
      if (!o.visible || !o.active) continue;
      const node = o.anim.node;
      const img = this.assets.image(node);
      if (!img) continue;
      const ox = node.origin?.[0] ?? 0, oy = node.origin?.[1] ?? 0;
      const x = (o.f ? o.x + ox - img.width : o.x - ox) - cam.x, y = o.y - oy - cam.y;
      if (off(x, y, img)) continue;
      const alpha = o.anim.alpha;
      if (alpha <= 0) continue;
      if (alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; }
      drawImg(ctx, img, x, y, o.f);
      if (alpha < 1) ctx.restore();
    }
    for (const t of layer.tiles) {
      const img = this.assets.image(t.node);
      if (!img) continue;
      const x = t.x - (t.node.origin?.[0] ?? 0) - cam.x, y = t.y - (t.node.origin?.[1] ?? 0) - cam.y;
      if (off(x, y, img)) continue;
      ctx.drawImage(img, snap(x), snap(y));   // tiles on whole game pixels: no seams
    }
  }

  drawPortals(ctx, cam) {
    for (const p of this.portals) {
      if (!p.anim?.node) continue;
      const img = this.assets.image(p.anim.node);
      if (!img) continue;
      const o = p.anim.node.origin || [0, 0];
      ctx.drawImage(img, snap(p.x - o[0] - cam.x), snap(p.y - o[1] - cam.y));
    }
  }
}

// rounds a hair up, so edges that are equal but for float error (x.4999.. and x.5) land on the same pixel; on whole
// game pixels (tiles, objects, portals), or on a finer grid while backgrounds are drawn (see drawBacks)
let GRID = 1;
const snap = (v) => Math.round(v * GRID + 1e-6) / GRID;
/** w, h: a scaled size; its edges are rounded rather than its size, so scaled pieces that meet stay touching. */
function drawImg(ctx, img, x, y, flip, w = img.width, h = img.height) {
  if (w !== img.width || h !== img.height) { w = snap(x + w) - snap(x); h = snap(y + h) - snap(y); }
  x = snap(x); y = snap(y);
  const sized = w !== img.width || h !== img.height;
  if (!flip) { if (sized) ctx.drawImage(img, x, y, w, h); else ctx.drawImage(img, x, y); return; }
  ctx.save();
  ctx.translate(x + w, y);
  ctx.scale(-1, 1);
  if (sized) ctx.drawImage(img, 0, 0, w, h); else ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function findMapName(strMap, id) {
  for (const region of Object.values(strMap || {})) {
    const m = region?.[id];
    if (m) return m.streetName ? `${m.streetName} : ${m.mapName}` : m.mapName;
  }
  return String(id);
}

// MonsterStatus bits (second mask) that hold a monster still
const MOB_SPEED = 0x40, MOB_STUN = 0x80, MOB_FREEZE = 0x100, MOB_WEB = 0x20000;
/**
 * Looping status art with `repeat` (not icons: Weapon / Magic Immunity) shows one at a time: every monster update
 * (one per 30ms tick) of a monster that has some counts on a counter all monsters share, and on each 22nd that
 * monster moves on to its next one. A status of that kind coming or going sets the counter to 1 and moves on at once.
 */
const STATUS_TURN = { n: 0, every: 22, tick: 30 };
/** A monster AI wait: `base` + up to `spread` ms, counted in 90ms units of its 30ms ticks (so a third as long). */
/** What a planned path's stand-in leaves behind for the path to play out rather than taking over. */
const PLAYED = new Set(['x', 'y', 'fh', 'state', 'facingRight', 'prevX', 'prevY', 'setState']);
/** How much of a path is still to play, in ms. */
/** Round half away from zero, as the client rounds a drawn position. */
const roundAway = (v) => (v >= 0 ? Math.trunc(v + 0.5) : Math.trunc(v - 0.499999999));
/**
 * A path's elements as playback keys: where each ends, its speed (px/s), pose, floor and time. A jump's or a blow's
 * element (no position of its own) keeps the point before with its speed; equip changes and the like are left out.
 */
function pathKeys(moves, from) {
  const keys = [];
  let px = from.x, py = from.y;
  for (const m of moves) {
    if (m.cmd === 10 || m.cmd === 14 || m.cmd === 21) continue;
    const abs = m.x !== undefined;
    const k = { type: m.cmd, x: abs ? m.x : px, y: abs ? m.y : py, vx: (abs ? m.vx : m.rx) || 0, vy: (abs ? m.vy : m.ry) || 0, stance: m.stance, fh: m.fh || 0, dur: Math.max(0, m.duration || 0) };
    keys.push(k); px = k.x; py = k.y;
  }
  return keys;
}
const aiWait = (base, spread) => (Math.floor((base + Math.random() * spread) / 90) * 30) / 1000;

/**
 * A Maple TV NPC (info/MapleTV) is only the cabinet; the client fills its screens from UI/MapleTV.img: the top one
 * shows TVbasic (the MapleStory banner) while no message is on, the bottom one an ad from TVmedia, picked once
 * and looped.
 */
function mapleTV(ui, info) {
  const ads = Object.values(ui?.TVmedia || {});
  return {
    msg: { x: Number(info.MapleTVmsgX) || 0, y: Number(info.MapleTVmsgY) || 0, anim: new Anim(ui?.TVbasic, true) },
    ad: { x: Number(info.MapleTVadX) || 0, y: Number(info.MapleTVadY) || 0, anim: new Anim(ads[Math.floor(Math.random() * ads.length)], true) },
  };
}

/** What an NPC does now and then: one of its actions (with one of that action's speak lines), or one of its info/speak lines. */
function npcPicks(src, str) {
  const say = (n) => Object.values(n?.speak || {}).map((k) => str?.[k]).filter((t) => typeof t === 'string' && t.trim());
  const acts = Object.entries(src).filter(([k, v]) => !['info', 'stand', 'move', 'hide'].includes(k) && v && typeof v === 'object' && !v.special);
  return [...acts.map(([k, v]) => ({ action: k, lines: say(v) })), ...say(src.info).map((l) => ({ lines: [l] }))];
}

/**
 * What an NPC we control can do, as the client lists it: its actions (every child but info, stand, move and the
 * condition sets, in order; each with its speak lines, `special` ones left to scripts, `shop` never picked at random),
 * and its own info/speak lines.
 */
function npcLists(src, str) {
  const say = (n) => Object.values(n?.speak || {}).map((k) => str?.[k]).filter((t) => typeof t === 'string' && t.trim());
  const acts = Object.entries(src).filter(([k, v]) => !['info', 'stand', 'move'].includes(k) && !k.startsWith('condition') && v && typeof v === 'object');
  return { actions: acts.map(([k, v]) => ({ action: k, lines: say(v), special: !!Number(v.special), shop: k === 'shop' })), lines: say(src.info) };
}
/** A random number below 50, as the client draws them for NPCs. */
const npcRoll = () => Math.floor(Math.random() * 50);

/** NPC or monster placed by the map's `life` list. */
export class Life {
  constructor(kind, spawn, src, name, fh, footholds) {
    this.kind = kind; this.spawn = spawn; this.src = src; this.name = name;
    this.footholds = footholds;
    this.x = spawn.x; this.y = fh ? Footholds.yAt(fh, spawn.x) : spawn.cy; this.fh = fh;
    this.facingRight = !!spawn.f;   // f=1 mirrors the art, for NPCs and monsters alike
    this.maxHp = src.info?.maxHP || 1; this.hp = this.maxHp;
    const info = src.info || {};
    this.speed = Math.max(0, (info.speed ?? 0) + 100) * 0.78;   // an NPC's walk
    // a monster's speed, flySpeed and chaseSpeed each count from 100 (held to 0-140); see walkSpeed
    const stat = (v) => Math.max(0, Math.min(140, (v ?? 0) + 100));
    this.speedStat = stat(info.speed); this.flySpeedStat = stat(info.flySpeed); this.chaseSpeedStat = stat(info.chaseSpeed);
    // how it moves: it flies (with a fly animation, whatever else it has), walks and jumps (jump and move), walks, or
    // stays where it is
    this.flying = kind === 'Mob' && !!src.fly;
    this.canJump = kind === 'Mob' && !this.flying && !!src.jump && !!src.move;
    this.canMove = kind === 'Mob' && (this.flying || !!src.move);
    this.dir = 0;             // which way it is walking: -1, 0 (standing) or 1
    this.anims = {};
    for (const k of ['stand', 'move', 'chase', 'jump', 'hit1', 'die1', 'fly', 'regen']) if (src[k]) this.anims[k] = new Anim(src[k], !['die1', 'hit1', 'regen'].includes(k));
    // an NPC's other actions (say, eye...) play now and then; `special` ones are left to scripts
    this.actions = kind === 'Npc' ? Object.keys(src).filter((k) => !['info', 'stand', 'move'].includes(k) && !src[k]?.special && frames(src[k]).some(isCanvas)) : [];
    for (const k of this.actions) this.anims[k] = new Anim(src[k], false);
    if (kind === 'Npc') {
      // its speed stat is speed + 70 (capped at 140) percent of the walk speed; only one with a move animation wanders
      this.speed = Math.min(140, Math.max(0, (info.speed ?? 0) + 70)) * PHYS.walk / 100;
      this.walks = !!src.move && spawn.rx1 > spawn.rx0;
      this.picks = []; this.actT = 3 + Math.random() * 6; this.moveT = 0; this.dir = 0;
    }
    if (kind === 'Npc') for (const a of Object.values(this.anims)) a.defaultDelay = 180;   // the client's NPC frame default
    // its attacks (attack1, attack2...): a reach box (type 0), a start point and radius (1, a shot; 2, a ball), or
    // a row of spots that erupt after a warning (3 on the ground, 4 at a set height - the bosses' area attacks)
    this.attacks = [];
    for (let n = 1; kind === 'Mob' && src[`attack${n}`]; n++) {
      const node = src[`attack${n}`], info = node.info || {}, type = Number(info.type ?? 0);
      this.anims[`attack${n}`] = new Anim(node, false);
      if (type <= 4 && info.range) this.attacks.push({ n, index: n - 1, info, type });
    }
    this.attackT = 1 + Math.random() * 2;
    // its skills (info/skill: skill, level, which skillN animation, effectAfter); the server offers one at a time
    this.mobSkills = Object.values(src.info?.skill || {}).filter((s) => s?.skill);
    for (let n = 1; kind === 'Mob' && src[`skill${n}`]; n++) this.anims[`skill${n}`] = new Anim(src[`skill${n}`], false);
    this.nextSkill = null;
    // statuses on it (MonsterStatus masks) and, per skill that caused them, that skill's mob art and icon
    this.status = { first: 0, second: 0 };
    this.statusArt = new Map();
    this.state = this.anims.stand ? 'stand' : this.anims.fly ? 'fly' : Object.keys(this.anims)[0];
    this.timer = 0;
    this.aggro = null;        // the character it chases once hit (or told to by the server); see chase()
    this.chaseT = 0;
    this.vx = 0; this.vy = 0;
    this.respawnTimer = 0;
    // network state: oid set for server-spawned life; `controlled` = we run its AI and report moves
    this.oid = spawn.oid ?? null;
    this.controlled = false;
    this.path = null;       // the path being played (its keys still to come), see playPath
    this.pb = null;         // the playback's state between ticks
    this.removed = false;
  }

  get online() { return this.oid !== null; }

  /**
   * A path from its controller (MOVE_MONSTER), queued after whatever is still to play; one with an action (an attack,
   * a skill) starts afresh from where it is shown now. The packet's start point isn't used.
   */
  applyMovement(start, moves, act = -1) {
    if (act >= 0) this.cutPath();
    const q = this.path?.q, last = q?.[q.length - 1];
    this.queueKeys(pathKeys(moves, last || this.pb?.cur || { x: this.x, y: this.y }));
  }
  /** Our own plan, queued for playing the same way (its first jump or blow element keeps where it is now). */
  queueOwn(moves) { this.queueKeys(pathKeys(moves, this.pb?.cur || { x: this.x, y: this.y })); }
  /**
   * Keys go after what is queued. Under 1100ms queued it plays at 30ms a tick, from there at 33 (catching up); over
   * 6100ms it is dropped for a jump to the last key.
   */
  queueKeys(keys) {
    if (!keys.length) return;
    const p = this.path || (this.path = { q: [], t: 0, total: 0, rate: 30 });
    p.q.push(...keys);
    p.total += keys.reduce((s, k) => s + k.dur, 0);
    p.rate = p.total < 1100 ? 30 : 33;
    if (p.total > 6100) { const last = p.q[p.q.length - 1]; p.q = [{ ...last, type: 3, dur: 0 }]; p.total = 0; }
  }
  /** What's still to play goes; the next path starts from where it is shown now, at the speed it has now. */
  cutPath() {
    this.path = null;
    const b = this.pb;
    if (b) { b.x0 = b.cur.x; b.y0 = b.cur.y; b.vx0 = b.cur.vx; b.vy0 = b.cur.vy; }
  }
  /** Moved by something else (a pull, a blow): playback picks up from there, standing still. */
  rebasePath() {
    const b = this.pb;
    if (!b) return;
    b.cur = { x: this.x, y: this.y, vx: 0, vy: 0 }; b.prev = { x: this.x, y: this.y };
    b.x0 = this.x; b.y0 = this.y; b.vx0 = b.vy0 = 0;
  }
  /**
   * One 30ms tick of its path. Keys whose time is up are passed (each sets where it is, its speed and pose); within
   * the next one it is on the curve through the last key and that one, each with its speed (a jump keeps its
   * place but sets the speed it leaves at); a jump key (3) puts it there at once. False when nothing was queued.
   */
  pathTick() {
    const p = this.path, b = this.pb;
    b.prev = { x: b.cur.x, y: b.cur.y };
    if (!p || !p.q.length) { this.path = null; return false; }
    p.t += p.rate;
    let jumped = false;
    while (p.q.length) {
      const e = p.q[0];
      if (p.t < e.dur) break;
      p.t -= e.dur;
      b.x0 = e.x; b.y0 = e.y; b.vx0 = e.vx; b.vy0 = e.vy;
      b.cur = { x: e.x, y: e.y, vx: e.vx, vy: e.vy };
      if (e.type === 3) jumped = true;
      if (!this.keepPose) this.takePose(e);
      p.q.shift();
    }
    p.total -= p.rate;
    if (p.q.length && p.total > 0) {
      const e = p.q[0];
      if (e.type === 3) { b.cur = { x: e.x, y: e.y, vx: e.vx, vy: e.vy }; jumped = true; }
      else {
        const s = p.t / e.dur, s2 = s * s, D = p.t * 0.001;
        const h00 = 2 * s2 * s - 3 * s2 + 1, h01 = 3 * s2 - 2 * s2 * s, h10 = (s2 - 2 * s + 1) * D, h11 = (s2 - s) * D;
        const nx = h00 * b.x0 + h01 * e.x + h10 * b.vx0 + h11 * e.vx, ny = h00 * b.y0 + h01 * e.y + h10 * b.vy0 + h11 * e.vy;
        b.cur = { x: nx, y: ny, vx: (nx - b.cur.x) * (1000 / 30), vy: (ny - b.cur.y) * (1000 / 30) };
      }
      if (!this.keepPose) this.takePose(e);
    } else this.path = null;
    if (jumped) b.prev = { x: b.cur.x, y: b.cur.y };   // no gliding across a jump
    return true;
  }
  /**
   * Its path plays on the client's 30ms clock, a tick ahead of the screen, and is drawn between the last two ticks
   * (rounded half away from zero). One we control plans its next path when nothing is left to play, once the server
   * has answered the last one it sent (MOVE_MONSTER_RESPONSE); meanwhile it waits where its path ended.
   */
  playPath(dt, keepPose = false) {
    let b = this.pb;
    if (!b || (!this.path && (Math.abs(b.cur.x - this.x) > 1 || Math.abs(b.cur.y - this.y) > 1))) {
      b = this.pb = { cur: { x: this.x, y: this.y, vx: 0, vy: 0 }, prev: { x: this.x, y: this.y }, x0: this.x, y0: this.y, vx0: 0, vy0: 0, acc: b?.acc || 0 };
    }
    this.keepPose = keepPose;
    b.acc += dt * 1000;
    while (b.acc > 0) {
      b.acc -= 30;
      if (!this.pathTick() && this.controlled && this.online && !this.moveWait && !keepPose && !this.dying) { this.x = b.cur.x; this.y = b.cur.y; this.planPath(); }
    }
    this.keepPose = false;
    const k = -b.acc / 30;
    this.x = roundAway(b.cur.x + (b.prev.x - b.cur.x) * k);
    this.y = roundAway(b.cur.y + (b.prev.y - b.cur.y) * k);
  }
  /** A path point's pose (its stance: 1 walk, 2 stand, 3 jump, 6 fly, 16 chase; bit 0 faces left) and floor. */
  takePose(s) {
    this.facingRight = !(s.stance & 1);
    const pose = { 1: 'move', 2: 'stand', 3: 'jump', 6: 'fly', 16: this.flying && !this.anims.chase ? 'fly' : 'chase' }[s.stance >> 1];
    if (pose) this.setState(this.anims[pose] ? pose : pose === 'stand' ? this.state : this.flying ? 'fly' : 'move');
    if (!this.flying) this.fh = s.fh ? this.footholds.get(s.fh) || this.fh : null;
  }
  /** Its pose as a path stance: (walk 1, stand 2, jump 3, fly 6, chase 16) << 1, plus 1 facing left. */
  get stance() {
    const st = this.state, action = !this.fh && !this.flying ? 3 : st === 'chase' ? 16 : st === 'move' ? 1 : st === 'fly' ? 6 : st === 'jump' ? 3 : 2;
    return (action << 1) | (this.facingRight ? 0 : 1);
  }
  /**
   * One we control works out where it will be over the next second, as the client does: its AI and movement run in
   * 30ms ticks on a stand-in until a second is planned, the path (a point for each stretch in one pose, floor and
   * direction, with its speed) goes to the server for everyone else, and it then plays that path itself - so every
   * client shows it moving the same way at the same time. Its AI picks up from where the path ends.
   */
  planPath() {
    if (this.flying) { this.planFlyPath(); return; }
    const sim = Object.create(this), moves = [], start = { x: Math.round(this.x), y: Math.round(this.y) };
    sim.setState = function (st) { if (this.anims[st]) this.state = st; };
    for (let t = 0; t < 1000; t += 30) {
      const px = sim.x, py = sim.y;
      sim.step(0.03);
      const x = Math.round(sim.x), y = Math.round(sim.y), vx = Math.round((sim.x - px) / 0.03), vy = Math.round((sim.y - py) / 0.03);
      const fh = sim.fh?.id || 0, stance = sim.stance, last = moves[moves.length - 1];
      if (last && last.fh === fh && last.stance === stance && Math.sign(last.vx) === Math.sign(vx) && Math.sign(last.vy) === Math.sign(vy)) {
        Object.assign(last, { x, y, vx, vy }); last.duration += 30;
      } else moves.push({ cmd: 0, x, y, vx, vy, fh, stance, duration: 30 });
    }
    for (const k of Object.keys(sim)) if (!PLAYED.has(k)) this[k] = sim[k];
    this.queueOwn(moves);
    this.onPath?.(this, start, moves);
  }

  /**
   * A flyer's plan, as the client's controller makes it: 12 steps of 90ms (1080ms). Each step runs its fly AI, then
   * one flight step over the whole 90ms:
   * - sideways it is pushed at 1200px/s^2 up to its top speed, and brakes at 1000px/s^2 x the map's fs when let go;
   * - its spot 10px or more above: it flaps (straight up at its top speed, recorded as a point of its own); within
   *   10px it hovers (settling to a sink of 0.3 x its top speed); below, it sinks at 1200px/s^2 up to its top speed;
   * - it moves by the step's average speed, then is kept inside the map's box (its spot pulled 30px back in);
   * - the step is recorded where it ends (speeds truncated), merged into the point before while its pose and the
   *   signs of its speeds stay the same.
   * Its AI: chasing, a spot within 120px left or right and 40px up or down of its target, picked again within 11px
   * of it or once the target is 150px from it; after 60-119 spots it gives the chase up. Left alone, a spot along a
   * foothold of one group (walls too), from 50px above to 9px below it, another group after (its width + 40-240) / 8
   * spots. Stunned, it lets go of everything (and sinks). The spot goes with the path (MOVE_LIFE).
   */
  planFlyPath() {
    const F = (this.fly ??= { vx: 0, vy: 0, inX: 0, inY: 0, has: false, group: -1, counter: 0, chase: null, tx: 0, ty: 0, action: this.stance });
    // set on a new target, its AI starts afresh; let go, it only forgets the target
    if (this.aggro && this.aggro !== F.chase) { F.chase = this.aggro; F.has = false; F.group = -1; F.counter = 0; F.tx = F.ty = 0; }
    else if (!this.aggro) F.chase = null;
    const fh = this.footholds, G = fh.flyGroups(), rnd = (n) => Math.floor(Math.random() * n), dt = 0.09;
    const sp = Math.max(10, Math.min(140, this.flySpeedStat + this.speedMod)) / 100, brake = 1000 * (fh.fs || 1) * dt, acc = 1200;
    const accel = (v, a, max) => (a > 0 ? (v >= max ? v : Math.min(max, v + a * dt)) : (v <= -max ? v : Math.max(-max, v + a * dt)));
    let x = this.x, y = this.y;
    const start = { x: Math.round(x), y: Math.round(y) }, moves = [];
    const reuse = () => { const l = moves[moves.length - 1]; return l && l.cmd === 0 && l.duration === 0 ? l : null; };
    for (let s = 0; s < 12; s++) {
      const water = fh.swimming(x, y), max = (water ? 140 : 200) * sp;
      const base = F.chase && this.anims.chase ? 16 : 6;
      const input = (dx, dy) => { F.inX = dx; F.inY = dy; F.action = dx ? (base << 1) | (dx < 0 ? 1 : 0) : (base << 1) | (F.action & 1); };
      if (this.held) input(0, 0);
      else {
        if (F.has) {
          const dx = Math.abs(Math.trunc(F.tx - x)) >= 10 ? (F.tx >= x ? 1 : -1) : 0;
          let dy = 0;
          if (Math.abs(Math.trunc(F.ty - y)) < 10) dy = -1;
          else if (F.ty < y) {   // the flap: straight up at once (five times the swim speed in water)
            F.vy = -(water ? 140 * sp * 5 : max);
            const e = { cmd: 1, rx: Math.trunc(F.vx), ry: Math.trunc(F.vy), stance: F.action, duration: 0 }, l = reuse();
            if (l) { for (const k of Object.keys(l)) delete l[k]; Object.assign(l, e); } else moves.push(e);
          }
          input(dx, dy);
          const ix = Math.trunc(x), iy = Math.trunc(y), c = F.chase;
          if (ix >= F.tx - 11 && ix < F.tx + 11 && iy >= F.ty - 11 && iy < F.ty + 11) F.has = false;
          else if (c && !(c.x >= F.tx - 150 && c.x < F.tx + 150 && c.y >= F.ty - 150 && c.y < F.ty + 150)) F.has = false;
        }
        if (!F.has && F.chase) {
          if (F.counter === 0) F.counter = rnd(60) + 60;
          F.tx = Math.trunc(F.chase.x) + rnd(240) - 120; F.ty = Math.trunc(F.chase.y) + rnd(80) - 40;
          F.group = -1; F.counter--; F.has = true;
          if (F.counter <= 0) { this.aggro = this.chased = null; F.chase = null; }   // this spot is still flown to
        } else if (!F.has && G.ids.length) {
          if (F.counter <= 0 || F.group < 0) {
            F.group = G.ids[rnd(G.ids.length)];
            const [a, b] = G.range.get(F.group);
            F.counter = (b - a + 40 + rnd(200)) >> 3;
          }
          const list = G.list.get(F.group), f = list[rnd(list.length)], L = Math.hypot(f.x2 - f.x1, f.y2 - f.y1), len = Math.trunc(L);
          const t = len > 0 ? rnd(len) : 0;   // (a zero-length foothold: its start)
          F.tx = Math.trunc((L ? (f.x2 - f.x1) / L : 0) * t + f.x1);
          F.ty = Math.trunc((L ? (f.y2 - f.y1) / L : 0) * t + rnd(60) + f.y1 - 50);
          F.counter--; F.has = true;
        }
      }
      // the flight
      const vx0 = F.vx, vy0 = F.vy;
      let vx = F.vx, vy = F.vy;
      if (vx > max) vx = Math.max(max, vx - brake); else if (vx < -max) vx = Math.min(-max, vx + brake);
      if (F.inX) vx = accel(vx, F.inX * acc, max);
      else vx = vx > 0 ? Math.max(0, vx - brake) : Math.min(0, vx + brake);
      if (vy > max) vy = Math.max(max, vy - brake); else if (vy < -max) vy = Math.min(-max, vy + brake);
      if (F.inY < 0) { const T = max * 0.3; if (vy > T) vy = Math.max(T, vy - acc * dt); else if (vy < T) vy = Math.min(T, vy + acc * dt * 0.5); }
      else if (F.inY > 0) vy = max * 1.5;
      else vy = accel(vy, acc, max);
      x += (vx0 + vx) * dt * 0.5; y += (vy0 + vy) * dt * 0.5;
      F.vx = vx; F.vy = vy;
      // the map's box: its spot pulled 30px back in (the client puts x + 30 for the top edge's spot)
      const L0 = fh.wallL, R0 = fh.wallR, T0 = fh.ceiling, B0 = fh.ground;
      let cx = false, cy = false;
      if (x < L0) { x = L0; cx = true; } else if (x > R0 - 1) { x = R0 - 1; cx = true; }
      if (y < T0) { y = T0; cy = true; } else if (y > B0 - 1) { y = B0 - 1; cy = true; }
      if (cx) F.tx = Math.trunc(x === L0 ? x + 30 : x - 30);
      if (cy) F.ty = Math.trunc(y === T0 ? x + 30 : y - 30);
      // the step's point
      const e = { cmd: 0, x: Math.trunc(x), y: Math.trunc(y), vx: Math.trunc(vx), vy: Math.trunc(vy), fh: 0, stance: F.action, duration: 90 };
      const l = moves[moves.length - 1];
      if (l && l.cmd === 0 && l.stance === e.stance && Math.sign(l.vx) === Math.sign(e.vx) && Math.sign(l.vy) === Math.sign(e.vy) && l.duration > 0) Object.assign(l, { ...e, duration: l.duration + 90 });
      else if (reuse()) Object.assign(reuse(), e);
      else moves.push(e);
    }
    this.queueOwn(moves);
    this.onPath?.(this, start, moves);
  }

  /**
   * KILL_MONSTER: its statuses end (a frozen one thaws) and it dies as `type` says (1 and up). 2, 4 and up: it goes
   * off in its attack1, which hurts like the attack does, and is gone when that ends. Otherwise its death pose: 3 is
   * skill1, the rest one of its die nodes at random (die1, die2, dieF, as many as it has nodes starting with "die").
   */
  kill(type = 1) {
    this.status = { first: 0, second: 0 }; this.statusArt.clear();
    this.dying = true;
    if (type !== 1 && type !== 3 && this.anims.attack1) { this.deathAttack = true; this.attacking = null; this.playAttack(0); return; }
    const dies = Object.keys(this.src).filter((k) => k.startsWith('die')).length;
    const name = type === 3 ? 'skill1' : ['die1', 'die2', 'dieF'][Math.floor(Math.random() * dies)];
    if (name && name !== 'die1' && this.src[name]) this.anims.die1 = new Anim(this.src[name], false);
    this.dieAction = { die1: 9, die2: 10, dieF: 11, skill1: 21 }[name] ?? 9;   // its action number, for the line it says
    this.state = ''; this.setState('die1'); if (!this.anims.die1) this.removed = true;
    else this.onDie?.(this);
  }

  allFrames() { return [...Object.values(this.anims), ...(this.tv ? [this.tv.msg.anim, this.tv.ad.anim] : [])].flatMap((a) => a.frames); }
  get alive() { return this.state !== 'die1' && this.respawnTimer <= 0 && !this.appearing; }
  get node() { return this.anims[this.state]?.node; }

  setState(s) {
    if (this.state === s || !this.anims[s]) return;
    this.state = s; this.anims[s].reset();
  }

  /**
   * A blow. As in the original, a monster only flinches (hit1) and recoils when the damage reaches its
   * `pushed` threshold; the recoil slides it back along its floor from 130px/s, braking at 400px/s^2 - or, for a
   * strong recoil (the weapon's knockback chance), from 300px/s braking at 200px/s^2. One already reeling from a
   * hit takes the damage but doesn't react again until its hit1 has played out.
   */
  hit(dmg, fromRight, strong = false) {
    if (!this.alive || this.kind !== 'Mob') return;
    const stanceBefore = this.stance;
    this.hp -= dmg;
    if (this.online) this.hp = Math.max(0, this.hp); // the server decides death (KILL_MONSTER)
    else if (this.hp <= 0) { this.setState('die1'); return; }
    if (dmg < (this.src.info?.pushed ?? 1)) return;
    if (this.state === 'hit1' && this.hitTimer > 0) return;
    if (this.attacking) return;   // a monster mid-attack keeps its attack pose (the client's)
    this.facingRight = fromRight;
    if (this.anims.hit1) { this.setState('hit1'); this.hitTimer = Math.max(0.3, this.anims.hit1.frames.reduce((t, f) => t + (f.delay || 100), 0) / 1000); }
    // fromRight: the blow came from the right, so it slides away to the left
    if (this.controlled) this.cutPath();
    // a flyer we control is pushed straight back (see planFlyHit)
    if (this.flying) this.flyPush = { v: (fromRight ? -1 : 1) * (strong ? 300 : 130), brake: strong ? 200 : 400 };
    // one that can't move (no move, jump or fly: Horntail's and Zakum's parts) isn't pushed
    if (!this.flying && this.canMove && (this.controlled || !this.online)) {
      const push = (fromRight ? -1 : 1) * (strong ? 300 : 130);
      // on the ground it slides back; in the air the blow sets its sideways speed, stops its rise and it falls on
      this.hitBrake = strong ? 200 : 400; this.hitLanded = false;
      if (this.fh) { this.recoil = push; this.recoilBrake = this.hitBrake; } else { this.vx = push; this.vy = 0; }
    }
    if (this.controlled && this.online) this.planHit((this.hitTimer || 0) * 1000, stanceBefore);
  }
  /**
   * One we control was struck: what the client sends then, element for element - the blow's push (type 2: no time,
   * the speed it sets off at), 300ms of sliding back, standing for the rest of its hit pose (in the air: falling
   * through it, pushed sideways by the blow), then its own movement
   * until at least a second is planned (1.65s at most, ending on the ground) - in the stance it had before the blow.
   * It then plays that same plan itself, so everyone sees one thing.
   */
  planHit(hitMs, stance) {
    if (this.flying) { this.planFlyHit(stance); return; }
    const sim = Object.create(this), start = { x: Math.round(this.x), y: Math.round(this.y) };
    sim.setState = function (st) { if (this.anims[st]) this.state = st; };
    const moves = [], hold = Math.max(300, hitMs);
    if (sim.recoil) moves.push({ cmd: 2, rx: Math.round(sim.recoil), ry: 0, stance, duration: 0 });
    const add = (px, py, st, t) => {
      const x = Math.round(sim.x), y = Math.round(sim.y), vx = Math.round((sim.x - px) / 0.03), vy = Math.round((sim.y - py) / 0.03);
      const fh = sim.fh?.id || 0, last = moves[moves.length - 1], phase = t < 300 ? 0 : t < hold ? (sim.hitLanded ? 3 : 1) : 2;
      if (last && last.cmd === 0 && last.phase === phase && last.fh === fh && last.stance === st && Math.sign(last.vx) === Math.sign(vx) && Math.sign(last.vy) === Math.sign(vy)) {
        Object.assign(last, { x, y, vx, vy }); last.duration += 30;
      } else moves.push({ cmd: 0, x, y, vx, vy, fh, stance: st, duration: 30, phase });
    };
    for (let t = 0; t < 1650; t += 30) {
      if (t >= 1000 && (sim.fh || sim.flying)) break;
      const px = sim.x, py = sim.y;
      if (t < 300) { if (sim.recoil && sim.fh) sim.recoilStep(0.03); else sim.hitFall(0.03); add(px, py, stance, t); continue; }
      if (t < hold) { if (sim.hitLanded && sim.recoil && sim.fh) sim.recoilStep(0.03); else sim.hitFall(0.03); add(px, py, stance, t); continue; }
      if (sim.state === 'hit1') { sim.setState(sim.flying ? 'fly' : 'stand'); sim.recoil = 0; }
      sim.step(0.03); add(px, py, sim.stance, t);
    }
    // the slide ends where it got to in 300ms; standing, it no longer moves (falling, or sliding on from where it
    // landed - phase 3 - it keeps its speed)
    for (const m of moves) { if (m.phase === 1 && m.fh) { m.vx = 0; m.vy = 0; } delete m.phase; }
    for (const k of Object.keys(sim)) if (!PLAYED.has(k) && k !== 'recoil') this[k] = sim[k];
    this.recoil = 0;   // the plan carries the slide
    this.queueOwn(moves);
    this.onPath?.(this, start, moves);
  }
  /**
   * A flyer we control struck: the client's plain blow for a flyer - the push sets it off at 130px/s away from the
   * blow (300 for a strong one), braking at 400px/s^2 (200), in 30ms steps of average speed inside the map's box,
   * recorded as its path in the pose it had. It flies on from a stop. (How long the client records it isn't read:
   * here until it stops.)
   */
  planFlyHit(stance) {
    const P = this.flyPush;
    this.flyPush = null;
    if (!P || !this.canMove) return;
    const fh = this.footholds, start = { x: Math.round(this.x), y: Math.round(this.y) }, moves = [{ cmd: 2, rx: Math.trunc(P.v), ry: 0, stance, duration: 0 }];
    let x = this.x, v = P.v;
    const y = Math.max(fh.ceiling, Math.min(fh.ground - 1, this.y));
    for (let t = 0; t < 3000 && v !== 0; t += 30) {
      const v0 = v;
      v = v > 0 ? Math.max(0, v - P.brake * 0.03) : Math.min(0, v + P.brake * 0.03);
      x = Math.max(fh.wallL, Math.min(fh.wallR - 1, x + (v0 + v) * 0.03 * 0.5));
      const e = { cmd: 0, x: Math.trunc(x), y: Math.trunc(y), vx: Math.trunc(v), vy: 0, fh: 0, stance, duration: 30 }, l = moves[moves.length - 1];
      if (l.cmd === 0 && Math.sign(l.vx) === Math.sign(e.vx)) Object.assign(l, { ...e, duration: l.duration + 30 });
      else moves.push(e);
    }
    if (this.fly) { this.fly.vx = 0; this.fly.vy = 0; }
    this.queueOwn(moves);
    this.onPath?.(this, start, moves);
  }
  /** One we control being pulled (Rush, Monster Magnet): the server hears its whole slide at once, as with a blow. */
  startPull(pull) {
    this.pull = pull;
    if (!this.controlled || !this.online) return;
    this.path = null;
    const sim = Object.create(this), start = { x: Math.round(this.x), y: Math.round(this.y) };
    const moves = [];
    for (let t = 0; sim.pull && t < 2000; t += 30) {
      const px = sim.x;
      sim.pullStep(0.03);
      const x = Math.round(sim.x), y = Math.round(sim.y), vx = Math.round((sim.x - px) / 0.03), last = moves[moves.length - 1];
      if (last && last.fh === (sim.fh?.id || 0)) { Object.assign(last, { x, y, vx }); last.duration += 30; }
      else moves.push({ cmd: 0, x, y, vx, vy: 0, fh: sim.fh?.id || 0, stance: this.stance, duration: 30 });
    }
    if (moves.length) this.onPath?.(this, start, moves);
  }
  /** Drawn in by Monster Magnet: toward pull.x at 1000px/s until within pull.stop of it; a floor's edge or a wall stops it. */
  pullStep(dt) {
    const p = this.pull, left = p.x - this.x;
    if (!this.fh || Math.abs(left) <= p.stop) { this.pull = null; return; }
    const { fh, x, y } = this;
    if (this.footholds.walk(this, Math.sign(left) * Math.min(Math.abs(left) - p.stop, 1000 * dt)) !== 'ok') { this.fh = fh; this.x = x; this.y = y; this.pull = null; }
  }
  /**
   * Struck in the air (not flying): through its hit pose it falls as it would otherwise, carried sideways by the
   * blow. Landing, it keeps that speed along the floor and slides on for the rest of the pose, slowing at the blow's
   * rate (400px/s², a strong blow 200).
   */
  hitFall(dt) {
    if (this.fh || this.flying) return;
    if (this.swimming()) { swimVelocity(this, 0, 0, dt); this.footholds.fall(this, dt, null, true); }
    else this.footholds.fall(this, dt);
    if (this.fh) { this.recoil = this.vx; this.recoilBrake = this.hitBrake || 400; this.vx = 0; this.hitLanded = true; }
  }
  /** Slide back after a blow, braking to a stop; a floor's edge or a wall stops it. */
  recoilStep(dt) {
    const v = this.recoil, slowed = Math.sign(v) * Math.max(0, Math.abs(v) - (this.recoilBrake || 400) * dt);
    const fh = this.fh, x = this.x, y = this.y;
    if (this.footholds.walk(this, ((v + slowed) / 2) * dt) !== 'ok') { this.fh = fh; this.x = x; this.y = y; this.recoil = 0; return; }
    this.recoil = slowed;
  }

  /**
   * A monster that has just spawned (not one already here when you arrived): its own regen animation if it has
   * one, otherwise a fade from invisible to solid over 800ms (the client's, openms docs/ingame-life.md).
   */
  appear() {
    if (this.anims.regen) this.setState('regen');
    else this.fadeInAt = performance.now();
  }
  update(dt) {
    this.prevX = this.x; this.prevY = this.y;
    if (this.tv) { this.tv.msg.anim.update(dt * 1000); this.tv.ad.anim.update(dt * 1000); }
    const anim = this.anims[this.state];
    if (!this.frozen || this.state === 'die1') anim?.update(dt * 1000);   // frozen solid: its picture stops too
    this.beaconMark?.update(dt * 1000);
    if ([...this.statusArt.values()].some((e) => e.turn)) {
      for (this.turnAcc = (this.turnAcc || 0) + dt * 1000; this.turnAcc >= STATUS_TURN.tick; this.turnAcc -= STATUS_TURN.tick) {
        if (STATUS_TURN.n++ % STATUS_TURN.every === 0) this.turnAt = (this.turnAt || 0) + 1;
      }
    }
    for (const e of this.statusArt.values()) {
      e.anim?.update(dt * 1000);
      if (e.doom) for (const a of [e.doom.stand, e.doom.move, e.doom.mark]) a?.update(dt * 1000);
    }
    if (this.state === 'regen') { if (anim.done) this.setState(this.flying ? 'fly' : 'stand'); return; }
    if (this.kind === 'Npc') { this.npcStep(dt); return; }
    if (this.appearing) return;   // still being summoned in: unseen, and it doesn't act
    if (this.attacking) {
      const at = this.attacking;
      at.t += dt * 1000;
      if (!at.landed && at.t >= (Number(at.a.info.attackAfter) || 0)) { at.landed = true; this.onAttackLand?.(this, at.a, at.spots); }
      const posing = this.state.startsWith('attack') || this.state.startsWith('skill');
      if (posing && (!anim || anim.done)) {
        if (this.deathAttack) { if (!at.landed) this.onAttackLand?.(this, at.a, at.spots); this.removed = true; return; }
        this.setState(this.flying ? 'fly' : 'stand');
        // an area attack's spots erupt on its own clock (attackAfter), even after the monster has finished its pose
        if (at.a.type >= 3 && !at.landed) return;
        if (!at.landed) this.onAttackLand?.(this, at.a, at.spots);
        this.attacking = null;
      } else if (!posing && at.landed) this.attacking = null;
      return;
    }
    if (this.pull && this.state !== 'die1') {
      // a pulled monster's path picks up from where the pull leaves it (one we control plans a new one)
      if (this.controlled) this.cutPath();
      this.pullStep(dt); this.rebasePath(); return;
    }
    if (this.online) {
      if (this.state === 'die1') { if (anim?.done || !anim) this.removed = true; return; }
      if (this.recoil && this.fh) this.recoilStep(dt);
      if (this.state === 'hit1') {
        this.hitTimer -= dt;
        if (this.controlled && this.path) this.playPath(dt, true);   // its planned slide, keeping the hit pose
        if (this.hitTimer <= 0) this.setState(this.flying ? 'fly' : 'stand');
        return;
      }
      if (!this.controlled) { this.playPath(dt); return; }
    }
    if (this.held) { this.cutPath(); return; }
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.hp = this.maxHp; this.x = this.spawn.x; this.state = ''; this.setState(this.anims.stand ? 'stand' : 'fly');
        this.fh = this.footholds.below(this.x, this.spawn.cy - 5, 60) || this.fh;
        if (this.fh) this.y = Footholds.yAt(this.fh, this.x);
      }
      return;
    }
    if (this.state === 'die1') { if (anim?.done) this.respawnTimer = 6; return; }
    if (this.state === 'hit1') { if (this.recoil && this.fh) this.recoilStep(dt); else this.hitFall(dt); this.hitTimer -= dt; if (this.hitTimer <= 0) this.setState(this.flying ? 'fly' : 'stand'); return; }
    // a chase lasts 3-4 minutes from the last time it was set on someone
    if (this.aggro !== this.chased) { this.chased = this.aggro; this.chaseT = 180 + Math.random() * 60; }
    if (this.aggro && (this.chaseT -= dt) <= 0) this.aggro = this.chased = null;
    if ((this.fh || this.flying) && this.tryAttack(dt)) { this.cutPath(); return; }   // an attack cuts its path short
    if (this.online) { this.playPath(dt); return; }
    this.step(dt);
  }
  /** Its AI and movement for one step of `dt` seconds. */
  step(dt) {
    if (!this.canMove) { this.faceTarget(dt); return; }
    if (this.flying) { this.flyStep(dt); return; }
    if (!this.fh) {                                   // mid-jump (or knocked off a ledge)
      // in water it sinks (no gravity), still pushed the way it was going
      if (this.swimming()) { swimVelocity(this, this.dir || 0, 0, dt); this.footholds.fall(this, dt, null, true); }
      else this.footholds.fall(this, dt);
      if (this.fh) { this.vx = 0; this.walkState(); }
      return;
    }
    this.think(dt);
    if (this.fh && this.dir && this.state !== 'stand') this.walkStep(dt);
  }
  /** Set it on `target` (or a fresh 3-4 minutes on the same one). */
  chase(target) { this.aggro = this.chased = target; this.chaseT = 180 + Math.random() * 60; }

  /** Where attack `a` reaches, facing as it does now: its box, or (types 1 and 2) its start point and radius. */
  attackReach(a) {
    const r = a.info.range, s = this.facesRight ? -1 : 1;
    if (a.type === 0) {
      const x1 = this.x + s * r.lt[0], x2 = this.x + s * r.rb[0];
      return { box: { left: Math.min(x1, x2), right: Math.max(x1, x2), top: this.y + r.lt[1], bottom: this.y + r.rb[1] } };
    }
    return { sx: this.x + s * (r.sp?.[0] || 0), sy: this.y + (r.sp?.[1] || 0), r: r.r || 0 };
  }
  /**
   * An area attack's spots: `areaCount` boxes side by side, each as wide as its lt/rb, numbered from `start` (so
   * start -6 with 12 spots runs from six to the left to five to the right; mirrored as it faces). Type 3 spots sit on
   * the ground under them, type 4 at its own height. `pick` of them (attackCount, chosen at random) erupt, or all.
   */
  areaSpots(a, pick = false) {
    const r = a.info.range, w = r.rb[0] - r.lt[0], s = this.facesRight ? -1 : 1, spots = [];
    for (let i = 0; i < (r.areaCount || 1); i++) {
      const col = (r.start || 0) + i;
      const x1 = this.x + s * (r.lt[0] + col * w), x2 = this.x + s * (r.rb[0] + col * w);
      let base = this.y;
      if (a.type === 3) { const f = this.footholds?.below((x1 + x2) / 2, this.y - 60, 400); if (f) base = Footholds.yAt(f, (x1 + x2) / 2); }
      spots.push({ left: Math.min(x1, x2), right: Math.max(x1, x2), top: base + r.lt[1], bottom: base + r.rb[1], x: (x1 + x2) / 2, y: base });
    }
    if (!pick) return spots;
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    return spots.slice(0, Math.max(1, r.attackCount || 1));
  }
  /** Whether attack `a` reaches a body (a box): overlapping its reach, or its middle within the radius in front. */
  reaches(a, body, spots = null) {
    if (a.type >= 3) return (spots || this.areaSpots(a)).some((q) => q.right >= body.left && q.left <= body.right && q.bottom >= body.top && q.top <= body.bottom);
    const q = this.attackReach(a);
    if (q.box) return q.box.right >= body.left && q.box.left <= body.right && q.box.bottom >= body.top && q.box.top <= body.bottom;
    const cx = (body.left + body.right) / 2, cy = (body.top + body.bottom) / 2;
    return (cx - this.x) * (this.facesRight ? 1 : -1) >= -10 && Math.hypot(cx - q.sx, cy - q.sy) <= q.r;
  }
  /**
   * Statuses (CMob's temporary stats): `first` / `second` are MonsterStatus mask bits, all from skill `source`,
   * whose art (`anim` looping on it, an `icon` for a monster's own buff) shows while any of them lasts.
   */
  addStatus(first, second, source, art = {}) {
    if (this.state === 'die1') return;   // a status that arrives after it died doesn't take
    // a status set again replaces what it had: its old art goes, and the new art goes in last (the icon row's end)
    for (const [src, o] of this.statusArt) { o.first &= ~first; o.second &= ~second; if (!o.first && !o.second) this.statusArt.delete(src); }
    this.status.first |= first; this.status.second |= second;
    const e = this.statusArt.get(source) || { first: 0, second: 0 };
    e.first |= first; e.second |= second;
    const { value, ...rest } = art; Object.assign(e, rest);
    if (second & MOB_SPEED) e.speed = value;
    this.statusArt.set(source, e);
    if (e.turn) this.turnNow();
  }
  removeStatus(first, second) {
    this.status.first &= ~first; this.status.second &= ~second;
    let turned = false;
    for (const [src, e] of this.statusArt) { e.first &= ~first; e.second &= ~second; if (!e.first && !e.second) { turned ||= !!e.turn; this.statusArt.delete(src); } }
    if (turned) this.turnNow();
  }
  /** A turning status came or went: the shared counter starts again at 1 and this monster moves on to its next one. */
  turnNow() { STATUS_TURN.n = 1; this.turnAt = (this.turnAt || 0) + 1; this.turnAcc = 0; }
  /** The turning status art showing now (STATUS_TURN), or null. */
  get turnShown() {
    const list = [...this.statusArt.values()].filter((e) => e.turn);
    return list.length ? list[(this.turnAt || 0) % list.length] : null;
  }
  /** Its statuses' art over its head (poison bubbles, stun stars...), and its own buffs' icons in a row above. */
  drawStatus(ctx, cam, assets, node) {
    if (!this.statusArt.size && !this.beaconMark) return;
    const head = node?.head;
    const right = this.facesRight;
    const hx = this.x + (head ? (right ? -head[0] : head[0]) : 0) - cam.x;
    const hy = this.y + (head ? head[1] : 0) - cam.y;   // a frame without a head point: at the feet
    // Homing Beacon's mark, over its head
    const bm = this.beaconMark?.node, bimg = bm && assets.image(bm);
    if (bimg) { const bo = bm.origin || [0, 0]; ctx.drawImage(bimg, Math.round(hx - bo[0]), Math.round(hy - bo[1])); }
    const icons = [], shown = this.turnShown;
    for (const e of this.statusArt.values()) {
      // a one-shot animation (Doom's puff) is gone once played; Doom's puff is at the feet, everything else over the
      // head; of the turning ones only the one whose turn it is
      const n = e.anim?.done || (e.turn && e !== shown) ? null : e.anim?.node, img = n && assets.image(n);
      const [ax, ay] = e.doom ? [this.x - cam.x, this.y - cam.y] : [hx, hy];
      if (img) { const no = n.origin || [0, 0]; ctx.drawImage(img, Math.round(ax - no[0]), Math.round(ay - no[1])); }
      const m = this.doomArt === e.doom && e.doom?.mark?.node, mark = m && assets.image(m);
      if (mark) {
        const mo = m.origin || [0, 0];
        ctx.save(); ctx.globalAlpha *= e.doom.mark.alpha;
        ctx.drawImage(mark, Math.round(hx - mo[0]), Math.round(hy - mo[1]));
        ctx.restore();
      }
      const icon = e.icon && assets.image(e.icon);
      if (icon) icons.push([e.icon, icon]);
    }
    // icons four to a row, 16px apart and centred on the head; each further row 16px higher
    const n = icons.length, full = n - (n % 4);
    icons.forEach(([node, img], i) => {
      const row = Math.floor(i / 4), inRow = i < full ? 4 : n % 4, io = node.origin || [0, 0];
      const dx = Math.trunc(((i % 4) - (inRow - 1) * 0.5) * 16), dy = 16 - row * 16;
      ctx.drawImage(img, Math.round(hx + dx - io[0]), Math.round(hy + dy - io[1]));
    });
  }
  /** Its speed now: a Speed status (Slow's negative value) is added to its own speed stat before the conversion. */
  /**
   * Its walking speed: the character's walk speed (125px/s) times its speed stat over 100, held to 10-140 - its
   * chaseSpeed while it chases if it has a chase pose, plus a Speed status (Slow's negative value). Doomed, the
   * Blue Snail's.
   */
  get walkSpeed() {
    const doom = this.doomArt;
    const base = doom ? Math.max(0, Math.min(140, (doom.speed ?? 0) + 100)) : this.aggro && this.anims.chase ? this.chaseSpeedStat : this.speedStat;
    return (PHYS.walk * Math.max(10, Math.min(140, base + this.speedMod))) / 100;
  }
  /** Its flying speed: 200px/s (the map's flySpeed) times its flySpeed over 100, held to 10-140 the same way. */
  get flySpeed() { return ((this.swimming() ? PHYS.swimSpeed : 200) * Math.max(10, Math.min(140, this.flySpeedStat + this.speedMod))) / 100; }
  /** In water: 0.9 of its walking speed, a jump of 0.7, swimming (140px/s) rather than flying (200px/s). */
  swimming() { return this.footholds.swimming(this.x, this.y); }
  get speedMod() {
    let mod = 0;
    if (this.status.second & MOB_SPEED) for (const e of this.statusArt.values()) if (e.second & MOB_SPEED) mod = e.speed || 0;
    return mod;
  }
  /** Doomed: once the puff has played, it is drawn (and walks) as the Blue Snail. */
  get doomArt() { for (const e of this.statusArt.values()) if (e.doom && (!e.anim || e.anim.done)) return e.doom; return null; }
  /** Frozen, stunned or caught in a Shadow Web: it can't move or attack until that wears off. */
  get held() { return !!(this.status.second & (MOB_STUN | MOB_FREEZE | MOB_WEB)); }
  get frozen() { return !!(this.status.second & MOB_FREEZE); }

  /** Cast monster skill `skill` at `level`: its skillN animation (if it has one), then the server applies it. */
  playSkill(skill, level) {
    const entry = this.mobSkills.find((s) => s.skill === skill && (s.level === level || !level)) || { skill, level, action: 1 };
    const anim = this.anims[`skill${entry.action || 1}`];
    this.recoil = 0;
    if (anim) { this.setState(`skill${entry.action || 1}`); anim.reset(); this.attacking = { a: { info: { attackAfter: Infinity } }, t: 0, landed: true }; }
    this.onSkill?.(this, entry);
  }
  /** Start attack number `index` (0 = attack1): its animation plays, and at its attackAfter it lands. */
  playAttack(index) {
    const a = this.attacks.find((x) => x.index === index) || { n: index + 1, index, info: this.src[`attack${index + 1}`]?.info || {}, type: 0 };
    if (!this.anims[`attack${a.n}`]) return;
    this.recoil = 0;
    this.setState(`attack${a.n}`); this.anims[`attack${a.n}`].reset();
    this.attacking = { a, t: 0, landed: false, spots: a.type >= 3 ? this.areaSpots(a, true) : null };
    this.onAttack?.(this, a, this.attacking.spots);
  }

  /**
   * Going after someone it can reach: now and then (a few seconds apart) it attacks, turning to face them. Whether
   * they are still in reach when it lands is checked then. True when it started one.
   */
  tryAttack(dt) {
    const t = this.aggro;
    // a skill the server has offered goes first, once it has someone to go after
    if (t && !t.reach && this.nextSkill) { const s = this.nextSkill; this.nextSkill = null; this.playSkill(s.skill, s.level); return true; }
    if (!t || t.reach || !this.attacks.length || (this.attackT -= dt) > 0) return false;
    const body = { left: t.x - 22, right: t.x + 22, top: t.y - 65, bottom: t.y };
    const facing = this.facingRight;
    this.facingRight = t.x > this.x;
    const usable = this.attacks.filter((a) => this.reaches(a, body));
    if (!usable.length) { this.facingRight = facing; this.attackT = 0.3; return false; }
    this.attackT = 2.5 + Math.random() * 2;
    this.playAttack(usable[Math.floor(Math.random() * usable.length)].index);
    return true;
  }

  /**
   * An NPC idles. Every 3-9s, while no line is up and no action plays, it does one thing at random: one of its
   * actions, saying one of that action's lines if it has any, or one of its own lines (up for 5s; none while it has
   * a quest icon). One that wanders stands 1-3s or, 1 time in 5, walks 0.5-1.5s either way, turning back at
   * either end of rx0-rx1; an action brings it to a stop.
   */
  npcStep(dt) {
    if (this.chat && (this.chat.t -= dt) <= 0) this.chat = null;
    if (this.acting && this.anims[this.acting]?.done !== false) this.acting = null;
    if (this.onNpcAction && !this.walks) this.npcAsk(dt);
    else if ((this.actT -= dt) <= 0 && !this.chat && !this.acting && this.picks.length) {
      this.actT = 3 + Math.random() * 6;
      const p = this.picks[Math.floor(Math.random() * this.picks.length)];
      if (this.anims[p.action]) { this.acting = p.action; this.setState(p.action); }
      if (p.lines.length && !this.questIcon) this.chat = { text: p.lines[Math.floor(Math.random() * p.lines.length)], t: 5 };
    }
    if (this.walks && this.fh) this.npcWalk(dt);
    if (!this.acting) this.setState(this.dir ? 'move' : 'stand');
  }
  /**
   * An NPC we control (one that stays put): once its 3-9s wait is up, with no line up, no action playing and no answer
   * waiting, it picks a number below 50, taken modulo its actions (but the special ones) and lines together. An
   * action (not the shop) goes as 2 + its place, with one of its own lines if it has any; otherwise that line of its
   * own. It sends NPC_ACTION and does nothing until the server sends it back (npcActed).
   */
  npcAsk(dt) {
    if ((this.actT -= dt) > 0 || this.chat || this.acting || this.npcWaiting) return;
    this.actT = (3000 + Math.floor(Math.random() * 6000)) / 1000;
    const L = this.npcLists, n = L.actions.filter((a) => !a.special).length, m = L.lines.length;
    if (!(n + m)) return;
    const r = npcRoll() % (n + m);
    let action = -1, chat;
    if (r < n && !L.actions[r].shop) { action = r + 2; const k = L.actions[r].lines.length; chat = k ? npcRoll() % k : -1; }
    else chat = r - n;
    this.npcWaiting = true;
    this.onNpcAction(this, action, chat);
  }
  /** NPC_ACTION back from the server: play that action (from 2) and say that line, or say that line of its own (-1). */
  npcActed(action, chat) {
    this.npcWaiting = false;
    const L = this.npcLists;
    if (!L) return;
    const say = (lines) => { if (chat >= 0 && chat < lines.length && !this.questIcon) this.chat = { text: lines[chat], t: 5 }; };
    if (action === -1) { say(L.lines); return; }
    const a = L.actions[action - 2];
    if (!a) return;
    if (this.anims[a.action]) { this.acting = a.action; this.setState(a.action); }
    say(a.lines);
  }
  npcWalk(dt) {
    const s = this.spawn;
    if (this.acting) this.vx = approach(this.vx, 0, 400 * dt);
    else {
      if ((this.moveT -= dt) <= 0) {
        const walk = Math.random() < 0.2;
        this.dir = walk ? (Math.random() < 0.5 ? -1 : 1) : 0;
        this.moveT = Math.floor((walk ? 500 + Math.random() * 1000 : 1000 + Math.random() * 2000) / 90) * 0.09;
      }
      const k = this.swimming() ? PHYS.swimDec : 1;
      this.vx = this.dir ? accelerate(this.vx, this.dir * PHYS.walkAccel * k, this.speed * k, dt) : approach(this.vx, 0, PHYS.walkBrake * dt);
      if (this.dir) this.facingRight = this.dir > 0;
    }
    const { x, y, fh } = this;
    const want = this.x + this.vx * dt, to = Math.max(s.rx0, Math.min(s.rx1, want));
    if (to !== want) this.vx = 0;
    if (to !== x && this.footholds.walk(this, to - x) !== 'ok') { this.x = x; this.y = y; this.fh = fh; this.vx = 0; }
    // held up at an end: turn back (and give up if that way is blocked too)
    if (this.dir && !this.acting && dt > 0 && this.x === x) { this.dir = this.turned ? 0 : -this.dir; this.turned = true; } else this.turned = false;
  }

  /**
   * Its next move, as the client's monster AI makes it (every 30ms; its waits are counted in 90ms units). Left alone
   * it walks left, walks right or stands, picked evenly, for 0.33-1s at a time; one that jumps jumps instead one
   * time in five. Chasing, it heads for its target, aiming again every 0.27-0.4s: within 100px it keeps going the
   * way it was (so it walks past and back) unless it reaches the map's side. One that jumps and stands under the
   * platform its target is on jumps up to it.
   */
  think(dt) {
    const t = this.aggro;
    if (t && this.canJump && this.underTarget(t) && Math.random() < 1 - (2 / 3) ** (dt / 0.03)) {
      this.dir = 0; this.timer = 0; this.jump(); return;
    }
    if ((this.timer -= dt) > 0) return;
    if (t) {
      this.timer = aiWait(800, 400);
      if (!this.dir || Math.abs(t.x - this.x) > 99) this.dir = t.x >= this.x ? 1 : -1;
      else if (this.x <= this.footholds.left) this.dir = 1;
      else if (this.x >= this.footholds.right) this.dir = -1;
    } else if (this.canJump && Math.random() < 0.2) {
      this.jump(); return;
    } else {
      this.timer = aiWait(1000, 2000);
      this.dir = Math.floor(Math.random() * 3) - 1;
    }
    this.walkState();
  }
  /** Its target stands on another platform above it that reaches over where it is. */
  underTarget(t) {
    const tf = t.fh;
    if (!tf || !this.fh || tf.group === this.fh.group || t.y >= this.y) return false;
    const g = this.footholds.groups?.get(tf.group);
    return !!g && this.x >= g.x1 && this.x < g.x2;
  }
  /** Walking (its chase pose when it has one and is chasing) or standing, facing the way it goes. */
  walkState() {
    if (this.dir) this.facingRight = this.dir > 0;
    this.setState(!this.dir ? 'stand' : this.aggro && this.anims.chase ? 'chase' : 'move');
  }
  /** One that can't move still turns to face whoever it is chasing, every 0.27-0.4s. */
  faceTarget(dt) {
    if (!this.aggro || (this.timer -= dt) > 0) return;
    this.timer = aiWait(800, 400);
    this.facingRight = this.aggro.x >= this.x;
  }
  /** A jump: up at the jump speed a character has (555px/s), keeping its walking speed the way it goes. */
  jump() {
    if (!this.fh) return;
    this.fh = null; this.vy = -PHYS.jump * (this.swimming() ? 0.7 : 1); this.vx = this.dir * this.walkSpeed;
    this.setState(this.anims.jump ? 'jump' : 'move');
  }
  /** It walks along its floor; a platform's edge or a wall stops it (standing) until its next move. */
  walkStep(dt) {
    const fh = this.fh, x = this.x, y = this.y;
    if (this.footholds.walk(this, this.dir * this.walkSpeed * (this.swimming() ? PHYS.swimDec : 1) * dt) !== 'ok') {
      this.fh = fh; this.x = x; this.y = y;
      this.setState('stand');
    }
  }
  /**
   * A flyer flies to one spot after another. Left alone it picks a platform of the map at random and spots over its
   * floors (up to 60px above one), moving on to another platform after (its width + 40-240) / 8 spots. Chasing, its
   * spots are within 120px left or right and 40px up or down of its target, picked again when it gets there or the
   * target moves 150px away from the spot; after 60-119 of those it gives up the chase.
   */
  flyStep(dt) {
    const t = this.aggro, d = this.dest;
    if (!d || (t && (Math.abs(t.x - d.x) > 150 || Math.abs(t.y - d.y) > 150))) this.dest = this.flySpot(t);
    const to = this.dest;
    this.setState('fly');
    if (!to) return;
    const dx = to.x - this.x, dy = to.y - this.y, v = this.flySpeed * dt;
    if (Math.abs(dx) > 9) this.facingRight = dx > 0;
    this.x += Math.sign(dx) * Math.min(Math.abs(dx), v);
    this.y += Math.sign(dy) * Math.min(Math.abs(dy), v);
    if (Math.abs(to.x - this.x) <= 11 && Math.abs(to.y - this.y) <= 11) this.dest = null;
  }
  flySpot(t) {
    const rnd = (n) => Math.floor(Math.random() * n);
    if (t) {
      if (!this.chaseSpots) this.chaseSpots = 60 + rnd(60);
      if (--this.chaseSpots < 1) { this.aggro = this.chased = null; this.chaseSpots = 0; }
      return { x: t.x + rnd(240) - 120, y: t.y + rnd(80) - 40 };
    }
    const groups = [...(this.footholds.groups?.values() || [])];
    if (!groups.length) return null;
    if (!this.flyGroup || this.flySpots < 1) {
      this.flyGroup = groups[rnd(groups.length)];
      this.flySpots = (this.flyGroup.x2 - this.flyGroup.x1 + 40 + rnd(200)) >> 3;
    }
    this.flySpots--;
    const f = this.flyGroup.floors[rnd(this.flyGroup.floors.length)], x = f.x1 + rnd(Math.max(1, f.x2 - f.x1));
    return { x, y: Footholds.yAt(f, x) - rnd(60) };
  }

  draw(ctx, cam, assets) {
    if (this.respawnTimer > 0) return;
    // an NPC imitating a character: that character instead of its own art, with its name tag
    if (this.drawAvatar) {
      const sx = snapPx(this.x - cam.x), sy = snapPx(this.y - cam.y);
      this.drawAvatar(ctx, sx, sy);
      if (this.name && !this.hideName) nameTag(ctx, this.name, sx, sy + 4, '#ff0');
      return;
    }
    if (this.appearing) return;
    const doomArt = this.doomArt, doom = doomArt?.[this.state === 'move' ? 'move' : 'stand']?.node;
    const node = doom && assets.image(doom) ? doom : this.node;
    const img = assets.image(node);
    if (!img) return;
    const o = node.origin || [0, 0];
    const sx = snapPx(this.x - cam.x), sy = snapPx(this.y - cam.y);
    ctx.save();
    if (this.fadeInAt !== undefined) {
      const k = (performance.now() - this.fadeInAt) / 800;
      if (k >= 1) delete this.fadeInAt; else ctx.globalAlpha *= Math.max(0, k);
    }
    ctx.translate(sx, sy);
    // info/noFlip art (e.g. a tutorial monster carrying a key sign) is never mirrored
    if (this.facesRight) ctx.scale(-1, 1);
    if (this.frozen) ctx.filter = 'sepia(1) hue-rotate(170deg) saturate(2.5) brightness(1.05)';   // iced over
    ctx.drawImage(img, -o[0], -o[1]);
    ctx.restore();
    this.drawStatus(ctx, cam, assets, node);
    // a Maple TV's two screens, their top-left corners at info/MapleTVmsg and MapleTVad from its feet
    for (const s of this.tv ? [this.tv.msg, this.tv.ad] : []) {
      const scr = assets.image(s.anim.node);
      if (scr) ctx.drawImage(scr, sx + s.x, sy + s.y);
    }

    if (this.name && this.kind === 'Npc' && !this.hideName) {
      const { h } = nameTag(ctx, this.name, sx, sy + 4, '#ff0');
      if (this.func) nameTag(ctx, this.func, sx, sy + 4 + h + 1, '#ff0');
    }
  }

  /** Bounding box of the current frame in world space. */
  box() {
    const n = this.node; const o = n?.origin || [0, 0];
    const w = n?._w || 40, h = n?._h || 40;
    const left = this.facesRight ? this.x + o[0] - w : this.x - o[0];
    return { left, right: left + w, top: this.y - o[1], bottom: this.y - o[1] + h };
  }
  /**
   * The body attacks and touches test against (the client's mob receiver): the frame's own lt/rb, which can be
   * far from the picture's size, mirrored when it faces right; a frame without one falls back to the picture.
   * withPrevious adds where it stood last frame, as target selection does, so one step can't carry it out of a swing.
   */
  /** Which way its art and reach face: right, unless it is noFlip (Horntail's and Zakum's parts never turn). */
  get facesRight() { return this.facingRight && !Number(this.src?.info?.noFlip); }
  /** Whether this frame has a body (lt/rb): one without (Papulatus pulling itself in, an invisible part) can't be struck or touch you. */
  get hasBody() { return !!(this.node?.lt && this.node?.rb); }
  /** Its body for what shows over it (damage numbers): this frame's lt/rb, or the last frame's that had one (a death pose has none). */
  bodyBox() {
    const n = this.node?.lt && this.node?.rb ? (this.lastBody = this.node) : this.lastBody;
    if (!n) return null;
    return this.facesRight ? { left: this.x - n.rb[0], right: this.x - n.lt[0], top: this.y + n.lt[1], bottom: this.y + n.rb[1] }
      : { left: this.x + n.lt[0], right: this.x + n.rb[0], top: this.y + n.lt[1], bottom: this.y + n.rb[1] };
  }
  hitBox(withPrevious = false) {
    const n = this.node;
    if (!n?.lt || !n?.rb) return this.box();
    this.lastBody = n;
    const at = (x, y) => (this.facesRight
      ? { left: x - n.rb[0], right: x - n.lt[0], top: y + n.lt[1], bottom: y + n.rb[1] }
      : { left: x + n.lt[0], right: x + n.rb[0], top: y + n.lt[1], bottom: y + n.rb[1] });
    const b = at(this.x, this.y);
    if (!withPrevious || this.prevX === undefined) return b;
    const p = at(this.prevX, this.prevY);
    return { left: Math.min(b.left, p.left), right: Math.max(b.right, p.right), top: Math.min(b.top, p.top), bottom: Math.max(b.bottom, p.bottom) };
  }
}

const TAG_FONT = '12px Arial';
const argb = (clr) => `#${((Number(clr) >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;

/**
 * A plain tag centred on x with its top at y: a dark box (1px cut corners), the text 2px in. icon: room left of the box
 * for an icon; white: the White Label Ring look. Returns the whole tag's left and height.
 */
export function nameTag(ctx, text, x, y, color = '#fff', { icon = 0, white = false } = {}) {
  x = snapPx(x); y = snapPx(y);   // on the canvas's grid, as the character it hangs under
  ctx.font = white ? `bold ${TAG_FONT}` : TAG_FONT;
  const w = Math.ceil(ctx.measureText(text).width) + 5, h = 16, left = x - Math.floor((w + icon) / 2), bx = left + icon;
  if (white) {
    ctx.fillStyle = '#2c80ad';
    ctx.fillRect(bx, y, w, 1); ctx.fillRect(bx, y + h - 1, w, 1); ctx.fillRect(bx, y + 1, 1, h - 2); ctx.fillRect(bx + w - 1, y + 1, 1, h - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.698)';
    ctx.fillRect(bx + 1, y + 1, w - 2, h - 2);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.627)';
    ctx.fillRect(bx + 1, y, w - 2, 1); ctx.fillRect(bx, y + 1, w, h - 2); ctx.fillRect(bx + 1, y + h - 1, w - 2, 1);
  }
  ctx.fillStyle = white ? '#000' : color;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, bx + 2, y + 11);
  return { left, h };
}

/**
 * A tag from UI/NameTag.img art (w, c tiled under the text, e, text in clr) centred on x with its top at y.
 * Returns its height, 0 while its art is loading, -1 when there is no art.
 */
export function artTag(ctx, assets, N, text, x, y, font = TAG_FONT) {
  // (on the canvas's grid, as the character it hangs under)
  if (!N?.w || !N?.c || !N?.e) return -1;
  const w = assets.image(N.w), c = assets.image(N.c), e = assets.image(N.e);
  if (!w || !c || !e) return 0;
  x = snapPx(x); y = snapPx(y);
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width), mid = Math.max(1, Math.ceil(tw / c.width)) * c.width;
  const ox = (n, d) => n.origin?.[0] ?? d, oy = (n) => n.origin?.[1] ?? 0, wo = ox(N.w, w.width);
  const cy = Math.max(oy(N.w), oy(N.c), oy(N.e));
  const h = cy + Math.max(w.height - oy(N.w), c.height - oy(N.c), e.height - oy(N.e));
  const left = x - Math.floor((wo + mid + e.width - ox(N.e, 0)) / 2);
  ctx.drawImage(w, left, y + cy - oy(N.w));
  for (let k = 0; k < mid; k += c.width) ctx.drawImage(c, left + wo + k, y + cy - oy(N.c));
  ctx.drawImage(e, left + wo + mid - ox(N.e, 0), y + cy - oy(N.e));
  ctx.fillStyle = argb(N.clr);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, left + wo + Math.floor((mid - tw) / 2), y + cy - 2 + 11);
  return h;
}

export { PHYS };
