import { sfx } from '../audio.js';
import { uiText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W, UI_H } from '../view.js';

/**
 * Notification balloons (UIWindow.img/FadeYesNo) above the status bar: invitations and quest notices.
 * Each sits at x 464, y = bar top - 21 - 5n (n = balloons alive when it came, itself included), all shown at once;
 * when one goes, those after it drop 5px. A new one replaces the first of its kind (not buddy requests; quests only
 * for the same quest). Each fades in over 1s, holds until its deadline (counted from creation: 3 min for
 * invitations, 30s for quests), then fades out over 1s; a click on O or X - taken once the fade in is over -
 * closes it the same way. Closing without O declines, so an invitation left alone is declined after 3 minutes.
 * Every balloon plays UI/Invite as it comes. Text is Arial 12 white; the icon sits at (6, (37 - h) >> 1).
 */
const WIDE = { art: 'backgrnd', ok: [177, 6], x: [177, 20] }, NARROW = { art: 'backgrnd4', ok: [136, 6], x: [136, 20] };
const KINDS = {
  messenger: { ...WIDE, icon: 0, lines: (n) => [['An invitation', 25, 5], [`from '${n}'`, 25, 18]] },
  buddy: { ...WIDE, icon: 1, lines: (n) => [['Buddy request', 25, 5], [`from '${n}'`, 25, 18]], stack: true },
  trade: { ...WIDE, icon: 2, lines: (n) => [['Trade request', 25, 5], [`from '${n}'`, 25, 18]] },
  party: { ...WIDE, icon: 5, lines: (n) => [['Party invite', 27, 7], [`from '${n}'`, 27, 20]] },
  guild: { ...WIDE, icon: 5, lines: (n) => [[`from '${n}'`, 27, 7], ['Guild invite', 27, 20]] },
  newYearCard: { art: 'backgrnd2', ok: [136, 7], x: [136, 20], icon: 7, lines: (n) => [['New year card arrived', 27, 7], [`from '${n}'`, 27, 20]] },
  family: { ...WIDE, icon: 8, lines: (n) => [[`from '${n}'`, 27, 7], ["It's a Family Invitation.", 27, 20]] },
  // shown as balloons here too, though they are other windows in v83
  partySearch: { ...WIDE, icon: 1, lines: (n) => [['Party Search invitation', 25, 5], [`from '${n}'`, 25, 18]] },
  guildFound: { ...WIDE, icon: 8, lines: (n) => [['Guild founding', 25, 5], [`from '${n}'`, 25, 18]] },
  familySummon: { ...WIDE, icon: 9, lines: (n) => [['Family summons', 25, 5], [`from '${n}'`, 25, 18]] },
};
let balloonSeq = 0;
const FADE = 1000, INVITE_HOLD = 180000, QUEST_HOLD = 30000, LOGIN_HOLD = 6000, NAME_W = 100;

class Balloon extends Win {
  constructor(mgr, kind, art, done, hold) {
    super(mgr, mgr.W.FadeYesNo[art], 464, 0);
    Object.assign(this, { kind, done, hold, seq: ++balloonSeq, born: performance.now(), deadline: performance.now() + hold, shownAt: null, closing: null, clicked: null, n: 1 });
    this.fixed = true; this.keepOnEscape = true; this.closeBtn.visible = false; this.closeSound = null;
  }
  get F() { return this.mgr.W.FadeYesNo; }
  get balloons() { return balloonsOf(this.mgr); }
  /** O / X: taken once the fade in is over; only the first counts. */
  press(ok) { if (!this.clicked && !this.closing) this.clicked = ok ? 'ok' : 'x'; }
  update(now) {
    if (this.shownAt === null) this.shownAt = now;
    const shown = now - this.shownAt >= FADE;
    if (!this.closing && shown && (this.clicked || now >= this.deadline)) {
      this.closing = now;
      this.done?.(this.clicked === 'ok');
    }
    if (this.closing && now - this.closing >= FADE && !this.gone) { this.gone = true; setTimeout(() => this.remove()); }   // not mid-draw
  }
  get alpha() {
    const now = performance.now();
    if (this.closing) return Math.max(0, 1 - (now - this.closing) / FADE);
    return this.shownAt === null ? 0 : Math.min(1, (now - this.shownAt) / FADE);
  }
  /** Gone: the balloons after it drop 5px. */
  remove() {
    const list = this.balloons;
    if (!list.includes(this)) return;
    for (const b of list) if (b.seq > this.seq) b.n--;   // by when they came, not by window order (clicks raise them)
    this.mgr.close(this);
  }
  draw(ctx) {
    const now = performance.now();
    this.update(now);
    const bar = this.g.statusBar?.y ?? UI_H - 71;
    this.x = (this.g.statusBar?.ox ?? 0) + 464;
    this.y = bar - 21 - 5 * this.n;
    ctx.save(); ctx.globalAlpha = this.alpha;
    super.draw(ctx);
    ctx.restore();
  }
  icon(ctx, node) {
    const i = this.mgr.image(node);
    if (i) ctx.drawImage(i, 6, (37 - i.height) >> 1);
  }
}

/** An invitation; resolves true for O, false for X or after 3 minutes unanswered. */
class Invite extends Balloon {
  constructor(mgr, kind, name, done) {
    const k = KINDS[kind] || KINDS.trade;
    super(mgr, kind, k.art, done, INVITE_HOLD);
    this.k = k; this.name = name;
    this.button(this.F.BtOK, ...k.ok, () => this.press(true));
    this.button(this.F.BtCancel, ...k.x, () => this.press(false));
  }
  frames() { return [...super.frames(), this.F[`icon${this.k.icon}`]].filter(Boolean); }
  body(ctx) {
    this.icon(ctx, this.F[`icon${this.k.icon}`]);
    for (const [t, x, y] of this.k.lines(this.name)) uiText(ctx, t, x, y, { color: '#fff', size: 12 });
  }
}

/**
 * A parcel at Duey (backgrnd4, Basic icon/delivery): 6s for a normal one, until answered for a quick one, which
 * alone gets O (at (136, 7)) - O asks Duey to open from here. X at (136, 20).
 */
class ParcelNote extends Balloon {
  constructor(mgr, sender, quick, done) {
    super(mgr, 'parcel', 'backgrnd4', done, quick ? 0x7FFFFFFF : LOGIN_HOLD);
    Object.assign(this, { sender, quick });
    if (quick) this.button(this.F.BtOK, 136, 7, () => this.press(true));
    this.button(this.F.BtCancel, 136, 20, () => this.press(false));
  }
  frames() { return [...super.frames(), this.mgr.B.icon?.delivery].filter(Boolean); }
  body(ctx) {
    this.icon(ctx, this.mgr.B.icon?.delivery);
    const w = { color: '#fff', size: 12 }, s = this.sender;
    if (!s && !this.quick) { uiText(ctx, 'Package\r\nReceived.', 27, 14, w); return; }
    const [a, b] = !s ? ['\tQuick delivey/Package', '\tArrived!'] : [this.quick ? 'The Quick Delivery has arrived!' : 'Package\r\nReceived.', `[${s}]`];
    uiText(ctx, a, 27, 7, w); uiText(ctx, b, 27, 20, w);
  }
}
/** A parcel came (sender, or '' at login): resolves true when a quick one's O is pressed. */
export function notifyParcel(mgr, sender, quick) {
  return new Promise((resolve) => add(mgr, new ParcelNote(mgr, sender, quick, resolve), () => true));
}

/** A buddy, guild or family member logging in (pink backgrnd2, icon3), or a buddy on your channel now (icon4): X only, 6s. */
class LoginNote extends Balloon {
  constructor(mgr, name, sameChannel) {
    super(mgr, 'login', 'backgrnd2', null, LOGIN_HOLD);
    Object.assign(this, { name, same: sameChannel });
    this.button(this.F.BtCancel, ...NARROW.x, () => this.press(false));
  }
  frames() { return [...super.frames(), this.F.icon3, this.F.icon4].filter(Boolean); }
  body(ctx) {
    this.icon(ctx, this.same ? this.F.icon4 : this.F.icon3);
    const [a, b] = this.same ? ["You're on the same ch.", `with ${this.name}.`] : [`${this.name} is`, 'logged in.'];
    uiText(ctx, a, 25, 7, { color: '#fff', size: 11 });
    uiText(ctx, b, 25, 20, { color: '#fff', size: 11 });
  }
}

/** "Quest Complete!" / "You got a title!" (the quest's name under it, cut to 100px), or "New Quest!" for quest 0. */
export class QuestNotice extends Balloon {
  constructor(mgr, qid, title, name, open) {
    super(mgr, 'quest', NARROW.art, null, QUEST_HOLD);
    Object.assign(this, { qid, title, name, open });
    this.button(this.F.BtOK, ...NARROW.ok, () => { this.press(true); this.open(this.qid, true); });
    this.button(this.F.BtCancel, ...NARROW.x, () => this.press(false));
  }
  frames() { return [...super.frames(), this.F.icon6, this.F.icon7].filter(Boolean); }
  /** The body opens the quest too. */
  down() { if (!this.closing) { this.press(true); this.open(this.qid, false); } }
  body(ctx) {
    if (!this.qid) { this.icon(ctx, this.F.icon6); uiText(ctx, this.title, 27, 14, { color: '#fff', size: 12 }); return; }
    this.icon(ctx, this.F.icon7);
    uiText(ctx, this.title, 27, 7, { color: '#fff', size: 12 });
    ctx.font = '12px Arial, sans-serif';
    let n = this.name || '';
    if (ctx.measureText(n).width > NAME_W) { while (n.length > 1 && ctx.measureText(`${n}..`).width > NAME_W) n = n.slice(0, -1); n = `${n}..`; }
    uiText(ctx, n, 27, 20, { color: '#fff', size: 12 });
  }
}

const balloonsOf = (mgr) => mgr.order.filter((w) => w instanceof Balloon);
/** Add a balloon: the first of its kind goes at once (no fade, no decline), unless the kind stacks. */
function add(mgr, b, same) {
  const old = balloonsOf(mgr).find((w) => w.kind === b.kind && same(w));
  if (old) old.remove();
  b.n = balloonsOf(mgr).length + 1;
  mgr.order.push(b);
  mgr.assets.preload(b.frames());
  sfx.play('UI/Invite');
  return b;
}

/** An invitation: resolves with the answer (true for O, false for X or no answer in 3 minutes). */
export function notify(mgr, kind, name) {
  return new Promise((resolve) => add(mgr, new Invite(mgr, kind, name, resolve), () => !KINDS[kind]?.stack));
}

/** Someone you know logged in (or, sameChannel, a buddy is on your channel now); replaces the last such note. */
export function notifyLogin(mgr, name, sameChannel = false) { add(mgr, new LoginNote(mgr, name, sameChannel), () => true); }

/** Raise (or replace) the notice for a quest. open(qid, fromO) is called on O or a click on the body. */
export function questNotice(mgr, qid, title, name, open) {
  add(mgr, new QuestNotice(mgr, qid, title, name, open), (w) => w.qid === qid);
}
/** The server took the quest: its notice goes. */
export function dropQuestNotice(mgr, qid) {
  for (const w of balloonsOf(mgr).filter((o) => o instanceof QuestNotice && (qid === undefined || o.qid === qid))) w.remove();
}
export const hasQuestNotice = (mgr) => mgr.order.some((o) => o instanceof QuestNotice);
