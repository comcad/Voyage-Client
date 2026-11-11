/**
 * Event fields: the map types that run a game of their own on top of the usual field (info/fieldType).
 *
 * Snowball (fieldType 1), from the map's `snowBall` node:
 * - Two lanes (0 and 1), each with its snowball and its snowman, at the lane's `y`.
 * - A snowball stands at x0 + dx x its position (xMin..xMax), its middle 81 above y, turned 4 degrees per position.
 *   Its hit box is 40 wide (x +-20) from 161 above y to 4 below.
 * - A snowman stands at `x` on y, with its hit box 60 wide and 100 tall over it. Its HP bar (52x10) hangs at its feet.
 * - Everything runs on the field's 30ms tick:
 *   - Standing in a snowball's box (one still there, and you not stunned) asks the server to throw you back
 *     (LEFT_KNOCKBACK).
 *   - Standing in a snowman's box hurts you for 30-40, thrown 270 right and 270 up.
 *   - Struck balls and snowmen show their damage (or MISS) once its delay is up, with the Snail's Damage sound.
 *   - While the game is on (state 1), each snowball rolls towards where the server last put it.
 * - SNOWBALL_STATE: the state (1 playing; 2 / 3: snowball 0 / 1 fades away), both snowmen's HP (out of 100), and
 *   each snowball's position and speed.
 *   - In play, a snowball rolls there: 3 steps owed per position, a step every `speed` ms (8: every 500ms while it
 *     owes any). Rolling the way it owes goes faster, and the other way slower.
 *   - Otherwise (and on the first one), it is put there at once.
 *   - The first one also carries the damage your blows send: a snowball's, then a snowman's (usual, and 1 in 10).
 * - HIT_SNOWBALL: what was struck (0 / 1 a snowball, 2 / 3 a snowman), for how much, after how many ms.
 * - SNOWBALL_MESSAGE: the yellow chat line for a team ("story" for 0, "maple" for 1).
 * - The attack key swings your weapon there instead of the usual attack, and, while the game is on, a swing that
 *   reaches a snowball or a snowman tells the server (SNOWBALL): a snowman's blow misses 1 time in 5.
 *
 * Coconut Harvest (fieldType 4), from the map's `coconut` node:
 * - Its coconuts are the map objects named 000, 001... (countFalling + countBombing + countStopped of them).
 * - COCONUT_HIT: a coconut (all of them for -1) changes state once its delay is up: 0 hanging, 1 shaken, 2 broken,
 *   3 falling. Each state plays its own sound where the coconut is.
 * - COCONUT_SCORE: both teams' scores, on the board.
 * - The board's clock is the field's: CLOCK only sets the time it counts down to.
 * - The board (Map/Obj/etc.img/coconut/backgrnd) stands at (535, 8). Every 150ms (and on a new score) it shows:
 *   - the scores in fontScore (three digits, 4px apart) at (25, 37) and (150, 37);
 *   - once there is a clock, the time left in fontTime (MM:SS, 1px apart) at (60, 83).
 * - A player who arrives with a team (the spawn's last byte; -1 none) wears that team's cap and clothes for their
 *   gender (avatar/<team>/<gender>), and nothing else.
 * - The attack key swings at the coconuts instead of the usual attack (each one's box from its current frame's
 *   lt / rb). A swing that reaches one tells the server which one (COCONUT), and when it lands.
 *
 * Ariant Coliseum (fieldType 13; its lobbies are ordinary maps):
 * - ARIANT_ARENA_USER_SCORE: each player's name and score.
 *   - A negative score takes them off; scores stop at 9999.
 *   - A GM job (x8x / x9x) sees only their own row.
 *   - A newcomer gets AriantMatch/characterIcon/<their place in the list>.
 *   - The list is kept sorted by score, highest first (ties keep their order).
 * - The score board (300x300, at the screen's top-left):
 *   - one row per player, 17px apart from y 2;
 *   - the icon at x 5, the name at x 21 and the score ("%4d") at x 106;
 *   - bold 12px Arial in #2000FF.
 * - ARIANT_ARENA_SHOW_RESULT:
 *   - The board goes, the Result scroll unrolls once at (400, 100), with Sound/UI.img/ScrollOpen.
 *   - Once it is open, the ranking fades in over 1s, 26px apart from y 104 on the scroll:
 *     - rank at x 63 (players who tie share the lower place);
 *     - the name centred on 140, the score centred on 235;
 *     - 12px Arial in black.
 *
 * Monster Carnival (fieldType 10, and 15; 11 is its waiting room), from the map's `monsterCarnival` node:
 * - Its lists: mob (name from String/Mob.img, spendCP), skill and guardian (name, desc, spendCP from
 *   Skill/MCSkill.img / MCGuardian.img).
 * - MONSTER_CARNIVAL_START: your team, then your CP, your team's and the other's (available, earned). The first one
 *   makes the Carnival window (ui/carnival.js) with the three lists; a byte per monster gives its summons so far.
 *   In the waiting room only the team is read.
 * - OBTAINED_CP / PARTY_CP: the numbers.
 * - SUMMON: "[who] has summoned a being. [what]" (a skill: "has used a skill."; a guardian: "has summoned the
 *   being."); a monster goes on the Summon List.
 * - MESSAGE (why it was refused), DIED, LEAVE: grey lines (LEAVE in pink), as is the result.
 * - Your answer back (MESSAGE, or your own SUMMON) lets the window ask again.
 * - Each player's team ("Maple Red" for 0, "Maple Blue" for 1) takes their guild line's place in their tags.
 */
import { frames, nodeAt } from './assets.js';
import { sfx } from './audio.js';
import { CHAT_COLOR } from './ui/statusbar.js';
import { UI_W } from './view.js';
import { uiText } from './ui/wzui.js';
import { CarnivalWin, TEAM_NAMES } from './ui/carnival.js';

const TICK = 30;
const STUN = 123;
// ms per step for each speed the server gives; 8 stands still (a step every 500ms while it owes any), 9 rolls back
const SNOW_SPEED = [150, 200, 250, 300, 350, 400, 450, 500, 0, -500], SNOW_STEP = 500;
const BALL = { half: 20, top: 161, bottom: 4, mid: 81, turn: 4 };
const MAN = { half: 30, h: 100 };
const BAR = { w: 52, h: 10, fill: 46 };
const SNOW_HIT_SOUND = 'Mob/0100100/Damage';
const TEAM = (t) => (t ? 'maple' : 'story');

const inRect = (r, x, y) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
const offset = (r, dx) => ({ ...r, left: r.left + dx, right: r.right + dx });

/** The event this map runs (by its fieldType), loaded; null for an ordinary map. */
export async function loadFieldMode(game, map) {
  const type = Number(map?.info?.fieldType) || 0;
  let mode = null;
  if (type === 1 && map.data?.snowBall) mode = new SnowballField(game, map.data.snowBall);
  else if (type === 4 && map.data?.coconut) mode = new CoconutField(game, map, map.data.coconut);
  else if (type === 13) mode = new AriantField(game);
  else if (type === 10 || type === 15) mode = new CarnivalField(game, map.data?.monsterCarnival || {});
  else if (type === 11) mode = new CarnivalWaitField(game);
  if (mode) await mode.load();
  return mode;
}

/** Plays a list of frames once from the start (or holds its first frame), for a snowman's flinch. */
class OnceAnim {
  constructor(list) { this.frames = list; this.t = null; }
  get playing() { return this.t !== null; }
  start() { this.t = 0; }
  update(ms) {
    if (this.t === null) return;
    this.t += ms;
    const total = this.frames.reduce((s, f) => s + (Number(f.delay) || 100), 0);
    if (this.t >= total) this.t = null;   // back on its first frame
  }
  get node() {
    if (this.t === null) return this.frames[0];
    let r = this.t, i = 0;
    while (i < this.frames.length - 1 && r >= (Number(this.frames[i].delay) || 100)) r -= Number(this.frames[i++].delay) || 100;
    return this.frames[i];
  }
}

export class SnowballField {
  constructor(game, node) {
    this.game = game; this.node = node;
    this.dx = Number(node.dx) || 0; this.xMin = Number(node.xMin) || 0; this.xMax = Number(node.xMax) || 0;
    const x0 = Number(node.x0) || 0, mx = Number(node.x) || 0;
    this.balls = [0, 1].map((i) => {
      const y = Number(node[i]?.y) || 0;
      return { x0, y, pos: 0, owed: 0, speed: 8, acc: 0, fade: null,
        rect: { left: x0 - BALL.half, top: y - BALL.top, right: x0 + BALL.half, bottom: y + BALL.bottom } };
    });
    this.men = [0, 1].map((i) => {
      const y = Number(node[i]?.y) || 0;
      return { x: mx, y, hp: 0, barHp: 0, rect: { left: mx - MAN.half, top: y - MAN.h, right: mx + MAN.half, bottom: y } };
    });
    this.state = -1; this.damage = [0, 0, 0]; this.hits = []; this.acc = 0;
  }

  async load() {
    const a = this.game.assets, list = [];
    await Promise.all([0, 1].map(async (i) => {
      const ball = await nodeAt(a, this.node[i]?.snowBall), man = await nodeAt(a, this.node[i]?.snowMan);
      this.balls[i].frame = frames(ball)[0] || null;
      this.men[i].anim = new OnceAnim(frames(man));
      list.push(this.balls[i].frame, ...this.men[i].anim.frames);
    }));
    await a.preload(list.filter(Boolean));
  }

  // ---------------------------------------------------------------- packets
  /** SNOWBALL_STATE. extra: the blows' damage, read only from the first one. */
  snowState(state, hp0, hp1, balls, extra) {
    const first = this.state === -1;
    this.state = state;
    this.men[0].hp = hp0; this.men[1].hp = hp1;
    balls.forEach((b, i) => this.place(this.balls[i], b.pos, b.speed, first || state !== 1));
    if (state === 2) this.balls[0].fade ??= 0;
    else if (state === 3) this.balls[1].fade ??= 0;
    if (first && extra) this.damage = extra;
  }
  place(b, pos, speed, now) {
    if (pos < this.xMin || pos > this.xMax || !b.frame) return;
    if (!now) { b.owed = (pos - b.pos) * 3; b.speed = speed; return; }
    const d = pos - b.pos;
    b.owed = 0; b.acc = 0; b.pos = pos; b.speed = speed;
    this.roll(b, d);
  }
  /** HIT_SNOWBALL: shown once `delay` ms have passed. */
  snowHit(what, damage, delay) { this.hits.push({ what, damage, at: performance.now() + delay }); }
  /** SNOWBALL_MESSAGE. */
  snowMessage(team, msg) {
    let text = null;
    if (msg >= 1 && msg <= 3) text = `${TEAM(team)} Team's snowball has passed the ${msg} stage.`;
    else if (msg === 4) text = `${TEAM(!team)} Team is attacking the snowman, stopping the progress of ${TEAM(team)} Team's snowball.`;
    else if (msg === 5) text = `${TEAM(team)} Team's snowball is moving again.`;
    if (text) this.game.hud?.message(text, CHAT_COLOR.yellow);
  }

  // ---------------------------------------------------------------- the attack key
  /** Swings at the snowballs and snowmen; true when the key was used here (always, as long as you are about). */
  attack() {
    const g = this.game;
    if (!g.player || !g.net) return false;
    const r = g.fieldAttack([this.balls[0].rect, this.balls[1].rect, this.men[0].rect, this.men[1].rect]);
    if (r && r.hit >= 0 && this.state === 1) {
      let dmg;
      if (r.hit < 2) dmg = this.damage[0];
      else { const roll = Math.floor(Math.random() * 100); dmg = roll < 20 ? 0 : this.damage[roll > 89 ? 2 : 1]; }
      g.net.snowball(r.hit, dmg, r.delay);
    }
    return true;
  }

  // ---------------------------------------------------------------- the field's tick
  update(dt) {
    this.acc += dt * 1000;
    for (const m of this.men) m.anim?.update(dt * 1000);
    for (const b of this.balls) if (b.fade !== null) b.fade += dt * 1000;
    while (this.acc >= TICK) { this.acc -= TICK; this.tick(); }
  }
  tick() {
    const g = this.game, p = g.player;
    if (p && g.net && !g.dead) {
      const x = Math.round(p.x), y = Math.round(p.y);
      const i = this.balls.findIndex((b) => inRect(b.rect, x, y));
      if (i >= 0 && this.state !== i + 2 && !g.hasDisease(STUN)) g.net.leftKnockback();
      if (this.men.some((m) => inRect(m.rect, x, y)) && !(g.invincible > 0)) g.fieldHurt(30 + Math.floor(Math.random() * 11), 270, -270);
    }
    const now = performance.now();
    this.hits = this.hits.filter((h) => {
      if (now < h.at) return true;
      this.showHit(h);
      return false;
    });
    if (this.state === 1) for (const b of this.balls) this.rollOn(b);
  }
  showHit({ what, damage }) {
    const g = this.game;
    if (what < 0 || what > 3) return;
    const r = what < 2 ? this.balls[what].rect : this.men[what - 2].rect;
    if (what >= 2) {
      const m = this.men[what - 2];
      if (!m.anim.playing) m.anim.start();
      m.barHp = m.hp;
    }
    const x = Math.trunc((r.left + r.right) / 2), top = r.top;
    g.vfx?.damage({ x, y: top, box: () => ({ top }) }, [damage < 1 ? 0 : damage], 'red');
    sfx.play(SNOW_HIT_SOUND, { volume: g.volumeAt(x, top) });
  }
  /** One tick of a snowball rolling towards the position it owes steps to. */
  rollOn(b) {
    const T0 = SNOW_SPEED[b.speed];
    if (T0 === undefined) return;   // a speed past the client's list never gets anywhere
    const dir = b.owed === 0 ? 0 : b.owed > 0 ? 1 : -1;
    let step;
    if (T0 === 0) {
      const to = b.pos + dir;
      if (!dir || to < this.xMin || to > this.xMax) { b.acc = 0; return; }
      b.acc += TICK;
      if (b.acc < SNOW_STEP) return;
      b.pos = to; b.owed = Math.max(0, b.owed - dir * 3); b.acc -= SNOW_STEP; step = dir;
    } else {
      step = T0 < 0 ? -1 : 1;
      const to = b.pos + step;
      if (to < this.xMin || to > this.xMax) { b.acc = 0; return; }
      const T = Math.trunc(((3 - step * dir) * Math.abs(T0)) / 3);
      b.acc += TICK;
      if (b.acc < T) return;
      b.owed = Math.max(0, b.owed - dir); b.pos = to; b.acc -= T;
    }
    this.roll(b, step);
  }
  /** Moves a snowball's box n positions (its picture follows its position). */
  roll(b, n) { b.rect = offset(b.rect, this.dx * n); }

  // ---------------------------------------------------------------- drawing
  /** The snowballs and snowmen, just behind map page 3. */
  drawWorld(ctx, cam) {
    const im = (n) => this.game.assets.image(n);
    for (const m of this.men) {
      const f = m.anim?.node, img = im(f);
      if (img) { const o = f.origin || [0, 0]; ctx.drawImage(img, Math.round(m.x - o[0] - cam.x), Math.round(m.y - o[1] - cam.y)); }
    }
    for (const b of this.balls) {
      const f = b.frame, img = im(f);
      if (!img) continue;
      // fading away: the frame's alpha from a0 to a1 over its delay, then gone
      let alpha = 1;
      if (b.fade !== null) {
        const a0 = f.a0 ?? 255, a1 = f.a1 ?? a0, k = Math.min(1, b.fade / (Number(f.delay) || 100));
        alpha = (a0 + (a1 - a0) * k) / 255;
        if (alpha <= 0) continue;
      }
      const o = f.origin || [0, 0];
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(Math.round(b.x0 + this.dx * b.pos - cam.x), Math.round(b.y - BALL.mid - cam.y));
      ctx.rotate(((BALL.turn * b.pos) * Math.PI) / 180);
      ctx.drawImage(img, -o[0], -o[1]);
      ctx.restore();
    }
  }
  /**
   * The snowmen's HP bars, over the whole field: black, white, black, then the red (its bottom row darker) across
   * 46px x HP / 100 (all of it at 0 HP). It shows the HP from the last blow.
   */
  drawOver(ctx, cam) {
    for (const m of this.men) {
      const x = Math.round(m.x - MAN.half - cam.x), y = Math.round(m.y - cam.y);
      const w = m.barHp < 1 ? BAR.fill : Math.trunc((m.barHp * BAR.fill) / 100);
      ctx.fillStyle = '#000000'; ctx.fillRect(x, y, BAR.w, BAR.h);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x + 1, y + 1, 50, 8);
      ctx.fillStyle = '#000000'; ctx.fillRect(x + 2, y + 2, 48, 6);
      ctx.fillStyle = '#FF0000'; ctx.fillRect(x + 3, y + 3, w, 4);
      ctx.fillStyle = '#A00300'; ctx.fillRect(x + 3, y + 6, w, 1);
    }
  }
}

const BOARD = { right: 265, y: 8, score: [[25, 37], [150, 37]], scoreGap: 4, time: [60, 83], timeGap: 1, every: 150 };

export class CoconutField {
  constructor(game, map, node) {
    this.game = game; this.map = map; this.node = node;
    this.count = (Number(node.countFalling) || 0) + (Number(node.countBombing) || 0) + (Number(node.countStopped) || 0);
    this.score = [0, 0]; this.end = 0; this.hits = []; this.shown = null; this.shownAt = -Infinity;
  }
  async load() {
    const a = this.game.assets;
    const C = await nodeAt(a, 'Map/Obj/etc.img/coconut');
    this.art = C;
    await a.preload([C?.backgrnd, ...frames(C?.fontScore), C?.fontScore?.[':'], ...frames(C?.fontTime), C?.fontTime?.[':']].filter(Boolean));
  }
  name(i) { return String(i).padStart(3, '0'); }

  // ---------------------------------------------------------------- packets
  /** COCONUT_HIT: coconut `id` (all of them for a negative id) goes to `state` after `delay` ms. */
  coconutHit(id, delay, state) {
    const at = performance.now() + delay;
    if (id < 0) for (let i = 0; i < this.count; i++) this.hits.push({ id: i, state, at });
    else this.hits.push({ id, state, at });
  }
  coconutScore(a, b) { this.score = [a, b]; this.refresh(); }
  /** CLOCK, on this field: the board counts down to it instead of the usual clock. */
  clock(secs) { this.end = performance.now() + secs * 1000; }
  /** Another player's equipment while here: their team's cap and clothes, or null to keep their own. */
  teamLook(gender, team) {
    if (team === undefined || team === null || team === -1) return null;
    const a = this.node.avatar?.[team ? 1 : 0]?.[gender ? 1 : 0];
    return a ? [a.cap, a.clothes, a.shoes].map(Number).filter(Boolean) : null;
  }

  // ---------------------------------------------------------------- the attack key
  /** A coconut's box: its current frame's lt / rb where it stands (none while it shows nothing or has no box). */
  box(i) {
    const o = this.map.namedObjs?.get(this.name(i)), f = o?.active && o.visible ? o.anim?.node : null;
    if (!f?.lt || !f?.rb) return { left: 0, top: 0, right: 0, bottom: 0 };
    const [l, t] = f.lt, [r, b] = f.rb;
    return o.f ? { left: o.x - r, top: o.y + t, right: o.x - l, bottom: o.y + b } : { left: o.x + l, top: o.y + t, right: o.x + r, bottom: o.y + b };
  }
  attack() {
    const g = this.game;
    if (!g.player || !g.net) return false;
    const rects = Array.from({ length: this.count }, (_, i) => this.box(i));
    const r = g.fieldAttack(rects);
    if (r && r.hit >= 0) g.net.coconut(r.hit, r.delay);
    return true;
  }

  // ---------------------------------------------------------------- tick and board
  update() {
    const now = performance.now();
    if (now - this.shownAt > BOARD.every) this.refresh();
    if (!this.hits.length) return;
    this.hits = this.hits.filter((h) => {
      if (h.at > now) return true;
      this.game.setObjectState(this.name(h.id), h.state);
      return false;
    });
  }
  /** What the board shows: the scores and, once there is a clock, the time left. */
  refresh() {
    const now = performance.now();
    this.shownAt = now;
    let time = null;
    if (this.end) { const s = Math.max(0, Math.trunc((this.end - now) / 1000)); time = `${String(Math.trunc(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
    this.shown = { scores: this.score.map((n) => String(n).padStart(3, '0')), time };
  }
  /** Characters of a digit font from (x, y), `gap` apart; a character it has no art for takes its `space` (5). */
  text(ctx, font, str, x, y, gap) {
    for (const ch of str) {
      const f = font?.[ch], img = f && this.game.assets.image(f);
      if (!img) { x += (Number(font?.space) || 5) + gap; continue; }
      ctx.drawImage(img, x - (f.origin?.[0] || 0), y - (f.origin?.[1] || 0));
      x += img.width + gap;
    }
  }
  drawHud(ctx) {
    const C = this.art, bg = C && this.game.assets.image(C.backgrnd);
    if (!bg || !this.shown) return;
    const x = UI_W - BOARD.right, y = BOARD.y;
    ctx.drawImage(bg, x, y);
    this.shown.scores.forEach((s, i) => this.text(ctx, C.fontScore, s, x + BOARD.score[i][0], y + BOARD.score[i][1], BOARD.scoreGap));
    if (this.shown.time) this.text(ctx, C.fontTime, this.shown.time, x + BOARD.time[0], y + BOARD.time[1], BOARD.timeGap);
  }
}

const ARIANT = {
  board: { x: 0, y: 0, w: 300, h: 300, row0: 2, rowH: 17, icon: 5, name: 21, score: 106 },
  result: { x: 400, y: 100, frameMs: 100 },
  rank: { x: 63, name: 140, score: 235, row0: 104, rowH: 26, fade: 1000 },
  blue: '#2000FF', black: '#000000', max: 9999,
};

export class AriantField {
  constructor(game) { this.game = game; this.scores = []; this.board = true; this.result = null; this.ranking = null; }
  async load() {
    const a = this.game.assets;
    this.art = await nodeAt(a, 'UI/UIWindow.img/AriantMatch');
    this.resultFrames = frames(this.art?.Result);
    await a.preload([...frames(this.art?.characterIcon), ...this.resultFrames].filter(Boolean));
  }
  /** ARIANT_ARENA_USER_SCORE: [{ name, score }]. */
  ariantScores(list) {
    const g = this.game, me = g.player?.name, job = g.stats?.job || 0, gm = [8, 9].includes(Math.floor((job % 1000) / 100));
    for (const { name, score } of list) {
      if (!name) continue;
      if (gm && name !== me) continue;
      const i = this.scores.findIndex((e) => e.name === name);
      if (score < 0) { if (i >= 0) this.scores.splice(i, 1); continue; }
      const v = Math.min(score, ARIANT.max);
      if (i >= 0) this.scores[i].score = v;
      else { this.scores.push({ name, score: v, icon: null }); this.scores[this.scores.length - 1].icon = this.art?.characterIcon?.[this.scores.length - 1] || null; }
    }
    // highest first; equal scores keep their order
    for (let i = 1; i < this.scores.length; i++) {
      const t = this.scores[i]; let j = i;
      while (j > 0 && this.scores[j - 1].score < t.score) { this.scores[j] = this.scores[j - 1]; j--; }
      this.scores[j] = t;
    }
    this.board = true;   // a score after the result puts the board back up, as in the client
  }
  /** ARIANT_ARENA_SHOW_RESULT: the scroll unrolls and the board goes. */
  ariantResult() {
    this.result = { t0: performance.now() };
    this.ranking = null; this.board = false;
    sfx.play('UI/ScrollOpen');
  }
  update() {
    const r = this.result;
    if (!r || this.ranking) return;
    const total = this.resultFrames.reduce((n, f) => n + (Number(f.delay) || ARIANT.result.frameMs), 0);
    if (performance.now() - r.t0 >= total) this.ranking = { t0: performance.now(), rows: this.rankRows() };
  }
  /** The ranking as it stood when the scroll opened: a tie shares the place of its last member. */
  rankRows() {
    const s = this.scores;
    return s.map((e, i) => {
      let last = i;
      while (last + 1 < s.length && s[last + 1].score === e.score) last++;
      return { rank: last + 1, name: e.name, score: e.score };
    });
  }
  drawHud(ctx) {
    const im = (n) => this.game.assets.image(n), B = ARIANT.board;
    if (this.board && this.scores.length) {
      ctx.save(); ctx.beginPath(); ctx.rect(B.x, B.y, B.w, B.h); ctx.clip();
      this.scores.forEach((e, i) => {
        const y = B.y + B.row0 + i * B.rowH, ic = im(e.icon);
        if (ic) ctx.drawImage(ic, B.x + B.icon, y);
        uiText(ctx, e.name, B.x + B.name, y, { color: ARIANT.blue, bold: true });
        uiText(ctx, String(e.score).padStart(4, ' '), B.x + B.score, y, { color: ARIANT.blue, bold: true });
      });
      ctx.restore();
    }
    const r = this.result;
    if (!r) return;
    const fr = this.resultFrames;
    let t = performance.now() - r.t0, f = fr[fr.length - 1];
    for (const x of fr) { const d = Number(x.delay) || ARIANT.result.frameMs; if (t < d) { f = x; break; } t -= d; }
    const img = im(f);
    if (img) ctx.drawImage(img, ARIANT.result.x - (f.origin?.[0] || 0), ARIANT.result.y - (f.origin?.[1] || 0));
    if (!this.ranking) return;
    // the text sits on the open scroll's last frame, from its top-left
    const last = fr[fr.length - 1], ox = ARIANT.result.x - (last?.origin?.[0] || 0), oy = ARIANT.result.y - (last?.origin?.[1] || 0), R = ARIANT.rank;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (performance.now() - this.ranking.t0) / R.fade);
    this.ranking.rows.forEach((row, i) => {
      const y = oy + R.row0 + i * R.rowH;
      uiText(ctx, String(row.rank), ox + R.x, y, { color: ARIANT.black });
      uiText(ctx, row.name, ox + R.name, y, { color: ARIANT.black, align: 'center' });
      uiText(ctx, String(row.score), ox + R.score, y, { color: ARIANT.black, align: 'center' });
    });
    ctx.restore();
  }
}

const CARNIVAL_SUMMONED = ['[%s] has summoned a being. [%s]', '[%s] has used a skill. [%s]', '[%s] has summoned the being. [%s]'];
const CARNIVAL_REFUSED = { 1: "You don't have enough CP to continue.", 2: 'You can no longer summon the Monster.', 3: 'You can no longer summon the being.',
  4: 'This being is already summoned.', 5: '\t\tThis request has failed due to an unknown error.' };
const CARNIVAL_RESULT = {
  8: "\tYou have won the Monster Carnival. Please wait as you'll be transported out of here shortly.",
  9: "Unfortunately, you have lost the Monster Carnival. Please wait as you'll be transported out of here shortly.",
  10: "Despite the Overtime, the carnival ended in a draw. Please wait as you'll be transported out of here shortly.",
  11: "Monster Carnival has ended abruptly due to the opposing team leaving the game too early. Please wait as you'll be transported out of here shortly.",
};
const fill = (t, ...a) => a.reduce((s, v) => s.replace(/%[sd]/, v), t);   // each value into the next %s / %d

/** The waiting room (fieldType 11): MONSTER_CARNIVAL_START only gives your team; the result is said here too. */
class CarnivalWaitField {
  constructor(game) { this.game = game; }
  async load() {}
  carnivalStart(d) { this.game.setCarnivalTeam?.(d.team); }
  carnivalResult(code) { const t = CARNIVAL_RESULT[code]; if (t) this.game.hud?.message(t, CHAT_COLOR.error); }
}

export class CarnivalField extends CarnivalWaitField {
  constructor(game, node) { super(game); this.node = node; this.lists = [[], [], []]; this.win = null; }
  async load() {
    const a = this.game.assets, N = this.node;
    const [mobs, skills, guards] = await Promise.all([a.json('String/Mob.img'), a.json('Skill/MCSkill.img'), a.json('Skill/MCGuardian.img')]);
    for (let i = 0; N.mob?.[i]; i++) {
      const id = Number(N.mob[i].id);
      this.lists[0].push({ id, name: mobs?.[id]?.name || '', cp: Number(N.mob[i].spendCP) || 0, desc: '' });
    }
    for (let i = 0; N.skill?.[i] !== undefined; i++) { const s = skills?.[Number(N.skill[i])]; if (s) this.lists[1].push({ id: Number(N.skill[i]), name: s.name || '', cp: Number(s.spendCP) || 0, desc: s.desc || '' }); }
    for (let i = 0; N.guardian?.[i] !== undefined; i++) { const s = guards?.[Number(N.guardian[i])]; if (s) this.lists[2].push({ id: Number(N.guardian[i]), name: s.name || '', cp: Number(s.spendCP) || 0, desc: s.desc || '' }); }
  }
  leave() {
    const g = this.game;
    if (this.win) { if (this.win.side) g.windows.close(this.win.side); g.windows.close(this.win); g.carnivalSaved = { x: this.win.x, y: this.win.y, tab: this.win.tab }; }
    this.win = null;
  }
  /** MONSTER_CARNIVAL_START: { team, cp: [mine, total, team, total, other, total] | null, counts: [per monster] }. */
  async carnivalStart(d) {
    const g = this.game;
    super.carnivalStart(d);
    if (!this.win) {
      const w = new CarnivalWin(g.windows, g.carnivalSaved || {});
      await g.assets.preload(w.frames());
      this.win = g.windows.show(w, null);
      this.lists.forEach((list, t) => list.forEach((e, k) => w.addRow(t, { index: k + 1, name: e.name, cp: e.cp, desc: e.desc })));
    }
    const w = this.win;
    w.setMyTeam(d.team);
    if (d.cp) { w.setMine(d.cp[0], d.cp[1]); w.setTeam(d.team, d.cp[2], d.cp[3]); w.setTeam(d.team === 0 ? 1 : 0, d.cp[4], d.cp[5]); }
    (d.counts || []).slice(0, this.lists[0].length).forEach((n, k) => { if (n && this.lists[0][k].name) w.summoned(this.lists[0][k].name, n); });
  }
  carnivalCP(avail, total) { this.win?.setMine(avail, total); }
  carnivalPartyCP(team, avail, total) { this.win?.setTeam(team, avail, total); }
  carnivalSummon(tab, index, name) {
    const g = this.game, row = this.win?.rows[tab]?.[index];   // the row at that place in the tab's list
    if (row?.name) {
      g.hud?.message(fill(CARNIVAL_SUMMONED[tab] || CARNIVAL_SUMMONED[0], name, row.name), CHAT_COLOR.grey);
      if (tab === 0) this.win.summoned(row.name);
    }
    if (this.win && name === g.player?.name) this.win.answered();
  }
  carnivalMessage(code) {
    const t = CARNIVAL_REFUSED[code];
    if (t) this.game.hud?.message(t, CHAT_COLOR.grey);
    this.win?.answered();
  }
  carnivalDied(team, name, lost) {
    const tn = team === 0 ? TEAM_NAMES[0] : TEAM_NAMES[1];
    const t = lost ? fill('[%s] has become unable to fight and [%s]team has lost %d CP.', name, tn, lost)
      : fill('\t\t[%s] has become unable to fight but [%s] has no CP so [%s] team did not lose any CP', name, name, tn);
    this.game.hud?.message(t, CHAT_COLOR.grey);
  }
  carnivalLeave(code, team, name) {
    const tn = team ? TEAM_NAMES[1] : TEAM_NAMES[0];
    const t = code === 6 ? fill('Since the leader of the Team [%s] quit the Monster Carnival, [%s] has been appointed as the new leader of the team.', tn, name)
      : fill('[%s] of Team [%s] has quit the Monster Carnival.', tn, name);
    this.game.hud?.message(t, CHAT_COLOR.error);
  }
  key(k) { return this.win && this.game.windows.order.includes(this.win) ? this.win.key(k) : false; }
}
