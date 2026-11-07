import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { TextField, uiText } from './wzui.js';
import { Win } from './windows.js';
import { textRef } from './dialogs.js';
import { richText, drawRich } from './richtext.js';
import { UI_W, UI_H } from '../view.js';

const JOB_ART = ['Warrior', 'Magician', 'Archer', 'Thief', 'Pirate'];
const SP_HP = [0, 72, 144, 212, 280, 348, 412, 476, 540, 600, 660], SP_MP = [0, 40, 80, 118, 156, 194, 230, 266, 302, 336, 370];
const spText = (job, i) => {
  const what = job === 0 ? 'HP' : 'MP', v = (job === 0 ? SP_HP : SP_MP)[i];
  return i === 0 ? `Don't spend SP, increase MAX ${what} 0` : `spend SP ${i + 5}, increase MAX ${what} ${v}`;
};
const scratch = () => document.createElement('canvas').getContext('2d');

/**
 * Maple Life (5431000 / 5432000): CharacterClone/MainStep1-5 (434x276, centred), six steps -
 *  1 the class (BtLeft (32, 241) / BtRight (165, 241), its Desc, stats, SP, start map, equips and items from (200, 70)
 *    every 20px; class art /0 at (12, 65)), BtCancel (222, 233);
 *  2 the name (a box at (230, 150)); Next is lit while it holds text; 3 the same while USE_MAPLELIFE checks it;
 *  4 the look (face, hair, hair colour, skin, gender rows from y 100 every 19px, arrows at x 278 / 401), the avatar
 *    in the left panel; 5 the SP choice for a Warrior or Magician (arrows (197, 197) / (414, 197)); 6 the finish
 *    text, BtFinish. BtNext / BtFinish at (310, 233), BtBack at (222, 233); class art /1 at (10, 63) from step 2, the
 *    class name centred on x 100 at y 239. Finish sends USE_CASH_ITEM: name, face, hair, hair colour, skin, gender,
 *    class, SP choice.
 */
export class MapleLifeWin extends Win {
  constructor(mgr, slot, itemId, mci, strings) {
    const C = mgr.W.CharacterClone;
    super(mgr, C.MainStep1, Math.round((UI_W - 434) / 2), Math.round((UI_H - 276) / 2));
    this.C = C; this.slot = slot; this.itemId = itemId; this.S = strings || {}; this.closeBtn.visible = false;
    this.step = 1; this.job = 0; this.sp = 0; this.gender = 0; this.busy = false;
    const rot = (l) => { const a = [...l]; const k = a.length ? Math.floor(Math.random() * a.length) : 0; return [...a.slice(k), ...a.slice(0, k)]; };
    const lists = (g) => [0, 1, 2, 3].map((c) => Object.values(mci?.Info?.[g ? 'CharFemale' : 'CharMale']?.[c] || {}).map(Number));
    this.lists = [lists(0).map(rot), lists(1)];
    this.names = mci?.Name || {};
    const B = (art, x, y, fn) => { const b = this.button(art, x, y, fn); b.visible = false; return b; };
    this.bt = {
      cancel: B(C.BtCancel, 222, 233, () => mgr.close(this)),
      next: B(C.BtNext, 310, 233, () => this.next()),
      back: B(C.BtBack, 222, 233, () => this.back()),
      finish: B(C.BtFinish, 310, 233, () => this.finish()),
      jobL: B(C.BtLeft, 32, 241, () => { this.job = this.job === 0 ? 4 : this.job - 1; }),
      jobR: B(C.BtRight, 165, 241, () => { this.job = (this.job + 1) % 5; }),
      spL: B(C.BtLeft, 197, 197, () => { this.sp = this.sp === 0 ? 10 : this.sp - 1; }),
      spR: B(C.BtRight, 414, 197, () => { this.sp = (this.sp + 1) % 11; }),
    };
    this.rowBt = [];
    for (let r = 0; r < 5; r++) {
      const y = r < 4 ? 102 + 19 * r : 178;
      this.rowBt.push(B(C.BtLeft, 278, y, () => this.turn(r, -1)), B(C.BtRight, 401, y, () => this.turn(r, 1)));
    }
    this.field = new TextField(this.g.statusBar.layer, 0, 0, 180, 13, { max: 12, color: '#000' });
    this.field.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && this.bt.next.visible && this.bt.next.enabled) this.next(); });
    this.field.el.addEventListener('input', () => { if (this.step === 2) this.bt.next.enabled = !!this.field.value; });
    this.show();
  }
  frames() { return [...super.frames(), ...[1, 2, 3, 4, 5].map((i) => this.C[`MainStep${i}`]), ...JOB_ART.flatMap((j) => [this.C[j]?.[0], this.C[j]?.[1]])].filter(Boolean); }
  onClose() { this.field.remove(); if (this.g.mapleLife === this) this.g.mapleLife = null; }
  key(e) { if (e.key === 'Escape' && this.step === 1) this.mgr.close(this); }
  list(r) { return this.lists[this.gender][r] || []; }
  turn(r, d) {
    if (r === 4) { this.gender ^= 1; this.lookChanged(); return; }
    const l = this.list(r);
    if (!l.length) return;
    const k = ((d % l.length) + l.length) % l.length;
    this.lists[this.gender][r] = [...l.slice(k), ...l.slice(0, k)];
    this.lookChanged();
  }
  values() { return [0, 1, 2, 3].map((r) => this.list(r)[0] ?? 0); }
  async lookChanged() {
    const [face, hair, color, skin] = this.values(), seq = (this.lookSeq = (this.lookSeq || 0) + 1);
    const look = new CharacterLook(this.g.assets, { skin, face, hair: Math.floor(hair / 10) * 10 + color, gender: this.gender, equips: [] });
    await look.load();
    await this.g.assets.preload(lookCanvases(look, [look.standAction()]));
    if (seq === this.lookSeq) this.look = look;
  }
  show() {
    for (const b of this.buttons) { b.visible = false; b.enabled = true; }
    const s = this.step, on = (...bs) => bs.forEach((b) => { b.visible = true; });
    this.bg = this.C[`MainStep${s === 3 ? 2 : s === 4 ? 3 : s === 5 ? 4 : s === 6 ? 5 : s}`];
    this.field.show(s === 2 || s === 3);
    if (s === 1) on(this.bt.cancel, this.bt.next, this.bt.jobL, this.bt.jobR);
    else if (s === 6) on(this.bt.back, this.bt.finish);
    else on(this.bt.back, this.bt.next);
    if (s === 2) { this.bt.next.enabled = !!this.field.value; setTimeout(() => this.field.focus(), 0); }
    if (s === 3) this.bt.next.enabled = false;
    if (s === 4) { on(...this.rowBt); if (!this.look) this.lookChanged(); }
    if (s === 5) on(this.bt.spL, this.bt.spR);
  }
  next() {
    if (this.step === 4 && this.job > 1) this.step = 5;
    this.step++;
    this.show();
    if (this.step === 3) this.check();
  }
  back() {
    if (this.step === 6 && this.job > 1) this.step = 5;
    this.step--;
    if (this.step === 3) this.step = 2;
    this.show();
  }
  async check() {
    if (this.busy) return;
    if (!(await this.nameOk(this.field.value))) { await this.mgr.notice('You can not use this name.\r\nPlease check again'); this.back(); return; }
    this.g.net?.useMapleLife(this.field.value);
    this.busy = true;
  }
  /** 4-12 letters and digits, fewer than four I / l, and (but for a GM) no forbidden or curse word in it. */
  async nameOk(name) {
    if (!/^[A-Za-z0-9]{4,12}$/.test(name) || (name.match(/[Il]/g) || []).length >= 4) return false;
    if (this.g.gm) return true;
    this.bad ??= await Promise.all(['Etc/ForbiddenName.img', 'Etc/Curse.img'].map((p) => this.g.assets.json(p)))
      .then((ls) => ls.flatMap((l) => Object.values(l || {})).filter((w) => typeof w === 'string' && w).map((w) => w.split(',')[0].toLowerCase()).filter(Boolean));
    const low = name.toLowerCase();
    return !this.bad.some((w) => low.includes(w));
  }
  finish() {
    if (this.busy) return;
    if (!this.field.value) { this.mgr.notice('You cannot use this name. Please check again.'); return; }
    const [face, hair, color, skin] = this.values();
    this.g.net?.useCashItem(this.slot, this.itemId, (w) => w.string(this.field.value).int(face).int(hair).int(color).int(skin).int(this.gender).int(this.job).int(this.sp));
    this.busy = true;
  }
  /** MAPLELIFE_RESULT: the name check (0 free, above 0 taken, below 0 an error). */
  onName(code) {
    this.busy = false;
    if (code === 0) { this.bt.next.enabled = true; this.next(); return; }
    this.mgr.notice(code > 0 ? 'This name is currently being used.\r\nPlease check again.' : `Unknown Error (${code}).`);
    this.back();
  }
  /** MAPLELIFE_ERROR: the creation ('4' with 0 done, '6' a bad name). */
  onCreated(result, code) {
    this.busy = false;
    this.mgr.close(this);
    if (result === 0x34 && code === 0) {
      this.mgr.notice('Creation has completed successfully.');
      this.g.charCount = (this.g.charCount || 0) + 1;
      if ((this.g.charSlots || 0) < this.g.charCount) this.g.charSlots = this.g.charCount;
    } else if (result === 0x36) this.mgr.notice('You can not use this name.\r\nPlease check again');
    else this.mgr.notice(`Unknown Error (${code}).`);
  }
  rowName(r) {
    const v = this.list(r)[0], g = this.gender ? 'CharFemale' : 'CharMale';
    if (r === 0) return this.mgr.itemName(v) || '';
    return String(this.names?.[g]?.[r]?.[v] ?? '');
  }
  rich(ctx, text, x, y, size, lineH) {
    const key = `${text}|${size}`;
    if (this.richKey !== key) { this.richKey = key; this.richLayout = richText(scratch(), String(text || ''), 240, textRef(this.mgr), { size, lineH }); }
    drawRich(ctx, this.richLayout, x, y, { size });
  }
  body(ctx) {
    const s = this.step, cls = this.S[this.job] || {}, im = (n) => this.mgr.image(n);
    const art = this.C[JOB_ART[this.job]]?.[s === 1 ? 0 : 1], ai = im(art);
    if (ai) ctx.drawImage(ai, s === 1 ? 12 : 10, s === 1 ? 65 : 63);
    if (s === 1) ['Desc', 'InitStatDesc', 'InitSPDesc', 'StartMap', 'Equip', 'Item'].forEach((k, i) => uiText(ctx, String(cls[k] || ''), 200, 70 + 20 * i, { color: '#000', size: 12 }));
    if (s === 4) for (let r = 0; r < 5; r++) {
      const t = r === 4 ? (this.gender ? 'Female' : 'Male') : this.rowName(r);
      ctx.save(); ctx.font = '12px Arial'; const w = ctx.measureText(t).width; ctx.restore();
      uiText(ctx, t, Math.round(344 - w / 2), 100 + 19 * r, { color: '#000', size: 12 });
    }
    if (s === 5) {
      this.rich(ctx, this.job === 0 ? this.S.Step4_W_Desc : this.S.Step4_M_Desc, 195, 67, 10, 12);
      uiText(ctx, spText(this.job, this.sp), 212, 195, { color: '#000', size: 12 });
    }
    if (s === 6) this.rich(ctx, this.S.Finish_Desc, 195, 70, 12, 15);
    if (s >= 4 && this.look) drawParts(ctx, this.g.assets, this.look.compose(this.look.standAction(), 0), 95, 200, false);
    const name = String(cls.Class || '');
    ctx.save(); ctx.font = '12px Arial'; const w = ctx.measureText(name).width; ctx.restore();
    uiText(ctx, name, Math.round(100 - w / 2), 239, { color: '#000', size: 12 });
  }
  draw(ctx) {
    super.draw(ctx);
    this.field.rect.x = this.x + 230; this.field.rect.y = this.y + 150;
    this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
  }
}
