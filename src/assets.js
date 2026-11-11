/**
 * Loads .img JSON trees and canvas PNGs produced by tools/wz-extract.mjs.
 *
 * json('Character/00002000.img') -> property tree where
 *   - canvas nodes carry `_canvas` (path under /assets), `_w`, `_h`, origin, delay, z, map...
 *   - UOL links are already resolved to the node they point at
 */
export const pad = (n, len) => String(n).padStart(len, '0');

export const isCanvas = (v) => v !== null && typeof v === 'object' && typeof v._canvas === 'string';

/** Numeric children of a node in order ("0", "1", ...). */
export function frames(node) {
  if (!node || typeof node !== 'object') return [];
  const out = [];
  for (let i = 0; node[i] !== undefined; i++) out.push(node[i]);
  return out;
}

/**
 * The frame a list of frames shows `t` ms in (each frame its own delay, 100 without one): looping, or held on the
 * last one once played through.
 */
export function frameAt(fr, t, loop = true) {
  if (!fr?.length) return null;
  const total = fr.reduce((s, f) => s + (Number(f.delay) || 100), 0) || 1;
  let r = loop ? t % total : Math.min(t, total - 1), i = 0;
  while (i < fr.length - 1 && r >= (Number(fr[i].delay) || 100)) r -= Number(fr[i++].delay) || 100;
  return fr[i];
}

/** A WZ path like "Map/MapHelper.img/weather/snow": the .img file, then the node inside it. */
export async function nodeAt(assets, path) {
  const m = String(path || '').match(/^(.*?\.img)(?:\/(.*))?$/);
  if (!m) return null;
  let n = await assets.json(m[1]);
  for (const k of (m[2] || '').split('/').filter(Boolean)) n = n?.[k];
  return n ?? null;
}

/** How many canvases loaded ahead (Assets.enqueue) are out at once: about one batch's worth. */
const QUEUE_LOADS = 40;
/**
 * How many downloads (images and data alike) run at once; the rest wait their turn. Started all at once, a crowd
 * arriving (each player's look is a dozen data files and a few hundred images) is thousands of requests, and the
 * browser refuses them (ERR_INSUFFICIENT_RESOURCES).
 */
const MAX_LOADS = 8;
/** Files asked for at the same moment go out together, this many to a request (server.js /assets-batch). */
const BATCH_FILES = 40;
/**
 * Download priorities, first first: what is drawn now; a player arriving (their look, the pose they arrive in); and
 * everything else (a map's art, windows, loading ahead).
 */
const PRI = { urgent: 0, spawn: 1, normal: 2 };
const PRI_NAMES = Object.keys(PRI);

/**
 * Downloads asset files in batches. Everything asked for within a few ms goes out together, one request per BATCH_FILES
 * at each priority, each request taking a slot (Assets.slot): one round trip per batch instead of one per file. A
 * player's look is about fifty files, and plain HTTP runs six requests at a time, so a crowd arriving one file at a
 * time took tens of seconds over a network with any delay.
 * Batched files don't go through the browser's own cache, so where the browser allows a local one (localhost, https)
 * they are kept there for the next visit, under the server's asset version.
 */
class Batcher {
  constructor(assets) {
    this.a = assets;
    this.files = new Map();   // path -> { pri, sent, promise, resolve, reject }
    this.pending = PRI_NAMES.map(() => new Set());
    this.timer = 0;
    this.cache = typeof caches !== 'undefined' && globalThis.isSecureContext
      ? fetch(`${assets.base}-version`).then((r) => r.json()).then((v) => caches.open(`voyage-assets-${v.v}`)).catch(() => null)
      : Promise.resolve(null);
  }
  url(path) { return `${this.a.base}/${path}`; }
  /** A file's bytes as a Blob, or null when the server has no such file; it rejects on a dropped connection. */
  get(path, pri = 'normal') {
    let f = this.files.get(path);
    if (f) { this.bump(path, pri); return f.promise; }
    f = { pri, sent: false };
    f.promise = new Promise((resolve, reject) => { f.resolve = resolve; f.reject = reject; });
    this.files.set(path, f);
    const queue = () => { this.pending[PRI[f.pri] ?? 2].add(path); this.schedule(); };
    this.cache.then((c) => (c ? c.match(this.url(path)) : null)).then((hit) => (hit ? hit.blob() : null)).then((blob) => {
      if (!blob) { queue(); return; }
      this.files.delete(path); f.resolve(blob);
    }, queue);
    return f.promise;
  }
  /** Asked for again at a higher priority: moved up if it hasn't gone out yet, sent again ahead if it has. */
  bump(path, pri) {
    const f = this.files.get(path), to = PRI[pri] ?? 2, from = PRI[f?.pri] ?? 2;
    if (!f || to >= from) return;
    f.pri = pri;
    if (this.pending[from].delete(path) || f.sent) { this.pending[to].add(path); this.schedule(); }
  }
  schedule() { if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.flush(); }, 4); }
  flush() {
    PRI_NAMES.forEach((pri, i) => {
      const paths = [...this.pending[i]];
      this.pending[i].clear();
      for (let k = 0; k < paths.length; k += BATCH_FILES) {
        const batch = paths.slice(k, k + BATCH_FILES);
        for (const p of batch) { const f = this.files.get(p); if (f) f.sent = true; }
        this.a.slot(() => this.fetchBatch(batch), pri);
      }
    });
  }
  async fetchBatch(paths) {
    let buf;
    try {
      const r = await fetch(`${this.a.base}-batch?f=${paths.map(encodeURIComponent).join('|')}`);
      if (!r.ok) throw new Error(`asset batch: ${r.status}`);
      buf = new Uint8Array(await r.arrayBuffer());
    } catch (err) {
      for (const p of paths) { const f = this.files.get(p); if (f) { this.files.delete(p); f.reject(err); } }
      return;
    }
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), cache = await this.cache;
    let off = 0;
    for (const p of paths) {
      const len = view.getUint32(off);
      off += 4;
      const f = this.files.get(p);
      if (len === 0xffffffff) { if (f) { this.files.delete(p); f.resolve(null); } continue; }
      const blob = new Blob([buf.subarray(off, off + len)], { type: p.endsWith('.json') ? 'application/json' : 'image/png' });
      off += len;
      if (f) { this.files.delete(p); f.resolve(blob); }
      cache?.put(this.url(p), new Response(blob)).catch(() => {});
    }
  }
}
/** A first-in first-out list that doesn't shift its array (it can hold thousands). */
class Line {
  constructor() { this.list = []; this.head = 0; }
  get size() { return this.list.length - this.head; }
  push(v) { this.list.push(v); }
  take() { const v = this.list[this.head++]; if (this.head === this.list.length) { this.list.length = 0; this.head = 0; } return v; }
}

export class Assets {
  constructor(base = '/assets') {
    this.base = base;
    this.jsonCache = new Map();
    this.imgCache = new Map();
    this.loaded = 0; this.loadedPx = 0;   // images loaded so far and their pixels (the /fps report)
    this.slots = { active: 0, lines: [new Line(), new Line(), new Line()] };
    this.files = new Batcher(this);
  }

  /**
   * Runs a download (fn returns its promise) once one of the MAX_LOADS slots is free, by priority (PRI). Resolves or
   * rejects as fn does.
   */
  slot(fn, pri = 'normal') {
    return new Promise((resolve, reject) => {
      const s = this.slots;
      s.lines[PRI[pri] ?? PRI.normal].push(() => {
        s.active++;
        Promise.resolve().then(fn).then(resolve, reject).finally(() => { s.active--; this.nextSlot(); });
      });
      this.nextSlot();
    });
  }
  nextSlot() {
    const s = this.slots;
    while (s.active < MAX_LOADS) {
      const line = s.lines.find((l) => l.size);
      if (!line) return;
      line.take()();
    }
  }

  /** A data file (pri: see PRI); one still waiting is moved up when it is asked for at a higher priority. */
  json(path, pri = 'normal') {
    let p = this.jsonCache.get(path);
    if (!p) {
      const wz = path.split('/')[0];
      p = this.files.get(`${path}.json`, pri)
        .then((blob) => (blob ? blob.text() : null))
        .then((text) => (text ? prepare(JSON.parse(text), wz) : null))
        .catch(() => { this.jsonCache.delete(path); return null; });   // a dropped connection: asked again next time
      this.jsonCache.set(path, p);
    } else this.files.bump(`${path}.json`, pri);
    return p;
  }

  /** pri (see PRI): one already waiting is moved up when it is asked for at a higher priority. */
  _entry(node, pri = 'normal') {
    let e = this.imgCache.get(node._canvas);
    // one that failed to load (a dropped connection) is tried again 5s later, three tries in all
    const retry = e?.err && e.tries < 3 && performance.now() - e.failedAt > 5000;
    if (!e || retry) {
      const img = new Image(), tries = e?.tries || 0;
      e = { img, ready: false, tries, pri };
      e.promise = new Promise((res) => {
        // decoded before it counts as loaded: drawn undecoded, the first frame that shows it would decode it there and then
        img.onload = () => { const done = () => { e.ready = true; this.loaded++; this.loadedPx += img.naturalWidth * img.naturalHeight; res(img); }; if (img.decode) img.decode().then(done, done); else done(); };
        img.onerror = () => { e.err = true; e.tries = tries + 1; e.failedAt = performance.now(); res(null); };
      });
      // its bytes come in a batch (Batcher) and are shown from memory; none (no such file) or a dropped connection is
      // a failed load
      this.files.get(node._canvas, pri).then((blob) => {
        if (!blob) { img.onerror(); return; }
        const url = URL.createObjectURL(blob), done = () => URL.revokeObjectURL(url);
        img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true });
        img.src = url;
      }, () => img.onerror());
      this.imgCache.set(node._canvas, e);
    } else if (!e.ready && !e.err && (PRI[pri] ?? 2) < (PRI[e.pri] ?? 2)) { e.pri = pri; this.files.bump(node._canvas, pri); }
    return e;
  }

  /** Returns the loaded image, or null while it is still loading (it starts loading on first call). */
  image(node) {
    if (!isCanvas(node)) return null;
    const e = this._entry(node, 'urgent');
    return e.ready ? e.img : null;
  }

  /**
   * Loads canvases ahead of time (see preload.js): a few at a time, behind whatever is asked for to draw now, priority
   * 0 before 1 before 2; ones already loaded or loading are left out. Held while holdQueue() says so (a map loading).
   */
  enqueue(nodes, pri = 1) {
    const q = (this.queues ??= [[], [], []].map((list) => ({ list, head: 0 })))[pri];
    const queued = (this.queued ??= new Set());   // each canvas waits once, however many ask for it
    for (const n of nodes) if (isCanvas(n) && !this.imgCache.has(n._canvas) && !queued.has(n._canvas)) { q.list.push(n); queued.add(n._canvas); }
    this.pump();
  }
  /** How many canvases still wait in the queue at this priority. */
  waiting(pri) { const q = this.queues?.[pri]; return q ? q.list.length - q.head : 0; }
  pump() {
    if (!this.queues) return;
    if (this.holdQueue?.()) {
      if (!this.holdTimer) this.holdTimer = setTimeout(() => { this.holdTimer = 0; this.pump(); }, 250);
      return;
    }
    this.inFlight ??= 0;
    while (this.inFlight < QUEUE_LOADS) {
      const q = this.queues.find((x) => x.head < x.list.length);
      if (!q) return;
      const n = q.list[q.head++];
      if (q.head === q.list.length) { q.list.length = 0; q.head = 0; }
      this.queued.delete(n._canvas);
      if (this.imgCache.has(n._canvas)) continue;
      this.inFlight++;
      this._entry(n).promise.then(() => { this.inFlight--; this.pump(); });
    }
  }

  preload(nodes, onProgress, pri = 'normal') {
    const list = nodes.filter(isCanvas);
    let done = 0;
    return Promise.all(list.map((n) => this._entry(n, pri).promise.then(() => onProgress?.(++done, list.length))));
  }
}

function prepare(tree, wz) {
  const seen = new Set();
  (function prefix(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    // the files' own child order (kept by the extractor) stays readable but out of every key listing
    if (Array.isArray(node._order)) Object.defineProperty(node, '_order', { value: node._order, enumerable: false, configurable: true, writable: true });
    if (typeof node._canvas === 'string') node._canvas = `${wz}/${node._canvas}`;
    for (const k in node) prefix(node[k]);
  })(tree);

  // Resolve UOLs relative to the node that contains them. Repeat for chained links.
  for (let pass = 0; pass < 4; pass++) {
    let unresolved = 0;
    const visited = new Set();
    (function walk(node, ancestors) {
      if (!node || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);
      const chain = [...ancestors, node];
      for (const k in node) {
        const v = node[k];
        if (v && typeof v === 'object' && typeof v._uol === 'string') {
          const target = resolveUol(chain, v._uol);
          if (target && !(typeof target._uol === 'string')) node[k] = target;
          else unresolved++;
        } else walk(v, chain);
      }
    })(tree, []);
    if (!unresolved) break;
  }
  return tree;
}

function resolveUol(chain, uol) {
  let stack = chain.slice();
  for (const seg of uol.split('/')) {
    if (seg === '..') { stack.pop(); if (!stack.length) return null; continue; }
    if (seg === '.' || seg === '') continue;
    const cur = stack[stack.length - 1];
    const next = cur?.[seg];
    if (next === undefined || next === null) return null;
    stack.push(next);
  }
  return stack[stack.length - 1];
}
