import { invType, itemInfo } from '../data.js';
import { isRechargeable } from '../net/proto.js';
import { permanent } from './itemguard.js';
import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W } from '../view.js';

/**
 * The trade room (UI/UIWindow.img/TradingRoom, 565x474). Measured from backgrnd:
 *   partner (left) / you (right): character boxes with shadows at (61, 100) / (218, 100),
 *     name bars x 18-102 / 179-263, y 107-121
 *   item grids, 3x3, cells 36x36 between 2px separators: columns x 6 / 45 / 84 (left) and
 *     170 / 208 / 248 (right), rows y 128 / 166 / 204 (shadow at +30); slots 1-9 left to right
 *   mesos: field x 24-117 / 187-280, the coin row y 244-257 (coin at x 7 / 170), the arrow row 259-270
 *   TRADE / CANCEL TRADE: stacked between the characters, inside the dots at x 105-182, y 45-90
 *   chat log x 296-541 y 24-238, chat line x 296-487 y 245-259
 * Items come in by dragging them from the inventory; the coin button offers mesos.
 */
const COLS = [[6, 45, 84], [170, 208, 248]], ROWS = [128, 166, 204];
/**
 * How a trade ended, as the client tells it (a notice; nothing for any other result, 1 included: the game server
 * sends 1 to whoever received mesos, with its own popup). A success that brought in fewer mesos than offered (the
 * fee) says how many came.
 */
export const RESULTS = { 2: 'Trade cancelled.\r\nby the other character.', 7: 'Trade successful.\r\nPlease check the results.',
  8: 'Trade unsuccessful.', 9: 'You cannot make the trade because\r\nthere are some items which\r\nyou cannot carry more than one.',
  12: "You cannot make the trade because\r\nthe other person's on a different map.",
  13: 'The game file has been damaged\r\nso you cannot participate in an item trade. Please try again\r\nafter reinstalling the game.' };
const UNTRADEABLE = 'This item is unavailable to trade with others.';
const LOW_LEVEL_LIMIT = 'Players that are Level 15 and below \r\nmay only trade 1 million mesos per day. \r\nYou have reached the limit today,\r\nplease try again tomorrow.';
/** Scissors of Karma's mark: 0x10 on equipment, 0x01 on a pet, 0x02 on anything else. */
export const karma = (it) => !!(it.flag & (it.type === 1 ? 0x10 : it.type === 3 ? 0x01 : 0x02));

export class TradeWin extends Win {
  constructor(mgr) {
    const T = mgr.W.TradingRoom;
    super(mgr, T.backgrnd, Math.round((UI_W - 565) / 2), 63);   // centred on the 800x600 screen, as the client places it
    this.buttons = [];
    this.T = T; this.transient = false;
    this.partner = null;                  // { name }
    this.items = [{}, {}];                // [mine, theirs]: slot -> item
    this.meso = [0, 0]; this.confirmed = [false, false]; this.lines = [];
    this.mesoAtOpen = this.g.meso || 0;   // to tell what a success brought in
    this.closeBtn = null;
    this.coin = this.button(T.BtCoin, 170, 244, () => this.offerMesos());   // over the art's own coin
    this.tradeBtn = this.button(T.BtTrade, 114, 47, () => this.confirm());
    this.cancelBtn = this.button(T.BtReset, 114, 70, () => this.cancel());   // v83 draws BtReset here, not BtCancel
    // ENTER sends the chat line as the Enter key does; the Report siren does nothing in the client either. Both lost
    // their places: ENTER right of the chat line, the siren in the blue band's end (unverified)
    this.button(mgr.W.Messenger.BtEnter, 490, 244, () => this.sendChat());
    this.button(mgr.B.BtClaim, 537, 242, () => {});
    this.chat = new TextField(mgr.game.statusBar.layer, 0, 0, 190, 14, { max: 70, color: '#000' });
    this.chat.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.sendChat();
      else if (e.key === 'Escape') this.chat.el.blur();
    });
  }
  frames() { return [...super.frames()]; }
  /** The line, if any, goes through the chat checks; the box is cleared. */
  sendChat() {
    const t = this.chat.value;
    if (!t) return;
    this.chat.value = '';
    this.g.roomChat?.(t);
    this.chat.el.focus();
  }

  // ---------------------------------------------------------------- server events
  // the look comes with the trade packet, so a hidden GM partner still shows up in the room
  partnerJoined(name, look) { this.partner = { name, look }; this.say(`${name} has entered the trade.`, '#555'); }
  // (an offer changing leaves both confirm marks as they are: once confirmed, your own offer can't change)
  setItem(side, slot, item) { this.items[side][slot] = item; }
  setMeso(side, meso) { this.meso[side] = meso; }
  /** Your partner confirmed: their items as you see them go back (ids, with checksums Voyage doesn't make: 0). */
  partnerConfirmed() {
    this.confirmed[1] = true;
    const ids = []; for (let s = 1; s <= 9; s++) if (this.items[1][s]) ids.push(this.items[1][s].id);
    this.g.net?.tradeTransaction(ids);
  }
  say(text, color = '#000') { this.lines.push({ text, color }); if (this.lines.length > 60) this.lines.shift(); }
  ended(result) {
    this.chat.remove();
    this.mgr.close(this);
    this.g.tradeWin = null;
    const got = (this.g.meso || 0) - this.mesoAtOpen;
    if (result === 7 && got > 0 && got < this.meso[1] - this.meso[0]) this.mgr.notice(`Trade successful.\r\nReceived ${got} mesos after fees.\r\nPlease check the results.`);
    else if (RESULTS[result]) this.mgr.notice(RESULTS[result]);
  }

  // ---------------------------------------------------------------- your actions
  nextSlot() { for (let s = 1; s <= 9; s++) if (!this.items[0][s]) return s; return 0; }
  /**
   * Whether an item may be traded at all, with the client's notice when not: sealed (pets never count as sealed);
   * cash; a quest item or an untradeable one (equipment marked 0x08, or info/tradeBlock) unless it carries Scissors of
   * Karma's mark; account-sharable whatever it carries.
   */
  async tradeable(it) {
    if (it.type !== 3 && it.flag & 1) { this.mgr.notice('Sealed items cannot be\r\nsold, traded, or dropped.'); return false; }
    const info = (await itemInfo(this.g.assets, it.id)) || {}, n = (k) => Number(info[k]) || 0;
    if (n('cash') || it.cashId || (n('quest') && !karma(it)) || (((it.type === 1 && it.flag & 0x08) || n('tradeBlock')) && !karma(it)) || n('accountSharable')) {
      this.mgr.notice(UNTRADEABLE); return false;
    }
    return true;
  }
  /**
   * An item into the trade, into cell (1-9; the one it was dropped on, MOBILE UI's the first free one). Once you have
   * confirmed, before your partner is in, into a cell already taken, or with a request still out, nothing happens.
   * A stack asks how many (all of it at first), except for equipment, cash items, stars and bullets (they all go) and
   * items that expire (one).
   */
  async offer(tab, pos, cell = this.nextSlot()) {
    const it = this.g.inventory?.[tab]?.[pos];
    if (!it || !(await this.tradeable(it))) return;
    if (this.confirmed[0] || !this.partner || !(cell >= 1 && cell <= 9) || this.items[0][cell] || !this.g.canExclusive(500)) return;
    let qty = 1;
    const asks = [2, 3, 4].includes(invType(it.id)) && !isRechargeable(it.id) && permanent(it.expiration);
    if (asks && it.quantity > 1) {
      qty = await this.mgr.askNumber('How many will you trade?', it.quantity, 1, it.quantity);
      if (!qty) return;
    }
    this.g.net?.tradeItem(tab, pos, qty, cell);
    this.g.lockExclusive();
  }
  /** Mesos into the trade (1 to all you have); at level 15 or below, no more than 1,000,000 at a time. */
  async offerMesos() {
    if (this.confirmed[0] || !this.partner || !this.g.canExclusive(500)) return;
    const v = await this.mgr.askNumber('How much money will you put up?', 1, 1, this.g.meso || 0);
    if (!v) return;
    if ((this.g.stats?.level || 0) < 16 && v > 1000000) { this.mgr.notice(LOW_LEVEL_LIMIT); return; }
    this.g.net?.tradeMeso(v);
    this.g.lockExclusive();
  }
  /** TRADE: asked first (warned when something your partner offers can't be traded again once yours). */
  async confirm() {
    if (this.confirmed[0] || !this.partner) return;
    const warn = Object.values(this.items[1]).some((it) => it && karma(it));
    const yes = await this.mgr.confirm(warn ? 'Some items you are trying to barter\r\ncannot be traded once received.\r\nWould you still like to proceed?' : 'Are you sure you want to trade?');
    if (!yes || this.confirmed[0] || !this.partner) return;
    this.confirmed[0] = true;
    // both sides' items, box by box (yours, then your partner's)
    const ids = [];
    for (let s = 1; s <= 9; s++) { if (this.items[0][s]) ids.push(this.items[0][s].id); if (this.items[1][s]) ids.push(this.items[1][s].id); }
    this.g.net?.tradeConfirm(ids);
  }
  cancel() { this.g.net?.tradeExit(); this.ended(2); }
  key(e) { if (e.key === 'Escape') this.cancel(); }
  /** An item dragged from the inventory: into your cell it was dropped on (32x32 boxes 39 apart across, 37 down). */
  drop(lx, ly, c) {
    if (c.kind !== 'item' || typeof c.tab !== 'number') return;
    const col = Math.floor((lx - 172) / 39), row = Math.floor((ly - 131) / 37);
    const inside = col >= 0 && col < 3 && row >= 0 && row < 3 && lx - 172 - col * 39 < 32 && ly - 131 - row * 37 < 32;
    this.offer(c.tab, c.slot, inside ? row * 3 + col + 1 : 0);
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    this.tradeBtn.enabled = !!this.partner && !this.confirmed[0];
    this.coin.enabled = !this.confirmed[0];
    super.draw(ctx);
    this.chat.rect.x = this.x + 297; this.chat.rect.y = this.y + 245;
    this.chat.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
  }
  body(ctx) {
    const g = this.g, m = this.mgr;
    const partnerEnt = this.partner && [...g.others.values()].find((o) => o.name === this.partner.name);
    const pLook = this.partner?.look?.ready ? this.partner.look : partnerEnt?.look;
    const people = [[pLook, this.partner?.name, 61], [g.look, g.player.name, 218]];
    for (const [look, name, x] of people) {
      if (look) {
        ctx.save(); ctx.beginPath(); ctx.rect(x - 50, 8, 100, 98); ctx.clip();
        drawParts(ctx, g.assets, look.compose(look.standAction(), 0), x, 100, false); ctx.restore();
      }
      if (name) uiText(ctx, name, x, 108, { color: '#fff', bold: true, align: 'center', size: 11 });
    }
    // grids: partner's items on the left, yours on the right
    [1, 0].forEach((side, gi) => {
      for (let s = 1; s <= 9; s++) {
        const it = this.items[side][s];
        if (!it) continue;
        const x = COLS[gi][(s - 1) % 3], y = ROWS[Math.floor((s - 1) / 3)];
        m.drawIcon(ctx, m.icon(it.id), x + 2, y + 1);
        if (invType(it.id) !== 1 && it.quantity > 1) m.count(ctx, it.quantity, x + 2, y + 22);
      }
      const mx = gi === 0 ? 114 : 277;
      this.text(ctx, this.meso[side].toLocaleString('en-US'), mx, 245, { align: 'right' });
      // a confirmed side gets a gold frame around its whole grid
      if (this.confirmed[side]) { ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 2; ctx.strokeRect(COLS[gi][0] - 2, ROWS[0] - 2, 117, 113); ctx.lineWidth = 1; }
    });
    // chat log
    ctx.save(); ctx.beginPath(); ctx.rect(296, 24, 245, 214); ctx.clip();
    // long lines wrap to the log's width; the newest 15 rows stay in view
    const rows = this.lines.flatMap((l) => wrapText(ctx, l.text, 236, 11).map((text) => ({ text, color: l.color }))).slice(-15);
    rows.forEach((l, i) => uiText(ctx, l.text, 299, 27 + i * 14, { color: l.color, size: 11 }));
    ctx.restore();
  }
  tooltip(lx, ly) {
    for (const [gi, side] of [[0, 1], [1, 0]]) for (let s = 1; s <= 9; s++) {
      const x = COLS[gi][(s - 1) % 3], y = ROWS[Math.floor((s - 1) / 3)], it = this.items[side][s];
      if (it && lx >= x && lx < x + 36 && ly >= y && ly < y + 36) return { item: it };
    }
    return null;
  }
}
