import { isCanvas, frames } from '../assets.js';
import { Anim } from '../map.js';

/**
 * Minimal canvas UI built from UI.wz sprites, like the v83 client:
 *   WzButton  - node with normal / mouseOver / pressed / disabled (/ keyFocused) frame lists
 *   WzSprite  - one canvas or an animation
 *   TextField - a real <input> laid over the canvas (keeps IME, paste, password managers)
 * Coordinates are in the 800x600 login space; `origin` is honoured like the client does.
 */

export class WzSprite {
  constructor(node, x = 0, y = 0, { loop = true, alpha = 1 } = {}) {
    this.anim = new Anim(node, loop); this.x = x; this.y = y; this.alpha = alpha; this.visible = true;
  }
  frames() { return this.anim.frames; }
  update(ms) { this.anim.update(ms); }
  draw(ctx, assets, ox = 0, oy = 0) {
    const n = this.anim.node;
    const img = n && this.visible ? assets.image(n) : null;
    if (!img) return;
    const o = n.origin || [0, 0];
    ctx.save();
    ctx.globalAlpha = this.alpha * this.anim.alpha;
    if (this.anim.blend) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(img, Math.round(this.x + ox - o[0]), Math.round(this.y + oy - o[1]));
    ctx.restore();
  }
}

export class WzButton {
  constructor(node, x, y, onClick) {
    this.node = node; this.x = x; this.y = y; this.onClick = onClick;
    this.enabled = true; this.visible = true; this.hover = false; this.down = false; this.focused = false;
    this.anims = {};
    // state animations play once and hold their last frame (e.g. a world tag swings, then hangs still)
    for (const s of ['normal', 'mouseOver', 'pressed', 'disabled', 'keyFocused']) if (node?.[s]) this.anims[s] = new Anim(firstFrames(node[s]), false);
  }
  get state() {
    if (this.forceState) return this.forceState;
    if (!this.enabled) return 'disabled';
    if (this.down && this.hover) return 'pressed';
    if (this.hover) return 'mouseOver';
    if (this.focused && this.anims.keyFocused) return 'keyFocused';
    return 'normal';
  }
  frames() { return Object.values(this.anims).flatMap((a) => a.frames); }
  rect() {
    const n = this.anims.normal?.node || this.anims[this.state]?.node;
    const o = n?.origin || [0, 0];
    return { x: this.x - o[0], y: this.y - o[1], w: n?._w || 0, h: n?._h || 0 };
  }
  hit(px, py) {
    if (!this.visible) return false;
    const r = this.rect();
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  }
  update(ms) {
    const a = this.anims[this.state] || this.anims.normal;
    if (a !== this.shown) { a?.reset(); this.shown = a; } // replay on every state change
    a?.update(ms);
  }
  draw(ctx, assets) {
    if (!this.visible) return;
    const a = this.anims[this.state] || this.anims.normal;
    const n = a?.node;
    const img = n && assets.image(n);
    if (!img) return;
    const o = n.origin || [0, 0];
    ctx.drawImage(img, Math.round(this.x - o[0]), Math.round(this.y - o[1]));
  }
}

/** A state node is either a canvas list ("0","1"...) or a canvas itself. */
function firstFrames(node) {
  if (isCanvas(node)) return node;
  if (frames(node).some(isCanvas)) return node;
  return frames(node)[0] || node;
}

export class TextField {
  constructor(layer, x, y, w, h, { password = false, max = 12, color = '#000', font = '12px Arial' } = {}) {
    this.rect = { x, y, w, h };
    this.el = document.createElement('input');
    this.el.type = password ? 'password' : 'text';
    this.el.maxLength = max;
    this.el.autocomplete = password ? 'current-password' : 'username';
    this.el.spellcheck = false;
    Object.assign(this.el.style, {
      position: 'absolute', background: 'transparent', border: 'none', outline: 'none', padding: '0 3px',
      color, font, caretColor: color, margin: 0,
    });
    layer.append(this.el);
  }
  get value() { return this.el.value; }
  set value(v) { this.el.value = v; }
  focus() { this.el.focus(); }
  show(v) { this.el.style.display = v ? '' : 'none'; }
  remove() { this.el.remove(); }
  /** Place the input over its canvas rect, given the canvas' on-screen box and scale. */
  layout(box, scale) {
    const { x, y, w, h } = this.rect;
    Object.assign(this.el.style, {
      left: `${box.left + x * scale}px`, top: `${box.top + y * scale}px`,
      width: `${w * scale}px`, height: `${h * scale}px`, fontSize: `${Math.max(9, 12 * scale)}px`,
    });
  }
}

/** Draws text the way the client's UI does: small Arial with an optional 1px dark outline. */
export function uiText(ctx, text, x, y, { color = '#fff', size = 12, align = 'left', bold = false, outline = null, base = 'top' } = {}) {
  ctx.save();
  ctx.font = `${bold ? 'bold ' : ''}${size}px Arial, "Segoe UI", sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = base;
  if (outline) { ctx.lineWidth = 3; ctx.strokeStyle = outline; ctx.strokeText(text, x, y); }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Word-wrap helper for dialog text. */
export function wrapText(ctx, text, width, size = 12) {
  ctx.save(); ctx.font = `${size}px Arial`;
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > width && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  ctx.restore();
  return out;
}
