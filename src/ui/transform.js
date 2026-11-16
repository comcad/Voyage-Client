import { TextField } from './wzui.js';
import { Win } from './windows.js';
import { UI_W } from '../view.js';

/**
 * Transform (UIWindow.img/Transform, 267x129 at (266, 235)), opened by the Maplemas Party Potion (221x2xxx): type the
 * name of the character to look like. The name box (12 characters, black) at (23, 54), 200x14; BtOk at (60, 100) and
 * BtCancel at (170, 100). OK or Enter sends the name (nothing when it is empty), as an exclusive request (500ms
 * apart, "Other requests are in process..." otherwise); Cancel or Escape closes it.
 */
export class TransformWin extends Win {
  constructor(mgr, slot, itemId) {
    const T = mgr.W.Transform;
    super(mgr, T.backgrnd, 266, 235);
    this.transient = true; this.closeBtn.visible = false;
    this.slot = slot; this.itemId = itemId;
    this.button(T.BtOk, 60, 100, () => this.ok());
    this.button(T.BtCancel, 170, 100, () => this.close());
    this.field = new TextField(mgr.game.statusBar.layer, 0, 0, 200, 14, { max: 12, color: '#000' });
    // Enter reaches only here (the window is never modal); windows.js's capture handler routes Escape to key().
    this.field.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.ok(); else if (e.key === 'Escape') this.close();
    });
  }
  onOpen() { this.place(true); setTimeout(() => this.field.focus(), 0); }
  key(e) { if (e.key === 'Enter') this.ok(); else if (e.key === 'Escape') this.close(); }
  /**
   * Puts the box over the art at (23, 54). The window is dragged and the canvas resized, so this still runs from
   * draw(); but the six styles are only written when the window's place or the scale has actually changed, so a
   * still window costs a compare instead of a style write and a layout flush every frame.
   *
   * The scale is read here rather than cached at open, which is what makes a resize work without a hook into
   * setResolution: clientWidth changes, the compare misses, and the next frame rewrites the styles.
   */
  place(force = false) {
    const scale = this.g.canvas.clientWidth / UI_W;   // a style read: once per change, not once per frame
    const x = this.x + 23, y = this.y + 54;
    const at = this.placed;
    if (!force && at && at.x === x && at.y === y && at.scale === scale) return;
    this.placed = { x, y, scale };
    this.field.rect.x = x; this.field.rect.y = y;
    this.field.layout({ left: 0, top: 0 }, scale);
  }
  ok() {
    const name = this.field.value;
    if (!name.length) return;
    if (!this.g.canExclusive(500)) { this.mgr.notice('Other requests are in process.\r\nPlease try again in a little bit.'); return; }
    this.g.net?.transform(this.slot, this.itemId, name);
    this.g.lockExclusive();
    this.close();
  }
  close() { this.mgr.close(this); }
  onClose() { this.field.remove(); }
  draw(ctx) { super.draw(ctx); this.place(); }
}
