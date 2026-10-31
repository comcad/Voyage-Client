/**
 * Client-side quest logic from Quest.wz, the same way the v83 client decides what to offer:
 *   QuestInfo.img  name / texts (0 available, 1 in progress, 2 completed)
 *   Check.img      0 = start requirements, 1 = completion requirements
 *   Act.img        0/1 = rewards (the server applies them)
 *   Say.img        dialogue the client shows before sending QUEST_ACTION
 * Quest state itself comes from the server (SET_FIELD and SHOW_STATUS_INFO mode 1).
 */

const list = (node) => (node ? Object.keys(node).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => node[k]) : []);

export class QuestBook {
  constructor(assets) {
    this.assets = assets;
    this.started = {};   // id -> progress string
    this.completed = {}; // id -> filetime
  }

  async load() {
    [this.info, this.check, this.act, this.say] = await Promise.all(
      ['QuestInfo', 'Check', 'Act', 'Say'].map((f) => this.assets.json(`Quest/${f}.img`)));
    this.info ||= {}; this.check ||= {}; this.act ||= {}; this.say ||= {};
    // npc id -> quest ids that start / end there
    this.byNpc = new Map();
    for (const [id, c] of Object.entries(this.check)) {
      for (const [phase, key] of [['0', 'start'], ['1', 'end']]) {
        const npc = c[phase]?.npc;
        if (!npc) continue;
        if (!this.byNpc.has(npc)) this.byNpc.set(npc, { start: [], end: [] });
        this.byNpc.get(npc)[key].push(Number(id));
      }
    }
  }

  setState({ started, completed }) {
    this.started = { ...started };
    this.completed = { ...completed };
  }

  /** Apply a SHOW_STATUS_INFO mode 1 update. status: 0 removed/forfeit, 1 started, 2 completed. */
  update(id, status, progress) {
    if (status === 0) delete this.started[id];
    else if (status === 1) this.started[id] = progress ?? '';
    else if (status === 2) { delete this.started[id]; this.completed[id] = progress ?? true; }
  }

  name(id) { return this.info[id]?.name || `Quest ${id}`; }
  status(id) { return this.completed[id] !== undefined ? 2 : this.started[id] !== undefined ? 1 : 0; }
  isScripted(id, phase) { return !!this.check[id]?.[phase]?.[phase === '0' ? 'startscript' : 'endscript']; }
  /** Quests the client hides from NPC menus (started automatically or by events). */
  isAuto(id) { const i = this.info[id]; return !!(i?.autoStart || i?.autoAccept || this.check[id]?.['0']?.normalAutoStart); }

  /** Mob kill progress for a started quest: [{id, need, have}]. */
  mobProgress(id) {
    const mobs = list(this.check[id]?.['1']?.mob);
    const prog = this.started[id] || '';
    return mobs.map((m, i) => ({ id: m.id, need: m.count, have: Number(prog.slice(i * 3, i * 3 + 3)) || 0 }));
  }

  /** ctx: { stats, itemCount(id), meso } */
  canStart(id, ctx, npcId) {
    const c = this.check[id]?.['0'];
    if (!c || !this.info[id]) return false;
    if (npcId !== undefined && c.npc !== npcId) return false;
    const st = this.status(id);
    if (st === 1) return false;
    if (st === 2 && !c.interval) return false;
    const s = ctx.stats;
    if (c.lvmin && s.level < c.lvmin) return false;
    if (c.lvmax && s.level > c.lvmax) return false;
    const jobs = list(c.job);
    if (jobs.length && !jobs.includes(s.job)) return false;
    for (const q of list(c.quest)) {
      const have = this.status(q.id);
      if (q.state === 2 ? have !== 2 : q.state === 1 ? have !== 1 : have !== 0) return false;
    }
    for (const it of list(c.item)) {
      const n = ctx.itemCount(it.id), need = it.count ?? 0;
      if (need > 0 ? n < need : n > 0) return false; // count 0 or none = must not have it (as the server reads it)
    }
    if (c.end && /^\d{10}$/.test(String(c.end))) {
      const e = String(c.end); const end = new Date(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8), +e.slice(8, 10));
      if (Date.now() > end.getTime()) return false;
    }
    return true;
  }

  canComplete(id, ctx, npcId) {
    if (this.status(id) !== 1) return false;
    const c = this.check[id]?.['1'] || {};
    if (npcId !== undefined && c.npc && c.npc !== npcId) return false;
    if (c.endmeso && ctx.meso < c.endmeso) return false;
    for (const it of list(c.item)) if (ctx.itemCount(it.id) < (it.count ?? 1)) return false;
    for (const m of this.mobProgress(id)) if (m.have < m.need) return false;
    for (const q of list(c.quest)) if (this.status(q.id) !== (q.state ?? 2)) return false;
    // infoex: the record kept under infoNumber (the quest itself without one) must read the value, e.g. "20" maps explored
    const ix = list(c.infoex);
    if (ix.length && !ix.some((e) => (this.started[c.infoNumber || id] ?? '') === String(e.value))) return false;
    return true;
  }

  /** What an NPC can do quest-wise right now. */
  npcQuests(npcId, ctx) {
    const e = this.byNpc.get(npcId) || { start: [], end: [] };
    return {
      start: e.start.filter((id) => !this.isAuto(id) && this.canStart(id, ctx, npcId)),
      complete: e.end.filter((id) => this.canComplete(id, ctx, npcId)),
      progress: e.end.filter((id) => this.status(id) === 1 && !this.canComplete(id, ctx, npcId)),
    };
  }

  /** Every quest you could start now (for the quest window's Available tab). */
  available(ctx) {
    return Object.keys(this.check).map(Number)
      .filter((id) => this.check[id]?.['0']?.npc && !this.isAuto(id) && this.canStart(id, ctx)).slice(0, 200);
  }

  /** Say.img lines for a phase: { lines:[], yes:[], no:[], stop } */
  dialogue(id, phase) {
    const s = this.say[id]?.[phase] || {};
    return { lines: list(s), yes: list(s.yes), no: list(s.no), stop: s.stop };
  }

  requirements(id) {
    const c = this.check[id]?.['1'] || {};
    return { items: list(c.item), mobs: this.mobProgress(id), npc: c.npc, meso: c.endmeso };
  }

  rewards(id) {
    const a = this.act[id]?.['1'] || {};
    return { exp: a.exp, meso: a.money, fame: a.pop, items: list(a.item).filter((i) => i.count > 0) };
  }
}
