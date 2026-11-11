import { itemName, itemDesc, invType } from '../data.js';
import { sfx } from '../audio.js';

const TAB_NAMES = { 1: 'Eqp', 2: 'Use', 3: 'Setup', 4: 'Etc', 5: 'Cash' };
import { mapPath } from '../map.js';
import { uiText } from './wzui.js';
import { CHAT_COLOR, CHAT_BAR } from './statusbar.js';
import { localTalk } from './dialogs.js';
import { UI_W, UI_H } from '../view.js';

const GAIN_LIFE = 5, GAIN_FADE = 1, GAIN_MAX = 7, GAIN_LINE = 16, BANNER_SPEED = 70;

// server notices: 0 '[Notice] ' in light blue, 5 light red, 6 light blue
const NOTICE_COLORS = { 0: CHAT_COLOR.notice, 5: CHAT_COLOR.error, 6: CHAT_COLOR.notice };

/** In-game HTML interface layered over the canvas. */
export class Hud {
  constructor(root, game) {
    this.game = game; this.assets = game.assets;
    // level, name, job and the HP / MP / EXP gauges are drawn on the canvas by StatusBar
    // chat log and input belong to the canvas status bar; the map name is on the minimap
    addEventListener('keydown', (e) => {
      if (document.activeElement instanceof HTMLInputElement || document.querySelector('.modal-overlay') || game.inCashShop) return;
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
      const w = ctx.measureText(this.slide.text).width, run = UI_W + w + 40;
      const x = UI_W - (((now - this.slide.t) / 1000) * BANNER_SPEED) % run;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'; ctx.fillRect(0, 0, UI_W, 18);
      uiText(ctx, this.slide.text, x, 3, { color: '#ffff7e', size: 12 });
      ctx.restore();
    }
  }
  draw(ctx) {
    const now = performance.now(), bar = this.game.statusBar;
    if (this.gains?.length) {
      this.gains = this.gains.filter((g) => now - g.t < (GAIN_LIFE + GAIN_FADE) * 1000);
      const base = (bar?.y ?? UI_H - 72) - 34;
      ctx.save();
      this.gains.forEach((g, i) => {
        const age = (now - g.t) / 1000, k = this.gains.length - 1 - i;
        ctx.globalAlpha = age < GAIN_LIFE ? 1 : Math.max(0, 1 - (age - GAIN_LIFE) / GAIN_FADE);
        uiText(ctx, g.text, UI_W - 8, base - k * GAIN_LINE, { color: g.color, size: 12, align: 'right', outline: 'rgba(0,0,0,0.85)' });
      });
      ctx.restore();
    }
  }

  setMap() {}

  message(text, color = '#fff') { this.game.statusBar?.message(text, color); }

  notice(n) {
    const { type, msg } = n, g = this.game;
    if (type === 1) { g.windows.serverNotice(msg); return; }      // the server's pop-up
    if (type === 4) { this.banner(msg); return; }                         // the scrolling notice along the top
    if (type === 7) { localTalk(g.windows, n.npc || 0, msg, ['OK']); return; }   // in an NPC's dialog
    // megaphones (2, 3, 8, 9, 10): none on an event map unless you are a GM; others' words masked; the swindle check
    if ([2, 3, 8, 9, 10].includes(type)) {
      if (Math.floor((g.map?.id || 0) / 1e6) % 100 === 9 && !g.gm) return;
      const lines = (n.lines || [msg]).map((l) => g.megaphoneMasked(l));
      g.swindleCheck?.(lines.join(' '));
      if (type === 2) { this.megaphone(lines, CHAT_BAR.mega); return; }   // Megaphone: this channel
      this.megaphone(lines, { ...(type === 8 || type === 9 ? CHAT_BAR.itemMega : CHAT_BAR.superMega), channel: n.channel, ear: type === 9 ? true : n.ear, item: type === 8 ? n.item : null });
      return;
    }
    if (type === 0x0B && n.item) { g.swindleCheck?.(msg); this.gachapon(n); return; }
    this.message(type === 0 ? `[Notice] ${msg}` : msg, NOTICE_COLORS[type] || CHAT_COLOR.notice);
  }
  /**
   * A Gachapon prize for the world: the sender's "name : got a(n)" split at the ' : ' and put in
   * "%s %s  :  %s  from the %s Gachapon! Congrats!" with the item's name and the town, black on a green bar with
   * the channel tag; a Cash Shop Surprise (channel -1) "... from the Cash Shop Surprise! Congrats!", white on a
   * half-clear red one. Pointing at the line shows the item. Not shown on an event map (but 809xxxxxx) unless
   * you are a GM.
   */
  async gachapon(n) {
    const g = this.game, field = Math.floor((g.map?.id ?? 0) / 1000000);
    if (!g.gm && field % 100 === 9 && field !== 809) return;
    const cut = n.msg.indexOf(' : '), who = cut >= 0 ? n.msg.slice(0, cut) : n.msg, what = cut >= 0 ? n.msg.slice(cut + 3) : '';
    const name = (await itemName(this.assets, n.item.id).catch(() => '')) || '';
    g.windows.itemName(n.item.id);
    if (n.channel === -1) {
      g.statusBar?.message(`${who} ${what}  :  ${name}  from the Cash Shop Surprise! Congrats!`, '#FFFFFF', { bg: 'rgba(255,92,89,0.5)', item: n.item, inline: true });
      return;
    }
    const M = g.windows.W.Megaphone;
    this.assets.preload([M?.ch1, ...Object.values(M?.Num || {})].filter((x) => x?._canvas));
    g.statusBar?.message(`${who} ${what}  :  ${name}  from the ${n.town} Gachapon! Congrats!`, '#000000',
      { bg: 'rgb(153,204,51)', tag: { channel: n.channel + 1, ear: false }, item: n.item, inline: true });
  }
  /** Megaphone lines: their colour on their bar; the world ones carry the channel tag (with the ear when the sender allows whispers). */
  megaphone(lines, { color = '#fff', bg, channel, ear, item = null }) {
    const M = this.game.windows.W.Megaphone;
    this.assets.preload([M?.ch0, M?.ch1, ...Object.values(M?.Num || {})].filter((n) => n?._canvas));
    if (item) this.game.windows.itemName(item.id);   // start loading its name
    lines.forEach((l) => this.game.statusBar?.message(l, color, { bg, tag: channel ? { channel, ear } : null, item }));
  }

  /**
   * SHOW_STATUS_INFO lines. A monster's EXP and pick-ups go to the lower-right list (with the EXP's bonus lines);
   * a quest's EXP, fame, quest mesos, Guild Points and item messages are grey log lines; expiries light red.
   */
  async status(s) {
    const grey = (t) => this.message(t, CHAT_COLOR.grey), red = (t) => this.message(t, CHAT_COLOR.error);
    if (s.type === 'exp') {
      const line = `You have gained experience (+${s.amount})`;
      if (s.inChat) { grey(line); return; }
      this.gain(line, s.white ? '#fff' : '#ffef9a');
      const b = s.bonus || {}, extra = [
        [b.equip, `Equip Item Bonus EXP (+${b.equip})`], [b.wedding, `Bonus Wedding EXP (+${b.wedding})`],
        [b.party, b.partyRate > 0 ? `Bonus Event Party EXP (+${b.party}) x${b.partyRate / 100}` : `Bonus EXP for PARTY (+${b.party})`],
        [b.cafe, `Internet Cafe EXP Bonus (+${b.cafe})`], [b.event, `Bonus Event EXP (+${b.event})`], [b.rainbow, `Rainbow Week Bonus EXP (+${b.rainbow})`],
      ];
      for (const [v, t] of extra) if (v > 0) this.gain(t, '#ffef9a');
    } else if (s.type === 'meso') {
      if (s.inChat) { grey(s.amount < 0 ? `You have lost mesos. (${s.amount})` : `You have gained mesos (+${s.amount})`); return; }
      this.gain(s.amount < 0 ? `You have lost mesos (${s.amount})` : `You have gained mesos (+${s.amount})`);
      if (s.lost) this.message('A portion was not found after falling on the ground.', CHAT_COLOR.yellow);
      if (s.bonus) this.gain(`Internet Cafe Meso Bonus (+${s.bonus})`);
    } else if (s.type === 'text') {
      if (s.text === 'You cannot acquire any items.') red(s.text); else this.gain(s.text);
    } else if (s.type === 'fame') grey(s.amount < 0 ? `You have lost fame (${s.amount})` : `You have gained fame. (+${s.amount})`);
    else if (s.type === 'gp') grey(s.amount < 0 ? `You have lost Guild Points (${s.amount})` : `You have earned Guild Points (+${s.amount})`);
    else if (s.type === 'itemMsg') { const d = await itemDesc(this.assets, s.id); if (d) grey(d); }
    else if (s.type === 'expired' || s.type === 'sealExpired' || s.type === 'timeLimit') {
      for (const id of s.ids) {
        const name = await itemName(this.assets, id);
        red(s.type === 'sealExpired' ? `${name}'s seal has expired.` : s.type === 'timeLimit' ? `${name} has disappeared as the time limit has passed.`
          : s.cash ? `[${name}] has passed its expiration date and will be removed from your inventory.` : `The item [${name}] has been expired, and therefore, deleted from your inventory.`);
      }
    }
    else if (s.type === 'item') {
      const name = await itemName(this.assets, s.id);
      const tab = TAB_NAMES[invType(s.id)] || '';
      if (s.qty < 0) this.gain(s.qty < -1 ? `You have lost items (${name} ${-s.qty})` : `You have lost an item (${name})`);
      else if (name) this.gain(s.qty < 2 ? `You have gained an item in the ${tab} tab (${name})` : `You have gained items in the ${tab} tab (${name} ${s.qty})`);
    }
  }

  /** Esc: the window opened last closes; with none open, the Game Menu opens. */
  closeWindows() {
    const g = this.game;
    if (g.windows?.closeTop()) return;
    const bar = g.statusBar;
    if (bar?.menu) { bar.menu = null; sfx.play('UI/MenuUp'); }
    else if (bar) bar.toggleMenu('GameMenu', bar.menuBtn);
  }

  // ------------------------------------------------------------------ windows (canvas, ui/windows.js)
  toggleInventory(tab) { this.game.windows.toggle(tab === 1 ? 'equip' : 'inventory'); }
  toggleStats() { this.game.windows.toggle('stat'); }
  renderInventory() {}
  renderStats() {}
}

export { mapPath };
