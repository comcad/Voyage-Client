import { sfx } from '../audio.js';
import { itemInfo } from '../data.js';
import { TextField, uiText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W, UI_H } from '../view.js';

const PANEL_X = 243, HOVER = '#bbc9d9', PICKED = '#5b7b9e';
const centred = (w, h) => [Math.round((UI_W - w) / 2), Math.round((UI_H - h) / 2)];
const clip = (ctx, t, w) => {
  t = String(t ?? '');
  if (ctx.measureText(t).width <= w) return t;
  while (t.length && ctx.measureText(`${t}..`).width > w) t = t.slice(0, -1);
  return `${t}..`;
};
const withFont = (ctx, font, fn) => { ctx.save(); ctx.font = font; const r = fn(); ctx.restore(); return r; };
const ASC = 'Show 200 results in ascending order', DESC = 'Show 200 results in descending order';

// the category tree: labels, and the id ranges each leaf searches ([from, to], second range or null)
const EQP = ['HAT', 'EARRING', 'TOP', 'BOTTOM', 'Overall Armor', 'GLOVE', 'SHOES', 'SHIELD', 'CAPE', 'One-handed Weapon', 'Two-handed Weapon'];
const EQP_CAT = [100, 103, 104, 106, 105, 108, 107, 109, 110];
const USE = ['Potion', 'Return Scroll', 'Weapon & Armor Scroll', 'Arrow, Throwing Stars, and Bullets', 'Summon'];
const ETC = ['Dropping', 'Ore', 'Game', 'Stimulator & How to Make'];
const ONE = [' ONE-HANDED SWORD', ' ONE-HANDED AXE', ' ONE_HANDED MACE', ' DAGGER', ' WAND', ' STAFF'], ONE_CAT = [130, 131, 132, 133, 137, 138];
const TWO = [' TWO-HANDED SWORD', ' TWO-HANDED AXE', ' TWO-HANDED MACE', ' SPEAR', ' POLE ARM', ' BOW', ' CROSSBOW', ' CLAW', 'KNUCKLE', 'GUN'];
const block = (n) => [n * 10000, n * 10000 + 9999];
const USE_RANGES = [[[2000000, 2029999], block(205)], [block(203), null], [block(204), null], [[2060000, 2079999], block(233)], [[2100000, 2100000], null]];
const ETC_RANGES = [[[4000000, 4003999], null], [[4005000, 4019999], null], [block(408), null], [block(413), null]];

/** Every item's name (spaces taken out), in the String files' order: Eqp, Consume, Ins, Cash, Pet, Etc. */
let TABLE = null;
async function itemTable(assets) {
  if (TABLE) return TABLE;
  const out = [];
  const add = (obj) => { for (const [id, v] of Object.entries(obj || {})) if (/^\d+$/.test(id) && v?.name != null) out.push({ id: Number(id), name: String(v.name).replace(/ /g, ''), raw: String(v.name) }); };
  const eqp = (await assets.json('String/Eqp.img'))?.Eqp || {};
  for (const cat of Object.values(eqp)) add(cat);
  for (const f of ['Consume', 'Ins', 'Cash', 'Pet']) add(await assets.json(`String/${f}.img`));
  add((await assets.json('String/Etc.img'))?.Etc);
  TABLE = out;
  return out;
}

/**
 * The Owl of Minerva's item search (UIWindow.img/itemSearch/backgrnd, 248x271, centred). Opening sends OWL_ACTION 5;
 * the server's SHOP_SCANNER_RESULT 7 fills TOP 10. A search box (18, 78) with BtSearch (175, 76), BtGo (185, 220)
 * for the top 10 and BtGo (185, 243) for the categories, Basic BtClose (229, 8). One side panel at a time
 * (categoryback, 270x271) slides out 243px to the right at 1px a millisecond. Picking an item asks, then sends the
 * search with the item and the SORT BY PRICE box and closes.
 */
export class OwlWin extends Win {
  constructor(mgr, use) {
    const S = mgr.W.itemSearch;
    super(mgr, S.backgrnd, ...centred(248, 271));
    this.S = S; this.use = use; this.popular = [];
    this.closeBtn.visible = false;
    this.button(S.BtGo, 185, 220, () => this.toggle(1));
    this.button(S.BtGo, 185, 243, () => this.toggle(2));
    this.button(S.BtSearch, 175, 76, () => this.searchText());
    this.button(mgr.B.BtClose, 229, 8, () => this.close());
    this.field = new TextField(this.g.statusBar.layer, 0, 0, 150, 13, { max: 256, color: '#000' });
    this.field.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.searchText(); else if (e.key === 'Escape') this.close();
    });
    this.panel = null; this.off = 0; this.slide = null;
    // the panels' own buttons (placed each frame where the panel is)
    const pb = (art, x, y, fn) => { const b = this.button(art, 0, 0, fn); b.px = x; b.py = y; b.visible = false; return b; };
    this.hide = pb(mgr.B.BtHide, 245, 7, () => this.show(0));
    this.left = pb(S.BtLeft, 230, 252, () => this.page(-1));
    this.right = pb(S.BtRight, 245, 252, () => this.page(1));
    this.find = pb(S.BtSearch, 180, 249, () => this.pickList());
    this.checks = { 1: false, 3: false };
    this.sel = -1; this.hover = -1; this.pg = 0; this.tree = 0; this.mode = 0; this.needle = ''; this.ranges = null;
    this.matches = []; this.walked = 0; this.done = false;
  }
  frames() { const S = this.S; return [...super.frames(), S.categoryback, S.icon0, S.BtRight?.normal?.[0], this.mgr.B.CheckBox?.[0], this.mgr.B.CheckBox?.[1]].filter(Boolean); }
  onOpen() { this.g.net?.owlAction(5); setTimeout(() => this.field.focus(), 0); }
  onClose() { this.field.remove(); if (this.g.owlWin === this) this.g.owlWin = null; }
  close() { sfx.play('UI/MenuUp'); this.mgr.close(this); }
  key(e) { if (e.key === 'Escape') this.close(); }
  setPopular(ids) { this.popular = ids; }
  contains(x, y) {
    const lx = x - this.x, ly = y - this.y;
    return ly >= 0 && ly < 271 && ((lx >= 0 && lx < 248) || (this.panel && lx >= this.off && lx < this.off + 270));
  }
  /** Show panel n (0 hides): 1 top 10, 2 categories, 3 the items found. */
  show(n) {
    if (n === this.panel) return;
    this.panel = n || null; this.sel = -1; this.hover = -1; this.pg = 0;
    this.slide = { from: n ? 0 : this.off, to: n ? PANEL_X : 0, at: performance.now() };
    if (n === 1) { this.left.enabled = false; this.right.enabled = true; }
    if (n === 3) this.rebuild();
  }
  toggle(n) { this.show(this.panel ? 0 : n); }
  searchText() {
    const t = this.field.value;
    if (!t) return;
    this.needle = t.replace(/ /g, '').toUpperCase(); this.mode = 0;
    if (this.panel !== 3) this.show(3); else this.rebuild();
  }
  /** The items the search or category matches, found as far as `n` (an item counts once its info loads). */
  async ensure(n) {
    const table = await itemTable(this.g.assets);
    while (this.matches.length < n && this.walked < table.length) {
      const e = table[this.walked++];
      const ok = this.mode === 0 ? e.name.toUpperCase().includes(this.needle)
        : this.ranges.some((r) => r && e.id >= r[0] && e.id <= r[1]);
      if (ok && (await itemInfo(this.g.assets, e.id))) this.matches.push(e);
    }
    this.done = this.walked >= table.length;
  }
  async rebuild() {
    const seq = (this.seq = (this.seq || 0) + 1);
    this.matches = []; this.walked = 0; this.done = false; this.pg = 0; this.sel = -1;
    this.left.enabled = false; this.right.enabled = false; this.find.enabled = false;
    await this.ensure(11);
    if (seq === this.seq) this.right.enabled = this.matches.length > 10;
  }
  async page(d) {
    if (this.panel === 1) {
      this.pg = d > 0 ? 1 : 0; this.left.enabled = this.pg === 1; this.right.enabled = this.pg === 0; this.sel = -1;
      return;
    }
    const p = Math.max(0, this.pg + d);
    await this.ensure((p + 1) * 10 + 1);
    if (p * 10 >= this.matches.length) return;
    this.pg = p; this.sel = -1; this.find.enabled = false;
    this.left.enabled = p > 0; this.right.enabled = this.matches.length > (p + 1) * 10;
  }
  rows() {
    if (this.panel === 1) return this.popular.slice(0, 10).slice(this.pg * 5, this.pg * 5 + 5).map((id) => ({ id }));
    if (this.panel === 3) return this.matches.slice(this.pg * 10, this.pg * 10 + 10);
    return [];
  }
  rowAt(lx, ly) {
    const x = lx - this.off;
    if (this.panel === 1) { const r = Math.floor((ly - 40) / 40); return x >= 20 && x <= 255 && ly >= 40 && r < this.rows().length ? r : -1; }
    if (this.panel === 3) { const r = Math.floor((ly - 43) / 20); return x >= 20 && x <= 255 && ly >= 43 && r < this.rows().length ? r : -1; }
    return -1;
  }
  move(lx, ly) { this.hover = this.rowAt(lx, ly); }
  tooltip(lx, ly) { const r = this.rowAt(lx, ly), row = r >= 0 && this.rows()[r]; return row ? { item: { id: row.id } } : null; }
  down(lx, ly) {
    if (this.panel === 2 && lx >= this.off) { this.treeClick(ly); return; }
    if (this.panel === 1 || this.panel === 3) {
      const x = lx - this.off;
      if (x >= 16 && x < 126 && ly >= 249 && ly < 263) { this.checks[this.panel] = !this.checks[this.panel]; return; }
      const r = this.rowAt(lx, ly);
      if (r >= 0) { this.sel = r; if (this.panel === 3) this.find.enabled = true; }
    }
  }
  dblclick(lx, ly) {
    const r = this.rowAt(lx, ly);
    if (r >= 0) { this.sel = r; this.confirm(this.rows()[r].id); }
  }
  pickList() { const row = this.sel >= 0 && this.rows()[this.sel]; if (row) this.confirm(row.id); }
  /** The tree's clicks: rows 13px apart from y 40 (x doesn't matter). */
  treeClick(ly) {
    const r = Math.trunc((ly - 40) / 13), s = this.tree;
    const kU = { 1: 11, 4: 7, 5: 11 }[s] || 0, kE = { 1: 11, 2: 5, 4: 7, 5: 11 }[s] || 0, kS = { 1: 11, 2: 5, 3: 4, 4: 7, 5: 11 }[s] || 0;
    this.ranges = null;
    if (r === 0) { this.tree = s === 4 ? 0 : 1; return; }
    if (r === kU + 1) { this.tree = 2; return; }
    if (r === kE + 2) { this.tree = 3; return; }
    if (r === kS + 3) { this.tree = 0; this.pick([block(399), null]); return; }
    if (s === 1 && r === 10) { this.tree = 4; return; }
    if (s === 1 && r === 11) { this.tree = 5; return; }
    if (s === 1 && r >= 1 && r <= 9) this.pick([block(EQP_CAT[r - 1]), null]);
    else if (s === 4 && r >= 1 && r <= 6) this.pick([block(ONE_CAT[r - 1]), null]);
    else if (s === 5 && r >= 1 && r <= 10) this.pick([block(140 + r - 1), null]);
    else if (s === 2 && r >= 2 && r <= 6) this.pick(USE_RANGES[r - 2]);
    else if (s === 3 && r >= 3 && r <= 6) this.pick(ETC_RANGES[r - 3]);
  }
  pick(ranges) { this.ranges = ranges; this.mode = 1; this.panel = null; this.show(3); }
  async confirm(id) {
    const desc = this.panel === 3 && this.checks[3];
    const sortText = this.panel === 3 ? (desc ? DESC : ASC) : ASC;
    const byte = this.panel === 1 ? this.checks[1] : desc;
    const name = this.mgr.itemName(id) || (await itemTable(this.g.assets)).find((e) => e.id === id)?.raw || '';
    if (!(await this.mgr.confirm(`Would you like to search for\r\n[${name}]?\r\nThe Owl of Minerva will disappear\r\n${sortText}\r\nif there's a search result after pressing OK.`))) return;
    if (this.g.canExclusive(500)) {
      const u = this.use;
      if (u.kind === 'cash') this.g.net?.useCashItem(u.slot, u.id, (w) => w.int(id).byte(byte ? 1 : 0));
      else this.g.net?.useOwlItem(u.slot, u.id, id, byte);
      this.g.lockExclusive();
    }
    this.close();
  }
  drawPanel(ctx) {
    const S = this.S, m = this.mgr, im = (n) => m.image(n), x0 = this.off;
    const bg = im(S.categoryback);
    if (bg) ctx.drawImage(bg, x0, 0);
    const font = '12px Arial';
    ctx.font = font;
    if (this.panel === 1 || this.panel === 3) {
      const rows = this.rows(), h = this.panel === 1 ? 40 : 20, top = this.panel === 1 ? 40 : 43;
      const fill = (r, c) => { if (r < 0 || r >= rows.length) return; ctx.fillStyle = c; ctx.fillRect(x0 + (this.panel === 1 ? 15 : 20), top + h * r, this.panel === 1 ? 250 : 235, h); };
      fill(this.hover, HOVER); fill(this.sel, PICKED);
      rows.forEach((row, r) => {
        const name = this.panel === 3 ? row.raw : this.mgr.itemName(row.id);
        if (this.panel === 1) {
          m.drawIcon(ctx, m.icon(row.id), x0 + 20, 48 + 40 * r, row.id);
          uiText(ctx, withFont(ctx, font, () => clip(ctx, name, 190)), x0 + 70, 58 + 40 * r, { color: '#000', size: 12 });
        } else {
          const b = im(S.icon0);
          if (b) ctx.drawImage(b, x0 + 20, 48 + 20 * r);
          uiText(ctx, withFont(ctx, font, () => clip(ctx, name, 218)), x0 + 32, 47 + 20 * r, { color: '#000', size: 12 });
        }
      });
      const cb = im(m.B.CheckBox?.[this.checks[this.panel] ? 1 : 0]);
      if (cb) ctx.drawImage(cb, x0 + 16, 249);
      uiText(ctx, 'SORT BY PRICE', x0 + 35, 249, { color: '#fff', size: 12, bold: true });
    }
    if (this.panel === 2) {
      const s = this.tree, arrow = im(S.BtRight?.normal?.[0]);
      const row = (t, x, y) => { if (arrow) ctx.drawImage(arrow, x0 + x - 15, y); uiText(ctx, t, x0 + x, y, { color: '#000', size: 12 }); };
      const kU = { 1: 11, 4: 7, 5: 11 }[s] || 0, kE = { 1: 11, 2: 5, 4: 7, 5: 11 }[s] || 0, kS = { 1: 11, 2: 5, 3: 4, 4: 7, 5: 11 }[s] || 0;
      row('Eqp', 30, 40);
      if (s !== 4 && s !== 5) { row('Use', 30, 53 + 13 * kU); row('Etc', 30, 66 + 13 * kE); row('Setup', 30, 79 + 13 * kS); }
      if (s === 1) EQP.forEach((t, i) => row(t, 50, 53 + 13 * i));
      if (s === 2) USE.forEach((t, i) => row(t, 50, 66 + 13 * i));
      if (s === 3) ETC.forEach((t, i) => row(t, 50, 79 + 13 * i));
      if (s === 4) { row('One-handed Weapon', 50, 53); ONE.forEach((t, i) => row(t, 125, 53 + 13 * i)); }
      if (s === 5) { row('Two-handed Weapon', 50, 53); TWO.forEach((t, i) => row(t, 125, 53 + 13 * i)); }
    }
  }
  draw(ctx) {
    if (this.slide) {
      const k = performance.now() - this.slide.at, { from, to } = this.slide;
      this.off = from < to ? Math.min(to, from + k) : Math.max(to, from - k);
      if (this.off === to) this.slide = null;
    }
    const shown = this.panel || this.slide;
    for (const b of [this.hide, this.left, this.right, this.find]) {
      b.visible = !!this.panel && (b === this.hide || (b !== this.find ? this.panel !== 2 : this.panel === 3));
      b.x = this.off + b.px; b.y = b.py;
    }
    ctx.save(); ctx.translate(this.x, this.y);
    if (shown) {
      this.drawPanel(ctx);
      for (const b of [this.hide, this.left, this.right, this.find]) if (b.visible) b.draw(ctx, this.mgr.assets);
    }
    ctx.restore();
    const panelBtns = new Set([this.hide, this.left, this.right, this.find]);
    ctx.save(); ctx.translate(this.x, this.y);
    const bg = this.mgr.image(this.bg);
    if (bg) ctx.drawImage(bg, 0, 0);
    for (const b of this.buttons) if (!panelBtns.has(b)) b.draw(ctx, this.mgr.assets);
    ctx.restore();
    this.field.rect.x = this.x + 18; this.field.rect.y = this.y + 78;
    this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
  }
}

const PRICE_COLORS = ['#007af4', '#00bdc4', '#629a00', '#ff5400', '#d022c2', '#a6006e'];
const priceColor = (p) => PRICE_COLORS[p < 1e5 ? 0 : p < 1e6 ? 1 : p < 1e7 ? 2 : p < 1e8 ? 3 : p < 1e9 ? 4 : 5];

/**
 * The search's results (itemSearch/resultback, 438x430, centred): "Search results for <item> that you entered.",
 * the total, the GO rule; eight rows from y 176 every 22px - owner (21), store (87), per bundle (to 180), price (to
 * 255, coloured by size), quantity (to 287), BtInfo (304), and GO (BtLink at (368, 175 + 22i)) for stores on your
 * channel, else "Store Closed" / "Can't Go" at 373. BtLeft (137, 368) / BtRight (289, 368), "[page/pages]" at
 * (205, 369), BtOK (190, 405). GO sends OWL_WARP (owner, map).
 */
export class OwlResultWin extends Win {
  constructor(mgr, d) {
    const S = mgr.W.itemSearch;
    super(mgr, S.resultback, ...centred(438, 430));
    this.S = S; this.d = d; this.dragH = 25; this.closeBtn.visible = false; this.pg = 0;
    this.rows = [...(d.npcPrice > 0 ? [{ owner: 'Gold Richie', npc: true, mapId: -1, ownerId: -1, title: '', bundles: 0, perBundle: 1, price: d.npcPrice, channel: -1 }] : []), ...d.rows];
    this.pages = Math.max(1, Math.ceil(this.rows.length / 8));
    this.button(S.BtOK, 190, 405, () => mgr.close(this));
    this.prev = this.button(S.BtLeft, 137, 368, () => this.turn(-1));
    this.next = this.button(S.BtRight, 289, 368, () => this.turn(1));
    this.links = Array.from({ length: 8 }, (_, i) => this.button(S.BtLink, 368, 175 + 22 * i, () => this.go(i)));
    this.relink();
  }
  frames() { return [...super.frames(), this.S.BtInfo]; }
  onClose() { if (this.g.owlResult === this) this.g.owlResult = null; }
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') this.mgr.close(this); }
  page() { return this.rows.slice(this.pg * 8, this.pg * 8 + 8); }
  relink() {
    const rows = this.page();
    this.links.forEach((b, i) => { b.visible = !!rows[i] && !rows[i].npc && rows[i].channel === this.g.channel; });
    this.prev.enabled = this.pg > 0; this.next.enabled = this.pg < this.pages - 1;
  }
  turn(d) { this.pg = Math.max(0, Math.min(this.pages - 1, this.pg + d)); this.relink(); }
  go(i) { const r = this.page()[i]; if (!r || r.npc) return; this.picked = r; this.g.net?.owlWarp(r.ownerId, r.mapId); }
  /** SHOP_LINK_RESULT. */
  onLink(code) {
    if (code === 0) { this.mgr.close(this); return; }
    if (code === 1 && this.picked) { this.picked.channel = -1; this.relink(); }
    this.mgr.notice({
      1: 'The room is already closed.', 2: "You can't enter the room due to full capacity.", 3: 'Other requests are being fulfilled this minute.',
      4: "You can't do it while you're dead.", 7: 'You are not allowed to trade other items at this point.', 0x11: 'You may not enter this store.',
      0x12: 'The owner of the store is currently\r\nundergoing store maintenance.\r\nPlease try again in a bit.', 0x17: 'This can only be used inside the Free Market.',
    }[code] || 'This character is unable to do it.');
  }
  tooltip(lx, ly) {
    if (ly >= 155 && ly <= 175) {
      if (lx >= 151 && lx <= 179) return { title: '# Item Per Bundle', lines: [] };
      if (lx >= 206 && lx <= 234) return { title: 'Price Per Bundle', lines: [] };
      if (lx >= 258 && lx <= 286) return { title: 'Total # Sold', lines: [] };
    }
    const i = Math.floor((ly - 174) / 22), r = ly >= 174 && this.page()[i];
    if (!r) return null;
    if (lx >= 304 && lx <= 361) return { item: r.item || { id: this.d.itemId } };
    if (lx >= 370 && lx <= 424 && r.channel >= 0 && r.channel !== this.g.channel) {
      const name = String(this.g.channelNames?.[r.channel] ?? r.channel + 1);
      return { title: `This store is open at Room ${r.mapId % 100} on Channel ${name}.`, lines: [] };
    }
    return null;
  }
  body(ctx) {
    const m = this.mgr, font = '12px Arial', black = { color: '#000', size: 12 }, red = { color: '#ff2020', size: 12 };
    const w = (t, f = font) => withFont(ctx, f, () => ctx.measureText(t).width);
    const name = m.itemName(this.d.itemId) || '';
    uiText(ctx, 'Search results for', 20, 85, black);
    const w1 = w('Search results for');
    uiText(ctx, name, 20 + w1 + 3, 85, { color: '#ff2020', size: 12, bold: true });
    uiText(ctx, 'that you entered.', 20 + w1 + 3 + w(name, 'bold 12px Arial') + 3, 85, black);
    const wt = w('Total of'), n = String(this.rows.length);
    uiText(ctx, 'Total of', 20, 99, black); uiText(ctx, n, 20 + wt, 99, red); uiText(ctx, 'results available.', 20 + wt + w(n), 99, black);
    uiText(ctx, 'You may not use "GO" if the store is either on a different channel or closed.', 20, 113, red);
    uiText(ctx, `[${this.pg + 1}/${this.pages}]`, 205, 369, black);
    const info = m.image(this.S.BtInfo);
    ctx.font = font;
    this.page().forEach((r, i) => {
      const y = 176 + 22 * i;
      uiText(ctx, clip(ctx, r.owner, 60), 21, y, r.npc ? red : black);
      uiText(ctx, clip(ctx, r.title, 60), 87, y, black);
      if (r.perBundle) uiText(ctx, String(r.perBundle), 180, y, { ...black, align: 'right' });
      if (r.bundles) uiText(ctx, String(r.bundles), 287, y, { ...black, align: 'right' });
      uiText(ctx, r.price.toLocaleString('en-US'), 255, y, { color: r.npc ? '#ff2020' : priceColor(r.price), size: 12, align: 'right' });
      if (info) ctx.drawImage(info, 304, y);
      if (r.npc || r.channel !== this.g.channel) uiText(ctx, r.npc || r.channel >= 0 ? "Can't Go" : 'Store Closed', 373, y, red);
    });
  }
}

/**
 * Cash Shop Surprise (UIWindow.img/CashGachapon/backgrnd, 170x172, centred): BtOpen (68, 149) sends the box once,
 * BtClose (150, 8). EffectNormal/0 waits at (2, 31); the result plays EffectNormal or EffectJackpot (150ms a frame)
 * with its sound, and 2.5s later shows what you got (its icon at (69, 62), the lines at y 113 and 131, red on a jackpot).
 */
export class CashGachaponWin extends Win {
  constructor(mgr, shop, box) {
    const C = mgr.W.CashGachapon;
    super(mgr, C.backgrnd, ...centred(170, 172));
    this.C = C; this.shop = shop; this.box = box; this.closeBtn.visible = false; this.result = null;
    this.open = this.button(C.BtOpen, 68, 149, () => this.go());
    this.shut = this.button(C.BtClose, 150, 8, () => mgr.close(this));
  }
  frames() { return [...super.frames(), ...Object.values(this.C.EffectNormal || {}), ...Object.values(this.C.EffectJackpot || {})].filter((n) => n?._canvas); }
  onClose() { if (this.shop.gachapon === this) this.shop.gachapon = null; }
  go() { this.open.enabled = false; this.shut.enabled = false; this.g.net?.cashShopSurprise(this.box.cashId); }
  /** What came out: the item, how many, whether it was a jackpot. */
  won(itemId, count, jackpot) {
    this.result = { itemId, count, jackpot, at: performance.now(), shownAt: performance.now() + 2500 };
    sfx.play(jackpot ? 'UI/CashGachaponJackpot' : 'UI/CashGachaponNormal');
  }
  body(ctx) {
    const m = this.mgr, r = this.result, now = performance.now();
    const fx = r?.jackpot ? this.C.EffectJackpot : this.C.EffectNormal;
    const frame = !r ? 0 : Math.min(16, Math.floor((now - r.at) / 150));
    const img = m.image(fx?.[frame]);
    if (img) ctx.drawImage(img, 2, 31);
    if (!r || now < r.shownAt) return;
    this.shut.enabled = true;
    m.drawIcon(ctx, m.icon(r.itemId), 69, 62, r.itemId);
    const font = '12px Arial';
    const line1 = r.count === 1 ? 'you have gained an item' : 'you have gained items';
    uiText(ctx, line1, Math.floor((170 - withFont(ctx, font, () => ctx.measureText(line1).width)) / 2), 113, { color: '#000', size: 12 });
    let line2 = r.count === 1 ? (m.itemName(r.itemId) || '') : `${r.count} ${m.itemName(r.itemId) || ''}`;
    const w = withFont(ctx, font, () => ctx.measureText(line2).width);
    let x = Math.floor((170 - w) / 2);
    if (w >= 170) { x = 4; line2 = `${line2.slice(0, 27)}..`; }
    uiText(ctx, line2, x, 131, { color: r.jackpot ? '#ff2020' : '#000', size: 12 });
  }
}
