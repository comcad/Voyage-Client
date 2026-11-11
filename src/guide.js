import { frames } from './assets.js';
import { Anim } from './map.js';
import { richText, drawRich } from './ui/richtext.js';
import { textRef } from './ui/dialogs.js';
import { snapPx } from './view.js';

/**
 * The beginner guide (SPAWN_GUIDE / TALK_GUIDE / CLICK_GUIDE): a summon of your own, skill 10001013 for the Cygnus
 * jobs and 20001013 for everyone else (Skill/<job>.img/skill/<id>/summon: summoned, stand, move, say, height).
 *
 * It appears on you facing right, plays `summoned` once, then floats after you in 30 ms steps of 7px: it keeps 70px
 * away sideways; it matches your height after 30 steps more than 20px off, or at once more than 100px off; more than
 * 300px sideways or 200px up or down, it jumps to you with Effect/BasicEff.img/Summoned. It ignores footholds and
 * shows `move` while it moves sideways, else `stand`.
 *
 * TALK_GUIDE shows one thing over it for a time: text in the UI/ChatBalloon.img/tutorial balloon (wrapped at a width
 * the server gives), or a UI/tutorial.img picture. Double-clicking it sends CLICK_GUIDE.
 */
const STEP_MS = 30, SPEED = 7, KEEP_X = 70;
const BALLOON = { b: '#0000ff', r: '#ff0000', g: '#00ff00', d: '#51378c', k: '#000' };

export class Guide {
  /** prev: the guide of the last map, whose loaded art is kept. */
  constructor(game, skill, prev = null) {
    Object.assign(this, { g: game, skill });
    const p = game.player;
    this.x = Math.round(p.x); this.y = Math.round(p.y);
    this.facingRight = true;
    this.special = 'summoned';     // summoned / say: played once, then back to stand / move
    this.base = 'stand';
    this.frame = 0; this.frameT = 0; this.stepT = 0;
    this.vState = 0; this.vCount = 0;
    this.prevBox = null;
    this.talk = null;              // { balloon: { layout, w, h, canvas } | picture: Anim, until }
    this.node = prev?.skill === skill ? prev.node : null; this.B = prev?.B || null;
    this.talkSeq = 0;
    if (this.node && this.B) return;
    game.assets.json('UI/ChatBalloon.img').then((c) => { this.B = c?.tutorial || null; if (this.B) game.assets.preload(Object.values(this.B).filter((n) => n?._canvas)); });
    game.skills?.ensure(skill).then(async (n) => {
      const s = n?.summon;
      if (!s) return;
      await game.assets.preload(Object.values(s).flatMap((a) => (a && typeof a === 'object' ? frames(a) : [])));
      this.node = s;
    });
  }
  get height() { return Number(this.node?.height) || 80; }
  get action() { return this.special && this.node?.[this.special] ? this.special : this.base; }
  anim() { const n = this.node; return n ? frames(n[this.action] || n.stand) : []; }
  setBase(a) { if (this.base !== a) { this.base = a; if (!this.special) { this.frame = 0; this.frameT = 0; } } }
  play(a) { if (this.node?.[a]) { this.special = a; this.frame = 0; this.frameT = 0; } else this.special = null; }

  update(dt) {
    const ms = dt * 1000;
    for (this.stepT += ms; this.stepT >= STEP_MS; this.stepT -= STEP_MS) this.step();
    const fr = this.anim();
    if (fr.length) {
      this.frameT += ms;
      while (this.frameT >= (fr[this.frame]?.delay || 100)) {
        this.frameT -= fr[this.frame]?.delay || 100;
        if (++this.frame >= fr.length) { this.frame = 0; if (this.special) { this.special = null; break; } }
      }
    }
    if (this.talk) {
      if (performance.now() > this.talk.until) this.talk = null;
      else this.talk.picture?.update(ms);
    }
  }
  /** One 30 ms step after you. */
  step() {
    const p = this.g.player, ux = Math.round(p.x), uy = Math.round(p.y);
    this.prevBox = this.box();
    if (ux < this.x - 300 || ux >= this.x + 300 || uy < this.y - 200 || uy >= this.y + 200) {
      this.x = ux; this.y = uy; this.vState = 0; this.vCount = 0;
      this.g.vfx?.play('Summoned', this);
      return;
    }
    let vx = 0;
    if (ux > this.x + KEEP_X) { this.x = Math.min(this.x + SPEED, ux - KEEP_X); vx = 1; }
    else if (ux < this.x - KEEP_X) { this.x = Math.max(this.x - SPEED, ux + KEEP_X); vx = -1; }
    const dy = uy - this.y;
    if (this.vState === 0) {
      if (Math.abs(dy) <= 20) this.vCount = 0;
      else if (++this.vCount > 29) this.vState = 1;
    }
    if (this.vState === -1 && dy === 0) this.vState = 0;
    else if (dy !== 0 && (this.vState !== 0 || Math.abs(dy) > 100)) {
      this.y = dy < 0 ? Math.max(this.y - SPEED, uy) : Math.min(this.y + SPEED, uy);
      if (this.y === uy) { this.vState = -1; this.vCount = 0; }
    }
    if (vx) { this.facingRight = vx > 0; this.setBase('move'); } else this.setBase('stand');
  }

  /** TALK_GUIDE mode 0: text wrapped at w px for ms; nothing but clearing for empty text. */
  say(text, w, ms) {
    this.talk = null; this.talkSeq++;
    if (!text) return;
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = richText(ctx, text, Math.max(1, w), textRef(this.g.windows), { base: '#000', size: 12, colors: BALLOON, lineH: 18, boldE: true });
    this.talk = { balloon: { layout, w: Math.max(1, w), h: layout.height }, until: performance.now() + ms };
    this.play('say');
  }
  /** TALK_GUIDE mode 1: UI/tutorial.img/<n> for ms; `say` too, except for an Aran. */
  async show(n, ms) {
    this.talk = null;
    const seq = ++this.talkSeq;
    const t = await this.g.assets.json('UI/tutorial.img');
    const node = t?.[n];
    if (!node || seq !== this.talkSeq) return;
    const picture = new Anim(node, true);
    await this.g.assets.preload(picture.frames);
    if (seq !== this.talkSeq) return;   // something newer was said or shown meanwhile
    this.talk = { picture, until: performance.now() + ms };
    if (Math.floor((this.g.stats?.job || 0) / 1000) !== 2) this.play('say');
  }

  /** The frame's lt / rb where it stands (mirrored facing right), with the last step's; null when it has none. */
  box() {
    const node = this.anim()[this.frame], lt = node?.lt, rb = node?.rb;
    if (!lt || !rb) return null;
    const [l, r] = this.facingRight ? [-rb[0], -lt[0]] : [lt[0], rb[0]];
    return { left: this.x + l, top: this.y + lt[1], right: this.x + r, bottom: this.y + rb[1] };
  }
  hits(wx, wy) {
    const b = this.box();
    if (!b) return false;
    const p = this.prevBox || b;
    const u = { left: Math.min(b.left, p.left), top: Math.min(b.top, p.top), right: Math.max(b.right, p.right), bottom: Math.max(b.bottom, p.bottom) };
    return wx >= u.left && wx < u.right && wy >= u.top && wy < u.bottom;
  }

  draw(ctx, cam) {
    const fr = this.anim(), node = fr[this.frame], img = node && this.g.assets.image(node);
    const x = snapPx(this.x - cam.x), y = snapPx(this.y - cam.y);
    if (img) {
      const o = node.origin || [img.width / 2, img.height];
      ctx.save();
      if (this.facingRight) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -o[0], -o[1]); }
      else ctx.drawImage(img, x - o[0], y - o[1]);
      ctx.restore();
    }
    const t = this.talk;
    if (t?.balloon) this.drawBalloon(ctx, x, y, t.balloon);
    else if (t?.picture) {
      const n = t.picture.node, pic = n && this.g.assets.image(n);
      // centred over the guide, its bottom `height` above its feet; the picture's own origin is left out (unverified:
      // with it, the first picture would stand some 760px up)
      if (pic) ctx.drawImage(pic, x - Math.trunc(pic.width / 2), y - this.height - pic.height);
    }
  }
  /**
   * The balloon: (w + 38) x (h + 92), its top-left at (x - w/2, y - 90 - h - height); corners 19px, the arrow at
   * (w/2 + 10, h + 35), the text from (19, 21).
   */
  drawBalloon(ctx, x, y, b) {
    const B = this.B, a = this.g.assets;
    const im = (k) => B?.[k] && a.image(B[k]);
    const { w, h } = b, left = x - Math.trunc(w / 2), top = y - 90 - h - this.height;
    const put = (k, dx, dy, dw, dh) => { const i = im(k); if (i) ctx.drawImage(i, left + dx, top + dy, dw ?? i.width, dh ?? i.height); };
    put('nw', 0, 0); put('n', 19, 0, w); put('ne', w + 19, 0);
    put('w', 0, 21, undefined, h); put('c', 19, 21, w, h); put('e', w + 19, 21, undefined, h);
    put('sw', 0, h + 21); put('s', 19, h + 21, w); put('se', w + 19, h + 21);
    put('arrow', Math.trunc(w / 2) + 10, h + 35);
    drawRich(ctx, b.layout, left + 19, top + 21, { size: 12 });
  }
}
