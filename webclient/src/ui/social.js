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
 * UserInfo backgrnd 275x199: portrait box x 7-98 y 26-166 with the name bar at y 147-163 and a
 * shadow at (52, 133); LEVEL / JOB / FAME / GUILD / ALLIANCE label boxes x 104-150 with the value
 * fields x 152-268 at y 80 / 97 / 115 / 133 / 152; the blue header holds the Party / Trade buttons.
 */
const INFO_ROWS = [80, 97, 115, 133, 152];
export class CharInfoWin extends Win {
  constructor(mgr, info) {
    const U = mgr.W.UserInfo;
    super(mgr, U.backgrnd, 262, 120);
    this.U = U; this.info = info;
    const g = this.g, other = info.id !== g.player.id;
    const party = this.button(U.BtParty, 206, 26, () => {
      if (!g.party) g.net?.partyOp(1);
      g.net?.partyOp(4, this.name());
    });
    party.enabled = other && (!g.party || g.party.leader === g.player.id);
    const rp = g.others.get(info.id);
    this.button(U.BtTrade, 206, 46, () => { if (rp) g.requestTrade(rp); }).enabled = other && !!rp;
  }
  name() { return this.info.id === this.g.player.id ? this.g.player.name : this.g.others.get(this.info.id)?.name || ''; }
  frames() { return [...super.frames()]; }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  body(ctx) {
    const g = this.g, i = this.info, me = i.id === g.player.id;
    const ent = me ? g.player : g.others.get(i.id), look = me ? g.look : ent?.look;
    if (look) {
      ctx.save(); ctx.beginPath(); ctx.rect(8, 27, 90, 118); ctx.clip();
      drawParts(ctx, g.assets, look.compose(look.standAction(), 0), 52, 133, false);
      ctx.restore();
    }
    this.text(ctx, this.name(), 52, 149, { color: '#fff', bold: true, align: 'center' });
    [String(i.level), jobName(i.job), String(i.fame), i.guild || '-', i.alliance || '-']
      .forEach((v, k) => this.text(ctx, v, 158, INFO_ROWS[k] + 2));
  }
}
