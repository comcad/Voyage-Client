import { pad, isCanvas, frames } from './assets.js';
import { Footholds, PHYS } from './physics.js';

const HTILE = new Set([1, 3, 4, 6, 7]);
const VTILE = new Set([2, 3, 5, 6, 7]);
const HSCROLL = new Set([4, 6]);
const VSCROLL = new Set([5, 7]);

export function mapPath(id) {
  return `Map/Map/Map${Math.floor(id / 100000000)}/${pad(id, 9)}.img`;
}

/**
 * Animation over numbered canvas frames, each with its own `delay`.
 * Frames may fade: alpha goes from `a0` to `a1` (0-255) across the frame's delay.
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
    if (kind === 'Npc') e.lines = npcLines(src, strings?.[Number(spawn.id)]);
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

/** The lines an NPC says over its head: String/Npc.img entries named by info/speak, else by its actions' speak. */
function npcLines(src, str) {
  const keys = (n) => Object.values(n?.speak || {});
  let ks = keys(src.info);
  if (!ks.length) ks = Object.entries(src).filter(([k, v]) => k !== 'info' && !v?.special).flatMap(([, v]) => keys(v));
  return [...new Set(ks)].map((k) => str?.[k]).filter((t) => typeof t === 'string' && t.trim());
}

/** NPC or monster placed by the map's `life` list. */
export class Life {
  constructor(kind, spawn, src, name, fh, footholds) {
    this.kind = kind; this.spawn = spawn; this.src = src; this.name = name;
    this.footholds = footholds;
    this.x = spawn.x; this.y = fh ? Footholds.yAt(fh, spawn.x) : spawn.cy; this.fh = fh;
    this.facingRight = !!spawn.f;   // f=1 mirrors the art, for NPCs and monsters alike
    this.maxHp = src.info?.maxHP || 1; this.hp = this.maxHp;
    // Mob speed, as the client does it (Journey's Mob): a force of (speed + 100) / 1000 per 8ms tick
    // against ground friction settles at 7.5x that, i.e. (speed + 100) * 0.78 px/s at our walk speed;
    // flyers use flySpeed the same way against air friction.
    const info = src.info || {};
    this.speed = Math.max(0, (info.speed ?? 0) + 100) * 0.78;
    this.flySpeed = Math.max(0, (info.flySpeed ?? 0) + 100) * 0.9;
    this.flying = kind === 'Mob' && !!src.fly && !src.move;
    this.canMove = kind === 'Mob' && (this.flying ? this.flySpeed > 0 : !!src.move && this.speed > 0);
    this.canJump = kind === 'Mob' && !!src.jump;
    this.anims = {};
    for (const k of ['stand', 'move', 'jump', 'hit1', 'die1', 'fly', 'regen']) if (src[k]) this.anims[k] = new Anim(src[k], !['die1', 'hit1', 'regen'].includes(k));
    // an NPC's other actions (say, eye...) play now and then; `special` ones are left to scripts
    this.actions = kind === 'Npc' ? Object.keys(src).filter((k) => !['info', 'stand', 'move'].includes(k) && !src[k]?.special && frames(src[k]).some(isCanvas)) : [];
    for (const k of this.actions) this.anims[k] = new Anim(src[k], false);
    this.lines = [];
    this.idleT = 2 + Math.random() * 4; this.walkT = Math.random() * 9; this.talkT = Math.random() * 5;
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
    this.timer = 1 + Math.random() * 3;
    this.aggro = null;        // the character it chases once hit (or told to by the server)
    this.vx = 0; this.vy = 0; this.baseY = this.y; this.bob = Math.random() * 6;
    this.respawnTimer = 0;
    // network state: oid set for server-spawned life; `controlled` = we run its AI and report moves
    this.oid = spawn.oid ?? null;
    this.controlled = false;
    this.path = null;       // remote movement being replayed
    this.removed = false;
    this.lastSent = { x: this.x, y: this.y, state: this.state, facingRight: this.facingRight };
  }

  get online() { return this.oid !== null; }

  /** Replay a movement list from the server (MOVE_MONSTER). */
  applyMovement(start, moves) {
    const steps = moves.filter((m) => m.x !== undefined);
    if (!steps.length) return;
    this.path = { steps, i: 0, t: 0, fromX: this.x, fromY: this.y };
    const last = steps[steps.length - 1];
    this.facingRight = !(last.stance & 1);
  }

  _replay(dt) {
    const p = this.path, s = p.steps[p.i];
    const dur = Math.max(1, s.duration || 100) / 1000;
    p.t += dt;
    const k = Math.min(1, p.t / dur);
    this.x = p.fromX + (s.x - p.fromX) * k;
    this.y = p.fromY + (s.y - p.fromY) * k;
    this.setState(Math.abs(s.x - p.fromX) > 1 ? 'move' : (this.anims.stand ? 'stand' : 'fly'));
    if (k >= 1) {
      p.fromX = s.x; p.fromY = s.y; p.t = 0; p.i++;
      if (p.i >= p.steps.length) { this.path = null; this.setState(this.anims.stand ? 'stand' : this.state); }
    }
  }

  /** KILL_MONSTER: play the death animation then disappear. */
  kill() { this.setState('die1'); this.dying = true; if (!this.anims.die1) this.removed = true; }

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
    if (this.fh && !this.flying && (this.controlled || !this.online)) { this.recoil = (fromRight ? -1 : 1) * (strong ? 300 : 130); this.recoilBrake = strong ? 200 : 400; }
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
    if (!this.frozen) anim?.update(dt * 1000);   // frozen solid: its picture stops too
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
    if (this.online) {
      if (this.state === 'die1') { if (anim?.done || !anim) this.removed = true; return; }
      if (this.recoil && this.fh) this.recoilStep(dt);
      if (this.state === 'hit1') { this.hitTimer -= dt; if (this.hitTimer <= 0) this.setState(this.flying ? 'fly' : 'stand'); return; }
      if (this.path) { this._replay(dt); return; }
      if (!this.controlled) return;
    }
    if (this.held) return;
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
    if ((this.fh || this.flying) && this.tryAttack(dt)) return;
    if (!this.canMove) return;
    if (this.flying) { this.flyStep(dt); return; }
    if (!this.fh) {                                   // mid-jump (or knocked off a ledge)
      this.footholds.fall(this, dt);
      if (this.fh) { this.vx = 0; this.setState('move'); }
      return;
    }
    this.think(dt);
    if (this.state === 'move') this.walkStep(dt);
  }

  /**
   * Wander like the client's mobs: walk a while, pause a little, now and then turn round (and hop,
   * if it has a jump). Once something has hit it, it turns to follow that character instead,
   * stopping at its platform's edges rather than walking off.
   */
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
  get walkSpeed() {
    let mod = 0;
    if (this.status.second & MOB_SPEED) for (const e of this.statusArt.values()) if (e.second & MOB_SPEED) mod = e.value || 0;
    const doom = this.doomArt;
    return Math.max(0, doom ? (doom.speed + 100) * 0.78 : this.speed + mod * 0.78);
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

  /** An NPC idles: a line every 5-10s (each up for 5s), an action now and then, and short walks within rx0-rx1. */
  npcStep(dt) {
    if (this.chat && (this.chat.t -= dt) <= 0) { this.chat = null; this.talkT = Math.random() * 5; }
    else if (!this.chat && this.lines.length && (this.talkT -= dt) <= 0) this.chat = { text: this.lines[Math.floor(Math.random() * this.lines.length)], t: 5 };
    this.walkT -= dt;
    if (this.walkTo !== undefined) { this.npcWalk(dt); return; }
    if (this.state !== 'stand') { if (this.anims[this.state]?.done !== false) this.setState('stand'); return; }
    if ((this.idleT -= dt) > 0) return;
    this.idleT = 2 + Math.random() * 4;
    const s = this.spawn;
    if (this.anims.move && this.fh && s.rx1 > s.rx0 && this.walkT <= 0) {
      this.walkT = 3 + Math.random() * 7;
      const d = (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 75), to = Math.max(s.rx0, Math.min(s.rx1, this.x + d));
      if (Math.abs(to - this.x) < 5) return;
      this.walkTo = to; this.facingRight = to > this.x; this.setState('move');
      return;
    }
    if (this.actions.length) this.setState(this.actions[Math.floor(Math.random() * this.actions.length)]);
  }
  npcWalk(dt) {
    const left = this.walkTo - this.x, fh = this.fh, x = this.x, y = this.y;
    const res = this.footholds.walk(this, Math.sign(left) * Math.min(Math.abs(left), this.speed * dt));
    if (res !== 'ok') { this.fh = fh; this.x = x; this.y = y; }
    if (res !== 'ok' || Math.abs(this.walkTo - this.x) < 0.5) { this.walkTo = undefined; this.setState('stand'); }
  }

  think(dt) {
    const t = this.aggro;
    if (t) {
      const dx = t.x - this.x;
      // a Puppet stops it a little short, up against it; a character it walks right up to
      if (Math.abs(dx) > (t.reach || 8)) { this.facingRight = dx > 0; this.setState('move'); } else { this.facingRight = dx > 0; this.setState('stand'); }
      if (this.canJump && t.y < this.y - 40 && Math.abs(dx) < 120 && Math.random() < dt * 0.8) this.jump();
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.state === 'move' && Math.random() < 0.35) { this.setState('stand'); this.timer = 0.6 + Math.random() * 1.4; return; }
    this.setState('move');
    if (Math.random() < 0.4) this.facingRight = !this.facingRight;
    if (this.canJump && Math.random() < 0.15) this.jump();
    this.timer = 1.5 + Math.random() * 2.5;
  }
  jump() {
    if (!this.fh) return;
    this.fh = null; this.vy = -420; this.vx = (this.facingRight ? 1 : -1) * this.walkSpeed;
    this.setState(this.anims.jump ? 'jump' : 'move');
  }
  walkStep(dt) {
    const dx = (this.facingRight ? 1 : -1) * this.walkSpeed * dt;
    const fh = this.fh, x = this.x, y = this.y;
    const res = this.footholds.walk(this, dx);
    const s = this.spawn;
    if (res !== 'ok' || this.x < s.rx0 || this.x > s.rx1) {
      this.fh = fh; this.x = x; this.y = y;
      if (this.aggro) this.setState('stand');           // a chaser waits at the edge
      else this.facingRight = !this.facingRight;
    }
  }
  /** Flyers drift back and forth around where they spawned, bobbing; a chaser closes in on its target. */
  flyStep(dt) {
    this.bob += dt * 2.2;
    const t = this.aggro, home = this.spawn.x;
    let tx, ty;
    if (t) { tx = t.x; ty = Math.max(this.baseY - 120, Math.min(this.baseY + 60, t.y - 30)); }
    else {
      this.timer -= dt;
      if (this.timer <= 0) { this.timer = 2 + Math.random() * 3; this.facingRight = Math.random() < 0.5 ? this.x < home : !this.facingRight; }
      tx = this.x + (this.facingRight ? 1 : -1) * 50; ty = this.baseY;
      if (Math.abs(this.x - home) > 220) this.facingRight = this.x < home;
    }
    const dx = tx - this.x;
    if (Math.abs(dx) > 6) { this.facingRight = dx > 0; this.x += Math.sign(dx) * Math.min(Math.abs(dx), this.flySpeed * dt); }
    const goal = ty + Math.sin(this.bob) * 10;
    this.y += Math.max(-this.flySpeed * dt, Math.min(this.flySpeed * dt, goal - this.y));
    this.setState('fly');
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
    if (this.kind === 'Mob' && this.hp < this.maxHp && this.state !== 'die1') {
      const w = 50, top = sy - o[1] - 10;
      ctx.fillStyle = '#000'; ctx.fillRect(sx - w / 2 - 1, top - 1, w + 2, 6);
      ctx.fillStyle = '#e33'; ctx.fillRect(sx - w / 2, top, w * Math.max(0, this.hp / this.maxHp), 4);
    }
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
