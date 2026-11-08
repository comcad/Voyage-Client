/**
 * An Evan's dragon (SPAWN_DRAGON / MOVE_DRAGON), kept per owner: where it stands, which way it faces and the move
 * action it is in. SPAWN_DRAGON reads x and y as ints, then the action byte and a short that goes unused;
 * MOVE_DRAGON is the owner, the start point and an ordinary move list. REMOVE_DRAGON is ignored, so a dragon goes with
 * its owner or the map. Its art (Skill/Dragon/<n>.img) isn't in the v83 data, so nothing is drawn.
 */
export class Dragon {
  constructor(d) {
    this.owner = d.owner; this.x = d.x; this.y = d.y;
    this.stance = d.stance; this.facingRight = !(d.stance & 1);
  }
  /** A move list from the server: it ends where its last step ends, facing as that step's stance says. */
  move(start, moves) {
    if (start) { this.x = start.x; this.y = start.y; }
    for (const m of moves || []) {
      if (m.x !== undefined) { this.x = m.x; this.y = m.y; }
      if (m.stance !== undefined) { this.stance = m.stance; this.facingRight = !(m.stance & 1); }
    }
  }
}
