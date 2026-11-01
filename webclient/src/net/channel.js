import { Connection } from './connection.js';
import { PacketWriter } from './packet.js';
import { C, S, S_NAMES } from './opcodes.js';
import { readCharacterInfo, readCharLook, readItem, readMovement, writeMovement } from './proto.js';

/** CashShop item records (addCashItemInformation): cash id, account, item, SN, count, gift sender, expiry. */
function readCashItem(r) {
  const cashId = r.long(); r.int(); r.int();
  const it = { cashId, itemId: r.int(), sn: r.int(), quantity: r.short(), from: r.paddedString(13), expiration: r.long() };
  r.long();
  return it;
}
const lo32 = (v) => Number(BigInt.asIntN(32, BigInt(v ?? 0)));

/** Guild emblem: background, its colour, mark, its colour. */
const readEmblem = (r) => ({ bg: r.short(), bgColor: r.ubyte(), logo: r.short(), logoColor: r.ubyte() });

/** addPetInfo: item id, name, unique id, position, stance, foothold */
function readPet(r) {
  const id = r.int(), name = r.string(), uid = Number(BigInt.asIntN(32, r.long())), pos = r.pos2(), stance = r.ubyte(), fh = r.int();
  return { id, name, uid, x: pos.x, y: pos.y, stance, fh };
}

/** STAT_CHANGED mask bits (client/Stat.java). */
export const STAT = {
  SKIN: 0x1, FACE: 0x2, HAIR: 0x4, LEVEL: 0x10, JOB: 0x20, STR: 0x40, DEX: 0x80, INT: 0x100, LUK: 0x200,
  HP: 0x400, MAXHP: 0x800, MP: 0x1000, MAXMP: 0x2000, AP: 0x4000, SP: 0x8000, EXP: 0x10000, FAME: 0x20000,
  MESO: 0x40000, PET: 0x180008, GACHAEXP: 0x200000,
};
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
  else { box.locked = r.bool(); r.ubyte(); box.players = r.ubyte(); box.max = r.ubyte(); r.ubyte(); }
  return box;
}
/** The stock: per item its bundles left, how many in a bundle, the bundle's price and the item itself. */
function readShopItems(r) {
  return Array.from({ length: r.ubyte() }, () => ({ bundles: r.short(), perBundle: r.short(), price: r.int(), item: readItem(r, false) }));
}
/**
 * ROOM type 5 (getHiredMerchant): your slot, the merchant item, visitors, notes, the owner's name - then, for the
 * owner only, opening time, sales and stored mesos - the title, and the stock (an empty one adds a 0 byte).
 */
function readMerchantRoom(r, selfName) {
  r.ubyte();
  const slot = r.short(), itemId = r.int(); r.string();
  const people = [];
  for (let s = r.ubyte(); s !== 0xFF; s = r.ubyte()) people.push({ slot: s, look: readCharLook(r), name: r.string() });
  for (let n = r.short(); n > 0; n--) { r.string(); r.ubyte(); }
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
  return { merchant: true, itemId, ownerName: owner, slot: mine ? 0 : slot, firstTime, mesos, sold, people, title, items };
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
      const out = { channel, charData: true, info, mapId: info.stats.mapId, portal: info.stats.spawnPoint, hp: info.stats.hp };
      if (!first) this.emit('setField', out);
      return out;
    }
    r.skip(3);
    const out = { channel, charData: false, mapId: r.int(), portal: r.ubyte(), hp: r.short() };
    if (r.bool()) out.pos = { x: r.int(), y: r.int() };
    this.emit('setField', out);
    return out;
  }

  _register() {
    const on = (op, fn) => this.conn.on(op, fn);
    on(S.SET_FIELD, (r) => this._setField(r));
    // ---- the Cash Shop: SET_CASH_SHOP (character info, then the shop's own data), its results, the NX balance
    on(S.SET_CASH_SHOP, (r) => {
      const info = readCharacterInfo(r);
      for (let n = r.short(); n > 0; n--) {                       // new year cards
        r.int(); r.int(); r.string(); r.bool(); r.long(); r.int(); r.string(); r.bool(); r.bool(); r.long(); r.string();
      }
      for (let n = r.short(); n > 0; n--) { r.short(); r.string(); }   // area info
      r.short(); r.ubyte();
      const account = r.string();
      r.int();
      for (let n = r.short(); n > 0; n--) { r.int(); r.int(); r.ubyte(); }   // specials
      r.skip(121);
      const best = [];                                               // most sellers: (tab, gender, SN) until the 11-byte tail
      while (r.available > 11) { r.int(); const j = r.int(), sn = r.int(); if (j === 0 && !best.includes(sn)) best.push(sn); }
      this.emit('cashShopOpen', { info, account, best });
    });
    // MEMO_RESULT 3: notes waiting for you (gift notices and the like): id, sender, text, time, fame
    on(S.MEMO_RESULT, (r) => {
      if (r.ubyte() !== 3) return;
      const notes = [];
      for (let n = r.ubyte(); n > 0; n--) notes.push({ id: r.int(), from: r.string().trim(), text: r.string(), time: r.long(), fame: r.ubyte() });
      this.emit('notes', notes);
    });
    on(S.QUERY_CASH_RESULT, (r) => this.emit('csCash', { credit: r.int(), maplePoint: r.int(), prepaid: r.int() }));
    on(S.CASHSHOP_OPERATION, (r) => {
      const op = r.ubyte(), list = (n) => { const out = []; for (; n > 0; n--) out.push(readCashItem(r)); return out; };
      if (op === 0x4B) this.emit('csInventory', list(r.short()));
      else if (op === 0x4F || op === 0x55) { const sns = []; for (let i = 0; i < 10; i++) sns.push(r.int()); this.emit('csWish', sns.filter(Boolean)); }
      else if (op === 0x57) this.emit('csBought', readCashItem(r));
      else if (op === 0x4D) {                                    // gifts waiting: cash id, item, sender, message
        const gifts = [];
        for (let n = r.short(); n > 0; n--) gifts.push({ cashId: r.long(), itemId: r.int(), from: r.paddedString(13), message: r.paddedString(73), quantity: 1 });
        this.emit('csGifts', gifts);
      } else if (op === 0x5E) this.emit('csGiftSent', { to: r.string(), itemId: r.int(), count: r.short(), price: r.int() });
      else if (op === 0x89) this.emit('csBoughtPackage', list(r.ubyte()));
      else if (op === 0x5C) this.emit('csError', r.ubyte());
      else if (op === 0x68) { const pos = r.short(); this.emit('csTaken', pos, readItem(r, false)); }
      else if (op === 0x6A) this.emit('csPut', readCashItem(r));
      else if (op === 0x60) { const type = r.ubyte(); this.emit('csSlots', 'inventory', r.short(), type); }
      else if (op === 0x62) this.emit('csSlots', 'storage', r.short());
      else if (op === 0x64) this.emit('csSlots', 'character', r.short());
    });

    on(S.STAT_CHANGED, (r) => {
      const enable = r.bool();
      const mask = r.uint();
      const stats = {};
      for (let bit = 1; bit <= 0x200000; bit *= 2) {
        if (!(mask & bit)) continue;
        if (bit === 0x8 || bit === 0x80000 || bit === 0x100000) { r.long(); continue; } // pet uids
        if (bit === 0x1) stats.skin = r.ubyte();
        else if (bit <= 0x4) stats[STAT_KEYS[bit]] = r.int();
        else if (bit < 0x20) stats[STAT_KEYS[bit]] = r.ubyte();
        else if (bit === 0x8000) stats.sp = r.short();
        else if (bit < 0xffff) stats[STAT_KEYS[bit]] = r.short();
        else if (bit === 0x20000) stats.fame = r.short();
        else stats[STAT_KEYS[bit]] = r.int();
      }
      this.emit('stats', stats, enable);
    });

    on(S.SHOW_STATUS_INFO, (r) => {
      const mode = r.ubyte();
      if (mode === 1) { // quest record: status 0 forfeit/removed, 1 started (+progress), 2 completed (+time)
        const id = r.ushort(), status = r.ubyte();
        const data = status === 1 ? r.string() : status === 2 ? r.long() : undefined;
        this.emit('quest', id, status, data);
      } else if (mode === 9) this.emit('notice', { type: 5, msg: r.string() });
      else if (mode === 3) { const white = r.bool(); this.emit('status', { type: 'exp', amount: r.int(), white }); }
      else if (mode === 0) {
        const sub = r.ubyte();
        if (sub === 1) { r.skip(1); this.emit('status', { type: 'meso', amount: r.int() }); }
        else if (sub === 0) { const id = r.int(), qty = r.int(); this.emit('status', { type: 'item', id, qty }); }
      } else if (mode === 4) this.emit('status', { type: 'fame', amount: r.int() });
      else if (mode === 5) this.emit('status', { type: 'meso', amount: r.int() });
    });

    // SERVERMESSAGE: 0 notice, 1 pop-up, 2 Megaphone, 3 Super Megaphone (+ channel, whisper ear), 4 the scrolling
    // header, 5 pink, 6 light blue, 7 an NPC's, 8 Item Megaphone (+ channel, ear, the item), 10 Triple Megaphone
    // (+ more lines, channels, ear)
    on(S.SERVERMESSAGE, (r) => {
      const type = r.ubyte();
      if (type === 4) r.ubyte();
      const n = { type, msg: r.string() };
      try {
        if (type === 3) { n.channel = r.ubyte() + 1; n.ear = r.bool(); }
        else if (type === 8) { n.channel = r.ubyte() + 1; n.ear = r.bool(); if (r.ubyte()) n.item = readItem(r, false); }
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
    on(S.PARCEL, (r) => {
      const op = r.ubyte();
      if (op === 8) {
        r.ubyte();
        const list = [];
        for (let n = r.ubyte(); n > 0; n--) {
          const p = { id: r.int(), sender: r.paddedString(13), mesos: r.int(), sent: r.long() };
          const hasMsg = r.int(); const msg = r.paddedString(200); p.message = hasMsg ? msg : '';
          r.ubyte();
          if (r.ubyte()) p.item = readItem(r, false);
          list.push(p);
        }
        this.emit('duey', { op: 'open', list });
      } else if (op === 0x17 && r.available >= 5) this.emit('duey', { op: 'gone', id: r.int() });
      else if (op === 0x19) this.emit('duey', { op: 'arrived', from: r.string(), quick: r.bool() });
      else if (op === 0x1B) this.emit('duey', { op: 'arrived', quick: r.bool() });
      else this.emit('duey', { op: 'result', code: op });
    });
    // CHALKBOARD: someone holds up a chalkboard (1, its text) or puts it away (0)
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

    on(S.CHATTEXT, (r) => this.emit('chat', { id: r.int(), gm: r.bool(), text: r.string(), show: r.ubyte() }));
    // ---- buddy list (CWvsContext::OnFriendResult)
    const fixed = (r, n) => { const b = r.bytes(n); let s = ''; for (const c of b) { if (!c) break; s += String.fromCharCode(c); } return s; };
    on(S.BUDDYLIST, (r) => {
      const op = r.ubyte();
      if (op === 7) {
        const list = [];
        for (let n = r.ubyte(); n > 0 && r.available >= 39; n--) {
          const id = r.int(), name = fixed(r, 13); r.ubyte();
          const channel = r.int(), group = fixed(r, 13); r.int();
          list.push({ id, name, channel, group });
        }
        this.emit('buddies', list);
      } else if (op === 9) {
        const id = r.int(), name = r.string();
        this.emit('buddyRequest', { id, name });
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
      const member = () => ({ name: r.paddedString(13), job: r.int(), level: r.int(), rank: r.int(), online: r.int() === 1 });
      if (op === 0x01) e('askName');
      else if (op === 0x03) { r.int(); e('agreement', { master: r.string(), name: r.string() }); }
      else if (op === 0x05) e('invite', { id: r.int(), from: r.string() });
      else if (op === 0x1A) {
        if (!r.ubyte()) { e('info', { guild: null }); return; }
        const g = { id: r.int(), name: r.string(), ranks: [r.string(), r.string(), r.string(), r.string(), r.string()] };
        const ids = []; for (let n = r.ubyte(); n > 0; n--) ids.push(r.int());
        g.members = ids.map((id) => { const m = { id, ...member() }; r.int(); r.int(); return m; });
        g.capacity = r.int(); g.emblem = readEmblem(r); g.notice = r.string(); g.gp = r.int(); g.alliance = r.int();
        e('info', { guild: g });
      } else if (op === 0x27) { const gid = r.int(), id = r.int(); e('join', { gid, member: { id, ...member() } }); }
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
      else if (op === 0x49 || op === 0x4C) return;                                   // rank board, GPQ queue
      else e('message', { code: op, name: op >= 53 && op <= 55 && r.available ? r.string() : '' });
    });
    on(S.GUILD_NAME_CHANGED, (r) => this.emit('guildName', r.int(), r.string()));
    on(S.GUILD_MARK_CHANGED, (r) => this.emit('guildMark', r.int(), readEmblem(r)));
    on(S.PARTY_OPERATION, (r) => {
      const op = r.ubyte();
      if (op === 8) this.emit('party', { kind: 'created', id: r.int() });
      else if (op === 4) { const id = r.int(); this.emit('partyInvite', { id, name: r.string() }); }
      else if (op === 7) { const id = r.int(); this.emit('party', { kind: 'update', id, ...partyStatus(r) }); }
      else if (op === 0x0F) { const id = r.int(), name = r.string(); this.emit('party', { kind: 'join', id, name, ...partyStatus(r) }); }
      else if (op === 0x0C) {
        const id = r.int(), target = r.int();
        if (r.ubyte() === 0) this.emit('party', { kind: 'disband', id, target });
        else { const expel = r.ubyte() === 1, name = r.string(); this.emit('party', { kind: expel ? 'expel' : 'leave', id, target, name, ...partyStatus(r) }); }
      } else if (op === 0x1B) this.emit('party', { kind: 'leader', leader: r.int() });
      else if (op === 0x23) { /* mystic door portal */ }
      else this.emit('partyMessage', op, r.available >= 2 ? r.string() : '');
    });
    on(S.UPDATE_PARTYMEMBER_HP, (r) => this.emit('partyHp', r.int(), r.int(), r.int()));
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
      if (op === 0 || op === 7) { const pos = r.ubyte(), look = readCharLook(r); this.emit('messenger', { op: op === 0 ? 'add' : 'update', pos, look, name: r.string(), channel: r.ubyte() }); }
      else if (op === 1) this.emit('messenger', { op: 'join', pos: r.ubyte() });
      else if (op === 2) this.emit('messenger', { op: 'remove', pos: r.ubyte() });
      else if (op === 3) { const from = r.string(); r.ubyte(); this.emit('messenger', { op: 'invite', from, id: r.int() }); }
      else if (op === 4) { const name = r.string(); this.emit('messenger', { op: 'invited', name, ok: r.ubyte() === 1 }); }
      else if (op === 5) this.emit('messenger', { op: 'declined', name: r.string() });
      else if (op === 6) this.emit('messenger', { op: 'chat', text: r.string() });
    });
    // ENTRUSTED_SHOP_CHECK_RESULT: 7 you may open a merchant, 9 Fredrick still holds your goods, 0x10 yours is open in another channel
    on(S.ENTRUSTED_SHOP_CHECK_RESULT, (r) => this.emit('merchantCheck', r.ubyte(), r.available ? r.ubyte() : 0));
    on(S.UPDATE_CHAR_BOX, (r) => { const id = r.int(); this.emit('charBox', id, readBox(r)); });
    // ---- trading and player shops (PLAYER_INTERACTION): the room type the last ROOM opened decides
    // what the shared VISIT / EXIT / CHAT ops mean (3 trade, 4 player shop)
    on(S.PLAYER_INTERACTION, (r) => {
      const op = r.ubyte();
      if ((this.roomType === 4 || this.roomType === 5) && this.shopOp(op, r)) return;
      if (op === 5) {                                     // ROOM
        const type = r.ubyte();
        if (type === 0) {
          const shop = this.roomType === 4 || this.roomType === 5 || this.shopPending;
          this.shopPending = false;
          this.emit(shop ? 'shopError' : 'tradeError', r.ubyte());
          return;
        }
        this.roomType = type; this.shopPending = false;
        if (type === 4) { this.emit('shopOpen', readShopRoom(r)); return; }
        if (type === 5) { this.emit('shopOpen', readMerchantRoom(r, this.selfName)); return; }
        if (type !== 3) return;
        r.ubyte();
        const me = r.ubyte();
        let partner = null, look = null;
        if (me === 1) { r.ubyte(); look = readCharLook(r); partner = r.string(); }
        this.emit('tradeOpen', { slot: me, partner, look });
      } else if (op === 2) {                              // INVITE
        if (r.ubyte() === 3) this.emit('tradeInvite', r.string());
      } else if (op === 4) {                              // VISIT: partner joined
        r.ubyte(); const look = readCharLook(r); this.emit('tradePartner', r.string(), look);
      } else if (op === 0x0F) {                           // SET_ITEMS: 0 yours, 1 partner's
        const side = r.ubyte(), slot = r.ubyte();
        this.emit('tradeItem', side, slot, readItem(r, false));
      } else if (op === 0x10) this.emit('tradeMeso', r.ubyte(), r.int());
      else if (op === 0x11) this.emit('tradeConfirm');
      else if (op === 0x0A) { r.ubyte(); this.emit('tradeEnd', r.available ? r.ubyte() : 2); }
      else if (op === 6 && r.ubyte() === 8) { r.ubyte(); this.emit('tradeChat', r.string()); }
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
    // MULTICHAT mode: 0 buddy, 1 party, 2 guild, 3 alliance
    on(S.MULTICHAT, (r) => this.emit('groupChat', { mode: r.ubyte(), name: r.string(), text: r.string() }));
    // WHISPER (CField::OnWhisper): flags LOCATION 1, WHISPER 2, RESULT 8, RECEIVE 0x10, LOCATION_FRIEND 0x40
    on(S.WHISPER, (r) => {
      const flag = r.ubyte();
      if (flag === 0x12) { this.emit('whisper', { from: r.string(), channel: r.ubyte(), gm: r.bool(), text: r.string() }); return; }
      if (flag === 0x0A) { this.emit('whisperResult', { to: r.string(), ok: r.bool() }); return; }
      if (flag === 0x09 || flag === 0x48) {
        const name = r.string(), type = r.ubyte(), where = r.int();
        this.emit('findResult', { name, type, where });
      }
    });

    on(S.SPAWN_PLAYER, (r) => {
      const id = r.int(), level = r.ubyte(), name = r.string(), guild = r.string(), emblem = readEmblem(r);
      // foreign buffs: fixed layout with optional value after the first mask int
      r.int(); r.short(); r.ubyte(); r.ubyte();
      const morph = r.int();
      const hiMask = r.int();
      let combo = 0;
      if (morph === 2) r.short(); else if (hiMask & 0x200000) combo = r.ubyte(); // morph value / Combo Attack's value (1 + orbs)
      r.int(); r.int(); r.short(); r.skip(4); r.int(); r.skip(11); r.short(); r.skip(9); r.int(); r.short(); r.ubyte();
      r.long(); r.int(); r.skip(8); r.int(); r.ubyte(); r.int(); r.short(); r.skip(9); r.int(); r.int(); r.skip(9); r.int(); r.short(); r.short();
      const job = r.short();
      const look = readCharLook(r);
      r.int(); r.int(); const chair = r.int();
      const pos = r.pos2(); const stance = r.ubyte();
      r.short(); r.ubyte();
      const pets = [];
      while (r.available && r.ubyte() === 1) pets.push({ slot: pets.length, ...readPet(r) });
      let box = null;
      let chalk = null;
      if (r.available >= 13) {
        r.skip(12); box = readBox(r);                               // mount (level / exp / tiredness), then a shop or game sign
        if (r.available && r.ubyte() === 1) chalk = r.string();     // then a chalkboard's text
      }
      this.emit('spawnPlayer', { id, level, name, guild, emblem, job, look, chair, x: pos.x, y: pos.y, stance, pets, box, chalk, combo, hidden: !!(hiMask & 0x400) });
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
      const oid = r.int(), kind = r.int(), owner = r.int(), skill = r.int(), level = r.ubyte(); r.short();
      this.emit('mistSpawn', { oid, kind, owner, skill, level, left: r.int(), top: r.int(), right: r.int(), bottom: r.int() });
    });
    on(S.REMOVE_MIST, (r) => this.emit('mistRemove', r.int()));
    // the field's timer: type 2 counts down from a number of seconds (a party quest, an event, a boat ride)
    on(S.CLOCK, (r) => {
      const type = r.ubyte();
      if (type === 2) this.emit('clock', r.int());
      else if (type === 1) this.emit('fieldClock', r.ubyte(), r.ubyte(), r.ubyte());   // a station's time of day
    });
    // ships: at a station 1 = it is in (docked), 2 = it has gone; on a voyage 10 then 4 / 5 = the Balrog's ship
    // comes / goes
    on(S.CONTI_STATE, (r) => this.emit('ship', r.ubyte() === 1));
    on(S.CONTI_MOVE, (r) => { if (r.ubyte() === 10) this.emit('ship', r.ubyte() === 4); });
    on(S.STOP_CLOCK, () => this.emit('clock', null));
    on(S.REMOVE_DOOR, (r) => { r.ubyte(); this.emit('doorRemove', r.int()); });
    on(S.SPAWN_PORTAL, (r) => { const from = r.int(), to = r.int(); this.emit('townPortal', from, to, r.available >= 4 ? { x: r.short(), y: r.short() } : null); });
    // ---- pets: SPAWN_PET (summon / send home), MOVE_PET, PET_CHAT, PET_COMMAND (0 command answer, 1 food answer)
    on(S.SPAWN_PET, (r) => {
      const owner = r.int(), slot = r.ubyte();
      if (r.ubyte() === 1) { r.ubyte(); this.emit('petSpawn', { owner, slot, ...readPet(r) }); }
      else this.emit('petRemove', owner, slot, r.available ? r.bool() : false);
    });
    on(S.MOVE_PET, (r) => { const owner = r.int(), slot = r.ubyte(); r.int(); this.emit('petMove', owner, slot, readMovement(r)); });
    on(S.PET_CHAT, (r) => { const owner = r.int(), slot = r.ubyte(); r.ubyte(); const act = r.ubyte(); this.emit('petChat', owner, slot, act, r.string()); });
    on(S.PET_COMMAND, (r) => {
      const owner = r.int(), slot = r.ubyte(), type = r.ubyte();
      if (type === 0) { const cmd = r.ubyte(); this.emit('petCommand', owner, slot, cmd, r.bool()); }
      else this.emit('petFood', owner, slot, r.bool());
    });
    on(S.MOVE_PLAYER, (r) => { const id = r.int(); r.int(); this.emit('movePlayer', id, readMovement(r)); });
    on(S.UPDATE_CHAR_LOOK, (r) => { const id = r.int(); r.ubyte(); this.emit('playerLook', id, readCharLook(r)); });
    on(S.FACIAL_EXPRESSION, (r) => this.emit('expression', r.int(), r.int()));

    // addAttackBody: shared by melee / ranged / magic broadcasts
    const readAttack = (kind) => (r) => {
      const id = r.int(), nd = r.ubyte(); r.ubyte();
      const skillLevel = r.ubyte(); const skill = skillLevel ? r.int() : 0;
      const display = r.ubyte(), direction = r.ubyte(), stance = r.ubyte(), speed = r.ubyte(); r.ubyte();
      const projectile = r.int();
      const targets = [];
      for (let i = 0; i < (nd >> 4); i++) {
        const oid = r.int(); r.ubyte();
        // Cosmic sets a critical hit's top bit before passing it on (damage - 2^31)
        const dmg = [], crit = [];
        for (let j = 0; j < (nd & 0xf); j++) { const d = r.int(); dmg.push(d < 0 ? d + 0x80000000 : d); crit.push(d < 0); }
        targets.push({ oid, dmg, crit });
      }
      this.emit('attack', { kind, id, skill, skillLevel, display, direction, stance, speed, projectile, targets });
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
    on(S.UPDATE_SKILLS, (r) => {
      r.ubyte();
      const list = [];
      for (let n = r.short(); n > 0; n--) list.push({ id: r.int(), level: r.int(), master: r.int(), expiration: r.long() });
      this.emit('skills', list);
    });
    on(S.COOLDOWN, (r) => this.emit('cooldown', r.int(), r.short()));
    // GIVE_BUFF: two 64-bit masks, then (short value, int source, int duration) per set bit
    const HB_HP = 0x200000000000n, HB_MP = 0x400000000000n; // BuffStat.HYPERBODYHP / HYPERBODYMP
    const SHARP_EYES = [3121002, 3221002];
    const SPEED = 0x8000000000n, JUMP = 0x10000000000n;   // BuffStat.SPEED / JUMP
    const WATK = 0x100000000n, WDEF = 0x200000000n, MDEF = 0x800000000n, AVOID = 0x2000000000n, ACC = 0x1000000000n, MAPLE_WARRIOR = 0x8n, COMBO = 0x20000000000000n, STANCE = 0x10n;   // BuffStat.WATK / ACC / MAPLE_WARRIOR / COMBO / STANCE
    const popcount = (big) => { let n = 0; for (let v = big; v; v &= v - 1n) n++; return n; };
    on(S.GIVE_BUFF, (r) => {
      const m1 = r.long(), m2 = r.long();
      const n = popcount(BigInt.asUintN(64, m1)) + popcount(BigInt.asUintN(64, m2));
      if (!n) return;
      const start = r.pos;
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
      const known = (id) => id < 0 || this.h.knowsSkill?.(id);
      const pick = !known(normal.source) && known(pirate.source) ? pirate : normal;
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
      if (pick === normal && (mask & (SPEED | JUMP | WATK | ACC | WDEF | MDEF | AVOID))) {
        r.pos = start;
        const values = Array.from({ length: n }, () => { const v = r.short(); r.int(); r.int(); return v; });
        const at = (bit) => popcount(mask & (bit - 1n));   // Cosmic lists the plain stats (WATK..JUMP) first
        if (mask & SPEED) b.speed = values[at(SPEED)];
        if (mask & JUMP) b.jump = values[at(JUMP)];
        if (mask & WATK) b.watk = values[at(WATK)];
        if (mask & ACC) b.acc = values[at(ACC)];
        if (mask & WDEF) b.wdef = values[at(WDEF)];
        if (mask & MDEF) b.mdef = values[at(MDEF)];
        if (mask & AVOID) b.avoid = values[at(AVOID)];
      }
      // Maple Warrior: its one stat is the % added to STR, DEX, INT and LUK
      if (pick === normal && n === 1 && mask === MAPLE_WARRIOR) { r.pos = start; b.mapleWarrior = r.short(); }
      // Combo Attack: its one stat is 1 + the orbs you hold, sent again each time one is gained or spent
      if (pick === normal && n === 1 && mask === COMBO) { r.pos = start; b.combo = r.short(); }
      // Power Stance / Freeze Standing: its one stat is the % chance not to be knocked back
      if (pick === normal && n === 1 && mask === STANCE) { r.pos = start; b.stance = r.short(); }
      // Sharp Eyes' one stat is (critical rate << 8 | critical damage)
      if (pick === normal && SHARP_EYES.includes(normal.source)) { r.pos = start; const v = r.short(); b.sharpEyes = { rate: v >> 8, dmg: v & 0xff }; }
      this.emit('buff', b);
    });
    on(S.CANCEL_BUFF, (r) => this.emit('cancelBuff', r.long(), r.long()));
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
    on(S.SUMMON_ATTACK, (r) => {
      const owner = r.int(), oid = r.int(); r.ubyte();
      const dir = r.ubyte(), n = r.ubyte();
      const hits = Array.from({ length: n }, () => { const mob = r.int(); r.ubyte(); return { mob, dmg: r.int() }; });
      this.emit('summonAttack', owner, oid, dir, hits);
    });
    on(S.DAMAGE_SUMMON, (r) => { const owner = r.int(), oid = r.int(); r.ubyte(); this.emit('summonDamaged', owner, oid, r.int()); });
    on(S.SUMMON_SKILL, (r) => this.emit('summonSkill', r.int(), r.int(), r.ubyte()));
    // SHOW_SCROLL_EFFECT: who, success, cursed (the item was destroyed), Legendary Spirit, White Scroll
    on(S.SHOW_SCROLL_EFFECT, (r) => this.emit('scrollEffect', { id: r.int(), success: r.bool(), cursed: r.bool(), legendary: r.bool(), white: r.bool() }));
    on(S.SHOW_FOREIGN_EFFECT, (r) => {
      const id = r.int(), effect = r.ubyte();
      if (effect === 1 && r.available >= 4) this.emit('foreignSkill', id, r.int());
      else if (effect === 2 && r.available >= 4) this.emit('affected', id, r.int());   // a party buff landed on them
      else if (effect === 0x0a && r.available >= 1) this.emit('healNumber', id, r.ubyte());   // HP they recovered (blue number)
      else if (effect === 0 || effect === 8 || effect === 9) this.emit('foreignEffect', id, effect); // level up / job change / quest clear
    });
    on(S.SKILL_EFFECT, (r) => this.emit('foreignCharge', r.int(), r.int()));   // charging / winding up a skill
    // your own effects; 2 = a party member's buff (Bless, Haste, Holy Symbol...) reached you
    // and 0x0a = HP you recovered (a blue number over you)
    on(S.SHOW_ITEM_GAIN_INCHAT, (r) => {
      const type = r.ubyte();
      if (type === 2 && r.available >= 4) this.emit('affected', null, r.int());
      else if (type === 0x0a && r.available >= 1) this.emit('healNumber', null, r.ubyte());
    });
    // another player's curse (giveForeignDebuff): the masks, then per stat (Poison's value first) the mob skill as
    // short id + short level; an ordinary foreign buff has values and zeros there instead, so the id tells them apart
    on(S.GIVE_FOREIGN_BUFF, (r) => {
      const id = r.int(), m1 = r.long(), m2 = r.long();
      // Dark Sight or Wind Walk: drawn see-through
      if (BigInt.asUintN(64, m2) & 0x40000000000n || BigInt.asUintN(64, m1) & 0x400000000n) { this.emit('foreignHidden', id); return; }
      // Combo Attack alone: its value is 1 + the orbs held
      if (BigInt.asUintN(64, m2) === 0x20000000000000n && BigInt.asUintN(64, m1) === 0n && r.available >= 2) { this.emit('foreignCombo', id, r.short()); return; }
      if (BigInt.asUintN(64, m2) & 0x4000000000000n && r.available >= 2) r.short();   // Disease.POISON's value
      if (r.available < 4) return;
      const src = r.int(), skill = src & 0xffff, level = src >>> 16;
      if (skill >= 100 && skill <= 200 && level > 0 && level < 256) this.emit('foreignDisease', id, { m1, m2, skill, level });
    });
    on(S.CANCEL_FOREIGN_BUFF, (r) => { const id = r.int(); this.emit('foreignCancel', id, r.long(), r.long()); });
    on(S.CANCEL_SKILL_EFFECT, (r) => this.emit('foreignSkillCancel', r.int()));
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
      if (controlMode !== undefined) {
        // encodeTemporary: 4 mask ints (Cosmic writes each int-sized status into both halves,
        // so count ints 0 and 2 only), then 8 bytes per active status
        const masks = [r.uint(), r.uint(), r.uint(), r.uint()];
        let entries = 0; for (const m of [masks[0], masks[2]]) for (let v = m; v; v &= v - 1) entries++;
        // each: value (short), its source skill (int), duration (short); keep the statuses it already has
        const sources = Array.from({ length: entries }, () => { r.short(); const s = r.int(); r.short(); return s; });
        var statuses = entries ? { first: masks[0], second: masks[2], source: sources[0] } : null;
      } else r.skip(16);
      const pos = r.pos2(); const stance = r.ubyte(); r.short(); const fh = r.short();
      // the appearance: an optional summon effect (id, 0, short, +1 byte for 15), then -2 a new spawn / -1 already here
      let appear = r.available ? r.byte() : -1;
      if (appear > 0) { r.byte(); r.short(); if (appear === 15) r.byte(); appear = r.available ? r.byte() : -1; }
      return { oid, id, x: pos.x, y: pos.y, stance, fh, newSpawn: appear === -2, statuses: controlMode !== undefined ? statuses : null };
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
    on(S.SHOW_MONSTER_HP, (r) => this.emit('mobHp', r.int(), r.ubyte()));
    // damage (negative: healed), then - for one other monsters can hurt - its HP and max HP
    on(S.DAMAGE_MONSTER, (r) => {
      const oid = r.int(); r.ubyte(); const dmg = r.int();
      this.emit('mobDamaged', oid, dmg, r.available >= 8 ? r.int() : null, r.available >= 4 ? r.int() : null);
    });
    // the controller's answer: the monster's MP and the skill it may cast next (0 for none)
    // a monster's statuses: two masks (first / second, MonsterStatus), then per status its value (short), the skill
    // behind it (a player skill id, or a monster skill as short id + short level) and a short; all from one skill
    on(S.APPLY_MONSTER_STATUS, (r) => {
      const oid = r.int(); r.long(); const first = r.uint(), second = r.uint();
      const value = r.short(), source = r.int();
      this.emit('mobStatus', oid, { first, second, source, value });
    });
    on(S.CANCEL_MONSTER_STATUS, (r) => { const oid = r.int(); r.long(); this.emit('mobStatusCancel', oid, r.uint(), r.uint()); });
    on(S.MOVE_MONSTER_RESPONSE, (r) => {
      const oid = r.int(); r.short(); r.bool(); r.short(); const skill = r.ubyte(), level = r.ubyte();   // the flag is aggro, not skills
      this.emit('mobSkillOffer', oid, skill, level);
    });

    // Cosmic sends f != 1 in the direction byte; the client mirrors the art only when it is 0
    const readNpc = (r) => ({ oid: r.int(), id: r.int(), x: r.short(), y: r.short(), facingRight: !r.bool(), fh: r.short(), rx0: r.short(), rx1: r.short() });
    on(S.SPAWN_NPC, (r) => this.emit('spawnNpc', readNpc(r)));
    on(S.SPAWN_NPC_REQUEST_CONTROLLER, (r) => {
      if (r.ubyte() === 0) { this.emit('removeNpc', r.int()); return; }
      this.emit('spawnNpc', readNpc(r));
    });
    on(S.REMOVE_NPC, (r) => this.emit('removeNpc', r.int()));
    on(S.NPC_ACTION, () => {});

    on(S.DROP_ITEM_FROM_MAPOBJECT, (r) => {
      const mode = r.ubyte(), oid = r.int(), meso = r.bool(), id = r.int(), owner = r.int(), type = r.ubyte();
      const to = r.pos2(); const dropper = r.int();
      const d = { mode, oid, meso, id, owner, type, x: to.x, y: to.y, dropper };
      if (mode !== 2) { const from = r.pos2(); d.fromX = from.x; d.fromY = from.y; d.delay = r.short(); }
      this.emit('drop', d);
    });
    // reactors: spawn (oid, id, state, position, facing), hit (oid, new state, position, stance), destroy (oid, state)
    on(S.REACTOR_SPAWN, (r) => { const oid = r.int(), id = r.int(), state = r.byte(), pos = r.pos2(); this.emit('reactorSpawn', { oid, id, state, x: pos.x, y: pos.y }); });
    on(S.REACTOR_HIT, (r) => { const oid = r.int(), state = r.byte(), pos = r.pos2(), stance = r.available ? r.ubyte() : 0; this.emit('reactorHit', { oid, state, x: pos.x, y: pos.y, stance }); });
    on(S.REACTOR_DESTROY, (r) => { const oid = r.int(), state = r.byte(); this.emit('reactorDestroy', { oid, state }); });
    on(S.REMOVE_ITEM_FROM_MAP, (r) => {
      const anim = r.ubyte(), oid = r.int(), chr = anim >= 2 ? r.int() : 0;
      this.emit('removeDrop', oid, anim, chr, anim === 5 && r.available ? r.ubyte() : -1);   // 5: a pet picked it up
    });

    on(S.INVENTORY_OPERATION, (r) => {
      const tick = r.bool(); const n = r.ubyte(); const ops = [];
      for (let i = 0; i < n; i++) {
        const mode = r.ubyte(), inv = r.ubyte(), pos = r.short();
        const op = { mode, inv, pos };
        if (mode === 0) op.item = readItem(r, false);
        else if (mode === 1) op.quantity = r.short();
        else if (mode === 2) op.to = r.short();
        ops.push(op);
      }
      this.emit('inventory', ops, tick);
    });

    on(S.NPC_TALK, (r) => {
      r.ubyte();
      const npc = r.int(), type = r.ubyte(), speaker = r.ubyte(), text = r.string();
      const d = { npc, type, speaker, text };
      if (type === 0) { d.prev = r.ubyte() === 1; d.next = r.ubyte() === 1; }
      else if (type === 2) { d.def = r.string(); r.int(); }
      else if (type === 3) { d.def = r.int(); d.min = r.int(); d.max = r.int(); }
      else if (type === 7) { d.styles = []; for (let k = r.ubyte(); k > 0; k--) d.styles.push(r.int()); }
      this.emit('npcTalk', d);
    });

    on(S.OPEN_NPC_SHOP, (r) => {
      const npc = r.int(); const items = [];
      for (let n = r.short(); n > 0; n--) {
        const it = { id: r.int(), price: r.int() }; r.int(); r.int(); r.int();
        it.recharge = Math.floor(it.id / 10000) === 207 || Math.floor(it.id / 10000) === 233;
        if (it.recharge) { r.short(); r.int(); it.unitPrice = r.ushort(); it.slotMax = r.short(); }
        else { r.short(); it.buyable = r.short(); }
        items.push(it);
      }
      this.emit('shop', { npc, items });
    });
    on(S.CONFIRM_SHOP_TRANSACTION, (r) => this.emit('shopResult', r.ubyte()));
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

    on(S.UPDATE_QUEST_INFO, (r) => {
      const mode = r.ubyte();
      if (mode === 8) { const id = r.ushort(), npc = r.int(); this.emit('questResult', { ok: true, id, npc, next: r.available >= 2 ? r.ushort() : 0 }); }
      else if (mode === 6 || mode === 7) { r.short(); this.emit('questTimer', r.ushort(), mode === 6 ? r.int() : 0); }
      else this.emit('questResult', { ok: false, mode, id: r.available >= 2 ? r.ushort() : 0 });
    });

    on(S.FIELD_EFFECT, (r) => {
      const t = r.ubyte();
      // 5: boss HP gauge (oid, hp, maxHp, tag colour, tag background colour)
      if (t === 5) { this.emit('bossHp', { oid: r.int(), hp: r.int(), maxHp: r.int(), tag: r.ubyte(), bg: r.ubyte() }); return; }
      this.emit('fieldEffect', t, r.available ? r.string() : '');
    });
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
  moveMob(oid, start, moves, activity = -1, skill = 0, level = 0) {
    const w = new PacketWriter(C.MOVE_LIFE).int(oid).short(this.moveId++ & 0x7fff)
      .byte(0).byte(activity).byte(skill).byte(level).short(0).zero(8).byte(0).int(0).pos(start);
    writeMovement(w, moves);
    this.send(w);
  }

  /**
   * Attack packets (AbstractDealDamageHandler.parseDamage). kind: melee | ranged | magic.
   * targets: [{oid, x, y, dmg:[...]}]; stance = body action id; facingLeft -> direction bit.
   */
  attack(kind, { targets, lines, display = 0, stance, facingLeft, speed = 4, skill = 0, charge = 0 }) {
    const op = kind === 'ranged' ? C.RANGED_ATTACK : kind === 'magic' ? C.MAGIC_ATTACK : C.CLOSE_RANGE_ATTACK;
    const w = new PacketWriter(op).byte(0).byte((targets.length << 4) | lines).int(skill);
    if (CHARGE_SKILLS.has(skill)) w.int(charge); // keydown skills carry how long they were held (ms)
    w.zero(8).byte(display).byte(facingLeft ? 0x80 : 0).byte(stance);
    if (kind === 'ranged') {
      w.byte(0).byte(speed).byte(0).byte(facingLeft ? 0x80 : 0).zero(7);
      if ([3121004, 3221001, 5221004, 13111002].includes(skill)) w.int(charge); // Hurricane / Rapid Fire, Piercing's charge (ms)
    } else {
      w.byte(0).byte(speed).zero(4);
    }
    for (const t of targets) {
      w.int(t.oid).zero(4).pos(t).pos(t).short(0);
      for (const d of t.dmg) w.int(d);
      w.int(0); // per-target trailer (mob CRC in the real client); parseDamage skips 4 bytes per target
    }
    if (skill === 14111006) w.int(0).pos({ x: 0, y: 0 }); // Poison Bomb: position
    this.send(w);
  }
  closeRangeAttack(o) { this.attack('melee', o); }

  /** SPECIAL_MOVE: buffs and other non-attack skills. pos is sent for summons / doors. */
  specialMove(skillId, level, pos) {
    const w = new PacketWriter(C.SPECIAL_MOVE).int(Date.now() | 0).int(skillId).byte(level);
    if (pos) w.pos(pos).byte(0);
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

  /** DAMAGE_REACTOR: an attack reached it. stance: 0/1 in the air facing left/right, 2/3 on the ground. */
  damageReactor(oid, charPos, stance, skill = 0) {
    this.send(new PacketWriter(C.DAMAGE_REACTOR).int(oid).int(charPos).short(stance).int(0).int(skill));
  }
  /** TOUCHING_REACTOR: walked onto (true) or off (false) a reactor set off by touch. */
  touchReactor(oid, touching) { this.send(new PacketWriter(C.TOUCHING_REACTOR).int(oid).byte(touching ? 1 : 0)); }
  takeDamage({ damage, mobId, oid, direction = 0, from = -1 }) {
    this.send(new PacketWriter(C.TAKE_DAMAGE).int(Date.now() | 0).byte(from).byte(0).int(damage).int(mobId).int(oid).byte(direction));
  }

  chat(text) { this.send(new PacketWriter(C.GENERAL_CHAT).string(text).byte(0)); }
  /** FACE_EXPRESSION: 1 hit .. 7 stunned (F1-F7); higher ones need their cash emotion item */
  faceExpression(emote) { this.send(new PacketWriter(C.FACE_EXPRESSION).int(emote)); }
  /** type: 0 buddy (recipients = buddy ids), 1 party, 2 guild, 3 alliance */
  groupChat(type, text, recipients = []) {
    const w = new PacketWriter(C.MULTI_CHAT).byte(type).byte(recipients.length);
    for (const id of recipients) w.int(id);
    this.send(w.string(text));
  }
  whisper(name, text) { this.send(new PacketWriter(C.WHISPER).byte(0x06).string(name).string(text)); }
  find(name) { this.send(new PacketWriter(C.WHISPER).byte(0x05).string(name)); }
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
  /** Player shop room ops (Cosmic PlayerShop / PacketCreator.getPlayerShop*). Returns whether it was one. */
  shopOp(op, r) {
    if (op === 0x19) { const mesos = this.roomType === 5 ? r.int() : undefined; this.emit('shopItems', readShopItems(r), mesos); return true; }   // UPDATE_MERCHANT: (mesos) the stock
    if (op === 0x2A) { this.roomType = 0; this.emit('shopClosed', 0); return true; }           // REAL_CLOSE_MERCHANT: the owner's room closed
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
  /** CREATE type 4 (a Shop Permit) or 5 (a Hired Merchant): the title and the item that opens it */
  pshopCreate(title, itemId, type = 4) { this.shopPending = true; this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0).byte(type).string(title).byte(0).short(0).int(itemId)); }
  pshopVisit(oid) { this.shopPending = true; this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(4).int(oid)); }
  pshopOpenStore() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0B).byte(1)); }
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
   * Item: text, ear, an item or not (inventory type, slot); Triple: line count, lines, ear; Avatar (539): four lines, ear
   */
  useMegaphone(slot, itemId, { text = '', lines = null, ear = false, item = null } = {}) {
    const w = new PacketWriter(C.USE_CASH_ITEM).short(slot).int(itemId), kind = Math.floor(itemId / 1000) % 10;
    if (Math.floor(itemId / 10000) === 539) { for (let i = 0; i < 4; i++) w.string(lines?.[i] || ''); w.byte(ear ? 1 : 0); }
    else if (kind === 1) w.string(text);
    else if (kind === 2) w.string(text).byte(ear ? 1 : 0);
    else if (kind === 6) { w.string(text).byte(ear ? 1 : 0).byte(item ? 1 : 0); if (item) w.int(item.tab).int(item.slot); }
    else if (kind === 7) { const ls = (lines || [text]).filter(Boolean).slice(0, 3); w.byte(ls.length); for (const l of ls) w.string(l); w.byte(ear ? 1 : 0); }
    this.send(w);
  }
  /** SPOUSE_CHAT: to your husband or wife (the server finds them; the first string is ignored) */
  spouseChat(text) { this.send(new PacketWriter(C.SPOUSE_CHAT).string('').string(text)); }
  /** DUEY_ACTION: 2 send (an item and / or mesos to a character), 4 take a parcel, 5 delete one, 7 close Duey */
  dueySend({ tab = 0, slot = 0, qty = 0, mesos = 0, to }) {
    this.send(new PacketWriter(C.DUEY_ACTION).byte(2).byte(tab).short(slot).short(qty).int(mesos).string(to).byte(0));
  }
  dueyTake(id) { this.send(new PacketWriter(C.DUEY_ACTION).byte(4).int(id)); }
  dueyDelete(id) { this.send(new PacketWriter(C.DUEY_ACTION).byte(5).int(id)); }
  dueyClose() { this.send(new PacketWriter(C.DUEY_ACTION).byte(7)); }
  /** A Chalkboard (537xxxx): its text; CLOSE_CHALKBOARD puts it away. */
  useChalkboard(slot, itemId, text) { this.send(new PacketWriter(C.USE_CASH_ITEM).short(slot).int(itemId).string(text)); }
  closeChalkboard() { this.send(new PacketWriter(C.CLOSE_CHALKBOARD)); }
  /** TROCK_ADD_MAP: 1 save the map you are in, 0 delete one; for the VIP list or the regular one */
  rockSave(vip) { this.send(new PacketWriter(C.TROCK_ADD_MAP).byte(1).byte(vip ? 1 : 0)); }
  rockDelete(vip, mapId) { this.send(new PacketWriter(C.TROCK_ADD_MAP).byte(0).byte(vip ? 1 : 0).int(mapId)); }
  /** USE_CASH_ITEM for a Teleport Rock (504xxxx): 0 then a map, or 1 then a character to chase (VIP rocks only) */
  useRock(slot, itemId, { mapId, name }) {
    const w = new PacketWriter(C.USE_CASH_ITEM).short(slot).int(itemId);
    if (name) w.byte(1).string(name); else w.byte(0).int(mapId);
    this.send(w);
  }
  /** MESSENGER: 0 open one (id 0) or accept an invitation (its id), 2 leave, 3 invite, 5 decline, 6 chat ("name : text") */
  messengerJoin(id = 0) { this.send(new PacketWriter(C.MESSENGER).byte(0).int(id)); }
  messengerLeave() { this.send(new PacketWriter(C.MESSENGER).byte(2)); }
  messengerInvite(name) { this.send(new PacketWriter(C.MESSENGER).byte(3).string(name)); }
  messengerDecline(from) { this.send(new PacketWriter(C.MESSENGER).byte(5).string(from)); }
  messengerChat(text) { this.send(new PacketWriter(C.MESSENGER).byte(6).string(text)); }
  merchantRequest() { this.send(new PacketWriter(C.HIRED_MERCHANT_REQUEST)); }
  merchantTakeBack(index) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x26).short(index)); }
  merchantOrganize() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x28)); }
  merchantClose() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x29)); }
  merchantLeave() { this.roomType = 0; this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x27)); }
  /** PLAYER_INTERACTION: 0 create (type 3 = trade), 2 invite, 3 decline, 4 visit, 6 chat, 0xA exit, 0xF item, 0x10 meso, 0x11 confirm */
  tradeStart(cid) {
    this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0).byte(3));
    this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(2).int(cid));
  }
  tradeAccept() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(4).int(0)); }
  tradeDecline() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(3)); }
  tradeItem(tab, pos, qty, slot) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0F).byte(tab).short(pos).short(qty).byte(slot)); }
  tradeMeso(v) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x10).int(v)); }
  tradeConfirm() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x11)); }
  tradeChat(text) { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(6).string(text)); }
  tradeExit() { this.send(new PacketWriter(C.PLAYER_INTERACTION).byte(0x0A)); }
  charInfo(cid) { this.send(new PacketWriter(C.CHAR_INFO_REQUEST).int(Date.now() | 0).int(cid)); }
  /** GUILD_OPERATION: 2 create, 5 invite, 6 join, 7 leave, 8 expel, 0xD rank titles, 0xE rank, 0xF emblem, 0x10 notice, 0x1E agree */
  guildOp(op, ...args) {
    const w = new PacketWriter(C.GUILD_OPERATION).byte(op);
    for (const a of args) if (typeof a === 'string') w.string(a); else w.int(a);
    this.send(w);
  }
  guildRank(cid, rank) { this.send(new PacketWriter(C.GUILD_OPERATION).byte(0x0E).int(cid).byte(rank)); }
  guildEmblem(e) { this.send(new PacketWriter(C.GUILD_OPERATION).byte(0x0F).short(e.bg).byte(e.bgColor).short(e.logo).byte(e.logoColor)); }
  guildAgree(ok) { this.send(new PacketWriter(C.GUILD_OPERATION).byte(0x1E).int(0).byte(ok ? 1 : 0)); }
  guildDeny(from) { this.send(new PacketWriter(C.DENY_GUILD_REQUEST).byte(0).string(from)); }
  /** PARTY_SEARCH_START: level range, how many members, the job bits; PARTY_SEARCH_UPDATE ends the search */
  partySearchStart(min, max, members, jobs) { this.send(new PacketWriter(C.PARTY_SEARCH_START).int(min).int(max).int(members).int(jobs)); }
  partySearchStop() { this.send(new PacketWriter(C.PARTY_SEARCH_UPDATE)); }
  partyDeny(name) { this.send(new PacketWriter(C.DENY_PARTY_REQUEST).byte(0).string(name)); }
  pickup(oid, pos) { this.send(new PacketWriter(C.ITEM_PICKUP).int(Date.now() | 0).byte(0).pos(pos).int(oid)); }
  /** The Cash Shop: entering is a bare ENTER_CASHSHOP, leaving a bare CHANGE_MAP (the server answers with a channel change) */
  enterCashShop() { this.send(new PacketWriter(C.ENTER_CASHSHOP)); }
  leaveCashShop() { this.send(new PacketWriter(C.CHANGE_MAP)); }
  checkCash() { this.send(new PacketWriter(C.CHECK_CASH)); }
  /**
   * CASHSHOP_OPERATION buys (wallet 1 NX credit / 2 maple points / 4 prepaid): 3 an item, 0x1E a package (910xxxx),
   * 6 inventory slots (9111000-9114000), 7 storage slots (9110000), 8 a character slot (543xxxx).
   * Then 5 wish list, 0xD take out, 0xE put in.
   */
  csBuy(wallet, sn, itemId) {
    const k = Math.floor(itemId / 10000), w = new PacketWriter(C.CASHSHOP_OPERATION);
    if (k === 911) w.byte(itemId === 9110000 ? 7 : 6).byte(0).int(wallet).byte(1).int(sn);
    else if (k === 543) w.byte(8).byte(0).int(wallet).int(sn);
    else w.byte(k === 910 ? 0x1E : 3).byte(0).int(wallet).int(sn);
    this.send(w);
  }
  /** A gift: paid from NX Prepaid, confirmed with the account's birthday (YYYYMMDD) */
  csGift(birthday, sn, to, message) { this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(4).int(birthday).int(sn).string(to).string(message)); }
  /** NOTE_ACTION 1: discard read notes (count, then each id with a 0 fame byte) */
  discardNotes(ids) { const w = new PacketWriter(C.NOTE_ACTION).byte(1).byte(ids.length).byte(0).byte(0); for (const id of ids) w.int(id).byte(0); this.send(w); }
  csWish(sns) { const w = new PacketWriter(C.CASHSHOP_OPERATION).byte(5); for (let i = 0; i < 10; i++) w.int(sns[i] || 0); this.send(w); }
  csTake(cashId, type) { this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(0x0D).int(lo32(cashId)).int(0).byte(type).short(0)); }
  csPut(cashId, type) { this.send(new PacketWriter(C.CASHSHOP_OPERATION).byte(0x0E).int(lo32(cashId)).int(0).byte(type)); }
  enterPortal(name) { this.send(new PacketWriter(C.CHANGE_MAP).byte(0).int(-1).string(name).byte(0).byte(0).byte(0)); }
  scriptPortal(name) { this.send(new PacketWriter(C.CHANGE_MAP_SPECIAL).byte(0).string(name).short(0)); }
  innerPortal(name, from, to) { this.send(new PacketWriter(C.USE_INNER_PORTAL).byte(0).string(name).pos(from).pos(to)); }
  respawn() { this.send(new PacketWriter(C.CHANGE_MAP).byte(1).int(0).string('').byte(0).byte(0).byte(0)); }
  npcTalk(oid, pos) { this.send(new PacketWriter(C.NPC_TALK).int(oid).pos(pos)); }
  /** action: 1 next/yes/ok, 0 back/no, -1 end. selection for menus / numbers. */
  npcReply(lastType, action, selection) {
    const w = new PacketWriter(C.NPC_TALK_MORE).byte(lastType).byte(action);
    if (typeof selection === 'string') w.string(selection);
    else if (selection !== undefined && selection !== null) w.int(selection);
    this.send(w);
  }
  distributeAp(stat) { this.send(new PacketWriter(C.DISTRIBUTE_AP).int(Date.now() | 0).int(stat)); }
  distributeSp(skillId) { this.send(new PacketWriter(C.DISTRIBUTE_SP).int(Date.now() | 0).int(skillId)); }
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
  summonAttack(s, hits, delay) {
    const w = new PacketWriter(C.SUMMON_ATTACK).int(s.oid).int(Date.now() | 0).byte(s.facingRight ? 0 : 4).byte(hits.length);
    const sx = Math.round(s.x), sy = Math.round(s.y);
    w.short(sx).short(sy).short(sx).short(sy);
    for (const { mob, dmg } of hits) {
      const at = { x: Math.round(mob.x), y: Math.round(mob.y) };
      w.int(mob.oid).int(Number(mob.spawn?.id) || 0).int(0).pos(at).pos(at).short(delay).int(dmg);
    }
    this.send(w);
  }
  /** USE_UPGRADE_SCROLL: the scroll's USE slot, the equip's slot (negative = worn), 2 = also use a White Scroll */
  useScroll(scrollSlot, equipSlot, white) { this.send(new PacketWriter(C.USE_UPGRADE_SCROLL).int(Date.now() | 0).short(scrollSlot).short(equipSlot).short(white ? 2 : 0)); }
  moveItem(inv, from, to, qty = 1) { this.send(new PacketWriter(C.ITEM_MOVE).int(Date.now() | 0).byte(inv).short(from).short(to).short(qty)); }
  healOverTime(hp, mp) { this.send(new PacketWriter(C.HEAL_OVER_TIME).zero(8).short(hp).short(mp).byte(0)); }
  changeChannel(ch) { this.send(new PacketWriter(C.CHANGE_CHANNEL).byte(ch).int(Date.now() | 0)); }
  /** QUEST_ACTION: 1 start, 2 complete, 3 forfeit, 4 scripted start, 5 scripted end. */
  questAction(action, questId, npcId, pos, selection) {
    const w = new PacketWriter(C.QUEST_ACTION).byte(action).short(questId);
    if (action !== 3) {
      w.int(npcId);
      if (pos) w.pos(pos);
      if (action === 2 && selection !== undefined) w.short(selection);
    }
    this.send(w);
  }
  shopRecharge(slot) { this.send(new PacketWriter(C.NPC_SHOP).byte(2).short(slot)); }

  shopBuy(slot, id, qty) { this.send(new PacketWriter(C.NPC_SHOP).byte(0).short(slot).int(id).short(qty)); }
  shopSell(slot, id, qty) { this.send(new PacketWriter(C.NPC_SHOP).byte(1).short(slot).int(id).short(qty)); }
  shopClose() { this.send(new PacketWriter(C.NPC_SHOP).byte(3)); }
  /** STORAGE: 4 take out (type, index), 5 store (slot, id, qty), 6 arrange, 7 mesos (+ out / - in), 8 close */
  /** pets: summon / send home toggles by cash-inventory slot; ids are the pet's unique id (low 32 bits) */
  spawnPet(slot) { this.send(new PacketWriter(C.SPAWN_PET).int(Date.now() | 0).byte(slot).byte(0).byte(0)); }
  movePet(uid, start, moves) { const w = new PacketWriter(C.MOVE_PET).int(uid).pos(start).int(0); writeMovement(w, moves); this.send(w); }
  petCommand(uid, cmd) { this.send(new PacketWriter(C.PET_COMMAND).int(uid).int(0).byte(0).byte(cmd)); }
  petFood(slot, id) { this.send(new PacketWriter(C.PET_FOOD).int(Date.now() | 0).short(slot).int(id)); }
  petLoot(uid, oid, x, y) { this.send(new PacketWriter(C.PET_LOOT).int(uid).byte(0).int(0).pos({ x, y }).int(0).int(oid)); }
  dropMeso(v) { this.send(new PacketWriter(C.MESO_DROP).int(Date.now() | 0).int(v)); }
  storageTakeOut(type, slot) { this.send(new PacketWriter(C.STORAGE).byte(4).byte(type).byte(slot)); }
  storageStore(pos, id, qty) { this.send(new PacketWriter(C.STORAGE).byte(5).short(pos).int(id).short(qty)); }
  storageArrange() { this.send(new PacketWriter(C.STORAGE).byte(6)); }
  storageMeso(v) { this.send(new PacketWriter(C.STORAGE).byte(7).int(v)); }
  storageClose() { this.send(new PacketWriter(C.STORAGE).byte(8)); }
}
