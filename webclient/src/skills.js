import { pad, frames } from './assets.js';

/**
 * Skill.wz access + the player's skill levels.
 *
 * Skill.wz has no explicit "type", so skills are classified from their level data like other clients do:
 *   mad                      -> magic attack (MAGIC_ATTACK)
 *   damage/fixdamage/...     -> melee (CLOSE_RANGE_ATTACK) or ranged (RANGED_ATTACK) by weapon / ball / bulletCount
 *   anything else castable   -> SPECIAL_MOVE (buffs, heals on self, summons...)
 *   no cost and no effect    -> passive
 */

export const RANGED_WEAPONS = new Set([145, 146, 147, 149]); // bow, crossbow, claw, gun
const weaponCat = (id) => (id ? Math.floor(id / 10000) % 100 + 100 : 0);

/** Skill books for a job: 112 -> [0, 100, 110, 111, 112], 2112 -> [2000, 2100, 2110, 2111, 2112]. */
export function jobBooks(job) {
  const base = Math.floor(job / 1000) * 1000;
  const books = [base === 2000 && job >= 2200 ? 2001 : base];
  if (job % 1000 >= 100) books.push(Math.floor(job / 100) * 100);
  if (job % 100 >= 10) books.push(Math.floor(job / 10) * 10);
  for (let j = Math.floor(job / 10) * 10 + 1; j <= job; j++) books.push(j);
  return [...new Set(books)];
}

export const bookFile = (book) => `Skill/${pad(book, 3)}.img`;

export class SkillBook {
  constructor(assets) {
    this.assets = assets;
    this.levels = {};     // id -> { level, master, expiration }
    this.cooldowns = {};  // id -> ms timestamp when ready
    this.books = {};      // book -> Skill json
  }

  async load(job, skills, cooldowns) {
    this.strings = await this.assets.json('String/Skill.img');
    this.setLevels(skills);
    const now = Date.now();
    for (const [id, sec] of Object.entries(cooldowns || {})) this.cooldowns[id] = now + sec * 1000;
    await this.loadJob(job);
  }

  setLevels(skills) {
    for (const [id, s] of Object.entries(skills || {})) this.setLevel(id, s);
  }
  /** A skill you have from outside your job's books (another job's, a GM's) still needs its book to be usable. */
  setLevel(id, s) {
    this.levels[id] = { level: s.level, master: s.master || 0, expiration: s.expiration };
    if (s.level > 0) this.book(Math.floor(id / 10000));
  }

  async loadJob(job) {
    this.job = job;
    this.jobBookIds = jobBooks(job);
    await Promise.all(this.jobBookIds.map((b) => this.book(b)));
  }

  async book(b) {
    if (!(b in this.books)) this.books[b] = this.assets.json(bookFile(b)).then((j) => (this.books[b] = j));
    return this.books[b];
  }

  /** Synchronous lookup once the book is loaded (call ensure() first for foreign skills). */
  node(id) {
    const b = this.books[Math.floor(id / 10000)];
    return b && !(b instanceof Promise) ? b.skill?.[pad(id, 7)] : null;
  }
  async ensure(id) { await this.book(Math.floor(id / 10000)); return this.node(id); }

  level(id) { return this.levels[id]?.level || 0; }
  /** Only your own job's books (and the GM books, which only a GM has levels in) can be used. */
  owns(id) {
    const b = Math.floor(id / 10000);
    return !!this.jobBookIds?.includes(b) || b === 900 || b === 910;
  }
  levelData(id, lv = this.level(id)) { return this.node(id)?.level?.[lv] || null; }
  maxLevel(id) {
    const max = Object.keys(this.node(id)?.level || {}).length; // level keys are "1".."N"
    return this.levels[id]?.master || max;
  }
  name(id) { return this.strings?.[pad(id, 7)]?.name || this.strings?.[id]?.name || `Skill ${id}`; }
  desc(id) { return this.strings?.[pad(id, 7)]?.desc || ''; }
  hint(id, lv) { return this.strings?.[pad(id, 7)]?.[`h${lv}`] || ''; }
  bookName(b) { return this.strings?.[pad(b, 3)]?.bookName || this.strings?.[b]?.bookName || `Book ${b}`; }

  /**
   * Skills shown in a book: everything you have, plus what SP can buy. Beginner books hold many
   * event / mount skills that the client hides unless granted, so only Three Snails, Recovery and
   * Nimble Feet are learnable there; job books hide `invisible` skills.
   */
  bookSkills(b) {
    const j = this.books[b];
    if (!j || j instanceof Promise) return [];
    const beginner = b % 1000 === 0 || b === 2001;
    return Object.keys(j.skill || {}).map(Number).sort((a, c) => a - c).filter((id) => {
      if (this.level(id) > 0) return true;
      const n = j.skill[pad(id, 7)];
      return beginner ? [1000, 1001, 1002].includes(id % 10000) : !n?.invisible;
    });
  }

  kind(id, weaponId) {
    const n = this.node(id), ld = n?.level?.[1];
    if (!n || !ld) return 'passive';
    // Three Snails looks like a throw but Cosmic only processes it as a close-range attack
    if (id % 10000000 === 1000) return 'melee';
    if (ld.mad && !ld.time) return 'magic';
    const attack = ld.damage || ld.fixdamage || ld.attackCount || ld.bulletCount;
    if (attack && !ld.time) {
      const cat = weaponCat(weaponId);
      if (n.weapon === 47 || ld.bulletCount || (n.ball && RANGED_WEAPONS.has(cat))) return 'ranged';
      return 'melee';
    }
    if (ld.mpCon || ld.hpCon || ld.time || n.action || ld.cooltime) return 'special';
    return 'passive';
  }

  /** Weapon requirement from Skill.wz (`weapon`: weapon category % 100, e.g. 47 claw, 33 dagger). */
  weaponOk(id, weaponId) {
    const w = this.node(id)?.weapon;
    return !w || (weaponId && Math.floor(weaponId / 10000) % 100 === w);
  }

  cooling(id) { return Math.max(0, (this.cooldowns[id] || 0) - Date.now()); }

  /** Body action for a skill: Skill.wz `action` (random pick), else null (use the weapon's default). */
  action(id) {
    const acts = frames(this.node(id)?.action);
    return acts.length ? acts[Math.floor(Math.random() * acts.length)] : null;
  }

  /** {lt:[x,y], rb:[x,y]} attack box (facing left) or null. */
  range(id, lv = this.level(id)) {
    const ld = this.levelData(id, lv);
    return ld?.lt && ld?.rb ? { lt: ld.lt, rb: ld.rb } : null;
  }

  icon(id) { return this.node(id)?.icon || null; }
}

/**
 * Max damage per line, mirroring the server checks in AbstractDealDamageHandler.parseDamage
 * (client-side numbers must stay below calcDmgMax * 1.5 or Cosmic flags the character).
 */
/**
 * Your critical chance and extra damage (percentage points on top of the skill's own damage%), v83 style:
 * Critical Shot with a bow or crossbow, Critical Throw with a claw (and their Cygnus copies), plus Sharp Eyes
 * from yourself or a party member. A critical hit does (skill damage% + extra)% instead of the skill's damage%.
 */
const CRIT_SKILLS = { 145: [3000001, 13000000], 146: [3000001, 13000000], 147: [4100001, 14100001] };
export function critical(game, weaponCat) {
  const sb = game.skills;
  let rate = 0, dmg = 0;
  for (const id of CRIT_SKILLS[weaponCat] || []) {
    const ld = sb.owns(id) && sb.levelData(id);
    if (ld) { rate += ld.prop || 0; dmg += (ld.damage || 100) - 100; }
  }
  const se = game.buffs?.find((b) => b.sharpEyes && b.until > Date.now())?.sharpEyes;
  if (se) { rate += se.rate; dmg += se.dmg; }
  return rate > 0 ? { rate, dmg } : null;
}

export function skillMaxDamage(game, id, lv, kind) {
  const s = game.stats;
  const ld = id ? game.skills.levelData(id, lv) : null;
  if (ld?.fixdamage) return ld.fixdamage;
  if (kind === 'magic') {
    const tm = Math.min(2000, s.int + game.equipStat('matk'));
    const base = ((tm * tm) / 1000 + tm) / 30 + s.int / 200;
    return Math.max(1, Math.floor(base * (ld?.mad || 1)));
  }
  if (id === 4001344 || id === 14001004 || id === 4121007) { // Lucky Seven / Triple Throw
    return Math.max(1, Math.floor(s.luk * 5 * Math.ceil(game.watk() / 100) * (ld?.damage || 100) / 100));
  }
  const base = game.maxDamage();
  return Math.max(1, Math.floor((base * (ld?.damage || 100)) / 100));
}
