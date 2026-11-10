/**
 * Foothold physics. Map footholds are line segments chained with prev/next ids.
 * Floors run left-to-right (x1 < x2); walls are vertical (x1 == x2); segments with
 * x1 > x2 are ceilings/undersides and are never landed on.
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
    ent.fh = f; ent.x = x; ent.y = Footholds.yAt(f, x);
    return 'ok';
  }

  /**
   * The wall that stops sideways movement for something at height y over floor f, as the client
   * does it: only the walls joined to that floor count (its neighbour, or the one after), each
   * blocking if it spans y-50..y-1; otherwise the map's side. So a floating platform's own sides
   * never block a jump from the ground beside it.
   */
  wallFor(f, left, y) {
    const blocks = (w) => w && w.x1 === w.x2 && Math.max(w.y1, w.y2) >= y - 50 && Math.min(w.y1, w.y2) <= y - 1;
    if (left) {
      const p = this.get(f.prev);
      if (blocks(p)) return f.x1;
      const pp = p && this.get(p.prev);
      if (blocks(pp)) return p.x1;
      return this.wallL;
    }
    const n = this.get(f.next);
    if (blocks(n)) return f.x2;
    const nn = n && this.get(n.next);
    if (blocks(nn)) return n.x2;
    return this.wallR;
  }

  /**
   * Airborne step (in water the speeds are already set: no gravity). Mutates ent.x/y/vx/vy/fh.
   * old: the speeds before this step's push (steering, swimming); without it, the speeds as they are now.
   */
  fall(ent, dt, ignore = null, swimming = false, old = null) {
    // moved by the average of the speed before and after the step's push and gravity, on both axes, so a jump peaks
    // at v²/2g whatever the frame time
    const vx0 = old ? old.vx : ent.vx, vy0 = old ? old.vy : ent.vy;
    if (!swimming) ent.vy = Math.min(ent.vy + PHYS.gravity * dt, PHYS.maxFall);
    const nx = ent.x + ((vx0 + ent.vx) / 2) * dt;
    const ny = ent.y + ((vy0 + ent.vy) / 2) * dt;

    // walls: those of the floor we are over
    const under = nx !== ent.x ? this.below(ent.x, ent.y, Infinity, ignore) : null;
    let walled = false;
    if (under) {
      const w = this.wallFor(under, nx < ent.x, ent.y);
      if ((nx < ent.x && ent.x >= w && nx < w) || (nx > ent.x && ent.x <= w && nx > w)) { ent.x = w; ent.vx = 0; walled = true; }
    }
    const x = walled ? ent.x : nx;

    // land on the first floor the step's path crosses from above (rising or falling: a slope can rise faster than
    // you do), wherever along the floor that is
    const x0 = ent.x, y0 = ent.y;
    let land = null, first = Infinity;
    for (const f of this.floors) {
      if (f === ignore || Math.max(x0, x) < f.x1 || Math.min(x0, x) > f.x2) continue;
      const d0 = y0 - Footholds.yAt(f, x0), d1 = ny - Footholds.yAt(f, x);   // height above (-) or below (+) its line
      if (d0 > 1 || d1 < 0 || (d0 >= 0 && d1 <= d0)) continue;
      const t = d0 >= 0 ? 0 : d0 / (d0 - d1), cx = x0 + (x - x0) * t;
      if (cx < f.x1 || cx > f.x2 || t >= first) continue;
      first = t; land = { f, x: cx };
    }
    if (land) { ent.x = land.x; ent.y = Footholds.yAt(land.f, land.x); ent.vy = 0; ent.fh = land.f; return; }
    ent.x = x; ent.y = ny;
    if (ent.y < this.ceiling) { ent.y = this.ceiling; ent.vy = 0; }
  }
}
