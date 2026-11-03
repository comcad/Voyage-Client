/**
 * Client-side quest logic from Quest.wz, the same way the v83 client decides what to offer:
 *   QuestInfo.img  name / texts (0 available, 1 in progress, 2 completed)
 *   Check.img      0 = start requirements, 1 = completion requirements
 *   Act.img        0/1 = rewards (the server applies them)
 *   Say.img        dialogue the client shows before sending QUEST_ACTION
 * Quest state itself comes from the server (SET_FIELD and SHOW_STATUS_INFO mode 1).
 */

const list = (node) => (node ? Object.keys(node).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => node[k]) : []);
const FT_EPOCH = 11644473600000n;
/** A completion FILETIME as epoch ms (null when unknown). */
const ftMs = (ft) => { try { return ft === undefined || ft === true ? null : Number(BigInt(ft) / 10000n - FT_EPOCH); } catch { return null; } };
const wzDate = (s) => (/^\d{10}$/.test(String(s)) ? new Date(+String(s).slice(0, 4), +String(s).slice(4, 6) - 1, +String(s).slice(6, 8), +String(s).slice(8, 10)).getTime() : null);
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Party-quest entries: never offered by NPCs, never completed from here. */
export const isPartyQuest = (id) => id >= 1200 && id <= 1399;
export const TITLE_AREA = 51;

export class QuestBook {
  constructor(assets) {
    this.assets = assets;
    this.started = {};   // id -> progress string
    this.completed = {}; // id -> filetime
    this.ex = {};        // id -> record-ex value (SHOW_STATUS_INFO mode 0x0A)
  }

  async load() {
    [this.info, this.check, this.act, this.say] = await Promise.all(
      ['QuestInfo', 'Check', 'Act', 'Say'].map((f) => this.assets.json(`Quest/${f}.img`)));
    this.info ||= {}; this.check ||= {}; this.act ||= {}; this.say ||= {};
    // npc id -> quest ids that start or end there; item id -> quests needing it to complete
    this.byNpc = new Map(); this.byItem = new Map();
    for (const [id, c] of Object.entries(this.check)) {
      for (const phase of ['0', '1']) {
        const npc = Number(c[phase]?.npc);
        if (!npc) continue;
        if (!this.byNpc.has(npc)) this.byNpc.set(npc, new Set());
        this.byNpc.get(npc).add(Number(id));
      }
      for (const it of list(c['1']?.item)) {
        if (!this.byItem.has(it.id)) this.byItem.set(it.id, []);
        this.byItem.get(it.id).push(Number(id));
      }
    }
  }

  setState({ started, completed }) {
    this.started = { ...started };
    this.completed = { ...completed };
  }

  /** Apply a SHOW_STATUS_INFO mode 1 update. status: 0 removed/forfeit, 1 started, 2 completed. */
  update(id, status, progress) {
    if (status === 0) { delete this.started[id]; delete this.completed[id]; }
    else if (status === 1) { this.started[id] = progress ?? ''; if (this.info[id]) this.recent = id; }
    else if (status === 2) { delete this.started[id]; this.completed[id] = progress ?? true; }
  }

  name(id) { return this.info[id]?.name || `Quest ${id}`; }
  area(id) { return Number(this.info[id]?.area) || 0; }
  status(id) { return this.started[id] !== undefined ? 1 : this.completed[id] !== undefined ? 2 : 0; }
  isScripted(id, phase) { return !!this.check[id]?.[phase]?.[phase === '0' ? 'startscript' : 'endscript']; }
  isAutoStart(id) { return !!Number(this.info[id]?.autoStart); }
  isAutoAccept(id) { return !!Number(this.info[id]?.autoAccept); }
  isAutoComplete(id) { return !!Number(this.info[id]?.autoComplete); }
  /** Quests started automatically (no position is sent with their QUEST_ACTION). */
  isAuto(id) { return this.isAutoStart(id) || this.isAutoComplete(id); }

  /** Mob kill progress for a started quest: [{id, need, have}] (3 digits per mob, in Check.img order). */
  mobProgress(id, record = this.started[id]) {
    const mobs = list(this.check[id]?.['1']?.mob);
    const prog = record || '';
    return mobs.map((m, i) => ({ id: m.id, need: m.count ?? 0, have: Number(prog.slice(i * 3, i * 3 + 3)) || 0 }));
  }

  /** How many of an item count toward a check: those carried, plus the worn copy. */
  held(ctx, id) { return ctx.itemCount(id) + (ctx.equipped?.(id) ? 1 : 0); }
  /** count > 0: at least that many; 0 or missing: none at all; -N: at most N. */
  itemOk(have, count = 0) { return count > 0 ? have >= count : count < 0 ? have + count <= 0 : have === 0; }

  /** quest {id, state}: 0 neither started nor completed, 1 in progress, 2 completed. */
  questsOk(c) { return list(c.quest).every((q) => this.status(q.id) === (q.state ?? 0)); }

  /** info / infoex: the record under infoNumber (or the quest's own) must exist, and any one entry match. */
  infoOk(id, c) {
    const ex = list(c.infoex), plain = ex.length ? [] : list(c.info);
    if (!ex.length && !plain.length) return true;
    const rec = this.started[Number(c.infoNumber) || id];
    if (rec === undefined) return false;
    if (plain.length) return plain.some((v) => rec === String(v));
    return ex.some((e) => {
      const cond = Number(e.cond) || 0, v = String(e.value ?? '');
      if (cond === 0) return rec === v;
      if (cond === 1) return (parseInt(rec, 10) || 0) >= (parseInt(v, 10) || 0);
      if (cond === 2) return (parseInt(rec, 10) || 0) <= (parseInt(v, 10) || 0);
      return false;
    });
  }
  hasInfoReq(c) { return list(c.infoex).length > 0 || list(c.info).length > 0; }

  /** A completed quest that may be taken again now. */
  repeatable(id, c, now = Date.now()) {
    const done = ftMs(this.completed[id]);
    const interval = c.interval === undefined ? -1 : Number(c.interval);
    if (interval < 0) {
      if (!Number(c.dayByDay)) return false;
      if (done !== null) {
        const a = new Date(done), b = new Date(now);
        if (b.getFullYear() * 10000 + b.getMonth() * 100 + b.getDate() <= a.getFullYear() * 10000 + a.getMonth() * 100 + a.getDate()) return false;
      }
    }
    return done === null || done + Math.max(0, interval) * 60000 <= now;
  }

  /**
   * ctx: { stats, meso, itemCount(id), equipped(id), mapId, skillLevel(id), pet: {id, closeness} | null, bookCards }
   * npcId undefined skips the NPC test (the quest log's Available tab).
   */
  canStart(id, ctx, npcId) {
    const c = this.check[id]?.['0'];
    if (!c || !this.info[id]) return false;
    const st = this.status(id);
    if (st === 1) return false;
    if (npcId !== undefined && c.npc && Number(c.npc) !== npcId) return false;
    if (st === 2 && !this.repeatable(id, c)) return false;
    const s = ctx.stats || {};
    if (c.lvmax && s.level > c.lvmax) return false;
    if (c.lvmin && s.level < c.lvmin - (isPartyQuest(id) ? 5 : 0)) return false;
    if (c.pop && (s.fame ?? 0) < c.pop) return false;
    const now = Date.now(), start = wzDate(c.start), end = wzDate(c.end);
    if ((start !== null && start > now) || (end !== null && end < now)) return false;
    const jobs = list(c.job);
    if (jobs.length && Math.floor((s.job % 1000) / 100) !== 9 && !jobs.includes(s.job)) return false;
    for (const it of list(c.item)) if (!this.itemOk(this.held(ctx, it.id), it.count)) return false;
    if (ctx.equipped) {
      const all = list(c.equipAllNeed), one = list(c.equipSelectNeed);
      if (all.length && !all.every((e) => ctx.equipped(e))) return false;
      if (one.length && !one.some((e) => ctx.equipped(e))) return false;
    }
    const fields = list(c.fieldEnter).map(Number);
    if (fields.length && !fields.includes(ctx.mapId)) return false;
    const pets = list(c.pet).map((p) => p.id);
    if (pets.length) {
      const p = ctx.pet;
      if (!p || !pets.includes(p.id)) return false;
      if (p.closeness < (c.pettamenessmin ?? 0) || p.closeness > (c.pettamenessmax ?? 30000)) return false;
    }
    if (ctx.skillLevel) for (const sk of list(c.skill)) if ((ctx.skillLevel(sk.id) > 0) !== !!Number(sk.acquire)) return false;
    if (!this.questsOk(c)) return false;
    if (this.hasInfoReq(c) && !this.infoOk(id, c)) return false;
    if (c.dayOfWeek && DAYS.some((d) => c.dayOfWeek[d] !== undefined) && !Number(c.dayOfWeek[DAYS[new Date().getDay()]])) return false;
    return true;
  }

  /**
   * Why a started quest can't be completed at this NPC, first failure first (null: it can):
   * 'state', 'npc', 'item', 'quest', 'mob', 'pet', 'meso', 'info', 'other'. The stop lines are keyed by these.
   */
  completeBlock(id, ctx, npcId) {
    if (this.status(id) !== 1 || isPartyQuest(id)) return 'state';
    const c = this.check[id]?.['1'];
    if (!c) return 'state';
    if (npcId !== undefined && c.npc && Number(c.npc) !== npcId) return 'npc';
    for (const it of list(c.item)) if (!this.itemOk(this.held(ctx, it.id), it.count)) return 'item';
    if (!this.questsOk(c)) return 'quest';
    const mobs = list(c.mob);
    if (mobs.length) {
      const rec = this.started[id] || '';
      if (rec.length % 3 || rec.length / 3 < mobs.length || this.mobProgress(id).some((m) => m.have < m.need)) return 'mob';
    }
    const pets = list(c.pet).map((p) => p.id);
    if (pets.length) {
      const p = ctx.pet;
      if (!p) return 'nopet';
      if (!pets.includes(p.id) || p.closeness < (c.pettamenessmin ?? 0) || p.closeness > (c.pettamenessmax ?? 30000)) return 'pet';
    }
    if (c.endmeso && (ctx.meso ?? 0) < c.endmeso) return 'meso';
    if (c.mbmin && (ctx.bookCards ?? 0) < c.mbmin) return 'item';
    if (c.questComplete && this.completedCount() < c.questComplete) return 'other';
    if (c.pop && (ctx.stats?.fame ?? 0) < c.pop) return 'other';
    if (c.level && (ctx.stats?.level ?? 0) < c.level) return 'other';
    if (this.hasInfoReq(c) && !this.infoOk(id, c)) return 'info';
    return null;
  }
  canComplete(id, ctx, npcId) { return this.completeBlock(id, ctx, npcId) === null; }
  /** Completed quests, as completion requirements count them (no 9000-10999, no titles). */
  completedCount() {
    return Object.keys(this.completed).filter((k) => { const n = Number(k); return (n < 9000 || n > 10999) && this.area(n) !== TITLE_AREA; }).length;
  }

  /** What an NPC can do quest-wise right now (its quests started or ended there). */
  npcQuests(npcId, ctx) {
    const out = { start: [], complete: [], progress: [], all: 0, done: 0 };
    for (const id of this.byNpc.get(npcId) || []) {
      if (isPartyQuest(id)) continue;
      out.all++;
      const st = this.status(id);
      if (st === 1) (this.canComplete(id, ctx, npcId) ? out.complete : out.progress).push(id);
      else if (this.canStart(id, ctx, npcId)) out.start.push(id);
      else if (st === 2) out.done++;
    }
    return out;
  }

  /** Every quest you could start now (the quest log's Available tab). */
  available(ctx) {
    return Object.keys(this.check).map(Number)
      .filter((id) => this.check[id]?.['0']?.npc && this.area(id) !== TITLE_AREA && this.canStart(id, ctx));
  }

  /** Say.img lines for a phase: { lines:[], yes:[], no:[], lost:[], stop, ask } */
  dialogue(id, phase) {
    const s = this.say[id]?.[phase] || {};
    return { lines: list(s).filter((l) => typeof l === 'string' && l), yes: list(s.yes), no: list(s.no), lost: list(s.lost), stop: s.stop, ask: !!Number(s.ask) };
  }

  requirements(id) {
    const c = this.check[id]?.['1'] || {};
    return { items: list(c.item), mobs: this.mobProgress(id), quests: list(c.quest), npc: c.npc, meso: c.endmeso };
  }
  /** Something the Quest Helper can show: items, monsters, mesos or required quests. */
  trackable(id) { const r = this.requirements(id); return !!(r.items.length || r.mobs.length || r.quests.length || r.meso); }

  /** Completion rewards for this character: Act.img/<id>/1, items filtered by job and gender. */
  rewards(id, stats = {}) {
    const a = this.act[id]?.['1'] || {};
    const branch = Math.floor((stats.job ?? 0) / 100), fits = (it) => {
      const mask = it.job === undefined ? -1 : Number(it.job);
      const g = it.gender === undefined ? 2 : Number(it.gender);
      return (((1 << (branch & 31)) & mask) !== 0 || branch === 9) && (g === 2 || g === stats.gender) && (it.count ?? 0) > 0;
    };
    const items = list(a.item).filter(fits);
    const skills = list(a.skill).filter((sk) => !list(sk.job).length || list(sk.job).includes(stats.job));
    return {
      exp: a.exp, meso: a.money, fame: a.pop, closeness: a.pettameness, next: a.nextQuest,
      fixed: items.filter((i) => !Number(i.prop)), choose: items.filter((i) => Number(i.prop) < 0), random: items.filter((i) => Number(i.prop) > 0), skills,
    };
  }
}
