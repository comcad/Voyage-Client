import { sfx } from '../audio.js';
import { uiText } from './wzui.js';
import { Win } from './windows.js';
import { NOTICE_ICON } from './statusbar.js';

/**
 * Invitations from other players (UIWindow.img/FadeYesNo): the blue balloon (195x44) rising out of the status
 * bar's notice pencil (base/iconMemo) - the tip of its pointer (182, 42 in the art) on the pencil's top centre.
 * Measured from the art: the body y 3-35, the divider at x 172, the button column x 174-192. The kind's icon
 * is centred at (13, 19); the two white lines ("Trade request" / "from 'Name'") at x 23, y 6 and 20; the
 * 12x12 O (BtOK, accept) and X (BtCancel, decline) at x 177, y 6 and 20 - 3px above, 2 between, 3 below.
 * Only the newest is shown; the ones before it wait underneath and come back, in turn, once it is answered.
 */
const KINDS = {
  trade: { icon: 2, title: 'Trade request' },
  party: { icon: 1, title: 'Party invitation' },
  partySearch: { icon: 1, title: 'Party Search invitation' },
  guild: { icon: 3, title: 'Guild invitation' },
  guildFound: { icon: 8, title: 'Guild founding' },
  buddy: { icon: 5, title: 'Buddy request' },
  family: { icon: 4, title: 'Family invitation' },
  familySummon: { icon: 9, title: 'Family summons' },
  messenger: { icon: 0, title: 'Messenger invitation' },
};
const TIP = { x: 182, y: 42 }, FADE = 250;

export class Notifier extends Win {
  constructor(mgr, kind, name, done) {
    const F = mgr.W.FadeYesNo;
    super(mgr, F.backgrnd, 0, 0);
    this.F = F; this.k = KINDS[kind] || KINDS.trade; this.name = name; this.done = done;
    this.fixed = true; this.closeBtn.visible = false; this.born = performance.now();
    this.button(F.BtOK, 177, 6, () => this.answer(true));
    this.button(F.BtCancel, 177, 20, () => this.answer(false));
  }
  frames() { return [...super.frames(), this.F[`icon${this.k.icon}`]].filter(Boolean); }
  answer(ok) {
    if (this.answered) return;
    this.answered = true;
    this.mgr.close(this);
    this.done(ok);
  }
  get newest() { return this.mgr.order.findLast((w) => w instanceof Notifier) === this; }
  contains(x, y) { return this.newest && super.contains(x, y); }
  draw(ctx) {
    // a waiting one fades back in when it is its turn again
    if (!this.newest) { this.shown = false; return; }
    if (!this.shown) { this.shown = true; this.born = performance.now(); }
    const bar = this.g.statusBar?.y ?? 529;
    this.x = NOTICE_ICON.x + NOTICE_ICON.w / 2 - TIP.x;
    this.y = bar + NOTICE_ICON.y - TIP.y;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (performance.now() - this.born) / FADE);
    super.draw(ctx);
    ctx.restore();
  }
  body(ctx) {
    const icon = this.mgr.image(this.F[`icon${this.k.icon}`]);
    if (icon) ctx.drawImage(icon, Math.round(13 - icon.width / 2), Math.round(19 - icon.height / 2));
    ctx.save(); ctx.beginPath(); ctx.rect(22, 3, 148, 32); ctx.clip();
    uiText(ctx, this.k.title, 23, 6, { color: '#fff', size: 12 });
    uiText(ctx, `from '${this.name}'`, 23, 20, { color: '#fff', size: 12 });
    ctx.restore();
  }
}

/** Show one and resolve with the answer: true for O, false for X. */
export function notify(mgr, kind, name) {
  return new Promise((resolve) => {
    const n = new Notifier(mgr, kind, name, resolve);
    mgr.assets.preload(n.frames()).then(() => { mgr.order.push(n); sfx.play('UI/DlgNotice'); });
  });
}
