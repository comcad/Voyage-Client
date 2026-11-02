/**
 * MapleStory v83 transport crypto, ported from Cosmic's net/encryption:
 *   - AES-256 in OFB-like mode keyed with the fixed Maple key, IV = 4-byte seed repeated 4x
 *   - IV shuffle after every packet (MapleAESOFB.getNewIv)
 *   - "Shanda" byte cipher (MapleCustomEncryption) applied before AES on send, after AES on receive
 */

// ------------------------------------------------------------------ AES-256 (encrypt only)
const SBOX = new Uint8Array(256);
{
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
}
const xtime = (b) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;

function expandKey(key) {
  const nk = key.length / 4, nr = nk + 6, w = new Uint8Array(16 * (nr + 1));
  w.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t = w.slice((i - 1) * 4, i * 4);
    if (i % nk === 0) {
      t = Uint8Array.from([SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]);
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) t = t.map((b) => SBOX[b]);
    for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - nk) * 4 + j] ^ t[j];
  }
  return { w, nr };
}

function aesEncryptBlock({ w, nr }, block) {
  const s = Uint8Array.from(block);
  for (let i = 0; i < 16; i++) s[i] ^= w[i];
  for (let r = 1; r <= nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    // shift rows (column-major state)
    let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
    if (r !== nr) {
      for (let c = 0; c < 16; c += 4) {
        const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3], all = a0 ^ a1 ^ a2 ^ a3;
        s[c] ^= all ^ xtime(a0 ^ a1); s[c + 1] ^= all ^ xtime(a1 ^ a2);
        s[c + 2] ^= all ^ xtime(a2 ^ a3); s[c + 3] ^= all ^ xtime(a3 ^ a0);
      }
    }
    for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
  }
  return s;
}

const MAPLE_KEY = expandKey(Uint8Array.from([
  0x13, 0, 0, 0, 0x08, 0, 0, 0, 0x06, 0, 0, 0, 0xb4, 0, 0, 0,
  0x1b, 0, 0, 0, 0x0f, 0, 0, 0, 0x33, 0, 0, 0, 0x52, 0, 0, 0,
]));

const SHUFFLE = Uint8Array.from([
  0xEC, 0x3F, 0x77, 0xA4, 0x45, 0xD0, 0x71, 0xBF, 0xB7, 0x98, 0x20, 0xFC, 0x4B, 0xE9, 0xB3, 0xE1,
  0x5C, 0x22, 0xF7, 0x0C, 0x44, 0x1B, 0x81, 0xBD, 0x63, 0x8D, 0xD4, 0xC3, 0xF2, 0x10, 0x19, 0xE0,
  0xFB, 0xA1, 0x6E, 0x66, 0xEA, 0xAE, 0xD6, 0xCE, 0x06, 0x18, 0x4E, 0xEB, 0x78, 0x95, 0xDB, 0xBA,
  0xB6, 0x42, 0x7A, 0x2A, 0x83, 0x0B, 0x54, 0x67, 0x6D, 0xE8, 0x65, 0xE7, 0x2F, 0x07, 0xF3, 0xAA,
  0x27, 0x7B, 0x85, 0xB0, 0x26, 0xFD, 0x8B, 0xA9, 0xFA, 0xBE, 0xA8, 0xD7, 0xCB, 0xCC, 0x92, 0xDA,
  0xF9, 0x93, 0x60, 0x2D, 0xDD, 0xD2, 0xA2, 0x9B, 0x39, 0x5F, 0x82, 0x21, 0x4C, 0x69, 0xF8, 0x31,
  0x87, 0xEE, 0x8E, 0xAD, 0x8C, 0x6A, 0xBC, 0xB5, 0x6B, 0x59, 0x13, 0xF1, 0x04, 0x00, 0xF6, 0x5A,
  0x35, 0x79, 0x48, 0x8F, 0x15, 0xCD, 0x97, 0x57, 0x12, 0x3E, 0x37, 0xFF, 0x9D, 0x4F, 0x51, 0xF5,
  0xA3, 0x70, 0xBB, 0x14, 0x75, 0xC2, 0xB8, 0x72, 0xC0, 0xED, 0x7D, 0x68, 0xC9, 0x2E, 0x0D, 0x62,
  0x46, 0x17, 0x11, 0x4D, 0x6C, 0xC4, 0x7E, 0x53, 0xC1, 0x25, 0xC7, 0x9A, 0x1C, 0x88, 0x58, 0x2C,
  0x89, 0xDC, 0x02, 0x64, 0x40, 0x01, 0x5D, 0x38, 0xA5, 0xE2, 0xAF, 0x55, 0xD5, 0xEF, 0x1A, 0x7C,
  0xA7, 0x5B, 0xA6, 0x6F, 0x86, 0x9F, 0x73, 0xE6, 0x0A, 0xDE, 0x2B, 0x99, 0x4A, 0x47, 0x9C, 0xDF,
  0x09, 0x76, 0x9E, 0x30, 0x0E, 0xE4, 0xB2, 0x94, 0xA0, 0x3B, 0x34, 0x1D, 0x28, 0x0F, 0x36, 0xE3,
  0x23, 0xB4, 0x03, 0xD8, 0x90, 0xC8, 0x3C, 0xFE, 0x5E, 0x32, 0x24, 0x50, 0x1F, 0x3A, 0x43, 0x8A,
  0x96, 0x41, 0x74, 0xAC, 0x52, 0x33, 0xF0, 0xD9, 0x29, 0x80, 0xB1, 0x16, 0xD3, 0xAB, 0x91, 0xB9,
  0x84, 0x7F, 0x61, 0x1E, 0xCF, 0xC5, 0xD1, 0x56, 0x3D, 0xCA, 0xF4, 0x05, 0xC6, 0xE5, 0x08, 0x49,
]);

function nextIv(old) {
  const s = [0xf2, 0x53, 0x50, 0xc6];
  for (let i = 0; i < 4; i++) {
    const input = old[i];
    let elina = s[1];
    const anna = input;
    let moritz = (SHUFFLE[elina] - input) & 0xff;
    s[0] = (s[0] + moritz) & 0xff;
    moritz = s[2] ^ SHUFFLE[anna];
    elina = (elina - moritz) & 0xff;
    s[1] = elina;
    elina = s[3];
    moritz = elina;
    elina = (elina - s[0]) & 0xff;
    moritz = (SHUFFLE[moritz] + input) & 0xff;
    moritz ^= s[2];
    s[2] = moritz;
    elina = (elina + SHUFFLE[anna]) & 0xff;
    s[3] = elina;
    const merry = (s[0] | (s[1] << 8) | (s[2] << 16) | (s[3] << 24)) >>> 0;
    const r = ((merry >>> 29) | (merry << 3)) >>> 0;
    s[0] = r & 0xff; s[1] = (r >>> 8) & 0xff; s[2] = (r >>> 16) & 0xff; s[3] = (r >>> 24) & 0xff;
  }
  return Uint8Array.from(s);
}

export class MapleCipher {
  /** @param version 83 for the client's send cipher, 0xFFFF-83 for the server's */
  constructor(iv, version) {
    this.iv = Uint8Array.from(iv);
    this.version = ((version >> 8) & 0xff) | ((version << 8) & 0xff00);
  }

  header(length) {
    let iiv = this.iv[3] | (this.iv[2] << 8);
    iiv ^= this.version;
    const mlen = ((length << 8) & 0xff00) | (length >>> 8);
    const x = iiv ^ mlen;
    return Uint8Array.from([(iiv >>> 8) & 0xff, iiv & 0xff, (x >>> 8) & 0xff, x & 0xff]);
  }

  static length(h) { return ((h[0] ^ h[2]) & 0xff) | (((h[1] ^ h[3]) & 0xff) << 8); }

  /** In-place AES-OFB transform, then advance the IV. */
  crypt(data) {
    let remaining = data.length, chunk = 0x5b0, start = 0;
    while (remaining > 0) {
      let block = new Uint8Array(16);
      for (let i = 0; i < 16; i++) block[i] = this.iv[i % 4];
      if (remaining < chunk) chunk = remaining;
      for (let x = start; x < start + chunk; x++) {
        if ((x - start) % 16 === 0) block = aesEncryptBlock(MAPLE_KEY, block);
        data[x] ^= block[(x - start) % 16];
      }
      start += chunk; remaining -= chunk; chunk = 0x5b4;
    }
    this.iv = nextIv(this.iv);
    return data;
  }
}

const rol = (b, n) => { n %= 8; return ((b << n) | (b >>> (8 - n))) & 0xff; };
const ror = (b, n) => { n %= 8; return ((b >>> n) | (b << (8 - n))) & 0xff; };

export function shandaEncrypt(d) {
  for (let j = 0; j < 6; j++) {
    let remember = 0, len = d.length & 0xff;
    if (j % 2 === 0) {
      for (let i = 0; i < d.length; i++) {
        let c = rol(d[i], 3);
        c = (c + len) & 0xff;
        c ^= remember; remember = c;
        c = ror(c, len);
        c = ~c & 0xff;
        c = (c + 0x48) & 0xff;
        len = (len - 1) & 0xff;
        d[i] = c;
      }
    } else {
      for (let i = d.length - 1; i >= 0; i--) {
        let c = rol(d[i], 4);
        c = (c + len) & 0xff;
        c ^= remember; remember = c;
        c ^= 0x13;
        c = ror(c, 3);
        len = (len - 1) & 0xff;
        d[i] = c;
      }
    }
  }
  return d;
}

export function shandaDecrypt(d) {
  for (let j = 1; j <= 6; j++) {
    let remember = 0, len = d.length & 0xff;
    if (j % 2 === 0) {
      for (let i = 0; i < d.length; i++) {
        let c = (d[i] - 0x48) & 0xff;
        c = ~c & 0xff;
        c = rol(c, len);
        const next = c;
        c ^= remember; remember = next;
        c = (c - len) & 0xff;
        c = ror(c, 3);
        d[i] = c;
        len = (len - 1) & 0xff;
      }
    } else {
      for (let i = d.length - 1; i >= 0; i--) {
        let c = rol(d[i], 3);
        c ^= 0x13;
        const next = c;
        c ^= remember; remember = next;
        c = (c - len) & 0xff;
        c = ror(c, 4);
        d[i] = c;
        len = (len - 1) & 0xff;
      }
    }
  }
  return d;
}
