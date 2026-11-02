// End-to-end protocol test against a LOCAL Cosmic dev server (default 127.0.0.1).
// Usage: node test/login-test.mjs [host]
// Credentials come from test/.test-account.json (generated on first run).
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection } from '../src/net/connection.js';
import { PacketWriter, hex } from '../src/net/packet.js';
import { C, S, S_NAMES } from '../src/net/opcodes.js';
import { readCharEntry, readCharacterInfo } from '../src/net/proto.js';

const HOST = process.argv[2] || '127.0.0.1';
const dir = path.dirname(fileURLToPath(import.meta.url));
const credFile = path.join(dir, process.argv[3] || '.test-account.json');
if (!fs.existsSync(credFile)) {
  const rnd = crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(credFile, JSON.stringify({
    user: `wt${rnd}`, password: crypto.randomBytes(8).toString('hex'),
    pin: String(1000 + crypto.randomInt(8999)), pic: crypto.randomBytes(4).toString('hex'), char: `Web${rnd.slice(0, 5)}`,
  }, null, 2));
}
const acct = JSON.parse(fs.readFileSync(credFile, 'utf8'));

function tcp(port) {
  const sock = net.connect(port, HOST);
  const t = { send: (d) => sock.write(d), close: () => sock.end(), onData: null, onClose: null };
  sock.on('data', (d) => t.onData?.(new Uint8Array(d)));
  sock.on('close', () => t.onClose?.());
  sock.on('error', (e) => { console.log('socket error', e.message); t.onClose?.(); });
  return t;
}
const wait = (conn, op, ms = 5000) => new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error(`timeout waiting for ${S_NAMES[op] || op}`)), ms);
  conn.on(op, (r) => { clearTimeout(timer); res(r); });
});
const HOSTSTR = '0A0B0C0D0E0F_1A2B3C4D';

const login = new Connection(tcp(8484));
login.onUnhandled = (op, r) => console.log('  (unhandled)', S_NAMES[op] || op.toString(16), r.available, 'bytes');
const hello = await login.ready;
console.log('hello', hello);

let p = wait(login, S.LOGIN_STATUS);
login.send(new PacketWriter(C.LOGIN_PASSWORD).string(acct.user).string(acct.password).zero(6).bytes([0x1a, 0x2b, 0x3c, 0x4d]).zero(4));
let r = await p;
let status = r.ubyte();
if (status === 23) { // new account: accept the server's ToS (same as the client's EULA dialog)
  p = wait(login, S.LOGIN_STATUS);
  login.send(new PacketWriter(C.ACCEPT_TOS).byte(1));
  r = await p; status = r.ubyte();
  console.log('accepted ToS');
}
if (status !== 0) { console.log('login failed, reason', status); process.exit(1); }
r.ubyte(); r.int();
const accountId = r.int(), gender = r.ubyte();
r.bool(); r.ubyte(); r.ubyte(); const name = r.string(); r.ubyte(); r.ubyte(); r.long(); r.long(); r.int();
let pinMode = r.ubyte(), picMode = r.ubyte();
console.log('logged in', { accountId, gender, name, pinMode, picMode });
if (gender === 10) { // gender not chosen yet
  p = wait(login, S.LOGIN_STATUS);
  login.send(new PacketWriter(0x08).byte(1).byte(0));
  r = await p; r.skip(1 + 1 + 4 + 4 + 1 + 1 + 1 + 1); r.string(); r.skip(1 + 1 + 8 + 8 + 4);
  pinMode = r.ubyte(); picMode = r.ubyte();
  console.log('gender set', { pinMode, picMode });
}

if (pinMode === 0) {
  p = wait(login, S.CHECK_PINCODE);
  login.send(new PacketWriter(C.AFTER_LOGIN).byte(1).byte(1));
  let mode = (await p).ubyte();
  console.log('pin mode', mode);
  if (mode === 1) { // register
    p = wait(login, S.UPDATE_PINCODE);
    login.send(new PacketWriter(C.REGISTER_PIN).byte(1).string(acct.pin));
    console.log('pin registered', (await p).ubyte());
  } else if (mode === 4) {
    p = wait(login, S.CHECK_PINCODE);
    login.send(new PacketWriter(C.AFTER_LOGIN).byte(1).byte(0).string(acct.pin));
    console.log('pin result (0=ok)', (await p).ubyte());
  }
}

const worlds = [];
const done = new Promise((res) => login.on(S.SERVERLIST, (r) => {
  const id = r.ubyte();
  if (id === 0xff) return res();
  const w = { id, name: r.string(), flag: r.ubyte(), event: r.string() };
  r.skip(5); const n = r.ubyte(); w.channels = [];
  for (let i = 0; i < n; i++) { w.channels.push({ name: r.string(), load: r.int(), world: r.ubyte(), id: r.ubyte() }); r.ubyte(); }
  worlds.push(w);
}));
login.send(new PacketWriter(C.SERVERLIST_REQUEST));
await done;
console.log('worlds', worlds.map((w) => `${w.name} (${w.channels.length} ch)`));

p = wait(login, S.CHARLIST);
login.send(new PacketWriter(C.CHARLIST_REQUEST).byte(2).byte(worlds[0].id).byte(0).int(0));
r = await p;
r.ubyte();
const chars = []; for (let n = r.ubyte(); n > 0; n--) chars.push(readCharEntry(r));
const picFlag = r.ubyte(), slots = r.int();
console.log('chars', chars.map((c) => `${c.stats.name} lv${c.stats.level} job${c.stats.job} map${c.stats.mapId}`), { picFlag, slots });

if (!chars.length) {
  p = wait(login, S.CHAR_NAME_RESPONSE);
  login.send(new PacketWriter(C.CHECK_CHAR_NAME).string(acct.char));
  r = await p; console.log('name check', r.string(), 'used=', r.ubyte());
  p = wait(login, S.ADD_NEW_CHAR_ENTRY);
  login.send(new PacketWriter(C.CREATE_CHAR).string(acct.char).int(1).int(20000).int(30030).int(0).int(0)
    .int(1040002).int(1060002).int(1072001).int(1302000).byte(0));
  r = await p; r.ubyte();
  const c = readCharEntry(r); chars.push(c);
  console.log('created', c.stats.name, c.stats.id, 'equips', c.look.equips);
}

const charId = chars[0].stats.id;
p = wait(login, S.SERVER_IP);
if (picFlag === 0) login.send(new PacketWriter(C.REGISTER_PIC).byte(1).int(charId).string('0A-0B-0C-0D-0E-0F').string(HOSTSTR).string(acct.pic));
else if (picFlag === 1) login.send(new PacketWriter(C.CHAR_SELECT_WITH_PIC).string(acct.pic).int(charId).string('0A-0B-0C-0D-0E-0F').string(HOSTSTR));
else login.send(new PacketWriter(C.CHAR_SELECT).int(charId).string('0A-0B-0C-0D-0E-0F').string(HOSTSTR));
r = await p; r.short();
const ip = Array.from(r.bytes(4)).join('.'), port = r.ushort();
console.log('channel at', ip, port);
login.close();

const ch = new Connection(tcp(port));
ch.onUnhandled = (op, r) => console.log('  (unhandled)', S_NAMES[op] || '0x' + op.toString(16), r.available, 'bytes');
await ch.ready;
p = wait(ch, S.SET_FIELD);
ch.send(new PacketWriter(C.PLAYER_LOGGEDIN).int(charId).zero(2));
r = await p;
const channel = r.int(); const a = r.ubyte(), b = r.ubyte();
console.log('SET_FIELD channel', channel, 'charData', b);
r.short(); r.int(); r.int(); r.int();
const info = readCharacterInfo(r);
console.log('in game:', info.stats.name, 'map', info.stats.mapId, 'hp', info.stats.hp, '/', info.stats.maxHp, 'meso', info.meso);
console.log('equipped', Object.fromEntries(Object.entries(info.inventory.equipped).map(([k, v]) => [k, v.id])));
console.log('use', Object.values(info.inventory[2]).map((i) => `${i.id}x${i.quantity}`), 'etc', Object.values(info.inventory[4]).map((i) => `${i.id}x${i.quantity}`));
console.log('skills', Object.keys(info.skills).length, 'quests started', Object.keys(info.quests.started).length);
const seen = {};
ch.onUnhandled = (op) => { seen[S_NAMES[op] || '0x' + op.toString(16)] = (seen[S_NAMES[op] || '0x' + op.toString(16)] || 0) + 1; };
await new Promise((res) => setTimeout(res, 2500));
console.log('other packets after login:', seen);
ch.close();
process.exit(0);
