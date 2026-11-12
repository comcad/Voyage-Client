import { BUILD } from './build.js';

/**
 * Character frame images made off the page's thread (a Voyage matter, for crowds).
 *
 * A character's frame is drawn from one image put together from its pieces (character.js makeSprite). Put together on
 * the page, each one costs the frame being drawn a little, so they were rationed to a few ms a frame and a crowd's
 * were a while coming. Here they are made by a worker (public/FrameWorker.js): the page says which pieces go where,
 * the worker loads the sheets, draws the frame and hands back an image ready to draw. Nothing on screen waits on it:
 * a frame that isn't back yet is drawn as it was before (the last whole frame, or piece by piece).
 *
 * Without a worker that can do this (an older browser, the file missing, the worker falling over or not answering)
 * frames are made on the page as before; /fps worker switches between the two to compare.
 */
const AT_ONCE = 24;       // frames with the worker at a time; the rest wait here, those wanted now ahead of the others
const ANSWER_MS = 5000;   // a frame not back in this long is made on the page; after three of those the worker is given up

export const frameMaker = {
  wanted: true,     // /fps worker
  worker: null, ready: false, broken: false,
  jobs: new Map(), now: [], later: [], seq: 0, late: 0, watch: 0,
  made: 0, failed: 0, ms: 0,   // for /fps copy: frames made, ones that couldn't be, and the time they took to come back

  /** Whether frames are made by the worker now. */
  get on() { return this.wanted && this.ready && !this.broken; },

  /** Starts the worker, once (it says when it is ready; until then, and if it never is, frames are made on the page). */
  start() {
    if (this.worker || this.broken) return;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') { this.broken = true; return; }
    try {
      this.worker = new Worker(`/FrameWorker.js?v=${encodeURIComponent(BUILD)}`);
    } catch { this.broken = true; return; }
    this.worker.onmessage = (ev) => this.got(ev.data);
    this.worker.onerror = () => this.stop();
    this.watch = setInterval(() => this.overdue(), 1000);
  },

  /**
   * Asks for a frame: job is { w, h, urls, cuts } (see FrameWorker.js); done(image) is called with the image, or with
   * null when it couldn't be made. `ahead`: wanted on screen now, so it goes before those made in advance.
   */
  ask(job, done, ahead = true) {
    (ahead ? this.now : this.later).push({ job, done, t0: performance.now() });
    this.pump();
  },

  pump() {
    while (this.worker && this.jobs.size < AT_ONCE) {
      const item = this.now.shift() || this.later.shift();
      if (!item) return;
      const id = ++this.seq;
      item.sent = performance.now();
      this.jobs.set(id, item);
      this.worker.postMessage({ id, w: item.job.w, h: item.job.h, urls: item.job.urls, cuts: item.job.cuts });
    }
  },

  got(m) {
    if (m.ready !== undefined) { if (m.ready) this.ready = true; else this.stop(); return; }
    const item = this.jobs.get(m.id);
    if (!item) { m.image?.close?.(); return; }   // (given up on: it was made on the page)
    this.jobs.delete(m.id);
    if (m.image) { this.made++; this.ms += performance.now() - item.t0; } else this.failed++;
    item.done(m.image || null);
    this.pump();
  },

  /** Frames the worker has had too long are made on the page; a worker that keeps doing that is given up. */
  overdue() {
    const now = performance.now();
    for (const [id, item] of this.jobs) {
      if (now - item.sent < ANSWER_MS) break;   // (in the order they were sent)
      this.jobs.delete(id); this.failed++; this.late++;
      item.done(null);
    }
    if (this.late >= 3) this.stop(); else this.pump();
  },

  /** The worker can't be used: everything it was asked for is made on the page instead, and so is all that follows. */
  stop() {
    this.broken = true; this.ready = false;
    clearInterval(this.watch);
    try { this.worker?.terminate(); } catch { /* gone already */ }
    this.worker = null;
    const items = [...this.jobs.values(), ...this.now, ...this.later];
    this.jobs.clear(); this.now.length = 0; this.later.length = 0;
    for (const item of items) { this.failed++; item.done(null); }
  },

  /** For /fps copy. */
  stats() {
    return { on: this.on, usable: this.ready && !this.broken, made: this.made, failed: this.failed, ms: this.made ? this.ms / this.made : 0, waiting: this.jobs.size + this.now.length + this.later.length };
  },
};
