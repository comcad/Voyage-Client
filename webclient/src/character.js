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

export class CharacterLook {
  constructor(assets, { skin = 0, face = 20000, hair = 30030, equips = [] } = {}) {
    this.assets = assets;
    this.skin = skin; this.faceId = face; this.hairId = hair; this.equipIds = equips;
    this.equips = [];
  }

  async load() {
    const a = this.assets;
    [this.body, this.head, this.face, this.hair] = await Promise.all([
      a.json(`Character/${pad(2000 + this.skin, 8)}.img`),
      a.json(`Character/${pad(12000 + this.skin, 8)}.img`),
      a.json(`Character/Face/${pad(this.faceId, 8)}.img`),
      a.json(`Character/Hair/${pad(this.hairId, 8)}.img`),
    ]);
    const eq = await Promise.all(this.equipIds.map((id) => equipPath(id) && a.json(equipPath(id))));
    this.equips = eq.filter(Boolean);
    // which of them are face / eye accessories (101 / 102): drawn by expression rather than by action
    this.faceAcc = new Set(eq.map((n, i) => n && [101, 102].includes(Math.floor(this.equipIds[i] / 10000)) ? n : null).filter(Boolean));
    this.weapon = this.equips.find((e, i) => Math.floor(this.equipIds[i] / 10000) >= 130);
    this.hasCap = this.equipIds.some((id) => Math.floor(id / 10000) === 100);
  }

  has(action) { return !!this.body?.[action]?.[0]; }
  /** Body actions in WZ order; the index is the action id used in attack packets. */
  actionList() { return (this._actions ??= Object.keys(this.body || {}).filter((k) => k !== 'info')); }
  frameCount(action) { return frames(this.body?.[action]).length; }
  delay(action, frame) { return Math.abs(this.body?.[action]?.[frame]?.delay ?? 180) || 180; }

  /** Attack animation for the equipped weapon (weapon.img/info/attack -> body action). */
  attackAction() {
    const options = ['swingO1', 'swingO2', 'swingO3', 'stabO1'].filter((a) => this.has(a) && (!this.weapon || this.weapon[a]));
    return options[Math.floor(Math.random() * options.length)] || 'swingO1';
  }
  standAction() { return this.weapon?.stand2 && !this.weapon?.stand1 ? 'stand2' : 'stand1'; }
  walkAction() { return this.weapon?.walk2 && !this.weapon?.walk1 ? 'walk2' : 'walk1'; }

  /**
   * Returns [{node, x, y, z}] in local coordinates (feet at 0,0, facing left).
   * expr = { name, frame }: a Face.img expression (smile, cry, blink...) in place of its default.
   */
  compose(action, frame, expr = null) {
    let bf = this.body?.[action]?.[frame];
    if (!bf) return [];
    const back = BACK_ACTIONS.has(action);
    const parts = [];
    const add = (container, filter) => {
      if (!container) return;
      for (const [name, v] of Object.entries(container)) {
        if (isCanvas(v) && (!filter || filter(v, name))) parts.push(v);
      }
    };

    add(bf);
    add(this.head?.[action]?.[frame] ?? (back ? this.head?.back : this.head?.front));
    if (bf.face !== 0 && !back) {
      const ex = expr && this.face?.[expr.name], node = ex?.[expr.frame] ?? (ex && Object.values(ex).some(isCanvas) ? ex : null);
      add(node || this.face?.default);
    }
    const hairFrame = this.hair?.[action]?.[frame] ?? this.hair?.default;
    add(hairFrame, (v) => {
      const z = v.z || '';
      if (z === 'hairShade') return false;
      if (back) return z.startsWith('back') && (this.hasCap ? z.includes('BelowCap') : !z.includes('BelowCap'));
      return !z.startsWith('back') && (!this.hasCap || z !== 'hairOverHead');
    });
    for (const eq of this.equips) {
      let node = eq[action]?.[frame];
      // a face / eye accessory follows the face: its art for the expression (smile, cry...) or its default;
      // like the face it isn't drawn from behind (on a ladder / rope)
      if (!node && this.faceAcc?.has(eq) && !back && bf.face !== 0) {
        const ex = expr && eq[expr.name];
        node = ex?.[expr.frame] ?? (ex && Object.values(ex).some(isCanvas) ? ex : null) ?? eq.default;
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
    return out.sort((a, b) => b.z - a.z);
  }
}

export function drawParts(ctx, assets, parts, x, y, facingRight, alpha = 1) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (facingRight) ctx.scale(-1, 1);
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
