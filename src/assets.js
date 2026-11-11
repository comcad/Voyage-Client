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

/** How many queued canvases load at once (the browser allows six requests to the server at a time). */
const QUEUE_LOADS = 4;

export class Assets {
  constructor(base = '/assets') {
    this.base = base;
    this.jsonCache = new Map();
    this.imgCache = new Map();
    this.loaded = 0; this.loadedPx = 0;   // images loaded so far and their pixels (the /fps report)
  }

  json(path) {
    if (!this.jsonCache.has(path)) {
      const wz = path.split('/')[0];
      const p = fetch(`${this.base}/${path}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((tree) => (tree ? prepare(tree, wz) : null))
        .catch(() => { this.jsonCache.delete(path); return null; });   // a dropped connection: asked again next time
      this.jsonCache.set(path, p);
    }
    return this.jsonCache.get(path);
  }

  _entry(node) {
    let e = this.imgCache.get(node._canvas);
    // one that failed to load (a dropped connection) is tried again 5s later, three tries in all
    const retry = e?.err && e.tries < 3 && performance.now() - e.failedAt > 5000;
    if (!e || retry) {
      const img = new Image(), tries = e?.tries || 0;
      e = { img, ready: false, tries };
      e.promise = new Promise((res) => {
        // decoded before it counts as loaded: drawn undecoded, the first frame that shows it would decode it there and then
        img.onload = () => { const done = () => { e.ready = true; this.loaded++; this.loadedPx += img.naturalWidth * img.naturalHeight; res(img); }; if (img.decode) img.decode().then(done, done); else done(); };
        img.onerror = () => { e.err = true; e.tries = tries + 1; e.failedAt = performance.now(); res(null); };
      });
      img.src = `${this.base}/${node._canvas}`;
      this.imgCache.set(node._canvas, e);
    }
    return e;
  }

  /** Returns the loaded image, or null while it is still loading (it starts loading on first call). */
  image(node) {
    if (!isCanvas(node)) return null;
    const e = this._entry(node);
    return e.ready ? e.img : null;
  }

  /**
   * Loads canvases ahead of time (see preload.js): a few at a time, behind whatever is asked for to draw now, priority
   * 0 before 1 before 2; ones already loaded or loading are left out. Held while holdQueue() says so (a map loading).
   */
  enqueue(nodes, pri = 1) {
    const q = (this.queues ??= [[], [], []].map((list) => ({ list, head: 0 })))[pri];
    for (const n of nodes) if (isCanvas(n) && !this.imgCache.has(n._canvas)) q.list.push(n);
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
      if (this.imgCache.has(n._canvas)) continue;
      this.inFlight++;
      this._entry(n).promise.then(() => { this.inFlight--; this.pump(); });
    }
  }

  preload(nodes, onProgress) {
    const list = nodes.filter(isCanvas);
    let done = 0;
    return Promise.all(list.map((n) => this._entry(n).promise.then(() => onProgress?.(++done, list.length))));
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
