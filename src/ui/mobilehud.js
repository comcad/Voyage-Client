/**
 * MOBILE UI (System Option): a small HTML interface over the game for phones, in place of the status bar (which is
 * hidden then). It keeps to the edges so the field stays clear:
 *   - top left: your level, name and job, and slim HP / MP / EXP bars (a tap opens the Stat window);
 *   - top right: round buttons for the windows used most, and a menu for the rest;
 *   - bottom middle (between the touch stick and buttons): the last chat lines, fading out when the chat is quiet,
 *     and a chat button that opens a line to type on, with the chat target beside it.
 * Everything goes through the status bar's own code (its log, history, chat targets and menu actions) and
 * Game.toggleMenu, so nothing behaves differently from the bar; only the look and the place differ.
 */
import { EXP, jobName } from '../data.js';
import { MENU } from '../keymap.js';
import { settings } from '../settings.js';
import { CHAT_TARGETS } from './statusbar.js';
import { UI_W } from '../view.js';

/** Seconds the chat lines stay after the last new one before they fade. */
const CHAT_SHOW = 8;
/** Lines shown: resting, and with the log opened. */
const LINES = 4, LINES_OPEN = 40;
/** The buttons along the top right (window functions, as Key Setting's), then the menu. */
const ACTIONS = [[MENU.ITEMS, 'Items', 'bag'], [MENU.EQUIP, 'Equipment', 'armor'], [MENU.SKILLS, 'Skills', 'star'], [MENU.QUESTS, 'Quests', 'scroll']];
/** The menu, in groups under a heading: window functions, then the status bar Menu's own entries. */
const MENU_ROWS = [
  'Character', [MENU.STATS, 'Stats'], [MENU.WORLDMAP, 'World Map'], [MENU.MINIMAP, 'Mini Map'], [MENU.QUEST_HELPER, 'Quest Helper'],
  [MENU.MONSTERBOOK, 'Monster Book'], [MENU.MEDAL, 'Medals'],
  'Community', [MENU.BUDDY, 'Buddies'], [MENU.PARTY, 'Party'], [MENU.GUILD, 'Guild'], [MENU.PARTY_SEARCH, 'Party Search'],
  [MENU.MESSENGER, 'Messenger'], [MENU.FAMILY, 'Family'],
  'Game', [MENU.CASHSHOP, 'Cash Shop'], ['BtChannel', 'Change Channel'], [MENU.KEYS, 'Key Setting'], ['BtGameOpt', 'Game Options'],
  ['BtSysOpt', 'System Options'], ['BtQuit', 'Quit Game'],
];

const svg = (d, w = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  bag: svg('<path d="M6 8h12l1 12H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  armor: svg('<path d="M8 3l4 2 4-2 4 4-3 3v10H7V10L4 7z"/>'),
  star: svg('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'),
  scroll: svg('<path d="M7 4h11v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-1h11v1a3 3 0 0 0 3 3"/><path d="M7 4a2 2 0 0 0-2 2v10M10 9h5M10 12h5"/>'),
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v10H9l-5 4z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const CSS = `
.mhud { position: absolute; inset: 0; z-index: 6; font: 500 11px/1.25 -apple-system, "Segoe UI", system-ui, Arial, sans-serif;
  color: #f2f5fb; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
.mhud * { box-sizing: border-box; }
.mhud .mh-glass { background: linear-gradient(180deg, rgba(24, 33, 58, 0.66), rgba(11, 16, 31, 0.66));
  border: 1px solid rgba(255, 255, 255, 0.13); border-radius: 12px; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.mhud .mh-st { position: absolute; left: calc(6px + env(safe-area-inset-left)); top: 6px; width: 172px; padding: 5px 8px 7px; pointer-events: auto; }
.mhud .mh-id { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.mhud .mh-lv { flex: none; font-weight: 800; font-size: 9.5px; color: #3a2400; background: linear-gradient(180deg, #ffe892, #f0b22e);
  border-radius: 6px; padding: 1px 5px; box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.18); }
.mhud .mh-nm { font-weight: 700; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.mhud .mh-jb { color: rgba(214, 224, 245, 0.62); font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; }
.mhud .mh-bar { position: relative; height: 10px; margin-top: 4px; border-radius: 5px; background: rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); overflow: hidden; }
.mhud .mh-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; transition: width 0.35s ease; }
.mhud .mh-bar.mh-hp i { background: linear-gradient(180deg, #ff8a8a, #d42a3c); }
.mhud .mh-bar.mh-mp i { background: linear-gradient(180deg, #8cc2ff, #2862d8); }
.mhud .mh-bar.mh-ex i { background: linear-gradient(180deg, #f9f191, #c4ac1c); }
.mhud .mh-bar.mh-low i { animation: mhud-pulse 0.9s ease-in-out infinite; }
@keyframes mhud-pulse { 50% { filter: brightness(1.7); } }
.mhud .mh-bar span { position: absolute; inset: 0; display: flex; justify-content: space-between; align-items: center; padding: 0 5px;
  font-size: 8px; font-weight: 700; letter-spacing: 0.2px; text-shadow: 0 0 2px #000, 0 0 2px #000; }
.mhud .mh-act { position: absolute; right: calc(6px + env(safe-area-inset-right)); top: 6px; display: flex; gap: 5px; padding: 4px;
  border-radius: 22px; pointer-events: auto; }
.mhud .mh-btn { position: relative; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: #e9eefb;
  background: radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.17), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(255, 255, 255, 0.15);
  touch-action: manipulation; cursor: pointer; }
.mhud .mh-btn:active, .mhud .mh-btn.mh-on { background: rgba(122, 170, 255, 0.4); border-color: rgba(170, 205, 255, 0.5); }
.mhud .mh-btn svg { width: 17px; height: 17px; pointer-events: none; }
.mhud .mh-menu { position: absolute; right: calc(6px + env(safe-area-inset-right)); top: 50px; width: 186px; max-height: calc(100% - 58px);
  overflow-y: auto; padding: 5px; pointer-events: auto; display: none; -webkit-overflow-scrolling: touch; }
.mhud .mh-menu.mh-open { display: block; }
.mhud .mh-row { display: flex; align-items: center; gap: 9px; min-height: 30px; padding: 3px 8px; border-radius: 8px; font-size: 12px; cursor: pointer; }
.mhud .mh-row:active { background: rgba(122, 170, 255, 0.3); }
.mhud .mh-head { padding: 7px 8px 3px; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: rgba(240, 190, 80, 0.85); }
.mhud .mh-head:not(:first-child) { margin-top: 3px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.mhud .mh-chat { position: absolute; left: 50%; bottom: calc(6px + env(safe-area-inset-bottom)); transform: translateX(-50%);
  width: min(44%, 380px); display: flex; align-items: flex-end; gap: 6px; }
.mhud .mh-log { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; max-height: 5.6em;
  overflow: hidden; font-size: 11px; line-height: 1.3; text-shadow: 0 1px 2px #000, 0 0 2px #000; transition: opacity 0.7s; pointer-events: auto; }
.mhud .mh-log.mh-quiet { opacity: 0; pointer-events: none; }
.mhud .mh-log.mh-open { max-height: 52vh; overflow-y: auto; padding: 6px 8px; border-radius: 10px; background: rgba(8, 12, 24, 0.6);
  opacity: 1; pointer-events: auto; -webkit-overflow-scrolling: touch; }
.mhud .mh-log div { overflow-wrap: anywhere; }
.mhud .mh-log div.mh-tag { padding: 0 5px; border-radius: 4px; text-shadow: none; }
.mhud .mh-chat .mh-btn { flex: none; pointer-events: auto; }
.mhud .mh-say { position: absolute; left: 50%; bottom: calc(6px + env(safe-area-inset-bottom)); transform: translateX(-50%);
  width: min(66%, 540px); display: none; align-items: center; gap: 6px; padding: 4px; border-radius: 20px; pointer-events: auto; }
.mhud .mh-say.mh-open { display: flex; }
.mhud .mh-tgt { flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; padding: 6px 10px; border-radius: 14px; white-space: nowrap;
  font-size: 11px; font-weight: 700; background: rgba(255, 255, 255, 0.1); cursor: pointer; }
.mhud .mh-say input { flex: 1; min-width: 0; height: 30px; padding: 0 12px; border-radius: 15px; border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.38); color: #fff; font: 14px -apple-system, "Segoe UI", system-ui, sans-serif; outline: none; -webkit-user-select: text; user-select: text; }
.mhud .mh-send { flex: none; height: 30px; padding: 0 14px; border: 0; border-radius: 15px; cursor: pointer; font-weight: 800; font-size: 12px;
  color: #3a2400; background: linear-gradient(180deg, #ffe07a, #f0aa2c); }
.mhud .mh-tlist { position: absolute; bottom: calc(46px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
  width: min(66%, 540px); display: none; flex-wrap: wrap; gap: 5px; padding: 6px; pointer-events: auto; }
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
        <div class="mh-id"><span class="mh-lv">Lv. 1</span><span class="mh-nm"></span><span class="mh-jb"></span></div>
        <div class="mh-bar mh-hp"><i></i><span><b>HP</b><em></em></span></div>
        <div class="mh-bar mh-mp"><i></i><span><b>MP</b><em></em></span></div>
        <div class="mh-bar mh-ex"><i></i><span><b>EXP</b><em></em></span></div>
      </div>
      <div class="mh-act mh-glass"></div>
      <div class="mh-menu mh-glass"></div>
      <div class="mh-chat"><div class="mh-btn mh-glass mh-chatbtn" title="Chat">${ICON.chat}</div><div class="mh-log mh-quiet"></div></div>
      <div class="mh-tlist mh-glass"></div>
      <div class="mh-say mh-glass"><span class="mh-tgt"></span><input type="text" maxlength="70" enterkeyhint="send" autocomplete="off" autocapitalize="off"
        spellcheck="false"><button class="mh-send" type="button">Send</button><div class="mh-btn mh-closebtn" title="Close">${ICON.close}</div></div>`;
    root.append(el);
    const $ = (s) => el.querySelector(s);
    this.parts = { st: $('.mh-st'), lv: $('.mh-lv'), nm: $('.mh-nm'), jb: $('.mh-jb'), act: $('.mh-act'), menu: $('.mh-menu'), log: $('.mh-log'), chat: $('.mh-chat'),
      say: $('.mh-say'), tgt: $('.mh-say .mh-tgt'), input: $('.mh-say input'), tlist: $('.mh-tlist'),
      bars: { hp: $('.mh-bar.mh-hp'), mp: $('.mh-bar.mh-mp'), ex: $('.mh-bar.mh-ex') } };
    const P = this.parts;
    this.tap(P.st, () => this.g.toggleMenu(MENU.STATS));
    // the buttons along the top, then the menu's
    for (const [m, title, icon] of ACTIONS) {
      const b = document.createElement('div');
      b.className = 'mh-btn'; b.title = title; b.innerHTML = ICON[icon];
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
    this.tap(el.querySelector('.mh-chatbtn'), () => this.openSay());
    this.tap(P.log, () => this.toggleLog());
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
    this.seen = null; this.lastLineAt = -Infinity; this.logOpen = false;
    this.timer = setInterval(() => this.update(), 150);
    this.update();
  }

  /** A tap (a touch or a click), without the game seeing it. */
  tap(node, fn) {
    node.addEventListener('pointerdown', (e) => e.stopPropagation());
    node.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
  }

  /** Its top panels (your gauges, the buttons) in interface pixels: a window opening under them is moved down (WindowManager.fit). */
  reserved() {
    if (!this.shown) return [];
    const c = this.g.canvas.getBoundingClientRect(), k = UI_W / (c.width || 1);
    return [this.parts.st, this.parts.act].map((n) => {
      const r = n.getBoundingClientRect();
      return { x: (r.left - c.left) * k, y: (r.top - c.top) * k, w: r.width * k, h: r.height * k };
    });
  }
  get shown() { return !!settings.mobileUi && !!this.g.stats && !this.g.uiLocked && !this.g.inCashShop; }
  /** Shown or hidden as MOBILE UI, a scene or the Cash Shop say; called when the setting changes, and every tick. */
  refresh() {
    const on = this.shown;
    this.el.style.display = on ? '' : 'none';
    if (!on) { this.closeMenu(); this.closeTargets(); if (this.parts.say.classList.contains('mh-open')) this.closeSay(); }
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
    if (last !== this.seen) { this.seen = last; this.lastLineAt = performance.now(); this.drawLog(lines); }
    const quiet = !this.logOpen && performance.now() - this.lastLineAt > CHAT_SHOW * 1000;
    P.log.classList.toggle('mh-quiet', quiet);
    // the chat target, as the bar's box names it (whispering: who to)
    const sb = this.g.statusBar, key = sb?.chatTarget || 'all';
    set(P.tgt, key === 'whisper' && sb?.whisperTo ? sb.whisperTo : CHAT_TARGETS.find((t) => t.key === key)?.label || 'To All');
    for (const b of P.tlist.children) b.classList.toggle('mh-on', b.dataset.key === key);
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

  toggleMenu() {
    const open = !this.parts.menu.classList.contains('mh-open');
    this.parts.menu.classList.toggle('mh-open', open);
    this.menuBtn.classList.toggle('mh-on', open);
  }
  closeMenu() { this.parts.menu.classList.remove('mh-open'); this.menuBtn?.classList.remove('mh-on'); }
  toggleTargets() { this.parts.tlist.classList.toggle('mh-open'); }
  closeTargets() { this.parts.tlist.classList.remove('mh-open'); }

  /** The line to type on (from the chat button, Enter, or a chat key), with what was asked to start it. */
  openSay(prefix = '') {
    const P = this.parts;
    P.say.classList.add('mh-open');
    P.chat.style.visibility = 'hidden';
    if (prefix && !P.input.value) P.input.value = prefix;
    P.input.focus();
  }
  closeSay() {
    const P = this.parts;
    P.input.blur();
    P.say.classList.remove('mh-open');
    P.chat.style.visibility = '';
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
