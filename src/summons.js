import { frames } from './assets.js';
import { snapPx } from './view.js';

/**
 * Summons (Puppet, Silver Hawk, Summon Dragon, Beholder, Octopus...): Skill/<job>.img/skill/<id>/summon holds
 * summoned / stand (or fly) / move / attack1 (+ info: range lt/rb or sp/r, attackAfter, mobCount) / hit / skill1-6 /
 * die. The server spawns, moves (for others) and removes them; the owner's client moves them and decides their
 * attacks in 30ms ticks, as the game server expects (MOVE_SUMMON, SUMMON_ATTACK). Movement types as the game server
 * sends them: 0 stays where it was cast, 1 walks after you, 2 only jumps to you, 3 hovers about you (the birds). What
 * a summon does is its assist type: 1 attacks, 2 (a Beholder) heals and buffs you, 0 nothing (a Puppet).
 */
const TICK = 30;
const STAY = 0, FOLLOW = 1, BIRD = 3;
/** Ranger / Sniper / Wind Archer Puppet: monsters near it go after it instead of you. */
export const PUPPETS = new Set([3111002, 3211002, 13111004]);
export const PUPPET_RANGE = 421;     // the game server hands you the monsters within this of your puppet (distanceSq < 177777)
const ATTACK_EVERY = 3000;     // ms from a summon appearing, or from its last attack, to its next
/** Gaviota and Wrath of the Octopi attack every 1.5s. */
const QUICK = { 5211002: 1500, 5220002: 1500 };
const OCTOPUS = 5211001, WRATH = 5220002, GAVIOTA = 5211002, BAHAMUT = 2321003;
/** The Cygnus Knights' first summons (Soul, Flame, Storm, Darkness, Lightning): they keep 42px from you, not 70. */
const ELEMENTALS = new Set([11001004, 12001004, 13001004, 14001005, 15001004]);
/** Elquines, Ifrit, Bahamut and the Blaze Wizard's Ifrit pick a side by its range box; the rest by a cone. */
const BOX_TARGETING = new Set([2121005, 2221005, BAHAMUT, 12111004]);
/** The summons that strike with magic: those four, Summon Dragon and Flame. */
export const MAGIC_SUMMONS = new Set([...BOX_TARGETING, 2311006, 12001004]);
/** Phoenix, Frostprey, Gaviota and the Cygnus summons also hit up to mobCount around the first monster. */
const SPREAD = new Set([3121006, 3221005, GAVIOTA, ...ELEMENTALS]);
/** The Octopi and Gaviota attack whatever you are doing (on a ladder, riding, in Dark Sight). */
const FREE = new Set([OCTOPUS, WRATH, GAVIOTA]);
/** A summon attack's action (attack1 is 4, attack2 5), sent with facing left in the top bit. */
export const SUMMON_ACTIONS = { attack1: 4, attack2: 5 };
const BEHOLDER = 1321007, AURA = 1320008, BERSERK = 1320006, HEX = 1320009;
const FLY_ACC = 1200, FLY_MAX = 200, FLY_BRAKE = 1000;   // Physics.img's flyForce over the mass, flySpeed, the brake

/** Whether two boxes overlap (their right and bottom edges left out). */
const overlap = (a, b) => Math.max(a.left, b.left) < Math.min(a.right, b.right) && Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
/**
 * Whether a cone reaches box b: from `start` toward `end` in 20px slices across, each from y - h to y + h where h is
 * a quarter of how far the slice's near edge is from the summon (apex).
 */
function cone(apex, start, end, y, b) {
  const right = start <= end;
  for (let L = start, k = apex - start; right ? L < end : end < L; ) {
    let slice;
    if (right) { const h = Math.trunc((L - apex) / 4); slice = { left: L, right: Math.min(L + 20, end), top: y - h, bottom: y + h }; L += 20; }
    else { const h = Math.trunc(k / 4); slice = { left: Math.max(L - 20, end), right: L, top: y - h, bottom: y + h }; L -= 20; k += 20; }
    if (overlap(slice, b)) return true;
  }
  return false;
}

export class Summon {
  constructor(game, d) {
    Object.assign(this, { g: game, owner: d.owner, oid: d.oid, skill: d.skill, level: d.level, x: d.x, y: d.y, moveType: d.moveType, assist: d.assist ?? (d.canAttack ? 1 : 0) });
    this.mine = d.owner === game.player.id;
    this.puppet = PUPPETS.has(d.skill);
    this.reach = this.puppet ? 28 : 0;     // how close a monster after it comes before it stops
    this.hitT = 0;
    this.facingRight = !(d.stance & 1);
    this.state = d.animated ? 'summoned' : 'idle';
    this.frame = 0; this.frameT = 0; this.path = null; this.dying = false;
    this.vx = 0; this.vy = 0; this.prevX = this.x; this.prevY = this.y; this.acc = 0;
    // it may act at all: one that moves, or an Octopus; it first attacks a full wait after appearing, and a Beholder
    // heals and buffs from 10s on
    this.canAct = d.moveType !== STAY || d.skill === OCTOPUS || d.skill === WRATH;
    const now = performance.now();
    this.lastAttack = now; this.healAt = now + 10000; this.hexAt = now + 10000;
    this.moves = []; this.moveStart = null; this.moveMs = 0;
    this.node = null;
    game.skills?.ensure(d.skill).then(async (n) => {
      const s = n?.summon;
      if (!s) return;
      await game.assets.preload(Object.values(s).flatMap((a) => frames(a)));
      this.node = s;
    });
  }
  /** stand for walkers, fly for flyers; what the summon shows when nothing else is playing. */
  get idle() { return this.node?.fly ? 'fly' : 'stand'; }
  anim(state) {
    const n = this.node;
    if (!n) return [];
    const name = state === 'idle' ? this.idle : state;
    return frames(n[name] || n[this.idle]);
  }
  play(state) { if (this.node?.[state]) { this.state = state; this.frame = 0; this.frameT = 0; } }
  die() { this.dying = true; if (this.node?.die) this.play('die'); else this.gone = true; }
  /** Playing a pose that runs once (appearing, an attack, a Beholder's skill): no attack, and a walker stands still. */
  get acting() { return this.state === 'summoned' || this.state.startsWith('attack') || this.state.startsWith('skill'); }

  update(dt) {
    if (!this.mine) this.replay(dt);
    // frames: summoned / attack / hit / skill play once, then back to idle; die ends the summon
    const fr = this.anim(this.state);
    if (fr.length) {
      this.frameT += dt * 1000;
      while (this.frameT >= (fr[this.frame]?.delay || 100)) {
        this.frameT -= fr[this.frame]?.delay || 100;
        if (++this.frame >= fr.length) {
          if (this.state === 'die') { this.gone = true; this.frame = fr.length - 1; return; }
          // a struck summon keeps its hit pose for 1.5s (it loops till then)
          if (this.state === 'hit' && performance.now() < (this.hitUntil || 0)) { this.frame = 0; continue; }
          if (this.state !== 'idle') this.state = 'idle';
          this.frame = 0;
        }
      }
    }
    if (!this.mine || this.dying) return;
    for (this.acc += dt * 1000; this.acc >= TICK; this.acc -= TICK) this.tick();
  }
  /** One 30ms tick of your summon: it moves, attacks (or as a Beholder heals or buffs), and its path grows. */
  tick() {
    this.prevX = this.x; this.prevY = this.y;
    const px = this.x, py = this.y;
    this.follow();
    if (this.canAct && !this.acting) {
      if (this.assist === 1 && performance.now() - this.lastAttack > (QUICK[this.skill] ?? ATTACK_EVERY)) this.attack();
      else if (this.assist === 2 && !this.beholderHeal()) this.beholderHex();
    }
    this.record(px, py);
  }

  /**
   * Where your summon goes, each tick: anywhere 300px or more across or 200px up or down from it, you, and it appears
   * at your feet (BasicEff Summoned). Otherwise one that walks steps 7px toward the side of you it is on until 70px
   * away (42 for the Cygnus summons), and goes up or down 7px a tick toward your height once you are 100px off it or
   * have been 20px off it for 30 ticks, until level with you; it stands still through its attack. A bird hovers about a
   * spot within 60px across and 30px up or down of you (picked again when it gets within 10px of it, or you are 120px
   * from it), flying as a monster flies; through its attack it stops.
   */
  follow() {
    if (this.moveType === STAY) return;
    const p = this.g.player, ox = Math.trunc(p.x), oy = Math.trunc(p.y);
    if (!(ox >= this.x - 300 && ox < this.x + 300 && oy >= this.y - 200 && oy < this.y + 200)) {
      this.x = ox; this.y = oy; this.vx = 0; this.vy = 0; this.spot = null;
      this.g.vfx?.play('Summoned', this);
      return;
    }
    if (this.moveType === FOLLOW) this.walkAfter(ox, oy);
    else if (this.moveType === BIRD) this.hover(ox, oy);
  }
  walkAfter(ox, oy) {
    if (this.acting) { this.vx = 0; this.vy = 0; return; }
    const gap = ELEMENTALS.has(this.skill) ? 42 : 70, x0 = this.x, y0 = this.y;
    if (ox > this.x + gap) this.x = Math.min(this.x + 7, ox - gap);
    else if (ox < this.x - gap) this.x = Math.max(this.x - 7, ox + gap);
    const dy = oy - this.y;
    if (!this.climbing) {
      if (Math.abs(dy) > 100) this.climbing = true;
      else if (Math.abs(dy) > 20) { if (++this.offTicks >= 30) this.climbing = true; } else this.offTicks = 0;
    }
    if (this.climbing) { if (dy === 0) { this.climbing = false; this.offTicks = 0; } else this.y += Math.sign(dy) * Math.min(7, Math.abs(dy)); }
    this.offTicks ||= 0;
    this.vx = (this.x - x0) / (TICK / 1000); this.vy = (this.y - y0) / (TICK / 1000);
    if (this.x !== x0) this.facingRight = this.x > x0;
  }
  hover(ox, oy) {
    if (this.acting) { this.vx = 0; this.vy = 0; return; }
    const rnd = (n) => Math.floor(Math.random() * n), dt = TICK / 1000;
    let s = this.spot;
    if (!s || (Math.abs(this.x - s.x) < 10 && Math.abs(this.y - s.y) < 10) || Math.abs(ox - s.x) > 120 || Math.abs(oy - s.y) > 120) s = this.spot = { x: ox + rnd(120) - 60, y: oy + rnd(60) - 30 };
    const inX = Math.abs(s.x - this.x) > 9 ? Math.sign(s.x - this.x) : 0, above = s.y < this.y - 10, level = Math.abs(s.y - this.y) <= 10;
    const vx0 = this.vx, vy0 = this.vy, max = FLY_MAX;
    let vx = vx0, vy = vy0;
    if (inX) vx = inX > 0 ? (vx >= max ? vx : Math.min(max, vx + FLY_ACC * dt)) : (vx <= -max ? vx : Math.max(-max, vx - FLY_ACC * dt));
    else vx = vx > 0 ? Math.max(0, vx - FLY_BRAKE * dt) : Math.min(0, vx + FLY_BRAKE * dt);
    if (above) vy = -max;                                   // up toward it at its top speed
    else if (level) { const T = max * 0.3; vy = vy > T ? Math.max(T, vy - FLY_ACC * dt) : Math.min(T, vy + FLY_ACC * dt * 0.5); }
    else vy = vy >= max ? vy : Math.min(max, vy + FLY_ACC * dt);
    this.x += (vx0 + vx) * dt * 0.5; this.y += (vy0 + vy) * dt * 0.5;
    this.vx = vx; this.vy = vy;
    if (Math.abs(vx) > 0.5) this.facingRight = vx > 0;
  }
  /**
   * The path your summon took, a point per tick (merged while its pose and the signs of its speeds stay the same),
   * goes out as MOVE_SUMMON once a second of it is held: walking (bird: flying) while it moves, standing otherwise.
   */
  record(px, py) {
    if (this.moveType === STAY || !this.g.net) return;
    this.moveStart ??= { x: Math.trunc(px), y: Math.trunc(py) };
    const moving = this.x !== px || this.y !== py;
    const stance = (moving ? (this.moveType === BIRD ? 0xc : 2) : 4) | (this.facingRight ? 0 : 1);
    const e = { cmd: 0, x: Math.trunc(this.x), y: Math.trunc(this.y), vx: Math.trunc(this.vx), vy: Math.trunc(this.vy), fh: 0, stance, duration: TICK };
    const l = this.moves[this.moves.length - 1];
    if (l && l.stance === e.stance && Math.sign(l.vx) === Math.sign(e.vx) && Math.sign(l.vy) === Math.sign(e.vy)) Object.assign(l, { ...e, duration: l.duration + TICK });
    else this.moves.push(e);
    if ((this.moveMs += TICK) < 1000) return;
    this.g.net.moveSummon(this.oid, this.moveStart, this.moves);
    this.moveStart = { x: e.x, y: e.y }; this.moves = []; this.moveMs = 0;
  }

  /** MOVE_SUMMON from another player: ease through the steps. */
  applyMovement(moves) {
    const steps = moves.filter((m) => m.x !== undefined);
    if (steps.length) this.path = { steps, i: 0, t: 0, fromX: this.x, fromY: this.y };
  }
  replay(dt) {
    const p = this.path;
    if (!p) return;
    const s = p.steps[p.i], k = Math.min(1, (p.t += dt) / (Math.max(1, s.duration || 60) / 1000));
    this.x = p.fromX + (s.x - p.fromX) * k; this.y = p.fromY + (s.y - p.fromY) * k;
    if (s.stance !== undefined) this.facingRight = !(s.stance & 1);
    if (k >= 1) { p.fromX = s.x; p.fromY = s.y; p.t = 0; if (++p.i >= p.steps.length) this.path = null; }
  }

  // ---------------------------------------------------------------- attacks (yours)
  /** A monster a summon may strike: there, not dying, and not one only other monsters can hurt. */
  struck(m) { return m.kind === 'Mob' && m.alive && !m.dying && !m.queuedKill && m.oid !== null && m.hasBody && !Number(m.src?.info?.damagedByMob); }
  /**
   * The monster to go for from (cx, cy): of the first ten (in the map's order) whose bodies reach within 300px across
   * and 100px up or down of it, the nearest.
   */
  nearest(cx, cy) {
    const area = { left: cx - 300, right: cx + 300, top: cy - 100, bottom: cy + 100 }, near = [];
    for (const m of this.g.map.life) { if (near.length >= 10) break; if (this.struck(m) && overlap(m.hitBox(true), area)) near.push(m); }
    let best = null, bd = Infinity;
    for (const m of near) { const d = (m.x - cx) ** 2 + (m.y - cy) ** 2; if (d < bd) { bd = d; best = m; } }
    return best;
  }
  /**
   * A cone summon's mark: the monster nearest you (Gaviota: nearest it), struck only if it lies in the summon's left
   * cone or, failing that, its right (starting |sp.y| px out, r px long, at its height + sp.y); an Octopus tries once
   * more from where it stands. Phoenix, Frostprey, Gaviota and the Cygnus summons then also strike up to mobCount - 1
   * others inside lt/rb about the point where the first was struck.
   */
  coneTargets(info) {
    const r = info.range || {}, spy = Math.trunc(Number(r.sp?.[1]) || 0), rad = Math.trunc(Number(r.r) || 0), p = this.g.player;
    const sx = Math.trunc(this.x), sy = Math.trunc(this.y), y = sy + spy;
    const tryFrom = (cx, cy) => {
      const m = this.nearest(cx, cy);
      if (!m) return null;
      const b = m.hitBox(true);
      if (cone(sx, sx + spy, sx - rad, y, b)) return { left: true, mob: m, b, x1: sx - rad, x2: sx + spy };
      if (cone(sx, sx - spy, sx + rad, y, b)) return { left: false, mob: m, b, x1: sx - spy, x2: sx + rad };
      return null;
    };
    let hit = this.skill === GAVIOTA ? tryFrom(sx, sy) : tryFrom(Math.trunc(p.x), Math.trunc(p.y));
    if (!hit && (this.skill === OCTOPUS || this.skill === WRATH)) hit = tryFrom(sx, sy);
    if (!hit) return null;
    // where it was struck: the middle of where its line at that height crosses the body (pulled onto it if it misses)
    const { b } = hit, lo = Math.max(hit.x1, b.left), hi = Math.min(hit.x2, b.right);
    const point = { x: Math.trunc(lo <= hi ? (lo + hi) / 2 : hi < b.left ? b.left : b.right), y: Math.max(b.top, Math.min(b.bottom, y)) };
    const mobs = [hit.mob];
    if (SPREAD.has(this.skill) && r.lt && r.rb) {
      const area = { left: point.x + r.lt[0], right: point.x + r.rb[0], top: point.y + r.lt[1], bottom: point.y + r.rb[1] };
      for (const m of this.g.map.life) { if (mobs.length >= (Number(info.mobCount) || 1)) break; if (m !== hit.mob && this.struck(m) && overlap(m.hitBox(true), area)) mobs.push(m); }
    }
    return { left: hit.left, mobs, point, spread: mobs.length > 1 || SPREAD.has(this.skill) };
  }
  /**
   * A box summon's marks: up to mobCount monsters inside its range box on the left (lt / rb about it) and on the right
   * (mirrored); the side whose monsters carry more of its priority skill's damage over time wins, then the side with
   * more of them; even, the left when it stands left of you or level (Bahamut: the other way).
   */
  boxTargets(info) {
    const r = info.range || {};
    if (!r.lt || !r.rb) return null;
    const sx = Math.trunc(this.x), sy = Math.trunc(this.y), count = Number(info.mobCount) || 1, prio = Number(info.priority) || 0;
    const side = (box) => {
      const ms = [];
      for (const m of this.g.map.life) { if (ms.length >= count) break; if (this.struck(m) && overlap(m.hitBox(true), box)) ms.push(m); }
      return { ms, v: (prio ? ms.filter((m) => m.statusArt?.has(prio)).length : 0) * 65536 + ms.length };
    };
    const a = side({ left: sx + r.lt[0], right: sx + r.rb[0], top: sy + r.lt[1], bottom: sy + r.rb[1] });
    const b = side({ left: sx - r.rb[0], right: sx - r.lt[0], top: sy + r.lt[1], bottom: sy + r.rb[1] });
    if (!a.ms.length && !b.ms.length) return null;
    const leftOfYou = sx <= Math.trunc(this.g.player.x);
    const left = a.v !== b.v ? a.v > b.v : this.skill === BAHAMUT ? !leftOfYou : leftOfYou;
    return { left, mobs: (left ? a : b).ms, box: true };
  }
  /**
   * An attack (see coneTargets / boxTargets): not while you are on a ladder or rope, riding or in Dark Sight or Wind
   * Walk (but the Octopi and Gaviota); Wrath of the Octopi picks attack1 or attack2 at random. It faces the side it
   * struck. Each blow lands after attackAfter: 50ms more for each monster after the first, all 120ms more when it
   * strikes several about one, an Octopus's after its shot flies (600 x the distance over bulletSpeed).
   */
  attack() {
    const g = this.g, p = g.player, ride = Math.floor((g.riding?.item || 0) / 10000);
    if (!FREE.has(this.skill) && (p.ladder || ride === 190 || ride === 193 || g.hidden?.())) return;
    const which = this.skill === WRATH && Math.random() < 0.5 ? 'attack2' : 'attack1';
    const info = this.node?.[which]?.info;
    if (!info) return;
    const plan = BOX_TARGETING.has(this.skill) ? this.boxTargets(info) : this.coneTargets(info);
    if (!plan) return;
    this.facingRight = !plan.left;
    const after = Number(info.attackAfter) || 0, sp = info.range?.sp || [0, 0];
    const shot = this.skill === OCTOPUS || this.skill === WRATH;
    const delay = (i) => {
      if (shot && plan.point) {
        const mx = Math.trunc(this.x) + (plan.left ? sp[0] : -sp[0]), my = Math.trunc(this.y) + (sp[1] || 0);
        return Math.trunc(after + (Math.hypot(plan.point.x - mx, plan.point.y - my) * 600) / (Number(info.bulletSpeed) || 600));
      }
      return plan.box || !plan.spread ? after + i * 50 : after + 120;
    };
    const hits = plan.mobs.map((m, i) => ({ mob: m, dmg: g.summonDamage(this, m), delay: delay(i) }));
    g.net?.summonAttack(this, { x: Math.trunc(p.x), y: Math.trunc(p.y) }, hits, SUMMON_ACTIONS[which]);
    this.lastAttack = performance.now();
    this.play(which);
    for (const h of hits) {
      h.mob.pendingHits = (h.mob.pendingHits || 0) + 1;
      g.after(h.delay, () => g.summonHit(this, h.mob, [h.dmg], true, which));
    }
  }
  /** Its body (this frame's lt / rb, with where it was the tick before): what a monster runs into (a Puppet). */
  hitBox() {
    const node = this.anim(this.state)[this.frame];
    if (!node?.lt || !node?.rb) return null;
    const at = (x, y) => ({ left: x + node.lt[0], right: x + node.rb[0], top: y + node.lt[1], bottom: y + node.rb[1] });
    const a = at(this.x, this.y), b = at(this.prevX, this.prevY);
    return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
  }
  /**
   * The Beholder's Aura (1320008): while your HP is under the most, it heals you - its skill1 pose and BEHOLDER -
   * then waits the aura's x seconds. Not while Berserk is on, if the heal would take you over Berserk's x% of the most.
   * True when it healed (no Hex that tick).
   */
  beholderHeal() {
    const g = this.g, sb = g.skills;
    if (this.skill !== BEHOLDER || performance.now() < this.healAt) return false;
    const aura = sb?.level(AURA) && sb.levelData(AURA), hp = g.stats?.hp || 0, max = g.maxHpShown?.() || 0;
    if (!aura || !(hp < max)) return false;
    const berserk = sb.level(BERSERK) && sb.levelData(BERSERK);
    if (berserk && g.player?.berserk && hp + (Number(aura.hp) || 0) > (max * (Number(berserk.x) || 0)) / 100) return false;
    g.net?.beholder(this.oid, AURA, (this.facingRight ? 0 : 0x80) | 6);
    this.healAt = performance.now() + (Number(aura.x) || 0) * 1000;
    this.play('skill1');
    return true;
  }
  /**
   * Hex of the Beholder (1320009): every x seconds it buffs you with one of the skill level's stats (0 pdd, 1 mdd,
   * 2 acc, 3 eva, 4 pad, among those it has): a random pick, each likelier by one than the one before, then the
   * highest up to that pick that your buffs give you less of now (pdd whatever the pick). It plays skill2 + the pick
   * and sends BEHOLDER with action 7 + the pick (facing left in bit 7) and the pick.
   */
  beholderHex() {
    const g = this.g, sb = g.skills, now = performance.now();
    if (this.skill !== BEHOLDER || now < this.hexAt) return;
    const ld = sb?.level(HEX) && sb.levelData(HEX);
    if (!ld) return;
    const [pdd, mdd, acc, eva, pad] = ['pdd', 'mdd', 'acc', 'eva', 'pad'].map((k) => Number(ld[k]) || 0);
    const vals = [pdd, mdd, acc, eva, pad], n = vals.filter(Boolean).length, W = vals.reduce((s, v, i) => s + (v ? i + 1 : 0), 0);
    if (!n) return;
    const r = Math.floor(Math.random() * W) + 1;
    let k = 0;
    while (k < n - 1 && r > ((k + 1) * (k + 2)) / 2) k++;
    const t = Date.now(), buff = (key) => Math.max(0, ...(g.buffs || []).filter((b) => b[key] && b.until > t).map((b) => b[key]));
    if (pad && buff('watk') < pad && k >= 4) k = 4;
    else if (eva && buff('avoid') < eva && k >= 3) k = 3;
    else if (acc && buff('acc') < acc && k >= 2) k = 2;
    else if (mdd && buff('mdef') < mdd && k >= 1) k = 1;
    else if (pdd && buff('wdef') < pdd) k = 0;
    g.net?.beholder(this.oid, HEX, (this.facingRight ? 0 : 0x80) | ((k + 7) & 0x7f), k);
    this.hexAt = now + (Number(ld.x) || 0) * 1000;
    this.play(`skill${k + 2}`);
  }

  draw(ctx, cam) {
    const fr = this.anim(this.state), node = fr[this.frame], img = node && this.g.assets.image(node);
    if (!img) return;
    const o = node.origin || [img.width / 2, img.height];
    const x = snapPx(this.x - cam.x), y = snapPx(this.y - cam.y);
    ctx.save();
    if (node.a0 !== undefined && node.a0 < 255) ctx.globalAlpha = node.a0 / 255;
    if (this.facingRight) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -o[0], -o[1]); }
    else ctx.drawImage(img, x - o[0], y - o[1]);
    ctx.restore();
  }
}
