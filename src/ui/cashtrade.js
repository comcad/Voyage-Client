import { itemInfo, itemName } from '../data.js';
import { drawParts } from '../character.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W } from '../view.js';
import { RESULTS, karma } from './trade.js';

/**
 * The cash trade room (UI/UIWindow.img/CashTradingRoom, 646x382), where Cash Shop items change hands. From the
 * client's drawing and the art:
 *   partner (left) / you (right): characters at (64, 101) / (335, 101), names centred on x 62 / 337 at y 109
 *   5 item rows a side, 40 apart: icon boxes x 6 / 207, y 132 + 40n (32x32); the item's name at x 47 / 248 (cut to
 *     140 px) with its time left under it
 *   mesos right-aligned to x 191 / 392 at y 331 (the coins at x 8 / 209)
 *   chat log x 404 y 24, 213x93; the chat line in the white box under it; the fee table below is the art's
 * TRADE and CANCEL are TradingRoom's buttons, as the client uses; their places, the coin's, ENTER's and the report
 * siren's were lost and are set by the art (TRADE / CANCEL in the dotted box between the characters).
 * Only Cash Shop items that may still be traded go in, the whole stack, one to a box; a trade makes them untradable.
 */
const BOX_X = [207, 6], NAME_X = [248, 47], ROW_Y = (n) => 132 + 40 * n, ROWS = 5;
/** Items with this end date or later never expire (2079-01-01). */
const PERMANENT = 150842304000000000n;
const ftMs = (ft) => Number(BigInt(ft) / 10000n) - 11644473600000;
const CASH_RESULTS = { ...RESULTS, 10: 'Trade was canceled because there was an item\r\nthat disappeared because it expired.',
  11: 'A cash item trade was canceled\r\ndue to a server check.' };
/** Equipment is for men (0), women (1), or anyone (2); everything else is for anyone. */
const genderOf = (id) => (Math.floor(id / 1000000) === 1 ? [0, 1][Math.floor(id / 1000) % 10] ?? 2 : 2);

export class CashTradeWin extends Win {
  constructor(mgr) {
    const T = mgr.W.TradingRoom, C = mgr.W.CashTradingRoom;
    super(mgr, C.backgrnd, Math.round((UI_W - 646) / 2), 109);   // centred on the 800x600 screen, as the client places it
    this.buttons = []; this.closeBtn = null;
    this.cash = true; this.transient = false;
    this.partner = null;                  // { name, look }
    this.items = [{}, {}];                // [mine, theirs]: box 1-5 -> item
    this.meso = [0, 0]; this.confirmed = [false, false]; this.lines = [];
    this.mesoAtOpen = this.g.meso || 0;
    this.names = new Map();
    this.coin = this.button(T.BtCoin, 209, 332, () => this.offerMesos());
    this.tradeBtn = this.button(T.BtTrade, 169, 47, () => this.confirm());
    this.cancelBtn = this.button(T.BtReset, 169, 70, () => this.cancel());
    this.button(mgr.W.Messenger.BtEnter, 576, 132, () => this.sendChat());
    this.button(mgr.B.BtClaim, 612, 130, () => {});
    this.chat = new TextField(mgr.game.statusBar.layer, 0, 0, 168, 14, { max: 70, color: '#000' });
    this.chat.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.sendChat();
      else if (e.key === 'Escape') this.chat.el.blur();
    });
  }
  frames() { return [...super.frames()]; }
  sendChat() {
    const t = this.chat.value;
    if (!t) return;
    this.chat.value = '';
    this.g.roomChat?.(t);
    this.chat.el.focus();
  }
  nameOf(id) {
    if (!this.names.has(id)) { this.names.set(id, ''); itemName(this.g.assets, id).then((n) => this.names.set(id, n || '')); }
    return this.names.get(id);
  }
  /** "Time Limit Expired", or the days, hours and minutes left; null for an item that never expires. */
  timeLeft(it) {
    if (it.type !== 3 && BigInt(it.expiration ?? PERMANENT) >= PERMANENT) return null;
    const ms = ftMs(it.type === 3 ? it.pet?.dead ?? it.expiration : it.expiration) - Date.now();
    if (ms <= 0) return 'Time Limit Expired';
    const m = Math.floor(ms / 60000);
    return `${Math.floor(m / 1440)}days, ${Math.floor((m % 1440) / 60)}hours, and ${m % 60}minutes left`;
  }
  /** The ids of one side's items, box by box. */
  ids(side) { const out = []; for (let s = 1; s <= ROWS; s++) if (this.items[side][s]) out.push(this.items[side][s].id); return out; }

  // ---------------------------------------------------------------- server events
  partnerJoined(name, look) { this.partner = { name, look }; this.say(`${name} has entered the trade.`, '#555'); }
  setItem(side, slot, item) { this.items[side][slot] = item; this.nameOf(item.id); }
  setMeso(side, meso) { this.meso[side] = meso; }
  /** Your partner confirmed: their items as you see them go back (ids, with checksums Voyage doesn't make: 0). */
  partnerConfirmed() { this.confirmed[1] = true; this.g.net?.tradeTransaction(this.ids(1)); }
  say(text, color = '#000') { this.lines.push({ text, color }); if (this.lines.length > 60) this.lines.shift(); }
  ended(result) {
    this.chat.remove();
    this.mgr.close(this);
    this.g.tradeWin = null;
    const got = (this.g.meso || 0) - this.mesoAtOpen;
    if (result === 7 && got > 0 && got < this.meso[1] - this.meso[0]) this.mgr.notice(`Trade successful.\r\nReceived ${got} mesos after fees.\r\nPlease check the results.`);
    else if (CASH_RESULTS[result]) this.mgr.notice(CASH_RESULTS[result]);
  }

  // ---------------------------------------------------------------- your actions
  nextSlot() { for (let s = 1; s <= ROWS; s++) if (!this.items[0][s]) return s; return 0; }
  /**
   * An item into box (1-5): not sealed; a Cash Shop item (cash by its data, with its serial number) - anything else
   * goes through the ordinary trade; still carrying its trade mark; then, with your partner in and nothing confirmed,
   * one your partner may wear (equipment for the other gender can't go), into an empty box. The whole stack goes.
   */
  async offer(tab, pos, box = this.nextSlot()) {
    const it = this.g.inventory?.[tab]?.[pos];
    if (!it) return;
    if (it.type !== 3 && it.flag & 1) { this.mgr.notice('Sealed items cannot be\r\nsold, traded, or dropped.'); return; }
    const info = (await itemInfo(this.g.assets, it.id)) || {};
    if (!Number(info.cash) || !it.cashId) { this.mgr.notice("Please use 'Trade'."); return; }
    if (!karma(it)) { this.mgr.notice('This item is unavailable to trade with others.'); return; }
    if (this.confirmed[0] || !this.partner) return;
    const pg = this.partner.look?.gender ?? 2, ig = genderOf(it.id);
    if (pg !== 2 && ig !== 2 && pg !== ig) { this.mgr.notice('Cannot be traded due to gender inconsistencies.'); return; }
    if (!(box >= 1 && box <= ROWS) || this.items[0][box] || !this.g.canExclusive(500)) return;
    this.g.net?.tradeItem(tab, pos, it.quantity || 1, box);
    this.g.lockExclusive();
  }
  /** Mesos into the trade (1 to all you have; no daily limit here). */
  async offerMesos() {
    if (this.confirmed[0] || !this.partner || !this.g.canExclusive(500)) return;
    const v = await this.mgr.askNumber('How much money will you put up?', 1, 1, this.g.meso || 0);
    if (!v) return;
    this.g.net?.tradeMeso(v);
    this.g.lockExclusive();
  }
  /**
   * TRADE: what your partner offers that runs out is listed first ("Have you checked the time limit on the item?"),
   * then the warning that Cash Shop items can't be traded again once yours; your items go with the confirmation.
   */
  async confirm() {
    if (this.confirmed[0] || !this.partner) return;
    const marked = Object.values(this.items[1]).filter((it) => it && karma(it));
    const limited = marked.filter((it) => this.timeLeft(it) !== null);
    if (limited.length) {
      const list = limited.map((it) => `${cut(this.nameOf(it.id), 100)}(${this.timeLeft(it)})\r\n`).join('');
      if (!(await this.mgr.confirm(`${list}\r\nHave you checked the\r\ntime limit on the item?`)) || this.g.tradeWin !== this) return;
    }
    const yes = await this.mgr.confirm(marked.length
      ? 'Cash Items become untradable\r\nonce they have been traded and \r\nMaple Points cannot be accumulated\r\nusing Item Deletions in the Cash Shop.\r\n\r\nDo you really want to trade?'
      : 'Are you sure you want to trade?');
    if (!yes || this.confirmed[0] || !this.partner || this.g.tradeWin !== this) return;
    this.confirmed[0] = true;
    this.g.net?.tradeConfirm(this.ids(0));
  }
  cancel() { this.g.net?.tradeExit(); this.ended(2); }
  key(e) { if (e.key === 'Escape') this.cancel(); }
  boxAt(lx, ly) {
    for (let n = 0; n < ROWS; n++) if (lx >= BOX_X[0] && lx < BOX_X[0] + 33 && ly >= ROW_Y(n) && ly < ROW_Y(n) + 33) return n + 1;
    return 0;
  }
  /** An item dragged from the inventory: into the box of yours it was dropped on. */
  drop(lx, ly, c) {
    if (c.kind !== 'item' || typeof c.tab !== 'number') return;
    this.offer(c.tab, c.slot, this.boxAt(lx, ly));
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    this.tradeBtn.enabled = !!this.partner && !this.confirmed[0];
    this.coin.enabled = !this.confirmed[0];
    super.draw(ctx);
    this.chat.rect.x = this.x + 404; this.chat.rect.y = this.y + 133;
    this.chat.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
  }
  body(ctx) {
    const g = this.g, m = this.mgr;
    const partnerEnt = this.partner && [...g.others.values()].find((o) => o.name === this.partner.name);
    const pLook = this.partner?.look?.ready ? this.partner.look : partnerEnt?.look;
    for (const [look, name, x] of [[pLook, this.partner?.name, 64], [g.look, g.player.name, 335]]) {
      if (look) {
        ctx.save(); ctx.beginPath(); ctx.rect(x - 60, 8, 120, 96); ctx.clip();
        drawParts(ctx, g.assets, look.compose(look.standAction(), 0), x, 101, false); ctx.restore();
      }
      if (name) uiText(ctx, name, x - 2, 108, { color: '#fff', bold: true, align: 'center', size: 11 });
    }
    for (const side of [0, 1]) {
      for (let n = 0; n < ROWS; n++) {
        const it = this.items[side][n + 1];
        if (!it) continue;
        const x = BOX_X[side], y = ROW_Y(n);
        m.drawIcon(ctx, m.icon(it.id), x + 1, y + 1);
        if ([2, 3, 4].includes(Math.floor(it.id / 1000000)) && it.quantity > 1) m.count(ctx, it.quantity, x + 1, y + 21);
        uiText(ctx, cut(this.nameOf(it.id), 140), NAME_X[side], y + 2, { color: '#2000ff', size: 12 });
        const left = this.timeLeft(it);
        if (left) uiText(ctx, left, NAME_X[side], y + 18, { color: left === 'Time Limit Expired' ? '#ff2020' : '#555', size: 11 });
      }
      this.text(ctx, this.meso[side].toLocaleString('en-US'), side === 0 ? 391 : 190, 332, { align: 'right' });
      // a confirmed side gets a gold frame around its items
      if (this.confirmed[side]) { ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 2; ctx.strokeRect(BOX_X[side] - 2, ROW_Y(0) - 2, 189, 199); ctx.lineWidth = 1; }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(404, 24, 213, 93); ctx.clip();
    const rows = this.lines.flatMap((l) => wrapText(ctx, l.text, 205, 11).map((text) => ({ text, color: l.color }))).slice(-6);
    rows.forEach((l, i) => uiText(ctx, l.text, 406, 27 + i * 14, { color: l.color, size: 11 }));
    ctx.restore();
  }
  tooltip(lx, ly) {
    for (const side of [0, 1]) for (let n = 0; n < ROWS; n++) {
      const it = this.items[side][n + 1], x = BOX_X[side], y = ROW_Y(n);
      if (it && lx >= x && lx < x + 33 && ly >= y && ly < y + 33) return { item: it };
    }
    return null;
  }
}

/** Text cut to `width` px (Arial 12). */
function cut(t, width) {
  const ctx = (cut.ctx ??= document.createElement('canvas').getContext('2d'));
  t = String(t || '');
  ctx.font = '12px Arial, sans-serif';
  if (ctx.measureText(t).width > width) { while (t && ctx.measureText(`${t}..`).width > width) t = t.slice(0, -1); t += '..'; }
  return t;
}
