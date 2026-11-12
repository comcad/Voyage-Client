import { MapleCipher, shandaEncrypt, shandaDecrypt } from './crypto.js';
import { PacketReader, PacketWriter } from './packet.js';
import { S, C } from './opcodes.js';

export const VERSION = 83;
const NOTHING = new Uint8Array(0);

/**
 * One encrypted v83 session over a byte transport. The transport is anything with
 * send(Uint8Array), close(), and onData/onClose callbacks: a WebSocket to the bridge
 * in the browser, or a TCP socket in Node tests.
 */
export class Connection {
  constructor(transport, { log = false } = {}) {
    this.t = transport; this.log = log;
    this.buf = new Uint8Array(0);
    this.handlers = new Map();
    this.waiters = [];
    this.backlog = [];
    this.ready = new Promise((res, rej) => { this._ready = res; this._fail = rej; });
    this.closed = false;
    transport.onData = (d) => this._data(d);
    transport.onClose = () => {
      this.closed = true;
      const err = new Error('connection closed');
      this._fail(err);
      // pending replies can't come any more
      for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.rej(err); }
      this.onClose?.();
    };
    this.on(S.PING, () => this.send(new PacketWriter(C.PONG)));
  }

  on(op, fn) { this.handlers.set(op, fn); return this; }

  /** Resolve with the reader of the next packet carrying any of `ops` (one-shot, takes priority over on()). */
  expect(ops, ms = 10000) {
    ops = [].concat(ops);
    const bi = this.backlog.findIndex((b) => ops.includes(b.op));
    if (bi >= 0) { const b = this.backlog.splice(bi, 1)[0]; return Promise.resolve(Object.assign(b.r, { op: b.op })); }
    if (this.closed) return Promise.reject(new Error('connection closed'));
    return new Promise((res, rej) => {
      const w = { ops, rej, res: (r, op) => { clearTimeout(w.timer); res(Object.assign(r, { op })); } };
      w.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error('server did not respond')); }, ms);
      this.waiters.push(w);
    });
  }

  /**
   * Bytes from the transport: every whole packet in them is handled, and the start of one cut short is kept for
   * the bytes that follow. The packets are read off where they lie (a chunk can hold thousands of them: the relay
   * sends in batches, and a link that stalled delivers all it held at once), so a chunk is gone over once.
   */
  _data(chunk) {
    let buf = chunk, at = 0;
    if (this.buf.length) { buf = new Uint8Array(this.buf.length + chunk.length); buf.set(this.buf); buf.set(chunk, this.buf.length); }
    try {
      for (;;) {
        const left = buf.length - at;
        if (!this.recv) {
          // plaintext hello: u16 length, then payload
          if (left < 2) break;
          const len = buf[at] | (buf[at + 1] << 8);
          if (left < 2 + len) break;
          const r = new PacketReader(buf.slice(at + 2, at + 2 + len));
          at += 2 + len;
          const version = r.short(); const patch = r.string();
          const sendIv = r.bytes(4), recvIv = r.bytes(4), locale = r.ubyte();
          this.hello = { version, patch, locale };
          this.send_ = new MapleCipher(sendIv, VERSION);
          this.recv = new MapleCipher(recvIv, 0xffff - VERSION);
          this._ready(this.hello);
          continue;
        }
        if (left < 4) break;
        const len = MapleCipher.length(buf.subarray(at, at + 4));
        if (left < 4 + len) break;
        const body = buf.slice(at + 4, at + 4 + len);
        at += 4 + len;
        shandaDecrypt(this.recv.crypt(body));
        this._dispatch(body);
      }
    } finally {
      this.buf = at < buf.length ? buf.slice(at) : NOTHING;   // (what is left: the start of a packet, or nothing)
    }
  }

  _dispatch(body) {
    const r = new PacketReader(body);
    const op = r.ushort();
    if (this.log) console.debug('<<', op.toString(16), body.length);
    const wi = this.waiters.findIndex((w) => w.ops.includes(op));
    if (wi >= 0) { this.waiters.splice(wi, 1)[0].res(r, op); return; }
    const fn = this.handlers.get(op);
    if (fn) {
      const t0 = this.timing ? performance.now() : 0;
      try { fn(r, op); } catch (e) { console.error(`handler 0x${op.toString(16)} failed`, e); }
      this.timing?.(op, performance.now() - t0);   // set by the /fps meter
    } else {
      // Several replies can arrive in one chunk before the caller re-arms expect(); keep them.
      this.backlog.push({ op, r });
      if (this.backlog.length > 64) this.backlog.shift();
      this.onUnhandled?.(op, r);
    }
  }

  send(w) {
    if (this.closed || !this.send_) return;
    const data = w instanceof PacketWriter ? w.toBytes() : w;
    const header = this.send_.header(data.length);
    const body = this.send_.crypt(shandaEncrypt(Uint8Array.from(data)));
    const out = new Uint8Array(4 + body.length);
    out.set(header); out.set(body, 4);
    this.t.send(out);
  }

  close() { this.t.close(); }
}

/**
 * Browser transport: a binary WebSocket to the bridge, which relays to Cosmic's TCP port. The bridge
 * sends a text 'hb' every 10s; once one has come, SILENCE ms without any frame means the link died
 * without a close (a dropped tunnel or network) and the transport reports itself closed.
 */
const SILENCE = 30000;
export function wsTransport(url) {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  let seen = 0, done = false, watch = null;
  const closed = () => {
    if (done) return;
    done = true; clearInterval(watch);
    t.onClose?.();
  };
  const t = {
    send: (d) => ws.readyState === WebSocket.OPEN && ws.send(d),
    close: () => { ws.close(); closed(); },
    onData: null, onClose: null,
  };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') { if (!watch) watch = setInterval(() => { if (performance.now() - seen > SILENCE) { ws.close(); closed(); } }, 5000); }
    else t.onData?.(new Uint8Array(e.data));
    seen = performance.now();
  };
  ws.onclose = closed;
  ws.onerror = closed;
  return t;
}
