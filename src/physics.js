/**
 * Foothold physics. Map footholds are line segments chained with prev/next ids.
 * Floors run left-to-right (x1 < x2); walls are vertical (x1 == x2); segments with
 * x1 > x2 are ceilings/undersides and are never landed on.
 *
 * A foothold has a front and a back: the front of a floor is above it, of a wall going up the left of it, of a
 * wall going down the right of it, of an underside below it. Things in the air are stopped coming at one from the
 * front and pass through it from the back (which is how you jump up through a floor).
 */
export const PHYS = {
  walk: 125, jump: 555, gravity: 2000, maxFall: 670, climb: 100,
  // Map.wz/Physics.img over the avatar's mass of 100 (openms, docs/physics-evidence.md): on the ground a held
  // direction pushes at walkForce/100 and letting go brakes at walkDrag/100; in the air a held direction
  // pushes at 2*floatDrag2/100 but only up to walkSpeed/walkForce*floatDrag2 (~9px/s), and letting go drags
  // at floatDrag2*floatCoefficient/100 - so a jump keeps the speed it left the ground with
  walkAccel: 1400, walkBrake: 800, airAccel: 200, airLimit: (125 / 140000) * 10000, airDrag: 1,
  // in water (Physics.img swimForce / swimSpeed / floatDrag1 over the mass of 100, swimSpeedDec)
  swimAccel: 1200, swimSpeed: 140, swimDrag: 1000, swimDec: 0.9,
};

/**
 * Off the ground in water: no gravity. Held left / right pushes up to the swim speed and letting go drags to a stop;
 * you sink to the swim speed, to 0.3 of it holding up and 1.5 of it holding down. `shoe` scales the push (acc) and
 * the top speed (speed).
 */
export function swimVelocity(ent, inX, inY, dt, shoe = { acc: 1, speed: 1 }) {
  const max = PHYS.swimSpeed * shoe.speed, a = PHYS.swimAccel * shoe.acc, drag = PHYS.swimDrag * dt;
  const over = (v) => (v > max ? Math.max(max, v - drag) : v < -max ? Math.min(-max, v + drag) : v);
  let vx = over(ent.vx || 0), vy = over(ent.vy || 0);
  vx = inX ? accelerate(vx, inX * a, max, dt) : approach(vx, 0, drag);
  if (inY < 0) { const t = max * 0.3; vy = vy > t ? Math.max(t, vy - a * dt) : Math.min(t, vy + a * dt * 0.5); }
  else if (inY > 0) vy = max * 1.5;
  else vy = accelerate(vy, a, max, dt);
  ent.vx = vx; ent.vy = vy;
}

/** Speed up toward the force's side of +-limit without passing it (the client's accelerate). */
export function accelerate(v, accel, limit, dt) {
  if (accel > 0 && v < limit) return Math.min(limit, v + accel * dt);
  if (accel < 0 && v > -limit) return Math.max(-limit, v + accel * dt);
  return v;
}
/** Brake toward a target without overshooting it. */
export function approach(v, target, amount) { return v > target ? Math.max(target, v - amount) : Math.min(target, v + amount); }

/** Which side of a foothold's line a point is on: below 0 in front of it, above 0 behind it, 0 on it. */
const sideOf = (f, x, y) => (f.x2 - f.x1) * (y - f.y1) - (f.y2 - f.y1) * (x - f.x1);
/**
 * A path that goes exactly through the corner where `a` ends and `b` begins has met them when where it ends up is
 * behind them: behind either one where they bend away from their front, behind both where they bend toward it.
 */
function cornered(a, b, x, y) {
  const turn = (b.y2 - a.y1) * (a.x2 - a.x1) - (a.y2 - a.y1) * (b.x2 - a.x1);
  return turn < 1 ? sideOf(a, x, y) > 0 || sideOf(b, x, y) > 0 : sideOf(a, x, y) > 0 && sideOf(b, x, y) > 0;
}

export class Footholds {
  constructor(mapFoothold) {
    this.byId = new Map();
    for (const [layer, groups] of Object.entries(mapFoothold || {})) {
      for (const [g, group] of Object.entries(groups)) {
        for (const [id, f] of Object.entries(group)) {
          this.byId.set(Number(id), { id: Number(id), layer: Number(layer), zMass: Number(g) || 0, group: `${layer}/${g}`, ...f });
        }
      }
    }
    this.all = [...this.byId.values()];
    // each one's length and the direction it runs in
    for (const f of this.all) { f.len = Math.hypot(f.x2 - f.x1, f.y2 - f.y1) || 1; f.ux = (f.x2 - f.x1) / f.len; f.uy = (f.y2 - f.y1) / f.len; }
    // the map's first group: its walls and undersides stop everything in the air (see meets)
    this.baseZ = this.all.reduce((m, f) => Math.min(m, f.zMass), Infinity);
    this.floors = this.all.filter((f) => f.x1 < f.x2);
    // the map's foothold groups (its platforms), each with its floors and how far it reaches left and right
    this.groups = new Map();
    for (const f of this.floors) {
      const g = this.groups.get(f.group) || { floors: [], x1: Infinity, x2: -Infinity };
      g.floors.push(f); g.x1 = Math.min(g.x1, f.x1); g.x2 = Math.max(g.x2, f.x2);
      this.groups.set(f.group, g);
    }
    this.walls = this.all.filter((f) => f.x1 === f.x2);
    const xs = this.all.flatMap((f) => [f.x1, f.x2]);
    const ys = this.all.flatMap((f) => [f.y1, f.y2]);
    this.left = Math.min(...xs); this.right = Math.max(...xs);
    this.top = Math.min(...ys); this.bottom = Math.max(...ys);
    this.ceiling = Number.isFinite(this.top) ? this.top - 300 : -Infinity;   // nothing in the air goes higher
    // the side walls: the outermost foothold ends, 30px in (a map with info/VRLimit narrows them, see Map)
    this.wallL = this.left + 30; this.wallR = this.right - 30;
    this.ground = Number.isFinite(this.bottom) ? this.bottom + 10 : Infinity;   // nothing in the air goes lower
  }
  /**
   * The footholds by group id (the group under the layer, whatever the layer; walls and undersides too), in load
   * order, with how far each group reaches left and right: where a flyer picks its spots.
   */
  flyGroups() {
    if (this._fly) return this._fly;
    const ids = [], range = new Map(), list = new Map();
    for (const f of this.all) {
      const g = f.zMass;
      if (!list.has(g)) { ids.push(g); list.set(g, []); range.set(g, [Infinity, -Infinity]); }
      list.get(g).push(f);
      const r = range.get(g); r[0] = Math.min(r[0], f.x1, f.x2); r[1] = Math.max(r[1], f.x1, f.x2);
    }
    return (this._fly = { ids, range, list });
  }

  get(id) { return this.byId.get(id); }

  /** Whether x,y is in water (the map sets this). */
  swimming() { return false; }
  static yAt(f, x) { return f.x1 === f.x2 ? f.y1 : f.y1 + ((f.y2 - f.y1) * (x - f.x1)) / (f.x2 - f.x1); }

  /** Floor directly below (or at) x,y within maxDrop pixels. */
  below(x, y, maxDrop = Infinity, ignore = null) {
    let best = null, bestY = Infinity;
    for (const f of this.floors) {
      if (f === ignore || x < f.x1 || x > f.x2) continue;
      const fy = Footholds.yAt(f, x);
      if (fy >= y - 1 && fy < bestY && fy - y <= maxDrop) { best = f; bestY = fy; }
    }
    return best;
  }

  /**
   * Move an entity standing on `ent.fh` horizontally by dx along the foothold chain.
   * Returns 'ok', 'wall' (blocked, x clamped) or 'edge' (walked off; ent.fh = null).
   * A vertical neighbour is a wall only if it rises above this floor's end (it then leads up to a
   * higher floor); one that drops away below it is a ledge you walk off. Going right the wall
   * starts at our end (rising = y2 < y1); going left it ends at our start (rising = y1 < y2).
   * A neighbour that doubles back underneath (an underside, x1 > x2) is a ledge too.
   */
  walk(ent, dx) {
    let f = ent.fh;
    let x = ent.x + dx;
    ent.zMass = f.zMass;
    for (let guard = 0; guard < 32; guard++) {
      if (x > f.x2) {
        const n = this.get(f.next);
        if (!n) { ent.x = x; ent.fh = null; return 'edge'; }
        if (n.x1 === n.x2) {
          if (n.y2 < n.y1) { ent.x = f.x2; ent.y = f.y2; return 'wall'; }
          ent.x = x; ent.fh = null; return 'edge';
        }
        if (n.x1 > n.x2) { ent.x = x; ent.fh = null; return 'edge'; }
        f = n;
      } else if (x < f.x1) {
        const p = this.get(f.prev);
        if (!p) { ent.x = x; ent.fh = null; return 'edge'; }
        if (p.x1 === p.x2) {
          if (p.y1 < p.y2) { ent.x = f.x1; ent.y = f.y1; return 'wall'; }
          ent.x = x; ent.fh = null; return 'edge';
        }
        if (p.x1 > p.x2) { ent.x = x; ent.fh = null; return 'edge'; }
        f = p;
      } else break;
    }
    ent.fh = f; ent.x = x; ent.y = Footholds.yAt(f, x); ent.zMass = f.zMass;
    return 'ok';
  }

  /**
   * What a step through the air from (ax, ay) to (bx, by) meets first: { f, x, y }, the foothold and where on it;
   * null when the way is clear. Positions count in whole pixels, as the footholds do.
   *
   * A foothold is met by a path that comes at it from its front and crosses it, its ends included. Floors are met
   * by everything. A wall or an underside is met only by what last stood on a floor of its own group, and those of
   * the map's first group by everything: so a platform's own sides don't stop a jump from the ground beside it, and
   * the ground's own walls stop everyone. A path through the very corner where two footholds join has met them only
   * if it ends up behind them (cornered); through a free end, it hasn't.
   *
   * Of two met at the same moment (a corner), it comes to rest against the one it is moving along, by its speed
   * (vx, vy) along each. `ignore` is a floor being dropped through: when that is what is met first, nothing is.
   */
  meets(ax, ay, bx, by, vx, vy, zMass, ignore = null) {
    const x0 = Math.floor(ax), y0 = Math.floor(ay), x1 = Math.floor(bx), y1 = Math.floor(by), dx = x1 - x0, dy = y1 - y0;
    if (!dx && !dy) return null;
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    let num = 2, den = 1, first = null, second = null, hitX = 0, hitY = 0;
    for (const f of this.all) {
      if ((f.x1 < lx && f.x2 < lx) || (f.x1 > hx && f.x2 > hx) || (f.y1 < ly && f.y2 < ly) || (f.y1 > hy && f.y2 > hy)) continue;
      const fdx = f.x2 - f.x1, fdy = f.y2 - f.y1;
      if (fdx <= 0 && f.zMass !== this.baseZ && f.zMass !== zMass) continue;
      // from in front of it (or on it) to behind it (or on it), and not along it
      let s0 = fdx * (y0 - f.y1) - fdy * (x0 - f.x1);
      const s1 = fdx * (y1 - f.y1) - fdy * (x1 - f.x1);
      // (whole pixels can put the start behind a steep foothold it is really in front of, a hop up a steep slope:
      // then it starts on it, rather than going through)
      if (s0 > 0 && fdx * (ay - f.y1) - fdy * (ax - f.x1) <= 0) s0 = 0;
      if (s0 > 0 || s1 < 0 || (s0 === 0 && s1 === 0)) continue;
      // and between its two ends (one on either side of the path, or on it)
      const c0 = (f.y1 - y0) * dx - (f.x1 - x0) * dy, c1 = (f.y2 - y0) * dx - (f.x2 - x0) * dy;
      if ((c0 < 0 && c1 < 0) || (c0 > 0 && c1 > 0)) continue;
      let a = f, b = f;   // the later and the earlier of the two at a corner
      if (c0 === 0) { const p = this.get(f.prev); if (!p || !cornered(p, f, x1, y1)) continue; b = p; }
      else if (c1 === 0) { const n = this.get(f.next); if (!n || !cornered(f, n, x1, y1)) continue; a = n; }
      // how far along the path: |s0| of the way, out of |f x d|; the nearest wins
      const n = Math.abs(s0), d = Math.abs(fdy * dx - fdx * dy);
      if (d * num > n * den) {
        num = n; den = d; first = a; second = b;
        hitX = Math.trunc(((f.x2 * f.y1 - f.y2 * f.x1) * dx + (y1 * x0 - x1 * y0) * fdx) / (fdx * dy - fdy * dx));
        hitY = dx === 0 ? ((hitX - f.x1) * fdy) / fdx + f.y1 : ((hitX - x0) * dy) / dx + y0;
      } else if (first && d * num === n * den) {
        // as near as the nearest: the one in front of the other
        if ((first.x2 - first.x1) * (a.y1 - first.y1) - (a.x1 - first.x1) * (first.y2 - first.y1) < 0) first = a;
        if ((second.x2 - second.x1) * (b.y2 - second.y1) - (b.x2 - second.x1) * (second.y2 - second.y1) < 0) second = b;
      }
    }
    if (!first) return null;
    let f = first;
    if (first !== second) {
      const va = first.ux * vx + first.uy * vy, vb = second.ux * vx + second.uy * vy;
      if (!(va > 0.001 && vb > 0.001)) f = (va >= -0.001 || vb >= -0.001) && first.x1 < first.x2 ? first : second;
    }
    if (f === ignore) return null;
    // where on it: by height on a steep one, across otherwise; never past its ends
    const at = Math.min(f.len, Math.max(0, Math.abs(f.ux) <= 0.5 ? (hitY - f.y1) / f.uy : (hitX - f.x1) / f.ux));
    return { f, x: f.x1 + f.ux * at, y: f.y1 + f.uy * at };
  }

  /**
   * Airborne step (in water the speeds are already set: no gravity). Mutates ent.x/y/vx/vy/fh.
   * old: the speeds before this step's push (steering, swimming); without it, the speeds as they are now.
   * ent.zMass is the group of the floor it last stood on (walk and landing keep it), for meets.
   */
  fall(ent, dt, ignore = null, swimming = false, old = null) {
    // moved by the average of the speed before and after the step's push and gravity, on both axes, so a jump peaks
    // at v²/2g whatever the frame time
    const vx0 = old ? old.vx : ent.vx, vy0 = old ? old.vy : ent.vy;
    if (!swimming) ent.vy = Math.min(ent.vy + PHYS.gravity * dt, PHYS.maxFall);
    let x0 = ent.x, y0 = ent.y, nx = ent.x + ((vx0 + ent.vx) / 2) * dt, ny = ent.y + ((vy0 + ent.vy) / 2) * dt;
    // the map's sides are walls for what is inside them
    if (x0 >= this.wallL && nx < this.wallL) { nx = this.wallL; ent.vx = 0; }
    else if (x0 <= this.wallR && nx > this.wallR) { nx = this.wallR; ent.vx = 0; }
    // a floor is landed on where the path meets it. A wall or an underside stops the path there and leaves only the
    // speed along it; the rest of the step then goes on along it (down a wall's face, across under an underside),
    // where it may meet something else: the floor at the wall's foot, the wall at the underside's end.
    for (let pass = 0; pass < 3; pass++) {
      const hit = this.meets(x0, y0, nx, ny, (vx0 + ent.vx) / 2, (vy0 + ent.vy) / 2, ent.zMass, ignore);
      if (!hit) break;
      const f = hit.f;
      if (f.x1 < f.x2) { ent.x = hit.x; ent.y = hit.y; ent.vy = 0; ent.fh = f; ent.zMass = f.zMass; return; }
      const along = f.ux * ent.vx + f.uy * ent.vy;
      ent.vx = f.ux * along; ent.vy = f.uy * along;
      x0 = hit.x; y0 = hit.y;
      if (f.x1 === f.x2) nx = hit.x; else { ny = hit.y; if (Math.abs(f.uy) > 0.001) nx = hit.x; }
    }
    ent.x = nx; ent.y = ny;
    if (ent.y < this.ceiling) { ent.y = this.ceiling; ent.vy = 0; }
  }
}
