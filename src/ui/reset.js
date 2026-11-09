import { Win, cutText, drawTabStrip } from './windows.js';
import { uiText } from './wzui.js';
import { UI_W, UI_H } from '../view.js';

/** AP Reset's six rows: the stat (as the packet names it by its stat flag), and the y of its row and button. */
export const AP_ROWS = [
  { key: 'maxHp', flag: 0x800, y: 74 }, { key: 'maxMp', flag: 0x2000, y: 92 }, { key: 'str', flag: 0x40, y: 116 },
  { key: 'dex', flag: 0x80, y: 134 }, { key: 'int', flag: 0x100, y: 152 }, { key: 'luk', flag: 0x200, y: 170 },
];
// HP / MP an AP Reset takes off or puts on, by job branch (beginner, warrior, magician, bowman, thief, pirate)
const HP_LOSS = [12, 54, 10, 20, 20, 42], HP_GAIN = [8, 20, 6, 16, 16, 18], MP_GAIN = [6, 2, 18, 10, 10, 14];
export const branchOf = (job) => Math.floor((job % 1000) / 100);

/** Is g (job % 1000) one of the second / third / fourth jobs of branch base (base + 10..12, + 20..22, + 30..32)? */
const inLine = (g, base, lines) => lines.some((l) => g >= base + l && g <= base + l + 2);
/**
 * The least max HP a job may keep at a level (AP Reset can't take HP off below it), or null for jobs the client
 * doesn't check: L x 12 + 38 for a beginner; warriors L x 24 + 118 (fighters 110-112: + 418); magicians L x 10 + 54;
 * the first bowman and thief jobs L x 20 + 58, the later ones + 358; pirates L x 22 + 38, the later ones + 338.
 */
function minMaxHp(job, L) {
  const g = job % 1000;
  if (g === 0) return L * 12 + 38;
  if (g >= 110 && g <= 112) return L * 24 + 418;
  if (g === 100 || inLine(g, 100, [20, 30])) return L * 24 + 118;
  if (g === 200 || inLine(g, 200, [10, 20, 30])) return L * 10 + 54;
  if (g === 300 || g === 400) return L * 20 + 58;
  if (inLine(g, 300, [10, 20]) || inLine(g, 400, [10, 20])) return L * 20 + 358;
  if (g === 500) return L * 22 + 38;
  if (inLine(g, 500, [10, 20])) return L * 22 + 338;
  return null;
}
/**
 * The least max MP: L x 10 - 5 for a beginner; warriors L x 4 + 55 (pages and spearmen 120-132: + 155); magicians
 * L x 22 - 1, the later ones + 449; the first bowman and thief jobs L x 14 - 15, the later ones + 135; pirates
 * L x 18 - 55, the later ones + 95.
 */
function minMaxMp(job, L) {
  const g = job % 1000;
  if (g === 0) return L * 10 - 5;
  if (g === 100 || (g >= 110 && g <= 112)) return L * 4 + 55;
  if (inLine(g, 100, [20, 30])) return L * 4 + 155;
  if (g === 200) return L * 22 - 1;
  if (inLine(g, 200, [10, 20, 30])) return L * 22 + 449;
  if (g === 300 || g === 400) return L * 14 - 15;
  if (inLine(g, 300, [10, 20]) || inLine(g, 400, [10, 20])) return L * 14 + 135;
  if (g === 500) return L * 18 - 55;
  if (inLine(g, 500, [10, 20])) return L * 18 + 95;
  return null;
}
/** The MP the client counts an AP taken off as (for its minimum check): magicians INT x 3 / 40 + 30. */
function mpLoss(job, int) {
  const b = branchOf(job);
  return [8, 4, Math.trunc((int * 3) / 40) + 30, 12, 12, 16][b] ?? 0;
}

/**
 * What a row's stat changes by: HP and MP by the job's amount, the others by 1 (the MP taken off is the server's).
 */
export function apChange(row, job, give) {
  const b = Math.min(5, branchOf(job));
  if (row.key === 'maxHp') return give ? HP_GAIN[b] : HP_LOSS[b];
  if (row.key === 'maxMp') return give ? MP_GAIN[b] : 0;
  return 1;
}

/**
 * Which rows can't be picked. Taking AP off: HP / MP when no AP was ever put in them (STR + DEX + INT + LUK + free
 * AP still at what the level gives) or when it would leave them under the job's least for the level, a stat under 5, and a job's own stat at its floor (warrior STR 35, bowman /
 * thief DEX 25, magician INT 20, pirate DEX 20). Putting it on: HP / MP over 30000, a stat at 999, the one taken from.
 */
export function apDisabled(s, give, from) {
  const job = s.job || 0, b = branchOf(job), lv = s.level || 1, off = new Set();
  if (give) {
    if ((s.maxHp || 0) + apChange(AP_ROWS[0], job, true) > 30000) off.add('maxHp');
    if ((s.maxMp || 0) + apChange(AP_ROWS[1], job, true) > 30000) off.add('maxMp');
    for (const k of ['str', 'dex', 'int', 'luk']) if ((s[k] || 0) >= 999) off.add(k);
    if (from) off.add(from);
    return off;
  }
  let bonus = job % 10 === 1 ? 5 : job % 10 === 2 ? 10 : 0;
  if (Math.floor(job / 1000) === 1) bonus += lv < 70 ? lv - 1 : 69;
  if ((s.str || 0) + (s.dex || 0) + (s.int || 0) + (s.luk || 0) + (s.ap || 0) >= 20 + bonus + lv * 5) { off.add('maxHp'); off.add('maxMp'); }
  // nor below the job's least max HP / MP for the level
  const minHp = minMaxHp(job, lv), minMp = minMaxMp(job, lv);
  if (minHp !== null && (s.maxHp || 0) - (b <= 5 ? HP_LOSS[b] : 0) < minHp) off.add('maxHp');
  if (minMp !== null && (s.maxMp || 0) - mpLoss(job, s.int || 0) < minMp) off.add('maxMp');
  for (const k of ['str', 'dex', 'int', 'luk']) if ((s[k] || 0) < 5) off.add(k);
  if ((b === 1 && s.str <= 35) || ((b === 3 || b === 4) && s.dex < 26) || (b === 2 && s.int <= 20) || (b === 5 && s.dex <= 20)) off.add(b === 1 ? 'str' : b === 2 ? 'int' : 'dex');
  return off;
}

/**
 * One step of an AP Reset (UIWindow.img/Reset/AP), centred: 1 backgrnd, pick the stat to take a point from
 * (Reset/Common/BtDown); 2 backgrnd2, the stat to give it to (BtUP), where the stat it comes from is greyed (its
 * stat1 strip) and reads its new value in blue with "(-n)". A row that can't be picked keeps its colour; only its
 * button is off. Its BtClose at (156, 6). Resolves with the row picked, or null.
 */
export class ApResetWin extends Win {
  constructor(mgr, give, from, done) {
    const R = mgr.W.Reset, bg = R.AP[give ? 'backgrnd2' : 'backgrnd'];
    super(mgr, bg, Math.round((UI_W - bg._w) / 2), Math.round((UI_H - bg._h) / 2));
    this.modal = true; this.transient = true; this.done = done; this.give = give; this.from = from;
    this.closeBtn.visible = false;
    const s = this.g.stats || {};
    this.off = apDisabled(s, give, from?.key);
    for (const row of AP_ROWS) {
      const b = this.button(R.Common[give ? 'BtUP' : 'BtDown'], 153, row.y, () => this.finish(row));
      b.enabled = !this.off.has(row.key) && row.key !== from?.key;
    }
    this.button(mgr.B.BtClose, 156, 6, () => this.finish(null));
  }
  finish(row) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(row); }
  key(e) { if (e.key === 'Escape') this.finish(null); }
  body(ctx) {
    const m = this.mgr, s = this.g.stats || {}, grey = m.W.Reset.AP.stat1, from = this.from;
    AP_ROWS.forEach((row, i) => {
      if (row.key === from?.key) {
        const g = m.image(grey?.[i]), n = apChange(row, s.job || 0, false);
        if (g) ctx.drawImage(g, 8, row.y - 2);
        uiText(ctx, `${(s[row.key] ?? 0) - n}${n ? ` (-${n})` : ''}`, 62, row.y, { color: '#0000ff', size: 11 });
      } else uiText(ctx, String(s[row.key] ?? 0), 62, row.y, { color: '#000', size: 11 });
    });
  }
}

/**
 * The AP Reset's last step (Reset/AP/backgrnd3, 175x141): the stat a point comes off with "(-n)" and the one it goes
 * on with "(+n)", on their stat0 strips; OK / CANCEL.
 */
export class ApConfirmWin extends Win {
  constructor(mgr, from, to, done) {
    const R = mgr.W.Reset, bg = R.AP.backgrnd3, B = mgr.B;
    super(mgr, bg, Math.round((UI_W - bg._w) / 2), Math.round((UI_H - bg._h) / 2));
    this.modal = true; this.transient = true; this.done = done; this.from = from; this.to = to;
    this.closeBtn.visible = false;
    const cw = B.BtCancel2.normal[0]._w, ow = B.BtOK2.normal[0]._w;
    this.button(B.BtCancel2, 175 - 8 - cw, 141 - 26, () => this.finish(false));
    this.button(B.BtOK2, 175 - 10 - cw - ow, 141 - 26, () => this.finish(true));
  }
  finish(ok) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(ok); }
  key(e) { if (e.key === 'Enter') this.finish(true); else if (e.key === 'Escape') this.finish(false); }
  body(ctx) {
    const m = this.mgr, s = this.g.stats || {}, strip = m.W.Reset.AP.stat0, job = s.job || 0;
    [[this.to, true, 71], [this.from, false, 89]].forEach(([row, give, y]) => {
      const img = m.image(strip?.[AP_ROWS.indexOf(row)]);
      if (img) ctx.drawImage(img, 8, y);
      const n = apChange(row, job, give);
      uiText(ctx, `${s[row.key] ?? 0}${n ? ` ${give ? `(+${n})` : `(-${n})`}` : ''}`, 62, y + 2, { color: give ? '#0044cc' : '#cc0000', size: 11 });
    });
  }
}

/** The skill book an SP Reset (5050001-5050004) works on: your job's 1st-4th advancement book, by the item's last digit. */
export function spBook(skills, itemId) {
  const books = (skills?.jobBookIds || []).filter((b) => b % 1000 !== 0);
  return books[(itemId % 10) - 1] ?? null;
}
/** Your advancement: 1 for a 1st job, then the job's last digit + 2. */
export const advancement = (job) => (job % 100 === 0 ? 1 : (job % 10) + 2);

const SP_ROW_Y = 99, SP_ROW_H = 40;
/**
 * One step of an SP Reset (UIWindow.img/Reset/SP), centred, laid out like the Skill window: the advancement's tab
 * (its numeral, Reset/SP/Tab) along y 63; four rows every 40px from y 99, each on skill1 (skill0 when its button
 * is off) at x 7 with the icon at (9, y + 2), the name and level at (47, y + 1) / (47, y + 19) and a line under it;
 * the buttons at (131, y + 20); the VScr4 scrollbar at (153, 99); BtClose at (155, 6).
 * 1 backgrnd: the skill to take a point from (BtDown, a skill with a point); 2 backgrnd2: the skill to give it to
 * (BtUP, one that can go up; the first is shown a point lower, "(-1)" in blue). Resolves with the skill id, or null.
 */
export class SpResetWin extends Win {
  constructor(mgr, book, give, from, adv, done) {
    const R = mgr.W.Reset, bg = R.SP[give ? 'backgrnd2' : 'backgrnd'];
    super(mgr, bg, Math.round((UI_W - bg._w) / 2), Math.round((UI_H - bg._h) / 2));
    this.modal = true; this.transient = true; this.done = done; this.give = give; this.from = from; this.first = 0; this.adv = adv;
    this.closeBtn.visible = false;
    const sb = this.g.skills;
    this.ids = sb?.bookSkills(book) || [];
    this.ok = (id) => (give ? id !== from && sb.raiseState(id) === 'ok' : sb.level(id) > 0);
    this.rowBtns = [0, 1, 2, 3].map((i) => this.button(R.Common[give ? 'BtUP' : 'BtDown'], 131, SP_ROW_Y + i * SP_ROW_H + 20, () => this.pick(i)));
    this.button(mgr.B.BtClose, 155, 6, () => this.finish(null));
  }
  frames() { const W = this.mgr.W; return [...super.frames(), W.Skill.skill0, W.Skill.skill1, W.Skill.line]; }
  pick(i) { const id = this.ids[this.first + i]; if (id && this.ok(id)) this.finish(id); }
  finish(id) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(id); }
  key(e) { if (e.key === 'Escape') this.finish(null); }
  wheel(dy) { this.first = Math.max(0, Math.min(Math.max(0, this.ids.length - 4), this.first + Math.sign(dy))); }
  body(ctx) {
    const m = this.mgr, sb = this.g.skills, T = m.W.Reset.SP.Tab, k = this.adv - 1;
    drawTabStrip(ctx, m, { enabled: { 0: T?.enabled?.[k] }, disabled: { 0: T?.disabled?.[k] } }, 1, 0, 34, 63);
    this.rowBtns.forEach((b, i) => { const id = this.ids[this.first + i]; b.visible = !!id; b.enabled = !!id && this.ok(id); });
    this.ids.slice(this.first, this.first + 4).forEach((id, i) => {
      const y = SP_ROW_Y + i * SP_ROW_H, more = i < 3 && this.ids[this.first + i + 1];
      drawSkillRow(ctx, m, sb, id, y, this.ok(id), id === this.from ? -1 : 0, more);
    });
    this.scrollbar(ctx, 153, SP_ROW_Y, 156, this.first, this.ids.length, 4, m.B.VScr4);
  }
}
/** A skill row as the Skill window draws it; `change` shows the level after it in blue with "(+n)" / "(-n)". */
function drawSkillRow(ctx, m, sb, id, y, on, change = 0, line = false) {
  const W = m.W.Skill, n = sb?.node(id), row = m.image(on ? W.skill1 : W.skill0);
  if (row) ctx.drawImage(row, 7, y);
  const icon = m.image(on ? sb?.icon(id) : n?.iconDisabled || sb?.icon(id));
  if (icon) ctx.drawImage(icon, 9, y + 2);
  ctx.save(); ctx.font = '12px Arial, "Segoe UI", sans-serif';
  uiText(ctx, cutText(ctx, sb?.name(id) || '', 104), 47, y + 3, { color: '#000', size: 12 });
  ctx.restore();
  const lv = sb?.level(id) || 0;
  uiText(ctx, change ? `${lv + change} (${change > 0 ? '+' : ''}${change})` : String(lv), 47, y + 21, { color: change ? '#0000ff' : '#000', size: 12 });
  if (line) { const l = m.image(W.line); if (l) ctx.drawImage(l, 7, y + 37); }
}
/** The SP Reset's last step (Reset/SP/backgrnd3, 175x231): the skill given a point "(+1)" and the one it comes off "(-1)"; OK / CANCEL. */
export class SpConfirmWin extends Win {
  constructor(mgr, from, to, done) {
    const bg = mgr.W.Reset.SP.backgrnd3, B = mgr.B;
    super(mgr, bg, Math.round((UI_W - bg._w) / 2), Math.round((UI_H - bg._h) / 2));
    this.modal = true; this.transient = true; this.done = done; this.from = from; this.to = to;
    this.closeBtn.visible = false;
    const cw = B.BtCancel2.normal[0]._w, ow = B.BtOK2.normal[0]._w;
    this.button(B.BtCancel2, 175 - 8 - cw, 231 - 26, () => this.finish(false));
    this.button(B.BtOK2, 175 - 10 - cw - ow, 231 - 26, () => this.finish(true));
  }
  frames() { const W = this.mgr.W; return [...super.frames(), W.Skill.skill1, W.Skill.line]; }
  finish(ok) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(ok); }
  key(e) { if (e.key === 'Enter') this.finish(true); else if (e.key === 'Escape') this.finish(false); }
  body(ctx) {
    const m = this.mgr, sb = this.g.skills;
    drawSkillRow(ctx, m, sb, this.to, SP_ROW_Y, true, 1, true);
    drawSkillRow(ctx, m, sb, this.from, SP_ROW_Y + SP_ROW_H, true, -1);
  }
}
