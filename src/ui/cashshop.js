import { CashGachaponWin } from './owl.js';
import { invType, itemName, itemIcon, itemInfo } from '../data.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { sfx } from '../audio.js';
import { pad } from '../assets.js';
import { PHYS } from '../physics.js';
import { ACTION } from '../keymap.js';
import { nameTag } from '../map.js';
import { EMOTES, setExpression, stepExpression } from '../game.js';
import { uiText, TextField, wrapText } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { UI_W, UI_H } from '../view.js';
import { config } from '../config.js';

/**
 * The Cash Shop (UI/CashShop.img), a full 800x600 screen. Its parts, by their top-left corner:
 *   preview (0,0), Cash Inventory (-1,318), Item Inventory (0,426), tabs (272,17), item list (275,95),
 *   SEARCH ITEM (690,97), Best Item (690,157), NX amounts and buttons (254,530).
 * Tabs are numbered by Etc/Category.img's Category: 1 EVENT, 2 EQUIP, 3 USE, 4 SET-UP, 5 ETC, 6 PET, 7 PACKAGE,
 * 8 MAIN (the how-to pictures), 9 WISH LIST, 10 search results. An SN's 1st digit is its tab, the 2nd-3rd its
 * sub-category; 8xxxxxxx SNs are meso items.
 */
const MAIN = 8, WISH = 9, SEARCH = 10;
/** CSTab/Tab/<n> per tab, and each tab's hit x (when left / right of the selected one), 51 wide, y 22-52. */
const TAB_IMG = (t) => (t === MAIN || t === SEARCH ? 1 : t === WISH ? 9 : t + 1);
const TAB_HIT = { 1: [57, 69], 2: [107, 119], 3: [157, 169], 4: [209, 220], 5: [260, 272], 6: [311, 323], 7: [362, 374], 8: [3, 3], 9: [451, 451] };
/** The sub-category links' text: black (hover white) on the light bars, white (hover black) on the dark ones. */
const DARK_BAR = new Set([5, 6, 7, 9]);
const TABS_X = 272, TABS_Y = 17, SUB_X = 280, SUB_Y = 76;
const LIST_X = 275, LIST_Y = 95, PER_PAGE = 10, PAGE_Y = 501;
const BEST_X = 690, BEST_Y = 157, BEST_ROW = 69;
const LOCKER = { x: 21, y: 349, cols: 6, rows: 2, bar: [228, 347, 67] };
const ITEMS = { x: 23, y: 481, cols: 4, rows: 3, bar: [160, 480, 102] };
const SLOT = 35;
const PREVIEW = { x: 24, y: 40, w: 212, h: 165 };
/** Preview backdrop tabs: a Basic.img/Tab4 strip at (141, 11), 115 wide - three 25px tabs at x 151 / 188 / 225. */
const BACKDROP_X = [151, 188, 225], BACKDROP_Y = 11;
/**
 * The preview's little map (UI/CashShopPreview.img): one foothold at y -125 from x -380 to -160 and a ladder at
 * x -229 from y -205 to -127. Map (0, 0) sits at (379, 258) in the 212x165 picture.
 */
const PV_MAP = { ox: 379, oy: 258, ground: -125, left: -372, right: -172, ladderX: -229, ladderTop: -205, ladderBottom: -127 };
const STICKERS = ['new', 'sale', 'hot', 'event'], STICKER_OFF = { new: 55, sale: 70, hot: 55, event: 63 };
/** Wallets: 1 NX Credit, 2 Maple Points, 4 NX Prepaid. */
const WALLET_KEY = { 1: 'credit', 2: 'maplePoint', 4: 'prepaid' };
const UNKNOWN_ERROR = 'Due to an unknown error,\nthe request for Cash Shop has failed.';
const ERRORS = {
  0xA3: 'Request timed out.\nPlease try again.', 0xA5: "You don't have enough cash.",
  0xA6: "You can't buy someone a cash item gift if you're under 14.", 0xA7: 'You have exceeded the allotted limit of price for gifts.',
  0xA8: 'You cannot send a gift to your own account. Please purchase it after logging in with the related character.',
  0xA9: "Please confirm whether the character's name is correct.", 0xAA: 'This item has a gender restriction. Please confirm the gender of the recipient.',
  0xAB: "The gift cannot be sent because the recipient's Inventory is full.", 0xAC: 'Please check and see if you have exceeded the number of cash items you can have.',
  0xAD: 'Please check and see if the name of the character is wrong, or if the item has gender restrictions.',
  0xB0: 'Please check and see if the coupon number is right.', 0xB1: 'You are disconnected from Cash Shop because you put wrong Coupon numbers three times.',
  0xB2: 'This coupon has expired.', 0xB3: 'This coupon was already used.',
  0xB7: 'This is the NX coupon number. Register your coupon at www.nexon.net.', 0xB8: 'Due to gender restrictions, the coupon is unavailable for use.',
  0xB9: "This coupon is only for regular items, and it's unavailable to give away as a gift.", 0xBA: 'This coupon is only for MapleStory, and it cannot be gifted to others.',
  0xBB: 'Please check if your inventory is full or not.', 0xBC: 'This item is only available for purchase by a user at the premium service internet cafe.',
  0xBD: 'You are sending a gift to an invalid recipient. Please check the character name and gender.', 0xBE: 'Please check the name of the receiver.',
  0xBF: 'Items are not available for purchase at this hour.', 0xC0: 'The item is out of stock, and therefore not available for sale.',
  0xC1: 'You have exceeded the spending limit of NX.', 0xC2: 'You do not have enough mesos.',
  0xC3: 'The Cash Shop is unavailable during the beta-test phase. We apologize for your inconvenience.', 0xC4: 'Check your birthday code and please try again.',
  0xC7: 'This coupon is only available to the users buying cash item for the first time.', 0xC8: 'You have already applied for this.',
  0xCD: 'You have reached the daily maximum purchase limit for the Cash Shop.', 0xD3: "This item can only be used 15 days after the account's registration.",
  0xB4: "This coupon can only be used at\nNexon-affiliated Internet Cafe's.\nPlease use the Nexon-affiliated Internet Cafe's.",
  0xB5: 'This coupon is a Nexon-affiliated Internet Cafe-only coupon,\nand it had already been used.',
  0xB6: 'This coupon is a Nexon-affiliated Internet Cafe-only coupon,\nand it had already been expired.',
  0xD0: 'You have exceeded the maximum number\nof usage per account\\for this account.\nPlease check the coupon for detail.',
  0xD2: 'The coupon system will be available soon.',
  0xD4: 'You do not have enough Gift Tokens \nin your account. Please charge your account \nwith Nexon Game Cards to receive \nGift Tokens to gift this item.',
  0xD5: 'Due to technical difficulties,\nthis item cannot be sent at this time.\nPlease try again.',
  0xD6: 'You may not gift items for \nit has been less than two weeks \nsince you first charged your account.',
  0xD7: 'Users with history of illegal activities\n may not gift items to others. Please make sure \nyour account is neither previously blocked, \nnor illegally charged with NX.',
  0xD8: 'Due to limitations, \nyou may not gift this item as this time. \nPlease try again later.',
  0xD9: 'You have exceeded the amount of time \nyou can gift items to other characters.',
  0xDA: 'This item cannot be gifted \ndue to technical difficulties. \nPlease try again later.',
  0xDB: 'You cannot transfer a character under level 20.', 0xDC: 'You cannot transfer a character \nto the same world it is currently in.',
  0xDD: 'You cannot transfer a character \ninto the new server world.', 0xDE: 'You may not transfer out of this \nworld at this time.',
  0xDF: 'You cannot transfer a character into \na world that has no empty character slots.',
  0xE0: 'The event has either ended or this item is not available for free testing.', 0xE6: 'This item cannot be purchased with MaplePoints.',
  0xE7: 'Sorry for inconvinence. please try again.', 0xE8: 'This item cannot be purchased by anyone under 7.', 0xE9: 'This item cannot be received by anyone under 7.',
};
/** The weapon types a cash weapon can have art for, in the client's order. */
const WEAPON_TYPES = [30, 31, 32, 33, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 39];
/** Items only NX Prepaid can pay for. */
/** NAME_TRANSFER / WORLD_TRANSFER refusals, by error code. */
const TRANSFER_ERRORS = {
  name: { 1: 'The name change is already submitted \ndue to the item purchase', 2: 'This applies to the limitations on the request.\nPlease check if you were recently banned \nwithin 3 months.',
    3: 'This applies to the limitations on the request.\nPlease check if you requested \nfor the name change within a month.' },
  world: { 1: 'Cannot find Character Information.', 2: 'You cannot transfer a character under level 20.',
    3: 'You cannot transfer a character if \nyour account has ever been blocked once.', 4: 'You cannot transfer a character that \nis currently married.',
    5: 'You cannot transfer a character that \nis currently a Guild leader.', 6: 'You cannot transfer a character if \nyour account has already requested for a transfer.',
    7: 'You cannot transfer a character that\n has already been transferred \nwithin the last 30 days.', 8: 'You have to quit Family \nto move to another world.' },
};
/** Couple rings (11120xx but 1112000) and friendship rings (11128x0 - 11128x2), bought for a partner. */
const isCoupleRing = (id) => Math.floor(id / 100) === 11120 && id !== 1112000;
const isFriendRing = (id) => Math.floor(id / 100) === 11128 && id % 10 < 3;
/** A pet accessory (1802xxx, not the Pet Collar): the one piece of pet equipment the preview pet can try on. */
const isPetAcc = (id) => Math.floor(id / 10000) === 180 && id !== 1802100;
const prepaidOnly = (id) => id === 5400000 || id === 5401000 || Math.floor(id / 10) === 520000 || Math.floor(id / 1000) === 549 || id === 5221001 || id === 5222000;
/** Items a character must reach a level to buy (BUY and RESERVE are greyed below it). */
const LEVEL_GATE = { 507: 11, 539: 11, 503: 16, 514: 16, 520: 16, 504: 7 };
const INV_SHORT = ['', 'Eqp', 'Use', 'Setup', 'Etc'];
const isMesoSN = (sn) => Math.floor(sn / 10000000) === 8;
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const priceText = (c) => (isMesoSN(c.SN) ? `${fmt(c.Price)}meso` : `${fmt(c.Price)} NX`) + (c.Count > 1 ? `(${c.Count})` : '');
/** The Nexon ID as shown: 2 letters, then a star, then a star and the rest from the 5th letter ("admin" -> "ad**n"). */
const maskId = (s) => (s || '').slice(0, 2) + (s.length > 2 ? '*' : '') + (s.length > 3 ? `*${s.slice(4)}` : '');
/** A canvas node's frames, following _uol links. */
const frameAt = (node, i) => { const f = node?.[i]; return f?._uol !== undefined ? node[f._uol] : f; };
/** The frame of an animated node for now. */
function animFrame(node) {
  const n = []; for (let i = 0; node?.[i] !== undefined; i++) n.push(frameAt(node, i));
  const total = n.reduce((t, f) => t + (Number(f?.delay) || 100), 0);
  if (!total) return null;
  let t = performance.now() % total, i = 0;
  while (i < n.length - 1 && t >= (Number(n[i]?.delay) || 100)) t -= Number(n[i++]?.delay) || 100;
  return n[i];
}
/** Clip text to a width, ending it with "..". */
function clipText(ctx, text, width, size = 12) {
  ctx.save(); ctx.font = `${size}px Arial, "Segoe UI", sans-serif`;
  let t = text;
  if (ctx.measureText(t).width > width) { while (t && ctx.measureText(`${t}..`).width > width) t = t.slice(0, -1); t += '..'; }
  ctx.restore();
  return t;
}

export class CashShopWin extends Win {
  constructor(mgr, d) {
    super(mgr, null, (UI_W - 800) >> 1, (UI_H - 600) >> 1);
    this.w = 800; this.h = 600; this.fixed = true; this.buttons = [];
    this.available = d.available !== 0; this.account = d.account || ''; this.bestTable = d.best || [];
    this.serverData = d; this.stock = d.stock || new Map();
    this.cash = { credit: 0, prepaid: 0, maplePoint: 0 };
    this.inv = []; this.wish = []; this.storageSlots = null;
    this.tab = 1; this.sub = 0; this.page = 0; this.search = [];
    this.itab = 1; this.cfirst = 0; this.ifirst = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; this.csel = null; this.isel = null;
    this.previewOn = true; this.backdrop = 0; this.worn = null; this.tried = new Map();
    this.av = { x: -320, y: PV_MAP.ground, vx: 0, vy: 0, ground: true, ladder: false, right: false, action: 'stand1', frame: 0, t: 0 };
    this.busy = false; this.queue = []; this.rawIcons = new Map();
    this.selCell = 0; this.focusBtn = null; this.navAt = 0; this.avChat = null;
    this.ready = false;
    this.onKey = (e) => this.keyDown(e);
    addEventListener('keydown', this.onKey);
    this.init();
  }
  onClose() { removeEventListener('keydown', this.onKey); this.chatField?.remove(); }
  get stats() { return this.g.stats || {}; }

  async init() {
    const a = this.mgr.assets;
    const [C, com, pkg, cats, special, slotItems] = await Promise.all([a.json('UI/CashShop.img'), a.json('Etc/Commodity.img'), a.json('Etc/CashPackage.img'),
      a.json('Etc/Category.img'), a.json('Item/Special/0910.img'), a.json('Item/Special/0911.img')]);
    this.C = C; this.pkg = pkg || {}; this.special = special || {}; this.slotItems = slotItems || {};
    this.buildCatalog(com || {}, cats || {});
    const job = this.stats.job || 0;
    this.bg = Math.floor(job / 1000) === 1 ? C.Base.backgrnd1 : Math.floor(job / 100) === 21 || job === 2000 ? C.Base.backgrnd2 : C.Base.backgrnd;
    await a.preload([this.bg, ...allCanvases(C.Base.Tab), ...allCanvases(C.Base.Tab2), ...allCanvases(C.Base.Preview), ...allCanvases(C.Base.PreviewOnOff),
      ...allCanvases(C.CSTab), C.CSList.Base, C.CSList.ItemIcon, ...allCanvases(C.CSEffect), ...allCanvases(C.CSIcon), ...allCanvases(C.GuideWords),
      ...allCanvases(C.CSDiscount), C.PicturePlate.HowTo, C.PicturePlate.HowToGift, C.PicturePlate.NoItem, ...allCanvases(C.CSNotice[0]),
      ...allCanvases(this.mgr.B.Tab5), ...allCanvases(this.mgr.B.CheckBox), ...allCanvases(this.mgr.B.BtOK2), ...allCanvases(this.mgr.B.BtCancel2)]);
    const L = C.CSList;
    this.cells = [];
    for (let i = 0; i < PER_PAGE; i++) {
      const { x, y } = this.cellAt(i);
      this.cells.push({
        buy: this.button(L.BtBuy, x + 80, y + 53, () => this.buy(this.cellItem(i))),
        gift: this.button(L.BtGift, x + 119, y + 53, () => this.gift(this.cellItem(i))),
        wish: this.button(L.BtReserve, x + 158, y + 53, () => this.addWish(this.cellItem(i))),
        remove: this.button(L.BtRemove, x + 158, y + 53, () => this.removeWish(this.cellItem(i))),
      });
      for (const b of Object.values(this.cells[i])) b.focusRing = true;
    }
    const A = C.CSChar;
    this.btBuyAvatar = this.button(A.BtBuyAvatar, 16, 237, () => this.buyWorn());
    this.button(A.BtDefaultAvatar, 101, 237, () => this.dress(null));
    this.button(A.BtTakeoffAvatar, 187, 237, () => this.dress([]));
    const I = C.CSInventory;
    this.slotBtns = [[I.BtExEquip, 1], [I.BtExConsume, 2], [I.BtExInstall, 3], [I.BtExEtc, 4], [I.BtExTrunk, 0]]
      .map(([n, type], k) => Object.assign(this.button(n, 176, 453 + 27 * k, () => this.addSlots(type)), { slotType: type, tip: () => this.slotTip(type) }));
    this.button(C.CSItemSearch.BtSearch, 690, 97, () => this.searchItems());
    const S = C.CSStatus;
    this.button(S.BtCharge, 502, 543, () => this.alert('Please visit the website to charge your account.'));
    this.button(S.BtCheck, 543, 543, () => this.checkCash());
    this.button(S.BtCoupon, 584, 543, () => this.enterCoupon());
    this.button(S.BtExit, 632, 545, () => this.g.leaveCashShop());
    await a.preload(this.buttons.flatMap((b) => b.frames()));
    // the preview's chat bar: what you say shows over the preview character only
    this.chatField = new TextField(this.mgr.game.statusBar.layer, 0, 0, 182, 15, { max: 70, color: '#000' });
    this.chatField.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatField.value.trim();
        if (t) this.avChat = { text: t, until: performance.now() + 5000 };
        this.chatField.value = '';
      } else if (e.key === 'Escape') this.chatField.el.blur();
    });
    this.dress(null);
    this.ready = true;
    // opened from the inventory's BtCashshop: straight to that slot expansion
    if (this.g.csPreselect) { this.jumpTo(this.g.csPreselect); this.g.csPreselect = 0; }
  }
  /** Shows the page holding an item (by SN) with it selected. */
  jumpTo(sn) {
    for (const [k, list] of this.groups) {
      const i = list.findIndex((c) => c.SN === sn);
      if (i < 0) continue;
      const [cat, sub] = k.split(':').map(Number);
      this.tab = cat; this.sub = sub; this.page = Math.floor(i / PER_PAGE); this.selCell = i % PER_PAGE; this.focusBtn = null;
      return;
    }
  }
  frames() { return []; }

  /**
   * The catalogue: Commodity entries (with the server's changes and discounts), grouped by (tab, sub-category)
   * from the SN and each group sorted on-sale first, then Priority (high first), then ItemId; on-sale meso items
   * go at a random place in a random group.
   */
  buildCatalog(com, cats) {
    const d = this.serverData, removed = new Set(d.removed || []);
    const bySN = new Map();
    for (const c of Object.values(com)) if (c?.SN && !removed.has(c.SN)) bySN.set(c.SN, { ...c });
    for (const m of d.mods || []) bySN.set(m.SN, { ...(bySN.get(m.SN) || {}), ...m, priceSet: m.Price !== undefined });
    this.bySN = bySN;
    this.subNames = new Map();
    for (const c of Object.values(cats)) {
      const cat = Number(c.Category), sub = Number(c.CategorySub);
      if (!this.subNames.has(cat)) this.subNames.set(cat, []);
      this.subNames.get(cat)[sub] = c.Name;
    }
    for (const { cat, sub, rate } of d.discounts || []) {
      for (const c of bySN.values()) {
        if (c.priceSet || Math.floor(c.SN / 10000000) % 10 !== cat || Math.floor(c.SN / 100000) % 100 !== sub) continue;
        c.OrigPrice = c.Price; c.Discount = rate; c.Price = Math.floor(((100 - rate) * c.Price) / 100);
      }
    }
    this.groups = new Map();
    const meso = [];
    for (const c of bySN.values()) {
      if (c.OnSale !== 1 || !c.ItemId) continue;
      if (isMesoSN(c.SN)) { meso.push(c); continue; }
      if (c.SN < 10000000 || c.SN >= 80000000) continue;
      const cat = Math.floor(c.SN / 10000000) % 10, sub = Math.floor(c.SN / 100000) % 100;
      if (!this.subNames.get(cat)?.[sub]) continue;
      const k = `${cat}:${sub}`;
      if (!this.groups.has(k)) this.groups.set(k, []);
      this.groups.get(k).push(c);
    }
    for (const list of this.groups.values()) list.sort((x, y) => (y.Priority || 0) - (x.Priority || 0) || x.ItemId - y.ItemId);
    const keys = [...this.groups.keys()];
    for (const c of meso) if (keys.length) { const list = this.groups.get(keys[Math.floor(Math.random() * keys.length)]); list.splice(Math.floor(Math.random() * (list.length + 1)), 0, c); }
  }

  // ---------------------------------------------------------------- server events
  setCash(c) {
    this.cash = c;
    this.busy = false; clearTimeout(this.busyTimer);
    if (this.giftRun) { this.nextGift(); return; }
    if (this.queue.length) { this.sendBuy(this.queue.shift(), true); return; }
    if (this.multiBuy) { this.multiBuy = false; this.alert('You have successfully made the purchase.'); }
    if (this.wishAfterBuy) {   // bought from the wish list: it comes off the list
      const sn = this.wishAfterBuy; this.wishAfterBuy = null;
      if (this.wish.includes(sn)) this.sendWish(this.wish.filter((s) => s !== sn), true);
    }
  }
  async openSurprise(box) {
    if (this.gachapon) return;
    const w = (this.gachapon = new CashGachaponWin(this.mgr, this, box));
    await this.mgr.assets.preload(w.frames());
    this.mgr.show(w);
  }
  /** CASHSHOP_CASH_ITEM_GACHAPON_RESULT: the box's count, the item into the locker, then the window shows it. */
  surprise(e) {
    if (e.failed) { this.alert('Please check and see if you have exceeded\r\nthe number of cash items you can have.'); return; }
    const box = this.inv.find((c) => c.cashId === e.box);
    if (box) { box.quantity = e.left; if (e.left <= 0) this.inv = this.inv.filter((c) => c !== box); }
    this.inv.push(e.item);
    if (this.gachapon && e.won) this.gachapon.won(e.won.itemId, e.won.count, e.won.jackpot);
  }
  setInventory(items, storageSlots) { this.inv = items; if (storageSlots != null) this.storageSlots = storageSlots; }
  setWish(sns, reply) {
    this.wish = sns;
    if (reply && !this.wishRemoving) this.alert('The item has been added to the wish list.');
    this.wishRemoving = false;
  }
  name(id) { return itemName(this.mgr.assets, id); }
  bought(item) {
    this.inv.push(item);
    this.showLockerEnd();
    if (this.multiBuy) return;
    sfx.play('UI/BuyShopItem');
    this.alert('You have successfully made the purchase.');
  }
  /** Gifts waiting for us: the server already moved them into the Cash Inventory. */
  async receivedGifts(gifts) {
    for (const g of gifts) {
      if (!this.inv.some((c) => String(c.cashId) === String(g.cashId))) this.inv.push(g);
      await this.alert(`You have received ${await this.name(g.itemId)} from ${g.from}.\n${g.message}`);
    }
  }
  /** A gift was sent: during the gift window's run it is counted for the summary, otherwise it says so. */
  async giftSent(g) {
    const name = await this.name(g.itemId), run = this.giftRun;
    if (run) { run.sent.push(g.to); run.total += g.price; run.name = name; return; }
    sfx.play('UI/BuyShopItem');
    this.alert(`${g.count} [ ${name} ] \nwas sent to ${g.to}. \n${g.price} NX Prepaid \nwere spent in the process.`);
  }
  boughtPackage(items, bonus) {
    this.inv.push(...items);
    this.showLockerEnd();
    sfx.play('UI/BuyShopItem');
    this.alert(bonus ? `Purchase successful. ${bonus} You have received MaplePoints.` : 'You have successfully made the purchase.');
  }
  async ring(r) {
    this.inv.push(r.item);
    this.showLockerEnd();
    sfx.play('UI/BuyShopItem');
    this.alert(`You have given '${r.to}'\n ${r.count} [ ${await this.name(r.itemId)} ].`);
  }
  mesoBought() { sfx.play('UI/BuyShopItem'); this.alert('You have successfully made the purchase.'); }
  coupon(c) {
    this.done();
    this.inv.push(...c.items);
    this.alert(`You have received ${c.items.length + c.got.length} item(s), ${fmt(c.maplePoints)} MaplePoints and ${fmt(c.mesos)} mesos using the coupon.`);
  }
  async expired(cashId) {
    const it = this.inv.find((c) => String(c.cashId) === String(cashId));
    this.inv = this.inv.filter((c) => c !== it);
    if (it) this.alert(`[${await this.name(it.itemId)}] has passed its expiration date and will be removed from your inventory.`);
  }
  /** After a purchase the locker scrolls to its new last item and selects it. */
  showLockerEnd() {
    const rows = Math.ceil(this.inv.length / LOCKER.cols);
    this.cfirst = Math.max(0, rows - LOCKER.rows);
    this.csel = this.inv[this.inv.length - 1] || null;
  }
  setStock(sn, left) { if (left <= 0) this.stock.set(sn, 1); else this.stock.delete(sn); }
  /** A result that isn't followed by the NX amounts frees the shop itself. */
  done() { this.busy = false; clearTimeout(this.busyTimer); }
  taken(pos, item) {
    this.done();
    const it = { ...item, pos };
    this.inv = this.inv.filter((c) => String(c.cashId) !== String(item.cashId));
    this.csel = null;
    const inv = this.g.inventory?.[invType(item.id)];
    if (inv) inv[pos] = it;
    this.g.newItem = { id: item.id, pos };   // marked new in the inventory
  }
  put(item) {
    this.done();
    this.inv.push(item);
    this.isel = null;
    const inv = this.g.inventory?.[invType(item.itemId)];
    if (inv) for (const [pos, it] of Object.entries(inv)) if (String(it.cashId) === String(item.cashId)) delete inv[pos];
  }
  slots(kind, n, type) {
    if (kind === 'inventory' && this.g.inventory?.limits) this.g.inventory.limits[type] = n;
    if (kind === 'storage') this.storageSlots = n;
    this.alert(kind === 'character' ? 'You have added a new character slot.' : 'You have added slots to your item inventory.');
  }
  error(reason, op, sn) {
    this.busy = false; this.queue = []; clearTimeout(this.busyTimer);
    // a failed gift in the gift window's run goes on to the next recipient (the server may answer with 0x5C)
    if (this.giftRun && (op === 0x5F || op === 0x5C)) { this.alert(ERRORS[reason] || UNKNOWN_ERROR); this.nextGift(); return; }
    if (this.multiBuy) { this.multiBuy = false; this.alert('The purchase has failed.'); return; }
    if (sn && (reason === 0xBF || reason === 0xC0)) this.stock.set(sn, reason === 0xC0 ? 1 : 2);
    const leave = reason === 0xA2 || reason === 0xA3 || reason === 0xA4 || reason === 0xB1 || op === 0x4C || op === 0x4E || op === 0x50;
    this.alert(ERRORS[reason] || UNKNOWN_ERROR).then(() => { if (leave) this.g.leaveCashShop(); });
  }

  // ---------------------------------------------------------------- catalogue
  /** Item/Special/MaplePoint.img/<points>/icon (null until loaded). */
  maplePointIcon(points) {
    if (this.mpImg === undefined) {
      this.mpImg = null;
      const a = this.g.assets;
      a.json('Item/Special/MaplePoint.img').then(async (j) => { await a.preload(Object.values(j || {}).map((e) => e?.icon).filter(Boolean)); this.mpImg = j || {}; }).catch(() => {});
    }
    return this.mpImg?.[points]?.icon || null;
  }
  /** A package's contents (from the server's change, or Etc/CashPackage.img), by SN. */
  contents(c) { return (c.Package || Object.values(this.pkg[c.ItemId]?.SN || {})).map((sn) => this.bySN.get(sn) || { SN: sn, ItemId: 0 }); }
  isPackage(c) { return Math.floor(c.ItemId / 10000) === 910; }
  nameOf(c) {
    if (this.isPackage(c)) {
      const own = this.special[c.ItemId]?.name;
      if (own && /^[\x20-\x7e]+$/.test(own)) return own;
      const items = this.contents(c), first = items[0] && this.mgr.itemName(items[0].ItemId);
      return first ? `${first}${items.length > 1 ? ` + ${items.length - 1} more` : ''}` : 'Package';
    }
    return this.mgr.itemName(c.ItemId) || '';
  }
  /** The commodity's gender: its own, or for "either" (2) the equip's (or a package's first equip's). */
  genderOf(c) {
    if (c.Gender === 0 || c.Gender === 1) return c.Gender;
    if (c.Gender !== 2) return -1;
    const id = this.isPackage(c) ? this.contents(c).find((x) => invType(x.ItemId) === 1)?.ItemId : c.ItemId;
    if (!id || invType(id) !== 1) return -1;
    const g = Math.floor(id / 1000) % 10;
    return g === 0 || g === 1 ? g : -1;
  }
  /** Which of BUY / GIFT / RESERVE a cell greys out. */
  rules(c) {
    const r = { buy: true, gift: true, wish: true }, id = c.ItemId, k = Math.floor(id / 10000), st = this.stats;
    const g = this.genderOf(c);
    if (g >= 0 && g !== (st.gender ?? 0)) r.buy = r.wish = false;
    if ((id >= 1112001 && id <= 1112099) || (Math.floor(id / 100) === 11128 && id % 10 < 3)) r.gift = false;
    if (id === 5400000 || id === 5401000 || id === 5222000) r.gift = false;
    if (isMesoSN(c.SN) || !c.Price) r.gift = r.wish = false;
    if (LEVEL_GATE[k] && (st.level || 0) < LEVEL_GATE[k]) r.buy = r.wish = false;
    if (k === 911 || Math.floor(id / 1000) === 5430 || k === 555) r.gift = false;
    if (this.stock.get(c.SN)) r.buy = r.gift = false;
    if (c.OnSale !== 1) r.buy = r.gift = false;
    return r;
  }
  subs(tab = this.tab) { return this.subNames.get(tab) || []; }
  list() {
    if (this.tab === WISH) return this.wish.map((sn) => this.bySN.get(sn)).filter(Boolean);
    if (this.tab === SEARCH) return this.search;
    if (this.tab === MAIN) return [];
    return this.groups.get(`${this.tab}:${this.sub}`) || [];
  }
  pages() { return Math.ceil(this.list().length / PER_PAGE); }
  cellAt(i) { return { x: LIST_X + 2 + 206 * (i % 2), y: LIST_Y + 2 + 81 * Math.floor(i / 2) }; }
  cellItem(i) { return this.list()[this.page * PER_PAGE + i] || null; }
  setTab(t, sub = 0) {
    if (t === this.tab && sub === this.sub) return;
    if (t !== this.tab) sfx.play('UI/Tab');
    this.tab = t; this.sub = sub; this.page = 0; this.selCell = 0; this.focusBtn = null;
  }
  setPage(p) { const n = this.pages(); if (n) { this.page = ((p % n) + n) % n; this.selCell = 0; this.focusBtn = null; } }
  /** Best Item: 5 per tab and gender (the wish list and search use EVENT's), an off-sale SN standing in for an on-sale twin. */
  bestItems() {
    const tab = this.tab === WISH || this.tab === SEARCH ? 1 : this.tab, g = this.stats.gender ? 1 : 0, out = [];
    for (let i = 0; i < 5; i++) {
      let c = this.bySN.get(this.bestTable[(tab * 2 + g) * 5 + i]);
      if (c && c.OnSale !== 1) c = [...this.bySN.values()].find((x) => x.OnSale === 1 && x.ItemId === c.ItemId && x.Count === c.Count && x.Period === c.Period) || null;
      out.push(c || null);
    }
    return out;
  }
  /** Locker and inventory icons: the raw icon (2x in the list). */
  rawIcon(id) {
    if (!this.rawIcons.has(id)) {
      this.rawIcons.set(id, null);
      itemIcon(this.mgr.assets, id, true).then(async (n) => { if (n) { await this.mgr.assets.preload([n]); this.rawIcons.set(id, n); } });
    }
    return this.rawIcons.get(id);
  }

  // ---------------------------------------------------------------- requests
  /** One request at a time: the NX amounts arriving (or a failure) frees the shop for the next. */
  begin() {
    if (this.busy || !this.available) { if (!this.available) this.alert(ERRORS[0xC3]); return false; }
    this.busy = true;
    clearTimeout(this.busyTimer);
    this.busyTimer = setTimeout(() => { this.busy = false; }, 8000);
    return true;
  }
  checkCash() { if (this.begin()) this.g.net?.checkCash(); }
  /** Wallets that can pay `price` (a free item only from Maple Points), as a 1 / 2 / 4 mask. */
  walletsFor(price, prepaid = false) {
    let mask = 0;
    for (const [bit, key] of Object.entries(WALLET_KEY)) if ((this.cash[key] || 0) >= price) mask |= Number(bit);
    if (!price) mask &= 2;
    if (prepaid) mask &= 4;
    return mask;
  }
  async buy(c) {
    if (!c || this.busy) return;
    if (isCoupleRing(c.ItemId) || isFriendRing(c.ItemId)) { this.buyRing(c); return; }
    if (c.ItemId === 5400000 || c.ItemId === 5401000) { this.buyTransfer(c, c.ItemId === 5400000 ? 'name' : 'world'); return; }
    if (isMesoSN(c.SN)) {
      if ((this.g.meso || 0) < c.Price) { this.alert('You do not have enough mesos.'); return; }
      const ok = await this.dialog({ mode: 0, items: [c], text: 'Are you sure you want to buy this item?', wallets: 0 });
      if (ok && this.begin()) this.g.net?.csBuy(0, c.SN, c.ItemId);
      return;
    }
    const prepaid = prepaidOnly(c.ItemId), mask = this.walletsFor(c.Price, prepaid);
    if (!mask) { this.alert(prepaid ? "You don't have enough NX Prepaid" : "You don't have enough cash."); return; }
    if (c.ItemId === 1802019 && !(await this.mgr.confirm('Only the Rudolph pet can equip this item.'))) return;
    if (this.owns(c)) {
      if (!c.Price) { this.alert('You may not purchase the item since you already have it.'); return; }
      if (!(await this.alert('You already have the item(s) selected. Are\nyou sure you want to buy the item(s) again?', true))) return;
    }
    const warn = await this.buyWarning(c);
    if (warn && !(await this.alert(warn, true))) return;
    const wallet = await this.dialog({ mode: 0, items: [c], text: 'Are you sure you want to buy this item?', wallets: mask });
    if (!wallet) return;
    if (this.tab === WISH) this.wishAfterBuy = c.SN;
    this.sendBuy({ c, wallet });
  }
  /** Your pets out, by the character's pet slots up to the first empty one: their item ids and their own names. */
  petsOut() {
    const inv = Object.values(this.g.inventory?.[5] || {}), out = [];
    for (const sn of this.stats.pets || []) {
      const it = sn && BigInt(sn) !== 0n && inv.find((i) => i.pet && BigInt(i.cashId ?? 0) === BigInt(sn));
      if (!it) break;
      out.push({ id: it.id, name: it.pet.name || this.mgr.itemName(it.id) || '' });
    }
    return out;
  }
  /**
   * The warning before buying (for a package, its first item with one), or null, checked in the client's order:
   * - pet food (524) / pet skill items (519): no pet out, or the names of the pets out it isn't for (its spec list);
   * - the Scissors of Karma (552): nothing you have takes them (tradeAvailable and not unlocked already);
   * - an equip: your job (reqJob's bit for your class; a beginner only passes with no reqJob), level, fame, a cash
   *   weapon your weapon's type has no art in, a pet accessory (180: no pet out, or a pet out it has no art for, with
   *   two or more out the names aren't given), a mount or saddle (190 / 191) without your class's Monster Riding.
   */
  async buyWarning(c) {
    const ids = this.isPackage(c) ? this.contents(c).map((x) => x.ItemId).filter(Boolean) : [c.ItemId];
    const pets = this.petsOut(), a = this.mgr.assets, s = this.stats;
    const unfit = (fits) => pets.filter((p) => !fits(p)).map((p) => `${p.name} `).join('');
    const sure = '\nAre you sure you want to buy the item?';
    for (const id of ids) {
      const cat = Math.floor(id / 10000);
      if (cat === 552) {
        const inv = this.g.inventory || {};
        const items = [1, 2, 3, 4, 5].flatMap((t) => Object.values(inv[t] || {})).concat(Object.values(inv.equipped || {}));
        let any = false;
        for (const it of items) {
          if (!it?.id || (it.flag || 0) & (invType(it.id) === 1 ? 0x10 : 0x02)) continue;
          if (Number((await itemInfo(a, it.id))?.tradeAvailable)) { any = true; break; }
        }
        if (!any) return 'You currently do not have any items that\ncan use the Scissors of Karma.\nWould you still like to purchase it?';
        continue;
      }
      if (Math.floor(id / 1000000) === 1) {
        const info = (await itemInfo(a, id)) || {}, job = s.job || 0, cls = Math.floor((job % 1000) / 100), req = Number(info.reqJob) || 0;
        if (req && !(cls && req & (1 << (cls - 1)))) return `Your job limit does not allow\nyou to use this item. ${sure}`;
        if ((s.level || 0) < (Number(info.reqLevel) || 0)) return `Your level limit does not allow\nyou to use this item.${sure}`;
        if (Number(info.reqPOP) && (s.fame || 0) < Number(info.reqPOP)) return `Your fame limit does not allow\nyou to use this item.${sure}`;
        const weapon = this.g.inventory?.equipped?.[-11]?.id;
        if (Math.floor(id / 100000) === 17 && weapon) {
          const type = Math.floor(weapon / 10000) % 100, art = await a.json(`Character/Weapon/${pad(id, 8)}.img`);
          if (!WEAPON_TYPES.includes(type) || !art?.[type]) return 'You may not use this item with\nthe weapon you are equipped with.\nWill you continue to make the purchase?';
        }
      }
      if (cat === 190 || cat === 191) {
        const job = s.job || 0, base = Math.floor(job / 100) === 22 || job === 2001 ? job : Math.floor(job / 1000) * 1000;
        if (!(this.g.skills?.level(base * 10000 + 1004) > 0)) return 'This is an item that cannot be used\nif you do not have the Monster\nRiding skill. Would you\nstill like to purchase it?';
      }
      if (cat === 519 || cat === 524) {
        if (!pets.length) return 'This item cannot be used without a pet, and\nthis item cannot be used on a deceased pet.\nAre you sure you want to make the purchase?';
        const spec = cat === 524 ? (await a.json('Item/Cash/0524.img'))?.[pad(id, 8)]?.spec : null, ok = new Set(Object.values(spec || {}).map(Number));
        const names = unfit((p) => !!spec && ok.has(p.id));
        if (names) return `${names}\nThis item cannot be used by the\npet you're currently raising.\nAre you sure you want to make the purchase?`;
      } else if (cat === 180) {
        if (!pets.length) return 'Only pets are allowed to wear this item.\nAre you sure you want to purchase this item?';
        const art = await a.json(`Character/PetEquip/${pad(id, 8)}.img`);
        const fits = new Set(Object.keys(art || {}).filter((k) => Math.floor(k / 10000) === 500).map((k) => k % 1000));
        const names = unfit((p) => Math.floor(p.id / 10000) === 500 && fits.has(p.id % 1000));
        if (names) {
          return pets.length >= 2 ? 'One or more of your pets cannot equip\nthis item.\nContinue with purchase?'
            : `${names}\nThe current pet you have\ncannot wear this item.\nAre you sure you want to purchase this item?`;
        }
      }
    }
    return null;
  }
  /** Already in the Cash Inventory or the item inventory (a package: any of its items). */
  owns(c) {
    const ids = new Set(this.isPackage(c) ? this.contents(c).map((x) => x.ItemId) : [c.ItemId]);
    if (this.inv.some((it) => ids.has(it.itemId))) return true;
    const inv = this.g.inventory || {};
    for (const t of [1, 2, 3, 4, 5]) if (Object.values(inv[t] || {}).some((it) => ids.has(it.id))) return true;
    return Object.values(inv.equipped || {}).some((it) => ids.has(it.id));
  }
  /** A Cash Shop message box (CSNotice/4): OK, or OK / CANCEL. */
  alert(text, cancel = false) { return new Promise((done) => this.mgr.show(new CsAlert(this, text, cancel, done))); }
  sendBuy({ c, wallet }, queued = false) {
    if (!queued && !this.begin()) return;
    if (queued) { this.busy = true; clearTimeout(this.busyTimer); this.busyTimer = setTimeout(() => { this.busy = false; }, 8000); }
    this.g.net?.csBuy(wallet, c.SN, c.ItemId);
  }
  /** The birthday code (8 digits), or null when cancelled or mistyped (a mistype says so). */
  async askBirthday() {
    if (config.skipBirthday) return config.birthdayCode;
    const b = await this.mgr.askText('For the sake of privacy,\nplease enter your 8-digit birthday code.\nex) year/month/day -> 19820911', '', { max: 8 });
    if (!b) return null;
    if (!/^\d{8}$/.test(b)) { this.alert(ERRORS[0xC4]); return null; }
    return Number(b);
  }
  /**
   * A couple or friendship ring is bought for a partner: the birthday code, NX Credit or NX Prepaid, the partner's
   * name and a message (CSNotice/2), then the purchase dialog asks to confirm.
   */
  async buyRing(c) {
    if (!this.available) { this.alert(ERRORS[0xC3]); return; }
    const birthday = await this.askBirthday();
    if (birthday === null) return;
    const mask = (this.cash.credit >= c.Price ? 1 : 0) | (this.cash.prepaid >= c.Price ? 4 : 0);
    if (!mask) { this.alert("You don't have enough cash."); return; }
    const p = await new Promise((done) => this.mgr.show(new CsPartnerDialog(this, done)));
    if (!p) return;
    const text = `${this.mgr.itemName(c.ItemId) || ''} (${c.Price} NX)\nWill you buy this item as a gift for\n'${p.to}'?`;
    const wallet = await this.dialog({ mode: 2, items: [c], text, wallets: mask });
    if (!wallet || !this.begin()) return;
    if (this.tab === WISH) this.wishAfterBuy = c.SN;
    this.g.net?.csBuyRing(isCoupleRing(c.ItemId) ? 0x1D : 0x23, birthday, wallet, c.SN, p.to, p.message);
  }
  /**
   * GIFT: paid from NX Prepaid. The birthday code, a confirm, then the gift window (CSGift) for one or more
   * recipients ("a;b;c") and a message; several recipients are confirmed, then the purchase dialog. One 0x04 goes
   * out per recipient, the next after the NX amounts (or a failure) come back, and a summary ends it.
   */
  async gift(c) {
    if (!c) return;
    if (!this.available) { this.alert(ERRORS[0xC3]); return; }
    if (this.busy || !c.Price) return;
    if ((this.cash.prepaid || 0) < c.Price) { this.alert("You don't have enough NX Prepaid"); return; }
    const birthday = await this.askBirthday();
    if (birthday === null) return;
    const name = this.mgr.itemName(c.ItemId) || '';
    if (!(await this.alert(`Would you like to gift this item to someone?\n${c.Count > 1 ? `${c.Count} ` : ''}[ ${name} ]`, true))) return;
    for (;;) {
      const r = await new Promise((done) => this.mgr.show(new CsGiftDialog(this, done)));
      if (!r) { this.alert('Not ready to gift items? \nPlease come back later.'); return; }
      const total = r.to.length * c.Price;
      if (total > (this.cash.prepaid || 0)) { this.alert("You don't have enough cash."); return; }
      if (r.to.length >= 2 && !(await this.alert(`Do you want to give gifts to ${r.to.length} persons?`, true))) continue;
      const text = `You will spend ${total} NX Prepaid \nin this process.\nWould you like to proceed?`;
      if (!(await this.dialog({ mode: 2, items: [c], text, wallets: 4 }))) continue;
      if (this.tab === WISH) this.wishAfterBuy = c.SN;
      this.giftRun = { birthday, sn: c.SN, to: r.to, message: r.message, i: 0, sent: [], total: 0, name: '' };
      this.nextGift();
      return;
    }
  }
  /** The next recipient's gift, or the summary once every one has been tried. */
  nextGift() {
    const g = this.giftRun;
    if (g.i < g.to.length) {
      this.busy = true; clearTimeout(this.busyTimer); this.busyTimer = setTimeout(() => { this.busy = false; }, 8000);
      this.g.net?.csGift(g.birthday, g.sn, g.to[g.i++], g.message);
      return;
    }
    this.giftRun = null;
    if (g.sent.length === g.to.length) this.alert(`All the gifts have been sent.\n${g.total} NX \nwas spent in the process.`);
    else if (g.sent.length) {
      this.alert(`${g.sent.map((n) => `${n}\n`).join('')}\n[ ${g.name} ]\nhas been sent to the character above.\n(It could not be sent to several persons.)\n${g.total} NX were spent in the process.`);
    } else this.alert('The gifts could not be sent.');
  }
  /**
   * Name change (5400000) and world transfer (5401000): (for a transfer, a guild master or GM can't) the birthday
   * code, NX Prepaid, a confirm, then NAME_TRANSFER / WORLD_TRANSFER asks the server whether it may go ahead.
   */
  async buyTransfer(c, kind) {
    if (!this.available) { this.alert(ERRORS[0xC3]); return; }
    if (kind === 'world') {
      const me = this.g.player?.id, leader = this.g.guild?.members?.find((m) => m.rank === 1);
      const why = leader && leader.id === me ? 'Guild Master can not transfer worlds.' : this.g.gm ? 'GM can not transfer worlds.' : '';
      if (why) { this.alert(why); return; }
    }
    const birthday = await this.askBirthday();
    if (birthday === null) return;
    this.transferSN = c.SN;
    if ((this.cash.prepaid || 0) < c.Price) { this.alert("You don't have enough NX Prepaid"); return; }
    if (!(await this.alert(`You will spend ${c.Price} NX Prepaid.\nWould you like to proceed?`, true)) || !this.begin()) return;
    if (kind === 'name') this.g.net?.nameTransfer(this.g.player?.id, birthday);
    else this.g.net?.worldTransfer(this.g.player?.id, birthday);
  }
  /** NAME_TRANSFER's answer: 0 shows the rules, then the name window. */
  async nameChangeRules(error) {
    this.done();
    if (error) { this.alert(TRANSFER_ERRORS.name[error] || 'An unknown error has occured.'); return; }
    if (!(await new Promise((done) => this.mgr.show(new CsRulesNotice(this, 'name', done))))) return;
    this.nameWin = new CsNameDialog(this);
    this.mgr.show(this.nameWin);
  }
  /** CHECK_CHAR_NAME's answer for the name window: 0 free, more than 0 taken. */
  async nameChecked(name, code) {
    this.done();
    if (code < 0) { this.alert('An unknown error has occured.'); return; }
    if (code > 0) { this.alert('This name is currently being used. \nPlease use another name.'); return; }
    await this.alert('This name can be used. \nIf you wish to use this name,\nplease press OK.');
    this.nameWin?.accept(name);
  }
  /** WORLD_TRANSFER's answer, with the worlds: 0 shows the rules, then the world window; its pick (an index into the list) is sent. */
  async worldTransferRules(error, x, worlds) {
    this.done();
    if (worlds.length) this.worlds = worlds;
    if (error) { this.alert(TRANSFER_ERRORS.world[error] || 'An unknown error has occured.'); return; }
    if (!(await new Promise((done) => this.mgr.show(new CsRulesNotice(this, 'world', done))))) return;
    const world = await new Promise((done) => this.mgr.show(new CsWorldDialog(this, this.worlds || [], done)));
    if (world !== null && this.begin()) this.g.net?.csWorldTransfer(this.transferSN, world);
  }
  /** A name change / world transfer bought: the item goes to the Cash Inventory and the name window shuts. */
  transferBought(kind, item) {
    this.inv.push(item);
    this.showLockerEnd();
    if (kind === 'name') { this.nameWin?.finish(); this.nameWin = null; }
    sfx.play('UI/BuyShopItem');
    this.alert('You have successfully made the purchase.');
  }
  sendWish(list, removing = false) { this.wishRemoving = removing; this.g.net?.csWish(list); }
  addWish(c) {
    if (!c || !c.Price) return;
    if (this.wish.length >= 10) { this.alert('Your wish list is full.'); return; }
    const same = (sn) => { const w = this.bySN.get(sn); return w && w.ItemId === c.ItemId && w.Count === c.Count && w.Period === c.Period; };
    if (this.wish.some(same)) { this.alert('You already have this item on your wish list.'); return; }
    this.sendWish([...this.wish, c.SN]);
  }
  removeWish(c) { if (c) this.sendWish(this.wish.filter((s) => s !== c.SN), true); }
  /** The +Slot buttons: 4 more slots for 4,000 NX. */
  async addSlots(type) {
    if (this.busy) return;
    const mask = this.walletsFor(4000);
    if (!mask) { this.alert("You don't have enough cash."); return; }
    const text = type ? `${INV_SHORT[type]} adding inventory slots. (4000 NX)\nConfirm inventory slot purchase?` : 'Adding slots to the storage (4000 NX)\nConfirm storage slot purchase?';
    const wallet = await this.dialog({ mode: 3, items: [], text, wallets: mask });
    if (wallet && this.begin()) this.g.net?.csAddSlots(wallet, type);
  }
  /** SEARCH ITEM: on-sale items (not meso items) whose name holds the text, within the price range picked. */
  async searchItems() {
    const q = await new Promise((done) => this.mgr.show(new SearchPopup(this, done)));
    if (!q) return;
    const name = q.name.toLowerCase(), found = [];
    for (const list of this.groups.values()) {
      for (const c of list) {
        if (isMesoSN(c.SN) || (q.range && (c.Price < q.range[0] || c.Price > q.range[1]))) continue;
        if (!name || this.nameOf(c).toLowerCase().includes(name)) found.push(c);
      }
    }
    this.search = found;
    this.tab = SEARCH; this.sub = 0; this.page = 0;
  }
  /** CODE (F3): the coupon dialog, then COUPON_CODE with the code. */
  async enterCoupon() {
    if (!this.available) { this.alert(ERRORS[0xC3]); return; }
    if (this.busy) return;
    const code = await new Promise((done) => this.mgr.show(new CouponDialog(this, done)));
    if (code === null) return;
    if (!code.trim()) { this.alert('Please enter the coupon code.'); return; }
    if (this.begin()) this.g.net?.coupon(code.trim());
  }
  takeOut(it) {
    if (!it || this.busy) return;
    const type = invType(it.itemId), inv = this.g.inventory?.[type] || {}, limit = this.g.inventory?.limits?.[type] || 24;
    let slot = 0;
    for (let s = 1; s <= limit; s++) if (!inv[s]) { slot = s; break; }
    if (!slot) { this.itab = type; this.alert('Your inventory is full.'); return; }
    if (this.begin()) this.g.net?.csTake(it.cashId, type, slot);
  }
  putIn(it) {
    if (!it?.cashId || this.busy) return;
    if (Number(this.mgr.info(it.id)?.noMoveToLocker)) { this.alert('This item cannot be moved.'); return; }
    if (this.begin()) this.g.net?.csPut(it.cashId, invType(it.id));
  }

  // ---------------------------------------------------------------- preview
  /** Put the preview back in your own clothes (null), take everything off ([]), or wear a list of items. */
  async dress(equips) {
    const base = this.g.look;
    if (!base) return;
    this.tried.clear();
    this.pvPet = null; this.pvFx = null; this.av.expr = null; this.pvRings = [0, 0];   // both put the pet, effect, face and rings away too
    this.worn = equips === null ? [...base.equipIds] : equips;
    this.pkgPreview = false;
    if (this.btBuyAvatar) this.btBuyAvatar.enabled = true;
    await this.redress();
  }
  async redress() {
    const base = this.g.look, seq = (this.dressSeq = (this.dressSeq || 0) + 1);
    const equips = [...this.worn, ...(this.pvRings || []).filter(Boolean)];
    const look = new CharacterLook(this.mgr.assets, { skin: base.skin, face: base.faceId, hair: base.hairId, equips, gender: this.stats.gender ?? 0 });
    await look.load();
    await this.mgr.assets.preload(lookCanvases(look, [look.standAction(), look.walkAction(), 'jump', 'ladder', ...look.actionList().filter((x) => /^(swing|stab|shoot)/.test(x))]));
    if (seq === this.dressSeq) this.preview = look;
  }
  /** Try an item on (double-click its icon): an equip goes on, or comes off again; a package puts on its equips. */
  async tryOn(c) {
    if (!c || !this.worn) return;
    const kind = Math.floor(c.ItemId / 10000);
    if (kind === 500) { this.togglePet(c.ItemId); return; }
    if (kind === 516) { this.tryFace(c.ItemId); return; }
    if (kind === 501) { this.tryEffect(c.ItemId); return; }
    if (kind === 111) { this.tryRing(c.ItemId); return; }
    if (kind >= 180 && kind <= 183 && !isPetAcc(c.ItemId)) return;   // of the pet equipment only the accessories go on
    const pkg = this.isPackage(c), g = this.stats.gender ?? 0;
    const forMe = (id) => { const d = Math.floor(id / 1000) % 10; return d > 1 || d === g; };
    const ids = pkg ? this.contents(c).map((x) => x.ItemId).filter((id) => invType(id) === 1 && forMe(id)) : [c.ItemId];
    if (!ids.length || ids.some((id) => invType(id) !== 1)) return;
    for (const id of ids) if (isPetAcc(id)) this.loadPetAcc(id);
    if (!pkg && this.tried.has(c.ItemId)) {   // worn already: take it off, back to what you had there
      this.tried.delete(c.ItemId);
      const cat = Math.floor(c.ItemId / 10000);
      this.worn = this.worn.filter((id) => id !== c.ItemId);
      const own = this.g.look.equipIds.find((id) => Math.floor(id / 10000) === cat);
      if (own) this.worn.push(own);
    } else {
      for (const id of ids) {
        const cat = Math.floor(id / 10000);
        const clash = (x) => { const k = Math.floor(x / 10000); return k === cat || (cat === 105 && (k === 104 || k === 106)) || ((cat === 104 || cat === 106) && k === 105); };
        for (const x of this.worn.filter(clash)) this.tried.delete(x);
        this.worn = [...this.worn.filter((x) => !clash(x)), id];
        if (!pkg) this.tried.set(id, c);
      }
    }
    this.pkgPreview = pkg;
    if (this.btBuyAvatar) this.btBuyAvatar.enabled = !pkg;
    await this.redress();
  }
  /**
   * With the preview on, the arrow keys and the jump key move the character about its little map: walk along the
   * floor, jump, and climb the ladder (up / down on it, a jump with a direction leaves it).
   */
  moveAvatar() {
    const now = performance.now(), dt = Math.min(0.05, (now - (this.avAt || now)) / 1000), a = this.av, M = PV_MAP, look = this.preview;
    this.avAt = now;
    const g = this.g, inp = g.input, on = this.previewOn && !this.mgr.modal;
    const is = (k) => on && !!inp?.is(k);
    const dir = (is('right') ? 1 : 0) - (is('left') ? 1 : 0);
    const jump = on && (g.keysFor?.(5, ACTION.JUMP) || []).some((c) => inp?.is(c));
    const jumpHit = jump && !this.avJump;
    this.avJump = jump;
    // the attack key swings the weapon's basic attack (a shooting pose for ranged weapons), standing still
    const attack = on && (g.keysFor?.(5, ACTION.ATTACK) || []).some((c) => inp?.is(c));
    if (attack && !this.avAttack && a.ground && !a.ladder && !a.attack) { a.attack = look.shootAction?.() || look.attackAction(); a.vx = 0; }
    this.avAttack = attack;
    let moving = false;
    if (a.ladder) {
      const v = (is('down') ? 1 : 0) - (is('up') ? 1 : 0);
      if (jumpHit && dir) { a.ladder = false; a.vx = dir * PHYS.walk; a.vy = -PHYS.jump / 2; a.right = dir > 0; }
      else {
        a.y = Math.max(M.ladderTop, a.y + v * PHYS.climb * dt);
        moving = v !== 0;
        if (a.y >= M.ground) { a.y = M.ground; a.ladder = false; a.ground = true; }
      }
    } else {
      const nearLadder = Math.abs(a.x - M.ladderX) <= 12 && a.y >= M.ladderTop && a.y <= M.ground;
      if (is('up') && nearLadder && !a.attack) {
        a.ladder = true; a.ground = false; a.x = M.ladderX; a.vx = a.vy = 0; a.y = Math.min(a.y, M.ladderBottom);
      } else if (a.ground && a.attack) a.vx = 0;
      else if (a.ground) {
        a.vx = dir * PHYS.walk;
        if (dir) a.right = dir > 0;
        if (jumpHit) { a.vy = -PHYS.jump; a.ground = false; }
      } else {
        a.vy = Math.min(PHYS.maxFall, a.vy + PHYS.gravity * dt);
        a.y += a.vy * dt;
        if (a.y >= M.ground) { a.y = M.ground; a.vy = 0; a.ground = true; }
      }
      a.x = Math.max(M.left, Math.min(M.right, a.x + a.vx * dt));
    }
    const action = a.attack || (a.ladder ? 'ladder' : !a.ground ? 'jump' : a.vx ? look.walkAction() : look.standAction());
    if (action !== a.action) { a.action = action; a.frame = 0; a.t = 0; }
    if (a.ladder && !moving) return;
    a.t += dt * 1000;
    const n = Math.max(1, look.frameCount(action));
    while (a.t >= look.delay(action, a.frame)) {
      a.t -= look.delay(action, a.frame);
      if (a.attack && a.frame + 1 >= n) { a.attack = null; break; }   // the swing plays once
      a.frame = (a.frame + 1) % n;
    }
  }
  /** A facial expression item: the preview character makes the face (expression 8 + the id's last two digits). */
  async tryFace(id) {
    const n = (id % 100) + 8, node = this.preview?.face?.[EMOTES[n - 1]];
    if (!node) return;
    await this.mgr.assets.preload(allCanvases(node));
    setExpression(this.av, n);
  }
  /**
   * A ring: only a quote, label or effect ring shows, kept in one of two places (a quote ring in the first, a label
   * ring in the second, an effect ring in the first unless that already holds one with an effect); trying it again
   * takes it off.
   */
  async tryRing(id) {
    const r = (this.pvRings ??= [0, 0]), a = this.mgr.assets;
    if (r[0] === id || r[1] === id) r[r.indexOf(id)] = 0;
    else {
      const info = await itemInfo(a, id);
      if (!info) return;
      if (Number(info.chatBalloon)) r[0] = id;
      if (Number(info.nameTag)) r[1] = id;
      if (info.effect) {
        if (!r[0] || !(await itemInfo(a, r[0]))?.effect) r[0] = id;
        else r[1] = id;
      }
      if (!r.includes(id)) return;
    }
    await this.redress();
  }
  /** An effect item: its effect plays round the preview character; trying it again takes it off. */
  tryEffect(id) {
    if (this.pvFx?.itemFxId === id) { this.pvFx = null; return; }
    const ent = { x: 0, y: 0, facingRight: false, action: 'stand1' };
    this.pvFx = ent;
    this.g.setItemEffect?.(ent, id);
  }
  /** A pet tried on walks beside the character (one at a time); trying the same pet again puts it away. */
  async togglePet(id) {
    if (this.pvPet?.id === id) { this.pvPet = null; return; }
    const seq = (this.petSeq = (this.petSeq || 0) + 1), a = this.mgr.assets;
    const node = await a.json(`Item/Pet/${id}.img`);
    if (!node || seq !== this.petSeq) return;
    await a.preload(allCanvases({ stand0: node.stand0, move: node.move }));
    const av = this.av, M = PV_MAP;
    this.pvPet = { id, node, x: Math.max(M.left, Math.min(M.right, av.x + 70)), right: false, action: 'stand0', frame: 0, t: 0, hello: performance.now() + 3000 };
  }
  /** A pet accessory's art (Character/PetEquip/<id>.img), loaded once. */
  loadPetAcc(id) {
    const m = (this.petAccArt ??= new Map()), a = this.mgr.assets;
    if (!m.has(id)) { m.set(id, null); a.json(`Character/PetEquip/${pad(id, 8)}.img`).then(async (n) => { if (n) await a.preload(allCanvases(n)); m.set(id, n); }); }
    return m.get(id);
  }
  /** A lone pet aims for the character's x: it walks once more than 80px off and stops within 80px. */
  movePet(dt) {
    const p = this.pvPet, av = this.av;
    if (!p) return;
    const gap = av.x - p.x, far = Math.abs(gap) > 80;
    if (far) { p.x += Math.sign(gap) * Math.min(Math.abs(gap) - 79, 125 * dt); p.right = gap > 0; }
    else if (Math.abs(gap) > 4) p.right = gap > 0;
    const action = far && p.node.move ? 'move' : 'stand0';
    if (action !== p.action) { p.action = action; p.frame = 0; p.t = 0; }
    const n = []; for (let i = 0; p.node[action]?.[i]; i++) n.push(p.node[action][i]);
    if (!n.length) return;
    p.t += dt * 1000;
    while (p.t >= (Number(n[p.frame % n.length]?.delay) || 150)) { p.t -= Number(n[p.frame % n.length]?.delay) || 150; p.frame = (p.frame + 1) % n.length; }
  }
  drawPet(ctx) {
    const p = this.pvPet, m = this.mgr;
    if (!p) return;
    const f = p.node[p.action]?.[p.frame] || p.node.stand0?.[0], img = f && m.image(f);
    const x = PREVIEW.x + PV_MAP.ox + p.x, y = PREVIEW.y + PV_MAP.oy + PV_MAP.ground;
    if (img) {
      const o = f.origin || [img.width / 2, img.height];
      ctx.save();
      if (p.right) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -o[0], -o[1]); } else ctx.drawImage(img, x - o[0], y - o[1]);
      ctx.restore();
      // the accessory tried on, if it has art for this pet
      const acc = this.worn?.find(isPetAcc), af = acc && this.loadPetAcc(acc)?.[p.id]?.[p.action]?.[p.frame], ai = af && m.image(af);
      if (ai) {
        const eo = af.origin || [0, 0];
        ctx.save();
        if (p.right) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(ai, -eo[0], -eo[1]); } else ctx.drawImage(ai, x - eo[0], y - eo[1]);
        ctx.restore();
      }
    }
    nameTag(ctx, m.itemName(p.id) || '', x, y + 2);
    if (performance.now() < p.hello) this.g.vfx?.drawBalloon(ctx, { x: 0, y: 0 }, { x, y: y - (Number(p.node.stand0?.[0]?.origin?.[1]) || 33) + 77 }, 'Hello!', 'npc');
  }
  /** BUY EQUIPPED ITEM: everything tried on, one purchase after another. */
  async buyWorn() {
    if (this.busy) return;
    if (this.pkgPreview) { this.alert('The option is not available for that package.'); return; }
    const items = [...this.tried.values()].filter((c) => this.worn.includes(c.ItemId) && this.rules(c).buy);
    if (!items.length) return;
    const total = items.reduce((t, c) => t + c.Price, 0), mask = this.walletsFor(total);
    if (!mask) { this.alert("You don't have enough cash."); return; }
    // the first item that needs asking about is asked; the rest go through
    for (const c of items) {
      if (this.owns(c)) {
        if (!c.Price) { this.alert('You may not purchase the item since you already have it.'); return; }
        if (!(await this.alert('You already have the item(s) selected. Are\nyou sure you want to buy the item(s) again?', true))) return;
        break;
      }
      const warn = await this.buyWarning(c);
      if (warn) { if (!(await this.alert(warn, true))) return; break; }
    }
    const wallet = await this.dialog({ mode: 1, items, text: `Total ${total} NX.\nMake purchase?`, wallets: mask });
    if (!wallet || !this.begin()) return;
    this.multiBuy = true;
    this.queue = items.slice(1).map((c) => ({ c, wallet }));
    this.g.net?.csBuy(wallet, items[0].SN, items[0].ItemId);
  }

  /** The purchase dialog (CSNotice/0): resolves with the wallet chosen (or true when none is asked for), or 0. */
  dialog(opts) { return new Promise((done) => this.mgr.show(new CsNoticeDialog(this, opts, done))); }

  // ---------------------------------------------------------------- frame
  body(ctx) {
    if (!this.ready) { this.text(ctx, 'Loading the Cash Shop...', 400, 300, { align: 'center', color: '#fff', size: 12 }); return; }
    this.drawPreview(ctx);
    this.drawTabs(ctx);
    this.drawList(ctx);
    this.drawBest(ctx);
    this.drawLocker(ctx);
    this.drawItems(ctx);
    // NX Credit, NX Prepaid, Maple Points
    [[this.cash.credit, 539, '#000'], [this.cash.prepaid, 553, '#000'], [this.cash.maplePoint, 568, '#ff2020']]
      .forEach(([v, y, color]) => uiText(ctx, fmt(v), 474, y, { color, size: 12, align: 'right' }));
  }
  drawPreview(ctx) {
    const m = this.mgr, im = (n) => m.image(n), C = this.C;
    const pv = im(C.Base.Preview[this.backdrop]);
    if (pv) ctx.drawImage(pv, PREVIEW.x, PREVIEW.y);
    if (this.preview) {
      const before = this.avAt || performance.now();
      this.moveAvatar();
      const dt = Math.min(0.05, (this.avAt - before) / 1000);
      this.movePet(dt);
      const a = this.av, x = PREVIEW.x + PV_MAP.ox + a.x, y = PREVIEW.y + PV_MAP.oy + a.y, fx = this.pvFx, cam = { x: 0, y: 0 };
      stepExpression(a, this.preview, dt);
      const parts = this.preview.compose(a.action, a.frame, a.expr);
      if (fx) { Object.assign(fx, { x, y, facingRight: a.right, action: a.action }); this.g.stepItemFx?.(fx, dt); }
      const eq = Object.assign((this.pvEq ??= {}), { x, y, facingRight: a.right });
      this.g.stepEquipFx?.(eq, this.preview, dt);
      ctx.save(); ctx.beginPath(); ctx.rect(PREVIEW.x, PREVIEW.y, PREVIEW.w, PREVIEW.h); ctx.clip();
      this.drawPet(ctx);
      if (fx) this.g.drawItemFx?.(ctx, cam, fx, parts, false);
      this.g.drawEquipFx?.(ctx, cam, eq, parts, false);
      drawParts(ctx, m.assets, parts, x, y, a.right);
      if (fx) this.g.drawItemFx?.(ctx, cam, fx, parts, true);
      this.g.drawEquipFx?.(ctx, cam, eq, parts, true);
      if (!this.g.drawLabelTag?.(ctx, this.preview, this.g.player?.name || '', x, y + 2)) nameTag(ctx, this.g.player?.name || '', x, y + 2);
      ctx.restore();
      if (this.avChat && performance.now() < this.avChat.until) this.g.vfx?.drawBalloon(ctx, { x: 0, y: 0 }, { x, y }, this.avChat.text, String(this.preview.chatBalloon || 0));
    }
    if (this.chatField) {
      this.chatField.rect.x = this.x + 50; this.chatField.rect.y = this.y + 214;
      this.chatField.layout({ left: 0, top: 0 }, this.mgr.game.canvas.clientWidth / UI_W);
    }
    if (this.previewOn) { const on = im(C.Base.PreviewOnOff.On[0]); if (on) ctx.drawImage(on, 13, 9); }
    else { const off = im(C.Base.PreviewOnOff.Off[0]); if (off) ctx.drawImage(off, 90, 10); }
    this.drawBackdropTabs(ctx);
    // Character ID / Nexon ID
    uiText(ctx, this.g.player?.name || '', 225, 268, { color: '#000', align: 'right' });
    uiText(ctx, this.available ? maskId(this.account) : '-', 225, 287, { color: '#000', align: 'right' });
  }
  /** The backdrop tabs: grey Tab4 tabs, the chosen one light; its icon is Base/Tab/Enable, the others Disable. */
  drawBackdropTabs(ctx) {
    const m = this.mgr, im = (n) => m.image(n), T = m.B.Tab4, sel = this.backdrop, y = BACKDROP_Y;
    if (!T) return;
    const put = (k, x) => { const img = im(T[k]); if (img) ctx.drawImage(img, x, y); };
    put(sel === 0 ? 'left1' : 'left0', 141);
    BACKDROP_X.forEach((x, i) => {
      const on = i === sel, fill = im(T[on ? 'fill1' : 'fill0']);
      if (fill) ctx.drawImage(fill, x, y, 25, fill.height);
      put(i === 2 ? (on ? 'right1' : 'right0') : `middle${on ? 1 : i + 1 === sel ? 2 : 0}`, x + 25);
      const icon = im(this.C.Base.Tab[on ? 'Enable' : 'Disable'][i]);
      if (icon) ctx.drawImage(icon, x, y + 27 - icon.height);
    });
  }
  drawTabs(ctx) {
    const m = this.mgr, strip = m.image(this.C.CSTab.Tab[TAB_IMG(this.tab)]);
    if (strip) ctx.drawImage(strip, TABS_X, TABS_Y);
    // the sub-category links (" |" between), or the tab's own line
    const dark = DARK_BAR.has(this.tab), mouse = { x: m.mouse.x - this.x, y: m.mouse.y - this.y };
    const [normal, hover] = dark ? ['#fff', '#000'] : ['#000', '#fff'];
    this.subHits = [];
    const names = this.tab === WISH || this.tab === SEARCH ? [] : this.subs();
    if (this.tab === WISH) { uiText(ctx, 'This is your wish list.', SUB_X, SUB_Y, { color: normal }); return; }
    if (this.tab === SEARCH) { uiText(ctx, 'This is your search result.', SUB_X, SUB_Y, { color: normal, bold: true }); return; }
    if (!names.length) {
      if (this.tab !== MAIN) uiText(ctx, this.tab === 1 ? 'Recommended Items' : "The item is being prepared. We're sorry for the inconvenience.", SUB_X, SUB_Y, { color: normal });
      return;
    }
    ctx.save();
    let x = SUB_X;
    names.forEach((name, i) => {
      if (name === undefined) return;
      const bold = i === this.sub;
      ctx.font = `${bold ? 'bold ' : ''}12px Arial, "Segoe UI", sans-serif`;
      const w = ctx.measureText(name).width, over = mouse.x >= x && mouse.x < x + w && mouse.y >= SUB_Y && mouse.y < SUB_Y + 14;
      uiText(ctx, name, x, SUB_Y, { color: over ? hover : normal, bold });
      this.subHits.push([i, x, w]);
      x += w;
      if (i < names.length - 1) { ctx.font = '12px Arial, "Segoe UI", sans-serif'; uiText(ctx, ' |', x, SUB_Y, { color: normal }); x += ctx.measureText(' |').width; }
    });
    ctx.restore();
  }
  drawList(ctx) {
    const m = this.mgr, im = (n) => m.image(n), C = this.C;
    for (const c of this.cells) c.buy.visible = c.gift.visible = c.wish.visible = c.remove.visible = false;
    this.pageHits = [];
    if (this.tab === MAIN) {
      const pic = im(C.PicturePlate[this.sub === 1 ? 'HowToGift' : 'HowTo']);
      if (pic) ctx.drawImage(pic, LIST_X + 2, LIST_Y + 2);
      return;
    }
    const list = this.list();
    if (!list.length) { const pic = im(C.PicturePlate.NoItem); if (pic) ctx.drawImage(pic, LIST_X + 2, LIST_Y + 83); return; }
    for (let i = 0; i < PER_PAGE; i++) {
      const c = this.cellItem(i);
      if (!c) continue;
      const { x, y } = this.cellAt(i), cell = this.cells[i], r = this.rules(c);
      const base = im(C.CSList.Base);
      if (base) ctx.drawImage(base, x, y);
      if (!this.previewOn && this.selCell === i) { const f = im(C.CSList.ItemIcon); if (f) ctx.drawImage(f, x + 4, y + 4); }
      this.drawBigIcon(ctx, c, x + 7, y + 73);
      // in the cell a pet accessory reads "[PET]<name>"
      uiText(ctx, clipText(ctx, `${isPetAcc(c.ItemId) ? '[PET]' : ''}${this.nameOf(c)}`, 112), x + 82, y + 6, { color: '#000' });
      this.drawSticker(ctx, c, x, y);
      const g = this.genderOf(c), gi = g >= 0 && im(C.CSIcon[g]);
      if (gi) ctx.drawImage(gi, x + 57, y + 58);
      this.drawPrice(ctx, c, x, y);
      if (c.Discount > 0) this.drawDiscount(ctx, c.Discount, x + 44, y + 64);
      cell.buy.visible = cell.gift.visible = true;
      cell.buy.enabled = r.buy; cell.gift.enabled = r.gift;
      const keyed = !this.previewOn && this.selCell === i ? this.focusBtn : null;
      cell.buy.focused = keyed === 0; cell.gift.focused = keyed === 1; cell.wish.focused = cell.remove.focused = keyed === 2;
      if (this.tab === WISH) cell.remove.visible = true;
      else { cell.wish.visible = true; cell.wish.enabled = r.wish; }
    }
    // page numbers, 10 to a group, centred under the list
    const n = this.pages(), group = Math.floor(this.page / 10), mouse = { x: m.mouse.x - this.x, y: m.mouse.y - this.y };
    const parts = [];
    if (group > 0) parts.push(['◀', (group - 1) * 10 + 9]);
    for (let p = group * 10; p < Math.min(n, group * 10 + 10); p++) parts.push([String(p + 1), p]);
    if (n > group * 10 + 10) parts.push(['▶', group * 10 + 10]);
    ctx.save();
    const font = (bold) => `${bold ? 'bold ' : ''}12px Arial, "Segoe UI", sans-serif`;
    const width = (t, bold) => { ctx.font = font(bold); return ctx.measureText(t).width; };
    const isBold = (t, p) => p === this.page && t !== '◀' && t !== '▶', sep = width(' |', false);
    const total = parts.reduce((a, [t, p], i) => a + width(t, isBold(t, p)) + (i < parts.length - 1 ? sep : 0), 0);
    let x = Math.round(LIST_X + 4 + 206 - total / 2);
    parts.forEach(([t, p], i) => {
      const bold = isBold(t, p), w = width(t, bold), over = mouse.x >= x && mouse.x < x + w && mouse.y >= PAGE_Y && mouse.y < PAGE_Y + 14;
      uiText(ctx, t, x, PAGE_Y, { color: over ? '#000' : '#fff', bold });
      this.pageHits.push([p, x, w]);
      x += w;
      if (i < parts.length - 1) { uiText(ctx, ' |', x, PAGE_Y, { color: '#fff' }); x += sep; }
    });
    ctx.restore();
  }
  /** The list's icon: the raw icon at twice its size, standing on (x, y) by its origin. */
  drawBigIcon(ctx, c, x, y) {
    const n = this.rawIcon(c.ItemId), img = n && this.mgr.image(n);
    if (!img) return;
    const o = n.origin || [0, img.height];
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, Math.round(x - o[0] * 2), Math.round(y - o[1] * 2), img.width * 2, img.height * 2);
    ctx.restore();
  }
  drawSticker(ctx, c, x, y) {
    if (this.tab === WISH) return;
    const E = this.C.CSEffect, im = (n) => this.mgr.image(n);
    if (Number(c.Limit) > 0) { const f = animFrame(E.time), img = im(f); if (img) ctx.drawImage(img, x + 3, y + 3); return; }
    const kind = c.Discount > 0 ? 'event' : STICKERS[c.Class];
    if (!kind) return;
    const f = animFrame(E[kind]), img = im(f);
    if (!img) return;
    const o = f.origin || [0, 0];
    ctx.drawImage(img, x + 72 - STICKER_OFF[kind] - o[0], y - o[1]);
  }
  drawPrice(ctx, c, x, y) {
    const G = this.C.GuideWords, im = (n) => this.mgr.image(n), st = this.stock.get(c.SN);
    const guide = (k, gx, gy) => { const img = im(G[k]); if (img) ctx.drawImage(img, x + gx, y + gy); };
    if (this.slotsFull(c)) guide(3, 82, 31);
    else if (st === 1) guide(0, 82, 31);
    else if (st === 2) guide(1, 82, 31);
    else if (c.OnSale !== 1) guide(2, 79, 32);
    else uiText(ctx, priceText(c), x + 78, y + 32, { color: isMesoSN(c.SN) ? '#ff3399' : '#000' });
  }
  /** Slot items (inventory / storage / character slots) that can't add any more. */
  slotsFull(c) {
    if (Math.floor(c.ItemId / 10000) !== 911) return false;
    const type = Math.floor(c.ItemId / 1000) % 10, delta = Number(this.slotItems?.[c.ItemId]?.delta) || 0;
    if (type === 0) return this.storageSlots != null && this.storageSlots + delta > 48;
    return (this.g.inventory?.limits?.[type] || 0) + delta > 96;
  }
  drawDiscount(ctx, rate, x, y) {
    const D = this.C.CSDiscount, im = (n) => this.mgr.image(n);
    let cx = x;
    const put = (n) => { const img = im(n); if (img) { ctx.drawImage(img, cx, y); cx += img.width; } };
    put(D.w);
    if (rate >= 100) put(D[Math.floor(rate / 100) % 10]);
    if (rate >= 10) put(D[Math.floor(rate / 10) % 10]);
    put(D[rate % 10]);
    put(D.e);
  }
  drawBest(ctx) {
    this.bestItems().forEach((c, i) => {
      if (!c) return;
      const y = BEST_Y + BEST_ROW * i, n = this.mgr.icon(c.ItemId);
      if (n) this.mgr.drawIcon(ctx, n, BEST_X + 52, y + 2, c.ItemId);
      uiText(ctx, clipText(ctx, this.nameOf(c), 79), BEST_X + 8, y + 36, { color: '#000' });
      uiText(ctx, isMesoSN(c.SN) ? `${fmt(c.Price)}meso` : `${fmt(c.Price)} NX`, BEST_X + 8, y + 53, { color: '#fff' });
    });
  }
  drawLocker(ctx) {
    const m = this.mgr, L = LOCKER;
    this.inv.slice(this.cfirst * L.cols, (this.cfirst + L.rows) * L.cols).forEach((it, i) => {
      const x = L.x + (i % L.cols) * SLOT, y = L.y + Math.floor(i / L.cols) * SLOT;
      m.drawIcon(ctx, m.icon(it.itemId), x, y, it.itemId);
      if (it.quantity > 1) m.count(ctx, it.quantity, x, y + 20);
      if (this.csel === it) this.selBox(ctx, x, y, false);
    });
    this.scrollbar(ctx, ...L.bar, this.cfirst, Math.ceil(this.inv.length / L.cols), L.rows);
  }
  drawItems(ctx) {
    const m = this.mgr, I = ITEMS, inv = this.g.inventory?.[this.itab] || {}, limit = this.g.inventory?.limits?.[this.itab] || 24;
    this.itemTabs = drawCsTabs(ctx, m, this.C.Base.Tab2, this.itab - 1);
    const first = this.ifirst[this.itab] * I.cols;
    for (let k = 0; k < I.cols * I.rows; k++) {
      const slot = first + k + 1;
      if (slot > limit) break;
      const it = inv[slot];
      if (!it) continue;
      const x = I.x + (k % I.cols) * SLOT, y = I.y + Math.floor(k / I.cols) * SLOT;
      m.drawIcon(ctx, m.icon(it.id), x, y, it.id);
      if (this.itab !== 1 && it.quantity > 1) m.count(ctx, it.quantity, x, y + 20);
      if (!it.cashId) { ctx.fillStyle = 'rgba(54,54,54,0.45)'; ctx.fillRect(x, y, 32, 32); }
      if (this.isel === it) this.selBox(ctx, x, y, true);
    }
    this.scrollbar(ctx, ...I.bar, this.ifirst[this.itab], Math.ceil(limit / I.cols), I.rows);
    const lim = this.g.inventory?.limits || [];
    for (const b of this.slotBtns || []) b.enabled = b.slotType ? (lim[b.slotType] || 0) + 4 <= 96 : this.storageSlots == null || this.storageSlots + 4 <= 48;
  }
  selBox(ctx, x, y, fill) {
    if (fill) { ctx.fillStyle = 'rgba(16,48,204,0.25)'; ctx.fillRect(x, y, 32, 32); }
    ctx.strokeStyle = 'rgba(16,48,204,0.67)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, 30, 30); ctx.lineWidth = 1;
  }

  // ---------------------------------------------------------------- mouse
  hit(lx, ly) {
    for (const [t, [l, r]] of Object.entries(TAB_HIT)) {
      const tab = Number(t), x = TABS_X + (tab < this.tab ? l : r);
      if (tab !== this.tab && ly >= TABS_Y + 22 && ly < TABS_Y + 52 && lx >= x && lx < x + 51) return { tab };
    }
    for (const [i, x, w] of this.subHits || []) if (ly >= SUB_Y - 1 && ly < SUB_Y + 15 && lx >= x && lx < x + w) return { sub: i };
    for (const [p, x, w] of this.pageHits || []) if (ly >= PAGE_Y - 1 && ly < PAGE_Y + 15 && lx >= x && lx < x + w) return { page: p };
    for (let i = 0; i < PER_PAGE; i++) {
      const { x, y } = this.cellAt(i), c = this.cellItem(i);
      if (c && this.tab !== MAIN && lx >= x && lx < x + 200 && ly >= y && ly < y + 80) return { cell: i, item: c, icon: lx >= x + 5 && lx < x + 69 && ly >= y + 5 && ly < y + 69 };
    }
    for (let i = 0; i < 5; i++) {
      const y = BEST_Y + BEST_ROW * i;
      if (lx >= BEST_X && lx < BEST_X + 90 && ly >= y && ly < y + 68) return { best: this.bestItems()[i] };
    }
    if (lx >= 90 && lx < 125 && ly >= 10 && ly < 31) return { onOff: true };   // the ON / OFF label
    for (let i = 0; i < 3; i++) if (lx >= BACKDROP_X[i] - 4 && lx < BACKDROP_X[i] + 29 && ly >= BACKDROP_Y && ly < BACKDROP_Y + 28) return { backdrop: i };
    const L = LOCKER, I = ITEMS;
    const grid = (G, lx2, ly2) => {
      if (lx2 < G.x || ly2 < G.y) return -1;
      const c = Math.floor((lx2 - G.x) / SLOT), r = Math.floor((ly2 - G.y) / SLOT);
      if (c >= G.cols || r >= G.rows || (lx2 - G.x) % SLOT > 31 || (ly2 - G.y) % SLOT > 31) return -1;
      return r * G.cols + c;
    };
    const ci = grid(L, lx, ly);
    if (ci >= 0) return { cash: this.inv[this.cfirst * L.cols + ci] || null };
    const ii = grid(I, lx, ly);
    if (ii >= 0) return { inv: (this.g.inventory?.[this.itab] || {})[this.ifirst[this.itab] * I.cols + ii + 1] || null };
    const t = (this.itemTabs || []).findIndex(([x, w, y]) => lx >= x && lx < x + w && ly >= y && ly < y + 21);
    if (t >= 0) return { itab: t + 1 };
    return null;
  }
  down(lx, ly) {
    if (!this.ready) return;
    const L = LOCKER, I = ITEMS;
    const cs = this.scrollClick(lx, ly, ...L.bar, this.cfirst, Math.ceil(this.inv.length / L.cols), L.rows);
    if (cs !== null) { this.cfirst = cs; return; }
    const limit = this.g.inventory?.limits?.[this.itab] || 24;
    const is = this.scrollClick(lx, ly, ...I.bar, this.ifirst[this.itab], Math.ceil(limit / I.cols), I.rows);
    if (is !== null) { this.ifirst[this.itab] = is; return; }
    const h = this.hit(lx, ly);
    if (!h) return;
    if (h.tab !== undefined) { this.setTab(h.tab); return; }
    if (h.onOff) { this.previewOn = !this.previewOn; this.focusBtn = null; sfx.play('UI/BtMouseClick'); return; }
    if (h.backdrop !== undefined) { this.backdrop = h.backdrop; return; }
    if (h.itab) { if (h.itab !== this.itab) { this.itab = h.itab; this.isel = null; sfx.play('UI/Tab'); } return; }
    if (h.cash !== undefined) { this.csel = h.cash; return; }
    if (h.inv !== undefined) { this.isel = h.inv?.cashId ? h.inv : null; return; }
    if (h.sub !== undefined || h.page !== undefined) { this.pendingLink = h; return; }
    if (h.cell !== undefined) this.selCell = h.cell;
  }
  /** Sub-category and page links act on release. */
  up() {
    if (!this.ready || !this.pendingLink) return;
    const p = this.pendingLink; this.pendingLink = null;
    sfx.play('UI/BtMouseClick');
    if (p.sub !== undefined) { this.sub = p.sub; this.page = 0; } else this.page = p.page;
  }
  dblclick(lx, ly) {
    const h = this.ready && this.hit(lx, ly);
    if (!h) return;
    if (h.cash && h.cash.itemId === 5222000) { this.openSurprise(h.cash); return; }   // Cash Shop Surprise opens, it isn't taken out
    if (h.cash) this.takeOut(h.cash);
    else if (h.inv) this.putIn(h.inv);
    else if (h.item && h.icon) this.tryOn(h.item);
    else if (h.best) this.buyBest(h.best);
  }
  /** Best Item: a double-click buys, after the level checks. */
  buyBest(c) {
    const k = Math.floor(c.ItemId / 10000), lv = this.stats.level || 0;
    if (k === 503 && lv < 16) { this.alert("Hired Merchant's Shop is only available for characters that are over Level 15."); return; }
    if (k === 504 && lv < 7) { this.alert('This teleport rock is only available for characters that are over level 6.'); return; }
    if (LEVEL_GATE[k] && lv < LEVEL_GATE[k]) return;
    this.buy(c);
  }
  wheel(dy) {
    const x = this.mgr.mouse.x - this.x, y = this.mgr.mouse.y - this.y, d = Math.sign(dy);
    if (x < 256 && y >= 318 && y < 422) this.cfirst = Math.max(0, Math.min(Math.ceil(this.inv.length / LOCKER.cols) - LOCKER.rows, this.cfirst + d));
    else if (x < 256 && y >= 426) {
      const limit = this.g.inventory?.limits?.[this.itab] || 24;
      this.ifirst[this.itab] = Math.max(0, Math.min(Math.ceil(limit / ITEMS.cols) - ITEMS.rows, this.ifirst[this.itab] + d));
    } else if (x >= LIST_X && x < LIST_X + 412 && y >= LIST_Y) this.setPage(this.page + d);
  }
  tooltip(lx, ly) {
    const h = this.ready && this.hit(lx, ly);
    if (!h) return null;
    if (h.item && h.icon) {
      if (this.isPackage(h.item)) { const c = h.item; return { draw: (ctx, x, y) => this.drawPackageTip(ctx, c, x, y) }; }
      return { item: this.tipItem(h.item) };
    }
    if (h.best) return { item: this.tipItem(h.best) };
    if (h.cash) {
      const c = h.cash, pet = Math.floor(c.itemId / 10000) === 500;
      return { item: { id: c.itemId, quantity: c.quantity, cashId: c.cashId, from: c.from || '', ...(pet ? {} : { expiration: c.expiration }) } };
    }
    if (h.inv?.cashId) return { item: h.inv };
    return null;
  }
  /** A package item's regular price: the on-sale catalogue entry for the same item (the same period first), else its own. */
  regularPrice(c) {
    if (!this.onSaleBy) {
      this.onSaleBy = new Map();
      for (const x of this.bySN.values()) if (x.OnSale === 1 && x.ItemId) (this.onSaleBy.get(x.ItemId) || this.onSaleBy.set(x.ItemId, []).get(x.ItemId)).push(x);
    }
    const all = this.onSaleBy.get(c.ItemId) || [], r = all.find((x) => (x.Period || 0) === (c.Period || 0)) || all[0];
    return r ? r.Price : c.Price;
  }
  /**
   * A package's tooltip on the tooltip panel: its name centred, its description, then a 53px row per item (two
   * columns past 9): the icon on CSDiscount/backgrnd, the name, the regular price struck through -> the package
   * price with its discount badge (or the one price), "AVAILABLE FOR n DAYS." and CSDiscount/Line under it; then
   * CSDiscount/total, both totals and the package's badge.
   */
  drawPackageTip(ctx, pkg, x, y) {
    const m = this.mgr, D = this.C.CSDiscount, im = (n) => m.image(n), items = this.contents(pkg).filter((c) => c.ItemId);
    const n = items.length, rows = n > 9 ? Math.ceil(n / 2) : n, rate = pkg.Discount || 0;
    ctx.save();
    ctx.font = '12px Arial, sans-serif';
    let w = 260, col2 = 0;
    items.forEach((c, i) => { if (n > 9 && i === rows) col2 = w; w = Math.max(w, ctx.measureText(m.itemName(c.ItemId) || '').width + (i >= rows ? col2 : 0) + 100); });
    w = Math.ceil(Math.max(220, w));
    if (n <= 9) col2 = w;
    const desc = this.special[pkg.ItemId]?.desc, descLines = desc ? wrapText(ctx, String(desc).replace(/\\n|\r?\n/g, '\n'), w - 21, 12) : [];
    const top = Math.max(1, descLines.length) * 18 + 30, h = rows * 53 + 65 + top - 30;
    x = Math.min(x, UI_W - w - 2); y = Math.min(y, UI_H - h - 2);
    ctx.fillStyle = 'rgba(0,0,64,0.627)';
    ctx.fillRect(x + 1, y, w - 2, 1); ctx.fillRect(x, y + 1, w, h - 2); ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 1, y + 2, 1, h - 4); ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
    ctx.fillRect(x + 2, y + 1, w - 4, 1); ctx.fillRect(x + 2, y + h - 2, w - 4, 1);
    const text = (t, tx, ty, o = {}) => uiText(ctx, t, x + tx, y + ty, { color: '#fff', size: 12, ...o });
    const struck = (t, tx, ty, color) => {
      text(t, tx, ty, { color });
      ctx.fillStyle = color; ctx.fillRect(x + tx, y + ty + 6, Math.ceil(ctx.measureText(t).width), 1);
      return ctx.measureText(t).width;
    };
    const arrow = im(D.arrow), aw = arrow?.width || 9;
    text(this.nameOf(pkg), w / 2, 10, { bold: true, align: 'center' });
    descLines.forEach((l, i) => text(l, 11, 35 + i * 18));
    let origTotal = 0, newTotal = 0;
    items.forEach((c, i) => {
      const cx = i < rows ? 0 : col2, right = i < rows ? col2 : w, ry = top + (i < rows ? i : i - rows) * 53, tx = cx + 55;
      const orig = this.regularPrice(c), now = Math.floor(((100 - rate) * c.Price) / 100), days = c.Period > 0 ? c.Period : 0;
      origTotal += orig; newTotal += now;
      const bg = im(D.backgrnd), line = im(D.Line), mp = c.ItemId >= 90000000 && c.ItemId <= 90999999;
      if (bg) ctx.drawImage(bg, x + cx + 13, y + ry + 13);
      m.drawIcon(ctx, mp ? this.maplePointIcon(c.Count) : m.icon(c.ItemId), x + cx + 14, y + ry + 14, c.ItemId);
      if (line) ctx.drawImage(line, x + cx + 13, y + ry + 53);
      const nameY = ry + (days ? 9 : 18), priceY = ry + (days ? 25 : 34);
      ctx.font = '12px Arial, sans-serif';
      text(mp ? 'MaplePoint' : m.itemName(c.ItemId) || '', tx, nameY);
      // Maple Points in a package (90000000-90999999): their own icon, "MaplePoint" and the points
      const fmtNX = (v) => (mp ? `${c.Count} Point` : c.Count > 1 ? `${c.Count} ${v} NX` : `${v} NX`);
      if (orig === now) text(fmtNX(now), tx, priceY);
      else {
        const ow = struck(fmtNX(orig), tx, priceY, '#fff');
        if (arrow) ctx.drawImage(arrow, x + tx + ow + 10, y + priceY + 2);
        text(fmtNX(now), tx + ow + 10 + aw + 5, priceY);
        this.drawDiscount(ctx, now ? Math.floor(((orig - now) * 100) / orig) : 100, x + right - 40, y + nameY - 1);
      }
      if (days) text(`AVAILABLE FOR ${days} DAYS.`, tx, ry + 40);
    });
    const ty = top + rows * 53 + 12, total = im(D.total), tw = total?.width || 39;
    if (total) ctx.drawImage(total, x + 8, y + ty + 2);
    ctx.font = '12px Arial, sans-serif';
    const ow = struck(`${origTotal} NX`, tw + 14, ty - 1, '#ff0000');
    if (arrow) ctx.drawImage(arrow, x + tw + 19 + ow, y + ty + 1);
    text(`${newTotal} NX`, tw + 19 + ow + aw + 5, ty - 1);
    this.drawDiscount(ctx, newTotal ? Math.floor(((origTotal - newTotal) * 100) / origTotal) : 100, x + w - 40, y + ty - 2);
    ctx.restore();
  }
  /** A catalogue item's tooltip: the item, with its period ("AVAILABLE FOR n DAYS."). */
  tipItem(c) {
    const t = { id: c.ItemId, price: c.Price, cs: true };
    if (c.Period > 0) t.period = c.Period;
    if (c.Discount > 0) { t.discount = c.Discount; t.origPrice = c.OrigPrice; }
    // a slot expansion shows what it adds instead
    if (Math.floor(c.ItemId / 10000) === 911) {
      const type = Math.floor(c.ItemId / 1000) % 10;
      const delta = Number(this.slotItems?.[c.ItemId]?.delta) || 0;   // on the item itself, not under info
      if (type <= 4) t.slots = { type, delta, current: type ? this.g.inventory?.limits?.[type] || 0 : this.storageSlots ?? 0 };
    }
    // a character slot (5430xxx): how many you have, when the login told us
    if (Math.floor(c.ItemId / 1000) === 5430 && this.g.charSlots != null) t.slots = { type: 'char', current: this.g.charSlots };
    return t;
  }
  slotTip(type) {
    if (!type) return { title: 'Adding slots at the storage', lines: [`Add 4 slots for the storage (Current: ${this.storageSlots ?? 0} slots)`, 'Maximum of 48 slots available.4000 NX'] };
    const cur = this.g.inventory?.limits?.[type] || 0;
    return { title: `Add ${INV_SHORT[type]} slots`, lines: [`Add 4 slots for ${INV_SHORT[type]} inventory. (Current: ${cur} slots)`, 'Maximum of 96 slots available.4000 NX.'] };
  }


  // ---------------------------------------------------------------- keyboard
  key(e) {
    if (e.key !== 'Escape') return;
    if (this.chatField && document.activeElement === this.chatField.el) { this.chatField.el.blur(); return; }
    if (this.focusBtn !== null) { this.focusBtn = null; return; }
    this.alert('Are you sure you want to leave the Cash Shop?', true).then((ok) => { if (ok) this.g.leaveCashShop(); });
  }
  /**
   * With the preview off the keyboard works the list: the arrows move the yellow frame (wrapping round the page),
   * Enter tries the item on and puts the focus on BUY, Left / Right then go between BUY / GIFT / RESERVE and Enter
   * presses one. Held keys repeat every 300ms.
   */
  listKey(e) {
    const k = e.key, now = performance.now();
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(k)) return false;
    if (e.repeat && now - this.navAt < 300) return true;
    this.navAt = now;
    const n = Math.min(PER_PAGE, Math.max(0, this.list().length - this.page * PER_PAGE));
    if (!n || this.tab === MAIN) return true;
    this.selCell = Math.min(this.selCell, n - 1);
    const cell = this.cells[this.selCell], btns = [cell.buy, cell.gift, this.tab === WISH ? cell.remove : cell.wish];
    if (this.focusBtn !== null) {
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const d = k === 'ArrowLeft' ? 2 : 1;
        for (let i = 1; i <= 3; i++) { const j = (this.focusBtn + d * i) % 3; if (btns[j].enabled) { this.focusBtn = j; break; } }
      } else if (k === 'Enter') { const b = btns[this.focusBtn]; this.focusBtn = null; if (b.enabled) b.onClick(); }
      return true;
    }
    if (k === 'Enter') { this.tryOn(this.cellItem(this.selCell)); this.focusBtn = btns.findIndex((b) => b.enabled); if (this.focusBtn < 0) this.focusBtn = null; return true; }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[k];
    this.selCell = (((this.selCell + step) % n) + n) % n;
    return true;
  }
  keyDown(e) {
    if (!this.ready || this.mgr.modal || e.target instanceof HTMLInputElement) return;
    const k = e.key;
    if (!this.previewOn && this.listKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if (k === 'Enter' && this.previewOn && this.chatField) { e.preventDefault(); this.chatField.focus(); return; }
    let used = true;
    if (k === 'CapsLock') { this.previewOn = !this.previewOn; this.focusBtn = null; }
    else if (k === 'PageUp') this.setPage(this.page - 1);
    else if (k === 'PageDown') this.setPage(this.page + 1);
    else if (k === 'Home') this.setTab(1);
    else if (/^[1-9]$/.test(k)) this.setTab(Number(k));
    else if (k === '`') this.setTab(((this.tab - 1 + (e.shiftKey ? 7 : 1)) % 8) + 1);
    else if (k === 'Tab') { const n = this.subs().length; if (n) { this.sub = (this.sub + (e.shiftKey ? n - 1 : 1)) % n; this.page = 0; } }
    else if (k === 'F1') this.alert('Please visit the website to charge your account.');
    else if (k === 'F2') this.checkCash();
    else if (k === 'F3') this.enterCoupon();
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
}

/**
 * The Item Inventory's tab strip (Basic.img/Tab5, pink when chosen) at (17, 454), 156 wide, with
 * Base/Tab2's labels. Returns each tab's [x, width, y].
 */
function drawCsTabs(ctx, mgr, labels, selected) {
  const T = mgr.B.Tab5, im = (n) => mgr.image(n), rects = [], y = 454, count = 5;
  if (!T) return rects;
  const left = im(T[selected === 0 ? 'left1' : 'left0']);
  let x = 17;
  if (left) { ctx.drawImage(left, x, y); x += left.width; }
  const edges = (count - 1) * 12 + 6, width = Math.floor((156 - 6 - edges) / count);
  for (let i = 0; i < count; i++) {
    const on = i === selected, last = i === count - 1;
    const fill = im(T[on ? 'fill1' : 'fill0']);
    if (fill) ctx.drawImage(fill, x, y, width, fill.height);
    const edge = im(T[last ? (on ? 'right1' : 'right0') : `middle${on ? 1 : i + 1 === selected ? 2 : 0}`]);
    if (edge) ctx.drawImage(edge, x + width, y);
    const label = im(labels?.[on ? 'Enable' : 'Disable']?.[i]);
    if (label) ctx.drawImage(label, x + Math.trunc((width + 6) / 2) - Math.trunc(label.width / 2), y + 11 - Math.trunc(label.height / 2));
    rects.push([x - 6, width + 12, y]);
    x += width + (last ? 6 : 12);
  }
  return rects;
}

/**
 * The purchase dialog, CSNotice/0 (286 wide), centred: item rows (icon, name, "3100 NX"), the message, then the
 * three wallet checkboxes (Maple Points, NX Prepaid, NX Credit; only those that can pay are enabled, and a lone
 * one is ticked) and OK / Cancel. Mode 0 buy, 1 several items, 2 gift, 3 no items.
 */
class CsNoticeDialog extends Win {
  constructor(shop, { mode, items, text, wallets }, done) {
    const mgr = shop.mgr, n = items.length;
    const H = mode === 3 ? 170 : 40 * n + [156, 175, 194][mode];
    super(mgr, null, Math.round((UI_W - 286) / 2), Math.round((UI_H - H) / 2));
    this.buttons = [];
    this.shop = shop; this.mode = mode; this.items = items; this.message = text; this.wallets = wallets; this.done = done;
    this.w = 286; this.h = H; this.modal = true;
    this.boxes = [[2, H - 95], [4, H - 80], [1, H - 65]];
    const allowed = this.boxes.filter(([bit]) => wallets & bit);
    this.picked = new Set(allowed.length === 1 ? [allowed[0][0]] : []);
    this.button(mgr.B.BtOK2, 157, H - 37, () => this.ok());
    this.button(mgr.B.BtCancel2, 207, H - 37, () => this.finish(0));
  }
  ok() {
    if (!this.wallets) { this.finish(true); return; }
    if (this.picked.size !== 1) { this.alert('You should choose only one\nof the three options.'); return; }
    this.finish([...this.picked][0]);
  }
  finish(v) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(v); }
  key(e) { if (e.key === 'Enter') this.ok(); else if (e.key === 'Escape') this.finish(0); }
  down(lx, ly) {
    for (const [bit, y] of this.boxes) {
      if (!(this.wallets & bit) || lx < 25 || lx >= 185 || ly < y - 1 || ly >= y + 14) continue;
      if (this.picked.has(bit)) this.picked.delete(bit); else this.picked.add(bit);
    }
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), P = this.shop.C.CSNotice[0], H = this.h, n = this.items.length;
    const put = (node, y, h) => { const img = im(node); if (img) ctx.drawImage(img, 0, y, img.width, h ?? img.height); };
    put(P[0], 0);
    for (let i = 0; i < n; i++) put(P[1], 21 + 40 * i);
    // no items: rows of 3 from the top; else 2 under the items and 3 once, plus once per mode; then 4 at H - 111
    if (this.mode === 3) for (let y = 21; y < H - 111; y += 19) put(P[3], y);
    else {
      put(P[2], 21 + 40 * n);
      for (let i = 0; i <= this.mode; i++) put(P[3], 26 + 40 * n + 19 * i);
    }
    put(P[4], H - 111);
    this.items.forEach((c, i) => {
      const icon = m.icon(c.ItemId);
      if (icon) m.drawIcon(ctx, icon, 22, 21 + 40 * i + 4);
      uiText(ctx, clipText(ctx, this.shop.nameOf(c), 200), 63, 27 + 40 * i - 4, { color: '#fff' });
      uiText(ctx, isMesoSN(c.SN) ? `${c.Price} mesos` : `${c.Price} NX`, 63, 43 + 40 * i - 4, { color: '#fff' });
    });
    const lines = String(this.message).split('\n').length;
    const start = H - (this.mode === 3 && lines === 3 ? 152 : [123, 142, 158, 144][this.mode]);
    String(this.message).split('\n').forEach((line, i) => uiText(ctx, line, 143, start + i * 16, { color: '#fff', align: 'center' }));
    if (this.wallets) {
      for (const [bit, y] of this.boxes) {
        const on = this.picked.has(bit), enabled = !!(this.wallets & bit);
        const img = im(m.B.CheckBox[enabled ? (on ? 1 : 0) : (on ? 3 : 2)]) || im(m.B.CheckBox[on ? 1 : 0]);
        if (img) ctx.drawImage(img, 27, y + 1);
      }
    }
  }
}

/**
 * A Cash Shop message box from CSNotice/4: the blue panel (top, a stretched middle, the rounded bottom from the
 * first 12 rows of 4/4) round the centred text, then 4/4's grey band (its last 42 rows) with OK (and CANCEL).
 */
class CsAlert extends Win {
  constructor(shop, text, cancel, done) {
    const lines = wrapText((CsAlert.scratch ??= document.createElement('canvas').getContext('2d')), String(text), 236, 11);
    const body = Math.max(30, lines.length * 14 + 14), H = 21 + body + 12 + 42;
    super(shop.mgr, null, Math.round((UI_W - 266) / 2), Math.round((UI_H - H) / 2));
    this.buttons = [];
    this.shop = shop; this.lines = lines; this.bodyH = body; this.done = done; this.w = 266; this.h = H; this.modal = true;
    if (cancel) {
      this.button(shop.mgr.B.BtOK2, 150, H - 30, () => this.finish(true));
      this.button(shop.mgr.B.BtCancel2, 204, H - 30, () => this.finish(false));
    } else this.button(shop.mgr.B.BtOK2, 204, H - 30, () => this.finish(true));
  }
  finish(v) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(v); }
  key(e) { if (e.key === 'Enter') this.finish(true); else if (e.key === 'Escape') this.finish(false); }
  body(ctx) {
    const im = (n) => this.mgr.image(n), P = this.shop.C.CSNotice[4], H = this.h, mid = this.bodyH;
    const top = im(P[0]), fill = im(P[2]), end = im(P[4]);
    if (top) ctx.drawImage(top, 0, 0);
    if (fill) ctx.drawImage(fill, 0, 21, 266, mid);
    if (end) {
      ctx.drawImage(end, 0, 0, 266, 12, 0, 21 + mid, 266, 12);
      ctx.drawImage(end, 0, end.height - 42, 266, 42, 0, H - 42, 266, 42);
    }
    const y0 = 21 + Math.round((mid - this.lines.length * 14) / 2);
    this.lines.forEach((l, i) => uiText(ctx, l, 133, y0 + i * 14, { color: '#fff', size: 11, align: 'center' }));
  }
}

/** An edit box for a Cash Shop dialog: Arial 12 black, the text `margin` px in from the box's left edge. */
function editBox(shop, w, h, max, margin = 0) {
  const f = new TextField(shop.mgr.game.statusBar.layer, 0, 0, w, h, { color: '#000', max });
  f.el.style.padding = `0 ${margin}px`;
  return f;
}
/** Keep an edit box over its place (x, y) in a dialog. */
function placeBox(win, f, x, y) {
  f.rect.x = win.x + x; f.rect.y = win.y + y;
  f.layout({ left: 0, top: 0 }, win.mgr.game.canvas.clientWidth / UI_W);
}

/**
 * A combo box: the box from Basic.img/ComboBox4 (the left cap, the middle tiled, the end with the arrow; normal,
 * mouseOver, pressed while the list is open, selected after it is shut by the box) with the chosen text at (3, 3),
 * and its drop-down list 1px over the box's bottom edge: 16px rows, a frame round the background, the row under
 * the mouse (or keys) filled and its text white. A row is picked when the button comes up on it.
 */
class ComboBox {
  constructor(mgr, art, x, y, w, h, items, colors, font = { face: 'Arial', size: 12, hoverText: '#fff', listDy: 0 }) {
    Object.assign(this, { mgr, art, x, y, w, h, items, colors, font });
    this.value = 0; this.hover = 0; this.open = false; this.state = 'normal'; this.inside = false; this.pressedAt = 0;
  }
  get listY() { return this.y + this.h - 1; }
  get listH() { return this.items.length * 16 + 1; }
  inBox(lx, ly) { return lx >= this.x && lx < this.x + this.w && ly >= this.y && ly < this.y + this.h; }
  inList(lx, ly) { return this.open && lx >= this.x && lx < this.x + this.w && ly >= this.listY && ly < this.listY + this.listH; }
  rowAt(ly) { return Math.max(0, Math.min(this.items.length - 1, Math.floor((ly - this.listY) / 16))); }
  /** A click on the box (or Left / Right / Down while it has the focus) opens the list, or shuts it. */
  toggle() {
    this.pressedAt = performance.now(); this.state = 'pressed';
    if (!this.open) { this.open = true; this.hover = this.value; } else { this.state = 'selected'; this.open = false; }
  }
  pick(i) { this.open = false; this.value = i; }
  move(lx, ly) {
    const inside = this.inBox(lx, ly);
    if (inside && !this.inside) this.state = 'mouseOver';
    else if (!inside && this.inside && this.state === 'mouseOver') this.state = 'normal';
    this.inside = inside;
    if (this.inList(lx, ly)) this.hover = this.rowAt(ly);
  }
  /** Keys while it has the focus; true when used. */
  key(k) {
    if (!this.open) { if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowDown') { this.toggle(); return true; } return false; }
    if (k === 'ArrowUp') this.hover = Math.max(0, this.hover - 1);
    else if (k === 'ArrowDown') this.hover = Math.min(this.items.length - 1, this.hover + 1);
    else if (k === 'Enter') this.pick(this.hover);
    else return false;
    return true;
  }
  draw(ctx) {
    if (this.state === 'pressed' && !this.open && performance.now() - this.pressedAt > 300) this.state = 'normal';
    const S = this.art?.[this.items.length ? this.state : 'disabled'] || this.art?.normal, im = (n) => this.mgr.image(n);
    const l = im(S?.[0]), m = im(S?.[1]), r = im(S?.[2]);
    if (!l || !m || !r) return;
    ctx.drawImage(l, this.x, this.y);
    let x = this.x + l.width;
    for (let n = Math.floor((this.w - l.width - r.width - 1) / m.width); n > 0; n--, x += m.width) ctx.drawImage(m, x, this.y);
    ctx.drawImage(r, x, this.y);
    const t = this.items[this.value];
    if (t) this.text(ctx, t, this.w - r.width, this.x + 3, this.y + 3, '#000');
  }
  /** Text in the box's font, cut to `width` with "..". */
  text(ctx, t, width, x, y, color) {
    ctx.save(); ctx.font = `${this.font.size}px ${this.font.face}, Arial, sans-serif`; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = color;
    if (ctx.measureText(t).width > width) { while (t && ctx.measureText(`${t}..`).width > width) t = t.slice(0, -1); t += '..'; }
    ctx.fillText(t, x, y);
    ctx.restore();
  }
  drawList(ctx) {
    if (!this.open) return;
    const { x, w, colors: c } = this, y = this.listY, h = this.listH;
    ctx.fillStyle = c.frame; ctx.fillRect(x, y, w - 1, h);
    ctx.fillStyle = c.back; ctx.fillRect(x + 1, y + 1, w - 3, h - 2);
    this.items.forEach((t, i) => {
      const on = i === this.hover;
      if (on) { ctx.fillStyle = c.hover; ctx.fillRect(x + 1, y + i * 16 + 1, w - 2, 15); }
      if (t) this.text(ctx, t, w - 18, x + 7, y + i * 16 + 1 + (this.font.listDy || 0), on ? this.font.hoverText : '#000');
    });
  }
}

/**
 * SEARCH ITEM's pop-up (CSItemSearch/PopUp, 265x135, centred): the item name box at (103, 27) 140x16, the price
 * range combo box at (103, 52) 140x16 (blank, then each CSItemSearch/Price range as "%d ~ %d") and OK / CANCEL.
 * Tab moves between the name and the combo box, Enter is OK and Escape CANCEL. Resolves with { name, range } or null.
 */
class SearchPopup extends Win {
  constructor(shop, done) {
    const P = shop.C.CSItemSearch.PopUp, mgr = shop.mgr;
    super(mgr, P.backgrnd, (UI_W - 265) >> 1, (UI_H - 135) >> 1);
    this.buttons = [];
    this.shop = shop; this.done = done; this.w = 265; this.h = 135; this.modal = true; this.mouse = { x: -1, y: -1 };
    this.ranges = Object.values(shop.C.CSItemSearch.Price || {}).map((r) => [Number(r[0]), Number(r[1])]);
    this.combo = new ComboBox(mgr, mgr.B.ComboBox4, 103, 52, 140, 16, ['', ...this.ranges.map(([a, b]) => `${a} ~ ${b}`)],
      { back: '#eeeeee', hover: '#a5a198', frame: '#999999' });
    this.focus = 'name';
    this.field = editBox(shop, 140, 16, 0xffff);
    this.field.el.addEventListener('focus', () => { this.focus = 'name'; this.combo.open = false; });
    this.field.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') { e.preventDefault(); this.focusCombo(); }
    });
    this.button(mgr.B.BtOK2, 58, 104, () => this.finish(true));
    this.cancel = this.button(mgr.B.BtCancel2, 159, 104, () => this.finish(false));
  }
  frames() { return [this.bg, ...allCanvases(this.mgr.B.ComboBox4), ...this.buttons.flatMap((b) => b.frames())]; }
  focusCombo() { this.focus = 'combo'; this.field.el.blur(); }
  finish(ok) {
    if (this.answered) return;
    this.answered = true; this.field.remove(); this.mgr.close(this);
    this.done(ok ? { name: this.field.value.trim(), range: this.ranges[this.combo.value - 1] || null } : null);
  }
  key(e) {
    if (e.key === 'Enter' && this.focus === 'combo' && this.combo.key('Enter')) return;
    if (e.key === 'Enter') this.finish(true); else if (e.key === 'Escape') this.finish(false);
  }
  /** The other keys while the combo box has the focus (the name box takes its own). */
  keys(e) {
    if (this.focus !== 'combo') return false;
    if (e.key === 'Tab') { this.combo.open = false; this.field.focus(); return true; }
    return this.combo.key(e.key);
  }
  down(lx, ly) {
    const c = this.combo;
    if (c.inList(lx, ly)) return;
    if (c.inBox(lx, ly)) { this.focusCombo(); c.toggle(); return; }
    c.open = false;
  }
  dblclick(lx, ly) { this.down(lx, ly); }
  move(lx, ly) { this.mouse = { x: lx, y: ly }; this.combo.move(lx, ly); }
  up() {
    const c = this.combo, { x, y } = this.mouse;
    if (c.inList(x, y)) { c.pick(c.rowAt(y)); this.focus = 'combo'; }
  }
  body(ctx) {
    placeBox(this, this.field, 103, 27);
    if (!this.focused) { this.focused = true; setTimeout(() => this.field.focus(), 0); }
    this.combo.draw(ctx);
    // the open list lies over CANCEL and below the pop-up's bottom edge, and takes the clicks there
    this.h = this.combo.open ? Math.max(135, this.combo.listY + this.combo.listH) : 135;
    this.cancel.visible = !this.combo.open;
  }
  draw(ctx) {
    super.draw(ctx);
    ctx.save(); ctx.translate(this.x, this.y); this.combo.drawList(ctx); ctx.restore();
  }
}

/**
 * A ring's partner (CSNotice/2/backgrnd, 266x142, centred): after "To :" the name box at (84, 25) 122x13 (12
 * letters), the message on two lines at (26, 49) and (26, 65), 210x13 (34 letters each), OK at (168, 112) and
 * CANCEL at (210, 112). A faint "Please enter a message." sits at (55, 50) while both lines are empty and neither
 * has the focus. Enter in the name goes on to an empty first line, in the first line to an empty second line, and
 * is OK otherwise. Resolves with { to, message } (the two lines joined by a line break) or null.
 */
class CsPartnerDialog extends Win {
  constructor(shop, done) {
    const mgr = shop.mgr;
    super(mgr, shop.C.CSNotice[2].backgrnd, (UI_W - 266) >> 1, (UI_H - 142) >> 1);
    this.buttons = [];
    this.shop = shop; this.done = done; this.w = 266; this.h = 142; this.modal = true;
    this.fields = [editBox(shop, 122, 13, 12), editBox(shop, 210, 13, 34), editBox(shop, 210, 13, 34)];
    [this.to, this.line1, this.line2] = this.fields;
    this.focus = this.to;
    this.fields.forEach((f, i) => {
      f.el.addEventListener('focus', () => { this.focus = f; });
      f.el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') { e.preventDefault(); this.fields[(i + (e.shiftKey ? 2 : 1)) % 3].focus(); }
      });
    });
    this.button(mgr.B.BtOK2, 168, 112, () => this.ok());
    this.button(mgr.B.BtCancel2, 210, 112, () => this.finish(null));
  }
  frames() { return [this.bg, ...this.buttons.flatMap((b) => b.frames())]; }
  say(text) { this.shop.alert(text); }
  ok() {
    const to = this.to.value.trim(), l1 = this.line1.value.trim(), l2 = this.line2.value.trim();
    if (to.length < 4 || to.length > 12) { this.say('Please enter the name of \nthe receiving character.'); return; }
    if (to.toLowerCase() === (this.shop.g.player?.name || '').toLowerCase()) { this.say('You cannot send gifts to yourself.'); return; }
    if (!l1 && !l2) { this.say('Please enter the message.'); return; }
    const message = `${l1}\n${l2}`;
    if (message.length > 72) { this.say('The message can be no longer than 72 characters long.'); return; }
    this.finish({ to, message });
  }
  finish(v) { if (this.answered) return; this.answered = true; for (const f of this.fields) f.remove(); this.mgr.close(this); this.done(v); }
  key(e) {
    if (e.key === 'Escape') { this.finish(null); return; }
    if (e.key !== 'Enter') return;
    if (this.focus === this.to && !this.line1.value) this.line1.focus();
    else if (this.focus === this.line1 && !this.line2.value) this.line2.focus();
    else this.ok();
  }
  body(ctx) {
    placeBox(this, this.to, 84, 25); placeBox(this, this.line1, 26, 49); placeBox(this, this.line2, 26, 65);
    if (!this.focused) { this.focused = true; setTimeout(() => this.to.focus(), 0); }
    if (this.focus !== this.line1 && this.focus !== this.line2 && !this.line1.value.trim() && !this.line2.value.trim()) {
      ctx.save(); ctx.globalAlpha = 0x37 / 255;
      uiText(ctx, 'Please enter a message.', 55, 50, { color: '#000' });
      ctx.restore();
    }
  }
}

/**
 * The coupon dialog (UIWindow.img/Coupon/backgrnd, 266x125, centred): the code box at (17, 53) 230x15 (32
 * letters, a "-" typed at the end is dropped), OK at (159, 95) and CANCEL at (209, 95). Resolves with the code or null.
 */
class CouponDialog extends Win {
  constructor(shop, done) {
    const mgr = shop.mgr;
    super(mgr, mgr.W.Coupon.backgrnd, (UI_W - 266) >> 1, (UI_H - 125) >> 1);
    this.buttons = [];
    this.shop = shop; this.done = done; this.w = 266; this.h = 125; this.modal = true;
    this.field = editBox(shop, 230, 15, 32, 1);
    this.field.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.field.el.addEventListener('input', () => { if (this.field.value.endsWith('-')) this.field.value = this.field.value.slice(0, -1); });
    this.button(mgr.B.BtOK2, 159, 95, () => this.finish(this.field.value));
    this.button(mgr.B.BtCancel2, 209, 95, () => this.finish(null));
  }
  frames() { return [this.bg, ...this.buttons.flatMap((b) => b.frames())]; }
  finish(v) { if (this.answered) return; this.answered = true; this.field.remove(); this.mgr.close(this); this.done(v); }
  key(e) { if (e.key === 'Enter') this.finish(this.field.value); else if (e.key === 'Escape') this.finish(null); }
  body() {
    placeBox(this, this.field, 17, 53);
    if (!this.focused) { this.focused = true; setTimeout(() => this.field.focus(), 0); }
  }
}

/** A vertical scrollbar in the given Basic.img VScr art (Win.scrollbar's layout). */
function drawVScr(win, ctx, V, x, y, h, first, rows, visible) {
  const on = rows > visible, S = on ? V.enabled : V.disabled, im = (n) => win.mgr.image(n);
  const base = im(S.base), prev = im(on ? S.prev0 : S.prev), next = im(on ? S.next0 : S.next);
  if (base) ctx.drawImage(base, x, y + 12, 12, h - 24);
  if (prev) ctx.drawImage(prev, x, y);
  if (next) ctx.drawImage(next, x, y + h - 12);
  const thumb = on && im(S.thumb0);
  if (thumb) ctx.drawImage(thumb, x, y + 12 + Math.round((h - 36) * first / Math.max(1, rows - visible)));
}

/**
 * The rules before a name change / world transfer (CSChangeName or CSTransferWorld/Base/backgrndnotice, 406x424 at
 * (197, 48)): every String/NameChange.img/NameChange (TransferWorld.img/TransferWorld) Text%02d run together, in
 * black Arial 10 (#e bold Arial 11), wrapped at 350 from x 7, 13px apart, shown in (29, 51) 353x315 and scrolled 5px
 * a step by a VScr6 bar at (384, 47), 324 long. OK at (275, 395) only comes on at the last step; CANCEL at (340, 395).
 * Enter and Escape do nothing. Resolves with true for OK.
 */
class CsRulesNotice extends Win {
  constructor(shop, kind, done) {
    const mgr = shop.mgr, B = kind === 'name' ? shop.C.CSChangeName.Base : shop.C.CSTransferWorld.Base;
    super(mgr, B.backgrndnotice, 197, 48);
    this.buttons = [];
    this.shop = shop; this.done = done; this.w = 406; this.h = 424; this.modal = true; this.pos = 0; this.steps = 0; this.last = 0; this.lines = [];
    this.btOK = this.button(mgr.B.BtOK2, 275, 395, () => this.finish(true));
    this.btOK.enabled = false;
    this.button(mgr.B.BtCancel2, 340, 395, () => this.finish(false));
    const [img, key] = kind === 'name' ? ['NameChange', 'NameChange'] : ['TransferWorld', 'TransferWorld'];
    mgr.assets.json(`String/${img}.img`).then((d) => {
      const node = d?.[key] || {}, n = Object.keys(node).length;
      let text = '';
      for (let i = 0; i < n; i++) text += node[`Text${String(i).padStart(2, '0')}`] ?? '';
      this.layout(text);
    });
  }
  frames() { return [this.bg, ...allCanvases(this.mgr.B.VScr6), ...this.buttons.flatMap((b) => b.frames())]; }
  font(bold) { return bold ? 'bold 11px Arial, sans-serif' : '10px Arial, sans-serif'; }
  layout(text) {
    const ctx = (CsRulesNotice.scratch ??= document.createElement('canvas').getContext('2d'));
    const lines = [[]];
    let x = 7, bold = false;
    for (const tk of String(text).replace(/\\[rR]\\[nN]|\r\n|\n/g, '\n').split(/(#[a-zA-Z]|\n|\s+)/)) {
      if (!tk) continue;
      if (tk === '\n') { lines.push([]); x = 7; continue; }
      if (/^#[a-zA-Z]$/.test(tk)) { if (tk[1] === 'e') bold = true; else if (tk[1] === 'n') bold = false; continue; }
      ctx.font = this.font(bold);
      const w = ctx.measureText(tk).width;
      if (!tk.trim()) { if (x > 7) x += w; continue; }
      if (x + 7 + w > 350 && x > 7) { lines.push([]); x = 7; }
      lines[lines.length - 1].push({ t: tk, x, bold });
      x += w;
    }
    this.lines = lines;
    // 16px lines 2px apart inside 7px of padding; the bar's last step is (height - 317) / 7 - 15
    const H = 7 + lines.length * 18 + 7;
    this.last = Math.trunc((H - 317) / 7) - 15;
    const range = this.last + 1 + (this.last < 1 ? 1 : 0);
    this.steps = range < 2 ? 0 : range;
  }
  scrollTo(p) { this.pos = Math.max(0, Math.min(Math.max(0, this.steps - 1), p)); this.btOK.enabled = this.steps > 0 && this.last <= this.pos; }
  finish(ok) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(ok); }
  key() {}
  /** The bar: an arrow moves a step; the track above or below the thumb pages by max(steps / 16, 16). */
  down(lx, ly) {
    const p = this.scrollClick(lx, ly, 384, 47, 324, this.pos, this.steps, 1);
    if (p === null || !this.steps) return;
    const thumb = 47 + 12 + Math.round((324 - 36) * this.pos / Math.max(1, this.steps - 1));
    if (ly < 47 + 12 || ly >= 47 + 324 - 12 || (ly >= thumb && ly < thumb + 12)) { this.scrollTo(p); return; }
    this.scrollTo(this.pos + Math.max(Math.trunc(this.steps / 16), 16) * (ly < thumb ? -1 : 1));
  }
  body(ctx) {
    ctx.save(); ctx.beginPath(); ctx.rect(29, 51, 353, 315); ctx.clip();
    this.lines.forEach((runs, i) => {
      const y = 7 + 13 * i - this.pos * 5;
      if (y <= -49 || y >= 341) return;
      for (const r of runs) {
        ctx.font = this.font(r.bold); ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
        ctx.fillText(r.t, 29 + r.x, 51 + y + 3);
      }
    });
    ctx.restore();
    drawVScr(this, ctx, this.mgr.B.VScr6, 384, 47, 324, this.pos, this.steps, 1);
  }
}

/**
 * The new name (CSChangeName/Base/backgrnd, 266x124, centred): the name box at (26, 51) 212x13 on white (12 letters),
 * CHECK at (195, 26), OK at (161, 93) (off until a name has been checked free) and CANCEL at (210, 93). OK sends
 * the change and the window stays until the purchase comes back. Enter checks the name then does the same.
 */
class CsNameDialog extends Win {
  constructor(shop) {
    const mgr = shop.mgr, C = shop.C.CSChangeName;
    super(mgr, C.Base.backgrnd, (UI_W - 266) >> 1, (UI_H - 124) >> 1);
    this.buttons = [];
    this.shop = shop; this.w = 266; this.h = 124; this.modal = true; this.checked = ''; this.sn = shop.transferSN;
    this.field = editBox(shop, 212, 13, 12);
    this.field.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.button(C.BtCheck, 195, 26, () => this.check());
    this.btOK = this.button(mgr.B.BtOK2, 161, 93, () => this.ok());
    this.btOK.enabled = false;
    this.button(mgr.B.BtCancel2, 210, 93, () => this.finish());
  }
  frames() { return [this.bg, ...this.buttons.flatMap((b) => b.frames())]; }
  get me() { return this.shop.g.player?.name || ''; }
  say(t) { this.shop.alert(t); }
  check() {
    const t = this.field.value;
    if (t === this.checked) return;
    this.checked = '';
    if (t === this.me) { this.say('This name is same as your current name. \nPlease use another name.'); return; }
    if (this.shop.begin()) this.shop.g.net?.checkNewName(t);
  }
  /** The server says the name is free: OK comes on for it. */
  accept(name) { this.checked = name; this.btOK.enabled = true; }
  send() { if (this.shop.begin()) this.shop.g.net?.csNameChange(this.sn, this.me, this.field.value); }
  ok() {
    if (this.field.value === this.checked) this.send();
    else this.say('Press the CHECK button \nto check if you can use\nthe name of the character.');
  }
  key(e) {
    if (e.key === 'Escape') { this.finish(); return; }
    if (e.key !== 'Enter') return;
    const t = this.field.value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    const press = 'Press the CHECK button \nto check if you can use\nthe name of the character.';
    if (t.length < 4 || t.length > 12) { this.say(press); return; }
    if (t === this.me) { this.say('This name is same as your current name. \nPlease use another name.'); return; }
    if (this.field.value !== this.checked) { this.say(press); return; }
    this.send();
    this.finish();
  }
  finish() { if (this.answered) return; this.answered = true; this.field.remove(); this.mgr.close(this); if (this.shop.nameWin === this) this.shop.nameWin = null; }
  body(ctx) {
    ctx.fillStyle = '#fff'; ctx.fillRect(26, 51, 212, 13);
    placeBox(this, this.field, 26, 51);
    if (!this.focused) { this.focused = true; setTimeout(() => this.field.focus(), 0); }
  }
}

/**
 * The world to move to (CSTransferWorld/Base/backgrnd, 209x101, centred): the character's name at (105, 33) (cut to
 * 95px), a Basic.img/ComboBox combo box at (103, 50) 100x17 of the server's worlds in Tahoma 9 (the first chosen),
 * OK at (107, 77), CANCEL at (156, 77) and a close box at (190, 6). Resolves with the index picked, or null.
 */
class CsWorldDialog extends Win {
  constructor(shop, worlds, done) {
    const mgr = shop.mgr;
    super(mgr, shop.C.CSTransferWorld.Base.backgrnd, (UI_W - 209) >> 1, (UI_H - 101) >> 1);
    this.buttons = [];
    this.shop = shop; this.done = done; this.w = 209; this.h = 101; this.modal = true; this.mouse = { x: -1, y: -1 };
    this.combo = new ComboBox(mgr, mgr.B.ComboBox, 103, 50, 100, 17, worlds, { back: '#eeeeee', hover: '#a5a198', frame: '#999999' },
      { face: 'Tahoma', size: 9, hoverText: '#000', listDy: 2 });
    this.button(mgr.B.BtOK2, 107, 77, () => this.finish(this.combo.value));
    this.button(mgr.B.BtCancel2, 156, 77, () => this.finish(null));
    this.button(mgr.B.BtClose, 190, 6, () => this.finish(null));
  }
  frames() { return [this.bg, ...allCanvases(this.mgr.B.ComboBox), ...this.buttons.flatMap((b) => b.frames())]; }
  finish(v) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(v); }
  key(e) {
    if (e.key === 'Enter' && this.combo.key('Enter')) return;
    if (e.key === 'Enter') this.finish(this.combo.value); else if (e.key === 'Escape') this.finish(null);
  }
  keys(e) { return this.combo.key(e.key); }
  down(lx, ly) {
    const c = this.combo;
    if (c.inList(lx, ly)) return;
    if (c.inBox(lx, ly)) { c.toggle(); return; }
    c.open = false;
  }
  dblclick(lx, ly) { this.down(lx, ly); }
  move(lx, ly) { this.mouse = { x: lx, y: ly }; this.combo.move(lx, ly); }
  up() { const c = this.combo, { x, y } = this.mouse; if (c.inList(x, y)) c.pick(c.rowAt(y)); }
  body(ctx) {
    uiText(ctx, clipText(ctx, this.shop.g.player?.name || '', 95), 105, 33, { color: '#000' });
    this.combo.draw(ctx);
    this.h = this.combo.open ? Math.max(101, this.combo.listY + this.combo.listH) : 101;
  }
  draw(ctx) { super.draw(ctx); ctx.save(); ctx.translate(this.x, this.y); this.combo.drawList(ctx); ctx.restore(); }
}

/**
 * The gift window (CSGift/backgrnd, 266x169 at (267, 215); backgrnd1, 473 wide, while a picker is open): after "To :"
 * the recipients box at (84, 52) 122x13 ("a;b;c"), the message on two lines at (26, 76) and (26, 92), 210x13 (34
 * letters each), with a faint "Please enter a message." at (55, 77) while both are empty and neither has the focus;
 * GUILD (56, 139), BUDDY (110, 139), OK (168, 139), CANCEL (210, 139). BUDDY / GUILD open a picker of your buddies /
 * guild members sorted by name: 3 rows from (293, 55) 18px apart, the chosen one on 0xff244768 in white, a VScr4
 * bar at (439, 52) 55 long, "None" at (337, 55) when empty, and BtHide at (439, 139) to shut it. A click picks a
 * row, a double-click adds it to the recipients. Resolves with { to: [names], message } or null.
 */
class CsGiftDialog extends Win {
  constructor(shop, done) {
    const mgr = shop.mgr, G = shop.C.CSGift;
    super(mgr, G.backgrnd, 267, 215);
    this.buttons = [];
    this.shop = shop; this.done = done; this.G = G; this.w = 266; this.h = 169; this.modal = true;
    this.mode = 0; this.list = []; this.sel = null; this.first = 0; this.mouse = { x: -1, y: -1 };
    this.fields = [editBox(shop, 122, 13, 0xffff), editBox(shop, 210, 13, 34), editBox(shop, 210, 13, 34)];
    [this.to, this.line1, this.line2] = this.fields;
    this.focus = this.to;
    this.fields.forEach((f, i) => {
      f.el.addEventListener('focus', () => { this.focus = f; });
      f.el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') { e.preventDefault(); this.fields[(i + (e.shiftKey ? 2 : 1)) % 3].focus(); }
      });
    });
    this.button(mgr.B.BtOK2, 168, 139, () => this.ok());
    this.button(mgr.B.BtCancel2, 210, 139, () => this.finish(null));
    this.button(G.BtBuddy, 110, 139, () => this.setMode(1));
    this.button(G.BtGuild, 56, 139, () => this.setMode(2));
    this.btHide = this.button(G.BtHide, 439, 139, () => this.setMode(0));
    this.btHide.visible = false;
  }
  frames() { return [this.G.backgrnd, this.G.backgrnd1, ...allCanvases(this.mgr.B.VScr4), ...this.buttons.flatMap((b) => b.frames())]; }
  /** 0 the window alone, 1 with the buddy picker, 2 with the guild picker. */
  setMode(m) {
    if (m === this.mode) return;
    this.mode = m; this.sel = null; this.first = 0;
    this.bg = m ? this.G.backgrnd1 : this.G.backgrnd; this.w = m ? 473 : 266;
    this.btHide.visible = !!m;
    const g = this.shop.g, src = m === 1 ? g.buddies || [] : m === 2 ? g.guild?.members || [] : [];
    this.list = src.filter((x) => x.id).map((x) => ({ id: x.id, name: x.name })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  /** The scrollbar's steps: 0 to (rows - 3). */
  get steps() { const r = this.list.length - 2; return r < 2 ? 0 : r; }
  rowAt(lx, ly) {
    if (!this.mode) return null;
    for (let i = 0; i < 3; i++) {
      const e = this.list[this.first + i], y = 55 + 18 * i;
      if (e && lx >= 283 && lx < 436 && ly >= y - 2 && ly < y + 16) return e;
    }
    return null;
  }
  say(t) { this.shop.alert(t); }
  ok() {
    const me = (this.shop.g.player?.name || '').toLowerCase(), to = [], l1 = this.line1.value.trim(), l2 = this.line2.value.trim();
    let rest = this.to.value;
    for (;;) {
      rest = rest.replace(/^;+|;+$/g, '').trim();
      if (!rest) { this.say('Please enter the name of \nthe receiving character.'); return; }
      const k = rest.indexOf(';');
      if (k < 0) { to.push(rest); break; }
      const t = rest.slice(0, k);
      if (t.length < 4 || t.length > 12) { this.say('Please enter the name of \nthe receiving character.'); return; }
      if (t.toLowerCase() === me) { this.say('You cannot send gifts to yourself.'); return; }
      if (to.includes(t)) { this.say('There are repeating character names.'); return; }
      to.push(t);
      rest = rest.slice(k + 1);
    }
    const message = `${l1}\n${l2}`;
    if (!l1 && !l2) { this.say('Please enter the message.'); return; }
    if (message.length > 72) { this.say('The message can be no longer than 72 characters long.'); return; }
    this.finish({ to, message });
  }
  finish(v) { if (this.answered) return; this.answered = true; for (const f of this.fields) f.remove(); this.mgr.close(this); this.done(v); }
  key(e) {
    if (e.key === 'Escape') { this.finish(null); return; }
    if (e.key !== 'Enter') return;
    if (this.focus === this.to && !this.line1.value) this.line1.focus();
    else if (this.focus === this.line1 && !this.line2.value) this.line2.focus();
    else this.ok();
  }
  down(lx, ly) {
    if (!this.mode) return;
    const p = this.scrollClick(lx, ly, 439, 52, 55, this.first, this.steps, 1);
    if (p !== null && this.steps) this.first = p;
  }
  move(lx, ly) { this.mouse = { x: lx, y: ly }; }
  up() { const e = this.rowAt(this.mouse.x, this.mouse.y); if (e) this.sel = e.id; }
  dblclick(lx, ly) {
    const e = this.rowAt(lx, ly);
    if (!e) return;
    this.sel = e.id;
    if (e.name) this.to.value = this.to.value ? `${this.to.value};${e.name}` : e.name;
  }
  body(ctx) {
    placeBox(this, this.to, 84, 52); placeBox(this, this.line1, 26, 76); placeBox(this, this.line2, 26, 92);
    if (!this.focused) { this.focused = true; setTimeout(() => this.to.focus(), 0); }
    const faint = (t, x, y) => { ctx.save(); ctx.globalAlpha = 0x37 / 255; uiText(ctx, t, x, y, { color: '#000' }); ctx.restore(); };
    if (this.focus !== this.line1 && this.focus !== this.line2 && !this.line1.value.trim() && !this.line2.value.trim()) faint('Please enter a message.', 55, 77);
    if (!this.mode) return;
    if (!this.list.length) faint('None', 337, 55);
    for (let i = 0; i < 3; i++) {
      const e = this.list[this.first + i], y = 55 + 18 * i;
      if (!e) continue;
      const on = e.id === this.sel;
      if (on) { ctx.fillStyle = '#244768'; ctx.fillRect(283, y - 2, 153, 18); }
      uiText(ctx, e.name, 293, y, { color: on ? '#fff' : '#000' });
    }
    drawVScr(this, ctx, this.mgr.B.VScr4, 439, 52, 55, this.first, this.steps, 1);
  }
}
