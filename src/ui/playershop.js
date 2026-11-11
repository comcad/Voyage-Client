import { invType, itemInfo } from '../data.js';
import { pad, frames } from '../assets.js';
import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { npcTalk } from './dialogs.js';
import { UI_W } from '../view.js';
import { config } from '../config.js';

/**
 * A personal shop or a Hired Merchant's room: UIWindow.img/PersonalShop/backgrnd6 (525x553, fee table included), the
 * client's room window for both, centred on the 800x600 screen at y 23. From the client's draw:
 *   the title at (23, 9) in bold; the owner's name centred on x 56 and the visitors' names at x (slot + 2) x 95 less
 *   half their width, all at y 135 in white; the mesos ending at x 218, y 135
 *   five stock rows from y 157, 40px each (hit x 7-205): the icon's foot at (8, row + 34), the bundle count at
 *   (8, row + 23), the name at (48, row + 1) and the price at (48, row + 19)
 *   the chat log at (239, 160) 257x161; its line in the art's input frame (237-479, 321-337)
 *   a Hired Merchant's owner sees "Store Closed / hh : mm" at (380, 11): the minutes left of its 24 hours
 * Room chat lines take the seat's colour: black for the owner, then #006699, #CC0066 and #336600.
 *
 * Its buttons, by who you are:
 *   shop owner:       ITEMS AVAILABLE, OPEN STORE, CLOSE STORE, and a ban button on each taken visitor seat
 *   shop visitor:     SELLER INFO, BUY ITEM, LEAVE STORE
 *   merchant owner:   ITEMS AVAILABLE, OPEN STORE (setting it up) or LEAVE STORE (keeping it up), CLOSE STORE,
 *                     ORGANIZE, the coin (take its mesos), BLACK LIST and VIEW VISITORS
 *   merchant visitor: BUY ITEM, LEAVE STORE, and BLACK LIST / VIEW VISITORS greyed
 *   everyone:         ENTER (sends the chat line) and the Report siren, which does nothing in the client either
 * The places of all of these were lost in the decompile: they are placed by the art (unverified).
 *
 * Owner, before OPEN STORE: drag items in (asked how many per bundle, how many bundles and the bundle's price),
 * double-click one to take it back. Visitors pick a row and BUY so many bundles.
 */
const ROWS = 5, ROW_Y = 157, ROW_H = 40, SPOTS = [285, 378, 472];
const COL = 126, BAN_X = [317, 409, 505];
const SEAT_COLORS = ['#000000', '#006699', '#CC0066', '#336600'];
const STAY = 3600000;   // a shop's owner sends a visitor out after an hour
/** The shop's fee on a sale, as the fee table in the window's art shows it (truncated). */
const shopFee = (g) => Math.trunc(g * (g >= 1e8 ? 0.03 : g >= 2.5e7 ? 0.025 : g >= 1e7 ? 0.02 : g >= 5e6 ? 0.015 : g >= 1e6 ? 0.009 : g >= 1e5 ? 0.004 : 0));
// why you were sent out of a room (the 0A that names your own seat)
const LEAVE = { 1: "You can't establish a miniroom right here.", 3: 'The shop is closed.', 5: 'The user has been banned.',
  6: 'The store cannot be opened as the time limit has passed.', 0xe: 'The items are out of stock.',
  0xf: 'You have been banned from the room for exceeding the time limit. You are now blocked from re-entering this store.' };
// and the Hired Merchant's own; 0x14 (closed by a GM) says nothing
const MERCHANT_LEAVE = { ...LEAVE,
  0x11: 'The owner of the store is currently\r\nundergoing store maintenance.\r\nPlease try again in a bit.',
  0x12: 'It is past the working hours,\r\nso the store will close.',
  0x13: 'The use of the Remote Control stopped\r\ndue to moving to another map. Please use it later.' };
const CLOSE_ASK = "If there's no slot available for the item at\r\nthe inventory, the item can only be retrieved\r\nthrough Fredrick, the Store Bank NPC.\r\nWill you close the store?";

export class PlayerShopWin extends Win {
  constructor(mgr, d) {
    const P = mgr.W.PersonalShop, E = mgr.W.EntrustedShop;
    super(mgr, P.backgrnd6, Math.round((UI_W - 525) / 2), 23);
    this.buttons = []; this.closeBtn = null;
    this.P = P; this.slot = d.slot; this.title = d.title; this.items = d.items;
    // the sales record: a Hired Merchant's from its room packet (the sales' sum, and what it holds for you); a shop's
    // starts empty and grows with each sale
    this.sold = d.merchant ? (d.sold || []) : [];
    this.sales = d.merchant ? { total: this.sold.reduce((a, x) => a + (x.mesos || 0), 0), received: d.received || 0 } : { total: 0, received: 0 };
    this.people = Object.fromEntries(d.people.map((p) => [p.slot, p]));
    // a visitor only ever sees an open shop; a Hired Merchant you keep up is open already
    this.open = d.slot !== 0 || (!!d.merchant && !d.firstTime);
    // a Hired Merchant's room: no owner in it - its employee stands on the owner's spot
    if (d.merchant) {
      this.merchant = d; this.mesos = d.mesos;
      this.openedAt = performance.now();
      mgr.assets.json('Item/Cash/0503.img').then(async (m) => {
        const f = frames(m?.[pad(d.itemId, 8)]?.employee?.stand)[0];
        if (f) { await mgr.assets.preload([f]); this.employee = f; }
      });
    }
    this.first = 0; this.sel = -1; this.lines = [];
    // your Hired Merchant's notes from while you were away start its chat, their text masked as room chat is
    for (const n of d.notes || []) this.say(this.g.maskedLine ? this.g.maskedLine(n.text) : n.text, SEAT_COLORS[n.slot] || '#000');
    this.enterAt = [0, 0, 0, 0];      // when each visitor came in (the owner's hour-long stay rule)
    const tip = () => this.openSales();
    if (this.owner) {
      this.button(P.BtItem, COL, 44, tip);
      if (!d.merchant || d.firstTime) this.startBtn = this.button(P.BtStart, COL, 68, () => this.start());
      else this.button(P.BtExit, COL, 68, () => this.leaveMaintenance());
      this.button(P.BtClose, COL, 92, () => this.closeStore());
      if (d.merchant) {
        this.button(E.BtArrange, 131, 113, () => this.organize());
        this.coinBtn = this.button(E.BtCoin, 114, 135, () => this.takeMesos());
      } else {
        this.banBtns = BAN_X.map((x, i) => this.button(P.BtBan, x, 38, () => this.ban(i + 1)));
        const now = performance.now();
        this.banBtns.forEach((b, i) => { b.visible = !!this.people[i + 1]; if (b.visible) this.enterAt[i + 1] = now; });
      }
    } else {
      if (!d.merchant) this.button(P.BtInfo, COL, 44, () => this.sellerInfo());
      this.buyBtn = this.button(P.BtBuy, COL, 68, () => this.buy());
      this.button(P.BtExit, COL, 92, () => this.leave());
    }
    if (d.merchant) {
      // only the owner may use them: a visitor sees them greyed
      this.blackBtn = this.button(P.BtBlackList, 352, 345, () => this.askBlacklist());
      this.visitBtn = this.button(P.BtVisit, 424, 345, () => this.askVisits());
      this.blackBtn.enabled = this.visitBtn.enabled = this.owner;
    }
    this.button(mgr.B.BtClaim, 496, 343, () => {});
    this.button(P.BtEnter, 481, 321, () => this.sendChat());
    this.chat = new TextField(mgr.game.statusBar.layer, 0, 0, 239, 14, { max: 70, color: '#000' });
    this.chat.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.sendChat();
      else if (e.key === 'Escape') this.chat.el.blur();
    });
  }
  get owner() { return this.slot === 0; }
  get ownMerchant() { return this.owner && !!this.merchant; }
  frames() { return [...super.frames(), ...allCanvases(this.P), ...allCanvases(this.mgr.W.EntrustedShop), ...allCanvases(this.mgr.B.ItemNo)]; }

  // ---------------------------------------------------------------- server events
  setItems(items, mesos) { this.items = items; this.sel = Math.min(this.sel, items.length - 1); if (mesos !== undefined) this.mesos = mesos; }
  /** ORGANIZE's answer: what the merchant holds now, and its sold-out rows gone. */
  organized(mesos) { this.mesos = mesos; this.items = this.items.filter((r) => r.bundles > 0); this.sel = Math.min(this.sel, this.items.length - 1); }
  mesoTaken() { this.mesos = 0; }
  visitor(slot, name, look) {
    this.people[slot] = { slot, name, look };
    sfx.play('UI/BtMouseClick');
    if (this.banBtns && slot >= 1 && slot <= 3) { this.banBtns[slot - 1].visible = true; this.enterAt[slot] = performance.now() || 1; }
  }
  left(slot) {
    if (slot === this.slot) { this.end(); return; }
    delete this.people[slot];
    if (this.banBtns && slot >= 1 && slot <= 3) { this.banBtns[slot - 1].visible = false; this.enterAt[slot] = 0; }
  }
  /** A sale (the owner's 1A): on the record, its bundle price kept, and the takings less the shop's fee. */
  soldUpdate(index, qty, buyer) {
    const it = this.items[index];
    if (!it) return;
    const gross = qty * it.price;
    this.sold.push({ id: it.item.id, qty: qty * (it.perBundle || 1), mesos: it.price, buyer });
    this.sales.total += gross; this.sales.received += gross - shopFee(gross);
    this.salesWin?.refresh();
  }
  /** A room chat line in its seat's colour (or a line of the client's own, in grey). */
  seatSay(slot, text) { this.say(text, SEAT_COLORS[slot] || '#000'); }
  say(text, color = '#000') { this.lines.push({ text, color }); if (this.lines.length > 60) this.lines.shift(); }
  end(reason = 0) {
    this.chat.remove();
    for (const w of [this.blackWin, this.visitWin, this.salesWin]) if (w) this.mgr.close(w);
    this.mgr.close(this);
    if (this.g.playerShop === this) this.g.playerShop = null;
    const t = (this.merchant ? MERCHANT_LEAVE : LEAVE)[reason];
    if (reason && t) this.mgr.notice(t);
  }
  /** The visit list / blacklist arrived (a Hired Merchant's owner asked): its window, and the button greyed while it's up. */
  showVisits(list) {
    if (this.visitWin || !this.ownMerchant) return;
    this.visitBtn.enabled = false;
    this.visitWin = this.mgr.show(new VisitListWin(this.mgr, list, () => { this.visitWin = null; this.visitBtn.enabled = true; }));
  }
  showBlacklist(list) {
    if (this.blackWin || !this.ownMerchant) return;
    this.blackBtn.enabled = false;
    this.blackWin = this.mgr.show(new BlacklistWin(this.mgr, list, () => { this.blackWin = null; this.blackBtn.enabled = true; }));
  }

  // ---------------------------------------------------------------- your actions
  /** ENTER, or the Enter key: the line goes through the chat checks, and the box is cleared. */
  sendChat() {
    const t = this.chat.value;
    if (!t) return;
    this.chat.value = '';
    this.g.roomChat?.(t);
    this.chat.el.focus();
  }
  /** LEAVE STORE as a visitor. */
  leave() { this.g.net?.pshopExit(); this.end(); }
  /** LEAVE STORE while keeping your Hired Merchant up: it opens again, and you leave the room. */
  leaveMaintenance() { this.g.net?.merchantLeave(); this.g.net?.pshopExit(); this.end(); }
  /**
   * CLOSE STORE. A shop closes at once. A Hired Merchant that was open asks first; then, with items or mesos still in
   * it, it is closed for good and the server's answer closes the window; with nothing in it you simply leave.
   */
  async closeStore() {
    if (!this.merchant) { this.g.net?.pshopExit(); this.end(); return; }
    if (this.open && !(await this.mgr.confirm(CLOSE_ASK))) return;
    if (this.items.length || this.mesos) this.g.net?.merchantClose();
    else { this.g.net?.pshopExit(); this.end(); }
  }
  /** ORGANIZE: crosses off what sold and collects the takings (told first when there is stock). */
  async organize() {
    if (this.items.length) await this.mgr.notice('The sold items are crossed off the list, and\r\nthe sales fee will be retrieved.');
    this.g.net?.merchantOrganize();
  }
  takeMesos() { if (this.mesos) this.g.net?.merchantMeso(); }
  askBlacklist() { if (!this.blackWin) this.g.net?.merchantBlacklist(); }
  askVisits() { if (!this.visitWin) this.g.net?.merchantVisits(); }
  async ban(slot) {
    const name = this.people[slot]?.name;
    if (!name) return;
    if (await this.mgr.confirm(`Would you like to ban ${name}?`)) this.g.net?.pshopBan(slot, name);
  }
  /** SELLER INFO: the owner's Character Info, when they are on this map. */
  sellerInfo() {
    const name = this.people[0]?.name, o = name && [...this.g.others.values()].find((x) => x.name === name);
    if (o) this.g.requestCharInfo(o.id);
  }
  /** ITEMS AVAILABLE: what has sold so far. */
  openSales() {
    if (this.salesWin) return;
    this.salesWin = this.mgr.show(new SalesWin(this.mgr, this, () => { this.salesWin = null; }));
  }
  key(e) { if (e.key === 'Escape') { if (this.owner) this.closeStore(); else this.leave(); } }
  /**
   * OPEN STORE: your own blacklist's names go first (with stock up), then - with a cash item up for sale - your
   * birthday code, or the store opens. A shop stays on screen; a Hired Merchant takes over and you leave the room.
   */
  async start() {
    if (this.items.length) this.g.net?.pshopBlacklistNames(this.g.windows.wins.userlist?.mine?.black || []);
    const infos = await Promise.all(this.items.map((it) => itemInfo(this.g.assets, it.item.id)));
    if (infos.some((i) => Number(i?.cash))) {
      const b = config.skipBirthday ? String(config.birthdayCode) : await this.mgr.askText('For the sake of privacy,\nplease enter your 8-digit birthday code.\nex) year/month/day -> 19820911', '', { max: 8 });
      if (/^\d{8}$/.test(b || '')) this.g.net?.pshopOpenCash(this.merchant ? 5 : 4, Number(b));
      return;
    }
    this.g.net?.pshopOpenStore();
    if (this.ownMerchant) { this.g.net?.pshopExit(); this.end(); return; }
    this.open = true;
    if (this.startBtn) this.startBtn.enabled = false;
  }
  /** An item dragged in from the inventory: ask how it is sold, then put it up. */
  async drop(lx, ly, c) {
    if (!this.owner || this.open || c.kind !== 'item' || typeof c.tab !== 'number') return;
    const it = this.g.inventory?.[c.tab]?.[c.slot];
    if (!it) return;
    if (it.flag & 1) { this.mgr.notice('Sealed items cannot be\r\nsold, traded, or dropped.'); return; }   // sealed by an Item Guard
    const qty = it.quantity || 1, recharge = [207, 233].includes(Math.floor(it.id / 10000));
    let per = 1, bundles = 1;
    if (!recharge && invType(it.id) !== 1 && qty > 1) {
      per = await this.mgr.askNumber(`How many #t${it.id}# in each bundle?\n(1 ~ ${qty})`, 1, 1, qty);
      if (!per) return;
      const most = Math.floor(qty / per);
      bundles = most > 1 ? await this.mgr.askNumber(`How many bundles?\n(1 ~ ${most})`, most, 1, most) : 1;
      if (!bundles) return;
    }
    const price = await this.mgr.askNumber(`The price of one bundle of #t${it.id}#?`, 1, 1, 2147483647);
    if (!price) return;
    this.g.net?.pshopPut(c.tab, c.slot, bundles, per, price);
  }
  async buy(idx = this.sel) {
    const row = this.items[idx];
    if (!row || row.bundles <= 0) return;
    const most = Math.min(row.bundles, Math.floor((this.g.meso || 0) / Math.max(1, row.price)));
    if (most < 1) { this.mgr.notice('You do not have enough mesos.'); return; }
    const n = most > 1 ? await this.mgr.askNumber(`How many bundles of #t${row.item.id}# will you buy?\n(1 ~ ${most})`, 1, 1, most)
      : (await this.mgr.confirm(`Buy #t${row.item.id}# for ${row.price.toLocaleString('en-US')} mesos?`)) ? 1 : 0;
    if (n) this.g.net?.pshopBuy(idx, n);
  }

  // ---------------------------------------------------------------- frame
  /** A shop's owner sends out whoever has stayed an hour. */
  tick() {
    if (!this.banBtns) return;
    const now = performance.now();
    for (let s = 1; s <= 3; s++) {
      if (this.enterAt[s] > 0 && now - this.enterAt[s] > STAY) {
        this.enterAt[s] = 0;
        const name = this.people[s]?.name;
        if (name) this.g.net?.pshopStayOver(s, name);
      }
    }
  }
  draw(ctx) {
    super.draw(ctx);
    this.chat.rect.x = this.x + 240; this.chat.rect.y = this.y + 322;
    this.chat.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), g = this.g;
    uiText(ctx, this.title, 23, 9, { color: '#000', size: 12, bold: true });
    // a Hired Merchant's owner: the hours and minutes left of its 24 (1439 minutes from when it opened)
    if (this.ownMerchant) {
      const left = 1439 - Math.floor(((this.merchant.elapsed || 0) + performance.now() - this.openedAt) / 60000), h = Math.floor(left / 60);
      if (h >= 0 && h < 24) uiText(ctx, `Store Closed / ${String(h).padStart(2, '0')} : ${String(left % 60).padStart(2, '0')}`, 380, 11, { color: '#000', size: 12, bold: true });
    }
    // the owner and the visitors on their spots
    const spot = (p, x) => {
      if (!p) return;
      // the server sends raw looks: draw the one already built for that character on the map
      const look = p.slot === this.slot ? g.look : [...g.others.values()].find((o) => o.name === p.name)?.look;
      if (look?.compose) { ctx.save(); ctx.beginPath(); ctx.rect(x - 45, 32, 90, 100); ctx.clip(); drawParts(ctx, g.assets, look.compose(look.standAction(), 0), x, 128, false); ctx.restore(); }
    };
    const name = (text, slot) => {
      if (!text) return;
      if (slot === 0) { uiText(ctx, text, 56, 135, { color: '#fff', size: 12, align: 'center' }); return; }
      ctx.save(); ctx.font = '12px Arial'; const w = ctx.measureText(text).width; ctx.restore();
      uiText(ctx, text, (slot + 2) * 95 - Math.floor((w + 5) / 2), 135, { color: '#fff', size: 12 });
    };
    if (this.merchant && !this.people[0]) {
      const e = this.employee, ei = e && m.image(e);
      if (ei) { const o = e.origin || [ei.width / 2, ei.height]; ctx.drawImage(ei, 55 - o[0], 128 - o[1]); }
      name(this.merchant.ownerName, 0);
    } else { spot(this.people[0], 55); name(this.people[0]?.name, 0); }
    SPOTS.forEach((x, i) => { spot(this.people[i + 1], x); name(this.people[i + 1]?.name, i + 1); });
    this.text(ctx, ((this.ownMerchant ? this.mesos : g.meso) || 0).toLocaleString('en-US'), 218, 135, { align: 'right', size: 12 });
    // the stock
    for (let i = 0; i < ROWS; i++) {
      const idx = this.first + i, r = this.items[idx];
      if (!r) break;
      const y = ROW_Y + i * ROW_H;
      if (idx === this.sel) { const s = im(this.P.select); if (s) ctx.drawImage(s, 41, y); }
      m.drawIcon(ctx, m.icon(r.item.id), 8, y + 2);
      if (r.perBundle > 1) m.count(ctx, r.perBundle, 8, y + 23);
      ctx.save(); ctx.beginPath(); ctx.rect(44, y, 160, 37); ctx.clip();
      this.text(ctx, m.itemName(r.item.id), 48, y + 1, { bold: true });
      this.text(ctx, `${r.price.toLocaleString('en-US')} mesos  x${r.bundles}`, 48, y + 19);
      ctx.restore();
      if (r.bundles <= 0) { const so = im(this.P.soldout); if (so) ctx.drawImage(so, 6, y); }
    }
    this.scrollbar(ctx, 208, 156, 196, this.first, this.items.length, ROWS);
    // chat
    ctx.save(); ctx.beginPath(); ctx.rect(239, 160, 257, 161); ctx.clip();
    const rows = this.lines.flatMap((l) => wrapText(ctx, l.text, 251, 11).map((text) => ({ text, color: l.color }))).slice(-10);
    rows.forEach((l, i) => uiText(ctx, l.text, 242, 163 + i * 15, { color: l.color, size: 11 }));
    ctx.restore();
  }
  rowAt(lx, ly) {
    if (lx < 7 || lx > 205 || ly < ROW_Y) return -1;
    const i = Math.floor((ly - ROW_Y) / ROW_H);
    if (i >= ROWS) return -1;
    return this.first + i < this.items.length ? this.first + i : -1;
  }
  down(lx, ly) {
    const s = this.scrollClick(lx, ly, 208, 156, 196, this.first, this.items.length, ROWS);
    if (s !== null) { this.first = s; return; }
    const r = this.rowAt(lx, ly);
    if (r >= 0) this.sel = r;
  }
  dblclick(lx, ly) {
    const r = this.rowAt(lx, ly);
    if (r < 0) return;
    this.sel = r;
    if (this.owner && !this.open) { if (this.merchant) this.g.net?.merchantTakeBack(r); else this.g.net?.pshopRemove(r); }
    else if (!this.owner) this.buy(r);
  }
  wheel(dy) { this.first = Math.max(0, Math.min(this.items.length - ROWS, this.first + Math.sign(dy))); }
  tooltip(lx, ly) {
    const r = this.rowAt(lx, ly);
    return r >= 0 && lx < 42 ? { item: this.items[r].item } : null;
  }
}

/** The cells of the two lists: 18px rows from y 51; the blacklist two columns (x 7-131 / 135-259), the visit list one. */
const cellAt = (i, two) => (two ? { x: i % 2 ? 135 : 7, y: 51 + 18 * Math.floor(i / 2), w: 124 } : { x: 7, y: 51 + 18 * i, w: 189 });
// the selected cell's fill: its colour was lost (the name turns white on it)
const SEL_FILL = '#3a5a8c';

/**
 * A Hired Merchant's blacklist (PersonalShop/backgrnd5, 263x270, centred at (268, 165)): up to 20 names in two
 * columns of 10 (cells 124x18 from (7, 51) / (135, 51)), each at its cell's (3, 4), white on the picked one.
 * ADD (5, 245) asks a name (4-12 letters) in the NPC dialog's text box; it must pass the forbidden-name / curse check,
 * not be yours (exactly) and not be listed already (any case); then it goes on the list and to the server (30).
 * DELETE (42, 245) takes the picked one off (31). OK (227, 245) closes it.
 */
export class BlacklistWin extends Win {
  constructor(mgr, names, onClose) {
    const P = mgr.W.PersonalShop;
    super(mgr, P.backgrnd5, 268 + Math.round((UI_W - 800) / 2), 165);
    this.buttons = []; this.closeBtn = null;
    this.names = names.slice(0, 20); this.sel = -1; this.onClose = onClose;
    this.addBtn = this.button(P.BtAdd, 5, 245, () => this.add());
    this.delBtn = this.button(P.BtDelete, 42, 245, () => this.remove());
    this.button(P.BtOK, 227, 245, () => this.close());
    this.sync();
  }
  sync() { this.addBtn.enabled = this.names.length < 20; this.delBtn.enabled = this.sel >= 0 && this.sel < this.names.length; }
  close() { this.mgr.close(this); this.onClose?.(); }
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') this.close(); }
  async add() {
    if (this.names.length >= 20) return;
    const r = await npcTalk(this.mgr, { npc: 0, type: 2, text: "Please enter the name of the character you'd like to add to the Blacklist.", def: '', min: 4, max: 12 });
    if (r?.action !== 1) return;
    const name = String(r.sel ?? '').trim();
    if (!name) return;
    if (!(await this.nameOk(name))) { await this.mgr.notice('This character name does not exist\r\nPlease check again'); return; }
    if (name === this.g.player?.name) { await this.mgr.notice('You may not enter yourself in the Blacklist'); return; }
    if (this.names.some((n) => n.toLowerCase() === name.toLowerCase())) { await this.mgr.notice('This name has already been registered\r\nPlease check again'); return; }
    this.names.push(name);
    this.g.net?.merchantBlacklistAdd(name);
    this.sync();
  }
  remove() {
    if (this.sel < 0 || this.sel >= this.names.length) return;
    this.g.net?.merchantBlacklistRemove(this.names[this.sel]);
    this.names.splice(this.sel, 1);
    this.sync();
  }
  /** No word from Etc/ForbiddenName.img or Etc/Curse.img in it. */
  async nameOk(name) {
    this.bad ??= await Promise.all(['Etc/ForbiddenName.img', 'Etc/Curse.img'].map((p) => this.g.assets.json(p)))
      .then((ls) => ls.flatMap((l) => Object.values(l || {})).filter((w) => typeof w === 'string' && w).map((w) => w.split(',')[0].toLowerCase()).filter(Boolean));
    const low = name.toLowerCase();
    return !this.bad.some((w) => low.includes(w));
  }
  body(ctx) {
    this.names.slice(0, 20).forEach((n, i) => {
      const c = cellAt(i, true), on = i === this.sel;
      if (on) { ctx.fillStyle = SEL_FILL; ctx.fillRect(c.x, c.y, c.w, 18); }
      uiText(ctx, n, c.x + 3, c.y + 4, { color: on ? '#fff' : '#000', size: 12 });
    });
  }
  down(lx, ly) {
    this.sel = -1;
    for (let i = 0; i < Math.min(this.names.length, 20); i++) {
      const c = cellAt(i, true);
      if (lx >= c.x && lx < c.x + c.w && ly >= c.y && ly < c.y + 18) { this.sel = i; break; }
    }
    this.sync();
  }
}

/**
 * A Hired Merchant's visit list (PersonalShop/backgrnd4, 203x270, centred at (298, 165)): the last ten visitors in
 * rows of 18px from (7, 51), the name at (3, 4) and " %dhrs %dmin" at (125, 4) of the row (the minutes' value was
 * lost: taken as the rest of the hour). SAVE NAME (4, 245) copies the picked name to the clipboard; OK (163, 245).
 */
export class VisitListWin extends Win {
  constructor(mgr, list, onClose) {
    const P = mgr.W.PersonalShop;
    super(mgr, P.backgrnd4, 298 + Math.round((UI_W - 800) / 2), 165);
    this.buttons = []; this.closeBtn = null;
    this.list = list.slice(0, 10); this.sel = -1; this.onClose = onClose;
    this.saveBtn = this.button(P.BtSaveName, 4, 245, () => this.save());
    this.button(P.BtOK, 163, 245, () => this.close());
    this.sync();
  }
  sync() { this.saveBtn.enabled = this.sel >= 0 && this.sel < this.list.length; }
  close() { this.mgr.close(this); this.onClose?.(); }
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') this.close(); }
  save() { const v = this.list[this.sel]; if (v) navigator.clipboard?.writeText(v.name).catch(() => {}); }
  body(ctx) {
    this.list.forEach((v, i) => {
      const c = cellAt(i, false), on = i === this.sel, color = on ? '#fff' : '#000';
      if (on) { ctx.fillStyle = SEL_FILL; ctx.fillRect(c.x, c.y, c.w, 18); }
      uiText(ctx, v.name, c.x + 3, c.y + 4, { color, size: 12 });
      uiText(ctx, ` ${Math.floor(v.ms / 3600000)}hrs ${Math.floor(v.ms / 60000) % 60}min`, c.x + 125, c.y + 4, { color, size: 12 });
    });
  }
  down(lx, ly) {
    this.sel = -1;
    for (let i = 0; i < this.list.length; i++) {
      const c = cellAt(i, false);
      if (lx >= c.x && lx < c.x + c.w && ly >= c.y && ly < c.y + 18) { this.sel = i; break; }
    }
    this.sync();
  }
}

/**
 * ITEMS AVAILABLE: the sales record (PersonalShop/backgrnd3, 233x276, centred at (283, 162)). Four rows 58px apart:
 * the item's icon standing at (8, 75 + 58k) with the cash mark for a cash item, then in black Arial its name at
 * (50, 32 + 58k), "Buyer : %s" at (50, 51 + 58k) and "Number purchased : %d" at (50, 70 + 58k). After the last sale
 * comes the totals row: the meso bag (Item/Special/0900.img/09000001), "Total Sales / Total Received" and the two
 * sums as "%s mesos.". It scrolls to n - 2 when there are four or more sales, so the last page shows three rows.
 * BtClose (212, 8) and the scrollbar on the art's track (211, 32, 227 long) lost their places: placed by the art.
 */
export class SalesWin extends Win {
  constructor(mgr, shop, onClose) {
    const P = mgr.W.PersonalShop;
    super(mgr, P.backgrnd3, 283 + Math.round((UI_W - 800) / 2), 162);
    this.buttons = [];
    this.closeBtn = this.button(mgr.B.BtClose, 212, 8, () => this.close()); this.closePinned = true;
    this.shop = shop; this.onClose = onClose; this.first = 0;
    mgr.assets.json('Item/Special/0900.img').then(async (m) => {
      const r = m?.['09000001']?.iconRaw, n = r?.['1'] || r;
      if (n?._canvas) { await mgr.assets.preload([n]); this.mesoIcon = n; }
    });
  }
  get sold() { return this.shop.sold; }
  get max() { const n = this.sold.length; return n < 4 ? 0 : n - 2; }
  refresh() { this.first = Math.min(this.first, this.max); }
  close() { this.mgr.close(this); this.onClose?.(); }
  key(e) { if (e.key === 'Escape') this.close(); }
  body(ctx) {
    const m = this.mgr, n = this.sold.length, t = (v, x, y) => this.text(ctx, v, x, y, { size: 12 });
    for (let k = 0; k < 4; k++) {
      const idx = this.first + k, y = 58 * k;
      if (idx > n) break;
      if (idx === n) {
        if (this.mesoIcon) m.drawIcon(ctx, this.mesoIcon, 8, 75 + y - 32);
        t('Total Sales / Total Received', 50, 32 + y);
        t(`${(this.shop.sales.total || 0).toLocaleString('en-US')} mesos.`, 50, 51 + y);
        t(`${(this.shop.sales.received || 0).toLocaleString('en-US')} mesos.`, 50, 70 + y);
        break;
      }
      const s = this.sold[idx];
      m.drawIcon(ctx, m.icon(s.id), 8, 75 + y - 32, s.id);
      ctx.save(); ctx.beginPath(); ctx.rect(50, 30 + y, 154, 16); ctx.clip(); t(m.itemName(s.id), 50, 32 + y); ctx.restore();
      t(`Buyer : ${s.buyer}`, 50, 51 + y);
      t(`Number purchased : ${s.qty}`, 50, 70 + y);
    }
    this.scrollbar(ctx, 211, 32, 227, this.first, this.max + 1, 1);
  }
  down(lx, ly) { const f = this.scrollClick(lx, ly, 211, 32, 227, this.first, this.max + 1, 1); if (f !== null) this.first = f; }
  wheel(dy) { this.first = Math.max(0, Math.min(this.max, this.first + Math.sign(dy))); }
}
