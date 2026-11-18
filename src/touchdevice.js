/**
 * Phones and tablets: the page itself stays put. On a touch device (touch points, or a coarse pointer) the browser
 * may not zoom the page (pinch or double-tap: the viewport is fixed and touch-action is none), scroll or bounce it, select text or pop up its long-press menu over
 * the game, so every finger goes to the game. Text boxes still take taps and typing.
 * The game is played sideways: held upright, a phone shows "turn it sideways" over everything instead of the game,
 * and where the system lets a page hold the screen sideways (Android full screen, the installed app) it is asked to.
 */
export const IS_TOUCH_DEVICE = (navigator.maxTouchPoints || 0) > 0 || !!globalThis.matchMedia?.('(pointer: coarse)').matches;

const VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

const typing = (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;

export function setupTouchDevice() {
  if (!IS_TOUCH_DEVICE) return;
  document.documentElement.classList.add('touch-device');
  // no page zoom: the viewport is fixed at the device's width (index.html sets it too, before any script runs)
  let vp = document.querySelector('meta[name="viewport"]');
  if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.append(vp); }
  vp.content = VIEWPORT;
  // every listener is on the window, first in line (capture) and allowed to cancel (not passive), so nothing on the
  // page sees a touch before it is stopped
  const opts = { capture: true, passive: false };
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  // iOS Safari zooms with its own gesture events and ignores user-scalable=no
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) window.addEventListener(t, stop, opts);
  // a second finger never starts a pinch; one finger never scrolls the page (unless it is in a text box)
  window.addEventListener('touchstart', (e) => { if (e.touches.length > 1) stop(e); }, opts);
  // (MOBILE UI's scrolling lists, marked data-scroll, still slide)
  window.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (!typing(e.target) && !e.target?.closest?.('[data-scroll]'))) stop(e); }, opts);
  // a touch screen laptop pinches with ctrl + wheel
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) stop(e); }, opts);
  // no long-press menu (copy / save image) over the game
  window.addEventListener('contextmenu', (e) => { if (!typing(e.target)) e.preventDefault(); }, true);
  landscapeOnly();
}

const TURN_CSS = `
#turn-sideways { position: fixed; inset: 0; z-index: 100000; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  padding: 24px; text-align: center; color: #f2f5fb; font: 600 15px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif;
  background: radial-gradient(ellipse at 50% 40%, #1d2a4d, #070b18 70%); touch-action: none; -webkit-user-select: none; user-select: none; }
@media (orientation: portrait) { html.touch-device #turn-sideways { display: flex; } }
#turn-sideways svg { width: 92px; height: 92px; color: #ffd978; animation: turn-sideways 2.4s ease-in-out infinite; }
#turn-sideways b { font-size: 19px; font-weight: 800; }
#turn-sideways span { max-width: 280px; color: rgba(225, 232, 248, 0.65); font-size: 13px; font-weight: 500; }
@keyframes turn-sideways { 0%, 20% { transform: rotate(0deg); } 45%, 75% { transform: rotate(-90deg); } 100% { transform: rotate(0deg); } }
`;
const PHONE = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="20" y="6" width="24" height="52" rx="5"/><path d="M29 51h6"/></svg>';

/**
 * Sideways only: upright, a screen over everything asks for the phone to be turned (a page can't turn an iPhone's
 * screen itself); and the screen is asked to stay sideways wherever the system allows it - it may refuse until the
 * page is in full screen, so it is asked again then and at the first touch.
 */
function landscapeOnly() {
  const s = document.createElement('style');
  s.textContent = TURN_CSS;
  document.head.append(s);
  const note = document.createElement('div');
  note.id = 'turn-sideways';
  note.innerHTML = `${PHONE}<b>Turn your phone sideways</b><span>Voyage is played in landscape.</span>`;
  const put = () => document.body.append(note);
  if (document.body) put(); else addEventListener('DOMContentLoaded', put, { once: true });
  const lock = () => { try { globalThis.screen?.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* not here */ } };
  lock();
  addEventListener('pointerdown', lock, { once: true, capture: true });
  document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) lock(); });
}
