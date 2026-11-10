import { uiText, wrapText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W, UI_H } from '../view.js';

/**
 * The note inbox (UIWindow.img/Memo/backgrnd, 295x240, centred, modal), opened from the "You have a new note" balloon.
 * "YOU HAVE RECEIVED n NOTE(S)." from (100, 32) in 9px Tahoma #ccffff, the number bold. The notes are laid in a
 * 260x139 area at (8, 66), scrolled 10px a step: each one innerTop (24) with its sender in 12px Arial #24476b at
 * (10, 3) and its time ("%d.%02d.%02d %02d:%02d" in FontTime, 1px apart, "space" 5) at (169, 6); an innerCenter (18)
 * per line of its text, wrapped at 256 in 12px black at (8, 3) (a type 3 note's first line from after its "_"); a
 * fame note (type 1 or 2) three more: blank, "<sender>has received a gift." and "<you>'s fame has gone up +1." in
 * 11px #b2b2b2; then innerBottom (8) and 7px before the next. BtOK2 (241, 216) and BtClose (276, 6) both ask
 * "All unsaved notes will be deleted. Are you sure you want to move on?" and on yes discard every note (NOTE_ACTION 1).
 * The scrollbar's place isn't in the client's code that survives: it sits beside the area at (272, 66).
 */
const AREA = { x: 8, y: 66, w: 260, h: 139 }, SCROLL = { x: 272, y: 66, h: 139 };

export class MemoWin extends Win {
  constructor(mgr, notes) {
    const M = mgr.W.Memo;
    super(mgr, M.backgrnd, (UI_W - 295) >> 1, (UI_H - 240) >> 1);
    this.buttons = [];
    this.M = M; this.notes = notes; this.modal = true; this.first = 0;
    this.button(mgr.B.BtClose, 276, 6, () => this.leave());
    this.button(mgr.B.BtOK2, 241, 216, () => this.leave());
    this.layout();
  }
  frames() { const M = this.M; return [this.bg, M.innerTop, M.innerCenter, M.innerBottom, ...Object.values(M.FontTime || {}), ...this.buttons.flatMap((b) => b.frames())].filter((n) => n?._canvas); }
  /** Each note's rows and its top, and the whole height. */
  layout() {
    const ctx = (MemoWin.scratch ??= document.createElement('canvas').getContext('2d'));
    ctx.font = '12px Arial, sans-serif';
    const me = this.g.player?.name || '';
    let y = 0;
    this.rows = this.notes.map((n) => {
      let text = String(n.text ?? '');
      if (n.fame === 3) { const i = text.indexOf('_'); if (i >= 0) text = text.slice(i + 1); }
      const lines = text.replace(/\r\n|\r/g, '\n').split('\n').flatMap((l) => (l ? wrapText(ctx, l, 256, 12) : ['']));
      const extra = n.fame > 0 && n.fame < 3 ? ['', `${n.from}has received a gift.`, `${me}'s fame has gone up +1.`] : [];
      const row = { n, y, lines, extra };
      y += 24 + (lines.length + extra.length) * 18 + 8 + 7;
      return row;
    });
    this.total = y;
    this.steps = Math.max(0, Math.trunc(y / 10) - 12);
  }
  /** OK or X: on yes, every note goes (the client keeps none). */
  async leave() {
    if (this.asking) return;
    this.asking = true;
    const ok = await this.mgr.confirm('All unsaved notes will be deleted.\r\nAre you sure you want to move on?');
    this.asking = false;
    if (!ok) return;
    this.g.net?.discardNotes(this.notes, this.g.freeSlots?.(4) ?? 0);
    this.mgr.close(this);
  }
  key(e) { if (e.key === 'Escape') this.leave(); }
  wheel(dy) { this.first = Math.max(0, Math.min(this.steps, this.first + Math.sign(dy))); }
  down(lx, ly) {
    const f = this.scrollClick(lx, ly, SCROLL.x, SCROLL.y, SCROLL.h, this.first, this.steps + 1, 1);
    if (f !== null) this.first = f;
  }
  /** FontTime: one picture a character, 1px apart; "space" is a gap. */
  timeText(ctx, s, x, y) {
    const F = this.M.FontTime || {};
    for (const ch of s) {
      if (ch === ' ') { x += (Number(F.space) || 5) + 1; continue; }
      const im = this.mgr.image(F[ch]);
      if (im) { ctx.drawImage(im, x, y); x += im.width + 1; }
    }
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), M = this.M, count = String(this.notes.length);
    ctx.font = '9px Tahoma, sans-serif';
    const pre = 'YOU HAVE RECEIVED ', pw = ctx.measureText(pre).width;
    uiText(ctx, pre, 100, 32, { color: '#ccffff', size: 9, font: 'Tahoma' });
    ctx.font = 'bold 9px Tahoma, sans-serif';
    const cw = ctx.measureText(count).width;
    uiText(ctx, count, 100 + pw, 32, { color: '#ccffff', size: 9, bold: true, font: 'Tahoma' });
    uiText(ctx, ' NOTE(S).', 100 + pw + cw, 32, { color: '#ccffff', size: 9, font: 'Tahoma' });
    ctx.save(); ctx.beginPath(); ctx.rect(AREA.x, AREA.y, AREA.w, AREA.h); ctx.clip(); ctx.translate(AREA.x, AREA.y);
    const top = im(M.innerTop), mid = im(M.innerCenter), bot = im(M.innerBottom);
    for (const r of this.rows) {
      let y = r.y - this.first * 10;
      if (y >= AREA.h) break;
      if (top) ctx.drawImage(top, 0, y);
      uiText(ctx, r.n.from, 10, y + 3, { color: '#24476b', size: 12 });
      const d = noteTime(r.n.time);
      if (d) this.timeText(ctx, d, 169, y + 6);
      y += 24;
      for (const l of r.lines) { if (mid) ctx.drawImage(mid, 0, y); if (l) uiText(ctx, l, 8, y + 3, { color: '#000', size: 12 }); y += 18; }
      for (const l of r.extra) { if (mid) ctx.drawImage(mid, 0, y); if (l) uiText(ctx, l, 8, y + 3, { color: '#b2b2b2', size: 11 }); y += 18; }
      if (bot) ctx.drawImage(bot, 0, y);
    }
    ctx.restore();
    this.scrollbar(ctx, SCROLL.x, SCROLL.y, SCROLL.h, this.first, this.steps + 1, 1);
  }
}

/** A note's FILETIME as "y.mm.dd hh:mm" (UTC fields, as the client turns it). */
function noteTime(ft) {
  let ms;
  try { ms = Number(BigInt(ft) / 10000n - 11644473600000n); } catch { return ''; }
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms), p = (v) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
