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

export class Assets {
  constructor(base = '/assets') {
    this.base = base;
    this.jsonCache = new Map();
    this.imgCache = new Map();
  }

  json(path) {
    if (!this.jsonCache.has(path)) {
      const wz = path.split('/')[0];
      const p = fetch(`${this.base}/${path}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((tree) => (tree ? prepare(tree, wz) : null))
        .catch(() => null);
      this.jsonCache.set(path, p);
    }
    return this.jsonCache.get(path);
  }

  _entry(node) {
    let e = this.imgCache.get(node._canvas);
    if (!e) {
      const img = new Image();
      e = { img, ready: false };
      e.promise = new Promise((res) => {
        img.onload = () => { e.ready = true; res(img); };
        img.onerror = () => res(null);
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
