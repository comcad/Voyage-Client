import { sfx } from '../audio.js';
import { Anim } from '../map.js';
import { itemInfo, scrollFits } from '../data.js';
import { Win } from './windows.js';
import { UI_W, UI_H } from '../view.js';
import { CHAT_COLOR } from './statusbar.js';

const centred = (bg) => [Math.round((UI_W - (bg?._w || 0)) / 2), Math.round((UI_H - (bg?._h || 0)) / 2)];

/** Window effects: an animation at (x, y) in the window, played once or looped for `ms`. */
class Effects {
  constructor() { this.list = []; this.t = performance.now(); }
  add(node, x, y, loopMs = 0) { if (node) this.list.push({ anim: new Anim(node, loopMs > 0), x, y, until: loopMs ? performance.now() + loopMs : Infinity }); }
  frames() { return []; }
  draw(ctx, mgr) {
    const now = performance.now(), dt = now - this.t; this.t = now;
    this.list = this.list.filter((e) => now < e.until && !e.anim.done);
    for (const e of this.list) {
      e.anim.update(dt);
      const n = e.anim.node, img = n && mgr.image(n);
      if (!img) continue;
      const o = n.origin || [0, 0];
      ctx.save(); ctx.globalAlpha *= e.anim.alpha; ctx.drawImage(img, e.x - o[0], e.y - o[1]); ctx.restore();
    }
  }
}
const preloadAll = (mgr, nodes) => mgr.assets.preload(nodes.filter(Boolean).flatMap((n) => new Anim(n).frames));

/**
 * The Remote Gachapon ticket (RemoteGachapon/backgrnd, centred): a town button each - Bt0 Henesys (15, 113), Bt1
 * Ellinia (128, 113), Bt2 Perion (15, 134), Bt3 Kerning City (128, 134), Bt4 Sleepywood (128, 155), Bt5 Mushroom
 * Shrine (15, 176), Bt6 Showa Spa M (15, 197), Bt7 Showa Spa F (128, 197), Bt8 NLC (128, 176), Bt9 Nautilus (15, 155);
 * Basic BtClose at (227, 8). A town sends USE_REMOTE with its index and closes.
 */
const TOWNS = [[15, 113], [128, 113], [15, 134], [128, 134], [128, 155], [15, 176], [15, 197], [128, 197], [128, 176], [15, 155]];
export class RemoteGachaponWin extends Win {
  constructor(mgr, itemId) {
    const R = mgr.W.RemoteGachapon;
    super(mgr, R.backgrnd, ...centred(R.backgrnd));
    this.closeBtn.visible = false;
    this.button(mgr.B.BtClose, 227, 8, () => mgr.close(this));
    TOWNS.forEach(([x, y], i) => this.button(R[`Bt${i}`], x, y, () => { this.g.net?.useRemote(itemId, i); mgr.close(this); }));
  }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
}

/**
 * Scissors of Karma (KarmaScissors/backgrnd, centred): drop an item on it (not sealed, tradeAvailable), its icon at (74, 126); BtOK2 at (72, 153) sends USE_CASH_ITEM (tab, slot) and says so in the chat log;
 * Basic BtClose at (158, 8).
 */
export class KarmaWin extends Win {
  constructor(mgr, slot, itemId) {
    const bg = mgr.W.KarmaScissors.backgrnd;
    super(mgr, bg, ...centred(bg));
    this.closeBtn.visible = false; this.slot = slot; this.itemId = itemId; this.pick = null;
    this.button(mgr.B.BtOK2, 72, 153, () => this.ok());
    this.button(mgr.B.BtClose, 158, 8, () => mgr.close(this));
  }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  async drop(lx, ly, c) {
    if (c?.kind !== 'item' || typeof c.tab !== 'number') return;
    const it = this.g.inventory?.[c.tab]?.[c.slot];
    if (!it) return;
    if (it.flag & 1) { this.mgr.notice('You must break the seal first.'); return; }
    if (!Number((await itemInfo(this.g.assets, it.id))?.tradeAvailable)) { this.mgr.notice('This item cannot be used.'); return; }
    this.pick = { tab: c.tab, slot: c.slot, id: it.id };
  }
  ok() {
    const p = this.pick;
    if (!p) return;
    if (!this.g.canExclusive(500)) { this.mgr.notice('Other requests are in process.\r\nPlease try again in a little bit.'); return; }
    this.g.net?.useCashItem(this.slot, this.itemId, (w) => w.int(p.tab).int(p.slot));
    this.g.lockExclusive(); sfx.play('Game/UseShopItem');
    this.g.hud.message('You have used the Scissors of Karma, so 1 time of trading has been enabled.', CHAT_COLOR.error);
    this.mgr.close(this);
  }
  tooltip(lx, ly) { return this.pick && lx >= 75 && lx <= 102 && ly >= 100 && ly <= 127 ? { item: this.g.inventory?.[this.pick.tab]?.[this.pick.slot] || { id: this.pick.id } } : null; }
  body(ctx) { if (this.pick) this.mgr.drawIcon(ctx, this.mgr.icon(this.pick.id), 74, 94, this.pick.id); }
}

/**
 * Vicious' Hammer (ViciousHammer/backgrnd, centred): drop an equip on it that can take upgrades (not 1122000, not pet
 * equipment or cash, hammered under twice); BtStart (42, 179) sends USE_CASH_ITEM (tab, slot) and runs the gauge
 * (GaugeBar/bar at (6, 152), 1px gauge columns at y 156 filling 59px a second from x 12) with EffectP looping at
 * (91, 81) for 2.7s. VICIOUS_HAMMER answers: a result (0x39...) waits for the gauge, then (on success EffectE at
 * (89, 105) and a second later) USE_HAMMER echoes it; 0x3D / 0x3E close it with their message.
 */
export class HammerWin extends Win {
  constructor(mgr, slot, itemId) {
    const V = mgr.W.ViciousHammer;
    super(mgr, V.backgrnd, ...centred(V.backgrnd));
    this.V = V; this.closeBtn.visible = false; this.slot = slot; this.itemId = itemId;
    this.pick = null; this.state = 0; this.sent = false; this.result = null; this.fx = new Effects();
    this.start = this.button(V.BtStart, 42, 179, () => this.go()); this.start.enabled = false;
    this.cancel = this.button(V.BtCancel, 100, 179, () => mgr.close(this));
  }
  frames() { return [...super.frames(), this.V.GaugeBar.bar, this.V.GaugeBar.gauge]; }
  onOpen() { preloadAll(this.mgr, [this.V.EffectP, this.V.EffectE]); }
  key(e) { if (e.key === 'Escape' && this.state === 0) this.mgr.close(this); }
  async drop(lx, ly, c) {
    if (c?.kind !== 'item' || typeof c.tab !== 'number') return;
    const no = () => this.mgr.notice('The item is not upgradable.');
    const it = this.g.inventory?.[c.tab]?.[c.slot];
    if (!it) return;
    if (c.tab !== 1 || Math.floor(it.id / 1000000) !== 1) { no(); return; }
    if (it.id === 1122000) { this.mgr.notice("You can't use Vicious' Hammer\r\non Horntail Necklace."); return; }
    const tuc = Number((await itemInfo(this.g.assets, it.id))?.tuc) || 0;
    if (!tuc || Math.floor(it.id / 100000) === 18 || it.cashId) { no(); return; }
    if ((it.vicious || 0) >= 2) { this.mgr.notice('2 upgrade increases\r\nhave been used already.'); return; }
    if (this.state !== 0) return;
    this.pick = { tab: c.tab, slot: c.slot, id: it.id, vicious: it.vicious || 0 };
    this.start.enabled = true; this.cancel.enabled = true;
  }
  go() {
    if (!this.pick) { this.mgr.notice('The item is not upgradable.'); return; }
    if (this.sent) { this.mgr.notice('Unknown Error (9).'); return; }
    if (!this.g.canExclusive(500)) { this.mgr.notice('Other requests are in process.\r\nPlease try again in a little bit.'); return; }
    const p = this.pick;
    this.state = 1; this.startAt = performance.now();
    this.g.lockExclusive();
    this.start.enabled = false; this.cancel.enabled = false;
    this.g.net?.useCashItem(this.slot, this.itemId, (w) => w.int(p.tab).int(p.slot));
    this.sent = true;
    this.fx.add(this.V.EffectP, 91, 81, 2700);
    sfx.play('UI/ViciousHammer');
  }
  /** VICIOUS_HAMMER. */
  onResult(e) {
    this.sent = false; this.g.releaseExclusive();
    if (e.mode === 0x3D || e.mode === 0x3E) {
      this.mgr.close(this);
      if (e.mode === 0x3D) this.mgr.notice(e.code === 0 ? `\tIncreased available upgrade by 1. \r\n${2 - (this.result?.count ?? this.pick?.vicious ?? 0)} upgrades are left.` : `Unknown Error (${this.result?.code ?? 0}).`);
      else this.mgr.notice({ 1: 'The item is not upgradable.', 2: '2 upgrade increases\r\nhave been used already.', 3: "You can't use Vicious' Hammer\r\non Horntail Necklace." }[e.code] || `Unknown Error (${this.result?.code ?? 0}).`);
      return;
    }
    this.result = { mode: e.mode, code: e.code, count: e.count };
    if (this.state === 2) this.finish();
  }
  finish() {
    const r = this.result;
    if (r.mode === 0x39 && r.code === 0) { this.fx.add(this.V.EffectE, 89, 105); this.sendAt = performance.now() + 1000; } else this.sendAt = performance.now();
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), now = performance.now();
    if (this.pick) this.mgr.drawIcon(ctx, this.mgr.icon(this.pick.id), 40, 90, this.pick.id);
    const bar = im(this.V.GaugeBar.bar), g = im(this.V.GaugeBar.gauge);
    if (bar) ctx.drawImage(bar, 6, 152);
    let fill = 0;
    if (this.state === 1) {
      fill = Math.floor(59 * (now - this.startAt) / 1000);
      if (fill > 160) { this.state = 2; if (this.result) this.finish(); }
    }
    if (this.state >= 2) fill = 152;
    if (g) for (let x = 12; x <= fill + 11 && x < 164; x++) ctx.drawImage(g, x, 156);
    if (this.state === 2 && this.result && this.sendAt !== undefined && now > this.sendAt) {
      this.state = 3; this.g.net?.useHammer(this.result.mode, this.result.code);
    }
    this.fx.draw(ctx, this.mgr);
  }
}

/**
 * Vega's Spell (VegaSpell/backgrnd10 or backgrnd60, centred): drop an equip with upgrades left and a scroll from
 * Etc/VegaSpell.img whose success is 10 (or 60); their icons at (30, 157) / (117, 157), the rates at y 37
 * (10 -> 30 or 60 -> 90). BtStart (67, 209) sends USE_CASH_ITEM (1, equip slot, 2, scroll slot, 1). VEGA_SCROLL
 * 0x40 / 0x45 starts the spell (gauge at y 182, 63px a second from x 19, EffectSpelling and EffectTwinkling, the
 * VegaTwinkling sound); 0x41 / 0x43 ends it, and once the gauge is full the result window shows (0x40 success).
 */
export class VegaWin extends Win {
  constructor(mgr, slot, itemId, list) {
    const V = mgr.W.VegaSpell, type = itemId % 10 ? 1 : 0, bg = type ? V.backgrnd60 : V.backgrnd10;
    super(mgr, bg, ...centred(bg));
    this.V = V; this.type = type; this.closeBtn.visible = false; this.slot = slot; this.itemId = itemId; this.list = list || [];
    this.equip = null; this.scroll = null; this.state = 0; this.first = null; this.second = null; this.fx = new Effects();
    this.start = this.button(V.BtStart, 67, 209, () => this.go()); this.start.enabled = false;
    this.button(mgr.B.BtClose, 158, 8, () => mgr.close(this));
  }
  frames() { return [...super.frames(), this.V.GaugeBar.gauge, this.V.EffectArrow?.[0], ...Object.values(this.V.Count || {})].filter(Boolean); }
  onOpen() { preloadAll(this.mgr, [this.V.EffectSpelling, this.V.EffectTwinkling, this.V.EffectArrow]); if (!this.list.length) this.mgr.notice('No Vega List'); }
  onClose() { Promise.resolve(this.loop).then((stop) => stop?.()); }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }
  async drop(lx, ly, c) {
    if (c?.kind !== 'item' || typeof c.tab !== 'number') return;
    const it = this.g.inventory?.[c.tab]?.[c.slot], no = () => this.mgr.notice('This item cannot be used.');
    if (!it) return;
    if (c.tab === 1) {
      if (Math.floor(it.id / 1000000) !== 1 || !it.slots) { no(); return; }
      this.equip = { slot: c.slot, id: it.id };
    } else if (c.tab === 2) {
      if (Math.floor(it.id / 10000) !== 204) { no(); return; }
      const bad = () => this.mgr.notice('This scroll cannot be used.');
      if ([2041211, 2041212, 2049100].includes(it.id) || !this.list.includes(it.id)) { bad(); return; }
      if (Number((await itemInfo(this.g.assets, it.id))?.success) !== (this.type ? 60 : 10)) { bad(); return; }
      this.scroll = { slot: c.slot, id: it.id };
    } else { no(); return; }
    if (this.equip && this.scroll) this.start.enabled = true;
  }
  go() {
    if (!this.equip || !this.scroll) { this.mgr.notice('Something wrong!'); return; }
    if (this.g.dead) { this.mgr.notice("You can't do it once you're dead."); return; }
    const eq = this.g.inventory?.[1]?.[this.equip.slot];
    if (eq?.flag & 1) { this.mgr.notice('Sealed items cannot be\r\nsold, traded, or dropped.'); return; }
    if (!scrollFits(this.scroll.id, this.equip.id)) { this.mgr.notice('The item and the scroll cannot be combined.'); return; }
    const e = this.equip, s = this.scroll;
    this.g.net?.useCashItem(this.slot, this.itemId, (w) => w.int(1).int(e.slot).int(2).int(s.slot).int(1));
    this.g.lockExclusive();
    this.start.enabled = false;
    this.fx.add(this.V.EffectArrow, 91, 41, 2500);
  }
  /** VEGA_SCROLL. */
  onResult(v) {
    if (v === 0x40 || v === 0x45) {
      this.first = v; this.state = 1; this.startAt = performance.now();
      this.fx.add(this.V.EffectSpelling, 85, 114, 2500); this.fx.add(this.V.EffectTwinkling, 85, 114, 2500);
      this.loop = sfx.loop('UI/VegaTwinkling');
    } else if (v === 0x41 || v === 0x43) this.second = v;
    else { this.mgr.notice('This item cannot be used.'); this.mgr.close(this); }
  }
  async done() {
    Promise.resolve(this.loop).then((stop) => stop?.());
    const ok = this.first === 0x40;
    if (this.first !== 0x40 && this.first !== 0x45) this.mgr.notice('This item cannot be used.');
    else await this.g.openStep(VegaResultWin, ok, this.equip?.id);
    this.g.releaseExclusive();
    this.mgr.close(this);
  }
  digits(ctx, text, xs) {
    [...text].forEach((d, i) => { const n = this.V.Count?.[d], img = n && this.mgr.image(n); if (img) { const o = n.origin || [0, 0]; ctx.drawImage(img, xs[i] - o[0], 37 - o[1]); } });
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), now = performance.now();
    const arrow = this.V.EffectArrow?.[0], ai = im(arrow);
    if (ai) { const o = arrow.origin || [0, 0]; ctx.drawImage(ai, 80 - o[0], 36 - o[1]); }
    if (this.equip) this.mgr.drawIcon(ctx, this.mgr.icon(this.equip.id), 30, 125, this.equip.id);
    if (this.scroll) {
      this.mgr.drawIcon(ctx, this.mgr.icon(this.scroll.id), 117, 125, this.scroll.id);
      this.digits(ctx, this.type ? '60' : '10', [31, 39]); this.digits(ctx, this.type ? '90' : '30', [123, 131]);
    }
    if (this.equip && this.scroll && this.state) {
      const g = this.V.GaugeBar.gauge, gi = im(g), o = g?.origin || [0, 0];
      let fill = this.state === 1 ? Math.floor(63 * (now - this.startAt) / 1000) : 159;
      if (this.state === 1 && fill > 159) { fill = 159; if (this.second) this.state = 2; }
      if (gi) for (let x = 19; x <= Math.min(fill + 11, 158); x++) ctx.drawImage(gi, x - o[0], 182 - o[1]);
      if (this.state === 2) { this.state = 3; this.done(); }
    }
    this.fx.draw(ctx, this.mgr);
  }
}

/** Vega's result (VegaSpell/SuccessWnd or FailWnd, 152x159, centred): the equip's icon at (60, 97), BtOK at (55, 135). */
export class VegaResultWin extends Win {
  constructor(mgr, ok, itemId, done) {
    const V = mgr.W.VegaSpell, bg = ok ? V.SuccessWnd : V.FailWnd;
    super(mgr, bg, ...centred(bg));
    this.V = V; this.modal = true; this.closeBtn.visible = false; this.itemId = itemId; this.done = done; this.fx = new Effects();
    this.button(V.BtOK, 55, 135, () => mgr.close(this));
    preloadAll(mgr, [ok ? V.EffectSuccess : V.EffectFail]).then(() => this.fx.add(ok ? V.EffectSuccess : V.EffectFail, ok ? 79 : 6, ok ? 71 : 45));
    sfx.play(ok ? 'UI/VegaSuccess' : 'UI/VegaFail');
  }
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') this.mgr.close(this); }
  onClose() { this.done?.(true); }
  body(ctx) {
    if (this.itemId) this.mgr.drawIcon(ctx, this.mgr.icon(this.itemId), 60, 65, this.itemId);
    this.fx.draw(ctx, this.mgr);
  }
}
