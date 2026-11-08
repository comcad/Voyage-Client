/**
 * On-screen touch controls over the game: a movement stick and the buttons of the touch layout, each showing what
 * it is bound to. They are drawn like the client's own panels (translucent navy with a white ring) and hold the
 * arrow directions and `touch:<id>` codes, which Game resolves through the touch layout. Several fingers at once
 * work (walk while attacking).
 */
import { touchShown, bindingLabel } from '../controls.js';
import { UI_W } from '../view.js';

const BUTTON = 58, STICK = 120, KNOB = 50;   // sizes in interface pixels (System Option UI SIZE), before the layout's size setting

export class TouchControls {
  constructor(game, root) {
    this.g = game;
    this.el = document.createElement('div');
    this.el.className = 'touch-controls';
    Object.assign(this.el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '5' });
    root.append(this.el);
    this.held = new Map();   // pointerId -> codes it holds
    this.stick = null;       // { pointerId, el, knob }
    this.ends = new Map();   // pointerId -> what lets go of its control
    // a finger lifted anywhere lets go of its control, even when the control didn't see it (the capture failed or
    // was taken away, or the controls were rebuilt under it)
    const end = (e) => this.ends.get(e.pointerId)?.(e);
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, end, true);
    // no finger left on the screen, or the game put away (another app, the screen locked): nothing is held
    for (const t of ['touchend', 'touchcancel']) addEventListener(t, (e) => { if (!e.touches.length && this.ends.size) this.release(); }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    addEventListener('blur', () => this.release());
    new ResizeObserver(() => this.render()).observe(this.g.canvas);
    this.timer = setInterval(() => this.refreshIcons(), 1000);   // skill and item icons that load late
    this.render();
  }

  get layout() { return this.g.controls.touch; }
  get scale() { return (this.g.canvas.clientWidth || UI_W) / UI_W; }

  /** Rebuild every control from the layout. */
  render() {
    const t = this.layout;
    this.el.replaceChildren();
    this.release();
    this.el.style.display = touchShown(t) ? '' : 'none';
    if (!touchShown(t)) return;
    const s = this.scale * (t.size || 1);
    // the stick
    const base = this.disc(t.stick.x, t.stick.y, STICK * s, t.opacity);
    const knob = document.createElement('div');
    Object.assign(knob.style, {
      position: 'absolute', left: '50%', top: '50%', width: `${KNOB * s}px`, height: `${KNOB * s}px`, marginLeft: `${-KNOB * s / 2}px`,
      marginTop: `${-KNOB * s / 2}px`, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', boxShadow: '0 0 0 2px rgba(0,0,64,0.63)',
    });
    base.append(knob);
    base.addEventListener('pointerdown', (e) => this.stickDown(e, base, knob));
    this.el.append(base);
    // the buttons
    for (const b of t.buttons) {
      const el = this.disc(b.x, b.y, BUTTON * s, t.opacity);
      el.dataset.id = b.id;
      const img = document.createElement('img');
      Object.assign(img.style, { width: `${32 * s}px`, height: `${32 * s}px`, imageRendering: 'pixelated', pointerEvents: 'none' });
      img.alt = '';
      el.append(img);
      const word = document.createElement('b');   // a function's name, in place of its key-setting icon
      // centred in the circle, small enough that two short lines fit inside it
      Object.assign(word.style, {
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: '78%',
        font: `bold ${Math.max(7, 8.5 * s)}px Arial, sans-serif`, color: '#fff', textAlign: 'center', lineHeight: '1.1',
        textShadow: '0 0 2px #000, 0 0 2px #000', pointerEvents: 'none', overflowWrap: 'anywhere',
      });
      el.append(word);
      const count = document.createElement('span');
      Object.assign(count.style, {
        position: 'absolute', right: `${8 * s}px`, bottom: `${6 * s}px`, font: `bold ${Math.max(9, 11 * s)}px Arial, sans-serif`,
        color: '#fff', textShadow: '0 0 2px #000, 0 0 2px #000', pointerEvents: 'none',
      });
      el.append(count);
      el.addEventListener('pointerdown', (e) => this.buttonDown(e, el, `touch:${b.id}`));
      this.el.append(el);
    }
    this.refreshIcons();
  }

  /** A round panel centred at (fx, fy) of the view, `d` px across. */
  disc(fx, fy, d, opacity) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', left: `calc(${fx * 100}% - ${d / 2}px)`, top: `calc(${fy * 100}% - ${d / 2}px)`,
      width: `${d}px`, height: `${d}px`, borderRadius: '50%', background: 'rgba(0,0,64,0.627)', border: '2px solid #fff',
      boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: String(opacity ?? 0.8),
      pointerEvents: 'auto', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none',
    });
    return el;
  }

  /** Each button's icon (and item count) from its binding; skill and item icons can arrive late. */
  refreshIcons() {
    if (this.el.style.display === 'none') return;
    for (const el of this.el.querySelectorAll('[data-id]')) {
      const b = this.layout.buttons.find((x) => String(x.id) === el.dataset.id)?.b;
      const label = bindingLabel(b), node = b && !label && this.g.bindingIcon(b);
      const img = el.querySelector('img'), count = el.querySelector('span'), word = el.querySelector('b');
      word.textContent = label || ''; word.style.display = label ? '' : 'none';
      const src = node?._canvas ? `${this.g.assets.base}/${node._canvas}` : '';
      if (img.dataset.src !== src) { img.dataset.src = src; if (src) img.src = src; else img.removeAttribute('src'); img.style.display = src ? '' : 'none'; }
      count.textContent = b?.type === 2 ? String(this.g.itemCount?.(b.action) || 0) : '';
    }
  }

  buttonDown(e, el, code) {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    this.held.set(e.pointerId, new Set([code]));
    el.style.background = 'rgba(70,110,210,0.8)';
    // let go: lifted, cancelled, its capture lost, or ended from outside (no ev)
    const up = (ev) => {
      if (ev && ev.pointerId !== e.pointerId) return;
      this.held.delete(e.pointerId); this.ends.delete(e.pointerId);
      el.style.background = 'rgba(0,0,64,0.627)';
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.removeEventListener(t, up);
      this.sync();
    };
    this.ends.get(e.pointerId)?.();
    this.ends.set(e.pointerId, up);
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, up);
    this.sync();
  }

  stickDown(e, base, knob) {
    e.preventDefault();
    try { base.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    const r = base.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, radius = r.width / 2;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      let dx = ev.clientX - cx, dy = ev.clientY - cy;
      const len = Math.hypot(dx, dy), max = radius - knob.offsetWidth / 4;
      if (len > max) { dx *= max / len; dy *= max / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // left / right once the knob is a third of the way out, up to 60 degrees off level; up / down only pushed half
      // way out within 30 degrees of straight up or down, so a thumb that drifts while running doesn't hold up (and
      // walk into a portal)
      const codes = new Set(), ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax > radius * 0.33 && ay < ax * 1.73) codes.add(dx < 0 ? 'left' : 'right');
      if (ay > radius * 0.5 && ax < ay * 0.58) codes.add(dy < 0 ? 'up' : 'down');
      // up held into a new map needs a fresh push: let go of up first (you'd go straight back through the portal)
      if (this.upLocked) { if (codes.has('up')) codes.delete('up'); else this.upLocked = false; }
      this.held.set(e.pointerId, codes);
      this.sync();
    };
    // let go: lifted, cancelled, its capture lost, or ended from outside (no ev)
    const up = (ev) => {
      if (ev && ev.pointerId !== e.pointerId) return;
      knob.style.transform = '';
      this.held.delete(e.pointerId); this.ends.delete(e.pointerId);
      base.removeEventListener('pointermove', move);
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) base.removeEventListener(t, up);
      this.sync();
    };
    this.ends.get(e.pointerId)?.();
    this.ends.set(e.pointerId, up);
    base.addEventListener('pointermove', move);
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) base.addEventListener(t, up);
    move(e);
  }

  /** Everything the fingers hold now, as one source of the input. */
  sync() {
    const all = new Set();
    for (const codes of this.held.values()) for (const c of codes) all.add(c);
    this.g.input.setHeld('touch', all);
  }
  /** Hidden while Key Setting is open (the layout is edited there, and the buttons would cover the window). */
  suspend(on) { this.suspended = on; this.el.style.visibility = on ? 'hidden' : ''; if (on) this.release(); }
  release() {
    for (const end of [...this.ends.values()]) end();
    this.held.clear(); this.g.input?.setHeld('touch', new Set());
  }
  /** A new map: up from the stick stops until the stick leaves up. */
  mapChanged() {
    let had = false;
    for (const codes of this.held.values()) if (codes.delete('up')) had = true;
    if (had) { this.upLocked = true; this.sync(); }
  }
}
