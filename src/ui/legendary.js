import { sfx } from '../audio.js';
import { Win } from './windows.js';
import { CHAT_COLOR } from './statusbar.js';
import { UI_W, UI_H } from '../view.js';

/**
 * Legendary Spirit's ITEM UPGRADE window (UIWindow.img/EnchantSkill, 178x206, centred). The skill opens it and
 * sends nothing.
 * - An equip dragged from the inventory's Equip tab goes in (a cash one other than pet equipment is refused); a new
 *   one replaces it. Its icon stands on (74, 126); the mouse over 75..102 x 100..127 shows its tooltip.
 * - A Use-tab scroll dragged in is used on it as on a worn item, but the White Scroll comes from the check box: at
 *   opening it is on (and can be changed) with a White Scroll in Use, off and greyed without one.
 * - From the send until the result is over the window is locked: drops and both buttons do nothing.
 * - The result plays the Effect (26 frames, 120ms each) at (2, 60) with the Enchant sound, still over the old item;
 *   then the chat line (its White Scroll wording from the box as it is then), the success / failure sound and art on
 *   you, and the window unlocks with the item read again - or closes, when the item was destroyed.
 * - "cannot use" (-1) only says so and unlocks.
 * Unverified places (lost in the client): BtClose (160, 6), BtCancel2 (125, 179), the check box control (14, 152)
 * with its box at (16, 153), the box's label (32, 154), the instructions (50, 27).
 */
const EFFECT_MS = 120, ICON = [74, 126], TIP = [75, 100, 102, 127], CHECK = [14, 152, 150, 15];
const WHITE = 2340000;

export class LegendaryWin extends Win {
  constructor(mgr) {
    const E = mgr.W.EnchantSkill;
    super(mgr, E.backgrnd, (UI_W - 178) >> 1, (UI_H - 206) >> 1);
    this.E = E;
    this.closeBtn.x = 160; this.closeBtn.y = 6; this.closePinned = true;
    this.cancelBtn = this.button(mgr.B.BtCancel2, 125, 179, () => this.mgr.close(this));
    this.slot = 0; this.item = null; this.locked = false; this.effT = null;
    this.boxEnabled = this.hasWhite(); this.checked = this.boxEnabled;
  }
  frames() {
    const E = this.E, B = this.mgr.B;
    return [...super.frames(), E.say0, E.say1, E.say2, ...Object.keys(E.Effect || {}).filter((k) => /^\d+$/.test(k)).map((k) => E.Effect[k]), ...[0, 1, 2, 3].map((i) => B.CheckBox?.[i])].filter((n) => n?._canvas);
  }
  onClose() { if (this.g.legendaryWin === this) this.g.legendaryWin = null; }
  hasWhite() { return Object.values(this.g.inventory?.[2] || {}).some((x) => x?.id === WHITE); }
  setLocked(on) { this.locked = on; this.keepOnEscape = on; this.closeBtn.enabled = this.cancelBtn.enabled = !on; }

  drop(lx, ly, c) {
    if (c?.kind !== 'item' || typeof c.tab !== 'number') return;
    sfx.play('UI/DragEnd');
    if (c.tab === 1) this.put(c.slot);
    else if (c.tab === 2) this.scroll(c.slot);
  }
  put(slot) {
    const it = this.g.inventory?.[1]?.[slot];
    if (this.locked || !it) return;
    if (Number(this.mgr.info(it.id)?.cash) && Math.floor(it.id / 10000) !== 180) { this.mgr.notice('You may not use scrolls on this item.'); return; }
    this.slot = slot; this.item = { ...it };
  }
  async scroll(scrollSlot) {
    if (this.locked || !this.slot) return;
    if (await this.g.useScroll(scrollSlot, this.slot, this)) this.setLocked(true);
  }
  down(lx, ly) {
    const [x, y, w, h] = CHECK;
    if (this.boxEnabled && lx >= x && lx < x + w && ly >= y && ly < y + h) this.checked = !this.checked;
  }
  /** SHOW_SCROLL_EFFECT for your own Legendary Spirit scroll. */
  result(success, cursed) {
    if (success === -1) {
      this.effT = null; this.setLocked(false);
      this.mgr.notice('You cannot use a Scroll with this item.');
      return;
    }
    this.res = { success: success !== 0, cursed };
    this.effT = 0;
    sfx.play('UI/Enchant');
  }
  tick(ms) {
    if (this.effT === null) return;
    this.effT += ms;
    if (this.effT >= this.effectFrames() * EFFECT_MS) this.finish();
  }
  effectFrames() { return Object.keys(this.E.Effect || {}).filter((k) => /^\d+$/.test(k)).length || 1; }
  finish() {
    const { success, cursed } = this.res, g = this.g;
    this.effT = null;
    g.hud?.message(success ? (this.checked ? ' The item was successfully upgraded, and the white scroll was used in the process.' : 'The scroll lights up, and then its mysterious power has been transferred to the item.')
      : cursed ? 'The item is destroyed due to the overwhelming power of the scroll.'
        : this.checked ? 'The item upgrade failed, but since the White Scroll was used, the number of item upgrade slots remained in tact.'
          : 'The scroll lights up, but the item winds up as if nothing happened', CHAT_COLOR.error);
    sfx.play(success ? 'Game/EnchantSuccess' : 'Game/EnchantFailure');
    g.enchantArt?.(g.player, success);
    if (cursed && !success) { this.mgr.close(this); return; }
    this.setLocked(false);
    const it = g.inventory?.[1]?.[this.slot];
    this.item = it ? { ...it } : null;
    if (!it) this.slot = 0;
  }
  body(ctx) {
    const m = this.mgr, E = this.E, im = (n) => n && m.image(n);
    const say = im(this.item ? E.say1 : E.say0), label = im(E.say2);
    if (say) ctx.drawImage(say, 50, 27);
    const box = im(m.B.CheckBox?.[this.boxEnabled ? (this.checked ? 1 : 0) : (this.checked ? 3 : 2)]);
    if (box) ctx.drawImage(box, CHECK[0] + 2, CHECK[1] + 1);
    if (label) ctx.drawImage(label, 32, 154);
    if (this.item) m.drawIcon(ctx, m.icon(this.item.id), ICON[0], ICON[1] - 32, this.item.id);
    if (this.effT !== null) {
      const f = im(E.Effect?.[Math.min(this.effectFrames() - 1, Math.floor(this.effT / EFFECT_MS))]);
      if (f) ctx.drawImage(f, 2, 60);
    }
  }
  tooltip(lx, ly) {
    const [x1, y1, x2, y2] = TIP;
    return this.item && lx >= x1 && lx <= x2 && ly >= y1 && ly <= y2 ? { item: this.item } : null;
  }
}

/** Legendary Spirit (1003 and its Cygnus, Aran and Evan twins): opens the window, or brings it forward. */
export async function openLegendary(game) {
  const wm = game.windows;
  if (!wm?.W?.EnchantSkill) return;
  if (game.legendaryWin && wm.order.includes(game.legendaryWin)) { wm.raise(game.legendaryWin); return; }
  const w = new LegendaryWin(wm);
  await game.assets.preload(w.frames());
  game.legendaryWin = wm.show(w, 'UI/MenuUp');
}
