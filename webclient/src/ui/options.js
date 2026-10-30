import { music, sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';
import { settings, saveSettings, MOB_INFO } from '../settings.js';

/**
 * Game Menu windows from UI/UIWindow.img: Change Channel, Game Option, System Option.
 * Positions are measured from each background (see each class).
 */

// ==================================================================== Change Channel
/**
 * Channel: 436 wide; t (67) = title y 3-20 and the blue world bar y 27-53 (x 8-427, where world/<id>
 * sits), c (10, tiled) = the white list, s (36) = the grey button band (rows 7-29).
 * Channel cells are channel0 (68x20) with the ch/<n> label; channel1 marks the chosen one and
 * channel2 the channel you are on. 6 columns from x 6, every 71px; rows every 22px from y 65; each label 8px in.
 */
// measured from the original window: six 68x20 channels a row, 3px apart, 6px in from the left, rows 2px apart
const COLS = 6, CELL_X = 6, CELL_DX = 71, CELL_Y = 65, CELL_DY = 22;
export class ChannelWin extends Win {
  constructor(mgr) {
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.C = mgr.W.Channel; this.pick = 0;
    this.change = this.button(this.C.BtChange, 0, 0, () => this.go());
    this.cancel = this.button(this.C.BtCancel, 0, 0, () => mgr.close(this));
  }
  frames() { return [...allCanvases(this.C), ...this.buttons.flatMap((b) => b.frames())]; }
  get count() { return Math.max(1, this.g.channelCount || 1); }
  onOpen() {
    this.pick = this.g.channel ?? 0;
    const rows = Math.ceil(this.count / COLS);
    // the middle piece (10px) repeats down to the last row's bottom; two rows make the original's 143px window
    this.tiles = Math.max(2, Math.ceil((CELL_Y + rows * CELL_DY - 2 - 67) / 10));
    this.w = 436; this.h = 67 + this.tiles * 10 + 36;
    this.x = Math.round((800 - this.w) / 2); this.y = Math.round((529 - this.h) / 2);
    const by = this.h - 36 + 9;
    this.cancel.x = 436 - 16 - 47; this.cancel.y = by;
    this.change.x = this.cancel.x - 6 - 91; this.change.y = by;
  }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); else if (e.key === 'Enter') this.go(); }
  go() {
    if (this.pick === this.g.channel) return;
    this.mgr.close(this);
    this.g.switchChannel(this.pick);
  }
  cellAt(lx, ly) {
    const c = Math.floor((lx - CELL_X) / CELL_DX), r = Math.floor((ly - CELL_Y) / CELL_DY);
    if (c < 0 || c >= COLS || r < 0 || (lx - CELL_X) % CELL_DX >= 68 || (ly - CELL_Y) % CELL_DY >= 20) return -1;
    const i = r * COLS + c;
    return i < this.count ? i : -1;
  }
  body(ctx) {
    const C = this.C, m = this.mgr, im = (n) => m.image(n);
    const t = im(C.t), c = im(C.c), s = im(C.s);
    if (!t || !c || !s) return;
    ctx.drawImage(t, 0, 0);
    for (let i = 0; i < this.tiles; i++) ctx.drawImage(c, 0, 67 + i * 10);
    ctx.drawImage(s, 0, this.h - 36);
    const world = im(C.world?.[this.g.worldId ?? 0]);
    if (world) ctx.drawImage(world, 13, 30 + Math.round((20 - world.height) / 2));
    for (let i = 0; i < this.count; i++) {
      const x = CELL_X + (i % COLS) * CELL_DX, y = CELL_Y + Math.floor(i / COLS) * CELL_DY;
      const bg = im(i === this.g.channel ? C.channel2 : i === this.pick ? C.channel1 : C.channel0);
      if (bg) ctx.drawImage(bg, x, y);
      const label = im(C.ch?.[i]);
      if (label) ctx.drawImage(label, x + 8, y + 5);   // left in the cell, past the selected one's arrow
    }
  }
  down(lx, ly) {
    const i = this.cellAt(lx, ly);
    if (i >= 0) this.pick = i;   // CHANGE CHANNEL stays lit, as in the client; on your own channel it does nothing
  }
  dblclick(lx, ly) { const i = this.cellAt(lx, ly); if (i >= 0) { this.pick = i; this.go(); } }
}

// ==================================================================== Game Option
/**
 * GameOpt backgrnd 158x284: 12 rows (WHISPER .. FAMILY INVITE) whose ALLOW column is x 88-150,
 * row centres every 18.2px from y 40. Each row gets a Basic.img/CheckBox at its right end.
 * The choices are kept in this browser; they take effect as those features are added.
 */
const GAME_ROWS = ['whisper', 'friends', 'chatInvite', 'tradeRequest', 'partyInvite', 'partySearch', 'gameInvite',
  'guildChat', 'guildInvite', 'allianceTournament', 'allianceInvite', 'familyInvite'];
export class GameOptWin extends Win {
  constructor(mgr) {
    super(mgr, mgr.W.GameOpt.backgrnd, 470, 70);
    try { this.allow = JSON.parse(localStorage.getItem('maple.gameopt') || '{}'); } catch { this.allow = {}; }
  }
  frames() { return [...super.frames(), ...allCanvases(this.mgr.B.CheckBox)]; }
  rowAt(lx, ly) {
    if (lx < 88 || lx > 156) return -1;
    const i = Math.round((ly - 40) / 18.2);
    return i >= 0 && i < GAME_ROWS.length && Math.abs(ly - (40 + i * 18.2)) < 8 ? i : -1;
  }
  body(ctx) {
    GAME_ROWS.forEach((k, i) => {
      const box = this.mgr.image(this.mgr.B.CheckBox[this.allow[k] === false ? 0 : 1]);
      if (box) ctx.drawImage(box, 138, Math.round(40 + i * 18.2 - 6));
    });
  }
  down(lx, ly) {
    const i = this.rowAt(lx, ly);
    if (i < 0) return;
    const k = GAME_ROWS[i];
    this.allow[k] = this.allow[k] === false;
    try { localStorage.setItem('maple.gameopt', JSON.stringify(this.allow)); } catch { /* storage off */ }
  }
}

// ==================================================================== System Option
/**
 * SysOpt backgrnd 299x366: ten rows every 30px, centres from y 46, each with its label box at x 9-60:
 *   PICTURE QUALITY  slider NORMAL .. BEST          SCREEN SHOT   where pictures go (ScrLk / PrtSc take one)
 *   BGM / SOUND      slider SOFT .. LOUD, MUTE box  MOUSE CURSOR  slider (the browser keeps the pointer's speed)
 *   HP / MP ALERT    slider DO NOT ALERT .. 100%    SHAKE UP      check box
 *   MONSTER INFO     combo box                      VIEWING MODE  WINDOW / FULL SCREEN check boxes
 * Controls are Basic.img Slider / CheckBox / ComboBox; OK and CANCEL sit in the band under the rows.
 * Changes apply as you make them; CANCEL puts back what was there when the window opened.
 */
const ROW_Y = (i) => 46 + i * 30;
const SLIDERS = {
  quality: { row: 0, x0: 104, x1: 238 }, bgm: { row: 1, x0: 92, x1: 208 }, sound: { row: 2, x0: 92, x1: 208 },
  mouse: { row: 4, x0: 96, x1: 238, disabled: true }, hpAlert: { row: 5, x0: 100, x1: 244 }, mpAlert: { row: 6, x0: 100, x1: 244 },
};
const MUTE_X = 246, COMBO = { x: 66, w: 172 }, CHECK_X = 64, VIEW_X = 61;   // WINDOW / FULL SCREEN start further left
const SHOT_PLACES = ['Downloads Folder'];
export class SysOptWin extends Win {
  constructor(mgr) {
    super(mgr, mgr.W.SysOpt.backgrnd, 250, 60);
    this.drag = null; this.open = null; this.hover = -1;
    const K = mgr.W.KeyConfig;
    this.button(K.BtOK, 299 - 112, 366 - 30, () => mgr.close(this));
    this.button(K.BtCancel, 299 - 60, 366 - 30, () => { this.revert(); mgr.close(this); });
    // ScrLk (as the art says) or PrtSc saves a picture of the game
    addEventListener('keyup', (e) => { if (e.code === 'ScrollLock' || e.code === 'PrintScreen') screenshot(this.g); });
  }
  frames() {
    const B = this.mgr.B;
    return [...super.frames(), ...allCanvases(B.Slider), ...allCanvases(B.CheckBox), ...allCanvases(B.ComboBox)];
  }
  onOpen() {
    this.before = { ...settings, bgm: music.volume, sound: sfx.volume, bgmMute: music.muted, soundMute: sfx.muted };
    this.open = null;
  }
  revert() {
    const b = this.before;
    if (!b) return;
    for (const k of Object.keys(settings)) settings[k] = b[k];
    saveSettings();
    music.setVolume(b.bgm); sfx.setVolume(b.sound);
    if (music.muted !== b.bgmMute) music.setMuted(b.bgmMute);
    if (sfx.muted !== b.soundMute) sfx.setMuted(b.soundMute);
  }
  key(e) { if (e.key === 'Escape') { if (this.open) this.open = null; else { this.revert(); this.mgr.close(this); } } }

  // ---------------------------------------------------------------- values
  value(k) {
    if (k === 'bgm') return music.volume;
    if (k === 'sound') return sfx.volume;
    if (k === 'mouse') return 0.5;
    return settings[k];
  }
  setValue(k, v) {
    if (k === 'bgm') music.setVolume(v);
    else if (k === 'sound') sfx.setVolume(v);
    else { settings[k] = k === 'quality' ? v : Math.round(v * 20) / 20; saveSettings(); }
  }
  muted(k) { return k === 'bgm' ? music.muted : k === 'sound' ? sfx.muted : false; }
  combos() {
    return [{ row: 3, items: SHOT_PLACES, value: 0, set: () => {} },
      { row: 8, items: MOB_INFO, value: settings.mobInfo, set: (i) => { settings.mobInfo = i; saveSettings(); } }];
  }

  // ---------------------------------------------------------------- frame
  body(ctx) {
    const B = this.mgr.B, im = (n) => this.mgr.image(n), S = B.Slider;
    const l = im(S.left), mid = im(S.mid), r = im(S.right);
    for (const [k, d] of Object.entries(SLIDERS)) {
      const cy = ROW_Y(d.row);
      if (l && mid && r) {
        ctx.drawImage(l, d.x0, cy - 4); ctx.drawImage(mid, d.x0 + 3, cy - 4, d.x1 - d.x0 - 6, 8); ctx.drawImage(r, d.x1 - 3, cy - 4);
      }
      const off = d.disabled || this.muted(k);
      const t = im(off ? S.thumbDisabled : this.drag === k ? S.thumbPressed : S.thumbNormal) || im(S.thumbNormal);
      if (t) ctx.drawImage(t, Math.round(d.x0 + this.value(k) * (d.x1 - d.x0) - 11), cy - 7);
      if (k === 'bgm' || k === 'sound') this.check(ctx, MUTE_X, cy, this.muted(k));
    }
    this.check(ctx, CHECK_X, ROW_Y(7), settings.shake);
    const full = !!document.fullscreenElement;
    this.check(ctx, VIEW_X, ROW_Y(9) - 7, !full);
    this.check(ctx, VIEW_X, ROW_Y(9) + 7, full);
    for (const c of this.combos()) this.combo(ctx, c, ROW_Y(c.row) - 8);
    if (this.open) this.list(ctx);
  }
  /** Where the open list starts: under its box, or above it when it would run into the OK / CANCEL band. */
  listTop(c) {
    const h = c.items.length * 17 + 2, below = ROW_Y(c.row) + 9;
    return below + h > 366 - 32 ? ROW_Y(c.row) - 9 - h : below;
  }
  list(ctx) {
    const c = this.open, y0 = this.listTop(c);
    ctx.fillStyle = '#fff'; ctx.fillRect(COMBO.x, y0, COMBO.w, c.items.length * 17 + 2);
    ctx.strokeStyle = '#7f8c99'; ctx.strokeRect(COMBO.x + 0.5, y0 + 0.5, COMBO.w - 1, c.items.length * 17 + 1);
    c.items.forEach((t, i) => {
      if (i === this.hover) { ctx.fillStyle = '#c8daf5'; ctx.fillRect(COMBO.x + 1, y0 + 1 + i * 17, COMBO.w - 2, 17); }
      this.text(ctx, t, COMBO.x + COMBO.w / 2, y0 + 4 + i * 17, { align: 'center', size: 12 });
    });
  }
  check(ctx, x, cy, on) { const b = this.mgr.image(this.mgr.B.CheckBox[on ? 1 : 0]); if (b) ctx.drawImage(b, x, cy - 6); }
  /** ComboBox: 0 = left cap, 1 = the middle (stretched), 2 = the right end with the arrow. */
  combo(ctx, c, y) {
    const C = this.mgr.B.ComboBox, im = (n) => this.mgr.image(n), st = C[this.open === c ? 'pressed' : 'normal'] || C.normal;
    const a = im(st[0]), b = im(st[1]), e = im(st[2]);
    if (a && b && e) { ctx.drawImage(a, COMBO.x, y); ctx.drawImage(b, COMBO.x + a.width, y, COMBO.w - a.width - e.width, 17); ctx.drawImage(e, COMBO.x + COMBO.w - e.width, y); }
    this.text(ctx, c.items[c.value] ?? '', COMBO.x + (COMBO.w - 18) / 2, y + 3, { align: 'center', size: 12 });
  }

  // ---------------------------------------------------------------- mouse
  listAt(lx, ly) {
    const c = this.open;
    if (!c || lx < COMBO.x || lx >= COMBO.x + COMBO.w) return -1;
    const i = Math.floor((ly - this.listTop(c) - 1) / 17);
    return i >= 0 && i < c.items.length ? i : -1;
  }
  slideTo(k, lx) { const d = SLIDERS[k]; this.setValue(k, Math.max(0, Math.min(1, (lx - d.x0) / (d.x1 - d.x0)))); }
  down(lx, ly) {
    if (this.open) {
      const i = this.listAt(lx, ly), c = this.open;
      this.open = null;
      if (i >= 0) { c.set(i); sfx.play('UI/BtMouseClick'); }
      return;
    }
    for (const c of this.combos()) {
      if (lx >= COMBO.x && lx < COMBO.x + COMBO.w && Math.abs(ly - ROW_Y(c.row)) <= 9) { this.open = c; this.hover = c.value; sfx.play('UI/BtMouseClick'); return; }
    }
    const row = Math.round((ly - 46) / 30), cy = ROW_Y(row);
    if (row === 7 && lx >= CHECK_X - 2 && lx < 290 && Math.abs(ly - cy) <= 8) { settings.shake = !settings.shake; saveSettings(); return; }
    if (row === 9 && lx >= VIEW_X - 2 && lx < 290) {
      const full = ly > cy;
      if (full && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (!full && document.fullscreenElement) document.exitFullscreen?.();
      return;
    }
    for (const [k, d] of Object.entries(SLIDERS)) {
      if (row !== d.row || Math.abs(ly - cy) > 8 || d.disabled) continue;
      if ((k === 'bgm' || k === 'sound') && lx >= MUTE_X - 2 && lx < 290) { if (k === 'bgm') music.setMuted(!music.muted); else sfx.setMuted(!sfx.muted); return; }
      if (lx >= d.x0 - 12 && lx <= d.x1 + 12) { this.drag = k; this.slideTo(k, lx); return; }
    }
  }
  move(lx, ly) { if (this.drag) this.slideTo(this.drag, lx); else if (this.open) this.hover = this.listAt(lx, ly); }
  up() { if (this.drag === 'sound') sfx.play('UI/BtMouseClick'); this.drag = null; } // a sample at the new effect volume
}

/** A PNG of the game as it is on screen, saved like the client's own screenshots (MapleYYYYMMDD_HHMMSS). */
export function screenshot(game) {
  const c = game?.canvas;
  if (!c) return;
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const name = `Maple${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
  c.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    game.hud?.message?.(`Screenshot saved as ${name}`, '#fff');
  });
}
