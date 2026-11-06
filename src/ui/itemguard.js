import { Win } from './windows.js';
import { VIEW_W, VIEW_H } from '../view.js';

const NEVER = 0x0217E646BB058000n;   // FILETIME 2079-01-01: no expiry
const FT_EPOCH = 116444736000000000n;
export const permanent = (exp) => !exp || BigInt(exp) <= 0n || BigInt(exp) >= NEVER;
const toDate = (exp) => new Date(Number((BigInt(exp) - FT_EPOCH) / 10000n));
const fmt = (d) => `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Item Guard (5060001 for good, 5061xxx for its info/protectTime days): UIWindow.img/ItemProtector/backgrnd
 * (178x179), centred; drag an item from your inventory onto it, Icon/0 marks it. Measured from the art: the item in
 * the lock at (73, 94); BtOk / BtCancel right-aligned at y 157. It takes an equip, a throwing star, a bullet or a
 * 22500xx item that isn't a cash item or 11123xx, and isn't sealed already unless that seal runs out (and can be
 * extended). Resolves with { tab, slot } once confirmed, or null.
 */
export class ItemGuardWin extends Win {
  constructor(mgr, itemId, days, done) {
    const P = mgr.W.ItemProtector;
    super(mgr, P.backgrnd, Math.round((VIEW_W - P.backgrnd._w) / 2), Math.round((VIEW_H - P.backgrnd._h) / 2));
    this.closeBtn.visible = false;   // neither modal nor closed by clicks elsewhere: items are dragged onto it from the inventory
    this.itemId = itemId; this.days = days; this.done = done; this.pick = null;
    this.button(P.BtCancel, 136, 157, () => this.finish(null));
    this.button(P.BtOk, 94, 157, () => this.ok());
  }
  frames() { return [...super.frames(), this.mgr.W.ItemProtector.Icon?.[0]].filter(Boolean); }
  item() { return this.pick && this.g.inventory?.[this.pick.tab]?.[this.pick.slot]; }
  async ok() {
    const it = this.item(), m = this.mgr;
    if (!it) { m.notice("Please select the item you'd like to seal."); return; }
    const name = m.itemName(it.id) || '';
    let text;
    if (!this.days) text = `${name}\r\nWould you like to seal this item?`;
    else if (it.flag & 1 && !permanent(it.expiration)) text = `${name}\r\n will extend the item seal until ${fmt(new Date(toDate(it.expiration).getTime() + this.days * 864e5))}.\r\n Do you want to proceed?`;
    else text = `${name}\r\n will be sealed until ${fmt(new Date(Date.now() + this.days * 864e5))}.\r\nDo you want to proceed?`;
    if (await m.confirm(text)) this.finish(this.pick);
  }
  finish(v) { if (this.answered) return; this.answered = true; this.mgr.close(this); this.done(v); }
  key(e) { if (e.key === 'Escape') this.finish(null); }
  drop(lx, ly, c) {
    if (c.kind !== 'item' || typeof c.tab !== 'number') return;
    const it = this.g.inventory?.[c.tab]?.[c.slot], id = it?.id || 0, cat = Math.floor(id / 10000);
    const sealed = !!(it?.flag & 1), kindOk = c.tab === 1 || cat === 207 || cat === 233 || Math.floor(id / 100) === 22500;
    const ok = it && (sealed ? !permanent(it.expiration) : permanent(it.expiration)) && !it.cashId && Math.floor(id / 100) !== 11123 && kindOk;
    if (!ok) { this.mgr.notice('This item cannot be sealed.'); return; }
    this.pick = { tab: c.tab, slot: c.slot };
  }
  body(ctx) {
    const m = this.mgr, it = this.item();
    if (!it) return;
    m.drawIcon(ctx, m.icon(it.id), 73, 94, it.id);
    const mark = m.image(m.W.ItemProtector.Icon?.[0]);
    if (mark) ctx.drawImage(mark, 73, 94);
  }
}
