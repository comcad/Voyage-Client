import { pad } from '../assets.js';
import { invType } from '../data.js';
import { drawParts } from '../character.js';
import { nameTag } from '../map.js';
import { sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';

/**
 * The storage (UI/UIWindow.img/Trunk, 463x318). Measured from backgrnd:
 *   left panel = the storage, right panel = your inventory; headers y 5-83 with shadows where the
 *     keeper (x 52) and you (x 282) stand, feet at y 76; a pair of guide dots marks each button column
 *     (x 163-212 at y 56 on the left, x 393-442 at y 36 on the right)
 *   storage list: 5 rows of 35px every 40 from y 87, icon cell x 6-40, text x 43-204 (Trunk/select, 162x35)
 *   your side: tab strip y 84-115 over a red rule, then 4 rows every 40 from y 127, icon x 236-270, text x 273-434
 *   scrollbars x 211 / 442; meso boxes x 43-194 / 274-424, y 296-309, with room for a coin button at their left
 */
const ROW_H = 40, LEFT = { rows: 5, y: 87, icon: 7, text: 43, bar: 211 }, RIGHT = { rows: 4, y: 127, icon: 237, text: 273, bar: 442 };
const TABS = [1, 2, 3, 4, 5];
/** StorageProcessor / getStorageError codes */
const ERRORS = { 0x0A: 'Please check if your inventory is full or not.', 0x0B: 'You do not have enough mesos.',
  0x0C: 'You can only hold one of that item.', 0x11: 'The storage is full.' };

export class StorageWin extends Win {
  constructor(mgr, s) {
    const T = mgr.W.Trunk;
    super(mgr, T.backgrnd, Math.round((800 - 463) / 2), 60);
    this.buttons = [];
    this.T = T; this.npc = s.npc; this.slots = s.slots; this.meso = s.meso;
    this.tab = 1; this.first = [0, 0]; this.sel = [-1, -1];
    this.setAll(s.items);
    // buttons sit centred on each column of guide dots
    this.button(T.BtGet, 152, 34, () => this.takeOut());
    this.button(T.BtSort, 152, 60, () => this.g.net?.storageArrange());
    this.button(T.BtPut, 382, 14, () => this.store());
    this.button(T.BtExit, 382, 40, () => this.close());
    this.button(T.BtOutCoin, 5, 293, () => this.mesoOut());
    this.button(T.BtInCoin, 235, 293, () => this.mesoIn());
    mgr.assets.json(`Npc/${pad(s.npc, 7)}.img`).then(async (n) => {
      if (n?.info?.link) n = (await mgr.assets.json(`Npc/${pad(n.info.link, 7)}.img`)) || n;
      const st = n?.stand?.[0] || n?.stand;
      if (st?._canvas) { await mgr.assets.preload([st]); this.face = st; }
    });
  }
  frames() { return [...super.frames(), this.T.select, ...allCanvases(this.T.Tab)]; }

  // ---------------------------------------------------------------- server state
  /**
   * The server answers a take-out with an index into typeItems[type], which it fills with the WHOLE
   * list when the storage opens or is arranged, and with just that type's items after a store or a
   * take-out. Keep the same lists so the index we send picks the item we mean.
   */
  setAll(items) { this.items = items; this.typeItems = Object.fromEntries(TABS.map((t) => [t, items])); this.fix(); }
  setType(type, items) {
    this.typeItems[type] = items;
    this.items = [...this.items.filter((it) => invType(it.id) !== type), ...items].sort((a, b) => invType(a.id) - invType(b.id));
    this.fix();
  }
  setMeso(meso) { this.meso = meso; }
  fix() {
    this.sel[0] = Math.min(this.sel[0], this.items.length - 1);
    this.first[0] = Math.max(0, Math.min(this.first[0], this.items.length - LEFT.rows));
  }
  error(code) { this.mgr.notice(ERRORS[code] || 'The storage request could not be completed.'); }

  // ---------------------------------------------------------------- your actions
  mine() {
    const inv = this.g.inventory?.[this.tab] || {};
    return Object.entries(inv).map(([pos, it]) => ({ pos: Number(pos), it })).sort((a, b) => a.pos - b.pos);
  }
  takeOut(idx = this.sel[0]) {
    const it = this.items[idx];
    if (!it) return;
    const type = invType(it.id), slot = this.typeItems[type].indexOf(it);
    if (slot >= 0) this.g.net?.storageTakeOut(type, slot);
  }
  async store(idx = this.sel[1]) {
    const row = this.mine()[idx];
    if (row) this.storeItem(this.tab, row.pos);
  }
  async storeItem(tab, pos) {
    const it = this.g.inventory?.[tab]?.[pos];
    if (!it) return;
    if (this.items.length >= this.slots) { this.error(0x11); return; }
    let qty = 1;
    if (tab !== 1 && it.quantity > 1 && !isRechargeable(it.id)) {
      qty = await this.mgr.askNumber(`How many #t${it.id}# will you store?\n(1 ~ ${it.quantity})`, it.quantity, 1, it.quantity);
      if (!qty) return;
    } else if (!(await this.mgr.confirm(`Are you sure you want to store #t${it.id}#?`))) return;
    this.g.net?.storageStore(pos, it.id, isRechargeable(it.id) ? it.quantity : qty);
  }
  // mesos: a positive amount comes out of the storage, a negative one goes in
  async mesoOut() {
    if (!this.meso) return;
    const v = await this.mgr.askNumber(`How many mesos will you take out?\n(1 ~ ${this.meso.toLocaleString('en-US')})`, this.meso, 1, this.meso);
    if (v) this.g.net?.storageMeso(v);
  }
  async mesoIn() {
    const max = this.g.meso || 0;
    if (!max) return;
    const v = await this.mgr.askNumber(`How many mesos will you store?\n(1 ~ ${max.toLocaleString('en-US')})`, max, 1, max);
    if (v) this.g.net?.storageMeso(-v);
  }
  close() { this.mgr.close(this); this.g.net?.storageClose(); this.g.storageWin = null; }
  key(e) { if (e.key === 'Escape') this.close(); }
  drop(lx, ly, c) { if (c.kind === 'item' && typeof c.tab === 'number') this.storeItem(c.tab, c.slot); }

  // ---------------------------------------------------------------- frame
  rowAt(lx, ly, side) {
    const L = side ? RIGHT : LEFT, x0 = L.icon - 1;
    if (lx < x0 || lx >= L.bar || ly < L.y) return -1;
    const i = Math.floor((ly - L.y) / ROW_H);
    if (i >= L.rows || (ly - L.y) % ROW_H >= 35) return -1;
    const idx = this.first[side] + i;
    return idx < (side ? this.mine().length : this.items.length) ? idx : -1;
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), g = this.g;
    const face = im(this.face);
    if (face) { const o = this.face.origin || [face.width / 2, face.height]; ctx.drawImage(face, Math.round(52 - o[0]), Math.round(76 - o[1])); }
    if (g.look) drawParts(ctx, m.assets, g.look.compose(g.look.standAction(), 0), 282, 76, false);
    const npcName = m.strings.npc?.[this.npc]?.name;
    if (npcName) nameTag(ctx, npcName, 52, 78, '#fff');
    nameTag(ctx, g.player.name, 282, 78, '#fff');
    this.text(ctx, `${this.items.length} / ${this.slots}`, 187, 14, { align: 'center', bold: true });
    // your tabs: Equip / Use / Set-up / Etc / Cash. Both label sets are plain white, so the chosen tab
    // gets a dark box behind it and the others are dimmed
    let tx = 244;
    TABS.forEach((t, i) => {
      const on = t === this.tab, ti = im(this.T.Tab[on ? 'enabled' : 'disabled'][i]);
      if (!ti) return;
      if (on) { ctx.fillStyle = 'rgba(40,70,120,0.75)'; ctx.fillRect(tx - 5, 92, ti.width + 10, 22); }
      ctx.globalAlpha = on ? 1 : 0.55; ctx.drawImage(ti, tx, 98); ctx.globalAlpha = 1;
      this[`tabX${t}`] = [tx, ti.width]; tx += ti.width + 14;
    });
    // the storage, then your items
    this.list(ctx, LEFT, 0, this.items.map((it) => ({ it })));
    this.list(ctx, RIGHT, 1, this.mine());
    this.text(ctx, this.meso.toLocaleString('en-US'), 192, 297, { align: 'right' });
    this.text(ctx, (g.meso || 0).toLocaleString('en-US'), 422, 297, { align: 'right' });
  }
  list(ctx, L, side, rows) {
    const m = this.mgr;
    for (let i = 0; i < L.rows; i++) {
      const idx = this.first[side] + i, r = rows[idx];
      if (!r) break;
      const y = L.y + i * ROW_H;
      if (idx === this.sel[side]) { const s = m.image(this.T.select); if (s) ctx.drawImage(s, L.text, y); }
      m.drawIcon(ctx, m.icon(r.it.id), L.icon, y + 1);
      if (invType(r.it.id) !== 1 && r.it.quantity > 1) m.count(ctx, r.it.quantity, L.icon, y + 22);
      this.text(ctx, m.itemName(r.it.id), L.text + 4, y + 11, { bold: true });
    }
    this.scrollbar(ctx, L.bar, L.y, L.rows * ROW_H - 5, this.first[side], rows.length, L.rows);
  }
  down(lx, ly) {
    for (const t of TABS) {
      const tx = this[`tabX${t}`];
      if (tx && lx >= tx[0] - 6 && lx < tx[0] + tx[1] + 6 && ly >= 88 && ly < 116) { this.tab = t; this.first[1] = 0; this.sel[1] = -1; sfx.play('UI/Tab'); return; }
    }
    for (const side of [0, 1]) {
      const L = side ? RIGHT : LEFT, n = side ? this.mine().length : this.items.length;
      const s = this.scrollClick(lx, ly, L.bar, L.y, L.rows * ROW_H - 5, this.first[side], n, L.rows);
      if (s !== null) { this.first[side] = s; return; }
      const r = this.rowAt(lx, ly, side);
      if (r >= 0) { this.sel[side] = r; return; }
    }
  }
  dblclick(lx, ly) {
    const l = this.rowAt(lx, ly, 0);
    if (l >= 0) { this.sel[0] = l; this.takeOut(l); return; }
    const r = this.rowAt(lx, ly, 1);
    if (r >= 0) { this.sel[1] = r; this.store(r); }
  }
  wheel(dy) {
    const side = this.mgr.mouse.x - this.x < 230 ? 0 : 1, L = side ? RIGHT : LEFT;
    const n = side ? this.mine().length : this.items.length;
    this.first[side] = Math.max(0, Math.min(n - L.rows, this.first[side] + Math.sign(dy)));
  }
  tooltip(lx, ly) {
    const l = this.rowAt(lx, ly, 0);
    if (l >= 0 && lx < LEFT.text) return { item: this.items[l] };
    const r = this.rowAt(lx, ly, 1);
    if (r >= 0 && lx < RIGHT.text) return { item: this.mine()[r].it };
    return null;
  }
}
const isRechargeable = (id) => [207, 233].includes(Math.floor(id / 10000));
