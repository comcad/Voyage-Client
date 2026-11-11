/**
 * Playing someone else's movement path as the client does. A path (MOVE_MONSTER, MOVE_PLAYER) is a list of elements,
 * each where the mover ended up, how fast it was then moving (px/s), its pose, its floor and how long it took. They
 * queue behind what is still playing and play on a 30ms clock: within an element the mover is on the cubic Hermite
 * curve through the element before and this one, each with its speed, so a jump arcs as it did for the one jumping.
 * It is drawn between the last two ticks of that clock.
 */

/** Round half away from zero, as the client rounds a drawn position. */
export const roundAway = (v) => (v >= 0 ? Math.trunc(v + 0.5) : Math.trunc(v - 0.499999999));

/**
 * A path's elements as playback keys: where each ends, its speed (px/s), pose, floor and time. A jump's or a blow's
 * element (no position of its own) keeps the point before with its speed; equip changes and the like are left out.
 */
export function pathKeys(moves, from) {
  const keys = [];
  let px = from.x, py = from.y;
  for (const m of moves) {
    if (m.cmd === 10 || m.cmd === 14 || m.cmd === 21) continue;
    const abs = m.x !== undefined;
    const k = { type: m.cmd, x: abs ? m.x : px, y: abs ? m.y : py, vx: (abs ? m.vx : m.rx) || 0, vy: (abs ? m.vy : m.ry) || 0, stance: m.stance, fh: m.fh || 0, dur: Math.max(0, m.duration || 0) };
    keys.push(k); px = k.x; py = k.y;
  }
  return keys;
}

/**
 * Where the mover is `t` ms into key e, having left (b.x0, b.y0) at (b.vx0, b.vy0): the cubic Hermite curve through
 * the two points with their speeds (the speeds in px/s, so scaled by the time in seconds).
 */
export function hermite(b, e, t) {
  const s = t / e.dur, s2 = s * s, D = t * 0.001;
  const h00 = 2 * s2 * s - 3 * s2 + 1, h01 = 3 * s2 - 2 * s2 * s, h10 = (s2 - 2 * s + 1) * D, h11 = (s2 - s) * D;
  return { x: h00 * b.x0 + h01 * e.x + h10 * b.vx0 + h11 * e.vx, y: h00 * b.y0 + h01 * e.y + h10 * b.vy0 + h11 * e.vy };
}

/**
 * A character's path (MOVE_PLAYER). With under 550ms queued it plays at 30ms a tick, from there at 33 (catching up);
 * with over 5550ms queued it is dropped for a jump to the last key. (A character's path counts in half seconds, the
 * half second its owner sends one in; a monster's in whole ones: 1100 and 6100, see Life.)
 */
const CATCH_UP = 550, TOO_FAR = CATCH_UP + 5000;
export class CharPath {
  constructor(x, y) { this.reset(x, y); }
  /** Standing at (x, y), nothing to play. */
  reset(x, y) {
    this.q = []; this.t = 0; this.total = 0; this.rate = 30;
    this.cur = { x, y, vx: 0, vy: 0 }; this.prev = { x, y };
    this.x0 = x; this.y0 = y; this.vx0 = 0; this.vy0 = 0;
    this.acc = this.acc || 0;
  }
  get playing() { return this.q.length > 0; }
  /** A path, after whatever is still to play (it starts from the last key queued, or from where it is now). */
  queue(moves) {
    const keys = pathKeys(moves, this.q[this.q.length - 1] || this.cur);
    if (!keys.length) return;
    this.q.push(...keys);
    this.total += keys.reduce((s, k) => s + k.dur, 0);
    this.rate = this.total < CATCH_UP ? 30 : 33;
    if (this.total > TOO_FAR) { const last = this.q[this.q.length - 1]; this.q = [{ ...last, type: 3, dur: 0 }]; this.total = 0; }
  }
  /**
   * One 30ms tick. Keys whose time is up are passed (each sets where it is, its speed and, through `pose`, its pose
   * and floor); within the next one it is on the curve (a teleport key, 3, puts it there at once).
   */
  tick(pose) {
    this.prev = { x: this.cur.x, y: this.cur.y };
    if (!this.q.length) return;
    this.t += this.rate;
    let jumped = false;
    while (this.q.length) {
      const e = this.q[0];
      if (this.t < e.dur) break;
      this.t -= e.dur;
      this.x0 = e.x; this.y0 = e.y; this.vx0 = e.vx; this.vy0 = e.vy;
      this.cur = { x: e.x, y: e.y, vx: e.vx, vy: e.vy };
      if (e.type === 3) jumped = true;
      pose(e);
      this.q.shift();
    }
    this.total -= this.rate;
    if (this.q.length && this.total > 0) {
      const e = this.q[0];
      if (e.type === 3) { this.cur = { x: e.x, y: e.y, vx: e.vx, vy: e.vy }; jumped = true; }
      else {
        const n = hermite(this, e, this.t);
        this.cur = { x: n.x, y: n.y, vx: (n.x - this.cur.x) * (1000 / 30), vy: (n.y - this.cur.y) * (1000 / 30) };
      }
      pose(e);
    } else { this.q = []; this.t = 0; this.total = 0; }
    if (jumped) this.prev = { x: this.cur.x, y: this.cur.y };   // no gliding across a teleport
  }
  /**
   * Plays dt seconds on the 30ms clock, a tick ahead of the screen, and returns where to draw: between the last two
   * ticks, rounded half away from zero.
   */
  play(dt, pose) {
    this.acc += dt * 1000;
    while (this.acc > 0) { this.acc -= 30; this.tick(pose); }
    const k = -this.acc / 30;
    return { x: roundAway(this.cur.x + (this.prev.x - this.cur.x) * k), y: roundAway(this.cur.y + (this.prev.y - this.cur.y) * k) };
  }
}
