import { pad } from '../assets.js';
import { invType, itemInfo } from '../data.js';
import { drawParts } from '../character.js';
import { nameTag } from '../map.js';
import { sfx } from '../audio.js';
import { TextField, uiText } from './wzui.js';
import { Win, allCanvases } from './windows.js';
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
    map: mapName, count: (id) => g.itemCount(id),
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
 * UtilDlgEx: 529 wide. t (28) / c (20, tiled) / s (58). Portrait area x 10-148 with the text area
 * x 150-510; the quest frame (it / ic / is) mirrors it: text x 16-380, portrait on the right.
 * Buttons sit in s's band (rows 29-51): End Chat on the left, Prev / Next / OK / Yes / No on the right.
 * d: { npc, type, text, prev, next, def, min, max, styles } as sent in NPC_TALK.
 */
export class NpcDialog extends Win {
  constructor(mgr, d, done) {
    const U = mgr.W.UtilDlgEx;
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.U = U; this.d = d; this.done = done; this.modal = true;
    this.quest = d.type === 12;
    const F = this.quest ? { t: U.it, c: U.ic, s: U.is } : { t: U.t, c: U.c, s: U.s };
    this.F = F;
    this.textX = this.quest ? 22 : 160; this.textW = this.quest ? 350 : 340; this.faceX = this.quest ? 452 : 79;
    let text = d.text;
    if (d.type === 7) text += '\n' + d.styles.map((s, i) => `#L${i}##bStyle ${i + 1}#k#l`).join('\n');
    this.layout = richText(scratch(), text, this.textW, textRef(mgr));
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
    const extra = this.field ? 26 : 0;
    this.tiles = Math.max(3, Math.ceil((12 + this.layout.height + extra + 8 - 28) / 20));
    this.bandY = 28 + this.tiles * 20;
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
  frames() { return [...allCanvases(this.F), this.U.dot0, ...this.buttons.flatMap((b) => b.frames())]; }
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
      this.layout = richText(scratch(), this.d.type === 7 ? this.d.text + '\n' + this.d.styles.map((s, i) => `#L${i}##bStyle ${i + 1}#k#l`).join('\n') : this.d.text, this.textW, textRef(this.mgr));
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
    const face = im(this.face);
    if (face) {
      const o = this.face.origin || [face.width / 2, face.height];
      const foot = this.bandY - 4;
      const scale = Math.min(1, (foot - 6) / face.height);   // tall NPCs shrink to fit, like the client's portrait box
      ctx.drawImage(face, Math.round(this.faceX - o[0] * scale), Math.round(foot - o[1] * scale), face.width * scale, face.height * scale);
    }
    const name = m.strings.npc?.[this.d.npc]?.name;
    if (name) nameTag(ctx, name, this.faceX, this.bandY + 6, '#fff');
    drawRich(ctx, this.layout, this.textX, 12, { drawIcon: (n, x, y) => m.drawIcon(ctx, n, x, y), hover: this.hoverOpt });
    if (this.field) {
      const bar = im(this.U.bar), fy = 12 + this.layout.height + 6;
      if (bar) ctx.drawImage(bar, this.textX, fy);
      placeField(m, this.field, this.x + this.textX + 2, this.y + fy + 1);
      if (!this.focused) { this.focused = true; setTimeout(() => this.field.focus(), 0); }
    }
  }
  move(lx, ly) { this.hoverOpt = optionAt(this.layout, lx - this.textX, ly - 12); }
  down(lx, ly) {
    const o = optionAt(this.layout, lx - this.textX, ly - 12);
    if (o !== null && (this.d.type === 4 || this.d.type === 7 || this.d.type === 0)) { sfx.play('UI/BtMouseClick'); this.reply(1, o); }
  }
}

/** Shows a server NPC_TALK and resolves with { action, sel } once the player answers. */
export function npcTalk(mgr, d) {
  return new Promise((resolve) => mgr.show(new NpcDialog(mgr, d, resolve)));
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

/** A menu of choices in the NPC dialog (#L options); resolves with the chosen index or null. */
export async function npcMenu(mgr, npcId, text, options) {
  const body = `${text}\n${options.map((o, i) => `#L${i}#${o}#l`).join('\n')}`;
  const r = await npcTalk(mgr, { npc: npcId, type: 4, text: body });
  return r.action === 1 ? r.sel : null;
}

// ==================================================================== notices
/**
 * Basic.img Notice3 / YesNo3: 266 wide; t (21) / c (20, tiled) / s (55). The blue box holds the
 * (white) text, the band in s holds the 65x24 buttons. kind: 'notice' | 'yesno' | 'number'.
 */
export class MessageBox extends Win {
  constructor(mgr, kind, text, done, opts = {}) {
    super(mgr, null, 0, 0);
    this.buttons = [];
    const B = mgr.B;
    this.kind = kind; this.done = done; this.modal = true; this.opts = opts;
    this.F = kind === 'notice' ? B.Notice3 : B.YesNo3;
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
  key(e) { if (e.key === 'Enter') this.finish(true); else if (e.key === 'Escape') this.finish(this.kind === 'notice'); }
  body(ctx) {
    const m = this.mgr, t = m.image(this.F.t), c = m.image(this.F.c), s = m.image(this.F.s);
    if (!t || !c || !s) return;
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

// ==================================================================== shop
/**
 * Shop.img backgrnd 463x339: two panels - the NPC's goods (x 5-225) and your inventory (x 233-453).
 * Headers y 5-83 with a shadow where the NPC / your character stands (feet at x 51 / 279, y 74);
 * meso box x 358-447 y 64-79. Tab strips y 87-115 (red rule ~117). Lists: 5 rows of 35px every 40
 * from y 125 - an icon cell (x +0..35) and the text area, where Shop/select (162x35) marks the choice.
 */
const SHOP_ROWS = 5, SHOP_ROW_Y = 125, SHOP_ROW_H = 40;
const SELL_TABS = [1, 2, 3, 4, 5];
export class ShopWin extends Win {
  constructor(mgr, shop) {
    const S = mgr.W.Shop;
    super(mgr, S.backgrnd, Math.round((800 - 463) / 2), 60);
    this.buttons = [];
    this.S = S; this.shop = shop; this.tab = 2; this.firstBuy = 0; this.firstSell = 0; this.selBuy = -1; this.selSell = -1;
    this.button(S.BtExit, 132, 14, () => this.close());
    this.button(S.BtBuy, 132, 42, () => this.buy());
    this.button(S.BtSell, 362, 14, () => this.sell());
    this.recharge = this.button(S.BtRecharge, 362 + 50, 38, () => this.doRecharge());
    mgr.assets.json(`Npc/${pad(shop.npc, 7)}.img`).then(async (n) => {
      if (n?.info?.link) n = (await mgr.assets.json(`Npc/${pad(n.info.link, 7)}.img`)) || n;
      const st = n?.stand?.[0] || n?.stand;
      if (st?._canvas) { await mgr.assets.preload([st]); this.face = st; }
    });
    for (const it of shop.items) itemInfo(mgr.assets, it.id).then((info) => { it.info = info; });
  }
  frames() { return [...super.frames(), this.S.select, this.S.meso, ...allCanvases(this.S.TabSell), ...allCanvases(this.S.TabBuy)]; }
  close() { this.mgr.close(this); this.g.net?.shopClose(); this.g.shopWin = null; }
  key(e) { if (e.key === 'Escape') this.close(); }
  result(code) {
    const msg = { 2: 'You do not have enough mesos.', 3: 'Please check if your inventory is full.', 5: 'You cannot sell this item.' }[code];
    if (msg) this.mgr.notice(msg);
  }
  sellItems() {
    const inv = this.g.inventory?.[this.tab] || {};
    return Object.entries(inv).map(([pos, it]) => ({ pos: Number(pos), it })).sort((a, b) => a.pos - b.pos);
  }
  async buy(idx = this.selBuy) {
    const it = this.shop.items[idx];
    if (!it) return;
    let qty = 1;
    if (!it.recharge && invType(it.id) !== 1) {
      const max = Math.max(1, Math.min(it.info?.slotMax || 100, Math.floor(this.g.meso / Math.max(1, it.price))));
      qty = await this.mgr.askNumber(`How many #t${it.id}# would you like to buy?\n(1 ~ ${max})`, 1, 1, max);
      if (!qty) return;
    } else if (!(await this.mgr.confirm(`Are you sure you want to buy #t${it.id}#?`))) return;
    this.g.net?.shopBuy(idx, it.id, qty);
  }
  async sell(idx = this.selSell) {
    const row = this.sellItems()[idx];
    if (!row) return;
    const { pos, it } = row;
    let qty = 1;
    if (it.quantity > 1 && !isRechargeable(it.id)) {
      qty = await this.mgr.askNumber(`How many #t${it.id}# would you like to sell?\n(1 ~ ${it.quantity})`, it.quantity, 1, it.quantity);
      if (!qty) return;
    } else if (!(await this.mgr.confirm(`Are you sure you want to sell #t${it.id}#?`))) return;
    this.g.net?.shopSell(pos, it.id, qty);
  }
  doRecharge() {
    const row = this.sellItems()[this.selSell];
    if (row && isRechargeable(row.it.id) && this.shop.items.some((s) => s.recharge)) this.g.net?.shopRecharge(row.pos);
  }
  rowAt(lx, ly, left) {
    const x0 = left ? 5 : 233;
    if (lx < x0 || lx > x0 + 208 || ly < SHOP_ROW_Y) return -1;
    const i = Math.floor((ly - SHOP_ROW_Y) / SHOP_ROW_H);
    if (i >= SHOP_ROWS || (ly - SHOP_ROW_Y) % SHOP_ROW_H >= 35) return -1;
    const idx = (left ? this.firstBuy : this.firstSell) + i;
    return idx < (left ? this.shop.items.length : this.sellItems().length) ? idx : -1;
  }
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), g = this.g;
    // the NPC and you, standing on the header shadows
    const face = im(this.face);
    if (face) { const o = this.face.origin || [face.width / 2, face.height]; ctx.drawImage(face, Math.round(51 - o[0]), Math.round(74 - o[1])); }
    if (g.look) drawParts(ctx, m.assets, g.look.compose(g.look.standAction(), 0), 279, 74, false);
    const npcName = m.strings.npc?.[this.shop.npc]?.name;
    if (npcName) nameTag(ctx, npcName, 51, 76, '#fff');
    nameTag(ctx, g.player.name, 279, 76, '#fff');
    const meso = im(this.S.meso);
    if (meso) ctx.drawImage(meso, 345, 66);
    this.text(ctx, (g.meso || 0).toLocaleString('en-US'), 444, 66, { align: 'right' });
    // tabs: the goods have one list ("All"); your side has Equip / Use / Set-up / Etc / Cash
    const allTab = im(this.S.TabBuy.enabled[0]);
    if (allTab) ctx.drawImage(allTab, 12, 99);
    let tx = 240;
    SELL_TABS.forEach((t, i) => {
      const n = this.S.TabSell[t === this.tab ? 'enabled' : 'disabled'][i], ti = im(n);
      if (ti) { ctx.drawImage(ti, tx, 99); this[`tabX${t}`] = [tx, ti.width]; tx += ti.width + 12; }
    });
    // goods
    for (let i = 0; i < SHOP_ROWS; i++) {
      const idx = this.firstBuy + i, it = this.shop.items[idx];
      if (!it) break;
      const y = SHOP_ROW_Y + i * SHOP_ROW_H;
      if (idx === this.selBuy) { const s = im(this.S.select); if (s) ctx.drawImage(s, 42, y); }
      m.drawIcon(ctx, m.icon(it.id), 7, y + 1);
      this.text(ctx, m.itemName(it.id), 46, y + 4, { bold: true });
      this.text(ctx, it.price ? `${it.price.toLocaleString('en-US')} mesos` : 'Free', 46, y + 19);
    }
    this.scrollbar(ctx, 212, 121, 200, this.firstBuy, this.shop.items.length, SHOP_ROWS);
    // your items
    const rows = this.sellItems();
    for (let i = 0; i < SHOP_ROWS; i++) {
      const idx = this.firstSell + i, r = rows[idx];
      if (!r) break;
      const y = SHOP_ROW_Y + i * SHOP_ROW_H;
      if (idx === this.selSell) { const s = im(this.S.select); if (s) ctx.drawImage(s, 270, y); }
      m.drawIcon(ctx, m.icon(r.it.id), 235, y + 1);
      if (r.it.quantity > 1) m.count(ctx, r.it.quantity, 235, y + 22);
      this.text(ctx, m.itemName(r.it.id), 274, y + 4, { bold: true });
      const info = m.info(r.it.id);
      this.text(ctx, info?.price ? `${info.price.toLocaleString('en-US')} mesos` : '', 274, y + 19);
    }
    this.scrollbar(ctx, 440, 121, 200, this.firstSell, rows.length, SHOP_ROWS);
    const sel = rows[this.selSell];
    this.recharge.visible = !!sel && isRechargeable(sel.it.id) && this.shop.items.some((s) => s.recharge);
  }
  down(lx, ly) {
    for (const t of SELL_TABS) {
      const tx = this[`tabX${t}`];
      if (tx && lx >= tx[0] - 4 && lx < tx[0] + tx[1] + 4 && ly >= 90 && ly < 116) { this.tab = t; this.firstSell = 0; this.selSell = -1; sfx.play('UI/Tab'); return; }
    }
    let s = this.scrollClick(lx, ly, 212, 121, 200, this.firstBuy, this.shop.items.length, SHOP_ROWS);
    if (s !== null) { this.firstBuy = s; return; }
    s = this.scrollClick(lx, ly, 440, 121, 200, this.firstSell, this.sellItems().length, SHOP_ROWS);
    if (s !== null) { this.firstSell = s; return; }
    const b = this.rowAt(lx, ly, true);
    if (b >= 0) { this.selBuy = b; return; }
    const v = this.rowAt(lx, ly, false);
    if (v >= 0) this.selSell = v;
  }
  dblclick(lx, ly) {
    const b = this.rowAt(lx, ly, true);
    if (b >= 0) { this.selBuy = b; this.buy(b); return; }
    const v = this.rowAt(lx, ly, false);
    if (v >= 0) { this.selSell = v; this.sell(v); }
  }
  wheel(dy) {
    const left = this.mgr.mouse.x - this.x < 230, d = Math.sign(dy);
    if (left) this.firstBuy = Math.max(0, Math.min(this.shop.items.length - SHOP_ROWS, this.firstBuy + d));
    else this.firstSell = Math.max(0, Math.min(this.sellItems().length - SHOP_ROWS, this.firstSell + d));
  }
  tooltip(lx, ly) {
    const b = this.rowAt(lx, ly, true);
    if (b >= 0 && lx < 42) return { item: { id: this.shop.items[b].id } };
    const v = this.rowAt(lx, ly, false);
    if (v >= 0 && lx < 270) return { item: this.sellItems()[v].it };
    return null;
  }
}
const isRechargeable = (id) => [207, 233].includes(Math.floor(id / 10000));

// ==================================================================== item tooltip
/**
 * The v83 item tooltip: name, then the icon beside the REQ LEV / STR / DEX / INT / LUK / POP lines
 * drawn with ToolTip/Equip Can (met) or Cannot (not met) sprites and digits, the job row
 * (beginner .. pirate), then category, attack speed, stats, upgrade slots and the description.
 */
const JOBS = [['beginner', 0], ['warrior', 1], ['magician', 2], ['bowman', 4], ['thief', 8], ['pirate', 16]];
const REQS = [['reqLEV', 'reqLevel', 'level'], ['reqSTR', 'reqSTR', 'str'], ['reqDEX', 'reqDEX', 'dex'], ['reqINT', 'reqINT', 'int'], ['reqLUK', 'reqLUK', 'luk'], ['reqPOP', 'reqPOP', 'fame']];
const STATS = [['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK'], ['hp', 'MaxHP'], ['mp', 'MaxMP'], ['watk', 'Weapon Attack'],
  ['matk', 'Magic Attack'], ['wdef', 'Weapon Defense'], ['mdef', 'Magic Defense'], ['acc', 'Accuracy'], ['avoid', 'Avoidability'],
  ['hands', 'Hands'], ['speed', 'Speed'], ['jump', 'Jump']];
const BASE_STATS = { str: 'incSTR', dex: 'incDEX', int: 'incINT', luk: 'incLUK', hp: 'incMHP', mp: 'incMMP', watk: 'incPAD', matk: 'incMAD',
  wdef: 'incPDD', mdef: 'incMDD', acc: 'incACC', avoid: 'incEVA', hands: 'incCraft', speed: 'incSpeed', jump: 'incJump' };
const CATEGORY = { 130: 'One-Handed Sword', 131: 'One-Handed Axe', 132: 'One-Handed Blunt Weapon', 133: 'Dagger', 137: 'Wand', 138: 'Staff',
  140: 'Two-Handed Sword', 141: 'Two-Handed Axe', 142: 'Two-Handed Blunt Weapon', 143: 'Spear', 144: 'Pole Arm', 145: 'Bow', 146: 'Crossbow',
  147: 'Claw', 148: 'Knuckle', 149: 'Gun', 100: 'Hat', 101: 'Face Accessory', 102: 'Eye Accessory', 103: 'Earrings', 104: 'Top', 105: 'Overall',
  106: 'Bottom', 107: 'Shoes', 108: 'Gloves', 109: 'Shield', 110: 'Cape', 111: 'Ring', 112: 'Pendant', 113: 'Belt', 114: 'Medal' };
const SPEED = { 2: 'Faster', 3: 'Faster', 4: 'Fast', 5: 'Fast', 6: 'Normal', 7: 'Slow', 8: 'Slow', 9: 'Slower' };

export function drawItemTip(ctx, mgr, it, mx, my) {
  const T = mgr.W.ToolTip?.Equip, g = mgr.game, s = g.stats || {};
  const info = mgr.info(it.id), equip = invType(it.id) === 1;
  const name = mgr.itemName(it.id) || '...';
  const desc = String(mgr.desc(it.id) || '').replace(/\\n/g, '\n');
  ctx.save();
  ctx.font = '11px Arial, sans-serif';
  const W = 236;
  const lines = [];
  if (equip) {
    const cat = CATEGORY[Math.floor(it.id / 10000)];
    if (cat) lines.push(`Category : ${cat}`);
    if (info?.attackSpeed) lines.push(`Attack Speed : ${SPEED[info.attackSpeed] || 'Normal'}`);
    for (const [k, label] of STATS) { const v = it[k] ?? info?.[BASE_STATS[k]]; if (v) lines.push(`${label} : +${v}`); }
    const slots = it.slots ?? info?.tuc;
    if (slots !== undefined) lines.push(`Number of upgrades available : ${slots}`);
  }
  const descLines = desc ? richText(ctx, desc, W - 16, textRef(mgr), { base: '#fff' }) : null;
  const reqRows = equip ? REQS.filter(([, key]) => key === 'reqLevel' || info?.[key]) : [];
  const head = equip ? Math.max(38, reqRows.length * 9 + 4) + 18 : 38;
  const h = 26 + head + lines.length * 14 + (descLines ? descLines.height + 4 : 0) + 6;
  const x = Math.min(mx, 800 - W - 2), y = Math.min(my, 600 - h - 2);
  ctx.fillStyle = 'rgba(10,14,28,0.86)'; ctx.fillRect(x, y, W, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.strokeRect(x + 0.5, y + 0.5, W - 1, h - 1);
  uiText(ctx, name, x + W / 2, y + 6, { color: '#fff', bold: true, size: 12, align: 'center' });
  let cy = y + 26;
  // icon box
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(x + 8, cy, 38, 38);
  const ic = mgr.icon(it.id);
  if (ic) mgr.drawIcon(ctx, ic, x + 11, cy + 3);
  if (equip && T) {
    // requirement lines: label + value in Can (met, white) or Cannot (red) sprites
    reqRows.forEach(([sprite, key, stat], i) => {
      const need = info?.[key] || 0, ok = (s[stat] ?? 0) >= need;
      const set = ok ? T.Can : T.Cannot;
      const label = mgr.image(set[sprite]);
      if (label) ctx.drawImage(label, x + 56, cy + i * 9);
      let dx = x + 56 + 48;
      for (const ch of String(need)) { const d = mgr.image(set[ch]); if (d) { ctx.drawImage(d, dx, cy + i * 9); dx += d.width + 1; } }
    });
    // job row
    // job row: jobs the item allows in Can, the rest in Cannot (reqJob 0 = everyone, -1 = beginners)
    const req = info?.reqJob || 0;
    let jx = x + 8;
    const jy = cy + head - 16;
    for (const [job, bit] of JOBS) {
      const allowed = req === 0 || (bit ? (req > 0 && (req & bit)) : req === -1);
      const sp = mgr.image((allowed ? T.Can : T.Cannot)[job]);
      if (sp) { ctx.drawImage(sp, jx, jy); jx += sp.width + 4; }
    }
  }
  cy += head;
  for (const l of lines) { uiText(ctx, l, x + 10, cy, { color: '#fff', size: 11 }); cy += 14; }
  if (descLines) drawRich(ctx, descLines, x + 8, cy + 2, { drawIcon: (n, ix, iy) => mgr.drawIcon(ctx, n, ix, iy) });
  ctx.restore();
}
