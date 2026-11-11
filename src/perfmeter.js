import { VIEW_W, PIXEL_SCALE } from './view.js';
import { settings } from './settings.js';

/**
 * The /fps meter (a Voyage tool, not part of the original client), over the last two seconds:
 * - FPS: frames drawn in the last second, against the FRAME RATE choice;
 * - frame times between drawn frames (average, worst) and the 1% low (the frame rate of the slowest 1% of frames);
 * - the display's refresh rate (how often the browser offers a frame) and frames that came late (more than 1.5
 *   refreshes after the one before);
 * - hitches over the last 30 seconds (a frame more than twice as late as it should be, and at least 25ms): how
 *   many, and the latest with the game's own time for the frame before it. A hitch whose game time is small
 *   happened outside the game's code: the browser collecting garbage, decoding an image, or the graphics card;
 * - the game's own update and draw times. These are JavaScript only: the graphics card's share of a frame doesn't
 *   show here, it shows as late frames and a low FPS while these stay small;
 * - the canvas, its scale and the view; how many background buffers a frame draws, and their size;
 * - a graph of the last 180 frame times, with the 60 and 30 fps lines.
 * The numbers are worked out four times a second; the graph moves every frame.
 */
const SPAN = 2000, BARS = 180, W = 236, PAD = 6, HITCH_SPAN = 30000;
export class PerfMeter {
  constructor() { this.frames = []; this.offers = []; this.hitches = []; this.cached = null; this.cachedAt = -1e9; }
  /** The browser offered a frame at t (drawn or not). */
  offer(t) { this.offers.push(t); while (this.offers.length && t - this.offers[0] > SPAN) this.offers.shift(); }
  /** A frame was drawn at t, its update and draw taking upd / ren ms. */
  frame(t, upd, ren) {
    const prev = this.frames[this.frames.length - 1];
    if (prev) {
      const gap = t - prev.t, want = settings.fps === 60 || settings.fps === 30 ? 1000 / settings.fps : this.refreshMs || 16.7;
      if (gap > Math.max(25, want * 2)) this.hitches.push({ t, gap, game: prev.upd + prev.ren });
    }
    while (this.hitches.length && t - this.hitches[0].t > HITCH_SPAN) this.hitches.shift();
    this.frames.push({ t, upd, ren });
    while (this.frames.length > BARS + 1 || (this.frames.length && t - this.frames[0].t > Math.max(SPAN, 4000))) this.frames.shift();
  }
  stats() {
    const f = this.frames, now = f.length ? f[f.length - 1].t : 0;
    const recentGaps = [];
    for (let i = 1; i < f.length; i++) if (now - f[i].t <= SPAN) recentGaps.push(f[i].t - f[i - 1].t);
    const recent = f.filter((x) => now - x.t <= SPAN);
    const og = [];
    for (let i = 1; i < this.offers.length; i++) og.push(this.offers[i] - this.offers[i - 1]);
    og.sort((a, b) => a - b);
    const refresh = og.length ? og[og.length >> 1] : 16.7;
    this.refreshMs = refresh;
    const sorted = [...recentGaps].sort((a, b) => a - b), avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const low = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0;
    const want = settings.fps === 60 || settings.fps === 30 ? 1000 / settings.fps : refresh;
    return {
      fps: f.filter((x) => now - x.t <= 1000).length,
      avg: avg(recentGaps), max: sorted.length ? sorted[sorted.length - 1] : 0, low: low ? 1000 / low : 0,
      refresh: 1000 / refresh, late: recentGaps.filter((g) => g > Math.max(want, refresh) * 1.5).length,
      upd: avg(recent.map((x) => x.upd)), updMax: Math.max(0, ...recent.map((x) => x.upd)),
      ren: avg(recent.map((x) => x.ren)), renMax: Math.max(0, ...recent.map((x) => x.ren)), now,
    };
  }
  draw(ctx, game) {
    const last = this.frames[this.frames.length - 1]?.t ?? 0;
    if (!this.cached || last - this.cachedAt >= 250 || last < this.cachedAt) { this.cached = this.stats(); this.cachedAt = last; }
    const s = this.cached, c = game.canvas, buf = game.map?.bufStats, h0 = this.hitches[this.hitches.length - 1];
    const cap = settings.fps === 60 || settings.fps === 30 ? `${settings.fps} cap` : 'VSync';
    const hitchText = h0
      ? `hitches (30 s): ${this.hitches.length}  last ${Math.round(h0.gap)} ms, game ${h0.game.toFixed(1)} ms, ${Math.round((last - h0.t) / 1000)} s ago`
      : 'hitches (30 s): 0';
    const lines = [
      [`FPS ${s.fps}  (${cap}, display ${Math.round(s.refresh)} Hz)`, s.fps < Math.min(55, s.refresh - 5) && cap === 'VSync' ? '#ff8080' : '#9f9'],
      [`frame ${s.avg.toFixed(1)} ms avg  ${s.max.toFixed(1)} worst  1% low ${Math.round(s.low)} fps`, '#fff'],
      [`late frames (2 s): ${s.late}`, s.late ? '#ffcc66' : '#fff'],
      [hitchText, h0 ? '#ffcc66' : '#fff'],
      [`update ${s.upd.toFixed(1)} ms (max ${s.updMax.toFixed(1)})  draw ${s.ren.toFixed(1)} ms (max ${s.renMax.toFixed(1)})`, '#fff'],
      [`canvas ${c.width}x${c.height} (${PIXEL_SCALE}x)  view ${game.cam.w}x${game.cam.h}`, '#ccc'],
      [`window ${c.clientWidth}x${c.clientHeight} @${window.devicePixelRatio || 1}x  bg buffers ${buf?.n || 0}${buf?.n ? ` (${(buf.px / 1e6).toFixed(1)} Mpx)` : ''}`, '#ccc'],
    ];
    const gh = 40, h = PAD * 2 + lines.length * 13 + gh + 4, x = VIEW_W - W - 8, y = 84;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x, y, W, h);
    ctx.font = '10px Menlo, Consolas, monospace'; ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) { ctx.fillStyle = lines[i][1]; ctx.fillText(lines[i][0], x + PAD, y + PAD + i * 13, W - PAD * 2); }
    // the graph: one bar per frame, 50ms full height; lines at 16.7 (60 fps) and 33.3 (30 fps)
    const gx = x + PAD, gy = y + PAD + lines.length * 13 + 2, gw = W - PAD * 2, scale = gh / 50;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(gx, gy, gw, gh);
    const f = this.frames, n = Math.min(BARS, f.length - 1), bw = gw / BARS;
    for (let i = 0; i < n; i++) {
      const g = f[f.length - n + i].t - f[f.length - n + i - 1].t;
      ctx.fillStyle = g > 34 ? '#ff6060' : g > 18 ? '#ffcc66' : '#66dd66';
      const bh = Math.min(gh, g * scale);
      ctx.fillRect(gx + (BARS - n + i) * bw, gy + gh - bh, Math.max(1, bw - 0.2), bh);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(gx, gy + gh - 16.7 * scale, gw, 0.5); ctx.fillRect(gx, gy + gh - 33.3 * scale, gw, 0.5);
    ctx.restore();
  }
}
