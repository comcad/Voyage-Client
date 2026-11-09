import { isCanvas, frames } from './assets.js';
import { Anim } from './map.js';
import { itemIcon } from './data.js';
import { uiText, timeLeft, overlayText } from './ui/wzui.js';
import { richText } from './ui/richtext.js';
import { textRef } from './ui/dialogs.js';
import { settings } from './settings.js';
import { UI_W, VIEW_W, VIEW_H } from './view.js';
import { config } from './config.js';

/**
 * World-space effects from the original art:
 *   damage numbers   Effect/BasicEff NoRed / NoCri / NoViolet / NoBlue (1 = big first digit, 0 = the rest)
 *   character fx     BasicEff LevelUp / JobChanged / QuestClear, anchored at the feet
 *   chat balloons    UI/ChatBalloon.img/0 (9-slice + arrow)
 *   quest icons      UI/UIWindow.img/QuestIcon (2 book: quest to hand in, 0 bulb: quest to start, 1 bubble: in progress)
 *   boss HP          UI/UIWindow.img/MobGage (icon frame, [ track ], Gage/<colour> fill)
 *   buffs            skill / item icons at the top right, shaded clockwise as they run out
 *   tombstone        Effect/Tomb.img fall (spins down 600px in 880ms, then lands)
 */
const SETS = { red: ['NoRed1', 'NoRed0'], crit: ['NoCri1', 'NoCri0'], violet: ['NoViolet1', 'NoViolet0'], blue: ['NoBlue1', 'NoBlue0'] };
// damage numbers, as openms recovered the original: opaque for 400ms, fading over the next 600, rising 30px
const NUM_MS = 1000, NUM_OPAQUE = 400, NUM_RISE = 30, LINE_GAP = 30;
/**
 * How long each damage line waits before it shows (ms), per skill; the rest wait 120 per line. Brandish, Assassinate
 * and Boomerang Step wait 80ms more per line and their second line longer still: 160 (Brandish with a one-handed
 * weapon) or 240. Vampire's four land 0, 60, 420 and 660ms in, Barrage's six 450, 720, 990, 1260, 1710 and 1980ms
 * and Demolition's eight 0, 180, 450, 720, 900, 990, 1080 and 1170ms, at the attack's speed (scale); Demolition's
 * lines also keep the usual 120 per line on top.
 */
export function lineDelay(skillId, line, weaponId = 0, scale = 1) {
  if (skillId === 14101006) return Math.round([0, 60, 420, 660][Math.min(line, 3)] * scale);
  if (skillId === 5121007 || skillId === 15111004) return Math.round([450, 720, 990, 1260, 1710, 1980][Math.min(line, 5)] * scale);
  if (skillId === 5121004) return Math.trunc([0, 180, 450, 720, 900, 990, 1080, 1170][Math.min(line, 7)] * scale) + line * 120;
  if ([5101004, 15101003].includes(skillId)) return 0;   // these all show at once
  if ([3111006, 3211006, 13111001].includes(skillId)) return line * 60;   // Strafe and the like run faster
  const brandish = skillId === 1121008 || skillId === 11111004;
  if (brandish || skillId === 4221001 || skillId === 4221007) {
    const second = brandish && ![140, 141].includes(Math.floor(weaponId / 10000)) ? 160 : 240;
    return 80 * (line + 1) + line * 120 + (line ? second - 80 : 0);
  }
  return line * 120;
}
const FOREIGN = { 0: 'LevelUp', 8: 'JobChanged', 9: 'QuestClear', 0x0d: 'MonsterBook/cardGet', 0x0f: 'ItemLevelUp' };

/** A balloon's lines: words wrapped at `max` px, and a word wider than that split across lines. */
function balloonLines(ctx, text, max) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width <= max) { line = t; continue; }
      if (line) out.push(line);
      line = '';
      for (const ch of word) {
        if (line && ctx.measureText(line + ch).width > max) { out.push(line); line = ''; }
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

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
    await a.preload([...sets, ...deepCanvases(this.E.Combo), ...deepCanvases(this.E.ComboCommand), this.E.NoCri1?.effect, ...canvases(this.CB[0]), ...canvases(this.CB.npc), ...this.bulb.frames, ...this.book.frames, ...this.bubble.frames,
      ...deep(this.W.MobGage, 3), ...canvases(this.T.fall), this.W.IconBase?.[0], ...frames(this.W.Skill?.CoolTime)].filter(isCanvas));
  }

  // ---------------------------------------------------------------- triggers
  /**
   * values: one number per hit line (0 = MISS). kind: red (yours), blue (others'), violet (taken), crit.
   * Each line is placed when it shows, LINE_GAP (Demolition 15) above the last, over where the target is by then; a
   * monster's 15px above its head, your own right at your head.
   */
  damage(target, values, kind = 'red', skillId = 0, crits = [], weaponId = 0, scale = 1) {
    const lift = target.kind === 'Mob' ? 15 : 0;
    const gap = skillId === 5121004 ? 15 : LINE_GAP;   // Demolition's eight stack closer
    values.forEach((v, line) => this.nums.push({ v, kind: crits[line] && v && kind === 'red' ? 'crit' : kind, target, lift, line, gap, t: -lineDelay(skillId, line, weaponId, scale) }));
  }
  foreign(effect) { return FOREIGN[effect]; }
  /** BasicEff animation that follows an entity (player or remote player). */
  play(name, ent) {
    const node = name.split('/').reduce((n, k) => n?.[k], this.E);   // a name, or a path under BasicEff
    if (!node) return;
    const anim = new Anim(node, false);
    this.assets.preload(anim.frames);
    this.anims.push({ anim, ent });
  }
  /** Any WZ animation by path ("UI/tutorial.img/28"), played once on `ent`, placed by its own origin. */
  async playPath(path, ent) {
    const at = path.indexOf('.img');
    if (at < 0) return;
    let node = await this.assets.json(path.slice(0, at + 4));
    for (const seg of path.slice(at + 5).split('/').filter(Boolean)) node = node?.[seg];
    if (!node) return;
    const anim = new Anim(node, false);
    await this.assets.preload(anim.frames);
    this.anims.push({ anim, ent });
  }
  /**
   * PLAYER_HINT: a WorldNotice/Balloon over your head ("Once you leave this area..."), wrapped to the server's
   * width, for its seconds.
   */
  async hint(text, width, seconds, ent) {
    this.L ??= await this.assets.json('UI/Login.img');
    const node = this.L?.WorldNotice?.Balloon;
    if (!node) return;
    this.hints = [{ text, wrap: Math.max(40, width), until: performance.now() + Math.max(1, seconds) * 1000, ent, node }];
  }
  /**
   * A tombstone for `ent` at (x, y). Fresh, it spins down from 600px above, landing 880ms later (its frames on their
   * own clock); otherwise it is lying there already (its last frame).
   */
  tomb(ent, x, y, fresh = true) {
    this.untomb(ent);
    const anim = new Anim(this.T.fall, false);
    if (!fresh) { anim.i = anim.frames.length - 1; anim.done = true; }
    this.tombs.push({ anim, ent, x, y, fresh, t0: performance.now() });
  }
  untomb(ent) { const i = this.tombs.findIndex((t) => t.ent === ent); if (i >= 0) this.tombs.splice(i, 1); }
  clearTombs() { this.tombs.length = 0; }
  bossHp(d) { this.boss = d.hp > 0 ? d : null; }
  /** Map/Effect.img/<name> played once on the screen, centred at (400, 260) by its own origin (as on 800x600). */
  async screen(name, node = null) {
    if (!node) { this.mapFx ??= await this.assets.json('Map/Effect.img'); node = name.split('/').reduce((n, k) => n?.[k], this.mapFx); }
    if (!node) return;
    const anim = new Anim(node, false);
    await this.assets.preload(anim.frames);
    (this.screens ??= []).push(anim);
  }
  drawScreen(ctx) {
    const im = (n) => this.assets.image(n);
    for (const a of this.screens || []) drawAt(ctx, im, a.node, VIEW_W / 2, VIEW_H / 2 - 40, a.alpha);
  }
  /** A canvas shown at a spot on the map, whole for `hold` ms, then fading out over `fade` ms. */
  flash(node, x, y, hold, fade) {
    if (!node) return;
    this.assets.preload([node]);
    (this.flashes ??= []).push({ node, x, y, t: 0, hold, fade });
  }
  mapChanged() { this.flashes = []; this.screens = []; this.nums.length = 0; this.anims.length = 0; this.tombs.length = 0; this.boss = null; this.questIcons.clear(); this.hints = []; this.questT = 0; }   // NPC quest icons right away on a new map

  /** Where an NPC's quest icon is (world coordinates); clicking it opens the NPC. */
  questIconRect(e) {
    const anim = this.questIcons.get(e), n = anim?.node, img = n && this.assets.image(n);
    if (!img) return null;
    const o = n.origin || [img.width / 2, img.height / 2], b = e.box();
    return { img, x: e.x - o[0], y: b.top - 26 - o[1], w: img.width, h: img.height };
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    for (const n of this.nums) n.t += dt * 1000;
    this.nums = this.nums.filter((n) => n.t < NUM_MS);
    for (const a of this.anims) a.anim.update(dt * 1000);
    if (this.screens?.length) {
      for (const a of this.screens) a.update(dt * 1000);
      this.screens = this.screens.filter((a) => !a.done);
    }
    if (this.flashes?.length) {
      for (const f of this.flashes) f.t += dt * 1000;
      this.flashes = this.flashes.filter((f) => f.t < f.hold + f.fade);
    }
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
    for (const [e] of this.questIcons) {
      const r = this.questIconRect(e);
      if (r) ctx.drawImage(r.img, Math.round(r.x - cam.x), Math.round(r.y - cam.y));
    }
    // level up / job change / quest clear, following their character
    for (const a of this.anims) drawAt(ctx, im, a.anim.node, a.ent.x - cam.x, a.ent.y - cam.y, a.anim.alpha);
    for (const f of this.flashes || []) drawAt(ctx, im, f.node, f.x - cam.x, f.y - cam.y, f.t < f.hold ? 1 : 1 - (f.t - f.hold) / f.fade);
    for (const n of this.nums) this.drawNumber(ctx, n, cam);
    if (this.hints?.length) {
      this.hints = this.hints.filter((h) => performance.now() < h.until);
      for (const h of this.hints) this.drawBalloon(ctx, cam, h.ent, h.text, null, { node: h.node, width: h.wrap, arrowDx: 24, rich: true });
    }
  }
  /** Tombstones, drawn behind the characters so the ghost floats in front. */
  drawTombs(ctx, cam) {
    const im = (n) => this.assets.image(n), now = performance.now();
    for (const t of this.tombs) {
      const drop = t.fresh ? Math.round(600 * Math.max(0, 1 - (now - t.t0) / 880)) : 0;
      drawAt(ctx, im, t.anim.node, t.x - cam.x, t.y - drop - cam.y, 1);
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
    // over the body it struck: a monster's own lt/rb (a boss part's, not the whole boss's), else its picture
    const body = typeof n.target.bodyBox === 'function' ? n.target.bodyBox() : null;
    const top = body ? body.top : typeof n.target.box === 'function' ? n.target.box().top : n.target.y - 60;
    n.x = body ? Math.round((body.left + body.right) / 2) : n.target.x; n.y = top - n.lift - (n.gap ?? LINE_GAP) * n.line;
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

  /** ChatBalloon.img/0 (or /npc, /pet/<n>): a 9-slice around the text with the arrow under it, pointing at the speaker. */
  drawBalloon(ctx, cam, ent, text, style = '0', { node = null, wrap = 89, width = 0, arrowDx = null, rich = false } = {}) {
    if (!node && String(style).startsWith('pet/') && !this.CB?.pet?.[style.slice(4)]) style = 'pet/0';
    const B = node || String(style).split('/').reduce((n, k) => n?.[k], this.CB), im = (n) => this.assets.image(n);
    if (B && !B._loaded) { B._loaded = true; this.assets.preload(canvases(B)); }
    const p = Object.fromEntries(['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se', 'arrow'].map((k) => [k, im(B?.[k])]));
    const tail = arrowDx !== null && B?.slArrow ? im(B.slArrow) : null;   // a hint's tail: slArrow, pointing down-left
    if (Object.values(p).some((v) => !v)) return style !== '0' && style !== 'npc' ? this.drawBalloon(ctx, cam, ent, text) : false;   // a quote ring's, until its art is in
    ctx.save();
    ctx.font = '12px Arial, sans-serif';
    // centred 14px lines wrapped at 89px (a word too long for a line is broken up), in the balloon's clr; the arrow
    // laid over the bottom edge at the centre so the tail grows out of it
    // width: a fixed outer width (the server's hint width), the text wrapped inside the 9px sides
    const inner = width ? width - 18 : 0;
    const color = B.clr === undefined ? '#000' : `#${((B.clr >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
    // rich: the text's # codes (#b blue, #e bold, #k / #n back...) laid out as the client's text does, each line centred
    let lines, W, H;
    const lh = 14;
    if (rich) {
      lines = richText(ctx, text, inner || wrap, textRef(this.game.windows), { base: color, size: 12, lineH: lh }).lines;
      for (const l of lines) l.w = Math.max(0, ...l.runs.map((r) => { ctx.font = `${r.bold ? 'bold ' : ''}12px Arial, sans-serif`; return r.x + (r.t ? ctx.measureText(r.t).width : 0); }));
      ctx.font = '12px Arial, sans-serif';
      W = inner || Math.max(30, Math.ceil(Math.max(...lines.map((l) => l.w))) - 2); H = lines.length * lh;
    } else {
      lines = balloonLines(ctx, text, inner || wrap);
      W = inner || Math.max(30, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) - 2); H = lines.length * lh;
    }
    const cx = Math.round(ent.x - cam.x), x0 = cx - Math.round(W / 2), y0 = Math.round(ent.y - cam.y - 86 - H - 6);
    // each piece sits by its origin round the text box (x0, y0, W, H): corners at its corners, edges stretched along it
    const o = (k) => B[k]?.origin || [0, 0];
    // a hint's balloon is see-through: its pieces are put together on their own canvas, the arrow replacing what is
    // under it (not blended over it, which would show a brighter square), then the whole is drawn at once
    const screen = ctx;
    let off = null;
    if (arrowDx !== null) {
      off = (this.balloonCanvas ??= document.createElement('canvas'));
      off.width = W + 60; off.height = H + 60;
      ctx = off.getContext('2d');
      ctx.font = '12px Arial, sans-serif';
      ctx.translate(30 - x0, 30 - y0);
    }
    ctx.drawImage(p.c, x0, y0, W, H);
    ctx.drawImage(p.n, x0, y0 - o('n')[1], W, p.n.height); ctx.drawImage(p.s, x0, y0 + H - o('s')[1], W, p.s.height);
    ctx.drawImage(p.w, x0 - o('w')[0], y0, p.w.width, H); ctx.drawImage(p.e, x0 + W - o('e')[0], y0, p.e.width, H);
    ctx.drawImage(p.nw, x0 - o('nw')[0], y0 - o('nw')[1]); ctx.drawImage(p.ne, x0 + W - o('ne')[0], y0 - o('ne')[1]);
    ctx.drawImage(p.sw, x0 - o('sw')[0], y0 + H - o('sw')[1]); ctx.drawImage(p.se, x0 + W - o('se')[0], y0 + H - o('se')[1]);
    const ao = o('arrow');
    // the arrow is laid over the bottom edge (it covers the border there and grows the tail below it): at the centre,
    // or arrowDx right of it (a hint's)
    const ax = cx + (arrowDx ?? 1 - ao[0]), ay = y0 + H - ao[1];
    if (off && tail) {
      // laid over the bottom band (its row 8 is the border, open where the tail joins), replacing what is there
      ctx.clearRect(ax, ay, tail.width, tail.height);
      ctx.drawImage(tail, ax, ay);
    } else ctx.drawImage(p.arrow, ax, ay);
    if (off) { screen.drawImage(off, x0 - 30, y0 - 30); ctx = screen; }
    if (rich) lines.forEach((l, i) => { const lx = cx - Math.round(l.w / 2); for (const r of l.runs) if (r.t) uiText(ctx, r.t, lx + r.x, y0 + i * lh, { color: r.color, bold: r.bold, size: 12 }); });
    else lines.forEach((l, i) => uiText(ctx, l, cx, y0 + i * lh, { color, size: 12, align: 'center' }));
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
    const x = 42, y = 12, w = UI_W - x - 12;
    ctx.drawImage(l, x, y); ctx.drawImage(tile, x + l.width, y, w - l.width - r.width, tile.height); ctx.drawImage(r, x + w - r.width, y);
    // the filled part in Gage/<tag colour>, the rest in Gage/<background colour>; /0 is the 1px cap before it
    const gage = (c) => G.Gage?.[String(Math.min(7, Math.max(1, c || 1)))], fg = gage(d.tag), bg = gage(d.bg);
    const inner = w - l.width - r.width, k = Math.max(0, Math.min(1, d.hp / Math.max(1, d.maxHp))), n = Math.round(inner * k);
    const cap = im((n > 0 ? fg : bg)?.[0]), on = im(fg?.[1]), off = im(bg?.[1]);
    if (cap) ctx.drawImage(cap, x + 3, y + 4);
    if (on && n > 0) ctx.drawImage(on, x + l.width, y + 4, n, on.height);
    if (off && n < inner) ctx.drawImage(off, x + l.width + n, y + 4, inner - n, off.height);
    if (config.bossHpPercent) overlayText(ctx, `${(k * 100).toFixed(2)}%`, x + w / 2, y + 10, 'middle');
  }

  /** Buff icons, newest on the left of the row, at the top right. */
  buffAt(x, y) {
    const list = this.buffList();
    const top = this.buffTop;
    for (let i = 0; i < list.length; i++) { const bx = UI_W - 36 - i * 34; if (x >= bx && x < bx + 32 && y >= top && y < top + 32) return list[i]; }
    return null;
  }
  buffList() { const now = Date.now(); return this.game.buffs.filter((b) => b.until > now && !(b.source === 5221006 && this.game.battleshipHp === 0)); }
  get buffTop() { return this.boss ? 46 : 4; }
  drawBuffs(ctx) {
    const g = this.game, now = Date.now();
    this.buffList().forEach((b, i) => {
      const node = b.source > 0 ? g.skills?.icon(b.source) : this.itemIcon(-b.source);
      if (b.source > 0 && !node) g.skills?.ensure(b.source);
      const img = node && this.assets.image(node);
      if (!img) { if (node) this.assets.preload([node]); return; }
      const x = UI_W - 36 - i * 34, y = this.buffTop;
      // the Battleship's icon shows its HP (from COOLDOWN 5221999; full until the first), not time:
      // its most is (level - 120 + 2 x skill level) x 200
      const ship = b.source === 5221006;
      const shipMax = ship ? Math.max(1, ((g.stats?.level || 0) - 120 + 2 * (g.skills?.level(5221006) || 0)) * 200) : 0;
      const left = ship ? (g.battleshipHp ?? shipMax) : b.until - now, total = ship ? shipMax : Math.max(1, b.dur || left);
      const low = ship ? left <= Math.floor(total / 16) : left <= 3000;
      ctx.save();
      if (low) ctx.globalAlpha = Math.floor(now / 500) % 2 ? 64 / 255 : 210 / 255;   // pulses once it runs low
      // an item's buff: its raw icon centred on UIWindow.img/IconBase/0; a skill's icon is its own box
      const base = b.source < 0 && this.assets.image(this.W?.IconBase?.[0]);
      if (b.source < 0) {
        if (base) ctx.drawImage(base, x, y);
        ctx.drawImage(img, x + Math.floor((32 - img.width) / 2), y + Math.floor((32 - img.height) / 2));
      } else ctx.drawImage(img, x, y + 32 - img.height);
      // the time left on UIWindow.img/Skill/CoolTime, the quick slots' cover: 15 (clear) at the start down to 0 as it runs out
      const step = Math.max(0, Math.min(15, Math.floor(left / (total / 16)))), cool = this.W?.Skill?.CoolTime?.[step], cim = cool && this.assets.image(cool);
      if (cim) ctx.drawImage(cim, x, y);
      ctx.restore();
      if (config.buffTimeLeft && !ship) overlayText(ctx, timeLeft(left), x + 16, y + 33, 'bottom');
    });
  }
  itemIcon(id) {
    this.icons ??= new Map();
    if (!this.icons.has(id)) { this.icons.set(id, null); itemIcon(this.assets, id, true).then((n) => this.icons.set(id, n)); }
    return this.icons.get(id);
  }
}

/**
 * An equip's own effect (its info/effect: the effect rings and a few others), from the art at `path`
 * (Effect/CharacterEff.img/<id>). With `animate` that art just plays on the character. Otherwise every `interval` ms
 * one of its animations, picked at random, appears and lives `delay` ms, fading out: at a random spot of the
 * left/top/right/bottom box drifting (dx..dx1, dy..dy1), or with `emission` thrown out from the middle - at a
 * (dx..dx1) radius on an angle that turns `theta` degrees each time (random without one), or from its `genPoint`s in
 * turn - moving (dy..dy1) further out. `follow` ones move with the character; `genOnMove` ones only come while it
 * moves; z < 0 is behind it. A ring's, a cap's or an accessory's hangs from the head, the rest from the feet.
 */
export class EquipEffect {
  constructor(id, e, art) {
    const n = (k, d) => (e[k] === undefined ? d : Number(e[k]) || 0);
    this.id = id; this.art = art;
    this.follow = !!n('follow', 0); this.emission = !!n('emission', 0); this.genOnMove = !!n('genOnMove', 0);
    this.noFlip = !!n('noFlip', 1); this.fixed = !!n('fixed', 0); this.z = n('z', 0);
    this.box = [n('left', -25), n('top', -25), n('right', 25), n('bottom', 25)];
    this.dx = n('dx', 0); this.dy = n('dy', this.follow ? 0 : -20); this.dx1 = n('dx1', this.dx); this.dy1 = n('dy1', this.dy);
    this.delay = n('delay', 1000) || 1000; this.interval = n('interval', 250) || 250; this.theta = n('theta', 0);
    this.genPoint = frames(e.genPoint);
    const cat = Math.floor(id / 10000);
    this.head = this.emission || [100, 101, 102, 103, 110, 111].includes(cat);
    this.anim = n('animate', 0) && frames(art).length ? new Anim(frames(art)[0]) : null;
    this.parts = []; this.t = 0; this.next = 0; this.angle = Math.floor(Math.random() * 360); this.gi = 0;
  }
  update(dt, at, right, moving) {
    const ms = dt * 1000;
    this.t += ms;
    if (this.anim) { this.anim.update(ms); return; }
    for (const p of this.parts) { p.age += ms; p.anim.update(ms); }
    this.parts = this.parts.filter((p) => p.age < this.delay);
    if (this.t < this.next) return;
    this.next += this.interval;
    if (this.genOnMove && !moving) return;
    const art = frames(this.art);
    if (!art.length) return;
    const rnd = (a, b) => (b > a ? a + Math.floor(Math.random() * (b - a)) : a);
    const ddx = rnd(this.dx, this.dx1), ddy = rnd(this.dy, this.dy1), g = this.genPoint.length ? this.genPoint[this.gi++ % this.genPoint.length] : null;
    let a;
    if (g) a = Math.atan2(g[1], g[0]);
    else if (this.theta) { a = this.angle; this.angle = (this.angle + 360 + this.theta) % 360; } else a = Math.floor(Math.random() * 360);
    if (!g) a *= Math.PI / 180;
    let x, y, mx, my;
    const [l, t, r, b] = this.box, flip = !this.noFlip && right;
    if (!this.emission) { x = l + rnd(0, r - l); y = t + rnd(0, b - t); mx = flip ? -ddx : ddx; my = ddy; }
    else { [x, y] = g || [ddx * Math.cos(a), ddx * Math.sin(a)]; y += 10; mx = ddy * Math.cos(a); my = ddy * Math.sin(a); }
    const anim = new Anim(art[Math.floor(Math.random() * art.length)]);
    this.parts.push({ anim, age: 0, x: this.follow ? x : at.x + x, y: this.follow ? y : at.y + y, mx, my, flip });
  }
  /** Behind the character (front false) or in front of it; `at` is where it hangs from, on screen. */
  draw(ctx, assets, at, right, front, camX = 0, camY = 0) {
    if ((this.z >= 0) !== front) return;
    const one = (node, x, y, flip, alpha) => {
      const img = node && assets.image(node);
      if (!img || alpha <= 0) return;
      const o = node.origin || [0, 0];
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(Math.round(x), Math.round(y));
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -o[0], -o[1]); ctx.restore();
    };
    if (this.anim) { one(this.anim.node, at.x, at.y, right && !this.fixed, this.anim.alpha); return; }
    for (const p of this.parts) {
      const k = p.age / this.delay, x = (this.follow ? at.x : -camX) + p.x + p.mx * k, y = (this.follow ? at.y : -camY) + p.y + p.my * k;
      one(p.anim.node, x, y, p.flip, p.anim.alpha * (1 - k));
    }
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
/** Every canvas under a node, however deep (the Aran combo counter's tiers, digits and frames). */
function deepCanvases(node) { return !node || typeof node !== 'object' ? [] : isCanvas(node) ? [node] : Object.values(node).flatMap(deepCanvases); }
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
/** Its level and name in yellow under its feet, each in its own see-through dark tag: the name centred, its level left of it. */
function mobNameTag(ctx, e, cam, info) {
  const x = Math.round(e.x - cam.x), y = Math.round(e.y - cam.y) + 2;
  ctx.save();
  ctx.font = '12px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const width = (text) => Math.ceil(ctx.measureText(text).width) + 6;
  const tag = (text, left, w) => {
    ctx.fillStyle = 'rgba(0,0,0,0.67)';
    ctx.fillRect(left + 1, y, w - 2, 13); ctx.fillRect(left, y + 1, w, 11);   // its corners rounded off
    ctx.fillStyle = '#ff0';
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
