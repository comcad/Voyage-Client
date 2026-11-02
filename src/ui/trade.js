import { invType } from '../data.js';
import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win } from './windows.js';

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
// Cosmic sends 1 (not 7) to whoever received mesos, alongside its own "Transaction completed" popup
const RESULTS = { 1: 'The trade was successful.', 2: 'The trade has been cancelled.', 7: 'The trade was successful.', 8: 'The trade was unsuccessful.',
  9: 'The trade was unsuccessful: you can only hold one of a unique item.', 12: 'The trade was cancelled: you moved to another map.',
  13: 'The trade was unsuccessful.' };

export class TradeWin extends Win {
  constructor(mgr) {
    const T = mgr.W.TradingRoom;
    super(mgr, T.backgrnd, Math.round((800 - 565) / 2), 20);
    this.buttons = [];
    this.T = T; this.transient = false;
    this.partner = null;                  // { name }
    this.items = [{}, {}];                // [mine, theirs]: slot -> item
    this.meso = [0, 0]; this.confirmed = [false, false]; this.lines = [];
    this.closeBtn = null;
    this.coin = this.button(T.BtCoin, 170, 244, () => this.offerMesos());   // over the art's own coin
    this.tradeBtn = this.button(T.BtTrade, 114, 47, () => this.confirm());
    this.cancelBtn = this.button(T.BtCancel, 114, 70, () => this.cancel());
    this.chat = new TextField(mgr.game.statusBar.layer, 0, 0, 190, 14, { max: 70, color: '#000' });
    this.chat.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.chat.value.trim()) { this.g.net?.tradeChat(this.chat.value.trim()); this.chat.value = ''; }
      else if (e.key === 'Escape') this.chat.el.blur();
    });
  }
  frames() { return [...super.frames()]; }

  // ---------------------------------------------------------------- server events
  // the look comes with the trade packet, so a hidden GM partner still shows up in the room
  partnerJoined(name, look) { this.partner = { name, look }; this.say(`${name} has entered the trade.`, '#555'); }
  setItem(side, slot, item) { this.items[side][slot] = item; this.confirmed = [false, false]; }
  setMeso(side, meso) { this.meso[side] = meso; this.confirmed = [false, false]; }
  partnerConfirmed() { this.confirmed[1] = true; this.say(`${this.partner?.name || 'Your partner'} has confirmed the trade.`, '#0047b3'); }
  say(text, color = '#000') { this.lines.push({ text, color }); if (this.lines.length > 60) this.lines.shift(); }
  ended(result) {
    this.chat.remove();
    this.mgr.close(this);
    this.g.tradeWin = null;
    const t = RESULTS[result] || 'The trade has ended.';
    const ok = result === 7 || result === 1;
    this.g.hud.message(t, ok ? '#9fe07a' : '#ff9e9e');
    if (!ok && result !== 2) this.mgr.notice(t);
  }

  // ---------------------------------------------------------------- your actions
  nextSlot() { for (let s = 1; s <= 9; s++) if (!this.items[0][s]) return s; return 0; }
  async offer(tab, pos) {
    const it = this.g.inventory?.[tab]?.[pos];
    const slot = this.nextSlot();
    if (!it || !slot || this.confirmed[0]) return;
    let qty = 1;
    if (tab !== 1 && it.quantity > 1) {
      qty = await this.mgr.askNumber(`How many #t${it.id}# will you offer?\n(1 ~ ${it.quantity})`, it.quantity, 1, it.quantity);
      if (!qty) return;
    }
    this.g.net?.tradeItem(tab, pos, qty, slot);
  }
  async offerMesos() {
    if (this.confirmed[0]) return;
    const max = this.g.meso || 0;
    const v = await this.mgr.askNumber(`How many mesos will you offer?\n(0 ~ ${max.toLocaleString('en-US')})`, 0, 0, max);
    if (v !== null) this.g.net?.tradeMeso(v);
  }
  confirm() {
    if (this.confirmed[0] || !this.partner) return;
    this.confirmed[0] = true;
    this.g.net?.tradeConfirm();
    this.say('You have confirmed the trade. Waiting for your partner...', '#0047b3');
  }
  cancel() { this.g.net?.tradeExit(); this.ended(2); }
  key(e) { if (e.key === 'Escape') this.cancel(); }
  drop(lx, ly, c) {
    if (c.kind !== 'item' || typeof c.tab !== 'number') return;
    if (lx < 166 || lx > 286 || ly < 124 || ly > 240) { this.g.notice('Drop items on your side of the trade (the right grid).'); return; }
    this.offer(c.tab, c.slot);
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    this.tradeBtn.enabled = !!this.partner && !this.confirmed[0];
    this.coin.enabled = !this.confirmed[0];
    super.draw(ctx);
    this.chat.rect.x = this.x + 297; this.chat.rect.y = this.y + 245;
    this.chat.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / 800);
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
