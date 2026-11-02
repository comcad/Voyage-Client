import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win, allCanvases } from './windows.js';

/**
 * Party Search (UIWindow.img/PartySearch, backgrnd 305x407): title y 8-21, tab strip y 22-42 (Tab 0 Party,
 * 1 PartyMember), a red rule at 44, the white page from y 50, the button band y 382-404.
 *   Find Party Member (a party leader looks for people): PartyMember/party0 header, party1 note, party2 the
 *   LEVEL [min] ABOVE [max] UNDER  PARTY MEMBER [n] PPL row (boxes at x 45 / 105 / 231 of it), party3 ALL JOBS,
 *   party4 the job boxes (287x187: two small boxes on the left, two tall ones, three below).
 *   START sends the search (PARTY_SEARCH_START: min, max, members, job bits); PAUSE / STOP end it
 *   (PARTY_SEARCH_UPDATE). The server then invites matching players near you, and they see "PS: <you>".
 *   Find Party: Party/party0..3. Cosmic takes no registration - anyone without a party can be invited.
 * Job bits follow Cosmic's PartySearchCoordinator table.
 */
const GROUPS = [
  // [box x, box y, width, title, [[job bit, name]...]] inside party4
  [0, 0, 80, 'Beginner', [[1, 'Beginner']]],
  [0, 53, 80, 'Legend', [[2, 'Aran'], [25, 'Evan']]],
  [84, 0, 90, 'Warrior', [[3, 'Warrior'], [4, 'Fighter'], [5, 'Page'], [6, 'Spearman'], [7, 'Dawn Warrior']]],
  [177, 0, 110, 'Magician', [[8, 'Magician'], [9, 'Wizard (F/P)'], [10, 'Wizard (I/L)'], [11, 'Cleric'], [12, 'Blaze Wizard']]],
  [0, 104, 80, 'Thief', [[17, 'Thief'], [18, 'Assassin'], [19, 'Bandit'], [20, 'Night Walker']]],
  [84, 104, 90, 'Bowman', [[21, 'Bowman'], [22, 'Hunter'], [23, 'Crossbowman'], [24, 'Wind Archer']]],
  [177, 104, 110, 'Pirate', [[13, 'Pirate'], [14, 'Brawler'], [15, 'Gunslinger'], [16, 'Thunder Breaker']]],
];
const ALL_BITS = GROUPS.flatMap((g) => g[4].map(([b]) => b));
const JOBS = { x: 9, y: 170 }, ROW = 15;

export class PartySearchWin extends Win {
  constructor(mgr) {
    const P = mgr.W.PartySearch;
    super(mgr, P.backgrnd, 240, 80);
    this.P = P; this.tab = 1; this.state = 'idle'; this.bits = new Set(ALL_BITS);
    const by = 384;
    this.startBtn = this.button(P.BtStart, 100, by, () => this.start());
    this.pauseBtn = this.button(P.BtPause, 100, by, () => this.stop('paused'));
    this.stopBtn = this.button(P.BtStop, 168, by, () => this.stop('idle'));
    const field = (x, max) => {
      const f = new TextField(mgr.game.statusBar.layer, x, 0, 24, 14, { max, color: '#000' });
      f.rect.x0 = x; f.el.inputMode = 'numeric';
      f.el.addEventListener('keydown', (e) => e.stopPropagation());
      f.el.addEventListener('input', () => { f.value = f.value.replace(/\D/g, ''); });
      f.show(false);
      return f;
    };
    this.fields = { min: field(16 + 45, 3), max: field(16 + 105, 3), members: field(16 + 231, 1) };
  }
  frames() { return [...super.frames(), ...allCanvases(this.P)]; }
  get leader() { const p = this.g.party; return !!p && p.leader === this.g.player.id; }

  onOpen() {
    const lv = this.g.stats?.level || 1, f = this.fields;
    if (!f.min.value) f.min.value = String(Math.max(1, lv - 10));
    if (!f.max.value) f.max.value = String(Math.min(200, lv + 10));
    if (!f.members.value) f.members.value = '6';
    this.showFields(this.tab === 1);
  }
  onClose() { this.showFields(false); }
  showFields(v) { for (const f of Object.values(this.fields)) { f.show(v); if (!v) f.el.blur(); } }

  // ---------------------------------------------------------------- searching
  start() {
    if (!this.leader) { this.mgr.notice(this.g.party ? 'Only the party leader can search for members.' : 'Create a party first, then search for members to fill it.'); return; }
    const lv = this.g.stats?.level || 1;
    const min = Number(this.fields.min.value) || 1, max = Number(this.fields.max.value) || 200;
    const members = Math.max(2, Math.min(6, Number(this.fields.members.value) || 6));
    if (min > max) { this.mgr.notice('The lowest level is higher than the highest.'); return; }
    if (max - min > 30) { this.mgr.notice('You can only search for party members within a range of 30 levels.'); return; }
    if (lv < min || lv > max) { this.mgr.notice('The range of levels has to include your own level.'); return; }
    if (!this.bits.size) { this.mgr.notice('Choose at least one job to search for.'); return; }
    let jobs = 0;
    for (const b of this.bits) jobs |= 1 << b;
    this.g.net?.partySearchStart(min, max, members, jobs);
    this.state = 'searching'; this.startedAt = performance.now();
    this.g.hud?.message('Party Search started. Players who match will receive an invitation to your party.', '#fff');
  }
  stop(state) {
    if (this.state === 'searching') this.g.net?.partySearchStop();
    this.state = state;
  }
  /** The party changed: a search only lives while you lead a party. */
  partyChanged() { if (this.state !== 'idle' && !this.leader) this.state = 'idle'; }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    const mine = this.tab === 1;
    this.startBtn.visible = mine && this.state !== 'searching';
    this.pauseBtn.visible = mine && this.state === 'searching';
    this.stopBtn.visible = mine;
    this.stopBtn.enabled = this.state !== 'idle';
    this.startBtn.enabled = this.leader;
    super.draw(ctx);
    const scale = this.g.canvas.clientWidth / 800;
    for (const f of Object.values(this.fields)) { f.rect.x = this.x + f.rect.x0; f.rect.y = this.y + 130; f.layout({ left: 0, top: 0 }, scale); }
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), P = this.P;
    // tabs
    [[0, 10], [1, 40]].forEach(([t, x]) => { const i = im((t === this.tab ? P.Tab.enabled : P.Tab.disabled)[t]); if (i) ctx.drawImage(i, x, 29); });
    const put = (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x, y); };
    if (this.tab === 0) {
      put(P.Party.party0, 12, 54); put(P.Party.party1, 11, 83);
      this.note(ctx, ['Party leaders looking for members invite players', 'near them who have no party yet.'], 89);
      this.note(ctx, ['You can be invited whenever you are not in a party.', 'Invitations from a search are marked "PS:".'], 140, '#555');
      return;
    }
    put(P.PartyMember.party0, 12, 54); put(P.PartyMember.party1, 11, 83);
    this.note(ctx, this.leader ? ['Choose the levels and jobs you want, then START.', 'Matching players near you are invited to your party.']
      : ['Only a party leader can search for members.', 'Create a party in the Party tab of the user list.'], 89);
    put(P.PartyMember.party2, 16, 128);
    put(P.PartyMember.party3, 14, 150);
    this.check(ctx, 18, 152, this.bits.size === ALL_BITS.length);
    put(P.PartyMember.party4, JOBS.x, JOBS.y);
    for (const [bx, by, bw, title, jobs] of GROUPS) {
      const x = JOBS.x + bx, y = JOBS.y + by;
      this.check(ctx, x + 4, y + 3, jobs.every(([b]) => this.bits.has(b)));
      uiText(ctx, title, x + 19, y + 3, { color: '#fff', bold: true, size: 11 });
      jobs.forEach(([b, name], i) => {
        const ry = y + 21 + i * ROW;
        this.check(ctx, x + 4, ry, this.bits.has(b));
        // the narrow boxes take a long name a size smaller
        ctx.font = '11px Arial, sans-serif';
        const size = ctx.measureText(name).width > bw - 22 ? 10 : 11;
        uiText(ctx, name, x + 19, ry + (11 - size), { color: '#000', size });
      });
    }
    // the search's state over the button band: the magnifier animates while it runs
    const t = performance.now();
    const icon = this.state === 'searching' ? P.icon0[Math.floor(t / 150) % 6] : this.state === 'paused' ? P.icon1 : null;
    if (icon) put(icon, 14, 360);
    const msg = { searching: 'Searching for party members...', paused: 'The search is paused.', idle: '' }[this.state];
    if (msg) uiText(ctx, msg, 50, 368, { color: '#000', size: 11 });
  }
  note(ctx, lines, y, color = '#000') { lines.forEach((l, i) => uiText(ctx, l, 18, y + i * 14, { color, size: 11 })); }
  check(ctx, x, y, on) { const i = this.mgr.image(on ? this.P.check1 : this.P.check0); if (i) ctx.drawImage(i, x, y); }

  down(lx, ly) {
    if (ly >= 26 && ly < 44) {
      const t = lx >= 10 && lx < 38 ? 0 : lx >= 40 && lx < 88 ? 1 : -1;
      if (t >= 0 && t !== this.tab) { this.tab = t; this.showFields(t === 1); sfx.play('UI/BtMouseClick'); }
      return;
    }
    if (this.tab !== 1) return;
    const hit = (x, y) => lx >= x - 2 && lx < x + 80 && ly >= y - 2 && ly < y + 13;
    const flip = (bits, on) => { for (const b of bits) { if (on) this.bits.add(b); else this.bits.delete(b); } sfx.play('UI/BtMouseClick'); };
    if (hit(18, 152)) { flip(ALL_BITS, this.bits.size !== ALL_BITS.length); return; }
    for (const [bx, by, , , jobs] of GROUPS) {
      const x = JOBS.x + bx, y = JOBS.y + by;
      if (hit(x + 4, y + 3)) { flip(jobs.map(([b]) => b), !jobs.every(([b]) => this.bits.has(b))); return; }
      for (let i = 0; i < jobs.length; i++) if (hit(x + 4, y + 21 + i * ROW)) { flip([jobs[i][0]], !this.bits.has(jobs[i][0])); return; }
    }
  }
}
