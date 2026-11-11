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
    const poses = [...new Set([...MOVES, ...weaponPoses(look)])].filter((p) => look.has(p));
    this.a.enqueue([...lookCanvases(look, poses), ...canvases(look.hair)], 0);
    this.job(job, look);
  }

  /** Every skill effect of a job line (once per job), and the poses its skills use in this look. */
  async job(job, look) {
    if (job === undefined || job === null || !Number.isFinite(Number(job))) return;
    const first = !this.jobs.has(job);   // marked before the files load: several of one job arriving queue its art once
    this.jobs.add(job);
    const trees = await Promise.all(jobBooks(Number(job)).map((b) => this.a.json(bookFile(b))));
    const art = [], poses = new Set();
    for (const t of trees) {
      for (const s of Object.values(t?.skill || {})) {
        for (const p of Object.values(s?.action || {})) if (typeof p === 'string') poses.add(p);
        for (const [k, v] of Object.entries(s || {})) if (!NOT_ART.has(k)) canvases(v, art);
      }
    }
    if (first) this.a.enqueue(art, 1);
    if (look?.body) this.a.enqueue(lookCanvases(look, [...poses].filter((p) => look.has(p))), 1);
  }

  /** Once, after logging in: every body and head, then every face and hair, without getting in the way. */
  async everyone() {
    if (this.started) return;
    this.started = true;
    const index = await fetch('/character-index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!index) return;
    const load = async (path, pri) => {
      while (this.a.waiting(pri) > AHEAD || this.g.loading) await sleep(200);
      const tree = await this.a.json(path);
      this.a.enqueue(canvases(tree), pri);
    };
    for (const id of [...(index.body || []), ...(index.head || [])]) await load(`Character/${pad(id, 8)}.img`, 1);
    for (const id of index.face || []) await load(`Character/Face/${pad(id, 8)}.img`, 2);
    for (const id of index.hair || []) await load(`Character/Hair/${pad(id, 8)}.img`, 2);
  }
}
