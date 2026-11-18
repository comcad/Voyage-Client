/**
 * MOBILE UI (System Option): a small HTML interface over the game for phones, in place of the status bar (which is
 * hidden then). It keeps to the edges so the field stays clear:
 *   - bottom middle: one slim bar with your level, name and job and the HP / MP / EXP gauges (a tap opens the Stat
 *     window); it goes while a sheet is open;
 *   - top left: the mini map (ui/mobileminimap.js);
 *   - top right: round buttons for the windows used most, and a menu for the rest; the Item, Equipment, Stat, Skill
 *     and Quest windows, System Options, Game Options, Key Setting, Change Channel, the community window (Buddies, Party,
 *     Guild), Party Search and Family open as its own sheets, made for a phone (ui/mobilesheets.js);
 *   - the chat, only while it is open: a little up-arrow tab out of the status line's top opens a line to type on,
 *     with the chat target beside it, centred right over the status line, and the log over it; closed, nothing of the
 *     chat shows but a gold dot on the tab when lines came in meanwhile;
 *   - NPC and quest conversations, message boxes, NPC shops, trades, the Messenger and invitations / notices in the
 *     same style (ui/mobileskins.js).
 * Everything goes through the status bar's own code (its log, history, chat targets and menu actions) and
 * Game.toggleMenu, so nothing behaves differently from the bar; only the look and the place differ.
 */
import { EXP, jobName } from '../data.js';
import { MENU } from '../keymap.js';
import { settings } from '../settings.js';
import { CHAT_TARGETS } from './statusbar.js';
import { UI_W } from '../view.js';
import { MobileSheets } from './mobilesheets.js';
import { MobileMiniMap } from './mobileminimap.js';
import { MobileSkins } from './mobileskins.js';

/** Seconds the chat lines stay after the last new one before they fade. */
const CHAT_SHOW = 8;
/** Lines shown: resting, and with the log opened. */
const LINES = 4, LINES_OPEN = 40;
/** A finger's tap: how far it may move (px) and how long it may stay down (ms) and still be one. */
const TAP_SLOP = 12, TAP_HOLD = 800;
/** The buttons along the top right (window functions, as Key Setting's), then the menu. */
const ACTIONS = [[MENU.ITEMS, 'Items', 'bag'], [MENU.EQUIP, 'Equipment', 'armor'], [MENU.SKILLS, 'Skills', 'star'], [MENU.QUESTS, 'Quests', 'scroll']];
/** The menu, in groups under a heading: window functions, then the status bar Menu's own entries. */
const MENU_ROWS = [
  // (no Mini Map: MOBILE UI has its own at the top left, and the window's would stay over it)
  'Character', [MENU.STATS, 'Stats'], [MENU.WORLDMAP, 'World Map'], [MENU.QUEST_HELPER, 'Quest Helper'],
  [MENU.MONSTERBOOK, 'Monster Book'], [MENU.MEDAL, 'Medals'],
  'Community', [MENU.BUDDY, 'Buddies'], [MENU.PARTY, 'Party'], [MENU.GUILD, 'Guild'], [MENU.PARTY_SEARCH, 'Party Search'],
  [MENU.MESSENGER, 'Messenger'], [MENU.FAMILY, 'Family'],
  'Game', [MENU.CASHSHOP, 'Cash Shop'], ['BtChannel', 'Change Channel'], [MENU.KEYS, 'Key Setting'], ['BtGameOpt', 'Game Options'],
  ['BtSysOpt', 'System Options'], ['BtQuit', 'Quit Game'],
];

const svg = (d, w = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  // a backpack: its rounded body, the carry handle on top, the flap with its buckle, and the front pocket
  bag: svg('<rect x="5" y="6.5" width="14" height="14.5" rx="4"/><path d="M9.5 6.5V5a2.5 2.5 0 0 1 5 0v1.5"/><path d="M5 11.5h14M12 11.5v2"/><path d="M8.5 21v-3.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V21"/>', 1.8),
  armor: svg('<path d="M8 3l4 2 4-2 4 4-3 3v10H7V10L4 7z"/>'),
  star: svg('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'),
  scroll: svg('<path d="M7 4h11v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-1h11v1a3 3 0 0 0 3 3"/><path d="M7 4a2 2 0 0 0-2 2v10M10 9h5M10 12h5"/>'),
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const CSS = `
.mhud { position: absolute; inset: 0; z-index: 6; font: 500 11px/1.25 -apple-system, "Segoe UI", system-ui, Arial, sans-serif;
  color: #f2f5fb; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
.mhud * { box-sizing: border-box; }
/* on a touch screen every finger goes to the game (touchdevice.js); its scrolling lists (data-scroll) slide again, held in */
html.touch-device .mhud [data-scroll="y"], html.touch-device .mhud [data-scroll="y"] * { touch-action: pan-y; }
html.touch-device .mhud [data-scroll="x"], html.touch-device .mhud [data-scroll="x"] * { touch-action: pan-x; }
.mhud [data-scroll] { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.mhud .mh-glass { background: linear-gradient(180deg, rgba(24, 33, 58, 0.66), rgba(11, 16, 31, 0.66));
  border: 1px solid rgba(255, 255, 255, 0.13); border-radius: 12px; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.mhud .mh-st { position: absolute; left: 50%; bottom: calc(6px + env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex;
  align-items: center; gap: 8px; padding: 5px 10px; border-radius: 14px; pointer-events: auto; white-space: nowrap;
  max-width: calc(100% - 12px - env(safe-area-inset-left) - env(safe-area-inset-right)); }
.mhud .mh-id { flex: none; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
/* a sheet open: out of the way until it closes */
.mhud.mh-sheeting .mh-st { display: none; }
.mhud .mh-lv { flex: none; font-weight: 800; font-size: 9.5px; color: #3a2400; background: linear-gradient(180deg, #ffe892, #f0b22e);
  border-radius: 6px; padding: 1px 5px; box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.18); }
.mhud .mh-nm { font-weight: 700; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.mhud .mh-jb { max-width: 96px; color: rgba(214, 224, 245, 0.62); font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; }
.mhud .mh-bar { flex: none; position: relative; width: clamp(64px, 13vw, 124px); height: 12px; border-radius: 6px; background: rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); overflow: hidden; }
.mhud .mh-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; transition: width 0.35s ease; }
.mhud .mh-bar.mh-hp i { background: linear-gradient(180deg, #ff8a8a, #d42a3c); }
.mhud .mh-bar.mh-mp i { background: linear-gradient(180deg, #8cc2ff, #2862d8); }
.mhud .mh-bar.mh-ex i { background: linear-gradient(180deg, #f9f191, #c4ac1c); }
.mhud .mh-bar.mh-low i { animation: mhud-pulse 0.9s ease-in-out infinite; }
@keyframes mhud-pulse { 50% { filter: brightness(1.7); } }
.mhud .mh-bar span { position: absolute; inset: 0; display: flex; justify-content: space-between; align-items: center; padding: 0 5px;
  font-size: 8px; font-weight: 700; letter-spacing: 0.2px; text-shadow: 0 0 2px #000, 0 0 2px #000; }
/* the buttons (and their menu) at the screen's very right edge, as the mini map is at the left */
.mhud .mh-act { position: absolute; right: 4px; top: 6px; display: flex; gap: 5px; padding: 4px;
  border-radius: 22px; pointer-events: auto; }
.mhud .mh-btn { position: relative; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #e9eefb;
  background: radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.17), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(255, 255, 255, 0.15);
  touch-action: manipulation; cursor: pointer; }
.mhud .mh-btn:active, .mhud .mh-btn.mh-on { background: rgba(122, 170, 255, 0.4); border-color: rgba(170, 205, 255, 0.5); }
.mhud .mh-btn svg { width: 17px; height: 17px; pointer-events: none; }
.mhud .mh-menu { position: absolute; right: 4px; top: 50px; width: 186px; max-height: calc(100% - 58px);
  overflow-y: auto; padding: 5px; pointer-events: auto; display: none; -webkit-overflow-scrolling: touch; }
.mhud .mh-menu.mh-open { display: block; }
.mhud .mh-row { display: flex; align-items: center; gap: 9px; min-height: 30px; padding: 3px 8px; border-radius: 8px; font-size: 12px; cursor: pointer; }
.mhud .mh-row:active { background: rgba(122, 170, 255, 0.3); }
.mhud .mh-head { padding: 7px 8px 3px; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: rgba(240, 190, 80, 0.85); }
.mhud .mh-head:not(:first-child) { margin-top: 3px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
/* the chat keeps to the screen's very left edge (an iPhone's side inset is for its camera, higher up) */
.mhud .mh-chat { position: absolute; left: 4px; bottom: calc(38px + env(safe-area-inset-bottom));
  width: min(34%, 280px); display: flex; align-items: flex-end; gap: 5px; }
.mhud.mh-saying .mh-chat { left: 50%; transform: translateX(-50%); bottom: calc(64px + env(safe-area-inset-bottom)); width: var(--mh-line-w, min(64%, 540px)); }
/* the chat's handle: a little tab with an up arrow standing out of the status line's top, in its middle */
.mhud .mh-st-tab { position: absolute; left: 50%; top: -15px; transform: translateX(-50%); width: 40px; height: 15px; display: grid; place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.13); border-bottom: 0; border-radius: 10px 10px 0 0; color: #e9eefb; cursor: pointer;
  background: linear-gradient(180deg, rgba(30, 41, 70, 0.8), rgba(18, 25, 46, 0.72)); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.22); transition: transform 0.15s ease; }
.mhud .mh-st-tab::before { content: ''; position: absolute; inset: -12px -12px 0; }   /* a finger-sized place to tap */
.mhud .mh-st-tab svg { width: 12px; height: 12px; margin-top: 1px; pointer-events: none; }
.mhud .mh-st-tab:active { transform: translateX(-50%) translateY(-2px); color: #ffd978; }
.mhud.mh-saying .mh-st-tab { display: none; }
/* new lines while the chat is closed: a gold dot on the tab */
.mhud .mh-st-tab.mh-unread::after { content: ''; position: absolute; top: 2px; right: 7px; width: 6px; height: 6px; border-radius: 50%;
  background: #ffd25e; box-shadow: 0 0 6px rgba(255, 210, 94, 0.85); }
/* the chat shows only while it is open */
.mhud:not(.mh-saying) .mh-chat { display: none; }
.mhud .mh-log { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; max-height: 5.6em;
  overflow: hidden; font-size: 10px; line-height: 1.25; text-shadow: 0 1px 2px #000, 0 0 2px #000; transition: opacity 0.7s; pointer-events: none; }
.mhud .mh-log.mh-quiet { opacity: 0; pointer-events: none; }
.mhud .mh-log.mh-open { max-height: 52vh; overflow-y: auto; padding: 6px 8px; border-radius: 10px; background: rgba(8, 12, 24, 0.6);
  opacity: 1; pointer-events: auto; -webkit-overflow-scrolling: touch; }
.mhud .mh-log div { overflow-wrap: anywhere; }
.mhud .mh-log div.mh-tag { padding: 0 5px; border-radius: 4px; text-shadow: none; }
.mhud .mh-say { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(34px + env(safe-area-inset-bottom));
  width: var(--mh-line-w, min(64%, 540px)); display: none; align-items: center; gap: 5px; padding: 3px 4px; border-radius: 14px; pointer-events: auto; }
.mhud .mh-say.mh-open { display: flex; }
.mhud .mh-tgt { flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; padding: 6px 10px; border-radius: 14px; white-space: nowrap;
  font-size: 11px; font-weight: 700; background: rgba(255, 255, 255, 0.1); cursor: pointer; }
.mhud .mh-say .mh-tgt { padding: 3px 9px; border-radius: 10px; font-size: 10px; }
.mhud .mh-say input { flex: 1; min-width: 0; height: 20px; padding: 0 10px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.38); color: #fff; font: 13px -apple-system, "Segoe UI", system-ui, sans-serif; outline: none; -webkit-user-select: text; user-select: text; }
.mhud .mh-send { flex: none; height: 20px; padding: 0 11px; border: 0; border-radius: 10px; cursor: pointer; font-weight: 800; font-size: 10.5px;
  color: #3a2400; background: linear-gradient(180deg, #ffe07a, #f0aa2c); }
.mhud .mh-say .mh-closebtn { width: 20px; height: 20px; }
.mhud .mh-say .mh-closebtn svg { width: 11px; height: 11px; }
.mhud .mh-tlist { position: absolute; bottom: calc(64px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
  width: var(--mh-line-w, min(64%, 540px)); display: none; flex-wrap: wrap; gap: 5px; padding: 6px; pointer-events: auto; }
.mhud .mh-tlist.mh-open { display: flex; }
.mhud .mh-tlist .mh-tgt.mh-on { background: rgba(122, 170, 255, 0.45); }
`;

export class MobileHud {
  constructor(game, root) {
    this.g = game;
    if (!document.getElementById('mhud-css')) {
      const s = document.createElement('style');
      s.id = 'mhud-css'; s.textContent = CSS;
      document.head.append(s);
    }
    const el = this.el = document.createElement('div');
    el.className = 'mhud';
    el.style.pointerEvents = 'none';   // only its panels take touches; the rest falls through to the game
    el.innerHTML = `
      <div class="mh-st mh-glass">
        <div class="mh-st-tab" title="Chat">${ICON.up}</div>
        <div class="mh-id"><span class="mh-lv">Lv. 1</span><span class="mh-nm"></span><span class="mh-jb"></span></div>
        <div class="mh-bar mh-hp"><i></i><span><b>HP</b><em></em></span></div>
        <div class="mh-bar mh-mp"><i></i><span><b>MP</b><em></em></span></div>
        <div class="mh-bar mh-ex"><i></i><span><b>EXP</b><em></em></span></div>
      </div>
      <div class="mh-act mh-glass"></div>
      <div class="mh-menu mh-glass" data-scroll="y"></div>
      <div class="mh-chat"><div class="mh-log mh-quiet" data-scroll="y"></div></div>
      <div class="mh-tlist mh-glass"></div>
      <div class="mh-say mh-glass"><span class="mh-tgt"></span><input type="text" maxlength="70" enterkeyhint="send" autocomplete="off" autocapitalize="off"
        spellcheck="false"><button class="mh-send" type="button">Send</button><div class="mh-btn mh-closebtn" title="Close">${ICON.close}</div></div>`;
    root.append(el);
    // a press on any of its panels holds off their redrawing until it lifts (busy), so a tap lands on what it was on
    el.addEventListener('pointerdown', () => { this.pressAt = performance.now(); }, true);
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => { this.pressAt = 0; }, true);
    // and should a click (or double-click) still come of a tap on its panels, it goes nowhere behind them
    for (const t of ['click', 'dblclick']) {
      addEventListener(t, (e) => {
        if (performance.now() - (this.tappedAt ?? -1e9) < 700 && !e.target?.closest?.('.mhud')) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
    }
    const $ = (s) => el.querySelector(s);
    this.parts = { st: $('.mh-st'), lv: $('.mh-lv'), nm: $('.mh-nm'), jb: $('.mh-jb'), act: $('.mh-act'), menu: $('.mh-menu'), log: $('.mh-log'), chat: $('.mh-chat'),
      say: $('.mh-say'), tgt: $('.mh-say .mh-tgt'), input: $('.mh-say input'), tlist: $('.mh-tlist'),
      bars: { hp: $('.mh-bar.mh-hp'), mp: $('.mh-bar.mh-mp'), ex: $('.mh-bar.mh-ex') } };
    const P = this.parts;
    this.tap(P.st, () => this.g.toggleMenu(MENU.STATS));
    // the buttons along the top, then the menu's
    this.actionBtns = [];
    for (const [m, title, icon] of ACTIONS) {
      const b = document.createElement('div');
      b.className = 'mh-btn'; b.title = title; b.innerHTML = ICON[icon];
      this.actionBtns.push([b, MobileSheets.kindOf(m, MENU)]);
      this.tap(b, () => { this.closeMenu(); this.g.toggleMenu(m); });
      P.act.append(b);
    }
    const mb = document.createElement('div');
    mb.className = 'mh-btn mh-menubtn'; mb.title = 'Menu'; mb.innerHTML = ICON.menu;
    this.tap(mb, () => this.toggleMenu());
    P.act.append(mb);
    this.menuBtn = mb;
    for (const r of MENU_ROWS) {
      if (typeof r === 'string') { const h = document.createElement('div'); h.className = 'mh-head'; h.textContent = r; P.menu.append(h); continue; }
      const [m, label] = r, row = document.createElement('div');
      row.className = 'mh-row'; row.textContent = label;
      this.tap(row, () => { this.closeMenu(); if (typeof m === 'number') this.g.toggleMenu(m); else this.g.statusBar?.menuAction(m); });
      P.menu.append(row);
    }
    // chat
    this.tab = el.querySelector('.mh-st-tab');
    this.tap(this.tab, () => this.openSay('', false));   // (a phone's keyboard comes up only when the line itself is tapped)
    this.tap(P.tgt, () => this.toggleTargets());
    this.tap(el.querySelector('.mh-send'), () => this.send());
    this.tap(el.querySelector('.mh-closebtn'), () => this.closeSay());
    for (const t of CHAT_TARGETS) {
      const b = document.createElement('span');
      b.className = 'mh-tgt'; b.dataset.key = t.key; b.textContent = t.label;
      this.tap(b, () => { this.closeTargets(); this.g.statusBar?.chooseTarget(t.key); });
      P.tlist.append(b);
    }
    // typing goes to the line, not to the game's keys
    P.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.send(); } else if (e.key === 'Escape') this.closeSay();
    });
    for (const t of ['keyup', 'keypress']) P.input.addEventListener(t, (e) => e.stopPropagation());
    // the mini map, then the windows' sheets, under the menu and the chat line
    this.mini = new MobileMiniMap(this, el);
    this.sheets = new MobileSheets(this, el);
    el.append(P.menu, P.tlist, P.say);
    // over all of it: the conversations, boxes, shop, trade and notices standing in for the client's windows
    this.skins = new MobileSkins(this);
    this.seen = null; this.lastLineAt = -Infinity; this.logOpen = false;
    this.timer = setInterval(() => this.update(), 150);
    this.update();
  }

  /**
   * A tap, without the game seeing it. A finger's counts as it lifts (within TAP_SLOP of where it came down, and not
   * held past TAP_HOLD) rather than on the browser's click, which a phone sends late, or not at all when another
   * finger is down or the page changed just then; the click after it is let go. A mouse still goes by the click.
   */
  tap(node, fn) {
    let down = null;
    node.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      down = e.pointerType === 'mouse' ? null : { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    });
    node.addEventListener('pointercancel', () => { down = null; });   // (the list took the finger to scroll)
    node.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || performance.now() - d.t > TAP_HOLD) return;
      e.stopPropagation();
      this.tappedAt = performance.now();
      if (!node.disabled) fn(e);
    });
    // the touch's end after a tap that was taken: no click and mouse events of its own (they would go to whatever is
    // under the finger once the tap has closed its panel - the field, an NPC)
    node.addEventListener('touchend', (e) => { if (performance.now() - (this.tappedAt ?? -1e9) < 150 && e.cancelable) e.preventDefault(); });
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (performance.now() - (this.tappedAt ?? -1e9) < 700) return;   // the click a finger's tap brings after it
      if (!node.disabled) fn(e);
    });
  }
  /** A finger (or mouse button) is down on one of its panels: what it shows isn't drawn again under it until it lifts. */
  get busy() { return !!this.pressAt && performance.now() - this.pressAt < 1500; }

  /** Its top panels (the mini map, the buttons) in interface pixels: a window opening under them is moved down (WindowManager.fit). */
  reserved() {
    if (!this.shown) return [];
    const c = this.g.canvas.getBoundingClientRect(), k = UI_W / (c.width || 1);
    return [this.mini.el, this.parts.act].filter((n) => n.offsetParent).map((n) => {
      const r = n.getBoundingClientRect();
      return { x: (r.left - c.left) * k, y: (r.top - c.top) * k, w: r.width * k, h: r.height * k };
    });
  }
  get shown() { return !!settings.mobileUi && !!this.g.stats && !this.g.uiLocked && !this.g.inCashShop; }
  /** Shown or hidden as MOBILE UI, a scene or the Cash Shop say; called when the setting changes, and every tick. */
  refresh() {
    const on = this.shown;
    this.el.style.display = on ? '' : 'none';
    if (!on) { this.closeMenu(); this.closeTargets(); this.sheets?.close(); if (this.parts.say.classList.contains('mh-open')) this.closeSay(); }
  }
  /** A window function (MENU id) whose window it has a sheet for: that sheet opens or closes; false for the others. */
  sheet(m) {
    const kind = MobileSheets.kindOf(m, MENU);
    if (!kind) return false;
    // Buddy / Party / Guild: the community sheet on that tab (another tab while it is open moves to it, not closes it)
    const tab = MobileSheets.communityTab(m, MENU);
    if (tab !== undefined && this.shown) {
      const moving = this.sheets.kind === 'community' && this.sheets.tab.community !== tab;
      this.sheets.tab.community = tab;
      if (moving) { this.closeMenu(); this.sheets.show('community'); this.update(); return true; }
    }
    return this.openSheet(kind);
  }
  /** A sheet by its kind (System Options too) opens, or closes when it is the one open; false while hidden. */
  openSheet(kind, keep = false) {
    if (!this.shown) return false;
    this.closeMenu();
    this.sheets.toggle(kind, keep);
    this.update();
    return true;
  }

  update() {
    this.refresh();
    if (this.el.style.display === 'none') return;
    const s = this.g.stats, P = this.parts;
    // you, and your gauges
    const set = (node, text) => { if (node.textContent !== text) node.textContent = text; };
    set(P.lv, `Lv. ${s.level}`); set(P.nm, s.name || ''); set(P.jb, jobName(s.job) || '');
    const maxHp = Math.max(1, this.g.maxHpShown?.() || s.maxhp || 1), maxMp = Math.max(1, this.g.maxMpShown?.() || s.maxmp || 1);
    const need = EXP[s.level] || 1;
    this.gauge(P.bars.hp, s.hp / maxHp, `${s.hp} / ${maxHp}`, s.hp / maxHp < (settings.hpAlert || 0));
    this.gauge(P.bars.mp, s.mp / maxMp, `${s.mp} / ${maxMp}`, s.mp / maxMp < (settings.mpAlert || 0));
    this.gauge(P.bars.ex, s.exp / need, `${((s.exp / need) * 100).toFixed(2)}%`, false);
    // the chat: new lines show it again; it fades CHAT_SHOW s after the last
    const lines = this.g.statusBar?.lines || [], last = lines[lines.length - 1] || null;
    if (last !== this.seen) {
      this.seen = last; this.lastLineAt = performance.now(); this.drawLog(lines);
      if (last && !P.say.classList.contains('mh-open')) this.tab.classList.add('mh-unread');
    }
    const quiet = !this.logOpen && performance.now() - this.lastLineAt > CHAT_SHOW * 1000;
    P.log.classList.toggle('mh-quiet', quiet);
    // the chat target, as the bar's box names it (whispering: who to)
    const sb = this.g.statusBar, key = sb?.chatTarget || 'all';
    set(P.tgt, key === 'whisper' && sb?.whisperTo ? sb.whisperTo : CHAT_TARGETS.find((t) => t.key === key)?.label || 'To All');
    for (const b of P.tlist.children) b.classList.toggle('mh-on', b.dataset.key === key);
    for (const [b, kind] of this.actionBtns) b.classList.toggle('mh-on', this.sheets.kind === kind);
    if (P.say.classList.contains('mh-open')) this.matchLine();   // (the status line grows with its numbers)
  }
  gauge(bar, ratio, text, low) {
    const w = `${Math.max(0, Math.min(1, ratio || 0)) * 100}%`, fill = bar.firstElementChild, em = bar.querySelector('em');
    if (fill.style.width !== w) fill.style.width = w;
    if (em.textContent !== text) em.textContent = text;
    bar.classList.toggle('mh-low', !!low);
  }
  drawLog(lines) {
    const P = this.parts, list = lines.slice(-(this.logOpen ? LINES_OPEN : LINES));
    P.log.replaceChildren(...list.map((l) => {
      const d = document.createElement('div');
      d.textContent = l.text.replace(/^\s+/, (m) => (m.length > 1 ? '  ' : m));
      d.style.color = l.color || '#fff';
      if (l.bg) { d.className = 'mh-tag'; d.style.background = l.bg; }
      return d;
    }));
    if (this.logOpen) P.log.scrollTop = P.log.scrollHeight;
  }
  toggleLog() {
    this.logOpen = !this.logOpen;
    this.parts.log.classList.toggle('mh-open', this.logOpen);
    this.drawLog(this.g.statusBar?.lines || []);
  }

  /** The menu: opening it puts away the sheet that is open (Key Setting asks about unsaved changes first). */
  toggleMenu() {
    const open = !this.parts.menu.classList.contains('mh-open');
    if (open && this.sheets?.kind) { if (this.sheets.kind === 'keys') this.sheets.closeAsked(); else this.sheets.close(); }
    this.parts.menu.classList.toggle('mh-open', open);
    this.menuBtn.classList.toggle('mh-on', open);
  }
  closeMenu() { this.parts.menu.classList.remove('mh-open'); this.menuBtn?.classList.remove('mh-on'); }
  toggleTargets() { this.parts.tlist.classList.toggle('mh-open'); }
  closeTargets() { this.parts.tlist.classList.remove('mh-open'); }

  /**
   * The line to type on (from the chat tab, Enter, or a chat key), with what was asked to start it; typing starts at
   * once (focus) from a key, while the tab only opens it.
   */
  openSay(prefix = '', focus = true) {
    const P = this.parts;
    P.say.classList.add('mh-open');
    this.tab.classList.remove('mh-unread');
    this.el.classList.add('mh-saying');
    this.matchLine();
    if (!this.logOpen) this.toggleLog();
    if (prefix && !P.input.value) P.input.value = prefix;
    if (focus) P.input.focus();
  }
  /** The line to type on (and the log and targets over it) as wide as the status line. */
  matchLine() {
    const w = this.parts.st.offsetWidth;
    if (w && this.lineW !== w) { this.lineW = w; this.el.style.setProperty('--mh-line-w', `${w}px`); }
  }
  closeSay() {
    const P = this.parts;
    P.input.blur();
    P.say.classList.remove('mh-open');
    this.el.classList.remove('mh-saying');
    if (this.logOpen) this.toggleLog();
    this.closeTargets();
  }
  /** Sent as the bar's own line is: kept in its history, then said through its checks (repeats, too fast). */
  send() {
    const sb = this.g.statusBar, P = this.parts, t = P.input.value.replace(/[^\x20-\x7e]/g, ' ').trim();
    P.input.value = '';
    if (t && sb) { sb.remember(t); sb.say(t); }
    this.closeSay();
  }
}
