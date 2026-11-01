import { GameMap, nameTag, Anim } from './map.js';
import { Footholds, PHYS, accelerate, approach } from './physics.js';
import { CharacterLook, drawParts, lookCanvases } from './character.js';
import { weaponMultiplier, itemIcon, mesoIcon, invType, isScroll, scrollFits, ACTIONS } from './data.js';
import { stanceByte, STANCE_NAMES } from './net/proto.js';
import { Hud } from './ui/hud.js';
import { QuestBook } from './quests.js';
import { npcTalk, MessageBox, ShopWin, drawItemTip, DeathNotice } from './ui/dialogs.js';
import { npcQuestMenu } from './ui/quests-ui.js';
import { SkillBook, skillMaxDamage, critical, RANGED_WEAPONS, NO_AMMO_SHOTS } from './skills.js';
import { CODE_TO_SC, defaultKeymap, ACTION, MENU } from './keymap.js';
import { WorldFx, lineDelay } from './effects.js';
import { Reactor, loadReactorImg } from './reactors.js';
import { pad, frames } from './assets.js';
import { music, sfx } from './audio.js';
import { StatusBar } from './ui/statusbar.js';
import { WindowManager } from './ui/windows.js';
import { ChannelWin, GameOptWin, SysOptWin } from './ui/options.js';
import { QuestAlarmWin } from './ui/questalarm.js';
import { MonsterBookWin } from './ui/monsterbook.js';
import { MessengerWin } from './ui/messenger.js';
import { PartySearchWin } from './ui/partysearch.js';
import { FamilyWin, FamilyTreeWin, familyResult } from './ui/family.js';
import { MegaphoneWin } from './ui/megaphone.js';
import { notify } from './ui/notifier.js';
import { TeleportWin } from './ui/teleport.js';
import { DueyWin, dueyResult } from './ui/duey.js';
import { UserListWin, PlayerMenu, CharInfoWin, drawPartyHp, drawGuildTag } from './ui/social.js';
import { TradeWin } from './ui/trade.js';
import { PlayerShopWin } from './ui/playershop.js';
import { uiText } from './ui/wzui.js';
import { ShopBoards } from './shopboards.js';
import { StorageWin } from './ui/storage.js';
import { WorldMapWin } from './ui/worldmap.js';
import { Pet, petLines } from './pets.js';
import { Summon, PUPPET_RANGE } from './summons.js';
import { CashShopWin } from './ui/cashshop.js';
import { ChannelSession } from './net/channel.js';
import { wsTransport } from './net/connection.js';
import { bridgeUrl } from './ui/login-ui.js';
import { settings } from './settings.js';

// Teleport: F/P, I/L, Cleric, Blaze Wizard, Evan
// the camera's vertical slack (px you may rise / sink from its focus), its drift back to you (per second)
// and how long it takes to glide to a new focus height (s)
const CAM_LIFT = 50, CAM_DEADBAND = 28, CAM_DAMPING = 100;   // the original camera filter (see updateCamera)
const PET_LOOT_X = 75;   // how far to either side of a pet it reaches for items
const SHOP_ERRORS = { 1: 'This shop is not open.', 2: 'The shop is full.', 4: 'You cannot do that while dead.', 6: 'You need a Shop Permit to open a shop.',
  10: 'You cannot open a store this close to a portal.', 13: 'You cannot open a store this close to another one.',
  15: 'You cannot open a shop here. Shops open in the Free Market rooms.', 16: 'You cannot open a shop here.',
  17: 'You may not enter this store.', 18: 'The owner is tending to this store. Please try again later.' };
const TELEPORTS = new Set([2101002, 2201002, 2301001, 12101003, 22101001]);
/** Teleport can be used again this long after it lands (ms), and this long after Meteor Shower, Blizzard or Genesis. */
const TELEPORT_DELAY = 600, TELEPORT_AFTER_ULTIMATE = 3000;
/** fieldLimit bit: no movement skills (Teleport, Monster Magnet...) on this map. */
const FIELD_NO_MOVEMENT_SKILLS = 0x2;

const QUEST_ERRORS = { 0x0a: 'You cannot do that quest right now.', 0x0b: 'You do not have enough mesos.', 0x0d: 'Unequip the item first.', 0x0e: 'You do not have the required items.', 0x0f: 'The quest has expired.' };

export const VIEW_W = 800, VIEW_H = 600;
const PRELOAD_ACTIONS = ['stand1', 'stand2', 'walk1', 'walk2', 'jump', 'prone', 'ladder', 'rope', 'alert', 'dead',
  'swingO1', 'swingO2', 'swingO3', 'stabO1', 'swingT1', 'swingT2', 'swingT3', 'stabT1', 'swingP1', 'swingP2', 'stabT2'];
// portal types that fire on touch instead of the Up key
const TOUCH_PORTALS = new Set([3, 9, 12, 13, 14]);

/**
 * Keyboard state by physical key. Arrows are fixed; everything else is resolved through the
 * server keymap (scancode -> {type, action}) by Game.
 */
class Input {
  constructor(canvas) {
    this.down = new Set(); this.pressed = new Set(); this.clicks = [];
    const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const map = (e) => ARROWS[e.code] || (CODE_TO_SC[e.code] ? e.code : null);
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (document.querySelector('.modal-overlay')) return;
      const k = map(e); if (!k || e.code === 'Enter' || e.code === 'Escape') return;
      e.preventDefault();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
    });
    addEventListener('keyup', (e) => {
      const k = map(e); if (!k) return;
      this.down.delete(k);
      // Firefox opens its menu bar on Alt's (or F10's) keyup, so a game key's release is ours too
      if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
    });
    addEventListener('blur', () => this.down.clear());
    // NPCs open on a double-click, as in the client
    canvas.addEventListener('dblclick', (e) => {
      const r = canvas.getBoundingClientRect();
      this.clicks.push({ x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H });
    });
  }
  is(k) { return this.down.has(k); }
  hit(k) { return this.pressed.has(k); }
  endFrame() { this.pressed.clear(); this.clicks.length = 0; }
}

/** Another character on the map (SPAWN_PLAYER / MOVE_PLAYER). */
/**
 * Face expressions: the emotion number indexes this list (1 = hit). An expression loops its Face.img frames
 * for EMOTE_TIME, then the face goes back to default - which blinks now and then, as the client's does.
 */
const EMOTES = ['hit', 'smile', 'troubled', 'cry', 'angry', 'bewildered', 'stunned', 'vomit', 'oops', 'cheers', 'chu',
  'wink', 'pain', 'glitter', 'despair', 'love', 'shine', 'blaze', 'hum', 'bowing', 'hot', 'dam', 'qBlue'];
const EMOTE_TIME = 3, HIT_FACE_TIME = 1.5;   // a hit that does damage shows the hit face for 1.5s (the client's)
function setExpression(ent, n, time = EMOTE_TIME) {
  const name = EMOTES[n - 1];
  if (name) ent.expr = { name, frame: 0, t: 0, left: time };
}
function stepExpression(ent, look, dt) {
  let e = ent.expr;
  if (!e) {
    // idle: blink every few seconds
    if ((ent.blinkT = (ent.blinkT ?? 2 + Math.random() * 4) - dt) > 0) return;
    ent.blinkT = 2 + Math.random() * 4;
    e = ent.expr = { name: 'blink', frame: 0, t: 0, left: Infinity, once: true };
  }
  const node = look?.face?.[e.name];
  if (!node) { ent.expr = null; return; }
  const frames = Object.keys(node).filter((k) => /^\d+$/.test(k)).length;
  e.left -= dt; e.t += dt * 1000;
  const delay = node[e.frame]?.delay || 500;
  if (e.t >= delay && frames > 1) {
    e.t -= delay; e.frame++;
    if (e.frame >= frames) { if (e.once) { ent.expr = null; return; } e.frame = 0; }
  }
  if (e.left <= 0) ent.expr = null;
}

class RemotePlayer {
  constructor(d, look) {
    Object.assign(this, { id: d.id, name: d.name, level: d.level, job: d.job, x: d.x, y: d.y, guild: d.guild, emblem: d.emblem });
    this.look = look; this.facingRight = !(d.stance & 1);
    this.action = look.standAction(); this.frame = 0; this.frameT = 0;
    this.path = null; this.attack = null; this.chat = null;
  }
  applyMovement(moves) {
    const steps = moves.filter((m) => m.x !== undefined || m.stance !== undefined);
    if (steps.length) this.path = { steps, i: 0, t: 0, fromX: this.x, fromY: this.y };
  }
  update(dt) {
    if (this.path) {
      const p = this.path, s = p.steps[p.i];
      const dur = Math.max(1, s.duration || 60) / 1000;
      p.t += dt;
      const k = Math.min(1, p.t / dur);
      if (s.x !== undefined) { this.x = p.fromX + (s.x - p.fromX) * k; this.y = p.fromY + (s.y - p.fromY) * k; }
      if (s.stance !== undefined) {
        this.facingRight = !(s.stance & 1);
        const st = STANCE_NAMES[s.stance >> 1];
        this.state = st;
      }
      if (k >= 1) {
        if (s.x !== undefined) { p.fromX = s.x; p.fromY = s.y; }
        p.t = 0; p.i++;
        if (p.i >= p.steps.length) this.path = null;
      }
    }
    const look = this.look;
    if (this.charge && (this.attack || performance.now() > this.charge.until)) this.charge = null;
    let action = this.attack || this.charge?.pose || {
      walk: look.walkAction(), stand: look.standAction(), jump: 'jump', prone: 'prone', ladder: 'ladder', rope: 'rope',
      alert: 'alert', sit: 'sit', dead: 'dead', fly: 'fly',
    }[this.state] || look.standAction();
    if (!look.has(action)) action = look.standAction();
    if (this.action !== action) { this.action = action; this.frame = 0; this.frameT = 0; this.back = false; }
    const moving = !(action === 'ladder' || action === 'rope') || this.path;
    if (moving) this.frameT += dt * 1000;
    const k = this.attack && action === this.attack ? this.attackScale || 1 : 1;   // their weapon's speed
    while (this.frameT >= look.delay(action, this.frame) * k) {
      this.frameT -= look.delay(action, this.frame) * k;
      const nx = look.nextFrame(action, this.frame, this.back);
      this.frame = nx.frame; this.back = nx.back;
      if (nx.wrapped && this.attack) { this.attack = null; break; }
    }
    if (this.chat && (this.chat.t -= dt) <= 0) this.chat = null;
  }
}

const isPetFood = (id) => Math.floor(id / 10000) === 212;

/** Weapon boosters (Sword/Axe/BW/Spear/Polearm/Bow/Crossbow/Claw/Dagger/Knuckler/Gun, Cygnus and Aran ones). */
const BOOSTERS = new Set([1101004, 1101005, 1201004, 1201005, 1301004, 1301005, 3101002, 3201002, 4101003, 4201002, 5101006, 5201003,
  11101001, 13101001, 14101002, 15101002, 21001003]);
/** Drop motion runs on the client's 8ms physics tick. */
/** Getting hit: the original's ordinary knockback impulse (px/s, both ways) and how long you are then protected (s). */
const KNOCKBACK = 270, HIT_PROTECTION = 1.5;
/**
 * Power Stance (Hero, Paladin, Dark Knight) and Freeze Standing (Aran): a hit that would throw you back doesn't at the
 * buff's % chance (its prop), and the skill's effect plays; not on maps that forbid movement skills.
 */
const STANCES = { 112: 1121002, 122: 1221002, 132: 1321002, 2112: 21121003 };
/**
 * Skills that can only be used standing on the ground: Dragon Roar, Assassinate, Boomerang Step, Rush, Demolition,
 * Shockwave, Backspin Blow, Aerial Strike, Dragon Strike, Snatch, Barrage, Bamboo Thrust, Rage of Pharaoh, Smokescreen and
 * the Aran swings and charges.
 */
const GROUND_ONLY = new Set([1311006, 4221001, 4221007, 4221006, 1121006, 1221007, 1321003, 5121004, 5111006, 15111003, 5101002,
  5221003, 5121001, 5121005, 5121007, 15111004, 1009, 10001009, 20001009, 20011009, 1020, 10001020, 20001020, 20011020,
  21000002, 21100001, 21110007, 21110008, 21120009, 21120010, 21100002, 20000014, 20000015]);
/** Dragon Roar: only with at least half your HP (it costs x% of your max HP). */
const DRAGON_ROAR = 1311006;
/** Monster Magnet (Hero, Paladin, Dark Knight): held up to 1s, the longer the more monsters it can catch. */
const MONSTER_MAGNETS = new Set([1121001, 1221001, 1321001]), CHARGE_HOLD = 1;
/** Big Bang: held up to 1s; its box is centred on you and grows with the charge. */
const BIG_BANGS = new Set([2121001, 2221001, 2321001]);
/** Explosion winds up in its prepare pose before it goes off. */
const EXPLOSION = 2111002;
/** Heal heals the party and strikes the undead in its box. */
const HEAL = 2301002;
/** Attack spells need the ground (or water), except Heal and Explosion. */
const AIR_SPELLS = new Set([HEAL, EXPLOSION]);
/**
 * Spells that strike what is in their box: Thunder Bolt, Heal, Explosion, Ice Strike, Shining Ray, Big Bang, Meteor
 * Shower, Blizzard, Genesis, Fire Demon, Ice Demon, Fire Pillar, Fire Strike, Ninja Ambush and Evan's. Any other spell
 * hits the first monster in a wedge in front of you.
 */
const AREA_SPELLS = new Set([2201005, 2301002, 2111002, 2211002, 2311004, 2121001, 2221001, 2321001, 2121007, 2221007,
  2321008, 2121003, 2221003, 12111003, 12101006, 12111006, 4121004, 4221004, 22101000, 22121000, 22141001, 22151001,
  22161001, 22171002, 22181001, 22181002]);
/** Chain Lightning jumps from its first monster to the nearest new one ahead, 100ms apart. */
const CHAIN_LIGHTNING = 2221006;
/** Flame Gear can't be laid over another Flame Gear. */
const FLAME_GEAR = 12111005;
/** How far in front a bow, crossbow, claw or gun swings rather than shoots. */
const CLOSE_REACH = 65;
/**
 * Shooting skills that never turn into a swing at close range: Arrow Rain, Arrow Eruption, Final Attack, Mortal
 * Blow, Taunt, Energy Orb, Recoil Shot, Flamethrower, Ice Splitter, Battleship Cannon / Torpedo, Soul Blade, Storm
 * Break, Vampire, Spark, Shark Wave and the Aran combos.
 */
const NO_CLOSE_SWING = new Set([3100001, 3110001, 3111004, 3200001, 3210001, 3211004, 4121003, 4221003, 5121002, 5201006,
  5211004, 5211005, 5221007, 5221008, 11101004, 13101002, 13101005, 13111000, 14101006, 15111006, 15111007, 21100004,
  21110004, 21120006]);
/**
 * Shots that fly on through every monster in their way, with how far above and below their line they reach: Iron
 * Arrow, Piercing Arrow, Dragon's Breath, Wind Piercing, Avenger and Taunt.
 */
const PIERCING_SHOTS = new Map([[3201005, 10], [3221001, 20], [3121003, 20], [3221003, 20], [13111006, 10], [4111005, 36],
  [14111002, 36], [4121003, 10], [4221003, 10]]);
/** Taunt reaches 300px, whatever the weapon. */
const TAUNTS = new Set([4121003, 4221003]), TAUNT_RANGE = 300;
/** Arrow Rain and Arrow Eruption: no arrow flies at them, the monsters in the skill's box are struck 400ms after the shot. */
const RAIN_SHOTS = new Set([3111004, 3211004, 13111000]), RAIN_DELAY = 400;
/**
 * Arrow Bomb, Inferno and Blizzard: one arrow to the first monster in the way, then a blast in the skill's box around
 * where it struck catches the others: 50ms later for Arrow Bomb, 120ms and another 30ms each for the others.
 */
const BLAST_SHOTS = new Map([[3101005, () => 50], [3111003, (i) => 90 + i * 30], [3211003, (i) => 90 + i * 30]]);
/**
 * Shots that keep to their box and the nearest monsters in it: Spark, Energy Orb, Shark Wave, Soul Blade,
 * Vampire, Storm Break, the Aran combos and the Outlaw / Corsair area shots.
 */
const BOX_SHOTS = new Set([15111006, 5121002, 15111007, 11101004, 14101006, 13101005, 21100004, 21110004,
  21120006, 5201001, 5211004, 5211005, 5221007, 5221008]);
/**
 * Hurricane fires while its key is held, once 101ms have passed on the game's 30ms clock (so every 120ms); Piercing
 * Arrow charges up to 1s and fires when let go.
 */
const HURRICANES = new Set([3121004, 13111002]), HURRICANE_GAP = 101, TICK = 30, PIERCING_ARROW = 3221001, PIERCE_HOLD = 1000;
const DRAGONS_BREATH = new Set([3121003, 3221003]), POWER_KNOCKBACK = new Set([3101003, 3201003]);
const MORTAL_BLOWS = [3110001, 3210001], SNIPE = 3221007, SOUL_ARROWS = [3101004, 3201004, 13101003];
const AMMO_OUT = { 145: 'You have used up all of your arrows.', 146: 'You have used up all of your arrows.',
  147: 'You have used up all of your throwing-stars.', 149: 'You do not have enough bullets to use this skill.' };
/** Inferno and Blizzard count a weak or strong monster's element at only x% of the usual. */
const PART_ELEMENT = new Set([3111003, 3211003]), BLIZZARD = 3211003;
/** Skills whose damage follows their own rules, kept to the plain roll: Combo Tempest, Bamboo Rain / Thrust and Rage of Pharaoh. */
const OWN_DAMAGE = new Set([21120006, 1009, 10001009, 20001009, 20011009, 1020,
  10001020, 20001020, 20011020]);
/** Blows that go through a monster's defence: Sacrifice, Shadow Meso, Assaulter, Demolition. */
const IGNORE_DEFENCE = new Set([1311005, 4111004, 4211002, 5121004]);
const SHADOW_MESO = 4111004, NINJA_STORM = 4121008;
const LUCKY_SEVENS = new Set([4001344, 4121007, 14001004, 14111005]), BARRAGES = new Set([5121007, 15111004]);
/** Rush and Blast count as a swing three times in five; Brandish's second blow is a swing. */
const RUSHES = new Set([1121006, 1221007, 1321003, 1221009]), BRANDISHES = new Set([1121008, 11111004]);
/** Panic and Coma spend the Combo orbs, and their bonus per orb climbs faster. */
const FINISHERS = new Set([1111003, 1111004, 1111005, 1111006, 11111002, 11111003]);
/**
 * Combo Attack's orbs: orb n sits at n x 72 degrees on a 40px ring that turns round you, drawn with Combo Attack's
 * state/((n+1)/2) art (Advanced Combo's from the sixth); orbs 6-10 take the places of 1-5. A new orb grows in from
 * 300% at a quarter alpha over 300ms. Panic and Coma need an orb, Enrage nine.
 */
const COMBO_MASK = 0x20000000000000n, ORB_RADIUS = 40, ORB_TURN_MS = 2000, ENRAGE = 1121010;
/**
 * Rush: when it strikes something you dash ahead along the floor, 30ms a step: three steps of lt/8 px (31 at 250),
 * then six slowing by a fifth each; the monsters struck are thrown to 250-269px + 35px ahead of where you started.
 * It can't be used again for 1.77s, nor where the map forbids movement skills.
 */
const RUSH_DASH = new Set([1121006, 1221007, 1321003]), RUSH_LOCK = 1770, DASH_TICK = 30;
/** Skills a map that forbids movement skills (fieldLimit 0x2) refuses: Rush, Assaulter, Assassinate, Ninja Storm, the Brawler / Thunder Breaker dashes, Snatch and the Aran's. */
const MOVE_LIMITED = new Set([1121006, 1221007, 1321003, 4211002, 4221001, 4121008, 5101002, 5101004, 15101003, 5121005,
  21100002, 21110003, 21110006]);
/**
 * Final Attack: a skill's finalAttack data lists which Final Attack skills can follow it and with which weapon types.
 * One learned (Dawn Warrior's and Wind Archer's need their buff on) goes off at its prop chance a third of the way from
 * the blow to the end of the pose, if you still hold that kind of weapon, in the weapon's final pose (a bow's shot 65px out).
 */
const FINAL_POSES = { 1: ['swingOF', 'stabOF'], 2: ['swingPF', 'stabTF'], 3: ['shootF'], 5: ['swingTF', 'stabOF'] };
const BUFFED_FINALS = new Set([11101002, 13101002]);
/** White Knight / Paladin / Dawn Warrior charges and their element: the charge's damage %, then its element at z%. */
const CHARGES = { 1211003: 'F', 1211004: 'F', 1211005: 'I', 1211006: 'I', 1211007: 'L', 1211008: 'L', 1221003: 'H', 1221004: 'H',
  11111007: 'H' };
const CHARGED_BLOW = 1211002, ADVANCED_CHARGE = 1220010, HEAVENS_HAMMER = 1221011;
/**
 * Skills that shake the screen when they land (with the SHAKE UP option on): Shout by 400/15 px, easing by 15% each
 * 30ms step, for 1.5s at most; Dragon Roar, Super Dragon Roar, Bamboo Rain and Rage of Pharaoh by 400/25, easing by 8%,
 * for 2s. Another player's shakes you less the farther they are (400 less the distance, up to 400px).
 */
const SHOUT = 1111008;
const SHAKERS = new Set([SHOUT, 1311006, 9001001, 1009, 10001009, 20001009, 20011009, 1020, 10001020, 20001020, 20011020]);
const STUN_MASTERY = 5110000, BERSERK = 1320006, WIND_WALK = 13101006, VANISH = 14100005, DARK_SIGHTS = [4001003, 14001003];
/** The Dark Sight (second mask) and Wind Walk (first mask) buff bits. */
const DS_MASK = 0x40000000000n, WW_MASK = 0x400000000n, ASSASSINATE = 4221001;
/**
 * A weapon's damage, as { main, mult, sec (stats added), div }: (main stat x mult + sec) x attack / div. A bow's or
 * crossbow's swing is DEX x 3.4 + STR over 150, a claw's LUK + STR + DEX over 150, a gun's DEX + STR over 200 (1.8 x
 * DEX for Somersault Kick / Double Shot); lying down any other weapon jabs for STR + DEX over 200. Axes, blunt weapons,
 * wands and staves hit harder swung, spears stabbed and polearms swung.
 */
function weaponDamage(cat, shot, pose, skillId, job, asSwing = false) {
  const swing = asSwing || /^swing[OTP]/.test(pose || '');
  if (!shot && (cat === 45 || cat === 46)) return { main: 'dex', mult: 3.4, sec: ['str'], div: 150 };
  if (!shot && cat === 47 && skillId !== 4221001 && skillId !== 4121008 && skillId !== 14101006 && skillId !== 14111006) return { main: 'luk', mult: 1, sec: ['str', 'dex'], div: 150 };
  if (!shot && cat === 49 && ![5201002, 5221003, 5221007, 5221008].includes(skillId) && pose !== 'fireburner' && pose !== 'coolingeffect') {
    return pose === 'somersault' || pose === 'straight' ? { main: 'dex', mult: 1.8, sec: ['str'], div: 100 } : { main: 'dex', mult: 1, sec: ['str'], div: 200 };
  }
  if (pose === 'proneStab') return { main: 'str', mult: 1, sec: ['dex'], div: 200 };
  const str = (mult) => ({ main: 'str', mult, sec: ['dex'], div: 100 });
  switch (cat) {
    case 30: return str(4.0);
    case 33: return Math.floor((job % 1000) / 100) === 4 ? { main: 'luk', mult: 3.6, sec: ['str', 'dex'], div: 100 } : str(4.0);
    case 31: case 32: case 37: case 38: return str(swing ? 4.4 : 3.2);
    case 40: return str(4.6);
    case 41: case 42: return str(swing ? 4.8 : 3.4);
    case 43: case 44: return str(skillId === DRAGON_ROAR ? 4.0 : (cat === 43) === swing ? 3.0 : 5.0);
    case 45: return { main: 'dex', mult: 3.4, sec: ['str'], div: 100 };
    case 46: case 49: return { main: 'dex', mult: 3.6, sec: ['str'], div: 100 };
    case 47: return LUCKY_SEVENS.has(skillId) ? { main: 'luk', mult: 5, sec: [], div: 100, mastery: 0.5 } : { main: 'luk', mult: 3.6, sec: ['str', 'dex'], div: 100 };
    case 48: return str(4.8);
    default: return null;
  }
}
/**
 * The mastery skills for a weapon, used shooting (shot) or up close: [explorer, Cygnus...] lists where the first
 * learned counts, `plus` ones added (Beholder), `over` ones that replace them (Bow Expert, Marksman Boost, High Mastery).
 */
function masterySkills(cat, shot, skillId, job) {
  const close = !shot;
  switch (cat) {
    case 30: case 40: return close || skillId === 11101004 ? { first: [1100000, 1200000, 11100000] } : null;
    case 31: case 41: return close ? { first: [1100001] } : null;
    case 32: case 42: return close ? { first: [1200001] } : null;
    case 33: return close ? { first: [4200000] } : null;
    case 43: return close ? { first: [1300000], plus: [1321007] } : null;
    case 44: if (!close && ![21100004, 21110004, 21120006].includes(skillId)) return null;
      return Math.floor(job / 100) === 21 || job === 2000 ? { first: [21100000], over: [21120001] } : { first: [1300001], plus: [1321007] };
    case 45: return shot ? { first: [3100000, 13100000], over: [3120005, 13110003] } : null;
    case 46: return shot ? { first: [3200000], over: [3220004] } : null;
    case 47: return shot || skillId === 14111006 ? { first: [4100000, 14100000] } : null;
    case 48: return close || skillId === 5121002 || skillId === 15111007 ? { first: [5100001, 15100001] } : null;
    case 49: return shot || skillId === 5221003 ? { first: [5200000] } : null;
    default: return null;
  }
}
/** A shot's arrow takes 1.5ms per pixel. */
const flightMs = (dx) => Math.abs(dx) * 1.5;
/**
 * Damage by a monster's place along a shot (first, second...): Iron Arrow loses 10% at each, Piercing Arrow gains 20%,
 * Energy Orb loses 30%; Arrow Bomb does its x% on all of them.
 */
const PIERCE_SCALE = { 3201005: 0.9, 3221001: 1.2, 5121002: 0.7 }, ARROW_BOMB = 3101005;
/** Time between one shot's arrows: Strafe 60ms, throwing stars 120ms, Double Shot (gun) and Burst Fire 240ms. */
function arrowGap(skillId, ammoId) {
  if (Math.floor(ammoId / 10000) === 207 || Math.floor(ammoId / 1000) === 5021 || skillId === 5221007) return 120;
  if ([3111006, 3211006, 13111001].includes(skillId)) return 60;
  return skillId === 5001003 || skillId === 5210000 ? 240 : 0;
}
/**
 * How long after the first monster each of the others is hit (i: its place in the order), in ms. A melee attack
 * goes 70ms apart up to 280ms (Band of Thieves: the rest all at 280ms); a spell without a projectile 50ms apart, or
 * all at once for Meteor Shower, Blizzard and Genesis. Another player's spell lands all at once, but Thunder Bolt
 * and Heal 50ms apart.
 */
const BAND_OF_THIEVES = 4211004, SPARK = 15111006;
const MAGIC_AT_ONCE = new Set([2121007, 2221007, 2321008, 12111003]);
const REMOTE_MAGIC_WAVE = new Set([2201005, 2301002]);
function hitWave(i, kind, skillId, remote = false) {
  if (skillId === CHAIN_LIGHTNING && !remote) return i * 100;
  if (kind === 'magic') return (remote ? REMOTE_MAGIC_WAVE.has(skillId) : !MAGIC_AT_ONCE.has(skillId)) ? i * 50 : 0;
  if (skillId === BAND_OF_THIEVES && !remote) return i ? 280 : 0;
  return Math.min(i * 70, 280);
}
/** Meso piles animate on fixed timings (the client overrides the WZ): four 80ms frames below 100, four 200ms below 1000, the bag 4000/120/120/120. */
function mesoTiming(node, amount) {
  const delays = amount < 100 ? [80, 80, 80, 80] : amount < 1000 ? [200, 200, 200, 200] : [4000, 120, 120, 120];
  const out = {};
  for (let i = 0; node[i]; i++) out[i] = { ...node[i], delay: delays[i] ?? delays[delays.length - 1] };
  return out;
}
// monster curses (Skill/MobSkill.img ids), as the server sends them
const SEAL = 120, WEAKEN = 122, STUN = 123, SLOW = 126, REVERSE = 132;
const MOB_DOOM = 0x10000;   // MonsterStatus.DOOM
const FADE_MS = 600;   // map changes: the old map dims to black over this, the new one lights up over it
/**
 * Skills that reach out to their range once the swing has a target: Slash Blast, Coma (sword, axe, Dawn Warrior's)
 * and Charged Blow. Others with only a range keep to the swing.
 */
const RANGE_SWINGS = new Set([1001005, 11001003, 1111005, 1111006, 11111003, 1211002]);
/** Drop hop heights (the original uses 100px for both) and the pickup's length; see updateDrops. */
const DROP_HOP = 64, THROW_HOP = 93, PICKUP_TIME = 0.7;

/** Chat line colours, as in the v83 chat log. */
const CHAT_COLORS = { spouse: '#ff9ec7', whisper: '#7cfc5a', buddy: '#ffb36b', party: '#ff9ed6', guild: '#d6a4ff', alliance: '#9fe6c2', find: '#ffe08a', notice: '#ff9e9e' };
const GROUP_KEYS = ['buddy', 'party', 'guild', 'alliance'];
/** PacketCreator.partyStatusMessage codes */
const PARTY_MESSAGES = {
  10: 'A beginner cannot create a party.', 12: 'You have quit as the leader of the party.', 13: 'You have yet to join a party.',
  16: 'You have already joined a party.', 17: 'The party you are trying to join is already full.',
  19: 'Unable to find the requested character in this channel.', 21: "'%s' is blocking party invitations.",
  22: "'%s' is taking care of another invitation.", 23: "'%s' has denied your party invitation.",
  25: 'You cannot kick another user in this map.', 28: 'Leadership can only be given to a party member in the vicinity.',
  29: 'Leadership can only be given to a party member in the vicinity.', 30: 'You can only change leadership on the same channel.',
  1: 'Your party request did not work.', 5: 'Your party request did not work.', 6: 'Your party request did not work.',
};
/** GuildPackets.genericGuildMessage / responseGuildMessage codes (53-55 name the other character) */
const GUILD_MESSAGES = {
  28: 'The name is already in use. Please try another one.', 31: 'There was a problem locating the players during the agreement.',
  33: 'You have already joined a guild.', 35: 'You cannot make a guild.', 36: 'Someone disagreed to the guild agreement.',
  38: 'There was a problem during the forming of the guild.', 40: 'That character has already joined a guild.',
  41: 'The guild you are trying to join has already reached the maximum number of members.', 42: 'The character cannot be found in the current channel.',
  45: 'The character is not in the guild.', 48: 'The character is not in the guild.', 52: 'There was a problem in disbanding the guild.',
  56: 'An admin cannot make a guild.', 57: 'There was a problem in increasing the guild size.',
  53: "'%s' is not accepting guild invitations.", 54: "'%s' is taking care of another invitation.", 55: "'%s' has denied your guild invitation.",
};
/** PacketCreator.getMiniRoomError codes for trades */
const TRADE_ERRORS = { 2: 'The other character is already trading.', 4: 'You cannot trade right now.', 5: 'The other character cannot trade right now.' };
const BUDDY_MESSAGES = { 11: 'Your buddy list is full.', 12: "That character's buddy list is full.", 13: 'That character is already on your buddy list.',
  14: 'You cannot add a GM to your buddy list.', 15: 'That character is not registered.' };

/**
 * At a fractional zoom (a high-density screen draws the 800x600 game at, say, 1.6x) pieces that meet in game
 * pixels meet on fractional screen pixels, and the browser softens each image's edge there: faint lines between
 * floor tiles and background pieces that shimmer as the camera moves. So every unrotated image is drawn with its
 * edges rounded to whole screen pixels; two pieces that touch round to the same edge and close up.
 */
function snapToPixels(ctx) {
  const draw = ctx.drawImage.bind(ctx);
  ctx.drawImage = function (img, ...a) {
    const m = ctx.getTransform();
    if (m.b || m.c || (m.a === 1 && m.d === 1 && m.e === Math.round(m.e) && m.f === Math.round(m.f))) return draw(img, ...a);
    let sx = 0, sy = 0, sw = img.width, sh = img.height, dx, dy, dw, dh;
    if (a.length === 2) { [dx, dy] = a; dw = sw; dh = sh; }
    else if (a.length === 4) [dx, dy, dw, dh] = a;
    else [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    // the rectangle's corners on screen, rounded; a mirrored draw (negative scale) just swaps the ends
    let x0 = Math.round(m.a * dx + m.e), x1 = Math.round(m.a * (dx + dw) + m.e);
    let y0 = Math.round(m.d * dy + m.f), y1 = Math.round(m.d * (dy + dh) + m.f);
    ctx.save();
    ctx.setTransform(Math.sign(m.a) || 1, 0, 0, Math.sign(m.d) || 1, 0, 0);
    if (m.a < 0) { x0 = -x0; x1 = -x1; }
    if (m.d < 0) { y0 = -y0; y1 = -y1; }
    draw(img, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  };
  return ctx;
}

export class Game {
  /** net: ChannelSession when playing online, null for the offline map viewer. */
  constructor(canvas, assets, look, hooks = {}, net = null) {
    this.canvas = canvas; this.ctx = snapToPixels(canvas.getContext('2d'));
    canvas.width = VIEW_W; canvas.height = VIEW_H;
    this.ctx.imageSmoothingEnabled = false;
    this.assets = assets; this.look = look; this.hooks = hooks; this.net = net;
    this.input = new Input(canvas);
    this.cam = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
    this.player = {
      name: 'Player', x: 0, y: 0, vx: 0, vy: 0, fh: null, ladder: null, facingRight: false,
      action: 'stand1', frame: 0, frameT: 0, attack: null, ignoreFh: null, ignoreT: 0, chat: null,
    };
    this.effects = [];
    this.others = new Map(); this.drops = new Map(); this.lifeByOid = new Map(); this.pets = new Map(); this.summons = new Map();
    this.boards = new ShopBoards(this);
    this.queue = []; this.loading = false;
    this.fps = 0; this._frames = 0; this._fpsT = 0;
    this.moveBuf = []; this.moveT = 0; this.flushT = 0;
    this.invincible = 0; this.portalCooldown = 0;
    this.stats = null; this.inventory = null; this.meso = 0;
    this.showMinimap = true;
    this.keymap = defaultKeymap();
    this.buffs = [];   // {source, until, m1, m2}
    this.fx = [];      // skill effect animations {anim, x, y, flip, follow}
    this.shots = [];   // projectiles {anim, x, y, tx, ty, t, dur, onHit}
  }

  /**
   * The canvas UI (status bar, menus, quick slots) sees pointer events first; a press or click
   * on it never reaches the world (NPC clicks, etc.). The chat field follows the canvas' size.
   */
  bindUiPointer() {
    const sb = this.statusBar, c = this.canvas;
    const at = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * VIEW_W / r.width, (e.clientY - r.top) * VIEW_H / r.height]; };
    const wm = this.windows;
    // windows sit above the bar: they see the event first, the bar only gets what they leave
    const route = (type, e) => (wm.pointer(type, ...at(e)) ? (sb.pointer('move', -1, -1), true) : sb.pointer(type, ...at(e)));
    c.addEventListener('pointermove', (e) => route('move', e));
    c.addEventListener('pointerdown', (e) => { if (route('down', e)) e.stopImmediatePropagation(); }, true);
    addEventListener('pointerup', (e) => route('up', e));
    c.addEventListener('click', (e) => { const p = at(e); if (wm.top(...p) || sb.contains(...p)) e.stopImmediatePropagation(); }, true);
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = at(e), b = this.vfx?.buffAt(...p);
      if (b) { if (b.source > 0) this.net?.cancelBuff(b.source); return; }
      const tw = wm.top(...p);
      if (tw?.rclick) { tw.rclick(p[0] - tw.x, p[1] - tw.y); return; }
      // right-click another player: Personal Info / Whisper / Party Invite / Trade
      const rp = !wm.top(...p) && !sb.contains(...p) && this.playerAt(...p);
      if (rp && this.net) wm.show(new PlayerMenu(wm, rp, Math.round(p[0]), Math.round(p[1])));
    });
    // double-click a character (yourself included) for their Character Info
    c.addEventListener('dblclick', (e) => {
      const p = at(e);
      if (wm.top(...p) || sb.contains(...p) || !this.net) return;
      // your own chalkboard: put it away
      const cr = this.player.chalk && this.player.chalkRect, wx = p[0] + this.cam.x, wy = p[1] + this.cam.y;
      if (cr && wx >= cr.x && wx < cr.x + cr.w && wy >= cr.y && wy < cr.y + cr.h) { this.net.closeChalkboard(); return; }
      // a shop sign takes you into the shop
      const signed = this.shopSignAt(p[0] + this.cam.x, p[1] + this.cam.y);
      if (signed && signed !== this.player) { this.net.pshopVisit(signed.box.oid); return; }
      const stall = this.boards.at(p[0] + this.cam.x, p[1] + this.cam.y);
      if (stall?.merchant && stall.merchant.owner !== this.player.id) { this.net.pshopVisit(stall.merchant.oid); return; }
      const rp = this.playerAt(...p) || (this.hitsChar(this.player, ...p) ? this.player : null);
      if (rp) this.requestCharInfo(rp.id);
    });
    c.addEventListener('wheel', (e) => {
      // deltaMode 1 = lines (some mice / Firefox): count each as a pixel step of 40
      const dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1);
      if (wm.pointer('wheel', ...at(e), dy)) e.preventDefault();
    }, { passive: false });
    const place = () => sb.place({ left: 0, top: 0 }, c.clientWidth / VIEW_W);
    new ResizeObserver(place).observe(c);
    place();
  }

  /**
   * CHANGE_CHANNEL: the server answers with the new channel's address; the client then drops this
   * connection and logs the same character in there (PLAYER_LOGGEDIN), keeping its handlers.
   */
  async switchChannel(ch) {
    if (ch === this.channel) return;
    await this.hop((net) => net.changeChannel(ch), 'Changing channel...', 'You cannot change channels right now.');
  }
  /** Leaving the Cash Shop is the same hop: the server sends the channel's address and we log back in there. */
  async leaveCashShop() {
    if (!this.inCashShop) return;
    await this.hop((net) => net.leaveCashShop(), 'Returning to the game...', 'You cannot leave the Cash Shop right now.', true);
  }
  /** Notes (gift notices and the like): show each once, then let the server drop them. */
  async showNotes(notes) {
    if (!notes.length) return;
    for (const n of notes) await this.windows.notice(`#bNote from ${n.from}#k\n${n.text}`);
    this.net?.discardNotes(notes.map((n) => n.id));
  }
  enterCashShop() { if (this.net && !this.inCashShop && !this.dead) this.net.enterCashShop(); }
  /** SET_CASH_SHOP: the server took us off the map; swap the world for the shop screen. */
  openCashShop(d) {
    this.inCashShop = true;
    const info = d.info;
    if (info) { Object.assign(this.stats, info.stats); this.inventory = info.inventory; this.meso = info.meso; }
    this.others.clear(); this.drops.clear(); this.pets.clear(); this.lifeByOid.clear(); this.summons.clear(); this.boards.clear(); this.reactors?.clear();
    for (const w of [...this.windows.order]) this.windows.close(w);
    this.showChatBox(false);
    music.play('BgmUI/ShopBgm');
    this.csWin = this.windows.show(new CashShopWin(this.windows, d));
  }
  /** The status bar's chat line is a page element over the canvas: hide it while the shop screen is up. */
  showChatBox(on) { const el = this.statusBar?.chat?.el; if (el) el.style.visibility = on ? '' : 'hidden';
  }
  async hop(request, label, refused, fromCashShop = false) {
    if (this.switching || !this.net) return;
    this.switching = true;
    const old = this.net;
    try {
      const addr = await new Promise((resolve) => {
        old.h.changeChannel = resolve;
        request(old);
        setTimeout(() => resolve(null), 8000);
      });
      old.h.changeChannel = null;
      if (!addr) { await this.windows.notice(refused); return; }
      const h = old.h;
      old.h = {};                       // the old connection closes quietly
      old.close();
      this.hooks.onLoading?.(true, label);
      const net = new ChannelSession(wsTransport(bridgeUrl(this.server, addr.port)), h);
      await net.ready();
      const entered = await net.enter(this.player.id);
      this.net = net;
      this.channel = entered.channel;
      const info = entered.info;
      if (info) { Object.assign(this.stats, info.stats); this.inventory = info.inventory; this.meso = info.meso; }
      if (fromCashShop) { this.inCashShop = false; if (this.csWin) this.windows.close(this.csWin); this.csWin = null; }
      const loaded = this.changeMap(entered.mapId, { portalIdx: entered.portal });
      net.flush();
      await loaded;
      if (fromCashShop) { this.windows.open('minimap'); this.showChatBox(true); }
      else this.hud.message(`You are now in channel ${this.channel + 1}.`, '#9fd3ff');
      if (this.stats.hp <= 0 && !this.dead) this.die();   // still dead after the switch
    } catch (e) {
      console.error(e);
      this.hooks.onLoading?.(false);
      await this.windows.notice(fromCashShop ? 'Leaving the Cash Shop failed. Please log in again.' : 'Changing channel failed. Please log in again.');
      location.reload();
    } finally {
      this.switching = false;
    }
  }

  /** The other player under a canvas point. */
  playerAt(x, y) { for (const rp of this.others.values()) if (this.hitsChar(rp, x, y)) return rp; return null; }
  hitsChar(ent, x, y) {
    const wx = x + Math.round(this.cam.x), wy = y + Math.round(this.cam.y);
    return wx >= ent.x - 18 && wx <= ent.x + 18 && wy >= ent.y - 64 && wy <= ent.y;
  }
  requestCharInfo(id) { this.net?.charInfo(id); }
  /** A drawable look from packet look data (loads in the background; draws once ready). */
  lookFrom(d) {
    if (!d) return null;
    const look = new CharacterLook(this.assets, { skin: d.skin, face: d.face, hair: d.hair, equips: visibleEquips(d) });
    look.load().then(() => this.assets.preload(lookCanvases(look, [look.standAction()]))).then(() => { look.ready = true; });
    return look;
  }
  requestTrade(rp) { if (this.tradeWin) { this.notice('You are already trading.'); return; } this.net?.tradeStart(rp.id); }

  // ------------------------------------------------------------------ keymap
  /** Physical keys currently bound to (type, action) and pressed this frame / held. */
  keysFor(type, action) {
    const out = [];
    for (const [code, sc] of Object.entries(CODE_TO_SC)) { const k = this.keymap[sc]; if (k && k.type === type && k.action === action) out.push(code); }
    return out;
  }
  hitAction(a) { return this.keysFor(5, a).some((c) => this.input.hit(c)); }
  // held, or tapped since the last frame (a quick tap can start and end between two frames)
  holdAction(a) { return this.keysFor(5, a).some((c) => this.input.is(c) || this.input.hit(c)); }

  bindKey(sc, type, action) {
    if (type === 1 && this.skills && !this.skills.owns(action)) return;   // another job's skill has no key
    // a skill/item lives on one key only
    const changes = [];
    for (const [k, b] of Object.entries(this.keymap)) if (b.type === type && b.action === action && Number(k) !== sc) { delete this.keymap[k]; changes.push({ key: Number(k), type: 0, action: 0 }); }
    this.keymap[sc] = { type, action };
    changes.push({ key: sc, type, action });
    this.net?.changeKeymap(changes);
    this.keyBar?.render();
  }
  /** Take other jobs' skills off the keys (and off the server's keymap, so they stay off). */
  dropForeignSkillKeys() {
    const changes = [];
    for (const [k, b] of Object.entries(this.keymap)) {
      if (b.type === 1 && !this.skills.owns(b.action)) { delete this.keymap[k]; changes.push({ key: Number(k), type: 0, action: 0 }); }
    }
    if (changes.length) { this.net?.changeKeymap(changes); this.keyBar?.render(); }
  }

  /** Window / skill / item keys pressed this frame (type 4, 1, 2). Basic actions are polled in updatePlayer. */
  handleHotkeys() {
    for (const code of this.input.pressed) {
      const k = this.keymap[CODE_TO_SC[code]];
      if (!k) continue;
      if (k.type === 4) this.toggleMenu(k.action);
      else if (k.type === 6) this.emote(k.action - 99);
      else if (k.type === 8) this.runMacro(k.action);
      else if (k.type === 2) this.useItemById(k.action);
    }
  }

  /**
   * A skill macro's key: its skills are cast one after another, each once the one before has finished
   * (updatePlayer takes them from macroQueue); with SHOUT on, its name is said in the chat first.
   */
  runMacro(i) {
    const m = this.macros?.[i];
    const ids = (m?.skills || []).filter((id) => id && this.skills?.level(id));
    if (!ids.length || this.macroQueue?.length) return;
    this.macroQueue = ids;
    if (m.shout && m.name) this.net?.chat(m.name);
  }

  /** A Shop Permit: name the shop, then the server opens its room (only in the Free Market rooms). */
  async openShop(permit) {
    if (this.playerShop || this.tradeWin) return;
    const title = await this.windows.askText('Enter the title of your shop.', `${this.player.name}'s shop`, { max: 25, width: 200 });
    if (title?.trim()) this.net?.pshopCreate(title.trim(), permit);
  }

  /** Family traffic: your info and the pedigree go to their windows; invitations and summons ask you. */
  async onFamily(e) {
    const say = (t) => this.hud?.message(t, CHAT_COLORS.notice), refresh = () => {
      if (this.windows.isOpen('family')) this.net?.familyOpen();
      const tree = this.windows.wins.familytree;
      if (this.windows.isOpen('familytree') && tree.chart) tree.load(tree.chart.members.find((m) => m.id === tree.chart.self)?.name || this.player.name);
    };
    if (e.op === 'privileges') this.familyPrivileges = e.list;
    else if (e.op === 'info') this.family = e.info;
    else if (e.op === 'chart') this.windows.wins.familytree.setChart(e);
    else if (e.op === 'result') { const t = familyResult(e.code, e.mesos); if (t) this.windows.notice(t); refresh(); }
    else if (e.op === 'invite') {
      sfx.play('UI/DlgNotice');
      const ok = await notify(this.windows, 'family', e.name);
      this.net?.familyAnswer(e.id, e.name, ok);
    } else if (e.op === 'joined') { say(e.ok ? `${e.name} has joined the family.` : `${e.name} has declined your family invitation.`); refresh(); }
    else if (e.op === 'senior') { say(`You are now a junior of ${e.name}.`); this.net?.familyOpen(); refresh(); }
    else if (e.op === 'rep') say(`You have gained ${e.gain} reputation${e.from ? ` from ${e.from}` : ''}.`);
    else if (e.op === 'login') say(`[Family] ${e.name} has logged ${e.online ? 'in' : 'out'}.`);
    else if (e.op === 'summon') {
      sfx.play('UI/DlgNotice');
      const ok = await notify(this.windows, 'familySummon', e.from);
      this.net?.familySummonAnswer(e.family, ok);
    }
  }
  async familyAddJunior() {
    const name = (await this.windows.askText('Enter the name of the character you want as your junior.\n(They must be in this map, above level 10, and within 20 levels of you.)'))?.trim();
    if (name) this.net?.familyAdd(name);
  }

  /** Maple Messenger traffic: an invitation asks you; the rest goes to the window (opened when someone joins). */
  async onMessenger(e) {
    const win = this.windows.wins.messenger;
    if (e.op === 'invite') {
      sfx.play('UI/DlgNotice');
      if (await notify(this.windows, 'messenger', e.from)) win.accept(e.id);
      else this.net?.messengerDecline(e.from);
      return;
    }
    if (!win.active) return;
    win.event(e);
  }

  /** A megaphone from the Cash tab: ask what to say (Megaphone, Super, Item, Triple and the Avatar messengers). */
  async openMegaphone(slot, itemId) {
    const kind = Math.floor(itemId / 1000) % 10, avatar = Math.floor(itemId / 10000) === 539;
    if (!avatar && ![1, 2, 6, 7].includes(kind)) { this.notice('This megaphone cannot be used here.'); return; }
    if (!avatar && kind === 1 && (this.stats?.level || 0) < 10) { this.windows.notice('You may not use this until you\'re level 10.'); return; }
    const win = new MegaphoneWin(this.windows, Number(slot), itemId);
    await this.assets.preload(win.frames());
    this.windows.show(win);
  }

  /** Duey: talking to him sends the parcels waiting for you, which opens his window; results come back as codes. */
  async onDuey(e) {
    const win = this.dueyWin && this.windows.order.includes(this.dueyWin) ? this.dueyWin : null;
    if (e.op === 'open') {
      if (win) { win.setList(e.list); return; }
      const w = new DueyWin(this.windows, e.list);
      await this.assets.preload(w.frames());
      this.dueyWin = this.windows.show(w);
    } else if (e.op === 'gone') win?.gone(e.id);
    else if (e.op === 'arrived') this.hud.message(e.from ? `A parcel from ${e.from} is waiting for you. Visit Duey to collect it.` : 'A parcel is waiting for you. Visit Duey to collect it.', '#ffe08a');
    else if (e.op === 'result') { const t = dueyResult(e.code); if (t) this.windows.notice(t); }
  }

  async openRock(slot, itemId) {
    if (this.windows.order.some((w) => w instanceof TeleportWin)) return;
    const win = new TeleportWin(this.windows, Number(slot), itemId);
    await this.assets.preload(win.frames());
    this.windows.show(win);
  }
  /** A Chalkboard: write on it and hold it up (not in the Free Market rooms); double-click it to put it away. */
  async openChalkboard(slot, itemId) {
    if (this.player.chalk) { this.net?.closeChalkboard(); return; }
    const text = (await this.windows.askText('What would you like to write on your chalkboard?', '', { max: 60, width: 220 }))?.trim();
    if (text) this.net?.useChalkboard(Number(slot), itemId, text);
  }
  /**
   * A chalkboard over a character's head: ChatBalloon.img/adboard/0 stretched round the text (white, up to
   * four wrapped lines), its arrow pointing down at them. Remembers where it was drawn for double-clicks.
   */
  drawChalkboard(ctx, ent, sx, sy) {
    const A = this.chalkArt;
    if (!A) { if (!this.chalkLoading) { this.chalkLoading = true; this.assets.json('UI/ChatBalloon.img').then((cb) => { const a = cb?.adboard?.[0]; if (a) this.assets.preload(Object.values(a).filter((n) => n?._canvas)).then(() => { this.chalkArt = a; }); }); } return; }
    const im = (k) => this.assets.image(A[k]);
    ctx.save(); ctx.font = '12px Arial, sans-serif';
    const lines = wrap(ctx, ent.chalk, 150).slice(0, 4);
    const w = Math.max(70, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)))), h = lines.length * 15;
    const x = Math.round(sx - w / 2), y = Math.round(sy - 82 - h - 19);
    const put = (k, px, py, pw, ph) => { const i = im(k); if (i) { if (pw) ctx.drawImage(i, px, py, pw, ph); else ctx.drawImage(i, px, py); } };
    put('c', x, y, w, h);
    put('n', x, y - 19, w, 19); put('s', x, y + h, w, 19); put('w', x - 18, y, 18, h); put('e', x + w, y, 18, h);
    put('nw', x - 18, y - 19); put('ne', x + w, y - 19); put('sw', x - 18, y + h); put('se', x + w, y + h);
    put('arrow', Math.round(sx - 7), y + h + 10);
    lines.forEach((l, i) => uiText(ctx, l, sx, y + i * 15, { color: '#fff', size: 12, align: 'center' }));
    ctx.restore();
    ent.chalkRect = { x: x - 18 + this.cam.x, y: y - 19 + this.cam.y, w: w + 36, h: h + 38 };
  }

  /** A Hired Merchant: ask the server whether one may open here; merchantCheck carries on. */
  openMerchant(itemId) {
    if (this.playerShop || this.tradeWin) return;
    this.merchantItem = itemId;
    this.net?.merchantRequest();
  }
  async onMerchantCheck(code) {
    if (code === 7) {
      const title = await this.windows.askText('Enter the title of your store.', `${this.player.name}'s store`, { max: 25, width: 200 });
      if (title?.trim()) this.net?.pshopCreate(title.trim(), this.merchantItem, 5);
    } else if (code === 9) this.windows.notice('Fredrick in the Free Market Entrance is keeping items or mesos for you.\nCollect them before opening a new store.');
    else if (code === 0x10) this.windows.notice('Your Hired Merchant is open in another channel.');
    else this.windows.notice('You cannot open a Hired Merchant right now.');
  }

  /**
   * FIND NPC: a bouncing arrow over that NPC for a few seconds - or, while it is off screen, one at the
   * screen's edge pointing its way, with its name.
   */
  markNpc(ent, name) { this.npcMark = { ent, name, until: performance.now() + 8000 }; sfx.play('UI/BtMouseClick'); }
  drawNpcMark(ctx, cam) {
    const k = this.npcMark;
    if (!k) return;
    const now = performance.now();
    if (now > k.until || !this.map.life.includes(k.ent)) { this.npcMark = null; return; }
    // above the head - and above the quest bulb when the NPC wears one
    const q = this.quests?.npcQuests(Number(k.ent.spawn?.id), this.textCtx());
    const bulb = q && (q.start.length || q.complete.length || q.progress.length) ? 38 : 0;
    const top = (k.ent.box ? k.ent.box().top : k.ent.y - 80) - bulb, bob = Math.abs(Math.sin(now / 180)) * 10;
    const sx = k.ent.x - cam.x, sy = top - cam.y;
    // the arrow points down at (0, 8) from its own origin; turned for the edge pointer
    const arrow = (x, y, angle) => {
      ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(angle);
      ctx.beginPath(); ctx.moveTo(-9, -22); ctx.lineTo(9, -22); ctx.lineTo(9, -14); ctx.lineTo(15, -14);
      ctx.lineTo(0, 0); ctx.lineTo(-15, -14); ctx.lineTo(-9, -14); ctx.closePath();
      ctx.fillStyle = '#ffd21e'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#7a4a00'; ctx.stroke();
      ctx.restore();
    };
    if (sx >= 0 && sx <= VIEW_W && sy >= 0 && sy <= VIEW_H) { arrow(sx, sy - 6 - bob, 0); return; }
    const right = sx > VIEW_W / 2, ex = right ? VIEW_W - 8 - bob : 8 + bob;
    const ey = Math.max(90, Math.min(VIEW_H - 140, sy + 30));
    arrow(ex, ey, right ? -Math.PI / 2 : Math.PI / 2);
    if (k.name) uiText(ctx, k.name, right ? ex - 30 : ex + 30, ey - 7, { color: '#ffd21e', bold: true, size: 12, align: right ? 'right' : 'left', outline: '#3a2600' });
  }

  /** The shop sign over a character at canvas point (x, y), if any. */
  shopSignAt(x, y) {
    for (const ent of [this.player, ...this.others.values()]) {
      const r = ent.signRect;
      if (ent.box?.type === 4 && r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return ent;
    }
    return null;
  }

  /** A face expression from its key (F1-F7 = 1 hit .. 7 stunned): shown here and sent to the map. */
  emote(n) {
    if (!EMOTES[n - 1] || this.player.dead) return;
    const now = performance.now();
    if (now - (this.lastEmote || 0) < 300) return;   // a held key repeats: once is enough
    this.lastEmote = now;
    setExpression(this.player, n);
    this.net?.faceExpression(n);
  }

  /** Skill keys held down (repeat like the real client while held). */
  heldSkill() {
    for (const code of new Set([...this.input.down, ...this.input.pressed])) {
      const k = this.keymap[CODE_TO_SC[code]];
      if (k?.type === 1) { this.skillKeyPressed = this.input.hit(code); return k.action; }
    }
    return 0;
  }

  toggleMenu(m) {
    if (!this.hud) return;
    if (m === MENU.ITEMS) this.windows.toggle('inventory');
    else if (m === MENU.EQUIP) this.windows.toggle('equip');
    else if (m === MENU.STATS) this.windows.toggle('stat');
    else if (m === MENU.SKILLS) this.toggleSkills();
    else if (m === MENU.QUESTS) this.toggleQuests();
    else if (m === MENU.MINIMAP) this.windows.toggle('minimap');
    else if (m === MENU.WORLDMAP) this.windows.toggle('worldmap');
    else if (m === MENU.KEYS) this.windows.toggle('keyconfig');
    else if (m === MENU.BUDDY) this.windows.toggle('userlist', 0);
    else if (m === MENU.PARTY) this.windows.toggle('userlist', 1);
    else if (m === MENU.MONSTERBOOK) this.windows.toggle('monsterbook');
    else if (m === MENU.MESSENGER) this.windows.toggle('messenger');
    else if (m === MENU.PARTY_SEARCH) this.windows.toggle('partysearch');
    else if (m === MENU.FAMILY) this.windows.toggle('family');
  }

  toggleSkills() {
    if (!this.skills) return;
    this.windows.toggle('skill');
  }

  useItemById(id) {
    if (this.hidden()) return;
    const t = Math.floor(id / 1000000);
    const slot = Object.entries(this.inventory?.[t] || {}).find(([, it]) => it.id === id)?.[0];
    if (slot && t === 2 && isPetFood(id)) this.feedPet(Number(slot), id);
    else if (slot && t === 2) { this.net.useItem(Number(slot), id); sfx.play(`Item/${pad(id, 8)}/Use`); }
    else if (slot && t === 3 && Math.floor(id / 10000) === 301) this.sitChair(id);
  }

  // ------------------------------------------------------------------ pets
  addPet(d) {
    const pet = new Pet(this, d);
    this.pets.set(pet.key, pet);
    if (!this.petDialog) this.petDialog = this.assets.json('String/PetDialog.img').then((s) => { this.petDialog = s; return s; });
  }
  myPets() { return [...this.pets.values()].filter((p) => p.mine); }
  /** The pet's closeness level, from its cash-inventory item. */
  petLevel(pet) {
    const it = Object.values(this.inventory?.[5] || {}).find((i) => i.pet && Number(BigInt.asIntN(32, BigInt(i.cashId ?? 0))) === pet.uid);
    return it?.pet?.level || 1;
  }
  feedPet(slot, id) {
    if (!this.myPets().length) { this.notice('You have no pet out to feed.'); return; }
    this.net.petFood(slot, id);
  }
  /** Saying a pet command word in chat ("sit", "poop", "iloveyou" ...) asks every pet of yours that knows it at its level. */
  petCommandWord(text) {
    const word = text.trim().toLowerCase();
    if (!word || typeof this.petDialog !== 'object' || !this.petDialog) return;
    for (const pet of this.myPets()) {
      const lv = this.petLevel(pet), words = this.petDialog[pet.id] || {};
      for (const [n, c] of Object.entries(pet.data?.interact || {})) {
        if (lv < (c.l0 ?? 1) || lv > (c.l1 ?? 30)) continue;
        if (String(words[c.command] || '').toLowerCase().split('|').includes(word)) { this.net.petCommand(pet.uid, Number(n)); break; }
      }
    }
  }
  /** PET_COMMAND answers: interact/<cmd> (or the food entry for the pet's level) gives the action and lines. */
  petAnswer(pet, kind, cmd, ok) {
    if (!pet?.data) return;
    let node = null;
    if (kind === 'interact') node = pet.data.interact?.[cmd];
    else { const lv = pet.mine ? this.petLevel(pet) : 1; node = Object.values(pet.data.food || {}).find((f) => lv >= f.l0 && lv <= f.l1); }
    const { act, text } = petLines(pet, node, ok, typeof this.petDialog === 'object' ? this.petDialog : null);
    if (act) pet.play(act);
    pet.say(text);
  }
  /** Your pets try for items lying near them (Cosmic only lets them with an Item Pouch / Meso Magnet on). */
  petLoot(dt) {
    if ((this.petLootT = (this.petLootT || 0) + dt) < 0.25) return;
    this.petLootT = 0;
    const tried = (this.petTried ??= new Set());
    for (const pet of this.myPets()) {
      for (const d of this.drops.values()) {
        if (d.pickedBy || tried.has(d.oid) || !d.landed) continue;
        // within reach of the pet (it trails ~72px behind you, so items at your feet count)
        if (Math.abs(d.x - pet.x) < PET_LOOT_X && Math.abs(d.y - pet.y) < 40 && (!d.owner || d.owner === this.player.id || d.type >= 2)) {
          tried.add(d.oid);
          this.net.petLoot(pet.uid, d.oid, Math.round(pet.x), Math.round(pet.y));
        }
      }
    }
  }

  weaponId() { return this.inventory?.equipped[-11]?.id || 0; }
  weaponOf(who) { return who === this.player ? this.weaponId() : who?.look?.weaponId?.() || 0; }
  /** Your Dark Sight buff, if it is on. */
  darkSight() { const now = Date.now(); return this.buffs?.find((b) => DARK_SIGHTS.includes(b.source) && b.until > now) || null; }
  /** In Dark Sight or Wind Walk: monsters don't touch you, you don't regenerate or pick up, and you're drawn see-through. */
  hidden() { const now = Date.now(); return !!this.buffs?.some((b) => (DARK_SIGHTS.includes(b.source) || b.source === WIND_WALK) && b.until > now); }
  /** What spaces an attacker's damage lines: their weapon and their attack's speed scale. */
  lineTiming(who) { return [this.weaponOf(who), who === this.player ? this.attackScale() : who?.attackScale || 1]; }
  equipStat(key) { let v = 0; for (const it of Object.values(this.inventory?.equipped || {})) v += it[key] || 0; return v; }
  /**
   * Your Speed and Jump as fractions of the base walk / jump: 100 plus your equipment's plus the strongest buff
   * (Haste, Nimble Feet, a speed potion...), held to 80-140 and 80-123 as the client does (openms, docs/skills.md).
   */
  moveStats() {
    const now = Date.now(), active = (this.buffs || []).filter((b) => b.until > now);
    // the last speed buff given sets it, a slowing one too (Dark Sight's -30); jump takes the strongest
    const buff = (k) => (k === 'speed' ? active.findLast((b) => b.speed)?.speed || 0 : Math.max(0, ...active.filter((b) => b[k]).map((b) => b[k])));
    const pct = (k, max) => Math.max(80, Math.min(max, 100 + this.equipStat(k) + buff(k))) / 100;
    const slow = (this.diseases || []).find((d) => d.skill === SLOW && d.until > now);   // Slow: down to its x%
    return { speed: slow ? Math.min(pct('speed', 140), (slow.x || 80) / 100) : pct('speed', 140), jump: pct('jump', 123) };
  }

  // ------------------------------------------------------------------ online wiring
  /** Hook a ChannelSession's events to this game. `entered` is the result of session.enter(). */
  async goOnline(entered, uiRoot) {
    const info = entered.info;
    sfx.play('Game/GameIn');
    this.stats = info.stats; this.inventory = info.inventory; this.meso = info.meso;
    this.player.name = info.stats.name; this.player.id = info.stats.id;
    this.statusBar = new StatusBar(this, uiRoot);
    this.statusBar.layout(VIEW_W, VIEW_H);
    await this.statusBar.load();
    this.windows = new WindowManager(this, this.statusBar);
    await this.windows.load();
    this.vfx = new WorldFx(this);
    await this.vfx.load();
    const wm = this.windows;
    wm.drawItemTip = drawItemTip;
    wm.notice = (text, opts) => new Promise((r) => wm.show(new MessageBox(wm, 'notice', text, r, opts)));
    // another player asking something of you: the metal YesNo2 plate (preloaded, as it may not be in yet)
    wm.request = (text, opts) => new Promise((r) => { const b = new MessageBox(wm, 'request', text, r, opts); this.assets.preload(b.frames()).then(() => wm.show(b)); });
    wm.serverNotice = (text, opts) => new Promise((r) => { const b = new MessageBox(wm, 'server', text, r, opts); this.assets.preload(b.frames()).then(() => wm.show(b)); });
    wm.confirm = (text) => new Promise((r) => wm.show(new MessageBox(wm, 'yesno', text, r)));
    wm.askNumber = (text, def, min, max) => new Promise((r) => wm.show(new MessageBox(wm, 'number', text, r, { def, min, max })));
    wm.askText = (text, def, opts = {}) => new Promise((r) => wm.show(new MessageBox(wm, 'text', text, r, { def, ...opts })));
    Object.assign(wm.wins, { channel: new ChannelWin(wm), gameopt: new GameOptWin(wm), sysopt: new SysOptWin(wm), userlist: new UserListWin(wm), worldmap: new WorldMapWin(wm), questalarm: new QuestAlarmWin(wm), monsterbook: new MonsterBookWin(wm), messenger: new MessengerWin(wm), partysearch: new PartySearchWin(wm), family: new FamilyWin(wm), familytree: new FamilyTreeWin(wm) });
    await this.assets.preload(['channel', 'gameopt', 'sysopt', 'userlist', 'worldmap', 'questalarm', 'monsterbook'].flatMap((k) => wm.wins[k].frames()));
    this.buddies = []; this.party = null; this.partyHpMarks = true; this.guild = null;
    this.assets.json('UI/GuildMark.img').then((m) => { this.guildMarks = m; });
    this.windows.order.push(this.windows.wins.minimap); // the minimap starts open, under every window
    if (wm.wins.questalarm.state.ids.length) wm.open('questalarm');   // and the Quest Helper, when it tracks something
    this.bindUiPointer();
    this.hud = new Hud(uiRoot, this);
    this.hud.update(this.stats);
    this.quests = new QuestBook(this.assets);
    await this.quests.load();
    this.quests.setState(info.quests);
    this.monsterBook = info.book || { cover: 0, cards: {} };
    if (this.net) this.net.selfName = info.stats?.name;   // the merchant room tells owner from visitor by name
    this.skills = new SkillBook(this.assets);
    await this.skills.load(info.stats.job, info.skills, info.cooldowns);
    this.standardPdd(0, 1);   // load the standard defence table before the first blow
    this.rocks = { regular: (info.rocks || []).slice(0, 5), vip: (info.rocks || []).slice(5, 15) };   // Teleport Rock maps
    this.keyBar = this.statusBar; // the quick slots (render() rebuilds them from the keymap)
    const later = (fn) => (...a) => (this.loading ? this.queue.push(() => fn(...a)) : fn(...a));
    const h = this.net.h;
    Object.assign(h, {
      cashShopOpen: (d) => this.openCashShop(d),
      csCash: (c) => this.csWin?.setCash(c),
      csInventory: (items) => this.csWin?.setInventory(items),
      csWish: (sns) => this.csWin?.setWish(sns),
      csBought: (it) => this.csWin?.bought(it),
      csBoughtPackage: (items) => this.csWin?.boughtPackage(items),
      csGifts: (gifts) => this.csWin?.receivedGifts(gifts),
      csGiftSent: (g) => this.csWin?.giftSent(g),
      notes: (notes) => this.showNotes(notes),
      csTaken: (pos, it) => this.csWin?.taken(pos, it),
      csPut: (it) => this.csWin?.put(it),
      csError: (code) => this.csWin?.error(code),
      csSlots: (kind, slots, type) => this.csWin?.slots(kind, slots, type),
      setField: (f) => {
        if (f.hp !== undefined && this.stats) this.stats.hp = f.hp;
        this.changeMap(f.mapId, { portalIdx: f.portal, pos: f.pos });
      },
      stats: (s, enable) => this.onStats(s, enable),
      status: (s) => this.hud.status(s),
      notice: (n) => this.hud.notice(n),
      avatarMega: (a) => this.hud.megaphone([`${a.name} : ${a.lines.filter(Boolean).join(' ')}`], { bg: 'rgba(210, 46, 120, 0.9)', channel: a.channel, ear: a.ear }),
      spouseChat: (from, text) => this.hud.message(`${from ? `${from} : ` : ''}${text}`, CHAT_COLORS.spouse),
      groupChat: (c) => this.hud.message(`${c.name} : ${c.text}`, CHAT_COLORS[GROUP_KEYS[c.mode]] || '#fff'),
      whisper: (w) => this.onWhisper(w),
      whisperResult: (r) => this.onWhisperResult(r),
      findResult: (f) => this.onFindResult(f),
      buddies: (list) => { this.buddies = list; },
      buddyChannel: (id, ch) => { const b = this.buddies.find((x) => x.id === id); if (b) b.channel = ch; },
      buddyCapacity: () => {},
      buddyMessage: (code) => { const t = BUDDY_MESSAGES[code]; if (t) this.windows.notice(t); },
      buddyRequest: (b) => notify(this.windows, 'buddy', b.name)
        .then((ok) => (ok ? this.net.buddyAccept(b.id) : this.net.buddyDelete(b.id))),
      party: (p) => this.onParty(p),
      guild: (d) => this.onGuild(d),
      guildName: (id, name) => { const o = this.others.get(id); if (o) { o.guild = name; if (!name) o.emblem = null; } },
      guildMark: (id, emblem) => { const o = this.others.get(id); if (o) o.emblem = emblem; },
      tradeOpen: (t) => {
        if (this.tradeWin) return;
        const w = this.tradeWin = this.windows.show(new TradeWin(this.windows));
        if (t.partner) w.partnerJoined(t.partner, this.lookFrom(t.look)); else w.say('Waiting for the other player to accept...', '#555');
        this.windows.open('inventory');
      },
      tradeInvite: (name) => notify(this.windows, 'trade', name)
        .then((ok) => (ok ? this.net.tradeAccept() : this.net.tradeDecline())),
      tradePartner: (name, look) => this.tradeWin?.partnerJoined(name, this.lookFrom(look)),
      tradeItem: (side, slot, it) => this.tradeWin?.setItem(side, slot, it),
      tradeMeso: (side, v) => this.tradeWin?.setMeso(side, v),
      tradeConfirm: () => this.tradeWin?.partnerConfirmed(),
      tradeChat: (text) => this.tradeWin?.say(text),
      tradeEnd: (result) => this.tradeWin?.ended(result),
      // player shops
      shopOpen: later(async (d) => {
        this.playerShop?.end();
        const win = new PlayerShopWin(this.windows, d);
        await this.assets.preload(win.frames());      // its art the first time a shop opens
        this.playerShop = this.windows.show(win);
      }),
      shopItems: later((items, mesos) => this.playerShop?.setItems(items, mesos)),
      merchantCheck: later((code) => this.onMerchantCheck(code)),
      messenger: later((e) => this.onMessenger(e)),
      family: later((e) => this.onFamily(e)),
      shopSold: later((i, qty, buyer) => this.playerShop?.soldUpdate(i, qty, buyer)),
      shopVisitor: later((slot, name, look) => this.playerShop?.visitor(slot, name, look)),
      shopChat: later((slot, text) => this.playerShop?.say(text)),
      shopLeft: later((slot) => this.playerShop?.left(slot)),
      shopClosed: later((reason) => this.playerShop?.end(reason)),
      shopError: later((code) => { this.playerShop?.end(); this.windows.notice(SHOP_ERRORS[code] || 'The shop could not be opened.'); }),
      merchantSpawn: later((m) => this.boards.spawn(m)),
      merchantUpdate: later((owner, info) => this.boards.update(owner, info)),
      merchantRemove: later((owner) => this.boards.remove(owner)),
      duey: later((e) => this.onDuey(e)),
      chalkboard: later((id, text) => { const ent = id === this.player.id ? this.player : this.others.get(id); if (ent) ent.chalk = text; }),
      rocks: (vip, list) => { if (this.rocks) this.rocks[vip ? 'vip' : 'regular'] = list; },
      rockError: () => this.windows.notice('The map could not be saved.'),
      charBox: later((id, box) => { const ent = id === this.player.id ? this.player : this.others.get(id); if (ent) ent.box = box; }),
      tradeError: (code) => { this.tradeWin?.ended(0); this.windows.notice(TRADE_ERRORS[code] || 'The trade could not be started.'); },
      charInfo: (i) => { if (this.infoWin) this.windows.close(this.infoWin); this.infoWin = this.windows.show(new CharInfoWin(this.windows, i)); },
      // a Party Search invitation comes as "PS: <leader>"
      partyInvite: (p) => (p.name.startsWith('PS: ') ? notify(this.windows, 'partySearch', p.name.slice(4)) : notify(this.windows, 'party', p.name))
        .then((ok) => (ok ? this.net.partyOp(3, p.id) : this.net.partyDeny(p.name))),
      partyMessage: (code, name) => { const t = PARTY_MESSAGES[code]; if (t) this.hud.message(t.replace('%s', name), CHAT_COLORS.notice); },
      partyHp: (id, hp, maxHp) => { const m = this.party?.members.find((x) => x.id === id); if (m) Object.assign(m, { hp, maxHp }); },
      chat: later((c) => this.onChat(c)),
      spawnPlayer: later((d) => this.spawnPlayer(d)),
      clock: later((secs) => { this.clock = secs === null ? null : { end: performance.now() + secs * 1000 }; if (secs !== null) this.loadClockArt(); }),
      fieldClock: later((h, m, s) => { this.fieldClock = { secs: h * 3600 + m * 60 + s, at: performance.now() }; this.loadClockArt(); }),
      ship: later((here) => this.moveShip(here)),
      mistSpawn: later((d) => this.addMist(d)),
      mistRemove: later((oid) => this.mists?.delete(oid)),
      doorSpawn: later((d) => {
        this.addDoor(d.owner, d.x, d.y, false, d.launched);
      }),
      doorRemove: later((owner) => this.doors?.delete(owner)),
      townPortal: later((from, to, pos) => {
        // a Mystic Door's record, pointing at its other end. Out in the field (to = this map's town) SPAWN_DOOR
        // draws the door; in town the door stands on the town's door portal (type 6) - the first one for you alone
        if (from === 999999999 || !pos) { for (const [k, d] of this.doors || []) if (d.town) this.doors.delete(k); return; }
        if (from !== this.map?.id || to === this.map.info?.returnMap) return;
        const tp = this.map.portals.find((q) => q.pt === 6);
        if (tp) this.addDoor('town', tp.x, tp.y, true, true, to);
      }),
      showChair: later((id, itemId) => { const rp = this.others.get(id); if (rp) rp.chair = itemId; if (itemId) this.chairArt(itemId); }),
      cancelChair: later((seat) => { if (seat < 0 && this.player.seat) this.standUp(false); }),
      removePlayer: later((id) => { this.others.delete(id); for (const [k, p] of this.pets) if (p.owner === id) this.pets.delete(k); }),
      petSpawn: later((d) => this.addPet(d)),
      petRemove: later((owner, slot, hunger) => {
        this.pets.delete(`${owner}:${slot}`);
        if (owner === this.player.id && hunger) this.windows.notice('Your pet went back home because it was hungry.');
      }),
      petMove: later((owner, slot, moves) => this.pets.get(`${owner}:${slot}`)?.applyMovement(moves)),
      petChat: later((owner, slot, act, text) => this.pets.get(`${owner}:${slot}`)?.say(text)),
      petCommand: later((owner, slot, cmd, ok) => this.petAnswer(this.pets.get(`${owner}:${slot}`), 'interact', cmd, ok)),
      petFood: later((owner, slot, ok) => this.petAnswer(this.pets.get(`${owner}:${slot}`), 'food', null, ok)),
      movePlayer: later((id, moves) => this.others.get(id)?.applyMovement(moves)),
      playerLook: later((id, look) => this.updateOtherLook(id, look)),
      attack: later((a) => this.onRemoteAttack(a)),
      expression: later((id, emote) => { const rp = this.others.get(id); if (rp) setExpression(rp, emote); }),
      scrollEffect: later((e) => this.onScrollEffect(e)),
      bookCard: later((id, count) => {
        const b = this.monsterBook;
        if (count > (b.cards[id] || 0)) { b.cards[id] = count; sfx.play('Game/mCardGet'); this.hud.message(`You have obtained a card: ${this.windows.itemName(id)} (${count}/5)`, '#9fe07a'); this.vfx?.play('MonsterBook', this.player); }
        else this.hud.message('That card is already full in your Monster Book.', '#fff');
      }),
      bookCover: later((id) => { this.monsterBook.cover = id; }),
      macros: later((list) => { this.macros = Array.from({ length: 5 }, (_, i) => list[i] || { name: '', shout: false, skills: [0, 0, 0] }); this.statusBar?.render(); }),
      summonSpawn: later((d) => { this.summons.get(d.oid)?.die(); this.summons.set(d.oid, new Summon(this, d)); }),
      summonRemove: later((owner, oid, animated) => { const sm = this.summons.get(oid); if (!sm) return; if (animated) sm.die(); else this.summons.delete(oid); }),
      summonMove: later((owner, oid, moves) => this.summons.get(oid)?.applyMovement(moves)),
      summonAttack: later((owner, oid, dir, hits) => {
        const sm = this.summons.get(oid);
        if (!sm || sm.mine) return;
        sm.facingRight = !(dir & 4); sm.play('attack1');
        this.after(sm.node?.attack1?.info?.attackAfter || 300, () => {
          for (const h of hits) { const m = this.lifeByOid.get(h.mob); if (m) this.summonHit(sm, m, [h.dmg], false); }
        });
      }),
      summonDamaged: later((owner, oid) => this.summons.get(oid)?.play('hit')),
      summonSkill: later((owner, skill, stance) => {
        for (const sm of this.summons.values()) if (sm.owner === owner && sm.skill === skill) sm.play(`skill${(stance & 0x7f) || 1}`);
      }),
      playerDamaged: later((d) => this.onPlayerDamaged(d)),
      // damage the server deals by itself (Heaven's Hammer...): its number over the monster
      mobDamaged: later((oid, dmg) => { const m = this.lifeByOid.get(oid); if (m && !m.pending) this.vfx?.damage(m, [dmg], 'red'); }),
      spawnMob: later((m) => this.spawnLife('Mob', m, false)),
      controlMob: later(async (m, aggro) => {
        let e = this.lifeByOid.get(m.oid);
        if (e && !e.pending) e.controlled = true; else { await this.spawnLife('Mob', m, true); e = this.lifeByOid.get(m.oid); }
        if (e && !e.pending && m.statuses) this.applyMobStatus(e, m.statuses);   // what it was already under
        if (aggro && e && !e.pending) e.chase(this.player);      // the server wants it after us
      }),
      stopControl: later((oid) => { const e = this.lifeByOid.get(oid); if (e) { e.controlled = false; e.aggro = null; } }),
      reactorSpawn: later((d) => this.spawnReactor(d)),
      mobSkillOffer: later((oid, skill, level) => { const e = this.lifeByOid.get(oid); if (e && !e.pending && e.controlled && skill) e.nextSkill = { skill, level }; }),
      disease: later((d) => this.onDisease(d)),
      healNumber: later((id, amount) => { const ent = id === null ? this.player : this.others.get(id); if (ent && amount > 0) this.vfx?.damage(ent, [amount], 'blue'); }),
      foreignDisease: later((id, d) => this.onForeignDisease(id, d)),
      foreignCancel: later((id, m1, m2) => {
        const rp = this.others.get(id);
        if (rp?.diseases) rp.diseases = rp.diseases.filter((x) => !((x.m1 & m1) || (x.m2 & m2)));
        if (rp && BigInt.asUintN(64, BigInt(m2)) & COMBO_MASK) rp.combo = 0;
        if (rp && (BigInt.asUintN(64, BigInt(m2)) & DS_MASK || BigInt.asUintN(64, BigInt(m1)) & WW_MASK)) rp.hidden = false;
      }),
      foreignHidden: later((id) => { const rp = this.others.get(id); if (rp) rp.hidden = true; }),
      foreignCombo: later((id, value) => { const rp = this.others.get(id); if (rp) rp.combo = value; }),
      mobStatus: later((oid, s) => { const e = this.lifeByOid.get(oid); if (e && !e.pending) this.applyMobStatus(e, s); }),
      mobStatusCancel: later((oid, first, second) => { const e = this.lifeByOid.get(oid); if (e && !e.pending) e.removeStatus(first, second); }),
      reactorHit: later((d) => { const r = this.reactors?.get(d.oid); if (r) r.setState(d.state); }),
      reactorDestroy: later((d) => { const r = this.reactors?.get(d.oid); if (r) r.destroy(d.state); }),
      moveMob: later((oid, start, moves, act, skill, level) => {
        const e = this.lifeByOid.get(oid);
        if (!e || e.pending || e.controlled) return;
        e.applyMovement(start, moves);
        // activity (12 + attack) * 2 + facing: its controller made it attack
        if (act >= 24 && act <= 41) { e.facingRight = !(act & 1); e.playAttack((act - 24) >> 1); }
        else if (act >= 42 && act <= 59 && skill) { e.facingRight = !(act & 1); e.playSkill(skill, level); }
      }),
      killMob: later((oid, anim) => this.killLife(oid, anim)),
      // one other monsters can hurt: its red bar follows the HP the server sends
      mobDamaged: later((oid, dmg, hp, maxHp) => {
        const e = this.lifeByOid.get(oid);
        if (e && !e.pending && maxHp > 0 && Number(e.src?.info?.damagedByMob)) { e.hp = Math.round((e.maxHp * hp) / maxHp); e.hpPct = Math.floor((hp * 100) / maxHp); }
      }),
      mobHp: later((oid, pct) => { const e = this.lifeByOid.get(oid); if (e && !e.pending) { e.hp = Math.round((e.maxHp * pct) / 100); e.hpPct = pct; e.hpShownUntil = performance.now() + 5000; } }),
      bossHp: later((d) => this.vfx?.bossHp(d)),
      foreignEffect: later((chrId, effect) => { const rp = this.others.get(chrId), name = this.vfx?.foreign(effect); if (rp && name) this.vfx.play(name, rp); }),
      spawnNpc: later((n) => this.spawnLife('Npc', n, false)),
      removeNpc: later((oid) => this.killLife(oid, 0)),
      drop: later((d) => this.spawnDrop(d)),
      removeDrop: later((oid, anim, chr, petSlot) => this.removeDrop(oid, anim, chr, petSlot)),
      inventory: (ops) => this.onInventory(ops),
      npcTalk: (d) => this.showNpcDialog(d),
      shop: (s) => { if (this.shopWin) this.windows.close(this.shopWin); this.shopWin = this.windows.show(new ShopWin(this.windows, s)); },
      shopResult: (code) => this.shopWin?.result(code),
      storageOpen: (s) => {
        if (this.storageWin) this.windows.close(this.storageWin);
        this.storageWin = this.windows.show(new StorageWin(this.windows, s));
      },
      storageItems: (type, items) => this.storageWin?.setType(type, items),
      storageAll: (items) => this.storageWin?.setAll(items),
      storageMeso: (meso) => this.storageWin?.setMeso(meso),
      storageError: (code) => this.storageWin?.error(code),
      quest: (id, status, data) => this.onQuest(id, status, data),
      keymap: (km) => { this.keymap = km; this.dropForeignSkillKeys(); this.keyBar.render(); this.skillWin?.render(); },
      skills: (list) => {
        for (const s of list) {
          const before = this.skills.level(s.id);
          this.skills.setLevel(s.id, s);
          if (s.level > before) this.hud.message(`${this.skills.name(s.id)} is now level ${s.level}.`, '#9fd3ff');
        }
        this.skillWin?.render(); this.keyBar.render();
      },
      knowsSkill: (id) => this.skills.level(id) > 0,
      cooldown: (id, sec) => { if (sec) this.skills.cooldowns[id] = Date.now() + sec * 1000; else delete this.skills.cooldowns[id]; },
      buff: (b) => {
        this.buffs = this.buffs.filter((x) => x.source !== b.source);
        this.buffs.push({ source: b.source, until: Date.now() + b.duration, dur: b.duration, m1: b.m1, m2: b.m2, hbHp: b.hbHp, hbMp: b.hbMp, sharpEyes: b.sharpEyes, speed: b.speed, jump: b.jump,
          watk: b.watk, acc: b.acc, mapleWarrior: b.mapleWarrior, combo: b.combo, stance: b.stance, wdef: b.wdef, mdef: b.mdef, avoid: b.avoid });
      },
      cancelBuff: (m1, m2) => {
        this.buffs = this.buffs.filter((b) => !((b.m1 & m1) || (b.m2 & m2)));
        this.diseases = (this.diseases || []).filter((d) => !((d.m1 & m1) || (d.m2 & m2)));
      },
      affected: later((chrId, skillId) => {
        const ent = chrId === null ? this.player : this.others.get(chrId);
        if (ent) this.playSkillEffect(skillId, ent, false, 'affected');
      }),
      foreignSkill: later((chrId, skillId) => {
        const rp = this.others.get(chrId);
        if (!rp) return;
        rp.charge = null;
        if (TELEPORTS.has(skillId)) this.playTeleportEffect(rp.x, rp.y);   // its art is BasicEff's, not the skill's
        else this.playSkillEffect(skillId, rp);
      }),
      // a skill being charged or wound up: they stand in its prepare pose, with its keydown art, until it goes off
      foreignCharge: later(async (chrId, skillId) => {
        const rp = this.others.get(chrId), node = await this.skills?.ensure(skillId);
        if (!rp || !node) return;
        const charge = { id: skillId, pose: node.prepare?.action || 'alert', until: performance.now() + 2000 };
        rp.charge = charge;
        if (node.keydown) this.loopSkillEffect(skillId, rp, 'keydown', () => rp.charge === charge && this.others.get(chrId) === rp);
        if (frames(node.prepare).length) this.playSkillEffect(skillId, rp, false, 'prepare');
      }),
      foreignSkillCancel: later((chrId) => { const rp = this.others.get(chrId); if (rp) rp.charge = null; }),
      questResult: (r) => {
        if (!r.ok) this.hud.message(QUEST_ERRORS[r.mode] || 'The quest could not be updated.', '#ff8080');
      },
      disconnected: () => this.windows.notice('The connection to the server was closed.').then(() => location.reload()),
    });
    const loaded = this.changeMap(entered.mapId, { portalIdx: entered.portal });
    this.net.flush(); // buffered spawns queue up behind the map load
    await loaded;
    // logged off (or dropped) while dead: the server kept the 0 HP, so come back as the ghost, still to be revived
    if (this.stats.hp <= 0 && !this.dead) this.die();
  }

  onQuest(id, status, data) {
    const before = this.quests.status(id);
    const prevProgress = this.quests.started[id];
    this.quests.update(id, status, data);
    const name = this.quests.name(id);
    if (status === 1 && before === 0) { this.hud.message(`Quest started: ${name}`, '#9fe07a'); this.windows.wins.questalarm?.started(id); }
    else if (status === 2 && before !== 2) { this.hud.message(`Quest complete: ${name}`, '#ffe08a'); this.vfx?.play('QuestClear', this.player); sfx.play('Game/QuestClear'); }
    else if (status === 0 && before === 1) this.hud.message(`Quest forfeited: ${name}`, '#ff9e9e');
    else if (status === 1 && prevProgress !== data) {
      for (const m of this.quests.mobProgress(id)) if (m.have <= m.need) this.hud.message(`${name}: ${m.have} / ${m.need}`, '#c8e6ff');
    }
    this.questWin?.render();
  }

  toggleQuests() {
    if (!this.quests) return;
    this.windows.toggle('quest');
  }

  itemCount(id) {
    const t = invType(id);
    let n = 0;
    for (const it of Object.values(this.inventory?.[t] || {})) if (it.id === id) n += it.quantity ?? 1;
    return n;
  }

  /** Context for quest checks and NPC text (#c item counts). */
  textCtx() {
    const bookCards = Object.values(this.monsterBook?.cards || {}).filter((n) => n > 0).length;
    return { stats: this.stats, meso: this.meso, itemCount: (id) => this.itemCount(id), bookCards };
  }

  /** Click on an NPC: offer its quests first when it has any (as the v83 client does), else run its script. */
  interactNpc(npc) {
    const q = this.quests?.npcQuests(npc.spawn.id, this.textCtx());
    if (q && (q.start.length || q.complete.length || q.progress.length)) npcQuestMenu(this, npc, q);
    else this.net.npcTalk(npc.oid, { x: Math.round(npc.x), y: Math.round(npc.y) });
  }

  onStats(s, enable) {
    if (!this.stats) return;
    const before = this.stats.level;
    Object.assign(this.stats, s);
    if (s.meso !== undefined) this.meso = s.meso;
    if (s.level > before) { this.hud.message(`Level up! You are now level ${s.level}.`, '#ffe08a'); this.levelUpEffect(); sfx.play('Game/LevelUp'); }
    if (s.job !== undefined && this.skills && s.job !== this.skills.job) {
      this.hud.message('Your job has changed! New skills are available.', '#ffe08a');
      this.vfx?.play('JobChanged', this.player); sfx.play('Game/JobChanged');
      this.skills.loadJob(s.job).then(() => this.skillWin?.render());
    }
    if (s.sp !== undefined || s.level !== undefined) this.skillWin?.render();
    if (this.stats.hp <= 0 && !this.dead) this.die();
    if (this.stats.hp > 0) this.dead = false;
    this.hud.update(this.stats);
  }

  async die() {
    this.dead = true;
    const p = this.player;
    p.action = 'dead'; p.frame = 0; p.frameT = 0; p.attack = null; p.seat = null;   // the character turns into its ghost
    // the tombstone drops onto the body first, then the client asks
    this.vfx?.tomb(this.player); sfx.play('Game/Tombstone');
    await new Promise((r) => setTimeout(r, 1500));
    await new Promise((done) => {   // the client's own death notice (UIWindow.img/Notice/0), high and clear of the ghost
      const w = new DeathNotice(this.windows, done);
      this.assets.preload(w.frames()).then(() => this.windows.show(w));
    });
    this.net.respawn();
  }

  levelUpEffect() { this.vfx?.play('LevelUp', this.player); }

  // ------------------------------------------------------------------ map
  async changeMap(id, { portal = null, portalIdx = null, pos = null } = {}) {
    if (this.loading && this.loadingId === id) return;
    // A newer SET_FIELD can arrive while a map is still loading: only the latest load wins.
    const seq = this.loadSeq = (this.loadSeq || 0) + 1;
    const current = () => seq === this.loadSeq;
    this.loading = true; this.loadingId = id;
    // the old map fades to black while the new one loads; the loading screen only shows if that takes a while
    this.fadeOut();
    const fadeStart = this.fade.t0;
    let status = `Loading map ${id}...`, slow = false;
    const slowTimer = setTimeout(() => { if (current()) { slow = true; this.hooks.onLoading?.(true, status); } }, 1500);
    try {
      const map = new GameMap(this.assets, id);
      await Promise.all([
        map.load((s) => { status = s; if (slow && current()) this.hooks.onLoading?.(true, s); }, { life: !this.net }),
        new Promise((r) => setTimeout(r, Math.max(0, FADE_MS - (performance.now() - fadeStart)))),
      ]);
      if (!current()) return;
      this.map = map;
      this.charging = null;   // a skill being charged doesn't carry over
      this.keydown = null;
      this.rush = null;
      this.fade = { dir: 'in', t0: performance.now() };
      this.vfx?.mapChanged();
      this.others.clear(); this.drops.clear(); this.lifeByOid.clear(); this.pets.clear(); this.summons.clear(); this.boards.clear(); this.reactors?.clear();
      this.doors?.clear(); this.mists?.clear(); this.clock = null; this.fieldClock = null;
      this.mapEnteredAt = performance.now(); this.setupShip();
      if (pos) this.placeAt(pos.x, pos.y);
      else this.placeAtPortal(portalIdx !== null ? map.portalById(portalIdx) : map.spawnPortal(portal));
      this.snapCamera();
      if (!this.net) history.replaceState(null, '', `?map=${id}`);
      this.hooks.onMap?.(map);
      this.hud?.setMap(map);
      music.play(map.info.bgm);
      this.net?.mapLoaded();
    } catch (e) {
      console.error(e);
      if (current()) this.hooks.onError?.(e.message);
    } finally {
      clearTimeout(slowTimer);
      if (!current()) return; // eslint-disable-line no-unsafe-finally
      this.loading = false;
      if (this.fade?.dir === 'out') this.fade = { dir: 'in', t0: performance.now() };   // a failed load still lights up again
      this.hooks.onLoading?.(false);
      const q = this.queue; this.queue = [];
      for (const fn of q) fn();
    }
  }

  placeAtPortal(portal) { this.placeAt(portal.x, portal.y - 10); }

  placeAt(x, y) {
    const p = this.player;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.ladder = null; p.seat = null;
    p.fh = this.map.fh.below(p.x, p.y, 400);
    if (p.fh) p.y = Footholds.yAt(p.fh, p.x);
    this.moveBuf = []; this.lastSent = null;
  }

  // ------------------------------------------------------------------ server entities
  async spawnLife(kind, d, controlled) {
    const map = this.map;
    // a new spawn is followed straight away by its control packet (not marked new): keep the mark across both
    const entry = { pending: true, newSpawn: d.newSpawn || !!this.lifeByOid.get(d.oid)?.newSpawn };
    this.lifeByOid.set(d.oid, entry);
    const spawn = kind === 'Npc'
      ? { id: d.id, oid: d.oid, x: d.x, cy: d.y, f: d.facingRight ? 1 : 0, fh: d.fh, rx0: d.rx0, rx1: d.rx1 }
      : { id: d.id, oid: d.oid, x: d.x, cy: d.y, f: d.stance & 1 ? 0 : 1, fh: d.fh, rx0: -Infinity, rx1: Infinity };
    const e = await map.createLife(kind, spawn);
    if (!e || this.map !== map || this.lifeByOid.get(d.oid) !== entry) return;
    if (kind === 'Mob') { e.y = d.y; e.facingRight = !(d.stance & 1); }
    e.controlled = controlled;
    if (kind === 'Mob') {
      e.onAttack = (m, a, spots) => this.mobAttackStart(m, a, spots); e.onAttackLand = (m, a, spots) => this.mobAttackLand(m, a, spots);
      e.onSkill = (m, s) => this.mobSkillStart(m, s);
      // one we control tells the server each path it plans, as it starts on it
      e.onPath = (m, start, moves) => { if (m.controlled && !m.dying) this.net?.moveMob(m.oid, start, moves); };
    }
    if (entry.newSpawn) { e.appear(); if (kind === 'Mob') sfx.play(`Mob/${pad(Number(d.id), 7)}/Regen`); }
    this.lifeByOid.set(d.oid, e);
    map.life.push(e);
  }

  killLife(oid, anim) {
    const e = this.lifeByOid.get(oid);
    this.lifeByOid.delete(oid);
    if (!e || e.pending) return;
    // the server says it died the moment our attack went out; let the swing (or shot) land first
    if (e.pendingHits > 0) {
      e.queuedKill = { anim };
      (this.dying ??= new Map()).set(oid, e);
      this.after(1500, () => { if (e.queuedKill) this.finishKill(e); });   // in case a shot never arrives
      return;
    }
    this.finishKill(e, anim);
  }
  finishKill(e, anim = e.queuedKill?.anim) {
    e.queuedKill = null;
    this.dying?.delete(e.oid);
    this.releaseDrops(e);
    if (anim && e.kind === 'Mob') sfx.play(`Mob/${pad(Number(e.spawn.id), 7)}/Die`);
    if (e.kind === 'Mob' && Number(e.spawn.id) === this.vfx?.boss?.oid) this.vfx.boss = null; // the gauge goes with its boss
    if (anim && e.anims.die1) e.kill(); else e.removed = true;
  }

  async spawnPlayer(d) {
    if (d.id === this.player?.id) return;   // the server can spawn you to yourself (a job change): you're already here
    const look = new CharacterLook(this.assets, { skin: d.look.skin, face: d.look.face, hair: d.look.hair, equips: visibleEquips(d.look) });
    await look.load();
    await this.assets.preload(lookCanvases(look, ['stand1', 'stand2', 'walk1', 'walk2', 'jump']));
    if (!this.map) return;
    const rp = new RemotePlayer(d, look);
    rp.box = d.box; rp.chalk = d.chalk; rp.chair = d.chair || 0; rp.combo = d.combo || 0; rp.hidden = !!d.hidden;
    if (rp.chair) this.chairArt(rp.chair);
    this.others.set(d.id, rp);
    for (const p of d.pets || []) this.addPet({ owner: d.id, ...p });
  }

  async updateOtherLook(id, lookData) {
    const rp = this.others.get(id); if (!rp) return;
    const look = new CharacterLook(this.assets, { skin: lookData.skin, face: lookData.face, hair: lookData.hair, equips: visibleEquips(lookData) });
    await look.load();
    rp.look = look;
  }

  onChat(c) {
    const ent = c.id === this.player.id ? this.player : this.others.get(c.id);
    const name = ent?.name || '?';
    if (ent) ent.chat = { text: c.text, t: 5 };
    this.hud.message(`${name} : ${c.text}`, '#fff');      // general chat is white, a GM's too
  }

  /**
   * Another player's attack, timed like ours: their animation runs at the speed in the packet and the
   * hits land after the pose's attack delay, with the monster's death and loot held until then.
   */
  onRemoteAttack(a) {
    const rp = this.others.get(a.id);
    let delay = 0;
    if (rp) {
      rp.attack = this.actionName(a.stance); rp.facingRight = !(a.direction & 0x80);
      rp.frame = 0; rp.frameT = 0; rp.action = rp.attack;
      rp.attackScale = this.attackScale(a.speed >= 2 && a.speed <= 9 ? a.speed : 6);
      if (a.skill) this.playSkillEffect(a.skill, rp, a.kind !== 'magic'); else this.playWeaponSound(rp);
      delay = rp.look.attackDelay(rp.attack) * rp.attackScale;
      if (SHAKERS.has(a.skill)) this.startShake(a.skill, 400 - Math.min(400, Math.hypot(rp.x - this.player.x, rp.y - this.player.y)), delay);
    }
    // only a spell with a ball is shot; one without lands where it is
    const ball = a.kind === 'magic' && a.skill && this.skills ? this.skills.ensure(a.skill).then((n) => !!n?.ball) : Promise.resolve(false);
    const plan = rp && a.kind === 'ranged' && !BOX_SHOTS.has(a.skill) && this.skills
      ? (a.skill ? this.skills.ensure(a.skill) : Promise.resolve()).then(() => {
        const ld = a.skill ? this.skills.levelData(a.skill, a.skillLevel) : null;
        const mobs = a.targets.map((t) => this.lifeByOid.get(t.oid)).filter((e) => e && !e.pending);
        const shot = this.shotPlan(rp, a.skill, a.skillLevel, ld, ld?.range || 400, 0, mobs);
        this.shotFx(shot, rp, a.skill, ld, a.projectile, delay);
        return shot;
      })
      : Promise.resolve(null);
    Promise.all([ball, plan]).then(([hasBall, plan]) => {
      const shoots = rp && (a.kind === 'ranged' || hasBall);
      let order = a.targets;
      // a swing's hits go through the monsters from one end, starting on the side where they lie
      if (!shoots && a.kind !== 'magic' && rp && a.skill !== BAND_OF_THIEVES && a.skill !== SPARK) {
        const x = (t) => this.lifeByOid.get(t.oid)?.x ?? rp.x;
        const dir = order.reduce((sum, t) => sum + x(t) - rp.x, 0) > 0 ? 1 : -1;
        order = [...order].sort((p, q) => (x(p) - x(q)) * dir);
      }
      for (const [i, t] of order.entries()) {
        const e = this.lifeByOid.get(t.oid);
        if (!e || e.pending) continue;
        e.pendingHits = (e.pendingHits || 0) + 1;
        const land = () => {
          e.hit(t.dmg.reduce((s, x) => s + x, 0), !!rp && rp.x < e.x);
          this.damageNumbers(e, t.dmg, false, a.skill, t.crit, ...this.lineTiming(rp));
          this.playHitEffect(a.skill, e, rp, t.dmg);
          if (--e.pendingHits <= 0) { if (e.queuedKill) this.after(lineDelay(a.skill, t.dmg.length - 1, ...this.lineTiming(rp)), () => this.finishKill(e)); else this.releaseDrops(e); }
        };
        const planned = plan?.targets.find((p) => p.mob === e);
        if (planned) this.after(delay + planned.delay, land);
        else if (shoots) this.after(delay, () => this.shoot(a.skill, rp, e, a.projectile, land)); else this.after(delay + hitWave(i, a.kind, a.skill, true), land);
      }
    });
  }

  onPlayerDamaged(d) {
    const rp = this.others.get(d.id);
    if (rp) this.vfx?.damage(rp, [d.damage], 'violet');
    if (rp && d.damage > 0) setExpression(rp, 1, HIT_FACE_TIME);
    if (rp && d.from >= 0 && d.mobId) sfx.play(`Mob/${pad(d.mobId, 7)}/CharDam${d.from + 1}`);
  }

  /** Drops a monster let go of while our blow was still on its way: they come out as it dies. */
  releaseDrops(e) {
    const held = e.heldDrops;
    e.heldDrops = null;
    for (const d of held || []) this.spawnDrop(d);
  }
  async spawnDrop(d) {
    // the server drops loot as soon as it counts the kill; hold it until our hit lands and it dies
    const src = this.lifeByOid.get(d.dropper) || this.dying?.get(d.dropper);
    if (src && !src.pending && (src.pendingHits > 0 || src.queuedKill)) { (src.heldDrops ??= []).push(d); return; }
    // the server announces a player's drop twice (mode 1, then 0): keep the first, even while its icon loads
    const pending = (this.pendingDrops ??= new Set());
    if (this.drops.has(d.oid) || pending.has(d.oid)) return;
    pending.add(d.oid);
    let node = d.meso ? await mesoIcon(this.assets, d.id) : await itemIcon(this.assets, d.id, true);
    if (d.meso && node) node = mesoTiming(node, d.id);
    const anim = new Anim(node || null);
    await this.assets.preload(anim.frames);
    if (!this.map) return;
    const fh = this.map.fh.below(d.x, d.y - 40, 200);
    const y = fh ? Footholds.yAt(fh, d.x) : d.y;
    const fromX = d.fromX ?? d.x, fromY = d.fromY ?? y;
    pending.delete(d.oid);
    // a fresh drop sounds as it appears (not one already lying there), at most once every 300ms
    if (d.mode !== 2 && performance.now() - (this.dropSoundAt || 0) > 300) { this.dropSoundAt = performance.now(); sfx.play('Game/DropItem'); }
    const thrown = !d.meso && (d.dropper === this.player.id || this.others.has(d.dropper));   // dropped by a character, not a monster
    // launch speed for the hop height (Y = Ys - V t + 400 t^2 peaks at V^2/1600); the flight lasts until it is back at its
    // starting height, or until it comes down on a higher floor
    const speed = Math.sqrt(1600 * (thrown ? THROW_HOP : DROP_HOP)), sy = fromY - 4;
    const up = sy - y, flight = up > 0 && up < speed * speed / 1600 ? (speed + Math.sqrt(speed * speed - 1600 * up)) / 800 : speed / 400;
    this.drops.set(d.oid, { ...d, y, anim, landed: d.mode === 2, age: 0, cx: fromX, cy: sy, fromY: sy, alpha: 1, phase: Math.random() * 6,
      spin: thrown, angle: 0, speed, flight });
  }

  removeDrop(oid, anim, chr, petSlot = -1) {
    const d = this.drops.get(oid);
    if (!d) return;
    const pet = anim === 5 && this.pets.get(`${chr}:${petSlot}`);
    if (pet) { if (chr === this.player.id) sfx.play('Game/PickUpItem'); this.pickUp(d, pet); return; }
    if (anim === 2) {
      const target = chr === this.player.id ? this.player : this.others.get(chr);
      if (chr === this.player.id) sfx.play('Game/PickUpItem');
      if (target) { this.pickUp(d, target); return; }
    }
    this.drops.delete(oid);
  }

  onInventory(ops) {
    const inv = this.inventory;
    let lookChanged = false;
    const box = (t, pos) => (pos < 0 ? inv.equipped : inv[t]);
    for (const op of ops) {
      if (op.mode === 0) box(op.inv, op.pos)[op.pos] = { ...op.item, pos: op.pos };
      else if (op.mode === 1) { const it = box(op.inv, op.pos)[op.pos]; if (it) it.quantity = op.quantity; }
      else if (op.mode === 2) {
        const from = box(op.inv, op.pos), to = box(op.inv, op.to);
        const a = from[op.pos], b = to[op.to];
        if (b) from[op.pos] = b; else delete from[op.pos];
        if (a) to[op.to] = a; else delete to[op.to];
        if (op.pos < 0 || op.to < 0) lookChanged = true;
      } else if (op.mode === 3) { delete box(op.inv, op.pos)[op.pos]; if (op.pos < 0) lookChanged = true; }
    }
    if (lookChanged) this.rebuildLook();
    this.hud.renderInventory();
    this.questWin?.render();
  }

  async rebuildLook() {
    const s = this.stats;
    const look = new CharacterLook(this.assets, { skin: s.skin, face: s.face, hair: s.hair, equips: equippedIds(this.inventory.equipped) });
    await look.load();
    await this.assets.preload(lookCanvases(look, PRELOAD_ACTIONS));
    this.look = look;
    this.assets.preload(lookCanvases(look, look.actionList())); // skill animations, in the background
  }

  /**
   * Max HP / MP as the client shows them (Character.recalcLocalStats): base + equipment, then
   * Hyper Body's percentage, capped at 30000. The server's MAXHP / MAXMP stats are only the base.
   */
  maxHpShown() { return this.shownMax('maxHp', 'hp', 'hbHp'); }
  maxMpShown() { return this.shownMax('maxMp', 'mp', 'hbMp'); }
  shownMax(stat, equipKey, buffKey) {
    const s = this.stats;
    if (!s) return 0;
    let max = s[stat] || 0;
    for (const it of Object.values(this.inventory?.equipped || {})) max += it[equipKey] || 0;
    const now = Date.now();
    const pct = Math.max(0, ...this.buffs.filter((b) => b.until > now && b[buffKey]).map((b) => b[buffKey]));
    if (pct) max += Math.floor((pct / 100) * max);
    return Math.min(30000, max);
  }

  watk() {
    let w = 0;
    for (const it of Object.values(this.inventory?.equipped || {})) w += it.watk || 0;
    return w;
  }

  /** Character.calculateMaxBaseDamage, so damage stays inside the server's sanity checks. */
  maxDamage(pose = null) {
    const s = this.stats, weapon = this.inventory?.equipped[-11];
    const cat = Math.floor((weapon?.id || 0) / 10000) % 100, thiefDagger = cat === 33 && Math.floor(s.job / 100) === 4;
    const mult = thiefDagger ? 3.6 : weaponMultiplier(weapon?.id, pose);   // a thief's dagger counts for less
    if (!mult) return 1;
    let main = s.str, sec = s.dex;
    if (cat === 45 || cat === 46 || cat === 49) { main = s.dex; sec = s.str; }
    else if (cat === 47 || thiefDagger) { main = s.luk; sec = s.dex + s.str; }
    return Math.max(1, Math.ceil(((mult * main + sec) / 100) * this.watk()));
  }

  useInventoryItem(tab, slot, it) {
    if (tab === 5 && it.pet) { this.net.spawnPet(slot); return; }        // summon / send the pet home
    if (tab === 5 && Math.floor(it.id / 10000) === 514) { this.openShop(it.id); return; }      // a Shop Permit
    if (tab === 5 && Math.floor(it.id / 10000) === 503) { this.openMerchant(it.id); return; }   // a Hired Merchant
    if (tab === 5 && (Math.floor(it.id / 10000) === 507 || Math.floor(it.id / 10000) === 539)) { this.openMegaphone(slot, it.id); return; }
    if (tab === 5 && Math.floor(it.id / 10000) === 504) { this.openRock(slot, it.id); return; }          // a Teleport Rock
    if (tab === 5 && Math.floor(it.id / 10000) === 537) { this.openChalkboard(slot, it.id); return; }    // a Chalkboard
    if (tab === 3 && Math.floor(it.id / 10000) === 301) { this.sitChair(it.id); return; }        // a chair
    if (tab === 2 && isPetFood(it.id)) { this.feedPet(slot, it.id); return; }
    if (tab === 2 && isScroll(it.id)) {
      // a scroll is put on an item, not used: pick it up and show what you wear
      this.windows.startCarry({ kind: 'item', tab: 2, slot, id: it.id, sticky: true, x: -99, y: -99, at: 0 }, this.windows.icon(it.id));
      this.windows.open('equip');
      this.hud.message('Click the equipped item to use the scroll on.', '#fff');
      return;
    }
    if (tab === 2) { this.net.useItem(slot, it.id); sfx.play(`Item/${pad(it.id, 8)}/Use`); }   // Sound/Item.img: a potion's gulp...
    else if (tab === 1) {
      const dst = equipSlotFor(it.id);
      if (!dst) return;
      if (!this.canEquip(it.id)) { this.notice('Your stats are too low to equip this item.'); return; }
      this.net.moveItem(1, slot, dst, 1);
    }
  }

  /**
   * Your level, stats and fame as an equip's requirements see them: your own stats plus the bonuses of what you would
   * still be wearing once it is on (not its own, nor those of what it takes off: the piece in its slot, a top and
   * bottom for an overall, a shield for a two-handed weapon...).
   */
  equipStats(id) {
    const s = this.stats || {}, worn = this.inventory?.equipped || {}, dst = equipSlotFor(id), cat = Math.floor(id / 10000);
    const off = new Set([dst]);
    if (cat === 105) off.add(-6);
    if (cat === 106 && Math.floor((worn[-5]?.id || 0) / 10000) === 105) off.add(-5);
    if (cat >= 140 && cat < 150) off.add(-10);
    const weapon = Math.floor((worn[-11]?.id || 0) / 10000);
    if (cat === 109 && weapon >= 140 && weapon < 150) off.add(-11);
    const out = { level: s.level || 0, str: s.str || 0, dex: s.dex || 0, int: s.int || 0, luk: s.luk || 0, fame: s.fame || 0 };
    for (const [slot, it] of Object.entries(worn)) {
      // what a pet wears adds nothing
      if (off.has(Number(slot)) || Number(slot) <= -114) continue;
      for (const k of ['str', 'dex', 'int', 'luk']) out[k] += it[k] || 0;
    }
    return out;
  }
  /**
   * Whether you can wear an item: its gender, its level, STR, DEX, INT, LUK and fame requirements (against
   * equipStats) and its jobs (reqJob: 0 anyone, -1 beginners, else a bit per branch: 1 warrior, 2 magician, 4 bowman,
   * 8 thief, 16 pirate). A GM (jobs 800 / 900) can wear anything.
   */
  canEquip(id) {
    const s = this.stats, info = this.windows?.info(id);
    if (!s || !info) return true;
    const branch = Math.floor((s.job % 1000) / 100);
    if (branch === 8 || branch === 9) return true;
    const g = Math.floor(id / 1000) % 10, gender = Math.floor(id / 1000000) === 1 && g < 2 ? g : 2;
    if (s.gender !== 2 && gender !== 2 && gender !== s.gender) return false;
    const have = this.equipStats(id);
    const reqs = [['reqLevel', 'level'], ['reqSTR', 'str'], ['reqDEX', 'dex'], ['reqINT', 'int'], ['reqLUK', 'luk'], ['reqPOP', 'fame']];
    if (reqs.some(([k, stat]) => (info[k] || 0) > have[stat])) return false;
    const job = info.reqJob || 0, bit = branch ? 1 << (branch - 1) : 0;
    return job === 0 || (job === -1 && !bit) || (job > 0 && (job & bit) !== 0);
  }

  /**
   * Scroll an equip: worn ones (negative slot), or ones in the inventory with Legendary Spirit. Checked
   * here as ScrollHandler would (fit, upgrades left) so a bad drop gets a message instead of nothing; with
   * a White Scroll in the bag you are asked whether to use it too. The server answers with the new item
   * (MODIFY_INVENTORY) and SHOW_SCROLL_EFFECT.
   */
  async useScroll(scrollSlot, equipSlot) {
    const inv = this.inventory, scroll = inv?.[2]?.[scrollSlot];
    const eq = equipSlot < 0 ? inv?.equipped?.[equipSlot] : inv?.[1]?.[equipSlot];
    if (!scroll || !eq || !isScroll(scroll.id) || this.player.dead) return;
    if (equipSlot > 0 && !(this.skills?.level(1003) > 0)) { this.notice('Scrolls can only be used on equipped items.'); return; }
    const sid = scroll.id, modifier = Math.floor(sid / 1000) === 2049;
    if (!scrollFits(sid, eq.id)) { this.notice('This scroll cannot be used on this item.'); return; }
    if (!modifier && !(eq.slots > 0)) { this.notice('This item has no upgrades available.'); return; }
    const hasWhite = Object.values(inv[2]).some((x) => x.id === 2340000) && Math.floor(sid / 100) !== 20490;
    const white = hasWhite && (await this.windows.confirm('Would you like to use a #bWhite Scroll#k too?\nIt keeps the upgrade slot if the scroll fails.'));
    if (inv[2][scrollSlot] !== scroll) return;          // it moved while you were deciding
    this.net?.useScroll(scrollSlot, equipSlot, white);
  }

  /**
   * The most a summon may hit for, as Cosmic's SummonDamageHandler caps it (it flags anything above):
   * magic ones (no pad) take 5% x mad of the base magic damage, others 7.7% x pad of your weapon's base
   * damage (5.4% from 438 up). Rolled at most 95% of that.
   */
  summonMaxDamage(id, lv) {
    const ld = this.skills.levelData(id, lv) || {}, s = this.stats;
    let max;
    if (!ld.pad) {
      const ti = (s.int || 0) + this.equipStat('int'), matk = Math.max(14, ti + this.equipStat('matk'));
      max = Math.floor(((matk - ti + Math.floor(0.1996049769 * ti ** 1.290631341)) * 107) / 100) * 0.05 * (ld.mad || 0);
    } else {
      const base = this.maxDamage();
      max = base * (base >= 438 ? 0.054 : 0.077) * ld.pad;
    }
    return Math.max(1, Math.floor(max * 0.95));
  }

  /** A summon's blow landing: the monster flinches, the numbers show and attack1's hit art plays on it. */
  async summonHit(sm, mob, dmgs, mine) {
    if (mine) {
      if (--mob.pendingHits <= 0 && !mob.queuedKill) this.releaseDrops(mob);
      const kill = mob.pendingHits <= 0 && mob.queuedKill;
      mob.hit(dmgs.reduce((a, b) => a + b, 0), sm.x > mob.x);
      this.damageNumbers(mob, dmgs, true);
      if (kill) this.finishKill(mob);
    } else { mob.hit(dmgs.reduce((a, b) => a + b, 0), sm.x > mob.x); this.damageNumbers(mob, dmgs, false); }
    const node = sm.node?.attack1?.info?.hit;
    if (!node) return;
    const anim = new Anim(node, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, x: mob.x, y: mob.y - (mob.node?._h || 40) / 2, flip: sm.facingRight });
  }

  /** SHOW_SCROLL_EFFECT: BasicEff Enchant Success / Failure over whoever scrolled, with its sound. */
  async onScrollEffect(e) {
    const ent = e.id === this.player.id ? this.player : this.others.get(e.id);
    if (!ent) return;
    sfx.play(e.success ? 'Game/EnchantSuccess' : 'Game/EnchantFailure');
    const node = (this.basicEff ??= await this.assets.json('Effect/BasicEff.img'))?.Enchant?.[e.success ? 'Success' : 'Failure'];
    if (node) {
      const anim = new Anim(node, false);
      await this.assets.preload(anim.frames);
      this.fx.push({ anim, follow: ent, flip: false });
    }
    if (ent !== this.player) return;
    this.hud.message(e.success ? 'The scroll lights up, and its mysterious power has been transferred to the item.'
      : e.cursed ? 'The scroll lights up, but the item has been destroyed due to its overwhelming power.'
        : 'The scroll lights up, but it seems the item has failed to be upgraded.', e.success ? '#9fe07a' : '#ff9e9e');
  }

  unequip(slot) {
    const inv = this.inventory[1];
    const limit = this.inventory.limits[1] || 24;
    for (let s = 1; s <= limit; s++) if (!inv[s]) { this.net.moveItem(1, slot, s, 1); return; }
    this.hud.message('Your equip inventory is full.', '#ff8080');
  }

  /**
   * Chat line from the status bar. Commands as in the client: /w <name> <text> whispers, /r <text>
   * answers the last whisper, /find <name> locates a player; anything else goes to the chat target
   * (All / Buddy / Party / Guild / Alliance). GM commands (!...) always go to All.
   */
  sendChat(text) {
    if (!this.net) { this.player.chat = { text, t: 5 }; return; }
    let m = text.match(/^\/(?:w|whisper)\s+(\S+)\s+(.+)$/i);
    if (m) { this.whisperTo(m[1], m[2]); return; }
    m = text.match(/^\/r\s+(.+)$/i);
    if (m) { if (this.lastWhisperFrom) this.whisperTo(this.lastWhisperFrom, m[1]); else this.hud.message('There is no whisper to reply to.', CHAT_COLORS.notice); return; }
    m = text.match(/^\/find\s+(\S+)$/i);
    if (m) { this.net.find(m[1]); return; }
    // the chat target from the drop-up list beside the chat line
    const target = this.statusBar?.chatTarget || 'all', note = (t) => this.hud.message(t, CHAT_COLORS.notice);
    if (target === 'all' || text.startsWith('!')) { this.net.chat(text); if (target === 'all') this.petCommandWord(text); return; }
    if (target === 'whisper') { const to = this.statusBar.whisperTo; if (to) this.whisperTo(to, text); else note('Choose who to whisper to first.'); return; }
    if (target === 'spouse') { this.net.spouseChat(text); return; }
    const mode = { buddy: 0, group: 0, party: 1, guild: 2, alliance: 3 }[target];
    if (mode === 1 && !this.party) { note('You are not in a party.'); return; }
    if (mode >= 2 && !this.guild) { note('You are not in a guild.'); return; }
    if (mode === 0) {
      // buddy chat (and Group, which has no buddy-group choice yet) reaches the buddies online
      const ids = (this.buddies || []).filter((b) => b.channel >= 0).map((b) => b.id);
      if (!ids.length) { note('None of your buddies are online.'); return; }
      this.net.groupChat(0, text, ids);
    } else this.net.groupChat(mode, text);
    // the server only echoes group chat to the others, so show your own line here
    this.hud.message(`${this.player.name} : ${text}`, CHAT_COLORS[GROUP_KEYS[mode]]);
  }
  /**
   * GUILD_OPERATION results: this.guild = { id, name, ranks[5], members[{ id, name, job, level, rank, online }],
   * capacity, emblem, notice, gp }, plus the prompts Heracle and inviters start.
   */
  onGuild(d) {
    const me = this.player.id, g = this.guild, msg = (t) => this.hud.message(t, CHAT_COLORS.guild);
    const member = (id) => g?.members.find((m) => m.id === id);
    switch (d.kind) {
      case 'askName':
        this.windows.askText('Enter the name of the guild you would like to create.').then((n) => { if (n) this.net.guildOp(2, n.trim()); });
        break;
      case 'agreement':
        notify(this.windows, 'guildFound', d.master).then((ok) => this.net.guildAgree(ok));
        break;
      case 'invite':
        notify(this.windows, 'guild', d.from)
          .then((ok) => (ok ? this.net.guildOp(6, d.id, me) : this.net.guildDeny(d.from)));
        break;
      case 'info':
        this.guild = d.guild;
        break;
      case 'join':
        if (!g) break;
        g.members = [...g.members.filter((m) => m.id !== d.member.id), d.member];
        msg(d.member.id === me ? `You have joined the guild ${g.name}.` : `${d.member.name} has joined the guild.`);
        break;
      case 'leave': case 'expel':
        if (d.id === me) { this.guild = null; msg(d.kind === 'expel' ? 'You have been expelled from the guild.' : 'You have left the guild.'); break; }
        if (g) g.members = g.members.filter((m) => m.id !== d.id);
        msg(`${d.name} has ${d.kind === 'expel' ? 'been expelled from' : 'left'} the guild.`);
        break;
      case 'disband': this.guild = null; msg('The guild has been disbanded.'); break;
      case 'capacity': if (g) g.capacity = d.capacity; break;
      case 'levelJob': { const m = member(d.id); if (m) Object.assign(m, { level: d.level, job: d.job }); break; }
      case 'online': { const m = member(d.id); if (m) m.online = d.online; break; }
      case 'ranks': if (g) g.ranks = d.ranks; break;
      case 'rank': { const m = member(d.id); if (m) m.rank = d.rank; break; }
      case 'emblem': if (g) g.emblem = d.emblem; break;
      case 'notice': if (g) { g.notice = d.notice; if (d.notice) msg(`[Guild Notice] ${d.notice}`); } break;
      case 'gp': if (g) g.gp = d.gp; break;
      case 'message': { const t = GUILD_MESSAGES[d.code]; if (t) this.windows.notice(t.replace('%s', d.name)); break; }
      default: break;
    }
  }

  /** PARTY_OPERATION results: keep this.party = { id, leader, members[] } in step with the server. */
  onParty(p) {
    const me = this.player.id, msg = (t) => this.hud.message(t, CHAT_COLORS.party);
    const keepHp = (members) => members.map((m) => ({ ...this.party?.members.find((o) => o.id === m.id), ...m }));
    if (p.kind === 'created') {
      this.party = { id: p.id, leader: me, members: [{ id: me, name: this.player.name, job: this.stats.job, level: this.stats.level, channel: this.channel, map: this.map?.id }] };
      msg('You have created a new party.');
    } else if (p.kind === 'update' || p.kind === 'join') {
      if (p.kind === 'join') msg(p.name === this.player.name ? 'You have joined the party.' : `${p.name} has joined the party.`);
      this.party = { id: p.id, leader: p.leader, members: keepHp(p.members) };
    } else if (p.kind === 'leave' || p.kind === 'expel') {
      if (p.target === me) { this.party = null; msg(p.kind === 'expel' ? 'You have been expelled from the party.' : 'You have left the party.'); }
      else { this.party = { id: p.id, leader: p.leader, members: keepHp(p.members) }; msg(`${p.name} has ${p.kind === 'expel' ? 'been expelled from' : 'left'} the party.`); }
    } else if (p.kind === 'disband') {
      this.party = null; msg(p.target === me ? 'You have disbanded the party.' : 'The party has been disbanded.');
    } else if (p.kind === 'leader' && this.party) {
      this.party.leader = p.leader;
      const m = this.party.members.find((x) => x.id === p.leader);
      if (m) msg(`${m.name} is now the party leader.`);
    }
    this.windows.wins.partysearch?.partyChanged();
  }

  whisperTo(name, text) {
    this.pendingWhisper = { name, text };
    this.net.whisper(name, text);
  }
  onWhisper(w) {
    this.lastWhisperFrom = w.from;
    this.hud.message(`${w.from}>> ${w.text}`, CHAT_COLORS.whisper);
  }
  onWhisperResult(r) {
    const p = this.pendingWhisper;
    if (r.ok && p) this.hud.message(`${r.to}<< ${p.text}`, CHAT_COLORS.whisper);
    else if (!r.ok) this.hud.message(`Unable to find '${r.to}'.`, CHAT_COLORS.notice);
    this.pendingWhisper = null;
  }
  async onFindResult(f) {
    let where;
    if (f.type === 1) where = `is in ${await this.mapName(f.where)}`;
    else if (f.type === 3) where = `is in channel ${f.where + 1}`;
    else if (f.type === 2) where = 'is in the Cash Shop';
    else where = 'is in the MTS';
    this.hud.message(`'${f.name}' ${where}.`, CHAT_COLORS.find);
  }
  async mapName(id) {
    const s = await this.assets.json('String/Map.img');
    for (const r of Object.values(s || {})) if (r?.[id]) return `${r[id].streetName} : ${r[id].mapName}`;
    return String(id);
  }

  // ------------------------------------------------------------------ NPC dialog
  /** NPC_TALK: the canvas UtilDlgEx dialog, then NPC_TALK_MORE with the answer. */
  async showNpcDialog(d) {
    const r = await npcTalk(this.windows, d);
    this.net.npcReply(d.type, r.action, r.sel);
  }

  // ------------------------------------------------------------------ loop
  start() {
    let last = performance.now();
    const loop = (t) => {
      // the next frame is booked first: an error in one frame must never stop the game for good
      requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      if (this.map && !this.loading) {
        try { this.update(dt); this.render(); } catch (e) {
          const key = String(e?.message);
          if (this._lastLoopError !== key) { this._lastLoopError = key; console.error('frame failed', e); }
          for (let i = 0; i < 32; i++) this.ctx.restore();   // close whatever the failed frame left open
        }
      }
      this.input.endFrame();
      this._frames++; this._fpsT += dt;
      if (this._fpsT >= 1) { this.fps = this._frames; this._frames = 0; this._fpsT = 0; }
    };
    requestAnimationFrame(loop);
  }

  update(dt) {
    if (this.inCashShop) { this.windows?.update(dt); return; }   // the shop screen is all there is
    this.map.update(dt);
    this.map.updateHidden(this.player.x, this.player.y);
    this.statusBar?.update(dt);
    this.windows?.update(dt);
    this.vfx?.update(dt);
    this.map.life = this.map.life.filter((e) => !e.removed);
    if (this.reactors) for (const [oid, r] of this.reactors) { r.update(dt); if (r.removed) this.reactors.delete(oid); }
    this.updateDiseases(dt);
    if (this.net) this.touchReactors();
    if (!this.dead && this.fade?.dir !== 'out') this.updatePlayer(dt);   // you stand still while the old map goes dark
    for (const rp of this.others.values()) { rp.update(dt); stepExpression(rp, rp.look, dt); }
    stepExpression(this.player, this.look, dt);
    for (const pet of this.pets.values()) { pet.update(dt); pet.sync(dt); }
    for (const [oid, sm] of this.summons) { sm.update(dt); if (sm.gone) this.summons.delete(oid); }
    if (this.net) this.petLoot(dt);
    if (this.player.chat && (this.player.chat.t -= dt) <= 0) this.player.chat = null;
    this.updateDrops(dt);
    this.updateFx(dt);
    this.runTimers(dt);
    if (this.shake) this.shakeStep(dt);
    this.loadAfterimage();
    this.handleHotkeys();
    if (this.net) { this.syncMovement(dt); this.puppetAggro(dt); this.checkTouchDamage(dt); this.handleClicks(); this.regen(dt); }
    this.updateCamera(dt);
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < 1.2);
  }

  /**
   * Natural regeneration is client-driven in v83 (HEAL_OVER_TIME). Cosmic rejects heals faster than
   * 1.5s apart and autobans HP heals above 77 * map recovery * 1.5, so stay at the classic +10 HP / 10s.
   */
  /**
   * Natural recovery, as the client does it (openms, docs/offline-combat.md): HP and MP on their own 10s timers.
   * HP only while you keep still, standing or sitting (moving, attacking or the alert pose start it over), and it
   * shows as a blue number over you; MP goes on through anything and shows no number. A map's info/recovery
   * multiplies both.
   */
  regen(dt) {
    const p = this.player, s = this.stats;
    if (this.dead || !s || this.hidden()) { this.hpRegenT = this.mpRegenT = 0; return; }
    const still = p.fh && !p.attack && p.x === this.regenX && p.y === this.regenY && /^(stand|sit)/.test(p.action || '');
    this.regenX = p.x; this.regenY = p.y;
    this.hpRegenT = still ? (this.hpRegenT || 0) + dt : 0;
    this.mpRegenT = (this.mpRegenT || 0) + dt;
    const k = Number(this.map?.info?.recovery) || 1;
    const maxHp = this.maxHpShown(), maxMp = this.maxMpShown();   // the server heals up to the same buffed max
    let hp = 0, mp = 0;
    if (this.hpRegenT >= 10) { this.hpRegenT = 0; hp = s.hp < maxHp ? Math.min(Math.trunc(10 * k), maxHp - s.hp) : 0; }
    if (this.mpRegenT >= 10) { this.mpRegenT = 0; mp = s.mp < maxMp ? Math.min(Math.trunc((3 + Math.floor(s.int / 10)) * k), 100, maxMp - s.mp) : 0; }
    if (!hp && !mp) return;
    this.net.healOverTime(hp, mp);
    if (hp) this.vfx?.damage(p, [hp], 'blue');
  }

  /**
   * Drops, as the original client moves them (openms' recovery of its drop routine, docs/drop-motion.md):
   *   flight: Y = Ys - V*t + 400*t^2 (t in s) while X drifts across, then a destination below the
   *     source is reached by falling straight down at V; the original launches at V = 400 (a 100px hop),
   *     here monster loot hops DROP_HOP and a player's throw THROW_HOP, as tuned for this client
   *   items a player throws spin a full turn every 300ms until they land (monster loot and meso bags don't)
   *   resting: Y = Yg + 3*sin(phase), phase advancing pi per second (a 2s, 3px bob)
   *   pickup (700ms): straight from the landing spot to the middle of the looter's body, lifted by a
   *     40px arc, -40 + (ms-350)^2 * 160/490000; fully opaque until 420ms, then fading to 63/255
   */
  pickUp(d, looter) {
    if (!d.landed) { d.landed = true; d.cx = d.x; d.cy = d.y; }
    d.pickedBy = looter; d.age = 0; d.angle = 0;
    d.sx = d.x; d.sy = d.y;
  }
  updateDrops(dt) {
    for (const [oid, d] of this.drops) {
      d.anim.update(dt * 1000);
      d.phase += dt * Math.PI;
      d.age += dt;
      if (d.pickedBy) {
        const L = d.pickedBy, u = Math.min(PICKUP_TIME, d.age), k = u / PICKUP_TIME, ms = u * 1000;
        const tx = L.x, ty = L.y - (L === this.player || this.others.has(L.id) ? 32 : 15);   // the middle of a character (a pet is smaller)
        d.cx = d.sx + (tx - d.sx) * k;
        d.cy = d.sy + (ty - d.sy) * k - 40 + ((ms - 350) ** 2 * 160) / 490000;
        d.alpha = ms < 420 ? 1 : (255 - ((ms - 420) * 192) / 280) / 255;
        if (d.age >= PICKUP_TIME) this.drops.delete(oid);
        continue;
      }
      if (d.landed) {
        // mode 3: an item that cannot be dropped (untradeable / quest) lands, fades and is gone
        if (d.mode === 3 && (d.vanish = (d.vanish || 0) + dt) > 0) {
          d.alpha = Math.max(0, 1 - d.vanish / 0.5);
          if (d.vanish >= 0.5) this.drops.delete(oid);
        }
        continue;
      }
      const V = d.speed, t = d.age;
      if (d.falling) {                                  // straight down to a lower floor
        d.cx = d.x; d.cy = d.fromY + V * (t - d.flight);
        if (d.cy >= d.y) this.land(d);
      } else {
        const k = Math.min(1, t / d.flight);
        d.cx = d.fromX + (d.x - d.fromX) * k;
        d.cy = d.fromY - V * t + 400 * t * t;
        if (t >= d.flight) { if (d.y > d.fromY + 1) d.falling = true; else this.land(d); }
      }
      if (d.spin && !d.landed) d.angle += (2 * Math.PI / 0.3) * dt;
    }
  }
  land(d) { d.landed = true; d.falling = false; d.cx = d.x; d.cy = d.y; d.angle = 0; }

  updatePlayer(dt) {
    const p = this.player, map = this.map, fh = map.fh, inp = this.input, look = this.look;
    let dir = (inp.is('right') ? 1 : 0) - (inp.is('left') ? 1 : 0);
    if (this.hasDisease(REVERSE)) dir = -dir;
    // stunned: no walking, jumping, climbing or attacking until it wears off (you still fall and slide to a stop)
    if (this.hasDisease(STUN)) {
      if (p.ladder) { this.advanceFrame(p.ladder.l ? 'ladder' : 'rope', 0); return; }
      if (p.fh) { const v0 = p.vx || 0; p.vx = approach(v0, 0, PHYS.walkBrake * dt); const dx = ((v0 + p.vx) / 2) * dt; if (dx) fh.walk(p, dx); }
      else { fh.fall(p, dt, p.ignoreFh); if (p.fh) p.vx = 0; }
      this.advanceFrame(p.fh ? look.standAction() : 'jump', dt);
      return;
    }
    const ms = this.moveStats(), WALK = PHYS.walk * ms.speed, JUMP = PHYS.jump * ms.jump;   // air steering stays unscaled
    let action;
    if (p.ignoreT > 0 && (p.ignoreT -= dt) <= 0) p.ignoreFh = null;
    if (this.portalCooldown > 0) this.portalCooldown -= dt;
    if (p.regrabT > 0) p.regrabT -= dt;

    // Rush's dash, on the 30ms clock
    if (this.rush) {
      this.rush.acc += dt * 1000;
      while (this.rush && this.rush.acc >= DASH_TICK) { this.rush.acc -= DASH_TICK; this.rushStep(); }
    }
    // charging (Monster Magnet, Big Bang) or winding up (Explosion): stand in its pose until the key is let go, or
    // the wind-up is over
    if (this.charging) {
      const c = this.charging;
      c.t += dt;
      if (this.dead) this.charging = null;
      else if (c.prepare ? c.t < c.prepare : this.heldSkill() === c.id) { this.advanceFrame(c.pose, dt); return; }
      else this.releaseCharge();
    }
    // Hurricane / Piercing Arrow held: stand in its pose (falling if in the air) until the key is let go
    if (this.keydown) {
      const k = this.keydown;
      k.t += dt;
      if (this.heldSkill() === k.id && !this.dead && !this.hasDisease(STUN)) {
        if (p.fh) p.vx = 0; else fh.fall(p, dt, p.ignoreFh);
        this.advanceFrame(k.pose, dt);
        if (HURRICANES.has(k.id)) this.hurricaneShot(k);
        if (this.keydown) return;
      } else this.endKeydown();
    }

    if (p.ladder) {
      const l = p.ladder;
      const v = (inp.is('down') ? 1 : 0) - (inp.is('up') ? 1 : 0);
      p.y += v * PHYS.climb * dt;
      action = l.l ? 'ladder' : 'rope';
      if (this.hitAction(ACTION.JUMP) && dir && !this.hasDisease(WEAKEN)) {
        p.ladder = null; p.vy = -JUMP * 0.5; p.vx = dir * WALK * 1.3; p.facingRight = dir > 0;   // the client's ladder jump
        p.regrabT = 0.35;              // jumping off with up still held must not catch the same rope again
        sfx.play('Game/Jump');
      } else if (p.y < l.y1) {
        p.ladder = null;
        p.fh = fh.below(l.x, l.y1 - 20, 40);
        p.y = p.fh ? Footholds.yAt(p.fh, p.x) : l.y1;
      } else if (p.y > l.y2) {
        p.ladder = null; p.vx = 0; p.vy = 0;
      }
      this.advanceFrame(action, v !== 0 ? dt : 0);
      return;
    }

    if (p.attack) {
      action = p.attack;
      if (p.fh) p.vx = 0; else fh.fall(p, dt, p.ignoreFh);
      if (this.advanceFrame(action, dt)) p.attack = null;
      return;
    }

    // seated (a map seat or a chair): moving, jumping, attacking or a skill stands you up; otherwise you stay put
    if (p.seat) {
      if (dir || this.holdAction(ACTION.JUMP) || this.holdAction(ACTION.ATTACK) || this.heldSkill() || this.macroQueue?.length) this.standUp();
      else {
        if (this.hitAction(ACTION.PICKUP) && this.net) this.tryPickup();
        this.advanceFrame('sit', dt);
        return;
      }
    } else if (this.hitAction(ACTION.SIT) && this.trySit()) { this.advanceFrame('sit', dt); return; }

    // wait out an attack cut short by a hit
    if (performance.now() >= (this.attackLock || 0)) {
      // a macro's next skill, once the last one's animation is over
      if (this.macroQueue?.length && !p.attack) {
        const id = this.macroQueue.shift();
        this.skillKeyPressed = true;
        const used = this.useSkill(id);
        this.skillKeyPressed = false;
        if (used) return;
      }
      const skill = this.heldSkill();
      if (skill && this.skills) { if (this.useSkill(skill)) return; }
      if (this.holdAction(ACTION.ATTACK)) { this.attack(0); return; }
    }
    if (this.hitAction(ACTION.PICKUP) && this.net) this.tryPickup();
    if (this.hitAction(ACTION.NPC_CHAT) && this.net) this.talkToNearestNpc();

    if (inp.hit('up') && p.fh && this.useDoorAt(p)) return;
    if (p.fh && this.portalCooldown <= 0) {
      const portal = map.portalAt(p.x, p.y);
      // touch portals fire once on entry, not every frame you stand in them
      const touched = portal && TOUCH_PORTALS.has(portal.pt) && portal !== this.touchedPortal;
      this.touchedPortal = portal && TOUCH_PORTALS.has(portal.pt) ? portal : null;
      if (portal && (inp.hit('up') || touched)) { this.usePortal(portal); if (!touched) return; }
    }
    // up grabs a ladder / rope you are over, whether or not left / right is held too (mid-jump included)
    if (inp.is('up') && !(p.regrabT > 0)) {
      const l = map.ladderAt(p.x, p.y, true);
      if (l && (!p.fh || p.y > l.y1 + 5)) { this.grab(l); return; }
    }
    if (inp.is('down') && p.fh && !dir) {
      const l = map.ladderAt(p.x, p.y, false);
      if (l && Math.abs(p.y - l.y1) < 15) { this.grab(l); p.y = l.y1 + 6; return; }
    }

    if (p.fh) {
      if (dir) p.facingRight = dir > 0;
      // holding jump keeps jumping: each landing jumps again (a down-jump still needs its own press)
      if (!this.hasDisease(WEAKEN) && (this.hitAction(ACTION.JUMP) || (this.holdAction(ACTION.JUMP) && !inp.is('down')))) {   // Weakness: no jumping
        if (inp.is('down')) {
          const below = fh.below(p.x, p.y + 1, Infinity, p.fh);   // any floor under us, however far down
          // a little hop first, then down through the floor: it stays ignored until we are well past it
          if (below) { p.ignoreFh = p.fh; p.ignoreT = 0.45; p.fh = null; p.vy = -JUMP * 0.35355339; p.vx = 0; sfx.play('Game/Jump'); }
          else if (!dir) action = 'prone';   // nothing to drop to: stay lying down
        } else {
          // the client's jump: a direction adds 0.8 of the walk speed to what you already had, up to the walk speed
          p.vx ||= 0;
          if (dir * p.vx < WALK * 0.8) p.vx += dir * WALK * 0.8;
          if (dir * p.vx > WALK) p.vx = dir * WALK;
          p.fh = null; p.vy = -JUMP;
          sfx.play('Game/Jump');
        }
      } else {
        // walking speeds up and slows down rather than starting and stopping dead (moved by the step's average speed)
        const v0 = p.vx || 0;
        p.vx = dir ? accelerate(v0, dir * PHYS.walkAccel, WALK, dt) : approach(v0, 0, PHYS.walkBrake * dt);
        const dx = ((v0 + p.vx) / 2) * dt;
        if (dx) { const r = fh.walk(p, dx); if (r === 'edge') p.vy = 0; else if (r === 'wall') p.vx = 0; }
        if (inp.is('down') && !dir) action = 'prone';
        else if (dir) action = look.walkAction();
      }
    }
    if (!p.fh) {
      p.vx ||= 0;
      if (dir) {
        p.facingRight = dir > 0;
        p.vx = accelerate(p.vx, dir * PHYS.airAccel, PHYS.airLimit, dt);
      } else p.vx = approach(p.vx, 0, (p.vy < PHYS.maxFall ? PHYS.airDrag : PHYS.airDrag * 100) * dt);
      fh.fall(p, dt, p.ignoreFh);
      // landing keeps half the speed when you hold the same way (or nothing) and stops you holding the other way
      if (p.fh) p.vx = dir * p.vx >= 0 ? p.vx * 0.5 : 0;
      action = p.fh ? look.standAction() : 'jump';
    }
    action ??= look.standAction();

    const b = map.bounds;
    p.x = Math.max(fh.left + 25, Math.min(fh.right - 25, p.x));     // the client's side walls: footholds' extent, 25px in
    if (p.y > b.bottom + 300) this.placeAtPortal(map.spawnPortal(null));
    this.advanceFrame(action, dt);
  }

  /**
   * Through a portal, as the client does (openms, docs/ingame-portals.md): within the map you are moved at once,
   * BasicEff's Teleport sparkling where you left and where you land, the camera gliding across, and can go again
   * after 600ms; to another map the screen starts fading to black and another request waits 500ms. A request the
   * server turns down (no new map within a few seconds) fades back in.
   */
  usePortal(portal) {
    const map = this.map;
    sfx.play('Game/Portal');
    if (portal.tm === map.id && portal.pt !== 4 && portal.pt !== 5) {
      this.portalCooldown = 0.6;
      const from = { x: Math.round(this.player.x), y: Math.round(this.player.y) };
      const t = map.spawnPortal(portal.tn);
      this.playTeleportEffect(from.x, from.y);
      this.placeAtPortal(t);
      this.playTeleportEffect(this.player.x, this.player.y);
      this.net?.innerPortal(portal.pn, from, { x: t.x, y: t.y });
      return;
    }
    this.portalCooldown = 0.5;
    this.fadeOut();
    this.after(3000, () => { if (this.fade?.dir === 'out' && !this.loading && this.map === map) this.fade = { dir: 'in', t0: performance.now() }; });
    if (!this.net) this.changeMap(portal.tm, { portal: portal.tn });
    else if (portal.script) this.net.scriptPortal(portal.pn);
    else this.net.enterPortal(portal.pn);
  }
  /** Map changes go dark over 600ms and light up over 600ms on the new map (the client's global brightness fade). */
  fadeOut() { if (this.fade?.dir !== 'out') this.fade = { dir: 'out', t0: performance.now() }; }
  get darkness() {
    const f = this.fade;
    if (!f) return 0;
    const k = (performance.now() - f.t0) / FADE_MS;
    if (f.dir === 'out') return Math.min(1, k);
    if (k >= 1) { this.fade = null; return 0; }
    return 1 - k;
  }

  grab(l) {
    const p = this.player;
    p.ladder = l; p.fh = null; p.x = l.x; p.vx = 0; p.vy = 0;
  }

  advanceFrame(action, dt) {
    const p = this.player, look = this.look;
    if (!look.has(action)) action = look.standAction();
    if (p.action !== action) { p.action = action; p.frame = 0; p.frameT = 0; p.back = false; }
    p.frameT += dt * 1000;
    let finished = false;
    const k = p.attack && action === p.attack ? p.attackScale || 1 : 1;   // attacks run at the weapon's speed
    while (p.frameT >= look.delay(action, p.frame) * k) {
      p.frameT -= look.delay(action, p.frame) * k;
      const nx = look.nextFrame(action, p.frame, p.back);
      p.frame = nx.frame; p.back = nx.back;
      if (nx.wrapped) finished = true;
    }
    return finished;
  }

  // ------------------------------------------------------------------ combat
  /** An action's id in attack packets; a claw's throws have their own ids (24-26) though drawn as swingO1-3. */
  actionId(name, thrown = false) {
    const t = thrown ? ['swingO1', 'swingO2', 'swingO3'].indexOf(name) : -1;
    if (t >= 0) return 24 + t;
    const i = ACTIONS.indexOf(name); return i < 0 ? 0 : i;
  }
  actionName(id) { return ACTIONS[id] || 'swingO1'; }

  /** Try a skill from its hotkey. Returns true when it started (so movement is skipped this frame). */
  useSkill(id) {
    if (this.hasDisease(SEAL)) return false;   // sealed by a monster: no skills until it wears off
    const sb = this.skills, lv = sb.level(id);
    if (!lv || !sb.owns(id)) return false;   // another job's skill, even if you have levels in it
    const kind = sb.kind(id, this.weaponId());
    if (kind === 'passive') return false;
    // in Dark Sight only Assassinate goes; with Vanish learned, anything but Dark Sight itself
    if (this.darkSight() && id !== ASSASSINATE && (!sb.level(VANISH) || id === DARK_SIGHTS[1])) return false;
    if (id === ASSASSINATE && !this.darkSight()) return false;   // Assassinate only comes out of Dark Sight
    if (MONSTER_MAGNETS.has(id) || BIG_BANGS.has(id) || id === EXPLOSION) return this.holdCharge(id, lv);
    if (HURRICANES.has(id) || id === PIERCING_ARROW) return this.holdKeydown(id, lv);
    // Panic and Coma need an orb, Enrage nine; without them the key does nothing
    if (FINISHERS.has(id) && this.comboValue() < 2) return false;
    if (id === ENRAGE && this.comboValue() < 10) return false;
    // Charged Blow needs a charge on; Rush waits 1.77s after the last; movement skills not on maps that forbid them
    if (id === CHARGED_BLOW && !this.activeCharge()) return false;
    if (RUSH_DASH.has(id) && performance.now() < (this.rushLock || 0)) return false;
    if (MOVE_LIMITED.has(id) && ((this.map?.info?.fieldLimit || 0) & 2)) return false;
    if (id === SHADOW_MESO && this.meso < (sb.levelData(id)?.moneyCon || 0)) { this.notice("You don't have enough mesos to use this skill."); return false; }
    // buffs fire once per key press; Teleport repeats while the key is held (its own delay paces it)
    if (kind === 'special' && !this.skillKeyPressed && !TELEPORTS.has(id)) return false;
    if (TELEPORTS.has(id) && performance.now() < (this.teleportLock || 0)) return false;
    return this.attack(id, kind);
  }

  /**
   * Basic attack (skillId 0) or skill. kind: melee | ranged | magic | special.
   * Damage, MP cost and ammo are validated by Cosmic; the client picks targets and rolls damage.
   * opts.held: a shot of a skill whose key is held (Hurricane, Piercing Arrow), fired from the pose it holds;
   * opts.charge: how long Piercing Arrow was charged (ms).
   */
  attack(skillId = 0, kind = null, opts = {}) {
    const { charge = 0, heal = false } = opts;
    const p = this.player, sb = this.skills, weapon = this.weaponId();
    const wcat = weapon ? Math.floor(weapon / 10000) : 0;
    // lying down, a plain attack is the prone stab: a short melee jab with any weapon
    const prone = !skillId && !!p.fh && this.input.is('down') && this.look.has('proneStab');
    if (prone) kind = 'melee';
    kind ??= RANGED_WEAPONS.has(wcat) ? 'ranged' : 'melee';
    if (skillId && this.net && !sb.weaponOk(skillId, weapon)) { this.notice('You cannot use this skill with the weapon you are holding.'); return false; }
    if (GROUND_ONLY.has(skillId) && !p.fh) return false;
    if (kind === 'magic' && !p.fh && !AIR_SPELLS.has(skillId) && !this.map?.info?.swim) return false;
    // a plain attack in Dark Sight (without Vanish) only brings you out of it
    const ds = !skillId && !opts.final && this.darkSight();
    if (ds && !sb.level(VANISH)) {
      if (!ds.leaving) { ds.leaving = true; this.playSkillEffect(ds.source, p); this.net?.cancelBuff(ds.source); }
      return false;
    }
    // a bow, crossbow, claw or gun swings (a plain attack) instead of shooting when a monster is within its swing
    // (65px in front at most) - for most shooting skills too - or when it has nothing to shoot; a Mortal Blow can go
    // off instead of that swing. Otherwise the shot starts from the front of the swing.
    let swing = null, reach = Infinity, from = 0;
    if (kind === 'ranged') {
      const s = this.look.attackAction(), empty = this.net && !this.hasAmmo(skillId);
      if (empty && skillId) this.notice(AMMO_OUT[wcat] || AMMO_OUT[145]);
      const close = !NO_CLOSE_SWING.has(skillId);
      if (empty || (close && this.findTargets('melee', 0, 0, 1, s, CLOSE_REACH).length)) {
        const mb = !empty && MORTAL_BLOWS.find((id) => sb.owns(id) && sb.level(id));
        if (mb && Math.random() * 100 < (sb.levelData(mb)?.prop || 0)) skillId = mb;
        else { if (opts.held) return false; kind = 'melee'; swing = s; reach = empty ? Infinity : CLOSE_REACH; skillId = 0; }
      } else if (close) from = this.closeReach(s);
    }
    if (opts.from !== undefined) from = opts.from;
    const lv = skillId ? sb.level(skillId) : 0;
    const ld = skillId ? sb.levelData(skillId, lv) : null;
    if (skillId && this.net) {
      if (sb.cooling(skillId)) { this.notice('You may not use the skill yet.'); return false; }
      if ((ld?.mpCon || 0) > this.stats.mp) { this.notice('Not enough MP.'); return false; }
      if ((ld?.hpCon || 0) >= this.stats.hp) { this.notice('Not enough HP.'); return false; }
      if (skillId === DRAGON_ROAR && this.stats.hp < this.maxHpShown() / 2) { this.notice("You don't have enough HP to use this skill."); return false; }
      if (skillId === FLAME_GEAR && this.flameGearBlocked(lv)) { this.notice('It cannot be used here.'); return false; }
    }
    if (kind === 'special') return this.castSpecial(skillId, lv);
    // Assassinate's first stage brings you out of Dark Sight; it strikes harder the longer you were in it
    if (skillId === ASSASSINATE && !opts.stage2) {
      const dsb = this.darkSight();
      this.assassinSec = dsb ? Math.floor((Date.now() - (dsb.until - dsb.dur)) / 1000) : 0;
      if (dsb) { this.playSkillEffect(dsb.source, p); this.net?.cancelBuff(dsb.source); }
    }

    if (!opts.held) {
      const action = prone ? 'proneStab' : swing || opts.pose || (skillId && sb.action(skillId)) || this.defaultAttackAction(kind);
      p.attack = this.look.has(action) ? action : this.look.attackAction();
      p.frame = 0; p.frameT = 0; p.action = p.attack;
      p.attackScale = this.attackScale();
    }
    const pose = (opts.held ? opts.pose : p.attack) || this.defaultAttackAction(kind), scale = opts.held ? this.attackScale() : p.attackScale;
    const hitDelay = this.look.attackDelay(pose) * scale, trailAt = this.hitFrame(pose, kind);
    if (!opts.held) {
      this.after(this.frameTime(pose, trailAt) * scale, () => this.playAfterimage(pose, trailAt));
      if (opts.stage2) { this.playSkillEffect(skillId, p, false, 'special'); sfx.play(`Skill/${pad(skillId, 7)}/Use2`); }
      else if (skillId && !heal) this.playSkillEffect(skillId, p, kind !== 'magic');
      else if (!skillId) this.playWeaponSound(p);
    } else sfx.play(`Skill/${pad(skillId, 7)}/Use`);

    const mobCount = ld?.mobCount || 1;
    // fixdamage skills must deal exactly that much per monster (Cosmic autobans anything else)
    const lines = ld?.fixdamage || opts.stage2 ? 1 : ld?.attackCount || ld?.bulletCount || 1;
    const ammo = kind === 'ranged' ? this.ammoItem(ld?.bulletConsume || ld?.bulletCount || 1) : 0;
    const plan = kind === 'ranged' && !BOX_SHOTS.has(skillId) ? this.shotPlan(p, skillId, lv, ld, this.shotRange(skillId, lv, wcat), from) : null;
    const kept = opts.prefer && opts.prefer.alive && !opts.prefer.dying && !opts.prefer.queuedKill ? [opts.prefer] : null;
    let targets = kept || (plan ? plan.targets.map((t) => t.mob) : this.findTargets(kind, skillId, lv, mobCount, pose, reach, charge));
    if (heal) targets = targets.filter((m) => m.src.info?.undead);
    if (this.net) this.after(hitDelay, () => this.hitReactors(kind, skillId, lv, pose));
    const max = this.net ? (skillId ? skillMaxDamage(this, skillId, lv, kind) : kind === 'magic' ? 1 : this.maxDamage(pose)) : 25;
    // Snipe's shot strikes for 199,999 less up to 10,000
    const roll = () => (skillId === SNIPE ? Math.trunc(199999 - Math.random() * 10000)
      : ld?.fixdamage ? ld.fixdamage : Math.max(1, Math.round(max * (0.5 + Math.random() * 0.5))));
    const fixedPhys = !!ld?.fixdamage && (kind === 'ranged' || kind === 'melee');
    // magic and fixed-damage skills never crit; the server tells a critical by its going over the plain maximum
    let crit = this.net && kind !== 'magic' && !ld?.fixdamage ? critical(this, wcat, kind === 'ranged') : null, pct = ld?.damage || 100;
    // Assassinate's second stage crits by its own prop and criticalDamage (Sharp Eyes on top)
    if (opts.stage2) {
      const se = this.buffs?.find((b) => b.sharpEyes && b.until > Date.now())?.sharpEyes;
      crit = { rate: (ld?.prop || 0) + (se?.rate || 0), dmg: (ld?.criticalDamage || 100) - 100 + (se?.dmg || 0) };
    }
    // the weapon's info/knockback: the chance a swing (not a shot) recoils the monster strongly, more with Power
    // Knock-Back; Dragon's Breath throws back what it strikes at its prop chance
    let knockback = kind === 'melee' ? Math.max(0, Math.min(100, this.windows?.info(weapon)?.knockback || 0)) : 0;
    if (POWER_KNOCKBACK.has(skillId)) knockback += ld?.prop || 0;
    if (DRAGONS_BREATH.has(skillId)) knockback = ld?.prop || 0;
    // a Paladin's Charged Blow does Advanced Charge's damage % once it is learned
    const cbLd = skillId === CHARGED_BLOW && this.stats?.job === 122 && sb.level(ADVANCED_CHARGE)
      ? { ...ld, damage: sb.levelData(ADVANCED_CHARGE)?.damage || ld?.damage } : null;
    const phys = !!weapon && skillId !== SNIPE && !ld?.fixdamage && !OWN_DAMAGE.has(skillId) && (kind === 'ranged' || kind === 'melee')
      && !!weaponDamage(wcat % 100, kind === 'ranged', pose, skillId, this.stats?.job || 0);
    let out = targets.map((m, place) => {
      const dmg = [], crits = [];
      for (let i = 0; i < lines; i++) {
        // Heaven's Hammer strikes for 1: the server does its real damage a moment later
        if (skillId === HEAVENS_HAMMER) { dmg.push(1); crits.push(false); continue; }
        if (phys) { const h = this.physicalHit(m, wcat % 100, skillId, cbLd || ld, kind === 'ranged', pose, ammo, crit, opts.charge, i); dmg.push(h.d); crits.push(h.c); continue; }
        if (fixedPhys) { dmg.push(this.fixedMiss(m) ? 0 : ld.fixdamage); crits.push(false); continue; }
        const c = skillId === SNIPE || (!!crit && Math.random() * 100 < crit.rate), d = roll();
        dmg.push(c && skillId !== SNIPE ? Math.round((d * (pct + crit.dmg)) / pct) : d); crits.push(c);
      }
      const scale = skillId === ARROW_BOMB ? (ld?.x || 100) / 100 : PIERCE_SCALE[skillId] ? PIERCE_SCALE[skillId] ** place : 1;
      if (scale !== 1) for (let i = 0; i < dmg.length; i++) dmg[i] = Math.trunc(dmg[i] * scale);
      return { mob: m, oid: m.oid, x: Math.round(m.x), y: Math.round(m.y), dmg, crit: crits };
    });
    // an Arrow Bomb that misses its first monster doesn't go off
    if (skillId === ARROW_BOMB && out[0]?.dmg[0] === 0) out = out.slice(0, 1);
    const projectile = kind === 'ranged' || (skillId && sb?.node(skillId)?.ball && kind !== 'melee' && skillId !== CHAIN_LIGHTNING) ||
      skillId % 10000000 === 1000;
    // a spell without a projectile takes its monsters in a random order (Chain Lightning: along its chain)
    if (kind === 'magic' && !projectile && skillId !== CHAIN_LIGHTNING) for (let i = 0; i < out.length; i++) { const j = Math.floor(Math.random() * out.length); [out[i], out[j]] = [out[j], out[i]]; }
    for (const [i, t] of out.entries()) {
      t.mob.pendingHits = (t.mob.pendingHits || 0) + 1;
      const land = () => {
        const strong = Math.random() * 100 < knockback;
        if (--t.mob.pendingHits <= 0 && !t.mob.queuedKill) this.releaseDrops(t.mob);   // no kill came after all
        if (t.mob.pendingHits <= 0 && t.mob.queuedKill) {               // the killing blow: hit, then die
          t.mob.hit(t.dmg.reduce((a, b) => a + b, 0), !p.facingRight, strong); if (skillId !== HEAVENS_HAMMER) this.damageNumbers(t.mob, t.dmg, true, skillId, t.crit, ...this.lineTiming(p)); this.playHitEffect(skillId, t.mob, p, t.dmg);
          this.after(lineDelay(skillId, t.dmg.length - 1, ...this.lineTiming(p)), () => this.finishKill(t.mob));   // it dies after its last line lands
          return;
        }
        t.mob.hit(t.dmg.reduce((a, b) => a + b, 0), !p.facingRight, strong); if (skillId !== HEAVENS_HAMMER) this.damageNumbers(t.mob, t.dmg, true, skillId, t.crit, ...this.lineTiming(p)); this.playHitEffect(skillId, t.mob, p, t.dmg);
        if (t.mob.kind === 'Mob') t.mob.chase(p);                 // a struck monster comes after you
      };
      // the hit (or the shot) comes when the swing connects, not when it starts
      if (plan) this.after(hitDelay + plan.targets[i].delay, land);
      else if (projectile) this.after(hitDelay, () => this.shoot(skillId, p, t.mob, kind === 'ranged' ? ammo : 0, land));
      else this.after(hitDelay + hitWave(i, kind, skillId), land);
      if (skillId === CHAIN_LIGHTNING) this.boltAt(hitDelay + hitWave(i, kind, skillId), i ? out[i - 1].mob : p, t.mob, skillId);
    }
    if (plan) this.shotFx(plan, p, skillId, ld, ammo, hitDelay);
    else if (projectile && !out.length) this.after(hitDelay, () => this.shoot(skillId, p, null, kind === 'ranged' ? ammo : 0, null));
    if (MAGIC_AT_ONCE.has(skillId)) this.teleportLock = performance.now() + TELEPORT_AFTER_ULTIMATE;
    if (heal && !out.length) return true;   // no undead in reach: only the heal went out
    this.net?.attack(kind, { targets: out, lines, skill: skillId, stance: this.actionId(pose, kind === 'ranged'), facingLeft: !p.facingRight,
      speed: this.attackSpeed(), charge, display: opts.stage2 ? 0x20 : 0 });
    // Assassinate: once its first pose ends, if it found a monster, the finishing blow from 100px ahead
    if (skillId === ASSASSINATE && !opts.stage2 && out.length) {
      const first = out[0].mob, len = this.frameTime(pose, this.look.frameCount(pose)) * scale;
      this.after(len, () => {
        if (this.dead || this.weaponId() !== weapon || !this.blinkAhead(-(ld?.lt?.[0] || 100))) return;
        this.attack(ASSASSINATE, 'melee', { stage2: true, pose: 'assassinationS', prefer: first });
      });
    }
    if (RUSH_DASH.has(skillId) && out.length) this.startRush(ld, out.map((t) => t.mob));
    if (SHAKERS.has(skillId)) this.startShake(skillId, 400, hitDelay);
    if (skillId && !opts.final && !opts.held) this.rollFinalAttack(skillId, wcat % 100, hitDelay, pose, scale);
    return true;
  }

  /** The screen shake of a skill landing (see SHAKERS); `near` is 400 for your own, 400 less the distance for another's. */
  startShake(skillId, near, delay) {
    if (!settings.shake || near <= 0) return;
    const shout = skillId === SHOUT;
    this.after(delay, () => { this.shake = { s: near / (shout ? 15 : 25), f: shout ? 0.85 : 0.92, left: shout ? 1500 : 2000, acc: 0, dx: 0, dy: 0 }; });
  }
  shakeStep(dt) {
    const k = this.shake;
    k.acc += dt * 1000; k.left -= dt * 1000;
    while (k.acc >= DASH_TICK && this.shake) {
      k.acc -= DASH_TICK;
      const r = Math.trunc(k.s);
      k.dx = r ? Math.floor(Math.random() * (2 * r)) - r : 0; k.dy = r ? Math.floor(Math.random() * (2 * r)) - r : 0;
      k.s *= k.f;
      if (k.s < 1 || k.left <= 0) this.shake = null;
    }
  }
  /** Rush: dash ahead (see RUSH_DASH) and throw the monsters struck ahead of where you started. */
  startRush(ld, mobs) {
    const p = this.player, dir = p.facingRight ? 1 : -1, v = dir * Math.abs(Math.trunc((ld?.lt?.[0] || 0) / 8));
    this.rush = { steps: [{ type: 0, v, ms: 90 }, { type: 2, v, ms: 180 }], acc: 0 };
    this.rushLock = performance.now() + RUSH_LOCK;
    const reach = -(ld?.lt?.[0] || 0);
    for (const m of mobs) if (!m.src?.info?.boss) m.pull = { x: p.x + dir * (Math.floor(Math.random() * 20) + reach + 35), stop: 0 };
  }
  /** The floor nearest (x, y) within `reach` px up or down. */
  floorNear(x, y, reach) {
    const down = this.map.fh.below(x, y, reach), up = this.map.fh.below(x, y - reach, reach);
    const dy = (f) => (f ? Math.abs(Footholds.yAt(f, x) - y) : Infinity);
    return dy(down) <= dy(up) ? down : up;
  }
  /** Move straight to the floor `dx` px ahead (within 80px up or down); false when there is none. */
  blinkAhead(dx) {
    const p = this.player, x = p.x + (p.facingRight ? dx : -dx), fh = this.floorNear(x, p.y, 80);
    if (!fh) return false;
    p.x = x; p.y = Footholds.yAt(fh, x); p.fh = fh; p.vx = 0; p.vy = 0;
    return true;
  }
  /** One 30ms step of the dash: along the floor within the step's length up or down, or the dash ends. */
  rushStep() {
    const r = this.rush, p = this.player, step = r.steps[0];
    if (!step) { this.rush = null; return; }
    if (step.ms <= 0) { r.steps.shift(); return this.rushStep(); }
    step.ms -= DASH_TICK;
    if (!step.v) { this.rush = null; return; }
    if (step.type === 2) step.v = Math.trunc(step.v * 0.8);
    const x = p.x + step.v, reach = Math.max(Math.abs(step.v), step.type === 2 ? 0 : 30);
    const down = this.map.fh.below(x, p.y, reach), up = this.map.fh.below(x, p.y - reach, reach);
    const dy = (f) => (f ? Math.abs(Footholds.yAt(f, x) - p.y) : Infinity), fh = dy(down) <= dy(up) ? down : up;
    if (!fh) { this.rush = null; return; }
    p.x = x; p.y = Footholds.yAt(fh, x); p.fh = fh;
  }
  /**
   * A skill's Final Attack (see FINAL_POSES): the first learned one listed for the weapon you hold, at its prop chance,
   * a third of the way from the blow to the end of the pose.
   */
  rollFinalAttack(skillId, wtype, hitDelay, pose, scale) {
    const sb = this.skills, list = sb.node(skillId)?.finalAttack;
    if (!list) return;
    const now = Date.now(), wpn = this.weaponId();
    for (const [id, types] of Object.entries(list)) {
      const fa = Number(id), ld = sb.level(fa) && sb.levelData(fa);
      if (!ld || !Object.values(types).includes(wtype)) continue;
      if (BUFFED_FINALS.has(fa) && !this.buffs.some((b) => b.source === fa && b.until > now)) continue;
      if (Math.floor(Math.random() * 101) > (ld.prop || 0)) return;
      let total = 0;
      for (let i = 0; i < this.look.frameCount(pose); i++) total += this.look.delay(pose, i);
      const at = hitDelay + (total * scale - hitDelay) / 3;
      this.after(at, () => {
        if (this.dead || this.weaponId() !== wpn) return;
        const ranged = RANGED_WEAPONS.has(Math.floor(wpn / 10000));
        const poses = (FINAL_POSES[this.look.weapon?.info?.attack] || []).filter((a) => this.look.has(a));
        const finalPose = poses[Math.floor(Math.random() * poses.length)];
        this.attack(fa, ranged ? 'ranged' : 'melee', { final: true, pose: finalPose, from: ranged ? 65 : undefined });
      });
      return;
    }
  }

  /** Chain Lightning's bolt from one link to the next, timed to arrive as the hit lands. */
  boltAt(at, from, to, skillId) {
    const dur = Math.min(0.45, Math.max(0.12, Math.abs(to.x - from.x) / 1200)) * 1000;
    this.after(Math.max(0, at - dur), () => this.shoot(skillId, from, to, 0, null));
  }

  /** A Flame Gear's box (its lt/rb where you stand) overlaps one already burning. */
  flameGearBlocked(lv) {
    const r = this.skills.range(FLAME_GEAR, lv), p = this.player;
    if (!r) return false;
    const box = { left: p.x + r.lt[0], top: p.y + r.lt[1], right: p.x + r.rb[0], bottom: p.y + r.rb[1] };
    return [...(this.mists?.values() || [])].some((m) => m.skill === FLAME_GEAR &&
      m.left < box.right && box.left < m.right && m.top < box.bottom && box.top < m.bottom);
  }

  /**
   * Attack speed, as v83 does it: every frame of an attack lasts (speed + 10) / 16 of its delay, where
   * speed is the weapon's attackSpeed (2 fastest .. 9 slowest, 6 normal), two faster under a Booster.
   */
  attackSpeed() {
    let speed = this.windows?.info(this.weaponId())?.attackSpeed ?? 6;
    if ((this.buffs || []).some((b) => BOOSTERS.has(b.source) && b.until > Date.now())) speed -= 2;
    return Math.max(2, Math.min(9, speed));
  }
  attackScale(speed = this.attackSpeed()) { return (speed + 10) / 16; }
  /** The frame a swing's afterimage (its trail) plays on; when it lands is the look's attackDelay. */
  hitFrame(action, kind) {
    const last = Math.max(0, this.look.frameCount(action) - 1);
    if (kind === 'ranged') return Math.min(1, last);
    if (kind === 'magic') return last;
    const node = this.afterimage?.[this.afterimageLevel()]?.[action];
    const keys = node ? Object.keys(node).filter((k) => /^\d+$/.test(k)).map(Number) : [];
    return keys.length ? Math.min(...keys) : last;
  }
  /** Milliseconds from the start of an action to the start of frame n (unscaled). */
  frameTime(action, n) { let t = 0; for (let i = 0; i < n; i++) t += this.look.delay(action, i); return t; }
  afterimageLevel() { return Math.min(10, Math.floor((this.stats?.level || 1) / 10)); }
  /** Character/Afterimage/<weapon's afterImage>.img: the swing trail for this action, by level tens. */
  async loadAfterimage() {
    const name = this.windows?.info(this.weaponId())?.afterImage;
    if (name === this.afterimageName) return;
    this.afterimageName = name; this.afterimage = null;
    if (!name) return;
    const img = await this.assets.json(`Character/Afterimage/${name}.img`);
    if (this.afterimageName === name) this.afterimage = img;
  }
  async playAfterimage(action, frame) {
    const p = this.player, node = this.afterimage?.[this.afterimageLevel()]?.[action]?.[frame];
    const fx = Game.fxNode(node);
    if (!fx) return;
    const anim = new Anim(fx, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, follow: p, flip: p.facingRight });
  }
  /** Run fn after ms of game time (timers pause with the game, unlike setTimeout). */
  after(ms, fn) { if (ms <= 0) fn(); else (this.timers ??= []).push({ t: ms / 1000, fn }); }
  runTimers(dt) {
    if (!this.timers?.length) return;
    const due = [];
    this.timers = this.timers.filter((x) => ((x.t -= dt) > 0 ? true : (due.push(x.fn), false)));
    for (const fn of due) fn();
  }

  defaultAttackAction(kind) {
    return (kind === 'ranged' && this.look.shootAction()) || this.look.attackAction();
  }

  /**
   * Monster Magnet and Big Bang start charging on their key press, standing still in their prepare pose, and go off
   * when it is let go (up to 1s counts). Explosion winds up in its prepare pose first, then goes off by itself. Others
   * are told it is coming (SKILL_EFFECT).
   */
  holdCharge(id, lv) {
    if (this.charging) return true;
    const p = this.player, node = this.skills.node(id), ld = this.skills.levelData(id, lv);
    if (id !== EXPLOSION && !this.skillKeyPressed) return false;
    if (!p.fh || p.attack) return false;
    if (MONSTER_MAGNETS.has(id) && (this.map.info?.fieldLimit || 0) & FIELD_NO_MOVEMENT_SKILLS) return false;
    if (this.net && (ld?.mpCon || 0) > this.stats.mp) { this.notice('Not enough MP.'); return false; }
    const pose = node?.prepare?.action || 'alert';
    p.attackScale = this.attackScale();
    const prepare = id === EXPLOSION ? (this.frameTime(pose, this.look.frameCount(pose)) * p.attackScale) / 1000 : 0;
    this.charging = { id, lv, t: 0, pose, prepare };
    this.net?.skillEffect(id, lv, this.actionId(pose), !p.facingRight, this.attackSpeed());
    if (node?.keydown) this.loopSkillEffect(id, p, 'keydown', () => this.charging?.id === id);
    if (frames(node?.prepare).length) this.playSkillEffect(id, p, false, 'prepare');
    return true;
  }
  releaseCharge() {
    const c = this.charging;
    this.charging = null;
    if (MONSTER_MAGNETS.has(c.id)) return this.releaseMagnet(c);
    this.attack(c.id, 'magic', { charge: Math.round(Math.min(c.t, CHARGE_HOLD) * 1000) });
  }
  /** A skill's looping art on `ent` for as long as `keep()` holds. */
  async loopSkillEffect(id, ent, branch, keep) {
    const fx = Game.fxNode((await this.skills?.ensure(id))?.[branch]);
    if (!fx || !keep()) return;
    const anim = new Anim(fx, true);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, follow: ent, keep });
  }
  /**
   * Let go: up to mobCount monsters (fewer the shorter it was held) whose bodies reach into a wedge in front of you,
   * from 50px out to its range, centred 28px up and spreading a quarter of the distance up and down (checked in 20px
   * steps). Each (not a boss, nor one that can't move) is caught at its prop chance and drawn in; it does no damage.
   * The server is told which were caught.
   */
  releaseMagnet({ id, lv, t }) {
    const p = this.player, ld = this.skills.levelData(id, lv) || {};
    const n = Math.floor((((ld.mobCount || 1) - 1) * Math.min(t, CHARGE_HOLD)) / CHARGE_HOLD) + 1;
    const dir = p.facingRight ? 1 : -1, range = ld.range || 0, y = p.y - 28;
    const reaches = (m) => {
      const h = m.hitBox(true);
      for (let d = 50; d < range; d += 20) {
        const a = p.x + dir * d, b = p.x + dir * Math.min(d + 20, range), spread = Math.floor(d / 4);
        if (h.right > Math.min(a, b) && h.left < Math.max(a, b) && h.bottom > y - spread && h.top < y + spread) return true;
      }
      return false;
    };
    const reached = this.liveMobs().filter((m) => !m.src?.info?.damagedByMob && reaches(m)).slice(0, n);   // escorted monsters can't be caught
    const caught = reached.map((m) => [m, !m.src.info?.boss && !!m.anims.move && Math.random() * 100 < (ld.prop ?? 100)]);
    for (const [m, ok] of caught) if (ok) m.pull = { x: p.x, stop: (m.node?._w || 40) + 45 };
    this.net?.magnet(id, lv, caught.map(([m, ok]) => [m.oid, ok]), !p.facingRight);
    this.playSkillEffect(id, p);
  }

  /**
   * Hurricane and Piercing Arrow start on their key press: their prepare pose and art, then their keydown art while
   * held, and the server hears they started so others see it.
   */
  holdKeydown(id, lv) {
    if (this.keydown) return true;
    const p = this.player, sb = this.skills, ld = sb.levelData(id, lv), wcat = Math.floor(this.weaponId() / 10000);
    if (!this.skillKeyPressed || p.attack) return false;
    if (this.net) {
      if (!sb.weaponOk(id, this.weaponId())) { this.notice('You cannot use this skill with the weapon you are holding.'); return false; }
      if (!this.hasAmmo(id)) { this.notice(AMMO_OUT[wcat] || AMMO_OUT[145]); return false; }
      if ((ld?.mpCon || 0) > this.stats.mp) { this.notice('Not enough MP.'); return false; }
    }
    // a monster within the bow's swing gets the swing (or a Mortal Blow) and Hurricane doesn't start
    if (HURRICANES.has(id) && this.findTargets('melee', 0, 0, 1, this.look.attackAction(), CLOSE_REACH).length) return this.attack(0);
    const action = sb.node(id)?.prepare?.action;
    const pose = action && this.look.has(action) ? action : this.defaultAttackAction('ranged');
    this.keydown = { id, lv, t: 0, tick: 0, last: -Infinity, pose };
    p.frame = 0; p.frameT = 0;
    this.net?.skillEffect(id, lv, this.actionId(pose), !p.facingRight, this.attackSpeed());
    sfx.play(`Skill/${pad(id, 7)}/Use`);
    this.keydownArt(this.keydown);
    return true;
  }
  /** The prepare art once, then the keydown art over and over while the key stays held. */
  async keydownArt(k) {
    const node = await this.skills.ensure(k.id), p = this.player;
    const prep = Game.fxNode(node?.prepare), loop = Game.fxNode(node?.keydown);
    const show = async (n, repeat) => {
      const anim = new Anim(n, repeat);
      await this.assets.preload(anim.frames);
      if (this.keydown !== k) return null;
      const f = { anim, follow: p }; this.fx.push(f); return f;
    };
    if (prep) {
      k.art = await show(prep, false);
      const ms = frames(prep).reduce((t, f) => t + (f?.delay || 100), 0);
      await new Promise((r) => this.after(ms, r));
    }
    if (loop && this.keydown === k) { this.fx = this.fx.filter((f) => f !== k.art); k.art = await show(loop, true); }
  }
  /**
   * Hurricane while held: a shot each time 101ms have passed on the 30ms clock. Out of arrows or MP it stops; a monster
   * within the bow's swing stops it too, and gets the swing.
   */
  hurricaneShot(k) {
    while (this.keydown === k && (k.tick + 1) * TICK <= k.t * 1000) {
      const now = ++k.tick * TICK;
      if (now - k.last < HURRICANE_GAP) continue;
      k.last = now;
      this.hurricaneFire(k);
    }
  }
  hurricaneFire(k) {
    const ld = this.skills.levelData(k.id, k.lv), wcat = Math.floor(this.weaponId() / 10000);
    if (this.net && !this.hasAmmo(k.id)) { this.notice(AMMO_OUT[wcat] || AMMO_OUT[145]); this.endKeydown(); return; }
    if (this.net && (ld?.mpCon || 0) > this.stats.mp) { this.notice("You don't have enough MP to use this skill."); this.endKeydown(); return; }
    if (this.findTargets('melee', 0, 0, 1, this.look.attackAction(), CLOSE_REACH).length) { this.endKeydown(); this.attack(0); return; }
    this.attack(k.id, 'ranged', { held: true, pose: k.pose });
  }
  /**
   * Letting go: Hurricane ends (the server hears it, its keydownend art plays). Piercing Arrow fires with how long it
   * was charged (30ms to 1s), unless a monster within the swing gets the swing instead.
   */
  endKeydown() {
    const k = this.keydown, p = this.player;
    if (!k) return;
    this.keydown = null;
    this.fx = this.fx.filter((f) => f !== k.art);
    p.frame = 0; p.frameT = 0;
    if (k.id === PIERCING_ARROW && !this.dead) {
      const close = this.findTargets('melee', 0, 0, 1, this.look.attackAction(), CLOSE_REACH).length;
      const charge = Math.min(PIERCE_HOLD, Math.max(30, Math.round(k.t * 1000)));
      if (!close && this.attack(k.id, 'ranged', { charge })) return;
      this.net?.cancelBuff(k.id);
      if (close) this.attack(0);
      return;
    }
    this.net?.cancelBuff(k.id);
    this.skills.ensure(k.id).then((n) => {
      const end = Game.fxNode(n?.keydownend);
      if (!end) return;
      const anim = new Anim(end, false);
      this.assets.preload(anim.frames).then(() => this.fx.push({ anim, follow: p }));
    });
  }

  /** Buffs and other SPECIAL_MOVE skills. */
  castSpecial(id, lv) {
    if (TELEPORTS.has(id)) return this.teleport(id, lv);
    if (id === HEAL) return this.castHeal(id, lv);
    const p = this.player, node = this.skills.node(id);
    const action = this.skills.action(id) || 'alert2';
    if (this.look.has(action)) { p.attack = action; p.frame = 0; p.frameT = 0; p.action = action; }
    this.playSkillEffect(id, p);
    const needsPos = node?.summon || id === 2311002; // summons and Mystic Door are placed at the caster
    this.net?.specialMove(id, lv, needsPos ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
    return true;
  }

  /** Heal: the party heal goes out (with the members it reaches), then its strike on the undead in its box. */
  castHeal(id, lv) {
    if (this.player.ladder) return false;
    this.playSkillEffect(id, this.player);
    this.net?.heal(id, lv, this.partyMask(id, lv));
    return this.attack(id, 'magic', { heal: true });
  }

  /**
   * The party members a skill reaches, one bit per party slot, the first slot highest: you always, the others when
   * they stand in its box. 0x80 when you aren't in a party.
   */
  partyMask(id, lv) {
    const members = this.party?.members;
    if (!members) return 0x80;
    const p = this.player, r = this.skills.range(id, lv);
    const [x1, x2] = !r ? [0, -1] : p.facingRight ? [p.x - r.rb[0], p.x - r.lt[0]] : [p.x + r.lt[0], p.x + r.rb[0]];
    let mask = 0;
    for (let i = 0; i < 6; i++) {
      mask <<= 1;
      const m = members[i];
      if (!m) continue;
      const rp = this.others.get(m.id);
      if (m.id === p.id || (rp && rp.state !== 'dead' && rp.x >= x1 && rp.x < x2 && rp.y >= p.y + r.lt[1] && rp.y < p.y + r.rb[1])) mask |= 1;
    }
    return mask;
  }

  // ------------------------------------------------------------------ the field's timer
  async loadClockArt() {
    if (this.clockArt) return;
    const etc = await this.assets.json('Map/Obj/etc.img');
    const art = { box: etc?.timer?.backgrnd, boxHour: etc?.timer?.backgrndhour, digits: etc?.clock?.fontTime };
    await this.assets.preload([art.box, art.boxHour, ...Object.values(art.digits || {})].filter(Boolean));
    this.clockArt = art;
  }
  /**
   * Map/Obj/etc.img/timer at the top centre: "Time Left" with minutes and seconds (clock/fontTime digits, its
   * comma between), or from an hour up the Hr / Min box with hours and minutes. It stays on 00:00 at the end until
   * the server takes it away.
   */
  drawClock(ctx) {
    const art = this.clockArt;
    if (!this.clock || !art?.digits) return;
    const left = Math.max(0, Math.ceil((this.clock.end - performance.now()) / 1000));
    const hours = left >= 3600, box = this.assets.image(hours ? art.boxHour : art.box);
    if (!box) return;
    const bx = Math.round((VIEW_W - box.width) / 2), by = 22;   // under the server's scrolling notice
    ctx.drawImage(box, bx, by);
    const two = (n) => String(n).padStart(2, '0');
    const put = (ch, x) => { const img = this.assets.image(art.digits[ch]); if (img) ctx.drawImage(img, bx + x, by + 11); return img?.width || 0; };
    if (hours) {
      const [h, m] = [two(Math.min(99, Math.floor(left / 3600))), two(Math.floor(left / 60) % 60)];
      put(h[0], 98); put(h[1], 124); put(m[0], 176); put(m[1], 202);
    } else {
      const [m, s] = [two(Math.floor(left / 60)), two(left % 60)];
      let x = 105;
      for (const ch of [m[0], m[1], 'comma', s[0], s[1]]) x += put(ch, x);
    }
  }

  // ------------------------------------------------------------------ ships and the station clock
  /**
   * The map's shipObj: the ship at a station (shipKind 0) or the Balrog's ship on a voyage (1). It is drawn at x
   * when in; it sails in from x0 and back out there over tMove seconds. A voyage's ship has no x0: it comes from
   * 800px behind the way it faces (art faces left, f flips it) - our reading, not recovered.
   */
  async setupShip() {
    const o = this.map?.data?.shipObj;
    this.ship = null;
    if (!o?.shipObj) return;
    const map = this.map, x0 = o.x0 ?? o.x + (o.f ? -800 : 800);
    const ship = { x: o.x, y: o.y, x0, flip: !!o.f, tMove: (o.tMove || 1) * 1000, state: 'gone', from: x0, to: x0, t0: 0, node: null };
    this.ship = ship;
    // Map/Obj/<image>[.img]/<path...>: usually vehicle.img (written with or without .img), the Genie's in acc8.img
    const [, img, path] = String(o.shipObj).match(/^Map\/Obj\/([^/]+?)(?:\.img)?\/(.+)$/) || [];
    if (!img) return;
    let node = await this.assets.json(`Map/Obj/${img}.img`);
    for (const k of path.split('/')) node = node?.[k];
    node = node?.[0] || node;
    if (!node) return;
    await this.assets.preload([node]);
    if (this.map === map) ship.node = node;
  }
  /** The server says the ship is in (true) or gone; on arriving at the map that is how it already is, no sailing. */
  moveShip(here) {
    const s = this.ship;
    if (!s) return;
    const now = performance.now(), entering = now - (this.mapEnteredAt || 0) < 1500;
    const at = this.shipX();
    s.state = here ? 'in' : 'gone';
    s.from = entering ? (here ? s.x : s.x0) : at; s.to = here ? s.x : s.x0; s.t0 = entering ? now - s.tMove : now;
  }
  shipX() {
    const s = this.ship;
    if (!s) return 0;
    const k = Math.min(1, (performance.now() - s.t0) / s.tMove), e = k * k * (3 - 2 * k);   // eased in and out
    return s.from + (s.to - s.from) * e;
  }
  drawShip(ctx, cam) {
    const s = this.ship, img = s?.node && this.assets.image(s.node);
    if (!img || (s.state === 'gone' && performance.now() - s.t0 >= s.tMove)) return;
    const o = s.node.origin || [0, 0], x = Math.round(this.shipX() - cam.x), y = Math.round(s.y - cam.y);
    if (!s.flip) { ctx.drawImage(img, x - o[0], y - o[1]); return; }
    ctx.save(); ctx.translate(x + o[0], y - o[1]); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore();
  }
  /** A station's clock (the map's clock box): the time of day, am / pm and hours, its comma, minutes, centred. */
  drawFieldClock(ctx, cam) {
    const c = this.map?.data?.clock, art = this.clockArt;
    if (!c || !this.fieldClock || !art?.digits) return;
    const t = Math.floor(this.fieldClock.secs + (performance.now() - this.fieldClock.at) / 1000) % 86400;
    const h24 = Math.floor(t / 3600), h = h24 % 12 || 12, m = Math.floor(t / 60) % 60;
    const parts = [h24 < 12 ? 'am' : 'pm', ...String(h).padStart(2, '0'), 'comma', ...String(m).padStart(2, '0')];
    const imgs = parts.map((p) => this.assets.image(art.digits[p]));
    if (imgs.some((i) => !i)) return;
    const w = imgs.reduce((a, i) => a + i.width, 0);
    let x = Math.round(c.x + (c.width - w) / 2 - cam.x);
    const cy = c.y + c.height / 2 - cam.y;
    for (const img of imgs) { ctx.drawImage(img, x, Math.round(cy - img.height / 2)); x += img.width; }
  }

  // ------------------------------------------------------------------ mists
  /**
   * A mist over a box of the map: the skill's `tile` clouds (a monster's from MobSkill.img/<skill>/level/<n>), each
   * pulsing on its own. How the client spreads them was not recovered: here one cloud per 90x70 cell (about a
   * cloud's size), a random one of the eight, nudged a little and started at a random point of its pulse.
   */
  async addMist(d) {
    this.mists ??= new Map();
    const node = d.kind === 0 ? (await this.mobSkillLevel(d.skill, d.level))?.tile : (await this.skills?.ensure(d.skill))?.tile;
    const kinds = Object.keys(node || {}).filter((k) => /^\d+$/.test(k)).map((k) => node[k]);
    if (!kinds.length) return;
    const w = d.right - d.left, h = d.bottom - d.top, cols = Math.max(1, Math.round(w / 90)), rows = Math.max(1, Math.round(h / 70));
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const anim = new Anim(kinds[Math.floor(Math.random() * kinds.length)], true);
        anim.update(Math.random() * 1500);
        tiles.push({ anim, x: d.left + (c + 0.5) * (w / cols) + (Math.random() - 0.5) * 20, y: d.top + (r + 0.5) * (h / rows) + (Math.random() - 0.5) * 16 });
      }
    }
    await this.assets.preload(tiles.flatMap((t) => t.anim.frames));
    this.mists.set(d.oid, { ...d, tiles });
  }
  drawMists(ctx, cam) {
    for (const m of this.mists?.values() || []) {
      for (const t of m.tiles) {
        const n = t.anim.node, img = n && this.assets.image(n);
        if (!img) continue;
        const o = n.origin || [0, 0];
        ctx.save(); ctx.globalAlpha *= t.anim.alpha;
        ctx.drawImage(img, Math.round(t.x - o[0] - cam.x), Math.round(t.y - o[1] - cam.y));
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------------ Mystic Door
  /**
   * A Mystic Door's end on this map (Skill/231.img/skill/2311002): out in the field the pulsing mDoor, in town the
   * opening cDoor (openms's pairing). One just opened can't be used for 3s (Cosmic's deployment).
   */
  async addDoor(key, x, y, town, launched, to = 0) {
    this.doors ??= new Map();
    const d = { owner: key === 'town' ? this.player.id : key, x, y, town, to, readyAt: performance.now() + (launched ? 0 : 3000), anim: null };
    this.doors.set(key, d);
    const sk = await this.skills?.ensure(2311002);
    const node = sk?.[town ? 'cDoor' : 'mDoor'];
    if (!node) return;
    const anim = new Anim(node, !town);
    if (town) anim.holdLast = true;
    await this.assets.preload(anim.frames);
    d.anim = anim;
  }
  /** Up within 20px across and 50px up or down of a door takes you through it (to town, or back out). */
  useDoorAt(p) {
    for (const d of this.doors?.values() || []) {
      if (Math.abs(p.x - d.x) >= 20 || Math.abs(p.y - d.y) >= 50) continue;
      if (performance.now() < d.readyAt) return true;
      this.net?.useDoor(d.owner, d.town);
      return true;
    }
    return false;
  }
  drawDoors(ctx, cam) {
    for (const d of this.doors?.values() || []) {
      const n = d.anim?.node, img = n && this.assets.image(n);
      if (!img) continue;
      const o = n.origin || [0, 0];
      ctx.save(); ctx.globalAlpha *= d.anim.alpha;
      ctx.drawImage(img, Math.round(d.x - o[0] - cam.x), Math.round(d.y - o[1] - cam.y));
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ sitting
  /** Sitting needs you standing still on the ground (the client's check), and 200ms since the last try. */
  canSit() {
    const p = this.player;
    if (!p.fh || p.ladder || p.attack || p.seat || this.dead || Math.abs(p.vx || 0) > 1) return false;
    if (performance.now() - (this.lastSit || 0) < 200) return false;
    this.lastSit = performance.now();
    return true;
  }
  /** The Sit key: the map's first seat within 10px across and 30px up or down; you move onto it. */
  trySit() {
    const p = this.player;
    if (!this.canSit()) return false;
    const hit = Object.entries(this.map.data?.seat || {}).find(([, s]) => p.x >= s[0] - 10 && p.x < s[0] + 10 && Math.abs(p.y - s[1]) <= 30);
    if (!hit) return false;
    const [id, [x, y]] = hit;
    p.seat = { id: Number(id), item: 0 }; p.x = x; p.y = y; p.vx = 0;
    this.net?.cancelChair(Number(id));
    return true;
  }
  /** A chair item (double-clicked, or on a key): you sit where you stand, the chair under you. Again stands you up. */
  sitChair(itemId) {
    const p = this.player;
    if (p.seat) { this.standUp(); return; }
    if (!this.canSit()) return;
    p.seat = { id: null, item: itemId }; p.vx = 0;
    this.chairArt(itemId);
    this.net?.useChair(itemId);
  }
  /** Off the seat or chair; tell is false when the server already stood you up. */
  standUp(tell = true) {
    const p = this.player;
    if (!p.seat) return;
    p.seat = null;
    if (p.fh) p.y = Footholds.yAt(p.fh, p.x);
    if (tell) this.net?.cancelChair(-1);
  }
  /** Item/Install/0301.img/<id>/effect: the chair's picture (loaded once per chair). */
  chairArt(id) {
    this.chairs ??= new Map();
    if (!this.chairs.has(id)) {
      this.chairs.set(id, null);
      this.assets.json('Item/Install/0301.img').then(async (img) => {
        const node = img?.[pad(id, 8)]?.effect;
        if (!node) return;
        const anim = new Anim(node, true);
        await this.assets.preload(anim.frames);
        this.chairs.set(id, anim);
      });
    }
    return this.chairs.get(id);
  }
  /**
   * The chair behind its sitter, flipped with them. Its art is anchored with its bottom on their feet (openms's
   * reading: the canvas's height less its origin lifts every chair onto the floor; not a recovered rule).
   */
  drawChair(ctx, id, sx, sy, facingRight) {
    const anim = this.chairArt(id);
    if (!anim?.frames.length) return;
    const total = anim.frames.reduce((t, f) => t + (f.delay || 100), 0);
    let t = performance.now() % total, n = anim.frames[0];
    for (const f of anim.frames) { if (t < (f.delay || 100)) { n = f; break; } t -= f.delay || 100; }
    const img = this.assets.image(n);
    if (!img) return;
    const ox = n.origin?.[0] || 0, top = Math.round(sy - img.height);
    if (!facingRight) { ctx.drawImage(img, Math.round(sx - ox), top); return; }
    ctx.save(); ctx.translate(Math.round(sx + ox), top); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore();
  }

  /**
   * Teleport: up to `range` px in the held direction, only while standing on a floor and holding a direction (left
   * or right wins over up or down). Sideways it lands on the nearer floor within 80px above or below that spot. Up it
   * lands on the highest floor within range above, down on the lowest within range below; with none, it goes off in
   * place. A monster that can't be passed by Teleport between you and the spot stops it, and so does a map that
   * forbids movement skills. It can be used again 600ms after it lands (3s after Meteor Shower, Blizzard or Genesis).
   * The new position reaches the server through the normal movement sync; SPECIAL_MOVE charges the MP.
   */
  teleport(id, lv) {
    const p = this.player, fh = this.map.fh, inp = this.input;
    if (!p.fh) return false;               // only from the ground: not mid-jump, falling or on a ladder / rope
    if (performance.now() < (this.teleportLock || 0)) return false;
    if ((this.map.info?.fieldLimit || 0) & FIELD_NO_MOVEMENT_SKILLS) return false;
    const dist = this.skills.levelData(id, lv)?.range || 130;
    const dy = inp.is('up') ? -1 : inp.is('down') ? 1 : 0, dx = inp.is('left') ? -1 : inp.is('right') ? 1 : 0;
    if (!dx && !dy) return false;          // only with a direction held: no MP spent, nothing happens
    const floorsAt = (x, lo, hi) => fh.floors.filter((f) => x >= f.x1 && x <= f.x2).map((f) => ({ f, y: Footholds.yAt(f, x) }))
      .filter((c) => c.y >= lo && c.y <= hi);
    let tx = p.x, to = null;
    if (dx) {
      tx = p.x + dx * dist;
      const below = floorsAt(tx, p.y, p.y + 79).sort((a, b) => a.y - b.y)[0];
      const above = floorsAt(tx, p.y - 79, p.y).sort((a, b) => b.y - a.y)[0];
      to = below && (!above || below.y - p.y <= p.y - above.y) ? below : above;
      if (!to) return false;
    } else {
      const found = dy < 0 ? floorsAt(p.x, p.y - dist, p.y).sort((a, b) => a.y - b.y)[0] : floorsAt(p.x, p.y, p.y + dist).sort((a, b) => b.y - a.y)[0];
      to = found || { f: p.fh, y: p.y };
    }
    // the way there: sideways from 65px up down to the held up / down direction's reach, up or down 40px wide
    const [x1, x2] = dx ? [Math.min(p.x, tx), Math.max(p.x, tx)] : [p.x - 20, p.x + 20];
    const reach = p.y + dist * dy, top = (dx ? p.y : Math.min(p.y, reach)) - 65, bottom = dx ? reach : Math.max(p.y, reach);
    const blocked = bottom > top && this.map.life.filter((m) => m.kind === 'Mob' && m.alive && !m.dying).filter((m) => {
      const h = m.hitBox(true);
      return h.right > x1 && h.left < x2 && h.bottom > top && h.top < bottom;
    }).slice(0, 15).some((m) => m.src.info?.cantPassByTeleport);
    if (blocked) return false;
    // the skill has no art of its own: BasicEff Teleport plays once, where you arrive
    this.teleportLock = performance.now() + TELEPORT_DELAY;
    p.x = tx; p.y = to.y; p.fh = to.f; p.vx = 0; p.vy = 0; p.ladder = null;
    this.playTeleportEffect(p.x, p.y);
    sfx.play(`Skill/${pad(id, 7)}/Use`);
    this.net?.specialMove(id, lv, null);
    return true;
  }
  async playTeleportEffect(x, y) {
    const node = (this.basicEff ??= await this.assets.json('Effect/BasicEff.img'))?.Teleport;
    if (!node) return;
    const anim = new Anim(node, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, x, y, flip: false });
  }

  /** Same rules as RangedAttackHandler: the first ammo in USE for the weapon with at least `count` left (or a skill that needs none). */
  ammoItem(count = 1) {
    const cat = Math.floor(this.weaponId() / 10000);
    const ok = { 145: (id) => Math.floor(id / 1000) === 2060, 146: (id) => Math.floor(id / 1000) === 2061,
      147: (id) => Math.floor(id / 10000) === 207, 149: (id) => Math.floor(id / 10000) === 233 }[cat];
    if (!ok) return 0;
    const use = this.inventory?.[2] || {};
    for (const k of Object.keys(use).map(Number).sort((a, b) => a - b)) if (ok(use[k].id) && use[k].quantity >= count) return use[k].id;
    return 0;
  }
  hasAmmo(skillId) {
    if (skillId % 10000000 === 1000 || NO_AMMO_SHOTS.has(skillId)) return true; // Three Snails, Soul Blade, Shark Wave
    const noAmmoBuffs = [...SOUL_ARROWS, 4121006]; // Soul Arrow x3, Shadow Claw
    if (this.buffs.some((b) => noAmmoBuffs.includes(b.source))) return true;
    const ld = skillId && this.skills.levelData(skillId);
    return !!this.ammoItem(ld?.bulletConsume || ld?.bulletCount || 1);
  }

  // ------------------------------------------------------------------ shots
  /** STR, DEX, INT or LUK with equipment and Maple Warrior. */
  totalStat(k) {
    const base = this.stats?.[k] || 0, now = Date.now();
    const mw = Math.max(0, ...(this.buffs || []).filter((b) => b.mapleWarrior && b.until > now).map((b) => b.mapleWarrior));
    return base + Math.floor((base * mw) / 100) + this.equipStat(k);
  }
  /** A learned passive skill's x / y / z, else 0. */
  passive(id, key) { return this.skills?.level(id) ? this.skills.levelData(id)?.[key] || 0 : 0; }
  /** Blessing of the Fairy for your job's branch (Explorer, Cygnus, Aran, Evan). */
  blessingId() {
    const job = this.stats?.job || 0;
    return Math.floor(job / 100) === 22 || job === 2001 ? 20010012 : Math.floor(job / 1000) * 10000000 + 12;
  }
  /** Nimble Body, Bullet Time, Quick Motion (and Amazon's, accuracy only): x accuracy, y avoid. */
  static BEGINNER_PASSIVES = [4000000, 14000000, 5000000, 15000000];
  /**
   * Accuracy without buffs: DEX x 0.8 + LUK x 0.5 (bowmen, thieves, pirates DEX x 0.6 + LUK x 0.3; Brawlers DEX x 0.9 +
   * LUK x 0.3), plus the equipment's, Blessing of the Fairy's z, the weapon mastery's x and the beginner passives' x.
   */
  accuracy() {
    const job = this.stats?.job || 0, cls = Math.floor((job % 1000) / 100), dex = this.totalStat('dex'), luk = this.totalStat('luk');
    const base = Math.floor(cls === 5 && Math.floor(job / 10) === 51 ? dex * 0.9 + luk * 0.3 : cls >= 3 && cls <= 5 ? dex * 0.6 + luk * 0.3 : dex * 0.8 + luk * 0.5);
    const ranged = cls === 3 || Math.floor(job / 10) === 41 || Math.floor(job / 10) === 52;
    const ms = masterySkills(Math.floor(this.weaponId() / 10000) % 100, ranged, 0, job);
    const mastery = (ms?.first || []).map((id) => this.passive(id, 'x')).find((v) => v) || 0;
    const passives = [3000000, ...Game.BEGINNER_PASSIVES].reduce((a, id) => a + this.passive(id, 'x'), 0);
    return base + this.equipStat('acc') + this.passive(this.blessingId(), 'z') + mastery + passives;
  }
  /** Avoid without buffs: LUK / 2 + DEX / 4 (Brawlers DEX x 1.5, Gunslingers DEX / 8), the equipment's, Blessing's z, the beginner passives' y. */
  avoidability() {
    const job = this.stats?.job || 0, dex = this.totalStat('dex'), luk = this.totalStat('luk'), branch = Math.floor(job / 10);
    const base = Math.trunc(luk / 2) + (branch === 51 ? Math.floor(dex * 1.5) : Math.trunc(dex / (branch === 52 ? 8 : 4)));
    return base + this.equipStat('avoid') + this.passive(this.blessingId(), 'z') + Game.BEGINNER_PASSIVES.reduce((a, id) => a + this.passive(id, 'y'), 0);
  }
  /**
   * Combo Attack's % on every blow while it is on, by the orbs held (its buff value less 1): with one orb the skill's
   * damage (Advanced Combo's once Combo Attack is maxed), then a little more for each orb up to five, by skill level,
   * and +24 to +40 from six to ten. Panic and Coma climb faster.
   */
  /** The White Knight / Paladin / Dawn Warrior charge on you: { id, ld, elem } or null. */
  activeCharge() {
    const now = Date.now(), b = (this.buffs || []).find((x) => CHARGES[x.source] && x.until > now);
    return b ? { id: b.source, ld: this.skills.levelData(b.source) || {}, elem: CHARGES[b.source] } : null;
  }
  /** Combo Attack's value while it is on: 1 + the orbs held (0 when it is off). */
  comboValue() { const now = Date.now(); return (this.buffs || []).find((b) => b.combo && b.until > now)?.combo || 0; }
  /** The orbs of whoever holds `value` (1 + orbs) round them, the ring centred 35px over their feet. */
  drawCombo(ctx, ent, sx, sy, value) {
    const orbs = Math.min(10, Math.max(0, value - 1)), now = performance.now();
    const seen = ent._orbs || (ent._orbs = { n: 0, born: [] });
    for (let i = seen.n + 1; i <= orbs; i++) seen.born[i] = now;
    seen.n = orbs;
    if (!orbs) return;
    if (!this.orbArt) {
      this.orbArt = 'loading';
      Promise.all([this.assets.json('Skill/111.img'), this.assets.json('Skill/112.img')]).then(async ([a, b]) => {
        const art = [a?.skill?.['1111002']?.state, b?.skill?.['1120003']?.state];
        await this.assets.preload(art.flatMap((st) => [1, 2, 3, 4, 5].map((k) => st?.[k]).filter(Boolean)));
        this.orbArt = art;
      });
    }
    if (!Array.isArray(this.orbArt)) return;
    const turn = (-2 * Math.PI * (now % ORB_TURN_MS)) / ORB_TURN_MS, cx = sx, cy = sy - 35;
    for (let i = Math.max(1, orbs - 4); i <= orbs; i++) {
      const node = this.orbArt[i < 6 ? 0 : 1]?.[Math.floor((i + 1) / 2)], img = node && this.assets.image(node);
      if (!img) continue;
      const k = Math.min(1, (now - (seen.born[i] || 0)) / (node.delay || 300));
      const a = ((node.a0 ?? 255) + ((node.a1 ?? 255) - (node.a0 ?? 255)) * k) / 255;
      const z = ((node.z0 ?? 100) + ((node.z1 ?? 100) - (node.z0 ?? 100)) * k) / 100;
      const ang = (i * 2 * Math.PI) / 5 + turn, o = node.origin || [0, 0];
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(Math.round(cx + Math.cos(ang) * ORB_RADIUS), Math.round(cy + Math.sin(ang) * ORB_RADIUS));
      ctx.scale(z, z);
      ctx.drawImage(img, -o[0], -o[1]);
      ctx.restore();
    }
  }
  comboPercent(skillId) {
    const now = Date.now(), held = (this.buffs || []).find((b) => b.combo && b.until > now)?.combo;
    if (!held) return 0;
    const orbs = held - 1, cygnus = Math.floor((this.stats?.job || 0) / 1000) === 1, sb = this.skills;
    const [combo, adv] = cygnus ? [11111001, 11110005] : [1111002, 1120003];
    const lvC = sb.level(combo), lvA = sb.level(adv);
    if (!lvC || orbs < 0) return 0;
    const [id, lv] = lvC === (cygnus ? 20 : 30) && lvA > 0 ? [adv, lvA] : [combo, lvC];
    const dmg = sb.levelData(id, lv)?.damage || 0;
    const steps = FINISHERS.has(skillId) ? [[24, 6], [64, 16], [120, 30], [184, 46], 250, 270, 290, 305, 320] : [[5, 0], [10, 0], [15, 0], [20, 0], 24, 28, 32, 36, 40];
    if (orbs < 1 || orbs > 10) return 100;
    if (orbs === 1) return dmg;
    const st = steps[orbs - 2];
    return Array.isArray(st) ? Math.trunc((lv * st[0] - st[0]) / 29) + st[1] + dmg : dmg + st;
  }
  /** A fixed-damage skill misses by level alone: your level x 100 / (255 + 150 per level the monster has over you), times 0.7-1.3, under its avoid. */
  fixedMiss(m) {
    const info = m.src?.info || {}, lv = this.stats?.level || 1, over = Math.max(0, (info.level || 0) - lv);
    const hit = (lv * 100) / (over * 150 + 255), r = hit * (0.7 + Math.random() * 0.6);
    return r < Math.min(999, Math.max(0, info.eva || 0));
  }
  /**
   * One damage line of a physical attack (shot or close up) on monster m:
   *  - it misses when your accuracy x 100 / (255 + 10 per level the monster has over you), times 0.7-1.3, is under
   *    its avoid (a GM's blows up close never miss and ignore the level gap; its shots don't);
   *  - the weapon's main stat is rolled between it x mastery and itself (mastery: (the mastery skill's value x 5 +
   *    10)% x 0.9), then (main x the weapon's multiplier + its other stats) x attack / 100 (see weaponDamage);
   *  - 1% less per level the monster has over you; its element: weak x1.5, strong x0.5, immune x0 (for Inferno and
   *    Blizzard only x% of that change); less 50-60% of its defence;
   *  - then the skill's damage %, and a critical adds its extra % of the line before the skill's %; Blizzard can't
   *    crit. Barrage's 5th line does double and its 6th four times; a charged skill (Piercing Arrow) does
   *    (charge ms x 90 / its longest charge + 10)%.
   */
  physicalHit(m, cat, skillId, ld, shot, pose, ammoId, crit, charge = 0, line = 0) {
    const info = m.src?.info || {}, rand = (lo, hi) => lo + Math.random() * (hi - lo), now = Date.now(), job = this.stats?.job || 0;
    // Ninja Storm's blows land only at its prop chance
    if (skillId === NINJA_STORM && Math.random() * 100 >= (ld?.prop ?? 100)) return { d: 0, c: false };
    const exempt = !shot && Math.floor((job % 1000) / 100) === 9;
    const over = exempt ? 0 : Math.max(0, (info.level || 0) - (this.stats?.level || 1));
    if (!exempt) {
      const accBuff = Math.max(0, ...(this.buffs || []).filter((b) => b.acc && b.until > now).map((b) => b.acc));
      const acc = Math.min(999, Math.max(0, this.accuracy() + accBuff));
      const hit = (acc * 100) / (over * 10 + 255);
      if (rand(hit * 0.7, hit * 1.3) < Math.min(999, Math.max(0, info.eva || 0))) return { d: 0, c: false };
    }
    if (skillId === SHADOW_MESO) return this.shadowMesoHit(info, ld, over);
    // Aran's blows are all swings; Rush and Blast swing three times in five; Brandish's second blow swings
    const aran = Math.floor(job / 100) === 21 || job === 2000;
    const asSwing = aran || (RUSHES.has(skillId) && Math.random() < 0.6) || (BRANDISHES.has(skillId) && line === 1);
    const f = weaponDamage(cat, shot, pose, skillId, job, asSwing);
    let mastery = f.mastery;
    if (mastery === undefined) {
      const ms = masterySkills(cat, shot, skillId, job), val = (id) => (this.skills.level(id) ? this.skills.levelData(id)?.mastery || 0 : 0);
      const over = (ms?.over || []).map(val).find((v) => v) || 0;
      const first = (ms?.first || []).map(val).find((v) => v) || 0;
      const v = over || first + (ms?.plus || []).reduce((a, id) => a + val(id), 0);
      mastery = (v * 5 + 10) * 0.009;
    }
    const main = this.totalStat(f.main), roll = rand(main * mastery, main);
    let d = ((roll * f.mult + f.sec.reduce((a, k) => a + this.totalStat(k), 0)) * this.attackWatk(shot ? ammoId : 0)) / f.div;
    if ((skillId === 5211004 || skillId === 5211005) && Math.floor(ammoId / 1000) !== (skillId === 5211004 ? 2331 : 2332)) d *= 0.5;
    if (over) d = ((100 - over) * d) / 100;
    const elem = skillId && this.skills.node(skillId)?.elemAttr;
    const vs = elem && new RegExp(`${elem.toUpperCase()}(\\d)`).exec(info.elemAttr || '')?.[1];
    if (vs) {
      const p = PART_ELEMENT.has(skillId) ? (ld?.x || 0) / 100 : 1;
      d = vs === '1' ? d * (1 - p) : vs === '2' ? d * (1 - p * 0.5) : vs === '3' ? Math.min(199999, Math.max(d, d * (1 + p * 0.5))) : d;
    }
    // a charge: its damage %, then its element at z% of the usual
    const held = this.activeCharge();
    if (held) {
      d = (d * (held.ld.damage || 100)) / 100;
      const cv = new RegExp(`${held.elem}(\\d)`).exec(info.elemAttr || '')?.[1], p = (held.ld.z || 0) / 100;
      d = cv === '1' ? d * (1 - p) : cv === '2' ? d * (1 - p * 0.5) : cv === '3' ? Math.min(199999, Math.max(d, d * (1 + p * 0.5))) : d;
    }
    const pdd = IGNORE_DEFENCE.has(skillId) ? 0 : Math.min(1999, Math.max(0, info.PDDamage || 0));
    const base = Math.trunc(d - rand(pdd * 0.5, pdd * 0.6));
    d = ld?.damage ? (base * ld.damage) / 100 : base;
    const combo = this.comboPercent(skillId);
    if (combo > 0) d = (d * combo) / 100;
    // a critical: Critical Shot / Throw, Sharp Eyes, and Stun Mastery on a stunned monster (+its prop and damage)
    let rate = crit?.rate || 0, extra = crit ? crit.dmg + 100 : 0;
    const stun = this.skills.level(STUN_MASTERY) && (m.status?.second & 0x80) && this.skills.levelData(STUN_MASTERY);
    if (stun) { rate += Math.max(0, Math.min(100, stun.prop || 0)); extra += stun.damage || 0; }
    const c = rate > 0 && extra > 0 && skillId !== BLIZZARD && Math.random() * 100 < rate;
    if (c) d += ((extra - 100) * base) / 100;
    // Assassinate: x(seconds in Dark Sight, up to its time, / 3 + 1)
    if (skillId === ASSASSINATE) d *= Math.floor(Math.min(this.assassinSec || 0, ld?.time || 0) / 3) + 1;
    // Wind Walk and Vanish (out of Dark Sight) strike harder
    const buffed = (ids) => (this.buffs || []).some((b) => ids.includes(b.source) && b.until > now);
    if (buffed([WIND_WALK])) d = (d * (this.skills.levelData(WIND_WALK)?.damage || 100)) / 100;
    if (this.skills.level(VANISH) && buffed(DARK_SIGHTS)) d = (d * (this.skills.levelData(VANISH)?.damage || 100)) / 100;
    if (charge) d = (d * ((charge * 90) / PIERCE_HOLD + 10)) / 100;
    // Berserk: a Dark Knight at x% of max HP or less does (its damage + 100)% up close
    const berserk = !shot && job === 132 && this.skills.level(BERSERK) && this.skills.levelData(BERSERK);
    if (berserk && (this.stats?.hp || 0) <= ((berserk.x || 0) * this.maxHpShown()) / 100) d = (d * ((berserk.damage || 0) + 100)) / 100;
    if (BARRAGES.has(skillId)) d *= line === 4 ? 2 : line === 5 ? 4 : 1;
    return { d: Math.max(1, Math.trunc(d)), c };
  }
  /**
   * Shadow Meso: its meso cost x 0.5-1.5, x10, and at its prop chance (100 + x)% of that as a critical; less 1% a level
   * the monster has over you, by element, never by defence.
   */
  shadowMesoHit(info, ld, over) {
    const m = ld?.moneyCon || 0, rand = (lo, hi) => lo + Math.random() * (hi - lo);
    let d = Math.trunc(rand(m * 0.5, m * 1.5)) * 10;
    const c = Math.random() * 100 < (ld?.prop || 0);
    if (c) d = (d * ((ld?.x || 0) + 100)) / 100;
    if (over) d = ((100 - over) * d) / 100;
    const elem = this.skills.node(SHADOW_MESO)?.elemAttr;
    const vs = elem && new RegExp(`${elem.toUpperCase()}(\\d)`).exec(info.elemAttr || '')?.[1];
    if (vs) d = vs === '1' ? 0 : vs === '2' ? d * 0.5 : vs === '3' ? Math.min(199999, d * 1.5) : d;
    return { d: Math.max(1, Math.trunc(d)), c };
  }
  /** Weapon attack: equipment, attack buffs, Bow Expert / Marksman Boost and a shot's ammo, at most 1999. */
  attackWatk(ammoId) {
    const now = Date.now();
    let w = this.watk() + Math.max(0, ...(this.buffs || []).filter((b) => b.watk && b.until > now).map((b) => b.watk));
    for (const id of [3120005, 3220004]) if (this.skills.owns(id)) w += this.skills.levelData(id)?.x || 0;
    if (ammoId) w += this.windows?.info(ammoId)?.incPAD || 0;
    return Math.min(1999, w);
  }
  /** Monsters that can be struck: not one the server has already killed while our blows were on their way. */
  liveMobs() { return this.map.life.filter((m) => m.kind === 'Mob' && m.alive && !m.dying && !m.queuedKill && m.oid !== undefined); }
  /** Where a ranged weapon's swing ends in front of you (65px at most): a shot starts from there. */
  closeReach(action) {
    const lt = this.afterimage?.[this.afterimageLevel()]?.[action]?.lt;
    return Math.max(0, Math.min(CLOSE_REACH, lt ? -lt[0] : CLOSE_REACH));
  }
  /**
   * How far a shot flies: the skill's range, else 300px for a bow or crossbow plus The Eye of Amazon's, 200px for a
   * claw plus Keen Eyes', 200px for a gun.
   */
  shotRange(skillId, lv, wcat) {
    if (TAUNTS.has(skillId)) return TAUNT_RANGE;
    const r = skillId ? this.skills.levelData(skillId, lv)?.range : 0;
    if (r > 0) return r;
    const cygnus = Math.floor((this.stats?.job || 0) / 1000) === 1;
    const extra = (id) => this.skills.levelData(id)?.range || 0;
    if (wcat === 145 || wcat === 146) return 300 + extra(cygnus ? 13000001 : 3000002);
    if (wcat === 147) return 200 + extra(cygnus ? 14000001 : 4000001);
    return wcat === 149 ? 200 : 0;
  }
  /**
   * The first monster a shot meets along its line (y), from `from` px in front out to `range`: checked in 20px steps,
   * each reaching a quarter of its distance from you up and down.
   */
  firstOnLine(ent, from, range, y) {
    const dir = ent.facingRight ? 1 : -1, mobs = this.liveMobs();
    for (let d = from; d < range; d += 20) {
      const a = ent.x + dir * d, b = ent.x + dir * Math.min(d + 20, range), lo = Math.min(a, b), hi = Math.max(a, b), s = Math.floor(d / 4);
      const hit = mobs.filter((m) => { const h = m.hitBox(true); return h.right > lo && h.left < hi && h.bottom > y - s && h.top < y + s; });
      if (hit.length) return hit.sort((p, q) => Math.abs(p.x - ent.x) - Math.abs(q.x - ent.x))[0];
    }
    return null;
  }
  /** A skill's lt/rb box around someone, turned the way they face. */
  skillBox(ent, skillId, lv) {
    const r = this.skills.range(skillId, lv);
    if (!r) return null;
    const [left, right] = ent.facingRight ? [ent.x - r.rb[0], ent.x - r.lt[0]] : [ent.x + r.lt[0], ent.x + r.rb[0]];
    return { left, right, top: ent.y + r.lt[1], bottom: ent.y + r.rb[1] };
  }
  mobsIn(box, x, y, except = null) {
    if (!box) return [];
    return this.liveMobs().filter((m) => {
      if (m === except) return false;
      const h = m.hitBox(true);
      return h.right >= box.left && h.left <= box.right && h.bottom >= box.top && h.top <= box.bottom;
    }).sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y));
  }
  /**
   * Where a shot from `ent` goes and when each monster it strikes is hit (ms after it leaves). It flies 28px up from
   * the feet, from `from` px in front out to `range`:
   *  - most stop at the first monster in the way (firstOnLine);
   *  - piercing shots strike up to mobCount along the line, within their reach above and below, as the arrow passes;
   *  - Arrow Rain and Arrow Eruption strike up to mobCount in the skill's box;
   *  - Arrow Bomb, Inferno and Blizzard blast up to mobCount - 1 more in the skill's box around the first they strike.
   * mobs: the monsters another player's shot struck (nothing is searched for).
   */
  shotPlan(ent, skillId, lv, ld, range, from, mobs = null) {
    const dir = ent.facingRight ? 1 : -1, y = Math.round(ent.y) - 28, sx = ent.x + dir * from, count = ld?.mobCount || 1;
    const plan = { lv, sx, sy: y, ex: ent.x + dir * range, ey: y, targets: [], arrows: !RAIN_SHOTS.has(skillId) };
    // where the arrow meets a body, and the time it takes to get there
    const at = (m) => { const h = m.hitBox(true); return { x: dir > 0 ? Math.max(h.left, sx) : Math.min(h.right, sx), y: Math.max(h.top, Math.min(h.bottom, y)) }; };
    const strike = (m, delay) => { const h = at(m); return { mob: m, x: h.x, y: h.y, delay: delay ?? flightMs(h.x - sx) }; };
    if (RAIN_SHOTS.has(skillId)) {
      plan.targets = (mobs || this.mobsIn(this.skillBox(ent, skillId, lv), ent.x, ent.y).slice(0, count)).map((m) => strike(m, RAIN_DELAY));
      return plan;
    }
    const spread = PIERCING_SHOTS.get(skillId);
    if (spread !== undefined) {
      const box = { left: Math.min(sx, plan.ex), right: Math.max(sx, plan.ex), top: y - spread, bottom: y + 1 + spread };
      const found = mobs || this.mobsIn(box, sx, y).slice(0, count);
      plan.targets = found.map((m) => strike(m)).sort((p, q) => (p.x - q.x) * dir);
      return plan;
    }
    const first = mobs ? mobs[0] : this.firstOnLine(ent, from, range, y);
    if (!first) return plan;
    const hit = strike(first);
    plan.ex = hit.x; plan.ey = hit.y;
    plan.targets.push(hit);
    const blast = BLAST_SHOTS.get(skillId);
    if (blast) {
      const r = this.skills.range(skillId, lv);
      const box = r && { left: hit.x + r.lt[0], right: hit.x + r.rb[0], top: hit.y + r.lt[1], bottom: hit.y + r.rb[1] };
      const others = mobs ? mobs.slice(1) : this.mobsIn(box, hit.x, hit.y, first).slice(0, count - 1);
      others.forEach((m, i) => plan.targets.push({ mob: m, x: m.x, y: m.y, delay: hit.delay + blast(i + 1) }));
      plan.blast = box;
    } else if (mobs) for (const m of mobs.slice(1)) plan.targets.push(strike(m));
    return plan;
  }
  /**
   * A shot's art, `leave` ms from now: its arrows (bulletCount of them, 14px apart up and down, Strafe's 60ms
   * apart...) to where it stops, and from when its first monster is struck, Arrow Rain's arrows falling over the
   * skill's box, Arrow Eruption's under each monster, Inferno's and Blizzard's over the blast.
   */
  shotFx(plan, ent, skillId, ld, ammoId, leave) {
    if (plan.arrows) {
      const n = Math.max(1, ld?.bulletCount || 1), gap = arrowGap(skillId, ammoId);
      for (let i = 0; i < n; i++) this.after(leave + i * gap, () => this.fly(skillId, ammoId, plan.sx, plan.sy, plan.ex, plan.ey + 7 - 7 * n + 14 * i, ent));
    }
    const first = plan.targets[0];
    if (!first) return;
    const at = leave + first.delay;
    if (skillId === 3111004 || skillId === 13111000) {
      const b = this.skillBox(ent, skillId, plan.lv);
      if (b) this.playSpecial(skillId, { ...b, top: b.top - 250, bottom: b.bottom - 250 }, at, ent.facingRight);
    } else if (skillId === 3211004) {
      for (const t of plan.targets) {
        const h = t.mob.hitBox(), w = h.right - h.left, grow = w < 150 ? (150 - w) / 2 : 0;
        this.playSpecial(skillId, { left: h.left - grow, right: h.right + grow, top: h.bottom - 10, bottom: h.bottom }, at, ent.facingRight);
      }
    } else if ((skillId === 3111003 || skillId === 3211003) && plan.blast) {
      this.playSpecial(skillId, { ...plan.blast, top: plan.blast.top - 50, bottom: plan.blast.bottom - 170 }, at, ent.facingRight);
    }
  }
  /** One arrow (the skill's ball, else Soul Arrow's while it is on, else the ammo's bullet) from (sx, sy) to (tx, ty). */
  async fly(skillId, ammoId, sx, sy, tx, ty, ent) {
    const node = await this.shotArt(skillId, ammoId, ent);
    const anim = node ? new Anim(node, true) : null;
    if (anim) await this.assets.preload(anim.frames);
    this.shots.push({ anim, sx, sy, tx, ty, t: 0, dur: flightMs(tx - sx) / 1000, flip: tx > sx });
  }
  async shotArt(skillId, ammoId, ent) {
    // a level can name its own ball (Shadow Meso's coins grow every 10 levels)
    const sn = skillId ? await this.skills?.ensure(skillId) : null, own = ent === this.player && this.skills.levelData(skillId)?.ball?._uol;
    let node = sn ? Game.fxNode((own && sn[own.split('/').pop()]) || sn.ball) : null;
    const soul = ent === this.player ? this.buffs.find((b) => SOUL_ARROWS.includes(b.source) && b.until > Date.now())?.source : 0;
    if (!node && soul) node = Game.fxNode((await this.skills?.ensure(soul))?.ball);
    if (!node && ammoId) {
      const img = await this.assets.json(`Item/Consume/${pad(Math.floor(ammoId / 10000), 4)}.img`);
      node = Game.fxNode(img?.[pad(ammoId, 8)]?.bullet);
    }
    return node;
  }
  /**
   * A skill's `special` art over a box, from `at` ms on: every `interval` ms from `start` until `duration`, `count`
   * pieces at once (a random one of its kinds each), each from a random point in the box. A piece travels (x, y),
   * its slant a little off at random, over `fall` ms give or take 150, then is gone; x points the way the shooter
   * faces. Pieces are drawn at alpha `a`, else 128-191.
   */
  async playSpecial(skillId, box, at, facingRight) {
    const sp = (await this.skills?.ensure(skillId))?.special;
    if (!sp) return;
    const kinds = frames(sp).some((f) => f?._canvas) ? [sp] : frames(sp).filter(Boolean);
    if (!kinds.length) return;
    await this.assets.preload(kinds.flatMap((k) => new Anim(k, true).frames));
    const rand = (n) => (n > 0 ? Math.floor(Math.random() * n) : 0);
    const x = sp.x || 0, y = sp.y || 0, interval = sp.interval || 0, end = sp.duration || 0;
    const wave = () => {
      for (let i = 0; i < (sp.count || 0); i++) {
        const px = box.left + rand(box.right - box.left), py = box.top + rand(box.bottom - box.top);
        const dy = x && y ? Math.trunc(((20 - rand(41)) * x) / y) + y : y, dur = Math.max(0, (sp.fall || 0) + rand(300) - 150);
        const anim = new Anim(kinds[rand(kinds.length)], true);
        this.shots.push({ anim, sx: px, sy: py, tx: px + (facingRight ? x : -x), ty: py + dy, t: 0, dur: dur / 1000, flip: facingRight,
          alpha: (sp.a || 128 + rand(64)) / 255 });
      }
    };
    for (let t = sp.start || 0; t <= end; t += interval) { this.after(at + t, wave); if (!interval) break; }
  }


  /** The box an attack reaches: the skill's lt/rb, else the swing's afterimage box, else a default per kind. */
  attackBox(kind, skillId, lv, action, charge = 0) {
    const p = this.player;
    if (BIG_BANGS.has(skillId)) {
      const w = 100 + Math.floor(charge / 50), h = 75 + Math.floor((charge * 3) / 200);
      return { x1: p.x - w, x2: p.x + w, top: p.y - h, bottom: p.y + h };
    }
    // a swing reaches as far as its afterimage's box (lt/rb), as in the client
    const swing = kind === 'melee' && action ? this.afterimage?.[this.afterimageLevel()]?.[action] : null;
    const r = (!RANGE_SWINGS.has(skillId) && skillId && this.skills.range(skillId, lv)) || (swing?.lt && swing?.rb ? swing : null) || ({
      melee: { lt: [-90, -70], rb: [10, 5] }, ranged: { lt: [-420, -80], rb: [0, 10] }, magic: { lt: [-330, -80], rb: [0, 10] },
    })[kind];
    const [x1, x2] = p.facingRight ? [p.x - r.rb[0], p.x - r.lt[0]] : [p.x + r.lt[0], p.x + r.rb[0]];
    return { x1, x2, top: p.y + r.lt[1], bottom: p.y + r.rb[1] };
  }

  // ------------------------------------------------------------------ reactors
  async spawnReactor(d) {
    (this.reactors ??= new Map());
    const map = this.map, img = await loadReactorImg(this.assets, d.id);
    if (!img || this.map !== map) return;
    const r = new Reactor(d, img, map);
    await this.assets.preload(r.frames());
    if (this.map === map) this.reactors.set(d.oid, r);
  }
  /** Reactors an attack's box reaches when it lands: each gets one hit, whatever the number of damage lines. */
  hitReactors(kind, skillId, lv, action) {
    if (!this.reactors?.size) return;
    const p = this.player, b = this.attackBox(kind, skillId, lv, action);
    const stance = (p.facingRight ? 1 : 0) + (p.fh ? 2 : 0);
    for (const r of this.reactors.values()) {
      const box = r.hittable && r.box();
      if (!box || box.right < b.x1 || box.left > b.x2 || box.bottom < b.top || box.top > b.bottom) continue;
      this.net.damageReactor(r.oid, (Math.round(p.x) << 16) | (Math.round(p.y) & 0xffff), stance, skillId || 0);
    }
  }
  /** Touch reactors hear when you walk onto them and off them again. */
  touchReactors() {
    if (!this.reactors?.size) return;
    const pb = this.playerBody();
    for (const r of this.reactors.values()) {
      if (!r.touch || r.gone) continue;
      const box = r.box();
      const inside = !!box && box.right >= pb.left && box.left <= pb.right && box.bottom >= pb.top && box.top <= pb.bottom;
      if (inside !== r.touching) { r.touching = inside; this.net.touchReactor(r.oid, inside); }
    }
  }

  /** Mobs inside the skill's lt/rb box (or a default reach): the nearest `count`, a swing's in the order it goes through them. */
  findTargets(kind, skillId, lv, count, action = null, maxReach = Infinity, charge = 0) {
    const p = this.player;
    if (kind === 'magic' && skillId && !AREA_SPELLS.has(skillId)) return this.spellTargets(skillId, count);
    let { x1, x2, top, bottom } = this.attackBox(kind, skillId, lv, action, charge);
    // maxReach: how far in front it goes at most (a ranged weapon's swing)
    if (p.facingRight) x2 = Math.max(x1 + 1, Math.min(x2, p.x + maxReach)); else x1 = Math.min(x2 - 1, Math.max(x1, p.x - maxReach));
    // a monster is in it when its body (now or a frame ago) overlaps the box (openms, docs/hitboxes.md)
    const mobs = this.liveMobs();
    const inside = (m) => { const b = m.hitBox(true); return b.right >= x1 && b.left <= x2 && b.bottom >= top && b.top <= bottom; };
    // Slash Blast, Coma, Charged Blow: only once something is inside the ordinary swing do they reach out to their range
    const reach = RANGE_SWINGS.has(skillId) && this.skills.levelData(skillId, lv)?.range;
    if (reach && mobs.some(inside)) { if (p.facingRight) x2 = Math.max(x2, p.x + reach); else x1 = Math.min(x1, p.x - reach); }
    const hit = mobs.filter(inside).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x)).slice(0, count);
    // front to back along the way you face, by where each is struck (the middle of its body within the box)
    if (kind === 'melee' && skillId !== BAND_OF_THIEVES && skillId !== SPARK) {
      const at = (m) => { const b = m.hitBox(true); return (Math.max(b.left, x1) + Math.min(b.right, x2)) / 2; };
      hit.sort((a, b) => (at(a) - at(b)) * (p.facingRight ? 1 : -1));
    }
    return hit;
  }

  /**
   * A spell that isn't an area one hits the first monster in a wedge in front of you: from 50px out to 300px, centred
   * 28px up and spreading a quarter of the distance up and down, checked in 20px steps. Chain Lightning then jumps
   * to the nearest monster not yet struck within 150px ahead of the last (and 150px up or down), at most 400px past
   * the first.
   */
  spellTargets(skillId, count) {
    const p = this.player, dir = p.facingRight ? 1 : -1, y = p.y - 28;
    const mobs = this.map.life.filter((m) => m.kind === 'Mob' && m.alive && !m.dying && m.oid !== undefined);
    const meets = (m, x1, x2, top, bottom) => { const h = m.hitBox(true); return h.right > x1 && h.left < x2 && h.bottom > top && h.top < bottom; };
    let first = null;
    for (let d = 50; d < 300 && !first; d += 20) {
      const a = p.x + dir * d, b = p.x + dir * Math.min(d + 20, 300), s = Math.floor(d / 4);
      first = mobs.find((m) => meets(m, Math.min(a, b), Math.max(a, b), y - s, y + s)) || null;
    }
    if (!first) return [];
    const hit = [first];
    while (skillId === CHAIN_LIGHTNING && hit.length < count) {
      const last = hit[hit.length - 1];
      const [x1, x2] = p.facingRight ? [last.x, Math.min(last.x + 150, first.x + 400)] : [Math.max(last.x - 150, first.x - 400), last.x];
      const near = mobs.filter((m) => m !== last && meets(m, x1, x2, last.y - 150, last.y + 150)).slice(0, 10).filter((m) => !hit.includes(m));
      if (!near.length) break;
      const dist = (m) => (m.x - last.x) ** 2 + (m.y - last.y) ** 2;
      hit.push(near.reduce((a, b) => (dist(b) < dist(a) ? b : a)));
    }
    return hit;
  }

  talkToNearestNpc() {
    const p = this.player;
    const npc = this.map.life.filter((e) => e.kind === 'Npc' && e.oid !== null && Math.abs(e.x - p.x) < 150 && Math.abs(e.y - p.y) < 100)
      .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    if (npc) this.interactNpc(npc);
  }

  notice(text) {
    if (this.lastNotice === text && performance.now() - this.lastNoticeT < 1500) return;
    this.lastNotice = text; this.lastNoticeT = performance.now();
    this.hud?.message(text, '#ff9e9e');
  }

  // ------------------------------------------------------------------ skill effects
  /** First playable frame list under a node: either numbered canvases or numbered groups of canvases. */
  static fxNode(node) {
    if (!node) return null;
    if (frames(node).some((f) => f?._canvas)) return node;
    return frames(node)[0] || null;
  }

  /** Weapon swing: each weapon names its sound in info/sfx (swordL, bow, tGlove, gun...). */
  playWeaponSound(ent) {
    const look = ent === this.player ? this.look : ent?.look;
    if (!look) return;
    sfx.play(`Weapon/${look.weapon?.info?.sfx || 'barehands'}/Attack`);
  }

  /**
   * swing: fall back to the weapon's swing when the skill has no Use sound (most physical attacks).
   * branch: 'effect' when cast, 'affected' on whoever a party buff reached (no sound: the caster's played).
   */
  async playSkillEffect(id, ent, swing = false, branch = 'effect') {
    if (branch === 'effect') sfx.play(`Skill/${pad(id, 7)}/Use`).then((found) => { if (!found && swing) this.playWeaponSound(ent); });
    const node = await this.skills?.ensure(id);
    // a skill with an effect per pose (Brandish: effect/0 with brandish1, effect/1 with brandish2) plays the one
    // that goes with the pose being used
    const posed = branch === 'effect' && node?.action && Object.entries(node.action).find(([, a]) => a === ent?.attack)?.[0];
    const own = posed !== undefined && node.effect?.[posed] && !node.effect[posed]._canvas ? node.effect[posed] : null;
    const fx = own || Game.fxNode(node?.[branch] || (branch === 'effect' ? node?.effect0 : null));
    if (!fx) return;
    const anim = new Anim(fx, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, follow: ent, flip: ent.facingRight });
  }

  /**
   * A skill's hit effect on what it struck, as the client does it (HeavenClient Mob::show_effect): on the
   * monster's head point (its frame's head vector, mirrored with the monster) and facing the way the attacker
   * faces. Without a head point, the middle of its body.
   */
  async playHitEffect(id, mob, by = this.player, dmgs = [1]) {
    const node = id ? await this.skills?.ensure(id) : null;
    const fx = Game.fxNode(node?.hit);
    if (fx) await this.assets.preload(new Anim(fx, false).frames);
    // every damage line is its own blow, on the same beat as its number: Magic Claw's two lines sound twice, Lucky
    // Seven's two stars twice... (a miss makes no monster damage sound)
    dmgs.forEach((d, line) => this.after(lineDelay(id, line, ...this.lineTiming(by)), () => {
      if (id) sfx.play(`Skill/${pad(id, 7)}/Hit`); // keys are 7-digit (0001000); Cygnus/Aran ids are 8
      if (d > 0 && mob?.kind === 'Mob') sfx.play(`Mob/${pad(Number(mob.spawn.id), 7)}/Damage`);
      if (!fx) return;
      const head = mob.node?.head;
      const x = head ? mob.x + (mob.facingRight ? -head[0] : head[0]) : mob.x;
      const y = head ? mob.y + head[1] : mob.y - (mob.node?._h || 40) / 2;
      this.fx.push({ anim: new Anim(fx, false), x, y, flip: !!by?.facingRight });
    }));
  }

  /** Projectile from `from` to `to` (mob or null = fly forward): skill ball, else the ammo's bullet animation. */
  async shoot(skillId, from, to, ammoId, onHit) {
    let node = skillId ? Game.fxNode((await this.skills?.ensure(skillId))?.ball) : null;
    if (!node && ammoId) {
      const t = Math.floor(ammoId / 10000);
      const img = await this.assets.json(`Item/Consume/${pad(t, 4)}.img`);
      node = Game.fxNode(img?.[pad(ammoId, 8)]?.bullet);
    }
    const anim = node ? new Anim(node, true) : null;
    if (anim) await this.assets.preload(anim.frames);
    const sx = from.x + (from.facingRight ? 20 : -20), sy = from.y - 30;
    const tx = to ? to.x : from.x + (from.facingRight ? 400 : -400), ty = to ? to.y - (to.node?._h || 40) / 2 : sy;
    const dur = Math.min(0.45, Math.max(0.12, Math.abs(tx - sx) / 1200));
    this.shots.push({ anim, sx, sy, tx, ty, t: 0, dur, flip: tx > sx, onHit });
  }

  updateFx(dt) {
    for (const f of this.fx) f.anim.update(dt * 1000);
    for (const d of this.doors?.values() || []) d.anim?.update(dt * 1000);
    for (const m of this.mists?.values() || []) for (const t of m.tiles) t.anim.update(dt * 1000);
    this.fx = this.fx.filter((f) => !f.anim.done && (!f.keep || f.keep()));
    for (const s of this.shots) {
      s.t += dt; s.anim?.update(dt * 1000);
      if (s.t >= s.dur && !s.hit) { s.hit = true; s.onHit?.(); }
    }
    this.shots = this.shots.filter((s) => !s.hit);
  }

  drawFx(ctx, cam) {
    const draw = (node, x, y, flip, alpha = 1) => {
      const img = this.assets.image(node);
      if (!img) return;
      const o = node.origin || [0, 0];
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(Math.round(x - cam.x), Math.round(y - cam.y));
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -o[0], -o[1]);
      ctx.restore();
    };
    for (const f of this.fx) {
      const node = f.anim.node;
      if (!node) continue;
      if (f.follow) draw(node, f.follow.x, f.follow.y, f.follow.facingRight);
      else draw(node, f.x, f.y, f.flip);
    }
    for (const s of this.shots) {
      if (!s.anim?.node) continue;
      const k = s.dur ? Math.min(1, s.t / s.dur) : 1;
      draw(s.anim.node, s.sx + (s.tx - s.sx) * k, s.sy + (s.ty - s.sy) * k, s.flip, s.alpha);
    }
  }

  /** Your hits in red (NoRed), other players' in blue (NoBlue); your hits also show the monster's HP bar. */
  damageNumbers(target, dmgs, mine, skillId = 0, crits = [], weaponId = 0, scale = 1) {
    if (mine && target.kind === 'Mob') target.hpShownUntil = performance.now() + 5000;
    this.vfx?.damage(target, dmgs, mine ? 'red' : 'blue', skillId, crits, weaponId, scale);
  }

  /**
   * Your Puppet: the monsters you control near it go after it, and one that runs into it hits it
   * (DAMAGE_SUMMON; the server takes it down when its HP runs out). Out of range they come back to you.
   */
  puppetAggro(dt) {
    let pp = null;
    for (const sm of this.summons.values()) if (sm.mine && sm.puppet && !sm.dying) pp = sm;
    for (const m of this.map.life) {
      if (m.kind !== 'Mob' || !m.controlled || !m.alive || m.dying) continue;
      const near = pp && (m.x - pp.x) ** 2 + (m.y - pp.y) ** 2 < PUPPET_RANGE ** 2;
      if (near) m.aggro = pp;
      else if (m.aggro instanceof Summon) m.aggro = this.player;
    }
    if (!pp || (pp.hitT -= dt) > 0) return;
    const box = { left: pp.x - pp.reach - 8, right: pp.x + pp.reach + 8, top: pp.y - 60, bottom: pp.y + 5 };
    for (const m of this.map.life) {
      if (m.kind !== 'Mob' || !m.alive || m.dying || m.oid === null || m.src.info?.bodyAttack === 0) continue;
      const b = m.hitBox();
      if (b.right < box.left || b.left > box.right || b.bottom < box.top || b.top > box.bottom) continue;
      const pad = m.src.info?.PADamage || 1, damage = Math.max(1, Math.round(pad * (0.85 + Math.random() * 0.15)));
      this.net.damageSummon(pp.oid, damage, m.spawn.id);
      pp.play('hit');
      this.vfx?.damage(pp, [damage], 'violet');
      pp.hitT = 1;
      return;
    }
  }

  checkTouchDamage(dt) {
    const p = this.player, last = this.lastPos || p;
    const dx = p.x - last.x, dy = p.y - last.y;   // how far you moved since the last check
    this.lastPos = { x: p.x, y: p.y };
    if (this.invincible > 0) { this.invincible -= dt; return; }
    if (this.dead || !this.stats) return;
    const hidden = this.hidden() && !((this.map?.info?.fieldLimit || 0) & 2);
    // the original receiver: 44x65 standing, 46x31 lying down
    const prone = p.action === 'prone' || p.action === 'proneStab';
    const pb = prone ? { left: p.x - 23, right: p.x + 23, top: p.y - 31, bottom: p.y } : { left: p.x - 22, right: p.x + 22, top: p.y - 65, bottom: p.y };
    for (const m of this.map.life) {
      if (m.kind !== 'Mob' || !m.alive || m.dying || m.src.info?.bodyAttack === 0) continue;
      if (hidden && Number(m.spawn?.id) !== 9400594) continue;   // only the Master Guardian finds you in Dark Sight
      const b = m.hitBox();
      if (b.right < pb.left || b.left > pb.right || b.bottom < pb.top || b.top > pb.bottom) continue;
      // thrown the way the monster moved relative to you; climbing up a ladder or rope, it doesn't knock you off
      const knock = p.ladder && dy < 0 ? 0 : m.x - (m.prevX ?? m.x) - dx < 0 ? -1 : 1;
      this.hurtBy(m, m.src.info?.PADamage || 1, false, -1, knock);
      return;
    }
  }
  /**
   * The damage a monster's blow does you, or 0 for a MISS.
   * Avoid: (DEX / 4 + LUK / 2 + equipment and buffs), less half a point per level the monster has over you. A physical
   * blow misses at avoid / (its accuracy x 4.5) x 100 %, held to 2-80% (a thief's 5-95%); a magic one when its
   * accuracy is no more than a roll between a tenth of your avoid and all of it.
   * Physical: attack x 0.80-0.85 x attack / 100, less (s x 0.00125 + 0.28) x your defence and a share of how far your
   * defence is above or below the standard for your class and level (Base/StandardPDD.img), s being a mix of your stats
   * ((LUK + DEX) / 4 + INT / 9 + STR x 2/7 for a warrior, LUK / 4 + INT / 9 + DEX x 2/7 + STR x 0.4 for the rest);
   * nothing left is a MISS. Magic: its magic attack x 0.75-0.80 x itself / 100, less (DEX / 6 + STR / 7 + LUK / 5 +
   * magic defence) x 0.3 (a magician's) or 0.25, at least 1.
   */
  damageTaken(m, power, magic) {
    const info = m.src?.info || {}, s = this.stats || {}, lv = s.level || 1, cls = Math.floor(((s.job || 0) % 1000) / 100);
    const rand = (lo, hi) => lo + Math.random() * (hi - lo), clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), now = Date.now();
    const buff = (k) => Math.max(0, ...(this.buffs || []).filter((b) => b[k] && b.until > now).map((b) => b[k]));
    const mobLv = info.level || 0, acc = clamp(info.acc || 0, 0, 999);
    let avoid = clamp(this.avoidability() + buff('avoid'), 0, 999);
    if (mobLv > lv) avoid = Math.max(0, avoid - Math.trunc((mobLv - lv) / 2));
    if (magic) {
      if (acc <= rand(avoid * 0.1, avoid)) return 0;
      const mad = clamp(info.MADamage ?? power, 0, 1999), mdd = clamp(this.equipStat('mdef') + buff('mdef'), 0, 1999);
      const d = Math.trunc(rand(mad * 0.75, mad * 0.8) * mad * 0.01 - (s.dex / 6 + s.str / 7 + s.luk / 5 + mdd) * (cls === 2 ? 0.3 : 0.25));
      return d === 0 ? 0 : Math.max(1, d);
    }
    const chance = (avoid / (acc * 4.5)) * 100;
    if (Math.random() * 100 < (cls === 4 ? clamp(chance, 5, 95) : clamp(chance, 2, 80))) return 0;
    const pad = clamp(power, 0, 1999), pdd = clamp(this.equipStat('wdef') + buff('wdef'), 0, 1999), std = this.standardPdd(cls, lv);
    const k = Math.trunc(cls === 1 ? (s.luk + s.dex) * 0.25 + s.int / 9 + (s.str * 2) / 7 : s.luk * 0.25 + s.int / 9 + (s.dex * 2) / 7 + s.str * 0.4);
    let d = rand(pad * 0.8, pad * 0.85) * pad * 0.01 - (k * 0.00125 + 0.28) * pdd;
    if (pdd >= std) d -= (pdd - std) * (k / 900 + lv / 1300 + 0.28) * 0.7;
    else if (mobLv <= lv) d -= ((pdd - std) * (lv / 550 + k * 0.00125 + 0.28) * 13) / (lv - mobLv + 13);
    else d -= (pdd - std) * (lv / 550 + k * 0.00125 + 0.28) * 1.3;
    return Math.max(0, Math.trunc(d));
  }
  /** The standard weapon defence for a class (0 beginner .. 5 pirate) at a level, from Base/StandardPDD.img (gaps take the last value). */
  standardPdd(cls, lv) {
    if (!this.stdPdd) {
      this.stdPdd = 'loading';
      this.assets.json('Base/StandardPDD.img').then((j) => {
        const t = [];
        for (let c = 0; c < 6; c++) { let last = 0; t[c] = []; for (let l = 0; l <= 200; l++) { const v = Number(j?.[c]?.[l]) || 0; if (v > 0) last = v; t[c][l] = last; } }
        this.stdPdd = t;
      }).catch(() => { this.stdPdd = null; });
    }
    return Array.isArray(this.stdPdd) && cls >= 0 && cls <= 5 && lv >= 0 && lv <= 200 ? this.stdPdd[cls][lv] : 0;
  }
  /** Power Stance's roll on a hit that would throw you back (see STANCES): true when you stand firm. */
  holdsStance() {
    const now = Date.now(), b = (this.buffs || []).find((x) => (x.stance || Object.values(STANCES).includes(x.source)) && x.until > now);
    if (!b || ((this.map?.info?.fieldLimit || 0) & 2)) return false;
    const rate = Math.max(0, Math.min(100, b.stance ?? this.skills.levelData(b.source)?.prop ?? 0));
    if (Math.floor(Math.random() * 100) >= rate) return false;
    const id = STANCES[this.stats?.job] || b.source;
    if (id) this.playSkillEffect(id, this.player, false, 'special');
    return true;
  }
  /** The receiver monster attacks are tested against: 44x65 standing, 46x31 lying down. */
  playerBody() {
    const p = this.player, prone = p.action === 'prone' || p.action === 'proneStab';
    return prone ? { left: p.x - 23, right: p.x + 23, top: p.y - 31, bottom: p.y } : { left: p.x - 22, right: p.x + 22, top: p.y - 65, bottom: p.y };
  }
  /**
   * Monster `m` hurts you: `power` is its PADamage (MADamage when magic), less half your weapon (magic) defence.
   * `from` is the attack index (-1 for touching it): the server applies that attack's extras (MP burn, disease).
   * `knock`: which way you're thrown (-1 left, 1 right, 0 not at all); by default away from the monster.
   */
  hurtBy(m, power, magic, from, knock = m.x > this.player.x ? -1 : 1, attack = null) {
    const p = this.player;
    let damage = this.damageTaken(m, power, magic);
    // a deadly attack leaves you 1 HP
    if (damage > 0 && attack?.deadlyAttack) damage = Math.max(1, (this.stats?.hp || 1) - 1);
    const fromRight = m.x > p.x;
    if (damage <= 0) {   // MISS: no knockback or blinking, but the same 1.5s before the next blow as a hit
      this.net.takeDamage({ damage: 0, mobId: m.spawn.id, oid: m.oid, direction: fromRight ? 1 : 0, from });
      this.vfx?.damage(p, [0], 'violet');
      this.invincible = HIT_PROTECTION; this.missed = true;
      return;
    }
    this.net.takeDamage({ damage, mobId: m.spawn.id, oid: m.oid, direction: fromRight ? 1 : 0, from });
    this.vfx?.damage(p, [damage], 'violet');
    if (from >= 0) sfx.play(`Mob/${pad(Number(m.spawn.id), 7)}/CharDam${from + 1}`);
    setExpression(p, 1, HIT_FACE_TIME);
    this.standUp();
    // the 270/270 impulse adds to how you were already moving, up to 270 each way: walking or jumping into the
    // monster you're thrown back less, and falling onto it only slows your fall
    const impact = (v, k) => (k > 0 ? (v < k ? Math.min(v + k, k) : v) : (v > k ? Math.max(v + k, k) : v));
    if (knock && this.holdsStance()) knock = 0;
    if (knock) {
      p.fh = null; p.ladder = null;
      p.vx = impact(p.vx || 0, knock * KNOCKBACK); p.vy = impact(p.vy || 0, -KNOCKBACK);
    }
    if (p.attack) {   // a hit doesn't shorten the attack delay
      const k = p.attackScale || 1, n = this.look.frameCount(p.attack);
      this.attackLock = performance.now() + Math.max(0, (this.frameTime(p.attack, n) - this.frameTime(p.attack, p.frame)) * k - p.frameT);
    }
    p.attack = null;
    this.invincible = HIT_PROTECTION; this.missed = false;
  }

  /**
   * A status on a monster: the art of the skill behind it - a player skill's `mob` animation (Poison Breath's
   * bubbles, a stun's stars), or a monster skill's `mob` animation and `icon` (its own attack / defence up...).
   */
  async applyMobStatus(m, s) {
    const low = s.source & 0xffff, high = s.source >>> 16, mobSkill = s.source > 0 && low >= 100 && low <= 200 && high > 0 && high < 256;
    let node = null, icon = null, doom = null;
    const frames = (n) => n && Object.keys(n).some((k) => /^\d+$/.test(k));
    if (mobSkill) { const lv = await this.mobSkillLevel(low, high); node = lv?.mob; icon = lv?.mob?.icon || null; }
    else if (s.source > 0) {
      const sk = await this.skills?.ensure(s.source);
      node = sk?.mob;
      // Doom: the puff (mob) plays once at its feet, then it is the Blue Snail (Mob 0100101 - the client's
      // template for it) walking at that snail's speed, with the skill's pulsing mark (mob0) over its head
      if (s.second & MOB_DOOM) {
        const snail = await this.assets.json('Mob/0100101.img');
        if (snail) doom = { stand: new Anim(snail.stand, true), move: new Anim(snail.move, true), speed: Number(snail.info?.speed) || 0,
          mark: frames(sk?.mob0) ? new Anim(sk.mob0, true) : null };
      }
    }
    const anim = frames(node) ? new Anim(node, !doom) : null;
    if (anim) await this.assets.preload(anim.frames);
    if (doom) await this.assets.preload([doom.stand, doom.move, doom.mark].filter(Boolean).flatMap((a) => a.frames));
    if (icon) await this.assets.preload([icon]);
    m.addStatus(s.first, s.second, s.source, { anim, icon, doom, value: s.value });
  }

  /** Skill/MobSkill.img/<skill>/level/<level>: a monster skill's art (effect on the caster, affected on the cursed). */
  async mobSkillLevel(skill, level) {
    this.mobSkillImg ??= this.assets.json('Skill/MobSkill.img');
    return (await this.mobSkillImg)?.[skill]?.level?.[level] || null;
  }
  /** A monster casts: its effect plays on it; if we control it, the server hears the cast and applies the skill. */
  async mobSkillStart(m, s) {
    if (m.controlled && this.net && m.oid != null) {
      const x = Math.round(m.x), y = Math.round(m.y), facing = m.facingRight ? 0 : 1;
      this.net.moveMob(m.oid, { x, y }, [{ cmd: 0, x, y, vx: 0, vy: 0, fh: m.fh?.id || 0, stance: (2 << 1) | facing, duration: 0 }],
        (20 + (s.action || 1)) * 2 + facing, s.skill, s.level);
    }
    const lv = await this.mobSkillLevel(s.skill, s.level), fx = lv?.effect && Game.fxNode(lv.effect);
    if (fx) this.after(Number(s.effectAfter) || 0, async () => {
      const anim = new Anim(fx, false); await this.assets.preload(anim.frames); this.fx.push({ anim, follow: m });
    });
  }
  /**
   * A monster's curse on you (Seal, Darkness, Weakness, Stun, Curse, Poison, Slow, Reverse...): its affected
   * animation loops over you (or at your feet) until it wears off or the server lifts it. While it lasts, Stun
   * holds you still, Seal stops skills, Weakness stops jumping, Slow takes your speed down to its x% and Reverse
   * swaps left and right.
   */
  async onDisease(d) {
    const lv = await this.mobSkillLevel(d.skill, d.level), node = lv?.affected;
    const anim = node ? new Anim(node, true) : null;
    if (anim) await this.assets.preload(anim.frames);
    this.diseases = (this.diseases || []).filter((x) => x.skill !== d.skill);
    this.diseases.push({ ...d, x: lv?.x, until: Date.now() + d.duration, anim, head: Number(node?.pos) === 1 });
  }
  /** Another player's curse: its affected animation loops over them too, until the server lifts it. */
  async onForeignDisease(id, d) {
    const rp = this.others.get(id);
    if (!rp) return;
    const lv = await this.mobSkillLevel(d.skill, d.level), node = lv?.affected;
    const anim = node ? new Anim(node, true) : null;
    if (anim) await this.assets.preload(anim.frames);
    rp.diseases = (rp.diseases || []).filter((x) => x.skill !== d.skill);
    rp.diseases.push({ ...d, until: Date.now() + (Number(lv?.time) || 30) * 1000, anim, head: Number(node?.pos) === 1 });
  }
  hasDisease(skill) { return (this.diseases || []).some((d) => d.skill === skill && d.until > Date.now()); }
  updateDiseases(dt) {
    const now = Date.now();
    for (const ent of [this, ...this.others.values()]) {
      if (!ent.diseases?.length) continue;
      ent.diseases = ent.diseases.filter((d) => d.until > now);
      for (const d of ent.diseases) d.anim?.update(dt * 1000);
    }
  }
  drawDiseases(ctx, cam, p = this.player, list = this.diseases) {
    for (const d of list || []) {
      const n = d.anim?.node, img = n && this.assets.image(n);
      if (!img) continue;
      const o = n.origin || [0, 0], y = d.head ? p.y - 65 : p.y;
      ctx.drawImage(img, Math.round(p.x - o[0] - cam.x), Math.round(y - o[1] - cam.y));
    }
  }

  /** A monster starts an attack: its sound and effect; if we control it, the server hears which attack it was. */
  mobAttackStart(m, a, spots) {
    sfx.play(`Mob/${pad(Number(m.spawn.id), 7)}/Attack${a.n}`);
    // an area attack marks the spots that will erupt with its areaWarning, on the ground of each
    const warn = spots && a.info.areaWarning && Game.fxNode(a.info.areaWarning);
    if (warn) {
      const frames = new Anim(warn, false).frames;
      this.assets.preload(frames).then(() => { for (const q of spots) this.fx.push({ anim: new Anim(warn, false), x: q.x, y: q.y, flip: false }); });
    }
    const fx = a.info.effect && Game.fxNode(a.info.effect);
    if (fx) this.after(Number(a.info.effectAfter) || 0, async () => {
      const anim = new Anim(fx, false); await this.assets.preload(anim.frames); this.fx.push({ anim, follow: m });
    });
    if (!m.controlled || !this.net || m.oid == null) return;
    const x = Math.round(m.x), y = Math.round(m.y), facing = m.facingRight ? 0 : 1;
    this.net.moveMob(m.oid, { x, y }, [{ cmd: 0, x, y, vx: 0, vy: 0, fh: m.fh?.id || 0, stance: (2 << 1) | facing, duration: 0 }], (12 + a.index) * 2 + facing);
  }
  /**
   * Its attack lands (attackAfter into it): if you are in reach then, it hurts you - straight away, or for a ball
   * (type 2) when the ball, flying from its start point, reaches you. Whoever controls the monster, each client
   * checks itself, as in the original.
   */
  mobAttackLand(m, a, spots) {
    const p = this.player;
    if (!this.net || this.dead || !this.stats || !m.alive || this.invincible > 0 || !m.reaches(a, this.playerBody(), spots)) return;
    const magic = !!a.info.magic;
    const power = Number(magic ? a.info.MADamage ?? m.src.info?.MADamage : a.info.PADamage ?? m.src.info?.PADamage) || 1;
    const land = () => {
      if (this.dead || this.invincible > 0) return;
      this.hurtBy(m, power, magic, a.index, undefined, a.info);
      const hit = a.info.hit && Game.fxNode(a.info.hit);
      if (hit) { const anim = new Anim(hit, false); this.assets.preload(anim.frames).then(() => this.fx.push({ anim, follow: p })); }
    };
    const ball = a.type === 2 && a.info.ball && Game.fxNode(a.info.ball);
    if (!ball) { land(); return; }
    const q = m.attackReach(a), anim = new Anim(ball, true);
    this.assets.preload(anim.frames);
    const tx = p.x, ty = p.y - 32;
    this.shots.push({ anim, sx: q.sx, sy: q.sy, tx, ty, t: 0, dur: Math.min(0.6, Math.max(0.1, Math.hypot(tx - q.sx, ty - q.sy) / 600)), flip: tx > q.sx, onHit: land });
  }

  /** Pick up the item you are standing on: your feet within its width, on the same ground. */
  tryPickup() {
    if (this.hidden()) return;
    const p = this.player;
    let best = null, bestDx = Infinity;
    for (const [oid, d] of this.drops) {
      if (d.pickedBy || !d.landed) continue;
      const half = (this.assets.image(d.anim.node)?.width || 24) / 2, dx = Math.abs(d.x - p.x);
      if (dx <= half && Math.abs(d.y - p.y) <= 12 && dx < bestDx) { best = oid; bestDx = dx; }
    }
    if (best !== null) this.net.pickup(best, { x: Math.round(p.x), y: Math.round(p.y) });
  }

  handleClicks() {
    for (const c of this.input.clicks) {
      // a double-click on a window (or the status bar) is the window's, never the NPC behind it
      if (this.windows?.top(c.x, c.y) || this.statusBar?.contains?.(c.x, c.y)) continue;
      const wx = c.x + Math.round(this.cam.x), wy = c.y + Math.round(this.cam.y);
      for (const e of this.map.life) {
        if (e.kind !== 'Npc' || e.oid === null) continue;
        const b = e.box();
        if (wx >= b.left && wx <= b.right && wy >= b.top && wy <= b.bottom) { this.interactNpc(e); return; }
      }
    }
  }

  // ------------------------------------------------------------------ network sync
  currentStance() {
    const p = this.player;
    let st = 'stand';
    if (p.seat) st = 'sit';
    else if (p.ladder) st = p.ladder.l ? 'ladder' : 'rope';
    else if (!p.fh) st = 'jump';
    else if (p.action === 'prone') st = 'prone';
    else if (p.action.startsWith('walk')) st = 'walk';
    return stanceByte(st, !p.facingRight);
  }

  syncMovement(dt) {
    const p = this.player;
    this.moveT += dt * 1000; this.flushT += dt;
    if (this.moveT >= 90) {
      const snap = { cmd: 0, x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx || 0), vy: Math.round(p.vy || 0), fh: p.fh?.id || 0, stance: this.currentStance(), duration: Math.round(this.moveT) };
      const last = this.moveBuf[this.moveBuf.length - 1] || this.lastSent;
      if (!last || last.x !== snap.x || last.y !== snap.y || last.stance !== snap.stance) this.moveBuf.push(snap);
      this.moveT = 0;
    }
    if (this.flushT >= 0.36 && this.moveBuf.length) {
      const start = this.lastSent ? { x: this.lastSent.x, y: this.lastSent.y } : { x: this.moveBuf[0].x, y: this.moveBuf[0].y };
      this.net.move(start, this.moveBuf);
      this.lastSent = this.moveBuf[this.moveBuf.length - 1];
      this.moveBuf = []; this.flushT = 0;
    }
  }

  // ------------------------------------------------------------------ camera / render
  /**
   * The original client's follow (Shape2D's filter, as openms recovered it): the camera aims at a point
   * CAM_LIFT above your feet. Each axis on its own: inside CAM_DEADBAND of that point it does not move at
   * all; past it, it is left (k * d) / (ms * d + k) behind (k = CAM_DAMPING * 1000), so it creeps after
   * small moves and closes long gaps fast. The point is filtered first and the map's edges applied after.
   * Kept in fractions, drawn at whole pixels so sprites don't shimmer.
   */
  updateCamera(dt) {
    const p = this.player, f = (this.camF ??= { x: p.x, y: p.y - CAM_LIFT });
    const ms = dt * 1000, k = CAM_DAMPING * 1000;
    const axis = (from, to) => {
      const d = Math.abs(to - from);
      const left = d > CAM_DEADBAND ? (k * d) / (ms * d + k) : d;
      return to < from ? to + left : to - left;
    };
    f.x = axis(f.x, p.x); f.y = axis(f.y, p.y - CAM_LIFT);
    this.placeCamera();
  }

  snapCamera() {
    const p = this.player;
    this.camF = { x: p.x, y: p.y - CAM_LIFT };
    this.placeCamera();
  }
  /** Centre the view on the filtered point, held inside the map. */
  placeCamera() {
    const c = { x: Math.trunc(this.camF.x) - VIEW_W / 2, y: Math.trunc(this.camF.y) - VIEW_H / 2 };
    this.clampCamera(c);
    this.cam.x = Math.round(c.x); this.cam.y = Math.round(c.y);
  }

  clampCamera(c = this.cam) {
    const b = this.map.bounds;
    c.x = b.right - b.left < VIEW_W ? (b.left + b.right - VIEW_W) / 2 : Math.max(b.left, Math.min(b.right - VIEW_W, c.x));
    c.y = b.bottom - b.top < VIEW_H ? (b.top + b.bottom - VIEW_H) / 2 : Math.max(b.top, Math.min(b.bottom - VIEW_H, c.y));
  }

  /**
   * Draw at the screen's own pixel density (as openms does), so text and scaled art are crisp instead of
   * an 800x600 image stretched to fit; every coordinate stays in the 800x600 game space.
   */
  fitBacking() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    // System Option PICTURE QUALITY: NORMAL draws one canvas pixel per game pixel, BEST the screen's density
    const best = Math.max(1, Math.min(4, ((c.clientWidth || VIEW_W) * dpr) / VIEW_W));
    const k = 1 + (best - 1) * Math.max(0, Math.min(1, settings.quality));
    const w = Math.round(VIEW_W * k), h = Math.round(VIEW_H * k);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.ctx.setTransform(w / VIEW_W, 0, 0, h / VIEW_H, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  render() {
    this.fitBacking();
    const ctx = this.ctx, map = this.map, p = this.player;
    if (this.inCashShop) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); this.windows?.draw(ctx); return; }
    const cam = { ...this.cam, x: Math.round(this.cam.x) + (this.shake?.dx || 0), y: Math.round(this.cam.y) + (this.shake?.dy || 0) };
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    map.drawBacks(ctx, cam, false);

    // Same rule as the official client: foothold page, kept while airborne, 7 on ladders/ropes.
    const playerLayer = p.ladder ? 7 : p.fh?.layer ?? this.lastLayer ?? 7;
    this.lastLayer = playerLayer;
    // shop owners and their booths go down first: everyone else walks in front of a shop
    const inShop = (e) => e.box?.type === 4;
    for (let l = 0; l < 8; l++) {
      map.drawLayer(ctx, cam, l);
      for (const e of map.life) if ((e.fh?.layer ?? 7) === l) e.draw(ctx, cam, this.assets);
      if (this.reactors) for (const r of this.reactors.values()) if (r.layer === l) r.draw(ctx, cam, this.assets);
      if (l === playerLayer) this.drawShip(ctx, cam);
      if (l === playerLayer) this.drawDoors(ctx, cam);
      if (l === playerLayer) this.vfx?.drawTombs(ctx, cam);   // behind every character, so a ghost floats in front of its stone
      if (l === playerLayer) {
        for (const m of this.boards.merchants.values()) this.boards.drawMerchant(ctx, cam, m);   // Hired Merchants, behind people
        for (const rp of this.others.values()) if (inShop(rp)) this.drawChar(ctx, cam, rp, rp.look, false);
        if (inShop(p)) this.drawChar(ctx, cam, p, this.look, true);
      }
      if (l === 7) for (const rp of this.others.values()) if (!inShop(rp)) { this.drawChar(ctx, cam, rp, rp.look, false); this.drawDiseases(ctx, cam, rp, rp.diseases); }
      for (const pet of this.pets.values()) if (!pet.onBack && pet.layer() === l) pet.draw(ctx, cam);
      if (l === playerLayer && !inShop(p)) { this.drawChar(ctx, cam, p, this.look, true); this.drawDiseases(ctx, cam); }
      if (l === playerLayer) this.drawMists(ctx, cam);   // over the characters and monsters standing in it
    }
    for (const pet of this.pets.values()) if (pet.onBack) pet.draw(ctx, cam);   // riding on a climber's back
    for (const sm of this.summons.values()) sm.draw(ctx, cam);
    this.drawDrops(ctx, cam);
    map.drawPortals(ctx, cam);
    this.drawFx(ctx, cam);
    map.drawBacks(ctx, cam, true);
    this.drawBalloons(ctx, cam);
    this.vfx?.drawWorld(ctx, cam);
    drawPartyHp(ctx, this, cam);
    this.drawNpcMark(ctx, cam);         // over everything in the world, the quest bulbs included

    for (const e of this.effects) {
      if (e.t < 0) continue;
      const a = Math.max(0, 1 - e.t / 1.2);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `bold ${e.size || 26}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4; ctx.strokeStyle = '#2a0f00'; ctx.fillStyle = e.color || '#ffb32b';
      const x = e.x - cam.x, y = e.y - cam.y - e.t * 40;
      ctx.strokeText(e.text, x, y); ctx.fillText(e.text, x, y);
      ctx.restore();
    }
    this.drawFieldClock(ctx, this.cam);   // on the station's board, over every map layer
    this.vfx?.drawHud(ctx);
    this.drawClock(ctx);
    this.hud?.draw?.(ctx);              // what you gain, in the lower-right corner
    this.hud?.drawBanner?.(ctx);        // the server's scrolling notice, under the bar and every window
    this.statusBar?.draw(ctx);
    this.windows?.draw(ctx);
    this.vfx?.drawBoss(ctx);
    const dark = this.darkness;
    if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  }

  drawChar(ctx, cam, ent, look, local) {
    const parts = look.compose(ent.action, ent.frame, ent.expr);
    const sx = ent.x - cam.x, sy = ent.y - cam.y;
    const chair = local ? ent.seat?.item : ent.action === 'sit' && ent.chair;
    if (chair) this.drawChair(ctx, chair, sx, sy, ent.facingRight);
    // while protected after a hit, alternate gray and normal every 60ms, as the original does
    const blink = local && this.invincible > 0 && !this.missed && Math.floor(this.invincible / 0.06) % 2 === 0;
    // dead: the ghost (body action "dead") hovers over the tombstone, drifting smoothly round a small circle
    // (not snapped to whole game pixels, so it glides instead of stepping)
    const dead = ent.action === 'dead', t = performance.now() / 700;
    const gx = dead ? Math.cos(t) * 3 : 0, gy = dead ? -24 + Math.sin(t) * 3 : 0;
    if (blink) { ctx.save(); ctx.filter = 'brightness(0.502)'; }   // the client tints to 0x808080, not grey
    const seeThrough = local ? this.hidden() : ent.hidden;   // Dark Sight / Wind Walk: half alpha
    drawParts(ctx, this.assets, parts, sx + gx, sy + gy, dead ? false : ent.facingRight, seeThrough ? 0.5 : 1, !dead);   // a ghost always faces left
    if (blink) ctx.restore();
    // a shop's sign: a booth around its owner (in front of them) or a board over the head; name tags on top
    if (ent.box?.type === 4) this.boards.drawShopBoard(ctx, this.cam, ent, sx, sy);
    if (ent.chalk) this.drawChalkboard(ctx, ent, sx, sy); else ent.chalkRect = null;
    if (!dead) this.drawCombo(ctx, ent, sx, sy, local ? this.comboValue() : ent.combo || 0);
    nameTag(ctx, ent.name, Math.round(sx), Math.round(sy) + 4, local ? '#fff' : '#cfe8ff');
    const guild = local ? this.guild?.name : ent.guild;
    if (guild) drawGuildTag(ctx, this, guild, local ? this.guild.emblem : ent.emblem, Math.round(sx), Math.round(sy) + 22);
  }



  drawDrops(ctx, cam) {
    for (const d of this.drops.values()) {
      const node = d.anim.node;
      const img = this.assets.image(node);
      if (!img) continue;
      const x = d.cx, y = d.landed && !d.pickedBy ? d.y + Math.trunc(3 * Math.sin(d.phase)) : d.cy;
      // icons hang from their left edge (origin x ~0), so centre them on the spot they lie on
      const oy = node.origin?.[1] ?? img.height;
      ctx.globalAlpha = d.alpha;
      if (d.angle) {                            // spinning on its way down: turn about the icon's middle
        ctx.save(); ctx.translate(Math.round(x - cam.x), Math.round(y - oy + img.height / 2 - cam.y)); ctx.rotate(d.angle);
        ctx.drawImage(img, Math.round(-img.width / 2), Math.round(-img.height / 2));
        ctx.restore();
      } else ctx.drawImage(img, Math.round(x - img.width / 2 - cam.x), Math.round(y - oy - cam.y));
      ctx.globalAlpha = 1;
    }
  }

  drawBalloons(ctx, cam) {
    // pets talk from just over their heads, without a name in front
    for (const pet of this.pets.values()) if (pet.chat) this.vfx?.drawBalloon(ctx, cam, { x: pet.x, y: pet.y + 44 }, pet.chat.text);
    // NPCs: the arrow just over the head; not while a quest icon is there
    for (const e of this.map.life) {
      if (!e.chat || this.vfx?.questIcons.has(e)) continue;
      const top = e.anims.stand?.frames[0]?.origin?.[1] ?? 80;
      this.vfx?.drawBalloon(ctx, cam, { x: e.x, y: e.y - top + 77 }, e.chat.text, 'npc');
    }
    const list = [this.player, ...this.others.values()].filter((e) => e.chat);
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    for (const e of list) {
      const text = `${e.name} : ${e.chat.text}`;
      if (this.vfx?.drawBalloon(ctx, cam, e, text)) continue;   // ChatBalloon.img; the drawn box is the offline fallback
      const lines = wrap(ctx, text, 160);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14, h = lines.length * 15 + 8;
      const x = Math.round(e.x - cam.x - w / 2), y = Math.round(e.y - cam.y - 90 - h);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.strokeStyle = '#555';
      roundRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#222'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 5 + i * 15));
    }
  }
}

function wrap(ctx, text, width) {
  const out = []; let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > width && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Item ids to draw from an avatar look packet (cash items replace the regular one in their slot). */
function visibleEquips(look) {
  const slots = { ...look.equips };
  if (look.cashWeapon) slots[11] = look.cashWeapon;
  return Object.values(slots);
}

/** Same rule for our own equipped inventory (slot -N normal, -(N+100) cash cover). */
export function equippedIds(equipped) {
  const bySlot = {};
  for (const [k, it] of Object.entries(equipped)) {
    const s = Number(k);
    if (s > -100) bySlot[-s] ??= it.id;
  }
  for (const [k, it] of Object.entries(equipped)) {
    const s = Number(k);
    if (s <= -100 && s !== -111) bySlot[-s - 100] = it.id;
  }
  if (equipped[-111]) bySlot[11] = equipped[-111].id;
  return Object.values(bySlot);
}

/**
 * Where an equip goes when worn: the character's slots (Equip window), and the pet's (its pet panel):
 * the pet accessory at -114 (where Cosmic's CHAR_INFO reads it) and the pet ability items
 * 1812000-1812007 (Meso Magnet, Item Pouch, Auto HP / MP, Wing Boots, Binocular, Magic Scales,
 * Item Ignore) at -121 .. -128. Cosmic recognises those by id wherever they sit.
 */
export function equipSlotFor(id) {
  const cat = Math.floor(id / 10000);
  const map = { 100: -1, 101: -2, 102: -3, 103: -4, 104: -5, 105: -5, 106: -6, 107: -7, 108: -8, 109: -10, 110: -9, 111: -12,
    112: -17, 113: -50, 114: -49, 180: -114, 190: -18, 191: -19 };
  if (cat >= 130 && cat < 170) return -11;
  if (id >= 1812000 && id <= 1812007) return -121 - (id - 1812000);
  return map[cat] ?? null;
}
