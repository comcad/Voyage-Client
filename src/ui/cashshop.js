import { invType, itemName } from '../data.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { sfx } from '../audio.js';
import { WzButton } from './wzui.js';
import { Win, allCanvases } from './windows.js';

/**
 * The Cash Shop (UI/CashShop.img), a full 800x600 screen. Measured from Base/backgrnd:
 *   Preview box x 22-238 y 38-205 (Base/Preview/0 behind the character), Character ID / Nexon ID y 263-305
 *   Cash Inventory: 6 x 2 cells of 31px every 35 from (21, 349); Item Inventory: 4 x 3 from (23, 481),
 *     its tab buttons (Base/Tab2 labels) x 177-241, every 27 from y 453
 *   category strip CSTab/Tab/<n> (508x78) at (273, 16): tabs on top, the sub-category band at y 62-92
 *   item cards CSList/Base (200x80) in 2 columns (x 277 / 483) x 5 rows every 81 from y 97:
 *     icon box 5-68, name bar x 75-198 y 3-21, price below, Buy / Gift / Wish buttons along the bottom
 *   Best Item boxes x 742-773 at y 157 / 226 / 295 / 364 / 433; NX box x 315-485 y 541-582
 * Items are Etc/Commodity.img entries with OnSale 1 (Cosmic's CashItemFactory reads the same flag);
 * the first digit of an SN is its tab (1 Event, 2 Equip, 3 Use, 4 Set-up, 5 Etc, 6 Pet, 7 Package).
 */
const TABS = [['MAIN', 1, 64], ['EVENT', 68, 116], ['EQUIP', 120, 170], ['USE', 173, 216], ['SET-UP', 220, 268],
  ['ETC', 272, 316], ['PET', 320, 364], ['PACKAGE', 368, 430], ['WISH LIST', 446, 506]];
const STRIP_X = 273, STRIP_Y = 16, SUB_Y = [63, 77], SUB_RIGHT = 688;   // sub-categories wrap onto two rows
const CARD_X = [277, 483], CARD_Y = 97, CARD_STEP = 81, PER_PAGE = 10;
const CINV = { x: 21, y: 349, cols: 6, rows: 2 }, IINV = { x: 23, y: 481, cols: 4, rows: 3 }, CELL = 35;
const BEST_Y = [157, 226, 295, 364, 433];
/** Wallets in the order we spend from, as CashShop.NX_CREDIT / NX_PREPAID / MAPLE_POINT */
const WALLETS = [[1, 'credit', 'NX Credit'], [4, 'prepaid', 'NX Prepaid'], [2, 'maplePoint', 'Maple Points']];
/** CASHSHOP_OPERATION 0x5C codes Cosmic sends */
const ERRORS = { 0xA8: 'Please check the name of the character you entered.', 0xA9: 'That item is gender-restricted.',
  0xBE: 'That character cannot receive the item.', 0xC0: 'This item cannot be purchased.', 0xC4: 'Please check your birthday and try again.' };
/** Slot expansions have no item strings: Cosmic reads 9110000 as storage, 9111000-9114000 as Equip / Use / Set-up / Etc */
const SLOT_NAMES = { 9110000: 'Storage Slot Expansion', 9111000: 'Equip Slot Expansion', 9112000: 'Use Slot Expansion',
  9113000: 'Set-up Slot Expansion', 9114000: 'Etc Slot Expansion' };
const INV_NAMES = ['', 'Equip', 'Use', 'Set-up', 'Etc', 'Cash'];
const EQUIP_NAMES = { 100: 'Hat', 101: 'Face', 102: 'Eye', 103: 'Earring', 104: 'Top', 105: 'Overall', 106: 'Bottom', 107: 'Shoes',
  108: 'Gloves', 109: 'Shield', 110: 'Cape', 111: 'Ring', 112: 'Pendant', 170: 'Weapon', 180: 'Pet Equip', 181: 'Pet Equip' };

export class CashShopWin extends Win {
  constructor(mgr, d) {
    super(mgr, null, 0, 0);
    this.w = 800; this.h = 600; this.fixed = true; this.buttons = [];
    this.account = d.account; this.best = d.best || [];
    this.cash = { credit: 0, prepaid: 0, maplePoint: 0 };
    this.inv = []; this.wish = [];
    this.tab = 0; this.sub = null; this.page = 0; this.sel = null; this.itab = 1; this.cfirst = 0; this.ifirst = 0;
    this.catalog = []; this.ready = false;
    this.init();
  }
  async init() {
    const a = this.mgr.assets;
    const [C, com, pkg] = await Promise.all([a.json('UI/CashShop.img'), a.json('Etc/Commodity.img'), a.json('Etc/CashPackage.img')]);
    this.C = C; this.pkg = pkg || {};
    const gender = this.g.stats?.gender ?? 0;
    this.catalog = Object.values(com || {}).filter((c) => c.OnSale === 1 && (c.Gender === 2 || c.Gender === undefined || c.Gender === gender))
      .sort((x, y) => (y.Priority || 0) - (x.Priority || 0) || x.SN - y.SN);
    this.bySN = new Map(this.catalog.map((c) => [c.SN, c]));
    this.anySN = new Map(Object.values(com || {}).map((c) => [c.SN, c]));   // package contents need not be on sale themselves
    await a.preload([C.Base.backgrnd, ...allCanvases(C.CSTab), ...allCanvases(C.Base.Tab2), C.CSList.Base, C.Base.Preview[0]]);
    this.bg = C.Base.backgrnd;
    const L = C.CSList;
    this.cards = [];
    for (let i = 0; i < PER_PAGE; i++) {
      const x = CARD_X[i % 2], y = CARD_Y + Math.floor(i / 2) * CARD_STEP;
      const card = {
        buy: this.button(L.BtBuy, x + 77, y + 57, () => this.buy(this.cardItem(i))),
        gift: this.button(L.BtGift, x + 118, y + 57, () => this.gift(this.cardItem(i))),
        wish: this.button(L.BtReserve, x + 159, y + 57, () => this.toggleWish(this.cardItem(i))),
        remove: this.button(L.BtRemove, x + 159, y + 57, () => this.toggleWish(this.cardItem(i))),
      };
      this.cards.push(card);
    }
    const S = C.CSStatus;
    this.button(S.BtExit, 632, 541, () => this.g.leaveCashShop());
    this.button(S.BtCheck, 541, 541, () => this.g.net?.checkCash()).enabled = true;
    this.button(S.BtCharge, 497, 541, () => {}).enabled = false;
    this.button(S.BtCoupon, 585, 541, () => {}).enabled = false;
    await a.preload(this.buttons.flatMap((b) => b.frames()));
    this.setPreview(null);
    this.ready = true;
  }
  frames() { return []; }

  // ---------------------------------------------------------------- server events
  setCash(c) { this.cash = c; }
  setInventory(items) { this.inv = items; }
  setWish(sns) { this.wish = sns; }
  /** An item's name, waiting for it to load if it never has been (notices are built once). */
  name(id) { return itemName(this.mgr.assets, id); }
  async bought(item) {
    this.inv.push(item);
    this.mgr.notice(`#b${await this.name(item.itemId)}#k has been added to your Cash Inventory.`);
  }
  /** Gifts waiting for us: the server already moved them into the Cash Inventory. */
  async receivedGifts(gifts) {
    for (const g of gifts) {
      if (!this.inv.some((c) => String(c.cashId) === String(g.cashId))) this.inv.push(g);
      await this.mgr.notice(`You have received #b${await this.name(g.itemId)}#k from #b${g.from}#k.\n${g.message}`);
    }
  }
  async giftSent(g) { this.mgr.notice(`You have sent #b${await this.name(g.itemId)}#k to #b${g.to}#k.`); }
  boughtPackage(items) {
    this.inv.push(...items);
    this.mgr.notice(`The package has been added to your Cash Inventory. (${items.length} items)`);
  }
  taken(pos, item) {
    const it = { ...item, pos };
    this.inv = this.inv.filter((c) => c.cashId !== item.cashId);
    const inv = this.g.inventory?.[invType(item.id)];
    if (inv) inv[pos] = it;
  }
  put(item) {
    this.inv.push(item);
    const inv = this.g.inventory?.[invType(item.itemId)];
    if (inv) for (const [pos, it] of Object.entries(inv)) if (String(it.cashId) === String(item.cashId)) delete inv[pos];
  }
  slots(kind, n, type) {
    const what = kind === 'inventory' ? `${INV_NAMES[type] || ''} inventory` : kind === 'storage' ? 'storage' : 'character';
    this.mgr.notice(`Your ${what} now has ${n} slots.`);
  }
  error(code) { this.mgr.notice(ERRORS[code] || `The request could not be completed. (${code})`); }

  // ---------------------------------------------------------------- catalog
  /** A package's contents (Etc/CashPackage.img lists them by SN). */
  contents(c) { return Object.values(this.pkg[c.ItemId]?.SN || {}).map((sn) => this.anySN.get(sn) || { SN: sn, ItemId: 0 }); }
  /** The item a card shows: a package shows its first item, slot expansions have none. */
  shownId(c) { const k = Math.floor(c.ItemId / 10000); return k === 910 ? this.contents(c)[0]?.ItemId || 0 : k === 911 ? 0 : c.ItemId; }
  nameOf(c) {
    if (SLOT_NAMES[c.ItemId]) return SLOT_NAMES[c.ItemId];
    if (Math.floor(c.ItemId / 10000) !== 910) return this.mgr.itemName(c.ItemId) || '...';
    const items = this.contents(c), first = items[0] && this.mgr.itemName(items[0].ItemId);
    return first ? `${first}${items.length > 1 ? ` + ${items.length - 1} more` : ''}` : 'Package';
  }
  tabItems(tab = this.tab) {
    if (tab === 8) return this.wish.map((sn) => this.bySN.get(sn)).filter(Boolean);
    if (tab === 0) {
      const best = this.best.map((sn) => this.bySN.get(sn)).filter(Boolean);
      return best.length ? best : this.catalog.filter((c) => (c.Priority || 0) >= 9).slice(0, 60);
    }
    return this.catalog.filter((c) => Math.floor(c.SN / 10000000) === tab);
  }
  /** EQUIP is split by slot (Hat, Top, Shoes...); the other tabs show everything. */
  subcats() {
    if (this.tab !== 2) return [];
    const seen = new Map();
    for (const c of this.tabItems()) { const k = Math.floor(c.ItemId / 10000); if (!seen.has(k)) seen.set(k, EQUIP_NAMES[k] || 'Other'); }
    return [...seen].sort((a, b) => a[0] - b[0]);
  }
  list() {
    const all = this.tabItems();
    return this.sub === null ? all : all.filter((c) => Math.floor(c.ItemId / 10000) === this.sub);
  }
  pages() { return Math.max(1, Math.ceil(this.list().length / PER_PAGE)); }
  cardItem(i) { return this.list()[this.page * PER_PAGE + i] || null; }
  setTab(t) { if (t !== this.tab) { this.tab = t; this.sub = null; this.page = 0; sfx.play('UI/Tab'); } }

  // ---------------------------------------------------------------- actions
  async buy(c) {
    if (!c) return;
    const name = this.nameOf(c);
    const w = WALLETS.find(([, key]) => this.cash[key] >= c.Price);
    if (!w) { this.mgr.notice(`You don't have enough NX to buy #b${name}#k.\n(${c.Price.toLocaleString('en-US')} NX)`); return; }
    const count = c.Count > 1 ? ` x${c.Count}` : '';
    if (await this.mgr.confirm(`Buy #b${name}${count}#k for ${c.Price.toLocaleString('en-US')} ${w[2]}?`)) this.g.net?.csBuy(w[0], c.SN, c.ItemId);
  }
  /** Gifts are paid from NX Prepaid and confirmed with the account's date of birth, as in the client. */
  async gift(c) {
    if (!c) return;
    const name = this.nameOf(c);
    if (this.cash.prepaid < c.Price) { this.mgr.notice(`Gifts are paid with NX Prepaid.\nYou need ${c.Price.toLocaleString('en-US')} NX Prepaid to send #b${name}#k.`); return; }
    const to = await this.mgr.askText(`Who would you like to send #b${name}#k to?`);
    if (!to) return;
    const message = await this.mgr.askText('Enter a message to go with the gift.', '', { max: 73, width: 220 });
    if (!message) return;
    const birthday = await this.mgr.askText('Please enter your date of birth (YYYYMMDD) to confirm.', '', { max: 8 });
    if (!birthday || !/^\d{8}$/.test(birthday)) { if (birthday) this.mgr.notice('Please enter your date of birth as 8 digits, like 19990131.'); return; }
    if (await this.mgr.confirm(`Send #b${name}#k to #b${to}#k for ${c.Price.toLocaleString('en-US')} NX Prepaid?`)) this.g.net?.csGift(Number(birthday), c.SN, to, message);
  }
  toggleWish(c) {
    if (!c) return;
    const has = this.wish.includes(c.SN);
    if (!has && this.wish.length >= 10) { this.mgr.notice('Your wish list is full. (10 items)'); return; }
    this.g.net?.csWish(has ? this.wish.filter((s) => s !== c.SN) : [...this.wish, c.SN]);
  }
  takeOut(it) { if (it) this.g.net?.csTake(it.cashId, invType(it.itemId)); }
  putIn(it) {
    if (!it?.cashId) { this.mgr.notice('Only cash items can be moved into the Cash Inventory.'); return; }
    this.g.net?.csPut(it.cashId, invType(it.id));
  }
  /** Dress the preview in an equip from the list (it replaces whatever sits in that slot). */
  async setPreview(c) {
    const base = this.g.look;
    if (!base) return;
    let equips = [...base.equipIds];
    if (c && invType(c.ItemId) === 1) {
      const cat = Math.floor(c.ItemId / 10000);
      const clash = (id) => { const k = Math.floor(id / 10000); return k === cat || (cat === 105 && (k === 104 || k === 106)) || ((cat === 104 || cat === 106) && k === 105); };
      equips = [...equips.filter((id) => !clash(id)), c.ItemId];
    }
    const look = new CharacterLook(this.mgr.assets, { skin: base.skin, face: base.faceId, hair: base.hairId, equips });
    await look.load();
    await this.mgr.assets.preload(lookCanvases(look, [look.standAction()]));
    this.preview = look;
  }

  // ---------------------------------------------------------------- frame
  body(ctx) {
    if (!this.ready) { this.text(ctx, 'Loading the Cash Shop...', 400, 300, { align: 'center', color: '#fff', size: 12 }); return; }
    const m = this.mgr, im = (n) => m.image(n), C = this.C, g = this.g;
    // preview, names
    const pv = im(C.Base.Preview[0]);
    if (pv) ctx.drawImage(pv, 24, 40);
    if (this.preview) {
      ctx.save(); ctx.beginPath(); ctx.rect(22, 38, 216, 167); ctx.clip();
      drawParts(ctx, m.assets, this.preview.compose(this.preview.standAction(), 0), 130, 180, false);
      ctx.restore();
    }
    this.text(ctx, g.player.name, 120, 269, { bold: true });
    this.text(ctx, this.account || '', 120, 288);
    // category strip, sub-categories, page
    const strip = im(C.CSTab.Tab[this.tab + 1]);
    if (strip) ctx.drawImage(strip, STRIP_X, STRIP_Y);
    let sx = STRIP_X + 10, row = 0;
    this.subHits = [];
    ctx.font = 'bold 11px Arial, sans-serif';
    for (const [k, label] of [[null, 'All'], ...this.subcats()]) {
      const w = ctx.measureText(label).width;
      if (sx + w > SUB_RIGHT && row === 0) { row = 1; sx = STRIP_X + 10; }
      this.text(ctx, label, sx, SUB_Y[row], { color: k === this.sub ? '#ffe96b' : '#fff', bold: true });
      this.subHits.push([k, sx - 3, w + 6, SUB_Y[row]]);
      sx += w + 11;
      ctx.font = 'bold 11px Arial, sans-serif';
    }
    this.text(ctx, `◀  ${this.page + 1} / ${this.pages()}  ▶`, 772, 70, { align: 'right', color: '#fff', bold: true });
    // cards
    const base = im(C.CSList.Base);
    this.cards.forEach((card, i) => {
      const c = this.cardItem(i), x = CARD_X[i % 2], y = CARD_Y + Math.floor(i / 2) * CARD_STEP;
      card.buy.visible = card.gift.visible = !!c;
      card.wish.visible = !!c && this.tab !== 8; card.remove.visible = !!c && this.tab === 8;
      if (c) card.wish.enabled = !this.wish.includes(c.SN);
      if (!c) return;
      if (base) ctx.drawImage(base, x, y);
      if (this.sel === c.SN) { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, 198, 78); ctx.lineWidth = 1; }
      if (this.shownId(c)) this.bigIcon(ctx, this.shownId(c), x + 5, y + 5, 64);
      ctx.save(); ctx.beginPath(); ctx.rect(x + 76, y + 3, 121, 18); ctx.clip();
      this.text(ctx, this.nameOf(c), x + 79, y + 6, { bold: true });
      ctx.restore();
      this.text(ctx, `${c.Price.toLocaleString('en-US')} NX`, x + 79, y + 27, { color: '#0a2d6e', bold: true });
      const extra = [c.Count > 1 ? `x${c.Count}` : '', c.Period > 0 ? `${c.Period} days` : 'Permanent'].filter(Boolean).join('  ');
      this.text(ctx, extra, x + 79, y + 41, { color: '#334' });
    });
    if (!this.list().length) this.text(ctx, this.tab === 8 ? 'Your wish list is empty.' : 'There are no items here.', 480, 280, { align: 'center', color: '#fff', size: 12 });
    // best items
    this.best.slice(0, 5).forEach((sn, i) => { const c = this.bySN.get(sn); if (c && this.shownId(c)) m.drawIcon(ctx, m.icon(this.shownId(c)), 742, BEST_Y[i]); });
    // cash inventory
    this.inv.slice(this.cfirst * CINV.cols, (this.cfirst + CINV.rows) * CINV.cols).forEach((it, i) => {
      const x = CINV.x + (i % CINV.cols) * CELL, y = CINV.y + Math.floor(i / CINV.cols) * CELL;
      m.drawIcon(ctx, m.icon(it.itemId), x, y - 1);
      if (it.quantity > 1) m.count(ctx, it.quantity, x, y + 20);
    });
    // item inventory tabs and grid
    for (let t = 1; t <= 5; t++) {
      const lab = im(C.Base.Tab2[t === this.itab ? 'Enable' : 'Disable'][t - 1]), y = 453 + (t - 1) * 27;
      if (t === this.itab) { ctx.fillStyle = 'rgba(40,70,120,0.55)'; ctx.fillRect(178, y + 1, 62, 22); }
      if (lab) ctx.drawImage(lab, Math.round(209 - lab.width / 2), Math.round(y + 12 - lab.height / 2));
    }
    this.myItems().slice(this.ifirst * IINV.cols, (this.ifirst + IINV.rows) * IINV.cols).forEach(([, it], i) => {
      const x = IINV.x + (i % IINV.cols) * CELL, y = IINV.y + Math.floor(i / IINV.cols) * CELL;
      m.drawIcon(ctx, m.icon(it.id), x, y - 1);
      if (invType(it.id) !== 1 && it.quantity > 1) m.count(ctx, it.quantity, x, y + 20);
    });
    // wallets
    [this.cash.credit, this.cash.prepaid, this.cash.maplePoint].forEach((v, i) => this.text(ctx, (v || 0).toLocaleString('en-US'), 480, 543 + i * 14, { align: 'right' }));
  }
  /** An item's raw icon blown up to fill a card's icon box. */
  bigIcon(ctx, id, x, y, size) {
    const n = this.mgr.icon(id), img = n && this.mgr.image(n);
    if (!img) return;
    const k = Math.min(2, Math.floor(size / Math.max(img.width, img.height)) || 1), w = img.width * k, h = img.height * k;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, Math.round(x + (size - w) / 2), Math.round(y + (size - h) / 2), w, h);
    ctx.restore();
  }
  myItems() { return Object.entries(this.g.inventory?.[this.itab] || {}).sort((a, b) => a[0] - b[0]); }

  // ---------------------------------------------------------------- mouse
  hit(lx, ly) {
    for (let i = 0; i < TABS.length; i++) if (ly >= STRIP_Y + 4 && ly < STRIP_Y + 42 && lx >= STRIP_X + TABS[i][1] && lx < STRIP_X + TABS[i][2]) return { tab: i };
    for (const [k, x, w, y] of this.subHits || []) if (ly >= y - 2 && ly < y + 13 && lx >= x && lx < x + w) return { sub: k };
    if (ly >= 62 && ly < 92 && lx >= 692 && lx < 780) return { page: lx < 735 ? -1 : 1 };
    for (let i = 0; i < PER_PAGE; i++) {
      const x = CARD_X[i % 2], y = CARD_Y + Math.floor(i / 2) * CARD_STEP;
      if (lx >= x && lx < x + 200 && ly >= y && ly < y + 80 && this.cardItem(i)) return { card: this.cardItem(i), icon: lx < x + 72 };
    }
    for (let i = 0; i < 5; i++) if (lx >= 742 && lx < 774 && ly >= BEST_Y[i] && ly < BEST_Y[i] + 33 && this.bySN.get(this.best[i])) return { card: this.bySN.get(this.best[i]), icon: true };
    const cell = (G, list, first) => {
      if (lx < G.x || ly < G.y) return null;
      const c = Math.floor((lx - G.x) / CELL), r = Math.floor((ly - G.y) / CELL);
      if (c >= G.cols || r >= G.rows || (lx - G.x) % CELL > 31 || (ly - G.y) % CELL > 31) return null;
      return list[(first + r) * G.cols + c] || null;
    };
    const ci = cell(CINV, this.inv, this.cfirst);
    if (ci) return { cash: ci };
    const ii = cell(IINV, this.myItems(), this.ifirst);
    if (ii) return { item: ii[1] };
    for (let t = 1; t <= 5; t++) if (lx >= 177 && lx < 242 && ly >= 453 + (t - 1) * 27 && ly < 476 + (t - 1) * 27) return { itab: t };
    return null;
  }
  down(lx, ly) {
    if (!this.ready) return;
    const h = this.hit(lx, ly);
    if (!h) return;
    if (h.tab !== undefined) this.setTab(h.tab);
    else if (h.sub !== undefined) { this.sub = h.sub; this.page = 0; }
    else if (h.page) this.page = Math.max(0, Math.min(this.pages() - 1, this.page + h.page));
    else if (h.card) { this.sel = h.card.SN; this.setPreview(h.card); }
    else if (h.itab) { this.itab = h.itab; this.ifirst = 0; sfx.play('UI/Tab'); }
  }
  dblclick(lx, ly) {
    const h = this.ready && this.hit(lx, ly);
    if (h?.cash) this.takeOut(h.cash);
    else if (h?.item) this.putIn(h.item);
    else if (h?.card && h.icon) this.buy(h.card);
  }
  wheel(dy) {
    const { x, y } = this.mgr.mouse, d = Math.sign(dy);
    if (x < 250 && y >= 340 && y < 425) this.cfirst = Math.max(0, Math.min(Math.ceil(this.inv.length / CINV.cols) - CINV.rows, this.cfirst + d));
    else if (x < 250 && y >= 440) this.ifirst = Math.max(0, Math.min(Math.ceil(this.myItems().length / IINV.cols) - IINV.rows, this.ifirst + d));
    else if (x > 270) this.page = Math.max(0, Math.min(this.pages() - 1, this.page + d));
  }
  tooltip(lx, ly) {
    const h = this.ready && this.hit(lx, ly);
    if (h?.card && h.icon && Math.floor(h.card.ItemId / 10000) === 910) {
      return { title: this.nameOf(h.card), lines: ['This package contains:', ...this.contents(h.card).map((c) => `  ${this.mgr.itemName(c.ItemId) || '?'}${c.Count > 1 ? ` x${c.Count}` : ''}`)] };
    }
    if (h?.card && h.icon && this.shownId(h.card)) return { item: { id: h.card.ItemId } };
    if (h?.cash) return { item: { id: h.cash.itemId, quantity: h.cash.quantity } };
    if (h?.item) return { item: h.item };
    return null;
  }
}
