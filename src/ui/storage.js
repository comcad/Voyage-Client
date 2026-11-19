import { pad } from '../assets.js';
import { invType, itemInfo } from '../data.js';
import { drawParts } from '../character.js';
import { Anim } from '../map.js';
import { sfx } from '../audio.js';
import { isRechargeable } from '../net/proto.js';
import { permanent } from './itemguard.js';
import { Win, allCanvases } from './windows.js';
import { UI_W } from '../view.js';

/**
 * The storage (UI/UIWindow.img/Trunk, 463x318), as the client draws it. The left panel is the storage: 5 rows 40px
 * apart from y 87, each slot it has drawn with Trunk/en (the chosen one with Trunk/select), icon at x 9, name at
 * x 50, quantity under the icon. The right panel is your inventory by tab: 4 rows from y 127, icon at x 238, name
 * at x 279, the chosen row with Trunk/select. The keeper stands animated at (53, 76) and you at (288, 75); the
 * mesos are right-aligned to x 190 and 418 on y 296. One row is chosen at a time, in either panel.
 *
 * The buttons' places (and the tabs') aren't in what is known of the client; they sit on the art's guide dots.
 */
const ROW_H = 40;
const LEFT = { rows: 5, y: 87, cell: 6, icon: 9, name: 50, sel: 43, hit: [7, 169], bar: 211, barH: 180 };
const RIGHT = { rows: 4, y: 127, icon: 238, name: 279, sel: 273, hit: [236, 398], bar: 442, barH: 146 };
const TABS = [1, 2, 3, 4, 5];
/** The storage's answers, in the client's words; any other is "Due to an error, the trade did not happen." */
const ERRORS = { 0x0A: 'Please check if your inventory is full or not.', 0x0B: 'You do not have enough mesos.',
  0x0C: 'Item could not be retrieved\r\nbecause there was an item that\r\ncould only be acquired once.',
  0x10: 'You do not have enough mesos.', 0x11: 'The storage is full.' };
/** Scissors of Karma's mark: 0x10 on equipment, 0x02 on anything else. */
const karma = (it) => !!(it.flag & (it.type === 1 ? 0x10 : 0x02));
/** A name cut to fit width px, ending in "..". */
function fit(ctx, t, width) {
  if (ctx.measureText(t).width <= width) return t;
  while (t && ctx.measureText(`${t}..`).width > width) t = t.slice(0, -1);
  return `${t}..`;
}

export class StorageWin extends Win {
  constructor(mgr, s) {
    const T = mgr.W.Trunk;
    super(mgr, T.backgrnd, Math.round((UI_W - 463) / 2), 60);
    this.buttons = [];
    this.T = T; this.npc = s.npc; this.slots = s.slots; this.meso = s.meso;
    this.tab = 1; this.first = [0, 0];
    this.sel = { side: -1, idx: -1 };   // one row chosen, in the storage (0) or your inventory (1)
    this.pending = false;               // a request out: nothing else goes until the storage answers
    this.fees = { get: -1, put: -1 };   // the keeper's info/trunkGet and trunkPut (-1 when it has none)
    this.infos = new Map();
    this.setAll(s.items);
    // on the guide dots (their places aren't known)
    this.button(T.BtGet, 152, 34, () => this.takeOut());
    this.button(T.BtSort, 152, 60, () => this.arrange());
    this.button(T.BtPut, 382, 14, () => this.store());
    this.button(T.BtExit, 382, 40, () => this.close());
    this.button(T.BtOutCoin, 5, 293, () => this.mesoOut());
    this.button(T.BtInCoin, 235, 293, () => this.mesoIn());
    mgr.assets.json(`Npc/${pad(s.npc, 7)}.img`).then(async (n) => {
      const own = n?.info || {};
      this.fees = { get: Number(own.trunkGet) || -1, put: Number(own.trunkPut) || -1 };
      if (n?.info?.link) n = (await mgr.assets.json(`Npc/${pad(n.info.link, 7)}.img`)) || n;
      const anim = n?.stand ? new Anim(n.stand) : null;
      if (!anim?.frames.length) return;
      anim.defaultDelay = 180;
      await mgr.assets.preload(anim.frames);
      this.keeper = anim;
    });
    this.learn();
  }
  frames() { return [...super.frames(), this.T.select, this.T.en, ...allCanvases(this.T.Tab)]; }

  // ---------------------------------------------------------------- server state
  /**
   * The server answers a take-out with an index into typeItems[type], which it fills with the WHOLE list when the
   * storage opens or is arranged, and with just that type's items after a store or a take-out. Keep the same lists
   * so the index sent picks the item meant. Any answer ends the request out.
   */
  setAll(items) { this.items = items; this.typeItems = Object.fromEntries(TABS.map((t) => [t, items])); this.answered(); }
  setType(type, items) {
    this.typeItems[type] = items;
    this.items = [...this.items.filter((it) => invType(it.id) !== type), ...items].sort((a, b) => invType(a.id) - invType(b.id));
    this.answered();
  }
  setMeso(meso) { this.meso = meso; this.answered(); }
  error(code) { this.answered(); this.mgr.notice(ERRORS[code] || 'Due to an error, the trade did not happen.'); }
  /**
   * The storage answered: the choice in it goes. After a take-out your inventory turns to that item's tab, with the
   * row that changed chosen and in view.
   */
  answered() {
    this.pending = false;
    if (this.sel.side === 0) this.sel = { side: -1, idx: -1 };
    this.first[0] = Math.max(0, Math.min(this.first[0], this.slots - LEFT.rows));
    const took = this.took;
    this.took = null;
    if (!took) return;
    if (this.tab !== took.type) { this.tab = took.type; this.first[1] = 0; }
    const now = this.mine(), i = now.findIndex((r, k) => r.it !== took.before[k]?.it);
    if (i < 0) return;
    this.sel = { side: 1, idx: i };
    if (i < this.first[1]) this.first[1] = i;
    if (this.first[1] + 4 < i) this.first[1] = i - 4;
    this.learn();
  }

  // ---------------------------------------------------------------- your inventory
  /** What can be told about each item of the tab (cash, quest, untradeable), loaded as needed. */
  learn() {
    for (const it of Object.values(this.g.inventory?.[this.tab] || {})) {
      if (it && !this.infos.has(it.id)) { this.infos.set(it.id, null); itemInfo(this.g.assets, it.id).then((i) => this.infos.set(it.id, i || {})); }
    }
  }
  /** Your items of the tab that may be stored: not cash, and not quest or untradeable unless they carry Karma's mark. */
  mine() {
    const inv = this.g.inventory?.[this.tab] || {};
    return Object.entries(inv).map(([pos, it]) => ({ pos: Number(pos), it })).sort((a, b) => a.pos - b.pos).filter(({ it }) => {
      const info = this.infos.get(it.id) || {}, n = (k) => Number(info[k]) || 0;
      if (n('cash') || it.cashId) return false;
      return !((n('quest') || (it.type === 1 && it.flag & 0x08) || n('tradeBlock')) && !karma(it));
    });
  }

  // ---------------------------------------------------------------- your actions
  /**
   * TAKE OUT (or a chosen storage row double-clicked): the whole stack, after a yes - to a warning first if it
   * carries Karma's mark, then to the fee (or the plain question when the keeper charges none).
   */
  async takeOut() {
    const it = this.sel.side === 0 ? this.items[this.sel.idx] : null;
    if (!it || this.pending) return;
    if (karma(it) && !(await this.mgr.confirm('Once found, the item cannot be traded.\r\nWould you still like to find it?'))) return;
    const fee = this.fees.get;
    if (!(await this.mgr.confirm(fee < 1 ? 'Are you sure you want to \r\nrecover the item(s) from storage?' : `Recovering the items will cost ${fee} mesos.\r\nAre you sure you want to recover this?`))) return;
    if (this.pending || this.items[this.sel.idx] !== it) return;
    const type = invType(it.id), slot = this.typeItems[type].indexOf(it);
    if (slot < 0) return;
    this.g.net?.storageTakeOut(type, slot);
    this.pending = true;
    this.took = { type, before: this.tab === type ? this.mine() : (this.tab = type, this.first[1] = 0, this.mine()) };
    this.sel = { side: -1, idx: -1 };
  }
  /** STORE (or a chosen inventory row double-clicked). */
  store() {
    const row = this.sel.side === 1 ? this.mine()[this.sel.idx] : null;
    if (row) this.storeItem(this.tab, row.pos);
  }
  /**
   * An item into the storage: a warning first if it carries Karma's mark; how many, for a stack of Use, Set-up or
   * Etc that doesn't expire (not stars or bullets: those, equipment, cash items and items that expire go one, the
   * game server taking a whole recharge stack); then the fee, or the plain question. Sent only if it is still there.
   */
  async storeItem(tab, pos) {
    const it = this.g.inventory?.[tab]?.[pos];
    if (!it || this.pending) return;
    if (karma(it) && !(await this.mgr.confirm('Once stored in the Inventory,\r\nthe item cannot be traded\r\nby the character when taken out.\r\nWould you still like to store it?'))) return;
    let qty = 1;
    if ([2, 3, 4].includes(invType(it.id)) && !isRechargeable(it.id) && permanent(it.expiration)) {
      const max = it.quantity || 1;
      qty = await this.mgr.askNumber('How many will you store?', max, 1, max);
      if (!qty || qty > max) return;
    }
    const fee = this.fees.put;
    if (!(await this.mgr.confirm(fee < 1 ? 'Are you sure you want to store the item(s)?' : `Storing this will cost ${fee} mesos.\r\nAre you sure you want to store this?`))) return;
    if (this.pending || this.g.inventory?.[tab]?.[pos] !== it) return;
    this.g.net?.storageStore(pos, it.id, qty);
    this.pending = true;
  }
  /** ARRANGE: no question. */
  arrange() {
    if (this.pending) return;
    this.g.net?.storageArrange();
    this.pending = true;
  }
  // mesos: a positive amount comes out of the storage, a negative one goes in
  async mesoOut() {
    if (this.pending) return;
    const v = await this.mgr.askNumber('How much will you take out?', this.meso, 1, this.meso);
    if (!(v > 0 && v <= this.meso) || this.pending) return;
    this.g.net?.storageMeso(v);
    this.pending = true;
  }
  async mesoIn() {
    if (this.pending) return;
    const v = await this.mgr.askNumber('How much will you save?', this.g.meso || 0, 1, this.g.meso || 0);
    if (!(v > 0 && v <= (this.g.meso || 0)) || this.pending) return;
    this.g.net?.storageMeso(-v);
    this.pending = true;
  }
  close() { this.mgr.close(this); this.g.net?.storageClose(); this.g.storageWin = null; }
  key(e) { if (e.key === 'Escape') this.close(); }
  drop(lx, ly, c) { if (c.kind === 'item' && typeof c.tab === 'number') this.storeItem(c.tab, c.slot); }
  /** Choose a row (the other panel's choice goes); null, the tab. */
  choose(side, idx) { this.sel = { side, idx }; }
  setTab(t) { if (t === this.tab) return; this.tab = t; this.first[1] = 0; if (this.sel.side === 1) this.sel = { side: -1, idx: -1 }; this.learn(); sfx.play('UI/Tab'); }

  // ---------------------------------------------------------------- frame
  /** The row under (lx, ly) on a side: its index in the list (the storage counts its empty slots too), or -1. */
  rowAt(lx, ly, side) {
    const L = side ? RIGHT : LEFT;
    if (lx < L.hit[0] || lx > L.hit[1] || ly < L.y) return -1;
    const i = Math.floor((ly - L.y) / ROW_H);
    if (i >= L.rows || (ly - L.y) % ROW_H >= 35) return -1;
    return this.first[side] + i;
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), g = this.g;
    const now = performance.now(), dt = now - (this.lastT ?? now);
    this.lastT = now;
    if (this.keeper) {
      this.keeper.update(dt);
      const f = this.keeper.node, img = im(f);
      if (img) { const o = f.origin || [img.width / 2, img.height]; ctx.drawImage(img, Math.round(53 - o[0]), Math.round(76 - o[1])); }
    }
    if (g.look) drawParts(ctx, m.assets, g.look.compose(g.look.standAction(), 0), 288, 75, false);
    // your tabs: Equip / Use / Set-up / Etc / Cash. Both label sets are plain white, so the chosen tab
    // gets a dark box behind it and the others are dimmed
    let tx = 244;
    TABS.forEach((t, i) => {
      const on = t === this.tab, ti = im(this.T.Tab[on ? 'enabled' : 'disabled'][i]);
      if (!ti) return;
      if (on) { ctx.fillStyle = 'rgba(40,70,120,0.75)'; ctx.fillRect(tx - 5, 92, ti.width + 10, 22); }
      ctx.globalAlpha = on ? 1 : 0.55; ctx.drawImage(ti, tx, 98); ctx.globalAlpha = 1;
      this[`tabX${t}`] = [tx, ti.width]; tx += ti.width + 14;
    });
    this.storageRows(ctx);
    this.inventoryRows(ctx);
    this.text(ctx, this.meso.toLocaleString('en-US'), 190, 296, { align: 'right', size: 12 });
    this.text(ctx, (g.meso || 0).toLocaleString('en-US'), 418, 296, { align: 'right', size: 12 });
  }
  /** One row's icon, quantity (Use, Set-up and Etc) and name. */
  row(ctx, L, top, it) {
    const m = this.mgr;
    m.drawIcon(ctx, m.icon(it.id), L.icon, top + 2);
    if ([2, 3, 4].includes(invType(it.id)) && it.quantity > 1) m.count(ctx, it.quantity, L.icon - 2, top + 22);
    ctx.save(); ctx.font = '12px Arial, "Segoe UI", sans-serif';
    const name = fit(ctx, m.itemName(it.id) || '', 141);
    ctx.restore();
    this.text(ctx, name, L.name, top + 1, { size: 12 });
  }
  storageRows(ctx) {
    const m = this.mgr, L = LEFT;
    for (let i = 0; i < L.rows; i++) {
      const idx = this.first[0] + i, top = L.y + i * ROW_H, it = this.items[idx];
      if (this.sel.side === 0 && idx === this.sel.idx) { const s = m.image(this.T.select); if (s) ctx.drawImage(s, L.sel, top); }
      else if (idx < this.slots) { const e = m.image(this.T.en); if (e) ctx.drawImage(e, L.cell, top); }
      if (it) this.row(ctx, L, top, it);
    }
    // over every slot, the empty ones too
    this.scrollbar(ctx, L.bar, L.y, L.barH, this.first[0], Math.max(this.slots, this.items.length), L.rows);
  }
  inventoryRows(ctx) {
    const m = this.mgr, L = RIGHT, rows = this.mine();
    for (let i = 0; i < L.rows; i++) {
      const idx = this.first[1] + i, top = L.y + i * ROW_H, r = rows[idx];
      if (!r) break;
      if (this.sel.side === 1 && idx === this.sel.idx) { const s = m.image(this.T.select); if (s) ctx.drawImage(s, L.sel, top); }
      this.row(ctx, L, top, r.it);
    }
    this.scrollbar(ctx, L.bar, L.y, L.barH, this.first[1], rows.length, L.rows);
  }
  down(lx, ly) {
    for (const t of TABS) {
      const tx = this[`tabX${t}`];
      if (tx && lx >= tx[0] - 6 && lx < tx[0] + tx[1] + 6 && ly >= 88 && ly < 116) { this.setTab(t); return; }
    }
    const counts = [Math.max(this.slots, this.items.length), this.mine().length];
    for (const side of [0, 1]) {
      const L = side ? RIGHT : LEFT;
      const s = this.scrollClick(lx, ly, L.bar, L.y, L.barH, this.first[side], counts[side], L.rows);
      if (s !== null) { this.first[side] = s; return; }
      const r = this.rowAt(lx, ly, side);
      if (r >= 0 && r < (side ? counts[1] : this.items.length)) { this.choose(side, r); return; }
    }
  }
  /** Double-clicking the chosen row takes it out or stores it. */
  dblclick(lx, ly) {
    for (const side of [0, 1]) {
      const r = this.rowAt(lx, ly, side);
      if (r < 0 || this.sel.side !== side || this.sel.idx !== r) continue;
      if (side === 0) this.takeOut(); else this.store();
      return;
    }
  }
  wheel(dy) {
    const side = this.mgr.mouse.x - this.x < 230 ? 0 : 1, L = side ? RIGHT : LEFT;
    const n = side ? this.mine().length : Math.max(this.slots, this.items.length);
    this.first[side] = Math.max(0, Math.min(n - L.rows, this.first[side] + Math.sign(dy)));
  }
  /** The item's tip anywhere on its row. */
  tooltip(lx, ly) {
    const l = this.rowAt(lx, ly, 0);
    if (l >= 0 && this.items[l]) return { item: this.items[l] };
    const r = this.rowAt(lx, ly, 1), rows = r >= 0 ? this.mine() : [];
    if (rows[r]) return { item: rows[r].it };
    return null;
  }
}
