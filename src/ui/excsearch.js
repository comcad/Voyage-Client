import { itemInfo } from '../data.js';
import { TextField } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { UI_W } from '../view.js';

/**
 * The pet's item ignore list, its REGISTER: UIWindow.img/ExceptionItemSearch.
 *   ExcSearchWin (backgrnd, 217x123) opens on the list's top-left corner: its close box at (195, 8), an edit box (the
 *   art's at x 13-132, y 76-92) and BtSearch beside it (both placed by the art: their places are not known). A
 *   search (BtSearch or Enter) opens the results under it, at (x, y + 120), which follow it when it moves.
 *   ExcResultWin (resultback, 162x117): five rows of names (Arial 12, black) at x 10, y 12 + 14k, the picked one on
 *   #5b7b9e and the one under the mouse on #bbc9d9, a VScr4 at (142, 8), 75 long; BtSave (49, 94; its y is the
 *   art's) adds the picked item to the list, BtDelete (82, 94) takes it off. A row's item shows its tooltip.
 * The search: the words without spaces, ignoring case, anywhere in an item's name (String Eqp, Consume, Ins, Cash, Pet
 * and Etc, in that order, names without spaces), of the items that have info, aren't quest or party quest items nor
 * cash, can be traded (scanTradeBlock, tradeAvailable, or no tradeBlock) and aren't among the ids the client never
 * lists. The names match at once; each is listed once its info has come.
 */
const EXC_FILES = ['Eqp', 'Consume', 'Ins', 'Cash', 'Pet', 'Etc'];
const RESULT_ROWS = 5, SEL = '#5b7b9e', HOVER = '#bbc9d9';
let excIndex = null;

/** Every item name, spaces taken out and lower-cased, in the String files' order: [[id, name]...]. */
function itemIndex(assets) {
  excIndex ??= Promise.all(EXC_FILES.map((f) => assets.json(`String/${f}.img`))).then((files) => {
    const out = [];
    const walk = (node) => {
      for (const [k, v] of Object.entries(node || {})) {
        if (!v || typeof v !== 'object') continue;
        if (/^\d+$/.test(k)) { if (typeof v.name === 'string') out.push([Number(k), v.name.replace(/ /g, '').toLowerCase()]); }
        else walk(v);
      }
    };
    files.forEach(walk);
    return out;
  });
  return excIndex;
}
/** The ids the search never lists: 911xxxx, 5430xxx, 555xxxx, 501xxxx, 502xxxx, 516xxxx, 5110000, 11120xx, 11128xx. */
const neverListed = (id) => {
  const t = Math.floor(id / 10000), h = Math.floor(id / 100);
  return t === 911 || Math.floor(id / 1000) === 5430 || [555, 501, 502, 516].includes(t) || id === 5110000 || h === 11120 || h === 11128;
};
const num = (v) => Number(v) || 0;
const listable = (info) => !!info && !num(info.quest) && !num(info.pquest) && (num(info.scanTradeBlock) || num(info.tradeAvailable) || !num(info.tradeBlock)) && !num(info.cash);

export class ExcSearchWin extends Win {
  constructor(mgr, owner, x, y) {
    const E = mgr.W.ExceptionItemSearch;
    super(mgr, E.backgrnd, x, y);
    this.E = E; this.owner = owner;
    this.closeBtn.x = 195; this.closeBtn.y = 8; this.closePinned = true;
    this.button(E.BtSearch, 141, 76, () => this.search());
    const f = new TextField(mgr.game.statusBar.layer, 15, 0, 116, 15, { max: 256, color: '#000' });
    f.rect.x0 = 15;
    f.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.search(); }
      else if (e.key === 'Escape') f.el.blur();
    });
    f.show(false);
    this.field = f;
  }
  frames() { return [...super.frames(), ...allCanvases(this.E)]; }
  onOpen() { this.field.show(true); setTimeout(() => this.field.el.focus(), 0); }
  onClose() {
    this.field.show(false); this.field.el.blur();
    if (this.result) { this.mgr.close(this.result); this.result = null; }
    if (this.owner.search === this) this.owner.search = null;
  }
  /** BtSearch / Enter: the results window (a new one each time) under this one. */
  search() {
    const q = this.field.value.trim().toLowerCase().replace(/ /g, '');
    if (this.result) this.mgr.close(this.result);
    const r = this.result = new ExcResultWin(this.mgr, this, q);
    this.mgr.assets.preload(r.frames()).then(() => { if (this.result === r && this.mgr.order.includes(this)) this.mgr.show(r, null); });
  }
  draw(ctx) {
    if (!this.opened) { this.opened = true; this.onOpen(); }   // shown, not opened by name: its edit box comes with its first frame
    super.draw(ctx);
    if (this.result) { this.result.x = this.x; this.result.y = this.y + 120; }
    const f = this.field, scale = this.g.canvas.clientWidth / UI_W;
    f.rect.x = this.x + f.rect.x0; f.rect.y = this.y + 77; f.layout({ left: 0, top: 0 }, scale);
  }
}

export class ExcResultWin extends Win {
  constructor(mgr, search, query) {
    const E = mgr.W.ExceptionItemSearch;
    super(mgr, E.resultback, search.x, search.y + 120);
    this.E = E; this.search = search; this.owner = search.owner;
    this.closeBtn.visible = false;
    this.rows = []; this.first = 0; this.sel = -1;
    this.button(E.BtSave, 49, 94, () => { const id = this.rows[this.sel]; if (id !== undefined) this.owner.addExcluded(id); });
    this.button(E.BtDelete, 82, 94, () => { const id = this.rows[this.sel]; if (id !== undefined) this.owner.removeExcluded(id); });
    if (query) this.find(query);
  }
  frames() { return [...super.frames(), ...allCanvases(this.E), ...allCanvases(this.mgr.B.VScr4)]; }
  /** The names that match, then each listed once its info says it may be. */
  async find(q) {
    const hits = (await itemIndex(this.g.assets)).filter(([id, name]) => !neverListed(id) && name.includes(q)).map(([id]) => id);
    this.pending = hits;
    const ok = new Map();
    let next = 0;
    const work = async () => {
      while (next < hits.length && this.pending === hits) {
        const id = hits[next++];
        ok.set(id, listable(await itemInfo(this.g.assets, id)));
        // in the names' order, as far as every earlier one has come
        const rows = [];
        for (const h of hits) { if (!ok.has(h)) break; if (ok.get(h)) rows.push(h); }
        if (rows.length > this.rows.length) this.rows = rows;
      }
    };
    await Promise.all(Array.from({ length: 6 }, work));
  }
  onClose() { this.pending = null; if (this.search.result === this) this.search.result = null; }
  rowAt(lx, ly) {
    if (lx < 0 || lx >= 138 || ly < 12) return -1;
    const k = Math.floor((ly - 12) / 14), i = this.first + k;
    return k < RESULT_ROWS && i < this.rows.length ? i : -1;
  }
  body(ctx) {
    const m = this.mgr.mouse, hover = this.rowAt(m.x - this.x, m.y - this.y);
    for (let k = 0; k < RESULT_ROWS; k++) {
      const i = this.first + k, id = this.rows[i];
      if (id === undefined) break;
      if (i === this.sel || i === hover) { ctx.fillStyle = i === this.sel ? SEL : HOVER; ctx.fillRect(10, 12 + k * 14, 128, 13); }
      this.text(ctx, (this.mgr.itemName(id) || '').trim(), 10, 12 + k * 14, { size: 12 });
    }
    this.scrollbar(ctx, 142, 8, 75, this.first, this.rows.length, RESULT_ROWS, this.mgr.B.VScr4);
  }
  down(lx, ly) {
    const s = this.scrollClick(lx, ly, 142, 8, 75, this.first, this.rows.length, RESULT_ROWS, this.mgr.B.VScr4);
    if (s !== null) { this.first = s; return; }
    const i = this.rowAt(lx, ly);
    if (i >= 0) this.sel = i;
  }
  wheel(dy) { this.first = Math.max(0, Math.min(this.rows.length - RESULT_ROWS, this.first + Math.sign(dy))); }
  tooltip(lx, ly) { const i = this.rowAt(lx, ly); return i >= 0 ? { item: { id: this.rows[i] } } : null; }
}
