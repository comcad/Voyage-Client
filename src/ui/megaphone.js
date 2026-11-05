import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win } from './windows.js';
import { CHAT_COLOR } from './statusbar.js';

/**
 * The megaphone windows (UIWindow.img), centred on the screen; the whisper box starts ticked. Window coordinates:
 *   Super (Megaphone/backgrnd 266x156): the line (19, 58) 226 wide, whisper (14, 95), BtOK2 (146, 126), BtCancel2 (198, 126)
 *   Item (ItemMegaphone/backgrnd 239x215): the line (19, 129) 202 wide, whisper (14, 161), BtOK2 (145, 186), BtCancel2 (186, 186);
 *     drag an item from your inventory onto the slot to show it off. It doesn't hold the game up.
 *   Triple (ArtMegaphone/backgrnd 435x182): three lines (19, 63 / 84 / 106) 395 wide, BtEx (350, 33),
 *     BtPreView (277, 152), BtOK2 (340, 152), BtCancel2 (381, 152), whisper (18, 153)
 *   Avatar (AvatarMegaphone/backgrnd 196x193): four lines from (48, 81) 107 wide, whisper (10, 147),
 *     its own BtOk (52, 170) and BtCancel (102, 170)
 * Every line takes up to 60 characters.
 */
const SPECS = {
  2: { bg: (W) => W.Megaphone.backgrnd, fields: [[19, 58, 226, 15]], ear: [14, 95], ok: [146, 126], cancel: [198, 126] },
  6: { bg: (W) => W.ItemMegaphone.backgrnd, fields: [[19, 129, 202, 16]], ear: [14, 161], ok: [145, 186], cancel: [186, 186] },
  7: { bg: (W) => W.ArtMegaphone.backgrnd, fields: [63, 84, 106].map((y) => [19, y, 395, 16]), ear: [18, 153], ok: [340, 152], cancel: [381, 152] },
  avatar: { bg: (W) => W.AvatarMegaphone.backgrnd, fields: [0, 1, 2, 3].map((i) => [48, 81 + i * 15, 107, 15]), ear: [10, 147], ok: [52, 170], cancel: [102, 170] },
};

export class MegaphoneWin extends Win {
  constructor(mgr, slot, itemId) {
    const W = mgr.W, avatar = Math.floor(itemId / 10000) === 539, kind = avatar ? 'avatar' : Math.floor(itemId / 1000) % 10;
    const spec = SPECS[kind], bg = spec.bg(W);
    super(mgr, bg, Math.round((800 - bg._w) / 2), Math.round((600 - bg._h) / 2));
    this.modal = kind !== 6; this.transient = kind !== 6;   // the Item Megaphone stays open while you drag an item to it
    this.slot = slot; this.itemId = itemId; this.spec = spec; this.ear = true; this.item = null; this.kind = kind;
    this.closeBtn.visible = false;
    const B = mgr.B;
    this.button(avatar ? W.AvatarMegaphone.BtOk : B.BtOK2, ...spec.ok, () => this.send());
    this.button(avatar ? W.AvatarMegaphone.BtCancel : B.BtCancel2, ...spec.cancel, () => this.close());
    if (kind === 7) this.button(W.ArtMegaphone.BtPreView, 277, 152, () => this.preview());
    this.fields = spec.fields.map(([x, y, w, h]) => {
      const f = new TextField(mgr.game.statusBar.layer, x, y, w, h, { max: 60, color: '#000' });
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

  /** Triple Megaphone: how it will look, in your chat only. */
  preview() {
    const hud = this.g.hud, name = this.g.player?.name || '';
    hud.message('This is a preview option for the Triple Megaphone.', CHAT_COLOR.grey);
    for (const f of this.fields) if (f.value.trim()) hud.message(`${name} : ${f.value.trim()}`, CHAT_COLOR.grey);
  }
  async send() {
    if (this.sending) return;
    this.sending = true;
    try {
      const lines = this.fields.map((f) => f.value.trim()), g = this.g;
      if (this.kind === 7) {
        if (lines.some((l) => !l) && !(await this.mgr.confirm('One of the lines has not been applied.\r\nWould you still like to use it?'))) return;
        this.close();
        if (!lines.some(Boolean)) return;
        if (lines.some((l) => l.length > 60)) { this.mgr.notice('Use the megaphone to text up to 60 characters.'); return; }
      } else if (this.kind === 'avatar') {
        this.close();
        if (!lines.join('')) { this.mgr.notice('Please enter the text.'); return; }
        if (await g.cursed(lines.join(''))) { this.mgr.notice('Cursing is not allowed.'); return; }
      } else if (this.kind === 6) {
        if (!lines[0]) return;
        if (!this.item && !(await this.mgr.confirm('You have not selected an item.\r\nAre you sure you still want to use the item?'))) return;
        this.close();
      } else {
        this.close();
        if (!(await g.megaphoneTextOk(lines[0]))) return;
      }
      g.cashSend(() => g.net?.useMegaphone(this.slot, this.itemId, { text: lines[0], lines, ear: this.ear, item: this.item, look: g.myLookData() }));
    } finally { this.sending = false; }
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
    if (this.kind === 6 && this.item) {
      const it = this.g.inventory?.[this.item.tab]?.[this.item.slot];
      if (it) {
        m.drawIcon(ctx, m.icon(it.id), 104, 62);
        uiText(ctx, m.itemName(it.id) || '', 124, 102, { color: '#fff', bold: true, size: 11, align: 'center' });
      }
    }
  }
  down(lx, ly) {
    const [ex, ey] = this.spec.ear;
    if (lx >= ex && lx < ex + 160 && ly >= ey && ly < ey + 14) { this.ear = !this.ear; sfx.play('UI/BtMouseClick'); }
  }
  /** An item from your inventory onto the Item Megaphone (any tab, any item). */
  drop(lx, ly, c) {
    if (this.kind !== 6 || c.kind !== 'item' || typeof c.tab !== 'number') return;
    this.item = { tab: c.tab, slot: c.slot };
  }
}
