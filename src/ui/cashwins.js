import { TextField, uiText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W, UI_H } from '../view.js';

const centred = (bg) => [Math.round((UI_W - (bg?._w || 0)) / 2), Math.round((UI_H - (bg?._h || 0)) / 2)];

/** A window answered once (done(value)) and closed; its text boxes follow it on screen. */
class StepWin extends Win {
  constructor(mgr, bg, done) {
    super(mgr, bg, ...centred(bg));
    this.modal = true; this.transient = true; this.closeBtn.visible = false;
    this.done = done; this.fields = []; this.at = [];
  }
  field(x, y, w, h, max) {
    const f = new TextField(this.g.statusBar.layer, 0, 0, w, h, { max, color: '#000' });
    f.el.addEventListener('keydown', (e) => { e.stopPropagation(); this.key(e); });
    this.fields.push(f); this.at.push([x, y]);
    return f;
  }
  onOpen() { setTimeout(() => this.fields[0]?.focus(), 0); }
  finish(v) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done?.(v); }
  onClose() { for (const f of this.fields) f.remove(); if (!this.answered) { this.answered = true; this.done?.(null); } }
  key(e) { if (e.key === 'Escape') this.finish(null); else if (e.key === 'Enter') this.ok(); }
  ok() {}
  draw(ctx) {
    super.draw(ctx);
    const k = this.g.canvas.clientWidth / UI_W;
    this.fields.forEach((f, i) => { f.rect.x = this.x + this.at[i][0]; f.rect.y = this.y + this.at[i][1]; f.layout({ left: 0, top: 0 }, k); });
  }
}

/**
 * A kite's message (MultiLine/backgrnd2, centred): String/Cash.img/<id>/msgIn at (40, 19), three 60-character lines
 * at (28, 45), (28, 70), (28, 94), BtOK2 at (330, h - 30) and BtCancel2 at (372, h - 30). OK answers the lines
 * joined with "\n" (both always added).
 */
export class KiteInputWin extends StepWin {
  constructor(mgr, prompt, done) {
    const bg = mgr.W.MultiLine.backgrnd2;
    super(mgr, bg, done);
    this.prompt = prompt || '';
    this.lines = [45, 70, 94].map((y) => this.field(28, y, 366, 17, 60));
    this.button(mgr.B.BtOK2, 330, this.h - 30, () => this.ok());
    this.button(mgr.B.BtCancel2, 372, this.h - 30, () => this.finish(null));
  }
  ok() { this.finish(this.lines.map((f) => f.value).join('\n')); }
  body(ctx) { this.text(ctx, this.prompt, 40, 19, { size: 12 }); }
}

/**
 * A kite's message on a double-click (MultiLine/backgrnd, centred, MultiLine/BtClose at (385, 10)): the owner at
 * (30, 13) in orange, the item's msg after it in khaki, and the message's first, middle and last lines in white at
 * (22, 47), (22, 67), (22, 87).
 */
export class KiteMessageWin extends Win {
  constructor(mgr, kite, msg) {
    const bg = mgr.W.MultiLine.backgrnd;
    super(mgr, bg, ...centred(bg));
    this.transient = true; this.closeBtn.visible = false;
    this.kite = kite; this.msg = msg || '';
    this.button(mgr.W.MultiLine.BtClose, 385, 10, () => mgr.close(this));
    const parts = String(kite.message || '').split('\n');
    this.rows = parts.length < 2 ? [parts[0] || '', '', ''] : [parts[0], parts.length > 2 ? parts[1] : '', parts[parts.length - 1]];
  }
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') this.mgr.close(this); }
  body(ctx) {
    ctx.save(); ctx.font = 'bold 12px Arial'; const w = ctx.measureText(this.kite.owner || '').width; ctx.restore();
    uiText(ctx, this.kite.owner || '', 30, 13, { color: '#ff9900', size: 12, bold: true });
    uiText(ctx, this.msg, w + 35, 13, { color: '#cccc99', size: 12, bold: true });
    this.rows.forEach((t, i) => uiText(ctx, t, 22, 47 + i * 20, { color: '#fff', size: 12 }));
  }
}

/**
 * The Memo send window (Memo/backgrnd3, centred): To (12 characters) at (38, 67), the note (200) at (13, 114),
 * BtOK2 at (193, 141), BtCancel2 at (242, 141) and the close box at (277, 6). OK trims both and checks them in
 * order, a notice keeping the window open: a name of 4-12 characters, not yours, no curses, not empty, 200 at most.
 */
export class MemoSendWin extends StepWin {
  constructor(mgr, to, done) {
    super(mgr, mgr.W.Memo.backgrnd3, done);
    this.closeBtn.visible = true; this.closeBtn.x = 277; this.closePinned = true;
    this.to = this.field(38, 67, 150, 13, 12);
    this.note = this.field(13, 114, 271, 13, 200);
    if (to) this.to.value = to;
    this.button(mgr.B.BtOK2, 193, 141, () => this.ok());
    this.button(mgr.B.BtCancel2, 242, 141, () => this.finish(null));
  }
  onOpen() { setTimeout(() => (this.to.value ? this.note : this.to).focus(), 0); }
  async ok() {
    const to = this.to.value.trim(), text = this.note.value.trim(), say = (t) => this.mgr.notice(t);
    if (to.length < 4 || to.length > 12) { say('Please enter the name\r\n of the receiving character.'); return; }
    if (to.toLowerCase() === String(this.g.player?.name || '').toLowerCase()) { say("You can't send the note to yourself."); return; }
    if (await this.g.cursed(text)) { say('Cursing is not allowed.'); return; }
    if (!text) { say('Please enter the content.'); return; }
    if (text.length > 200) { say('The notes can be sent in 100 characters.'); return; }
    this.finish({ to, text });
  }
}

/**
 * CancelRequests: mode 0 AskContinueCancel, 1 CancelNameChange, 2 CancelCharacterTransfer, centred, BtYes at
 * (20, y) and BtNo at (148, y) with y 120 for mode 0, 101 otherwise. Esc is No.
 */
const CANCEL_KINDS = ['AskContinueCancel', 'CancelNameChange', 'CancelCharacterTransfer'];
export class CancelRequestWin extends StepWin {
  constructor(mgr, mode, done) {
    const C = mgr.W.CancelRequests[CANCEL_KINDS[mode]];
    super(mgr, C.backgrnd, done);
    const y = mode === 0 ? 120 : 101;
    this.button(C.BtYes, 20, y, () => this.finish(true));
    this.button(C.BtNo, 148, y, () => this.finish(false));
  }
  key(e) { if (e.key === 'Escape') this.finish(false); }
}
/** A cancel request's answer: CancelRequests/<kind>/suc or fail, centred, BtOK2 at (110, 87) (suc) or (110, 103) (fail). */
export class CancelResultWin extends StepWin {
  constructor(mgr, kind, ok, done) {
    const C = mgr.W.CancelRequests[CANCEL_KINDS[kind]];
    super(mgr, ok ? C.suc : C.fail, done);
    this.button(mgr.B.BtOK2, 110, ok ? 87 : 103, () => this.finish(true));
  }
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') this.finish(true); }
}
