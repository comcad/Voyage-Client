/**
 * The Pyramid (Nett's Pyramid) windows, UI/UIWindow.img/MonsterKilling.
 *
 * On a Pyramid stage (fieldType 23): the count panel at the top left (hits, cool hits, misses and, unless the map
 * disables it, the Rage of Pharaoh skill count with its key panel), the danger gauge across the top, and the stage
 * timer (Map/Obj/etc.img/killing). The gauge fills as time passes (the map's mobMassacre/gauge/decrease a second)
 * less what you have earned back (PYRAMID_GAUGE), out of mobMassacre/gauge/total; past 64% it turns to its danger
 * art. Under 2 seconds left, killing/clear plays.
 *
 * On the result map (fieldType 24), PYRAMID_SCORE shows the result for 5 seconds: the counts and their share of all
 * three, the EXP gained, and the rank (S, A, B, C, D).
 */
import { Anim } from '../map.js';

const STAGE = 23, RESULT = 24;
/** The gauge: 259px at full, its right end at x 540; the danger art at x 530 less that. Danger past 64%. */
const GAUGE_W = 259, GAUGE_END = 540, DANGER_END = 530, DANGER_PCT = 64;
const RESULT_MS = 5000;
const RANKS = ['s', 'a', 'b', 'c', 'd'];

/**
 * A number font: up to `digits` digits right-aligned in slots `step` px apart from x, no leading zeros; a sign
 * glyph (`plus`), when the font has one, in the slot before the first digit.
 */
function drawNumber(ctx, im, font, x, y, value, digits, step) {
  if (!font) return;
  const put = (node, slot) => {
    const i = node && im(node);
    if (i) ctx.drawImage(i, x + step * slot - (node.origin?.[0] || 0), y - (node.origin?.[1] || 0));
  };
  let v = Math.trunc(value), slot = digits - 1;
  const neg = v < 0;
  v = Math.abs(v);
  for (;;) {
    put(font[v % 10], slot);
    v = Math.trunc(v / 10);
    slot--;
    if (!v || slot < 0) break;
  }
  const sign = neg ? font.minus : font.plus;
  if (sign && slot >= 0) put(sign, slot);
}

export class PyramidWindow {
  constructor(game) {
    this.game = game;
    this.art = null;
    this.reset();
  }

  reset() {
    /** PYRAMID_GAUGE: what you have earned back against the gauge. */
    this.earned = 0;
    /** The stage timer: its length (s) and when it ends. */
    this.total = 0; this.end = 0; this.cleared = false;
    /** The key panel: -1 none, 0 opening, 1 open, 2 closing (it follows the skill count). */
    this.keyState = -1; this.keyOpen = null; this.keyIng = null; this.keyClose = null; this.skillSeen = 0;
    this.result = null;
  }
  mapChanged() { const r = this.result; this.reset(); if (r && this.type() === RESULT) this.result = r; }

  type() { return Number(this.game.map?.info?.fieldType) || 0; }
  /** The map's mobMassacre data: whether the skill is off, and the gauge's total and decrease a second. */
  massacre() {
    const m = this.game.map?.data?.mobMassacre || {};
    return { noSkill: !!Number(m.disableSkill), total: Number(m.gauge?.total) || 0, decrease: Number(m.gauge?.decrease) || 0 };
  }

  async load() {
    if (this.art || this.loading) return;
    this.loading = true;
    const [W, O] = await Promise.all([this.game.assets.json('UI/UIWindow.img'), this.game.assets.json('Map/Obj/etc.img')]);
    const K = W?.MonsterKilling, T = O?.killing;
    if (!K || !T) { this.loading = false; return; }
    this.danger = { back: new Anim(K.Gauge.backgrdD), text: new Anim(K.Gauge.textD), icon: new Anim(K.Gauge.iconD), bar: new Anim(K.Gauge.danger) };
    const all = (n) => (n && typeof n === 'object' ? (n._w ? [n] : Object.values(n).flatMap(all)) : []);
    await this.game.assets.preload([...all(K), ...all(T)]);
    this.art = K; this.time = T;
  }

  /** CLOCK (type 2) on a stage: the stage timer. */
  clock(secs) { this.total = secs; this.end = performance.now() + secs * 1000; this.cleared = false; }
  /** PYRAMID_GAUGE. */
  gauge(n) { this.earned = n; }
  /** PYRAMID_SCORE: the rank (0 S .. 4 D) and the EXP gained. */
  score(rank, exp) { this.result = { rank, exp, until: performance.now() + RESULT_MS, backgrd2: this.art ? new Anim(this.art.Result.backgrd2) : null }; this.load(); }

  /** Seconds left on the stage timer. */
  left() { return this.end ? Math.max(0, Math.trunc((this.end - performance.now()) / 1000)) : 0; }

  update(dt) {
    const t = this.type();
    if (t !== STAGE && t !== RESULT) return;
    this.load();
    if (!this.art) return;
    const ms = dt * 1000;
    if (t === RESULT) {
      if (this.result && !this.result.backgrd2) this.result.backgrd2 = new Anim(this.art.Result.backgrd2);
      this.result?.backgrd2?.update(ms);
      if (this.result && performance.now() > this.result.until) this.result = null;
      return;
    }
    for (const a of Object.values(this.danger)) a.update(ms);
    // the key panel opens when a skill point comes, loops while there is one, and closes when it is gone
    const { noSkill } = this.massacre(), skill = this.game.massacre?.skill || 0;
    if (!noSkill && skill !== this.skillSeen) {
      if (this.skillSeen === 0 && skill > 0) this.keyState = 0;
      else if (skill === 0 && this.skillSeen > 0) this.keyState = 2;
      this.skillSeen = skill;
    }
    this.updateKeys(ms);
    // under 2 seconds left: killing/clear on screen, once
    if (this.end && !this.cleared && this.left() < 2) { this.cleared = true; this.game.vfx.screen('killing/clear'); }
  }

  updateKeys(ms) {
    const K = this.art.Count.keyBackgrd;
    for (const a of [this.keyOpen, this.keyIng, this.keyClose]) a?.update(ms);
    if (this.keyState === -1) { if (this.keyClose?.done) this.keyClose = null; }
    else if (this.keyState === 0) { this.keyClose = null; this.keyOpen = new Anim(K.open, false); this.keyState = 1; }
    else if (this.keyState === 1) {
      if (this.keyOpen?.done && (!this.keyIng || this.keyIng.done)) { this.keyOpen = null; this.keyIng = new Anim(K.ing, false); }
    } else if (this.keyState === 2) {
      if (this.keyIng && !this.keyIng.done) return;
      this.keyOpen = null; this.keyIng = null; this.keyClose = new Anim(K.close, false); this.keyState = -1;
    }
  }

  draw(ctx) {
    const t = this.type();
    if (!this.art || (t !== STAGE && t !== RESULT)) return;
    const im = (n) => this.game.assets.image(n);
    const put = (node, x, y) => { const i = node && im(node); if (i) ctx.drawImage(i, x - (node.origin?.[0] || 0), y - (node.origin?.[1] || 0)); };
    if (t === RESULT) { this.drawResult(ctx, im, put); return; }
    const K = this.art, C = K.Count, G = K.Gauge, m = this.game.massacre || {}, { noSkill, total, decrease } = this.massacre();
    // the count panel at (1, 21): hits, cool hits, misses; the skill count when the map allows it
    put(noSkill ? C.backgrd0 : C.backgrd1, 1, 21);
    drawNumber(ctx, im, C.number, 1 + 57, 21 + 11, m.hit || 0, 5, 12);
    drawNumber(ctx, im, C.number, 1 + 57, 21 + 33, m.cool || 0, 5, 12);
    drawNumber(ctx, im, C.number, 1 + 57, 21 + 55, m.miss || 0, 5, 12);
    if (!noSkill) drawNumber(ctx, im, C.number2, 1 + 80, 21 + 85, Math.max(0, m.skill || 0), 1, 17);
    // the gauge: time passed times the decrease, less what was earned back
    if (total > 0) {
      const v = this.end ? (this.total - this.left()) * decrease - this.earned : 0;
      const w = Math.trunc((Math.min(Math.max(v, 0), total) * GAUGE_W) / total), danger = (v * 100) / total > DANGER_PCT;
      put(G.backgrd, 251, 64);
      if (danger) put(this.danger.back.node, 251, 64);
      const px = im(G.pixel);
      if (px && w > 0) ctx.drawImage(px, GAUGE_END - w, 71, w, px.height);
      if (danger) { put(this.danger.text.node, 251, 64); put(this.danger.icon.node, 222, 63); put(this.danger.bar.node, DANGER_END - w, 85); }
      else put(G.text, 251, 64);
    }
    for (const a of [this.keyOpen, this.keyIng, this.keyClose]) if (a && !a.done) put(a.node, 7, 135);
    // the stage timer: minutes and seconds in two digits each
    if (this.end) {
      const T = this.time, x0 = 304, y0 = 5, s = this.left();
      put(T.backgrnd, x0, y0);
      const text = (x, n) => { let cx = x0 + x; for (const ch of String(n).padStart(2, '0')) { const g = T.fontTime[ch], i = g && im(g); if (i) { ctx.drawImage(i, cx, y0 + 13); cx += i.width; } } };
      text(20, Math.trunc(s / 60));
      text(105, s % 60);
    }
  }

  /** The result: the counts and their share of all three, the EXP gained (with its + sign), and the rank. */
  drawResult(ctx, im, put) {
    const r = this.result;
    if (!r) return;
    const R = this.art.Result, m = this.game.massacre || {}, x0 = 207, y0 = 158;
    const hit = m.hit || 0, cool = m.cool || 0, miss = m.miss || 0, all = hit + cool + miss || 1;
    put(R.backgrd, x0, y0);
    const rows = [[hit, 63], [cool, 87], [miss, 111]];
    for (const [n, y] of rows) {
      drawNumber(ctx, im, R.number, x0 + 218, y0 + y, n, 5, 12);
      drawNumber(ctx, im, R.number, x0 + 265, y0 + y, Math.trunc((n * 100) / all), 5, 12);
    }
    drawNumber(ctx, im, R.number2, x0 + 258, y0 + 168, r.exp, 7, 15);
    put(r.backgrd2?.node, 233, 247);
    put(R.Rank[RANKS[r.rank]], 233, 247);
  }
}
