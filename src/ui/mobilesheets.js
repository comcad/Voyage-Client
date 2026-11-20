/**
 * MOBILE UI's windows: the Item, Equipment, Stat, Skill and Quest windows as sheets in its style, made for a phone:
 * one at a time, along the right side under its buttons, the field still showing on the left. They show what the
 * client's windows show and act through their code, so nothing behaves differently:
 *   - items: a double-click's use or equip (Game.useInventoryItem), dropping (InventoryWin.dropOutside, with its
 *     checks and prompts), moving a stack to another slot (ITEM_MOVE), offering it in a trade (TradeWin.offer), a
 *     scroll onto something you wear (Game.useScroll), dropping mesos (InventoryWin.dropMesos);
 *   - equipment: taking something off (Game.unequip);
 *   - stats: AP one at a time or AUTO (StatWin.raise / autoAssign);
 *   - skills: SP (SkillWin.canRaise / raiseId);
 *   - quests: the Quest window's lists; a picked quest slides out a panel to the left, as the window's detail panel
 *     does: the quest giver standing (its own frames), the level line, a chain's parts, the text in its own names for
 *     NPCs, items and monsters, the summary and rewards, the time left, and its buttons (give up, Quest Helper, Mark NPC);
 *   - System Options: the System Option window's rows (sound, screen, game) as sliders, switches and choices, applied
 *     as they change through the window's own code; Cancel puts back what was there when it opened;
 *   - Game Options: its rows as switches; Change Channel: the channels to tap (yours marked);
 *   - Key Setting: its Touch and Controller tabs (no keyboard part here): the touch controls on a little screen to
 *     drag about, the controller's buttons, and for the one picked what it does, from the functions, skills or items.
 *   - the community window, Party Search, Family, Medals and the Monster Book, through their own windows.
 * Item and skill icons are the game's own.
 */
import { EXP, jobName, itemDesc, isScroll, itemKeyType } from '../data.js';
import { richText, LIGHT_COLORS } from './richtext.js';
import { settings, saveSettings } from '../settings.js';
import { music, sfx } from '../audio.js';
import { UI_SCALE, UI_W, UI_H, VIEW_W, VIEW_H, maxUiScale } from '../view.js';
import { FUNCTIONS } from './windows.js';
import { BUTTON, STICK } from './keyconfig-tabs.js';
import { bindingLabel, PAD_BUTTONS, TOUCH_MAX_BUTTONS } from '../controls.js';
import { PANELS as PS_PANELS, FIRST_JOBS as PS_FIRST } from './partysearch.js';
import { ICONS as FAMILY_ICONS } from './family.js';
import { endedText } from './medal.js';

const INV_TABS = [[1, 'Equip'], [2, 'Use'], [3, 'Set-up'], [4, 'Etc'], [5, 'Cash']];
const EQ_STATS = [['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK'], ['hp', 'MaxHP'], ['mp', 'MaxMP'], ['watk', 'Weapon Attack'],
  ['matk', 'Magic Attack'], ['wdef', 'Weapon Defense'], ['mdef', 'Magic Defense'], ['acc', 'Accuracy'], ['avoid', 'Avoidability'],
  ['hands', 'Hands'], ['speed', 'Speed'], ['jump', 'Jump']];
/** The Equip window's grid (5 columns): each slot's [column, row] and name; the Cash tab's slots are these less 100. */
const EQUIP_GRID = {
  [-1]: [1, 0, 'Cap'], [-49]: [0, 1, 'Medal'], [-2]: [1, 1, 'Forehead'], [-12]: [3, 1, 'Ring'], [-13]: [4, 1, 'Ring'], [-3]: [2, 2, 'Eye'],
  [-4]: [3, 2, 'Earrings'], [-9]: [0, 3, 'Cape'], [-5]: [1, 3, 'Top'], [-17]: [2, 3, 'Pendant'], [-11]: [3, 3, 'Weapon'], [-10]: [4, 3, 'Shield'],
  [-8]: [0, 4, 'Gloves'], [-6]: [1, 4, 'Bottom'], [-50]: [2, 4, 'Belt'], [-15]: [3, 4, 'Ring'], [-16]: [4, 4, 'Ring'], [-7]: [2, 5, 'Shoes'],
};
const STATS = [['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK']];
const STARTERS = [0, 1000, 2000, 2001];
const QUEST_TABS = [[0, 'Available'], [1, 'In Progress'], [2, 'Completed']];
const TITLES = { items: 'Inventory', equip: 'Equipment', stats: 'Character', skills: 'Skills', quests: 'Quests', sysopt: 'System Options',
  keys: 'Key Setting', gameopt: 'Game Options', channel: 'Change Channel', community: 'Community', partysearch: 'Party Search', family: 'Family', medal: 'Medals', monsterbook: 'Monster Book' };
/** Sheets standing for a window with its own open / close (what Cancel goes back to, the touch controls held): its name. */
const WINDOW_OF = { sysopt: 'sysopt', keys: 'keyconfig', gameopt: 'gameopt', channel: 'channel', family: 'family', medal: 'medal' };
const MEDAL_TABS = [[0, 'Basic'], [1, 'Job'], [2, 'General'], [3, 'Challenge'], [4, 'Event']];
/** The Monster Book's sets of cards (the card id's thousands digit; 8 the special ones), after its summary (9). */
const BOOK_TABS = [[9, 'Info'], ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i, String(i + 1)]), [8, 'Special']];
const BOOK_PAGES = [['Basic', 1], ['Episode', 3], ['Drops', 4], ['Found in', 5]];
/** The community window's tabs, and each tab's buttons (its own, by name) with the words on their art. */
const COMMUNITY_TABS = [[0, 'Buddies'], [1, 'Party'], [2, 'Guild'], [3, 'Alliance'], [4, 'Blacklist']];
const COMMUNITY_TOOLS = [['add', 'Add Buddy'], ['group', 'Add Group'], ['online', 'Online only'], ['all', 'Show all']];
const COMMUNITY_BUTTONS = [
  [['whisper', 'Whisper'], ['talk', 'Messenger'], ['party', 'Party Invite'], ['groupChat', 'Group Chat'], ['note', 'Note'], ['mod', 'Change Group'],
    ['block', 'Block'], ['unblock', 'Unblock'], ['del', 'Delete']],
  [['create', 'Create'], ['invite', 'Invite'], ['whisper', 'Whisper'], ['talk', 'Messenger'], ['boss', 'Make Leader'], ['kick', 'Expel'],
    ['search', 'Party Search'], ['hp', 'Party HP'], ['leave', 'Leave']],
  [['whisper', 'Whisper'], ['talk', 'Messenger'], ['party', 'Party Invite'], ['where', 'Find'], ['up', 'Rank Up'], ['down', 'Rank Down'],
    ['kick', 'Expel'], ['invite', 'Invite'], ['notice', 'Notice'], ['bbs', 'Guild BBS'], ['leave', 'Leave']],
  [['whisper', 'Whisper'], ['talk', 'Messenger'], ['party', 'Party Invite'], ['up', 'Rank Up'], ['down', 'Rank Down'], ['change', 'Make Leader'],
    ['kick', 'Expel'], ['invite', 'Invite'], ['notice', 'Notice'], ['leave', 'Leave']],
  [['add', 'Add'], ['del', 'Delete']],
];
/** The menu's community entries: the tab they open. */
const COMMUNITY_OF = (m, MENU) => ({ [MENU.BUDDY]: 0, [MENU.PARTY]: 1, [MENU.GUILD]: 2 })[m];
/** Family's pedigree, in the order its plates go down the tree, with what each place is. */
const FAMILY_PLACES = [['leader', 'Leader'], ['grand', "Senior's Senior"], ['senior', 'Senior'], ['self', 'You'], ['sibling', "Senior's other Junior"],
  ['j0', 'Junior'], ['j1', 'Junior'], ['s00', "Junior's Junior"], ['s01', "Junior's Junior"], ['s10', "Junior's Junior"], ['s11', "Junior's Junior"]];
/** Game Option's rows (its keys, as the window keeps them) and the names on its art. */
const GAME_OPTS = [['whisper', 'Whisper'], ['friends', 'Friends'], ['chatInvite', 'Chat Invite'], ['tradeRequest', 'Trade Request'],
  ['partyInvite', 'Party Invite'], ['partySearch', 'Party Search'], ['gameInvite', 'Game Invite'], ['guildChat', 'Guild Chat'],
  ['guildInvite', 'Guild Invite'], ['allianceTournament', 'Alliance Tournament'], ['allianceInvite', 'Alliance Invite'], ['familyInvite', 'Family Invite']];
const KEY_SOURCES = [['fn', 'Functions'], ['skill', 'Skills'], ['item', 'Items']];
const sameBinding = (a, b) => !!a && !!b && a.type === b.type && a.action === b.action;
const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const CSS = `
/* under the buttons, at the screen's very right edge as they are */
.mhud .mh-sheet { position: absolute; right: 4px; top: 50px; bottom: calc(6px + env(safe-area-inset-bottom));
  width: min(400px, 62%); display: none; flex-direction: column; pointer-events: auto; overflow: hidden; }
.mhud .mh-sheet.mh-open { display: flex; }
.mhud.mh-sheeting .mh-chat { display: none; }
.mhud .mh-sh-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 7px 8px 5px 12px; }
.mhud .mh-sh-title { font-size: 13px; font-weight: 800; letter-spacing: 0.3px; }
.mhud .mh-sh-extra { flex: 1; text-align: right; font-size: 11px; color: rgba(225, 232, 248, 0.8); white-space: nowrap; }
.mhud .mh-sh-extra .mh-pill { display: inline-block; padding: 3px 9px; border-radius: 10px; background: rgba(255, 255, 255, 0.08); }
.mhud .mh-sh-x { width: 26px; height: 26px; flex: none; }
.mhud .mh-sh-x svg { width: 14px; height: 14px; }
.mhud .mh-sh-tabs { flex: none; display: flex; gap: 4px; padding: 0 8px 6px; overflow-x: auto; scrollbar-width: none; }
.mhud .mh-sh-tabs::-webkit-scrollbar { display: none; }
.mhud .mh-sh-tabs:empty { display: none; }
.mhud .mh-tab { flex: none; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; color: rgba(225, 232, 248, 0.75);
  background: rgba(255, 255, 255, 0.06); white-space: nowrap; cursor: pointer; }
.mhud .mh-tab.mh-on { color: #2e1d00; background: linear-gradient(180deg, #ffe58a, #f0b22e); }
.mhud .mh-banner { flex: none; margin: 0 8px 6px; padding: 5px 9px; border-radius: 8px; font-size: 11px; display: flex; align-items: center; gap: 8px;
  background: rgba(122, 170, 255, 0.22); border: 1px solid rgba(160, 196, 255, 0.35); }
.mhud .mh-banner span { flex: 1; }
.mhud .mh-sh-body { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 8px 8px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.mhud .mh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 4px; }
.mhud .mh-cell { position: relative; aspect-ratio: 1; border-radius: 8px; background: rgba(0, 0, 0, 0.32); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  display: grid; place-items: center; cursor: pointer; overflow: hidden; }
.mhud .mh-cell img { width: 32px; height: 32px; object-fit: none; image-rendering: pixelated; pointer-events: none; }
.mhud .mh-cell b { position: absolute; right: 3px; bottom: 1px; font-size: 9.5px; font-weight: 800; text-shadow: 0 0 2px #000, 0 0 2px #000; }
.mhud .mh-cell i { font-style: normal; font-size: 8.5px; color: rgba(225, 232, 248, 0.35); text-align: center; line-height: 1.1; padding: 2px; }
.mhud .mh-cell.mh-sel { box-shadow: inset 0 0 0 2px #ffd25e, 0 0 8px rgba(255, 210, 94, 0.45); }
.mhud .mh-cell.mh-from { box-shadow: inset 0 0 0 2px #8cc2ff; }
.mhud .mh-cell.mh-locked { opacity: 0.3; cursor: default; }
.mhud .mh-equip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; width: min(100%, 216px); margin: 0 auto; }
.mhud .mh-sh-detail { flex: none; max-height: 48%; overflow-y: auto; border-top: 1px solid rgba(255, 255, 255, 0.1); padding: 8px 10px 9px;
  background: rgba(0, 0, 0, 0.18); display: none; -webkit-overflow-scrolling: touch; }
.mhud .mh-sh-detail.mh-open { display: block; }
.mhud .mh-dt-head { display: flex; align-items: center; gap: 9px; }
.mhud .mh-dt-head img { width: 32px; height: 32px; object-fit: none; image-rendering: pixelated; flex: none; }
.mhud .mh-dt-name { font-size: 12.5px; font-weight: 800; }
.mhud .mh-dt-sub { font-size: 10px; color: rgba(225, 232, 248, 0.6); }
.mhud .mh-dt-text { margin-top: 5px; font-size: 11px; line-height: 1.35; color: rgba(232, 237, 248, 0.88); white-space: pre-wrap; }
.mhud .mh-dt-stats { margin-top: 5px; display: grid; grid-template-columns: 1fr 1fr; gap: 1px 10px; font-size: 10.5px; }
.mhud .mh-dt-stats span { color: rgba(225, 232, 248, 0.6); }
.mhud .mh-ctas { display: flex; flex-wrap: wrap; gap: 6px; margin: 7px 0 2px; }
.mhud .mh-cta { height: 28px; padding: 0 13px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.09);
  color: #f2f5fb; font: 700 11.5px -apple-system, "Segoe UI", system-ui, sans-serif; cursor: pointer; }
.mhud .mh-cta.mh-main { border: 0; color: #2e1d00; background: linear-gradient(180deg, #ffe07a, #f0aa2c); }
.mhud .mh-cta.mh-warn { color: #ffb0b0; }
.mhud .mh-cta:disabled { opacity: 0.35; }
.mhud .mh-sec { margin: 8px 0 4px; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: rgba(240, 190, 80, 0.85); }
.mhud .mh-sec:first-child { margin-top: 2px; }
.mhud .mh-kv { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 2px 4px; border-radius: 7px; font-size: 11.5px; }
.mhud .mh-kv:nth-child(even) { background: rgba(255, 255, 255, 0.03); }
.mhud .mh-kv span { width: 92px; flex: none; color: rgba(225, 232, 248, 0.6); }
.mhud .mh-kv em { flex: 1; font-style: normal; font-weight: 700; }
.mhud .mh-kv em small { font-weight: 500; color: rgba(225, 232, 248, 0.55); }
.mhud .mh-plus { width: 26px; height: 26px; flex: none; border-radius: 50%; border: 0; color: #2e1d00; font: 900 15px/26px system-ui, sans-serif;
  background: linear-gradient(180deg, #ffe07a, #f0aa2c); cursor: pointer; padding: 0; }
.mhud .mh-plus:disabled { opacity: 0.25; }
.mhud .mh-list .mh-li { display: flex; align-items: center; gap: 9px; min-height: 40px; padding: 4px 6px; border-radius: 9px; cursor: pointer; }
.mhud .mh-list .mh-li:nth-child(even) { background: rgba(255, 255, 255, 0.03); }
.mhud .mh-list .mh-li.mh-sel { background: rgba(255, 210, 94, 0.14); box-shadow: inset 0 0 0 1px rgba(255, 210, 94, 0.45); }
.mhud .mh-li img { width: 32px; height: 32px; object-fit: none; image-rendering: pixelated; flex: none; }
.mhud .mh-li .mh-li-main { flex: 1; min-width: 0; }
.mhud .mh-li .mh-li-name { font-size: 12px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-li .mh-li-sub { font-size: 10px; color: rgba(225, 232, 248, 0.6); }
.mhud .mh-li.mh-off .mh-li-name { color: rgba(225, 232, 248, 0.45); }
.mhud .mh-qd { position: absolute; top: 50px; bottom: calc(6px + env(safe-area-inset-bottom)); right: calc(10px + min(400px, 62%));
  width: min(330px, calc(100% - min(400px, 62%) - 18px - env(safe-area-inset-left))); display: flex; flex-direction: column;
  opacity: 0; transform: translateX(56px) scale(0.98); transform-origin: right center; pointer-events: none;
  transition: transform 0.32s cubic-bezier(0.2, 0.85, 0.25, 1), opacity 0.22s ease; }
.mhud .mh-qd.mh-open { opacity: 1; transform: none; pointer-events: auto; }
.mhud .mh-qd-head { flex: none; display: flex; align-items: center; gap: 7px; padding: 8px 8px 0 12px; }
.mhud .mh-qd-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #4dbb2b; box-shadow: 0 0 0 2px rgba(217, 247, 198, 0.55), 0 0 8px rgba(77, 187, 43, 0.6); }
.mhud .mh-qd-dot.mh-q1 { background: #f0b22e; box-shadow: 0 0 0 2px rgba(255, 232, 146, 0.5), 0 0 8px rgba(240, 178, 46, 0.6); }
.mhud .mh-qd-dot.mh-q2 { background: #8a94a8; box-shadow: 0 0 0 2px rgba(200, 208, 225, 0.35); }
.mhud .mh-qd-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 800; line-height: 1.2; }
.mhud .mh-qd-x { width: 26px; height: 26px; flex: none; }
.mhud .mh-qd-x svg { width: 14px; height: 14px; }
.mhud .mh-qd-lv { flex: none; padding: 1px 12px 0 27px; font-size: 10.5px; color: rgba(225, 232, 248, 0.65); }
.mhud .mh-qd-top { flex: none; display: flex; gap: 10px; align-items: flex-end; padding: 8px 12px 0; }
.mhud .mh-qd-stage { position: relative; flex: none; width: 92px; height: 96px; border-radius: 10px;
  background: radial-gradient(ellipse 60% 22% at 50% 88%, rgba(0, 0, 0, 0.45), transparent 70%),
    radial-gradient(ellipse at 50% 70%, rgba(255, 226, 150, 0.2), transparent 65%), linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.22));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
.mhud .mh-qd-stage img { position: absolute; image-rendering: pixelated; pointer-events: none; }
.mhud .mh-qd-npc { flex: 1; min-width: 0; padding-bottom: 4px; }
.mhud .mh-qd-npc b { display: block; font-size: 12px; color: #ffd978; }
.mhud .mh-qd-npc span { display: block; font-size: 10px; color: rgba(225, 232, 248, 0.6); }
.mhud .mh-qd-gauge { margin-top: 6px; height: 6px; border-radius: 3px; background: rgba(0, 0, 0, 0.45); overflow: hidden; }
.mhud .mh-qd-gauge i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #7be35c, #3fae26); }
.mhud .mh-qd-npc small { display: block; margin-top: 2px; font-size: 9.5px; color: rgba(225, 232, 248, 0.6); }
.mhud .mh-qd .mh-ctas { flex: none; padding: 0 12px; }
.mhud .mh-qd-body { flex: 1; min-height: 0; overflow-y: auto; margin-top: 4px; padding: 6px 12px 10px; border-top: 1px solid rgba(255, 255, 255, 0.08);
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.mhud .mh-qd-time { margin-top: 8px; font-size: 11px; font-weight: 800; color: #ff7a7a; }
.mhud .mh-empty { padding: 18px 6px; text-align: center; color: rgba(225, 232, 248, 0.5); font-size: 11.5px; }
/* System Options: its rows' controls */
.mhud .mh-opt em { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 600; }
.mhud .mh-slw { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
.mhud .mh-slw small { flex: none; min-width: 44px; text-align: right; font-size: 10.5px; font-weight: 700; color: rgba(225, 232, 248, 0.8); }
.mhud .mh-sl { position: relative; flex: 1; min-width: 60px; height: 28px; margin: 0 9px; cursor: pointer; }
html.touch-device .mhud .mh-sheet .mh-sl, .mhud .mh-sheet .mh-sl { touch-action: none; }
.mhud .mh-sl::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 6px; margin-top: -3px; border-radius: 3px; background: rgba(0, 0, 0, 0.45);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.mhud .mh-sl i { position: absolute; left: 0; top: 50%; height: 6px; margin-top: -3px; border-radius: 3px; background: linear-gradient(90deg, #f0b22e, #ffe07a); }
.mhud .mh-sl b { position: absolute; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: radial-gradient(circle at 50% 35%, #fff, #dfe6f5);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5); }
.mhud .mh-slw.mh-dis { opacity: 0.4; }
.mhud .mh-slw.mh-dis .mh-sl { cursor: default; }
.mhud .mh-sw { position: relative; flex: none; width: 42px; height: 24px; padding: 0; border: 0; border-radius: 12px; background: rgba(0, 0, 0, 0.45);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12); cursor: pointer; transition: background 0.2s; }
.mhud .mh-sw i { position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: #e9eefb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  transition: transform 0.2s; }
.mhud .mh-sw.mh-on { background: linear-gradient(180deg, #ffe07a, #f0aa2c); }
.mhud .mh-sw.mh-on i { transform: translateX(18px); }
.mhud .mh-seg { display: flex; flex-wrap: wrap; gap: 4px; }
.mhud .mh-opt button.mh-tab { border: 0; font-family: inherit; }
.mhud .mh-opt button.mh-tab:disabled { opacity: 0.4; cursor: default; }
.mhud .mh-select { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border-radius: 9px; border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.4);
  color: #f2f5fb; font: 600 12px -apple-system, "Segoe UI", system-ui, sans-serif; outline: none; }
.mhud .mh-select:disabled { opacity: 0.45; }
.mhud .mh-sh-detail .mh-ctas.mh-end { justify-content: flex-end; margin: 0; }
/* Change Channel */
.mhud .mh-ch-world { display: flex; justify-content: center; padding: 2px 0 8px; }
.mhud .mh-ch-world img { image-rendering: pixelated; }
.mhud .mh-ch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; }
.mhud .mh-ch { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 52px; border-radius: 10px; cursor: pointer;
  background: rgba(0, 0, 0, 0.3); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
.mhud .mh-ch b { font-size: 17px; font-weight: 800; line-height: 1.1; }
.mhud .mh-ch span { font-size: 8.5px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: rgba(225, 232, 248, 0.55); }
.mhud .mh-ch.mh-cur { background: rgba(122, 170, 255, 0.18); box-shadow: inset 0 0 0 1px rgba(160, 196, 255, 0.45); }
.mhud .mh-ch.mh-cur span { color: #9fc6ff; }
.mhud .mh-ch.mh-sel { box-shadow: inset 0 0 0 2px #ffd25e, 0 0 8px rgba(255, 210, 94, 0.45); }
/* Game Options: the names take the row, the switch at its end */
.mhud .mh-opt.mh-wide span { width: auto; flex: 1; }
.mhud .mh-opt.mh-wide em { flex: none; }
/* Key Setting: the screen with the touch controls on it, the controller's buttons, what a button does */
.mhud .mh-tp { position: relative; width: 100%; margin: 4px 0 8px; border-radius: 10px; overflow: hidden;
  background: linear-gradient(180deg, rgba(90, 110, 140, 0.45), rgba(40, 52, 72, 0.55)); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12); }
html.touch-device .mhud .mh-sheet .mh-tp, html.touch-device .mhud .mh-sheet .mh-tp *, .mhud .mh-sheet .mh-tp * { touch-action: none; }
.mhud .mh-tp-stick, .mhud .mh-tp-btn { position: absolute; aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%; display: grid; place-items: center;
  background: rgba(0, 0, 64, 0.63); box-shadow: 0 0 0 1.5px #fff; cursor: grab; }
/* (small on the little screen: a finger takes them from a little way off) */
.mhud .mh-tp-stick::before, .mhud .mh-tp-btn::before { content: ''; position: absolute; inset: -9px; border-radius: 50%; }
.mhud .mh-tp-stick::after { content: ''; width: 42%; aspect-ratio: 1; border-radius: 50%; background: #fff; }
.mhud .mh-tp-btn.mh-sel { box-shadow: 0 0 0 2px #ffd25e, 0 0 10px rgba(255, 210, 94, 0.8); }
.mhud .mh-tp-btn img { width: 72%; height: 72%; object-fit: contain; image-rendering: pixelated; pointer-events: none; }
.mhud .mh-tp-btn small { font-size: 7px; font-weight: 800; line-height: 1; text-align: center; padding: 0 1px; pointer-events: none; }
.mhud .mh-tp-hint { margin: -2px 0 8px; font-size: 10px; color: rgba(225, 232, 248, 0.55); }
.mhud .mh-pad { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 4px; margin: 4px 0 8px; }
.mhud .mh-padb small { position: absolute; left: 4px; top: 2px; font-size: 8.5px; font-weight: 800; color: rgba(255, 210, 94, 0.95); text-shadow: 0 0 2px #000; }
.mhud .mh-kp { padding: 6px 8px; margin: 2px 0 6px; border-radius: 9px; background: rgba(0, 0, 0, 0.22); }
.mhud .mh-kp > div:nth-child(2) { flex: 1; min-width: 0; }
.mhud .mh-kp .mh-cta { height: 26px; padding: 0 11px; }
/* Community, Party Search, Family */
.mhud .mh-dot { flex: none; width: 9px; height: 9px; margin: 0 4px 0 2px; border-radius: 50%; background: rgba(180, 190, 210, 0.35); }
.mhud .mh-dot.mh-on { background: #6fb6ff; box-shadow: 0 0 6px rgba(111, 182, 255, 0.6); }
.mhud .mh-dot.mh-here { background: #7be35c; box-shadow: 0 0 6px rgba(123, 227, 92, 0.6); }
.mhud .mh-dot.mh-blocked { background: #ff6b6b; }
.mhud .mh-list .mh-li { min-height: 36px; }
.mhud .mh-grp { display: flex; align-items: center; gap: 4px; margin: 8px 0 3px; border-radius: 7px; font-size: 11px; font-weight: 800; color: #9fc6ff; cursor: pointer; }
.mhud .mh-grp.mh-sel { background: rgba(255, 210, 94, 0.14); box-shadow: inset 0 0 0 1px rgba(255, 210, 94, 0.45); }
.mhud .mh-grp > span:last-child { flex: 1; padding: 4px 6px 4px 0; }
.mhud .mh-fold { flex: none; width: 24px; text-align: center; font-size: 12px; padding: 4px 0; color: rgba(225, 232, 248, 0.75); }
.mhud .mh-ghead { margin: 2px 0 6px; padding: 7px 9px; border-radius: 9px; background: rgba(0, 0, 0, 0.22); }
.mhud .mh-ghead b { display: block; font-size: 13px; font-weight: 800; color: #ffd978; }
.mhud .mh-ghead span { display: block; margin-top: 2px; font-size: 10.5px; color: rgba(225, 232, 248, 0.7); overflow-wrap: anywhere; }
.mhud .mh-empty.mh-small { padding: 4px 8px; text-align: left; font-size: 10.5px; }
.mhud .mh-in.mh-num { flex: none; width: 52px; text-align: center; }
.mhud .mh-opt em small { color: rgba(225, 232, 248, 0.6); font-weight: 600; }
.mhud .mh-tapsec { cursor: pointer; }
.mhud .mh-ps-state { flex: 1; align-self: center; font-size: 10.5px; color: rgba(225, 232, 248, 0.75); }
.mhud .mh-priv .mh-li-sub:last-child { white-space: normal; }
.mhud .mh-priv .mh-cta { flex: none; height: 26px; padding: 0 12px; }
/* Medals, Monster Book */
.mhud .mh-cell.mh-faint img { opacity: 0.28; filter: grayscale(0.6); }
.mhud .mh-qd .mh-ctas button.mh-tab { border: 0; font-family: inherit; }
.mhud .mh-qd .mh-ctas button.mh-tab:disabled { opacity: 0.35; cursor: default; }
`;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
/** A skill's or item's text without the client's colour codes. */
const plain = (s) => String(s || '').replace(/\\n/g, '\n').replace(/#[a-zA-Z]/g, '').replace(/#/g, '');

export class MobileSheets {
  constructor(hud, root) {
    this.hud = hud; this.g = hud.g;
    if (!document.getElementById('mhud-sheet-css')) {
      const s = document.createElement('style');
      s.id = 'mhud-sheet-css'; s.textContent = CSS;
      document.head.append(s);
    }
    const n = this.el = el('div', 'mh-sheet mh-glass');
    n.innerHTML = `<div class="mh-sh-head"><span class="mh-sh-title"></span><span class="mh-sh-extra"></span><div class="mh-btn mh-sh-x">${X_ICON}</div></div>
      <div class="mh-sh-tabs" data-scroll="x"></div><div class="mh-sh-banner"></div><div class="mh-sh-body" data-scroll="y"></div><div class="mh-sh-detail" data-scroll="y"></div>`;
    root.append(n);
    // the picked quest's panel, sliding out to the left of the sheet (from behind it)
    const q = this.qd = el('div', 'mh-qd mh-glass');
    q.innerHTML = `<div class="mh-qd-head"><span class="mh-qd-dot"></span><div class="mh-qd-title"></div><div class="mh-btn mh-qd-x" title="Close">${X_ICON}</div></div>
      <div class="mh-qd-lv"></div><div class="mh-qd-top"><div class="mh-qd-stage"></div><div class="mh-qd-npc"></div></div><div class="mh-ctas"></div><div class="mh-qd-body" data-scroll="y"></div>`;
    root.insertBefore(q, n);
    this.qp = { dot: q.querySelector('.mh-qd-dot'), title: q.querySelector('.mh-qd-title'), lv: q.querySelector('.mh-qd-lv'), stage: q.querySelector('.mh-qd-stage'),
      npc: q.querySelector('.mh-qd-npc'), acts: q.querySelector('.mh-ctas'), body: q.querySelector('.mh-qd-body') };
    hud.tap(q.querySelector('.mh-qd-x'), () => { this.sel = null; this.render(); });
    const $ = (s) => n.querySelector(s);
    this.p = { title: $('.mh-sh-title'), extra: $('.mh-sh-extra'), tabs: $('.mh-sh-tabs'), banner: $('.mh-sh-banner'), body: $('.mh-sh-body'), detail: $('.mh-sh-detail') };
    hud.tap($('.mh-sh-x'), () => this.closeAsked());
    this.kind = null; this.sig = '';
    this.tab = { items: 1, equip: 'worn', quests: 1, keys: 'touch', community: 0, ps: 1, family: 'info', medal: 0, mbook: 9 }; this.book = null;
    this.mtab = 0;       // the Monster Book card's page (Basic, Episode, Drops, Found in)
    this.kpick = null;   // Key Setting: the touch button's id or controller button picked
    this.ksrc = 'fn';    // Key Setting: what the bindings to choose from are (functions, skills, items)
    this.sel = null;     // the item slot, equipment slot, skill or quest picked
    this.move = null;    // an item being moved: the next slot tapped takes it
    this.pick = null;    // a scroll being put on: the next thing worn tapped takes it
    this.descs = new Map();
    this.timer = setInterval(() => this.refresh(), 300);
  }

  get open() { return !!this.kind; }
  get wm() { return this.g.windows; }
  /** MENU ids the sheets stand in for. */
  static kindOf(m, MENU) {
    return { [MENU.ITEMS]: 'items', [MENU.EQUIP]: 'equip', [MENU.STATS]: 'stats', [MENU.SKILLS]: 'skills', [MENU.QUESTS]: 'quests', [MENU.KEYS]: 'keys',
      [MENU.BUDDY]: 'community', [MENU.PARTY]: 'community', [MENU.GUILD]: 'community', [MENU.PARTY_SEARCH]: 'partysearch', [MENU.FAMILY]: 'family',
      [MENU.MEDAL]: 'medal', [MENU.MONSTERBOOK]: 'monsterbook' }[m] || null;
  }
  /** The community tab a MENU id opens (Buddy, Party, Guild), or undefined. */
  static communityTab(m, MENU) { return COMMUNITY_OF(m, MENU); }
  /** keep: System Options carries on from the window it takes over from (what CANCEL puts back stays that window's). */
  toggle(kind, keep = false) { if (this.kind === kind) this.close(); else this.show(kind, keep); }
  show(kind, keep = false) {
    if (this.kind !== kind) {
      this.leaving();
      if (!keep) this.wm.wins[WINDOW_OF[kind]]?.onOpen?.();   // as its window opens: what CANCEL goes back to, and the like
      this.sel = null; this.move = null; this.kpick = null; if (kind !== 'equip') this.pick = null; this.p.body.scrollTop = 0;
    }
    this.kind = kind;
    this.el.classList.add('mh-open'); this.hud.el.classList.add('mh-sheeting');
    this.render();
  }
  /** Leaving Key Setting: its window's own close (the touch controls back, quick slots not kept put back). */
  leaving() { if (this.kind === 'keys') this.wm.wins.keyconfig?.onClose?.(); }
  /** The X: as the window's, Key Setting with changes asks whether to save them first; it closes either way. */
  async closeAsked() {
    const w = this.wm.wins.keyconfig;
    if (this.kind === 'keys' && w?.changed() && await this.wm.confirm('Save the changes you made?')) w.apply();
    this.close();
  }
  close() {
    this.leaving();
    this.kind = null; this.sel = null; this.move = null; this.pick = null; this.kpick = null;
    this.el.classList.remove('mh-open'); this.hud.el.classList.remove('mh-sheeting');
    this.showQuest(false);
  }

  /** Drawn again when what it shows changes (an item moved, a level gained, an icon or name loaded). */
  refresh() {
    if (!this.kind || !this.g.stats || this.sliding || this.hud.busy) return;   // (not under a finger: a tap lands where it was)
    const sig = this.signature();
    if (sig !== this.sig) this.render();
  }
  signature() {
    const g = this.g, v = this.wm?.namesVersion || 0, s = g.stats, base = `${this.kind}|${v}|${JSON.stringify(this.sel)}|${!!this.move}|${!!this.pick}|${this.descs.size}`;
    if (this.kind === 'items') { const t = this.tab.items, inv = g.inventory?.[t] || {}; return `${base}|${t}|${g.meso}|${g.inventory?.limits?.[t]}|${Object.entries(inv).map(([k, it]) => `${k}:${it?.id}:${it?.quantity}`).join(',')}|${!!g.tradeWin}`; }
    if (this.kind === 'equip') return `${base}|${this.tab.equip}|${Object.entries(g.inventory?.equipped || {}).map(([k, it]) => `${k}:${it?.id}`).join(',')}`;
    if (this.kind === 'stats') return `${base}|${JSON.stringify([s.level, s.job, s.hp, s.mp, s.exp, s.fame, s.ap, s.str, s.dex, s.int, s.luk, g.maxHpShown(), g.maxMpShown(), g.guild?.name, g.statWindow?.()])}`;
    if (this.kind === 'skills') { const w = this.wm?.wins.skill; this.book ??= w?.books?.[w.books.length - 1]; if (w && this.book) w.book = this.book; return `${base}|${this.book}|${s.sp}|${(w?.list || []).map((id) => g.skills.level(id)).join(',')}|${!!g.skills?.strings}`; }
    if (this.kind === 'quests') {
      const w = this.wm?.wins.quest;
      if (!w) return base;
      const npc = this.sel ? w.questNpc(this.sel) : 0;
      return `${base}|${this.tab.quests}|${this.questEntries(w, this.tab.quests).map((e) => e.id).join(',')}|${w.portraits?.get(npc)?.length || 0}|${!!w.str}|${!!g.questTimers?.get(this.sel)}`;
    }
    if (this.kind === 'sysopt') {
      return `${base}|${JSON.stringify([settings, music.volume, music.muted, sfx.volume, sfx.muted, !!document.fullscreenElement, UI_SCALE, maxUiScale(), VIEW_W, VIEW_H])}`;
    }
    if (this.kind === 'keys') {
      const inv = [2, 3, 4, 5].map((t) => Object.values(g.inventory?.[t] || {}).map((it) => it?.id).join(',')).join('/');
      return `${base}|${this.tab.keys}|${this.kpick}|${this.ksrc}|${JSON.stringify(this.wm.wins.keyconfig?.ctlDraft)}|${Object.keys(g.skills?.levels || {}).length}|${inv}|${UI_W}x${UI_H}`;
    }
    if (this.kind === 'gameopt') return `${base}|${JSON.stringify(this.wm.wins.gameopt?.allow)}`;
    if (this.kind === 'community') {
      const w = this.wm.wins.userlist;
      // (what each list shows, field by field: the records may hold looks that don't make text)
      const mem = (list) => (list || []).map((m) => [m.id, m.name, m.job, m.level, m.channel, m.map, m.rank, m.online, m.allianceRank, m.group, m.pending].join(':')).join(',');
      const gu = (x) => (x ? `${x.id}|${x.name}|${x.notice}|${x.ranks}|${x.gp}|${mem(x.members)}` : '');
      return `${base}|${this.tab.community}|${w?.sel}|${w?.showOnline}|${[...(w?.closedGroups || [])]}|${this.guildInfo}|${mem(g.buddies)}|${g.party?.leader}|${mem(g.party?.members)}`
        + `|${gu(g.guild)}|${g.alliance ? `${g.alliance.name}|${g.alliance.notice}|${g.alliance.ranks}` : ''}|${(g.allianceGuilds || []).map(gu).join('/')}`
        + `|${w?.mine.black}|${[...(w?.mine.blocked || [])]}|${g.buddyCapacity}|${g.map?.id}|${g.channel}`;
    }
    if (this.kind === 'partysearch') {
      const w = this.wm.wins.partysearch;
      return `${base}|${w?.state}|${(w?.checked || []).map(Number).join('')}|${g.party?.leader}|${g.stats?.level}|${['min', 'max', 'members'].map((k) => w?.fields[k].value)}`;
    }
    if (this.kind === 'medal') {
      const w = this.wm.wins.medal, qw = this.wm.wins.quest, m = this.sel && w?.medals().find((x) => x.id === this.sel);
      return `${base}|${this.tab.medal}|${w?.area}|${[...(w?.folded || [])]}|${(w?.medals() || []).map((x) => `${x.id}:${x.state}`).join(',')}|${g.inventory?.equipped?.[-49]?.id}`
        + `|${m ? qw?.portraits?.get(m.npc)?.length || 0 : ''}|${m ? JSON.stringify(g.quests?.records?.[m.id] ?? '') : ''}`;
    }
    if (this.kind === 'monsterbook') {
      const w = this.wm.wins.monsterbook, b = g.monsterBook || {};
      return `${base}|${this.tab.mbook}|${this.mtab}|${!!w?.cards}|${w?.art?.mob}|${b.cover}|${Object.entries(b.cards || {}).map((e) => e.join(':')).join(',')}`;
    }
    if (this.kind === 'family') {
      const t = this.wm.wins.familytree;
      const c = t?.chart;
      return `${base}|${this.tab.family}|${JSON.stringify(g.family || null)}|${g.familyPrivileges?.length}|${t?.sel}`
        + `|${c ? c.members.map((m) => [m.id, m.senior, m.name, m.level, m.job, m.online].join(':')).join(',') : ''}`;
    }
    if (this.kind === 'channel') { const w = this.wm.wins.channel; return `${base}|${w?.pick}|${g.channel}|${w?.count}`; }
    return base;
  }
  render() {
    if (!this.kind) return;
    this.sig = this.signature();
    const p = this.p, keep = p.body.scrollTop;
    p.title.textContent = TITLES[this.kind];
    p.extra.replaceChildren(); p.tabs.replaceChildren(); p.banner.replaceChildren(); p.detail.replaceChildren();
    this.questShown = false;
    const body = this[this.kind]();
    this.showQuest(this.questShown);
    p.body.replaceChildren(body);
    p.body.scrollTop = keep;
    p.detail.classList.toggle('mh-open', p.detail.childElementCount > 0);
  }

  // ---------------------------------------------------------------- pieces
  tabs(list, cur, set) {
    for (const [k, label] of list) {
      const t = el('div', `mh-tab${k === cur ? ' mh-on' : ''}`, label);
      this.hud.tap(t, () => { set(k); this.sel = null; this.move = null; this.p.body.scrollTop = 0; this.render(); });
      this.p.tabs.append(t);
    }
  }
  banner(text, onCancel) {
    const b = el('div', 'mh-banner');
    b.append(el('span', null, text));
    const c = el('button', 'mh-cta', 'Cancel');
    this.hud.tap(c, onCancel);
    b.append(c);
    this.p.banner.append(b);
  }
  /** An item's or skill's icon from its node (the game's own image), or an empty image until it loads. */
  img(node) {
    const i = el('img'); i.alt = ''; i.draggable = false;
    if (node?._canvas) i.src = `${this.g.assets.base}/${node._canvas}`;
    else i.style.visibility = 'hidden';
    return i;
  }
  itemImg(id) { return this.img(this.wm.icon(id)); }
  button(label, fn, cls = '') {
    const b = el('button', `mh-cta${cls ? ` ${cls}` : ''}`, label);
    this.hud.tap(b, fn);
    return b;
  }
  /** An item's description, loaded once (the sheet is drawn again when it arrives). */
  desc(id) {
    if (!this.descs.has(id)) { this.descs.set(id, null); itemDesc(this.g.assets, id).then((d) => { this.descs.set(id, d || ''); this.descs.set(`v${id}`, 1); }); }
    return this.descs.get(id) || '';
  }
  /** The detail panel for an item: icon, name, count or stats, description, and the buttons. */
  itemDetail(it, sub, actions) {
    const d = this.p.detail, head = el('div', 'mh-dt-head');
    head.append(this.itemImg(it.id));
    const t = el('div');
    t.append(el('div', 'mh-dt-name', this.wm.itemName(it.id) || `Item ${it.id}`));
    if (sub) t.append(el('div', 'mh-dt-sub', sub));
    head.append(t);
    d.append(head);
    const a = el('div', 'mh-ctas');
    for (const b of actions) a.append(b);
    d.append(a);
    if (it.type === 1 || Math.floor(it.id / 1000000) === 1) {
      const rows = EQ_STATS.filter(([k]) => it[k]);
      if (rows.length || it.slots) {
        const g = el('div', 'mh-dt-stats');
        for (const [k, label] of rows) { const r = el('div'); r.append(el('span', null, `${label} `), `+${it[k]}`); g.append(r); }
        if (it.slots !== undefined) { const r = el('div'); r.append(el('span', null, 'Upgrades left '), String(it.slots)); g.append(r); }
        d.append(g);
      }
    }
    const text = plain(this.desc(it.id));
    if (text) d.append(el('div', 'mh-dt-text', text));
  }

  // ---------------------------------------------------------------- Inventory
  items() {
    const g = this.g, tab = this.tab.items, inv = g.inventory?.[tab] || {}, limit = g.inventory?.limits?.[tab] || 24;
    this.tabs(INV_TABS, tab, (k) => { this.tab.items = k; });
    const meso = el('span', 'mh-pill', `${fmt(g.meso)} mesos`);
    meso.title = 'Drop mesos';
    this.hud.tap(meso, () => this.wm.wins.inventory?.dropMesos());
    this.p.extra.append(meso);
    if (this.move) this.banner('Tap the slot to move it to.', () => { this.move = null; this.render(); });
    const grid = el('div', 'mh-grid');
    for (let slot = 1; slot <= Math.max(limit, 24); slot++) {
      const it = inv[slot], c = el('div', 'mh-cell');
      if (slot > limit) { c.classList.add('mh-locked'); grid.append(c); continue; }
      if (it) {
        c.append(this.itemImg(it.id));
        if (it.type !== 1 && (it.quantity || 0) > 1) c.append(el('b', null, String(it.quantity)));
      }
      if (this.sel === slot) c.classList.add('mh-sel');
      if (this.move?.slot === slot) c.classList.add('mh-from');
      this.hud.tap(c, () => this.itemTap(tab, slot));
      grid.append(c);
    }
    const it = this.sel && inv[this.sel];
    if (it && !this.move) {
      const slot = this.sel, acts = [];
      const use = { 1: 'Equip', 2: 'Use', 3: 'Use', 5: 'Use' }[tab];
      if (use) acts.push(this.button(use, () => g.useInventoryItem(tab, slot, it), 'mh-main'));
      if (tab === 2 && isScroll(it.id)) acts.push(this.button('Put on equipment', () => { this.pick = { slot, id: it.id }; this.show('equip'); }, 'mh-main'));
      if (g.tradeWin) acts.push(this.button('Offer in trade', () => g.tradeWin?.offer(tab, slot)));
      acts.push(this.button('Move', () => { this.move = { tab, slot }; this.render(); }));
      acts.push(this.button('Drop', () => this.wm.wins.inventory?.dropOutside({ kind: 'item', tab, slot, id: it.id }), 'mh-warn'));
      this.itemDetail(it, it.type !== 1 && it.quantity > 1 ? `Quantity ${fmt(it.quantity)}` : '', acts);
    }
    return grid;
  }
  itemTap(tab, slot) {
    const g = this.g, inv = g.inventory?.[tab] || {};
    if (this.move) {
      const from = this.move.slot;
      this.move = null;
      if (from !== slot && inv[from]) g.moveSlot(tab, from, slot);
      this.sel = null; this.render();
      return;
    }
    this.sel = this.sel === slot || !inv[slot] ? null : slot;
    this.render();
  }

  // ---------------------------------------------------------------- Equipment
  equip() {
    const g = this.g, worn = g.inventory?.equipped || {}, cash = this.tab.equip === 'cash';
    this.tabs([['worn', 'Equipped'], ['cash', 'Cash']], this.tab.equip, (k) => { this.tab.equip = k; });
    if (this.pick) this.banner(`Choose what to use ${this.wm.itemName(this.pick.id) || 'the scroll'} on.`, () => { this.pick = null; this.render(); });
    const grid = el('div', 'mh-equip');
    for (const [k, [col, row, name]] of Object.entries(EQUIP_GRID)) {
      const slot = Number(k) - (cash ? 100 : 0), it = worn[slot], c = el('div', 'mh-cell');
      c.style.gridColumn = String(col + 1); c.style.gridRow = String(row + 1);
      if (it) c.append(this.itemImg(it.id)); else c.append(el('i', null, name));
      if (this.sel === slot) c.classList.add('mh-sel');
      this.hud.tap(c, () => {
        if (this.pick) { const p = this.pick; this.pick = null; if (it) g.useScroll(p.slot, slot); this.render(); return; }
        this.sel = this.sel === slot || !it ? null : slot; this.render();
      });
      grid.append(c);
    }
    const it = this.sel && worn[this.sel];
    if (it && !this.pick) { const slot = this.sel; this.itemDetail(it, EQUIP_GRID[slot + (cash ? 100 : 0)]?.[2] || '', [this.button('Take off', () => { this.sel = null; g.unequip(slot); }, 'mh-main')]); }
    return grid;
  }

  // ---------------------------------------------------------------- Stats
  stats() {
    const g = this.g, s = g.stats, w = this.wm.wins.stat, need = EXP[s.level] || 1, out = el('div');
    const kv = (label, value, sub = '', plus = null) => {
      const r = el('div', 'mh-kv'), e = el('em', null, String(value));
      r.append(el('span', null, label));
      if (sub) { e.append(' '); e.append(el('small', null, sub)); }
      r.append(e);
      if (plus) r.append(plus);
      out.append(r);
    };
    out.append(el('div', 'mh-sec', 'Character'));
    kv('Name', s.name); kv('Job', jobName(s.job)); kv('Level', s.level); kv('Guild', g.guild?.name || '-'); kv('Fame', s.fame);
    kv('HP', `${fmt(s.hp)} / ${fmt(g.maxHpShown())}`); kv('MP', `${fmt(s.mp)} / ${fmt(g.maxMpShown())}`);
    kv('EXP', fmt(s.exp), `(${need >= 1 ? ((s.exp / need) * 100).toFixed(2) : 0}%)`);
    const starter = STARTERS.includes(s.job) && s.level <= 10, gm = Math.floor((s.job % 1000) / 100) === 9;
    out.append(el('div', 'mh-sec', 'Ability Points'));
    const apRow = el('div', 'mh-kv');
    apRow.append(el('span', null, 'Available'), el('em', null, String(s.ap || 0)));
    // AUTO as the window has it (a pirate's two: by STR or by DEX)
    if (!starter && !gm) for (const [flag, label] of s.job === 500 ? [[1, 'Auto (STR)'], [0, 'Auto (DEX)']] : [[1, 'Auto']]) {
      const b = this.button(label, () => w?.autoAssign(flag)); b.disabled = !s.ap; apRow.append(b);
    }
    out.append(apRow);
    const plus = (k) => {
      if (starter) return null;
      const b = el('button', 'mh-plus', '+');
      b.disabled = !s.ap || ((k === 'hp' || k === 'mp') && s.level < 20);
      this.hud.tap(b, () => w?.raise(k));
      return b;
    };
    for (const [k, label] of STATS) {
      const total = g.totalStat(k), d = total - s[k];
      kv(label, total, d ? `(${s[k]}${d > 0 ? '+' : ''}${d})` : '', plus(k));
    }
    kv('Max HP', fmt(g.maxHpShown()), '', plus('hp')); kv('Max MP', fmt(g.maxMpShown()), '', plus('mp'));
    const d = g.statWindow?.();
    if (d) {
      out.append(el('div', 'mh-sec', 'Details'));
      const b = ([v, x]) => (x ? [v + x, `(${v}${x > 0 ? '+' : ''}${x})`] : [v, '']);
      kv('Attack', d.attack ? `${fmt(d.attack[0])} ~ ${fmt(d.attack[1])}` : 0);
      for (const [label, pair] of [['Weapon Def.', d.wdef], ['Magic Attack', d.matk], ['Magic Def.', d.mdef], ['Accuracy', d.acc], ['Avoidability', d.avoid], ['Hands', d.hands]]) kv(label, ...b(pair));
      kv('Speed', `${d.speed}%`); kv('Jump', `${d.jump}%`);
    }
    return out;
  }

  // ---------------------------------------------------------------- Skills
  skills() {
    const g = this.g, sb = g.skills, w = this.wm.wins.skill, list = el('div', 'mh-list');
    if (!sb || !w) return list;
    const books = w.books;
    this.book = books.includes(this.book) ? this.book : books[books.length - 1];
    w.book = this.book;
    this.tabs(books.map((b) => [b, sb.bookName(b)]), this.book, (b) => { this.book = b; w.book = b; });
    this.p.extra.append(el('span', 'mh-pill', `SP ${w.sp}`));
    const ids = w.list;
    if (!ids.length) list.append(el('div', 'mh-empty', 'No skills in this book.'));
    for (const id of ids) {
      const lv = sb.level(id), max = sb.maxLevel(id), row = el('div', `mh-li${lv ? '' : ' mh-off'}${this.sel === id ? ' mh-sel' : ''}`);
      const node = sb.icon(id);
      if (!node) sb.ensure?.(id);
      row.append(this.img(node));
      const m = el('div', 'mh-li-main');
      m.append(el('div', 'mh-li-name', sb.name(id)), el('div', 'mh-li-sub', `Level ${lv} / ${max}`));
      row.append(m);
      if (w.canRaise(id)) { const b = el('button', 'mh-plus', '+'); this.hud.tap(b, () => { w.book = this.book; w.raiseId(id); }); row.append(b); }
      this.hud.tap(row, () => { this.sel = this.sel === id ? null : id; this.render(); });
      list.append(row);
    }
    if (this.sel && ids.includes(this.sel)) {
      const id = this.sel, d = this.p.detail, head = el('div', 'mh-dt-head');
      head.append(this.img(sb.icon(id)));
      const t = el('div');
      t.append(el('div', 'mh-dt-name', sb.name(id)), el('div', 'mh-dt-sub', `Level ${sb.level(id)} / ${sb.maxLevel(id)}`));
      head.append(t);
      d.append(head, el('div', 'mh-dt-text', plain(sb.desc(id))));
    }
    return list;
  }

  // ---------------------------------------------------------------- System Options
  /**
   * The System Option window's rows, through its own code (its values and setValue, its lists, revert): they apply
   * as you change them, as the window's do; Cancel puts back what was there when it opened, OK (or the X) keeps them.
   */
  sysopt() {
    const g = this.g, w = this.wm.wins.sysopt, out = el('div');
    if (!w) return out;
    const [, mob, size, fps] = w.combos();
    const row = (label, ...right) => { const r = el('div', 'mh-kv mh-opt'), e = el('em'); r.append(el('span', null, label)); e.append(...right); r.append(e); out.append(r); };
    const pct = (v) => `${Math.round(v * 100)}%`;
    const mute = (on, fn) => {
      const b = el('button', `mh-tab${on ? ' mh-on' : ''}`, 'Mute');
      b.type = 'button';
      this.hud.tap(b, () => { sfx.play('UI/BtMouseClick'); fn(); this.render(); });
      return b;
    };
    out.append(el('div', 'mh-sec', 'Sound'));
    row('Music', this.slider(w, 'bgm', () => pct(music.volume)), mute(music.muted, () => music.setMuted(!music.muted)));
    row('Effects', this.slider(w, 'sound', () => pct(sfx.volume)), mute(sfx.muted, () => sfx.setMuted(!sfx.muted)));
    out.append(el('div', 'mh-sec', 'Screen'));
    row('Quality', this.slider(w, 'quality', () => { const v = Number(settings.quality) || 0; return v <= 0.02 ? 'Speed' : v >= 0.98 ? 'Best' : pct(v); }));
    row('Fit to screen', this.switch(!!settings.fit, () => { settings.fit = !settings.fit; saveSettings(); g.setResolution?.(); }));
    row('Screen size', this.select(size));
    row('UI size', this.slider(w, 'uiScale', () => pct(w.pendingScale ?? UI_SCALE), Math.max(1, Math.round((maxUiScale() - 1) * 10))));
    row('Zoom', this.slider(w, 'zoom', () => pct(Number(settings.zoom) || 1), 10));
    row('Frame rate', this.choice(fps));
    if (document.documentElement.requestFullscreen) {   // (a phone's browser may have no full screen)
      const full = !!document.fullscreenElement;
      row('View', this.choice({ items: ['Window', 'Full screen'], value: full ? 1 : 0,
        set: (i) => { if (i) document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen?.(); } }));
    }
    out.append(el('div', 'mh-sec', 'Game'));
    const alert = (k) => () => (Number(settings[k]) ? pct(Number(settings[k])) : 'Off');
    row('HP alert', this.slider(w, 'hpAlert', alert('hpAlert'), 19));
    row('MP alert', this.slider(w, 'mpAlert', alert('mpAlert'), 19));
    row('Shake on skills', this.switch(!!settings.shake, () => { settings.shake = !settings.shake; saveSettings(); }));
    row('Monster info', this.choice(mob));
    row('Mobile UI', this.switch(!!settings.mobileUi, () => g.setMobileUi?.(!settings.mobileUi)));
    // OK keeps what was changed; Cancel puts it back (the sheet gone first, so turning MOBILE UI back off leaves nothing open)
    const a = el('div', 'mh-ctas mh-end');
    a.append(this.button('Cancel', () => { this.close(); w.revert(); }), this.button('OK', () => this.close(), 'mh-main'));
    this.p.detail.append(a);
    return out;
  }
  /** A slider on the window's value k (0..1), live as the finger moves; it clicks when pressed and let go, as the window's do. */
  slider(w, k, label, steps = 20) {
    const box = el('div', 'mh-slw'), sl = el('div', 'mh-sl'), fill = el('i'), knob = el('b'), val = el('small');
    sl.append(fill, knob); box.append(sl, val);
    const show = () => {
      const v = Math.max(0, Math.min(1, Number(w.value(k)) || 0));
      fill.style.width = `${v * 100}%`; knob.style.left = `${v * 100}%`; val.textContent = label();
    };
    show();
    if (w.off(k)) { box.classList.add('mh-dis'); return box; }
    const at = (e) => {
      const r = sl.getBoundingClientRect(), v = Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
      w.setValue(k, Math.round(v * steps) / steps);
      show();
    };
    sl.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      sl.setPointerCapture?.(e.pointerId);
      this.sliding = k; sfx.play('UI/BtMouseClick'); at(e);
    });
    sl.addEventListener('pointermove', (e) => { if (this.sliding === k) at(e); });
    // let go: the window's own let-go (its click, and UI SIZE applied then)
    const end = () => { if (this.sliding !== k) return; this.sliding = null; w.drag = k; w.up(); show(); };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) sl.addEventListener(t, end);
    return box;
  }
  /** An on / off switch: it flips at once, the change made, and the sheet catches up on its next look. */
  switch(on, fn) {
    const s = el('button', `mh-sw${on ? ' mh-on' : ''}`);
    s.type = 'button'; s.append(el('i'));
    this.hud.tap(s, () => { sfx.play('UI/BtMouseClick'); s.classList.toggle('mh-on'); fn(); });
    return s;
  }
  /** One of a short list (one of the window's combo boxes) as pills. */
  choice(c) {
    const box = el('div', 'mh-seg');
    c.items.forEach((t, i) => {
      const b = el('button', `mh-tab${i === c.value ? ' mh-on' : ''}`, t);
      b.type = 'button'; b.disabled = !!c.off;
      this.hud.tap(b, () => { if (c.off || i === c.value) return; sfx.play('UI/BtMouseClick'); c.set(i); this.render(); });
      box.append(b);
    });
    return box;
  }
  /** A longer list (the screen sizes) in the device's own picker. */
  select(c) {
    const s = el('select', 'mh-select');
    c.items.forEach((t, i) => { const o = el('option', null, t); o.value = String(i); s.append(o); });
    s.value = String(c.value); s.disabled = !!c.off;
    for (const t of ['pointerdown', 'keydown', 'keyup']) s.addEventListener(t, (e) => e.stopPropagation());
    s.addEventListener('change', () => { sfx.play('UI/BtMouseClick'); c.set(Number(s.value)); this.render(); });
    return s;
  }

  // ---------------------------------------------------------------- Change Channel
  /** The Change Channel window's channels (its pick and its go): yours marked, the picked one lit; a second tap goes. */
  channel() {
    const g = this.g, w = this.wm.wins.channel, out = el('div');
    if (!w) return out;
    const world = w.C?.world?.[g.worldId ?? 0];
    if (world?._canvas) { const b = el('div', 'mh-ch-world'); b.append(this.img(world)); out.append(b); }
    const grid = el('div', 'mh-ch-grid');
    for (let i = 0; i < w.count; i++) {
      const c = el('div', `mh-ch${i === w.pick ? ' mh-sel' : ''}${i === g.channel ? ' mh-cur' : ''}`);
      c.append(el('b', null, String(i + 1)), el('span', null, i === g.channel ? 'Here' : 'Channel'));
      this.hud.tap(c, () => {
        if (w.pick === i && i !== g.channel) { this.close(); w.go(); return; }
        w.pick = i; this.render();
      });
      grid.append(c);
    }
    out.append(grid);
    const a = el('div', 'mh-ctas mh-end'), go = this.button('Change Channel', () => { this.close(); w.go(); }, 'mh-main');
    go.disabled = w.pick === g.channel;   // (on your own channel it does nothing, as the window's)
    a.append(this.button('Cancel', () => this.close()), go);
    this.p.detail.append(a);
    return out;
  }

  // ---------------------------------------------------------------- Game Options
  /** Game Option's rows as switches, kept as the window keeps them; Cancel puts back what they were when it opened. */
  gameopt() {
    const w = this.wm.wins.gameopt, out = el('div');
    if (!w) return out;
    out.append(el('div', 'mh-sec', 'Allow'));
    for (const [k, label] of GAME_OPTS) {
      const r = el('div', 'mh-kv mh-opt mh-wide'), e = el('em');
      e.append(this.switch(w.allow[k] !== false, () => {
        w.allow[k] = w.allow[k] === false;
        try { localStorage.setItem('maple.gameopt', JSON.stringify(w.allow)); } catch { /* storage off */ }
      }));
      r.append(el('span', null, label), e);
      out.append(r);
    }
    const a = el('div', 'mh-ctas mh-end');
    a.append(this.button('Cancel', () => { this.close(); w.cancel(); }), this.button('OK', () => this.close(), 'mh-main'));
    this.p.detail.append(a);
    return out;
  }

  // ---------------------------------------------------------------- Key Setting
  /**
   * Key Setting's Touch and Controller tabs (MOBILE UI has no keyboard part), on the window's own draft: tap a button
   * (on the touch screen, where buttons are also dragged to move them, or the controller's) and then what it is to do
   * from the functions, your skills or your items. OK keeps the changes; Cancel drops them.
   */
  keys() {
    const g = this.g, w = this.wm.wins.keyconfig, out = el('div');
    if (!w) return out;
    const tab = this.tab.keys, d = w.ctlDraft, t = d.touch;
    this.tabs([['touch', 'Touch'], ['controller', 'Controller']], tab, (k) => { this.tab.keys = k; this.kpick = null; });
    const row = (label, ...right) => { const r = el('div', 'mh-kv mh-opt'), e = el('em'); r.append(el('span', null, label)); e.append(...right); out.append(r); r.append(e); };
    let slot = null;   // the picked button: { name, b, set(b), remove? }
    if (tab === 'touch') {
      for (const [label, opts, cur, set] of w.tabs.rows()) {
        row(label, this.choice({ items: opts.map(([, name]) => name), value: opts.findIndex(([v]) => v === cur), set: (i) => set(opts[i][0]) }));
      }
      out.append(this.touchScreen(w), el('div', 'mh-tp-hint', 'Drag a button or the stick to move it; tap a button to choose what it does.'));
      const add = this.button(t.buttons.length >= TOUCH_MAX_BUTTONS ? 'Button limit reached' : '+ Add a button', () => {
        if (t.buttons.length >= TOUCH_MAX_BUTTONS) return;
        const id = Math.max(0, ...t.buttons.map((b) => b.id)) + 1;
        t.buttons.push({ id, x: 0.5, y: 0.6, b: null });
        this.kpick = id; this.render();
      });
      add.disabled = t.buttons.length >= TOUCH_MAX_BUTTONS;
      const ctas = el('div', 'mh-ctas'); ctas.append(add); out.append(ctas);
      const btn = t.buttons.find((b) => b.id === this.kpick);
      if (btn) {
        slot = { name: 'Touch button', b: btn.b, remove: () => { t.buttons = t.buttons.filter((b) => b.id !== btn.id); this.kpick = null; },
          set: (b) => { for (const o of t.buttons) if (o.id !== btn.id && sameBinding(o.b, b)) o.b = null; btn.b = b ? { ...b } : null; } };
      }
    } else {
      row('Move with', this.choice({ items: ['Left stick', 'D-pad'], value: d.padMove === 'dpad' ? 1 : 0, set: (i) => { d.padMove = i ? 'dpad' : 'ls'; } }));
      const grid = el('div', 'mh-pad');
      for (const p of PAD_BUTTONS) {
        if (p.i >= 12 && d.padMove === 'dpad') continue;   // the D-pad moves then: its arms take no bindings
        const b = d.pad[p.i], c = el('div', `mh-cell mh-padb${this.kpick === p.i ? ' mh-sel' : ''}`);
        if (b) c.append(this.img(g.bindingIcon(b)));
        c.append(el('small', null, p.label));
        this.hud.tap(c, () => { this.kpick = this.kpick === p.i ? null : p.i; this.render(); });
        grid.append(c);
      }
      out.append(grid);
      const p = PAD_BUTTONS.find((x) => x.i === this.kpick);
      if (p) {
        slot = { name: `${p.label} button`, b: d.pad[p.i],
          set: (b) => { for (const [k, v] of Object.entries(d.pad)) if (Number(k) !== p.i && sameBinding(v, b)) delete d.pad[k]; if (b) d.pad[p.i] = { ...b }; else delete d.pad[p.i]; } };
      }
    }
    if (!slot) out.append(el('div', 'mh-empty', tab === 'touch' ? 'Tap a button on the screen above to choose what it does.' : 'Tap a button above to choose what it does.'));
    else this.bindPicker(out, slot);
    // Default / Clear All (asked first, as the window's), then Cancel and OK
    const a = el('div', 'mh-ctas');
    const ask = (q, fn) => this.wm.confirm(q).then((ok) => { if (ok) { fn(); this.kpick = null; this.render(); } });
    const which = tab === 'touch' ? 'touch controls' : 'controller';
    a.append(this.button('Default', () => ask(`Put the ${which} back to the defaults?`, () => w.tabs.reset(tab))),
      this.button('Clear All', () => ask(`Clear what every button of the ${which} does?`, () => w.tabs.clear(tab))), el('span', 'mh-sp'),
      this.button('Cancel', () => this.close()), this.button('OK', () => { w.apply(); this.close(); }, 'mh-main'));
    this.p.detail.append(a);
    return out;
  }
  /** A binding's name: the function's, a face's number, the skill's or the item's. */
  bindingName(b) {
    if (!b) return 'Nothing yet';
    if (b.type === 1) return this.g.skills?.name(b.action) || 'Skill';
    if (b.type === 2 || b.type === 3 || b.type === 7) return this.wm.itemName(b.action) || 'Item';
    if (b.type === 6) return `Face ${b.action - 99}`;
    return bindingLabel(b) || 'Function';
  }
  /** What can go on a button: the functions with their icons, the skills you have that go on a key, your key items. */
  bindables(src) {
    const g = this.g;
    if (src === 'skill') {
      return Object.entries(g.skills?.levels || {}).filter(([id, s]) => (s?.level || 0) > 0 && ![0, 9].includes(Math.floor(id / 1000) % 10))
        .map(([id]) => ({ type: 1, action: Number(id) }));
    }
    if (src === 'item') {
      const out = [], seen = new Set();
      for (const tab of [2, 3, 4, 5]) {
        for (const it of Object.values(g.inventory?.[tab] || {})) {
          const type = it && itemKeyType(tab, it.id);
          if (type && !seen.has(it.id)) { seen.add(it.id); out.push({ type, action: it.id }); }
        }
      }
      return out;
    }
    return FUNCTIONS.filter(([, a]) => this.wm.W.KeyConfig?.icon?.[a]).map(([type, action]) => ({ type, action }));
  }
  /** The picked button: what it does now (Clear, and Remove for a touch button), then what it can do instead. */
  bindPicker(out, slot) {
    const head = el('div', 'mh-dt-head mh-kp'), txt = el('div');
    head.append(this.img(slot.b ? this.g.bindingIcon(slot.b) : null));
    txt.append(el('div', 'mh-dt-name', this.bindingName(slot.b)), el('div', 'mh-dt-sub', slot.name));
    head.append(txt);
    if (slot.b) head.append(this.button('Clear', () => { slot.set(null); this.render(); }));
    if (slot.remove) head.append(this.button('Remove', () => { slot.remove(); this.render(); }, 'mh-warn'));
    out.append(head, this.choice({ items: KEY_SOURCES.map(([, name]) => name), value: KEY_SOURCES.findIndex(([k]) => k === this.ksrc), set: (i) => { this.ksrc = KEY_SOURCES[i][0]; } }));
    const list = this.bindables(this.ksrc), grid = el('div', 'mh-grid');
    grid.style.marginTop = '6px';
    if (!list.length) out.append(el('div', 'mh-empty', this.ksrc === 'skill' ? 'No skills that go on a button yet.' : 'No items that go on a button.'));
    for (const b of list) {
      const c = el('div', `mh-cell${sameBinding(b, slot.b) ? ' mh-sel' : ''}`);
      c.title = this.bindingName(b);
      c.append(this.img(this.g.bindingIcon(b)));
      if (b.type === 2) c.append(el('b', null, String(this.g.itemCount?.(b.action) || 0)));
      this.hud.tap(c, () => { sfx.play('UI/BtMouseClick'); slot.set(b); this.render(); });
      grid.append(c);
    }
    out.append(grid);
  }
  /** The screen with the touch controls where they sit (their size and opacity), to drag about and pick. */
  touchScreen(w) {
    const t = w.ctlDraft.touch, box = el('div', 'mh-tp');
    box.style.aspectRatio = `${UI_W} / ${UI_H}`;
    const put = (n, at, px) => {
      n.style.left = `${at.x * 100}%`; n.style.top = `${at.y * 100}%`;
      n.style.width = `${((px * (t.size || 1)) / UI_W) * 100}%`; n.style.opacity = String(t.opacity ?? 0.8);
    };
    const stick = el('div', 'mh-tp-stick');
    put(stick, t.stick, STICK);
    this.dragOnScreen(stick, t.stick, box, null);
    box.append(stick);
    for (const b of t.buttons) {
      const n = el('div', `mh-tp-btn${this.kpick === b.id ? ' mh-sel' : ''}`), label = bindingLabel(b.b);
      put(n, b, BUTTON);
      if (label) n.append(el('small', null, label.length > 8 ? label.split(' ')[0] : label));
      else if (b.b) n.append(this.img(this.g.bindingIcon(b.b)));
      this.dragOnScreen(n, b, box, () => { this.kpick = b.id; this.render(); });
      box.append(n);
    }
    return box;
  }
  /** A touch control on the screen: dragged, it moves there (kept 3% in from the edges); tapped, onTap. */
  dragOnScreen(n, at, box, onTap) {
    n.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      n.setPointerCapture?.(e.pointerId);
      this.sliding = 'touch';
      const x0 = e.clientX, y0 = e.clientY;
      let moved = false;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        moved = true;
        const r = box.getBoundingClientRect(), fit = (v) => Math.min(0.97, Math.max(0.03, v));
        at.x = fit((ev.clientX - r.left) / r.width); at.y = fit((ev.clientY - r.top) / r.height);
        n.style.left = `${at.x * 100}%`; n.style.top = `${at.y * 100}%`;
      };
      const up = () => {
        n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up); n.removeEventListener('pointercancel', up);
        this.sliding = null;
        if (!moved) onTap?.();
      };
      n.addEventListener('pointermove', move); n.addEventListener('pointerup', up); n.addEventListener('pointercancel', up);
    });
  }

  // ---------------------------------------------------------------- Community: Buddies, Party, Guild, Alliance, Blacklist
  /**
   * The community window's lists (its own models and rows) and buttons (its own, lit as the window lights them for
   * the one picked): Buddies by group, the party online and off, the guild and the alliance by who is on, the
   * Blacklist. Every action is the window's.
   */
  community() {
    const g = this.g, w = this.wm.wins.userlist, out = el('div', 'mh-list');
    if (!w) return out;
    const tab = this.tab.community;
    if (w.tab !== tab) w.setTab(tab);
    this.tabs(COMMUNITY_TABS, tab, (k) => { this.tab.community = k; w.setTab(k); this.guildInfo = false; });
    w.updateButtons();
    const pick = (key) => { w.sel = w.sel === key ? null : key; this.findPage(w); this.render(); };
    const row = (key, main, sub, mark, off = false) => {
      const r = el('div', `mh-li${w.sel === key ? ' mh-sel' : ''}${off ? ' mh-off' : ''}`), m = el('div', 'mh-li-main');
      if (mark) r.append(mark);
      m.append(el('div', 'mh-li-name', main));
      if (sub) m.append(el('div', 'mh-li-sub', sub));
      r.append(m);
      if (key) this.hud.tap(r, () => pick(key));
      out.append(r);
      return r;
    };
    const dot = (cls) => el('span', `mh-dot ${cls}`);
    const tools = el('div', 'mh-ctas');
    if (tab === 0) {
      for (const [k, label] of COMMUNITY_TOOLS) { const b = w.bb[k]; if (b?.visible) tools.append(this.button(label, () => b.onClick(), k === 'add' ? 'mh-main' : '')); }
      out.append(tools);
      this.p.extra.append(el('span', 'mh-pill', `${(g.buddies || []).filter((b) => !b.pending).length} / ${g.buddyCapacity ?? 20}`));
      for (const r of w.model().rows) {
        if (r.kind === 'group') {
          const h = el('div', `mh-grp${w.sel === r.key ? ' mh-sel' : ''}`), fold = el('span', 'mh-fold', r.open ? '▾' : '▸');
          this.hud.tap(fold, () => { w.toggleGroup(r.item.name); this.render(); });
          const label = el('span', null, r.label);
          this.hud.tap(label, () => pick(r.key));
          h.append(fold, label);
          out.append(h);
        } else if (r.kind === 'buddy') {
          const b = r.item, blocked = w.isBlocked(b), on = b.channel >= 0;
          row(r.key, b.name, blocked ? 'Blocked' : on ? `Channel ${b.channel + 1}${b.channel === g.channel ? ' · here' : ''}` : 'Offline',
            dot(blocked ? 'mh-blocked' : on ? (b.channel === g.channel ? 'mh-here' : 'mh-on') : ''), !on || blocked);
        } else if (r.kind === 'none') out.append(el('div', 'mh-empty mh-small', 'none'));
      }
    } else if (tab === 1) {
      const p = g.party;
      if (!p) out.append(el('div', 'mh-empty', 'You are not in a party.'));
      else {
        for (const r of w.model().rows) {
          if (r.kind === 'bar') out.append(el('div', 'mh-sec', `${r.tip} ${r.count}`));
          else if (r.kind === 'member') {
            const m = r.item, on = m.channel >= 0;
            const where = !on ? 'Offline' : r.here ? 'Here' : `Ch. ${m.channel + 1} · ${w.mapName(m.map)}`;
            row(r.key, `${m.id === p.leader ? '★ ' : ''}${m.name}`, `${jobName(m.job)} · Lv. ${m.level} · ${where}`, dot(on ? (r.here ? 'mh-here' : 'mh-on') : ''), !on);
          }
        }
      }
    } else if (tab === 2 || tab === 3) {
      const gd = g.guild, a = tab === 3 && gd ? g.alliance : null;
      if (!gd) out.append(el('div', 'mh-empty', 'You are not in a guild.'));
      else if (tab === 3 && !a) out.append(el('div', 'mh-empty', 'This guild is not affiliated with any Guild Union.'));
      else {
        const head = el('div', 'mh-ghead');
        head.append(el('b', null, tab === 2 ? gd.name : a.name), el('span', null, (tab === 2 ? gd.notice : a.notice) || (tab === 2 ? 'No guild notice.' : 'No Guild Union notice.')));
        out.append(head);
        if (tab === 2) {
          const info = this.button(this.guildInfo ? 'Hide ranks' : 'Ranks and GP', () => { this.guildInfo = !this.guildInfo; this.render(); });
          const t = el('div', 'mh-ctas'); t.append(info); out.append(t);
          if (this.guildInfo) {
            out.append(el('div', 'mh-sec', `Guild Points ${fmt(gd.gp ?? 0)}`));
            (gd.ranks || []).forEach((name, i) => { if (name) out.append(el('div', 'mh-kv', `${i + 1}. ${name}`)); });
          }
        }
        const ranks = tab === 2 ? gd.ranks : a.ranks, rankOf = (m) => (tab === 2 ? ranks?.[m.rank - 1] : ranks?.[m.allianceRank - 1]) || '';
        const member = (m, key) => row(key, m.name, `${m.job < 0 ? '??' : jobName(m.job)} · Lv. ${m.level < 0 ? '??' : m.level}${rankOf(m) ? ` · ${rankOf(m)}` : ''}`,
          dot(m.online ? 'mh-on' : ''), !m.online);
        const guilds = tab === 2 ? [gd] : [gd, ...(g.allianceGuilds || [])];
        for (const gg of guilds) {
          if (tab === 3) out.append(el('div', 'mh-sec', `${gg.name} [${gg.members.filter((m) => m.online).length}/${gg.members.length}]`));
          for (const online of tab === 2 ? [true, false] : [null]) {
            const list = gg.members.filter((m) => online === null || !!m.online === online);
            if (tab === 2) out.append(el('div', 'mh-sec', `${online ? 'Online' : 'Offline'} [${list.length}/${gg.members.length}]`));
            if (!list.length) out.append(el('div', 'mh-empty mh-small', 'none'));
            for (const m of list.sort((x, y) => (x.rank - y.rank) || x.name.localeCompare(y.name))) member(m, `${tab === 2 ? 'm' : 'a'}:${m.id}`);
          }
        }
      }
    } else {
      const names = w.mine.black;
      this.p.extra.append(el('span', 'mh-pill', `${names.length} / 26`));
      if (!names.length) out.append(el('div', 'mh-empty', 'Nobody is on your Blacklist.'));
      names.forEach((n, i) => row(`k:${i}`, n, null, null));
    }
    // the window's buttons for this tab, as it lights them
    const set = [w.bb, w.pb, w.gb, w.ab, w.lb][tab], a = el('div', 'mh-ctas');
    for (const [k, label] of COMMUNITY_BUTTONS[tab]) {
      const b = set[k];
      if (!b?.visible || !b.enabled) continue;
      a.append(this.button(label, () => this.communityAct(tab, k, b), ['create', 'invite', 'add'].includes(k) ? 'mh-main' : ['del', 'kick', 'leave', 'block'].includes(k) ? 'mh-warn' : ''));
    }
    if (a.childElementCount) this.p.detail.append(a);
    return out;
  }
  /** A guild or alliance member picked: the window's list page with them on it, so its buttons see them. */
  findPage(w) {
    if (!w.sel || w.selected()) return;
    const secs = w.tab === 2 ? w.gsec : w.tab === 3 ? [...w.asecs.values()] : [];
    for (const sec of secs) {
      const page = sec.page;
      for (let p = 0; p < 40; p++) { sec.page = p; sec.open = true; if (w.selected()) return; }
      sec.page = page;
    }
  }
  /** A community button: as the window's, but Party Search opens its sheet and a whisper goes to the chat line. */
  communityAct(tab, k, b) {
    if (tab === 1 && k === 'search') { this.show('partysearch'); return; }
    if (k === 'whisper' || k === 'bbs') this.close();
    b.onClick();
    this.render();
  }

  // ---------------------------------------------------------------- Party Search
  /** Party Search through its window (its job bits, fields and start / pause / stop): who you look for and how many. */
  /**
   * Party Search through its window's own code: the levels and how many members, All and each first job's panel
   * with its later jobs (by your level; under 30 only the first jobs), greyed while a search is on; Start, Pause and
   * Stop lit by the search's state.
   */
  partysearch() {
    const g = this.g, w = this.wm.wins.partysearch, out = el('div');
    if (!w) return out;
    const f = w.fields, st = w.state, on = st !== 1;
    w.prepare(!f.min.value && !f.max.value && !f.members.value);
    const num = (field, max) => {
      const i = el('input', 'mh-in mh-num'); Object.assign(i, { type: 'text', inputMode: 'numeric', maxLength: max, value: field.value, disabled: !on });
      for (const t of ['keydown', 'keyup', 'keypress', 'pointerdown']) i.addEventListener(t, (e) => e.stopPropagation());
      i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, ''); field.value = i.value; });
      return i;
    };
    const lvRow = el('div', 'mh-kv mh-opt'), e = el('em');
    e.append(num(f.min, 3), el('small', null, 'above'), num(f.max, 3), el('small', null, 'under'));
    lvRow.append(el('span', null, 'Level'), e); out.append(lvRow);
    const mRow = el('div', 'mh-kv mh-opt'), me = el('em');
    me.append(num(f.members, 1), el('small', null, 'ppl'));
    mRow.append(el('span', null, 'Party member'), me); out.append(mRow);
    const flip = (n) => { if (!on) return; w.toggle(n); sfx.play('UI/BtMouseClick'); this.render(); };
    const allRow = el('div', 'mh-kv mh-opt mh-wide'), ae = el('em');
    ae.append(this.switch(w.checked[0], () => flip(0)));
    allRow.append(el('span', null, 'All jobs'), ae); out.append(allRow);
    for (const head of [1, 2, 3, 8, 13, 17, 21]) {
      const sec = el('div', 'mh-sec mh-tapsec', `${w.checked[head] ? '\u2611' : '\u2610'} ${w.label(head)}`);
      this.hud.tap(sec, () => flip(head));
      out.append(sec);
      const subs = (PS_PANELS[head] || []).filter((n) => !w.low || PS_FIRST.includes(n));
      if (!subs.length) continue;
      const chips = el('div', 'mh-seg');
      for (const n of subs) {
        const c = el('button', `mh-tab${w.checked[n] ? ' mh-on' : ''}`, w.label(n)); c.type = 'button'; c.disabled = !on;
        this.hud.tap(c, () => flip(n));
        chips.append(c);
      }
      out.append(chips);
    }
    const a = el('div', 'mh-ctas mh-end');
    const start = this.button('Start Search', () => { w.start(); this.render(); }, 'mh-main'); start.disabled = st === 1; a.append(start);
    const pause = this.button('Pause Search', () => { w.pause(); this.render(); }); pause.disabled = st !== 1; a.append(pause);
    const stop = this.button('Stop Search', () => { w.stop(); this.render(); }); stop.disabled = st === 0; a.append(stop);
    this.p.detail.append(a);
    return out;
  }

  // ---------------------------------------------------------------- Family
  /** The Family window (your family, reputation and privileges) and its pedigree, through their own windows. */
  family() {
    const g = this.g, w = this.wm.wins.family, t = this.wm.wins.familytree, out = el('div', 'mh-list');
    if (!w || !t) return out;
    this.tabs([['info', 'Family'], ['tree', 'Pedigree']], this.tab.family, (k) => { this.tab.family = k; if (k === 'tree') t.load(g.player.name); });
    const f = g.family || { rep: 0, totalRep: 0, todayRep: 0, juniors: 0, maxJuniors: 2, name: '', message: '', used: {} };
    const a = el('div', 'mh-ctas');
    a.append(this.button('Add Junior', () => g.familyAddJunior(), 'mh-main'));
    if (this.tab.family === 'info') {
      const kv = (label, value) => { const r = el('div', 'mh-kv'); r.append(el('span', null, label), el('em', null, value)); out.append(r); };
      out.append(el('div', 'mh-sec', f.name || 'No family yet'));
      if (!f.name) out.append(el('div', 'mh-dt-text', 'Add a junior to start a family.'));
      if (f.message) out.append(el('div', 'mh-dt-text', f.message));
      kv('Juniors', `${f.juniors} / ${f.maxJuniors}`);
      kv('Reputation', `${fmt(f.rep)} / ${fmt(f.totalRep)}`);
      kv("Today's Rep", fmt(f.todayRep));
      const privs = w.privileges;
      if (privs.length) out.append(el('div', 'mh-sec', 'Entitlements'));
      privs.forEach((p, i) => {
        const r = el('div', 'mh-li mh-priv'), m = el('div', 'mh-li-main'), used = f.used?.[i] || 0;
        r.append(this.img(w.F.RightIcon?.[FAMILY_ICONS[i] || 4]));
        m.append(el('div', 'mh-li-name', p.name), el('div', 'mh-li-sub', `${fmt(p.cost)} Rep · used ${used} / ${p.limit}`), el('div', 'mh-li-sub', plain(p.desc).replace(/\s+/g, ' ')));
        r.append(m);
        const use = this.button('Use', () => { w.page = i; w.use(); });
        use.disabled = !f.name || f.rep < p.cost || used >= p.limit;
        r.append(use);
        out.append(r);
      });
      if (f.name && f.leader === g.player.id) a.append(this.button('Precepts', () => w.editPrecepts()));
      a.append(this.button('Pedigree', () => { this.tab.family = 'tree'; t.load(g.player.name); this.render(); }));
    } else {
      const c = t.chart;
      if (!c) out.append(el('div', 'mh-empty', 'Loading the pedigree...'));
      else {
        out.append(el('div', 'mh-sec', `Family members: ${c.members.length}`));
        // each member once, with every place they hold (the leader may be your senior too)
        const places = new Map();
        for (const [slot, label] of FAMILY_PLACES) {
          const m = t.place?.[slot];
          if (!m) continue;
          if (places.has(m.id)) places.get(m.id).labels.push(label); else places.set(m.id, { m, labels: [label] });
        }
        for (const { m, labels } of places.values()) {
          const r = el('div', `mh-li${t.sel === m.id ? ' mh-sel' : ''}${m.online ? '' : ' mh-off'}`), main = el('div', 'mh-li-main');
          r.append(el('span', `mh-dot${m.online ? ' mh-on' : ''}`));
          main.append(el('div', 'mh-li-name', m.name), el('div', 'mh-li-sub', `${labels.join(' · ')} · Lv. ${m.level} · ${jobName(m.job)}`));
          r.append(main);
          // tapped again: that member's own pedigree, as the window's double-click
          this.hud.tap(r, () => { if (t.sel === m.id && m.id !== c.self) t.load(m.name); else t.sel = m.id; this.render(); });
          out.append(r);
        }
        if (!t.mine) a.append(this.button('My pedigree', () => t.load(g.player.name)));
        a.append(this.button('Bye', () => t.separate(), 'mh-warn'));
      }
    }
    this.p.detail.append(a);
    return out;
  }

  // ---------------------------------------------------------------- Medals
  /**
   * The Medal window's medals (its quests of the Title area, through its own lists): Basic the ones you have (the one
   * you wear marked), the others a category's, in progress and obtainable; a medal picked slides out its panel, as
   * the window's does: its NPC standing, its limits or when you got it, its text, Find NPC, and a Challenge medal's
   * Start / Give up.
   */
  medal() {
    const g = this.g, w = this.wm.wins.medal, out = el('div', 'mh-list');
    if (!w) return out;
    if (w.area === undefined && !this.medalLoading) { this.medalLoading = true; w.load().then(() => { this.medalLoading = false; this.sig = ''; }); }
    const tab = this.tab.medal;
    this.tabs(MEDAL_TABS, tab, (k) => { this.tab.medal = k; });
    w.tab = tab;
    const rows = w.rows(), worn = g.inventory?.equipped?.[-49]?.id;
    if (tab === 0) out.append(el('div', 'mh-sec', `Number of medals obtained: ${rows.length}`));
    if (!rows.length) out.append(el('div', 'mh-empty', w.area === undefined ? 'Loading the medals...' : tab === 0 ? 'No medals yet.' : 'No medals here right now.'));
    for (const r of rows) {
      if (r.kind === 'head') {
        const open = !w.folded.has(`${tab - 1}:${r.group}`), h = el('div', 'mh-grp'), fold = el('span', 'mh-fold', open ? '\u25be' : '\u25b8');
        h.append(fold, el('span', null, `${['Title being challenged', 'Obtainable Title'][r.group]} (${r.n})`));
        this.hud.tap(h, () => { w.fold(r.group, open); this.render(); });
        out.append(h);
        continue;
      }
      const li = el('div', `mh-li${this.sel === r.id ? ' mh-sel' : ''}`), main = el('div', 'mh-li-main');
      li.append(this.itemImg(r.item));
      main.append(el('div', 'mh-li-name', `${r.name}${tab === 0 && worn && worn === r.item ? ' \u00b7 wearing' : ''}`),
        el('div', 'mh-li-sub', r.state === 2 ? endedText(g.quests.completed[r.id]) : w.limits(r.id).filter(Boolean).join(' \u00b7 ')));
      li.append(main);
      this.hud.tap(li, () => { this.sel = this.sel === r.id ? null : r.id; this.render(); });
      out.append(li);
    }
    const m = this.sel && w.medals().find((x) => x.id === this.sel);
    if (m) this.medalPanel(w, m);
    return out;
  }
  medalPanel(w, m) {
    const g = this.g, q = this.qp, qw = this.wm.wins.quest;
    this.questShown = true;
    q.dot.className = `mh-qd-dot mh-q${m.state === 2 ? 2 : m.state === 1 ? 1 : 0}`;
    q.title.textContent = m.name;
    const lv = m.state === 2 ? endedText(g.quests.completed[m.id]) : w.limits(m.id).filter(Boolean).join(' \u00b7 ');
    q.lv.textContent = lv; q.lv.style.display = lv ? '' : 'none';
    q.npc.replaceChildren(el('b', null, w.npcNames?.[m.npc]?.name || ''), el('span', null, ['Not started', 'In progress', 'Obtained'][m.state] || ''));
    if (qw) this.npcStage(qw, m.npc);
    q.acts.replaceChildren(this.button('Find NPC', async () => {
      const maps = Object.values(w.npcMaps?.[m.npc] || {}).map(Number).filter(Boolean), WorldMap = this.wm.wins.worldmap?.constructor;
      if (!maps.length || !(await WorldMap?.searchNpc(this.wm, maps))) this.wm.notice('This NPC is located at a spot not\navailable through the World Map.');
    }));
    if (m.cat === 2 && m.state === 0) q.acts.append(this.button('Start', () => { w.sel = m.id; w.startMedal(); }, 'mh-main'));
    if (m.cat === 2 && m.state === 1) q.acts.append(this.button('Give up', () => { w.sel = m.id; w.giveUp(); }, 'mh-warn'));
    // its text for where you are in it (the data's breaks), and while it runs its summary
    const info = g.quests.info[m.id] || {};
    let text = String(info[m.state] ?? '').replace(/\\r\\n/g, '\n\n').replace(/\\n/g, '\n');
    if (m.state === 1) { const sum = ['summary', 'demandSummary', 'rewardSummary'].map((k) => String(info[k] ?? '')).filter(Boolean); if (sum.length) text += `\n${sum.join('\n')}`; }
    const keep = this.qShownId === `m${m.id}` ? q.body.scrollTop : 0;
    q.body.replaceChildren();
    if (text && qw) q.body.append(this.rich(el('div', 'mh-dt-text'), text, qw.ref()));
    q.body.scrollTop = keep; this.qShownId = `m${m.id}`;
  }

  // ---------------------------------------------------------------- Monster Book
  /**
   * The Monster Book through its window (its cards, sets, level and choices): the summary (level, cards, the cover
   * monster, a search by name), or a set of cards (faint until you have one, with how many); a card picked slides out
   * its panel: the monster, its level, HP and MP, its pages (Basic, Episode, Drops, Found in) as your cards open them,
   * and Register / Release as the book's cover.
   */
  monsterbook() {
    const g = this.g, w = this.wm.wins.monsterbook, out = el('div');
    if (!w) return out;
    const tab = this.tab.mbook;
    this.tabs(BOOK_TABS, tab, (k) => { this.tab.mbook = k; });
    if (!w.cards) { out.append(el('div', 'mh-empty', 'Loading the Monster Book...')); return out; }
    const book = w.book;
    if (tab === 9) {
      const lv = w.level(), ids = Object.keys(book.cards).map(Number), special = ids.filter((id) => id >= 2388000).length;
      const head = el('div', 'mh-dt-head');
      head.append(this.img(w.B.icon?.[lv - 1]));
      const t = el('div'); t.append(el('div', 'mh-dt-name', `Book Level ${lv}`), el('div', 'mh-dt-sub', `${ids.length} kinds of cards collected`));
      head.append(t); out.append(head);
      const kv = (label, value) => { const r = el('div', 'mh-kv'); r.append(el('span', null, label), el('em', null, String(value))); out.append(r); };
      kv('Normal cards', ids.length - special); kv('Special cards', special); kv('Cover', w.cards[book.cover]?.name || 'None');
      out.append(el('div', 'mh-sec', 'Find a monster'));
      const row = el('div', 'mh-bx-row'), i = el('input', 'mh-in');
      Object.assign(i, { type: 'text', placeholder: 'Monster name', autocomplete: 'off', spellcheck: false });
      const find = () => {
        const q = i.value.replace(/ /g, '').toLowerCase();
        if (!q) return;
        const all = Object.values(w.cards), hit = all.find((c) => c.name.replace(/ /g, '').toLowerCase() === q) || all.find((c) => c.name.replace(/ /g, '').toLowerCase().includes(q));
        if (!hit) { this.wm.notice('No monster with that name was found.'); return; }
        i.blur(); w.choose(hit.id); this.tab.mbook = hit.cat; this.sel = hit.id; this.mtab = 0; this.p.body.scrollTop = 0; this.render();
      };
      i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') find(); });
      for (const t2 of ['keyup', 'keypress', 'pointerdown']) i.addEventListener(t2, (e) => e.stopPropagation());
      row.append(i, this.button('Find', find, 'mh-main'));
      out.append(row);
      return out;
    }
    const list = w.cats[tab] || [], owned = list.filter((id) => w.count(id)).length, grid = el('div', 'mh-grid');
    out.append(el('div', 'mh-sec', `${owned} / ${list.length} cards`));
    for (const id of list) {
      const c = w.cards[id], n = w.count(id), cell = el('div', `mh-cell${this.sel === id ? ' mh-sel' : ''}${n ? '' : ' mh-faint'}`);
      cell.title = c.name;
      cell.append(this.img(c.icon));
      if (n) cell.append(el('b', null, String(n)));
      this.hud.tap(cell, () => { this.sel = this.sel === id ? null : id; if (this.sel) { w.choose(id); this.mtab = 0; } this.render(); });
      grid.append(cell);
    }
    out.append(grid);
    if (this.sel && w.cards[this.sel]) this.monsterPanel(w, w.cards[this.sel]);
    return out;
  }
  monsterPanel(w, c) {
    const g = this.g, q = this.qp, n = w.count(c.id), a = w.art?.mob === c.mob ? w.art : null, info = a?.info || {};
    this.questShown = true;
    q.dot.className = `mh-qd-dot mh-q${n >= 5 ? 2 : n ? 1 : 0}`;
    q.title.textContent = c.name;
    q.lv.textContent = n ? `Lv. ${info.level ?? '?'} \u00b7 HP ${n > 1 ? info.maxHP ?? '???' : '???'} \u00b7 MP ${n > 1 ? info.maxMP ?? '???' : '???'}` : 'You do not have this card yet.';
    q.lv.style.display = '';
    // the monster on the stage, made smaller to fit when it is big
    clearTimeout(this.npcTimer); this.stageNpc = null;
    q.stage.replaceChildren();
    const f = n ? a?.frame : null;
    if (f?._canvas) {
      const im = el('img'), o = f.origin || [(f._w || 0) / 2, f._h || 0], k = Math.min(1, 86 / (f._w || 1), 88 / (f._h || 1));
      im.alt = ''; im.draggable = false; im.src = `${g.assets.base}/${f._canvas}`;
      Object.assign(im.style, { width: `${(f._w || 0) * k}px`, height: `${(f._h || 0) * k}px`, left: `${46 - o[0] * k}px`, top: `${88 - o[1] * k}px` });
      q.stage.append(im);
    }
    const gauge = el('div', 'mh-qd-gauge'), fill = el('i');
    fill.style.width = `${Math.min(1, n / 5) * 100}%`; gauge.append(fill);
    q.npc.replaceChildren(el('b', null, `Cards ${Math.min(n, 5)} / 5`), gauge, el('small', null, w.book.cover === c.id ? 'The book\'s cover' : 'More cards open more pages'));
    // its pages, as your cards open them; the book's cover
    q.acts.replaceChildren();
    if (n < BOOK_PAGES[this.mtab][1]) this.mtab = 0;
    BOOK_PAGES.forEach(([label, need], i) => {
      const b = el('button', `mh-tab${i === this.mtab ? ' mh-on' : ''}`, label);
      b.type = 'button'; b.disabled = n < need;
      this.hud.tap(b, () => { if (n >= need) { this.mtab = i; this.render(); } });
      q.acts.append(b);
    });
    if (n && w.book.cover !== c.id) q.acts.append(this.button('Register', () => g.net?.bookCover(c.id), 'mh-main'));
    if (w.book.cover) q.acts.append(this.button('Release', () => g.net?.bookCover(0)));
    const body = q.body;
    body.replaceChildren();
    if (this.mtab === 1) body.append(el('div', 'mh-dt-text', plain(String(c.episode || '').replace(/\\r/g, '')) || 'No episode is recorded for this monster.'));
    else if (this.mtab === 2) {
      if (!c.rewards.length) body.append(el('div', 'mh-empty', 'No drops are recorded for this monster.'));
      const grid = el('div', 'mh-grid');
      for (const id of c.rewards) { const cell = el('div', 'mh-cell'); cell.title = this.wm.itemName(id) || ''; cell.append(this.itemImg(id)); grid.append(cell); }
      body.append(grid);
    } else if (this.mtab === 3) {
      const rows = (w.where || []).flat();
      if (!rows.length) body.append(el('div', 'mh-empty', 'No locations are recorded for this monster.'));
      for (const r of rows) body.append(el('div', r.head ? 'mh-sec' : 'mh-dt-text', r.text));
    } else body.append(el('div', 'mh-dt-text', n ? `${c.name}: ${n} card${n > 1 ? 's' : ''}.` : 'Hunt this monster for its card.'));
  }
  /** A quest opened from elsewhere (the Quest Helper, a notice): the Quests sheet on its tab, with it picked. */
  openQuest(id) {
    const st = this.g.quests?.status(id) ?? 0;
    this.tab.quests = st === 1 ? 1 : st === 2 ? 2 : 0; this.qCache = null;
    this.show('quests');
    this.sel = id;
    this.render();
  }

  // ---------------------------------------------------------------- Quests
  quests() {
    const g = this.g, w = this.wm.wins.quest, list = el('div', 'mh-list'), tab = this.tab.quests;
    if (!w || !g.quests) return list;
    this.tabs(QUEST_TABS, tab, (k) => { this.tab.quests = k; });
    const entries = this.questEntries(w, tab);
    if (!entries.length) list.append(el('div', 'mh-empty', ['No quests can be started right now.', 'No quests in progress.', 'No quests completed yet.'][tab]));
    // grouped by area, as the window lists them
    const areas = new Map();
    for (const e of entries) { const a = w.areaName(e.area); if (!areas.has(a)) areas.set(a, []); areas.get(a).push(e); }
    for (const [area, group] of [...areas.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
      list.append(el('div', 'mh-sec', area));
      for (const e of group) {
        const row = el('div', `mh-li${this.sel === e.id ? ' mh-sel' : ''}`), m = el('div', 'mh-li-main');
        m.append(el('div', 'mh-li-name', e.name || g.quests.name(e.id)));
        if (e.chain && e.count) m.append(el('div', 'mh-li-sub', `${e.done || 0} / ${e.count} done`));
        row.append(m);
        this.hud.tap(row, () => { this.sel = this.sel === e.id ? null : e.id; this.render(); });
        list.append(row);
      }
    }
    const e = this.sel && entries.find((x) => x.id === this.sel);
    if (e) this.questPanel(w, e, tab);
    return list;
  }
  /** The Quest window's list for a tab, worked out at most every 2s (Available checks every quest). */
  questEntries(w, tab) {
    const c = this.qCache, now = performance.now();
    if (c && c.tab === tab && now - c.at < 2000) return c.list;
    w.tab = tab;
    const list = w.entries();
    this.qCache = { tab, at: now, list };
    return list;
  }
  /** The picked quest's panel shown or put away (sliding), its animations stopped when it goes. */
  showQuest(on) {
    this.qd.classList.toggle('mh-open', !!on);
    if (!on) { clearTimeout(this.npcTimer); clearInterval(this.timeTimer); this.stageNpc = null; }
  }
  /** Quest text (its #codes) as the Quest window resolves it, in light colours, into a box. */
  rich(box, text, ref) {
    const ctx = (this.measure ??= document.createElement('canvas').getContext('2d'));
    const { lines } = richText(ctx, String(text), 100000, ref, { base: '#e8edf8', colors: LIGHT_COLORS, size: 11 });
    lines.forEach((l, i) => {
      if (i) box.append('\n');
      for (const r of l.runs) {
        if (r.icon) { const im = this.img(r.icon); im.style.verticalAlign = 'middle'; box.append(im); continue; }
        if (r.t === undefined) continue;
        const sp = el('span', null, r.t);
        if (r.color) sp.style.color = r.color;
        if (r.bold) sp.style.fontWeight = '800';
        box.append(sp);
      }
    });
    return box;
  }
  /**
   * The quest's panel, as the Quest window's detail panel: the quest giver standing on its little stage (its own
   * frames, animated by their delays; a tall one rises over it), the level line, a chain's parts done, the text in the
   * window's own names, then (under way) the summary, what it asks for and the rewards, and the time left.
   */
  questPanel(w, e, tab) {
    const g = this.g, book = g.quests, id = e.chain ? e.current || e.id : e.id, info = book.info[id] || {}, q = this.qp, ref = w.ref();
    w.sel = e.id; w.did = e.id; w.dtab = tab; w.selEntry = e;
    this.questShown = true;
    q.dot.className = `mh-qd-dot mh-q${tab}`;
    q.title.textContent = e.name || book.name(e.id);
    const lv = w.levelLine(e);
    q.lv.textContent = lv || ''; q.lv.style.display = lv ? '' : 'none';
    // who gives it, where, and a chain's progress
    const npcId = w.questNpc(e.id);
    q.npc.replaceChildren(el('b', null, ref.npc(npcId)), el('span', null, w.areaName(e.area)));
    if (e.chain && e.count > 1) {
      const gauge = el('div', 'mh-qd-gauge'), fill = el('i');
      fill.style.width = `${Math.round(((e.done || 0) / e.count) * 100)}%`;
      gauge.append(fill);
      q.npc.append(gauge, el('small', null, `${e.done || 0} of ${e.count} parts done`));
    }
    this.npcStage(w, npcId);
    // its buttons
    q.acts.replaceChildren(this.button('Find NPC', () => w.findNpc()));
    if (tab === 1) {
      q.acts.append(this.button('Quest Helper', () => this.wm.wins.questalarm?.track(e.id), 'mh-main'));
      q.acts.append(this.button('Give up', () => this.wm.confirm('Are you sure you want to quit?').then((ok) => {
        if (!ok || book.status(e.id) !== 1) return;
        this.wm.wins.questalarm?.remove(e.id);
        g.net?.questAction(3, e.id);
        this.sel = null; this.qCache = null; this.render();
      }), 'mh-warn'));
    }
    // the text, then what is left to do and what it gives
    const keep = this.qShownId === e.id ? q.body.scrollTop : 0;
    q.body.replaceChildren();
    const text = e.chain ? e.texts.map(([n, t]) => (t ? `${n}\n${t}` : n)).join('\n') : String(info[String(tab)] ?? '');
    if (text) q.body.append(this.rich(el('div', 'mh-dt-text'), text, ref));
    if (tab === 1) {
      for (const [head, t] of [['Summary', info.summary], ['To do', info.demandSummary], ['Rewards', info.rewardSummary]]) {
        if (!t) continue;
        q.body.append(el('div', 'mh-sec', head), this.rich(el('div', 'mh-dt-text'), t, ref));
      }
    }
    clearInterval(this.timeTimer);
    const t = tab === 1 && g.questTimers?.get(e.id);
    if (t) {
      const line = el('div', 'mh-qd-time');
      const tickTime = () => { const left = Math.max(0, Math.round((t.end - performance.now()) / 1000)); line.textContent = `Time Left ${Math.floor(left / 3600)}:${String(Math.floor(left / 60) % 60).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; };
      tickTime(); this.timeTimer = setInterval(tickTime, 1000);
      q.body.append(line);
    }
    q.body.scrollTop = keep; this.qShownId = e.id;
  }
  /** The quest giver on its stage: its frames (loaded by the Quest window), feet on the stage's floor, animated. */
  npcStage(w, npcId) {
    const stage = this.qp.stage;
    w.portrait(npcId);
    const frames = w.portraits.get(npcId);
    if (this.stageNpc === npcId && stage.firstChild && frames?.length) return;   // already up and moving
    clearTimeout(this.npcTimer);
    stage.replaceChildren();
    this.stageNpc = frames?.length ? npcId : null;
    if (!frames?.length) return;
    const img = el('img'); img.alt = ''; img.draggable = false;
    stage.append(img);
    let i = 0;
    const show = () => {
      const f = frames[i % frames.length], o = f.origin || [(f._w || 0) / 2, f._h || 0];
      img.src = `${this.g.assets.base}/${f._canvas}`;
      img.style.left = `${46 - o[0]}px`; img.style.top = `${88 - o[1]}px`;
      i++;
      if (frames.length > 1) this.npcTimer = setTimeout(show, Number(f.delay) || 120);
    };
    show();
  }
}
