import { pad } from './assets.js';
import { sfx } from './audio.js';
import { Anim } from './map.js';
import { Footholds } from './physics.js';

/**
 * Reactors (Reactor.wz): the boxes, plants and rocks of a map that you hit, or walk into, to drop items or move a
 * quest on. The server owns them (REACTOR_SPAWN / REACTOR_HIT / REACTOR_DESTROY); each state N of
 * Reactor/<id>.img is:
 *   N/0, N/1...   the picture while it is in that state (animated when it has several frames)
 *   N/event/0     what moves it on: type (0 a hit, 2 a hit from the right side only, 100 an item dropped on it...)
 *   N/hit         played once as it leaves that state (a box cracking, a plant shaking)
 * info/link borrows another reactor's art; info/activateByTouch makes walking into it the trigger.
 */
export class Reactor {
  constructor(d, img, map) {
    Object.assign(this, { oid: d.oid, id: d.id, x: d.x, y: d.y, state: d.state, img });
    this.touch = Number(img?.info?.activateByTouch) > 0;
    const fh = map?.fh?.below(d.x, d.y - 5, 200);
    this.layer = fh?.layer ?? 7;
    if (fh && Math.abs(Footholds.yAt(fh, d.x) - d.y) < 3) this.y = Footholds.yAt(fh, d.x);
    this.idle = this.stateAnim(this.state);
    this.hitAnim = null;     // the leaving animation of the state it was just in, played before the new one shows
    this.gone = false;       // destroyed: remove once its last hit animation has played
    this.removed = false;
    this.touching = false;
    // 0 idle, 1 waiting for the hit to show (hitAt), 2 playing the hit animation, 4 destroyed
    this.phase = 0; this.hitAt = 0; this.removeAt = 0; this.from = this.state;
    this.blockUntil = performance.now() + 800;   // a new reactor can't be hit for 800 ms
  }
  stateAnim(s) { const n = this.img?.[s]; return n && Object.keys(n).some((k) => /^\d+$/.test(k)) ? new Anim(n, true) : null; }
  /** Every frame it can show, for preloading. */
  frames() {
    const out = [];
    for (const [k, n] of Object.entries(this.img || {})) {
      if (!/^\d+$/.test(k) || !n) continue;
      out.push(...new Anim(n).frames);
      if (n.hit) out.push(...new Anim(n.hit).frames);
    }
    return out;
  }
  get event() { return this.img?.[this.state]?.event?.[0] || null; }
  /**
   * Can an attack set it off now? Not one walked into, nor one that waits for an item or a timer; not while a hit is
   * still showing, nor before its block time (800 ms after it appears, the hit's tenths of a second after a hit).
   */
  get hittable() {
    const t = Number(this.event?.type ?? -1);
    return !this.gone && !this.touch && t >= 0 && t < 100 && t !== 9 && this.phase === 0 && performance.now() >= this.blockUntil;
  }

  /**
   * REACTOR_HIT: the server moved it on to `state`. After `delay` ms the old state's hit animation plays, then the
   * new state's picture shows; it can't be hit again for block x 100 ms.
   */
  hit(state, delay = 0, block = 0) {
    const now = performance.now();
    this.from = this.state;
    this.state = state;
    if (this.phase === 0) { this.phase = 1; this.hitAt = now + delay; }
    this.blockUntil = now + block * 100;
  }
  /** The old state's hit animation, with its sound (quieter far off); false when it has none. */
  playHit() {
    const hit = this.img?.[this.from]?.hit;
    this.hitAnim = hit && Object.keys(hit).some((k) => /^\d+$/.test(k)) ? new Anim(hit, false) : null;
    if (!this.hitAnim?.frames.length) this.hitAnim = null;
    if (this.hitAnim) sfx.play(`Reactor/${this.id}/${this.from}/Hit`, { volume: this.volumeAt?.(this.x, this.y) ?? 1 });
    return !!this.hitAnim;
  }
  /**
   * REACTOR_DESTROY: it stops where it is. Destroyed into a state with no events, it waits 400 ms, plays the old
   * state's hit animation and goes; otherwise it goes at once.
   */
  destroy(state = this.state) {
    this.from = this.state;
    this.state = state;
    this.phase = 4;
    this.gone = true;
    this.hitAnim = null;
    const ev = this.img?.[state]?.event;
    this.removeAt = ev && Object.keys(ev).some((k) => /^\d+$/.test(k)) ? 0 : performance.now() + 400;
    if (!this.removeAt) this.removed = true;
  }

  update(dt) {
    const ms = dt * 1000, now = performance.now();
    if (this.phase === 1 && now > this.hitAt) {
      // no hit animation: the new state shows at once
      if (this.playHit()) this.phase = 2; else { this.idle = this.stateAnim(this.state); this.phase = 0; }
    }
    if (this.phase === 4) {
      if (this.removeAt && now >= this.removeAt) { this.removeAt = 0; if (!this.playHit()) this.removed = true; }
      if (!this.removeAt && this.hitAnim) { this.hitAnim.update(ms); if (this.hitAnim.done) this.removed = true; }
      return;
    }
    if (this.phase === 2) {
      this.hitAnim?.update(ms);
      if (!this.hitAnim || this.hitAnim.done) { this.hitAnim = null; this.idle = this.stateAnim(this.state); this.phase = 0; }
      return;
    }
    this.idle?.update(ms);
  }
  get node() { return this.hitAnim?.node || this.idle?.node; }
  /** The picture's box in the world (what attacks and walking into it test). */
  box() {
    const n = this.node || this.idle?.node;
    if (!n) return null;
    const o = n.origin || [0, 0];
    return { left: this.x - o[0], right: this.x - o[0] + (n._w || 0), top: this.y - o[1], bottom: this.y - o[1] + (n._h || 0) };
  }
  draw(ctx, cam, assets) {
    const n = this.node, img = n && assets.image(n);
    if (!img) return;
    const o = n.origin || [0, 0];
    const alpha = (this.hitAnim || this.idle)?.alpha ?? 1;
    if (alpha < 1) { ctx.save(); ctx.globalAlpha *= alpha; }
    ctx.drawImage(img, Math.round(this.x - o[0] - cam.x), Math.round(this.y - o[1] - cam.y));
    if (alpha < 1) ctx.restore();
  }
}

/** Reactor/<id>.img, following info/link to the reactor whose art it borrows. */
export async function loadReactorImg(assets, id) {
  let img = await assets.json(`Reactor/${pad(id, 7)}.img`);
  const link = img?.info?.link;
  if (link && !Object.keys(img).some((k) => /^\d+$/.test(k) && img[k]?.[0])) {
    const linked = await assets.json(`Reactor/${pad(Number(link), 7)}.img`);
    if (linked) img = { ...linked, info: { ...linked.info, ...img.info } };
  }
  return img;
}
