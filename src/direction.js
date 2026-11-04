import { isCanvas, frames } from './assets.js';
import { Anim } from './map.js';
import { sfx } from './audio.js';

/**
 * A scene from the server (user effect 0x12, e.g. "Effect/Direction3.img/swordman/Scene0"): numbered events, each
 * firing `start` ms in:
 *   0  a visual over the screen at (x, y) from its centre, played once, moving by (x1, y1) across `duration`;
 *      higher `z` on top; with its `sound`
 *   2  move to `field`
 *   3  your character wears these items (slot: id) until the next map
 *   4  your character plays `action`
 *   5  a sound
 */
export class DirectionScene {
  constructor(game, events) {
    this.game = game; this.t = 0;
    this.events = events.map((e, i) => ({ ...e, i, start: Number(e.start) || 0 })).sort((a, b) => a.start - b.start || a.i - b.i);
    this.next = 0; this.visuals = [];
  }

  static async load(game, path) {
    const node = await resolve(game.assets, path);
    if (!node) return null;
    const events = frames(node).filter((e) => e && typeof e === 'object').map((e) => ({ ...e }));
    await Promise.all(events.filter((e) => Number(e.type) === 0 && e.visual).map(async (e) => {
      e.layers = layersOf(await resolve(game.assets, e.visual));
      await game.assets.preload(e.layers.flatMap((l) => new Anim(l).frames));
    }));
    return new DirectionScene(game, events);
  }

  get done() { return this.next >= this.events.length && !this.visuals.length; }

  update(dt) {
    this.t += dt * 1000;
    while (this.next < this.events.length && this.events[this.next].start <= this.t) this.fire(this.events[this.next++]);
    for (const v of this.visuals) {
      v.t += dt * 1000;
      for (const a of v.anims) a.update(dt * 1000);
    }
    this.visuals = this.visuals.filter((v) => v.anims.some((a) => !a.done));
  }

  fire(e) {
    const g = this.game, type = Number(e.type);
    if (e.sound && (type === 0 || type === 5)) sfx.play(soundPath(e.sound));
    if (type === 0 && e.layers?.length) {
      this.visuals.push({ anims: e.layers.map((l) => new Anim(l, false)), x: Number(e.x) || 0, y: Number(e.y) || 0,
        dx: Number(e.x1) || 0, dy: Number(e.y1) || 0, duration: Number(e.duration) || 0, z: Number(e.z) || 0, i: e.i, t: 0 });
      this.visuals.sort((a, b) => a.z - b.z || a.i - b.i);
    } else if (type === 2 && e.field) g.directionField(Number(e.field));
    else if (type === 3) g.directionLook(Object.fromEntries(Object.entries(e).filter(([k]) => /^\d+$/.test(k)).map(([k, v]) => [Number(k), Number(v)])));
    else if (type === 4 && e.action) g.directionAction(String(e.action));
  }

  draw(ctx, cx, cy) {
    const assets = this.game.assets;
    for (const v of this.visuals) {
      const k = v.duration ? Math.min(1, v.t / v.duration) : 1;
      const x = cx + v.x + v.dx * k, y = cy + v.y + v.dy * k;
      for (const a of v.anims) {
        if (a.done) continue;
        const f = a.node, img = f && assets.image(f);
        if (!img) continue;
        const o = f.origin || [0, 0];
        ctx.save();
        ctx.globalAlpha = a.alpha;
        ctx.drawImage(img, Math.round(x - o[0]), Math.round(y - o[1]));
        ctx.restore();
      }
    }
  }
}

/** "Effect/Direction3.img/a/b" -> that node. */
async function resolve(assets, path) {
  const at = path.indexOf('.img');
  if (at < 0) return null;
  let node = await assets.json(path.slice(0, at + 4));
  for (const seg of path.slice(at + 5).split('/').filter(Boolean)) node = node?.[seg];
  return node || null;
}

/** A visual is one animation, or numbered layers of them played together. */
function layersOf(node) {
  if (!node) return [];
  if (isCanvas(node) || frames(node).some(isCanvas)) return [node];
  return frames(node).filter((l) => frames(l).some(isCanvas) || isCanvas(l));
}

/** "Sound/Skill.img/1311001/Use" -> "Skill/1311001/Use"; other WZ files keep their full path. */
function soundPath(p) {
  const s = String(p);
  return s.startsWith('Sound/') ? s.slice(6).replace('.img/', '/') : s;
}
