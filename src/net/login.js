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
  r.skip(6); // result, regStatus, int 0
  const a = { id: r.int(), gender: r.ubyte(), gm: r.bool() };
  a.admin = r.ubyte(); r.ubyte();   // the admin byte (0x80: an admin account), then the country code
  a.name = r.string(); r.ubyte(); r.ubyte(); r.long(); r.long(); r.int();
  a.pinMode = r.ubyte(); a.picMode = r.ubyte();
  return a;
}

/** Login server session: everything up to receiving the channel address. */
export class LoginSession {
  constructor(transport) {
    this.conn = new Connection(transport);
    this.ids = machineIds();
    // sent after the server list; 0xFE until LAST_CONNECTED_WORLD arrives
    this.lastWorld = 0xFE; this.recommended = [];
    this.conn.on(S.LAST_CONNECTED_WORLD, (r) => { this.lastWorld = r.int(); });
    this.conn.on(S.RECOMMENDED_WORLD_MESSAGE, (r) => {
      this.recommended = Array.from({ length: r.ubyte() }, () => ({ world: r.int(), text: r.string() }));
    });
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
    const reason = r.ubyte(), regStatus = r.ubyte();
    r.int();
    if (reason !== 0 && reason !== 12 && reason !== 23) {
      const res = { ok: false, reason, message: LOGIN_ERRORS[reason] || `Login failed (${reason}).` };
      if (reason === 2) {
        const banReason = r.ubyte(), lo = r.int() >>> 0, hi = r.int() >>> 0;
        // FILETIME: 100ns ticks since 1601
        res.ban = { reason: banReason, until: new Date(Number(((BigInt(hi) << 32n) | BigInt(lo)) / 10000n) - 11644473600000) };
      }
      return res;
    }
    if (reason === 23) return { ok: false, reason, regStatus };
    r.pos -= 6;
    this.account = readAuth(r);
    return { ok: true, regStatus, account: this.account };
  }

  async acceptTos() {
    const p = this.conn.expect(S.LOGIN_STATUS);
    this.conn.send(new PacketWriter(C.ACCEPT_TOS).byte(1));
    return this._status(await p);
  }

  /** The gender dialog's Cancel: SET_GENDER 0 (the server then closes the session). */
  genderCancel() { this.conn.send(new PacketWriter(0x08).byte(0)); }
  async setGender(gender) {
    const p = this.conn.expect(S.LOGIN_STATUS);
    this.conn.send(new PacketWriter(0x08).byte(1).byte(gender));
    return this._status(await p);
  }

  /** PIN step. Returns the server's mode: 0 accepted, 1 register new, 2 wrong (retry), 4 enter existing. */
  async pinStart() {
    const p = this.conn.expect(S.CHECK_PINCODE);
    this.conn.send(new PacketWriter(C.AFTER_LOGIN).byte(1).byte(1).string(''));   // the client adds an empty string
    return (await p).ubyte();
  }
  /** Cancel on the PIN prompt: AFTER_LOGIN 0, or REGISTER_PIN 0 while choosing one (the server then closes the session). */
  pinCancel() { this.conn.send(new PacketWriter(C.AFTER_LOGIN).byte(0)); }
  pinRegisterCancel() { this.conn.send(new PacketWriter(C.REGISTER_PIN).byte(0)); }
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

  /** again: SERVERLIST_REREQUEST (back from character select after PLAYER_DC, or from View All Characters). */
  async worlds(again = false, dc = again) {
    const worlds = [];
    const conn = this.conn;
    if (dc) this.conn.send(new PacketWriter(C.PLAYER_DC));
    this.conn.send(new PacketWriter(again ? C.SERVERLIST_REREQUEST : C.SERVERLIST_REQUEST));
    for (;;) {
      const r = await conn.expect(S.SERVERLIST);
      const id = r.ubyte();
      if (id === 0xff) break;
      const w = { id, name: r.string(), flag: r.ubyte(), event: r.string(), channels: [] };
      w.expRate = r.short(); w.dropRate = r.short(); w.blockCreate = !!r.ubyte();
      for (let n = r.ubyte(); n > 0; n--) {
        const c = { name: r.string(), load: r.int(), world: r.ubyte(), id: r.ubyte() }; r.ubyte();
        w.channels.push(c);
      }
      worlds.push(w);
    }
    return worlds;
  }

  /** SERVERSTATUS for a world: 0 normal, 1 busy, 2 full. */
  async serverStatus(world) {
    const p = this.conn.expect(S.SERVERSTATUS);
    this.conn.send(new PacketWriter(C.SERVERSTATUS_REQUEST).short(world));
    return (await p).ubyte();
  }

  async chars(world, channel) {
    const p = this.conn.expect([S.CHARLIST, S.SERVERSTATUS]);
    this.conn.send(new PacketWriter(C.CHARLIST_REQUEST).byte(2).byte(world).byte(channel).int(0));
    const r = await p;
    if (r.op === S.SERVERSTATUS) return { full: true };
    const status = r.ubyte();
    if (status !== 0) return { status };
    const chars = [];
    for (let n = r.ubyte(); n > 0; n--) chars.push(readCharEntry(r));
    this.picFlag = r.ubyte();
    return { chars, picFlag: this.picFlag, slots: r.int() };
  }

  /** CHAR_NAME_RESPONSE result: 0 free, 1 taken, 2 not allowed. */
  async checkName(name) {
    const p = this.conn.expect(S.CHAR_NAME_RESPONSE);
    this.conn.send(new PacketWriter(C.CHECK_CHAR_NAME).string(name));
    const r = await p; r.string();
    return r.ubyte();
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

  /**
   * VIEW_ALL_CHAR: collects every world's characters (10 s at most).
   * -> { chars: [{ world, stats, look, rank }] } | { error: 'none' | 'connected' | 'timeout' | message }
   */
  async viewAll() {
    const conn = this.conn, deadline = performance.now() + 10000;
    const reset = () => conn.send(new PacketWriter(C.VIEW_ALL_END).byte(0));
    conn.send(new PacketWriter(C.VIEW_ALL_CHAR));
    const chars = [];
    let left = null;
    for (;;) {
      let r;
      try { r = await conn.expect(S.VIEW_ALL_CHAR, Math.max(1, deadline - performance.now())); } catch (e) {
        if (conn.closed) throw e;
        if (!chars.length) { reset(); return { error: 'timeout' }; }
        break;
      }
      const mode = r.ubyte();
      if (mode === 1) {
        const worlds = r.int(), n = r.int();
        if (!worlds || !n) { reset(); return { error: 'none' }; }
        left = worlds;
        continue;
      }
      if (mode === 0) {
        const world = r.ubyte();
        for (let n = r.ubyte(); n > 0; n--) chars.push({ world, ...readCharEntry(r, true) });
      } else if (mode === 2) { reset(); return { error: 'connected' }; }
      else if (mode !== 4 && mode !== 5) { const msg = r.ubyte() ? r.string() : ''; reset(); return { error: msg || 'unknown' }; }
      if (left === null || --left <= 0) break;
    }
    if (!chars.length) { reset(); return { error: 'none' }; }
    conn.send(new PacketWriter(C.VIEW_ALL_END).byte(1));
    return { chars };
  }

  /** Leaving View All Characters: VIEW_ALL_END 0, then SERVERLIST_REREQUEST. */
  async leaveViewAll() {
    this.conn.send(new PacketWriter(C.VIEW_ALL_END).byte(0));
    return this.worlds(true, false);
  }

  /** Enter from View All Characters (no channel: the server picks one). picMode from LOGIN_STATUS. */
  async selectFromAll(charId, world, pic, picMode) {
    const { macs, host } = this.ids;
    if (picMode === 0) return this._select(new PacketWriter(C.VIEW_ALL_PIC_REGISTER).byte(1).int(charId).int(world).string(macs).string(host).string(pic));
    if (picMode === 1) return this._select(new PacketWriter(C.VIEW_ALL_WITH_PIC).string(pic).int(charId).int(world).string(macs).string(host));
    return this._select(new PacketWriter(C.PICK_ALL_CHAR).int(charId).int(world).string(macs).string(host));
  }

  /** -> { port } | { code } (login result) | { wrongPic: true } */
  async selectChar(charId, pic) {
    const { macs, host } = this.ids;
    if (this.picFlag === 0) return this._select(new PacketWriter(C.REGISTER_PIC).byte(1).int(charId).string(macs).string(host).string(pic));
    if (this.picFlag === 1) return this._select(new PacketWriter(C.CHAR_SELECT_WITH_PIC).string(pic).int(charId).string(macs).string(host));
    return this._select(new PacketWriter(C.CHAR_SELECT).int(charId).string(macs).string(host));
  }

  async _select(packet) {
    const p = this.conn.expect([S.SERVER_IP, S.CHECK_SPW_RESULT, S.SELECT_CHARACTER_BY_VAC]);
    this.conn.send(packet);
    const r = await p;
    if (r.op === S.CHECK_SPW_RESULT) return { wrongPic: true };
    if (r.op === S.SELECT_CHARACTER_BY_VAC) return { code: r.short() };
    const result = r.ubyte(), sub = r.ubyte();
    if (result !== 0) return { code: result, sub };
    const ip = Array.from(r.bytes(4)).join('.');
    // then a byte whose bit 1 says you play from an Internet café
    const port = r.ushort(), charId = r.int(), cafe = r.available ? (r.ubyte() >> 1) & 1 : 0;
    return { ip, port, charId, cafe };
  }
}
