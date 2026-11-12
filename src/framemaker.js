import { BUILD } from './build.js';

/**
 * Character frame images made off the page's thread (a Voyage matter, for crowds).
 *
 * A character's frame is drawn from one image put together from its pieces (character.js makeSprite). Each one put
 * together on the page costs the frame being drawn a little, so they are rationed to a few ms a frame; a player's
 * standing, walking and jumping frames are made ahead of their first use (Game.warmSprites), and a crowd's were a
 * while coming. Those are made here instead, by a worker (public/FrameWorker.js): the page says which pieces go
 * where, the worker loads the sheets, draws the frame and hands back an image ready to draw. Nothing waits on it: a
 * frame wanted on screen before it is back is made on the page as before.
 *
 * It is off unless switched on with /fps worker, and the worker isn't started until then. Measured in Chromium with
 * 346 players arriving it is the slower way: putting frames together on the page costs next to nothing there, while
 * the worker loads every sheet a second time and its answers take the page's time (frames ready after 2.8s rather
 * than 1.5s, arrivals after 1.8s rather than 1.0s). It is kept to be tried where putting frames together on the page
 * costs more, which could not be measured: switch it on and compare /fps copy.
 *
 * Without a worker that can do this (an older browser, the file missing, the worker falling over or not answering)
 * every frame is made on the page whatever the switch says.
 */
const AT_ONCE = 24;       // frames with the worker at a time; the rest wait here
const ANSWER_MS = 5000;   // a frame not back in this long is left to the page; after three of those the worker is given up

export const frameMaker = {
  wanted: false,    // /fps worker
  worker: null, ready: false, broken: false,
  jobs: new Map(), queue: [], seq: 0, late: 0, watch: 0,
  made: 0, failed: 0, ms: 0,   // for /fps copy: frames made, ones that couldn't be, and the time they took to come back

  /** Whether frames are made by the worker now. */
  get on() { return this.wanted && this.ready && !this.broken; },

  /** /fps worker: on (starting the worker the first time) or off. Returns whether it is wanted now. */
  toggle() {
    this.wanted = !this.wanted;
    if (this.wanted) this.start();
    return this.wanted;
  },

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
   * null when it couldn't be made.
   */
  ask(job, done) {
    this.queue.push({ job, done, t0: performance.now() });
    this.pump();
  },

  pump() {
    while (this.worker && this.jobs.size < AT_ONCE && this.queue.length) {
      const item = this.queue.shift(), id = ++this.seq;
      item.sent = performance.now();
      this.jobs.set(id, item);
      this.worker.postMessage({ id, w: item.job.w, h: item.job.h, urls: item.job.urls, cuts: item.job.cuts });
    }
  },

  got(m) {
    if (m.ready !== undefined) { if (m.ready) this.ready = true; else this.stop(); return; }
    const item = this.jobs.get(m.id);
    if (!item) { m.image?.close?.(); return; }   // (given up on)
    this.jobs.delete(m.id);
    if (m.image) { this.made++; this.ms += performance.now() - item.t0; } else this.failed++;
    item.done(m.image || null);
    this.pump();
  },

  /** Frames the worker has had too long are left to the page; a worker that keeps doing that is given up. */
  overdue() {
    const now = performance.now();
    for (const [id, item] of this.jobs) {
      if (now - item.sent < ANSWER_MS) break;   // (in the order they were sent)
      this.jobs.delete(id); this.failed++; this.late++;
      item.done(null);
    }
    if (this.late >= 3) this.stop(); else this.pump();
  },

  /** The worker can't be used: everything it was asked for is left to the page, and so is all that follows. */
  stop() {
    this.broken = true; this.ready = false;
    clearInterval(this.watch);
    try { this.worker?.terminate(); } catch { /* gone already */ }
    this.worker = null;
    const items = [...this.jobs.values(), ...this.queue];
    this.jobs.clear(); this.queue.length = 0;
    for (const item of items) { this.failed++; item.done(null); }
  },

  /** For /fps copy. */
  stats() {
    return { on: this.on, wanted: this.wanted, broken: this.broken, made: this.made, failed: this.failed, ms: this.made ? this.ms / this.made : 0, waiting: this.jobs.size + this.queue.length };
  },
};
