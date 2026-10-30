import { itemName } from '../data.js';
import { mapPath } from '../map.js';
import { uiText } from './wzui.js';

const GAIN_LIFE = 5, GAIN_FADE = 1, GAIN_MAX = 7, GAIN_LINE = 16, BANNER_SPEED = 70;

const NOTICE_COLORS = { 0: '#ffe08a', 1: '#ffe08a', 5: '#ff9ed6', 6: '#9fd3ff', group: '#ffb36b', exp: '#fff', meso: '#fff', item: '#fff', fame: '#fff' };

/** In-game HTML interface layered over the canvas. */
export class Hud {
  constructor(root, game) {
    this.game = game; this.assets = game.assets;
    // level, name, job and the HP / MP / EXP gauges are drawn on the canvas by StatusBar
    // chat log and input belong to the canvas status bar; the map name is on the minimap
    addEventListener('keydown', (e) => {
      if (document.activeElement instanceof HTMLInputElement || document.querySelector('.modal-overlay')) return;
      // window hotkeys (I, S, K, Q, M...) come from the server keymap via Game.handleHotkeys
      if (e.key === 'Enter') { e.preventDefault(); game.statusBar?.focusChat(); }
      else if (e.key === 'Escape') this.closeWindows();
    });
  }

  update() {}

  // ------------------------------------------------------------------ on-screen notices (drawn on the canvas)
  /**
   * What you gain (items, mesos, EXP, fame) is told in the lower-right corner, as the v83 client does: white
   * lines (bonus EXP yellow) stacking up from just above the status bar, each fading out after a few seconds.
   */
  gain(text, color = '#fff') {
    (this.gains ??= []).push({ text, color, t: performance.now() });
    if (this.gains.length > GAIN_MAX) this.gains.shift();
  }
  /** The server's scrolling notice (type 4): it runs across a dark strip at the top until replaced or emptied. */
  banner(text) { this.slide = text ? { text, t: performance.now() } : null; }
  drawBanner(ctx) {
    const now = performance.now();
    if (this.slide) {
      ctx.save();
      ctx.font = '12px Arial, sans-serif';
      const w = ctx.measureText(this.slide.text).width, run = 800 + w + 40;
      const x = 800 - (((now - this.slide.t) / 1000) * BANNER_SPEED) % run;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'; ctx.fillRect(0, 0, 800, 18);
      uiText(ctx, this.slide.text, x, 3, { color: '#ffff7e', size: 12 });
      ctx.restore();
    }
  }
  draw(ctx) {
    const now = performance.now(), bar = this.game.statusBar;
    if (this.gains?.length) {
      this.gains = this.gains.filter((g) => now - g.t < (GAIN_LIFE + GAIN_FADE) * 1000);
      const base = (bar?.y ?? 528) - 34;
      ctx.save();
      this.gains.forEach((g, i) => {
        const age = (now - g.t) / 1000, k = this.gains.length - 1 - i;
        ctx.globalAlpha = age < GAIN_LIFE ? 1 : Math.max(0, 1 - (age - GAIN_LIFE) / GAIN_FADE);
        uiText(ctx, g.text, 792, base - k * GAIN_LINE, { color: g.color, size: 12, align: 'right', outline: 'rgba(0,0,0,0.85)' });
      });
      ctx.restore();
    }
  }

  setMap() {}

  message(text, color = '#fff') { this.game.statusBar?.message(text, color); }

  notice(n) {
    const { type, msg } = n;
    if (type === 1) { this.game.windows.serverNotice(msg); return; }      // the server's pop-up: the metal plate
    if (type === 4) { this.banner(msg); return; }                         // the scrolling notice along the top
    if (type === 2) { this.megaphone([msg], { bg: 'rgba(46, 92, 170, 0.9)' }); return; }   // Megaphone: this channel
    if (type === 3 || type === 8 || type === 10) {                                          // Super / Item / Triple: the world
      const lines = n.lines || [type === 8 && n.item ? `${msg} [${this.game.windows.itemName(n.item.id) || 'item'}]` : msg];
      this.megaphone(lines, { bg: 'rgba(210, 46, 120, 0.9)', channel: n.channel, ear: n.ear });
      return;
    }
    this.message(msg, NOTICE_COLORS[type] || '#ffe08a');
  }
  /**
   * Megaphone lines: white on their bar, the world ones led by the CH tag and channel number
   * (UIWindow.img/Megaphone/ch0) and, when the sender allows whispers, the ear (Megaphone/0).
   */
  megaphone(lines, { bg, channel, ear }) {
    const M = this.game.windows.W.Megaphone, icons = [];
    if (channel) icons.push(M?.ch0, { text: String(channel) });
    if (ear) icons.push(M?.[0]);
    this.assets.preload([M?.ch0, M?.[0]].filter(Boolean));
    lines.forEach((l, i) => this.game.statusBar?.message(l, '#fff', { bg, icons: i === 0 ? icons.filter(Boolean) : null }));
  }

  async status(s) {
    if (s.type === 'exp') this.gain(`You have gained experience (+${s.amount})`, s.white ? '#fff' : '#ffef9a');
    else if (s.type === 'meso') this.gain(s.amount < 0 ? `You have lost mesos (${s.amount})` : `You have gained mesos (+${s.amount})`);
    else if (s.type === 'fame') this.gain(`You have gained fame (+${s.amount})`);
    else if (s.type === 'item') {
      const name = await itemName(this.assets, s.id);
      this.gain(s.qty < 0 ? `You have lost an item (${name}${s.qty < -1 ? ` x${-s.qty}` : ''})` : `You have gained an item (${name}${s.qty > 1 ? ` x${s.qty}` : ''})`);
    }
  }

  closeWindows() {
    this.game.windows?.closeAll();
    this.game.questWin?.close();
    this.game.shopWin?.close();
    this.game.skillWin?.close();
  }

  // ------------------------------------------------------------------ windows (canvas, ui/windows.js)
  toggleInventory(tab) { this.game.windows.toggle(tab === 1 ? 'equip' : 'inventory'); }
  toggleStats() { this.game.windows.toggle('stat'); }
  renderInventory() {}
  renderStats() {}
}

export { mapPath };
