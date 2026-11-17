/**
 * MOBILE UI's windows: the Item, Equipment, Stat, Skill and Quest windows as sheets in its style, made for a phone:
 * one at a time, along the right side under its buttons, the field still showing on the left. They show what the
 * client's windows show and act through their code, so nothing behaves differently:
 *   - items: a double-click's use or equip (Game.useInventoryItem), dropping (InventoryWin.dropOutside, with its
 *     checks and prompts), moving a stack to another slot (ITEM_MOVE), offering it in a trade (TradeWin.offer), a
 *     scroll onto something you wear (Game.useScroll), dropping mesos (InventoryWin.dropMesos);
 *   - equipment: taking something off (Game.unequip);
 *   - stats: AP one at a time or AUTO (StatWin.raise / autoAssign);
 *   - skills: SP (SkillWin.canRaise / raiseId);
 *   - quests: the Quest window's lists, its text (its own names for NPCs, items and monsters) and its buttons (give
 *     up, Quest Helper, Mark NPC).
 * Item and skill icons are the game's own.
 */
import { EXP, jobName, itemDesc, isScroll } from '../data.js';
import { richText, LIGHT_COLORS } from './richtext.js';

const INV_TABS = [[1, 'Equip'], [2, 'Use'], [3, 'Set-up'], [4, 'Etc'], [5, 'Cash']];
const EQ_STATS = [['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK'], ['hp', 'MaxHP'], ['mp', 'MaxMP'], ['watk', 'Weapon Attack'],
  ['matk', 'Magic Attack'], ['wdef', 'Weapon Defense'], ['mdef', 'Magic Defense'], ['acc', 'Accuracy'], ['avoid', 'Avoidability'],
  ['hands', 'Hands'], ['speed', 'Speed'], ['jump', 'Jump']];
/** The Equip window's grid (5 columns): each slot's [column, row] and name; the Cash tab's slots are these less 100. */
const EQUIP_GRID = {
  [-1]: [1, 0, 'Cap'], [-49]: [0, 1, 'Medal'], [-2]: [1, 1, 'Forehead'], [-12]: [3, 1, 'Ring'], [-13]: [4, 1, 'Ring'], [-3]: [2, 2, 'Eye'],
  [-4]: [3, 2, 'Earrings'], [-9]: [0, 3, 'Cape'], [-5]: [1, 3, 'Top'], [-17]: [2, 3, 'Pendant'], [-11]: [3, 3, 'Weapon'], [-10]: [4, 3, 'Shield'],
  [-8]: [0, 4, 'Gloves'], [-6]: [1, 4, 'Bottom'], [-50]: [2, 4, 'Belt'], [-15]: [3, 4, 'Ring'], [-16]: [4, 4, 'Ring'], [-7]: [2, 5, 'Shoes'],
};
const STATS = [['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK']];
const STARTERS = [0, 1000, 2000, 2001];
const QUEST_TABS = [[0, 'Available'], [1, 'In Progress'], [2, 'Completed']];
const TITLES = { items: 'Inventory', equip: 'Equipment', stats: 'Character', skills: 'Skills', quests: 'Quests' };
const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const CSS = `
.mhud .mh-sheet { position: absolute; right: calc(6px + env(safe-area-inset-right)); top: 50px; bottom: calc(6px + env(safe-area-inset-bottom));
  width: min(400px, 62vw); display: none; flex-direction: column; pointer-events: auto; overflow: hidden; }
.mhud .mh-sheet.mh-open { display: flex; }
.mhud.mh-sheeting .mh-chat { display: none; }
.mhud .mh-sh-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 7px 8px 5px 12px; }
.mhud .mh-sh-title { font-size: 13px; font-weight: 800; letter-spacing: 0.3px; }
.mhud .mh-sh-extra { flex: 1; text-align: right; font-size: 11px; color: rgba(225, 232, 248, 0.8); white-space: nowrap; }
.mhud .mh-sh-extra .mh-pill { display: inline-block; padding: 3px 9px; border-radius: 10px; background: rgba(255, 255, 255, 0.08); }
.mhud .mh-sh-x { width: 26px; height: 26px; flex: none; }
.mhud .mh-sh-x svg { width: 14px; height: 14px; }
.mhud .mh-sh-tabs { flex: none; display: flex; gap: 4px; padding: 0 8px 6px; overflow-x: auto; scrollbar-width: none; }
.mhud .mh-sh-tabs::-webkit-scrollbar { display: none; }
.mhud .mh-sh-tabs:empty { display: none; }
.mhud .mh-tab { flex: none; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: rgba(225, 232, 248, 0.75);
  background: rgba(255, 255, 255, 0.06); white-space: nowrap; cursor: pointer; }
.mhud .mh-tab.mh-on { color: #2e1d00; background: linear-gradient(180deg, #ffe58a, #f0b22e); }
.mhud .mh-banner { flex: none; margin: 0 8px 6px; padding: 5px 9px; border-radius: 8px; font-size: 11px; display: flex; align-items: center; gap: 8px;
  background: rgba(122, 170, 255, 0.22); border: 1px solid rgba(160, 196, 255, 0.35); }
.mhud .mh-banner span { flex: 1; }
.mhud .mh-sh-body { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 8px 8px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.mhud .mh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 4px; }
.mhud .mh-cell { position: relative; aspect-ratio: 1; border-radius: 8px; background: rgba(0, 0, 0, 0.32); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  display: grid; place-items: center; cursor: pointer; overflow: hidden; }
.mhud .mh-cell img { width: 32px; height: 32px; object-fit: none; image-rendering: pixelated; pointer-events: none; }
.mhud .mh-cell b { position: absolute; right: 3px; bottom: 1px; font-size: 9.5px; font-weight: 800; text-shadow: 0 0 2px #000, 0 0 2px #000; }
.mhud .mh-cell i { font-style: normal; font-size: 8.5px; color: rgba(225, 232, 248, 0.35); text-align: center; line-height: 1.1; padding: 2px; }
.mhud .mh-cell.mh-sel { box-shadow: inset 0 0 0 2px #ffd25e, 0 0 8px rgba(255, 210, 94, 0.45); }
.mhud .mh-cell.mh-from { box-shadow: inset 0 0 0 2px #8cc2ff; }
.mhud .mh-cell.mh-locked { opacity: 0.3; cursor: default; }
.mhud .mh-equip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; width: min(100%, 216px); margin: 0 auto; }
.mhud .mh-sh-detail { flex: none; max-height: 48%; overflow-y: auto; border-top: 1px solid rgba(255, 255, 255, 0.1); padding: 8px 10px 9px;
  background: rgba(0, 0, 0, 0.18); display: none; -webkit-overflow-scrolling: touch; }
.mhud .mh-sh-detail.mh-open { display: block; }
.mhud .mh-dt-head { display: flex; align-items: center; gap: 9px; }
.mhud .mh-dt-head img { width: 32px; height: 32px; object-fit: none; image-rendering: pixelated; flex: none; }
.mhud .mh-dt-name { font-size: 12.5px; font-weight: 800; }
.mhud .mh-dt-sub { font-size: 10px; color: rgba(225, 232, 248, 0.6); }
.mhud .mh-dt-text { margin-top: 5px; font-size: 11px; line-height: 1.35; color: rgba(232, 237, 248, 0.88); white-space: pre-wrap; }
.mhud .mh-dt-stats { margin-top: 5px; display: grid; grid-template-columns: 1fr 1fr; gap: 1px 10px; font-size: 10.5px; }
.mhud .mh-dt-stats span { color: rgba(225, 232, 248, 0.6); }
.mhud .mh-ctas { display: flex; flex-wrap: wrap; gap: 6px; margin: 7px 0 2px; }
.mhud .mh-cta { height: 28px; padding: 0 13px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.09);
  color: #f2f5fb; font: 700 11.5px -apple-system, "Segoe UI", system-ui, sans-serif; cursor: pointer; }
.mhud .mh-cta.mh-main { border: 0; color: #2e1d00; background: linear-gradient(180deg, #ffe07a, #f0aa2c); }
.mhud .mh-cta.mh-warn { color: #ffb0b0; }
.mhud .mh-cta:disabled { opacity: 0.35; }
.mhud .mh-sec { margin: 8px 0 4px; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: rgba(240, 190, 80, 0.85); }
.mhud .mh-sec:first-child { margin-top: 2px; }
.mhud .mh-kv { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 2px 4px; border-radius: 7px; font-size: 11.5px; }
.mhud .mh-kv:nth-child(even) { background: rgba(255, 255, 255, 0.03); }
.mhud .mh-kv span { width: 92px; flex: none; color: rgba(225, 232, 248, 0.6); }
.mhud .mh-kv em { flex: 1; font-style: normal; font-weight: 700; }
.mhud .mh-kv em small { font-weight: 500; color: rgba(225, 232, 248, 0.55); }
.mhud .mh-plus { width: 26px; height: 26px; flex: none; border-radius: 50%; border: 0; color: #2e1d00; font: 900 15px/26px system-ui, sans-serif;
  background: linear-gradient(180deg, #ffe07a, #f0aa2c); cursor: pointer; padding: 0; }
.mhud .mh-plus:disabled { opacity: 0.25; }
.mhud .mh-list .mh-li { display: flex; align-items: center; gap: 9px; min-height: 40px; padding: 4px 6px; border-radius: 9px; cursor: pointer; }
.mhud .mh-list .mh-li:nth-child(even) { background: rgba(255, 255, 255, 0.03); }
.mhud .mh-list .mh-li.mh-sel { background: rgba(255, 210, 94, 0.14); box-shadow: inset 0 0 0 1px rgba(255, 210, 94, 0.45); }
.mhud .mh-li img { width: 32px; height: 32px; object-fit: none; image-rendering: pixelated; flex: none; }
.mhud .mh-li .mh-li-main { flex: 1; min-width: 0; }
.mhud .mh-li .mh-li-name { font-size: 12px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-li .mh-li-sub { font-size: 10px; color: rgba(225, 232, 248, 0.6); }
.mhud .mh-li.mh-off .mh-li-name { color: rgba(225, 232, 248, 0.45); }
.mhud .mh-empty { padding: 18px 6px; text-align: center; color: rgba(225, 232, 248, 0.5); font-size: 11.5px; }
`;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
/** A skill's or item's text without the client's colour codes. */
const plain = (s) => String(s || '').replace(/\\n/g, '\n').replace(/#[a-zA-Z]/g, '').replace(/#/g, '');

export class MobileSheets {
  constructor(hud, root) {
    this.hud = hud; this.g = hud.g;
    if (!document.getElementById('mhud-sheet-css')) {
      const s = document.createElement('style');
      s.id = 'mhud-sheet-css'; s.textContent = CSS;
      document.head.append(s);
    }
    const n = this.el = el('div', 'mh-sheet mh-glass');
    n.innerHTML = `<div class="mh-sh-head"><span class="mh-sh-title"></span><span class="mh-sh-extra"></span><div class="mh-btn mh-sh-x">${X_ICON}</div></div>
      <div class="mh-sh-tabs"></div><div class="mh-sh-banner"></div><div class="mh-sh-body"></div><div class="mh-sh-detail"></div>`;
    root.append(n);
    const $ = (s) => n.querySelector(s);
    this.p = { title: $('.mh-sh-title'), extra: $('.mh-sh-extra'), tabs: $('.mh-sh-tabs'), banner: $('.mh-sh-banner'), body: $('.mh-sh-body'), detail: $('.mh-sh-detail') };
    hud.tap($('.mh-sh-x'), () => this.close());
    this.kind = null; this.sig = '';
    this.tab = { items: 1, equip: 'worn', quests: 1 }; this.book = null;
    this.sel = null;     // the item slot, equipment slot, skill or quest picked
    this.move = null;    // an item being moved: the next slot tapped takes it
    this.pick = null;    // a scroll being put on: the next thing worn tapped takes it
    this.descs = new Map();
    this.timer = setInterval(() => this.refresh(), 300);
  }

  get open() { return !!this.kind; }
  get wm() { return this.g.windows; }
  /** MENU ids the sheets stand in for. */
  static kindOf(m, MENU) {
    return { [MENU.ITEMS]: 'items', [MENU.EQUIP]: 'equip', [MENU.STATS]: 'stats', [MENU.SKILLS]: 'skills', [MENU.QUESTS]: 'quests' }[m] || null;
  }
  toggle(kind) { if (this.kind === kind) this.close(); else this.show(kind); }
  show(kind) {
    if (this.kind !== kind) { this.sel = null; this.move = null; if (kind !== 'equip') this.pick = null; this.p.body.scrollTop = 0; }
    this.kind = kind;
    this.el.classList.add('mh-open'); this.hud.el.classList.add('mh-sheeting');
    this.render();
  }
  close() {
    this.kind = null; this.sel = null; this.move = null; this.pick = null;
    this.el.classList.remove('mh-open'); this.hud.el.classList.remove('mh-sheeting');
  }

  /** Drawn again when what it shows changes (an item moved, a level gained, an icon or name loaded). */
  refresh() {
    if (!this.kind || !this.g.stats) return;
    const sig = this.signature();
    if (sig !== this.sig) this.render();
  }
  signature() {
    const g = this.g, v = this.wm?.namesVersion || 0, s = g.stats, base = `${this.kind}|${v}|${JSON.stringify(this.sel)}|${!!this.move}|${!!this.pick}|${this.descs.size}`;
    if (this.kind === 'items') { const t = this.tab.items, inv = g.inventory?.[t] || {}; return `${base}|${t}|${g.meso}|${g.inventory?.limits?.[t]}|${Object.entries(inv).map(([k, it]) => `${k}:${it?.id}:${it?.quantity}`).join(',')}|${!!g.tradeWin}`; }
    if (this.kind === 'equip') return `${base}|${this.tab.equip}|${Object.entries(g.inventory?.equipped || {}).map(([k, it]) => `${k}:${it?.id}`).join(',')}`;
    if (this.kind === 'stats') return `${base}|${JSON.stringify([s.level, s.job, s.hp, s.mp, s.exp, s.fame, s.ap, s.str, s.dex, s.int, s.luk, g.maxHpShown(), g.maxMpShown(), g.guild?.name, g.statWindow?.()])}`;
    if (this.kind === 'skills') { const w = this.wm?.wins.skill; this.book ??= w?.books?.[w.books.length - 1]; if (w && this.book) w.book = this.book; return `${base}|${this.book}|${s.sp}|${(w?.list || []).map((id) => g.skills.level(id)).join(',')}|${!!g.skills?.strings}`; }
    if (this.kind === 'quests') { const w = this.wm?.wins.quest; if (!w) return base; return `${base}|${this.tab.quests}|${this.questEntries(w, this.tab.quests).map((e) => e.id).join(',')}`; }
    return base;
  }
  render() {
    if (!this.kind) return;
    this.sig = this.signature();
    const p = this.p, keep = p.body.scrollTop;
    p.title.textContent = TITLES[this.kind];
    p.extra.replaceChildren(); p.tabs.replaceChildren(); p.banner.replaceChildren(); p.detail.replaceChildren();
    const body = this[this.kind]();
    p.body.replaceChildren(body);
    p.body.scrollTop = keep;
    p.detail.classList.toggle('mh-open', p.detail.childElementCount > 0);
  }

  // ---------------------------------------------------------------- pieces
  tabs(list, cur, set) {
    for (const [k, label] of list) {
      const t = el('div', `mh-tab${k === cur ? ' mh-on' : ''}`, label);
      this.hud.tap(t, () => { set(k); this.sel = null; this.move = null; this.p.body.scrollTop = 0; this.render(); });
      this.p.tabs.append(t);
    }
  }
  banner(text, onCancel) {
    const b = el('div', 'mh-banner');
    b.append(el('span', null, text));
    const c = el('button', 'mh-cta', 'Cancel');
    this.hud.tap(c, onCancel);
    b.append(c);
    this.p.banner.append(b);
  }
  /** An item's or skill's icon from its node (the game's own image), or an empty image until it loads. */
  img(node) {
    const i = el('img'); i.alt = ''; i.draggable = false;
    if (node?._canvas) i.src = `${this.g.assets.base}/${node._canvas}`;
    else i.style.visibility = 'hidden';
    return i;
  }
  itemImg(id) { return this.img(this.wm.icon(id)); }
  button(label, fn, cls = '') {
    const b = el('button', `mh-cta${cls ? ` ${cls}` : ''}`, label);
    this.hud.tap(b, fn);
    return b;
  }
  /** An item's description, loaded once (the sheet is drawn again when it arrives). */
  desc(id) {
    if (!this.descs.has(id)) { this.descs.set(id, null); itemDesc(this.g.assets, id).then((d) => { this.descs.set(id, d || ''); this.descs.set(`v${id}`, 1); }); }
    return this.descs.get(id) || '';
  }
  /** The detail panel for an item: icon, name, count or stats, description, and the buttons. */
  itemDetail(it, sub, actions) {
    const d = this.p.detail, head = el('div', 'mh-dt-head');
    head.append(this.itemImg(it.id));
    const t = el('div');
    t.append(el('div', 'mh-dt-name', this.wm.itemName(it.id) || `Item ${it.id}`));
    if (sub) t.append(el('div', 'mh-dt-sub', sub));
    head.append(t);
    d.append(head);
    const a = el('div', 'mh-ctas');
    for (const b of actions) a.append(b);
    d.append(a);
    if (it.type === 1 || Math.floor(it.id / 1000000) === 1) {
      const rows = EQ_STATS.filter(([k]) => it[k]);
      if (rows.length || it.slots) {
        const g = el('div', 'mh-dt-stats');
        for (const [k, label] of rows) { const r = el('div'); r.append(el('span', null, `${label} `), `+${it[k]}`); g.append(r); }
        if (it.slots !== undefined) { const r = el('div'); r.append(el('span', null, 'Upgrades left '), String(it.slots)); g.append(r); }
        d.append(g);
      }
    }
    const text = plain(this.desc(it.id));
    if (text) d.append(el('div', 'mh-dt-text', text));
  }

  // ---------------------------------------------------------------- Inventory
  items() {
    const g = this.g, tab = this.tab.items, inv = g.inventory?.[tab] || {}, limit = g.inventory?.limits?.[tab] || 24;
    this.tabs(INV_TABS, tab, (k) => { this.tab.items = k; });
    const meso = el('span', 'mh-pill', `${fmt(g.meso)} mesos`);
    meso.title = 'Drop mesos';
    this.hud.tap(meso, () => this.wm.wins.inventory?.dropMesos());
    this.p.extra.append(meso);
    if (this.move) this.banner('Tap the slot to move it to.', () => { this.move = null; this.render(); });
    const grid = el('div', 'mh-grid');
    for (let slot = 1; slot <= Math.max(limit, 24); slot++) {
      const it = inv[slot], c = el('div', 'mh-cell');
      if (slot > limit) { c.classList.add('mh-locked'); grid.append(c); continue; }
      if (it) {
        c.append(this.itemImg(it.id));
        if (it.type !== 1 && (it.quantity || 0) > 1) c.append(el('b', null, String(it.quantity)));
      }
      if (this.sel === slot) c.classList.add('mh-sel');
      if (this.move?.slot === slot) c.classList.add('mh-from');
      this.hud.tap(c, () => this.itemTap(tab, slot));
      grid.append(c);
    }
    const it = this.sel && inv[this.sel];
    if (it && !this.move) {
      const slot = this.sel, acts = [];
      const use = { 1: 'Equip', 2: 'Use', 3: 'Use', 5: 'Use' }[tab];
      if (use) acts.push(this.button(use, () => g.useInventoryItem(tab, slot, it), 'mh-main'));
      if (tab === 2 && isScroll(it.id)) acts.push(this.button('Put on equipment', () => { this.pick = { slot, id: it.id }; this.show('equip'); }, 'mh-main'));
      if (g.tradeWin) acts.push(this.button('Offer in trade', () => g.tradeWin?.offer(tab, slot)));
      acts.push(this.button('Move', () => { this.move = { tab, slot }; this.render(); }));
      acts.push(this.button('Drop', () => this.wm.wins.inventory?.dropOutside({ kind: 'item', tab, slot, id: it.id }), 'mh-warn'));
      this.itemDetail(it, it.type !== 1 && it.quantity > 1 ? `Quantity ${fmt(it.quantity)}` : '', acts);
    }
    return grid;
  }
  itemTap(tab, slot) {
    const g = this.g, inv = g.inventory?.[tab] || {};
    if (this.move) {
      const from = this.move.slot;
      this.move = null;
      if (from !== slot && inv[from]) { if (g.dead) g.notice("You can't do it once you're dead."); else g.net?.moveItem(tab, from, slot, inv[from].quantity || 1); }
      this.sel = null; this.render();
      return;
    }
    this.sel = this.sel === slot || !inv[slot] ? null : slot;
    this.render();
  }

  // ---------------------------------------------------------------- Equipment
  equip() {
    const g = this.g, worn = g.inventory?.equipped || {}, cash = this.tab.equip === 'cash';
    this.tabs([['worn', 'Equipped'], ['cash', 'Cash']], this.tab.equip, (k) => { this.tab.equip = k; });
    if (this.pick) this.banner(`Choose what to use ${this.wm.itemName(this.pick.id) || 'the scroll'} on.`, () => { this.pick = null; this.render(); });
    const grid = el('div', 'mh-equip');
    for (const [k, [col, row, name]] of Object.entries(EQUIP_GRID)) {
      const slot = Number(k) - (cash ? 100 : 0), it = worn[slot], c = el('div', 'mh-cell');
      c.style.gridColumn = String(col + 1); c.style.gridRow = String(row + 1);
      if (it) c.append(this.itemImg(it.id)); else c.append(el('i', null, name));
      if (this.sel === slot) c.classList.add('mh-sel');
      this.hud.tap(c, () => {
        if (this.pick) { const p = this.pick; this.pick = null; if (it) g.useScroll(p.slot, slot); this.render(); return; }
        this.sel = this.sel === slot || !it ? null : slot; this.render();
      });
      grid.append(c);
    }
    const it = this.sel && worn[this.sel];
    if (it && !this.pick) { const slot = this.sel; this.itemDetail(it, EQUIP_GRID[slot + (cash ? 100 : 0)]?.[2] || '', [this.button('Take off', () => { this.sel = null; g.unequip(slot); }, 'mh-main')]); }
    return grid;
  }

  // ---------------------------------------------------------------- Stats
  stats() {
    const g = this.g, s = g.stats, w = this.wm.wins.stat, need = EXP[s.level] || 1, out = el('div');
    const kv = (label, value, sub = '', plus = null) => {
      const r = el('div', 'mh-kv'), e = el('em', null, String(value));
      r.append(el('span', null, label));
      if (sub) { e.append(' '); e.append(el('small', null, sub)); }
      r.append(e);
      if (plus) r.append(plus);
      out.append(r);
    };
    out.append(el('div', 'mh-sec', 'Character'));
    kv('Name', s.name); kv('Job', jobName(s.job)); kv('Level', s.level); kv('Guild', g.guild?.name || '-'); kv('Fame', s.fame);
    kv('HP', `${fmt(s.hp)} / ${fmt(g.maxHpShown())}`); kv('MP', `${fmt(s.mp)} / ${fmt(g.maxMpShown())}`);
    kv('EXP', fmt(s.exp), `(${need >= 1 ? ((s.exp / need) * 100).toFixed(2) : 0}%)`);
    const starter = STARTERS.includes(s.job) && s.level <= 10, gm = Math.floor((s.job % 1000) / 100) === 9;
    out.append(el('div', 'mh-sec', 'Ability Points'));
    const apRow = el('div', 'mh-kv');
    apRow.append(el('span', null, 'Available'), el('em', null, String(s.ap || 0)));
    // AUTO as the window has it (a pirate's two: by STR or by DEX)
    if (!starter && !gm) for (const [flag, label] of s.job === 500 ? [[1, 'Auto (STR)'], [0, 'Auto (DEX)']] : [[1, 'Auto']]) {
      const b = this.button(label, () => w?.autoAssign(flag)); b.disabled = !s.ap; apRow.append(b);
    }
    out.append(apRow);
    const plus = (k) => {
      if (starter) return null;
      const b = el('button', 'mh-plus', '+');
      b.disabled = !s.ap || ((k === 'hp' || k === 'mp') && s.level < 20);
      this.hud.tap(b, () => w?.raise(k));
      return b;
    };
    for (const [k, label] of STATS) {
      const total = g.totalStat(k), d = total - s[k];
      kv(label, total, d ? `(${s[k]}${d > 0 ? '+' : ''}${d})` : '', plus(k));
    }
    kv('Max HP', fmt(g.maxHpShown()), '', plus('hp')); kv('Max MP', fmt(g.maxMpShown()), '', plus('mp'));
    const d = g.statWindow?.();
    if (d) {
      out.append(el('div', 'mh-sec', 'Details'));
      const b = ([v, x]) => (x ? [v + x, `(${v}${x > 0 ? '+' : ''}${x})`] : [v, '']);
      kv('Attack', d.attack ? `${fmt(d.attack[0])} ~ ${fmt(d.attack[1])}` : 0);
      for (const [label, pair] of [['Weapon Def.', d.wdef], ['Magic Attack', d.matk], ['Magic Def.', d.mdef], ['Accuracy', d.acc], ['Avoidability', d.avoid], ['Hands', d.hands]]) kv(label, ...b(pair));
      kv('Speed', `${d.speed}%`); kv('Jump', `${d.jump}%`);
    }
    return out;
  }

  // ---------------------------------------------------------------- Skills
  skills() {
    const g = this.g, sb = g.skills, w = this.wm.wins.skill, list = el('div', 'mh-list');
    if (!sb || !w) return list;
    const books = w.books;
    this.book = books.includes(this.book) ? this.book : books[books.length - 1];
    w.book = this.book;
    this.tabs(books.map((b) => [b, sb.bookName(b)]), this.book, (b) => { this.book = b; w.book = b; });
    this.p.extra.append(el('span', 'mh-pill', `SP ${w.sp}`));
    const ids = w.list;
    if (!ids.length) list.append(el('div', 'mh-empty', 'No skills in this book.'));
    for (const id of ids) {
      const lv = sb.level(id), max = sb.maxLevel(id), row = el('div', `mh-li${lv ? '' : ' mh-off'}${this.sel === id ? ' mh-sel' : ''}`);
      const node = sb.icon(id);
      if (!node) sb.ensure?.(id);
      row.append(this.img(node));
      const m = el('div', 'mh-li-main');
      m.append(el('div', 'mh-li-name', sb.name(id)), el('div', 'mh-li-sub', `Level ${lv} / ${max}`));
      row.append(m);
      if (w.canRaise(id)) { const b = el('button', 'mh-plus', '+'); this.hud.tap(b, () => { w.book = this.book; w.raiseId(id); }); row.append(b); }
      this.hud.tap(row, () => { this.sel = this.sel === id ? null : id; this.render(); });
      list.append(row);
    }
    if (this.sel && ids.includes(this.sel)) {
      const id = this.sel, d = this.p.detail, head = el('div', 'mh-dt-head');
      head.append(this.img(sb.icon(id)));
      const t = el('div');
      t.append(el('div', 'mh-dt-name', sb.name(id)), el('div', 'mh-dt-sub', `Level ${sb.level(id)} / ${sb.maxLevel(id)}`));
      head.append(t);
      d.append(head, el('div', 'mh-dt-text', plain(sb.desc(id))));
    }
    return list;
  }

  // ---------------------------------------------------------------- Quests
  quests() {
    const g = this.g, w = this.wm.wins.quest, list = el('div', 'mh-list'), tab = this.tab.quests;
    if (!w || !g.quests) return list;
    this.tabs(QUEST_TABS, tab, (k) => { this.tab.quests = k; });
    const entries = this.questEntries(w, tab);
    if (!entries.length) list.append(el('div', 'mh-empty', ['No quests can be started right now.', 'No quests in progress.', 'No quests completed yet.'][tab]));
    // grouped by area, as the window lists them
    const areas = new Map();
    for (const e of entries) { const a = w.areaName(e.area); if (!areas.has(a)) areas.set(a, []); areas.get(a).push(e); }
    for (const [area, group] of [...areas.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
      list.append(el('div', 'mh-sec', area));
      for (const e of group) {
        const row = el('div', `mh-li${this.sel === e.id ? ' mh-sel' : ''}`), m = el('div', 'mh-li-main');
        m.append(el('div', 'mh-li-name', e.name || g.quests.name(e.id)));
        if (e.chain && e.count) m.append(el('div', 'mh-li-sub', `${e.done || 0} / ${e.count} done`));
        row.append(m);
        this.hud.tap(row, () => { this.sel = this.sel === e.id ? null : e.id; this.render(); });
        list.append(row);
      }
    }
    const e = this.sel && entries.find((x) => x.id === this.sel);
    if (e) this.questDetail(w, e, tab);
    return list;
  }
  /** The Quest window's list for a tab, worked out at most every 2s (Available checks every quest). */
  questEntries(w, tab) {
    const c = this.qCache, now = performance.now();
    if (c && c.tab === tab && now - c.at < 2000) return c.list;
    w.tab = tab;
    const list = w.entries();
    this.qCache = { tab, at: now, list };
    return list;
  }
  /** A quest's text as the Quest window lays it out (its names for NPCs, items, monsters and maps), in light colours. */
  questDetail(w, e, tab) {
    const g = this.g, book = g.quests, id = e.chain ? e.current || e.id : e.id, info = book.info[id] || {}, d = this.p.detail;
    w.sel = e.id; w.did = e.id; w.dtab = tab; w.selEntry = e;
    d.append(el('div', 'mh-dt-name', e.name || book.name(e.id)));
    const a = el('div', 'mh-ctas');
    d.append(a);
    const text = e.chain ? e.texts.map(([n, t]) => (t ? `${n}\n${t}` : n)).join('\n') : String(info[String(tab)] ?? '');
    const sum = tab === 1 ? [info.summary, info.demandSummary, info.rewardSummary].filter(Boolean).join('\n') : '';
    const ctx = document.createElement('canvas').getContext('2d'), ref = w.ref();
    for (const t of [text, sum].filter(Boolean)) {
      const box = el('div', 'mh-dt-text');
      const { lines } = richText(ctx, t, 100000, ref, { base: '#e8edf8', colors: LIGHT_COLORS, size: 11 });
      lines.forEach((l, i) => {
        if (i) box.append('\n');
        for (const r of l.runs) {
          if (r.icon) { const im = this.img(r.icon); im.style.verticalAlign = 'middle'; box.append(im); continue; }
          const s = el('span', null, r.t);
          if (r.color) s.style.color = r.color;
          if (r.bold) s.style.fontWeight = '800';
          box.append(s);
        }
      });
      d.append(box);
    }
    a.append(this.button('Find NPC', () => w.findNpc()));
    if (tab === 1) {
      a.append(this.button('Quest Helper', () => this.wm.wins.questalarm?.track(e.id), 'mh-main'));
      a.append(this.button('Give up', () => this.wm.confirm('Are you sure you want to quit?').then((ok) => {
        if (!ok || book.status(e.id) !== 1) return;
        this.wm.wins.questalarm?.remove(e.id);
        g.net?.questAction(3, e.id);
        this.sel = null; this.qCache = null;
      }), 'mh-warn'));
    }
  }
}
