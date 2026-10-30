import { invType } from '../data.js';
import { pad, frames } from '../assets.js';
import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win, allCanvases } from './windows.js';

/**
 * A player's personal shop (UIWindow.img/PersonalShop/backgrnd, 525 wide; its lower-left fee table hangs
 * under the 365px room). Measured from the art:
 *   owner panel x 5-228 y 30-150: the owner standing at (55,128) over the dark name bar (10-97, 133-148);
 *     the meso box 113-222 / 133-148; the button column centred on x 189 (guide dots at 165 / 213)
 *   visitors x 235-520: three spots at x 285 / 378 / 472 over the blue / red / green name bars
 *   stock x 5-205: five 40px rows from y 158 (icon cell 7-40, text from 45, Shop-style select), scrollbar 208
 *   chat x 241-503 y 160-325, its line at y 333
 * Owner, before START: drag items in (asked how many per bundle, how many bundles and the bundle's price),
 * double-click one to take it back. Visitors pick a row and BUY so many bundles.
 * Your own Hired Merchant opens the same room: set up the first time (ITEMS AVAILABLE / OPEN STORE / LEAVE STORE,
 * leaving takes the stock back), or kept up later from the stall (ORGANIZE collects the mesos it earned, CLOSE
 * closes it for good, LEAVE STORE reopens it). The meso box then shows what the merchant holds.
 */
const ROWS = 5, ROW_Y = 158, ROW_H = 40, SPOTS = [285, 378, 472];
const ERRORS = { 1: 'This shop is not open.', 2: 'The shop is full.', 3: 'Something went wrong.', 5: 'You have been expelled from the shop.',
  10: 'The shop has closed.', 15: 'You cannot open a shop here. Shops open in the Free Market rooms.', 16: 'You cannot open a shop here.',
  6: 'You need a Shop Permit.', 17: 'You cannot open a shop while another is nearby.' };

export class PlayerShopWin extends Win {
  constructor(mgr, d) {
    const P = mgr.W.PersonalShop;
    super(mgr, null, Math.round((800 - 525) / 2), 20);
    this.buttons = []; this.closeBtn = null;
    this.P = P; this.slot = d.slot; this.title = d.title; this.items = d.items; this.sold = d.sold;
    this.people = Object.fromEntries(d.people.map((p) => [p.slot, p]));
    this.open = d.slot !== 0;            // a visitor only ever sees an open shop
    // a Hired Merchant's room: no owner in it - its employee stands on the owner's spot
    if (d.merchant) {
      this.merchant = d; this.mesos = d.mesos;
      mgr.assets.json('Item/Cash/0503.img').then(async (m) => {
        const f = frames(m?.[pad(d.itemId, 8)]?.employee?.stand)[0];
        if (f) { await mgr.assets.preload([f]); this.employee = f; }
      });
    }
    this.first = 0; this.sel = -1; this.lines = [];
    this.w = 525; this.h = this.owner ? 553 : 365;   // the owner also sees the fee table under the room
    const bx = 149;
    const tip = () => this.mgr.notice('Drag an item from your inventory into the shop to put it up for sale.');
    if (this.owner && this.merchant && !d.firstTime) {
      const E = mgr.W.EntrustedShop;
      this.button(E.BtArrange, bx + 5, 44, () => this.g.net?.merchantOrganize());
      this.button(P.BtClose, bx, 68, () => this.closeMerchant());
    } else if (this.owner) {
      this.addBtn = this.button(P.BtItem, bx, 44, tip);
      this.startBtn = this.button(P.BtStart, bx, 68, () => this.start());
    } else this.buyBtn = this.button(P.BtBuy, bx, 68, () => this.buy());
    this.button(P.BtExit, bx, 92, () => this.leave());
    this.chat = new TextField(mgr.game.statusBar.layer, 0, 0, 258, 14, { max: 70, color: '#000' });
    this.chat.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.chat.value.trim()) { this.g.net?.tradeChat(this.chat.value.trim()); this.chat.value = ''; }
      else if (e.key === 'Escape') this.chat.el.blur();
    });
    this.say(this.owner && d.merchant && !d.firstTime ? `You are tending your store "${this.title}". Leave it to open it again.`
      : `${this.owner ? 'You opened' : 'You entered'} the shop "${this.title}".`, '#555');
    // tending your merchant: what it sold while you were away
    if (this.owner && d.merchant && !d.firstTime) {
      for (const s of d.sold || []) this.say(`${s.buyer} bought ${s.qty > 1 ? `${s.qty} x ` : ''}${mgr.itemName(s.id)} for ${s.mesos.toLocaleString('en-US')} mesos.`, '#0047b3');
      if (this.mesos) this.say(`ORGANIZE collects the ${this.mesos.toLocaleString('en-US')} mesos it has earned.`, '#555');
    }
  }
  get owner() { return this.slot === 0; }
  get ownMerchant() { return this.owner && !!this.merchant; }
  frames() { return [...super.frames(), ...allCanvases(this.P), ...allCanvases(this.mgr.W.EntrustedShop), ...allCanvases(this.mgr.B.ItemNo)]; }

  // ---------------------------------------------------------------- server events
  setItems(items, mesos) { this.items = items; this.sel = Math.min(this.sel, items.length - 1); if (mesos !== undefined) this.mesos = mesos; }
  visitor(slot, name, look) { this.people[slot] = { slot, name, look }; this.say(`${name} entered the shop.`, '#555'); sfx.play('UI/BtMouseClick'); }
  left(slot) {
    if (slot === this.slot) { this.end(); return; }
    const p = this.people[slot];
    if (p) this.say(`${p.name} left the shop.`, '#555');
    delete this.people[slot];
  }
  soldUpdate(index, qty, buyer) {
    const it = this.items[index];
    this.say(`${buyer} bought ${qty > 1 ? `${qty} x ` : ''}${it ? this.mgr.itemName(it.item.id) : 'an item'}.`, '#0047b3');
  }
  say(text, color = '#000') { this.lines.push({ text, color }); if (this.lines.length > 60) this.lines.shift(); }
  end(reason = 0) {
    this.chat.remove();
    this.mgr.close(this);
    if (this.g.playerShop === this) this.g.playerShop = null;
    if (reason && ERRORS[reason]) this.mgr.notice(ERRORS[reason]);
  }

  // ---------------------------------------------------------------- your actions
  async leave() {
    if (this.ownMerchant && !this.merchant.firstTime) { this.g.net?.merchantLeave(); this.end(); return; }   // it opens again
    if (this.ownMerchant && this.items.length) {
      // never opened: leaving gives the stock back and the merchant is gone
      if (!(await this.mgr.confirm('Leave without opening the store?\nYour items will be returned to you.'))) return;
      this.g.net?.merchantClose(); this.end(); return;
    }
    this.g.net?.pshopExit(); this.end();
  }
  async closeMerchant() {
    if (!(await this.mgr.confirm('Close your Hired Merchant?\nThe unsold items and its mesos come back to you.'))) return;
    this.g.net?.merchantClose(); this.end();
  }
  key(e) { if (e.key === 'Escape') this.leave(); }
  start() {
    if (!this.items.length) { this.mgr.notice('Put at least one item up for sale first.'); return; }
    this.g.net?.pshopOpenStore(); this.open = true;
    if (this.ownMerchant) {
      // the merchant keeps the shop from here on; you walk away from it
      if (this.g.net) this.g.net.roomType = 0;
      this.end(); this.mgr.notice('Your Hired Merchant is open.');
      return;
    }
    this.say('The shop is open.', '#0047b3');
  }
  /** An item dragged in from the inventory: ask how it is sold, then put it up. */
  async drop(lx, ly, c) {
    if (!this.owner || this.open || c.kind !== 'item' || typeof c.tab !== 'number') return;
    const it = this.g.inventory?.[c.tab]?.[c.slot];
    if (!it) return;
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
  draw(ctx) {
    if (this.startBtn) this.startBtn.visible = !this.open;
    if (this.addBtn) this.addBtn.visible = !this.open;
    if (this.buyBtn) this.buyBtn.enabled = this.sel >= 0 && this.items[this.sel]?.bundles > 0;
    super.draw(ctx);
    this.chat.rect.x = this.x + 242; this.chat.rect.y = this.y + 333;
    this.chat.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / 800);
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), g = this.g;
    // the full art carries the fee table below the room: only the owner, who pays it, sees that part
    if (!this.owner) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 525, 365); ctx.clip(); }
    const bg = im(this.P.backgrnd); if (bg) ctx.drawImage(bg, 0, 0);
    if (!this.owner) ctx.restore();
    uiText(ctx, this.title, 12, 6, { color: '#000', size: 12, bold: true });
    // the owner and the visitors on their spots
    const spot = (p, x) => {
      if (!p) return;
      // the server sends raw looks: draw the one already built for that character on the map
      const look = p.slot === this.slot ? g.look : [...g.others.values()].find((o) => o.name === p.name)?.look;
      if (look?.compose) { ctx.save(); ctx.beginPath(); ctx.rect(x - 45, 32, 90, 100); ctx.clip(); drawParts(ctx, g.assets, look.compose(look.standAction(), 0), x, 128, false); ctx.restore(); }
      uiText(ctx, p.name, x, 134, { color: '#fff', bold: true, size: 11, align: 'center' });
    };
    if (this.merchant && !this.people[0]) {
      const e = this.employee, ei = e && m.image(e);
      if (ei) { const o = e.origin || [ei.width / 2, ei.height]; ctx.drawImage(ei, 55 - o[0], 128 - o[1]); }
      uiText(ctx, this.merchant.ownerName, 55, 134, { color: '#fff', bold: true, size: 11, align: 'center' });
    } else spot(this.people[0], 55);
    SPOTS.forEach((x, i) => spot(this.people[i + 1], x));
    this.text(ctx, ((this.ownMerchant ? this.mesos : g.meso) || 0).toLocaleString('en-US'), 219, 135, { align: 'right' });
    // the stock
    for (let i = 0; i < ROWS; i++) {
      const idx = this.first + i, r = this.items[idx];
      if (!r) break;
      const y = ROW_Y + i * ROW_H;
      if (idx === this.sel) { const s = im(this.P.select); if (s) ctx.drawImage(s, 41, y); }
      m.drawIcon(ctx, m.icon(r.item.id), 8, y + 1);
      if (r.perBundle > 1) m.count(ctx, r.perBundle, 8, y + 22);
      ctx.save(); ctx.beginPath(); ctx.rect(44, y, 160, 35); ctx.clip();
      this.text(ctx, m.itemName(r.item.id), 46, y + 3, { bold: true });
      this.text(ctx, `${r.price.toLocaleString('en-US')} mesos  x${r.bundles}`, 46, y + 19);
      ctx.restore();
      if (r.bundles <= 0) { const so = im(this.P.soldout); if (so) ctx.drawImage(so, 6, y); }
    }
    this.scrollbar(ctx, 208, 156, 196, this.first, this.items.length, ROWS);
    // chat
    ctx.save(); ctx.beginPath(); ctx.rect(241, 160, 262, 165); ctx.clip();
    const rows = this.lines.flatMap((l) => wrapText(ctx, l.text, 256, 11).map((text) => ({ text, color: l.color }))).slice(-11);
    rows.forEach((l, i) => uiText(ctx, l.text, 244, 163 + i * 15, { color: l.color, size: 11 }));
    ctx.restore();
  }
  rowAt(lx, ly) {
    if (lx < 6 || lx > 205 || ly < ROW_Y) return -1;
    const i = Math.floor((ly - ROW_Y) / ROW_H);
    if (i >= ROWS || (ly - ROW_Y) % ROW_H >= 35) return -1;
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
