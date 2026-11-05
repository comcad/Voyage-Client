import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win } from './windows.js';

/**
 * Teleport Rock (UIWindow.img/Teleport, backgrnd 175x309), centred, opened by a Teleport Rock (5040000, 5 maps) or a
 * VIP Teleport Rock (5041000, 10 maps, or straight to a character). "[saved/slots]" right-aligned to x 165, y 38;
 * five 18px rows from (9, 84), the map name at x 15 cut to 158px, the selected one on `select` in white; the VIP
 * list's scrollbar at (155, 80), 98 high; the name box (VIP only) at (34, 250); BtDelete (56, 285) and BtMove
 * (120, 285), each only with something to act on; BtRegister by the MAP LIST header; Basic/BtClose (156, 6).
 * Clicking under the list with a row picked drops it and goes to the name box. The rock is used up on a move.
 */
const ROW_Y = 84, ROW_H = 18, ROWS = 5, EMPTY = 999999999;

export class TeleportWin extends Win {
  constructor(mgr, slot, itemId) {
    const T = mgr.W.Teleport;
    super(mgr, T.backgrnd, Math.round((800 - T.backgrnd._w) / 2), Math.round((600 - T.backgrnd._h) / 2));
    this.transient = true; this.closeBtn.visible = false;
    this.T = T; this.slot = slot; this.itemId = itemId; this.vip = Math.floor(itemId / 1000) >= 5041;
    this.sel = -1; this.first = 0;
    this.button(T.BtRegister, 120, 37, () => this.register());
    this.delBtn = this.button(T.BtDelete, 56, 285, () => this.remove());
    this.moveBtn = this.button(T.BtMove, 120, 285, () => this.go());
    this.button(mgr.B.BtClose, 156, 6, () => this.close());
    this.field = new TextField(mgr.game.statusBar.layer, 0, 0, 120, 13, { max: 13, color: '#000' });
    this.field.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.go(); else if (e.key === 'Escape') this.field.el.blur(); });
    this.field.show(this.vip);
    mgr.assets.json('String/Map.img').then((s) => { this.strMap = s; });
  }
  get maps() { return (this.vip ? this.g.rocks?.vip : this.g.rocks?.regular) || []; }
  get picked() { const id = this.maps[this.sel]; return id && id !== EMPTY ? id : 0; }
  mapName(id) {
    for (const r of Object.values(this.strMap || {})) if (r?.[id]) return `${r[id].streetName ? `${r[id].streetName} : ` : ''}${r[id].mapName}`;
    return `Map ${id}`;
  }
  async register() {
    const here = this.g.map?.id || 0, maps = this.maps;
    if (!maps.includes(EMPTY) && maps.length >= (this.vip ? 10 : 5)) { this.mgr.notice('Your teleport list is full.\r\nPlease delete an entry before trying again.'); return; }
    if (maps.includes(here)) { this.mgr.notice('You have already entered this map.'); return; }
    if (here < 100000000 || Math.floor(here / 1000000) % 100 === 9) { this.mgr.notice('This map is not available to enter for the list.'); return; }
    if (await this.mgr.confirm(`Will you enter this map\r\nin your teleport list?\r\n[${this.mapName(here)}]`)) this.g.net?.rockSave(this.vip);
  }
  async remove() {
    const id = this.picked;
    if (!id) return;
    if (!(await this.mgr.confirm(`Will you delete this map from the\r\nteleport list?\r\n[${this.mapName(id)}]`))) return;
    this.g.net?.rockDelete(this.vip, id);
    this.sel = -1;
  }
  async go() {
    const name = this.vip ? this.field.value.trim() : '', id = this.picked;
    if (name) {
      if (!/^[a-zA-Z0-9]{4,12}$/.test(name)) { this.mgr.notice('- The character name is invalid.'); return; }
      if (name.toLowerCase() === (this.g.player?.name || '').toLowerCase()) { this.mgr.notice('You cannot target yourself\r\nfor the teleport.'); return; }
    } else {
      if (!id) return;
      if (id === this.g.map?.id) { this.mgr.notice("It's the map you're currently on."); return; }
      if (!(await this.mgr.confirm(`Will you teleport to this map?\r\n[${this.mapName(id)}]`))) return;
    }
    this.g.rockTarget = name;
    this.g.cashSend(() => this.g.net?.useRock(this.slot, this.itemId, name ? { name } : { mapId: id }));
    this.close();
  }
  close() { this.mgr.close(this); }
  onClose() { this.field.remove(); }

  draw(ctx) {
    this.delBtn.enabled = !!this.picked;
    this.moveBtn.enabled = !!this.picked || !!(this.vip && this.field.value.trim());
    super.draw(ctx);
    if (this.vip) {
      this.field.rect.x = this.x + 34; this.field.rect.y = this.y + 250;
      this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / 800);
    }
  }
  body(ctx) {
    const maps = this.maps, sel = this.mgr.image(this.T.select), slots = this.vip ? 10 : 5;
    uiText(ctx, `[${maps.filter((id) => id && id !== EMPTY).length}/${slots}]`, 165, 38, { color: '#000', size: 11, align: 'right' });
    for (let i = 0; i < ROWS; i++) {
      const idx = this.first + i, id = maps[idx];
      if (id === undefined) break;
      const y = ROW_Y + i * ROW_H;
      if (idx === this.sel && sel) ctx.drawImage(sel, 9, y);
      if (id === EMPTY) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(15, y, 158 - 6, ROW_H); ctx.clip();
      this.text(ctx, this.mapName(id), 15, y + 3, { color: idx === this.sel ? '#fff' : '#000' });
      ctx.restore();
    }
    if (this.vip) this.scrollbar(ctx, 155, 80, 98, this.first, maps.length, ROWS);
  }
  down(lx, ly) {
    if (ly >= 191 && ly < 280 && this.sel >= 0) { this.sel = -1; if (this.vip) this.field.focus(); return; }
    if (lx < 9 || lx >= 159 || ly < ROW_Y || ly >= ROW_Y + ROWS * ROW_H) return;
    const idx = this.first + Math.floor((ly - ROW_Y) / ROW_H);
    if (idx < this.maps.length) { this.sel = idx; sfx.play('UI/BtMouseClick'); }
  }
  dblclick(lx, ly) { this.down(lx, ly); if (this.picked) this.go(); }
  wheel(dy) { this.first = Math.max(0, Math.min(Math.max(0, this.maps.length - ROWS), this.first + Math.sign(dy))); }
}
