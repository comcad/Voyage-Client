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

/** What an entry's bytes become once it is decoded (the Blob isn't kept). */
const NO_BYTES = Promise.resolve(null);
/** How many canvases loaded ahead (Assets.enqueue) are out at once: about one batch's worth. */
const QUEUE_LOADS = 40;
/**
 * How many batches download at once; the rest wait their turn. Started all at once, a crowd arriving (each player's
 * look is a dozen data files and a few hundred images) is thousands of requests, and the browser refuses them
 * (ERR_INSUFFICIENT_RESOURCES). Loading ahead leaves AHEAD_FREE of them for what is wanted now.
 */
const MAX_LOADS = 8;
const AHEAD_FREE = 2;
/** Files go out together, up to this many to a request (server.js /assets-batch). */
const BATCH_FILES = 40;
/**
 * Priorities, first first: what is drawn now; a player arriving (their look, the pose they arrive in); everything else
 * (a map's art, windows); and loading ahead (preload.js), which never holds up the others.
 */
const PRI = { urgent: 0, spawn: 1, normal: 2, ahead: 3 };
const PRI_NAMES = Object.keys(PRI);

/** A first-in first-out list that doesn't shift its array (it can hold thousands). */
class Line {
  constructor() { this.list = []; this.head = 0; }
  get size() { return this.list.length - this.head; }
  push(v) { this.list.push(v); }
  take() { const v = this.list[this.head++]; if (this.head === this.list.length) { this.list.length = 0; this.head = 0; } return v; }
}

/**
 * Main-thread work after downloads (unpacking a batch, parsing a data file, working out what a look draws) runs
 * SLICE_MS at a time, by priority, so a burst of arrivals is spread over frames rather than stalling one: batching
 * makes a crowd's files land together.
 */
const SLICE_MS = 4;
class Slicer {
  constructor() {
    this.lines = PRI_NAMES.map(() => new Line()); this.running = false;
    this.channel = new MessageChannel();   // a message comes back as its own task, with no timer's minimum wait
    this.channel.port1.onmessage = () => this.run();
  }
  /** Runs fn in a slice (pri: see PRI); resolves with what it returns. */
  add(fn, pri = 'normal') {
    return new Promise((resolve, reject) => {
      this.lines[PRI[pri] ?? 2].push(() => { try { resolve(fn()); } catch (err) { reject(err); } });
      if (!this.running) { this.running = true; this.channel.port2.postMessage(0); }
    });
  }
  run() {
    const end = performance.now() + SLICE_MS;
    let line;
    while ((line = this.lines.find((l) => l.size)) && performance.now() < end) line.take()();
    if (this.lines.some((l) => l.size)) this.channel.port2.postMessage(0); else this.running = false;
  }
}

/**
 * The local copy of downloaded files, under the server's asset version. It is IndexedDB, which a page on plain http
 * has too (a LAN address): the Cache API is only there on https and localhost, and without a local copy every map
 * downloaded everything again. Copies under other versions are deleted, as is what earlier clients kept in the Cache
 * API. Resolves null where there is none (a private window, say).
 */
function openStore(name) {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  indexedDB.databases?.().then((dbs) => { for (const d of dbs) if (d.name?.startsWith('voyage-assets-') && d.name !== name) indexedDB.deleteDatabase(d.name); }).catch(() => {});
  if (globalThis.caches) caches.keys().then((keys) => { for (const k of keys) if (k.startsWith('voyage-assets-')) caches.delete(k); }).catch(() => {});
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(name, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
    req.onerror = req.onblocked = () => resolve(null);
  });
}

/**
 * Downloads asset files in batches: one round trip per BATCH_FILES files instead of one per file. A player's look is
 * about fifty files, and plain HTTP runs six requests at a time, so a crowd arriving one file at a time took tens of
 * seconds over a network with any delay. A batch is made up when a download slot frees, from the most urgent files
 * waiting, so a busy moment sends full batches and what is wanted now goes first.
 * Batched files don't go through the browser's own cache, so they are kept in a local copy (openStore): files asked
 * for together are looked up there in one go, and only those it lacks are downloaded.
 */
class Batcher {
  constructor(assets) {
    this.a = assets;
    this.files = new Map();      // path -> { pri, sent, promise, resolve, reject }
    this.lookups = new Map();    // path -> its file, to be looked up in the local copy
    this.pending = PRI_NAMES.map(() => new Set());   // to download, by priority
    this.active = 0; this.timer = 0;
    this.have = new Set();       // paths the local copy has (or is being given)
    this.writes = []; this.writing = false;   // files waiting to go into the local copy, written in idle time
    this.stored = false;         // there is a local copy
    this.db = fetch(`${assets.base}-version`).then((r) => r.json()).then((v) => openStore(`voyage-assets-${v.v}`)).catch(() => null)
      .then((db) => { this.stored = !!db; return db; });
  }
  url(path) { return `${this.a.base}/${path}`; }
  /** A file's bytes as a Blob, or null when the server has no such file; it rejects on a dropped connection. */
  get(path, pri = 'normal') {
    let f = this.files.get(path);
    if (f) { this.bump(path, pri); return f.promise; }
    f = { pri, sent: false };
    f.promise = new Promise((resolve, reject) => { f.resolve = resolve; f.reject = reject; });
    this.files.set(path, f);
    this.lookups.set(path, f);
    if (this.lookups.size === 1) queueMicrotask(() => this.lookUp());
    return f.promise;
  }
  /** The files asked for since the last look, looked for in the local copy in one go; what it lacks is downloaded. */
  async lookUp() {
    const list = [...this.lookups];
    this.lookups.clear();
    const db = await this.db;
    let store = null;
    try { store = db?.transaction('files', 'readonly').objectStore('files'); } catch { store = null; }
    if (!store) { for (const [p, f] of list) this.queue(p, f); return; }
    for (const [p, f] of list) {
      const req = store.get(p);
      req.onsuccess = () => {
        if (!(req.result instanceof Blob)) { this.queue(p, f); return; }
        this.have.add(p);
        if (this.files.get(p) === f) this.files.delete(p);
        f.resolve(req.result);
      };
      req.onerror = (ev) => { ev.preventDefault(); this.queue(p, f); };
    }
  }
  queue(path, f) {
    if (this.files.get(path) !== f) return;
    this.pending[PRI[f.pri] ?? 2].add(path);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.send(); }, 4);
  }
  /** Asked for again at a higher priority: moved up if it hasn't gone out yet. */
  bump(path, pri) {
    const f = this.files.get(path), to = PRI[pri] ?? 2, from = PRI[f?.pri] ?? 2;
    if (!f || to >= from) return;
    f.pri = pri;
    if (this.pending[from].delete(path)) this.pending[to].add(path);
  }
  /** A batch for each free slot, the most urgent files first; loading ahead leaves AHEAD_FREE slots free. */
  send() {
    while (this.active < MAX_LOADS) {
      const first = this.pending.findIndex((set) => set.size);
      if (first < 0 || (first === PRI.ahead && this.active >= MAX_LOADS - AHEAD_FREE)) return;
      const batch = [];
      for (let i = first; i < this.pending.length && batch.length < BATCH_FILES; i++) {
        for (const p of this.pending[i]) { batch.push(p); if (batch.length === BATCH_FILES) break; }
      }
      for (const p of batch) {
        for (const set of this.pending) set.delete(p);
        const f = this.files.get(p);
        if (f) f.sent = true;
      }
      this.active++;
      this.fetchBatch(batch).finally(() => { this.active--; this.send(); });
    }
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
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 0;
    for (const p of paths) {
      const len = view.getUint32(off), at = off + 4;
      off = at + (len === 0xffffffff ? 0 : len);
      // each file is handed on in a slice of its own (what is waiting on it runs then too); one loaded ahead no later
      // than a map's own files, as something may be waiting on it by now
      const pri = this.files.get(p)?.pri;
      this.a.slicer.add(() => {
        const f = this.files.get(p);
        if (len === 0xffffffff) { if (f) { this.files.delete(p); f.resolve(null); } return; }
        const blob = new Blob([buf.subarray(at, at + len)], { type: p.endsWith('.json') ? 'application/json' : 'image/png' });
        if (f) { this.files.delete(p); f.resolve(blob); }
        if (this.stored) { this.have.add(p); this.write(p, blob); }
      }, pri === 'ahead' ? 'normal' : pri);
    }
  }
  /** Into the local copy when the browser is idle, in one transaction a go. */
  write(path, blob) {
    this.writes.push([path, blob]);
    if (this.writing) return;
    this.writing = true;
    const idle = globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 50));
    const drain = async () => {
      const db = await this.db;
      try {
        const tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files');
        for (const [p, b] of this.writes.splice(0, 200)) store.put(b, p);
        await new Promise((r) => { tx.oncomplete = tx.onerror = tx.onabort = r; });
      } catch { this.writes.length = 0; }   // no room, or the copy went away: those are downloaded again when wanted
      if (this.writes.length) idle(drain); else this.writing = false;
    };
    idle(drain);
  }
}

export class Assets {
  constructor(base = '/assets') {
    this.base = base;
    this.jsonCache = new Map();
    this.imgCache = new Map();
    this.loaded = 0; this.loadedPx = 0;   // images loaded so far and their pixels (the /fps report)
    this.slicer = new Slicer();
    this.files = new Batcher(this);
  }

  /** A data file (pri: see PRI); one still waiting is moved up when it is asked for at a higher priority. */
  json(path, pri = 'normal') {
    let p = this.jsonCache.get(path);
    if (!p) {
      const wz = path.split('/')[0];
      p = this.files.get(`${path}.json`, pri)
        .then((blob) => (blob ? blob.text() : null))
        // parsed in a slice of its own (one loaded ahead no later than a map's own: something may be waiting on it by
        // now); a file without links (no "_uol") needs no link passes
        .then((text) => (text ? this.slicer.add(() => prepare(JSON.parse(text), wz, text.includes('"_uol"')), pri === 'ahead' ? 'normal' : pri) : null))
        .catch(() => { this.jsonCache.delete(path); return null; });   // a dropped connection: asked again next time
      this.jsonCache.set(path, p);
    } else this.files.bump(`${path}.json`, pri);
    return p;
  }

  /** pri (see PRI): one already waiting is moved up when it is asked for at a higher priority. */
  /**
   * A canvas's entry: its bytes (e.bytes, a Blob or null) come in a batch (Batcher); it is decoded (decoded(e)) when it
   * is first wanted. One that failed to load (a dropped connection) is tried again 5s later, three tries in all.
   */
  _entry(node, pri = 'normal') {
    let e = this.imgCache.get(node._canvas);
    const retry = e?.err && e.tries < 3 && performance.now() - e.failedAt > 5000;
    if (!e || retry) {
      const tries = e?.tries || 0;
      e = { img: null, ready: false, tries, pri, promise: null };
      e.bytes = this.files.get(node._canvas, pri).then((blob) => { if (!blob) this.failed(e, tries); return blob; }, () => { this.failed(e, tries); return null; });
      this.imgCache.set(node._canvas, e);
    } else if (!e.ready && !e.err && (PRI[pri] ?? 2) < (PRI[e.pri] ?? 2)) { e.pri = pri; this.files.bump(node._canvas, pri); }
    return e;
  }
  failed(e, tries) { e.err = true; e.tries = tries + 1; e.failedAt = performance.now(); }
  /**
   * The entry's image, decoded off the main thread (an ImageBitmap: no image element, no blob URL, both of which cost
   * the main thread a round trip to the browser per image); resolves null when it couldn't be had. Loaded ahead, an
   * image keeps only its compressed bytes until it is first wanted.
   */
  decoded(e) {
    e.promise ??= e.bytes
      .then((blob) => (blob ? createImageBitmap(blob) : null))
      .then((bmp) => {
        if (!bmp) return null;
        e.img = bmp; e.ready = true; e.bytes = NO_BYTES; e.used = performance.now();
        this.loaded++; this.loadedPx += bmp.width * bmp.height;
        return bmp;
      }, () => { this.failed(e, e.tries); return null; });
    return e.promise;
  }

  /** Returns the loaded image, or null while it is still loading (it starts loading, and decoding, on first call). */
  image(node) {
    if (!isCanvas(node)) return null;
    const e = this._entry(node, 'urgent');
    if (e.ready) { e.used = performance.now(); return e.img; }
    if (!e.err) this.decoded(e);
    return null;
  }

  /**
   * Lets go of decoded images not drawn in the last `ms` (on moving to another map): an ImageBitmap holds its pixels
   * for as long as it is kept, and a long session's worth ran to hundreds of MB. One wanted again is read back from the
   * local copy, so without one nothing is let go.
   */
  release(ms = 60000) {
    if (!this.files.stored) return;
    const before = performance.now() - ms;
    for (const [k, e] of this.imgCache) if (e.ready && !(e.used > before)) this.imgCache.delete(k);
  }

  /**
   * Loads canvases ahead of time (see preload.js): a few at a time, behind whatever is asked for to draw now, priority
   * 0 before 1 before 2; ones already loaded or loading are left out. Held while holdQueue() says so (a map loading).
   */
  enqueue(nodes, pri = 1) {
    const q = (this.queues ??= [[], [], []].map((list) => ({ list, head: 0 })))[pri];
    const queued = (this.queued ??= new Set());   // each canvas waits once, however many ask for it
    const have = this.files.have;
    for (const n of nodes) if (isCanvas(n) && !this.imgCache.has(n._canvas) && !have.has(n._canvas) && !queued.has(n._canvas)) { q.list.push(n); queued.add(n._canvas); }
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
      if (this.imgCache.has(n._canvas) || this.files.have.has(n._canvas)) continue;
      this.inFlight++;
      const done = () => { this.inFlight--; this.pump(); };
      // into the local copy only, where there is one (drawn, it is read back from there and decoded); without one its
      // bytes are kept until it is first drawn
      if (this.files.stored) this.files.get(n._canvas, 'ahead').then(done, done);
      else this._entry(n, 'ahead').bytes.then(done);
    }
  }

  preload(nodes, onProgress, pri = 'normal') {
    const list = nodes.filter(isCanvas);
    let done = 0;
    return Promise.all(list.map((n) => this.decoded(this._entry(n, pri)).then(() => onProgress?.(++done, list.length))));
  }
}

function prepare(tree, wz, links = true) {
  const seen = new Set();
  (function prefix(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    // the files' own child order (kept by the extractor) stays readable but out of every key listing
    if (Array.isArray(node._order)) Object.defineProperty(node, '_order', { value: node._order, enumerable: false, configurable: true, writable: true });
    if (typeof node._canvas === 'string') node._canvas = `${wz}/${node._canvas}`;
    for (const k in node) prefix(node[k]);
  })(tree);

  // Resolve UOLs relative to the node that contains them. Repeat for chained links. (One chain of the nodes above,
  // pushed and popped as the walk goes, rather than a copy at every node.)
  for (let pass = 0; links && pass < 4; pass++) {
    let unresolved = 0;
    const visited = new Set(), chain = [];
    (function walk(node) {
      if (!node || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);
      chain.push(node);
      for (const k in node) {
        const v = node[k];
        if (v && typeof v === 'object' && typeof v._uol === 'string') {
          const target = resolveUol(chain, v._uol);
          if (target && !(typeof target._uol === 'string')) node[k] = target;
          else unresolved++;
        } else walk(v);
      }
      chain.pop();
    })(tree);
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
