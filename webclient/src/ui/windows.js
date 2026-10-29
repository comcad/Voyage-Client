import { isCanvas } from '../assets.js';
import { EXP, jobName, itemIcon, itemName, itemInfo, invType } from '../data.js';
import { sfx } from '../audio.js';
import { WzButton, uiText, wrapText } from './wzui.js';
import { richText, drawRich } from './richtext.js';

/**
 * In-game windows from UI/UIWindow.img, drawn on the game canvas like the v83 client:
 * draggable by the title bar, raised on click, closed with the "X CLOSE" tab, with tooltips,
 * double-click actions and drag-and-drop (inventory slots, skills/items onto the quick slots).
 * Positions inside each window are measured from its background art (see each class).
 */
const WHEEL_STEP = 100;

export class WindowManager {
  constructor(game, statusBar) {
    this.game = game; this.assets = game.assets; this.bar = statusBar;
    this.wins = {}; this.order = [];
    this.mouse = { x: -1, y: -1 }; this.drag = null; this.carry = null; this.tip = null;
    this.icons = new Map(); this.names = new Map(); this.infos = new Map(); this.descs = new Map(); this.lastDown = null; this.namesVersion = 0;
    this.strings = {};
    // modal dialogs take the keyboard: Enter / Escape go to them and the game's keys are held back
    addEventListener('keydown', (e) => this.keydown(e), true);
  }

  async load() {
    const a = this.assets;
    [this.W, this.B] = await Promise.all([a.json('UI/UIWindow.img'), a.json('UI/Basic.img')]);
    const make = { inventory: InventoryWin, equip: EquipWin, stat: StatWin, skill: SkillWin, quest: QuestWin, minimap: MiniMapWin, keyconfig: KeyConfigWin };
    for (const [k, C] of Object.entries(make)) this.wins[k] = new C(this);
    await a.preload([...Object.values(this.wins).flatMap((w) => w.frames()), ...allCanvases(this.B.VScr), ...allCanvases(this.B.ItemNo),
      ...allCanvases(this.W.UtilDlgEx), ...allCanvases(this.B.Notice3), ...allCanvases(this.B.YesNo3), ...allCanvases(this.W.ToolTip),
      ...['BtOK', 'BtYes', 'BtNo', 'BtCancel'].flatMap((k) => allCanvases(this.B[k]))]);
    Promise.all(['Mob', 'Npc', 'Map'].map((k) => a.json(`String/${k}.img`))).then(([mob, npc, map]) => { this.strings = { mob, npc, map }; this.namesVersion++; });
  }

  isOpen(name) { return this.order.includes(this.wins[name]); }
  open(name) {
    const w = this.wins[name];
    if (!w) return null;
    if (!this.order.includes(w)) { this.order.push(w); w.onOpen?.(); sfx.play('UI/MenuUp'); } else this.raise(w);
    return w;
  }
  close(w) {
    const i = this.order.indexOf(w);
    if (i >= 0) { this.order.splice(i, 1); sfx.play('UI/MenuDown'); this.tip = null; }
  }
  toggle(name, arg) {
    const w = this.wins[name];
    if (!w) return;
    if (this.isOpen(name) && !w.wantsArg?.(arg)) { this.close(w); return; }
    this.open(name);
    w.setArg?.(arg);
  }
  closeAll() {
    const keep = this.order.filter((w) => w.modal || w === this.wins.minimap);
    for (const w of this.order) if (!keep.includes(w)) w.onClose?.();
    if (this.order.length > keep.length) sfx.play('UI/MenuDown');
    this.order = keep;
  }
  /** A transient window (dialog, shop) on top of everything. */
  show(w) { this.order.push(w); sfx.play('UI/DlgNotice'); return w; }
  get modal() { for (let i = this.order.length - 1; i >= 0; i--) if (this.order[i].modal) return this.order[i]; return null; }
  keydown(e) {
    // Escape puts back an item held by a click
    if (e.key === 'Escape' && this.carry?.sticky) { e.preventDefault(); e.stopImmediatePropagation(); this.carry = null; return; }
    const top = this.modal || (this.order[this.order.length - 1]?.key && e.key === 'Escape' ? this.order[this.order.length - 1] : null);
    if (!top) return;
    const typing = e.target instanceof HTMLInputElement;
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); top.key?.(e); return; }
    if (!typing && this.modal) e.stopImmediatePropagation();   // no walking or attacking under a dialog
  }
  raise(w) { const i = this.order.indexOf(w); if (i >= 0 && i !== this.order.length - 1) { this.order.splice(i, 1); this.order.push(w); } }
  top(x, y) { for (let i = this.order.length - 1; i >= 0; i--) if (this.order[i].contains(x, y)) return this.order[i]; return null; }

  // ---------------------------------------------------------------- shared helpers
  /** Item icon node, loaded on first use (null until ready). */
  icon(id) {
    if (!this.icons.has(id)) {
      this.icons.set(id, null);
      itemIcon(this.assets, id).then(async (n) => { if (n) { await this.assets.preload([n]); this.icons.set(id, n); this.namesVersion++; } });
    }
    return this.icons.get(id);
  }
  itemName(id) {
    if (!this.names.has(id)) { this.names.set(id, ''); itemName(this.assets, id).then((n) => { this.names.set(id, n); this.namesVersion++; }); }
    return this.names.get(id);
  }
  /** An item's info node (requirements, base stats, price...), null until loaded. */
  info(id) {
    if (!this.infos.has(id)) { this.infos.set(id, null); itemInfo(this.assets, id).then((n) => { this.infos.set(id, n); this.namesVersion++; }); }
    return this.infos.get(id);
  }
  /** An item's description from String.wz. */
  desc(id) {
    if (!this.descs.has(id)) {
      this.descs.set(id, '');
      const t = invType(id), file = { 1: 'Eqp', 2: 'Consume', 3: 'Ins', 4: 'Etc', 5: 'Cash' }[t];
      this.assets.json(`String/${file}.img`).then((s) => {
        let n = null;
        if (t === 1) { for (const cat of Object.values(s?.Eqp || {})) if (cat?.[id]) n = cat[id]; } else n = t === 4 ? s?.Etc?.[id] : s?.[id];
        this.descs.set(id, n?.desc || ''); this.namesVersion++;
      });
    }
    return this.descs.get(id);
  }
  image(n) { return n ? this.assets.image(n) : null; }
  /** Item / skill icon in the 32x32 box at (x, y), placed by its origin like the client. */
  drawIcon(ctx, node, x, y) {
    const im = this.image(node);
    if (!im) return;
    const o = node.origin || [0, 32];
    ctx.drawImage(im, x - o[0], y + 32 - o[1]);
  }

  /** Basic.img/ItemNo digits: item counts on icons. */
  count(ctx, n, x, y) {
    let cx = x;
    for (const ch of String(n)) { const im = this.image(this.B.ItemNo[ch]); if (im) { ctx.drawImage(im, cx, y); cx += im.width; } }
  }

  startCarry(payload, node) { this.carry = { ...payload, node }; }
  /**
   * Put down what is being carried at (x, y): on the window there, on the quick slots, or outside
   * (the source decides - an item is dropped on the field). Returns whether a window took the event.
   */
  placeCarry(x, y) {
    const c = this.carry, w = this.top(x, y);
    this.carry = null;
    if (w) w.drop?.(x - w.x, y - w.y, c);
    else if (this.bar.contains?.(x, y)) this.bar.dropOnQuickSlot?.(x, y, c);
    else c.source?.dropOutside?.(c, x, y);
    return !!w;
  }

  // ---------------------------------------------------------------- input (canvas coordinates)
  pointer(type, x, y, dy = 0) {
    this.mouse = { x, y };
    if (this.drag) {
      const d = this.drag;
      d.win.x = Math.round(Math.max(-d.win.w + 40, Math.min(800 - 40, x - d.dx)));
      d.win.y = Math.round(Math.max(0, Math.min(600 - 40, y - d.dy)));
      if (type === 'up') this.drag = null;
      return true;
    }
    const modal = this.modal;
    let w = this.top(x, y);
    if (modal && w !== modal) w = null;   // a dialog takes every click while it is open
    for (const o of this.order) for (const b of o.buttons) b.hover = false;
    let over = null;
    if (w) {
      over = w.buttons.find((b) => b.visible && b.hit(x - w.x, y - w.y)) || null;
      if (over) over.hover = true;
      if (over && over !== this.hovered) sfx.play('UI/BtMouseOver');
    }
    this.hovered = over;
    // the wheel slides rows under a still cursor: keep the tooltip down until the mouse itself moves,
    // or it would pop from item to item (a flicker) as the list scrolls
    if (type === 'wheel') this.tipHeld = true;
    else if (type === 'move' && (x !== this.tipAt?.x || y !== this.tipAt?.y)) this.tipHeld = false;
    this.tipAt = { x, y };
    this.tip = w && !over && !this.carry && !this.tipHeld ? w.tooltip?.(x - w.x, y - w.y) : null;
    if (w) w.move?.(x - w.x, y - w.y);

    if (type === 'down') {
      // menus close on any click outside them
      for (const o of [...this.order]) if (o.transient && o !== w) this.close(o);
      // an item held by a click goes where the next click is (a quick second click on it is a double-click)
      const held = this.carry?.sticky ? this.carry : null, quick = held && performance.now() - held.at < 350 && Math.abs(held.x - x) < 4 && Math.abs(held.y - y) < 4;
      if (held && !quick) { this.lastDown = null; if (!modal || w === modal) this.placeCarry(x, y); return true; }
      if (!w) return !!modal;
      this.raise(w);
      const lx = x - w.x, ly = y - w.y;
      for (const b of w.buttons) b.down = b === over;
      if (!over && ly < 20 && !w.fixed) { this.drag = { win: w, dx: lx, dy: ly }; return true; }
      const now = performance.now(), last = this.lastDown;
      this.lastDown = { w, x, y, t: now };
      if (last && last.w === w && now - last.t < 350 && Math.abs(last.x - x) < 4 && Math.abs(last.y - y) < 4) {
        this.lastDown = null; this.carry = null; w.dblclick?.(lx, ly); return true;
      }
      if (!over) {
        w.down?.(lx, ly);
        if (this.carry) Object.assign(this.carry, { source: w, x, y, at: now });
      }
      return true;
    }
    if (type === 'up') {
      for (const o of this.order) if (typeof o.up === 'function') o.up();   // the mouse-up hook (sliders, drags)
      if (this.carry) {
        const c = this.carry;
        if (c.sticky) return !!w;
        // released where it was picked up: a click, not a drag - keep holding the item until the next click
        if (c.kind === 'item' && Math.abs(c.x - x) < 4 && Math.abs(c.y - y) < 4) { c.sticky = true; return true; }
        return this.placeCarry(x, y);
      }
      if (!w) return false;
      const target = w.buttons.find((b) => b.down && b === over);
      for (const b of w.buttons) b.down = false;
      target?.onClick();
      return true;
    }
    if (type === 'wheel') {
      if (!w) return !!modal;
      // one row per WHEEL_STEP of scroll: a row per mouse notch (~100), a trackpad glides through several
      if (this.wheelWin !== w) { this.wheelWin = w; this.wheelAcc = 0; }
      this.wheelAcc += dy;
      while (Math.abs(this.wheelAcc) >= WHEEL_STEP) {
        const s = Math.sign(this.wheelAcc);
        this.wheelAcc -= s * WHEEL_STEP;
        w.wheel?.(s);
      }
      return true;
    }
    return !!w || !!modal;
  }

  update(dt) { for (const w of this.order) for (const b of w.buttons) b.update(dt * 1000); }

  draw(ctx) {
    for (const w of this.order) w.draw(ctx);
    if (this.carry?.node) {
      ctx.globalAlpha = 0.7; this.drawIcon(ctx, this.carry.node, this.mouse.x - 16, this.mouse.y - 16); ctx.globalAlpha = 1;
    }
    if (this.tip?.item) this.drawItemTip?.(ctx, this, this.tip.item, this.mouse.x + 14, this.mouse.y + 18);
    else if (this.tip) drawTip(ctx, this.tip, this.mouse.x + 14, this.mouse.y + 18);
  }
}

/** A window: background from UIWindow.img, its own buttons (window-local coords) and the close button. */
/**
 * The client's tab strip (tab type 1, Basic.img/Tab2), as openms recovered it: `count` tabs share `span` px
 * from x 7 at y 23, each a stretched fill plus an 8px edge (a 4px end on the last), after a 4px left cap.
 * The selected tab uses the "1" pieces and the edge just before it the "2" one; each window's own
 * Tab/enabled|disabled label is centred on its tab. Returns each tab's [x, width] for hit testing.
 */
export function drawTabStrip(ctx, mgr, labels, count, selected, span, y = 23) {
  const T = mgr.B.Tab2, im = (n) => mgr.image(n), rects = [];
  if (!T || !count) return rects;
  const width = Math.trunc((span - (count - 1) * 8 - 8) / count), rem = span - (width + 8) * count;
  const cap = im(T[selected === 0 ? 'left1' : 'left0']);
  if (cap) ctx.drawImage(cap, 3, y);
  let x = 7;
  for (let i = 0; i < count; i++) {
    const size = width + (i < rem ? 1 : 0), on = i === selected, last = i === count - 1;
    const fill = im(T[on ? 'fill1' : 'fill0']);
    if (fill) ctx.drawImage(fill, x, y, size, fill.height);
    const edge = im(T[last ? (on ? 'right1' : 'right0') : `middle${on ? 1 : i + 1 === selected ? 2 : 0}`]);
    if (edge) ctx.drawImage(edge, x + size, y);
    const label = im(labels?.[on ? 'enabled' : 'disabled']?.[i]);
    if (label) ctx.drawImage(label, x + Math.trunc(size / 2) - Math.trunc(label.width / 2), y + 11 - Math.trunc(label.height / 2));
    rects.push([x, size + 8, y]);
    x += size + 8;
  }
  return rects;
}
const tabAt = (rects, lx, ly) => (rects || []).findIndex(([x, w, y]) => lx >= x && lx < x + w && ly >= y && ly < y + 19);

/** The close box sits this far in from a window's right edge (12px wide, 5px margin). */
const CLOSE_INSET = 17;
export class Win {
  constructor(mgr, bg, x, y) {
    this.mgr = mgr; this.g = mgr.game; this.bg = bg; this.x = x; this.y = y;
    this.w = bg?._w || 175; this.h = bg?._h || 289;
    this.buttons = [];
    // Basic.img's small blue close box on the title bar's right end (kept there as the window resizes)
    this.closeBtn = this.button(mgr.B.BtClose, this.w - CLOSE_INSET, 6, () => mgr.close(this));
  }
  button(node, x, y, fn) {
    const b = new WzButton(node, x, y, () => { sfx.play('UI/BtMouseClick'); fn(); });
    this.buttons.push(b);
    return b;
  }
  frames() { return [this.bg, ...this.buttons.flatMap((b) => b.frames())].filter(isCanvas); }
  contains(x, y) { return x >= this.x && x < this.x + this.w && y >= this.y && y < this.y + this.h; }
  draw(ctx) {
    if (this.closeBtn && !this.closePinned) this.closeBtn.x = this.w - CLOSE_INSET;
    ctx.save(); ctx.translate(this.x, this.y);
    const bg = this.mgr.image(this.bg);
    if (bg) ctx.drawImage(bg, 0, 0);
    this.body(ctx);
    for (const b of this.buttons) b.draw(ctx, this.mgr.assets);
    ctx.restore();
  }
  body() {}
  text(ctx, t, x, y, o = {}) { uiText(ctx, String(t), x, y, { color: '#000', size: 11, ...o }); }

  /** A Basic.img/VScr scrollbar at (x, y) of height h; returns the new first row on click. */
  scrollbar(ctx, x, y, h, first, rows, visible) {
    const V = this.mgr.B.VScr, on = rows > visible, S = on ? V.enabled : V.disabled;
    const im = (n) => this.mgr.image(n);
    const base = im(S.base);
    if (base) ctx.drawImage(base, x, y + 12, 12, h - 24);
    const prev = im(on ? S.prev0 : S.prev), next = im(on ? S.next0 : S.next);
    if (prev) ctx.drawImage(prev, x, y);
    if (next) ctx.drawImage(next, x, y + h - 12);
    if (on) {
      const track = h - 24 - 12, t = Math.round(track * first / Math.max(1, rows - visible));
      const thumb = im(S.thumb0);
      if (thumb) ctx.drawImage(thumb, x, y + 12 + t);
    }
  }
  scrollClick(lx, ly, x, y, h, first, rows, visible) {
    if (lx < x || lx >= x + 12 || ly < y || ly >= y + h) return null;
    const max = Math.max(0, rows - visible);
    if (ly < y + 12) return Math.max(0, first - 1);
    if (ly >= y + h - 12) return Math.min(max, first + 1);
    return Math.max(0, Math.min(max, Math.round(((ly - y - 18) / (h - 36)) * max)));
  }
}

// ==================================================================== Item inventory
/**
 * Item.img backgrnd 175x289: tab strip y 22-40 (labels Tab/enabled|disabled, Equip..Cash),
 * slot grid 4 x 6 (columns every 36px from x 7, rows at y 51/85/118/152/186/219),
 * mesos box x 25-137 y 267-280 with BtCoin at its left.
 */
const INV_ROWS = [51, 85, 118, 152, 186, 219];
class InventoryWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Item;
    super(mgr, W.backgrnd, 600, 90);
    this.W = W; this.tab = 2; this.first = 0;
    this.button(W.BtCoin, 9, 266, () => this.dropMesos());
  }
  /** The coin button: drop 10 ~ 50,000 mesos on the ground (Cosmic's MesoDropHandler range). */
  async dropMesos() {
    const max = Math.min(50000, this.g.meso || 0);
    if (max < 10) { this.g.notice('You need at least 10 mesos to drop.'); return; }
    const v = await this.mgr.askNumber(`How many mesos will you drop?\n(10 ~ ${max.toLocaleString('en-US')})`, 10, 10, max);
    if (v) this.g.net?.dropMeso(v);
  }
  frames() { return [...super.frames(), ...allCanvases(this.W.Tab.enabled), ...allCanvases(this.W.Tab.disabled)]; }
  wantsArg(tab) { return tab !== undefined && tab !== this.tab; }
  setArg(tab) { if (tab !== undefined && tab !== this.tab) { this.tab = tab; this.first = 0; } }
  get limit() { return this.g.inventory?.limits?.[this.tab] || 24; }
  get rows() { return Math.ceil(this.limit / 4); }
  slotAt(lx, ly) {
    const c = Math.floor((lx - 7) / 36), r = INV_ROWS.findIndex((y) => ly >= y && ly < y + 33);
    if (c < 0 || c > 3 || r < 0) return 0;
    const slot = (this.first + r) * 4 + c + 1;
    return slot <= this.limit ? slot : 0;
  }
  body(ctx) {
    const g = this.g, inv = g.inventory, m = this.mgr;
    this.tabRects = drawTabStrip(ctx, m, this.W.Tab, 5, this.tab - 1, 170);
    const items = inv?.[this.tab] || {};
    for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) {
      const slot = (this.first + r) * 4 + c + 1;
      const x = 9 + c * 36, y = INV_ROWS[r] + 1;
      if (slot > this.limit) { const d = m.image(this.W.disabled); if (d) ctx.drawImage(d, x, y); continue; }
      const it = items[slot];
      if (!it || (m.carry?.slot === slot && m.carry.tab === this.tab)) continue;
      m.drawIcon(ctx, m.icon(it.id), x, y);
      if (this.tab !== 1 && it.quantity > 1) m.count(ctx, it.quantity, x, y + 21);
    }
    this.scrollbar(ctx, 156, 51, 201, this.first, this.rows, 6);
    this.text(ctx, (g.meso || 0).toLocaleString('en-US'), 135, 268, { align: 'right' });
  }
  down(lx, ly) {
    const hit = tabAt(this.tabRects, lx, ly);
    if (hit >= 0) { if (this.tab !== hit + 1) { this.tab = hit + 1; this.first = 0; sfx.play('UI/Tab'); } return; }
    const s = this.scrollClick(lx, ly, 156, 51, 201, this.first, this.rows, 6);
    if (s !== null) { this.first = s; return; }
    const slot = this.slotAt(lx, ly), it = slot && this.g.inventory?.[this.tab]?.[slot];
    if (it) { this.mgr.startCarry({ kind: 'item', tab: this.tab, slot, id: it.id }, this.mgr.icon(it.id)); sfx.play('UI/DragStart'); }
  }
  dblclick(lx, ly) {
    const slot = this.slotAt(lx, ly), it = slot && this.g.inventory?.[this.tab]?.[slot];
    if (it) this.g.useInventoryItem(this.tab, slot, it);
  }
  drop(lx, ly, c) {
    if (c.kind !== 'item') return;
    const to = this.slotAt(lx, ly);
    if (c.tab === this.tab && to && to !== c.slot) { this.g.net?.moveItem(this.tab, c.slot, to, this.g.inventory[this.tab][c.slot]?.quantity || 1); sfx.play('UI/DragEnd'); }
    else if (c.tab === 'equip' && this.tab === 1) this.g.unequip(c.slot);
  }
  /** Dragged onto the field: drop it (ITEM_MOVE to slot 0), asking how many of a stack. */
  async dropOutside(c) {
    if (c.kind !== 'item' || typeof c.tab !== 'number') return;
    const it = this.g.inventory?.[c.tab]?.[c.slot];
    if (!it || this.g.dead) return;
    let qty = 1;
    // throwing stars and bullets always go as a whole stack (the server drops them that way)
    if (c.tab !== 1 && it.quantity > 1 && ![207, 233].includes(Math.floor(it.id / 10000))) {
      qty = await this.mgr.askNumber(`How many will you drop?\n(1 ~ ${it.quantity})`, it.quantity, 1, it.quantity);
      if (!qty) return;
    }
    if (this.g.inventory?.[c.tab]?.[c.slot] === it) this.g.net?.moveItem(c.tab, c.slot, 0, qty);
  }
  wheel(dy) { this.first = Math.max(0, Math.min(this.rows - 6, this.first + Math.sign(dy))); }
  tooltip(lx, ly) {
    const slot = this.slotAt(lx, ly), it = slot && this.g.inventory?.[this.tab]?.[slot];
    return it ? { item: it } : null;
  }
}

// ==================================================================== Equipment
/**
 * Equip.img backgrnd 175x304: a 5-column grid of 33px cells, columns from x 5, rows from y 35
 * (separators at x 4/37/70/103/136/169 and y 34/67/100/...). Slot cell = [column, row].
 */
const EQUIP_CELLS = {
  [-1]: [1, 0], [-49]: [0, 1], [-2]: [1, 1], [-12]: [3, 1], [-13]: [4, 1], [-3]: [2, 2], [-4]: [3, 2],
  [-9]: [0, 3], [-5]: [1, 3], [-17]: [2, 3], [-11]: [3, 3], [-10]: [4, 3],
  [-8]: [0, 4], [-6]: [1, 4], [-50]: [2, 4], [-15]: [3, 4], [-16]: [4, 4], [-7]: [2, 5],
  [-18]: [0, 6], [-19]: [1, 6], [-20]: [2, 6], [-14]: [3, 6],
};
class EquipWin extends Win {
  constructor(mgr) { super(mgr, mgr.W.Equip.backgrnd, 420, 90); }
  slotAt(lx, ly) {
    const c = Math.floor((lx - 5) / 33), r = Math.floor((ly - 35) / 33);
    return Number(Object.entries(EQUIP_CELLS).find(([, p]) => p[0] === c && p[1] === r)?.[0]) || 0;
  }
  body(ctx) {
    const eq = this.g.inventory?.equipped || {}, m = this.mgr;
    for (const [slot, [c, r]] of Object.entries(EQUIP_CELLS)) {
      const it = eq[slot];
      if (!it || (m.carry?.tab === 'equip' && m.carry.slot === Number(slot))) continue;
      m.drawIcon(ctx, m.icon(it.id), 5 + c * 33, 35 + r * 33);
    }
  }
  down(lx, ly) {
    const slot = this.slotAt(lx, ly), it = slot && this.g.inventory?.equipped?.[slot];
    if (it) this.mgr.startCarry({ kind: 'item', tab: 'equip', slot, id: it.id }, this.mgr.icon(it.id));
  }
  dblclick(lx, ly) { const slot = this.slotAt(lx, ly); if (slot && this.g.inventory?.equipped?.[slot]) this.g.unequip(slot); }
  drop(lx, ly, c) { if (c.kind === 'item' && c.tab === 1) this.g.useInventoryItem(1, c.slot, this.g.inventory[1][c.slot]); }
  tooltip(lx, ly) { const slot = this.slotAt(lx, ly), it = slot && this.g.inventory?.equipped?.[slot]; return it ? { item: it } : null; }
}

// ==================================================================== Character stat
/**
 * Stat.img backgrnd 175x347: label boxes x 9-55, value fields x 56-165, rows (top y):
 * NAME 32, JOB 50, LEVEL 78, GUILD 96, HP 114, MP 131, EXP 149, FAME 166,
 * ABILITY POINT box x 62-88 y 218-233, STR 246, DEX 264, INT 282, LUK 300, bottom band y 320-345.
 * backgrnd2 (177x203) is the detail panel: 9 rows every 20px from y 8 (ATTACK .. JUMP).
 */
const AP = { hp: 0x800, mp: 0x2000, str: 0x40, dex: 0x80, int: 0x100, luk: 0x200 };
const STAT_ROWS = { hp: 114, mp: 131, str: 246, dex: 264, int: 282, luk: 300 };
class StatWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Stat;
    super(mgr, W.backgrnd, 10, 90);
    this.W = W; this.detail = false;
    this.ap = Object.entries(STAT_ROWS).map(([k, y]) => {
      const b = this.button(W.BtApUp, 151, y + 2, () => this.g.net?.distributeAp(AP[k]));
      return b;
    });
    this.button(W.BtDetail, 121, 324, () => { this.detail = !this.detail; });
  }
  frames() { return [...super.frames(), this.W.backgrnd2]; }
  contains(x, y) { return super.contains(x, y) || (this.detail && x >= this.x + this.w && x < this.x + this.w + 177 && y >= this.y + 144 && y < this.y + 347); }
  body(ctx) {
    const s = this.g.stats;
    if (!s) return;
    for (const b of this.ap) b.enabled = s.ap > 0;
    const need = EXP[s.level] || 1;
    const v = (t, y) => this.text(ctx, t, 62, y + 2);
    v(s.name, 32); v(jobName(s.job), 50); v(s.level, 78); v(s.guild || '-', 96);
    v(`${s.hp} / ${this.g.maxHpShown()}`, 114); v(`${s.mp} / ${this.g.maxMpShown()}`, 131);
    v(`${s.exp} (${((s.exp / need) * 100).toFixed(2)}%)`, 149); v(s.fame, 166);
    this.text(ctx, s.ap, 75, 220, { align: 'center' });
    v(s.str, 246); v(s.dex, 264); v(s.int, 282); v(s.luk, 300);
    if (this.detail) this.drawDetail(ctx, s);
  }
  drawDetail(ctx, s) {
    const bg = this.mgr.image(this.W.backgrnd2);
    if (!bg) return;
    ctx.save(); ctx.translate(this.w, 144);
    ctx.drawImage(bg, 0, 0);
    const eq = Object.values(this.g.inventory?.equipped || {});
    const sum = (k) => eq.reduce((a, it) => a + (it[k] || 0), 0);
    const max = this.g.maxDamage();
    const rows = [
      `${Math.max(1, Math.floor(max * 0.1))} ~ ${max}`, sum('wdef'), s.int + sum('matk'), s.int + sum('mdef'),
      Math.floor(s.dex * 0.8 + s.luk * 0.5) + sum('acc'), Math.floor(s.dex * 0.25 + s.luk * 0.5) + sum('avoid'),
      s.dex + s.int + s.luk + sum('hands'), `${100 + sum('speed')}%`, `${100 + sum('jump')}%`,
    ];
    rows.forEach((t, i) => this.text(ctx, t, 90, 10 + i * 20));
    ctx.restore();
  }
}

// ==================================================================== Skill inventory
/**
 * Skill.img backgrnd 175x289: tab strip y 22-40 (Tab ● I II III IV), header icon box x 6-40 y 47-83
 * with the job name bar x 40-167 y 52-78, list y 88-256 (four 141x35 rows, skill0 / skill1 when
 * selected, every 40px from y 93), SKILL POINT box x 82-111 y 264-278.
 */
class SkillWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Skill;
    super(mgr, W.backgrnd, 200, 90);
    this.W = W; this.first = 0; this.sel = null;
    this.spUp = [0, 1, 2, 3].map((i) => this.button(W.BtSpUp, 9 + 141 - 16, 93 + i * 40 + 20, () => this.raise(i)));
  }
  frames() { return [...super.frames(), this.W.skill0, this.W.skill1, ...allCanvases(this.W.Tab.enabled), ...allCanvases(this.W.Tab.disabled)]; }
  onOpen() { const b = this.books; this.book ??= b[b.length - 1]; }
  get books() { return this.g.skills?.jobBookIds || []; }
  get list() { return (this.g.skills?.bookSkills(this.book) || []).filter((id) => this.g.skills.maxLevel(id)); }
  get sp() {
    const g = this.g, b = this.book;
    if (b % 1000 === 0 || b === 2001) {
      const base = Math.floor(g.stats.job / 1000) * 1000;
      let used = 0;
      for (let i = 0; i < 3; i++) used += g.skills.level(base * 10000 + 1000 + i);
      return Math.max(0, Math.min(g.stats.level - 1, 6) - used);
    }
    return g.stats.sp || 0;
  }
  canRaise(id) {
    const sb = this.g.skills, req = sb.node(id)?.req;
    return this.sp > 0 && sb.level(id) < sb.maxLevel(id) && (!req || Object.entries(req).every(([r, lv]) => sb.level(Number(r)) >= lv));
  }
  raise(i) { const id = this.list[this.first + i]; if (id && this.canRaise(id)) this.g.net?.distributeSp(id); }
  rowAt(lx, ly) {
    const i = Math.floor((ly - 93) / 40);
    if (i < 0 || i > 3 || lx < 9 || lx > 150 || (ly - 93) % 40 >= 35) return -1;
    return this.first + i < this.list.length ? this.first + i : -1;
  }
  body(ctx) {
    const g = this.g, sb = g.skills, m = this.mgr;
    if (!sb || !g.stats) return;
    this.tabRects = drawTabStrip(ctx, m, this.W.Tab, this.books.length, this.books.indexOf(this.book), 34 * this.books.length);
    const book = sb.books[this.book], bi = book && !(book instanceof Promise) ? book.info?.icon : null;
    const bim = m.image(bi);
    if (bim) ctx.drawImage(bim, 6 + 4, 80 - 30);
    else if (bi) m.assets.preload([bi]);
    this.text(ctx, sb.bookName(this.book), 103, 59, { color: '#fff', align: 'center', size: 12 });
    const list = this.list;
    this.first = Math.min(this.first, Math.max(0, list.length - 4));
    for (let i = 0; i < 4; i++) {
      const id = list[this.first + i];
      this.spUp[i].visible = !!id;
      if (!id) continue;
      const y = 93 + i * 40, lv = sb.level(id);
      const row = m.image(id === this.sel ? this.W.skill1 : this.W.skill0);
      if (row) ctx.drawImage(row, 9, y);
      const icon = lv ? sb.icon(id) : sb.node(id)?.iconDisabled || sb.icon(id);
      if (m.image(icon)) m.drawIcon(ctx, icon, 9 + 2, y + 2); else if (icon) m.assets.preload([icon]);
      this.text(ctx, sb.name(id), 9 + 39, y + 3);
      this.text(ctx, `Lv. ${lv}/${sb.maxLevel(id)}`, 9 + 39, y + 20);
      this.spUp[i].enabled = this.canRaise(id);
    }
    this.scrollbar(ctx, 154, 92, 160, this.first, list.length, 4);
    this.text(ctx, this.sp, 97, 266, { align: 'center' });
  }
  down(lx, ly) {
    const hit = tabAt(this.tabRects, lx, ly);
    if (hit >= 0) { if (this.book !== this.books[hit]) { this.book = this.books[hit]; this.first = 0; sfx.play('UI/Tab'); } return; }
    const s = this.scrollClick(lx, ly, 154, 92, 160, this.first, this.list.length, 4);
    if (s !== null) { this.first = s; return; }
    const r = this.rowAt(lx, ly);
    if (r < 0) return;
    const id = this.list[r];
    this.sel = id;
    const sb = this.g.skills;
    // only learned, usable skills can be dragged onto a key
    if (lx < 9 + 36 && sb.level(id) && sb.kind(id, this.g.weaponId()) !== 'passive') this.mgr.startCarry({ kind: 'skill', id }, sb.icon(id));
  }
  wheel(dy) { this.first = Math.max(0, Math.min(this.list.length - 4, this.first + Math.sign(dy))); }
  tooltip(lx, ly) {
    const r = this.rowAt(lx, ly);
    if (r < 0 || lx > 9 + 36) return null;
    const sb = this.g.skills, id = this.list[r], lv = sb.level(id);
    const lines = [sb.desc(id).replace(/\\n/g, '\n')];
    if (lv) lines.push('', `[Current Level ${lv}]`, sb.hint(id, lv).replace(/\\n/g, '\n'));
    return { title: sb.name(id), lines };
  }
}

// ==================================================================== Quest
/**
 * Quest.img backgrnd 245x396 (list): title y 3-22, tab strip y 25-42 (Tab Available / In Progress /
 * Complete), list area y 46-370, bottom band y 371-392. backgrnd2 305x396 is the detail panel
 * opened to its right: blue name box x 16-285 y 26-124, text body from y 130, bottom band y 371-392.
 */
const QTAB_X = [10, 62, 120];
const QROW_Y = 50, QROW_H = 18, QROWS = 17;
class QuestWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Quest;
    super(mgr, W.backgrnd, 140, 60);
    this.W = W; this.tab = 1; this.first = 0; this.sel = null; this.lines = []; this.dfirst = 0;
    this.giveup = this.button(W.BtGiveup, 245 + 305 - 57 - 12, 373, () => {
      const id = this.sel;
      if (id) mgr.confirm(`Are you sure you want to give up the quest #b${this.g.quests.name(id)}#k?`).then((ok) => { if (ok) { this.g.net?.questAction(3, id); this.sel = null; } });
    });
    const a = mgr.assets;
    Promise.all(['Mob', 'Npc', 'Map'].map((k) => a.json(`String/${k}.img`))).then(([mob, npc, map]) => { this.str = { mob, npc, map }; });
  }
  frames() { return [...super.frames(), this.W.backgrnd2, this.W.icon0, this.W.icon1, this.W.icon2?.[0], ...allCanvases(this.W.Tab)].filter(isCanvas); }
  get wide() { return this.sel ? this.w + 305 : this.w; }
  contains(x, y) { return x >= this.x && x < this.x + this.wide && y >= this.y && y < this.y + this.h; }
  ids() {
    const book = this.g.quests;
    if (!book) return [];
    if (this.tab === 0) return book.available(this.g.textCtx());
    const src = this.tab === 1 ? book.started : book.completed;
    return Object.keys(src).map(Number).filter((id) => book.info[id]);
  }
  rowAt(lx, ly) {
    if (lx < 6 || lx > 228 || ly < QROW_Y) return -1;
    const i = Math.floor((ly - QROW_Y) / QROW_H);
    return i < QROWS && this.first + i < this.ids().length ? this.first + i : -1;
  }
  select(id) {
    this.sel = id; this.dfirst = 0;
    this.giveup.visible = this.g.quests.status(id) === 1;
    this.layoutDetail();
  }
  /** The detail text: the quest's own text for its phase, then requirements and rewards. */
  layoutDetail() {
    const g = this.g, book = g.quests, id = this.sel, st = book.status(id);
    const ctx = document.createElement('canvas').getContext('2d');
    let text = String(book.info[id]?.[String(st === 0 ? 0 : st === 1 ? 1 : 2)] || '');
    if (st !== 2) {
      const req = book.requirements(id), reqs = [];
      if (req.npc) reqs.push(`Talk to #b#p${req.npc}##k`);
      for (const m of req.mobs) reqs.push(`#o${m.id}#: ${Math.min(m.have, m.need)} / ${m.need}`);
      for (const it of req.items) reqs.push(`#t${it.id}#: ${g.itemCount(it.id)} / ${it.count ?? 1}`);
      if (reqs.length) text += `\n\n#eRequirements#n\n${reqs.join('\n')}`;
    }
    const rw = book.rewards(id), out = [];
    if (rw.exp) out.push(`${rw.exp} EXP`);
    if (rw.meso) out.push(`${rw.meso} mesos`);
    if (rw.fame) out.push(`${rw.fame} fame`);
    for (const it of rw.items) out.push(`#t${it.id}#${it.count > 1 ? ` x${it.count}` : ''}`);
    if (out.length) text += `\n\n#eRewards#n\n${out.join('\n')}`;
    this.lines = richText(ctx, text, 268, this.ref());
    this.laidOut = this.mgr.namesVersion;
  }
  ref() {
    const m = this.mgr, s = this.str || {};
    const mapName = (id) => { for (const r of Object.values(s.map || {})) if (r?.[id]) return r[id].mapName; return id; };
    return {
      player: this.g.player.name, item: (id) => m.itemName(id) || `item ${id}`, mob: (id) => s.mob?.[id]?.name || `monster ${id}`,
      npc: (id) => s.npc?.[id]?.name || `NPC ${id}`, map: (id) => mapName(id), count: (id) => this.g.itemCount(id), icon: (id) => m.icon(id),
    };
  }
  body(ctx) {
    const m = this.mgr, book = this.g.quests;
    if (!book) return;
    for (let t = 0; t < 3; t++) {
      const im = m.image(this.W.Tab[t === this.tab ? 'enabled' : 'disabled'][t]);
      if (im) ctx.drawImage(im, QTAB_X[t], 29);
    }
    const ids = this.ids(), qctx = this.g.textCtx();
    this.first = Math.min(this.first, Math.max(0, ids.length - QROWS));
    for (let i = 0; i < QROWS; i++) {
      const id = ids[this.first + i];
      if (id === undefined) break;
      const y = QROW_Y + i * QROW_H;
      if (id === this.sel) { ctx.fillStyle = '#4f7fc4'; ctx.fillRect(24, y, 202, 15); }
      const ready = this.tab === 1 && book.canComplete(id, qctx);
      const icon = m.image(this.tab === 0 ? this.W.icon0 : ready ? this.W.icon2?.[0] : this.W.icon1);
      if (icon) ctx.drawImage(icon, 8, y);
      this.text(ctx, book.name(id), 26, y + 1, { color: id === this.sel ? '#fff' : '#000' });
    }
    if (!ids.length) this.text(ctx, 'There are no quests here.', 122, 60, { align: 'center', color: '#777' });
    this.scrollbar(ctx, 229, 46, 324, this.first, ids.length, QROWS);
    if (this.sel) this.drawDetail(ctx);
  }
  drawDetail(ctx) {
    if (this.laidOut !== this.mgr.namesVersion || (!this.laidStr && this.str)) { this.laidStr = !!this.str; this.layoutDetail(); }
    const bg = this.mgr.image(this.W.backgrnd2);
    ctx.save(); ctx.translate(this.w, 0);
    if (bg) ctx.drawImage(bg, 0, 0);
    uiText(ctx, this.g.quests.name(this.sel), 30, 40, { color: '#fff', bold: true, size: 12 });
    // the body scrolls a few lines at a time (wheel over the panel)
    ctx.save(); ctx.beginPath(); ctx.rect(10, 128, 290, 240); ctx.clip();
    const top = this.lines.lines[this.dfirst]?.y || 0;
    drawRich(ctx, this.lines, 16, 132 - top, { drawIcon: (n, x, y) => this.mgr.drawIcon(ctx, n, x, y) });
    ctx.restore();
    ctx.restore();
  }
  down(lx, ly) {
    for (let t = 0; t < 3; t++) if (lx >= QTAB_X[t] - 2 && lx < QTAB_X[t] + 52 && ly >= 25 && ly < 43) { this.tab = t; this.first = 0; this.sel = null; sfx.play('UI/Tab'); return; }
    const s = this.scrollClick(lx, ly, 229, 46, 324, this.first, this.ids().length, QROWS);
    if (s !== null) { this.first = s; return; }
    const r = this.rowAt(lx, ly);
    if (r >= 0) this.select(this.ids()[r]);
  }
  wheel(dy) {
    if (this.mgr.mouse.x - this.x >= this.w && this.sel) this.dfirst = Math.max(0, Math.min(this.lines.lines.length - 10, this.dfirst + Math.sign(dy) * 2));
    else this.first = Math.max(0, Math.min(this.ids().length - QROWS, this.first + Math.sign(dy)));
  }
}

// ==================================================================== Minimap
/**
 * MiniMap frame: a 9-slice in three styles - MaxMap (72px header: title strip, then a blue band with
 * the map mark and street / map names), MinMap (29px header, title only) and Min (a 20px bar).
 * The map picture is the map itself - every layer's tiles and objects, no backgrounds - shrunk onto a
 * dark navy ground (the game's own miniMap canvas carries a blurred sky). Markers are
 * Map/MapHelper.img/minimap sprites centred on their spot.
 */
const MM_MODES = ['max', 'min', 'bar'];
// The map is shrunk to fit the view's width, but never below MIN_SCALE: a bigger map shows through
// the view centred on you (stopping at its edges). MAX_SCALE keeps small maps from blowing up.
const MM_VIEW = { w: 220, h: 100 }, MM_MIN_SCALE = 1 / 10, MM_MAX_SCALE = 1 / 5, MM_GROUND = '#1b2741';
class MiniMapWin extends Win {
  constructor(mgr) {
    super(mgr, null, 0, 0);
    this.buttons = [];                         // no CLOSE tab: M toggles it, like the client
    this.W = mgr.W.MiniMap; this.mode = 'max';
    const B = mgr.B;
    this.minBtn = this.button(B.BtMin, 0, 6, () => { this.mode = MM_MODES[Math.min(2, MM_MODES.indexOf(this.mode) + 1)]; });
    this.maxBtn = this.button(B.BtMax, 0, 6, () => { this.mode = MM_MODES[Math.max(0, MM_MODES.indexOf(this.mode) - 1)]; });
    this.worldBtn = this.button(this.W.BtMap, 0, 0, () => mgr.toggle('worldmap'));
    mgr.assets.json('Map/MapHelper.img').then((h) => { this.helper = h; mgr.assets.preload([...allCanvases(h?.minimap)]); });
    mgr.assets.json('String/Map.img').then((s) => { this.strMap = s; });
  }
  frames() { return [this.W.title, ...allCanvases(this.W.MinMap), ...allCanvases(this.W.MaxMap), ...allCanvases(this.W.Min), ...this.buttons.flatMap((b) => b.frames())]; }
  /** The shrunk map, drawn once per map (and again shortly after, for art that was still loading). */
  picture() {
    const map = this.g.map;
    if (!map?.bounds) return null;
    const p = this.pic, now = performance.now();
    if (p?.map === map && (p.final || now - p.at < 1500)) return p;
    const b = map.bounds, mw = b.right - b.left, mh = b.bottom - b.top;
    const k = Math.min(MM_MAX_SCALE, Math.max(MM_MIN_SCALE, MM_VIEW.w / mw));
    const c = p?.map === map ? p.canvas : document.createElement('canvas');
    c.width = Math.ceil(mw * k); c.height = Math.ceil(mh * k);
    const g = c.getContext('2d');
    g.fillStyle = MM_GROUND; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.setTransform(k, 0, 0, k, 0, 0);
    for (let l = 0; l < map.layers.length; l++) map.drawLayer(g, { x: b.left, y: b.top }, l);
    this.pic = { map, canvas: c, k, at: now, final: p?.map === map };
    return this.pic;
  }
  layout() {
    const img = this.picture()?.canvas;
    if (this.mode === 'bar') { this.w = 160; this.h = 20; } else {
      const F = this.mode === 'max' ? this.W.MaxMap : this.W.MinMap;
      const ctx = (this.measure ??= document.createElement('canvas').getContext('2d'));
      ctx.font = 'bold 13px Arial, sans-serif';
      const n = this.names(), names = Math.max(ctx.measureText(n.mapName || '').width, ctx.measureText(n.streetName || '').width);
      this.w = Math.ceil(Math.max(Math.min(img?.width || 120, MM_VIEW.w) + 12, 170, this.mode === 'max' ? 52 + names + 12 : 0));
      this.h = F.nw._h + Math.min(img?.height || 60, MM_VIEW.h) + F.sw._h;
    }
    // the title bar, right to left: WORLD, + and - (the bar alone keeps just +)
    this.minBtn.visible = this.mode !== 'bar'; this.maxBtn.visible = true;
    this.worldBtn.visible = this.mode !== 'bar';
    let bx = this.w - 6;
    for (const b of [this.worldBtn, this.maxBtn, this.minBtn]) {
      if (!b.visible) continue;
      const bw = b.frames()[0]?._w || 12;
      bx -= bw; b.x = bx; b.y = b === this.worldBtn ? 5 : 6; bx -= 2;
    }
  }
  draw(ctx) { this.layout(); super.draw(ctx); }
  names() {
    const id = this.g.map?.id;
    for (const r of Object.values(this.strMap || {})) if (r?.[id]) return r[id];
    return { mapName: this.g.map?.name || '', streetName: '' };
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n);
    if (this.mode === 'bar') {
      const [w, c, e] = ['w', 'c', 'e'].map((k) => im(this.W.Min[k]));
      if (w && c && e) { ctx.drawImage(w, 0, 0); ctx.drawImage(c, w.width, 0, this.w - w.width - e.width, 20); ctx.drawImage(e, this.w - e.width, 0); }
      uiText(ctx, this.names().mapName || '', 10, 4, { color: '#fff', size: 11, bold: true });
      return;
    }
    const F = this.mode === 'max' ? this.W.MaxMap : this.W.MinMap;
    nineSlice(ctx, m, F, this.w, this.h);
    const t = im(this.W.title);
    if (t) ctx.drawImage(t, 9, 9);
    const top = F.nw._h;
    if (this.mode === 'max') {
      const n = this.names(), mark = this.helper?.mark?.[this.g.map?.data?.info?.mapMark];
      if (mark) { if (im(mark)) ctx.drawImage(im(mark), 8, 26); else m.assets.preload([mark]); }
      // street and map name both bold white, outlined like the client's title text
      uiText(ctx, n.streetName || '', 52, 28, { color: '#fff', size: 13, bold: true, outline: '#2b3a55' });
      uiText(ctx, n.mapName || '', 52, 45, { color: '#fff', size: 13, bold: true, outline: '#2b3a55' });
    }
    const pic = this.picture();
    if (!pic) return;
    const map = pic.canvas, k = pic.k, b = this.g.map.bounds, g = this.g;
    // the visible part: centred on you, clamped to the map; a map smaller than the view is centred instead
    const vw = Math.min(map.width, MM_VIEW.w), vh = Math.min(map.height, MM_VIEW.h);
    const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
    const vx = clamp((g.player.x - b.left) * k - vw / 2, map.width - vw);
    const vy = clamp((g.player.y - 20 - b.top) * k - vh / 2, map.height - vh);
    const ox = Math.round((this.w - vw) / 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, top, vw, vh); ctx.clip();
    ctx.drawImage(map, vx, vy, vw, vh, ox, top, vw, vh);
    const H = this.helper?.minimap || {};
    const mark = (node, wx, wy) => {
      const s = im(node);
      if (s) ctx.drawImage(s, Math.round(ox + (wx - b.left) * k - vx - s.width / 2), Math.round(top + (wy - b.top) * k - vy - s.height / 2));
    };
    const qctx = g.textCtx?.();
    for (const p of g.map.portals) if (p.pt === 2) mark(H.portal, p.x, p.y);
    for (const e of g.map.life) {
      if (e.kind !== 'Npc') continue;
      const q = g.quests && qctx ? g.quests.npcQuests(Number(e.spawn.id), qctx) : null;
      mark(q?.complete?.length ? H.endnpc : q?.start?.length ? H.startnpc : H.npc, e.x, e.y - 10);
    }
    for (const o of g.others.values()) mark(H.another, o.x, o.y - 20);
    mark(H.user, g.player.x, g.player.y - 20);
    ctx.restore();
  }
}

function nineSlice(ctx, m, F, w, h) {
  const p = Object.fromEntries(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se', 'c'].map((k) => [k, m.image(F[k])]));
  if (Object.values(p).some((v) => !v)) return;
  const top = p.nw.height, bot = p.sw.height, l = p.w.width, r = p.e.width;
  ctx.drawImage(p.c, l, top, w - l - r, h - top - bot);
  ctx.drawImage(p.nw, 0, 0); ctx.drawImage(p.n, p.nw.width, 0, w - p.nw.width - p.ne.width, top); ctx.drawImage(p.ne, w - p.ne.width, 0);
  ctx.drawImage(p.w, 0, top, l, h - top - bot); ctx.drawImage(p.e, w - r, top, r, h - top - bot);
  ctx.drawImage(p.sw, 0, h - bot); ctx.drawImage(p.s, p.sw.width, h - bot, w - p.sw.width - p.se.width, bot); ctx.drawImage(p.se, w - p.se.width, h - bot);
}

// ==================================================================== Key config
/**
 * KeyConfig backgrnd 629x373 (origin at its centre, so it opens centred). Key caps were found in the
 * art (light 28x25 faces; wider for Shift/Ctrl/Alt/Space); the reserved pink keys (Esc, Tab, Screen
 * Shot) and keys without a KeyConfig/key label cannot be bound. Unbound functions wait in the
 * palette below: 3 rows of 18 cells (28x32), columns every 34px from x 10, rows at y 265/299/333.
 * KeyConfig/icon/<action> pictures menu (0-27), action (50-54) and face (100-106) bindings.
 */
const KEYCAPS = {
  59: [83, 29], 60: [117, 29], 61: [151, 29], 62: [185, 29], 63: [227, 29], 64: [261, 29], 65: [295, 29], 66: [329, 29],
  67: [371, 29], 68: [405, 29], 87: [439, 29], 88: [473, 29],
  41: [15, 68], 2: [49, 68], 3: [83, 68], 4: [117, 68], 5: [151, 68], 6: [185, 68], 7: [219, 68], 8: [253, 68], 9: [287, 68],
  10: [321, 68], 11: [355, 68], 12: [389, 68], 13: [423, 68], 82: [515, 68], 71: [549, 68], 73: [583, 68],
  16: [65, 101], 17: [99, 101], 18: [133, 101], 19: [167, 101], 20: [201, 101], 21: [235, 101], 22: [269, 101], 23: [303, 101],
  24: [337, 101], 25: [371, 101], 26: [405, 101], 27: [439, 101], 43: [473, 101], 83: [515, 101], 79: [549, 101], 81: [583, 101],
  30: [82, 134], 31: [116, 134], 32: [150, 134], 33: [184, 134], 34: [218, 134], 35: [252, 134], 36: [286, 134], 37: [320, 134],
  38: [354, 134], 39: [388, 134], 40: [422, 134],
  42: [15, 167, 78], 44: [99, 167], 45: [133, 167], 46: [167, 167], 47: [201, 167], 48: [235, 167], 49: [269, 167], 50: [303, 167],
  51: [337, 167], 52: [371, 167], 53: [405, 167],
  29: [15, 200, 43], 56: [114, 200, 47], 57: [167, 200, 164],
};
const PALETTE = { x: 10, step: 34, rows: [265, 299, 333], cols: 18 };
const FUNCTIONS = [...Array.from({ length: 28 }, (_, i) => [4, i]), ...[50, 51, 52, 53, 54].map((a) => [5, a]), ...[100, 101, 102, 103, 104, 105, 106].map((a) => [6, a])];

class KeyConfigWin extends Win {
  constructor(mgr) {
    const W = mgr.W.KeyConfig;
    super(mgr, W.backgrnd, 400 - 314, 300 - 186);
    this.buttons = [];
    this.W = W; this.draft = {}; this.picked = null;
    this.button(W.BtClose, 629 - 20, 4, () => mgr.close(this));
    this.button(W.BtDefault, 12, 236, async () => { this.draft = (await import('../keymap.js')).defaultKeymap(); });
    this.button(W.BtDelete, 78, 236, () => { this.draft = {}; this.picked = null; }); // the art reads CLEAR ALL
    this.button(W.BtQuickSlot, 161, 236, () => { mgr.bar.quickOpen = !mgr.bar.quickOpen; });
    this.button(W.BtOK, 629 - 112, 236, () => this.save());
    this.button(W.BtCancel, 629 - 60, 236, () => mgr.close(this));
  }
  frames() { return [...super.frames(), ...allCanvases(this.W.icon), ...allCanvases(this.W.key)]; }
  onOpen() { this.draft = Object.fromEntries(Object.entries(this.g.keymap || {}).map(([k, v]) => [k, { ...v }])); this.picked = null; }

  save() {
    const g = this.g, before = g.keymap || {}, changes = [];
    for (const sc of new Set([...Object.keys(before), ...Object.keys(this.draft)])) {
      const a = before[sc], b = this.draft[sc];
      if (a?.type === b?.type && a?.action === b?.action) continue;
      changes.push({ key: Number(sc), type: b?.type || 0, action: b?.action || 0 });
    }
    if (changes.length) g.net?.changeKeymap(changes);
    g.keymap = this.draft;
    this.mgr.bar.render();
    this.mgr.close(this);
  }

  /** The picture for a binding: function icon, skill icon or item icon. */
  iconFor(b) {
    if (!b) return null;
    if (b.type === 1) return this.g.skills?.icon(b.action) || null;
    if (b.type === 2) return this.mgr.icon(b.action);
    return this.W.icon[b.action] || null;
  }
  palette() {
    const bound = new Set(Object.values(this.draft).filter((b) => b.type >= 4).map((b) => `${b.type}:${b.action}`));
    return FUNCTIONS.filter(([t, a]) => this.W.icon[a] && !bound.has(`${t}:${a}`));
  }
  capAt(lx, ly) {
    for (const [sc, [x, y, w = 28]] of Object.entries(KEYCAPS)) if (lx >= x && lx < x + w && ly >= y && ly < y + 25) return Number(sc);
    return null;
  }
  paletteAt(lx, ly) {
    const c = Math.floor((lx - PALETTE.x) / PALETTE.step), r = PALETTE.rows.findIndex((y) => ly >= y && ly < y + 32);
    if (c < 0 || c >= PALETTE.cols || r < 0 || (lx - PALETTE.x) % PALETTE.step >= 28) return -1;
    return r * PALETTE.cols + c;
  }
  body(ctx) {
    const m = this.mgr;
    for (const [sc, [x, y]] of Object.entries(KEYCAPS)) {
      const b = this.draft[sc];
      if (!b || (m.carry?.fromSc === Number(sc))) continue;
      const icon = this.iconFor(b);
      if (icon && m.image(icon)) m.drawIcon(ctx, icon, x - 2, y - 4); else if (icon) m.assets.preload([icon]);
      // the key's own letter stays readable on top of what is bound to it
      const label = m.image(this.W.key?.[sc]);
      if (label) ctx.drawImage(label, x + 2, y + 1);
      if (this.picked === Number(sc)) { ctx.strokeStyle = '#ff0'; ctx.strokeRect(x + 0.5, y + 0.5, 27, 24); }
    }
    this.palette().forEach(([, a], i) => {
      if (i >= PALETTE.cols * 3) return;
      m.drawIcon(ctx, this.W.icon[a], PALETTE.x + (i % PALETTE.cols) * PALETTE.step - 2, PALETTE.rows[Math.floor(i / PALETTE.cols)]);
    });
  }
  down(lx, ly) {
    const sc = this.capAt(lx, ly);
    if (sc !== null) {
      this.picked = sc;
      const b = this.draft[sc];
      if (b) this.mgr.startCarry({ kind: 'bind', b, fromSc: sc }, this.iconFor(b));
      return;
    }
    const i = this.paletteAt(lx, ly), f = this.palette()[i];
    if (f) this.mgr.startCarry({ kind: 'bind', b: { type: f[0], action: f[1] } }, this.W.icon[f[1]]);
  }
  drop(lx, ly, c) {
    const sc = this.capAt(lx, ly);
    const b = c.kind === 'bind' ? c.b : c.kind === 'skill' ? { type: 1, action: c.id } : c.kind === 'item' && c.tab === 2 ? { type: 2, action: c.id } : null;
    if (!b) return;
    if (sc === null) { if (c.fromSc !== undefined) delete this.draft[c.fromSc]; return; } // dropped off the keys: unbind
    if (c.fromSc !== undefined && c.fromSc !== sc) delete this.draft[c.fromSc];
    // a function, skill or item lives on one key only
    for (const [k, v] of Object.entries(this.draft)) if (v.type === b.type && v.action === b.action && Number(k) !== sc) delete this.draft[k];
    this.draft[sc] = { ...b };
    this.picked = sc;
    sfx.play('UI/DragEnd');
  }
  dropOutside(c) { if (c.kind === 'bind' && c.fromSc !== undefined) delete this.draft[c.fromSc]; }
  tooltip(lx, ly) {
    const sc = this.capAt(lx, ly), b = sc !== null ? this.draft[sc] : null;
    if (!b) return null;
    const title = b.type === 1 ? this.g.skills.name(b.action) : b.type === 2 ? this.mgr.itemName(b.action) : null;
    return title ? { title, lines: [] } : null;
  }
}

// ==================================================================== tooltip
function drawTip(ctx, tip, x, y) {
  ctx.save();
  ctx.font = '11px Arial, sans-serif';
  const lines = tip.lines.flatMap((l) => (l ? wrapText(ctx, l, 220, 11) : ['']));
  const w = Math.max(ctx.measureText(tip.title).width + 16, ...lines.map((l) => ctx.measureText(l).width + 16), 80);
  const h = 22 + lines.length * 14 + 4;
  x = Math.min(x, 800 - w - 2); y = Math.min(y, 600 - h - 2);
  ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  uiText(ctx, tip.title, x + w / 2, y + 5, { color: '#fff', bold: true, size: 12, align: 'center' });
  lines.forEach((l, i) => uiText(ctx, l, x + 8, y + 22 + i * 14, { color: '#fff', size: 11 }));
  ctx.restore();
}

/** Every canvas anywhere under a node. */
export function allCanvases(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (isCanvas(node)) { out.push(node); return out; }
  for (const k in node) if (!k.startsWith('_')) allCanvases(node[k], out);
  return out;
}

