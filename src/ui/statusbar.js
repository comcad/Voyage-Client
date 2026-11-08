import { isCanvas } from '../assets.js';
import { Anim } from '../map.js';
import { EXP, jobName, itemIcon, itemKeyType } from '../data.js';
import { sfx } from '../audio.js';
import { WzButton, TextField, uiText } from './wzui.js';
import { helpTip } from './windows.js';
import { settings } from '../settings.js';
import { DEFAULT_QUICKSLOTS, DEFAULT_QUICKSLOTS2 } from '../keymap.js';

/**
 * The v83 status bar (UI/StatusBar.img), drawn on the game canvas across the bottom 71px,
 * with its chat log, pop-up menus (UIWindow.img GameMenu / ShortCut) and quick slots.
 * The client hard-codes its layout, so positions here are measured from the art:
 *   base/backgrnd (800x71)   white band rows 3-29, grey band rows 35-70
 *   base/backgrnd2 (570x71)  chat strip x 0-562 rows 7-28; dark panels x 0-207 (LV plate to x 77,
 *                            then name / job) and x 209-562 rows 36-69, holding gauge/bar centred
 *   gauge/bar fills          HP x 2-106, MP x 110-214, EXP x 223-337, rows 15-28
 *   base/quickSlot (151x80)  cells x 9/44/79/114 (28 wide), y 9/43 (25 tall)
 *   GameMenu / ShortCut      dark interiors from y 22, x 5 / 4; 81x25 buttons every 26px
 */
export const BAR_H = 71;
// who the chat line talks to, in the order of the client's drop-up list (top to bottom, To All last)
export const CHAT_TARGETS = [
  { key: 'buddy', label: 'To a buddy' }, { key: 'group', label: 'To Group' }, { key: 'party', label: 'To the party' },
  { key: 'guild', label: 'To the Guild' }, { key: 'alliance', label: 'To Alliance' }, { key: 'spouse', label: 'To Spouse' },
  { key: 'whisper', label: 'Whisper' }, { key: 'all', label: 'To All' },
];
// the drop-up list over the target box: rows of 18 on the client's navy, the current one lit
const TMENU = { x: 1, w: 92, row: 18, bg: '#315574', lit: '#569ab8', border: '#9aa3ab', inner: '#6d7d8a' };
const GAUGE = { x: 216, y: 37 };
const FILLS = { hp: { x: 2, w: 105 }, mp: { x: 110, w: 105 }, exp: { x: 223, w: 115 } };
const FILL_Y = 15, FILL_H = 14;
const CHAT = { x: 84, y: 9, w: 430, h: 18 };          // text field in the white strip, after the target box
// the chat log: 580 wide, 13px lines, 64 kept, long lines wrapped at 535px (497 for a megaphone's first line),
// on a see-through black band; VScr5 at x 551
const CHAT_W = 580, LINE_H = 13, CHAT_MAX = 64, WRAP_W = 535, WRAP_MEGA = 497, SCROLL_X = 551, BAND = 'rgba(0,0,0,0.54)';
const CHAT_H = { min: 26, max: 507, def: 70 }, BAND_W = SCROLL_X + 15;   // the band ends with the scrollbar
// line colours by kind
export const CHAT_COLOR = {
  all: '#FFFFFF', whisper: '#00FF00', party: '#FF99CC', buddy: '#FF9900', guild: '#E1ACFE', alliance: '#A6FF7F', spouse: '#FF28A7',
  grey: '#BBBBBB', yellow: '#FFFF00', result: '#FFF080', notice: '#60CEFF', error: '#FFAFAF',
};
// megaphone-style lines: text on a coloured bar
export const CHAT_BAR = {
  gm: { color: '#000000', bg: 'rgba(255,255,255,0.69)' }, mega: { color: '#003F7F', bg: 'rgba(202,231,255,0.69)' },
  superMega: { color: '#770042', bg: 'rgba(255,191,221,0.8)' }, itemMega: { color: '#462706', bg: 'rgba(255,198,0,0.87)' },
  avatarMega: { color: '#FC8BE5', bg: 'rgba(77,26,173,0.17)' },
};
// these kinds wrap flush; the rest indent their continuation lines by five spaces
const FLUSH = new Set([CHAT_COLOR.grey, CHAT_COLOR.yellow, CHAT_COLOR.result, CHAT_COLOR.notice, CHAT_COLOR.error, CHAT_BAR.gm.color]);
// the notice box (base/box, 42x19) right of the chat line, its pencil (base/iconMemo) in the right cell:
// invitations rise out of it (ui/notifier.js points at NOTICE_ICON)
const NOTICE_BOX = { x: 571, y: 7 }, TABS_X = 614;
export const NOTICE_ICON = { x: 596, y: 11, w: 14 };       // log above the bar, as wide as base/chat
// the quick slots show the keys in game.quickKeys (Key Setting's CHANGE QUICK SLOTS), each labelled by
// UIWindow.img/KeyConfig/quickslotConfig/key/<scancode> 2px into its icon box
// the panel sits 2px in from the right edge on top of the bar (beside it, on a screen wide enough); each slot's 32x32
// icon box, from the panel's corner
const BAR_W = 800, QUICK_W = 151, QUICK_X = 153, QUICK_ICONS = [[7, 8], [42, 8], [77, 8], [112, 8], [7, 41], [42, 41], [77, 41], [112, 41]];
// how many quick slot panels show (0 none, 1, 2: a second panel of browser-kept keys stacked on the first),
// remembered between sessions; the button opens one more each click, and closes both after the second
const QUICK_KEY = 'maple.quickslot';
const MENU_ITEMS = {
  GameMenu: ['BtChannel', 'BtGameOpt', 'BtSysOpt', 'BtQuit'],             // "Change Skin" was never enabled
  ShortCut: ['BtItem', 'BtEquip', 'BtStat', 'BtSkill', 'BtQuest', 'BtComm', 'BtMobbook', 'BtRanking'],
};

export class StatusBar {
  constructor(game, layer) {
    this.game = game; this.assets = game.assets; this.layer = layer;
    this.y = 0; this.ox = 0; this.side = false; this.lines = []; this.menu = null; this.chatTarget = 'all'; this.targetMenu = false;
    this.mouse = { x: -1, y: -1 }; this.hovered = null; this.quick = [];
    this.quickLevel = (() => { try { const v = localStorage.getItem(QUICK_KEY); return v === '0' ? 0 : v === '2' ? 2 : 1; } catch { return 1; } })();
    // chat: 1 minimized, 2 minimized while typing, 3 open (chatH tall); the view's first line, when you last scrolled
    this.chatState = 1; this.chatH = CHAT_H.def; this.scrollPos = 0; this.scrolledAt = -Infinity;
    this.history = []; this.historyAt = 0; this.chatDrag = null; this.edgeHover = false; this.scrollHold = null; this.thumbDrag = null;
    // under the HP / MP alert, each drop plays one flash; flashes from quick hits overlap
    this.flashes = { hp: [], mp: [] }; this.alertMark = { hp: -1, mp: -1 };
    // HP / MP: the grey part slides to each new width over 700 ms (EXP jumps); clock in ms
    this.slides = {}; this.grayW = {}; this.clock = 0;
  }

  async load() {
    const a = this.assets;
    [this.S, this.B, this.W] = await Promise.all([a.json('UI/StatusBar.img'), a.json('UI/Basic.img'), a.json('UI/UIWindow.img')]);
    a.json('String/ToolTipHelp.img').then((t) => { this.btnHelp = t?.Game?.Button || null; }, () => {});
    const S = this.S, g = this.game;
    const y = () => this.y;
    // Cash Shop / Trade / Menu / Shortcut (the client's order), centred in backgrnd's grey band right of backgrnd2 (x 570-800, rows 35-70)
    const big = (node, i, fn) => this.btn(node, 577 + i * 54, () => y() + 36, fn);
    this.shopBtn = big(S.BtShop, 0, () => g.enterCashShop());
    this.menuBtn = big(S.BtMenu, 2, () => this.toggleMenu('GameMenu', this.menuBtn));
    this.shortBtn = big(S.BtShort, 3, () => this.toggleMenu('ShortCut', this.shortBtn));
    this.tradeBtn = big(S.BtNPT, 1, () => g.enterMTS());
    // hotkey tabs centred on the white band above (rows 3-29)
    const small = [
      [S.EquipKey, () => { this.blinks?.delete(0); g.windows.toggle('equip'); }], [S.InvenKey, () => { this.blinks?.delete(1); g.windows.toggle('inventory'); }],
      [S.StatKey, () => { this.blinks?.delete(2); g.windows.toggle('stat'); }], [S.SkillKey, () => { this.blinks?.delete(3); g.windows.toggle('skill'); }],
      [S.KeySet, () => g.windows.toggle('keyconfig')],
    ];
    // the hotkey tabs from x 614, every 30px (the client's own spacing), after the notice box
    this.tabs = small.map(([node, fn], i) => this.btn(node, TABS_X + i * 30, () => y() + 6, fn));
    this.quickBtn = this.btn(S.QuickSlot, TABS_X + 5 * 30, () => y() + 6, () => this.setQuickLevel(this.quickLevel + 1));
    this.quickBtnD = this.btn(S.QuickSlotD, TABS_X + 5 * 30, () => y() + 6, () => this.setQuickLevel(0));
    // "-" minimizes the log to one line, "+" opens it
    this.chatMinBtn = this.btn(this.B.BtMin, 536, () => y() + 12, () => this.setChatState(1));
    this.chatMaxBtn = this.btn(this.B.BtMax, 536, () => y() + 12, () => this.setChatState(3));

    this.chat = new TextField(this.layer, CHAT.x, 0, CHAT.w, CHAT.h, { max: 70, color: '#000' });
    this.chat.el.classList.add('chatinput');
    this.chat.show(false);
    this.chat.el.addEventListener('keydown', (e) => this.chatKey(e));
    a.preload([...stateFrames(this.B.VScr5), ...[1, 2, 7].flatMap((s) => Object.values(this.B.Cursor?.[s] || {}).filter((f) => f?._canvas))].filter(Boolean));

    const menuFrames = Object.entries(MENU_ITEMS).flatMap(([w, list]) => [this.W[w].backgrnd, ...list.flatMap((b) => stateFrames(this.W[w][b]))]);
    await a.preload([S.base.backgrnd, S.base.backgrnd2, S.base.chat, S.base.chatTarget, S.base.quickSlot, S.base.box, S.base.iconMemo,
      S.gauge.bar, S.gauge.graduation, S.gauge.gray, ...canvases(S.number), ...canvases(this.W.KeyConfig?.quickslotConfig?.key), ...canvases(this.B.LevelNo),
      ...new Anim(S.gauge.hpFlash).frames, ...new Anim(S.gauge.mpFlash).frames, ...this.allButtons().flatMap((b) => b.frames()), ...this.chatMaxBtn.frames(), ...menuFrames]);
    a.preload(['EquipKey', 'InvenKey', 'StatKey', 'SkillKey'].flatMap((k) => canvases(S[k]?.ani)));
    this.render();
  }

  /**
   * A hotkey tab blinking (its ani over it) for 90s or until it is clicked: the Stat tab on a level-up below 11. One
   * already blinking carries on.
   */
  blinkTab(i) { this.blinks ??= new Map(); if (!this.blinks.has(i)) this.blinks.set(i, performance.now()); }
  drawBlinks(ctx) {
    const now = performance.now(), keys = ['EquipKey', 'InvenKey', 'StatKey', 'SkillKey'];
    for (const [i, at] of this.blinks || []) {
      if (now - at >= 90000) { this.blinks.delete(i); continue; }
      const ani = this.S?.[keys[i]]?.ani, frames = Object.keys(ani || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b);
      if (!frames.length) continue;
      let t = (now - at) % frames.reduce((n, k) => n + (Number(ani[k].delay) || 100), 0), f = frames[0];
      for (const k of frames) { f = k; t -= Number(ani[k].delay) || 100; if (t < 0) break; }
      const im = this.assets.image(ani[f]), r = this.tabs[i]?.rect();
      if (im && r) ctx.drawImage(im, r.x, r.y);
    }
  }
  /** A button whose y follows the bar (the bar moves if the view is resized). */
  btn(node, x, y, onClick) {
    const b = new WzButton(node, x, 0, () => { sfx.play('UI/BtMouseClick'); onClick(); });
    b.yAt = y;
    return b;
  }

  allButtons() {
    const list = [this.shopBtn, this.menuBtn, this.shortBtn, this.tradeBtn, ...this.tabs,
      this.quickLevel < 2 ? this.quickBtn : this.quickBtnD, this.chatState === 3 ? this.chatMinBtn : this.chatMaxBtn];
    if (this.menu) list.push(...this.menu.buttons);
    return list.filter(Boolean);
  }

  /**
   * Wider than the bar, it is centred along the bottom (ox: its left edge) and the quick slots sit beside it on the
   * right, kept 2px in from the edge. Everything else here is in the bar's own space, x 0 at its left edge.
   */
  layout(viewW, viewH) {
    this.y = Math.ceil(viewH) - BAR_H;   // on a whole pixel; a fractional screen height runs off the bottom
    this.side = viewW >= BAR_W + 2 * QUICK_X - QUICK_W;
    const mid = (viewW - BAR_W) >> 1;
    this.ox = Math.floor(this.side ? Math.min(mid, viewW - BAR_W - 2 * QUICK_X + QUICK_W) : mid);
    if (this.chat?.rect) { this.chat.rect.x = this.ox + CHAT.x; this.chat.rect.y = this.y + CHAT.y; }
  }

  /** Lay the chat field over the canvas: box = the canvas' on-screen rect relative to the UI layer. */
  place(box, scale) { this.chat.rect.x = this.ox + CHAT.x; this.chat.rect.y = this.y + CHAT.y; this.chat.layout(box, scale); }

  /** Opens the input: minimized, the log's line moves up a row for it (state 2). */
  focusChat(prefix = '') {
    if (this.hidden) return;
    if (this.chatState === 1) this.setChatState(2);
    if (prefix && !this.chat.value) this.chat.value = prefix;
    this.chat.focus();
  }
  closeChat() {
    this.chat.el.blur();
    if (this.chatState === 2) this.setChatState(1);
  }
  /** Gone while a scene locks the UI. */
  setHidden(on) { this.hidden = on; this.showInput(); if (on) this.chat.el.blur(); }
  showInput() { this.chat?.show(!this.hidden && this.chatState !== 1); }
  get typing() { return document.activeElement === this.chat?.el; }

  // ------------------------------------------------------------------ chat log
  setChatState(s) {
    if (this.chatState === s) return;
    this.chatState = s;
    if (s === 1) this.chat.el.blur();
    this.showInput();
    this.toBottom();
    this.saveChat();
  }
  /** The chat key (keymap 16): open -> minimized, anything else -> open. */
  toggleChat() { if (this.chatState === 3) this.setChatState(1); else { this.chat.el.blur(); this.setChatState(3); } }
  /** The state and open height, per character. */
  saveChat() {
    const name = this.game.stats?.name;
    if (!name) return;
    try { localStorage.setItem(`maple.chat.${name}`, JSON.stringify({ state: this.chatState, h: this.chatH })); } catch { /* private mode */ }
  }
  restoreChat() {
    const name = this.game.stats?.name;
    if (!name || this.restoredFor === name) return;
    this.restoredFor = name;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`maple.chat.${name}`) || 'null'); } catch { saved = null; }
    const h = Number(saved?.h);
    this.chatH = h >= CHAT_H.min && h <= CHAT_H.max ? h : CHAT_H.def;
    this.chatState = saved?.state === 3 ? 3 : 1;
    this.showInput();
    this.toBottom();
  }
  clearLog() { this.lines = []; this.scrollPos = 0; }

  rows() { return this.chatState === 3 ? Math.floor(this.chatH / LINE_H) : 1; }
  range() { return Math.max(0, this.lines.length - this.rows() + 1); }
  toBottom() { this.scrollPos = Math.max(0, this.range() - 1); }
  scrollBy(n) {
    const max = Math.max(0, this.range() - 1);
    this.scrollPos = Math.max(0, Math.min(max, this.scrollPos + n));
    this.scrolledAt = performance.now();
  }

  /**
   * A chat log line, wrapped at 535px into stored lines (continuations indented five spaces, except the system
   * kinds). Megaphones add a coloured bar (bg); the world ones (tag: { channel, ear }) put the channel tag after the
   * sender on the first line. The view jumps to the newest line unless you scrolled up in the last 5 seconds.
   */
  message(text, color = '#fff', { bg = null, tag = null, item = null, flush = null } = {}) {
    const atBottom = this.scrollPos >= this.range() - 1;
    const indent = !(flush ?? FLUSH.has(String(color).toUpperCase()));
    const pieces = this.wrap(String(text), tag ? WRAP_MEGA : WRAP_W, WRAP_W);
    pieces.forEach((t, i) => this.lines.push({ text: i && indent ? `     ${t}` : t, color, bg, tag: i ? null : tag, item: i ? null : item }));
    let dropped = 0;
    while (this.lines.length > CHAT_MAX) { this.lines.shift(); dropped++; }
    if (this.range() < 3 || atBottom || performance.now() - this.scrolledAt > 5000) this.toBottom();
    else this.scrollPos = Math.max(0, this.scrollPos - dropped);
  }
  wrap(text, first, rest) {
    const ctx = (this.measure ??= document.createElement('canvas').getContext('2d'));
    ctx.font = '12px Arial, "Segoe UI", sans-serif';
    const out = [];
    let line = '', max = first;
    const push = () => { out.push(line.trim()); line = ''; max = rest; };
    for (const word of text.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width <= max) { line = t; continue; }
      if (line) push();
      for (const ch of word) {
        if (line && ctx.measureText(line + ch).width > max) push();
        line += ch;
      }
    }
    if (line.trim() || !out.length) push();
    return out;
  }

  /** Keys in the chat input. */
  chatKey(e) {
    e.stopPropagation();
    const g = this.game, empty = !this.chat.value.trim();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (empty) { this.chat.value = ''; this.closeChat(); return; }
      const t = this.chat.value.replace(/[^\x20-\x7e]/g, ' ').trim();
      this.chat.value = '';
      this.remember(t);
      if (this.canSay(t)) g.sendChat(t);
    } else if (e.key === 'Escape') { this.chat.value = ''; this.closeChat(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && empty) {
      // the arrows go back to moving you
      this.closeChat();
      const k = e.key === 'ArrowLeft' ? 'left' : 'right';
      g.input?.down.add(k); g.input?.pressed.add(k);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const n = this.history.length;
      if (!n) return;
      this.historyAt = Math.max(0, Math.min(n, this.historyAt + (e.key === 'ArrowUp' ? -1 : 1)));
      this.chat.value = this.history[this.historyAt] ?? '';
    } else if (e.key === 'Tab') { e.preventDefault(); this.nextTarget(); }
  }
  /** The last 8 lines sent, not twice in a row. */
  remember(t) {
    if (this.history[this.history.length - 1] !== t) this.history.push(t);
    if (this.history.length > 8) this.history.shift();
    this.historyAt = this.history.length;
  }
  /**
   * The client's chat checks: after a warning nothing goes for 2.8s; the same line 4 times in a row, or 4 lines in
   * 2 seconds, is stopped with a warning. Commands are not checked.
   */
  canSay(t) {
    if (t.startsWith('/') || t.startsWith('!')) return true;
    const now = performance.now();
    if (now - (this.spamAt ?? -Infinity) < 2800) return false;
    const recent = (this.recentChat ?? []).filter((r) => now - r.t < 30000);
    recent.push({ text: t, t: now });
    this.recentChat = recent.slice(-5);
    const last4 = this.recentChat.slice(-4);
    const warn = (msg) => { this.spamAt = now; this.recentChat = []; this.game.windows?.notice(msg); return false; };
    if (last4.length === 4 && last4.every((r) => r.text === t)) return warn('Repeating the same line over and over can negatively affect other users.');
    if (last4.length === 4 && now - last4[0].t < 2000) return warn("Too much chatting can disrupt other players' ability to play the game.");
    return true;
  }
  /** Tab: the next chat target in the list (Whisper only once someone has been chosen). */
  nextTarget() {
    const keys = CHAT_TARGETS.map((t) => t.key).filter((k) => k !== 'group' && (k !== 'whisper' || this.whisperTo));
    this.chatTarget = keys[(keys.indexOf(this.chatTarget) + 1) % keys.length];
  }
  /** A keymap chat key: the input opens with that target (Whisper asks who to). */
  openChat(target) {
    if (target === 'whisper') { this.chooseTarget('whisper'); return; }
    this.chatTarget = target;
    this.focusChat();
  }

  /** Where the log is drawn in each state: its band and the newest line's y. */
  logBox() {
    if (this.chatState === 3) return { top: this.y + 2 - this.chatH, h: this.chatH, line: this.y + 2 - LINE_H };
    if (this.chatState === 2) return { top: this.y - 21, h: 24, line: this.y - 15 };
    return { top: this.y + 6, h: 24, line: this.y + 12 };
  }
  /** The scrollbar: arrows at both ends of the open log, or the two arrows stacked in one row. */
  scrollBox() {
    if (this.chatState === 3) return { x: SCROLL_X, y: this.y + 3 - this.chatH, h: this.chatH - 2, track: true };
    return { x: SCROLL_X, y: this.chatState === 2 ? this.y - 21 : this.y + 6, h: 25, track: false };
  }
  thumbAt(sb) {
    const track = sb.h - 26 - 25, max = Math.max(1, this.range() - 1);
    return sb.y + 13 + Math.round(track * this.scrollPos / max);
  }
  /** Pointer on the log's scrollbar and top edge. Returns true when it took the event. */
  chatPointer(type, x, y) {
    const sb = this.scrollBox(), on = this.range() > 1;
    if (type === 'up') { this.scrollHold = null; this.thumbDrag = null; if (this.chatDrag) { this.chatDrag = null; this.saveChat(); return true; } return false; }
    if (type === 'move') {
      if (this.chatDrag) {
        const d = this.chatDrag.y - y;
        if (Math.abs(d) >= 14) {
          let h = Math.max(CHAT_H.min, Math.min(CHAT_H.max, this.chatDrag.h + Math.trunc(d / LINE_H) * LINE_H));
          if (h % LINE_H === 0) h += 2;
          if (h !== this.chatH) { this.chatH = h; this.toBottom(); }
        }
        return true;
      }
      if (this.thumbDrag) {
        const track = sb.h - 26 - 25, max = Math.max(0, this.range() - 1);
        this.scrollPos = Math.max(0, Math.min(max, Math.round(((y - this.thumbDrag.dy - sb.y - 13) / Math.max(1, track)) * max)));
        this.scrolledAt = performance.now();
        return true;
      }
      this.edgeHover = this.chatState === 3 && x < CHAT_W && Math.abs(y - this.logBox().top) <= 5;
      return false;
    }
    if (type !== 'down') return false;
    if (this.edgeHover) { this.chatDrag = { y, h: this.chatH }; return true; }
    // a megaphone line's channel tag with the ear: whisper to its sender
    const hit = (this.tagHits || []).find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
    if (hit) { this.whisperTo = hit.name; this.chooseTarget('whisper'); return true; }
    if (x < sb.x || x >= sb.x + 15 || y < sb.y || y >= sb.y + sb.h) return false;
    if (!on) return true;
    const step = (n) => { this.scrollBy(n); this.scrollHold = { n, t: 0.4 }; };
    if (!sb.track) { step(y < sb.y + 12 ? -1 : 1); return true; }
    if (y < sb.y + 13) step(-1);
    else if (y >= sb.y + sb.h - 13) step(1);
    else if (sb.h >= 52) {
      const ty = this.thumbAt(sb);
      if (y >= ty && y < ty + 25) this.thumbDrag = { dy: y - ty };
      else this.scrollBy(y < ty ? -this.rows() : this.rows());
    }
    return true;
  }
  /** The mouse wheel over the log: one line a notch. */
  wheel(x, y, dy) {
    x -= this.ox;
    const b = this.logBox();
    if (this.hidden || this.inMenu(x, y) || x >= CHAT_W || y < b.top || y >= b.top + b.h || !dy) return false;
    this.scrollBy(Math.sign(dy));
    return true;
  }

  // ------------------------------------------------------------------ menus
  toggleMenu(name, from) {
    if (this.menu?.name === name) { this.menu = null; return; }
    const W = this.W[name], bg = W.backgrnd;
    // the frame's pointer (bottom centre) touches the top of the button that opened it
    const x = Math.round(from.x + 27 - bg._w / 2), y = this.y + 36 - bg._h;
    const inner = name === 'GameMenu' ? 5 : 4;
    const buttons = MENU_ITEMS[name].map((b, i) => new WzButton(W[b], x + inner + 1, y + 23 + i * 26, () => {
      sfx.play('UI/BtMouseClick'); this.menu = null; this.menuAction(b);
    }));
    this.menu = { name, x, y, bg, buttons };
    sfx.play(name === 'GameMenu' ? 'UI/DlgNotice' : 'UI/MenuUp');
  }

  menuAction(b) {
    const g = this.game;
    switch (b) {
      case 'BtItem': g.windows.toggle('inventory'); break;
      case 'BtEquip': g.windows.toggle('equip'); break;
      case 'BtStat': g.windows.toggle('stat'); break;
      case 'BtSkill': g.windows.toggle('skill'); break;
      case 'BtQuest': g.windows.toggle('quest'); break;
      case 'BtChannel': g.windows.toggle('channel'); break;
      case 'BtComm': g.windows.toggle('userlist'); break;
      case 'BtGameOpt': g.windows.toggle('gameopt'); break;
      case 'BtSysOpt': g.windows.toggle('sysopt'); break;
      case 'BtQuit': g.windows.confirm('Are you sure you want to quit the game?').then((ok) => { if (ok) g.leave(); }); break;
      default: g.notice('This feature is not available yet.');
    }
  }

  // ------------------------------------------------------------------ quick slots
  /** Rebuild the quick slot icons from the keymap (called whenever the keymap or skills change). */
  async render() {
    const g = this.game;
    this.quick = await Promise.all(this.quickKeys.map(async (sc) => {
      const k = g.keymap?.[sc];
      if (!k) return null;
      // skills, items and macros by their own icons; menus, actions and faces by the key setting's
      const node = k.type === 1 ? g.skills?.icon(k.action) : k.type === 8 ? this.W.SkillMacro?.Macroicon?.[k.action]?.icon
        : [2, 3, 7].includes(k.type) ? await itemIcon(this.assets, k.action) : this.W.KeyConfig?.icon?.[k.action];
      if (node) await this.assets.preload([node]);
      return { node, skill: k.type === 1 ? k.action : 0, item: k.type === 2 ? k.action : 0 };
    }));
  }

  /** A status bar button's ToolTipHelp key, or null (the trade and shortcut buttons and the hotkey tabs have none). */
  helpKey(b) {
    if (b === this.shopBtn) return 'Shop';
    if (b === this.menuBtn) return 'Menu';
    if (b === this.tabs?.[4]) return 'KeySet';
    if (b === this.quickBtn) return 'QuickSlot';
    if (b === this.quickBtnD) return 'QuickSlotD';
    return null;
  }
  /** The tooltip for the quick slot under the mouse: the item's, or the skill's. */
  quickTip(x, y) {
    x -= this.ox;
    // the buttons' hints (String/ToolTipHelp.img/Game/Button): Cash Shop, Menu, Key Config., Show / Hide Quick Slot
    const bt = this.allButtons().find((b) => !this.menu?.buttons.includes(b) && b.hit(x, y));
    const help = bt && this.btnHelp?.[this.helpKey(bt)];
    if (help) return helpTip(help.Title || '', help.Desc || '');
    // an Item Megaphone line in the log: its item
    const line = (this.itemHits || []).find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
    if (line) return { item: line.item };
    const i = this.quickAt(x, y), k = i >= 0 ? this.game.keymap?.[this.quickKeys[i]] : null, g = this.game, above = this.quickPos(this.quickLevel - 1).y - 2;
    if (!k) return null;
    if ([2, 3, 7].includes(k.type)) {
      for (const tab of [2, 3, 4, 5]) for (const it of Object.values(g.inventory?.[tab] || {})) if (it?.id === k.action) return { item: it, above };
      return { item: { id: k.action }, above };
    }
    return k.type === 1 && g.skills ? { skill: k.action, above } : null;
  }

  setQuickLevel(n) {
    this.quickLevel = n > 2 ? 0 : n;
    try { localStorage.setItem(QUICK_KEY, String(this.quickLevel)); } catch { /* ignore */ }
    if (this.quickLevel) this.render();
  }
  get quickOpen() { return this.quickLevel > 0; }

  /** The quick slots' keys, the first panel's then the second's; right Shift's bindings are left Shift's. */
  get quickKeys() {
    return [...(this.game.quickKeys || DEFAULT_QUICKSLOTS), ...(this.game.quickKeys2 || DEFAULT_QUICKSLOTS2)].map((sc) => (sc === 54 ? 42 : sc));
  }

  /**
   * A panel's top-left corner: the first right above the bar's right end, or beside the bar on the bottom edge;
   * the second stacked on top of it.
   */
  quickPos(panel = 0) {
    const p = this.side ? { x: BAR_W + QUICK_X - QUICK_W, y: this.y + BAR_H - 80 } : { x: BAR_W - QUICK_X, y: this.y - 80 };
    p.y -= 80 * panel;
    return p;
  }
  /** Slot i's 32x32 icon box (slots 8-15 are the second panel's). */
  slotBox(i) { const p = this.quickPos(i >> 3), [ix, iy] = QUICK_ICONS[i & 7]; return { x: p.x + ix, y: p.y + iy }; }
  slotAt(x, y) {
    for (let i = 0; i < 8 * this.quickLevel; i++) { const b = this.slotBox(i); if (x >= b.x && x < b.x + 32 && y >= b.y && y < b.y + 32) return i; }
    return -1;
  }

  /** A skill, or a Use item, dropped from a window onto a quick slot binds it to that key. */
  dropOnQuickSlot(x, y, c) {
    x -= this.ox;
    if (!this.quickOpen || this.inMenu(x, y)) return;
    const i = this.slotAt(x, y);
    if (i < 0) return;
    const sc = this.quickKeys[i];
    if (c.kind === 'skill') this.game.bindKey(sc, 1, c.id);
    else if (c.kind === 'item' && itemKeyType(c.tab, c.id)) this.game.bindKey(sc, itemKeyType(c.tab, c.id), c.id);
    else if (c.kind === 'bind') this.game.bindKey(sc, c.b.type, c.b.action);   // a macro, or a slot moved to another
    else return false;
    this.render();
    return true;
  }
  /** The slot under (x, y), or -1. */
  quickAt(x, y) {
    if (!this.quickOpen || this.hidden || this.inMenu(x, y)) return -1;
    return this.slotAt(x, y);
  }
  /** Pick a slot's binding up: dropped on another slot it moves there, dropped off the bar it is taken off the key. */
  pickQuick(x, y) {
    const i = this.quickAt(x, y), sc = this.quickKeys[i], k = i >= 0 ? this.game.keymap?.[sc] : null, node = this.quick[i]?.node;
    if (!k || !node || this.game.windows.carry) return false;
    const bar = this;
    this.game.windows.startCarry({ kind: 'bind', b: { ...k }, fromQuick: sc, x: x + this.ox, y, at: performance.now(),
      source: { dropOutside: () => bar.game.unbindKey?.(sc) } }, node);
    return true;
  }

  // ------------------------------------------------------------------ input
  /** Canvas-space pointer events from Game. Returns true when the UI took the event. */
  pointer(type, x, y) {
    x -= this.ox;
    this.mouse = { x, y };
    // an open pop-up menu sits on top: what's under it doesn't take the mouse
    const onMenu = this.inMenu(x, y);
    if (onMenu && type !== 'up' && !this.chatDrag && !this.thumbDrag) this.edgeHover = false;   // 'up' still ends a drag
    else if (!this.hidden && this.chatPointer(type, x, y)) return true;
    if (type === 'down' && this.pickQuick(x, y)) return true;
    // the EXP gauge (441, 559)-(556, 574): charges the EXP stored from Writs of Solomon
    if (type === 'down' && x >= 441 && x < 556 && y >= 559 && y < 574 && this.game.chargeGachaExp?.()) return true;
    const buttons = this.allButtons();
    for (const b of buttons) b.y = b.yAt ? b.yAt() : b.y;
    const over = (onMenu ? this.menu.buttons : buttons).find((b) => b.hit(x, y)) || null;
    for (const b of buttons) b.hover = b === over;
    if (over && over !== this.hovered) sfx.play('UI/BtMouseOver');
    this.hovered = over;
    if (type === 'down') { for (const b of buttons) b.down = b === over; }
    // the chat target: the box opens the drop-up list, a row picks, anywhere else closes it
    if (type === 'down' && this.targetMenu) {
      const row = this.targetRowAt(x, y);
      this.targetMenu = false;
      if (row >= 0) { this.chooseTarget(CHAT_TARGETS[row].key); return true; }
      if (this.targetHit(x, y)) { sfx.play('UI/BtMouseClick'); return true; }
    } else if (type === 'down' && !over && this.targetHit(x, y)) { this.targetMenu = true; sfx.play('UI/BtMouseClick'); return true; }
    if (type === 'up') {
      const target = buttons.find((b) => b.down && b === over);
      for (const b of buttons) b.down = false;
      target?.onClick();
    }
    const inside = this.hit(x, y);
    if (type === 'down' && this.menu && !inside) this.menu = null;   // clicking elsewhere closes a menu
    return inside;
  }

  /** The chat target box ("To All") at the start of the white strip. */
  targetHit(x, y) { return this.chatState !== 1 && x >= 1 && x < 82 && y >= this.y + 8 && y < this.y + 28; }
  targetMenuTop() { return this.y + 8 - CHAT_TARGETS.length * TMENU.row - 2; }
  targetRowAt(x, y) {
    const top = this.targetMenuTop() + 1;
    if (x < TMENU.x || x >= TMENU.x + TMENU.w || y < top || y >= top + CHAT_TARGETS.length * TMENU.row) return -1;
    return Math.floor((y - top) / TMENU.row);
  }
  /** A target from the list; Whisper first asks who to (keeping the old target if you cancel). */
  async chooseTarget(key) {
    sfx.play('UI/BtMouseClick');
    if (key === 'whisper') {
      const w = this.game.windows, name = (await w.askWhisper(this.whisperTo || '', this.whisperNames || []))?.trim();
      if (!name) return;
      // a name holding a word from Etc/ForbiddenName.img is refused
      const bad = Object.values((await this.assets.json('Etc/ForbiddenName.img')) || {}).map((v) => String(v).toLowerCase());
      if (bad.some((b) => b && name.toLowerCase().includes(b))) { w.notice('Incorrect ID.'); return; }
      if (name.toLowerCase() === this.game.player?.name?.toLowerCase()) { w.notice("You can't whisper to yourself."); return; }
      this.whisperTo = name;
      this.whisperNames = [name, ...(this.whisperNames || []).filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 10);
    }
    this.chatTarget = key;
    this.focusChat();
  }
  drawTargetMenu(ctx) {
    const top = this.targetMenuTop(), h = CHAT_TARGETS.length * TMENU.row + 2, hover = this.targetRowAt(this.mouse?.x ?? -1, this.mouse?.y ?? -1);
    ctx.save();
    ctx.fillStyle = TMENU.border; ctx.fillRect(TMENU.x - 1, top - 1, TMENU.w + 2, h + 2);
    ctx.fillStyle = TMENU.inner; ctx.fillRect(TMENU.x, top, TMENU.w, h);
    ctx.fillStyle = TMENU.bg; ctx.fillRect(TMENU.x + 1, top + 1, TMENU.w - 2, h - 2);
    CHAT_TARGETS.forEach((t, i) => {
      const ry = top + 1 + i * TMENU.row;
      if (i === hover || (hover < 0 && t.key === this.chatTarget)) { ctx.fillStyle = TMENU.lit; ctx.fillRect(TMENU.x + 1, ry, TMENU.w - 2, TMENU.row); }
      uiText(ctx, t.label, TMENU.x + 7, ry + 3, { color: '#fff', size: 12 });
    });
    ctx.restore();
  }

  inMenu(x, y) {
    const m = this.menu;
    return !!m && x >= m.x && x < m.x + m.bg._w && y >= m.y && y < m.y + m.bg._h;
  }

  contains(x, y) { return this.hit(x - this.ox, y); }
  hit(x, y) {
    if (y >= this.y && x >= 0 && x < BAR_W) return true;
    // the open log (and the line over the bar while typing) takes clicks; above it they reach the map
    if (this.chatState !== 1 && !this.hidden && x >= 80 && x < CHAT_W && y >= this.logBox().top) return true;
    if (this.targetMenu && x < TMENU.x + TMENU.w + 1 && y >= this.targetMenuTop() - 1) return true;
    if (this.menu && x >= this.menu.x && x < this.menu.x + this.menu.bg._w && y >= this.menu.y) return true;
    const q = this.quickPos(this.quickLevel - 1);
    if (this.quickOpen && x >= q.x && x < (this.side ? q.x + QUICK_W : BAR_W) && y >= q.y) return true;
    return false;
  }

  get hoveringButton() { return !!this.hovered; }

  // ------------------------------------------------------------------ frame
  update(dt) {
    this.clock += dt * 1000;
    this.trackGauges();
    for (const k of ['hp', 'mp']) {
      if (!this.flashes[k].length) continue;
      for (const a of this.flashes[k]) a.update(dt * 1000);
      this.flashes[k] = this.flashes[k].filter((a) => !a.done);
    }
    if (this.scrollHold && (this.scrollHold.t -= dt) <= 0) { this.scrollBy(this.scrollHold.n); this.scrollHold.t = 0.06; }
    for (const b of this.allButtons()) { b.y = b.yAt ? b.yAt() : b.y; b.update(dt * 1000); }
  }

  draw(ctx) {
    const s = this.game.stats, S = this.S;
    if (!s || !S) return;
    const img = (n) => this.assets.image(n);
    const y = this.y;
    this.restoreChat();
    ctx.save(); ctx.translate(this.ox, 0);
    if (this.chatState !== 1) this.drawChatLog(ctx);
    const bg = img(S.base.backgrnd), bg2 = img(S.base.backgrnd2);
    if (bg) ctx.drawImage(bg, 0, y);
    if (bg2) ctx.drawImage(bg2, 0, y);

    // chat target box ("All") at the start of the white strip; minimized, the newest line sits there instead
    if (this.chatState === 1) this.drawChatLog(ctx);
    else {
      const tgt = img(S.base.chatTarget);
      // whispering: the box shows who to
      const label = this.chatTarget === 'whisper' && this.whisperTo ? this.whisperTo : CHAT_TARGETS.find((t) => t.key === this.chatTarget)?.label || 'To All';
      if (tgt) { ctx.drawImage(tgt, 1, y + 8); uiText(ctx, label, 5, y + 13, { color: '#fff', size: 11 }); }
    }
    // the notice box and its pencil, where invitations come from
    const box = img(S.base.box), memo = img(S.base.iconMemo);
    if (box) ctx.drawImage(box, NOTICE_BOX.x, y + NOTICE_BOX.y);
    if (memo) ctx.drawImage(memo, NOTICE_ICON.x, y + NOTICE_ICON.y);

    // LV. is part of backgrnd2 (x 10-29, rows 47-59); the digits sit in the plate's dark slot on the same rows.
    // the level from x 50, 6px further left for each extra digit; the job, then the name, at x 87
    this.digits(ctx, String(s.level), s.level < 10 ? 50 : s.level < 100 ? 44 : 38, y + 47);
    uiText(ctx, jobName(s.job), 87, y + 39, { color: '#fff', size: 12 });
    uiText(ctx, s.name, 87, y + 53, { color: '#fff', size: 12 });

    // gauges: the bar art is drawn full, then the empty part of each fill is greyed out
    const gx = GAUGE.x, gy = y + GAUGE.y;
    const bar = img(S.gauge.bar), gray = img(S.gauge.gray), grad = img(S.gauge.graduation);
    if (bar) ctx.drawImage(bar, gx, gy);
    const need = EXP[s.level] || 1;
    const maxHp = this.game.maxHpShown(), maxMp = this.game.maxMpShown();
    const grayW = { hp: this.grayW.hp ?? 0, mp: this.grayW.mp ?? 0, exp: FILLS.exp.w - Math.round(FILLS.exp.w * ratio(s.exp, need)) };
    for (const [k, f] of Object.entries(FILLS)) {
      const w = Math.max(0, Math.min(f.w, grayW[k]));
      if (gray && w > 0) ctx.drawImage(gray, gx + f.x + f.w - w, gy + FILL_Y, w, FILL_H);
    }
    // the low-HP / low-MP warning flash covers the whole gauge
    for (const a of this.flashes.hp) this.flash(ctx, a, gx, gy + 13);
    for (const a of this.flashes.mp) this.flash(ctx, a, gx + 108, gy + 13);
    if (grad) ctx.drawImage(grad, gx, gy);
    // [cur/max] sits in the label row beside "HP" / "MP", left-aligned, as the client draws it
    this.number(ctx, `[${s.hp}/${maxHp}]`, gx + 21, gy + 4, 'left');
    this.number(ctx, `[${s.mp}/${maxMp}]`, gx + 133, gy + 4, 'left');
    this.number(ctx, `${s.exp}[${((s.exp / need) * 100).toFixed(2)}%]`, gx + 250, gy + 4, 'left');

    for (const b of this.allButtons()) if (!this.menu?.buttons.includes(b)) b.draw(ctx, this.assets);
    this.drawBlinks(ctx);
    if (this.quickOpen) this.drawQuickSlots(ctx);
    if (this.targetMenu) this.drawTargetMenu(ctx);
    if (this.menu) {
      const m = this.menu, mbg = img(m.bg);
      if (mbg) ctx.drawImage(mbg, m.x, m.y);
      for (const b of m.buttons) b.draw(ctx, this.assets);
    }
    ctx.restore();
    this.syncCursor();
  }

  /**
   * The log on its see-through band: open, its lines above the bar; minimized, the line the view is on inside the
   * input row (or one row up while typing). Megaphone lines get their bar from x 0 to the scrollbar.
   */
  drawChatLog(ctx) {
    const b = this.logBox(), rows = this.rows();
    const shown = this.lines.slice(this.scrollPos, this.scrollPos + rows);
    this.tagHits = []; this.itemHits = [];
    ctx.save();
    ctx.fillStyle = BAND;
    ctx.fillRect(0, b.top, BAND_W, b.h);
    // the resize edge, only while the mouse is on it
    const edge = this.assets.image(this.S.base.chat);
    if (edge && this.chatState === 3 && (this.edgeHover || this.chatDrag)) ctx.drawImage(edge, 0, b.top - 5);
    ctx.beginPath(); ctx.rect(0, b.top, BAND_W, b.h); ctx.clip();
    shown.forEach((l, i) => {
      const y = b.line - (shown.length - 1 - i) * LINE_H;
      // minimized, the one line's colour fills the whole row
      if (l.bg) { ctx.fillStyle = l.bg; if (rows === 1) ctx.fillRect(0, b.top, SCROLL_X, b.h); else ctx.fillRect(0, y, SCROLL_X, LINE_H); }
      if (l.tag) this.drawTagged(ctx, l, y);
      else uiText(ctx, l.text, 3, y, { color: l.color, size: 12 });
    });
    ctx.restore();
    this.drawChatScroll(ctx);
  }
  /**
   * A world megaphone's first line: the sender (up to the first ':') at x 3, then right after the name the channel
   * tag (UIWindow.img/Megaphone/ch0, with the whisper ear, or ch1 without) with the channel's two digits (Num) in
   * it, then the rest from the sender's width + 39.
   */
  drawTagged(ctx, l, y) {
    const M = this.game.windows.W.Megaphone, im = (n) => this.assets.image(n), cut = l.text.indexOf(':');
    const who = cut >= 0 ? l.text.slice(0, cut).trimEnd() : l.text, rest = cut >= 0 ? l.text.slice(cut) : '';
    uiText(ctx, who, 3, y, { color: l.color, size: 12 });
    ctx.font = '12px Arial, sans-serif';
    const p = 3 + Math.ceil(ctx.measureText(who).width), tag = im(M?.[l.tag.ear ? 'ch0' : 'ch1']), ch = l.tag.channel || 0;
    if (tag) {
      ctx.drawImage(tag, p + 1, y + 1);
      // the sender's own name is the last word before the ':' (a medal may lead it)
      if (l.tag.ear) this.tagHits.push({ x: p + 1, y: y + 1, w: tag.width, h: tag.height, name: who.trim().split(/\s+/).pop() });
    }
    const d1 = im(M?.Num?.[Math.floor(ch / 10) % 10]), d2 = im(M?.Num?.[ch % 10]);
    if (d1) ctx.drawImage(d1, p + 15, y + 5);
    if (d2) ctx.drawImage(d2, p + 20, y + 5);
    // an Item Megaphone's item goes in brackets right after the ':' (its name looked up as it's drawn, so it is there once loaded)
    const shown = l.item ? `: [${this.game.windows.itemName(l.item.id) || ''}]${rest.replace(/^:\s*/, '')}` : rest;
    if (shown) uiText(ctx, shown, p + 36, y, { color: l.color, size: 12 });
    if (l.item) this.itemHits.push({ x: 0, y, w: SCROLL_X, h: LINE_H, item: l.item });
  }
  /** VScr5: disabled while everything fits; the thumb only on an open log 52px or taller. */
  drawChatScroll(ctx) {
    const V = this.B.VScr5, sb = this.scrollBox(), on = this.range() > 1, S = on ? V.enabled : V.disabled;
    const im = (n) => this.assets.image(n), held = this.scrollHold?.n;
    const prev = im(on ? (held < 0 ? S.prev1 : S.prev0) : S.prev), next = im(on ? (held > 0 ? S.next1 : S.next0) : S.next);
    if (!sb.track) {
      if (prev) ctx.drawImage(prev, sb.x, sb.y);
      if (next) ctx.drawImage(next, sb.x, sb.y + 12);
      return;
    }
    const base = im(S.base);
    if (base) ctx.drawImage(base, sb.x, sb.y + 13, 15, Math.max(0, sb.h - 26));
    if (prev) ctx.drawImage(prev, sb.x, sb.y);
    if (next) ctx.drawImage(next, sb.x, sb.y + sb.h - 13);
    if (on && sb.h >= 52) {
      const thumb = im(this.thumbDrag ? S.thumb1 : S.thumb0);
      if (thumb) ctx.drawImage(thumb, sb.x, this.thumbAt(sb));
    }
  }

  drawQuickSlots(ctx) {
    const S = this.S, base = this.assets.image(S.base.quickSlot);
    for (let n = 0; n < this.quickLevel; n++) { const p = this.quickPos(n); if (base) ctx.drawImage(base, p.x, p.y); }
    const labels = this.W.KeyConfig?.quickslotConfig?.key;
    this.quickKeys.slice(0, 8 * this.quickLevel).forEach((sc, i) => {
      const q = this.quick[i], icon = q?.node && this.assets.image(q.node), { x: ix, y: iy } = this.slotBox(i);
      if (icon) {
        // the icon sits in its 32x32 box by its origin; a Use item's count is at the box's bottom-left, as in the inventory
        const o = q.node.origin || [0, 32];
        ctx.drawImage(icon, ix - o[0], iy + 32 - o[1]);
        if (q.item) this.game.windows.count(ctx, this.game.itemCount(q.item), ix, iy + 21);
        // a skill cooling down: UIWindow.img/Skill/CoolTime, 16 steps whose dark cover clears from the top
        const sk = this.game.skills, left = q.skill ? sk?.cooldownLeft(q.skill) : 0, total = sk?.cooldownTotal?.[q.skill];
        if (left > 0 && total > 0) {
          const step = Math.max(0, Math.min(15, Math.floor((total - left) / (total / 16))));
          const cool = this.game.windows.W.Skill?.CoolTime?.[step], cim = cool && this.assets.image(cool);
          if (cim) ctx.drawImage(cim, ix, iy); else if (cool) this.assets.preload([cool]);
        }
      }
      const label = this.assets.image(labels?.[sc]);
      if (label) ctx.drawImage(label, ix + 2, iy + 2);
    });
  }

  /**
   * The client's own cursor (Basic.img/Cursor), animated through its frames by their delays: 7 dragging the chat,
   * 1 over a button; otherwise what is under it on the field (1 an NPC, 2 another player, as v83's field picks it).
   */
  syncCursor() {
    let want = this.chatDrag || this.edgeHover ? 7 : this.hovered ? 1 : 0;
    if (!want) want = this.game.fieldCursor?.(this.mouse.x + this.ox, this.mouse.y) || 0;
    const now = performance.now();
    if (want !== this.cursorState) { this.cursorState = want; this.cursorFrame = 0; this.cursorAt = now; this.cursorShown = null; }
    const node = this.B.Cursor[want] || this.B.Cursor[0];
    const frames = Object.keys(node).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
    if (frames.length > 1) {
      const delay = Number(node[frames[this.cursorFrame]]?.delay) || 100;
      if (now - this.cursorAt >= delay) { this.cursorFrame = (this.cursorFrame + 1) % frames.length; this.cursorAt = now; }
    }
    const n = node[frames[this.cursorFrame] ?? 0] || this.B.Cursor[0][0];
    if (n === this.cursorShown) return;
    this.cursorShown = n;
    const o = n.origin || [0, 0];
    this.game.canvas.style.cursor = `url(${this.assets.base}/${n._canvas}) ${o[0]} ${o[1]}, auto`;
  }

  /** HP / MP gauge slides and alert flashes follow the stats every frame, even while a scene hides the bar. */
  trackGauges() {
    const s = this.game.stats;
    if (!s || !this.S) return;
    for (const [k, m] of [['hp', this.game.maxHpShown()], ['mp', this.game.maxMpShown()]]) {
      const cur = s[k] || 0, max = Math.max(1, m || 1);
      this.grayW[k] = this.slide(k, FILLS[k].w - Math.floor((FILLS[k].w * cur) / max));
      this.checkAlert(k, cur, max);
    }
  }

  /**
   * The grey width shown for a gauge sliding to `to`: a new target stops the old slide where it is (whole pixels)
   * and slides from there over 700 ms. The first value is shown at once.
   */
  slide(k, to) {
    let sl = this.slides[k];
    const at = (o) => o.from + ((o.to - o.from) * Math.min(1, (this.clock - o.t0) / 700));
    if (!sl) sl = this.slides[k] = { from: to, to, t0: this.clock };
    else if (sl.to !== to) this.slides[k] = sl = { from: Math.trunc(at(sl)), to, t0: this.clock };
    return Math.trunc(at(sl));
  }

  /**
   * System Option HP / MP ALERT (0 = never): under the alert, every drop below the last value seen plays a flash.
   * The mark starts at -1, so being low already when the bar first sees the stats doesn't flash.
   */
  checkAlert(k, cur, max) {
    const alert = Math.round((settings[`${k}Alert`] || 0) * 100);
    if (!alert || alert <= Math.floor((cur * 100) / max)) { this.alertMark[k] = Math.floor((alert * max) / 100); return; }
    if (cur < this.alertMark[k]) this.flashes[k].push(new Anim(this.S.gauge[`${k}Flash`], false));
    this.alertMark[k] = cur;
  }

  flash(ctx, anim, x, y) {
    const im = this.assets.image(anim.node);
    if (im) ctx.drawImage(im, x, y);
  }

  /** Basic.img/LevelNo digits (11x13). */
  digits(ctx, text, x, y) {
    for (const ch of text) {
      const im = this.assets.image(this.B.LevelNo[ch]);
      if (im) ctx.drawImage(im, x, y);
      x += 11;
    }
  }

  /** StatusBar.img/number glyphs, centred on cx; digits sit on row y, brackets one row higher. */
  number(ctx, text, cx, y, align = 'center') {
    const N = this.S.number;
    const glyph = (ch) => (ch === '[' ? N.Lbracket : ch === ']' ? N.Rbracket : ch === '/' ? N.slash : ch === '%' ? N.percent : N[ch]);
    const width = (ch) => (ch === '.' ? 2 : (glyph(ch)?._w ?? 5) + 1);
    let x = align === 'left' ? Math.round(cx) : Math.round(cx - [...text].reduce((w, ch) => w + width(ch), 0) / 2);
    for (const ch of text) {
      if (ch === '.') {
        // the set has no decimal point: a 1px dot in the digits' colour, on their baseline
        ctx.fillStyle = '#fff'; ctx.fillRect(x, y + 6, 1, 1);
      } else {
        const n = glyph(ch), im = n && this.assets.image(n);
        if (im) ctx.drawImage(im, x, ch === '[' || ch === ']' ? y - 1 : y);
      }
      x += width(ch);
    }
  }
}

function ratio(v, max) { return Math.max(0, Math.min(1, (v || 0) / Math.max(1, max || 1))); }

/** Every canvas directly under a node (one level), e.g. a font's glyphs. */
function canvases(node) { return Object.values(node || {}).filter(isCanvas); }

/** Frames of a button's states, for preloading. */
function stateFrames(node) { return Object.values(node || {}).flatMap((st) => (isCanvas(st) ? [st] : Object.values(st || {}).filter(isCanvas))); }
