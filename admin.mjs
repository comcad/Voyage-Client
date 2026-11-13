/**
 * The admin page (a Voyage tool for whoever runs the server, not part of the original client): a second web server
 * on Admin.Port with what this server knows about itself. It is off unless Admin.Port is set.
 *
 * Who gets in: with Admin.Password set, anyone who signs in with it; without one, only the machine the server runs
 * on (reach it from elsewhere through an SSH tunnel). Nothing here is served on the game's own port.
 *
 * What it keeps, all in memory and all bounded (a restart starts them again):
 * - the server's console, line by line;
 * - who is connected through the relay, and how much went each way;
 * - what the web server sent, by kind;
 * - a sample of all of it every few seconds for the last hour;
 * - what players' browsers report when the page is on: frame rate and hitches every half minute, errors as they
 *   happen, and /fps copy reports.
 */
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import util from 'util';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STARTED = Date.now();

// ------------------------------------------------------------------ live updates
const streams = new Set();   // the open /api/stream responses
const emit = (event, data) => {
  if (!streams.size) return;
  const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) res.write(text);
};

// ------------------------------------------------------------------ the console
const LOG_KEEP = 3000;
export const log = { lines: [], n: 0 };
/** A line for the admin page's console: level log / warn / error, src server / client / admin. */
export function note(level, src, text) {
  const line = { n: ++log.n, t: Date.now(), level, src, text: String(text).slice(0, 4000) };
  log.lines.push(line);
  if (log.lines.length > LOG_KEEP) log.lines.splice(0, log.lines.length - LOG_KEEP);
  emit('log', line);
}
/** Everything the server writes to its console from now on is kept for the admin page as well. */
export function capture() {
  for (const level of ['log', 'info', 'warn', 'error']) {
    const write = console[level].bind(console);
    console[level] = (...args) => {
      write(...args);
      try { note(level === 'info' ? 'log' : level, 'server', util.format(...args)); } catch { /* never in the console's way */ }
    };
  }
}

// ------------------------------------------------------------------ the relay
/** The relay's connections: server.js opens one for each browser and adds what goes each way. */
export const relay = {
  conns: new Map(), n: 0, opened: 0, toBrowser: 0, toServer: 0, msgs: 0,
  open(ws, ip, server, host, port) {
    const c = { id: ++this.n, ip: String(ip || '').replace(/^::ffff:/, ''), server, host, port, since: Date.now(), toBrowser: 0, toServer: 0, msgs: 0, last: Date.now(), ws, rate: 0, was: 0 };
    this.conns.set(c.id, c); this.opened++;
    return c;
  },
  sent(c, bytes) { c.toBrowser += bytes; c.msgs++; c.last = Date.now(); this.toBrowser += bytes; this.msgs++; },
  got(c, bytes) { c.toServer += bytes; this.toServer += bytes; },
  close(c) { this.conns.delete(c.id); },
  list() {
    return [...this.conns.values()].map((c) => ({
      id: c.id, ip: c.ip, server: c.server, port: c.port, kind: c.port === 8484 ? 'login' : 'channel', since: c.since, last: c.last,
      toBrowser: c.toBrowser, toServer: c.toServer, msgs: c.msgs, rate: c.rate, waiting: c.ws.bufferedAmount || 0,
    }));
  },
};

// ------------------------------------------------------------------ the web server's own traffic
export const web = { n: 0, bytes: 0, kinds: {} };
const kindOf = (url) => {
  if (url.startsWith('/assets/_sheets/')) return /\.png(\?|$)/.test(url) ? 'sheets' : 'files';
  if (url.startsWith('/assets/')) return /\.json(\?|$)/.test(url) ? 'files' : /\.(png|jpe?g|gif)(\?|$)/.test(url) ? 'images' : /\.(mp3|ogg|wav)(\?|$)/.test(url) ? 'sounds' : 'other';
  return url === '/' || url.startsWith('/index.html') || url.startsWith('/Voyage.js') || url.startsWith('/style.css') || url.startsWith('/FrameWorker.js') ? 'page' : 'other';
};
/** Counts what the game's web server sends, by kind (for express: app.use(counting)). */
export function counting(req, res, next) {
  res.on('finish', () => {
    const k = (web.kinds[kindOf(req.url)] ??= { n: 0, bytes: 0 }), bytes = res.statusCode === 304 ? 0 : Number(res.getHeader('content-length')) || 0;
    k.n++; k.bytes += bytes; web.n++; web.bytes += bytes;
  });
  next();
}

// ------------------------------------------------------------------ what players' browsers report
const CLIENT_KEEP = 200, CLIENT_HISTORY = 120, FPS_KEEP = 40, PER_MINUTE = 40;
export const clients = new Map();   // a page's id -> its latest report and a short history
export const fpsReports = [];       // /fps copy reports sent in, the newest last
const budget = new Map();           // ip -> reports left this minute
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
/** A report from a player's browser (server.js: POST /report). False when it is turned away. */
export function report(ip, body) {
  ip = String(ip || '').replace(/^::ffff:/, '');
  const left = budget.get(ip) ?? PER_MINUTE;
  if (left <= 0 || !body || typeof body !== 'object') return false;
  budget.set(ip, left - 1);
  const id = text(body.id, 24).replace(/[^\w-]/g, '');
  if (!id) return false;
  const now = Date.now();
  let c = clients.get(id);
  if (!c) {
    if (clients.size >= CLIENT_KEEP) {   // the one unheard from the longest makes room
      let old = null;
      for (const x of clients.values()) if (!old || x.last < old.last) old = x;
      clients.delete(old.id);
    }
    c = { id, ip, first: now, last: now, build: '', ua: '', name: '', map: 0, history: [], errors: 0 };
    clients.set(id, c);
  }
  c.last = now; c.ip = ip;
  if (body.build) c.build = text(body.build, 40);
  if (body.ua) c.ua = text(body.ua, 300);
  if (body.name) c.name = text(body.name, 20);
  if (body.kind === 'stats') {
    const s = {
      t: now, map: num(body.map, 0, 999999999), players: num(body.players, 0, 5000), fps: num(body.fps, 0, 1000), low: num(body.low, 0, 1000),
      hitches: num(body.hitches, 0, 10000), stalls: num(body.stalls, 0, 10000), w: num(body.w, 0, 20000), h: num(body.h, 0, 20000), dpr: num(body.dpr, 0, 10), hidden: !!body.hidden,
    };
    c.map = s.map; c.now = s;
    c.history.push(s);
    if (c.history.length > CLIENT_HISTORY) c.history.shift();
  } else if (body.kind === 'error') {
    c.errors++;
    note('error', 'client', `${c.name || c.ip} (build ${c.build || '?'}, map ${num(body.map, 0, 999999999)}): ${text(body.message, 500)}${body.stack ? `\n${text(body.stack, 1500)}` : ''}`);
  } else if (body.kind === 'fps') {
    fpsReports.push({ t: now, id, ip, name: c.name, text: text(body.text, 20000) });
    if (fpsReports.length > FPS_KEEP) fpsReports.shift();
    note('log', 'client', `${c.name || c.ip} sent a /fps report`);
    emit('fps', { t: now, name: c.name, ip });
  } else return false;
  return true;
}
const clientList = () => [...clients.values()].map((c) => ({ id: c.id, ip: c.ip, first: c.first, last: c.last, build: c.build, ua: c.ua, name: c.name, map: c.map, errors: c.errors, now: c.now || null }));

// ------------------------------------------------------------------ a sample every few seconds
const SAMPLE_MS = 5000, SAMPLES = 720;   // an hour
export const samples = [];
let before = null, cpuBefore = process.cpuUsage(), sampledAt = Date.now();
function sample() {
  const now = Date.now(), secs = Math.max(0.001, (now - sampledAt) / 1000);
  const cur = { toBrowser: relay.toBrowser, toServer: relay.toServer, msgs: relay.msgs, n: web.n, bytes: web.bytes };
  const d = (k) => (before ? (cur[k] - before[k]) / secs : 0);
  let players = 0;
  for (const c of relay.conns.values()) { if (c.port !== 8484) players++; c.rate = (c.toBrowser - c.was) / secs; c.was = c.toBrowser; }
  const cpu = process.cpuUsage(cpuBefore);
  cpuBefore = process.cpuUsage();
  // what the browsers that reported in the last minute and a half say (a hidden tab draws nothing: left out)
  let fps = 0, low = Infinity, n = 0, hitches = 0;
  for (const c of clients.values()) {
    if (!c.now || now - c.now.t > 90000 || c.now.hidden) continue;
    fps += c.now.fps; low = Math.min(low, c.now.fps); hitches += c.now.hitches; n++;
  }
  const s = {
    t: now, conns: relay.conns.size, players, out: d('toBrowser'), in: d('toServer'), msgs: d('msgs'), req: d('n'), web: d('bytes'),
    rss: process.memoryUsage().rss, cpu: ((cpu.user + cpu.system) / 1e6 / secs) * 100, load: os.loadavg()[0],
    reporting: n, fps: n ? fps / n : null, low: n ? low : null, hitches,
  };
  before = cur; sampledAt = now;
  samples.push(s);
  if (samples.length > SAMPLES) samples.shift();
  emit('sample', s);
}
setInterval(sample, SAMPLE_MS).unref();
setInterval(() => budget.clear(), 60000).unref();

// ------------------------------------------------------------------ the page's own server
const local = (req) => { const a = req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const SESSION_MS = 12 * 3600 * 1000, TRIES = 5, LOCK_MS = 60000;

/**
 * Starts the admin page's server. `info()` gives what the Server tab shows; `routes(api, guard)` lets server.js add
 * its own (the map editor's), `guard` being the check that the request is signed in; `custom(app, guard)` puts the
 * published maps in front of the assets, as on the game's own server.
 */
export function startAdmin({ host, port, password, info, routes, custom, bundle, assetsDir }) {
  const app = express();
  const sessions = new Map(), fails = new Map();
  const cookieOf = (req) => /(?:^|;\s*)voyage_admin=([0-9a-f]{64})/.exec(req.headers.cookie || '')?.[1];
  const signedIn = (req) => (password ? (sessions.get(cookieOf(req)) || 0) > Date.now() : local(req));
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; frame-ancestors 'none'",
    });
    // without a password only the machine itself gets anything at all
    if (!password && !local(req)) { res.status(403).type('text').send('The admin page has no password set (Admin.Password), so it only answers the machine the server runs on.\n'); return; }
    next();
  });
  // anything that changes something must come from the page itself: a header no other site's form can send
  const guard = (req, res, next) => {
    if (!signedIn(req)) { res.status(401).json({ error: 'sign in' }); return; }
    if (req.method !== 'GET' && req.get('X-Voyage-Admin') !== '1') { res.status(403).json({ error: 'not from the admin page' }); return; }
    next();
  };
  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(express.json({ limit: '8mb' }));

  api.get('/session', (req, res) => res.json({ in: signedIn(req), password: !!password }));
  api.post('/login', (req, res) => {
    if (!password) { res.json({ in: signedIn(req) }); return; }
    const ip = req.socket.remoteAddress || '', f = fails.get(ip);
    if (f && f.n >= TRIES && Date.now() - f.at < LOCK_MS) { res.status(429).json({ error: 'Too many tries. Wait a minute.' }); return; }
    if (req.get('X-Voyage-Admin') !== '1' || !crypto.timingSafeEqual(digest(req.body?.password ?? ''), digest(password))) {
      fails.set(ip, { n: (f && Date.now() - f.at < LOCK_MS ? f.n : 0) + 1, at: Date.now() });
      note('warn', 'admin', `a wrong password from ${ip.replace(/^::ffff:/, '')}`);
      res.status(401).json({ error: 'Wrong password.' });
      return;
    }
    fails.delete(ip);
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, Date.now() + SESSION_MS);
    for (const [k, until] of sessions) if (until < Date.now()) sessions.delete(k);
    res.set('Set-Cookie', `voyage_admin=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
    note('log', 'admin', `signed in from ${ip.replace(/^::ffff:/, '')}`);
    res.json({ in: true });
  });
  api.post('/logout', (req, res) => {
    sessions.delete(cookieOf(req));
    res.set('Set-Cookie', 'voyage_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').json({ in: false });
  });

  api.get('/overview', guard, (req, res) => res.json({
    ...info(), started: STARTED, now: Date.now(), node: process.version, platform: `${os.type()} ${os.release()} (${os.arch()})`, cpus: os.cpus().length,
    memory: { rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed, total: os.totalmem(), free: os.freemem() }, load: os.loadavg(),
    relay: { now: relay.conns.size, opened: relay.opened, toBrowser: relay.toBrowser, toServer: relay.toServer, msgs: relay.msgs }, web,
  }));
  api.get('/log', guard, (req, res) => { const after = Number(req.query.after) || 0; res.json(log.lines.filter((l) => l.n > after)); });
  api.get('/samples', guard, (req, res) => res.json(samples));
  api.get('/connections', guard, (req, res) => res.json(relay.list()));
  api.post('/connections/:id/close', guard, (req, res) => {
    const c = relay.conns.get(Number(req.params.id));
    if (!c) { res.status(404).json({ error: 'gone already' }); return; }
    note('warn', 'admin', `closed the connection from ${c.ip} to ${c.server}:${c.port}`);
    try { c.ws.close(4000, 'closed by the admin'); } catch { /* closing already */ }
    res.json({ ok: true });
  });
  api.get('/clients', guard, (req, res) => res.json(clientList()));
  api.get('/clients/:id', guard, (req, res) => { const c = clients.get(req.params.id); if (c) res.json(c.history); else res.status(404).json({ error: 'not known' }); });
  api.get('/fps', guard, (req, res) => res.json(fpsReports));
  // live: the console's lines, each sample, a /fps report coming in
  api.get('/stream', guard, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    streams.add(res);
    const beat = setInterval(() => res.write(': still here\n\n'), 20000);
    req.on('close', () => { clearInterval(beat); streams.delete(res); });
  });
  routes?.(api, guard);
  api.use((req, res) => res.status(404).json({ error: 'no such thing' }));
  // (an error says what went wrong, in the page's own form)
  api.use((err, req, res, next) => { res.status(err.status || 500).json({ error: err.expose || err.status ? err.message : 'It went wrong on the server (see the console).' }); if (!err.status) console.error('admin:', err); });   // eslint-disable-line no-unused-vars
  app.use('/api', api);

  // the page itself (it shows the sign-in until signed in: nothing in it is secret)
  const dir = path.join(ROOT, 'admin');
  app.get(['/', '/index.html'], (req, res) => {
    let html;
    try { html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'); } catch { res.status(404).end(); return; }
    const v = encodeURIComponent(info().build || '');
    res.set('Cache-Control', 'no-store').type('html').send(html.replace('src="/Admin.js"', `src="/Admin.js?v=${v}"`).replace('href="/admin.css"', `href="/admin.css?v=${v}"`));
  });
  app.get('/Admin.js', (req, res) => res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache').sendFile(bundle));
  app.get('/admin.css', (req, res) => res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache').sendFile(path.join(dir, 'admin.css')));
  // the assets, for the map editor: a signed-in page only (your own maps first, then the assets as they are)
  const assetGuard = (req, res, next) => (signedIn(req) ? next() : res.status(401).end());
  custom?.(app, assetGuard);
  app.use('/assets', assetGuard, express.static(assetsDir, { maxAge: '1h', fallthrough: false, dotfiles: 'allow' }));

  const server = http.createServer(app);
  server.on('error', (e) => console.error(`Admin page: can't listen on ${host}:${port} (${e.message}). The game is not affected.`));
  server.listen(port, host, () => console.log(`Admin page on http://${host}:${port} (${password ? 'sign in with Admin.Password' : 'no password set: this machine only'})`));
  return server;
}
