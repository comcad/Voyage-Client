import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { UI_W } from '../view.js';
import { advanceName } from '../data.js';

/**
 * Party Search (UIWindow.img/PartySearch, backgrnd 305x407): a party leader looks for members. Its pictures carry
 * all its words but the jobs': PartyMember/party0 (the FIND PARTY MEMBER bar) at (6, 53), party1 at (6, 84) with
 * party2 (LEVEL [min] ABOVE [max] UNDER  PARTY MEMBER [n] PPL) at (9, 95), party3 (ALL JOBS) at (9, 130) and party4
 * (the job panels) at (9, 151); its close box at (283, 8). The three edit boxes, white, 25x15, digits only (3, 3 and 1
 * long; Tab goes on to the next): the lowest level at (54, 98), the highest at (114, 98), how many members at
 * (240, 98). START (5, 373), PAUSE (73, 373) and STOP (141, 373) are always there, lit by the search's state (see
 * draw). It opens beside the user list when that is open, otherwise where it was last left.
 *
 * Its 25 check boxes (Basic.img CheckBox: off, on, and the two greyed) make the job mask, bit n for box n: box 0 is
 * all of them (its words are on the ALL JOBS bar); each panel's first box is its first job and ticks the rest of its
 * panel; the others are the later jobs, named by your level (second jobs to 69, third 70-119, fourth from 120).
 * Under level 30 only the first jobs show (the rest are still in the mask).
 */
// [x, y, job (for a later job: its second job, the tier added), panel's first box]
export const BOXES = [
  [10, 131, null, false],
  [10, 153, 0, true], [10, 206, 2100, true],
  [94, 153, 100, true], [94, 173, 110], [94, 193, 120], [94, 213, 130], [94, 233, 1110],
  [186, 153, 200, true], [186, 173, 210], [186, 193, 220], [186, 213, 230], [186, 233, 1210],
  [10, 258, 500, true], [10, 278, 510], [10, 298, 520], [10, 318, 1510],
  [94, 258, 400, true], [94, 278, 410], [94, 298, 420], [94, 318, 1410],
  [186, 258, 300, true], [186, 278, 310], [186, 298, 320], [186, 318, 1310],
];
/** Each panel's first box and the boxes it ticks. */
export const PANELS = { 3: [4, 5, 6, 7], 8: [9, 10, 11, 12], 13: [14, 15, 16], 17: [18, 19, 20], 21: [22, 23, 24] };
/** All a leader under level 30 sees: All, Beginner, Aran and the first jobs. */
export const FIRST_JOBS = [0, 1, 2, 3, 8, 13, 17, 21];
const FIELDS = [[54, 3], [114, 3], [240, 1]];
const HEAD = '#777f88', SUB = '#aaaaaa', GREY = '#8c8a8c';

/** A leader's level tier: the later jobs' names (0 second jobs, 1 third from 70, 2 fourth from 120). */
const tierOf = (lv) => (lv >= 70 && lv <= 119 ? 1 : lv >= 120 && lv <= 200 ? 2 : 0);

export class PartySearchWin extends Win {
  constructor(mgr) {
    const P = mgr.W.PartySearch;
    super(mgr, P.backgrnd, 500, 100);
    this.P = P; this.C = mgr.B.CheckBox;
    this.closeBtn.x = 283; this.closeBtn.y = 8; this.closePinned = true;
    this.startBtn = this.button(P.BtStart, 5, 373, () => this.start());
    this.pauseBtn = this.button(P.BtPause, 73, 373, () => this.pause());
    this.stopBtn = this.button(P.BtStop, 141, 373, () => this.stop());
    this.checked = BOXES.map(() => true);
    this.tier = 0; this.low = true;
    const field = ([x, max], i) => {
      const f = new TextField(mgr.game.statusBar.layer, x, 0, 25, 15, { max, color: '#000' });
      f.rect.x0 = x; f.el.inputMode = 'numeric';
      f.el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') { e.preventDefault(); this.fieldList[(i + 1) % 3].el.focus(); }
        else if (e.key === 'Escape') f.el.blur();
      });
      f.el.addEventListener('input', () => { f.value = f.value.replace(/\D/g, ''); });
      f.show(false);
      return f;
    };
    this.fieldList = FIELDS.map(field);
    this.fields = { min: this.fieldList[0], max: this.fieldList[1], members: this.fieldList[2] };
  }
  frames() { return [...super.frames(), ...allCanvases(this.P), ...allCanvases(this.C)]; }
  /** The search, kept with your session: 0 none, 1 searching, 2 paused, with what it looks for. */
  get search() { return this.g.partySearch; }
  get state() { return this.search?.state || 0; }

  onOpen() {
    const ul = this.mgr.wins.userlist;
    if (ul && this.mgr.isOpen('userlist')) { this.x = ul.x + ul.w; this.y = ul.y; this.mgr.fit(this); }
    this.prepare();
    this.showFields(true);
  }
  /** Your level's tier and which boxes show; with `fill`, what the boxes and edits start with (opening it does). */
  prepare(fill = true) {
    const lv = this.g.stats?.level || 1;
    this.tier = tierOf(lv); this.low = lv <= 29;
    if (!fill) return;
    const s = this.search;
    if (s && s.state) {
      // a search that is on (or paused) shows what it looks for
      const show = (v) => (v >= 1 ? String(v) : '');
      this.fields.min.value = show(s.min); this.fields.max.value = show(s.max); this.fields.members.value = show(s.members);
      this.checked = BOXES.map((_, n) => !!(s.mask & (1 << n)));
    } else this.defaults();
  }
  onClose() { this.showFields(false); }
  showFields(v) { for (const f of this.fieldList) { f.show(v); if (!v) f.el.blur(); } }
  /** Every box ticked, your level less 15 (0 under 1) to your level plus 15 (200 at most), six members. */
  defaults() {
    const lv = this.g.stats?.level || 1, min = lv - 15 < 1 ? 0 : lv - 15;
    this.checked = BOXES.map(() => true);
    this.fields.min.value = String(min); this.fields.max.value = String(Math.min(lv + 15, 200)); this.fields.members.value = '6';
  }
  /** The job mask: bit n for each ticked box n. */
  mask() { return this.checked.reduce((m, on, n) => (on ? m | (1 << n) : m), 0); }
  /**
   * A box clicked (or tapped): it flips; All sets every job to it, a panel's first box its panel. Then each panel's
   * first box is ticked only while all its panel is, and All only while every first job (Beginner and Aran too) is.
   */
  toggle(n) {
    const on = !this.checked[n];
    this.checked[n] = on;
    if (n === 0) for (let i = 1; i < BOXES.length; i++) this.checked[i] = on;
    for (const i of PANELS[n] || []) this.checked[i] = on;
    for (const [head, list] of Object.entries(PANELS)) this.checked[head] = list.every((i) => this.checked[i]);
    this.checked[0] = [1, 2, 3, 8, 13, 17, 21].every((i) => this.checked[i]);
  }
  /** Box n's name, by your level's tier. */
  label(n) {
    const [, , job, head] = BOXES[n];
    return job === null ? '' : advanceName(head ? job : job + this.tier);
  }

  // ---------------------------------------------------------------- searching
  /**
   * START, as the client checks it: you must lead a party ("You are not the master of the party."); nothing while a
   * search is on. Then, the first that fails saying so: the highest level at most 200; at most 30 levels apart; the
   * lowest no higher than the highest; your own level inside them; 2-6 members; more members than your party has
   * now; at least one job. PARTY_SEARCH_START then goes (lowest, highest, members, the job mask).
   */
  start() {
    const g = this.g, s = this.search, party = g.party, say = (t) => this.mgr.notice(t);
    if (!party || party.leader !== g.player.id) { say('You are not the master of the party.'); return; }
    if (!s || s.state === 1) return;
    const num = (f) => parseInt(f.value, 10) || 0, lv = g.stats?.level || 1;
    const min = num(this.fields.min), max = num(this.fields.max), members = num(this.fields.members), mask = this.mask();
    if (max >= 201) return say('Currently, the highest level in MapleStory\r\nis at 200!');
    if (max - min > 30) return say('You can only search for party\r\nmembers within a range of 30 levels.');
    if (min > max) return say('The min. value is higher than the max!');
    if (lv < min || lv > max) return say('The range of level for search has to include your own level.');
    if (members < 2 || members > 6) return say('You may enter with 2-6 party members.');
    if (members <= party.members.length) return say(`Your party already has ${members} or more members.`);
    if (!mask) return say("Please enter the Job class you'd like to party with.");
    if (mask >>> 25) return;
    Object.assign(s, { state: 1, min, max, members, mask });
    g.net?.partySearchStart(min, max, members, mask);
  }
  /** PAUSE (while searching): the server stops looking until START again. */
  pause() {
    const s = this.search;
    if (!s || s.state !== 1) return;
    s.state = 2;
    this.g.net?.partySearchStop();
  }
  /** STOP (searching or paused): the window back to its first values and the search forgotten. */
  stop() {
    if (!this.state) return;
    this.defaults();
    this.g.partySearchClear();
  }

  // ---------------------------------------------------------------- frame
  /** Lit by the search's state: none START only; searching PAUSE and STOP (boxes and edits greyed); paused START and STOP. */
  draw(ctx) {
    const st = this.state;
    this.startBtn.enabled = st !== 1; this.pauseBtn.enabled = st === 1; this.stopBtn.enabled = st !== 0;
    for (const f of this.fieldList) f.el.disabled = st === 1;
    super.draw(ctx);
    const scale = this.g.canvas.clientWidth / UI_W;
    for (const f of this.fieldList) { f.rect.x = this.x + f.rect.x0; f.rect.y = this.y + 98; f.layout({ left: 0, top: 0 }, scale); }
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), P = this.P.PartyMember;
    const put = (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x, y); };
    put(P.party0, 6, 53); put(P.party1, 6, 84); put(P.party2, 9, 95); put(P.party3, 9, 130); put(P.party4, 9, 151);
    ctx.fillStyle = '#fff';
    for (const [x] of FIELDS) ctx.fillRect(x, 98, 25, 15);
    const on = this.state !== 1;
    BOXES.forEach(([x, y, , head], n) => {
      if (this.low && !FIRST_JOBS.includes(n)) return;
      put(this.C[on ? (this.checked[n] ? 1 : 0) : (this.checked[n] ? 3 : 2)], x + 2, y + 1);
      const t = this.label(n);
      // its name from (x + 18, y + 2) as the client places it; canvas Arial sits a pixel right and 2 higher than the
      // client's at that spot, so it is drawn from (x + 17, y + 4)
      if (t) uiText(ctx, t, x + 17, y + 4, { color: on ? (head ? HEAD : SUB) : GREY, size: 11 });
    });
  }
  down(lx, ly) {
    if (this.state === 1) return;   // greyed while searching
    const ctxMeasure = (PartySearchWin.measure ??= document.createElement('canvas').getContext('2d'));
    ctxMeasure.font = '11px Arial';
    for (let n = 0; n < BOXES.length; n++) {
      if (this.low && !FIRST_JOBS.includes(n)) continue;
      const [x, y] = BOXES[n], w = 18 + Math.ceil(ctxMeasure.measureText(this.label(n)).width);
      if (lx >= x && lx < x + Math.max(16, w) && ly >= y && ly < y + 14) { this.toggle(n); sfx.play('UI/BtMouseClick'); return; }
    }
  }
}
