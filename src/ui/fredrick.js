import { Win, allCanvases, cutText } from './windows.js';
import { Anim } from '../map.js';
import { invType } from '../data.js';
import { UI_W, UI_H } from '../view.js';

/**
 * Fredrick's store bank (UIWindow.img/StoreBank, 233x318), from FREDRICK 0x23: what a closed Hired Merchant left
 * for you. The NPC's stand animation plays with its origin at (53, 76). Five rows of the held items, 40px apart from
 * y 88: the slot art `en` at (7, row) for each of the window's slots, the icon at (10, row + 2), the count for
 * Use / Setup / Etc items at (8, row + 20), the name at (51, row + 3) cut at 160px. The held mesos end at x 195,
 * y 295. The window is dragged by its top 64px. GET ALL asks the server for everything (once until the window is
 * opened again); closing sends FREDRICK_ACTION 0x1C.
 *
 * Placed by the art (no place known): GET ALL and EXIT, the scrollbar, and the cash coin's height.
 */
const W = 233, H = 318, ROW0 = 88, ROW_H = 40, ROWS = 5, NPC_AT = [53, 76];
const BAR = { x: 209, y: 86, h: 200 };
const FONT = { size: 12, color: '#000' };
export const FREDRICK_RESULTS = {
  0x1e: 'You have retrieved your items and mesos.',
  0x1f: 'Unable to retrieve mesos and items due to\r\ntoo much money stored\r\nat the Store Bank.',
  0x20: 'Unable to retrieve mesos and items due to\r\none of the items\r\nthat can only be possessed one at a time.',
  0x21: 'Due to the lack of service fee, you were unable to \r\nretrieve mesos or items.',
  0x22: 'Unable to retrieve mesos and items\r\ndue to full inventory.',
};

export class FredrickWin extends Win {
  constructor(mgr, d) {
    const S = mgr.W.StoreBank;
    super(mgr, S.backgrnd, (UI_W - W) >> 1, Math.max(0, (UI_H - H) >> 1));
    this.buttons = []; this.closeBtn = null;
    this.S = S; this.dragH = 64;
    this.npc = d.npc; this.slots = d.slots; this.mesos = d.mesos; this.items = d.items; this.first = 0; this.busy = false;
    this.getAll = this.button(S.BtGetAll, 132, 26, () => this.retrieve());
    this.button(S.BtExit, 132, 50, () => this.mgr.close(this));
    this.loadNpc();
  }
  frames() { return [...super.frames(), ...allCanvases(this.S), this.mgr.CS?.CashItem?.[0]].filter(Boolean); }
  async loadNpc() {
    const id = String(this.npc).padStart(7, '0');
    let img = await this.g.assets.json(`Npc/${id}.img`).catch(() => null);
    const link = img?.info?.link;
    if (link) img = await this.g.assets.json(`Npc/${String(link).padStart(7, '0')}.img`).catch(() => img);
    if (!img?.stand) return;
    const anim = new Anim(img.stand, true);
    await this.g.assets.preload(anim.frames);
    this.anim = anim; this.t = performance.now();
  }
  /** GET ALL: FREDRICK_ACTION 0x1A, sent once (the client won't ask again until the window opens anew). */
  retrieve() {
    if (this.busy) return;
    this.busy = true;
    this.g.net?.fredrick(0x1a);
  }
  /**
   * FREDRICK 0x24, after GET ALL: the storing fee. With none it asks plainly; with one the client says how many days and
   * what it costs, but the decompile lost the percent and mesos it prints, so the plain question stands in for it.
   * Yes takes them (FREDRICK_ACTION 0x1B); no lets GET ALL be pressed again.
   */
  async askFee() {
    if (await this.mgr.confirm('Are you sure you want to retrieve them?')) this.g.net?.fredrick(0x1b);
    else this.busy = false;
  }
  /** FREDRICK_MESSAGE: what came of it (GET ALL can go again after any answer); everything retrieved empties him. */
  result(code) {
    this.busy = false;
    if (code === 0x1e) { this.getAll.enabled = false; this.items = []; this.mesos = 0; }
    const t = FREDRICK_RESULTS[code];
    if (t) this.mgr.notice(t);
  }
  onClose() { this.g.net?.fredrick(0x1c); if (this.g.fredrickWin === this) this.g.fredrickWin = null; }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  get maxFirst() { return this.slots < 6 ? 0 : this.slots - ROWS; }
  wheel(s) { this.first = Math.max(0, Math.min(this.maxFirst, this.first + s)); }
  down(lx, ly) {
    const f = this.scrollClick(lx, ly, BAR.x, BAR.y, BAR.h, this.first, Math.max(this.slots, ROWS), ROWS);
    if (f !== null) this.first = Math.min(this.maxFirst, f);
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n);
    if (this.anim) {
      const now = performance.now();
      this.anim.update(now - this.t); this.t = now;
      const n = this.anim.node, i = n && im(n), o = n?.origin || [0, 0];
      if (i) ctx.drawImage(i, NPC_AT[0] - o[0], NPC_AT[1] - o[1]);
    }
    const en = im(this.S.en);
    for (let k = 0; k < ROWS; k++) {
      const idx = this.first + k, y = ROW0 + k * ROW_H;
      if (idx < this.slots && en) ctx.drawImage(en, 7, y);
      const it = this.items[idx];
      if (!it) continue;
      m.drawIcon(ctx, m.icon(it.id), 10, y + 2);
      m.drawCashMark(ctx, it.id, 40, y + 34);
      if ([2, 3, 4].includes(invType(it.id))) m.count(ctx, it.quantity ?? 1, 8, y + 20);
      ctx.save(); ctx.font = '12px Arial, "Segoe UI", sans-serif'; const name = cutText(ctx, m.itemName(it.id) || '', 160); ctx.restore();
      this.text(ctx, name, 51, y + 3, FONT);
    }
    this.text(ctx, Number(this.mesos || 0).toLocaleString('en-US'), 195, 295, { ...FONT, align: 'right' });
    this.scrollbar(ctx, BAR.x, BAR.y, BAR.h, this.first, Math.max(this.slots, ROWS), ROWS);
  }
}
