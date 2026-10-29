import { GameMap, nameTag, Anim } from './map.js';
import { Footholds, PHYS } from './physics.js';
import { CharacterLook, drawParts, lookCanvases } from './character.js';
import { weaponMultiplier, itemIcon, mesoIcon, invType } from './data.js';
import { stanceByte, STANCE_NAMES } from './net/proto.js';
import { Hud } from './ui/hud.js';
import { QuestBook } from './quests.js';
import { npcTalk, MessageBox, ShopWin, drawItemTip } from './ui/dialogs.js';
import { npcQuestMenu } from './ui/quests-ui.js';
import { SkillBook, skillMaxDamage, RANGED_WEAPONS } from './skills.js';
import { CODE_TO_SC, defaultKeymap, ACTION, MENU } from './keymap.js';
import { WorldFx } from './effects.js';
import { pad, frames } from './assets.js';
import { music, sfx } from './audio.js';
import { StatusBar } from './ui/statusbar.js';
import { WindowManager } from './ui/windows.js';
import { ChannelWin, GameOptWin, SysOptWin } from './ui/options.js';
import { UserListWin, PlayerMenu, CharInfoWin, drawPartyHp, drawGuildTag } from './ui/social.js';
import { TradeWin } from './ui/trade.js';
import { StorageWin } from './ui/storage.js';
import { WorldMapWin } from './ui/worldmap.js';
import { Pet, petLines } from './pets.js';
import { CashShopWin } from './ui/cashshop.js';
import { ChannelSession } from './net/channel.js';
import { wsTransport } from './net/connection.js';
import { bridgeUrl } from './ui/login-ui.js';

// Teleport: F/P, I/L, Cleric, Blaze Wizard, Evan
const TELEPORTS = new Set([2101002, 2201002, 2301001, 12101003, 22101001]);

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
    addEventListener('keyup', (e) => { const k = map(e); if (k) this.down.delete(k); });
    addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      this.clicks.push({ x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H });
    });
  }
  is(k) { return this.down.has(k); }
  hit(k) { return this.pressed.has(k); }
  endFrame() { this.pressed.clear(); this.clicks.length = 0; }
}

/** Another character on the map (SPAWN_PLAYER / MOVE_PLAYER). */
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
    let action = this.attack || {
      walk: look.walkAction(), stand: look.standAction(), jump: 'jump', prone: 'prone', ladder: 'ladder', rope: 'rope',
      alert: 'alert', sit: 'sit', dead: 'dead', fly: 'fly',
    }[this.state] || look.standAction();
    if (!look.has(action)) action = look.standAction();
    if (this.action !== action) { this.action = action; this.frame = 0; this.frameT = 0; }
    const moving = !(action === 'ladder' || action === 'rope') || this.path;
    if (moving) this.frameT += dt * 1000;
    while (this.frameT >= look.delay(action, this.frame)) {
      this.frameT -= look.delay(action, this.frame);
      if (++this.frame >= look.frameCount(action)) { this.frame = 0; if (this.attack) { this.attack = null; break; } }
    }
    if (this.chat && (this.chat.t -= dt) <= 0) this.chat = null;
  }
}

const isPetFood = (id) => Math.floor(id / 10000) === 212;

/** Weapon boosters (Sword/Axe/BW/Spear/Polearm/Bow/Crossbow/Claw/Dagger/Knuckler/Gun, Cygnus and Aran ones). */
const BOOSTERS = new Set([1101004, 1101005, 1201004, 1201005, 1301004, 1301005, 3101002, 3201002, 4101003, 4201002, 5101006, 5201003,
  11101001, 13101001, 14101002, 15101002, 21001003]);
/** Drop motion runs on the client's 8ms physics tick. */
const DROP_TICK = 0.008, DROP_GRAVITY = 0.14, DROP_LAUNCH = 4.1, THROW_LAUNCH = 5;   // monster loot hops ~60px, a player's throw ~90px

/** Chat line colours, as in the v83 chat log. */
const CHAT_COLORS = { whisper: '#7cfc5a', buddy: '#ffb36b', party: '#ff9ed6', guild: '#d6a4ff', alliance: '#9fe6c2', find: '#ffe08a', notice: '#ff9e9e' };
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

export class Game {
  /** net: ChannelSession when playing online, null for the offline map viewer. */
  constructor(canvas, assets, look, hooks = {}, net = null) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
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
    this.others = new Map(); this.drops = new Map(); this.lifeByOid = new Map(); this.pets = new Map();
    this.queue = []; this.loading = false;
    this.fps = 0; this._frames = 0; this._fpsT = 0;
    this.moveBuf = []; this.moveT = 0; this.flushT = 0; this.mobT = 0;
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
      const rp = this.playerAt(...p) || (this.hitsChar(this.player, ...p) ? this.player : null);
      if (rp) this.requestCharInfo(rp.id);
    });
    c.addEventListener('wheel', (e) => { if (wm.pointer('wheel', at(e)[0], e.deltaY)) e.preventDefault(); }, { passive: false });
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
    this.others.clear(); this.drops.clear(); this.pets.clear(); this.lifeByOid.clear();
    for (const w of [...this.windows.order]) this.windows.close(w);
    this.showChatBox(false);
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
    // a skill/item lives on one key only
    const changes = [];
    for (const [k, b] of Object.entries(this.keymap)) if (b.type === type && b.action === action && Number(k) !== sc) { delete this.keymap[k]; changes.push({ key: Number(k), type: 0, action: 0 }); }
    this.keymap[sc] = { type, action };
    changes.push({ key: sc, type, action });
    this.net?.changeKeymap(changes);
    this.keyBar?.render();
  }

  /** Window / skill / item keys pressed this frame (type 4, 1, 2). Basic actions are polled in updatePlayer. */
  handleHotkeys() {
    for (const code of this.input.pressed) {
      const k = this.keymap[CODE_TO_SC[code]];
      if (!k) continue;
      if (k.type === 4) this.toggleMenu(k.action);
      else if (k.type === 2) this.useItemById(k.action);
    }
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
  }

  toggleSkills() {
    if (!this.skills) return;
    this.windows.toggle('skill');
  }

  useItemById(id) {
    const t = Math.floor(id / 1000000);
    const slot = Object.entries(this.inventory?.[t] || {}).find(([, it]) => it.id === id)?.[0];
    if (slot && t === 2 && isPetFood(id)) this.feedPet(Number(slot), id);
    else if (slot && t === 2) this.net.useItem(Number(slot), id);
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
        if (Math.abs(d.x - pet.x) < 30 && Math.abs(d.y - pet.y) < 30 && (!d.owner || d.owner === this.player.id || d.type >= 2)) {
          tried.add(d.oid);
          this.net.petLoot(pet.uid, d.oid, Math.round(pet.x), Math.round(pet.y));
        }
      }
    }
  }

  weaponId() { return this.inventory?.equipped[-11]?.id || 0; }
  equipStat(key) { let v = 0; for (const it of Object.values(this.inventory?.equipped || {})) v += it[key] || 0; return v; }

  // ------------------------------------------------------------------ online wiring
  /** Hook a ChannelSession's events to this game. `entered` is the result of session.enter(). */
  async goOnline(entered, uiRoot) {
    const info = entered.info;
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
    wm.confirm = (text) => new Promise((r) => wm.show(new MessageBox(wm, 'yesno', text, r)));
    wm.askNumber = (text, def, min, max) => new Promise((r) => wm.show(new MessageBox(wm, 'number', text, r, { def, min, max })));
    wm.askText = (text, def, opts = {}) => new Promise((r) => wm.show(new MessageBox(wm, 'text', text, r, { def, ...opts })));
    Object.assign(wm.wins, { channel: new ChannelWin(wm), gameopt: new GameOptWin(wm), sysopt: new SysOptWin(wm), userlist: new UserListWin(wm), worldmap: new WorldMapWin(wm) });
    await this.assets.preload(['channel', 'gameopt', 'sysopt', 'userlist', 'worldmap'].flatMap((k) => wm.wins[k].frames()));
    this.buddies = []; this.party = null; this.partyHpMarks = true; this.guild = null;
    this.assets.json('UI/GuildMark.img').then((m) => { this.guildMarks = m; });
    this.windows.order.push(this.windows.wins.minimap); // the minimap starts open, under every window
    this.bindUiPointer();
    this.hud = new Hud(uiRoot, this);
    this.hud.update(this.stats);
    this.quests = new QuestBook(this.assets);
    await this.quests.load();
    this.quests.setState(info.quests);
    this.skills = new SkillBook(this.assets);
    await this.skills.load(info.stats.job, info.skills, info.cooldowns);
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
      groupChat: (c) => this.hud.message(`${c.name} : ${c.text}`, CHAT_COLORS[GROUP_KEYS[c.mode]] || '#fff'),
      whisper: (w) => this.onWhisper(w),
      whisperResult: (r) => this.onWhisperResult(r),
      findResult: (f) => this.onFindResult(f),
      buddies: (list) => { this.buddies = list; },
      buddyChannel: (id, ch) => { const b = this.buddies.find((x) => x.id === id); if (b) b.channel = ch; },
      buddyCapacity: () => {},
      buddyMessage: (code) => { const t = BUDDY_MESSAGES[code]; if (t) this.windows.notice(t); },
      buddyRequest: (b) => this.windows.confirm(`#b${b.name}#k wants to add you to their buddy list. Accept?`)
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
      tradeInvite: (name) => this.windows.confirm(`#b${name}#k has requested a trade. Accept?`)
        .then((ok) => (ok ? this.net.tradeAccept() : this.net.tradeDecline())),
      tradePartner: (name, look) => this.tradeWin?.partnerJoined(name, this.lookFrom(look)),
      tradeItem: (side, slot, it) => this.tradeWin?.setItem(side, slot, it),
      tradeMeso: (side, v) => this.tradeWin?.setMeso(side, v),
      tradeConfirm: () => this.tradeWin?.partnerConfirmed(),
      tradeChat: (text) => this.tradeWin?.say(text),
      tradeEnd: (result) => this.tradeWin?.ended(result),
      tradeError: (code) => { this.tradeWin?.ended(0); this.windows.notice(TRADE_ERRORS[code] || 'The trade could not be started.'); },
      charInfo: (i) => { if (this.infoWin) this.windows.close(this.infoWin); this.infoWin = this.windows.show(new CharInfoWin(this.windows, i)); },
      partyInvite: (p) => this.windows.confirm(`#b${p.name}#k has invited you to join their party. Accept?`)
        .then((ok) => (ok ? this.net.partyOp(3, p.id) : this.net.partyDeny(p.name))),
      partyMessage: (code, name) => { const t = PARTY_MESSAGES[code]; if (t) this.hud.message(t.replace('%s', name), CHAT_COLORS.notice); },
      partyHp: (id, hp, maxHp) => { const m = this.party?.members.find((x) => x.id === id); if (m) Object.assign(m, { hp, maxHp }); },
      chat: later((c) => this.onChat(c)),
      spawnPlayer: later((d) => this.spawnPlayer(d)),
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
      playerDamaged: later((d) => this.onPlayerDamaged(d)),
      spawnMob: later((m) => this.spawnLife('Mob', m, false)),
      controlMob: later(async (m, aggro) => {
        let e = this.lifeByOid.get(m.oid);
        if (e && !e.pending) e.controlled = true; else { await this.spawnLife('Mob', m, true); e = this.lifeByOid.get(m.oid); }
        if (aggro && e && !e.pending) e.aggro = this.player;     // the server wants it after us
      }),
      stopControl: later((oid) => { const e = this.lifeByOid.get(oid); if (e) { e.controlled = false; e.aggro = null; } }),
      moveMob: later((oid, start, moves) => { const e = this.lifeByOid.get(oid); if (e && !e.pending && !e.controlled) e.applyMovement(start, moves); }),
      killMob: later((oid, anim) => this.killLife(oid, anim)),
      mobHp: later((oid, pct) => { const e = this.lifeByOid.get(oid); if (e && !e.pending) { e.hp = Math.round((e.maxHp * pct) / 100); e.hpShownUntil = performance.now() + 5000; } }),
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
      keymap: (km) => { this.keymap = km; this.keyBar.render(); this.skillWin?.render(); },
      skills: (list) => {
        for (const s of list) {
          const before = this.skills.level(s.id);
          this.skills.levels[s.id] = { level: s.level, master: s.master, expiration: s.expiration };
          if (s.level > before) this.hud.message(`${this.skills.name(s.id)} is now level ${s.level}.`, '#9fd3ff');
        }
        this.skillWin?.render(); this.keyBar.render();
      },
      knowsSkill: (id) => this.skills.level(id) > 0,
      cooldown: (id, sec) => { this.skills.cooldowns[id] = sec ? Date.now() + sec * 1000 : 0; },
      buff: (b) => {
        this.buffs = this.buffs.filter((x) => x.source !== b.source);
        this.buffs.push({ source: b.source, until: Date.now() + b.duration, dur: b.duration, m1: b.m1, m2: b.m2, hbHp: b.hbHp, hbMp: b.hbMp });
      },
      cancelBuff: (m1, m2) => { this.buffs = this.buffs.filter((b) => !((b.m1 & m1) || (b.m2 & m2))); },
      foreignSkill: later((chrId, skillId) => { const rp = this.others.get(chrId); if (rp) this.playSkillEffect(skillId, rp); }),
      questResult: (r) => {
        if (!r.ok) this.hud.message(QUEST_ERRORS[r.mode] || 'The quest could not be updated.', '#ff8080');
      },
      disconnected: () => this.windows.notice('The connection to the server was closed.').then(() => location.reload()),
    });
    const loaded = this.changeMap(entered.mapId, { portalIdx: entered.portal });
    this.net.flush(); // buffered spawns queue up behind the map load
    await loaded;
  }

  onQuest(id, status, data) {
    const before = this.quests.status(id);
    const prevProgress = this.quests.started[id];
    this.quests.update(id, status, data);
    const name = this.quests.name(id);
    if (status === 1 && before === 0) this.hud.message(`Quest started: ${name}`, '#9fe07a');
    else if (status === 2 && before !== 2) { this.hud.message(`Quest complete: ${name}`, '#ffe08a'); this.vfx?.play('QuestClear', this.player); sfx.play('Game/QuestClear'); }
    else if (status === 0 && before === 1) this.hud.message(`Quest forfeited: ${name}`, '#ff9e9e');
    else if (status === 1 && prevProgress !== data) {
      for (const m of this.quests.mobProgress(id)) if (m.have <= m.need) this.hud.message(`${name}: ${m.have} / ${m.need}`, '#c8e6ff');
    }
    this.questWin?.render();
  }

  toggleQuests() {
    if (!this.quests) return;
    this.windows.toggle(quest);
  }

  itemCount(id) {
    const t = invType(id);
    let n = 0;
    for (const it of Object.values(this.inventory?.[t] || {})) if (it.id === id) n += it.quantity ?? 1;
    return n;
  }

  /** Context for quest checks and NPC text (#c item counts). */
  textCtx() { return { stats: this.stats, meso: this.meso, itemCount: (id) => this.itemCount(id) }; }

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
    p.action = 'dead'; p.frame = 0; p.frameT = 0; p.attack = null;   // the character turns into its ghost
    // the tombstone drops onto the body first, then the client asks
    this.vfx?.tomb(this.player); sfx.play('Game/Tombstone');
    await new Promise((r) => setTimeout(r, 1500));
    await this.windows.notice('You have died. You will return to the nearest town.', { y: 90 }); // high, clear of the ghost
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
    this.hooks.onLoading?.(true, `Loading map ${id}...`);
    try {
      const map = new GameMap(this.assets, id);
      await map.load((s) => current() && this.hooks.onLoading?.(true, s), { life: !this.net });
      if (!current()) return;
      this.map = map;
      this.vfx?.mapChanged();
      this.others.clear(); this.drops.clear(); this.lifeByOid.clear(); this.pets.clear();
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
      if (!current()) return; // eslint-disable-line no-unsafe-finally
      this.loading = false;
      this.hooks.onLoading?.(false);
      const q = this.queue; this.queue = [];
      for (const fn of q) fn();
    }
  }

  placeAtPortal(portal) { this.placeAt(portal.x, portal.y - 10); }

  placeAt(x, y) {
    const p = this.player;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.ladder = null;
    p.fh = this.map.fh.below(p.x, p.y, 400);
    if (p.fh) p.y = Footholds.yAt(p.fh, p.x);
    this.moveBuf = []; this.lastSent = null;
  }

  // ------------------------------------------------------------------ server entities
  async spawnLife(kind, d, controlled) {
    const map = this.map;
    const entry = { pending: true };
    this.lifeByOid.set(d.oid, entry);
    const spawn = kind === 'Npc'
      ? { id: d.id, oid: d.oid, x: d.x, cy: d.y, f: d.facingRight ? 0 : 1, fh: d.fh, rx0: d.rx0, rx1: d.rx1 }
      : { id: d.id, oid: d.oid, x: d.x, cy: d.y, f: d.stance & 1 ? 0 : 1, fh: d.fh, rx0: -Infinity, rx1: Infinity };
    const e = await map.createLife(kind, spawn);
    if (!e || this.map !== map || this.lifeByOid.get(d.oid) !== entry) return;
    if (kind === 'Mob') { e.y = d.y; e.facingRight = !(d.stance & 1); }
    e.controlled = controlled;
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
    const look = new CharacterLook(this.assets, { skin: d.look.skin, face: d.look.face, hair: d.look.hair, equips: visibleEquips(d.look) });
    await look.load();
    await this.assets.preload(lookCanvases(look, ['stand1', 'stand2', 'walk1', 'walk2', 'jump']));
    if (!this.map) return;
    this.others.set(d.id, new RemotePlayer(d, look));
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
    this.hud.message(`${name} : ${c.text}`, c.gm ? '#ffb3ff' : '#fff');
  }

  onRemoteAttack(a) {
    const rp = this.others.get(a.id);
    if (rp) {
      rp.attack = this.actionName(a.stance); rp.facingRight = !(a.direction & 0x80);
      if (a.skill) this.playSkillEffect(a.skill, rp, a.kind !== 'magic'); else this.playWeaponSound(rp);
    }
    const shoots = rp && (a.kind === 'ranged' || (a.kind === 'magic' && a.skill));
    for (const t of a.targets) {
      const e = this.lifeByOid.get(t.oid);
      if (!e || e.pending) continue;
      const land = () => {
        e.hit(t.dmg.reduce((s, x) => s + x, 0), !!rp && rp.x < e.x);
        this.damageNumbers(e, t.dmg, false);
        this.playHitEffect(a.skill, e);
      };
      if (shoots) this.shoot(a.skill, rp, e, a.projectile, land); else land();
    }
  }

  onPlayerDamaged(d) {
    const rp = this.others.get(d.id);
    if (rp) this.vfx?.damage(rp, [d.damage], 'violet');
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
    const node = d.meso ? await mesoIcon(this.assets, d.id) : await itemIcon(this.assets, d.id, true);
    const anim = new Anim(node || null);
    await this.assets.preload(anim.frames);
    if (!this.map) return;
    const fh = this.map.fh.below(d.x, d.y - 40, 200);
    const y = fh ? Footholds.yAt(fh, d.x) : d.y;
    const fromX = d.fromX ?? d.x, fromY = d.fromY ?? y;
    pending.delete(d.oid);
    if (d.mode !== 2) sfx.play('Game/DropItem');           // a fresh drop, not one already lying there
    const thrown = !d.meso && (d.dropper === this.player.id || this.others.has(d.dropper));   // dropped by a character, not a monster
    this.drops.set(d.oid, { ...d, y, anim, landed: d.mode === 2, age: 0, cx: fromX, cy: fromY - 4, alpha: 1, phase: Math.random() * 6, spin: thrown, angle: 0, launch: thrown ? THROW_LAUNCH : DROP_LAUNCH });
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
  maxDamage() {
    const s = this.stats, weapon = this.inventory?.equipped[-11];
    const mult = weaponMultiplier(weapon?.id);
    if (!mult) return 1;
    const cat = Math.floor(weapon.id / 10000) % 100;
    let main = s.str, sec = s.dex;
    if (cat === 45 || cat === 46 || cat === 49) { main = s.dex; sec = s.str; }
    else if (cat === 47 || (cat === 33 && Math.floor(s.job / 100) === 4)) { main = s.luk; sec = s.dex + s.str; }
    return Math.max(1, Math.ceil(((mult * main + sec) / 100) * this.watk()));
  }

  useInventoryItem(tab, slot, it) {
    if (tab === 5 && it.pet) { this.net.spawnPet(slot); return; }        // summon / send the pet home
    if (tab === 2 && isPetFood(it.id)) { this.feedPet(slot, it.id); return; }
    if (tab === 2) this.net.useItem(slot, it.id);
    else if (tab === 1) {
      const dst = equipSlotFor(it.id);
      if (dst) this.net.moveItem(1, slot, dst, 1);
    }
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
    const target = this.statusBar?.chatTarget || 0;
    if (target === 0 || text.startsWith('!')) { this.net.chat(text); if (target === 0) this.petCommandWord(text); return; }
    if (target === 2 && !this.party) { this.hud.message('You are not in a party.', CHAT_COLORS.notice); return; }
    if (target === 3 && !this.guild) { this.hud.message('You are not in a guild.', CHAT_COLORS.notice); return; }
    if (target === 1) {
      const ids = (this.buddies || []).filter((b) => b.channel >= 0).map((b) => b.id);
      if (!ids.length) { this.hud.message('None of your buddies are online.', CHAT_COLORS.notice); return; }
      this.net.groupChat(0, text, ids);
    } else this.net.groupChat(target - 1, text);
    // the server only echoes group chat to the others, so show your own line here
    this.hud.message(`${this.player.name} : ${text}`, CHAT_COLORS[GROUP_KEYS[target - 1]]);
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
        this.windows.confirm(`#b${d.master}#k wants to found the guild #b${d.name}#k with you. Do you agree?`).then((ok) => this.net.guildAgree(ok));
        break;
      case 'invite':
        this.windows.confirm(`#b${d.from}#k has invited you to join a guild. Accept?`)
          .then((ok) => (ok ? this.net.guildOp(6, d.id, me) : this.net.guildDeny(d.from)));
        break;
      case 'info':
        if (d.guild && !g) msg(`You are a member of the guild ${d.guild.name}.`);
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
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      if (this.map && !this.loading) { this.update(dt); this.render(); }
      this.input.endFrame();
      this._frames++; this._fpsT += dt;
      if (this._fpsT >= 1) { this.fps = this._frames; this._frames = 0; this._fpsT = 0; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  update(dt) {
    if (this.inCashShop) { this.windows?.update(dt); return; }   // the shop screen is all there is
    this.map.update(dt);
    this.statusBar?.update(dt);
    this.windows?.update(dt);
    this.vfx?.update(dt);
    this.map.life = this.map.life.filter((e) => !e.removed);
    if (!this.dead) this.updatePlayer(dt);
    for (const rp of this.others.values()) rp.update(dt);
    for (const pet of this.pets.values()) { pet.update(dt); pet.sync(dt); }
    if (this.net) this.petLoot(dt);
    if (this.player.chat && (this.player.chat.t -= dt) <= 0) this.player.chat = null;
    this.updateDrops(dt);
    this.updateFx(dt);
    this.runTimers(dt);
    this.loadAfterimage();
    this.handleHotkeys();
    if (this.net) { this.syncMovement(dt); this.syncMobs(dt); this.checkTouchDamage(dt); this.handleClicks(); this.regen(dt); }
    this.updateCamera(dt);
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < 1.2);
  }

  /**
   * Natural regeneration is client-driven in v83 (HEAL_OVER_TIME). Cosmic rejects heals faster than
   * 1.5s apart and autobans HP heals above 77 * map recovery * 1.5, so stay at the classic +10 HP / 10s.
   */
  regen(dt) {
    this.regenT = (this.regenT || 0) + dt;
    if (this.regenT < 10 || this.dead || !this.stats) return;
    this.regenT = 0;
    const s = this.stats;
    const maxHp = this.maxHpShown(), maxMp = this.maxMpShown();   // the server heals up to the same buffed max
    const hp = s.hp < maxHp ? Math.min(10, maxHp - s.hp) : 0;
    const mp = s.mp < maxMp ? Math.min(3 + Math.floor(s.int / 10), 100, maxMp - s.mp) : 0;
    if (hp || mp) this.net.healOverTime(hp, mp);
  }

  /**
   * Drops move like the client's (Journey's Drop, 8ms ticks, gravity 0.14 px/tick^2):
   *   dropped: launched at DROP_LAUNCH px/tick (a hop of ~60px) from where it fell, drifting a 48th of the way across per tick
   *     until it comes down on its spot, then bobs; an item a player throws down goes higher (THROW_LAUNCH)
   *     and spins 0.2 rad/tick on the way (monster loot and meso bags don't)
   *   picked up: hops up and is drawn into the looter's body over 48 ticks, speeding up as it
   *     goes and fading out as it arrives
   */
  pickUp(d, looter) {
    if (!d.landed) { d.cx = d.x; d.cy = d.y; d.landed = true; }
    d.pickedBy = looter; d.age = 0;
    d.sx = d.cx; d.sy = d.cy;
  }
  updateDrops(dt) {
    const ticks = dt / DROP_TICK;
    for (const [oid, d] of this.drops) {
      d.anim.update(dt * 1000);
      d.phase += dt * 3;
      if (d.pickedBy) {
        const L = d.pickedBy;
        d.age += ticks;
        const k = Math.min(1, d.age / 48), ease = k * k;          // follows the looter as they move
        d.cx = d.sx + (L.x - d.sx) * ease;
        d.cy = d.sy + (L.y - 28 - d.sy) * ease - Math.sin(k * Math.PI) * 26;
        d.alpha = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
        if (k >= 1) this.drops.delete(oid);
      } else if (!d.landed) {
        d.age += ticks;
        const k = d.age, dx = d.x - d.fromX;
        d.cx = d.fromX + Math.sign(dx) * Math.min(Math.abs(dx), (Math.abs(dx) / 48) * k);
        d.cy = d.fromY - 4 - d.launch * k + 0.5 * DROP_GRAVITY * k * k;
        if (k > d.launch / DROP_GRAVITY && d.cy >= d.y) { d.landed = true; d.cx = d.x; d.cy = d.y; d.angle = 0; }
        else if (d.spin) d.angle += 0.2 * ticks;
      }
    }
  }

  updatePlayer(dt) {
    const p = this.player, map = this.map, fh = map.fh, inp = this.input, look = this.look;
    const dir = (inp.is('right') ? 1 : 0) - (inp.is('left') ? 1 : 0);
    let action;
    if (p.ignoreT > 0 && (p.ignoreT -= dt) <= 0) p.ignoreFh = null;
    if (this.portalCooldown > 0) this.portalCooldown -= dt;

    if (p.ladder) {
      const l = p.ladder;
      const v = (inp.is('down') ? 1 : 0) - (inp.is('up') ? 1 : 0);
      p.y += v * PHYS.climb * dt;
      action = l.l ? 'ladder' : 'rope';
      if (this.hitAction(ACTION.JUMP) && dir) {
        p.ladder = null; p.vy = -PHYS.jump * 0.55; p.vx = dir * PHYS.walk; p.facingRight = dir > 0;
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

    const skill = this.heldSkill();
    if (skill && this.skills) { if (this.useSkill(skill)) return; }
    if (this.holdAction(ACTION.ATTACK)) { this.attack(0); return; }
    if (this.hitAction(ACTION.PICKUP) && this.net) this.tryPickup();
    if (this.hitAction(ACTION.NPC_CHAT) && this.net) this.talkToNearestNpc();

    if (p.fh && this.portalCooldown <= 0) {
      const portal = map.portalAt(p.x, p.y);
      // touch portals fire once on entry, not every frame you stand in them
      const touched = portal && TOUCH_PORTALS.has(portal.pt) && portal !== this.touchedPortal;
      this.touchedPortal = portal && TOUCH_PORTALS.has(portal.pt) ? portal : null;
      if (portal && (inp.hit('up') || touched)) { this.usePortal(portal); if (!touched) return; }
    }
    if (inp.is('up') && !dir) {
      const l = map.ladderAt(p.x, p.y, true);
      if (l && (!p.fh || p.y > l.y1 + 5)) { this.grab(l); return; }
    }
    if (inp.is('down') && p.fh && !dir) {
      const l = map.ladderAt(p.x, p.y, false);
      if (l && Math.abs(p.y - l.y1) < 15) { this.grab(l); p.y = l.y1 + 6; return; }
    }

    if (p.fh) {
      if (dir) p.facingRight = dir > 0;
      if (this.hitAction(ACTION.JUMP)) {
        if (inp.is('down')) {
          const below = fh.below(p.x, p.y + 1, 600, p.fh);
          if (below) { p.ignoreFh = p.fh; p.ignoreT = 0.3; p.fh = null; p.vy = 0; p.vx = 0; }
        } else {
          p.fh = null; p.vy = -PHYS.jump; p.vx = dir * PHYS.walk;
          sfx.play('Game/Jump');
        }
      } else if (inp.is('down') && !dir) {
        action = 'prone';
      } else if (dir) {
        if (fh.walk(p, dir * PHYS.walk * dt) === 'edge') { p.vx = dir * PHYS.walk; p.vy = 0; }
        action = look.walkAction();
      }
    }
    if (!p.fh) {
      if (dir) {
        p.facingRight = dir > 0;
        p.vx = Math.max(-PHYS.walk, Math.min(PHYS.walk, p.vx + dir * PHYS.walk * PHYS.airControl * dt * 4));
      }
      fh.fall(p, dt, p.ignoreFh);
      action = p.fh ? look.standAction() : 'jump';
    }
    action ??= look.standAction();

    const b = map.bounds;
    p.x = Math.max(fh.left + 25, Math.min(fh.right - 25, p.x));     // the client's side walls: footholds' extent, 25px in
    if (p.y > b.bottom + 300) this.placeAtPortal(map.spawnPortal(null));
    this.advanceFrame(action, dt);
  }

  usePortal(portal) {
    const map = this.map;
    this.portalCooldown = 1;
    sfx.play('Game/Portal');
    if (portal.tm === map.id) {
      const from = { x: Math.round(this.player.x), y: Math.round(this.player.y) };
      const t = map.spawnPortal(portal.tn);
      this.placeAtPortal(t);
      this.net?.innerPortal(portal.pn, from, { x: t.x, y: t.y });
    } else if (!this.net) this.changeMap(portal.tm, { portal: portal.tn });
    else if (portal.script) this.net.scriptPortal(portal.pn);
    else this.net.enterPortal(portal.pn);
  }

  grab(l) {
    const p = this.player;
    p.ladder = l; p.fh = null; p.x = l.x; p.vx = 0; p.vy = 0;
  }

  advanceFrame(action, dt) {
    const p = this.player, look = this.look;
    if (!look.has(action)) action = look.standAction();
    if (p.action !== action) { p.action = action; p.frame = 0; p.frameT = 0; }
    p.frameT += dt * 1000;
    let finished = false;
    const k = p.attack && action === p.attack ? p.attackScale || 1 : 1;   // attacks run at the weapon's speed
    while (p.frameT >= look.delay(action, p.frame) * k) {
      p.frameT -= look.delay(action, p.frame) * k;
      p.frame++;
      if (p.frame >= look.frameCount(action)) { p.frame = 0; finished = true; }
    }
    return finished;
  }

  // ------------------------------------------------------------------ combat
  /** Body action ids in attack packets = order of actions in Character/00002000.img. */
  actionId(name) { const i = this.look.actionList().indexOf(name); return i < 0 ? 0 : i; }
  actionName(id) { return this.look.actionList()[id] || 'swingO1'; }

  /** Try a skill from its hotkey. Returns true when it started (so movement is skipped this frame). */
  useSkill(id) {
    const sb = this.skills, lv = sb.level(id);
    if (!lv) return false;
    const kind = sb.kind(id, this.weaponId());
    if (kind === 'passive') return false;
    if (kind === 'special' && !this.skillKeyPressed) return false; // buffs fire once per key press
    return this.attack(id, kind);
  }

  /**
   * Basic attack (skillId 0) or skill. kind: melee | ranged | magic | special.
   * Damage, MP cost and ammo are validated by Cosmic; the client picks targets and rolls damage.
   */
  attack(skillId = 0, kind = null) {
    const p = this.player, sb = this.skills, weapon = this.weaponId();
    const wcat = weapon ? Math.floor(weapon / 10000) : 0;
    // lying down, a plain attack is the prone stab: a short melee jab with any weapon
    const prone = !skillId && !!p.fh && this.input.is('down') && this.look.has('proneStab');
    if (prone) kind = 'melee';
    kind ??= RANGED_WEAPONS.has(wcat) ? 'ranged' : 'melee';
    const lv = skillId ? sb.level(skillId) : 0;
    const ld = skillId ? sb.levelData(skillId, lv) : null;
    if (skillId && this.net) {
      if (!sb.weaponOk(skillId, weapon)) { this.notice('You cannot use this skill with the weapon you are holding.'); return false; }
      if (sb.cooling(skillId)) return false;
      if ((ld?.mpCon || 0) > this.stats.mp) { this.notice('Not enough MP.'); return false; }
      if ((ld?.hpCon || 0) >= this.stats.hp) { this.notice('Not enough HP.'); return false; }
    }
    if (kind === 'special') return this.castSpecial(skillId, lv);
    if (kind === 'ranged' && this.net && !this.hasAmmo(skillId)) {
      this.notice(wcat === 147 ? 'You have no throwing stars.' : wcat === 149 ? 'You have no bullets.' : 'You have no arrows.');
      return false;
    }

    const action = prone ? 'proneStab' : (skillId && sb.action(skillId)) || this.defaultAttackAction(kind);
    p.attack = this.look.has(action) ? action : this.look.attackAction();
    p.frame = 0; p.frameT = 0; p.action = p.attack;
    p.attackScale = this.attackScale();
    const hitAt = this.hitFrame(p.attack, kind), hitDelay = this.frameTime(p.attack, hitAt) * p.attackScale;
    this.after(hitDelay, () => this.playAfterimage(p.attack, hitAt));
    if (skillId) this.playSkillEffect(skillId, p, kind !== 'magic');
    else this.playWeaponSound(p);

    const mobCount = ld?.mobCount || 1;
    // fixdamage skills must deal exactly that much per monster (Cosmic autobans anything else)
    const lines = ld?.fixdamage ? 1 : ld?.attackCount || ld?.bulletCount || 1;
    const targets = this.findTargets(kind, skillId, lv, mobCount, p.attack);
    const max = this.net ? (skillId ? skillMaxDamage(this, skillId, lv, kind) : kind === 'magic' ? 1 : this.maxDamage()) : 25;
    const roll = () => (ld?.fixdamage ? ld.fixdamage : Math.max(1, Math.round(max * (0.5 + Math.random() * 0.5))));
    const out = targets.map((m) => ({
      mob: m, oid: m.oid, x: Math.round(m.x), y: Math.round(m.y),
      dmg: Array.from({ length: lines }, roll),
    }));
    const projectile = kind === 'ranged' || (skillId && sb?.node(skillId)?.ball && kind !== 'melee') || skillId % 10000000 === 1000;
    for (const t of out) {
      t.mob.pendingHits = (t.mob.pendingHits || 0) + 1;
      const land = () => {
        if (--t.mob.pendingHits <= 0 && !t.mob.queuedKill) this.releaseDrops(t.mob);   // no kill came after all
        if (t.mob.pendingHits <= 0 && t.mob.queuedKill) {               // the killing blow: hit, then die
          t.mob.hit(t.dmg.reduce((a, b) => a + b, 0), !p.facingRight); this.damageNumbers(t.mob, t.dmg, true); this.playHitEffect(skillId, t.mob);
          this.finishKill(t.mob);
          return;
        }
        t.mob.hit(t.dmg.reduce((a, b) => a + b, 0), !p.facingRight); this.damageNumbers(t.mob, t.dmg, true); this.playHitEffect(skillId, t.mob);
        if (t.mob.kind === 'Mob') t.mob.aggro = p;                // a struck monster comes after you
      };
      // the hit (or the shot) comes when the swing connects, not when it starts
      if (projectile) this.after(hitDelay, () => this.shoot(skillId, p, t.mob, kind === 'ranged' ? this.ammoItem() : 0, land));
      else this.after(hitDelay, land);
    }
    if (projectile && !out.length) this.after(hitDelay, () => this.shoot(skillId, p, null, kind === 'ranged' ? this.ammoItem() : 0, null));
    this.net?.attack(kind, { targets: out, lines, skill: skillId, stance: this.actionId(p.attack), facingLeft: !p.facingRight });
    return true;
  }

  /**
   * Attack speed, as v83 does it: every frame of an attack lasts (speed + 10) / 16 of its delay, where
   * speed is the weapon's attackSpeed (2 fastest .. 9 slowest, 6 normal), two faster under a Booster.
   */
  attackScale() {
    let speed = this.windows?.info(this.weaponId())?.attackSpeed ?? 6;
    if ((this.buffs || []).some((b) => BOOSTERS.has(b.source) && b.until > Date.now())) speed -= 2;
    return (Math.max(2, Math.min(9, speed)) + 10) / 16;
  }
  /**
   * The frame an attack connects on: a shot leaves after the draw (frame 1), a swing lands on the
   * frame its afterimage plays on, a spell (or a swing without one) on its last frame.
   */
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
    if (kind === 'ranged') for (const a of ['shoot1', 'shoot2', 'shootF']) if (this.look.weapon?.[a]) return a;
    return this.look.attackAction();
  }

  /** Buffs and other SPECIAL_MOVE skills. */
  castSpecial(id, lv) {
    if (TELEPORTS.has(id)) return this.teleport(id, lv);
    const p = this.player, node = this.skills.node(id);
    const action = this.skills.action(id) || 'alert2';
    if (this.look.has(action)) { p.attack = action; p.frame = 0; p.frameT = 0; p.action = action; }
    this.playSkillEffect(id, p);
    const needsPos = node?.summon || id === 2311002; // summons and Mystic Door are placed at the caster
    this.net?.specialMove(id, lv, needsPos ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
    return true;
  }

  /**
   * Teleport: jump up to `range` px in the held direction (Up/Down for vertical) onto a foothold.
   * The new position reaches the server through the normal movement sync; SPECIAL_MOVE charges the MP.
   */
  teleport(id, lv) {
    const p = this.player, fh = this.map.fh, inp = this.input;
    const dist = this.skills.levelData(id, lv)?.range || 130;
    const dy = inp.is('up') ? -1 : inp.is('down') ? 1 : 0;
    const dx = dy ? 0 : (p.facingRight ? 1 : -1);
    const tx = p.x + dx * dist;
    const ty = dy ? p.y + dy * dist : p.y;
    const land = fh.below(tx, ty - (dy < 0 ? 0 : 40), dy ? 60 : 200);
    if (!land) return false;
    this.playSkillEffect(id, p);
    p.x = tx; p.y = Footholds.yAt(land, tx); p.fh = land; p.vx = 0; p.vy = 0; p.ladder = null;
    this.net?.specialMove(id, lv, null);
    return true;
  }

  /** Same rules as RangedAttackHandler: first usable ammo in USE for the weapon (or a skill that needs none). */
  ammoItem() {
    const cat = Math.floor(this.weaponId() / 10000);
    const ok = { 145: (id) => Math.floor(id / 1000) === 2060, 146: (id) => Math.floor(id / 1000) === 2061,
      147: (id) => Math.floor(id / 10000) === 207, 149: (id) => Math.floor(id / 10000) === 233 }[cat];
    if (!ok) return 0;
    const use = this.inventory?.[2] || {};
    for (const k of Object.keys(use).map(Number).sort((a, b) => a - b)) if (ok(use[k].id) && use[k].quantity > 0) return use[k].id;
    return 0;
  }
  hasAmmo(skillId) {
    if (skillId % 10000000 === 1000) return true; // Three Snails
    const noAmmoBuffs = [3101004, 3201004, 4121006, 13101003]; // Soul Arrow x3, Shadow Claw
    if (this.buffs.some((b) => noAmmoBuffs.includes(b.source))) return true;
    return !!this.ammoItem();
  }

  /** Mobs inside the skill's lt/rb box (or a default reach), nearest first. */
  findTargets(kind, skillId, lv, count, action = null) {
    const p = this.player;
    // a swing reaches as far as its afterimage's box (lt/rb), as in the client
    const swing = kind === 'melee' && action ? this.afterimage?.[this.afterimageLevel()]?.[action] : null;
    const r = skillId && this.skills.range(skillId, lv) || (swing?.lt && swing?.rb ? swing : null) || ({
      melee: { lt: [-90, -70], rb: [10, 5] }, ranged: { lt: [-420, -80], rb: [0, 10] }, magic: { lt: [-330, -80], rb: [0, 10] },
    })[kind];
    const [x1, x2] = p.facingRight ? [p.x - r.rb[0], p.x - r.lt[0]] : [p.x + r.lt[0], p.x + r.rb[0]];
    const top = p.y + r.lt[1], bottom = p.y + r.rb[1];
    return this.map.life
      .filter((m) => m.kind === 'Mob' && m.alive && !m.dying && m.oid !== undefined)
      .filter((m) => { const b = m.box(); return b.right >= x1 && b.left <= x2 && b.bottom >= top && b.top <= bottom; })
      .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))
      .slice(0, count);
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

  /** swing: fall back to the weapon's swing when the skill has no Use sound (most physical attacks). */
  async playSkillEffect(id, ent, swing = false) {
    sfx.play(`Skill/${pad(id, 7)}/Use`).then((found) => { if (!found && swing) this.playWeaponSound(ent); });
    const node = await this.skills?.ensure(id);
    const fx = Game.fxNode(node?.effect);
    if (!fx) return;
    const anim = new Anim(fx, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, follow: ent, flip: ent.facingRight });
  }

  async playHitEffect(id, mob) {
    if (id) sfx.play(`Skill/${pad(id, 7)}/Hit`); // keys are 7-digit (0001000); Cygnus/Aran ids are 8
    if (mob?.kind === 'Mob') sfx.play(`Mob/${pad(Number(mob.spawn.id), 7)}/Damage`);
    const node = id ? await this.skills?.ensure(id) : null;
    const fx = Game.fxNode(node?.hit);
    if (!fx) return;
    const anim = new Anim(fx, false);
    await this.assets.preload(anim.frames);
    this.fx.push({ anim, x: mob.x, y: mob.y - (mob.node?._h || 40) / 2, flip: false });
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
    this.fx = this.fx.filter((f) => !f.anim.done);
    for (const s of this.shots) {
      s.t += dt; s.anim?.update(dt * 1000);
      if (s.t >= s.dur && !s.hit) { s.hit = true; s.onHit?.(); }
    }
    this.shots = this.shots.filter((s) => !s.hit);
  }

  drawFx(ctx, cam) {
    const draw = (node, x, y, flip) => {
      const img = this.assets.image(node);
      if (!img) return;
      const o = node.origin || [0, 0];
      ctx.save();
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
      const k = Math.min(1, s.t / s.dur);
      draw(s.anim.node, s.sx + (s.tx - s.sx) * k, s.sy + (s.ty - s.sy) * k, s.flip);
    }
  }

  /** Your hits in red (NoRed), other players' in blue (NoBlue); your hits also show the monster's HP bar. */
  damageNumbers(target, dmgs, mine) {
    if (mine && target.kind === 'Mob') target.hpShownUntil = performance.now() + 5000;
    this.vfx?.damage(target, dmgs, mine ? 'red' : 'blue');
  }

  checkTouchDamage(dt) {
    const p = this.player;
    if (this.invincible > 0) { this.invincible -= dt; return; }
    if (p.ladder || this.dead || !this.stats) return;
    const pb = { left: p.x - 12, right: p.x + 12, top: p.y - 60, bottom: p.y };
    for (const m of this.map.life) {
      if (m.kind !== 'Mob' || !m.alive || m.dying || m.src.info?.bodyAttack === 0) continue;
      const b = m.box();
      if (b.right < pb.left || b.left > pb.right || b.bottom < pb.top || b.top > pb.bottom) continue;
      const pad = m.src.info?.PADamage || 1;
      let wdef = 0; for (const it of Object.values(this.inventory.equipped)) wdef += it.wdef || 0;
      const damage = Math.max(1, Math.round(pad * (0.85 + Math.random() * 0.15) - wdef * 0.5));
      const fromRight = m.x > p.x;
      this.net.takeDamage({ damage, mobId: m.spawn.id, oid: m.oid, direction: fromRight ? 1 : 0 });
      this.vfx?.damage(p, [damage], 'violet');
      p.fh = null; p.vy = -260; p.vx = fromRight ? -PHYS.walk : PHYS.walk;
      this.invincible = 2;
      return;
    }
  }

  /** Pick up the item you are standing on: your feet within its width, on the same ground. */
  tryPickup() {
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
    if (p.ladder) st = p.ladder.l ? 'ladder' : 'rope';
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

  syncMobs(dt) {
    this.mobT += dt;
    if (this.mobT < 0.5) return;
    this.mobT = 0;
    for (const m of this.map.life) {
      if (!m.controlled || m.kind !== 'Mob' || m.dying || m.oid === null) continue;
      const ls = m.lastSent;
      const x = Math.round(m.x), y = Math.round(m.y);
      if (ls.x === x && ls.y === y && ls.state === m.state && ls.facingRight === m.facingRight) continue;
      const stance = ((m.state === 'move' ? 1 : m.state === 'fly' ? 6 : 2) << 1) | (m.facingRight ? 0 : 1);
      this.net.moveMob(m.oid, { x: Math.round(ls.x), y: Math.round(ls.y) }, [{ cmd: 0, x, y, vx: 0, vy: 0, fh: m.fh?.id || 0, stance, duration: 500 }]);
      m.lastSent = { x, y, state: m.state, facingRight: m.facingRight };
    }
  }

  // ------------------------------------------------------------------ camera / render
  updateCamera(dt) {
    const p = this.player, c = this.cam;
    const tx = p.x - VIEW_W / 2, ty = p.y - VIEW_H / 2 - 60;
    const k = 1 - Math.exp(-dt * 8);
    c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
    this.clampCamera();
  }

  snapCamera() {
    const p = this.player;
    this.cam.x = p.x - VIEW_W / 2; this.cam.y = p.y - VIEW_H / 2 - 60;
    this.clampCamera();
  }

  clampCamera() {
    const c = this.cam, b = this.map.bounds;
    c.x = b.right - b.left < VIEW_W ? (b.left + b.right - VIEW_W) / 2 : Math.max(b.left, Math.min(b.right - VIEW_W, c.x));
    c.y = b.bottom - b.top < VIEW_H ? (b.top + b.bottom - VIEW_H) / 2 : Math.max(b.top, Math.min(b.bottom - VIEW_H, c.y));
  }

  render() {
    const ctx = this.ctx, map = this.map, p = this.player;
    if (this.inCashShop) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VIEW_W, VIEW_H); this.windows?.draw(ctx); return; }
    const cam = { ...this.cam, x: Math.round(this.cam.x), y: Math.round(this.cam.y) };
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    map.drawBacks(ctx, cam, false);

    // Same rule as the official client: foothold page, kept while airborne, 7 on ladders/ropes.
    const playerLayer = p.ladder ? 7 : p.fh?.layer ?? this.lastLayer ?? 7;
    this.lastLayer = playerLayer;
    for (let l = 0; l < 8; l++) {
      map.drawLayer(ctx, cam, l);
      for (const e of map.life) if ((e.fh?.layer ?? 7) === l) e.draw(ctx, cam, this.assets);
      if (l === 7) for (const rp of this.others.values()) this.drawChar(ctx, cam, rp, rp.look, false);
      for (const pet of this.pets.values()) if (!pet.onBack && pet.layer() === l) pet.draw(ctx, cam);
      if (l === playerLayer) this.drawChar(ctx, cam, p, this.look, true);
    }
    for (const pet of this.pets.values()) if (pet.onBack) pet.draw(ctx, cam);   // riding on a climber's back
    this.drawDrops(ctx, cam);
    map.drawPortals(ctx, cam);
    this.drawFx(ctx, cam);
    map.drawBacks(ctx, cam, true);
    this.drawBalloons(ctx, cam);
    this.vfx?.drawWorld(ctx, cam);
    drawPartyHp(ctx, this, cam);

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
    this.vfx?.drawHud(ctx);
    this.statusBar?.draw(ctx);
    this.windows?.draw(ctx);
    this.vfx?.drawBoss(ctx);
  }

  drawChar(ctx, cam, ent, look, local) {
    const parts = look.compose(ent.action, ent.frame);
    const sx = ent.x - cam.x, sy = ent.y - cam.y;
    const blink = local && this.invincible > 0 && Math.floor(this.invincible * 10) % 2 === 0;
    // dead: the ghost (body action "dead") hovers over the tombstone, bobbing slowly
    const ghost = ent.action === 'dead' ? -24 + Math.round(Math.sin(performance.now() / 450) * 3) : 0;
    drawParts(ctx, this.assets, parts, sx, sy + ghost, ent.facingRight, blink ? 0.5 : 1);
    nameTag(ctx, ent.name, Math.round(sx), Math.round(sy) + 4, local ? '#fff' : '#cfe8ff');
    const guild = local ? this.guild?.name : ent.guild;
    if (guild) drawGuildTag(ctx, this, guild, local ? this.guild.emblem : ent.emblem, Math.round(sx), Math.round(sy) + 22);
  }

  drawDrops(ctx, cam) {
    for (const d of this.drops.values()) {
      const node = d.anim.node;
      const img = this.assets.image(node);
      if (!img) continue;
      const x = d.cx, y = d.landed && !d.pickedBy ? d.y + Math.sin(d.phase) * 2 - 2 : d.cy;
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

function equipSlotFor(id) {
  const cat = Math.floor(id / 10000);
  const map = { 100: -1, 101: -2, 102: -3, 103: -4, 104: -5, 105: -5, 106: -6, 107: -7, 108: -8, 109: -10, 110: -9, 111: -12 };
  if (cat >= 130 && cat < 170) return -11;
  return map[cat] ?? null;
}
