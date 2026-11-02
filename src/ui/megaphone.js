import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win } from './windows.js';

/**
 * The megaphone you just used asks what to say (UIWindow.img). Measured from the art:
 *   Megaphone/backgrnd (Megaphone), backgrnd1 (Super), backgrnd2 (Triple), 266x156: the text line x 19-244 y 58-72,
 *     DISPLAY WHISPER ICON on y 96-106 with its box after the label (x 142), the button band from y 114
 *   ItemMegaphone/backgrnd 239x215: the item slot centred on (120, 78) above its name bar (x 42-206, y 99-117),
 *     the text line x 19-220 y 131-145, MARK WHISPER ICON on y 166-176 (box at x 130), buttons from y 183
 *   AvatarMegaphone/backgrnd 196x193: WRITE NOTE's four lines x 42-153 from y 81 every 16px, the whisper row
 *     y 149-159 (box at x 136), its own BtOk / BtCancel from y 163
 * Drag an item from your inventory onto the Item Megaphone's slot to show it off.
 */
const KINDS = {
  1: { bg: 'backgrnd', fields: [[19, 58, 226]], ear: [142, 95], band: 120 },
  2: { bg: 'backgrnd1', fields: [[19, 58, 226]], ear: [142, 95], band: 120 },
  7: { bg: 'backgrnd2', fields: [[19, 58, 226]], ear: [142, 95], band: 120 },
};
const ITEM = { fields: [[19, 131, 202]], ear: [130, 165], band: 188 };
const AVATAR = { fields: [0, 1, 2, 3].map((i) => [42, 81 + i * 16, 112]), ear: [136, 148], band: 166 };

export class MegaphoneWin extends Win {
  constructor(mgr, slot, itemId) {
    const W = mgr.W, avatar = Math.floor(itemId / 10000) === 539, kind = Math.floor(itemId / 1000) % 10;
    const spec = avatar ? AVATAR : kind === 6 ? ITEM : KINDS[kind];
    const bg = avatar ? W.AvatarMegaphone.backgrnd : kind === 6 ? W.ItemMegaphone.backgrnd : W.Megaphone[spec.bg];
    super(mgr, bg, Math.round((800 - bg._w) / 2), 170);
    this.modal = true; this.transient = true;
    this.slot = slot; this.itemId = itemId; this.spec = spec; this.ear = false; this.item = null; this.kind = avatar ? 'avatar' : kind;
    this.closeBtn.visible = false;
    const B = mgr.B, okNode = avatar ? W.AvatarMegaphone.BtOk : B.BtOK, noNode = avatar ? W.AvatarMegaphone.BtCancel : B.BtCancel;
    const ow = okNode.normal[0]._w, nw = noNode.normal[0]._w;
    this.button(noNode, this.w - 10 - nw, spec.band, () => this.close());
    this.button(okNode, this.w - 14 - nw - ow, spec.band, () => this.send());
    this.fields = spec.fields.map(([x, y, w]) => {
      const f = new TextField(mgr.game.statusBar.layer, x, y, w, 15, { max: avatar ? 18 : 60, color: '#000' });
      f.rect.x0 = x; f.rect.y0 = y;
      f.el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { const i = this.fields.indexOf(f); if (i < this.fields.length - 1) this.fields[i + 1].focus(); else this.send(); }
        else if (e.key === 'Escape') this.close();
      });
      return f;
    });
    setTimeout(() => this.fields[0]?.focus(), 0);
  }
  frames() { return [...super.frames(), this.mgr.B.CheckBox?.[0], this.mgr.B.CheckBox?.[1]].filter(Boolean); }

  send() {
    const lines = this.fields.map((f) => f.value.trim());
    if (!lines.some(Boolean)) { this.fields[0].focus(); return; }
    this.g.net?.useMegaphone(this.slot, this.itemId, { text: lines[0], lines, ear: this.ear, item: this.item });
    this.close();
  }
  close() { for (const f of this.fields) f.remove(); this.mgr.close(this); }
  onClose() { for (const f of this.fields) f.remove(); }
  key(e) { if (e.key === 'Escape') this.close(); }

  draw(ctx) {
    super.draw(ctx);
    const scale = this.g.canvas.clientWidth / 800;
    for (const f of this.fields) { f.rect.x = this.x + f.rect.x0; f.rect.y = this.y + f.rect.y0; f.layout({ left: 0, top: 0 }, scale); }
  }
  body(ctx) {
    const m = this.mgr, [ex, ey] = this.spec.ear, box = m.image(m.B.CheckBox?.[this.ear ? 1 : 0]);
    if (box) ctx.drawImage(box, ex, ey);
    if (this.kind === 6) {
      if (this.item) {
        const it = this.g.inventory?.[this.item.tab]?.[this.item.slot];
        if (it) {
          m.drawIcon(ctx, m.icon(it.id), 104, 62);
          uiText(ctx, m.itemName(it.id) || '', 124, 102, { color: '#fff', bold: true, size: 11, align: 'center' });
        }
      } else uiText(ctx, 'Drag an item here', 124, 102, { color: '#cfe0ff', size: 11, align: 'center' });
    }
  }
  down(lx, ly) {
    const [ex, ey] = this.spec.ear;
    if (lx >= ex - 2 && lx < ex + 14 && ly >= ey - 2 && ly < ey + 14) { this.ear = !this.ear; sfx.play('UI/BtMouseClick'); }
  }
  /** An item from your inventory onto the Item Megaphone's slot. */
  drop(lx, ly, c) {
    if (this.kind !== 6 || c.kind !== 'item' || typeof c.tab !== 'number') return;
    if (lx >= 60 && lx < 190 && ly >= 50 && ly < 122) { this.item = { tab: c.tab, slot: c.slot }; sfx.play('UI/DragEnd'); }
  }
}
