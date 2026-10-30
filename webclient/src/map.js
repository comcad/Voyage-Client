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
    const k = Math.min(1, this.t / (f.delay || 100));
    return Math.max(0, Math.min(1, (a0 + (a1 - a0) * k) / 255));
  }
  update(dtMs) {
    // a single still frame only moves on when it plays once (then it ends after its delay, e.g. a
    // one-frame swing trail or death), a looping one just stays
    if (this.done || (this.frames.length < 2 && this.loop) || !this.frames.length) return;
    this.t += dtMs;
    while (this.t >= (this.node.delay || 100)) {
      if (this.holdLast && this.i === this.frames.length - 1) { this.t = 0; return; }
      this.t -= this.node.delay || 100;
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

    for (const [k, p] of Object.entries(data.portal || {})) {
      const anim = p.pt === 2 ? new Anim(helper?.portal?.game?.pv) : null;
      this.portals.push({ ...p, idx: Number(k), anim });
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
    if (this.data?.miniMap?.canvas) out.push(this.data.miniMap.canvas);
    return out;
  }

  spawnPortal(name) {
    return this.portals.find((p) => p.pn === name) || this.portals.find((p) => p.pt === 0) || this.portals[0] || { x: 0, y: 0 };
  }

  portalById(idx) {
    return this.portals.find((p) => p.idx === idx) || this.spawnPortal(null);
  }

  portalAt(x, y) {
    return this.portals.find((p) => p.pt !== 0 && (p.tm !== 999999999 || p.script) && Math.abs(p.x - x) < 30 && y - p.y < 40 && p.y - y < 80);
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
    for (const p of this.portals) p.anim?.update(ms);
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

/** NPC or monster placed by the map's `life` list. */
export class Life {
  constructor(kind, spawn, src, name, fh, footholds) {
    this.kind = kind; this.spawn = spawn; this.src = src; this.name = name;
    this.footholds = footholds;
    this.x = spawn.x; this.y = fh ? Footholds.yAt(fh, spawn.x) : spawn.cy; this.fh = fh;
    this.facingRight = kind === 'Npc' ? !spawn.f : !!spawn.f;
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
    for (const k of ['stand', 'move', 'jump', 'hit1', 'die1', 'fly']) if (src[k]) this.anims[k] = new Anim(src[k], k !== 'die1' && k !== 'hit1');
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

  allFrames() { return Object.values(this.anims).flatMap((a) => a.frames); }
  get alive() { return this.state !== 'die1' && this.respawnTimer <= 0; }
  get node() { return this.anims[this.state]?.node; }

  setState(s) {
    if (this.state === s || !this.anims[s]) return;
    this.state = s; this.anims[s].reset();
  }

  /**
   * A blow. As in the original, a monster only flinches (hit1) and recoils when the damage reaches its
   * `pushed` threshold; the recoil slides it back along its floor from 130px/s, braking at 400px/s^2.
   */
  hit(dmg, fromRight) {
    if (!this.alive || this.kind !== 'Mob') return;
    this.hp -= dmg;
    if (this.online) this.hp = Math.max(0, this.hp); // the server decides death (KILL_MONSTER)
    else if (this.hp <= 0) { this.setState('die1'); return; }
    if (dmg < (this.src.info?.pushed ?? 1)) return;
    this.facingRight = fromRight;
    if (this.anims.hit1) { this.setState('hit1'); this.hitTimer = Math.max(0.3, this.anims.hit1.frames.reduce((t, f) => t + (f.delay || 100), 0) / 1000); }
    // fromRight: the blow came from the right, so it slides away to the left
    if (this.fh && !this.flying && (this.controlled || !this.online)) this.recoil = (fromRight ? -1 : 1) * 130;
  }
  /** Slide back after a blow, braking to a stop; a floor's edge or a wall stops it. */
  recoilStep(dt) {
    const v = this.recoil, slowed = Math.sign(v) * Math.max(0, Math.abs(v) - 400 * dt);
    const fh = this.fh, x = this.x, y = this.y;
    if (this.footholds.walk(this, ((v + slowed) / 2) * dt) !== 'ok') { this.fh = fh; this.x = x; this.y = y; this.recoil = 0; return; }
    this.recoil = slowed;
  }

  update(dt) {
    const anim = this.anims[this.state];
    anim?.update(dt * 1000);
    if (this.online) {
      if (this.state === 'die1') { if (anim?.done || !anim) this.removed = true; return; }
      if (this.recoil && this.fh) this.recoilStep(dt);
      if (this.state === 'hit1') { this.hitTimer -= dt; if (this.hitTimer <= 0) this.setState(this.flying ? 'fly' : 'stand'); return; }
      if (this.path) { this._replay(dt); return; }
      if (!this.controlled) return;
    }
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
    this.fh = null; this.vy = -420; this.vx = (this.facingRight ? 1 : -1) * this.speed;
    this.setState(this.anims.jump ? 'jump' : 'move');
  }
  walkStep(dt) {
    const dx = (this.facingRight ? 1 : -1) * this.speed * dt;
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
    const node = this.node;
    const img = assets.image(node);
    if (!img) return;
    const o = node.origin || [0, 0];
    const sx = Math.round(this.x - cam.x), sy = Math.round(this.y - cam.y);
    ctx.save();
    ctx.translate(sx, sy);
    if (this.facingRight) ctx.scale(-1, 1);
    ctx.drawImage(img, -o[0], -o[1]);
    ctx.restore();

    if (this.name && (this.kind === 'Npc')) nameTag(ctx, this.name, sx, sy + 4, '#ff0');
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
