import { GameMap, nameTag, artTag, Anim } from './map.js';
import { Footholds, PHYS, accelerate, approach, swimVelocity } from './physics.js';
import { CharacterLook, drawParts, lookCanvases, equipPath, composeMounted, mountCanvases, mountPose } from './character.js';
import { weaponMultiplier, itemIcon, itemRewardIcon, itemSpec, itemReward, itemInfo, mesoIcon, invType, isScroll, scrollFits, ACTIONS, EXP, itemName } from './data.js';
import { stanceByte, STANCE_NAMES, lookEquipIds } from './net/proto.js';
import { Hud } from './ui/hud.js';
import { QuestBook, TITLE_AREA } from './quests.js';
import { npcTalk, localTalk, NpcDialog, PetSelectDialog, ShopWin, drawItemTip, drawSkillTip, DeathNotice, UtilBox } from './ui/dialogs.js';
import { npcQuestMenu, playQuestLines, questFlow } from './ui/quests-ui.js';
import { QuestMessages } from './ui/questmsg.js';
import { QuestAlert } from './questalert.js';
import { SkillBook, skillMaxDamage, critical, RANGED_WEAPONS, NO_AMMO_SHOTS } from './skills.js';
import { CODE_TO_SC, defaultKeymap, ACTION, MENU, DEFAULT_QUICKSLOTS, DEFAULT_QUICKSLOTS2, loadQuickKeys2 } from './keymap.js';
import { loadControls } from './controls.js';
import { PadInput } from './gamepad.js';
import { TouchControls } from './ui/touch.js';
import { WorldFx, EquipEffect, lineDelay } from './effects.js';
import { KeyCommands } from './commands.js';
import { DojoWindow } from './ui/dojo.js';
import { Reactor, loadReactorImg } from './reactors.js';
import { pad, frames } from './assets.js';
import { music, sfx } from './audio.js';
import { StatusBar, CHAT_COLOR, CHAT_BAR } from './ui/statusbar.js';
import { Weather } from './weather.js';
import { AvatarBanner } from './ui/avatarmega.js';
import { MapleTVWin, MapleTVScreen } from './ui/mapletv.js';
import { ItemGuardWin } from './ui/itemguard.js';
import { ApResetWin, ApConfirmWin, SpResetWin, SpConfirmWin, branchOf, advancement, spBook } from './ui/reset.js';
/** ENABLE_TV's error codes. */
const TV_ERRORS = { 1: 'Non-GM character tried to send GM message.', 2: "You've entered the wrong user name.", 3: 'The waiting line is longer than an hour. \r\nPlease try using it at a later time.' };
import { WindowManager, allCanvases } from './ui/windows.js';
import { ChannelWin, GameOptWin, SysOptWin } from './ui/options.js';
import { QuestAlarmWin } from './ui/questalarm.js';
import { MonsterBookWin } from './ui/monsterbook.js';
import { BookWin } from './ui/book.js';
import { MessengerWin } from './ui/messenger.js';
import { PartySearchWin } from './ui/partysearch.js';
import { FamilyWin, FamilyTreeWin, familyResult } from './ui/family.js';
import { MegaphoneWin } from './ui/megaphone.js';
import { notify, notifyLogin, questNotice, dropQuestNotice, hasQuestNotice } from './ui/notifier.js';
import { TeleportWin } from './ui/teleport.js';
import { DueyWin, dueyResult } from './ui/duey.js';
import { PlayerMenu, CharInfoWin, drawPartyHp, drawGuildTag } from './ui/social.js';
import { UserListWin, PartyHpWin, GuildContractWin, GuildMarkWin, heracleSays } from './ui/userlist.js';
import { TradeWin } from './ui/trade.js';
import { PlayerShopWin } from './ui/playershop.js';
import { uiText, TextField } from './ui/wzui.js';
import { ShopBoards } from './shopboards.js';
import { StorageWin } from './ui/storage.js';
import { WorldMapWin } from './ui/worldmap.js';
import { Pet, pickReaction, NO_LOOT_MAP } from './pets.js';
import { Summon, PUPPET_RANGE, PUPPETS } from './summons.js';
import { CashShopWin } from './ui/cashshop.js';
import { ChannelSession } from './net/channel.js';
import { wsTransport } from './net/connection.js';
import { bridgeUrl } from './ui/login-ui.js';
import { settings } from './settings.js';
import { VIEW_W, VIEW_H, UI_W, UI_H, UI_SCALE, applyResolution } from './view.js';
import { DirectionScene } from './direction.js';

// Teleport: F/P, I/L, Cleric, Blaze Wizard, Evan
// the camera's vertical slack (px you may rise / sink from its focus), its drift back to you (per second)
// and how long it takes to glide to a new focus height (s)
const CAM_LIFT = 50, CAM_DEADBAND = 28, CAM_DAMPING = 100;   // the original camera filter (see updateCamera)
/**
 * Pet equipment, by pet: accessory, Label Ring, Quote Ring and the ability items (Item Pouch, Meso Magnet, Wing Boots,
 * Binocular, Magic Scales, Item Ignore Pendant); the Auto HP / MP Potion Pouches are shared by all three.
 */
export const PET_SLOTS = [
  { acc: -114, label: -121, quote: -129, pouch: -122, magnet: -123, boots: -126, binocular: -127, scales: -128, ignore: -146 },
  { acc: -130, label: -131, quote: -132, pouch: -133, magnet: -134, boots: -135, binocular: -136, scales: -137, ignore: -147 },
  { acc: -138, label: -139, quote: -140, pouch: -141, magnet: -142, boots: -143, binocular: -144, scales: -145, ignore: -148 },
];
for (const s of PET_SLOTS) s.ability = [s.pouch, s.magnet, s.boots, s.binocular, s.scales, s.ignore];
export const SHARED_PET_SLOTS = [-124, -125];
const PET_FLAGS = ['pickupMeso', 'pickupItem', 'pickupOthers', 'longRange', 'sweepForDrop', 'consumeHP', 'consumeMP', 'ignorePickup'];
const PET_GONE = { 1: "The pet went back home because it's hungry.", 2: "The pet's magical time has run out, and so it has turned back into a doll.", 3: 'You cannot use pet here.' };
const PET_DOLL_TIME = 0x0217E646BB058000n;   // a dateDead from 2079 on: a doll
const FOLLOW_THE_LEAD = { 0: 8, 1: 10000018, 2: 20000024 };
export const MESO_ID = 2147483647;
const MAGIC_GUARDS = [2001002, 12001001, 22111001], POWER_GUARDS = [1101007, 1201007];
const SHOP_ERRORS = { 1: 'This shop is not open.', 2: 'The shop is full.', 4: 'You cannot do that while dead.', 6: 'You need a Shop Permit to open a shop.',
  10: 'You cannot open a store this close to a portal.', 13: 'You cannot open a store this close to another one.',
  15: 'You cannot open a shop here. Shops open in the Free Market rooms.', 16: 'You cannot open a shop here.',
  17: 'You may not enter this store.', 18: 'The owner is tending to this store. Please try again later.' };
const TELEPORTS = new Set([2101002, 2201002, 2301001, 12101003, 22101001]);
/** Teleport can be used again this long after it lands (ms), and this long after Meteor Shower, Blizzard or Genesis. */
const TELEPORT_DELAY = 600, TELEPORT_AFTER_ULTIMATE = 3000;
/** The cash item the death notice offers to revive you on the spot. */
const WHEEL_OF_DESTINY = 5510000;
/** fieldLimit bit: no movement skills (Teleport, Monster Magnet...) on this map. */
const FIELD_NO_MOVEMENT_SKILLS = 0x2;

const TAB_NAMES = { 1: 'Eqp', 2: 'Use', 3: 'Setup', 4: 'Etc', 5: 'Cash' }, QUEST_GREY = '#bbbbbb';

const PRELOAD_ACTIONS = ['stand1', 'stand2', 'walk1', 'walk2', 'jump', 'prone', 'ladder', 'rope', 'alert', 'dead',
  'swingO1', 'swingO2', 'swingO3', 'stabO1', 'swingT1', 'swingT2', 'swingT3', 'stabT1', 'swingP1', 'swingP2', 'stabT2'];
/** An Aran's basic attacks with a polearm. */
const POLEARM_SWINGS = ['swingT2PoleArm', 'swingP1PoleArm', 'swingP2PoleArm'];
/** The arrows' scancodes, for the key commands. */
const COMMAND_SC = { left: 0x4b, right: 0x4d, up: 0x48, down: 0x50 };
// portal types that fire on touch instead of the Up key (types 3 and 9 have their own checks, also off the floor)
const TOUCH_PORTALS = new Set([12, 13, 14]);

/**
 * Keyboard state by physical key. Arrows are fixed; everything else is resolved through the
 * server keymap (scancode -> {type, action}) by Game.
 */
class Input {
  constructor(canvas) {
    this.down = new Set(); this.pressed = new Set(); this.repeats = new Set(); this.clicks = [];
    this.events = [];   // every press (the system's repeats too) and release, in order, for the key commands
    this.sources = new Map();   // controller / touch: source -> codes it holds
    const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const map = (e) => ARROWS[e.code] || (CODE_TO_SC[e.code] ? e.code : null);
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (document.querySelector('.modal-overlay')) return;
      const k = map(e) || (e.code === 'Numpad0' ? 'Numpad0' : null); if (!k || e.code === 'Enter' || e.code === 'Escape') return;
      e.preventDefault();
      if (this.filter?.(k, 1)) return;   // held back (the Dojo's Ctrl + Alt)
      if (!this.down.has(k)) this.pressed.add(k);
      if (e.repeat) this.repeats.add(k);   // the system's key repeat: only the last key pressed repeats
      this.down.add(k);
      this.events.push({ k, down: 1 });
    });
    addEventListener('keyup', (e) => { const k = map(e); if (k) { this.filter?.(k, 0); this.down.delete(k); this.events.push({ k, down: 0 }); } });
    addEventListener('blur', () => this.down.clear());
    // NPCs open on a double-click, as in the client
    canvas.addEventListener('dblclick', (e) => {
      const r = canvas.getBoundingClientRect();
      this.clicks.push({ x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H });
    });
    // a single click only counts on an NPC's quest icon
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      this.clicks.push({ x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H, single: true });
    });
  }
  /**
   * Another source of held codes (the controller, the touch controls): what it holds now. A code it starts to hold
   * counts as pressed this frame unless the keyboard already holds it; letting go of it leaves the keyboard's alone.
   */
  setHeld(source, codes) {
    const before = this.sources.get(source) || new Set();
    for (const c of codes) if (!before.has(c) && !this.is(c)) { this.pressed.add(c); this.events.push({ k: c, down: 1 }); }
    this.sources.set(source, new Set(codes));
    for (const c of before) if (!this.is(c)) this.events.push({ k: c, down: 0 });
  }
  /** Every code held by the keyboard or any other source. */
  held() {
    const all = new Set(this.down);
    for (const s of this.sources.values()) for (const c of s) all.add(c);
    return all;
  }
  is(k) {
    if (this.down.has(k)) return true;
    for (const s of this.sources.values()) if (s.has(k)) return true;
    return false;
  }
  hit(k) { return this.pressed.has(k); }
  repeated(k) { return this.repeats.has(k); }
  endFrame() { this.pressed.clear(); this.repeats.clear(); this.clicks.length = 0; this.events.length = 0; }
  /** A press held back earlier, let through now (`held`: the key is still down). */
  inject(k, held) {
    if (!this.down.has(k)) this.pressed.add(k);
    if (held) this.down.add(k);
    this.events.push({ k, down: 1 });
  }
}

/** Another character on the map (SPAWN_PLAYER / MOVE_PLAYER). */
/**
 * Face expressions: the emotion number indexes this list (1 = hit). An expression loops its Face.img frames
 * for its own delay (5s when it has none), then the face goes back to default, which blinks now and then.
 */
export const EMOTES = ['hit', 'smile', 'troubled', 'cry', 'angry', 'bewildered', 'stunned', 'vomit', 'oops', 'cheers', 'chu',
  'wink', 'pain', 'glitter', 'blaze', 'shine', 'love', 'despair', 'hum', 'bowing', 'hot', 'dam'];
const HIT_FACE_TIME = 1.5;   // a hit that does damage shows the hit face for 1.5s
export function setExpression(ent, n, time = null) {
  const name = EMOTES[n - 1];
  if (name) ent.expr = { name, frame: 0, t: 0, left: time };
}
export function stepExpression(ent, look, dt) {
  let e = ent.expr;
  if (!e) {
    // idle: blink every few seconds
    if ((ent.blinkT = (ent.blinkT ?? 2 + Math.random() * 4) - dt) > 0) return;
    ent.blinkT = 2 + Math.random() * 4;
    e = ent.expr = { name: 'blink', frame: 0, t: 0, left: Infinity, once: true };
  }
  const node = look?.face?.[e.name];
  if (!node) { ent.expr = null; return; }
  if (e.left === null) e.left = (Number(node.delay) || 5000) / 1000;   // an expression's own length, else 5s
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
    // already on a ladder, lying down, in the air... when you arrive; standing still rather than walking in place
    const st = STANCE_NAMES[d.stance >> 1];
    if (st && st !== 'walk') this.state = st;
    this.action = look.standAction(); this.frame = 0; this.frameT = 0;
    this.path = null; this.attack = null; this.chat = null;
    this.fhId = d.fh || 0;
  }
  /**
   * Their movement queues behind what is still playing (as the client does); with more than 1.1s queued it plays 10%
   * faster, and with more than 5s it jumps to the end.
   */
  applyMovement(moves) {
    const steps = moves.filter((m) => m.x !== undefined || m.stance !== undefined);
    if (!steps.length) return;
    if (this.path) this.path.steps.push(...steps);
    else this.path = { steps, i: 0, t: 0, fromX: this.x, fromY: this.y };
    const left = this.path.steps.slice(this.path.i).reduce((t, m) => t + (m.duration || 0), 0);
    if (left > 5000) {
      const end = [...this.path.steps].reverse().find((m) => m.x !== undefined);
      if (end) { this.x = end.x; this.y = end.y; }
      this.path = null;
    }
  }
  update(dt) {
    if (this.path) {
      const p = this.path, s = p.steps[p.i];
      const dur = Math.max(1, s.duration ?? 60) / 1000;   // 0: at once (a jump's start)
      const queued = p.steps.slice(p.i).reduce((t, m) => t + (m.duration || 0), 0) - p.t * 1000;
      p.t += queued > 1100 ? dt * 1.1 : dt;
      const k = Math.min(1, p.t / dur);
      if (s.x !== undefined) { this.x = p.fromX + (s.x - p.fromX) * k; this.y = p.fromY + (s.y - p.fromY) * k; }
      if (s.fh) this.fhId = s.fh;   // a foothold, or -id of a ladder / rope; 0 (in the air) keeps the last
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
const isPetEquip = (id) => { const c = Math.floor(id / 10000); return c === 180 || c === 181 || c === 182 || c === 183; };

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
const GROUND_ONLY = new Set([1311006, 4221001, 4221007, 4221006, 4211006, 1121006, 1221007, 1321003, 5121004, 5111006, 15111003, 5101002,
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
 * On a ladder or rope only buffs go, and not these: Ninja Ambush, Dash, Battleship, the beginner / Noblesse / Legend
 * riding and travel skills, Evan's Magic Shield and Soul Stone, Mystic Door, Puppet and Smokescreen.
 */
const idRun = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const NO_LADDER = new Set([4121004, 4221004, 5001005, 15001003, 5221006, 1013, 1014, 1017, 1018, 1019, 10001014, 10001015,
  10001019, 20001019, 10001022, 20001022, 10001023, 20001023, 22131001, 22181003, ...idRun(1027, 1031),
  ...idRun(10001027, 10001031), ...idRun(20001027, 20001031), ...idRun(20011027, 20011031), 2311002, ...PUPPETS, 4221006]);
/** Characters on a ladder or rope, and ghosts, are drawn facing left whichever way they face. */
const CLIMBING = /^(ladder|rope)2?$/;
const drawnRight = (ent) => !!ent.facingRight && ent.action !== 'dead' && !CLIMBING.test(ent.action);
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
/** BuffStat.MORPH (second mask): transformed by a morph potion or skill. */
const MORPH = 0x2n;
const STUN_MASTERY = 5110000, BERSERK = 1320006, WIND_WALK = 13101006, VANISH = 14100005, DARK_SIGHTS = [4001003, 14001003];
/** Body Pressure (Aran): the monster your body touches takes its damage. */
const BODY_PRESSURE = 21101003;
/** Energy Charge (Marauder / Thunder Breaker): once charged, the monster your body touches takes its damage. */
const ENERGY_CHARGE = 5110001, THUNDER_ENERGY_CHARGE = 15100004;
/** Use types (id / 10000) used with a plain USE_ITEM: potions, food, elixirs, cures, morph potions, cards... */
const PLAIN_USE = new Set([200, 201, 202, 205, 221, 236, 238, 245]);
/** Use types with a request of their own (catch items, Solomon's writs, the Use-tab teleport rock, scripted items...). */
const USE_ROUTED = new Set([227, 232, 237, 243]);
/**
 * The timed stats whose running out the client reports (CANCEL_DEBUFF): in the low mask Stun, Poison, Seal,
 * Darkness, Weakness and Curse; in the high mask Slow, Reverse (0x80000) and the stats at 0x100, 0x8000 and
 * 0x80000000000-0x200000000000.
 */
const EXPIRY_CHECKED = {
  low: 0x2000000000000n | 0x4000000000000n | 0x8000000000000n | 0x10000000000000n | 0x4000000000000000n | 0x8000000000000000n,
  high: 0x1n | 0x100n | 0x8000n | 0x80000n | 0x80000000000n | 0x100000000000n | 0x200000000000n,
};
/** The Dark Sight (second mask) and Wind Walk (first mask) buff bits. */
const DS_MASK = 0x40000000000n, WW_MASK = 0x400000000n, ASSASSINATE = 4221001;
const RIDING_MASK = 0x20000000000000n;   // BuffStat.MONSTER_RIDING (first mask)
// a monster's blow on a player sounds only for its first two attacks and attackF
const CHAR_DAM = { 0: 'CharDam1', 1: 'CharDam2', 8: 'CharDamF' };
// another player's level up, job change, quest clear, monster card and item level up, heard in full
const FOREIGN_SOUND = { 0: 'Game/LevelUp', 8: 'Game/JobChanged', 9: 'Game/QuestClear', 0x0d: 'Game/mCardGet', 0x0f: 'Game/ItemLevelUp' };
// Grenade and Poison Bomb make no weapon swing; Grenade's throw is Use2; Blast's cast follows the charge on the weapon
const GRENADE = 5201002, BLAST = 1221009, NO_SWING = new Set([GRENADE, 14111006]);
const BLAST_USE = { 1211003: 'Use2', 1211004: 'Use2', 1211005: 'Use3', 1211006: 'Use3', 21111005: 'Use3', 1211007: 'Use4', 1211008: 'Use4',
  15101006: 'Use4', 1221003: 'Use5', 1221004: 'Use5', 11111007: 'Use5' };
// a held Big Bang or Piercing Arrow loops its Loop sound
const LOOP_HOLDS = new Set([2121001, 2221001, 2321001, 3221001]);
// Avenger keeps its own Hit over a cash star's
const AVENGERS = new Set([4111005, 14111002]);
// shots that make no Attack2 as they leave: Hurricane, Battleship Cannon / Torpedo, Wind Piercing, Wind Shot, the
// homing ones, Shadow Meso, Storm Break, Vampire
const SILENT_SHOTS = new Set([3121004, 13111002, 5221007, 5221008, 13111006, 13111007, 5211006, 5220011, 22151002, 4111004, 13101005, 14101006]);
// Barrage, Demolition and the like: only their first line sounds their Hit (Arrow Bomb's only if it hurt)
const FIRST_HIT_ONLY = new Set([5121007, 15111004, 5121004, 22171002, 3101005]);
/** Riding skills: Monster Rider, Battleship, and the skill vehicles (Spaceship, Yeti, Witch's Broomstick, Barlog...). */
const MONSTER_RIDERS = new Set([1004, 10001004, 20001004, 20011004]), BATTLESHIP = 5221006;
const SKILL_VEHICLE_SKILLS = new Set([1013, 1017, 1018, 1019, 10001014, 10001019, 10001022, 10001023, 20001019, 20001022, 20001023,
  ...[1027, 1028, 1029, 1030, 1031].flatMap((n) => [n, 10000000 + n, 20000000 + n, 20010000 + n])]);
/** The skill vehicles: 1932001-1932005 and 1932007-1932011. */
const isSkillVehicle = (id) => (id > 1932000 && id < 1932006) || (id > 1932006 && id < 1932012);
/** Usable on a mount: Space Dash (on a skill vehicle), Space Beam, and on the Battleship its skills, Maple Warrior and Hero's Will. */
const SPACE_DASHES = new Set([1014, 10001015]), SPACE_BEAMS = new Set([1015, 10001016]);
const RIDE_SHIP_SKILLS = new Set([5201002, 5201003, 5211001, 5211002, 5211004, 5211005, 5220002, 5221000, 5221007, 5221008, 5221010,
  14111006, 21121008, 22171004]);
/** A tired mount: tiredness at least (level / 3) x 10 + 95 (checked on SET_TAMING_MOB_INFO / SPAWN_PLAYER). */
const mountTired = (level, tired) => tired >= Math.floor(level / 3) * 10 + 95;
const FLASH_JUMPS = new Set([4111006, 14101004]), FLASH_JUMPS_NW = 14101004;
/** Shadow Shifter by job (Night Lord, Shadower); Meso Guard; Chakra. */
/** How much movement (ms) gathers before it goes to the server, as the client does. */
const MOVE_FLUSH = 500;
const ASSAULTER = 4211002, BOOMERANG_STEP = 4221007, DOUBLE_STAB = 4001334;
/** Spear / Pole Arm Crusher: their effect layers go up to effect<attackCount>. */
const CRUSHERS = new Set([1311001, 1311002]);
const HEROS_WILLS = new Set([1121011, 1221012, 1321010, 2121008, 2221008, 2321009, 3121009, 3221008, 4121009, 4221008, 5121008,
  21121008]);
const SHIFTERS = { 412: 4120002, 422: 4220002 }, MESO_GUARD = 4211005, CHAKRA = 4211001, MESO_EXPLOSION = 4211006;
/** Shadow Partner (Hermit, Night Walker) and its buff bit (second mask). Taunt and Vampire don't get its throws. */
const SHADOW_PARTNERS = [4111002, 14111000], SP_MASK = 0x400000000000000n, NO_PARTNER = new Set([4121003, 14101006]);
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
/** Meso Explosion's lines shown as up to five numbers: line i adds to number i % 5. */
const foldLines = (dmg) => dmg.reduce((o, d, i) => { o[i % 5] = (o[i % 5] || 0) + d; return o; }, []);
function hitWave(i, kind, skillId, remote = false) {
  if (skillId === MESO_EXPLOSION) return 0;   // every monster at once
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
/** How long a pickup takes (s); see updateDrops. */
const PICKUP_TIME = 0.7;

/** Chat line colours, as in the v83 chat log. */
const CHAT_COLORS = { ...CHAT_COLOR, find: CHAT_COLOR.grey, notice: CHAT_COLOR.error };
const GROUP_KEYS = ['buddy', 'party', 'guild', 'alliance'];
// keymap UI actions for the chat: open the input with a target, or toggle the log
const CHAT_KEYS = { 10: 'all', 11: 'whisper', 12: 'party', 13: 'buddy', 16: 'toggle', 18: 'guild', 21: 'spouse', 24: 'alliance' };
/** PARTY_OPERATION result codes that are only a chat line (0x15-0x17 name the other character; 0x12 says nothing) */
const PARTY_MESSAGES = {
  0x09: 'Already have joined a party.', 0x10: 'Already have joined a party.', 0x0A: "A beginner can't create a party.",
  0x0D: 'You have yet to join a party.', 0x11: "The party you're trying to join is already in full capacity.", 0x12: '',
  0x13: 'Unable to find the requested character in this channel.', 0x15: '%s is currently blocking any party invitations.',
  0x16: "'%s' is taking care of another invitation.", 0x17: '%s have denied request to the party.', 0x19: 'Cannot kick another user in this map',
  0x1C: 'This can only be given to a party member within the vicinity.',
  0x1D: 'Unable to hand over the leadership post; No party member is currently within the vicinity of the party leader.',
  0x1E: "You may only change with the party member that's on the same channel.", 0x20: "As a GM, you're forbidden from creating a party.",
  0x21: 'Unable to find the character.',
};
const PARTY_ERROR = "Your request for a party didn't work due to an unexpected error.";
/** GUILD_OPERATION result codes: a chat line, or Heracle saying it (npc). 0x35-0x37 name the other character. */
const GUILD_MESSAGES = {
  0x1F: ['npc', 'The problem has happened during the process of gathering agreement of forming the guild... Plese try again later...'],
  0x21: ['chat', 'Already joined the guild.'], 0x28: ['chat', 'Already joined the guild.'],
  0x23: ['chat', 'You cannot make a guild, due to the limitation of minimum level requirement.'],
  0x24: ['npc', 'Somebody has disagreed to form a guild...  Please come back to me when you meet with the right people...  You can only make a guild after getting agreement from all...'],
  0x26: ['npc', 'The problem has happened during the process of forming the guild... Plese try again later...'],
  0x29: ['chat', 'The guild, you are trying to join, has already reached the max number of users.'],
  0x2A: ['chat', 'The character cannot be found in the current channel.'],
  0x2D: ['chat', 'You are not in the guild.'], 0x30: ['chat', 'You are not in the guild.'],
  0x34: ['npc', 'The problem has happened during the process of disbanding the guild... Plese try again later...'],
  0x35: ['chat', '%s is currently not accepting guild invite message.'], 0x36: ['chat', "'%s' is taking care of another invitation."],
  0x37: ['chat', '%s has denied your guild invitation.'], 0x38: ['chat', 'Admin cannot make a guild.'],
  0x3B: ['npc', 'The problem has happened during the process of increasing the guild... Plese try again later...'],
  0x4A: ['chat', 'There are less than 6 members remaining, so the quest cannot continue. Your Guild Quest will end in 5 seconds.'],
  0x4B: ['chat', 'The user that registered has disconnected, so the quest cannot continue. Your Guild Quest will end in 5 seconds.'],
};
const GUILD_ERROR = 'The guild request has not been accepted, due to unknown reason.';
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
    this.input.filter = (k, down) => this.dojoKey(k, down);
    this.controls = loadControls();          // controller and touch layouts, kept in this browser
    this.padInput = new PadInput(this.input, () => this.controls?.padMove || 'ls');
    this.cam = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
    this.player = {
      name: 'Player', x: 0, y: 0, vx: 0, vy: 0, fh: null, ladder: null, facingRight: false,
      action: 'stand1', frame: 0, frameT: 0, attack: null, ignoreFh: null, ignoreT: 0, chat: null,
    };
    this.effects = [];
    this.weather = new Weather(this); this.avatarBanner = new AvatarBanner(this); this.mapleTV = new MapleTVScreen(this);
    this.others = new Map(); this.drops = new Map(); this.pendingDrops = new Map(); this.lifeByOid = new Map(); this.pets = new Map(); this.summons = new Map();
    this.boards = new ShopBoards(this);
    this.queue = []; this.loading = false;
    this.fps = 0; this._frames = 0; this._fpsT = 0;
    this.moveBuf = []; this.moveTotal = 0;
    this.invincible = 0; this.portalCooldown = 0;
    this.stats = null; this.inventory = null; this.meso = 0;
    this.keymap = defaultKeymap();
    this.quickKeys = [...DEFAULT_QUICKSLOTS];   // the quick slots' keys, from the server
    this.quickKeys2 = [...DEFAULT_QUICKSLOTS2];  // the second quick slot panel's, kept in this browser
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
    // the interface's point (UI SIZE), and the field's
    const at = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * UI_W / r.width, (e.clientY - r.top) * UI_H / r.height]; };
    const field = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * VIEW_W / r.width, (e.clientY - r.top) * VIEW_H / r.height]; };
    const wm = this.windows;
    // windows sit above the bar: they see the event first, the bar only gets what they leave
    // in the Cash Shop only its windows take the mouse (the bar is hidden, and the shop may not cover the screen)
    const route = (type, e) => this.uiLocked || (this.inCashShop ? (wm.pointer(type, ...at(e)), true)
      : wm.pointer(type, ...at(e)) ? (sb.pointer('move', -1, -1), true) : sb.pointer(type, ...at(e)));
    c.addEventListener('pointermove', (e) => route('move', e));
    c.addEventListener('pointerdown', (e) => { if (route('down', e)) e.stopImmediatePropagation(); }, true);
    addEventListener('pointerup', (e) => route('up', e));
    c.addEventListener('click', (e) => { const p = at(e); if (wm.top(...p) || sb.contains(...p)) e.stopImmediatePropagation(); }, true);
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = at(e), b = this.vfx?.buffAt(...p);
      // right-click a buff icon to end it: a skill's (not Dragon Roar's) or an item's
      if (b) { if (b.source < 0) this.cancelItemEffect(-b.source); else if (b.source > 0 && b.source !== DRAGON_ROAR) this.net?.cancelBuff(b.source); return; }
      const tw = wm.top(...p);
      if (tw?.rclick) { tw.rclick(p[0] - tw.x, p[1] - tw.y); return; }
      // right-click another player: Personal Info / Whisper / Party Invite / Trade
      const rp = !wm.top(...p) && !sb.contains(...p) && this.playerAt(...field(e));
      if (rp && this.net) wm.show(new PlayerMenu(wm, rp, Math.round(p[0]), Math.round(p[1])));
    });
    // double-click a character (yourself included) for their Character Info
    c.addEventListener('dblclick', (e) => {
      const u = at(e), p = field(e);
      if (wm.top(...u) || sb.contains(...u) || !this.net) return;
      const wx = p[0] + this.cam.x, wy = p[1] + this.cam.y;
      // the QuestAlert bulb: its list of quests
      if (this.questAlert?.hits(wx, wy)) { if (!this.windows.order.some((w) => w instanceof NpcDialog)) this.questAlert.open(); return; }
      // a shop sign takes you into the shop
      const signed = this.shopSignAt(p[0] + this.cam.x, p[1] + this.cam.y);
      if (signed && signed !== this.player) { this.net.pshopVisit(signed.box.oid); return; }
      const stall = this.boards.at(p[0] + this.cam.x, p[1] + this.cam.y);
      if (stall?.merchant && stall.merchant.owner !== this.player.id) { this.net.pshopVisit(stall.merchant.oid); return; }
      const rp = this.playerAt(...p) || (this.hitsChar(this.player, ...p) ? this.player : null);
      if (rp) { this.requestCharInfo(rp.id); return; }
      // a pet: its owner's
      for (const pet of this.pets.values()) if (pet.hits(wx, wy)) { this.requestCharInfo(pet.owner); return; }
    });
    c.addEventListener('wheel', (e) => {
      // deltaMode 1 = lines (some mice / Firefox): count each as a pixel step of 40
      const dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1);
      if (wm.pointer('wheel', ...at(e), dy) || (!this.inCashShop && sb.wheel(...at(e), dy))) e.preventDefault();
    }, { passive: false });
    const place = this.placeUi = () => {
      TextField.stretchY = c.clientWidth ? (c.clientHeight / c.clientWidth) * (VIEW_W / VIEW_H) : 1;
      sb.place({ left: 0, top: 0 }, c.clientWidth / UI_W);
    };
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
  /** After weather music: the field's music back (a changed one is restarted), or the map's. */
  restoreFieldMusic() {
    if (this.fieldBgm) music.play(this.fieldBgm, { fadeOut: 1000, fadeIn: 1000, force: true });
    else music.play(this.map?.info?.bgm);
  }
  /** Back to the login screen, without the leave-page warning. */
  leave() { this.leaving = true; location.reload(); }
  enterCashShop() { if (this.net && !this.inCashShop && !this.dead) this.net.enterCashShop(); }
  /** SET_CASH_SHOP: the server took us off the map; swap the world for the shop screen. */
  openCashShop(d) {
    this.inCashShop = true;
    const info = d.info;
    if (info) { Object.assign(this.stats, info.stats); this.inventory = info.inventory; this.meso = info.meso; this.rings = info.rings; }
    this.others.clear(); this.clearDrops(); this.pets.clear(); this.lifeByOid.clear(); this.summons.clear(); this.boards.clear(); this.reactors?.clear();
    for (const w of [...this.windows.order]) this.windows.close(w);
    this.showChatBox(false);
    this.weather.stop(false); this.skillLoop?.stop(); this.skillLoop = null;   // nothing of the map plays on in the shop
    music.play('BgmUI/ShopBgm', { fadeOut: 0, fadeIn: 0 });   // a cut, no fade
    this.csWin = this.windows.show(new CashShopWin(this.windows, d), null);
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
      if (info) { Object.assign(this.stats, info.stats); this.inventory = info.inventory; this.meso = info.meso; this.rings = info.rings; }
      if (fromCashShop) { this.inCashShop = false; if (this.csWin) this.windows.close(this.csWin); this.csWin = null; music.stop(600); }
      const loaded = this.changeMap(entered.mapId, { portalIdx: entered.portal });
      net.flush();
      await loaded;
      if (info) this.basicGuide();
      // the server comes back without your item effect: put it back on (or off, if the item is gone)
      const fx = this.player.itemFxId;
      if (fx) { if (this.itemCount(fx)) net.useItemEffect(fx); else this.setItemEffect(this.player, 0); }
      if (fromCashShop) { this.windows.open('minimap'); this.showChatBox(true); }
      if (this.stats.hp <= 0 && !this.dead) this.die(false);   // still dead after the switch
    } catch (e) {
      console.error(e);
      this.hooks.onLoading?.(false);
      await this.windows.notice(fromCashShop ? 'Leaving the Cash Shop failed. Please log in again.' : 'Changing channel failed. Please log in again.');
      this.leave();
    } finally {
      this.switching = false;
    }
  }

  /** The other player under a canvas point. */
  /**
   * The field's cursor under the mouse, as v83 picks it each frame when no window is there: 1 over an NPC, 2 over
   * another player (who wins over an NPC), else 0. (x, y) is the interface's point.
   */
  fieldCursor(x, y) {
    if (x < 0 || !this.map || this.windows?.top(x, y) || this.statusBar?.contains?.(x, y)) return 0;
    x *= UI_SCALE; y *= UI_SCALE;
    if (this.playerAt(x, y)) return 2;
    const wx = x + Math.round(this.cam.x), wy = y + Math.round(this.cam.y);
    for (const e of this.map.life) {
      if (e.kind !== 'Npc' || e.oid === null) continue;
      const b = e.box();
      if (wx >= b.left && wx <= b.right && wy >= b.top && wy <= b.bottom) return 1;
    }
    return 0;
  }
  playerAt(x, y) { for (const rp of this.others.values()) if (this.hitsChar(rp, x, y)) return rp; return null; }
  hitsChar(ent, x, y) {
    const wx = x + Math.round(this.cam.x), wy = y + Math.round(this.cam.y);
    return wx >= ent.x - 18 && wx <= ent.x + 18 && wy >= ent.y - 64 && wy <= ent.y;
  }
  requestCharInfo(id) { this.net?.charInfo(id); }
  /**
   * Raise (1) or drop (0) a character's fame from the info window, as Send_GIVE_FAME does: the character must be
   * on this map ("Unable to find the character."), and a request goes at most once every 5 minutes (300000 ms;
   * sooner is "Please try it again later."). Both lines are chat type 0xC.
   */
  giveFame(name, mode) {
    const rp = [...this.others.values()].find((o) => o.name === name);
    const say = (t) => this.hud.message(t, CHAT_COLOR.error);
    if (!rp) return say('Unable to find the character.');
    const now = performance.now();
    if (now - (this.lastFameAt ?? -Infinity) <= 299999) return say('Please try it again later.');
    this.lastFameAt = now;
    this.net?.giveFame(rp.id, mode);
  }
  /** A drawable look from packet look data (loads in the background; draws once ready). */
  lookFrom(d) {
    if (!d) return null;
    const look = new CharacterLook(this.assets, { skin: d.skin, face: d.face, hair: d.hair, gender: d.gender, equips: lookEquipIds(d) });
    look.load().then(() => this.assets.preload(lookCanvases(look, [look.standAction()]))).then(() => { look.ready = true; });
    return look;
  }
  requestTrade(rp) { if (this.tradeWin) { this.notice('You are already trading.'); return; } this.net?.tradeStart(rp.id); }

  // ------------------------------------------------------------------ keymap
  /** Physical keys currently bound to (type, action) and pressed this frame / held. */
  keysFor(type, action) {
    const out = [];
    for (const [code, sc] of Object.entries(CODE_TO_SC)) { const k = this.keymap[sc]; if (k && k.type === type && k.action === action) out.push(code); }
    for (const [i, k] of Object.entries(this.controls?.pad || {})) if (k && k.type === type && k.action === action) out.push(`pad:${i}`);
    for (const t of this.controls?.touch.buttons || []) if (t.b && t.b.type === type && t.b.action === action) out.push(`touch:${t.id}`);
    return out;
  }
  /** What a held code is bound to: a key through the server key map, `pad:<n>` / `touch:<id>` through their layouts. */
  bindingOf(code) {
    if (code.startsWith('pad:')) return this.controls?.pad[code.slice(4)] || null;
    if (code.startsWith('touch:')) return this.controls?.touch.buttons.find((t) => `touch:${t.id}` === code)?.b || null;
    return this.keymap[CODE_TO_SC[code]] || null;
  }
  /** The picture for a binding: function icon, skill icon (loading it if need be), macro or item icon. */
  bindingIcon(b) {
    const wm = this.windows;
    if (!b || !wm) return null;
    if (b.type === 1) { const n = this.skills?.icon(b.action); if (!n) this.skills?.ensure?.(b.action); return n || null; }
    if (b.type === 2 || b.type === 3 || b.type === 7) return wm.icon(b.action);
    if (b.type === 8) return wm.W.SkillMacro?.Macroicon?.[b.action]?.icon || null;
    return wm.W.KeyConfig?.icon?.[b.action] || null;
  }
  hitAction(a) { return this.keysFor(5, a).some((c) => this.input.hit(c)); }
  /** The pickup key: a press, or its key repeat while held (so holding it keeps picking up); Numpad 0 always works. */
  pickupKey() {
    const keys = [...this.keysFor(5, ACTION.PICKUP), 'Numpad0'];
    return keys.some((c) => this.input.hit(c) || this.input.repeated(c));
  }
  // held, or tapped since the last frame (a quick tap can start and end between two frames)
  holdAction(a) { return this.keysFor(5, a).some((c) => this.input.is(c) || this.input.hit(c)); }

  unbindKey(sc) {
    if (!this.keymap[sc]) return;
    delete this.keymap[sc];
    this.net?.changeKeymap([{ key: sc, type: 0, action: 0 }]);
    this.keyBar?.render(); this.statusBar?.render();
  }
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
      const k = this.bindingOf(code);
      if (!k) continue;
      if (k.type === 4) this.toggleMenu(k.action);
      else if (k.type === 6) this.emote(k.action - 99);
      else if (k.type === 3) this.useFaceItem(k.action);
      else if (k.type === 7) this.useItemEffect(k.action);
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
    if (!ids.length || this.macroQueue?.length || this.dead) return;
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
      const ok = await notify(this.windows, 'family', e.name);
      this.net?.familyAnswer(e.id, e.name, ok);
    } else if (e.op === 'joined') { say(e.ok ? `${e.name} has joined the family.` : `${e.name} has declined your family invitation.`); refresh(); }
    else if (e.op === 'senior') { say(`You are now a junior of ${e.name}.`); this.net?.familyOpen(); refresh(); }
    else if (e.op === 'rep') say(`You have gained ${e.gain} reputation${e.from ? ` from ${e.from}` : ''}.`);
    else if (e.op === 'login') { if (e.online) notifyLogin(this.windows, e.name); }
    else if (e.op === 'summon') {
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
      if (await notify(this.windows, 'messenger', e.from)) win.accept(e.id);
      else this.net?.messengerDecline(e.from);
      return;
    }
    if (!win.active) return;
    win.event(e);
  }

  /**
   * A megaphone from the Cash tab: the Megaphone asks in the text prompt; the Super, Item, Triple and Avatar
   * megaphones open their windows (the Item Megaphone not with a shop-type window open).
   */
  async openMegaphone(slot, itemId) {
    const kind = Math.floor(itemId / 1000) % 10, avatar = Math.floor(itemId / 10000) === 539;
    if (!avatar && ![1, 2, 5, 6, 7].includes(kind)) return;
    if (!this.cashGate()) return;
    if (kind === 5 && !avatar) {
      if (itemId % 1000 > 5) return;
      const tv = new MapleTVWin(this.windows, Number(slot), itemId);
      await this.assets.preload(tv.frames());
      this.windows.show(tv);
      return;
    }
    if (kind === 1 && !avatar) {
      const text = (await this.windows.askText('Enter your comments through the megaphone.', '', { max: 60 }))?.trim();
      if (text && (await this.megaphoneTextOk(text))) this.cashSend(() => this.net?.useMegaphone(Number(slot), itemId, { text }));
      return;
    }
    if (kind === 6 && !avatar && this.tradeOpen()) { this.hud.message('Not available', CHAT_COLOR.error); return; }
    const win = new MegaphoneWin(this.windows, Number(slot), itemId);
    await this.assets.preload(win.frames());
    this.windows.show(win);
  }
  /** The Megaphone / Super Megaphone's checks on what you wrote: no curses, over level 10, up to 60 characters. */
  async megaphoneTextOk(text) {
    if (!text) return false;
    if (await this.cursed(text)) { this.windows.notice('Cursing is not allowed.'); return false; }
    if ((this.stats?.level || 0) <= 10) { this.windows.notice('This megaphone is only available for \r\ncharacters that are over Level 10.'); return false; }
    if (text.length > 80) return false;
    if (text.length > 60) { this.windows.notice('Use the megaphone to text up to 60 characters.'); return false; }
    return true;
  }
  /** Whether a line holds a word from Etc/Curse.img (ignoring case), or a control character. */
  async cursed(text) {
    if (/[\x00-\x09\x0b\x0c\x0e-\x1f]/.test(text)) return true;
    return (await this.maskCurses(text)) !== text;
  }
  /** A shop-type window is open (NPC shop, Storage, Duey, the Item Megaphone): many cash items say "Not available". */
  tradeOpen() {
    const open = (w) => w && this.windows.order.includes(w);
    return open(this.shopWin) || open(this.storageWin) || open(this.dueyWin) || this.windows.order.some((w) => w instanceof MegaphoneWin && w.kind === 6);
  }

  /** Duey: talking to him sends the parcels waiting for you, which opens his window; results come back as codes. */
  async onDuey(e) {
    const win = this.dueyWin && this.windows.order.includes(this.dueyWin) ? this.dueyWin : null;
    if (e.op === 'open') {
      if (win) { win.setList(e.list); return; }
      const w = new DueyWin(this.windows, e.list);
      await this.assets.preload(w.frames());
      this.dueyWin = this.windows.show(w, null);
    } else if (e.op === 'gone') win?.gone(e.id);
    else if (e.op === 'arrived') this.hud.message(e.from ? `A parcel from ${e.from} is waiting for you. Visit Duey to collect it.` : 'A parcel is waiting for you. Visit Duey to collect it.', '#ffe08a');
    else if (e.op === 'result') { const t = dueyResult(e.code); if (t) this.windows.notice(t); }
  }

  async openRock(slot, itemId) {
    if (this.windows.order.some((w) => w instanceof TeleportWin)) return;
    if (this.dead) { this.windows.notice("You can't do it while you're dead."); return; }
    if ((this.map?.info?.fieldLimit || 0) & 0x42) { this.windows.notice('You cannot teleport to this map.'); return; }
    const win = new TeleportWin(this.windows, Number(slot), itemId);
    await this.assets.preload(win.frames());
    this.windows.show(win);
  }
  /**
   * The Use-tab Teleport Rock (232xxxx), once a map is picked in its window: USE_TELEPORT_ROCK as an exclusive
   * request (200ms apart), with the Game/UseShopItem sound.
   */
  useTeleportRock(slot, itemId, mapId) {
    if (!this.canExclusive(200)) return;
    this.net.useTeleportRock(slot, itemId, mapId);
    this.lockExclusive();
    sfx.play('Game/UseShopItem');
  }
  /** A Chalkboard: write a note (up to 40 characters) and hold it up; not where stores open; click it to put it away. */
  async openChalkboard(slot, itemId) {
    if (!this.cashGate()) return;
    if (this.tradeOpen()) { this.hud.message('Not available', CHAT_COLOR.error); return; }
    if (Number(this.map?.info?.personalShop)) { this.windows.notice("You can't use it here in this map."); return; }
    const text = (await this.windows.askText('Enter a note.', '', { max: 40 }))?.trim();
    if (!text) return;
    if (await this.cursed(text)) { this.windows.notice('Cursing is not allowed.'); return; }
    this.cashSend(() => this.net?.useChalkboard(Number(slot), itemId, text));
  }
  closeChalkboard(say) { this.net?.closeChalkboard(); this.player.chalk = null; if (say) this.hud.message(say, CHAT_COLOR.error); }
  /** A weather item: not while weather is falling here or where the map forbids it; a message of up to 35 characters. */
  async useWeather(slot, id) {
    if (!this.cashGate()) return;
    if (this.weather.active || (this.map?.info?.fieldLimit || 0) & 0x4000) { this.windows.notice('The effect is taking place right now.\r\nPlease try it later.'); return; }
    if (!(await this.assets.json('Item/Cash/0512.img'))?.[pad(id, 8)]) return;
    const text = (await this.windows.askText('Please enter the attached message', '', { max: 35 }))?.trim();
    if (!text) return;
    if (await this.cursed(text)) { this.windows.notice('Cursing is not allowed.'); return; }
    this.sendCashItem(slot, id, (w) => w.string(text));
  }
  /** AP Reset: pick a stat to take a point from, one to give it to, confirm; not with a shop-type window open. */
  async useApReset(slot, id) {
    if (!this.cashGate()) return;
    if (this.tradeOpen()) { this.hud.message('Not available', CHAT_COLOR.error); return; }
    if (branchOf(this.stats?.job || 0) > 8) return;
    const from = await this.openStep(ApResetWin, false, null);
    if (!from) return;
    const to = await this.openStep(ApResetWin, true, from);
    if (!to || !(await this.openStep(ApConfirmWin, from, to))) return;
    this.sendCashItem(slot, id, (w) => w.int(to.flag).int(from.flag));
  }
  /** SP Reset: a skill of the item's advancement to take a point from, one to give it to, confirm (not as a beginner, or before that advancement). */
  async useSpReset(slot, id) {
    if (!this.cashGate()) return;
    if (this.tradeOpen()) { this.hud.message('Not available', CHAT_COLOR.error); return; }
    const job = this.stats?.job || 0, b = branchOf(job);
    if (b === 0 || b >= 9 || id % 10 > advancement(job)) return;
    const book = spBook(this.skills, id);
    if (book === null) return;
    await this.skills.book(book);
    const from = await this.openStep(SpResetWin, book, false, null, id % 10);
    if (!from) return;
    const to = await this.openStep(SpResetWin, book, true, from, id % 10);
    if (!to || !(await this.openStep(SpConfirmWin, from, to))) return;
    this.sendCashItem(slot, id, (w) => w.int(to).int(from));
  }
  /** Item Guard: seal an item dragged onto its window (for good, or for the guard's info/protectTime days). */
  async useItemGuard(slot, id) {
    if (!this.cashGate()) return;
    if (this.tradeOpen()) { this.hud.message('Not available', CHAT_COLOR.error); return; }
    const node = (await this.assets.json('Item/Cash/0506.img'))?.[pad(id, 8)];
    if (!node) return;
    const pick = await this.openStep(ItemGuardWin, id, Number(node.info?.protectTime) || 0);
    if (pick) this.sendCashItem(slot, id, (w) => w.int(pick.tab).int(pick.slot));
  }
  /** Item Tag (dragged onto something you wear: the server tags only worn items): print your name on it, once. */
  async useItemTag(slot, equipSlot) {
    const it = equipSlot < 0 ? this.inventory?.equipped?.[equipSlot] : null;
    if (!it) return;
    if (it.owner) { this.windows.notice('The item already has a printed name on it..'); return; }
    if (!(await this.windows.confirm(`Woulid like to print your name on ${this.windows.itemName(it.id) || ''}?`))) return;
    this.sendCashItem(slot, 5060000, (w) => w.short(equipSlot));
  }
  /** Miu Miu the Traveling Merchant: the server opens her shop (not on maps that forbid it, or with a shop-type window open). */
  useMiuMiu(slot, id) {
    if (!this.cashGate()) return;
    if ((this.map?.info?.fieldLimit || 0) & 0x40000) { this.hud.message("You can't use it here in this map.", CHAT_COLOR.error); return; }
    if (this.tradeOpen()) { this.hud.message('Not available', CHAT_COLOR.error); return; }
    this.sendCashItem(slot, id);
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
    if (!EMOTES[n - 1]) return;   // a ghost can make faces too
    const now = performance.now();
    if (now - (this.lastEmote || 0) < 2000) return;   // one every 2s
    this.lastEmote = now;
    setExpression(this.player, n);
    this.emotionEffect(this.player, n);
    this.net?.faceExpression(n);
  }
  /** A facial expression item (516xxxx) from its key or a double-click: expression 8 + the last two digits of its id. */
  useFaceItem(id) { if (this.itemCount(id) > 0) this.emote((id % 100) + 8); }
  /** Etc/EmotionEffect.img/<expression>: art some expressions show beside the face. */
  async emotionEffect(ent, n) {
    const node = (this.emotionFx ??= await this.assets.json('Etc/EmotionEffect.img'))?.[EMOTES[n - 1]];
    if (frames(node).length) this.pushEffect(node, ent);
  }

  /**
   * An Effect item (501xxxx, or 429xxxx in Etc) from its key or a double-click turns its effect on, or off when it is
   * the one already on; nothing within 2s of turning one on.
   */
  useItemEffect(id) {
    if (!this.itemCount(id)) return;
    const now = performance.now();
    if (now - (this.itemEffectT || 0) < 2000) return;
    if (this.player.itemFxId === id) id = 0; else this.itemEffectT = now;
    this.setItemEffect(this.player, id);
    this.net?.useItemEffect(id);
  }
  /**
   * The effect an Effect item puts on a character, from the item's effect node: one animation (default, or the one
   * named after the character's action when it has `action`), up to five trailing ones (`follow`), or fading copies
   * of the character (`spectrum`).
   */
  async setItemEffect(ent, id) {
    ent.itemFxId = id; ent.itemFx = null;
    if (!id) return;
    const img = await this.assets.json(Math.floor(id / 10000) === 429 ? 'Item/Etc/0429.img' : 'Item/Cash/0501.img');
    const node = img?.[pad(id, 8)]?.effect;
    if (node && ent.itemFxId === id) ent.itemFx = { node, layers: null, action: null };
  }
  itemFxLayers(e, action) {
    const layer = (n) => {
      const anim = new Anim(n);
      this.assets.preload(anim.frames);
      return { anim, z: Number(n.z) || 0, head: Number(n.pos) === 1 || Number(e.follow) === 1, fixed: !!Number(n.fixed), loose: Number(n.loose) || 0 };
    };
    if (Number(e.follow)) {
      const out = [];
      for (let i = 0; i < 5 && frames(e[i]).length; i++) out.push(layer(e[i]));
      return out;
    }
    let n = Number(e.action) ? e[action] : null;
    if (!frames(n).length) n = e.default;
    if (!frames(n).length && frames(e).length) n = e;
    return frames(n).length ? [layer(n)] : [];
  }
  stepItemFx(ent, dt) {
    const fx = ent.itemFx;
    if (!fx) return;
    if (!fx.layers || (Number(fx.node.action) && fx.action !== ent.action)) { fx.action = ent.action; fx.layers = this.itemFxLayers(fx.node, ent.action); }
    for (const l of fx.layers) l.anim.update(dt * 1000);
  }
  /**
   * A character's item effect behind it (z < 0, and the spectrum's copies) or in front. pos 1 (and the trailing
   * ones) hang from the head (the brow), the rest from the feet; a `loose` one lags behind by its loose %.
   */
  drawItemFx(ctx, cam, ent, parts, front, dx = 0, dy = 0) {
    const fx = ent.itemFx;
    if (!fx?.layers) return;
    const right = drawnRight(ent);
    const now = performance.now(), e = fx.node, dir = right ? -1 : 1, brow = parts.brow || [0, -55];
    if (!front && Number(e.spectrum)) {
      const life = Number(e.delay) || 1000, a = (e.alpha ?? 128) / 255;
      if (now - (fx.ghostT || 0) >= (Number(e.interval) || 100)) { fx.ghostT = now; (fx.ghosts ??= []).push({ parts, x: ent.x + dx, y: ent.y + dy, right, t: now }); }
      fx.ghosts = (fx.ghosts || []).filter((g) => now - g.t < life);
      for (const g of fx.ghosts) drawParts(ctx, this.assets, g.parts, g.x - cam.x, g.y - cam.y, g.right, a * (1 - (now - g.t) / life));
    }
    for (const l of fx.layers) {
      if ((l.z >= 0) !== front) continue;
      let x = ent.x + dx + (l.head ? brow[0] * dir : 0), y = ent.y + dy + (l.head ? brow[1] : 0);
      if (l.loose) {
        if (l.x === undefined || Math.hypot(x - l.x, y - l.y) > 600) { l.x = x; l.y = y; }
        const k = 1 - (l.loose / 100) ** (Math.min(100, now - (l.t || now)) / 16);
        l.t = now; l.x += (x - l.x) * k; l.y += (y - l.y) * k;
        x = l.x; y = l.y;
      }
      const node = l.anim.node, img = node && this.assets.image(node);
      if (!img) continue;
      const o = node.origin || [0, 0];
      ctx.save();
      ctx.globalAlpha = l.anim.alpha;
      ctx.translate(Math.round(x - cam.x), Math.round(y - cam.y));
      if (right && !l.fixed) ctx.scale(-1, 1);
      ctx.drawImage(img, -o[0], -o[1]);
      ctx.restore();
    }
  }

  /** Skill keys held down (repeat like the real client while held). */
  heldSkill() {
    for (const code of new Set([...this.input.held(), ...this.input.pressed])) {
      const k = this.bindingOf(code);
      if (k?.type === 1) { this.skillKeyPressed = this.input.hit(code); return k.action; }
    }
    return 0;
  }

  toggleMenu(m) {
    if (!this.hud) return;
    const chatKey = CHAT_KEYS[m];
    if (chatKey) { if (chatKey === 'toggle') this.statusBar?.toggleChat(); else this.statusBar?.openChat(chatKey); return; }
    if (m === MENU.ITEMS) this.windows.toggle('inventory');
    else if (m === MENU.EQUIP) this.windows.toggle('equip');
    else if (m === MENU.STATS) this.windows.toggle('stat');
    else if (m === MENU.SKILLS) this.toggleSkills();
    else if (m === MENU.QUESTS) this.toggleQuests();
    else if (m === MENU.MINIMAP) {
      // the window stays: the key cycles Max -> Min bar -> MinMap -> Max
      const w = this.windows.wins.minimap;
      if (!this.windows.order.includes(w)) this.windows.open('minimap', 'UI/MenuUp'); else w?.cycle();
    }
    else if (m === MENU.WORLDMAP) this.windows.toggle('worldmap');
    else if (m === MENU.KEYS) this.windows.toggle('keyconfig');
    else if (m === MENU.BUDDY) this.windows.toggle('userlist', 0);
    else if (m === MENU.PARTY) this.windows.toggle('userlist', 1);
    else if (m === MENU.GUILD) this.windows.toggle('userlist', 2);
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
    if (this.hidden() || this.dead) return;
    const t = Math.floor(id / 1000000);
    const slot = Object.entries(this.inventory?.[t] || {}).find(([, it]) => it.id === id)?.[0];
    if (slot && t === 2 && isPetFood(id)) this.feedPet(Number(slot), id);
    else if (slot && t === 5 && Math.floor(id / 10000) === 524) this.useCashPetFood(Number(slot), id);
    else if (slot && t === 2) this.useConsume(Number(slot), id);
    else if (slot && t === 3 && Math.floor(id / 10000) === 301) this.sitChair(id);
  }

  // ------------------------------------------------------------------ pets
  /** A pet comes out at its index: one there already is replaced, or pushed along with those after it. */
  addPet(d) {
    if (!this.petDialog) this.petDialog = this.assets.json('String/PetDialog.img').then((s) => { this.petDialog = s; return s; });
    this.petEff ??= this.assets.json('Effect/PetEff.img').then(async (n) => { this.petEff = n; if (n?.Basic) await this.assets.preload(allCanvases(n.Basic)); return n; });
    this.nameTagArt();
    const pet = new Pet(this, d), list = this.petsOf(d.owner);
    if (d.replace) list[d.slot] = pet; else list.splice(d.slot, 0, pet);
    this.setPets(d.owner, list);
    if (pet.mine) {
      const it = this.petItem(pet), ms = this.moveStats();
      if (it?.pet?.attribute & 1) { pet.speed = ms.speed; pet.jump = ms.jump; }   // keeps up with its owner
    }
  }
  /** A pet goes home: those after it move up. */
  removePet(owner, slot, reason = 0) {
    const list = this.petsOf(owner);
    if (!list[slot]) return;
    list.splice(slot, 1);
    this.setPets(owner, list);
    if (owner !== this.player.id) return;
    const msg = PET_GONE[reason];
    if (msg) this.hud.message(msg, CHAT_COLORS.notice);
  }
  petsOf(owner) { const a = []; for (const p of this.pets.values()) if (p.owner === owner) a[p.slot] = p; return a; }
  setPets(owner, list) {
    for (const [k, p] of this.pets) if (p.owner === owner) this.pets.delete(k);
    list.slice(0, 3).forEach((p, i) => { if (p) { p.slot = i; this.pets.set(p.key, p); } });
    if (owner !== this.player.id) return;
    // their places in the line: one pet stays on you; of two, the lead stays and the other runs ahead; of three, one ahead, one behind
    const mine = this.petsOf(owner).filter(Boolean), places = mine.length === 1 ? [0] : mine.length === 2 ? [1, 2] : [5, 3, 4];
    mine.forEach((p, i) => { p.formation = places[i] ?? 0; });
    this.petFlagCache = null;
  }
  myPets() { return this.petsOf(this.player.id).filter(Boolean); }
  /** The pet's own cash item (level, closeness, fullness...). */
  petItem(pet) { return Object.values(this.inventory?.[5] || {}).find((i) => i.pet && Number(BigInt.asIntN(32, BigInt(i.cashId ?? 0))) === pet.uid) || null; }
  petLevel(pet) { return this.petItem(pet)?.pet?.level || 1; }

  /** What a pet's equipment lets it do, from Character/PetEquip/<id>.img/info: its own slots and the shared potion pouches. */
  petFlags(pet) {
    if (!pet.mine) return {};
    const c = (this.petFlagCache ??= new Map());
    if (c.has(pet.slot)) return c.get(pet.slot);
    const f = {}, eq = this.inventory?.equipped || {}, s = PET_SLOTS[pet.slot];
    if (pet.mine && s) {
      let pending = false;
      for (const pos of [...s.ability, ...SHARED_PET_SLOTS]) {
        const it = eq[pos];
        if (!it) continue;
        const info = this.petEquipInfo(it.id);
        if (!info) { pending = true; continue; }
        for (const k of PET_FLAGS) if (Number(info[k])) f[k] = true;
      }
      if (pending) return f;
    }
    c.set(pet.slot, f);
    return f;
  }
  petEquipInfo(id) {
    const m = (this.petEquipInfos ??= new Map());
    if (!m.has(id)) { m.set(id, null); this.assets.json(`Character/PetEquip/${pad(id, 8)}.img`).then((n) => { m.set(id, n?.info || {}); this.petFlagCache = null; }); }
    return m.get(id);
  }
  petRing(pet, ring) { return pet.mine ? !!this.inventory?.equipped?.[PET_SLOTS[pet.slot]?.[ring]] : ring === 'label' ? pet.nameTagOn : pet.balloonOn; }

  /** Double-click a pet: send it home, or summon it (with Follow the Lead, asking whether it becomes the Boss Pet). */
  async summonPet(slot, it) {
    if (this.player.ladder) return;
    const n = await this.assets.json(`Item/Pet/${it.id}.img`), info = n?.info || {};
    const dead = Number(info.limitedLife) ? it.pet.life < 1 : BigInt(it.pet.dead ?? 0) >= PET_DOLL_TIME;
    if (dead) {
      if (!Number(info.noRevive)) { this.windows.notice("The time has run out, so it can't move."); return; }
      if (await this.windows.confirm('You cannot revive this pet.\r\nYou can purchase a new pet\r\nin the Cash Shop. Would you like\r\nto move to the Cash Shop?')) this.enterCashShop?.();
      return;
    }
    const mine = this.myPets(), out = mine.some((p) => Number(BigInt.asIntN(32, BigInt(it.cashId ?? 0))) === p.uid);
    const follow = this.skills?.level(FOLLOW_THE_LEAD[Math.floor((this.stats?.job || 0) / 1000)] ?? 8) > 0;
    let lead = false;
    if (!out && follow && mine.length) {
      if (mine.length >= 3) { this.windows.notice('You have exceeded the maximum number\r\n of pets that can accompany you.\r\nPlease try again after \r\nyou change the living pet back into a doll.'); return; }
      lead = await this.windows.confirm('Would you like to change your Boss Pet?\r\n (The "Item Ignore" skill, as well as \r\nthe stats for speed and jump will \r\nfollow that of the Lead Pet)');
    }
    this.net.spawnPet(slot, lead);
  }

  // ------------------------------------------------------------------ cash items
  /**
   * Cash items wait for the server to answer the last request (or 5s, should no answer come), and 500ms between
   * requests.
   */
  cashFree() {
    const since = performance.now() - (this.cashAt || -1e9);
    return !(this.cashBusy && since < 5000) && since >= 500 && (this.stats?.hp ?? 1) > 0;
  }
  /** cashFree, saying so when it isn't. */
  cashGate() {
    if (this.cashFree()) return true;
    this.windows.notice('Other requests are in process.\r\nPlease try again in a little bit.');
    return false;
  }
  /** Opens a step window (one taking `done` last) once its art is in; resolves with what it answers. */
  openStep(W, ...a) { return new Promise((r) => { const w = new W(this.windows, ...a, r); this.assets.preload(w.frames()).then(() => this.windows.show(w)); }); }
  /** A cash item's request (gated: a refusal says so), then the busy flag until the server answers, and its sound. */
  cashSend(send) {
    if (!this.cashGate()) return false;
    send();
    this.cashBusy = true; this.cashAt = performance.now();
    sfx.play('Game/UseShopItem');
    return true;
  }
  sendCashItem(slot, id, add) { return this.cashSend(() => this.net.useCashItem(slot, id, add)); }
  /** Your avatar look as the server sends others': what shows in each slot, what's hidden under cash, the cash weapon, your pets. */
  myLookData() {
    const s = this.stats || {}, eq = this.inventory?.equipped || {}, equips = {}, masked = {};
    for (const [k, it] of Object.entries(eq)) {
      const n = -Number(k);
      if (n > 0 && n < 100) { if (eq[-(n + 100)]) masked[n] = it.id; else equips[n] ??= it.id; }
      else if (n > 100 && n !== 111) { equips[n - 100] = it.id; }
    }
    return { gender: s.gender ?? 0, skin: s.skin ?? 0, face: s.face, hair: s.hair, mega: false, equips, masked, cashWeapon: eq[-111]?.id || 0,
      pets: this.petsOf(this.player.id).map((p) => p?.id || 0) };
  }
  /** Cash pet food (524xxxx): the lead pet must be out; the server picks the pet that eats it. */
  useCashPetFood(slot, id) {
    if (!this.cashFree()) return;
    if (!this.petsOf(this.player.id)[0]) { this.hud.message('This item can only be used with a pet.', '#ffafaf'); return; }
    this.sendCashItem(slot, id);
  }
  /**
   * The Pet Name Tag renames the lead pet (none out: nothing): asked first if it has a name of its own; 4-12
   * characters, trimmed, tabs made spaces, curse words masked; not its default name (any case) or the name it has.
   */
  async useNameTag(slot, id) {
    if (!this.cashFree()) return;
    const pet = this.petsOf(this.player.id)[0], it = pet && this.petItem(pet);
    if (!it) return;
    const def = this.windows.itemName(it.id) || '', cur = it.pet?.name || '';
    if (cur.toLowerCase() !== def.toLowerCase() && !(await this.windows.confirm('The pet already has a name.\r\nWill you change it?'))) return;
    let name = await this.windows.askText('Please name your pet.', '', { max: 12, minLen: 4 });
    name = (name || '').trim();
    if (!name) return;
    if (/[\x00-\x09\x0b\x0c\x0e-\x1f]/.test(name.replace(/\t/g, ''))) { this.windows.notice('Cursing is not allowed.'); return; }
    name = (await this.maskCurses(name)).replace(/\t/g, ' ');
    if (name.toLowerCase() === def.toLowerCase() || name === cur) { this.windows.notice('That name is not available.'); return; }
    if (!(await this.windows.confirm(`Do you want to name your pet\r\n'${name}'?`))) return;
    this.sendCashItem(slot, id, (w) => w.string(name));
  }
  /** Words from Etc/Curse.img in a line, ignoring case, replaced with '*'. */
  async maskCurses(text) {
    this.curses ??= await this.assets.json('Etc/Curse.img').then((l) => Object.values(l || {}).filter((w) => typeof w === 'string' && w).map((w) => w.toLowerCase()));
    let out = text;
    for (const w of this.curses) {
      for (let i = out.toLowerCase().indexOf(w); i >= 0; i = out.toLowerCase().indexOf(w, i + w.length)) out = out.slice(0, i) + '*'.repeat(w.length) + out.slice(i + w.length);
    }
    return out;
  }

  /** Pet food: the server feeds the hungriest; it is the one heard eating. */
  feedPet(slot, id) {
    this.net.petFood(slot, id);
    let pet = null;
    for (const p of this.myPets()) if (!pet || (this.petItem(p)?.pet?.fullness ?? 100) < (this.petItem(pet)?.pet?.fullness ?? 100)) pet = p;
    if (pet) sfx.play(`Pet/${pet.id}/eat`);
  }

  /**
   * A chat line said to your pets: each one standing still (and not busy) checks it, after its name if it has been
   * named, against the command words of its level; a match asks the server how it went.
   */
  petCommandWord(text) {
    if (typeof this.petDialog !== 'object' || !this.petDialog || this.dead) return;
    for (const pet of this.myPets()) {
      if (pet.forced || pet.cmdWaiting || pet.idleMs <= 499 || !pet.data) continue;
      let line = text.trim(), called = false;
      const def = this.windows.itemName(pet.id);
      if (def && pet.name !== def && line.length > pet.name.length && line.startsWith(pet.name)) {
        line = line.slice(pet.name.length).trim();
        while (/^[!,~]/.test(line)) line = line.slice(1).trim();
        called = true;
      }
      const lv = this.petLevel(pet), words = this.petDialog[pet.id] || {};
      for (const [n, c] of Object.entries(pet.data.interact || {})) {
        if (lv < (c.l0 ?? 1) || lv > (c.l1 ?? 30)) continue;
        if (String(words[c.command] || '').split('|').map((w) => w.trim()).includes(line)) { this.net.petCommand(pet.sn, called, Number(n)); pet.cmdWaiting = true; break; }
      }
    }
  }
  /** PET_COMMAND: how your command (0) or food (1) went; your pet answers and everyone sees it through PET_CHAT. */
  onPetCommand(owner, slot, type, cmd, ok, balloon) {
    const pet = this.pets.get(`${owner}:${slot}`);
    if (!pet?.mine || !pet.data) return;
    const lv = this.petLevel(pet);
    let entry;
    if (type === 0) { pet.cmdWaiting = false; entry = pet.data.interact?.[cmd]; if (!entry || lv < entry.l0 || lv > entry.l1) return; }
    else entry = Object.values(pet.data.food || {}).find((f) => lv >= f.l0 && lv <= f.l1);
    const { act, text } = pickReaction(entry?.[ok ? 'success' : 'fail'], this.petDialog, pet.id);
    this.petSay(pet, type, act ? pet.actionIndex(act) : -1, text, balloon || this.petRing(pet, 'quote'));
  }
  /** Your pet does something and says it, for everyone (idle chatter, type 3, stays yours). */
  petSay(pet, type, action, text, balloon = this.petRing(pet, 'quote')) {
    pet.react(type, action, text, balloon);
    if (pet.mine && type !== 3 && this.net) this.net.petChat(pet.sn, type, action >= 9 ? action : 0, text);
  }
  /** /pet <text>: pets that know slang answer it (level 15 on); the others repeat it (over level 14). */
  petTalk(text) {
    if (typeof this.petDialog !== 'object' || !this.petDialog) return;
    for (const pet of this.myPets()) {
      const lv = this.petLevel(pet);
      if (!pet.data || lv < 15) continue;
      if (pet.data.slang) {
        if (pet.forced) continue;
        const e = Object.values(pet.data.slang).find((s) => s && lv >= s.l0 && lv <= s.l1);
        const { act, text: line } = pickReaction(e ? { 0: e } : null, this.petDialog, pet.id);
        if (act || line) this.petSay(pet, 2, act ? pet.actionIndex(act) : -1, line);
      } else this.petSay(pet, 2, -1, text);
    }
  }
  /** Standing about: an idle line from randAction (whatever its level). */
  petIdleChat(pet) {
    const list = Object.values(pet.data?.randAction || {}).filter((e) => e && typeof e === 'object');
    if (!list.length) return;
    const { act, text } = pickReaction({ 0: list[Math.floor(Math.random() * list.length)] }, this.petDialog, pet.id);
    this.petSay(pet, 3, act ? pet.actionIndex(act) : -1, text);
  }
  petMonolog(pet) {
    const lines = Object.values(this.petDialog?.[pet.id]?.autoSpekaing || {}).filter((t) => typeof t === 'string');
    if (lines.length) pet.react(3, -1, lines[Math.floor(Math.random() * lines.length)]);
  }
  /** Things your pets remark on (with the auto-speech skill): your level up, nearly levelling, resting, potions. */
  petEvent(key) {
    for (const pet of this.myPets()) {
      if (!((this.petItem(pet)?.pet?.skill || 0) & 0x100)) continue;
      const text = this.petDialog?.[pet.id]?.[key];
      if (typeof text === 'string' && text) pet.react(3, -1, text);
    }
  }
  /** autoReact pets: when you attack, now and then they get cross. */
  petAttackReact() {
    for (const pet of this.myPets()) if (Number(pet.info.autoReact) && Math.random() * 10 < 2) pet.react(3, pet.actionIndex('angry_short'), '');
  }
  /** Effect/PetEff.img: 0 level up, 1 teleport, 2 its own warp (where it was), 3 evolution. */
  async petEffect(pet, kind, at = null) {
    const E = this.petEff instanceof Promise ? await this.petEff : this.petEff;
    const node = kind === 2 ? E?.[pad(pet.id, 7)]?.warp : E?.Basic?.[['LevelUp', 'Teleport', null, 'Evolution'][kind]];
    if (!node) return;
    const anim = new Anim(node, false);
    await this.assets.preload(anim.frames);
    if (at) this.fx.push({ anim, x: at.x, y: at.y, flip: !pet.facingLeft });
    else this.fx.push({ anim, follow: pet, flip: false });
    if (kind === 0 || kind === 3) sfx.play('Game/LevelUp');
  }
  /** The name under a pet: a Label Ring gives it NameTag.img/pet/<its nameTag> instead of the plain tag. */
  drawPetName(ctx, pet, x, y) {
    const N = this.petRing(pet, 'label') && !(this.nameTags instanceof Promise) && this.nameTags?.pet?.[pet.info.nameTag];
    const w = N && this.assets.image(N.w), c = N && this.assets.image(N.c), e = N && this.assets.image(N.e);
    if (!w || !c || !e) { nameTag(ctx, pet.name, x, y + 2, '#fff'); return; }
    ctx.save();
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    const tw = Math.ceil(ctx.measureText(pet.name).width), x0 = Math.round(x - tw / 2), top = y + 2 + 5;
    ctx.drawImage(w, x0 - (N.w.origin?.[0] ?? w.width), top - (N.w.origin?.[1] ?? 0));
    ctx.drawImage(c, x0, top - (N.c.origin?.[1] ?? 0), tw, c.height);
    ctx.drawImage(e, x0 + tw - (N.e.origin?.[0] ?? 0), top - (N.e.origin?.[1] ?? 0));
    ctx.fillStyle = `#${((N.clr >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(pet.name, x0, top - 3);
    ctx.restore();
  }
  /** Its accessory, from Character/PetEquip/<id>.img/<pet id>/<action>/<frame>, over the pet's frame. */
  drawPetEquip(ctx, pet, x, y, o, node) {
    const id = pet.mine ? this.inventory?.equipped?.[PET_SLOTS[pet.slot]?.acc]?.id : this.others.get(pet.owner)?.lookData?.equips?.[[14, 30, 38][pet.slot]];
    if (!id || pet.drawAct() === 'basket') return;
    const m = (this.petEquipArt ??= new Map()), k = `${id}`;
    if (!m.has(k)) { m.set(k, null); this.assets.json(`Character/PetEquip/${pad(id, 8)}.img`).then(async (n) => { if (n) await this.assets.preload(allCanvases(n)); m.set(k, n); }); }
    const fr = frames(m.get(k)?.[pet.id]?.[pet.drawAct()]), f = fr[pet.frame];
    const img = f && this.assets.image(f);
    if (!img) return;
    const eo = f.origin || [0, 0];
    ctx.save();
    if (!pet.facingLeft && pet.act !== 'hang') { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(img, -eo[0], -eo[1]); }
    else ctx.drawImage(img, x - eo[0], y - eo[1]);
    ctx.restore();
  }

  /**
   * Pet looting, every 30ms step: each pet takes the first drop in its reach (25px either side, 50 up, 10 down) that
   * its pouch / magnet lets it, that is its owner's (or anyone's after 15s with Magic Scales), has landed, isn't
   * ignored and wasn't tried in the last 3s. With Wing Boots it also walks toward drops near you.
   */
  petLootStep(dt) {
    if ((this.petLootAcc = (this.petLootAcc || 0) + dt * 1000) < TICK) return;
    this.petLootAcc %= TICK;
    const mine = this.myPets();
    if (!mine.length || this.dead || this.map?.id === NO_LOOT_MAP) { for (const p of mine) p.lootDir = 0; return; }
    const now = performance.now();
    const can = (pet, d, f) => {
      if (d.pickedBy || !d.landed || d.petOk === false) return false;
      if (d.meso ? !f.pickupMeso : (!f.pickupItem && !(f.sweep && f.pickupOthers)) || Number(this.windows.info(d.id)?.pickUpBlock)) return false;
      const me = this.player.id;
      const ours = (f.pickupOthers && now - (d.born || 0) > 15000) || !d.dropper || (d.type === 0 && d.owner === me) || (d.type === 1 && d.owner === this.party?.id) || d.type >= 2;
      return ours && now - (d.petTry || -Infinity) >= 3000 && !this.petIgnores(d);
    };
    for (const pet of mine) {
      const f = this.petFlags(pet);
      if (pet.lootPauseAt && now - pet.lootPauseAt >= 500) continue;
      for (const d of this.drops.values()) {
        if (!can(pet, d, f)) continue;
        if (!(d.x >= pet.x - 25 && d.x < pet.x + 25 && d.y >= pet.y - 50 && d.y < pet.y + 10)) continue;
        d.petTry = now;
        this.net.petLoot(pet.sn, Math.round(pet.x), Math.round(pet.y), d.oid, f);
        break;
      }
    }
    // Wing Boots: each drop near you goes to the nearest sweeping pet without one
    const sweepers = mine.filter((p) => this.petFlags(p).sweepForDrop);
    for (const p of sweepers) p.lootDir = 0;
    if (!sweepers.length) return;
    const p = this.player;
    for (const d of this.drops.values()) {
      let best = null;
      for (const pet of sweepers) {
        const f = this.petFlags(pet), reach = f.longRange ? 275 : 125;
        if (pet.lootDir || Math.abs(d.x - p.x) >= reach || !(d.y > pet.y - 50 && d.y < pet.y + 10)) continue;
        if (!can(pet, d, { ...f, sweep: true })) continue;
        if (!best || Math.abs(d.x - pet.x) < Math.abs(d.x - best.x)) best = pet;
      }
      if (best) best.lootDir = d.x <= best.x ? -1 : 1;
    }
  }
  /** The ignore list counts while the lead pet wears an Item Ignore Pendant: anything on any pendant-wearing pet's list. */
  petIgnores(d) {
    const mine = this.myPets();
    if (!mine[0] || mine[0].slot !== 0 || !this.petFlags(mine[0]).ignorePickup) return false;
    const id = d.meso ? MESO_ID : d.id;
    return mine.some((pet) => this.petFlags(pet).ignorePickup && (this.petExcluded?.get(pet.uid) || []).includes(id));
  }

  /**
   * A monster's blow is what sets the pet's potions off: HP is checked against what the blow will take from it, and a
   * blow that also went elsewhere (Magic Guard's share to MP, Power Guard's reflected share) starts the MP checks,
   * which then run on every stat update until an MP potion goes. Spending HP / MP on skills sets off nothing.
   */
  petHitPots(m, damage, from) {
    const now = Date.now(), on = (ids) => ids.find((id) => this.buffs?.some((b) => b.source === id && b.until > now));
    let hp = damage, flag = 0;
    const pg = from === -1 && damage > 0 && on(POWER_GUARDS);
    if (pg) {
      let back = Math.min(Math.trunc((damage * (this.skills.levelData(pg)?.x || 0)) / 100), Math.trunc((m.maxHp || Infinity) / 10));
      if (m.src?.info?.boss) back = Math.trunc(back / 2);
      if (back > 0) { hp -= back; flag = 1; }
    }
    const mg = damage > 0 && on(MAGIC_GUARDS);
    if (mg) {
      const mp = Math.min(Math.trunc((damage * (this.skills.levelData(mg)?.x || 0)) / 100), this.stats?.mp || 0);
      if (mp > 0) { hp -= mp; flag ||= 4; }
    }
    this.petAutoPot('hp', Math.max(0, hp), flag);
    if (flag) { this.petMpArmed = true; this.petAutoPot('mp'); }
  }
  /**
   * Auto HP / MP Potion Pouch: the lead pet drinks the set potion when HP (MP) is under your alert setting (HP counting
   * the blow just taken), at most every 200ms. Without one left it says so.
   */
  petAutoPot(kind, pending = 0, flag = 0) {
    if (kind === 'mp' && !this.petMpArmed) return;
    const lead = this.myPets()[0], s = this.stats;
    if (!lead || lead.slot !== 0 || !this.net || this.dead || !s || s.hp <= 0) return;
    if (!this.petFlags(lead)[kind === 'hp' ? 'consumeHP' : 'consumeMP']) return;
    const max = kind === 'hp' ? this.maxHpShown() : this.maxMpShown(), alert = settings[`${kind}Alert`];
    if (!alert || !max || ((kind === 'hp' ? s.hp - pending : s.mp) * 100) / max >= alert * 100) return;
    const id = this.petPotions?.[kind];
    if (!id || (this.map?.info?.fieldLimit || 0) & 0x400) return;
    const slot = Object.entries(this.inventory?.[2] || {}).find(([, it]) => it.id === id)?.[0];
    const said = (this.petPotSaid ??= { hp: 0, mp: 0 });
    if (!slot) {
      this.notice(`You are lacking the ${kind === 'hp' ? 'HP' : 'MP'} Potion that your pet is supposed to use.`);
      if (said[kind] < 3) { said[kind]++; this.petEvent(kind === 'hp' ? 'e_NOHPPotion' : 'e_NOMPPotion'); }
      return;
    }
    const t = (this.petPotT ??= { hp: 0, mp: 0 }), now = performance.now();
    if (now - t[kind] < 200) return;
    t[kind] = now;
    this.net.petAutoPot(lead.sn, Number(slot), id, flag);
    sfx.play(`Item/${pad(id, 8)}/Use`);
    if (kind === 'mp') this.petMpArmed = false;
  }
  /** Set the potion a pet drinks (dropped on PET HP / PET MP): the lead pet needs the pouch, the potion must restore it. */
  async setPetPotion(kind, id) {
    const lead = this.myPets()[0];
    if (!lead || !this.petFlags(lead)[kind === 'hp' ? 'consumeHP' : 'consumeMP']) return false;
    const spec = await itemSpec(this.assets, id);
    const ok = kind === 'hp' ? Number(spec?.hp) || Number(spec?.hpR) : Number(spec?.mp) || Number(spec?.mpR);
    if (!ok) { this.windows.notice(`Only usable on Auto ${kind === 'hp' ? 'HP' : 'MP'} Potion Pouch.`); return false; }
    this.net.petPotion(kind === 'hp' ? 1 : 2, id);
    (this.petPotions ??= {})[kind] = id;
    this.hud.message(`Your pet will consume the Potion once when your ${kind === 'hp' ? 'HP' : 'MP'} goes below ${kind === 'hp' ? 'HP' : 'MP'} alert setting.`, CHAT_COLORS.notice);
    return true;
  }
  /** Standing about for 10 minutes (then every 2), your pets remark on it. */
  petRestCheck(dt) {
    const p = this.player, m = this.map?.id || 0, still = this.restAt && Math.abs(p.x - this.restAt.x) < 1 && Math.abs(p.y - this.restAt.y) < 1;
    if (!still) { this.restAt = { x: p.x, y: p.y }; this.restMs = 0; this.restNext = 600000; return; }
    if ((this.restMs += dt * 1000) < this.restNext) return;
    this.restNext += 120000;
    if (m < 910000000 || m > 910000022) this.petEvent('e_rest');
  }
  /** Change a pet's ignore list (at most 10, mesos as 2147483647) and tell the server. */
  setPetExcluded(pet, ids) {
    const list = [...new Set(ids)].slice(0, 10);
    (this.petExcluded ??= new Map()).set(pet.uid, list);
    this.net?.petExcludeItems(pet.sn, list);
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
    // on a mount: the mount's speed / jump (TamingMob/<n>.img/info, at least 80)
    // plus the incSpeed / incJump of the two mount-slot items (the mount and its saddle), plus the buffs' speed / jump
    // only on the skill mounts 1932001-1932005 and 1932007-1932011; then at most 190 / 123. Your other
    // equipment doesn't count.
    const ride = this.riding && this.mountData(this.riding.item)?.stats;
    if (ride) {
      const worn = this.inventory?.equipped || {}, inc = (k) => [-18, -19].reduce((t, s) => t + (Number(this.windows?.info?.(worn[s]?.id)?.[k]) || 0), 0);
      const skillMount = isSkillVehicle(this.riding.item);
      const speed = inc('incSpeed') + (skillMount ? buff('speed') : 0) + Math.max(80, Number(ride.speed) || 100);
      const jump = inc('incJump') + (skillMount ? buff('jump') : 0) + Math.max(80, Number(ride.jump) || 100);
      return { speed: Math.min(190, speed) / 100, jump: Math.min(123, jump) / 100 };
    }
    const pct = (k, max) => Math.max(80, Math.min(max, 100 + this.equipStat(k) + buff(k))) / 100;
    const slow = (this.diseases || []).find((d) => d.skill === SLOW);   // Slow: down to its x%
    return { speed: slow ? Math.min(pct('speed', 140), (slow.x || 80) / 100) : pct('speed', 140), jump: pct('jump', 123) };
  }

  // ------------------------------------------------------------------ online wiring
  /** Hook a ChannelSession's events to this game. `entered` is the result of session.enter(). */
  async goOnline(entered, uiRoot) {
    const info = entered.info;
    this.stats = info.stats; this.inventory = info.inventory; this.meso = info.meso; this.rings = info.rings; this.linked = info.linked;
    this.buddyCapacity = info.buddyCapacity;
    this.player.name = info.stats.name; this.player.id = info.stats.id;
    this.quickKeys2 = loadQuickKeys2(info.stats.name);
    this.statusBar = new StatusBar(this, uiRoot);
    this.touch = new TouchControls(this, uiRoot);
    this.statusBar.layout(UI_W, UI_H);
    await this.statusBar.load();
    this.windows = new WindowManager(this, this.statusBar);
    await this.windows.load();
    this.vfx = new WorldFx(this);
    await this.vfx.load();
    const wm = this.windows;
    wm.drawItemTip = drawItemTip; wm.drawSkillTip = drawSkillTip;
    wm.notice = (text) => new Promise((r) => wm.show(new UtilBox(wm, 'ok', text, r)));
    wm.serverNotice = wm.notice;   // the server's pop-up is the same box
    wm.confirm = (text) => new Promise((r) => wm.show(new UtilBox(wm, 'okcancel', text, r)));
    wm.okCancel = (text, kind = 'okcancel') => new Promise((r) => wm.show(new UtilBox(wm, kind, text, r)));
    wm.askWhisper = (def, names) => new Promise((r) => wm.show(new UtilBox(wm, 'whisper', 'Please enter the person you want to whisper to.', r, { def, names }), null));
    wm.selectPet = (text, pets) => new Promise((r) => { const b = new PetSelectDialog(wm, text, pets, r); this.assets.preload(b.frames()).then(() => wm.show(b)); });
    // an amount: the same box with a number field (item names spelled out)
    wm.askNumber = (text, def, min, max) => new Promise((r) => wm.show(new UtilBox(wm, 'quantity', text.replace(/#t(\d+)#/g, (_, id) => wm.itemName(Number(id)) || ''), r, { def, min, max }), null));
    // a name or a line: the small UtilDlg box with a white field, opened without a sound
    wm.askText = (text, def, opts = {}) => new Promise((r) => wm.show(new UtilBox(wm, 'text', text.replace(/\r\n/g, '\n'), r, { def, ...opts }), null));
    Object.assign(wm.wins, { channel: new ChannelWin(wm), gameopt: new GameOptWin(wm), sysopt: new SysOptWin(wm), userlist: new UserListWin(wm), partyhp: new PartyHpWin(wm), worldmap: new WorldMapWin(wm), questalarm: new QuestAlarmWin(wm), monsterbook: new MonsterBookWin(wm), messenger: new MessengerWin(wm), partysearch: new PartySearchWin(wm), family: new FamilyWin(wm), familytree: new FamilyTreeWin(wm) });
    await this.assets.preload(['channel', 'gameopt', 'sysopt', 'userlist', 'partyhp', 'worldmap', 'questalarm', 'monsterbook'].flatMap((k) => wm.wins[k].frames()));
    this.buddies = []; this.party = null; this.guild = null;
    this.assets.json('UI/GuildMark.img').then((m) => { this.guildMarks = m; });
    this.windows.order.push(this.windows.wins.minimap); // the minimap starts open, under every window
    this.windows.fit(this.windows.wins.minimap);
    this.bindUiPointer();
    this.hud = new Hud(uiRoot, this);
    this.hud.update(this.stats);
    this.quests = new QuestBook(this.assets);
    this.questMsg = new QuestMessages(); this.questTimers = new Map();
    await this.quests.load();
    this.quests.setState(info.quests);
    this.quests.ex = { ...info.questEx };
    this.questLayerTags();
    if (wm.wins.questalarm.state.opened) wm.open('questalarm');   // and the Quest Helper, unless it was closed
    this.questAlert = new QuestAlert(this);
    this.assets.preload(allCanvases(this.vfx.E?.QuestAlert));
    this.monsterBook = info.book || { cover: 0, cards: {} };
    if (this.net) this.net.selfName = info.stats?.name;   // the merchant room tells owner from visitor by name
    this.skills = new SkillBook(this.assets);
    await this.skills.load(info.stats.job, info.skills, info.cooldowns);
    this.windows.wins.quest?.markAllSeen();   // the quest log's NEW marks are for quests that open up from now on
    this.standardPdd(0, 1);   // load the standard defence table before the first blow
    this.rocks = { regular: (info.rocks || []).slice(0, 5), vip: (info.rocks || []).slice(5, 15) };   // Teleport Rock maps
    this.keyBar = this.statusBar; // the quick slots (render() rebuilds them from the keymap)
    const later = (fn) => (...a) => (this.loading ? this.queue.push(() => fn(...a)) : fn(...a));
    const h = this.net.h;
    Object.assign(h, {
      cashShopOpen: (d) => this.openCashShop(d),
      csCash: (c) => this.csWin?.setCash(c),
      csInventory: (items, storageSlots) => this.csWin?.setInventory(items, storageSlots),
      csWish: (sns, reply) => this.csWin?.setWish(sns, reply),
      csBought: (it) => this.csWin?.bought(it),
      csBoughtPackage: (items, bonus) => this.csWin?.boughtPackage(items, bonus),
      csCoupon: (c) => this.csWin?.coupon(c),
      csMesoBought: (got) => this.csWin?.mesoBought(got),
      csRing: (r) => this.csWin?.ring(r),
      csExpired: (cashId) => this.csWin?.expired(cashId),
      csStock: (sn, left) => this.csWin?.setStock(sn, left),
      csGifts: (gifts) => this.csWin?.receivedGifts(gifts),
      csGiftSent: (g) => this.csWin?.giftSent(g),
      notes: (notes) => this.showNotes(notes),
      csTaken: (pos, it) => this.csWin?.taken(pos, it),
      csPut: (it) => this.csWin?.put(it),
      csError: (reason, op, sn) => this.csWin?.error(reason, op, sn),
      csSlots: (kind, slots, type) => this.csWin?.slots(kind, slots, type),
      csNameChangeRules: (error, x) => this.csWin?.nameChangeRules(error, x),
      csNameChecked: (name, taken) => this.csWin?.nameChecked(name, taken),
      csWorldTransferRules: (error, x, worlds) => this.csWin?.worldTransferRules(error, x, worlds),
      csTransferBought: (kind, item) => this.csWin?.transferBought(kind, item),
      setField: (f) => {
        if (f.hp !== undefined && this.stats) this.stats.hp = f.hp;
        this.changeMap(f.mapId, { portalIdx: f.portal, pos: f.pos });
      },
      stats: (s, enable) => this.onStats(s, enable),
      pickupAnswered: () => this.pickupAnswered(),
      gmHide: (on) => { this.gmHidden = on; },
      // ADMIN_RESULT 0x1C / 0x1B and MINIMAP_ON_OFF: off until the next map, check again, or the on/off flag
      minimap: (v) => { if (v === 'off') this.minimapOff = this.map; else if (v === 'check') this.minimapOff = null; else this.minimapFlag = v; },
      yellowTip: (again, a, b) => {
        if (this.yellowTipShown && !again) return;
        if (a) { for (const t of [a, b]) if (t) this.hud.message(t, '#ffff00'); this.yellowTipShown = true; }
      },
      status: (s) => this.hud.status(s),
      notice: (n) => this.hud.notice(n),
      fame: (f) => this.onFame(f),
      exclusiveAnswered: () => this.releaseExclusive(),
      skillBookResult: (d) => this.onSkillBookResult(d),
      inventoryGrow: (type, limit) => { if (this.inventory) this.inventory.limits[type] = limit; },
      sortResult: (inv, mode) => this.windows?.wins.inventory?.setSortMode(inv, mode),
      avatarMega: (a) => { this.hud.megaphone([`${a.name} : ${a.lines.join('')}`], { ...CHAT_BAR.avatarMega, channel: a.channel, ear: a.ear }); this.avatarBanner.show(a); },
      avatarMegaClear: () => this.avatarBanner.clear(),
      tv: (d) => { this.tvWait = d.seconds; this.mapleTV.show(d); },
      tvOff: () => { this.tvWait = 0; this.mapleTV.clear(); },
      tvError: (code) => { const t = TV_ERRORS[code]; if (t) this.hud.message(t, CHAT_COLOR.error); },
      tvResult: (text) => { this.cashBusy = false; if (text) this.windows.notice(text); },
      avatarMegaResult: (text) => { this.cashBusy = false; if (text) this.windows.notice(text); },
      spouseChat: (from, text) => this.hud.message(`${from ? `${from} : ` : ''}${text}`, CHAT_COLORS.spouse),
      groupChat: (c) => {
        if (!this.chatAllowed(c.mode) || (c.mode === 0 && this.windows.wins.userlist?.blockedName(c.name))) return;
        this.hud.message(`${c.name} : ${c.text}`, CHAT_COLORS[GROUP_KEYS[c.mode]] || '#fff');
      },
      whisper: (w) => this.onWhisper(w),
      whisperResult: (r) => this.onWhisperResult(r),
      findResult: (f) => this.onFindResult(f),
      buddies: (list) => { this.buddies = list; },
      // a buddy coming online gets its balloon (a guildmate's comes from the guild); one moving onto your channel gets the same-channel one
      buddyChannel: (id, ch) => {
        const b = this.buddies.find((x) => x.id === id);
        if (!b) return;
        const was = b.channel; b.channel = ch;
        if (was < 0 && ch >= 0) { if (!this.guild?.members.some((m) => m.id === id)) notifyLogin(this.windows, b.name); }
        else if (was !== ch && ch === this.channel) notifyLogin(this.windows, b.name, true);
      },
      buddyCapacity: (n) => { this.buddyCapacity = n; },
      buddyMessage: (code) => { const t = BUDDY_MESSAGES[code]; if (t) this.windows.notice(t); },
      buddyRequest: (b) => notify(this.windows, 'buddy', b.name)
        .then((ok) => (ok ? this.net.buddyAccept(b.id) : this.net.buddyDelete(b.id))),
      party: (p) => this.onParty(p),
      guild: (d) => this.onGuild(d),
      // other players' guild tags: held for one still spawning
      guildName: later((id, name) => this.onOther(id, (o) => { o.guild = name; if (!name) o.emblem = null; })),
      guildMark: later((id, emblem) => this.onOther(id, (o) => { o.emblem = emblem; })),
      notifyLevel: (n) => this.hud.message(`<${n.type === 2 ? 'Guild' : 'Family'}> ${n.name} has reached Lv. ${n.level}.`, CHAT_COLOR.error),
      tradeOpen: (t) => {
        if (this.tradeWin) return;
        const w = this.tradeWin = this.windows.show(new TradeWin(this.windows), null);
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
        this.playerShop = this.windows.show(win, null);
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
      rockError: (code) => {
        const name = this.rockTarget || ''; this.rockTarget = '';
        const t = { 5: 'You cannot go to that place.', 8: 'You cannot go to that place.', 9: "It's the map you're currently on.", 10: 'This map is not available to enter for the list.',
          11: 'Users below level 7 are not allowed \r\nto go out from Maple Island.' }[code]
          ?? (code === 6 || code === 7 ? `${name} is currently difficult to locate, so\r\nthe teleport will not take place.` : null);
        if (t) this.windows.notice(t);
      },
      charBox: later((id, box) => { const ent = id === this.player.id ? this.player : this.others.get(id); if (ent) ent.box = box; }),
      tradeError: (code) => { this.tradeWin?.ended(0); this.windows.notice(TRADE_ERRORS[code] || 'The trade could not be started.'); },
      charInfo: (i) => { if (this.infoWin) this.windows.close(this.infoWin); this.infoWin = this.windows.show(new CharInfoWin(this.windows, i), null); },
      // a Party Search invitation comes as "PS: <leader>"
      // refused at once with party invites switched off, from someone on the Blacklist, or while another is up;
      // an auto-join one (Party Search) joins straight away
      partyInvite: (p) => {
        const from = p.name.startsWith('PS: ') ? p.name.slice(4) : p.name;
        if (p.autoJoin) { this.net.partyOp(3, p.id); return; }
        if (!this.optionAllowed('partyInvite') || this.windows.wins.userlist?.blacklisted(from) || this.windows.order.some((w) => w.kind === 'party' || w.kind === 'partySearch')) { this.net.partyDeny(p.name); return; }
        (from !== p.name ? notify(this.windows, 'partySearch', from) : notify(this.windows, 'party', p.name))
          .then((ok) => (ok ? this.net.partyOp(3, p.id) : this.net.partyDeny(p.name)));
      },
      partyMessage: (code, text) => {
        const t = code === 0x24 ? text || PARTY_ERROR : PARTY_MESSAGES[code] ?? PARTY_ERROR;
        if (t) this.hud.message(code === 0x24 ? t : t.replace('%s', text), CHAT_COLORS.notice);
      },
      partyHp: (id, hp, maxHp) => { const m = this.party?.members.find((x) => x.id === id); if (m) Object.assign(m, { hp, maxHp }); },
      chat: later((c) => this.onChat(c)),
      spawnPlayer: later((d) => this.spawnPlayer(d)),
      clock: later((secs) => {
        // a Dojo floor draws its own clock
        if (secs !== null && Number(this.map?.info?.fieldType) === 14) { (this.dojo ??= new DojoWindow(this)).clock(secs); return; }
        this.clock = secs === null ? null : { end: performance.now() + secs * 1000 }; if (secs !== null) this.loadClockArt();
      }),
      fieldClock: later((h, m, s) => { this.fieldClock = { secs: h * 3600 + m * 60 + s, at: performance.now() }; this.loadClockArt(); }),
      ship: later((here) => this.moveShip(here)),
      // the Balrog's ship comes alongside: its music cuts in, for the rest of the voyage
      shipAttack: later(() => { if (this.ship) music.play('Bgm04/ArabPirate', { fadeOut: 0, fadeIn: 0 }); }),
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
      removePlayer: later((id) => { this.vfx?.untomb(this.others.get(id)); this.others.delete(id); for (const [k, p] of this.pets) if (p.owner === id) this.pets.delete(k); }),
      petSpawn: later((d) => this.addPet(d)),
      petRemove: later((owner, slot, reason) => this.removePet(owner, slot, reason)),
      petMove: later((owner, slot, moves) => { const pet = this.pets.get(`${owner}:${slot}`); if (pet && !pet.mine) pet.applyMovement(moves); }),
      // others' pets act out what their owner's client says; yours already did
      petChat: later((owner, slot, type, act, text, balloon) => { const pet = this.pets.get(`${owner}:${slot}`); if (pet && !pet.mine) pet.react(type, act, text, balloon); }),
      petCommand: later((owner, slot, type, cmd, ok, balloon) => this.onPetCommand(owner, slot, type, cmd, ok, balloon)),
      petName: later((owner, slot, name, tag) => { const pet = this.pets.get(`${owner}:${slot}`); if (pet) { pet.name = name; pet.nameTagOn = tag; } }),
      petExceptions: later((owner, slot, sn, ids) => {
        const pet = this.pets.get(`${owner}:${slot}`);
        if (pet?.mine && BigInt.asIntN(64, sn) === BigInt.asIntN(64, pet.sn)) (this.petExcluded ??= new Map()).set(pet.uid, ids);
      }),
      weather: later((type, id, text) => { if (id) this.weather.start(id, text); else this.weather.stop(); }),
      // 4: a sound from Sound/Field.img; 6: the map's music changes until the next map
      fieldEffect: later((type, str) => {
        if (type === 3 && str) this.vfx.screen(str);   // 3: Map/Effect.img/<str> on the screen
        if (type === 4 && str) sfx.play(`Field/${str}`);
        if (type === 6 && str) { this.fieldBgm = str.replace(/^Sound\//, '').replace('.img', ''); music.play(this.fieldBgm); }
      }),
      cashPetFood: later((slot) => {
        if (slot === -1) { this.windows.notice('Your pet cannot consume this food.\r\nPlease check again.'); return; }
        if (slot < 0) return;
        const pet = this.pets.get(`${this.player.id}:${slot}`);
        if (pet) sfx.play(`Pet/${pet.id}/eat`);
      }),
      petPotion: (kind, id) => { (this.petPotions ??= {})[kind] = id || null; },
      petEffect: later((owner, slot, effect) => { const pet = this.pets.get(`${owner ?? this.player.id}:${slot}`); if (pet) this.petEffect(pet, effect); }),
      movePlayer: later((id, moves) => this.others.get(id)?.applyMovement(moves)),
      playerLook: later((id, look, rings) => { const rp = this.others.get(id); if (rp) rp.rings = rings; this.updateOtherLook(id, look); }),
      attack: later((a) => this.onRemoteAttack(a)),
      expression: later((id, emote) => { const rp = this.others.get(id); if (rp) { setExpression(rp, emote); this.emotionEffect(rp, emote); } }),
      itemEffect: later((id, item) => { const rp = this.others.get(id); if (rp) this.setItemEffect(rp, item); }),
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
      foreignCancel: later((id, m1, m2) => this.onOther(id, (rp) => {
        if (rp.diseases) rp.diseases = rp.diseases.filter((x) => !((x.m1 & m1) || (x.m2 & m2)));
        if (BigInt.asUintN(64, BigInt(m2)) & COMBO_MASK) rp.combo = 0;
        if (BigInt.asUintN(64, BigInt(m1)) & RIDING_MASK) rp.mount = 0;
        if (BigInt.asUintN(64, BigInt(m2)) & DS_MASK || BigInt.asUintN(64, BigInt(m1)) & WW_MASK) rp.hidden = false;
        if (BigInt.asUintN(64, BigInt(m2)) & SP_MASK) rp.partner = false;
      })),
      // a mount's level / exp / tiredness; levelling up plays the pet level-up effect on its rider (the client's)
      mountInfo: later(async (id, level, exp, tired, up) => {
        const ent = id === this.player.id ? this.player : this.others.get(id);
        if (id === this.player.id) this.mountInfo = { level, exp, tired };
        if (ent) ent.mountTired = mountTired(level, tired);
        if (up && ent) sfx.play('Game/LevelUp');
        const node = up && ent && (await this.assets.json('Effect/PetEff.img'))?.Basic?.LevelUp;
        if (!node) return;
        const anim = new Anim(node, false);
        await this.assets.preload(anim.frames);
        this.fx.push({ anim, follow: ent, flip: false });
      }),
      foreignMount: later((id, item) => this.onOther(id, (rp) => { rp.mount = item; this.mountData(item); })),
      foreignPartner: later((id) => this.onOther(id, (rp) => { rp.partner = true; })),
      foreignHidden: later((id) => this.onOther(id, (rp) => { rp.hidden = true; })),
      foreignCombo: later((id, value) => { const rp = this.others.get(id); if (rp) rp.combo = value; }),
      mobStatus: later((oid, s) => { const e = this.lifeByOid.get(oid); if (e && !e.pending) this.applyMobStatus(e, s); }),
      mobStatusCancel: later((oid, first, second) => { const e = this.lifeByOid.get(oid); if (e && !e.pending) e.removeStatus(first, second); }),
      reactorHit: later((d) => { const r = this.reactors?.get(d.oid); if (r) r.setState(d.state); }),
      reactorDestroy: later((d) => { const r = this.reactors?.get(d.oid); if (r) r.destroy(d.state); }),
      moveMob: later((oid, start, moves, act, skill, level) => {
        const e = this.lifeByOid.get(oid);
        if (!e || e.pending || e.controlled) return;
        e.applyMovement(start, moves, act);
        // activity (12 + attack) * 2 + facing: its controller made it attack
        if (act >= 24 && act <= 41) { e.facingRight = !(act & 1); e.playAttack((act - 24) >> 1); }
        else if (act >= 42 && act <= 59 && skill) { e.facingRight = !(act & 1); e.playSkill(skill, level); }
      }),
      killMob: later((oid, anim) => this.killLife(oid, anim)),
      catchMob: (item, ok, oid) => {
        // Effect/ItemEff.img/<item> on the monster, or its fail child (if it has one) when the catch failed
        const m = this.lifeByOid.get(oid);
        if (m) this.vfx?.playPath(`Effect/ItemEff.img/${item}${ok ? '' : '/fail'}`, { x: m.x, y: m.y - 2 });
        if (item === 2270002) sfx.play(ok ? 'Game/CatchSuccess' : 'Game/CatchFaild');   // Element Rock
      },
      magnetCatch: (oid, ok) => {
        const m = this.lifeByOid.get(oid);
        if (m) this.vfx?.playPath(`Effect/BasicEff.img/Catch/${ok ? 'Success' : 'Fail'}`, { x: m.x, y: m.y - 15 });
      },
      catchFail: async (type, item) => {
        if (type === 0) { this.hud.message('Unable to capture the monster; the monster is too strong.', CHAT_COLOR.error); return; }
        if (type !== 1) return;
        const msg = item ? (await itemInfo(this.assets, item))?.delayMsg : '';
        this.hud.message(msg || 'Element Rock cannot be used right after usage.', CHAT_COLOR.error);
      },
      // damage the server deals by itself (poison, Ninja Ambush) or a heal: its number over the monster; one other
      // monsters can hurt also has its red bar follow the HP the server sends
      mobDamaged: later((oid, dmg, hp, maxHp) => {
        const e = this.lifeByOid.get(oid);
        if (!e || e.pending) return;
        if (dmg) this.vfx?.damage(e, [Math.abs(dmg)], dmg < 0 ? 'blue' : 'red');
        if (maxHp > 0 && Number(e.src?.info?.damagedByMob)) { e.hp = Math.round((e.maxHp * hp) / maxHp); e.hpPct = Math.floor((hp * 100) / maxHp); }
      }),
      mobHp: later((oid, pct) => { const e = this.lifeByOid.get(oid); if (e && !e.pending) { e.hp = Math.round((e.maxHp * pct) / 100); e.hpPct = pct; e.hpShownUntil = performance.now() + 5000; } }),
      bossHp: later((d) => this.vfx?.bossHp(d)),
      // level up, job change, quest clear, a monster card, an item levelling up: everyone hears it in full
      foreignEffect: later((chrId, effect) => {
        const rp = chrId === null ? this.player : this.others.get(chrId), name = this.vfx?.foreign(effect);
        if (!rp) return;
        if (name) this.vfx.play(name, rp);
        if (FOREIGN_SOUND[effect]) sfx.play(FOREIGN_SOUND[effect]);
      }),
      portalSound: () => sfx.play('Game/Portal'),
      spawnNpc: later((n) => this.spawnLife('Npc', n, false)),
      removeNpc: later((oid) => this.killLife(oid, 0)),
      drop: later((d) => this.spawnDrop(d)),
      removeDrop: later((oid, anim, chr, petSlot, delay) => this.removeDrop(oid, anim, chr, petSlot, delay)),
      inventory: (ops, unlock) => { if (unlock) this.cashBusy = false; this.onInventory(ops); },
      npcTalk: (d) => this.showNpcDialog(d),
      shop: (s) => { if (this.shopWin) this.windows.close(this.shopWin); this.shopWin = this.windows.show(new ShopWin(this.windows, s), null); },
      shopResult: (code, extra) => this.shopWin?.result(code, extra),
      storageOpen: (s) => {
        if (this.storageWin) this.windows.close(this.storageWin);
        this.storageWin = this.windows.show(new StorageWin(this.windows, s), null);
      },
      storageItems: (type, items) => this.storageWin?.setType(type, items),
      storageAll: (items) => this.storageWin?.setAll(items),
      storageMeso: (meso) => this.storageWin?.setMeso(meso),
      storageError: (code) => this.storageWin?.error(code),
      quest: (id, status, data) => this.onQuest(id, status, data),
      keymap: (km) => { this.keymap = km; this.dropForeignSkillKeys(); this.keyBar.render(); this.skillWin?.render(); },
      // the client answers with the keys it now holds
      quickslots: (keys) => { this.quickKeys = keys || [...DEFAULT_QUICKSLOTS]; this.net?.changeQuickslots(this.quickKeys); this.statusBar?.render(); },
      skills: (list) => {
        for (const s of list) {
          this.skills.setLevel(s.id, s);
        }
        this.skillWin?.render(); this.keyBar.render();
      },
      knowsSkill: (id) => this.skills.level(id) > 0,
      cooldown: (id, sec) => {
        if (sec) { this.skills.cooldowns[id] = Date.now() + sec * 1000; (this.skills.cooldownTotal ??= {})[id] = sec * 1000; }
        else delete this.skills.cooldowns[id];
      },
      buff: (b) => {
        if (b.mount) { this.riding = { item: b.mount, skill: b.source }; this.mountData(b.mount); }
        this.buffs = this.buffs.filter((x) => x.source !== b.source);
        this.buffs.push({ source: b.source, until: Date.now() + b.duration, dur: b.duration, m1: b.m1, m2: b.m2, hbHp: b.hbHp, hbMp: b.hbMp, sharpEyes: b.sharpEyes, speed: b.speed, jump: b.jump,
          watk: b.watk, matk: b.matk, hands: b.hands, acc: b.acc, booster: b.booster, infusion: b.infusion, mapleWarrior: b.mapleWarrior, combo: b.combo, stance: b.stance, wdef: b.wdef, mdef: b.mdef, avoid: b.avoid });
      },
      cancelBuff: (m1, m2) => {
        if (BigInt.asUintN(64, BigInt(m1)) & RIDING_MASK) this.riding = null;
        this.buffs = this.buffs.filter((b) => !((b.m1 & m1) || (b.m2 & m2)));
        this.diseases = (this.diseases || []).filter((d) => !((d.m1 & m1) || (d.m2 & m2)));
      },
      affected: later((chrId, skillId) => {
        const ent = chrId === null ? this.player : this.others.get(chrId);
        if (ent) this.playSkillEffect(skillId, ent, false, 'affected');
      }),
      skillSpecial: later((chrId, skillId) => { const ent = chrId === null ? this.player : this.others.get(chrId); if (ent) this.playSkillEffect(skillId, ent, false, 'special'); }),
      berserk: later((chrId, on) => this.setBerserk(chrId === null ? this.player : this.others.get(chrId), on)),
      foreignSkill: later((chrId, skillId, level) => {
        const rp = this.others.get(chrId);
        if (!rp) return;
        rp.charge = null;
        if (level) rp.level = level;
        // another player's skill art isn't drawn; only the teleport flash is
        if (TELEPORTS.has(skillId)) this.playTeleportEffect(rp.x, rp.y);
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
      questResult: (r) => this.onQuestResult(r),
      questTimer: (id, ms) => this.questTimer(id, ms),
      questEx: (id, v) => { this.quests.ex[id] = v; },
      questClear: (id) => { if (!hasQuestNotice(this.windows)) this.questCompleteNotice(id); },
      scriptProgress: (t) => this.questMsg.script(t),
      npcScripts: (list) => { this.npcScripts = new Map(list.map((e) => [e.id, e.name])); },
      questClearEffect: () => { this.vfx?.play('QuestClear', this.player); sfx.play('Game/QuestClear'); },
      wheelsLeft: (n) => this.hud.message(`You have used 1 Wheel of Destiny in order to revive at the current map. (${n} left)`, CHAT_COLOR.grey),
      avatarPicture: (path) => { this.vfx?.playPath(path, this.player); },
      direction: (path) => this.playDirection(path),
      lockUi: (on) => this.setUiLock(on),
      objectStates: (list) => { for (const { name, state } of list) this.setObjectState(name, state); },
      energyCharge: (v) => { this.energy = v; },
      aranCombo: (n) => this.setAranCombo(n),
      sessionValue: (k, v) => this.sessionValue(k, v),
      objectStatesReset: () => { for (const name of this.map?.namedObjs.keys() || []) this.setObjectState(name, 0); },
      mapObjectVisible: (list) => { if (this.loading) (this.objVisQueue ??= []).push(...list); else for (const { tag, on } of list) this.map?.setObjectVisible(tag, on); },
      disableUi: (on) => { this.uiDisabled = on; },
      hint: (text, width, seconds, at) => { this.vfx?.hint(text, width, seconds, at || this.player); },
      questItems: async (items) => {
        for (const { id, qty } of items) {
          const name = await itemName(this.assets, id), tab = TAB_NAMES[invType(id)] || '';
          const text = qty === 1 ? `You have gained an item in the ${tab} tab (${name})` : qty > 1 ? `You have gained items in the ${tab} tab (${name} ${qty})`
            : qty === -1 ? `You have lost an item (${name})` : `You have lost items (${name} ${-qty})`;
          this.hud.message(text, QUEST_GREY);
        }
      },
      // the game's small box with its OK; back to the login screen once it is clicked (no leave-page warning now)
      disconnected: () => { this.leaving = true; this.windows.okCancel('The connection to the server was closed.', 'ok').then(() => this.leave()); },
    });
    const loaded = this.changeMap(entered.mapId, { portalIdx: entered.portal });
    this.net.flush(); // buffered spawns queue up behind the map load
    await loaded;
    // the first map after logging in: a fresh log with the welcome line; the hourly play-time count starts
    this.statusBar?.clearLog(); this.hud.message('[Welcome] Welcome to MapleStory!!', CHAT_COLOR.yellow);
    this.playHourAt = performance.now() + 3600000; this.playHours = 1;
    this.basicGuide();
    // logged off (or dropped) while dead: the server kept the 0 HP, so come back as the ghost, still to be revived
    if (this.stats.hp <= 0 && !this.dead) this.die(false);
  }

  /**
   * Entering the game with a fresh character (level 1, no EXP) opens the Maple Administrator's key guide, a
   * dialog the client makes itself: nothing is sent when it closes.
   */
  basicGuide() {
    if (this.stats?.level !== 1 || this.stats?.exp !== 0) return;
    localTalk(this.windows, 9010000, '#eBasic Configuration for MapleStory#n\r\n\r\n#fUI/UIWindow.img/UtilDlgEx/notice#', ['OK', 'End Chat']);
  }

  // ---------------------------------------------------------------- quests
  /** Map objects tagged with a quest's showLayerTag show only while that quest is in progress. */
  questLayerTags() {
    const tags = this.quests?.layerTags, map = this.map;
    if (!tags || !map?.objTags) return;
    for (const tag of map.objTags.keys()) { const q = tags.get(tag); if (q) map.setObjectVisible(tag, this.quests.started[q] !== undefined); }
  }

  /** SHOW_STATUS_INFO mode 1: a quest record. Nothing goes to the chat; progress shows as the yellow lines. */
  onQuest(id, status, data) {
    const book = this.quests, old = book.started[id];
    book.update(id, status, data);
    this.questLayerTags();
    this.questAlert?.recordChanged(id, status);
    const alarm = this.windows.wins.questalarm, ctx = this.textCtx();
    if (status === 1) {
      if (old !== data) this.questMobLines(id, old);
      alarm?.onRecord(id);
      // a quest whose only requirement is talking to someone can be handed in as soon as it starts
      if (old === undefined && book.info[id] && book.canComplete(id, ctx)) this.questCompleteNotice(id);
      // a record (or the counter kept under an infoNumber) can make a quest ready to hand in
      for (const q of Object.keys(book.started).map(Number)) {
        if ((Number(book.check[q]?.['1']?.infoNumber) || q) === id && book.info[q] && book.canComplete(q, ctx)) this.questCompleteNotice(q);
      }
    } else {
      alarm?.remove(id);
      if (status === 2) {
        for (const q of Object.keys(book.started).map(Number)) {
          if (!book.requirements(q).quests.some((r) => r.id === id)) continue;
          alarm?.offer(q);
          if (book.canComplete(q, ctx)) this.questCompleteNotice(q);
        }
      }
    }
    this.questWin?.render();
  }

  /** A monster count that changed (and isn't 0) gets its line: "Blue Snail 3 / 10". */
  questMobLines(id, old) {
    const was = this.quests.mobProgress(id, old);
    this.quests.mobProgress(id).forEach((m, i) => {
      const name = this.windows.strings.mob?.[m.id]?.name;
      if (m.have !== 0 && m.have !== was[i].have && name) this.questMsg.progress(id, `m${m.id}`, name, m.have, m.need);
    });
  }

  /** After an inventory change: the item's line for every quest still short of it, and the helper / notice. */
  async questItemLines(itemId, was) {
    const book = this.quests, quests = (book?.byItem.get(itemId) || []).filter((q) => book.status(q) === 1);
    if (!quests.length) return;
    const now = this.itemCount(itemId), name = await itemName(this.assets, itemId), ctx = this.textCtx();
    const alarm = this.windows.wins.questalarm;
    for (const q of quests) {
      const need = book.requirements(q).items.find((it) => it.id === itemId)?.count ?? 0;
      if (now !== was && was < need && name) this.questMsg.progress(q, `i${itemId}`, name, now, need);
      if (book.canComplete(q, ctx)) {
        alarm?.keep(q);
        if (was < need && need <= now) this.questCompleteNotice(q);
      }
      if (alarm?.tracked(q)) alarm.touch(q);
      else if (now > was) alarm?.offer(q);
    }
  }

  /** Mesos crossing a quest's endmeso. */
  questMesoChanged(was) {
    const book = this.quests, ctx = this.textCtx(), alarm = this.windows.wins.questalarm;
    if (!book || was === this.meso) return;
    for (const q of Object.keys(book.started).map(Number)) {
      const need = book.requirements(q).meso;
      if (!need) continue;
      if (alarm?.tracked(q)) alarm.touch(q); else if (this.meso > was) alarm?.offer(q);
      if (was < need && need <= this.meso && book.canComplete(q, ctx)) { alarm?.keep(q); this.questCompleteNotice(q); }
    }
  }

  questCompleteNotice(q) {
    const book = this.quests;
    const title = q === 0 ? 'New Quest!' : book.area(q) === TITLE_AREA ? 'You got a title!' : 'Quest Complete!';
    // O (or the body) opens the quest while it is still in progress
    questNotice(this.windows, q, title, q ? book.name(q) : '', (id) => { if (this.quests.status(id) === 1) this.openQuest(id); });
  }

  /** Open the quest log on a quest. */
  openQuest(id) {
    const st = this.quests.status(id), w = this.windows.open('quest');
    if (!w) return;
    w.tab = st === 1 ? 1 : st === 2 ? 2 : 0; w.first = 0;
    w.folded[w.tab].delete(this.quests.area(id));
    if (w.rows().some((r) => r.id === id)) { w.select(id); w.scrollTo(id); }
  }

  /** UPDATE_QUEST_INFO: mode 8 is the server taking the quest; the rest are errors. */
  async onQuestResult(r) {
    const book = this.quests;
    if (r.ok) {
      // mode 8 also confirms a start: only a quest handed in loses its notice
      if (book.status(r.id) !== 1) dropQuestNotice(this.windows, r.id);
      const yes = book.dialogue(r.id, book.status(r.id) === 1 ? '0' : '1').yes;
      if (yes.length && !(await playQuestLines(this, r.npc, yes))) return;
      if (r.next) {
        const npc = this.map?.life.find((e) => e.kind === 'Npc' && Number(e.spawn.id) === r.npc) || { spawn: { id: r.npc } };
        await questFlow(this, npc, r.next);
      }
      return;
    }
    const say = (t) => this.windows.notice(t.replace(/\r\n/g, '\n'));
    if (r.mode === 9) say('The quest has ended\r\ndue to an unknown error.');
    else if (r.mode === 0x0a) say(this.questInventoryFull(r.id));
    else if (r.mode === 0x0b) say('You do not have enough mesos.');
    else if (r.mode === 0x0d) say('Unable to retrieve it due to the equipment\r\n currently being worn by the character.');
    else if (r.mode === 0x0e) say('You may not possess more than \r\none of this item.');
    else if (r.mode === 0x0f) {
      this.questTimer(r.id, 0);
      this.hud.message(`The [${book.name(r.id)}] quest expired because the time limit ended`, QUEST_GREY);
    } else if (r.mode === 0x10) this.questTimer(r.id, this.questTimers.get(r.id)?.total ?? 0);
  }
  /** "Eqp orUse item inventory is full.": the tabs of the items the quest gives you. */
  questInventoryFull(id) {
    const book = this.quests, a = book.act[id]?.[book.status(id) === 1 ? '1' : '0'] || {};
    const rw = book.rewards(id, this.stats);
    const tabs = [...new Set([...rw.fixed, ...rw.choose, ...rw.random].map((it) => invType(it.id)))].map((t) => TAB_NAMES[t]).filter(Boolean);
    const text = `${tabs.join(' or')} item inventory is full.`;
    return Number(a.money) < 0 ? `Either you don't have enough Mesos or ${text}` : text;
  }
  /** Time-limited quests: TimeQuest/TimeBar from (700, 50), 50px apart, its gauge in 48 steps and the alarm clock beside it. */
  drawQuestTimers(ctx) {
    if (!this.questTimers?.size) return;
    const T = this.windows.W.Quest?.TimeQuest, im = (n) => this.windows.image(n), now = performance.now();
    if (!T) return;
    let y = 50;
    const x = UI_W - 100;
    for (const t of this.questTimers.values()) {
      const bg = im(T.TimeBar?.backgrnd), g = T.TimeBar?.TimeGage || {};
      if (bg) ctx.drawImage(bg, x, y);
      const step = Math.min(48, Math.ceil((Math.max(0, t.end - now) / t.total) * 48));
      const left = im(g[0]), mid = im(g[2]), right = im(g[1]);
      if (step > 0 && mid) {
        if (left) ctx.drawImage(left, x + 2, y + 2);
        ctx.drawImage(mid, x + 4, y + 2, step - 1, mid.height);
        if (right) ctx.drawImage(right, x + 3 + step, y + 2);
      }
      const clock = im(T.AlarmClock?.default?.[0]?.[0]);
      if (clock) ctx.drawImage(clock, x + 52, y - 6);
      y += 50;
    }
  }
  /** A quest's time limit (ms left; 0 removes it). */
  questTimer(id, ms) {
    const T = this.windows.W.Quest?.TimeQuest;
    if (ms > 0 && T) this.assets.preload([...allCanvases(T.TimeBar), ...allCanvases(T.AlarmClock?.default?.[0])]);
    if (ms > 0) this.questTimers.set(id, { end: performance.now() + ms, total: ms });
    else this.questTimers.delete(id);
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

  /** Level 2: the skill window opens with its guide balloons, unless it is already open (Evan's skill window aside). */
  async skillGuide() {
    const job = this.stats?.job ?? 0;
    if (Math.floor(job / 100) === 22 || job === 2001) return;
    if (this.windows.order.includes(this.windows.wins.skill)) return;
    this.loginUi ??= await this.assets.json('UI/Login.img');
    const B = this.loginUi?.WorldNotice?.Balloon;
    if (B) await this.assets.preload(Object.values(B).filter((n) => n?._canvas));
    const w = this.windows.open('skill');
    if (w) w.guide = true;
  }

  /** Context for quest checks and NPC text (#c item counts). */
  textCtx() {
    const bookCards = Object.values(this.monsterBook?.cards || {}).filter((n) => n > 0).length;
    const worn = new Set(Object.values(this.inventory?.equipped || {}).map((i) => i.id));
    const first = this.player ? this.myPets()[0] : null, item = first && this.petItem(first);
    return {
      stats: this.stats, meso: this.meso, itemCount: (id) => this.itemCount(id), equipped: (id) => worn.has(id), bookCards,
      mapId: this.map?.id, skillLevel: (id) => this.skills?.levels?.[id]?.level || 0,
      pet: first ? { id: first.id, closeness: item?.pet?.closeness ?? 0 } : null,
    };
  }

  /** Click on an NPC: its quests first when it has any, else run its script. */
  interactNpc(npc) {
    if (this.windows.order.some((w) => w instanceof NpcDialog)) return;   // one conversation at a time: close it first
    const q = this.quests?.npcQuests(Number(npc.spawn.id), this.textCtx());
    if (q?.all) npcQuestMenu(this, npc, q);
    else this.net.npcTalk(npc.oid, { x: Math.round(npc.x), y: Math.round(npc.y) });
  }

  onStats(s, enable) {
    if (!this.stats) return;
    if (enable) { this.apPending = false; this.scriptPending = 0; this.cashBusy = false; this.pickupAnswered(); }
    const before = this.stats.level, exp0 = this.stats.exp;
    Object.assign(this.stats, s);
    if (s.level > before) this.petEvent('e_levelup');
    else if (s.exp > exp0 && s.exp >= (EXP[this.stats.level] || Infinity) * 0.9 && performance.now() - (this.petPreLevelT ?? -Infinity) >= 420000) { this.petPreLevelT = performance.now(); this.petEvent('e_prelevelup'); }
    this.petAutoPot('mp');
    if (s.meso !== undefined) { const was = this.meso; this.meso = s.meso; this.questMesoChanged(was); }
    this.questAlert?.statsChanged();
    if (s.level > before) { this.levelUpEffect(); sfx.play('Game/LevelUp'); }
    if (s.level === 2 && before === 1) this.skillGuide();
    if (s.job !== undefined && this.skills && s.job !== this.skills.job) {
      this.vfx?.play('JobChanged', this.player); sfx.play('Game/JobChanged');
      this.skills.loadJob(s.job).then(() => this.skillWin?.render());
    }
    if (s.sp !== undefined || s.level !== undefined) this.skillWin?.render();
    if (this.stats.hp <= 0 && !this.dead) this.die();
    if (this.stats.hp > 0 && this.dead) this.revive();
    this.hud.update(this.stats);
  }

  /**
   * HP 0: the character turns into its ghost over a tombstone, and a little over 2.2s later the death notice asks.
   * fresh is false when you come back to a map already dead (the stone is lying there, no sound).
   * With a Wheel of Destiny on a map that allows it, the notice offers it: the item is announced as the notice
   * opens (the stone glows, Effect/BasicEff.img/TombUpgrade), and Yes revives you here. Left open 10 minutes, the
   * notice sends you to the town.
   */
  async die(fresh = true) {
    this.dead = true;
    const p = this.player, death = this.death = {};
    p.action = 'dead'; p.frame = 0; p.frameT = 0; p.attack = null; p.seat = null; p.ladder = null;
    this.charging = null; this.endKeydown(); this.macroQueue = null;
    const at = this.tombPoint(p.x, p.y);
    this.vfx?.tomb(p, at.x, at.y, fresh);
    if (fresh) sfx.play('Game/Tombstone');
    await new Promise((r) => setTimeout(r, 2200));
    if (this.death !== death) return;   // brought back meanwhile
    const wheel = this.wheelRevivable();
    const answer = await new Promise((done) => {
      const w = death.notice = new DeathNotice(this.windows, wheel ? 'wheel' : 'ok', (yes) => done({ yes }));
      death.cancel = () => done(null);
      this.assets.preload(w.frames()).then(() => {
        if (this.death !== death) return;
        this.windows.show(w);
        if (wheel) { this.net.useDeathItem(WHEEL_OF_DESTINY, at.x, at.y); this.vfx?.play('TombUpgrade', { x: at.x, y: at.y }); }
      });
      setTimeout(() => { if (this.death === death) w.finish(false); }, 600000);
    });
    if (answer && this.death === death) this.net.respawn(answer.yes);
  }
  /**
   * Whether the death notice offers a Wheel of Destiny: you hold one, and the map isn't an event field (field types
   * 1, 3-5, 7, 10, 11, 15), a 9xxxxxxxx map, the ship rides (200090xxx) or 390xxxxxx.
   */
  wheelRevivable() {
    const type = Number(this.map?.info?.fieldType) || 0, id = this.map?.id || 0;
    if ([1, 3, 4, 5, 7, 10, 11, 15].includes(type)) return false;
    if (Math.floor(id / 100000000) === 9 || Math.floor(id / 1000) === 200090 || Math.floor(id / 1000000) === 390) return false;
    return this.itemCount(WHEEL_OF_DESTINY) >= 1;
  }
  /**
   * HP back while dead (Resurrection): the notice closes unanswered, the stone and ghost go, and you stand on the floor
   * under the stone.
   */
  revive() {
    this.dead = false;
    const p = this.player, t = this.tombOf(p), d = this.death;
    this.death = null;
    if (d?.notice) { d.notice.answered = true; this.windows.close(d.notice); }
    d?.cancel?.();
    this.vfx?.untomb(p);
    p.action = this.look.standAction(); p.frame = 0; p.frameT = 0;
    if (!t) return;
    p.x = t.x; p.y = t.y - 5; p.vx = 0; p.vy = 0; p.ladder = null;
    p.fh = this.map.fh.below(p.x, p.y, 40);
    if (p.fh) p.y = Footholds.yAt(p.fh, p.x);
  }

  levelUpEffect() { this.vfx?.play('LevelUp', this.player); }

  // ------------------------------------------------------------------ map
  async changeMap(id, { portal = null, portalIdx = null, pos = null } = {}) {
    if (this.loading && this.loadingId === id) return;
    // A newer SET_FIELD can arrive while a map is still loading: only the latest load wins.
    const seq = this.loadSeq = (this.loadSeq || 0) + 1;
    const current = () => seq === this.loadSeq;
    this.petMpArmed = false;
    this.loading = true; this.loadingId = id; this.objVisQueue = null;
    // a scene ends with its map; the next map's scene comes while that one loads
    this.direction = null;
    if (this.directionDressed) { this.directionDressed = false; this.rebuildLook(); }
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
      this.questLayerTags();
      for (const { tag, on } of this.objVisQueue || []) map.setObjectVisible(tag, on);
      this.objVisQueue = null;
      this.scriptPortalIn = this.scriptPortalLast = null; this.scriptPending = 0;   // script touch portals start fresh on each map
      this.touchedBoxPortal = undefined;   // arriving inside a touch portal doesn't take it
      this.charging = null;   // a skill being charged doesn't carry over
      this.keydown = null;
      this.rush = null;
      this.weather.stop(false);   // weather belongs to the map it fell on
      // a chalkboard can't be held up where stores open
      if (this.player.chalk && Number(map.info?.personalShop)) this.closeChalkboard('You cannot use the chalkboard here.');
      this.fade = { dir: 'in', t0: performance.now() };
      this.vfx?.mapChanged();
      this.others.clear(); this.clearDrops(); this.lifeByOid.clear(); this.pets.clear(); this.summons.clear(); this.boards.clear(); this.reactors?.clear();
      this.doors?.clear(); this.mists?.clear(); this.clock = null; this.fieldClock = null; this.dojo?.mapChanged();
      this.mapEnteredAt = performance.now(); this.setupShip();
      if (pos) this.placeAt(pos.x, pos.y);
      else this.placeAtPortal(portalIdx !== null ? map.portalById(portalIdx) : map.spawnPortal(portal));
      if (this.dead) { const at = this.tombPoint(this.player.x, this.player.y); this.vfx?.tomb(this.player, at.x, at.y, false); }   // still a ghost here
      this.snapCamera();
      if (!this.net) history.replaceState(null, '', `?map=${id}`);
      this.hooks.onMap?.(map);
      this.hud?.setMap(map);
      this.fieldBgm = null;
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
      this.questAlert?.refresh();   // what this map, your items and your level offer
    }
  }

  placeAtPortal(portal) { this.placeAt(portal.x, portal.y - 10); }

  placeAt(x, y) {
    const p = this.player;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.ladder = null; p.seat = null;
    p.fh = this.map.fh.below(p.x, p.y, 400);
    if (p.fh) p.y = Footholds.yAt(p.fh, p.x);
    this.moveBuf = []; this.moveTotal = 0; this.lastSent = null; this.movePos = null; this.downOfh = 0; this.moveEvent = null; this.wasAirborne = false; this.playerZ = null;
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
      e.onPath = (m, start, moves, activity = -1) => { if (m.controlled && !m.dying) this.net?.moveMob(m.oid, start, moves, activity); };
    }
    if (entry.newSpawn) { e.appear(); if (kind === 'Mob') sfx.play(`Mob/${pad(Number(d.id), 7)}/Regen`, { volume: this.volumeAt(e.x, e.y) }); }
    this.lifeByOid.set(d.oid, e);
    map.life.push(e);
    if (kind === 'Npc' && this.vfx) this.vfx.questT = 0;   // its quest icon at once
    // a monster others can hurt (info/damagedByMob: the Watch Hog, Moon Bunny, Tylus...) is the field's friendly one
    if (kind === 'Mob' && Number(e.src?.info?.damagedByMob)) { this.friendlyMob = e; this.friendlyHitAt = performance.now(); }
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
    if (anim && e.kind === 'Mob') sfx.play(`Mob/${pad(Number(e.spawn.id), 7)}/Die`, { volume: this.volumeAt(e.x, e.y) });
    if (e.kind === 'Mob' && Number(e.spawn.id) === this.vfx?.boss?.oid) this.vfx.boss = null; // the gauge goes with its boss
    if (anim && e.anims.die1) e.kill(); else e.removed = true;
  }

  /** Run fn on another player now, or once their spawn (still loading their look) is done. */
  onOther(id, fn) { const q = this.spawning?.get(id); if (q) q.push(fn); else { const rp = this.others.get(id); if (rp) fn(rp); } }
  async spawnPlayer(d) {
    if (d.id === this.player?.id) return;   // the server can spawn you to yourself (a job change): you're already here
    const waiting = [];
    (this.spawning ??= new Map()).set(d.id, waiting);
    try { await this.addOther(d); } finally { if (this.spawning.get(d.id) === waiting) this.spawning.delete(d.id); }
    const rp = this.others.get(d.id);
    if (rp) for (const fn of waiting) fn(rp);
  }
  async addOther(d) {
    const look = new CharacterLook(this.assets, { skin: d.look.skin, face: d.look.face, hair: d.look.hair, gender: d.look.gender, equips: lookEquipIds(d.look) });
    await look.load();
    await this.assets.preload(lookCanvases(look, ['stand1', 'stand2', 'walk1', 'walk2', 'jump', 'ladder', 'rope']));
    if (!this.map) return;
    const rp = new RemotePlayer(d, look);
    this.afterimageSet(look.weapon?.info?.afterImage);   // their swing trail, ready for their first blow
    rp.lookData = d.look;
    rp.box = d.box; rp.rings = d.rings; rp.chalk = d.chalk; rp.chair = d.chair || 0; rp.combo = d.combo || 0; rp.hidden = !!d.hidden; rp.partner = !!d.partner;
    rp.mount = d.mount || 0; if (rp.mount) this.mountData(rp.mount);
    rp.mountTired = d.mountInfo ? mountTired(d.mountInfo.level, d.mountInfo.tired) : false;
    if (rp.chair) this.chairArt(rp.chair);
    if (d.itemEffect) this.setItemEffect(rp, d.itemEffect);
    this.others.set(d.id, rp);
    if (d.berserk) this.setBerserk(rp, true);   // already berserk when they appear
    for (const p of d.pets || []) this.addPet({ owner: d.id, ...p });
  }

  async updateOtherLook(id, lookData) {
    const rp = this.others.get(id); if (!rp) return;
    const look = new CharacterLook(this.assets, { skin: lookData.skin, face: lookData.face, hair: lookData.hair, gender: lookData.gender, equips: lookEquipIds(lookData) });
    await look.load();
    rp.look = look; rp.lookData = lookData;
  }

  onChat(c) {
    const ent = c.id === this.player.id ? this.player : this.others.get(c.id);
    const name = ent?.name || '?';
    if (ent) ent.chat = { text: c.text, t: 5 };
    if (c.show) return;   // a balloon only
    if (c.gm) this.statusBar?.message(`${name} : ${c.text}`, CHAT_BAR.gm.color, { bg: CHAT_BAR.gm.bg });
    else this.hud.message(`${name} : ${c.text}`, CHAT_COLOR.all);
  }

  /**
   * Another player's attack, timed like ours: their animation runs at the speed in the packet and the
   * hits land after the pose's attack delay, with the monster's death and loot held until then.
   */
  onRemoteAttack(a) {
    const rp = this.others.get(a.id);
    let delay = 0;
    if (rp && a.level) rp.level = a.level;   // their attack's art follows the level it carries
    if (rp) {
      rp.attack = this.actionName(a.action); rp.facingRight = !a.facingLeft;
      rp.frame = 0; rp.frameT = 0; rp.action = rp.attack;
      rp.attackScale = this.attackScale(Math.max(2, Math.min(10, a.speed ?? 6)));
      if (a.skill === BOOMERANG_STEP) {   // unseen for the pose
        let len = 0; for (let i = 0; i < rp.look.frameCount(rp.attack); i++) len += rp.look.delay(rp.attack, i);
        rp.boomerangUntil = performance.now() + len * rp.attackScale;
      }
      if (a.skill) this.playSkillEffect(a.skill, rp, false, 'effect', rp.attackScale);
      this.remoteAfterimage(rp, a.skill, a.kind);
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
        shot.partner = !!rp.partner && !NO_PARTNER.has(a.skill);
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
      const looks = a.skill === BAND_OF_THIEVES ? this.thiefLooks(a.skill, order.length) : [];
      for (const [i, t] of order.entries()) {
        const e = this.lifeByOid.get(t.oid);
        if (!e || e.pending) continue;
        e.pendingHits = (e.pendingHits || 0) + 1;
        const land = () => {
          e.hit(t.dmg.reduce((s, x) => s + x, 0), !!rp && rp.x < e.x);
          this.damageNumbers(e, t.dmg, false, a.skill, t.crit, ...this.lineTiming(rp));
          this.playHitEffect(a.skill, e, rp, t.dmg, looks[i] ?? null, a.kind === 'ranged' && [5020, 5021].includes(Math.floor(a.projectile / 1000)) ? a.projectile : 0);
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
    // Shadow Shifter dodged it: its art, a MISS
    if (rp && d.damage === -1 && d.fake) { this.playSkillEffect(d.fake, rp, false, 'special'); setExpression(rp, 2, HIT_FACE_TIME); this.vfx?.damage(rp, [0], 'violet'); return; }
    if (rp) this.vfx?.damage(rp, [d.damage], 'violet');
    if (rp && d.damage > 0) setExpression(rp, 1, HIT_FACE_TIME);
    const dam = rp && d.mobId && CHAR_DAM[d.from];
    if (dam) sfx.play(`Mob/${pad(d.mobId, 7)}/${dam}`, { volume: this.volumeAt(rp.x, rp.y) });
  }

  /** Drops a monster let go of while our blow was still on its way: they come out as it dies. */
  releaseDrops(e) {
    const held = e.heldDrops;
    e.heldDrops = null;
    for (const d of held || []) this.spawnDrop(d);
  }
  /** Drops still held or loading belong to the map they fell on, and so do the monsters still dying there. */
  clearDrops() {
    this.drops.clear();
    this.dying?.clear();
    for (const d of this.pendingDrops.values()) d.gone = true;
    this.pendingDrops.clear();
  }
  async spawnDrop(d) {
    // the server announces a player's drop twice (mode 1, then 0): keep the first, even while its icon loads
    const pending = this.pendingDrops;
    if (d.gone || this.drops.has(d.oid) || (pending.has(d.oid) && pending.get(d.oid) !== d)) return;
    pending.set(d.oid, d);
    // the server drops loot as soon as it counts the kill; hold it until our hit lands and it dies
    const src = this.lifeByOid.get(d.dropper) || this.dying?.get(d.dropper);
    if (src && !src.pending && (src.pendingHits > 0 || src.queuedKill)) { (src.heldDrops ??= []).push(d); return; }
    // an item with info/iconReward lies on the ground as that animation (the item with a key sign over it)
    const reward = d.meso ? null : await itemRewardIcon(this.assets, d.id);
    let node = d.meso ? await mesoIcon(this.assets, d.id) : reward || await itemIcon(this.assets, d.id, true);
    if (d.meso && node) node = mesoTiming(node, d.id);
    const anim = new Anim(node || null);
    await this.assets.preload(anim.frames);
    if (d.gone) return;   // picked up or expired meanwhile, or we left the map
    pending.delete(d.oid);
    if (!this.map) return;
    const y = d.y;
    // monster loot leaves from where the monster is now
    const mob = this.lifeByOid.get(d.dropper) || this.dying?.get(d.dropper);
    const fromMob = mob?.kind === 'Mob';
    const fromX = fromMob ? mob.x : d.fromX ?? d.x, fromY = fromMob ? mob.y : d.fromY ?? y;
    if (d.mode === 1 && performance.now() - (this.dropSoundAt || 0) > 300) { this.dropSoundAt = performance.now(); sfx.play('Game/DropItem', { volume: this.volumeAt(fromX, fromY) }); }
    // explosive drops (type 3) go higher and stay up longer; onto higher ground the flight is cut short
    const big = d.type === 3, k = big ? 1.8 : 1, speed = big ? 720 : 400, up = fromY - y, top = big ? 180 : 100;
    const flight = up > 0 ? Math.min(k, ((up < top ? Math.floor(Math.sqrt((top - up) * 2.5)) : 0) + 1) * 0.03 + k / 2) : k;
    this.drops.set(d.oid, { ...d, y, anim, landed: d.mode === 2, age: 0, born: performance.now(), cx: fromX, cy: fromY, fromX, fromY, alpha: 1, phase: 0,
      spin: !d.meso && !reward, angle: 0, speed, flight });
  }

  removeDrop(oid, anim, chr, petSlot = -1, delay = 0) {
    if (chr === this.player.id && (anim === 2 || anim === 5)) this.pickupAnswered();
    const d = this.drops.get(oid);
    // still held or loading: it stays in pendingDrops, marked gone, so a repeat announcement of it is ignored too
    if (!d) { const p = this.pendingDrops.get(oid); if (p) p.gone = true; return; }
    if (anim === 4) { this.explodeMeso(oid, delay); return; }
    const pet = anim === 5 && this.pets.get(`${chr}:${petSlot}`);
    if (pet) { if (chr === this.player.id) sfx.play('Game/PickUpItem'); this.pickUp(d, pet); return; }
    // a pet's pickup without that pet flies to its owner
    if (anim === 2 || anim === 5) {
      const target = chr === this.player.id ? this.player : this.others.get(chr);
      if (chr === this.player.id) sfx.play('Game/PickUpItem');
      if (target) { this.pickUp(d, target); return; }
    }
    // expired: it stops floating on its first frame and fades out over 1s
    if (anim === 0 && d.landed) { d.expire = 0; d.anim.reset?.(); return; }
    this.drops.delete(oid);
  }

  onInventory(ops) {
    const inv = this.inventory;
    let lookChanged = false;
    const box = (t, pos) => (pos < 0 ? inv.equipped : inv[t]);
    // counts before the change, for the quest progress lines
    const was = new Map();
    for (const op of ops) for (const id of [op.item?.id, box(op.inv, op.pos)?.[op.pos]?.id]) if (id && !was.has(id)) was.set(id, this.itemCount(id));
    for (const op of ops) {
      if (op.mode === 0) {
        const old = box(op.inv, op.pos)[op.pos];
        box(op.inv, op.pos)[op.pos] = { ...op.item, pos: op.pos };
        // a pet's item refreshed: how its closeness changed
        const d = old?.pet && op.item.pet && old.cashId === op.item.cashId ? op.item.pet.closeness - old.pet.closeness : 0;
        if (d > 0) this.hud.message(`The closeness increased (+${d})`, CHAT_COLORS.notice);
        else if (d < 0) this.hud.message(`The closeness decreased (${d})`, CHAT_COLORS.notice);
      }
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
    this.petFlagCache = null;
    for (const p of this.myPets()) p.lootPauseAt = 0;
    this.hud.renderInventory();
    this.questWin?.render();
    for (const [id, n] of was) this.questItemLines(id, n);
    for (const id of was.keys()) this.questAlert?.itemChanged(id, false);
    for (const op of ops) if (op.pos < 0 || op.to < 0) for (const id of [op.item?.id, box(op.inv, op.to ?? op.pos)?.[op.to ?? op.pos]?.id]) if (id) this.questAlert?.itemChanged(id, true);
  }

  /** User effect 0x12: a scene over the screen (the job previews, the boat to Lith Harbor...). */
  async playDirection(path) {
    const seq = this.loadSeq;
    const scene = await DirectionScene.load(this, path);
    if (scene && seq === this.loadSeq) { this.direction = scene; this.player.facingRight = false; }   // played facing left
  }
  directionField(id) { this.net?.directionField(id); }
  /** A scene's costume: only these items (slot: id), until the next map. */
  async directionLook(slots) {
    const s = this.stats;
    if (!s) return;
    // no medal: its tag doesn't show in a scene
    const equips = Object.values(slots).filter((id) => Math.floor(id / 10000) !== 114);
    const look = new CharacterLook(this.assets, { skin: s.skin, face: s.face, hair: s.hair, gender: s.gender, equips });
    await look.load();
    await this.assets.preload(lookCanvases(look, PRELOAD_ACTIONS));
    if (!this.direction) return;
    this.look = look; this.directionDressed = true;
    this.assets.preload(lookCanvases(look, look.actionList()));
  }
  directionAction(action) {
    const p = this.player;
    if (!this.look.has(action)) return;
    p.attack = action; p.action = action; p.frame = 0; p.frameT = 0; p.seat = null;
  }
  /** LOCK_UI: the windows close and the status bar and minimap are gone until it is unlocked. */
  setUiLock(on) {
    this.uiLocked = on;
    const wm = this.windows;
    if (on && wm) {
      const keep = (w) => w === wm.wins.minimap || w === wm.wins.questalarm;
      for (const w of wm.order) if (!keep(w)) w.onClose?.();
      wm.order = wm.order.filter(keep); wm.drag = null; wm.carry = null; wm.tip = null;
    }
    this.statusBar?.setHidden?.(on);
  }

  async rebuildLook() {
    const s = this.stats;
    const look = new CharacterLook(this.assets, { skin: s.skin, face: s.face, hair: s.hair, gender: s.gender, equips: equippedIds(this.inventory.equipped) });
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
    const str = this.totalStat('str'), dex = this.totalStat('dex'), luk = this.totalStat('luk');   // equipment counts
    let main = str, sec = dex;
    if (cat === 45 || cat === 46 || cat === 49) { main = dex; sec = str; }
    else if (cat === 47 || thiefDagger) { main = luk; sec = dex + str; }
    return Math.max(1, Math.ceil(((mult * main + sec) / 100) * this.watk()));
  }

  useInventoryItem(tab, slot, it) {
    if (this.dead) { this.windows.notice("You can't do it once you're dead."); return; }
    if (tab === 5 && it.id === 5170000) { this.useNameTag(slot, it.id); return; }                  // Pet Name Tag
    if (tab === 5 && it.id === 5180000) { if (this.cashFree()) this.net.waterOfLife(); return; }   // Water of Life: the fairy does the rest
    if (tab === 5 && Math.floor(it.id / 10000) === 524) { this.useCashPetFood(slot, it.id); return; }
    if (tab === 5 && Math.floor(it.id / 10000) === 512) { this.useWeather(slot, it.id); return; }
    if (tab === 5 && it.id === 5050000) { this.useApReset(slot, it.id); return; }
    if (tab === 5 && (it.id === 5060001 || Math.floor(it.id / 1000) === 5061)) { this.useItemGuard(slot, it.id); return; }
    if (tab === 5 && it.id > 5050000 && it.id <= 5050004) { this.useSpReset(slot, it.id); return; }
    if (tab === 5 && Math.floor(it.id / 10000) === 545 && Math.floor(it.id / 1000) !== 5451) { this.useMiuMiu(slot, it.id); return; }
    if (tab === 5 && it.pet) { this.summonPet(slot, it); return; }        // summon / send the pet home
    if (tab === 5 && Math.floor(it.id / 10000) === 514) { this.openShop(it.id); return; }      // a Shop Permit
    if (tab === 5 && Math.floor(it.id / 10000) === 503) { this.openMerchant(it.id); return; }   // a Hired Merchant
    if (tab === 5 && (Math.floor(it.id / 10000) === 507 || Math.floor(it.id / 10000) === 539)) { this.openMegaphone(slot, it.id); return; }
    if (tab === 5 && Math.floor(it.id / 10000) === 504) { this.openRock(slot, it.id); return; }          // a Teleport Rock
    if (tab === 5 && Math.floor(it.id / 10000) === 537) { this.openChalkboard(slot, it.id); return; }    // a Chalkboard
    if (tab === 5 && Math.floor(it.id / 10000) === 516) { this.useFaceItem(it.id); return; }             // a facial expression
    if (tab === 5 && Math.floor(it.id / 10000) === 501) { this.useItemEffect(it.id); return; }           // a character effect
    if (tab === 3 && Math.floor(it.id / 10000) === 301) { this.sitChair(it.id); return; }        // a chair
    if (tab === 4 && Math.floor(it.id / 10000) === 416) { this.openBook(it.id); return; }        // a book (the Beginner's Guide)
    if (tab === 2 && isPetFood(it.id)) { this.feedPet(slot, it.id); return; }
    if (tab === 2 && isScroll(it.id)) {
      // a scroll is put on an item, not used: pick it up and show what you wear
      this.windows.startCarry({ kind: 'item', tab: 2, slot, id: it.id, sticky: true, x: -99, y: -99, at: 0 }, this.windows.icon(it.id));
      this.windows.open('equip');
      this.hud.message('Click the equipped item to use the scroll on.', '#fff');
      return;
    }
    if (tab === 2) { this.useConsume(slot, it.id); return; }
    else if (tab === 1) {
      if (this.dead) { this.windows.notice("You can't do it once you're dead."); return; }
      if (isPetEquip(it.id)) { this.equipPet(slot, it); return; }
      const dst = this.equipDest(it.id, it.cash);
      if (!dst) return;
      this.equipChecked(slot, it, dst);
    }
  }

  /** A book item's pages (Item/Etc/0416.img/<id>/book) in UIWindow.img/Book; the client opens it by itself. */
  async openBook(id) {
    const items = await this.assets.json(`Item/Etc/${pad(Math.floor(id / 10000), 4)}.img`);
    const book = items?.[pad(id, 8)]?.book;
    if (!book) return;
    const old = this.windows.order.find((w) => w instanceof BookWin);
    if (old) this.windows.close(old);
    const win = new BookWin(this.windows, Object.values(book));
    await this.windows.assets.preload(win.frames());
    this.windows.show(win, 'UI/MenuUp');
  }

  petSlots(i) { return PET_SLOTS[i] || PET_SLOTS[0]; }
  /**
   * Double-click pet equipment: it goes on the lead pet; with two or more out, on one of the pets it can go on (an
   * accessory made for it, an ability item, the Label / Quote Ring), picked in the pet dialog when there are several.
   * The potion pouches are shared.
   */
  async equipPet(slot, it) {
    const id = it.id, pets = this.petsOf(this.player.id);
    let dst = equipSlotFor(id);
    if (!dst) return;
    if (pets[1] && !SHARED_PET_SLOTS.includes(dst)) {
      const cat = Math.floor(id / 10000), ks = [];
      for (let k = 0; k < 3; k++) if (pets[k] && ((await this.petWears(id, pets[k])) || cat === 181 || id === 1822000 || id === 1832000)) ks.push(k);
      if (!ks.length) return;
      let k = ks[0];
      if (ks.length > 1) {
        const i = await this.windows.selectPet('Please select the pet you would like to put the pet equipment on.', ks.map((k) => {
          const p = pets[k], own = this.petItem(p)?.pet;
          return { name: p.name, level: own?.level ?? this.petLevel(p), closeness: own?.closeness ?? 0, stand: p.data?.stand0 };
        }));
        if (i == null) return;
        k = ks[i];
      }
      dst = equipSlotFor(id, k);
    }
    this.equipChecked(slot, it, dst);
  }
  /** Pet equipment dropped on a cell of the Equip window's pet panel: it only goes into the cell it belongs in, for the pet shown. */
  equipPetCell(slot, it, cell, pet) {
    if (this.dead) { this.windows.notice("You can't do it once you're dead."); return; }
    if (equipSlotFor(it.id, pet) === cell) this.equipChecked(slot, it, cell);
  }
  /** Whether an accessory (1802000-1802099) is made for a pet: its Character/PetEquip img has a node for one with the same id % 1000. */
  async petWears(id, pet) {
    if (!pet || Math.floor(id / 10000) !== 180 || id % 1000 >= 100 || Math.floor(pet.id / 10000) !== 500) return false;
    const art = await this.assets.json(`Character/PetEquip/${pad(id, 8)}.img`);
    return Object.keys(art || {}).some((k) => Math.floor(k / 10000) === 500 && k % 1000 === pet.id % 1000);
  }
  /**
   * What stops pet equipment going into pet slot `dst`, or null: the accessory must be made for that pet, the rings
   * need its name tag / balloon, the pouch, magnet and Item Ignore Pendant need it out. Wing Boots, Binocular and
   * Magic Scales need no pet; going on one that is out, they pause its looting.
   */
  async petSlotRefusal(id, dst) {
    const k = PET_SLOTS.findIndex((s) => Object.values(s).includes(dst));
    if (k < 0) return null;
    const S = PET_SLOTS[k], pet = this.petsOf(this.player.id)[k];
    const none = 'You do not currently have a pet that is alive.', cant = 'The pet is unable to wear the equipment.';
    if (dst === S.acc) return (await this.petWears(id, pet)) ? null : cant;
    if (dst === S.label || dst === S.quote) return !pet ? none : Number(pet.info[dst === S.label ? 'nameTag' : 'chatBalloon']) ? null : cant;
    if (dst === S.boots || dst === S.binocular || dst === S.scales) { if (pet) pet.lootPauseAt = performance.now(); return null; }
    return pet ? null : none;
  }
  /**
   * Your level, stats and fame as an equip's requirements see them: your own stats plus the bonuses of what you would
   * still be wearing once it is on (not its own, nor those of what it takes off: the piece in its slot, a top and
   * bottom for an overall, a shield for a two-handed weapon...).
   */
  equipStats(id) {
    const s = this.stats || {}, worn = this.inventory?.equipped || {}, dst = this.equipDest(id), cat = Math.floor(id / 10000);
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
   * The rings you wear, as others see them: a couple (1112001-1112099) or friendship ring (1112800-1112802,
   * 1112810-1112812) by its serial and its partner ring's, a wedding ring by the spouse's id.
   */
  ownRings() {
    const eq = this.inventory?.equipped || {}, r = this.rings || {};
    const worn = (test) => [-112, -113, -115, -116, -12, -13, -15, -16].map((s) => eq[s]).find((it) => it && test(it.id));
    const pair = (it, list) => { const x = it && list?.find((p) => p.ring === it.cashId); return x ? { ring: x.ring, partner: x.partnerRing, item: it.id } : null; };
    const wed = worn((id) => WEDDING_RINGS.includes(id)), m = r.marriage;
    return {
      couple: pair(worn((id) => Math.floor(id / 100) === 11120 && id !== 1112000), r.couple),
      friend: pair(worn((id) => Math.floor(id / 100) === 11128 && id % 10 < 3), r.friend),
      marriage: wed && m ? { id: this.player.id, partner: m.husbandId === this.player.id ? m.wifeId : m.husbandId, item: wed.id } : null,
    };
  }
  /**
   * Ring effects: two characters on the map wearing the halves of a couple, friendship or wedding ring each show
   * Effect/ItemEff.img/<ring>/0 while within 700 x 500px of each other, and /1 plays between them (20px over the
   * middle of their feet) while within 100 x 100.
   */
  updateRingFx(dt) {
    const fx = (this.ringFx ??= new Map()), seen = new Set();
    if (!this.itemEff) { this.itemEff = this.assets.json('Effect/ItemEff.img').then((j) => { this.itemEff = j || null; }); return; }
    if (this.itemEff instanceof Promise) return;
    this.player.rings = this.ownRings();
    const ents = [this.player, ...this.others.values()];
    const anim = (n) => { const a = n && frames(n).length ? new Anim(n) : null; if (a) this.assets.preload(a.frames); return a; };
    for (const kind of ['couple', 'friend', 'marriage']) {
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          const a = ents[i], b = ents[j], ra = a.rings?.[kind], rb = b.rings?.[kind];
          if (!ra || !rb) continue;
          const paired = kind === 'marriage' ? (ra.partner && ra.partner === b.id) || (rb.partner && rb.partner === a.id)
            : (ra.ring && ra.partner === rb.ring) || (rb.ring && rb.partner === ra.ring);
          const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
          if (!paired || dx >= 700 || dy >= 500) continue;
          const key = `${kind}:${a.id}:${b.id}`, node = this.itemEff?.[ra.item || rb.item];
          if (!node) continue;
          seen.add(key);
          let p = fx.get(key);
          if (!p) fx.set(key, (p = { a, b, on: [anim(node[0]), anim(node[0])], mid: null }));
          const close = dx < 100 && dy < 100;
          if (close && !p.mid) p.mid = anim(node[1]);
          else if (!close) p.mid = null;
          for (const x of [...p.on, p.mid]) x?.update(dt * 1000);
        }
      }
    }
    for (const k of fx.keys()) if (!seen.has(k)) fx.delete(k);
  }
  /** One character's ring effects (/0, at its feet, in front of it), or with no character the ones between two. */
  drawRingFx(ctx, cam, ent = null) {
    const draw = (a, x, y, flip) => {
      const node = a?.node, img = node && this.assets.image(node);
      if (!img) return;
      const o = node.origin || [0, 0];
      ctx.save();
      ctx.globalAlpha = a.alpha;
      ctx.translate(Math.round(x - cam.x), Math.round(y - cam.y));
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -o[0], -o[1]);
      ctx.restore();
    };
    for (const p of this.ringFx?.values() || []) {
      if (!ent) draw(p.mid, (p.a.x + p.b.x) / 2, (p.a.y + p.b.y) / 2 - 20, false);
      else if (p.a === ent || p.b === ent) draw(p.on[p.a === ent ? 0 : 1], ent.x, ent.y, ent.facingRight);
    }
  }
  /** UI/NameTag.img (label rings, pet labels, medals), or null while it loads. */
  nameTagArt() {
    this.nameTags ??= this.assets.json('UI/NameTag.img').then(async (n) => { this.nameTags = n || {}; if (n?.pet) await this.assets.preload(allCanvases(n.pet)); return n; });
    return this.nameTags instanceof Promise ? null : this.nameTags;
  }
  /** A label ring's name tag for a look wearing one (White Label, or UI/NameTag.img/<n>); its height, 0 for the plain tag. */
  drawLabelTag(ctx, look, text, x, y) {
    if (look?.nameTag === 1) return nameTag(ctx, text, x, y, '#000', { white: true }).h;
    if (!look?.nameTag) return 0;
    return Math.max(0, artTag(ctx, this.assets, this.nameTagArt()?.[look.nameTag], text, x, y));
  }
  /** A character's tags from y down, 1px apart: name, guild, medal. */
  drawCharTags(ctx, ent, look, local, x, y) {
    y += (this.drawLabelTag(ctx, look, ent.name, x, y) || nameTag(ctx, ent.name, x, y).h) + 1;
    const guild = local ? this.guild?.name : ent.guild;
    if (guild) y += drawGuildTag(ctx, this, guild, local ? this.guild.emblem : ent.emblem, x, y) + 1;
    const name = look?.medal ? (this.windows.itemName(look.medal) || '').replace("'s Medal", '') : '', art = name && this.nameTagArt();
    if (art && artTag(ctx, this.assets, art.medal?.[look.medalTag], name, x, y) < 0) nameTag(ctx, name, x, y);
  }
  /** A character's equip effects (EquipEffect), kept in step with what its look wears. */
  stepEquipFx(ent, look, dt) {
    const want = look?.equipFx || [];
    if (!want.length && !ent.equipFx?.length) return;
    if (!this.charEff) { this.charEff = this.assets.json('Effect/CharacterEff.img').then((j) => { this.charEff = j || null; }); return; }
    if (this.charEff instanceof Promise) return;
    if (want.length !== ent.equipFx?.length || want.some((w, i) => w.id !== ent.equipFx[i].id)) {
      ent.equipFx = want.map((w) => ent.equipFx?.find((f) => f.id === w.id)
        || new EquipEffect(w.id, w.effect, String(w.effect.path).split('/').slice(2).reduce((n, k) => n?.[k], this.charEff)));
    }
    const moving = ent.equipFxX !== undefined && Math.abs(ent.x - ent.equipFxX) > 0.5;
    ent.equipFxX = ent.x;
    const right = drawnRight(ent);
    for (const f of ent.equipFx) f.update(dt, f.head ? ent.browAt || { x: ent.x, y: ent.y - 55 } : ent, right, moving);
  }
  drawEquipFx(ctx, cam, ent, parts, front, dx = 0, dy = 0) {
    const brow = parts.brow || [0, -55], x = ent.x + dx, y = ent.y + dy, right = drawnRight(ent);
    ent.browAt = { x: x + brow[0] * (right ? -1 : 1), y: y + brow[1] };
    for (const f of ent.equipFx || []) {
      const at = f.head ? ent.browAt : { x, y };
      f.draw(ctx, this.assets, { x: at.x - cam.x, y: at.y - cam.y }, right, front, cam.x, cam.y);
    }
  }
  /** The slot an equip goes to: a cash one (info/cash) covers the regular slot from its cash slot, 100 below. */
  /** A ring put on a ring slot of your choice (dragged onto its cell): the cash slot over it for a cash ring. */
  equipRing(slot, it, cell) {
    if (this.dead) { this.windows.notice("You can't do it once you're dead."); return; }
    const cash = it.cash || !!this.windows?.info(it.id)?.cash, dst = cash ? cell - 100 : cell, clash = this.ringClash(it.id, dst, true);
    if (clash) { this.windows.notice(clash); return; }
    if (!this.canEquip(it.id)) { this.windows.notice('Your stats are too low to equip this item.'); return; }
    this.net.moveItem(1, slot, dst, 1);
  }
  /**
   * Putting on an equip from the inventory (double-click / drop), in this order: one of each Unique Equipped Item,
   * one couple / friendship / wedding ring, a cash weapon needs a weapon it has art for (and a weapon must suit the
   * cash weapon worn), a cash shield needs a shield, pet equipment needs its pet (petSlotRefusal), the requirements, a
   * cash taming mob / saddle needs a real one, and an item that can't be traded once worn asks first.
   */
  async equipChecked(slot, it, dst) {
    const id = it.id, cat = Math.floor(id / 10000), worn = this.inventory?.equipped || {}, info = this.windows?.info(id) || {};
    const refuse = (t) => { this.windows.notice(t); };
    if (Number(info.onlyEquip) && Object.values(worn).some((w) => w?.id === id)) return refuse('You can only be equipped with 1 Unique Equipped Item.');
    const clash = this.ringClash(id, dst);
    if (clash) return refuse(clash);
    const fits = async (cashWeapon, weapon) => !!(await this.assets.json(equipPath(cashWeapon)))?.[Math.floor(weapon / 10000) % 100];
    if (cat === 170) {
      if (!worn[-11]) return refuse('You need to equip yourself with an item\nto use it.');
      if (!(await fits(id, worn[-11].id))) return refuse("This item is not available with the weapon\nyou're currenly using.");
    } else if (dst === -11 && worn[-111] && !(await fits(worn[-111].id, id))) {
      return refuse("You may not use the item with the\ncash item you're currently equipped with.\nPlease unequip that item and try again.");
    }
    if (dst === -110 && !worn[-10]) return refuse('You are able to use this only\nwhen you are wearing a shield.');
    const petMsg = await this.petSlotRefusal(id, dst);
    if (petMsg) return refuse(petMsg);
    // an accessory is checked against the level of the pet it goes on
    const acc = cat === 180 && id !== 1802100, ai = PET_SLOTS.findIndex((s) => s.acc === dst), accPet = ai >= 0 ? this.petsOf(this.player.id)[ai] : null;
    const wears = acc && (await this.petWears(id, accPet));
    if ((acc && !wears) || !this.canEquip(id, wears ? this.petLevel(accPet) : undefined)) {
      return refuse(acc && !wears ? 'This item cannot be equipped with your current pet.' : 'Your stats are too low to equip this item.');
    }
    if (dst === -118 && !worn[-18]) return refuse('You must have a tamed monster\nin order to equip this.');
    if (dst === -119 && !worn[-19]) return refuse('You must be equipped with a saddle\nto equip this.');
    if (Number(info.equipTradeBlock) && !(it.flag & 0x08) && !(await this.windows.confirm("You cannot trade this item after equipping.\n Do you still wish to equip?"))) return;
    this.net.moveItem(1, slot, dst, 1);
  }
  /**
   * Only one couple ring, one friendship ring and one wedding ring can be worn: the refusal, or null. Put on by
   * double-click, couple / friendship rings are checked against the cash ring slots and a wedding ring against the
   * other normal ring slots; dragged onto a cell, all against the cash ring slots, the target cell included, so a
   * worn couple / friendship ring can't be swapped for another.
   */
  ringClash(id, dst, dragged = false) {
    const kind = (x) => (Math.floor(x / 100) === 11120 && x !== 1112000 ? 'couple'
      : Math.floor(x / 100) === 11128 && x % 10 < 3 ? 'friend' : WEDDING_RINGS.includes(x) ? 'wedding' : null);
    const k = kind(id), worn = this.inventory?.equipped || {}, CASH = [-112, -113, -115, -116];
    if (!k) return null;
    const slots = dragged || k !== 'wedding' ? CASH : [-12, -13, -15, -16].filter((s) => s !== dst);
    if (!slots.some((s) => worn[s] && kind(worn[s].id) === k)) return null;
    return { couple: 'Only one couple-ring can be equipped.', friend: 'You may only equip\none Friendship Ring at a time.', wedding: 'You may only equip ONE wedding ring.' }[k];
  }
  equipDest(id, cash = !!this.windows?.info(id)?.cash) {
    // a ring takes the first free one of the four ring slots (12, 13, 15, 16); with all four worn it can't go on
    if (Math.floor(id / 10000) === 111) {
      const worn = this.inventory?.equipped || {};
      for (const s of [12, 13, 15, 16]) { const d = -(s + (cash ? 100 : 0)); if (!worn[d]) return d; }
      return null;
    }
    const dst = equipSlotFor(id);
    return dst && cash && dst > -100 ? dst - 100 : dst;
  }
  /**
   * Whether you can wear an item: its gender, its level, STR, DEX, INT, LUK and fame requirements (against
   * equipStats) and its jobs (reqJob: 0 anyone, -1 beginners, else a bit per branch: 1 warrior, 2 magician, 4 bowman,
   * 8 thief, 16 pirate). A GM (jobs 800 / 900) can wear anything.
   */
  canEquip(id, level) {
    const s = this.stats, info = this.windows?.info(id);
    if (!s || !info) return true;
    const branch = Math.floor((s.job % 1000) / 100);
    if (branch === 8 || branch === 9) return true;
    const g = Math.floor(id / 1000) % 10, gender = Math.floor(id / 1000000) === 1 && g < 2 ? g : 2;
    if (s.gender !== 2 && gender !== 2 && gender !== s.gender) return false;
    const have = this.equipStats(id);
    if (level !== undefined) have.level = level;
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
    if (!scroll || !eq || !isScroll(scroll.id)) return;
    if (this.dead) { this.notice("You can't do it once you're dead."); return; }
    if (equipSlot > 0 && !(this.skills?.level(1003) > 0)) { this.notice('Scrolls can only be used on equipped items.'); return; }
    const sid = scroll.id, modifier = Math.floor(sid / 1000) === 2049;
    if (!scrollFits(sid, eq.id)) { this.notice('This scroll cannot be used on this item.'); return; }
    if (!modifier && !(eq.slots > 0)) { this.notice('This item has no upgrades available.'); return; }
    if (eq.flag & 1 && !(await this.windows.confirm('Due to the potency of the scroll,\r\nthe sealed item might be destroyed.\r\nAre you sure you still want to use the scroll?'))) return;
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
    dmgs.forEach((d, line) => this.hitSound(sm.skill, mob, d, line));
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
  /**
   * [MapleTip] lines (yellow): every 12 s the first Etc/Tips.img/info row for your level and job group is checked;
   * once its interval has passed since the last tip, its `all` percent picks a tip from `all`, else from its own list.
   */
  mapleTip() {
    const now = performance.now(), s = this.stats;
    if (!s || now < (this.tipCheckAt ??= now + 12000)) return;
    this.tipCheckAt = now + 12000;
    if (!this.tips) { this.tips = 'loading'; this.assets.json('Etc/Tips.img').then((t) => { this.tips = t || {}; }); return; }
    if (this.tips === 'loading') return;
    const group = Math.floor((s.job % 1000) / 100), bit = 2 ** ((group - 1 + 32) % 32);
    const row = Object.values(this.tips.info || {}).find((r) => s.level >= r.levelMin && s.level <= r.levelMax
      && (r.job === undefined || (Number(r.job) & bit) !== 0));
    if (!row || now - (this.lastTipAt ?? -Infinity) < (row.interval || 0)) return;
    const list = Object.values((Math.random() * 100 < (row.all || 0) ? this.tips.all : this.tips[row.tip]) || {});
    if (!list.length) return;
    this.lastTipAt = now;
    this.hud.message(`[MapleTip] ${list[Math.floor(Math.random() * list.length)]}`, CHAT_COLOR.yellow);
  }
  // ------------------------------------------------------------------ exclusive requests
  /**
   * Requests the server answers before another may go (return scrolls, skill books...): nothing may be waiting
   * for an answer, you must be alive (unless ignoreHp), and at least `ms` must have passed since the last one was
   * sent or answered. A stat change or inventory operation flagged as the answer, or the request's own result,
   * frees it again.
   */
  canExclusive(ms, ignoreHp = false) {
    const x = this.excl ??= { busy: false, at: -Infinity };
    return !x.busy && (ignoreHp || (this.stats?.hp ?? 0) > 0) && performance.now() - x.at >= ms;
  }
  lockExclusive() { this.excl = { busy: true, at: performance.now() }; }
  /**
   * End an item's buff early (right-click its icon). Like the other requests it waits for an answer pending (200ms
   * apart, alive), but takes no lock. While transformed, a morph potion (221) marked noCancelMouse refuses.
   */
  async cancelItemEffect(itemId) {
    if (!this.canExclusive(200)) return;
    if (Math.floor(itemId / 10000) === 221 && this.morphed() && Number((await itemInfo(this.assets, itemId))?.noCancelMouse)) {
      this.hud.message('You may not cancel the transformation.', CHAT_COLOR.error);
      return;
    }
    this.net?.cancelItemEffect(itemId);
  }
  /** Transformed: a buff with the Morph stat is on. */
  morphed() {
    const now = Date.now();
    return (this.buffs || []).some((b) => b.until > now && (BigInt.asUintN(64, BigInt(b.m2 ?? 0)) & MORPH) !== 0n);
  }
  releaseExclusive() { this.excl = { busy: false, at: performance.now() }; }

  /** Map id prefix (map / 10,000,000) -> area, from Map/Map/AreaCode.img. */
  async areaCodes() {
    if (!this._areaCodes) {
      const n = await this.assets.json('Map/Map/AreaCode.img');
      this._areaCodes = new Map(Object.entries(n || {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [Number(k), Number(v)]));
    }
    return this._areaCodes;
  }
  /**
   * Whether a return scroll may take you from one map to another: never to or from the 9xxxxxxx-style event maps
   * ((id / 1,000,000) % 100 === 9) or 20009xxxx, and only within the same area of AreaCode.img.
   */
  async sameArea(from, to) {
    if (Math.floor(from / 1000000) % 100 === 9 || Math.floor(to / 1000000) % 100 === 9) return false;
    if (Math.floor(from / 10000) === 20009 || Math.floor(to / 10000) === 20009) return false;
    const codes = await this.areaCodes(), a = codes.get(Math.floor(from / 10000000)), b = codes.get(Math.floor(to / 10000000));
    return a !== undefined && b !== undefined && a === b;
  }

  /**
   * A return scroll (203xxxx): spec/moveTo (999999999: the nearest town) and spec/ignoreContinent. A map whose
   * fieldLimit has 0x20 refuses all of them, and 0x100 those with a set destination; a set destination elsewhere
   * in the world needs ignoreContinent. Then USE_RETURN_SCROLL, as an exclusive request (500ms apart).
   */
  async useReturnScroll(slot, id) {
    if (!this.canExclusive(500)) return;
    const spec = await itemSpec(this.assets, id) || {};
    const moveTo = Number(spec.moveTo ?? 999999999), ignoreContinent = Number(spec.ignoreContinent) || 0;
    const limit = this.map?.info?.fieldLimit || 0;
    if (limit & 0x20 || (moveTo !== 999999999 && limit & 0x100)) { this.windows.notice("You can't use it here in this map."); return; }
    if (moveTo !== 999999999 && !ignoreContinent && !(await this.sameArea(this.map?.id ?? 0, moveTo))) { this.windows.notice('You cannot go to that place.'); return; }
    if (!this.canExclusive(500)) return;
    this.net.useReturnScroll(slot, id);
    this.lockExclusive();
    sfx.play(`Item/${pad(id, 8)}/Use`);
  }

  /**
   * The inventory's Gather (ITEM_SORT) and Sort (ITEM_SORT2) buttons, for tabs 1-5: not while dead or under a
   * dialog, as an exclusive request (500ms apart).
   */
  gatherItems(tab) { this.sortRequest(tab, () => this.net.itemGather(tab)); }
  sortItems(tab) { this.sortRequest(tab, () => this.net.itemSort(tab)); }
  sortRequest(tab, send) {
    if (tab < 1 || tab > 5 || this.dead || this.windows?.modal || !this.canExclusive(500)) return;
    send();
    this.lockExclusive();
  }

  /**
   * A Use item, routed as the v83 client does: a reward box (an item with a reward list) opens with
   * USE_ITEM_REWARD; then by type 203 return scroll, 210 summoning sack, 226 mount food, 228/229 skill book,
   * 243 scripted item; anything else goes as USE_ITEM.
   */
  async useConsume(slot, id) {
    const type = Math.floor(id / 10000);
    if (await itemReward(this.assets, id)) { this.useItemReward(slot, id); return; }
    if (type === 237) { this.useSolomonItem(slot, id); return; }
    if (type === 203) { this.useReturnScroll(slot, id); return; }
    if (type === 210) { this.useSummonBag(slot, id); return; }
    if (type === 232) { if (this.canExclusive(200)) this.openRock(slot, id); return; }
    if (type === 226) { this.useMountFood(slot, id); return; }
    if (type === 228 || type === 229) { this.useSkillBook(slot, id); return; }
    // only these Use types are used with a plain USE_ITEM, once nothing is waiting (200ms apart); the Maplemas Party
    // Potion (221x2xxx) opens its own window, not built yet; other types without a route of their own do nothing
    if (!USE_ROUTED.has(type)) {
      if (!PLAIN_USE.has(type) || (type === 221 && Math.floor((id % 10000) / 1000) === 2) || !this.canExclusive(200)) return;
    }
    if (type === 243) { this.useScriptedItem(slot, id); return; }
    if (type === 227) { this.useCatchItem(slot, id); return; }
    this.net.useItem(slot, id); sfx.play(`Item/${pad(id, 8)}/Use`);   // Sound/Item.img: a potion's gulp...
  }

  /**
   * A catch item (227xxxx: jars, Element Rock, nets...): not while riding a tamed monster. The item's info names
   * the monster (mob), what it turns into (create) and a box around you (left/top/right/bottom). There must be room
   * for create (a free slot, or a stack of it under its slotMax, 100 if unset); then the first living monster of
   * that kind whose body touches the box is the target. With none, bridleMsgType picks the message: 0 no tamable
   * monster here, 1 the ghost is too far, 2 the monster is too far, 3 the item's nomobMsg. Then USE_CATCH_ITEM, as
   * an exclusive request (200ms apart).
   */
  async useCatchItem(slot, id) {
    if (Math.floor((this.riding?.item || 0) / 10000) === 190) return;
    if (!this.canExclusive(200)) return;
    const info = await itemInfo(this.assets, id);
    if (!info) return;
    const create = Number(info.create) || 0, t = invType(create), inv = this.inventory?.[t] || {};
    const limit = this.inventory?.limits?.[t] || 24;
    let room = false;
    if (t === 1) {
      for (let s = 1; s <= limit && !room; s++) room = !inv[s];
      if (!room) { this.hud.message('You do not have enough slots in your item inventory.', CHAT_COLOR.error); return; }
    } else {
      const max = Number((await itemInfo(this.assets, create))?.slotMax) || 100;
      for (let s = 1; s <= limit && !room; s++) room = !inv[s] || (inv[s].id === create && (inv[s].quantity ?? 1) < max);
      if (!room) {
        this.hud.message(`${{ 2: 'Use', 3: 'Setup', 4: 'Etc' }[t] || ''} item inventory is full.`, CHAT_COLOR.error);
        return;
      }
    }
    const p = this.player, n = (k) => Number(info[k]) || 0;
    const area = { left: p.x + n('left'), top: p.y + n('top'), right: p.x + n('right'), bottom: p.y + n('bottom') };
    const mobId = n('mob');
    const target = this.map.life.find((m) => {
      if (m.kind !== 'Mob' || !m.alive || m.dying || Number(m.spawn?.id) !== mobId) return false;
      const b = m.hitBox();
      return b.left < area.right && area.left < b.right && b.top < area.bottom && area.top < b.bottom;
    });
    if (!target) {
      const type = n('bridleMsgType');
      const msg = type === 0 ? 'Unable to find a tamable monster in this area.'
        : type === 1 ? 'Unable to capture the monster; the ghost is too far.'
          : type === 2 ? 'Unable to capture the monster; the monster is too far.'
            : type === 3 ? info.nomobMsg : '';
      if (msg) this.hud.message(msg, CHAT_COLOR.error);
      return;
    }
    this.net.useCatchItem(slot, id, target.oid);
    this.lockExclusive();
  }

  /** A reward box: USE_ITEM_REWARD (slot, item), as an exclusive request (200ms apart). */
  useItemReward(slot, id) {
    if (!this.canExclusive(200)) return;
    this.net.useItemReward(slot, id);
    this.lockExclusive();
  }

  /**
   * A Writ of Solomon (237xxxx) stores EXP to charge later. Not while riding a tamed monster; nothing below the
   * item's reqLevel; "too high" above its maxLevel; and only once the EXP from the last one is used up. Then
   * USE_SOLOMON_ITEM, as an exclusive request (500ms apart).
   */
  async useSolomonItem(slot, id) {
    const say = (t) => this.hud.message(t, CHAT_COLOR.error);
    if (Math.floor((this.riding?.item || 0) / 10000) === 190) { say('Not available while riding on the tamed monster.'); return; }
    const info = await itemInfo(this.assets, id), level = this.stats?.level || 0;
    if (level < (Number(info?.reqLevel) || 0)) return;
    if ((Number(info?.maxLevel) || 0) < level) { say('Your level is too high to use the selected item.'); return; }
    if (this.stats?.gachaExp) { say("You'll need to use all your remaining EXP in order to use a new Writ of Solomon."); return; }
    if (!this.canExclusive(500)) return;
    this.net.useSolomonItem(slot, id);
    this.lockExclusive();
  }
  /**
   * Clicking the EXP gauge below level 51 with EXP stored from Writs of Solomon asks whether to charge it, then
   * sends USE_GACHA_EXP (not while riding a tamed monster; an exclusive request, 500ms apart). Returns whether the
   * click was taken.
   */
  chargeGachaExp() {
    const level = this.stats?.level || 0;
    if (level >= 51 || !(this.stats?.gachaExp > 0)) return false;
    this.windows.confirm('Do you wish to charge the EXP \r\nearned from The Writs of Solomon?').then((yes) => {
      if (!yes) return;
      if (Math.floor((this.riding?.item || 0) / 10000) === 190) { this.hud.message('Not available while riding on the tamed monster.', CHAT_COLOR.error); return; }
      if ((this.stats?.level || 0) >= 51) { this.hud.message('Your level is too high to use the selected item.', CHAT_COLOR.error); return; }
      if (!this.canExclusive(500)) return;
      this.net.useGachaExp();
      this.lockExclusive();
    });
    return true;
  }

  /**
   * Whether you are riding (a 190xxxx monster or a 193xxxx vehicle), saying so in chat as the client does: such
   * items can't be used then.
   */
  ridingRefusal() {
    const type = Math.floor((this.riding?.item || 0) / 10000);
    if (type === 190) { this.hud.message('Not available while riding on the tamed monster.', CHAT_COLOR.error); return true; }
    if (type === 193) { this.hud.message('Not available during the ride.', CHAT_COLOR.error); return true; }
    return false;
  }

  /**
   * A summoning sack (210xxxx): not while riding. Unless you are a GM: on a map whose fieldLimit has 0x4 it must be
   * in the map's info/allowedItem ("You can't use it here in this map."), and anything but the 2109xxx sacks and
   * 2100067 asks first whether to summon. Then USE_SUMMON_BAG, as an exclusive request (500ms, then 200ms apart).
   */
  async useSummonBag(slot, id) {
    if (!this.canExclusive(500) || this.ridingRefusal()) return;
    if (!this.gm) {
      const allowed = Object.values(this.map?.info?.allowedItem || {}).map(Number);
      if ((this.map?.info?.fieldLimit || 0) & 0x4 && !allowed.includes(id)) { this.windows.notice("You can't use it here in this map."); return; }
      if (Math.floor(id / 1000) !== 2109 && id !== 2100067
        && !(await this.windows.confirm('Too much interest can hinder your process of leveling up.\r\n\r\nwill you really summon the monster?'))) return;
    }
    if (!this.canExclusive(200)) return;
    this.net.useSummonBag(slot, id);
    this.lockExclusive();
  }

  /** Mount food (226xxxx): only while riding a 190xxxx monster; USE_MOUNT_FOOD, as an exclusive request (200ms apart). */
  useMountFood(slot, id) {
    if (Math.floor((this.riding?.item || 0) / 10000) !== 190 || !this.canExclusive(200)) return;
    this.net.useMountFood(slot, id);
    this.lockExclusive();
  }

  /** A scripted item (243xxxx): SCRIPTED_ITEM, as an exclusive request (500ms apart). */
  useScriptedItem(slot, id) {
    if (!this.canExclusive(500)) return;
    this.net.useScriptedItem(slot, id);
    this.lockExclusive();
  }

  /** A skill book (228xxxx) or mastery book (229xxxx): USE_SKILL_BOOK, as an exclusive request (200ms apart). */
  useSkillBook(slot, id) {
    if (!this.canExclusive(200)) return;
    this.net.useSkillBook(slot, id);
    this.lockExclusive();
  }

  /**
   * SKILL_LEARN_ITEM_RESULT: a book that could be used shows SkillBook/Success or Failure (layers 0 and 1) on whoever
   * read it. Your own frees the exclusive request, plays Game/EnchantSuccess or EnchantFailure and says how it went.
   */
  onSkillBookResult({ id, mastery, canUse, success }) {
    const me = id === this.player.id, ent = me ? this.player : this.others.get(id);
    if (!ent) return;
    if (canUse) for (const layer of [0, 1]) this.vfx?.playPath(`Effect/BasicEff.img/SkillBook/${success ? 'Success' : 'Failure'}/${layer}`, ent);
    if (!me) return;
    this.releaseExclusive();
    sfx.play(`Game/${success ? 'EnchantSuccess' : 'EnchantFailure'}`);
    const book = mastery ? 'Mastery Book' : 'Skill Book';
    const text = !canUse ? `You cannot use ${book}.`
      : !success ? `Despite using ${book}, the effect was nowhere to be found.`
      : mastery ? 'The Book of Mastery glows brightly, and the current skills have gone through an upgrade.'
      : 'The Skill Book glows brightly, and new skills have now been added.';
    this.hud.message(text, CHAT_COLOR.error);
  }

  /** FAME_RESPONSE lines, all light red. */
  onFame(f) {
    const me = this.player.name, say = (t) => this.hud.message(t, CHAT_COLOR.error);
    if (f.mode === 0) {
      say(f.up ? `You have raised '${f.name}''s level of fame.` : `You have dropped '${f.name}''s level of fame.`);
      // the open info window takes the new fame (On_FAME_RESPONSE__sub sets its +0x670)
      if (this.infoWin) this.infoWin.setFame(f.fame);
    }
    else if (f.mode === 5) say(f.up ? `'${f.name}' have raised '${me}''s level of fame.` : `'${f.name}' have dropped '${me}''s level of fame.`);
    else say({ 1: 'The user name is incorrectly entered.', 2: 'Users under level 15 are unable to toggle with fame.',
      3: "You can't raise or drop a level of fame anymore for today.", 4: "You can't raise or drop a level of fame of that character anymore for this month." }[f.mode]
      || 'The level of fame has neither been raised or dropped due to an unexpected error.');
  }
  /** Every hour after logging in, how long you have played (from the third, with a suggestion to rest). */
  playTimeNote() {
    if (!this.playHourAt || performance.now() < this.playHourAt) return;
    const h = this.playHours;
    this.hud.message(`You have played MapleStory for ${h} hour(s).`, CHAT_COLOR.error);
    if (h >= 3) this.hud.message('We suggest you take a break from Mapling.', CHAT_COLOR.error);
    this.playHourAt += 3600000; this.playHours = h + 1;
  }
  /** Laughing or crying words in your own line show on your face. */
  chatFace(text) {
    const t = text.toLowerCase();
    if (/haha|hoho|hehe|harhar|wahaha/.test(t)) this.emote(2);
    else if (/sob|tears|cry|sniff/.test(t)) this.emote(4);
  }
  /** The Game Option switches for buddy and guild chat. */
  chatAllowed(mode) {
    let allow = {};
    try { allow = JSON.parse(localStorage.getItem('maple.gameopt') || '{}'); } catch { allow = {}; }
    return !(mode === 0 && allow.friends === false) && !(mode === 2 && allow.guildChat === false);
  }
  /** A Game Option switch (on unless turned off). */
  optionAllowed(key) {
    try { return JSON.parse(localStorage.getItem('maple.gameopt') || '{}')[key] !== false; } catch { return true; }
  }
  sendChat(text) {
    if (!this.net) { this.player.chat = { text, t: 5 }; return; }
    let m = text.match(/^\/(?:w|whisper)\s+(\S+)\s+(.+)$/i);
    if (m) { this.whisperTo(m[1], m[2]); return; }
    m = text.match(/^\/r\s+(.+)$/i);
    if (m) { if (this.lastWhisperFrom) this.whisperTo(this.lastWhisperFrom, m[1]); else this.hud.message('There is no whisper to reply to.', CHAT_COLORS.notice); return; }
    m = text.match(/^\/find\s+(\S+)$/i);
    if (m) { this.net.find(m[1]); return; }
    m = text.match(/^\/pet\s+(.+)$/i);
    if (m) { this.petTalk(m[1]); return; }
    if (!text.startsWith('/')) { this.petCommandWord(text); this.chatFace(text); }   // your pets hear every line
    // the chat target from the drop-up list beside the chat line
    const target = this.statusBar?.chatTarget || 'all', note = (t) => this.hud.message(t, CHAT_COLORS.notice);
    if (target === 'all' || text.startsWith('!')) { this.net.chat(text); return; }
    if (target === 'whisper') { const to = this.statusBar.whisperTo; if (to) this.whisperTo(to, text); else note('There is no one to whisper to.'); return; }
    if (target === 'spouse') { this.net.spouseChat(text); return; }
    const mode = { buddy: 0, group: 0, party: 1, guild: 2, alliance: 3 }[target];
    if (mode === 1 && !this.party) { note("Either the party doesn't exist or no member of your party is logged on."); return; }
    if (mode === 2 && !this.guild) { note('You are not in a guild yet or none of your guild member is online.'); return; }
    if (mode === 3 && !this.guild) { note('There are no guild alliance you joined OR no one online in your guild alliance.'); return; }
    if (mode === 0) {
      // buddy chat reaches the buddies online (To Group: those in the group picked on the Buddy tab), not blocked ones
      const ul = this.windows.wins.userlist, group = target === 'group' ? this.statusBar.chatGroup : null;
      const ids = (this.buddies || []).filter((b) => b.channel >= 0 && !b.pending && !ul?.isBlocked(b) && (!group || (b.group || 'Default Group') === group)).map((b) => b.id);
      if (!ids.length) { note('You have no buddy available for chat.'); return; }
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
    const member = (id) => g?.members.find((m) => m.id === id), master = g?.members[0]?.id === me;
    switch (d.kind) {
      case 'askName': this.askGuildName(); break;
      case 'agreement':
        if (this.party?.leader === me) { heracleSays(this.windows, 'Now I am asking other guild members for the agreement of forming a guild~ Please hold on~...'); break; }
        this.showModal(new GuildContractWin(this.windows, d.master, d.name, (ok) => this.net.guildAgree(ok)));
        break;
      case 'invite': {
        // refused at once with guild invites off, from someone on the Blacklist (0x35) or while another is up (0x36)
        const busy = this.windows.order.some((w) => w.kind === 'guild');
        if (busy || !this.optionAllowed('guildInvite') || this.windows.wins.userlist?.blacklisted(d.from)) { this.net.guildDeny(d.from, busy ? 0x36 : 0x35, this.player.name); break; }
        notify(this.windows, 'guild', d.from)
          .then((ok) => (ok ? this.net.guildOp(6, d.id, me) : this.net.guildDeny(d.from, 0x37, this.player.name)));
        break;
      }
      case 'info': this.guild = d.guild; break;
      case 'join':
        if (d.member.id === me) { msg('You have entered the guild.'); this.net.guildOp(0); break; }
        if (!g) break;
        g.members = [...g.members.filter((m) => m.id !== d.member.id), d.member];
        msg(`'${d.member.name}' has joined the guild.`);
        break;
      case 'leave': case 'expel':
        if (d.id === me) { this.guild = null; msg(d.kind === 'expel' ? 'You have been expelled from the guild.' : 'You have quit the guild.'); break; }
        if (g) g.members = g.members.filter((m) => m.id !== d.id);
        if (d.kind === 'leave') msg(`'${d.name}' quitted the guild.`);
        else msg(d.name ? `'${d.name}' has been expelled from the guild.` : 'Deleted Chracters have been expelled.');
        break;
      case 'disband':
        this.guild = null;
        if (master) heracleSays(this.windows, 'The guild has been disbanded..  Please come back to me when you want to make a guild, again..');
        else msg('The guild has been disbanded.');
        break;
      case 'capacity':
        if (g) g.capacity = d.capacity;
        if (master) heracleSays(this.windows, `Congratulation~  The number of guld members has now increased to ${d.capacity} ...  Please come back to me whenever you need to..`);
        break;
      case 'levelJob': { const m = member(d.id); if (m) Object.assign(m, { level: d.level, job: d.job }); break; }
      case 'online': { const m = member(d.id); if (m) { m.online = d.online; if (d.online && d.id !== me) notifyLogin(this.windows, m.name); } break; }
      case 'ranks': if (g) { g.ranks = d.ranks; if (master) this.windows.notice('It is saved.'); } break;
      case 'rank': { const m = member(d.id); if (m) { m.rank = d.rank; msg(`[${m.name}]'s position has been changed to [${g.ranks[d.rank - 1] || ''}].`); } break; }
      case 'emblem': if (g) { g.emblem = d.emblem; if (master) this.windows.notice('It is completed.'); } break;
      case 'notice': if (g) { g.notice = d.notice; if (d.notice) msg(`* Guild Notice : ${d.notice}`); } break;
      case 'gp': if (g) g.gp = d.gp; break;
      case 'makeMark':
        if (master) this.showModal(new GuildMarkWin(this.windows, g.emblem, (e) => { if (e) this.net.guildEmblem(e); }));
        break;
      case 'gpqQueue': {
        const ch = String(d.channel);
        msg(d.pos === 1 ? `Please go see the Guild Quest NPC at Channel ${ch} immediately to enter.`
          : d.pos === 2 ? `Your guild is up next. Please head to the Guild Quest map at Channel ${ch} and wait.`
            : `There's currently 1 guild participating in the Guild Quest, and your guild is number ${d.pos - 1} on the waitlist.`);
        break;
      }
      case 'message': {
        if (d.code === 0x1C) { heracleSays(this.windows, 'The name is already in use... Please try other ones....').then(() => this.askGuildName()); break; }
        if (d.code === 0x4E) { msg(d.ok && d.text ? d.text : GUILD_ERROR); break; }
        const [how, t] = GUILD_MESSAGES[d.code] || ['chat', GUILD_ERROR];
        if (how === 'npc') heracleSays(this.windows, t); else msg(t.replace('%s', d.name));
        break;
      }
      default: break;
    }
  }
  /** Heracle's guild name prompt: 4-12 characters; Cancel sends nothing. */
  askGuildName() {
    this.windows.askText('Please type the name of the guild.', '', { max: 12 }).then((n) => {
      const name = n?.trim();
      if (name && name.length >= 4) this.net.guildOp(2, name);
    });
  }
  /** A modal window with its art loaded first. */
  showModal(w) { this.assets.preload(w.frames()).then(() => this.windows.show(w)); }

  /** PARTY_OPERATION results: keep this.party = { id, leader, members[] } in step with the server. */
  onParty(p) {
    const me = this.player.id, msg = (t) => this.hud.message(t, CHAT_COLORS.party);
    const keepHp = (members) => members.map((m) => ({ ...this.party?.members.find((o) => o.id === m.id), ...m }));
    if (p.kind === 'created') {
      this.party = { id: p.id, leader: me, members: [{ id: me, name: this.player.name, job: this.stats.job, level: this.stats.level, channel: this.channel, map: this.map?.id }] };
      msg('You have created a new party.');
    } else if (p.kind === 'update' || p.kind === 'join') {
      if (p.kind === 'join') msg(p.name === this.player.name ? 'You have joined the party.' : `'${p.name}' has joined the party.`);
      this.party = { id: p.id, leader: p.leader, members: keepHp(p.members) };
    } else if (p.kind === 'leave' || p.kind === 'expel') {
      const out = p.kind === 'expel';
      if (p.target === me) { this.party = null; msg(out ? 'You have been expelled from the party.' : 'You have left the party.'); }
      else { this.party = { id: p.id, leader: p.leader, members: keepHp(p.members) }; msg(out ? `'${p.name}' have been expelled from the party.` : `'${p.name}' have left the party.`); }
    } else if (p.kind === 'disband') {
      this.party = null; msg(p.target === me ? 'You have quit as the leader of the party. The party has been disbanded.' : 'You have left the party since the party leader quit.');
    } else if (p.kind === 'leader' && this.party) {
      this.party.leader = p.leader;
      const m = this.party.members.find((x) => x.id === p.leader);
      if (m) msg(p.reason ? `Due to the party leader disconnecting from the game, ${m.name} has been assigned as the new leader.` : `\t${m.name} has become the leader of the party.`);
    } else if (p.kind === 'levelJob') {
      const m = this.party?.members.find((x) => x.id === p.id);
      if (m) Object.assign(m, { level: p.level, job: p.job });
    }
    this.windows.wins.partyhp?.sync();
    this.windows.wins.partysearch?.partyChanged();
  }

  whisperTo(name, text) {
    this.pendingWhisper = { name, text };
    this.net.whisper(name, text);
  }
  onWhisper(w) {
    this.lastWhisperFrom = w.from;
    const ch = w.channel === this.channel ? '' : `[${this.channelNames?.[w.channel] || `Ch. ${w.channel + 1}`}]`;
    this.hud.message(`${w.from}${ch}>> ${w.text}`, CHAT_COLORS.whisper);
  }
  onWhisperResult(r) {
    const p = this.pendingWhisper;
    if (r.ok && p) this.hud.message(`${r.to}<< ${p.text}`, CHAT_COLORS.whisper);
    else if (!r.ok) this.hud.message(`Unable to find '${r.to}'`, CHAT_COLORS.notice);
    this.pendingWhisper = null;
  }
  async onFindResult(f) {
    if (f.buddy) { this.windows.wins.userlist?.located(f); return; }
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
    this.net.npcReply(d.wire ?? d.type, r.action, r.sel);
  }

  // ------------------------------------------------------------------ loop
  /**
   * A hidden browser tab gets no frames, but MOVE_PLAYER / MOVE_PET / MOVE_SUMMON / MOVE_MONSTER keep arriving and
   * queue. The v83 client keeps running in the background and times a path against the current time,
   * so what came in meanwhile has already played when you look. Play the missed time through
   * every queued path at once, in 50ms steps, until it is used up or nothing is left to play.
   */
  catchUpPaths(sec) {
    const STEP = 0.05;
    for (let t = 0; t < sec; t += STEP) {
      let any = false;
      for (const rp of this.others.values()) if (rp.path) { rp.update(STEP); any = true; }
      for (const pet of this.pets.values()) if (!pet.mine && pet.path) { pet.replay(STEP); any = true; }
      for (const sm of this.summons.values()) if (sm.path) { sm.replay(STEP); any = true; }
      for (const m of this.map?.life || []) if (m.path && m.online && !m.controlled && m._replay) { m._replay(STEP); any = true; }
      if (!any) break;
    }
  }
  start() {
    let last = performance.now();
    const loop = (t) => {
      // the next frame is booked first: an error in one frame must never stop the game for good
      requestAnimationFrame(loop);
      const gap = (t - last) / 1000, dt = Math.min(gap, 0.05);
      last = t;
      if (this.map && !this.loading) {
        try { if (gap > 0.25) this.catchUpPaths(gap - dt); this.update(dt); this.render(); } catch (e) {
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
    this.padInput?.poll();
    if (this.inCashShop) { this.windows?.update(dt); return; }   // the shop screen is all there is
    if (this.uiLocked || this.uiDisabled) { const i = this.input; i.down.clear(); i.pressed.clear(); i.repeats.clear(); i.clicks.length = 0; }
    if (this.direction) { this.direction.update(dt); if (this.direction.done) this.direction = null; }
    this.map.update(dt);
    this.map.updateHidden(this.player.x, this.player.y);
    this.statusBar?.update(dt);
    this.windows?.update(dt);
    this.vfx?.update(dt);
    this.weather.update(dt);
    this.questAlert?.update(dt * 1000); this.questAlert?.tick();
    this.map.life = this.map.life.filter((e) => !e.removed);
    if (this.reactors) for (const [oid, r] of this.reactors) { r.update(dt); if (r.removed) this.reactors.delete(oid); }
    this.updateDiseases(dt);
    this.updateAranCombo(dt);
    (this.dojo ??= new DojoWindow(this)).update(dt);
    if (this.net) this.autoAggro();
    if (this.net) this.friendlyMobHit();
    if (this.net) this.touchReactors();
    if (this.net) this.obstaclesHitMobs();
    if (this.fade?.dir === 'out' || this.dead) this.pendingSkill = 0;   // a skill clicked as a ghost isn't kept for later
    if (this.fade?.dir !== 'out') { if (this.dead) this.updateDeadBody(dt); else this.updatePlayer(dt); }   // you stand still while the old map goes dark
    for (const rp of this.others.values()) { rp.update(dt); this.watchDeath(rp); stepExpression(rp, rp.look, dt); this.stepItemFx(rp, dt); this.stepEquipFx(rp, rp.look, dt); }
    stepExpression(this.player, this.look, dt);
    this.stepItemFx(this.player, dt);
    this.stepEquipFx(this.player, this.look, dt);
    this.updateRingFx(dt);
    if (this.player.fh) this.ownerGroup = this.player.fh.group;
    for (const pet of this.pets.values()) pet.update(dt);
    for (const [oid, sm] of this.summons) { sm.update(dt); if (sm.gone) this.summons.delete(oid); }
    if (this.net) { this.petLootStep(dt); this.petRestCheck(dt); }
    if (this.player.chat && (this.player.chat.t -= dt) <= 0) this.player.chat = null;
    this.updateDrops(dt);
    this.updateFx(dt);
    this.runTimers(dt);
    if (this.skillLoop && !this.skillLoop.held()) { this.skillLoop.stop(); this.skillLoop = null; }
    this.playTimeNote();
    this.mapleTip();
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
    // Endure: more HP and MP a tick, and HP on a ladder or rope every its time seconds
    const endure = [4100002, 4200001].map((id) => this.skills?.level(id) && this.skills.levelData(id)).find(Boolean) || null;
    const climbing = !!p.ladder && !!endure;
    this.hpRegenT = still || climbing ? (this.hpRegenT || 0) + dt : 0;
    this.mpRegenT = (this.mpRegenT || 0) + dt;
    const k = Number(this.map?.info?.recovery) || 1;
    const maxHp = this.maxHpShown(), maxMp = this.maxMpShown();   // the server heals up to the same buffed max
    let hp = 0, mp = 0;
    const mage = Math.floor(((s.job || 0) % 1000) / 100) === 2;
    if (this.hpRegenT >= (climbing ? endure.time || 10 : 10)) { this.hpRegenT = 0; hp = s.hp < maxHp ? Math.min(Math.trunc((10 + (endure?.hp || 0)) * k), maxHp - s.hp) : 0; }
    if (this.mpRegenT >= 10) {
      this.mpRegenT = 0;
      const tick = mage ? 3 + Math.floor(s.int / 10) : 3 + (endure?.mp || 0);   // INT counts for a magician only
      mp = s.mp < maxMp ? Math.min(Math.trunc(tick * k), 100, maxMp - s.mp) : 0;
    }
    if (!hp && !mp) return;
    this.net.healOverTime(hp, mp);
    if (hp) this.vfx?.damage(p, [hp], 'blue');
  }

  /**
   * Drops:
   *   flight: Y = Ys - V*t + 400*t^2 (t in s, V = 400, or 720 for explosive drops) while X covers half the way
   *     in the first 500ms and the rest by the end; a destination below the source is then reached by falling
   *     straight down at V
   *   items (not mesos) spin a full turn every 300ms until they land
   *   resting: Y = Yg + 3*sin(phase), phase starting at 0 on landing and advancing pi per second
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
      if (d.expire !== undefined) {
        d.expire += dt; d.alpha = Math.max(0, 1 - d.expire);
        if (d.expire >= 1) this.drops.delete(oid);
        continue;
      }
      d.anim.update(dt * 1000);
      d.age += dt;
      if (d.pickedBy) {
        const L = d.pickedBy, u = Math.min(PICKUP_TIME, d.age), k = u / PICKUP_TIME, ms = u * 1000;
        const tx = L.x, ty = L.y - (L === this.player || this.others.has(L.id) ? 32 : 0);   // the middle of a character; a pet's feet
        d.cx = d.sx + (tx - d.sx) * k;
        d.cy = d.sy + (ty - d.sy) * k - 40 + ((ms - 350) ** 2 * 160) / 490000;
        d.alpha = ms < 420 ? 1 : (255 - ((ms - 420) * 192) / 280) / 255;
        if (d.age >= PICKUP_TIME) this.drops.delete(oid);
        continue;
      }
      if (d.landed) {
        d.phase += dt * Math.PI;
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
      } else if (t < d.flight) {
        const k = Math.min(1, t * 2) + (t > 0.5 ? Math.min(1, (t - 0.5) / (d.flight - 0.5)) : 0);
        d.cx = d.fromX + (d.x - d.fromX) * k / 2;
        d.cy = d.fromY - V * t + 400 * t * t;
      } else if (d.y > d.fromY) d.falling = true;
      else this.land(d);
      if (d.spin && !d.landed) d.angle += (2 * Math.PI / 0.3) * dt;
    }
  }
  land(d) { d.landed = true; d.falling = false; d.cx = d.x; d.cy = d.y; d.angle = 0; d.phase = 0; }

  /** A skill double-clicked in the skill window: used next frame as if its key were pressed. */
  clickSkill(id) { this.pendingSkill = id; }
  /** The skill a key (or a double-click this frame) starts now. */
  pressedSkill() {
    if (this.clickedSkill) { this.skillKeyPressed = true; return this.clickedSkill; }
    return this.heldSkill();
  }

  updatePlayer(dt) {
    this.clickedSkill = this.pendingSkill || 0; this.pendingSkill = 0;
    const p = this.player, map = this.map, fh = map.fh, inp = this.input, look = this.look;
    // a lone Ctrl or Alt held back in the Dojo goes through after 50ms
    if (this.dojoMod && performance.now() > this.dojoMod.t + 50) { const k = this.dojoMod.k; this.dojoMod = null; inp.inject(k, true); }
    // key commands see every press and release; one that takes a press keeps it from doing anything else
    this.commands ??= new KeyCommands(this);
    for (const e of inp.events.splice(0)) {
      const sc = COMMAND_SC[e.k] ?? CODE_TO_SC[e.k];
      if (sc !== undefined && this.commands.key(sc, e.down) && e.down) inp.pressed.delete(e.k);
    }
    let dir = (inp.is('right') ? 1 : 0) - (inp.is('left') ? 1 : 0);
    if (this.hasDisease(REVERSE)) dir = -dir;
    // stunned: no walking, jumping, climbing or attacking until it wears off (you still fall and slide to a stop)
    if (this.hasDisease(STUN)) {
      const hw = this.pressedSkill();   // Hero's Will still goes
      if (HEROS_WILLS.has(hw) && performance.now() >= (this.attackLock || 0) && this.useSkill(hw)) return;
      if (p.ladder) { p.attack = null; this.advanceFrame(p.ladder.l ? 'ladder' : 'rope', 0); return; }
      this.coast(dt);
      this.advanceFrame(p.fh ? look.standAction() : this.airAction(), dt);
      return;
    }
    const ms = this.moveStats(), JUMP = PHYS.jump * ms.jump;   // air steering stays unscaled
    const swim = map.swimming(p.x, p.y), WALK = PHYS.walk * ms.speed * (swim ? PHYS.swimDec : 1);
    const inY = (inp.is('down') ? 1 : 0) - (inp.is('up') ? 1 : 0);
    let action;
    if (p.ignoreT > 0 && (p.ignoreT -= dt) <= 0) p.ignoreFh = null;
    if (p.fh || p.ladder) this.fjUsed = false;   // Flash Jump comes back once you land
    if (this.portalCooldown > 0) this.portalCooldown -= dt;

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
        if (p.fh) p.vx = 0; else this.playerFall(dt, 0, 0, ms);
        this.advanceFrame(k.pose, dt);
        if (HURRICANES.has(k.id)) this.hurricaneShot(k);
        if (this.keydown) return;
      } else this.endKeydown();
    }

    // the pickup key works on ladders and ropes and mid-attack, not while seated
    if (this.net && !p.seat && this.pickupKey()) this.tryPickup();
    if (p.ladder) {
      const l = p.ladder;
      // a buff cast here plays ladder2 / rope2, and you hang still until it's over
      if (p.attack) { if (this.advanceFrame(p.attack, dt)) p.attack = null; return; }
      const skill = this.pressedSkill();   // only buffs go here (useSkill turns the rest down)
      if (skill && this.skills && performance.now() >= (this.attackLock || 0) && this.useSkill(skill)) return;
      const v = (inp.is('down') ? 1 : 0) - (inp.is('up') ? 1 : 0);
      p.vx = 0; p.vy = v * PHYS.climb;   // the speed sent while climbing
      const y0 = p.y;
      p.y += p.vy * dt;
      action = l.l ? 'ladder' : 'rope';
      const leaving = () => ({ fh: -(l.id || 0), stance: this.currentStance() });   // how you were on it, for those watching
      if (this.hitAction(ACTION.JUMP) && dir && !this.hasDisease(WEAKEN)) {
        const leave = leaving();
        p.ladder = null; p.vy = -JUMP * (swim ? 0.3 : 0.5); p.vx = dir * PHYS.walk * ms.speed * 1.3; p.facingRight = dir > 0;   // the client's ladder jump
        this.moveEvent = { kind: 'jump', vx: p.vx, vy: p.vy, leave };
        this.lastJumpDir = dir;
      } else if (v < 0 && p.y < l.y1) {
        // the top: off onto the floor above it when it has one (uf), else you stay at the top
        if (l.uf) { this.moveEvent = { kind: 'leave', leave: leaving() }; p.ladder = null; p.vy = 0; p.y = l.y1 - 5; } else { p.y = l.y1; p.vy = 0; }
      } else if (v > 0 && p.y > l.y2) {
        this.moveEvent = { kind: 'leave', leave: leaving() };
        p.ladder = null; p.vx = 0; p.vy = 0; p.y = l.y2 + 1;
      }
      this.advanceFrame(action, p.y !== y0 ? dt : 0);   // the frames only run while you move
      this.touchPortal();
      return;
    }

    if (p.attack) {
      action = p.attack;
      if (p.fh) p.vx = 0; else this.playerFall(dt, 0, 0, ms);
      if (this.advanceFrame(action, dt)) p.attack = null;
      return;
    }

    // seated (a map seat or a chair): moving, jumping, attacking or a skill stands you up; otherwise you stay put
    if (p.seat) {
      if (dir || this.holdAction(ACTION.JUMP) || this.holdAction(ACTION.ATTACK) || this.pressedSkill() || this.macroQueue?.length) this.standUp();
      else {
        this.advanceFrame('sit', dt);
        return;
      }
    } else if (this.hitAction(ACTION.SIT) && this.trySit()) { this.advanceFrame('sit', dt); return; }

    // wait out an attack cut short by a hit
    if (performance.now() >= (this.attackLock || 0)) {
      // a key command's queued skill, once the pose before it is over
      if (this.commands.run()) return;
      // a macro's next skill, once the last one's animation is over
      if (this.macroQueue?.length && !p.attack) {
        const id = this.macroQueue.shift();
        this.skillKeyPressed = true;
        const used = this.useSkill(id);
        this.skillKeyPressed = false;
        if (used) return;
      }
      const skill = this.pressedSkill();
      if (skill && this.skills) { if (this.useSkill(skill)) return; }
      if (this.holdAction(ACTION.ATTACK)) { this.attack(0); return; }
    }
    if (this.hitAction(ACTION.NPC_CHAT) && this.net) this.talkToNearestNpc();

    if (inp.hit('up') && p.fh && this.useDoorAt(p)) return;
    this.scriptTouch();
    this.touchPortal();
    if (p.fh && this.portalCooldown <= 0) {
      const portal = map.portalAt(p.x, p.y);
      // touch portals fire once on entry, not every frame you stand in them
      const touch = portal && TOUCH_PORTALS.has(portal.pt);
      const touched = touch && portal !== this.touchedPortal;
      this.touchedPortal = touch ? portal : null;
      if (portal && (inp.hit('up') || touched)) { this.usePortal(portal); if (!touched) return; }
    }
    // on the floor, up grabs a ladder / rope whose bottom is at most 20px above your feet (lifting you onto it), and
    // down one whose top is at most 10px below them; left / right may be held too
    if (p.fh && this.canClimb()) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (inp.is('up')) {
        const l = map.ladderIn(x, y - 20, x, y);
        if (l) { this.grab(l); p.y = Math.min(y, l.y2); return; }
      } else if (inp.is('down')) {
        const l = map.ladderIn(x, y, x, y + 10);
        if (l && l.y1 >= y && l.y1 <= y + 10) { this.grab(l); p.y = l.y1; return; }
      }
    }

    if (p.fh) {
      if (dir) p.facingRight = dir > 0;
      // holding jump keeps jumping: each landing jumps again (a down-jump still needs its own press); in water a jump
      // goes at most every 300ms
      if (!this.hasDisease(WEAKEN) && (this.hitAction(ACTION.JUMP) || (this.holdAction(ACTION.JUMP) && !inp.is('down'))) && this.swimJumpReady(swim)) {   // Weakness: no jumping
        if (inp.is('down')) {
          const below = fh.below(p.x, p.y + 1, Infinity, p.fh);   // any floor under us, however far down
          // a little hop first, then down through the floor: it stays ignored until we are well past it
          if (below) {
            this.moveEvent = { kind: 'down', ofh: p.fh.id, x: p.x, y: p.y };
            p.ignoreFh = p.fh; p.ignoreT = 0.45; p.fh = null; p.y = Math.floor(p.y - 1); p.vy = -JUMP * 0.35355339; p.vx = 0; sfx.play('Game/Jump');
          }
          else if (!dir) action = 'prone';   // nothing to drop to: stay lying down
        } else {
          // the client's jump: a direction adds 0.8 of the walk speed to what you already had, up to the walk speed
          p.vx ||= 0;
          const J = PHYS.walk * ms.speed;   // not slowed in water
          if (dir * p.vx < J * 0.8) p.vx += dir * J * 0.8;
          if (dir * p.vx > J) p.vx = dir * J;
          p.fh = null; p.y = Math.floor(p.y - 1); p.vy = -JUMP * (swim ? 0.7 : 1);   // leaving a floor lifts you 1px
          this.moveEvent = { kind: 'jump', vx: p.vx, vy: p.vy };
          sfx.play('Game/Jump');
        }
      } else {
        // walking speeds up and slows down rather than starting and stopping dead (moved by the step's average speed)
        const v0 = p.vx || 0;
        p.vx = dir ? accelerate(v0, dir * PHYS.walkAccel * (swim ? PHYS.swimDec : 1), WALK, dt) : approach(v0, 0, PHYS.walkBrake * dt);
        const dx = ((v0 + p.vx) / 2) * dt;
        if (dx) { const r = fh.walk(p, dx); if (r === 'edge') p.vy = 0; else if (r === 'wall') p.vx = 0; }
        if (inp.is('down') && !dir) action = 'prone';
        else if (dir) action = look.walkAction();
      }
    }
    if (!p.fh) {
      p.vx ||= 0;
      if (dir) p.facingRight = dir > 0;
      const x0 = p.x, y0 = p.y;
      if (swim) {
        // a stroke: the jump key (pressed, or its key repeat while held) sends you up; nothing else rises
        const key = this.keysFor(5, ACTION.JUMP).some((c) => inp.hit(c) || inp.repeated(c));
        if (key && !this.hasDisease(WEAKEN) && this.swimJumpReady(true)) {
          p.vy = -PHYS.swimSpeed * 5 * this.swimShoe(ms).v;
          this.moveEvent = { kind: 'jump', vx: p.vx, vy: p.vy };
        }
        this.playerFall(dt, dir, inY, ms);
      } else {
        if (dir) p.vx = accelerate(p.vx, dir * PHYS.airAccel, PHYS.airLimit, dt);
        else p.vx = approach(p.vx, 0, (p.vy < PHYS.maxFall ? PHYS.airDrag : PHYS.airDrag * 100) * dt);
        fh.fall(p, dt, p.ignoreFh);
      }
      // falling or sinking (not on the way up) with up held catches a ladder / rope the step passed within 10px of
      if (!p.fh && p.vy > 0 && inp.is('up') && this.canClimb()) {
        const l = map.ladderIn(Math.round(x0), Math.round(y0), Math.round(p.x), Math.round(p.y));
        if (l) { this.grab(l); this.advanceFrame(l.l ? 'ladder' : 'rope', 0); return; }
      }
      // landing keeps half the speed when you hold the same way (or nothing) and stops you holding the other way
      if (p.fh) p.vx = dir * p.vx >= 0 ? p.vx * 0.5 : 0;
      action = p.fh ? look.standAction() : this.airAction();
    }
    action ??= look.standAction();

    const b = map.bounds;
    p.x = Math.max(fh.left + 25, Math.min(fh.right - 25, p.x));     // the client's side walls: footholds' extent, 25px in
    if (p.y > b.bottom + 300) this.placeAtPortal(map.spawnPortal(null));
    this.advanceFrame(action, dt);
  }

  /** Off the ground (not on a ladder): swimming in water, else jumping. */
  airAction() { const p = this.player; return this.map?.swimming(p.x, p.y) ? 'fly' : 'jump'; }
  /**
   * In water your speed stat (or your mount's) sets how fast you swim both ways, and the mount's or your shoes' swim
   * (a percentage) scales the sideways speed.
   */
  swimShoe(ms = this.moveStats()) {
    const ride = this.riding && this.mountData(this.riding.item)?.stats;
    const shoes = !ride && this.windows?.info?.(this.inventory?.equipped?.[-7]?.id);
    const pct = Number((ride || shoes)?.swim ?? 100);
    return { acc: 1, speed: ms.speed * pct / 100, v: ms.speed };
  }
  /** Off the ground: in water you swim (no gravity; left / right and up / down steer it), else you fall. */
  playerFall(dt, dir = 0, inY = 0, ms = null) {
    const p = this.player, fh = this.map.fh;
    if (this.map.swimming(p.x, p.y)) { swimVelocity(p, dir, inY, dt, this.swimShoe(ms || this.moveStats())); fh.fall(p, dt, p.ignoreFh, true); }
    else fh.fall(p, dt, p.ignoreFh);
  }
  /** In water a jump or a stroke is taken at most every 300ms. */
  swimJumpReady(swim) {
    if (!swim) return true;
    const now = performance.now();
    if (now - (this.swimJumpAt || -Infinity) < 300) return false;
    this.swimJumpAt = now;
    return true;
  }

  /**
   * Through a portal, as the client does (openms, docs/ingame-portals.md): within the map you are moved at once,
   * BasicEff's Teleport sparkling where you left and where you land, the camera gliding across, and can go again
   * after 600ms; to another map the screen starts fading to black and another request waits 500ms. A request the
   * server turns down (no new map within a few seconds) fades back in.
   */
  usePortal(portal) {
    const map = this.map;
    this.flushMovement();   // the server and everyone else see where you were before you go
    // a script portal with no target map (types 7, 8, 11) only asks the server to run its script: no sound, no fade
    if (portal.tm === 999999999) {
      if (!this.net) return;
      this.portalCooldown = 0.5;
      this.net.scriptPortal(portal.pn, { x: Math.round(this.player.x), y: Math.round(this.player.y) });
      return;
    }
    sfx.play('Game/Portal');
    if (portal.tm === map.id && portal.pt !== 4 && portal.pt !== 5) {
      this.portalCooldown = 0.6;
      const p = this.player, from = { x: Math.round(p.x), y: Math.round(p.y) };
      const t = map.spawnPortal(portal.tn);
      this.playTeleportEffect(from.x, from.y);
      // for those watching: the portal (4), a tick there, then the jump (3) to 10px over the other one, which you
      // fall from as after any move
      const fhId = p.fh?.id || 0, stance = this.currentStance();
      this.moveBuf.push({ cmd: 4, ...from, fh: fhId, stance, duration: 0 }, { cmd: 0, ...from, vx: 0, vy: 0, fh: fhId, stance, duration: 30 });
      p.x = t.x; p.y = t.y - 10; p.vx = 0; p.vy = 0; p.fh = null; p.ladder = null; p.seat = null;
      this.moveBuf.push({ cmd: 3, x: Math.round(p.x), y: Math.round(p.y), fh: 0, stance, duration: 0 });
      this.moveTotal += 30; this.movePos = { x: p.x, y: p.y }; this.wasAirborne = true; this.downOfh = 0;
      this.touchedBoxPortal = map.boxPortalAt(p.x, p.y, 3) || null;
      this.playTeleportEffect(p.x, p.y);
      this.net?.innerPortal(portal.pn, from, { x: t.x, y: t.y });
      return;
    }
    this.portalCooldown = 0.5;
    this.fadeOut();
    this.after(3000, () => { if (this.fade?.dir === 'out' && !this.loading && this.map === map) this.fade = { dir: 'in', t0: performance.now() }; });
    if (!this.net) this.changeMap(portal.tm, { portal: portal.tn });
    else this.net.enterPortal(portal.pn);   // the server runs a portal's script, if it has one, from here too
  }
  /**
   * Touch portals (type 3) take you as soon as you are inside their hRange x vRange box: on a floor, in the air or on
   * a ladder or rope (some sit on a rope, for climbing to the next map). Once per entry.
   */
  touchPortal() {
    if (this.portalCooldown > 0) return;
    const p = this.player, portal = this.map.boxPortalAt(p.x, p.y, 3);
    const enter = portal && this.touchedBoxPortal !== undefined && portal !== this.touchedBoxPortal && portal.tm !== 999999999;
    this.touchedBoxPortal = portal || null;   // undefined only until the first check on a map
    if (enter) this.usePortal(portal);
  }
  /**
   * Type 9 portals run their script when you walk into them, with no sound or fade and no map change: one request
   * at a time (until the server enables actions again), after the portal's delay, and an onlyOnce portal not
   * twice in a row.
   */
  scriptTouch() {
    const p = this.player;
    if (!this.net || !(this.stats?.hp > 0)) return;
    const portal = this.map.scriptPortalAt(p.x, p.y);
    if (portal === this.scriptPortalIn) return;
    const now = performance.now();
    if (portal) {
      if (this.scriptPending && now - this.scriptPending < 5000) return;   // try again once the last one is answered
      if (now - (this.scriptPortalT ?? -Infinity) < (portal.delay || 0)) return;
      if (!(portal.onlyOnce && this.scriptPortalLast === portal.idx)) {
        this.scriptPending = now; this.scriptPortalT = now; this.scriptPortalLast = portal.idx;
        this.net.scriptPortal(portal.pn, { x: Math.round(p.x), y: Math.round(p.y) });
      }
    }
    this.scriptPortalIn = portal;
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
    this.moveEvent = { kind: 'grab', fh: p.fh?.id || 0, stance: this.currentStance() };   // how you were before it
    p.ladder = l; p.fh = null; p.x = l.x; p.vx = 0; p.vy = 0;
  }
  // ------------------------------------------------------------------ death
  /**
   * Where the tombstone of someone dying at (x, y) lands: on the floor under x (looking from 20px over their feet)
   * if it is at most 80px down, else under x + 15 if that one is, else under x - 15 however far down. With no floor
   * under x it stays where they died.
   */
  tombPoint(x, y) {
    x = Math.round(x); y = Math.round(y);
    const floor = (fx) => {
      let best = null;
      for (const f of this.map.fh.floors) {
        if (fx < f.x1 || fx > f.x2) continue;
        const fy = Footholds.yAt(f, fx);
        if (fy >= y - 20 && (best === null || fy < best)) best = fy;
      }
      return best === null ? null : Math.round(best);
    };
    const a = floor(x);
    if (a === null) return { x, y };
    if (a <= y + 80) return { x, y: a };
    const b = floor(x + 15);
    if (b !== null && b <= y + 80) return { x: x + 15, y: b };
    const c = floor(x - 15);
    return c !== null ? { x: x - 15, y: c } : { x, y };
  }
  tombOf(ent) { return this.vfx?.tombs.find((t) => t.ent === ent) || null; }
  /**
   * A ghost goes round a 10px circle centred 20px over its tombstone, once every 2s from its left side, in whole
   * pixels; a fresh one fades in over 2.5s.
   */
  ghostAt(ent) {
    const t = this.tombOf(ent);
    if (!t) return null;
    const ms = performance.now() - t.t0, a = (2 * Math.PI * ms) / 2000;
    return { x: Math.round(t.x - 10 * Math.cos(a)), y: Math.round(t.y - 20 - 10 * Math.sin(a)), alpha: t.fresh ? Math.min(1, ms / 2500) : 1 };
  }
  /**
   * Someone else turning into a ghost gets a tombstone where they are, falling with the sound (quieter the further
   * off: full within 250px, 40% beyond 1000px); one already dead when you see them has it lying there; brought
   * back, it goes.
   */
  watchDeath(rp) {
    const dead = rp.state === 'dead';
    if (rp.wasDead === dead) return;
    const fresh = rp.wasDead === false;
    rp.wasDead = dead;
    if (!dead) { this.vfx?.untomb(rp); return; }
    const at = this.tombPoint(rp.x, rp.y);
    this.vfx?.tomb(rp, at.x, at.y, fresh);
    if (!fresh) return;
    sfx.play('Game/Tombstone', { volume: this.volumeAt(at.x, at.y) });
  }
  /** Dead: the body (unseen, but it's what is sent) keeps falling with no input, off a ladder or rope too. */
  updateDeadBody(dt) {
    const p = this.player;
    p.ladder = null; p.seat = null; p.attack = null;
    if (p.ignoreT > 0 && (p.ignoreT -= dt) <= 0) p.ignoreFh = null;
    this.coast(dt);
  }
  /** No input: on a floor you slide to a stop, in the air you fall (and stop on landing). */
  coast(dt) {
    const p = this.player, fh = this.map.fh;
    if (p.fh) { const v0 = p.vx || 0; p.vx = approach(v0, 0, PHYS.walkBrake * dt); const dx = ((v0 + p.vx) / 2) * dt; if (dx) fh.walk(p, dx); }
    else { this.playerFall(dt, 0, 0); if (p.fh) p.vx = 0; }
  }

  /** Mounts can't climb, except Monster Rider's (190xxxx) and those of 1932001-1932005 and 1932007-1932011. */
  canClimb() {
    const id = this.riding?.item;
    return !id || Math.floor(id / 10000) !== 193 || (id >= 1932001 && id <= 1932011 && id !== 1932006);
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
    if (this.hasDisease(SEAL) && !HEROS_WILLS.has(id)) return false;   // sealed by a monster: only Hero's Will
    const sb = this.skills, lv = sb.level(id);
    if (!lv || !sb.owns(id)) return false;   // another job's skill, even if you have levels in it
    const kind = sb.kind(id, this.weaponId());
    if (kind === 'passive') return false;
    if (this.riding && !this.skillKeyPressed) return false;   // a key held down on a mount doesn't repeat
    const ride = this.rideRule(id);
    if (ride === 'off') { this.net?.cancelBuff(id); return true; }
    if (!ride) return false;
    // in Dark Sight only Assassinate goes; with Vanish learned, anything but Dark Sight itself
    if (this.darkSight() && id !== ASSASSINATE && (!sb.level(VANISH) || id === DARK_SIGHTS[1])) return false;
    if (id === ASSASSINATE && !this.darkSight()) return false;   // Assassinate only comes out of Dark Sight
    if (this.player.ladder && (kind !== 'special' || NO_LADDER.has(id))) return false;   // on a ladder or rope only buffs
    if (MONSTER_MAGNETS.has(id) || BIG_BANGS.has(id) || id === EXPLOSION) return this.holdCharge(id, lv);
    if (FLASH_JUMPS.has(id)) return this.flashJump(id, lv);
    if (id === CHAKRA) return this.castChakra(id, lv);
    // Assaulter needs a monster to go for and floor where it ends; Boomerang Step floor 150px ahead
    const ahead = (dx) => this.floorNear(this.player.x + (this.player.facingRight ? dx : -dx), this.player.y, 80);
    if (id === ASSAULTER && (!ahead(-(sb.levelData(id)?.lt?.[0] || 200))
      || !this.findTargets('melee', id, lv, 1, sb.action(id) || this.look.attackAction()).length)) return false;
    if (id === BOOMERANG_STEP && (!ahead(-(sb.levelData(id)?.lt?.[0] || 300) / 2) || performance.now() < (this.boomerangLock || 0))) return false;
    if (HURRICANES.has(id) || id === PIERCING_ARROW) return this.holdKeydown(id, lv);
    // Panic and Coma need an orb, Enrage nine; without them the key does nothing
    if (FINISHERS.has(id) && this.comboValue() < 2) return false;
    if (id === ENRAGE && this.comboValue() < 10) return false;
    // Charged Blow needs a charge on; Rush waits 1.77s after the last; movement skills not on maps that forbid them
    if (id === CHARGED_BLOW && !this.activeCharge()) return false;
    if (RUSH_DASH.has(id) && performance.now() < (this.rushLock || 0)) return false;
    if (MOVE_LIMITED.has(id) && ((this.map?.info?.fieldLimit || 0) & 2)) return false;
    if (id === SHADOW_MESO && this.meso < Math.trunc(((sb.levelData(id)?.moneyCon || 0) * (100 + (this.partner()?.y || 0))) / 100)) { this.notice("You don't have enough mesos to use this skill."); return false; }
    // buffs fire once per key press; Teleport repeats while the key is held (its own delay paces it)
    if (kind === 'special' && !this.skillKeyPressed && !TELEPORTS.has(id)) return false;
    if (TELEPORTS.has(id) && performance.now() < (this.teleportLock || 0)) return false;
    return this.attack(id, kind);
  }

  /**
   * On a mount (a tamed monster, 190, or a vehicle, 193) a riding skill gets you off it (CANCEL_BUFF with that skill,
   * no SPECIAL_MOVE) when it is the kind for what you ride, and does nothing otherwise: it never starts a second ride.
   * Space Dash goes on a skill vehicle, Space Beam always, the Battleship's own skills on the Battleship; anything else
   * is refused with a notice. 'off', 'go' or null (refused).
   */
  rideRule(id) {
    const ride = this.riding?.item, kind = Math.floor((ride || 0) / 10000);
    if (kind !== 190 && kind !== 193) return 'go';
    const skillVehicle = isSkillVehicle(ride);
    const ship = kind === 193 && !skillVehicle;
    if (SKILL_VEHICLE_SKILLS.has(id)) return skillVehicle ? 'off' : null;
    if (MONSTER_RIDERS.has(id)) return kind === 190 ? 'off' : null;
    if (id === BATTLESHIP) return ship ? 'off' : null;
    if (SPACE_DASHES.has(id)) return skillVehicle ? 'go' : null;
    if (SPACE_BEAMS.has(id)) return 'go';
    if (RIDE_SHIP_SKILLS.has(id)) return ship ? 'go' : null;
    this.notice(kind === 190 ? 'Not available while riding on the tamed monster.' : 'Not available during the ride.');
    return null;
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
    if (p.ladder && kind !== 'special') return false;   // no attacks of any kind on a ladder or rope
    if (skillId && this.net && !sb.weaponOk(skillId, weapon)) { this.notice('You cannot use this skill with the weapon you are holding.'); return false; }
    if (GROUND_ONLY.has(skillId) && !p.fh) return false;
    if (kind === 'magic' && !p.fh && !AIR_SPELLS.has(skillId) && !this.map?.swimming(p.x, p.y)) return false;
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
    this.petAttackReact();
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
      p.attackScale = this.attackScale(this.attackSpeed(skillId));
    }
    const pose = (opts.held ? opts.pose : p.attack) || this.defaultAttackAction(kind), scale = opts.held ? this.attackScale() : p.attackScale;
    const hitDelay = this.look.attackDelay(pose) * scale, trailAt = this.hitFrame(pose, kind);
    // the weapon swings with its trail, as well as any cast sound
    const swingSound = kind !== 'magic' && !NO_SWING.has(skillId);
    if (!opts.held) {
      this.after(this.frameTime(pose, trailAt) * scale, () => { this.playAfterimage(pose, trailAt, skillId); if (swingSound) this.playWeaponSound(p); });
      if (opts.stage2) { this.playSkillEffect(skillId, p, false, 'special'); sfx.play(`Skill/${pad(skillId, 7)}/Use2`); }
      else if (skillId && !heal) this.playSkillEffect(skillId, p, false, 'effect', scale);
    } else { sfx.play(`Skill/${pad(skillId, 7)}/Use`); if (swingSound) this.playWeaponSound(p); }

    const mobCount = ld?.mobCount || 1;
    // fixdamage skills must deal exactly that much per monster (Cosmic autobans anything else)
    // Shadow Partner throws as many again: its lines follow yours, at y% of them (x% for a plain throw)
    const sp = kind === 'ranged' && !NO_PARTNER.has(skillId) ? this.partner() : null;
    const base = ld?.fixdamage || opts.stage2 ? 1 : ld?.attackCount || ld?.bulletCount || 1;
    const lines = sp ? Math.min(15, base * 2) : base, half = Math.floor(lines / 2);
    const ammo = kind === 'ranged' ? this.ammoItem((ld?.bulletConsume || ld?.bulletCount || 1) * (sp ? 2 : 1)) : 0;
    const cash = kind === 'ranged' ? this.cashBullet() : 0;
    const plan = kind === 'ranged' && !BOX_SHOTS.has(skillId) ? this.shotPlan(p, skillId, lv, ld, this.shotRange(skillId, lv, wcat), from) : null;
    const kept = opts.prefer && opts.prefer.alive && !opts.prefer.dying && !opts.prefer.queuedKill ? [opts.prefer] : null;
    const mx = skillId === MESO_EXPLOSION ? this.mesoExplosionPlan(p, lv, ld) : null;
    let targets = mx?.mobs || kept || (plan ? plan.targets.map((t) => t.mob) : this.findTargets(kind, skillId, lv, mobCount, pose, reach, charge));
    if (heal) targets = targets.filter((m) => m.src.info?.undead);
    // Band of Thieves: a monster in reach of your plain swing first, then the rest of its box
    if (skillId === BAND_OF_THIEVES) {
      const first = this.findTargets('melee', 0, 0, 1, this.look.attackAction(), CLOSE_REACH)[0];
      targets = first ? [first, ...this.mobsIn(this.skillBox(p, skillId, lv), p.x, p.y, first).slice(0, mobCount - 1)] : [];
    }
    const looks = skillId === BAND_OF_THIEVES ? this.thiefLooks(skillId, targets.length) : [];
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
        if (sp && i >= half) {
          const src = dmg[i - half], info = m.src?.info || {};
          const missed = this.accuracyMiss(info, Math.max(0, (info.level || 0) - (this.stats?.level || 1)));
          dmg.push(src > 0 && !missed ? this.partnerHit(src, (skillId ? sp.y : sp.x) || 0) : 0); crits.push(crits[i - half]);
          continue;
        }
        // Heaven's Hammer strikes for 1: the server does its real damage a moment later
        if (skillId === HEAVENS_HAMMER) { dmg.push(1); crits.push(false); continue; }
        if (mx) { dmg.push(...mx.damage(m)); crits.push(...dmg.map(() => false)); break; }
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
          t.mob.hit(t.dmg.reduce((a, b) => a + b, 0), !p.facingRight, strong); if (skillId !== HEAVENS_HAMMER) this.damageNumbers(t.mob, mx ? foldLines(t.dmg) : t.dmg, true, skillId, t.crit, ...this.lineTiming(p)); this.playHitEffect(skillId, t.mob, p, t.dmg, looks[i] ?? null, cash); this.aranComboHit(t.dmg.reduce((a, b) => a + b, 0));
          this.after(lineDelay(skillId, t.dmg.length - 1, ...this.lineTiming(p)), () => this.finishKill(t.mob));   // it dies after its last line lands
          return;
        }
        t.mob.hit(t.dmg.reduce((a, b) => a + b, 0), !p.facingRight, strong); if (skillId !== HEAVENS_HAMMER) this.damageNumbers(t.mob, mx ? foldLines(t.dmg) : t.dmg, true, skillId, t.crit, ...this.lineTiming(p)); this.playHitEffect(skillId, t.mob, p, t.dmg, looks[i] ?? null, cash);
        this.aranComboHit(t.dmg.reduce((a, b) => a + b, 0));
        if (t.mob.kind === 'Mob') t.mob.chase(p);                 // a struck monster comes after you
      };
      // the hit (or the shot) comes when the swing connects, not when it starts
      // when each lands goes to the server too (it holds the monster's drops until then)
      if (plan) { t.delay = hitDelay + plan.targets[i].delay; this.after(t.delay, land); }
      else if (projectile) { t.delay = hitDelay; this.after(hitDelay, () => this.shoot(skillId, p, t.mob, kind === 'ranged' ? ammo : 0, land)); }
      else { t.delay = hitDelay + hitWave(i, kind, skillId); this.after(t.delay, land); }
      if (skillId === CHAIN_LIGHTNING) this.boltAt(hitDelay + hitWave(i, kind, skillId), i ? out[i - 1].mob : p, t.mob, skillId);
    }
    if (plan) { plan.partner = !!sp; this.shotFx(plan, p, skillId, ld, ammo, hitDelay); }
    else if (projectile && !out.length) this.after(hitDelay, () => this.shoot(skillId, p, null, kind === 'ranged' ? ammo : 0, null));
    if (MAGIC_AT_ONCE.has(skillId)) this.teleportLock = performance.now() + TELEPORT_AFTER_ULTIMATE;
    if (heal && !out.length) return true;   // no undead in reach: only the heal went out
    this.net?.attack(kind, { targets: out, lines: mx ? Math.min(15, mx.mesos.length) : lines, skill: skillId, stance: this.actionId(pose, kind === 'ranged'), facingLeft: !p.facingRight,
      speed: this.attackSpeed(skillId), charge, display: opts.stage2 ? 0x20 : 0,
      mesos: mx?.mesos.map((d) => ({ oid: d.oid, mask: out.reduce((b, t, i) => (i < 8 && mx.touches(t.mob, d) ? b | (1 << i) : b), 0) })), pos: p, delay: Math.round(hitDelay) });
    // Assaulter: straight to the floor 200px ahead, leaving its trail where you stood
    if (skillId === ASSAULTER) {
      const from = { x: p.x, y: p.y, right: p.facingRight };
      if (this.blinkAhead(-(ld?.lt?.[0] || 200))) { this.playBasicEff('Assaulter/remain', from.x, from.y, from.right); this.playBasicEff('Assaulter/effect', p.x, p.y, p.facingRight); }
    }
    // Boomerang Step: unseen and untouchable for its pose, and not again until 500ms after
    if (skillId === BOOMERANG_STEP) {
      const len = this.frameTime(pose, this.look.frameCount(pose)) * scale;
      this.boomerangUntil = performance.now() + len; this.boomerangLock = this.boomerangUntil + 500;
    }
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

  /**
   * Meso Explosion: the mesos lying in its box that you may pick up (yours, your party's, or anyone's), up to its
   * attackCount, smallest first; the monsters (up to mobCount) within 50px of any of them. Each meso by a monster is a
   * line of x x 50 x 0.5-1.0 x (amount <= 1000 ? (amount x 0.82 + 28) / 5300 : amount / (amount + 5250)).
   */
  mesoExplosionPlan(p, lv, ld) {
    const box = this.skillBox(p, MESO_EXPLOSION, lv), mine = this.player.id, party = this.party?.id;
    const max = Math.max(1, Math.min(20, ld?.attackCount || 1));
    const mesos = [...this.drops.values()].filter((d) => d.meso && d.landed && !d.pickedBy && box
      && d.x >= box.left && d.x <= box.right && d.y >= box.top && d.y <= box.bottom
      && (d.type === 0 ? d.owner === mine : d.type === 1 ? d.owner === party : true)).slice(0, max).sort((a, b) => a.id - b.id);
    const touches = (m, d) => { const h = m.hitBox(true); return h.right >= d.x - 50 && h.left <= d.x + 50 && h.bottom >= d.y - 50 && h.top <= d.y + 50; };
    const mobs = this.liveMobs().filter((m) => mesos.some((d) => touches(m, d))).slice(0, Math.max(1, Math.min(15, ld?.mobCount || 1)));
    const damage = (m) => mesos.slice(0, 15).filter((d) => touches(m, d)).map((d) => {
      const a = d.id, ratio = a <= 1000 ? (a * 0.82 + 28) / 5300 : a / (a + 5250);
      return Math.max(1, Math.trunc(50 * (ld?.x || 0) * ratio * (0.5 + Math.random() * 0.5)));
    });
    return { mesos, mobs, damage, touches };
  }
  /** Band of Thieves' hit art per monster: hit/0 on the first, the others hit/1..x shuffled. */
  thiefLooks(id, n) {
    const x = this.skills.node(id)?.level?.[1] ? Math.max(1, Object.keys(this.skills.node(id).hit || {}).length - 1) : 5;
    const rest = Array.from({ length: x }, (_, i) => i + 1);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    return [0, ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => rest[i % rest.length])];
  }
  /** A meso blowing up (Meso Explosion): it goes after `delay` ms with the skill's hit art, the sound at most every 90ms. */
  explodeMeso(oid, delay) {
    this.after(delay, async () => {
      const d = this.drops.get(oid);
      if (!d) return;
      this.drops.delete(oid);
      const now = performance.now();
      if (now - (this.lastMesoBoom || 0) > 89) { this.lastMesoBoom = now; sfx.play(`Skill/${pad(MESO_EXPLOSION, 7)}/Hit`); }
      const node = Game.fxNode((await this.skills?.ensure(MESO_EXPLOSION))?.hit);
      if (!node) return;
      const anim = new Anim(node, false);
      await this.assets.preload(anim.frames);
      this.fx.push({ anim, x: d.x, y: d.y, flip: false });
    });
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
    for (const m of mobs) if (!m.src?.info?.boss) m.startPull({ x: p.x + dir * (Math.floor(Math.random() * 20) + reach + 35), stop: 0 });
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
   * speed is the weapon's attackSpeed (2 fastest .. 10 slowest, 6 normal) plus a booster's value (a skill or an item,
   * -1 to -4) and Speed Infusion's; Double Stab is two faster still.
   */
  attackSpeed(skillId = 0) {
    let speed = this.windows?.info(this.weaponId())?.attackSpeed ?? 6;
    const now = Date.now(), active = (this.buffs || []).filter((b) => b.until > now);
    const booster = active.findLast((b) => b.booster !== undefined || BOOSTERS.has(b.source));
    if (booster) speed += booster.booster ?? -2;
    speed += active.findLast((b) => b.infusion)?.infusion || 0;
    if (skillId === DOUBLE_STAB) speed -= 2;
    return Math.max(2, Math.min(10, speed));
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
  async playAfterimage(action, frame, skillId = 0, ent = this.player) {
    const local = ent === this.player;
    const name = local ? this.windows?.info(this.weaponId())?.afterImage : ent.look?.weapon?.info?.afterImage;
    const set = local ? this.afterimage : this.afterimageSet(name);
    const lv = local ? this.afterimageLevel() : Math.min(10, Math.floor((ent.level || 1) / 10));
    const own = skillId && (await this.skills?.ensure(skillId))?.afterimage;
    // a skill with its own trail (Dragon Fury's dragon) uses it instead of the weapon's, under the weapon's
    // afterImage name and the pose; with nothing there, no trail at all
    let node = set?.[lv]?.[action]?.[frame];
    if (own) {
      const sk = own[name]?.[action];
      node = sk && Object.entries(sk).find(([, v]) => v && typeof v === 'object' && !Array.isArray(v))?.[1];
    }
    const fx = Game.fxNode(node);
    if (!fx) return;
    const anim = new Anim(fx, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, follow: ent, flip: ent.facingRight });
  }
  /** Character/Afterimage/<name>.img, loaded once for everyone who swings that kind of weapon. */
  afterimageSet(name) {
    if (!name) return null;
    const c = (this.afterimages ??= new Map());
    if (!c.has(name)) { c.set(name, null); this.assets.json(`Character/Afterimage/${name}.img`).then((j) => c.set(name, j)); }
    return c.get(name);
  }
  /** Another player's swing trail: on the trail's frame of their pose, at their attack's speed. */
  remoteAfterimage(rp, skillId, kind) {
    const action = rp.attack, look = rp.look;
    if (!action || !look) return;
    const set = this.afterimageSet(look.weapon?.info?.afterImage), lv = Math.min(10, Math.floor((rp.level || 1) / 10));
    const last = Math.max(0, look.frameCount(action) - 1);
    const keys = Object.keys(set?.[lv]?.[action] || {}).filter((k) => /^\d+$/.test(k)).map(Number);
    const frame = kind === 'ranged' ? Math.min(1, last) : kind === 'magic' ? last : keys.length ? Math.min(...keys) : last;
    let t = 0; for (let i = 0; i < frame; i++) t += look.delay(action, i);
    this.after(t * (rp.attackScale || 1), () => {
      if (rp.attack !== action) return;
      this.playAfterimage(action, frame, skillId, rp);
      if (kind === 'melee') this.playWeaponSound(rp);   // their shots sound as they fly instead
    });
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
    // an Aran (or a Legend) with a polearm swings one of its three polearm swings, which its attack chain follows
    const job = this.stats?.job || 0;
    if ((Math.floor(job / 100) === 21 || job === 2000) && Math.floor(this.weaponId() / 10000) % 100 === 44) {
      return POLEARM_SWINGS[Math.floor(Math.random() * POLEARM_SWINGS.length)];
    }
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
    this.holdLoop(id);
    return true;
  }
  /** A held skill's Loop sound, until it is let go (or cut short). */
  async holdLoop(id) {
    if (!LOOP_HOLDS.has(id)) return;
    const held = () => this.charging?.id === id || this.keydown?.id === id;
    const stop = await sfx.loop(`Skill/${pad(id, 7)}/Loop`);
    if (!stop) return;
    if (!held()) { stop(); return; }
    this.skillLoop?.stop();
    this.skillLoop = { held, stop };
  }
  releaseCharge() {
    const c = this.charging;
    this.charging = null;
    if (MONSTER_MAGNETS.has(c.id)) return this.releaseMagnet(c);
    this.attack(c.id, 'magic', { charge: Math.round(Math.min(c.t, CHARGE_HOLD) * 1000) });
  }
  /** A skill's looping art on `ent` for as long as `keep()` holds. */
  /** Berserk on (HP low enough): its effect stays on the character until it goes off. */
  setBerserk(ent, on) {
    if (!ent) return;
    ent.berserk = on;
    if (!on || ent.berserkFx === 'pending' || this.fx.includes(ent.berserkFx)) return;
    // (started again when a map change cleared it while it is still on)
    ent.berserkFx = 'pending';
    const keep = () => !!ent.berserk && (ent === this.player || this.others.get(ent.id) === ent);
    this.loopSkillEffect(BERSERK, ent, 'effect', keep).then((f) => { ent.berserkFx = f || null; });
  }
  async loopSkillEffect(id, ent, branch, keep) {
    const fx = Game.fxNode((await this.skills?.ensure(id))?.[branch]);
    if (!fx || !keep()) return;
    const anim = new Anim(fx, true);
    await this.assets.preload(anim.frames);
    const f = { anim, follow: ent, keep };
    this.fx.push(f);
    return f;
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
    for (const [m, ok] of caught) if (ok) m.startPull({ x: p.x, stop: (m.node?._w || 40) + 45 });
    this.net?.magnet(id, lv, caught.map(([m, ok]) => [m.oid, ok]), !p.facingRight);
    this.playSkillEffect(id, p);
  }

  /**
   * Hurricane and Piercing Arrow start on their key press: their prepare pose and art, then their keydown art while
   * held, and the server hears they started so others see it.
   */
  holdKeydown(id, lv) {
    if (this.keydown) return true;
    if (this.player.ladder) return false;
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
    if (LOOP_HOLDS.has(id)) this.holdLoop(id); else sfx.play(`Skill/${pad(id, 7)}/Use`);
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
    const action = p.ladder ? (p.ladder.l ? 'ladder2' : 'rope2') : this.skills.action(id) || 'alert2';
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
    const bx = Math.round((UI_W - box.width) / 2), by = 22;   // under the server's scrolling notice
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

  /**
   * The avatar's head vector, where an effect with pos 1 hangs (the QuestAlert bulb): the brow of the current
   * action's first frame, mirrored with the facing; on a mount it rides up with the rider - plus the riding
   * frame's navel less the plain frame's.
   */
  headAnchor(ent = this.player, look = this.look) {
    const action = ent.action || look.standAction(), base = look.compose(action, 0);
    let [bx, by] = base.brow || [0, 0];
    const mountId = ent === this.player ? this.riding?.item : ent.mount, mount = action !== 'dead' && this.mountData(mountId)?.img;
    if (mount) {
      const riding = composeMounted(look, mount, mountId, action, null, 0, ent.mountTired), n = base.navel || [0, 0];
      bx += riding.navel[0] - n[0]; by += riding.navel[1] - n[1];
    }
    return { x: ent.x + (ent.facingRight ? -bx : bx), y: ent.y + by };
  }

  // ------------------------------------------------------------------ mounts
  /**
   * A mount's art (Character/TamingMob/<id>.img) and its riding stats (TamingMob/<info/tamingMob>.img/info: speed,
   * jump, fatigue), loaded once; null until ready.
   */
  mountData(id) {
    if (!id) return null;
    this.mounts ??= new Map();
    if (!this.mounts.has(id)) {
      this.mounts.set(id, null);
      (async () => {
        const img = await this.assets.json(`Character/TamingMob/${pad(id, 8)}.img`);
        if (!img) return;
        const tm = Number(img.info?.tamingMob) || 0;
        const stats = tm ? (await this.assets.json(`TamingMob/${pad(tm, 4)}.img`))?.info : null;
        await this.assets.preload(mountCanvases(img));
        this.mounts.set(id, { img, stats });
      })();
    }
    return this.mounts.get(id);
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
  /**
   * Flash Jump: once per jump, in the air on the way up, not mid-attack nor on a map that forbids movement skills.
   * Throws you forward (350 + 40 a 4 levels) and up (250 + 20 a 4 levels), like a knock-back's push.
   */
  flashJump(id, lv) {
    const p = this.player, ld = this.skills.levelData(id, lv);
    if (!this.skillKeyPressed || p.fh || p.ladder || p.attack || this.fjUsed) return false;
    if ((p.vy || 0) > 0 && !this.map.swimming(p.x, p.y)) return false;   // falling, except in water
    if ((this.map?.info?.fieldLimit || 0) & 2) { this.notice('You cannot use that skill on this map.'); return false; }
    if (this.net && (ld?.mpCon || 0) > this.stats.mp) { this.notice('Not enough MP.'); return false; }
    const n = Math.floor(lv / 4), dir = p.facingRight ? 1 : -1;
    const impact = (v, k) => (k > 0 ? (v < k ? Math.min(v + k, k) : v) : (v > k ? Math.max(v + k, k) : v));
    p.vx = impact(p.vx || 0, dir * (350 + 40 * n)); p.vy = impact(p.vy || 0, -(250 + 20 * n));
    this.fjUsed = true;
    this.playSkillEffect(id, p);
    this.playBasicEff(id === FLASH_JUMPS_NW ? 'Flying1' : 'Flying', p.x, p.y, p.facingRight);
    this.net?.specialMove(id, lv, null);
    return true;
  }
  /**
   * Chakra: only at 49% HP or less. It winds up in its prepare pose (others are told), blows doing x% meanwhile, and
   * goes off when the pose ends.
   */
  castChakra(id, lv) {
    const p = this.player, ld = this.skills.levelData(id, lv);
    if (!this.skillKeyPressed || p.attack || this.chakra || p.ladder) return false;
    if (((this.stats?.hp || 0) * 100) / Math.max(1, this.maxHpShown()) > 49) return false;
    if (this.net && (ld?.mpCon || 0) > this.stats.mp) { this.notice('Not enough MP.'); return false; }
    const action = this.skills.node(id)?.prepare?.action, pose = action && this.look.has(action) ? action : 'alert';
    p.attack = pose; p.action = pose; p.frame = 0; p.frameT = 0; p.attackScale = this.attackScale();
    this.chakra = { x: ld?.x || 100 };
    this.net?.skillEffect(id, lv, this.actionId(pose), !p.facingRight, this.attackSpeed());
    this.playSkillEffect(id, p, false, 'prepare');
    this.after(this.frameTime(pose, this.look.frameCount(pose)) * p.attackScale, () => {
      this.chakra = null;
      if (this.dead) return;
      this.playSkillEffect(id, p);
      this.net?.specialMove(id, lv, null);
    });
    return true;
  }
  async playBasicEff(name, x, y, flip) {
    const node = name.split('/').reduce((n, k) => n?.[k], this.basicEff ??= await this.assets.json('Effect/BasicEff.img'));
    if (!node) return;
    const anim = new Anim(node, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, x, y, flip });
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
  /** The first cash bullet in the cash inventory that suits the weapon (bow / crossbow 5020, claw 5021, gun 5022). */
  cashBullet() {
    const kind = { 145: 5020, 146: 5020, 147: 5021, 149: 5022 }[Math.floor(this.weaponId() / 10000)];
    const cash = this.inventory?.[5] || {};
    if (!kind) return 0;
    for (const k of Object.keys(cash).map(Number).sort((a, b) => a - b)) if (Math.floor(cash[k].id / 1000) === kind) return cash[k].id;
    return 0;
  }
  hasAmmo(skillId) {
    if (skillId % 10000000 === 1000 || NO_AMMO_SHOTS.has(skillId)) return true; // Three Snails, Soul Blade, Shark Wave
    const noAmmoBuffs = [...SOUL_ARROWS, 4121006]; // Soul Arrow x3, Shadow Claw
    if (this.buffs.some((b) => noAmmoBuffs.includes(b.source))) return true;
    const ld = skillId && this.skills.levelData(skillId), sp = !NO_PARTNER.has(skillId) && this.partner();
    return !!this.ammoItem((ld?.bulletConsume || ld?.bulletCount || 1) * (sp ? 2 : 1));
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
  /** A stat request (AP): one at a time, 500ms apart, while alive; false when it can't go yet. */
  sendStatRequest(send) {
    const now = performance.now();
    if (this.apPending || now - (this.apSentAt ?? -Infinity) < 500 || this.dead || !(this.stats?.hp > 0)) return false;
    this.apPending = true; this.apSentAt = now;
    send();
    return true;
  }
  /** The largest live buff value of key k (0 without). */
  buffValue(k) { const now = Date.now(); return Math.max(0, ...(this.buffs || []).filter((b) => b[k] && b.until > now).map((b) => b[k])); }
  /**
   * The Stat window's numbers: [unbuffed, buff part] for weapon def., magic, magic def., accuracy, avoid and hands, the
   * attack range and speed / jump %.
   */
  statWindow() {
    const eq = (k) => this.equipStat(k), cap = (v, m) => Math.max(0, Math.min(m, v));
    const shield = this.inventory?.equipped?.[-10], shieldMastery = [1110001, 1210001, 4210000].map((id) => this.passive(id, 'x')).find((v) => v) || 100;
    const wdef = eq('wdef') - (shield?.wdef || 0) + Math.trunc(((shield?.wdef || 0) * shieldMastery) / 100);
    const blessing = (k) => this.passive(this.blessingId(), k), int = this.totalStat('int');
    const { speed, jump } = this.moveStats(), mv = (v, m) => Math.round(Math.min(m, v * 100));
    return {
      attack: this.statAttack(),
      wdef: [cap(wdef, 1999), this.buffValue('wdef')],
      matk: [cap(int + eq('matk') + blessing('y'), 1999), this.buffValue('matk')],
      mdef: [cap(int + eq('mdef'), 1999), this.buffValue('mdef')],
      acc: [cap(this.accuracy(), 999), this.buffValue('acc')],
      avoid: [cap(this.avoidability(), 999), this.buffValue('avoid')],
      hands: [this.totalStat('dex') + this.totalStat('luk') + int + eq('hands'), this.buffValue('hands')],
      speed: mv(speed, 140), jump: mv(jump, 123),
    };
  }
  /** The Stat window's attack range [min, max], or null without a weapon. */
  statAttack() {
    const job = this.stats?.job || 0, cat = Math.floor(this.weaponId() / 10000) % 100;
    const T = (k) => this.totalStat(k), str = T('str'), dex = T('dex'), luk = T('luk'), thief = Math.floor((job % 1000) / 100) === 4;
    const MULT = { 30: [4, 4], 31: [3.2, 4.4], 32: [3.2, 4.4], 37: [3.2, 4.4], 38: [3.2, 4.4], 40: [4.6, 4.6], 41: [3.4, 4.8], 42: [3.4, 4.8],
      43: [3, 5], 44: [3, 5], 45: [3.4, 3.4], 46: [3.6, 3.6], 47: [3.6, 3.6], 48: [4.8, 4.8], 49: [3.6, 3.6] };
    let mult = MULT[cat], main = str, other = dex;
    if (cat === 33) mult = thief ? [3.6, 3.6] : [4, 4];
    if (!mult) return null;
    if (cat === 45 || cat === 46 || cat === 49) { main = dex; other = str; } else if (cat === 47 || (cat === 33 && thief)) { main = luk; other = str + dex; }
    const ms = masterySkills(cat, [45, 46, 47, 49].includes(cat), 0, job) || {};
    const lv = (id, k) => this.passive(id, k);
    const over = (ms.over || []).find((id) => this.skills?.level(id));
    let mastery = over ? lv(over, 'mastery') : (ms.first || []).map((id) => lv(id, 'mastery')).find((v) => v) || 0;
    if (!over) for (const id of ms.plus || []) mastery += lv(id, 'mastery');
    const m = (mastery * 5 + 10) * 0.009;
    let pad = this.watk() + this.passive(this.blessingId(), 'x') + (over ? lv(over, 'x') : 0) + this.buffValue('watk');
    const ammo = this.ammoItem();
    if (ammo) pad += this.windows?.info(ammo)?.incPAD || 0;
    pad = Math.max(0, Math.min(1999, pad));
    const clamp = (v) => Math.max(1, Math.min(199999, Math.trunc(v)));
    return [clamp(((main * m * mult[0] + other) * pad) / 100), clamp(((main * mult[1] + other) * pad) / 100)];
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
    if (!exempt && this.accuracyMiss(info, over)) return { d: 0, c: false };
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
  /** Your accuracy x 100 / (255 + 10 a level the monster has over you), x 0.7-1.3, under its avoid: a miss. */
  accuracyMiss(info, over) {
    const now = Date.now(), accBuff = Math.max(0, ...(this.buffs || []).filter((b) => b.acc && b.until > now).map((b) => b.acc));
    const acc = Math.min(999, Math.max(0, this.accuracy() + accBuff)), hit = (acc * 100) / (over * 10 + 255);
    return hit * (0.7 + Math.random() * 0.6) < Math.min(999, Math.max(0, info.eva || 0));
  }
  /** A Shadow Partner line: pct% of the line it follows, then Wind Walk and Vanish over again. */
  partnerHit(src, pct) {
    const now = Date.now(), buffed = (ids) => (this.buffs || []).some((b) => ids.includes(b.source) && b.until > now);
    let d = Math.trunc((src * pct) / 100);
    if (buffed([WIND_WALK])) d = (d * (this.skills.levelData(WIND_WALK)?.damage || 100)) / 100;
    if (this.skills.level(VANISH) && buffed(DARK_SIGHTS)) d = (d * (this.skills.levelData(VANISH)?.damage || 100)) / 100;
    return Math.max(1, Math.trunc(d));
  }
  /** Your Shadow Partner buff's level data, if it is on. */
  partner() {
    const now = Date.now(), b = this.buffs?.find((x) => SHADOW_PARTNERS.includes(x.source) && x.until > now);
    return b ? this.skills.levelData(b.source) || {} : null;
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
      const n = Math.max(1, ld?.bulletCount || 1), gap = arrowGap(skillId, ammoId) || (plan.partner ? 120 : 0), dir = ent.facingRight ? 1 : -1;
      // Shadow Partner's follow on, from 30px behind, carrying on the 14px steps
      for (let i = 0; i < (plan.partner ? n * 2 : n); i++) {
        const sx = plan.sx - (i >= n ? dir * 30 : 0);
        this.after(leave + i * gap, () => this.fly(skillId, ammoId, sx, plan.sy, plan.ex, plan.ey + 7 - 7 * n + 14 * i, ent));
      }
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
    this.shotSound(ent, skillId, ammoId, sx, sy);
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
    r.volumeAt = (x, y) => this.volumeAt(x, y);
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
    this.hud?.message(text, CHAT_COLOR.error);
  }

  // ------------------------------------------------------------------ skill effects
  /** First playable frame list under a node: either numbered canvases or numbered groups of canvases. */
  static fxNode(node) {
    if (!node) return null;
    if (frames(node).some((f) => f?._canvas)) return node;
    return frames(node)[0] || null;
  }

  /** Weapon swing: each weapon names its sound in info/sfx (swordL, bow, tGlove, gun...). */
  playWeaponSound(ent, sound = 'Attack', x = ent?.x, y = ent?.y) {
    const look = ent === this.player ? this.look : ent?.look;
    if (!look) return;
    sfx.play(`Weapon/${look.weapon?.info?.sfx || 'barehands'}/${sound}`, { volume: ent === this.player ? 1 : this.volumeAt(x, y) });
  }
  /**
   * An arrow, star or bullet leaving: the weapon's Attack2, from where it starts. Not without ammo (Soul Arrow, Shadow
   * Claw), nor for the skills that send their own shot (Hurricane, the Battleship's guns, homing shots...).
   */
  shotSound(ent, skillId, ammoId, x, y) {
    if (!ammoId || SILENT_SHOTS.has(skillId)) return;
    if (ent === this.player && this.buffs.some((b) => [...SOUL_ARROWS, 4121006].includes(b.source))) return;
    this.playWeaponSound(ent, 'Attack2', x, y);
  }
  /** A sound made at x, y: full within 250px of you, fading to 40% at 1000px. */
  volumeAt(x, y) {
    const d = Math.hypot(x - this.player.x, y - this.player.y);
    return (d < 250 ? 100 : d <= 1000 ? 120 - 0.08 * d : 40) / 100;
  }

  /**
   * The third argument is unused (the weapon's swing plays with the attack's trail).
   * branch: 'effect' when cast, 'affected' on whoever a party buff reached (no sound: the caster's played).
   */
  async playSkillEffect(id, ent, _unused = false, branch = 'effect', rate = 1) {
    // others' casts are silent, apart from boarding the Battleship
    if (branch === 'effect' && (ent === this.player || id === BATTLESHIP) && !MONSTER_MAGNETS.has(id)) {
      const use = id === GRENADE ? 'Use2' : id === BLAST ? BLAST_USE[this.activeCharge()?.id] || 'Use' : 'Use';
      sfx.play(`Skill/${pad(id, 7)}/${use}`);
    }
    const node = this.byCharLevel(await this.skills?.ensure(id), ent);
    if (branch !== 'effect') { const fx = Game.fxNode(node?.[branch]); if (fx) this.pushEffect(fx, ent, rate); return; }
    // a skill with an effect per pose (Brandish: effect/0 with brandish1, effect/1 with brandish2) plays the one
    // that goes with the pose being used
    const posed = node?.action && Object.entries(node.action).find(([, a]) => a === ent?.attack)?.[0];
    const own = posed !== undefined && node.effect?.[posed] && !node.effect[posed]._canvas ? node.effect[posed] : null;
    if (own) { this.pushEffect(own, ent, rate); return; }
    // otherwise effect, then effect0, effect1... all start together (their blank first frames hold the later ones
    // back), up to the first missing one; Crusher's go up to effect<attackCount>. None without an `effect`.
    if (!node?.effect) return;
    const last = CRUSHERS.has(id) ? (this.skills.levelData(id)?.attackCount ?? 0) : Infinity;
    const layers = [node.effect];
    for (let i = 0; i <= last && node[`effect${i}`]; i++) layers.push(node[`effect${i}`]);
    for (const n of layers) { const fx = Game.fxNode(n); if (fx) this.pushEffect(fx, ent, rate); }
  }
  /**
   * The first-job attacks' effect and hit art changes with the caster's level: CharLevel/10, 15, 20 and 25 each
   * take over from that level up.
   */
  byCharLevel(node, ent) {
    const tiers = node?.CharLevel, level = ent === this.player ? this.stats?.level : ent?.level;
    if (!tiers || !level) return node;
    const n = Math.max(0, ...Object.keys(tiers).map(Number).filter((k) => k <= level));
    return n ? { ...node, ...tiers[n] } : node;
  }
  /** One effect layer on `ent`, following it, at `rate` (an attack's speed scale); a `fixed` one never flips. */
  async pushEffect(node, ent, rate = 1) {
    const anim = new Anim(node, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, follow: ent, rate, fixed: !!node.fixed });
  }

  /**
   * A skill's hit effect on what it struck, as the client does it (HeavenClient Mob::show_effect): on the
   * monster's head point (its frame's head vector, mirrored with the monster) and facing the way the attacker
   * faces. Without a head point, the middle of its body.
   */
  /**
   * One damage line's sound: the skill's Hit, or the monster's Damage when there is none (a miss: Hit only).
   * A cash star or bullet (cash) has its own Hit instead, on the first line that hurt; Avenger keeps the skill's.
   */
  hitSound(id, mob, d, line, cash = 0) {
    const volume = mob ? this.volumeAt(mob.x, mob.y) : 1;
    const damage = () => { if (d > 0 && mob?.kind === 'Mob') sfx.play(`Mob/${pad(Number(mob.spawn.id), 7)}/Damage`, { volume }); };
    const hitOr = (path) => sfx.has(path).then((found) => (found ? sfx.play(path, { volume }) : damage()));
    if (cash && !AVENGERS.has(id)) {
      if (line > 0 || !(d > 0)) damage(); else hitOr(`CashEffect/${pad(cash, 8)}/Hit`);
      return;
    }
    const hit = id && !(FIRST_HIT_ONLY.has(id) && (line > 0 || (id === 3101005 && !(d > 0))));
    if (hit) hitOr(`Skill/${pad(id, 7)}/Hit`); // 7-digit keys (0001000); Cygnus/Aran ids are 8
    else damage();
  }
  async playHitEffect(id, mob, by = this.player, dmgs = [1], variant = null, cash = 0) {
    const node = id ? this.byCharLevel(await this.skills?.ensure(id), by) : null;
    const fx = Game.fxNode(variant !== null && node?.hit?.[variant] ? node.hit[variant] : node?.hit);
    if (fx) await this.assets.preload(new Anim(fx, false).frames);
    // every damage line is its own blow, on the same beat as its number: Magic Claw's two lines sound twice, Lucky
    // Seven's two stars twice... (a miss makes no monster damage sound)
    dmgs.forEach((d, line) => this.after(lineDelay(id, line, ...this.lineTiming(by)), () => {
      this.hitSound(id, mob, d, line, cash);
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
    this.shotSound(from, skillId, ammoId, sx, sy);
    this.shots.push({ anim, sx, sy, tx, ty, t: 0, dur, flip: tx > sx, onHit });
  }

  updateFx(dt) {
    for (const f of this.fx) f.anim.update(dt * 1000 / (f.rate || 1));   // rate: an attack's effect runs at its speed
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
    const draw = (node, x, y, flip, alpha = 1, zoom = 1) => {
      const img = this.assets.image(node);
      if (!img || alpha <= 0) return;
      const o = node.origin || [0, 0];
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(Math.round(x - cam.x), Math.round(y - cam.y));
      if (flip) ctx.scale(-1, 1);
      if (zoom !== 1) ctx.scale(zoom, zoom);
      ctx.drawImage(img, -o[0], -o[1]);
      ctx.restore();
    };
    for (const f of this.fx) {
      const node = f.anim.node;
      if (!node) continue;
      // each frame's own fade (a0 -> a1) and zoom (z0 -> z1)
      if (f.follow) draw(node, f.follow.x, f.follow.y, f.fixed ? false : f.follow.facingRight, f.anim.alpha, f.anim.zoom);
      else draw(node, f.x, f.y, f.flip, f.anim.alpha, f.anim.zoom);
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
    // a monster's numbers are red (crit art on a crit) whoever struck it; blue is only for one being healed
    this.vfx?.damage(target, dmgs, target.kind === 'Mob' || mine ? 'red' : 'blue', skillId, crits, weaponId, scale);
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
    if (performance.now() < (this.boomerangUntil || 0)) return;
    // the original receiver: 44x65 standing, 46x31 lying down
    const prone = p.action === 'prone' || p.action === 'proneStab';
    const pb = prone ? { left: p.x - 23, right: p.x + 23, top: p.y - 31, bottom: p.y } : { left: p.x - 22, right: p.x + 22, top: p.y - 65, bottom: p.y };
    if (this.obstacleHurt(pb, dx, dy)) return;
    for (const m of this.map.life) {
      if (m.kind !== 'Mob' || !m.alive || m.dying || m.src.info?.bodyAttack === 0) continue;
      if (hidden && Number(m.spawn?.id) !== 9400594) continue;   // only the Master Guardian finds you in Dark Sight
      const b = m.hitBox();
      if (b.right < pb.left || b.left > pb.right || b.bottom < pb.top || b.top > pb.bottom) continue;
      // a monster with info/ban/banType 1 (Hogul, the Mirror Ghost...) banishes you to its banMap on touch
      if (Number(m.src.info?.ban?.banType) === 1) this.net?.mobBanishPlayer(Number(m.spawn?.id));
      // thrown the way the monster moved relative to you; climbing up a ladder or rope, it doesn't knock you off
      const knock = p.ladder && dy < 0 ? 0 : m.x - (m.prevX ?? m.x) - dx < 0 ? -1 : 1;
      this.touchAttack(m);
      this.hurtBy(m, m.src.info?.PADamage || 1, false, -1, knock);
      return;
    }
  }
  /**
   * The friendly monster (the last one spawned with damagedByMob) is hurt by a monster whose body overlaps it: one
   * of its damagedBySelectedMob kinds, or any monster if that list is empty. The party leader reports it (or you,
   * alone on the map), at most once every 1.5s, as MOB_DAMAGE_MOB_FRIENDLY; the server works out the damage.
   */
  friendlyMobHit() {
    const f = this.friendlyMob;
    if (!f || !this.map.life.includes(f) || !f.alive || f.dying) return;
    if (!(this.party ? this.party.leader === this.player.id : this.others.size === 0)) return;
    const now = performance.now();
    if (now - (this.friendlyHitAt ?? 0) < 1500) return;
    const sel = f.src?.info?.damagedBySelectedMob, kinds = sel && typeof sel === 'object'
      ? Object.entries(sel).filter(([k]) => !k.startsWith('_')).map(([, v]) => Number(v)) : [];
    const fb = f.hitBox();
    for (const m of this.map.life) {
      if (m === f || m.kind !== 'Mob' || !m.alive || m.dying || m.oid == null) continue;
      if (kinds.length && !kinds.includes(Number(m.spawn?.id))) continue;
      const b = m.hitBox();
      if (b.left < fb.right && fb.left < b.right && b.top < fb.bottom && fb.top < b.bottom) {
        this.net.mobDamageMobFriendly(m.oid, this.player.id, f.oid);
        this.friendlyHitAt = now;
        return;
      }
    }
  }
  /**
   * Monsters whose info has firstAttack or pickUp come after you on their own: each tells the server at most once a
   * second, with how far you are (|dx| / 10 + |dy| / 3, plus 100 while you are dead), as AUTO_AGGRO.
   */
  autoAggro() {
    const now = performance.now(), p = this.player;
    for (const m of this.map.life) {
      if (m.kind !== 'Mob' || m.oid == null) continue;
      const info = m.src?.info || {};
      if (!Number(info.firstAttack) && !Number(info.pickUp)) continue;
      if (now - (m.aggroAt ?? -Infinity) < 1000) continue;
      m.aggroAt = now;
      const far = Math.trunc(Math.abs(Math.round(p.x) - Math.round(m.x)) / 10) + Math.trunc(Math.abs(Math.round(p.y) - Math.round(m.y)) / 3);
      this.net.autoAggro(m.oid, far + (this.dead ? 100 : 0));
    }
  }
  /** A trap's new state, with its sound (Sound/Field.img/<sfx>) where it stands. */
  setObjectState(name, state) {
    const st = this.map?.setObjectState(name, state), o = this.map?.namedObjs.get(String(name));
    if (st?.sfx && o) sfx.play(`Field/${st.sfx}`, { volume: this.volumeAt(o.x, o.y) });
  }
  /**
   * A monster whose body touches an obstacle with mobdamage takes it (over 10: give or take a tenth), at most once a
   * second per monster, sent as FIELD_DAMAGE_MOB.
   */
  obstaclesHitMobs() {
    const obs = this.map.obstacles().filter((o) => Number(o.info.mobdamage) > 0);
    if (!obs.length) return;
    const now = performance.now();
    for (const m of this.map.life) {
      if (m.kind !== 'Mob' || !m.alive || m.dying || m.oid == null || now - (m.fieldHitAt ?? -Infinity) < 1000) continue;
      const b = m.hitBox(true);
      for (let i = obs.length - 1; i >= 0; i--) {
        const r = obs[i].rect;
        if (!(b.left < r.right && r.left < b.right && b.top < r.bottom && r.top < b.bottom)) continue;
        let d = Number(obs[i].info.mobdamage);
        if (d > 10) { const t = Math.trunc(d / 10); d = d - t + Math.floor(Math.random() * (t * 2 + 1)); }
        if (d > 0) { this.net.fieldDamageMob(m.oid, d); m.fieldHitAt = now; }
        break;
      }
    }
  }
  /**
   * Body Pressure on: the monster your body touches takes one line of the skill's physical damage, at most once a
   * second, sent as TOUCH_MONSTER_ATTACK. Not for an admin account (the login's admin byte has 0x80): "Not
   * available with an Admin account."
   */
  touchAttack(m) {
    const now = Date.now(), job = this.stats?.job || 0, level = (id) => this.skills?.levels?.[id]?.level || 0;
    // a full Energy Charge (a Thunder Breaker's in the Cygnus jobs, a Marauder's otherwise), then Body Pressure
    const energy = Math.floor(job / 1000) === 1 ? THUNDER_ENERGY_CHARGE : ENERGY_CHARGE, skills = [];
    if ((this.energy || 0) >= 10000 && level(energy)) skills.push(energy);
    if (level(BODY_PRESSURE) && this.buffs?.some((b) => b.source === BODY_PRESSURE && b.until > now)) skills.push(BODY_PRESSURE);
    for (const skill of skills) {
      if (this.admin & 0x80) { this.hud.message('Not available with an Admin account.', CHAT_COLOR.error); return; }
      const t = performance.now(), at = (this.touchAttackAt ??= {});
      if (t < (at[skill] ?? 0)) continue;
      at[skill] = t + 1000;
      const p = this.player, ld = this.skills.levelData(skill, level(skill)), wcat = Math.floor(this.weaponId() / 10000);
      const h = this.physicalHit(m, wcat % 100, skill, ld, false, null, 0, critical(this, wcat, false));
      this.net?.touchAttack({ skill, mob: m, dmg: h.d, facingLeft: !p.facingRight, speed: this.attackSpeed(skill), pos: p });
      m.hit(h.d, !p.facingRight, false);
      this.damageNumbers(m, [h.d], true, skill, [h.c]);
      this.aranComboHit(h.d);
    }
  }
  /**
   * SESSION_VALUE: a number the map keeps for you, by name. `energy`: Mu Lung Dojo energy. The Pyramid's
   * `massacre_hit` / `_miss` / `_cool` / `_skill`: a cool hit going up shows CoolHit/cool over your head, a skill
   * point (Rage of Pharaoh) going up plays GetParao on you. `PRaid_Team`: redTeam 0, blueTeam 1, else 0xff.
   */
  sessionValue(key, value) {
    const n = parseInt(value, 10) || 0, p = this.player, m = (this.massacre ??= { hit: 0, miss: 0, cool: 0, skill: 0 });
    if (key === 'energy') this.dojoEnergy = n;
    else if (key === 'massacre_hit') m.hit = n;
    else if (key === 'massacre_miss') m.miss = n;
    else if (key === 'massacre_cool') {
      if (n > m.cool && p) this.vfx.flash(this.vfx.E?.CoolHit?.cool, p.x, p.y - this.avatarHeight(), 400, 600);
      m.cool = n;
    } else if (key === 'massacre_skill') {
      if (n > m.skill && p) this.vfx.play('GetParao', p);
      m.skill = n;
    } else if (key === 'PRaid_Team') this.praidTeam = value === 'redTeam' ? 0 : value === 'blueTeam' ? 1 : 0xff;
  }
  /**
   * Mu Lung Dojo (fieldType 14) with full energy (10000): Ctrl and Alt pressed one after the other casts a Dojo skill
   * by the arrow held: Up Bamboo Rain (1009), Left Invincibility (1010), Right Power Explosion (1011), for your job.
   * The first of the two is held back until the next key, or 50ms; anything else lets it through.
   * True when the press is held back or taken.
   */
  dojoKey(k, down) {
    const sc = CODE_TO_SC[k], mod = sc === 0x1d || sc === 0x38, prev = this.dojoMod;
    this.dojoMod = null;
    const on = Number(this.map?.info?.fieldType) === 14 && (this.dojoEnergy || 0) >= 10000 && this.player && !this.dead;
    if (on && down && mod) {
      if (prev && CODE_TO_SC[prev.k] !== sc) return this.dojoSkill();
      this.dojoMod = { k, t: performance.now() };
      return true;
    }
    if (prev) this.input.inject(prev.k, !(!down && prev.k === k));
    return false;
  }
  /** The Dojo skill for the arrow held (none: nothing). */
  dojoSkill() {
    const inp = this.input, base = this.jobSkillBase() * 10000;
    const id = inp.is('up') ? base + 1009 : inp.is('left') ? base + 1010 : inp.is('right') ? base + 1011 : 0;
    if (!id) return false;
    this.skillKeyPressed = true;
    this.useSkill(id);
    this.skillKeyPressed = false;
    return true;
  }
  /** How tall your character's current frame is (from the feet to the top of its highest part). */
  avatarHeight() {
    const p = this.player, parts = this.look.compose(p.action, p.frame) || [];
    return -Math.min(0, ...parts.map((q) => q.y));
  }
  /** The job a beginner skill is numbered from: 0, 1000 (Noblesse), 2000 (Legend) or 2001 (Evan). */
  jobSkillBase() {
    const job = this.stats?.job || 0;
    return Math.floor(job / 100) === 22 || job === 2001 ? 2001 : Math.floor(job / 1000) * 1000;
  }
  /**
   * SHOW_COMBO: the Aran combo count, drawn at the top right from Effect/BasicEff.img/Combo/<tier> (tier 0 under 30,
   * 1 from 30, 2 from 100, 3 from 200): its digits right to left from x 750, 23px apart, at y 169 and 165 by turns
   * (the last digit at 169), and its Combo label at (750, 180). They fade out over 3s; below tier 3 they hop as the
   * count changes (the digits above the lowest non-zero one 4px, the rest 10px, down by 50ms and back by 300ms).
   * At exactly 30, 100 and 200 the ComboCommand/<tier> keys of the combo skills you have (Smash / Drain, Fenrir /
   * Drain, Tempest / Barrier) appear at (800, 215), the second 35px lower, until the combo ends.
   */
  setAranCombo(n) {
    const now = performance.now();
    this.aranCombo = n; this.aranComboAt = now;
    const C = this.vfx?.E?.Combo, cmd = this.vfx?.E?.ComboCommand;
    if (n < 1 || !C) { this.comboArt = null; return; }
    const tier = n >= 200 ? 3 : n >= 100 ? 2 : n >= 30 ? 1 : 0, art = C[tier];
    const digits = [];
    let first = -1;
    for (let v = n, i = 0; i < 5; i++) { const d = v % 10; digits.push(d); if (first < 0 && d > 0) first = i; v = Math.trunc(v / 10); if (!v) break; }
    const parts = digits.map((d, i) => ({ anim: new Anim(art?.[d]), x: 750 - 23 * i, y: i % 2 !== digits.length % 2 ? 165 : 169, hop: i > first ? 4 : 10 }));
    parts.push({ anim: new Anim(art?.Combo), x: 750, y: 180, hop: 0 });
    this.comboArt = { parts, t0: now, hops: tier < 3 };
    this.assets.preload(parts.flatMap((p) => p.anim.frames));
    const pair = { 30: [21100004, 21100005], 100: [21110004, 21100005], 200: [21120006, 21120007] }[n];
    if (pair && cmd?.[tier]) {
      const has = (id) => (this.skills?.levels?.[id]?.level || 0) > 0;
      this.comboCommands = [];
      if (has(pair[0])) this.comboCommands.push({ anim: new Anim(cmd[tier][0]), x: 800, y: 215 });
      if (has(pair[1])) this.comboCommands.push({ anim: new Anim(cmd[tier][1]), x: 800, y: 215 + (this.comboCommands.length ? 35 : 0) });
      this.assets.preload(this.comboCommands.flatMap((p) => p.anim.frames));
    }
  }
  /** 3s after the last count, an Aran's combo ends: back to 0 and CANCEL_BUFF for Combo Ability (the tutorial's at 2000). */
  updateAranCombo(dt) {
    for (const p of [...(this.comboArt?.parts || []), ...(this.comboCommands || [])]) p.anim.update(dt * 1000);
    if (!(this.aranCombo > 0) || performance.now() - (this.aranComboAt ?? 0) <= 3000) return;
    const skill = (this.stats?.job || 0) === 2000 ? 20000017 : 21000000;
    if (!((this.skills?.levels?.[skill]?.level || 0) > 0)) return;
    this.aranCombo = 0; this.comboArt = null; this.comboCommands = [];
    this.net?.cancelBuff(skill);
  }
  drawAranCombo(ctx) {
    const art = this.comboArt, now = performance.now(), ox = UI_W - 800;   // placed from the right edge
    const draw = (p, alpha, dy) => {
      const n = p.anim.node, img = n && this.assets.image(n);
      if (!img || alpha <= 0) return;
      const o = n.origin || [0, 0];
      ctx.save(); ctx.globalAlpha = alpha * p.anim.alpha;
      ctx.drawImage(img, Math.round(p.x + ox - o[0]), Math.round(p.y - o[1] + dy));
      ctx.restore();
    };
    if (art) {
      const t = now - art.t0, alpha = Math.max(0, 1 - t / 3000);
      for (const p of art.parts) {
        const h = art.hops && p.hop ? (t < 50 ? (p.hop * t) / 50 : t < 300 ? p.hop * (1 - (t - 50) / 250) : 0) : 0;
        draw(p, alpha, h);
      }
    }
    for (const p of this.comboCommands || []) draw(p, 1, 0);
  }
  /**
   * An Aran's hit that did damage, with a polearm (weapon type 44) and Combo Ability learned (the tutorial's combo
   * skill for a job 2000 beginner), counts toward the combo: ARAN_COMBO_COUNTER.
   */
  aranComboHit(damage) {
    if (!(damage > 0) || Math.floor(this.weaponId() / 10000) % 100 !== 44) return;
    const skill = (this.stats?.job || 0) === 2000 ? 20000017 : 21000000;
    if (this.skills?.levels?.[skill]?.level > 0) this.net?.aranComboCounter();
  }
  /**
   * An obstacle (a trap whose current state has `obstacle`) touching your body hurts you: its damage (over 10: give or
   * take a tenth), or with forceHP everything above that (all of it when you have no more); thrown along its dir
   * (90 - dir x 30 degrees, 270 strong; mirrored when the trap is), or on the way you were moving when it has none. Sent as
   * TAKE_DAMAGE -3 with its disease (skill << 8 | level); its targetField then takes you there. Returns whether it hit.
   */
  obstacleHurt(pb, dx, dy) {
    const obs = this.map?.obstacles() || [];
    for (let i = obs.length - 1; i >= 0; i--) {
      const { rect: r, info, obj } = obs[i];
      if (!(pb.left < r.right && r.left < pb.right && pb.top < r.bottom && r.top < pb.bottom)) continue;
      let d = Number(info.damage) || 0;
      if (d > 10) { const t = Math.trunc(d / 10); d = d - t + Math.floor(Math.random() * (t * 2 + 1)); }
      const force = info.forceHP === undefined ? -1 : Number(info.forceHP), hp = this.stats?.hp || 0;
      if (force >= 0) d = force < hp ? hp - force : hp;
      const disease = Number(info.disease) && Number(info.level) ? ((Number(info.disease) & 0xff) << 8) | (Number(info.level) & 0xff) : 0;
      if (d > 0) {
        const p = this.player, dir = Number(info.dir) || 0;
        // the push: along dir, or 270 the way you were moving (and 270 up unless you were falling)
        let vx, vy;
        if (dir) { const a = ((90 - dir * 30) * Math.PI) / 180; vx = Math.round(Math.cos(a) * KNOCKBACK); vy = -Math.round(Math.sin(a) * KNOCKBACK); if (obj.f) vx = -vx; }
        else { vx = dx < 0 ? -KNOCKBACK : dx > 0 ? KNOCKBACK : 0; vy = dy < 1 ? -KNOCKBACK : 0; }
        this.net.takeObstacleDamage(d, disease);
        this.vfx?.damage(p, [d], 'violet');
        setExpression(p, 1, HIT_FACE_TIME);
        this.standUp();
        if ((vx || vy) && !this.holdsStance()) {
          if (vy < 0 && p.fh) p.y = Math.floor(p.y - 1);
          if (vy < 0) { p.fh = null; p.ladder = null; }
          p.vx = vx; if (vy) p.vy = vy;
        }
        p.attack = null;
        this.invincible = HIT_PROTECTION; this.missed = false;
      }
      const target = Number(info.targetField) || 0;
      if (target && target !== 999999999) this.net.directionField(target);
      return true;
    }
    return false;
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
    const T = (k) => this.totalStat(k);   // your stats with equipment and Maple Warrior
    const mobLv = info.level || 0, acc = clamp(info.acc || 0, 0, 999);
    let avoid = clamp(this.avoidability() + buff('avoid'), 0, 999);
    if (mobLv > lv) avoid = Math.max(0, avoid - Math.trunc((mobLv - lv) / 2));
    if (magic) {
      if (acc <= rand(avoid * 0.1, avoid)) return 0;
      const mad = clamp(info.MADamage ?? power, 0, 1999), mdd = clamp(this.equipStat('mdef') + buff('mdef'), 0, 1999);
      const d = Math.trunc(rand(mad * 0.75, mad * 0.8) * mad * 0.01 - (T('dex') / 6 + T('str') / 7 + T('luk') / 5 + mdd) * (cls === 2 ? 0.3 : 0.25));
      return d === 0 ? 0 : Math.max(1, d);
    }
    const chance = (avoid / (acc * 4.5)) * 100;
    if (Math.random() * 100 < (cls === 4 ? clamp(chance, 5, 95) : clamp(chance, 2, 80))) return 0;
    const pad = clamp(power, 0, 1999), pdd = clamp(this.equipStat('wdef') + buff('wdef'), 0, 1999), std = this.standardPdd(cls, lv);
    const k = Math.trunc(cls === 1 ? (T('luk') + T('dex')) * 0.25 + T('int') / 9 + (T('str') * 2) / 7 : T('luk') * 0.25 + T('int') / 9 + (T('dex') * 2) / 7 + T('str') * 0.4);
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
    if (performance.now() < (this.boomerangUntil || 0)) return;   // mid Boomerang Step
    let damage = this.damageTaken(m, power, magic);
    // a deadly attack leaves you 1 HP
    if (damage > 0 && attack?.deadlyAttack) damage = Math.max(1, (this.stats?.hp || 1) - 1);
    const fromRight = m.x > p.x;
    // while Chakra winds up, blows do only its x%
    if (damage > 0 && this.chakra) damage = Math.max(1, Math.trunc((damage * this.chakra.x) / 100));
    // Shadow Shifter: at its prop chance the blow (hit or miss) is dodged - no number, no knock-back
    const shifter = SHIFTERS[this.stats?.job];
    if (shifter && this.skills.level(shifter) && !((this.map?.info?.fieldLimit || 0) & 2) && Math.random() * 100 < (this.skills.levelData(shifter)?.prop || 0)) {
      this.net.takeDamage({ damage: -1, mobId: m.spawn.id, oid: m.oid, direction: fromRight ? 1 : 0, from });
      this.playSkillEffect(shifter, p, false, 'special');
      setExpression(p, 2, HIT_FACE_TIME);
      this.invincible = HIT_PROTECTION; this.missed = true;
      return;
    }
    if (damage <= 0) {   // MISS: no knockback or blinking, but the same 1.5s before the next blow as a hit
      this.net.takeDamage({ damage: 0, mobId: m.spawn.id, oid: m.oid, direction: fromRight ? 1 : 0, from });
      this.petHitPots(m, 0, from);
      this.vfx?.damage(p, [0], 'violet');
      this.invincible = HIT_PROTECTION; this.missed = true;
      return;
    }
    this.net.takeDamage({ damage, mobId: m.spawn.id, oid: m.oid, direction: fromRight ? 1 : 0, from });
    // Meso Guard: half the blow is paid in mesos (x% of it), as far as they go; the number shows what you lose
    const guard = this.buffs?.some((b) => b.source === MESO_GUARD && b.until > Date.now()) && this.skills.levelData(MESO_GUARD);
    let lost = damage;
    if (guard?.x) {
      let absorbed = Math.trunc(Math.min(199999, damage) / 2);
      if (this.meso < Math.trunc((absorbed * guard.x) / 100)) absorbed = Math.trunc((this.meso * 100) / guard.x);
      if (absorbed > 0) { lost = damage - absorbed; this.playSkillEffect(MESO_GUARD, p, false, 'special'); }
    }
    this.petHitPots(m, lost, from);
    this.vfx?.damage(p, [lost], 'violet');
    if (CHAR_DAM[from]) sfx.play(`Mob/${pad(Number(m.spawn.id), 7)}/${CHAR_DAM[from]}`);
    setExpression(p, 1, HIT_FACE_TIME);
    this.standUp();
    // the 270/270 impulse adds to how you were already moving, up to 270 each way: walking or jumping into the
    // monster you're thrown back less, and falling onto it only slows your fall
    const impact = (v, k) => (k > 0 ? (v < k ? Math.min(v + k, k) : v) : (v > k ? Math.max(v + k, k) : v));
    if (knock && this.holdsStance()) knock = 0;
    if (knock) {
      if (p.fh) p.y = Math.floor(p.y - 1);
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
    const n = s.action || 1;
    sfx.play(`Mob/${pad(Number(m.spawn.id), 7)}/Skill${n === 17 ? 'F' : n}`, { volume: this.volumeAt(m.x, m.y) });
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
   * animation loops over you (or at your feet) until the server lifts it; once its time is up the client asks for
   * that every frame (see updateDiseases). While it lasts, Stun
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
  hasDisease(skill) { return (this.diseases || []).some((d) => d.skill === skill); }
  /**
   * Your curses last until the server lifts them (CANCEL_BUFF); while one of Stun, Poison, Seal, Darkness,
   * Weakness, Curse, Slow, Reverse and the few other stats in EXPIRY_CHECKED is within 100ms of its end or past
   * it, CANCEL_DEBUFF goes out every frame. Other players' curses still end on their own timer.
   */
  updateDiseases(dt) {
    const now = Date.now();
    for (const ent of [this, ...this.others.values()]) {
      if (!ent.diseases?.length) continue;
      if (ent !== this) ent.diseases = ent.diseases.filter((d) => d.until > now);
      for (const d of ent.diseases) d.anim?.update(dt * 1000);
    }
    const due = (d) => now - d.until > -100 && ((BigInt.asUintN(64, BigInt(d.m2 ?? 0)) & EXPIRY_CHECKED.low) || (BigInt.asUintN(64, BigInt(d.m1 ?? 0)) & EXPIRY_CHECKED.high));
    if (this.diseases?.some(due)) this.net?.cancelDebuff();
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
    sfx.play(`Mob/${pad(Number(m.spawn.id), 7)}/Attack${a.n === 9 ? 'F' : a.n}`, { volume: this.volumeAt(m.x, m.y) });
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
  /**
   * The pickup key: one request at a time (until the server answers, then 30ms; released after 1.5s if it never
   * does), for the first drop in arrival order whose landing point is within x-25..x+25, y-50..y+10 of your feet,
   * that has landed, came as a pickable drop, isn't pickUpBlock, is yours (or your party's, or anyone's, or 15s old)
   * and wasn't asked for in the last 3s.
   */
  tryPickup() {
    if (this.hidden()) return;
    const now = performance.now();
    if (this.pickupBusy && now - this.pickupBusy < 1500) return;
    if (now < (this.pickupFree || 0)) return;
    const p = this.player, me = p.id;
    for (const [oid, d] of this.drops) {
      if (d.pickedBy || !d.landed || (d.mode !== 1 && d.mode !== 2)) continue;
      if (d.x < p.x - 25 || d.x >= p.x + 25 || d.y < p.y - 50 || d.y >= p.y + 10) continue;
      if (now - (d.tryAt || -Infinity) < 3000) continue;
      if (!d.meso && Number(this.windows.info(d.id)?.pickUpBlock)) continue;
      const ours = !d.dropper || d.type >= 2 || (d.type === 0 && d.owner === me) || (d.type === 1 && d.owner === this.party?.id) || now - (d.born || 0) > 15000;
      if (!ours) continue;
      d.tryAt = now; this.pickupBusy = now;
      this.net.pickup(oid, { x: Math.round(p.x), y: Math.round(p.y) });
      return;
    }
  }
  /** The server answered an exclusive request: pickup may go again 30ms later. */
  pickupAnswered() { if (this.pickupBusy) { this.pickupBusy = 0; this.pickupFree = performance.now() + 30; } }

  handleClicks() {
    for (const c of this.input.clicks) {
      // a double-click on a window (or the status bar) is the window's, never the NPC behind it
      if (this.windows?.top(c.x / UI_SCALE, c.y / UI_SCALE) || this.statusBar?.contains?.(c.x / UI_SCALE, c.y / UI_SCALE)) continue;
      const wx = c.x + Math.round(this.cam.x), wy = c.y + Math.round(this.cam.y);
      // a click on your own chalkboard puts it away
      const cr = this.player.chalk && this.player.chalkRect;
      if (cr && wx >= cr.x && wx < cr.x + cr.w && wy >= cr.y && wy < cr.y + cr.h) { this.closeChalkboard('The chalkboard has closed.'); return; }
      // the quest icon over an NPC's head opens it with one click
      for (const e of this.vfx?.questIcons.keys() || []) {
        const r = this.vfx.questIconRect(e);
        if (r && e.oid !== null && wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h) { this.interactNpc(e); return; }
      }
      if (c.single) continue;
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
    if (this.dead) st = 'dead';
    else if (p.seat) st = 'sit';
    else if (p.ladder) st = p.ladder.l ? 'ladder' : 'rope';
    else if (!p.fh) st = this.airAction();
    else if (p.action === 'prone') st = 'prone';
    else if (p.action.startsWith('walk')) st = 'walk';
    return stanceByte(st, !p.facingRight);
  }

  /**
   * Your movement for the server and everyone watching, recorded as the client does: each frame adds to the last
   * element (where you ended up, how fast you were then moving, in px/s) until the foothold, the stance or the way
   * you are moving changes; once half a second of movement has gathered it all goes out, in the air too. Standing
   * still sends nothing. Watchers draw
   * each element as a curve through those speeds, so they must be the real ones (also on ropes and slopes).
   */
  syncMovement(dt) {
    const p = this.player;
    if (!dt) return;
    const prev = this.movePos || { x: p.x, y: p.y };
    this.movePos = { x: p.x, y: p.y };
    if (Math.abs(p.x - prev.x) > 300 || Math.abs(p.y - prev.y) > 300) { this.flushMovement(); this.moveBuf = []; this.moveTotal = 0; this.lastSent = null; this.downOfh = 0; return; }
    // a jump starts with its speed (cmd 1); a down-jump with you lifted off the floor you drop through, lying then
    // in the air (cmd 15), and every step until you land names that floor, so those watching let you through it
    const ev = this.moveEvent, left = !p.facingRight;
    this.moveEvent = null;
    const air = this.airAction();
    // two instant steps at one spot, before and after a change, so those watching snap rather than slide
    const pair = (at, before, after) => { const s = { ...at, vx: 0, vy: 0, duration: 0 }; this.moveBuf.push({ ...s, ...before }, { ...s, ...after }); };
    const here = { cmd: 0, x: Math.round(p.x), y: Math.round(p.y) };
    // leaving a ladder or rope: where you let go, first still on it, then off it
    if (ev?.leave) pair(here, ev.leave, { fh: 0, stance: stanceByte(air, left) });
    if (ev?.kind === 'jump') this.moveBuf.push({ cmd: 1, rx: Math.round(ev.vx), ry: Math.round(ev.vy), stance: stanceByte(air, left), duration: 0 });
    if (ev?.kind === 'down') {
      pair({ cmd: 15, x: Math.round(ev.x), y: Math.round(ev.y) - 1, ofh: ev.ofh }, { fh: ev.ofh, stance: stanceByte('prone', left) }, { fh: 0, stance: stanceByte(air, left) });
      this.downOfh = ev.ofh;
    }
    // catching a ladder or rope: two instant steps on it, first as you were, then on it, so those watching snap onto
    // it rather than slide over to it
    if (ev?.kind === 'grab' && p.ladder) pair(here, { fh: ev.fh, stance: ev.stance }, { fh: -(p.ladder.id || 0), stance: this.currentStance() });
    // the frame you land on still counts as in the air, stopped where you meet the floor; the ground starts after it
    const landed = !!p.fh && this.wasAirborne && !this.dead;
    this.wasAirborne = !p.fh && !p.ladder;
    // the speeds are the physics' own, not how far you moved this frame: catching a rope snaps you onto it, and that
    // jump must not read as a burst of speed that carries you past it for those watching
    const el = { cmd: 0, x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx || 0), vy: Math.round(p.fh ? 0 : p.vy || 0),
      // on a ladder or rope its id, negative: those watching put you on it, in its layer (0 would leave you in the
      // layer of the last floor, sometimes behind it)
      fh: this.dead ? 0 : p.ladder ? -(p.ladder.id || 0) : p.fh?.id || 0, stance: this.currentStance(), duration: dt * 1000 };
    if (landed) Object.assign(el, { vy: 0, fh: 0, stance: stanceByte(air, left) });
    if (this.downOfh) Object.assign(el, { cmd: 15, ofh: this.downOfh });
    if (p.fh || p.ladder) this.downOfh = 0;
    const last = this.moveBuf[this.moveBuf.length - 1];
    if (last && (last.cmd === 0 || last.cmd === 15) && last.cmd === el.cmd && last.ofh === el.ofh && last.fh === el.fh && last.stance === el.stance && Math.sign(last.vx) === Math.sign(el.vx) && Math.sign(last.vy) === Math.sign(el.vy)) {
      Object.assign(last, { x: el.x, y: el.y, vx: el.vx, vy: el.vy }); last.duration += el.duration;
    } else this.moveBuf.push(el);
    this.moveTotal = (this.moveTotal || 0) + el.duration;
    if (this.moveTotal >= MOVE_FLUSH) this.flushMovement();
  }
  /** Send everything gathered. */
  flushMovement() {
    const send = this.moveBuf || [], first = send[0], lastSent = this.lastSent;
    if (!first || !this.net) return;
    this.moveBuf = []; this.moveTotal = 0;
    // standing where we last were: nothing to tell
    if (send.length === 1 && lastSent && first.x === lastSent.x && first.y === lastSent.y && first.stance === lastSent.stance && !first.vx && !first.vy) return;
    const start = lastSent ? { x: lastSent.x, y: lastSent.y } : { x: first.x, y: first.y };
    this.net.move(start, send.map((m) => ({ ...m, duration: Math.round(m.duration) })));
    this.lastSent = send[send.length - 1];
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
    const p = (this.dead && this.ghostAt(this.player)) || this.player, f = (this.camF ??= { x: p.x, y: p.y - CAM_LIFT });
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

  /** System Option SCREEN SIZE / UI SIZE: the view, the bar and the open windows follow the new size. */
  setResolution() {
    applyResolution();
    this.cam.w = VIEW_W; this.cam.h = VIEW_H;
    this.statusBar?.layout(UI_W, UI_H);
    this.placeUi?.();
    this.touch?.render();
    for (const w of this.windows?.order || []) {
      if (w === this.csWin) { w.x = (UI_W - w.w) >> 1; w.y = (UI_H - w.h) >> 1; continue; }
      this.windows.fit(w);
    }
    if (this.map && this.camF) this.placeCamera();
  }

  render() {
    this.fitBacking();
    const ctx = this.ctx, map = this.map, p = this.player;
    if (this.inCashShop) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.save(); ctx.scale(UI_SCALE, UI_SCALE); this.windows?.draw(ctx); ctx.restore();
      return;
    }
    const cam = { ...this.cam, x: Math.round(this.cam.x) + (this.shake?.dx || 0), y: Math.round(this.cam.y) + (this.shake?.dy || 0) };
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    map.drawBacks(ctx, cam, false);

    // shop owners and their booths go down first: everyone else walks in front of a shop
    const inShop = (e) => e.box?.type === 4;
    const chars = this.drawOrder(ctx, cam, inShop), playerLayer = this.playerZ.page;
    for (let l = 0; l < 8; l++) {
      map.drawLayer(ctx, cam, l);
      for (const e of map.life) if (e.kind !== 'Npc' && (e.fh?.layer ?? 7) === l) e.draw(ctx, cam, this.assets);
      if (this.reactors) for (const r of this.reactors.values()) if (r.layer === l) r.draw(ctx, cam, this.assets);
      if (l === playerLayer) this.drawShip(ctx, cam);
      if (l === playerLayer) this.drawDoors(ctx, cam);
      if (l === playerLayer) this.vfx?.drawTombs(ctx, cam);   // behind every character, so a ghost floats in front of its stone
      if (l === playerLayer) {
        for (const m of this.boards.merchants.values()) this.boards.drawMerchant(ctx, cam, m);   // Hired Merchants, behind people
        for (const rp of this.others.values()) if (inShop(rp)) this.drawChar(ctx, cam, rp, rp.look, false);
        if (inShop(p)) { this.drawChar(ctx, cam, p, this.look, true); this.questAlert?.draw(ctx, cam); }
      }
      for (const c of chars) if (c.page === l) c.draw();
      if (l === playerLayer) this.drawMists(ctx, cam);   // over the characters and monsters standing in it
    }
    for (const sm of this.summons.values()) sm.draw(ctx, cam);
    this.drawDrops(ctx, cam);
    map.drawPortals(ctx, cam);
    this.drawRingFx(ctx, cam);
    this.drawFx(ctx, cam);
    map.drawBacks(ctx, cam, true);
    this.drawBalloons(ctx, cam);
    this.vfx?.drawWorld(ctx, cam);
    this.weather.draw(ctx);
    this.mapleTV.draw(ctx, cam, this.map);
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
    this.direction?.draw(ctx, VIEW_W / 2, VIEW_H / 2);
    this.vfx?.drawScreen(ctx);
    const ui = !this.uiLocked;         // a locked UI (a scene) shows none of it but the scrolling notice
    ctx.save(); ctx.scale(UI_SCALE, UI_SCALE);   // the interface, at System Option's UI SIZE
    if (ui) {
      this.vfx?.drawHud(ctx);
      this.drawAranCombo(ctx);
      this.weather.drawNotice(ctx);
      this.avatarBanner.draw(ctx);
      this.drawClock(ctx);
      this.dojo?.draw(ctx);
      this.questMsg?.draw(ctx);         // quest progress, near the top
      this.drawQuestTimers(ctx);
      this.hud?.draw?.(ctx);            // what you gain, in the lower-right corner
    }
    this.hud?.drawBanner?.(ctx);        // the server's scrolling notice, under the bar and every window
    if (ui) {
      this.statusBar?.draw(ctx);
      this.windows?.draw(ctx);
    }
    this.vfx?.drawBoss(ctx);
    ctx.restore();
    const dark = this.darkness;
    if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  }

  /**
   * A character's or pet's place in the draw order: the page and zMass of the foothold it is on (a ladder or rope:
   * its page, zMass 0), kept while in the air; page 7 before it has stood anywhere.
   */
  zFrom(fhId, last) {
    if (fhId > 0) { const f = this.map?.fh?.get(fhId); if (f) return { page: f.layer, zMass: f.zMass }; }
    if (fhId < 0) { const l = this.map?.ladders?.find((x) => x.id === -fhId); if (l) return { page: Number(l.page) || 0, zMass: 0 }; }
    return last || { page: 7, zMass: 0 };
  }
  /**
   * Characters, pets and NPCs, each drawn in its page: a lower zMass in front, then other players, their pets, NPCs,
   * you and your pets, in that order. A pet up a ladder on its owner's back goes on right after them.
   */
  drawOrder(ctx, cam, inShop) {
    const p = this.player, list = [];
    const put = (z, slot, draw) => list.push({ page: z.page, k: -10 * z.zMass + slot, draw });
    for (const e of this.map.life) if (e.kind === 'Npc') put(e.fh ? { page: e.fh.layer, zMass: e.fh.zMass } : { page: 7, zMass: 0 }, 5, () => e.draw(ctx, cam, this.assets));
    const onBack = (owner) => { for (const pet of this.pets.values()) if (pet.onBack && pet.owner === owner) pet.draw(ctx, cam); };
    for (const rp of this.others.values()) {
      rp.z = this.zFrom(rp.fhId, rp.z);
      if (!inShop(rp)) put(rp.z, 2, () => { this.drawChar(ctx, cam, rp, rp.look, false); this.drawDiseases(ctx, cam, rp, rp.diseases); onBack(rp.id); });
    }
    for (const pet of this.pets.values()) {
      pet.z = pet.mine ? (pet.fh ? { page: pet.fh.layer, zMass: pet.fh.zMass } : pet.z || { page: 7, zMass: 0 }) : this.zFrom(pet.fhId, pet.z);
      if (!pet.onBack) put(pet.z, pet.mine ? 8 : 3, () => pet.draw(ctx, cam));
    }
    this.playerZ = p.ladder ? { page: Number(p.ladder.page) || 0, zMass: 0 }
      : p.fh ? { page: p.fh.layer, zMass: p.fh.zMass } : this.playerZ || { page: 7, zMass: 0 };
    if (!inShop(p)) put(this.playerZ, 7, () => { this.drawChar(ctx, cam, p, this.look, true); this.drawDiseases(ctx, cam); this.questAlert?.draw(ctx, cam); onBack(p.id); });
    return list.sort((a, b) => a.k - b.k);
  }

  /**
   * Shadow Partner: Skill/<id>/special/<your action>, on your frame, 30px behind you (50px under you on a ladder or
   * rope); nothing for an action it has no art for.
   */
  drawPartner(ctx, ent, sx, sy, local) {
    const job = local ? this.stats?.job : ent.job, id = Math.floor((job || 0) / 1000) === 1 ? SHADOW_PARTNERS[1] : SHADOW_PARTNERS[0];
    const node = this.skills?.node(id);
    if (!node) { this.skills?.ensure(id); return; }
    const frames = node.special?.[ent.action];
    if (!frames) return;
    if (!frames.loaded) { frames.loaded = true; this.assets.preload(Object.values(frames).filter((f) => f?._canvas)); }
    const keys = Object.keys(frames).filter((k) => /^\d+$/.test(k));
    const fr = keys.length && frames[keys[(ent.frame || 0) % keys.length]], img = fr && this.assets.image(fr);
    if (!img) return;
    const climbing = /^(ladder|rope)$/.test(ent.action), dir = ent.facingRight ? 1 : -1;
    const x = climbing ? sx : sx - dir * 30, y = climbing ? sy + 50 : sy, o = fr.origin || [0, 0];
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); if (ent.facingRight) ctx.scale(-1, 1); ctx.drawImage(img, -o[0], -o[1]); ctx.restore();
  }
  drawChar(ctx, cam, ent, look, local) {
    // on a mount (not as a ghost: dead clears it): the mount, its saddle and mount equipment, the rider
    // on it; the mount's frames run on their own clock from when its pose last changed
    const mountId = local ? this.riding?.item : ent.mount, mount = ent.action !== 'dead' && this.mountData(mountId)?.img;
    let parts;
    if (mount) {
      const worn = local ? this.inventory?.equipped || {} : null, eqs = ent.lookData?.equips || {};
      const gear = (local ? [worn[-19]?.id, worn[-20]?.id] : [eqs[19], eqs[20]]).map((g) => g && this.mountData(g)?.img).filter(Boolean);
      const tired = local ? this.player.mountTired : ent.mountTired, pose = mountPose(mountId, ent.action, tired);
      if (ent.mountPose !== pose) { ent.mountPose = pose; ent.mountT0 = performance.now(); }
      parts = composeMounted(look, mount, mountId, ent.action, ent.expr, performance.now() - ent.mountT0, tired, gear);
    } else parts = look.compose(ent.action, ent.frame, ent.expr);
    // dead: the ghost (body action "dead") circles over its tombstone, and all that is drawn of them goes with it
    const dead = ent.action === 'dead', ghost = dead ? this.ghostAt(ent) : null;
    const gx = ghost ? ghost.x - ent.x : 0, gy = ghost ? ghost.y - ent.y : 0;
    const sx = ent.x + gx - cam.x, sy = ent.y + gy - cam.y;
    const chair = local ? ent.seat?.item : ent.action === 'sit' && ent.chair;
    if (chair) this.drawChair(ctx, chair, sx, sy, ent.facingRight);
    // while protected after a hit, alternate gray and normal every 60ms, as the original does (never a ghost)
    const blink = local && !dead && this.invincible > 0 && !this.missed && Math.floor(this.invincible / 0.06) % 2 === 0;
    if (performance.now() < ((local ? this.boomerangUntil : ent.boomerangUntil) || 0)) return;   // gone mid Boomerang Step
    this.drawItemFx(ctx, cam, ent, parts, false, gx, gy);
    this.drawEquipFx(ctx, cam, ent, parts, false, gx, gy);
    if (blink) { ctx.save(); ctx.filter = 'brightness(0.502)'; }   // the client tints to 0x808080, not grey
    const seeThrough = local ? this.hidden() || this.gmHidden : ent.hidden;   // Dark Sight / Wind Walk / GM hide: half alpha
    if (!dead && (local ? this.partner() : ent.partner)) this.drawPartner(ctx, ent, sx, sy, local);
    const mirror = drawnRight(ent);
    drawParts(ctx, this.assets, parts, sx, sy, mirror, (seeThrough ? 0.5 : 1) * (ghost?.alpha ?? 1), !dead);
    if (blink) ctx.restore();
    this.drawItemFx(ctx, cam, ent, parts, true, gx, gy);
    this.drawEquipFx(ctx, cam, ent, parts, true, gx, gy);
    this.drawRingFx(ctx, cam, ent);
    // a shop's sign: a booth around its owner (in front of them) or a board over the head; name tags on top
    if (ent.box?.type === 4) this.boards.drawShopBoard(ctx, this.cam, ent, sx, sy);
    if (ent.chalk) this.drawChalkboard(ctx, ent, sx, sy); else ent.chalkRect = null;
    if (!dead) this.drawCombo(ctx, ent, sx, sy, local ? this.comboValue() : ent.combo || 0);
    this.drawCharTags(ctx, ent, look, local, Math.round(sx), Math.round(sy) + 4);
  }



  drawDrops(ctx, cam) {
    for (const d of this.drops.values()) {
      const node = d.anim.node;
      const img = this.assets.image(node);
      if (!img) continue;
      const x = d.cx, y = d.landed && !d.pickedBy ? Math.trunc(d.y + 3 * Math.sin(d.phase)) : d.cy;
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
    // a pet's balloon sits on top of the pet: its standing frame's height, so a tall pet's is higher
    for (const pet of this.pets.values()) {
      if (!pet.chat || pet.hidden) continue;
      const at = pet.drawPos(), top = Number(pet.data?.stand0?.[0]?.origin?.[1]) || 33;
      this.vfx?.drawBalloon(ctx, cam, { x: at.x, y: at.y - top + 77 }, pet.chat.text, `pet/${pet.chat.style || 0}`);
    }
    // NPCs: the arrow just over the head; not while a quest icon is there
    for (const e of this.map.life) {
      if (!e.chat || this.vfx?.questIcons.has(e)) continue;
      const top = e.anims.stand?.frames[0]?.origin?.[1] ?? 80;
      this.vfx?.drawBalloon(ctx, cam, { x: e.x, y: e.y - top + 77 }, e.chat.text, 'npc');
    }
    const list = [this.player, ...this.others.values()].filter((e) => e.chat);
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    for (const e of list) {
      const text = `${e.name} : ${e.chat.text}`, quote = (e === this.player ? this.look : e.look)?.chatBalloon;
      // a ghost speaks from where it floats, in the dead balloon
      const ghost = e.action === 'dead' ? this.ghostAt(e) : null, style = ghost ? 'dead' : quote ? String(quote) : '0';
      if (this.vfx?.drawBalloon(ctx, cam, ghost || e, text, style)) continue;   // a quote ring's balloon   // ChatBalloon.img; the drawn box is the offline fallback
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

/** What pets wear (look slots 14 and 21-48): never drawn on the character. */
const isPetPart = (n) => n === 14 || (n >= 21 && n <= 48);
const WEDDING_RINGS = [1112803, 1112806, 1112807, 1112809];

/**
 * Item ids to draw from our own equipped inventory: slot -N regular, -(N+100) its cash cover, -111 the cash weapon (kept
 * alongside the weapon). Pet equipment is not the character's.
 */
export function equippedIds(equipped) {
  const bySlot = {};
  for (const [k, it] of Object.entries(equipped)) {
    const s = Number(k);
    if (s > -100) bySlot[-s] ??= it.id;
  }
  for (const [k, it] of Object.entries(equipped)) {
    const s = Number(k);
    if (s <= -100 && s !== -111 && !isPetPart(-s - 100)) bySlot[-s - 100] = it.id;
  }
  const ids = Object.values(bySlot);
  if (equipped[-111]) ids.push(equipped[-111].id);
  return ids;
}

/**
 * Where an equip goes when worn: the character's slots (Equip window), or pet `pet`'s (its pet panel): accessory,
 * Label Ring (or Pet Collar), Quote Ring and the ability items; the potion pouches are shared.
 */
export function equipSlotFor(id, pet = 0) {
  const cat = Math.floor(id / 10000), P = PET_SLOTS[pet] || PET_SLOTS[0];
  const map = { 100: -1, 101: -2, 102: -3, 103: -4, 104: -5, 105: -5, 106: -6, 107: -7, 108: -8, 109: -10, 110: -9, 111: -12,
    112: -17, 113: -50, 114: -49, 190: -18, 191: -19 };
  if (cat >= 130 && cat <= 170) return -11;
  if (id === 1802100 || cat === 182) return P.label;
  if (cat === 180) return P.acc;
  if (cat === 183) return P.quote;
  const ability = { 1812000: P.magnet, 1812001: P.pouch, 1812002: SHARED_PET_SLOTS[0], 1812003: SHARED_PET_SLOTS[1], 1812004: P.boots,
    1812005: P.binocular, 1812006: P.scales, 1812007: P.ignore };
  if (ability[id]) return ability[id];
  return map[cat] ?? null;
}
/** Which pet an equipped slot belongs to (-1: not a pet's; the potion pouches are the lead pet's). */
export function petOfSlot(pos) {
  if (SHARED_PET_SLOTS.includes(pos)) return 0;
  return PET_SLOTS.findIndex((s) => Object.values(s).includes(pos));
}
