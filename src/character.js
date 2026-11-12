import { pad, isCanvas, frames } from './assets.js';
import { snapPx } from './view.js';

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
  const dir = cat >= 130 && cat <= 170 ? 'Weapon' : EQUIP_DIRS[cat];
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

/**
 * A ghost's body pose for each avatar pose (anything else stands; the dead stay dead), and the plain pose its head,
 * face, hair and the headgear left on take for each ghost pose.
 */
const GHOST_POSE = { walk1: 'ghostwalk', walk2: 'ghostwalk', jump: 'ghostjump', prone: 'ghostproneStab', proneStab: 'ghostproneStab', fly: 'ghostfly', ladder: 'ghostladder', rope: 'ghostrope', sit: 'ghostsit' };
const GHOST_PLAIN = { ghostwalk: 'walk1', ghoststand: 'stand1', ghostjump: 'jump', ghostproneStab: 'proneStab', ghostfly: 'fly', ghostladder: 'ladder', ghostrope: 'rope', ghostsit: 'sit' };

export class CharacterLook {
  constructor(assets, { skin = 0, face = 20000, hair = 30030, equips = [], gender = null } = {}) {
    this.assets = assets; this.gender = gender;
    this.skin = skin; this.faceId = face; this.hairId = hair; this.equipIds = equips;
    this.equips = [];
  }

  async load() {
    const a = this.assets;
    this.loaded = false; this.composed = null;
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
    const load = (id) => equipPath(id) && a.json(equipPath(id));
    const ids = [...this.equipIds], medal = ids.find((id) => Math.floor(id / 10000) === 114) || 0;
    const [eq, medalInfo] = await Promise.all([Promise.all(ids.map(load)), medal && a.json(`Character/Accessory/${pad(medal, 8)}.img`)]);
    // the medal worn, and its tag art (UI/NameTag.img/medal/<medalTag>)
    this.medal = medal; this.medalTag = Number(medalInfo?.info?.medalTag) || 0;
    // the top and pants shown: an overall over pants hides them, unless the overall is a normal one and the pants
    // are cash - then the pants show with the undershirt; nothing on top / bottom shows the Blue-Striped Undershirt /
    // Boxers (when the gender is known)
    const k = (id) => Math.floor(id / 10000), cash = (i) => Number(eq[i]?.info?.cash) === 1;
    let ti = ids.findIndex((id) => k(id) === 104 || k(id) === 105), bi = ids.findIndex((id) => k(id) === 106);
    let needTop = ti < 0;
    if (ti >= 0 && bi >= 0 && k(ids[ti]) === 105) {
      const drop = cash(ti) || !cash(bi) ? bi : ti;
      if (drop === ti) needTop = true;
      ids.splice(drop, 1); eq.splice(drop, 1);
      ti = ids.findIndex((id) => k(id) === 104 || k(id) === 105); bi = ids.findIndex((id) => k(id) === 106);
    }
    const g = this.gender, add = [];
    if (g === 0 || g === 1) {
      if (needTop) add.push(g ? 1041046 : 1040036);
      if (bi < 0 && !(ti >= 0 && k(ids[ti]) === 105)) add.push(g ? 1061039 : 1060026);
    }
    ids.push(...add); eq.push(...(await Promise.all(add.map(load))));
    this.shownIds = ids;
    const cat = (i) => Math.floor(ids[i] / 10000);
    const wi = eq.findIndex((n, i) => n && cat(i) >= 130 && cat(i) < 170), ci = eq.findIndex((n, i) => n && cat(i) === 170);
    this.weapon = eq[wi];
    // a cash weapon (170) is drawn in the weapon's place, with its art for that kind of weapon (its 30, 33, 47... node);
    // with no art for it, neither is drawn
    const drawn = [...eq];
    if (ci >= 0 && wi >= 0) { drawn[ci] = null; drawn[wi] = eq[ci][cat(wi) % 100] || null; }
    else if (ci >= 0) {   // no weapon under it: the first kind of weapon it has art for
      drawn[ci] = null;
      const k = Object.keys(eq[ci] || {}).find((x) => /^\d+$/.test(x));
      if (k) { drawn[ci] = eq[ci][k]; this.weapon = eq[ci][k]; }
    }
    this.equips = drawn.filter(Boolean);
    // what a rider doesn't show: the weapon (and a cash weapon over it) and the shield (body parts 10 and 11 on a mount)
    this.handNodes = new Set([drawn[wi], ci >= 0 ? drawn[ci] : null, eq[ids.findIndex((id) => Math.floor(id / 10000) === 109)]].filter(Boolean));
    // which of them are face / eye accessories (101 / 102): drawn by expression rather than by action
    this.faceAcc = new Set(eq.map((n, i) => n && [101, 102].includes(cat(i)) ? n : null).filter(Boolean));
    // what stays on a dead character: the headgear (cap, face / eye accessory, earrings); clothes and weapon come off
    this.deadKeep = new Set(eq.map((n, i) => n && [100, 101, 102, 103].includes(Math.floor(ids[i] / 10000)) ? n : null).filter(Boolean));
    // what a ghost keeps on: the cap, eye accessory and earrings (and its hair)
    this.ghostKeep = new Set(eq.map((n, i) => n && [100, 102, 103].includes(Math.floor(ids[i] / 10000)) ? n : null).filter(Boolean));
    this.hasCap = ids.some((id) => Math.floor(id / 10000) === 100);
    // a label / quote ring changes the name tag / chat balloon (the last ring with one wins); some equips (the effect
    // rings) carry an effect of their own
    this.nameTag = 0; this.chatBalloon = 0; this.equipFx = [];
    eq.forEach((n, i) => {
      const info = n?.info;
      if (!info) return;
      if (cat(i) === 111 && Number(info.nameTag)) this.nameTag = Number(info.nameTag);
      if (cat(i) === 111 && Number(info.chatBalloon)) this.chatBalloon = Number(info.chatBalloon);
      if (info.effect?.path && !this.equipFx.some((f) => f.id === ids[i])) this.equipFx.push({ id: ids[i], effect: info.effect });
    });
    // the face's expressions (blink, smile...) load in the background, last; until a frame is ready the default shows
    const exprs = [this.face, ...this.faceAcc].flatMap((n) => Object.entries(n || {}).filter(([k]) => k !== 'info')
      .flatMap(([, e]) => [e, ...Object.values(e || {})]).flatMap((f) => [f, ...Object.values(f || {})]));
    a.preload(exprs, null, 2);
    this.loaded = true;
  }

  /** An expression frame (the canvas, or the frame holding it) whose art has loaded. */
  exprReady(n) { return !!n && (isCanvas(n) ? !!this.assets.image(n) : Object.values(n).filter(isCanvas).every((c) => this.assets.image(c))); }
  /**
   * The body's frames for an avatar pose. A ghost (`ghost`: 1 the Ghost Candy's, 2 the spaceship) takes its ghost*
   * pose, the child named by its value.
   */
  bodyFrames(action) {
    if (!this.ghost || action === 'dead') return this.body?.[action];
    return this.body?.[GHOST_POSE[action] || 'ghoststand']?.[this.ghost];
  }
  has(action) { return !!this.bodyFrames(action)?.[0]; }
  /** Body actions in WZ order (attack packets number them by ACTIONS instead). */
  actionList() { return (this._actions ??= Object.keys(this.body || {}).filter((k) => k !== 'info')); }
  frameCount(action) { return frames(this.bodyFrames(action)).length; }
  /**
   * When an attack in this pose lands, in ms from its start (before attack speed): a pose made of frames that point at
   * other poses lands once its frames with a negative delay have played (at once if none); any other pose at the
   * start of its last frame.
   */
  attackDelay(action) {
    const fr = frames(this.bodyFrames(action));
    if (fr.some((f) => f?.action)) return fr.reduce((t, f) => t + (f.delay < 0 ? -f.delay : 0), 0);
    let t = 0; for (let i = 0; i < fr.length - 1; i++) t += this.delay(action, i);
    return t;
  }
  /** A frame's delay: a negative one counts as its length, a missing one is the client's 150ms. */
  delay(action, frame) { return Math.abs(this.bodyFrames(action)?.[frame]?.delay ?? 150) || 150; }
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
   * The same pose, frame, expression and ghost always give the same parts, and every character on screen asks for its
   * frame every frame, so each is worked out once and kept (512 at most, then they start over). Not kept: one asked
   * for before the look has loaded, or one that fell back to the default face while the expression's art loads.
   * What comes back is shared: read it, don't change it.
   */
  compose(action, frame, expr = null, mounted = false) {
    const key = `${this.ghost || 0}|${action}|${frame}|${expr ? `${expr.name}|${expr.frame}` : ''}|${mounted ? 1 : 0}`;
    const kept = this.composed?.get(key);
    if (kept) return kept;
    this.unready = false;
    const out = this.build(action, frame, expr, mounted);
    // an expression whose art is still loading shows the default face: the frame without one, which is kept
    if (expr && this.unready && this.loaded) return this.compose(action, frame, null, mounted);
    if (this.loaded && !this.unready) {
      if (!this.composed || this.composed.size >= 512) this.composed = new Map();
      this.composed.set(key, out);
      // kept and lasting: drawParts may draw it from one image. One with an expression lasts a blink, so no.
      if (!expr) out.still = true;
    }
    return out;
  }
  /** Works out a frame's parts (compose keeps them). */
  build(action, frame, expr, mounted) {
    // a ghost's body is its ghost pose; its head, face, hair and headgear take that pose's plain counterpart
    const ghost = this.ghost && action !== 'dead' ? GHOST_POSE[action] || 'ghoststand' : null;
    let bf = ghost ? this.body?.[ghost]?.[this.ghost]?.[frame] : this.body?.[action]?.[frame];
    if (!bf) return [];
    if (ghost) action = GHOST_PLAIN[ghost];
    // a frame that points at another pose's frame (alert2, shot, brandish1...) draws that one, turned clockwise about
    // the feet, maybe mirrored, then moved (drawParts does it)
    const ref = !ghost && bf.action && this.body[bf.action]?.[bf.frame] ? bf : null;
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
      const ready = this.exprReady(node);
      if (node && !ready) this.unready = true;   // the default face until the expression's art is in
      add(ready ? node : this.face?.default);
    }
    const hairFrame = this.hair?.[ha]?.[hf] ?? this.hair?.default;
    add(hairFrame, (v) => {
      const z = v.z || '';
      if (z === 'hairShade') return false;
      if (back) return z.startsWith('back') && (this.hasCap ? z.includes('BelowCap') : !z.includes('BelowCap'));
      return !z.startsWith('back') && (!this.hasCap || z !== 'hairOverHead');
    });
    for (const eq of this.equips) {
      if (mounted && this.handNodes?.has(eq)) continue;
      if (dead && !this.deadKeep?.has(eq)) continue;
      if (ghost && !this.ghostKeep?.has(eq)) continue;
      let node = eq[ha]?.[hf];
      // a face / eye accessory follows the face: its art for the expression (smile, cry...) or its default;
      // like the face it isn't drawn from behind (on a ladder / rope)
      if (!node && this.faceAcc?.has(eq) && !back && bf.face !== 0) {
        const ex = expr && eq[expr.name];
        node = ex?.[expr.frame] ?? (ex && Object.values(ex).some(isCanvas) ? ex : null);
        if (!this.exprReady(node)) { if (node) this.unready = true; node = eq.default; }
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
    out.brow = anchors.get('brow');
    out.navel = anchors.get('navel');
    out.muzzle = anchors.get('muzzle');   // a gun's barrel end
    return out;
  }
}

const MOUNT_BASIC = new Set(['walk1', 'walk2', 'stand1', 'stand2', 'tired', 'prone', 'fly', 'jump']);
const SKILL_MOUNT_CLIMBERS = new Set([1932003, 1932004, 1932005, 1932007, 1932008, 1932009, 1932010, 1932011]);

/**
 * The mount's own pose for its rider's action: alert counts as stand1; walk1/2,
 * stand1/2, tired, prone, fly and jump are kept; a mount item (190) also keeps ladder / rope; a skill mount (193)
 * keeps fireburner, coolingeffect, alert2, alert3, cannon and torpedo, ladder / rope only on 1932003-5 and 1932007-11,
 * float only on 1932001-2; anything else is stand1. A tired mount stands in its tired pose.
 */
export function mountPose(mountId, action, tired) {
  const kind = Math.floor(mountId / 10000), climb = action === 'ladder' || action === 'rope';
  if (action === 'alert') action = 'stand1';
  let keep = MOUNT_BASIC.has(action);
  if (!keep && kind === 190) keep = climb;
  if (!keep && kind === 193) {
    keep = ['fireburner', 'coolingeffect', 'alert2', 'alert3', 'cannon', 'torpedo'].includes(action)
      || (climb && SKILL_MOUNT_CLIMBERS.has(mountId)) || (action === 'float' && (mountId === 1932001 || mountId === 1932002));
  }
  const pose = keep ? action : 'stand1';
  return tired && (pose === 'stand1' || pose === 'stand2') ? 'tired' : pose;
}

/**
 * A rider on a mount: the mount's frame for its pose, then (a mount item, 190) the
 * saddle's and the mount equipment's art for that mount, pose and frame (Character/TamingMob/<saddle>.img/<mount>/...);
 * the rider sits (body pose sit) - on a ladder or rope they take the rope pose - without weapon or shield. Every part
 * hangs on the mount frame's navel and they all sort together by Base/zmap. The frame follows the mount's own delays;
 * ms is the time in this pose. gear: the saddle / mount equipment images (or null).
 */
export function composeMounted(look, mount, mountId, action, expr, ms, tired = false, gear = []) {
  const pose = mountPose(mountId, action, tired);
  const rider = look.compose(action === 'ladder' || action === 'rope' ? 'rope' : 'sit', 0, expr, true);
  const anim = frames(mount[pose] || mount.stand1);
  if (!anim.length) return rider;
  const total = anim.reduce((t, f) => t + (Number(f.delay) || 100), 0);
  let t = ms % total, index = 0;
  for (let i = 0; i < anim.length; i++) { const d = Number(anim[i].delay) || 100; if (t < d) { index = i; break; } t -= d; }
  const canvases = Object.values(anim[index]).filter(isCanvas);
  if (Math.floor(mountId / 10000) === 190) {
    for (const g of gear) {
      const gf = g?.[mountId]?.[mount[pose] ? pose : 'stand1']?.[index];
      if (gf) canvases.push(...Object.values(gf).filter(isCanvas));
    }
  }
  const ref = canvases.find((c) => c.map?.navel) || canvases[0];
  const navel = ref?.map?.navel || [0, 0];
  const out = [];
  for (const c of canvases) {
    const o = c.origin || [0, 0], n = c.map?.navel;
    const [px, py] = n ? [navel[0] - n[0], navel[1] - n[1]] : [0, 0];   // each part's navel on the same point
    out.push({ node: c, x: px - o[0], y: py - o[1], z: ZINDEX?.get(c.z) ?? 60 });
  }
  const rn = rider.navel || [0, 0], dx = navel[0] - rn[0], dy = navel[1] - rn[1];
  for (const p of rider) out.push({ ...p, x: p.x + dx, y: p.y + dy });
  out.sort((a, b) => b.z - a.z);
  out.brow = rider.brow && [rider.brow[0] + dx, rider.brow[1] + dy];
  out.navel = navel;
  out.pose = pose;
  return out;
}

/** Every canvas a mount can draw, for preloading. */
export function mountCanvases(mount) {
  // a mount is pose / frame / part; a saddle or mount equipment is mount id / pose / frame / part
  const out = [], walk = (n, depth) => {
    for (const [k, v] of Object.entries(n || {})) {
      if (k === 'info' || !v || typeof v !== 'object') continue;
      if (isCanvas(v)) out.push(v); else if (depth < 4) walk(v, depth + 1);
    }
  };
  walk(mount, 0);
  return out;
}

/**
 * whole: snap to the canvas's pixel grid (crisp: whole game pixels at scale 1, finer above it); false lets slow drifts
 * like a ghost's circle move freely.
 */
export function drawParts(ctx, assets, parts, x, y, facingRight, alpha = 1, whole = true) {
  ctx.save();
  ctx.translate(whole ? snapPx(x) : x, whole ? snapPx(y) : y);
  if (facingRight) ctx.scale(-1, 1);
  if (parts.move) ctx.translate(parts.move[0], parts.move[1]);
  if (parts.flip) ctx.scale(-1, 1);
  if (parts.rotate) ctx.rotate((parts.rotate * Math.PI) / 180);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  const sprite = charSprites && parts.still ? partsSprite(parts, assets) : null;
  if (sprite) ctx.drawImage(sprite.c, sprite.x, sprite.y);
  else {
    for (const p of parts) {
      const img = assets.image(p.node);
      if (img) ctx.drawImage(img, p.x, p.y);
    }
  }
  ctx.restore();
}

/**
 * A character's frame drawn from one image (a Voyage matter, for crowds): its parts, all loaded, put together once at
 * game resolution into a canvas of their own and drawn with one call instead of one a part (about 18). The game's
 * canvas draws game pixels as blocks (no smoothing), so the one image scaled up shows the same pixels. A see-through
 * character (Dark Sight, hidden) is see-through as a whole now rather than part over part. Up to SPRITE_PX pixels
 * are kept, the longest unused going first; they are made a few ms a frame at most (makeSprite), and a character
 * whose frame isn't made yet keeps its last one up meanwhile (Game.drawChar).
 */
export let charSprites = true;
const SPRITE_PX = 24e6, SPRITE_MS = 3;
const sprites = new Map();   // parts -> sprite, the longest unused first
let spritePx = 0, spent = 0;   // spent: ms gone on making frame images this frame
/** /fps sprites: drawn from one image a frame (on) or part by part. */
export function setCharSprites(on) {
  charSprites = !!on;
  if (!charSprites) { for (const k of sprites.keys()) delete k.sprite; sprites.clear(); spritePx = 0; }
}
/** A new frame on the screen: frame images may be made again. */
export function spriteFrame() { spent = 0; }
/** For /fps copy: how many frame images are kept, and their pixels. */
export function spriteStats() { return { on: charSprites, n: sprites.size, px: spritePx }; }
/**
 * Makes a kept frame's image if it can be made now. 'made': it is there. 'wait': this frame's time for making them
 * (SPRITE_MS: the first draw of each part costs, so they are rationed by time, not number) is used up; `force` makes
 * it anyway, as while a map loads and nothing is on screen. 'missing': some of its art hasn't loaded. 'no': not a
 * frame that is kept (an expression, a rider), too big, or /fps sprites is off.
 */
export function makeSprite(parts, assets, force = false) {
  if (!charSprites || !parts?.still) return 'no';
  if (parts.sprite) return 'made';
  if (!force && spent >= SPRITE_MS) return 'wait';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) {
    const img = assets.image(p.node);
    if (!img) return 'missing';
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + img.width); y1 = Math.max(y1, p.y + img.height);
  }
  const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0);
  if (!(w > 0 && h > 0) || w * h > 1e6) return 'no';
  const t0 = performance.now();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const o = c.getContext('2d');
  for (const p of parts) o.drawImage(assets.image(p.node), p.x - x0, p.y - y0);
  const s = { c, x: x0, y: y0, px: w * h };
  parts.sprite = s; sprites.set(parts, s); spritePx += s.px;
  while (spritePx > SPRITE_PX && sprites.size > 1) {
    const [k, v] = sprites.entries().next().value;
    sprites.delete(k); delete k.sprite; spritePx -= v.px;
  }
  spent += performance.now() - t0;
  return 'made';
}
function partsSprite(parts, assets) {
  const s = parts.sprite;
  if (s) { sprites.delete(parts); sprites.set(parts, s); return s; }   // (used: to the back of the queue to go)
  return makeSprite(parts, assets) === 'made' ? parts.sprite : null;
}

/** Every canvas this look can draw for the given actions, for preloading. */
export function lookCanvases(look, actions) {
  const out = [];
  for (const a of actions) {
    for (let f = 0; f < look.frameCount(a); f++) for (const p of look.compose(a, f)) out.push(p.node);
  }
  return out;
}
