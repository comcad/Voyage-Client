import { settings } from './settings.js';

/** The game's screen size in game pixels, set by the System Option SCREEN SIZE (800x600 by default). */
export const RESOLUTIONS = [[800, 600], [1024, 768], [1280, 720], [1280, 960], [1366, 768], [1600, 900], [1920, 1080]];
export const BASE_W = 800, BASE_H = 600;
export let VIEW_W = BASE_W, VIEW_H = BASE_H;
/**
 * System Option UI SIZE: the interface (status bar, windows, notices) is drawn UI_SCALE times larger, laid out on a
 * UI_W x UI_H screen. It goes up in 10% steps and never past the size that leaves that screen 800x600 or bigger.
 */
export let UI_SCALE = 1, UI_W = BASE_W, UI_H = BASE_H;

export const resolutionName = ([w, h]) => `${w} x ${h}`;
export function resolutionIndex() {
  const i = RESOLUTIONS.findIndex(([w, h]) => `${w}x${h}` === settings.resolution);
  return i < 0 ? 0 : i;
}
/** The largest UI SIZE the screen size allows. */
export const maxUiScale = () => Math.max(1, Math.floor(Math.min(VIEW_W / BASE_W, VIEW_H / BASE_H) * 10 + 1e-9) / 10);

/** Sizes the view to the chosen resolution; the page keeps the canvas at that shape, fitted to the window. */
export function applyResolution() {
  [VIEW_W, VIEW_H] = RESOLUTIONS[resolutionIndex()];
  UI_SCALE = Math.min(maxUiScale(), Math.max(1, Math.round((Number(settings.uiScale) || 1) * 10) / 10));
  UI_W = VIEW_W / UI_SCALE; UI_H = VIEW_H / UI_SCALE;
  document.documentElement.style.setProperty('--view-ar', String(VIEW_W / VIEW_H));
  document.body?.classList.toggle('fit-screen', !!settings.fit);   // System Option FIT TO SCREEN
}
applyResolution();
