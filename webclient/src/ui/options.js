import { music, sfx } from '../audio.js';
import { Win, allCanvases } from './windows.js';

/**
 * Game Menu windows from UI/UIWindow.img: Change Channel, Game Option, System Option.
 * Positions are measured from each background (see each class).
 */

// ==================================================================== Change Channel
/**
 * Channel: 436 wide; t (67) = title y 3-20 and the blue world bar y 27-53 (x 8-427, where world/<id>
 * sits), c (10, tiled) = the white list, s (36) = the grey button band (rows 7-29).
 * Channel cells are channel0 (68x20) with the ch/<n> label; channel1 marks the chosen one and
 * channel2 the channel you are on. 5 columns from x 24, every 80px; rows every 26px from y 62.
 */
const COLS = 5, CELL_X = 24, CELL_DX = 80, CELL_Y = 62, CELL_DY = 26;
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
    this.tiles = Math.max(2, Math.ceil((CELL_Y - 67 + rows * CELL_DY + 4) / 10));
    this.w = 436; this.h = 67 + this.tiles * 10 + 36;
    this.x = Math.round((800 - this.w) / 2); this.y = Math.round((529 - this.h) / 2);
    const by = this.h - 36 + 9;
    this.cancel.x = 436 - 16 - 47; this.cancel.y = by;
    this.change.x = this.cancel.x - 6 - 91; this.change.y = by;
    this.change.enabled = this.pick !== this.g.channel;
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
    if (world) ctx.drawImage(world, 16, 30 + Math.round((20 - world.height) / 2));
    for (let i = 0; i < this.count; i++) {
      const x = CELL_X + (i % COLS) * CELL_DX, y = CELL_Y + Math.floor(i / COLS) * CELL_DY;
      const bg = im(i === this.g.channel ? C.channel2 : i === this.pick ? C.channel1 : C.channel0);
      if (bg) ctx.drawImage(bg, x, y);
      const label = im(C.ch?.[i]);
      if (label) ctx.drawImage(label, x + 24, y + 5);
    }
  }
  down(lx, ly) {
    const i = this.cellAt(lx, ly);
    if (i >= 0) { this.pick = i; this.change.enabled = i !== this.g.channel; }
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
    this.closeBtn.x = this.w - 38;
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
 * SysOpt backgrnd 299x366: label boxes x 9-60, rows - PICTURE QUALITY y 31-59, BGM y 63-89,
 * SOUND y 94-116 - each with SOFT (x 70) .. LOUD (x 213), a divider at x 238 and MUTE (x 261).
 * The volume sliders (Basic.img/Slider) run between SOFT and LOUD; the mute boxes sit before MUTE.
 */
const SLIDE = { x0: 92, x1: 208 };
const ROWS = { bgm: 76, sound: 105 };
export class SysOptWin extends Win {
  constructor(mgr) {
    super(mgr, mgr.W.SysOpt.backgrnd, 250, 60);
    this.drag = null;
  }
  frames() { return [...super.frames(), ...allCanvases(this.mgr.B.Slider), ...allCanvases(this.mgr.B.CheckBox)]; }
  vol(k) { return k === 'bgm' ? music.volume : sfx.volume; }
  setVol(k, v) { if (k === 'bgm') music.setVolume(v); else sfx.setVolume(v); }
  muted(k) { return k === 'bgm' ? music.muted : sfx.muted; }
  body(ctx) {
    const S = this.mgr.B.Slider, im = (n) => this.mgr.image(n);
    const l = im(S.left), mid = im(S.mid), r = im(S.right), thumb = im(S.thumbNormal);
    for (const [k, cy] of Object.entries(ROWS)) {
      if (l && mid && r) {
        const y = cy - 4;
        ctx.drawImage(l, SLIDE.x0, y); ctx.drawImage(mid, SLIDE.x0 + 3, y, SLIDE.x1 - SLIDE.x0 - 6, 8); ctx.drawImage(r, SLIDE.x1 - 3, y);
      }
      const tx = Math.round(SLIDE.x0 + this.vol(k) * (SLIDE.x1 - SLIDE.x0) - 11);
      const t = this.muted(k) ? im(S.thumbDisabled) || thumb : this.drag === k ? im(S.thumbPressed) || thumb : thumb;
      if (t) ctx.drawImage(t, tx, cy - 7);
      const box = im(this.mgr.B.CheckBox[this.muted(k) ? 1 : 0]);
      if (box) ctx.drawImage(box, 246, cy - 6);
    }
  }
  slideTo(k, lx) { this.setVol(k, Math.max(0, Math.min(1, (lx - SLIDE.x0) / (SLIDE.x1 - SLIDE.x0)))); }
  down(lx, ly) {
    for (const [k, cy] of Object.entries(ROWS)) {
      if (Math.abs(ly - cy) > 8) continue;
      if (lx >= 244 && lx < 260) { if (k === 'bgm') music.setMuted(!music.muted); else sfx.setMuted(!sfx.muted); return; }
      if (lx >= SLIDE.x0 - 12 && lx <= SLIDE.x1 + 12) { this.drag = k; this.slideTo(k, lx); return; }
    }
  }
  move(lx) { if (this.drag) this.slideTo(this.drag, lx); }
  up() { if (this.drag === 'sound') sfx.play('UI/BtMouseClick'); this.drag = null; } // a sample at the new effect volume
}
