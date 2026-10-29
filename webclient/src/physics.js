/**
 * Foothold physics. Map footholds are line segments chained with prev/next ids.
 * Floors run left-to-right (x1 < x2); walls are vertical (x1 == x2); segments with
 * x1 > x2 are ceilings/undersides and are never landed on.
 */
export const PHYS = {
  walk: 125, jump: 555, gravity: 2000, maxFall: 670, climb: 100, airControl: 0.6,
};

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

    if (ent.vy > 0) {
      for (const f of this.floors) {
        if (f === ignore || x < f.x1 || x > f.x2) continue;
        const fy = Footholds.yAt(f, x);
        if (ent.y <= fy + 1 && ny >= fy) { ent.x = x; ent.y = fy; ent.vy = 0; ent.fh = f; return; }
      }
    }
    ent.x = x; ent.y = ny;
  }
}
