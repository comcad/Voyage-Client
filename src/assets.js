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

/**
 * How many images load at once. The rest wait their turn by priority: 0 what is drawn now (a map, a window, someone
 * arriving, an NPC), 1 poses someone may take next, 2 face expressions. Started all at once, a crowd arriving was
 * thousands of loads in flight and the browser locked up.
 */
const IMAGE_SLOTS = 12;
/** A load that hasn't finished in this long gives its slot up (it still counts once it comes in). */
const SLOT_TIMEOUT_MS = 20000;

export class Assets {
  constructor(base = '/assets') {
    this.base = base;
    this.jsonCache = new Map();
    this.imgCache = new Map();
    this.loaded = 0; this.loadedPx = 0;   // images loaded so far and their pixels (the /fps report)
    this.waiting = [[], [], []]; this.waitHead = [0, 0, 0];   // images waiting for a slot, by priority
    this.inFlight = 0;
    this.firstDraws = 0;   // images asked for to draw for the first time (the /fps meter)
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

  _entry(node, pri = 0) {
    let e = this.imgCache.get(node._canvas);
    // one that failed to load (a dropped connection) is tried again 5s later, three tries in all
    const retry = e?.err && e.tries < 3 && performance.now() - e.failedAt > 5000;
    if (!e || retry) {
      e = { img: null, ready: false, tries: e?.tries || 0, src: `${this.base}/${node._canvas}`, pri: this.waiting.length, started: false };
      e.promise = new Promise((res) => { e.settle = res; });
      this.imgCache.set(node._canvas, e);
    }
    // asked for sooner than it was waiting for: it moves up (and is passed over where it waited before)
    if (!e.started && pri < e.pri) { e.pri = pri; this.waiting[pri].push(e); this._pump(); }
    return e;
  }

  /** Starts waiting images while there are free slots, most urgent first. */
  _pump() {
    while (this.inFlight < IMAGE_SLOTS) {
      const e = this._next();
      if (!e) return;
      this._load(e);
    }
  }

  _next() {
    for (let p = 0; p < this.waiting.length; p++) {
      const q = this.waiting[p];
      while (this.waitHead[p] < q.length) {
        const e = q[this.waitHead[p]++];
        if (!e.started) return e;
      }
      q.length = 0; this.waitHead[p] = 0;
    }
    return null;
  }

  _load(e) {
    e.started = true; this.inFlight++;
    let held = true;
    const release = () => { if (held) { held = false; this.inFlight--; this._pump(); } };
    const guard = setTimeout(release, SLOT_TIMEOUT_MS);
    const img = new Image();
    e.img = img;
    const finish = (ok) => { clearTimeout(guard); release(); e.settle(ok ? img : null); };
    // decoded before it counts as loaded: drawn undecoded, the first frame that shows it would decode it there and then
    img.onload = () => { const done = () => { e.ready = true; this.loaded++; this.loadedPx += img.naturalWidth * img.naturalHeight; finish(true); }; if (img.decode) img.decode().then(done, done); else done(); };
    img.onerror = () => { e.err = true; e.tries++; e.failedAt = performance.now(); finish(false); };
    img.src = e.src;
  }

  /** Returns the loaded image, or null while it is still loading (it starts loading on first call, first in line). */
  image(node) {
    if (!isCanvas(node)) return null;
    const e = this._entry(node);
    if (!e.ready) return null;
    if (!e.drawn) { e.drawn = true; this.firstDraws++; }
    return e.img;
  }

  /** Loads canvases at a priority (see IMAGE_SLOTS), resolving once all are in; onProgress(done, total) after each. */
  preload(nodes, onProgress, pri = 0) {
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
