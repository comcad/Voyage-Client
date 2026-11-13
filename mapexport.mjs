/**
 * A file as the Cosmic server reads it: its wz folder keeps every .img as an XML file (Map.wz/Map/Map1/100000100.img.xml,
 * Character.wz/Weapon/01302000.img.xml, String.wz/Map.img.xml), each value under the name of its type. The assets
 * keep the same trees as JSON, where a number is a number and no more, so the types are put back here: whole numbers
 * are ints, the few values the game keeps as floats or doubles are those (which ones depends on the family of files:
 * fs is a float in a map and an int on a shoe), a pair of numbers is a vector, an image is a canvas with its size
 * (the server never reads the picture), a link is a link.
 */
import zlib from 'zlib';

/** The values each family of files keeps as floats and as doubles, by name (every other whole number in one is an int). */
const TYPES = {
  Map: { float: new Set(['mobRate', 'fs', 'recovery', 'winRecovery', 'winNuff', 'winCP', 'wInCoin', 'loseRecovery', 'loseNuff', 'loseCP', 'loseCoin', 'dropRate', 'climax']), double: new Set() },
  Item: { float: new Set(), double: new Set(['unitPrice']) },
  // (an item's rate is a whole number everywhere but in the files of 0536)
  Item0536: { float: new Set(['rate']), double: new Set(['unitPrice']) },
  Character: { float: new Set(), double: new Set(['recovery']) },
  other: { float: new Set(), double: new Set() },
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
const float = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));

/** A node's children in the file's own order where it is known (`_order`), then any it doesn't name. */
function children(node) {
  const keys = Object.keys(node).filter((k) => !k.startsWith('_'));
  if (!Array.isArray(node._order)) return keys;
  const have = new Set(keys), first = node._order.map(String).filter((k) => have.has(k)), seen = new Set(first);
  return [...first, ...keys.filter((k) => !seen.has(k))];
}

function write(out, name, v, depth, types) {
  const pad = '  '.repeat(depth), n = esc(name);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return;
    const type = types.double.has(name) ? 'double' : types.float.has(name) || !Number.isInteger(v) ? 'float' : 'int';
    out.push(`${pad}<${type} name="${n}" value="${type === 'int' ? v : float(v)}"/>`);
  } else if (typeof v === 'string') out.push(`${pad}<string name="${n}" value="${esc(v)}"/>`);
  else if (typeof v === 'boolean') out.push(`${pad}<int name="${n}" value="${v ? 1 : 0}"/>`);
  else if (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(x))) out.push(`${pad}<vector name="${n}" x="${Math.round(v[0])}" y="${Math.round(v[1])}"/>`);
  else if (v === null) out.push(`${pad}<null name="${n}"/>`);
  else if (typeof v === 'object' && !Array.isArray(v) && typeof v._uol === 'string') out.push(`${pad}<uol name="${n}" value="${esc(v._uol)}"/>`);
  else if (v && typeof v === 'object' && !Array.isArray(v)) {
    const canvas = typeof v._canvas === 'string', kids = children(v);
    const open = canvas ? `<canvas name="${n}" width="${Number(v._w) || 0}" height="${Number(v._h) || 0}"` : `<imgdir name="${n}"`;
    if (!kids.length) { out.push(`${pad}${open}/>`); return; }
    out.push(`${pad}${open}>`);
    for (const k of kids) write(out, k, v[k], depth + 1, types);
    out.push(`${pad}</${canvas ? 'canvas' : 'imgdir'}>`);
  }
}

/** A tree as an .img.xml file: `name` is the file's own ("100000100.img", "Map.img"), `family` the wz it belongs to. */
export function toXml(name, tree, family = 'Map') {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'];
  write(out, name, tree, 0, TYPES[family === 'Item' && name.startsWith('0536') ? 'Item0536' : family] || TYPES.other);
  return `${out.join('\n')}\n`;
}

/** Where the Cosmic server keeps a map's file, under its wz folder. */
export const mapFile = (id) => `Map.wz/Map/Map${Math.floor(id / 100000000)}/${String(id).padStart(9, '0')}.img.xml`;

// ------------------------------------------------------------------ a zip file
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** A zip of files: [{ name, data (a Buffer or a string) }]; the names use '/'. */
export function zip(files, at = new Date()) {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1), date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'), packed = zlib.deflateRawSync(raw, { level: 9 }), crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8); head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10); dir.writeUInt16LE(time, 12); dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(head, name, packed); central.push(dir, name);
    offset += 30 + name.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}
