import { MapleCipher, shandaEncrypt, shandaDecrypt } from './crypto.js';
import { PacketReader, PacketWriter } from './packet.js';
import { S, C } from './opcodes.js';

export const VERSION = 83;

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
    transport.onClose = () => { this.closed = true; this._fail(new Error('connection closed')); this.onClose?.(); };
    this.on(S.PING, () => this.send(new PacketWriter(C.PONG)));
  }

  on(op, fn) { this.handlers.set(op, fn); return this; }

  /** Resolve with the reader of the next packet carrying any of `ops` (one-shot, takes priority over on()). */
  expect(ops, ms = 10000) {
    ops = [].concat(ops);
    const bi = this.backlog.findIndex((b) => ops.includes(b.op));
    if (bi >= 0) { const b = this.backlog.splice(bi, 1)[0]; return Promise.resolve(Object.assign(b.r, { op: b.op })); }
    return new Promise((res, rej) => {
      const w = { ops, res: (r, op) => { clearTimeout(w.timer); res(Object.assign(r, { op })); } };
      w.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error('server did not respond')); }, ms);
      this.waiters.push(w);
    });
  }

  _data(chunk) {
    const nb = new Uint8Array(this.buf.length + chunk.length);
    nb.set(this.buf); nb.set(chunk, this.buf.length); this.buf = nb;
    for (;;) {
      if (!this.recv) {
        // plaintext hello: u16 length, then payload
        if (this.buf.length < 2) return;
        const len = this.buf[0] | (this.buf[1] << 8);
        if (this.buf.length < 2 + len) return;
        const r = new PacketReader(this.buf.slice(2, 2 + len));
        this.buf = this.buf.slice(2 + len);
        const version = r.short(); const patch = r.string();
        const sendIv = r.bytes(4), recvIv = r.bytes(4), locale = r.ubyte();
        this.hello = { version, patch, locale };
        this.send_ = new MapleCipher(sendIv, VERSION);
        this.recv = new MapleCipher(recvIv, 0xffff - VERSION);
        this._ready(this.hello);
        continue;
      }
      if (this.buf.length < 4) return;
      const len = MapleCipher.length(this.buf);
      if (this.buf.length < 4 + len) return;
      const body = this.buf.slice(4, 4 + len);
      this.buf = this.buf.slice(4 + len);
      shandaDecrypt(this.recv.crypt(body));
      this._dispatch(body);
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
      try { fn(r, op); } catch (e) { console.error(`handler 0x${op.toString(16)} failed`, e); }
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
