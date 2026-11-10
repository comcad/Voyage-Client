import { Win, allCanvases } from './windows.js';
import { drawEmblem } from './social.js';
import { UI_W, UI_H } from '../view.js';

/**
 * The guild ranking board (UserList/Guild/GuildRank, 330x350, centred and modal), from GUILD_OPERATION 0x49. The top
 * guild stands alone at y 80 under the crown (icon0 at 155, 43, IconEff looping at 127, 23); then six a page from y 137,
 * 25px apart: ranks 2-7, 8-13 and so on. Each shows its rank at 44 ("0n" under 10), its name at 85 and its GP ending at
 * 275, in Arial 12 black: rank 1 opaque, ranks 2-3 at 180/255, the rest at 120/255. BtLeft (86, 297) and BtRight
 * (217, 297) turn the page; BtOK (148, 297) closes it. The emblem's place was lost: it sits centred in the art's
 * 60-85 cell of its 25px row.
 */
const ROW0 = 137, ROW_H = 25, PER_PAGE = 6, EFF_DELAY = 100;

export class GuildRankWin extends Win {
  constructor(mgr, list) {
    const R = mgr.W.UserList.Guild.GuildRank;
    super(mgr, R.backgrnd, (UI_W - 330) >> 1, (UI_H - 350) >> 1);
    this.buttons = []; this.closeBtn = null;
    this.R = R; this.list = list; this.page = 1; this.modal = true; this.t0 = performance.now();
    this.left = this.button(R.BtLeft, 86, 297, () => { this.page -= 1; });
    this.right = this.button(R.BtRight, 217, 297, () => { this.page += 1; });
    this.button(R.BtOK, 148, 297, () => this.mgr.close(this));
  }
  frames() { return allCanvases(this.R); }
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') this.mgr.close(this); }
  draw(ctx) {
    this.left.enabled = this.page !== 1;
    this.right.enabled = this.page * PER_PAGE + 2 <= this.list.length;
    super.draw(ctx);
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n);
    const crown = im(this.R.icon0);
    if (crown) ctx.drawImage(crown, 155, 43);
    const eff = Object.keys(this.R.IconEff || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b);
    if (eff.length) {
      const node = this.R.IconEff[eff[Math.floor((performance.now() - this.t0) / EFF_DELAY) % eff.length]], f = im(node), o = node?.origin || [0, 0];
      if (f) ctx.drawImage(f, 127 - o[0], 23 - o[1]);
    }
    if (this.list.length) this.entry(ctx, 1, 80, 1);
    for (let k = 0, y = ROW0; y < ROW0 + PER_PAGE * ROW_H; k++, y += ROW_H) {
      const rank = this.page * PER_PAGE - 4 + k;
      if (rank > this.list.length) break;
      this.entry(ctx, rank, y, rank > 3 ? 120 / 255 : 180 / 255);
    }
  }
  entry(ctx, rank, y, alpha) {
    const gd = this.list[rank - 1], o = { size: 12, color: '#000' };
    ctx.save(); ctx.globalAlpha = alpha;
    this.text(ctx, rank < 10 ? `0${rank}` : String(rank), 44, y, o);
    this.text(ctx, gd.name, 85, y, o);
    this.text(ctx, String(gd.gp), 275, y, { ...o, align: 'right' });
    ctx.restore();
    drawEmblem(ctx, this.g, gd.emblem, 64, y - 5);
  }
}
