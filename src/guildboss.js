/**
 * Two small event fields.
 *
 * Witch Tower (fieldType 21): WITCH_TOWER_SCORE carries the keys you hold. The first one opens the score box
 * (Map/Obj/etc.img/goldkey), 115x36 at (342, 92) on the screen, until you leave the map; it ignores the packet
 * anywhere else. The box and the key both stand at its top-left (their places are unverified: the box is the
 * window's own size); the score is at least two digits from (67, 4), each 2px into the one before (unverified).
 *
 * The Sharenian guild boss field (fieldType 8), from the map's healer and pulley nodes:
 * - The healer (its frames looping) hangs at x, from yMin; GUILD_BOSS_HEALER_MOVE puts it at a new y.
 * - The pulley stands at (x, y). A close-range swing that reaches its box (x-186..x-60, y+90..y+184) turns it once
 *   (its frames in turn), and while its state is 0 asks the server to pull (GUILD_BOSS_PULLEY_HIT, no body).
 * - GUILD_BOSS_PULLEY_STATE sets that state. How the healer rises, falls and heals is up to the server.
 */
import { frames, frameAt, nodeAt } from './assets.js';

export class WitchTowerScore {
  constructor(game) { this.game = game; this.score = 0; }
  async load() {
    const A = (this.art = await nodeAt(this.game.assets, 'Map/Obj/etc.img/goldkey'));
    await this.game.assets.preload([A?.backgrnd, A?.key, ...Object.values(A?.number || {})].filter((n) => n?._canvas));
    return this;
  }
  draw(ctx) {
    const A = this.art, im = (n) => n && this.game.assets.image(n), X = 342, Y = 92;
    if (!A) return;
    const bg = im(A.backgrnd), key = im(A.key);
    if (bg) ctx.drawImage(bg, X, Y);
    if (key) ctx.drawImage(key, X, Y);
    let x = X + 67;
    for (const ch of String(this.score).padStart(2, '0')) {
      const img = im(A.number?.[ch]);
      if (!img) continue;
      ctx.drawImage(img, x, Y + 4);
      x += img.width - 2;
    }
  }
}

export class GuildBossField {
  constructor(game, map) {
    const d = map.data || {};
    this.game = game; this.healer = d.healer || null; this.pulley = d.pulley || null;
    this.hy = Number(this.healer?.yMin) || 0; this.state = 0; this.t = 0; this.turn = null;
  }
  async load() {
    const a = this.game.assets;
    this.healerArt = this.healer?.healer ? frames(await nodeAt(a, this.healer.healer)) : [];
    this.pulleyArt = this.pulley?.pulley ? frames(await nodeAt(a, this.pulley.pulley)) : [];
    await a.preload([...this.healerArt, ...this.pulleyArt].filter((n) => n?._canvas));
    return this;
  }
  healerMove(y) { this.hy = y; }
  pulleyState(s) { this.state = s; }
  update(dt) {
    this.t += dt * 1000;
    if (this.turn !== null) {
      this.turn += dt * 1000;
      if (this.turn >= this.pulleyArt.reduce((s, f) => s + (Number(f.delay) || 100), 0)) this.turn = null;
    }
  }
  /** A close-range swing's box when it lands: the pulley turns, and asks to be pulled while its state is 0. */
  swing(b) {
    const P = this.pulley;
    if (!P || !b) return;
    const x = Number(P.x) || 0, y = Number(P.y) || 0;
    if (b.x2 < x - 186 || b.x1 > x - 60 || b.bottom < y + 90 || b.top > y + 184) return;
    this.turn = 0;
    if (this.state === 0) this.game.net?.pullGuildBossPulley();
  }
  draw(ctx, cam) {
    const at = (n, x, y) => { const img = n && this.game.assets.image(n), o = n?.origin || [0, 0]; if (img) ctx.drawImage(img, Math.round(x - o[0] - cam.x), Math.round(y - o[1] - cam.y)); };
    if (this.healer && this.healerArt.length) at(frameAt(this.healerArt, this.t), Number(this.healer.x) || 0, this.hy);
    if (this.pulley && this.pulleyArt.length) at(this.turn === null ? this.pulleyArt[0] : frameAt(this.pulleyArt, this.turn, false), Number(this.pulley.x) || 0, Number(this.pulley.y) || 0);
  }
}
