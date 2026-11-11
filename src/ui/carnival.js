import { Win, allCanvases, cutText, lineTip } from './windows.js';
import { uiText } from './wzui.js';
import { sfx } from '../audio.js';

/**
 * The Monster Carnival window (UI/UIWindow.img/MonsterCarnival, UI 0x12), made by the first MONSTER_CARNIVAL_START
 * on a Carnival field and gone with it. At (11, 24) the first time, then where it was left (and on its last tab).
 * - Folded (162x128): the panel with your CP and both teams' (available / earned) at (79, 35 / 55 / 75), in 11px
 *   Arial, each team with its star (red for team 0, blue for 1).
 * - Unfolded (182 + 13 x rows high, rows up to 12): the tab's list under it from y 128.
 *   - Rows from y 148, 13px apart: the name (cut at 70px) at x 10, the CP ending at 101, the key ("F<n>") at x 116.
 *     The selected row is white on a filled bar.
 *   - The lock under the list at (9, 162 + 13 x rows), and DECIDE at (110, 159 + 13 x rows).
 * - Picking a tab unfolds the list. Unless the lock is on, it folds itself after 8s (40 off a 30ms tick from 8000),
 *   counted again on every use.
 * - A row is picked by a click (none outside a row) and asked for by DECIDE, a double-click or its F-key. Tab moves
 *   to the next tab (when unfolded).
 * - MONSTER_CARNIVAL (0xDA): the tab and the row (from 0). Not while one is waiting for its answer, at 0 HP, or
 *   within 500ms of the last.
 * - The side button opens the Summon List (backgrnd2) beside it: each monster summoned and how many times, the last
 *   one marked.
 * - Placed by the art, with no known position (the client's calls lost them): the tabs, folding buttons and side
 *   button on the strip under the panel and its right edge, the team stars, the list's top piece and the selected
 *   row's bar.
 */
const W = 162, FOLDED_H = 128, LIST_Y = 128, ROW0 = 20, ROW_H = 13, MAX_ROWS = 12, FOLD_MS = 8000, FOLD_STEP = 40;
const CP_AT = [[79, 35], [79, 55], [79, 75]], CP_TIPS = [[9, 35], [9, 55], [9, 75]];
const STAR_AT = [[10, 51], [10, 73]], TOP_AT = [0, 104], TAB_AT = [7, 111], TAB_GAP = 1;
const MIN_AT = [133, 110], MAX_AT = [146, 110], SIDE_AT = [151, 28], SEL_FILL = '#3a5a8c';
const FONT = 11, BLACK = '#000000', WHITE = '#FFFFFF';
const cut = (ctx, t) => { ctx.font = `${FONT}px Arial, "Segoe UI", sans-serif`; return cutText(ctx, t, 70); };
export const TEAM_NAMES = ['Maple Red', 'Maple Blue'];
const CP_TEXT = [
  ['CP earned that can be used.', 'CP Remaining: %d / CP Earned: %d'],
  ['The game will be decided based on the total CP earned between two teams.', 'CP Remaining: %d / CP Earned: %d'],
  ['Compare the total CP earned between two teams to find the winner.', 'CP Remaining: %d / CP Earned: %d'],
];

export class CarnivalWin extends Win {
  constructor(mgr, saved = {}) {
    const M = mgr.W.MonsterCarnival;
    super(mgr, M.backgrnd, saved.x ?? 11, saved.y ?? 24);
    this.buttons = []; this.closeBtn = null; this.M = M; this.w = W; this.h = FOLDED_H; this.dragH = 22;
    this.rows = [[], [], []]; this.tab = saved.tab >= 0 && saved.tab <= 2 ? saved.tab : 0;
    this.expanded = false; this.lock = false; this.sel = 0; this.timer = FOLD_MS;
    this.mine = [0, 0]; this.teams = [[0, 0], [0, 0]]; this.myTeam = 0; this.summons = []; this.last = '';
    this.pending = false; this.sentAt = -Infinity; this.acc = 0;
    const B = mgr.B;
    this.maxBtn = this.button(B.BtMax, MAX_AT[0], MAX_AT[1], () => this.unfold());
    this.minBtn = this.button(B.BtMin, MIN_AT[0], MIN_AT[1], () => this.fold());
    this.sideBtn = this.button(M.BtSide, SIDE_AT[0], SIDE_AT[1], () => this.toggleSide());
    this.decide = this.button(B.BtDecide, 110, 159, () => { this.timer = FOLD_MS; this.send(); });
    this.selectTab(this.tab);
  }
  frames() { return [...super.frames(), ...allCanvases(this.M), ...allCanvases(this.mgr.B.BtDecide), ...allCanvases(this.mgr.B.VScr4)].filter(Boolean); }
  get count() { return Math.min(this.rows[this.tab].length, MAX_ROWS); }
  /** The window's height and the pieces that move with the list's length. */
  relayout() {
    const r = this.count;
    this.h = this.expanded ? (r + 14) * ROW_H : FOLDED_H;
    this.decide.visible = this.expanded; this.decide.y = ROW_H * r + 159;
    this.decide.enabled = r >= 1 && this.sel > 0;
    this.maxBtn.enabled = !this.expanded; this.minBtn.enabled = this.expanded;
  }
  unfold() { this.expanded = true; this.timer = FOLD_MS; this.relayout(); }
  fold() { this.expanded = false; this.relayout(); }
  selectTab(t) { if (t !== this.tab) this.sel = 0; this.tab = t; this.timer = FOLD_MS; this.unfold(); }
  /** Rows for a tab: [{ index (from 1), name, cp, desc }]. */
  addRow(tab, row) {
    row.key = `F${row.index}`; row.vkey = row.index >= 1 && row.index <= 12 ? row.index : 0;
    this.rows[tab].push(row);
    this.relayout();
  }
  setMine(avail, total) { this.mine = [avail, total]; }
  setTeam(t, avail, total) { if (t === 0 || t === 1) this.teams[t] = [avail, total]; }
  setMyTeam(t) { if (t === 0 || t === 1) this.myTeam = t; }
  /** A monster summoned: counted on the Summon List, which shows it as the last one. */
  summoned(name, start = 0) {
    const s = this.summons.find((e) => e.name === name);
    if (s) s.count++; else this.summons.push({ name, count: start || 1 });
    if (!start) { this.last = name; this.side?.scrollTo(this.summons.findIndex((e) => e.name === name)); }
  }
  /** MONSTER_CARNIVAL for the selected row. */
  send() {
    const g = this.g, now = performance.now();
    if (!this.sel || this.pending || !(g.stats?.hp > 0) || now - this.sentAt < 500) return;
    this.pending = true; this.sentAt = now;
    g.net?.carnival(this.tab, this.sel - 1);
  }
  answered() { this.pending = false; }
  toggleSide() {
    if (this.side && this.mgr.order.includes(this.side)) { this.mgr.close(this.side); this.side = null; return; }
    this.side = this.mgr.show(new CarnivalSideWin(this.mgr, this), null);
  }
  /** Tab, and F1-F12 for a row of this tab; both taken by the window while it is up. */
  key(k) {
    if (k === 'Tab') { if (this.expanded) this.tab = (this.tab + 1) % 3; sfx.play('UI/Tab'); this.selectTab(this.tab); return true; }
    const m = /^F(\d+)$/.exec(k), n = m ? Number(m[1]) : 0;
    if (n < 1 || n > 12) return false;
    const row = this.rows[this.tab].find((r) => r.vkey === n);
    if (row) { this.sel = row.index; sfx.play('UI/Tab'); this.selectTab(this.tab); this.send(); }
    return true;
  }
  tick(ms = 16) {
    this.acc += ms;
    while (this.acc >= 30) {
      this.acc -= 30;
      if (!this.lock && this.expanded) { this.timer -= FOLD_STEP; if (this.timer < 0) this.fold(); }
    }
    if (this.side) { this.side.x = this.x + 157; this.side.y = this.y; }
  }
  tabRects() {
    let x = TAB_AT[0];
    return [0, 1, 2].map((i) => { const n = this.M.Tab.enabled[i], r = { x, y: TAB_AT[1], w: n?._w || 21, h: n?._h || 12 }; x += r.w + TAB_GAP; return r; });
  }
  rowAt(lx, ly) {
    const px = lx - 6, py = ly - LIST_Y;
    return this.rows[this.tab].slice(0, MAX_ROWS).find((r, k) => { const y = ROW0 + k * ROW_H; return px >= 0 && px < 138 && py >= y - 1 && py < y + 12; }) || null;
  }
  lockRect() { const r = this.count; return { x: 9, y: 162 + ROW_H * r, w: 10, h: 12 }; }
  down(lx, ly) {
    const tab = this.tabRects().findIndex((r) => lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h);
    if (tab >= 0) { this.selectTab(tab); return; }
    if (!this.expanded) { this.sel = 0; this.relayout(); return; }
    const L = this.lockRect();
    if (lx >= L.x && lx < L.x + L.w && ly >= L.y && ly < L.y + L.h) { this.lock = !this.lock; this.timer = FOLD_MS; return; }
    const row = this.rowAt(lx, ly);
    this.sel = row ? row.index : 0;
    if (row) this.timer = FOLD_MS;
    this.relayout();
  }
  dblclick(lx, ly) { const row = this.expanded && this.rowAt(lx, ly); if (row) { this.sel = row.index; this.send(); } }
  tooltip(lx, ly) {
    for (let i = 0; i < 3; i++) {
      const [x, y] = CP_TIPS[i];
      if (lx >= x && lx < 139 && ly >= y && ly < y + 10) {
        const v = i === 0 ? this.mine : this.teams[i === 1 ? this.myTeam : 1 - this.myTeam];
        return lineTip(`${CP_TEXT[i][0]}\n${CP_TEXT[i][1].replace('%d', v[0]).replace('%d', v[1])}`);
      }
    }
    if (this.expanded) {
      const L = this.lockRect();
      if (lx >= L.x && lx < L.x + L.w && ly >= L.y && ly < L.y + L.h) return lineTip(this.lock ? 'Automatic lock enabled.' : 'Automatic lock disabled.');
      const row = this.rowAt(lx, ly);
      if (row?.desc) { this.timer = FOLD_MS; return lineTip(row.desc); }
    }
    return null;
  }
  draw(ctx) {
    ctx.save(); ctx.translate(this.x, this.y);
    const im = (n) => this.mgr.image(n), M = this.M;
    if (this.expanded) { const t = im(M.backgrnd3?.top?.[0]); if (t) ctx.drawImage(t, TOP_AT[0], TOP_AT[1]); }
    const bg = im(M.backgrnd); if (bg) ctx.drawImage(bg, 0, 0);
    const other = 1 - this.myTeam, vals = [this.mine, this.teams[this.myTeam], this.teams[other]];
    vals.forEach((v, i) => uiText(ctx, `${v[0]} / ${v[1]}`, CP_AT[i][0], CP_AT[i][1], { color: BLACK, size: FONT }));
    [this.myTeam, other].forEach((t, i) => { const s = im(M[`icon${t}`]); if (s) ctx.drawImage(s, STAR_AT[i][0], STAR_AT[i][1]); });
    this.tabRects().forEach((r, i) => { const n = im(M.Tab?.[i === this.tab ? 'enabled' : 'disabled']?.[i]); if (n) ctx.drawImage(n, r.x, r.y); });
    if (this.expanded) this.drawList(ctx);
    for (const b of this.buttons) b.draw(ctx, this.mgr.assets);
    ctx.restore();
  }
  drawList(ctx) {
    const im = (n) => this.mgr.image(n), M = this.M.backgrnd3, rows = this.rows[this.tab].slice(0, MAX_ROWS);
    rows.forEach((r, k) => {
      const y = LIST_Y + ROW0 + k * ROW_H, mid = im(M?.middle1?.[0]);
      if (mid) ctx.drawImage(mid, 0, y - 1);
      const on = this.sel === r.index, color = on ? WHITE : BLACK;
      if (on) { ctx.fillStyle = SEL_FILL; ctx.fillRect(5, y - 1, 133, ROW_H); }
      uiText(ctx, cut(ctx, r.name), 10, y, { color, size: FONT });
      const cp = String(r.cp);
      uiText(ctx, cp, 101 - 5 * cp.length, y, { color, size: FONT });
      uiText(ctx, r.key, 116, y, { color, size: FONT });
    });
    const head = im(M?.middle0?.[0]); if (head) ctx.drawImage(head, 0, LIST_Y);
    const foot = im(M?.bottom?.[0]); if (foot) ctx.drawImage(foot, 0, LIST_Y + ROW_H * rows.length + 19);
    const L = this.lockRect(), lock = im(this.M[this.lock ? 'icon2' : 'icon3']);
    if (lock) ctx.drawImage(lock, L.x, L.y);
    this.scrollbar(ctx, 142, LIST_Y, ROW_H * rows.length + 19, 0, this.rows[this.tab].length, MAX_ROWS, this.mgr.B.VScr4);
  }
}

/** The Summon List beside the Carnival window: five rows from y 27, the name (cut at 70px) at x 14, the count at x 90. */
class CarnivalSideWin extends Win {
  constructor(mgr, main) {
    super(mgr, main.M.backgrnd2, main.x + 157, main.y);
    this.buttons = []; this.closeBtn = null; this.main = main; this.first = 0; this.dragH = 0;
  }
  scrollTo(i) { const n = this.main.summons.length, max = n > 5 ? n - 5 : 0; this.first = Math.max(0, Math.min(max, i < 0 ? max : i)); }
  wheel(dy) { const n = this.main.summons.length; this.first = Math.max(0, Math.min(n > 5 ? n - 5 : 0, this.first + Math.sign(dy))); }
  body(ctx) {
    const list = this.main.summons.slice(this.first, this.first + 5);
    list.forEach((s, k) => {
      const y = 27 + k * ROW_H, on = s.name === this.main.last, color = on ? WHITE : BLACK;
      if (on) { ctx.fillStyle = SEL_FILL; ctx.fillRect(9, y - 1, 95, ROW_H); }
      uiText(ctx, cut(ctx, s.name), 14, y, { color, size: FONT });
      uiText(ctx, String(s.count), 90, y, { color, size: FONT });
    });
    this.scrollbar(ctx, 107, 8, 92, this.first, this.main.summons.length, 5, this.mgr.B.VScr4);
  }
}
