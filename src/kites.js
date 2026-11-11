import { pad } from './assets.js';
import { Anim } from './map.js';
import { snapPx } from './view.js';

/**
 * Kites and banners (508xxxx): the item's iconReward looping at (x - 3, y - 100), bobbing sin(phase) x 3 with the
 * phase stepping 0.0942477 every 30 ms from a random start. Hovering shows the owner's name and the item's msg;
 * double-clicking opens the message. REMOVE_KITE 0 fades it out over a second where it rests, otherwise it goes at once.
 */
export class Kites {
  constructor(game) { this.g = game; this.kites = new Map(); }
  clear() { this.kites.clear(); }
  async spawn(k) {
    if (this.kites.has(k.id)) return;
    const node = (await this.g.assets.json('Item/Cash/0508.img'))?.[pad(k.itemId, 8)]?.iconReward;
    const anim = node ? new Anim(node, true) : null;
    if (anim) await this.g.assets.preload(anim.frames);
    this.kites.set(k.id, { ...k, x0: k.x - 3, y0: k.y - 100, phase: Math.floor(Math.random() * 360), acc: 0, anim, fade: null });
  }
  remove(type, id) {
    const k = this.kites.get(id);
    if (!k) return;
    if (type === 0) k.fade = 1000; else this.kites.delete(id);
  }
  update(dt) {
    for (const [id, k] of this.kites) {
      if (k.fade !== null) { if ((k.fade -= dt * 1000) <= 0) this.kites.delete(id); continue; }
      k.anim?.update(dt * 1000);
      for (k.acc += dt * 1000; k.acc >= 30; k.acc -= 30) k.phase += 0.0942477;
    }
  }
  pos(k) { return { x: k.x0, y: k.y0 + (k.fade !== null ? 0 : Math.trunc(Math.sin(k.phase) * 3)) }; }
  draw(ctx, cam) {
    for (const k of this.kites.values()) {
      const n = k.anim?.node, img = n && this.g.assets.image(n);
      if (!img) continue;
      const p = this.pos(k), o = n.origin || [0, 0];
      ctx.save();
      if (k.fade !== null) ctx.globalAlpha *= Math.max(0, k.fade / 1000);
      ctx.drawImage(img, snapPx(p.x - cam.x - o[0]), snapPx(p.y - cam.y - o[1]));
      ctx.restore();
    }
  }
  /** The kite whose box (30 either side, 40 above and below its rest point) holds a field point. */
  at(x, y) {
    for (const k of this.kites.values()) if (k.fade === null && Math.abs(x - k.x0) <= 30 && Math.abs(y - k.y0) <= 40) return k;
    return null;
  }
}
