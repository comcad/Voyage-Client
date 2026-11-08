/**
 * Key Setting's Controller and Touch tabs. They take the keyboard panel's place (the window keeps its buttons and
 * function palette) and are drawn in the window's own style: key caps with a #222 outline, slate edge and white
 * face; the chosen option is a pink cap like the reserved Esc / Tab keys.
 */
import { uiText, wrapText } from './wzui.js';
import { UI_W, UI_H } from '../view.js';
import { PAD_BUTTONS, defaultPad, defaultTouch, TOUCH_MAX_BUTTONS, bindingLabel } from '../controls.js';

/** The keyboard panel the tabs cover, and the tab caps on the button strip. */
const PANEL = { x: 6, y: 22, w: 617, h: 210 };
export const TABS = [
  { key: 'keyboard', label: 'Keyboard', x: 404 },
  { key: 'controller', label: 'Controller', x: 476 },
  { key: 'touch', label: 'Touch', x: 548 },
];
const TAB_Y = 238, TAB_W = 68, TAB_H = 20;

/** A key cap: #222 outline, slate edge, white highlight and face (pink for the chosen one). */
export function cap(ctx, x, y, w, h, { pink = false, lit = false } = {}) {
  ctx.fillStyle = pink ? '#331122' : '#222222'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = pink ? '#886677' : '#778899'; ctx.fillRect(x + 1, y + 1, w - 2, h - 3);
  ctx.fillStyle = pink ? '#ddbbcc' : '#ffffff'; ctx.fillRect(x + 2, y + 2, w - 4, 1);
  ctx.fillStyle = pink ? '#bb8899' : lit ? '#ffffcc' : '#f4f8fc'; ctx.fillRect(x + 2, y + 3, w - 4, h - 8);
}

/**
 * The controller drawn on the panel, mirror-symmetric about the panel's middle (CX): a dark body with grips, the
 * D-pad and face buttons level on either side, the sticks below the middle, Back / Start between them, and the
 * bumpers and triggers stacked on the top edge. Each bindable button shows what it is bound to inside it.
 */
const CX = 314;
const PAD_SLOTS = {
  6: { rect: [CX - 214, 24, 92, 22], name: 'LT' }, 7: { rect: [CX + 122, 24, 92, 22], name: 'RT' },
  4: { rect: [CX - 214, 49, 92, 22], name: 'LB' }, 5: { rect: [CX + 122, 49, 92, 22], name: 'RB' },
  10: { c: [CX - 62, 170], r: 19, stick: true, name: 'LS' }, 11: { c: [CX + 62, 170], r: 19, stick: true, name: 'RS' },
  8: { c: [CX - 40, 110], r: 15, name: 'Back' }, 9: { c: [CX + 40, 110], r: 15, name: 'Start' },
  3: { c: [CX + 170, 97], r: 16, rim: '#e0b628', name: 'Y' }, 2: { c: [CX + 135, 131], r: 16, rim: '#3d78d8', name: 'X' },
  1: { c: [CX + 205, 131], r: 16, rim: '#d63c3c', name: 'B' }, 0: { c: [CX + 170, 165], r: 16, rim: '#3fa043', name: 'A' },
};
const DPAD = { x: CX - 170, y: 131, arm: 26, len: 44 };

/** The body outline: the left half, mirrored for the right. */
function bodyPath(ctx) {
  const L = (x) => CX - x, R = (x) => CX + x;
  ctx.beginPath();
  ctx.moveTo(L(150), 72);
  ctx.lineTo(R(150), 72);
  ctx.bezierCurveTo(R(214), 72, R(236), 92, R(242), 122);
  // the right grip, rounded at its end
  ctx.bezierCurveTo(R(250), 160, R(258), 196, R(236), 211);
  ctx.bezierCurveTo(R(214), 225, R(184), 214, R(160), 199);
  ctx.quadraticCurveTo(R(128), 204, R(98), 204);
  ctx.quadraticCurveTo(CX, 196, L(98), 204);   // a gentle arch between the grips
  ctx.quadraticCurveTo(L(128), 204, L(160), 199);
  ctx.bezierCurveTo(L(184), 214, L(214), 225, L(236), 211);
  ctx.bezierCurveTo(L(258), 196, L(250), 160, L(242), 122);
  ctx.bezierCurveTo(L(236), 92, L(214), 72, L(150), 72);
  ctx.closePath();
}

/** The body: a soft shadow under it, dark slate with a sheen on top, a light inner rim and a near-black outline. */
function drawBody(ctx) {
  ctx.save();
  bodyPath(ctx);
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  const gr = ctx.createLinearGradient(0, 72, 0, 232);
  gr.addColorStop(0, '#4a5868'); gr.addColorStop(0.45, '#344150'); gr.addColorStop(1, '#222b35');
  ctx.fillStyle = gr; ctx.fill();
  ctx.restore();
  ctx.save();
  bodyPath(ctx); ctx.clip();
  // the sheen across the top
  const sh = ctx.createLinearGradient(0, 72, 0, 130);
  sh.addColorStop(0, 'rgba(255,255,255,0.22)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fillRect(CX - 260, 72, 520, 60);
  // recessed wells behind the D-pad and the face buttons
  for (const x of [CX - 170, CX + 170]) {
    const w = ctx.createRadialGradient(x, 131, 8, x, 131, 54);
    w.addColorStop(0, 'rgba(10,14,20,0.55)'); w.addColorStop(1, 'rgba(10,14,20,0)');
    ctx.fillStyle = w; ctx.beginPath(); ctx.arc(x, 131, 54, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.save();
  bodyPath(ctx);
  ctx.lineWidth = 2; ctx.strokeStyle = '#11161c'; ctx.stroke();
  ctx.translate(0, 1.5); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(160,180,200,0.35)'; ctx.stroke();
  ctx.restore();
}

/** A bumper or trigger: a light rounded slab on the top edge, its name at the left end. */
function slab(ctx, [x, y, w, h], lit, name) {
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 9);
  const gr = ctx.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, lit ? '#fff9c4' : '#f6f9fc'); gr.addColorStop(1, lit ? '#f0dc70' : '#cdd7e1');
  ctx.fillStyle = gr; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#11161c'; ctx.stroke();
  ctx.restore();
  uiText(ctx, name, x + 8, y + 5, { color: '#5a6b7c', size: 10, bold: true });
}

/** A round button: glossy light face, near-black outline, a coloured rim when it has one. */
function knob(ctx, [x, y], r, lit, rim) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y + 1.5, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();   // its edge
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  const gr = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
  gr.addColorStop(0, lit ? '#fffbd6' : '#ffffff'); gr.addColorStop(1, lit ? '#f2d860' : '#cfd9e3');
  ctx.fillStyle = gr; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#11161c'; ctx.stroke();
  if (rim) { ctx.beginPath(); ctx.arc(x, y, r - 2.2, 0, Math.PI * 2); ctx.lineWidth = 2.5; ctx.strokeStyle = rim; ctx.stroke(); }
  ctx.restore();
}

/** A thumbstick: a dark ring in the body with a domed light cap. */
function stick(ctx, [x, y], r, lit) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2);
  const ring = ctx.createRadialGradient(x, y, r, x, y, r + 6);
  ring.addColorStop(0, '#0e1318'); ring.addColorStop(1, '#2a3440');
  ctx.fillStyle = ring; ctx.fill();
  ctx.restore();
  knob(ctx, [x, y], r, lit);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r - 5, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(80,100,120,0.35)'; ctx.stroke();
  ctx.restore();
}

/** A face button's letter, in a small badge of its colour at its upper right. */
function badge(ctx, [x, y], r, rim, letter) {
  const bx = x + r * 0.78, by = y - r * 0.78;
  ctx.save();
  ctx.beginPath(); ctx.arc(bx, by, 6.5, 0, Math.PI * 2); ctx.fillStyle = rim; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = '#11161c'; ctx.stroke();
  ctx.restore();
  uiText(ctx, letter, bx, by - 5, { color: '#fff', size: 9, bold: true, align: 'center' });
}

/** What a slot shows: a skill or item picture fitted inside, or a function's name. */
export function drawBinding(win, ctx, b, cx, cy, size) {
  const m = win.mgr, g = win.g, label = bindingLabel(b);
  if (label) {
    ctx.save(); ctx.font = 'bold 9px Arial, sans-serif';
    const lines = wrapText(ctx, label, Math.max(24, size + 6), 9).slice(0, 2);
    ctx.restore();
    // a long single word (Minimap, Equipment) a size smaller so it stays inside a small round button
    const longest = Math.max(...lines.map((ln) => ln.length)), fs = size < 30 ? (longest > 7 ? 7 : longest > 5 ? 8 : 9) : 9;
    lines.forEach((ln, i) => uiText(ctx, ln, cx, cy - lines.length * 5 + i * 10, { color: '#334455', size: fs, bold: true, align: 'center' }));
    return;
  }
  const icon = g.bindingIcon(b), img = icon && m.image(icon);
  if (!img) { if (icon) m.assets.preload([icon]); return; }
  const k = Math.min(1, size / Math.max(img.width, img.height));
  ctx.drawImage(img, Math.round(cx - img.width * k / 2), Math.round(cy - img.height * k / 2), Math.round(img.width * k), Math.round(img.height * k));
  if (b.type === 2) uiText(ctx, String(g.itemCount?.(b.action) || 0), cx + size / 2, cy + size / 2 - 9, { color: '#fff', size: 9, bold: true, align: 'right', outline: '#000' });
}

/** The Touch tab: settings on the left, a preview of the screen on the right. */
// the screen's shape (the interface's space, which the touch controls are sized to), 268 wide and at most 201 tall
const preview = () => ({ x: 330, y: 30, w: 268, h: Math.min(201, Math.round((268 * UI_H) / UI_W)) });
const SHOW = [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']];
const SIZES = [[0.8, 'Small'], [1, 'Medium'], [1.25, 'Large'], [1.5, 'X-Large'], [1.8, 'Huge']];
const OPACITY = [[0.5, '50%'], [0.75, '75%'], [1, '100%']];
const BUTTON = 58, STICK = 120;
/** How far past its edge (interface px) a finger still takes a control in the preview: they are small there. */
const TOUCH_GRAB = 16;

export class ControlTabs {
  /** win: the Key Setting window (its draft controls, icons, carry and binding conversion). */
  constructor(win) { this.win = win; this.picked = null; this.dragging = null; }

  get g() { return this.win.g; }
  get mgr() { return this.win.mgr; }
  get draft() { return this.win.ctlDraft; }

  tabAt(lx, ly) { return TABS.find((t) => lx >= t.x && lx < t.x + TAB_W && ly >= TAB_Y && ly < TAB_Y + TAB_H)?.key || null; }

  drawTabs(ctx, current) {
    for (const t of TABS) {
      cap(ctx, t.x, TAB_Y, TAB_W, TAB_H, { pink: t.key === current });
      uiText(ctx, t.label, t.x + TAB_W / 2, TAB_Y + 4, { color: t.key === current ? '#fff' : '#334455', size: 11, bold: true, align: 'center' });
    }
  }

  /** Functions already on a slot of this tab (the palette leaves their cells empty). */
  bound(tab) {
    if (tab === 'controller') return Object.values(this.draft.pad);
    if (tab === 'touch') return this.draft.touch.buttons.map((b) => b.b).filter(Boolean);
    return [];
  }

  draw(ctx, tab) {
    ctx.fillStyle = '#eeeeee'; ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    if (tab === 'controller') this.drawController(ctx); else this.drawTouch(ctx);
  }

  // ---------------------------------------------------------------- controller
  drawController(ctx) {
    const pad = this.g.padInput, held = this.g.input.held(), m = this.mgr;
    // the bumpers and triggers stand on the top edge, behind the body
    for (const p of PAD_BUTTONS) {
      const sl = PAD_SLOTS[p.i];
      if (!sl?.rect) continue;
      slab(ctx, sl.rect, held.has(`pad:${p.i}`), sl.name);
      const b = this.draft.pad[p.i], [x, y, w, h] = sl.rect;
      if (b && m.carry?.fromPad !== p.i) drawBinding(this, ctx, b, x + w / 2 + 10, y + h / 2, h - 4);
      if (this.picked === p.i) { ctx.strokeStyle = '#ffdd00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 10); ctx.stroke(); ctx.lineWidth = 1; }
    }
    drawBody(ctx);
    // the D-pad: a light cross; it moves, or (when the left stick moves) its arms are buttons with bindings
    const D = DPAD, dpadMoves = this.draft.padMove === 'dpad';
    const ARM = { up: 12, down: 13, left: 14, right: 15 };
    const lit = (d) => (dpadMoves ? held.has(d) : held.has(`pad:${ARM[d]}`));
    ctx.save();
    const cross = () => { ctx.beginPath(); ctx.roundRect(D.x - D.arm / 2, D.y - D.len, D.arm, D.len * 2, 5); ctx.roundRect(D.x - D.len, D.y - D.arm / 2, D.len * 2, D.arm, 5); };
    ctx.translate(0, 1.5); cross(); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill(); ctx.translate(0, -1.5);
    cross();
    const dg = ctx.createLinearGradient(0, D.y - D.len, 0, D.y + D.len);
    dg.addColorStop(0, '#f6f9fc'); dg.addColorStop(1, '#c8d3de');
    ctx.fillStyle = dg; ctx.fill('nonzero');
    ctx.fillStyle = 'rgba(242,216,96,0.9)';
    const a = D.arm / 2, k = D.len - a;
    if (lit('up')) ctx.fillRect(D.x - a + 1, D.y - D.len + 1, D.arm - 2, k);
    if (lit('down')) ctx.fillRect(D.x - a + 1, D.y + a, D.arm - 2, k - 1);
    if (lit('left')) ctx.fillRect(D.x - D.len + 1, D.y - a + 1, k, D.arm - 2);
    if (lit('right')) ctx.fillRect(D.x + a, D.y - a + 1, k - 1, D.arm - 2);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#11161c';
    ctx.beginPath();
    ctx.moveTo(D.x - a, D.y - D.len + 5); ctx.arcTo(D.x - a, D.y - D.len, D.x, D.y - D.len, 5); ctx.arcTo(D.x + a, D.y - D.len, D.x + a, D.y, 5);
    ctx.lineTo(D.x + a, D.y - a); ctx.lineTo(D.x + D.len - 5, D.y - a); ctx.arcTo(D.x + D.len, D.y - a, D.x + D.len, D.y, 5); ctx.arcTo(D.x + D.len, D.y + a, D.x, D.y + a, 5);
    ctx.lineTo(D.x + a, D.y + a); ctx.lineTo(D.x + a, D.y + D.len - 5); ctx.arcTo(D.x + a, D.y + D.len, D.x, D.y + D.len, 5); ctx.arcTo(D.x - a, D.y + D.len, D.x - a, D.y, 5);
    ctx.lineTo(D.x - a, D.y + a); ctx.lineTo(D.x - D.len + 5, D.y + a); ctx.arcTo(D.x - D.len, D.y + a, D.x - D.len, D.y, 5); ctx.arcTo(D.x - D.len, D.y - a, D.x, D.y - a, 5);
    ctx.lineTo(D.x - a, D.y - a); ctx.closePath(); ctx.stroke();
    ctx.restore();
    const tri = (x, y, dx, dy) => { ctx.beginPath(); ctx.moveTo(x + dx * 6, y + dy * 6); ctx.lineTo(x - dy * 5 - dx * 2, y + dx * 5 - dy * 2); ctx.lineTo(x + dy * 5 - dx * 2, y - dx * 5 - dy * 2); ctx.closePath(); ctx.fill(); };
    ctx.fillStyle = '#7d8c9c';
    const arrows = { up: [D.x, D.y - D.len + 12, 0, -1], down: [D.x, D.y + D.len - 12, 0, 1], left: [D.x - D.len + 12, D.y, -1, 0], right: [D.x + D.len - 12, D.y, 1, 0] };
    for (const [dir, at] of Object.entries(arrows)) {
      const b = !dpadMoves && this.draft.pad[ARM[dir]];
      if (b && m.carry?.fromPad !== ARM[dir]) {
        const [cx, cy] = this.armCentre(dir);
        drawBinding(this, ctx, b, cx, cy, D.arm - 4);
      } else tri(...at);
      if (!dpadMoves && this.picked === ARM[dir]) { const r = this.armRect(dir); ctx.strokeStyle = '#ffdd00'; ctx.lineWidth = 2; ctx.strokeRect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2); ctx.lineWidth = 1; }
    }
    // MOVE under whichever moves
    if (dpadMoves) uiText(ctx, 'MOVE', D.x, D.y + D.len + 6, { color: '#8fa1b3', size: 9, bold: true, align: 'center' });
    else { const ls = PAD_SLOTS[10]; uiText(ctx, 'MOVE', ls.c[0], ls.c[1] + ls.r + 6, { color: '#8fa1b3', size: 9, bold: true, align: 'center' }); }
    // the round buttons, each showing what it does
    for (const p of PAD_BUTTONS) {
      const sl = PAD_SLOTS[p.i];
      if (!sl || sl.rect) continue;
      const b = this.draft.pad[p.i], on = held.has(`pad:${p.i}`);
      if (sl.stick) stick(ctx, sl.c, sl.r, on); else knob(ctx, sl.c, sl.r, on, sl.rim);
      if (b && m.carry?.fromPad !== p.i) drawBinding(this, ctx, b, sl.c[0], sl.c[1], sl.r * 2 - 8);
      else if (!sl.rim) uiText(ctx, sl.name, sl.c[0], sl.c[1] - 5, { color: '#8fa1b3', size: 9, bold: true, align: 'center' });
      if (sl.rim) badge(ctx, sl.c, sl.r, sl.rim, sl.name);
      else if (b) uiText(ctx, sl.name, sl.c[0], sl.c[1] + sl.r + (sl.stick ? 7 : 3), { color: '#8fa1b3', size: 9, bold: true, align: 'center' });
      if (this.picked === p.i) { ctx.strokeStyle = '#ffdd00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sl.c[0], sl.c[1], sl.r + (sl.stick ? 8 : 3), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
    }
    // which controller, and how to set it: between the triggers
    const name = pad?.name ? pad.name.replace(/\s*\(.*$/, '') : null;
    uiText(ctx, name ? name.slice(0, 34) : 'No controller found: connect one, press a button', CX, 24, { color: name ? '#334455' : '#996677', size: name ? 11 : 10, bold: true, align: 'center' });
    uiText(ctx, 'Move with:', this.moveRect('dpad')[0] - 6, 42, { color: '#334455', size: 10, bold: true, align: 'right' });
    for (const [mode, text] of [['dpad', 'D-pad'], ['ls', 'Left stick']]) {
      const [x, y, w, h] = this.moveRect(mode), on = this.draft.padMove === mode || (mode === 'ls' && this.draft.padMove !== 'dpad');
      cap(ctx, x, y, w, h, { pink: on });
      uiText(ctx, text, x + w / 2, y + 4, { color: on ? '#fff' : '#334455', size: 10, bold: true, align: 'center' });
    }
    uiText(ctx, 'Drag skills, items or functions onto a button.', CX, 60, { color: '#556677', size: 9, align: 'center' });
  }

  /** The Move-with toggle's caps, between the triggers. */
  moveRect(mode) { return mode === 'dpad' ? [CX - 40, 38, 58, 18] : [CX + 22, 38, 74, 18]; }
  /** A D-pad arm (up, down, left, right) as a rectangle, and its centre. */
  armRect(dir) {
    const D = DPAD, a = D.arm / 2;
    return { up: [D.x - a, D.y - D.len, D.arm, D.len - a], down: [D.x - a, D.y + a, D.arm, D.len - a],
      left: [D.x - D.len, D.y - a, D.len - a, D.arm], right: [D.x + a, D.y - a, D.len - a, D.arm] }[dir];
  }
  armCentre(dir) { const [x, y, w, h] = this.armRect(dir); return [x + w / 2, y + h / 2]; }

  padCapAt(lx, ly) {
    if (this.draft.padMove !== 'dpad') {
      for (const [dir, i] of [['up', 12], ['down', 13], ['left', 14], ['right', 15]]) {
        const [x, y, w, h] = this.armRect(dir);
        if (lx >= x && lx < x + w && ly >= y && ly < y + h) return i;
      }
    }
    for (const [i, s] of Object.entries(PAD_SLOTS)) {
      if (s.rect) { const [x, y, w, h] = s.rect; if (lx >= x && lx < x + w && ly >= y && ly < y + h) return Number(i); }
      else if (Math.hypot(lx - s.c[0], ly - s.c[1]) <= s.r + 1) return Number(i);
    }
    return null;
  }

  // ---------------------------------------------------------------- touch
  /** The settings rows: [label, options, current value, setter]. */
  rows() {
    const t = this.draft.touch;
    return [
      ['Show touch controls', SHOW, t.show, (v) => { t.show = v; }],
      ['Button size', SIZES, t.size, (v) => { t.size = v; }],
      ['Opacity', OPACITY, t.opacity, (v) => { t.opacity = v; }],
    ];
  }
  /** A row's choices share the width left of the preview: 3 across, or 5 narrower ones. */
  optionRect(r, o) { const w = this.rows()[r][1].length > 3 ? 56 : 86; return { x: 18 + o * (w + 6), y: 46 + r * 48, w, h: 22 }; }
  addRect() { return { x: 18, y: 192, w: 132, h: 22 }; }
  removeRect() { return { x: 156, y: 192, w: 132, h: 22 }; }

  drawTouch(ctx) {
    const m = this.mgr, t = this.draft.touch;
    this.rows().forEach(([label, opts, cur], r) => {
      uiText(ctx, label, 18, 30 + r * 48, { color: '#334455', size: 11, bold: true });
      opts.forEach(([v, text], o) => {
        const q = this.optionRect(r, o), on = v === cur;
        cap(ctx, q.x, q.y, q.w, q.h, { pink: on });
        uiText(ctx, text, q.x + q.w / 2, q.y + 5, { color: on ? '#fff' : '#334455', size: 11, bold: true, align: 'center' });
      });
    });
    const add = this.addRect(), rem = this.removeRect(), full = t.buttons.length >= TOUCH_MAX_BUTTONS;
    cap(ctx, add.x, add.y, add.w, add.h);
    uiText(ctx, full ? 'Button limit reached' : '+ Add a button', add.x + add.w / 2, add.y + 5, { color: full ? '#99aabb' : '#334455', size: 11, bold: true, align: 'center' });
    cap(ctx, rem.x, rem.y, rem.w, rem.h);
    uiText(ctx, '- Remove selected', rem.x + rem.w / 2, rem.y + 5, { color: this.picked ? '#334455' : '#99aabb', size: 11, bold: true, align: 'center' });
    // the screen preview: dark like the client's panels, with a white ring
    const P = preview();
    ctx.fillStyle = '#222222'; ctx.fillRect(P.x - 2, P.y - 2, P.w + 4, P.h + 4);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(P.x - 1, P.y - 1, P.w + 2, P.h + 2);
    ctx.fillStyle = '#556677'; ctx.fillRect(P.x, P.y, P.w, P.h);
    ctx.fillStyle = '#445566'; ctx.fillRect(P.x, P.y + P.h * (1 - 71 / UI_H), P.w, P.h * 71 / UI_H);   // where the status bar sits
    const k = P.w / UI_W * (t.size || 1);
    this.circle(ctx, P.x + t.stick.x * P.w, P.y + t.stick.y * P.h, STICK * k / 2, t.opacity);
    this.circle(ctx, P.x + t.stick.x * P.w, P.y + t.stick.y * P.h, 25 * k, t.opacity, '#ffffff');
    for (const b of t.buttons) {
      const cx = P.x + b.x * P.w, cy = P.y + b.y * P.h, r = BUTTON * k / 2;
      this.circle(ctx, cx, cy, r, t.opacity);
      const label = bindingLabel(b.b);
      if (label) {
        uiText(ctx, label.length > 8 ? label.split(' ')[0] : label, cx, cy - 4, { color: '#fff', size: 8, bold: true, align: 'center' });
      } else {
        const icon = b.b && this.g.bindingIcon(b.b);
        if (icon && m.image(icon)) { const img = m.image(icon); ctx.globalAlpha = t.opacity; ctx.drawImage(img, cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4); ctx.globalAlpha = 1; }
        else if (icon) m.assets.preload([icon]);
      }
      if (this.picked === b.id) { ctx.strokeStyle = '#ff0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
    }
    uiText(ctx, 'Drag to move. Drop skills, items or functions on a button.', 18, 222, { color: '#556677', size: 11 });
  }
  circle(ctx, x, y, r, alpha, fill = 'rgba(0,0,64,0.627)') {
    ctx.save(); ctx.globalAlpha = alpha ?? 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (fill !== '#ffffff') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.restore();
  }
  /**
   * The touch control under a preview point: a button's id, 'stick', or null. `slack` reaches past the edges (a
   * finger, see TOUCH_GRAB); where several are in reach, the one whose edge is nearest.
   */
  touchAt(lx, ly, slack = 2) {
    const t = this.draft.touch, P = preview(), k = P.w / UI_W * (t.size || 1);
    let best = null, gap = Infinity;
    const near = (id, x, y, r) => { const d = Math.hypot(lx - (P.x + x * P.w), ly - (P.y + y * P.h)) - r; if (d <= slack && d < gap) { best = id; gap = d; } };
    for (const b of [...t.buttons].reverse()) near(b.id, b.x, b.y, BUTTON * k / 2);
    near('stick', t.stick.x, t.stick.y, STICK * k / 2);
    return best;
  }
  inPreview(lx, ly) { const P = preview(); return lx >= P.x && lx < P.x + P.w && ly >= P.y && ly < P.y + P.h; }

  // ---------------------------------------------------------------- input
  down(lx, ly, tab) {
    if (tab === 'controller') {
      for (const mode of ['dpad', 'ls']) {
        const [x, y, w, h] = this.moveRect(mode);
        if (lx >= x && lx < x + w && ly >= y && ly < y + h) { this.draft.padMove = mode; this.picked = null; return true; }
      }
      const i = this.padCapAt(lx, ly);
      if (i === null) return false;
      this.picked = i;
      const b = this.draft.pad[i];
      if (b) this.mgr.startCarry({ kind: 'bind', b, fromPad: i }, this.g.bindingIcon(b));
      return true;
    }
    const t = this.draft.touch, hit = (q) => lx >= q.x && lx < q.x + q.w && ly >= q.y && ly < q.y + q.h;
    for (const [r, [, opts, , set]] of this.rows().entries()) {
      for (const [o, [v]] of opts.entries()) if (hit(this.optionRect(r, o))) { set(v); return true; }
    }
    if (hit(this.addRect())) {
      if (t.buttons.length < TOUCH_MAX_BUTTONS) {
        const id = Math.max(0, ...t.buttons.map((b) => b.id)) + 1;
        t.buttons.push({ id, x: 0.5, y: 0.6, b: null });
        this.picked = id;
      }
      return true;
    }
    if (hit(this.removeRect())) {
      if (this.picked !== null) { t.buttons = t.buttons.filter((b) => b.id !== this.picked); this.picked = null; }
      return true;
    }
    const at = this.touchAt(lx, ly, this.mgr.touch ? TOUCH_GRAB : 2);
    if (at !== null) { if (at !== 'stick') this.picked = at; this.dragging = at; return true; }
    return false;
  }
  move(lx, ly) {
    if (this.dragging === null) return;
    const t = this.draft.touch, P = preview();
    const fx = Math.min(0.97, Math.max(0.03, (lx - P.x) / P.w)), fy = Math.min(0.97, Math.max(0.03, (ly - P.y) / P.h));
    const target = this.dragging === 'stick' ? t.stick : t.buttons.find((b) => b.id === this.dragging);
    if (target) { target.x = fx; target.y = fy; }
  }
  up() { this.dragging = null; }

  /** A skill, item or function dropped on this tab. Returns true when it landed on a slot. */
  drop(lx, ly, b, c, tab) {
    if (tab === 'controller') {
      const i = this.padCapAt(lx, ly);
      if (c.fromPad !== undefined && (i === null || i !== c.fromPad)) delete this.draft.pad[c.fromPad];
      if (i === null || !b) return i !== null;
      // a function, skill or item lives on one button only
      for (const [k, v] of Object.entries(this.draft.pad)) if (v.type === b.type && v.action === b.action && Number(k) !== i) delete this.draft.pad[k];
      this.draft.pad[i] = { ...b };
      this.picked = i;
      return true;
    }
    const at = this.touchAt(lx, ly);
    if (at === null || at === 'stick' || !b) return false;
    for (const t of this.draft.touch.buttons) if (t.b && t.b.type === b.type && t.b.action === b.action && t.id !== at) t.b = null;
    const btn = this.draft.touch.buttons.find((t) => t.id === at);
    if (btn) { btn.b = { ...b }; this.picked = at; }
    return true;
  }
  dropOutside(c) { if (c.kind === 'bind' && c.fromPad !== undefined) delete this.draft.pad[c.fromPad]; }

  /** The binding under the mouse, for the tooltip. */
  bindingAt(lx, ly, tab) {
    if (tab === 'controller') { const i = this.padCapAt(lx, ly); return i === null ? null : this.draft.pad[i] || null; }
    const at = this.touchAt(lx, ly);
    return at && at !== 'stick' ? this.draft.touch.buttons.find((t) => t.id === at)?.b || null : null;
  }

  /** Default / Clear All on this tab. */
  reset(tab) { if (tab === 'controller') { this.draft.pad = defaultPad(); this.draft.padMove = 'ls'; } else this.draft.touch = defaultTouch(); this.picked = null; }
  clear(tab) {
    if (tab === 'controller') this.draft.pad = {};
    else for (const b of this.draft.touch.buttons) b.b = null;
    this.picked = null;
  }
}
