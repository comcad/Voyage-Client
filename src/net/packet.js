/** Little-endian packet reader/writer matching the game server's InPacket/OutPacket. Strings are u16-length latin1.
 *  Scalar writes wrap silently (`& 0xff`, `| 0`, Int16/Int32 coercion); only `long()` throws on a non-integer. */

export class PacketReader {
  constructor(bytes) {
    this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.v = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    this.pos = 0;
  }
  get available() { return this.b.length - this.pos; }
  /** Reads must fail loudly at the end of the packet: a terminator loop on `ubyte()` would otherwise
   *  spin forever on `undefined`, and DataView reads would throw a bare RangeError from the middle of a decode. */
  _need(n) {
    if (this.pos + n > this.b.length) throw new RangeError(`packet read past end: need ${n} at ${this.pos} of ${this.b.length}`);
  }
  byte() { this._need(1); return this.v.getInt8(this.pos++); }
  ubyte() { this._need(1); return this.b[this.pos++]; }
  bool() { this._need(1); return this.b[this.pos++] !== 0; }
  short() { this._need(2); const x = this.v.getInt16(this.pos, true); this.pos += 2; return x; }
  ushort() { this._need(2); const x = this.v.getUint16(this.pos, true); this.pos += 2; return x; }
  int() { this._need(4); const x = this.v.getInt32(this.pos, true); this.pos += 4; return x; }
  uint() { this._need(4); const x = this.v.getUint32(this.pos, true); this.pos += 4; return x; }
  long() { this._need(8); const x = this.v.getBigInt64(this.pos, true); this.pos += 8; return x; }
  pos2() { return { x: this.short(), y: this.short() }; }
  bytes(n) { this._need(n); const x = this.b.slice(this.pos, this.pos + n); this.pos += n; return x; }
  skip(n) { this.pos += n; return this; }
  string() { return this.fixedString(this.ushort()); }
  fixedString(n) {
    this._need(n);
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
  _dv(n) {   // one DataView for the whole buffer, rebuilt only when _grow reallocated it
    this._grow(n);
    if (!this.dv || this.dv.buffer !== this.buf.buffer) this.dv = new DataView(this.buf.buffer);
    const off = this.len; this.len += n;
    return { dv: this.dv, off };
  }
  byte(x) { this._grow(1); this.buf[this.len++] = x & 0xff; return this; }
  bool(x) { return this.byte(x ? 1 : 0); }
  short(x) { const { dv, off } = this._dv(2); dv.setInt16(off, x, true); return this; }
  int(x) { const { dv, off } = this._dv(4); dv.setInt32(off, x | 0, true); return this; }
  long(x) { const { dv, off } = this._dv(8); dv.setBigInt64(off, BigInt(x), true); return this; }
  pos(p) { return this.short(p.x).short(p.y); }
  bytes(arr) { this._grow(arr.length); this.buf.set(arr, this.len); this.len += arr.length; return this; }
  zero(n) { this._grow(n); this.len += n; return this; }
  string(s) {   // one length write and direct byte stores: no per-character _grow/byte calls
    this._grow(2 + s.length);
    const { dv, off } = this._dv(2);
    dv.setUint16(off, s.length, true);
    for (let i = 0; i < s.length; i++) this.buf[this.len + i] = s.charCodeAt(i) & 0xff;
    this.len += s.length;
    return this;
  }
  toBytes() { return this.buf.slice(0, this.len); }
}
