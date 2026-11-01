import { pad, isCanvas, frames } from './assets.js';
import { Footholds, PHYS, accelerate, approach } from './physics.js';

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
      else if (this.loop) this.i = 0;
      else { this.done = true; return; }
    }
  }
  reset() { this.i = 0; this.t = 0; this.done = false; }
}

export class GameMap {
  constructor(assets, id) {
    this.assets = assets; this.id = id;
    this.backs = []; this.layers = []; this.life = []; this.portals = [];
    this.scroll = 0;
  }

  /** Build an NPC/mob from its WZ data. spawn: {id, x, cy, f, fh, rx0, rx1}. */
  async createLife(kind, spawn) {
    const a = this.assets;
    let src = await a.json(`${kind}/${pad(spawn.id, 7)}.img`);
    if (src?.info?.link) src = (await a.json(`${kind}/${pad(src.info.link, 7)}.img`)) || src;
    if (!src) return null;
    const strings = this.strings?.[kind];
    const name = strings?.[Number(spawn.id)]?.name || '';
    const fh = this.fh.get(spawn.fh) || this.fh.below(spawn.x, spawn.cy - 5, 60);
    const e = new Life(kind, spawn, src, name, fh, this.fh);
    if (kind === 'Npc' && src.info?.MapleTV) e.tv = mapleTV(await a.json('UI/MapleTV.img'), src.info);
    if (kind === 'Npc') e.picks = npcPicks(src, strings?.[Number(spawn.id)]);
    await a.preload(e.allFrames());
    return e;
  }

  async load(onStatus, opts = {}) {
    const a = this.assets;
    onStatus?.('Loading map data...');
    // opts.path loads a map-format .img from elsewhere (e.g. UI/MapLogin.img for the login scene)
    const data = await a.json(opts.path || mapPath(this.id));
    if (!data) throw new Error(`Map ${this.id} not found`);
    this.data = data;
    this.info = data.info || {};
    this.fh = new Footholds(data.foothold);
    this.ladders = Object.values(data.ladderRope || {});

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
    for (const b of Object.values(data.back || {})) {
      if (!b.bS) continue;
      const set = await a.json(`Map/Back/${b.bS}.img`);
      const node = set?.[b.ani === 1 ? 'ani' : 'back']?.[b.no];
      if (!node || b.ani === 2) continue;
      this.backs.push({ ...b, anim: new Anim(node) });
    }

    onStatus?.('Loading tiles and objects...');
    for (let l = 0; l < 8; l++) {
      const layer = data[l] || {};
      const objs = [], tiles = [];
      for (const o of Object.values(layer.obj || {})) {
        const set = await a.json(`Map/Obj/${o.oS}.img`);
        const node = set?.[o.l0]?.[o.l1]?.[o.l2];
        if (node) objs.push({ ...o, anim: new Anim(node) });
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

  ladderAt(x, y, up) {
    return this.ladders.find((l) => Math.abs(l.x - x) < 12 &&
      (up ? y > l.y1 && y <= l.y2 + 5 : y >= l.y1 - 10 && y < l.y2));
  }

  update(dt) {
    const ms = dt * 1000;
    this.scroll += dt;
    for (const b of this.backs) b.anim.update(ms);
    for (const l of this.layers) for (const o of l.objs) o.anim.update(ms);
    for (const p of this.portals) {
      p.anim?.update(ms);
      if (p.phase === 'start' && p.anim.done) { p.anim = new Anim(p.hidden.cont); p.phase = 'cont'; }
      else if (p.phase === 'exit' && p.anim.done) { p.anim = null; p.phase = null; }
    }
    for (const e of this.life) e.update(dt);
  }

  drawBacks(ctx, cam, front) {
    for (const b of this.backs) if (!!b.front === front) this.drawBack(ctx, cam, b);
  }

  drawBack(ctx, cam, b) {
    const node = b.anim.node;
    const img = this.assets.image(node);
    if (!img) return;
    const o = node.origin || [0, 0];
    const W = cam.w, H = cam.h;
    let x, y;
    if (HSCROLL.has(b.type)) x = b.x + this.scroll * b.rx * 5 - cam.x;
    else x = b.x + (cam.x + W / 2) * (100 + b.rx) / 100 - cam.x;
    if (VSCROLL.has(b.type)) y = b.y + this.scroll * b.ry * 5 - cam.y;
    else y = b.y + (cam.y + H / 2) * (100 + b.ry) / 100 - cam.y;
    x -= o[0]; y -= o[1];
    if (b.f) x -= img.width - 2 * o[0];

    const cx = b.cx || img.width, cy = b.cy || img.height;
    let xs = [x], ys = [y];
    if (HTILE.has(b.type) && cx > 0) { xs = []; for (let s = ((x % cx) + cx) % cx - cx; s < W; s += cx) xs.push(s); }
    if (VTILE.has(b.type) && cy > 0) { ys = []; for (let s = ((y % cy) + cy) % cy - cy; s < H; s += cy) ys.push(s); }

    ctx.save();
    ctx.globalAlpha = ((b.a ?? 255) / 255) * b.anim.alpha;
    for (const dy of ys) for (const dx of xs) drawImg(ctx, img, dx, dy, b.f);
    ctx.restore();
  }

  drawLayer(ctx, cam, l) {
    const layer = this.layers[l];
    if (!layer) return;
    for (const o of layer.objs) {
      const node = o.anim.node;
      const img = this.assets.image(node);
      if (!img) continue;
      const or = node.origin || [0, 0];
      const x = o.f ? o.x + or[0] - img.width : o.x - or[0];
      const alpha = o.anim.alpha;
      if (alpha <= 0) continue;
      if (alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; }
      drawImg(ctx, img, x - cam.x, o.y - or[1] - cam.y, o.f);
      if (alpha < 1) ctx.restore();
    }
    for (const t of layer.tiles) {
      const img = this.assets.image(t.node);
      if (!img) continue;
      const or = t.node.origin || [0, 0];
      ctx.drawImage(img, Math.round(t.x - or[0] - cam.x), Math.round(t.y - or[1] - cam.y));
    }
  }

  drawPortals(ctx, cam) {
    for (const p of this.portals) {
      if (!p.anim?.node) continue;
      const img = this.assets.image(p.anim.node);
      if (!img) continue;
      const o = p.anim.node.origin || [0, 0];
      ctx.drawImage(img, Math.round(p.x - o[0] - cam.x), Math.round(p.y - o[1] - cam.y));
    }
  }
}

function drawImg(ctx, img, x, y, flip) {
  x = Math.round(x); y = Math.round(y);
  if (!flip) { ctx.drawImage(img, x, y); return; }
  ctx.save();
  ctx.translate(x + img.width, y);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
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
/** A monster AI wait: `base` + up to `spread` ms, counted in 90ms units of its 30ms ticks (so a third as long). */
/** What a planned path's stand-in leaves behind for the path to play out rather than taking over. */
/**
 * The action a knock-back or pull goes out with: hit (6) << 1. With an action, those watching drop the path they
 * were still playing and take this one at once; without one it would only queue up behind it.
 */
const HIT_ACTION = 6 << 1;
const PLAYED = new Set(['x', 'y', 'fh', 'state', 'facingRight', 'prevX', 'prevY', 'setState']);
/** How much of a path is still to play, in ms. */
const pathLeft = (p) => p.steps.slice(p.i).reduce((t, s) => t + s.duration, 0) - p.t;
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
    this.path = null;       // remote movement being replayed
    this.removed = false;
  }

  get online() { return this.oid !== null; }

  /**
   * A path from its controller (MOVE_MONSTER): its points are queued after whatever is still to play, as the client
   * does it (one with an action starts afresh). More than 5s behind, it jumps to the end.
   */
  applyMovement(start, moves, act = -1) {
    const steps = moves.filter((m) => m.x !== undefined).map((m) => ({ ...m, duration: Math.max(0, m.duration || 0) }));
    // a path with an action (a blow, an attack, a skill) replaces what was still to play, from where it is now
    if (act >= 0 && this.path) this.path = null;
    if (!steps.length) return;
    const p = this.path || (this.path = { steps: [], i: 0, t: 0, fromX: this.x, fromY: this.y });
    p.steps = p.steps.slice(p.i).concat(steps); p.i = 0;
    if (pathLeft(p) > 5000) { const last = steps[steps.length - 1]; this.path = null; this.x = last.x; this.y = last.y; this.takePose(last); }
  }
  /**
   * Play its path: each point is where it is at the end of that point's time, in that pose and facing, and it glides
   * there in a straight line. A path more than a second behind plays faster until it has caught up.
   */
  _replay(dt, keepPose = false) {
    const p = this.path;
    const left = pathLeft(p);
    p.t += dt * 1000 * (left > 1000 && !this.controlled ? left / 1000 : 1);   // one we control plays its own plan in real time
    while (p.i < p.steps.length) {
      const s = p.steps[p.i];
      if (!keepPose) this.takePose(s);
      if (p.t < s.duration) {
        const k = p.t / s.duration;
        this.x = p.fromX + (s.x - p.fromX) * k; this.y = p.fromY + (s.y - p.fromY) * k;
        return;
      }
      p.t -= s.duration; p.fromX = this.x = s.x; p.fromY = this.y = s.y; p.i++;
    }
    this.path = null;
  }
  /** A path point's pose (its stance: 1 walk, 2 stand, 3 jump, 6 fly, 16 chase; bit 0 faces left) and floor. */
  takePose(s) {
    this.facingRight = !(s.stance & 1);
    const pose = { 1: 'move', 2: 'stand', 3: 'jump', 6: 'fly', 16: this.flying ? 'fly' : 'chase' }[s.stance >> 1];
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
    this.path = { steps: moves, i: 0, t: 0, fromX: this.x, fromY: this.y };
    this.onPath?.(this, start, moves);
  }

  /** KILL_MONSTER: its statuses end (a frozen one thaws) and it plays its death animation, then disappears. */
  kill() {
    this.status = { first: 0, second: 0 }; this.statusArt.clear();
    this.setState('die1'); this.dying = true; if (!this.anims.die1) this.removed = true;
  }

  allFrames() { return [...Object.values(this.anims), ...(this.tv ? [this.tv.msg.anim, this.tv.ad.anim] : [])].flatMap((a) => a.frames); }
  get alive() { return this.state !== 'die1' && this.respawnTimer <= 0; }
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
    this.hp -= dmg;
    if (this.online) this.hp = Math.max(0, this.hp); // the server decides death (KILL_MONSTER)
    else if (this.hp <= 0) { this.setState('die1'); return; }
    if (dmg < (this.src.info?.pushed ?? 1)) return;
    if (this.state === 'hit1' && this.hitTimer > 0) return;
    if (this.attacking) return;   // a monster mid-attack keeps its attack pose (the client's)
    this.facingRight = fromRight;
    if (this.anims.hit1) { this.setState('hit1'); this.hitTimer = Math.max(0.3, this.anims.hit1.frames.reduce((t, f) => t + (f.delay || 100), 0) / 1000); }
    // fromRight: the blow came from the right, so it slides away to the left
    if (this.controlled) this.path = null;
    if (this.fh && !this.flying && (this.controlled || !this.online)) { this.recoil = (fromRight ? -1 : 1) * (strong ? 300 : 130); this.recoilBrake = strong ? 200 : 400; }
    if (this.controlled && this.online) this.planHit((this.hitTimer || 0) * 1000);
  }
  /**
   * One we control was struck: as the client does, it plans its next stretch there and then - the blow's slide, then
   * standing in its hit pose until that is over, then its own movement until at least a second is planned (1.65s at
   * most, ending on the ground) - sends it with the hit action (those watching drop what they were still playing and
   * take this) and plays it itself, so everyone sees the same thing.
   */
  planHit(hitMs) {
    const sim = Object.create(this), moves = [], start = { x: Math.round(this.x), y: Math.round(this.y) };
    sim.setState = function (st) { if (this.anims[st]) this.state = st; };
    for (let t = 0; t < 1650; t += 30) {
      if (t >= 1000 && (sim.fh || sim.flying)) break;
      const px = sim.x, py = sim.y;
      if (sim.recoil && sim.fh) sim.recoilStep(0.03);
      else if (t < hitMs) { /* standing in its hit pose */ }
      else { if (sim.state === 'hit1') sim.setState(sim.flying ? 'fly' : 'stand'); sim.step(0.03); }
      const x = Math.round(sim.x), y = Math.round(sim.y), vx = Math.round((sim.x - px) / 0.03), vy = Math.round((sim.y - py) / 0.03);
      const fh = sim.fh?.id || 0, stance = sim.stance, last = moves[moves.length - 1];
      if (last && last.fh === fh && last.stance === stance && Math.sign(last.vx) === Math.sign(vx) && Math.sign(last.vy) === Math.sign(vy)) {
        Object.assign(last, { x, y, vx, vy }); last.duration += 30;
      } else moves.push({ cmd: 0, x, y, vx, vy, fh, stance, duration: 30 });
    }
    for (const k of Object.keys(sim)) if (!PLAYED.has(k) && k !== 'recoil') this[k] = sim[k];
    this.recoil = 0;   // the plan carries the slide now
    this.path = { steps: moves, i: 0, t: 0, fromX: this.x, fromY: this.y };
    this.onPath?.(this, start, moves, HIT_ACTION | (this.facingRight ? 0 : 1));
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
    if (moves.length) this.onPath?.(this, start, moves, HIT_ACTION | (this.facingRight ? 0 : 1));
  }
  /** Drawn in by Monster Magnet: toward pull.x at 1000px/s until within pull.stop of it; a floor's edge or a wall stops it. */
  pullStep(dt) {
    const p = this.pull, left = p.x - this.x;
    if (!this.fh || Math.abs(left) <= p.stop) { this.pull = null; return; }
    const { fh, x, y } = this;
    if (this.footholds.walk(this, Math.sign(left) * Math.min(Math.abs(left) - p.stop, 1000 * dt)) !== 'ok') { this.fh = fh; this.x = x; this.y = y; this.pull = null; }
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
    for (const e of this.statusArt.values()) {
      e.anim?.update(dt * 1000);
      if (e.doom) for (const a of [e.doom.stand, e.doom.move, e.doom.mark]) a?.update(dt * 1000);
    }
    if (this.state === 'regen') { if (anim.done) this.setState(this.flying ? 'fly' : 'stand'); return; }
    if (this.kind === 'Npc') { this.npcStep(dt); return; }
    if (this.attacking) {
      const at = this.attacking;
      at.t += dt * 1000;
      if (!at.landed && at.t >= (Number(at.a.info.attackAfter) || 0)) { at.landed = true; this.onAttackLand?.(this, at.a, at.spots); }
      const posing = this.state.startsWith('attack') || this.state.startsWith('skill');
      if (posing && (!anim || anim.done)) {
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
      if (this.controlled) this.path = null; else if (this.path) { this.path.fromX = this.x; this.path.fromY = this.y; }
      this.pullStep(dt); return;
    }
    if (this.online) {
      if (this.state === 'die1') { if (anim?.done || !anim) this.removed = true; return; }
      if (this.recoil && this.fh) this.recoilStep(dt);
      if (this.state === 'hit1') {
        this.hitTimer -= dt;
        if (this.controlled && this.path) this._replay(dt, true);   // its planned slide, keeping the hit pose
        if (this.hitTimer <= 0) this.setState(this.flying ? 'fly' : 'stand');
        return;
      }
      if (!this.controlled) { if (this.path) this._replay(dt); return; }
    }
    if (this.held) { this.path = null; return; }
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
    if (this.state === 'hit1') { this.hitTimer -= dt; if (this.hitTimer <= 0) this.setState(this.flying ? 'fly' : 'stand'); return; }
    // a chase lasts 3-4 minutes from the last time it was set on someone
    if (this.aggro !== this.chased) { this.chased = this.aggro; this.chaseT = 180 + Math.random() * 60; }
    if (this.aggro && (this.chaseT -= dt) <= 0) this.aggro = this.chased = null;
    if ((this.fh || this.flying) && this.tryAttack(dt)) { this.path = null; return; }   // an attack cuts its path short
    if (this.online) { if (!this.path) this.planPath(); this._replay(dt); return; }
    this.step(dt);
  }
  /** Its AI and movement for one step of `dt` seconds. */
  step(dt) {
    if (!this.canMove) { this.faceTarget(dt); return; }
    if (this.flying) { this.flyStep(dt); return; }
    if (!this.fh) {                                   // mid-jump (or knocked off a ledge)
      this.footholds.fall(this, dt);
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
    const r = a.info.range, s = this.facingRight ? -1 : 1;
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
    const r = a.info.range, w = r.rb[0] - r.lt[0], s = this.facingRight ? -1 : 1, spots = [];
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
    return (cx - this.x) * (this.facingRight ? 1 : -1) >= -10 && Math.hypot(cx - q.sx, cy - q.sy) <= q.r;
  }
  /**
   * Statuses (CMob's temporary stats): `first` / `second` are MonsterStatus mask bits, all from skill `source`,
   * whose art (`anim` looping on it, an `icon` for a monster's own buff) shows while any of them lasts.
   */
  addStatus(first, second, source, art = {}) {
    if (this.state === 'die1') return;   // a status that arrives after it died doesn't take
    this.status.first |= first; this.status.second |= second;
    const e = this.statusArt.get(source) || { first: 0, second: 0 };
    e.first |= first; e.second |= second; Object.assign(e, art);
    this.statusArt.set(source, e);
  }
  removeStatus(first, second) {
    this.status.first &= ~first; this.status.second &= ~second;
    for (const [src, e] of this.statusArt) { e.first &= ~first; e.second &= ~second; if (!e.first && !e.second) this.statusArt.delete(src); }
  }
  /** Its statuses' art over its head (poison bubbles, stun stars...), and its own buffs' icons in a row above. */
  drawStatus(ctx, cam, assets, node) {
    if (!this.statusArt.size) return;
    const head = node?.head, o = node?.origin || [0, 0];
    const hx = this.x + (head ? (this.facingRight ? -head[0] : head[0]) : 0) - cam.x;
    const hy = this.y + (head ? head[1] : -o[1]) - cam.y;
    const icons = [];
    for (const e of this.statusArt.values()) {
      // a one-shot animation (Doom's puff) is gone once played; Doom's puff is at the feet, everything else over the head
      const n = e.anim?.done ? null : e.anim?.node, img = n && assets.image(n);
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
      if (icon) icons.push(icon);
    }
    let x = Math.round(this.x - cam.x - (icons.length * 26) / 2);
    const y = Math.round(this.y - cam.y - o[1] - 34);
    for (const icon of icons) { ctx.drawImage(icon, x, y); x += 26; }
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
  get flySpeed() { return (200 * Math.max(10, Math.min(140, this.flySpeedStat + this.speedMod))) / 100; }
  get speedMod() {
    let mod = 0;
    if (this.status.second & MOB_SPEED) for (const e of this.statusArt.values()) if (e.second & MOB_SPEED) mod = e.value || 0;
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
    if ((this.actT -= dt) <= 0 && !this.chat && !this.acting && this.picks.length) {
      this.actT = 3 + Math.random() * 6;
      const p = this.picks[Math.floor(Math.random() * this.picks.length)];
      if (this.anims[p.action]) { this.acting = p.action; this.setState(p.action); }
      if (p.lines.length && !this.questIcon) this.chat = { text: p.lines[Math.floor(Math.random() * p.lines.length)], t: 5 };
    }
    if (this.walks && this.fh) this.npcWalk(dt);
    if (!this.acting) this.setState(this.dir ? 'move' : 'stand');
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
      this.vx = this.dir ? accelerate(this.vx, this.dir * PHYS.walkAccel, this.speed, dt) : approach(this.vx, 0, PHYS.walkBrake * dt);
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
    this.fh = null; this.vy = -PHYS.jump; this.vx = this.dir * this.walkSpeed;
    this.setState(this.anims.jump ? 'jump' : 'move');
  }
  /** It walks along its floor; a platform's edge or a wall stops it (standing) until its next move. */
  walkStep(dt) {
    const fh = this.fh, x = this.x, y = this.y;
    if (this.footholds.walk(this, this.dir * this.walkSpeed * dt) !== 'ok') {
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
    const doomArt = this.doomArt, doom = doomArt?.[this.state === 'move' ? 'move' : 'stand']?.node;
    const node = doom && assets.image(doom) ? doom : this.node;
    const img = assets.image(node);
    if (!img) return;
    const o = node.origin || [0, 0];
    const sx = Math.round(this.x - cam.x), sy = Math.round(this.y - cam.y);
    ctx.save();
    if (this.fadeInAt !== undefined) {
      const k = (performance.now() - this.fadeInAt) / 800;
      if (k >= 1) delete this.fadeInAt; else ctx.globalAlpha *= Math.max(0, k);
    }
    ctx.translate(sx, sy);
    if (this.facingRight) ctx.scale(-1, 1);
    if (this.frozen) ctx.filter = 'sepia(1) hue-rotate(170deg) saturate(2.5) brightness(1.05)';   // iced over
    ctx.drawImage(img, -o[0], -o[1]);
    ctx.restore();
    this.drawStatus(ctx, cam, assets, node);
    // a Maple TV's two screens, their top-left corners at info/MapleTVmsg and MapleTVad from its feet
    for (const s of this.tv ? [this.tv.msg, this.tv.ad] : []) {
      const scr = assets.image(s.anim.node);
      if (scr) ctx.drawImage(scr, sx + s.x, sy + s.y);
    }

    if (this.name && this.kind === 'Npc' && !Number(this.src.info?.hideName)) nameTag(ctx, this.name, sx, sy + 4, '#ff0');
  }

  /** Bounding box of the current frame in world space. */
  box() {
    const n = this.node; const o = n?.origin || [0, 0];
    const w = n?._w || 40, h = n?._h || 40;
    const left = this.facingRight ? this.x + o[0] - w : this.x - o[0];
    return { left, right: left + w, top: this.y - o[1], bottom: this.y - o[1] + h };
  }
  /**
   * The body attacks and touches test against (the client's mob receiver): the frame's own lt/rb, which can be
   * far from the picture's size, mirrored when it faces right; a frame without one falls back to the picture.
   * withPrevious adds where it stood last frame, as target selection does, so one step can't carry it out of a swing.
   */
  hitBox(withPrevious = false) {
    const n = this.node;
    if (!n?.lt || !n?.rb) return this.box();
    const at = (x, y) => (this.facingRight
      ? { left: x - n.rb[0], right: x - n.lt[0], top: y + n.lt[1], bottom: y + n.rb[1] }
      : { left: x + n.lt[0], right: x + n.rb[0], top: y + n.lt[1], bottom: y + n.rb[1] });
    const b = at(this.x, this.y);
    if (!withPrevious || this.prevX === undefined) return b;
    const p = at(this.prevX, this.prevY);
    return { left: Math.min(b.left, p.left), right: Math.max(b.right, p.right), top: Math.min(b.top, p.top), bottom: Math.max(b.bottom, p.bottom) };
  }
}

export function nameTag(ctx, text, x, y, color = '#fff') {
  ctx.font = '12px "Segoe UI", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(Math.round(x - w / 2), y, Math.round(w), 16);
  ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(text, x, y + 2);
}

export { PHYS };
