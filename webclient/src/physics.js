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
};

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
      for (const group of Object.values(groups)) {
        for (const [id, f] of Object.entries(group)) {
          this.byId.set(Number(id), { id: Number(id), layer: Number(layer), ...f });
        }
      }
    }
    this.all = [...this.byId.values()];
    this.floors = this.all.filter((f) => f.x1 < f.x2);
    this.walls = this.all.filter((f) => f.x1 === f.x2);
    const xs = this.all.flatMap((f) => [f.x1, f.x2]);
    const ys = this.all.flatMap((f) => [f.y1, f.y2]);
    this.left = Math.min(...xs); this.right = Math.max(...xs);
    this.top = Math.min(...ys); this.bottom = Math.max(...ys);
  }

  get(id) { return this.byId.get(id); }
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
      return this.left + 25;
    }
    const n = this.get(f.next);
    if (blocks(n)) return f.x2;
    const nn = n && this.get(n.next);
    if (blocks(nn)) return n.x2;
    return this.right - 25;
  }

  /** Airborne step. Mutates ent.x/y/vx/vy/fh. */
  fall(ent, dt, ignore = null) {
    ent.vy = Math.min(ent.vy + PHYS.gravity * dt, PHYS.maxFall);
    const nx = ent.x + ent.vx * dt;
    const ny = ent.y + ent.vy * dt;

    // walls: those of the floor we are over
    const under = ent.vx ? this.below(ent.x, ent.y, Infinity, ignore) : null;
    if (under) {
      const w = this.wallFor(under, ent.vx < 0, ent.y);
      if ((ent.vx < 0 && ent.x >= w && nx < w) || (ent.vx > 0 && ent.x <= w && nx > w)) { ent.x = w; ent.vx = 0; }
    }
    const x = ent.x + ent.vx * dt;

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
  }
}
