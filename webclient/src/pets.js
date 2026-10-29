import { frames } from './assets.js';
import { Footholds, PHYS } from './physics.js';
import { nameTag } from './map.js';
import { allCanvases } from './ui/windows.js';

/**
 * Pets (Item/Pet/<id>.img): animations stand0 / stand1 / move / jump / hang / rest0 / chat ... with
 * per-frame origin and delay; interact/<n> lists the commands (command word key into
 * String/PetDialog.img/<id>, closeness level range l0-l1, success / fail action and lines).
 * Your own pets walk after you on the footholds and report MOVE_PET; other players' pets replay theirs.
 */
const ACTS = ['stand0', 'move', 'jump', 'hang', 'stand1', 'rest0', 'chat', 'angry', 'poor', 'cry', 'dung', 'alert', 'rise', 'prone', 'stretch', 'hungry', 'fly'];
const FOLLOW = 72;            // where a pet settles behind you, so the name tags clear (each further pet a bit more)
const SLACK = 70;             // how far past that you may get before it sets off after you
const TELEPORT = 360;         // further than this (or on another platform for a while) and it pops back to you
const MAX_SPEED = PHYS.walk * 1.45, ACCEL = 420;   // it eases up to speed and back down instead of snapping
const MOVE_HOLD = 0.2;        // keep the walk cycle this long after slowing, so it never flickers walk / stand
const HOP_TIME = 0.22;        // the hop from wherever it is onto your back when you grab a ladder / rope
const LEAP_DELAY = 0.25;      // after you jump off a ladder it hangs on there this long before leaping after you

export class Pet {
  constructor(game, d) {
    Object.assign(this, { g: game, owner: d.owner, slot: d.slot, id: d.id, name: d.name, uid: d.uid, x: d.x, y: d.y });
    this.mine = d.owner === game.player.id;
    this.facingRight = !(d.stance & 1);
    this.vx = 0; this.vy = 0; this.fh = game.map?.fh?.below(d.x, d.y - 5, 60) || null;
    this.act = 'stand0'; this.frame = 0; this.frameT = 0; this.override = null; this.chat = null;
    this.path = null; this.lostT = 0; this.chasing = false; this.moveHold = 0;
    this.cling = null; this.leap = null;    // riding on your back up a ladder / rope; about to leap off one
    this.sendT = 0; this.lastSent = null;
    this.data = null;
    game.assets.json(`Item/Pet/${d.id}.img`).then(async (n) => { if (n) { await game.assets.preload(allCanvases(n)); this.data = n; } });
  }
  get key() { return `${this.owner}:${this.slot}`; }

  // ---------------------------------------------------------------- behaviour
  /** Play an action for a while (a command's answer, eating...), then go back to walking / standing. */
  play(act, seconds = 2.5) { if (this.data?.[act]) { this.override = { act, t: seconds }; this.frame = 0; this.frameT = 0; } }
  say(text, seconds = 4) { if (text) this.chat = { text, t: seconds }; }

  update(dt) {
    if (this.mine) this.follow(dt); else this.replay(dt);
    let act = this.override?.act;
    if (this.override && (this.override.t -= dt) <= 0) this.override = null;
    this.moveHold = Math.abs(this.vx) > 12 ? MOVE_HOLD : Math.max(0, this.moveHold - dt);
    const moving = this.moveHold > 0;
    if (!act) act = this.mine ? (this.cling || this.leap ? 'hang' : !this.fh ? 'jump' : moving ? 'move' : 'stand0') : this.remoteAct || (moving ? 'move' : 'stand0');
    if (!this.data?.[act]) act = 'stand0';
    if (act !== this.act) { this.act = act; this.frame = 0; this.frameT = 0; }
    const fr = frames(this.data?.[act]);
    if (fr.length) {
      this.frameT += dt * 1000;
      while (this.frameT >= (fr[this.frame]?.delay || 150)) { this.frameT -= fr[this.frame]?.delay || 150; this.frame = (this.frame + 1) % fr.length; }
    }
    if (this.chat && (this.chat.t -= dt) <= 0) this.chat = null;
  }

  /**
   * Trail the owner: stay on whichever side of them it already is (turning round doesn't send it
   * running past you), let them get SLACK ahead before setting off, speed up with the gap and ease
   * to a stop at its spot. Drops off ledges; rides on your back up and down ladders and ropes;
   * teleports when left too far behind.
   */
  follow(dt) {
    const g = this.g, p = g.player, fh = g.map?.fh;
    if (!fh) return;
    const side = Math.sign(this.x - p.x) || (p.facingRight ? -1 : 1);
    const tx = p.x + side * (FOLLOW + this.slot * 40), dist = Math.hypot(p.x - this.x, p.y - this.y);
    if (this.backpack(dt, p, fh)) return;
    const apart = Math.abs(p.y - this.y) > 60;
    this.lostT = dist > TELEPORT || apart ? this.lostT + dt : 0;
    if (dist > TELEPORT * 2 || this.lostT > 1.6) {
      const f = fh.below(p.x, p.y - 5, 400);
      this.x = p.x; this.y = f ? Footholds.yAt(f, p.x) : p.y; this.fh = f; this.vx = 0; this.vy = 0; this.lostT = 0;
      return;
    }
    if (!this.fh) { fh.fall(this, dt); if (this.fh) this.vx = 0; return; }   // lands and stops, like you do
    const dx = tx - this.x, gap = Math.abs(dx);
    if (!this.chasing && gap > SLACK) this.chasing = true;
    else if (this.chasing && gap < 4) this.chasing = false;
    // never trot away from you to reach its spot (you just walked past it): wait for you to pull ahead
    if (Math.sign(dx) !== Math.sign(p.x - this.x)) this.chasing = false;
    const want = this.chasing && !this.override ? Math.sign(dx) * Math.min(MAX_SPEED, 50 + gap * 1.6) : 0;
    const step = ACCEL * dt;
    this.vx = want > this.vx ? Math.min(want, this.vx + step) : Math.max(want, this.vx - step);
    if (this.vx) {
      const r = fh.walk(this, this.vx * dt);
      if (r === 'edge') this.vy = 0;
      else if (r === 'wall') { this.vx = 0; this.chasing = false; }
    }
    if (Math.abs(this.vx) > 12) this.facingRight = this.vx > 0;
    else if (!this.override && Math.abs(p.x - this.x) > 2) this.facingRight = p.x > this.x;
  }

  /**
   * Ladders and ropes, as in the client: when you grab one the pet hops onto your back and rides
   * there in its hang pose (the sprite hangs from its anchor, so at your feet it covers your back).
   * Climb off an end and it gets down there with you; jump off and it hangs on LEAP_DELAY, then
   * leaps after you with the same jump. Returns true while it is handled here.
   */
  backpack(dt, p, fh) {
    if (this.leap) {
      if ((this.leap.t -= dt) > 0) return true;
      const { vx, vy } = this.leap;
      this.leap = null; this.fh = null; this.vx = vx; this.vy = vy;
      if (vx) this.facingRight = vx > 0;
      return true;
    }
    if (p.ladder) {
      const c = (this.cling ??= { t: 0, fromX: this.x, fromY: this.y });
      c.t = Math.min(1, c.t + dt / HOP_TIME);
      const k = c.t * (2 - c.t);                                   // ease out
      this.x = c.fromX + (p.x - c.fromX) * k;
      this.y = c.fromY + (p.y - c.fromY) * k - Math.sin(Math.PI * c.t) * 18 * (1 - c.t);   // a little hop up onto you
      this.fh = null; this.vx = 0; this.vy = 0; this.lostT = 0; this.chasing = false;
      return true;
    }
    if (!this.cling) return false;
    this.cling = null; this.x = p.x; this.y = p.y;                 // you just let go: so does it
    if (!p.fh && p.vy < 0) this.leap = { t: LEAP_DELAY, vx: p.vx, vy: p.vy };
    else if (p.fh) { this.fh = p.fh; this.y = Footholds.yAt(p.fh, p.x); }
    else { this.fh = null; this.vy = 0; }                          // off the bottom: drop with you
    return true;
  }
  /** Riding on your back (or about to leap off the ladder): drawn over you, without its name tag. */
  get onBack() { return this.mine ? !!(this.cling || this.leap) : this.remoteAct === 'hang'; }

  /** MOVE_PET from another player: ease through the steps like a remote character. */
  applyMovement(moves) {
    const steps = moves.filter((m) => m.x !== undefined);
    if (steps.length) this.path = { steps, i: 0, t: 0, fromX: this.x, fromY: this.y };
  }
  replay(dt) {
    const p = this.path;
    if (!p) { this.vx = 0; return; }
    const s = p.steps[p.i], k = Math.min(1, (p.t += dt) / (Math.max(1, s.duration || 60) / 1000));
    this.vx = s.x - p.fromX; this.x = p.fromX + (s.x - p.fromX) * k; this.y = p.fromY + (s.y - p.fromY) * k;
    if (s.stance !== undefined) { this.facingRight = !(s.stance & 1); this.remoteAct = ACTS[s.stance >> 1] || null; }
    if (k >= 1) { p.fromX = s.x; p.fromY = s.y; p.t = 0; if (++p.i >= p.steps.length) this.path = null; }
  }

  /** Your pet's movement, a snapshot every 90ms sent in batches like your own. */
  sync(dt) {
    if (!this.mine || !this.g.net) return;
    this.sendT += dt;
    if (this.sendT < 0.36) return;
    const snap = { cmd: 0, x: Math.round(this.x), y: Math.round(this.y), vx: Math.round(this.vx), vy: Math.round(this.vy), fh: this.fh?.id || 0,
      stance: (Math.max(0, ACTS.indexOf(this.act)) << 1) | (this.facingRight ? 0 : 1), duration: Math.round(this.sendT * 1000) };
    const l = this.lastSent;
    if (!l || l.x !== snap.x || l.y !== snap.y || l.stance !== snap.stance) {
      this.g.net.movePet(this.uid, l || snap, [snap]);
      this.lastSent = snap;
    }
    this.sendT = 0;
  }

  // ---------------------------------------------------------------- frame
  /**
   * The map layer it is drawn on, by the client's own rule for characters: 7 (in front of every
   * layer) on a ladder or rope, its foothold's page on the ground, the last one while in the air.
   * Other players' pets go by the floor under them.
   */
  layer() {
    if (this.onBack) return 7;
    const f = this.mine ? this.fh : this.g.map?.fh?.below(this.x, this.y - 2, 12);
    if (f?.layer !== undefined) this.lastLayer = f.layer;
    return this.lastLayer ?? 7;
  }
  draw(ctx, cam) {
    const node = frames(this.data?.[this.act])[this.frame], img = node && this.g.assets.image(node);
    const x = Math.round(this.x - cam.x), y = Math.round(this.y - cam.y);
    if (img) {
      const o = node.origin || [img.width / 2, img.height];
      ctx.save();
      if (this.facingRight) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -o[0], -o[1]); }
      else ctx.drawImage(img, x - o[0], y - o[1]);
      ctx.restore();
    }
    if (!this.onBack) nameTag(ctx, this.name, x, y + 2, '#fff');
  }
}

/** The pet's answer lines for interact/<n> (or food/<n>): success or fail, one picked at random. */
export function petLines(pet, node, ok, dialog) {
  const r = node?.[ok ? 'success' : 'fail']?.[0];
  if (!r) return { act: null, text: '' };
  const keys = frames(r);
  const key = keys[Math.floor(Math.random() * keys.length)];
  return { act: r.act || null, text: dialog?.[pet.id]?.[key] || '' };
}
