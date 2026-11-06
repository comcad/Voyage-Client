/**
 * Controller and touch-screen layouts. They live in this browser (localStorage), not on the server: a phone's
 * touch buttons and a PC's controller differ per device. Each slot holds a binding like the server key map's,
 * {type, action}: 1 skill, 2 item, 3 face item, 4 window, 5 basic action, 6 face, 7 effect item, 8 macro.
 */
import { ACTION, MENU } from './keymap.js';

const STORE = 'voyage.controls';

/**
 * Controller buttons in the standard Gamepad layout (Xbox names; PlayStation in brackets). The D-pad (12-15)
 * and the left stick always move.
 */
export const PAD_BUTTONS = [
  { i: 0, label: 'A', alt: 'Cross' }, { i: 1, label: 'B', alt: 'Circle' }, { i: 2, label: 'X', alt: 'Square' },
  { i: 3, label: 'Y', alt: 'Triangle' }, { i: 4, label: 'LB', alt: 'L1' }, { i: 5, label: 'RB', alt: 'R1' },
  { i: 6, label: 'LT', alt: 'L2' }, { i: 7, label: 'RT', alt: 'R2' }, { i: 8, label: 'Back', alt: 'Share' },
  { i: 9, label: 'Start', alt: 'Options' }, { i: 10, label: 'LS', alt: 'L3' }, { i: 11, label: 'RS', alt: 'R3' },
  { i: 12, label: 'Up', alt: 'D-pad' }, { i: 13, label: 'Down', alt: 'D-pad' }, { i: 14, label: 'Left', alt: 'D-pad' },
  { i: 15, label: 'Right', alt: 'D-pad' },
];
/**
 * The D-pad buttons and the directions they hold when the D-pad moves. Which one moves is the layout's padMove:
 * 'dpad' (the D-pad moves; the stick doesn't) or 'ls' (the left stick moves and the D-pad's buttons take bindings).
 */
export const PAD_MOVE = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

export function defaultPad() {
  return {
    0: { type: 5, action: ACTION.JUMP }, 2: { type: 5, action: ACTION.ATTACK }, 1: { type: 5, action: ACTION.PICKUP },
    3: { type: 5, action: ACTION.NPC_CHAT }, 9: { type: 4, action: MENU.ITEMS }, 8: { type: 4, action: MENU.MINIMAP },
  };
}

/** Touch layout: positions are fractions of the 800x600 view (the button's centre). Hidden until turned on in Key Setting. */
export function defaultTouch() {
  return {
    show: 'off', size: 1, opacity: 0.75,
    stick: { x: 0.12, y: 0.74 },
    buttons: [
      // above the quick slots in the bottom-right corner
      { id: 1, x: 0.92, y: 0.62, b: { type: 5, action: ACTION.JUMP } },
      { id: 2, x: 0.81, y: 0.67, b: { type: 5, action: ACTION.ATTACK } },
      { id: 3, x: 0.82, y: 0.51, b: { type: 5, action: ACTION.PICKUP } },
      { id: 4, x: 0.93, y: 0.46, b: { type: 5, action: ACTION.NPC_CHAT } },
    ],
  };
}

export const TOUCH_MAX_BUTTONS = 10;

/** The words on Key Setting's function icons: windows and chat (type 4) and basic actions (type 5). */
const MENU_NAMES = ['Equipment', 'Item', 'Ability', 'Skill', 'Buddy', 'World Map', 'Messenger', 'Mini Map', 'Quest', 'Set Key',
  'To All', 'Whisper', 'To the Party', 'To a Friend', 'Shortcut', 'Quick Slot', 'Chat+', 'Guild', 'To Guild', 'Party', 'Helper',
  'To Spouse', 'Monster Book', 'Cash Shop', 'To Alliance', 'Party Search', 'Family', 'Medal'];
const ACTION_NAMES = { 50: 'Pick Up', 51: 'Sit', 52: 'Attack', 53: 'Jump', 54: 'NPC Chat' };

/** A function binding's name (shown as a word on touch and controller buttons), or null for skills, items and faces. */
export function bindingLabel(b) {
  if (b?.type === 4) return MENU_NAMES[b.action] || null;
  if (b?.type === 5) return ACTION_NAMES[b.action] || null;
  return null;
}

export function loadControls() {
  try {
    const c = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (c) return { pad: c.pad || defaultPad(), padMove: c.padMove === 'dpad' ? 'dpad' : 'ls', touch: { ...defaultTouch(), ...c.touch } };
  } catch { /* storage blocked or bad data: the defaults */ }
  return { pad: defaultPad(), padMove: 'ls', touch: defaultTouch() };
}

export function saveControls(c) {
  try { localStorage.setItem(STORE, JSON.stringify(c)); } catch { /* storage blocked: this session only */ }
}

export const cloneControls = (c) => JSON.parse(JSON.stringify(c));

/** Whether the touch controls show: 'on', 'off', or 'auto' (a touch screen). */
export function touchShown(t) {
  if (t.show === 'on') return true;
  if (t.show === 'off') return false;
  return (navigator.maxTouchPoints || 0) > 0 || matchMedia?.('(pointer: coarse)').matches;
}
