import { VIEW_W, PIXEL_SCALE } from './view.js';
import { settings } from './settings.js';
import { spriteStats } from './character.js';
import { BUILD } from './build.js';

/**
 * The /fps meter (a Voyage tool, not part of the original client), over the last two seconds:
 * - FPS: frames drawn in the last second, against the FRAME RATE choice;
 * - frame times between drawn frames (average, worst) and the 1% low (the frame rate of the slowest 1% of frames);
 * - the display's refresh rate (the quickest the browser has offered frames in the last minute: a page that can't keep
 *   up is offered frames only as fast as it draws them, which would pass for a slower display) and frames that came
 *   late (more than 1.5 refreshes after the one before);
 * - hitches over the last 30 seconds (a frame more than 1.6 times as late as frames have lately been, and at least
 *   25ms; a page that is slow all the time shows as a low FPS, not as hitches): how many, and the latest with the
 *   game's own time for the frame before it. A hitch whose game time is small
 *   happened outside the game's code: the browser collecting garbage, decoding an image, or the graphics card;
 * - the game's own update and draw times. These are JavaScript only: the graphics card's share of a frame doesn't
 *   show here, it shows as late frames and a low FPS while these stay small. The draw time's biggest parts, on
 *   average (both breakdowns in /fps copy);
 * - the canvas, its scale and the view; how many background buffers a frame draws, and their size;
 * - a graph of the last 180 frame times, with the 60 and 30 fps lines: yellow a frame that missed a refresh (more
 *   than 1.5 refreshes after the one before, as a late frame above), red one that missed two or more. A frame a few
 *   ms off the refresh stays green: it still reached the screen on the refresh, and the game moves by whole
 *   refreshes (framepace.js).
 * The numbers are worked out four times a second; the graph moves every frame.
 *
 * `/fps copy` copies a report of the hitches: for each, what happened between the two frames (images that finished
 * loading, packets handled and their time, garbage collected, the browser's long frames), what the frame before it
 * updated in its time (the map, the interface, quests, monsters, you, other players, effects, timers, the rest) and
 * drew in it (backgrounds, map, monsters, characters, effects, interface, the rest), how many images it drew
 * for the first time (the browser readies an image for the screen the first time it is drawn), and the machine's
 * details. A part that is big in one hitch and small in the next points at the browser collecting garbage then.
 */
const SPAN = 2000, BARS = 180, W = 236, PAD = 6, HITCH_SPAN = 30000, LONG_SPAN = 60000;
const RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];   // displays' refresh rates (Hz)
/** A frame's parts (update or drawing), biggest first: "chars 25.1, fx 6.2, ...", those of at least `min` ms. */
const topParts = (parts, n = 4, min = 0.5) => Object.entries(parts || {}).filter(([, v]) => v >= min).sort((x, y) => y[1] - x[1]).slice(0, n)
  .map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ') || 'little';
export class PerfMeter {
  constructor() {
    this.frames = []; this.offers = []; this.hitches = []; this.cached = null; this.cachedAt = -1e9;
    // what happens between frames: packets handled (count, ms, the slowest), images loaded, the JS heap
    this.pk = { n: 0, ms: 0, max: 0, op: 0 };
    this.onPacket = (op, ms) => { const p = this.pk; p.n++; p.ms += ms; if (ms > p.max) { p.max = ms; p.op = op; } };
    this.mark = null;
    // the browser's own record of frames over 50ms (Chrome), with what ran in them
    this.longs = [];
    try {
      const types = PerformanceObserver.supportedEntryTypes || [];
      const type = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : null;
      if (type) {
        this.observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) this.longs.push(e);
          const now = performance.now();
          while (this.longs.length && now - this.longs[0].startTime > LONG_SPAN) this.longs.shift();
        });
        this.observer.observe({ type, buffered: false });
        this.longType = type;
      }
    } catch { /* not supported */ }
  }
  /** The browser offered a frame at t (drawn or not). */
  offer(t) { this.offers.push(t); while (this.offers.length && t - this.offers[0] > SPAN) this.offers.shift(); }
  /** A frame was drawn at t, its update and draw taking upd / ren ms. */
  frame(t, upd, ren, game) {
    const conn = game?.net?.conn;
    if (conn && conn.timing !== this.onPacket) conn.timing = this.onPacket;
    const a = game?.assets, heap = performance.memory?.usedJSHeapSize ?? 0;
    const mark = { loaded: a?.loaded || 0, loadedPx: a?.loadedPx || 0, heap, pkN: this.pk.n, pkMs: this.pk.ms, firsts: a?.firstDraws || 0 };
    const prev = this.frames[this.frames.length - 1], was = this.mark;
    if (prev && was) {
      const gap = t - prev.t, want = settings.fps === 60 || settings.fps === 30 ? 1000 / settings.fps : this.refreshMs || 16.7;
      if (gap > Math.max(25, Math.max(want, this.typicalMs || 0) * 1.6)) {
        this.hitches.push({
          t, at: Date.now(), gap, upd: prev.upd, ren: prev.ren, game: prev.upd + prev.ren, drew: prev.parts, updated: prev.uparts, firsts: prev.firsts,
          images: mark.loaded - was.loaded, imagePx: mark.loadedPx - was.loadedPx,
          packets: mark.pkN - was.pkN, packetMs: mark.pkMs - was.pkMs, slowOp: this.pk.max ? this.pk.op : null, slowMs: this.pk.max,
          heap: heap && was.heap ? heap - was.heap : null,
          x: Math.round(game?.player?.x ?? 0), y: Math.round(game?.player?.y ?? 0), map: game?.map?.id ?? null,
        });
      }
    }
    this.pk.max = 0;
    this.mark = mark;
    while (this.hitches.length && t - this.hitches[0].t > HITCH_SPAN) this.hitches.shift();
    this.frames.push({ t, upd, ren, parts: game?.drawParts ? { ...game.drawParts } : null, uparts: game?.updateParts ? { ...game.updateParts } : null, firsts: was ? mark.firsts - was.firsts : 0 });
    while (this.frames.length > BARS + 1 || (this.frames.length && t - this.frames[0].t > Math.max(SPAN, 4000))) this.frames.shift();
  }
  /** The meter is put away: packets stop being timed. */
  detach(game) { if (game?.net?.conn?.timing === this.onPacket) game.net.conn.timing = null; this.observer?.disconnect(); }
  stats() {
    const f = this.frames, now = f.length ? f[f.length - 1].t : 0;
    const recentGaps = [];
    for (let i = 1; i < f.length; i++) if (now - f[i].t <= SPAN) recentGaps.push(f[i].t - f[i - 1].t);
    const recent = f.filter((x) => now - x.t <= SPAN);
    const og = [];
    for (let i = 1; i < this.offers.length; i++) og.push(this.offers[i] - this.offers[i - 1]);
    og.sort((a, b) => a - b);
    const offered = og.length ? og[og.length >> 1] : 16.7;
    // the display's refresh: the quickest the browser has offered frames in the last minute
    this.offeredMs ??= [];
    this.offeredMs.push({ t: now, ms: offered });
    while (this.offeredMs.length && now - this.offeredMs[0].t > 60000) this.offeredMs.shift();
    let refresh = Math.min(...this.offeredMs.map((o) => o.ms));
    // (the quickest of a minute's reads runs a few percent fast: 63Hz on a 60Hz display. To the rate displays have.)
    const rate = RATES.find((r) => Math.abs(1000 / refresh - r) / r < 0.06);
    if (rate) refresh = 1000 / rate;
    this.refreshMs = refresh;
    const sorted = [...recentGaps].sort((a, b) => a - b), avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    this.typicalMs = sorted.length ? sorted[sorted.length >> 1] : refresh;   // how long frames have lately taken
    // what the drawing and the update went on lately, part by part, on average
    const parts = (key) => {
      const out = {}; let n = 0;
      for (const x of recent) if (x[key]) { n++; for (const k in x[key]) out[k] = (out[k] || 0) + x[key][k]; }
      for (const k in out) out[k] /= n;
      return n ? out : null;
    };
    const low = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0;
    const want = settings.fps === 60 || settings.fps === 30 ? 1000 / settings.fps : refresh;
    return {
      fps: f.filter((x) => now - x.t <= 1000).length,
      avg: avg(recentGaps), max: sorted.length ? sorted[sorted.length - 1] : 0, low: low ? 1000 / low : 0,
      refresh: 1000 / refresh, late: recentGaps.filter((g) => g > Math.max(want, refresh) * 1.5).length,
      upd: avg(recent.map((x) => x.upd)), updMax: Math.max(0, ...recent.map((x) => x.upd)),
      ren: avg(recent.map((x) => x.ren)), renMax: Math.max(0, ...recent.map((x) => x.ren)), now,
      drew: parts('parts'), updated: parts('uparts'),
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
      [`draw: ${topParts(s.drew, 3, 0.3)}`, '#ccc'],
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
    const want = Math.max(settings.fps === 60 || settings.fps === 30 ? 1000 / settings.fps : 0, this.refreshMs || 16.7);
    for (let i = 0; i < n; i++) {
      const g = f[f.length - n + i].t - f[f.length - n + i - 1].t;
      ctx.fillStyle = g > want * 2.5 ? '#ff6060' : g > want * 1.5 ? '#ffcc66' : '#66dd66';
      const bh = Math.min(gh, g * scale);
      ctx.fillRect(gx + (BARS - n + i) * bw, gy + gh - bh, Math.max(1, bw - 0.2), bh);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(gx, gy + gh - 16.7 * scale, gw, 0.5); ctx.fillRect(gx, gy + gh - 33.3 * scale, gw, 0.5);
    ctx.restore();
  }

  /** The text `/fps copy` puts on the clipboard. */
  report(game) {
    const s = this.stats(), c = game.canvas, a = game.assets, out = [];
    const num = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));
    let gpu = '-';
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      gpu = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no WebGL';
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* ignore */ }
    let px = 0, n = 0;
    for (const e of a?.imgCache?.values() || []) if (e.ready && e.img) { n++; px += (e.img.naturalWidth || 0) * (e.img.naturalHeight || 0); }
    out.push(`Voyage /fps report ${new Date().toISOString()}  build ${BUILD}${game.newBuild ? ` (the server has ${game.newBuild}: reload the page)` : ''}`);
    out.push(`browser: ${navigator.userAgent}`);
    out.push(`gpu: ${gpu}`);
    out.push(`window ${c.clientWidth}x${c.clientHeight} @${window.devicePixelRatio || 1}x  canvas ${c.width}x${c.height} (${PIXEL_SCALE}x)  view ${game.cam.w}x${game.cam.h}  display ${Math.round(s.refresh)} Hz`);
    out.push(`FRAME RATE ${settings.fps}  zoom ${settings.zoom ?? 1}  quality ${settings.quality ?? '-'}  map ${game.map?.id ?? '-'}  images ${n} (${(px * 4 / 1e6).toFixed(0)} MB decoded)`);
    const sp = spriteStats();
    out.push(`character frame images (/fps sprites): ${sp.on ? `on, ${sp.n} kept (${(sp.px / 1e6).toFixed(1)} Mpx)` : 'off'}`);
    if (performance.memory) out.push(`js heap ${(performance.memory.usedJSHeapSize / 1e6).toFixed(0)} / ${(performance.memory.jsHeapSizeLimit / 1e6).toFixed(0)} MB`);
    out.push(`last 2 s: ${s.fps} fps, frame ${num(s.avg)} ms avg, ${num(s.max)} worst, update ${num(s.upd)} ms, draw ${num(s.ren)} ms (max ${num(s.renMax)})`);
    if (s.drew) out.push(`  drawing on average: ${topParts(s.drew, 8, 0.1)}`);
    if (s.updated) out.push(`  update on average: ${topParts(s.updated, 9, 0.1)}`);
    out.push(`hitches in the last 30 s: ${this.hitches.length}`);
    const now = performance.now();
    const top = (parts) => topParts(parts);
    for (const h of this.hitches) {
      const outside = h.gap - h.game - h.packetMs;
      const parts = [
        `${((now - h.t) / 1000).toFixed(1)} s ago: ${Math.round(h.gap)} ms`,
        `game ${num(h.upd)} + ${num(h.ren)} ms`,
        ...(h.updated && h.upd >= 2 ? [`updated ${top(h.updated)}`] : []),
        ...(h.drew ? [`drew ${top(h.drew)}`] : []),
        `packets ${h.packets} (${num(h.packetMs)} ms${h.slowOp !== null && h.slowMs > 2 ? `, slowest 0x${h.slowOp.toString(16)} ${num(h.slowMs)} ms` : ''})`,
        `outside ${num(outside)} ms`,
        `images ${h.images}${h.images ? ` (${(h.imagePx / 1e6).toFixed(2)} Mpx)` : ''}`,
        `first drawn ${h.firsts ?? '-'}`,
      ];
      if (h.heap !== null) parts.push(h.heap < 0 ? `gc ${(-h.heap / 1e6).toFixed(1)} MB` : `heap +${(h.heap / 1024).toFixed(0)} KB`);
      parts.push(`at ${h.x},${h.y}`);
      out.push(`  ${parts.join(' | ')}`);
      // the browser's long frames that overlap it
      for (const e of this.longs) {
        if (e.startTime > h.t || e.startTime + e.duration < h.t - h.gap) continue;
        let line = `    browser ${this.longType}: ${Math.round(e.duration)} ms`;
        if (e.renderStart) line += `, render from +${Math.round(e.renderStart - e.startTime)}`;
        if (e.styleAndLayoutStart) line += `, style/layout from +${Math.round(e.styleAndLayoutStart - e.startTime)}`;
        if (e.blockingDuration !== undefined) line += `, blocking ${Math.round(e.blockingDuration)}`;
        const scripts = [...(e.scripts || [])].sort((x, y) => y.duration - x.duration).slice(0, 3)
          .map((sc) => `${sc.invoker || sc.invokerType || '?'} ${Math.round(sc.duration)} ms${sc.sourceFunctionName ? ` ${sc.sourceFunctionName}` : ''}`);
        if (scripts.length) line += `; scripts: ${scripts.join(', ')}`;
        out.push(line);
      }
    }
    return out.join('\n');
  }
}
