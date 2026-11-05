import { pad, frames, nodeAt, frameAt } from '../assets.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { lookEquipIds } from '../net/proto.js';
import { EMOTES } from '../game.js';
import { allCanvases } from './windows.js';
import { uiText } from './wzui.js';

const W = 225, SLIDE = 300, SHOW = 10000;

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
    await as.preload([...frames(art), ...allCanvases(helper?.AvatarMegaphone?.name), ...lookCanvases(look, [look.standAction()])]);
    if (seq !== this.seq) return;
    const name = EMOTES[(Number(info.emotion) || 0) - 1];
    this.cur = { ...a, art: frames(art), look, expr: name ? { name, frame: 0, t: 0 } : null, names: helper?.AvatarMegaphone?.name, at: performance.now(), out: null };
  }
  /** Slides the one shown out, and drops one still loading. */
  clear() { this.seq = (this.seq || 0) + 1; if (this.cur && !this.cur.out) this.cur.out = performance.now(); }

  draw(ctx) {
    const c = this.cur, as = this.g.assets;
    if (!c) return;
    const now = performance.now();
    if (!c.out && now - c.at >= SHOW) c.out = now;
    const inK = Math.min(1, (now - c.at) / SLIDE), outK = c.out ? Math.min(1, (now - c.out) / SLIDE) : 0;
    if (outK >= 1) { this.cur = null; return; }
    const x = Math.round(800 - W * inK + W * outK), y = 0;
    const f = frameAt(c.art, now - c.at), bg = f && as.image(f);
    if (bg) ctx.drawImage(bg, x, y);
    drawParts(ctx, as, c.look.compose(c.look.standAction(), 0, c.expr), x + 82, y + 85, false);
    ctx.save(); ctx.font = '12px Arial, sans-serif';
    const nw = ctx.measureText(c.name).width;
    ctx.restore();
    const wide = nw > 69, tag = as.image(c.names?.[wide ? 1 : 0]);
    if (tag) ctx.drawImage(tag, x + (wide ? 3 : 48), y + 84);
    uiText(ctx, c.name, x + 78, y + 85, { color: '#fff', size: 12, align: 'center' });
    c.lines.forEach((l, k) => uiText(ctx, l || '', x + 124, y + 14 + k * 18, { color: '#000', size: 12 }));
  }
}
