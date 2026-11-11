/**
 * System Option choices, kept on this device (storage and a cookie, see kept.js):
 *   quality   0..1  canvas density, NORMAL (1 pixel per game pixel) .. BEST (the screen's own density)
 *   hpAlert / mpAlert  0..1  the gauge flashes below this share (0 = never)
 *   shake     shake the screen with skills that do
 *   mobInfo   0 nothing / 1 HP bar / 2 name and HP bar, over monsters you hit
 *   resolution  the game's screen size, 'WxH'
 *   uiScale   the interface's size, 1 .. 1.8 in tenths (held to what the screen size allows)
 *   zoom      how close the view is on your character, 1 .. 2 in tenths (the interface keeps its size)
 *   fit       stretch the game to fill the window, without black bars
 *   fps       'vsync' (every screen refresh), 60 or 30: how many frames a second are drawn
 */
import { readKept, writeKept } from './kept.js';

const KEY = 'maple.sysopt';
export const DEFAULTS = { quality: 1, hpAlert: 0.2, mpAlert: 0.2, shake: true, mobInfo: 2, resolution: '800x600', uiScale: 1, zoom: 1, fit: false, fps: 'vsync' };
export const MOB_INFO = ['Do not mark', 'Mark HP only', 'Mark name and HP'];
/** FRAME RATE's choices, in the order the list shows them. */
export const FPS_CHOICES = [['vsync', 'VSync'], [60, '60 FPS'], [30, '30 FPS']];

export const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(readKept(KEY) || '{}')); } catch { /* bad data: the defaults */ }

export function saveSettings() {
  writeKept(KEY, JSON.stringify(settings));
}
