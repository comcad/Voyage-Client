import { jobName } from '../data.js';
import { pad, frames } from '../assets.js';
import { nameTag } from '../map.js';
import { drawParts } from '../character.js';
import { Win, allCanvases } from './windows.js';
import { UI_W, UI_H } from '../view.js';

// ==================================================================== guild emblems
const MARK_KIND = { 2: 'Animal', 3: 'Plant', 4: 'Pattern', 5: 'Letter', 9: 'Etc' };
/** UI/GuildMark.img: a 17x17 BackGround/<bg>/<colour> with Mark/<kind>/<logo>/<colour> centred on it. */
export function drawEmblem(ctx, game, e, x, y) {
  const M = game.guildMarks;
  if (!M || !e || (!e.bg && !e.logo)) return false;
  const bg = game.assets.image(M.BackGround?.[pad(e.bg, 8)]?.[e.bgColor]);
  const mark = game.assets.image(M.Mark?.[MARK_KIND[Math.floor(e.logo / 1000)]]?.[pad(e.logo, 8)]?.[e.logoColor]);
  if (bg) ctx.drawImage(bg, x, y);
  if (mark) ctx.drawImage(mark, x + ((17 - mark.width) >> 1), y + ((17 - mark.height) >> 1));
  return true;
}
/** The guild name tag under a character's name, with an 18px strip on its left for the emblem; returns its height. */
export function drawGuildTag(ctx, game, name, emblem, x, y) {
  const { left, h } = nameTag(ctx, name, x, y, '#fff', { icon: emblem && (emblem.bg || emblem.logo) ? 18 : 0 });
  drawEmblem(ctx, game, emblem, left, y - 1);
  return h;
}

/**
 * The HP bar over the other party members on this map: 52x10 at (-26, -89) from their feet, black / white / black
 * frames round a red fill 46px wide at full HP with a #A00300 line at y 6; empty until their first HP update.
 */
export function drawPartyHp(ctx, game, cam) {
  const party = game.party;
  if (!party) return;
  for (const m of party.members) {
    if (m.id === game.player.id) continue;
    const e = game.others.get(m.id);
    if (!e || e.hidden) continue;
    const x = Math.round(e.x - cam.x) - 26, y = Math.round(e.y - cam.y) - 89;
    const f = Math.max(0, Math.min(46, Math.floor(((m.hp || 0) * 46) / Math.max(1, m.maxHp || 0))));
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, 52, 10);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y + 1, 50, 8);
    ctx.fillStyle = '#000'; ctx.fillRect(x + 2, y + 2, 48, 6);
    if (!f) continue;
    ctx.fillStyle = '#FF0000'; ctx.fillRect(x + 3, y + 3, f, 4);
    ctx.fillStyle = '#A00300'; ctx.fillRect(x + 3, y + 6, f, 1);
  }
}

// ==================================================================== player menu
/**
 * ContextMenu (right-click on a player), 100 wide and (rows + 2) * 15 tall: t (the name bar), a c row every 15px
 * from y 23, then s. Its buttons sit at x 9 from y 24, 15px apart: Info, Save (the name to the clipboard, then the
 * chat box opens), Trade, Whisper, Party (only without a party or as its leader), Guild invite (only as the Guild
 * Master or a Jr. Master), Report, and Family (only with room for another junior). It opens at the click, kept
 * on an 800x600 screen (x 700 at most, the bottom at 600). Report opens the Report window on them.
 */
export class PlayerMenu extends Win {
  constructor(mgr, target, x, y) {
    super(mgr, null, 0, 0);
    this.buttons = [];
    this.M = mgr.W.ContextMenu; this.target = target; this.transient = true;
    const g = this.g, M = this.M, name = target.name;
    const guildRank = g.guild?.members?.find((m) => m.id === g.player.id)?.rank;
    const items = [
      [M.BtInfo, () => g.requestCharInfo(target.id)],
      [M.BtSave, () => { navigator.clipboard?.writeText(name).catch(() => {}); g.statusBar.focusChat(); }],
      [M.BtTrade, () => g.requestTrade(target)],
      [M.BtWhisper, () => g.statusBar.focusChat(`/w ${name} `)],
      (!g.party || g.party.leader === g.player.id) && [M.BtParty, () => { if (!g.party) g.net?.partyOp(1); g.net?.partyOp(4, name); }],
      g.guild && (guildRank === 1 || guildRank === 2) && [M.BtGuild, () => g.net?.guildOp(5, name)],
      [M.BtClaim, () => g.openReport(name)],
      g.family && g.family.juniors < g.family.maxJuniors && [M.BtFamily, () => g.net?.familyAdd(name)],
    ].filter(Boolean);
    this.rows = items.length;
    this.w = 100; this.h = (items.length + 2) * 15;
    this.x = x + 100 > UI_W ? UI_W - 100 : x; this.y = y + this.h > UI_H ? UI_H - this.h : y;
    items.forEach(([node, fn, on = true], i) => {
      const b = this.button(node, 9, 24 + i * 15, () => { this.mgr.close(this); fn(); });
      b.enabled = on;
    });
  }
  frames() { return [...allCanvases(this.M)]; }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  body(ctx) {
    const im = (n) => this.mgr.image(n), t = im(this.M.t), c = im(this.M.c), s = im(this.M.s);
    if (!t || !c || !s) return;
    ctx.drawImage(t, 0, 0);
    for (let i = 0; i < this.rows; i++) ctx.drawImage(c, 0, 23 + i * 15);
    ctx.drawImage(s, 0, 23 + this.rows * 15);
    this.text(ctx, this.target.name, 50, 6, { color: '#fff', bold: true, align: 'center' });
  }
}

// ==================================================================== character info
/**
 * UserInfo, 275 wide, measured from the art:
 *   backgrnd (199 tall): portrait box x 7-98 y 26-166, name bar y 147-163, shadow at (52, 133); LEVEL / JOB /
 *     FAME / GUILD / ALLIANCE labels x 104-150 with values from x 157 at row centres 84 / 102 / 120 / 138 / 156;
 *     the blue header takes REQ.PARTY / REQ.TRADE (x 148) and ITEM / WISHLIST (x 208) at y 21 / 42;
 *     the bottom band (y 170-196) holds TAMING MOB / PET INFO / COLLECTION / EXCLUDED.
 *   Those four open a taller frame with the same top 160 px: backgrnd5 (taming, 362), backgrnd2 (pets, 399),
 *     backgrnd7 (Monster Book and medals, 404); the button band moves to the new bottom.
 *   backgrnd4 ITEM LIST / backgrnd3 WISH LIST (240x162) open beside it: rows every 40 from y 31, icon cell
 *     x 15-50, name from x 55 over a rule at +17, ReqLv / price under it; scrollbar at x 220.
 */
const INFO_PANELS = {
  none: { bg: 'backgrnd', band: 170 },
  taming: { bg: 'backgrnd5', band: 336 },
  pet: { bg: 'backgrnd2', band: 374 },
  book: { bg: 'backgrnd7', band: 377 },
};
const SIDE_X = 271, SIDE_ROWS = 3, SIDE_ROW_Y = 31, MESO = 2147483647;
/** Look slots of pet ability items and rings by pet: 31-37 and 47 the second's, 39-45 and 48 the third's, the rest the first's. */
const lookSlotPet = (i) => (i >= 31 && i <= 37) || i === 47 ? 1 : (i >= 39 && i <= 45) || i === 48 ? 2 : 0;
const PET_ROWS = 3, PET_ROW_Y = 215;
export class CharInfoWin extends Win {
  constructor(mgr, info) {
    const U = mgr.W.UserInfo;
    super(mgr, null, 200, 60);
    this.w = 275; this.h = 199;
    this.closePinned = true; this.closeBtn.x = 275 - 17;
    // with a pet out it opens on PET INFO
    this.U = U; this.info = info; this.panel = info.pets?.length ? 'pet' : 'none'; this.side = null; this.sideFirst = 0; this.petSel = 0;
    const g = this.g, other = info.id !== g.player.id;
    const party = this.button(U.BtParty, 148, 21, () => {
      if (!g.party) g.net?.partyOp(1);
      g.net?.partyOp(4, this.name());
    });
    party.enabled = other && (!g.party || g.party.leader === g.player.id);
    const rp = g.others.get(info.id);
    this.button(U.BtTrade, 148, 42, () => { if (rp) g.requestTrade(rp); }).enabled = other && !!rp;
    this.button(U.BtItem, 208, 21, () => this.toggleSide('item'));
    this.button(U.BtWish, 208, 42, () => this.toggleSide('wish'));
    // fame up / down (UI/Basic.img BtUP at (237, 114), BtDown at (252, 114)); both are disabled under level 15 and
    // on your own window, and send by name
    this.fameUp = this.button(mgr.B.BtUP, 237, 114, () => g.giveFame(this.name(), 1));
    this.fameDown = this.button(mgr.B.BtDown, 252, 114, () => g.giveFame(this.name(), 0));
    this.fameUp.enabled = this.fameDown.enabled = other && (g.stats?.level ?? 0) >= 15;
    // the bottom band: each opens its panel (its Hide twin, drawn while open, closes it)
    this.bandBtns = [];
    const band = (show, hide, x, panel) => {
      const on = this.button(show, x, 0, () => this.setPanel(panel)), off = this.button(hide, x, 0, () => this.setPanel('none'));
      this.bandBtns.push({ on, off, panel });
    };
    band(U.BtTamingShow, U.BtTamingHide, 5, 'taming');
    band(U.BtPetShow, U.BtPetHide, 93, 'pet');
    band(U.BtCollectionShow, U.BtCollectionHide, 145, 'book');
    // your pets' item ignore lists (EXCEPTION LIST beside the window)
    const exc = this.button(U.BtExceptionShow, 197, 0, () => this.toggleSide('exc'));
    exc.enabled = !other;
    this.bandBtns.push({ on: exc, off: null, panel: null });
    this.excBtns = [
      this.button(U.BtMeso, SIDE_X + 10, 124, () => this.addExcluded(MESO)),
      this.button(U.BtRegister, SIDE_X + 60, 124, () => this.registerExcluded()),
      this.button(U.BtDelete, SIDE_X + 118, 124, () => this.deleteExcluded()),
    ];
    this.excHide = this.button(U.BtExceptionHide, SIDE_X + 159 - 17, 5, () => this.toggleSide('exc'));
    this.petBtns = [U.BtPet1, U.BtPet2, U.BtPet3].map((n, k) => this.button(n, 168 + 15 + k * 34, 177 + 13, () => { this.petSel = k; this.petFirst = 0; }));
    this.sideClose = this.button(mgr.B.BtClose, SIDE_X + 240 - 17, 6, () => this.toggleSide(this.side));
    // pet portraits (stand0, with the accessory), what each pet wears, and the wish list's catalogue
    this.petArt = []; this.petFirst = 0;
    (info.pets || []).forEach((p, k) => mgr.assets.json(`Item/Pet/${p.id}.img`).then(async (n) => {
      const body = frames(n?.stand0).filter((f) => f?._canvas);
      const acc = p.equip ? frames((await mgr.assets.json(`Character/PetEquip/${pad(p.equip, 8)}.img`))?.[p.id]?.stand0) : [];
      await mgr.assets.preload([...body, ...acc.filter((f) => f?._canvas)]);
      if (body.length) this.petArt[k] = { body, acc };
    }));
    this.petItems = (info.pets || []).map((p, k) => this.petEquips(p, k));
    if (info.wish?.length) mgr.assets.json('Etc/Commodity.img').then((c) => { this.commodity = new Map(Object.values(c || {}).map((x) => [x.SN, x])); });
    this.layout();
  }
  frames() {
    const U = this.U;
    return [...super.frames(), U.backgrnd, U.backgrnd2, U.backgrnd3, U.backgrnd4, U.backgrnd5, U.backgrnd7, U.ReqLv, U.bossPetCrown, ...allCanvases(U.Marry)];
  }
  name() { return this.info.id === this.g.player.id ? this.g.player.name : this.g.others.get(this.info.id)?.name || ''; }
  /** Apply the target's new fame value (from FAME_RESPONSE) to the open window. */
  setFame(v) { this.info.fame = v; }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  setPanel(p) { this.panel = this.panel === p ? 'none' : p; this.layout(); }
  toggleSide(s) { this.side = this.side === s ? null : s; this.sideFirst = 0; this.layout(); }
  layout() {
    const P = INFO_PANELS[this.panel], bg = this.U[P.bg];
    this.h = bg?._h || 199;
    this.w = this.side ? SIDE_X + (this.side === 'exc' ? 159 : 240) : 275;
    for (const b of this.bandBtns) {
      const open = this.panel === b.panel;
      b.on.y = P.band + 5; b.on.visible = !open || !b.off;
      if (b.off) { b.off.y = P.band + 5; b.off.visible = open; }
    }
    const pets = this.info.pets || [];
    this.petBtns.forEach((b, k) => { b.visible = this.panel === 'pet'; b.enabled = k < pets.length; });
    this.sideClose.visible = !!this.side && this.side !== 'exc';
    for (const b of this.excBtns) b.visible = this.side === 'exc';
    this.excHide.visible = this.side === 'exc';
  }

  // ---------------------------------------------------------------- exception list
  /** The pet whose list shows: the one picked in the pet panel. */
  excPet() { return this.g.myPets()[this.petSel] || this.g.myPets()[0] || null; }
  excList() { const p = this.excPet(); return p ? [...(this.g.petExcluded?.get(p.uid) || [])] : []; }
  excName(id) { return id === MESO ? ' mesos' : this.mgr.itemName(id) || String(id); }
  addExcluded(id) {
    const pet = this.excPet(), list = this.excList();
    if (!pet || list.includes(id) || list.length >= 10) return;
    list.push(id);
    list.sort((a, b) => this.excName(a).localeCompare(this.excName(b)));
    this.g.setPetExcluded(pet, list);
  }
  async registerExcluded() {
    const name = (await this.mgr.askText('Enter the name of the item to ignore.'))?.trim().toLowerCase();
    if (!name) return;
    const inv = this.g.inventory || {};
    for (const t of [1, 2, 3, 4, 5]) for (const it of Object.values(inv[t] || {})) if (this.mgr.itemName(it.id).toLowerCase() === name) { this.addExcluded(it.id); return; }
    this.g.notice('That item could not be found.');
  }
  deleteExcluded() {
    const pet = this.excPet(), list = this.excList();
    if (!pet || this.excSel === undefined || this.excSel >= list.length) return;
    list.splice(this.excSel, 1);
    this.excSel = undefined;
    this.g.setPetExcluded(pet, list);
  }
  drawExc(ctx) {
    const m = this.mgr, panel = m.image(this.U.backgrnd6);
    if (panel) ctx.drawImage(panel, SIDE_X, 0);
    const pet = this.excPet(), list = this.excList();
    if (!pet) { this.text(ctx, 'No pets are out.', SIDE_X + 80, 60, { align: 'center', color: '#555' }); return; }
    for (let k = 0; k < 6; k++) {
      const i = this.sideFirst + k, id = list[i];
      if (id === undefined) break;
      if (i === this.excSel) { ctx.fillStyle = 'rgba(80,120,200,0.35)'; ctx.fillRect(SIDE_X + 8, 24 + k * 14, 140, 14); }
      this.text(ctx, this.excName(id), SIDE_X + 10, 25 + k * 14, { size: 12 });
    }
    this.scrollbar(ctx, SIDE_X + 147, 22, 90, this.sideFirst, list.length, 6);
  }

  // ---------------------------------------------------------------- lists
  /**
   * What the ITEM LIST shows, slot by slot (not the pet accessory or the mount's): at the weapon the cash weapon
   * first, then in each slot the item hidden under a cash one, then the one shown (pet ability items left out).
   */
  equipped() {
    const { shown, hidden, cashWeapon } = this.slots(), out = [];
    for (let i = 1; i < 52; i++) {
      if (i === 14 || i === 18 || i === 19 || i === 20) continue;
      if (i === 11 && Math.floor(cashWeapon / 100000) === 17) out.push(cashWeapon);
      const h = hidden(i), v = shown(i);
      if (h > 0) out.push(h);
      if (v > 0 && Math.floor(v / 10000) !== 181) out.push(v);
    }
    return out;
  }
  /** By look slot: the item shown there, the one hidden under it, and the cash weapon (yours from your inventory). */
  slots() {
    const g = this.g, eq = g.inventory?.equipped || {};
    // yours from your inventory; the cash weapon cover (-111) is listed on its own, so the weapon slot shows the weapon
    if (this.info.id === g.player.id) {
      return { shown: (i) => (i === 11 ? eq[-11]?.id : eq[-(100 + i)]?.id || eq[-i]?.id), hidden: (i) => (i !== 11 && eq[-(100 + i)] ? eq[-i]?.id : 0), cashWeapon: eq[-111]?.id };
    }
    const look = g.others.get(this.info.id)?.lookData;
    return { shown: (i) => look?.equips?.[i], hidden: (i) => look?.masked?.[i], cashWeapon: look?.cashWeapon };
  }
  wishItems() { return (this.info.wish || []).map((sn) => this.commodity?.get(sn)).filter(Boolean); }
  sideRows() { return this.side === 'item' ? this.equipped().map((id) => ({ id })) : this.side === 'wish' ? this.wishItems().map((c) => ({ id: c.ItemId, price: c.Price })) : []; }

  // ---------------------------------------------------------------- frame
  body(ctx) {
    const m = this.mgr, im = (n) => m.image(n), g = this.g, i = this.info, U = this.U;
    const bg = im(U[INFO_PANELS[this.panel].bg]);
    if (bg) ctx.drawImage(bg, 0, 0);
    const hn = U.Marry?.[i.married ? 'married' : 'unmarried'], heart = im(hn?._canvas ? hn : hn?.[0]);
    if (heart) ctx.drawImage(heart, 12, 31);
    // the name in white Arial 12 centred on the bar; level, fame and guild in black Arial 12, the job in Tahoma 9
    this.text(ctx, this.name(), 52, 144, { color: '#fff', align: 'center', size: 12 });
    this.text(ctx, String(i.level), 160, 77, { size: 12 });
    ctx.save(); ctx.font = '9px Tahoma, Verdana, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = '#000';
    ctx.fillText(jobName(i.job).toUpperCase(), 160, 96); ctx.restore();
    this.text(ctx, String(i.fame), 160, 113, { size: 12 });
    this.text(ctx, i.guild || '', 160, 131, { size: 12 });
    this.text(ctx, i.alliance || '', 160, 149, { size: 12 });
    this.drawAvatar(ctx);
    if (this.panel === 'pet') this.drawPet(ctx);
    else if (this.panel === 'taming') this.drawTaming(ctx);
    else if (this.panel === 'book') this.drawBook(ctx);
    if (this.side === 'exc') this.drawExc(ctx);
    else if (this.side) this.drawSide(ctx);
  }
  /** The character standing, animated, over the window (a long weapon or tall hat reaches past its box). */
  drawAvatar(ctx) {
    const g = this.g, i = this.info, me = i.id === g.player.id, look = me ? g.look : g.others.get(i.id)?.look;
    if (!look) return;
    const a = (this.anim ??= { frame: 0, back: false, t: 0, at: performance.now() }), act = look.standAction(), now = performance.now();
    a.t += Math.min(1000, now - a.at); a.at = now;
    for (let n = 0; a.t >= look.delay(act, a.frame) && n < 10; n++) {
      a.t -= look.delay(act, a.frame);
      const f = look.nextFrame(act, a.frame, a.back); a.frame = f.frame; a.back = f.back;
    }
    if (a.frame >= look.frameCount(act)) a.frame = 0;
    drawParts(ctx, g.assets, look.compose(act, a.frame), 52, 133, false);
  }
  /** Name over a rule, a smaller line under it: the rows of every list here. */
  listRow(ctx, x, y, id, sub) {
    const m = this.mgr;
    m.drawIcon(ctx, m.icon(id), x + 2, y + 1, id);   // with the coin on a cash item
    ctx.save(); ctx.beginPath(); ctx.rect(x + 38, y, 170, 36); ctx.clip();
    this.text(ctx, m.itemName(id), x + 40, y + 2, { size: 12 });
    sub?.(x + 40, y + 20);
    ctx.restore();
  }
  drawSide(ctx) {
    const m = this.mgr, U = this.U, panel = m.image(U[this.side === 'item' ? 'backgrnd4' : 'backgrnd3']);
    if (panel) ctx.drawImage(panel, SIDE_X, 0);
    const rows = this.sideRows(), reqLv = m.image(U.ReqLv);
    for (let k = 0; k < SIDE_ROWS; k++) {
      const r = rows[this.sideFirst + k];
      if (!r) break;
      this.listRow(ctx, SIDE_X + 15, SIDE_ROW_Y + k * 40, r.id, (x, y) => {
        if (r.price !== undefined) { this.text(ctx, `${r.price.toLocaleString('en-US')} NX`, x, y, { size: 12 }); return; }
        if (reqLv) ctx.drawImage(reqLv, x, y + 2);
        this.text(ctx, String(m.info(r.id)?.reqLevel ?? 0), x + 36, y, { size: 12 });
      });
    }
    if (!rows.length) this.text(ctx, this.side === 'item' ? 'No items equipped.' : 'The wish list is empty.', SIDE_X + 120, 80, { align: 'center', color: '#555' });
    this.scrollbar(ctx, SIDE_X + 220, 27, 122, this.sideFirst, rows.length, SIDE_ROWS);
  }
  /** A pet's list: its accessory, then the ability items and rings worn for it, in slot order; the potion pouches are shared, so every pet lists them. */
  petEquips(p, k) {
    const g = this.g, self = this.info.id === g.player.id, look = g.others.get(this.info.id)?.lookData;
    const out = p.equip ? [p.equip] : [];
    for (let i = 0; i <= 51; i++) {
      const id = self ? g.inventory?.equipped?.[-(100 + i)]?.id : look?.equips?.[i];
      if (!id || !(Math.floor(id / 10000) === 181 || id === 1822000 || id === 1832000)) continue;
      if (id === 1812002 || id === 1812003 || lookSlotPet(i) === k) out.push(id);
    }
    return out;
  }
  /** The pet's stand0 frame (and its accessory's) for now. */
  petFrame(art) {
    const total = art.body.reduce((t, f) => t + (Number(f.delay) || 100), 0);
    let t = performance.now() % total, i = 0;
    while (i < art.body.length - 1 && t >= (Number(art.body[i].delay) || 100)) t -= Number(art.body[i++].delay) || 100;
    return i;
  }
  drawPet(ctx) {
    const m = this.mgr, pets = this.info.pets || [], p = pets[this.petSel];
    if (!p) { this.text(ctx, 'No pets are out.', 52, 260, { align: 'center', color: '#555' }); return; }
    const art = this.petArt[this.petSel];
    if (art) {
      const i = this.petFrame(art);
      for (const f of [art.body[i], art.acc[i]]) {
        const img = f && m.image(f);
        if (img) { const o = f.origin || [img.width / 2, img.height]; ctx.drawImage(img, Math.round(53 - o[0]), Math.round(299 - o[1])); }
      }
    }
    // the lead pet's crown, on the top edge of the portrait box
    const crown = this.petSel === 0 && m.image(this.U.bossPetCrown);
    if (crown) { const o = this.U.bossPetCrown.origin || [0, 0]; ctx.drawImage(crown, 53 - o[0], 214 - o[1]); }
    this.text(ctx, p.name, 53, 306, { color: '#fff', bold: true, align: 'center', size: 12 });
    const items = this.petItems[this.petSel] || [], reqLv = m.image(this.U.ReqLv);
    for (let k = 0; k < PET_ROWS; k++) {
      const id = items[this.petFirst + k];
      if (!id) break;
      this.listRow(ctx, 105, PET_ROW_Y + k * 38, id, (x, y) => {
        if (reqLv) ctx.drawImage(reqLv, x, y + 2);
        this.text(ctx, String(m.info(id)?.reqLevel ?? 0), x + 36, y, { size: 12 });
      });
    }
    this.scrollbar(ctx, 252, PET_ROW_Y, 112, this.petFirst, items.length, PET_ROWS);
    const v = (t, x, y) => this.text(ctx, t, x, y - 7, { size: 12 });
    v(m.itemName(p.id), 57, 338); v(String(p.level), 57, 356);
    v(String(p.closeness), 190, 338); v(String(p.fullness), 190, 356);
  }
  drawTaming(ctx) {
    const m = this.mgr, t = this.info.mount;
    const { shown } = this.slots(), ids = [18, 19, 20].map(shown).filter((id) => [190, 191].includes(Math.floor(id / 10000)));
    const mount = ids.find((id) => Math.floor(id / 10000) === 190);
    if (!t) { this.text(ctx, 'No taming mob.', 52, 230, { align: 'center', color: '#555' }); return; }
    if (mount) { const ic = m.icon(mount); if (ic) m.drawIcon(ctx, ic, 37, 228); }
    ids.forEach((id, k) => this.listRow(ctx, 105, 177 + k * 38, id));
    const v = (s, x, y) => this.text(ctx, s, x, y - 7, { size: 12 });
    v(mount ? m.itemName(mount) : '', 57, 300); v(String(t.level), 57, 319);
    v(String(t.exp), 190, 300); v(String(t.tiredness), 190, 319);
  }
  drawBook(ctx) {
    const m = this.mgr, g = this.g, b = this.info.book || {}, v = (s, x, y) => this.text(ctx, s, x, y - 7, { size: 12 });
    v(String(b.level ?? 0), 100, 186);
    v(b.cover ? m.strings.mob?.[b.cover]?.name || '' : '', 100, 204);
    v(String(b.total ?? 0), 100, 222); v(String(b.normal ?? 0), 166, 222); v(String(b.special ?? 0), 234, 222);
    if (this.info.medal) { const ic = m.icon(this.info.medal); if (ic) m.drawIcon(ctx, ic, 8, 246); v(m.itemName(this.info.medal), 100, 252); }
    const quests = this.info.medalQuests || [];
    v(String(quests.length), 100, 270);
    quests.slice(this.medalFirst || 0, (this.medalFirst || 0) + 4).forEach((q, k) => v(g.quests?.name(q) || `Quest ${q}`, 52, 305 + k * 18));
    this.scrollbar(ctx, 254, 297, 72, this.medalFirst || 0, quests.length, 4);
  }

  // ---------------------------------------------------------------- mouse
  sideRowAt(lx, ly) {
    if (!this.side || lx < SIDE_X + 15 || lx >= SIDE_X + 50 || ly < SIDE_ROW_Y) return -1;
    const k = Math.floor((ly - SIDE_ROW_Y) / 40);
    if (k >= SIDE_ROWS || (ly - SIDE_ROW_Y) % 40 >= 36) return -1;
    const idx = this.sideFirst + k;
    return idx < this.sideRows().length ? idx : -1;
  }
  drop(lx, ly, c) { if (this.side === 'exc' && lx >= SIDE_X && c.kind === 'item') this.addExcluded(c.id); }
  down(lx, ly) {
    if (this.side === 'exc') {
      const s = this.scrollClick(lx, ly, SIDE_X + 147, 22, 90, this.sideFirst, this.excList().length, 6);
      if (s !== null) { this.sideFirst = s; return; }
      const k = Math.floor((ly - 24) / 14);
      if (lx >= SIDE_X + 8 && lx < SIDE_X + 147 && k >= 0 && k < 6) this.excSel = this.sideFirst + k;
    } else if (this.side) {
      const s = this.scrollClick(lx, ly, SIDE_X + 220, 27, 122, this.sideFirst, this.sideRows().length, SIDE_ROWS);
      if (s !== null) { this.sideFirst = s; return; }
    }
    if (this.panel === 'pet') {
      const s = this.scrollClick(lx, ly, 252, PET_ROW_Y, 112, this.petFirst, (this.petItems[this.petSel] || []).length, PET_ROWS);
      if (s !== null) this.petFirst = s;
    }
    if (this.panel === 'book') {
      const s = this.scrollClick(lx, ly, 254, 297, 72, this.medalFirst || 0, (this.info.medalQuests || []).length, 4);
      if (s !== null) this.medalFirst = s;
    }
  }
  wheel(dy) {
    const d = Math.sign(dy), lx = this.mgr.mouse.x - this.x;
    if (this.side === 'exc' && lx >= SIDE_X) this.sideFirst = Math.max(0, Math.min(this.excList().length - 6, this.sideFirst + d));
    else if (this.side && lx >= SIDE_X) this.sideFirst = Math.max(0, Math.min(this.sideRows().length - SIDE_ROWS, this.sideFirst + d));
    else if (this.panel === 'pet') this.petFirst = Math.max(0, Math.min((this.petItems[this.petSel] || []).length - PET_ROWS, this.petFirst + d));
    else if (this.panel === 'book') this.medalFirst = Math.max(0, Math.min((this.info.medalQuests || []).length - 4, (this.medalFirst || 0) + d));
  }
  tooltip(lx, ly) {
    if (this.side === 'exc') return null;
    if (this.panel === 'pet' && lx >= 105 && lx < 141 && ly >= PET_ROW_Y && ly < PET_ROW_Y + PET_ROWS * 38 && (ly - PET_ROW_Y) % 38 < 36) {
      const id = (this.petItems[this.petSel] || [])[this.petFirst + Math.floor((ly - PET_ROW_Y) / 38)];
      if (id) return { item: { id } };
    }
    const r = this.sideRowAt(lx, ly);
    return r >= 0 ? { item: { id: this.sideRows()[r].id } } : null;
  }
}
