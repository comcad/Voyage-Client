import { invType } from '../data.js';
import { sfx } from '../audio.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win, drawTabStrip } from './windows.js';

/**
 * Duey's Maple Home Delivery (UIWindow.img/Delivery, backgrnd 290x350), opened by talking to Duey. Measured:
 *   title y 7-15, tab strip y 21-43 (Tab 0 receive, 1 send), the blue header band y 58-82 (icon0 / icon1, and on
 *   the send side icon2 "delivery fee 5000 mesos"), the grey panel y 104-202 with Duey (npc0) on the left and his
 *   speech bubble x 86-269 y 107-191 (say1 / say0), the content y 204-307, the button band y 312-346.
 *   Receive: the parcels in rows (line0 header 256x21, line1 rows 256x18, line2 the closing rule) from y 206;
 *     the chosen one's receiveTB (290x108) takes the panel: sender x 121 y 8, mesos y 27, its note x 121-282
 *     y 55-95, its item in the box at (44, 59). BtReceive takes it, BtDel throws it away.
 *   Send: sendTB (275x77) at (8, 214): the receiver x 113 y 2 (160 wide), the mesos x 130 y 21, the item box at
 *     (115, 42) - drag an item from your inventory onto it; the fee table (tax, 290x200) hangs under the window.
 */
const RESULTS = {
  0x0A: 'You do not have enough mesos.', 0x0B: 'The parcel could not be sent.', 0x0C: 'Please check the receiver\'s name.',
  0x0D: 'You cannot send a parcel to a character on your own account.', 0x0E: 'The receiver\'s delivery storage is full.',
  0x0F: 'That character cannot receive parcels.', 0x10: 'The receiver already has one of that one-of-a-kind item.',
  0x11: 'The receiver cannot hold that many mesos.', 0x12: 'Your parcel has been sent.', 0x13: 'The parcel could not be received.',
  0x15: 'Please make room in your inventory first.', 0x16: 'You already have one of that one-of-a-kind item.',
};
export const dueyResult = (code) => RESULTS[code];
const ROW_Y = 227, ROW_H = 18, ROWS = 4, TB_Y = 214;

export class DueyWin extends Win {
  constructor(mgr, list) {
    const D = mgr.W.Delivery;
    super(mgr, D.backgrnd, 250, 60);
    this.D = D; this.list = list; this.tab = 0; this.sel = -1; this.first = 0; this.item = null;
    const B = mgr.B, bw = (n) => n?.normal?.[0]?._w || 40;
    this.recvBtn = this.button(B.BtReceive, 290 - 14 - bw(B.BtDel) - 4 - bw(B.BtReceive), 320, () => this.take());
    this.delBtn = this.button(B.BtDel, 290 - 14 - bw(B.BtDel), 320, () => this.remove());
    this.sendBtn = this.button(B.BtSend, 290 - 14 - bw(B.BtSend), 320, () => this.send());
    const field = (x, y, w, max, numeric) => {
      const f = new TextField(mgr.game.statusBar.layer, x, y, w, 14, { max, color: '#000' });
      f.rect.x0 = x; f.rect.y0 = y;
      if (numeric) f.el.addEventListener('input', () => { f.value = f.value.replace(/\D/g, ''); });
      f.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.send(); });
      f.show(false);
      return f;
    };
    this.to = field(8 + 113, TB_Y + 2, 160, 13);
    this.mesos = field(8 + 130, TB_Y + 21, 143, 10, true);
  }
  frames() {
    const D = this.D;
    return [...super.frames(), D.sendTB, D.receiveTB, D.empty, D.say0, D.say1, D.line0, D.line1, D.line2, D.icon0, D.icon1, D.icon2, D.npc0, D.tax,
      ...Object.values(D.Tab?.enabled || {}), ...Object.values(D.Tab?.disabled || {}), this.mgr.B.Tab2 && Object.values(this.mgr.B.Tab2)].flat().filter(Boolean);
  }
  get h() { return this.tab === 1 ? 550 : 350; }
  set h(v) { /* the height follows the tab */ }

  // ---------------------------------------------------------------- server events
  setList(list) { this.list = list; this.sel = Math.min(this.sel, list.length - 1); }
  gone(id) { this.list = this.list.filter((p) => p.id !== id); this.sel = -1; }

  // ---------------------------------------------------------------- your actions
  take() {
    const p = this.list[this.sel];
    if (!p) { this.mgr.notice('Select a parcel first.'); return; }
    this.g.net?.dueyTake(p.id);
  }
  async remove() {
    const p = this.list[this.sel];
    if (!p) { this.mgr.notice('Select a parcel first.'); return; }
    if (await this.mgr.confirm(`Throw away the parcel from ${p.sender}?`)) this.g.net?.dueyDelete(p.id);
  }
  async send() {
    const to = this.to.value.trim(), mesos = Number(this.mesos.value) || 0;
    if (!to) { this.mgr.notice('Enter the name of the receiver.'); this.to.focus(); return; }
    if (!mesos && !this.item) { this.mgr.notice('Put an item in the box or enter mesos to send.'); return; }
    let qty = 0;
    if (this.item) {
      const it = this.g.inventory?.[this.item.tab]?.[this.item.slot];
      if (!it) { this.item = null; return; }
      qty = it.quantity || 1;
      if (qty > 1 && invType(it.id) !== 1) {
        qty = await this.mgr.askNumber(`How many #t${it.id}# will you send?\n(1 ~ ${qty})`, qty, 1, qty);
        if (!qty) return;
      }
    }
    const fee = 5000 + feeFor(mesos);
    if (!(await this.mgr.confirm(`Send this parcel to ${to}?\nThe delivery fee is ${fee.toLocaleString('en-US')} mesos.`))) return;
    this.g.net?.dueySend({ tab: this.item ? this.item.tab : 0, slot: this.item ? this.item.slot : 0, qty, mesos, to });
    this.item = null; this.mesos.value = '';
  }
  close() { this.g.net?.dueyClose(); this.mgr.close(this); }
  onClose() { this.to.remove(); this.mesos.remove(); if (this.g.dueyWin === this) this.g.dueyWin = null; }
  key(e) { if (e.key === 'Escape') this.close(); }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    const send = this.tab === 1;
    this.recvBtn.visible = this.delBtn.visible = !send; this.sendBtn.visible = send;
    this.recvBtn.enabled = this.delBtn.enabled = this.sel >= 0;
    super.draw(ctx);
    const scale = this.g.canvas.clientWidth / 800;
    for (const f of [this.to, this.mesos]) { f.show(send); f.rect.x = this.x + f.rect.x0; f.rect.y = this.y + f.rect.y0; f.layout({ left: 0, top: 0 }, scale); }
  }
  body(ctx) {
    const m = this.mgr, D = this.D, im = (n) => m.image(n), put = (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x, y); };
    const send = this.tab === 1;
    this.tabRects = drawTabStrip(ctx, m, D.Tab, 2, this.tab, 150, 22);
    put(send ? D.icon1 : D.icon0, 12, 63);
    if (send) put(D.icon2, 290 - 14 - 70, 61);
    // the panel: Duey and what he says - or, on the receive side, the parcel you picked
    const p = !send && this.list[this.sel];
    if (p) {
      put(D.receiveTB, 0, 100);
      this.text(ctx, p.sender, 124, 110);
      this.text(ctx, (p.mesos || 0).toLocaleString('en-US'), 124, 129);
      ctx.save(); ctx.font = '11px Arial, sans-serif';
      wrapText(ctx, p.message || '', 154, 11).slice(0, 3).forEach((l, i) => this.text(ctx, l, 124, 157 + i * 13));
      ctx.restore();
      if (p.item) m.drawIcon(ctx, m.icon(p.item.id), 44, 159);
    } else {
      const d = im(D.npc0);
      if (d) ctx.drawImage(d, 46 - (D.npc0.origin?.[0] || 18), 190 - (D.npc0.origin?.[1] || 73));
      put(send ? D.say0 : D.say1, send ? 88 : 96, send ? 109 : 116);
    }
    if (send) {
      put(D.sendTB, 8, TB_Y);
      const it = this.item && this.g.inventory?.[this.item.tab]?.[this.item.slot];
      if (it) { m.drawIcon(ctx, m.icon(it.id), 8 + 115, TB_Y + 42); if ((it.quantity || 1) > 1) m.count?.(ctx, it.quantity, 8 + 115, TB_Y + 63); }
      uiText(ctx, it ? m.itemName(it.id) || '' : 'Drag an item into the box', 8 + 155, TB_Y + 52, { color: '#555', size: 11 });
      put(D.tax, 0, 350);
      return;
    }
    // the parcels
    put(D.line0, 17, 206);              // its own NAME / CONTENTS / VALID UNTIL labels
    for (let i = 0; i < ROWS; i++) {
      const idx = this.first + i, q = this.list[idx], y = ROW_Y + i * ROW_H;
      put(D.line1, 17, y);
      if (!q) continue;
      if (idx === this.sel) { ctx.fillStyle = 'rgba(59, 93, 150, 0.85)'; ctx.fillRect(18, y + 1, 254, ROW_H - 2); }
      const color = idx === this.sel ? '#fff' : '#000';
      this.text(ctx, q.sender, 22, y + 3, { color });
      const what = [q.item && (m.itemName(q.item.id) || 'item'), q.mesos ? `${q.mesos.toLocaleString('en-US')} mesos` : ''].filter(Boolean).join(' + ');
      ctx.save(); ctx.beginPath(); ctx.rect(98, y, 92, ROW_H); ctx.clip();
      this.text(ctx, what || '-', 100, y + 3, { color });
      ctx.restore();
      // the server sends when it expires (a FILETIME), 30 days after it was sent
      const until = new Date(Number(q.sent) / 10000 - 11644473600000);
      if (!Number.isNaN(until.getTime())) this.text(ctx, `${until.getMonth() + 1}/${until.getDate()}`, 230, y + 3, { color, align: 'center' });
    }
    put(D.line2, 17, ROW_Y + ROWS * ROW_H);
    if (!this.list.length) put(D.empty, 71, ROW_Y + 20);
    if (this.list.length > ROWS) uiText(ctx, `${this.first + 1}-${Math.min(this.list.length, this.first + ROWS)} of ${this.list.length}`, 270, 302, { color: '#777', size: 10, align: 'right' });
  }
  down(lx, ly) {
    const t = (this.tabRects || []).findIndex(([x, w, y]) => lx >= x && lx < x + w && ly >= y && ly < y + 19);
    if (t >= 0) { if (t !== this.tab) { this.tab = t; this.sel = -1; sfx.play('UI/Tab'); } return; }
    if (this.tab !== 0 || lx < 17 || lx > 273 || ly < ROW_Y || ly >= ROW_Y + ROWS * ROW_H) return;
    const idx = this.first + Math.floor((ly - ROW_Y) / ROW_H);
    if (idx < this.list.length) { this.sel = idx; sfx.play('UI/BtMouseClick'); }
  }
  dblclick(lx, ly) { this.down(lx, ly); if (this.tab === 0 && this.sel >= 0) this.take(); }
  wheel(dy) { if (this.tab === 0) this.first = Math.max(0, Math.min(this.list.length - ROWS, this.first + Math.sign(dy))); }
  /** An item dragged from your inventory onto the send box. */
  drop(lx, ly, c) {
    if (this.tab !== 1 || c.kind !== 'item' || typeof c.tab !== 'number') return;
    if (lx >= 8 + 105 && lx < 8 + 160 && ly >= TB_Y + 35 && ly < TB_Y + 80) { this.item = { tab: c.tab, slot: c.slot }; sfx.play('UI/DragEnd'); }
  }
}

/** The transaction fee on the mesos sent (Cosmic's Trade.getFee), on top of the 5,000 meso shipping fee. */
function feeFor(m) {
  const perMille = m >= 100000000 ? 60 : m >= 25000000 ? 50 : m >= 10000000 ? 40 : m >= 5000000 ? 30 : m >= 1000000 ? 18 : m >= 100000 ? 8 : 0;
  return Math.floor((m * perMille) / 1000);
}
