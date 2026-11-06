import { UI_W, UI_H } from '../view.js';
/**
 * Quest progress lines near the top of the screen ("Blue Snail 3 / 10"): bold yellow #FFC600 with a 1px black
 * outline, centred on x 400. Five slots, the first at y 150 and the others 20px higher each; a line fades out
 * over 3s (script messages over 6s). The same quest and target within 3s takes over its own slot again.
 */
const SLOTS = 5, LIFE = 3000, SCRIPT_LIFE = 6000;
const slotY = (i) => 150 - i * 20;

export class QuestMessages {
  constructor() { this.slots = Array(SLOTS).fill(null); }

  /** A quest's monster or item count: key tells same-target lines apart. */
  progress(qid, key, name, have, need) { this.put({ qid, key, text: `${name} ${have} / ${need}`, life: LIFE }, true); }
  /** SCRIPT_PROGRESS_MESSAGE: only takes a free slot. */
  script(text) { if (text) this.put({ qid: null, key: null, text, life: SCRIPT_LIFE }, false); }

  put(m, reuse) {
    const now = performance.now();
    let i = reuse ? this.slots.findIndex((s) => s && s.qid === m.qid && s.key === m.key && now - s.t <= LIFE) : -1;
    if (i < 0) i = this.slots.findIndex((s) => !s || now - s.t > s.life);
    if (i >= 0) this.slots[i] = { ...m, t: now };
  }

  clear() { this.slots.fill(null); }

  draw(ctx) {
    const now = performance.now();
    ctx.save();
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    this.slots.forEach((s, i) => {
      if (!s) return;
      const age = now - s.t;
      if (age > s.life) { this.slots[i] = null; return; }
      ctx.globalAlpha = 1 - age / s.life;
      const y = slotY(i);
      ctx.fillStyle = '#000';
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(s.text, UI_W / 2 + dx, y + dy);
      ctx.fillStyle = '#ffc600';
      ctx.fillText(s.text, UI_W / 2, y);
    });
    ctx.restore();
  }
}
