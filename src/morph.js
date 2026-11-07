import { pad } from './assets.js';

/**
 * Morphs (Morph/NNNN.img): a template is loaded only when the image has a jump or fly node at its root; info/speed
 * (default 100, held to 80-140), info/jump (100, at most 123), info/swim (100), info/morphEffect (1), info/superman
 * and info/hide. The superman morphs (Pirate / Thunder Breaker transformations, Eagle Eye) keep fighting; the others
 * (potions, cash morphs) can't attack or use skills; hide is the Oak Barrel (1002).
 */
const TEMPLATES = new Map(), LOADED = new Map();
export function morphTemplate(assets, id) {
  if (!id) return Promise.resolve(null);
  if (!TEMPLATES.has(id)) {
    TEMPLATES.set(id, assets.json(`Morph/${pad(id, 4)}.img`).then((img) => {
      if (!img) return null;
      const jump = !!img.jump, fly = !!img.fly;
      if (!jump && !fly) return null;
      const info = img.info || {}, num = (k, d) => (info[k] === undefined ? d : Number(info[k]));
      return {
        id, img, type: fly && !jump ? 1 : jump && !fly ? 0 : 2,
        speed: Math.min(140, Math.max(80, num('speed', 100))), jump: Math.min(123, num('jump', 100)),
        swim: num('swim', 100), fs: num('fs', 1), morphEffect: !!num('morphEffect', 1), superman: !!num('superman', 0), hide: !!num('hide', 0),
      };
    }).then((t) => { LOADED.set(id, t); return t; }));
  }
  return TEMPLATES.get(id);
}
/** The template once loaded (null while loading or for none). */
export const morphTemplateNow = (id) => LOADED.get(id) || null;
export const isSuperman = (t) => !!t?.superman;
export const isNormalMorph = (t) => !!t && !t.superman && !t.hide;
export const isHideMorph = (t) => !!t?.hide;

// a superman morph's attack actions: the character action -> the morph node of the same meaning
const SUPERMAN_ACTIONS = {
  swingT1: 'swingT1', swingT3: 'swingT3', stabO1: 'stabO1', stabO2: 'stabO2', shoot1: 'shoot1', shootF: 'shootF', proneStab: 'proneStab',
  alert2: 'alert2', alert3: 'alert3', alert4: 'alert4', alert5: 'alert', ladder2: 'ladder2', rope2: 'rope2',
  somersault: 'somersault', straight: 'straight', eburster: 'eburster', backspin: 'backspin', eorb: 'eorb', screw: 'screw',
  doubleupper: 'doubleupper', dragonstrike: 'dragonstrike', doublefire: 'doublefire', edrain: 'edrain', recovery: 'recovery',
  fist: 'fist', timeleap: 'timeleap', wave: 'wave', stormbreak: 'stormbreak', shockwave: 'shockwave', demolition: 'demolition',
  snatch: 'snatch', windspear: 'windspear', windshot: 'windshot',
};
/** A character's move state from its action name. */
function moveState(action) {
  const a = String(action || '');
  if (a.startsWith('walk')) return 'walk';
  if (a.startsWith('stand')) return 'stand';
  if (a === 'jump') return 'jump';
  if (a.startsWith('alert')) return a === 'alert' ? 'alert' : null;
  if (a === 'prone') return 'prone';
  if (a === 'fly' || a === 'swim') return 'fly';
  if (a === 'ladder' || a === 'rope' || a === 'dead' || a === 'sit') return a;
  return null;
}
/** The morph node shown for a character action: the move state (alert and sit stand for non-superman morphs), or for a superman morph its attack. */
export function morphAction(tpl, action, oneTime) {
  const st = moveState(action);
  if (st && !oneTime) return (st === 'alert' || st === 'sit') && !tpl.superman ? 'stand' : st;
  if (tpl.superman && SUPERMAN_ACTIONS[action]) return SUPERMAN_ACTIONS[action];
  return st ? ((st === 'alert' || st === 'sit') && !tpl.superman ? 'stand' : st) : null;
}
const framesOf = (node) => Object.keys(node || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => node[k]).filter((f) => f?._canvas);

/**
 * One character's morph frames: the node for its action steps every 30ms by each frame's delay (120 when unset; a
 * superman's non-walk frames scaled by the attack speed), a ladder or rope frame only while it climbs. An action the
 * morph has no frames for drops the morph from view (the character shows) until the next morph change.
 */
export class MorphView {
  constructor(tpl) { this.tpl = tpl; this.act = null; this.frame = 0; this.left = 0; this.acc = 0; this.dropped = false; }
  update(ent, action, oneTime, dt, scale = 1) {
    if (this.dropped) return;
    const act = morphAction(this.tpl, action, oneTime);
    if (!act) return;
    const frames = framesOf(this.tpl.img[act]);
    if (!frames.length) { this.dropped = true; return; }
    if (act !== this.act) { this.act = act; this.frame = 0; this.left = this.delay(frames[0], act, scale); }
    for (this.acc += dt * 1000; this.acc >= 30; this.acc -= 30) {
      this.left -= 30;
      if (this.left >= 1) continue;
      if ((act === 'ladder' || act === 'rope') && ent.y === this.lastY) { this.left = 0; continue; }
      this.frame = (this.frame + 1) % frames.length;
      this.left += this.delay(frames[this.frame], act, scale);
    }
    this.lastY = ent.y;
  }
  /** A frame's delay (120 unset); a superman's non-walk frames run at the attack speed ((speed + 10) / 16). */
  delay(f, act, scale) {
    const d = Number(f?.delay) || 120;
    return this.tpl.superman && act !== 'walk' ? d * scale : d;
  }
  node() { return this.dropped || !this.act ? null : framesOf(this.tpl.img[this.act])[this.frame] || null; }
  /** Drawn by its origin at the character's feet; mirrored when facing right, except on a ladder or rope. */
  draw(ctx, assets, sx, sy, right, alpha = 1) {
    const n = this.node(), img = n && assets.image(n);
    if (!img) return false;
    const o = n.origin || [0, 0], flip = right && this.act !== 'ladder' && this.act !== 'rope';
    ctx.save(); ctx.globalAlpha *= alpha;
    ctx.translate(Math.round(sx), Math.round(sy));
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -o[0], -o[1]);
    ctx.restore();
    return true;
  }
  /** The frame's lt / rb as the character's box (mirrored when facing right), or null. */
  box(x, y, right) {
    const n = this.node();
    if (!n?.lt || !n?.rb) return null;
    const [l, t] = n.lt, [r, b] = n.rb;
    return right ? { left: x - r, right: x - l, top: y + t, bottom: y + b } : { left: x + l, right: x + r, top: y + t, bottom: y + b };
  }
  frames() { return Object.values(this.tpl.img).flatMap((n) => (n && typeof n === 'object' ? framesOf(n) : [])); }
}

/** Attacks a superman morph may make without a skill: knuckles (and weapon type 39), or a bow from Eagle Eye. */
export function supermanPlainAttackOk(weaponId, reason) {
  const w = Math.floor(weaponId / 10000) % 100;
  return w === 39 || w === 48 || (w === 45 && reason === 13111005);
}
/** Skills a superman morph can't use (mounts, the beginner skills, Double Shot, Burst Fire, Oak Barrel). */
export const SUPERMAN_BLOCKED = new Set([1004, 1009, 1013, 1017, 1018, 1019, 1020, 1027, 1028, 1029, 1030, 1031, 5001003, 5101007, 5210000,
  10001004, 10001009, 10001014, 10001019, 10001020, 10001022, 10001023, 10001027, 10001028, 10001029, 10001030, 10001031,
  20001004, 20001009, 20001019, 20001020, 20001022, 20001023, 20001027, 20001028, 20001029, 20001030, 20001031,
  20011004, 20011009, 20011027, 20011028, 20011029, 20011030, 20011031]);
