/**
 * System Option choices, kept on this device (storage and a cookie, see kept.js):
 *   quality   0..1  canvas density, NORMAL (1 pixel per game pixel) .. BEST (the screen's own density)
 *   hpAlert / mpAlert  0 .. 0.95 in steps of 0.05: the gauge flashes, and a pet with the potion pouch drinks, below
 *              this share (0 = never)
 *   shake     shake the screen with skills that do
 *   mobInfo   0 nothing / 1 HP bar / 2 name and HP bar, over monsters you hit
 *   resolution  the game's screen size, 'WxH'
 *   uiScale   the interface's size, 1 .. 1.8 in tenths (held to what the screen size allows)
 *   zoom      how close the view is on your character, 1 .. 2 in tenths (the interface keeps its size)
 *   fit       stretch the game to fill the window, without black bars
 *   fps       'vsync' (every screen refresh), 60 or 30: how many frames a second are drawn
 *   fpsMeter  the /fps performance meter is shown
 */
import { readKept, writeKept } from './kept.js';

const KEY = 'maple.sysopt';
export const DEFAULTS = { quality: 1, hpAlert: 0.5, mpAlert: 0.5, shake: true, mobInfo: 2, resolution: '800x600', uiScale: 1, zoom: 1, fit: false, fps: 'vsync', fpsMeter: false };
export const MOB_INFO = ['Do not mark', 'Mark HP only', 'Mark name and HP'];
/** FRAME RATE's choices, in the order the list shows them. */
export const FPS_CHOICES = [['vsync', 'VSync'], [60, '60 FPS'], [30, '30 FPS']];

export const settings = { ...DEFAULTS };
// only what DEFAULTS has, and only in the type DEFAULTS has it: a stored blob is not trusted to be this version's
// shape. A stale "60" string for fps or a key this version dropped used to land in settings as-is, and the System
// Option then failed its own findIndex into an accidental default; an unknown key would simply sit there.
try {
  const stored = JSON.parse(readKept(KEY) || '{}') || {};
  for (const [k, d] of Object.entries(DEFAULTS)) if (typeof stored[k] === typeof d) settings[k] = stored[k];
  // FRAME RATE is the one setting whose stored type is not its default's: the choices are 'vsync' or a number, so it
  // is taken on its own and the choice test below decides it, rather than the typeof check rejecting a stored 60
  if (FPS_CHOICES.some(([v]) => v === stored.fps)) settings.fps = stored.fps;
} catch { /* bad data: the defaults */ }
// a stored FRAME RATE that matches no choice (a stale "60" string) goes back to the default here, so the fallback is
// deliberate rather than whatever the System Option's findIndex happens to do
if (!FPS_CHOICES.some(([v]) => v === settings.fps)) settings.fps = DEFAULTS.fps;
// an alert outside 0 .. 95% (one kept from before it stopped at 95%) is the default again
for (const k of ['hpAlert', 'mpAlert']) if (!(settings[k] >= 0 && settings[k] <= 0.95)) settings[k] = DEFAULTS[k];

export function saveSettings() {
  writeKept(KEY, JSON.stringify(settings));
}
