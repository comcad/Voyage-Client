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
  /** Can an attack set it off now? Not one walked into, nor one that waits for an item or a timer. */
  get hittable() { const t = Number(this.event?.type ?? -1); return !this.gone && !this.touch && t >= 0 && t < 100 && t !== 9; }

  /** The server moved it on to `state`: the old state's hit animation, then the new state's picture. */
  setState(state) {
    const old = this.state;
    this.state = state;
    const hit = this.img?.[old]?.hit;
    this.hitAnim = hit && Object.keys(hit).some((k) => /^\d+$/.test(k)) ? new Anim(hit, false) : null;
    this.idle = this.stateAnim(state);
    sfx.play(`Reactor/${this.id}/${old}/Hit`);
  }
  /** The server removed it: its last hit animation plays out, then it is gone. */
  destroy(state = this.state) {
    if (state !== this.state) this.setState(state);
    this.gone = true;
    if (!this.hitAnim) this.removed = true;
  }

  update(dt) {
    const ms = dt * 1000;
    if (this.hitAnim) {
      this.hitAnim.update(ms);
      if (this.hitAnim.done) { this.hitAnim = null; if (this.gone) this.removed = true; }
      return;
    }
    this.idle?.update(ms);
  }
  get node() { return this.hitAnim?.node || (this.gone ? null : this.idle?.node); }
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
