import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win } from './windows.js';

/**
 * Teleport Rock (UIWindow.img/Teleport, backgrnd 175x309), opened by a Teleport Rock (5040000, 5 maps on this
 * continent) or a VIP Teleport Rock (5041000, 10 maps anywhere, or straight to a character). Measured from the art:
 *   MAP LIST y 33-57, the NAME column header y 60-77, the saved maps in 17px rows (select bar 158x17) x 6-165
 *   from y 82 to 184; CHASE CHARACTER y 195-218 and its prompt y 222-238, the name line x 27-165 y 249-261;
 *   the button band y 279-306: ADD MAP (save the map you are in), DEL MAP, MOVE.
 * MOVE goes to the selected map - or, when a name is typed (VIP only), to that character. The rock is used up.
 */
const ROW_Y = 82, ROW_H = 17, ROWS = 6, EMPTY = 999999999;

export class TeleportWin extends Win {
  constructor(mgr, slot, itemId) {
    const T = mgr.W.Teleport;
    super(mgr, T.backgrnd, 300, 120);
    this.transient = true;
    this.T = T; this.slot = slot; this.itemId = itemId; this.vip = Math.floor(itemId / 1000) >= 5041;
    this.sel = -1; this.first = 0;
    this.button(T.BtRegister, 10, 285, () => this.g.net?.rockSave(this.vip));
    this.button(T.BtDelete, 64, 285, () => this.remove());
    this.button(T.BtMove, 118, 285, () => this.go());
    this.field = new TextField(mgr.game.statusBar.layer, 0, 0, 136, 13, { max: 13, color: '#000' });
    this.field.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.go(); else if (e.key === 'Escape') this.field.el.blur(); });
    this.field.show(this.vip);
    mgr.assets.json('String/Map.img').then((s) => { this.strMap = s; });
  }
  get maps() { return (this.vip ? this.g.rocks?.vip : this.g.rocks?.regular) || []; }
  mapName(id) {
    for (const r of Object.values(this.strMap || {})) if (r?.[id]) return `${r[id].streetName ? `${r[id].streetName} : ` : ''}${r[id].mapName}`;
    return `Map ${id}`;
  }
  remove() {
    const id = this.maps[this.sel];
    if (!id || id === EMPTY) { this.mgr.notice('Select a map to delete.'); return; }
    this.g.net?.rockDelete(this.vip, id);
    this.sel = -1;
  }
  go() {
    const name = this.vip ? this.field.value.trim() : '';
    const id = this.maps[this.sel];
    if (!name && (!id || id === EMPTY)) { this.mgr.notice(this.vip ? 'Select a map, or enter the name of a character.' : 'Select a map to go to.'); return; }
    if (!name && id === this.g.map?.id) { this.mgr.notice('You are already here.'); return; }
    this.g.net?.useRock(this.slot, this.itemId, name ? { name } : { mapId: id });
    this.close();
  }
  close() { this.mgr.close(this); }
  onClose() { this.field.remove(); }

  draw(ctx) {
    super.draw(ctx);
    if (this.vip) {
      this.field.rect.x = this.x + 28; this.field.rect.y = this.y + 248;
      this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / 800);
    }
  }
  body(ctx) {
    const maps = this.maps, sel = this.mgr.image(this.T.select);
    for (let i = 0; i < ROWS; i++) {
      const idx = this.first + i, id = maps[idx];
      if (id === undefined) break;
      const y = ROW_Y + i * ROW_H;
      if (idx === this.sel && sel) ctx.drawImage(sel, 7, y);
      ctx.save(); ctx.beginPath(); ctx.rect(8, y, 156, ROW_H); ctx.clip();
      this.text(ctx, id === EMPTY ? '(empty)' : this.mapName(id), 14, y + 2, { color: id === EMPTY ? '#aaa' : idx === this.sel ? '#fff' : '#000' });
      ctx.restore();
    }
    if (!this.vip) uiText(ctx, 'Only a VIP Teleport Rock can chase a character.', 88, 252, { color: '#888', size: 10, align: 'center' });
    uiText(ctx, `${this.vip ? 'VIP ' : ''}Teleport Rock`, 88, 266, { color: '#666', size: 10, align: 'center' });
  }
  down(lx, ly) {
    if (lx < 6 || lx > 165 || ly < ROW_Y || ly >= ROW_Y + ROWS * ROW_H) return;
    const idx = this.first + Math.floor((ly - ROW_Y) / ROW_H);
    if (idx < this.maps.length) { this.sel = idx; sfx.play('UI/BtMouseClick'); }
  }
  dblclick(lx, ly) { this.down(lx, ly); if (this.sel >= 0 && this.maps[this.sel] !== EMPTY) this.go(); }
  wheel(dy) { this.first = Math.max(0, Math.min(this.maps.length - ROWS, this.first + Math.sign(dy))); }
}
