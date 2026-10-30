import { jobName } from '../data.js';
import { sfx } from '../audio.js';
import { uiText, wrapText } from './wzui.js';
import { Win, allCanvases } from './windows.js';

/**
 * Family (UIWindow.img/Family, backgrnd 224x392). Measured from the art:
 *   title y 3-20; the family's name on the blue band y 24-52; its precepts on the white line y 54-74
 *   (the leader edits them with BtFamilyPrecept); JUNIOR (have / allowed) in the box x 48-96 y 78-96;
 *   REP x 48-218 y 108-123 and TODAY'S REP x 105-218 y 126-141;
 *   the Entitlement panel y 147-357 shows one privilege at a time: its name on the white line y 178-190
 *   between BtLeft / BtRight, REP USED (its cost) x 72-123 and COUNT (used / allowed) x 171-210 on y 195-208,
 *   its description and RightIcon below (y 213-340); the button band y 360-390: ADD JUNIOR, PEDIGREE, USE THIS.
 * Reputation comes from your juniors hunting and levelling; privileges spend it.
 */
const RESULTS = {
  65: 'That character could not be found.', 67: 'That character is not in your family.',
  69: 'Your junior has to be in the same map as you.', 72: 'Your junior must be within 20 levels of you.',
  73: 'That character is already considering another family invitation.', 74: 'That character is already being summoned.',
  75: 'You cannot use that here.', 76: 'The family would have too many generations.', 77: 'Your junior must be above level 10.',
  80: 'You need %d mesos to leave your senior.', 81: 'You need %d mesos to let your junior go.',
};
export const familyResult = (code, mesos) => RESULTS[code]?.replace('%d', mesos.toLocaleString('en-US'));
const plain = (t) => (t || '').replace(/\\n/g, '\n').replace(/#[a-z]/g, '').replace(/#/g, '');
// RightIcon per privilege (Cosmic FamilyEntitlement order): 2 EXP, 3 DROP, 4 the family ones (reunion, summon, bonding)
const ICONS = [4, 4, 3, 2, 4, 3, 2, 3, 2, 3, 2];

export class FamilyWin extends Win {
  constructor(mgr) {
    const F = mgr.W.Family;
    super(mgr, F.backgrnd, 60, 90);
    this.F = F; this.page = 0;
    this.closeBtn.visible = false;
    this.button(F.BtClose, 206, 6, () => mgr.close(this));
    this.preceptBtn = this.button(F.BtFamilyPrecept, 207, 54, () => this.editPrecepts());
    this.button(F.BtLeft, 18, 177, () => this.turn(-1));
    this.button(F.BtRight, 193, 177, () => this.turn(1));
    this.button(F.BtJuniorEntry, 10, 366, () => this.g.familyAddJunior());
    this.button(F.BtTree, 82, 366, () => this.mgr.open('familytree')?.load(this.g.player.name));
    this.useBtn = this.button(F.BtSpecial, 140, 366, () => this.use());
  }
  frames() { return [...super.frames(), ...allCanvases(this.F)]; }
  onOpen() { this.g.net?.familyOpen(); }
  get info() { return this.g.family; }
  get privileges() { return this.g.familyPrivileges || []; }
  turn(d) { const n = this.privileges.length; if (n) this.page = (this.page + d + n) % n; }

  async editPrecepts() {
    const text = await this.mgr.askText('Enter the family precepts.', this.info?.message || '', { max: 200, width: 200 });
    if (text !== null && text !== undefined) this.g.net?.familyPrecepts(text.trim());
  }
  async use() {
    const p = this.privileges[this.page], f = this.info;
    if (!p || !f) return;
    if (!f.name) { this.mgr.notice('You are not in a family yet.'); return; }
    if ((f.used[this.page] || 0) >= p.limit) { this.mgr.notice('You have already used this today.'); return; }
    if (f.rep < p.cost) { this.mgr.notice('You do not have enough reputation.'); return; }
    if (this.page === 4) { this.mgr.notice('Family Bonding is not available in this world.'); return; }
    let name;
    if (this.page <= 1) {
      name = (await this.mgr.askText(this.page === 0 ? 'Which family member do you want to go to?' : 'Which family member do you want to summon?'))?.trim();
      if (!name) return;
    } else if (!(await this.mgr.confirm(`Use ${p.name} for ${p.cost.toLocaleString('en-US')} reputation?`))) return;
    this.g.net?.familyUse(this.page, name);
  }

  draw(ctx) {
    const f = this.info, p = this.privileges[this.page];
    this.preceptBtn.visible = !!f?.name && f.leader === this.g.player.id;
    this.useBtn.enabled = !!p && !!f?.name && f.rep >= p.cost && (f.used[this.page] || 0) < p.limit;
    super.draw(ctx);
  }
  body(ctx) {
    const f = this.info || { rep: 0, totalRep: 0, todayRep: 0, juniors: 0, maxJuniors: 2, name: '', message: '', used: {} };
    uiText(ctx, f.name ? `${f.name} Family` : 'No family yet', 112, 32, { color: '#fff', bold: true, size: 12, align: 'center' });
    ctx.save(); ctx.beginPath(); ctx.rect(6, 54, 198, 20); ctx.clip();
    this.text(ctx, f.message || (f.name ? '' : 'Add a junior to start a family.'), 9, 59, { color: f.message ? '#000' : '#888' });
    ctx.restore();
    this.text(ctx, `${f.juniors} / ${f.maxJuniors}`, 72, 83, { align: 'center' });
    this.text(ctx, `${f.rep.toLocaleString('en-US')} / ${f.totalRep.toLocaleString('en-US')}`, 214, 110, { align: 'right' });
    this.text(ctx, f.todayRep.toLocaleString('en-US'), 214, 128, { align: 'right' });
    const p = this.privileges[this.page];
    if (!p) return;
    uiText(ctx, p.name, 112, 178, { color: '#000', bold: true, size: 11, align: 'center' });
    this.text(ctx, p.cost.toLocaleString('en-US'), 120, 196, { align: 'right' });
    this.text(ctx, `${f.used[this.page] || 0} / ${p.limit}`, 190, 196, { align: 'center' });
    const ic = this.mgr.image(this.F.RightIcon[ICONS[this.page] || 4]);
    if (ic) ctx.drawImage(ic, 176, 216);
    ctx.save(); ctx.font = '11px Arial, sans-serif';
    const lines = plain(p.desc).split('\n').flatMap((l) => wrapText(ctx, l, l.startsWith('[') ? 160 : 196, 11));
    ctx.restore();
    lines.slice(0, 8).forEach((l, i) => this.text(ctx, l, 12, 218 + i * 15));
    this.text(ctx, `${this.page + 1} / ${this.privileges.length}`, 112, 343, { align: 'center', color: '#555' });
  }
}

/**
 * The pedigree (UIWindow.img/FamilyTree, backgrnd 578x386; plates are 133x34 slots already in the art):
 *   Total Family Members in the box x 25-110 y 40-52; the leader at (233,41) (PlateLeader 134x36);
 *   the senior's senior (233,96), the senior (233,149); you (233,202) beside your senior's other junior (379,202);
 *   your juniors (88,255) / (379,255); their juniors (19,308) (157,308) under the first, (310,308) (448,308) under the second.
 * A plate is lit (PlateLeader / PlateOthers 1) while that member is online; click one to select it, double-click
 * to see that member's own pedigree. Add asks for a new junior; Delete lets the selected junior go, or on your own
 * plate leaves your senior.
 */
const SLOT = { leader: [233, 41], grand: [233, 96], senior: [233, 149], self: [233, 202], sibling: [379, 202],
  j0: [88, 255], j1: [379, 255], s00: [19, 308], s01: [157, 308], s10: [310, 308], s11: [448, 308] };

export class FamilyTreeWin extends Win {
  constructor(mgr) {
    const T = mgr.W.FamilyTree;
    super(mgr, T.backgrnd, 110, 80);
    this.T = T; this.chart = null; this.sel = null;
    this.closeBtn.visible = false;
    this.button(T.BtClose, 558, 9, () => mgr.close(this));
    this.addBtn = this.button(T.BtJuniorEntry, 452, 360, () => this.g.familyAddJunior());
    this.byeBtn = this.button(T.BtBye, 504, 360, () => this.separate());
  }
  frames() { return [...super.frames(), ...allCanvases(this.T)]; }
  load(name) { this.chart = null; this.sel = null; this.g.net?.familyChart(name); return this; }
  setChart(c) {
    this.chart = c;
    const by = new Map(c.members.map((m) => [m.id, m]));
    const self = by.get(c.self), senior = self && by.get(self.senior), grand = senior && by.get(senior.senior);
    const kids = (m) => (m ? c.members.filter((x) => x.senior === m.id && x.id !== m.id).slice(0, 2) : []);
    const [j0, j1] = kids(self);
    const place = { leader: c.members[0], self, senior, grand: grand && grand !== c.members[0] ? grand : null,
      sibling: senior ? kids(senior).find((x) => x.id !== self?.id) : null, j0, j1 };
    [place.s00, place.s01] = kids(j0); [place.s10, place.s11] = kids(j1);
    this.place = place;
    if (!this.sel) this.sel = self?.id ?? null;
  }
  get mine() { return this.chart?.self === this.g.player.id; }

  async separate() {
    const c = this.chart, me = this.g.player.id;
    if (!c) return;
    const sel = c.members.find((m) => m.id === this.sel);
    if (sel && sel.senior === me && sel.id !== me) {
      if (await this.mgr.confirm(`Let ${sel.name} go from your family?\nIt costs mesos and reputation.`)) this.g.net?.familyDropJunior(sel.id);
    } else if (sel?.id === me && this.place.senior) {
      if (await this.mgr.confirm(`Leave your senior ${this.place.senior.name}?\nIt costs mesos, and your juniors leave with you.`)) this.g.net?.familyLeaveSenior();
    } else this.mgr.notice('Select one of your juniors, or yourself to leave your senior.');
  }

  draw(ctx) {
    this.addBtn.visible = this.byeBtn.visible = this.mine;
    this.addBtn.enabled = this.chart?.canAdd !== false;
    super.draw(ctx);
  }
  body(ctx) {
    const c = this.chart, im = (n) => this.mgr.image(n);
    if (!c) { uiText(ctx, 'Loading...', 289, 190, { color: '#fff', size: 12, align: 'center' }); return; }
    this.text(ctx, String(c.counts[-1] ?? c.members.length), 67, 40, { align: 'center' });
    this.hits = [];
    for (const [slot, [x, y]] of Object.entries(SLOT)) {
      const m = this.place[slot];
      if (!m) continue;
      const lead = slot === 'leader', plate = im((lead ? this.T.PlateLeader : this.T.PlateOthers)[m.online ? 1 : 0]);
      if (plate) ctx.drawImage(plate, x, lead ? y : y + 1);
      if (m.id === this.sel && slot !== 'leader') { const s = im(this.T.selected); if (s) ctx.drawImage(s, x - 3, y - 2); }
      uiText(ctx, m.name, x + 66, y + 4, { color: '#fff', bold: true, size: 11, align: 'center' });
      uiText(ctx, `Lv. ${m.level}  ${jobName(m.job)}`, x + 66, y + 19, { color: m.online ? '#e8ffd0' : '#bbb', size: 10, align: 'center' });
      this.hits.push([x, y, m]);
    }
  }
  down(lx, ly) {
    const h = this.hits?.find(([x, y]) => lx >= x && lx < x + 133 && ly >= y && ly < y + 34);
    if (h) { this.sel = h[2].id; sfx.play('UI/BtMouseClick'); }
  }
  dblclick(lx, ly) {
    const h = this.hits?.find(([x, y]) => lx >= x && lx < x + 133 && ly >= y && ly < y + 34);
    if (h && h[2].id !== this.chart.self) this.load(h[2].name);
  }
}
