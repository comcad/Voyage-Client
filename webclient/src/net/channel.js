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

    on(S.SERVERMESSAGE, (r) => {
      const type = r.ubyte();
      if (type === 4) r.ubyte();
      const msg = r.string();
      this.emit('notice', { type, msg });
    });

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
    // ---- trading (PLAYER_INTERACTION; only the trade room's sub-ops are read here)
    on(S.PLAYER_INTERACTION, (r) => {
      const op = r.ubyte();
      if (op === 5) {                                     // ROOM
        const type = r.ubyte();
        if (type === 0) { this.emit('tradeError', r.ubyte()); return; }
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
    // CHAR_INFO: id, level, job, fame, married, guild, alliance (pets, mount, wish list, book... follow)
    on(S.CHAR_INFO, (r) => this.emit('charInfo', { id: r.int(), level: r.ubyte(), job: r.short(), fame: r.short(), married: r.bool(), guild: r.string(), alliance: r.string() }));
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
      if (morph === 2) r.short(); else if (hiMask & 0x200000) r.ubyte(); // morph value / combo count
      r.int(); r.int(); r.short(); r.skip(4); r.int(); r.skip(11); r.short(); r.skip(9); r.int(); r.short(); r.ubyte();
      r.long(); r.int(); r.skip(8); r.int(); r.ubyte(); r.int(); r.short(); r.skip(9); r.int(); r.int(); r.skip(9); r.int(); r.short(); r.short();
      const job = r.short();
      const look = readCharLook(r);
      r.int(); r.int(); const chair = r.int();
      const pos = r.pos2(); const stance = r.ubyte();
      r.short(); r.ubyte();
      const pets = [];
      while (r.available && r.ubyte() === 1) pets.push({ slot: pets.length, ...readPet(r) });
      this.emit('spawnPlayer', { id, level, name, guild, emblem, job, look, chair, x: pos.x, y: pos.y, stance, pets });
    });
    on(S.REMOVE_PLAYER_FROM_MAP, (r) => this.emit('removePlayer', r.int()));
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
        const dmg = []; for (let j = 0; j < (nd & 0xf); j++) dmg.push(r.int());
        targets.push({ oid, dmg });
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
    const popcount = (big) => { let n = 0; for (let v = big; v; v &= v - 1n) n++; return n; };
    on(S.GIVE_BUFF, (r) => {
      const m1 = r.long(), m2 = r.long();
      const n = popcount(BigInt.asUintN(64, m1)) + popcount(BigInt.asUintN(64, m2));
      if (!n) return;
      const start = r.pos;
      // giveBuff: per stat (short value, int source, int duration ms)
      r.pos = start + 2;
      const normal = { source: r.int(), duration: r.int() };
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
      this.emit('buff', b);
    });
    on(S.CANCEL_BUFF, (r) => this.emit('cancelBuff', r.long(), r.long()));
    on(S.SHOW_FOREIGN_EFFECT, (r) => {
      const id = r.int(), effect = r.ubyte();
      if (effect === 1 && r.available >= 4) this.emit('foreignSkill', id, r.int());
      else if (effect === 0 || effect === 8 || effect === 9) this.emit('foreignEffect', id, effect); // level up / job change / quest clear
    });
    on(S.SKILL_EFFECT, (r) => this.emit('foreignSkill', r.int(), r.int()));
    on(S.GIVE_FOREIGN_BUFF, () => {});
    on(S.CANCEL_FOREIGN_BUFF, () => {});
    on(S.CANCEL_SKILL_EFFECT, () => {});
    on(S.DAMAGE_PLAYER, (r) => {
      const id = r.int(), from = r.byte();
      if (from === -3) r.int();
      const damage = r.int();
      let mobId = 0, direction = 0;
      if (from !== -4) { mobId = r.int(); direction = r.ubyte(); }
      this.emit('playerDamaged', { id, from, damage, mobId, direction });
    });

    const readMob = (r, controlMode) => {
      const oid = r.int(); r.ubyte(); const id = r.int();
      if (controlMode !== undefined) {
        // encodeTemporary: 4 mask ints (Cosmic writes each int-sized status into both halves,
        // so count ints 0 and 2 only), then 8 bytes per active status
        const masks = [r.uint(), r.uint(), r.uint(), r.uint()];
        let entries = 0; for (const m of [masks[0], masks[2]]) for (let v = m; v; v &= v - 1) entries++;
        r.skip(entries * 8);
      } else r.skip(16);
      const pos = r.pos2(); const stance = r.ubyte(); r.short(); const fh = r.short();
      return { oid, id, x: pos.x, y: pos.y, stance, fh };
    };
    on(S.SPAWN_MONSTER, (r) => this.emit('spawnMob', readMob(r)));
    on(S.SPAWN_MONSTER_CONTROL, (r) => {
      const mode = r.ubyte();
      if (mode === 0) { this.emit('stopControl', r.int()); return; }
      this.emit('controlMob', readMob(r, mode), mode === 2);
    });
    on(S.MOVE_MONSTER, (r) => {
      const oid = r.int(); r.ubyte(); r.bool(); const act = r.byte(); r.skip(3 + 2);
      const start = r.pos2();
      this.emit('moveMob', oid, start, readMovement(r), act);
    });
    on(S.KILL_MONSTER, (r) => this.emit('killMob', r.int(), r.ubyte()));
    on(S.SHOW_MONSTER_HP, (r) => this.emit('mobHp', r.int(), r.ubyte()));
    on(S.DAMAGE_MONSTER, (r) => { const oid = r.int(); r.ubyte(); this.emit('mobDamaged', oid, r.int()); });
    on(S.MOVE_MONSTER_RESPONSE, () => {});

    const readNpc = (r) => ({ oid: r.int(), id: r.int(), x: r.short(), y: r.short(), facingRight: r.bool(), fh: r.short(), rx0: r.short(), rx1: r.short() });
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

  moveMob(oid, start, moves, activity = -1) {
    const w = new PacketWriter(C.MOVE_LIFE).int(oid).short(this.moveId++ & 0x7fff)
      .byte(0).byte(activity).byte(0).byte(0).short(0).zero(8).byte(0).int(0).pos(start);
    writeMovement(w, moves);
    this.send(w);
  }

  /**
   * Attack packets (AbstractDealDamageHandler.parseDamage). kind: melee | ranged | magic.
   * targets: [{oid, x, y, dmg:[...]}]; stance = body action id; facingLeft -> direction bit.
   */
  attack(kind, { targets, lines, display = 0, stance, facingLeft, speed = 4, skill = 0 }) {
    const op = kind === 'ranged' ? C.RANGED_ATTACK : kind === 'magic' ? C.MAGIC_ATTACK : C.CLOSE_RANGE_ATTACK;
    const w = new PacketWriter(op).byte(0).byte((targets.length << 4) | lines).int(skill);
    if (CHARGE_SKILLS.has(skill)) w.int(0); // keydown skills carry a charge value
    w.zero(8).byte(display).byte(facingLeft ? 0x80 : 0).byte(stance);
    if (kind === 'ranged') {
      w.byte(0).byte(speed).byte(0).byte(facingLeft ? 0x80 : 0).zero(7);
      if ([3121004, 3221001, 5221004, 13111002].includes(skill)) w.zero(4); // Hurricane / Piercing / Rapid Fire
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
  cancelBuff(skillId) { this.send(new PacketWriter(C.CANCEL_BUFF).int(skillId)); }
  /** changes: [{key, type, action}] (type 0 clears the key) */
  changeKeymap(changes) {
    const w = new PacketWriter(C.CHANGE_KEYMAP).int(0).int(changes.length);
    for (const c of changes) w.int(c.key).byte(c.type).int(c.action);
    this.send(w);
  }

  takeDamage({ damage, mobId, oid, direction = 0, from = -1 }) {
    this.send(new PacketWriter(C.TAKE_DAMAGE).int(Date.now() | 0).byte(from).byte(0).int(damage).int(mobId).int(oid).byte(direction));
  }

  chat(text) { this.send(new PacketWriter(C.GENERAL_CHAT).string(text).byte(0)); }
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
