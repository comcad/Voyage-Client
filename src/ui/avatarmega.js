import { pad, frames, nodeAt, frameAt } from '../assets.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { lookEquipIds } from '../net/proto.js';
import { EMOTES } from '../game.js';
import { allCanvases } from './windows.js';
import { uiText } from './wzui.js';
import { UI_W } from '../view.js';

const W = 225, SLIDE = 300, SHOW = 10000;
/** The name plate's two widths: the narrow one fits under this (px), the wide one over it. */
const NAME_WIDE = 69;
/** The font the name is drawn in, matching wzui's FONT so the measured width is the drawn one. */
const NAME_FONT = '12px Arial, "Segoe UI", sans-serif';

/**
 * An Avatar Megaphone (SET_AVATAR_MEGAPHONE), 225x121 at the top right: it slides in from the right edge to x 575,
 * stays 10s (or until CLEAR_AVATAR_MEGAPHONE) and slides back out; a new one replaces it at once. Its frame is the
 * item's info/path animation; the sender stands at (82, 85) making the item's info/emotion face, the name on
 * MapHelper.img/AvatarMegaphone/name/0 (69 wide, at x 48) or name/1 (157 wide, at x 3) at y 84 centred on x 78,
 * the four lines at x 124 from y 14, 18px apart.
 */
export class AvatarBanner {
  constructor(g) { this.g = g; this.cur = null; }

  async show(a) {
    const g = this.g, as = g.assets, seq = (this.seq = (this.seq || 0) + 1);
    const info = (await as.json('Item/Cash/0539.img'))?.[pad(a.itemId, 8)]?.info || {};
    const helper = await as.json('Map/MapHelper.img'), art = await nodeAt(as, info.path);
    const L = a.look, look = new CharacterLook(as, { skin: L.skin, face: L.face, hair: L.hair, gender: L.gender, equips: lookEquipIds(L) });
    await look.load();
    const name = EMOTES[(Number(info.emotion) || 0) - 1];
    const names = helper?.AvatarMegaphone?.name;
    // measure the name in the font it is drawn in, before the preload: only the plate it picks is needed
    const mctx = g.ctx, font = mctx.font;
    mctx.font = NAME_FONT;
    const nameW = mctx.measureText(name || '').width;
    mctx.font = font;
    const plate = names?.[nameW > NAME_WIDE ? 1 : 0];
    await as.preload([...frames(art), ...(plate ? [plate] : []), ...lookCanvases(look, [look.standAction()])]);
    if (seq !== this.seq) return;
    // compose() and the name width do not change while the banner is up, so build them once here
    const expr = name ? { name, frame: 0, t: 0 } : null;
    const parts = look.compose(look.standAction(), 0, expr);
    this.cur = { ...a, art: frames(art), look, expr, parts, nameW, names, at: performance.now(), out: null };
  }
  /** Slides the one shown out, and drops one still loading. */
  clear() { this.seq = (this.seq || 0) + 1; if (this.cur && !this.cur.out) this.cur.out = performance.now(); }

  draw(ctx) {
    const c = this.cur, as = this.g.assets;
    if (!c) return;
    const now = performance.now();
    if (!c.out && now - c.at >= SHOW) c.out = now;
    // a banner cleared mid-slide keeps the position it reached: only the out-ramp may advance from here
    const inK = c.out ? Math.min(1, (c.out - c.at) / SLIDE) : Math.min(1, (now - c.at) / SLIDE), outK = c.out ? Math.min(1, (now - c.out) / SLIDE) : 0;
    if (outK >= 1) { this.cur = null; return; }
    const x = Math.round(UI_W - W * inK + W * outK), y = 0;
    const f = frameAt(c.art, now - c.at), bg = f && as.image(f);
    if (bg) ctx.drawImage(bg, x, y);
    drawParts(ctx, as, c.parts, x + 82, y + 85, false);
    const wide = c.nameW > NAME_WIDE, tag = as.image(c.names?.[wide ? 1 : 0]);
    if (tag) ctx.drawImage(tag, x + (wide ? 3 : 48), y + 84);
    uiText(ctx, c.name, x + 78, y + 85, { color: '#fff', size: 12, align: 'center' });
    c.lines.forEach((l, k) => { if (l) uiText(ctx, l, x + 124, y + 14 + k * 18, { color: '#000', size: 12 }); });
  }
}
