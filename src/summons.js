import { frames } from './assets.js';

/**
 * Summons (Puppet, Silver Hawk, Summon Dragon, Beholder, Octopus...): Skill/<job>.img/skill/<id>/summon holds
 * summoned / stand (or fly) / move / attack1 (+ info: range lt/rb, attackAfter) / hit / skill1-6 / die.
 * The server spawns, moves (for others) and removes them; the owner's client moves them and decides their
 * attacks, as Cosmic expects (MOVE_SUMMON, SUMMON_ATTACK). Movement types as Cosmic sends them:
 * 0 stays where it was cast, 1 follows behind you, 3 circles above your shoulder (the birds).
 */
const STAY = 0, FOLLOW = 1;
/** Ranger / Sniper / Wind Archer Puppet: monsters near it go after it instead of you. */
export const PUPPETS = new Set([3111002, 3211002, 13111004]);
export const PUPPET_RANGE = 421;     // Cosmic hands you the monsters within this of your puppet (distanceSq < 177777)
const ATTACK_EVERY = 1.6;     // seconds between a summon's attacks (at least its attack animation)
const SYNC_EVERY = 0.4;
/** Octopus, Wrath of the Octopi and Gaviota: the summons that still attack while you are on a ladder or rope. */
const LADDER_ATTACKERS = new Set([5211001, 5220002, 5211002]);
/** Seconds from one attack to the next for the Octopus (3) and for Gaviota and Wrath of the Octopi (1.5). */
const PIRATE_EVERY = { 5211001: 3, 5211002: 1.5, 5220002: 1.5 };
/** Wrath of the Octopi picks attack1 or attack2 at random each time. */
const WRATH = 5220002;
/** A summon attack's action (attack1 is 4, attack2 5), sent with facing left in the top bit. */
export const SUMMON_ACTIONS = { attack1: 4, attack2: 5 };
const BEHOLDER = 1321007, AURA = 1320008, BERSERK = 1320006, HEX = 1320009;

export class Summon {
  constructor(game, d) {
    Object.assign(this, { g: game, owner: d.owner, oid: d.oid, skill: d.skill, level: d.level, x: d.x, y: d.y, moveType: d.moveType, canAttack: d.canAttack });
    this.mine = d.owner === game.player.id;
    this.puppet = PUPPETS.has(d.skill);
    this.reach = this.puppet ? 28 : 0;     // how close a monster after it comes before it stops
    this.hitT = 0;
    this.facingRight = !(d.stance & 1);
    this.state = d.animated ? 'summoned' : 'idle';
    this.frame = 0; this.frameT = 0; this.attackT = ATTACK_EVERY / 2; this.sendT = 0; this.lastSent = null;
    this.phase = Math.random() * Math.PI * 2; this.path = null; this.dying = false;
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

  update(dt) {
    if (this.mine && !this.dying) this.follow(dt);
    else if (!this.mine) this.replay(dt);
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
    if (this.mine && !this.dying) { this.tryAttack(dt); this.beholderHeal(); this.beholderHex(); this.sync(dt); }
  }

  /**
   * Where your summon wants to be: its spot (stationary), or a little behind you. Its position is the
   * ground point like a character's feet - the art's origin already lifts a bird or a Beholder above it.
   */
  follow(dt) {
    if (this.moveType === STAY) return;
    const p = this.g.player, back = p.facingRight ? -1 : 1;
    this.phase += dt * 2.4;
    const tx = p.x + back * (this.moveType === FOLLOW ? 55 : 40);
    const ty = p.y + Math.sin(this.phase) * 4;
    const k = 1 - Math.exp(-dt * 4);
    const dx = (tx - this.x) * k;
    this.x += dx; this.y += (ty - this.y) * k;
    if (Math.abs(dx) > 0.3) this.facingRight = dx > 0;
    else this.facingRight = p.facingRight;
    if (Math.hypot(p.x - this.x, p.y - this.y) > 600) { this.x = tx; this.y = ty; }   // left far behind: catch up at once
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
  sync(dt) {
    if (this.moveType === STAY || !this.g.net) return;
    if ((this.sendT += dt) < SYNC_EVERY) return;
    const snap = { cmd: 0, x: Math.round(this.x), y: Math.round(this.y), vx: 0, vy: 0, fh: 0,
      stance: (this.facingRight ? 0 : 1) | 4, duration: Math.round(this.sendT * 1000) };
    const l = this.lastSent;
    if (!l || l.x !== snap.x || l.y !== snap.y || l.stance !== snap.stance) { this.g.net.moveSummon(this.oid, l || snap, [snap]); this.lastSent = snap; }
    this.sendT = 0;
  }

  // ---------------------------------------------------------------- attacks (yours)
  /** The monsters inside attack1's range box (lt / rb around the summon, mirrored when it faces right). */
  targets(info, count) {
    const r = info?.range || {}, lt = r.lt || [-200, -150], rb = r.rb || [200, 150];
    const x1 = this.facingRight ? -rb[0] : lt[0], x2 = this.facingRight ? -lt[0] : rb[0];
    const inBox = (m) => m.x >= this.x + x1 && m.x <= this.x + x2 && m.y >= this.y + lt[1] && m.y - 30 <= this.y + rb[1];
    return this.g.map.life.filter((m) => m.kind === 'Mob' && m.alive && !m.dying && !m.queuedKill && m.oid !== null && m.hasBody && inBox(m))
      .sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x)).slice(0, count);
  }
  /**
   * The Beholder's Aura (1320008): while your HP is under the most, it heals you - its skill1 pose and BEHOLDER -
   * then waits the aura's x seconds. Not while Berserk is on, if the heal would take you over Berserk's x% of the most.
   */
  beholderHeal() {
    const g = this.g, sb = g.skills;
    if (this.skill !== BEHOLDER || this.state !== 'idle' || performance.now() < (this.healAt || 0)) return;
    const aura = sb?.level(AURA) && sb.levelData(AURA), hp = g.stats?.hp || 0, max = g.maxHpShown?.() || 0;
    if (!aura || !(hp < max)) return;
    const berserk = sb.level(BERSERK) && sb.levelData(BERSERK);
    if (berserk && g.player?.berserk && hp + (Number(aura.hp) || 0) > (max * (Number(berserk.x) || 0)) / 100) return;
    g.net?.beholder(this.oid, AURA, (this.facingRight ? 0 : 0x80) | 6);
    this.healAt = performance.now() + (Number(aura.x) || 0) * 1000;
    this.play('skill1');
  }
  /**
   * Hex of the Beholder (1320009): every x seconds it buffs you with one of the skill level's stats (0 pdd, 1 mdd,
   * 2 acc, 3 eva, 4 pad, among those it has): a random pick, each likelier by one than the one before, then the
   * highest up to that pick that your buffs give you less of now (pdd whatever the pick). It plays skill2 + the pick
   * and sends BEHOLDER with action 7 + the pick (facing left in bit 7) and the pick.
   */
  beholderHex() {
    const g = this.g, sb = g.skills, now = performance.now();
    if (this.skill !== BEHOLDER || this.state !== 'idle' || now < (this.hexAt || 0)) return;
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
  tryAttack(dt) {
    if (!this.canAttack || !this.node?.attack1 || this.state === 'summoned') return;
    if (this.g.player?.ladder && !LADDER_ATTACKERS.has(this.skill)) return;
    if ((this.attackT -= dt) > 0) return;
    const which = this.skill === WRATH && this.node.attack2 && Math.random() < 0.5 ? 'attack2' : 'attack1';
    const info = this.node[which].info, ld = this.g.skills.levelData(this.skill, this.level) || {};
    const mobs = this.targets(info, info?.mobCount || ld.mobCount || 1);   // the attack's own mobCount (Gaviota 3)
    if (!mobs.length) { this.attackT = 0.25; return; }
    const len = this.anim(which).reduce((t, f) => t + (f.delay || 100), 0) / 1000;
    this.attackT = PIRATE_EVERY[this.skill] ?? Math.max(ATTACK_EVERY, len + 0.3);
    this.facingRight = mobs[0].x > this.x;
    this.play(which);
    const max = this.g.summonMaxDamage(this.skill, this.level);
    const hits = mobs.map((m) => ({ mob: m, dmg: PIRATE_EVERY[this.skill] ? this.g.summonHitDamage(this.skill, this.level, m)
      : Math.max(1, Math.round(max * (0.5 + Math.random() * 0.45))) }));
    const delay = info?.attackAfter || 300;
    this.g.net?.summonAttack(this, hits, delay, SUMMON_ACTIONS[which]);
    for (const h of hits) h.mob.pendingHits = (h.mob.pendingHits || 0) + 1;
    this.g.after(delay, () => { for (const h of hits) this.g.summonHit(this, h.mob, [h.dmg], true, which); });
  }

  draw(ctx, cam) {
    const fr = this.anim(this.state), node = fr[this.frame], img = node && this.g.assets.image(node);
    if (!img) return;
    const o = node.origin || [img.width / 2, img.height];
    const x = Math.round(this.x - cam.x), y = Math.round(this.y - cam.y);
    ctx.save();
    if (node.a0 !== undefined && node.a0 < 255) ctx.globalAlpha = node.a0 / 255;
    if (this.facingRight) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -o[0], -o[1]); }
    else ctx.drawImage(img, x - o[0], y - o[1]);
    ctx.restore();
  }
}
