import { uiText } from './wzui.js';
import { Win, allCanvases, cutText } from './windows.js';
import { richText, drawRich } from './richtext.js';
import { UI_W, UI_H } from '../view.js';
import { jobName } from '../data.js';

/**
 * The Medal window (UIWindow.img/Title, 260x374; UI 0x1F, key 27). Its medals are the quests of the "Title" area
 * (Etc/QuestCategory.img) that have a start NPC, each with its medalCategory (none: 0) and viewMedalItem.
 *
 * Tabs (Tab/enabled|disabled/0-4, 50 wide, from (4, 25)): Basic lists the medals you have (completed), the others
 * the medals of category 0-3 (Job, General, Challenge, Event) you haven't finished.
 *   Basic: backgrnd2 at (3, 45) with "Number of medals obtained: n" in bold #333333 at (58, 57); rows from y 96.
 *     The medal you wear gets icon2 (animated) at (13, row + 5). VScr5 at (239, 93), 245 long.
 *   A category: rows from y 48 in the area (7, 48) 230x291. Each group (in progress: "Title being challenged (n)",
 *     not started: "Obtainable Title (n)") has a 25px header: an 18px #9fb5ce strip at (7, row) 230 wide, its text in
 *     white at (29, row + 4), and BtMin / BtMax at (10, row + 3) folding the group. VScr5 at (239, 48), 290 long.
 *   A medal row is 49px: backgrnd4 at (7, row), the medal's icon in the box at (15, row + 7), its name in bold #346e80
 *     at (55, row + 8) cut to 170px, and under it at (55, row + 27) in 11px #999999 the date it ended ("Ended at
 *     %d/%d/%d at %02d:00") or its level and job limits ("Over Level 15, Available to all"). Pointing at the icon shows
 *     the medal item.
 * Clicking a medal in a category opens its panel (backgrnd3 305x373), a window of its own behind this one: made at
 * the window's left edge, it slides out until it is 259 past it, 1px a millisecond; hidden, it slides back to 4 and
 * goes once it gets there (the selection with it). Dragging the window puts it 259 past its left edge. Choosing a
 * category tab picks its first medal; the window opens on Basic. On the panel: the medal's name in bold
 * white at (35, 42) cut to 150px, its level limit in white at (23, 75), its start NPC standing at (242, 112), and its
 * QuestInfo text for where you are in it (the data's "\r\n" two line breaks) from (18, 130) in 16px lines, clipped
 * to (18, 124) 263x213 and scrolled 8px a step by VScr5 at (284, 124), 213 long. BtHide (286, 6) closes it. A
 * Challenge medal adds Title/BtOK at (184, 350), on until it's started (starts it), and BtGiveup at (243, 350), on
 * while it's in progress (gives it up).
 */
const TAB_X = 4, TAB_Y = 25, TAB_W = 50;
const LIST = { x: 7, y: 48, w: 230, bottom: 339 }, BASIC_TOP = 96;
const ROW_H = 49, HEAD_H = 25, PANEL = { w: 305, open: 259, shut: 4, moved: 259 };
const DESC = { x: 18, y: 124, w: 263, h: 213, top: 130, line: 16, wrap: 258 };
const GROUP_TEXT = ['Title being challenged', 'Obtainable Title'];

export class MedalWin extends Win {
  constructor(mgr) {
    const T = mgr.W.Title;
    super(mgr, T.backgrnd, (UI_W - 260) >> 1, (UI_H - 374) >> 1);
    this.T = T; this.tab = 0; this.first = 0; this.sel = null; this.folded = new Set(); this.dfirst = 0;
    this.closeBtn.x = 243; this.closePinned = true;
    this.hideBtn = this.button(mgr.B.BtHide, 286, 6, () => this.showPanel(false));   // the panel's buttons, placed on it
    this.okBtn = this.button(T.BtOK, 184, 350, () => this.startMedal());
    this.giveupBtn = this.button(T.BtGiveup, 243, 350, () => this.giveUp());
    this.minBtns = [0, 1].map((g) => this.button(mgr.B.BtMin, 10, 0, () => this.fold(g, true)));
    this.maxBtns = [0, 1].map((g) => this.button(mgr.B.BtMax, 10, 0, () => this.fold(g, false)));
    for (const b of [this.hideBtn, this.okBtn, this.giveupBtn, ...this.minBtns, ...this.maxBtns]) b.visible = false;
    // under the window only the part out from under it takes the mouse
    this.panelBtns = [this.hideBtn, this.okBtn, this.giveupBtn];
    for (const b of this.panelBtns) { b.rx = b.x; const hit = b.hit.bind(b); b.hit = (px, py) => px >= this.w && hit(px, py); }
    this.dAlive = false; this.dOpen = false; this.dx = 0; this.slide = null; this.dLeft = 0;
  }
  frames() { const B = this.mgr.B; return [...super.frames(), ...allCanvases(this.T), ...allCanvases(B.BtMin), ...allCanvases(B.BtMax), ...allCanvases(B.BtHide), ...allCanvases(B.VScr5)]; }
  onOpen() {
    this.load();
    this.tab = 0; this.first = 0; this.sel = null;
    this.dAlive = false; this.dOpen = false; this.slide = null; this.tickAt = null;
  }
  get wide() { return this.dAlive ? Math.max(this.w, this.panelX() + PANEL.w) : this.w; }
  contains(x, y) { return x >= this.x && x < this.x + this.wide && y >= this.y && y < this.y + this.h; }
  /** The "Title" area's id, the medal quests' strings and checks. */
  async load() {
    const a = this.g.assets;
    const [cats, chk, npc] = await Promise.all([a.json('Etc/QuestCategory.img'), a.json('Quest/Check.img'), a.json('String/Npc.img')]);
    this.area = Number(Object.keys(cats || {}).find((k) => cats[k] === 'Title') ?? -1);
    this.check = chk || {}; this.npcNames = npc || {};
    a.json('Etc/NpcLocation.img').then((l) => { this.npcMaps = l || {}; });
    this.mgr.namesVersion++;
  }
  /** Every medal quest: id, category, state, start NPC. */
  medals() {
    const q = this.g.quests, info = q?.info || {};
    if (!q || this.area === undefined) return [];
    const out = [];
    for (const id of Object.keys(info).map(Number).sort((x, y) => x - y)) {
      const it = info[id];
      if (Number(it?.area) !== this.area) continue;
      const npc = Number(this.check[id]?.[0]?.npc) || 0, cat = Number(it.medalCategory) || 0;
      if (!npc || cat < 0 || cat > 4) continue;
      out.push({ id, cat, npc, state: q.status(id), item: Number(it.viewMedalItem) || 0, name: String(it.name ?? '') });
    }
    return out;
  }
  /** "Over Level n" (or "No limit"), and who may take it ("Available to all", or the jobs). */
  limits(id) {
    const c = this.check[id]?.[0];
    if (!c) return ['No limit', ''];
    let lv = '';
    if (Number(c.lvmin)) lv = `Over Level ${Number(c.lvmin)}`;
    if (Number(c.lvmax)) lv = `${lv} Under Level ${Number(c.lvmax)}`.trim();
    const jobs = Object.values(c.job || {}).map(Number);
    return [lv, jobs.length ? jobText(jobs) : 'Available to all'];
  }
  /** The rows of the current tab: medals, and in a category its group headers. */
  rows() {
    const all = this.medals();
    if (this.tab === 0) return all.filter((m) => m.state === 2).map((m) => ({ kind: 'medal', ...m }));
    const cat = this.tab - 1, out = [];
    for (const g of [0, 1]) {
      const ms = all.filter((m) => m.cat === cat && m.state === (g === 0 ? 1 : 0));
      if (!ms.length) continue;
      out.push({ kind: 'head', group: g, n: ms.length });
      if (!this.folded.has(`${cat}:${g}`)) out.push(...ms.map((m) => ({ kind: 'medal', ...m })));
    }
    return out;
  }
  fold(g, on) { const k = `${this.tab - 1}:${g}`; if (on) this.folded.add(k); else this.folded.delete(k); }
  setTab(t) {
    if (t === this.tab) return;
    this.tab = t; this.first = 0; this.sel = null;
    if (this.dOpen) this.slidePanel();
    const first = t > 0 && this.rows().find((r) => r.kind === 'medal');   // a category picks its first medal
    if (first) this.pick(first);
  }
  /** Picks a medal: the panel there shows it, or one slides out with it. */
  pick(m) {
    this.sel = m.id;
    if (this.dAlive) this.fill(); else this.showPanel(true);
  }
  fill() { this.did = this.sel; this.dfirst = 0; this.desc = null; }
  /** The panel's left edge, from the window's, now. */
  panelX(now = performance.now()) {
    const s = this.slide;
    if (!s) return this.dx;
    if (now >= s.t0 + s.dur) { this.slide = null; return this.dx; }
    return Math.round(s.from + (s.to - s.from) * (now - s.t0) / s.dur);
  }
  /** Slides the panel the other way from where it is: out, or back under the window. */
  slidePanel() {
    if (!this.dAlive) return;
    const from = this.panelX(), to = this.dOpen ? PANEL.shut : PANEL.open;
    this.dLeft = Math.abs(from - to);
    this.slide = { from, to, t0: performance.now(), dur: this.dLeft };
    this.dx = to; this.dOpen = !this.dOpen;
  }
  /** Makes the panel for the selection and slides it out (nothing when there is one), or slides it away. */
  showPanel(open) {
    if (!this.sel) open = false;
    if (!open) { this.slidePanel(); return; }
    if (this.dAlive) return;
    this.dAlive = true; this.dOpen = false; this.dx = 0; this.slide = null; this.px = this.x; this.py = this.y;
    this.slidePanel();
    this.fill();
  }
  get selected() { return this.sel ? this.medals().find((m) => m.id === this.sel) || null : null; }
  /** The medal on the panel (kept while it slides away). */
  get shown() { return this.did ? this.medals().find((m) => m.id === this.did) || null : null; }
  startMedal() { const m = this.selected; if (m && m.state === 0) this.g.net?.questAction(1, m.id, m.npc, null); }
  giveUp() { const m = this.selected; if (m && m.state === 1) this.g.net?.questAction(3, m.id); }

  /** Where each visible row sits: { r, y }. Basic stops before a row that would reach y 338; a category draws on
   * while a row starts above y 335, the list's area clipping it. */
  layout(rows) {
    const out = [], basic = this.tab === 0;
    let y = basic ? BASIC_TOP : LIST.y;
    for (let i = this.first; i < rows.length; i++) {
      if (basic ? y + ROW_H >= 338 : y + 4 >= LIST.bottom) break;
      out.push({ r: rows[i], y });
      y += rows[i].kind === 'head' ? HEAD_H : ROW_H;
    }
    return out;
  }
  down(lx, ly) {
    for (let t = 0; t < 5; t++) if (lx >= TAB_X + t * TAB_W && lx < TAB_X + (t + 1) * TAB_W && ly >= TAB_Y && ly < TAB_Y + 19) { this.setTab(t); return; }
    const rows = this.rows(), sb = this.tab === 0 ? [239, 93, 245] : [239, 48, 290];
    const f = this.scrollClick(lx, ly, sb[0], sb[1], sb[2], this.first, rows.length, 4, this.mgr.B.VScr5);
    if (f !== null) { this.first = f; return; }
    if (this.dAlive && lx >= this.w) {
      const lines = this.descLayout(), max = this.descSteps(lines);
      const d = this.scrollClick(lx - this.panelX(), ly, 284, DESC.y, DESC.h, this.dfirst, max + 1, 1, this.mgr.B.VScr5);
      if (d !== null) this.dfirst = d;
      return;
    }
    if (this.tab === 0 || lx < LIST.x || lx >= LIST.x + LIST.w) return;
    for (const { r, y } of this.layout(rows)) if (r.kind === 'medal' && ly >= y && ly < y + 46) { this.pick(r); return; }
  }
  /**
   * A double-click on the panel's NPC (its frame, centred on x 242 with its bottom at 112): the World Map search
   * for it, as the quest log's Mark NPC does.
   */
  async dblclick(lx, ly) {
    const m = this.shown, dl = lx - this.panelX();
    if (!this.dAlive || lx < this.w || !m) return;
    const f = this.npcArt?.get(m.npc)?.[0], pi = f && this.mgr.image(f);
    if (!pi || dl < 242 - (pi.width >> 1) || dl >= 242 + (pi.width >> 1) || ly < 112 - pi.height || ly >= 112) return;
    const maps = Object.values(this.npcMaps?.[m.npc] || {}).map(Number).filter(Boolean);
    const WorldMap = this.mgr.wins.worldmap?.constructor;
    if (!maps.length || !(await WorldMap?.searchNpc(this.mgr, maps))) this.mgr.notice('This NPC is located at a spot not\navailable through the World Map.');
  }
  wheel(dy) {
    const m = this.mgr.mouse, lx = m.x - this.x;
    if (this.dAlive && lx >= this.w) { this.dfirst = Math.max(0, Math.min(this.descSteps(this.descLayout()), this.dfirst + Math.sign(dy))); return; }
    this.first = Math.max(0, Math.min(Math.max(0, this.rows().length - 4), this.first + Math.sign(dy)));
  }
  tooltip(lx, ly) {
    for (const { r, y } of this.layout(this.rows())) if (r.kind === 'medal' && r.item && lx > 12 && lx < 44 && ly > y + 5 && ly < y + 37) return { item: { id: r.item } };
    return null;
  }

  /** The panel's text: the medal's QuestInfo text for its state, its records filled in. */
  descLayout() {
    const m = this.shown;
    if (!m) return null;
    const key = `${m.id}:${m.state}:${Math.floor(performance.now() / 500)}`;   // its records may change: built again twice a second
    if (this.desc?.key === key) return this.desc;
    const ctx = (MedalWin.scratch ??= document.createElement('canvas').getContext('2d'));
    const info = this.g.quests.info[m.id] || {};
    let text = String(info[m.state] ?? '').replace(/\\r\\n/g, '\n\n').replace(/\\n/g, '\n');
    if (m.state === 1) {
      const sum = ['summary', 'demandSummary', 'rewardSummary'].map((k) => String(info[k] ?? '')).filter(Boolean);
      if (sum.length) text += `\n${sum.join('\n')}`;
    }
    const q = this.g.quests, mgr = this.mgr;
    const ref = {
      player: this.g.player?.name, item: (id) => mgr.itemName(id) || '', icon: (id) => mgr.icon(id),
      npc: (id) => this.npcNames?.[id]?.name || '', map: (id) => String(id), mob: (id) => String(id),
      quest: (id) => q?.name(id) ?? '', record: (id) => q?.recordText(id) ?? '', count: (id) => this.g.itemCount(id),
    };
    this.desc = { key, ...richText(ctx, text, DESC.wrap, ref, { base: '#000', size: 12, lineH: DESC.line }) };
    return this.desc;
  }
  /** How many 8px steps the panel's text scrolls. */
  descSteps(lines) { return lines ? Math.max(0, Math.ceil((lines.height - (DESC.h - (DESC.top - DESC.y))) / 8)) : 0; }

  draw(ctx) {
    const now = performance.now();
    if (this.sel && !this.rows().some((r) => r.kind === 'medal' && r.id === this.sel)) {   // gone from the tab
      this.sel = null;
      if (this.dOpen) this.slidePanel();
    }
    // a panel sliding away goes when its slide is over; a selection with no panel gets one
    if (this.dAlive && !this.dOpen) {
      this.dLeft -= now - (this.tickAt ?? now);
      if (this.dLeft < 0) { this.dAlive = false; this.slide = null; this.sel = null; }
    }
    this.tickAt = now;
    if (!this.dAlive && this.sel) this.showPanel(true);
    if (this.dAlive && (this.x !== this.px || this.y !== this.py)) { this.slide = null; this.dx = PANEL.moved; }
    this.px = this.x; this.py = this.y;
    const dx = this.dAlive ? this.panelX(now) : 0;
    for (const b of this.panelBtns) b.x = b.rx + dx;
    this.hideBtn.visible = this.dAlive;
    this.okBtn.visible = this.giveupBtn.visible = false;
    ctx.save(); ctx.translate(this.x, this.y);
    if (this.dAlive) { this.drawPanel(ctx, dx); for (const b of this.panelBtns) b.draw(ctx, this.mgr.assets); }
    const bg = this.mgr.image(this.bg);
    if (bg) ctx.drawImage(bg, 0, 0);
    this.body(ctx);
    for (const b of this.buttons) if (!this.panelBtns.includes(b)) b.draw(ctx, this.mgr.assets);
    ctx.restore();
  }
  body(ctx) {
    const m = this.mgr, T = this.T, im = (n) => m.image(n);
    for (let t = 0; t < 5; t++) {
      const tab = im(T.Tab?.[t === this.tab ? 'enabled' : 'disabled']?.[t]);
      if (tab) ctx.drawImage(tab, TAB_X + t * TAB_W, TAB_Y);
    }
    const rows = this.rows();
    for (const b of [...this.minBtns, ...this.maxBtns]) b.visible = false;
    ctx.save();
    if (this.tab === 0) {
      const bg2 = im(T.backgrnd2);
      if (bg2) ctx.drawImage(bg2, 3, 45);
      uiText(ctx, `Number of medals obtained: ${rows.length}`, 58, 57, { color: '#333333', size: 12, bold: true });
    } else {
      ctx.beginPath(); ctx.rect(LIST.x, LIST.y, LIST.w, 291); ctx.clip();
    }
    const worn = this.g.inventory?.equipped?.[-49]?.id;
    for (const { r, y } of this.layout(rows)) {
      if (r.kind === 'head') {
        ctx.fillStyle = '#9fb5ce'; ctx.fillRect(LIST.x, y, LIST.w, 18);
        uiText(ctx, `${GROUP_TEXT[r.group]} (${r.n})`, 29, y + 4, { color: '#fff', size: 12 });
        const open = !this.folded.has(`${this.tab - 1}:${r.group}`), b = (open ? this.minBtns : this.maxBtns)[r.group];
        b.visible = true; b.y = y + 3;
        continue;
      }
      const bg4 = im(T.backgrnd4);
      if (bg4) ctx.drawImage(bg4, 7, y);
      if (r.item) m.drawIcon(ctx, m.icon(r.item), 15, y + 7, r.item);
      if (this.tab === 0 && worn && worn === r.item) {
        const fr = Object.keys(T.icon2 || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => T.icon2[k]);
        const total = fr.reduce((s, f) => s + (Number(f.delay) || 100), 0);
        let e = total ? performance.now() % total : 0, f = fr[0];
        for (const k of fr) { f = k; if ((e -= Number(k.delay) || 100) < 0) break; }
        const ic = f && im(f);
        if (ic) ctx.drawImage(ic, 13, y + 5);
      }
      ctx.font = 'bold 12px Arial, sans-serif';
      uiText(ctx, cutText(ctx, r.name, 170), 55, y + 8, { color: '#346e80', size: 12, bold: true });
      let line;
      if (r.state === 2) line = endedText(this.g.quests.completed[r.id]);
      else { const [lv, job] = this.limits(r.id); line = [lv, job].filter(Boolean).join(', '); }
      ctx.font = '11px Arial, sans-serif';
      uiText(ctx, cutText(ctx, line, 170), 55, y + 27, { color: '#999999', size: 11 });
    }
    ctx.restore();
    const sb = this.tab === 0 ? [239, 93, 245] : [239, 48, 290];
    this.scrollbar(ctx, sb[0], sb[1], sb[2], this.first, rows.length, 4, m.B.VScr5);
  }
  drawPanel(ctx, X) {
    const sel = this.shown;
    if (!sel) return;
    const m = this.mgr, im = (n) => m.image(n);
    const bg = im(this.T.backgrnd3);
    if (bg) ctx.drawImage(bg, X, 0);
    ctx.font = 'bold 12px Arial, sans-serif';
    uiText(ctx, cutText(ctx, sel.name, 150), X + 35, 42, { color: '#fff', size: 12, bold: true });
    const [lv] = sel.state === 2 ? [endedText(this.g.quests.completed[sel.id])] : this.limits(sel.id);
    if (lv) uiText(ctx, lv, X + 23, 75, { color: '#fff', size: 12 });
    this.drawNpc(ctx, sel.npc, X + 242, 112);
    const lines = this.descLayout();
    if (lines) {
      ctx.save(); ctx.beginPath(); ctx.rect(X + DESC.x, DESC.y, DESC.w, DESC.h); ctx.clip();
      drawRich(ctx, lines, X + DESC.x, DESC.top - this.dfirst * 8, { size: 12, drawIcon: (n, x, y) => m.drawIcon(ctx, n, x, y) });
      ctx.restore();
    }
    const steps = this.descSteps(lines);
    this.scrollbar(ctx, X + 284, DESC.y, DESC.h, this.dfirst, steps + 1, 1, m.B.VScr5);
    if (sel.cat === 2) {
      this.okBtn.visible = this.giveupBtn.visible = true;
      this.okBtn.enabled = sel.state === 0; this.giveupBtn.enabled = sel.state === 1;
    }
  }
  /** The start NPC's stand animation (Npc/<id>.img), loaded on first sight. */
  drawNpc(ctx, id, x, y) {
    this.npcArt ??= new Map();
    if (!this.npcArt.has(id)) {
      this.npcArt.set(id, null);
      const a = this.g.assets;
      a.json(`Npc/${String(id).padStart(7, '0')}.img`).then(async (n) => {
        const link = n?.info?.link ? await a.json(`Npc/${String(n.info.link).padStart(7, '0')}.img`) : null, src = link || n;
        const st = src?.stand || {}, fr = Object.keys(st).filter((k) => /^\d+$/.test(k)).sort((p, q) => p - q).map((k) => st[k]);
        await a.preload(fr);
        this.npcArt.set(id, fr);
      }).catch(() => {});
    }
    const fr = this.npcArt.get(id);
    if (!fr?.length) return;
    const total = fr.reduce((s, f) => s + (Number(f.delay) || 100), 0);
    let e = total ? performance.now() % total : 0, f = fr[0];
    for (const k of fr) { f = k; if ((e -= Number(k.delay) || 100) < 0) break; }
    const img = this.mgr.image(f), o = f.origin || [0, 0];
    if (img) ctx.drawImage(img, x - o[0], y - o[1]);
  }
}

/** "Ended at y/m/d at hh:00" from a completion FILETIME (UTC fields, as the client turns it). */
function endedText(ft) {
  let ms = null;
  try { ms = ft === undefined || ft === true ? null : Number(BigInt(ft) / 10000n - 11644473600000n); } catch { ms = null; }
  if (ms === null) return '';
  const d = new Date(ms);
  return `Ended at ${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} at ${String(d.getUTCHours()).padStart(2, '0')}:00`;
}

/**
 * The jobs a medal is for, as the client words them: Beginner (0), Noblesse (1000, unless every Cygnus job is listed),
 * Legend (2000, unless all four Aran jobs are), Evan0 (2001, unless all ten Evan jobs are); then each class: its name
 * when all ten of its jobs are listed (Aran: its four, Evan: its ten), else each job's name.
 */
function jobText(jobs) {
  const name = (j) => jobName(j);
  const by = (c) => jobs.filter((j) => Math.floor(j / 100) === c);
  const cygnus = jobs.filter((j) => Math.floor(j / 1000) === 1);
  const out = [];
  if (jobs.includes(0)) out.push('Beginner');
  if (jobs.includes(1000) && cygnus.length !== 21) out.push('Noblesse');
  if (jobs.includes(2000) && by(21).length !== 4) out.push('Legend');
  if (jobs.includes(2001) && by(22).length !== 10) out.push('Evan0');
  for (const [c, all, n] of [[1, 'Warrior', 10], [2, 'Magician', 10], [3, 'Bowman', 10], [4, 'Thief', 10], [5, 'Pirate', 10], [21, 'Aran', 4], [22, 'Evan', 10]]) {
    const js = by(c);
    if (js.length === n) out.push(all); else out.push(...js.map(name));
  }
  return out.join(', ');
}
