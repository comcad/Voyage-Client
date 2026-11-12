/**
 * Loads .img JSON trees and canvas PNGs produced by tools/wz-extract.mjs.
 *
 * json('Character/00002000.img') -> property tree where
 *   - canvas nodes carry `_canvas` (path under /assets), `_w`, `_h`, origin, delay, z, map...
 *   - UOL links are already resolved to the node they point at
 *   - a character file's canvas nodes may carry `_at` ([sheet, x, y, w, h]): the server has packed the file's images
 *     into sheets, and the node's is at that place in that one (Assets.slice)
 */
import { config } from './config.js';

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
    this.useSheets = true;   // /fps sheets: character images drawn from the server's sheets, or each from its own file
    this.sheets = 0;         // sheets loaded so far (the /fps report)
    this._slice = { img: null, x: 0, y: 0, w: 0, h: 0 };
  }

  json(path) {
    if (!this.jsonCache.has(path)) {
      const wz = path.split('/')[0];
      const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : null));
      const own = () => get(`${this.base}/${path}.json`);
      // a character file is asked for with its images' places in the server's sheets, when the server packs them
      // (one it has no sheets for comes back as it is); if that can't be had, the file as it is
      const p = (config.characterSheets && wz === 'Character' ? get(`${this.base}/_sheets/${path}.json`).then((tree) => tree || own(), own) : own())
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
      e = { img: null, ready: false, tries: e?.tries || 0, src: `${this.base}/${node._canvas}`, pri: this.waiting.length, started: false, sheet: node._canvas.startsWith('_sheets/') };
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
    img.onload = () => { const done = () => { e.ready = true; this.loaded++; this.loadedPx += img.naturalWidth * img.naturalHeight; if (e.sheet) this.sheets++; finish(true); }; if (img.decode) img.decode().then(done, done); else done(); };
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

  /** The sheet a canvas node's image is packed in; none with sheets off, or when that sheet couldn't be loaded. */
  _sheetOf(node) {
    const sheet = this.useSheets ? node._sheet : null;
    return sheet && !this.imgCache.get(sheet._canvas)?.err ? sheet : null;
  }

  /**
   * What a canvas node is drawn from: { img, x, y, w, h }, its place in the sheet the server packed it in (a
   * character's pieces), or its own image, whole. Draw it with
   *   ctx.drawImage(s.img, s.x, s.y, s.w, s.h, dx, dy, s.w, s.h)
   * Null while that loads (it starts loading on the first call, first in line). The same object comes back every
   * call: use it before asking for the next.
   */
  slice(node) {
    if (!isCanvas(node)) return null;
    const sheet = this._sheetOf(node), img = this.image(sheet || node);
    if (!img) return null;
    const s = this._slice;
    s.img = img;
    if (sheet) { const at = node._at; s.x = at[1]; s.y = at[2]; s.w = at[3]; s.h = at[4]; }
    else { s.x = 0; s.y = 0; s.w = img.width; s.h = img.height; }
    return s;
  }

  /** Whether a canvas node can be drawn now (slice); it is asked for, first in line, when it can't. */
  ready(node) { return isCanvas(node) && !!this.image(this._sheetOf(node) || node); }

  /**
   * Loads canvases at a priority (see IMAGE_SLOTS), resolving once all can be drawn (slice); onProgress(done, total)
   * after each. One packed in a sheet waits for the sheet: a look's every piece for a pose comes in with a request a
   * file rather than one a piece. A sheet that can't be had gives way to the canvas's own image.
   */
  preload(nodes, onProgress, pri = 0) {
    const list = nodes.filter(isCanvas);
    let done = 0;
    return Promise.all(list.map((n) => {
      const sheet = this._sheetOf(n);
      const got = sheet ? this._entry(sheet, pri).promise.then((img) => img || this._entry(n, pri).promise) : this._entry(n, pri).promise;
      return got.then(() => onProgress?.(++done, list.length));
    }));
  }
}

function prepare(tree, wz) {
  const seen = new Set(), sheets = new Map();
  (function prefix(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    // the files' own child order (kept by the extractor) stays readable but out of every key listing
    if (Array.isArray(node._order)) Object.defineProperty(node, '_order', { value: node._order, enumerable: false, configurable: true, writable: true });
    if (typeof node._canvas === 'string') {
      node._canvas = `${wz}/${node._canvas}`;
      // packed in one of its file's sheets (`_at`): the node gets that sheet as `_sheet`, a canvas node of its own
      // (one for everything in the sheet) kept out of every key listing
      const at = node._at, cut = Array.isArray(at) && typeof at[0] === 'string' ? node._canvas.indexOf('.img/') : -1;
      if (cut > 0) {
        const src = `_sheets/${node._canvas.slice(0, cut + 4)}/${at[0]}.png`;
        let sheet = sheets.get(src);
        if (!sheet) sheets.set(src, (sheet = { _canvas: src }));
        Object.defineProperty(node, '_sheet', { value: sheet, enumerable: false, configurable: true, writable: true });
      }
    }
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
