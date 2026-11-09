import { sfx } from '../audio.js';
import { invType, itemInfo, itemName } from '../data.js';
import { uiText } from './wzui.js';
import { Win, lineTip, allCanvases } from './windows.js';
import { equipCategory } from './dialogs.js';
import { CHAT_COLOR } from './statusbar.js';
import { UI_W, UI_H } from '../view.js';

/**
 * The Maker (UIWindow.img/Maker, 312x393): pick a category and an item, put in what it takes, and CREATE runs the
 * gauge for 5.1s before MAKER_SKILL goes. Kinds: 1 an item from Etc/ItemMake.img, 2 "???", 3 a Monster Crystal from
 * 100 drops, 4 disassembling an equip.
 */
const SLOT = 37, MAKE_MS = 5100;
const TARGET = [15, 39, 52, 52];
const slotXY = (i) => [(i % 3) * 93 + 19, i < 3 ? 130 : 180];
const gemXY = (j) => [112 + 49 * j, 269];
const CATALYST = [19, 269];
const AREA = [11, 124, 300, 220], CATALYST_AREA = [11, 250, 80, 313], GEM_AREA = [80, 250, 304, 313];
const GAUGE_X = 6, GAUGE_Y = 320;
const COMBO1 = [78, 68], COMBO2 = [156, 68], START = [83, 356], CANCEL = [159, 356];
const ROW_H = 15, ROWS = 10;
const COUNT_COLOR = '#90a8c3', FEE_COLOR = '#29517a', ROW_HOVER = '#a5a198';
const DISASSEMBLE = 998, CRYSTAL = 426, MYSTERY = 999, GEMS = 425;
const STIMULATOR = 4130018;
const TABS = { 1: 'Eqp', 2: 'Use', 3: 'Setup', 4: 'Etc', 5: 'Cash' };
const ROOM = 'You don\'t have enough room in your Inventory.';
const FAILED = 'Production failed.';
const inRect = (r, x, y) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
const inBox = (bx, by, w, h, x, y) => x >= bx && x < bx + w && y >= by && y < by + h;
const recipeItems = (r) => Object.values(r?.recipe || {});

/** The Maker skill for a job: Evan's own, else the 1007 of its 0 / 1000 / 2000 line. */
export function makerSkill(job) {
  return Math.floor(job / 100) === 22 || job === 2001 ? 20011007 : Math.floor(job / 1000) * 10000000 + 1007;
}

/** An icon in shades of grey (green weighs most), as the Maker shows what you don't have yet. */
const greys = new WeakMap();
function grey(img) {
  if (!img) return null;
  let g = greys.get(img);
  if (!g) {
    g = document.createElement('canvas'); g.width = img.width; g.height = img.height;
    const c = g.getContext('2d');
    c.drawImage(img, 0, 0);
    try {
      const d = c.getImageData(0, 0, g.width, g.height), p = d.data;
      for (let i = 0; i < p.length; i += 4) p[i] = p[i + 1] = p[i + 2] = (p[i + 1] * 53 + p[i] * 37 + p[i + 2] * 10) / 100;
      c.putImageData(d, 0, 0);
    } catch { /* left in colour */ }
    greys.set(img, g);
  }
  return g;
}

/** A drop-down list on Maker's ComboBox art: the box with its arrow, and up to 10 rows under it. */
class Combo {
  constructor(win, art, x, y, onPick) {
    Object.assign(this, { win, art, x, y, onPick, items: [], sel: 0, open: false, hover: -1, first: 0 });
    this.w = art?.base?._w || 75; this.h = art?.base?._h || 17;
  }
  frames() { return [...allCanvases(this.art), ...allCanvases(this.win.mgr.W.Maker?.BtDown)]; }
  set(items) { this.items = items; this.sel = 0; this.open = false; this.first = 0; }
  get key() { return this.items[this.sel]?.key ?? 0; }
  label(e) { return e.id ? this.win.mgr.itemName(e.id) || '' : e.label; }
  listRect() { const n = Math.min(ROWS, this.items.length); return [this.x, this.y + this.h, this.x + this.w, this.y + this.h + 6 + n * ROW_H]; }
  rowAt(lx, ly) {
    const r = this.listRect();
    if (!this.open || !inRect(r, lx, ly)) return -1;
    const i = this.first + Math.floor((ly - r[1] - 3) / ROW_H);
    return i >= 0 && i < this.items.length ? i : -1;
  }
  /** True when the click was the list's. */
  down(lx, ly) {
    if (this.open) {
      const i = this.rowAt(lx, ly);
      this.open = false;
      if (i >= 0) { const was = this.sel; this.sel = i; if (i !== was) this.onPick(); return true; }
      return inBox(this.x, this.y, this.w, this.h, lx, ly);
    }
    if (!inBox(this.x, this.y, this.w, this.h, lx, ly) || !this.items.length) return false;
    this.open = true; this.first = Math.max(0, Math.min(this.sel, this.items.length - ROWS));
    return true;
  }
  wheel(dy) { if (this.open) this.first = Math.max(0, Math.min(this.items.length - ROWS, this.first + dy)); }
  draw(ctx) {
    const m = this.win.mgr, im = (n) => m.image(n);
    const base = im(this.art?.base), down = im(m.W.Maker?.BtDown?.normal?.[0]);
    if (base) ctx.drawImage(base, this.x, this.y);
    if (down) ctx.drawImage(down, this.x + this.w - down.width - 2, this.y + ((this.h - down.height) >> 1));
    const t = this.items[this.sel] && this.label(this.items[this.sel]);
    if (t) uiText(ctx, t, this.x + 4, this.y + 3, { color: '#000', size: 11 });
  }
  drawList(ctx) {
    if (!this.open) return;
    const m = this.win.mgr, im = (n) => m.image(n), [x, y, , y2] = this.listRect();
    const t = im(this.art?.t), c = im(this.art?.c), b = im(this.art?.b);
    if (t) ctx.drawImage(t, x, y);
    if (c) ctx.drawImage(c, x, y + 3, this.w, y2 - y - 6);
    if (b) ctx.drawImage(b, x, y2 - 3);
    const n = Math.min(ROWS, this.items.length);
    for (let k = 0; k < n; k++) {
      const i = this.first + k, ry = y + 3 + k * ROW_H;
      if (i === this.hover) { ctx.fillStyle = ROW_HOVER; ctx.fillRect(x + 2, ry, this.w - 4, ROW_H); }
      uiText(ctx, this.label(this.items[i]), x + 4, ry + 2, { color: '#000', size: 11 });
    }
  }
}

export class MakerWin extends Win {
  constructor(mgr, data) {
    const M = mgr.W.Maker;
    super(mgr, M.backgrnd, ((UI_W - 312) >> 1), Math.max(0, (UI_H - 393) >> 1));
    this.M = M; this.data = data || {};
    this.closeBtn.x = 292; this.closePinned = true;
    this.startBtn = this.button(M.BtStart, ...START, () => this.create());
    this.button(M.BtCancel, ...CANCEL, () => this.mgr.close(this));
    this.cats = new Combo(this, M.ComboBox1, ...COMBO1, () => this.fillItems());
    this.items = new Combo(this, M.ComboBox2, ...COMBO2, () => this.pickItem());
    this.reset();
    this.fillCategories();
  }
  frames() {
    const M = this.M;
    return [...super.frames(), ...this.cats.frames(), ...this.items.frames(), M.notUse, M.randomMake, M.randomRecipe, M.GaugeBar?.bar, M.GaugeBar?.gauge].filter(Boolean);
  }
  onClose() { this.stopSound(); if (this.g.makerWin === this) this.g.makerWin = null; }
  stopSound() { this.sound?.(); this.sound = null; }

  // ---------------------------------------------------------------- recipes
  /** The recipes a job's Maker offers: its own branch's (a GM every branch's), then the gems and crystals. */
  recipeIds() {
    const branch = Math.floor(((this.g.stats?.job || 0) % 1000) / 100);
    const cats = branch === 9 ? [1, 2, 4, 8, 16] : branch >= 1 && branch <= 5 ? [2 ** (branch - 1)] : [];
    return [...cats, 0].flatMap((c) => Object.keys(this.data[c] || {}).map(Number));
  }
  recipe(id) { for (const c of Object.values(this.data)) { const r = c?.[String(id).padStart(8, '0')]; if (r) return r; } return null; }
  /** Your Maker level, character level, an item or equip it needs and quest states are all met. */
  usable(id) {
    const r = this.recipe(id), g = this.g, st = g.stats || {};
    if (!r) return false;
    if (r.reqSkillLevel && (g.skills?.level(makerSkill(st.job || 0)) || 0) < r.reqSkillLevel) return false;
    if (r.reqLevel && (st.level || 0) < r.reqLevel) return false;
    if (r.reqItem && g.itemCount(r.reqItem) < 1) return false;
    if (r.reqEquip && !Object.values(g.inventory?.equipped || {}).some((it) => it?.id === r.reqEquip)) return false;
    for (const [q, want] of Object.entries(r.reqQuest || {})) {
      const s = g.quests?.status(Number(q)) ?? 0;
      if (Number(want) === 3 ? s !== 1 && s !== 2 : s !== Number(want)) return false;
    }
    return true;
  }
  /** A group's name in the Category list: the equip kind, else Strengthening Gem / Monster Crystal / Use / Setup / Etc. */
  groupName(id) {
    const eq = invType(id) === 1 ? equipCategory(id) : null;
    if (eq) return eq;
    const g = Math.floor(id / 10000), h = Math.floor(g / 100) * 100;
    return g === GEMS ? 'Strengthening Gem' : g === CRYSTAL ? 'Monster Crystal' : { 200: 'Use', 300: 'Setup', 400: 'Etc' }[h] || '';
  }
  fillCategories() {
    const list = [{ label: 'Category', key: 0 }, { label: 'Disassemble Equipment', key: DISASSEMBLE }, { label: 'Monster Crystal', key: CRYSTAL }, { label: 'Strengthening Gem', key: GEMS }];
    this.groups = new Map();
    for (const id of this.recipeIds()) {
      if (!this.usable(id)) continue;
      let key = Math.floor(id / 10000);
      const h = Math.floor(key / 100) * 100;
      if (key !== GEMS && (h === 200 || h === 300 || h === 400)) key = h;
      if (!this.groups.has(key)) {
        this.groups.set(key, []);
        if (![200, 300, 400, GEMS].includes(key)) list.push({ label: this.groupName(id), key });
      }
      this.groups.get(key).push(id);
    }
    if (!this.groups.has(GEMS)) list.splice(list.findIndex((e) => e.key === GEMS), 1);
    for (const [key, label] of [[200, 'Use'], [300, 'Setup'], [400, 'Etc']]) if (this.groups.has(key)) list.push({ label, key });
    list.push({ label: '???', key: MYSTERY });
    this.cats.set(list);
    this.items.set([]);
  }
  /** A category picked: its items under "Item" (the crystal, disassembly and ??? have one each). */
  fillItems() {
    this.reset();
    if (!this.cats.sel) { this.items.set([]); return; }
    const key = this.cats.key, list = [{ label: 'Item', key: 0 }];
    for (const id of this.groups.get(key) || []) list.push({ key: id, id });
    if (key === DISASSEMBLE) list.push({ label: 'Monster Crystal', key: DISASSEMBLE });
    if (key === CRYSTAL) list.push({ label: 'Monster Crystal', key: CRYSTAL });
    if (key === MYSTERY) list.push({ label: '???', key: MYSTERY });
    this.items.set(list);
  }

  // ---------------------------------------------------------------- what is being made
  reset() {
    this.state = 0; this.target = null; this.itemId = 0; this.rec = null; this.type = 1;
    this.slots = Array.from({ length: 6 }, () => ({ id: 0, need: 0, have: 0, filled: false, placeholder: false }));
    this.slotCount = 0; this.applied = 0;
    this.gems = [0, 0, 0, 0]; this.gemSlots = 0; this.gemCount = 0;
    // need: the Stimulator it takes (or the one put in); base: the one shown grey; real: the one shown once in
    this.catalyst = { need: 0, base: 0, real: 0, applied: false };
    this.pos = null;
  }
  /** An item picked: the slots it needs (or the crystal / disassembly / ??? slots). */
  pickItem() {
    this.reset();
    if (!this.items.sel) return;
    const key = this.items.key;
    this.itemId = key;
    const M = this.M;
    if (key === CRYSTAL || key === DISASSEMBLE || key === MYSTERY) {
      this.target = M.randomMake;
      if (key === MYSTERY) {
        this.type = 2; this.slotCount = 6; this.gemSlots = 4; this.catalyst.base = this.catalyst.real = STIMULATOR;
        for (const s of this.slots) Object.assign(s, { placeholder: true, need: 0 });
      } else {
        this.type = key === CRYSTAL ? 3 : 4; this.slotCount = 1;
        Object.assign(this.slots[0], { placeholder: true, need: key === CRYSTAL ? 100 : 1 });
      }
      return;
    }
    this.target = key;
    this.rec = this.recipe(key);
    if (!this.rec) return;
    this.gemSlots = Math.min(4, Number(this.rec.tuc) || 0);
    const parts = recipeItems(this.rec).slice(0, 6);
    this.slotCount = parts.length;
    parts.forEach((p, i) => {
      const have = this.g.itemCount(p.item);
      Object.assign(this.slots[i], { id: p.item, need: p.count, have, filled: p.count <= have });
    });
    const c = this.catalyst;
    c.need = c.base = c.real = Number(this.rec.catalyst) || 0;
  }
  /** Ready to create: every recipe part held (and the recipe still usable), something put in, 100 drops, an equip put in. */
  ready() {
    if (!this.itemId) return false;
    if (this.type === 1) return this.usable(this.itemId) && this.slots.slice(0, this.slotCount).every((s) => s.filled);
    if (this.type === 2) return this.applied > 0;
    if (this.type === 3) return this.slots[0].have > 99;
    if (this.type === 4) return !!this.rec;
    return true;
  }

  // ---------------------------------------------------------------- the clock
  tick() {
    if (this.state < 2) {
      this.state = this.ready() ? 1 : 0;
      this.startBtn.enabled = this.state === 1;
    } else if (this.state === 2 && performance.now() - this.startedAt >= MAKE_MS) {
      this.state = 3;
      if (!this.send()) this.state = 0;
    }
    this.refresh();
  }
  /** Counts follow the inventory; what is no longer there comes out (a moved equip starts the item over). */
  refresh() {
    if (!this.itemId) return;
    const g = this.g;
    for (let i = 0; i < this.slotCount; i++) {
      const s = this.slots[i];
      if (!s.id) continue;
      if (this.type === 1 || this.type === 3) {
        s.have = g.itemCount(s.id);
        if (!s.have) this.takeOut(i);
        s.filled = s.need <= s.have;
      } else if (this.type === 2) {
        s.have = Math.min(g.itemCount(s.id), s.have);
        if (!s.have) this.takeOut(i);
        s.filled = true;
      } else if (this.type === 4) {
        const it = this.pos && g.inventory?.[this.pos.tab]?.[this.pos.slot];
        if (!it || it.id !== s.id) { this.stopSound(); this.pickItem(); return; }
        s.have = 1; s.filled = true;
      }
    }
    for (let j = 0; j < this.gemSlots; j++) if (this.gems[j] && !g.itemCount(this.gems[j])) this.takeGem(j);
    if (this.catalyst.applied && this.catalyst.need && !g.itemCount(this.catalyst.need)) this.takeCatalyst();
  }

  // ---------------------------------------------------------------- putting things in and taking them out
  drop(lx, ly, c) {
    if (c?.kind !== 'item' || typeof c.tab !== 'number') return;
    const it = this.g.inventory?.[c.tab]?.[c.slot];
    if (!it || this.state > 1) return;
    if (!this.itemId) { this.mgr.notice('Please select the item you wish to make first!'); return; }
    if (inRect(AREA, lx, ly)) this.putPart(it, c.tab, c.slot);
    else if (inRect(CATALYST_AREA, lx, ly)) this.putCatalyst(it);
    else if (inRect(GEM_AREA, lx, ly)) this.putGem(it);
  }
  async putPart(it, tab, slot) {
    if (this.type < 2) return;
    if (this.applied >= this.slotCount) { this.mgr.notice('You cannot apply any more ingredients.'); return; }
    if (this.slots.some((s) => s.id && s.id === it.id)) { this.mgr.notice('This item has already been applied.'); return; }
    let have = this.g.itemCount(it.id);
    if (this.type === 3) {
      const info = Math.floor(it.id / 10000) === 400 ? await itemInfo(this.g.assets, it.id) : null;
      if (!Number(info?.lv)) { this.mgr.notice('You cannot use this item as an ingredient to make the Monster Crystal.'); return; }
    } else if (this.type === 2) {
      const n = await this.mgr.askNumber('How many would you like to apply?', 1, 1, have);
      if (!n) return;
      have = n;
    } else if (this.type === 4) {
      const rec = invType(it.id) === 1 ? this.recipe(it.id) : null;
      if (!rec) { this.mgr.notice('This item cannot be disassembled.'); return; }
      this.pos = { tab, slot }; this.rec = rec;
    }
    const i = this.slots.findIndex((s, k) => k <= this.applied && !s.id);
    if (i < 0) return;
    Object.assign(this.slots[i], { id: it.id, have });
    if (this.applied < 6) this.applied++;
    sfx.play('UI/DragEnd');
  }
  putGem(it) {
    if (this.gemCount >= this.gemSlots) { this.mgr.notice('You cannot apply the Strengthening Gem anymore.'); return; }
    if (Math.floor(it.id / 10000) !== GEMS) { this.mgr.notice('You can only apply the Strengthening Gem.'); return; }
    const kind = Math.floor((it.id % 10000) / 100);
    if (this.gems.some((g) => g && Math.floor((g % 10000) / 100) === kind)) { this.mgr.notice('You cannot apply more than 1 of the same Strengthening Gems.'); return; }
    // the attack gems go only on weapons
    if (this.type !== 2 && kind <= 1 && !isWeapon(this.itemId)) { this.mgr.notice('You can only use this Strengthening Gem on weapon items.'); return; }
    const j = this.gems.findIndex((g, k) => k < this.gemSlots && !g);
    if (j < 0) return;
    this.gems[j] = it.id;
    if (this.gemCount < 4) this.gemCount++;
    sfx.play('UI/DragEnd');
  }
  putCatalyst(it) {
    const c = this.catalyst;
    if (c.applied) { this.mgr.notice('You can only apply 1 Stimulator.'); return; }
    if (Math.floor(it.id / 1000) !== 4130) { this.mgr.notice('You can only apply the Stimulator.'); return; }
    if (this.type !== 2 && c.need && c.need !== it.id) { this.mgr.notice('You cannot apply this Stimulator.'); return; }
    c.need = c.real = it.id; c.applied = true;
    sfx.play('UI/DragEnd');
  }
  takeOut(i) {
    if (this.state > 1 || this.type < 2 || i >= this.slotCount || !this.slots[i].id) return false;
    Object.assign(this.slots[i], { id: 0, have: 0 });
    if (this.applied > 0) this.applied--;
    if (this.type === 4) { this.pos = null; this.rec = null; }
    return true;
  }
  takeGem(j) {
    if (this.state > 1 || j >= this.gemSlots || !this.gems[j]) return false;
    this.gems[j] = 0;
    if (this.gemCount > 0) this.gemCount--;
    return true;
  }
  takeCatalyst() {
    const c = this.catalyst;
    if (this.state > 1 || !c.applied) return false;
    c.applied = false;
    if (this.type === 2) c.need = 0;
    return true;
  }
  down(lx, ly) {
    // an open list takes the click (a row, or closing it)
    if (this.cats.open || this.items.open) { this.cats.down(lx, ly); this.items.down(lx, ly); return; }
    if (this.cats.down(lx, ly) || this.items.down(lx, ly)) return;
    let out = false;
    for (let i = 0; i < this.slotCount && !out; i++) if (inBox(...slotXY(i), SLOT, SLOT, lx, ly)) out = this.takeOut(i);
    for (let j = 0; j < this.gemSlots && !out; j++) if (inBox(...gemXY(j), SLOT, SLOT, lx, ly)) out = this.takeGem(j);
    if (!out && inBox(...CATALYST, SLOT, SLOT, lx, ly)) out = this.takeCatalyst();
    if (out) sfx.play('UI/DragEnd');
  }
  move(lx, ly) { this.cats.hover = this.cats.rowAt(lx, ly); this.items.hover = this.items.rowAt(lx, ly); }
  wheel(dy) { this.cats.wheel(dy); this.items.wheel(dy); }

  // ---------------------------------------------------------------- making it
  /** What it costs: an item's mesos plus a tenth per gem level x3, +5 tenths with a Stimulator; a disassembly by the equip's grade. */
  fee() {
    if (this.type === 4) return this.slots[0].id && this.rec ? disassemblyFee(this.g, this.slotItem(), Number(this.rec.meso) || 0) : 0;
    const meso = Number(this.rec?.meso) || 0;
    const levels = this.gems.slice(0, this.gemSlots).reduce((n, g) => n + (g ? (g % 10) + 1 : 0), 0);
    let add = ((this.catalyst.applied ? 5 : 0) + 1 + levels * 3) * Math.trunc(meso / 10);
    if (add < 1) add = 0;
    const t = add + meso;
    return t - Math.max(0, t % 1000);
  }
  slotItem() { return this.pos && this.g.inventory?.[this.pos.tab]?.[this.pos.slot]; }
  /** Room for what comes out: each random reward's tab, else the item's; a crystal or a disassembly needs Etc room. */
  roomOk() {
    const g = this.g;
    let full = 0;
    if (this.type === 1 || this.type === 2) {
      if (!this.rec) return false;
      const rewards = Object.values(this.rec.randomReward || {});
      if (rewards.length) full = rewards.map((r) => invType(r.item)).find((t) => g.freeSlots(t) < 1) || 0;
      else if (g.freeSlots(invType(this.itemId)) < 1) full = invType(this.itemId);
    } else if (this.type === 3 && g.freeSlots(4) < 1) full = 4;
    else if (this.type === 4 && g.freeSlots(4) < recipeItems(this.rec).length) full = 4;
    if (full) this.noRoom(full);
    return !full;
  }
  noRoom(tab) {
    if (this.type === 2) { this.mgr.notice(FAILED); return; }
    this.mgr.notice(`${tab < 5 ? TABS[tab] || '' : ''} ${ROOM}`);
  }
  mesoOk() {
    if (this.type === 3) return true;
    if (!this.rec) return false;
    if (this.fee() <= (this.g.meso || 0)) return true;
    if (this.type === 1) this.mgr.notice('You do not have enough mesos.');
    else if (this.type === 2) this.mgr.notice(FAILED);
    return false;
  }
  async create() {
    if (this.state !== 1) return;
    const ask = this.type === 1 ? `${this.mgr.itemName(this.itemId) || ''}: Would you like to make this?`
      : this.type === 2 ? 'Would you like to make ???' : this.type === 3 ? 'Would you like to make a Monster Crystal?' : 'Would you like to disassemble?';
    if (!(await this.mgr.confirm(ask)) || this.state !== 1) return;
    if (this.type === 2 ? this.applied < 1 : !(this.ready() && this.roomOk() && this.mesoOk())) return;
    this.startBtn.enabled = false;
    this.startedAt = performance.now();
    this.state = 2;
    this.stopSound();
    sfx.loop('UI/ItemMake').then((stop) => { if (this.state === 2) this.sound = stop; else stop?.(); });
  }
  send() {
    if (!this.roomOk() || !this.mesoOk()) return false;
    if (!this.ready()) { this.mgr.notice(FAILED); return false; }
    if (this.type === 3 && !this.slots[0].id) return false;
    const net = this.g.net;
    if (this.type <= 2) net?.makerSkill(this.type, this.itemId, { catalyst: this.catalyst.applied, gems: this.gems.slice(0, this.gemSlots).filter(Boolean) });
    else if (this.type === 3) net?.makerSkill(3, this.slots[0].id);
    else net?.makerSkill(4, this.slots[0].id, { tab: this.pos?.tab ?? -1, slot: this.pos?.slot ?? -1 });
    this.stopSound();
    this.state = 3;
    return true;
  }
  /** MAKER_RESULT for what was sent: the box saying how it went, then the item starts over. */
  async result(d, name, gone) {
    if (this.state === 3) {
      const r = d.result;
      if (r === 0) { if (name) this.mgr.notice(`${d.made?.count ?? 0} of ${name}  have been produced.`); }
      else if (r === 1) this.mgr.notice('The item has been destroyed.');
      else if (r === 2) this.mgr.notice('Production failed due to an unknown error.');
      else if (r > 3 && r < 8) this.noRoom(r - 3);
      if (gone) this.mgr.notice(`You have successfully disassembled the ${gone}.`);
      this.state = 0;
    }
    if (r01(d)) this.pickItem();
  }

  // ---------------------------------------------------------------- drawing
  icon(id) { return this.mgr.image(this.mgr.icon(id)); }
  centred(ctx, img, x, y, w = SLOT, h = SLOT) { if (img) ctx.drawImage(img, x + Math.trunc((w - img.width) / 2), y + Math.trunc((h - img.height) / 2)); }
  body(ctx) {
    const m = this.mgr, notUse = m.image(this.M.notUse);
    const t = typeof this.target === 'number' ? this.icon(this.target) : m.image(this.target);
    if (t) this.centred(ctx, t, TARGET[0], TARGET[1], TARGET[2], TARGET[3]);
    // the parts: an item's icon (grey until you hold enough), the placeholder for the kinds you fill yourself
    for (let i = 0; i < 6; i++) {
      const [x, y] = slotXY(i), s = this.slots[i];
      if (i >= this.slotCount) { if (notUse) ctx.drawImage(notUse, x, y); continue; }
      let img = null;
      if (s.id) img = s.filled ? this.icon(s.id) : grey(this.icon(s.id));
      else if (s.placeholder) img = m.image(this.M.randomRecipe);
      else continue;
      this.centred(ctx, img, x, y);
      uiText(ctx, this.type === 2 ? `${s.have}/???` : `${s.have}/${s.need}`, x + 40, y + SLOT, { color: COUNT_COLOR, size: 11, base: 'bottom' });
    }
    for (let j = 0; j < 4; j++) {
      const [x, y] = gemXY(j);
      if (j >= this.gemSlots) { if (notUse) ctx.drawImage(notUse, x, y); } else if (this.gems[j]) this.centred(ctx, this.icon(this.gems[j]), x, y);
    }
    const c = this.catalyst;
    if (!c.real || !c.base || (!c.need && this.type !== 2)) { if (notUse) ctx.drawImage(notUse, ...CATALYST); }
    else this.centred(ctx, c.applied ? this.icon(c.real) : grey(this.icon(c.base)), ...CATALYST);
    if ((this.type === 1 && this.rec) || this.type === 4) {
      uiText(ctx, this.fee().toLocaleString('en-US'), 277, 226, { color: FEE_COLOR, size: 11, align: 'right' });
    }
    this.drawGauge(ctx);
    this.cats.draw(ctx); this.items.draw(ctx);
  }
  drawGauge(ctx) {
    const G = this.M.GaugeBar, bar = this.mgr.image(G?.bar), cover = this.mgr.image(G?.gauge);
    if (!bar) return;
    ctx.drawImage(bar, GAUGE_X, GAUGE_Y);
    let fill = 0;
    if (this.state === 2) {
      fill = Math.trunc((Math.trunc((bar.width - 4) / 5) * (performance.now() - this.startedAt)) / 1000);
      if (fill > bar.width - 4) return;
    }
    if (cover) ctx.drawImage(cover, fill + 8, GAUGE_Y, bar.width + 4 - (fill + 8), cover.height);
  }
  draw(ctx) {
    super.draw(ctx);
    ctx.save(); ctx.translate(this.x, this.y);
    this.cats.drawList(ctx); this.items.drawList(ctx);
    ctx.restore();
  }
  tooltip(lx, ly) {
    if (this.cats.open || this.items.open) return null;
    if (inBox(...TARGET, lx, ly) && this.itemId && this.type === 1) return { item: { id: this.itemId } };
    for (let i = 0; i < this.slotCount; i++) if (this.slots[i].id && inBox(...slotXY(i), SLOT, SLOT, lx, ly)) return { item: this.type === 4 ? this.slotItem() || { id: this.slots[i].id } : { id: this.slots[i].id } };
    for (let j = 0; j < this.gemSlots; j++) if (this.gems[j] && inBox(...gemXY(j), SLOT, SLOT, lx, ly)) return { item: { id: this.gems[j] } };
    if (this.catalyst.need && inBox(...CATALYST, SLOT, SLOT, lx, ly)) return { item: { id: this.catalyst.need } };
    if (inRect(AREA, lx, ly) && this.type === 3) return lineTip('Apply the drop items here\n to make the Monster Crystal.');
    if (inRect(AREA, lx, ly) && this.type === 4) return lineTip('Apply the equipment to be disassembled here\n to acquire the Monster Crystal.');
    return null;
  }
}

const r01 = (d) => d.result === 0 || d.result === 1;
const WEAPON_KINDS = new Set([30, 31, 32, 33, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);
const isWeapon = (id) => { const c = Math.floor(id / 10000); return c >= 130 && c < 150 && WEAPON_KINDS.has(c % 100); };

/** How far an equip's stats are over its base (HP and MP count a tenth): -1 under, 0 to 3 for 0-5, 6-22, 23-39, 40 and up. */
const GRADE_STATS = [['str', 'incSTR'], ['dex', 'incDEX'], ['int', 'incINT'], ['luk', 'incLUK'], ['watk', 'incPAD'], ['matk', 'incMAD'],
  ['wdef', 'incPDD'], ['mdef', 'incMDD'], ['acc', 'incACC'], ['avoid', 'incEVA'], ['speed', 'incSpeed'], ['jump', 'incJump']];
function grade(g, it) {
  const info = it && g.windows.info(it.id);
  if (!it || !info || invType(it.id) !== 1 || Number(info.cash) === 1 || Math.floor(it.id / 100000) === 19) return 0;
  const d = (k, b) => (Number(it[k]) || 0) - (Number(info[b]) || 0);
  const s = Math.trunc(d('mp', 'incMMP') / 10) + Math.trunc(d('hp', 'incMHP') / 10) + GRADE_STATS.reduce((n, [k, b]) => n + d(k, b), 0);
  return s < 0 ? -1 : s < 6 ? 0 : s < 23 ? 1 : s < 40 ? 2 : 3;
}
function disassemblyFee(g, it, meso) {
  const pct = { [-1]: 100, 0: 150, 1: 200, 2: 250, 3: 300 }[grade(g, it)];
  const t = Math.trunc((Math.trunc(meso / 10) * pct) / 100);
  return t - Math.max(0, t % 1000);
}

/** The Maker skill or OPEN_UI 0x17: the window opens (or comes to the front). */
export async function openMaker(game) {
  const wm = game.windows;
  if (!wm || !wm.W?.Maker) return;
  if (game.makerWin && wm.order.includes(game.makerWin)) { wm.raise(game.makerWin); return; }
  if (game.makerOpening) return;
  game.makerOpening = true;
  try {
    const data = await game.assets.json('Etc/ItemMake.img');
    const w = new MakerWin(wm, data);
    await game.assets.preload(w.frames());
    game.makerWin = wm.show(w, 'UI/MenuUp');
  } finally { game.makerOpening = false; }
}

/**
 * MAKER_RESULT: what you gained and lost goes to the chat log, then the window (if it sent) says how it went.
 * The counts of gems, a Stimulator and the drops used for a crystal aren't in the packet: 1, 1 and 100.
 */
export async function makerOutcome(game, d) {
  const a = game.assets, name = (id) => itemName(a, id).then((n) => n || ''), line = (t) => game.hud?.message(t, CHAT_COLOR.grey);
  const gained = async (id, n) => { const s = await name(id); if (s) line(`You have gained items in the ${TABS[invType(id)] || ''} tab (${s} ${n})`); };
  const lost = async (id, n) => { const s = await name(id); if (s) line(`You have lost items (${s} ${n})`); };
  const mesos = (m) => { if (m > 0) line(`You have lost mesos. (${-m})`); };
  let made = '', gone = '';
  if (r01(d)) {
    if (d.type === 1 || d.type === 2) {
      if (d.made) await gained(d.made.id, d.made.count);
      for (const p of d.lost) await lost(p.id, p.count);
      for (const id of d.gems) await lost(id, 1);
      if (d.catalyst) await lost(d.catalyst, 1);
      mesos(d.meso);
    } else if (d.type === 3) {
      await gained(d.made.id, 1);
      await lost(d.leftover, 100);
    } else if (d.type === 4) {
      const s = await name(d.equip);
      if (s) line(`You have lost an item (${s})`);
      for (const p of d.gained) await gained(p.id, p.count);
      mesos(d.meso);
    }
  }
  if (d.made?.id) made = await name(d.made.id);
  if (d.equip > 0) gone = await name(d.equip);
  const w = game.makerWin;
  if (w && game.windows.order.includes(w)) w.result(d, made, gone);
}
