import { pad, frames } from '../assets.js';
import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win, allCanvases } from './windows.js';

/**
 * The Monster Book (UIWindow.img/MonsterBook, 475x349), laid out as openms recovered it.
 * Cards are Item/Consume/0238.img (info/mob); the nine categories are the card id's thousands digit
 * (238 0xxx .. 238 8xxx), String/MonsterBook.img/<mob> holds map (found in), reward (drops) and episode.
 *   Left page: LeftTabInfo (y 25) = the summary (infoPage at 40,30: level 145/30, total /81, special /114,
 *     normal /133, the cover monster's name at 81-181 / 171, icon/<level-1> at 117,43); LeftTab/0-8 (y 126 +
 *     20n, x -7 or -2 chosen) = cardSlot (40,25) and a 5x5 page of cards from (48,56) every 33 x 45, unowned
 *     ones faint, with ItemNo/<count> or fullMark at +1,+26, cover / select frames at -2,-2; page n / m at 89-163.
 *   Right page, for the chosen card: RightTab/0-3 at x 455 (439 chosen), y 25/64/101/138, opened by owning
 *     1 / 3 / 4 / 5 of it: Basic Info (the monster at 350,250, HP / MP at 278-408 y 289, ??? below 2 cards),
 *     Episode (from 250,52, 14 lines a page), Dropping (4 x 5 icons from 278,80 every 36), Found In (11 rows
 *     from y 60 every 19: street names bold at 260, maps at 272).
 *   Arrows at y 285: 48 / 185 turn the card pages, 270 / 407 the detail pages. Search field 49,30; BtSearch 175,29.
 *   Right-click a card you own: ContextMenu Register (as the book's cover) / Release.
 */
const TEXT = '#33251b', DETAIL_TABS = [1, 3, 4, 5];
const INFO = 9;

export class MonsterBookWin extends Win {
  constructor(mgr) {
    const B = mgr.W.MonsterBook;
    super(mgr, B.backgrnd, Math.round((800 - 475) / 2), 60);
    this.B = B; this.cat = INFO; this.page = 0; this.sel = 0; this.tab = 0; this.dpage = 0; this.menu = null;
    this.closeBtn.visible = false;
    this.button(B.BtClose, 429, 8, () => mgr.close(this));
    this.searchBtn = this.button(B.BtSearch, 175, 29, () => this.search());
    this.arrows = [[48, 'left', -1], [185, 'left', 1], [270, 'right', -1], [407, 'right', 1]]
      .map(([x, side, d]) => this.button(B[d < 0 ? 'arrowLeft' : 'arrowRight'], x, 285, () => this.turn(side, d)));
    this.load();
  }
  frames() { return [...super.frames(), ...allCanvases(this.B), ...allCanvases(this.mgr.B.ItemNo)]; }

  // ---------------------------------------------------------------- data
  async load() {
    const a = this.mgr.assets;
    const [items, info, mobs, maps] = await Promise.all(['Item/Consume/0238.img', 'String/MonsterBook.img', 'String/Mob.img', 'String/Map.img'].map((p) => a.json(p)));
    this.cards = {}; this.cats = Array.from({ length: 9 }, () => []);
    for (const [k, v] of Object.entries(items || {})) {
      if (k.startsWith('_') || !v?.info?.mob) continue;
      const id = Number(k), mob = v.info.mob, cat = Math.floor((id - 2380000) / 1000);
      if (cat < 0 || cat > 8) continue;
      const s = info?.[mob] || {};
      this.cards[id] = { id, mob, cat, icon: v.info.icon, name: mobs?.[mob]?.name || `Monster ${mob}`,
        rewards: Object.values(s.reward || {}).filter((x) => typeof x === 'number'),
        maps: Object.values(s.map || {}).filter((x) => typeof x === 'number'), episode: typeof s.episode === 'string' ? s.episode : '' };
      this.cats[cat].push(id);
    }
    for (const c of this.cats) c.sort((x, y) => x - y);
    this.strMap = maps;
    await a.preload(Object.values(this.cards).map((c) => c.icon).filter(Boolean));
    if (this.book.cover && this.cards[this.book.cover]) this.choose(this.book.cover);
  }
  get book() { return this.g.monsterBook || { cover: 0, cards: {} }; }
  count(id) { return this.book.cards[id] || 0; }
  /** Cosmic's MonsterBook.calculateLevel: each level needs 10 x level more distinct cards than the last. */
  level() {
    const have = Object.keys(this.book.cards).length;
    let level = 0, next = 1;
    do { level++; next += level * 10; } while (have >= next);
    return level;
  }

  // ---------------------------------------------------------------- choices
  choose(id) {
    const c = this.cards?.[id];
    if (!c) return;
    this.cat = c.cat; this.page = Math.floor(this.cats[c.cat].indexOf(id) / 25); this.sel = id; this.dpage = 0;
    const open = DETAIL_TABS.map((n, t) => (this.count(id) >= n ? t : -1)).filter((t) => t >= 0);
    if (!open.includes(this.tab)) this.tab = 0;
    this.layoutDetail();
    this.mobArt(c.mob);
  }
  chooseCat(cat) {
    this.cat = cat; this.page = 0; this.tab = 0; this.dpage = 0;
    if (cat !== INFO && this.cats?.[cat]?.length) this.choose(this.cats[cat][0]); else this.sel = 0;
  }
  pages() { return this.cat === INFO ? 1 : Math.max(1, Math.ceil((this.cats?.[this.cat]?.length || 0) / 25)); }
  turn(side, d) {
    if (this.cat === INFO) return;
    if (side === 'left') {
      const p = Math.max(0, Math.min(this.pages() - 1, this.page + d));
      if (p !== this.page) this.choose(this.cats[this.cat][p * 25]);
    } else this.dpage = Math.max(0, Math.min(this.detailPages() - 1, this.dpage + d));
  }
  search() {
    const q = (this.field?.value || '').replace(/ /g, '').toLowerCase();
    if (!q) return;
    const hit = Object.values(this.cards || {}).find((c) => c.name.replace(/ /g, '').toLowerCase() === q)
      || Object.values(this.cards || {}).find((c) => c.name.replace(/ /g, '').toLowerCase().includes(q));
    if (hit) { this.field.el.blur(); this.choose(hit.id); } else this.mgr.notice('No monster with that name was found.');
  }
  async mobArt(mob) {
    const a = this.mgr.assets;
    let m = await a.json(`Mob/${pad(mob, 7)}.img`);
    if (m?.info?.link) m = (await a.json(`Mob/${pad(m.info.link, 7)}.img`)) || m;
    const f = frames(m?.stand || m?.fly)[0];
    if (f) await a.preload([f]);
    if (this.cards?.[this.sel]?.mob === mob) this.art = { mob, frame: f, info: m?.info || {} };
  }

  // ---------------------------------------------------------------- detail pages
  /** Wraps episode text and groups map names under their streets into this card's pages. */
  layoutDetail() {
    const c = this.cards[this.sel], ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '12px Arial, sans-serif';
    const lines = [];
    for (const para of (c.episode || '').replace(/\\r\\n|\\n|\\r/g, '\n').split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > 200) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
    }
    this.episode = [];
    for (let i = 0; i < lines.length; i += 14) this.episode.push(lines.slice(i, i + 14));
    this.where = [];
    let pageRows = [], street = null;
    const name = (id) => { for (const r of Object.values(this.strMap || {})) if (r?.[id]) return r[id]; return null; };
    for (const id of c.maps) {
      const n = name(id), st = n?.streetName || null, head = st && (!pageRows.length || st !== street);
      if (pageRows.length + (head ? 2 : 1) > 11) { this.where.push(pageRows); pageRows = []; }
      if (st && (!pageRows.length || st !== street)) pageRows.push({ text: st, head: true });
      pageRows.push({ text: n?.mapName || `Map ${id}` });
      street = st;
    }
    if (pageRows.length) this.where.push(pageRows);
  }
  detailPages() {
    const c = this.cards?.[this.sel];
    if (!c) return 1;
    return Math.max(1, this.tab === 1 ? this.episode.length : this.tab === 2 ? Math.ceil(c.rewards.length / 20) : this.tab === 3 ? this.where.length : 1);
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    const grid = this.cat !== INFO;
    this.arrows.forEach((b, i) => { b.visible = grid && (i < 2 || this.tab !== 0); });
    this.arrows[0].enabled = this.page > 0; this.arrows[1].enabled = this.page + 1 < this.pages();
    this.arrows[2].enabled = this.dpage > 0; this.arrows[3].enabled = this.dpage + 1 < this.detailPages();
    this.searchBtn.visible = grid;
    super.draw(ctx);
    if (!this.field) {
      this.field = new TextField(this.g.statusBar.layer, 0, 0, 120, 15, { max: 32, color: '#000' });
      this.field.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.search(); else if (e.key === 'Escape') this.field.el.blur(); });
    }
    this.field.show(grid);
    this.field.rect.x = this.x + 49; this.field.rect.y = this.y + 30;
    this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / 800);
  }
  onClose() { this.field?.show(false); this.menu = null; }
  text2(ctx, t, x, y, o = {}) { uiText(ctx, String(t), x, y, { color: TEXT, size: 12, ...o }); }
  tabImg(node, chosen) { return this.mgr.image(node?.[chosen ? 'selected' : 'normal']?.[0] || node?.normal?.[0]); }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), B = this.B;
    if (!this.cards) { this.text2(ctx, 'Loading...', 120, 150); return; }
    // left tabs: the summary, then the nine categories (bottom-up from y 126)
    const info = this.tabImg(B.LeftTabInfo?.[0], this.cat === INFO);
    if (info) ctx.drawImage(info, this.cat === INFO ? -2 : -7, 25);
    for (let i = 0; i < 9; i++) { const t = this.tabImg(B.LeftTab?.[i], this.cat === i); if (t) ctx.drawImage(t, this.cat === i ? -2 : -7, 126 + i * 20); }
    if (this.cat === INFO) this.drawSummary(ctx); else this.drawGrid(ctx);
    // right tabs and the chosen card's page
    let y = 25;
    for (let t = 0; t < 4; t++) {
      const off = this.cat === INFO || this.count(this.sel) < DETAIL_TABS[t], on = !off && this.tab === t;
      const n = B.RightTab?.[t], img = im(n?.[off ? 'disabled' : on ? 'selected' : 'normal']?.[0] || n?.normal?.[0]);
      if (img) ctx.drawImage(img, on ? 439 : 455, y);
      y += t === 0 ? 39 : 37;
    }
    if (this.cat !== INFO && this.sel) this.drawDetail(ctx);
    if (this.menu) this.drawMenu(ctx);
  }
  drawSummary(ctx) {
    const im = (n) => this.mgr.image(n), B = this.B, cards = this.book.cards;
    const ip = im(B.infoPage); if (ip) ctx.drawImage(ip, 40, 30);
    const ids = Object.keys(cards).map(Number), special = ids.filter((id) => id >= 2388000).length;
    const lv = this.level();
    const icon = im(B.icon?.[lv - 1]); if (icon) ctx.drawImage(icon, 117, 43);
    for (const [v, y] of [[lv, 30], [ids.length, 81], [special, 114], [ids.length - special, 133]]) this.text2(ctx, v, 180, y, { align: 'right' });
    const cover = this.cards[this.book.cover];
    if (cover) this.text2(ctx, cover.name, 181, 171, { align: 'right' });
  }
  cardAt(lx, ly) {
    if (this.cat === INFO) return 0;
    const col = Math.floor((lx - 48) / 33), row = Math.floor((ly - 56) / 45);
    if (col < 0 || col > 4 || row < 0 || row > 4 || (lx - 48) % 33 > 27 || (ly - 56) % 45 > 38) return 0;
    return this.cats[this.cat][this.page * 25 + row * 5 + col] || 0;
  }
  drawGrid(ctx) {
    const m = this.mgr, im = (n) => m.image(n), B = this.B;
    const slot = im(B.cardSlot); if (slot) ctx.drawImage(slot, 40, 25);
    const ids = this.cats[this.cat].slice(this.page * 25, this.page * 25 + 25);
    ids.forEach((id, i) => {
      const x = 48 + (i % 5) * 33, y = 56 + Math.floor(i / 5) * 45, n = this.count(id), c = this.cards[id], icon = im(c.icon);
      if (icon) { ctx.globalAlpha = n ? 1 : 85 / 255; ctx.drawImage(icon, x - (c.icon.origin?.[0] || 0) + 0, y + 32 - (c.icon.origin?.[1] || 32)); ctx.globalAlpha = 1; }
      const mark = n === 5 ? im(B.fullMark) : n ? im(m.B.ItemNo?.[n]) : null;
      if (mark) ctx.drawImage(mark, x + 1, y + 26);
      if (this.book.cover === id) { const f = im(B.cover); if (f) ctx.drawImage(f, x - 2, y - 2); }
      if (this.sel === id) { const f = im(B.select); if (f) ctx.drawImage(f, x - 2, y - 2); }
    });
    this.text2(ctx, `${this.page + 1} / ${this.pages()}`, 126, 287, { align: 'center' });
  }
  drawDetail(ctx) {
    const c = this.cards[this.sel], n = this.count(c.id), m = this.mgr;
    if (this.tab === 0) {
      this.text2(ctx, c.name, 350, 52, { align: 'center', bold: true });
      if (!n) { this.text2(ctx, 'You do not have this card yet.', 350, 150, { align: 'center' }); return; }
      const a = this.art, img = a?.mob === c.mob && m.image(a.frame);
      if (img) {
        const o = a.frame.origin || [img.width / 2, img.height], k = Math.min(1, 170 / img.width, 170 / img.height);
        ctx.drawImage(img, Math.round(350 - o[0] * k), Math.round(250 - o[1] * k), img.width * k, img.height * k);
      }
      const hp = n > 1 ? a?.info?.maxHP ?? '???' : '???', mp = n > 1 ? a?.info?.maxMP ?? '???' : '???';
      this.text2(ctx, `Lv. ${a?.info?.level ?? '?'}`, 350, 268, { align: 'center' });
      this.text2(ctx, `HP : ${hp}   MP : ${mp}`, 343, 289, { align: 'center' });
    } else if (this.tab === 1) {
      (this.episode[this.dpage] || ['No episode is recorded for this monster.']).forEach((l, i) => this.text2(ctx, l, 250, 52 + i * 16));
    } else if (this.tab === 2) {
      const list = c.rewards.slice(this.dpage * 20, this.dpage * 20 + 20);
      if (!list.length) this.text2(ctx, 'No drops are recorded for this monster.', 250, 60);
      list.forEach((id, i) => m.drawIcon(ctx, m.icon(id), 278 + (i % 4) * 36, 80 + Math.floor(i / 4) * 36));
    } else {
      const rows = this.where[this.dpage] || [];
      if (!rows.length) this.text2(ctx, 'No locations are recorded for this monster.', 250, 60);
      rows.forEach((r, i) => {
        const x = r.head ? 260 : 272;
        ctx.save(); ctx.beginPath(); ctx.rect(x, 60 + i * 19, 440 - x, 19); ctx.clip();
        this.text2(ctx, r.text, x, 60 + i * 19, { bold: !!r.head });
        ctx.restore();
      });
    }
    if (this.tab !== 0) this.text2(ctx, `${this.dpage + 1} / ${this.detailPages()}`, 348, 287, { align: 'center' });
  }
  drawMenu(ctx) {
    const im = (n) => this.mgr.image(n), C = this.B.ContextMenu, { x, y } = this.menu;
    for (const [k, dy] of [['t', 0], ['c', 19], ['s', 32]]) { const i = im(C?.[k]); if (i) ctx.drawImage(i, x, y + dy); }
    const reg = im(C?.BtRegister?.[this.menu.canReg ? 'normal' : 'disabled']?.[0]), rel = im(C?.BtRelease?.[this.book.cover ? 'normal' : 'disabled']?.[0]);
    if (reg) ctx.drawImage(reg, x + 2, y + 3);
    if (rel) ctx.drawImage(rel, x + 2, y + 18);
  }

  // ---------------------------------------------------------------- mouse
  down(lx, ly) {
    if (this.menu) {
      const { x, y, id, canReg } = this.menu;
      this.menu = null;
      if (lx >= x && lx < x + 90 && ly >= y + 3 && ly < y + 17 && canReg) { this.g.net?.bookCover(id); sfx.play('UI/BtMouseClick'); }
      else if (lx >= x && lx < x + 90 && ly >= y + 18 && ly < y + 32 && this.book.cover) { this.g.net?.bookCover(0); sfx.play('UI/BtMouseClick'); }
      return;
    }
    if (lx < 40 && ly >= 25 && ly < 45) { sfx.play('UI/Tab'); this.chooseCat(INFO); return; }
    if (lx < 40 && ly >= 126 && ly < 306) { sfx.play('UI/Tab'); this.chooseCat(Math.floor((ly - 126) / 20)); return; }
    if (lx >= 439 && this.cat !== INFO) {
      let y = 25;
      for (let t = 0; t < 4; t++) {
        const h = t === 0 ? 39 : 37;
        if (ly >= y && ly < y + h - 2 && this.count(this.sel) >= DETAIL_TABS[t]) { if (this.tab !== t) { this.tab = t; this.dpage = 0; sfx.play('UI/Tab'); } return; }
        y += h;
      }
    }
    const id = this.cardAt(lx, ly);
    if (id) this.choose(id);
  }
  rclick(lx, ly) {
    const id = this.cardAt(lx, ly);
    if (!id) { this.menu = null; return; }
    this.choose(id);
    this.menu = { id, x: Math.min(lx, 386), y: Math.min(ly, 291), canReg: !!this.count(id) && this.book.cover !== id };
  }
  wheel(dy) { this.turn(this.mgr.mouse.x - this.x < 237 ? 'left' : 'right', Math.sign(dy)); }
  key(e) { if (e.key === 'Escape') { if (this.menu) this.menu = null; else this.mgr.close(this); } }
  tooltip(lx, ly) {
    const id = this.cardAt(lx, ly);
    if (id) return { title: this.cards[id].name, lines: [`${this.count(id)} / 5`] };
    if (this.cat !== INFO && this.tab === 2) {
      const c = this.cards[this.sel], col = Math.floor((lx - 278) / 36), row = Math.floor((ly - 80) / 36);
      const it = col >= 0 && col < 4 && row >= 0 && row < 5 && c?.rewards[this.dpage * 20 + row * 4 + col];
      if (it) return { item: { id: it } };
    }
    return null;
  }
}
