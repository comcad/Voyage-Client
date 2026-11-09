import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { pad } from '../assets.js';
import { CHAT_COLOR } from './statusbar.js';
import { UI_W, UI_H } from '../view.js';

/**
 * The megaphone windows (UIWindow.img), centred on the screen; the whisper box starts ticked. Window coordinates:
 *   Super (Megaphone/backgrnd 266x156): the line (19, 58) 226 wide, whisper (14, 95), BtOK2 (146, 126), BtCancel2 (198, 126)
 *   Item (ItemMegaphone/backgrnd 239x215): the line (19, 129) 202 wide, whisper (14, 161), BtOK2 (145, 186), BtCancel2 (186, 186);
 *     drag an item from your inventory onto the slot to show it off. It doesn't hold the game up.
 *   Triple (ArtMegaphone/backgrnd 435x182): three lines (19, 63 / 84 / 106) 395 wide, BtEx (350, 33),
 *     BtPreView (277, 152), BtOK2 (340, 152), BtCancel2 (381, 152), whisper (18, 153)
 *   Avatar (AvatarMegaphone/backgrnd 196x193): one box (48, 81) 107x60 of four 15px lines, the text wrapping at its
 *     width (each line goes as one of the four strings); whisper (10, 147), its own BtOk (52, 170) and BtCancel (102, 170)
 * Every other line takes up to 60 characters.
 */
const SPECS = {
  2: { bg: (W) => W.Megaphone.backgrnd, fields: [[19, 58, 226, 15]], ear: [14, 95], ok: [146, 126], cancel: [198, 126] },
  6: { bg: (W) => W.ItemMegaphone.backgrnd, fields: [[19, 129, 202, 16]], ear: [14, 161], ok: [145, 186], cancel: [186, 186] },
  7: { bg: (W) => W.ArtMegaphone.backgrnd, fields: [63, 84, 106].map((y) => [19, y, 395, 16]), ear: [18, 153], ok: [340, 152], cancel: [381, 152] },
  avatar: { bg: (W) => W.AvatarMegaphone.backgrnd, fields: [[48, 81, 107, 60]], box: 4, ear: [10, 147], ok: [52, 170], cancel: [102, 170] },
};
const BOX_PAD = 3;   // the field's side padding
/** Text wrapped at w px in 12px Arial: by words, a word too long for a line by characters. */
function wrapLines(text, w) {
  const ctx = (wrapLines.ctx ??= document.createElement('canvas').getContext('2d'));
  ctx.font = '12px Arial';
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width <= w) { line = t; continue; }
      if (line) { out.push(line); line = ''; }
      for (const ch of word) { if (line && ctx.measureText(line + ch).width > w) { out.push(line); line = ''; } line += ch; }
    }
    out.push(line);
  }
  return out;
}

export class MegaphoneWin extends Win {
  constructor(mgr, slot, itemId) {
    const W = mgr.W, avatar = Math.floor(itemId / 10000) === 539, kind = avatar ? 'avatar' : Math.floor(itemId / 1000) % 10;
    const spec = SPECS[kind], bg = spec.bg(W);
    super(mgr, bg, Math.round((UI_W - bg._w) / 2), Math.round((UI_H - bg._h) / 2));
    this.modal = kind !== 6; this.transient = kind !== 6;   // the Item Megaphone stays open while you drag an item to it
    this.slot = slot; this.itemId = itemId; this.spec = spec; this.ear = true; this.item = null; this.kind = kind;
    this.closeBtn.visible = false;
    const B = mgr.B;
    this.button(avatar ? W.AvatarMegaphone.BtOk : B.BtOK2, ...spec.ok, () => this.send());
    this.button(avatar ? W.AvatarMegaphone.BtCancel : B.BtCancel2, ...spec.cancel, () => this.close());
    if (kind === 7) this.button(W.ArtMegaphone.BtPreView, 277, 152, () => this.preview());
    if (kind === 7) this.button(W.ArtMegaphone.BtEx, 350, 33, () => this.examples());
    this.fields = spec.fields.map(([x, y, w, h]) => {
      const f = new TextField(mgr.game.statusBar.layer, x, y, w, h, { max: spec.box ? 400 : 60, color: '#000' });
      f.rect.x0 = x; f.rect.y0 = y;
      if (spec.box) {
        // one wrapping box: no more than its four lines are taken
        const ta = document.createElement('textarea');
        ta.style.cssText = f.el.style.cssText; Object.assign(ta.style, { resize: 'none', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' });
        ta.maxLength = f.el.maxLength; ta.spellcheck = false; ta.autocomplete = 'off';
        f.el.replaceWith(ta); f.el = ta;
        let last = '';
        ta.addEventListener('input', () => { if (wrapLines(ta.value, w - 2 * BOX_PAD).length > spec.box) ta.value = last; else last = ta.value; });
      }
      f.el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); const i = this.fields.indexOf(f); if (i < this.fields.length - 1) this.fields[i + 1].focus(); else this.send(); }
        else if (e.key === 'Escape') this.close();
      });
      return f;
    });
    setTimeout(() => this.fields[0]?.focus(), 0);
  }
  frames() { return [...super.frames(), this.mgr.B.CheckBox?.[0], this.mgr.B.CheckBox?.[1]].filter(Boolean); }

  /**
   * Triple Megaphone: BtEx opens the item's examples beside it (at its corner + (407, 30)); a pick puts
   * Item/Cash/0507.img/<id>/sample/<n>/0-2 in the three lines. While the list is up it alone takes the clicks.
   */
  async examples() {
    if (this.picking) return;
    const d = (await this.g.assets.json('Item/Cash/0507.img'))?.[pad(this.itemId, 8)];
    if (!d?.ui) return;
    await this.g.assets.preload(allCanvases(d.ui));
    const keep = { modal: this.modal, transient: this.transient };
    this.modal = false; this.transient = false; this.picking = true;
    this.mgr.show(new ExamplePicker(this.mgr, d.ui, this.x + 407, this.y + 30, (i) => {
      Object.assign(this, keep); this.picking = false;
      const s = i === null ? null : d.sample?.[i];
      if (s) this.fields.forEach((f, k) => { f.value = String(s[k] ?? ''); });
    }));
  }
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
      const g = this.g, box = this.spec.box;
      const lines = box ? Array.from({ length: box }, (_, i) => (wrapLines(this.fields[0].value, this.spec.fields[0][2] - 2 * BOX_PAD)[i] || '').trim())
        : this.fields.map((f) => f.value.trim());
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
    const scale = this.g.canvas.clientWidth / UI_W;
    for (const f of this.fields) {
      f.rect.x = this.x + f.rect.x0; f.rect.y = this.y + f.rect.y0; f.layout({ left: 0, top: 0 }, scale);
      if (this.spec.box) f.el.style.lineHeight = `${parseFloat(f.el.style.height) / this.spec.box}px`;
    }
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

/**
 * The Triple Megaphone's examples (Item/Cash/0507.img/<id>/ui), 100 wide and (n + 2) * 15 tall (n: its children but
 * t, c and s): t, a c row every 15px from y 23, then s; ui/<i> at (9, 24 + 15i). It opens where asked, kept on an
 * 800x600 screen (x 700 at most, the bottom at 600). done(i) with the pick, or null for a click outside it or on its
 * title (11-77, 10-22).
 */
class ExamplePicker extends Win {
  constructor(mgr, ui, x, y, done) {
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.ui = ui; this.done = done; this.transient = true;
    this.n = Math.max(0, Object.keys(ui).filter((k) => k !== '_order').length - 3);
    this.w = 100; this.h = (this.n + 2) * 15;
    this.x = x + 100 > UI_W ? UI_W - 100 : x; this.y = y + this.h > UI_H ? UI_H - this.h : y;
    for (let i = 0; i < this.n; i++) this.button(ui[i], 9, 24 + i * 15, () => this.finish(i));
  }
  frames() { return allCanvases(this.ui); }
  finish(i) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(i); }
  onClose() { if (!this.answered) { this.answered = true; this.done(null); } }
  down(lx, ly) { if (lx >= 11 && lx < 77 && ly >= 10 && ly < 22) this.finish(null); }
  body(ctx) {
    const im = (n) => this.mgr.image(n), t = im(this.ui.t), c = im(this.ui.c), s = im(this.ui.s);
    if (t) ctx.drawImage(t, 0, 0);
    if (c) for (let i = 0; i < this.n; i++) ctx.drawImage(c, 0, 23 + i * 15);
    if (s) ctx.drawImage(s, 0, 23 + this.n * 15);
  }
}
