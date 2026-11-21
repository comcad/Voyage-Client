import { itemName, itemInfo } from '../data.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { sfx } from '../audio.js';
import { uiText, wrapText } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { UI_W, UI_H } from '../view.js';
import { config } from '../config.js';
import { nameTag } from '../map.js';
import { ComboBox, editBox, placeBox } from './cashshop.js';

/**
 * The MTS (UI/ITC.img), a full 800x600 screen. Its parts, by their top-left corner:
 *   My Character (0,0), Not Yet Sold (0,200), Transfer Inventory (0,310), Item Inventory (0,418),
 *   tabs and the search row (272,17), sub-tabs and the sort header (273,98), the list (273,145),
 *   NX / Maple Points / mesos with Charge, Check and Exit (255,531).
 * Tabs: 1 FOR SALE, 2 WANTED, 3 AUCTION, 4 MY PAGE (sub-tabs CART, OFFERS, HISTORY, AUCTION), 5 GUIDE.
 * One request is answered at a time: while one is out the screen sends nothing else (the search and Exit aside).
 * Places the client doesn't give are measured from the original's own screen: the For Sale / Wanted / Auction box,
 * Not Yet Sold's Cancel, the Item Inventory's Sell / Auction and tabs, the scrollbars, the pager, and the character
 * standing at the preview's left with its name tag; the tabs' frames are Basic.img's Tab7 (the closest art).
 */
const FOR_SALE = 1, WANTED = 2, AUCTION = 3, MY_PAGE = 4, GUIDE = 5;
const CART = 0, OFFERS = 1, HISTORY = 2, MY_AUCTION = 3;
const TABS_X = 272, TABS_Y = 17, SUB_X = 273, SUB_Y = 98, LIST_X = 273, LIST_Y = 145, BAR_X = 255, BAR_Y = 531;
/** A top tab's hit x (left of the selected tab / right of it), 93 wide, y 19-49 in the tab art. */
const TAB_HIT = { 1: [3, 3], 2: [100, 112], 3: [193, 205], 4: [286, 298], 5: [379, 391] };
const SLOT = 35, ROWS = 16, ROW_H = 20;
const NYS = { x: 19, y: 235, cols: 6, rows: 2, bar: [228, 235, 66] };
const TRANS = { x: 20, y: 343, cols: 6, rows: 2, bar: [228, 343, 66] };
const INV = { x: 19, y: 477, cols: 6, rows: 3, bar: [228, 477, 102] };
const PRICE_MIN = 110, PRICE_MAX = 9999999;
/** Items with this end date or later never expire (2079-01-01). */
const PERMANENT = 150842304000000000n;
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const ftMs = (ft) => Number(BigInt(ft) / 10000n) - 11644473600000;
const maskId = (s) => (s || '').slice(0, 2) + (s.length > 2 ? '*' : '') + (s.length > 3 ? `*${s.slice(4)}` : '');
const CATEGORIES = ['ALL', 'EQP', 'USE', 'SET UP', 'ETC'];
const STATUS = { [HISTORY]: ['Sold', 'Purchased', 'Bid Lost', 'Cancelled'], [MY_AUCTION]: [null, 'Exhibit', 'Bid'] };

/** What a reason code says (the server's refusals). */
const REASONS = {
  0x42: 'You do not have enough NX.', 0x43: 'You do not have enough mesos.', 0x44: 'An error has occurred while using NX.',
  0x47: 'Your inventory is full.', 0x49: 'Failed to load the list.',
  0x4E: 'Unable to pull out of the sale.\r\nYou have at least 1 bid on the item.', 0x4F: 'This Item may not be sold.',
  0x51: 'The item has been sold.\r\nYou cannot cancel the sale of a purchased item.', 0x52: 'Throwing Stars are not tradable.',
  0x53: 'You must be over level 10 to sell\r\nitems on MapleStory Trading System.',
};
const reason = (code) => REASONS[code] || 'Due to an unknown error,\r\nthe request for MTS has failed.';
/** Results that end the request they answer (0x15 and 0x21 do when they say so). */
const ANSWERS = new Set([0x16, 0x17, 0x18, 0x1D, 0x1E, 0x1F, 0x20, 0x22, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x2C, 0x2D, 0x2E, 0x30, 0x31, 0x32, 0x34, 0x36, 0x37, 0x38, 0x3C]);
/** Results with just a message. */
const SAY = {
  0x1D: 'Successfully registered the item for sale.', 0x1F: 'Successfully requested the item for sale.', 0x25: 'Successfully canceled the sale.',
  0x29: 'The item has been successfully placed\r\nin your Cart.', 0x2A: 'Failed to place the item in your Cart.',
  0x2B: 'Successfully deleted the item from the Cart.', 0x2C: 'Failed to remove the item from the Cart.',
  0x2E: 'Failed to load the Buy List.', 0x2F: 'Successfully requested to buy the item.', 0x30: 'Request to buy the item has failed.',
  0x31: 'The request for purchase has been canceled.', 0x32: 'Failed to cancel the request for purchase.',
  0x33: 'You have successfully purchased the item.', 0x34: 'Failed to purchase the item.', 0x35: 'You have successfully purchased the item.',
  0x36: 'Failed to purchase the item.', 0x37: 'Successfully registered under [Buy].', 0x38: 'Failed to register the item under [Buy].',
  0x3C: 'You cannot make a consecutive bid.',
};
/**
 * The requests a plain Cosmic server never answers (selling to a wanted request, asking for an item on WANTED, the
 * Offers row's buttons, buying from a Buy List, auctions, bids, buying an auction item now): with Server.Cosmic set
 * they aren't sent, and the screen answers itself as Voyage's server does.
 */
const COSMIC_UNANSWERED = { 3: { mode: 0x20, code: 0 }, 4: { mode: 0x38 }, 0x0B: { mode: 0x2E }, 0x0C: { mode: 0x36 }, 0x0D: { mode: 0x32 }, 0x12: { mode: 0x18, code: 0 }, 0x13: { mode: 0x18, code: 0 }, 0x14: { mode: 0x36 } };

const typeOf = (id) => Math.floor(id / 1000000);
/** Throwing stars and bullets are counted one by one, like equips: their quantity can't be split. */
const oneByOne = (id) => { const t = typeOf(id), k = Math.floor(id / 10000); return t < 2 || t > 4 || k === 207 || k === 233; };

export class MtsWin extends Win {
  constructor(mgr, d) {
    super(mgr, null, (UI_W - 800) >> 1, (UI_H - 600) >> 1);
    this.w = 800; this.h = 600; this.fixed = true; this.buttons = [];
    this.account = d.account || '';
    // a plain Cosmic server charges buyers 10% + 100 NX whatever it says here, and sends a fixed old date
    this.fee = config.cosmic ? { meso: d.mesoFee, pct: 10, flat: 100 } : { meso: d.mesoFee, pct: d.pct, flat: d.flat };
    this.hours = [d.minHours, d.maxHours];
    this.clockGap = config.cosmic || !d.serverTime ? (this.g.serverNow?.() ?? Date.now()) - Date.now() : ftMs(d.serverTime) - Date.now();
    this.cash = { nx: 0, mp: 0 };
    this.tab = FOR_SALE; this.type = 0; this.page = 0; this.total = 0; this.items = []; this.sortDir = 1; this.sortCol = 1;
    this.nys = []; this.trans = []; this.nysFirst = 0; this.transFirst = 0; this.nysSel = null; this.transSel = null;
    this.itab = 1; this.ifirst = { 1: 0, 2: 0, 3: 0, 4: 0 }; this.isel = null;
    this.search = { on: false, tab: 1, type: 0, by: 1, text: '' };
    this.pageBytes = [1, 0];
    this.overflowSaid = false;
    this.names = new Map(); this.sellable = new Map(); this.rowBtns = [];
    this.guide = { lines: [], first: 0 };
    this.busy = true;   // the first answer comes from the server on its own
    this.busyTimer = setTimeout(() => this.done(), 8000);
    this.ready = false;
    this.init();
  }
  onClose() { for (const f of [this.searchField]) f?.remove(); clearTimeout(this.busyTimer); }
  frames() { return []; }

  async init() {
    const a = this.mgr.assets;
    const [I, cs, guide] = await Promise.all([a.json('UI/ITC.img'), a.json('UI/CashShop.img'), a.json('UI/Npt_GuideLine.img')]);
    this.I = I;
    this.bg = I.Base.backgrnd;
    const B = this.mgr.B;
    await a.preload([this.bg, I.Base.Preview[0], ...allCanvases(I.Base.Tab2), ...allCanvases(I.Tab), ...allCanvases(I.Sell.Tab), ...allCanvases(I.MyPage.Tab),
      ...allCanvases(I.Sort), I.PicturePlate.HowTo, I.PicturePlate.HowTo1, I.Sell.backgrnd, I.MyPage.backgrnd, I.MyPage.backgrnd1,
      ...allCanvases(B.Tab7), ...allCanvases(B.ComboBox4), ...allCanvases(B.BtOK2), ...allCanvases(B.BtCancel2)]);
    // the search row: For Sale / Wanted / Auction, the category, by Character / Item, the text, SEARCH
    const colors = { back: '#eeeeee', hover: '#a5a198', frame: '#999999' };
    this.combos = [
      new ComboBox(this.mgr, B.ComboBox4, TABS_X + 7, TABS_Y + 55, 75, 20, ['For Sale', 'Wanted', 'Auction'], colors),
      new ComboBox(this.mgr, B.ComboBox4, TABS_X + 82, TABS_Y + 55, 75, 20, CATEGORIES, colors),
      new ComboBox(this.mgr, B.ComboBox4, TABS_X + 217, TABS_Y + 55, 75, 20, ['Character', 'Item'], colors),
    ];
    this.searchField = editBox(this, 163, 18, 100);
    this.searchField.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.doSearch(); });
    this.button(I.BtSearch, TABS_X + 462, TABS_Y + 55, () => this.doSearch());
    this.regBtn = this.button(I.Buy.BtRegistration, SUB_X + 422, SUB_Y + 5, () => this.openWantedSearch());
    this.cancelBtn = this.button(I.Sell.BtCancel, 159, 209, () => this.cancelSale());
    this.button(I.BtSell, 158, 425, () => this.sell(false));
    this.button(I.BtAuction, 193, 425, () => this.sell(true));
    this.button(I.BtCharge, BAR_X + 240, BAR_Y + 10, () => this.charge());
    this.button(I.BtCheck, BAR_X + 300, BAR_Y + 10, () => this.checkCash());
    this.button(cs.CSStatus.BtExit, BAR_X + 377, BAR_Y + 7, () => this.g.leaveCashShop());
    for (let k = 0; k < ROWS; k++) {
      const y = LIST_Y + 1 + k * ROW_H, x = LIST_X + 2;
      this.rowBtns.push({
        buy: this.button(I.Sell.BtBuy, x + 0xD9, y, () => this.rowAction(k, 0)), basket: this.button(I.Sell.BtShoppingBasket, x + 0xFC, y, () => this.rowAction(k, 1)),
        sellTo: this.button(I.Buy.BtSell, x + 0xD9, y, () => this.rowAction(k, 0)),
        bid: this.button(I.Auction.BtBid, x + 0xD9, y, () => this.rowAction(k, 0)), buyNow: this.button(I.Sell.BtBuy, x + 0xFC, y, () => this.rowAction(k, 1)),
        myBuy: this.button(I.MyPage.BtBuy, x + 0x1A9, y, () => this.rowAction(k, 0)),
        myDelete: this.button(I.MyPage.BtDelete, x + 0x1CC, y, () => this.rowAction(k, 1)), myCancel: this.button(I.MyPage.BtCancel, x + 0x1CC, y, () => this.rowAction(k, 1)),
      });
    }
    await a.preload(this.buttons.flatMap((b) => b.frames()));
    // GUIDE: the guide's lines, one after another, wrapped to the panel
    const scratch = document.createElement('canvas').getContext('2d');
    const text = Object.keys(guide?.NptGuide || {}).filter((k) => /^Text\d+$/.test(k)).sort().map((k) => String(guide.NptGuide[k])).join('');
    for (const para of text.replace(/\\r\\n|\r\n|\\n|\n/g, '\n').split('\n')) this.guide.lines.push(...(para.trim() ? wrapText(scratch, para, 460, 11) : ['']));
    // the character, standing in the preview
    const base = this.g.look;
    if (base) {
      const look = new CharacterLook(a, { skin: base.skin, face: base.faceId, hair: base.hairId, equips: [...base.equipIds], gender: this.g.stats?.gender ?? 0 });
      await look.load();
      await a.preload(lookCanvases(look, [look.standAction()]));
      this.look = look;
    }
    this.ready = true;
  }

  // ---------------------------------------------------------------- requests
  /** A request may go out when none is waiting; it then waits for its answer (8 s at most). */
  begin() {
    if (this.busy) return false;
    this.busy = true;
    clearTimeout(this.busyTimer);
    this.busyTimer = setTimeout(() => this.done(), 8000);
    return true;
  }
  done() { this.busy = false; clearTimeout(this.busyTimer); }
  /** Sends MTS_OPERATION `mode` (or, with Server.Cosmic and a request it never answers, answers it here). */
  send(mode, fn) {
    if (config.cosmic && COSMIC_UNANSWERED[mode]) { const e = { ...COSMIC_UNANSWERED[mode] }; setTimeout(() => this.result(e), 150); return; }
    fn(this.g.net);
  }
  listing(mode, rec) { this.send(mode, (n) => n?.mtsListing(mode, rec.id)); }
  /** A list page: the tab, type and page with the search (if one is on). */
  requestPage(tab, type, page) {
    if (!this.begin()) return;
    const s = this.search.on ? this.search : { by: 1, text: '' };
    this.g.net?.mtsPage(tab, type, page, this.pageBytes[0], this.pageBytes[1], s.by, s.text);
  }
  setTab(t) {
    if (!this.begin()) return;
    this.search.on = false;
    this.g.net?.mtsPage(t, 0, 0, 1, 1, 1, '');
  }
  /** Another sub-tab, or the sort header: the page again (the server keeps its own order). */
  setType(type, dir = 1, col = 1) {
    if (!this.begin()) return;
    const same = type === this.type, s = same && this.search.on ? this.search : { by: 1, text: '' };
    if (!same) this.search.on = false;
    this.g.net?.mtsPage(this.tab, type, 0, dir, col, s.by, s.text);
  }
  async doSearch() {
    const tab = this.combos[0].value + 1, type = this.combos[1].value, by = this.combos[2].value, text = this.searchField.value.trim();
    if (by === 0) {
      if (!text || await this.g.cursed?.(text)) { await this.mgr.notice('It cannot be used. Please check it again.'); this.searchField.focus(); return; }
    } else if (text.length <= 1) { await this.mgr.notice('Please enter more than 1 character.'); this.searchField.focus(); return; }
    this.search = { on: true, tab, type, by, text };
    this.searchField.value = text;
    this.g.net?.mtsSearch(tab, type, by, text);
  }
  charge() {
    if (!this.begin()) return;
    if (config.cosmic) { setTimeout(() => this.charged(), 0); return; }   // a plain Cosmic server has no answer to it
    this.g.net?.mtsCharge();
  }
  checkCash() { if (this.begin()) this.g.net?.mtsCheckCash(); }

  // ---------------------------------------------------------------- answers
  setCash(nx, mp) {
    if (nx < 0 || mp < 0) { this.mgr.notice('Due to an unknown error,\r\nthe request for Cash Shop has failed.'); this.g.leaveCashShop(); return; }
    this.cash = { nx, mp };
    this.done();
  }
  /** The Charge button's answer: there's nowhere to buy NX here. */
  charged() { this.done(); this.mgr.notice('Please visit the website to charge your account.'); }
  result(e) {
    const m = e.mode;
    if (ANSWERS.has(m) || ((m === 0x15 || m === 0x21) && e.answered)) this.done();
    const leave = () => this.g.leaveCashShop();
    switch (m) {
      case 0x15: case 0x17:
        this.total = e.total; this.items = e.items; this.tab = e.tab; this.type = e.type; this.page = e.page;
        if (m === 0x15) { this.sortDir = e.sortDir; this.sortCol = e.sortCol; }
        for (const r of e.items) this.nameOf(r.item.id);
        break;
      case 0x16: case 0x22: case 0x24: this.mgr.notice(reason(e.code)); if (e.code === 0x49) leave(); break;
      case 0x18: case 0x26: this.mgr.notice(reason(e.code)); break;
      case 0x28: this.mgr.notice(reason(e.code)); if (e.code === 0x41) leave(); break;
      case 0x1E:
        if (e.code === 0x3F || e.code === 0x44) { this.mgr.notice(reason(e.code)); leave(); } else if (e.code === 0x48) this.mgr.notice(`Limit to ${e.limit} units or less.`);
        else if ([0x42, 0x43, 0x47, 0x4F, 0x52, 0x53].includes(e.code)) this.mgr.notice(reason(e.code));
        break;
      case 0x20: this.mgr.notice(e.code === 0x50 ? 'The item is cancelled or sold out.' : e.code === 0x52 ? 'Throwing Stars are not tradable.' : 'Requesting the item for sale failed.'); break;
      case 0x21:
        this.trans = e.items; this.transSel = null; this.transFirst = Math.min(this.transFirst, Math.max(0, Math.ceil(this.trans.length / TRANS.cols) - TRANS.rows));
        for (const r of e.items) this.nameOf(r.item.id);
        if (!this.overflowSaid && e.hidden > 0) {
          this.overflowSaid = true;
          this.mgr.notice(`There are ${e.items.length + e.hidden} items in Transfer Inventory.\r\nOnly ${e.items.length} items can be shown on the screen.\r\n Please move items in the Transfer Inventory\r\nto your Item Inventory.`);
        }
        break;
      case 0x23: this.nys = e.items; this.nysSel = null; for (const r of e.items) this.nameOf(r.item.id); break;
      case 0x27: {
        // the item's inventory type and the slot it went to (a plain Cosmic server sends the quantity first)
        const type = config.cosmic ? (this.taking ? typeOf(this.taking.item.id) : 0) : e.invType;
        if (type >= 1 && type <= 4) { this.itab = type; const it = this.g.inventory?.[type]?.[e.slot]; this.isel = it ? { slot: e.slot, it } : null; }
        this.taking = null;
        this.mgr.notice('The item has been transferred.');
        break;
      }
      case 0x2D:
        if (!e.items.length) { this.mgr.notice('No item is registered for sale.'); break; }
        for (const r of e.items) this.nameOf(r.item.id);
        this.mgr.show(new MtsBuyListDlg(this, e.items));
        break;
      case 0x3D: if (e.nx >= 0 && e.listings > 0) this.mgr.notice(`The Listing period on [WANTED] items\r\nhas expired.\r\n${e.listings} items and ${e.nx} NX\r\nhave been returned to your MTS account`); break;
      case 0x3E:
        if (e.itemId > 0) {
          const d = new Date(ftMs(e.time)), when = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
          // the date first, then the item
          itemName(this.mgr.assets, e.itemId).then((n) => this.mgr.notice(`${when} of ${n || ''}\r\nis ${e.kind === 1 ? 'sold' : 'bought'} for ${e.value} NX.`));
        }
        break;
      default: if (SAY[m]) this.mgr.notice(SAY[m]);
    }
  }

  // ---------------------------------------------------------------- the player's actions
  /** The selected inventory item may be sold: no cash item, nothing quest-only, one-of-a-kind or untradable, and it never expires. */
  canSell(it) {
    if (!it || it.cash || it.cashId || BigInt(it.expiration ?? PERMANENT) < PERMANENT) return false;
    const known = this.sellable.get(it.id);
    if (known === undefined) {
      this.sellable.set(it.id, false);
      itemInfo(this.mgr.assets, it.id).then((info) => this.sellable.set(it.id, !(Number(info?.quest) || Number(info?.only) || Number(info?.cash) || Number(info?.tradeBlock))));
      return false;
    }
    return known;
  }
  sell(auction) {
    const sel = this.isel;
    if (!sel || !this.canSell(sel.it) || this.busy || sel.slot < 1) return;
    const Dlg = auction ? MtsAuctionDlg : MtsSellDlg;
    this.mgr.show(new Dlg(this, sel.it, (v) => {
      if (!v) return;
      if (v.price < PRICE_MIN || v.price > PRICE_MAX || (auction && (v.buyNow < PRICE_MIN || v.buyNow > PRICE_MAX))) { this.mgr.notice('Please enter the price\r\nof over 110 NX.'); return; }
      if (auction && v.price + v.step > v.buyNow) { this.mgr.notice('The Buy-Now price is lower\r\nthan the starting bid.'); return; }
      if (auction && (v.hours < this.hours[0] || v.hours > this.hours[1])) { this.mgr.notice('The auction can be set up 24~168 hrs\r\nprior to the auction in 1 hr increment.'); return; }
      if (!this.begin()) return;
      if (auction) this.send(0x12, (n) => n?.mtsAuction(sel.it, sel.slot, v.qty, v.price, v.buyNow, v.hours, v.step));
      else this.send(2, (n) => n?.mtsSell(sel.it, sel.slot, v.qty, v.price));
    }));
  }
  async cancelSale() {
    const r = this.nysSel;
    if (!r || this.busy || r.bids !== 0) return;
    if (!(await this.mgr.confirm('Are you sure you want to cancel the sale?'))) return;
    if (this.begin()) this.listing(7, r);
  }
  /** Transfer Inventory: a double-click takes the item home, if there's room for it. */
  takeHome(r) {
    if (!r || this.busy) return;
    const type = typeOf(r.item.id);
    if (type >= 1 && type <= 4) { this.itab = type; this.isel = null; }
    if (!this.hasRoom(type)) { this.mgr.notice('Your inventory is full.'); return; }
    if (!this.begin()) return;
    this.taking = r;
    this.listing(8, r);
  }
  hasRoom(type) {
    const inv = this.g.inventory?.[type] || {}, limit = this.g.inventory?.limits?.[type] || 24;
    for (let s = 1; s <= limit; s++) if (!inv[s]) return true;
    return false;
  }
  mine(r) { return (r.owner || '').toLowerCase() === (this.g.player?.name || '').toLowerCase(); }
  buyerPrice(p) { return Math.floor((p * (100 + this.fee.pct)) / 100) + this.fee.flat; }
  async rowAction(k, which) {
    const r = this.items[k];
    if (!r || r.id < 0) return;
    const own = 'The item you have registered\r\ncannot be in transaction.', ownBid = 'You cannot place a bid\r\non your own item.';
    const sure = () => this.mgr.confirm('Are you sure you want to buy this?');
    switch (this.tab === MY_PAGE ? `my${this.type}` : this.tab) {
      case FOR_SALE:
        if (this.mine(r)) { this.mgr.notice(own); return; }
        if (which === 0) { if (!this.busy && await sure() && this.begin()) this.listing(0x10, r); } else if (this.begin()) this.listing(9, r);
        break;
      case WANTED:
        if (this.mine(r)) { this.mgr.notice(own); return; }
        if (!this.busy) this.mgr.show(new MtsSellToWantedDlg(this, r));
        break;
      case AUCTION:
        if (this.mine(r)) { this.mgr.notice(ownBid); return; }
        if (which === 0) { if (!this.busy) this.mgr.show(new MtsBidDlg(this, r)); return; }
        if (!this.busy && await this.mgr.confirm(`Would you like to make a direct purchase\r\nof this item for ${this.buyerPrice(r.buyNow)}?`) && this.begin()) this.listing(0x14, r);
        break;
      case `my${CART}`:
        if (this.mine(r)) { this.mgr.notice(own); return; }
        if (which === 0) { if (!this.busy && await sure() && this.begin()) this.listing(0x11, r); } else if (this.begin()) this.listing(0x0A, r);
        break;
      case `my${OFFERS}`:
        if (this.begin()) this.listing(which === 0 ? 0x0B : 0x0D, r);
        break;
      default: break;
    }
  }
  openWantedSearch() { if (this.tab === WANTED) this.mgr.show(new MtsWantedSearchDlg(this)); }
  /** WANTED: ask for an item (the price form's answer). */
  askFor(itemId, v) {
    if (v.price < PRICE_MIN || v.price > PRICE_MAX) { this.mgr.notice('Please enter the price\r\nof over 110 NX.'); return false; }
    if (!this.begin()) return false;
    this.send(4, (n) => n?.mtsWanted(itemId, v.price, v.qty, v.comment));
    return true;
  }

  // ---------------------------------------------------------------- drawing
  nameOf(id) {
    if (!this.names.has(id)) { this.names.set(id, ''); itemName(this.mgr.assets, id).then((n) => this.names.set(id, n || '')); }
    return this.names.get(id);
  }
  now() { return Date.now() + this.clockGap; }
  body(ctx) {
    if (!this.ready) { this.text(ctx, 'Loading the MTS...', 400, 300, { align: 'center', color: '#fff', size: 12 }); return; }
    this.drawCharacter(ctx);
    this.drawGrid(ctx, NYS, this.nys, this.nysFirst, this.nysSel, (r) => r.item);
    this.drawGrid(ctx, TRANS, this.trans, this.transFirst, this.transSel, (r) => r.item);
    this.drawInventory(ctx);
    this.drawTabs(ctx);
    this.drawSubTabs(ctx);
    this.drawList(ctx);
    // NX, Maple Points, mesos
    [[this.cash.nx, 0, '#000'], [this.cash.mp, 21, '#ff2020'], [this.g.meso, 42, '#2000ff']]
      .forEach(([v, y, color]) => uiText(ctx, fmt(v), BAR_X + 190, BAR_Y + 3 + y, { color, size: 12, align: 'right' }));
    placeBox(this, this.searchField, TABS_X + 294, TABS_Y + 55);
    for (const c of this.combos) c.draw(ctx);
    this.regBtn.visible = this.tab === WANTED;
    this.cancelBtn.enabled = !!this.nysSel;
  }
  draw(ctx) {
    super.draw(ctx);
    if (!this.ready) return;
    ctx.save(); ctx.translate(this.x, this.y); for (const c of this.combos) c.drawList(ctx); ctx.restore();
  }
  drawCharacter(ctx) {
    const pv = this.mgr.image(this.I.Base.Preview[0]);
    if (pv) ctx.drawImage(pv, 23, 34);
    if (this.look) {
      ctx.save(); ctx.beginPath(); ctx.rect(23, 34, 213, 109); ctx.clip();
      // standing at the preview's left with its name tag under it, as the client shows it
      drawParts(ctx, this.mgr.assets, this.look.compose(this.look.standAction(), 0), 51, 123, false);
      nameTag(ctx, this.g.player?.name || '', 51, 125);
      ctx.restore();
    }
    uiText(ctx, maskId(this.account), 225, 151, { color: '#000', align: 'right' });
    uiText(ctx, this.g.player?.name || '', 225, 170, { color: '#000', align: 'right' });
  }
  selBox(ctx, x, y) { ctx.strokeStyle = 'rgba(16,48,204,0.67)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, 30, 30); ctx.lineWidth = 1; }
  drawGrid(ctx, G, list, first, sel, itemOf) {
    const m = this.mgr;
    for (let k = 0; k < G.cols * G.rows; k++) {
      const r = list[first * G.cols + k];
      if (!r) break;
      const it = itemOf(r), x = G.x + (k % G.cols) * SLOT, y = G.y + Math.floor(k / G.cols) * SLOT;
      m.drawIcon(ctx, m.icon(it.id), x, y, it.id);
      if (!oneByOne(it.id) && it.quantity > 1) m.count(ctx, it.quantity, x, y + 20);
      if (sel === r) this.selBox(ctx, x, y);
    }
    this.scrollbar(ctx, ...G.bar, first, Math.ceil(list.length / G.cols), G.rows);
  }
  drawInventory(ctx) {
    const m = this.mgr, inv = this.g.inventory?.[this.itab] || {}, limit = this.g.inventory?.limits?.[this.itab] || 24;
    this.itemTabs = drawItemTabs(ctx, m, this.I.Base.Tab2, this.itab - 1, 17, 449, 156);
    const first = this.ifirst[this.itab] * INV.cols;
    for (let k = 0; k < INV.cols * INV.rows; k++) {
      const slot = first + k + 1;
      if (slot > limit) break;
      const it = inv[slot];
      if (!it) continue;
      const x = INV.x + (k % INV.cols) * SLOT, y = INV.y + Math.floor(k / INV.cols) * SLOT;
      m.drawIcon(ctx, m.icon(it.id), x, y, it.id);
      if (this.itab !== 1 && it.quantity > 1) m.count(ctx, it.quantity, x, y + 20);
      if (!this.canSell(it)) { ctx.fillStyle = 'rgba(54,54,54,0.45)'; ctx.fillRect(x, y, 32, 32); }
      if (this.isel?.it === it) this.selBox(ctx, x, y);
    }
    if (this.isel && (this.g.inventory?.[this.itab]?.[this.isel.slot] !== this.isel.it || !this.canSell(this.isel.it))) this.isel = null;
    this.scrollbar(ctx, ...INV.bar, this.ifirst[this.itab], Math.ceil(limit / INV.cols), INV.rows);
  }
  drawTabs(ctx) {
    const t = this.mgr.image(this.I.Tab[this.tab]);
    if (t) ctx.drawImage(t, TABS_X, TABS_Y);
  }
  drawSubTabs(ctx) {
    const I = this.I, im = (n) => this.mgr.image(n);
    const art = this.tab === MY_PAGE ? im(I.MyPage.Tab[this.type]) : this.tab === GUIDE ? im(I.PicturePlate.HowTo) : im(I.Sell.Tab[this.type]);
    if (art) ctx.drawImage(art, SUB_X + (this.tab === GUIDE ? 4 : 0), SUB_Y);
    if (this.tab !== MY_PAGE && this.tab !== GUIDE) {
      const k = { 2: [0, 4], 4: [1, 375], 5: [2, 443] }[this.sortCol];
      const s = k && im(I.Sort[this.sortDir ? 'Pressed_Desc' : 'Pressed_Asc']?.[k[0]]);
      if (s) ctx.drawImage(s, SUB_X + k[1], SUB_Y + 24);
    }
  }
  drawList(ctx) {
    const I = this.I, im = (n) => this.mgr.image(n);
    const bgNode = this.tab === MY_PAGE ? (this.type < 2 ? I.MyPage.backgrnd : I.MyPage.backgrnd1) : this.tab === GUIDE ? I.PicturePlate.HowTo1 : I.Sell.backgrnd;
    const bg = im(bgNode);
    if (bg) ctx.drawImage(bg, LIST_X, LIST_Y);
    for (const set of this.rowBtns) for (const b of Object.values(set)) b.visible = false;
    if (this.tab === GUIDE) { this.drawGuide(ctx); return; }
    const x0 = LIST_X + 2;
    this.items.slice(0, ROWS).forEach((r, k) => {
      const y = LIST_Y + 1 + k * ROW_H, ty = y + 3, name = this.nameOf(r.item.id), qty = !oneByOne(r.item.id) && r.item.quantity > 1 ? `/${r.item.quantity}` : '';
      const set = this.rowBtns[k];
      if (this.tab === MY_PAGE) {
        const sub = this.type, wide = sub >= 2;
        if (wide) { const st = STATUS[sub][r.status]; if (st) uiText(ctx, st, x0 + 5, ty, { size: 12 }); }
        uiText(ctx, cut(ctx, name, 112), x0 + (wide ? 0x47 : 0x0A), ty, { size: 12 });
        const price = sub === HISTORY ? (r.status === 0 ? r.price : r.fee + r.price) : sub === MY_AUCTION ? r.fee + r.bid : r.fee + r.price;
        uiText(ctx, fmt(price) + qty, x0 + (wide ? 0x17C : 0x126), ty, { size: 12 });
        uiText(ctx, endDate(r.end), x0 + (wide ? 0x1BC : 0x165), ty, { size: 12 });
        if (sub === CART) { set.myBuy.visible = set.myDelete.visible = true; } else if (sub === OFFERS) { set.myBuy.visible = set.myCancel.visible = true; }
        return;
      }
      uiText(ctx, cut(ctx, name, 190), x0 + 11, ty, { size: 12 });
      const price = this.tab === FOR_SALE ? r.fee + r.price : this.tab === AUCTION ? r.fee + r.bid : r.price;
      uiText(ctx, fmt(price) + qty, x0 + 0x17A, ty, { size: 12 });
      const narrow = textWidth(ctx, r.seller, 12) < 81;
      uiText(ctx, r.seller, x0 + (narrow ? 0x125 : 0x123), ty + (narrow ? 0 : 2), { size: narrow ? 12 : 8 });
      uiText(ctx, endDate(r.end), x0 + 0x1BB, ty, { size: 12 });
      if (this.tab === FOR_SALE) set.buy.visible = set.basket.visible = true;
      else if (this.tab === WANTED) set.sellTo.visible = true;
      else if (this.tab === AUCTION) set.bid.visible = set.buyNow.visible = true;
    });
    this.drawPager(ctx);
  }
  /** The pages: "1".."N", ten at a time, the current one marked. */
  drawPager(ctx) {
    const pages = Math.max(1, Math.ceil(this.total / ROWS)), from = Math.floor(this.page / 10) * 10, to = Math.min(pages, from + 10);
    const n = to - from, w = 22, x0 = LIST_X + 206 - (n * w) / 2, y = LIST_Y + 328;
    this.pageHits = [];
    for (let p = from; p < to; p++) {
      const x = x0 + (p - from) * w, on = p === this.page;
      uiText(ctx, String(p + 1), x + w / 2, y, { size: 12, align: 'center', bold: on, color: on ? '#fff' : '#000' });
      this.pageHits.push([p, x, w - 2, y - 2]);
    }
  }
  drawGuide(ctx) {
    ctx.save(); ctx.beginPath(); ctx.rect(LIST_X + 10, LIST_Y + 7, 468, 318); ctx.clip();
    const lines = this.guide.lines, first = this.guide.first;
    for (let i = first; i < lines.length && (i - first) * 14 < 318; i++) uiText(ctx, lines[i], LIST_X + 10, LIST_Y + 7 + (i - first) * 14, { color: '#000', size: 11 });
    ctx.restore();
    this.scrollbar(ctx, LIST_X + 484, LIST_Y + 7, 318, first, lines.length, 22);
  }

  // ---------------------------------------------------------------- mouse
  hit(lx, ly) {
    const tx = lx - TABS_X, ty = ly - TABS_Y;
    if (ty > 18 && ty < 50) for (const [t, [l, r]] of Object.entries(TAB_HIT)) {
      const tab = Number(t), x = tab < this.tab ? l : r;
      if (tab !== this.tab && tx >= x && tx < x + 93) return { tab };
    }
    const sx = lx - SUB_X, sy = ly - SUB_Y;
    if (sx >= 0 && sx < 509 && sy >= 0 && sy < 48 && this.tab !== GUIDE) {
      if (sy < 23) {
        const edges = this.tab === MY_PAGE ? [75, 149, 222, 293] : [66, 129, 192, 255, 318], i = edges.findIndex((e) => sx < e);
        if (i >= 0) return { type: i };
      } else if (this.tab !== MY_PAGE) {
        const i = [3, 4, 291, 375, 443, 503].findIndex((e) => sx < e);
        if (i >= 0) return { sort: i };
      }
    }
    for (const [p, x, w, y] of this.pageHits || []) if (lx >= x && lx < x + w && ly >= y && ly < y + 16) return { page: p };
    const grid = (G, list, first) => {
      if (lx < G.x || ly < G.y) return undefined;
      const c = Math.floor((lx - G.x) / SLOT), r = Math.floor((ly - G.y) / SLOT);
      if (c >= G.cols || r >= G.rows || (lx - G.x) % SLOT > 31 || (ly - G.y) % SLOT > 31) return undefined;
      return list[(first + r) * G.cols + c] || null;
    };
    const n = grid(NYS, this.nys, this.nysFirst);
    if (n !== undefined) return { nys: n };
    const t = grid(TRANS, this.trans, this.transFirst);
    if (t !== undefined) return { trans: t };
    if (lx >= INV.x && ly >= INV.y) {
      const c = Math.floor((lx - INV.x) / SLOT), r = Math.floor((ly - INV.y) / SLOT);
      if (c < INV.cols && r < INV.rows && (lx - INV.x) % SLOT <= 31 && (ly - INV.y) % SLOT <= 31) {
        const slot = (this.ifirst[this.itab] + r) * INV.cols + c + 1, it = this.g.inventory?.[this.itab]?.[slot];
        return { inv: it ? { slot, it } : null };
      }
    }
    const i = (this.itemTabs || []).findIndex(([x, w, y]) => lx >= x && lx < x + w && ly >= y && ly < y + 21);
    if (i >= 0) return { itab: i + 1 };
    if (this.tab !== GUIDE && lx >= LIST_X + 7 && lx < LIST_X + 502 && ly >= LIST_Y + 6) {
      const k = Math.floor((ly - LIST_Y - 1) / ROW_H), dy = (ly - LIST_Y - 1) % ROW_H;
      if (k < ROWS && dy >= 5 && dy < 15 && this.items[k]) return { row: this.items[k] };
    }
    return null;
  }
  down(lx, ly) {
    if (!this.ready) return;
    for (const c of this.combos) {
      if (c.inList(lx, ly)) return;
      if (c.inBox(lx, ly)) { for (const o of this.combos) if (o !== c) o.open = false; c.toggle(); return; }
      c.open = false;
    }
    for (const [G, k, list] of [[NYS, 'nysFirst', this.nys], [TRANS, 'transFirst', this.trans]]) {
      const s = this.scrollClick(lx, ly, ...G.bar, this[k], Math.ceil(list.length / G.cols), G.rows);
      if (s !== null) { this[k] = s; return; }
    }
    const limit = this.g.inventory?.limits?.[this.itab] || 24;
    const is = this.scrollClick(lx, ly, ...INV.bar, this.ifirst[this.itab], Math.ceil(limit / INV.cols), INV.rows);
    if (is !== null) { this.ifirst[this.itab] = is; return; }
    if (this.tab === GUIDE) {
      const gs = this.scrollClick(lx, ly, LIST_X + 484, LIST_Y + 7, 318, this.guide.first, this.guide.lines.length, 22);
      if (gs !== null) { this.guide.first = gs; return; }
    }
    const h = this.hit(lx, ly);
    if (!h) return;
    if (h.tab !== undefined) { sfx.play('UI/Tab'); this.setTab(h.tab); return; }
    if (h.type !== undefined) { if (h.type !== this.type) this.setType(h.type); return; }
    if (h.sort !== undefined) {
      const col = h.sort, at = performance.now();
      if (col === 1 || col === 3 || (this.type === 0 && col !== 1) || at - (this.sortAt || 0) < 1000) return;
      this.sortAt = at;
      const dir = col === this.sortCol ? (this.sortDir ? 0 : 1) : this.sortDir;
      this.sortDir = dir; this.sortCol = col;
      this.setType(this.type, dir, col);
      return;
    }
    if (h.page !== undefined) { if (h.page !== this.page) { sfx.play('UI/BtMouseClick'); this.requestPage(this.tab, this.type, h.page); } return; }
    if (h.itab) { if (h.itab !== this.itab) { this.itab = h.itab; this.isel = null; sfx.play('UI/Tab'); } return; }
    if (h.nys !== undefined) { this.nysSel = h.nys; return; }
    if (h.trans !== undefined) { this.transSel = h.trans; return; }
    if (h.inv !== undefined) { this.isel = h.inv && this.canSell(h.inv.it) ? h.inv : null; }
  }
  move(lx, ly) { for (const c of this.combos || []) c.move(lx, ly); this.mouseAt = { x: lx, y: ly }; }
  up() {
    const { x, y } = this.mouseAt || { x: -1, y: -1 };
    for (const c of this.combos || []) if (c.inList(x, y)) c.pick(c.rowAt(y));
  }
  dblclick(lx, ly) {
    const h = this.ready && this.hit(lx, ly);
    if (!h) return;
    if (h.trans) this.takeHome(h.trans);
    else if (h.inv && this.canSell(h.inv.it)) { this.isel = h.inv; this.sell(false); }
  }
  wheel(dy) {
    const x = this.mgr.mouse.x - this.x, y = this.mgr.mouse.y - this.y, d = Math.sign(dy);
    const clamp = (v, rows, vis) => Math.max(0, Math.min(Math.max(0, rows - vis), v + d));
    if (x < 256 && y >= 200 && y < 310) this.nysFirst = clamp(this.nysFirst, Math.ceil(this.nys.length / NYS.cols), NYS.rows);
    else if (x < 256 && y >= 310 && y < 418) this.transFirst = clamp(this.transFirst, Math.ceil(this.trans.length / TRANS.cols), TRANS.rows);
    else if (x < 256 && y >= 418) this.ifirst[this.itab] = clamp(this.ifirst[this.itab], Math.ceil((this.g.inventory?.limits?.[this.itab] || 24) / INV.cols), INV.rows);
    else if (this.tab === GUIDE && x >= LIST_X && y >= LIST_Y) this.guide.first = clamp(this.guide.first, this.guide.lines.length, 22);
  }
  tooltip(lx, ly) {
    const h = this.ready && this.hit(lx, ly);
    if (!h) return null;
    const r = h.nys || h.trans || h.row;
    if (r) return { item: r.item };
    if (h.inv) return { item: h.inv.it };
    return null;
  }
}

/** Text cut to `width` px (Arial 12). */
function cut(ctx, t, width) {
  t = String(t || '');
  ctx.save(); ctx.font = '12px Arial, sans-serif';
  if (ctx.measureText(t).width > width) { while (t && ctx.measureText(`${t}..`).width > width) t = t.slice(0, -1); t += '..'; }
  ctx.restore();
  return t;
}
function textWidth(ctx, t, size) { ctx.save(); ctx.font = `${size}px Arial, sans-serif`; const w = ctx.measureText(String(t || '')).width; ctx.restore(); return w; }
/** A listing's end as month-day-year (two digits). */
function endDate(ft) {
  if (!ft) return '';
  const d = new Date(ftMs(ft));
  return `${d.getMonth() + 1}-${d.getDate()}-${String(d.getFullYear() % 100).padStart(2, '0')}`;
}
/** The Item Inventory's tabs (Basic.img's Tab5 with Base/Tab2's labels) across the strip under its title. */
function drawItemTabs(ctx, mgr, labels, selected, x0 = 17, y = 449, span = 156) {
  const T = mgr.B.Tab7, im = (n) => mgr.image(n), rects = [], count = 4;
  if (!T) return rects;
  const lw = im(T.left0)?.width || 4, mw = im(T.middle0)?.width || 9, rw = im(T.right0)?.width || 4, h = im(T.fill0)?.height || 20;
  const left = im(T[selected === 0 ? 'left1' : 'left0']);
  let x = x0;
  if (left) ctx.drawImage(left, x, y);
  x += lw;
  const width = Math.floor((span - lw - (count - 1) * mw - rw) / count);
  for (let i = 0; i < count; i++) {
    const on = i === selected, last = i === count - 1;
    const fill = im(T[on ? 'fill1' : 'fill0']);
    if (fill) ctx.drawImage(fill, x, y, width, fill.height);
    const edge = im(T[last ? (on ? 'right1' : 'right0') : `middle${on ? 1 : i + 1 === selected ? 2 : 0}`]);
    if (edge) ctx.drawImage(edge, x + width, y);
    const label = im(labels?.[on ? 'Enable' : 'Disable']?.[i]);
    if (label) ctx.drawImage(label, x + Math.trunc(width / 2) - Math.trunc(label.width / 2), y + Math.trunc(h / 2) - Math.trunc(label.height / 2));
    rects.push([x - Math.trunc(mw / 2), width + mw, y]);
    x += width + (last ? rw : mw);
  }
  return rects;
}
/** An item icon twice its size with its bottom-left corner at (x, y). */
function bigIcon(ctx, mgr, id, x, y) {
  const img = mgr.image(mgr.icon(id));
  if (!img) return;
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, x, y - img.height * 2, img.width * 2, img.height * 2); ctx.restore();
}
/** A number from an edit box, or NaN when it isn't only digits. */
const num = (f) => (/^\d+$/.test(f.value.trim()) ? Number(f.value.trim()) : NaN);

/** The base of the MTS dialogs: modal, its edit boxes (`fields`) kept over their places, OK and Cancel. */
class MtsDialog extends Win {
  constructor(shop, bg, w, h, x = (UI_W - w) >> 1, y = (UI_H - h) >> 1) {
    super(shop.mgr, bg, x, y);
    this.buttons = []; this.shop = shop; this.w = w; this.h = h; this.modal = true; this.fields = []; this.places = [];
  }
  field(x, y, w, h, max) { const f = editBox(this.shop, w, h, max); f.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.ok(); else if (e.key === 'Escape') this.close(); }); this.fields.push(f); this.places.push([x, y]); return f; }
  close(v = null) { if (this.answered) return; this.answered = true; for (const f of this.fields) f.remove(); this.mgr.close(this); this.done?.(v); }
  key(e) { if (e.key === 'Enter') this.ok(); else if (e.key === 'Escape') this.close(); }
  body(ctx) {
    this.fields.forEach((f, i) => placeBox(this, f, ...this.places[i]));
    if (!this.focused && this.fields[0]) { this.focused = true; setTimeout(() => this.fields[0].focus(), 0); }
  }
  /** The usual number checks: digits only, then within [lo, hi]. */
  async checkNum(f, lo, hi) {
    const v = num(f);
    if (Number.isNaN(v)) { await this.mgr.notice('Only numbers are allowed.'); f.focus(); return null; }
    if (v < lo) { await this.mgr.notice(`You may only enter a number \r\nequal to or higher than ${lo}.`); f.focus(); return null; }
    if (v > hi) { await this.mgr.notice(`You may only enter a number \r\nequal to or lower than ${hi}.`); f.focus(); return null; }
    return v;
  }
}

/** Selling at a fixed price (Sell/backgrnd1): LISTING PRICE, UNIT, then the listing fee and what buyers pay. */
class MtsSellDlg extends MtsDialog {
  constructor(shop, it, done) {
    super(shop, shop.I.Sell.backgrnd1, 266, 175);
    this.it = it; this.done = done;
    this.price = this.field(160, 41, 85, 16, 7);
    this.qty = this.field(160, 58, 85, 16, 3);
    if (oneByOne(it.id)) { this.qty.value = '1'; this.qty.el.disabled = true; }
    this.button(this.mgr.B.BtOK2, 159, 134, () => this.ok());
    this.button(this.mgr.B.BtCancel2, 209, 134, () => this.close());
  }
  async ok() {
    const qty = await this.checkNum(this.qty, 1, Math.max(1, this.it.quantity || 1));
    if (qty === null) return;
    const price = await this.checkNum(this.price, 1, 0x7fffffff);
    if (price === null) return;
    if ((this.shop.g.meso || 0) < this.shop.fee.meso) { await this.mgr.notice('You do not have enough mesos.'); return; }
    this.close({ price, qty });
  }
  body(ctx) {
    super.body(ctx);
    bigIcon(ctx, this.mgr, this.it.id, 20, 85);
    uiText(ctx, this.shop.nameOf(this.it.id), 93, 26, { size: 12 });
    uiText(ctx, `${fmt(this.shop.fee.meso)} mesos`, 245, 78, { size: 12, color: '#2000ff', align: 'right' });
    const p = num(this.price);
    if (p >= PRICE_MIN && p <= PRICE_MAX) uiText(ctx, fmt(this.shop.buyerPrice(p)), 243, 96, { size: 12, color: '#ff2020', bold: true, align: 'right' });
  }
}

/** Putting an item up for auction (Auction/backgrnd): hours, starting bid, bid increment, buy-now, units. */
class MtsAuctionDlg extends MtsDialog {
  constructor(shop, it, done) {
    super(shop, shop.I.Auction.backgrnd, 278, 247);
    this.it = it; this.done = done;
    this.hoursF = this.field(163, 41, 86, 16, 7);
    this.start = this.field(163, 59, 86, 16, 7);
    this.step = new ComboBox(this.mgr, this.mgr.B.ComboBox4, 164, 77, 87, 16, ['10', '100', '500', '1000'], { back: '#eeeeee', hover: '#a5a198', frame: '#999999' });
    this.buyNow = this.field(163, 95, 86, 16, 7);
    this.qty = this.field(163, 114, 86, 16, 3);
    if (oneByOne(it.id)) { this.qty.value = '1'; this.qty.el.disabled = true; }
    this.button(this.mgr.B.BtOK2, 159, 221, () => this.ok());
    this.button(this.mgr.B.BtCancel2, 209, 221, () => this.close());
  }
  async ok() {
    const qty = await this.checkNum(this.qty, 1, Math.max(1, this.it.quantity || 1));
    if (qty === null) return;
    const price = await this.checkNum(this.start, 1, PRICE_MAX);
    if (price === null) return;
    const buyNow = await this.checkNum(this.buyNow, 1, PRICE_MAX);
    if (buyNow === null) return;
    if ((this.shop.g.meso || 0) < this.shop.fee.meso) { await this.mgr.notice('You do not have enough mesos.'); return; }
    this.close({ price, buyNow, qty, hours: num(this.hoursF) || 0, step: [10, 100, 500, 1000][this.step.value] });
  }
  down(lx, ly) { const c = this.step; if (c.inList(lx, ly)) return; if (c.inBox(lx, ly)) { c.toggle(); return; } c.open = false; }
  move(lx, ly) { this.step.move(lx, ly); this.mouseAt = { x: lx, y: ly }; }
  up() { const { x, y } = this.mouseAt || {}; if (this.step.inList(x, y)) this.step.pick(this.step.rowAt(y)); }
  body(ctx) {
    super.body(ctx);
    bigIcon(ctx, this.mgr, this.it.id, 22, 123);
    uiText(ctx, this.shop.nameOf(this.it.id), 93, 22, { size: 12 });
    uiText(ctx, `${fmt(this.shop.fee.meso)} mesos`, 245, 135, { size: 12, color: '#2000ff', align: 'right' });
    const s = num(this.start), b = num(this.buyNow);
    if (s > 0) uiText(ctx, fmt(this.shop.buyerPrice(s)), 164, 168, { size: 12, color: '#ff2020', bold: true });
    if (b > 0) uiText(ctx, fmt(this.shop.buyerPrice(b)), 164, 188, { size: 12, color: '#ff2020', bold: true });
    this.step.draw(ctx);
  }
  draw(ctx) { super.draw(ctx); ctx.save(); ctx.translate(this.x, this.y); this.step.drawList(ctx); ctx.restore(); }
}

/** Bidding (Auction/backgrnd1): time left, bids so far, the highest bid, the increment (up / down), your total. */
class MtsBidDlg extends MtsDialog {
  constructor(shop, r) {
    super(shop, shop.I.Auction.backgrnd1, 290, 184);
    this.r = r; this.added = Math.max(1, r.step || 1);
    shop.mgr.assets.json('UI/UIWindow.img').then((W) => {
      const C = W?.Reset?.Common;
      if (C) { this.button(C.BtUP, 236, 97, () => this.bump(1)); this.button(C.BtDown, 250, 97, () => this.bump(-1)); }
    });
    this.button(this.mgr.B.BtOK2, 170, 156, () => this.ok());
    this.button(this.mgr.B.BtCancel2, 220, 156, () => this.close());
  }
  bump(d) {
    const s = Math.max(1, this.r.step || 1);
    if (d > 0 && this.r.bid + this.added + s <= this.r.buyNow) this.added += s;
    else if (d < 0 && this.added > s) this.added -= s;
  }
  total() { return this.shop.buyerPrice(this.r.bid + this.added); }
  async ok() {
    const shop = this.shop, r = this.r;
    if (shop.cash.nx < this.total()) { await this.mgr.notice("You don't have enough cash."); return; }
    this.close(true);
    if (r.bid + this.added < r.buyNow) { if (shop.begin()) shop.send(0x13, (n) => n?.mtsBid(r.id, r.bid, this.added)); return; }
    if (await this.mgr.confirm(`Would you like to make a direct purchase\r\nof this item for ${this.total()}?`) && shop.begin()) shop.listing(0x14, r);
  }
  body(ctx) {
    super.body(ctx);
    const r = this.r, left = Math.max(0, ftMs(r.end) - this.shop.now()), h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
    uiText(ctx, `${h} hr ${m} min`, 175, 45, { size: 12, color: '#000' });
    uiText(ctx, String(r.bids), 175, 64, { size: 12, color: '#2000ff' });
    uiText(ctx, fmt(r.fee + r.bid), 175, 81, { size: 12, color: '#000' });
    uiText(ctx, fmt(this.added), 175, 98, { size: 12, color: '#000' });
    uiText(ctx, fmt(this.total()), 175, 115, { size: 12, color: '#ff2020', bold: true });
    bigIcon(ctx, this.mgr, r.item.id, 22, 123);
    uiText(ctx, this.shop.nameOf(r.item.id), 93, 22, { size: 12 });
  }
}

/** A scrolling list of names in a Buy/backgrnd1 dialog: 21px rows at (15, 67), 207x174, its scrollbar at (229, 71). */
class MtsListDlg extends MtsDialog {
  constructor(shop) {
    super(shop, shop.I.Buy.backgrnd1, 266, 268);
    this.rows = []; this.first = 0; this.sel = -1;
    this.button(this.mgr.B.BtClose, 243, 12, () => this.close());
  }
  rowAt(lx, ly) { if (lx < 15 || lx >= 222 || ly < 67 || ly >= 241) return -1; const i = this.first + Math.floor((ly - 67) / 21); return i < this.rows.length ? i : -1; }
  down(lx, ly) {
    const s = this.scrollClick(lx, ly, 229, 71, 168, this.first, this.rows.length, 8);
    if (s !== null) { this.first = s; return; }
    const i = this.rowAt(lx, ly);
    if (i >= 0) this.sel = i;
  }
  wheel(dy) { this.first = Math.max(0, Math.min(Math.max(0, this.rows.length - 8), this.first + Math.sign(dy))); }
  dblclick(lx, ly) { const i = this.rowAt(lx, ly); if (i >= 0) this.pick(i); }
  tooltip(lx, ly) { const i = this.rowAt(lx, ly); return i >= 0 ? { item: { id: this.rows[i].id ?? this.rows[i].item?.id } } : null; }
  body(ctx) {
    super.body(ctx);
    ctx.save(); ctx.beginPath(); ctx.rect(15, 67, 207, 174); ctx.clip();
    for (let i = this.first; i < this.rows.length && (i - this.first) * 21 < 174; i++) {
      const y = 67 + (i - this.first) * 21 + 10;
      if (i === this.sel) { ctx.fillStyle = '#3a67aa'; ctx.fillRect(15, y - 3, 207, 21); }
      uiText(ctx, cut(ctx, this.label(this.rows[i]), 190), 25, y, { size: 12, color: i === this.sel ? '#fff' : '#000' });
    }
    ctx.restore();
    this.scrollbar(ctx, 229, 71, 168, this.first, this.rows.length, 8);
  }
}

/** WANTED: find the item to ask for (by category and name), then a double-click opens the price form. */
class MtsWantedSearchDlg extends MtsListDlg {
  constructor(shop) {
    super(shop);
    this.cat = new ComboBox(this.mgr, this.mgr.B.ComboBox4, 19, 46, 57, 18, ['All', ...CATEGORIES.slice(1)], { back: '#eeeeee', hover: '#a5a198', frame: '#999999' });
    this.name = this.field(74, 47, 135, 15, 20);
    this.button(shop.I.BtSearch, 212, 46, () => this.find());
  }
  label(r) { return r.name; }
  ok() { this.find(); }
  async find() {
    const text = this.name.value.trim().toLowerCase();
    if (!text) { await this.mgr.notice('Please enter more than 1 character.'); this.name.focus(); return; }
    const a = this.mgr.assets, cat = this.cat.value;
    const [eqp, use, ins, etc, except] = await Promise.all(['String/Eqp.img', 'String/Consume.img', 'String/Ins.img', 'String/Etc.img', 'Etc/NPT_exception.img'].map((p) => a.json(p).catch(() => null)));
    const banned = new Set(JSON.stringify(except || {}).match(/\d{7}/g)?.map(Number) || []);
    const found = [];
    const add = (node) => { for (const [k, v] of Object.entries(node || {})) { const id = Number(k); if (id && v?.name && String(v.name).toLowerCase().includes(text) && !banned.has(id) && (!cat || typeOf(id) === cat)) found.push({ id, name: String(v.name) }); } };
    if (!cat || cat === 1) for (const g of Object.values(eqp?.Eqp || {})) add(g);
    if (!cat || cat === 2) add(use);
    if (!cat || cat === 3) add(ins);
    if (!cat || cat === 4) add(etc?.Etc);
    const ok = [];
    for (const f of found.slice(0, 400)) {
      const info = await itemInfo(a, f.id);
      if (!(Number(info?.cash) || Number(info?.only) || Number(info?.tradeBlock) || Number(info?.notSale) || Number(info?.quest))) ok.push(f);
    }
    this.rows = ok; this.first = 0; this.sel = -1;
    if (!ok.length) this.mgr.notice('The search yielded 0 result.');
  }
  pick(i) {
    const f = this.rows[i];
    this.mgr.show(new MtsWantedPriceDlg(this.shop, f.id, (v) => { if (v && this.shop.askFor(f.id, v)) this.close(); }));
  }
  down(lx, ly) { const c = this.cat; if (c.inList(lx, ly)) return; if (c.inBox(lx, ly)) { c.toggle(); return; } c.open = false; super.down(lx, ly); }
  move(lx, ly) { this.cat.move(lx, ly); this.mouseAt = { x: lx, y: ly }; }
  up() { const { x, y } = this.mouseAt || {}; if (this.cat.inList(x, y)) this.cat.pick(this.cat.rowAt(y)); }
  body(ctx) { super.body(ctx); this.cat.draw(ctx); }
  draw(ctx) { super.draw(ctx); ctx.save(); ctx.translate(this.x, this.y); this.cat.drawList(ctx); ctx.restore(); }
}

/** WANTED's price form (Buy/backgrnd3): TOTAL PRICE, UNIT, a comment, and what the seller would receive. */
class MtsWantedPriceDlg extends MtsDialog {
  constructor(shop, id, done) {
    super(shop, shop.I.Buy.backgrnd3, 266, 225);
    this.id = id; this.done = done;
    this.price = this.field(160, 41, 85, 16, 7);
    this.qty = this.field(160, 58, 85, 16, 3);
    this.comment = this.field(27, 128, 214, 15, 99);
    this.button(this.mgr.B.BtOK2, 159, 165, () => this.ok());
    this.button(this.mgr.B.BtCancel2, 209, 165, () => this.close());
    shop.nameOf(id);
  }
  async ok() {
    const price = await this.checkNum(this.price, 1, PRICE_MAX);
    if (price === null) return;
    const qty = await this.checkNum(this.qty, 1, 999);
    if (qty === null) return;
    this.close({ price, qty, comment: this.comment.value });
  }
  body(ctx) {
    super.body(ctx);
    bigIcon(ctx, this.mgr, this.id, 20, 85);
    uiText(ctx, this.shop.nameOf(this.id), 93, 26, { size: 12 });
    const p = num(this.price), f = this.shop.fee;
    if (p > 0) uiText(ctx, fmt(p - Math.floor(((p - f.flat) * f.pct) / 100) - f.flat), 243, 78, { size: 12, color: '#ff2020', bold: true, align: 'right' });
  }
}

/** A wanted request's Buy List (the items others have for it): a double-click buys one. */
class MtsBuyListDlg extends MtsListDlg {
  constructor(shop, items) { super(shop); this.rows = items; }
  label(r) { return `${this.shop.nameOf(r.item.id)}  ${fmt(r.fee + r.price)}`; }
  ok() {}
  async pick(i) {
    const r = this.rows[i], shop = this.shop;
    if (shop.mine(r)) { this.mgr.notice('The item you have registered\r\ncannot be in transaction.'); return; }
    if (!(await this.mgr.confirm('Are you sure you want to buy this?'))) return;
    if (shop.begin()) shop.listing(0x0C, r);
    this.close();
  }
}

/**
 * Selling to someone's wanted request (Buy/Item/backgrnd, 202x302): your items in 4 x 6 cells of 32x32 at
 * x 21 + 36n, y 71 + 34n (the client's own cell math), the tabs preset to the wanted item's kind; a click selects
 * (the blue frame), a double-click offers. The tabs', the scrollbar's and the close box's places were lost and
 * are set by the art (the tabs on the strip above the cells).
 */
const OFFER_GRID = { x: 21, y: 71, dx: 36, dy: 34, bar: [166, 70, 202] };
class MtsSellToWantedDlg extends MtsDialog {
  constructor(shop, r) {
    super(shop, shop.I.Buy.Item.backgrnd, 202, 302);
    this.r = r; this.itab = Math.min(4, Math.max(1, typeOf(r.item.id))); this.first = 0; this.lastAt = 0; this.sel = 0;
    this.button(this.mgr.B.BtClose, 179, 6, () => this.close());
  }
  ok() {}
  slotAt(lx, ly) {
    const G = OFFER_GRID;
    if (lx < G.x || ly < G.y) return 0;
    const c = Math.floor((lx - G.x) / G.dx), r = Math.floor((ly - G.y) / G.dy);
    if (c >= 4 || r >= 6 || (lx - G.x) % G.dx > 31 || (ly - G.y) % G.dy > 31) return 0;
    return (this.first + r) * 4 + c + 1;
  }
  async dblclick(lx, ly) {
    const slot = this.slotAt(lx, ly), it = slot && this.shop.g.inventory?.[this.itab]?.[slot], shop = this.shop, r = this.r;
    if (!it || performance.now() - this.lastAt < 500) return;
    this.lastAt = performance.now();
    if (it.id !== r.item.id) return;
    if ((it.quantity || 1) < (r.item.quantity || 1)) { this.mgr.notice('Not enough number of items.\r\nPlease double-check.'); return; }
    if (shop.mine(r)) { this.mgr.notice('The item you have registered\r\ncannot be in transaction.'); return; }
    if (!(await this.mgr.confirm('Are you sure you want to sell this item?'))) return;
    if (shop.begin()) shop.send(3, (n) => n?.mtsSellWanted(this.itab, slot, it, r.id));
    this.close();
  }
  rows() { return Math.ceil((this.shop.g.inventory?.limits?.[this.itab] || 24) / 4); }
  wheel(dy) { this.first = Math.max(0, Math.min(this.rows() - 6, this.first + Math.sign(dy))); }
  down(lx, ly) {
    const s = this.scrollClick(lx, ly, ...OFFER_GRID.bar, this.first, this.rows(), 6);
    if (s !== null) { this.first = s; return; }
    const t = (this.tabs || []).findIndex(([x, w, y]) => lx >= x && lx < x + w && ly >= y && ly < y + 21);
    if (t >= 0 && t + 1 !== this.itab) { this.itab = t + 1; this.first = 0; this.sel = 0; sfx.play('UI/Tab'); }
  }
  move(lx, ly) { this.mouseAt = { x: lx, y: ly }; }
  up() { const { x, y } = this.mouseAt || {}, s = this.slotAt(x, y); if (s && this.shop.g.inventory?.[this.itab]?.[s]) this.sel = s; }
  tooltip(lx, ly) { const s = this.slotAt(lx, ly), it = s && this.shop.g.inventory?.[this.itab]?.[s]; return it ? { item: it } : null; }
  body(ctx) {
    super.body(ctx);
    const m = this.mgr, inv = this.shop.g.inventory?.[this.itab] || {};
    for (let k = 0; k < 24; k++) {
      const slot = this.first * 4 + k + 1, it = inv[slot];
      if (!it) continue;
      const x = OFFER_GRID.x + (k % 4) * OFFER_GRID.dx, y = OFFER_GRID.y + Math.floor(k / 4) * OFFER_GRID.dy;
      m.drawIcon(ctx, m.icon(it.id), x, y, it.id);
      if (this.itab !== 1 && it.quantity > 1) m.count(ctx, it.quantity, x, y + 20);
      if (it.id !== this.r.item.id) { ctx.fillStyle = 'rgba(54,54,54,0.45)'; ctx.fillRect(x, y, 32, 32); }
      if (slot === this.sel) { ctx.strokeStyle = 'rgba(16,48,204,0.67)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, 32, 32); ctx.lineWidth = 1; }
    }
    this.tabs = drawItemTabs(ctx, m, this.shop.I.Base.Tab2, this.itab - 1, 17, 45, 156);
    this.scrollbar(ctx, ...OFFER_GRID.bar, this.first, this.rows(), 6);
  }
}
