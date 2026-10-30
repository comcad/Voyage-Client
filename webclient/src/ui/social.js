import { jobName } from '../data.js';
import { pad } from '../assets.js';
import { nameTag } from '../map.js';
import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';

/**
 * The Maple User List (UI/UIWindow.img/UserList), Buddy, Party and Guild tabs.
 * backgrnd (Buddy, Guild) / backgrnd2 (Party), 312x389: title y 3-20, tab strip y 22-42, list from y 48,
 * button band y 335-385 (two rows of 18px buttons at 340 / 362). Section headers are the art's own bars
 * (Friend/friend0 ONLINE, friend4 OFFLINE, Party/party0 / party4, Guild/GuildInfo/guildinfo0 / 1),
 * rows are friend2 / friend5 / party1 / guildinfo3 under the guildinfo2 column header.
 * Guild: emblem + name + members at y 48, the notice box (guildinfo6) at y 74, then the member list,
 * scrolled inside y 96-332.
 */
const TABS = [['Buddy', 12], ['Party', 54], ['Guild', 92]];
const LIST_X = 15, ROW_H = 18;
const G_TOP = 96, G_BOTTOM = 332;          // the guild member list scrolls inside these
export class UserListWin extends Win {
  constructor(mgr) {
    const U = mgr.W.UserList;
    super(mgr, U.backgrnd, 300, 60);
    this.U = U; this.tab = 0; this.sel = null;
    const F = U.Friend, P = U.Party, by = 340;
    const row = (list, y) => { let x = 12; return list.map(([node, fn]) => { const b = this.button(node, x, y, fn); x += node.normal[0]._w + 5; return b; }); };
    this.buddyBtns = row([[F.BtAdd, () => this.addBuddy()], [F.BtDelete, () => this.deleteBuddy()], [F.BtWhisper, () => this.whisper()],
      [F.BtWhere, () => this.find()], [F.BtParty, () => this.inviteSelected()]], by);
    this.partyBtns = row([[P.BtCreate, () => this.g.net?.partyOp(1)], [P.BtInvite, () => this.invite()], [P.BtKick, () => this.kick()],
      [P.BtWithdraw, () => this.leave()], [P.BtChangeBoss, () => this.makeLeader()], [P.BtHP, () => { this.g.partyHpMarks = !this.g.partyHpMarks; }]], by);
    this.partyBtns.push(this.button(P.BtSearch, 12, by + 22, () => this.mgr.toggle('partysearch')));
    const GI = U.Guild.GuildInfo;
    this.guildBtns = [...row([[GI.BtInvite, () => this.guildInvite()], [GI.BtKick, () => this.guildExpel()], [GI.BtUp, () => this.guildRank(-1)],
      [GI.BtDown, () => this.guildRank(1)]], by), ...row([[GI.BtWhisper, () => this.whisper()], [GI.BtWhere, () => this.find()],
      [GI.BtPartyInvite, () => this.inviteSelected()], [GI.BtWithdraw, () => this.guildLeave()]], by + 22)];
    this.noticeBtn = this.button(GI.Btnotice, LIST_X + 282 - 21, 74, () => this.guildNotice());
    this.gscroll = 0;
  }
  frames() { return [...super.frames(), this.U.backgrnd2, ...allCanvases(this.U.Tab), ...allCanvases(this.U.Friend), ...allCanvases(this.U.Party), ...allCanvases(this.U.Guild.GuildInfo)]; }
  setArg(tab) { if (tab !== undefined) this.tab = tab; }
  wantsArg(tab) { return tab !== undefined && tab !== this.tab; }

  // ---------------------------------------------------------------- data
  get party() { return this.g.party; }
  get guild() { return this.g.guild; }
  get myRank() { return this.guild?.members.find((m) => m.id === this.me)?.rank ?? 5; }
  get me() { return this.g.player.id; }
  buddyRows() {
    const all = this.g.buddies || [];
    return { online: all.filter((b) => b.channel >= 0), offline: all.filter((b) => b.channel < 0) };
  }
  /** Row layout of the current tab: [{ y, kind: 'head'|'row', node, item }] */
  rows() {
    const out = [], F = this.U.Friend, P = this.U.Party;
    let y = 48;
    const add = (node, kind, item, h) => { out.push({ y, kind, node, item }); y += h ?? node?._h ?? ROW_H; };
    if (this.tab === 0) {
      const { online, offline } = this.buddyRows();
      add(F.friend0, 'head'); add(F.friend1, 'head');
      for (const b of online) add(F.friend2, 'row', b, ROW_H);
      add(F.friend4, 'head');
      for (const b of offline) add(F.friend5, 'row', b, ROW_H);
    } else if (this.tab === 1 && this.party) {
      const on = this.party.members.filter((m) => m.channel >= 0), off = this.party.members.filter((m) => m.channel < 0);
      add(P.party0, 'head'); add(P.party5, 'head');
      for (const m of on) add(P.party1, 'row', m, ROW_H);
      if (off.length) { add(P.party4, 'head'); for (const m of off) add(P.party1, 'row', m, ROW_H); }
    } else if (this.tab === 2 && this.guild) {
      const GI = this.U.Guild.GuildInfo, byRank = (a, b) => a.rank - b.rank || a.name.localeCompare(b.name);
      const on = this.guild.members.filter((m) => m.online).sort(byRank), off = this.guild.members.filter((m) => !m.online).sort(byRank);
      y = G_TOP - this.gscroll;
      add(GI.guildinfo0, 'head'); add(GI.guildinfo2, 'head');
      for (const m of on) add(GI.guildinfo3, 'row', m, ROW_H);
      if (off.length) { add(GI.guildinfo1, 'head'); add(GI.guildinfo2, 'head'); for (const m of off) add(GI.guildinfo3, 'row', m, ROW_H); }
    }
    return out;
  }
  selected() { return this.rows().find((r) => r.kind === 'row' && r.item.id === this.sel)?.item || null; }

  // ---------------------------------------------------------------- actions
  async addBuddy() {
    const name = await this.mgr.askText('Enter the character name you would like to add as a buddy.');
    if (name) this.g.net?.buddyAdd(name.trim());
  }
  async deleteBuddy() {
    const b = this.selected();
    if (b && await this.mgr.confirm(`Are you sure you want to delete #b${b.name}#k from your buddy list?`)) this.g.net?.buddyDelete(b.id);
  }
  whisper() { const b = this.selected(); if (b) this.g.statusBar.focusChat(`/w ${b.name} `); }
  find() { const b = this.selected(); if (b) this.g.net?.find(b.name); }
  inviteSelected() { const b = this.selected(); if (b) this.g.net?.partyOp(4, b.name); }
  async invite() {
    if (!this.party) { this.g.notice('You are not in a party.'); return; }
    const name = await this.mgr.askText('Enter the name of the character you want to invite to your party.');
    if (name) this.g.net?.partyOp(4, name.trim());
  }
  async kick() {
    const m = this.selected();
    if (m && m.id !== this.me && await this.mgr.confirm(`Expel #b${m.name}#k from the party?`)) this.g.net?.partyOp(5, m.id);
  }
  async leave() {
    if (!this.party) return;
    const lead = this.party.leader === this.me;
    if (await this.mgr.confirm(lead ? 'You are the party leader. Leaving will disband the party. Continue?' : 'Are you sure you want to leave the party?')) this.g.net?.partyOp(2);
  }
  makeLeader() { const m = this.selected(); if (m && m.id !== this.me) this.g.net?.partyOp(6, m.id); }
  // guild: ranks run 1 (master) .. 5 (member); masters and jr. masters (1-2) manage the ones below them
  async guildInvite() {
    const name = await this.mgr.askText('Enter the name of the character you want to invite to the guild.');
    if (name) this.g.net?.guildOp(5, name.trim());
  }
  async guildExpel() {
    const m = this.selected();
    if (m && m.id !== this.me && await this.mgr.confirm(`Expel #b${m.name}#k from the guild?`)) this.g.net?.guildOp(8, m.id, m.name);
  }
  guildRank(d) { const m = this.selected(); if (m) this.g.net?.guildRank(m.id, m.rank + d); }
  async guildLeave() {
    if (this.guild && await this.mgr.confirm(`Are you sure you want to leave the guild #b${this.guild.name}#k?`)) this.g.net?.guildOp(7, this.me, this.g.player.name);
  }
  async guildNotice() {
    const t = await this.mgr.askText('Enter the new guild notice.', this.guild?.notice || '', { max: 100, width: 220 });
    if (t !== null) this.g.net?.guildOp(0x10, t);
  }
  /** What the selected guild member may have done to them by you. */
  canManage(m) { return !!m && m.id !== this.me && this.myRank <= 2 && m.rank > this.myRank; }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    this.bg = this.tab === 1 ? this.U.backgrnd2 : this.U.backgrnd;
    const lead = this.party?.leader === this.me;
    for (const b of this.buddyBtns) b.visible = this.tab === 0;
    for (const b of this.partyBtns) b.visible = this.tab === 1;
    const [create, invite, kick, leave, boss] = this.partyBtns;
    create.enabled = !this.party; invite.enabled = !!this.party && lead; leave.enabled = !!this.party;
    kick.enabled = boss.enabled = lead && !!this.selected() && this.sel !== this.me;
    const sel = !!this.selected();
    for (const b of this.buddyBtns.slice(1)) b.enabled = sel;
    const [gInvite, gKick, gUp, gDown, gWhisper, gWhere, gParty, gLeave] = this.guildBtns, m = this.selected();
    for (const b of this.guildBtns) b.visible = this.tab === 2 && !!this.guild;
    this.noticeBtn.visible = this.tab === 2 && !!this.guild && this.myRank <= 2;
    gInvite.enabled = this.myRank <= 2;
    gKick.enabled = this.canManage(m);
    gUp.enabled = this.canManage(m) && m.rank - 1 > this.myRank;
    gDown.enabled = this.canManage(m) && m.rank < 5;
    gWhisper.enabled = gWhere.enabled = gParty.enabled = !!m && m.id !== this.me && (this.tab !== 2 || m.online);
    gLeave.enabled = this.myRank !== 1;                     // the master disbands through Heracle instead
    super.draw(ctx);
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), F = this.U.Friend, P = this.U.Party;
    TABS.forEach(([, x], i) => {
      const t = im(this.U.Tab[i === this.tab ? 'enabled' : 'disabled'][i]);
      if (t) ctx.drawImage(t, x, 28);
    });
    if (this.tab === 1 && !this.party) {
      this.text(ctx, 'You are not in a party.', 156, 70, { align: 'center', color: '#555' });
      this.text(ctx, 'Press CREATE to start one.', 156, 86, { align: 'center', color: '#555' });
      return;
    }
    if (this.tab === 2) { this.guildBody(ctx); return; }
    const myCh = this.g.channel;
    for (const r of this.rows()) {
      const bg = im(r.node);
      if (bg) ctx.drawImage(bg, LIST_X, r.y);
      if (r.kind !== 'row') continue;
      const it = r.item;
      if (it.id === this.sel) { ctx.fillStyle = 'rgba(79,127,196,0.35)'; ctx.fillRect(LIST_X + 1, r.y, 278, ROW_H - 1); }
      if (this.tab === 0) {
        const icon = im(it.channel < 0 ? F.icon3 : it.channel === myCh ? F.icon1 : F.icon2);
        if (icon) ctx.drawImage(icon, LIST_X + 6, r.y + 4);
        this.text(ctx, it.name, LIST_X + 22, r.y + 3);
        if (it.channel >= 0) this.text(ctx, `CH ${it.channel + 1}`, LIST_X + 270, r.y + 3, { align: 'right' });
      } else {
        if (it.id === this.party.leader) { const s = im(P.icon1); if (s) ctx.drawImage(s, LIST_X + 3, r.y + 1); }
        this.text(ctx, it.name, LIST_X + 22, r.y + 3);
        this.text(ctx, jobName(it.job), LIST_X + 110, r.y + 3);
        this.text(ctx, String(it.level), LIST_X + 210, r.y + 3);
        this.text(ctx, it.channel >= 0 ? `CH ${it.channel + 1}` : '-', LIST_X + 270, r.y + 3, { align: 'right' });
      }
    }
  }
  /** The Guild tab: emblem, name and count, the notice, then the clipped member list. */
  guildBody(ctx) {
    const m = this.mgr, im = (n) => m.image(n), g = this.guild, GI = this.U.Guild.GuildInfo;
    if (!g) {
      this.text(ctx, 'You are not in a guild.', 156, 70, { align: 'center', color: '#555' });
      this.text(ctx, 'Talk to Heracle in Orbis to make one.', 156, 86, { align: 'center', color: '#555' });
      return;
    }
    drawEmblem(ctx, this.g, g.emblem, LIST_X + 3, 51);
    this.text(ctx, g.name, LIST_X + 26, 50, { bold: true, size: 12 });
    this.text(ctx, `GP ${g.gp.toLocaleString('en-US')}`, LIST_X + 26, 63, { color: '#555' });
    this.text(ctx, `${g.members.filter((x) => x.online).length} / ${g.members.length} (max ${g.capacity})`, LIST_X + 278, 56, { align: 'right', color: '#555' });
    const box = im(GI.guildinfo6);
    if (box) ctx.drawImage(box, LIST_X - 1, 74);
    ctx.save(); ctx.beginPath(); ctx.rect(LIST_X + 2, 74, 255, 20); ctx.clip();
    this.text(ctx, g.notice || '(no notice)', LIST_X + 6, 78, { color: g.notice ? '#000' : '#888' });
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(LIST_X - 1, G_TOP, 284, G_BOTTOM - G_TOP); ctx.clip();
    for (const r of this.rows()) {
      const bg = im(r.node);
      if (bg) ctx.drawImage(bg, LIST_X, r.y);
      if (r.kind !== 'row') continue;
      const it = r.item, c = it.online ? '#000' : '#888';
      if (it.id === this.sel) { ctx.fillStyle = 'rgba(79,127,196,0.35)'; ctx.fillRect(LIST_X + 1, r.y, 278, ROW_H - 1); }
      this.text(ctx, it.name, LIST_X + 8, r.y + 3, { color: c, bold: it.id === this.me });
      this.text(ctx, jobName(it.job), LIST_X + 102, r.y + 3, { color: c });
      this.text(ctx, String(it.level), LIST_X + 186, r.y + 3, { color: c, align: 'center' });
      this.text(ctx, g.ranks[it.rank - 1] || '', LIST_X + 212, r.y + 3, { color: c });
    }
    ctx.restore();
  }
  wheel(dy) {
    if (this.tab !== 2 || !this.guild) return;
    const rows = this.rows(), end = rows.length ? rows[rows.length - 1].y + ROW_H + this.gscroll : 0;
    const max = Math.max(0, end - G_BOTTOM);
    this.gscroll = Math.max(0, Math.min(max, this.gscroll + Math.sign(dy) * ROW_H));
  }
  down(lx, ly) {
    for (let i = 0; i < 3; i++) {
      const x = TABS[i][1];
      if (lx >= x - 4 && lx < x + 34 && ly >= 22 && ly < 42) { if (this.tab !== i) { this.tab = i; this.sel = null; sfx.play('UI/Tab'); } return; }
    }
    if (this.tab === 2 && (ly < G_TOP || ly >= G_BOTTOM)) return;
    const r = this.rows().find((row) => row.kind === 'row' && ly >= row.y && ly < row.y + ROW_H && lx >= LIST_X && lx < LIST_X + 281);
    this.sel = r ? r.item.id : null;
  }
  dblclick(lx, ly) { this.down(lx, ly); if (this.tab === 0) this.whisper(); else if (this.tab === 2 && this.sel && this.sel !== this.me) this.g.requestCharInfo(this.sel); }
}

// ==================================================================== guild emblems
const MARK_KIND = { 2: 'Animal', 3: 'Plant', 4: 'Pattern', 5: 'Letter', 9: 'Etc' };
/** UI/GuildMark.img: a 17x17 BackGround/<bg>/<colour> with the 15x15 Mark/<kind>/<logo>/<colour> inside it. */
export function drawEmblem(ctx, game, e, x, y) {
  const M = game.guildMarks;
  if (!M || !e || (!e.bg && !e.logo)) return false;
  const bg = game.assets.image(M.BackGround?.[pad(e.bg, 8)]?.[e.bgColor]);
  const mark = game.assets.image(M.Mark?.[MARK_KIND[Math.floor(e.logo / 1000)]]?.[pad(e.logo, 8)]?.[e.logoColor]);
  if (bg) ctx.drawImage(bg, x, y);
  if (mark) ctx.drawImage(mark, x + 1, y + 1);
  return true;
}
/** The guild name tag under a character's name, its emblem just left of it. */
export function drawGuildTag(ctx, game, name, emblem, x, y) {
  nameTag(ctx, name, x, y, '#fff2a8');
  const w = ctx.measureText(name).width + 8;               // nameTag left its font set
  drawEmblem(ctx, game, emblem, Math.round(x - w / 2 - 19), y - 1);
}

/** Party HP bars (Party/PartyHP/GaugeBar) over party members on this map. */
export function drawPartyHp(ctx, game, cam) {
  const G = game.windows?.W?.UserList?.Party?.PartyHP?.GaugeBar, party = game.party;
  if (!party || !G || !game.partyHpMarks) return;
  const grad = game.assets.image(G.graduation), gauge = game.assets.image(G.gauge);
  if (!grad || !gauge) return;
  for (const m of party.members) {
    if (m.id === game.player.id || !m.hp) continue;
    const e = game.others.get(m.id);
    if (!e) continue;
    const x = Math.round(e.x - cam.x - grad.width / 2), y = Math.round(e.y - cam.y - 92);
    ctx.drawImage(grad, x, y);
    ctx.drawImage(gauge, x + 3, y + 3, Math.round(63 * Math.max(0, Math.min(1, m.hp / Math.max(1, m.maxHp)))), 7);
  }
}

// ==================================================================== player menu
/**
 * ContextMenu (right-click on a player): t (100x23, the name bar), one c row (97x15) per entry with
 * its 85x14 button at x 6, then s (7). Trade is shown but disabled until trading exists.
 */
export class PlayerMenu extends Win {
  constructor(mgr, target, x, y) {
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.M = mgr.W.ContextMenu; this.target = target; this.transient = true;
    const g = this.g, lead = !g.party || g.party.leader === g.player.id;
    const items = [
      [this.M.BtInfo, () => g.requestCharInfo(target.id)],
      [this.M.BtWhisper, () => g.statusBar.focusChat(`/w ${target.name} `)],
      [this.M.BtParty, () => { if (!g.party) g.net?.partyOp(1); g.net?.partyOp(4, target.name); }, lead],
      [this.M.BtTrade, () => g.requestTrade(target)],
    ];
    this.w = 100; this.h = 23 + items.length * 15 + 7;
    this.x = Math.min(x, 800 - this.w - 2); this.y = Math.min(y, 529 - this.h);
    items.forEach(([node, fn, on = true], i) => {
      const b = this.button(node, 6, 23 + i * 15, () => { this.mgr.close(this); fn(); });
      b.enabled = on;
    });
  }
  frames() { return [...allCanvases(this.M)]; }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  body(ctx) {
    const im = (n) => this.mgr.image(n), t = im(this.M.t), c = im(this.M.c), s = im(this.M.s);
    if (!t || !c || !s) return;
    ctx.drawImage(t, 0, 0);
    for (let i = 0; i < this.buttons.length; i++) ctx.drawImage(c, 0, 23 + i * 15);
    ctx.drawImage(s, 0, this.h - 7);
    this.text(ctx, this.target.name, 50, 6, { color: '#fff', bold: true, align: 'center' });
  }
}

// ==================================================================== character info
/**
 * UserInfo, 275 wide, measured from the art:
 *   backgrnd (199 tall): portrait box x 7-98 y 26-166, name bar y 147-163, shadow at (52, 133); LEVEL / JOB /
 *     FAME / GUILD / ALLIANCE labels x 104-150 with values from x 157 at row centres 84 / 102 / 120 / 138 / 156;
 *     the blue header takes REQ.PARTY / REQ.TRADE (x 148) and ITEM / WISHLIST (x 208) at y 21 / 42;
 *     the bottom band (y 170-196) holds TAMING MOB / PET INFO / COLLECTION / EXCLUDED.
 *   Those four open a taller frame with the same top 160 px: backgrnd5 (taming, 362), backgrnd2 (pets, 399),
 *     backgrnd7 (Monster Book and medals, 404); the button band moves to the new bottom.
 *   backgrnd4 ITEM LIST / backgrnd3 WISH LIST (240x162) open beside it: rows every 40 from y 31, icon cell
 *     x 15-50, name from x 55 over a rule at +17, ReqLv / price under it; scrollbar at x 220.
 */
const INFO_ROWS = [84, 102, 120, 138, 156];
const INFO_PANELS = {
  none: { bg: 'backgrnd', band: 170 },
  taming: { bg: 'backgrnd5', band: 336 },
  pet: { bg: 'backgrnd2', band: 374 },
  book: { bg: 'backgrnd7', band: 377 },
};
const SIDE_X = 271, SIDE_ROWS = 3, SIDE_ROW_Y = 31;
export class CharInfoWin extends Win {
  constructor(mgr, info) {
    const U = mgr.W.UserInfo;
    super(mgr, null, 200, 60);
    this.w = 275; this.h = 199;
    this.closePinned = true; this.closeBtn.x = 275 - 17;
    this.U = U; this.info = info; this.panel = 'none'; this.side = null; this.sideFirst = 0; this.petSel = 0;
    const g = this.g, other = info.id !== g.player.id;
    const party = this.button(U.BtParty, 148, 21, () => {
      if (!g.party) g.net?.partyOp(1);
      g.net?.partyOp(4, this.name());
    });
    party.enabled = other && (!g.party || g.party.leader === g.player.id);
    const rp = g.others.get(info.id);
    this.button(U.BtTrade, 148, 42, () => { if (rp) g.requestTrade(rp); }).enabled = other && !!rp;
    this.button(U.BtItem, 208, 21, () => this.toggleSide('item'));
    this.button(U.BtWish, 208, 42, () => this.toggleSide('wish'));
    // the bottom band: each opens its panel (its Hide twin, drawn while open, closes it)
    this.bandBtns = [];
    const band = (show, hide, x, panel) => {
      const on = this.button(show, x, 0, () => this.setPanel(panel)), off = this.button(hide, x, 0, () => this.setPanel('none'));
      this.bandBtns.push({ on, off, panel });
    };
    band(U.BtTamingShow, U.BtTamingHide, 5, 'taming');
    band(U.BtPetShow, U.BtPetHide, 93, 'pet');
    band(U.BtCollectionShow, U.BtCollectionHide, 145, 'book');
    const exc = this.button(U.BtExceptionShow, 197, 0, () => {});
    exc.enabled = false;                       // pet loot exclusions are not in CHAR_INFO
    this.bandBtns.push({ on: exc, off: null, panel: null });
    this.petBtns = [U.BtPet1, U.BtPet2, U.BtPet3].map((n, k) => this.button(n, 188 + k * 33, 196, () => { this.petSel = k; }));   // the art's origin sits 16,19 into it
    this.sideClose = this.button(mgr.B.BtClose, SIDE_X + 240 - 17, 6, () => this.toggleSide(this.side));
    // pet portraits and the wish list's catalogue
    this.petArt = [];
    (info.pets || []).forEach((p, k) => mgr.assets.json(`Item/Pet/${p.id}.img`).then(async (n) => {
      const f = n?.stand0?.[0] || n?.stand0;
      if (f?._canvas) { await mgr.assets.preload([f]); this.petArt[k] = f; }
    }));
    if (info.wish?.length) mgr.assets.json('Etc/Commodity.img').then((c) => { this.commodity = new Map(Object.values(c || {}).map((x) => [x.SN, x])); });
    this.layout();
  }
  frames() {
    const U = this.U;
    return [...super.frames(), U.backgrnd, U.backgrnd2, U.backgrnd3, U.backgrnd4, U.backgrnd5, U.backgrnd7, U.ReqLv, ...allCanvases(U.Marry)];
  }
  name() { return this.info.id === this.g.player.id ? this.g.player.name : this.g.others.get(this.info.id)?.name || ''; }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  setPanel(p) { this.panel = this.panel === p ? 'none' : p; this.layout(); }
  toggleSide(s) { this.side = this.side === s ? null : s; this.sideFirst = 0; this.layout(); }
  layout() {
    const P = INFO_PANELS[this.panel], bg = this.U[P.bg];
    this.h = bg?._h || 199;
    this.w = this.side ? SIDE_X + 240 : 275;
    for (const b of this.bandBtns) {
      const open = this.panel === b.panel;
      b.on.y = P.band + 5; b.on.visible = !open || !b.off;
      if (b.off) { b.off.y = P.band + 5; b.off.visible = open; }
    }
    const pets = this.info.pets || [];
    this.petBtns.forEach((b, k) => { b.visible = this.panel === 'pet' && k < pets.length; });
    this.sideClose.visible = !!this.side;
  }

  // ---------------------------------------------------------------- lists
  /** What the ITEM LIST shows: the equipped items, normal ones before cash ones. */
  equipped() {
    const g = this.g, me = this.info.id === g.player.id;
    if (me) {
      return Object.entries(g.inventory?.equipped || {}).map(([s, it]) => ({ slot: Number(s), id: it.id }))
        .sort((a, b) => (a.slot < -99) - (b.slot < -99) || b.slot - a.slot).map((x) => x.id);
    }
    return [...(g.others.get(this.info.id)?.look?.equipIds || [])].filter(Boolean);
  }
  wishItems() { return (this.info.wish || []).map((sn) => this.commodity?.get(sn)).filter(Boolean); }
  sideRows() { return this.side === 'item' ? this.equipped().map((id) => ({ id })) : this.side === 'wish' ? this.wishItems().map((c) => ({ id: c.ItemId, price: c.Price })) : []; }

  // ---------------------------------------------------------------- frame
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), g = this.g, i = this.info, U = this.U;
    const bg = im(U[INFO_PANELS[this.panel].bg]);
    if (bg) ctx.drawImage(bg, 0, 0);
    const me = i.id === g.player.id, ent = me ? g.player : g.others.get(i.id), look = me ? g.look : ent?.look;
    if (look) {
      ctx.save(); ctx.beginPath(); ctx.rect(8, 27, 90, 118); ctx.clip();
      drawParts(ctx, g.assets, look.compose(look.standAction(), 0), 52, 133, false);
      ctx.restore();
    }
    const hn = U.Marry?.[i.married ? 'married' : 'unmarried'], heart = im(hn?._canvas ? hn : hn?.[0]);
    if (heart) ctx.drawImage(heart, 12, 31);
    this.text(ctx, this.name(), 52, 147, { color: '#fff', bold: true, align: 'center', size: 12 });   // inside the bar (y 147-163)
    [String(i.level), jobName(i.job).toUpperCase(), String(i.fame), i.guild || '', i.alliance || '']
      .forEach((v, k) => this.text(ctx, v, 157, INFO_ROWS[k] - 7, { size: 12 }));
    if (this.panel === 'pet') this.drawPet(ctx);
    else if (this.panel === 'taming') this.drawTaming(ctx);
    else if (this.panel === 'book') this.drawBook(ctx);
    if (this.side) this.drawSide(ctx);
  }
  /** Name over a rule, a smaller line under it: the rows of every list here. */
  listRow(ctx, x, y, id, sub) {
    const m = this.mgr;
    m.drawIcon(ctx, m.icon(id), x + 2, y + 1);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 38, y, 170, 36); ctx.clip();
    this.text(ctx, m.itemName(id), x + 40, y + 2, { size: 12 });
    sub?.(x + 40, y + 20);
    ctx.restore();
  }
  drawSide(ctx) {
    const m = this.mgr, U = this.U, panel = m.image(U[this.side === 'item' ? 'backgrnd4' : 'backgrnd3']);
    if (panel) ctx.drawImage(panel, SIDE_X, 0);
    const rows = this.sideRows(), reqLv = m.image(U.ReqLv);
    for (let k = 0; k < SIDE_ROWS; k++) {
      const r = rows[this.sideFirst + k];
      if (!r) break;
      this.listRow(ctx, SIDE_X + 15, SIDE_ROW_Y + k * 40, r.id, (x, y) => {
        if (r.price !== undefined) { this.text(ctx, `${r.price.toLocaleString('en-US')} NX`, x, y, { size: 12 }); return; }
        if (reqLv) ctx.drawImage(reqLv, x, y + 2);
        this.text(ctx, String(m.info(r.id)?.reqLevel ?? 0), x + 36, y, { size: 12 });
      });
    }
    if (!rows.length) this.text(ctx, this.side === 'item' ? 'No items equipped.' : 'The wish list is empty.', SIDE_X + 120, 80, { align: 'center', color: '#555' });
    this.scrollbar(ctx, SIDE_X + 220, 27, 122, this.sideFirst, rows.length, SIDE_ROWS);
  }
  drawPet(ctx) {
    const m = this.mgr, pets = this.info.pets || [], p = pets[this.petSel];
    if (!p) { this.text(ctx, 'No pets are out.', 52, 260, { align: 'center', color: '#555' }); return; }
    const art = m.image(this.petArt[this.petSel]);
    if (art) { const o = this.petArt[this.petSel].origin || [art.width / 2, art.height]; ctx.drawImage(art, Math.round(53 - o[0]), Math.round(297 - o[1])); }
    this.text(ctx, p.name, 53, 306, { color: '#fff', bold: true, align: 'center', size: 12 });
    if (p.equip) this.listRow(ctx, 105, 215, p.equip);
    const v = (t, x, y) => this.text(ctx, t, x, y - 7, { size: 12 });
    v(m.itemName(p.id), 57, 338); v(String(p.level), 57, 356);
    v(String(p.closeness), 190, 338); v(String(p.fullness), 190, 356);
  }
  drawTaming(ctx) {
    const m = this.mgr, t = this.info.mount;
    const ids = this.equipped().filter((id) => [190, 191].includes(Math.floor(id / 10000)));
    const mount = ids.find((id) => Math.floor(id / 10000) === 190);
    if (!t) { this.text(ctx, 'No taming mob.', 52, 230, { align: 'center', color: '#555' }); return; }
    if (mount) { const ic = m.icon(mount); if (ic) m.drawIcon(ctx, ic, 37, 228); }
    ids.forEach((id, k) => this.listRow(ctx, 105, 177 + k * 38, id));
    const v = (s, x, y) => this.text(ctx, s, x, y - 7, { size: 12 });
    v(mount ? m.itemName(mount) : '', 57, 300); v(String(t.level), 57, 319);
    v(String(t.exp), 190, 300); v(String(t.tiredness), 190, 319);
  }
  drawBook(ctx) {
    const m = this.mgr, g = this.g, b = this.info.book || {}, v = (s, x, y) => this.text(ctx, s, x, y - 7, { size: 12 });
    v(String(b.level ?? 0), 100, 186);
    v(b.cover ? m.strings.mob?.[b.cover]?.name || '' : '', 100, 204);
    v(String(b.total ?? 0), 100, 222); v(String(b.normal ?? 0), 166, 222); v(String(b.special ?? 0), 234, 222);
    if (this.info.medal) { const ic = m.icon(this.info.medal); if (ic) m.drawIcon(ctx, ic, 8, 246); v(m.itemName(this.info.medal), 100, 252); }
    const quests = this.info.medalQuests || [];
    v(String(quests.length), 100, 270);
    quests.slice(this.medalFirst || 0, (this.medalFirst || 0) + 4).forEach((q, k) => v(g.quests?.name(q) || `Quest ${q}`, 52, 305 + k * 18));
    this.scrollbar(ctx, 254, 297, 72, this.medalFirst || 0, quests.length, 4);
  }

  // ---------------------------------------------------------------- mouse
  sideRowAt(lx, ly) {
    if (!this.side || lx < SIDE_X + 15 || lx >= SIDE_X + 50 || ly < SIDE_ROW_Y) return -1;
    const k = Math.floor((ly - SIDE_ROW_Y) / 40);
    if (k >= SIDE_ROWS || (ly - SIDE_ROW_Y) % 40 >= 36) return -1;
    const idx = this.sideFirst + k;
    return idx < this.sideRows().length ? idx : -1;
  }
  down(lx, ly) {
    if (this.side) {
      const s = this.scrollClick(lx, ly, SIDE_X + 220, 27, 122, this.sideFirst, this.sideRows().length, SIDE_ROWS);
      if (s !== null) { this.sideFirst = s; return; }
    }
    if (this.panel === 'book') {
      const s = this.scrollClick(lx, ly, 254, 297, 72, this.medalFirst || 0, (this.info.medalQuests || []).length, 4);
      if (s !== null) this.medalFirst = s;
    }
  }
  wheel(dy) {
    const d = Math.sign(dy), lx = this.mgr.mouse.x - this.x;
    if (this.side && lx >= SIDE_X) this.sideFirst = Math.max(0, Math.min(this.sideRows().length - SIDE_ROWS, this.sideFirst + d));
    else if (this.panel === 'book') this.medalFirst = Math.max(0, Math.min((this.info.medalQuests || []).length - 4, (this.medalFirst || 0) + d));
  }
  tooltip(lx, ly) {
    const r = this.sideRowAt(lx, ly);
    return r >= 0 ? { item: { id: this.sideRows()[r].id } } : null;
  }
}
