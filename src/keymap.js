/**
 * v83 key bindings. The server keeps 90 slots indexed by DirectInput scancode, each {type, action}:
 *   type 1 skill id, 2 item id, 4 window (0 equip, 1 items, 2 stats, 3 skills, 7 minimap, 8 quests...),
 *   5 basic action (50 pick up, 51 sit, 52 attack, 53 jump, 54 NPC chat), 6 face expression.
 */
export const CODE_TO_SC = {
  Escape: 1, Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
  Minus: 12, Equal: 13, KeyQ: 16, KeyW: 17, KeyE: 18, KeyR: 19, KeyT: 20, KeyY: 21, KeyU: 22, KeyI: 23, KeyO: 24, KeyP: 25,
  BracketLeft: 26, BracketRight: 27, ControlLeft: 29, ControlRight: 29, KeyA: 30, KeyS: 31, KeyD: 32, KeyF: 33, KeyG: 34, KeyH: 35,
  KeyJ: 36, KeyK: 37, KeyL: 38, Semicolon: 39, Quote: 40, Backquote: 41, ShiftLeft: 42, Backslash: 43, KeyZ: 44, KeyX: 45,
  KeyC: 46, KeyV: 47, KeyB: 48, KeyN: 49, KeyM: 50, Comma: 51, Period: 52, Slash: 53, ShiftRight: 54, AltLeft: 56, AltRight: 56,
  Space: 57, F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
  Home: 71, PageUp: 73, End: 79, PageDown: 81, Insert: 82, Delete: 83,
};
export const SC_LABEL = Object.fromEntries(Object.entries(CODE_TO_SC).map(([code, sc]) => [sc,
  code.replace(/^Key|^Digit/, '').replace(/Left$|Right$/, '').replace('Control', 'Ctrl').replace('Backquote', '`')
    .replace('Semicolon', ';').replace('Quote', "'").replace('Comma', ',').replace('Period', '.').replace('Slash', '/')
    .replace('Backslash', '\\').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Minus', '-').replace('Equal', '=')
    .replace('PageUp', 'PgUp').replace('PageDown', 'PgDn').replace('Insert', 'Ins').replace('Delete', 'Del').replace('Escape', 'Esc')]));

// GameConstants.DEFAULT_KEY / DEFAULT_TYPE / DEFAULT_ACTION in Cosmic (used offline / before KEYMAP arrives)
const DK = [18, 65, 2, 23, 3, 4, 5, 6, 16, 17, 19, 25, 26, 27, 31, 34, 35, 37, 38, 40, 43, 44, 45, 46, 50, 56, 59, 60, 61, 62, 63, 64, 57, 48, 29, 7, 24, 33, 41, 39];
const DT = [4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 4, 4, 5, 6, 6, 6, 6, 6, 6, 5, 4, 5, 4, 4, 4, 4, 4];
const DA = [0, 106, 10, 1, 12, 13, 18, 24, 8, 5, 4, 19, 14, 15, 2, 17, 11, 3, 20, 16, 9, 50, 51, 6, 7, 53, 100, 101, 102, 103, 104, 105, 54, 22, 52, 21, 25, 26, 23, 27];

export function defaultKeymap() {
  const km = {};
  DK.forEach((k, i) => { km[k] = { type: DT[i], action: DA[i] }; });
  return km;
}

export const ACTION = { PICKUP: 50, SIT: 51, ATTACK: 52, JUMP: 53, NPC_CHAT: 54 };
export const MENU = { EQUIP: 0, ITEMS: 1, STATS: 2, SKILLS: 3, BUDDY: 4, WORLDMAP: 5, MESSENGER: 6, MINIMAP: 7, QUESTS: 8, KEYS: 9, PARTY: 19, MONSTERBOOK: 22, PARTY_SEARCH: 25, FAMILY: 26 };
