import { pad, frames } from '../assets.js';
import { invType, itemInfo } from '../data.js';
import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win, allCanvases, drawTabStrip } from './windows.js';
import { Anim } from '../map.js';
import { richText, drawRich, optionAt, LIGHT_COLORS } from './richtext.js';

/**
 * Stage 3 of the v83 in-game UI, drawn on the canvas through the WindowManager:
 *   NpcDialog   UIWindow.img/UtilDlgEx (t / c tiles / s, or it / ic / is for quests)
 *   MessageBox  Basic.img Notice3 / YesNo3 (t / c tiles / s) for notices, yes-no and amounts
 *   ShopWin     UIWindow.img/Shop
 *   drawItemTip UIWindow.img/ToolTip/Equip requirement sprites (Can / Cannot)
 */

// ==================================================================== text references
function textRef(mgr) {
  const g = mgr.game, s = mgr.strings;
  const mapName = (id) => { for (const r of Object.values(s.map || {})) if (r?.[id]) return r[id].mapName; return id; };
  return {
    player: g.player.name, item: (id) => mgr.itemName(id) || '...', icon: (id) => mgr.icon(id),
    mob: (id) => s.mob?.[id]?.name || `monster ${id}`, npc: (id) => s.npc?.[id]?.name || `NPC ${id}`,
    map: mapName, count: (id) => g.itemCount(id), skill: (id) => g.skills?.name(id) ?? '', skillIcon: (id) => { const n = g.skills?.icon(id); if (!n) g.skills?.ensure(id)?.then?.(() => { mgr.namesVersion++; }); return n; },
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
  f.layout({ left: 0, top: 0 }, mgr.game.canvas.clientWidth / 800);
}

// ==================================================================== NPC chat
/**
 * UtilDlgEx: 529 wide. t (28) / c (20, tiled) / s (58). Laid out as the client does (openms' recovery of
 * CUtilDlgEx): the body is at least 120px, text is 12px Arial on 18px lines, 341 wide at x 157 (25 when the
 * speaker is on the right, as in the quest frame it / ic / is) and centred in the body; the portrait is
 * centred on x 80 (450) with UtilDlgEx/bar under it carrying the name in white 12px Arial.
 * Buttons sit in s's band (rows 29-51): End Chat on the left, Prev / Next / OK / Yes / No on the right.
 * d: { npc, type, text, prev, next, def, min, max, styles } as sent in NPC_TALK.
 */
/** NPC dialogue text: the client's font0, 12px Arial on 18px lines. */
const NPC_TEXT = { size: 12, lineH: 18, bullet: 18 };
export class NpcDialog extends Win {
  constructor(mgr, d, done) {
    const U = mgr.W.UtilDlgEx;
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.U = U; this.d = d; this.done = done; this.modal = true;
    this.closeSound = null;   // answering a line only makes the button's click
    this.quest = d.type === 12;
    const F = this.quest ? { t: U.it, c: U.ic, s: U.is } : { t: U.t, c: U.c, s: U.s };
    this.F = F;
    this.textX = this.quest ? 25 : 157; this.textW = 341; this.faceX = this.quest ? 450 : 80;
    let text = d.text;
    if (d.type === 7) text += '\n' + d.styles.map((s, i) => `#L${i}##bStyle ${i + 1}#k#l`).join('\n');
    this.layout = richText(scratch(), text, this.textW, textRef(mgr), NPC_TEXT);
    this.laidOut = mgr.namesVersion;
    const input = d.type === 2 || d.type === 3;
    if (input) {
      this.field = overlayField(mgr, 117, { max: d.type === 3 ? 10 : 30 });
      this.field.value = d.type === 3 ? String(d.def ?? 0) : d.def || '';
    }
    this.size();
    // buttons: replies follow the old DOM dialog (action 1 next/yes/ok, 0 back/no, -1 end)
    const end = d.type === 4 || d.type === 2 || d.type === 3 || d.type === 7 ? 0 : -1;
    const by = () => this.bandY + 30;
    this.btn(U.BtClose, 15, by, () => this.reply(end));
    const right = [];
    if (d.type === 0) { if (d.prev) right.push([U.BtPrev, () => this.reply(0)]); right.push(d.next ? [U.BtNext, () => this.reply(1)] : [U.BtOK, () => this.reply(1)]); }
    else if (d.type === 1) right.push([U.BtYes, () => this.reply(1)], [U.BtNo, () => this.reply(0)]);
    else if (d.type === 12) right.push([U.BtQYes, () => this.reply(1)], [U.BtQNo, () => this.reply(0)]);
    else if (input) right.push([U.BtOK, () => this.submit()]);
    this.primary = right.find(([n]) => n === U.BtNext || n === U.BtOK || n === U.BtYes || n === U.BtQYes)?.[1];
    let x = 529 - 15;
    for (const [node, fn] of right.reverse()) { x -= node.normal[0]._w; this.btn(node, x, by, fn); x -= 4; }
    this.loadPortrait();
  }
  btn(node, x, y, fn) { const b = this.button(node, x, 0, fn); b.yAt = y; return b; }
  size() {
    const measured = this.layout.height + (this.field ? 26 : 0);
    this.tiles = Math.ceil(Math.max(120, measured + 8) / 20);
    this.bandY = 28 + this.tiles * 20;
    const body = this.tiles * 20;
    this.textY = 28 + Math.max(4, Math.trunc((body - measured - (this.field ? 20 : 6)) / 2));
    this.w = 529; this.h = this.bandY + 58;
    this.x = Math.round((800 - this.w) / 2); this.y = Math.max(8, Math.round((529 - this.h) / 2));
  }
  async loadPortrait() {
    const a = this.mgr.assets, id = pad(this.d.npc, 7);
    let n = await a.json(`Npc/${id}.img`);
    if (n?.info?.link) n = (await a.json(`Npc/${pad(n.info.link, 7)}.img`)) || n;
    const st = n?.stand?.[0] || n?.stand;
    if (st?._canvas) { await a.preload([st]); this.face = st; }
  }
  frames() { const U = this.U; return [...allCanvases(this.F), U.dot0, U.dot1, U.list0, U.list1, U.list2, U.list3, ...this.buttons.flatMap((b) => b.frames())]; }
  reply(action, sel) { this.close(); this.done({ action, sel }); }
  submit() {
    const v = this.field.value;
    if (this.d.type === 3) this.reply(1, Math.max(this.d.min, Math.min(this.d.max, Number(v) || 0)));
    else this.reply(1, v);
  }
  close() { this.field?.remove(); this.mgr.close(this); }
  key(e) {
    if (e.key === 'Escape') this.buttons[0].onClick();
    else if (e.key === 'Enter') { if (this.field) this.submit(); else this.primary?.(); }
  }
  draw(ctx) {
    if (this.laidOut !== this.mgr.namesVersion) {
      this.layout = richText(scratch(), this.d.type === 7 ? this.d.text + '\n' + this.d.styles.map((s, i) => `#L${i}##bStyle ${i + 1}#k#l`).join('\n') : this.d.text, this.textW, textRef(this.mgr), NPC_TEXT);
      this.laidOut = this.mgr.namesVersion; this.size();
    }
    for (const b of this.buttons) b.y = b.yAt();
    super.draw(ctx);
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n);
    const t = im(this.F.t), c = im(this.F.c), s = im(this.F.s);
    if (!t || !c || !s) return;
    ctx.drawImage(t, 0, 0);
    for (let i = 0; i < this.tiles; i++) ctx.drawImage(c, 0, 28 + i * 20);
    ctx.drawImage(s, 0, this.bandY);
    // portrait and its name bar, centred together in the body (a tall portrait sits on the band instead)
    const face = im(this.face), bar = im(this.U.bar), name = m.strings.npc?.[this.d.npc]?.name, body = this.tiles * 20;
    const fh = face ? Math.min(face.height, body - 23) : 0, k = face ? fh / face.height : 1;
    const top = 28 + Math.max(0, Math.trunc((body - fh - 23) / 2));
    if (face) ctx.drawImage(face, Math.round(this.faceX - (face.width * k) / 2), top, Math.round(face.width * k), fh);
    if (name) {
      if (bar) ctx.drawImage(bar, this.faceX - 60, top + fh + 3);
      uiText(ctx, name, this.faceX, top + fh + 5, { color: '#fff', size: 12, align: 'center' });
    }
    // the client draws every choice in the same muted purple, whatever colour code it carries
    drawRich(ctx, this.layout, this.textX, this.textY, { drawIcon: (n, x, y) => m.drawIcon(ctx, n, x, y), hover: this.hoverOpt, size: NPC_TEXT.size, optColor: '#4f3b98',
      drawImage: (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x, y); },
      drawBullet: (x, y, on) => { const i = im(on ? this.U.dot1 : this.U.dot0); if (i) ctx.drawImage(i, x, y); } });
    if (this.field) {
      const bar = im(this.U.bar), fy = this.textY + this.layout.height + 6;
      if (bar) ctx.drawImage(bar, this.textX, fy);
      placeField(m, this.field, this.x + this.textX + 2, this.y + fy + 1);
      if (!this.focused) { this.focused = true; setTimeout(() => this.field.focus(), 0); }
    }
  }
  move(lx, ly) { this.hoverOpt = optionAt(this.layout, lx - this.textX, ly - this.textY); }
  down(lx, ly) {
    const o = optionAt(this.layout, lx - this.textX, ly - this.textY);
    if (o !== null && (this.d.type === 4 || this.d.type === 7 || this.d.type === 0)) { sfx.play('UI/BtMouseClick'); this.reply(1, o); }
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
    super(mgr, mgr.W.UtilDlgEx_Pet.backgrnd, 400 - 209, 300 - 148);
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
 * Basic.img Notice3 / YesNo3: 266 wide; t (21) / c (20, tiled) / s (55). The blue box holds the
 * (white) text, the band in s holds the 65x24 buttons. kind: 'notice' | 'yesno' | 'number'.
 * 'server' is the server's own pop-up on the classic metal plate, Basic.img/Notice2, 258 wide: t (40: the
 * header strip and the screwed top edge), c (20, tiled: the white sheet the black text sits on), s (47, the
 * bottom edge with the OK slot centred at 96, 11).
 * 'request' is another player asking something of you (a trade, a party, a guild...): the same plate as
 * Basic.img/YesNo2, its bottom edge with two slots for YES (58, 11) and NO (155, 11).
 */
/**
 * The death notice (UIWindow.img/Notice/0, 286x146): the tombstone and "PRESS OK TO BE REVIVED. Once you have revived,
 * you will be sent to a safe town nearby." are in the art; OK (Basic BtOK, 65x24) sits centred in its grey strip along
 * the bottom: inside the borders x 5-280, and between the separator line (row 110) and the bottom bevel (row 140).
 * Enter answers it too.
 */
export class DeathNotice extends Win {
  constructor(mgr, done) {
    super(mgr, mgr.W.Notice[0], Math.round((800 - 286) / 2), 90);
    this.modal = true; this.done = done;
    this.closeBtn.visible = false;
    const ok = mgr.B.BtOK, w = ok.normal[0]._w, h = ok.normal[0]._h;
    this.button(ok, Math.floor((5 + 281 - w) / 2), Math.floor((111 + 140 - h) / 2), () => this.finish());
  }
  finish() { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(); }
  key(e) { if (e.key === 'Enter' || e.key === ' ') this.finish(); }
}

export class MessageBox extends Win {
  constructor(mgr, kind, text, done, opts = {}) {
    super(mgr, null, 0, 0);
    this.buttons = [];
    const B = mgr.B;
    this.kind = kind; this.done = done; this.modal = true; this.opts = opts;
    this.F = kind === 'server' ? B.Notice2 : kind === 'request' ? B.YesNo2 : kind === 'notice' ? B.Notice3 : B.YesNo3;
    if (kind === 'server' || kind === 'request') {
      this.layout = richText(scratch(), text, 226, textRef(mgr), { base: '#000', size: 12 });
      this.tiles = Math.max(2, Math.ceil((this.layout.height + 10) / 20));
      this.bandY = 40 + this.tiles * 20;
      this.w = 258; this.h = this.bandY + 47;
      this.x = Math.round((800 - this.w) / 2); this.y = opts.y ?? Math.round((529 - this.h) / 2);
      if (kind === 'server') this.button(B.BtOK, 96, this.bandY + 11, () => this.finish(true));
      else {
        this.button(B.BtYes, 58, this.bandY + 11, () => this.finish(true));
        this.button(B.BtNo, 155, this.bandY + 11, () => this.finish(false));
      }
      return;
    }
    this.layout = richText(scratch(), text, 238, textRef(mgr), { base: '#fff', colors: LIGHT_COLORS });
    if (kind === 'number') { this.field = overlayField(mgr, 120, { max: 10 }); this.field.value = String(opts.def ?? 1); }
    if (kind === 'text') { this.field = overlayField(mgr, opts.width || 150, { max: opts.max || 13 }); this.field.value = opts.def || ''; }
    const extra = this.field ? 26 : 0;
    this.tiles = Math.max(1, Math.ceil((8 + this.layout.height + extra + 6 - 21) / 20));
    this.bandY = 21 + this.tiles * 20;
    this.w = 266; this.h = this.bandY + 55;
    this.x = Math.round((800 - this.w) / 2); this.y = opts.y ?? Math.round((529 - this.h) / 2);
    const by = this.bandY + 18;
    if (kind === 'notice') this.button(B.BtOK, 266 - 65 - 12, by, () => this.finish(true));
    else {
      const input = kind === 'number' || kind === 'text';
      this.button(input ? B.BtOK : B.BtYes, 266 - 2 * 65 - 16, by, () => this.finish(true));
      this.button(input ? B.BtCancel : B.BtNo, 266 - 65 - 12, by, () => this.finish(false));
    }
  }
  frames() { return [...allCanvases(this.F), ...this.buttons.flatMap((b) => b.frames())]; }
  finish(ok) {
    this.field?.remove(); this.mgr.close(this);
    if (this.kind === 'number') {
      const v = Math.floor(Number(this.field.value));
      this.done(ok && Number.isFinite(v) ? Math.max(this.opts.min ?? 1, Math.min(this.opts.max ?? v, v)) : null);
    } else if (this.kind === 'text') this.done(ok && this.field.value.trim() ? this.field.value.trim() : null);
    else this.done(ok);
  }
  key(e) { if (e.key === 'Enter') this.finish(true); else if (e.key === 'Escape') this.finish(this.kind === 'notice' || this.kind === 'server'); }
  body(ctx) {
    const m = this.mgr, t = m.image(this.F.t), c = m.image(this.F.c), s = m.image(this.F.s);
    if (!t || !c || !s) return;
    if (this.kind === 'server' || this.kind === 'request') {
      ctx.drawImage(t, 0, 0);
      for (let i = 0; i < this.tiles; i++) ctx.drawImage(c, 0, 40 + i * 20);
      ctx.drawImage(s, 0, this.bandY);
      // centred on the sheet, as the client sets its pop-ups
      const top = 40 + Math.round((this.tiles * 20 - this.layout.height) / 2) - 2;
      drawRich(ctx, this.layout, 16, top, { size: 12, drawIcon: (n, x, y) => m.drawIcon(ctx, n, x, y) });
      return;
    }
    ctx.drawImage(t, 0, 0);
    for (let i = 0; i < this.tiles; i++) ctx.drawImage(c, 0, 21 + i * 20);
    ctx.drawImage(s, 0, this.bandY);
    drawRich(ctx, this.layout, 14, 8, { drawIcon: (n, x, y) => m.drawIcon(ctx, n, x, y) });
    if (this.field) {
      const fy = 8 + this.layout.height + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(14, fy, 124, 19);
      placeField(m, this.field, this.x + 16, this.y + fy + 1);
      if (!this.focused) { this.focused = true; setTimeout(() => { this.field.focus(); this.field.el.select(); }, 0); }
    }
  }
}

/**
 * The plain message box (Basic.img YesNo3: t 21, c 20 tiled, s 55, 266 wide, centred) with Basic BtOK2 at x 155 and
 * BtCancel2 at 205, 30px off the bottom. 'okcancel': the lines centred, 14px apart, over at least two body tiles.
 * 'quantity': the prompt at the top left and a white 226x15 field 73px off the bottom.
 */
class UtilBox extends Win {
  constructor(mgr, kind, text, done, opts = {}) {
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.modal = true; this.kind = kind; this.done = done; this.opts = opts;
    this.lines = wrapText(scratch(), text, 234, 12);
    const n = this.lines.length;
    this.tiles = Math.max(2, Math.floor((n * 14) / 20) + 1);
    this.w = 266; this.h = kind === 'quantity' ? 121 + (n - 1) * 14 : 21 + this.tiles * 20 + 55;
    this.x = 267; this.y = (600 - this.h) >> 1;
    this.button(mgr.B.BtOK2, 155, this.h - 30, () => this.finish(true));
    this.button(mgr.B.BtCancel2, 205, this.h - 30, () => this.finish(false));
    if (kind === 'quantity') {
      this.field = overlayField(mgr, 226, { max: 10, color: '#000' });
      this.field.rect.h = 15; this.field.value = String(opts.def ?? 1);
    }
  }
  frames() { return [...allCanvases(this.mgr.B.YesNo3), ...super.frames()]; }
  finish(ok) {
    if (this.answered) return;
    this.answered = true; this.field?.remove(); this.mgr.close(this);
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
    if (this.kind !== 'quantity') {
      const top = (this.tiles * 20 - this.lines.length * 14) / 2 + 24;
      this.lines.forEach((l, i) => line(l, 132, top + i * 14, 'center'));
      return;
    }
    this.lines.forEach((l, i) => line(l, 19, 28 + i * 14, 'left'));
    const fy = this.h - 73;
    ctx.fillStyle = '#000'; ctx.fillRect(18, fy - 1, 228, 17);
    ctx.fillStyle = '#fff'; ctx.fillRect(19, fy, 226, 15);
    placeField(m, this.field, this.x + 19, this.y + fy);
    if (!this.focused) { this.focused = true; setTimeout(() => { this.field.focus(); this.field.el.select(); }, 0); }
  }
}

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
    super(mgr, null, (800 - SHOP_W) >> 1, (600 - SHOP_H) >> 1);
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
    if (it.flag & 1) { m.notice('Sealed items cannot be\nsold, traded, or dropped.'); return; }
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

function equipCategory(id) {
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
const tipPlace = (mx, my, W, H) => [Math.max(0, Math.min(mx, 799 - W)), Math.max(0, Math.min(my, 599 - H))];

export function drawItemTip(ctx, mgr, it, mx, my) {
  const info = mgr.info(it.id) || {};
  ctx.save();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (invType(it.id) === 1) equipTip(ctx, mgr, it, info, mx, my);
  else itemTip(ctx, mgr, it, info, mx, my);
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
