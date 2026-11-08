import { isCanvas } from '../assets.js';
import { ControlTabs } from './keyconfig-tabs.js';
import { cloneControls, saveControls } from '../controls.js';
import { EXP, jobName, itemIcon, itemName, itemInfo, invType, isScroll, itemKeyType } from '../data.js';
import { sfx } from '../audio.js';
import { WzButton, TextField, uiText, wrapText } from './wzui.js';
import { richText, drawRich, QUEST_STATES } from './richtext.js';
import { isPartyQuest, questSort, TITLE_AREA } from '../quests.js';
import { UI_W, UI_H } from '../view.js';
import { CODE_TO_SC, DEFAULT_QUICKSLOTS, DEFAULT_QUICKSLOTS2, saveQuickKeys2 } from '../keymap.js';

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
    this.slop = 4;   // how far a press may move and still be a click: 4px for a mouse, more for a finger (see pointer)
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
      ...allCanvases(this.W.UtilDlgEx), ...allCanvases(this.B.YesNo3), ...allCanvases(this.W.ItemProtector?.Icon), ...allCanvases(this.W.ToolTip),
      ...['BtOK', 'BtOK2', 'BtCancel', 'BtCancel2'].flatMap((k) => allCanvases(this.B[k]))]);
    Promise.all(['Mob', 'Npc', 'Map'].map((k) => a.json(`String/${k}.img`))).then(([mob, npc, map]) => { this.strings = { mob, npc, map }; this.namesVersion++; });
  }

  isOpen(name) { return this.order.includes(this.wins[name]); }
  /** Opened from a hotkey, a menu or Esc (sound): MenuUp. Opened by the game itself: silent, unless it has its own. */
  open(name, sound = null) {
    const w = this.wins[name];
    if (!w) return null;
    if (!this.order.includes(w)) { this.order.push(w); w.openedSeq = this.openSeq = (this.openSeq || 0) + 1; w.onOpen?.(); this.fit(w); const s = w.openSound || sound; if (s) sfx.play(s); } else this.raise(w);
    return w;
  }
  /**
   * Brings a window into view as it opens or the screen size changes: wholly, when it fits; one too big for the
   * view keeps its corner on screen.
   */
  fit(w) {
    if (!w) return;
    const into = (v, size, view) => Math.round(size <= view ? Math.max(0, Math.min(view - size, v)) : Math.max(0, Math.min(view - 40, v)));
    w.x = into(w.x, w.w, UI_W); w.y = into(w.y, w.h, UI_H);
  }
  close(w) {
    // a window may ask first (Key Setting's "Save changes?"); it closes once that is answered
    if (w.confirmClose && !w.closeOk && this.order.includes(w)) {
      if (w.asking) return;
      w.asking = true;
      w.confirmClose().then(() => { w.asking = false; w.closeOk = true; this.close(w); w.closeOk = false; });
      return;
    }
    const i = this.order.indexOf(w);
    // closing (its X, the game) makes no sound of its own: only a hotkey or menu closing it plays MenuDown
    if (i >= 0) { this.order.splice(i, 1); if (w.closeSound) sfx.play(w.closeSound); this.tip = null; w.onClose?.(); }
  }
  toggle(name, arg) {
    const w = this.wins[name];
    if (!w) return;
    if (this.isOpen(name) && !w.wantsArg?.(arg)) { if (w.closeSound === undefined) sfx.play('UI/MenuDown'); this.close(w); return; }
    this.open(name, 'UI/MenuUp');
    w.setArg?.(arg);
  }
  /** Esc: the window opened last goes, with MenuUp. False when there is none to close. */
  closeTop() {
    let top = null;
    for (const w of this.order) {
      if (w.modal || w.keepOnEscape || w === this.wins.minimap || w === this.wins.questalarm) continue;
      if (!top || (w.openedSeq || 0) > (top.openedSeq || 0)) top = w;
    }
    if (!top) return false;
    sfx.play('UI/MenuUp');
    this.close(top);
    return true;
  }
  /** A transient window (dialog, shop) on top of everything. */
  show(w, sound = 'UI/DlgNotice') { this.fit(w); this.order.push(w); w.openedSeq = this.openSeq = (this.openSeq || 0) + 1; if (sound) sfx.play(sound); return w; }
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
  /** UIWindow.img/ItemProtector/Icon/0: the lock on a sealed item's icon, hung from its bottom-right corner like the coin. */
  drawLockMark(ctx, it, x, y) {
    const n = it?.flag & 1 && this.W.ItemProtector?.Icon?.[0], im = n && this.image(n);
    if (!im) return;
    const o = n.origin || [im.width, im.height];
    ctx.drawImage(im, x + 32 - o[0], y + 32 - o[1]);
  }
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

  /** Anything picked up makes the drag sound; an item put down in a window, the drop sound (not a key binding). */
  startCarry(payload, node) { this.carry = { ...payload, node }; sfx.play('UI/DragStart'); }
  /**
   * Put down what is being carried at (x, y): on the window there, on the quick slots, or outside
   * (the source decides - an item is dropped on the field). Returns whether a window took the event.
   */
  placeCarry(x, y) {
    const c = this.carry, w = this.top(x, y);
    this.carry = null;
    if (w) {
      w.drop?.(x - w.x, y - w.y, c);
      // an item put down in the inventory or on the equipment window makes the drop sound
      if (c.kind === 'item' && (w === this.wins.inventory || w === this.wins.equip)) sfx.play('UI/DragEnd');
    }
    else if (this.bar.contains?.(x, y)) this.bar.dropOnQuickSlot?.(x, y, c);
    else c.source?.dropOutside?.(c, x, y);
    return !!w;
  }

  // ---------------------------------------------------------------- input (canvas coordinates)
  pointer(type, x, y, dy = 0) {
    this.mouse = { x, y };
    if (this.drag) {
      const d = this.drag;
      d.win.x = Math.round(Math.max(-d.win.w + 40, Math.min(UI_W - 40, x - d.dx)));
      d.win.y = Math.round(Math.max(Math.min(0, UI_H - d.win.h), Math.min(UI_H - 40, y - d.dy)));   // a window taller than the screen goes up to its bottom
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
      if (over && over !== this.hovered && over.enabled && !over.down) sfx.play('UI/BtMouseOver');   // not a disabled or held one
    }
    this.hovered = over;
    // the wheel slides rows under a still cursor: keep the tooltip down until the mouse itself moves,
    // or it would pop from item to item (a flicker) as the list scrolls
    if (type === 'wheel') this.tipHeld = true;
    else if (type === 'move' && (x !== this.tipAt?.x || y !== this.tipAt?.y)) this.tipHeld = false;
    this.tipAt = { x, y };
    this.tip = this.carry || this.tipHeld ? null : w ? (over ? over.tip?.() ?? null : w.tooltip?.(x - w.x, y - w.y)) : this.bar?.quickTip?.(x, y) ?? this.game?.kiteTip?.(x, y) ?? null;
    if (w) w.move?.(x - w.x, y - w.y);

    if (type === 'down') {
      // menus close on any click outside them
      for (const o of [...this.order]) if (o.transient && o !== w) this.close(o);
      // anything held by a click goes where the next click is (a quick second click on it is a double-click)
      const held = this.carry?.sticky ? this.carry : null, quick = held && performance.now() - held.at < 350 && Math.abs(held.x - x) < this.slop && Math.abs(held.y - y) < this.slop;
      if (held && !quick) { this.lastDown = null; if (!modal || w === modal) this.placeCarry(x, y); return true; }
      if (!w) return !!modal;
      this.raise(w);
      const lx = x - w.x, ly = y - w.y;
      for (const b of w.buttons) b.down = b === over;
      // pulled up past the top, a window is dragged by the top of what is still on screen
      if (!over && ly - Math.max(0, -w.y) < (w.dragH ?? 20) && !w.fixed) { this.drag = { win: w, dx: lx, dy: ly }; return true; }
      const now = performance.now(), last = this.lastDown;
      this.lastDown = { w, x, y, t: now };
      if (last && last.w === w && now - last.t < 350 && Math.abs(last.x - x) < this.slop && Math.abs(last.y - y) < this.slop) {
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
        // released where it was picked up: a click, not a drag - keep holding it until the next click
        if (Math.abs(c.x - x) < this.slop && Math.abs(c.y - y) < this.slop) { c.sticky = true; return true; }
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

  update(dt) { for (const w of this.order) { for (const b of w.buttons) b.update(dt * 1000); w.tick?.(dt * 1000); } }

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
    // text boxes sit over the canvas: under a question box they hide, let clicks through and let go of the keyboard
    const modal = this.modal, top = modal ? this.order.indexOf(modal) : -1;
    this.order.forEach((w, i) => {
      const covered = i < top;
      for (const f of w.textFields?.() || []) {
        f.el.style.opacity = covered ? '0' : ''; f.el.style.pointerEvents = covered ? 'none' : '';
        if (covered && document.activeElement === f.el) f.el.blur();
      }
    });
    if (this.carry?.node) {
      ctx.globalAlpha = this.carry.alpha ?? 0.7; this.drawIcon(ctx, this.carry.node, this.mouse.x - 16, this.mouse.y - 16); ctx.globalAlpha = 1;
    }
    const ty = this.tip?.above ? { bottom: this.tip.above } : null;
    if (this.tip?.item) this.drawItemTip?.(ctx, this, this.tip.item, this.mouse.x + 14, ty ?? this.mouse.y + 18);
    else if (this.tip?.skill) this.drawSkillTip?.(ctx, this, this.tip.skill, this.mouse.x, ty ?? this.mouse.y + 20);
    else if (this.tip?.draw) this.tip.draw(ctx, this.mouse.x + 14, this.mouse.y + 18);   // a tooltip that draws itself
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
  /** The window's text boxes (page elements over the canvas): its `field` and `fields`. */
  textFields() { return [this.field, ...(Array.isArray(this.fields) ? this.fields : [])].filter((f) => f?.el); }
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

  /** A Basic.img/VScr scrollbar (or another VScr style, V) at (x, y) of height h; returns the new first row on click. */
  scrollbar(ctx, x, y, h, first, rows, visible, V = this.mgr.B.VScr) {
    const on = rows > visible, S = on ? V.enabled : V.disabled, { w, a, t } = scrollSizes(V);
    const im = (n) => this.mgr.image(n);
    const base = im(S.base);
    if (base) ctx.drawImage(base, x, y + a, w, h - 2 * a);
    const prev = im(on ? S.prev0 : S.prev), next = im(on ? S.next0 : S.next);
    if (prev) ctx.drawImage(prev, x, y);
    if (next) ctx.drawImage(next, x, y + h - a);
    if (on) {
      const track = h - 2 * a - t, p = Math.round(track * first / Math.max(1, rows - visible));
      const thumb = im(S.thumb0);
      if (thumb) ctx.drawImage(thumb, x, y + a + p);
    }
  }
  scrollClick(lx, ly, x, y, h, first, rows, visible, V = this.mgr.B.VScr) {
    const { w, a, t } = scrollSizes(V);
    if (lx < x || lx >= x + w || ly < y || ly >= y + h) return null;
    const max = Math.max(0, rows - visible);
    if (ly < y + a) return Math.max(0, first - 1);
    if (ly >= y + h - a) return Math.min(max, first + 1);
    return Math.max(0, Math.min(max, Math.round(((ly - y - a - t / 2) / (h - 2 * a - t)) * max)));
  }
}
/** A VScr style's width, arrow height and thumb height. */
const scrollSizes = (V) => ({ w: V?.enabled?.prev0?._w || 12, a: V?.enabled?.prev0?._h || 12, t: V?.enabled?.thumb0?._h || 12 });

// ==================================================================== Item inventory
/**
 * Item.img backgrnd 175x289 (small) or FullBackgrnd 603x289 (full, every slot at once): tab strip at y 23, slots 32x32
 * every 36px across from x 8 and every 34px down from y 50 (full: four blocks of 4 x 6, each 149px on), mesos box
 * with BtCoin at its left. BtFull / BtSmall switch between them; the choice is kept per character.
 */
const FULL_W = 603, SMALL_W = 175;
/** BtCashshop's Cash Shop item, by tab: the slot expansion for Equip, Use and Etc. */
const SLOT_ITEM_SN = { 1: 50200093, 2: 50200094, 4: 50200095 };
class InventoryWin extends Win {
  constructor(mgr) {
    const W = mgr.W.Item;
    super(mgr, W.backgrnd, 600, 90);
    this.W = W; this.tab = 2; this.first = 0; this.full = false;
    this.button(W.BtCoin, 7, 266, () => this.dropMesos());
    // buttons sit by their top-left corner; each tab shows Gather until it has been gathered, then Sort until sorted
    const at = (n, x, y) => [x + (n?.normal?.[0]?.origin?.[0] || 0), y + (n?.normal?.[0]?.origin?.[1] || 0)];
    this.place = (b, n, x, y) => { [b.x, b.y] = at(n, x, y); };
    this.sortModes = [0, 0, 0, 0, 0, 0];
    this.gatherBtn = this.button(W.BtGather, 0, 0, () => this.g.gatherItems(this.tab));
    this.sortBtn = this.button(W.BtSort, 0, 0, () => this.g.sortItems(this.tab));
    this.fullBtn = this.button(W.BtFull, 0, 0, () => this.setFull(true));
    this.smallBtn = this.button(W.BtSmall, 0, 0, () => this.setFull(false));
    this.shopBtn = this.button(W.BtCashshop, 0, 0, () => this.toCashShop());
    this.gatherBtn.tip = () => lineTip('Slot Merger'); this.sortBtn.tip = () => lineTip('Item Sort');
    this.fullBtn.tip = () => lineTip('Expand Inventory'); this.smallBtn.tip = () => lineTip('Collapse Inventory');
    this.shopBtn.tip = () => lineTip('You can expand the Inventory slot with cash items.');
    this.newT = 0;
    this.layout();
  }
  onOpen() {
    let full = false;
    try { full = localStorage.getItem(`inventoryExpanded:${this.g.stats?.name}`) === '1'; } catch { /* storage blocked */ }
    if (full !== this.full) { this.full = full; this.layout(); }
  }
  tick(ms) { this.newT += ms; }
  /** The window shuts: the new-item mark goes with it. */
  onClose() { this.g.newItem = null; }
  setFull(full) {
    this.full = full;
    try { localStorage.setItem(`inventoryExpanded:${this.g.stats?.name}`, full ? '1' : '0'); } catch { /* storage blocked */ }
    this.layout();
    this.mgr.fit(this);
  }
  layout() {
    const W = this.W, full = this.full, right = full ? 583 : 155;
    this.bg = full ? W.FullBackgrnd : W.backgrnd; this.w = full ? FULL_W : SMALL_W; this.h = 289;
    if (full) this.first = 0;
    this.place(this.fullBtn, W.BtFull, right - 30, 6); this.place(this.smallBtn, W.BtSmall, right - 30, 6);
    this.place(this.gatherBtn, W.BtGather, right - 15, 6); this.place(this.sortBtn, W.BtSort, right - 15, 6);
    this.place(this.shopBtn, W.BtCashshop, 495, 266);
    this.fullBtn.visible = !full; this.smallBtn.visible = full; this.shopBtn.visible = full;
    this.showSortButton();
  }
  /** GATHER_ITEM_RESULT (mode 1: Sort next) / SORT_ITEM_RESULT (mode 0: Gather next) for an inventory. */
  setSortMode(inv, mode) { this.sortModes[inv] = mode; this.showSortButton(); }
  showSortButton() {
    const sort = this.sortModes[this.tab] === 1;
    this.gatherBtn.visible = !sort; this.sortBtn.visible = sort;
  }
  /** BtCashshop: off for Set-up and Cash, and once a tab has its 96 slots; takes you to the tab's slot expansion. */
  toCashShop() {
    this.g.csPreselect = SLOT_ITEM_SN[this.tab] || 0;
    this.g.enterCashShop();
  }
  /** The coin button: drop 10 ~ 50,000 mesos on the ground (Cosmic's MesoDropHandler range). */
  async dropMesos() {
    if (this.g.dead) { this.g.notice("You can't do it once you're dead."); return; }
    const max = Math.min(50000, this.g.meso || 0);
    if (max < 10) { this.g.notice('You need at least 10 mesos to drop.'); return; }
    const v = await this.mgr.askNumber(`How many mesos will you drop?\n(10 ~ ${max.toLocaleString('en-US')})`, 10, 10, max);
    if (v) this.g.net?.dropMeso(v);
  }
  frames() {
    const W = this.W;
    return [...super.frames(), W.FullBackgrnd, W.activeIcon, W.disabled, ...allCanvases(W.Tab.enabled), ...allCanvases(W.Tab.disabled), ...allCanvases(W.New)].filter(isCanvas);
  }
  wantsArg(tab) { return tab !== undefined && tab !== this.tab; }
  setArg(tab) { if (tab !== undefined && tab !== this.tab) this.setTab(tab); }
  setTab(tab) { this.tab = tab; this.first = 0; this.showSortButton(); }
  get limit() { return this.g.inventory?.limits?.[this.tab] || 24; }
  get rows() { return Math.ceil(this.limit / 4); }
  /** A slot's 32x32 cell (top-left), or null when it isn't on show. */
  cell(slot) {
    let i = slot - 1 - this.first * 4;
    if (i < 0 || (!this.full && (i >= 24 || slot > this.limit)) || (this.full && i >= 96)) return null;
    let row = Math.floor(i / 4), col = i % 4, x = 0;
    if (this.full && row > 5) { const b = Math.floor(row / 6); row %= 6; col += 4 * b; x = 5 * b; }
    return { x: x + 36 * col + 8, y: 50 + 34 * row };
  }
  /** The slot under (lx, ly); in the full view also the locked cells past the tab's size (empty). */
  slotAt(lx, ly) {
    const last = this.full ? 96 : Math.min(this.first * 4 + 24, this.limit);
    for (let s = this.first * 4 + 1; s <= last; s++) {
      const c = this.cell(s);
      if (c && lx >= c.x && lx < c.x + 32 && ly >= c.y && ly < c.y + 32) return s;
    }
    return 0;
  }
  body(ctx) {
    const g = this.g, inv = g.inventory, m = this.mgr;
    this.shopBtn.enabled = [1, 2, 4].includes(this.tab) && this.limit < 96;
    this.tabRects = drawTabStrip(ctx, m, this.W.Tab, 5, this.tab - 1, 170);
    const items = inv?.[this.tab] || {};
    for (let slot = 1; slot <= (this.full ? 96 : this.limit); slot++) {
      const c = this.cell(slot);
      if (!c) continue;
      if (slot > this.limit) { const d = m.image(this.W.disabled); if (d) ctx.drawImage(d, c.x, c.y); continue; }
      const it = items[slot];
      if (!it || (m.carry?.slot === slot && m.carry.tab === this.tab)) continue;
      m.drawIcon(ctx, m.icon(it.id), c.x, c.y, it.id);
      m.drawLockMark(ctx, it, c.x, c.y);
      // Use, Set-up and Etc items show their count even at 1; Cash ones only when stacked
      if (this.tab !== 1 && (it.quantity > 1 || (this.tab !== 5 && it.quantity >= 1))) m.count(ctx, it.quantity, c.x, c.y + 20);
    }
    // the star, arrow or bullet the next shot throws
    const ammo = this.tab === 2 && g.ammoSlot?.(), ac = ammo && this.cell(ammo), active = ac && m.image(this.W.activeIcon);
    if (active) ctx.drawImage(active, ac.x - 2, ac.y - 2);
    if (!this.full) this.scrollbar(ctx, 156, 51, 201, this.first, this.rows, 6);
    this.text(ctx, (g.meso || 0).toLocaleString('en-US'), 135, 268, { align: 'right' });
    this.drawNew(ctx);
  }
  /**
   * The item last gained: its tab flashes (New/Tab1 over the open tab, New/Tab0 over another, with the tab's label kept
   * on top) and its slot blinks (New/inventory) while that tab is open.
   */
  drawNew(ctx) {
    const n = this.g.newItem, m = this.mgr;
    if (!n) return;
    const t = Math.floor(n.id / 1000000), selected = t === this.tab, c = selected ? this.cell(n.pos) : null;
    // the slot it was in no longer holds it
    if (c && this.g.inventory?.[t]?.[n.pos]?.id !== n.id) { this.g.newItem = null; return; }
    const frame = (node) => { const fs = Object.keys(node || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b); return fs.length ? node[fs[Math.floor(this.newT / 100) % fs.length]] : null; };
    const flash = m.image(frame(this.W.New?.[selected ? 'Tab1' : 'Tab0']));
    if (flash) ctx.drawImage(flash, 34 * t - 31, selected ? 23 : 24);
    const label = m.image(this.W.Tab.disabled?.[t - 1]);
    if (label) ctx.drawImage(label, 34 * t - 25, t === 1 || t === 3 ? 27 : 28);
    const mark = c && frame(this.W.New?.inventory), mi = mark && m.image(mark);
    if (mi) ctx.drawImage(mi, c.x - 1 - (mark.origin?.[0] || 0), c.y - 1 - (mark.origin?.[1] || 0));
  }
  down(lx, ly) {
    const hit = tabAt(this.tabRects, lx, ly);
    if (hit >= 0) { if (this.tab !== hit + 1) { this.setTab(hit + 1); sfx.play('UI/Tab'); } return; }
    const s = this.full ? null : this.scrollClick(lx, ly, 156, 51, 201, this.first, this.rows, 6);
    if (s !== null) { this.first = s; return; }
    const slot = this.slotAt(lx, ly), it = slot && this.g.inventory?.[this.tab]?.[slot];
    if (it) this.mgr.startCarry({ kind: 'item', tab: this.tab, slot, id: it.id }, this.mgr.icon(it.id));
  }
  dblclick(lx, ly) {
    const slot = this.slotAt(lx, ly), it = slot && this.g.inventory?.[this.tab]?.[slot];
    if (it) this.g.useInventoryItem(this.tab, slot, it);
  }
  drop(lx, ly, c) {
    if (c.kind !== 'item') return;
    if (this.g.dead) { this.g.notice("You can't do it once you're dead."); return; }
    const to = this.slotAt(lx, ly) <= this.limit ? this.slotAt(lx, ly) : 0;
    if (c.tab === 2 && isScroll(c.id) && this.tab === 1 && to && this.g.inventory[1][to]) { this.g.useScroll(c.slot, to); return; }
    if (c.tab === this.tab && to && to !== c.slot) this.g.net?.moveItem(this.tab, c.slot, to, this.g.inventory[this.tab][c.slot]?.quantity || 1);
    else if (c.tab === 'equip' && this.tab === 1) this.g.unequip(c.slot);
  }
  /** Dragged onto the field: drop it (ITEM_MOVE to slot 0), asking how many of a stack. */
  async dropOutside(c) {
    if (c.kind !== 'item' || typeof c.tab !== 'number') return;
    const it = this.g.inventory?.[c.tab]?.[c.slot];
    if (!it || this.g.dead) return;
    if (it.flag & 1) { this.mgr.notice('Sealed items cannot be\r\nsold, traded, or dropped.'); return; }   // sealed by an Item Guard
    // ring boxes, the Officiator's Permission and the Admin's Candle stay; an engagement ring asks, then breaks it off
    if (Math.floor(it.id / 10000) === 224 || it.id === 4031374 || it.id === 3994085) return;
    if (it.id >= 4031357 && it.id <= 4031364) {
      const married = this.g.rings?.marriage?.status === 3;
      if (await this.mgr.confirm(married ? 'You will not be able to receive the wedding ring.\r\nIs that okay?'
        : 'Dropping this item will break your engagement.\r\nDo you still wish to drop this item?')) this.g.net?.breakEngagement(it.id);
      return;
    }
    let qty = 1;
    // throwing stars and bullets always go as a whole stack (the server drops them that way)
    if (c.tab !== 1 && it.quantity > 1 && ![207, 233].includes(Math.floor(it.id / 10000))) {
      qty = await this.mgr.askNumber(`How many will you drop?\n(1 ~ ${it.quantity})`, it.quantity, 1, it.quantity);
      if (!qty) return;
    }
    if (this.g.inventory?.[c.tab]?.[c.slot] === it) this.g.net?.moveItem(c.tab, c.slot, 0, qty);
  }
  wheel(dy) { if (!this.full) this.first = Math.max(0, Math.min(this.rows - 6, this.first + Math.sign(dy))); }
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
      m.drawLockMark(ctx, it, x, y);
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
    if (c.tab === 5 && Math.floor(c.id / 10000) === 550) { if (typeof slot === 'number' && slot < 0) this.g.useSandglass(c.slot, c.id, slot); return; }   // a Magical Sandglass onto what you wear
    if (c.tab === 5 && c.id === 5060000) { if (typeof slot === 'number' && slot < 0) this.g.useItemTag(c.slot, slot); return; }   // an Item Tag onto what you wear
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
    this.W = W; this.detail = false; this.panelX = 0;
    mgr.assets.json('String/ToolTipHelp.img').then((t) => { this.help = t?.Game?.UIWnd; });
    this.ap = Object.entries(AP_ROWS).map(([k, y]) => Object.assign(this.button(W.BtApUp, 153, y, () => this.raise(k)), { stat: k }));
    this.auto = [this.button(W.BtAuto, 97, 197, () => this.autoAssign(1)), this.button(W.BtAuto1, 97, 197, () => this.autoAssign(1)), this.button(W.BtAuto2, 97, 217, () => this.autoAssign(0))];
    this.button(W.BtDetail, 121, 324, () => { this.detail = !this.detail; });
    this.hideBtn = this.button(mgr.B.BtHide, DETAIL_X + 155, DETAIL_Y + 182, () => { this.detail = !this.detail; });
  }
  /** The detail panel slides out from behind the window, or back, 1px a ms; reopened, it is where it was left. */
  tick(ms) {
    const to = this.detail ? DETAIL_X : 0;
    this.panelX = to > this.panelX ? Math.min(to, this.panelX + ms) : Math.max(to, this.panelX - ms);
  }
  onClose() { this.panelX = this.detail ? DETAIL_X : 0; }
  get panelShown() { return this.detail || this.panelX > 0; }
  frames() { return [...super.frames(), this.W.backgrnd2, this.W.basicStat, ...allCanvases(this.W.Job), ...allCanvases(this.W.Disabled)]; }
  contains(x, y) {
    const lx = x - this.x, ly = y - this.y;
    return super.contains(x, y) || (this.panelShown && lx >= this.panelX && lx < this.panelX + 177 && ly >= DETAIL_Y && ly < DETAIL_Y + 203);
  }
  draw(ctx) {
    // the detail panel goes behind the main one, its BtHide with it
    const shown = this.panelShown, hide = this.hideBtn;
    hide.x = this.panelX + 155;
    hide.visible = false;
    if (shown) {
      ctx.save(); ctx.translate(this.x, this.y);
      const bg2 = this.mgr.image(this.W.backgrnd2);
      if (bg2) ctx.drawImage(bg2, this.panelX, DETAIL_Y);
      if (this.g.stats) this.drawDetail(ctx);
      hide.visible = true; hide.draw(ctx, this.mgr.assets); hide.visible = false;
      ctx.restore();
    }
    super.draw(ctx);
    // clickable only where the main panel doesn't cover it
    hide.visible = shown && hide.rect().x >= this.w;
  }
  /** ToolTipHelp's Stat (main panel) and StatDetail (detail panel) rects; the EXP row shows its figures. */
  tooltip(lx, ly) {
    const s = this.g.stats;
    if (!s) return null;
    const pick = (list, x, y, n = Infinity) => {
      const keys = Object.keys(list || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).slice(0, n);
      for (const k of keys) {
        const e = list[k], [l, t] = e.lt || [], [r, b] = e.rb || [];
        if (x >= l && x < r && y >= t && y < b) return e.Title || e.Desc ? helpTip(e.Title || '', e.Desc || '') : null;
      }
      return null;
    };
    if (super.contains(this.x + lx, this.y + ly)) {
      if (lx > 61 && lx < 172 && ly > 140 && ly < 155) return lineTip(`EXP : ${s.exp} / ${EXP[s.level] || 0}`, 6, 2);
      return pick(this.help?.Stat, lx, ly, isStarter(s.job) && s.level <= 10 ? 8 : Infinity);
    }
    return this.panelShown ? pick(this.help?.StatDetail, lx - this.panelX, ly - DETAIL_Y) : null;
  }
  /** Arial 12 with its font cell's top at y. */
  t(ctx, text, x, y, o = {}) { this.text(ctx, text, x, y + 11, { size: 12, base: 'alphabetic', ...o }); }
  body(ctx) {
    const g = this.g, s = g.stats;
    if (!s) return;
    const starter = isStarter(s.job) && s.level <= 10, gm = Math.floor((s.job % 1000) / 100) === 9;
    for (const b of this.ap) { b.visible = !starter; b.enabled = s.ap > 0 && (s.level >= 20 || (b.stat !== 'hp' && b.stat !== 'mp')); }
    this.auto.forEach((b, i) => { b.visible = !starter && !gm && (s.job === 500 ? i > 0 : i === 0); b.enabled = s.ap > 0; });
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
    const g = this.g, d = g.statWindow(), x = this.panelX + 77, y = (i) => DETAIL_Y + 8 + 18 * i;
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
    if (!s?.ap || g.apPending || g.forcedRefusal('stats')) return;
    if (k === 'hp' || k === 'mp') { if (s.level < 20 || !(await this.mgr.okCancel(HPMP_ASK))) return; }
    g.sendStatRequest(() => g.net?.distributeAp(AP[k]));
  }
  async autoAssign(flag) {
    const g = this.g, s = g.stats, targets = s && autoTargets(s.job, s.level, flag);
    if (!targets || !s.ap || g.apPending || g.forcedRefusal('stats')) return;
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
 * Skill.img backgrnd 175x289: tab strip y 22-40 (Tab ● I II III IV), the book's icon at (10, 57) and its
 * name (Tahoma 11 white) centred on x 105 at y 66. Four rows every 40px from y 99: skill1 (requirements met)
 * or skill0 at x 7, icon at (9, y + 2), name and level (Arial 12) at (47, y + 1) / (47, y + 19), BtSpUp at
 * (131, y + 20), a line under each row but the last. VScr4 scrollbar at (153, 99), SP right-aligned at x 110.
 */
const SKILL_ROW_Y = 99, SKILL_ROW_H = 40;
/** Text lands 2px under its v83 coordinate when drawn from a canvas 'top' baseline. */
const SKILL_TEXT_DY = 2;
const SKILL_BAR = [153, 99, 156];
/** Skills a double-click doesn't cast: the ones held down, and Aran's combo / hidden skills. */
const NO_DBLCLICK = new Set([1121001, 1221001, 1321001, 2121001, 2221001, 2321001, 3121004, 3221001, 5101004, 5201002, 5221004,
  13111002, 14111006, 15101003, 22121000, 22151001, 20000014, 20000015, 20000016, 21000002, 21100001, 21100002, 21100004,
  21100005, 21110003, 21110004, 21110006, 21110007, 21110008, 21120005, 21120006, 21120007, 21120009, 21120010]);
const SP_SHORT = ["You're lacking Level 1 Skills.", "You're lacking Level 1 or 2 Skills.", 'You are lacking in either 1st, 2nd, or 3rd level skills.'];
/** Text cut to `w` px with "..", in the context's current font. */
export function cutText(ctx, s, w) {
  if (ctx.measureText(s).width <= w) return s;
  while (s && ctx.measureText(`${s}..`).width > w) s = s.slice(0, -1);
  return `${s}..`;
}
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
    this.W = W; this.first = 0;
    this.spUp = [0, 1, 2, 3].map((i) => this.button(W.BtSpUp, 131, SKILL_ROW_Y + i * SKILL_ROW_H + 20, () => this.raise(i)));
    mgr.assets.json('Etc/RecommendSkill.img').then((r) => { this.recommendData = r || {}; }, () => { this.recommendData = {}; });
    this.skillW = this.w; this.closePinned = true; this.closeBtn.x = this.skillW - 17;
    this.M = mgr.W.SkillMacro; this.mSel = -1; this.mFirst = 0;
    this.button(mgr.B.BtMacro, 120, 265, () => this.toggleMacro());
    this.mSave = this.button(mgr.B.BtOK2, this.skillW + 154, 265, () => this.saveMacros());
    this.mCancel = this.button(mgr.B.BtCancel2, this.skillW + 103, 265, () => { this.draft = null; this.toggleMacro(false); });
    this.toggleMacro(false);
  }
  frames() {
    const M = this.M;
    return [...super.frames(), this.W.skill0, this.W.skill1, this.W.line, this.W.recommend?.[0], ...allCanvases(this.mgr.B.VScr4),
      ...allCanvases(this.W.Tab.enabled), ...allCanvases(this.W.Tab.disabled),
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
    if (f) { f.rect.x = this.x + X + 59; f.rect.y = this.y + 215; f.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W); }
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
    // the beginner book: a point a level up to 7, less what every beginner's Three Snails / Recovery / Nimble Feet hold
    if (b % 1000 === 0 || b === 2001) {
      let used = 0;
      for (const base of [0, 1000, 2000, 2001]) for (let i = 0; i < 3; i++) used += g.skills.level(base * 10000 + 1000 + i);
      return Math.max(0, Math.min(g.stats.level, 7) - 1 - used);
    }
    return g.stats.sp || 0;
  }
  canRaise(id) {
    if (this.book === GM_TAB) return false;   // GM skills are granted, not bought with SP
    const sb = this.g.skills;
    return !sb.node(id)?.disable && this.sp > 0 && sb.raiseState(id) === 'ok';
  }
  /**
   * A + click: one request at a time; past the first job, the SP already in that job step's skills must be
   * under 3 x level - 89 (2nd), 3 x level - 209 (3rd) or 3 x (level - 119) (4th).
   */
  raise(i) {
    const g = this.g, sb = g.skills, id = this.list[this.first + i];
    if (!id || !this.canRaise(id)) return;
    const book = Math.floor(id / 10000), step = book % 10, L = g.stats.level;
    if (book % 100 !== 0 && book !== 2001 && step <= 2) {
      let spent = 0;
      for (const [k, s] of Object.entries(sb.levels)) {
        const kb = Math.floor(k / 10000);
        if (kb % 10 === step && (step !== 0 || kb % 100 !== 0)) spent += s.level || 0;
      }
      if (spent >= [3 * L - 89, 3 * L - 209, 3 * (L - 119)][step]) { this.mgr.notice(SP_SHORT[step]); return; }
    }
    g.sendStatRequest(() => g.net?.distributeSp(id));
  }
  /** The row under (lx, ly), or with `icon` only over its icon; -1 for none. */
  rowAt(lx, ly, icon = false) {
    const i = Math.floor((ly - SKILL_ROW_Y) / SKILL_ROW_H), dy = ly - SKILL_ROW_Y - i * SKILL_ROW_H;
    if (i < 0 || i > 3) return -1;
    if (icon ? lx < 10 || lx >= 42 || dy < 3 || dy >= 35 : lx < 7 || lx >= 161 || dy >= 38) return -1;
    return this.first + i < this.list.length ? this.first + i : -1;
  }
  /** Etc/RecommendSkill.img: the book's skill for the SP spent in it (0 for none). */
  recommended(list) {
    const r = this.recommendData?.[this.book], sb = this.g.skills;
    if (!r) return 0;
    const spent = list.reduce((a, id) => a + sb.level(id), 0), ts = Object.keys(r).map(Number).sort((a, b) => a - b);
    const i = ts.findIndex((t) => t >= spent);
    if (i < 0) return 0;
    return Number(ts[i] === spent ? r[ts[i]] : i > 0 ? r[ts[i - 1]] : 0) || 0;
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
    if (bim) ctx.drawImage(bim, 10, 57);
    else if (bi) m.assets.preload([bi]);
    // the book's name centred on x 105, or from x 45 cut to 125px when it is 126px or wider
    ctx.save(); ctx.font = '11px Tahoma, Arial, "Segoe UI", sans-serif';
    const bn = this.book === GM_TAB ? 'GM' : sb.bookName(this.book), wide = ctx.measureText(bn).width >= 126;
    const bookName = wide ? cutText(ctx, bn, 125) : bn;
    ctx.restore();
    this.text(ctx, bookName, wide ? 45 : 105, 66 + SKILL_TEXT_DY, { color: '#fff', align: wide ? 'left' : 'center', size: 11, font: 'Tahoma' });
    const list = this.list, rec = this.recommended(list), R = this.W.recommend?.[0];
    this.first = Math.min(this.first, Math.max(0, list.length - 4));
    const mx = m.mouse.x - this.x, my = m.mouse.y - this.y, hover = m.top(m.mouse.x, m.mouse.y) === this ? this.rowAt(mx, my) : -1;
    ctx.save(); ctx.font = '12px Arial, "Segoe UI", sans-serif';
    for (let i = 0; i < 4; i++) {
      const id = list[this.first + i];
      this.spUp[i].visible = !!id;
      if (!id) continue;
      const y = SKILL_ROW_Y + i * SKILL_ROW_H, lv = sb.level(id), state = sb.raiseState(id), n = sb.node(id);
      const row = m.image(state === 'req' ? this.W.skill0 : this.W.skill1);
      if (row) ctx.drawImage(row, 7, y);
      if (id === rec && m.image(R)) ctx.drawImage(m.image(R), 43, y);
      const icon = state === 'req' ? n?.iconDisabled || sb.icon(id) : hover === this.first + i ? n?.iconMouseOver || sb.icon(id) : sb.icon(id);
      const im = m.image(icon);
      if (im) ctx.drawImage(im, 9, y + 2); else if (icon) m.assets.preload([icon]);
      this.text(ctx, cutText(ctx, sb.name(id), 104), 47, y + 1 + SKILL_TEXT_DY, { size: 12 });
      this.text(ctx, lv, 47, y + 19 + SKILL_TEXT_DY, { size: 12 });
      if (i < 3 && list[this.first + i + 1]) { const line = m.image(this.W.line); if (line) ctx.drawImage(line, 7, y + 37); }
      this.spUp[i].enabled = this.canRaise(id);
    }
    ctx.restore();
    this.scrollbar(ctx, ...SKILL_BAR, this.first, list.length, 4, m.B.VScr4);
    this.text(ctx, this.sp, 110, 265 + SKILL_TEXT_DY, { align: 'right', size: 12 });
  }
  down(lx, ly) {
    if (this.macroOpen && lx >= this.skillW) { this.macroDown(lx, ly); return; }
    const hit = tabAt(this.tabRects, lx, ly);
    if (hit >= 0) { if (this.book !== this.books[hit]) { this.book = this.books[hit]; this.first = 0; sfx.play('UI/Tab'); } return; }
    const s = this.scrollClick(lx, ly, ...SKILL_BAR, this.first, this.list.length, 4, this.mgr.B.VScr4);
    if (s !== null) { this.first = s; return; }
    const r = this.rowAt(lx, ly, true);
    if (r < 0) return;
    const id = this.list[r], sb = this.g.skills, kind = Math.floor(id / 1000) % 10;
    // a learned skill's icon goes onto a key, except the x0xxx passives and the x9xxx ones
    if (kind !== 0 && kind !== 9 && sb.level(id) > 0) this.mgr.startCarry({ kind: 'skill', id, alpha: 0.5 }, sb.icon(id));
  }
  dblclick(lx, ly) {
    if (this.macroOpen && lx >= this.skillW) return;
    const r = this.rowAt(lx, ly), id = r >= 0 ? this.list[r] : 0;
    if (id && this.g.skills.level(id) > 0 && !NO_DBLCLICK.has(id)) this.g.clickSkill(id);
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
  }
  rclick(lx, ly) { const hit = this.macroOpen && this.macroAt(lx, ly); if (hit && !hit.icon) this.draft[hit.row].skills[hit.slot] = 0; }
  tooltip(lx, ly) {
    if (this.macroOpen && lx >= this.skillW) return null;
    const r = this.rowAt(lx, ly);
    return r < 0 ? null : { skill: this.list[r] };
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
        if (!Number.isNaN(d.getTime())) return `Ended at ${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} at ${String(d.getUTCHours()).padStart(2, '0')}:00`;
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
      quest: (id) => this.g.quests?.name(id) ?? '', questState: (id) => QUEST_STATES[this.g.quests?.status(id) ?? 0],
      kills: (n) => this.g.quests?.killText(n) ?? '', record: (id) => this.g.quests?.recordText(id) ?? '',
      j: (key) => (this.sel ? this.g.quests?.jValue(this.sel, key, { fame: this.g.stats?.fame ?? 0, level: this.g.stats?.level ?? 0 }) : null),
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

  /**
   * Markers bottom-centre on their point, in this order: others' hired merchants, strangers, your merchant,
   * portals, friends / guild / party, NPCs, you.
   */
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
    // hired merchants first: others' now, your own after the players
    const mine = [];
    for (const hm of g.boards?.merchants?.values() || []) { if (hm.owner === me) mine.push(hm); else put(H.anothertrader, hm.x, hm.y); }
    for (const o of g.others.values()) {
      const gm = guild?.members?.find((x) => x.name === o.name);
      const kind = spouse && o.id === spouse ? 'match'
        : party?.members?.some((x) => x.id === o.id) ? (party.leader === o.id ? 'partymaster' : 'party')
          : gm ? (gm.rank === 1 ? 'guildmaster' : 'guild')
            : buddies.has(o.id) ? 'friend' : null;
      if (kind) lists[kind].push(o); else put(H.another, o.x, o.y);
    }
    for (const hm of mine) put(H.usertrader, hm.x, hm.y);
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
 * KeyConfig backgrnd 629x373 (origin at its centre, so it opens centred). Each bindable key is a 32x32
 * box at its spot below, holding the bound icon, with the key's KeyConfig/key label at +4,+4 (Shift +2,
 * Space +0) on top. The reserved pink keys (Esc, Tab, Screen Shot), '/' and the unlabelled keys cannot be
 * bound. The right Shift, Ctrl and Alt (54, 89, 90) show and take their left key's binding.
 * The palette below is 3 rows of 18 cells at (9 + 34c, 267 + 34r); each function keeps its own cell
 * (menus 0-27, then actions 50-54, then faces 100-106), empty while the function is on a key.
 */
const KEYCAPS = {
  59: [82, 27], 60: [116, 27], 61: [150, 27], 62: [184, 27], 63: [226, 27], 64: [260, 27], 65: [294, 27], 66: [328, 27],
  67: [370, 27], 68: [404, 27], 87: [438, 27], 88: [472, 27],
  41: [14, 66], 2: [48, 66], 3: [82, 66], 4: [116, 66], 5: [150, 66], 6: [184, 66], 7: [218, 66], 8: [252, 66], 9: [286, 66],
  10: [320, 66], 11: [354, 66], 12: [388, 66], 13: [422, 66], 82: [514, 66], 71: [548, 66], 73: [582, 66],
  16: [64, 99], 17: [98, 99], 18: [132, 99], 19: [166, 99], 20: [200, 99], 21: [234, 99], 22: [268, 99], 23: [302, 99],
  24: [336, 99], 25: [370, 99], 26: [404, 99], 27: [438, 99], 43: [472, 99], 83: [514, 99], 79: [548, 99], 81: [582, 99],
  30: [81, 132], 31: [115, 132], 32: [149, 132], 33: [183, 132], 34: [217, 132], 35: [251, 132], 36: [285, 132], 37: [319, 132],
  38: [353, 132], 39: [387, 132], 40: [421, 132],
  42: [38, 165], 44: [98, 165], 45: [132, 165], 46: [166, 165], 47: [200, 165], 48: [234, 165], 49: [268, 165], 50: [302, 165],
  51: [336, 165], 52: [370, 165], 54: [457, 165],
  29: [22, 198], 56: [122, 198], 57: [233, 198], 90: [348, 198], 89: [461, 198],
};
const KEY_TWIN = { 54: 42, 89: 29, 90: 56 };
const keyOf = (sc) => KEY_TWIN[sc] ?? sc;
const PALETTE = { x: 9, y: 267, step: 34, cols: 18 };
const FUNCTIONS = [...Array.from({ length: 28 }, (_, i) => [4, i]), ...[50, 51, 52, 53, 54].map((a) => [5, a]), ...[100, 101, 102, 103, 104, 105, 106].map((a) => [6, a])];
const MACRO_TIP = 'Register the frequently-used skills for a quick access with a single button.';

/**
 * Key Setting's confirmations: the notice picture with KeyConfig's OK (160, 55) and Cancel (210, 55). Resetting to
 * the defaults (0) warns on OK, and leaving without saving (2) on Cancel when the quick slots were changed, that the
 * quick slots go with it.
 */
const QUICK_CANCEL_TIP = { title: "The changes you've made to the Quick Slot will also be canceled.", lines: [] };
class KeyConfigNotice extends Win {
  constructor(mgr, n, done, quickChanged = false) {
    const W = mgr.W.KeyConfig, bg = W.notice[n];
    super(mgr, bg, (UI_W - (bg?._w || 266)) >> 1, (UI_H - (bg?._h || 85)) >> 1);
    this.buttons = []; this.modal = true; this.done = done; this.closeSound = null;
    const ok = this.button(W.BtOK, 160, 55, () => this.finish(true));
    const cancel = this.button(W.BtCancel, 210, 55, () => this.finish(false));
    if (n === 0) ok.tip = () => QUICK_CANCEL_TIP;
    if (n === 2 && quickChanged) cancel.tip = () => QUICK_CANCEL_TIP;
  }
  finish(ok) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(ok); }
  key(e) { if (e.key === 'Enter') this.finish(true); else if (e.key === 'Escape') this.finish(false); }
}

/**
 * CHANGE QUICK SLOTS: KeyConfig/quickslotConfig/backgrnd (266x238), centred, with the quick slots' eight keys as
 * BtQuickSetting buttons from (65, 113), 35px apart, the second row at y 147. Each shows what its key is bound to
 * and its key's label (quickslotConfig/key/<scancode>) 2px in. Click a slot, or Tab to it, then press a key: one
 * without a label there is disabled, and one already on a slot is in use. Arrows move between the slots, or between
 * OK (157, 208) and CANCEL (210, 208); Tab switches between the slots and the buttons; Escape drops the selection,
 * then cancels; Enter is OK. A click in the window off the slots drops the selection.
 * Arrows beside the slots (itemSearch BtLeft / BtRight) switch to the second panel's set, kept in this browser; a key
 * can be on one slot of either set.
 */
const QS_NUMPAD = { Numpad1: 2, Numpad2: 3, Numpad3: 4, Numpad4: 5, Numpad5: 6, Numpad6: 7, Numpad7: 8, Numpad8: 9, Numpad9: 10, Numpad0: 11 };
const qsPos = (i) => [65 + (i % 4) * 35, i < 4 ? 113 : 147];
class QuickSlotConfigWin extends Win {
  constructor(mgr, sets, keymap, iconFor, done) {
    const Q = mgr.W.KeyConfig.quickslotConfig, bg = Q.backgrnd, A = mgr.W.itemSearch;
    super(mgr, bg, (UI_W - bg._w) >> 1, (UI_H - bg._h) >> 1);
    this.buttons = []; this.modal = true; this.closeSound = null;
    Object.assign(this, { Q, sets: sets.map((k) => [...k]), page: 0, keymap, iconFor, done });
    this.focus = -1; this.slot = 0; this.btn = 0;   // focus: -1 nothing, 0 a slot, 1 OK / CANCEL
    this.slots = this.quick.map((_, i) => this.button(Q.BtQuickSetting, ...qsPos(i), () => { this.focus = 0; this.slot = i; }));
    this.ok = this.button(mgr.W.KeyConfig.BtOK, 157, 208, () => this.finish(true));
    this.cancel = this.button(mgr.W.KeyConfig.BtCancel, 210, 208, () => this.finish(false));
    this.prev = this.button(A.BtLeft, 44, 139, () => { this.page = 0; });
    this.next = this.button(A.BtRight, 210, 139, () => { this.page = 1; });
  }
  /** The set on show: the server's (page 0) or the second panel's. */
  get quick() { return this.sets[this.page]; }
  frames() { return [...super.frames(), ...allCanvases(this.Q.key)]; }
  finish(ok) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(ok ? this.sets : null); }
  key(e) {
    if (e.key === 'Enter') this.finish(true);
    else if (this.focus !== -1) { this.focus = -1; this.slot = 0; this.btn = 0; }
    else this.finish(false);
  }
  keys(e) {
    const f = this.focus, i = this.slot;
    switch (e.code) {
      case 'Tab': if (f === 0) { this.focus = 1; this.btn = 0; } else { this.focus = 0; this.slot = 0; } return true;
      case 'ArrowLeft': if (f === 0 && i !== 0 && i !== 4) this.slot--; else if (f === 1) this.btn = 0; return true;
      case 'ArrowRight': if (f === 0 && i !== 3 && i !== 7) this.slot++; else if (f === 1) this.btn = 1; return true;
      case 'ArrowUp': if (f === 0 && i > 3) this.slot -= 4; return true;
      case 'ArrowDown': if (f === 0 && i < 4) this.slot += 4; return true;
    }
    if (f === 0 && !e.repeat) this.assign(QS_NUMPAD[e.code] ?? CODE_TO_SC[e.code]);
    return true;
  }
  assign(sc) {
    if (!sc || !this.Q.key?.[sc]) { this.mgr.notice('The key you just pressed is a key that has been disabled.'); return; }
    if (this.sets.some((k) => k.includes(sc))) { this.mgr.notice('This key is already being used.'); return; }
    this.quick[this.slot] = sc;
  }
  up() {
    const { x, y } = this.mgr.mouse, lx = x - this.x, ly = y - this.y;
    if (this.contains(x, y) && !(lx >= 65 && lx <= 202 && ly >= 113 && ly <= 177)) this.focus = -1;
  }
  body(ctx) {
    const m = this.mgr;
    // the chosen slot stays lit with the mouse on it
    this.slots.forEach((b, i) => { b.focused = this.focus === 0 && this.slot === i; b.forceState = b.focused ? 'keyFocused' : null; });
    this.ok.focused = this.focus === 1 && this.btn === 0; this.cancel.focused = this.focus === 1 && this.btn === 1;
    this.prev.enabled = this.page === 1; this.next.enabled = this.page === 0;
    this.text(ctx, `${this.page + 1}/2`, 237, 140, { color: '#fff', size: 11, align: 'center' });
    this.quick.forEach((sc, i) => {
      const [x, y] = qsPos(i), icon = this.iconFor(this.keymap?.[sc === 54 ? 42 : sc]);
      if (icon && m.image(icon)) m.drawIcon(ctx, icon, x, y); else if (icon) m.assets.preload([icon]);
      const label = m.image(this.Q.key?.[sc]);
      if (label) ctx.drawImage(label, x + 2, y + 2);
    });
  }
}

class KeyConfigWin extends Win {
  constructor(mgr) {
    const W = mgr.W.KeyConfig;
    super(mgr, W.backgrnd, (UI_W >> 1) - 314, (UI_H >> 1) - 186);
    this.buttons = [];
    this.W = W; this.draft = {}; this.picked = null; this.bindsKeys = true;
    // Keyboard / Controller / Touch tabs on the button strip; the controller and touch layouts stay in this browser
    this.tab = 'keyboard'; this.tabs = new ControlTabs(this); this.ctlDraft = cloneControls(mgr.game.controls);
    this.button(W.BtClose, 606, 7, () => mgr.close(this));
    this.button(W.BtOK, 8, 236, () => this.save());
    this.button(mgr.B.BtCancel2, 58, 236, () => this.discard());
    this.button(W.BtDefault, 112, 236, async () => {
      if (!(await this.ask(0))) return;
      if (this.tab !== 'keyboard') { this.tabs.reset(this.tab); return; }
      this.draft = (await import('../keymap.js')).defaultKeymap(); this.picked = null; this.setQuickKeys(DEFAULT_QUICKSLOTS, DEFAULT_QUICKSLOTS2);
    });
    this.button(W.BtDelete, 177, 236, async () => {   // the art reads CLEAR ALL
      if (!(await this.ask(1))) return;
      if (this.tab !== 'keyboard') { this.tabs.clear(this.tab); return; }
      this.draft = {}; this.picked = null;
    });
    // CHANGE QUICK SLOTS: its OK puts the keys on the quick slots at once; they are kept with this window's OK
    this.button(W.BtQuickSlot, 260, 236, () => {
      const w = new QuickSlotConfigWin(mgr, [this.g.quickKeys, this.g.quickKeys2], this.draft, (b) => this.iconFor(b), (sets) => { if (sets) this.setQuickKeys(...sets); });
      mgr.assets.preload(w.frames()).then(() => mgr.show(w));
    });
  }
  frames() { return [...super.frames(), ...allCanvases(this.W.icon), ...allCanvases(this.W.key)]; }
  onOpen() {
    this.draft = Object.fromEntries(Object.entries(this.g.keymap || {}).map(([k, v]) => [k, { ...v }])); this.picked = null;
    this.ctlDraft = cloneControls(this.g.controls); this.tabs.picked = null;
    this.g.touch?.suspend(true);
    this.quickBefore = [[...this.g.quickKeys], [...this.g.quickKeys2]];
  }
  /** Leaving without OK puts the quick slots back as well. */
  onClose() { this.g.touch?.suspend(false); if (this.quickChanged()) this.setQuickKeys(...this.quickBefore); }
  setQuickKeys(keys, keys2 = this.g.quickKeys2) { this.g.quickKeys = [...keys]; this.g.quickKeys2 = [...keys2]; this.mgr.bar.render(); }
  quickChanged() {
    const b = this.quickBefore, g = this.g;
    return !!b && (g.quickKeys.some((k, i) => k !== b[0][i]) || g.quickKeys2.some((k, i) => k !== b[1][i]));
  }

  /** KeyConfig/notice/<n> (0 reset, 1 delete all, 2 save changes) with OK / Cancel: true for OK. */
  ask(n) { return new Promise((r) => this.mgr.show(new KeyConfigNotice(this.mgr, n, r, this.quickChanged()))); }
  changed() {
    const before = this.g.keymap || {}, same = (a, b) => a?.type === b?.type && a?.action === b?.action;
    return this.quickChanged() || [...new Set([...Object.keys(before), ...Object.keys(this.draft)])].some((sc) => !same(before[sc], this.draft[sc]))
      || JSON.stringify(this.ctlDraft) !== JSON.stringify(this.g.controls);
  }
  /** Closed another way than OK / Cancel with changes made: "Save changes?" (OK saves); it closes either way. */
  async confirmClose() { if (this.changed() && await this.ask(2)) this.apply(); }
  discard() { this.closeOk = true; this.mgr.close(this); this.closeOk = false; }
  save() { this.apply(); this.discard(); }
  apply() {
    const g = this.g, before = g.keymap || {}, changes = [];
    for (const sc of new Set([...Object.keys(before), ...Object.keys(this.draft)])) {
      const a = before[sc], b = this.draft[sc];
      if (a?.type === b?.type && a?.action === b?.action) continue;
      changes.push({ key: Number(sc), type: b?.type || 0, action: b?.action || 0 });
    }
    if (changes.length) g.net?.changeKeymap(changes);
    g.net?.changeQuickslots(g.quickKeys);
    if (g.stats?.name) saveQuickKeys2(g.stats.name, g.quickKeys2);
    this.quickBefore = [[...g.quickKeys], [...g.quickKeys2]];
    g.keymap = { ...this.draft };
    this.mgr.bar.render();
    g.controls = cloneControls(this.ctlDraft);
    saveControls(g.controls);
    g.touch?.render();
  }

  /** The picture for a binding: function icon, skill icon or item icon. */
  iconFor(b) { return this.g.bindingIcon(b); }
  /** The palette cell's function, or null when the cell is empty or that function is on a key. */
  paletteFn(i) {
    const f = FUNCTIONS[i];
    if (!f || !this.W.icon[f[1]]) return null;
    const used = this.tab === 'keyboard' ? Object.values(this.draft) : this.tabs.bound(this.tab);
    return used.some((b) => b.type === f[0] && b.action === f[1]) ? null : f;
  }
  capAt(lx, ly) {
    for (const [sc, [x, y]] of Object.entries(KEYCAPS)) if (lx >= x && lx < x + 32 && ly >= y && ly < y + 32) return keyOf(Number(sc));
    return null;
  }
  paletteAt(lx, ly) {
    const c = Math.floor((lx - PALETTE.x) / PALETTE.step), r = Math.floor((ly - PALETTE.y) / PALETTE.step);
    if (c < 0 || c >= PALETTE.cols || r < 0 || r >= 3 || (lx - PALETTE.x) % PALETTE.step >= 32 || (ly - PALETTE.y) % PALETTE.step >= 32) return -1;
    return r * PALETTE.cols + c;
  }
  body(ctx) {
    const m = this.mgr;
    this.tabs.drawTabs(ctx, this.tab);
    if (this.tab !== 'keyboard') { this.tabs.draw(ctx, this.tab); this.drawPalette(ctx); return; }
    for (const [s, [x, y]] of Object.entries(KEYCAPS)) {
      const sc = keyOf(Number(s)), b = this.draft[sc];
      if (b && m.carry?.fromSc !== sc) {
        const icon = this.iconFor(b);
        if (icon && m.image(icon)) m.drawIcon(ctx, icon, x, y); else if (icon) m.assets.preload([icon]);
        if (b.type === 2) m.count(ctx, this.g.itemCount?.(b.action) || 0, x, y + 20);
      }
      // the key's own label stays readable on top of what is bound to it
      const label = m.image(this.W.key?.[sc]);
      if (label) ctx.drawImage(label, x + (sc === 42 ? 2 : sc === 57 ? 0 : 4), y + 4);
      if (this.picked === sc) { ctx.strokeStyle = '#ff0'; ctx.strokeRect(x + 0.5, y + 0.5, 31, 31); }
    }
    this.drawPalette(ctx);
  }
  drawPalette(ctx) {
    const m = this.mgr;
    FUNCTIONS.forEach((_, i) => {
      const f = this.paletteFn(i);
      if (f) m.drawIcon(ctx, this.W.icon[f[1]], PALETTE.x + (i % PALETTE.cols) * PALETTE.step, PALETTE.y + Math.floor(i / PALETTE.cols) * PALETTE.step);
    });
  }
  move(lx, ly) { if (this.tab === 'touch') this.tabs.move(lx, ly); }
  up() { this.tabs.up(); }
  down(lx, ly) {
    const tab = this.tabs.tabAt(lx, ly);
    if (tab) { if (tab !== this.tab) { this.tab = tab; this.picked = null; this.tabs.picked = null; sfx.play('UI/Tab'); } return; }
    if (this.tab !== 'keyboard') {
      if (this.tabs.down(lx, ly, this.tab)) return;
      const f = this.paletteFn(this.paletteAt(lx, ly));
      if (f) this.mgr.startCarry({ kind: 'bind', b: { type: f[0], action: f[1] } }, this.W.icon[f[1]]);
      return;
    }
    const sc = this.capAt(lx, ly);
    if (sc !== null) {
      this.picked = sc;
      const b = this.draft[sc];
      if (b) this.mgr.startCarry({ kind: 'bind', b, fromSc: sc }, this.iconFor(b));
      return;
    }
    const f = this.paletteFn(this.paletteAt(lx, ly));
    if (f) this.mgr.startCarry({ kind: 'bind', b: { type: f[0], action: f[1] } }, this.W.icon[f[1]]);
  }
  drop(lx, ly, c) {
    const sc = this.capAt(lx, ly);
    const it = c.kind === 'item' && itemKeyType(c.tab, c.id);
    const b = c.kind === 'bind' ? c.b : c.kind === 'skill' ? { type: 1, action: c.id } : it ? { type: it, action: c.id } : null;
    if (this.tab !== 'keyboard') { this.tabs.drop(lx, ly, b, c, this.tab); return; }
    if (!b) return;
    if (sc === null) { if (c.fromSc !== undefined) delete this.draft[c.fromSc]; return; } // dropped off the keys: unbind
    if (c.fromSc !== undefined && c.fromSc !== sc) delete this.draft[c.fromSc];
    // a function, skill or item lives on one key only
    for (const [k, v] of Object.entries(this.draft)) if (v.type === b.type && v.action === b.action && Number(k) !== sc) delete this.draft[k];
    this.draft[sc] = { ...b };
    this.picked = sc;
  }
  dropOutside(c) { if (c.kind === 'bind' && c.fromSc !== undefined) delete this.draft[c.fromSc]; this.tabs.dropOutside(c); }
  tooltip(lx, ly) {
    const g = this.g;
    const sc = this.tab === 'keyboard' ? this.capAt(lx, ly) : null;
    const b = this.tab === 'keyboard' ? (sc !== null ? this.draft[sc] : null) : this.tabs.bindingAt(lx, ly, this.tab);
    if (!b) return null;
    if (b.type === 2 || b.type === 7) {
      for (const tab of [2, 3, 4, 5]) for (const it of Object.values(g.inventory?.[tab] || {})) if (it?.id === b.action) return { item: it };
      return { item: { id: b.action } };
    }
    if (b.type === 1 && g.skills) return { skill: b.action };
    if (b.type === 8) {
      const mac = g.macros?.[b.action];
      if (!mac) return null;
      return { title: mac.name || `Macro ${b.action + 1}`, lines: [MACRO_TIP, '', ...mac.skills.filter(Boolean).map((id) => g.skills?.name(id) || '')] };
    }
    return null;
  }
}

// ==================================================================== tooltip
/** A text tooltip in the client's panel: translucent navy with a white ring, the title centred, lines below. */
/** The tooltip box: dark blue with a white inner edge. */
function tipFrame(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,64,0.627)';
  ctx.fillRect(x + 1, y, w - 2, 1); ctx.fillRect(x, y + 1, w, h - 2); ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 1, y + 2, 1, h - 4); ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
  ctx.fillRect(x + 2, y + 1, w - 4, 1); ctx.fillRect(x + 2, y + h - 2, w - 4, 1);
}
/** A one-line tooltip (button hints, the EXP figures): text width + 8 by the line + 6, (dx, dy) from where tips go. */
export function lineTip(text, dx = 0, dy = 0) {
  return {
    draw(ctx, x, y) {
      ctx.save();
      ctx.font = '12px Arial, sans-serif';
      const w = Math.ceil(ctx.measureText(text).width) + 8, h = 20;
      x = Math.max(0, Math.min(x + dx, UI_W - w)); y = Math.max(0, Math.min(y + dy, UI_H - h));
      tipFrame(ctx, x, y, w, h);
      uiText(ctx, text, x + 4, y + 3, { color: '#fff', size: 12 });
      ctx.restore();
    },
  };
}
/**
 * A ToolTipHelp entry (Title, Desc with "\n" breaks) under the cursor: at least 270 wide, the title centred 8 down,
 * the description wrapped from x 10, kept on screen.
 */
export function helpTip(title, desc) {
  return {
    draw(ctx, mx, my) {
      ctx.save();
      ctx.font = 'bold 12px Arial, sans-serif';
      const w = Math.max(270, Math.ceil(ctx.measureText(title).width) + 16);
      ctx.font = '12px Arial, sans-serif';
      const lines = String(desc || '').split(/\\n|\n/).flatMap((l) => (l ? wrapText(ctx, l, w - 15, 12) : ['']));
      const h = 14 + 8 + 15 + (desc ? lines.length * 15 : -4);
      const x = Math.max(0, Math.min(mx - 14, UI_W - 1 - w)), y = Math.max(0, Math.min(my + 2, UI_H - 1 - h));
      tipFrame(ctx, x, y, w, h);
      uiText(ctx, title, x + w / 2, y + 8, { color: '#fff', bold: true, size: 12, align: 'center' });
      if (desc) lines.forEach((l, i) => uiText(ctx, l, x + 10, y + 10 + 15 + 8 + i * 15, { color: '#fff', size: 12 }));
      ctx.restore();
    },
  };
}
/** A text tooltip panel, kept inside a viewW x viewH view. */
export function drawTip(ctx, tip, x, y, viewW = UI_W, viewH = UI_H) {
  ctx.save();
  ctx.font = '12px Arial, sans-serif';
  const lines = tip.lines.flatMap((l) => (l ? wrapText(ctx, l, 255, 12) : ['']));
  ctx.font = 'bold 12px Arial, sans-serif';
  const tw = ctx.measureText(tip.title).width;
  ctx.font = '12px Arial, sans-serif';
  const w = Math.ceil(Math.max(tw + 20, ...lines.map((l) => ctx.measureText(l).width + 20), 80));
  const h = 24 + lines.length * 15 + (lines.length ? 4 : 0);
  x = Math.min(x, viewW - w - 2); y = Math.min(y, viewH - h - 2);
  tipFrame(ctx, x, y, w, h);
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

