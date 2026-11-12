import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData, threadId } from 'worker_threads';
import { decodePng, encodePng } from './png.mjs';

/**
 * Character sheets. A character file (a coat, a hair, a body) is a few to a few hundred small images, one for each
 * piece of each frame of each pose, and a crowd arriving asks for many thousands of them. Here each file's pieces are
 * packed into a few bigger images, its sheets, made from the assets when the server starts and kept in the cache
 * folder (the assets themselves are never written to, and nothing made from them is part of the client):
 *
 *   <file>/1.png   what anyone needs to stand, walk, jump, climb, sit and blink: asked for when they arrive
 *   <file>/2.png   every other pose and expression: asked for the first time one is needed
 *
 * A file with numbered groups of its own (a cash weapon's art for each kind of weapon, a saddle's for each mount)
 * gets the two for each group (30.1.png, 30.2.png...). Icons (info) are left as they are.
 *
 * Next to the sheets goes a copy of the file's tree (gzipped: it is mostly the same names over and over) in which
 * every packed image says where it is:
 *   "_at": ["<sheet>.<version>", x, y, w, h]
 * The client asks for that tree (/assets/_sheets/<file>.json) and for the sheets it names
 * (/assets/_sheets/<file>/<sheet>.<version>.png). The version is the file's size and date, so a sheet's address
 * never means anything else and browsers may keep it for good.
 */

/** Raise when the packing changes: every sheet is made again. */
const PACKING = 1;
/** Poses (and a face's or hair's own entries) that go in a file's first sheet. */
const FIRST = new Set(['stand1', 'stand2', 'walk1', 'walk2', 'jump', 'ladder', 'rope', 'sit', 'dead',
  'default', 'backDefault', 'blink', 'front', 'back']);
/** Character folders the avatar isn't put together from: left as they are. */
const LEFT_OUT = new Set(['Afterimage', 'Dragon', 'PetEquip']);
const FILE = /^Character\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.img$/;
const SHEET = /^(?:\d+\.)?[12]$/, VERSION = /^[0-9a-f]{10}$/;
const TREE = 'tree.json.gz';

const version = (st) => crypto.createHash('sha1').update(`${PACKING}|${st.size}|${Math.floor(st.mtimeMs)}`).digest('hex').slice(0, 10);
const usable = (rel) => FILE.test(rel) && !rel.split('/').some((s) => s === '.' || s === '..') && !LEFT_OUT.has(rel.split('/')[1]);

/** The sheet an image goes in, from its place in the file (the keys leading to it); null for one left as it is. */
function sheetFor(keys) {
  const group = /^\d+$/.test(keys[0]) && keys.length > 2 ? keys[0] : null, pose = group ? keys[1] : keys[0];
  if (pose === 'info' || keys[0] === 'info') return null;
  const tier = FIRST.has(pose) ? 1 : 2;
  return group ? `${group}.${tier}` : String(tier);
}

/**
 * Places images in rows, tallest first, each with a border of one pixel all round (its own edge repeated, so an
 * image drawn scaled is as soft at its edges as it is alone, with nothing of its neighbours). Sets each one's x, y.
 */
function pack(images) {
  const cells = images.slice().sort((a, b) => b.h - a.h || b.w - a.w);
  let area = 0, widest = 0;
  for (const c of cells) { area += (c.w + 2) * (c.h + 2); widest = Math.max(widest, c.w + 2); }
  let best = null;
  for (const k of [0.75, 1, 1.35]) {   // a few widths tried: the smallest sheet wins
    const limit = Math.max(widest, Math.ceil(Math.sqrt(area) * k)), at = [];
    let x = 0, y = 0, row = 0, w = 0;
    for (const c of cells) {
      if (x + c.w + 2 > limit) { x = 0; y += row; row = 0; }
      at.push(x + 1, y + 1);
      x += c.w + 2; row = Math.max(row, c.h + 2); w = Math.max(w, x);
    }
    if (!best || w * (y + row) < best.w * best.h) best = { w, h: y + row, at };
  }
  cells.forEach((c, i) => { c.x = best.at[i * 2]; c.y = best.at[i * 2 + 1]; });
  return best;
}

function blit(sheet, sheetW, img) {
  const { w, h, data, x, y } = img, row = w * 4;
  for (let r = -1; r <= h; r++) {
    const src = Math.min(h - 1, Math.max(0, r)) * row, dst = ((y + r) * sheetW + x) * 4;
    data.copy(sheet, dst, src, src + row);
    data.copy(sheet, dst - 4, src, src + 4);
    data.copy(sheet, dst + row, src + row - 4, src + row);
  }
}

/**
 * Makes a file's sheets and its tree in the cache folder, unless they are there. Returns its version and whether it
 * has sheets (a ring has nothing to pack).
 */
export function makeSheets(assetsDir, cacheDir, rel) {
  const source = path.join(assetsDir, `${rel}.json`), ver = version(fs.statSync(source));
  const home = path.join(cacheDir, rel), dir = path.join(home, ver);
  if (fs.existsSync(path.join(dir, TREE))) return { ver, packed: true, made: false };
  if (fs.existsSync(path.join(dir, 'none'))) return { ver, packed: false, made: false };
  const tree = JSON.parse(fs.readFileSync(source, 'utf8')), sheets = new Map();
  (function walk(node, keys) {
    if (!node || typeof node !== 'object') return;
    if (typeof node._canvas === 'string') {
      const name = sheetFor(keys);
      if (name) { if (!sheets.has(name)) sheets.set(name, []); sheets.get(name).push(node); }
    }
    for (const k in node) if (k[0] !== '_') walk(node[k], [...keys, k]);
  })(tree, []);
  const tmp = `${dir}.${process.pid}.${threadId}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  let packed = false;
  for (const [name, nodes] of sheets) {
    const images = [];
    for (const node of nodes) {
      // (one that can't be read is left as its own image)
      try { images.push({ node, ...decodePng(fs.readFileSync(path.join(assetsDir, rel.split('/')[0], node._canvas))) }); } catch { /* left */ }
    }
    if (images.length < 2) continue;   // nothing gained by a sheet of one
    const { w, h } = pack(images), sheet = Buffer.alloc(w * h * 4);
    for (const img of images) blit(sheet, w, img);
    fs.writeFileSync(path.join(tmp, `${name}.png`), encodePng(w, h, sheet));
    for (const img of images) img.node._at = [`${name}.${ver}`, img.x, img.y, img.w, img.h];
    packed = true;
  }
  fs.writeFileSync(path.join(tmp, packed ? TREE : 'none'), packed ? zlib.gzipSync(JSON.stringify(tree), { level: 6 }) : '');
  try { fs.renameSync(tmp, dir); } catch { fs.rmSync(tmp, { recursive: true, force: true }); }   // (made by another meanwhile)
  // sheets of the file as it was before
  for (const old of fs.readdirSync(home)) if (old !== ver && VERSION.test(old)) fs.rmSync(path.join(home, old), { recursive: true, force: true });
  return { ver, packed, made: true };
}

/**
 * The sheets as server.js uses them. Sheets are made on other threads, so the relay never waits on one; one that is
 * asked for goes ahead of the rest of the start-up run.
 */
export class SheetStore {
  /** A store, or null (with the reason logged) when the cache folder can't be written to. */
  static open(assetsDir, cacheDir, log = console.log) {
    try {
      makeDir(cacheDir);
      fs.accessSync(cacheDir, fs.constants.W_OK);
    } catch (e) {
      log(`Character sheets are off: can't write to ${cacheDir} (${e.code || e.message}). Characters load image by image.`);
      return null;
    }
    return new SheetStore(assetsDir, cacheDir);
  }

  constructor(assetsDir, cacheDir) {
    this.assetsDir = assetsDir; this.cacheDir = cacheDir;
    this.known = new Map();     // file -> { ver, packed }, as last looked at
    this.asked = new Map();     // file -> the look in progress
    this.urgent = []; this.later = [];
    this.workers = []; this.idle = [];
    this.size = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
    this.made = 0;
  }

  /** The file's tree with its images' places (gzipped), or null: it has no sheets, or isn't a character file. */
  async tree(rel) {
    const s = await this.look(rel, true);
    return s?.packed ? path.join(this.cacheDir, rel, s.ver, TREE) : null;
  }

  /** A sheet's file, or null: not one of this file's as it is now. */
  async sheet(rel, name, ver) {
    if (!SHEET.test(name) || !VERSION.test(ver)) return null;
    const s = await this.look(rel, true);
    if (!s?.packed || s.ver !== ver) return null;
    const file = path.join(this.cacheDir, rel, ver, `${name}.png`);
    return (await exists(file)) ? file : null;
  }

  /** Where a file stands, making its sheets if they aren't there (ahead of the start-up run when `urgent`). */
  look(rel, urgent) {
    if (!usable(rel)) return Promise.resolve(null);
    let p = this.asked.get(rel);
    if (!p) {
      p = this.find(rel, urgent).finally(() => this.asked.delete(rel));
      this.asked.set(rel, p);
    }
    return p;
  }

  async find(rel, urgent) {
    const st = await fs.promises.stat(path.join(this.assetsDir, `${rel}.json`)).catch(() => null);
    if (!st?.isFile()) return null;
    const ver = version(st), known = this.known.get(rel);
    if (known?.ver === ver) return known;
    const dir = path.join(this.cacheDir, rel, ver);
    let state = (await exists(path.join(dir, TREE))) ? { ver, packed: true } : (await exists(path.join(dir, 'none'))) ? { ver, packed: false } : null;
    if (!state) {
      // (one that can't be made is left as it is, and not tried again until the file changes)
      const made = await this.run(rel, urgent).catch((e) => { console.log(`Character sheets: ${rel} left as it is (${e.message})`); return null; });
      if (made?.made) this.made++;
      state = { ver, packed: !!made?.packed };
    }
    this.known.set(rel, state);
    return state;
  }

  run(rel, urgent) {
    return new Promise((resolve, reject) => {
      (urgent ? this.urgent : this.later).push({ rel, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.urgent.length || this.later.length) {
      let w = this.idle.pop();
      if (!w && this.workers.length < this.size) w = this.hire();
      if (!w) return;
      const job = this.urgent.shift() || this.later.shift();
      w.job = job;
      w.postMessage(job.rel);
    }
  }

  hire() {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { assetsDir: this.assetsDir, cacheDir: this.cacheDir } });
    const done = (fn) => { const job = w.job; w.job = null; if (job) fn(job); };
    w.on('message', (m) => { done((job) => (m.error ? job.reject(new Error(m.error)) : job.resolve(m))); this.idle.push(w); this.pump(); });
    w.on('error', (e) => { done((job) => job.reject(e)); this.retire(w); this.pump(); });
    w.on('exit', () => { done((job) => job.reject(new Error('the sheet maker stopped'))); this.retire(w); });
    w.unref();
    this.workers.push(w);
    return w;
  }

  retire(w) {
    this.workers = this.workers.filter((x) => x !== w);
    this.idle = this.idle.filter((x) => x !== w);
  }

  /**
   * The start-up run: every character file's sheets, made now if they aren't there (the first start with these
   * assets, or after the assets changed). Resolves with how many files there are and how many were made.
   */
  async makeAll(log = console.log) {
    const t0 = Date.now(), files = [];
    const walk = async (dir, rel) => {
      for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) { if (!e.name.endsWith('.img')) await walk(path.join(dir, e.name), `${rel}/${e.name}`); }
        else if (e.name.endsWith('.img.json') && usable(`${rel}/${e.name.slice(0, -5)}`)) files.push(`${rel}/${e.name.slice(0, -5)}`);
      }
    };
    await walk(path.join(this.assetsDir, 'Character'), 'Character');
    const before = this.made;
    let next = 0, said = Date.now();
    const one = async () => {
      while (next < files.length) {
        await this.look(files[next++], false);
        if (Date.now() - said > 10000 && this.made > before) { said = Date.now(); log(`Character sheets: ${next} of ${files.length} files...`); }
      }
    };
    await Promise.all(Array.from({ length: this.size * 2 }, one));
    const made = this.made - before;
    log(made ? `Character sheets ready: ${files.length} files, ${made} made in ${((Date.now() - t0) / 1000).toFixed(1)}s (kept in ${this.cacheDir}).`
      : `Character sheets ready: ${files.length} files.`);
    // the run is over: two makers stay for what is asked for later (a file added or changed while the server is up)
    this.size = Math.min(this.size, 2);
    while (this.workers.length > this.size && this.idle.length) { const w = this.idle.pop(); this.retire(w); w.terminate(); }
    return { files: files.length, made };
  }
}

const exists = (file) => fs.promises.access(file).then(() => true, () => false);

/** A folder and those above it, made one by one (fs.mkdirSync's own `recursive` can go round for ever on a path that can never be made). */
function makeDir(dir) {
  if (fs.existsSync(dir)) return;
  const up = path.dirname(dir);
  if (up !== dir) makeDir(up);
  fs.mkdirSync(dir);
}

if (!isMainThread && workerData?.cacheDir) {
  parentPort.on('message', (rel) => {
    try { parentPort.postMessage(makeSheets(workerData.assetsDir, workerData.cacheDir, rel)); } catch (e) { parentPort.postMessage({ error: e.message || String(e) }); }
  });
}
