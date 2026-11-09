import { uiText, TextField } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { UI_W, UI_H } from '../view.js';

/**
 * Report (UIWindow.img/Claim), as the client runs it: first the notice (268x429, centred), whose BtCClaim (140, 197)
 * picks a conversation report, BtPClaim (140, 269) an illegal-program one and BtCancel (200, 402) neither. Then the
 * form (backgrnd 268x345, centred): the character in a drop-down at (107, 158) and the reason in one at (107, 178)
 * (155x17 each, box1 behind them), the description in four 145x15 lines from (110, 200), 15px apart, and BtClaim (40,
 * 320) / BtCancel (180, 320). A conversation report's reasons are Curse/Inappropriate Content, Advertising, Fraud,
 * Cash Trade, Impersonating GM and Exposing Personal Info (sent as 1, 2, 3, 5, 7, 8); a program report's only
 * reason is "Report Use of Illegal Programs" (9).
 */
const COMBO_W = 155, COMBO_H = 17;
const CHAT_REASONS = [['Curse/Inappropriate Content', 1], ['Advertising', 2], ['Fraud', 3], ['Cash Trade', 5], ['Impersonating GM', 7], ['Exposing Personal Info', 8]];

/** The notice: resolves 'chat', 'program' or null. */
export class ClaimNotice extends Win {
  constructor(mgr, done) {
    const C = mgr.W.Claim;
    super(mgr, C.notice, (UI_W - 268) >> 1, (UI_H - 429) >> 1);
    this.buttons = [];
    this.modal = true; this.done = done;
    this.button(C.BtCClaim, 140, 197, () => this.finish('chat'));
    this.button(C.BtPClaim, 140, 269, () => this.finish('program'));
    this.button(C.BtCancel, 200, 402, () => this.finish(null));
  }
  finish(v) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(v); }
  key(e) { if (e.key === 'Escape') this.finish(null); }
}

/** A drop-down on the form: the box, and its list under it while open. */
class Drop {
  constructor(win, x, y, items) { Object.assign(this, { win, x, y, items, sel: 0, open: false }); }
  hit(lx, ly) { return lx >= this.x && lx < this.x + COMBO_W && ly >= this.y && ly < this.y + COMBO_H; }
  rowAt(lx, ly) {
    if (!this.open || lx < this.x || lx >= this.x + COMBO_W) return -1;
    const i = Math.floor((ly - this.y - COMBO_H) / COMBO_H);
    return i >= 0 && i < this.items.length ? i : -1;
  }
  draw(ctx) {
    const box = this.win.mgr.image(this.win.C.box1);
    if (box) ctx.drawImage(box, this.x - 1, this.y - 1);
    uiText(ctx, this.items[this.sel] ?? '', this.x + 4, this.y + 3, { color: '#000', size: 12 });
  }
  drawList(ctx) {
    if (!this.open) return;
    const h = this.items.length * COMBO_H;
    ctx.fillStyle = '#eeeeee'; ctx.fillRect(this.x, this.y + COMBO_H, COMBO_W, h);
    ctx.strokeStyle = '#a5a198'; ctx.strokeRect(this.x + 0.5, this.y + COMBO_H + 0.5, COMBO_W - 1, h - 1);
    this.items.forEach((t, i) => {
      if (i === this.sel) { ctx.fillStyle = '#999999'; ctx.fillRect(this.x + 1, this.y + COMBO_H + i * COMBO_H + 1, COMBO_W - 2, COMBO_H - 1); }
      uiText(ctx, t, this.x + 4, this.y + COMBO_H + i * COMBO_H + 3, { color: '#000', size: 12 });
    });
  }
}

/** The form: resolves { name, reason, text } or null. */
export class ClaimForm extends Win {
  constructor(mgr, names, chat, done) {
    const C = mgr.W.Claim;
    super(mgr, C.backgrnd, (UI_W - 268) >> 1, (UI_H - 345) >> 1);
    this.buttons = [];
    this.C = C; this.modal = true; this.done = done; this.chat = chat;
    this.names = new Drop(this, 107, 158, ['Please select.', ...names]);
    this.reasons = new Drop(this, 107, 178, chat ? CHAT_REASONS.map((r) => r[0]) : ['Report Use of Illegal Programs']);
    this.lines = [0, 1, 2, 3].map((i) => {
      const f = new TextField(mgr.game.statusBar.layer, 110, 200 + i * 15, 145, 15, { max: 24, color: '#000' });
      f.rect.x0 = 110; f.rect.y0 = 200 + i * 15;
      f.el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); this.lines[i + 1]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.lines[i - 1]?.focus(); }
        else if (e.key === 'Escape') this.finish(false);
      });
      return f;
    });
    this.button(C.BtClaim, 40, 320, () => this.finish(true));
    this.button(C.BtCancel, 180, 320, () => this.finish(false));
  }
  frames() { return [...super.frames(), ...allCanvases(this.C.box1)]; }
  async finish(ok) {
    if (this.answered) return;
    if (ok) {
      if (this.names.sel < 1) { await this.mgr.notice("Please select the character you'd like to report."); return; }
      const text = this.lines.map((f) => f.value).join('');
      if (!text) { await this.mgr.notice('Please enter the reason for reporting.'); return; }
      this.result = { name: this.names.items[this.names.sel], reason: this.chat ? CHAT_REASONS[this.reasons.sel][1] : 9, text };
    }
    this.answered = true;
    for (const f of this.lines) f.remove();
    this.mgr.close(this);
    this.done(ok ? this.result : null);
  }
  onClose() { for (const f of this.lines) f.remove(); }
  key(e) { if (e.key === 'Escape') this.finish(false); }
  down(lx, ly) {
    for (const d of [this.names, this.reasons]) {
      if (d.open) { const i = d.rowAt(lx, ly); d.open = false; if (i >= 0) d.sel = i; return; }
    }
    for (const d of [this.names, this.reasons]) if (d.hit(lx, ly)) { d.open = true; return; }
  }
  draw(ctx) {
    super.draw(ctx);
    const scale = this.g.canvas.clientWidth / UI_W;
    for (const f of this.lines) { f.rect.x = this.x + f.rect.x0; f.rect.y = this.y + f.rect.y0; f.layout({ left: 0, top: 0 }, scale); }
    ctx.save(); ctx.translate(this.x, this.y);
    this.reasons.draw(ctx); this.names.draw(ctx);
    this.reasons.drawList(ctx); this.names.drawList(ctx);
    ctx.restore();
  }
}
