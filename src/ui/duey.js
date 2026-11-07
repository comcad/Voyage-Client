import { invType, itemInfo } from '../data.js';
import { isRechargeable } from '../net/proto.js';
import { TextField, uiText } from './wzui.js';
import { Win, drawTabStrip } from './windows.js';
import { UI_W, UI_H } from '../view.js';

/**
 * Duey (UIWindow.img/Delivery/backgrnd 290x350; the window is 290x541 at (255, 25) so receiveTB or the fee table can
 * hang under the frame). Mode 0 (op 8 from the NPC) has Package Storage / Send Package / Quick Delivery tabs and opens
 * on Storage, or on Send when nothing waits; mode 1 (op 0x1A, the Quick Delivery Ticket) has only Quick Delivery;
 * mode 2 (op 8 with its first byte set) only Storage. BtClose (268, 8) sends 7 and closes.
 *  Storage: three rows from y 229 every 18px (sender 13, the quick mark 113, status 188), VScr4 at (267, 210) 85
 *    long; the picked parcel's receiveTB at (0, 349); a quick parcel's message in the speech bubble. BtReceive (53,
 *    321) claims, BtDel (170, 321) deletes.
 *  Send / Quick: sendTB at (8, 211), the recipient (123, 213, 12 letters), the mesos through BtCoin (121, 232) or a
 *    click on their field, an item dropped on the box (122..154 x 253..284); BtSend (200, 321); BtMax2 / BtMin2 (12,
 *    323) show or hide the fee table. Quick adds a 100-letter message at (95, 115) and uses up a Quick Delivery Coupon.
 * While a request is out everything is disabled.
 */
const RESULTS = {
  0x0A: 'You do not have enough mesos.', 0x0B: 'You have made an incorrect request.', 0x0C: "Please double-check the receiver's name.",
  0x0D: 'You may not send the package to a character \r\nunder the same account.', 0x0E: "The receiver's package storage is full.",
  0x0F: 'The character is unable to receive packages.',
  0x10: 'Unable to send the one-of-a-kind item\r\n due to the recipient already possessing one\r\n at the Quick Delivery Inbox.',
  0x11: 'Players that are Level 15 and below \r\nmay only trade 1 million mesos per day. \r\nYou have reached the limit today,\r\nplease try again tomorrow.',
  0x12: 'The package has been successfully sent.', 0x13: 'An unknown error has occurred.', 0x1C: 'An unknown error has occurred.',
  0x15: 'The inventory does not have enough free slots available.\r\nPlease double check and try again.',
  0x16: 'Unable to retrieve mesos & items \r\ndue to the item being only one of a kind.',
};
export const dueyResult = (code) => RESULTS[code];
const FT_EPOCH = 116444736000000000n, DAY = 864000000000n;
const MESO_COLORS = ['#007af4', '#00bdc4', '#629a00', '#ff5400', '#d022c2', '#a6006e'];
const mesoColor = (m) => MESO_COLORS[m < 1e5 ? 0 : m < 1e6 ? 1 : m < 1e7 ? 2 : m < 1e8 ? 3 : m < 1e9 ? 4 : 5];
const LEVEL_LIMIT = 'Players that are Level 15 and below \r\nmay only trade 1 million mesos per day. \r\nYou have reached the limit today,\r\nplease try again tomorrow.';

/** Days until a parcel's time (unsigned, as the client divides it: a time already past gives a huge number). */
function daysLeft(ft) {
  const now = BigInt(Date.now()) * 10000n + FT_EPOCH;
  return Number(BigInt.asIntN(32, BigInt.asUintN(64, BigInt(ft) - now) / DAY));
}
/** The transaction fee on mesos sent: 0.8% from 100k, 1.8% from 1M, 3% from 5M, 4% from 10M, 5% from 25M, 6% from 100M. */
export function feeFor(m) {
  const perMille = m >= 100000000 ? 60 : m >= 25000000 ? 50 : m >= 10000000 ? 40 : m >= 5000000 ? 30 : m >= 1000000 ? 18 : m >= 100000 ? 8 : 0;
  return Math.floor((m * perMille) / 1000);
}
/** The most mesos the dialog takes from what you hold (an older fee table's inverse), at most 100,000,000. */
function mesoCap(base) {
  let max = base;
  for (const [r, lo, hi] of [[1 / 1.04, 1e7, Infinity], [1 / 1.03, 5e6, 1e7], [1 / 1.02, 1e6, 5e6], [1 / 1.01, 1e5, 1e6], [1 / 1.005, 5e4, 1e5]]) {
    const v = base * r;
    if (v >= lo && v < hi) { max = Math.trunc(v); break; }
  }
  return Math.min(max, 100000000);
}

export class DueyWin extends Win {
  constructor(mgr, list, mode = 0, expired = []) {
    const D = mgr.W.Delivery, B = mgr.B;
    super(mgr, D.backgrnd, Math.round((UI_W - 290) / 2), 25 + Math.round((UI_H - 600) / 2));
    this.D = D; this.mode = mode; this.list = list.slice(0, 10); this.sel = -1; this.first = 0; this.busy = false;
    this.w = 290; this.closeBtn.visible = false;
    this.tabs = mode === 1 ? [2] : mode === 2 ? [0] : [0, 1, 2];
    this.tab = mode === 1 ? 2 : mode === 2 || this.list.length ? 0 : 1;
    this.forms = { 1: this.blank(), 2: { ...this.blank(), ticket: 0, typed: false } };
    this.close2 = this.button(B.BtClose, 268, 8, () => this.close());
    this.recvBtn = this.button(B.BtReceive, 53, 321, () => this.take());
    this.delBtn = this.button(B.BtDel, 170, 321, () => this.remove());
    this.sendBtn = this.button(B.BtSend, 200, 321, () => this.send());
    this.coinBtn = this.button(B.BtCoin, 121, 232, () => this.askMesos());
    this.maxBtn = this.button(B.BtMax2, 12, 323, () => { this.form.table = !this.form.table; });
    this.minBtn = this.button(B.BtMin2, 12, 323, () => { this.form.table = !this.form.table; });
    this.to = new TextField(mgr.game.statusBar.layer, 0, 0, 154, 14, { max: 12, color: '#000' });
    this.msg = new TextField(mgr.game.statusBar.layer, 0, 0, 165, 68, { max: 100, color: '#000' });
    const ta = document.createElement('textarea');
    ta.maxLength = 100; ta.spellcheck = false; ta.style.cssText = this.msg.el.style.cssText;
    Object.assign(ta.style, { resize: 'none', overflow: 'hidden', lineHeight: '14px' });
    this.msg.el.replaceWith(ta); this.msg.el = ta;
    ta.addEventListener('focus', () => { if (this.tab === 2) this.forms[2].typed = true; });
    for (const f of [this.to, this.msg]) f.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (f === this.to) this.key(e); });
    this.expired = expired;
  }
  blank() { return { item: null, qty: 0, mesos: 0, text: '', color: MESO_COLORS[0], table: true }; }
  get form() { return this.forms[this.tab]; }
  get h() { return 541; }
  set h(v) { /* fixed */ }
  frames() {
    const D = this.D, B = this.mgr.B;
    return [...super.frames(), D.sendTB, D.receiveTB, D.empty, D.say0, D.say1, D.line0, D.line1, D.line2, D.icon0, D.icon1, D.icon2, D.icon3,
      D.npc0, D.npc1, D.npc2, D.tax, D.tax1, ...Object.values(D.Tab?.enabled || {}), ...Object.values(D.Tab?.disabled || {}), B.Tab2 && Object.values(B.Tab2),
      B.VScr4 && [Object.values(B.VScr4.enabled || {}), Object.values(B.VScr4.disabled || {})]].flat(3).filter((n) => n?._canvas);
  }
  onOpen() {
    for (const p of this.expired) {
      let t = `The package sent by [${p.sender}]\r\nhas been expired.\r\n`;
      if (p.mesos) t += `\r\nmeso : ${p.mesos}`;
      if (p.item) t += `\r\nitem : ${this.mgr.itemName(p.item.id) || ''}`;
      this.mgr.notice(t);
    }
  }
  /** What a click lands on: below the frame only receiveTB (with a parcel picked) or the fee table takes it. */
  contains(x, y) {
    const lx = x - this.x, ly = y - this.y;
    if (lx < 0 || lx >= 290 || ly < 0 || ly >= 541) return false;
    if (this.tab === 0) return !((this.sel < 0 && ly > 334) || ly > 442);
    return !(!this.form.table && ly > 350);
  }
  setBusy(b) { this.busy = b; if (!b) this.msg.value = ''; }

  // ---------------------------------------------------------------- server events
  setList(list) { this.list = list.slice(0, 10); this.sel = -1; this.first = 0; }
  /** 0x17: claimed or deleted. */
  gone(id, result) {
    this.list = this.list.filter((p) => p.id !== id); this.sel = -1; this.first = Math.min(this.first, Math.max(0, this.list.length - 3));
    this.mgr.notice(result === 3 ? 'Successfully deleted.' : 'Successfully claimed.');
    this.setBusy(false);
  }
  /** 0x18: a parcel arrived while Duey is open (ten at most). */
  added(p) {
    if (this.list.length < 10) { this.list.push(p); this.sel = -1; }
    this.mgr.notice('\tA new package has been sent.');
  }
  /** A result code: its notice, then the window is free again; a sent package resets the forms (or closes a quick-only window). */
  result(code) {
    const t = RESULTS[code];
    if (t) this.mgr.notice(t);
    this.setBusy(false);
    if (code !== 0x12) return;
    if (this.mode === 0) { this.forms = { 1: { ...this.blank(), table: this.forms[1].table }, 2: { ...this.blank(), ticket: 0, typed: false, table: this.forms[2].table } }; this.to.value = ''; this.msg.value = ''; }
    else if (this.mode === 1) this.close();
  }

  // ---------------------------------------------------------------- your actions
  take() {
    if (!this.list.length) return;
    const p = this.list[this.sel];
    if (!p || this.sel > 9) { this.mgr.notice("Please select the package you'll receive."); return; }
    if (daysLeft(p.sent) >= 30) { this.mgr.notice('Package is still being sent.\r\nPlease try again later.'); return; }
    this.g.net?.dueyTake(p.id);
    this.setBusy(true);
  }
  async remove() {
    const p = this.sel >= 0 && this.sel < 10 && this.list[this.sel];
    if (!p) return;
    if (!(await this.mgr.confirm('The items and/or mesos included in the package\r\nwill be permanently deleted.\r\nAre you sure you want to delete it?'))) return;
    this.g.net?.dueyDelete(p.id);
    this.setBusy(true);
  }
  async askMesos() {
    const quick = this.tab === 2, m = this.g.meso || 0;
    if (!quick && m < 5001) { this.mgr.notice('You do not have enough mesos.'); return; }
    const max = mesoCap(quick ? m : m - 5000);
    const v = await this.mgr.askNumber('How much money will you put up?', 0, 0, max);
    if (v == null) return;
    const f = this.form;
    f.mesos = v;
    if ((this.g.stats?.level || 0) < 16 && v > 1000000) { this.mgr.notice(LEVEL_LIMIT); f.mesos = 0; return; }
    f.color = mesoColor(v);
    f.text = v ? `${v.toLocaleString('en-US')} mesos.` : '';
  }
  async send() {
    const f = this.form, quick = this.tab === 2;
    if (quick && !f.ticket) {
      f.ticket = Number(Object.entries(this.g.inventory?.[5] || {}).sort((a, b) => a[0] - b[0]).find(([, it]) => it.id === 5330000)?.[0]) || 0;
      if (!f.ticket) { this.mgr.notice('You do not have the Quick Delivery Coupon.'); return; }
    }
    if (!f.item && !f.mesos) { this.mgr.notice('You must select either Mesos or items to send.'); return; }
    const to = this.to.value;
    if (!to) { this.mgr.notice('Please enter the name of the recipient.'); return; }
    const text = this.msg.value;
    if (quick && (await this.g.cursed(text))) { this.mgr.notice('Cursing is not allowed.'); return; }
    const ask = quick
      ? `The service charge \r\nwill cost ${feeFor(f.mesos)} mesos.\r\nThis will also use up \r\n1 [Quick Delivery Coupon].\r\nAre you sure \r\nyou want to send it?`
      : `The total wiring/transportation fee is\r\n${feeFor(f.mesos) + 5000} mesos.\r\nAre you sure you want to send the package?`;
    if (!(await this.mgr.confirm(ask))) return;
    this.g.net?.dueySend({ tab: f.item ? f.item.tab : 0, slot: f.item ? f.item.slot : 0, qty: f.qty, mesos: f.mesos, to, quick, message: text, ticket: f.ticket });
    this.setBusy(true);
  }
  close() { this.g.net?.dueyClose(); this.mgr.close(this); }
  onClose() { this.to.remove(); this.msg.remove(); if (this.g.dueyWin === this) this.g.dueyWin = null; }
  key(e) {
    if (this.busy) return;
    if (e.key === 'Escape') this.close();
    else if (e.key === 'Enter') { if (this.tab === 0) this.take(); else if (this.tab === 1) this.send(); }
  }
  /** An item from your inventory dropped on the send or quick form. */
  async drop(lx, ly, c) {
    if (c.kind !== 'item' || typeof c.tab !== 'number' || this.busy) return;
    const it = this.g.inventory?.[c.tab]?.[c.slot];
    if (!it) return;
    if (it.flag & 1) { this.mgr.notice('Sealed items cannot be\r\nsold, traded, or dropped.'); return; }
    const info = (await itemInfo(this.g.assets, it.id)) || {}, n = (k) => Number(info[k]) || 0;
    if (n('cash') || it.cashId || n('pquest') || n('quest') || n('tradeBlock') || n('accountSharable')) { this.mgr.notice('\t\tThis item cannot be sent.'); return; }
    if (this.tab !== 1 && this.tab !== 2) return;
    let qty = 1;
    if (invType(it.id) !== 1 && !isRechargeable(it.id)) {
      qty = await this.mgr.askNumber('How many do you wish to send?', 1, 1, it.quantity || 1);
      if (!qty) return;
    }
    Object.assign(this.form, { item: { tab: c.tab, slot: c.slot, id: it.id }, qty });
  }
  async down(lx, ly) {
    const t = (this.tabRects || []).findIndex(([x, w, y]) => lx >= x && lx < x + w && ly >= y && ly < y + 19);
    if (t >= 0 && !this.busy) {
      const tab = this.tabs[t];
      if (tab !== this.tab) { this.tab = tab; if (tab === 2 || tab === 0) this.msg.value = ''; }
      return;
    }
    if (this.tab === 0) {
      const sb = this.scrollClick(lx, ly, 267, 210, 85, this.first, this.list.length, 3, this.mgr.B.VScr4);
      if (sb !== null) { this.first = sb; return; }
      this.sel = lx > 9 && lx < 257 && ly > 232 && ly < 288 && Math.floor((ly - 230) / 18) + this.first < this.list.length ? Math.floor((ly - 230) / 18) + this.first : -1;
      return;
    }
    const f = this.form;
    if (f.item && lx > 120 && lx < 156 && ly > 251 && ly < 287) {
      if (await this.mgr.confirm('Are you sure you want to cancel?')) f.item = null;
      return;
    }
    if (lx > 136 && lx < 282 && ly > 231 && ly < 248) this.askMesos();
  }
  tooltip(lx, ly) {
    if (this.tab === 0) {
      const p = this.sel >= 0 && this.sel < 10 && this.list[this.sel];
      return p?.item && lx > 41 && lx < 77 && ly > 391 && ly < 427 ? { item: p.item } : null;
    }
    const f = this.form, it = f.item && this.g.inventory?.[f.item.tab]?.[f.item.slot];
    return it && lx > 120 && lx < 156 && ly > 251 && ly < 287 ? { item: it } : null;
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    const tab = this.tab, send = tab !== 0;
    for (const b of [this.recvBtn, this.delBtn]) b.visible = tab === 0;
    for (const b of [this.sendBtn, this.coinBtn]) b.visible = send;
    this.maxBtn.visible = send && this.form.table; this.minBtn.visible = send && !this.form.table;
    for (const b of this.buttons) b.enabled = !this.busy;
    super.draw(ctx);
    const scale = this.g.canvas.clientWidth / UI_W;
    this.to.show(send); this.to.rect.x = this.x + 123; this.to.rect.y = this.y + 213; this.to.layout({ left: 0, top: 0 }, scale);
    const p = tab === 0 && this.sel >= 0 && this.list[this.sel];
    this.msg.show(tab === 2 || !!(p && p.quick));
    this.msg.el.readOnly = tab === 0;
    if (tab === 0) this.msg.value = p && p.quick ? (p.message || 'No information entered.') : '';
    this.msg.rect.x = this.x + 95; this.msg.rect.y = this.y + 115; this.msg.layout({ left: 0, top: 0 }, scale);
  }
  body(ctx) {
    const m = this.mgr, D = this.D, im = (n) => m.image(n), put = (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x, y); };
    const tabLabels = { enabled: this.tabs.map((i) => D.Tab?.enabled?.[i]), disabled: this.tabs.map((i) => D.Tab?.disabled?.[i]) };
    this.tabRects = drawTabStrip(ctx, m, tabLabels, this.tabs.length, this.tabs.indexOf(this.tab), 170, 23);
    const black = { color: '#000', size: 12 };
    if (this.tab === 0) {
      put(D.npc1, 18, 110); put(D.icon0, 13, 64);
      if (!this.list.length) { put(D.empty, 66, 240); put(D.say1, 95, 114); return; }
      put(D.line0, 8, 210);
      for (let i = 0; i < 3; i++) {
        const idx = this.first + i, yRow = 229 + 18 * i, yText = 232 + 18 * i, q = this.list[idx], picked = idx === this.sel;
        if (picked) { ctx.fillStyle = '#244768'; ctx.fillRect(9, yRow, 254, 18); }
        put(D.line1, 8, yRow);
        if (!q) continue;
        const c = { color: picked ? '#fff' : '#000', size: 12 };
        uiText(ctx, q.sender, 13, yText, c);
        if (q.quick) uiText(ctx, '퀵배송', 113, yText, c);
        const d = daysLeft(q.sent);
        uiText(ctx, d >= 30 ? 'Delivering' : d > 0 ? `${d} day(s)` : 'Will expire soon', 188, yText, d > 0 ? c : { color: '#ff2020', size: 12 });
      }
      put(D.line2, 8, 283);
      this.scrollbar(ctx, 267, 210, 85, this.first, this.list.length, 3, m.B.VScr4);
      const p = this.sel >= 0 && this.list[this.sel];
      if (!p) { put(D.say1, 95, 114); return; }
      put(D.receiveTB, 0, 349);
      uiText(ctx, p.sender, 126, 359, black);
      if (p.mesos) uiText(ctx, p.mesos.toLocaleString('en-US'), 126, 378, black);
      if (p.item) {
        m.drawIcon(ctx, m.icon(p.item.id), 43, 408, p.item.id);
        if (invType(p.item.id) !== 1 && !isRechargeable(p.item.id)) m.count(ctx, p.item.quantity || 1, 43, 428);
        this.itemLines(ctx, p.item.id, 126, 409, 150, 126, 428);
      }
      if (!p.quick) put(D.say1, 95, 114);
      return;
    }
    const f = this.form, quick = this.tab === 2;
    if (quick) { put(D.icon3, 13, 64); put(D.npc2, 18, 110); put(D.sendTB, 8, 211); }
    else { put(D.say0, 95, 114); put(D.npc0, 29, 110); put(D.icon1, 13, 64); put(D.icon2, 36, 319); put(D.sendTB, 8, 211); }
    if (f.text) uiText(ctx, f.text, 141, 234, { color: f.color, size: 12 });
    const it = f.item && this.g.inventory?.[f.item.tab]?.[f.item.slot];
    if (f.item && !it) f.item = null;
    if (it) {
      m.drawIcon(ctx, m.icon(it.id), 122, 253, it.id);
      if (invType(it.id) !== 1 && !isRechargeable(it.id)) m.count(ctx, f.qty, 122, 273);
      this.itemLines(ctx, it.id, 164, 254, 104, 165, 273);
    }
    if (f.table) put(quick ? D.tax1 : D.tax, 0, 349);
    if (quick && !f.typed) {
      uiText(ctx, 'Please enter the message to send', 89, 122, { color: '#404040', size: 12 });
      uiText(ctx, 'by clicking here (100 letters)', 89, 135, { color: '#404040', size: 12 });
    }
  }
  /** An item's name (cut to `w`) and its level line ("Over Lv %d only" red, or "No level limit"). */
  itemLines(ctx, id, nx, ny, w, lx, ly) {
    let name = this.mgr.itemName(id) || '';
    ctx.save(); ctx.font = '12px Arial';
    if (ctx.measureText(name).width > w) { while (name && ctx.measureText(`${name}..`).width > w) name = name.slice(0, -1); name += '..'; }
    ctx.restore();
    uiText(ctx, name, nx, ny, { color: '#000', size: 12 });
    const lv = Number(this.mgr.info(id)?.reqLevel) || 0;
    uiText(ctx, lv > 0 ? `Over Lv ${lv} only` : 'No level limit', lx, ly, { color: lv > 0 ? '#ff2020' : '#000', size: 12 });
  }
}
