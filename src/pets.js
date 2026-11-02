import { frames } from './assets.js';
import { sfx } from './audio.js';
import { Footholds, PHYS, accelerate, approach } from './physics.js';
import { allCanvases } from './ui/windows.js';

/**
 * Pets (Item/Pet/<id>.img). Your own run a small AI on the 30ms clock that feeds the same walk / jump
 * physics as characters and report MOVE_PET; other players' pets replay theirs.
 */
export const TICK = 30;
/** Move actions (stance >> 1) and the animation each plays. */
export const MOVE_ACT = { 1: 'move', 2: 'stand0', 3: 'jump', 6: 'fly', 11: 'stand1', 12: 'hungry', 13: 'rest0', 14: 'rest1', 15: 'hang' };
/** Action indices 0-8; custom actions follow from 9 in the img's node order. */
const BASE = ['move', 'stand0', 'stand1', 'jump', 'fly', 'hungry', 'rest0', 'rest1', 'hang'];
const RESERVED = new Set(['info', 'monolog', 'interact', 'food', 'move', 'stand0', 'stand1', 'jump', 'hungry', 'rest0', 'rest1', 'hang']);
const POSE_ACT = { 1: 2, 2: 11, 6: 13, 7: 14 };
export const NO_LOOT_MAP = 209080000;
const MOVE_FLUSH = 1000;

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Pet {
  constructor(game, d) {
    Object.assign(this, { g: game, owner: d.owner, slot: d.slot, id: d.id, name: d.name, uid: d.uid, sn: d.sn ?? BigInt(d.uid >>> 0), x: d.x, y: d.y });
    this.mine = d.owner === game.player.id;
    this.nameTagOn = !!d.nameTag; this.balloonOn = !!d.balloon;
    this.facingLeft = !!(d.stance & 1);
    this.moveAction = (d.stance >> 1) || 2;
    this.vx = 0; this.vy = 0; this.ladder = null;
    this.fh = game.map?.fh?.get(d.fh) || game.map?.fh?.below(d.x, d.y - 5, 60) || null;
    if (this.fh) this.y = Footholds.yAt(this.fh, this.x);
    this.pose = 1;              // idle pose: 1 stand0, 2 stand1, 6 rest0, 7 rest1
    this.forced = null;         // a one-shot action playing: {act}
    this.anim = null; this.frame = 0; this.frameT = 0;
    this.chat = null; this.idleMs = 0; this.monologMs = 0; this.cmdWaiting = false;
    this.inX = 0; this.want = 0; this.jumpReq = false; this.ladderMs = 0; this.visibleAt = 0;
    this.lastTargetX = null; this.targetSince = 0; this.lastX = null;
    this.lootDir = 0; this.formation = 0; this.sprintAt = 0; this.sprintExtra = 0; this.sprint = 1;
    this.speed = 1; this.jump = 1;
    this.acc = 0; this.moveBuf = []; this.moveTotal = 0; this.lastSent = null; this.movePos = null;
    this.path = null;
    this.data = null; this.customs = [];
    game.assets.json(`Item/Pet/${d.id}.img`).then(async (n) => {
      if (!n) return;
      await game.assets.preload(allCanvases(n));
      this.data = n;
      this.customs = Object.keys(n).filter((k) => !k.startsWith('_') && !RESERVED.has(k.toLowerCase()));
    });
  }
  get key() { return `${this.owner}:${this.slot}`; }
  get info() { return this.data?.info || {}; }

  // ---------------------------------------------------------------- actions
  actionName(i) { return i < 9 ? BASE[i] : this.customs[i - 9] || null; }
  actionIndex(name) { const b = BASE.indexOf(name), c = this.customs.indexOf(name); return b >= 0 ? b : c >= 0 ? c + 9 : -1; }
  /** What it is doing now: a one-shot action, else the move action's animation (the hang basket for the lead pet of several). */
  get act() { return this.forced?.act || MOVE_ACT[this.moveAction] || 'stand0'; }

  /**
   * A reaction or chat line: an action below 9 becomes its idle pose, one from 9 plays once (and holds it still);
   * on a ladder or rope it only hangs. Text shows in its balloon for 5s. Type 0 reactions play the action's sound.
   */
  react(type, action, text, balloon = this.balloonOn) {
    if (this.ownerLadder()) action = 8;
    if (action >= 0 && action < 9) this.pose = action;
    else if (action >= 9) {
      const act = this.actionName(action);
      if (act && this.data?.[act]) { this.forced = { act }; this.frame = 0; this.frameT = 0; if (type === 0) sfx.play(`Pet/${this.id}/${act}`); }
    }
    if (text) this.chat = { text, t: 5, style: balloon ? Number(this.info.chatBalloon) || 0 : 0 };
  }
  ownerLadder() { return this.ownerEnt()?.ladder || (this.mine ? null : this.remoteHang); }
  ownerEnt() { return this.mine ? this.g.player : this.g.others.get(this.owner); }

  // ---------------------------------------------------------------- frame
  update(dt) {
    const ms = dt * 1000;
    if (this.mine) {
      this.acc += ms;
      while (this.acc >= TICK) { this.acc -= TICK; this.tick(); }
    } else this.replay(dt);
    this.animate(ms);
    if (this.chat && (this.chat.t -= dt) <= 0) this.chat = null;
  }

  animate(ms) {
    const act = this.drawAct();
    if (act !== this.anim) { this.anim = act; this.frame = 0; this.frameT = 0; }
    const fr = frames(this.node());
    if (!fr.length) return;
    this.frameT += ms;
    while (this.frameT >= (fr[this.frame]?.delay || 120)) {
      this.frameT -= fr[this.frame]?.delay || 120;
      if (this.frame + 1 < fr.length) { this.frame++; continue; }
      this.frame = 0;
      if (this.forced) { this.forced = null; return; }
      if (this.mine && this.pose > 0 && this.pose < 3) this.pose = (Math.random() < 0.5 ? 1 : 2);
    }
  }
  drawAct() { return this.act === 'hang' && this.basket() ? 'basket' : this.act; }
  node() {
    const a = this.drawAct();
    if (a === 'basket') return this.g.petEff?.Basic?.hang;
    return this.data?.[a] || this.data?.stand0;
  }
  /** The lead pet of several hangs in Effect/PetEff.img/Basic/hang, the balloon basket. */
  basket() { return this.slot === 0 && [...this.g.pets.values()].some((p) => p.owner === this.owner && p !== this); }

  // ---------------------------------------------------------------- your pet's 30ms step
  tick() {
    const g = this.g, p = g.player, fh = g.map?.fh;
    if (!fh) return;
    const prevX = this.x;
    if (!this.forced || p.ladder) { this.ai(p, fh); this.physics(fh); }
    else if (!this.fh && !this.ladder) { this.inX = 0; this.physics(fh); }
    this.moveAction = this.computeAction(p);
    this.idle(prevX);
    this.record();
  }

  computeAction(p) {
    if (this.inX) this.facingLeft = this.inX < 0;
    if (this.ladder && p.ladder) { this.facingLeft = !p.facingRight; return 15; }
    if (!this.fh) return 3;
    if (this.inX) return 1;
    if (this.fullness() <= 50) return 12;
    return POSE_ACT[this.pose] || 2;
  }
  fullness() { return this.mine ? this.g.petItem(this)?.pet?.fullness ?? 100 : 100; }

  /** Standing still for over 5s, a 50% chance every 5s of an idle line; a monolog every 30 minutes. */
  idle(prevX) {
    if (Math.round(prevX) === Math.round(this.x) && this.fh) this.idleMs += TICK;
    else { this.pose = 1; this.idleMs = 0; }
    if (this.idleMs > 5000 && this.idleMs % 5000 < TICK && Math.random() < 0.5) this.g.petIdleChat(this);
    if ((this.monologMs += TICK) >= 1800000) { this.monologMs = 0; this.g.petMonolog(this); }
  }

  /** Turn its input toward where it should go, as the client's pet controller does. */
  ai(p, fh) {
    const g = this.g, now = performance.now();
    this.jumpReq = this.jumpReq && !!this.fh;
    if (p.ladder && this.ladder) { this.climb(p); return; }
    if (p.ladder && !this.ladder) {
      const from = { x: this.x, y: this.y };
      this.x = p.x; this.y = p.y; this.vx = 0; this.vy = 0; this.fh = null; this.ladder = p.ladder;
      this.ladderMs = 0; this.visibleAt = now + 120;
      this.event(5);
      g.petEffect(this, 2, from);
      return;
    }
    if (this.ladder) {
      this.ladderMs += TICK;
      if (this.ladderMs < 200) { this.climb(p); return; }
      this.inX = g.lastJumpDir || Math.sign(p.x - this.x) || (p.facingRight ? 1 : -1);
      this.jumpReq = true;
      return;
    }
    if (!this.fh) return;

    // the owner out of reach (300 x 200 around it) and standing: it reappears by them
    if (!(p.x >= this.x - 300 && p.x < this.x + 300 && p.y >= this.y - 200 && p.y < this.y + 200)) {
      const ground = fh.below(p.x, p.y - 10);
      const gy = ground ? Footholds.yAt(ground, p.x) : Infinity;
      if (p.y >= gy - 50 && p.y < gy + 50) {
        this.x = p.x; this.y = p.y - 10; this.vx = 0; this.vy = 0; this.fh = null; this.ladder = null;
        this.event(3); this.event(4);
        g.petEffect(this, 1);
      }
      return;
    }

    // a wall within 40px ahead: jump it (unless already against it at the end of its floor)
    if (this.inX) {
      const w = this.wallAhead(fh, this.inX, 40);
      if (w && !(w.adjacent && (this.inX < 0 ? this.x - this.fh.x1 < 1 : this.fh.x2 - this.x < 1))) { this.jumpReq = true; return; }
    }

    // the owner up on another platform over it: jump for it
    const og = g.ownerGroup, grp = og && fh.groups.get(og);
    if (grp && this.fh.group !== og && p.y < this.y && this.x > grp.x1 && this.x < grp.x2) {
      if (!this.want) this.inX = Math.round(p.x) === Math.round(this.x) ? (p.facingRight ? 1 : -1) : this.x <= p.x ? 1 : -1;
      this.want = 0; this.jumpReq = true;
      return;
    }

    // follow: the target is the owner's x plus its place in the line
    const left = !p.facingRight, f = this.formation;
    let tx = Math.round(p.x), stop = 80;
    if (!left && (f === 2 || f === 4)) tx += 160;
    if (left && (f === 1 || f === 3)) tx -= 160;
    if (!left && f === 3) { tx -= 40; stop = 70; }
    if (left && f === 4) { tx += 40; stop = 70; }
    if (f === 5) stop = 60;
    const px = Math.round(this.x), dist = Math.abs(tx - px);
    if (tx !== this.lastTargetX) this.targetSince = now;
    const start = this.flags().longRange ? 150 : 60;
    const moved = px !== this.lastX;
    if (!this.sprintAt && f !== 0 && !this.lootDir && moved) {
      if (Math.random() < 1 / 1000) { this.sprint = 2; this.sprintAt = now; this.jumpReq = true; }
      else if (Math.random() < 1 / 700) { this.sprint = 2; this.sprintAt = now; this.sprintExtra = 100; }
    }
    if (this.sprintAt && now > this.sprintAt + 700) { this.sprint = 1; this.sprintAt = 0; this.sprintExtra = 0; }
    const d = dist + this.sprintExtra;
    if (d < stop) this.want = 0;
    else if (this.lootDir || (!moved && d > stop) || d > start + 20) this.want = px <= tx ? 1 : -1;
    const fl = this.flags();
    if (this.lootDir && now > this.targetSince + 100 && !g.dead && g.map?.id !== NO_LOOT_MAP && fl.sweepForDrop && (fl.pickupItem || fl.pickupMeso)) this.want = this.lootDir;
    this.inX = this.want;
    this.lastTargetX = tx; this.lastX = px;
  }
  flags() { return this.g.petFlags(this); }

  /** Climbing with the owner: their up / down, 3px a step; off the top (if it has a way out) or the bottom. */
  climb(p) {
    const l = this.ladder, inp = this.g.input;
    const v = (inp.is('down') ? 1 : 0) - (inp.is('up') ? 1 : 0);
    this.vx = 0; this.vy = 0; this.x = l.x;
    this.y += v * 3;
    if (v < 0 && this.y < l.y1) {
      if (!l.uf) this.y = l.y1;
      else { this.y = l.y1 - 5; this.ladder = null; }
    } else if (v > 0 && this.y > l.y2) { this.y = l.y2 + 1; this.ladder = null; }
  }

  /** The first wall (one that blocks going that way) along its floors within `reach` px ahead. */
  wallAhead(fh, dir, reach) {
    let f = this.fh, left = dir > 0 ? f.x2 - this.x : this.x - f.x1;
    for (let i = 0; i < 16 && f; i++) {
      const n = fh.get(dir > 0 ? f.next : f.prev);
      if (!n) return null;
      if (n.x1 === n.x2) {
        const rises = dir > 0 ? n.y2 < n.y1 : n.y1 < n.y2;
        return rises && left <= reach ? { wall: n, adjacent: f === this.fh } : null;
      }
      if (n.x1 > n.x2 || left > reach) return null;
      f = n; left += f.x2 - f.x1;
    }
    return null;
  }

  physics(fh) {
    const dt = TICK / 1000, WALK = PHYS.walk * this.speed * this.sprint, JUMP = PHYS.jump * this.jump;
    if (this.ladder) {
      if (this.jumpReq && this.inX) {
        this.ladder = null; this.vy = -JUMP * 0.5; this.vx = this.inX * WALK * 1.3; this.jumpReq = false;
      }
      return;
    }
    if (this.fh) {
      if (this.jumpReq) {
        this.jumpReq = false;
        const d = this.inX;
        if (d * this.vx < WALK * 0.8) this.vx += d * WALK * 0.8;
        if (d && d * this.vx > WALK) this.vx = d * WALK;
        this.fh = null; this.vy = -JUMP;
      } else {
        const v0 = this.vx;
        this.vx = this.inX ? accelerate(v0, this.inX * PHYS.walkAccel, WALK, dt) : approach(v0, 0, PHYS.walkBrake * dt);
        const dx = ((v0 + this.vx) / 2) * dt;
        if (dx && !this.atEdge(fh, dx)) {
          const r = fh.walk(this, dx);
          if (r === 'edge') this.vy = 0;
          else if (r === 'wall') this.vx = 0;
        }
      }
    }
    // in the air in 10ms steps, so a jump rises as high as a character's
    for (let k = 0; k < 3 && !this.fh; k++) {
      this.vx = this.inX ? accelerate(this.vx, this.inX * PHYS.airAccel, PHYS.airLimit, dt / 3) : approach(this.vx, 0, PHYS.airDrag * dt / 3);
      fh.fall(this, dt / 3);
      if (this.fh) this.vx = this.inX * this.vx >= 0 ? this.vx * 0.5 : 0;
    }
    this.x = Math.max(fh.left + 25, Math.min(fh.right - 25, this.x));
    const b = this.g.map?.bounds;
    if (b && this.y > b.bottom + 300) { const p = this.g.player; this.x = p.x; this.y = p.y - 10; this.vx = 0; this.vy = 0; this.fh = null; }
  }

  /**
   * About to walk past the end of its floor onto something that isn't floor: it walks off a step down within the
   * owner's own platform; otherwise it stops and jumps when the owner is level or higher, and half the time when
   * they are lower (the other half it drops).
   */
  atEdge(fh, dx) {
    const f = this.fh, nx = this.x + dx;
    if (!(dx > 0 ? nx > f.x2 : nx < f.x1)) return false;
    const n = fh.get(dx > 0 ? f.next : f.prev);
    if (n && n.x1 < n.x2) return false;
    const p = this.g.player, og = this.g.ownerGroup, grp = og && fh.groups.get(og);
    const dropWall = n && n.x1 === n.x2 && (dx > 0 ? n.y2 > n.y1 : n.y1 > n.y2);
    if (dropWall && grp && f.group === og) {
      const wide = grp.x2 - grp.x1 > 40, gl = grp.x1 + (wide ? 20 : 0), gr = grp.x2 - (wide ? 20 : 0);
      if (dx < 0 ? gl < f.x1 : f.x2 < gr) return false;
    }
    if (p.y <= this.y || Math.random() < 0.5) { this.jumpReq = true; return true; }
    return false;
  }

  // ---------------------------------------------------------------- MOVE_PET
  /** Teleports (3, 4) and the snap onto a ladder (5) go in the path as their own elements. */
  event(cmd) {
    this.moveBuf.push({ cmd, x: Math.round(this.x), y: Math.round(this.y), vx: 0, vy: 0, fh: 0, stance: this.stance(), duration: 0 });
    this.movePos = { x: this.x, y: this.y };
  }
  stance() { return (this.moveAction << 1) | (this.facingLeft ? 1 : 0); }
  record() {
    if (!this.g.net) return;
    const prev = this.movePos || { x: this.x, y: this.y }, dt = TICK / 1000;
    this.movePos = { x: this.x, y: this.y };
    const el = { cmd: 0, x: Math.round(this.x), y: Math.round(this.y), vx: Math.round((this.x - prev.x) / dt), vy: Math.round((this.y - prev.y) / dt),
      fh: this.fh?.id || 0, stance: this.stance(), duration: TICK };
    const last = this.moveBuf[this.moveBuf.length - 1];
    if (last && last.cmd === 0 && last.fh === el.fh && last.stance === el.stance && Math.sign(last.vx) === Math.sign(el.vx) && Math.sign(last.vy) === Math.sign(el.vy)) {
      Object.assign(last, { x: el.x, y: el.y, vx: el.vx, vy: el.vy }); last.duration += TICK;
    } else this.moveBuf.push(el);
    this.moveTotal += TICK;
    if (this.moveTotal < MOVE_FLUSH) return;
    const send = this.moveBuf, first = send[0], l = this.lastSent;
    this.moveBuf = []; this.moveTotal = 0;
    if (send.length === 1 && l && first.x === l.x && first.y === l.y && first.stance === l.stance && !first.vx && !first.vy) return;
    this.g.net.movePet(this.sn, l || first, send);
    this.lastSent = send[send.length - 1];
  }

  /** Another player's MOVE_PET: its start is ignored; each element is eased through, teleports land at once. */
  applyMovement(moves) {
    const steps = moves.filter((m) => m.x !== undefined);
    if (!steps.length) return;
    const behind = this.path ? this.path.steps.slice(this.path.i).reduce((t, s) => t + (s.duration || 0), 0) : 0;
    if (behind > 5000) { const s = this.path.steps[this.path.steps.length - 1]; this.x = s.x; this.y = s.y; this.path = null; }
    if (this.path) this.path.steps.push(...steps);
    else this.path = { steps, i: 0, t: 0, fromX: this.x, fromY: this.y };
  }
  replay(dt) {
    const p = this.path;
    if (!p) return;
    const s = p.steps[p.i];
    if (s.cmd === 3 || s.cmd === 4 || s.cmd === 5) {
      const from = { x: this.x, y: this.y };
      this.x = s.x; this.y = s.y; p.fromX = s.x; p.fromY = s.y;
      if (s.cmd === 4) this.g.petEffect(this, 1);
      if (s.cmd === 5) this.g.petEffect(this, 2, from);
      this.setStance(s.stance);
      if (++p.i >= p.steps.length) this.path = null;
      return;
    }
    const k = Math.min(1, (p.t += dt) / (Math.max(1, s.duration || 30) / 1000));
    this.x = p.fromX + (s.x - p.fromX) * k; this.y = p.fromY + (s.y - p.fromY) * k;
    this.setStance(s.stance);
    if (k >= 1) { p.fromX = s.x; p.fromY = s.y; p.t = 0; if (++p.i >= p.steps.length) this.path = null; }
  }
  setStance(st) {
    if (st === undefined) return;
    this.facingLeft = !!(st & 1);
    this.moveAction = MOVE_ACT[st >> 1] ? st >> 1 : 2;
    this.remoteHang = this.moveAction === 15;
  }

  // ---------------------------------------------------------------- frame
  /**
   * While its owner climbs, the pets go up with them: only the lead pet shows (after 120ms, in the basket when there
   * are several), drawn over the owner.
   */
  get onBack() { return this.act === 'hang'; }
  get hidden() {
    if (!this.onBack) return false;
    return this.slot !== 0 || (this.mine && performance.now() < (this.visibleAt || 0));
  }
  layer() {
    if (this.onBack) return 7;
    const f = this.mine ? this.fh : this.g.map?.fh?.below(this.x, this.y - 2, 12);
    if (f?.layer !== undefined) this.lastLayer = f.layer;
    return this.lastLayer ?? 7;
  }
  draw(ctx, cam) {
    if (this.hidden) return;
    const fr = frames(this.node()), node = fr[this.frame] || fr[0], img = node && this.g.assets.image(node);
    const x = Math.round(this.x - cam.x), y = Math.round(this.y - cam.y);
    if (img) {
      const o = node.origin || [img.width / 2, img.height];
      ctx.save();
      // the art faces left; hanging it is never flipped
      if (!this.facingLeft && this.act !== 'hang') { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -o[0], -o[1]); }
      else ctx.drawImage(img, x - o[0], y - o[1]);
      ctx.restore();
      this.g.drawPetEquip?.(ctx, this, x, y, o, node);
    }
    if (!this.onBack) this.g.drawPetName(ctx, this, x, y);
  }
}

/** A reaction ({act, speech keys}) at random from a success / fail list, and one of its lines. */
export function pickReaction(list, dialog, petId) {
  const r = list && pick(Object.values(list).filter((v) => v && typeof v === 'object'));
  if (!r) return { act: null, text: '' };
  const keys = Object.keys(r).filter((k) => /^\d+$/.test(k)).map((k) => r[k]);
  const key = keys.length ? pick(keys) : null;
  return { act: r.act || null, text: (key && dialog?.[petId]?.[key]) || '' };
}
