import { sfx } from '../audio.js';
import { frames, frameAt } from '../assets.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { lookEquipIds } from '../net/proto.js';
import { TextField, uiText } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { VIEW_W, VIEW_H } from '../view.js';

/**
 * The MapleTV messengers (5075000-5075005): kind 0 plain, 1 Star, 2 Heart; 5075003-5075005 are the Megassengers,
 * which also go out as a megaphone line (with the whisper box, ticked).
 * UIWindow.img/MapleTV/backgrnd (backgrnd2 Star; backgrnd3 / backgrnd4 the Megassengers, 10px taller), centred.
 * Measured from the art: the five lines x 41-170 from y 113 every 16px; the receiver's box (BtTo, 175x18: its TO
 * label, then the white box x 24-173) at (26, 64), the name typed at (52, 66); for kind 0 a box at (10, 67) turns it on; the whisper box at (14, 197); BtOk / BtCancel
 * right-aligned in the bottom band (y 207, 217 on a Megassenger).
 */
export class MapleTVWin extends Win {
  constructor(mgr, slot, itemId) {
    const T = mgr.W.MapleTV, n = itemId % 10, kind = n % 3, mega = n >= 3;
    const bg = T[mega ? (kind === 1 ? 'backgrnd4' : 'backgrnd3') : kind === 1 ? 'backgrnd2' : 'backgrnd'];
    super(mgr, bg, Math.round((VIEW_W - bg._w) / 2), Math.round((VIEW_H - bg._h) / 2));
    this.modal = true; this.transient = true; this.closeBtn.visible = false;
    this.slot = slot; this.itemId = itemId; this.kind = kind; this.mega = mega; this.ear = true; this.toOn = kind === 2;
    const by = mega ? 217 : 207;
    this.button(T.BtCancel, 156, by, () => this.close());
    this.button(T.BtOk, 107, by, () => this.send());
    const field = (x, y, w, max) => {
      const f = new TextField(mgr.game.statusBar.layer, x, y, w, 15, { max, color: '#000' });
      f.rect.x0 = x; f.rect.y0 = y;
      f.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.close(); else if (e.key === 'Enter') this.next(f); });
      return f;
    };
    this.to = kind !== 1 ? field(52, 66, 145, 13) : null;   // in BtTo's white box, right of its TO label
    this.lines = [0, 1, 2, 3, 4].map((i) => field(41, 113 + i * 16, 129, 25));
    setTimeout(() => (this.toOn ? this.to : this.lines[0]).focus(), 0);
  }
  get fields() { return [this.to, ...this.lines].filter(Boolean); }
  next(f) { const all = this.fields, i = all.indexOf(f); if (i < all.length - 1) all[i + 1].focus(); else this.send(); }
  frames() { return [...super.frames(), ...allCanvases(this.mgr.W.MapleTV.BtTo), this.mgr.B.CheckBox?.[0], this.mgr.B.CheckBox?.[1]].filter(Boolean); }

  async send() {
    if (this.sending) return;
    this.sending = true;
    try {
      const g = this.g, to = this.toOn ? this.to?.value.trim() || '' : '', lines = this.lines.map((f) => f.value.trim());
      if (!(await this.mgr.confirm(`This message will be sent to \r\nMaple TV in ${g.tvWait || 0} seconds. \r\n Do you want to proceed?`))) return;
      if (this.kind === 2 && !to) { this.mgr.notice("You didn't enter the recipient's name."); return; }
      if (lines.join('\n') && (await Promise.all(lines.map((l) => g.cursed(l)))).some(Boolean)) { this.mgr.notice('Cursing is not allowed.'); return; }
      this.close();
      g.cashSend(() => g.net?.useMapleTV(this.slot, this.itemId, { kind: this.kind, mega: this.mega, ear: this.ear, to, lines }));
    } finally { this.sending = false; }
  }
  close() { for (const f of this.fields) f.remove(); this.mgr.close(this); }
  onClose() { for (const f of this.fields) f.remove(); }
  key(e) { if (e.key === 'Escape') this.close(); }
  draw(ctx) {
    super.draw(ctx);
    const scale = this.g.canvas.clientWidth / VIEW_W;
    for (const f of this.fields) { f.rect.x = this.x + f.rect.x0; f.rect.y = this.y + f.rect.y0; f.layout({ left: 0, top: 0 }, scale); }
    if (this.to) this.to.el.style.visibility = this.toOn ? '' : 'hidden';
  }
  body(ctx) {
    const m = this.mgr, T = m.W.MapleTV, box = (on, x, y) => { const i = m.image(m.B.CheckBox?.[on ? 1 : 0]); if (i) ctx.drawImage(i, x, y); };
    const to = m.image(frames(T.BtTo?.[this.toOn ? 'enabled' : 'disabled'])[0]);
    if (to) ctx.drawImage(to, 26, 64);
    if (this.kind === 0) box(this.toOn, 10, 67);
    if (this.mega) box(this.ear, 14, 197);
  }
  down(lx, ly) {
    if (this.kind === 0 && lx >= 10 && lx < 24 && ly >= 66 && ly < 80) { this.toOn = !this.toOn; sfx.play('UI/BtMouseClick'); if (this.toOn) this.to.focus(); }
    if (this.mega && lx >= 14 && lx < 174 && ly >= 196 && ly < 210) { this.ear = !this.ear; sfx.play('UI/BtMouseClick'); }
  }
}

/**
 * What the MapleTV NPCs show (SEND_TV until REMOVE_TV): their top screen turns on (UI/MapleTV.img/TVon); the
 * sender stands at (28, 77) of it and the receiver, if any, at (213, 77); the Star / Heart kinds put the text in
 * the TVchat1 / TVchat2 bubble at (113, 45) / (119, 45), the plain one writes it straight on the screen.
 */
export class MapleTVScreen {
  constructor(g) { this.g = g; this.cur = null; }
  async show(d) {
    const as = this.g.assets, seq = (this.seq = (this.seq || 0) + 1), ui = await as.json('UI/MapleTV.img');
    const make = async (L) => {
      if (!L) return null;
      const look = new CharacterLook(as, { skin: L.skin, face: L.face, hair: L.hair, gender: L.gender, equips: lookEquipIds(L) });
      await look.load();
      await as.preload(lookCanvases(look, [look.standAction()]));
      return look;
    };
    const [from, to] = await Promise.all([make(d.from), make(d.to)]);
    await as.preload([...allCanvases(ui?.TVon), ...allCanvases(ui?.TVchat1), ...allCanvases(ui?.TVchat2)]);
    if (seq !== this.seq) return;
    this.cur = { ...d, fromLook: from, toLook: to, ui, at: performance.now() };
  }
  clear() { this.seq = (this.seq || 0) + 1; this.cur = null; }
  /** Over each MapleTV NPC's top screen in the map. */
  draw(ctx, cam, map) {
    const c = this.cur, as = this.g.assets;
    if (!c || !map) return;
    const t = performance.now() - c.at;
    for (const e of map.life || []) {
      if (!e.tv) continue;
      const x = Math.round(e.x - cam.x) + e.tv.msg.x, y = Math.round(e.y - cam.y) + e.tv.msg.y;
      const on = frameAt(frames(c.ui?.TVon), t, false), img = on && as.image(on);
      if (img) ctx.drawImage(img, x, y);
      if (t < 18) continue;
      if (c.fromLook) drawParts(ctx, as, c.fromLook.compose(c.fromLook.standAction(), 0), x + 28, y + 77, true);
      if (c.toLook) drawParts(ctx, as, c.toLook.compose(c.toLook.standAction(), 0), x + 213, y + 77, false);
      const bubble = c.type === 1 ? c.ui?.TVchat1 : c.type === 2 ? c.ui?.TVchat2 : null;
      if (bubble) {
        const b = frameAt(frames(bubble), t), bi = b && as.image(b);
        if (bi) { const o = b.origin || [0, 0]; ctx.drawImage(bi, x + (c.type === 1 ? 113 : 119) - o[0], y + 45 - o[1]); }
      }
      c.lines.forEach((l, k) => uiText(ctx, l || '', x + 120, y + 6 + k * 16, { color: '#000', size: 12, align: 'center' }));
    }
  }
}
