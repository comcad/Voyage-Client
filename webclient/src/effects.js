import { isCanvas, frames } from './assets.js';
import { Anim } from './map.js';
import { itemIcon } from './data.js';
import { uiText, wrapText } from './ui/wzui.js';
import { settings } from './settings.js';

/**
 * World-space effects from the original art:
 *   damage numbers   Effect/BasicEff NoRed / NoCri / NoViolet / NoBlue (1 = big first digit, 0 = the rest)
 *   character fx     BasicEff LevelUp / JobChanged / QuestClear, anchored at the feet
 *   chat balloons    UI/ChatBalloon.img/0 (9-slice + arrow)
 *   quest icons      UI/UIWindow.img/QuestIcon (2 book: quest to hand in, 0 bulb: quest to start, 1 bubble: in progress)
 *   boss HP          UI/UIWindow.img/MobGage (icon frame, [ track ], Gage/<colour> fill)
 *   buffs            skill / item icons at the top right, shaded clockwise as they run out
 *   tombstone        Effect/Tomb.img fall (frames 0-11 drop, 12-19 land)
 */
const SETS = { red: ['NoRed1', 'NoRed0'], crit: ['NoCri1', 'NoCri0'], violet: ['NoViolet1', 'NoViolet0'], blue: ['NoBlue1', 'NoBlue0'] };
// damage numbers, as openms recovered the original: opaque for 400ms, fading over the next 600, rising 30px
const NUM_MS = 1000, NUM_OPAQUE = 400, NUM_RISE = 30, LINE_GAP = 30;
/**
 * How long each damage line waits before it shows (ms), per skill; the rest wait 120 per line. Brandish, Assassinate
 * and Boomerang Step wait 80ms more per line and their second line longer still: 160 (Brandish with a one-handed
 * weapon) or 240. Vampire's four land 0, 60, 420 and 660ms in, at the attack's speed (scale).
 */
export function lineDelay(skillId, line, weaponId = 0, scale = 1) {
  if (skillId === 14101006) return Math.round([0, 60, 420, 660][Math.min(line, 3)] * scale);
  if ([5101004, 15101003, 5121007, 15111004].includes(skillId)) return 0;   // these all show at once
  if ([3111006, 3211006, 13111001].includes(skillId)) return line * 60;   // Strafe and the like run faster
  const brandish = skillId === 1121008 || skillId === 11111004;
  if (brandish || skillId === 4221001 || skillId === 4221007) {
    const second = brandish && ![140, 141].includes(Math.floor(weaponId / 10000)) ? 160 : 240;
    return 80 * (line + 1) + line * 120 + (line ? second - 80 : 0);
  }
  return line * 120;
}
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
    this.bulb = new Anim(this.W.QuestIcon[0]); this.book = new Anim(this.W.QuestIcon[2]); this.bubble = new Anim(this.W.QuestIcon[1]);
    await a.preload([...sets, this.E.NoCri1?.effect, ...canvases(this.CB[0]), ...canvases(this.CB.npc), ...this.bulb.frames, ...this.book.frames, ...this.bubble.frames,
      ...deep(this.W.MobGage, 3), ...canvases(this.T.fall)].filter(isCanvas));
  }

  // ---------------------------------------------------------------- triggers
  /**
   * values: one number per hit line (0 = MISS). kind: red (yours), blue (others'), violet (taken), crit.
   * Each line is placed when it shows, LINE_GAP above the last, over where the target is by then; a monster's
   * 15px above its head, your own right at your head.
   */
  damage(target, values, kind = 'red', skillId = 0, crits = [], weaponId = 0, scale = 1) {
    const lift = target.kind === 'Mob' ? 15 : 0;
    values.forEach((v, line) => this.nums.push({ v, kind: crits[line] && v ? 'crit' : kind, target, lift, line, t: -lineDelay(skillId, line, weaponId, scale) }));
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
  /** A tombstone for `ent`: it lands where the ghost is (following the death knock-back), not where the blow fell. */
  tomb(ent) { this.tombs.push({ anim: new Anim(this.T.fall, false), ent }); }
  clearTombs() { this.tombs.length = 0; }
  bossHp(d) { this.boss = d.hp > 0 ? d : null; }
  mapChanged() { this.nums.length = 0; this.anims.length = 0; this.tombs.length = 0; this.boss = null; this.questIcons.clear(); }

  // ---------------------------------------------------------------- frame
  update(dt) {
    for (const n of this.nums) n.t += dt * 1000;
    this.nums = this.nums.filter((n) => n.t < NUM_MS);
    for (const a of this.anims) a.anim.update(dt * 1000);
    this.anims = this.anims.filter((a) => !a.anim.done);
    for (const t of this.tombs) t.anim.update(dt * 1000);
    this.bulb?.update(dt * 1000); this.book?.update(dt * 1000); this.bubble?.update(dt * 1000);
    // which NPCs have quests to hand in / start / in progress, in that order of priority (refreshed every second)
    if ((this.questT -= dt) <= 0 && this.game.quests && this.game.map) {
      this.questT = 1;
      const ctx = this.game.textCtx();
      this.questIcons.clear();
      for (const e of this.game.map.life) {
        if (e.kind !== 'Npc') continue;
        const q = this.game.quests.npcQuests(Number(e.spawn.id), ctx);
        const icon = q.complete.length ? this.book : q.start.length ? this.bulb : q.progress.length ? this.bubble : null;
        e.questIcon = !!icon;
        if (icon) this.questIcons.set(e, icon);
      }
    }
  }

  drawWorld(ctx, cam) {
    const im = (n) => this.assets.image(n);
    // a monster you hit shows its HP bar and its level and name for 5s after your last hit (System Option MONSTER
    // INFO: none / HP / name and HP); one that other monsters can hurt always shows its bar, in red
    const now = performance.now();
    for (const e of this.game.map.life) {
      if (e.kind !== 'Mob' || !e.alive || Number(e.spawn.id) === this.boss?.oid) continue;
      const info = e.src?.info || {}, escort = !!Number(info.damagedByMob), shown = e.hpShownUntil > now;
      if (!escort && (!shown || !settings.mobInfo)) continue;
      // the bar shows the HP % the server last sent (an escort starts full), not what our own hits took off
      const pct = e.hpPct ?? (escort ? 100 : null);
      if (pct !== null && (escort || !(Number(info.hideHP) || Number(info.HPgaugeHide)))) mobHpBar(ctx, e, cam, pct, escort ? '#f00' : '#0f0');
      if (shown && settings.mobInfo === 2 && !Number(info.hideName) && e.name) mobNameTag(ctx, e, cam, info);
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
    for (const n of this.nums) this.drawNumber(ctx, n, cam);
  }
  /** Tombstones (drawn behind the characters, so the ghost floats in front): drop from above during frames 0-11, then land. */
  drawTombs(ctx, cam) {
    const im = (n) => this.assets.image(n);
    for (const t of this.tombs) {
      const a = t.anim, fallMs = 12 * 80, at = Math.min(fallMs, a.i < 12 ? a.i * 80 + a.t : fallMs);
      // +1: the stone's art sits a pixel left of the ghost's middle
      drawAt(ctx, im, a.node, Math.round(t.ent.x) + 1 - cam.x, Math.round(t.ent.y) - cam.y - 320 * (1 - at / fallMs), 1);
    }
  }

  drawNumber(ctx, n, cam) {
    if (n.t < 0) return;
    if (!n.glyphs && !this.layoutNumber(n)) return;
    ctx.save();
    ctx.globalAlpha = n.t <= NUM_OPAQUE ? 1 : (NUM_MS - n.t) / (NUM_MS - NUM_OPAQUE);
    const x = Math.round(n.x - cam.x), y = Math.round(n.y - cam.y - (NUM_RISE * n.t) / NUM_MS);
    for (const g of n.glyphs) {
      if (g.clip) ctx.drawImage(g.img, 0, 0, g.clip, g.img.height, x + g.x, y + g.y, g.clip, g.img.height);
      else ctx.drawImage(g.img, x + g.x, y + g.y);
    }
    ctx.restore();
  }
  /**
   * Fixed once, when the number first shows (as the original builds its canvas): the first digit from the
   * set's big row (NoRed1), the rest from the small (NoRed0); each starts 3/5 of the way across the one before
   * (by its width less its origin), their bottoms alternating 4 and 1px up with a random extra pixel. A critical
   * starts its digits 30px in, over NoCri1/effect cut to the number's width. MISS sits on the spot, centred.
   */
  layoutNumber(n) {
    const im = (node) => node && this.assets.image(node), [bigK, smallK] = SETS[n.kind] || SETS.red;
    const top = n.target.box ? n.target.box().top : n.target.y - 60;
    n.x = n.target.x; n.y = top - n.lift - LINE_GAP * n.line;
    if (!n.v) {
      const img = im((n.kind === 'violet' ? this.E.NoViolet0 : this.E.NoRed0)?.Miss);
      if (!img) return false;
      n.glyphs = [{ img, x: -Math.trunc(img.width / 2), y: -img.height }];
      return true;
    }
    const crit = n.kind === 'crit', glyphs = [];
    let width = crit ? 30 : 0, overlap = 0;
    for (const [i, ch] of [...String(n.v)].entries()) {
      const node = this.E[i === 0 ? bigK : smallK]?.[ch], img = im(node);
      if (!img) return false;
      const x = width - overlap;
      glyphs.push({ img, x, y: 57 - (i % 2 === 0 ? 4 : 1) - Math.trunc(Math.random() * 2) - img.height });
      width = x + img.width;
      overlap = Math.trunc(((img.width - (node.origin?.[0] || 0)) * 3) / 5);
    }
    const fx = crit && im(this.E.NoCri1?.effect);
    if (fx) glyphs.unshift({ img: fx, x: 0, y: 0, clip: Math.min(width, fx.width) });
    for (const g of glyphs) { g.x -= Math.trunc(width / 2); g.y -= 47; }
    n.glyphs = glyphs;
    return true;
  }

  /** ChatBalloon.img/0 (or /npc): a 9-slice around the text with the arrow under it, pointing at the speaker. */
  drawBalloon(ctx, cam, ent, text, style = '0') {
    const B = this.CB?.[style], im = (n) => this.assets.image(n);
    const p = Object.fromEntries(['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se', 'arrow'].map((k) => [k, im(B?.[k])]));
    if (Object.values(p).some((v) => !v)) return false;
    ctx.save();
    ctx.font = '12px Arial, sans-serif';
    // ChatBalloon.img/0 round the text: 12px lines on the white, 5px in from its left and 6px from its right, the
    // arrow (origin 1, 0) laid over the bottom edge at the centre so the tail grows out of it, leaning left
    // an NPC's: centred 14px lines wrapped at 89px, in its clr (dark red)
    const npc = style === 'npc', lh = npc ? 14 : 12;
    const lines = wrapText(ctx, text, npc ? 89 : 150, 12);
    const W = Math.max(30, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) - 2), H = lines.length * lh;
    const cx = Math.round(ent.x - cam.x), x0 = cx - Math.round(W / 2), y0 = Math.round(ent.y - cam.y - 86 - H - 6);
    ctx.drawImage(p.c, x0, y0, W, H);
    ctx.drawImage(p.nw, x0 - 6, y0 - 6); ctx.drawImage(p.n, x0, y0 - 6, W, 6); ctx.drawImage(p.ne, x0 + W, y0 - 6);
    ctx.drawImage(p.w, x0 - 6, y0, 6, H); ctx.drawImage(p.e, x0 + W, y0, 6, H);
    ctx.drawImage(p.sw, x0 - 6, y0 + H); ctx.drawImage(p.s, x0, y0 + H, W, 6); ctx.drawImage(p.se, x0 + W, y0 + H);
    const ao = B.arrow.origin || [0, 0];
    ctx.drawImage(p.arrow, cx - ao[0] + 1, y0 + H - ao[1]);
    const color = `#${((B.clr >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
    if (npc) lines.forEach((l, i) => uiText(ctx, l, cx, y0 + i * lh, { color, size: 12, align: 'center' }));
    else lines.forEach((l, i) => uiText(ctx, l, x0 - 1, y0 + i * 12 + 2, { color, size: 12 }));
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

/**
 * A monster's HP bar, as the client draws it: a 52x10 box centred over its body, 30px above its top - black, white,
 * black - holding the HP (46px at full) in 3 rows of its colour over a row of dark red.
 */
function mobHpBar(ctx, e, cam, pct, color) {
  const b = e.hitBox(), x = Math.round((b.left + b.right) / 2 - cam.x) - 26, y = Math.round(b.top - cam.y) - 30;
  const w = Math.floor((Math.max(0, Math.min(100, pct)) * 46) / 100);
  ctx.fillStyle = '#000'; ctx.fillRect(x, y, 52, 10);
  ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y + 1, 50, 8);
  ctx.fillStyle = '#000'; ctx.fillRect(x + 2, y + 2, 48, 6);
  ctx.fillStyle = color; ctx.fillRect(x + 3, y + 3, w, 3);
  ctx.fillStyle = '#a00300'; ctx.fillRect(x + 3, y + 6, w, 1);
}
/** Its level and name under its feet, each in its own see-through dark tag: the name centred, its level just left of it. */
function mobNameTag(ctx, e, cam, info) {
  const x = Math.round(e.x - cam.x), y = Math.round(e.y - cam.y) + 2;
  ctx.save();
  ctx.font = '12px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const width = (text) => Math.ceil(ctx.measureText(text).width) + 6;
  const tag = (text, left, w) => {
    ctx.fillStyle = 'rgba(0,0,0,0.67)';
    ctx.fillRect(left + 1, y, w - 2, 13); ctx.fillRect(left, y + 1, w, 11);   // its corners rounded off
    ctx.fillStyle = '#fff';
    ctx.fillText(text, left + w / 2, y);
  };
  const nw = width(e.name), left = x - Math.floor(nw / 2);
  tag(e.name, left, nw);
  if (!Number(info.hideLevel) && info.level) {
    const lv = `Lv.${info.level}`, lw = width(lv);
    tag(lv, left - 1 - lw, lw);
  }
  ctx.restore();
}
