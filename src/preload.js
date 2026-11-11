import { pad, isCanvas } from './assets.js';
import { lookCanvases, weaponPoses } from './character.js';
import { jobBooks, bookFile } from './skills.js';

/**
 * Loading ahead of time (a Voyage addition: the original client reads its files from disk as it needs them).
 * - After logging in: every body and head (each skin, every pose), then every face and every hair, in the background.
 * - A character who comes within about a screen of you (and again after a change of clothes): everything their look
 *   draws moving about and attacking with their weapon, and their hair; then every skill effect of their job line and
 *   the poses those skills use (see Game.preloadNear).
 * It all goes through the assets' queue (Assets.enqueue): a few files at a time, behind whatever is needed to draw
 * now, characters first, and held while a map loads.
 */

/** The poses anyone uses moving about. */
const MOVES = ['stand1', 'stand2', 'walk1', 'walk2', 'jump', 'alert', 'prone', 'proneStab', 'ladder', 'rope', 'sit', 'fly', 'dead', 'swim'];
/** What in a skill isn't its art: its icons and numbers. */
const NOT_ART = new Set(['icon', 'iconMouseOver', 'iconDisabled', 'level', 'req', 'common', 'info', 'action']);
/** Faces and hair wait while this many files are still queued behind them. */
const AHEAD = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every canvas under a node, once each. */
function canvases(node, out = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (isCanvas(node)) { out.push(node); return out; }
  for (const k in node) if (!k.startsWith('_')) canvases(node[k], out, seen);
  return out;
}

export class Preloader {
  constructor(game) {
    this.g = game; this.a = game.assets;
    this.jobs = new Set();      // jobs whose skill effects are queued
    this.started = false;
    this.a.holdQueue = () => !!game.loading;   // a map loading goes first
  }

  /** A character near you: their look moving about and attacking, their hair, their job's skills. */
  player(look, job) {
    if (!look?.body) return;
    this.poses(look, [...new Set([...MOVES, ...weaponPoses(look)])], 0);
    this.a.slicer.add(() => this.a.enqueue(canvases(look.hair), 0));
    this.job(job, look);
  }

  /**
   * What a look draws in these poses, queued to load at this priority (Assets.enqueue). Working it out is a few frames
   * of every part of every pose, so it goes a pose to a slice (Assets.slicer) rather than holding up a frame.
   */
  poses(look, list, pri) {
    for (const p of list) if (look.has(p)) this.a.slicer.add(() => this.a.enqueue(lookCanvases(look, [p]), pri));
  }

  /** Every skill effect of a job line (once per job), and the poses its skills use in this look. */
  async job(job, look) {
    if (job === undefined || job === null || !Number.isFinite(Number(job))) return;
    const first = !this.jobs.has(job);   // marked before the files load: several of one job arriving queue its art once
    this.jobs.add(job);
    const trees = await Promise.all(jobBooks(Number(job)).map((b) => this.a.json(bookFile(b))));
    const poses = new Set();
    for (const t of trees) {
      for (const s of Object.values(t?.skill || {})) {
        for (const p of Object.values(s?.action || {})) if (typeof p === 'string') poses.add(p);
        // each skill's art is gathered in a slice of its own
        if (first) this.a.slicer.add(() => { const art = []; for (const [k, v] of Object.entries(s || {})) if (!NOT_ART.has(k)) canvases(v, art); this.a.enqueue(art, 1); });
      }
    }
    if (look?.body) this.poses(look, [...poses], 1);
  }

  /** Once, after logging in: every body and head, then every face and hair, without getting in the way. */
  async everyone() {
    if (this.started) return;
    this.started = true;
    const index = await fetch('/character-index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!index) return;
    const load = async (path, pri, keep = true) => {
      while (this.a.waiting(pri) > AHEAD || this.g.loading) await sleep(200);
      const tree = await this.a.json(path);
      this.a.enqueue(canvases(tree), pri);
      // two thousand faces and hairs are a lot to hold (and to sweep in every garbage collection): only their images
      // stay; the data comes back from the local cache when someone wears it
      if (!keep) this.a.jsonCache.delete(path);
    };
    for (const id of [...(index.body || []), ...(index.head || [])]) await load(`Character/${pad(id, 8)}.img`, 1);
    for (const id of index.face || []) await load(`Character/Face/${pad(id, 8)}.img`, 2, false);
    for (const id of index.hair || []) await load(`Character/Hair/${pad(id, 8)}.img`, 2, false);
  }
}
