import { pad } from '../assets.js';
import { itemInfo } from '../data.js';
import { sfx } from '../audio.js';
import { uiText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W, UI_H } from '../view.js';
import { CHAT_COLOR } from './statusbar.js';

const FADE = 480;

/**
 * A flowerpot's window (Item/Etc/0422.img info: questId, uiData, exp, grade, name, message/n, consumeItem): the
 * raise/backgrnd frame (top 20px, 5px sides), the name at (5, 5), Basic BtClose at (w - 16, 4), and the stage
 * picture uiData/<stage> at (10, 30); the window is the picture's size plus 20 x 40. The exp kind's stage is
 * value / exp (at most grade); the bitmask kind (no exp) layers uiData/<i> for each bit set. A new stage fades in
 * over 480ms, puts its message in the chat log and (above 0) plays the item's Use sound. Dropping one of its
 * consumeItem items on it sends USE_ITEMUI. Opening sends CLOSE_ITEMUI (1) and OPEN_ITEMUI (questId); closing
 * CLOSE_ITEMUI (0). The value comes from the quest record (the number before ':').
 */
export class RaiseWin extends Win {
  constructor(mgr, itemId, info, x = 0, y = 150) {
    super(mgr, null, x, y);
    this.itemId = itemId; this.info = info; this.R = mgr.W.raise;
    this.questId = Number(info.questId); this.uiData = String(info.uiData).replace('UI/UIWindow/', '');
    this.exp = Number(info.exp) || 0; this.grade = Number(info.grade) || 0;
    this.messages = []; for (let i = 0; info.message?.[i] != null && info.message[i] !== ''; i++) this.messages.push(String(info.message[i]));
    this.consume = Object.values(info.consumeItem || {}).map((c) => (typeof c === 'object' ? Number(c?.[0]) : Number(c))).filter(Boolean);
    this.value = this.exp >= 1 ? -this.exp : -1; this.stage = -1; this.pics = []; this.old = null; this.fadeAt = 0;
    this.w = 150; this.h = 150; this.dragH = 20;
    this.closeBtn.visible = false;
    this.button(mgr.B.BtClose, this.w - 16, 4, () => this.g.closeRaise(this.itemId));
    this.g.net?.closeItemUi(itemId, 1);
  }
  frames() { const B = this.R.backgrnd; return [...super.frames(), ...['top', 'center', 'bottom'].flatMap((k) => [B[k]?.left, B[k]?.center, B[k]?.right])].filter(Boolean); }
  get bitmask() { return this.exp < 1; }
  onOpen() { this.g.net?.openItemUi(this.questId); }
  onClose() { this.g.net?.closeItemUi(this.itemId, 0); }
  stageOf(v) {
    if (v < 0) return -1;
    if (this.bitmask) { let n = 0; for (let b = v; b; b &= b - 1) n++; return n; }
    return Math.min(Math.floor(v / this.exp), this.grade);
  }
  async setValue(v) {
    this.value = v;
    const stage = this.stageOf(v);
    if (stage === this.stage && !this.bitmask) return;
    const nodes = stage < 0 ? [] : this.bitmask
      ? Array.from({ length: 31 }, (_, i) => i).filter((i) => (v >>> i) & 1).map((i) => this.R[this.uiData.split('/')[1]]?.[i])
      : [this.R[this.uiData.split('/')[1]]?.[stage]];
    const pics = nodes.filter(Boolean);
    await this.mgr.assets.preload(pics);
    const changed = stage !== this.stage;
    if (changed) { this.old = this.pics; this.fadeAt = performance.now(); }
    this.pics = pics; this.stage = stage;
    const w = Math.max(0, ...pics.map((p) => p._w || 0)), h = Math.max(0, ...pics.map((p) => p._h || 0));
    if (pics.length) { this.w = w + 20; this.h = h + 40; this.closeBtn.x = this.w - 16; }
    if (!changed || stage < 0) return;
    if (stage < this.messages.length) this.g.hud.message(this.messages[stage], CHAT_COLOR.error);
    if (stage > 0) sfx.play(`Item/${pad(this.itemId, 8)}/Use`);
  }
  async drop(lx, ly, c) {
    if (c?.kind !== 'item' || typeof c.tab !== 'number') return;
    const idx = this.consume.indexOf(c.id);
    if (idx < 0 || (this.bitmask && this.value >= 0 && (this.value >>> idx) & 1)) { this.mgr.notice('This item is not available.'); return; }
    if (!this.bitmask && this.value >= this.exp * this.grade) {
      const msg = (await itemInfo(this.g.assets, c.id))?.message?.[0];
      if (msg) this.mgr.notice(String(msg));
      return;
    }
    if (!this.bitmask) { const msg = (await itemInfo(this.g.assets, c.id))?.message?.[1]; if (msg) this.g.hud.message(String(msg), CHAT_COLOR.error); }
    if (!this.g.canExclusive(200)) return;
    this.g.net?.useItemUi(c.tab, c.slot, this.itemId);
    this.g.lockExclusive();
  }
  tooltip(lx, ly) { return ly > 20 && this.stage >= 0 && this.messages[this.stage] ? { title: this.messages[this.stage], lines: [] } : null; }
  draw(ctx) {
    const im = (n) => this.mgr.image(n), B = this.R.backgrnd, w = this.w, h = this.h;
    ctx.save(); ctx.translate(this.x, this.y);
    const row = (r, y, rh) => {
      const l = im(r.left), c = im(r.center), rr = im(r.right);
      if (l) ctx.drawImage(l, 0, y, 5, rh);
      if (c) ctx.drawImage(c, 5, y, w - 10, rh);
      if (rr) ctx.drawImage(rr, w - 5, y, 5, rh);
    };
    row(B.top, 0, 20); row(B.center, 20, h - 25); row(B.bottom, h - 5, 5);
    uiText(ctx, String(this.info.name || ''), 5, 5, { color: '#000', size: 12 });
    const k = Math.min(1, (performance.now() - this.fadeAt) / FADE);
    const layer = (pics, a) => { if (a <= 0) return; ctx.save(); ctx.globalAlpha = a; for (const p of pics) { const i = im(p); if (i) ctx.drawImage(i, 10, 30); } ctx.restore(); };
    if (this.old && k < 1) layer(this.old, 1 - k);
    layer(this.pics, k);
    for (const b of this.buttons) b.draw(ctx, this.mgr.assets);
    ctx.restore();
  }
}

/**
 * The Incubator (UIWindow.img/Incubator/backgrnd, 178x179 at (311, 210)): the egg's icon at (74, 118), BtOk at
 * (42, 154), BtCancel at (100, 154). Pigmy Eggs 4170000-4170009 dropped on it are set ("This item cannot be
 * incubated." otherwise). OK: an egg, a Yes, a free request; then USE_CASH_ITEM with the egg's tab and slot.
 */
export class IncubatorWin extends Win {
  constructor(mgr, slot, itemId, egg = null) {
    const I = mgr.W.Incubator;
    super(mgr, I.backgrnd, 311 + Math.round((UI_W - 800) / 2), 210 + Math.round((UI_H - 600) / 2));
    this.closeBtn.visible = false; this.dragH = 25;
    this.slot = slot; this.itemId = itemId; this.egg = egg;
    this.button(I.BtOk, 42, 154, () => this.ok());
    this.button(I.BtCancel, 100, 154, () => mgr.close(this));
  }
  drop(lx, ly, c) {
    if (c?.kind !== 'item') return;
    if (c.id >= 4170000 && c.id <= 4170009) this.egg = { tab: c.tab, slot: c.slot, id: c.id };
    else this.mgr.notice('This item cannot be incubated.');
  }
  async ok() {
    if (!this.egg) { this.mgr.notice("Please select the item you'd like to incubate"); return; }
    if (!(await this.mgr.confirm('You\'ll need at least 1 slot of Equip. inv., 3 slots of Use inv., and 1 slot of Etc. inv. available.\r\nWill you incubate the Pigmy Egg?'))) return;
    const e = this.egg;
    if (this.g.sendCashItem(this.slot, this.itemId, (w) => w.int(4).int(e.slot))) this.mgr.close(this);
  }
  tooltip(lx, ly) { return this.egg && lx >= 75 && lx <= 102 && ly >= 100 && ly <= 127 ? { item: { id: this.egg.id } } : null; }
  body(ctx) {
    if (!this.egg) return;
    this.mgr.drawIcon(ctx, this.mgr.icon(this.egg.id), 74, 86, this.egg.id);
  }
}

/**
 * A Gold / Silver box (UIWindow.img/TreasureBox/<0 gold, 1 silver>, 170x172 at (315, 214)): mode 0 backgrnd with
 * BtOK2 (30, 147) and BtCancel2 (95, 147); mode 1 backgrndOpened and 2 backgrndClosed with BtOK2 at (63, 147).
 * OK answers true, Cancel / Esc false.
 */
export class TreasureBoxWin extends Win {
  constructor(mgr, mode, gold, done) {
    const T = mgr.W.TreasureBox[gold ? 0 : 1], bg = [T.backgrnd, T.backgrndOpened, T.backgrndClosed][mode];
    super(mgr, bg, 315 + Math.round((UI_W - 800) / 2), 214 + Math.round((UI_H - 600) / 2));
    this.modal = true; this.closeBtn.visible = false; this.done = done;
    if (mode === 0) {
      this.button(mgr.B.BtOK2, 30, 147, () => this.finish(true));
      this.button(mgr.B.BtCancel2, 95, 147, () => this.finish(false));
    } else this.button(mgr.B.BtOK2, 63, 147, () => this.finish(true));
  }
  finish(v) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done?.(v); }
  onClose() { if (!this.answered) { this.answered = true; this.done?.(false); } }
  key(e) { if (e.key === 'Escape') this.finish(false); else if (e.key === 'Enter') this.finish(true); }
}
