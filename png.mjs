import zlib from 'zlib';

/**
 * Reads and writes the one kind of PNG the extractor makes: 8-bit RGBA, not interlaced. Just enough to pack a
 * character file's pieces into sheets (sheets.mjs) without another package.
 */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
function crc32(buf, from, to) {
  let c = -1;
  for (let i = from; i < to; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** { w, h, data }: the image's RGBA bytes, row by row. Throws on a file that isn't an 8-bit RGBA, non-interlaced PNG. */
export function decodePng(buf) {
  if (buf.length < 33 || buf.compare(SIGNATURE, 0, 8, 0, 8) !== 0) throw new Error('not a PNG');
  let w = 0, h = 0;
  const idat = [];
  for (let o = 8; o + 12 <= buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), at = o + 8;
    if (at + len + 4 > buf.length) throw new Error('cut short');
    if (type === 'IHDR') {
      w = buf.readUInt32BE(at); h = buf.readUInt32BE(at + 4);
      if (buf[at + 8] !== 8 || buf[at + 9] !== 6 || buf[at + 12] !== 0) throw new Error('not 8-bit RGBA, non-interlaced');
    } else if (type === 'IDAT') idat.push(buf.subarray(at, at + len));
    else if (type === 'IEND') break;
    o = at + len + 4;
  }
  if (!w || !h || !idat.length) throw new Error('no image');
  const stride = w * 4, raw = zlib.inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat));
  if (raw.length < (stride + 1) * h) throw new Error('cut short');
  const data = Buffer.allocUnsafe(stride * h);
  for (let y = 0; y < h; y++) {
    const src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride, filter = raw[src - 1];
    if (filter === 0) { raw.copy(data, dst, src, src + stride); continue; }
    if (filter > 4) throw new Error('bad filter');
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? data[dst + i - 4] : 0, b = y ? data[up + i] : 0;
      const add = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, i >= 4 && y ? data[up + i - 4] : 0);
      data[dst + i] = (raw[src + i] + add) & 255;
    }
  }
  return { w, h, data };
}

/**
 * An 8-bit RGBA PNG of `data` (w x h x 4 bytes). Rows go in as they are: for this art (flat colours, much of it
 * empty) that packs smaller than filtering them first, and several times faster.
 */
export function encodePng(w, h, data) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, body) => {
    const out = Buffer.allocUnsafe(12 + body.length);
    out.writeUInt32BE(body.length, 0); out.write(type, 4, 4, 'latin1'); body.copy(out, 8);
    out.writeUInt32BE(crc32(out, 4, 8 + body.length), 8 + body.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
