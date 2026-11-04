import { isCanvas } from '../assets.js';
import { EXP, jobName, itemIcon, itemName, itemInfo, invType, isScroll, itemKeyType } from '../data.js';
import { sfx } from '../audio.js';
import { WzButton, TextField, uiText, wrapText } from './wzui.js';
import { richText, drawRich } from './richtext.js';
import { isPartyQuest, questSort, TITLE_AREA } from '../quests.js';

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
    [this.W, this.B, this.CS] = await Promise.all([a.json('UI/UIWindow.img'), a.json('UI/Basic.img'), a.json('UI/CashShop.img')]);
    if (this.CS?.CashItem) a.preload(allCanvases(this.CS.CashItem));
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
    if (!this.order.includes(w)) { this.order.push(w); w.onOpen?.(); sfx.play(w.openSound || 'UI/MenuUp'); } else this.raise(w);
    return w;
  }
  close(w) {
    const i = this.order.indexOf(w);
    if (i >= 0) { this.order.splice(i, 1); const s = w.closeSound ?? 'UI/MenuDown'; if (s) sfx.play(s); this.tip = null; w.onClose?.(); }   // closeSound null: closes silently
  }
  toggle(name, arg) {
    const w = this.wins[name];
    if (!w) return;
    if (this.isOpen(name) && !w.wantsArg?.(arg)) { this.close(w); return; }
    this.open(name);
    w.setArg?.(arg);
  }
  closeAll() {
    const keep = this.order.filter((w) => w.modal || w.keepOnEscape || w === this.wins.minimap || w === this.wins.questalarm);
    for (const w of this.order) if (!keep.includes(w)) w.onClose?.();
    if (this.order.length > keep.length) sfx.play('UI/MenuDown');
    this.order = keep;
  }
  /** A transient window (dialog, shop) on top of everything. */
  show(w, sound = 'UI/DlgNotice') { this.order.push(w); if (sound) sfx.play(sound); return w; }
  get modal() { for (let i = this.order.length - 1; i >= 0; i--) if (this.order[i].modal) return this.order[i]; return null; }
  keydown(e) {
    // Escape puts back an item held by a click
    if (e.key === 'Escape' && this.carry?.sticky) { e.preventDefault(); e.stopImmediatePropagation(); this.carry = null; return; }
    const top = this.modal || (this.order[this.order.length - 1]?.key && e.key === 'Escape' ? this.order[this.order.length - 1] : null);
    if (!top) return;
    const typing = e.target instanceof HTMLInputElement;
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); top.key?.(e); return; }
    if (!typing && top === this.modal && top.keys?.(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // a dialog's own keys (arrows, Tab)
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
      const t = invType(id), pet = Math.floor(id / 10000) === 500, file = pet ? 'Pet' : { 1: 'Eqp', 2: 'Consume', 3: 'Ins', 4: 'Etc', 5: 'Cash' }[t];
      this.assets.json(`String/${file}.img`).then((s) => {
        let n = null;
        if (t === 1) { for (const cat of Object.values(s?.Eqp || {})) if (cat?.[id]) n = cat[id]; } else n = t === 4 ? s?.Etc?.[id] : s?.[id];
        this.descs.set(id, n?.desc || ''); this.namesVersion++;
      });
    }
    return this.descs.get(id);
  }
  image(n) { return n ? this.assets.image(n) : null; }
  /** Item / skill icon in the 32x32 box at (x, y), placed by its origin like the client; a cash item gets its coin. */
  drawIcon(ctx, node, x, y, id = 0) {
    const im = this.image(node);
    if (!im) return;
    const o = node.origin || [0, 32];
    ctx.drawImage(im, x - o[0], y + 32 - o[1]);
    if (id) this.drawCashMark(ctx, id, x + 32, y + 32);
  }
  isCash(id) { return Number(this.info(id)?.cash) === 1; }
  /** CashShop.img/CashItem/0: the gold coin on a cash item's icon, hung from the icon's bottom-right corner. */
  drawCashMark(ctx, id, x, y, scale = 1) {
    const n = this.CS?.CashItem?.[0], im = n && this.isCash(id) && this.image(n);
    if (!im) return;
    const o = n.origin || [im.width, im.height];
    ctx.drawImage(im, Math.round(x - o[0] * scale), Math.round(y - o[1] * scale), im.width * scale, im.height * scale);
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
      if (type === 'up') { this.drag = null; d.win.dragged?.(); }
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
    this.tip = w && !this.carry && !this.tipHeld ? (over ? over.tip?.() ?? null : w.tooltip?.(x - w.x, y - w.y)) : null;
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
      if (!over && ly < (w.dragH ?? 20) && !w.fixed) { this.drag = { win: w, dx: lx, dy: ly }; return true; }
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
      if (target?.enabled) target.onClick();
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
 * Tab/enabled|disabled label is centred on its tab. `fixed` gives every tab that width (edge included) when they
 * fit. Returns each tab's [x, width] for hit testing.
 */
export function drawTabStrip(ctx, mgr, labels, count, selected, span, y = 23, fixed = 0) {
  const T = mgr.B.Tab2, im = (n) => mgr.image(n), rects = [];
  if (!T || !count) return rects;
  if (fixed * count > span) fixed = 0;
  const width = fixed ? fixed - 8 : Math.trunc((span - (count - 1) * 8 - 8) / count), rem = fixed ? 0 : span - (width + 8) * count;
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
      m.drawIcon(ctx, m.icon(it.id), x, y, it.id);
      // Use, Set-up and Etc items show their count even at 1; Cash ones only when stacked
      if (this.tab !== 1 && (it.quantity > 1 || (this.tab !== 5 && it.quantity >= 1))) m.count(ctx, it.quantity, x, y + 21);
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
 * PET EQUIP, MOVE UP / PET RING x2. BtPet1-3 below pick whose equipment it shows. PET HP / PET MP hold the
 * potions the lead pet drinks.
 */
const PET_CELL = { pouchHp: [0, 0], potionHp: [1, 0], pouchMp: [2, 0], potionMp: [3, 0], pouch: [0, 1], magnet: [1, 1],
  ignore: [0, 2], scales: [1, 2], binocular: [2, 2], acc: [3, 2], boots: [0, 3], label: [2, 3], quote: [3, 3] };
const PET_X = 175;
class EquipWin extends Win {
  constructor(mgr) {
    super(mgr, mgr.W.Equip.backgrnd, 420, 90);
    const E = mgr.W.Equip;
    this.closePinned = true; this.closeBtn.x = 175 - 17;
    this.petOpen = false; this.petSel = 0;
    this.petShow = this.button(E.BtPetEquipShow, 175 - 60, 283, () => this.togglePet());
    this.petHide = this.button(E.BtPetEquipHide, 175 - 60, 283, () => this.togglePet());
    this.petTabs = [E.BtPet1, E.BtPet2, E.BtPet3].map((n, k) => this.button(n, PET_X + 13 + 15 + k * 33, 148 + 13, () => { this.petSel = k; }));
    this.togglePet(false);
  }
  frames() { return [...super.frames(), this.mgr.W.Equip.pet]; }
  togglePet(open = !this.petOpen) {
    this.petOpen = open;
    this.w = open ? PET_X + 177 : 175;
    this.petShow.visible = !open; this.petHide.visible = open;
  }
  /** The pet panel's cells for the chosen pet: [slot or potion kind, column, row]. */
  petCells() {
    const S = this.g.petSlots(this.petSel);
    return Object.entries(PET_CELL).map(([k, [c, r]]) => [k === 'pouchHp' ? -124 : k === 'pouchMp' ? -125 : k === 'potionHp' ? 'hp' : k === 'potionMp' ? 'mp' : S[k], c, r]);
  }
  slotAt(lx, ly) {
    if (this.petOpen && lx >= PET_X) {
      const c = Math.floor((lx - PET_X - 13) / 33), r = Math.floor((ly - 12) / 33);
      return this.petCells().find(([, cc, rr]) => cc === c && rr === r)?.[0] || 0;
    }
    const c = Math.floor((lx - 5) / 33), r = Math.floor((ly - 35) / 33);
    return this.shown(Number(Object.entries(EQUIP_CELLS).find(([, p]) => p[0] === c && p[1] === r)?.[0]) || 0);
  }
  /** A cell shows (and drags, takes off...) the cash item worn over its slot, 100 below it, when there is one. */
  shown(slot) {
    const cash = slot - 100;
    return slot && slot !== -14 && slot > -100 && this.g.inventory?.equipped?.[cash] ? cash : slot;
  }
  body(ctx) {
    const eq = this.g.inventory?.equipped || {}, m = this.mgr;
    const cells = [...Object.entries(EQUIP_CELLS).map(([s, [c, r]]) => [s, 5 + c * 33, 35 + r * 33])];
    const pets = this.g.myPets().length;
    this.petTabs.forEach((b, k) => { b.visible = this.petOpen; b.enabled = k < Math.max(1, pets); b.forceState = k === this.petSel ? 'pressed' : null; });
    if (this.petOpen) {
      const panel = m.image(m.W.Equip.pet);
      if (panel) ctx.drawImage(panel, PET_X, 0);
      cells.push(...this.petCells().map(([s, c, r]) => [s, PET_X + 13 + c * 33, 12 + r * 33]));
    }
    for (const [cell, x, y] of cells) {
      if (cell === 'hp' || cell === 'mp') { const id = this.g.petPotions?.[cell]; if (id) m.drawIcon(ctx, m.icon(id), x, y); continue; }
      const slot = this.shown(Number(cell)), it = eq[slot];
      if (!it || (m.carry?.tab === 'equip' && m.carry.slot === slot)) continue;
      m.drawIcon(ctx, m.icon(it.id), x, y, it.id);
    }
    // cells that can't be used now are tinted red, and so is a worn item whose requirements you no longer meet
    ctx.fillStyle = 'rgba(255,0,0,0.25)';
    for (const cell of this.unusable(eq)) { const [c, r] = EQUIP_CELLS[cell]; ctx.fillRect(5 + c * 33, 35 + r * 33, 32, 32); }
    for (const [cell, [c, r]] of Object.entries(EQUIP_CELLS)) {
      const it = eq[this.shown(Number(cell))];
      if (it && this.g.canEquip?.(it.id) === false) ctx.fillRect(5 + c * 33, 35 + r * 33, 32, 32);
    }
  }
  /**
   * The shield cell under a two-handed weapon (14xxxxx) with no shield, the pants cell under an overall (the cash one
   * over it first) with no pants, and the taming mob cells without the job's Monster Rider skill.
   */
  unusable(eq) {
    const out = [], job = this.g.stats?.job || 0;
    if (eq[-11] && Math.floor(eq[-11].id / 100000) === 14 && !eq[-10]) out.push(-10);
    const top = eq[-105] || eq[-5], bottom = eq[-106] || eq[-6];
    if (top && Math.floor(top.id / 10000) === 105 && !bottom) out.push(-6);
    const group = Math.floor(job / 100) === 22 || job === 2001 ? 2001 : Math.floor(job / 1000) * 1000;
    if (!(this.g.skills?.level(group * 10000 + 1004) > 0)) out.push(-18, -19, -20);
    return out;
  }
  down(lx, ly) {
    const slot = this.slotAt(lx, ly), it = typeof slot === 'number' && slot && this.g.inventory?.equipped?.[slot];
    if (it) this.mgr.startCarry({ kind: 'item', tab: 'equip', slot, id: it.id }, this.mgr.icon(it.id));
  }
  dblclick(lx, ly) { const slot = this.slotAt(lx, ly); if (typeof slot === 'number' && slot && this.g.inventory?.equipped?.[slot]) this.g.unequip(slot); }
  drop(lx, ly, c) {
    if (c.kind !== 'item') return;
    const slot = this.slotAt(lx, ly);
    if ((slot === 'hp' || slot === 'mp') && c.tab === 2) { this.g.setPetPotion(slot, c.id); return; }
    if (c.tab === 2 && isScroll(c.id)) { if (typeof slot === 'number' && slot) this.g.useScroll(c.slot, slot); return; }   // a scroll onto what you wear
    if (c.tab !== 1) return;
    const it = this.g.inventory[1][c.slot], cat = Math.floor((it?.id || 0) / 10000);
    if (this.petOpen && lx >= PET_X) { if (it && typeof slot === 'number' && slot) this.g.equipPetCell(c.slot, it, slot, this.petSel); return; }
    if (cat >= 180 && cat <= 183) return;   // pet equipment goes in none of your own cells
    // a ring dropped on one of the ring cells goes into that one
    const col = Math.floor((lx - 5) / 33), row = Math.floor((ly - 35) / 33);
    const cell = Number(Object.entries(EQUIP_CELLS).find(([, p]) => p[0] === col && p[1] === row)?.[0]) || 0;
    if (it && cat === 111 && [-12, -13, -15, -16].includes(cell)) this.g.equipRing(c.slot, it, cell);
    else this.g.useInventoryItem(1, c.slot, it);
  }
  tooltip(lx, ly) {
    const slot = this.slotAt(lx, ly);
    if (slot === 'hp' || slot === 'mp') { const id = this.g.petPotions?.[slot]; return id ? { item: { id } } : null; }
    const it = slot && this.g.inventory?.equipped?.[slot];
    return it ? { item: it } : null;
  }
}

// ==================================================================== Character stat
/**
 * Stat.img backgrnd 175x347, Arial 12 black at x 61 (font cell tops below). backgrnd2 (177x203) is the detail panel,
 * at (170, 144) behind the main one, values at x 77 every 18px from y 8.
 */
const AP = { hp: 0x800, mp: 0x2000, str: 0x40, dex: 0x80, int: 0x100, luk: 0x200 };
const AP_ROWS = { hp: 117, mp: 135, str: 247, dex: 265, int: 283, luk: 301 };
const STATS = ['str', 'dex', 'int', 'luk'];
/** The stats each branch doesn't use, shown with greyed labels. */
const GREY_STATS = { 0: ['int', 'luk'], 1: ['int', 'luk'], 2: ['str', 'dex'], 3: ['int', 'luk'], 4: ['str', 'int'], 5: ['int', 'luk'] };
const DETAIL_X = 170, DETAIL_Y = 144;
const HPMP_ASK = 'If you invest your AP in HP or MP, your character may have\ninsufficient stats to become as strong as it could be.\nDo you still wish to raise this skill?';
const isStarter = (job) => [0, 1000, 2000, 2001].includes(job);
/** Auto-Assign's two targets [[stat, target], [main stat, target]] for a job at level L, or null; flag 0 picks the gunslinger split at job 500. */
function autoTargets(job, L, flag) {
  const jm = job % 1000, branch = Math.floor(jm / 100), line = Math.floor(jm / 10);
  if (jm === 0 || job === 2001) return [['dex', L], ['str', 4 * L + 12]];
  if (branch === 1) { const d = L <= 30 ? 2 * L : L + 30; return [['dex', d], ['str', 5 * L - d + 12]]; }
  if (branch === 2) return [['luk', L + 3], ['int', 4 * L + 9]];
  if (jm === 300 || (jm >= 310 && jm <= 312)) return [['str', L + 5], ['dex', 5 * L - (L + 5) + 12]];
  if (jm >= 320 && jm <= 322) return [['str', L], ['dex', 4 * L + 12]];
  if (branch === 4) { const d = L <= 40 ? 2 * L : L + 40; return [['dex', d], ['luk', 5 * L - d + 12]]; }
  if (line === 51 || job === 1500 || (job === 500 && flag === 1)) { const d = L <= 20 ? 2 * L : L + 20; return [['dex', d], ['str', 5 * L - d + 12]]; }
  if (line === 52 || (job === 500 && flag === 0)) return [['str', L], ['dex', 4 * L + 12]];
  return null;
}
class StatWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Stat;
    super(mgr, W.backgrnd, 10, 90);
    this.W = W; this.detail = false;
    this.ap = Object.entries(AP_ROWS).map(([k, y]) => Object.assign(this.button(W.BtApUp, 153, y, () => this.raise(k)), { stat: k }));
    this.auto = [this.button(W.BtAuto, 97, 197, () => this.autoAssign(1)), this.button(W.BtAuto1, 97, 197, () => this.autoAssign(1)), this.button(W.BtAuto2, 97, 217, () => this.autoAssign(0))];
    this.button(W.BtDetail, 121, 324, () => { this.detail = !this.detail; });
    this.hideBtn = this.button(mgr.B.BtHide, DETAIL_X + 155, DETAIL_Y + 182, () => { this.detail = false; });
  }
  frames() { return [...super.frames(), this.W.backgrnd2, this.W.basicStat, ...allCanvases(this.W.Job), ...allCanvases(this.W.Disabled)]; }
  contains(x, y) {
    const lx = x - this.x, ly = y - this.y;
    return super.contains(x, y) || (this.detail && lx >= DETAIL_X && lx < DETAIL_X + 177 && ly >= DETAIL_Y && ly < DETAIL_Y + 203);
  }
  draw(ctx) {
    const bg2 = this.detail && this.mgr.image(this.W.backgrnd2);   // behind the main panel
    if (bg2) ctx.drawImage(bg2, this.x + DETAIL_X, this.y + DETAIL_Y);
    super.draw(ctx);
  }
  /** Arial 12 with its font cell's top at y. */
  t(ctx, text, x, y, o = {}) { this.text(ctx, text, x, y + 11, { size: 12, base: 'alphabetic', ...o }); }
  body(ctx) {
    const g = this.g, s = g.stats;
    if (!s) return;
    const starter = isStarter(s.job) && s.level <= 10, gm = Math.floor((s.job % 1000) / 100) === 9;
    for (const b of this.ap) { b.visible = !starter; b.enabled = s.ap > 0 && (s.level >= 20 || (b.stat !== 'hp' && b.stat !== 'mp')); }
    this.auto.forEach((b, i) => { b.visible = !starter && !gm && (s.job === 500 ? i > 0 : i === 0); b.enabled = s.ap > 0; });
    this.hideBtn.visible = this.detail;
    const need = EXP[s.level] || 0;
    this.t(ctx, s.name, 61, 33);
    this.drawJob(ctx, s.job);
    this.t(ctx, s.level, 61, 79); this.t(ctx, g.guild?.name || '-', 61, 96);
    this.t(ctx, `${s.hp} / ${g.maxHpShown()}`, 61, 115); this.t(ctx, `${s.mp} / ${g.maxMpShown()}`, 61, 133);
    this.t(ctx, `${s.exp} (${need >= 1 ? Math.trunc((s.exp / need) * 100) : 0}%)`, 61, 151); this.t(ctx, s.fame, 61, 169);
    if (starter) { const n = this.mgr.image(this.W.basicStat); if (n) ctx.drawImage(n, 8, 195); }
    else {
      this.t(ctx, s.ap, 85, 215, { align: 'right' });
      const grey = gm || [1000, 2000, 2001].includes(s.job) ? [] : GREY_STATS[Math.floor((s.job % 1000) / 100)] || [];
      STATS.forEach((k, i) => {
        const off = grey.includes(k) && this.mgr.image(this.W.Disabled[k.toUpperCase()]);
        if (off) ctx.drawImage(off, 8, 244 + 18 * i);
        const total = g.totalStat(k), d = total - s[k];
        this.t(ctx, d ? `${total} (${s[k]}${d > 0 ? '+' : ''}${d})` : total, 61, 244 + 18 * i);
      });
    }
    if (this.detail) this.drawDetail(ctx);
  }
  /** The job: the branch in caps over [JOB] (art), one line of text for Aran / Evan, "GM / gamemaster" for GMs. */
  drawJob(ctx, job) {
    const J = this.W.Job, kind = Math.floor(job / 1000), branch = Math.floor((job % 1000) / 100);
    const small = (text, x, y) => { ctx.save(); ctx.font = '9px Tahoma, sans-serif'; ctx.fillStyle = '#9c6563'; ctx.textBaseline = 'top'; ctx.fillText(text, x, y); ctx.restore(); };
    if (branch === 9) { small('GM', 62, 51); small('gamemaster', 62, 61); return; }
    const main = this.mgr.image(kind === 1 ? J.main.premium?.[branch] : J.main[branch]), subNode = (kind === 1 ? J.sub.premium?.[branch] : J.sub[branch])?.[job];
    const sub = this.mgr.image(subNode);
    if (kind > 1 || !main || !sub) { this.t(ctx, jobName(job), 61, 55); return; }
    ctx.drawImage(main, 62, 53);
    small('[', 62, 63); ctx.drawImage(sub, 65, 65); small(']', 62 + 4 + sub.width, 63);
  }
  drawDetail(ctx) {
    const g = this.g, d = g.statWindow(), x = DETAIL_X + 77, y = (i) => DETAIL_Y + 8 + 18 * i;
    const buffed = ([v, b]) => (b ? [`${v + b} (${v}${b > 0 ? '+' : ''}${b})`, b > 0 ? '#ff2020' : '#2000ff'] : [v, '#000']);
    const rows = [
      [d.attack ? `${d.attack[0]} ~ ${d.attack[1]}` : 0, g.buffValue('watk') ? '#ff2020' : '#000'],
      buffed(d.wdef), buffed(d.matk), buffed(d.mdef), buffed(d.acc), buffed(d.avoid), buffed(d.hands),
      [`${d.speed}%`, '#000'], [`${d.jump}%`, '#000'],
    ];
    rows.forEach(([text, color], i) => this.t(ctx, text, x, y(i), { color }));
  }
  async raise(k) {
    const g = this.g, s = g.stats;
    if (!s?.ap || g.apPending) return;
    if (k === 'hp' || k === 'mp') { if (s.level < 20 || !(await this.mgr.okCancel(HPMP_ASK))) return; }
    g.sendStatRequest(() => g.net?.distributeAp(AP[k]));
  }
  async autoAssign(flag) {
    const g = this.g, s = g.stats, targets = s && autoTargets(s.job, s.level, flag);
    if (!targets || !s.ap || g.apPending) return;
    let left = s.ap;
    const amounts = targets.map(([k, want]) => { const n = Math.min(left, Math.max(0, want - g.totalStat(k))); left -= n; return [k, n]; });
    amounts[1][1] += left;
    const add = (k) => amounts.filter(([a]) => a === k).reduce((n, [, v]) => n + v, 0);
    const text = `    Your AP will be distributed as follows:\n\n${STATS.map((k) => `     ${k.toUpperCase()} : +${add(k)}`).join('\n')}`;
    if (!(await this.mgr.okCancel(text, 'okcancelLeft'))) return;
    const total = amounts[0][1] + amounts[1][1];
    if (total > 0 && total <= (g.stats?.ap || 0)) g.sendStatRequest(() => g.net?.autoDistributeAp(amounts.map(([k, n]) => [AP[k], n])));
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
const GM_TAB = 'gm';

const SKILL_GUIDE = [
  { box: { x: -162, y: -2, w: 158, h: 77 }, arrow: 'seArrow', tip: [11, 103], lines: ['Place the mouse cursor', 'over the skill icon', 'for details about', 'a specific skill.'] },
  { box: { x: 159, y: 20, w: 115, h: 80 }, arrow: 'swArrow', tip: [143, 125], lines: ['Click on the', 'button to assign', 'the SP and raise', 'the skill level.'] },
  { box: { x: -59, y: 300, w: 139, h: 80 }, arrow: 'neArrow', tip: [106, 280], lines: ['You may raise', 'your skill levels', 'by assigning the SP', 'you have on the skills.'] },
];
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
  onOpen() { const b = this.books; this.book ??= b[b.length - 1]; this.guide = false; }

  /**
   * Reaching level 2 opens the window with three WorldNotice/Balloon guides, their tails ending at the first skill's
   * icon (11, 103), its + button (143, 125) and the SKILL POINT box (106, 280); the boxes sit where the client puts
   * them (measured).
   */
  draw(ctx) {
    super.draw(ctx);
    if (!this.guide) return;
    const B = this.mgr.game.loginUi?.WorldNotice?.Balloon;
    if (!B) return;
    ctx.save(); ctx.translate(this.x, this.y);
    for (const g of SKILL_GUIDE) this.guideBalloon(ctx, B, g);
    ctx.restore();
  }
  guideBalloon(ctx, B, g) {
    const im = (k) => this.mgr.image(B[k]);
    const [nw, ne, sw, se] = ['nw', 'ne', 'sw', 'se'].map(im);
    if (!nw || !ne || !sw || !se) return;
    const { x, y, w, h } = g.box, l = nw.width, t = nw.height, r = ne.width, b = sw.height;
    const put = (k, dx, dy, dw, dh) => { const i = im(k); if (i && dw > 0 && dh > 0) ctx.drawImage(i, x + dx, y + dy, dw, dh); };
    put('c', l, t, w - l - r, h - t - b);
    put('n', l, 0, w - l - r, t); put('s', l, h - b, w - l - r, b);
    put('w', 0, t, l, h - t - b); put('e', w - r, t, r, h - t - b);
    ctx.drawImage(nw, x, y); ctx.drawImage(ne, x + w - r, y); ctx.drawImage(sw, x, y + h - b); ctx.drawImage(se, x + w - r, y + h - b);
    // the tail runs from the box to its tip: seArrow's tip is its bottom right, swArrow's bottom left, neArrow's top right
    const arrow = im(g.arrow);
    if (arrow) {
      const ax = g.arrow === 'swArrow' ? g.tip[0] : g.tip[0] - arrow.width + 1, ay = g.arrow === 'neArrow' ? g.tip[1] : g.tip[1] - arrow.height + 1;
      ctx.drawImage(arrow, ax, ay);
    }
    g.lines.forEach((ln, i) => uiText(ctx, ln, x + w / 2, y + Math.round((h - g.lines.length * 15) / 2) + i * 15, { color: '#000', size: 12, align: 'center' }));
  }
  /**
   * Your job's books, then for a GM (or anyone with a GM skill) one more tab, GM, holding the GM and Super GM
   * books (900 / 910) together. There is no v83 label art for it, so its label is drawn as text.
   */
  get books() {
    const sb = this.g.skills, jobs = sb?.jobBookIds || [];
    const gm = this.g.gm || Object.entries(sb?.levels || {}).some(([id, s]) => id >= 9000000 && s.level > 0);
    if (gm && sb) { sb.book(900); sb.book(910); }
    return gm ? [...jobs, GM_TAB] : jobs;
  }
  get list() {
    const sb = this.g.skills;
    const ids = this.book === GM_TAB ? [...(sb?.bookSkills(900) || []), ...(sb?.bookSkills(910) || [])] : sb?.bookSkills(this.book) || [];
    return ids.filter((id) => sb.maxLevel(id));
  }
  get sp() {
    const g = this.g, b = this.book;
    if (b === GM_TAB) return g.stats.sp || 0;
    if (b % 1000 === 0 || b === 2001) {
      const base = Math.floor(g.stats.job / 1000) * 1000;
      let used = 0;
      for (let i = 0; i < 3; i++) used += g.skills.level(base * 10000 + 1000 + i);
      return Math.max(0, Math.min(g.stats.level - 1, 6) - used);
    }
    return g.stats.sp || 0;
  }
  canRaise(id) {
    if (this.book === GM_TAB) return false;   // GM skills are granted, not bought with SP
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
    const books = this.books, gi = books.indexOf(GM_TAB), sel = books.indexOf(this.book);
    const labels = gi < 0 ? this.W.Tab : { enabled: { ...this.W.Tab.enabled, [gi]: null }, disabled: { ...this.W.Tab.disabled, [gi]: null } };
    this.tabRects = drawTabStrip(ctx, m, labels, books.length, sel, 34 * books.length);
    if (gi >= 0 && this.tabRects[gi]) {
      const [tx, tw, ty] = this.tabRects[gi];
      uiText(ctx, 'GM', tx + Math.trunc((tw - 8) / 2), ty + 5, { color: gi === sel ? '#fff' : '#9aa6b8', bold: true, size: 9, align: 'center' });
    }
    const bookId = this.book === GM_TAB ? 900 : this.book;
    const book = sb.books[bookId], bi = book && !(book instanceof Promise) ? book.info?.icon : null;
    const bim = m.image(bi);
    if (bim) ctx.drawImage(bim, 6 + 4, 80 - 30);
    else if (bi) m.assets.preload([bi]);
    this.text(ctx, this.book === GM_TAB ? 'GM' : sb.bookName(this.book), 103, 59, { color: '#fff', align: 'center', size: 12 });
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
 * Quest.img backgrnd 245x396 (list): tabs Available / In Progress / Completed, rows from y 50 at 22px, grouped by
 * area (Etc/QuestCategory) under bands you fold. The detail panel docks on its right: backgrnd2, or backgrnd4 when an
 * in-progress quest has a summary (summary / demandSummary / rewardSummary in the lower pane). The panel shows the
 * quest's start NPC (Maple Administrator when it has none), standing, its level line and its QuestInfo text. A chain
 * (quests sharing a parent) is one row named after the parent; its text is each part's name and words so far.
 */
const QROW_Y = 50, QROW_H = 22, QROWS = 13, QFONT = 12;
const QDETAIL = { x: 18, y: 127, w: 263, h: 237, hSum: 114, line: 8 }, QLINE = 18;
const QSUM = { x: 18, y: 249, w: 263, h: 108 };
const MAPLE_ADMIN = 9010000;
class QuestWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Quest;
    super(mgr, W.backgrnd, 168, 168);
    this.W = W; this.tab = 0; this.first = 0; this.sel = null; this.lines = { lines: [], height: 0 }; this.sum = null; this.dfirst = 0; this.sfirst = 0;
    this.folded = [new Set(), new Set(), new Set()];
    this.seen = new Set();          // looked at this session (Available loses its NEW badge)
    const band = 245, by = 372, U = mgr.W.UtilDlgEx;
    this.findBtn = this.button(W.BtMarkNpc, band + 217, by, () => this.findNpc());
    this.giveup = this.button(U.BtQGiveup, band + 242, by, () => {
      const id = this.sel;
      if (!id || this.g.quests.status(id) !== 1) return;
      mgr.confirm('Are you sure you want to quit?').then((ok) => {
        if (!ok) return;
        mgr.wins.questalarm?.remove(id);
        this.g.net?.questAction(3, id);
      });
    });
    this.alert = this.button(W.BtAlert, band + 150, by, () => { if (this.sel) { mgr.wins.questalarm?.track(this.sel); } });
    this.alert.tip = () => (this.alarmTip ? { title: this.alarmTip.Title || 'Quest Helper', lines: [String(this.alarmTip.Desc || '')] } : null);
    this.hideBtn = this.button(mgr.B.BtHide || mgr.B.BtClose, band + 305 - 17, 6, () => { this.sel = null; });
    for (const b of [this.findBtn, this.giveup, this.alert, this.hideBtn]) b.visible = false;
    const a = mgr.assets;
    Promise.all(['Mob', 'Npc', 'Map'].map((k) => a.json(`String/${k}.img`))).then(([mob, npc, map]) => { this.str = { mob, npc, map }; });
    a.json('String/ToolTipHelp.img').then((t) => { this.alarmTip = t?.Game?.Button?.QuestAlarm; });
    a.json('Etc/QuestCategory.img').then((c) => { this.areas = c || {}; });
    a.json('Etc/NpcLocation.img').then((l) => { this.npcMaps = l || {}; });
    this.portraits = new Map();
  }
  /** Everything available at login counts as seen: NEW marks the ones that open up afterwards. */
  markAllSeen() { const t = this.tab; this.tab = 0; for (const e of this.entries()) this.seen.add(e.id); this.tab = t; this.rowCache = null; }
  frames() {
    const W = this.W;
    return [...super.frames(), W.backgrnd2, W.backgrnd4, W.icon0, W.icon4, W.summary, W.reward, W.prob, W.select, W.basic,
      ...['icon2', 'icon3', 'icon5', 'icon6', 'icon7', 'icon8', 'icon9'].flatMap((k) => allCanvases(W[k])), W.notice0, W.notice1, W.notice2, ...allCanvases(W.Tab)].filter(isCanvas);
  }
  get wide() { return this.sel ? this.w + 305 : this.w; }
  contains(x, y) { return x >= this.x && x < this.x + this.wide && y >= this.y && y < this.y + this.h; }

  /** Opened by its key: In Progress on the quest that moved last, else Available on the first new one. */
  onOpen() {
    const book = this.g.quests;
    if (!book) return;
    this.tab = 1; this.first = 0;
    const prog = this.rows().filter((r) => r.id);
    const pick = [book.recent, this.lastProgress].find((id) => id && prog.some((r) => r.id === id)) ?? prog[0]?.id;
    if (pick) { this.select(pick); this.scrollTo(pick); return; }
    this.tab = 0;
    const avail = this.rows().filter((r) => r.id && !this.tooLow(r.id));
    const first = avail.find((r) => !this.seen.has(r.id)) || avail[0];
    if (first) { this.select(first.id); this.scrollTo(first.id); } else this.sel = null;
  }
  scrollTo(id) { const i = this.rows().findIndex((r) => r.id === id); this.first = i >= 9 ? Math.max(0, Math.min(i, this.rows().length - QROWS)) : 0; }

  // ---------------------------------------------------------------- what is listed
  /** The quests of the tab: plain ones (with a start NPC, no titles), and chains as one entry each. */
  entries() {
    const book = this.g.quests, ctx = this.g.textCtx(), tab = this.tab;
    if (!book) return [];
    const ids = tab === 0 ? book.available(ctx) : Object.keys(tab === 1 ? book.started : book.completed).map(Number).filter((id) => book.status(id) === tab && book.checkPos.has(id))
      .sort((x, y) => book.checkPos.get(x) - book.checkPos.get(y));
    const out = ids.filter((id) => book.info[id] && !book.info[id].parent && book.check[id]?.['0']?.npc && book.area(id) !== TITLE_AREA)
      .map((id) => ({ id, name: book.name(id), area: book.area(id) }));
    for (const parent of book.chainParents) {
      const e = this.chainEntry(parent, book.chains.get(parent), ctx);
      if (e && e.tab === tab && e.area !== TITLE_AREA) out.push(e);
    }
    return out;
  }
  /**
   * A chain: Available while its first part can be taken; otherwise each part under way or done adds its name and
   * words (1 / 2). In Progress until every part is done, then Completed. Its quest is the part under way, else the
   * last one done.
   */
  chainEntry(parent, parts, ctx) {
    const book = this.g.quests, first = parts[0], area = book.area(first);
    if (book.canStart(first, ctx)) return { id: first, name: parent, chain: true, tab: 0, area, texts: [[book.name(first), book.info[first]?.['0']]], first };
    let current = 0, last = 0, done = 0;
    const texts = [];
    for (const id of parts) {
      const st = book.status(id);
      if (st === 1) { current = id; texts.push([book.name(id), book.info[id]?.['1']]); }
      else if (st === 2) { last = id; done++; texts.push([book.name(id), book.info[id]?.['2']]); }
    }
    if (!current && !done) return null;
    return { id: current || last, name: parent, chain: true, tab: done === parts.length ? 2 : 1, area, texts, first, current, ended: done === parts.length ? last : 0 };
  }
  entry(id) { return this.rows().find((r) => r.id === id)?.e || { id, name: this.g.quests.name(id) }; }
  areaName(code) { const n = this.areas?.[code]; return n && n !== 'empty' ? n : 'Etc.'; }
  /** Outgrown: an Available quest 20 levels under you with no end date, drawn small and grey. */
  tooLow(id) {
    const c = this.g.quests.check[id]?.['0'] || {};
    return this.tab === 0 && !c.end && (c.lvmin || 0) + 20 <= (this.g.stats?.level || 0);
  }
  /** The rows shown: per area (in area order) a header, then its quests by sortkey and level unless folded. */
  rows() {
    const now = performance.now(), c = this.rowCache, folds = this.folded[this.tab].size;
    if (c && c.tab === this.tab && c.folds === folds && now - c.at < 250) return c.rows;
    const rows = this.buildRows();
    this.rowCache = { tab: this.tab, folds, at: now, rows };
    return rows;
  }
  buildRows() {
    // by area, then sortkey, then level - with the log's own (unstable) sort, so equal quests keep its order
    const book = this.g.quests, list = this.entries();
    for (const e of list) { e.sort = Number(book.info[e.id]?.sortkey) || 0; e.lv = Number(book.check[e.id]?.['0']?.lvmin) || 0; }
    questSort(list, (x, y) => (x.area !== y.area ? x.area < y.area : x.sort !== y.sort ? x.sort < y.sort : x.lv <= y.lv));
    const out = [], folded = this.folded[this.tab], counts = new Map();
    for (const e of list) counts.set(e.area, (counts.get(e.area) || 0) + 1);
    let area = null;
    for (const e of list) {
      if (e.area !== area) { area = e.area; out.push({ head: area, count: counts.get(area) }); }
      if (!folded.has(area)) out.push({ id: e.id, e });
    }
    return out;
  }
  get visibleRows() { return this.rows().length - this.first > QROWS ? QROWS + 1 : QROWS; }

  rowAt(lx, ly) {
    if (lx < 13 || lx > 223 || ly < QROW_Y) return -1;
    const i = Math.floor((ly - QROW_Y) / QROW_H);
    return i < this.visibleRows && this.first + i < this.rows().length ? this.first + i : -1;
  }
  select(id) {
    this.sel = id; this.dfirst = 0; this.sfirst = 0; this.selEntry = this.entry(id);
    if (this.tab === 0) this.seen.add(id);
    if (this.tab === 1) this.lastProgress = id;
    this.layoutDetail();
    this.portrait(this.questNpc(id));
  }
  /** The NPC shown for a quest: the one who starts it, or the Maple Administrator. */
  questNpc(id) { return Number(this.g.quests.check[id]?.['0']?.npc) || MAPLE_ADMIN; }
  async portrait(npcId) {
    if (!npcId || this.portraits.has(npcId)) return;
    this.portraits.set(npcId, null);
    const a = this.mgr.assets;
    let node = await a.json(`Npc/${String(npcId).padStart(7, '0')}.img`);
    if (node?.info?.link) node = await a.json(`Npc/${String(node.info.link).padStart(7, '0')}.img`);
    // info/default when it has one; else, looping, its first own action when it has more than two, or its stand
    const framesOf = (act) => Object.keys(act || {}).filter((k) => /^\d+$/.test(k)).sort((x, y) => x - y).map((k) => act[k]).filter((f) => f?._canvas);
    const extras = Object.keys(node || {}).filter((k) => !['info', 'stand', 'move'].includes(k) && framesOf(node[k]).length);
    const list = node?.info?.default?._canvas ? [node.info.default] : framesOf(extras.length > 2 ? node[extras[0]] : node?.stand);
    if (list.length) { await a.preload(list); this.portraits.set(npcId, list); }
  }
  /** "Over Level 10" / "Under Level 30" ("No limit" with no start requirements), or for a finished one when it ended. */
  levelLine(e) {
    const book = this.g.quests, id = e.chain ? e.first : e.id, c = book.check[id]?.['0'];
    if (this.tab === 2 || e.ended) {
      const ft = book.completed[e.ended || e.id];
      try {
        const d = new Date(Number(BigInt(ft) / 10000n - 11644473600000n));
        if (!Number.isNaN(d.getTime())) return `Ended at ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} at ${String(d.getHours()).padStart(2, '0')}:00`;
      } catch { /* no time */ }
      return '';
    }
    if (!c) return 'No limit';
    let s = c.lvmin ? `Over Level ${c.lvmin}` : '';
    if (c.lvmax) s = `${s ? `${s} ` : ''} Under Level ${c.lvmax}`;
    return s;
  }
  /** The detail text: the quest's own words for where you are with it - grey, black while it is under way. */
  layoutDetail() {
    const book = this.g.quests, e = this.selEntry || this.entry(this.sel), id = e.chain ? e.current || e.id : this.sel, info = book.info[id] || {};
    const ctx = document.createElement('canvas').getContext('2d');
    const text = e.chain ? e.texts.map(([n, t]) => (t ? `${n}\n${t}` : n)).join('\n') : String(info[String(this.tab)] ?? '');
    const base = this.tab === 1 ? '#000' : '#666666';
    const sumText = this.tab === 1 ? [info.summary && `#Wsummary#\n${info.summary}`, info.demandSummary, (info.rewardSummary) && ` \n#Wreward#\n${info.rewardSummary}`].filter(Boolean).join('\n') : '';
    this.sum = sumText ? richText(ctx, sumText, QSUM.w, this.ref(), { base, size: QFONT, lineH: QLINE }) : null;
    this.lines = richText(ctx, text, QDETAIL.w, this.ref(), { base, size: QFONT, lineH: QLINE });
    this.laidOut = this.mgr.namesVersion;
  }
  ref() {
    const m = this.mgr, s = this.str || {}, W = this.W;
    const mapName = (id) => { for (const r of Object.values(s.map || {})) if (r?.[id]) return r[id].mapName; return id; };
    return {
      player: this.g.player.name, item: (id) => m.itemName(id) || `item ${id}`, mob: (id) => s.mob?.[id]?.name || `monster ${id}`,
      npc: (id) => s.npc?.[id]?.name || `NPC ${id}`, map: (id) => mapName(id), count: (id) => this.g.itemCount(id), icon: (id) => m.icon(id),
      skill: (id) => { const g = this.g; if (!g.skills?.strings) return ''; return g.skills.name(id); },
      skillIcon: (id) => { const g = this.g, n = g.skills?.icon(id); if (!n) g.skills?.ensure(id)?.then?.(() => { m.namesVersion++; }); return n; },
      image: (path) => { if (!path.includes('/')) return W[path] || null; const [, file, ...rest] = path.split('/'); let n = file === 'UIWindow.img' ? m.W : file === 'Basic.img' ? m.B : null; for (const k of rest) n = n?.[k]; return n?._canvas ? n : null; },
    };
  }
  /** Mark NPC: point at the NPC if it is here, else say where it lives. */
  findNpc() {
    const npc = this.questNpc(this.sel), g = this.g;
    if (!npc) return;
    const name = this.ref().npc(npc);
    const here = g.map?.life.find((e) => e.kind === 'Npc' && Number(e.spawn.id) === npc);
    if (here) { g.markNpc(here, name); return; }
    const maps = Object.values(this.npcMaps?.[npc] || {}).map((id) => this.ref().map(id)).filter((n) => typeof n === 'string');
    this.mgr.notice(maps.length ? `${name} is in ${[...new Set(maps)].join(', ')}.` : 'This NPC is located at a spot not\navailable through the World Map.');
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    const book = this.g.quests, id = this.sel, st = id ? book.status(id) : -1;
    const row = id && this.rows().find((r) => r.id === id);
    if (id && !row) this.sel = null;
    else if (row) {
      const was = this.selEntry;
      this.selEntry = row.e;
      if (was?.texts?.length !== row.e.texts?.length || was?.id !== row.e.id) this.layoutDetail();
    }
    const shown = !!this.sel;
    this.findBtn.visible = shown && this.tab === 0;
    this.giveup.visible = this.alert.visible = shown && this.tab !== 0;
    this.giveup.enabled = st === 1 && !isPartyQuest(id);
    this.alert.enabled = st === 1 && !!this.mgr.wins.questalarm?.canAdd(id);
    this.hideBtn.visible = shown;
    if (shown) this.bg2 = this.tab === 1 && this.sum ? this.W.backgrnd4 : this.W.backgrnd2;
    super.draw(ctx);
  }
  body(ctx) {
    const m = this.mgr, book = this.g.quests;
    if (!book) return;
    this.tabRects = drawTabStrip(ctx, m, this.W.Tab, 3, this.tab, 200, 24);
    const rows = this.rows(), qctx = this.g.textCtx(), now = performance.now(), alarm = m.wins.questalarm;
    this.first = Math.min(this.first, Math.max(0, rows.length - QROWS));
    const anim = (node) => { const f = node && Object.keys(node).filter((k) => /^\d+$/.test(k)); return f?.length ? node[f[Math.floor(now / 150) % f.length]] : node; };
    for (let i = 0; i < this.visibleRows; i++) {
      const r = rows[this.first + i];
      if (!r) break;
      const y = QROW_Y + i * QROW_H;
      if (r.head !== undefined) {
        ctx.fillStyle = '#9fb5ce'; ctx.fillRect(8, y + 1, 214, 19);
        const fold = m.image(this.folded[this.tab].has(r.head) ? m.B.BtMax?.normal?.[0] : m.B.BtMin?.normal?.[0]);
        if (fold) ctx.drawImage(fold, 12, y + 4);
        uiText(ctx, `${this.areaName(r.head)} (${r.count})`, 30, y + 3, { color: '#fff', size: QFONT });
        continue;
      }
      const e = r.e, id = r.id, name = e.name, type = id === this.sel ? book.info[id]?.type || '' : '';
      ctx.font = `bold ${QFONT}px Arial, sans-serif`;
      const tw = type ? ctx.measureText(type).width + 2 : 0;
      if (id === this.sel) { ctx.fillStyle = '#396093'; ctx.fillRect(28, y + 1, 194, 19); }
      let icon, dy = 2;
      if (this.tab === 0) icon = this.seen.has(id) ? this.W.icon0 : anim(this.W.icon5);
      else if (this.tab === 1) {
        const q = e.chain ? e.current : id, tracked = alarm?.tracked(q);
        if (q && book.info[q]?.timeLimit) { icon = anim(this.W.icon7); dy = 4; }
        else if (q && book.canComplete(q, qctx)) icon = anim(this.W.icon3);
        else if (e.chain) { icon = anim(tracked ? this.W.icon9 : this.W.icon8); dy = 4; }
        else { icon = anim(tracked ? this.W.icon6 : this.W.icon2); dy = 4; }
      } else icon = !e.chain && book.canStart(id, qctx) ? this.W.icon0 : this.W.icon4;
      const ic = m.image(icon);
      if (ic) ctx.drawImage(ic, 11, y + dy);
      ctx.save(); ctx.beginPath(); ctx.rect(28, y, 198, QROW_H); ctx.clip();
      if (type) uiText(ctx, type, 30, y + 3, { color: '#ff2020', bold: true, size: QFONT });
      const low = this.tooLow(id);
      uiText(ctx, name, 30 + tw, y + 3, { color: id === this.sel ? '#fff' : low ? '#b2b2b2' : '#000', size: low ? 11 : QFONT });
      ctx.restore();
    }
    if (!rows.length) {
      const n = m.image(this.W[`notice${this.tab}`]);
      if (n) ctx.drawImage(n, ((210 - n.width) >> 1) - 2, ((309 - n.height) >> 1) + 50);
    }
    this.scrollbar(ctx, 229, 46, 324, this.first, rows.length, QROWS);
    if (this.sel) this.drawDetail(ctx);
  }
  drawDetail(ctx) {
    if (this.laidOut !== this.mgr.namesVersion || (!this.laidStr && this.str)) { this.laidStr = !!this.str; this.layoutDetail(); }
    const bg = this.mgr.image(this.bg2), book = this.g.quests, id = this.sel, m = this.mgr;
    ctx.save(); ctx.translate(this.w, 0);
    if (bg) ctx.drawImage(bg, 0, 0);
    ctx.font = `bold ${QFONT}px Arial, sans-serif`;
    const e = this.selEntry || this.entry(id);
    let name = e.name;
    if (ctx.measureText(name).width > 150) { while (name.length > 1 && ctx.measureText(`${name}..`).width > 150) name = name.slice(0, -1); name = `${name}..`; }
    ctx.fillStyle = '#d9f7c6'; ctx.beginPath(); ctx.arc(24, 47, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4dbb2b'; ctx.beginPath(); ctx.arc(24, 47, 3, 0, Math.PI * 2); ctx.fill();
    uiText(ctx, name, 35, 40, { color: '#fff', bold: true, size: QFONT });
    const lv = this.levelLine(e);
    if (lv) uiText(ctx, lv, 23, 60, { color: '#fff', size: QFONT });
    // the start NPC standing (animated), feet at (242, 100) - a tall one rises over the box
    const fr = this.portraits.get(this.questNpc(id));
    if (fr?.length) {
      const total = fr.reduce((t, x) => t + (Number(x.delay) || 120), 0);
      let t = performance.now() % total, f = fr[0];
      for (const x of fr) { f = x; if ((t -= Number(x.delay) || 120) < 0) break; }
      const pi = m.image(f);
      if (pi) { const o = f.origin || [pi.width / 2, pi.height]; ctx.drawImage(pi, Math.round(242 - o[0]), Math.round(100 - o[1])); }
    }
    const drawIcon = (n, x, y) => m.drawIcon(ctx, n, x, y), drawImage = (n, x, y) => { const i = m.image(n); if (i) ctx.drawImage(i, x, y); };
    const h = this.sum ? QDETAIL.hSum : QDETAIL.h;
    ctx.save(); ctx.beginPath(); ctx.rect(QDETAIL.x, QDETAIL.y, QDETAIL.w, h); ctx.clip();
    drawRich(ctx, this.lines, QDETAIL.x, QDETAIL.y - this.dfirst * QDETAIL.line, { size: QFONT, drawIcon, drawImage });
    ctx.restore();
    this.scrollbar(ctx, 285, QDETAIL.y, h, this.dfirst, Math.ceil(this.lines.height / QDETAIL.line), Math.floor(h / QDETAIL.line));
    if (this.sum) {
      ctx.save(); ctx.beginPath(); ctx.rect(QSUM.x, QSUM.y, QSUM.w, QSUM.h); ctx.clip();
      drawRich(ctx, this.sum, QSUM.x, QSUM.y - this.sfirst * QDETAIL.line, { size: QFONT, drawIcon, drawImage });
      ctx.restore();
      this.scrollbar(ctx, 285, QSUM.y, QSUM.h, this.sfirst, Math.ceil(this.sum.height / QDETAIL.line), Math.floor(QSUM.h / QDETAIL.line));
    }
    const t = this.g.questTimers?.get(id);
    if (t && this.tab === 1) {
      const left = Math.max(0, Math.round((t.end - performance.now()) / 1000));
      uiText(ctx, `Time Left ${Math.floor(left / 3600)}:${Math.floor(left / 60) % 60}:${left % 60}`, 17, 375, { color: '#ff2020', bold: true, size: QFONT });
    }
    ctx.restore();
  }
  down(lx, ly) {
    const t = tabAt(this.tabRects, lx, ly);
    if (t >= 0) {
      if (t !== this.tab) {
        this.tab = t; this.first = 0; this.sel = null; sfx.play('UI/Tab');
        const first = this.rows().find((r) => r.id && (t !== 0 || !this.tooLow(r.id)));
        const keep = t === 1 && this.lastProgress && this.rows().some((r) => r.id === this.lastProgress) ? this.lastProgress : first?.id;
        if (keep) { this.select(keep); this.scrollTo(keep); }
      }
      return;
    }
    if (lx >= this.w) {
      const sh = this.sum ? QDETAIL.hSum : QDETAIL.h;
      let s = this.scrollClick(lx - this.w, ly, 285, QDETAIL.y, sh, this.dfirst, Math.ceil(this.lines.height / QDETAIL.line), Math.floor(sh / QDETAIL.line));
      if (s !== null) { this.dfirst = s; return; }
      if (this.sum) { s = this.scrollClick(lx - this.w, ly, 285, QSUM.y, QSUM.h, this.sfirst, Math.ceil(this.sum.height / QDETAIL.line), Math.floor(QSUM.h / QDETAIL.line)); if (s !== null) this.sfirst = s; }
      return;
    }
    const rows = this.rows();
    const s = this.scrollClick(lx, ly, 229, 46, 324, this.first, rows.length, QROWS);
    if (s !== null) { this.first = s; return; }
    const i = this.rowAt(lx, ly), r = rows[i];
    if (!r) { if (ly >= 40 && lx < 228) this.sel = null; return; }
    if (r.head !== undefined) {
      const f = this.folded[this.tab];
      if (f.has(r.head)) f.delete(r.head); else f.add(r.head);
      sfx.play('UI/BtMouseClick');
    } else this.select(r.id);
  }
  dblclick(lx, ly) {
    // the NPC's picture: find it
    if (lx >= this.w + 198 && lx < this.w + 284 && ly >= 28 && ly < 122 && this.sel && this.tab !== 2) this.findNpc();
  }
  wheel(dy) {
    const lx = this.mgr.mouse.x - this.x, ly = this.mgr.mouse.y - this.y;
    if (lx >= this.w && this.sel) {
      const step = Math.sign(dy) * 2;
      if (this.sum && ly >= QSUM.y) this.sfirst = Math.max(0, Math.min(Math.ceil(this.sum.height / QDETAIL.line) - Math.floor(QSUM.h / QDETAIL.line), this.sfirst + step));
      else { const h = this.sum ? QDETAIL.hSum : QDETAIL.h; this.dfirst = Math.max(0, Math.min(Math.ceil(this.lines.height / QDETAIL.line) - Math.floor(h / QDETAIL.line), this.dfirst + step)); }
    } else this.first = Math.max(0, Math.min(this.rows().length - QROWS, this.first + Math.sign(dy)));
  }
}

// ==================================================================== Minimap
/**
 * MiniMap: three states - 0 MaxMap (72px header: title, street / map names, map mark), 1 MinMap (29px header, title
 * only) and 2 Min (a 20px bar with both names). The picture is the map's own miniMap canvas at its size: a world
 * point is at ((x + centerX) >> mag, (y + centerY) >> mag), the view at most 210 wide (past 279) and 112 tall (past
 * 149), centred on you and stopped at the canvas edges. Markers (Map/MapHelper.img/minimap) stand bottom-centre on
 * their point. A map with hideMinimap (not for GMs) or no miniMap node keeps the window as the Min bar with BtMin /
 * BtMax disabled; the chosen state comes back on the next map. State and position are kept between sessions.
 */
const MM_KEY = 'maple.minimap';
class MiniMapWin extends Win {
  constructor(mgr) {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(MM_KEY)) || {}; } catch { return {}; } })();
    super(mgr, null, Number.isFinite(saved.x) ? saved.x : 8, Number.isFinite(saved.y) ? saved.y : 8);
    this.buttons = [];                         // no close box: the minimap key cycles its states
    this.W = mgr.W.MiniMap;
    this.state = [0, 1, 2].includes(saved.state) ? saved.state : 1;
    this.dragH = 1e4;                          // dragged from anywhere that isn't a button
    const B = mgr.B;
    this.minBtn = this.button(B.BtMin, 0, 6, () => this.setState(this.state + 1));
    this.maxBtn = this.button(B.BtMax, 0, 6, () => this.setState(this.state - 1));
    this.worldBtn = this.button(this.W.BtMap, 0, 6, () => this.openWorldMap());
    mgr.assets.json('Map/MapHelper.img').then((h) => { this.helper = h; mgr.assets.preload([...allCanvases(h?.minimap), ...allCanvases(h?.mark)]); });
    mgr.assets.json('String/Map.img').then((s) => { this.strMap = s; });
    mgr.assets.json('String/ToolTipHelp.img').then((s) => { this.tips = s?.PortalTooltip; });
  }
  frames() { return [this.W.title, ...allCanvases(this.W.MinMap), ...allCanvases(this.W.MaxMap), ...allCanvases(this.W.Min), ...this.buttons.flatMap((b) => b.frames())]; }
  save() { try { localStorage.setItem(MM_KEY, JSON.stringify({ x: this.x, y: this.y, state: this.state })); } catch { /* ignore */ } }
  setState(st) { if (!this.available()) return; this.state = Math.max(0, Math.min(2, st)); this.save(); }
  /** The minimap key: Max -> Min bar -> MinMap -> Max; nothing on a map without a minimap. */
  cycle() { if (this.available()) { this.state = (this.state + 2) % 3; this.save(); } }
  /** hideMinimap (not for GMs) or no miniMap node: no minimap here; ADMIN_RESULT 0x1C turns it off until the next map. */
  available() {
    const g = this.g, map = g.map;
    if (!map?.data || g.minimapOff === map) return false;
    if (!g.gm && Number(map.info?.hideMinimap)) return false;
    if (!map.data.miniMap?.canvas) return false;
    if (!g.gm && g.minimapFlag === 0 && Number(map.info?.miniMapOnOff)) return false;
    return true;
  }
  /** The miniMap canvas and its view size. */
  view() {
    const mm = this.g.map?.data?.miniMap, c = mm?.canvas;
    if (!c?._canvas) return null;
    const cw = c._w || 0, ch = c._h || 0;
    return { mm, c, cw, ch, vw: cw > 279 ? 210 : cw, vh: ch > 149 ? 112 : ch, mag: Number(mm.mag) || 0, cx: Number(mm.centerX) || 0, cy: Number(mm.centerY) || 0, ww: Number(mm.width) || 0, wh: Number(mm.height) || 0 };
  }
  names() {
    const id = this.g.map?.id;
    for (const r of Object.values(this.strMap || {})) if (r?.[id]) return r[id];
    return { mapName: this.g.map?.name || '', streetName: '' };
  }
  mark() {
    const m = this.g.map?.info?.mapMark;
    return m && m !== 'None' ? this.helper?.mark?.[m] : null;
  }
  layout() {
    const st = this.available() ? this.state : 2, v = this.view(), n = this.names();
    this.shown = st;
    const ctx = (this.measure ??= document.createElement('canvas').getContext('2d'));
    ctx.font = 'bold 12px Arial, sans-serif';
    const streetW = Math.ceil(ctx.measureText(n.streetName || '').width), mapW = Math.ceil(ctx.measureText(n.mapName || '').width);
    ctx.font = '12px Arial, sans-serif';
    const barMapW = Math.ceil(ctx.measureText(n.mapName || '').width), barStreetW = Math.ceil(ctx.measureText(n.streetName || '').width);
    const vw = v?.vw || 0, vh = v?.vh || 0, m = this.mark() ? 40 : 0;
    if (st === 0) { this.w = Math.max(streetW + 5 + m, mapW + 5 + m, vw) + 12; this.w = Math.max(120, this.w); this.h = vh + 87; this.top = 72; }
    else if (st === 1) { this.w = Math.max(vw + 12, 120); this.h = vh + 43; this.top = 29; }
    else { this.barMapW = barMapW; this.w = barMapW + 5 + 80 + barStreetW + 5; this.h = 20; this.top = 0; }
    this.left = Math.floor((this.w - vw) / 2);
    const bar = st === 2;
    this.minBtn.x = this.w - (bar ? 71 : 69); this.maxBtn.x = this.w - (bar ? 58 : 56); this.worldBtn.x = this.w - (bar ? 44 : 42);
    for (const b of this.buttons) b.y = bar ? 4 : 6;
    const on = this.available();
    this.maxBtn.enabled = on && st !== 0; this.minBtn.enabled = on && st !== 2; this.worldBtn.enabled = true;
  }
  draw(ctx) { this.layout(); super.draw(ctx); }
  dragged() { this.save(); }
  /** BtMap: the world map that lists this map, or a notice when none does. */
  async openWorldMap() {
    const wm = this.mgr.wins.worldmap;
    if (!this.mgr.order.includes(wm) && wm?.find && !(await wm.find(this.g.map?.id))) {
      this.mgr.notice('You are currently at a place where\nthe world map is not available.');
      return;
    }
    this.mgr.toggle('worldmap');
  }

  /** Canvas pixel of a world point, and the scroll that centres the view on you (clamped to the canvas). */
  scroll(v) {
    const p = this.g.player, span = (n) => n << v.mag;
    const sx = Math.max(-v.cx, Math.min(v.ww - v.cx - span(v.vw), p.x - span(v.vw) / 2));
    const sy = Math.max(-v.cy, Math.min(v.wh - v.cy - span(v.vh), p.y - span(v.vh) / 2));
    return { x: Math.max(0, (Math.trunc(sx) + v.cx) >> v.mag), y: Math.max(0, (Math.trunc(sy) + v.cy) >> v.mag) };
  }
  at(v, sc, wx, wy) { return { x: this.left + ((Math.trunc(wx) + v.cx) >> v.mag) - sc.x, y: this.top + ((Math.trunc(wy) + v.cy) >> v.mag) - sc.y }; }

  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), st = this.shown, n = this.names();
    if (st === 2) {
      const [w, c, e] = ['w', 'c', 'e'].map((k) => im(this.W.Min[k]));
      if (w && c && e) { ctx.drawImage(w, 0, 0); ctx.drawImage(c, w.width, 0, this.w - w.width - e.width, 20); ctx.drawImage(e, this.w - e.width, 0); }
      uiText(ctx, n.mapName || '', 6, 3, { color: '#000', size: 12 });
      uiText(ctx, n.streetName || '', (this.barMapW || 0) + 12, 3, { color: '#000', size: 12 });
      return;
    }
    const F = st === 0 ? this.W.MaxMap : this.W.MinMap, v = this.view();
    // the map area is a see-through black (2/3), not the frame's light middle
    ctx.save();
    if (v) { ctx.beginPath(); ctx.rect(0, 0, this.w, this.h); ctx.rect(this.left, this.top, v.vw, v.vh); ctx.clip('evenodd'); }
    nineSlice(ctx, m, F, this.w, this.h);
    ctx.restore();
    if (v) { ctx.fillStyle = 'rgba(0,0,0,0.667)'; ctx.fillRect(this.left, this.top, v.vw, v.vh); }
    const t = im(this.W.title);
    if (t) ctx.drawImage(t, 8, 10);
    if (st === 0) {
      const mark = this.mark(), x0 = mark ? 49 : 9;
      if (mark) { if (im(mark)) ctx.drawImage(im(mark), 8, 24); else m.assets.preload([mark]); }
      // white with a 1px #52759C outline on all eight sides
      for (const [text, y] of [[n.streetName || '', 28], [n.mapName || '', 44]]) {
        for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) uiText(ctx, text, x0 + dx, y + dy, { color: '#52759C', size: 12, bold: true });
        uiText(ctx, text, x0, y, { color: '#fff', size: 12, bold: true });
      }
    }
    if (!v) return;
    const img = im(v.c);
    if (!img) { m.assets.preload([v.c]); return; }
    const sc = this.scroll(v);
    ctx.save();
    ctx.beginPath(); ctx.rect(this.left, this.top, v.vw, v.vh); ctx.clip();
    ctx.drawImage(img, sc.x, sc.y, v.vw, v.vh, this.left, this.top, v.vw, v.vh);
    this.drawMarkers(ctx, v, sc);
    ctx.restore();
  }

  /** Markers bottom-centre on their point, in the client's order: strangers, portals, friends / guild / party, NPCs, you. */
  drawMarkers(ctx, v, sc) {
    const g = this.g, H = this.helper?.minimap || {}, im = (n) => this.mgr.image(n);
    const put = (node, wx, wy) => {
      const s = im(node);
      if (!s) return;
      const p = this.at(v, sc, wx, wy);
      ctx.drawImage(s, p.x - Math.floor(s.width / 2), p.y - s.height);
    };
    const lists = { friend: [], guild: [], guildmaster: [], party: [], partymaster: [], match: [] };
    const party = g.party, guild = g.guild, buddies = new Set((g.buddies || []).map((b) => b.id));
    const ring = g.rings?.marriage, me = g.player?.id, spouse = ring ? (ring.husbandId === me ? ring.wifeId : ring.husbandId) : 0;
    for (const o of g.others.values()) {
      const gm = guild?.members?.find((x) => x.name === o.name);
      const kind = spouse && o.id === spouse ? 'match'
        : party?.members?.some((x) => x.id === o.id) ? (party.leader === o.id ? 'partymaster' : 'party')
          : gm ? (gm.rank === 1 ? 'guildmaster' : 'guild')
            : buddies.has(o.id) ? 'friend' : null;
      if (kind) lists[kind].push(o); else put(H.another, o.x, o.y);
    }
    for (const p of g.map.portals) if (p.pt === 2 || p.pt === 7) put(H.portal, p.x, p.y);
    for (const k of ['friend', 'guild', 'guildmaster', 'party', 'partymaster', 'match']) for (const o of lists[k]) put(H[k], o.x, o.y);
    // NPCs from the map's own life list, marked by the spawned NPC's quests: plain, then can-complete, then can-start on top
    const q = g.quests, qctx = g.textCtx?.(), end = [], start = [];
    for (const e of this.npcs()) {
      const mk = q && qctx ? q.npcQuests(e.id, qctx) : null;
      if (mk?.complete?.length) end.push(e); else if (mk?.start?.length) start.push(e); else put(H.npc, e.x, e.y);
    }
    for (const e of end) put(H.endnpc, e.x, e.y);
    for (const e of start) put(H.startnpc, e.x, e.y);
    put(H.user, g.player.x, g.player.y);
  }
  /** The map's WZ NPCs (type n, not hidden) at their WZ spot. */
  npcs() {
    const map = this.g.map;
    if (this.npcList?.map === map) return this.npcList.list;
    const list = Object.values(map?.data?.life || {}).filter((l) => l.type === 'n' && !Number(l.hide)).map((l) => ({ id: Number(l.id), x: Number(l.x), y: Number(l.y) }));
    this.npcList = { map, list };
    return list;
  }
  /** Hover: an NPC's name, or a visible portal's destination (PortalTooltip, else the target map's name). */
  tooltip(lx, ly) {
    if (this.shown === 2 || !this.available()) return null;
    const v = this.view();
    if (!v) return null;
    const sc = this.scroll(v), hit = (wx, wy) => { const p = this.at(v, sc, wx, wy); return lx >= p.x - 2 && lx < p.x + 3 && ly >= p.y - 5 && ly < p.y + 2; };
    for (const e of this.npcs()) if (hit(e.x, e.y)) { const name = this.mgr.strings?.npc?.[e.id]?.name; if (name) return { title: name, lines: [] }; }
    for (const p of this.g.map.portals) {
      if ((p.pt !== 2 && p.pt !== 7) || !p.tm || p.tm === 999999999 || !hit(p.x, p.y)) continue;
      const tip = this.tips?.[this.g.map.id]?.[p.pn];
      if (tip) return { title: String(tip), lines: [] };
      for (const r of Object.values(this.strMap || {})) if (r?.[p.tm]?.mapName) return { title: r[p.tm].mapName, lines: [] };
    }
    return null;
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
    this.button(W.BtQuickSlot, 161, 236, () => mgr.bar.setQuickOpen(!mgr.bar.quickOpen));
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
    if (b.type === 2 || b.type === 3 || b.type === 7) return this.mgr.icon(b.action);
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
    const it = c.kind === 'item' && itemKeyType(c.tab, c.id);
    const b = c.kind === 'bind' ? c.b : c.kind === 'skill' ? { type: 1, action: c.id } : it ? { type: it, action: c.id } : null;
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
    const title = b.type === 1 ? this.g.skills.name(b.action) : [2, 3, 7].includes(b.type) ? this.mgr.itemName(b.action) : null;
    return title ? { title, lines: [] } : null;
  }
}

// ==================================================================== tooltip
/** A text tooltip in the client's panel: translucent navy with a white ring, the title centred, lines below. */
function drawTip(ctx, tip, x, y) {
  ctx.save();
  ctx.font = '12px Arial, sans-serif';
  const lines = tip.lines.flatMap((l) => (l ? wrapText(ctx, l, 255, 12) : ['']));
  ctx.font = 'bold 12px Arial, sans-serif';
  const tw = ctx.measureText(tip.title).width;
  ctx.font = '12px Arial, sans-serif';
  const w = Math.ceil(Math.max(tw + 20, ...lines.map((l) => ctx.measureText(l).width + 20), 80));
  const h = 24 + lines.length * 15 + (lines.length ? 4 : 0);
  x = Math.min(x, 800 - w - 2); y = Math.min(y, 600 - h - 2);
  ctx.fillStyle = 'rgba(0,0,64,0.627)';
  ctx.fillRect(x + 1, y, w - 2, 1); ctx.fillRect(x, y + 1, w, h - 2); ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 1, y + 2, 1, h - 4); ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
  ctx.fillRect(x + 2, y + 1, w - 4, 1); ctx.fillRect(x + 2, y + h - 2, w - 4, 1);
  uiText(ctx, tip.title, x + w / 2, y + 6, { color: '#fff', bold: true, size: 12, align: 'center' });
  lines.forEach((l, i) => uiText(ctx, l, x + 10, y + 24 + i * 15, { color: '#fff', size: 12 }));
  ctx.restore();
}

/** Every canvas anywhere under a node. */
export function allCanvases(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (isCanvas(node)) { out.push(node); return out; }
  for (const k in node) if (!k.startsWith('_')) allCanvases(node[k], out);
  return out;
}

