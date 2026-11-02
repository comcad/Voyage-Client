import { sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';

/**
 * The Quest Helper (UIWindow.img/QuestAlarm, 223 wide), laid out as openms recovered it: backgrndmax (25)
 * with BtQ (5,4) for the quest log, BtAuto (140,4), Basic BtMin / BtMax (190,4) and BtClose (203,4); then
 * 18px rows on backgrndcenter and backgrndbottom (5). Each tracked quest is its bold 12px title (with a small
 * close box at 203 to stop tracking it), a row per objective - the label in black and have/need in a colour
 * by progress (red < 33%, pink < 66%, orange, green when done) - and a spacer row. Minimised or empty it is
 * backgrndmin (20 tall). With Auto on, quests you start are added by themselves. Kept per character here.
 */
const W = 223, ROW = 18;
const progressColor = (have, need) => (have >= need ? '#336600' : (have * 100) / need < 33 ? '#ff2020' : (have * 100) / need < 66 ? '#ff3399' : '#ff9900');

export class QuestAlarmWin extends Win {
  constructor(mgr) {
    super(mgr, null, 800 - W - 4, 116);
    this.w = W; this.h = 20;
    this.Q = mgr.W.QuestAlarm; this.min = false;
    this.closePinned = true; this.closeBtn.x = 203; this.closeBtn.y = 4;
    this.button(this.Q.BtQ, 5, 4, () => mgr.toggle('quest'));
    this.button(this.Q.BtAuto, 140, 4, () => {
      this.state.auto = !this.state.auto; this.save();
      this.g.hud?.message(`Quest Helper: new quests ${this.state.auto ? 'are' : 'are no longer'} added automatically.`, '#fff');
    });
    this.minBtn = this.button(mgr.B.BtMin, 190, 4, () => { this.min = true; });
    this.maxBtn = this.button(mgr.B.BtMax, 190, 4, () => { this.min = false; });
  }
  frames() { return [...super.frames(), ...allCanvases(this.Q), ...allCanvases(this.mgr.B.BtClose)]; }

  // ---------------------------------------------------------------- what is tracked (per character)
  get key() { return `maple.questAlarm.${this.g.player?.id}`; }
  get state() {
    if (this._state?.key !== this.key) {
      let s = null;
      try { s = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch { /* storage off */ }
      this._state = { key: this.key, ids: s?.ids || [], auto: s?.auto ?? true };
    }
    return this._state;
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify({ ids: this.state.ids, auto: this.state.auto })); } catch { /* storage off */ } }
  tracked(id) { return this.state.ids.includes(id); }
  track(id, on = !this.tracked(id)) {
    const s = this.state;
    s.ids = s.ids.filter((x) => x !== id);
    if (on) s.ids.push(id);
    this.save();
    if (on) this.mgr.open('questalarm');
  }
  /** A quest you just started (Auto adds it). */
  started(id) { if (this.state.auto && !this.g.quests.isAuto?.(id)) this.track(id, true); }

  /** The quests shown: tracked and still in progress, each with its objective rows. */
  entries() {
    const book = this.g.quests, m = this.mgr;
    if (!book) return [];
    return this.state.ids.filter((id) => book.status(id) === 1).map((id) => {
      const req = book.requirements(id), rows = [];
      for (const mob of req.mobs) rows.push({ label: m.strings.mob?.[mob.id]?.name || `Monster ${mob.id}`, have: Math.min(mob.have, mob.need), need: mob.need });
      for (const it of req.items) if (it.count > 0) rows.push({ label: m.itemName(it.id) || '...', have: Math.min(this.g.itemCount(it.id), it.count), need: it.count });
      return { id, name: book.name(id), rows };
    });
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    const list = this.min ? [] : this.entries();
    const rows = list.reduce((n, e) => n + 2 + e.rows.length, 0);
    this.h = rows ? 30 + (rows - 1) * ROW : 20;
    this.list = list;
    this.minBtn.visible = !this.min; this.maxBtn.visible = this.min;
    super.draw(ctx);
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), Q = this.Q;
    if (this.h === 20) { const b = im(Q.backgrndmin); if (b) ctx.drawImage(b, 0, 0); return; }
    const top = im(Q.backgrndmax), mid = im(Q.backgrndcenter), bot = im(Q.backgrndbottom);
    if (top) ctx.drawImage(top, 0, 0);
    if (mid) for (let y = 25; y < this.h - 5; y += ROW) ctx.drawImage(mid, 0, y, W, Math.min(ROW, this.h - 5 - y));
    if (bot) ctx.drawImage(bot, 0, this.h - 5);
    const x = im(this.mgr.B.BtClose?.normal?.[0]);
    let y = 25;
    this.removeHits = [];
    for (const e of this.list) {
      ctx.save(); ctx.beginPath(); ctx.rect(10, y, 187, ROW); ctx.clip();
      this.text(ctx, e.name, 10, y + 3, { size: 12, bold: true });
      ctx.restore();
      if (x) { ctx.drawImage(x, 203, y + 2); this.removeHits.push([y + 2, e.id]); }
      y += ROW;
      for (const r of e.rows) {
        const count = `${r.have}/${r.need}`;
        ctx.font = '12px Arial, sans-serif';
        const cw = ctx.measureText(count).width;
        ctx.save(); ctx.beginPath(); ctx.rect(10, y, 185 - cw - 10, ROW); ctx.clip();
        this.text(ctx, r.label, 10, y + 3, { size: 12 });
        ctx.restore();
        const hw = ctx.measureText(String(r.have)).width;
        this.text(ctx, String(r.have), 195 - cw, y + 3, { size: 12, color: progressColor(r.have, r.need) });
        this.text(ctx, `/${r.need}`, 195 - cw + hw, y + 3, { size: 12 });
        y += ROW;
      }
      y += ROW;
    }
  }
  down(lx, ly) {
    const hit = lx >= 203 && lx < 215 && this.removeHits?.find(([y]) => ly >= y && ly < y + 12);
    if (hit) { sfx.play('UI/BtMouseClick'); this.track(hit[1], false); }
  }
  dblclick(lx, ly) {
    // a quest's title opens it in the quest log
    let y = 25;
    for (const e of this.list || []) {
      if (ly >= y && ly < y + ROW && lx < 200) { const q = this.mgr.open('quest'); if (q) { q.tab = 1; q.select(e.id); } return; }
      y += ROW * (2 + e.rows.length);
    }
  }
}
