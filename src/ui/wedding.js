import { uiText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W, UI_H } from '../view.js';

/**
 * "Waiting for her response..." after a proposal: UI/Basic.img/Notice3 (t on top, c tiled every 20px from y 21 while
 * y < h - 55, s at the bottom), 266 wide at x 267 and centred down; the text centred on x 132 from y 37; BtCancel2
 * at (205, h - 30). Cancel or Esc withdraws the proposal; Enter, or any MARRIAGE_RESULT, just closes it.
 */
export class ProposalWaitWin extends Win {
  constructor(mgr) {
    const N = mgr.B.Notice3;
    super(mgr, N.t, 267, 0);
    this.N = N; this.w = 266; this.h = 116;
    this.x = Math.round((UI_W - this.w) / 2); this.y = Math.round((UI_H - this.h) / 2);
    this.closeBtn.visible = false;
    this.button(mgr.B.BtCancel2, 205, this.h - 30, () => this.cancel());
  }
  frames() { return [...super.frames(), this.N.c, this.N.s]; }
  cancel() { this.g.net?.withdrawProposal(); this.mgr.close(this); }
  key(e) { if (e.key === 'Escape') this.cancel(); else if (e.key === 'Enter') this.mgr.close(this); }
  draw(ctx) {
    const im = (n) => this.mgr.image(n);
    ctx.save(); ctx.translate(this.x, this.y);
    const t = im(this.N.t), c = im(this.N.c), s = im(this.N.s);
    if (t) ctx.drawImage(t, 0, 0);
    if (c) for (let y = 21; y < this.h - 55; y += 20) ctx.drawImage(c, 0, y);
    if (s) ctx.drawImage(s, 0, this.h - 55);
    ctx.save(); ctx.font = '12px Arial'; const w = ctx.measureText(WAIT).width; ctx.restore();
    uiText(ctx, WAIT, Math.round((234 - w) / 2) + 15, 37, { color: '#000', size: 12 });
    for (const b of this.buttons) b.draw(ctx, this.mgr.assets);
    ctx.restore();
  }
}
const WAIT = 'Waiting for her response...';

/**
 * A wedding invitation (UIWindow.img/Wedding/Invitation/Cathedral for type 2, Vegas otherwise; 234x250, centred):
 * the groom's name at (50, 105) and the bride's at (131, 105), Arial 12 black; BtOK at (87, 206), Enter or Esc close it.
 */
export class InvitationWin extends Win {
  constructor(mgr, groom, bride, type) {
    const I = mgr.W.Wedding.Invitation, bg = type === 2 ? I.Cathedral : I.Vegas;
    super(mgr, bg, Math.round((UI_W - (bg?._w || 234)) / 2), Math.round((UI_H - (bg?._h || 250)) / 2));
    this.modal = true; this.closeBtn.visible = false;
    this.groom = groom; this.bride = bride;
    this.button(I.BtOK, 87, 206, () => mgr.close(this));
  }
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') this.mgr.close(this); }
  body(ctx) {
    uiText(ctx, this.groom, 50, 105, { color: '#000', size: 12 });
    uiText(ctx, this.bride, 131, 105, { color: '#000', size: 12 });
  }
}
