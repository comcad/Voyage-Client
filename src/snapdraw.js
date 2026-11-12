/**
 * At a fractional zoom (a high-density screen draws the 800x600 game at, say, 1.6x) pieces that meet in game
 * pixels meet on fractional screen pixels, and the browser softens each image's edge there: faint lines between
 * floor tiles and background pieces that shimmer as the camera moves. So every unrotated image is drawn with its
 * edges rounded to whole screen pixels; two pieces that touch round to the same edge and close up.
 *
 * Most images already land on whole screen pixels (the canvas is a whole number of pixels to a game pixel, and tiles,
 * characters and tags are placed on its grid): those are drawn as they are, with one call. Only the rest are
 * rounded, which takes a save, a transform and a restore round the draw.
 *
 * The transform is always the context's own, read from it: once, and again only after something that can change it
 * (restore / translate / scale / rotate / transform / setTransform / resetTransform, which pass through here just to
 * say so; a resized canvas says so through resync). Working it out here instead went wrong at scales that aren't
 * whole numbers: the interface was drawn out of place every so often.
 */
export function snapToPixels(ctx) {
  if (ctx.snapsToPixels) return ctx;   // (a Game made again on the same canvas)
  ctx.snapsToPixels = true;
  const N = {};
  for (const k of ['drawImage', 'save', 'restore', 'translate', 'scale', 'rotate', 'transform', 'setTransform', 'resetTransform', 'getTransform']) N[k] = ctx[k].bind(ctx);
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0, stale = true;
  const read = () => { const m = N.getTransform(); a = m.a; b = m.b; c = m.c; d = m.d; e = m.e; f = m.f; stale = false; };
  /** The canvas was resized (its context starts over), or anything else changed the transform unseen. */
  ctx.resync = () => { stale = true; };
  ctx.restore = () => { stale = true; N.restore(); };
  ctx.translate = (x, y) => { stale = true; N.translate(x, y); };
  ctx.scale = (x, y) => { stale = true; N.scale(x, y); };
  ctx.rotate = (r) => { stale = true; N.rotate(r); };
  ctx.transform = (a2, b2, c2, d2, e2, f2) => { stale = true; N.transform(a2, b2, c2, d2, e2, f2); };
  ctx.setTransform = (...v) => { stale = true; N.setTransform(...v); };
  ctx.resetTransform = () => { stale = true; N.resetTransform(); };
  if (typeof ctx.reset === 'function') { const reset = ctx.reset.bind(ctx); ctx.reset = () => { stale = true; reset(); }; }
  const whole = (v) => Math.abs(v - Math.round(v)) < 1e-6;
  ctx.drawImage = function (img, p1, p2, p3, p4, p5, p6, p7, p8) {
    const n = arguments.length;
    if (stale) read();
    // turned, or one to one on whole pixels: as it is
    if (b || c || (a === 1 && d === 1 && e === Math.round(e) && f === Math.round(f))) {
      return n === 3 ? N.drawImage(img, p1, p2) : n === 5 ? N.drawImage(img, p1, p2, p3, p4) : N.drawImage(img, p1, p2, p3, p4, p5, p6, p7, p8);
    }
    let sx = 0, sy = 0, sw = img.width, sh = img.height, dx, dy, dw, dh;
    if (n === 3) { dx = p1; dy = p2; dw = sw; dh = sh; }
    else if (n === 5) { dx = p1; dy = p2; dw = p3; dh = p4; }
    else { sx = p1; sy = p2; sw = p3; sh = p4; dx = p5; dy = p6; dw = p7; dh = p8; }
    // the rectangle's corners on screen
    const fx0 = a * dx + e, fx1 = a * (dx + dw) + e, fy0 = d * dy + f, fy1 = d * (dy + dh) + f;
    if (whole(fx0) && whole(fx1) && whole(fy0) && whole(fy1)) {   // already on whole pixels
      return n === 3 ? N.drawImage(img, p1, p2) : n === 5 ? N.drawImage(img, p1, p2, p3, p4) : N.drawImage(img, p1, p2, p3, p4, p5, p6, p7, p8);
    }
    // rounded; a mirrored draw (negative scale) just swaps the ends
    let x0 = Math.round(fx0), x1 = Math.round(fx1), y0 = Math.round(fy0), y1 = Math.round(fy1);
    N.save();
    N.setTransform(Math.sign(a) || 1, 0, 0, Math.sign(d) || 1, 0, 0);
    if (a < 0) { x0 = -x0; x1 = -x1; }
    if (d < 0) { y0 = -y0; y1 = -y1; }
    N.drawImage(img, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0);
    N.restore();   // (the context's own: the transform is back as it was read)
  };
  return ctx;
}
