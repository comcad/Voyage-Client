import { isCanvas } from '../assets.js';
import { EXP, jobName, itemIcon, itemName, itemInfo, invType, isScroll } from '../data.js';
import { sfx } from '../audio.js';
import { WzButton, TextField, uiText, wrapText } from './wzui.js';
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
    if (i >= 0) { this.order.splice(i, 1); sfx.play('UI/MenuDown'); this.tip = null; w.onClose?.(); }
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
    for (const w of this.order) {
      try { w.draw(ctx); } catch (e) {
        // a window that throws mid-draw would leave saves / clips open and blank everything after it:
        // report it once, put the canvas back and go on with the rest
        if (!w.drawFailed) { w.drawFailed = true; console.error(`${w.constructor.name} failed to draw`, e); }
        for (let i = 0; i < 32; i++) ctx.restore();   // surplus restores are no-ops; this unwinds whatever it left open
        this.game.fitBacking?.();
      }
    }
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
    if (c.tab === 2 && isScroll(c.id) && this.tab === 1 && to && this.g.inventory[1][to]) { this.g.useScroll(c.slot, to); return; }
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
/**
 * Equip.img pet (177x181), opened beside the window by BtPetEquipShow: a 4-column grid of 33px cells from
 * (13, 12), labelled HP POC / PET HP / MP POC / PET MP, ITEM POC / MESO MAG, ITEM IGNORE / PICK UP / POS /
 * PET EQUIP, MOVE UP / PET RING x2. Slots as equipSlotFor gives them.
 */
const PET_CELLS = {
  [-123]: [0, 0], [-124]: [2, 0], [-122]: [0, 1], [-121]: [1, 1],
  [-128]: [0, 2], [-127]: [1, 2], [-126]: [2, 2], [-114]: [3, 2], [-125]: [0, 3],
};
const PET_X = 175;
class EquipWin extends Win {
  constructor(mgr) {
    super(mgr, mgr.W.Equip.backgrnd, 420, 90);
    const E = mgr.W.Equip;
    this.closePinned = true; this.closeBtn.x = 175 - 17;
    this.petOpen = false;
    this.petShow = this.button(E.BtPetEquipShow, 175 - 60, 283, () => this.togglePet());
    this.petHide = this.button(E.BtPetEquipHide, 175 - 60, 283, () => this.togglePet());
    this.togglePet(false);
  }
  frames() { return [...super.frames(), this.mgr.W.Equip.pet]; }
  togglePet(open = !this.petOpen) {
    this.petOpen = open;
    this.w = open ? PET_X + 177 : 175;
    this.petShow.visible = !open; this.petHide.visible = open;
  }
  slotAt(lx, ly) {
    if (this.petOpen && lx >= PET_X) {
      const c = Math.floor((lx - PET_X - 13) / 33), r = Math.floor((ly - 12) / 33);
      return Number(Object.entries(PET_CELLS).find(([, p]) => p[0] === c && p[1] === r)?.[0]) || 0;
    }
    const c = Math.floor((lx - 5) / 33), r = Math.floor((ly - 35) / 33);
    return Number(Object.entries(EQUIP_CELLS).find(([, p]) => p[0] === c && p[1] === r)?.[0]) || 0;
  }
  body(ctx) {
    const eq = this.g.inventory?.equipped || {}, m = this.mgr;
    const cells = [...Object.entries(EQUIP_CELLS).map(([s, [c, r]]) => [s, 5 + c * 33, 35 + r * 33])];
    if (this.petOpen) {
      const panel = m.image(m.W.Equip.pet);
      if (panel) ctx.drawImage(panel, PET_X, 0);
      cells.push(...Object.entries(PET_CELLS).map(([s, [c, r]]) => [s, PET_X + 13 + c * 33, 12 + r * 33]));
    }
    for (const [slot, x, y] of cells) {
      const it = eq[slot];
      if (!it || (m.carry?.tab === 'equip' && m.carry.slot === Number(slot))) continue;
      m.drawIcon(ctx, m.icon(it.id), x, y);
    }
  }
  down(lx, ly) {
    const slot = this.slotAt(lx, ly), it = slot && this.g.inventory?.equipped?.[slot];
    if (it) this.mgr.startCarry({ kind: 'item', tab: 'equip', slot, id: it.id }, this.mgr.icon(it.id));
  }
  dblclick(lx, ly) { const slot = this.slotAt(lx, ly); if (slot && this.g.inventory?.equipped?.[slot]) this.g.unequip(slot); }
  drop(lx, ly, c) {
    if (c.kind !== 'item') return;
    if (c.tab === 2 && isScroll(c.id)) { const slot = this.slotAt(lx, ly); if (slot) this.g.useScroll(c.slot, slot); return; }   // a scroll onto what you wear
    if (c.tab === 1) this.g.useInventoryItem(1, c.slot, this.g.inventory[1][c.slot]);
  }
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
/**
 * The Skill Macro editor (UIWindow.img/SkillMacro, 207x289), attached to the skill window's right side
 * by its MACRO button (Basic.img/BtMacro at 120,265), laid out as openms recovered it: three of the five
 * macros show at a time (rows at y 56 + 45n, scrollbar at 185,54): macroslot (skill cells 1-2-3 at x 20 +
 * 37n) and macroslot1 holding the macro's own icon (Macroicon/<n>, x 146), macroslot2 behind the chosen
 * one. Below line02 sits macroname: its icon (22,200), the name field (59,215, 12 letters) and the SHOUT
 * SKILL NAME check box (166,241). Save (BtOK2 154,265) sends SKILL_MACRO; Cancel (BtCancel2 103,265)
 * drops the edits. Skills are dragged in from the list; right-click empties a cell; the macro icon is
 * dragged onto a key (key type 8) or a quick slot.
 */
const MACRO_W = 207, MACRO_ROWS = 3;
const emptyMacro = () => ({ name: '', shout: false, skills: [0, 0, 0] });
class SkillWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Skill;
    super(mgr, W.backgrnd, 200, 90);
    this.W = W; this.first = 0; this.sel = null;
    this.spUp = [0, 1, 2, 3].map((i) => this.button(W.BtSpUp, 9 + 141 - 16, 93 + i * 40 + 20, () => this.raise(i)));
    this.skillW = this.w; this.closePinned = true; this.closeBtn.x = this.skillW - 17;
    this.M = mgr.W.SkillMacro; this.mSel = -1; this.mFirst = 0;
    this.button(mgr.B.BtMacro, 120, 265, () => this.toggleMacro());
    this.mSave = this.button(mgr.B.BtOK2, this.skillW + 154, 265, () => this.saveMacros());
    this.mCancel = this.button(mgr.B.BtCancel2, this.skillW + 103, 265, () => { this.draft = null; this.toggleMacro(false); });
    this.toggleMacro(false);
  }
  frames() {
    const M = this.M;
    return [...super.frames(), this.W.skill0, this.W.skill1, ...allCanvases(this.W.Tab.enabled), ...allCanvases(this.W.Tab.disabled),
      M.backgrnd, M.macroslot, M.macroslot1, M.macroslot2, M.macroname, M.line01, M.line02, ...allCanvases(M.Macroicon), ...allCanvases(this.mgr.B.CheckBox)];
  }

  // ---------------------------------------------------------------- skill macros
  toggleMacro(open = !this.macroOpen) {
    this.macroOpen = open;
    this.w = this.skillW + (open ? MACRO_W : 0);
    this.mSave.visible = this.mCancel.visible = open;
    if (open) { this.draft = (this.g.macros || []).map((m) => ({ ...m, skills: [...m.skills] })); this.mSel = Math.max(0, this.mSel); }
    while (open && this.draft.length < 5) this.draft.push(emptyMacro());
    if (open && !this.nameField) {
      this.nameField = new TextField(this.g.statusBar.layer, 0, 0, 117, 16, { max: 12, color: '#000' });
      this.nameField.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') this.nameField.el.blur(); });
      this.nameField.el.addEventListener('input', () => { const m = this.draft?.[this.mSel]; if (m) m.name = this.nameField.value; });
    }
    if (this.nameField) { this.nameField.show(open); if (open) this.nameField.value = this.draft[this.mSel]?.name || ''; }
  }
  onClose() { this.nameField?.show(false); this.macroOpen && this.toggleMacro(false); }
  saveMacros() {
    const list = this.draft || [];
    this.g.macros = list.map((m) => ({ ...m, skills: [...m.skills] }));
    this.g.net?.skillMacros(list);
    this.g.statusBar?.render();
    this.toggleMacro(false);
  }
  /** Which macro row / part is under (lx, ly): { row, slot 0-2 } or { row, icon: true }. */
  macroAt(lx, ly) {
    const x = lx - this.skillW;
    for (let r = 0; r < MACRO_ROWS; r++) {
      const y = 56 + 45 * r, row = this.mFirst + r;
      if (ly < y - 3 || ly >= y + 35) continue;
      if (x >= 143 && x < 181) return { row, icon: true };
      for (let s = 0; s < 3; s++) if (x >= 18 + 37 * s && x < 18 + 37 * s + 35) return { row, slot: s };
    }
    return null;
  }
  drawMacros(ctx) {
    const M = this.M, m = this.mgr, im = (n) => m.image(n), sb = this.g.skills, X = this.skillW;
    const bg = im(M.backgrnd);
    if (bg) ctx.drawImage(bg, X, 0);
    for (const [k, x, y] of [['line01', 17, 49], ['line02', 7, 190], ['macroname', 17, 195]]) { const i = im(M[k]); if (i) ctx.drawImage(i, X + x, y); }
    for (let r = 0; r < MACRO_ROWS; r++) {
      const row = this.mFirst + r, y = 56 + 45 * r, mac = this.draft[row];
      if (row === this.mSel) { const s = im(M.macroslot2); if (s) ctx.drawImage(s, X + 15, y - 5); }
      for (const [k, x] of [['macroslot', 17], ['macroslot1', 143]]) { const i = im(M[k]); if (i) ctx.drawImage(i, X + x, y - 3); }
      const icon = im(M.Macroicon?.[row]?.icon);
      if (icon) ctx.drawImage(icon, X + 146, y);
      mac?.skills.forEach((id, s) => { if (id) m.drawIcon(ctx, sb?.icon(id), X + 20 + 37 * s, y); });
    }
    this.scrollbar(ctx, X + 185, 54, 125, this.mFirst, 5, MACRO_ROWS);
    const sel = this.draft[this.mSel];
    if (sel) {
      const icon = im(M.Macroicon?.[this.mSel]?.icon);
      if (icon) ctx.drawImage(icon, X + 22, 200);
      const box = im(m.B.CheckBox[sel.shout ? 1 : 0]);
      if (box) ctx.drawImage(box, X + 166, 241);
    }
    const f = this.nameField;
    if (f) { f.rect.x = this.x + X + 59; f.rect.y = this.y + 215; f.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / 800); }
  }
  macroDown(lx, ly) {
    const X = this.skillW;
    const s = this.scrollClick(lx, ly, X + 185, 54, 125, this.mFirst, 5, MACRO_ROWS);
    if (s !== null) { this.mFirst = s; return; }
    if (lx - X >= 42 && lx - X < 178 && ly >= 239 && ly < 255 && this.draft[this.mSel]) { this.draft[this.mSel].shout = !this.draft[this.mSel].shout; return; }
    const hit = this.macroAt(lx, ly);
    if (!hit) return;
    if (hit.row !== this.mSel) { this.mSel = hit.row; if (this.nameField) this.nameField.value = this.draft[hit.row].name; }
    if (hit.icon) this.mgr.startCarry({ kind: 'bind', b: { type: 8, action: hit.row } }, this.M.Macroicon?.[hit.row]?.icon);
  }
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
    if (this.macroOpen) this.drawMacros(ctx);
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
    if (this.macroOpen && lx >= this.skillW) { this.macroDown(lx, ly); return; }
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
  wheel(dy) {
    if (this.macroOpen && this.mgr.mouse.x - this.x >= this.skillW) { this.mFirst = Math.max(0, Math.min(5 - MACRO_ROWS, this.mFirst + Math.sign(dy))); return; }
    this.first = Math.max(0, Math.min(this.list.length - 4, this.first + Math.sign(dy)));
  }
  /** A skill dropped on a macro's cell goes into it (attack and buff skills only, as in the client). */
  drop(lx, ly, c) {
    const hit = this.macroOpen && c.kind === 'skill' && this.macroAt(lx, ly);
    if (!hit || hit.icon) return;
    this.draft[hit.row].skills[hit.slot] = c.id; this.mSel = hit.row;
    if (this.nameField) this.nameField.value = this.draft[hit.row].name;
    sfx.play('UI/DragEnd');
  }
  rclick(lx, ly) { const hit = this.macroOpen && this.macroAt(lx, ly); if (hit && !hit.icon) this.draft[hit.row].skills[hit.slot] = 0; }
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
 * opened to its right: blue name box x 16-285 y 26-124 (the NPC's portrait in its right part, past the
 * divider at x 196), text body from y 130, bottom band y 371-392 with FIND NPC (BtMarkNpc).
 * The list is grouped by area (Etc/QuestCategory: Maple Island, Victoria Island, Party Quest...) under
 * headers you fold with their box; a quest you have not looked at yet wears the NEW badge (icon5), one
 * you have the yellow ! (icon0) - grey (icon1) while in progress and not yet done. An empty tab shows notice0-2.
 */
const QROW_Y = 50, QROW_H = 22, QROWS = 14, QFONT = 12;
const QDETAIL = { x: 14, y: 132, w: 270, h: 234, line: 18 };
class QuestWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Quest;
    super(mgr, W.backgrnd, 140, 60);
    this.W = W; this.tab = 0; this.first = 0; this.sel = null; this.lines = []; this.dfirst = 0;
    this.folded = [new Set(), new Set(), new Set()];
    const band = 245, by = 373;
    this.findBtn = this.button(W.BtMarkNpc, band + 305 - 81 - 14, by, () => this.findNpc());
    this.giveup = this.button(W.BtGiveup, this.findBtn.x - 57 - 4, by, () => {
      const id = this.sel;
      if (id) mgr.confirm(`Are you sure you want to give up the quest #b${this.g.quests.name(id)}#k?`).then((ok) => { if (ok) { this.g.net?.questAction(3, id); this.sel = null; } });
    });
    // Quest Helper: add or take off the chosen quest (BtAlert, left of GIVE UP)
    this.alert = this.button(W.BtAlert, this.giveup.x - 86 - 4, by, () => { if (this.sel) mgr.wins.questalarm?.track(this.sel); });
    this.hideBtn = this.button(mgr.B.BtClose, band + 305 - 17, 6, () => { this.sel = null; });
    for (const b of [this.findBtn, this.giveup, this.alert, this.hideBtn]) b.visible = false;
    const a = mgr.assets;
    Promise.all(['Mob', 'Npc', 'Map'].map((k) => a.json(`String/${k}.img`))).then(([mob, npc, map]) => { this.str = { mob, npc, map }; });
    a.json('Etc/QuestCategory.img').then((c) => { this.areas = c || {}; });
    a.json('Etc/NpcLocation.img').then((l) => { this.npcMaps = l || {}; });
    this.portraits = new Map();
  }
  frames() {
    const W = this.W;
    return [...super.frames(), W.backgrnd2, W.icon0, W.icon1, ...allCanvases(W.icon5), W.notice0, W.notice1, W.notice2, ...allCanvases(W.Tab)].filter(isCanvas);
  }
  get wide() { return this.sel ? this.w + 305 : this.w; }
  contains(x, y) { return x >= this.x && x < this.x + this.wide && y >= this.y && y < this.y + this.h; }

  // ---------------------------------------------------------------- what is listed
  ids() {
    const book = this.g.quests;
    if (!book) return [];
    if (this.tab === 0) return book.available(this.g.textCtx());
    const src = this.tab === 1 ? book.started : book.completed;
    return Object.keys(src).map(Number).filter((id) => book.info[id]);
  }
  areaName(code) { const n = this.areas?.[code]; return n && n !== 'empty' ? n : 'Etc.'; }
  /** The rows shown: per area (in area order) a header, then its quests unless folded. */
  rows() {
    const book = this.g.quests, groups = new Map();
    for (const id of this.ids()) {
      const area = Number(book.info[id]?.area) || 0;
      if (!groups.has(area)) groups.set(area, []);
      groups.get(area).push(id);
    }
    const out = [], folded = this.folded[this.tab];
    for (const area of [...groups.keys()].sort((x, y) => x - y)) {
      const list = groups.get(area);
      out.push({ head: area, count: list.length });
      if (!folded.has(area)) for (const id of list) out.push({ id });
    }
    return out;
  }
  // quests you have looked at lose their NEW badge (kept per character)
  get seenKey() { return `maple.questSeen.${this.g.player?.id}`; }
  get seen() {
    if (this._seen?.key !== this.seenKey) {
      let ids = [];
      try { ids = JSON.parse(localStorage.getItem(this.seenKey) || '[]'); } catch { /* storage off */ }
      this._seen = { key: this.seenKey, ids: new Set(ids) };
    }
    return this._seen.ids;
  }
  markSeen(id) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    try { localStorage.setItem(this.seenKey, JSON.stringify([...this.seen])); } catch { /* storage off */ }
  }

  rowAt(lx, ly) {
    if (lx < 6 || lx > 228 || ly < QROW_Y) return -1;
    const i = Math.floor((ly - QROW_Y) / QROW_H);
    return i < QROWS && this.first + i < this.rows().length ? this.first + i : -1;
  }
  select(id) {
    this.sel = id; this.dfirst = 0;
    this.markSeen(id);
    this.layoutDetail();
    this.portrait(this.questNpc(id));
  }
  /** The NPC a quest is about now: who starts it, or who finishes it once it is under way. */
  questNpc(id) {
    const c = this.g.quests.check[id] || {}, st = this.g.quests.status(id);
    return Number((st === 0 ? c['0']?.npc : c['1']?.npc || c['0']?.npc)) || null;
  }
  async portrait(npcId) {
    if (!npcId || this.portraits.has(npcId)) return;
    this.portraits.set(npcId, null);
    const a = this.mgr.assets;
    let node = await a.json(`Npc/${String(npcId).padStart(7, '0')}.img`);
    if (node?.info?.link) node = await a.json(`Npc/${String(node.info.link).padStart(7, '0')}.img`);
    const f = node?.stand?.[0] || node?.stand?.['0'];
    if (f) { await a.preload([f]); this.portraits.set(npcId, f); }
  }
  /** The detail text: the quest's own words for where you are with it (grey), and while it is under way what is left. */
  layoutDetail() {
    const g = this.g, book = g.quests, id = this.sel, st = book.status(id);
    const ctx = document.createElement('canvas').getContext('2d');
    let text = String(book.info[id]?.[String(st === 0 ? 0 : st === 1 ? 1 : 2)] || '');
    if (st === 1) {
      const req = book.requirements(id), reqs = [];
      for (const m of req.mobs) reqs.push(`#o${m.id}#: ${Math.min(m.have, m.need)} / ${m.need}`);
      for (const it of req.items) if ((it.count ?? 1) > 0) reqs.push(`#t${it.id}#: ${g.itemCount(it.id)} / ${it.count ?? 1}`);
      if (reqs.length) text += `\n\n${reqs.join('\n')}`;
    }
    this.lines = richText(ctx, text, QDETAIL.w, this.ref(), { base: '#6b6b6b', size: QFONT, lineH: QDETAIL.line });
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
  /** FIND NPC: point at the NPC if it is here, else say where it lives. */
  findNpc() {
    const npc = this.questNpc(this.sel), g = this.g;
    if (!npc) return;
    const name = this.ref().npc(npc);
    const here = g.map?.life.find((e) => e.kind === 'Npc' && Number(e.spawn.id) === npc);
    if (here) { g.markNpc(here, name); return; }
    const maps = Object.values(this.npcMaps?.[npc] || {}).map((id) => this.ref().map(id)).filter((n) => typeof n === 'string');
    this.mgr.notice(maps.length ? `${name} is in ${[...new Set(maps)].join(', ')}.` : `${name} is not in this map.`);
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    const st = this.sel ? this.g.quests.status(this.sel) : -1;
    this.giveup.visible = this.alert.visible = st === 1;
    this.findBtn.visible = !!this.sel && st !== 2 && !!this.questNpc(this.sel);
    this.hideBtn.visible = !!this.sel;
    super.draw(ctx);
  }
  body(ctx) {
    const m = this.mgr, book = this.g.quests;
    if (!book) return;
    // the Basic tab strip under the labels: three tabs over the left 200px, as in the client
    this.tabRects = drawTabStrip(ctx, m, this.W.Tab, 3, this.tab, 200, 24);
    const rows = this.rows(), qctx = this.g.textCtx(), now = performance.now();
    this.first = Math.min(this.first, Math.max(0, rows.length - QROWS));
    for (let i = 0; i < QROWS; i++) {
      const r = rows[this.first + i];
      if (!r) break;
      const y = QROW_Y + i * QROW_H;
      if (r.head !== undefined) {
        // the area's band with its fold box
        ctx.fillStyle = '#a3b4cd'; ctx.fillRect(8, y + 1, 218, QROW_H - 3);
        ctx.fillStyle = '#fff'; ctx.fillRect(12, y + 4, 13, 13);
        ctx.fillStyle = '#3d6fb6'; ctx.fillRect(13, y + 5, 11, 11);
        ctx.fillStyle = '#fff'; ctx.fillRect(15, y + 10, 7, 1.6);
        if (this.folded[this.tab].has(r.head)) ctx.fillRect(17.7, y + 7, 1.6, 7);
        uiText(ctx, `${this.areaName(r.head)} (${r.count})`, 31, y + 3, { color: '#fff', size: QFONT });
        continue;
      }
      const id = r.id, name = book.name(id);
      if (id === this.sel) {
        ctx.font = `${QFONT}px Arial, sans-serif`;
        ctx.fillStyle = '#3b5d96'; ctx.fillRect(30, y + 1, Math.min(196, ctx.measureText(name).width + 8), QROW_H - 3);
      }
      let icon;
      if (this.tab === 0) icon = this.seen.has(id) ? this.W.icon0 : this.W.icon5?.[Math.floor(now / 150) % 5];
      else if (this.tab === 1) icon = book.canComplete(id, qctx) ? this.W.icon0 : this.W.icon1;
      else icon = this.W.icon1;
      const ic = m.image(icon);
      if (ic) ctx.drawImage(ic, 10, y + 4);
      ctx.save(); ctx.beginPath(); ctx.rect(30, y, 196, QROW_H); ctx.clip();
      uiText(ctx, name, 34, y + 3, { color: id === this.sel ? '#fff' : '#000', size: QFONT });
      ctx.restore();
    }
    if (!rows.length) { const n = m.image(this.W[`notice${this.tab}`]); if (n) ctx.drawImage(n, Math.round((245 - n.width) / 2), 60); }
    this.scrollbar(ctx, 229, 46, 324, this.first, rows.length, QROWS);
    if (this.sel) this.drawDetail(ctx);
  }
  drawDetail(ctx) {
    if (this.laidOut !== this.mgr.namesVersion || (!this.laidStr && this.str)) { this.laidStr = !!this.str; this.layoutDetail(); }
    const bg = this.mgr.image(this.W.backgrnd2), book = this.g.quests;
    ctx.save(); ctx.translate(this.w, 0);
    if (bg) ctx.drawImage(bg, 0, 0);
    // the green bullet and the name, cut with ".." to fit before the divider
    ctx.fillStyle = '#d9f7c6'; ctx.beginPath(); ctx.arc(24, 47, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4dbb2b'; ctx.beginPath(); ctx.arc(24, 47, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 13px Arial, sans-serif';
    let name = book.name(this.sel);
    if (ctx.measureText(name).width > 160) { while (name.length > 1 && ctx.measureText(`${name}..`).width > 160) name = name.slice(0, -1); name = `${name.trimEnd()}..`; }
    uiText(ctx, name, 33, 39, { color: '#fff', bold: true, size: 13 });
    // the NPC it is about, standing in the box's right part
    const f = this.portraits.get(this.questNpc(this.sel)), pi = f && this.mgr.image(f);
    if (pi) {
      const o = f.origin || [pi.width / 2, pi.height];
      ctx.save(); ctx.beginPath(); ctx.rect(198, 28, 86, 94); ctx.clip();
      ctx.drawImage(pi, Math.round(241 - o[0]), Math.round(116 - o[1]));
      ctx.restore();
    }
    // the body scrolls a few lines at a time (wheel over the panel)
    ctx.save(); ctx.beginPath(); ctx.rect(10, 128, 270, QDETAIL.h); ctx.clip();
    const top = this.lines.lines[this.dfirst]?.y || 0;
    drawRich(ctx, this.lines, QDETAIL.x, QDETAIL.y - top, { size: QFONT, drawIcon: (n, x, y) => this.mgr.drawIcon(ctx, n, x, y) });
    ctx.restore();
    this.scrollbar(ctx, 285, 128, 240, this.dfirst, this.lines.lines.length, Math.floor(QDETAIL.h / QDETAIL.line));
    ctx.restore();
  }
  down(lx, ly) {
    const t = tabAt(this.tabRects, lx, ly);
    if (t >= 0) { if (t !== this.tab) { this.tab = t; this.first = 0; this.sel = null; sfx.play('UI/Tab'); } return; }
    if (lx >= this.w) {
      const n = this.lines.lines.length, vis = Math.floor(QDETAIL.h / QDETAIL.line);
      const s = this.scrollClick(lx - this.w, ly, 285, 128, 240, this.dfirst, n, vis);
      if (s !== null) this.dfirst = s;
      return;
    }
    const rows = this.rows();
    const s = this.scrollClick(lx, ly, 229, 46, 324, this.first, rows.length, QROWS);
    if (s !== null) { this.first = s; return; }
    const i = this.rowAt(lx, ly), r = rows[i];
    if (!r) return;
    if (r.head !== undefined) {
      const f = this.folded[this.tab];
      if (f.has(r.head)) f.delete(r.head); else f.add(r.head);
      sfx.play('UI/BtMouseClick');
    } else this.select(r.id);
  }
  wheel(dy) {
    if (this.mgr.mouse.x - this.x >= this.w && this.sel) this.dfirst = Math.max(0, Math.min(this.lines.lines.length - Math.floor(QDETAIL.h / QDETAIL.line), this.dfirst + Math.sign(dy)));
    else this.first = Math.max(0, Math.min(this.rows().length - QROWS, this.first + Math.sign(dy)));
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
    if (b.type === 8) return this.mgr.W.SkillMacro?.Macroicon?.[b.action]?.icon || null;
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

