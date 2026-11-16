/**
 * The Game Option switches (maple.gameopt): buddy, guild and alliance chat, and the invite rows.
 *
 * Read through here rather than from storage directly. The chat path asks for these on every incoming line, and
 * reading them is a cookie parse, a storage read and a JSON parse; the parsed object is kept and handed out until
 * a write replaces it, which is the only way it changes.
 */
import { readKept, writeKept } from './kept.js';

const KEY = 'maple.gameopt';
let cached = null;

/** The switches, as stored (a missing key means on). */
export function gameOptions() {
  if (cached) return cached;
  try { cached = JSON.parse(readKept(KEY) || '{}'); } catch { cached = {}; }
  return cached;
}

/** Replace the stored switches and the cache together. */
export function saveGameOptions(obj) {
  cached = { ...obj };
  writeKept(KEY, JSON.stringify(cached));
}

/** One switch is on unless it was turned off. */
export function optionOn(key) { return gameOptions()[key] !== false; }
