import { invType } from '../data.js';
import { uiText, TextField } from './wzui.js';
import { Win, drawTabStrip } from './windows.js';
import { UI_W, UI_H } from '../view.js';

const off = (n) => ({ x: Math.round((UI_W - 800) / 2) + n.x, y: Math.round((UI_H - 600) / 2) + n.y });

/**
 * The couple's wish list (MARRIAGE_REQUEST 9): UIWindow.img/Wedding/wishList/input/groom (bride for a female account),
 * 216x303 at (292, 148). Up to 10 wishes in rows 18px apart from (14, 89), the picked one white on the select bar at
 * (7, 86 + 18r); the box (13, 57), 149 wide and 16 long. ENTER (168, 56) adds what is typed (trimmed; past 10 it says
 * so); DELETE (56, 279) takes the picked one off; OK asks once more and sends RING_ACTION 9 with the list. OK's place
 * was lost: the bar's other half, (110, 279) (unverified). The VScr4 at (193, 88) never scrolls, as in the client.
 */
export class WishListInputWin extends Win {
  constructor(mgr, bride) {
    const I = mgr.W.Wedding?.wishList?.input || {};
    const at = off({ x: 292, y: 148 });
    super(mgr, I[bride ? 'bride' : 'groom'], at.x, at.y);
    this.buttons = []; this.closeBtn = null; this.modal = true;
    this.I = I; this.list = []; this.sel = -1;
    this.button(I.BtOK, 110, 279, () => this.submit());
    this.delBtn = this.button(I.BtDelete, 56 + 23, 279 + 9, () => this.remove());   // its art's origin is (23, 9)
    this.button(I.BtEnter, 168, 56, () => this.add());
    this.field = new TextField(mgr.game.statusBar.layer, 0, 0, 149, 13, { max: 16, color: '#000' });
    this.field.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.field.el.blur(); });
    this.field.el.addEventListener('focus', () => { this.sel = -1; });
  }
  add() {
    const t = this.field.value.trim();
    if (!t) return;
    this.field.value = '';
    if (this.list.length >= 10) { this.mgr.notice('You have exceeded the maximum number of requests.'); return; }
    this.list.push(t);
  }
  remove() { if (this.sel >= 0) { this.list.splice(this.sel, 1); this.sel = -1; } }
  async submit() {
    if (!(await this.mgr.confirm('This is your last chance to make any\r\nchanges. Are you sure that you want to\r\nsubmit this list?'))) return;
    this.g.net?.weddingWishList(this.list);
    this.field.remove(); this.mgr.close(this);
  }
  down(lx, ly) {
    for (let r = 0; r < 10; r++) {
      if (lx >= 7 && lx < 157 && ly >= 86 + 18 * r && ly < 101 + 18 * r && this.list[r] && this.sel !== r) { this.sel = r; this.field.el.blur(); return; }
    }
  }
  draw(ctx) {
    this.delBtn.enabled = this.sel >= 0;
    super.draw(ctx);
    this.field.rect.x = this.x + 13; this.field.rect.y = this.y + 57;
    this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
  }
  body(ctx) {
    const sel = this.mgr.image(this.I.select);
    this.list.forEach((t, i) => {
      if (i === this.sel && sel) ctx.drawImage(sel, 7, 86 + 18 * i);
      ctx.save(); ctx.beginPath(); ctx.rect(14, 86 + 18 * i, 158, 18); ctx.clip();
      uiText(ctx, t, 14, 89 + 18 * i, { color: i === this.sel ? '#fff' : '#000', size: 12 });
      ctx.restore();
    });
    this.scrollbar(ctx, 193, 88, 179, 0, 0, 1, this.mgr.B.VScr4);
  }
}

/**
 * The wedding gift windows (WEDDING_GIFT_RESULT), both on UIWindow.img/Wedding/wishList, 463x289 at (168, 155):
 * give (give/groom: the couple's wishes in 5 rows from (11, 64), what they have been given in 2 rows of 40px from
 * y 201) and receive (receive/groom for an account of gender 2, otherwise receive/bride, as the client picks it: what
 * you were given in 5 rows from y 63). Both list your items on the right, by the Equip / Use / Setup / Etc / Cash tab:
 * 4 rows from y 103 at x 236, leaving out cash, quest, untradeable and account-shared items. Rows: icon at the left,
 * the name at +43 cut at 141px, the count (Use / Setup / Etc, always) under the icon, the picked row on the select bar.
 * Give: PUT (or a double-click on your picked item) asks how many and to confirm, then WEDDING_ACTION 6. Receive:
 * GET (or a double-click on a gift) confirms and sends WEDDING_ACTION 7. EXIT sends WEDDING_ACTION 8. One request at a
 * time: the next waits for the server's answer. Every button, the tabs and the scrollbars lost their places: placed by
 * the art (unverified).
 */
export class WeddingGiftWin extends Win {
  constructor(mgr, give, d) {
    // each window has its own art: give/... and receive/... (backgrounds, select bar, tabs and buttons)
    const L = (give ? mgr.W.Wedding?.wishList?.give : mgr.W.Wedding?.wishList?.receive) || {}, at = off({ x: 168, y: 155 });
    const bg = give ? L.groom : L[mgr.game.accountGender === 2 ? 'groom' : 'bride'];
    super(mgr, bg, at.x, at.y);
    this.buttons = []; this.closeBtn = null;
    this.L = L; this.give = give; this.names = d.names || []; this.items = d.items || [];
    this.tab = 0; this.leftSel = -1; this.mySel = -1; this.pending = false;
    this.first = { left: 0, mine: 0, names: 0 };
    this.button(L.BtExit, 387, 265, () => this.exit());
    if (give) this.button(L.BtPut, 360, 274, () => this.put());
    else this.button(L.BtGet, 203, 274, () => this.take());
  }
  frames() { const T = this.L.Tab; return [...super.frames(), this.L.select, ...Object.values(T?.En || {}), ...Object.values(T?.Ds || {})].filter((n) => n?._canvas); }
  get leftRows() { return this.give ? 2 : 5; }
  get leftY() { return this.give ? 201 : 63; }
  /** Your items of the tab's type, slot by slot, as the client lists them. */
  get mine() {
    const t = this.tab + 1, inv = this.g.inventory?.[t] || {}, out = [];
    for (const slot of Object.keys(inv).map(Number).filter((s) => s > 0).sort((a, b) => a - b)) {
      const it = inv[slot], info = this.mgr.info(it.id) || {};
      if (it.cashId || Number(info.cash) || Number(info.quest) || Number(info.tradeBlock) || Number(info.accountSharable)) continue;
      out.push({ slot, item: it });
    }
    return out;
  }
  exit() { this.g.net?.weddingAction(8); this.mgr.close(this); if (this.g.weddingGifts === this) this.g.weddingGifts = null; }
  key(e) { if (e.key === 'Escape') this.exit(); }
  /** An item list block from the server: types with their bit set are replaced, the others kept (the client's merge). */
  merge(block) {
    this.items = [...this.items.filter((e) => !block.types.includes(Math.floor(e.id / 1000000))), ...block.items];
    this.leftSel = -1;
  }
  async put(idx = this.mySel) {
    const e = this.mine[idx];
    if (!e || this.pending) return;
    if (this.items.length) { this.mgr.notice('You cannot give more than one present for each wishlist.'); return; }
    const it = e.item, k = Math.floor(it.id / 10000);
    let qty = 1;
    if ([2, 3, 4].includes(invType(it.id)) && k !== 207 && k !== 233 && !it.expiration) {
      qty = await this.mgr.askNumber('How many will you store?', it.quantity || 1, 1, it.quantity || 1);
      if (!qty || qty < 1 || qty > (it.quantity || 1)) return;
    }
    if (this.g.inventory?.[this.tab + 1]?.[e.slot] !== it) return;
    if (!(await this.mgr.confirm('Do you want to gift this item?'))) return;
    this.g.net?.weddingGive(e.slot, it.id, qty);
    this.pending = true;
  }
  async take(idx = this.leftSel) {
    const e = this.items[idx];
    if (!e || this.pending) return;
    if (!(await this.mgr.confirm('Are you sure you want to \r\nrecover the item(s) from storage?'))) return;
    const t = Math.floor(e.id / 1000000);
    this.g.net?.weddingTake(t, e.groupIndex ?? 0);
    this.pending = true; this.takeType = t;
  }
  rowHit(lx, ly, x, y0, rows, first) {
    for (let k = 0; k < rows; k++) if (lx >= x && lx < x + 162 && ly >= y0 - 3 + 40 * k && ly < y0 - 3 + 40 * k + 35) return first + k;
    return -1;
  }
  down(lx, ly) {
    const t = (this.tabRects || []).findIndex(([x, w, y]) => lx >= x + 232 && lx < x + 232 + w && ly >= y && ly < y + 19);
    if (t >= 0) { this.tab = t; this.mySel = -1; this.first.mine = 0; return; }
    const l = this.rowHit(lx, ly, 7, this.leftY, this.leftRows, this.first.left), m = this.rowHit(lx, ly, 236, 103, 4, this.first.mine);
    if (l >= 0 && l < this.items.length) { this.leftSel = l; this.mySel = -1; }
    else if (m >= 0 && m < this.mine.length) { this.mySel = m; this.leftSel = -1; }
  }
  dblclick(lx, ly) {
    const l = this.rowHit(lx, ly, 7, this.leftY, this.leftRows, this.first.left), m = this.rowHit(lx, ly, 236, 103, 4, this.first.mine);
    if (this.give && m >= 0 && m === this.mySel) this.put(m);
    else if (!this.give && l >= 0 && l === this.leftSel) this.take(l);
  }
  row(ctx, e, x, y, sel) {
    const m = this.mgr, s = sel && m.image(this.L.select);
    if (s) ctx.drawImage(s, x, y - 3);
    m.drawIcon(ctx, m.icon(e.id), x + 2, y - 1);
    if ([2, 3, 4].includes(invType(e.id))) m.count(ctx, e.quantity || 1, x, y + 17);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 43, y - 2, 141, 18); ctx.clip();
    uiText(ctx, m.itemName(e.id), x + 43, y, { color: '#000', size: 12 });
    ctx.restore();
  }
  body(ctx) {
    const V = this.mgr.B.VScr4;
    if (this.give) {
      this.names.slice(this.first.names, this.first.names + 5).forEach((n, k) => {
        ctx.save(); ctx.beginPath(); ctx.rect(11, 62 + 18 * k, 141, 18); ctx.clip();
        uiText(ctx, n, 11, 64 + 18 * k, { color: '#000', size: 12 }); ctx.restore();
      });
      this.scrollbar(ctx, 209, 61, 85, this.first.names, this.names.length, 5, V);
    }
    this.items.slice(this.first.left, this.first.left + this.leftRows).forEach((e, k) => this.row(ctx, e, 7, this.leftY + 40 * k, this.first.left + k === this.leftSel));
    this.scrollbar(ctx, 209, this.give ? 198 : 61, this.give ? 73 : 191, this.first.left, this.items.length, this.leftRows, V);
    // the tabs, on Basic.img's tab frames, in the strip at (235, 61)
    const T = this.L.Tab;
    ctx.save(); ctx.translate(232, 0);
    this.tabRects = drawTabStrip(ctx, this.mgr, T && { enabled: T.En, disabled: T.Ds }, 5, this.tab, 220, 61);
    ctx.restore();
    this.mine.slice(this.first.mine, this.first.mine + 4).forEach((e, k) => this.row(ctx, { id: e.item.id, quantity: e.item.quantity }, 236, 103 + 40 * k, this.first.mine + k === this.mySel));
    this.scrollbar(ctx, 439, 98, 155, this.first.mine, this.mine.length, 4, V);
  }
  wheel(dy, lx) {
    const d = Math.sign(dy);
    if (lx >= 232) this.first.mine = Math.max(0, Math.min(Math.max(0, this.mine.length - 4), this.first.mine + d));
    else this.first.left = Math.max(0, Math.min(Math.max(0, this.items.length - this.leftRows), this.first.left + d));
  }
  tooltip(lx, ly) {
    const l = this.rowHit(lx, ly, 7, this.leftY, this.leftRows, this.first.left), m = this.rowHit(lx, ly, 236, 103, 4, this.first.mine);
    if (l >= 0 && this.items[l]) return { item: this.items[l] };
    if (m >= 0 && this.mine[m]) return { item: this.mine[m].item };
    return null;
  }
}
