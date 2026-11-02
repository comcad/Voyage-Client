import { pad, frames } from './assets.js';
import { nameTag } from './map.js';
import { uiText, wrapText } from './ui/wzui.js';

/**
 * Shop signs as the client draws them in the Free Market.
 *  - A player shop: UI/ChatBalloon.img/miniroom/PSSkin/<permit % 100> (112x63; PSSkin/0 already carries
 *    the coin and the lock) over the owner's head, its title in the white area, and Able / Disable in the
 *    pill (room for more visitors or not).
 *  - A Hired Merchant: Item/Cash/0503.img/<item>: skin/backgrnd, the employee (stand), skin/shop in front
 *    and skin/signboard on top - 166x166 layers sharing one origin - with the title on the board, the same
 *    pill, and "<owner>'s Hired Merchant" under it. Double-clicking either goes in.
 */
export class ShopBoards {
  constructor(game) {
    this.g = game;
    game.assets.json('UI/ChatBalloon.img').then(async (cb) => {
      this.M = cb?.miniroom;
      if (this.M) await game.assets.preload([this.M.Able, this.M.Disable, ...Object.values(this.M.PSSkin || {})].filter(Boolean));
    });
    this.items = null;
    game.assets.json('Item/Cash/0503.img').then((m) => { this.items = m; });
    this.merchants = new Map();      // owner id -> merchant
  }
  clear() { this.merchants.clear(); }

  // ---------------------------------------------------------------- hired merchants
  async spawn(m) {
    this.merchants.set(m.owner, m);
    const node = (this.items || (await this.g.assets.json('Item/Cash/0503.img')))?.[pad(m.itemId, 8)];
    if (!node) return;
    const parts = [node.skin?.backgrnd, node.skin?.shop, node.skin?.signboard, ...frames(node.employee?.stand)].filter(Boolean);
    await this.g.assets.preload(parts);
    m.art = node;
  }
  update(owner, info) { const m = this.merchants.get(owner); if (m) Object.assign(m, info); }
  remove(owner) { this.merchants.delete(owner); }

  /** The stall layers, the board's title and pill, and the owner's name tag. */
  drawMerchant(ctx, cam, m) {
    const im = (n) => this.g.assets.image(n), a = m.art;
    if (!a) return;
    const x = Math.round(m.x - cam.x), y = Math.round(m.y - cam.y);
    // the skin layers' origin is their top-left anchor; the stall stands with its base on the ground
    const sx = x - 83, sy = y - 155;
    const layer = (n) => { const i = im(n); if (i) ctx.drawImage(i, sx, sy); };
    layer(a.skin?.backgrnd);
    const emp = frames(a.employee?.stand)[0], ei = im(emp);
    if (ei) { const o = emp.origin || [ei.width / 2, ei.height]; ctx.drawImage(ei, x - o[0], y - 38 - o[1]); }
    layer(a.skin?.shop);
    layer(a.skin?.signboard);
    this.boardText(ctx, m.title, sx + 22, sy + 21, 108);
    this.pill(ctx, m, sx + 63, sy + 52);
    nameTag(ctx, `${m.name}'s Hired Merchant`, x, y + 2, '#fff');
    m.hit = { x: sx + 10 + cam.x, y: sy + cam.y, w: 146, h: 160 };
  }

  // ---------------------------------------------------------------- player shops
  /**
   * A player shop's sign. The Regular Store Permit's (PSSkin/0) is a balloon over the owner's head;
   * the other permits' (PSSkin/1-6, 156x159) are booths - a roof, the white sign (x 27-131, y 36-66), the bar with coin, lock and pill (pill from x 75, y 68), two posts
   * (inner gap x 39-116) and a base step - drawn over the owner standing inside it.
   */
  drawShopBoard(ctx, cam, ent, sx, sy) {
    const M = this.M, b = ent.box;
    if (!M) return;
    const board = (b.permit && M.PSSkin?.[b.permit]) || M.PSSkin?.[0], bi = this.g.assets.image(board);
    if (!bi) return;
    const booth = board !== M.PSSkin?.[0];
    let x, y;
    if (booth) {
      x = Math.round(sx - 78); y = Math.round(sy - 154);
      ctx.drawImage(bi, x, y);
      this.boardText(ctx, b.title, x + 31, y + 38, 98);
      this.pill(ctx, b, x + 75, y + 68);
    } else {
      x = Math.round(sx - 56); y = Math.round(sy - 140);
      ctx.drawImage(bi, x, y);
      this.boardText(ctx, b.title, x + 7, y + 6, 96);
      this.pill(ctx, b, x + 61, y + 40);   // PSSkin/0's own pill
    }
    ent.signRect = { x: x + cam.x, y: y + cam.y, w: bi.width, h: bi.height };
  }

  boardText(ctx, text, x, y, width) {
    ctx.save();
    ctx.font = '12px Arial, sans-serif';
    const lines = wrapText(ctx, text || '', width, 12).slice(0, 2);
    ctx.restore();
    lines.forEach((l, i) => uiText(ctx, l, x, y + i * 14, { color: '#000', size: 12 }));
  }
  /** The boards' pill art already shows O (room for visitors); a full shop gets Disable over it. */
  pill(ctx, box, x, y) {
    if (!box.max || box.players < box.max) return;
    const p = this.g.assets.image(this.M?.Disable);
    if (p) ctx.drawImage(p, x, y);
  }

  /** The merchant or player shop at canvas point (x, y) in world terms. */
  at(wx, wy) {
    for (const m of this.merchants.values()) {
      const r = m.hit;
      if (r && wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h) return { merchant: m };
    }
    return null;
  }
}
