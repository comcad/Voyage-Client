import { Connection } from './connection.js';
import { PacketWriter } from './packet.js';
import { C, S } from './opcodes.js';
import { readCharEntry } from './proto.js';

export const LOGIN_ERRORS = {
  2: 'This account has been banned.', 3: 'This ID has been deleted or blocked.', 4: 'Incorrect password.',
  5: 'Not a registered ID.', 6: 'System error.', 7: 'This account is already logged in.',
  8: 'System error.', 9: 'System error.', 10: 'Too many connections.', 13: 'Unable to log on as master at this IP.',
  14: 'Wrong gateway.', 16: 'Please verify your account through email.', 17: 'Wrong gateway.',
  21: 'Please verify your account through email.', 23: 'License agreement not accepted.',
};
export const AFTER_LOGIN_ERRORS = {
  10: 'The server is too busy or the channel is unavailable.', 17: 'Your client sent an invalid host string.',
};

/** Fake but well-formed machine identifiers (Cosmic validates the format, not the value). */
function machineIds() {
  let id = null;
  try { id = localStorage.getItem('maple.hwid'); } catch { /* storage unavailable */ }
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    try { localStorage.setItem('maple.hwid', id); } catch { /* ignore */ }
  }
  const mac = id.slice(0, 12), hwid = id.slice(12, 20);
  return { mac, hwid, macs: mac.match(/../g).join('-'), host: `${mac}_${hwid}` };
}

function readAuth(r) {
  r.skip(6); // int 0 (status) + short 0
  const a = { id: r.int(), gender: r.ubyte(), gm: r.bool() };
  r.ubyte(); r.ubyte();
  a.name = r.string(); r.ubyte(); r.ubyte(); r.long(); r.long(); r.int();
  a.pinMode = r.ubyte(); a.picMode = r.ubyte();
  return a;
}

/** Login server session: everything up to receiving the channel address. */
export class LoginSession {
  constructor(transport) {
    this.conn = new Connection(transport);
    this.ids = machineIds();
  }
  ready() { return this.conn.ready; }
  close() { this.conn.close(); }

  /** -> { ok, account } | { ok:false, reason, message } ; reason 23 = needs ToS. */
  async login(user, password) {
    const p = this.conn.expect(S.LOGIN_STATUS);
    const hw = this.ids.hwid.match(/../g).map((h) => parseInt(h, 16));
    this.conn.send(new PacketWriter(C.LOGIN_PASSWORD).string(user).string(password).zero(6).bytes(hw).zero(4));
    return this._status(await p);
  }

  _status(r) {
    const reason = r.ubyte();
    if (reason !== 0) return { ok: false, reason, message: LOGIN_ERRORS[reason] || `Login failed (${reason}).` };
    r.pos -= 1;
    this.account = readAuth(r);
    return { ok: true, account: this.account };
  }

  async acceptTos() {
    const p = this.conn.expect(S.LOGIN_STATUS);
    this.conn.send(new PacketWriter(C.ACCEPT_TOS).byte(1));
    return this._status(await p);
  }

  async setGender(gender) {
    const p = this.conn.expect(S.LOGIN_STATUS);
    this.conn.send(new PacketWriter(0x08).byte(1).byte(gender));
    return this._status(await p);
  }

  /** PIN step. Returns the server's mode: 0 accepted, 1 register new, 2 wrong (retry), 4 enter existing. */
  async pinStart() {
    const p = this.conn.expect(S.CHECK_PINCODE);
    this.conn.send(new PacketWriter(C.AFTER_LOGIN).byte(1).byte(1));
    return (await p).ubyte();
  }
  async pinCheck(pin) {
    const p = this.conn.expect(S.CHECK_PINCODE);
    this.conn.send(new PacketWriter(C.AFTER_LOGIN).byte(1).byte(0).string(pin));
    return (await p).ubyte();
  }
  async pinRegister(pin) {
    const p = this.conn.expect(S.UPDATE_PINCODE);
    this.conn.send(new PacketWriter(C.REGISTER_PIN).byte(1).string(pin));
    return (await p).ubyte();
  }

  async worlds() {
    const worlds = [];
    const conn = this.conn;
    this.conn.send(new PacketWriter(C.SERVERLIST_REQUEST));
    for (;;) {
      const r = await conn.expect(S.SERVERLIST);
      const id = r.ubyte();
      if (id === 0xff) break;
      const w = { id, name: r.string(), flag: r.ubyte(), event: r.string(), channels: [] };
      r.skip(5);
      for (let n = r.ubyte(); n > 0; n--) {
        const c = { name: r.string(), load: r.int(), world: r.ubyte(), id: r.ubyte() }; r.ubyte();
        w.channels.push(c);
      }
      worlds.push(w);
    }
    return worlds;
  }

  async chars(world, channel) {
    const p = this.conn.expect([S.CHARLIST, S.SERVERSTATUS]);
    this.conn.send(new PacketWriter(C.CHARLIST_REQUEST).byte(2).byte(world).byte(channel).int(0));
    const r = await p;
    if (r.op === S.SERVERSTATUS) return { error: 'This world is full or the channel is unavailable.' };
    r.ubyte();
    const chars = [];
    for (let n = r.ubyte(); n > 0; n--) chars.push(readCharEntry(r));
    this.picFlag = r.ubyte();
    return { chars, picFlag: this.picFlag, slots: r.int() };
  }

  async nameAvailable(name) {
    const p = this.conn.expect(S.CHAR_NAME_RESPONSE);
    this.conn.send(new PacketWriter(C.CHECK_CHAR_NAME).string(name));
    const r = await p; r.string();
    return r.ubyte() === 0;
  }

  /** job: 0 Cygnus, 1 Adventurer, 2 Aran. Returns the new char entry or null. */
  async createChar({ name, job = 1, face, hair, hairColor = 0, skin = 0, top, bottom, shoes, weapon, gender }) {
    const p = this.conn.expect([S.ADD_NEW_CHAR_ENTRY, S.DELETE_CHAR_RESPONSE]);
    this.conn.send(new PacketWriter(C.CREATE_CHAR).string(name).int(job).int(face).int(hair).int(hairColor).int(skin)
      .int(top).int(bottom).int(shoes).int(weapon).byte(gender));
    const r = await p;
    if (r.op !== S.ADD_NEW_CHAR_ENTRY || r.ubyte() !== 0) return null;
    return readCharEntry(r);
  }

  /** DELETE_CHAR (needs the PIC). Resolves with the server state: 0 deleted, 0x14 wrong PIC, 0x16 guild master, 0x1D family, 0x1A world transfer, 0x09 failed. */
  async deleteChar(charId, pic) {
    const p = this.conn.expect(S.DELETE_CHAR_RESPONSE);
    this.conn.send(new PacketWriter(C.DELETE_CHAR).string(pic).int(charId));
    const r = await p; r.int();
    return r.ubyte();
  }

  /** -> { port } | { error } | { wrongPic: true } */
  async selectChar(charId, pic) {
    const p = this.conn.expect([S.SERVER_IP, S.CHECK_SPW_RESULT, S.SELECT_CHARACTER_BY_VAC]);
    const { macs, host } = this.ids;
    if (this.picFlag === 0) this.conn.send(new PacketWriter(C.REGISTER_PIC).byte(1).int(charId).string(macs).string(host).string(pic));
    else if (this.picFlag === 1) this.conn.send(new PacketWriter(C.CHAR_SELECT_WITH_PIC).string(pic).int(charId).string(macs).string(host));
    else this.conn.send(new PacketWriter(C.CHAR_SELECT).int(charId).string(macs).string(host));
    const r = await p;
    if (r.op === S.CHECK_SPW_RESULT) return { wrongPic: true };
    if (r.op === S.SELECT_CHARACTER_BY_VAC) { const c = r.short(); return { error: AFTER_LOGIN_ERRORS[c] || `Cannot enter the game (${c}).` }; }
    r.short();
    const ip = Array.from(r.bytes(4)).join('.');
    return { ip, port: r.ushort(), charId: r.int() };
  }
}
