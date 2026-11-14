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
/**
 * Buffs and moves that look like attacks in their data: the White Knight / Paladin / Dawn Warrior charges, Soul
 * Arrow, Power Crash and Magic Crash, Ninja Ambush (they weaken monsters; the server finds them).
 */
const NOT_ATTACKS = new Set([1211003, 1211004, 1211005, 1211006, 1211007, 1211008, 1221003, 1221004, 11111007, 3101004, 3201004,
  13101003, 1311007, 1211009, 4121004, 4221004]);
/**
 * Skills that only ever go off by themselves, so a hotkey does nothing: Endure, the Final Attacks, Advanced Combo,
 * Guardian, Advanced Charge, Berserk, Hex of the Beholder, Critical Shot / Throw, Mortal Blow, Venomous Star / Stab and Vanish.
 */
const PROCS = new Set([1000002, 1100002, 1100003, 1200002, 1200003, 1300002, 1300003, 1120003, 11110005, 1120005, 1220006,
  1220010, 1320006, 1320009, 3000001, 13000000, 3100001, 3200001, 13101002, 3110001, 3210001, 4120005, 4220005, 14110004,
  4100001, 14100001, 4100002, 4200001, 14100005]);
/**
 * Shots whatever their data says: Energy Orb, Invisible Shot, Recoil Shot, Flamethrower, Ice Splitter, Rapid Fire and
 * Hypnotize.
 */
const PIRATE_SHOTS = new Set([5121002, 5201001, 5201006, 5211004, 5211005, 5221004, 5221009]);
/** Passives whose data looks castable: Stun Mastery, Energy Charge, Elemental Boost, Critical Punch. */
const PASSIVES = new Set([5110000, 5110001, 5220001, 15110000]);
/** Close-range attacks whatever their data says: Panic, Disorder, Ninja Storm. */
const MELEE_SKILLS = new Set([1111003, 1111004, 11111002, 4001002, 14001002, 4121008]);
/** Spells that look like buffs in their data: Cold Beam, Paralyze, Poison Mist, Flame Gear. */
const MAGIC_SKILLS = new Set([2201004, 2121006, 2111003, 12111005]);
/** A bowman's attacks are all shots, whatever their data says, except Power Knock-Back's swing. Snipe looks like a buff. */
const isBowman = (id) => Math.floor(id / 1000000) % 10 === 3;
const BOW_SWINGS = new Set([3101003, 3201003]);
const SNIPE = 3221007;
/** Shots that need no ammo: Soul Blade, Shark Wave, Taunt, Shadow Meso, Vampire, Energy Orb. */
export const NO_AMMO_SHOTS = new Set([11101004, 15111007, 4121003, 4221003, 4111004, 14101006, 5121002]);
/**
 * Weapons (category % 100) a skill needs where its data doesn't say: 30/40 swords, 31/41 axes, 32/42 blunt, 43 spear,
 * 44 polearm, 37 wand, 38 staff, 47 claw, 48 knuckle, 49 gun. No weapon is type 0, which none of these take.
 */
const SKILL_WEAPONS = {
  1101004: [30, 40], 1101005: [31, 41], 1201004: [30, 40], 1201005: [32, 42], 1301004: [43], 1301005: [44], 11101001: [30, 40],
  1111003: [30, 40], 1111005: [30, 40], 1111004: [31, 41], 1111006: [31, 41], 11111002: [30, 40], 11111003: [30, 40],
  1121006: [30, 40, 31, 41], 1121008: [30, 40, 31, 41], 11111004: [30, 40], 1221007: [30, 40, 32, 42], 1211002: [30, 40, 32, 42],
  1321003: [43, 44], 1311005: [43, 44], 1311006: [43, 44],
  1211003: [30, 40], 1211005: [30, 40], 1211007: [30, 40], 1221003: [30, 40], 11101002: [30, 40], 11111007: [30, 40],
  1211004: [32, 42], 1211006: [32, 42], 1211008: [32, 42], 1221004: [32, 42], 14101006: [47],
  5101006: [48], 15101002: [48], 5201003: [49], 5201002: [49],
  // the knuckle blows (weapon type 39 counts too, though no item has it); Flash Fist / Straight also with a gun
  5101002: [48, 39], 5101003: [48, 39], 5101004: [48, 39], 5111002: [48, 39], 5111006: [48, 39], 5121001: [48, 39],
  5121002: [48, 39], 5121004: [48, 39], 5121005: [48, 39], 5121007: [48, 39], 15101003: [48, 39], 15101005: [48, 39],
  15111003: [48, 39], 15111004: [48, 39], 5001001: [48, 49, 39], 15001001: [48, 49, 39],
  2111005: [37, 38], 2211005: [37, 38], 12101004: [37, 38], 12101005: [37, 38],
};
const weaponCat = (id) => (id ? Math.floor(id / 10000) % 100 + 100 : 0);

/** Skill books for a job: 112 -> [0, 100, 110, 111, 112], 2112 -> [2000, 2100, 2110, 2111, 2112]; Evans start from 2001. */
export function jobBooks(job) {
  const base = Math.floor(job / 1000) * 1000;
  const books = [base === 2000 && (job >= 2200 || job === 2001) ? 2001 : base];
  if (job % 1000 >= 100) books.push(Math.floor(job / 100) * 100);
  if (job % 100 >= 10) books.push(Math.floor(job / 10) * 10);
  for (let j = Math.floor(job / 10) * 10 + 1; j <= job; j++) books.push(j);
  return [...new Set(books)];
}

export const bookFile = (book) => `Skill/${pad(book, 3)}.img`;

/** Bamboo Rain and Rage of Pharaoh for the Beginner, Noblesse, Legend and Evan. */
const ARENA_ATTACKS = new Set([1009, 10001009, 20001009, 20011009, 1020, 10001020, 20001020, 20011020]);

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
    this.cooldownTotal ??= {};
    for (const [id, sec] of Object.entries(cooldowns || {})) { this.cooldowns[id] = now + sec * 1000; this.cooldownTotal[id] = sec * 1000; }
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
  /** The skill's level count in Skill.wz. */
  wzMax(id) { return Object.keys(this.node(id)?.level || {}).length; }
  /** Skills capped at their master level: 4th job books, and Evan's last two stages. */
  mastered(id) {
    const b = Math.floor(id / 10000);
    if (Math.floor(b / 100) === 22 || b === 2001) return b !== 2001 && b % 100 !== 0 && (b % 10 === 7 || b % 10 === 8);
    return b % 100 !== 0 && b % 10 === 2;
  }
  /** 'req' while a required skill is short of its level, 'max' at the cap, else 'ok'. */
  raiseState(id) {
    const req = this.node(id)?.req;
    if (req && Object.entries(req).some(([r, lv]) => this.level(Number(r)) < lv)) return 'req';
    const lv = this.level(id);
    if (this.mastered(id) && (this.levels[id]?.master || 0) <= lv) return 'max';
    return lv >= this.wzMax(id) ? 'max' : 'ok';
  }
  name(id) { return this.strings?.[pad(id, 7)]?.name || this.strings?.[id]?.name || `Skill ${id}`; }
  desc(id) { return this.strings?.[pad(id, 7)]?.desc || ''; }
  hint(id, lv) { return this.strings?.[pad(id, 7)]?.[this.levelData(id, lv)?.hs || `h${lv}`] || ''; }
  bookName(b) { return this.strings?.[pad(b, 3)]?.bookName || this.strings?.[b]?.bookName || `Book ${b}`; }

  /**
   * Skills shown in a book, in the book's own order: those you have a record of (any level) and the
   * visible ones, less Space Dash and time-limited skills you don't have.
   */
  bookSkills(b) {
    const j = this.books[b];
    if (!j || j instanceof Promise) return [];
    return Object.keys(j.skill || {}).map(Number).filter((id) => {
      const n = j.skill[pad(id, 7)];
      return id !== 1014 && id !== 10001015 && (id in this.levels || !n?.invisible) && (!n?.timeLimited || this.level(id) > 0);
    });
  }

  kind(id, weaponId) {
    const n = this.node(id), ld = n?.level?.[1];
    if (!n || !ld || PROCS.has(id) || PASSIVES.has(id)) return 'passive';
    if (PIRATE_SHOTS.has(id)) return 'ranged';
    if (MELEE_SKILLS.has(id)) return 'melee';
    if (MAGIC_SKILLS.has(id)) return 'magic';
    if (NO_AMMO_SHOTS.has(id) || id === SNIPE) return 'ranged';
    // Three Snails looks like a throw but the game server only processes it as a close-range attack
    if (id % 10000000 === 1000) return 'melee';
    // the Dojo's Bamboo Rain and the Pyramid's Rage of Pharaoh (every beginner job's) are close-range attacks
    if (ARENA_ATTACKS.has(id)) return 'melee';
    // an attack has power (damage, magic, a projectile's x...); one that also lasts a while (a stun, a poison, a
    // freeze) is still an attack when it has targets - only heals, summons and the buffs below are not
    const targets = ld.mobCount || ld.attackCount || ld.bulletCount || n.ball;
    const power = ld.damage || ld.mad || ld.fixdamage || ld.attackCount || ld.bulletCount || (ld.x && n.ball);
    if (power && (targets || !ld.time) && !ld.hp && !n.summon && !NOT_ATTACKS.has(id)) {
      if (ld.mad) return 'magic';
      if (isBowman(id)) return BOW_SWINGS.has(id) ? 'melee' : 'ranged';
      const cat = weaponCat(weaponId);
      if (n.weapon === 47 || ld.bulletCount || (n.ball && RANGED_WEAPONS.has(cat))) return 'ranged';
      return 'melee';
    }
    if (ld.mpCon || ld.hpCon || ld.time || n.action || ld.cooltime) return 'special';
    return 'passive';
  }

  /**
   * Weapon requirement from Skill.wz (`weapon`: weapon category % 100, e.g. 47 claw, 33 dagger). A bowman's attacks
   * without one take a bow or a crossbow.
   */
  weaponOk(id, weaponId) {
    const w = this.node(id)?.weapon, cat = weaponId ? Math.floor(weaponId / 10000) % 100 : 0;
    if (SKILL_WEAPONS[id]) return SKILL_WEAPONS[id].includes(cat);
    if (!w && isBowman(id) && ['ranged', 'melee'].includes(this.kind(id, weaponId))) return cat === 45 || cat === 46;
    return !w || cat === w;
  }

  /** A skill stays unusable from the server's cooldown until the server says it is over, whatever the clock says. */
  cooling(id) { return id in this.cooldowns; }
  /** Milliseconds left on a cooldown by the clock, for its countdown. */
  cooldownLeft(id) { return id in this.cooldowns ? Math.max(0, this.cooldowns[id] - Date.now()) : 0; }

  /** Body action for a skill: Skill.wz `action` (random pick), else null (use the weapon's default). */
  action(id) {
    const acts = frames(this.node(id)?.action);
    if (acts.length) return acts[Math.floor(Math.random() * acts.length)];
    const own = this.levelData(id)?.action;   // Spear / Pole Arm Crusher: a pose per level (burster1, burster2)
    return typeof own === 'string' ? own : null;
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
 * (client-side numbers must stay below calcDmgMax * 1.5 or the game server flags the character).
 */
/**
 * Your critical chance and extra damage (percentage points on top of the skill's own damage%), v83 style:
 * Critical Shot with a bow or crossbow, Critical Throw with a claw (their Cygnus copies), Critical Punch with a knuckle, plus Sharp Eyes
 * from yourself or a party member. A critical hit does (skill damage% + extra)% instead of the skill's damage%.
 */
const CRIT_SKILLS = { 145: [3000001, 13000000], 146: [3000001, 13000000], 147: [4100001, 14100001], 148: [15110000] };
export function critical(game, weaponCat, shot = true) {
  const sb = game.skills;
  let rate = 0, dmg = 0;
  // Critical Shot and Critical Throw only count for a shot (the Explorer's, or a Cygnus job's own); Critical Punch for
  // any knuckle blow. Whoever has a level in it gets it, whatever their job.
  const list = CRIT_SKILLS[weaponCat], cygnus = Math.floor((game.stats?.job || 0) / 1000) === 1;
  const id = (shot || weaponCat === 148) && (list?.[cygnus ? 1 : 0] ?? list?.[0]);   // knuckles: Critical Punch for all
  const ld = id && sb.level(id) && sb.levelData(id);
  if (ld) { rate += ld.prop || 0; dmg += (ld.damage || 100) - 100; }
  const se = game.buffs?.find((b) => b.sharpEyes && b.until > Date.now())?.sharpEyes;
  if (se) { rate += se.rate; dmg += se.dmg; }
  // Combo Critical (Aran) with a combo going: n = combo / 10, at most its x; +(y x n + 10)% chance (0-100), and
  // 100 + damage x n points more
  const combo = game.aranCombo || 0, cc = combo > 0 && sb.level(21110000) && sb.levelData(21110000);
  if (cc) {
    const n = Math.min(Number(cc.x) || 0, Math.floor(combo / 10));
    rate += Math.max(0, Math.min(100, (Number(cc.y) || 0) * n + 10));
    dmg += 100 + (Number(cc.damage) || 0) * n;
  }
  return rate > 0 ? { rate, dmg } : null;
}

export function skillMaxDamage(game, id, lv, kind) {
  const s = game.stats;
  const ld = id ? game.skills.levelData(id, lv) : null;
  if (ld?.fixdamage) return ld.fixdamage;
  if (kind === 'magic') {
    const int = game.totalStat('int'), tm = Math.min(2000, int + game.equipStat('matk'));
    // Heal on the undead: (4.8 x INT + 4 x LUK) x magic / 1000, scaled by its heal %
    if (id === 2301002) {
      const luk = game.totalStat('luk');
      return Math.max(1, Math.floor((((int * 4.8 + luk * 4) * tm) / 1000) * (ld?.hp || 100) / 100));
    }
    const base = ((tm * tm) / 1000 + tm) / 30 + int / 200;
    return Math.max(1, Math.floor(base * (ld?.mad || 1)));
  }
  if ([4001344, 14001004, 4121007, 14111005].includes(id)) { // Lucky Seven / Triple Throw
    return Math.max(1, Math.floor(game.totalStat('luk') * 5 * Math.ceil(game.watk() / 100) * (ld?.damage || 100) / 100));
  }
  // Dragon Roar: STR at 4.0 plus DEX, whatever the spear or polearm
  const base = id === 1311006 ? Math.ceil(((4 * game.totalStat('str') + game.totalStat('dex')) / 100) * game.watk()) : game.maxDamage(game.player?.attack);
  return Math.max(1, Math.floor((base * (ld?.damage || 100)) / 100));
}
