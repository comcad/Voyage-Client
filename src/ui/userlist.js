import { jobName } from '../data.js';
import { sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';
import { localTalk } from './dialogs.js';
import { drawEmblem } from './social.js';
import { CHAT_COLOR } from './statusbar.js';
import { UI_W } from '../view.js';

/**
 * The community window (UI/UIWindow.img/UserList, 312x389): Buddy, Party, Guild, Guild Alliance and Blacklist tabs,
 * each label on a Basic.img/Tab2 box from y 23. Every list is clipped to its own box and scrolls in 33px steps with a
 * VScr4 bar at x 290: Buddy (8, 113) 188 tall, Party / Blacklist (6, 53) 278, Guild / Alliance (6, 113) 192.
 * Text is Arial 12; the selected row is a #336699 bar with white text. Position, tab, the online-only switch and
 * which buddy groups are folded are kept in this browser; blocked buddies and the Blacklist per character.
 */
const KEY = 'maple.userlist';
const loadKey = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const saveKey = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } };
const TAB_X = [8, 44, 76, 108, 165], TAB_W = [32, 28, 28, 52, 45];
const VIEW = [{ x: 8, y: 113, h: 188 }, { x: 6, y: 53, h: 278 }, { x: 6, y: 113, h: 192 }, { x: 6, y: 113, h: 192 }, { x: 6, y: 53, h: 278 }];
const BACKS = ['backgrnd3', 'backgrnd', 'backgrnd2', 'backgrnd2', 'backgrnd'];
const LIST_W = 281, SCR_X = 290, STEP = 33, ROW = 18, SEL = '#336699';
const COL = { white: '#FFFFFF', black: '#000000', away: '#909090', group: '#1A6FB1', blocked: '#D10000', offline: '#999999', where: '#666666' };
const DEFAULT_GROUP = 'Default Group', MEMO = 5090000, HERACLE = 2010007, BLACK_MAX = 26, GUILD_PAGE = 20;
const RANK_NAMES = ['Master', 'Jr.Master', 'Member', 'Member', 'Member'];
// the Guild tab's columns (list x) and what clicking each sorts by
const GUILD_COLS = [[1, 96, 'Name'], [96, 165, 'Job'], [165, 205, 'Level'], [205, 280, 'Grade']];
// the Guild Information panel beside the window: Guild/backgrnd, sliding out 40px a tick
const PANEL = { x: 311, y: 86, w: 233, h: 304 };
const isBeginner = (job) => job === 0 || job === 1000 || job === 2000;
const NAME_RE = /^[A-Za-z0-9]{4,12}$/;
// a name as the client takes one: 4-12 letters and digits, fewer than four I / l in all
const NAME_OK = { test: (n) => NAME_RE.test(n) && (String(n).match(/[Il]/g) || []).length < 4 };

let measureCtx = null;
const textW = (s, bold = false) => {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${bold ? 'bold ' : ''}12px Arial, "Segoe UI", sans-serif`;
  return measureCtx.measureText(s).width;
};
/** Cut to fit w px, ending in "..". */
const fit = (s, w) => { if (textW(s) <= w) return s; let t = s; while (t && textW(`${t}..`) > w) t = t.slice(0, -1); return `${t}..`; };
const originOf = (node) => (node?.normal?.[0] || node?.normal)?.origin || [0, 0];

export class UserListWin extends Win {
  constructor(mgr) {
    const U = mgr.W.UserList, s = loadKey(KEY, {});
    super(mgr, U.backgrnd, s.x ?? 300, s.y ?? 60);
    this.U = U; this.tab = s.tab >= 0 && s.tab <= 4 ? s.tab : 0; this.sel = null; this.scroll = [0, 0, 0, 0, 0];
    this.showOnline = !!s.showOnline; this.closedGroups = new Set(s.closedGroups || []);
    this.closePinned = true; this.closeBtn.x = 292; this.closeBtn.y = 8;
    this.gsec = [0, 1].map(() => ({ open: true, page: 0, sort: -1, desc: false }));
    this.info = null; this.where = null;
    // buttons sit with their art's top-left at the given spot
    const at = (node, x, y, fn) => { const o = originOf(node); return this.button(node, x + o[0], y + o[1], fn); };
    const F = U.Friend, P = U.Party, GI = U.Guild.GuildInfo, GG = U.Guild.GuildGrade, BL = U.BlackList;
    this.bb = {
      add: at(F.BtAddFriend, 5, 81, () => this.addBuddy()), group: at(F.BtAddGroup, 72, 81, () => this.addGroup()),
      online: at(F.BtShowOnline, 232, 81, () => this.setShowOnline(true)), all: at(F.BtShowAll, 232, 81, () => this.setShowOnline(false)),
      groupChat: at(F.BtGroupWhisper, 8, 342, () => this.groupChat()), talk: at(F.BtChat, 99, 342, () => this.talk()),
      whisper: at(F.BtWhisper, 254, 342, () => this.whisper()), mod: at(F.BtMod, 8, 363, () => this.editBuddy()),
      del: at(F.BtDelete, 49, 363, () => this.deleteBuddy()), party: at(F.BtParty, 99, 363, () => this.partyInvite()),
      block: at(F.BtBlock, 182, 363, () => this.toggleBlock()), unblock: at(F.BtUnBlock, 182, 363, () => this.toggleBlock()),
      note: at(F.BtMessage, 254, 363, () => this.note()),
    };
    this.pb = {
      create: at(P.BtCreate, 13, 356, () => this.createParty()), search: at(P.BtSearch, 72, 346, () => this.mgr.toggle('partysearch')),
      hp: at(P.BtHP, 132, 346, () => this.mgr.wins.partyhp?.toggle()), kick: at(P.BtKick, 190, 345, () => this.kick()),
      whisper: at(P.BtWhisper, 249, 346, () => this.whisper()), invite: at(P.BtInvite, 72, 366, () => this.invite()),
      boss: at(P.BtChangeBoss, 132, 366, () => this.makeLeader()), leave: at(P.BtWithdraw, 190, 365, () => this.leave()),
      talk: at(P.BtChat, 249, 366, () => this.talk()),
    };
    this.gb = {
      invite: at(GI.BtInvite, 8, 317, () => this.guildInvite()), leave: at(GI.BtWithdraw, 80, 317, () => this.guildLeave()),
      where: at(GI.BtWhere, 160, 317, () => this.find()), whisper: at(GI.BtWhisper, 239, 317, () => this.whisper()),
      up: at(GI.BtUp, 8, 337, () => this.guildRank(-1)), down: at(GI.BtDown, 80, 337, () => this.guildRank(1)),
      kick: at(GI.BtKick, 160, 337, () => this.guildExpel()), talk: at(GI.BtChat, 239, 337, () => this.talk()),
      bbs: at(GI.BtGuildBBS, 80, 364, () => {}), party: at(GI.BtPartyInvite, 160, 364, () => this.partyInvite()),
      info: at(GI.BtInfo, 239, 364, () => this.toggleInfo()), notice: at(GI.Btnotice, 288, 79, () => this.guildNotice()),
      edit: at(GG.BtModf, PANEL.x + 25, PANEL.y + 268, () => this.editRank()), save: at(GG.BtSave, PANEL.x + 125, PANEL.y + 268, () => this.saveRanks()),
    };
    this.lb = { add: at(BL.BtAdd, 85, 350, () => this.addBlack()), del: at(BL.BtDelete, 159, 350, () => this.deleteBlack()) };
  }
  frames() {
    const U = this.U, B = this.mgr.B;
    return [...super.frames(), U.backgrnd2, U.backgrnd3, U.Guild.backgrnd, ...allCanvases(U.Tab), ...allCanvases(U.Friend), ...allCanvases(U.Party),
      ...allCanvases(U.Guild.GuildInfo), ...allCanvases(U.Guild.GuildGrade), ...allCanvases(U.BlackList), ...allCanvases(B.Tab2), ...allCanvases(B.VScr4),
      ...allCanvases(B.BtMin), ...allCanvases(B.BtMax), ...allCanvases(this.mgr.W.itemSearch?.BtLeft), ...allCanvases(this.mgr.W.itemSearch?.BtRight)];
  }
  save() { saveKey(KEY, { x: this.x, y: this.y, tab: this.tab, showOnline: this.showOnline, closedGroups: [...this.closedGroups] }); }
  dragged() { this.save(); }
  setTab(t) {
    this.tab = t; this.sel = null; this.info = null; this.where = null;
    this.save();
  }
  setArg(tab) { if (tab !== undefined && tab !== this.tab) this.setTab(tab); }
  wantsArg(tab) { return tab !== undefined && tab !== this.tab; }

  // ---------------------------------------------------------------- data
  get party() { return this.g.party; }
  get guild() { return this.g.guild; }
  get me() { return this.g.player.id; }
  get myRank() { return this.guild?.members.find((m) => m.id === this.me)?.rank ?? 6; }
  /** The guild master is the first member of the guild's list. */
  isMaster() { return !!this.guild && this.guild.members[0]?.id === this.me; }
  /** This character's blocked buddies and Blacklist. */
  get mine() {
    const name = this.g.player?.name || '';
    if (this._mine?.name !== name) { const s = loadKey(`${KEY}.${name}`, {}); this._mine = { name, blocked: new Set(s.blocked || []), black: s.black || [] }; }
    return this._mine;
  }
  saveMine() { const m = this.mine; saveKey(`${KEY}.${m.name}`, { blocked: [...m.blocked], black: m.black }); }
  isBlocked(b) { return !!b && this.mine.blocked.has(b.id); }
  blockedName(name) { return (this.g.buddies || []).some((b) => b.name === name && this.isBlocked(b)); }
  blacklisted(name) { return this.mine.black.some((n) => n.toLowerCase() === String(name).toLowerCase()); }
  mapName(id) {
    for (const r of Object.values(this.mgr.strings.map || {})) { const m = r?.[id]; if (m) return m.mapName || m.streetName || ''; }
    return '';
  }
  t(ctx, s, x, y, color = COL.black, o = {}) { this.text(ctx, s, x, y, { size: 12, color, ...o }); }
  im(n) { return this.mgr.image(n); }

  // ---------------------------------------------------------------- list models: rows in list coordinates
  model() { return [this.buddyModel, this.partyModel, this.guildModel, () => ({ rows: [], h: 0 }), this.blackModel][this.tab].call(this); }
  /** Buddies by group: groups sorted by name, Default Group last (always there); each group's buddies by name. */
  buddyGroups() {
    const map = new Map([[DEFAULT_GROUP, []]]);
    for (const b of this.g.buddies || []) {
      if (b.pending) continue;
      const k = b.group || DEFAULT_GROUP;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(b);
    }
    const ci = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());
    const names = [...map.keys()].filter((k) => k !== DEFAULT_GROUP).sort(ci);
    return [...names, DEFAULT_GROUP].map((name) => ({ name, list: map.get(name).sort((a, b) => ci(a.name, b.name)) }));
  }
  buddyModel() {
    const rows = [];
    let y = 0;
    for (const grp of this.buddyGroups()) {
      const open = !this.closedGroups.has(grp.name), on = grp.list.filter((b) => b.channel >= 0).length;
      rows.push({ y, h: ROW, kind: 'group', key: `g:${grp.name}`, item: grp, open, label: `${grp.name}(${on}/${grp.list.length})`, draw: this.drawGroupRow,
        click: (x) => { if (x < 14) this.toggleGroup(grp.name); return false; } });
      y += ROW;
      if (!open) continue;
      const shown = this.showOnline ? grp.list.filter((b) => b.channel >= 0) : grp.list;
      if (!shown.length) { rows.push({ y, h: ROW, kind: 'none', draw: (ctx, r) => this.t(ctx, 'none', 14, r.y + 4) }); y += ROW; }
      for (let i = 0; i < shown.length; i += 2) {
        for (let k = 0; k < 2 && i + k < shown.length; k++) rows.push({ y, h: ROW, x: k * 128, w: 128, kind: 'buddy', key: `b:${shown[i + k].id}`, item: shown[i + k], draw: this.drawBuddy });
        y += ROW;
      }
    }
    return { rows, h: y };
  }
  drawGroupRow(ctx, r, sel) {
    const F = this.U.Friend;
    if (sel) { ctx.fillStyle = SEL; ctx.fillRect(0, r.y, LIST_W, ROW); }
    const arrow = this.im(r.open ? F.icon03 : F.icon04);
    if (arrow) ctx.drawImage(arrow, 5, r.y + ((ROW - arrow.height) >> 1));
    this.t(ctx, r.label, 14, r.y + 4, sel ? COL.white : COL.group, { bold: true });
    const dot = this.im(F.icon02);
    if (dot) for (let x = Math.ceil(textW(r.label, true)) + 16; x < 261; x += 4) ctx.drawImage(dot, x, r.y + 9);
  }
  drawBuddy(ctx, r, sel) {
    const F = this.U.Friend, b = r.item, blocked = this.isBlocked(b);
    if (sel) { ctx.fillStyle = SEL; ctx.fillRect(r.x, r.y, r.w, ROW); }
    const icon = this.im(blocked ? F.icon01 : b.channel >= 0 && b.channel === this.g.channel ? F.icon00 : null);
    if (icon) ctx.drawImage(icon, r.x + 5, r.y + ((ROW - icon.height) >> 1));
    this.t(ctx, b.name, r.x + 14, r.y + 4, sel ? COL.white : blocked ? COL.blocked : b.channel >= 0 ? COL.black : COL.offline);
  }
  /** Party: the ONLINE section (your map first, then elsewhere, each by name), then OFFLINE; "none" when empty. */
  partyModel() {
    const g = this.g, P = this.U.Party, members = this.party?.members || [], rows = [];
    const here = (m) => m.channel === g.channel && m.map === g.map?.id;
    const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const on = members.filter((m) => m.channel >= 0), off = members.filter((m) => m.channel < 0).sort(byName);
    const online = [...on.filter(here).sort(byName), ...on.filter((m) => !here(m)).sort(byName)];
    let y = 0;
    const art = (node, h) => { rows.push({ y, h, kind: 'art', node, draw: this.drawArt }); y += h; };
    const section = (bar, list, count, tip) => {
      rows.push({ y, h: 27, kind: 'bar', node: bar, count, tip, draw: this.drawPartyBar }); y += 27 + 4;
      art(P.party5, 18);
      if (!list.length) { rows.push({ y, h: ROW, kind: 'none', draw: (ctx, r) => { this.drawArt(ctx, { ...r, node: P.party1 }); this.t(ctx, 'none', 25, r.y + 2); } }); y += ROW; }
      for (const m of list) { rows.push({ y, h: ROW, kind: 'member', key: `m:${m.id}`, item: m, here: here(m), draw: this.drawPartyRow }); y += ROW; }
      art(P.party2, 4);
    };
    section(P.party0, online, `${on.filter(here).length}/${members.length}`, 'Online');
    y += 10;
    section(P.party4, off, `${off.length}/${members.length}`, 'Offline');
    return { rows, h: y };
  }
  drawArt(ctx, r) { const a = this.im(r.node); if (a) ctx.drawImage(a, 0, r.y); }
  drawPartyBar(ctx, r) {
    this.drawArt(ctx, r);
    this.t(ctx, r.count, 261, r.y + 6, COL.white, { align: 'right' });
  }
  drawPartyRow(ctx, r, sel) {
    const P = this.U.Party, m = r.item;
    this.drawArt(ctx, { ...r, node: P.party1 });
    if (sel) { ctx.fillStyle = SEL; ctx.fillRect(0, r.y, 279, ROW); }
    if (m.id === this.party?.leader) {
      const star = this.im(sel ? P.icon1 : P.icon0);
      if (star) ctx.drawImage(star, sel ? 1 : 3, sel ? r.y : r.y + 2);
    }
    const c = sel ? COL.white : m.channel >= 0 && !r.here ? COL.away : COL.black, job = jobName(m.job);
    this.t(ctx, m.name, 25, r.y + 2, c);
    this.t(ctx, job.length > 10 ? `${job.slice(0, 9)}..` : job, 125, r.y + 2, c);
    this.t(ctx, String(m.level).padStart(6), 205, r.y + 2, c);
  }
  /** Guild: ONLINE then OFFLINE, each with its count, page (20 a page), fold button and sortable header. */
  guildModel() {
    const g = this.guild, GI = this.U.Guild.GuildInfo, rows = [];
    if (!g) return { rows, h: 0 };
    let y = 0;
    [true, false].forEach((online, s) => {
      const sec = this.gsec[s], list = this.sortGuild(g.members.filter((m) => !!m.online === online), sec);
      const pages = Math.max(1, Math.ceil(list.length / GUILD_PAGE));
      if (sec.page >= pages) sec.page = pages - 1;
      rows.push({ y, h: 27, kind: 'gbar', s, online, node: online ? GI.guildinfo0 : GI.guildinfo1, count: `[${list.length}/${g.members.length}]`,
        page: `[${sec.page + 1}/${pages}]`, pages, draw: this.drawGuildBar, click: (x, ly) => this.guildBarClick(s, pages, x, ly) });
      y += 27 + (sec.open ? 4 : 0);
      if (sec.open) {
        rows.push({ y, h: 18, kind: 'ghead', s, draw: this.drawGuildHead, click: (x) => this.sortClick(s, x) });
        y += 18;
        const page = list.slice(sec.page * GUILD_PAGE, (sec.page + 1) * GUILD_PAGE);
        if (!page.length) { rows.push({ y, h: ROW, kind: 'none', draw: (ctx, r) => { this.drawArt(ctx, { ...r, node: GI.guildinfo3 }); this.t(ctx, 'none', 10, r.y + 4); } }); y += ROW; }
        for (const m of page) { rows.push({ y, h: ROW, kind: 'member', key: `m:${m.id}`, item: m, draw: this.drawGuildRow }); y += ROW; }
      }
      rows.push({ y, h: 1, kind: 'art', node: GI.guildinfo4, draw: this.drawArt });
      y += 1 + (s === 0 ? 10 : 0);
    });
    return { rows, h: y };
  }
  sortGuild(list, sec) {
    if (sec.sort < 0) return list;
    const key = [(m) => m.name.toLowerCase(), (m) => jobName(m.job), (m) => m.level, (m) => m.rank][sec.sort];
    const d = sec.desc ? -1 : 1;
    return [...list].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * d; });
  }
  /** The bar's page arrows (window x 254 - text width and 267) and fold button (window x 178). */
  barButtons(r) {
    const pw = textW(r.page), V = VIEW[2];
    return { fold: { x: 178 - V.x, y: 8, w: 12, h: 12 }, left: { x: 254 - pw - V.x, y: 7, w: 13, h: 13 }, right: { x: 267 - V.x, y: 7, w: 13, h: 13 } };
  }
  drawGuildBar(ctx, r) {
    const B = this.mgr.B, I = this.mgr.W.itemSearch, sec = this.gsec[r.s], bt = this.barButtons(r);
    this.drawArt(ctx, r);
    this.t(ctx, r.count, 185, r.y + 8, COL.white);
    this.t(ctx, r.page, 261, r.y + 8, COL.white, { align: 'right' });
    const put = (node, b, on = true) => { const st = on ? node?.normal : node?.disabled, a = this.im(st?.[0] || st); if (a) ctx.drawImage(a, b.x, r.y + b.y); };
    put(sec.open ? B.BtMin : B.BtMax, bt.fold);
    put(I?.BtLeft, bt.left, sec.page > 0);
    put(I?.BtRight, bt.right, sec.page < r.pages - 1);
  }
  guildBarClick(s, pages, x, y) {
    const sec = this.gsec[s], row = this.model().rows.find((r) => r.kind === 'gbar' && r.s === s), bt = this.barButtons(row);
    const inside = (b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    if (inside(bt.fold)) { sec.open = !sec.open; sfx.play('UI/BtMouseClick'); return true; }
    if (inside(bt.left) && sec.page > 0) { sec.page--; sfx.play('UI/BtMouseClick'); return true; }
    if (inside(bt.right) && sec.page < pages - 1) { sec.page++; sfx.play('UI/BtMouseClick'); return true; }
    return true;
  }
  drawGuildHead(ctx, r) {
    const GI = this.U.Guild.GuildInfo, sec = this.gsec[r.s];
    this.drawArt(ctx, { ...r, node: GI.guildinfo2 });
    const lit = sec.sort >= 0 && this.im(GI.guildinfo7);
    if (lit) { const [x0, x1] = GUILD_COLS[sec.sort]; ctx.drawImage(lit, x0, 0, x1 - x0, 18, x0, r.y, x1 - x0, 18); }
  }
  sortClick(s, x) {
    const c = GUILD_COLS.findIndex(([x0, x1]) => x >= x0 && x < x1), sec = this.gsec[s];
    if (c < 0) return true;
    if (sec.sort === c) sec.desc = !sec.desc; else { sec.sort = c; sec.desc = false; }
    sfx.play('UI/BtMouseClick');
    return true;
  }
  drawGuildRow(ctx, r, sel) {
    const m = r.item, c = sel ? COL.white : COL.black;
    this.drawArt(ctx, { ...r, node: this.U.Guild.GuildInfo.guildinfo3 });
    if (sel) { ctx.fillStyle = SEL; ctx.fillRect(0, r.y, LIST_W, ROW); }
    this.t(ctx, m.name, 10, r.y + 4, c);
    this.t(ctx, m.job < 0 ? '??' : fit(jobName(m.job), 67), 100, r.y + 4, c);
    this.t(ctx, m.level < 0 ? '??' : String(m.level), 170, r.y + 4, c);
    this.t(ctx, this.guild.ranks[m.rank - 1] || '', 210, r.y + 4, c);
  }
  /** Blacklist: the BLACKLIST bar, then two names a row (or "none"), closed by blacklist2. */
  blackModel() {
    const BL = this.U.BlackList, names = this.mine.black, rows = [{ y: 0, h: 27, kind: 'art', node: BL.blacklist0, draw: (ctx, r) => {
      this.drawArt(ctx, r);
      this.t(ctx, `${names.length}/${BLACK_MAX}`, 261, 8, COL.white, { align: 'right' });
    } }];
    let y = 27;
    if (!names.length) { rows.push({ y, h: ROW, kind: 'none', draw: (ctx, r) => { this.drawArt(ctx, { ...r, node: BL.blacklist1 }); this.t(ctx, 'none', 25, r.y + 4); } }); y += ROW; }
    for (let i = 0; i < names.length; i += 2) {
      for (let k = 0; k < 2 && i + k < names.length; k++) {
        rows.push({ y, h: ROW, x: k * 128, w: 128, kind: 'black', key: `k:${i + k}`, item: names[i + k], draw: (ctx, r, sel) => {
          if (r.x === 0) this.drawArt(ctx, { ...r, node: BL.blacklist1 });
          if (sel) { ctx.fillStyle = SEL; ctx.fillRect(r.x, r.y, r.w, ROW); }
          this.t(ctx, r.item, r.x + 25, r.y + 4, sel ? COL.white : COL.black);
        } });
      }
      y += ROW;
    }
    rows.push({ y, h: 6, kind: 'art', node: BL.blacklist2, draw: this.drawArt });
    return { rows, h: y + 6 };
  }
  /** The selected row's model entry, or null. */
  selected() { return this.sel ? this.model().rows.find((r) => r.key === this.sel) || null : null; }
  /** The selected character other than you: a buddy, party or guild member. */
  other() {
    const r = this.selected();
    return r && (r.kind === 'buddy' || r.kind === 'member') && r.item.id !== this.me ? r.item : null;
  }
  isOnline(c) {
    if (!c) return false;
    if (this.tab === 2) return !!c.online;
    return c.channel >= 0 && !(this.tab === 0 && this.isBlocked(c));
  }

  // ---------------------------------------------------------------- shared actions
  whisper(name = this.other()?.name) {
    const sb = this.g.statusBar;
    if (!sb || !name) return;
    sb.whisperTo = name;
    sb.whisperNames = [name, ...(sb.whisperNames || []).filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 10);
    sb.chatTarget = 'whisper';
    sb.focusChat();
  }
  talk() {
    const c = this.other();
    if (!c) return;
    if (!this.mgr.isOpen('messenger')) this.mgr.open('messenger');
    this.g.net?.messengerInvite(c.name);
  }
  find() { const c = this.other(); if (c) this.g.net?.find(c.name); }
  partyInvite() { const c = this.other(); if (c) this.g.net?.partyOp(4, c.name); }
  error(text) { this.g.hud?.message(text, CHAT_COLOR.error); }

  // ---------------------------------------------------------------- buddy
  setShowOnline(on) { this.showOnline = on; this.save(); }
  toggleGroup(name) { if (this.closedGroups.has(name)) this.closedGroups.delete(name); else this.closedGroups.add(name); this.save(); }
  selGroup() { const r = this.selected(); return r?.kind === 'group' ? r.item : r?.kind === 'buddy' ? { name: r.item.group || DEFAULT_GROUP } : null; }
  async addBuddy() {
    const name = (await this.mgr.askText("Please enter the name of the character\r\nyou'll add as a buddy.", '', { max: 12 }))?.trim();
    if (!name) return;
    const group = this.selGroup()?.name || DEFAULT_GROUP;
    if (name.toLowerCase() === this.g.player.name.toLowerCase()) { this.mgr.notice("You can't enter yourself as your buddy."); return; }
    if ((this.g.buddies || []).some((b) => b.name.toLowerCase() === name.toLowerCase() && (b.group || DEFAULT_GROUP) === group)) { this.mgr.notice('The buddy is already registered.'); return; }
    this.g.net?.buddyAdd(name, group);
  }
  /** Puts the selected buddy in a new group. */
  async addGroup() {
    const r = this.selected();
    if (r?.kind !== 'buddy') { this.mgr.notice('You have not selected any friends.'); return; }
    const group = await this.askGroup('');
    if (group) this.g.net?.buddyAdd(r.item.name, group);
  }
  async askGroup(def) {
    const name = (await this.mgr.askText('Please enter the group name.', def, { max: 16 }))?.trim();
    if (!name) return null;
    if (name === def) return null;
    return name;
  }
  async editBuddy() {
    const r = this.selected();
    if (!r) return;
    if (r.kind === 'buddy') { const group = await this.askGroup(r.item.group || DEFAULT_GROUP); if (group) this.g.net?.buddyAdd(r.item.name, group); return; }
    if (r.item.name === DEFAULT_GROUP) { this.mgr.notice(`${DEFAULT_GROUP} cannot be changed or deleted.`); return; }
    const group = await this.askGroup(r.item.name);
    if (!group) return;
    if (this.buddyGroups().some((x) => x.name === group)) { this.mgr.notice('This name already exists.'); return; }
    for (const b of r.item.list) this.g.net?.buddyAdd(b.name, group);
  }
  async deleteBuddy() {
    const r = this.selected();
    if (!r) return;
    if (r.kind === 'buddy') {
      if (await this.mgr.confirm(`Are you sure you want to delete\r\n'${r.item.name}' from the list?`)) this.g.net?.buddyDelete(r.item.id);
      return;
    }
    if (r.item.name === DEFAULT_GROUP) { this.mgr.notice(`${DEFAULT_GROUP} cannot be changed or deleted.`); return; }
    if (!await this.mgr.confirm(`'${r.item.name}' group will be deleted.\r\nYour friends in the group\r\nwill be moved to ${DEFAULT_GROUP}.`)) return;
    for (const b of r.item.list) this.g.net?.buddyAdd(b.name, DEFAULT_GROUP);
  }
  /** Blocking is kept here only: the buddy shows red, counts as offline and their buddy chat is dropped. */
  toggleBlock() {
    const r = this.selected();
    if (!r) return;
    const list = r.kind === 'group' ? r.item.list : [r.item], set = this.mine.blocked;
    const unblock = list.length > 0 && list.every((b) => set.has(b.id));
    for (const b of list) {
      if (unblock) set.delete(b.id); else if (!set.has(b.id)) set.add(b.id); else continue;
      this.g.hud?.message(`Buddy chat with "${b.name}" has been ${unblock ? 'enabled' : 'disabled'}.`, CHAT_COLOR.error);
    }
    this.saveMine();
  }
  /** Chat with the selected buddy's group (the chat target To Group). */
  groupChat() {
    const grp = this.selGroup(), sb = this.g.statusBar;
    if (!grp || !sb) return;
    sb.chatGroup = grp.name; sb.chatTarget = 'group';
    sb.focusChat();
  }
  async note() {
    const r = this.selected();
    if (r?.kind !== 'buddy') return;
    const slot = Object.entries(this.g.inventory?.[5] || {}).find(([, it]) => it?.id === MEMO)?.[0];
    if (slot === undefined) { this.mgr.notice('You can use it after purchasing the Memo.'); return; }
    if (this.g.cashGate()) this.g.useNote(Number(slot), MEMO, r.item.name);
  }
  async openBuddy(r) {
    if (r.kind === 'group') { this.editBuddy(); return; }
    const b = r.item;
    if (this.isBlocked(b)) {
      if (!await this.mgr.confirm('You can use it after unblocking.\r\nWould you like to unblock?')) return;
      this.toggleBlock();
    }
    if (b.channel >= 0) this.whisper(b.name); else this.note();
  }
  /** Where the selected online buddy is (a buddy find); one at a time. */
  locate(b) {
    this.where = null;
    if (!b || b.channel < 0 || this.isBlocked(b)) return;
    if (this.whereAsked && performance.now() - this.whereAsked.at < 3000) { this.error('Please try again.'); return; }
    this.whereAsked = { name: b.name, at: performance.now() };
    this.g.net?.findBuddy(b.name);
  }
  located(f) {
    if (this.whereAsked?.name.toLowerCase() !== f.name.toLowerCase()) return;
    this.whereAsked = null;
    const b = this.selected()?.item;
    if (!b || b.name?.toLowerCase() !== f.name.toLowerCase()) return;
    const place = f.type === 1 ? this.mapName(f.where) : f.type === 3 ? this.g.channelNames?.[f.where] || `Channel ${f.where + 1}` : f.type === 2 ? 'Cash Shop' : '';
    this.where = { name: b.name, text: `${b.name}'s Location - ${place}` };
  }

  // ---------------------------------------------------------------- party
  createParty() {
    if (this.party) { this.error('Already have joined a party.'); return; }
    if (this.tooYoung()) return;
    this.g.net?.partyOp(1);
  }
  tooYoung() {
    const s = this.g.stats;
    if (s && s.level < 10 && isBeginner(s.job)) { this.error('Characters whose level is below Lv. 10, such as Beginners, Noblesses, and Legends cannot form a party.'); return true; }
    return false;
  }
  async invite() {
    const name = (await this.mgr.askText("Please enter the name of the character\r\nyou'll invite to your party.", '', { max: 12 }))?.trim();
    if (!name) return;
    const p = this.party;
    if (!p && this.tooYoung()) return;
    if (name.toLowerCase() === this.g.player.name.toLowerCase()) { this.error('\tYou may not invite yourself to the party.'); return; }
    if (p && p.leader !== this.me) { this.error('You are not the master of the party.'); return; }
    if (p && p.members.length >= 6) { this.error('It is impossible to invite someone to the party.'); return; }
    this.g.net?.partyOp(4, name);
  }
  kick() {
    const m = this.other();
    if (!m) return;
    if (this.party?.leader !== this.me) { this.error('You are not the master of the party.'); return; }
    this.g.net?.partyOp(5, m.id);
    this.sel = null;
  }
  leave() {
    if (!this.party) { this.error('You have yet to join a party.'); return; }
    this.g.net?.partyOp(2);
  }
  async makeLeader() {
    const m = this.other();
    if (!m) return;
    if (this.party?.leader !== this.me) { this.error('You are not the master of the party.'); return; }
    if (await this.mgr.confirm(`Do you wish to pass the leader position to \r\n${m.name}?`)) this.g.net?.partyOp(6, m.id);
  }

  // ---------------------------------------------------------------- guild
  async guildInvite() {
    const name = (await this.mgr.askText('Please type the name of the character, you want to invite.', '', { max: 12 }))?.trim();
    if (!name || name.length < 4) return;
    const g = this.guild;
    if (name.toLowerCase() === this.g.player.name.toLowerCase()) { this.error('You cannot invite yourself to the guild.'); return; }
    if (!g) { this.error('You are not in the guild.'); return; }
    if (this.myRank > 2) { this.error('You are not the master of the guild.'); return; }
    if (g.members.length >= g.capacity) { this.error('You cannot invite more people to the guild.'); return; }
    this.g.net?.guildOp(5, name);
  }
  async guildLeave() {
    if (!this.guild) { this.error('You are not in the guild.'); return; }
    if (this.isMaster()) { this.error('You cannot quit the guild, since you are the master of the guild.'); return; }
    if (await this.mgr.confirm('Would you like to quit the guild?')) this.g.net?.guildOp(7, this.me, this.g.player.name);
  }
  async guildExpel() {
    const m = this.other(), g = this.guild;
    if (!m || !g) return;
    if (!g.members.some((x) => x.id === m.id)) { this.error(`'${m.name}' is not the member of the guild.`); return; }
    if (g.members[0]?.id === m.id) { this.error('You may not ban the Guild Master.'); return; }
    if (m.rank === 2 && this.myRank === 2) { this.error('Only Guild Master can expel Jr.Masters.'); return; }
    if (await this.mgr.confirm(`Expel '${m.name}' from the guild?`)) this.g.net?.guildOp(8, m.id, m.name);
  }
  guildRank(d) { const m = this.other(); if (m) this.g.net?.guildRank(m.id, m.rank + d); }
  async guildNotice() {
    const t = (await this.mgr.askText('Please enter the Guild Notice.', this.guild?.notice || '', { max: 100, width: 220 }))?.trim();
    if (t) this.g.net?.guildOp(0x10, t);
  }
  /** The lowest rank in use: 3 when title 4 is empty, 4 when title 5 is, else 5. */
  lowestRank() { const r = this.guild?.ranks || []; return !r[3] ? 3 : !r[4] ? 4 : 5; }
  rankButtons(m) {
    if (!m) return [false, false];
    const low = this.lowestRank();
    if (this.isMaster()) return m.rank === 1 ? [false, false] : m.rank === 2 ? [false, true] : m.rank >= low ? [true, false] : [true, true];
    if (this.myRank === 2 && m.rank >= 3) return [m.rank > 3, m.rank < low];
    return [false, false];
  }
  toggleInfo() { this.info = this.info ? null : { at: performance.now(), sel: -1, ranks: [...(this.guild?.ranks || ['', '', '', '', ''])] }; }
  panelOpen() { return !!this.info && this.tab === 2 && !!this.guild; }
  panelReveal() { return this.info ? Math.min(PANEL.w, 40 * (1 + Math.floor((performance.now() - this.info.at) / 30))) : 0; }
  async editRank() {
    const i = this.info?.sel ?? -1;
    if (i < 0 || !this.isMaster()) return;
    const t = await this.mgr.askText('Please put a position,\r\n which you want to change to.', this.info.ranks[i] || '', { max: 10, empty: i >= 3 });
    if (t === null || !this.info) return;
    const v = t.trim(), ranks = this.info.ranks;
    if (v && v.length < (i < 3 ? 4 : 1)) return;
    if (!v) {
      if (i < 3) return;
      if (i === 3 && ranks[4]) { this.mgr.notice('You cannot delete this position, because\r\nthere is a lower rank than this position.'); return; }
      if (this.guild.members.some((m) => m.rank === i + 1)) { this.mgr.notice('You cannot delete this position,\r\nbecause there are still members\r\nwho are in this position.'); return; }
    }
    ranks[i] = v;
    if (i === 4 && v && !ranks[3]) ranks[3] = 'Member';
  }
  async saveRanks() {
    if (!this.info || !this.isMaster() || !await this.mgr.confirm('Would like to save the change?')) return;
    const ranks = this.info.ranks;
    if (ranks.some((r, k) => r !== (this.guild?.ranks[k] || ''))) this.g.net?.guildOp(0x0D, ...ranks); else this.mgr.notice('It is saved.');
  }

  // ---------------------------------------------------------------- blacklist
  async addBlack() {
    const name = (await this.mgr.askText("Please enter the name of the character you'd like to add to the Blacklist.", '', { max: 12 }))?.trim();
    if (!name) return;
    const list = this.mine.black;
    if (!NAME_OK.test(name)) { this.mgr.notice('This character name does not exist\r\nPlease check again'); return; }
    if (name.toLowerCase() === this.g.player.name.toLowerCase()) { this.mgr.notice('You may not enter yourself in the Blacklist'); return; }
    if (this.blacklisted(name)) { this.mgr.notice('This name has already been registered\r\nPlease check again'); return; }
    list.push(name);
    list.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    this.saveMine();
  }
  deleteBlack() {
    const r = this.selected();
    if (r?.kind !== 'black') return;
    this.mine.black.splice(this.mine.black.indexOf(r.item), 1);
    this.sel = null;
    this.saveMine();
  }

  // ---------------------------------------------------------------- frame
  updateButtons() {
    const t = this.tab, r = this.selected(), c = this.other(), on = this.isOnline(c);
    for (const [i, set] of [[0, this.bb], [1, this.pb], [2, this.gb], [4, this.lb]]) for (const b of Object.values(set)) b.visible = t === i;
    // buddy: nothing selected leaves only ADD BUDDY / ADD GROUP / SHOW lit
    const B = this.bb, grp = r?.kind === 'group', bud = r?.kind === 'buddy', blocked = bud && this.isBlocked(r.item);
    B.online.visible = t === 0 && !this.showOnline; B.all.visible = t === 0 && this.showOnline;
    const allBlocked = grp && r.item.list.length > 0 && r.item.list.every((b) => this.isBlocked(b));
    B.block.visible = t === 0 && !(bud ? blocked : allBlocked); B.unblock.visible = t === 0 && !B.block.visible;
    B.groupChat.enabled = bud;
    B.talk.enabled = B.whisper.enabled = B.party.enabled = bud && on;
    B.mod.enabled = B.del.enabled = bud || (grp && r.item.name !== DEFAULT_GROUP);
    B.block.enabled = B.unblock.enabled = bud || grp;
    B.note.enabled = bud && !blocked;
    // party
    const P = this.pb, p = this.party, lead = !!p && p.leader === this.me;
    P.create.enabled = !p;
    P.search.enabled = !!p || (this.g.stats?.level ?? 0) >= 10;
    P.hp.enabled = P.leave.enabled = !!p;
    P.kick.enabled = lead && !!c;
    P.whisper.enabled = P.talk.enabled = !!c && on;
    P.invite.enabled = !p || lead;
    P.boss.enabled = lead && !!c && on && c.job !== 0;
    // guild
    const G = this.gb, g = this.guild, rank = this.myRank, [up, down] = this.rankButtons(c);
    G.invite.enabled = !!g && rank <= 2;
    G.leave.enabled = !!g;
    G.where.enabled = G.whisper.enabled = G.party.enabled = !!g && !!c && on;
    G.talk.enabled = G.whisper.enabled && !this.mgr.isOpen('messenger');
    G.up.enabled = !!g && up; G.down.enabled = !!g && down;
    G.kick.enabled = !!g && !!c && ((c.rank >= 3 && rank <= 2) || (c.rank === 2 && this.isMaster()));
    G.bbs.enabled = false;
    G.info.enabled = !!g;
    G.notice.enabled = !!g && rank <= 2;
    const panel = this.panelOpen() && this.panelReveal() >= PANEL.w;
    G.edit.visible = G.save.visible = panel;
    G.edit.enabled = this.isMaster() && (this.info?.sel ?? -1) >= 0;
    G.save.enabled = this.isMaster();
    // blacklist
    this.lb.add.enabled = this.mine.black.length < BLACK_MAX;
    this.lb.del.enabled = this.mine.black.length > 0;
  }
  draw(ctx) {
    this.bg = this.U[BACKS[this.tab]];
    if (!this.guild) this.info = null;
    this.updateButtons();
    super.draw(ctx);
  }
  contains(x, y) {
    if (super.contains(x, y)) return true;
    const lx = x - this.x, ly = y - this.y;
    return this.panelOpen() && lx >= PANEL.x && lx < PANEL.x + this.panelReveal() && ly >= PANEL.y && ly < PANEL.y + PANEL.h;
  }
  body(ctx) {
    if (this.panelOpen()) this.drawPanel(ctx);
    this.drawTabs(ctx);
    if (this.tab === 0) this.buddyHead(ctx);
    else if (this.tab === 2) this.guildHead(ctx);
    else if (this.tab === 3) this.allianceHead(ctx);
    this.drawList(ctx);
  }
  /** Tab2 boxes sized to their labels: each label 4px after the last box's end, from x 8. */
  drawTabs(ctx) {
    const T = this.mgr.B.Tab2;
    for (let i = 0; i < 5; i++) {
      const on = i === this.tab, label = this.im(this.U.Tab[on ? 'enabled' : 'disabled'][i]), lw = label?.width ?? TAB_W[i];
      const fx = TAB_X[i] + 2, fw = lw - 4, fill = this.im(T[on ? 'fill1' : 'fill0']);
      if (fill) ctx.drawImage(fill, fx, 23, fw, fill.height);
      if (i === 0) { const cap = this.im(T[on ? 'left1' : 'left0']); if (cap) ctx.drawImage(cap, fx - 4, 23); }
      const edge = this.im(T[i === 4 ? (on ? 'right1' : 'right0') : `middle${on ? 1 : i + 1 === this.tab ? 2 : 0}`]);
      if (edge) ctx.drawImage(edge, fx + fw, 23);
    }
    for (let i = 0; i < 5; i++) { const label = this.im(this.U.Tab[i === this.tab ? 'enabled' : 'disabled'][i]); if (label) ctx.drawImage(label, TAB_X[i], 28); }
  }
  tabAt(lx, ly) {
    if (ly < 23 || ly >= 42) return -1;
    for (let i = 0; i < 5; i++) if (lx >= TAB_X[i] - 2 && lx < TAB_X[i] + TAB_W[i] + 2) return i;
    return -1;
  }
  buddyHead(ctx) {
    const n = (this.g.buddies || []).filter((b) => !b.pending).length;
    this.t(ctx, `${n}/${this.g.buddyCapacity ?? 20}`, 295, 62, COL.white, { align: 'right' });
    const r = this.selected();
    const line = this.where && r?.kind === 'buddy' && r.item.name === this.where.name ? this.where.text : `My Location - ${this.mapName(this.g.map?.id)}`;
    this.t(ctx, line, 10, 315, COL.where);
  }
  guildHead(ctx) {
    const g = this.guild, GI = this.U.Guild.GuildInfo;
    if (!g) { const s = 'You are not in the guild.'; this.t(ctx, s, 5 + Math.floor((306 - textW(s)) / 2), 58); return; }
    const x0 = 5 + Math.floor((306 - (textW(g.name) + 26)) / 2);
    if (!drawEmblem(ctx, this.g, g.emblem, x0 + 4, 56)) { const gm = this.im(GI.guildmark); if (gm) ctx.drawImage(gm, x0 + 3, 54); }
    this.t(ctx, g.name, x0 + 26, 58);
    const box = this.im(GI.guildinfo6);
    if (box) ctx.drawImage(box, 5, 80);
    if (!g.notice) { this.t(ctx, '* Guild Notice', 13, 85); return; }
    // the notice crawls left through a 270px strip, 1px a tick, starting again at 250 once it has gone
    const w = Math.ceil(textW(g.notice)), x = 250 - (Math.floor(performance.now() / 30) % (250 + w + 1));
    ctx.save(); ctx.beginPath(); ctx.rect(10, 85, 270, 15); ctx.clip();
    this.t(ctx, g.notice, 10 + x, 85);
    ctx.restore();
  }
  allianceHead(ctx) {
    const s = 'This guild is not affiliated with any Guild Union.';
    this.t(ctx, s, 5 + Math.floor((306 - textW(s)) / 2), 60);
  }
  drawPanel(ctx) {
    const g = this.guild, GG = this.U.Guild.GuildGrade, ranks = this.info.ranks, ox = PANEL.x - (PANEL.w - this.panelReveal());
    ctx.save(); ctx.beginPath(); ctx.rect(PANEL.x, PANEL.y, PANEL.w, PANEL.h); ctx.clip(); ctx.translate(ox, PANEL.y);
    const put = (n, x, y) => { const a = this.im(n); if (a) ctx.drawImage(a, x, y); };
    put(this.U.Guild.backgrnd, 0, 0);
    put(GG.guildgrade3, 6, 18); put(GG.guildgrade4, 6, 45); put(GG.guildgrade0, 6, 91); put(GG.guildgrade1, 6, 128); put(GG.guildgrade2, 6, 146);
    this.t(ctx, String(g.gp ?? 0), 221, 67, COL.black, { align: 'right' });
    for (let i = 0; i < 5; i++) {
      const y = 146 + 18 * i, sel = this.info.sel === i;
      if (sel) { ctx.fillStyle = SEL; ctx.fillRect(6, y, 221, 18); }
      this.t(ctx, String(i + 1), 26, y + 4, sel ? COL.white : COL.black);
      this.t(ctx, ranks[i] || '', 66, y + 4, sel ? COL.white : COL.black);
      this.t(ctx, RANK_NAMES[i], 189, y + 4, sel ? COL.white : ranks[i] ? COL.black : COL.away, { align: 'center' });
    }
    ctx.restore();
  }
  drawList(ctx) {
    const v = VIEW[this.tab], { rows, h } = this.model(), max = this.maxScroll(h);
    if (this.scroll[this.tab] > max) this.scroll[this.tab] = max;
    const top = this.scroll[this.tab] * STEP;
    ctx.save(); ctx.beginPath(); ctx.rect(v.x, v.y, LIST_W, v.h); ctx.clip(); ctx.translate(v.x, v.y - top);
    for (const r of rows) if (r.y + r.h > top && r.y < top + v.h) r.draw.call(this, ctx, r, !!r.key && r.key === this.sel);
    ctx.restore();
    // VScr4: 13px arrows, the base stretched between, a 25px thumb
    const V = this.mgr.B.VScr4, on = max > 0, S = on ? V.enabled : V.disabled;
    const prev = this.im(on ? S.prev0 : S.prev), next = this.im(on ? S.next0 : S.next), base = this.im(S.base), ah = prev?.height || 13;
    if (base) ctx.drawImage(base, SCR_X, v.y + ah, base.width, v.h - 2 * ah);
    if (prev) ctx.drawImage(prev, SCR_X, v.y);
    if (next) ctx.drawImage(next, SCR_X, v.y + v.h - ah);
    const thumb = on && this.im(S.thumb0);
    if (thumb) ctx.drawImage(thumb, SCR_X, v.y + ah + Math.round((v.h - 2 * ah - thumb.height) * this.scroll[this.tab] / max));
  }
  /** Scroll positions: none when it all fits, else one per 33px of overflow plus one. */
  maxScroll(h) { const v = VIEW[this.tab]; return h > v.h ? Math.floor((h - v.h) / STEP) + 1 : 0; }
  scrollHit(lx, ly) {
    const v = VIEW[this.tab];
    if (lx < SCR_X || lx >= SCR_X + 15 || ly < v.y || ly >= v.y + v.h) return false;
    const max = this.maxScroll(this.model().h), s = this.scroll;
    if (ly < v.y + 13) s[this.tab] = Math.max(0, s[this.tab] - 1);
    else if (ly >= v.y + v.h - 13) s[this.tab] = Math.min(max, s[this.tab] + 1);
    else s[this.tab] = Math.max(0, Math.min(max, Math.round(((ly - v.y - 25) / Math.max(1, v.h - 51)) * max)));
    return true;
  }
  listPoint(lx, ly) {
    const v = VIEW[this.tab];
    if (lx < v.x || lx >= v.x + LIST_W || ly < v.y || ly >= v.y + v.h) return null;
    return { x: lx - v.x, y: ly - v.y + this.scroll[this.tab] * STEP };
  }
  rowAt(lx, ly) {
    const p = this.listPoint(lx, ly);
    if (!p) return null;
    const r = this.model().rows.find((q) => p.y >= q.y && p.y < q.y + q.h && p.x >= (q.x || 0) && p.x < (q.x || 0) + (q.w ?? LIST_W));
    return r ? { r, x: p.x - (r.x || 0), y: p.y - r.y } : null;
  }

  // ---------------------------------------------------------------- mouse
  down(lx, ly) {
    const t = this.tabAt(lx, ly);
    if (t >= 0) { if (t !== this.tab) { this.setTab(t); sfx.play('UI/Tab'); } return; }
    if (this.panelOpen() && lx >= PANEL.x) {
      const i = Math.floor((ly - PANEL.y - 146) / 18);
      if (lx >= PANEL.x + 6 && lx < PANEL.x + 227 && i >= 0 && i < 5) this.info.sel = i;
      return;
    }
    if (this.scrollHit(lx, ly)) return;
    if (!this.listPoint(lx, ly)) return;
    const hit = this.rowAt(lx, ly);
    if (hit?.r.click?.(hit.x, hit.y)) return;
    const key = hit?.r.key ?? null;
    if (key === this.sel) return;
    this.sel = key;
    if (this.tab === 0) this.locate(hit?.r.kind === 'buddy' ? hit.r.item : null);
  }
  dblclick(lx, ly) {
    const hit = this.rowAt(lx, ly);
    if (!hit?.r.key) return;
    if (this.tab === 0) this.openBuddy(hit.r);
    else if (this.tab === 2 && hit.r.item.id !== this.me) this.g.requestCharInfo(hit.r.item.id);
  }
  wheel(dy) {
    const max = this.maxScroll(this.model().h);
    this.scroll[this.tab] = Math.max(0, Math.min(max, this.scroll[this.tab] + Math.sign(dy)));
  }
  tooltip(lx, ly) {
    const tip = (title) => ({ title, lines: [] });
    if (this.tab === 2 && this.guild?.notice && lx >= 5 && lx < 280 && ly >= 83 && ly < 99) return tip(this.guild.notice);
    const hit = this.rowAt(lx, ly);
    if (!hit) return null;
    const { r, x } = hit;
    if (this.tab === 0) {
      if (r.kind === 'group') return tip('Double-click to make changes to the group.');
      if (r.kind !== 'buddy') return null;
      const b = r.item;
      if (this.isBlocked(b)) return tip('This user has been blocked.');
      if (b.channel < 0) return tip('Double-click to send a note.');
      return tip(b.channel === this.g.channel ? 'Double-click to send a whisper. (same channel)' : 'Double-click to send a whisper.');
    }
    if (this.tab === 1) {
      if (r.kind === 'bar' && x >= 230) return tip('Online Party Members / Total Registered Party Members');
      if (r.kind !== 'member') return null;
      const m = r.item, job = jobName(m.job);
      if (x >= 125 && x < 200 && (job.length > 10 || textW(job) > 67)) return tip(job);
      if (x >= 25 && x < 125 && m.channel >= 0 && !r.here) {
        if (m.channel !== this.g.channel) return tip(this.g.channelNames?.[m.channel] || `Channel ${m.channel + 1}`);
        return tip(m.map === 0 || m.map === undefined ? 'Cash Shop' : 'The user is currently at another location.');
      }
      return null;
    }
    if (this.tab === 2) {
      if (r.kind === 'gbar' && x >= 185 && x < 230) return tip(`${r.online ? 'Online' : 'Offline'} Guild Members / Total Registered Guild Members`);
      if (r.kind === 'ghead') { const c = GUILD_COLS.find(([x0, x1]) => x >= x0 && x < x1); return c ? tip(`Sort thru ${c[2]}`) : null; }
      if (r.kind !== 'member') return null;
      const m = r.item;
      if (x >= 205) return tip(RANK_NAMES[m.rank - 1] || 'Member');
      if (x >= 165 && m.level < 0) return tip('\tUnknown');
      if (x >= 96 && x < 165 && m.job >= 0 && textW(jobName(m.job)) > 67) return tip(jobName(m.job));
      return null;
    }
    if (this.tab === 4 && r.kind === 'art' && r.y === 0 && x >= 230) return tip('Currently Registered Users / Maximum Capacity');
    return null;
  }
}

// ==================================================================== party HP list
/**
 * HP MARK's list (Party/PartyHP): every party slot in order, you too, on a 9-piece frame (the right 144px fixed),
 * width max(widest name + 100, 150), a row every 17px from y 5: the name at x 5 (black on your map, #404040 off it),
 * GaugeBar/bar at (width - 72, +3) filled with gauge (64px is full) under graduation at (width - 75, 0). Opens with
 * a party while "ShowPartyHP" is on (the default); draggable, its place kept.
 */
const HP_KEY = 'maple.partyhp';
export class PartyHpWin extends Win {
  constructor(mgr) {
    super(mgr, null, 0, 0);
    this.buttons = []; this.closeBtn = null;
    const s = loadKey(HP_KEY, {});
    this.on = s.on !== false; this.x = s.x ?? 730; this.y = s.y ?? 400; this.w = 0; this.h = 0;
    this.keepOnEscape = true; this.closeSound = null;
  }
  get P() { return this.mgr.W.UserList.Party.PartyHP; }
  frames() { return allCanvases(this.P); }
  saveState() { saveKey(HP_KEY, { on: this.on, x: this.x, y: this.y }); }
  dragged() { this.saveState(); }
  toggle() { this.on = !this.on; this.saveState(); this.sync(); }
  /** Shown while in a party with the setting on. */
  sync() {
    const want = this.on && !!this.g.party, i = this.mgr.order.indexOf(this);
    if (want && i < 0) this.mgr.order.unshift(this);
    else if (!want && i >= 0) this.mgr.order.splice(i, 1);
  }
  members() { return this.g.party?.members || []; }
  draw(ctx) {
    const list = this.members();
    if (!list.length) return;
    this.w = Math.max(150, Math.ceil(Math.max(...list.map((m) => textW(m.name)))) + 100);
    this.h = list.length * 17 + 10; this.dragH = this.h;
    this.x = Math.min(this.x, UI_W - this.w);
    super.draw(ctx);
  }
  body(ctx) {
    const P = this.P, G = P.GaugeBar, im = (n) => this.mgr.image(n), w = this.w, h = this.h, mid = w - 144 - 5;
    const row = (l, m, r, y, rh) => {
      const a = im(P[l]), b = im(P[m]), c = im(P[r]);
      if (a) ctx.drawImage(a, 0, y, 5, rh);
      if (b) ctx.drawImage(b, 5, y, mid, rh);
      if (c) ctx.drawImage(c, w - 144, y, 144, rh);
    };
    row('nw', 'n', 'ne', 0, 7); row('w', 'c', 'e', 7, h - 14); row('sw', 's', 'se', h - 7, 7);
    const g = this.g, bar = im(G.bar), gauge = im(G.gauge), grad = im(G.graduation);
    this.members().forEach((m, i) => {
      const y = 17 * i + 5, me = m.id === g.player.id, here = me || (m.channel === g.channel && m.map === g.map?.id);
      this.text(ctx, m.name, 5, y, { size: 12, color: here ? '#000' : '#404040' });
      if (bar) ctx.drawImage(bar, w - 72, y + 3);
      const fill = !here ? 0 : me ? Math.floor((g.stats.hp * 64) / Math.max(1, g.stats.maxHp)) : Math.floor((Math.floor((m.hp || 0) * 100 / Math.max(1, m.maxHp || 0)) * 64) / 100);
      if (gauge && fill > 0) ctx.drawImage(gauge, w - 72, y + 3, Math.min(64, fill), gauge.height);
      if (grad) ctx.drawImage(grad, w - 75, y);
    });
  }
}

// ==================================================================== guild contract
/**
 * Guild/Make, 250x314 at (275, 100): the scroll unrolls (backgrnd, 500ms then 120ms a frame), a second later the
 * contract (message) fades in at (31, 51) with the master and guild names in yellow Arial 12, right-aligned at x 105
 * on its blanks, and two seconds after that AGREE / DISAGREE. Left alone for 30s it refuses.
 */
export class GuildContractWin extends Win {
  constructor(mgr, master, guildName, done) {
    super(mgr, null, 275, 100);
    this.buttons = []; this.closeBtn = null;
    this.M = mgr.W.UserList.Guild.Make; this.w = 250; this.h = 314; this.modal = true; this.fixed = true;
    this.master = master; this.guildName = guildName; this.done = done; this.t0 = performance.now();
    this.agree = this.button(this.M.BtAgree, 28, 211, () => this.finish(true));
    this.disagree = this.button(this.M.BtDisagree, 147, 226, () => this.finish(false));
  }
  frames() { return allCanvases(this.M); }
  get shown() { const n = this.M.backgrnd ? Object.keys(this.M.backgrnd).filter((k) => /^\d+$/.test(k)).length : 1; return 500 + (n - 1) * 120; }
  finish(ok, timedOut = false) {
    if (this.answered) return;
    this.answered = true; this.mgr.close(this);
    if (timedOut) this.g.hud?.message('Since the time has exceeded, denial message has been sent to the party leader.', CHAT_COLOR.error);
    this.done(ok);
  }
  key(e) { if (e.key === 'Escape' && this.agree.visible) this.finish(false); }
  body(ctx) {
    const t = performance.now() - this.t0, end = this.shown, F = this.M.backgrnd;
    if (t > 30000) { this.finish(false, true); return; }
    const frame = t < 500 ? 0 : Math.min(Math.floor((t - 500) / 120) + 1, Object.keys(F || {}).filter((k) => /^\d+$/.test(k)).length - 1);
    const bg = this.mgr.image(F?.[frame]);
    if (bg) ctx.drawImage(bg, 0, 0);
    const fade = Math.max(0, Math.min(1, (t - end - 1000) / 300)), msg = this.mgr.image(this.M.message);
    this.agree.visible = this.disagree.visible = t >= end + 3000;
    if (!fade || !msg) return;
    ctx.save(); ctx.globalAlpha = fade;
    ctx.drawImage(msg, 31, 51);
    const name = (s, y) => this.text(ctx, s, 31 + 105, 51 + y, { size: 12, color: '#FFFF00', align: 'right' });
    name(this.master, 41); name(this.guildName, 79); name(this.master, 110); name(this.guildName, 148);
    ctx.restore();
  }
}

// ==================================================================== guild emblem maker
/**
 * Guild/MakeMark, 250x343 at (275, 100): backgrnd plays once (500ms, then 120ms a frame) and stays on its last frame;
 * a second later the title, the four boxes and their labels appear with the controls: frame / frame colour /
 * emblem / emblem colour arrows (wrapping), the emblem category box (ComboBox3, dropping down 16px a choice) and
 * OK / CANCEL. The 17x17 preview sits at (117, 103) from the start. Resolves with the emblem, or null.
 */
const MARK_CATS = [['Animal', 'Animal'], ['Plant', 'Plant'], ['Pattern', 'Pattern'], ['Character', 'Letter'], ['ETC', 'Etc']];
const COMBO = { x: 36, y: 252, w: 88, h: 18, item: 16 };
const idsOf = (node) => Object.keys(node || {}).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
export class GuildMarkWin extends Win {
  constructor(mgr, emblem, done) {
    super(mgr, null, 275, 100);
    this.buttons = []; this.closeBtn = null;
    const M = this.M = mgr.W.UserList.Guild.MakeMark, G = mgr.game.guildMarks || {};
    this.w = 250; this.h = 343; this.modal = true; this.fixed = true; this.done = done; this.t0 = performance.now(); this.comboOpen = false;
    this.bgIds = idsOf(G.BackGround); this.markIds = MARK_CATS.map(([, f]) => idsOf(G.Mark?.[f]));
    const has = emblem && (emblem.bg || emblem.logo);
    const cat = has ? Math.max(0, this.markIds.findIndex((l) => l.includes(emblem.logo))) : 0;
    this.pick = has ? { bg: emblem.bg, bgColor: emblem.bgColor, cat, logo: emblem.logo, logoColor: emblem.logoColor } : { bg: 1000, bgColor: 1, cat: 0, logo: 2000, logoColor: 1 };
    const step = (list, v, d) => { const i = list.indexOf(v); return list[((i < 0 ? 0 : i) + d + list.length) % list.length] ?? v; };
    const colour = (v, d) => ((v - 1 + d + 16) % 16) + 1;
    const p = this.pick;
    this.controls = [
      this.button(M.BtLeft, 37, 172, () => { p.bg = step(this.bgIds, p.bg, -1); }), this.button(M.BtRight, 80, 172, () => { p.bg = step(this.bgIds, p.bg, 1); }),
      this.button(M.BtLeft, 130, 172, () => { p.bgColor = colour(p.bgColor, -1); }), this.button(M.BtRight, 173, 172, () => { p.bgColor = colour(p.bgColor, 1); }),
      this.button(M.BtLeft, 37, 228, () => { p.logo = step(this.markIds[p.cat], p.logo, -1); }), this.button(M.BtRight, 80, 228, () => { p.logo = step(this.markIds[p.cat], p.logo, 1); }),
      this.button(M.BtLeft, 130, 228, () => { p.logoColor = colour(p.logoColor, -1); }), this.button(M.BtRight, 173, 228, () => { p.logoColor = colour(p.logoColor, 1); }),
      this.ok = this.button(M.BtAgree, 79, 288, () => this.confirm()), this.cancel = this.button(M.BtDisagree, 133, 288, () => this.finish(null)),
    ];
  }
  frames() { return [...allCanvases(this.M), ...allCanvases(this.mgr.B.ComboBox3)]; }
  get ready() { return performance.now() - this.t0 >= 500 + 14 * 120 + 1000; }
  finish(e) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(e); }
  async confirm() {
    if (this.asking) return;
    this.asking = true;
    const yes = await this.mgr.confirm('Would you like to save it as a guild emblem?');
    this.asking = false;
    if (yes) { const p = this.pick; this.finish({ bg: p.bg, bgColor: p.bgColor, logo: p.logo, logoColor: p.logoColor }); }
  }
  key(e) { if (e.key === 'Enter') this.confirm(); else if (e.key === 'Escape') this.finish(null); }
  body(ctx) {
    const M = this.M, im = (n) => this.mgr.image(n), t = performance.now() - this.t0;
    const n = idsOf(M.backgrnd).length || 1, frame = t < 500 ? 0 : Math.min(n - 1, Math.floor((t - 500) / 120) + 1);
    const bg = im(M.backgrnd?.[frame]);
    if (bg) ctx.drawImage(bg, 0, 0);
    drawEmblem(ctx, this.g, this.pick, 117, 103);
    const ready = this.ready;
    for (const b of this.controls) b.visible = ready && !(this.comboOpen && (b === this.ok || b === this.cancel));
    if (!ready) return;
    const put = (node, x, y) => { const a = im(node); if (a) ctx.drawImage(a, x, y); };
    put(M.message0, 74, 44);
    for (const [x, y] of [[34, 151], [127, 151], [34, 207], [127, 207]]) put(M.inner, x, y);
    put(M.message1, 56, 153); put(M.message2, 148, 153); put(M.message3, 56, 209); put(M.message4, 148, 209);
    this.drawCombo(ctx);
  }
  drawCombo(ctx) {
    const C3 = this.mgr.B.ComboBox3?.[this.comboOpen ? 'pressed' : 'normal'], im = (n) => this.mgr.image(n), c = COMBO;
    const l = im(C3?.[0]), m = im(C3?.[1]), a = im(C3?.[2]);
    if (l) ctx.drawImage(l, c.x, c.y);
    if (m) ctx.drawImage(m, c.x + 5, c.y, c.w - 5 - 17, m.height);
    if (a) ctx.drawImage(a, c.x + c.w - 17, c.y);
    this.text(ctx, `      ${MARK_CATS[this.pick.cat][0]}`, c.x + 2, c.y + 3, { size: 12 });
    if (!this.comboOpen) return;
    const top = c.y + c.h, h = MARK_CATS.length * c.item + 1, mx = this.mgr.mouse.x - this.x, my = this.mgr.mouse.y - this.y;
    ctx.fillStyle = '#9AA3AB'; ctx.fillRect(c.x, top, c.w, h);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(c.x + 1, top, c.w - 2, h - 1);
    MARK_CATS.forEach(([label], i) => {
      const y = top + i * c.item, lit = mx >= c.x && mx < c.x + c.w && my >= y && my < y + c.item;
      if (lit) { ctx.fillStyle = SEL; ctx.fillRect(c.x + 1, y, c.w - 2, c.item); }
      this.text(ctx, `      ${label}`, c.x + 2, y + 2, { size: 12, color: lit ? '#fff' : '#000' });
    });
  }
  down(lx, ly) {
    if (!this.ready) return;
    const c = COMBO;
    if (this.comboOpen) {
      const i = Math.floor((ly - c.y - c.h) / c.item);
      if (lx >= c.x && lx < c.x + c.w && i >= 0 && i < MARK_CATS.length) {
        this.pick.cat = i; this.pick.logo = this.markIds[i][0] ?? this.pick.logo;
        sfx.play('UI/BtMouseClick');
      }
      this.comboOpen = false;
      return;
    }
    if (lx >= c.x && lx < c.x + c.w && ly >= c.y && ly < c.y + c.h) { this.comboOpen = true; sfx.play('UI/BtMouseClick'); }
  }
}

/** Heracle's word on a guild result, in his own dialog. */
export function heracleSays(mgr, text) { return localTalk(mgr, HERACLE, text, ['OK']); }
