import { itemName } from '../data.js';
import { mapPath } from '../map.js';

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

  setMap() {}

  message(text, color = '#fff') { this.game.statusBar?.message(text, color); }

  notice({ type, msg }) {
    if (type === 1) { this.game.windows.notice(msg); return; }
    this.message(msg, NOTICE_COLORS[type] || '#ffe08a');
  }

  async status(s) {
    if (s.type === 'exp') this.message(`You have gained experience (+${s.amount})`, s.white ? '#fff' : '#ffef9a');
    else if (s.type === 'meso') this.message(`You have gained mesos (+${s.amount})`);
    else if (s.type === 'fame') this.message(`You have gained fame (+${s.amount})`);
    else if (s.type === 'item') this.message(`You have gained an item (${await itemName(this.assets, s.id)}${s.qty > 1 ? ` x${s.qty}` : ''})`);
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
