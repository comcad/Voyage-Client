/**
 * At a fractional zoom (a high-density screen draws the 800x600 game at, say, 1.6x) pieces that meet in game
 * pixels meet on fractional screen pixels, and the browser softens each image's edge there: faint lines between
 * floor tiles and background pieces that shimmer as the camera moves. So every unrotated image is drawn with its
 * edges rounded to whole screen pixels; two pieces that touch round to the same edge and close up.
 *
 * Most images already land on whole screen pixels (the canvas is a whole number of pixels to a game pixel, and tiles,
 * characters and tags are placed on its grid): those are drawn as they are, with one call. Only the rest are
 * rounded, which takes a save, a transform and a restore round the draw. The transform is kept here alongside the
 * context's own (its save / restore / translate / scale / rotate / transform / setTransform / resetTransform pass
 * through this), because asking the context for it made a new object for every image drawn: thousands a frame in a
 * crowd. Every 512th draw it is checked against the context's, and taken from it if anything changed it unseen (the
 * canvas being resized resets it).
 */
export function snapToPixels(ctx) {
  if (ctx.snapsToPixels) return ctx;   // (a Game made again on the same canvas)
  ctx.snapsToPixels = true;
  const N = {};
  for (const k of ['drawImage', 'save', 'restore', 'translate', 'scale', 'rotate', 'transform', 'setTransform', 'resetTransform', 'getTransform']) N[k] = ctx[k].bind(ctx);
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0, calls = 0;
  const stack = [];
  const take = () => { const m = N.getTransform(); a = m.a; b = m.b; c = m.c; d = m.d; e = m.e; f = m.f; };
  take();
  /** The canvas was resized (its context starts over): the transform is taken from it, nothing is saved. */
  ctx.resync = () => { stack.length = 0; take(); };
  ctx.save = () => { stack.push(a, b, c, d, e, f); N.save(); };
  ctx.restore = () => {
    if (stack.length) { f = stack.pop(); e = stack.pop(); d = stack.pop(); c = stack.pop(); b = stack.pop(); a = stack.pop(); }
    N.restore();
  };
  ctx.translate = (x, y) => { e += a * x + c * y; f += b * x + d * y; N.translate(x, y); };
  ctx.scale = (x, y) => { a *= x; b *= x; c *= y; d *= y; N.scale(x, y); };
  ctx.rotate = (r) => {
    const co = Math.cos(r), si = Math.sin(r), a0 = a, b0 = b;
    a = a0 * co + c * si; b = b0 * co + d * si; c = c * co - a0 * si; d = d * co - b0 * si;
    N.rotate(r);
  };
  ctx.transform = (a2, b2, c2, d2, e2, f2) => {
    const a0 = a, b0 = b, c0 = c, d0 = d;
    a = a0 * a2 + c0 * b2; b = b0 * a2 + d0 * b2; c = a0 * c2 + c0 * d2; d = b0 * c2 + d0 * d2;
    e += a0 * e2 + c0 * f2; f += b0 * e2 + d0 * f2;
    N.transform(a2, b2, c2, d2, e2, f2);
  };
  ctx.setTransform = (...v) => {
    N.setTransform(...v);
    if (v.length === 6) { a = v[0]; b = v[1]; c = v[2]; d = v[3]; e = v[4]; f = v[5]; } else take();
  };
  ctx.resetTransform = () => { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; N.resetTransform(); };
  const whole = (v) => Math.abs(v - Math.round(v)) < 1e-6;
  const check = () => {
    const m = N.getTransform(), off = (x, y) => Math.abs(x - y) > 1e-6;
    if (off(m.a, a) || off(m.b, b) || off(m.c, c) || off(m.d, d) || off(m.e, e) || off(m.f, f)) { stack.length = 0; take(); }
  };
  ctx.drawImage = function (img, p1, p2, p3, p4, p5, p6, p7, p8) {
    const n = arguments.length;
    if ((++calls & 511) === 0) check();
    const plain = () => (n === 3 ? N.drawImage(img, p1, p2) : n === 5 ? N.drawImage(img, p1, p2, p3, p4) : N.drawImage(img, p1, p2, p3, p4, p5, p6, p7, p8));
    // turned, or one to one on whole pixels: as it is
    if (b || c || (a === 1 && d === 1 && e === Math.round(e) && f === Math.round(f))) return plain();
    let sx = 0, sy = 0, sw = img.width, sh = img.height, dx, dy, dw, dh;
    if (n === 3) { dx = p1; dy = p2; dw = sw; dh = sh; }
    else if (n === 5) { dx = p1; dy = p2; dw = p3; dh = p4; }
    else { sx = p1; sy = p2; sw = p3; sh = p4; dx = p5; dy = p6; dw = p7; dh = p8; }
    // the rectangle's corners on screen
    const fx0 = a * dx + e, fx1 = a * (dx + dw) + e, fy0 = d * dy + f, fy1 = d * (dy + dh) + f;
    if (whole(fx0) && whole(fx1) && whole(fy0) && whole(fy1)) return plain();   // already on whole pixels
    // rounded; a mirrored draw (negative scale) just swaps the ends
    let x0 = Math.round(fx0), x1 = Math.round(fx1), y0 = Math.round(fy0), y1 = Math.round(fy1);
    N.save();
    N.setTransform(Math.sign(a) || 1, 0, 0, Math.sign(d) || 1, 0, 0);
    if (a < 0) { x0 = -x0; x1 = -x1; }
    if (d < 0) { y0 = -y0; y1 = -y1; }
    N.drawImage(img, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0);
    N.restore();
  };
  return ctx;
}
