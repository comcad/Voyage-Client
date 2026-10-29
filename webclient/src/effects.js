import { isCanvas, frames } from './assets.js';
import { Anim } from './map.js';
import { itemIcon } from './data.js';
import { uiText, wrapText } from './ui/wzui.js';

/**
 * World-space effects from the original art:
 *   damage numbers   Effect/BasicEff NoRed / NoCri / NoViolet / NoBlue (1 = big first digit, 0 = the rest)
 *   character fx     BasicEff LevelUp / JobChanged / QuestClear, anchored at the feet
 *   chat balloons    UI/ChatBalloon.img/0 (9-slice + arrow)
 *   quest icons      UI/UIWindow.img/QuestIcon (0 bulb: quest to start, 2 book: quest to hand in)
 *   boss HP          UI/UIWindow.img/MobGage (icon frame, [ track ], Gage/<colour> fill)
 *   buffs            skill / item icons at the top right, shaded clockwise as they run out
 *   tombstone        Effect/Tomb.img fall (frames 0-11 drop, 12-19 land)
 */
const SETS = { red: ['NoRed1', 'NoRed0'], crit: ['NoCri1', 'NoCri0'], violet: ['NoViolet1', 'NoViolet0'], blue: ['NoBlue1', 'NoBlue0'] };
// digits overlap like the client's: advance per small digit, the big first digit a little wider
const ADVANCE = [24, 20, 22, 22, 24, 23, 24, 22, 24, 24];
const NUM_LIFE = 1.2;
const FOREIGN = { 0: 'LevelUp', 8: 'JobChanged', 9: 'QuestClear' };

export class WorldFx {
  constructor(game) {
    this.game = game; this.assets = game.assets;
    this.nums = []; this.anims = []; this.tombs = []; this.boss = null; this.questIcons = new Map(); this.questT = 0;
  }

  async load() {
    const a = this.assets;
    [this.E, this.T, this.CB, this.W] = await Promise.all([
      a.json('Effect/BasicEff.img'), a.json('Effect/Tomb.img'), a.json('UI/ChatBalloon.img'), a.json('UI/UIWindow.img')]);
    const sets = Object.values(SETS).flat().flatMap((k) => canvases(this.E[k]));
    this.bulb = new Anim(this.W.QuestIcon[0]); this.book = new Anim(this.W.QuestIcon[2]);
    await a.preload([...sets, this.E.NoCri1?.effect, ...canvases(this.CB[0]), ...this.bulb.frames, ...this.book.frames,
      ...deep(this.W.MobGage, 3), ...canvases(this.T.fall)].filter(isCanvas));
  }

  // ---------------------------------------------------------------- triggers
  /** values: one number per hit line (0 = MISS). kind: red (yours), blue (others'), violet (taken), crit. */
  damage(target, values, kind = 'red') {
    const top = target.box ? target.box().top : target.y - 60;
    values.forEach((v, i) => this.nums.push({ v, kind, x: target.x, y: top - 4 - i * 30, t: -i * 0.08 }));
  }
  foreign(effect) { return FOREIGN[effect]; }
  /** BasicEff animation that follows an entity (player or remote player). */
  play(name, ent) {
    const node = this.E?.[name];
    if (!node) return;
    const anim = new Anim(node, false);
    this.assets.preload(anim.frames);
    this.anims.push({ anim, ent });
  }
  tomb(ent) { this.tombs.push({ anim: new Anim(this.T.fall, false), x: ent.x, y: ent.y }); }
  clearTombs() { this.tombs.length = 0; }
  bossHp(d) { this.boss = d.hp > 0 ? d : null; }
  mapChanged() { this.nums.length = 0; this.anims.length = 0; this.tombs.length = 0; this.boss = null; this.questIcons.clear(); }

  // ---------------------------------------------------------------- frame
  update(dt) {
    for (const n of this.nums) n.t += dt;
    this.nums = this.nums.filter((n) => n.t < NUM_LIFE);
    for (const a of this.anims) a.anim.update(dt * 1000);
    this.anims = this.anims.filter((a) => !a.anim.done);
    for (const t of this.tombs) t.anim.update(dt * 1000);
    this.bulb?.update(dt * 1000); this.book?.update(dt * 1000);
    // which NPCs have quests to start / hand in (refreshed every second)
    if ((this.questT -= dt) <= 0 && this.game.quests && this.game.map) {
      this.questT = 1;
      const ctx = this.game.textCtx();
      this.questIcons.clear();
      for (const e of this.game.map.life) {
        if (e.kind !== 'Npc') continue;
        const q = this.game.quests.npcQuests(Number(e.spawn.id), ctx);
        if (q.complete.length) this.questIcons.set(e, this.book); else if (q.start.length) this.questIcons.set(e, this.bulb);
      }
    }
  }

  drawWorld(ctx, cam) {
    const im = (n) => this.assets.image(n);
    // HP bars over monsters you have just hit
    const now = performance.now();
    for (const e of this.game.map.life) {
      if (e.kind !== 'Mob' || !(e.hpShownUntil > now) || !e.alive || e.src?.info?.boss || Number(e.spawn.id) === this.boss?.oid) continue;
      const b = e.box(), w = 50, x = Math.round(e.x - cam.x - w / 2), y = Math.round(b.top - cam.y - 10);
      const k = Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)));
      ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, 7);
      ctx.fillStyle = '#4a4a4a'; ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = '#e8323c'; ctx.fillRect(x, y, Math.round(w * k), 5);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, y, Math.round(w * k), 1);
    }
    // quest icons above NPC heads
    for (const [e, anim] of this.questIcons) {
      const n = anim.node, i = im(n);
      if (!i) continue;
      const o = n.origin || [i.width / 2, i.height / 2], b = e.box();
      ctx.drawImage(i, Math.round(e.x - cam.x - o[0]), Math.round(b.top - cam.y - 26 - o[1]));
    }
    // level up / job change / quest clear, following their character
    for (const a of this.anims) drawAt(ctx, im, a.anim.node, a.ent.x - cam.x, a.ent.y - cam.y, a.anim.alpha);
    // tombstones: drop from above during frames 0-11, then land
    for (const t of this.tombs) {
      const a = t.anim, fallMs = 12 * 80, at = Math.min(fallMs, a.i < 12 ? a.i * 80 + a.t : fallMs);
      drawAt(ctx, im, a.node, t.x - cam.x, t.y - cam.y - 320 * (1 - at / fallMs), 1);
    }
    for (const n of this.nums) this.drawNumber(ctx, n, cam);
  }

  drawNumber(ctx, n, cam) {
    if (n.t < 0) return;
    const [bigK, smallK] = SETS[n.kind] || SETS.red, big = this.E[bigK], small = this.E[smallK];
    const k = n.t / NUM_LIFE, rise = k * 36;
    ctx.save();
    ctx.globalAlpha = k < 0.55 ? 1 : Math.max(0, 1 - (k - 0.55) / 0.45);
    const x0 = n.x - cam.x, y = n.y - cam.y - rise;
    if (!n.v) {                     // a zero hit shows the set's MISS sprite (red / violet carry one)
      const miss = (n.kind === 'violet' ? this.E.NoViolet0 : this.E.NoRed0).Miss;
      drawAt(ctx, (m) => this.assets.image(m), miss, x0, y, ctx.globalAlpha);
      ctx.restore(); return;
    }
    const digits = String(n.v).split('').map(Number);
    const adv = digits.map((d, i) => ADVANCE[d] + (i === 0 ? 4 : 0));
    let x = x0 - adv.reduce((s, a) => s + a, 0) / 2;
    if (n.kind === 'crit' && this.E.NoCri1?.effect) drawAt(ctx, (m) => this.assets.image(m), this.E.NoCri1.effect, x + adv[0] / 2, y, ctx.globalAlpha);
    digits.forEach((d, i) => {
      const node = (i === 0 ? big : small)?.[d], img = node && this.assets.image(node);
      if (img) { const o = node.origin || [img.width / 2, img.height]; ctx.drawImage(img, Math.round(x + adv[i] / 2 - o[0]), Math.round(y - o[1] + (i === 0 ? 0 : 3))); }
      x += adv[i];
    });
    ctx.restore();
  }

  /** ChatBalloon.img/0: a 9-slice around the text with the arrow under it, pointing at the speaker. */
  drawBalloon(ctx, cam, ent, text) {
    const B = this.CB?.[0], im = (n) => this.assets.image(n);
    const p = Object.fromEntries(['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se', 'arrow'].map((k) => [k, im(B?.[k])]));
    if (Object.values(p).some((v) => !v)) return false;
    ctx.save();
    ctx.font = '12px Arial, sans-serif';
    const lines = wrapText(ctx, text, 150, 12);
    const W = Math.max(30, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)))), H = lines.length * 14;
    const cx = Math.round(ent.x - cam.x), x0 = cx - Math.round(W / 2), y0 = Math.round(ent.y - cam.y - 86 - H - 6);
    ctx.drawImage(p.c, x0, y0, W, H);
    ctx.drawImage(p.nw, x0 - 6, y0 - 6); ctx.drawImage(p.n, x0, y0 - 6, W, 6); ctx.drawImage(p.ne, x0 + W, y0 - 6);
    ctx.drawImage(p.w, x0 - 6, y0, 6, H); ctx.drawImage(p.e, x0 + W, y0, 6, H);
    ctx.drawImage(p.sw, x0 - 6, y0 + H); ctx.drawImage(p.s, x0, y0 + H, W, 6); ctx.drawImage(p.se, x0 + W, y0 + H);
    ctx.drawImage(p.arrow, cx - 6, y0 + H + 5);
    lines.forEach((l, i) => uiText(ctx, l, x0, y0 + i * 14, { color: '#000', size: 12 }));
    ctx.restore();
    return true;
  }

  // ---------------------------------------------------------------- screen-space
  drawHud(ctx) { this.drawBuffs(ctx); }

  /** MobGage: the boss's icon in its frame, then [ track ] filled with Gage/<tag colour>. */
  drawBoss(ctx) {
    const d = this.boss, G = this.W?.MobGage, im = (n) => this.assets.image(n);
    if (!d || !G) return;
    const frame = im(G.backgrnd), l = im(G.backgrnd2), tile = im(G.backgrnd3), r = im(G.backgrnd4);
    if (!frame || !l || !tile || !r) return;
    const mobId = this.game.lifeByOid.get(d.oid)?.spawn?.id ?? d.oid;
    ctx.drawImage(frame, 4, 4);
    const icon = im(G.Mob?.[String(mobId)]);
    if (icon) ctx.drawImage(icon, 4 + 5, 4 + 6);
    const x = 42, y = 12, w = 800 - x - 12;
    ctx.drawImage(l, x, y); ctx.drawImage(tile, x + l.width, y, w - l.width - r.width, tile.height); ctx.drawImage(r, x + w - r.width, y);
    const fill = im(G.Gage?.[String(Math.min(7, Math.max(1, d.tag || 1)))]?.[0]);
    const inner = w - l.width - r.width, k = Math.max(0, Math.min(1, d.hp / Math.max(1, d.maxHp)));
    if (fill) ctx.drawImage(fill, x + l.width, y + 5, Math.round(inner * k), fill.height);
  }

  /** Buff icons, newest on the left of the row, at the top right. */
  buffAt(x, y) {
    const list = this.buffList();
    const top = this.buffTop;
    for (let i = 0; i < list.length; i++) { const bx = 800 - 36 - i * 34; if (x >= bx && x < bx + 32 && y >= top && y < top + 32) return list[i]; }
    return null;
  }
  buffList() { const now = Date.now(); return this.game.buffs.filter((b) => b.until > now); }
  get buffTop() { return this.boss ? 46 : 4; }
  drawBuffs(ctx) {
    const g = this.game, now = Date.now();
    this.buffList().forEach((b, i) => {
      const node = b.source > 0 ? g.skills?.icon(b.source) : this.itemIcon(-b.source);
      if (b.source > 0 && !node) g.skills?.ensure(b.source);
      const img = node && this.assets.image(node);
      if (!img) { if (node) this.assets.preload([node]); return; }
      const x = 800 - 36 - i * 34, y = this.buffTop, left = b.until - now, total = Math.max(1, b.dur || left);
      ctx.save();
      if (left < 10000 && Math.floor(now / 250) % 2 === 0) ctx.globalAlpha = 0.45;   // blinks as it runs out
      ctx.drawImage(img, x, y + 32 - img.height);
      // shade the elapsed part, sweeping clockwise from twelve o'clock
      const done = Math.min(1, 1 - left / total);
      if (done > 0) {
        ctx.beginPath(); ctx.moveTo(x + 16, y + 16);
        ctx.arc(x + 16, y + 16, 23, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2);
        ctx.closePath(); ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x, y, 32, 32); ctx.restore();
      }
      ctx.restore();
    });
  }
  itemIcon(id) {
    this.icons ??= new Map();
    if (!this.icons.has(id)) { this.icons.set(id, null); itemIcon(this.assets, id).then((n) => this.icons.set(id, n)); }
    return this.icons.get(id);
  }
}

function drawAt(ctx, im, node, x, y, alpha) {
  const i = node && im(node);
  if (!i) return;
  const o = node.origin || [i.width / 2, i.height];
  ctx.save(); ctx.globalAlpha *= alpha ?? 1;
  ctx.drawImage(i, Math.round(x - o[0]), Math.round(y - o[1]));
  ctx.restore();
}
function canvases(node) { return node ? frames(node).filter(isCanvas).concat(Object.values(node).filter(isCanvas)) : []; }
function deep(node, depth) {
  if (!node || typeof node !== 'object') return [];
  if (isCanvas(node)) return [node];
  return depth ? Object.entries(node).filter(([k]) => !k.startsWith('_')).flatMap(([, v]) => deep(v, depth - 1)) : [];
}
