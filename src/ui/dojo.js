/**
 * The Mu Lung Dojo window (UI/UIWindow.img/muruengRaid), shown on a Dojo floor (fieldType 14). Your HP bar
 * on the left, the clock in the middle, the stage boss's HP bar on the right, and the energy tube on the left
 * edge, which turns into the lit tube with the Ctrl + Alt key guide once the energy is full (10000).
 */
import { Anim } from '../map.js';
import { sfx } from '../audio.js';
import { UI_W } from '../view.js';

/** A bar is 305px at full; yours ends at x 318, the boss's starts at x 482. */
const BAR_W = 305, PLAYER_BAR_END = 318, BOSS_BAR_X = 482, BAR_Y = 32;
/** The energy tube's cover: 77px over the empty part, from y 86 down. */
const TUBE_H = 77, TUBE_X = 17, TUBE_Y = 86, FULL = 10000;
/** The clock's digits: a 112x28 strip at (345, 16); minutes, a colon at (51, 4), seconds from x 68. */
const CLOCK_X = 345, CLOCK_Y = 16;
/** Monsters that never count as the stage boss: the "???" placeholder and the transparent check item. */
const NOT_BOSSES = new Set([9999999, 9300216]);

export class DojoWindow {
  constructor(game) {
    this.game = game;
    this.art = null;
    this.full = null;
    /** When the clock runs out (performance.now()), and the seconds last drawn. */
    this.clockEnd = 0;
    this.secs = null;
  }

  /** On a Dojo floor. */
  active() { return Number(this.game.map?.info?.fieldType) === 14; }

  async load() {
    if (this.art || this.loading) return;
    this.loading = true;
    const W = await this.game.assets.json('UI/UIWindow.img');
    const R = W?.muruengRaid;
    if (!R) { this.loading = false; return; }
    this.full = new Anim(R.energy.full);
    const nodes = [R.player[0], R.monster[0], R.clock[0], R.energy.empty[0], R.energy.empty.Gage[0], R.player.Gage[0],
      R.monster.Gage[0], R.number.bar, ...Array.from({ length: 10 }, (_, i) => R.number[i]), ...this.full.frames];
    await this.game.assets.preload(nodes);
    this.art = R;
  }

  mapChanged() { this.clockEnd = 0; this.secs = null; }

  /** CLOCK (type 2) on a Dojo floor: the seconds left. */
  clock(secs) {
    this.clockEnd = performance.now() + secs * 1000;
    this.secs = secs;
  }

  update(dt) {
    if (!this.active()) return;
    this.load();
    if ((this.game.dojoEnergy || 0) >= FULL) this.full?.update(dt * 1000);
    // time over: the clock stops at 0:00 with dojang/timeOver on screen and its sound
    if (this.clockEnd) {
      const left = Math.trunc((this.clockEnd - performance.now()) / 1000);
      if (left < 1) {
        this.clockEnd = 0;
        this.secs = 0;
        this.game.vfx.screen('dojang/timeOver');
        sfx.play('Field/Dojang/timeOver');
      } else this.secs = left;
    }
  }

  /** The stage boss: the first boss monster on the map. */
  boss() {
    for (const e of this.game.map?.life || []) {
      if (e.kind !== 'Mob' || !e.alive || NOT_BOSSES.has(Number(e.spawn?.id))) continue;
      if (Number(e.src?.info?.boss)) return e;
    }
    return null;
  }

  draw(ctx) {
    const R = this.art;
    if (!R || !this.active()) return;
    const g = this.game, im = (n) => g.assets.image(n);
    const put = (node, x, y) => {
      const i = node && im(node);
      if (!i) return;
      const o = node.origin || [0, 0];
      ctx.drawImage(i, x - o[0], y - o[1]);
    };
    const bar = (node, x, w) => {
      const i = node && im(node);
      if (i && w > 0) ctx.drawImage(i, x, BAR_Y - (node.origin?.[1] || 0), w, i.height);
    };
    const energy = g.dojoEnergy || 0;
    // laid out for 800 wide: centred on a wider screen
    ctx.save(); ctx.translate((UI_W - 800) >> 1, 0);
    try { this.drawHud(ctx, R, put, bar, im, energy); } finally { ctx.restore(); }
  }
  drawHud(ctx, R, put, bar, im, energy) {
    const g = this.game;
    put(R.player[0], 169, 50);
    put(R.clock[0], 400, 26);
    put(R.monster[0], 631, 50);
    if (energy < FULL) put(R.energy.empty[0], 20, 130);
    else put(this.full?.node, 9, 80);
    // your HP, ending at x 318
    const hp = Math.max(0, g.stats?.hp || 0), max = g.maxHpShown?.() || g.stats?.maxHp || 0;
    if (max > 0) { const w = Math.trunc((Math.min(hp, max) * BAR_W) / max); bar(R.player.Gage[0], PLAYER_BAR_END - w, w); }
    // the boss's HP, from x 482, while it is there
    const boss = this.boss();
    if (boss) bar(R.monster.Gage[0], BOSS_BAR_X, Math.trunc((Math.min(100, boss.hpPct ?? 100) * BAR_W) / 100));
    // the energy tube's cover over what isn't filled yet
    if (energy < FULL) {
      const cover = R.energy.empty.Gage[0], i = im(cover), h = TUBE_H - Math.trunc((energy * TUBE_H) / FULL);
      if (i && h > 0) ctx.drawImage(i, TUBE_X - (cover.origin?.[0] || 0), TUBE_Y, i.width, h);
    }
    // the clock's digits once a time has come
    if (this.secs !== null) {
      const digit = (x, n) => { const i = im(R.number[n]); if (i) ctx.drawImage(i, CLOCK_X + x, CLOCK_Y); };
      const two = (x, n) => { digit(x, Math.trunc(n / 10) % 10); digit(x + 23, n % 10); };
      two(0, Math.trunc(this.secs / 60));
      const colon = im(R.number.bar);
      if (colon) ctx.drawImage(colon, CLOCK_X + 51, CLOCK_Y + 4);
      two(68, this.secs % 60);
    }
  }
}
