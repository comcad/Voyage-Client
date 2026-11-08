/**
 * The Energy Charge gauge (UI/UIWindow.img/EnergyBar): an 82x10 bar that shows while you have any energy and goes
 * when it is spent. Its frame (w, c, e) is drawn at 180/255; the gauge fills trunc(energy / 10000 x 78) columns from
 * x 2 - Gage/1/0 (4px, y 3) at its first and last columns, Gage/1/1 (6px, y 2) between. Full, it plays its effect
 * instead. It is dragged from anywhere on it and stays where it was put (x from 20 less its width to 20 short of the
 * screen's right edge, y likewise).
 */
import { Win, lineTip } from './windows.js';
import { Anim } from '../map.js';
import { UI_W, UI_H } from '../view.js';

const KEY = 'maple.energybar', W = 82, H = 10, FULL = 10000, GAUGE = 78, FRAME_ALPHA = 180 / 255;
const TIP = "Displays the energy level that's been charged.\nUse the mouse to change position.";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage off */ } };
const all = (n) => (n && typeof n === 'object' ? (n._w ? [n] : Object.values(n).flatMap(all)) : []);

export class EnergyBarWin extends Win {
  constructor(mgr) {
    super(mgr, null, 0, 0);
    this.buttons = []; this.closeBtn = null;
    const s = load();
    this.x = s.x ?? 20; this.y = s.y ?? 20;
    this.w = W; this.h = H; this.dragH = H;
    this.keepOnEscape = true; this.closeSound = null;
    this.value = 0; this.full = null; this.t = 0;
    this.clamp();
  }
  get E() { return this.mgr.W?.EnergyBar; }
  frames() { return all(this.E); }
  clamp() {
    this.x = Math.max(20 - W, Math.min(UI_W - 20, this.x));
    this.y = Math.max(20 - H, Math.min(UI_H - 20, this.y));
  }
  /** The Energy Charge value from the server: shown while above 0. */
  set(value) {
    this.value = Math.max(0, value || 0);
    if (!this.preloaded && this.E) { this.preloaded = true; this.mgr.assets.preload(this.frames()); }
    const i = this.mgr.order.indexOf(this), want = this.value > 0;
    if (want && i < 0) this.mgr.order.unshift(this);
    else if (!want && i >= 0) this.mgr.order.splice(i, 1);
    if (this.value < FULL) this.full = null;
  }
  dragged() { this.clamp(); save({ x: this.x, y: this.y }); }
  tooltip() { return lineTip(TIP); }
  draw(ctx) {
    const E = this.E;
    if (!E || this.value <= 0) return;
    const im = (n) => n && this.mgr.image(n);
    const put = (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x - (n.origin?.[0] || 0), y - (n.origin?.[1] || 0)); };
    ctx.save(); ctx.translate(this.x, this.y);
    if (this.value >= FULL) {
      const now = performance.now();
      if (!this.full) { this.full = new Anim(E.effect, true); this.t = now; }
      this.full.update(now - this.t); this.t = now;
      if (this.full.node) put(this.full.node, 41, 5);
    } else {
      ctx.globalAlpha = FRAME_ALPHA;
      put(E.w, 0, 0);
      for (let x = 6; x < W - 6; x++) put(E.c, x, 0);
      put(E.e, W - 6, 0);
      ctx.globalAlpha = 1;
      const n = Math.trunc((this.value / FULL) * GAUGE), g = E.Gage?.[1];
      for (let x = 2; x <= n + 1; x++) {
        const edge = x === 2 || x === W - 3;
        put(g?.[edge ? 0 : 1], x, edge ? 3 : 2);
      }
    }
    ctx.restore();
  }
}
