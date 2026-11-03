import { Anim } from './map.js';
import { sfx } from './audio.js';
import { npcTalk } from './ui/dialogs.js';
import { questFlow } from './ui/quests-ui.js';

/**
 * The QuestAlert lightbulb over your character (Effect/BasicEff.img/QuestAlert). It offers auto-start quests:
 * - candidates come from what you wear (equipAllNeed / equipSelectNeed), what you carry (start items), the map
 *   (fieldEnter) and every normalAutoStart quest; only QuestInfo autoStart ones count, checked at their start NPC;
 * - an autoAccept one is started by itself (once, retried every 10s), the rest wait under the bulb;
 * - an in-progress autoPreComplete quest, and an autoComplete one ready to hand in (checked every 10s), too.
 * A new one from a map or an inventory change, or a newly ready autoComplete one, says "Quest Arrived!" with its
 * sound and the bulb's Appear; otherwise the bulb just floats (Default). Double-click it: the Maple Administrator's
 * list of them (list3 ready, list1 available, list0 in progress).
 */
const ADMIN = 9010000, RETRY = 10000, ARRIVED = 'Quest Arrived!  Double-click the icon located on top of the Character.';
const HEAD = 46;   // the bulb hangs this far above the feet

export class QuestAlert {
  constructor(game) {
    this.g = game;
    this.avail = new Set(); this.pre = new Set(); this.ready = new Set(); this.sent = new Set();
    this.sentAt = 0; this.checkedAt = 0; this.news = false; this.anim = null; this.appear = false;
  }
  get book() { return this.g.quests; }
  get ctx() { return this.g.textCtx(); }

  /** Everything again: on entering a map (and when an auto-accepted quest is still pending after 10s). */
  refresh() {
    const book = this.book, g = this.g;
    if (!book || !g.player) return;
    this.avail.clear();
    for (const it of Object.values(g.inventory?.equipped || {})) this.consider(book.byEquip.get(it.id), false);
    for (let t = 1; t <= 5; t++) for (const it of Object.values(g.inventory?.[t] || {})) this.consider(book.byStartItem.get(it.id), false);
    this.consider(book.byField.get(g.map?.id), true);
    this.consider(book.normalAutoStart, false);
    this.pre.clear();
    for (const id of Object.keys(book.started).map(Number)) if (book.isAutoPreComplete(id)) this.pre.add(id);
    this.show();
  }
  /** An item came or went (worn or carried): its quests; a new one there says it has arrived. */
  itemChanged(id, worn) {
    const book = this.book;
    if (!book) return;
    this.consider(worn ? book.byEquip.get(id) : book.byStartItem.get(id), true);
    this.show();
  }
  /** Stats changed (a level up): the normalAutoStart quests. */
  statsChanged() { if (this.book) { this.consider(this.book.normalAutoStart, true); this.show(); } }
  /** A quest record came in. */
  recordChanged(id, status) {
    this.avail.delete(id);
    if (status === 1 && this.book.isAutoPreComplete(id)) this.pre.add(id); else this.pre.delete(id);
    if (status !== 1) this.ready.delete(id);
    this.statsChanged();
  }

  consider(ids, fromNew) {
    if (!ids) return;
    const book = this.book, ctx = this.ctx;
    for (const id of ids) {
      if (!book.isAutoStart(id)) continue;
      const npc = Number(book.check[id]?.['0']?.npc) || 0;
      if (!book.canStart(id, ctx)) { this.avail.delete(id); this.sent.delete(id); continue; }
      if (book.isAutoAccept(id)) {
        if (!this.sent.has(id)) { this.g.net?.questAction(1, id, npc, null); this.sent.add(id); this.sentAt = performance.now(); }
        continue;
      }
      if (fromNew && !this.avail.has(id)) this.news = true;
      this.avail.add(id);
    }
  }
  /** Every 10s: autoComplete quests ready at their end NPC; and a retry of auto-accepted ones still pending. */
  tick() {
    const book = this.book, now = performance.now();
    if (!book || !this.g.player) return;
    if (now - this.checkedAt > RETRY) {
      this.checkedAt = now;
      const ctx = this.ctx;
      for (const id of book.autoComplete) {
        const npc = Number(book.check[id]?.['1']?.npc) || undefined;
        if (book.canComplete(id, ctx, npc)) { if (!this.ready.has(id)) { this.ready.add(id); this.news = true; } }
        else this.ready.delete(id);
      }
    }
    if (this.sent.size && now - this.sentAt > RETRY) { this.sent.clear(); this.refresh(); }
    this.show();
  }

  get active() { return this.avail.size > 0 || this.pre.size > 0 || this.ready.size > 0; }
  /** The bulb: Appear (with the message and sound) for something new, then Default floating; gone when empty. */
  show() {
    const E = this.g.vfx?.E?.QuestAlert;
    if (!this.active || !E) { this.anim = null; this.news = false; return; }
    if (this.news && !this.g.inCashShop) {
      this.g.hud?.message(ARRIVED, '#bbbbbb');
      sfx.play('Game/QuestAlert');
      if (!this.appear) { this.anim = new Anim(E.Appear, false); this.appear = true; }
      this.news = false;
    } else if (!this.anim || (this.appear && this.anim.done)) { this.anim = new Anim(E.Default, true); this.appear = false; }
  }
  update(ms) { this.anim?.update(ms); if (this.appear && this.anim?.done) this.show(); }
  /** Where the bulb is drawn now (world coordinates), for drawing and for the double-click. */
  rect() {
    const f = this.anim?.node, p = this.g.player, im = f && this.g.assets.image(f);
    if (!im || !p) return null;
    const o = f.origin || [0, 0];
    return { x: Math.round(p.x - o[0]), y: Math.round(p.y - HEAD - o[1]), w: im.width, h: im.height, im };
  }
  draw(ctx, cam) {
    const r = this.rect();
    if (!r) return;
    ctx.save(); ctx.globalAlpha = this.anim.alpha;
    ctx.drawImage(r.im, r.x - Math.round(cam.x), r.y - Math.round(cam.y));
    ctx.restore();
  }
  hits(wx, wy) { const r = this.rect(); return !!r && wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h; }

  /** The Maple Administrator's list; picking a quest runs it as if from its NPC. */
  async open() {
    const book = this.book, g = this.g, choices = [];
    let text = 'Someone in MapleStory would like to send you a message.';
    const section = (n, ids, suffix) => {
      const list = [...ids].filter((id) => book.info[id]);
      if (!list.length) return;
      text += `\r\n\r\n#fUI/UIWindow.img/UtilDlgEx/list${n}#\r\n`;
      for (const id of list) {
        const type = book.info[id].type ? `#r#e${book.info[id].type}#d#n` : '';
        text += `#d#L${choices.length}# ${type}${book.name(id)}${suffix}#l#k\r\n`;
        choices.push(id);
      }
    };
    section(3, this.ready, ' (Pre-completion enabled)');
    section(1, this.avail, '');
    section(0, this.pre, ' (In Progress)');
    const r = await npcTalk(g.windows, { npc: ADMIN, type: 4, text });
    if (r.action !== 1 || r.sel === null || r.sel === undefined || !choices[r.sel]) return;
    const id = choices[r.sel], npcId = Number(book.check[id]?.['0']?.npc) || ADMIN;
    await questFlow(g, g.map?.life.find((e) => e.kind === 'Npc' && Number(e.spawn.id) === npcId) || { spawn: { id: npcId } }, id);
    this.tick();
  }
}
