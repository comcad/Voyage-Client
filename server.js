
import express from 'express';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { build as buildClient } from './build.mjs';
import { ConfigMgr, ConfigException, confDir } from './configmgr.mjs';
import { ServerConfigs } from './serverconfigs.mjs';
import { SheetStore } from './sheets.mjs';
import { clientConfigs } from './src/config.js';
import { Customs, assetsId } from './customs.mjs';

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
const HOST = ServerConfigs.HOST;
const PORT = ServerConfigs.PORT;
const ASSETS_DIR = ServerConfigs.ASSETS_DIR;
const SERVERS = ServerConfigs.SERVERS;
const CLIENT_CONFIG = clientConfigs(ConfigMgr);
const portAllowed = (p) => p === 8484 || (p >= 7575 && p <= 7699);
/**
 * Server.AuthenticatedClient: a game server that only lets its own Voyage client in (Voyage-Server's
 * AUTHENTICATED_CLIENT) wants Server.ClientKey first on every connection, as "VOYAGEKEY", its length (two bytes, little
 * endian) and the key. Pages never see it.
 */
const CLIENT_KEY = ServerConfigs.AUTHENTICATED_CLIENT ? ServerConfigs.CLIENT_KEY : '';
if (ServerConfigs.AUTHENTICATED_CLIENT && !CLIENT_KEY) console.warn('Server.AuthenticatedClient is true but Server.ClientKey is empty: no key is sent');
const KEY_PREAMBLE = CLIENT_KEY ? (() => {
  const key = Buffer.from(CLIENT_KEY, 'utf8'), len = Buffer.alloc(2);
  len.writeUInt16LE(key.length);
  return Buffer.concat([Buffer.from('VOYAGEKEY', 'ascii'), len, key]);
})() : null;
/** The close code a page gets when the game server turned the connection away: this client isn't the one for it. */
const NOT_THIS_SERVER = 4001;
/** A page's origin is this server: the host it was served from, as this request came to it (or a proxy says). */
const sameOrigin = (req) => {
  try { return !!req.headers.origin && new URL(req.headers.origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
};

const app = express();
// The assets' customs folder (customs.mjs): its files are served in place of the assets' own.
const customs = new Customs(ASSETS_DIR);
// Characters, NPCs, monsters and tile sets as sheets (sheets.mjs): a file's tree with each image's place in its
// sheets, and the sheets it names. They are made from the assets as the server starts and kept in the cache folder;
// one asked for before they are all there is made first.
const sheets = ServerConfigs.SHEETS ? SheetStore.open(ASSETS_DIR, path.join(ServerConfigs.CACHE_DIR, 'sheets')) : null;
CLIENT_CONFIG.sheets = !!sheets;   // (what the client asks by: on only when the sheets can be kept)
// Which assets these are: the page asks for asset files by it, so when the assets are extracted again a copy a
// browser kept of the old files isn't used.
CLIENT_CONFIG.assets = assetsId(ASSETS_DIR);
const serveSheets = (web, guard = (req, res, next) => next()) => {
  if (!sheets) return;
  web.get(/^\/assets\/_sheets\/(.+\.img)\.json$/, guard, (req, res, next) => {
    if (/(^|\/)\.\.?(\/|$)/.test(req.params[0])) { res.status(404).end(); return; }
    // (one the customs folder changes: as it is, from the files)
    if (customs.has(req.params[0])) { req.url = `/assets/${req.params[0]}.json${req.query.v ? `?v=${encodeURIComponent(req.query.v)}` : ''}`; next(); return; }
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
// what the customs folder holds for the game server alone (monsters' drops, NPC scripts) is never handed out
app.use(['/assets/server', '/assets/scripts'], (req, res) => res.status(404).end());
app.use('/assets', express.static(customs.dir, { maxAge: '1d', dotfiles: 'allow' }));   // the customs first
app.use('/assets', express.static(ASSETS_DIR, { maxAge: '1d', fallthrough: false, dotfiles: 'allow' }), (err, req, res, next) => {
  if (err.status !== 404) { next(err); return; }
  console.warn(`${String(req.ip || '').replace(/^::ffff:/, '')} asked for /assets${req.path}, which the assets haven't got`);
  res.status(404).end();
});
app.get('/servers.json', (req, res) => res.json(Object.keys(SERVERS)));
app.get('/config.json', (req, res) => res.set('Cache-Control', 'no-store').json({ ...CLIENT_CONFIG, custom: customs.now().versions }));
// Which build the server has now: a page still running an older one tells its player to reload.
app.get('/build.json', (req, res) => res.set('Cache-Control', 'no-store').json({ id: BUILD_ID }));
// The page is never kept by the browser and asks for the script and the stylesheet by the build's id, so a reload
// always gets the current build (Safari is slow to let go of a module script it has).
const INDEX = path.join(__dirname, 'public', 'index.html');
// One line for each time a browser asks for the page or the script: which build a browser is given, and whether it
// asked at all, is then on record (it showed nothing while Safari kept running a script it had kept).
const asked = (req) => console.log(`${new Date().toISOString()} ${req.ip} asked for ${req.originalUrl}${req.headers['if-none-match'] || req.headers['if-modified-since'] ? ' (has a copy)' : ''}, build ${BUILD_ID}`);
app.get('/Voyage.js', (req, res, next) => { asked(req); next(); });
// The same for the installed app's own files (its manifest, service worker and icons), with the host they were asked
// for and what was answered: whether a phone's Add to Home Screen got its icon, through a proxy or not, is on record.
app.get(['/manifest.webmanifest', '/service-worker.js', '/icons/*', '/apple-touch-icon*.png'], (req, res, next) => {
  res.on('finish', () => console.log(`${new Date().toISOString()} ${req.ip} asked for ${req.originalUrl} on ${req.headers.host || '?'}: ${res.statusCode}, build ${BUILD_ID}`));
  next();
});
// An iPhone also looks for its home-screen icon at the top of the site: the app's own is there too.
const TOUCH_ICON = path.join(__dirname, 'public', 'icons', 'apple-touch-icon.png');
app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => res.sendFile(TOUCH_ICON));
// The manifest lists its icons by the build's id, as the page names the manifest: a phone keeps what it once got for
// an address (an iPhone even keeps having got no icon), so a new build's addresses are fetched afresh.
const MANIFEST = path.join(__dirname, 'public', 'manifest.webmanifest');
app.get('/manifest.webmanifest', (req, res) => {
  let m;
  try { m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { res.status(404).end(); return; }
  const v = encodeURIComponent(BUILD_ID);
  for (const icon of m.icons || []) if (v && icon.src && !icon.src.includes('?')) icon.src += `?v=${v}`;
  res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache').type('application/manifest+json').send(JSON.stringify(m, null, 2));
});
app.get(['/', '/index.html'], (req, res) => {
  asked(req);
  let html;
  try { html = fs.readFileSync(INDEX, 'utf8'); } catch { res.status(404).end(); return; }
  const v = encodeURIComponent(BUILD_ID);
  // (the home-screen icon too: an iPhone keeps the icon it once got for an address, or that it got none)
  if (v) html = html.replace('src="/Voyage.js"', `src="/Voyage.js?v=${v}"`).replace('href="/style.css"', `href="/style.css?v=${v}"`)
    .replace('href="/icons/apple-touch-icon.png"', `href="/icons/apple-touch-icon.png?v=${v}"`).replace('href="/manifest.webmanifest"', `href="/manifest.webmanifest?v=${v}"`);
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
  // with a key, only this server's own pages may use it
  if (KEY_PREAMBLE && !sameOrigin(req)) { ws.close(NOT_THIS_SERVER, 'This client is not made for this server.'); return; }

  const sock = net.connect(port, host);
  if (KEY_PREAMBLE) sock.write(KEY_PREAMBLE);
  // closed by the game server before it said anything: it turned this client away (no key, or the wrong one)
  let heard = false, failed = false;
  sock.setNoDelay(true);
  let held = [], heldBytes = 0, timer = null, sentAt = 0;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!heldBytes) return;
    const out = held.length === 1 ? held[0] : Buffer.concat(held, heldBytes);
    held = []; heldBytes = 0; sentAt = Date.now();
    if (ws.readyState === ws.OPEN) ws.send(out);
  };
  sock.on('data', (d) => {
    heard = true;
    held.push(d); heldBytes += d.length;
    if (heldBytes >= RELAY_BYTES) { flush(); return; }
    if (timer) return;
    const wait = RELAY_MS - (Date.now() - sentAt);
    if (wait <= 0) flush(); else timer = setTimeout(flush, wait);
  });
  sock.on('close', () => {
    flush();
    if (!heard && !failed) ws.close(NOT_THIS_SERVER, 'This client is not made for this server.'); else ws.close();
  });
  sock.on('error', (e) => { failed = true; console.log(`bridge ${host}:${port} ${e.message}`); ws.close(1011, e.message); });
  ws.on('message', (d) => sock.write(d));
  ws.on('close', () => { if (timer) clearTimeout(timer); sock.destroy(); });
});

server.listen(PORT, HOST, () => {
  console.log(`Voyage client on http://${HOST}:${PORT} (assets: ${ASSETS_DIR}, customs: ${customs.dir})`);
  console.log('Game servers:', SERVERS);
  if (sheets) sheets.makeAll().catch((e) => console.log(`Sheets: the start-up run stopped (${e.message}); the rest are made as they are asked for.`));
});
