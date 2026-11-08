import { settings } from './settings.js';
import { IS_TOUCH_DEVICE } from './touchdevice.js';

/**
 * The game's screen size in game pixels, set by the System Option SCREEN SIZE (800x600 by default). The phone sizes
 * are a phone's shape at 600 game pixels tall (the interface needs 800x600), so the game fills its screen without
 * black bars: the iPhone 15 (and every iPhone 14 Pro, 15 and 16, 19.5:9), most Androids now (20:9) and older ones (18:9).
 */
export const RESOLUTIONS = [[800, 600], [1024, 768], [1280, 720], [1280, 960], [1366, 768], [1600, 900], [1920, 1080],
  [1300, 600, 'iPhone 15'], [1333, 600, 'Android'], [1200, 600, 'Android 18:9']];
export const BASE_W = 800, BASE_H = 600;
export let VIEW_W = BASE_W, VIEW_H = BASE_H;
/**
 * System Option UI SIZE: the interface (status bar, windows, notices) is drawn UI_SCALE times larger, laid out on a
 * UI_W x UI_H screen. It goes up in 10% steps and never past the size that leaves that screen 800x600 or bigger;
 * on a phone size, 800x400 (a phone's screen is small, so its buttons need to be bigger to tap; a window taller than
 * that is dragged up to reach its bottom).
 */
export let UI_SCALE = 1, UI_W = BASE_W, UI_H = BASE_H;

export const resolutionName = ([w, h, label]) => `${w} x ${h}${label ? `  ${label}` : ''}`;
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
  const phone = settings.fit ? IS_TOUCH_DEVICE : !!RESOLUTIONS[resolutionIndex()][2];
  const minH = phone ? PHONE_UI_H : BASE_H;
  return Math.max(1, Math.floor(Math.min(VIEW_W / BASE_W, VIEW_H / minH) * 10 + 1e-9) / 10);
};

/** Sizes the view to the chosen resolution; the page keeps the canvas at that shape, fitted to the window. */
export function applyResolution() {
  [VIEW_W, VIEW_H] = settings.fit ? fitSize() : RESOLUTIONS[resolutionIndex()];
  UI_SCALE = Math.min(maxUiScale(), Math.max(1, Math.round((Number(settings.uiScale) || 1) * 10) / 10));
  UI_W = VIEW_W / UI_SCALE; UI_H = VIEW_H / UI_SCALE;
  document.documentElement.style.setProperty('--view-ar', String(VIEW_W / VIEW_H));
  document.body?.classList.toggle('fit-screen', !!settings.fit && !portrait());   // System Option FIT TO SCREEN (4:3 upright)
}
applyResolution();
