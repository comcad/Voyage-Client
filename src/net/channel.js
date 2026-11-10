import { Connection } from './connection.js';
import { PacketWriter } from './packet.js';
import { C, S, S_NAMES } from './opcodes.js';
import { readCharacterInfo, readMarriage, readNewYearCard, readCharLook, writeCharLook, readRingLook, readItem, readMovement, writeMovement, isRechargeable } from './proto.js';

/** CashShop item records (addCashItemInformation): cash id, account, item, SN, count, gift sender, expiry. */
function readCashItem(r) {
  const cashId = r.long(); r.int(); r.int();
  const it = { cashId, itemId: r.int(), sn: r.int(), quantity: r.short(), from: r.paddedString(13), expiration: r.long() };
  r.long();
  return it;
}
/** CASHSHOP_OPERATION results that carry a failure reason (each sits next to its action's success code). */
const CS_FAILS = new Set([0x4C, 0x4E, 0x50, 0x56, 0x58, 0x5C, 0x5F, 0x61, 0x63, 0x65, 0x67, 0x69, 0x6B, 0x6D, 0x86, 0x88, 0x8A, 0x8C, 0x8E, 0x92, 0xA1]);
/** A Commodity override from SET_CASH_SHOP: a flag mask, then each flagged field in this order. */
const COMMODITY_FIELDS = [[0x1, 'ItemId', 'int'], [0x2, 'Count', 'short'], [0x10, 'Priority', 'ubyte'], [0x4, 'Price', 'int'],
  [0x8, 'Bonus', 'ubyte'], [0x20, 'Period', 'short'], [0x40, 'MaplePoint', 'int'], [0x80, 'Meso', 'int'], [0x100, 'Premium', 'ubyte'],
  [0x200, 'Gender', 'byte'], [0x400, 'OnSale', 'ubyte'], [0x800, 'Class', 'byte'], [0x1000, 'Limit', 'ubyte'],
  [0x2000, 'PbCash', 'short'], [0x4000, 'PbPoint', 'short'], [0x8000, 'PbGift', 'short']];
function readCommodityMod(r) {
  const c = { SN: r.int() }, flags = r.uint();
  for (const [bit, key, type] of COMMODITY_FIELDS) if (flags & bit) c[key] = r[type]();
  if (flags & 0x10000) { c.Package = []; for (let n = r.ubyte(); n > 0; n--) c.Package.push(r.int()); }
  return c;
}

/** Guild emblem: background, its colour, mark, its colour. */
const readEmblem = (r) => ({ bg: r.short(), bgColor: r.ubyte(), logo: r.short(), logoColor: r.ubyte() });
const readGuildMember = (r) => ({ name: r.paddedString(13), job: r.int(), level: r.int(), rank: r.int(), online: r.int() === 1 });
/** A guild's record as GUILD_OPERATION 0x1A and the alliance packets carry it; a member's last field is their alliance rank. */
function readGuild(r) {
  const g = { id: r.int(), name: r.string(), ranks: [r.string(), r.string(), r.string(), r.string(), r.string()] };
  const ids = []; for (let n = r.ubyte(); n > 0; n--) ids.push(r.int());
  g.members = ids.map((id) => { const m = { id, ...readGuildMember(r) }; r.int(); m.allianceRank = r.int(); return m; });
  g.capacity = r.int(); g.emblem = readEmblem(r); g.notice = r.string(); g.gp = r.int(); g.alliance = r.int();
  return g;
}
/** A guild alliance's record: id, name, its five rank titles, its guilds' ids, capacity and notice. */
function readAlliance(r) {
  const a = { id: r.int(), name: r.string(), ranks: [r.string(), r.string(), r.string(), r.string(), r.string()] };
  a.guildIds = []; for (let n = r.ubyte(); n > 0; n--) a.guildIds.push(r.int());
  a.capacity = r.int(); a.notice = r.string();
  return a;
}

/** A pet: item id, name, cash SN, position, stance, foothold, Label Ring and Quote Ring on */
function readPet(r) {
  const id = r.int(), name = r.string().replace(/\t/g, ' '), sn = r.long(), pos = r.pos2(), stance = r.ubyte(), fh = r.short(), nameTag = r.ubyte(), balloon = r.ubyte();
  return { id, name, sn, uid: Number(BigInt.asIntN(32, sn)), x: pos.x, y: pos.y, stance, fh, nameTag, balloon };
}

/** STAT_CHANGED mask bits (client/Stat.java). */
export const STAT = {
  SKIN: 0x1, FACE: 0x2, HAIR: 0x4, LEVEL: 0x10, JOB: 0x20, STR: 0x40, DEX: 0x80, INT: 0x100, LUK: 0x200,
  HP: 0x400, MAXHP: 0x800, MP: 0x1000, MAXMP: 0x2000, AP: 0x4000, SP: 0x8000, EXP: 0x10000, FAME: 0x20000,
  MESO: 0x40000, PET: 0x180008, GACHAEXP: 0x200000,
};
/** Buffs that change how you move (speed, jump, stun, weaken, slow, morph, Maple Warrior, seduce, ghost, Dash, riding). */
const MOVE_BUFFS_2 = 0x8000000000n | 0x10000000000n | 0x2000000000000n | 0x4000000000000000n | 0x1n | 0x2n | 0x8n | 0x80n | 0x20000n;
const MOVE_BUFFS_1 = 0x8000000000000n | 0x10000000000000n | 0x20000000000000n;
const TWO_STATE = 0x1fc000000000000n;
const movesBuff = (m1, m2) => !!(BigInt.asUintN(64, m1) & MOVE_BUFFS_1 || BigInt.asUintN(64, m2) & MOVE_BUFFS_2);
/** FORCED_STAT_SET's fields, bit 0 up: shorts, then bytes from speed on. */
const FORCED_STATS = ['str', 'dex', 'int', 'luk', 'watk', 'wdef', 'matk', 'mdef', 'acc', 'avoid', 'speed', 'jump', 'speedMax'];
const STAT_KEYS = {
  0x1: 'skin', 0x2: 'face', 0x4: 'hair', 0x10: 'level', 0x20: 'job', 0x40: 'str', 0x80: 'dex', 0x100: 'int', 0x200: 'luk',
  0x400: 'hp', 0x800: 'maxHp', 0x1000: 'mp', 0x2000: 'maxMp', 0x4000: 'ap', 0x8000: 'sp', 0x10000: 'exp', 0x20000: 'fame',
  0x40000: 'meso', 0x200000: 'gachaExp',
};

// parseDamage reads an extra int for these (Evan breaths, Big Bang x3, Grenade, Corkscrew x2, Poison Bomb)
const CHARGE_SKILLS = new Set([22121000, 22151001, 2121001, 2221001, 2321001, 5201002, 5101004, 15101003, 14111006]);

/**
 * Channel server session. Decodes in-game packets into calls on `handler`
 * (methods named after the event, all optional) and exposes typed senders.
 */
/** A shop / mini-game sign over a character (addAnnounceBox / updatePlayerShopBoxInfo). 0 = none. */
function readBox(r) {
  const type = r.ubyte();
  if (!type) return null;
  const box = { type, oid: r.int(), title: r.string() };
  if (type === 4) { r.ubyte(); box.permit = r.ubyte(); box.players = r.ubyte(); box.max = r.ubyte(); r.ubyte(); }
  else { box.locked = r.bool(); box.piece = r.ubyte(); box.players = r.ubyte(); box.max = r.ubyte(); box.playing = r.ubyte() !== 0; }
  return box;
}
/** A game record: an unused int, wins, ties, losses, points. */
function readGameRecord(r) { r.int(); return { wins: r.int(), ties: r.int(), losses: r.int(), points: r.int() }; }
/** ROOM for an Omok / Match Card room: capacity, your slot, the players (look, name), their records, title, piece, tournament. */
function readGameRoom(r, type) {
  const room = { type, capacity: r.ubyte(), mySlot: r.ubyte(), users: [null, null], records: [null, null] };
  for (let slot = r.byte(); slot >= 0; slot = r.byte()) { const look = readCharLook(r); room.users[slot] = { look, name: r.string() }; }
  for (let slot = r.byte(); slot >= 0; slot = r.byte()) room.records[slot] = readGameRecord(r);
  room.title = r.string(); room.piece = r.ubyte(); room.tournament = r.ubyte();
  if (room.tournament && r.available) room.round = r.ubyte();
  return room;
}
/** The stock: per item its bundles left, how many in a bundle, the bundle's price and the item itself. */
function readShopItems(r) {
  return Array.from({ length: r.ubyte() }, () => ({ bundles: r.short(), perBundle: r.short(), price: r.int(), item: readItem(r, false) }));
}
/**
 * ROOM type 5 (getHiredMerchant): your slot, the merchant item, visitors, the notes left while away, the owner's name - then, for the
 * owner only, opening time, sales and stored mesos - the title, and the stock (an empty one adds a 0 byte).
 */
function readMerchantRoom(r, selfName) {
  r.ubyte();
  const slot = r.short(), itemId = r.int(); r.string();
  const people = [];
  for (let s = r.ubyte(); s !== 0xFF; s = r.ubyte()) people.push({ slot: s, look: readCharLook(r), name: r.string() });
  // what visitors said while the owner was away (the owner's copy only): "name : text" and the seat it came from
  const notes = [];
  for (let n = r.short(); n > 0; n--) notes.push({ text: r.string(), slot: r.ubyte() });
  const owner = r.string(), mine = owner === selfName, sold = [];
  let firstTime = false;
  if (mine) {
    r.short(); r.short(); firstTime = r.bool();
    for (let n = r.ubyte(); n > 0; n--) sold.push({ id: r.int(), qty: r.short(), mesos: r.int(), buyer: r.string() });
    r.int();
  }
  const title = r.string(); r.ubyte();
  const mesos = r.int();            // the owner: what the merchant has earned; a visitor: their own
  const n = r.ubyte();
  const items = n ? Array.from({ length: n }, () => ({ bundles: r.short(), perBundle: r.short(), price: r.int(), item: readItem(r, false) })) : (r.ubyte(), []);
  return { merchant: true, itemId, ownerName: owner, slot: mine ? 0 : slot, firstTime, mesos, sold, people, title, items, notes };
}
/** ROOM type 4 (getPlayerShop): max visitors, your slot (0 owner), sales so far, owner and visitors, title, stock. */
function readShopRoom(r) {
  r.ubyte();
  const slot = r.ubyte(), sold = [];
  for (let n = r.ubyte(); n > 0; n--) sold.push({ id: r.int(), qty: r.short(), mesos: r.int(), buyer: r.string() });
  const people = [{ slot: 0, look: readCharLook(r), name: r.string() }];
  for (let s = r.ubyte(); s !== 0xFF; s = r.ubyte()) people.push({ slot: s, look: readCharLook(r), name: r.string() });
  const title = r.string();
  r.ubyte();
  return { slot, sold, people, title, items: readShopItems(r) };
}

/** A monster's 128-bit status flag: the last int holds bits 0-31, the one before it bits 32-63. */
function readMobMask(r) {
  r.int(); r.int(); const high = r.uint(), low = r.uint();
  return (b) => ((b < 32 ? low : b < 64 ? high : 0) >>> (b % 32)) & 1;
}
// the order the statuses are read in
const MOB_STAT_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 19, 16, 17, 21, 22, 24, 25, 26, 28, 29, 30, 32, 33, 34];
/** Each status's value, source skill and duration, then the extras of bits 27, 29-31; as { first, second, source, value }. */
function readMobStats(r, has) {
  const out = [];
  for (const b of MOB_STAT_ORDER) {
    if (!has(b)) continue;
    const value = r.short(), source = r.int(); r.short();
    out.push({ first: b >= 32 ? 2 ** (b - 32) : 0, second: b < 32 ? (2 ** b) >>> 0 : 0, source, value });
  }
  if (has(27)) for (let n = r.int(); n > 0; n--) r.skip(12);
  if (has(29)) r.int();
  if (has(30)) r.int();
  if (has(29) || has(30)) r.int();
  // bit 31: two bytes; while the first isn't 0 blows do nothing to it
  if (has(31)) { const a = r.ubyte(); r.ubyte(); out.push({ first: 0, second: 0x80000000, source: 0, value: a }); }
  return out;
}

/**
 * Another player's buffs (GIVE_FOREIGN_BUFF), read as the client reads them: the statuses it shows on others, each in
 * its own size and a fixed order, two bytes, then the two-state ones (Energy Charge, Dash, riding, Speed Infusion,
 * Homing Beacon, Undead), each a value, a reason (the skill), a time (byte + int) and a little more for some.
 * Index i of the 128-bit mask: 0-31 the second long's high half, 32-63 its low half, 64-95 / 96-127 the first long's.
 */
const REMOTE_STATS = [[7, 1, 'speed'], [21, 1, 'combo'], [22, 4, 'weaponCharge'], [17, 4, 'stun'], [20, 4, 'darkness'],
  [19, 4, 'seal'], [30, 4, 'weakness'], [31, 4, 'curse'], [18, 'poison', 'poison'], [26, 0, 'shadowPartner'],
  [10, 0, 'darkSight'], [16, 0, 'soulArrow'], [33, 2, 'morph'], [34, 2, 'ghost'], [39, 4, 'attract'], [41, 4, 'spiritJavelin'],
  [47, 4], [49, 4], [50, 4, 'barrier'], [51, 4, 'reverseInput'], [54, 4], [55, 4], [56, 4], [57, 4], [58, 0], [59, 0], [64, 0],
  [71, 4], [75, 4], [76, 4], [77, 4]];
const TWO_STATE_NAMES = ['energyCharged', 'dashSpeed', 'dashJump', 'ride', 'partyBooster', 'guidedBullet', 'undead'];
/**
 * Each two-state stat's size in a buff packet (first mask bits 50-56, after the plain stats and two bytes, in this order):
 * an int value, an int reason and a time (byte + int); then Speed Infusion a second time and a short, Homing Beacon the
 * monster (int), Monster Riding nothing more, the rest a short.
 */
const TWO_STATE_SIZES = [15, 15, 15, 13, 20, 17, 15];
const remoteBit = (i) => (i < 32 ? [1, i + 32] : i < 64 ? [1, i - 32] : i < 96 ? [0, i - 32] : [0, i - 96]);
const DISEASE_STATS = new Set(['stun', 'darkness', 'seal', 'weakness', 'curse', 'poison', 'attract', 'reverseInput', 'undead']);
function readRemoteStats(r, m1, m2) {
  const masks = [BigInt.asUintN(64, m1), BigInt.asUintN(64, m2)];
  const bit = (i) => { const [w, b] = remoteBit(i); return 1n << BigInt(b) & masks[w] ? (w ? [0n, 1n << BigInt(b)] : [1n << BigInt(b), 0n]) : null; };
  const out = { diseases: [] }, can = (n) => r.available >= n;
  const disease = (name, i, src) => {
    const skill = src & 0xffff, level = src >>> 16, [d1, d2] = bit(i);
    // a named curse, or an unnamed status a monster skill put on them (Slow comes this way)
    if ((!name || DISEASE_STATS.has(name)) && skill >= 100 && skill <= 200 && level > 0 && level < 256) out.diseases.push({ m1: d1, m2: d2, skill, level });
  };
  for (const [i, size, name] of REMOTE_STATS) {
    if (!bit(i)) continue;
    let v = true;
    if (size === 1) v = can(1) ? r.ubyte() : 0;
    else if (size === 2) v = can(2) ? r.short() : 0;
    else if (size === 4) v = can(4) ? r.int() : 0;
    else if (size === 'poison') { v = can(2) ? r.short() : 0; const src = can(4) ? r.int() : 0; disease(name, i, src); continue; }
    if (name) out[name] = v;
    if (size === 4) disease(name, i, v);
  }
  if (can(2)) r.skip(2);
  TWO_STATE_NAMES.forEach((name, k) => {
    if (!bit(82 + k) || !can(13)) return;
    const t = { value: r.int(), reason: r.int() }; r.skip(5);
    if (k === 4) r.skip(5);
    if (k === 5) t.mob = can(4) ? r.int() : 0;
    else if (k !== 3 && can(2)) r.short();
    out[name] = t;
    if (name === 'undead') disease(name, 82 + k, t.reason);
  });
  return out;
}

/** SET_FIELD's last 8 bytes, the server's clock, whatever was left unread before them; undefined when too short. */
function tailTime(r) {
  if (r.available < 8) return undefined;
  r.pos = r.b.length - 8;
  return r.long();
}

export class ChannelSession {
  constructor(transport, handler = {}) {
    this.conn = new Connection(transport);
    this.h = handler;
    this.moveId = 1;
    this.unhandled = {};
    this.conn.onUnhandled = (op) => { const n = S_NAMES[op] || `0x${op.toString(16)}`; this.unhandled[n] = (this.unhandled[n] || 0) + 1; };
    this.conn.onClose = () => this.h.disconnected?.();
    this._register();
  }
  ready() { return this.conn.ready; }
  close() { this.conn.close(); }
  send(w) { this.conn.send(w); }
  emit(name, ...a) {
    if (this.buffering) this.buffer.push([name, a]);
    else this.h[name]?.(...a);
  }

  /** Deliver events received between enter() and the game attaching its handlers. */
  flush() {
    this.buffering = false;
    const b = this.buffer; this.buffer = [];
    for (const [name, a] of b) this.h[name]?.(...a);
  }

  /** PLAYER_LOGGEDIN and wait for the first SET_FIELD (full character data). Events are buffered until flush(). */
  async enter(charId) {
    this.buffering = true; this.buffer = [];
    const p = this.conn.expect(S.SET_FIELD, 20000);
    this.send(new PacketWriter(C.PLAYER_LOGGEDIN).int(charId).zero(2));
    const r = await p;
    return this._setField(r, true);
  }

  _setField(r, first = false) {
    const channel = r.int();
    r.ubyte();
    const charData = r.ubyte();
    if (charData) {
      r.short(); r.int(); r.int(); r.int();
      const info = readCharacterInfo(r);
      this.job = info.stats.job;
      const out = { channel, charData: true, info, mapId: info.stats.mapId, portal: info.stats.spawnPoint, hp: info.stats.hp };
      out.serverTime = tailTime(r);   // the server's clock (a FILETIME), the packet's last 8 bytes
      if (!first) this.emit('setField', out);
      return out;
    }
    r.skip(3);
    const out = { channel, charData: false, mapId: r.int(), portal: r.ubyte(), hp: r.short() };
    if (r.bool()) out.pos = { x: r.int(), y: r.int() };
    out.serverTime = tailTime(r);
    this.emit('setField', out);
    return out;
  }

  _register() {
    const on = (op, fn) => this.conn.on(op, fn);
    on(S.SET_FIELD, (r) => this._setField(r));
    // ---- the Cash Shop: SET_CASH_SHOP (character info, then the shop's own data), its results, the NX balance
    on(S.SET_CASH_SHOP, (r) => {
      const info = readCharacterInfo(r);   // through the new-year cards and area info
      this.job = info.stats.job;
      r.short();
      const available = r.ubyte(), d = { info, available, account: available ? r.string() : '', removed: [], mods: [], discounts: [], best: [], stock: new Map(), level: 0 };
      try {
        for (let n = r.int(); n > 0; n--) d.removed.push(r.int());
        for (let n = r.short(); n > 0; n--) d.mods.push(readCommodityMod(r));
        for (let n = r.ubyte(); n > 0; n--) d.discounts.push({ cat: r.ubyte(), sub: r.ubyte(), rate: r.ubyte() });
        // best sellers: 9 tabs x 2 genders x 5 of (category, gender, SN)
        for (let i = 0; i < 90; i++) { r.int(); r.int(); d.best.push(r.int()); }
        for (let n = r.short(); n > 0; n--) d.stock.set(r.int(), r.int());   // 1 sold out, 2 not at this hour
        for (let n = r.short(); n > 0; n--) r.skip(0x68);                      // limited goods
        for (let n = r.short(); n > 0; n--) r.skip(0x44);                      // free-trial windows
        r.ubyte(); d.level = r.int();
      } catch (e) { console.warn('SET_CASH_SHOP: short packet', e); }
      this.emit('cashShopOpen', d);
    });
    // MEMO_RESULT 3: notes waiting for you (gift notices and the like): id, sender, text, time, fame
    on(S.MEMO_RESULT, (r) => {
      const mode = r.ubyte();
      if (mode === 4) { this.emit('memoSent'); return; }
      if (mode === 5) { this.emit('exclusiveAnswered'); this.emit('memoFailed', r.ubyte()); return; }
      if (mode !== 3) return;
      const notes = [];
      for (let n = r.ubyte(); n > 0; n--) notes.push({ id: r.int(), from: r.string().trim(), text: r.string(), time: r.long(), fame: r.ubyte() });
      this.emit('notes', notes);
    });
    on(S.QUERY_CASH_RESULT, (r) => this.emit('csCash', { credit: r.int(), maplePoint: r.int(), prepaid: r.int() }));
    on(S.CASHSHOP_OPERATION, (r) => {
      const op = r.ubyte(), list = (n) => { const out = []; for (; n > 0; n--) out.push(readCashItem(r)); return out; };
      if (op === 0x4B) { const items = list(r.short()); this.emit('csInventory', items, r.available >= 4 ? r.short() : null, r.available >= 2 ? r.short() : null); }
      else if (op === 0x4F || op === 0x55) { const sns = []; for (let i = 0; i < 10; i++) sns.push(r.int()); this.emit('csWish', sns.filter(Boolean), op === 0x55); }
      else if (op === 0x57) this.emit('csBought', readCashItem(r));
      else if (op === 0x4D) {                                    // gifts waiting: cash id, item, sender, message
        const gifts = [];
        for (let n = r.short(); n > 0; n--) gifts.push({ cashId: r.long(), itemId: r.int(), from: r.paddedString(13), message: r.paddedString(73), quantity: 1 });
        this.emit('csGifts', gifts);
      } else if (op === 0x5E) this.emit('csGiftSent', { to: r.string(), itemId: r.int(), count: r.short(), price: r.int() });
      else if (op === 0x89) { const items = list(r.ubyte()); this.emit('csBoughtPackage', items, r.available >= 2 ? r.short() : 0); }
      else if (op === 0x59) {                                   // a coupon: items into the locker, Maple Points, items into the inventory, mesos
        const items = list(r.ubyte()), maplePoints = r.int(), got = [];
        for (let n = r.int(); n > 0; n--) got.push({ count: r.short(), pos: r.short(), itemId: r.int() });
        this.emit('csCoupon', { items, maplePoints, got, mesos: r.int() });
      }
      else if (op === 0x8D) { const got = []; for (let n = r.int(); n > 0; n--) got.push({ count: r.short(), pos: r.short(), itemId: r.int() }); this.emit('csMesoBought', got); }
      else if (op === 0x87 || op === 0x91) { const item = readCashItem(r); this.emit('csRing', { item, to: r.string(), itemId: r.int(), count: r.short() }); }
      else if (op === 0x6E) this.emit('csExpired', r.long());
      else if (op === 0x47) { r.int(); const sn = r.int(); this.emit('csStock', sn, r.int()); }
      // a failure: the reason, and for 0xBF / 0xC0 (not at this hour / sold out) the SN
      else if (CS_FAILS.has(op)) {
        const reason = r.ubyte(), sn = (reason === 0xBF || reason === 0xC0) && r.available >= 4 ? r.int() : 0;
        this.emit('csError', reason, op, sn);
      }
      else if (op === 0x68) { const pos = r.short(); this.emit('csTaken', pos, readItem(r, false)); }
      else if (op === 0x6A) this.emit('csPut', readCashItem(r));
      else if (op === 0x60) { const type = r.ubyte(); this.emit('csSlots', 'inventory', r.short(), type); }
      else if (op === 0x62) this.emit('csSlots', 'storage', r.short());
      else if (op === 0x64) this.emit('csSlots', 'character', r.short());
      else if (op === 0x9E || op === 0xA0) this.emit('csTransferBought', op === 0x9E ? 'name' : 'world', readCashItem(r));
    });
    // a name change or world transfer: may it go ahead (an error code, then for a transfer the worlds), and is a new name free
    on(S.CASHSHOP_CHECK_NAME_CHANGE_POSSIBLE_RESULT, (r) => { r.int(); const error = r.ubyte(); this.emit('csNameChangeRules', error, r.int()); });
    on(S.CASHSHOP_CHECK_NAME_CHANGE, (r) => { const name = r.string(); this.emit('csNameChecked', name, r.byte()); });
    on(S.CASHSHOP_CHECK_TRANSFER_WORLD_POSSIBLE_RESULT, (r) => {
      r.int(); const error = r.ubyte(), x = r.int(), worlds = [];
      if (r.ubyte()) for (let n = r.int(); n > 0; n--) worlds.push(r.string());
      this.emit('csWorldTransferRules', error, x, worlds);
    });

    // the yellow chat tip: a flag (0 only shows the first one), then two lines
    on(S.SET_WEEK_EVENT_MESSAGE, (r) => { const again = r.ubyte(); this.emit('yellowTip', again !== 0, r.string(), r.available >= 2 ? r.string() : ''); });
    // ADMIN_RESULT 0x10: GM hide on (1) or off (0)
    on(S.ADMIN_RESULT, (r) => {
      const t = r.ubyte();
      if (t === 0x10) this.emit('gmHide', !!r.ubyte());
      else if (t === 0x1C) this.emit('minimap', 'off');     // the minimap off until the next map
      else if (t === 0x1B) this.emit('minimap', 'check');   // check this map's minimap again
    });
    on(S.MINIMAP_ON_OFF, (r) => this.emit('minimap', r.ubyte()));
    on(S.STAT_CHANGED, (r) => {
      const enable = r.bool();
      if (enable) this.emit('exclusiveAnswered');   // the server's answer to an exclusive request
      const mask = r.uint();
      const stats = {};
      for (let bit = 1; bit <= 0x200000; bit *= 2) {
        if (!(mask & bit)) continue;
        if (bit === 0x8 || bit === 0x80000 || bit === 0x100000) { r.long(); continue; } // pet uids
        if (bit === 0x1) stats.skin = r.ubyte();
        else if (bit <= 0x4) stats[STAT_KEYS[bit]] = r.int();
        else if (bit < 0x20) stats[STAT_KEYS[bit]] = r.ubyte();
        else if (bit === 0x8000) {
          // Evan (22xx, 2001): SP per job level, read by the job as it stands after this packet's own job change
          if (Math.floor(this.job / 100) === 22 || this.job === 2001) {
            stats.spTable = []; stats.sp = 0;
            for (let n = r.ubyte(); n > 0; n--) stats.spTable.push([r.ubyte(), r.ubyte()]);
          } else stats.sp = r.short();
        }
        else if (bit < 0xffff) { stats[STAT_KEYS[bit]] = r.short(); if (bit === 0x20) this.job = stats.job; }
        else if (bit === 0x20000) stats.fame = r.short();
        else stats[STAT_KEYS[bit]] = r.int();
      }
      this.emit('stats', stats, enable);
      if (mask & 0x180008 && r.available) this.emit('moveElement', r.ubyte());
    });

    on(S.SHOW_STATUS_INFO, (r) => {
      const mode = r.ubyte();
      if (mode === 1) { // quest record: status 0 forfeit/removed, 1 started (+progress), 2 completed (+time)
        const id = r.ushort(), status = r.ubyte();
        const data = status === 1 ? r.string() : status === 2 ? r.long() : undefined;
        this.emit('quest', id, status, data);
      } else if (mode === 0x0A) { const id = r.ushort(); this.emit('questEx', id, r.string()); }
      else if (mode === 9) this.emit('notice', { type: 5, msg: r.string() });
      else if (mode === 3) {
        // EXP: white, amount, in chat (a quest's: a grey log line), then the bonuses shown with a monster's
        const white = r.bool(), amount = r.int(), inChat = r.bool(), b = {};
        try {
          b.event = r.int(); r.ubyte(); r.ubyte(); b.wedding = r.int();
          if (inChat) r.ubyte();
          b.partyRate = r.ubyte(); b.party = r.int(); b.equip = r.int(); b.cafe = r.int(); b.rainbow = r.int();
        } catch { /* a shorter form: the amount alone */ }
        this.emit('status', { type: 'exp', amount, white, inChat, bonus: b });
      }
      else if (mode === 0) {
        const sub = r.ubyte();
        if (sub === 1) {
          const lost = r.ubyte(), amount = r.int(), bonus = r.available >= 2 ? r.short() : 0;
          this.emit('status', { type: 'meso', amount, lost: !!lost, bonus });
        } else if (sub === 0) { const id = r.int(), qty = r.int(); this.emit('status', { type: 'item', id, qty, pickup: true }); }
        else if (sub === 2) this.emit('status', { type: 'item', id: r.int(), qty: 1, pickup: true });
        else if (sub === 0xFE) this.emit('status', { type: 'text', text: 'This item is unavailable for the pick-up.' });
        else if (sub === 0xFD) this.emit('status', { type: 'text', text: 'You cannot acquire any items.' });
        else this.emit('status', { type: 'text', text: "You can't get anymore items." });
        this.emit('pickupAnswered');
      } else if (mode === 4) this.emit('status', { type: 'fame', amount: r.int() });
      else if (mode === 5) this.emit('status', { type: 'meso', amount: r.int(), inChat: true });
      else if (mode === 6) this.emit('status', { type: 'gp', amount: r.int() });
      else if (mode === 7) this.emit('status', { type: 'itemMsg', id: r.int() });
      else if (mode === 2) this.emit('status', { type: 'expired', ids: [r.int()], cash: true });
      else if (mode === 8 || mode === 0x0B || mode === 0x0D) {
        const ids = [];
        for (let n = r.ubyte(); n > 0; n--) ids.push(r.int());
        this.emit('status', { type: mode === 8 ? 'expired' : mode === 0x0B ? 'sealExpired' : 'timeLimit', ids });
      } else if (mode === 0x0C) { for (let n = r.ubyte(); n > 0; n--) this.emit('notice', { type: 5, msg: r.string() }); }
    });

    // SERVERMESSAGE: 0 notice, 1 pop-up, 2 Megaphone, 3 Super Megaphone (+ channel, whisper ear), 4 the scrolling
    // header, 5 pink, 6 light blue, 7 an NPC's, 8 Item Megaphone (+ channel, ear, the item), 10 Triple Megaphone
    // (+ more lines, channels, ear), 11 a Gachapon prize ("name : got a(n)", the channel or -1 for the Cash Shop
    // Surprise, the town, the item)
    on(S.SERVERMESSAGE, (r) => {
      const type = r.ubyte();
      if (type === 4) r.ubyte();
      const n = { type, msg: r.string() };
      try {
        if (type === 3) { n.channel = r.ubyte() + 1; n.ear = r.bool(); }
        else if (type === 8) { n.channel = r.ubyte() + 1; n.ear = r.bool(); if (r.ubyte()) n.item = readItem(r, false); }
        else if (type === 0x0B) { n.channel = r.int(); n.town = r.string(); n.item = readItem(r, false); }
        else if (type === 10) {
          n.lines = [n.msg];
          for (let k = r.ubyte(); k > 1; k--) n.lines.push(r.string());
          n.channel = r.ubyte() + 1; r.skip(9); n.ear = r.bool();
        }
      } catch { /* an older server's shorter form: the text alone */ }
      // a server with USE_DEBUG on reports every hit ("Hitted MOB 100100, OID 1234"): not for the chat log
      if (type === 5 && /^Hitted (MOB|REACTOR) /.test(n.msg)) return;
      this.emit('notice', n);
    });
    // SPOUSE_CHAT: a line between husband and wife (5: from whom, 5, the text), echoed to both
    on(S.SPOUSE_CHAT, (r) => { const mode = r.ubyte(); const from = mode === 5 ? r.string() : ''; r.ubyte(); this.emit('spouseChat', from, r.string()); });
    // PARCEL (Duey): 8 the parcels waiting for you (opens Duey), 0x17 one was taken or deleted, 0x19 / 0x1B a parcel
    // arrived for you, anything else a result code (0x12 sent, 0x0A not enough mesos, 0x0C no such character...)
    // PARCEL: 8 Duey opens (quick byte, the parcels, then the expired ones), 0x17 claimed / deleted (id, 3 deleted),
    // 0x18 one more parcel, 0x19 / 0x1B one arrived (sender, quick), 0x1A the Quick Delivery Ticket's window,
    // anything else a result code
    const parcel = (r) => {
      const p = { id: r.int(), sender: r.paddedString(13), mesos: r.int(), sent: r.long(), quick: r.int() !== 0, message: r.paddedString(200) };
      r.ubyte();
      if (r.ubyte()) p.item = readItem(r, false);
      return p;
    };
    on(S.PARCEL, (r) => {
      const op = r.ubyte();
      if (op === 8) {
        const quick = r.ubyte() !== 0, list = [], expired = [];
        for (let n = r.ubyte(); n > 0; n--) list.push(parcel(r));
        if (r.available) for (let n = r.ubyte(); n > 0; n--) expired.push(parcel(r));
        this.emit('duey', { op: 'open', mode: quick ? 2 : 0, list, expired });
      } else if (op === 0x17) { const id = r.int(); this.emit('duey', { op: 'gone', id, result: r.available ? r.ubyte() : 4 }); }
      else if (op === 0x18) this.emit('duey', { op: 'added', parcel: parcel(r) });
      else if (op === 0x19) this.emit('duey', { op: 'arrived', from: r.string(), quick: r.bool() });
      else if (op === 0x1B) this.emit('duey', { op: 'arrived', from: '', quick: r.available ? r.bool() : false });
      else if (op === 0x1A) this.emit('duey', { op: 'open', mode: 1, list: [], expired: [] });
      else this.emit('duey', { op: 'result', code: op });
    });
    // CHALKBOARD: someone holds up a chalkboard (1, its text) or puts it away (0)
    // the Owl of Minerva: 7 the most-searched items; 6 the stores selling one (an NPC price, then each store row)
    on(S.SHOP_SCANNER_RESULT, (r) => {
      const mode = r.ubyte();
      if (mode === 7) { const ids = []; for (let n = r.ubyte(); n > 0; n--) ids.push(r.int()); this.emit('owlPopular', ids); return; }
      if (mode !== 6) return;
      const npcPrice = r.int(), itemId = r.int(), rows = [];
      for (let n = r.int(); n > 0; n--) {
        const row = { owner: r.string(), mapId: r.int(), title: r.string(), bundles: r.int(), perBundle: r.int(), price: r.int(), ownerId: r.int(), channel: r.byte() };
        if (r.ubyte() === 1) row.item = readItem(r, false);
        rows.push(row);
      }
      this.emit('owlResults', { npcPrice, itemId, rows });
    });
    on(S.SHOP_LINK_RESULT, (r) => this.emit('owlLink', r.ubyte()));
    // Cash Shop Surprise: 0xE5 the box (cash id, how many are left), the item that came out into the locker, then
    // what it was (item, count, jackpot); 0xE4 too many cash items
    on(S.CASHSHOP_CASH_ITEM_GACHAPON_RESULT, (r) => {
      const mode = r.ubyte();
      if (mode === 0xE4) { this.emit('csSurprise', { failed: true }); return; }
      if (mode !== 0xE5) return;
      const box = r.long(), left = r.int(), item = readCashItem(r);
      const won = r.available >= 6 ? { itemId: r.int(), count: r.ubyte(), jackpot: r.ubyte() !== 0 } : null;
      this.emit('csSurprise', { box, left, item, won });
    });
    // Vicious' Hammer: 0x3D / 0x3E closing (code), otherwise a result (code, hammers used) to show first
    on(S.VICIOUS_HAMMER, (r) => {
      const mode = r.ubyte(), e = { mode, code: r.int() };
      if (mode !== 0x3D && mode !== 0x3E) e.count = r.int();
      this.emit('hammer', e);
    });
    on(S.VEGA_SCROLL, (r) => this.emit('vega', r.ubyte()));
    // Maple Life: the name check (name, 0 free / above 0 taken / below 0 an error), then the creation (result, code)
    on(S.MAPLELIFE_RESULT, (r) => { r.string(); this.emit('mapleLifeName', r.byte()); });
    on(S.MAPLELIFE_ERROR, (r) => { const result = r.ubyte(); this.emit('mapleLifeCreated', result, r.int()); });
    // what hatched from a Pigmy Egg (item, count; no item: the inventory was full); a Gold / Silver box opened
    on(S.INCUBATOR_RESULT, (r) => { const id = r.int(); this.emit('incubated', id, r.short()); });
    on(S.SUCCESS_IN_USE_GACHAPON_BOX, (r) => this.emit('treasureBoxOpened', r.int()));
    // the Maker's answer: result; when 0 or 1 the kind and what was gained and lost (items, gems, Stimulator, mesos)
    on(S.MAKER_RESULT, (r) => {
      const d = { result: r.int(), lost: [], gems: [], gained: [] }, pairs = (out) => { for (let n = r.int(); n > 0; n--) out.push({ id: r.int(), count: r.int() }); };
      if (d.result === 0 || d.result === 1) {
        d.type = r.int();
        if (d.type === 1 || d.type === 2) {
          if (!r.byte()) d.made = { id: r.int(), count: r.int() };
          pairs(d.lost);
          for (let n = r.int(); n > 0; n--) d.gems.push(r.int());
          if (r.byte()) d.catalyst = r.int();
          d.meso = r.int();
        } else if (d.type === 3) { d.made = { id: r.int(), count: 1 }; d.leftover = r.int(); }
        else if (d.type === 4) { d.equip = r.int(); pairs(d.gained); d.meso = r.int(); }
      }
      this.emit('makerOutcome', d);
    });
    // your account's gender (only 0 may propose)
    on(S.SET_GENDER, (r) => this.emit('accountGender', r.ubyte()));
    // a proposal to you (0: who, their id); 9 the wedding wish list
    on(S.MARRIAGE_REQUEST, (r) => { if (r.ubyte() === 0) { const name = r.string(); this.emit('proposal', name, r.int()); } });
    // MARRIAGE_RESULT: 0x0b / 0x0c the record (engaged / married), 0x0f an invitation (groom, bride, type), 0x24 a message
    on(S.MARRIAGE_RESULT, (r) => {
      const mode = r.ubyte(), e = { mode };
      if (mode === 0x0b || mode === 0x0c) e.record = readMarriage(r);
      else if (mode === 0x0f) { e.groom = r.string(); e.bride = r.string(); e.type = r.short(); }
      else if (mode === 0x24 && r.ubyte()) e.text = r.string();
      this.emit('marriageResult', e);
    });
    // NEW_YEAR_CARD_RES: 4 sent / 6 received (the card), 5/7/9/0xb refused (reason), 8 deleted, 0xa / 0xc cards
    // waiting (id, sender), 0xd someone here holds a card, 0xe a card is gone; every answer frees the request
    on(S.NEW_YEAR_CARD_RES, (r) => {
      this.emit('exclusiveAnswered');
      const mode = r.ubyte(), e = { mode };
      if (mode === 4 || mode === 6) e.card = readNewYearCard(r);
      else if ([5, 7, 9, 0xb].includes(mode)) e.reason = r.ubyte();
      else if (mode === 8 || mode === 0xe) e.id = r.int();
      else if (mode === 0xa) {
        e.cards = [];
        const n = r.int();
        if (n > 0 && n < 100) for (let i = 0; i < n; i++) { const id = r.int(); r.int(); e.cards.push({ id, sender: r.string() }); }
      } else if (mode === 0xc) { const id = r.int(); e.cards = [{ id, sender: r.string() }]; }
      else if (mode === 0xd) { e.id = r.int(); e.charId = r.int(); }
      this.emit('newYearCard', e);
    });
    // kites and banners: id, item, message, owner, x, y; removed (0 fading, else at once); refused
    on(S.SPAWN_KITE, (r) => this.emit('kite', { id: r.int(), itemId: r.int(), message: r.string(), owner: r.string(), x: r.short(), y: r.short() }));
    on(S.REMOVE_KITE, (r) => { const type = r.ubyte(); this.emit('kiteRemove', type, r.int()); });
    on(S.CANNOT_SPAWN_KITE, () => this.emit('kiteRefused'));
    // a jukebox song: the item, then for a jukebox (510) who played it; -1 ends it
    on(S.PLAY_JUKEBOX, (r) => { const id = r.int(); this.emit('jukebox', id, Math.floor(id / 10000) === 510 ? r.string() : null); });
    on(S.MESO_BAG_SUCCESS, (r) => this.emit('mesoBag', r.int()));
    on(S.MESO_BAG_FAIL, () => this.emit('mesoBag', null));
    // cancelling a name change (0 done, else B 0 unknown / a reason) or a world transfer (0 done, 1 failed, else as before)
    on(S.CANCEL_NAME_CHANGE_RESULT, (r) => { const v = r.ubyte(); this.emit('cancelResult', 1, v, v ? (r.available && r.ubyte() ? r.string() : '') : null); });
    on(S.CANCEL_TRANSFER_WORLD_RESULT, (r) => { const v = r.ubyte(); this.emit('cancelResult', 2, v, v > 1 ? (r.available && r.ubyte() ? r.string() : '') : null); });
    on(S.CANCEL_NAME_CHANGE_BY_OTHER, () => { this.emit('exclusiveAnswered'); this.emit('cancelNotRequested'); });
    on(S.CHALKBOARD, (r) => { const id = r.int(); this.emit('chalkboard', id, r.ubyte() ? r.string() : null); });
    // MAP_TRANSFER_RESULT: your Teleport Rock list after saving (3) or deleting (2) a map - VIP (10 maps) or not (5)
    on(S.MAP_TRANSFER_RESULT, (r) => {
      const mode = r.ubyte();
      if (mode !== 2 && mode !== 3) { this.emit('rockError', mode); return; }
      const vip = r.bool();
      this.emit('rocks', vip, Array.from({ length: vip ? 10 : 5 }, () => r.int()));
    });
    // Avatar Megaphone (539xxxx): who, their four lines, channel, whisper ear, their look; cleared ten seconds on
    on(S.SET_AVATAR_MEGAPHONE, (r) => {
      const itemId = r.int(), name = r.string(), lines = [r.string(), r.string(), r.string(), r.string()];
      const channel = r.int() + 1, ear = r.bool();
      this.emit('avatarMega', { itemId, name, lines, channel, ear, look: readCharLook(r) });
    });
    on(S.CLEAR_AVATAR_MEGAPHONE, () => this.emit('avatarMegaClear'));
    // MapleTV: SEND_TV (a receiver's look follows when flag & 2), REMOVE_TV, ENABLE_TV (an error code), MAPLE_TV_USE_RES (a message)
    on(S.SEND_TV, (r) => {
      const flag = r.ubyte(), type = r.ubyte(), from = readCharLook(r), fromName = r.string(), toName = r.string(), lines = [];
      for (let i = 0; i < 5; i++) lines.push(r.string());
      const seconds = r.int(), to = flag & 2 ? readCharLook(r) : null;
      this.emit('tv', { type, from, fromName, toName, lines, seconds, to });
    });
    on(S.REMOVE_TV, () => this.emit('tvOff'));
    on(S.ENABLE_TV, (r) => { if (r.ubyte()) this.emit('tvError', r.available ? r.ubyte() : 0); });
    on(S.MAPLE_TV_USE_RES, (r) => this.emit('tvResult', r.available ? r.string() : ''));
    // AVATAR_MEGAPHONE_RESULT: 'S' the line is over 15 seconds long, 'T' under level 11, else the server's own text
    on(S.AVATAR_MEGAPHONE_RESULT, (r) => {
      const code = r.ubyte();
      this.emit('avatarMegaResult', code === 0x53 ? 'The waiting line is longer than 15 seconds. \r\nPlease try using it at a later time.'
        : code === 0x54 ? 'This megaphone is only available for \r\ncharacters that are over Level 10.' : r.available ? r.string() : '');
    });

    on(S.CHATTEXT, (r) => this.emit('chat', { id: r.int(), gm: r.bool(), text: r.string(), show: r.ubyte() }));
    // SKILL_LEARN_ITEM_RESULT: whose book it was, skill (0) or mastery (1) book, the skill and its new max level,
    // whether it could be used, whether it worked
    // INVENTORY_GROW: an inventory's new slot count; GATHER_ITEM_RESULT / SORT_ITEM_RESULT: which inventory is done
    on(S.INVENTORY_GROW, (r) => { const type = r.ubyte(); this.emit('inventoryGrow', type, r.ubyte()); });
    on(S.GATHER_ITEM_RESULT, (r) => { r.ubyte(); this.emit('sortResult', r.ubyte(), 1); });
    on(S.SORT_ITEM_RESULT, (r) => { r.ubyte(); this.emit('sortResult', r.ubyte(), 0); });
    on(S.SKILL_LEARN_ITEM_RESULT, (r) => {
      const id = r.int(), mastery = r.bool(), skill = r.int(), maxLevel = r.int(), canUse = r.bool(), success = r.bool();
      this.emit('skillBookResult', { id, mastery, skill, maxLevel, canUse, success });
    });
    // FAME_RESPONSE (On_FAME_RESPONSE): 0 you raised (1) / dropped someone's fame, then their new fame as an int the
    // window keeps as a short; 5 someone raised / dropped yours; 1-4 errors; anything else "unexpected error"
    on(S.FAME_RESPONSE, (r) => {
      const mode = r.ubyte();
      if (mode === 0) { const name = r.string(); const up = r.ubyte() === 1; const fame = (r.int() << 16) >> 16; this.emit('fame', { mode, name, up, fame }); }
      else if (mode === 5) { const name = r.string(); this.emit('fame', { mode, name, up: r.ubyte() === 1 }); }
      else this.emit('fame', { mode });
    });
    // ---- buddy list (CWvsContext::OnFriendResult)
    const fixed = (r, n) => { const b = r.bytes(n); let s = ''; for (const c of b) { if (!c) break; s += String.fromCharCode(c); } return s; };
    on(S.BUDDYLIST, (r) => {
      const op = r.ubyte();
      if (op === 7 || op === 10 || op === 0x12) {
        // flag 1: a request still waiting for an answer
        const list = [];
        for (let n = r.ubyte(); n > 0 && r.available >= 39; n--) {
          const id = r.int(), name = fixed(r, 13), pending = r.ubyte() === 1;
          const channel = r.int(), group = fixed(r, 17);
          list.push({ id, name, channel, group, pending });
        }
        this.emit('buddies', list);
      } else if (op === 9) {
        // a request: who it's from, then their buddy record (the list keeps it as a pending entry) and an in-shop byte
        const id = r.int(), name = r.string();
        let entry = null;
        if (r.available >= 40) {
          entry = { id: r.int(), name: fixed(r, 13), pending: r.ubyte() === 1, channel: r.int(), group: fixed(r, 17) };
          r.ubyte();
        }
        this.emit('buddyRequest', { id, name, entry });
      } else if (op === 0x14) {
        const id = r.int(); r.ubyte();
        this.emit('buddyChannel', id, r.int());
      } else if (op === 0x15) this.emit('buddyCapacity', r.ubyte());
      else this.emit('buddyMessage', op);
    });
    // ---- party (CWvsContext::OnPartyResult)
    const partyStatus = (r) => {
      const ids = Array.from({ length: 6 }, () => r.int()), names = ids.map(() => fixed(r, 13));
      const jobs = ids.map(() => r.int()), levels = ids.map(() => r.int()), channels = ids.map(() => r.int());
      const leader = r.int(), maps = ids.map(() => r.int());
      const members = ids.map((id, i) => ({ id, name: names[i], job: jobs[i], level: levels[i], channel: channels[i], map: maps[i] })).filter((m) => m.id);
      return { leader, members };
    };
    // ---- guilds: GUILD_OPERATION sub-ops (GuildPackets); messages are bare codes, 53-55 add a name
    on(S.GUILD_OPERATION, (r) => {
      const op = r.ubyte(), e = (kind, d = {}) => this.emit('guild', { kind, ...d });
      const member = () => readGuildMember(r);
      if (op === 0x01) e('askName');
      else if (op === 0x03) { r.int(); e('agreement', { master: r.string(), name: r.string() }); }
      else if (op === 0x05) e('invite', { id: r.int(), from: r.string() });
      else if (op === 0x1A) {
        e('info', { guild: r.ubyte() ? readGuild(r) : null });
      } else if (op === 0x27) {
        const gid = r.int(), id = r.int(), m = { id, ...member() };
        if (r.available >= 8) { r.int(); m.allianceRank = r.int(); }
        e('join', { gid, member: m });
      }
      else if (op === 0x2C || op === 0x2F) e(op === 0x2F ? 'expel' : 'leave', { gid: r.int(), id: r.int(), name: r.string() });
      else if (op === 0x32) e('disband', { gid: r.int() });
      else if (op === 0x3A) e('capacity', { gid: r.int(), capacity: r.ubyte() });
      else if (op === 0x3C) e('levelJob', { gid: r.int(), id: r.int(), level: r.int(), job: r.int() });
      else if (op === 0x3D) e('online', { gid: r.int(), id: r.int(), online: r.bool() });
      else if (op === 0x3E) { r.int(); e('ranks', { ranks: [r.string(), r.string(), r.string(), r.string(), r.string()] }); }
      else if (op === 0x40) e('rank', { gid: r.int(), id: r.int(), rank: r.ubyte() });
      else if (op === 0x42) { r.int(); e('emblem', { emblem: readEmblem(r) }); }
      else if (op === 0x44) { r.int(); e('notice', { notice: r.string() }); }
      else if (op === 0x48) { r.int(); e('gp', { gp: r.int() }); }
      else if (op === 0x11) e('makeMark');
      else if (op === 0x49) {
        // the ranking board: the NPC's id, then each guild's name, GP and emblem (logo, its colour, background, its colour)
        r.int();
        const list = [];
        for (let n = r.int(); n > 0; n--) list.push({ name: r.string(), gp: r.int(), emblem: { logo: r.int(), logoColor: r.int(), bg: r.int(), bgColor: r.int() } });
        e('board', { list });
      }
      // the Guild Quest queue: channel, then place (an int; some servers send a byte)
      else if (op === 0x4C) { const channel = r.ubyte(); e('gpqQueue', { channel, pos: r.available >= 4 ? r.int() : r.ubyte() }); }
      else if (op === 0x4E) { const ok = r.ubyte(); e('message', { code: op, ok, text: r.available >= 2 ? r.string() : '' }); }
      else e('message', { code: op, name: op >= 53 && op <= 55 && r.available ? r.string() : '' });
    });
    on(S.GUILD_NAME_CHANGED, (r) => this.emit('guildName', r.int(), r.string()));
    on(S.GUILD_MARK_CHANGED, (r) => this.emit('guildMark', r.int(), readEmblem(r)));
    on(S.PARTY_OPERATION, (r) => {
      const op = r.ubyte();
      if (op === 8) this.emit('party', { kind: 'created', id: r.int() });
      else if (op === 4) { const id = r.int(), name = r.string(); this.emit('partyInvite', { id, name, autoJoin: r.available ? r.ubyte() !== 0 : false }); }
      else if (op === 7 || op === 0x22) { const id = r.int(); this.emit('party', { kind: 'update', id, ...partyStatus(r) }); }
      else if (op === 0x0F) { const id = r.int(), name = r.string(); this.emit('party', { kind: 'join', id, name, ...partyStatus(r) }); }
      else if (op === 0x0C) {
        const id = r.int(), target = r.int();
        if (r.ubyte() === 0) this.emit('party', { kind: 'disband', id, target });
        else { const expel = r.ubyte() === 1, name = r.string(); this.emit('party', { kind: expel ? 'expel' : 'leave', id, target, name, ...partyStatus(r) }); }
      } else if (op === 0x1B) { const leader = r.int(); this.emit('party', { kind: 'leader', leader, reason: r.available ? r.ubyte() : 0 }); }
      else if (op === 0x23) { if (r.available >= 12) this.emit('party', { kind: 'levelJob', id: r.int(), level: r.int(), job: r.int() }); }
      else if (op === 0x24) { const ok = r.available ? r.ubyte() : 0; this.emit('partyMessage', op, ok && r.available >= 2 ? r.string() : ''); }
      else if (op === 0x25) { /* a member's Mystic Door */ }
      else this.emit('partyMessage', op, r.available >= 2 ? r.string() : '');
    });
    on(S.UPDATE_PARTYMEMBER_HP, (r) => this.emit('partyHp', r.int(), r.int(), r.int()));
    // NOTIFY_LEVELUP: a guildmate (2) or family member levelled
    on(S.NOTIFY_LEVELUP, (r) => { const type = r.ubyte(), level = r.int(); this.emit('notifyLevel', { type, level, name: r.string() }); });
    // a guildmate's (0) or family member's (1) job advancement and marriage
    on(S.NOTIFY_JOB_CHANGE, (r) => { const type = r.ubyte(), job = r.int(); this.emit('notifyJob', { type, job, name: r.string() }); });
    on(S.NOTIFY_MARRIAGE, (r) => { const type = r.ubyte(); this.emit('notifyMarriage', { type, name: r.string() }); });
    // Hired Merchants on the map (spawnHiredMerchantBox / updateHiredMerchantBox / removeHiredMerchantBox)
    on(S.SPAWN_HIRED_MERCHANT, (r) => {
      const owner = r.int(), itemId = r.int(), x = r.short(), y = r.short(); r.short();
      const name = r.string(); r.ubyte();
      const oid = r.int(), title = r.string(), permit = r.ubyte(), players = r.ubyte(), max = r.ubyte();
      this.emit('merchantSpawn', { owner, itemId, x, y, name, oid, title, permit, players, max });
    });
    on(S.UPDATE_HIRED_MERCHANT, (r) => {
      const owner = r.int(); r.ubyte();
      const oid = r.int(), title = r.string(), permit = r.ubyte(), players = r.ubyte(), max = r.ubyte();
      this.emit('merchantUpdate', owner, { oid, title, permit, players, max });
    });
    on(S.DESTROY_HIRED_MERCHANT, (r) => this.emit('merchantRemove', r.int()));
    // UPDATE_CHAR_BOX: a character's shop / game sign changed (type 0 = taken down)
    // ---- Family (Cosmic PacketCreator getFamilyInfo / showPedigree / loadFamily / sendFamily*)
    // FAMILY_PRIVILEGE_LIST (at login): per privilege its type, reputation cost, uses allowed, name and description
    on(S.FAMILY_PRIVILEGE_LIST, (r) => this.emit('family', { op: 'privileges', list: Array.from({ length: r.int() }, () => ({ type: r.ubyte(), cost: r.int(), limit: r.int(), name: r.string(), desc: r.string() })) }));
    // FAMILY_INFO_RESULT: your reputation (now, all-time, today), juniors (have / allowed), the leader, family name and precepts, uses per privilege
    on(S.FAMILY_INFO_RESULT, (r) => {
      const f = { rep: r.int(), totalRep: r.int(), todayRep: r.int(), juniors: r.short(), maxJuniors: r.short() };
      r.short();
      Object.assign(f, { leader: r.int(), name: r.string(), message: r.string(), used: {} });
      for (let n = r.int(); n > 0; n--) f.used[r.int()] = r.int();
      this.emit('family', { op: 'info', info: f });
    });
    // FAMILY_CHART_RESULT (the pedigree): whose it is, its members (id, senior id, job, level, online, reputation..., channel, name),
    // then counts (-1 = members in all, 0 = seniors above, else that member's juniors in all), privileges used, the Add flag
    on(S.FAMILY_CHART_RESULT, (r) => {
      const self = r.int(), members = [];
      for (let n = r.int(); n > 0; n--) {
        const m = { id: r.int(), senior: r.int(), job: r.short(), level: r.ubyte(), online: r.bool(), rep: r.int(), totalRep: r.int(), toSenior: r.int(), todayRep: r.int(), channel: r.int(), minutes: r.int() };
        m.name = r.string();
        members.push(m);
      }
      const counts = {};
      for (let n = r.int(); n > 0; n--) counts[r.int()] = r.int();
      for (let n = r.int(); n > 0; n--) { r.int(); r.int(); }
      this.emit('family', { op: 'chart', self, members, counts, canAdd: r.available >= 2 ? r.short() !== 0 : true });
    });
    on(S.FAMILY_RESULT, (r) => this.emit('family', { op: 'result', code: r.int(), mesos: r.int() }));
    // FREDRICK: 0x23 his store bank (the NPC, the slots, a flag block, then the mesos and each inventory's items as the
    // flags say), 0x26 not available now. FREDRICK_MESSAGE: what came of GET ALL.
    on(S.FREDRICK, (r) => {
      const op = r.ubyte();
      if (op === 0x23) {
        const npc = r.int(), slots = r.ubyte(), flags = r.bytes(8)[0], items = [];
        const mesos = flags & 2 ? r.int() : 0;
        for (const f of [4, 8, 0x10, 0x20, 0x40]) if (flags & f) for (let n = r.ubyte(); n > 0; n--) items.push(readItem(r, false));
        this.emit('fredrick', { op: 'open', npc, slots, mesos, items });
      } else if (op === 0x26) this.emit('fredrick', { op: 'unavailable' });
    });
    on(S.FREDRICK_MESSAGE, (r) => this.emit('fredrick', { op: 'result', code: r.ubyte() }));
    // the guild BBS: 6 a page of the list (a notice flag and the notice, the total, then the threads), 7 a thread with its
    // replies, 8 the thread was deleted
    on(S.GUILD_BBS_PACKET, (r) => {
      const op = r.ubyte();
      const entry = () => ({ id: r.int(), writer: r.int(), title: r.string(), time: r.long(), icon: r.int(), replies: r.int() });
      if (op === 6) {
        const notice = r.ubyte() ? entry() : null, total = r.int(), threads = [];
        if (total > 0) for (let n = r.int(); n > 0; n--) threads.push(entry());
        this.emit('bbs', { op: 'list', notice, total, threads });
      } else if (op === 7) {
        const id = r.int(), writer = r.int(), time = r.long(), title = r.string(), body = r.string(), icon = r.int(), replies = [];
        for (let n = r.int(); n > 0; n--) replies.push({ id: r.int(), writer: r.int(), time: r.long(), text: r.string() });
        this.emit('bbs', { op: 'thread', thread: { id, writer, time, title, body, icon, replies } });
      } else if (op === 8) this.emit('bbs', { op: 'deleted' });
    });
    on(S.FAMILY_JOIN_REQUEST, (r) => this.emit('family', { op: 'invite', id: r.int(), name: r.string() }));
    on(S.FAMILY_JOIN_REQUEST_RESULT, (r) => this.emit('family', { op: 'joined', ok: r.bool(), name: r.string() }));
    on(S.FAMILY_JOIN_ACCEPTED, (r) => this.emit('family', { op: 'senior', name: r.string() }));
    on(S.FAMILY_REP_GAIN, (r) => this.emit('family', { op: 'rep', gain: r.int(), from: r.string() }));
    on(S.FAMILY_NOTIFY_LOGIN_OR_LOGOUT, (r) => this.emit('family', { op: 'login', online: r.bool(), name: r.string() }));
    on(S.FAMILY_SUMMON_REQUEST, (r) => this.emit('family', { op: 'summon', from: r.string(), family: r.string() }));
    // MESSENGER: 0 someone is in a spot (spot, look, name, channel), 1 your own spot, 2 a spot emptied,
    // 3 an invitation (from, messenger id), 4 your invitation went out (name, 1) or found no one (name, 0),
    // 5 it was declined (name), 6 a line of chat ("name : text"), 7 someone's look changed
    on(S.MESSENGER, (r) => {
      const op = r.ubyte();
      if (op === 0 || op === 7) {
        const pos = r.ubyte(), look = readCharLook(r), name = r.string(), channel = r.ubyte();
        this.emit('messenger', { op: op === 0 ? 'add' : 'update', pos, look, name, channel, announce: op === 0 && r.ubyte() !== 0 });
      }
      else if (op === 1) { const pos = r.ubyte(); this.emit('messenger', { op: 'join', pos: pos > 127 ? pos - 256 : pos }); }
      else if (op === 2) this.emit('messenger', { op: 'remove', pos: r.ubyte() });
      else if (op === 3) { const from = r.string(); r.ubyte(); this.emit('messenger', { op: 'invite', from, id: r.int() }); }
      else if (op === 4) { const name = r.string(); this.emit('messenger', { op: 'invited', name, ok: r.ubyte() === 1 }); }
      else if (op === 5) { const name = r.string(); this.emit('messenger', { op: 'declined', name, mode: r.ubyte() }); }
      else if (op === 6) this.emit('messenger', { op: 'chat', text: r.string() });
    });
    // ENTRUSTED_SHOP_CHECK_RESULT: 7 you may open a merchant, 9 Fredrick still holds your goods, 0x10 yours is open in another channel
    on(S.ENTRUSTED_SHOP_CHECK_RESULT, (r) => {
      const mode = r.ubyte(), e = { mode };
      if (mode === 8) { e.room = r.int(); e.channel = r.ubyte(); }
      else if (mode === 13) e.value = r.int();
      else if (mode === 14) e.ok = r.ubyte() !== 0;
      else if (mode === 16) { r.int(); e.channel = r.ubyte(); }
      else if (mode === 17) { e.a = r.int(); e.b = r.short(); e.c = r.bytes(8); }
      else if (mode === 18) { e.show = r.ubyte(); if (e.show) e.text = r.string(); }
      this.emit('merchantCheck', e);
    });
    on(S.UPDATE_CHAR_BOX, (r) => { const id = r.int(); this.emit('charBox', id, readBox(r)); });
    // ---- trading and player shops (PLAYER_INTERACTION): the room type the last ROOM opened decides
    // what the shared VISIT / EXIT / CHAT ops mean (3 trade, 4 player shop)
    on(S.PLAYER_INTERACTION, (r) => {
      const op = r.ubyte();
      if ((this.roomType === 4 || this.roomType === 5) && this.shopOp(op, r)) return;
      if ((this.roomType === 1 || this.roomType === 2) && op !== 5 && op !== 3) { this.gameOp(op, r); return; }
      if (op === 5) {                                     // ROOM
        const type = r.ubyte();
        if (type === 0) { this.emit('roomError', r.ubyte()); return; }
        this.roomType = type;
        if (type === 1 || type === 2) { this.emit('gameRoom', readGameRoom(r, type)); return; }
        if (type === 4) { this.emit('shopOpen', readShopRoom(r)); return; }
        if (type === 5) { this.emit('shopOpen', readMerchantRoom(r, this.selfName)); return; }
        if (type !== 3) return;
        r.ubyte();
        const me = r.ubyte();
        let partner = null, look = null;
        if (me === 1) { r.ubyte(); look = readCharLook(r); partner = r.string(); }
        this.emit('tradeOpen', { slot: me, partner, look });
      } else if (op === 2) {                              // INVITE
        const type = r.ubyte();   // 3 a trade, 6 a cash item trade
        if (type === 3 || type === 6) { const name = r.string(); this.emit('tradeInvite', name, r.available >= 4 ? r.int() : 0, type === 6); }
      } else if (op === 4) {                              // VISIT: partner joined
        r.ubyte(); const look = readCharLook(r); this.emit('tradePartner', r.string(), look);
      } else if (op === 0x0F) {                           // SET_ITEMS: 0 yours, 1 partner's
        const side = r.ubyte(), slot = r.ubyte();
        this.emit('tradeItem', side, slot, readItem(r, false));
      } else if (op === 0x10) this.emit('tradeMeso', r.ubyte(), r.int());
      else if (op === 0x11) this.emit('tradeConfirm');
      else if (op === 0x0A) { r.ubyte(); this.emit('tradeEnd', r.available ? r.ubyte() : 2); }
      else if (op === 6 && r.ubyte() === 8) { const slot = r.ubyte(); this.emit('tradeChat', r.string(), slot); }
    });
    // CHAR_INFO (Cosmic PacketCreator.charInfo): id, level, job, fame, married, guild, alliance, medal-info byte,
    // pets (each led by a non-zero byte, 0 ends), mount, wish list SNs, Monster Book, medal, medal quests
    on(S.CHAR_INFO, (r) => {
      const i = { id: r.int(), level: r.ubyte(), job: r.short(), fame: r.short(), married: r.bool(), guild: r.string(), alliance: r.string() };
      r.ubyte();
      i.pets = [];
      while (r.ubyte()) {
        i.pets.push({ id: r.int(), name: r.string(), level: r.ubyte(), closeness: r.short(), fullness: r.ubyte() });
        r.short();
        i.pets[i.pets.length - 1].equip = r.int();
      }
      i.mount = r.ubyte() ? { level: r.int(), exp: r.int(), tiredness: r.int() } : null;
      i.wish = Array.from({ length: r.ubyte() }, () => r.int());
      i.book = { level: r.int(), normal: r.int(), special: r.int(), total: r.int(), cover: r.int() };
      i.medal = r.int();
      i.medalQuests = Array.from({ length: r.short() }, () => r.short());
      this.emit('charInfo', i);
    });
    // Report: whether it is open (sent at login), the hours it is open (0 and 0: always), the answer to one
    on(S.CLAIM_STATUS_CHANGED, (r) => this.emit('claimStatus', r.ubyte() !== 0));
    on(S.CLAIM_AVAILABLE_TIME, (r) => { const from = r.ubyte(); this.emit('claimHours', from, r.ubyte()); });
    on(S.SUE_CHARACTER_RESULT, (r) => this.emit('sueResult', r.ubyte()));
    // CLAIM_RESULT: a code; 2 (made) also carries whether you may report again today and the reports left this week
    on(S.CLAIM_RESULT, (r) => {
      const code = r.ubyte();
      if (code !== 2) { this.emit('claimResult', code); return; }
      const again = r.ubyte() !== 0;
      this.emit('claimResult', code, again, r.int());
    });
    // MULTICHAT mode: 0 buddy, 1 party, 2 guild, 3 alliance
    on(S.MULTICHAT, (r) => this.emit('groupChat', { mode: r.ubyte(), name: r.string(), text: r.string() }));
    // WHISPER (CField::OnWhisper): flags LOCATION 1, WHISPER 2, RESULT 8, RECEIVE 0x10, LOCATION_FRIEND 0x40
    on(S.WHISPER, (r) => {
      const flag = r.ubyte();
      if (flag === 0x12) { this.emit('whisper', { from: r.string(), channel: r.ubyte(), gm: r.bool(), text: r.string() }); return; }
      if (flag === 0x0A) { this.emit('whisperResult', { to: r.string(), ok: r.bool() }); return; }
      if (flag === 0x09 || flag === 0x48) {
        const name = r.string(), type = r.ubyte(), where = r.int();
        this.emit('findResult', { name, type, where, buddy: flag === 0x48 });
      }
    });

    on(S.SPAWN_PLAYER, (r) => {
      const id = r.int(), level = r.ubyte(), name = r.string(), guild = r.string(), emblem = readEmblem(r);
      // foreign buffs: fixed layout with optional value after the first mask int
      r.int(); r.short(); r.ubyte(); r.ubyte();
      const morph = r.int();
      const hiMask = r.int();
      let combo = 0;
      let morphId = 0;
      if (morph === 2) morphId = r.short(); else if (hiMask & 0x200000) combo = r.ubyte(); // the morph / Combo Attack's value (1 + orbs)
      r.int(); r.int(); r.short(); r.skip(4); r.int(); r.skip(11); r.short(); r.skip(9); r.int(); r.short(); r.ubyte();
      const mount = r.int(); r.int();   // Monster Riding: the mount's item id (0 on foot), the skill
      r.int(); r.skip(8); r.int(); r.ubyte(); r.int(); r.short(); r.skip(9); r.int(); r.int(); r.skip(9); r.int(); r.short(); r.short();
      const job = r.short();
      const look = readCharLook(r);
      const hearts = r.int(), itemEffect = r.int(), chair = r.int();   // Heart-Shaped Chocolates: n / 10 big, n % 10 small
      const pos = r.pos2(); const stance = r.ubyte(), fh = r.short();
      r.ubyte();
      const pets = [];
      while (r.available && r.ubyte() === 1) pets.push({ slot: pets.length, ...readPet(r) });
      let box = null;
      let chalk = null, rings = null, berserk = false, mountInfo = null;
      const cards = [];
      if (r.available >= 13) {
        mountInfo = { level: r.int(), exp: r.int(), tired: r.int() };   // the mount's level / exp / tiredness
        box = readBox(r);                                           // then a shop or game sign
        if (r.available && r.ubyte() === 1) chalk = r.string();     // then a chalkboard's text
        if (r.available >= 3) rings = readRingLook(r);
        // New Year cards received, then whether Berserk is on
        try {
          if (r.available && r.ubyte()) for (let n = r.int(); n > 0; n--) cards.push(r.int());
          berserk = r.available > 0 && r.ubyte() !== 0;
        } catch { berserk = false; }
      }
      this.emit('spawnPlayer', { id, level, name, guild, emblem, job, look, morph: morphId, itemEffect, hearts, chair, mount, mountInfo, x: pos.x, y: pos.y, stance, fh, pets, box, chalk, rings, cards, combo, berserk, hidden: !!(hiMask & 0x400), partner: !!(hiMask & 0x4000000) });
    });
    on(S.REMOVE_PLAYER_FROM_MAP, (r) => this.emit('removePlayer', r.int()));
    // another player sat on a chair item (0: stood up); yours: 0 makes you stand, 1 + a seat confirms a map seat
    on(S.SHOW_CHAIR, (r) => this.emit('showChair', r.int(), r.int()));
    on(S.CANCEL_CHAIR, (r) => this.emit('cancelChair', r.ubyte() ? r.short() : -1));
    // Mystic Door: the door out in the field (owner, where; launched = it was already open), and the portal
    // record both ends get - from this map to the other, where it stands (999999999 twice: it is gone)
    on(S.SPAWN_DOOR, (r) => { const launched = r.bool(), owner = r.int(); this.emit('doorSpawn', { owner, launched, x: r.short(), y: r.short() }); });
    // a mist (Poison Mist, Smokescreen, a monster's poison cloud...): kind 0 a monster's, 1 poison, 2 smoke, 4 recovery
    on(S.SPAWN_MIST, (r) => {
      // the short is its delay: it acts from delay x 100ms after it came
      const oid = r.int(), kind = r.int(), owner = r.int(), skill = r.int(), level = r.ubyte(), delay = r.short();
      this.emit('mistSpawn', { oid, kind, owner, skill, level, delay, left: r.int(), top: r.int(), right: r.int(), bottom: r.int() });
    });
    on(S.REMOVE_MIST, (r) => this.emit('mistRemove', r.int()));
    // the field's timer: type 2 counts down from a number of seconds (a party quest, an event, a boat ride)
    // OX_QUIZ: question (1) or answer (0), the Etc/OXQuiz.img set and number (0 takes the quiz's notice down)
    on(S.OX_QUIZ, (r) => { const ask = r.ubyte(), set = r.ubyte(), id = r.ushort(); this.emit('oxQuiz', ask !== 0, set, id); });
    on(S.CLOCK, (r) => {
      const type = r.ubyte();
      if (type === 2) this.emit('clock', r.int());
      else if (type === 1) this.emit('fieldClock', r.ubyte(), r.ubyte(), r.ubyte());   // a station's time of day
    });
    // the map's ship. CONTI_STATE (state, flag): 0, 1 or 6 a ship comes in; 2 to 5 it goes, and on 3 or 4 with the
    // flag set the Balrog's ship comes. CONTI_MOVE: 8 then 2 a ship goes, 12 then 6 it comes in, 10 then 4 the
    // Balrog's ship comes and 10 then 5 it goes. Which of these a map's ship takes is up to its kind (Game.shipMove).
    on(S.CONTI_STATE, (r) => {
      const s = r.ubyte(), f = r.available ? r.ubyte() : 0;
      if (s < 2 || s === 6) this.emit('ship', 'in');
      else if (s <= 5) { if ((s === 3 || s === 4) && f === 1) this.emit('ship', 'enemyIn'); this.emit('ship', 'out'); }
    });
    on(S.CONTI_MOVE, (r) => {
      const a = r.ubyte(), b = r.available ? r.ubyte() : 0;
      if (a === 8 && b === 2) this.emit('ship', 'out');
      else if (a === 12 && b === 6) this.emit('ship', 'in');
      else if (a === 10 && b === 4) this.emit('ship', 'enemyIn');
      else if (a === 10 && b === 5) this.emit('ship', 'enemyOut');
    });
    on(S.STOP_CLOCK, () => this.emit('clock', null));
    on(S.REMOVE_DOOR, (r) => { r.ubyte(); this.emit('doorRemove', r.int()); });
    on(S.SPAWN_PORTAL, (r) => { const from = r.int(), to = r.int(); this.emit('townPortal', from, to, r.available >= 4 ? { x: r.short(), y: r.short() } : null); });
    // ---- pets: SPAWN_PET (summon / send home), MOVE_PET, PET_CHAT, PET_COMMAND (0 command answer, 1 food answer)
    on(S.SPAWN_PET, (r) => {
      const owner = r.int(), slot = r.ubyte();
      if (slot > 2) return;
      if (r.ubyte() === 1) { const replace = r.bool(); this.emit('petSpawn', { owner, slot, replace, ...readPet(r) }); }
      else this.emit('petRemove', owner, slot, r.available ? r.ubyte() : 0);
    });
    on(S.MOVE_PET, (r) => { const owner = r.int(), slot = r.ubyte(); r.int(); this.emit('petMove', owner, slot, readMovement(r)); });
    on(S.PET_CHAT, (r) => {
      const owner = r.int(), slot = r.ubyte(), type = r.ubyte(), act = r.ubyte(), text = r.string();
      this.emit('petChat', owner, slot, type, act, text, r.available ? r.bool() : false);
    });
    // 0: a command's answer (its interact index, success), 1: food's; then the Quote Ring
    on(S.PET_COMMAND, (r) => {
      const owner = r.int(), slot = r.ubyte(), type = r.ubyte(), cmd = type === 0 ? r.ubyte() : -1, ok = r.bool();
      this.emit('petCommand', owner, slot, type, cmd, ok, r.available ? r.bool() : false);
    });
    on(S.PET_NAMECHANGE, (r) => { const owner = r.int(), slot = r.ubyte(), name = r.string(); this.emit('petName', owner, slot, name, r.available ? r.bool() : false); });
    on(S.PET_EXCEPTION_LIST, (r) => {
      const owner = r.int(), slot = r.ubyte(), sn = r.long(), ids = [];
      for (let n = r.ubyte(); n > 0; n--) ids.push(r.int());
      this.emit('petExceptions', owner, slot, sn, ids);
    });
    // 0 then the pet that ate; 1 it can't eat it (-1); anything else nothing (-2)
    // BLOW_WEATHER: its kind (0 cash weather), the item (0 stops it), the message
    on(S.BLOW_WEATHER, (r) => { const type = r.ubyte(), id = r.int(); this.emit('weather', type, id, id && type === 0 && r.available ? r.string() : ''); });
    on(S.CASH_PET_FOOD_RESULT, (r) => { const res = r.ubyte(); this.emit('cashPetFood', res === 0 ? r.ubyte() : res === 1 ? -1 : -2); });
    on(S.AUTO_HP_POT, (r) => this.emit('petPotion', 'hp', r.int()));
    on(S.AUTO_MP_POT, (r) => this.emit('petPotion', 'mp', r.int()));
    on(S.MOVE_PLAYER, (r) => { const id = r.int(); r.int(); this.emit('movePlayer', id, readMovement(r)); });
    // what changed: 1 the look, 2 a byte, 4 the Heart-Shaped Chocolate count; then the rings
    on(S.UPDATE_CHAR_LOOK, (r) => {
      const id = r.int(), flags = r.ubyte(), look = flags & 1 ? readCharLook(r) : null;
      if (flags & 2) r.ubyte();
      if (flags & 4) this.emit('playerHearts', id, r.ubyte());
      if (look) this.emit('playerLook', id, look, r.available >= 3 ? readRingLook(r) : null);
    });
    // a consumable's effect on someone (Effect/ItemEff.img/<item>), kept until 0 comes
    on(S.SHOW_CONSUME_EFFECT, (r) => this.emit('consumeEffect', r.int(), r.int()));
    on(S.FACIAL_EXPRESSION, (r) => this.emit('expression', r.int(), r.int()));
    on(S.SHOW_ITEM_EFFECT, (r) => this.emit('itemEffect', r.int(), r.int()));

    // addAttackBody: shared by melee / ranged / magic broadcasts
    const readAttack = (kind) => (r) => {
      const id = r.int(), nd = r.ubyte(), level = r.ubyte();   // the attacker's level
      const skillLevel = r.ubyte(); const skill = skillLevel ? r.int() : 0;
      // the action (15 bits) with facing left in the top bit, as the attacker sent it
      const display = r.ubyte(), act = r.ushort(), speed = r.ubyte(); r.ubyte();
      const action = act & 0x7fff, facingLeft = !!(act & 0x8000);
      const projectile = r.int();
      const targets = [];
      for (let i = 0; i < (nd >> 4); i++) {
        const oid = r.int(); r.ubyte();
        // Cosmic sets a critical hit's top bit before passing it on (damage - 2^31)
        const dmg = [], crit = [], n = skill === 4211006 ? r.ubyte() : nd & 0xf;   // Meso Explosion: each its own count
        for (let j = 0; j < n; j++) { const d = r.int(); dmg.push(d < 0 ? d + 0x80000000 : d); crit.push(d < 0); }
        targets.push({ oid, dmg, crit });
      }
      this.emit('attack', { kind, id, level, skill, skillLevel, display, action, facingLeft, speed, projectile, targets });
    };
    on(S.CLOSE_RANGE_ATTACK, readAttack('melee'));
    on(S.RANGED_ATTACK, readAttack('ranged'));
    on(S.MAGIC_ATTACK, readAttack('magic'));

    on(S.KEYMAP, (r) => {
      if (r.ubyte() !== 0) return;
      const km = {};
      for (let k = 0; k < 90; k++) { const type = r.ubyte(), action = r.int(); if (type) km[k] = { type, action }; }
      this.emit('keymap', km);
    });
    // the quick slots' eight keys, or none for the defaults
    on(S.QUICKSLOT_INIT, (r) => {
      const keys = r.bool() ? Array.from({ length: 8 }, () => r.int()) : null;
      this.emit('quickslots', keys);
    });
    on(S.UPDATE_SKILLS, (r) => {
      r.ubyte();
      const list = [];
      for (let n = r.short(); n > 0; n--) list.push({ id: r.int(), level: r.int(), master: r.int(), expiration: r.long() });
      this.emit('skills', list);
      if (r.available) this.emit('moveElement', r.ubyte());
    });
    on(S.COOLDOWN, (r) => this.emit('cooldown', r.int(), r.short()));
    // GIVE_BUFF: two 64-bit masks, then (short value, int source, int duration) per set bit
    const HB_HP = 0x200000000000n, HB_MP = 0x400000000000n; // BuffStat.HYPERBODYHP / HYPERBODYMP
    const SHARP_EYES = [3121002, 3221002];
    const SPEED = 0x8000000000n, JUMP = 0x10000000000n, BOOSTER = 0x80000000000n;   // BuffStat.SPEED / JUMP / BOOSTER
    const WATK = 0x100000000n, WDEF = 0x200000000n, MATK = 0x400000000n, MDEF = 0x800000000n, HANDS = 0x4000000000n, AVOID = 0x2000000000n, ACC = 0x1000000000n, MAPLE_WARRIOR = 0x8n, COMBO = 0x20000000000000n, STANCE = 0x10n;   // BuffStat.WATK / ACC / MAPLE_WARRIOR / COMBO / STANCE
    const RIDING = 0x20000000000000n;   // BuffStat.MONSTER_RIDING, in the first mask
    const HOMING = 0x80000000000000n;   // Homing Beacon, in the first mask
    const popcount = (big) => { let n = 0; for (let v = big; v; v &= v - 1n) n++; return n; };
    on(S.GIVE_BUFF, (r) => {
      const m1 = r.long(), m2 = r.long();
      const n = popcount(BigInt.asUintN(64, m1)) + popcount(BigInt.asUintN(64, m2));
      if (!n) return;
      // after the plain stats (10 bytes each), two bytes, the two-state stats (TWO_STATE_SIZES) and a short delay; then,
      // for a buff that changes how you move, a byte for the next movement packet
      const two = BigInt.asUintN(64, m1) & TWO_STATE;
      let tail = r.pos + (n - popcount(two)) * 10 + 4;
      TWO_STATE_SIZES.forEach((size, k) => { if (two & (1n << BigInt(50 + k))) tail += size; });
      if (movesBuff(m1, m2) && r.v.byteLength > tail) this.emit('moveElement', r.v.getUint8(tail));
      // Monster Riding (first mask): short 0, then the mount's item id where the source goes and the skill (Monster
      // Rider, Battleship...) where the duration goes; it lasts until cancelled
      // A refresh of a ride already on (another buff ending) comes as a plain buff: the skill, then the time left
      // Homing Beacon / Bullseye (two-state, first long bit 55): two bytes, then its value, the skill, a time (byte +
      // int) and the monster it marks
      if (BigInt.asUintN(64, m1) & HOMING && r.available >= 19) {
        r.skip(2); r.int(); const skill = r.int(); r.skip(5);
        this.emit('homingBeacon', skill, r.int());
        return;
      }
      if (BigInt.asUintN(64, m1) & RIDING) {
        r.short(); const a = r.int(), b = r.int(), k = Math.floor(a / 10000);
        if (k === 190 || k === 193) this.emit('buff', { m1, m2, source: b, duration: 2 ** 31, mount: a });
        else this.emit('buff', { m1, m2, source: a, duration: 2 ** 31 });
        return;
      }
      const start = r.pos;
      // Energy Charge (first mask): its bar, the value (10000 and over: charged)
      if (BigInt.asUintN(64, m1) & 0x4000000000000n && r.available >= 2) { this.emit('energyCharge', r.short()); return; }
      // giveBuff: per stat (short value, int source, int duration ms)
      r.pos = start + 2;
      const normal = { source: r.int(), duration: r.int() };
      // a monster's curse (giveDebuff): the source is its mob skill (low 16 bits 100-200) and level (high 16 bits)
      const mobSkill = normal.source & 0xffff, mobLevel = normal.source >>> 16;
      if (normal.source > 0 && mobSkill >= 100 && mobSkill <= 200 && mobLevel > 0 && mobLevel < 256) {
        r.pos = start;
        this.emit('disease', { m1, m2, skill: mobSkill, level: mobLevel, value: r.short(), duration: normal.duration });
        return;
      }
      // givePirateBuff (Dash, Speed Infusion): short 0, then (int value, int source, 5|10 skip, short seconds)
      r.pos = start + 6;
      const pSource = r.int();
      const infusion = [5121009, 15111005, 5221010].includes(pSource);
      r.pos = start + 10 + (infusion ? 10 : 5);
      const pirate = { source: pSource, duration: r.short() * 1000 };
      // Speed Infusion's value is negative, so it can't be told from an item's source: go by the skill instead
      const known = (id) => id < 0 || this.h.knowsSkill?.(id);
      const pick = infusion || [5001005, 15001003].includes(pSource) || (!known(normal.source) && known(pirate.source)) ? pirate : normal;
      // Hyper Body: HYPERBODYHP then HYPERBODYMP (second mask), each a percentage, in that order
      const b = { m1, m2, source: pick.source, duration: pick.duration };
      const hbHp = BigInt.asUintN(64, m2) & HB_HP, hbMp = BigInt.asUintN(64, m2) & HB_MP;
      if (pick === normal && (hbHp || hbMp)) {
        r.pos = start;
        const values = Array.from({ length: n }, () => { const v = r.short(); r.int(); r.int(); return v; });
        if (hbHp) b.hbHp = values[0];
        if (hbMp) b.hbMp = values[hbHp ? 1 : 0];
      }
      // Speed / Jump (Haste, Nimble Feet, speed potions...), weapon attack and accuracy: the values come in mask-bit
      // order, so each one's place is the number of set bits below it (all live in the second mask)
      const mask = BigInt.asUintN(64, m2);
      if (pick === normal && (mask & (SPEED | JUMP | WATK | ACC | WDEF | MATK | MDEF | AVOID | HANDS | BOOSTER))) {
        r.pos = start;
        const values = Array.from({ length: n }, () => { const v = r.short(); r.int(); r.int(); return v; });
        const at = (bit) => popcount(mask & (bit - 1n));   // Cosmic lists the plain stats (WATK..JUMP) first
        if (mask & SPEED) b.speed = values[at(SPEED)];
        if (mask & JUMP) b.jump = values[at(JUMP)];
        if (mask & WATK) b.watk = values[at(WATK)];
        if (mask & ACC) b.acc = values[at(ACC)];
        if (mask & WDEF) b.wdef = values[at(WDEF)];
        if (mask & MATK) b.matk = values[at(MATK)];
        if (mask & MDEF) b.mdef = values[at(MDEF)];
        if (mask & HANDS) b.hands = values[at(HANDS)];
        if (mask & AVOID) b.avoid = values[at(AVOID)];
        if (mask & BOOSTER) b.booster = values[at(BOOSTER)];   // -1 to -4: that much faster
      }
      // Speed Infusion: its value comes first, as an int
      if (pick === pirate && infusion) { r.pos = start + 2; b.infusion = r.int(); }
      // Dash: its two-state values are the speed and jump it gives (the Stat window counts them)
      if (two & (3n << 51n)) {
        r.pos = start + (n - popcount(two)) * 10 + 2;
        TWO_STATE_NAMES.forEach((name, k) => {
          if (!(two & (1n << BigInt(50 + k))) || r.available < TWO_STATE_SIZES[k]) return;
          const at = r.pos, value = r.int();
          if (name === 'dashSpeed' || name === 'dashJump') b[name] = value;
          r.pos = at + TWO_STATE_SIZES[k];
        });
      }
      // Maple Warrior: its one stat is the % added to STR, DEX, INT and LUK
      if (pick === normal && n === 1 && mask === MAPLE_WARRIOR) { r.pos = start; b.mapleWarrior = r.short(); }
      // a morph (second mask 0x2): the last stat (the one before last with GHOST_MORPH 0x20000), and its source
      if (pick === normal && mask & 0x2n) {
        r.pos = start;
        const groups = Array.from({ length: n }, () => ({ v: r.short(), src: r.int(), t: r.int() })), g = groups[n - 1 - (mask & 0x20000n ? 1 : 0)];
        if (g) { b.morph = g.v; b.morphSource = g.src; }
      }
      // Combo Attack: its one stat is 1 + the orbs you hold, sent again each time one is gained or spent
      if (pick === normal && n === 1 && mask === COMBO) { r.pos = start; b.combo = r.short(); }
      // a morph: its value is the morph's id (values run in stat order: the second mask's high half first)
      if (pick === normal && mask & 0x2n) {
        r.pos = start;
        const values = Array.from({ length: n }, () => { const v = r.short(); r.int(); r.int(); return v; });
        b.morph = values[popcount(mask >> 32n) + popcount(mask & 0x1n)];
      }
      // Shadow Stars: its one stat picks the star it throws (the item 2069999 above it)
      if (pick === normal && n === 1 && mask === 0x100n) { r.pos = start; b.shadowStars = r.short(); }
      // Power Stance / Freeze Standing: its one stat is the % chance not to be knocked back
      if (pick === normal && n === 1 && mask === STANCE) { r.pos = start; b.stance = r.short(); }
      // Sharp Eyes' one stat is (critical rate << 8 | critical damage)
      if (pick === normal && SHARP_EYES.includes(normal.source)) { r.pos = start; const v = r.short(); b.sharpEyes = { rate: v >> 8, dmg: v & 0xff }; }
      this.emit('buff', b);
    });
    on(S.CANCEL_BUFF, (r) => {
      const m1 = r.long(), m2 = r.long();
      if (BigInt.asUintN(64, m1) & 0x80000000000000n) this.emit('homingBeacon', 0, 0);
      this.emit('cancelBuff', m1, m2);
      if (movesBuff(m1, m2) && r.available) this.emit('moveElement', r.ubyte());
    });
    // monster book: a card gained (not full, card id, its count now) and the cover set
    on(S.MONSTER_BOOK_SET_CARD, (r) => { const fresh = r.bool(); this.emit('bookCard', r.int(), r.int(), fresh); });
    on(S.MONSTER_BOOK_SET_COVER, (r) => this.emit('bookCover', r.int()));
    // MACRO_SYS_DATA_INIT: the saved skill macros, in order: name, shout, three skill ids
    on(S.MACRO_SYS_DATA_INIT, (r) => this.emit('macros', Array.from({ length: r.ubyte() }, () => ({ name: r.string(), shout: r.bool(), skills: [r.int(), r.int(), r.int()] }))));
    // ---- summons (Cosmic PacketCreator.spawnSummon / removeSummon / moveSummon / summonAttack / damageSummon / summonSkill)
    on(S.SPAWN_SPECIAL_MAPOBJECT, (r) => {
      const d = { owner: r.int(), oid: r.int(), skill: r.int() };
      r.ubyte(); d.level = r.ubyte();
      const at = r.pos2(); d.x = at.x; d.y = at.y;
      d.stance = r.ubyte(); r.short(); d.moveType = r.ubyte(); d.canAttack = r.bool(); d.animated = !r.bool();
      this.emit('summonSpawn', d);
    });
    on(S.REMOVE_SPECIAL_MAPOBJECT, (r) => this.emit('summonRemove', r.int(), r.int(), r.ubyte() === 4));
    on(S.MOVE_SUMMON, (r) => { const owner = r.int(), oid = r.int(); r.pos2(); this.emit('summonMove', owner, oid, readMovement(r)); });
    // an Evan's dragon: its owner, x and y as ints, its move action and an unused short; then its moves
    on(S.SPAWN_DRAGON, (r) => { const owner = r.int(), x = r.int(), y = r.int(), stance = r.available ? r.ubyte() : 0; this.emit('spawnDragon', { owner, x, y, stance }); });
    on(S.MOVE_DRAGON, (r) => { const owner = r.int(), start = r.pos2(); this.emit('moveDragon', owner, start, readMovement(r)); });
    on(S.SUMMON_ATTACK, (r) => {
      const owner = r.int(), oid = r.int(); r.ubyte();
      const dir = r.ubyte(), n = r.ubyte();
      const hits = Array.from({ length: n }, () => { const mob = r.int(); r.ubyte(); return { mob, dmg: r.int() }; });
      this.emit('summonAttack', owner, oid, dir, hits);
    });
    // a summon struck: its owner, oid, the attack index (-2 and down: no monster), the damage, then the monster and
    // which way it was hit
    on(S.DAMAGE_SUMMON, (r) => {
      const owner = r.int(), oid = r.int(), attack = r.byte(), damage = r.int();
      const mobId = attack > -2 && r.available >= 4 ? r.int() : 0, dir = mobId && r.available ? r.ubyte() : 0;
      this.emit('summonDamaged', owner, oid, damage, attack, mobId, dir);
    });
    on(S.SUMMON_SKILL, (r) => this.emit('summonSkill', r.int(), r.int(), r.ubyte()));
    // SHOW_SCROLL_EFFECT: who, success, cursed (the item was destroyed), Legendary Spirit, White Scroll
    on(S.SHOW_SCROLL_EFFECT, (r) => this.emit('scrollEffect', { id: r.int(), success: r.bool(), cursed: r.bool(), legendary: r.bool(), white: r.bool() }));
    on(S.SHOW_FOREIGN_EFFECT, (r) => {
      const id = r.int(), effect = r.ubyte();
      if (effect === 1 && r.available >= 4) {
        const skill = r.int();
        // Berserk: level, then whether it is on (its aura stays while it is)
        if (skill === 1320006 && r.available >= 3) { r.ubyte(); r.ubyte(); this.emit('berserk', id, r.ubyte() !== 0); return; }
        const level = r.available >= 1 ? r.ubyte() : 0;   // then the user's level and the skill's
        this.emit('foreignSkill', id, skill, level, r.available >= 1 ? r.ubyte() : 0);
      }
      else if (effect === 2 && r.available >= 4) this.emit('affected', id, r.int());   // a party buff landed on them
      else if (effect === 5 && r.available >= 4) this.emit('skillSpecial', id, r.int());   // a skill's special art (Dragon Blood's drain)
      else if (effect === 0x0a && r.available >= 1) this.emit('healNumber', id, r.ubyte());   // HP they recovered (blue number)
      else if (effect === 4 && r.available >= 2) { const e = r.ubyte(); this.emit('petEffect', id, r.ubyte(), e); }   // a pet's level up / evolution
      else if ([0, 8, 9, 0x0d, 0x0f].includes(effect)) this.emit('foreignEffect', id, effect); // level up / job change / quest clear / card / item level up
      else if (effect === 0x10 && r.available >= 4) this.emit('makerResult', id, r.int());   // the Maker: 0 made, 1 failed
      else if (effect === 0x17 && r.available >= 2) this.emit('avatarPicture', r.string(), id);   // a picture on them (fishing)
    });
    // charging / winding up a skill: who, the skill, its level, the action (0x7fff: none) with facing left in the top
    // bit, and the attack speed
    on(S.SKILL_EFFECT, (r) => {
      const id = r.int(), skill = r.int(); r.ubyte();
      const raw = r.available >= 2 ? r.ushort() : 0x7fff, speed = r.available ? r.ubyte() : 6;
      this.emit('foreignCharge', id, skill, { action: raw & 0x7fff, left: !!(raw >> 15), speed });
    });
    // your own effects; 2 = a party member's buff (Bless, Haste, Holy Symbol...) reached you
    // and 0x0a = HP you recovered (a blue number over you)
    // PLAYER_HINT: text, width, seconds, then 1 (over your head) or 0 with a map point
    on(S.PLAYER_HINT, (r) => {
      const text = r.string(), width = r.ushort(), seconds = r.ushort(), onAvatar = r.ubyte() !== 0;
      const at = !onAvatar && r.available >= 8 ? { x: r.int(), y: r.int() } : null;
      this.emit('hint', text, width, seconds, at);
    });
    on(S.SHOW_ITEM_GAIN_INCHAT, (r) => {
      const type = r.ubyte();
      if (type === 2 && r.available >= 4) this.emit('affected', null, r.int());
      else if (type === 5 && r.available >= 4) this.emit('skillSpecial', null, r.int());
      else if (type === 1 && r.available >= 6) {
        // a skill of yours went off (MP Eater, a dying monster's buff): its pose; Berserk: whether its aura is on
        const skill = r.int(); r.ubyte(); const level = r.ubyte();
        if (skill === 1320006) { if (r.available) this.emit('berserk', null, r.ubyte() !== 0); } else this.emit('skillPose', null, skill, level);
      }
      else if (type === 0x0a && r.available >= 1) this.emit('healNumber', null, r.ubyte());
      else if (type === 4 && r.available >= 2) { const e = r.ubyte(); this.emit('petEffect', null, r.ubyte(), e); }
      else if (type === 9) this.emit('questClearEffect');
      else if (type === 7) this.emit('portalSound');
      else if (type === 0x0f) this.emit('foreignEffect', null, 0x0f);   // an item of yours levelled up
      else if (type === 0x0d) this.emit('foreignEffect', null, 0x0d);   // you got a monster card
      else if (type === 0x10 && r.available >= 4) this.emit('makerResult', null, r.int());
      else if (type === 0x15 && r.available >= 1) this.emit('wheelsLeft', r.ubyte());   // a Wheel of Destiny revived you
      // 0x17: a picture on your character, e.g. a tutorial hint (UI/tutorial.img/<n>)
      else if (type === 0x17 && r.available >= 2) this.emit('avatarPicture', r.string());
      // 0x12: a scene (Effect/Direction*.img/...) played over the screen
      else if (type === 0x12 && r.available >= 2) this.emit('direction', r.string());
      // 3: a quest's effect (0 items: message + Effect/Quest.img id) or the items it gave / took
      else if (type === 3 && r.available >= 1) {
        const n = r.ubyte();
        if (n === 0) { const msg = r.string(); this.emit('questEffect', msg, r.available >= 4 ? r.int() : 0); }
        else this.emit('questItems', Array.from({ length: n }, () => ({ id: r.int(), qty: r.int() })));
      }
    });
    // another player's buffs and curses, read as the client reads them (readRemoteStats)
    on(S.GIVE_FOREIGN_BUFF, (r) => {
      const id = r.int(), m1 = r.long(), m2 = r.long(), st = readRemoteStats(r, m1, m2);
      if (st.ride) { this.emit('foreignMount', id, st.ride.value); return; }
      if (st.morph !== undefined) { this.emit('foreignMorph', id, st.morph); return; }
      // Dark Sight (or Wind Walk, when its bit comes in the first long): drawn see-through
      if (st.darkSight || BigInt.asUintN(64, m1) & 0x400000000n) this.emit('foreignHidden', id);
      if (st.shadowPartner) this.emit('foreignPartner', id);
      if (st.combo !== undefined) this.emit('foreignCombo', id, st.combo);
      for (const d of st.diseases) this.emit('foreignDisease', id, d);
      this.emit('foreignBuffs', id, st);
    });
    // a mount's level, exp and tiredness (its rider, then a byte: it just levelled up)
    on(S.SET_TAMING_MOB_INFO, (r) => this.emit('mountInfo', r.int(), r.int(), r.int(), r.int(), r.ubyte() === 1));
    on(S.CANCEL_FOREIGN_BUFF, (r) => { const id = r.int(); this.emit('foreignCancel', id, r.long(), r.long()); });
    on(S.CANCEL_SKILL_EFFECT, (r) => this.emit('foreignSkillCancel', r.int(), r.available >= 4 ? r.int() : 0));
    // another player's Grenade thrown: who, from where, how long it was held (ms), the skill and its level
    on(S.THROW_GRENADE, (r) => this.emit('foreignGrenade', r.int(), { x: r.int(), y: r.int() }, r.int(), r.int(), r.int()));
    on(S.DAMAGE_PLAYER, (r) => {
      const id = r.int(), from = r.byte();
      if (from === -3) r.int();
      const damage = r.int();
      let mobId = 0, direction = 0;
      let fake = 0;
      if (from !== -4) { mobId = r.int(); direction = r.ubyte(); }
      if (damage === -1 && r.available >= 4) { r.skip(r.available - 4); fake = r.int(); }   // Shadow Shifter's id, last
      this.emit('playerDamaged', { id, from, damage, mobId, direction, fake });
    });

    const readMob = (r, controlMode) => {
      const oid = r.int(); r.ubyte(); const id = r.int();
      const statuses = readMobStats(r, readMobMask(r));
      const pos = r.pos2(); const stance = r.ubyte(); r.short(); const fh = r.short();
      // how it appears: -1 already here, -2 a new spawn, -3 (with its parent's oid) once its parent has died, 0 and up
      // with Effect/Summon.img/<n> (and an option, ms added to the effect's delay); then its Monster Carnival team
      const appear = r.available ? r.byte() : -1, option = appear === -3 || appear >= 0 ? (r.available >= 4 ? r.int() : 0) : 0;
      const team = r.available ? r.ubyte() : 0;
      return { oid, id, x: pos.x, y: pos.y, stance, fh, newSpawn: appear === -2, appear, option, team, statuses };
    };
    on(S.SPAWN_MONSTER, (r) => this.emit('spawnMob', readMob(r)));
    on(S.SPAWN_MONSTER_CONTROL, (r) => {
      const mode = r.ubyte();
      if (mode === 0) { this.emit('stopControl', r.int()); return; }
      this.emit('controlMob', readMob(r, mode), mode === 2);
    });
    on(S.MOVE_MONSTER, (r) => {
      // oid, 0, skill possible, activity, skill id, skill level, option (short), start position, the moves
      const oid = r.int(); r.ubyte(); r.bool(); const act = r.byte(), skill = r.ubyte(), level = r.ubyte(); r.short();
      const start = r.pos2();
      this.emit('moveMob', oid, start, readMovement(r), act, skill, level);
    });
    on(S.KILL_MONSTER, (r) => this.emit('killMob', r.int(), r.ubyte()));
    on(S.CATCH_MONSTER_WITH_ITEM, (r) => { const oid = r.int(); this.emit('catchMob', r.int(), r.ubyte() !== 0, oid); });   // mob, item, caught
    // another player's Monster Magnet pulled (or failed to pull) a monster: mob, success
    on(S.CATCH_MONSTER, (r) => { const oid = r.int(); this.emit('magnetCatch', oid, r.ubyte() !== 0); });
    // a catch item that didn't work: 0 the monster is too strong, 1 used again too soon; then the item
    // a notice the server sends before it cuts you off (an autoban, a GM's ban): its text in a dialog, unless empty
    on(S.DATA_CRC_CHECK_FAILED, (r) => { const text = r.string(); if (text) this.emit('police', text); });
    // guild alliances: 3 an invitation (the alliance's id, who sent it, their guild's name); the rest keep the
    // alliance and its other guilds' records (0x0C the alliance, 0x0D guilds, 0x0F both, 0x10 a guild gone, 0x12 one
    // joined, 0x17 the alliance again, 0x1E one guild again) or change one thing in them
    on(S.ALLIANCE_OPERATION, (r) => {
      const op = r.ubyte(), e = (kind, d = {}) => this.emit('alliance', { kind, ...d });
      if (op === 0x03) {
        const id = r.int(), from = r.string(), guildName = r.available >= 2 ? r.string() : '';
        this.emit('allianceInvite', id, from, guildName);
      } else if (op === 0x0C) e('info', { alliance: r.ubyte() ? readAlliance(r) : null });
      else if (op === 0x0D) { const guilds = []; for (let n = r.int(); n > 0; n--) guilds.push(readGuild(r)); e('guilds', { guilds }); }
      else if (op === 0x0E) e('online', { aid: r.int(), gid: r.int(), id: r.int(), online: r.ubyte() !== 0 });
      else if (op === 0x0F) { const alliance = readAlliance(r); e('full', { alliance, guilds: alliance.guildIds.map(() => readGuild(r)) }); }
      else if (op === 0x10) { const alliance = readAlliance(r), gid = r.int(), guild = readGuild(r); e('removed', { alliance, gid, guild, expelled: r.ubyte() !== 0 }); }
      else if (op === 0x12) { const alliance = readAlliance(r), gid = r.int(); e('added', { alliance, gid, guild: readGuild(r) }); }
      else if (op === 0x17) e('update', { alliance: readAlliance(r) });
      else if (op === 0x18) e('levelJob', { aid: r.int(), gid: r.int(), id: r.int(), level: r.int(), job: r.int() });
      else if (op === 0x19) e('leader', { aid: r.int(), from: r.int(), to: r.int() });
      else if (op === 0x1A) { const aid = r.int(); e('titles', { aid, ranks: [r.string(), r.string(), r.string(), r.string(), r.string()] }); }
      else if (op === 0x1B) e('rank', { id: r.int(), rank: r.ubyte() });
      else if (op === 0x1C) e('notice', { aid: r.int(), notice: r.string() });
      else if (op === 0x1D) e('disband', { aid: r.int() });
      else if (op === 0x1E) { const aid = r.int(), gid = r.int(); e('guild', { aid, gid, guild: readGuild(r) }); }
    });
    on(S.BRIDLE_MOB_CATCH_FAIL, (r) => { const type = r.ubyte(); this.emit('catchFail', type, r.int()); });
    on(S.SHOW_MONSTER_HP, (r) => this.emit('mobHp', r.int(), r.ubyte()));
    // damage (negative: healed), then - for one other monsters can hurt - its HP and max HP
    on(S.DAMAGE_MONSTER, (r) => {
      const oid = r.int(); r.ubyte(); const dmg = r.int();
      this.emit('mobDamaged', oid, dmg, r.available >= 8 ? r.int() : null, r.available >= 4 ? r.int() : null);
    });
    // the controller's answer: the monster's MP and the skill it may cast next (0 for none)
    on(S.APPLY_MONSTER_STATUS, (r) => {
      const oid = r.int();
      for (const s of readMobStats(r, readMobMask(r))) this.emit('mobStatus', oid, s);
    });
    on(S.CANCEL_MONSTER_STATUS, (r) => { const oid = r.int(); r.long(); this.emit('mobStatusCancel', oid, r.uint(), r.uint()); });
    // the answer to one of its moves: the move id, whether it is after you, its MP and a skill it may use next; an
    // answer to an older move than the last one sent doesn't change whether it is after you
    on(S.MOVE_MONSTER_RESPONSE, (r) => {
      const oid = r.int(), moveId = r.short(), aggro = r.bool(), mp = r.ushort(), skill = r.ubyte(), level = r.ubyte();
      const last = this.mobMoveIds?.get(oid), stale = last !== undefined && ((moveId - last) << 16 >> 16) < 0;
      this.emit('mobMoveResponse', oid, { aggro, mp, stale });
      this.emit('mobSkillOffer', oid, skill, level);
    });
    // the Snowball event's wall: thrown back left (and up)
    on(S.LEFT_KNOCK_BACK, () => this.emit('leftKnockBack'));
    on(S.RESET_MONSTER_ANIMATION, (r) => { const oid = r.int(); if (r.ubyte()) this.emit('mobResetAnim', oid); });
    // a Monster Carnival starts: your team (the CP counts after it aren't shown yet)
    on(S.MONSTER_CARNIVAL_START, (r) => this.emit('carnivalTeam', r.ubyte()));

    // a move or a door turned down (BLOCKED_MAP), or a channel / shop the server won't let you into (BLOCKED_SERVER):
    // both answer the request, and say why
    on(S.BLOCKED_MAP, (r) => { this.emit('exclusiveAnswered'); this.emit('blocked', 'map', r.ubyte()); });
    on(S.BLOCKED_SERVER, (r) => { this.emit('exclusiveAnswered'); this.emit('blocked', 'server', r.ubyte()); });
    // NPCs drawn as a character (ranking statues): per NPC id, the name and look they take
    on(S.IMITATED_NPC_DATA, (r) => {
      const list = [];
      for (let n = r.ubyte(); n > 0; n--) list.push({ id: r.int(), name: r.string(), look: readCharLook(r) });
      this.emit('imitatedNpcs', list);
    });

    // Cosmic sends f != 1 in the direction byte; the client mirrors the art only when it is 0
    const readNpc = (r) => ({ oid: r.int(), id: r.int(), x: r.short(), y: r.short(), facingRight: !r.bool(), fh: r.short(), rx0: r.short(), rx1: r.short() });
    on(S.SPAWN_NPC, (r) => this.emit('spawnNpc', readNpc(r)));
    on(S.SPAWN_NPC_REQUEST_CONTROLLER, (r) => {
      if (r.ubyte() === 0) { this.emit('removeNpc', r.int()); return; }
      this.emit('spawnNpc', readNpc(r), true);   // one we control: it asks the server before it acts
    });
    on(S.REMOVE_NPC, (r) => this.emit('removeNpc', r.int()));
    // the map dresses you in its own clothes (what in, the map's type decides)
    on(S.FORCED_MAP_EQUIP, () => this.emit('forcedMapEquip'));
    // stats the map holds you to (0 = your own); a reset puts yours back
    on(S.FORCED_STAT_SET, (r) => {
      const mask = r.uint(), f = {};
      FORCED_STATS.forEach((k, i) => { if (mask & (1 << i)) f[k] = i < 10 ? r.ushort() : r.ubyte(); });
      this.emit('forcedStats', f);
    });
    on(S.FORCED_STAT_RESET, () => this.emit('forcedStats', null));
    // what an NPC we control does, as the server sends it back: an action (from 2) or -1, and a line (-1: none)
    on(S.NPC_ACTION, (r) => { const oid = r.int(); this.emit('npcAction', oid, r.byte(), r.byte()); });

    on(S.DROP_ITEM_FROM_MAPOBJECT, (r) => {
      const mode = r.ubyte(), oid = r.int(), meso = r.bool(), id = r.int(), owner = r.int(), type = r.ubyte();
      const to = r.pos2(); const dropper = r.int();
      const d = { mode, oid, meso, id, owner, type, x: to.x, y: to.y, dropper };
      if (mode !== 2) { const from = r.pos2(); d.fromX = from.x; d.fromY = from.y; d.delay = r.short(); }
      if (!meso && r.available >= 8) r.long();
      d.petOk = r.available ? r.bool() : true;   // a pet may pick it up (not a player's drop)
      this.emit('drop', d);
    });
    // reactors: spawn (oid, id, state, position, facing), hit (oid, new state, position, stance), destroy (oid, state)
    on(S.REACTOR_SPAWN, (r) => { const oid = r.int(), id = r.int(), state = r.byte(), pos = r.pos2(); this.emit('reactorSpawn', { oid, id, state, x: pos.x, y: pos.y }); });
    // a hit: its new state, where it is, ms before the hit shows, the hit's index, then tenths of a second it can't be hit
    on(S.REACTOR_HIT, (r) => {
      const oid = r.int(), state = r.byte(), pos = r.pos2();
      const delay = r.available >= 2 ? r.ushort() : 0, index = r.available ? r.byte() : 0, block = r.available ? r.byte() : 0;
      this.emit('reactorHit', { oid, state, x: pos.x, y: pos.y, delay, index, block });
    });
    on(S.REACTOR_DESTROY, (r) => { const oid = r.int(), state = r.byte(); this.emit('reactorDestroy', { oid, state }); });
    on(S.REMOVE_ITEM_FROM_MAP, (r) => {
      const anim = r.ubyte(), oid = r.int();
      if (anim === 4) { this.emit('removeDrop', oid, 4, 0, -1, r.short()); return; }   // 4: blown up by Meso Explosion, after a delay
      const chr = anim >= 2 ? r.int() : 0;
      this.emit('removeDrop', oid, anim, chr, anim === 5 && r.available ? r.ubyte() : -1);   // 5: a pet picked it up
    });

    on(S.INVENTORY_OPERATION, (r) => {
      const tick = r.bool(); const n = r.ubyte(); const ops = [];
      if (tick) this.emit('exclusiveAnswered');
      let equipMoved = false;
      for (let i = 0; i < n; i++) {
        const mode = r.ubyte(), inv = r.ubyte(), pos = r.short();
        const op = { mode, inv, pos };
        if (mode === 0) op.item = readItem(r, false);
        else if (mode === 1) op.quantity = r.short();
        else if (mode === 2) op.to = r.short();
        else if (mode === 4) op.exp = r.int();
        if (inv === 1 && ((mode === 2 && (pos < 0 || op.to < 0)) || (mode === 3 && pos < 0))) equipMoved = true;
        ops.push(op);
      }
      this.emit('inventory', ops, tick);
      // something worn changed: a byte for the next movement packet
      if (equipMoved && r.available) this.emit('moveElement', r.ubyte());
    });

    on(S.NPC_TALK, (r) => {
      r.ubyte();
      // speaker: bit 1 no END CHAT, bit 2 you are speaking, bit 4 (say) another NPC speaks - its id comes first
      let npc = r.int();
      const type = r.ubyte(), speaker = r.ubyte();
      if (type === 0 && speaker & 4) npc = r.int();
      // a slide menu (0x0E) names its art set (UIWindow.img/SlideMenu/<n>) before the text
      const slide = type === 0x0E ? r.int() : null;
      const d = { npc, type, speaker, text: r.string() };
      if (slide !== null) d.slide = slide;
      if (type === 0) { d.prev = r.ubyte() === 1; d.next = r.ubyte() === 1; }
      else if (type === 2) { d.def = r.string(); d.min = r.available >= 2 ? r.short() : 0; d.max = r.available >= 2 ? r.short() : 0; }
      else if (type === 3) { d.def = r.int(); d.min = r.int(); d.max = r.int(); }
      else if (type === 7 || type === 8) { d.styles = []; for (let k = r.ubyte(); k > 0; k--) d.styles.push(r.int()); d.type = 7; d.wire = type; }
      this.emit('npcTalk', d);
    });

    // OPEN_NPC_SHOP: prices (mesos, Perfect Pitch), period, level limit, then a star's unit price or the bundle size, and the buy limit
    on(S.OPEN_NPC_SHOP, (r) => {
      const npc = r.int(); const items = [];
      for (let n = r.short(); n > 0; n--) {
        const it = { id: r.int(), price: r.int(), token: r.int(), period: r.int(), levelLimit: r.int() };
        it.recharge = isRechargeable(it.id);
        if (it.recharge) { it.unitPrice = r.v.getFloat64(r.pos, true); r.skip(8); it.quantity = 0; }
        else it.quantity = r.short();
        it.max = r.short();
        items.push(it);
      }
      this.emit('shop', { npc, items });
    });
    // CONFIRM_SHOP_TRANSACTION: 0x0E / 0x0F carry a level, 0x11 maybe a message
    on(S.CONFIRM_SHOP_TRANSACTION, (r) => {
      const code = r.ubyte();
      const extra = code === 0x0E || code === 0x0F ? r.int() : code === 0x11 && r.available && r.ubyte() ? r.string() : null;
      this.emit('shopResult', code, extra);
    });
    // STORAGE: 0x16 open, 0x0D stored / 0x09 taken out (that type's items), 0x0F arranged, 0x13 mesos, else an error
    on(S.STORAGE, (r) => {
      const op = r.ubyte(), items = () => { const out = []; for (let n = r.ubyte(); n > 0; n--) out.push(readItem(r, false)); return out; };
      if (op === 0x16) {
        const npc = r.int(), slots = r.ubyte(); r.short(); r.short(); r.int();
        const meso = r.int(); r.short();
        this.emit('storageOpen', { npc, slots, meso, items: items() });
      } else if (op === 0x0D || op === 0x09) {
        r.ubyte(); const bits = r.short(); r.short(); r.int();
        this.emit('storageItems', Math.log2(bits) - 1, items());
      } else if (op === 0x0F) { r.ubyte(); r.ubyte(); r.skip(10); this.emit('storageAll', items()); }
      else if (op === 0x13) { r.ubyte(); r.short(); r.short(); r.int(); this.emit('storageMeso', r.int()); }
      else this.emit('storageError', op);
    });

    // 6 start timers (qid, ms each), 7 remove them, 8 success (npc, next quest), 0x10 reset one; the rest are errors
    on(S.UPDATE_QUEST_INFO, (r) => {
      const mode = r.ubyte();
      if (mode === 8) { const id = r.ushort(), npc = r.int(); this.emit('questResult', { ok: true, id, npc, next: r.available >= 2 ? r.ushort() : 0 }); }
      else if (mode === 6) for (let n = r.ushort(); n > 0; n--) { const id = r.ushort(); this.emit('questTimer', id, r.int()); }
      else if (mode === 7) for (let n = r.ushort(); n > 0; n--) this.emit('questTimer', r.ushort(), 0);
      else this.emit('questResult', { ok: false, mode, id: r.available >= 2 ? r.ushort() : 0 });
    });
    on(S.QUEST_CLEAR, (r) => this.emit('questClear', r.ushort()));
    on(S.SCRIPT_PROGRESS_MESSAGE, (r) => this.emit('scriptProgress', r.string()));
    // NPCs whose talk runs a server script (shown under ETC in their quest menu): id, name, start, end
    on(S.SET_NPC_SCRIPTABLE, (r) => {
      const list = [];
      for (let n = r.ubyte(); n > 0; n--) { const id = r.int(), name = r.string(); list.push({ id, name, start: r.int(), end: r.int() }); }
      this.emit('npcScripts', list);
    });

    on(S.FIELD_EFFECT, (r) => {
      const t = r.ubyte();
      // 5: boss HP gauge (oid, hp, maxHp, tag colour, tag background colour)
      if (t === 5) { this.emit('bossHp', { oid: r.int(), hp: r.int(), maxHp: r.int(), tag: r.ubyte(), bg: r.ubyte() }); return; }
      // 2: a named map object plays its current state again (state -1)
      if (t === 2) { this.emit('objectStates', [{ name: r.string(), state: -1 }]); return; }
      this.emit('fieldEffect', t, r.available ? r.string() : '');
    });
    // map objects by tag: a count, then each tag and 1 to show / 0 to hide
    on(S.SET_MAP_OBJECT_VISIBLE, (r) => {
      const list = [];
      for (let n = r.ubyte(); n > 0 && r.available >= 3; n--) list.push({ tag: r.string(), on: r.ubyte() !== 0 });
      this.emit('mapObjectVisible', list);
    });
    // a background (back/<n>) fades in (mode 0) or out (mode 1) over ms; or every background back as the map made it
    on(S.SET_BACK_EFFECT, (r) => { const mode = r.ubyte(); r.int(); const back = r.ubyte(); this.emit('backEffect', { mode, back, ms: r.int() }); });
    on(S.CLEAR_BACK_EFFECT, () => this.emit('backEffectClear'));
    // your spouse changed maps: the map, then their id
    on(S.NOTIFY_MARRIED_PARTNER_MAP_TRANSFER, (r) => { const map = r.int(); this.emit('spouseMap', map, r.int()); });
    // the beginner guide: on (1) or gone (0); what it says (text, wrap width, ms) or shows (UI/tutorial.img/<n>, ms)
    on(S.SPAWN_GUIDE, (r) => this.emit('guide', r.ubyte() !== 0));
    on(S.TALK_GUIDE, (r) => {
      if (r.ubyte() === 0) { const text = r.string(), w = r.int(); this.emit('guideSay', text, w, r.int()); }
      else { const n = r.int(); this.emit('guideShow', n, r.int()); }
    });
    // a script opens one of your windows, by its UI id
    on(S.OPEN_UI, (r) => this.emit('openUI', r.ubyte()));
    // a named map object (a trap) switched to one of its states; or a list of them; or all back to their first
    on(S.FIELD_OBSTACLE_ONOFF, (r) => { const name = r.string(); this.emit('objectStates', [{ name, state: r.int() }]); });
    on(S.FIELD_OBSTACLE_ONOFF_LIST, (r) => {
      const list = [];
      for (let n = r.int(); n > 0 && r.available >= 6; n--) { const name = r.string(); list.push({ name, state: r.int() }); }
      this.emit('objectStates', list);
    });
    on(S.FIELD_OBSTACLE_ALL_RESET, () => this.emit('objectStatesReset'));
    // an Aran's combo count
    on(S.SHOW_COMBO, (r) => this.emit('aranCombo', r.int()));
    // a value the map keeps for you, by name: Mu Lung Dojo energy, the Pyramid's counts
    on(S.SESSION_VALUE, (r) => this.emit('sessionValue', r.string(), r.string()));
    // the Pyramid: what you have earned back against its gauge; the result (rank 0 S .. 4 D, EXP gained)
    on(S.PYRAMID_GAUGE, (r) => this.emit('pyramidGauge', r.int()));
    on(S.PYRAMID_SCORE, (r) => this.emit('pyramidScore', r.byte(), r.int()));
    on(S.LOCK_UI, (r) => this.emit('lockUi', r.bool()));
    on(S.DISABLE_UI, (r) => this.emit('disableUi', r.bool()));
    on(S.CHANGE_CHANNEL, (r) => { r.ubyte(); const ip = Array.from(r.bytes(4)).join('.'); this.emit('changeChannel', { ip, port: r.ushort() }); });
  }

  // ------------------------------------------------------------------ senders
  /** Tells Cosmic the field finished loading; it ignores portals until this arrives. */
  mapLoaded() { this.send(new PacketWriter(C.PLAYER_MAP_TRANSFER)); }

  move(start, moves) {
    const w = new PacketWriter(C.MOVE_PLAYER).byte(0).int(0).pos(start);
    writeMovement(w, moves);
    w.byte(0);
    this.send(w);
  }

  /** activity: (12 + attack) * 2 + facing for an attack, (20 + skill action) * 2 + facing for a skill (with its id/level). */
  /** NPC_ACTION: what an NPC we control is about to do (an action from 2, or -1) and which line it says (-1: none). */
  npcAction(oid, action, chat) { this.send(new PacketWriter(C.NPC_ACTION).int(oid).byte(action).byte(chat)); }
  moveMob(oid, start, moves, activity = -1, skill = 0, level = 0) {
    const id = this.moveId++ & 0x7fff;
    (this.mobMoveIds ??= new Map()).set(oid, id);
    const w = new PacketWriter(C.MOVE_LIFE).int(oid).short(id)
      .byte(0).byte(activity).byte(skill).byte(level).short(0).zero(8).byte(0).int(0).pos(start);
    writeMovement(w, moves);
    this.send(w);
  }

  /**
   * Attack packets (AbstractDealDamageHandler.parseDamage). kind: melee | ranged | magic.
   * targets: [{oid, x, y, dmg:[...]}]; stance = body action id; facingLeft -> direction bit.
   */
  attack(kind, { targets, lines, display = 0, stance, facingLeft, speed = 4, skill = 0, charge = 0, mesos, pos, delay = 0 }) {
    const op = kind === 'ranged' ? C.RANGED_ATTACK : kind === 'magic' ? C.MAGIC_ATTACK : C.CLOSE_RANGE_ATTACK;
    const w = new PacketWriter(op).byte(0).byte((targets.length << 4) | lines).int(skill);
    if (CHARGE_SKILLS.has(skill)) w.int(charge); // keydown skills carry how long they were held (ms)
    // the action (15 bits) with facing left in the top bit, as one short
    w.zero(8).byte(display).short((stance & 0x7fff) | (facingLeft ? 0x8000 : 0));
    if (skill === 4211006) {   // Meso Explosion: each monster's own line count, then the mesos used and whom each hit
      w.byte(0).byte(speed).int(Date.now() | 0);
      for (const t of targets) { w.int(t.oid).zero(4).pos(t).pos(t).byte(t.dmg.length); for (const d of t.dmg) w.int(d); w.int(0); }
      w.pos({ x: Math.round(pos?.x || 0), y: Math.round(pos?.y || 0) }).byte((mesos || []).length);
      for (const m of mesos || []) w.int(m.oid).byte(m.mask);
      this.send(w.short(delay));
      return;
    }
    if (kind === 'ranged') {
      // Cosmic passes the 4th byte on in the action's high byte for Hurricane-type skills, so it carries the facing too
      w.byte(0).byte(speed).byte(0).byte(((stance >> 8) & 0x7f) | (facingLeft ? 0x80 : 0)).zero(7);
      if ([3121004, 3221001, 5221004, 13111002].includes(skill)) w.int(charge); // Hurricane / Rapid Fire, Piercing's charge (ms)
    } else {
      w.byte(0).byte(speed).zero(4);
    }
    for (const t of targets) {
      w.int(t.oid).zero(4).pos(t).pos(t).short(Math.max(0, Math.min(0x7fff, Math.round(t.delay || 0))));   // when it lands (ms)
      for (const d of t.dmg) w.int(d);
      w.int(0); // per-target trailer (mob CRC in the real client); parseDamage skips 4 bytes per target
    }
    if (skill === 14111006) w.int(0).pos({ x: 0, y: 0 }); // Poison Bomb: position
    this.send(w);
  }
  closeRangeAttack(o) { this.attack('melee', o); }
  /** A monster that seeks you out (firstAttack / pickUp): its object id and how far you are from it. */
  /** A monster ran into the escorted (friendly) one: the attacker, your character id and the friendly one. */
  mobDamageMobFriendly(attacker, charId, friendly) { this.send(new PacketWriter(C.MOB_DAMAGE_MOB_FRIENDLY).int(attacker).int(charId).int(friendly)); }
  /** A monster's attack struck another (one of them Hypnotized): attacker, you, the struck one, which attack, the damage. */
  mobDamageMob(attacker, charId, victim, attack, damage, facingLeft, x, y) {
    this.send(new PacketWriter(C.MOB_DAMAGE_MOB).int(attacker).int(charId).int(victim).byte(attack).int(damage).byte(facingLeft ? 1 : 0).short(x).short(y));
  }
  /** The Beholder's own skill: its oid, the skill (Aura / Hex of the Beholder), its action (facing left in bit 7). */
  beholder(oid, skill, action, extra = null) {
    const w = new PacketWriter(C.BEHOLDER).int(oid).int(skill).byte(action);
    if (extra !== null) w.byte(extra);
    this.send(w);
  }
  /** A self-destructing monster reached you with its attack: it goes off. */
  monsterBomb(oid) { this.send(new PacketWriter(C.MONSTER_BOMB).int(oid)); }
  autoAggro(oid, distance) { this.send(new PacketWriter(C.AUTO_AGGRO).int(oid).int(distance)); }
  /** A map obstacle struck a monster: its object id and the damage. */
  fieldDamageMob(oid, damage) { this.send(new PacketWriter(C.FIELD_DAMAGE_MOB).int(oid).int(damage)); }
  /**
   * A skill that strikes the monster your body touches (Body Pressure): one monster, one line; 8 bytes where the
   * skill's checks go, no action (only the facing bit), the attack speed, the time; per monster its position twice,
   * no delay, the damage and 4 bytes; then where you stand.
   */
  touchAttack({ skill, mob, dmg, facingLeft, speed, pos }) {
    const w = new PacketWriter(C.TOUCH_MONSTER_ATTACK).byte(0).byte((1 << 4) | 1).int(skill).zero(8)
      .byte(0).short(facingLeft ? 0x8000 : 0).byte(speed).byte(0).int(Date.now() | 0);
    const at = { x: Math.round(mob.x), y: Math.round(mob.y) };
    w.int(mob.oid).zero(4).pos(at).pos(at).short(0).int(dmg).int(0);
    this.send(w.pos({ x: Math.round(pos.x), y: Math.round(pos.y) }));
  }

  /** SPECIAL_MOVE: buffs and other non-attack skills. pos is sent for summons / doors. */
  specialMove(skillId, level, pos, star = 0) {
    const w = new PacketWriter(C.SPECIAL_MOVE).int(Date.now() | 0).int(skillId).byte(level);
    if (pos) w.pos(pos).byte(0);
    if (star) w.int(star);   // Shadow Stars: the star it takes
    // the client ends every SPECIAL_MOVE with a short; Cosmic reads it only for Monster Rider (and would take it for a
    // position on the others), so it goes on that one alone
    if (skillId % 10000000 === 1004) w.short(0);
    this.send(w);
  }
  /** Heal: which party members it reaches (one bit per party slot), then a delay. */
  heal(skillId, level, mask) {
    this.send(new PacketWriter(C.SPECIAL_MOVE).int(Date.now() | 0).int(skillId).byte(level).byte(mask).short(0));
  }
  /** A skill starting to charge or wind up (Monster Magnet, Big Bang, Explosion...): its pose, which way you face, speed. */
  skillEffect(skillId, level, action, facingLeft, speed) {
    this.send(new PacketWriter(C.SKILL_EFFECT).int(skillId).byte(level).short((action & 0x7fff) | (facingLeft ? 0x8000 : 0)).byte(speed));
  }
  /** Monster Magnet: the monsters it reached and whether each was caught, then which way you face. */
  magnet(skillId, level, mobs, facingLeft) {
    const w = new PacketWriter(C.SPECIAL_MOVE).int(Date.now() | 0).int(skillId).byte(level).int(mobs.length);
    for (const [oid, caught] of mobs) w.int(oid).byte(caught ? 1 : 0);
    this.send(w.byte(facingLeft ? 1 : 0));
  }
  cancelBuff(skillId) { this.send(new PacketWriter(C.CANCEL_BUFF).int(skillId)); }
  /** Grenade thrown: where from, how long it was held (ms) and the skill. */
  grenadeEffect(x, y, held, skillId) { this.send(new PacketWriter(C.GRENADE_EFFECT).int(x).int(y).int(held).int(skillId)); }
  /** End an item's buff early: the item id, negated. */
  cancelItemEffect(itemId) { this.send(new PacketWriter(C.CANCEL_ITEM_EFFECT).int(-itemId)); }
  /** One of your curses is past its time: asks the server to lift it (no body). */
  cancelDebuff() { this.send(new PacketWriter(C.CANCEL_DEBUFF)); }
  /** An Aran's hit on a monster counts toward the combo (no body). */
  aranComboCounter() { this.send(new PacketWriter(C.ARAN_COMBO_COUNTER)); }
  /** A monster that banishes on touch (info/ban/banType 1) touched you: its id; the server sends you to its banMap. */
  mobBanishPlayer(mobId) { this.send(new PacketWriter(C.MOB_BANISH_PLAYER).int(mobId)); }
  /** Sit on a chair item (Install 0301xxxx). */
  /** Through a Mystic Door: its owner, and whether you are going from town out to the field. */
  useDoor(owner, fromTown) { this.send(new PacketWriter(C.USE_DOOR).int(owner).byte(fromTown ? 1 : 0)); }
  useChair(itemId) { this.send(new PacketWriter(C.USE_CHAIR).int(itemId)); }
  /** Sit on the map's seat `id`, or -1 to stand up. */
  cancelChair(id) { this.send(new PacketWriter(C.CANCEL_CHAIR).short(id)); }
  /** changes: [{key, type, action}] (type 0 clears the key) */
  changeKeymap(changes) {
    const w = new PacketWriter(C.CHANGE_KEYMAP).int(0).int(changes.length);
    for (const c of changes) w.int(c.key).byte(c.type).int(c.action);
    this.send(w);
  }

  /** The quick slots' eight keys (scancodes). */
  changeQuickslots(keys) {
    const w = new PacketWriter(C.CHANGE_QUICKSLOT);
    for (const k of keys) w.int(k);
    this.send(w);
  }

  /** DAMAGE_REACTOR: an attack reached it. stance: 0/1 in the air facing left/right, 2/3 on the ground. */
  damageReactor(oid, charPos, stance, skill = 0) {
    this.send(new PacketWriter(C.DAMAGE_REACTOR).int(oid).int(charPos).short(stance).int(0).int(skill));
  }
  /** TOUCHING_REACTOR: walked onto (true) or off (false) a reactor set off by touch. */
  touchReactor(oid, touching) { this.send(new PacketWriter(C.TOUCHING_REACTOR).int(oid).byte(touching ? 1 : 0)); }
  /** CLICK_GUIDE: the beginner guide was double-clicked. */
  clickGuide() { this.send(new PacketWriter(C.CLICK_GUIDE)); }
  /** An obstacle (a trap) hurt you: -3, no element, the damage, its disease (skill << 8 | level), then 0. */
  takeObstacleDamage(damage, disease = 0) {
    this.send(new PacketWriter(C.TAKE_DAMAGE).int(Date.now() | 0).byte(-3).byte(0).int(damage).short(disease).byte(0));
  }
  takeDamage({ damage, mobId, oid, direction = 0, from = -1 }) {
    this.send(new PacketWriter(C.TAKE_DAMAGE).int(Date.now() | 0).byte(from).byte(0).int(damage).int(mobId).int(oid).byte(direction));
  }

  chat(text) { this.send(new PacketWriter(C.GENERAL_CHAT).string(text).byte(0)); }
  /** FACE_EXPRESSION: 1 hit .. 7 stunned (F1-F7); higher ones need their cash emotion item */
  faceExpression(emote) { this.send(new PacketWriter(C.FACE_EXPRESSION).int(emote)); }
  /** USE_ITEMEFFECT: the Effect item now on (0 = off) */
  useItemEffect(itemId) { this.send(new PacketWriter(C.USE_ITEMEFFECT).int(itemId)); }
  /** type: 0 buddy (recipients = buddy ids), 1 party, 2 guild, 3 alliance */
  groupChat(type, text, recipients = []) {
    const w = new PacketWriter(C.MULTI_CHAT).byte(type).byte(recipients.length);
    for (const id of recipients) w.int(id);
    this.send(w.string(text));
  }
  /** REPORT: 0 an illegal program, 1 a conversation (with its chat lines); the name, the reason and the description. */
  report(type, name, reason, text, chatLog = '') {
    const w = new PacketWriter(C.REPORT).byte(type).string(name).byte(reason).string(text);
    if (type) w.string(chatLog);
    this.send(w);
  }
  whisper(name, text) { this.send(new PacketWriter(C.WHISPER).byte(0x06).string(name).string(text)); }
  /** A whisper not taken (whispers off in the Game Option, or a Blacklisted sender): 0x22 and their name. */
  whisperBlock(name) { this.send(new PacketWriter(C.WHISPER).byte(0x22).string(name)); }
  find(name) { this.send(new PacketWriter(C.WHISPER).byte(0x05).string(name)); }
  /** Where a buddy is, for the Buddy tab's location line (answered with flag 0x48). */
  findBuddy(name) { this.send(new PacketWriter(C.WHISPER).byte(0x44).string(name)); }
  /** A flowerpot's window: CLOSE_ITEMUI (item, 1 opened / 0 closed), OPEN_ITEMUI (its quest), USE_ITEMUI (an item dropped on it) */
  closeItemUi(itemId, open) { this.send(new PacketWriter(C.CLOSE_ITEMUI).int(itemId).byte(open)); }
  openItemUi(questId) { this.send(new PacketWriter(C.OPEN_ITEMUI).short(questId)); }
  useItemUi(tab, slot, itemId) { this.send(new PacketWriter(C.USE_ITEMUI).byte(tab).short(slot).int(itemId)); }
  /** A Gold / Silver box: its slot and item */
  useTreasureBox(slot, itemId) { this.send(new PacketWriter(C.USE_TREASURE_BOX).short(slot).int(itemId)); }
  /** MAKER_SKILL: 1 / 2 an item (Stimulator put in, gems), 3 a Monster Crystal (the drop), 4 disassembling (the equip, tab, slot) */
  makerSkill(type, itemId, { catalyst = false, gems = [], tab = 1, slot = 0 } = {}) {
    const w = new PacketWriter(C.MAKER_SKILL).int(type).int(itemId);
    if (type === 1 || type === 2) { w.byte(catalyst ? 1 : 0).int(gems.length); for (const g of gems) w.int(g); }
    else if (type === 4) w.int(tab).int(slot);
    this.send(w);
  }
  /** RING_ACTION: 0 propose (partner, ring box), 1 withdraw, 2 answer (accepted, proposer, their id), 5 invite a guest (name, marriage, slot), 6 open an invitation (slot, item) */
  propose(name, itemId) { this.send(new PacketWriter(C.RING_ACTION).byte(0).string(name).int(itemId)); }
  withdrawProposal() { this.send(new PacketWriter(C.RING_ACTION).byte(1)); }
  breakEngagement(itemId) { this.send(new PacketWriter(C.RING_ACTION).byte(3).int(itemId)); }
  answerProposal(ok, name, id) { this.send(new PacketWriter(C.RING_ACTION).byte(2).byte(ok ? 1 : 0).string(name).int(id)); }
  inviteGuest(name, marriageId, slot) { this.send(new PacketWriter(C.RING_ACTION).byte(5).string(name).int(marriageId).int(slot)); }
  openInvitation(slot, itemId) { this.send(new PacketWriter(C.RING_ACTION).byte(6).int(slot).int(itemId)); }
  /** NEW_YEAR_CARD_REQUEST: 0 send (slot, item, to, message), 1 accept a card */
  sendNewYearCard(slot, itemId, to, text) { this.send(new PacketWriter(C.NEW_YEAR_CARD_REQUEST).byte(0).short(slot).int(itemId).string(to).string(text)); }
  acceptNewYearCard(id) { this.send(new PacketWriter(C.NEW_YEAR_CARD_REQUEST).byte(1).int(id)); }
  /** USE_CASH_ITEM: the slot, the item, what that kind of item adds (add(writer)), then the tick. */
  useCashItem(slot, itemId, add = null) {
    const w = new PacketWriter(C.USE_CASH_ITEM).short(slot).int(itemId);
    add?.(w);
    this.send(w.int(Date.now() | 0));
  }
  /** WATER_OF_LIFE: no fields; the server opens the fairy's dialog. */
  waterOfLife() { this.send(new PacketWriter(C.WATER_OF_LIFE)); }
  /** USE_CASH_ITEM for a Memo (509xxxx): who to, the note. */
  useMemo(slot, itemId, to, text) { this.useCashItem(slot, itemId, (w) => w.string(to).string(text)); }
  /** BUDDYLIST_MODIFY: 1 add (name, group), 2 accept (cid), 3 delete / deny (cid) */
  buddyAdd(name, group = 'Default Group') { this.send(new PacketWriter(C.BUDDYLIST_MODIFY).byte(1).string(name).string(group)); }
  buddyAccept(cid) { this.send(new PacketWriter(C.BUDDYLIST_MODIFY).byte(2).int(cid)); }
  buddyDelete(cid) { this.send(new PacketWriter(C.BUDDYLIST_MODIFY).byte(3).int(cid)); }
  /** PARTY_OPERATION: 1 create, 2 leave, 3 join (party id), 4 invite (name), 5 expel (cid), 6 make leader (cid) */
  partyOp(op, arg) {
    const w = new PacketWriter(C.PARTY_OPERATION).byte(op);
    if (typeof arg === 'string') w.string(arg); else if (arg !== undefined) w.int(arg);
    this.send(w);
  }
  /** PARTY_OPERATION 2, leave: the client sends a 0 byte after it. */
  partyLeave() { this.send(new PacketWriter(C.PARTY_OPERATION).byte(2).byte(0)); }
  /** Player shop room ops (Cosmic PlayerShop / PacketCreator.getPlayerShop*). Returns whether it was one. */
  shopOp(op, r) {
    if (op === 0x19) { const mesos = this.roomType === 5 ? r.int() : undefined; this.emit('shopItems', readShopItems(r), mesos); return true; }   // UPDATE_MERCHANT: (mesos) the stock
    if (op === 0x2A) { this.roomType = 0; this.emit('shopClosed', 0, r.available ? r.ubyte() : null); return true; }   // REAL_CLOSE_MERCHANT: closed, and what came back
    if (op === 0x1A) { this.emit('shopSold', r.ubyte(), r.short(), r.string()); return true; } // UPDATE_PLAYERSHOP: sold (owner)
    if (op === 4) { const slot = r.ubyte(), look = readCharLook(r); this.emit('shopVisitor', slot, r.string(), look); return true; }
    if (op === 6 && r.ubyte() === 8) { const slot = r.ubyte(); this.emit('shopChat', slot, r.string()); return true; }
    if (op === 0x0A) {                                                   // a visitor left, or the shop closed on you
      // getPlayerShopRemoveVisitor: short slot (slot, 0); shopErrorMessage: type, reason (non-zero); nothing: you left.
      // A merchant's hiredMerchantVisitorLeave is a single byte slot.
      if (this.roomType === 5 && r.available === 1) { this.emit('shopLeft', r.ubyte()); return true; }
      const a = r.available >= 1 ? r.ubyte() : 0, b = r.available >= 1 ? r.ubyte() : 0;
      if (a && !b) this.emit('shopLeft', a);
      else { this.roomType = 0; this.emit('shopClosed', b); }
      return true;
    }
    return false;
  }
  /** An Omok / Match Card room's ops while you are in one. */
  gameOp(op, r) {
    const e = { op };
    if (op === 4) { e.slot = r.ubyte(); e.look = readCharLook(r); e.name = r.string(); e.record = r.available >= 20 ? readGameRecord(r) : null; }
    else if (op === 6) { const kind = r.ubyte(); if (kind === 7) { e.system = r.ubyte(); e.name = r.string(); } else { e.slot = r.ubyte(); e.text = r.string(); } }
    else if (op === 9) { e.slot = r.ubyte(); e.look = readCharLook(r); }
    else if (op === 0x0A) { e.slot = r.ubyte(); if (r.available) e.reason = r.ubyte(); }
    else if (op === 0x37) { e.accepted = r.ubyte() !== 0; if (e.accepted) { e.count = r.ubyte(); e.slot = r.ubyte(); } }
    else if (op === 0x3D) { e.slot = r.ubyte(); if (this.roomType === 2) { e.cards = []; for (let n = r.ubyte(); n > 0; n--) e.cards.push(r.int()); } }
    else if (op === 0x3E) { e.type = r.ubyte(); if (e.type !== 1) e.winner = r.ubyte(); e.records = [readGameRecord(r), readGameRecord(r)]; }
    else if (op === 0x3F) e.slot = r.ubyte();
    else if (op === 0x40) { e.x = r.int(); e.y = r.int(); e.color = r.ubyte(); }
    else if (op === 0x41) e.code = r.ubyte();
    else if (op === 0x44) { e.turn = r.ubyte(); e.index = r.ubyte(); if (e.turn === 0) { e.firstIndex = r.ubyte(); e.result = r.ubyte(); } }
    if (op === 0x0A && e.slot !== undefined && e.reason !== undefined) this.roomType = 0;
    this.emit('gameOp', e);
  }
  /** PLAYER_INTERACTION ops of a game room (with what `add` writes after the op). */
  roomOp(op, add = null) { const w = new PacketWriter(C.PLAYER_INTERACTION).byte(op); add?.(w); this.send(w); if (op === 0x0A) this.roomType = 0; }
  /** CREATE an Omok (1) / Match Card (2) room: title, password (if any), stone set or size */
  gameCreate(type, title, hasPw, pw, piece) {
    const w = new PacketWriter(C.PLAYER_INTERACTION).byte(0).byte(type).string(title).byte(hasPw ? 1 : 0);
    if (hasPw) w.string(pw);
    this.send(w.byte(piece));
  }
  /** VISIT a game room from its balloon: its id, then the password when it has one */
  gameVisit(sn, pw) {
    const w = new PacketWriter(C.PLAYER_INTERACTION).byte(4).int(sn).byte(pw != null ? 1 : 0);
    if (pw != null) w.string(pw);
    this.send(w.byte(0));
  }
  /** CREATE type 4 (a Shop Permit) or 5 (a Hired Merchant): the title and the item that opens it */
  pshopCreate(title, itemId, type = 4) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0).byte(type).string(title).byte(0).short(0).int(itemId)); }
  pshopVisit(oid) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(4).int(oid)); }
  /** VISIT a Hired Merchant: the client adds two 0 bytes. */
  merchantVisit(oid) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(4).int(oid).byte(0).byte(0)); }
  pshopOpenStore() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0B).byte(1)); }
  pshopOpenCash(type, birthday) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0E).byte(0x0B).byte(type).int(birthday)); }
  /** ADD_ITEM: inventory tab, slot, how many bundles, how many in each, the price of one bundle */
  pshopPut(tab, slot, bundles, perBundle, price) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x16).byte(tab).short(slot).short(bundles).short(perBundle).int(price)); }
  pshopRemove(index) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x1B).short(index)); }
  pshopBuy(index, bundles) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x17).byte(index).short(bundles)); }
  pshopExit() { this.roomType = 0; this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0A)); }
  // ---- your Hired Merchant: HIRED_MERCHANT_REQUEST asks whether one may open here (ENTRUSTED_SHOP_CHECK_RESULT answers);
  // in its room TAKE_ITEM_BACK 0x26, MERCHANT_ORGANIZE 0x28 (collect the mesos, drop sold-out rows), CLOSE_MERCHANT 0x29
  // (close it, the stock back to you), MAINTENANCE_OFF 0x27 (leave and reopen it)
  // ---- Family
  familyOpen() { this.send(new PacketWriter(C.OPEN_FAMILY)); }
  familyChart(name) { this.send(new PacketWriter(C.OPEN_FAMILY_PEDIGREE).string(name)); }
  familyAdd(name) { this.send(new PacketWriter(C.ADD_FAMILY).string(name)); }
  familyAnswer(inviterId, name, accept) { this.send(new PacketWriter(C.ACCEPT_FAMILY).int(inviterId).string(name).byte(accept ? 1 : 0)); }
  /** SEPARATE_FAMILY_BY_SENIOR: let a junior of yours go; SEPARATE_FAMILY_BY_JUNIOR: leave your senior */
  familyDropJunior(id) { this.send(new PacketWriter(C.SEPARATE_FAMILY_BY_SENIOR).int(id)); }
  familyLeaveSenior() { this.send(new PacketWriter(C.SEPARATE_FAMILY_BY_JUNIOR)); }
  /** USE_FAMILY: a privilege by index (Family Reunion / Summon Family name the member) */
  familyUse(index, name) { const w = new PacketWriter(C.USE_FAMILY).int(index); if (name) w.string(name); this.send(w); }
  familyPrecepts(text) { this.send(new PacketWriter(C.CHANGE_FAMILY_MESSAGE).string(text)); }
  familySummonAnswer(family, accept) { this.send(new PacketWriter(C.FAMILY_SUMMON_RESPONSE).string(family).byte(accept ? 1 : 0)); }
  /**
   * USE_CASH_ITEM for the megaphones: slot, item, then by kind - Megaphone: text; Super: text, ear;
   * Item: text, ear, an item or not (inventory type, slot); Triple: line count (up to the last line written; empty
   * ones before it go as ""), lines, ear; Avatar (539): four lines, ear, your look
   */
  useMegaphone(slot, itemId, { text = '', lines = null, ear = false, item = null, look = null } = {}) {
    const kind = Math.floor(itemId / 1000) % 10;
    this.useCashItem(slot, itemId, (w) => {
      if (Math.floor(itemId / 10000) === 539) { for (let i = 0; i < 4; i++) w.string(lines?.[i] || ''); w.byte(ear ? 1 : 0); if (look) writeCharLook(w, look); }
      else if (kind === 1) w.string(text);
      else if (kind === 2) w.string(text).byte(ear ? 1 : 0);
      else if (kind === 6) { w.string(text).byte(ear ? 1 : 0).byte(item ? 1 : 0); if (item) w.int(item.tab).int(item.slot); }
      else if (kind === 7) {
        const ls = (lines || [text]).slice(0, 3), n = ls[2] ? 3 : ls[1] ? 2 : 1;
        w.byte(n); for (let i = 0; i < n; i++) w.string(ls[i] || ''); w.byte(ear ? 1 : 0);
      }
    });
  }
  /**
   * USE_CASH_ITEM for MapleTV (5075000-5075005): a Megassenger (3-5) adds the ear; the plain kinds a flag (3 with a
   * receiver, else 1); the plain and Heart kinds the receiver; then the five lines
   */
  useMapleTV(slot, itemId, { kind, mega, ear, to, lines }) {
    this.useCashItem(slot, itemId, (w) => {
      if (kind === 0) w.byte(to ? 3 : 1);
      if (mega) w.byte(ear ? 1 : 0);
      if (kind !== 1) w.string(to);
      for (let i = 0; i < 5; i++) w.string(lines[i] || '');
    });
  }
  /** SPOUSE_CHAT: to your husband or wife (the server finds them; the first string is ignored) */
  spouseChat(text) { this.send(new PacketWriter(C.SPOUSE_CHAT).string('').string(text)); }
  /** DUEY_ACTION: 2 send (an item and / or mesos to a character), 4 take a parcel, 5 delete one, 7 close Duey */
  /** DUEY_ACTION 2: tab, slot, how many, mesos, to; then 0, or for a quick send 1, its message and the coupon's slot */
  dueySend({ tab = 0, slot = 0, qty = 0, mesos = 0, to, quick = false, message = '', ticket = 0 }) {
    const w = new PacketWriter(C.DUEY_ACTION).byte(2).byte(tab).short(slot).short(qty).int(mesos).string(to);
    if (quick) w.byte(1).string(message).int(ticket); else w.byte(0);
    this.send(w);
  }
  /** DUEY_ACTION 0: the arrival balloon's O asks Duey to open */
  dueyOpen() { this.send(new PacketWriter(C.DUEY_ACTION).byte(0).int(-1).int(2)); }
  dueyTake(id) { this.send(new PacketWriter(C.DUEY_ACTION).byte(4).int(id)); }
  dueyDelete(id) { this.send(new PacketWriter(C.DUEY_ACTION).byte(5).int(id)); }
  dueyClose() { this.send(new PacketWriter(C.DUEY_ACTION).byte(7)); }
  /** A Chalkboard (537xxxx): its text; CLOSE_CHALKBOARD puts it away. */
  useChalkboard(slot, itemId, text) { this.useCashItem(slot, itemId, (w) => w.string(text)); }
  closeChalkboard() { this.send(new PacketWriter(C.CLOSE_CHALKBOARD)); }
  /** TROCK_ADD_MAP: 1 save the map you are in, 0 delete one; for the VIP list or the regular one */
  /** The Use-tab Teleport Rock (232xxxx): its slot, the item, 0 and the map picked, then the time. */
  /** The Maplemas Party Potion's Transform window: the time, the slot, the item and the name to look like. */
  transform(slot, itemId, name) { this.send(new PacketWriter(C.TRANSFORM).int(Date.now() | 0).short(slot).int(itemId).string(name)); }
  useTeleportRock(slot, itemId, mapId) { this.send(new PacketWriter(C.USE_TELEPORT_ROCK).short(slot).int(itemId).byte(0).int(mapId).int(Date.now() | 0)); }
  rockSave(vip) { this.send(new PacketWriter(C.TROCK_ADD_MAP).byte(1).byte(vip ? 1 : 0)); }
  rockDelete(vip, mapId) { this.send(new PacketWriter(C.TROCK_ADD_MAP).byte(0).byte(vip ? 1 : 0).int(mapId)); }
  /** USE_CASH_ITEM for a Teleport Rock (504xxxx): 0 then a map, or 1 then a character to chase (VIP rocks only) */
  useRock(slot, itemId, { mapId, name }) { this.useCashItem(slot, itemId, (w) => (name ? w.byte(1).string(name) : w.byte(0).int(mapId))); }
  /** MESSENGER: 0 open one (id 0) or accept an invitation (its id), 2 leave, 3 invite, 5 decline, 6 chat ("name : text") */
  messengerJoin(id = 0) { this.send(new PacketWriter(C.MESSENGER).byte(0).int(id)); }
  messengerLeave() { this.send(new PacketWriter(C.MESSENGER).byte(2)); }
  messengerInvite(name) { this.send(new PacketWriter(C.MESSENGER).byte(3).string(name)); }
  /** A Messenger invitation turned down; one refused by the Game Option or the Blacklist adds your name and 1. */
  messengerDecline(from, me = null) { const w = new PacketWriter(C.MESSENGER).byte(5).string(from); if (me !== null) w.string(me).byte(1); this.send(w); }
  messengerChat(text) { this.send(new PacketWriter(C.MESSENGER).byte(6).string(text)); }
  merchantRequest() { this.send(new PacketWriter(C.HIRED_MERCHANT_REQUEST)); }
  /** The Owl of Minerva: OWL_ACTION (5 when its search opens), OWL_WARP (a store's owner and map), the Use-tab owl's search */
  owlAction(mode) { this.send(new PacketWriter(C.OWL_ACTION).byte(mode)); }
  owlWarp(ownerId, mapId) { this.send(new PacketWriter(C.OWL_WARP).int(ownerId).int(mapId)); }
  useOwlItem(slot, itemId, searchId, desc) { this.send(new PacketWriter(C.USE_OWL_ITEM).short(slot).int(itemId).int(searchId).byte(desc ? 1 : 0).int(Date.now() | 0)); }
  /** Cash Shop Surprise: the box's cash id */
  cashShopSurprise(cashId) { this.send(new PacketWriter(C.CASHSHOP_SURPRISE).long(cashId)); }
  /** The Store Remote Controller: its slot */
  remoteStore(slot) { this.send(new PacketWriter(C.REMOTE_STORE).short(slot)); }
  /** Managing your store from afar: the birthday code, then what the server gave */
  manageStore(birthday, a, b, c) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0E).byte(4).byte(5).int(birthday).int(a).byte(1).short(b).bytes(c)); }
  /** The Remote Gachapon ticket: the town (0-9) */
  useRemote(itemId, index) { this.send(new PacketWriter(C.USE_REMOTE).int(itemId).int(index)); }
  /** Maple Life: a name to check */
  useMapleLife(name) { this.send(new PacketWriter(C.USE_MAPLELIFE).string(name)); }
  /** Vicious' Hammer: the result shown, sent back */
  useHammer(mode, code) { this.send(new PacketWriter(C.USE_HAMMER).int(mode).int(code)); }
  merchantTakeBack(index) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x26).short(index)); }
  merchantOrganize() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x28)); }
  merchantClose() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x29)); }
  merchantLeave() { this.roomType = 0; this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x27)); }
  /** PLAYER_INTERACTION: 0 create (type 3 = trade), 2 invite, 3 decline, 4 visit, 6 chat, 0xA exit, 0xF item, 0x10 meso, 0x11 confirm */
  tradeStart(cid) {
    this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0).byte(3));
    this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(2).int(cid));
  }
  /** A trade invitation taken: visit (4) its room, then two zero bytes. */
  tradeAccept(id = 0) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(4).int(id).byte(0).byte(0)); }
  /** A trade invitation turned down (3): 3 declined, 4 not taking them (Game Option, Blacklist). */
  tradeDecline(id = 0, reason = 3) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(3).int(id).byte(reason)); }
  tradeItem(tab, pos, qty, slot) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0F).byte(tab).short(pos).short(qty).byte(slot)); }
  tradeMeso(v) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x10).int(v)); }
  tradeConfirm() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x11)); }
  tradeChat(text) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(6).string(text)); }
  tradeExit() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0A)); }
  charInfo(cid) { this.send(new PacketWriter(C.CHAR_INFO_REQUEST).int(Date.now() | 0).int(cid)); }
  /** GIVE_FAME: target char id + direction (0 drop, 1 raise). */
  giveFame(cid, mode) { this.send(new PacketWriter(C.GIVE_FAME).int(cid).byte(mode)); }
  /** GUILD_OPERATION: 2 create, 5 invite, 6 join, 7 leave, 8 expel, 0xD rank titles, 0xE rank, 0xF emblem, 0x10 notice, 0x1E agree */
  guildOp(op, ...args) {
    const w = new PacketWriter(C.GUILD_OPERATION).byte(op);
    for (const a of args) if (typeof a === 'string') w.string(a); else w.int(a);
    this.send(w);
  }
  /** FREDRICK_ACTION: 0x1A take everything back, 0x1C his window closed. */
  fredrick(op) { this.send(new PacketWriter(C.FREDRICK_ACTION).byte(op)); }
  /** BBS_OPERATION 0: post (edit flag, the thread when editing, notice flag, title, text, emoticon). */
  bbsPost(edit, id, notice, title, text, icon) {
    const w = new PacketWriter(C.BBS_OPERATION).byte(0).byte(edit ? 1 : 0);
    if (edit) w.int(id);
    this.send(w.byte(notice ? 1 : 0).string(title).string(text).int(icon));
  }
  /** BBS_OPERATION 1 delete a thread, 2 a page of the list, 3 open a thread, 4 reply, 5 delete a reply. */
  bbsDelete(id) { this.send(new PacketWriter(C.BBS_OPERATION).byte(1).int(id)); }
  bbsList(page) { this.send(new PacketWriter(C.BBS_OPERATION).byte(2).int(page)); }
  bbsShow(id) { this.send(new PacketWriter(C.BBS_OPERATION).byte(3).int(id)); }
  bbsReply(id, text) { this.send(new PacketWriter(C.BBS_OPERATION).byte(4).int(id).string(text)); }
  bbsReplyDelete(id, reply) { this.send(new PacketWriter(C.BBS_OPERATION).byte(5).int(id).int(reply)); }
  guildRank(cid, rank) { this.send(new PacketWriter(C.GUILD_OPERATION).byte(0x0E).int(cid).byte(rank)); }
  guildEmblem(e) { this.send(new PacketWriter(C.GUILD_OPERATION).byte(0x0F).short(e.bg).byte(e.bgColor).short(e.logo).byte(e.logoColor)); }
  guildAgree(ok) { this.send(new PacketWriter(C.GUILD_OPERATION).byte(0x1E).int(0).byte(ok ? 1 : 0)); }
  /** ALLIANCE_OPERATION 4: take a guild alliance's invitation (its id, and the inviter's guild name). */
  allianceAccept(id, guildName = '') { this.send(new PacketWriter(C.ALLIANCE_OPERATION).byte(4).int(id).string(guildName)); }
  /**
   * ALLIANCE_OPERATION from the Alliance tab: 1 ask for the alliance again, 2 leave, 3 invite a guild (its name),
   * 0x0A the notice. allianceExpel 6 (guild, alliance), allianceLeader 7 (the new leader), allianceRank 9 (who, 1 up / 0 down).
   */
  allianceOp(mode, text = null) { const w = new PacketWriter(C.ALLIANCE_OPERATION).byte(mode); if (text !== null) w.string(text); this.send(w); }
  allianceExpel(gid, aid) { this.send(new PacketWriter(C.ALLIANCE_OPERATION).byte(6).int(gid).int(aid)); }
  allianceLeader(cid) { this.send(new PacketWriter(C.ALLIANCE_OPERATION).byte(7).int(cid)); }
  allianceRank(cid, up) { this.send(new PacketWriter(C.ALLIANCE_OPERATION).byte(9).int(cid).byte(up ? 1 : 0)); }
  /** DENY_ALLIANCE_REQUEST 0x16: turn a guild alliance's invitation down (the inviter, your guild's name). */
  allianceDeny(from, guildName = '') { this.send(new PacketWriter(C.DENY_ALLIANCE_REQUEST).byte(0x16).string(from).string(guildName)); }
  /** DENY_GUILD_REQUEST: 0x37 refused, 0x36 busy with another invitation, 0x35 not taking invitations. */
  guildDeny(from, code = 0x37, me = '') { this.send(new PacketWriter(C.DENY_GUILD_REQUEST).byte(code).string(from).string(me)); }
  /** PARTY_SEARCH_START: level range, how many members, the job bits; PARTY_SEARCH_UPDATE ends the search */
  partySearchStart(min, max, members, jobs) { this.send(new PacketWriter(C.PARTY_SEARCH_START).int(min).int(max).int(members).int(jobs)); }
  partySearchStop() { this.send(new PacketWriter(C.PARTY_SEARCH_UPDATE)); }
  partyDeny(name) { this.send(new PacketWriter(C.DENY_PARTY_REQUEST).byte(0).string(name)); }
  /** ITEM_PICKUP: field key, tick, where you stand, the drop, then a 0 checksum. */
  pickup(oid, pos) { this.send(new PacketWriter(C.ITEM_PICKUP).byte(0).int(Date.now() | 0).pos(pos).int(oid).int(0)); }
  /** The Cash Shop: entering is a bare ENTER_CASHSHOP, leaving a bare CHANGE_MAP (the server answers with a channel change) */
  enterCashShop() { this.send(new PacketWriter(C.ENTER_CASHSHOP).int(Date.now() | 0)); }
  enterMTS() { this.send(new PacketWriter(C.ENTER_MTS)); }
  leaveCashShop() { this.send(new PacketWriter(C.CHANGE_MAP)); }
  checkCash() { this.send(new PacketWriter(C.CHECK_CASH)); }
  /**
   * CASHSHOP_OPERATION buys (wallet 1 NX credit / 2 maple points / 4 prepaid, each led by a "paid with Maple Points"
   * byte): 3 an item, 0x1E a package (910xxxx), 6 / 7 an inventory / storage slot item (911xxxx), 8 a character
   * slot (543xxxx); 0x20 a meso item (SN 8xxxxxxx). Then 5 wish list, 0xD take out, 0xE put in.
   */
  csBuy(wallet, sn, itemId) {
    const k = Math.floor(itemId / 10000), mp = wallet === 2 ? 1 : 0, w = new PacketWriter(C.CASHSHOP_OPERATION);
    if (Math.floor(sn / 10000000) === 8) w.byte(0x20).int(sn);
    else if (k === 911) w.byte(Math.floor(itemId / 1000) === 9110 ? 7 : 6).byte(mp).int(wallet).byte(1).int(sn);
    else if (k === 543) w.byte(8).byte(mp).int(wallet).int(sn);
    else if (k === 910) w.byte(0x1E).byte(mp).int(wallet).int(sn);
    else w.byte(3).byte(mp).int(wallet).int(sn).int(0);
    this.send(w);
  }
  /** The +Slot buttons: 4 more slots for 4,000 NX - an inventory (type 1-4), or storage. */
  csAddSlots(wallet, type) {
    const w = new PacketWriter(C.CASHSHOP_OPERATION).byte(type ? 6 : 7).byte(wallet === 2 ? 1 : 0).int(wallet).byte(0);
    if (type) w.byte(type);
    this.send(w);
  }
  coupon(code) { this.send(new PacketWriter(C.COUPON_CODE).string('').string(code)); }
  /** A gift: paid from NX Prepaid, confirmed with the account's birthday (YYYYMMDD) */
  csGift(birthday, sn, to, message) { this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(4).int(birthday).int(sn).string(to).string(message)); }
  /** A gift from someone's wish list: mode 4, or 0x1D / 0x23 for rings (with the paying wallet, 4 NX Prepaid) and 0x1F for packages. */
  csWishGift(mode, birthday, sn, to, message) {
    const w = new PacketWriter(C.CASHSHOP_OPERATION).byte(mode).int(birthday);
    if (mode !== 4 && mode !== 0x1F) w.int(4);
    this.send(w.int(sn).string(to).string(message));
  }
  /** A name change / world transfer asks first whether it may go ahead: character id, birthday */
  nameTransfer(cid, birthday) { this.send(new PacketWriter(C.NAME_TRANSFER).int(cid).int(birthday)); }
  worldTransfer(cid, birthday) { this.send(new PacketWriter(C.WORLD_TRANSFER).int(cid).int(birthday)); }
  checkNewName(name) { this.send(new PacketWriter(C.CHECK_CHAR_NAME).string(name)); }
  csNameChange(sn, oldName, newName) { this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(0x2E).int(sn).string(oldName).string(newName)); }
  csWorldTransfer(sn, world) { this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(0x31).int(sn).int(world)); }
  /** A ring for a partner: 0x1D a couple ring, 0x23 a friendship ring; birthday, wallet (1 NX Credit / 4 NX Prepaid), SN, partner, message */
  csBuyRing(op, birthday, wallet, sn, to, message) {
    this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(op).int(birthday).int(wallet).int(sn).string(to).string(message));
  }
  /**
   * NOTE_ACTION 1: the notes discarded: how many, how many are type 3, your free Etc slots, then each id with its type
   * (a type 3 one, while slots last, adds the number before its text's "_").
   */
  discardNotes(notes, freeEtc = 0) {
    const w = new PacketWriter(C.NOTE_ACTION).byte(1).byte(notes.length).byte(notes.filter((n) => n.fame === 3).length).byte(freeEtc);
    let slots = freeEtc;
    for (const n of notes) {
      w.int(n.id).byte(n.fame);
      if (n.fame === 3 && slots > 0) { w.int(parseInt(String(n.text).split('_')[0], 10) || 0); slots--; }
    }
    this.send(w);
  }
  csWish(sns) { const w = new PacketWriter(C.CASHSHOP_OPERATION).byte(5); for (let i = 0; i < 10; i++) w.int(sns[i] || 0); this.send(w); }
  csTake(cashId, type, slot) { this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(0x0D).long(cashId).byte(type).short(slot)); }
  csPut(cashId, type) { this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(0x0E).long(cashId).byte(type)); }
  enterPortal(name) { this.send(new PacketWriter(C.CHANGE_MAP).byte(0).int(-1).string(name).byte(0).byte(0).byte(0)); }
  /** CHANGE_MAP_SPECIAL: field key, portal name, where you stand. */
  scriptPortal(name, pos = { x: 0, y: 0 }) { this.send(new PacketWriter(C.CHANGE_MAP_SPECIAL).byte(0).string(name).short(pos.x).short(pos.y)); }
  innerPortal(name, from, to) { this.send(new PacketWriter(C.USE_INNER_PORTAL).byte(0).string(name).pos(from).pos(to)); }
  /** A scene's move to another map. */
  directionField(id) { this.send(new PacketWriter(C.CHANGE_MAP).byte(0).int(id).string('').byte(0).byte(0).byte(0)); }
  /** Answer the death notice: back to the town, or (wheel) revived on this map by a Wheel of Destiny. */
  respawn(wheel = false) { this.send(new PacketWriter(C.CHANGE_MAP).byte(1).int(0).string('').byte(0).byte(wheel ? 1 : 0).byte(0)); }
  /** The death notice offers a revive item: its id and where the tombstone lies. */
  useDeathItem(itemId, x, y) { this.send(new PacketWriter(C.USE_DEATHITEM).int(itemId).int(x).int(y)); }
  npcTalk(oid, pos) { this.send(new PacketWriter(C.NPC_TALK).int(oid).pos(pos)); }
  /** action: 1 next/yes/ok, 0 back/no, -1 end. selection for menus / numbers. */
  npcReply(lastType, action, selection) {
    const w = new PacketWriter(C.NPC_TALK_MORE).byte(lastType).byte(action);
    if (lastType === 7 || lastType === 8) w.byte(action === 1 ? selection ?? 0 : 0);   // a style choice is one byte
    else if (typeof selection === 'string') w.string(selection);
    else if (selection !== undefined && selection !== null) w.int(selection);
    this.send(w);
  }
  /** AUTO_DISTRIBUTE_AP: [[stat mask, amount], ...] */
  autoDistributeAp(pairs) { const w = new PacketWriter(C.AUTO_DISTRIBUTE_AP).int(Date.now() | 0).int(pairs.length); for (const [m, n] of pairs) w.int(m).int(n); this.send(w); }
  distributeAp(stat) { this.send(new PacketWriter(C.DISTRIBUTE_AP).int(Date.now() | 0).int(stat)); }
  distributeSp(skillId) { this.send(new PacketWriter(C.DISTRIBUTE_SP).int(Date.now() | 0).int(skillId)); }
  /** USE_RETURN_SCROLL / USE_SKILL_BOOK: tick, the item's slot, its id. */
  useReturnScroll(slot, itemId) { this.send(new PacketWriter(C.USE_RETURN_SCROLL).int(Date.now() | 0).short(slot).int(itemId)); }
  /** ITEM_SORT (gather: stacks merged, gaps closed) / ITEM_SORT2 (sort by item id): tick, the inventory. */
  itemGather(inv) { this.send(new PacketWriter(C.ITEM_SORT).int(Date.now() | 0).byte(inv)); }
  itemSort(inv) { this.send(new PacketWriter(C.ITEM_SORT2).int(Date.now() | 0).byte(inv)); }
  /** USE_SUMMON_BAG / USE_MOUNT_FOOD / SCRIPTED_ITEM: tick, slot, item; USE_ITEM_REWARD: slot, item (no tick). */
  useSummonBag(slot, itemId) { this.send(new PacketWriter(C.USE_SUMMON_BAG).int(Date.now() | 0).short(slot).int(itemId)); }
  /** A catch item (227xxxx) on a monster: the time, its slot, the item and the monster. */
  useCatchItem(slot, itemId, oid) { this.send(new PacketWriter(C.USE_CATCH_ITEM).int(Date.now() | 0).short(slot).int(itemId).int(oid)); }
  useMountFood(slot, itemId) { this.send(new PacketWriter(C.USE_MOUNT_FOOD).int(Date.now() | 0).short(slot).int(itemId)); }
  useScriptedItem(slot, itemId) { this.send(new PacketWriter(C.SCRIPTED_ITEM).int(Date.now() | 0).short(slot).int(itemId)); }
  /** A Writ of Solomon (237xxxx): the time, its slot and the item. */
  useSolomonItem(slot, itemId) { this.send(new PacketWriter(C.USE_SOLOMON_ITEM).int(Date.now() | 0).short(slot).int(itemId)); }
  /** Charge the EXP stored from Writs of Solomon: the time. */
  useGachaExp() { this.send(new PacketWriter(C.USE_GACHA_EXP).int(Date.now() | 0)); }
  useItemReward(slot, itemId) { this.send(new PacketWriter(C.USE_ITEM_REWARD).short(slot).int(itemId)); }
  useSkillBook(slot, itemId) { this.send(new PacketWriter(C.USE_SKILL_BOOK).int(Date.now() | 0).short(slot).int(itemId)); }
  useItem(slot, itemId) { this.send(new PacketWriter(C.USE_ITEM).int(Date.now() | 0).short(slot).int(itemId)); }
  /** MONSTER_BOOK_COVER: a card you own as the book's cover (0 releases it). */
  bookCover(cardId) { this.send(new PacketWriter(C.MONSTER_BOOK_COVER).int(cardId)); }
  /** SKILL_MACRO: all five macros (empty ones too, so each keeps its place). */
  skillMacros(list) {
    const w = new PacketWriter(C.SKILL_MACRO).byte(list.length);
    for (const m of list) w.string(m.name || '').byte(m.shout ? 1 : 0).int(m.skills[0] || 0).int(m.skills[1] || 0).int(m.skills[2] || 0);
    this.send(w);
  }
  /** MOVE_SUMMON: the summon's oid, where it started, the steps (only yours). */
  /** DAMAGE_SUMMON: a monster ran into your summon (the Puppet): oid, -1, the damage, the monster's id */
  damageSummon(oid, damage, mobId) { this.send(new PacketWriter(C.DAMAGE_SUMMON).int(oid).byte(-1).int(damage).int(Number(mobId) || 0)); }
  moveSummon(oid, start, moves) { const w = new PacketWriter(C.MOVE_SUMMON).int(oid).pos(start); writeMovement(w, moves); this.send(w); }
  /**
   * SUMMON_ATTACK (SummonDamageHandler): oid, tick, direction, count, the summon's / first mob's position, then per
   * monster: oid, its id + 4 unread bytes, where it is now and next, the hit delay (ms) and the damage.
   */
  /** A summon's attack: its action (4 attack1, 5 attack2) with facing left in the top bit, then each monster struck. */
  summonAttack(s, hits, delay, action = 4) {
    const w = new PacketWriter(C.SUMMON_ATTACK).int(s.oid).int(Date.now() | 0).byte((action & 0x7f) | (s.facingRight ? 0 : 0x80)).byte(hits.length);
    const sx = Math.round(s.x), sy = Math.round(s.y);
    w.short(sx).short(sy).short(sx).short(sy);
    for (const { mob, dmg } of hits) {
      const at = { x: Math.round(mob.x), y: Math.round(mob.y) };
      w.int(mob.oid).int(Number(mob.spawn?.id) || 0).int(0).pos(at).pos(at).short(delay).int(dmg);
    }
    this.send(w);
  }
  /** USE_UPGRADE_SCROLL: the scroll's USE slot, the equip's slot (negative = worn), 2 with a White Scroll (else 1), Legendary Spirit */
  useScroll(scrollSlot, equipSlot, white, legendary) { this.send(new PacketWriter(C.USE_UPGRADE_SCROLL).int(Date.now() | 0).short(scrollSlot).short(equipSlot).short(white ? 2 : 1).byte(legendary ? 1 : 0)); }
  moveItem(inv, from, to, qty = 1) { this.send(new PacketWriter(C.ITEM_MOVE).int(Date.now() | 0).byte(inv).short(from).short(to).short(qty)); }
  healOverTime(hp, mp) { this.send(new PacketWriter(C.HEAL_OVER_TIME).zero(8).short(hp).short(mp).byte(0)); }
  changeChannel(ch) { this.send(new PacketWriter(C.CHANGE_CHANNEL).byte(ch).int(Date.now() | 0)); }
  /** QUEST_ACTION: 1 start, 2 complete (reward choice, -1 none), 3 forfeit, 4 scripted start, 5 scripted end. */
  questAction(action, questId, npcId, pos, selection = -1) {
    const w = new PacketWriter(C.QUEST_ACTION).byte(action).short(questId);
    if (action !== 3) {
      w.int(npcId);
      if (pos) w.pos(pos);
      if (action === 2) w.int(selection);
    }
    this.send(w);
  }
  /** QUEST_ACTION 0: get back the quest items you lost. */
  questRestore(questId, itemIds) {
    const w = new PacketWriter(C.QUEST_ACTION).byte(0).short(questId).int(itemIds.length);
    for (const id of itemIds) w.int(id);
    this.send(w);
  }
  shopRecharge(slot) { this.send(new PacketWriter(C.NPC_SHOP).byte(2).short(slot)); }

  shopBuy(slot, id, qty, price) { this.send(new PacketWriter(C.NPC_SHOP).byte(0).short(slot).int(id).short(qty).int(price)); }
  shopSell(slot, id, qty) { this.send(new PacketWriter(C.NPC_SHOP).byte(1).short(slot).int(id).short(qty)); }
  shopClose() { this.send(new PacketWriter(C.NPC_SHOP).byte(3)); }
  /** STORAGE: 4 take out (type, index), 5 store (slot, id, qty), 6 arrange, 7 mesos (+ out / - in), 8 close */
  /** pets: summon / send home toggles by cash-inventory slot; ids are the pet's unique id (low 32 bits) */
  spawnPet(slot, lead = false) { this.send(new PacketWriter(C.SPAWN_PET).int(Date.now() | 0).short(slot).byte(lead ? 1 : 0)); }
  movePet(sn, start, moves) { const w = new PacketWriter(C.MOVE_PET).long(sn).pos(start); writeMovement(w, moves); this.send(w); }
  petCommand(sn, nameCalled, cmd) { this.send(new PacketWriter(C.PET_COMMAND).long(sn).bool(nameCalled).byte(cmd)); }
  petChat(sn, type, act, text) { this.send(new PacketWriter(C.PET_CHAT).long(sn).byte(type).byte(act).string(text)); }
  petFood(slot, id) { this.send(new PacketWriter(C.PET_FOOD).int(Date.now() | 0).short(slot).int(id)); }
  petLoot(sn, x, y, oid, f) {
    this.send(new PacketWriter(C.PET_LOOT).long(sn).byte(0).int(Date.now() | 0).pos({ x, y }).int(oid).int(0)
      .bool(f.pickupOthers).bool(f.sweepForDrop).bool(f.longRange));
  }
  petAutoPot(sn, slot, id, flag = 0) { this.send(new PacketWriter(C.PET_AUTO_POT).long(sn).byte(flag).int(Date.now() | 0).short(slot).int(id)); }
  petExcludeItems(sn, ids) { const w = new PacketWriter(C.PET_EXCLUDE_ITEMS).long(sn).byte(ids.length); for (const id of ids) w.int(id); this.send(w); }
  /** The potion your pet drinks for HP (1) or MP (2); 0 clears it. */
  petPotion(mode, id) { this.send(new PacketWriter(C.CHANGE_KEYMAP).int(mode).int(id)); }
  dropMeso(v) { this.send(new PacketWriter(C.MESO_DROP).int(Date.now() | 0).int(v)); }
  storageTakeOut(type, slot) { this.send(new PacketWriter(C.STORAGE).byte(4).byte(type).byte(slot)); }
  storageStore(pos, id, qty) { this.send(new PacketWriter(C.STORAGE).byte(5).short(pos).int(id).short(qty)); }
  storageArrange() { this.send(new PacketWriter(C.STORAGE).byte(6)); }
  storageMeso(v) { this.send(new PacketWriter(C.STORAGE).byte(7).int(v)); }
  storageClose() { this.send(new PacketWriter(C.STORAGE).byte(8)); }
}
