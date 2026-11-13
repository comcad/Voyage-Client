
import express from 'express';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { build as buildClient, buildAdmin, ADMIN_BUNDLE } from './build.mjs';
import { ConfigMgr, ConfigException, confDir } from './configmgr.mjs';
import { ServerConfigs } from './serverconfigs.mjs';
import { SheetStore } from './sheets.mjs';
import { clientConfigs } from './src/config.js';
import { capture, relay, counting, report, startAdmin } from './admin.mjs';
import { CustomStore, serveCustom, customRoutes } from './custom.mjs';

capture();   // the console, kept for the admin page too (from the first line)

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  ConfigMgr.load(confDir(process.argv.slice(2)));
} catch (e) {
  if (!(e instanceof ConfigException)) throw e;
  console.error(`Can't start: ${e.message}`);
  process.exit(1);
}
if (ConfigMgr.created) console.log(`Created ${ConfigMgr.files[0]} from ${ConfigMgr.DIST_FILE}`);
for (const f of ConfigMgr.files) console.log(`Loaded config file ${f}`);

// Build the client bundle on boot (respects Build.Obfuscate). Fail-fast on error.
let BUILD_ID = '';
try {
  BUILD_ID = await buildClient(ServerConfigs.OBFUSCATE);
} catch (err) {
  console.error('CRITICAL BUILD ERROR:', err);
}
// The admin page (admin.mjs): its own bundle, on its own port; off unless Admin.Port is set.
let ADMIN_PORT = ServerConfigs.ADMIN_PORT;
if (ADMIN_PORT) {
  try { await buildAdmin(BUILD_ID); } catch (err) { console.error('The admin page could not be built, so it is left off:', err.message); ADMIN_PORT = 0; }
}

const HOST = ServerConfigs.HOST;
const PORT = ServerConfigs.PORT;
const ASSETS_DIR = ServerConfigs.ASSETS_DIR;
const SERVERS = ServerConfigs.SERVERS;
const CLIENT_CONFIG = clientConfigs(ConfigMgr);
const portAllowed = (p) => p === 8484 || (p >= 7575 && p <= 7699);

const app = express();
app.use(counting);   // what goes out, by kind (the admin page)
// What is published from the admin page (maps, NPCs, equips, items, pictures) comes before the assets' own
// (custom.mjs): asked first for every asset, after the sheets' own routes below.
const custom = new CustomStore(ASSETS_DIR, ServerConfigs.CUSTOM_DIR);
// Characters, NPCs, monsters and tile sets as sheets (sheets.mjs): a file's tree with each image's place in its
// sheets, and the sheets it names. They are made from the assets as the server starts and kept in the cache folder;
// one asked for before they are all there is made first.
const sheets = ServerConfigs.SHEETS ? SheetStore.open(ASSETS_DIR, path.join(ServerConfigs.CACHE_DIR, 'sheets')) : null;
CLIENT_CONFIG.sheets = !!sheets;   // (what the client asks by: on only when the sheets can be kept)
// With the admin page on, players' browsers say how they are doing (frame rate, hitches, errors) for it to show.
CLIENT_CONFIG.reports = !!ADMIN_PORT;
if (ADMIN_PORT) app.post('/report', express.json({ limit: '64kb' }), (req, res) => res.status(report(req.ip, req.body) ? 204 : 429).end());
const serveSheets = (web, guard = (req, res, next) => next()) => {
  if (!sheets) return;
  web.get(/^\/assets\/_sheets\/(.+\.img)\.json$/, guard, (req, res, next) => {
    if (/(^|\/)\.\.?(\/|$)/.test(req.params[0])) { res.status(404).end(); return; }
    // (one of your own published in its place: as it is, from the custom folder)
    if (custom.isLive(req.params[0])) { req.url = `/assets/${req.params[0]}.json${req.query.v ? `?v=${encodeURIComponent(req.query.v)}` : ''}`; next(); return; }
    sheets.tree(req.params[0]).then((file) => {
      if (file) {   // (kept gzipped, and sent so to every browser: all of them take it)
        res.set({ 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' });
        if (req.acceptsEncodings('gzip')) { res.set('Content-Encoding', 'gzip'); res.sendFile(file, { maxAge: '1d', dotfiles: 'allow' }); }
        else { res.set('Cache-Control', 'public, max-age=86400'); fs.createReadStream(file).on('error', next).pipe(zlib.createGunzip()).on('error', next).pipe(res); }
        return;
      }
      req.url = `/assets/${req.params[0]}.json`;   // no sheets for this one (a ring, a boss, a file that isn't packed): as it is
      next();
    }, next);
  });
  // (a sheet's address has its file's version in it, so it never changes: the browser may keep it)
  web.get(/^\/assets\/_sheets\/(.+\.img)\/((?:\d+\.)?[12])\.([0-9a-f]{10})\.png$/, guard, (req, res, next) => {
    sheets.sheet(req.params[0], req.params[1], req.params[2]).then((file) => {
      if (file) res.sendFile(file, { maxAge: '1y', immutable: true, dotfiles: 'allow' }); else res.status(404).end();
    }, next);
  });
};
serveSheets(app);
serveCustom(app, custom);
app.use('/assets', express.static(ASSETS_DIR, { maxAge: '1d', fallthrough: false, dotfiles: 'allow' }));
app.get('/servers.json', (req, res) => res.json(Object.keys(SERVERS)));
app.get('/config.json', (req, res) => res.json({ ...CLIENT_CONFIG, custom: custom.versions() }));
// Which build the server has now: a page still running an older one tells its player to reload.
app.get('/build.json', (req, res) => res.set('Cache-Control', 'no-store').json({ id: BUILD_ID }));
// The page is never kept by the browser and asks for the script and the stylesheet by the build's id, so a reload
// always gets the current build (Safari is slow to let go of a module script it has).
const INDEX = path.join(__dirname, 'public', 'index.html');
// One line for each time a browser asks for the page or the script: which build a browser is given, and whether it
// asked at all, is then on record (it showed nothing while Safari kept running a script it had kept).
const asked = (req) => console.log(`${new Date().toISOString()} ${req.ip} asked for ${req.originalUrl}${req.headers['if-none-match'] || req.headers['if-modified-since'] ? ' (has a copy)' : ''}, build ${BUILD_ID}`);
app.get('/Voyage.js', (req, res, next) => { asked(req); next(); });
app.get(['/', '/index.html'], (req, res) => {
  asked(req);
  let html;
  try { html = fs.readFileSync(INDEX, 'utf8'); } catch { res.status(404).end(); return; }
  const v = encodeURIComponent(BUILD_ID);
  if (v) html = html.replace('src="/Voyage.js"', `src="/Voyage.js?v=${v}"`).replace('href="/style.css"', `href="/style.css?v=${v}"`);
  res.set('Cache-Control', 'no-store').type('html').send(html);
});
// (asked for by build id, a file never changes: the browser may keep it)
app.use(express.static(path.join(__dirname, 'public'), { index: false, setHeaders: (res) => { if (res.req.query?.v) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));

const server = http.createServer(app);

const HEARTBEAT = 10000;
// What a game server sends goes on to the browser in batches. Sent on as it comes, every packet is a frame and a TCP
// segment of its own: a busy map is two thousand of 60 bytes a second, each acknowledged, and on a wireless or a far
// link one of them lost holds up everything behind it (every other player stops at once until it is sent again).
// Together they are a hundred or so a second. Nothing waits when little is coming: the first packet goes at once,
// and what follows within RELAY_MS of it goes together (or sooner, once there is RELAY_BYTES of it).
const RELAY_MS = 10, RELAY_BYTES = 16384;
const wss = new WebSocketServer({ server, path: '/ws' });
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.alive === false) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
    ws.send('hb');
  }
}, HEARTBEAT);

wss.on('connection', (ws, req) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  const q = new URL(req.url, 'http://x').searchParams;
  const host = SERVERS[q.get('server')] ?? Object.values(SERVERS)[0];
  const port = Number(q.get('port'));
  if (!portAllowed(port)) { ws.close(1008, 'port not allowed'); return; }

  const sock = net.connect(port, host);
  sock.setNoDelay(true);
  const conn = relay.open(ws, req.socket.remoteAddress, q.get('server') ?? Object.keys(SERVERS)[0], host, port);
  let held = [], heldBytes = 0, timer = null, sentAt = 0;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!heldBytes) return;
    const out = held.length === 1 ? held[0] : Buffer.concat(held, heldBytes);
    held = []; heldBytes = 0; sentAt = Date.now();
    if (ws.readyState === ws.OPEN) { ws.send(out); relay.sent(conn, out.length); }
  };
  sock.on('data', (d) => {
    held.push(d); heldBytes += d.length;
    if (heldBytes >= RELAY_BYTES) { flush(); return; }
    if (timer) return;
    const wait = RELAY_MS - (Date.now() - sentAt);
    if (wait <= 0) flush(); else timer = setTimeout(flush, wait);
  });
  sock.on('close', () => { flush(); ws.close(); });
  sock.on('error', (e) => { console.log(`bridge ${host}:${port} ${e.message}`); ws.close(1011, e.message); });
  ws.on('message', (d) => { relay.got(conn, d.length); sock.write(d); });
  ws.on('close', () => { if (timer) clearTimeout(timer); sock.destroy(); relay.close(conn); });
});

server.listen(PORT, HOST, () => {
  console.log(`Voyage client on http://${HOST}:${PORT} (assets: ${ASSETS_DIR})`);
  console.log('Cosmic servers:', SERVERS);
  if (sheets) sheets.makeAll().catch((e) => console.log(`Sheets: the start-up run stopped (${e.message}); the rest are made as they are asked for.`));
  if (ADMIN_PORT) {
    startAdmin({
      host: ServerConfigs.ADMIN_HOST, port: ADMIN_PORT, password: ServerConfigs.ADMIN_PASSWORD, bundle: ADMIN_BUNDLE, assetsDir: ASSETS_DIR,
      routes: (api, guard) => customRoutes(api, guard, custom), custom: (web, guard) => { serveSheets(web, guard); serveCustom(web, custom, guard); },
      info: () => ({
        build: BUILD_ID, host: HOST, port: PORT, adminPort: ADMIN_PORT, servers: SERVERS, assetsDir: ASSETS_DIR, cacheDir: ServerConfigs.CACHE_DIR, customDir: ServerConfigs.CUSTOM_DIR,
        sheets: sheets ? { on: true, made: sheets.made } : { on: false },
        // the settings as they were read (a password is never sent)
        config: Object.fromEntries([...ConfigMgr.values].map(([k, v]) => [k, /password|secret|token/i.test(k) ? (v ? '(set)' : '(not set)') : typeof v === 'bigint' ? Number(v) : v])),
        configFiles: ConfigMgr.files,
      }),
    });
  }
});
