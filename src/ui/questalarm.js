import { sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';
import { isPartyQuest, TITLE_AREA } from '../quests.js';
import { VIEW_W, VIEW_H } from '../view.js';

/**
 * The Quest Helper (UIWindow.img/QuestAlarm, 223 wide): "Quest Helper (n/5)" at (25, 2) over backgrndmax (25),
 * then 18px rows on backgrndcenter and backgrndbottom (5); minimised or empty it is backgrndmin (20 tall).
 * Each quest is its bold title (blue while it was added by itself and isn't done), a row per objective - required
 * quests, items, monsters, mesos - and a spacer row. Up to 5 quests: ones you add go above the ones Auto adds, which
 * come on a quest's first progress and go again after 10 minutes without any. Kept per character.
 */
const W = 223, ROW = 18, MAX = 5, AUTO_LIFE = 600000;
const RED = '#ff2020', GREEN = '#336600';
const progressColor = (have, need) => { const p = (have * 100) / (need || 1); return p < 33 ? RED : p < 66 ? '#ff3399' : p < 100 ? '#ff9900' : GREEN; };

export class QuestAlarmWin extends Win {
  constructor(mgr) {
    super(mgr, null, VIEW_W - 200, 35);
    this.w = W; this.h = 20;
    this.Q = mgr.W.QuestAlarm;
    this.closePinned = true; this.closeBtn.x = 203; this.closeBtn.y = 4;
    this.closeBtn.onClick = () => { sfx.play('UI/BtMouseClick'); this.clearAll(); };
    this.qBtn = this.button(this.Q.BtQ, 5, 4, () => mgr.toggle('quest'));
    this.autoBtn = this.button(this.Q.BtAuto, 140, 4, () => { this.state.auto = !this.state.auto; this.save(); });
    this.autoBtn.tip = () => (this.state.auto
      ? { title: 'Auto Alarm off', lines: ['When you click it, the quest will not register automatically even when the quest is in progress.'] }
      : { title: 'Auto Alarm on', lines: ['When you click it, quests in progress will register automatically and if it is not in progress for 10 minutes, it will disappear.'] });
    this.minBtn = this.button(mgr.B.BtMin, 190, 4, () => { this.state.min = true; this.save(); });
    this.maxBtn = this.button(mgr.B.BtMax, 190, 4, () => { this.state.min = false; this.save(); });
    this.excluded = new Set();   // closed by hand: not added by Auto again this session
  }
  frames() { return [...super.frames(), ...allCanvases(this.Q), ...allCanvases(this.mgr.B.BtClose2)]; }
  onOpen() { this.state.opened = true; this.save(); }

  // ---------------------------------------------------------------- what is tracked (per character)
  get key() { return `maple.questAlarm.${this.g.player?.id}`; }
  get state() {
    if (this._state?.key !== this.key) {
      let s = null;
      try { s = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch { /* storage off */ }
      const book = this.g.quests, auto = s?.autoIds || [];
      // quests no longer in progress go, and so do the ones Auto added that weren't finished
      const keep = (id) => book?.status(id) === 1 && (!auto.includes(id) || this.complete(id));
      this._state = { key: this.key, ids: (s?.ids || []).filter(keep), auto: s?.auto ?? true, min: s?.min ?? true, opened: s?.opened ?? true, autoAt: new Map() };
      for (const id of this._state.ids) if (auto.includes(id)) this._state.autoAt.set(id, performance.now());
    }
    return this._state;
  }
  save() {
    const s = this.state;
    try { localStorage.setItem(this.key, JSON.stringify({ ids: s.ids, autoIds: [...s.autoAt.keys()], auto: s.auto, min: s.min, opened: s.opened })); } catch { /* storage off */ }
  }
  tracked(id) { return this.state.ids.includes(id); }
  isAutoAdded(id) { return this.state.autoAt.has(id); }
  full() { return this.state.ids.length >= MAX; }
  /** Every item and monster count reached (the title then turns black). */
  complete(id) {
    const book = this.g.quests, r = book?.requirements(id);
    if (!r) return false;
    return r.items.every((it) => this.g.itemCount(it.id) >= (it.count ?? 0)) && r.mobs.every((m) => m.have >= m.need);
  }
  /** The quest log's button can add this one. */
  canAdd(id) {
    const book = this.g.quests;
    return book.status(id) === 1 && !isPartyQuest(id) && book.area(id) !== TITLE_AREA && book.trackable(id) && !this.full() && !this.tracked(id);
  }

  /** Added from the quest log: above every quest Auto added, and the helper opens up. */
  track(id) {
    if (!this.canAdd(id)) return;
    const s = this.state, at = s.ids.findIndex((x) => s.autoAt.has(x));
    s.ids.splice(at < 0 ? s.ids.length : at, 0, id);
    this.save();
    this.show();
  }
  /** Auto: only on real progress, and only while there is something left to do. */
  offer(id) {
    const book = this.g.quests, s = this.state;
    if (!s.auto || !this.mgr.isOpen('questalarm') || this.excluded.has(id) || this.tracked(id) || this.full()) return;
    if (book.status(id) !== 1 || isPartyQuest(id) || book.area(id) === TITLE_AREA || !book.trackable(id) || book.canComplete(id, this.g.textCtx())) return;
    const r = book.requirements(id);
    const moved = r.items.some((it) => this.g.itemCount(it.id) !== 0) || r.mobs.some((m) => m.have !== 0)
      || (r.meso && this.g.meso !== 0) || r.quests.some((q) => book.status(q.id) !== 0);
    if (!moved) return;
    s.ids.push(id); s.autoAt.set(id, performance.now());
    this.save();
    this.show();
  }
  /** A quest record came in: a tracked one keeps its place for another 10 minutes, any other may be added. */
  onRecord(id) { if (this.tracked(id)) this.touch(id); else this.offer(id); }
  touch(id) { if (this.state.autoAt.has(id)) this.state.autoAt.set(id, performance.now()); }
  /** Ready to hand in: it stays for good. */
  keep(id) { if (this.state.autoAt.delete(id)) this.save(); }
  remove(id) {
    const s = this.state;
    if (!this.tracked(id)) return;
    s.ids = s.ids.filter((x) => x !== id); s.autoAt.delete(id);
    this.save();
  }
  clearAll() { const s = this.state; s.ids = []; s.autoAt.clear(); s.opened = false; this.save(); this.mgr.close(this); }
  /** Open (and maximise) to show a quest just added. */
  show() { const s = this.state; if (s.min) { s.min = false; this.save(); } this.mgr.open('questalarm'); }

  // ---------------------------------------------------------------- frame
  /** Each quest: its title and objective rows. */
  entries() {
    const book = this.g.quests, m = this.mgr;
    if (!book) return [];
    return this.state.ids.filter((id) => book.status(id) === 1).map((id) => {
      const req = book.requirements(id), rows = [];
      for (const q of req.quests) {
        const done = book.status(q.id) === 2;
        rows.push({ label: book.name(q.id), status: done ? '(Complete)' : '(Incomplete)', color: done ? GREEN : RED });
      }
      for (const it of req.items) rows.push({ label: m.itemName(it.id) || '...', have: this.g.itemCount(it.id), need: it.count ?? 0 });
      for (const mob of req.mobs) rows.push({ label: m.strings.mob?.[mob.id]?.name || '...', have: mob.have, need: mob.need });
      if (req.meso) rows.push({ label: 'Meso', amount: String(req.meso), color: this.g.meso >= req.meso ? GREEN : RED });
      return { id, name: book.name(id), rows, blue: this.isAutoAdded(id) && !this.complete(id) };
    });
  }
  update(dt) {
    super.update?.(dt);
    // Auto's quests go after 10 minutes without progress, unless they're done
    const s = this.state, now = performance.now();
    for (const [id, t] of s.autoAt) if (now - t > AUTO_LIFE && !this.complete(id)) this.remove(id);
  }
  draw(ctx) {
    this.update(0);
    const list = this.state.min ? [] : this.entries();
    const rows = list.reduce((n, e) => n + 2 + e.rows.length, 0);
    this.h = rows ? 30 + (rows - 1) * ROW : 20;
    this.list = list;
    this.minBtn.visible = !this.state.min; this.maxBtn.visible = this.state.min;
    this.autoBtn.forceState = this.state.auto ? null : 'disabled';
    super.draw(ctx);
  }
  /** Cut to fit with "..". */
  fit(ctx, text, width) {
    if (ctx.measureText(text).width <= width) return [text, false];
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}..`).width > width) t = t.slice(0, -1);
    return [`${t}..`, true];
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), Q = this.Q;
    const bgMax = !this.state.min && this.state.ids.length;
    const bg = im(bgMax ? Q.backgrndmax : Q.backgrndmin);
    if (this.h === 20) { if (bg) ctx.drawImage(bg, 0, 0, W, 20, 0, 0, W, 20); }
    else {
      const mid = im(Q.backgrndcenter), bot = im(Q.backgrndbottom);
      if (bg) ctx.drawImage(bg, 0, 0);
      if (mid) for (let y = 25; y < this.h - 5; y += ROW) ctx.drawImage(mid, 0, y, W, Math.min(ROW, this.h - 5 - y));
      if (bot) ctx.drawImage(bot, 0, this.h - 5);
    }
    this.text(ctx, `Quest Helper (${this.state.ids.length}/${MAX})`, 25, 2 + 3, { size: 12 });
    const x2 = this.mgr.B.BtClose2?.normal?.[0], xi = im(x2);
    let y = 25;
    this.hits = [];
    for (const e of this.list) {
      ctx.font = 'bold 12px Arial, sans-serif';
      const [title, cut] = this.fit(ctx, e.name, 170), tw = ctx.measureText(title).width;
      this.text(ctx, title, 10, y + 3, { size: 12, bold: true, color: e.blue ? '#2000ff' : '#000' });
      const close = { x: Math.min(203, Math.ceil(10 + tw + 4)), y: y + 2 };
      if (xi) ctx.drawImage(xi, close.x, close.y);
      const hit = { id: e.id, title: { x: 10, y, w: tw, h: ROW }, close, full: cut ? e.name : null, top: y };
      y += ROW;
      ctx.font = '12px Arial, sans-serif';
      for (const r of e.rows) {
        if (r.status) {
          const sw = ctx.measureText(r.status).width;
          this.text(ctx, this.fit(ctx, r.label, 180 - sw)[0], 10, y + 3, { size: 12 });
          this.text(ctx, r.status, 195 - sw, y + 3, { size: 12, color: r.color });
        } else if (r.amount) {
          const lw = ctx.measureText(r.label).width;
          this.text(ctx, r.label, 10, y + 3, { size: 12 });
          this.text(ctx, r.amount, lw + 20, y + 3, { size: 12, color: r.color });
        } else {
          const have = String(r.have), need = `/${r.need}`, hw = ctx.measureText(have).width;
          const [label] = this.fit(ctx, r.label, 175 - hw - ctx.measureText(need).width), lw = ctx.measureText(label).width;
          this.text(ctx, label, 10, y + 3, { size: 12 });
          this.text(ctx, have, lw + 20, y + 3, { size: 12, color: progressColor(r.have, r.need) });
          this.text(ctx, need, lw + 20 + hw, y + 3, { size: 12 });
        }
        y += ROW;
      }
      hit.bottom = y;
      this.hits.push(hit);
      y += ROW;
    }
  }
  at(lx, ly) {
    for (const h of this.hits || []) {
      if (lx >= h.close.x && lx < h.close.x + 14 && ly >= h.close.y && ly < h.close.y + 14) return { h, part: 'close' };
      if (lx >= h.title.x && lx < h.title.x + h.title.w && ly >= h.title.y && ly < h.title.y + ROW) return { h, part: 'title' };
      if (lx >= 10 && lx < 170 && ly >= h.top + ROW && ly < h.bottom) return { h, part: 'rows' };
    }
    return null;
  }
  tooltip(lx, ly) {
    const a = this.at(lx, ly);
    if (a?.part !== 'title') return null;
    if (a.h.full) return { title: a.h.full, lines: [] };
    return this.isAutoAdded(a.h.id) ? { title: 'Register', lines: [] } : null;
  }
  down(lx, ly) {
    const a = this.at(lx, ly);
    this.justKept = null;
    if (!a) return;
    if (a.part === 'close') {
      sfx.play('UI/BtMouseClick');
      const name = this.g.quests.name(a.h.id);
      this.excluded.add(a.h.id); this.remove(a.h.id);
      this.g.hud.message(`[${name}] It has been excluded from the auto alarm and it will not be automatically reigstered until you re log-on`, '#bbbbbb');
    } else if (a.part === 'title' && this.isAutoAdded(a.h.id)) { this.keep(a.h.id); this.justKept = a.h.id; }
  }
  dblclick(lx, ly) {
    const a = this.at(lx, ly);
    if (!a || a.part === 'close' || this.justKept === a.h.id) return;
    const q = this.mgr.wins.quest;
    if (this.mgr.isOpen('quest') && q.sel === a.h.id) { this.mgr.close(q); return; }
    this.g.openQuest(a.h.id);
  }
}
