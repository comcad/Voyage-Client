import { pad, frames } from '../assets.js';
import { invType, itemInfo } from '../data.js';
import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win, allCanvases, drawTabStrip } from './windows.js';
import { Anim } from '../map.js';
import { richText, drawRich, optionAt, LIGHT_COLORS, QUEST_STATES } from './richtext.js';
import { UI_W, UI_H } from '../view.js';

/**
 * Stage 3 of the v83 in-game UI, drawn on the canvas through the WindowManager:
 *   NpcDialog   UIWindow.img/UtilDlgEx (t / c tiles / s, or it / ic / is for quests)
 *   ShopWin     UIWindow.img/Shop
 *   drawItemTip UIWindow.img/ToolTip/Equip requirement sprites (Can / Cannot)
 */

// ==================================================================== text references
export function textRef(mgr) {
  const g = mgr.game, s = mgr.strings;
  const mapName = (id) => { for (const r of Object.values(s.map || {})) if (r?.[id]) return r[id].mapName; return id; };
  return {
    player: g.player.name, item: (id) => mgr.itemName(id) || '...', icon: (id) => mgr.icon(id),
    mob: (id) => s.mob?.[id]?.name || `monster ${id}`, npc: (id) => s.npc?.[id]?.name || `NPC ${id}`,
    map: mapName, count: (id) => g.itemCount(id), skill: (id) => g.skills?.name(id) ?? '',
    quest: (id) => g.quests?.name(id) ?? '', questState: (id) => QUEST_STATES[g.quests?.status(id) ?? 0],
    kills: (n) => g.quests?.killText(n) ?? '', record: (id) => g.quests?.recordText(id) ?? '', skillIcon: (id) => { const n = g.skills?.icon(id); if (!n) g.skills?.ensure(id)?.then?.(() => { mgr.namesVersion++; }); return n; },
    // #f paths into the UI files we hold (UI/UIWindow.img/..., UI/Basic.img/...)
    image: (path) => {
      const [, file, ...rest] = path.split('/');
      let n = file === 'UIWindow.img' ? mgr.W : file === 'Basic.img' ? mgr.B : null;
      for (const k of rest) n = n?.[k];
      return n?._canvas ? n : null;
    },
  };
}
const scratch = () => document.createElement('canvas').getContext('2d');

/** A text field over the canvas for dialogs (re-placed every frame, as dialogs can move). */
function overlayField(mgr, w, opts) {
  const f = new TextField(mgr.game.statusBar.layer, 0, 0, w, 17, { color: '#fff', ...opts });
  f.el.addEventListener('keydown', (e) => e.stopPropagation());
  return f;
}
function placeField(mgr, f, x, y) {
  f.rect.x = x; f.rect.y = y;
  f.layout({ left: 0, top: 0 }, mgr.game.canvas.clientWidth / UI_W);
}

// ==================================================================== NPC chat
/**
 * UtilDlgEx, 529 wide: t (28) / c (20, every 20px from y 28) / s (58) - it / ic / is when the speaker is you or the
 * dialog names another speaker (speaker bits 2 / 4), which also puts the portrait on the right (x 450) and the text
 * on the left (x 25). The text is Arial 12 on 18px lines, wrapped at 325 inside 8px margins from x 157; the body is
 * the text's height (8 + lines + 8, +24 for a menu, +18 for a say with Prev / Next) kept to 120-240px (taller text
 * scrolls in 8px steps), the window that plus 86. The words type out a letter at a time (a click shows them all);
 * a menu's choices are there at once, the first selected (dot1 and a dashed rule), a click on one picks it, NEXT
 * picks the selected one. The portrait is the NPC's info/default, else its stand animation (its first own action
 * when it has more than two), looping, unscaled, with its name on UtilDlgEx/bar under it. Speaker bit 1 drops
 * END CHAT. The dialog opens where the last one was left (centred on 400, 300 at first).
 * d: { npc, type, speaker, text, prev, next, def, min, max, styles } as sent in NPC_TALK.
 */
const NPC_COLORS = { b: '#0000ff', r: '#ff0000', g: '#00ff00', d: '#51378c' };
const NPC_TEXT = { size: 12, lineH: 18, bullet: 18, colors: NPC_COLORS, imgPad: 2, boldE: false };
const DLG = { w: 529, wrap: 341, margin: 8, minBody: 120, maxBody: 240, typeMs: 30, admin: 9010000 };
const dlgCentre = { x: null, y: null };
export class NpcDialog extends Win {
  constructor(mgr, d, done) {
    const U = mgr.W.UtilDlgEx;
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.U = U; this.d = d; this.done = done; this.modal = true;
    this.closeSound = null;   // answering a line only makes the button's click
    this.mirror = ((d.speaker ?? 0) & 6) !== 0;
    this.F = this.mirror ? { t: U.it, c: U.ic, s: U.is } : { t: U.t, c: U.c, s: U.s };
    this.textX = this.mirror ? 25 : 157; this.faceX = this.mirror ? 450 : 80;
    this.menu = d.type === 4 || d.type === 7;
    this.sel = this.menu ? 0 : -1; this.scroll = 0;
    const input = d.type === 2 || d.type === 3;
    if (input) {
      this.field = overlayField(mgr, 213, { max: d.type === 3 ? 10 : d.max > 0 ? d.max : 30, color: '#000' });
      this.field.value = d.type === 3 ? String(d.def ?? 0) : d.def || '';
    }
    this.relayout();
    this.typed = this.field ? Infinity : 0; this.t0 = performance.now();
    this.w = DLG.w;
    this.x = Math.max(0, Math.min(UI_W - this.w, Math.round((dlgCentre.x ?? UI_W / 2) - this.w / 2)));
    this.y = Math.max(0, Math.min(UI_H - this.h, Math.round((dlgCentre.y ?? UI_H / 2) - this.h / 2)));
    // buttons: replies follow the old DOM dialog (action 1 next/yes/ok, 0 back/no, -1 end)
    const W = DLG.w, end = this.menu || input ? 0 : -1, low = () => this.h - 26, mid = () => this.h - 77;
    const shift = this.mirror ? 130 : 0;
    if (!((d.speaker ?? 0) & 1)) this.closeBtn2 = this.btn(U.BtClose, 9, low, () => this.reply(end));
    if (d.type === 0) {
      if (d.prev) this.btn(U.BtPrev, W - 10 - 122 - shift, mid, () => this.reply(0));
      if (d.next) this.primary = this.btn(U.BtNext, W - 10 - 68 - shift, mid, () => this.reply(1));
      else this.primary = this.btn(U.BtOK, W - 54, low, () => this.reply(1));
    } else if (d.type === 1) { this.btn(U.BtYes, W - 108, low, () => this.reply(1)); this.btn(U.BtNo, W - 54, low, () => this.reply(0)); }
    else if (d.type === 12) { this.btn(U.BtQYes, W - 130, low, () => this.reply(1)); this.btn(U.BtQNo, W - 65, low, () => this.reply(0)); }
    else if (input) this.primary = this.btn(U.BtOK, W - 54, low, () => this.submit());
    else if (this.menu) this.primary = this.btn(U.BtNext, W - 10 - 68 - shift, mid, () => this.pick(this.sel));
    this.portrait();
  }
  btn(node, x, y, fn) { const b = this.button(node, x, 0, fn); b.yAt = y; return b; }
  get words() { return this.d.type === 7 ? `${this.d.text}\n${this.d.styles.map((s, i) => `#L${i}##bStyle ${i + 1}#k#l`).join('\n')}` : this.d.text; }
  /** Lay out the words and size the window round them (kept centred where it was). */
  relayout() {
    const d = this.d, m = DLG.margin;
    this.layout = richText(scratch(), this.words, DLG.wrap - 2 * m, textRef(this.mgr), NPC_TEXT);
    this.laidOut = this.mgr.namesVersion;
    this.opts = [...new Set(this.layout.lines.filter((l) => l.opt !== null && l.opt !== undefined).map((l) => l.opt))];
    // only the words before the first picture type out: from a picture on (a quest's REWARD block) it shows at once
    const pic = this.layout.lines.findIndex((l) => l.runs.some((r) => r.img));
    this.typedLines = pic < 0 ? this.layout.lines.length : pic;
    this.chars = this.layout.lines.slice(0, this.typedLines).reduce((n, l) => n + (l.opt !== null && l.opt !== undefined ? 0 : l.runs.reduce((k, r) => k + (r.t ? r.t.length : 0), 0)), 0);
    let textH = m + this.layout.height + m + (this.menu ? 24 : 0) + (d.type === 0 && (d.prev || d.next) ? 18 : 0) + (this.field ? 26 : 0);
    this.textH = textH;
    this.scrolls = textH > DLG.maxBody && textH - DLG.maxBody > 8;
    this.bodyH = this.scrolls ? DLG.maxBody : Math.max(textH, DLG.minBody);
    if (this.scrolls) textH = this.bodyH;
    const cx = this.x + (this.w || DLG.w) / 2, cy = this.y + (this.h || 0) / 2, had = !!this.h;
    this.h = this.bodyH + 86;
    this.textY = this.scrolls ? 22 : 28 + Math.trunc((this.bodyH - textH - 6) / 2);
    this.dragH = this.textY;
    if (had) { this.x = Math.round(cx - this.w / 2); this.y = Math.max(0, Math.min(UI_H - this.h, Math.round(cy - this.h / 2))); }
  }
  /** info/default, else the stand animation - or its first own action when it has more than two; you when you speak. */
  async portrait() {
    const a = this.mgr.assets, d = this.d;
    this.name = (d.speaker & 2) ? this.g.player?.name : this.mgr.strings.npc?.[d.npc]?.name;
    if (d.speaker & 2) { this.avatar = true; return; }
    let n = await a.json(`Npc/${pad(d.npc, 7)}.img`) || await a.json(`Npc/${pad(DLG.admin, 7)}.img`);
    if (n?.info?.link) n = (await a.json(`Npc/${pad(n.info.link, 7)}.img`)) || n;
    if (!n) return;
    const framesOf = (act) => frames(act).filter((f) => f?._canvas);
    let list;
    if (n.info?.default?._canvas) list = [n.info.default];
    else {
      const extras = Object.keys(n).filter((k) => !['info', 'stand', 'move', 'hide'].includes(k) && !/^\d+$/.test(k) && framesOf(n[k]).length);
      list = framesOf(extras.length > 2 ? n[extras[0]] : n.stand);
      if (!list.length && n.stand?._canvas) list = [n.stand];
    }
    if (!list.length) return;
    await a.preload(list);
    this.face = list;
  }
  frames() { const U = this.U; return [...allCanvases(this.F), U.dot0, U.dot1, U.bar, U.list0, U.list1, U.list2, U.list3, ...this.buttons.flatMap((b) => b.frames())]; }
  reply(action, sel) { this.close(); this.done({ action, sel }); }
  pick(o) { if (o === null || o === undefined || o < 0) return; sfx.play('UI/BtMouseClick'); this.reply(1, this.opts[o] ?? o); }
  submit() {
    const v = this.field.value;
    if (this.d.type === 3) this.reply(1, Math.max(this.d.min, Math.min(this.d.max, Number(v) || 0)));
    else this.reply(1, v);
  }
  close() { this.field?.remove(); dlgCentre.x = this.x + this.w / 2; dlgCentre.y = this.y + this.h / 2; this.mgr.close(this); }
  key(e) {
    if (e.key === 'Escape') { if (this.closeBtn2) this.closeBtn2.onClick(); }
    else if (e.key === 'Enter') { if (this.field) this.submit(); else this.primary?.onClick(); }
  }
  /** Up / Down move the selected choice. */
  keys(e) {
    if (!this.menu || !this.opts.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return false;
    if (e.type !== 'keydown') return true;
    this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.opts.length) % this.opts.length;
    this.keepInView();
    return true;
  }
  /** Scroll (8px steps) so the selected choice shows. */
  keepInView() {
    if (!this.scrolls) return;
    const l = this.layout.lines.find((x) => x.opt === this.opts[this.sel]);
    if (!l) return;
    const top = DLG.margin + l.y + 10, bot = top + l.h, view = this.bodyH - 2;
    if (top - this.scroll * 8 < 0) this.scroll = Math.floor(top / 8);
    else if (bot - this.scroll * 8 > view) this.scroll = Math.ceil((bot - view) / 8);
  }
  get maxScroll() { return this.scrolls ? Math.ceil((this.textH - this.bodyH) / 8) + 1 : 0; }
  wheel(dy) { if (this.scrolls) this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + Math.sign(dy))); }
  draw(ctx) {
    if (this.laidOut !== this.mgr.namesVersion) this.relayout();
    if (this.typed < this.chars) this.typed = Math.floor((performance.now() - this.t0) / DLG.typeMs);
    for (const b of this.buttons) b.y = b.yAt();
    super.draw(ctx);
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n);
    const t = im(this.F.t), c = im(this.F.c), s = im(this.F.s);
    if (!t || !c || !s) return;
    ctx.drawImage(t, 0, 0);
    for (let y = 28; y < this.h - 58; y += 20) ctx.drawImage(c, 0, y);
    ctx.drawImage(s, 0, this.h - 58);
    this.drawFace(ctx);
    // the words, clipped to the text box
    ctx.save(); ctx.beginPath(); ctx.rect(this.textX + 1, this.textY + 1, 339, this.bodyH - 2); ctx.clip();
    this.drawText(ctx, this.textX + DLG.margin, this.textY + DLG.margin - this.scroll * 8);
    ctx.restore();
    if (this.scrolls) this.scrollbar(ctx, this.textX + 338, this.textY + 2, this.bodyH + 3, this.scroll, this.maxScroll + Math.floor(this.bodyH / 8), Math.floor(this.bodyH / 8));
    if (this.field) {
      const fy = this.textY + this.textH - 26 + 2;
      ctx.fillStyle = '#000'; ctx.fillRect(this.textX - 1, fy, 218, 18);
      ctx.fillStyle = '#fff'; ctx.fillRect(this.textX, fy + 1, 216, 16);
      placeField(m, this.field, this.x + this.textX + 2, this.y + fy + 3);
      if (!this.focused) { this.focused = true; setTimeout(() => this.field.focus(), 0); }
    }
  }
  /** The NPC (looping, unscaled) with its name bar under it: centred in the body, or sat on the band when taller. */
  drawFace(ctx) {
    const m = this.mgr, bar = m.image(this.U.bar);
    let h = 0, draw = null;
    if (this.avatar && this.g.look) {
      h = 70;
      draw = (top) => drawParts(ctx, m.assets, this.g.look.compose(this.g.look.standAction(), 0), this.faceX - 7, top + h, false);
    } else if (this.face?.length) {
      const total = this.face.reduce((n, f) => n + (Number(f.delay) || 180), 0);
      let tt = performance.now() % total, f = this.face[0];
      for (const x of this.face) { f = x; if ((tt -= Number(x.delay) || 180) < 0) break; }
      const f0 = this.face[0], i0 = m.image(f0), img = m.image(f);
      if (!i0 || !img) return;
      h = i0.height;
      const o0 = f0.origin || [i0.width / 2, i0.height], o = f.origin || [img.width / 2, img.height];
      draw = (top) => ctx.drawImage(img, Math.round(this.faceX - i0.width / 2 + o0[0] - o[0]), Math.round(top + o0[1] - o[1]));
    }
    const total = h + 23;
    const top = this.bodyH >= total ? Math.trunc((this.bodyH - total) / 2) + 28 : this.h - total - 62;
    const barY = this.bodyH >= total ? top + h : this.h - total - 52 + h;
    draw?.(top);
    if (!this.name) return;
    const bx = this.faceX - 60;
    if (bar) ctx.drawImage(bar, bx + Math.trunc((121 - bar.width) / 2), barY + 3);
    ctx.save(); ctx.beginPath(); ctx.rect(bx, barY, 121, 23); ctx.clip();
    uiText(ctx, this.name, this.faceX + 0.5, barY + 5, { color: '#fff', size: 12, align: 'center' });
    ctx.restore();
  }
  /** Typed so far: plain words up to the cursor; choices (and their dots) at once; the selected one dashed. */
  drawText(ctx, x, y) {
    const m = this.mgr, im = (n) => m.image(n);
    let left = this.typed;
    const all = this.typed >= this.chars;
    this.layout.lines.forEach((l, li) => {
      const opt = l.opt !== null && l.opt !== undefined, ly = y + l.y + (opt ? 10 : 0), bottom = ly + l.h - 2;
      if (opt && l.x0) {
        const on = this.opts.indexOf(l.opt) === this.sel || l.opt === this.hoverOpt;
        const dot = im(on ? this.U.dot1 : this.U.dot0);
        if (dot) ctx.drawImage(dot, x + 7, ly + 2);
        if (this.opts.indexOf(l.opt) === this.sel) {
          ctx.font = `${NPC_TEXT.size}px Arial, sans-serif`;
          const end = Math.max(...l.runs.map((r) => r.x + (r.t ? ctx.measureText(r.t).width : r.icon ? 34 : 0)), l.x0);
          const w = end - l.x0, n = Math.trunc((Math.trunc((w + 8) / 3) + 1) / 2);
          ctx.fillStyle = '#8c8c8c';
          for (let k = 0; k < n; k++) ctx.fillRect(x + l.x0 - 4 + k * 6, ly + 15, 3, 1);
        }
      }
      for (const r of l.runs) {
        // pictures (section titles, item icons) are there from the start; only the words type out
        if (r.img) { const i = im(r.img); if (i) ctx.drawImage(i, x + r.x, bottom - i.height); continue; }
        if (r.icon) { m.drawIcon(ctx, r.icon, x + r.x, bottom - 32); continue; }
        let t = r.t;
        if (!opt && !all && li < this.typedLines) { if (left <= 0) continue; if (t.length > left) t = t.slice(0, left); left -= r.t.length; }
        // on a whole-pixel baseline: a 'top' baseline lands glyph edges between pixels and greys out their tops
        uiText(ctx, t, Math.round(x + r.x), bottom - 4, { color: r.color, bold: r.bold, size: NPC_TEXT.size, base: 'alphabetic' });
      }
    });
  }
  optAt(lx, ly) {
    const px = lx - this.textX - DLG.margin, py = ly - this.textY - DLG.margin + this.scroll * 8;
    for (const l of this.layout.lines) {
      if (l.opt === null || l.opt === undefined) continue;
      if (py >= l.y + 10 && py < l.y + 10 + l.h && px >= -2 && px < DLG.wrap) return l.opt;
    }
    return null;
  }
  move(lx, ly) { this.hoverOpt = this.menu ? this.optAt(lx, ly) : null; }
  down(lx, ly) {
    if (this.typed < this.chars) { this.typed = this.chars; this.t0 = -Infinity; }
    const o = this.menu ? this.optAt(lx, ly) : null;
    if (o !== null) { this.sel = this.opts.indexOf(o); this.pick(this.sel); }
  }
}

/** Shows a server NPC_TALK and resolves with { action, sel } once the player answers. */
export function npcTalk(mgr, d) {
  return new Promise((resolve) => mgr.show(new NpcDialog(mgr, d, resolve), null));   // opens without the dialog alert
}

/**
 * A dialog the client itself drives (quests): buttons are labels like the old DOM version used:
 * 'Next' / 'Prev' / 'OK' / 'Accept' / 'Decline' / 'Yes' / 'No' / 'End Chat'. Resolves with the label.
 */
export async function localTalk(mgr, npcId, text, buttons) {
  const has = (b) => buttons.includes(b);
  const d = { npc: npcId, text, type: has('Accept') ? 12 : has('Yes') ? 1 : 0, prev: has('Prev'), next: has('Next') };
  const r = await npcTalk(mgr, d);
  if (r.action === -1) return 'End Chat';
  if (d.type === 12) return r.action === 1 ? 'Accept' : 'Decline';
  if (d.type === 1) return r.action === 1 ? 'Yes' : 'No';
  if (r.action === 0) return 'Prev';
  return d.next ? 'Next' : (buttons.find((b) => b !== 'End Chat') || 'OK');
}

/**
 * A menu of choices in the NPC dialog (#L options); resolves with the chosen index or null.
 * An option { header } is a section title image (a #f path) instead of a choice.
 */
export async function npcMenu(mgr, npcId, text, options) {
  const body = `${text}\n${options.map((o, i) => (o.header ? `#f${o.header}#` : `#L${i}#${o}#l`)).join('\n')}`;
  const r = await npcTalk(mgr, { npc: npcId, type: 4, text: body });
  return r.action === 1 ? r.sel : null;
}

// ==================================================================== pet select
/**
 * Choosing one of your pets: UIWindow.img/UtilDlgEx_Pet (419x297) centred on (400, 300). The text is 280 wide at x 110,
 * centred in a 100px body from y 28. The pet stands (stand0) with its feet at (209, 218) over UtilDlgEx_Avatar/nameTag,
 * its name in white 12px Arial centred on x 210, y 224, its level and closeness in black centred on x 194 / 280, y 243.
 * UtilDlgEx_Avatar BtPrev / BtNext go round the pets; Basic BtOK2 / BtCancel2. Resolves with the pet's index or null.
 * pets: [{ name, level, closeness, stand }].
 */
export class PetSelectDialog extends Win {
  constructor(mgr, text, pets, done) {
    const A = mgr.W.UtilDlgEx_Avatar, B = mgr.B;
    super(mgr, mgr.W.UtilDlgEx_Pet.backgrnd, (UI_W >> 1) - 209, (UI_H >> 1) - 148);
    this.buttons = [];
    this.A = A; this.pets = pets; this.done = done; this.modal = true; this.sel = 0; this.t0 = performance.now();
    this.layout = richText(scratch(), text, 280, textRef(mgr), NPC_TEXT);
    this.textY = 28 + (this.layout.height > 100 ? -6 : Math.trunc((100 - this.layout.height - 6) / 2));
    const turn = (d) => { this.sel = (this.sel + d + pets.length) % pets.length; this.t0 = performance.now(); };
    this.button(A.BtPrev, 15, 187, () => turn(-1));
    this.button(A.BtNext, 340, 187, () => turn(1));
    this.button(B.BtOK2, 307, 270, () => this.finish(this.sel));
    this.button(B.BtCancel2, 358, 270, () => this.finish(null));
  }
  frames() { return [...super.frames(), this.A.nameTag, ...this.pets.flatMap((p) => frames(p.stand))]; }
  finish(i) { this.mgr.close(this); this.done(i); }
  key(e) { if (e.key === 'Enter') this.finish(this.sel); else if (e.key === 'Escape') this.finish(null); }
  body(ctx) {
    const m = this.mgr, p = this.pets[this.sel];
    drawRich(ctx, this.layout, 110, this.textY, { size: NPC_TEXT.size, drawIcon: (n, x, y) => m.drawIcon(ctx, n, x, y) });
    const fr = frames(p.stand), total = fr.reduce((t, f) => t + (f.delay || 120), 0);
    let t = total ? (performance.now() - this.t0) % total : 0, f = fr[0];
    for (const x of fr) { f = x; if ((t -= x.delay || 120) < 0) break; }
    const img = f && m.image(f), tag = m.image(this.A.nameTag);
    if (img) { const o = f.origin || [img.width / 2, img.height]; ctx.drawImage(img, 209 - o[0], 218 - o[1]); }
    if (tag) ctx.drawImage(tag, 124, 219);
    uiText(ctx, p.name || '', 210, 224, { color: '#fff', size: 12, align: 'center' });
    uiText(ctx, String(p.level), 194, 243, { color: '#000', size: 12, align: 'center' });
    uiText(ctx, String(p.closeness), 280, 243, { color: '#000', size: 12, align: 'center' });
  }
}

// ==================================================================== notices
/**
 * The death notice at (257, 97), its words in the art. 'ok' (UIWindow.img/Notice/0): "PRESS OK TO BE REVIVED. Once
 * you have revived, you will be sent to a safe town nearby." with Basic BtOK2 at (124, 115). 'wheel' (Notice/2): "The
 * power from the Wheel of Destiny can revive you in your current map." with BtYes2 at (92, 115) and BtNo2 at
 * (148, 115). 'cafe' (Notice/1): playing from an Internet café, revive here, with the same Yes and No. done(yes): Yes
 * is true (revive here), OK and No false (the town). It takes no keys: the mouse answers.
 */
export class DeathNotice extends Win {
  constructor(mgr, kind, done) {
    super(mgr, mgr.W.Notice[kind === 'wheel' ? 2 : kind === 'cafe' ? 1 : 0], 257 + ((UI_W - 800) >> 1), 97 + ((UI_H - 600) >> 1));
    // an ordinary window: the rest of the screen (chat, windows) still works while you're dead; Esc leaves it
    this.done = done; this.keepOnEscape = true;
    this.closeBtn.visible = false;
    if (kind === 'wheel' || kind === 'cafe') {
      this.button(mgr.B.BtYes2, 92, 115, () => this.finish(true));
      this.button(mgr.B.BtNo2, 148, 115, () => this.finish(false));
    } else this.button(mgr.B.BtOK2, 124, 115, () => this.finish(false));
  }
  finish(wheel = false) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(wheel); }
}

/**
 * The plain message box (Basic.img YesNo3: t 21, c 20 tiled, s 55, 266 wide, centred) with Basic BtOK2 at x 155 and
 * BtCancel2 at 205, 30px off the bottom; every notice, question and server pop-up uses it. 'okcancel': the lines centred, 14px apart, over at least two body tiles; 'okcancelLeft':
 * the lines as given (leading spaces kept), left-aligned at x 19 from y 24.
 * 'quantity': the prompt at the top left and a white 226x15 field 73px off the bottom.
 * 'text': the same field for a name or a line. 'whisper': the same with a ComboBox whose list holds the names you whispered.
 */
export class UtilBox extends Win {
  constructor(mgr, kind, text, done, opts = {}) {
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.modal = true; this.kind = kind; this.done = done; this.opts = opts;
    const field = kind === 'quantity' || kind === 'whisper' || kind === 'text';
    // centred lines take item names (#t), colours and \r\n breaks; each is trimmed so it centres on its words
    this.centred = !field && kind !== 'okcancelLeft';
    this.lines = kind === 'okcancelLeft' ? text.split('\n')
      : this.centred ? richText(scratch(), text, 234, textRef(mgr), { base: '#fff', colors: LIGHT_COLORS, size: 12, lineH: 14 }).lines
        : wrapText(scratch(), text, 234, 12);
    const n = this.lines.length;
    // centred lines stack by their own height (a line with an item icon is taller)
    this.textH = this.centred ? this.lines.reduce((t, l) => t + (l.h || 14), 0) : n * 14;
    this.tiles = Math.max(2, Math.floor(this.textH / 20) + 1);
    this.w = 266; this.h = field ? 121 + (n - 1) * 14 : 21 + this.tiles * 20 + 55;
    this.x = (UI_W - this.w) >> 1; this.y = (UI_H - this.h) >> 1;
    // 'ok': a notice with OK alone, where Cancel would be
    this.button(mgr.B.BtOK2, kind === 'ok' ? 205 : 155, this.h - 30, () => this.finish(true));
    if (kind !== 'ok') this.button(mgr.B.BtCancel2, 205, this.h - 30, () => this.finish(false));
    if (kind === 'quantity') {
      this.field = overlayField(mgr, 226, { max: 10, color: '#000' });
      this.field.rect.h = 15; this.field.value = String(opts.def ?? 1);
    }
    if (kind === 'text') {
      this.field = overlayField(mgr, 222, { max: opts.max || 13, color: '#000' });
      this.field.rect.h = 15; this.field.value = opts.def || '';
    }
    if (kind === 'whisper') {
      this.field = overlayField(mgr, 205, { max: 13, color: '#000' });
      this.field.rect.h = 15; this.field.value = opts.def || '';
      this.names = opts.names || []; this.listOpen = false;
    }
  }
  frames() { return [...allCanvases(this.mgr.B.YesNo3), ...allCanvases(this.mgr.B.ComboBox?.normal), ...super.frames()]; }
  finish(ok) {
    if (this.answered) return;
    // too short (opts.minLen): say so and keep the box open
    if (ok && this.kind === 'text' && this.opts.minLen && this.field.value.trim().length < this.opts.minLen) {
      this.mgr.notice(`Please enter at least ${this.opts.minLen} characters.`).then(() => this.field.focus());
      return;
    }
    this.answered = true; this.field?.remove(); this.mgr.close(this);
    if (this.kind === 'whisper' || this.kind === 'text') { const v = this.field.value.trim(); this.done(ok && (v || this.opts.empty) ? v : null); return; }
    if (this.kind !== 'quantity') { this.done(ok); return; }
    const v = Math.floor(Number(this.field.value));
    this.done(ok && Number.isFinite(v) ? Math.max(this.opts.min ?? 1, Math.min(this.opts.max ?? v, v)) : null);
  }
  key(e) { if (e.key === 'Enter') this.finish(true); else if (e.key === 'Escape') this.finish(false); }
  body(ctx) {
    const m = this.mgr, F = m.B.YesNo3, t = m.image(F.t), c = m.image(F.c), s = m.image(F.s);
    if (!t || !c || !s) return;
    ctx.drawImage(t, 0, 0);
    for (let y = 21; y < this.h - 55; y += 20) ctx.drawImage(c, 0, y);
    ctx.drawImage(s, 0, this.h - 55);
    const line = (str, x, y, align) => uiText(ctx, str, x, y + 11, { color: '#fff', size: 12, base: 'alphabetic', align });
    if (this.kind === 'okcancelLeft') { this.lines.forEach((l, i) => line(l, 19, 24 + i * 14, 'left')); return; }
    if (this.centred) {
      const top = (this.tiles * 20 - this.textH) / 2 + 24;
      ctx.save(); ctx.font = '12px Arial, sans-serif';
      this.lines.forEach((l) => {
        const runs = l.runs.filter((r) => r.t || r.icon);
        while (runs.length && runs[runs.length - 1].t !== undefined && !runs[runs.length - 1].t.trim()) runs.pop();
        const last = runs[runs.length - 1], end = last ? last.x + (last.icon ? 32 : ctx.measureText(last.t).width) : 0;
        const x0 = Math.round(132 - end / 2), h = l.h || 14, y = top + (l.y ?? 0);
        for (const r of runs) {
          if (r.icon) m.drawIcon(ctx, r.icon, x0 + r.x, y + Math.round((h - 32) / 2));
          else uiText(ctx, r.t, x0 + r.x, y + Math.round((h - 14) / 2) + 11, { color: r.color, bold: r.bold, size: 12, base: 'alphabetic' });
        }
      });
      ctx.restore();
      return;
    }
    this.lines.forEach((l, i) => line(l, 19, 28 + i * 14, 'left'));
    const fy = this.h - 73;
    if (this.kind === 'whisper') this.drawCombo(ctx);
    else {
      ctx.fillStyle = '#000'; ctx.fillRect(18, fy - 1, 228, 17);
      ctx.fillStyle = '#fff'; ctx.fillRect(19, fy, 226, 15);
    }
    placeField(m, this.field, this.x + (this.kind === 'whisper' ? 21 : 19), this.y + fy);
    if (!this.focused) { this.focused = true; setTimeout(() => { this.field.focus(); this.field.el.select(); }, 0); }
  }
}

/** UtilBox 'whisper': Basic.img/ComboBox (left, tiled middle, the arrow on the right) and its list of names. */
UtilBox.prototype.comboRect = function comboRect() { return { x: 18, y: this.h - 74, w: 228, h: 17 }; };
UtilBox.prototype.drawCombo = function drawCombo(ctx) {
  const m = this.mgr, C = m.B.ComboBox?.normal, r = this.comboRect();
  const l = m.image(C?.[0]), c = m.image(C?.[1]), e = m.image(C?.[2]);
  if (l && c && e) { ctx.drawImage(l, r.x, r.y); ctx.drawImage(c, r.x + l.width, r.y, r.w - l.width - e.width, r.h); ctx.drawImage(e, r.x + r.w - e.width, r.y); }
  else { ctx.fillStyle = '#fff'; ctx.fillRect(r.x, r.y, r.w, r.h); }
  if (!this.listOpen || !this.names.length) return;
  const hover = this.rowAt(m.mouse.x - this.x, m.mouse.y - this.y);
  this.names.forEach((n, i) => {
    const y = r.y + r.h + i * 15;
    ctx.fillStyle = i === hover ? '#d4e6ff' : '#fff'; ctx.fillRect(r.x, y, r.w, 15);
    uiText(ctx, n, r.x + 4, y + 2, { color: '#000', size: 12 });
  });
  ctx.strokeStyle = '#7d8a96'; ctx.strokeRect(r.x + 0.5, r.y + r.h + 0.5, r.w - 1, this.names.length * 15 - 1);
};
UtilBox.prototype.rowAt = function rowAt(lx, ly) {
  const r = this.comboRect(), i = Math.floor((ly - r.y - r.h) / 15);
  return this.listOpen && lx >= r.x && lx < r.x + r.w && i >= 0 && i < this.names.length ? i : -1;
};
UtilBox.prototype.down = function down(lx, ly) {
  if (this.kind !== 'whisper') return;
  const r = this.comboRect(), row = this.rowAt(lx, ly);
  if (row >= 0) { this.field.value = this.names[row]; this.listOpen = false; this.field.focus(); return; }
  this.listOpen = lx >= r.x + r.w - 18 && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h ? !this.listOpen : false;
};

// ==================================================================== shop
/**
 * Shop.img backgrnd 463x339: the NPC's goods (left) and your items (right), five rows each. The art already holds
 * the row cells and their rules and the meso box's coin. Drawn taller here: one row band (y 205-245) repeats
 * EXTRA times, so 9 rows show. Rows are 40px apart from y 127: a 35px icon cell, then the text cell where
 * Shop/select marks the choice.
 */
const SHOP_EXTRA = 4, SHOP_ROWS = 5 + SHOP_EXTRA, SHOP_ROW_Y = 127, SHOP_ROW_H = 40;
const SHOP_W = 463, SHOP_H = 339 + SHOP_EXTRA * SHOP_ROW_H, SHOP_CUT = 245, SHOP_BAND = 205;
const SHOP_TAB_Y = 95, SHOP_BAR_H = 194 + SHOP_EXTRA * SHOP_ROW_H;
const SELL_TABS = 5, PERFECT_PITCH = 4310000;
const STOCK = "You don't have enough in stock.", NO_MESOS = 'You do not have enough mesos.';
const SHOP_RESULTS = {
  1: STOCK, 5: STOCK, 9: STOCK, 2: NO_MESOS, 10: NO_MESOS, 3: 'Please check if your inventory is full or not.', 0x0D: 'You need more items',
  0x10: 'Players that are Level 15 and below \nmay only trade 1 million mesos per day. \nYou have reached the limit today,\nplease try again tomorrow.',
};
const isRechargeable = (id) => [207, 233].includes(Math.floor(id / 10000));
// Use / Set-up / Etc items other than stars and bullets: these ask how many
const isStackable = (id) => [2, 3, 4].includes(invType(id)) && !isRechargeable(id);
const commas = (n) => n.toLocaleString('en-US');
/** An item name cut to the row's 152px, ending in "..". */
function rowName(ctx, s) {
  ctx.save(); ctx.font = '12px Arial, "Segoe UI", sans-serif';
  if (ctx.measureText(s).width > 152) { while (s && ctx.measureText(`${s}..`).width > 152) s = s.slice(0, -1); s += '..'; }
  ctx.restore();
  return s;
}
export class ShopWin extends Win {
  constructor(mgr, shop) {
    const S = mgr.W.Shop;
    super(mgr, null, (UI_W - SHOP_W) >> 1, (UI_H - SHOP_H) >> 1);
    this.w = SHOP_W; this.h = SHOP_H; this.keepOnEscape = true;
    this.buttons = [];
    this.S = S; this.shop = shop; this.tab = 1; this.buyTab = 0; this.buyFirst = [0, 0];
    this.firstSell = 0; this.selBuy = -1; this.selSell = -1; this.pending = false;
    // goods with neither a meso nor a Perfect Pitch price (stars kept only to recharge) aren't listed
    this.all = shop.items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.price || it.token);
    this.must = [];
    this.button(mgr.W.PersonalShop.BtExit, 142, 15, () => this.close());
    this.button(S.BtBuy, 142, 35, () => this.buy());
    this.button(S.BtSell, 372, 35, () => this.sell());
    this.rechargeBtns = Array.from({ length: SHOP_ROWS }, (_, i) => {
      const b = this.button(S.BtRecharge, 404, SHOP_ROW_Y + i * SHOP_ROW_H, () => { this.selSell = this.firstSell + i; this.selBuy = -1; this.recharge(); });
      b.visible = false;
      return b;
    });
    mgr.assets.json(`Npc/${pad(shop.npc, 7)}.img`).then(async (n) => {
      if (n?.info?.link) n = (await mgr.assets.json(`Npc/${pad(n.info.link, 7)}.img`)) || n;
      const anim = n?.stand ? new Anim(n.stand) : null;
      if (!anim?.frames.length) return;
      anim.defaultDelay = 180;
      await mgr.assets.preload(anim.frames);
      this.npc = anim; this.npcT = performance.now();
    });
    // Must: the equips that suit you; when there are any the shop opens on them
    Promise.all(shop.items.map((it) => itemInfo(mgr.assets, it.id).then((info) => { it.info = info; }))).then(() => {
      this.must = this.all.filter(({ it }) => this.suits(it));
      if (this.must.length) this.buyTab = 1;
    });
  }
  frames() { return [...super.frames(), this.S.backgrnd, this.S.select, this.S.meso, this.S.token, ...allCanvases(this.S.TabSell), ...allCanvases(this.S.TabBuy), ...allCanvases(this.mgr.B.Tab2)]; }
  close() { this.mgr.close(this); this.g.net?.shopClose(); this.g.shopWin = null; }
  key() {}   // Esc and Enter do nothing here
  ask(text) { return new Promise((r) => this.mgr.show(new UtilBox(this.mgr, 'okcancel', text, r))); }
  askQty(text, def, min, max) { return new Promise((r) => this.mgr.show(new UtilBox(this.mgr, 'quantity', text, r, { def, min, max }))); }
  /** Shop text: 12px black, `y` the top of its line as the client places it (the baseline 11px below). */
  rowText(ctx, t, x, y, align = 'left') { this.text(ctx, t, x, y + 11, { size: 12, base: 'alphabetic', align }); }
  /** Your stand pose, played forward and back as in the field. */
  standFrame(look, dt) {
    const a = look.standAction();
    if (this.av?.look !== look || this.av.action !== a) this.av = { look, action: a, frame: 0, back: false, t: 0 };
    const v = this.av;
    v.t += dt;
    while (v.t >= look.delay(a, v.frame)) { v.t -= look.delay(a, v.frame); ({ frame: v.frame, back: v.back } = look.nextFrame(a, v.frame, v.back)); }
    return [a, v.frame];
  }
  get open() { return this.g.shopWin === this; }

  /** An equip for mesos within 5 levels of yours, for your job branch (or any job) and gender. */
  suits(it) {
    const s = this.g.stats, info = it.info;
    if (!s || !info || invType(it.id) !== 1 || it.token) return false;
    if (Math.abs(s.level - (info.reqLevel || 0)) > 5) return false;
    const job = info.reqJob || 0, branch = Math.floor((s.job % 1000) / 100);
    if (job && !(branch && (job & (1 << (branch - 1))))) return false;
    const g = Math.floor(it.id / 1000) % 10, gender = g < 2 ? g : 2;
    return s.gender === 2 || gender === 2 || gender === s.gender;
  }
  buyItems() { return this.buyTab === 1 ? this.must : this.all; }
  get firstBuy() { return this.buyFirst[this.buyTab]; }
  set firstBuy(v) { this.buyFirst[this.buyTab] = v; }
  /**
   * Your items of one inventory type that the shop takes (not quest, notSale or cash ones), each with what it
   * sells for and, for stars and bullets this shop recharges, the price of topping the stack up.
   */
  sellItems(type = this.tab) {
    const inv = this.g.inventory?.[type] || {}, out = [];
    for (const [pos, it] of Object.entries(inv).sort((a, b) => a[0] - b[0])) {
      const info = this.mgr.info(it.id);
      if (!info || Number(info.quest) || Number(info.notSale) || Number(info.cash) || it.cash) continue;
      const qty = it.quantity ?? 1, s = isRechargeable(it.id) && this.shop.items.find((x) => x.id === it.id && x.recharge);
      out.push({ pos: Number(pos), it, qty, price: (info.price || 0) + Math.ceil(qty * (info.unitPrice || 0)), recharge: s ? Math.ceil((s.max - qty) * s.unitPrice) : 0 });
    }
    return out;
  }

  async buy() {
    const e = this.buyItems()[this.selBuy];
    if (!e || this.pending) return;
    const { it, idx } = e, m = this.mgr, lv = this.g.stats?.level ?? 0, limit = it.levelLimit || 0;
    if (it.price && it.token) return;
    if (limit < 0 && lv > -limit) { m.notice(`You must be under lv.${-limit} to purchase this item`); return; }
    if (limit > 0 && lv < limit) { m.notice(`You must be over lv.${limit} to purchase this item`); return; }
    const timed = it.period ? 'This is a time-restricted item\n' : '';
    let qty = 1;
    if (!it.price) {
      const have = this.g.itemCount(PERFECT_PITCH), name = m.itemName(PERFECT_PITCH);
      if (!(await this.ask(`${timed}Are you sure you want to purchase?\nYou currently have ${have} ${name}`))) return;
      if (it.token < 1 || have < it.token) { m.notice(`You need ${it.token - have} more ${name}(s)`); return; }
    } else {
      if (isStackable(it.id) && it.quantity < 2) {
        qty = await this.askQty(`${timed}How many are you willing to buy?`, 1, 1, it.max);
        if (!qty || qty < 1 || qty > it.max) return;
      } else if (!(await this.ask(`${timed}Are you sure you want to buy it?`))) return;
      const cost = it.price * qty;
      if (cost <= 0 || cost > this.g.meso) { m.notice(NO_MESOS); return; }
    }
    if (this.pending || !this.open) return;
    this.g.net?.shopBuy(idx, it.id, qty, it.price);
    this.pending = true;
    // to find the new stack once the purchase lands
    const type = invType(it.id);
    this.bought = { type, before: this.sellItems(type) };
  }
  async sell() {
    const r = this.sellItems()[this.selSell];
    if (!r || this.pending) return;
    const { pos, it, qty } = r, m = this.mgr;
    if (it.flag & 1) { m.notice('Sealed items cannot be\r\nsold, traded, or dropped.'); return; }
    let n = 1;
    if (isStackable(it.id)) {
      n = await this.askQty('How many are you willing to sell?', qty, 1, qty);
      if (!n || n < 1 || n > qty) return;
    } else if (!(await this.ask('Are you sure you want to sell it?'))) return;
    if (this.pending || !this.open || this.g.inventory?.[invType(it.id)]?.[pos] !== it) return;
    this.g.net?.shopSell(pos, it.id, n);
    this.pending = true;
  }
  async recharge() {
    const r = this.sellItems()[this.selSell];
    if (!r || this.pending || !r.recharge) return;
    if (!(await this.ask('Are you sure you want to recharge it?'))) return;
    if (this.pending || !this.open || this.g.inventory?.[invType(r.it.id)]?.[r.pos] !== r.it) return;
    this.g.net?.shopRecharge(r.pos);
    this.pending = true;
  }
  /** CONFIRM_SHOP_TRANSACTION, only while a request is out. */
  result(code, extra) {
    if (!this.pending) return;
    this.pending = false;
    if (code === 0) { this.showBought(); return; }
    if (code === 4 || code === 8) return;
    let msg = SHOP_RESULTS[code];
    if (code === 0x0E) msg = `You must be under lv.${-extra} to purchase this item`;
    else if (code === 0x0F) msg = `You must be over lv.${extra} to purchase this item`;
    else if (code === 0x11 && extra) msg = extra;
    this.mgr.notice(msg || 'Due to an error, the trade did not happen.');
  }
  /** After a purchase: open its tab on your side and select the stack that changed. */
  showBought() {
    const b = this.bought;
    this.bought = null;
    if (!b || b.type < 1 || b.type > SELL_TABS) return;
    this.tab = b.type;
    const now = this.sellItems(), same = (x, y) => x.it.id === y.it.id && x.pos === y.pos && x.qty === y.qty;
    const n = Math.min(now.length, b.before.length);
    let i = 0;
    while (i < n && same(now[i], b.before[i])) i++;
    if (i === n) i = now.length === b.before.length ? 0 : now.length < b.before.length ? i - 1 : i;
    if (i < this.firstSell) this.firstSell = i;
    if (i > this.firstSell + SHOP_ROWS - 1) this.firstSell = i - SHOP_ROWS + 1;
    this.selSell = i;
  }

  /** Rows answer clicks over the select image's width from the icon cell (x 6 / 236), 35px tall. */
  rowAt(lx, ly, left) {
    const x0 = left ? 6 : 236;
    if (lx < x0 || lx >= x0 + 162 || ly < SHOP_ROW_Y) return -1;
    const i = Math.floor((ly - SHOP_ROW_Y) / SHOP_ROW_H);
    if (i >= SHOP_ROWS || (ly - SHOP_ROW_Y) % SHOP_ROW_H >= 35) return -1;
    const idx = (left ? this.firstBuy : this.firstSell) + i;
    return idx < (left ? this.buyItems().length : this.sellItems().length) ? idx : -1;
  }
  /** The art, five rows tall, stretched to SHOP_ROWS by repeating one row band. */
  drawFrame(ctx) {
    const bg = this.mgr.image(this.S.backgrnd);
    if (!bg) return;
    ctx.drawImage(bg, 0, 0, SHOP_W, SHOP_CUT, 0, 0, SHOP_W, SHOP_CUT);
    for (let j = 0; j < SHOP_EXTRA; j++) ctx.drawImage(bg, 0, SHOP_BAND, SHOP_W, SHOP_ROW_H, 0, SHOP_CUT + j * SHOP_ROW_H, SHOP_W, SHOP_ROW_H);
    ctx.drawImage(bg, 0, SHOP_CUT, SHOP_W, 339 - SHOP_CUT, 0, SHOP_CUT + SHOP_EXTRA * SHOP_ROW_H, SHOP_W, 339 - SHOP_CUT);
  }
  /** A goods row: icon, name, then the coin and "<price>meso" (or the Perfect Pitch mark and its count). */
  goodsRow(ctx, i, { it }, selected) {
    const m = this.mgr, im = (n) => m.image(n), y = 148 + i * SHOP_ROW_H;
    if (it.price && it.token) return;
    const sel = selected && im(this.S.select);
    if (sel) ctx.drawImage(sel, 43, y - 21);
    m.drawIcon(ctx, m.icon(it.id), 8, y - 19);
    if (it.quantity > 1) m.count(ctx, it.quantity, 6, y - 1);
    this.rowText(ctx, rowName(ctx, m.itemName(it.id)), 49, y - 20);
    const mark = im(it.price ? this.S.meso : this.S.token);
    if (mark) ctx.drawImage(mark, 49, y - 1);
    this.rowText(ctx, it.price ? `${commas(it.price)}meso` : commas(it.token), 64, y);
  }
  /** One of your items: icon (with its count for Use / Set-up / Etc), name and price; no coin on this side. */
  sellRow(ctx, i, r, selected) {
    const m = this.mgr, y = 146 + i * SHOP_ROW_H, id = r.it.id;
    const sel = selected && m.image(this.S.select);
    if (sel) ctx.drawImage(sel, 273, y - 19);
    m.drawIcon(ctx, m.icon(id), 238, y - 17);
    if ([2, 3, 4].includes(invType(id))) m.count(ctx, r.qty, 236, y + 1);
    this.rowText(ctx, rowName(ctx, m.itemName(id)), 279, y - 18);
    this.rowText(ctx, r.recharge > 0 ? `${commas(r.price)} meso / rechrg : ${r.recharge}` : `${commas(r.price)}meso`, 279, y);
  }
  body(ctx) {
    const m = this.mgr, g = this.g;
    this.drawFrame(ctx);
    // the NPC (facing right) and you, both standing animated on the header shadows
    const now = performance.now(), dt = now - (this.lastT ?? now);
    this.lastT = now;
    if (this.npc) {
      this.npc.update(dt);
      const f = this.npc.node, img = m.image(f);
      if (img) {
        const o = f.origin || [img.width / 2, img.height];
        ctx.save(); ctx.translate(56, 76); ctx.scale(-1, 1); ctx.drawImage(img, -o[0], -o[1]); ctx.restore();
      }
    }
    if (g.look) drawParts(ctx, m.assets, g.look.compose(...this.standFrame(g.look, dt)), 285, 76, false);
    this.rowText(ctx, commas(g.meso || 0), 447, 64, 'right');
    // tab strips (Basic.img Tab2): All (and Must) at a fixed 50px over the goods, Equip .. Cash over yours
    ctx.save(); ctx.translate(2, 0);
    this.buyTabRects = drawTabStrip(ctx, m, this.S.TabBuy, this.must.length ? 2 : 1, this.buyTab, 222, SHOP_TAB_Y, 50);
    ctx.restore();
    ctx.save(); ctx.translate(232, 0);
    this.sellTabRects = drawTabStrip(ctx, m, this.S.TabSell, SELL_TABS, this.tab - 1, 222, SHOP_TAB_Y);
    ctx.restore();
    const goods = this.buyItems();
    this.firstBuy = Math.max(0, Math.min(this.firstBuy, goods.length - SHOP_ROWS));
    for (let i = 0; i < SHOP_ROWS && this.firstBuy + i < goods.length; i++) this.goodsRow(ctx, i, goods[this.firstBuy + i], this.firstBuy + i === this.selBuy);
    this.scrollbar(ctx, 210, SHOP_ROW_Y, SHOP_BAR_H, this.firstBuy, goods.length, SHOP_ROWS);
    const rows = this.sellItems();
    this.firstSell = Math.max(0, Math.min(this.firstSell, rows.length - SHOP_ROWS));
    for (let i = 0; i < SHOP_ROWS; i++) {
      const r = rows[this.firstSell + i];
      this.rechargeBtns[i].visible = r?.recharge > 0;
      if (r) this.sellRow(ctx, i, r, this.firstSell + i === this.selSell);
    }
    this.scrollbar(ctx, 441, SHOP_ROW_Y, SHOP_BAR_H, this.firstSell, rows.length, SHOP_ROWS);
  }
  tabHit(rects, lx, ly, dx) {
    return (rects || []).findIndex(([x, w, y]) => lx >= x + dx && lx < x + dx + w && ly >= y && ly < y + 19);
  }
  down(lx, ly) {
    const b = this.tabHit(this.buyTabRects, lx, ly, 2);
    if (b >= 0) { if (b !== this.buyTab) { this.buyTab = b; sfx.play('UI/Tab'); } return; }
    const t = this.tabHit(this.sellTabRects, lx, ly, 232);
    if (t >= 0) { if (t + 1 !== this.tab) { this.tab = t + 1; this.firstSell = 0; this.selSell = -1; sfx.play('UI/Tab'); } return; }
    let s = this.scrollClick(lx, ly, 210, SHOP_ROW_Y, SHOP_BAR_H, this.firstBuy, this.buyItems().length, SHOP_ROWS);
    if (s !== null) { this.firstBuy = s; return; }
    s = this.scrollClick(lx, ly, 441, SHOP_ROW_Y, SHOP_BAR_H, this.firstSell, this.sellItems().length, SHOP_ROWS);
    if (s !== null) { this.firstSell = s; return; }
    // one row is chosen at a time, on either side
    const r = this.rowAt(lx, ly, true);
    if (r >= 0) { this.selBuy = r; this.selSell = -1; return; }
    const v = this.rowAt(lx, ly, false);
    if (v >= 0) { this.selSell = v; this.selBuy = -1; }
  }
  dblclick(lx, ly) {
    const b = this.rowAt(lx, ly, true);
    if (b >= 0) { if (b === this.selBuy) this.buy(); return; }
    const v = this.rowAt(lx, ly, false);
    if (v >= 0 && v === this.selSell) this.sell();
  }
  wheel(dy) {
    const left = this.mgr.mouse.x - this.x < 230, d = Math.sign(dy);
    if (left) this.firstBuy = Math.max(0, Math.min(this.buyItems().length - SHOP_ROWS, this.firstBuy + d));
    else this.firstSell = Math.max(0, Math.min(this.sellItems().length - SHOP_ROWS, this.firstSell + d));
  }
  tooltip(lx, ly) {
    const b = this.rowAt(lx, ly, true);
    if (b >= 0) return { item: { id: this.buyItems()[b].it.id } };
    const v = this.rowAt(lx, ly, false);
    if (v >= 0) return { item: this.sellItems()[v].it };
    return null;
  }
}

// ==================================================================== item tooltip
/**
 * The v83 item tooltip, on a translucent navy box with a 1px light ring.
 * Equips, 236 wide: dot + title, trade tags (orange, centred), the period / expiry line, then from y 32 the
 * icon at 2x in a 68px white box beside the REQ LEV..FAM rows (ToolTip/Equip Can / Cannot) and greyed
 * ITEM LEV / ITEM EXP (GrowthDisabled), the job row at +133, a rule at +152 and "• LABEL : value" rows
 * (category, attack speed, stats, upgrades), then the description.
 * Other items, 290 wide: title, tags, period, the icon box at the left and the description at x 92.
 * Descriptions take #c...# (or #...#) for orange.
 */
const TIP_FONT = { title: 'bold 12px Arial, sans-serif', body: '12px Arial, sans-serif',
  small: '9px Tahoma, Verdana, sans-serif', smallB: 'bold 9px Tahoma, Verdana, sans-serif' };
const TIP_TITLE = { 1: '#fff', 2: '#fdf514', 3: '#ff8a18', 4: '#bcbcbc', 5: '#5ca1ff', 6: '#c261ff' };
const TIP_ORANGE = '#ff8a18', TIP_LABEL = '#fae8cb', TIP_HI = '#ff9900', TIP_SALE = '#ff7e00';
const TIP_KARMA = 'Can trade 1 time (Trade disabled after transaction)';
const TIP_SCISSORS = '#cYou can enable 1 time of trading when you use the Scissors of Karma.#';
const WEDDING_RINGS = [1112803, 1112806, 1112807, 1112809];
const JOBS = [['beginner', 0, 10], ['warrior', 1, 52], ['magician', 2, 92], ['bowman', 4, 132], ['thief', 8, 171], ['pirate', 16, 197]];
const REQS = [['reqLEV', 'reqLevel', 'level'], ['reqSTR', 'reqSTR', 'str'], ['reqDEX', 'reqDEX', 'dex'], ['reqINT', 'reqINT', 'int'], ['reqLUK', 'reqLUK', 'luk'], ['reqPOP', 'reqPOP', 'fame']];
// [item field, base value in info, label, shown as " %d" instead of " +%d"]
const TIP_STATS = [['str', 'incSTR', 'STR :'], ['dex', 'incDEX', 'DEX :'], ['int', 'incINT', 'INT :'], ['luk', 'incLUK', 'LUK :'],
  ['hp', 'incMHP', 'HP :'], ['mp', 'incMMP', 'MP :'], ['watk', 'incPAD', 'WEAPON ATTACK :', 1], ['matk', 'incMAD', 'MAGIC ATTACK :', 1],
  ['wdef', 'incPDD', 'WEAPON DEF. :', 1], ['mdef', 'incMDD', 'MAGIC DEF. :', 1], ['acc', 'incACC', 'ACCURACY :'], ['avoid', 'incEVA', 'AVOIDABILITY :'],
  ['hands', 'incCraft', 'HANDS :'], ['speed', 'incSpeed', 'SPEED :'], ['jump', 'incJump', 'JUMP :']];
const WEAPON_CATEGORY = { 30: ' ONE-HANDED SWORD', 31: ' ONE-HANDED AXE', 32: ' ONE_HANDED MACE', 33: ' DAGGER', 37: ' WAND', 38: ' STAFF',
  40: ' TWO-HANDED SWORD', 41: ' TWO-HANDED AXE', 42: ' TWO-HANDED MACE', 43: ' SPEAR', 44: ' POLE ARM', 45: ' BOW', 46: ' CROSSBOW',
  47: ' CLAW', 48: 'KNUCKLE', 49: 'GUN' };
const EQUIP_CATEGORY = { 100: 'HAT', 101: 'FACE ACCESSORY', 102: 'EYE ACCESSORY', 103: 'EARRING', 104: 'TOP', 105: 'OVERALL', 106: 'BOTTOM',
  107: 'SHOES', 108: 'GLOVE', 109: 'SHIELD', 110: 'CAPE', 111: 'RING', 112: 'PENDANT', 113: 'BELT', 114: 'MEDAL', 119: 'SHIELD',
  180: 'PET EQUIP.', 182: 'PET RING', 183: 'PET RING', 190: 'TAMED MONSTER', 191: 'SADDLE', 192: 'MONSTER EQUIP.',
  194: 'Dragon Hat', 195: 'Dragon Pendant', 196: 'Dragon Wing Accessory', 197: 'Dragon Tail Accessory' };
const ATTACK_SPEED = [' FASTEST', ' FASTEST', ' FASTER', ' FASTER', ' FAST', ' FAST', ' NORMAL', ' SLOW', ' SLOW', ' SLOWER', ' SLOWER', ' SLOWEST', ' SLOWEST'];
const FT_MIN = 94354848000000000n, FT_MAX = 150842304000000000n, FT_EPOCH = 116444736000000000n;

const tipNum = (v) => Number(v) || 0;
const p2 = (n) => String(n).padStart(2, '0');

export function equipCategory(id) {
  const cat = Math.floor(id / 10000);
  if (cat >= 130 && cat < 150) return WEAPON_CATEGORY[cat % 100] || null;
  if (id === 1802100) return 'PET RING';
  if (cat === 181) return id >= 1812000 && id <= 1812007 ? 'PET EQUIP.' : null;
  return EQUIP_CATEGORY[cat] || null;
}

/** A FILETIME (BigInt or number) as a Date, or null for none / permanent. */
function tipDate(ft) {
  let v;
  try { v = BigInt(ft ?? 0); } catch { return null; }
  return v > FT_MIN && v < FT_MAX ? new Date(Number((v - FT_EPOCH) / 10000n)) : null;
}

/** The period line: a Cash Shop commodity's term, else when the item runs out. */
function tipPeriod(it, cash, sealed) {
  if (it.periodHours > 0) return `AVAILABLE FOR ${it.periodHours} HOURS.`;
  if (it.period > 0) return `AVAILABLE FOR ${it.period} DAYS.`;
  const d = tipDate(it.expiration);
  if (!d) return null;
  const mo = d.getUTCMonth() + 1, da = d.getUTCDate(), yr = d.getUTCFullYear(), h = p2(d.getUTCHours()), mi = p2(d.getUTCMinutes());
  if (cash) return `Available until ${mo}/${da}/${yr} at ${h}:${mi}`;
  return sealed ? `Seal Released on ${mo}-${da}-${yr} ${h}:${mi}` : `USABLE UNTIL ${mo}-${da}-${yr} AT ${h} : ${mi}`;
}

function tipPetLife(it, info) {
  const permanent = tipNum(info.permanent) > 0;
  if (it.period > 0) return permanent ? 'PERMANENT' : `DAYS OF MAGIC : ${tipNum(info.life)}`;
  let raw;
  try { raw = BigInt(it.expiration ?? 0); } catch { return null; }
  if (!raw) return null;
  const d = tipDate(raw);
  if (d && d.getTime() < Date.now()) return 'THE WATER OF LIFE HAS DRIED UP.';
  if (permanent || !d) return 'PERMANENT';
  return `WATER OF LIFE DRIES UP ON ${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCFullYear()} AT ${p2(d.getUTCHours())} : 00`;
}

/**
 * Trade tags: [first line, second line], each joined by ", ". Equip flags: 0x01 sealed, 0x08 untradeable,
 * 0x10 karma used; other items: 0x02 karma used.
 */
function tipTags(it, info, equip, period) {
  const on = (k) => tipNum(info[k]) > 0, f = tipNum(it.flag);
  let a = '', b = '';
  const add = (s) => { a = a ? `${a}, ${s}` : s; };
  const spill = (s) => { if (!a) a = s; else b = b ? `${b}, ${s}` : s; };
  if (on('only')) add('One-of-a-kind Item');
  if (on('quest')) add('Quest Item');
  if (on('pquest')) add('Party Quest Item');
  const karma = equip ? f & 0x10 : it.flag !== undefined && f & 0x02;
  if (equip ? f & 0x08 || on('tradeBlock') : on('tradeBlock')) {
    if (!karma) add('Untradeable');
    else if (!a) a = TIP_KARMA;
    else b = TIP_KARMA;
  }
  if (equip) {
    if (on('equipTradeBlock') && !(f & 0x08)) add('Trade disabled when equipped');
    if (on('onlyEquip')) spill('Unique Equipped Item');
    if (on('accountSharable')) add('Movement is possible only within the account');
    if (on('notExtend') && period) spill('Time limit extension is not possible.');
  }
  return [a, b];
}

/** Couple / friendship / wedding ring text from game.rings ({ couple, friend: [{ ring, partner }], marriage: { husband, wife } }). */
function tipRingText(g, it) {
  const r = g.rings, id = it.id, sn = it.cashId ? String(it.cashId) : '';
  if (!r) return null;
  const find = (list) => (sn ? list?.find((c) => String(c.ring) === sn)?.partner : null);
  let p;
  if (Math.floor(id / 100) === 11120 && id !== 1112000 && (p = find(r.couple))) return `A COUPLE-RING WITH : ${p}`;
  if (Math.floor(id / 100) === 11128 && id % 10 < 3 && (p = find(r.friend))) return `This is your Friendship Ring with '${p}'.`;
  if (WEDDING_RINGS.includes(id) && (p = tipSpouse(g))) return `YOU ARE MARRIED WITH : ${p}`;
  return null;
}
const tipSpouse = (g) => { const m = g.rings?.marriage; return m ? (g.stats?.gender ? m.husband : m.wife) : null; };

/** Title colour: +N scrolled items orange, then by how far the stats sit from the item's base. */
function tipTitleColor(it, info) {
  let c = it.level > 0 ? 3 : 1;
  if (it.str === undefined || tipNum(info.cash) || Math.floor(it.id / 100000) === 19) return c;
  let diff = 0;
  for (const [k, base] of TIP_STATS) {
    if (k === 'hands') continue;
    const d = tipNum(it[k]) - tipNum(info[base]);
    diff += k === 'hp' || k === 'mp' ? Math.trunc(d / 10) : d;
  }
  if (diff < 0) c = 4;
  else if (diff >= 40) c = 2;
  else if (diff >= 23) c = 6;
  else if (diff >= 6) c = 5;
  return c;
}

function tipText(ctx, s, x, y, font, color) { ctx.font = font; ctx.fillStyle = color; ctx.fillText(s, x, y); }
function tipW(ctx, s, font) { ctx.font = font; return ctx.measureText(s).width; }
/** A ToolTip sprite placed by its origin. */
function tipSprite(ctx, mgr, n, x, y) {
  const im = mgr.image(n);
  if (im) ctx.drawImage(im, x - (n.origin?.[0] || 0), y - (n.origin?.[1] || 0));
  return im;
}
function tipDigits(ctx, mgr, set, n, x, y) {
  for (const ch of String(n)) { const im = tipSprite(ctx, mgr, set?.[ch], x, y); if (im) x += im.width + 1; }
}

/** Description lines: words wrapped to `width`, '#' toggling the orange run ("#c" opens one). */
function tipWrap(ctx, text, width) {
  const lines = [[]];
  let x = 0, hi = false;
  ctx.font = TIP_FONT.body;
  const put = (seg) => {
    for (const w of seg.split(/(\s+)/)) {
      if (!w) continue;
      const ww = ctx.measureText(w).width;
      if (x + ww > width && x > 0 && w.trim()) { lines.push([]); x = 0; }
      if (!x && !w.trim()) continue;
      lines[lines.length - 1].push({ t: w, x, hi });
      x += ww;
    }
  };
  const src = String(text).replace(/\\r\\n|\\n|\r\n|\r/g, '\n');
  for (const tk of src.split(/(#c|#|\n)/)) {
    if (!tk) continue;
    if (tk === '\n') { lines.push([]); x = 0; } else if (tk === '#c') { if (hi) put('c'); hi = !hi; } else if (tk === '#') hi = !hi; else put(tk);
  }
  while (lines.length && !lines[lines.length - 1].length) lines.pop();
  return lines;
}
/** Height of wrapped text: the first line 13, each more 16. */
const tipWrapH = (lines) => (lines.length ? 13 + (lines.length - 1) * 16 : 0);
function tipDrawWrap(ctx, lines, x, y, color = '#fff') {
  lines.forEach((l, i) => { for (const r of l) tipText(ctx, r.t, x + r.x, y + i * 16, TIP_FONT.body, r.hi ? TIP_HI : color); });
}

function tipFrame(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,64,0.627)';
  ctx.fillRect(x + 1, y, w - 2, 1); ctx.fillRect(x, y + 1, w, h - 2); ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 1, y + 2, 1, h - 4); ctx.fillRect(x + w - 2, y + 2, 1, h - 4);
  ctx.fillRect(x + 2, y + 1, w - 4, 1); ctx.fillRect(x + 2, y + h - 2, w - 4, 1);
}
function tipIcon(ctx, mgr, id, x, y) {
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, 68, 68);
  const n = mgr.icon(id), im = mgr.image(n);
  if (!im) return;
  const o = n.origin || [0, 32];
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(im, x + 2 - o[0] * 2, y + 66 - o[1] * 2, im.width * 2, im.height * 2);
  mgr.drawCashMark(ctx, id, x + 66, y + 66, 2);
  ctx.imageSmoothingEnabled = true;
}
function tipTitle(ctx, mgr, D, x, y, title, color) {
  tipSprite(ctx, mgr, D?.[0], x + 10, y + 4);
  tipText(ctx, title, x + 18, y, TIP_FONT.title, color);
}
/** A "•" line in the small font: the period, a gift's sender, a pet's life. */
function tipDotLine(ctx, mgr, D, s, x, y) {
  tipSprite(ctx, mgr, D?.[1], x + 10, y + 4);
  tipText(ctx, s, x + 16, y, TIP_FONT.small, '#fff');
}
function tipCentre(ctx, s, x, y, W, font, color) { tipText(ctx, s, x + (W - tipW(ctx, s, font)) / 2, y, font, color); }
/** Two strings side by side, centred as one. */
function tipPair(ctx, a, fa, ca, b, fb, cb, x, y, W) {
  const wa = tipW(ctx, a, fa), wb = tipW(ctx, b, fb), x0 = x + (W - wa - wb) / 2;
  tipText(ctx, a, x0, y, fa, ca);
  tipText(ctx, b, x0 + wa, y, fb, cb);
}
/** Cash Shop sale: original price, then the discount in percent. */
const tipOnSale = (it) => tipNum(it.origPrice) > 0 && tipNum(it.origPrice) !== tipNum(it.price);
function tipSale(ctx, it, x, y, W) {
  const o = tipNum(it.origPrice), pct = Math.trunc(((o - tipNum(it.price)) * 100) / o);
  tipCentre(ctx, `Original Price : ${o} Cash`, x, y, W, TIP_FONT.body, '#fff');
  tipPair(ctx, 'Discount Price :', TIP_FONT.body, '#fff', `${pct}%`, TIP_FONT.body, TIP_SALE, x, y + 16, W);
}
// my may be { bottom }: the tip ends there (over the quick slots, so it doesn't cover them)
const tipPlace = (mx, my, W, H) => [Math.max(0, Math.min(mx, UI_W - 1 - W)), Math.max(0, Math.min(typeof my === 'object' ? my.bottom - H : my, UI_H - 1 - H))];

/**
 * A slot expansion in the Cash Shop list (it.slots: the tab and its slots now): its name centred 8px down, then "Add n
 * slots for the <tab> inventory..." (the storage's and a character slot's own lines) wrapped from x 10, at least 290
 * wide; on sale, the original price and discount under it.
 */
function slotItemTip(ctx, mgr, it, mx, my) {
  const { type, delta, current } = it.slots, title = mgr.itemName(it.id) || '';
  const text = type === 'char' ? `Add a character slot (Current : ${current} slots)\nYou may have up to 15 slots.`
    : type === 0 ? `Add ${delta} slots for the storage (Current: ${current})\nMaximum of 48 slots available.`
    : `Add ${delta} slots for the ${['', 'Eqp', 'Use', 'Setup', 'Etc'][type]} inventory. (Current: ${current} slots)\nMaximum of 96 slots available.`;
  const W = Math.max(290, Math.ceil(tipW(ctx, title, TIP_FONT.title)) + 16), titleH = 14;
  const desc = tipWrap(ctx, text, 275), sale = tipOnSale(it), body = titleH + 22 + tipWrapH(desc);
  const H = body + (sale ? 51 : 0);
  const [x, y] = tipPlace(mx, my, W, H);
  tipFrame(ctx, x, y, W, H);
  tipCentre(ctx, title, x, y + 8, W, TIP_FONT.title, '#fff');
  tipDrawWrap(ctx, desc, x + 10, y + titleH + 18);
  if (sale) tipSale(ctx, it, x, y + body + 8, W);
}

export function drawItemTip(ctx, mgr, it, mx, my) {
  const info = mgr.info(it.id) || {};
  ctx.save();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (it.slots && typeof it.slots === 'object') slotItemTip(ctx, mgr, it, mx, my);   // an equip's slots is its upgrade count
  else if (invType(it.id) === 1) equipTip(ctx, mgr, it, info, mx, my);
  else itemTip(ctx, mgr, it, info, mx, my);
  ctx.restore();
}

// ==================================================================== skill tooltip
/**
 * The v83 skill tooltip, 320 wide (or its widest level line + 20): dot + name at (18, 10), the icon at 2x in a 68px
 * box at (10, 32), the description in 218px lines from (87, 32) (from 47 under a 4th job skill's [Master Level]),
 * a line at 114 + 16 per description line past the fourth, then [Current Level] / [Next Level] and their texts
 * (Tahoma 11, 15px apart) and at the bottom the [Required] skills.
 */
const TIP_LEVEL_FONT = '11px Tahoma, Verdana, sans-serif';
const BLESSINGS = new Set([12, 10000012, 20000012, 20010012]);
export function drawSkillTip(ctx, mgr, id, mx, my) {
  const g = mgr.game, sb = g.skills, node = sb?.node(id);
  if (!node) { sb?.ensure(id); return; }
  ctx.save();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const D = mgr.W.ToolTip?.Equip?.Dot, lv = sb.level(id), desc = sb.desc(id);
  const n = Math.max(0, tipWrap(ctx, desc, 218).length - 4);
  let text = desc;
  if (BLESSINGS.has(id) && lv > 0) {
    const from = g.linked || '';
    text = `Spirits who receive #c${from}#'s energy will give your character a boost. 1 Skill Point will be granted each time #c${from}#'s level increases by 10.`;
  } else if (node.timeLimited) {
    const d = tipDate(sb.levels[id]?.expiration);
    if (d) text += `\r\n#cExpiration Date: ${d.getUTCFullYear()}Year ${d.getUTCMonth() + 1}Month ${d.getUTCDate()}Day ${d.getUTCHours()}Hour ${d.getUTCMinutes()}Minute#`;
  }
  const hs = (l) => sb.hint(id, l).replace(/\\r\\n|\\n|\r\n|\r|\n/g, ' ');
  const levels = [];
  if (lv > 0) levels.push([true, `[Current Level ${lv}]`], [false, hs(lv)]);
  if (lv < sb.wzMax(id)) levels.push([true, `[Next Level ${lv + 1}]`], [false, hs(lv + 1)]);
  const reqs = Object.entries(node.req || {});
  const W = Math.ceil(Math.max(320, ...levels.map(([, s]) => tipW(ctx, s, TIP_LEVEL_FONT) + 20)));
  const H = 128 + 16 * n + (reqs.length ? 34 * reqs.length + 20 : 0) + 15 * levels.length, sep = 114 + 16 * n;
  const [x, y] = tipPlace(mx, my, W, H);
  // text lands 2px under its v83 coordinate when drawn from a canvas 'top' baseline
  const T = 2, say = (s, tx, ty, font, color) => tipText(ctx, s, x + tx, y + ty + T, font, color);
  tipFrame(ctx, x, y, W, H);
  tipSprite(ctx, mgr, D?.[0], x + 10, y + 15);
  say(sb.name(id), 18, 10, TIP_FONT.title, '#fff');
  ctx.fillStyle = 'rgba(255,255,255,0.627)'; ctx.fillRect(x + 10, y + 32, 68, 68);
  const icon = sb.icon(id), im = mgr.image(icon);
  if (im) {
    const o = icon.origin || [0, 32];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, x + 12 - o[0] * 2, y + 98 - o[1] * 2, im.width * 2, im.height * 2);
    ctx.imageSmoothingEnabled = true;
  } else if (icon) mgr.assets.preload([icon]);
  let top = 32;
  if (sb.mastered(id)) { say(`[Master Level : ${sb.levels[id]?.master || 0}]`, 87, 32, TIP_FONT.body, '#fff'); top = 47; }
  tipDrawWrap(ctx, tipWrap(ctx, text, 218), x + 87, y + top + T);
  ctx.fillStyle = '#fff'; ctx.fillRect(x + 6, y + sep, W - 12, 1);
  levels.forEach(([head, s], i) => {
    const ly = sep + 7 + 15 * i;
    if (head) { tipSprite(ctx, mgr, D?.[1], x + 10, y + ly + T + 2); say(s, 16, ly, TIP_LEVEL_FONT, TIP_LABEL); }
    else say(s, 10, ly, TIP_LEVEL_FONT, '#fff');
  });
  if (reqs.length) {
    const r0 = H - 34 * reqs.length - 20;
    tipSprite(ctx, mgr, D?.[1], x + 10, y + r0 - 3 + T + 2);
    say('[Required]', 16, r0 - 3, TIP_LEVEL_FONT, TIP_LABEL);
    reqs.forEach(([r, need], k) => {
      const rid = Number(r), ri = sb.icon(rid), rim = mgr.image(ri);
      if (rim) ctx.drawImage(rim, x + 11, y + r0 + 15 + 34 * k); else if (ri) mgr.assets.preload([ri]);
      say(sb.name(rid), 50, r0 + 17 + 34 * k, TIP_LEVEL_FONT, '#fff');
      say(`Level : ${need}`, 50, r0 + 29 + 34 * k, TIP_LEVEL_FONT, '#fff');
    });
  }
  ctx.restore();
}

const tipIsCanvas = (n) => !!n && typeof n === 'object' && '_canvas' in n;
function equipTip(ctx, mgr, it, info, mx, my) {
  const g = mgr.game, T = mgr.W.ToolTip?.Equip || {}, id = it.id, cat = Math.floor(id / 10000);
  const cs = !!it.cs || it.period > 0 || it.periodHours > 0, full = it.str !== undefined, f = tipNum(it.flag);
  const sex = Math.floor(id / 1000) % 10;
  let title = mgr.itemName(id) || '...';
  if (it.level > 0) title += ` (+${it.level})`;
  else if (sex < 2) title += sex ? ' (Female)' : ' (Male)';
  const period = tipPeriod(it, !!it.cashId || tipNum(info.cash) > 0, !!(f & 0x01));
  const lines = [period, !cs && it.from ? `IT'S A GIFT FROM '${it.from}'` : null].filter(Boolean);
  const tags = cs ? ['', ''] : tipTags(it, info, true, period);
  const owner = !cs && it.owner ? String(it.owner) : '';
  // "• LABEL : value" rows: [label, value, value font]
  const rows = [], tuc = tipNum(info.tuc);
  const category = equipCategory(id);
  if (category) rows.push(['CATEGORY :', category, TIP_FONT.small]);
  if (cat >= 130 && cat < 150) {
    const sp = ATTACK_SPEED[info.attackSpeed === undefined ? 6 : tipNum(info.attackSpeed)];
    if (sp) rows.push(['ATTACK SPEED :', sp, TIP_FONT.small]);
  }
  for (const [k, base, label, plain] of TIP_STATS) {
    const v = full ? tipNum(it[k]) : tipNum(info[base]);
    if (v > 0) rows.push([label, plain ? ` ${v}` : ` +${v}`, TIP_FONT.smallB]);
  }
  if (tipNum(info.knockback) > 0) rows.push(['THE RATE OF KNOCK-BACK :', ` ${tipNum(info.knockback)}%`, TIP_FONT.smallB]);
  if (f & 0x02) rows.push(['ADD PREVENT SLIPPING', '', TIP_FONT.small]);
  if (f & 0x04) rows.push(['ADD PREVENT COLDNESS', '', TIP_FONT.small]);
  if (tuc > 0) rows.push(['NUMBER OF UPGRADES AVAILABLE :', ` ${full ? tipNum(it.slots) : tuc}`, TIP_FONT.smallB]);
  if (!cs && tuc > 0 && Math.floor(id / 100000) !== 18 && id !== 1122000) {
    const n = tipNum(it.vicious);
    rows.push([`NUMBER OF VICIOUS' HAMMER APPLIED : ${n >= 2 ? '2(MAX)' : n}`, '', TIP_FONT.smallB]);
  }
  for (const r of rows) if (r[1] && !r[1].startsWith(' ')) r[1] = ` ${r[1]}`;
  let text = tipRingText(g, it) ?? (mgr.desc(id) || '');
  if (!cs && tipNum(info.tradeAvailable) && !(f & 0x10)) text += (text ? '\n' : '') + TIP_SCISSORS;
  // width: 236, or wider for a long title or row
  let W = 236;
  W = Math.max(W, Math.ceil(tipW(ctx, title, TIP_FONT.title)) + 20);
  for (const [l, v, fo] of rows) W = Math.max(W, Math.ceil(tipW(ctx, l, TIP_FONT.small) + tipW(ctx, v, fo)) + 20);
  const desc = tipWrap(ctx, text, 208), descH = tipWrapH(desc), sale = tipOnSale(it);
  // a first tag line wider than the box wraps; the second is given the first one's height
  const ownH = owner ? 19 : 0, tagW = tags[0] ? tipW(ctx, tags[0], TIP_FONT.body) : 0;
  const tagN = tags[0] ? Math.floor(tagW / 236) + 1 : 0, tagH = tagN * 19 * (tags[1] ? 2 : 1);
  const base = ownH + tagH + lines.length * 16;
  // the Cash Shop's tooltip shows the item's sample picture (info/sample) centred above the description
  const sample = cs && tipIsCanvas(info.sample) ? info.sample : null, sImg = sample && mgr.image(sample);
  const sampleH = sample ? (sImg?.height || sample._h || 0) + 5 : 0;
  const H = base + 166 + rows.length * 13 + descH + (sale ? 35 : 0) + sampleH;
  const [x, y] = tipPlace(mx, my, W, H);

  tipFrame(ctx, x, y, W, H);
  if (owner) tipPair(ctx, owner, TIP_FONT.title, TIP_ORANGE, "'s", TIP_FONT.title, '#fff', x, y + 10, W);
  tipTitle(ctx, mgr, T.Dot, x, y + ownH + 10, title, TIP_TITLE[tipTitleColor(it, info)]);
  if (tags[0] && tagW < 237) tipCentre(ctx, tags[0], x, y + ownH + 29, W, TIP_FONT.body, TIP_ORANGE);
  else if (tags[0]) tipDrawWrap(ctx, tipWrap(ctx, tags[0], 178), x + 25, y + ownH + 31, TIP_ORANGE);
  if (tags[1]) tipCentre(ctx, tags[1], x, y + ownH + 48, W, TIP_FONT.body, TIP_ORANGE);
  lines.forEach((s, i) => tipDotLine(ctx, mgr, T.Dot, s, x, y + ownH + tagH + 29 + 16 * i));
  const by = y + base;
  tipIcon(ctx, mgr, id, x + 10, by + 32);
  // requirements against the stats the character would have with it on
  const have = g.equipStats?.(id) || g.stats || {};
  REQS.forEach(([spr, key, stat], i) => {
    const need = tipNum(info[key]), set = need <= tipNum(have[stat]) ? T.Can : T.Cannot, ry = by + 32 + 12 * i;
    tipSprite(ctx, mgr, set?.[spr], x + 94, ry);
    if (spr === 'reqPOP' && !need) tipSprite(ctx, mgr, T.Can?.none, x + 144, ry);
    else tipDigits(ctx, mgr, set, need, x + 144, ry);
  });
  const growth = info.level && typeof info.level === 'object', G = growth ? T.GrowthEnabled : T.GrowthDisabled;
  tipSprite(ctx, mgr, G?.itemLEV, x + 94, by + 104);
  tipSprite(ctx, mgr, G?.itemEXP, x + 94, by + 116);
  if (growth && it.itemLevel) tipDigits(ctx, mgr, G, it.itemLevel, x + 148, by + 104);
  else tipSprite(ctx, mgr, G?.none, x + 148, by + 104);
  tipSprite(ctx, mgr, G?.none, x + 148, by + 116);
  // jobs: reqJob 0 lets everyone, -1 beginners only, else a bit per branch
  const req = tipNum(info.reqJob);
  for (const [job, bit, jx] of JOBS) {
    const ok = bit ? req === 0 || (req > 0 && (req & bit)) : req <= 0;
    tipSprite(ctx, mgr, (ok ? T.Can : T.Cannot)?.[job], x + jx, by + 133);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + 10, by + 152, W - 20, 1);
  rows.forEach(([l, v, fo], i) => {
    const ry = by + 159 + 13 * i;
    tipSprite(ctx, mgr, T.Dot?.[1], x + 10, ry + 4);
    tipText(ctx, l, x + 16, ry, TIP_FONT.small, TIP_LABEL);
    if (v) tipText(ctx, v, x + 16 + tipW(ctx, l, TIP_FONT.small), ry, fo, '#fff');
  });
  if (sale) tipSale(ctx, it, x, y + H - descH - 39, W);
  if (sImg) ctx.drawImage(sImg, x + ((W - sImg.width) >> 1), y + H - descH - (sale ? 35 : 0) - 3 - sampleH);
  tipDrawWrap(ctx, desc, x + 10, y + H - descH - (cs ? 3 : 5));
}

function itemTip(ctx, mgr, it, info, mx, my) {
  const g = mgr.game, T = mgr.W.ToolTip?.Equip || {}, id = it.id, name = mgr.itemName(id) || '...';
  const pet = Math.floor(id / 10000) === 500, f = tipNum(it.flag);
  let title = name;
  if (pet && it.pet?.name && it.pet.name !== name) title = `${it.pet.name} (${name})`;
  const tags = pet ? ['', ''] : tipTags(it, info, false, null);
  const tagH = !tags[0] ? 0 : tags[1] ? 38 : 19;
  const period = pet ? tipPetLife(it, info) : tipPeriod(it, !!it.cashId || tipNum(info.cash) > 0, false);
  const spouse = !pet && id >= 4031357 && id <= 4031364 ? tipSpouse(g) : null;
  const owner = !pet && it.owner && Math.floor(id / 10000) !== 430 && id !== 4031406 && id !== 4031407 ? String(it.owner) : '';
  const gift = it.from ? `A GIFT FROM '${it.from}'` : '';
  let text = mgr.desc(id) || '';
  if (!pet && it.flag !== undefined && tipNum(info.tradeAvailable) && !(f & 0x02)) text += (text ? '\n' : '') + TIP_SCISSORS;
  const reqLv = pet ? 0 : tipNum(info.reqLevel), showReq = reqLv > 0 || Math.floor(id / 10000) === 301;
  const W = Math.max(290, Math.ceil(tipW(ctx, title, TIP_FONT.title)) + 20);
  const desc = tipWrap(ctx, text, W - 20 - 92 - 3), descH = tipWrapH(desc), sale = tipOnSale(it);
  const head = pet ? (period ? 16 : 0) + (gift ? 16 : 0)
    : tagH + (period ? 20 : 0) + (spouse ? 16 : 0) + (owner ? 16 : 0) + (gift ? 16 : 0);
  const top = head + (showReq ? 44 : 32);
  const H = Math.max(head + 116 + (showReq ? 12 : 0), top + descH + 8) + (sale ? 35 : 0);
  const [x, y] = tipPlace(mx, my, W, H);

  tipFrame(ctx, x, y, W, H);
  tipTitle(ctx, mgr, T.Dot, x, y + 10, title, TIP_TITLE[1]);
  if (pet) {
    if (period) tipDotLine(ctx, mgr, T.Dot, period, x, y + 29);
    if (gift) tipCentre(ctx, gift, x, y + (period ? 45 : 29), W, TIP_FONT.body, '#fff');
  } else {
    if (tags[0]) tipCentre(ctx, tags[0], x, y + 29, W, TIP_FONT.body, TIP_ORANGE);
    if (tags[1]) tipCentre(ctx, tags[1], x, y + 48, W, TIP_FONT.body, TIP_ORANGE);
    let cy = tagH + 31;
    if (spouse) { tipCentre(ctx, `YOU ARE ENGAGED WITH : ${spouse}`, x, y + cy - 2, W, TIP_FONT.body, TIP_ORANGE); cy = tagH + 50; }
    if (period) { tipDotLine(ctx, mgr, T.Dot, period, x, y + cy - 2); cy += 16; }
    if (owner) { tipPair(ctx, 'Specially made by ', TIP_FONT.body, '#fff', owner, TIP_FONT.body, TIP_ORANGE, x, y + cy, W); cy += 16; }
    if (gift) tipDotLine(ctx, mgr, T.Dot, gift, x, y + cy - 2);
  }
  tipIcon(ctx, mgr, id, x + 10, y + head + 32);
  if (showReq) {
    const set = reqLv <= tipNum(g.stats?.level) ? T.Can : T.Cannot, ry = y + tagH + (period ? 20 : 0) + 32;
    tipSprite(ctx, mgr, set?.reqLEV, x + 92, ry);
    tipDigits(ctx, mgr, set, reqLv, x + 142, ry);
  }
  tipDrawWrap(ctx, desc, x + 92, y + top);
  if (sale) {
    const sy = y + head + 40 + Math.max(descH, 68);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 6, sy - 4, W - 12, 1);
    tipSale(ctx, it, x, sy + 4, W);
  }
}
