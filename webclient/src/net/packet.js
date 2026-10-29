/** Little-endian packet reader/writer matching Cosmic's InPacket/OutPacket. Strings are u16-length latin1. */

export class PacketReader {
  constructor(bytes) {
    this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.v = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    this.pos = 0;
  }
  get available() { return this.b.length - this.pos; }
  byte() { return this.v.getInt8(this.pos++); }
  ubyte() { return this.b[this.pos++]; }
  bool() { return this.b[this.pos++] !== 0; }
  short() { const x = this.v.getInt16(this.pos, true); this.pos += 2; return x; }
  ushort() { const x = this.v.getUint16(this.pos, true); this.pos += 2; return x; }
  int() { const x = this.v.getInt32(this.pos, true); this.pos += 4; return x; }
  uint() { const x = this.v.getUint32(this.pos, true); this.pos += 4; return x; }
  long() { const x = this.v.getBigInt64(this.pos, true); this.pos += 8; return x; }
  pos2() { return { x: this.short(), y: this.short() }; }
  bytes(n) { const x = this.b.slice(this.pos, this.pos + n); this.pos += n; return x; }
  skip(n) { this.pos += n; return this; }
  string() { return this.fixedString(this.ushort()); }
  fixedString(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[this.pos + i]);
    this.pos += n;
    return s;
  }
  /** Fixed-width, NUL-padded string (e.g. 13-byte character names). */
  paddedString(n) { return this.fixedString(n).replace(/\0.*$/s, ''); }
  rest() { return this.bytes(this.available); }
}

export class PacketWriter {
  constructor(opcode) {
    this.buf = new Uint8Array(64); this.len = 0;
    if (opcode !== undefined) this.short(opcode);
  }
  _grow(n) {
    if (this.len + n <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    nb.set(this.buf); this.buf = nb;
  }
  _dv(n) { this._grow(n); const dv = new DataView(this.buf.buffer, this.len, n); this.len += n; return dv; }
  byte(x) { this._grow(1); this.buf[this.len++] = x & 0xff; return this; }
  bool(x) { return this.byte(x ? 1 : 0); }
  short(x) { this._dv(2).setInt16(0, x, true); return this; }
  int(x) { this._dv(4).setInt32(0, x | 0, true); return this; }
  long(x) { this._dv(8).setBigInt64(0, BigInt(x), true); return this; }
  pos(p) { return this.short(p.x).short(p.y); }
  bytes(arr) { this._grow(arr.length); this.buf.set(arr, this.len); this.len += arr.length; return this; }
  zero(n) { this._grow(n); this.len += n; return this; }
  string(s) {
    this.short(s.length);
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
    return this;
  }
  toBytes() { return this.buf.slice(0, this.len); }
}

export const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
