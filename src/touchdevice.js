/**
 * Phones and tablets: the page itself stays put. On a touch device (touch points, or a coarse pointer) the browser
 * may not zoom the page (pinch or double-tap: the viewport is fixed and touch-action is none), scroll or bounce it, select text or pop up its long-press menu over
 * the game, so every finger goes to the game. Text boxes still take taps and typing.
 */
export const IS_TOUCH_DEVICE = (navigator.maxTouchPoints || 0) > 0 || !!globalThis.matchMedia?.('(pointer: coarse)').matches;

const typing = (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;

export function setupTouchDevice() {
  if (!IS_TOUCH_DEVICE) return;
  document.documentElement.classList.add('touch-device');
  // no page zoom: the viewport is fixed at the device's width (iOS also needs the gesture events stopped below)
  let vp = document.querySelector('meta[name="viewport"]');
  if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.append(vp); }
  vp.content = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  const stop = (e) => e.preventDefault();
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
  // two fingers never pinch the page; one finger never scrolls it (unless it is in a text box)
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || !typing(e.target)) e.preventDefault(); }, { passive: false });
  // no long-press menu (copy / save image) over the game
  document.addEventListener('contextmenu', (e) => { if (!typing(e.target)) e.preventDefault(); });
}
