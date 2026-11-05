import { music, sfx } from './audio.js';
import { pad, nodeAt, frameAt } from './assets.js';
import { allCanvases } from './ui/windows.js';
import { uiText } from './ui/wzui.js';

const isCanvas = (n) => !!n?._canvas;
const W = 800, H = 600;
/** Burst weather (type 3): each of its five frame sets goes off `count` times every `every` ms. */
const BURSTS = [{ every: 200, count: 1 }, { every: 1000, count: 5 }, { every: 500, count: 3 }, { every: 300, count: 2 }, { every: 200, count: 1 }];

/**
 * Cash weather (BLOW_WEATHER), over the whole screen until the server stops it (item 0). From the item's
 * Item/Cash/0512.img/<id>/info:
 * - path: the art. Types 1 / 2 fall, a random piece each (its "count" pieces times 30-54%); a piece made of frames
 *   ("ani") plays them as it falls. Types 3 / 4 burst: <path><n> (3) or <path>/<n> (4) frame sets at random places,
 *   each set on its own timer (type 3: BURSTS).
 * - floatType: the message's UIWindow.img/FloatNotice/<n> frame, its left / tiled middle / right stretched round the
 *   text, centred at y 160, for 20s.
 * - bgmPath: a sound to play with it: as the music (isBgmOrEffect 1) or an effect, looped when `repeat` is set.
 *   When the weather ends, an effect stops and the field's music comes back.
 */
export class Weather {
  constructor(g) { this.g = g; this.cur = null; }
  get active() { return !!this.cur; }

  async start(itemId, message) {
    const a = this.g.assets, seq = (this.seq = (this.seq || 0) + 1);
    const info = (await a.json('Item/Cash/0512.img'))?.[pad(itemId, 8)]?.info;
    if (!info || seq !== this.seq) return;
    const path = String(info.path || ''), type = Number(info.type) || 1, node = await nodeAt(a, path);
    const ui = await a.json('UI/UIWindow.img'), notice = ui?.FloatNotice?.[Number(info.floatType) || 0];
    let sets = [];
    if (type === 3) { const cut = path.lastIndexOf('/'), parent = await nodeAt(a, path.slice(0, cut)), base = path.slice(cut + 1); for (let i = 0; parent?.[`${base}${i}`]; i++) sets.push(parent[`${base}${i}`]); }
    else if (type === 4) { for (let i = 0; node?.[i]; i++) sets.push(node[i]); }
    else sets = Object.keys(node || {}).filter((k) => /^\d+$/.test(k)).map((k) => node[k]);
    await a.preload([...sets.flatMap((s) => allCanvases(s)), ...allCanvases(notice)]);
    if (seq !== this.seq) return;
    const frames = (s) => (isCanvas(s) ? [s] : Object.keys(s || {}).filter((k) => /^\d+$/.test(k)).map((k) => s[k]).filter(isCanvas));
    const cur = { itemId, type, dir: Number(info.direction) || 0, sets: sets.map(frames).filter((f) => f.length), message, notice, msgUntil: performance.now() + 20000, pieces: [] };
    if (type === 1 || type === 2) {
      const n = Math.round(((Number(node?.count) || 100) * (30 + Math.floor(Math.random() * 25))) / 100);
      for (let i = 0; i < n; i++) cur.pieces.push(this.piece(cur));
    }
    this.cur = cur;
    this.stopSound?.(); this.stopSound = null;   // the last weather's sound goes with it
    if (info.bgmPath) {
      const p = String(info.bgmPath).replace(/^Sound\//, '').replace('.img', ''), loop = !!Number(info.repeat);
      if (Number(info.isBgmOrEffect)) music.play(p, { loop, fadeOut: 1000, fadeIn: 1000, force: true });
      else if (loop) { const stop = await sfx.loop(p); if (seq === this.seq) this.stopSound = stop; else stop?.(); }
      else sfx.play(p);
    }
  }
  /** restore: the weather ended on this map, so the field's music comes back. */
  stop(restore = true) {
    this.seq = (this.seq || 0) + 1; this.cur = null;
    this.stopSound?.(); this.stopSound = null;
    if (restore) this.g.restoreFieldMusic();
  }

  /**
   * A falling piece, by the item's info/direction: it starts anywhere on the screen and in 3-6s goes 300px down (0),
   * 300px up (1), 400px left (2) or 400px right (3), drifting up to 100px across; then it starts over. It turns a
   * full circle every 2s from a random angle.
   */
  piece(cur) {
    const r = (n) => Math.random() * n, dur = 3000 + r(3000), d = cur.dir;
    let x0 = r(W), y0 = r(H), x1 = x0 + r(200) - 100, y1 = y0 + (d === 1 ? -300 : 300);
    if (d === 2 || d === 3) { x1 = x0 + (d === 2 ? -400 : 400); y1 = y0 + r(200) - 100; }
    return { set: Math.floor(r(cur.sets.length)), x0, x1, y0, y1, dur, t: r(dur), spin: r(360) };
  }
  update(dt) {
    const c = this.cur;
    if (!c) return;
    const ms = dt * 1000;
    if (c.type === 1 || c.type === 2) {
      for (const p of c.pieces) p.t = (p.t + ms) % p.dur;
    } else {
      // each frame set on its own clock (BURSTS for type 3, every 500ms once for the others), anywhere in the middle 5/6 of the screen
      c.clocks ??= c.sets.map(() => 0);
      c.sets.forEach((_, k) => {
        const b = c.type === 3 ? BURSTS[k] || BURSTS[0] : { every: 500, count: 1 };
        for (c.clocks[k] += ms; c.clocks[k] >= b.every; c.clocks[k] -= b.every) {
          for (let n = 0; n < b.count; n++) c.pieces.push({ set: k, x: W / 12 + Math.random() * W * 5 / 6, y: H / 12 + Math.random() * H * 5 / 6, t: 0 });
        }
      });
      for (const p of c.pieces) p.t += ms;
      c.pieces = c.pieces.filter((p) => p.t < c.sets[p.set].reduce((t, f) => t + (Number(f.delay) || 100), 0));
    }
  }
  draw(ctx) {
    const c = this.cur, a = this.g.assets;
    if (!c) return;
    for (const p of c.pieces) {
      const fr = c.sets[p.set], falling = c.type === 1 || c.type === 2, f = frameAt(fr, p.t, falling), img = f && a.image(f);
      if (!img) continue;
      const o = f.origin || [img.width / 2, img.height / 2];
      if (falling) {
        const k = p.t / p.dur, x = p.x0 + (p.x1 - p.x0) * k, y = p.y0 + (p.y1 - p.y0) * k;
        ctx.save(); ctx.translate(x, y);
        ctx.rotate(((p.spin + (performance.now() % 2000) * 0.18) * Math.PI) / 180);
        const edge = Math.min(p.t, p.dur - p.t);   // a short fade at each end, so it doesn't pop in and out
        if (edge < 300) ctx.globalAlpha = edge / 300;
        ctx.drawImage(img, -o[0], -o[1]); ctx.restore();
      } else ctx.drawImage(img, Math.round(p.x - o[0]), Math.round(p.y - o[1]));
    }
  }
  /**
   * The weather's message for 20s on its FloatNotice frame at 75%: the left piece, the middle repeated as many
   * times as the text needs, the right piece; centred, its top at y 160; the text centred on it, at the
   * frame's own y.
   */
  drawNotice(ctx) {
    const c = this.cur, N = c?.notice, a = this.g.assets;
    if (!c?.message || !N || performance.now() > c.msgUntil) return;
    const l = a.image(N[0]), m = a.image(N[1]), r = a.image(N[2]);
    if (!l || !m || !r) return;
    ctx.save(); ctx.font = '12px Arial, sans-serif';
    const tw = Math.ceil(ctx.measureText(c.message).width), n = Math.max(1, Math.ceil(tw / m.width));
    const w = l.width + n * m.width + r.width, x = Math.floor((W - w) / 2), y = 160;
    ctx.globalAlpha = 0xc0 / 255;
    ctx.drawImage(l, x, y);
    for (let i = 0; i < n; i++) ctx.drawImage(m, x + l.width + i * m.width, y);
    ctx.drawImage(r, x + l.width + n * m.width, y);
    ctx.restore();
    uiText(ctx, c.message, x + Math.round((w - tw) / 2), y + (Number(N.y) || 0), { color: '#fff', size: 12 });
  }
}
