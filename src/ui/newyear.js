import { TextField, uiText, wrapText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W } from '../view.js';

/** A TextField whose element is a textarea (several lines). */
function textArea(layer, w, h, max) {
  const f = new TextField(layer, 0, 0, w, h, { max, color: '#000' });
  const ta = document.createElement('textarea');
  ta.maxLength = max; ta.spellcheck = false;
  ta.style.cssText = f.el.style.cssText;
  Object.assign(ta.style, { resize: 'none', overflow: 'hidden', lineHeight: '15px' });
  f.el.replaceWith(ta); f.el = ta;
  return f;
}

/**
 * Sending a New Year card (UIWindow.img/NewYearsCard/backgrnd at (221, 206), 518 wide with the search list):
 * the recipient (12) at (46, 66), the message (120, three lines) at (13, 105); BtSearch at (295, 65) lists the
 * buddies and guild members whose name holds the recipient box's text on backgrnd2 at (353, 0) - five rows from
 * (368, 24) every 15px, the hovered one yellow; a click fills the name and closes the list. BtOk at (124, 164) sends
 * (an empty message asks first) and closes, BtCancel at (181, 164) closes. Enter and Esc do nothing.
 */
export class NewYearCardWin extends Win {
  constructor(mgr, slot, itemId) {
    const N = mgr.W.NewYearsCard;
    super(mgr, N.backgrnd, 221 + Math.round((UI_W - 800) / 2), 206);
    this.w = 518; this.h = 188;
    this.N = N; this.slot = slot; this.itemId = itemId; this.closeBtn.visible = false;
    this.list = null; this.first = 0; this.hoverRow = -1;
    this.button(N.BtSearch, 295, 65, () => this.search());
    this.button(N.BtOk, 124, 164, () => this.ok());
    this.button(N.BtCancel, 181, 164, () => this.mgr.close(this));
    this.to = new TextField(this.g.statusBar.layer, 0, 0, 243, 15, { max: 12, color: '#000' });
    this.msg = textArea(this.g.statusBar.layer, 333, 45, 120);
    this.fields = [this.to, this.msg];
    for (const f of this.fields) f.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && f === this.to) e.preventDefault(); });
  }
  frames() { return [...super.frames(), this.N.backgrnd2]; }
  onOpen() { setTimeout(() => this.to.focus(), 0); }
  onClose() { for (const f of this.fields) f.remove(); }
  contains(x, y) { return x >= this.x && y >= this.y && y < this.y + this.h && x < this.x + (this.list ? this.w : 358); }
  key() {}
  search() {
    const q = this.to.value, has = (n) => String(n || '').includes(q);
    const names = (this.g.buddies || []).filter((b) => !b.pending && has(b.name)).map((b) => b.name);
    for (const m of this.g.guild?.members || []) if (has(m.name)) names.push(m.name);
    this.list = names; this.first = 0;
  }
  rowAt(lx, ly) {
    if (!this.list || lx < 368 || lx >= 0x1e8) return -1;
    for (let i = 0; i < 5; i++) if (ly >= 25 + 15 * i && ly <= 38 + 15 * i && this.first + i < this.list.length) return this.first + i;
    return -1;
  }
  move(lx, ly) { this.hoverRow = this.rowAt(lx, ly); }
  down(lx, ly) {
    const i = this.rowAt(lx, ly);
    if (i >= 0) { this.to.value = this.list[i]; this.list = null; }
  }
  wheel(s) { if (this.list) this.first = Math.max(0, Math.min(Math.max(0, this.list.length - 5), this.first + s)); }
  async ok() {
    const to = this.to.value, text = this.msg.value;
    this.mgr.close(this);
    if (!text && !(await this.mgr.confirm('Are you sure to send an\r\nempty new year card ?'))) return;
    this.g.net?.sendNewYearCard(this.slot, this.itemId, to, text);
  }
  body(ctx) {
    if (!this.list) return;
    const bg = this.mgr.image(this.N.backgrnd2);
    if (bg) ctx.drawImage(bg, 353, 0);
    for (let i = 0; i < 5 && this.first + i < this.list.length; i++) {
      const n = this.first + i;
      uiText(ctx, this.list[n], 368, 24 + 15 * i, { color: n === this.hoverRow ? '#ffff20' : '#000', size: 12 });
    }
  }
  draw(ctx) {
    super.draw(ctx);
    const k = this.g.canvas.clientWidth / UI_W;
    this.to.rect.x = this.x + 46; this.to.rect.y = this.y + 66; this.to.layout({ left: 0, top: 0 }, k);
    this.msg.rect.x = this.x + 13; this.msg.rect.y = this.y + 105; this.msg.layout({ left: 0, top: 0 }, k);
  }
}

/**
 * A New Year card item (430xxxx) read (NewYearsCard/backgrnd3 at (286, 168)): "To. <receiver>" at (28, 33), the
 * message from (61, 61) every 13px while above y 139, "From. <sender>" at (110, 142); BtClose at (91, 231), Esc closes.
 */
export class NewYearCardViewWin extends Win {
  constructor(mgr, card) {
    const N = mgr.W.NewYearsCard;
    super(mgr, N.backgrnd3, 286 + Math.round((UI_W - 800) / 2), 168);
    this.closeBtn.visible = false;
    this.card = card || { sender: 'SYSTEM', message: 'Something went wrong !!!!!', receiver: 'YOU' };
    this.button(N.BtClose, 91, 231, () => mgr.close(this));
  }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  body(ctx) {
    const c = this.card;
    uiText(ctx, `To. ${c.receiver}`, 28, 33, { color: '#000', size: 12 });
    ctx.save(); ctx.font = '12px Arial';
    const lines = wrapText(ctx, String(c.message || ''), 150, 12);
    ctx.restore();
    lines.forEach((l, i) => { const y = 61 + 13 * i; if (y < 139) uiText(ctx, l, 61, y, { color: '#000', size: 12 }); });
    uiText(ctx, `From. ${c.sender}`, 110, 142, { color: '#000', size: 12 });
  }
}
