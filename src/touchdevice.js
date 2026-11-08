/**
 * Phones and tablets: the page itself stays put. On a touch device (touch points, or a coarse pointer) the browser
 * may not zoom the page (pinch or double-tap: the viewport is fixed and touch-action is none), scroll or bounce it, select text or pop up its long-press menu over
 * the game, so every finger goes to the game. Text boxes still take taps and typing.
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
  window.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || !typing(e.target)) stop(e); }, opts);
  // a touch screen laptop pinches with ctrl + wheel
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) stop(e); }, opts);
  // no long-press menu (copy / save image) over the game
  window.addEventListener('contextmenu', (e) => { if (!typing(e.target)) e.preventDefault(); }, true);
}
