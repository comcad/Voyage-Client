import { settings } from './settings.js';
import { IS_TOUCH_DEVICE } from './touchdevice.js';

/** The game's screen size in game pixels, set by the System Option SCREEN SIZE (800x600 by default). */
export const RESOLUTIONS = [[800, 600], [1024, 768], [1280, 720], [1280, 960], [1366, 768], [1600, 900], [1920, 1080]];
export const BASE_W = 800, BASE_H = 600;
export let VIEW_W = BASE_W, VIEW_H = BASE_H;
/**
 * System Option UI SIZE: the interface (status bar, windows, notices) is drawn UI_SCALE times larger, laid out on a
 * UI_W x UI_H screen. It goes up in 10% steps and never past the size that leaves that screen 800x600 or bigger;
 * on a touch device fitted to its screen (FIT TO SCREEN), 800x400 (a phone's screen is small, so its buttons need to
 * be bigger to tap; a window taller than that is dragged up to reach its bottom).
 */
export let UI_SCALE = 1, UI_W = BASE_W, UI_H = BASE_H;
/**
 * A screen that is 800x600 and nothing else (the Cash Shop): while it is up, the interface is drawn as large as lets
 * all of it fit the window, whatever UI SIZE says (as the login screens are); UI SIZE comes back after.
 */
let wholeScreen = false;
export function setWholeScreen(on) { wholeScreen = !!on; }
/** Canvas pixels per game pixel, a whole number (see Game.fitBacking); moving things are drawn on that finer grid. */
export let PIXEL_SCALE = 1;
export function setPixelScale(k) { PIXEL_SCALE = k; }
/** A world position on the canvas's own pixel grid: whole game pixels at scale 1, finer above it. */
export const snapPx = (v) => Math.round(v * PIXEL_SCALE) / PIXEL_SCALE;

export const resolutionName = ([w, h]) => `${w} x ${h}`;
export function resolutionIndex() {
  const i = RESOLUTIONS.findIndex(([w, h]) => `${w}x${h}` === settings.resolution);
  return i < 0 ? 0 : i;
}
const PHONE_UI_H = 400;
const windowSize = () => [innerWidth || BASE_W, globalThis.visualViewport?.height || innerHeight || BASE_H];
/** A window taller than it is wide (a phone held upright). */
const portrait = () => { const [w, h] = windowSize(); return h > w; };
/**
 * FIT TO SCREEN: in a wide window the game takes the window's own size in game pixels (nothing stretched), made just
 * big enough to be 800x600 or more at the same shape (a phone's 852x393 is 1301x600). In a tall one (a phone held
 * upright) it stays 800x600, 4:3 across the screen with bars above and below.
 */
export function fitSize() {
  if (portrait()) return [BASE_W, BASE_H];
  const [w, h] = windowSize();
  const k = Math.max(1, BASE_W / w, BASE_H / h);
  return [Math.round(w * k), Math.round(h * k)];
}
/** The largest UI SIZE the screen size allows. */
export const maxUiScale = () => {
  const minH = settings.fit && IS_TOUCH_DEVICE ? PHONE_UI_H : BASE_H;
  return Math.max(1, Math.floor(Math.min(VIEW_W / BASE_W, VIEW_H / minH) * 10 + 1e-9) / 10);
};

/** Sizes the view to the chosen resolution; the page keeps the canvas at that shape, fitted to the window. */
export function applyResolution() {
  [VIEW_W, VIEW_H] = settings.fit ? fitSize() : RESOLUTIONS[resolutionIndex()];
  UI_SCALE = Math.min(maxUiScale(), Math.max(1, Math.round((Number(settings.uiScale) || 1) * 10) / 10));
  if (wholeScreen) UI_SCALE = Math.max(1, Math.min(VIEW_W / BASE_W, VIEW_H / BASE_H));
  UI_W = VIEW_W / UI_SCALE; UI_H = VIEW_H / UI_SCALE;
  document.documentElement.style.setProperty('--view-ar', String(VIEW_W / VIEW_H));
  document.body?.classList.toggle('fit-screen', !!settings.fit && !portrait());   // System Option FIT TO SCREEN (4:3 upright)
}
applyResolution();
// a phone turned (or its browser bars coming or going) before the game is up - the login screen, held upright first:
// the view takes its new shape then too. Every resize, a frame later: a phone tells of its turn before its new size
// is known (the game, once up, follows every resize itself and takes the shape as it starts)
let reshaping = 0;
const reshape = () => { if (!reshaping) reshaping = requestAnimationFrame(() => { reshaping = 0; applyResolution(); }); };
addEventListener('resize', reshape);
globalThis.visualViewport?.addEventListener('resize', reshape);
globalThis.matchMedia?.('(orientation: portrait)').addEventListener?.('change', reshape);
