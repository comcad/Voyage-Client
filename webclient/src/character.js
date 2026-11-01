import { pad, isCanvas, frames } from './assets.js';

/**
 * Character avatar assembly (body + head + face + hair + equips).
 *
 * Every part canvas has an `origin` and a `map` of named anchor points (navel, neck,
 * hand, brow, ...) relative to that origin. Body is placed at the root; every other
 * part is shifted so one of its anchors lands on the same anchor already placed.
 * Draw order comes from Base/zmap.img (first entry = front-most).
 */

const EQUIP_DIRS = {
  100: 'Cap', 101: 'Accessory', 102: 'Accessory', 103: 'Accessory', 104: 'Coat', 105: 'Longcoat',
  106: 'Pants', 107: 'Shoes', 108: 'Glove', 109: 'Shield', 110: 'Cape', 111: 'Ring',
};

export function equipPath(id) {
  const cat = Math.floor(id / 10000);
  const dir = cat >= 130 && cat < 170 ? 'Weapon' : EQUIP_DIRS[cat];
  return dir ? `Character/${dir}/${pad(id, 8)}.img` : null;
}

let ZINDEX = null;
export async function loadZmap(assets) {
  const z = await assets.json('Base/zmap.img');
  ZINDEX = new Map(Object.keys(z || {}).map((k, i) => [k, i]));
}

const BACK_ACTIONS = new Set(['ladder', 'rope']);

const PING_PONG = new Set(['stand1', 'stand2', 'alert']);

/**
 * Basic attack poses by weapon info/attack, one picked at random: 1 one-handed, 2 spear / polearm, 3 bow, 4 crossbow,
 * 5 two-handed, 6 wand / staff, 7 claw, 8 knuckle, 9 gun. A bow, crossbow, claw or gun swings like this at a monster
 * right in front of it (or with nothing to shoot), and otherwise shoots with its SHOOT_POSES.
 */
const ATTACK_POSES = {
  1: ['swingO1', 'swingO2', 'swingO3', 'stabO1', 'stabO2'],
  2: ['swingT2', 'swingP1', 'swingP2', 'stabT1', 'stabT2'],
  3: ['swingT1', 'swingT3'],
  4: ['swingT1', 'stabT1'],
  5: ['swingT1', 'swingT2', 'swingT3', 'stabO1', 'stabO2'],
  6: ['swingO2'],
  7: ['stabO1', 'stabO2'],
  8: ['stabO1', 'stabO2'],
  9: ['swingT1', 'swingT2', 'swingT2'],
};
const SHOOT_POSES = { 3: ['shoot1'], 4: ['shoot2'], 7: ['swingO1', 'swingO2', 'swingO3'], 9: ['shot'] };

export class CharacterLook {
  constructor(assets, { skin = 0, face = 20000, hair = 30030, equips = [] } = {}) {
    this.assets = assets;
    this.skin = skin; this.faceId = face; this.hairId = hair; this.equipIds = equips;
    this.equips = [];
  }

  async load() {
    const a = this.assets;
    let base;
    [this.body, this.head, this.face, this.hair, base] = await Promise.all([
      a.json(`Character/${pad(2000 + this.skin, 8)}.img`),
      a.json(`Character/${pad(12000 + this.skin, 8)}.img`),
      a.json(`Character/Face/${pad(this.faceId, 8)}.img`),
      a.json(`Character/Hair/${pad(this.hairId, 8)}.img`),
      this.skin ? a.json('Character/00002000.img') : null,
    ]);
    // only the first skin's body has the skill poses (alert2, somersault, brandish1...): frames pointing at the basic
    // poses, which every skin has, so another skin takes them from there and draws them in its own colour
    if (base && this.body) this.body = { ...base, ...this.body };
    const eq = await Promise.all(this.equipIds.map((id) => equipPath(id) && a.json(equipPath(id))));
    this.equips = eq.filter(Boolean);
    // which of them are face / eye accessories (101 / 102): drawn by expression rather than by action
    this.faceAcc = new Set(eq.map((n, i) => n && [101, 102].includes(Math.floor(this.equipIds[i] / 10000)) ? n : null).filter(Boolean));
    this.weapon = this.equips.find((e, i) => Math.floor(this.equipIds[i] / 10000) >= 130);
    // what stays on a dead character: the headgear (cap, face / eye accessory, earrings); clothes and weapon come off
    this.deadKeep = new Set(eq.map((n, i) => n && [100, 101, 102, 103].includes(Math.floor(this.equipIds[i] / 10000)) ? n : null).filter(Boolean));
    this.hasCap = this.equipIds.some((id) => Math.floor(id / 10000) === 100);
    // the face's expressions (blink, smile...) load in the background; until a frame is ready the default shows
    const exprs = [this.face, ...this.faceAcc].flatMap((n) => Object.entries(n || {}).filter(([k]) => k !== 'info')
      .flatMap(([, e]) => [e, ...Object.values(e || {})]).flatMap((f) => [f, ...Object.values(f || {})]));
    a.preload(exprs);
  }

  /** An expression frame (the canvas, or the frame holding it) whose art has loaded. */
  exprReady(n) { return !!n && (isCanvas(n) ? !!this.assets.image(n) : Object.values(n).filter(isCanvas).every((c) => this.assets.image(c))); }
  has(action) { return !!this.body?.[action]?.[0]; }
  /** Body actions in WZ order (attack packets number them by ACTIONS instead). */
  actionList() { return (this._actions ??= Object.keys(this.body || {}).filter((k) => k !== 'info')); }
  frameCount(action) { return frames(this.body?.[action]).length; }
  /**
   * When an attack in this pose lands, in ms from its start (before attack speed): a pose made of frames that point at
   * other poses lands once its frames with a negative delay have played (at once if none); any other pose at the
   * start of its last frame.
   */
  attackDelay(action) {
    const fr = frames(this.body?.[action]);
    if (fr.some((f) => f?.action)) return fr.reduce((t, f) => t + (f.delay < 0 ? -f.delay : 0), 0);
    let t = 0; for (let i = 0; i < fr.length - 1; i++) t += this.delay(action, i);
    return t;
  }
  /** A frame's delay: a negative one counts as its length, a missing one is the client's 150ms. */
  delay(action, frame) { return Math.abs(this.body?.[action]?.[frame]?.delay ?? 150) || 150; }
  /**
   * The frame after `frame`. The client plays stand1, stand2 and alert forward and back (0,1,2,1,0...), so standing
   * breathes smoothly; every other action loops. `back` is which way a back-and-forth one is going; `wrapped`
   * says it has come round to its first frame again.
   */
  nextFrame(action, frame, back) {
    const n = this.frameCount(action);
    if (!PING_PONG.has(action) || n < 3) { const f = frame + 1; return f >= n ? { frame: 0, back: false, wrapped: true } : { frame: f, back: false, wrapped: false }; }
    if ((back && frame > 0) || frame >= n - 1) { const f = Math.min(frame, n - 1) - 1; return { frame: f, back: f > 0, wrapped: f === 0 }; }
    const f = frame + 1;
    return { frame: f, back: f >= n - 1, wrapped: false };
  }

  /** Attack animation for the equipped weapon (weapon.img/info/attack -> body action). */
  attackAction() {
    const poses = ATTACK_POSES[this.weapon?.info?.attack] || ['swingO1', 'swingO2', 'swingO3', 'stabO1'];
    const options = poses.filter((a) => this.has(a) && (!this.weapon || this.weapon[a]));
    return options[Math.floor(Math.random() * options.length)] || 'swingO1';
  }
  /** Shooting pose for a bow, crossbow, claw or gun (null for anything else). */
  shootAction() {
    const options = (SHOOT_POSES[this.weapon?.info?.attack] || []).filter((a) => this.has(a));
    return options[Math.floor(Math.random() * options.length)] || null;
  }
  weaponId() { return this.equipIds.find((id) => id >= 1300000 && id < 1700000) || 0; }
  standAction() { return this.weapon?.stand2 && !this.weapon?.stand1 ? 'stand2' : 'stand1'; }
  walkAction() { return this.weapon?.walk2 && !this.weapon?.walk1 ? 'walk2' : 'walk1'; }

  /**
   * Returns [{node, x, y, z}] in local coordinates (feet at 0,0, facing left).
   * expr = { name, frame }: a Face.img expression (smile, cry, blink...) in place of its default.
   */
  compose(action, frame, expr = null) {
    let bf = this.body?.[action]?.[frame];
    if (!bf) return [];
    // a frame that points at another pose's frame (alert2, shot, brandish1...) draws that one, turned clockwise about
    // the feet, maybe mirrored, then moved (drawParts does it)
    const ref = bf.action && this.body[bf.action]?.[bf.frame] ? bf : null;
    if (ref) { action = ref.action; frame = ref.frame; bf = this.body[action][frame]; }
    const back = BACK_ACTIONS.has(action);
    const parts = [];
    const add = (container, filter) => {
      if (!container) return;
      for (const [name, v] of Object.entries(container)) {
        if (isCanvas(v) && (!filter || filter(v, name))) parts.push(v);
      }
    };

    add(bf);
    // dead: the body's own dead pose, with the head, hair and headgear of the jump pose (the client's composition)
    const dead = action === 'dead', ha = dead ? 'jump' : action, hf = dead ? 0 : frame;
    add(this.head?.[ha]?.[hf] ?? (back ? this.head?.back : this.head?.front));
    if (bf.face !== 0 && !back) {
      const ex = expr && this.face?.[expr.name], node = ex?.[expr.frame] ?? (ex && Object.values(ex).some(isCanvas) ? ex : null);
      add(this.exprReady(node) ? node : this.face?.default);
    }
    const hairFrame = this.hair?.[ha]?.[hf] ?? this.hair?.default;
    add(hairFrame, (v) => {
      const z = v.z || '';
      if (z === 'hairShade') return false;
      if (back) return z.startsWith('back') && (this.hasCap ? z.includes('BelowCap') : !z.includes('BelowCap'));
      return !z.startsWith('back') && (!this.hasCap || z !== 'hairOverHead');
    });
    for (const eq of this.equips) {
      if (dead && !this.deadKeep?.has(eq)) continue;
      let node = eq[ha]?.[hf];
      // a face / eye accessory follows the face: its art for the expression (smile, cry...) or its default;
      // like the face it isn't drawn from behind (on a ladder / rope)
      if (!node && this.faceAcc?.has(eq) && !back && bf.face !== 0) {
        const ex = expr && eq[expr.name];
        node = ex?.[expr.frame] ?? (ex && Object.values(ex).some(isCanvas) ? ex : null);
        if (!this.exprReady(node)) node = eq.default;
      }
      add(node);
    }

    // anchor placement
    const anchors = new Map();
    const placed = new Map();
    const place = (node, pos) => {
      placed.set(node, pos);
      for (const [k, v] of Object.entries(node.map || {})) {
        if (!anchors.has(k)) anchors.set(k, [pos[0] + v[0], pos[1] + v[1]]);
      }
    };
    const body = parts.find((p) => p.z === 'body' || p.z === 'backBody') || parts[0];
    place(body, [0, 0]);
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of parts) {
        if (placed.has(p)) continue;
        const map = p.map || {};
        const key = Object.keys(map).find((k) => anchors.has(k));
        if (!key && Object.keys(map).length) continue;
        const a = key ? anchors.get(key) : [0, 0];
        const m = key ? map[key] : [0, 0];
        place(p, [a[0] - m[0], a[1] - m[1]]);
        progress = true;
      }
    }

    const out = [];
    for (const [node, pos] of placed) {
      const o = node.origin || [0, 0];
      out.push({ node, x: pos[0] - o[0], y: pos[1] - o[1], z: ZINDEX?.get(node.z) ?? 60 });
    }
    // zmap lists front-most first, so draw highest index first
    out.sort((a, b) => b.z - a.z);
    if (ref?.flip) out.flip = true;
    if (ref?.move) out.move = [Number(ref.move[0]) || 0, Number(ref.move[1]) || 0];
    if (ref?.rotate) out.rotate = Number(ref.rotate) || 0;
    return out;
  }
}

/** whole: snap to whole game pixels (crisp); false lets slow drifts like a ghost's circle move smoothly. */
export function drawParts(ctx, assets, parts, x, y, facingRight, alpha = 1, whole = true) {
  ctx.save();
  ctx.translate(whole ? Math.round(x) : x, whole ? Math.round(y) : y);
  if (facingRight) ctx.scale(-1, 1);
  if (parts.move) ctx.translate(parts.move[0], parts.move[1]);
  if (parts.flip) ctx.scale(-1, 1);
  if (parts.rotate) ctx.rotate((parts.rotate * Math.PI) / 180);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  for (const p of parts) {
    const img = assets.image(p.node);
    if (img) ctx.drawImage(img, p.x, p.y);
  }
  ctx.restore();
}

/** Every canvas this look can draw for the given actions, for preloading. */
export function lookCanvases(look, actions) {
  const out = [];
  for (const a of actions) {
    for (let f = 0; f < look.frameCount(a); f++) for (const p of look.compose(a, f)) out.push(p.node);
  }
  return out;
}
