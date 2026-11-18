/**
 * The space beside a screen that doesn't fill the window - the 4:3 login screens (log in, worlds, characters) and Cash
 * Shop, and the game itself with FIT TO SCREEN off - beside it when the window is wider than the screen's shape (or
 * above and below it when the window is taller): instead of black, a still twilight sky - deep blue going to dusk,
 * soft blue and amber glows and out-of-focus specks of light in the corners, a faint pattern of gold maple leaves and
 * a vignette - behind the screen (a hole is cut where it is); and
 * over the screen's edges, gilded rails with two sapphire studs and a gold maple leaf on each and a gold boss on each
 * corner. Neither takes a tap or click. Both follow the screen's place every frame, at any window size.
 */
import { UI_W } from '../view.js';

/** A maple leaf, 24 x 24, its stem at the bottom. */
const LEAF = 'M12 1.5L13.6 5.1L16 3.9L15.4 8.1L18.7 5.7L19 7.8L22 7.5L20.2 10.5L22 12L17.8 13.8L18.7 15.9L14.2 15.3L13.5 20.1L12.75 20.1'
  + 'L12.75 22.5L11.25 22.5L11.25 20.1L10.5 20.1L9.8 15.3L5.3 15.9L6.2 13.8L2 12L3.8 10.5L2 7.5L5 7.8L5.3 5.7L8.6 8.1L8 3.9L10.4 5.1Z';
/** The leaves scattered over the sky, faint gold, at a slant. */
const PATTERN = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140">
<g fill="#ffd978" fill-opacity="0.07"><path transform="translate(14 12) rotate(-18 12 12) scale(1.1)" d="${LEAF}"/>
<path transform="translate(86 52) rotate(24 12 12) scale(0.8)" d="${LEAF}"/><path transform="translate(34 92) rotate(-40 12 12) scale(0.65)" d="${LEAF}"/>
<path transform="translate(104 112) rotate(10 12 12) scale(0.55)" d="${LEAF}"/></g></svg>`)}")`;
/** Gold across a rail: dark edges, a bright crest, as polished metal. */
const GOLD = '#1a1005 0%, #5e3a10 9%, #b47a24 22%, #f2cf75 38%, #fff3c4 46%, #e2a843 58%, #94591a 76%, #3f2508 92%, #1a1005 100%';
const SAPPHIRE = 'radial-gradient(circle at 34% 30%, #eef9ff 0%, #8fcfff 20%, #2f7ddb 50%, #133c80 78%, #0a1f45 100%)';
/** An out-of-focus speck of light: colour (r, g, b), opacity, size (vmin), where (x%, y%). */
const speck = (rgb, a, size, x, y) => `radial-gradient(circle ${size}vmin at ${x}% ${y}%, rgba(${rgb}, ${a}) 0%, rgba(${rgb}, ${a * 0.55}) 45%, rgba(${rgb}, 0) 100%)`;
const GOLDEN = '255, 196, 110', ICE = '140, 190, 255', ROSE = '255, 150, 170';
/** The sky: mostly in the corners and along the sides, the parts that show beside (or above and below) a screen. */
const SKY = [
  speck(GOLDEN, 0.22, 2.6, 7, 22), speck(ICE, 0.2, 1.8, 13, 38), speck(GOLDEN, 0.16, 3.4, 4, 63), speck(ROSE, 0.14, 2.2, 11, 80),
  speck(ICE, 0.18, 1.5, 9, 9), speck(GOLDEN, 0.2, 2.2, 93, 18), speck(ROSE, 0.14, 2.8, 88, 41), speck(ICE, 0.2, 1.7, 96, 57),
  speck(GOLDEN, 0.17, 3.2, 90, 76), speck(ICE, 0.15, 1.4, 86, 93), speck(GOLDEN, 0.15, 2, 30, 5), speck(ICE, 0.14, 1.6, 68, 4),
  speck(ROSE, 0.12, 2.2, 38, 96), speck(GOLDEN, 0.16, 1.8, 63, 95),
  'radial-gradient(ellipse 34% 42% at 0% 100%, rgba(255, 166, 72, 0.32), rgba(255, 166, 72, 0) 70%)',
  'radial-gradient(ellipse 34% 42% at 100% 100%, rgba(255, 166, 72, 0.3), rgba(255, 166, 72, 0) 70%)',
  'radial-gradient(ellipse 36% 46% at 0% 0%, rgba(84, 140, 255, 0.3), rgba(84, 140, 255, 0) 70%)',
  'radial-gradient(ellipse 36% 46% at 100% 0%, rgba(150, 112, 255, 0.26), rgba(150, 112, 255, 0) 70%)',
  'linear-gradient(180deg, #0c1836 0%, #14284f 42%, #1c2448 70%, #2b1e33 100%)',
].join(', ');

// #side-frames: the sky, behind the screen; #side-border: the rails, over its edges but under MOBILE UI's panels
// (6) (--t: a rail's thickness)
const CSS = `
#side-frames, #side-border { position: fixed; inset: 0; display: none; pointer-events: none; overflow: hidden; }
#side-frames { z-index: 4; }
#side-border { z-index: 5; }
#side-frames.sf-on, #side-border.sf-on { display: block; }
#side-frames .sf-sky { position: absolute; inset: 0; background: ${SKY}; }
#side-frames .sf-veil { position: absolute; inset: 0; background:
  radial-gradient(ellipse 75% 90% at 50% 50%, rgba(4, 8, 24, 0) 50%, rgba(3, 6, 18, 0.6) 100%), ${PATTERN};
  background-size: auto, 140px 140px; }
#side-border .sf-rail, #side-border .sf-boss { position: absolute; display: none; --t: 14px; }
#side-border .sf-show { display: block; }
#side-border .sf-l, #side-border .sf-r { background: linear-gradient(90deg, ${GOLD}); }
#side-border .sf-t, #side-border .sf-b { background: linear-gradient(180deg, ${GOLD}); }
#side-border .sf-rail { box-shadow: 0 0 8px 1px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(40, 22, 4, 0.6); }
/* an engraved line down the rail's middle */
#side-border .sf-rail::before { content: ''; position: absolute; background: rgba(70, 38, 6, 0.55); }
#side-border .sf-l::before, #side-border .sf-r::before { top: calc(var(--t) * 1.5); bottom: calc(var(--t) * 1.5); left: 50%; width: 1px; margin-left: -1px;
  box-shadow: 1px 0 0 rgba(255, 240, 200, 0.4); }
#side-border .sf-t::before, #side-border .sf-b::before { left: calc(var(--t) * 1.5); right: calc(var(--t) * 1.5); top: 50%; height: 1px; margin-top: -1px;
  box-shadow: 0 1px 0 rgba(255, 240, 200, 0.4); }
#side-border .sf-o { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
#side-border .sf-bare .sf-o { display: none; }
#side-border .sf-gem { width: calc(var(--t) * 1.15); height: calc(var(--t) * 1.15); border-radius: 22%; transform: translate(-50%, -50%) rotate(45deg);
  background: ${SAPPHIRE};
  box-shadow: 0 0 0 calc(var(--t) * 0.15) #f4cd66, 0 0 0 calc(var(--t) * 0.24) #6b420f, 0 2px 8px rgba(0, 0, 0, 0.6), 0 0 12px rgba(110, 180, 255, 0.45); }
#side-border .sf-leaf { width: calc(var(--t) * 2.5); height: calc(var(--t) * 2.5);
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7)) drop-shadow(0 0 7px rgba(255, 190, 80, 0.4)); }
#side-border .sf-leaf svg { display: block; width: 100%; height: 100%; }
#side-border .sf-boss { width: calc(var(--t) * 1.8); height: calc(var(--t) * 1.8); border-radius: 50%; transform: translate(-50%, -50%);
  background: radial-gradient(circle at 50% 50%, transparent 0 22%, #3f2508 23% 27%, transparent 28%),
    radial-gradient(circle at 36% 30%, #fff6d2 0%, #f2cf75 28%, #c88a2c 58%, #6e4410 88%, #2a1805 100%);
  box-shadow: 0 0 0 1px #2a1805, 0 3px 8px rgba(0, 0, 0, 0.65); }
#side-border .sf-boss::after { content: ''; position: absolute; left: 50%; top: 50%; width: 40%; height: 40%; border-radius: 50%;
  transform: translate(-50%, -50%); background: ${SAPPHIRE}; box-shadow: 0 0 6px rgba(110, 180, 255, 0.5); }
`;

/** A rail (side: l, r, t or b of the screen) with its ornaments: two studs and the leaf in the middle. */
function rail(side) {
  const r = document.createElement('div');
  r.className = `sf-rail sf-${side}`;
  const along = side === 'l' || side === 'r' ? 'top' : 'left';
  const put = (cls, at, html = '') => { const o = document.createElement('i'); o.className = `sf-o ${cls}`; o.style[along] = at; o.innerHTML = html; r.append(o); };
  put('sf-gem', '22%'); put('sf-gem', '78%');
  put('sf-leaf', '50%', `<svg viewBox="0 0 24 24"><defs><linearGradient id="sf-g${side}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/>
    <stop offset="0.45" stop-color="#f0bf52"/><stop offset="1" stop-color="#9a5e17"/></linearGradient></defs>
    <path d="${LEAF}" fill="url(#sf-g${side})" stroke="#3f2508" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="M12 20V6.5M12 12.5L16.5 9.5M12 12.5L7.5 9.5M12 16L15.5 14M12 16L8.5 14" stroke="#8a5512" stroke-width="0.7" stroke-linecap="round" fill="none"/></svg>`);
  return r;
}

/**
 * Where the screen is on the window; null when there is none: the login screen, the Cash Shop's 800x600, or in game
 * with FIT TO SCREEN off (or a window held upright), the game's own picture at its shape. In game fitted it fills the
 * window: nothing to frame.
 */
function screen() {
  if (document.body.classList.contains('at-login')) {
    const r = document.querySelector('#login-root .login-canvas')?.getBoundingClientRect();
    return r?.width ? r : null;
  }
  const g = globalThis.game, c = g?.canvas;
  if (!c || (!g.inCashShop && document.body.classList.contains('fit-screen'))) return null;
  const cr = c.getBoundingClientRect();
  if (!cr.width) return null;
  if (!g.inCashShop) return cr;
  const cs = g.csWin;
  if (!cs) return null;
  const k = cr.width / UI_W;
  return { left: cr.left + cs.x * k, top: cr.top + cs.y * k, width: cs.w * k, height: cs.h * k };
}

export function setupSideFrames() {
  // the hole needs a clip shape; a browser without one keeps the plain black bars
  if (!globalThis.CSS?.supports?.('clip-path', 'polygon(0 0, 1px 0, 0 1px)')) return;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.append(s);
  const back = document.createElement('div'), front = document.createElement('div');
  back.id = 'side-frames'; front.id = 'side-border';
  for (const el of [back, front]) el.setAttribute('aria-hidden', 'true');
  const sky = document.createElement('div'), veil = document.createElement('div');
  sky.className = 'sf-sky'; veil.className = 'sf-veil';
  back.append(sky, veil);
  const rails = { l: rail('l'), r: rail('r'), t: rail('t'), b: rail('b') };
  const boss = () => { const b = document.createElement('i'); b.className = 'sf-boss'; return b; };
  const bosses = { tl: boss(), tr: boss(), bl: boss(), br: boss() };
  front.append(...Object.values(rails), ...Object.values(bosses));
  const put = () => document.body.append(back, front);
  if (document.body) put(); else addEventListener('DOMContentLoaded', put, { once: true });

  let shape = '';
  const frame = () => {
    requestAnimationFrame(frame);
    const r = screen(), W = innerWidth, H = innerHeight;
    const gapX = r ? Math.max(r.left, W - r.left - r.width) : 0, gapY = r ? Math.max(r.top, H - r.top - r.height) : 0;
    const on = !!r && (gapX >= 6 || gapY >= 6);
    if (back.classList.contains('sf-on') !== on) { back.classList.toggle('sf-on', on); front.classList.toggle('sf-on', on); }
    if (!on) { shape = ''; return; }
    // the hole where the screen is, and the rails over its edges, only when its place or the window changes
    const l = Math.round(r.left), t = Math.round(r.top), w = Math.round(r.width), h = Math.round(r.height), rr = l + w, bb = t + h;
    const key = `${W}x${H}|${l},${t},${w},${h}`;
    if (key === shape) return;
    shape = key;
    // the window's outline, then the screen's the other way round (joined by a seam of no width): a frame with a hole
    const hole = `polygon(0 0, 0 ${H}px, ${l}px ${H}px, ${l}px ${t}px, ${rr}px ${t}px, ${rr}px ${bb}px, ${l}px ${bb}px, ${l}px ${H}px, ${W}px ${H}px, ${W}px 0)`;
    back.style.clipPath = hole; back.style.webkitClipPath = hole;
    // each rail lies along the screen's edge, its inner side about on it (its middle that far out: out), its studs,
    // leaf and corner bosses reaching a little over the screen; a side with (next to) no space beside it has none
    const thick = Math.max(8, Math.min(16, Math.round(h * 0.018)));
    const gap = { l, r: W - rr, t, b: H - bb };
    const size = {}, shown = {}, out = {};
    for (const k of ['l', 'r', 't', 'b']) {
      size[k] = Math.round(Math.min(thick, gap[k] * 2)); shown[k] = gap[k] >= 6;
      out[k] = shown[k] ? Math.max(0, Math.min(Math.max(3, Math.round(size[k] * 0.45)), gap[k] - Math.ceil(size[k] / 2))) : 0;
    }
    const place = (el, show, css, k, bare = false) => {
      el.classList.toggle('sf-show', show);
      if (!show) return;
      Object.assign(el.style, css);
      el.style.setProperty('--t', `${k}px`);
      el.classList.toggle('sf-bare', bare);
    };
    // the side rails run on over the corners when there are rails above and below too; the ornaments need some room
    const half = (k) => Math.round(k / 2);
    const xl = l - out.l, xr = rr + out.r, yt = t - out.t, yb = bb + out.b;   // where the rails' middles run
    const vt = shown.t ? yt - half(size.t) : t, vb = shown.b ? yb + half(size.b) : bb;
    const bare = (k) => gap[k] < size[k] * 1.4 + out[k];
    place(rails.l, shown.l, { left: `${xl - half(size.l)}px`, top: `${vt}px`, width: `${size.l}px`, height: `${vb - vt}px` }, size.l, bare('l'));
    place(rails.r, shown.r, { left: `${xr - half(size.r)}px`, top: `${vt}px`, width: `${size.r}px`, height: `${vb - vt}px` }, size.r, bare('r'));
    place(rails.t, shown.t, { left: `${xl}px`, top: `${yt - half(size.t)}px`, width: `${xr - xl}px`, height: `${size.t}px` }, size.t, bare('t'));
    place(rails.b, shown.b, { left: `${xl}px`, top: `${yb - half(size.b)}px`, width: `${xr - xl}px`, height: `${size.b}px` }, size.b, bare('b'));
    // a boss on each corner where two rails meet
    const corner = (el, sx, sy, x, y) => place(el, shown[sx] && shown[sy], { left: `${x}px`, top: `${y}px` }, Math.min(size[sx], size[sy]));
    corner(bosses.tl, 'l', 't', xl, yt); corner(bosses.tr, 'r', 't', xr, yt);
    corner(bosses.bl, 'l', 'b', xl, yb); corner(bosses.br, 'r', 'b', xr, yb);
  };
  requestAnimationFrame(frame);
}
