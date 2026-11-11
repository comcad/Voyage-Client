import { pad } from './assets.js';
import { sfx } from './audio.js';
import { Anim } from './map.js';

/**
 * Reactors (Reactor.wz): the boxes, plants and rocks of a map that you hit, or walk into, to drop items or move a
 * quest on. The server owns their states (REACTOR_SPAWN / REACTOR_HIT / REACTOR_DESTROY); each state N of
 * Reactor/<id>.img (from info/link's image when it borrows one) is:
 *   N/0, N/1...       the picture while it is in that state (looping when N has repeat 1)
 *   N/event/<i>       what moves it on: its type (0 any hit, 1 / 2 a hit facing right / left, 3 / 4 the same in the
 *                     air, 5 a skill inside lt/rb, 100... items and the rest the server's), activeSkillID
 *   N/hit             played once as it leaves that state (N/event/<i>/hit first, then the image's own hit)
 * The flags (activateByTouch, quest...) are the reactor's own info, never the linked one's.
 *
 * Its phases: 0 idle; 1 a hit to show at playAt; 2 that hit playing; 4 destroyed. A hit plays the state being left
 * (old) - the event picked from the stance of the blow when none was named - with its Hit sound, then the current
 * state's picture shows. A hit the client starts itself (your swing) plays when the swing lands, even before the
 * server answers; the server's REACTOR_HIT then names the state and event (or plays again if it came too late).
 */
const FADE_IN = 800, NEW_BLOCK = 800, DESTROY_WAIT = 400;

export class Reactor {
  constructor(d, img, info, map) {
    Object.assign(this, { oid: d.oid, id: d.id, x: d.x, y: d.y, cur: d.state, old: d.state, img, info: info || {} });
    this.flip = !!d.flip; this.name = d.name || '';
    this.touch = Number(this.info.activateByTouch) > 0;
    this.quest = Number(this.info.quest) || 0;
    this.layer = Reactor.layerFor(map, d.x, d.y);
    this.phase = 0; this.playAt = 0; this.idx = -2; this.stance = 0; this.noHitUntil = performance.now() + NEW_BLOCK;
    this.removed = false; this.touching = false; this.frozen = false;
    this.bornAt = performance.now();
    this.anim = this.idleAnim();
  }
  /** Drawn in the page of the floor nearest it, by the distance to each floor's middle. */
  static layerFor(map, x, y) {
    let best = null, bd = Infinity;
    for (const f of map?.fh?.floors || []) {
      if (f.x1 + 8 > f.x2) continue;
      const d = Math.hypot((f.x1 + f.x2) / 2 - x, (f.y1 + f.y2) / 2 - y);
      if (d < bd) { bd = d; best = f; }
    }
    return best?.layer ?? 7;
  }
  get state() { return this.cur; }
  get gone() { return this.phase === 4; }
  stateNode(s) { return this.img?.[s]; }
  events(s) { const ev = this.stateNode(s)?.event || {}; return Object.keys(ev).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => ev[k]); }
  /** The picture of the current state: looping when it repeats, otherwise played through and held. */
  idleAnim() {
    const n = this.stateNode(this.cur);
    if (!n || !Object.keys(n).some((k) => /^\d+$/.test(k))) return null;
    return new Anim(n, Number(n.repeat) === 1);
  }
  /** The hit art for leaving state s by event idx (-1 for none): the event's own, the state's, then the image's. */
  hitNode(s, idx) {
    const S = this.stateNode(s), has = (n) => n && Object.keys(n).some((k) => /^\d+$/.test(k));
    if (!S) return has(this.img?.hit) ? this.img.hit : null;
    const evs = this.events(s);
    if (idx >= 0 && idx < evs.length && has(evs[idx]?.hit)) return evs[idx].hit;
    if (has(S.hit)) return S.hit;
    return has(this.img?.hit) ? this.img.hit : null;
  }
  /**
   * The event a blow from this stance sets off: type 0 any (better on the ground), 1 / 2 facing right / left
   * (better on the ground), 3 / 4 the same in the air only; the best first, the first of equals; -1 for none.
   */
  pickEvent(s) {
    const ground = (this.stance & 2) !== 0, left = (this.stance & 1) !== 0;
    const rank = (t) => {
      if (t === 0) return ground ? 1 : 2;
      if (t === 1) return left ? -1 : ground ? 0 : 1;
      if (t === 2) return left ? (ground ? 0 : 1) : -1;
      if (t === 3) return !ground && !left ? 0 : -1;
      if (t === 4) return !ground && left ? 0 : -1;
      return -1;
    };
    let best = -1, br = Infinity;
    this.events(s).forEach((e, i) => { const r = rank(Number(e?.type)); if (r >= 0 && r < br) { br = r; best = i; } });
    return best;
  }
  /** Can a swing set it off now: idle, past its block time, its state having a hit event (type 0-4). */
  get hittable() {
    return this.phase === 0 && performance.now() >= this.noHitUntil && this.events(this.cur).some((e) => Number(e?.type) >= 0 && Number(e?.type) <= 4);
  }
  /** Your swing reached it: its hit plays when the swing lands, the event picked from your stance then. */
  struck(stance, delay) { this.phase = 1; this.idx = -2; this.stance = stance; this.playAt = performance.now() + delay; }
  /** A skill set off event idx (type 5): its hit plays 800ms on. */
  skillStruck(stance, idx) { this.phase = 1; this.idx = idx; this.stance = stance; this.playAt = performance.now() + 800; }
  /** REACTOR_HIT: its new state and the event to show; can't be hit for block x 100ms. */
  hit(state, delay = 0, idx = 0, block = 0) {
    const now = performance.now();
    this.old = this.cur; this.cur = state;
    if (this.phase === 0) { this.phase = 1; this.playAt = now + (delay || 1); }
    this.idx = idx;
    this.noHitUntil = now + block * 100;
  }
  /**
   * REACTOR_DESTROY: it stops where it is. Into a state with events it goes at once; otherwise it waits 400ms, plays
   * the old state's hit and goes when that is over.
   */
  destroy(state = this.cur) {
    this.old = this.cur; this.cur = state;
    this.frozen = true;
    this.phase = 4; this.idx = -2;
    this.playAt = this.events(state).length ? 0 : performance.now() + DESTROY_WAIT;
  }
  /** Shows the hit (phases 1 and 4) or the current picture. */
  play() {
    if (this.phase === 1 || this.phase === 4) {
      if (this.idx === -2) {
        this.idx = this.pickEvent(this.old);
        if (this.idx < 0) { this.phase = 0; return; }
      }
      const node = this.hitNode(this.old, this.idx);
      if (!node) return;
      this.anim = new Anim(node, false); this.frozen = false;
      sfx.play(`Reactor/${pad(this.id, 7)}/${this.old}/Hit`, { volume: this.volumeAt?.(this.x, this.y) ?? 1 });
      return;
    }
    this.anim = this.idleAnim();
  }
  get animating() { return !!this.anim && !this.anim.done && this.anim.frames.length > 1; }
  update(dt) {
    const now = performance.now();
    if (this.phase === 1) {
      if (this.playAt && now - this.playAt > 0) { this.playAt = 0; this.play(); if (this.phase !== 0) this.phase = 2; }
    } else if (this.phase === 2) {
      if (!this.anim || this.anim.done) { this.play(); this.phase = 0; }
    } else if (this.phase === 4 && now - this.playAt >= 0) {
      if (this.playAt) { this.play(); this.playAt = 0; }
      if (this.frozen || !this.anim || this.anim.done) this.removed = true;
    }
    if (!this.frozen) this.anim?.update(dt * 1000);
  }
  get node() { return this.anim?.node || null; }
  /** Every frame it can show, for preloading. */
  frames() {
    const out = [];
    for (const [k, n] of Object.entries(this.img || {})) {
      if (!/^\d+$/.test(k) || !n) continue;
      out.push(...new Anim(n).frames);
      if (n.hit) out.push(...new Anim(n.hit).frames);
      for (const e of this.events(k)) if (e?.hit) out.push(...new Anim(e.hit).frames);
    }
    if (this.img?.hit) out.push(...new Anim(this.img.hit).frames);
    return out;
  }
  /** The current frame's box in the world (mirrored when it is), or null with nothing showing. */
  box() {
    const n = this.node;
    if (!n || !n._w) return null;
    const o = n.origin || [0, 0];
    const left = this.flip ? this.x + o[0] - n._w : this.x - o[0];
    return { left, right: left + n._w, top: this.y - o[1], bottom: this.y - o[1] + (n._h || 0) };
  }
  draw(ctx, cam, assets) {
    const n = this.node, img = n && assets.image(n);
    if (!img) return;
    const o = n.origin || [0, 0];
    // a new one fades in over 800ms
    const fade = Math.min(1, (performance.now() - this.bornAt) / FADE_IN), alpha = (this.anim?.alpha ?? 1) * fade;
    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= alpha;
    ctx.translate(Math.round(this.x - cam.x), Math.round(this.y - cam.y));
    if (this.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -o[0], -o[1]);
    ctx.restore();
  }
}

/** Reactor/<id>.img and its own info: the states come from info/link's image when it borrows one. */
export async function loadReactorImg(assets, id) {
  const own = await assets.json(`Reactor/${pad(id, 7)}.img`);
  let img = own;
  const link = own?.info?.link;
  if (link) {
    const linked = await assets.json(`Reactor/${pad(Number(link), 7)}.img`);
    if (linked) img = linked;
  }
  return img ? { img, info: own?.info || {} } : null;
}
