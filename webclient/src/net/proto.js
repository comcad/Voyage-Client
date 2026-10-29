/**
 * Decoders for Cosmic's composite structures (tools/PacketCreator.java).
 * Each function mirrors the writer of the same name on the server.
 */

export function readCharStats(r) {
  const s = {
    id: r.int(), name: r.paddedString(13), gender: r.ubyte(), skin: r.ubyte(), face: r.int(), hair: r.int(),
  };
  s.pets = [r.long(), r.long(), r.long()];
  s.level = r.ubyte(); s.job = r.short();
  s.str = r.short(); s.dex = r.short(); s.int = r.short(); s.luk = r.short();
  s.hp = r.short(); s.maxHp = r.short(); s.mp = r.short(); s.maxMp = r.short();
  s.ap = r.short();
  if (hasSpTable(s.job)) {
    const n = r.ubyte(); s.spTable = [];
    for (let i = 0; i < n; i++) s.spTable.push([r.ubyte(), r.ubyte()]);
    s.sp = 0;
  } else s.sp = r.short();
  s.exp = r.int(); s.fame = r.short(); s.gachaExp = r.int();
  s.mapId = r.int(); s.spawnPoint = r.ubyte();
  r.int();
  return s;
}

/** Evan jobs (2001, 2200-2218) send per-job SP. */
export const hasSpTable = (job) => job === 2001 || (job >= 2200 && job <= 2218);

export function readCharLook(r) {
  const look = { gender: r.ubyte(), skin: r.ubyte(), face: r.int(), mega: !r.bool(), hair: r.int(), equips: {}, masked: {} };
  for (let slot = r.ubyte(); slot !== 0xff; slot = r.ubyte()) look.equips[slot] = r.int();
  for (let slot = r.ubyte(); slot !== 0xff; slot = r.ubyte()) look.masked[slot] = r.int();
  look.cashWeapon = r.int();
  look.pets = [r.int(), r.int(), r.int()];
  return look;
}

/** Item ids to render: visible slots, cash weapon sticker replaces the weapon. */
export function lookEquipIds(look) {
  const ids = Object.values(look.equips);
  if (look.cashWeapon && look.equips[11]) ids[ids.indexOf(look.equips[11])] = look.cashWeapon;
  return ids;
}

export function readCharEntry(r) {
  const stats = readCharStats(r);
  const look = readCharLook(r);
  r.ubyte(); // view-all flag
  const ranked = r.ubyte();
  const rank = ranked ? { world: r.int(), worldMove: r.int(), job: r.int(), jobMove: r.int() } : null;
  return { stats, look, rank };
}

export function readItem(r, withPosition = true, equipSlotShort = false) {
  const item = {};
  if (withPosition) item.pos = equipSlotShort ? r.short() : r.byte();
  item.type = r.ubyte();
  item.id = r.int();
  item.cash = r.bool();
  if (item.cash) item.cashId = r.long();
  item.expiration = r.long();
  if (item.type === 3) { // pet
    item.pet = { name: r.paddedString(13), level: r.ubyte(), closeness: r.short(), fullness: r.ubyte() };
    r.long(); r.short(); r.short(); r.int(); r.short();
    return item;
  }
  if (item.type !== 1) {
    item.quantity = r.short(); item.owner = r.string(); item.flag = r.short();
    if (isRechargeable(item.id)) r.skip(8);
    return item;
  }
  const e = item;
  e.slots = r.ubyte(); e.level = r.ubyte();
  for (const k of ['str', 'dex', 'int', 'luk', 'hp', 'mp', 'watk', 'matk', 'wdef', 'mdef', 'acc', 'avoid', 'hands', 'speed', 'jump']) e[k] = r.short();
  e.owner = r.string(); e.flag = r.short();
  if (e.cash) r.skip(10);
  else { r.ubyte(); e.itemLevel = r.ubyte(); e.itemExp = r.int(); e.vicious = r.int(); r.long(); }
  r.long(); r.int();
  return e;
}

export const isRechargeable = (id) => Math.floor(id / 10000) === 207 || Math.floor(id / 10000) === 233;

export const INV = { EQUIPPED: -1, EQUIP: 1, USE: 2, SETUP: 3, ETC: 4, CASH: 5 };

function readInventory(r) {
  const inv = { limits: [], equipped: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {} };
  for (let i = 1; i <= 5; i++) inv.limits[i] = r.ubyte();
  r.long();
  const readList = (target, posShort, negate) => {
    for (;;) {
      const pos = posShort ? r.short() : r.ubyte();
      if (pos === 0) return;
      r.pos -= posShort ? 2 : 1;
      const it = readItem(r, true, posShort);
      target[negate ? -it.pos : it.pos] = it;
    }
  };
  readList(inv.equipped, true, true);            // normal equipped  (-1..-99)
  const cash = {}; readList(cash, true, true);    // cash equipped (sent as pos-100)
  for (const [k, v] of Object.entries(cash)) inv.equipped[Number(k) - 100] = v;
  readList(inv[1], true, false);
  r.int();                                        // the EQUIP list ends with a short + 2 extra zero bytes
  r.pos -= 2;                                     // (readList consumed the short already)
  readList(inv[2], false, false);
  readList(inv[3], false, false);
  readList(inv[4], false, false);
  // CASH list runs to the end of the inventory block with no terminator; the next field
  // (skills) starts with a 0 byte, which readList treats as the end marker.
  readList(inv[5], false, false);
  return inv;
}

function readSkills(r) {
  const skills = {};
  const n = r.short();
  for (let i = 0; i < n; i++) {
    const id = r.int(), level = r.int(); const expiration = r.long();
    const sk = { id, level, expiration };
    if (isFourthJob(id)) sk.master = r.int();
    skills[id] = sk;
  }
  const cooldowns = {};
  const c = r.short();
  for (let i = 0; i < c; i++) cooldowns[r.int()] = r.short();
  return { skills, cooldowns };
}

/** Matches Skill.isFourthJob on the server for v83 job ids. */
export function isFourthJob(skillId) {
  const job = Math.floor(skillId / 10000);
  if (job === 2212) return false;
  if ([22170001, 22171003, 22171004, 22181002, 22181003].includes(skillId)) return true;
  return job % 10 === 2;
}

function readQuests(r) {
  const started = {}, completed = {};
  const n = r.short();
  for (let i = 0; i < n; i++) started[r.short()] = r.string();
  const m = r.short();
  for (let i = 0; i < m; i++) completed[r.short()] = r.long();
  return { started, completed };
}

/** addCharacterInfo */
export function readCharacterInfo(r) {
  r.long(); r.ubyte();
  const stats = readCharStats(r);
  const buddyCapacity = r.ubyte();
  const linked = r.bool() ? r.string() : null;
  const meso = r.int();
  const inventory = readInventory(r);           // also consumes the 0 byte that starts the skills block
  const { skills, cooldowns } = readSkills(r);
  const quests = readQuests(r);
  // minigame, rings, teleport rocks, monster book (new year / area info not needed)
  r.short();                                    // minigame
  const crush = r.short(); r.skip(crush * 33);
  const friend = r.short(); r.skip(friend * 37);
  if (r.short() === 1) r.skip(4 + 4 + 4 + 2 + 4 + 4 + 13 + 13);
  const rocks = []; for (let i = 0; i < 15; i++) rocks.push(r.int());
  r.int(); r.ubyte(); const cards = r.short(); r.skip(cards * 3);
  return { stats, buddyCapacity, linked, meso, inventory, skills, cooldowns, quests, rocks };
}

/** Movement fragments (AbstractMovementPacketHandler.parseMovement). */
export function readMovement(r) {
  const n = r.ubyte();
  const moves = [];
  for (let i = 0; i < n; i++) {
    const cmd = r.ubyte();
    switch (cmd) {
      case 0: case 5: case 17:
        moves.push({ cmd, x: r.short(), y: r.short(), vx: r.short(), vy: r.short(), fh: r.short(), stance: r.ubyte(), duration: r.short() });
        break;
      case 1: case 2: case 6: case 12: case 13: case 16: case 18: case 19: case 20: case 22:
        moves.push({ cmd, rx: r.short(), ry: r.short(), stance: r.ubyte(), duration: r.short() });
        break;
      case 3: case 4: case 7: case 8: case 9: case 11:
        moves.push({ cmd, x: r.short(), y: r.short(), vx: r.short(), vy: r.short(), stance: r.ubyte() });
        break;
      case 14: r.skip(9); break;
      case 10: moves.push({ cmd, equip: r.ubyte() }); break;
      case 15:
        moves.push({ cmd, x: r.short(), y: r.short(), vx: r.short(), vy: r.short(), fh: r.short(), ofh: r.short(), stance: r.ubyte(), duration: r.short() });
        break;
      case 21: r.skip(3); break;
      default: return moves; // unknown: stop parsing
    }
  }
  return moves;
}

export function writeMovement(w, moves) {
  w.byte(moves.length);
  for (const m of moves) {
    w.byte(m.cmd);
    switch (m.cmd) {
      case 0: case 5: case 17:
        w.short(m.x).short(m.y).short(m.vx).short(m.vy).short(m.fh).byte(m.stance).short(m.duration); break;
      case 1: case 2: case 6: case 12: case 13: case 16: case 18: case 19: case 20: case 22:
        w.short(m.rx).short(m.ry).byte(m.stance).short(m.duration); break;
      case 3: case 4: case 7: case 8: case 9: case 11:
        w.short(m.x).short(m.y).short(m.vx).short(m.vy).byte(m.stance); break;
      case 15:
        w.short(m.x).short(m.y).short(m.vx).short(m.vy).short(m.fh).short(m.ofh).byte(m.stance).short(m.duration); break;
      default: break;
    }
  }
  return w;
}

/**
 * Character stance byte used in movement packets: (action << 1) | facingLeft.
 * Values follow the v83 client's MoveAction enum.
 */
export const STANCE = { walk: 1, stand: 2, jump: 3, alert: 4, prone: 5, fly: 6, ladder: 7, rope: 8, dead: 9, sit: 10 };
export const stanceByte = (action, facingLeft) => (STANCE[action] << 1) | (facingLeft ? 1 : 0);
export const STANCE_NAMES = Object.fromEntries(Object.entries(STANCE).map(([k, v]) => [v, k]));
