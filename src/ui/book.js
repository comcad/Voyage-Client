import { sfx } from '../audio.js';
import { Win } from './windows.js';
import { uiText } from './wzui.js';
import { richText, drawRich, optionAt } from './richtext.js';

/**
 * A book item (Etc 416xxxx, e.g. the Beginner's Guide): UIWindow.img/Book (478x353) at (190, 148), two pages at
 * once. Pages are the item's book/<n>; each holds paragraphs { text, align } (1 centred, 2 right) in Arial 12,
 * 190 wide from x 35 (left page) or 255 (right page), y 30. #L<n># links open page n. "n/m" is centred under
 * each page at y 293. BtPrev / BtNext turn two pages, BtClose at (430, 10).
 */
// lines with text are 18px, empty ones 15px; text wraps a little inside the 190px column (both measured)
const COL_W = 190, WRAP = 185, COL_X = [35, 255], TOP = 30, LINE = 18, EMPTY_LINE = 15, PARA_GAP = 9, NUM_Y = 293;

export class BookWin extends Win {
  constructor(mgr, pages) {
    const B = mgr.W.Book;
    super(mgr, B.backgrnd, 190, 148);
    this.B = B; this.pages = pages; this.left = 0; this.hover = null;
    this.closeBtn.visible = false;
    this.button(B.BtClose, 430, 10, () => mgr.close(this));
    this.prev = this.button(B.BtPrev, 31, 287, () => this.open(this.left - 2));
    this.next = this.button(B.BtNext, 403, 287, () => this.open(this.left + 2));
    this.layouts = new Map();
    this.refresh();
  }
  frames() {
    const U = this.mgr.W.UtilDlgEx;
    return [...super.frames(), U?.dot0, U?.dot1].filter(Boolean);
  }
  open(page) {
    const last = this.pages.length - 1;
    this.left = Math.max(0, Math.min(last, page));
    this.refresh();
  }
  refresh() {
    this.prev.enabled = this.left > 0;
    this.next.enabled = this.left + 2 <= this.pages.length - 1;
  }

  /** A page's paragraphs laid out: [{ layout, y, align }]. */
  page(i) {
    if (this.layouts.has(i)) return this.layouts.get(i);
    const ctx = document.createElement('canvas').getContext('2d');
    const ref = { player: this.g.player?.name || '', item: (id) => this.mgr.itemName(id) || '', icon: (id) => this.mgr.icon(id), mob: () => '', npc: () => '', map: (id) => id, count: () => 0 };
    let y = 0;
    const out = [];
    for (const p of Object.values(this.pages[i] || {})) {
      if (typeof p?.text !== 'string') continue;
      const layout = richText(ctx, p.text, WRAP, ref, { size: 12, lineH: LINE, bullet: 12, boldE: false });
      let ly = 0;
      for (const l of layout.lines) { if (!l.runs.length) l.h = EMPTY_LINE; l.y = ly; ly += l.h; }
      layout.height = ly;
      out.push({ layout, y, align: Number(p.align) || 0 });
      y += layout.height + PARA_GAP;
    }
    this.layouts.set(i, out);
    return out;
  }

  body(ctx) {
    const U = this.mgr.W.UtilDlgEx, im = (n) => this.mgr.image(n);
    for (let side = 0; side < 2; side++) {
      const i = this.left + side;
      if (i >= this.pages.length) break;
      const x0 = COL_X[side];
      for (const { layout, y, align } of this.page(i)) {
        // centred / right-aligned paragraphs shift each line by its own width
        const shifted = align ? {
          ...layout,
          lines: layout.lines.map((l) => {
            ctx.font = '12px Arial';
            const w = Math.max(0, ...l.runs.map((r) => r.x + (r.t ? ctx.measureText(r.t).width : 0)));
            const dx = align === 1 ? Math.floor((COL_W - w) / 2) : COL_W - w;
            return { ...l, runs: l.runs.map((r) => ({ ...r, x: r.x + dx })) };
          }),
        } : layout;
        drawRich(ctx, shifted, x0, TOP + y, {
          size: 12, hover: this.hover?.page === i ? this.hover.opt : null,
          drawBullet: (bx, by, on) => { const d = im(on ? U?.dot1 : U?.dot0); if (d) ctx.drawImage(d, bx, by); },
          drawImage: (n, ix, iy) => { const g = im(n); if (g) ctx.drawImage(g, ix, iy); },
          drawIcon: (n, ix, iy) => this.mgr.drawIcon(ctx, n, ix, iy),
        });
      }
      const num = `${i + 1}/${this.pages.length}`;
      ctx.font = '12px Arial';
      uiText(ctx, num, x0 + Math.floor((COL_W - ctx.measureText(num).width) / 2), NUM_Y, { color: '#000', size: 12 });
    }
  }

  linkAt(lx, ly) {
    for (let side = 0; side < 2; side++) {
      const i = this.left + side;
      if (i >= this.pages.length) break;
      const px = lx - COL_X[side];
      if (px < -14 || px >= COL_W) continue;
      for (const { layout, y } of this.page(i)) {
        const opt = optionAt(layout, px, ly - TOP - y);
        if (opt !== null) return { page: i, opt };
      }
    }
    return null;
  }
  move(lx, ly) { this.hover = this.linkAt(lx, ly); }
  down(lx, ly) {
    const link = this.linkAt(lx, ly);
    if (!link) return;
    sfx.play('UI/BtMouseClick');
    this.open(link.opt);
  }
}
