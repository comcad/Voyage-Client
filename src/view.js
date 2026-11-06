import { settings } from './settings.js';

/** The game's screen size in game pixels, set by the System Option SCREEN SIZE (800x600 by default). */
export const RESOLUTIONS = [[800, 600], [1024, 768], [1280, 720], [1280, 960], [1366, 768], [1600, 900], [1920, 1080]];
export const BASE_W = 800, BASE_H = 600;
export let VIEW_W = BASE_W, VIEW_H = BASE_H;

export const resolutionName = ([w, h]) => `${w} x ${h}`;
export function resolutionIndex() {
  const i = RESOLUTIONS.findIndex(([w, h]) => `${w}x${h}` === settings.resolution);
  return i < 0 ? 0 : i;
}

/** Sizes the view to the chosen resolution; the page keeps the canvas at that shape, fitted to the window. */
export function applyResolution() {
  [VIEW_W, VIEW_H] = RESOLUTIONS[resolutionIndex()];
  document.documentElement.style.setProperty('--view-ar', String(VIEW_W / VIEW_H));
}
applyResolution();
