import { isCanvas } from '../assets.js';
import { Anim } from '../map.js';
import { EXP, jobName, itemIcon } from '../data.js';
import { sfx } from '../audio.js';
import { WzButton, TextField, uiText } from './wzui.js';
import { settings } from '../settings.js';

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
const CHAT_TARGETS = ['All', 'Buddy', 'Party', 'Guild', 'Alliance'];
const GAUGE = { x: 216, y: 37 };
const FILLS = { hp: { x: 2, w: 105 }, mp: { x: 110, w: 105 }, exp: { x: 223, w: 115 } };
const FILL_Y = 15, FILL_H = 14;
const CHAT = { x: 84, y: 9, w: 430, h: 18 };          // text field in the white strip, after the target box
const CHAT_W = 566, CHAT_LINES = 6, LINE_H = 14;       // log above the bar, as wide as base/chat
// quick slot keys: Shift Ins Home PgUp / Ctrl Del End PgDn (scancodes), labelled by StatusBar.img/key/0-7
const QUICK_KEYS = [42, 82, 71, 73, 29, 83, 79, 81];
const MENU_ITEMS = {
  GameMenu: ['BtChannel', 'BtGameOpt', 'BtSysOpt', 'BtQuit'],             // "Change Skin" was never enabled
  ShortCut: ['BtItem', 'BtEquip', 'BtStat', 'BtSkill', 'BtQuest', 'BtComm', 'BtMobbook', 'BtRanking'],
};

export class StatusBar {
  constructor(game, layer) {
    this.game = game; this.assets = game.assets; this.layer = layer;
    this.y = 0; this.lines = []; this.menu = null; this.quickOpen = false; this.chatTarget = 0;
    this.mouse = { x: -1, y: -1 }; this.hovered = null; this.quick = [];
  }

  async load() {
    const a = this.assets;
    [this.S, this.B, this.W] = await Promise.all([a.json('UI/StatusBar.img'), a.json('UI/Basic.img'), a.json('UI/UIWindow.img')]);
    const S = this.S, g = this.game;
    // the low HP / MP warning flashes once each time the gauge drops under 20%, not on a loop
    this.hpFlash = new Anim(S.gauge.hpFlash, false); this.mpFlash = new Anim(S.gauge.mpFlash, false);
    this.hpFlash.done = this.mpFlash.done = true;
    const y = () => this.y;
    // Cash Shop / Trade / Menu / Shortcut (the client's order), centred in backgrnd's grey band right of backgrnd2 (x 570-800, rows 35-70)
    const big = (node, i, fn) => this.btn(node, 577 + i * 54, () => y() + 36, fn);
    this.shopBtn = big(S.BtShop, 0, () => g.enterCashShop());
    this.menuBtn = big(S.BtMenu, 2, () => this.toggleMenu('GameMenu', this.menuBtn));
    this.shortBtn = big(S.BtShort, 3, () => this.toggleMenu('ShortCut', this.shortBtn));
    this.tradeBtn = big(S.BtNPT, 1, () => g.notice('The Maple Trading System is not available on this server.'));
    // hotkey tabs centred on the white band above (rows 3-29)
    const small = [
      [S.EquipKey, () => g.windows.toggle('equip')], [S.InvenKey, () => g.windows.toggle('inventory')],
      [S.StatKey, () => g.windows.toggle('stat')], [S.SkillKey, () => g.windows.toggle('skill')],
      [S.KeySet, () => g.windows.toggle('keyconfig')],
    ];
    this.tabs = small.map(([node, fn], i) => this.btn(node, 599 + i * 29, () => y() + 6, fn));
    this.quickBtn = this.btn(S.QuickSlot, 599 + 5 * 29, () => y() + 6, () => { this.quickOpen = !this.quickOpen; this.render(); });
    this.quickBtnD = this.btn(S.QuickSlotD, 599 + 5 * 29, () => y() + 6, () => { this.quickOpen = false; });
    // chat line extras at the end of the white strip
    this.whisperBtn = this.btn(S.BtWhisper, 518, () => y() + 9, () => this.focusChat('/w '));
    this.claimBtn = this.btn(S.BtClaim, 534, () => y() + 9, () => g.notice('To report a player, please contact a GM.'));

    this.chat = new TextField(this.layer, CHAT.x, 0, CHAT.w, CHAT.h, { max: 70, color: '#000' });
    this.chat.el.classList.add('chatinput');
    this.chat.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chat.value.trim();
        if (t) g.sendChat(t);
        this.chat.value = ''; this.chat.el.blur();
      } else if (e.key === 'Escape') this.chat.el.blur();
    });

    const menuFrames = Object.entries(MENU_ITEMS).flatMap(([w, list]) => [this.W[w].backgrnd, ...list.flatMap((b) => stateFrames(this.W[w][b]))]);
    await a.preload([S.base.backgrnd, S.base.backgrnd2, S.base.chat, S.base.chatTarget, S.base.quickSlot,
      S.gauge.bar, S.gauge.graduation, S.gauge.gray, ...canvases(S.number), ...canvases(S.key), ...canvases(this.B.LevelNo),
      ...this.hpFlash.frames, ...this.mpFlash.frames, ...this.allButtons().flatMap((b) => b.frames()), ...menuFrames]);
    this.render();
  }

  /** A button whose y follows the bar (the bar moves if the view is resized). */
  btn(node, x, y, onClick) {
    const b = new WzButton(node, x, 0, () => { sfx.play('UI/BtMouseClick'); onClick(); });
    b.yAt = y;
    return b;
  }

  allButtons() {
    const list = [this.shopBtn, this.menuBtn, this.shortBtn, this.tradeBtn, ...this.tabs,
      this.quickOpen ? this.quickBtnD : this.quickBtn, this.whisperBtn, this.claimBtn];
    if (this.menu) list.push(...this.menu.buttons);
    return list.filter(Boolean);
  }

  layout(viewW, viewH) {
    this.y = viewH - BAR_H; this.w = viewW;
    this.chat?.rect && (this.chat.rect.y = this.y + CHAT.y);
  }

  /** Lay the chat field over the canvas: box = the canvas' on-screen rect relative to the UI layer. */
  place(box, scale) { this.chat.rect.y = this.y + CHAT.y; this.chat.layout(box, scale); }

  focusChat(prefix = '') { if (prefix && !this.chat.value) this.chat.value = prefix; this.chat.focus(); }
  get typing() { return document.activeElement === this.chat?.el; }

  // ------------------------------------------------------------------ chat log
  message(text, color = '#fff') {
    this.lines.push({ text: String(text), color });
    if (this.lines.length > 80) this.lines.shift();
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
      case 'BtComm': g.windows.toggle('userlist', 0); break;
      case 'BtGameOpt': g.windows.toggle('gameopt'); break;
      case 'BtSysOpt': g.windows.toggle('sysopt'); break;
      case 'BtQuit': g.windows.confirm('Are you sure you want to quit the game?').then((ok) => { if (ok) location.reload(); }); break;
      default: g.notice('This feature is not available yet.');
    }
  }

  // ------------------------------------------------------------------ quick slots
  /** Rebuild the quick slot icons from the keymap (called whenever the keymap or skills change). */
  async render() {
    const g = this.game;
    this.quick = await Promise.all(QUICK_KEYS.map(async (sc) => {
      const k = g.keymap?.[sc];
      if (!k || (k.type !== 1 && k.type !== 2)) return null;
      const node = k.type === 1 ? g.skills?.icon(k.action) : await itemIcon(this.assets, k.action);
      if (node) await this.assets.preload([node]);
      return { node, skill: k.type === 1 ? k.action : 0, item: k.type === 2 ? k.action : 0 };
    }));
  }

  /** A skill, or a Use item, dropped from a window onto a quick slot binds it to that key. */
  dropOnQuickSlot(x, y, c) {
    if (!this.quickOpen) return;
    const x0 = this.w - 151, y0 = this.y - 80;
    const col = Math.floor((x - x0 - 9) / 35), row = Math.floor((y - y0 - 9) / 34);
    if (col < 0 || col > 3 || row < 0 || row > 1) return;
    const sc = QUICK_KEYS[row * 4 + col];
    if (c.kind === 'skill') this.game.bindKey(sc, 1, c.id);
    else if (c.kind === 'item' && c.tab === 2) this.game.bindKey(sc, 2, c.id);
    else return;
    sfx.play('UI/DragEnd');
    this.render();
  }

  // ------------------------------------------------------------------ input
  /** Canvas-space pointer events from Game. Returns true when the UI took the event. */
  pointer(type, x, y) {
    this.mouse = { x, y };
    const buttons = this.allButtons();
    for (const b of buttons) b.y = b.yAt ? b.yAt() : b.y;
    const over = buttons.find((b) => b.hit(x, y)) || null;
    for (const b of buttons) b.hover = b === over;
    if (over && over !== this.hovered) sfx.play('UI/BtMouseOver');
    this.hovered = over;
    if (type === 'down') { for (const b of buttons) b.down = b === over; }
    if (type === 'down' && !over && this.targetHit(x, y)) { this.chatTarget = (this.chatTarget + 1) % CHAT_TARGETS.length; sfx.play('UI/BtMouseClick'); }
    if (type === 'up') {
      const target = buttons.find((b) => b.down && b === over);
      for (const b of buttons) b.down = false;
      target?.onClick();
    }
    const inside = this.contains(x, y);
    if (type === 'down' && this.menu && !inside) this.menu = null;   // clicking elsewhere closes a menu
    return inside;
  }

  /** Clicking the chat target box steps through All / Buddy / Party / Guild / Alliance. */
  targetHit(x, y) { return x >= 1 && x < 82 && y >= this.y + 8 && y < this.y + 28; }

  contains(x, y) {
    if (y >= this.y) return true;
    if (this.menu && x >= this.menu.x && x < this.menu.x + this.menu.bg._w && y >= this.menu.y) return true;
    if (this.quickOpen && x >= this.w - 151 && y >= this.y - 80) return true;
    return false;
  }

  get hoveringButton() { return !!this.hovered; }

  // ------------------------------------------------------------------ frame
  update(dt) {
    this.hpFlash.update(dt * 1000); this.mpFlash.update(dt * 1000);
    for (const b of this.allButtons()) { b.y = b.yAt ? b.yAt() : b.y; b.update(dt * 1000); }
  }

  draw(ctx) {
    const s = this.game.stats, S = this.S;
    if (!s || !S) return;
    const img = (n) => this.assets.image(n);
    const y = this.y;
    this.drawChatLog(ctx);
    const bg = img(S.base.backgrnd), bg2 = img(S.base.backgrnd2);
    if (bg) ctx.drawImage(bg, 0, y);
    if (bg2) ctx.drawImage(bg2, 0, y);

    // chat target box ("All") at the start of the white strip
    const tgt = img(S.base.chatTarget);
    if (tgt) { ctx.drawImage(tgt, 1, y + 8); uiText(ctx, CHAT_TARGETS[this.chatTarget], 1 + 40, y + 11, { color: '#fff', size: 11, align: 'center' }); }

    // LV. is part of backgrnd2 (x 10-29, rows 47-59); the digits follow it on the same rows.
    // Name and job sit in the panel right of the LV plate (plate ends at x 77)
    this.digits(ctx, String(s.level), 32, y + 47);
    uiText(ctx, s.name, 82, y + 39, { color: '#fff', size: 12 });
    uiText(ctx, jobName(s.job), 82, y + 53, { color: '#c8c8c8', size: 11 });

    // gauges: the bar art is drawn full, then the empty part of each fill is greyed out
    const gx = GAUGE.x, gy = y + GAUGE.y;
    const bar = img(S.gauge.bar), gray = img(S.gauge.gray), grad = img(S.gauge.graduation);
    if (bar) ctx.drawImage(bar, gx, gy);
    const need = EXP[s.level] || 1;
    const maxHp = this.game.maxHpShown(), maxMp = this.game.maxMpShown();
    const part = { hp: ratio(s.hp, maxHp), mp: ratio(s.mp, maxMp), exp: ratio(s.exp, need) };
    for (const [k, f] of Object.entries(FILLS)) {
      const full = Math.round(f.w * part[k]);
      if (gray && full < f.w) ctx.drawImage(gray, gx + f.x + full, gy + FILL_Y, f.w - full, FILL_H);
    }
    // the low-HP / low-MP warning flash covers the whole gauge
    // System Option HP / MP ALERT: flash below the chosen share (0 = never)
    const lowHp = part.hp < settings.hpAlert, lowMp = part.mp < settings.mpAlert;
    if (lowHp && !this.lowHp) this.hpFlash.reset();
    if (lowMp && !this.lowMp) this.mpFlash.reset();
    this.lowHp = lowHp; this.lowMp = lowMp;
    if (!this.hpFlash.done) this.flash(ctx, this.hpFlash, gx, gy + 13);
    if (!this.mpFlash.done) this.flash(ctx, this.mpFlash, gx + 108, gy + 13);
    if (grad) ctx.drawImage(grad, gx, gy);
    // [cur/max] sits in the label row beside "HP" / "MP", left-aligned, as the client draws it
    this.number(ctx, `[${s.hp}/${maxHp}]`, gx + 21, gy + 4, 'left');
    this.number(ctx, `[${s.mp}/${maxMp}]`, gx + 133, gy + 4, 'left');
    this.number(ctx, `${s.exp}[${((s.exp / need) * 100).toFixed(2)}%]`, gx + 250, gy + 4, 'left');

    for (const b of this.allButtons()) if (!this.menu?.buttons.includes(b)) b.draw(ctx, this.assets);
    if (this.quickOpen) this.drawQuickSlots(ctx);
    if (this.menu) {
      const m = this.menu, mbg = img(m.bg);
      if (mbg) ctx.drawImage(mbg, m.x, m.y);
      for (const b of m.buttons) b.draw(ctx, this.assets);
    }
    this.syncCursor();
  }

  drawChatLog(ctx) {
    const shown = this.lines.slice(-CHAT_LINES);
    if (!shown.length && !this.typing) return;
    const h = CHAT_LINES * LINE_H + 6, top = this.y - h;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, top, CHAT_W, h);
    const edge = this.assets.image(this.S.base.chat);
    if (edge) ctx.drawImage(edge, 0, top - edge.height);
    shown.forEach((l, i) => uiText(ctx, l.text, 4, top + 3 + (CHAT_LINES - shown.length + i) * LINE_H,
      { color: l.color, size: 12, outline: 'rgba(0,0,0,0.8)' }));
    ctx.restore();
  }

  drawQuickSlots(ctx) {
    const S = this.S, base = this.assets.image(S.base.quickSlot);
    const x0 = this.w - 151, y0 = this.y - 80;
    if (base) ctx.drawImage(base, x0, y0);
    QUICK_KEYS.forEach((sc, i) => {
      const cx = x0 + 9 + (i % 4) * 35, cy = y0 + 9 + Math.floor(i / 4) * 34;
      const q = this.quick[i], icon = q?.node && this.assets.image(q.node);
      if (icon) {
        // the 32x32 icon box is centred on the 28x25 cell; the icon sits in it by its origin
        const o = q.node.origin || [0, 32];
        ctx.drawImage(icon, cx + 14 - 16 - o[0], cy + 12 - 16 + 32 - o[1]);
        if (q.item) this.number(ctx, String(this.game.itemCount(q.item)), cx + 22, cy + 17);
        const left = q.skill ? this.game.skills?.cooling(q.skill) : 0;
        if (left > 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(cx, cy, 28, 25);
          this.number(ctx, String(Math.ceil(left / 1000)), cx + 14, cy + 9);
        }
      }
      const label = this.assets.image(S.key[i]);
      if (label) ctx.drawImage(label, cx, cy);
    });
  }

  /** The client's own cursor (Basic.img/Cursor): 0 normally, 1 over something clickable. */
  syncCursor() {
    const want = this.hovered ? 1 : 0;
    if (want === this.cursorState) return;
    this.cursorState = want;
    const n = want ? this.B.Cursor[1][0] : this.B.Cursor[0][0];
    const o = n.origin || [0, 0];
    this.game.canvas.style.cursor = `url(${this.assets.base}/${n._canvas}) ${o[0]} ${o[1]}, auto`;
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
