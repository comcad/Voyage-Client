
import express from 'express';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { build as buildClient } from './build.mjs';
import { ConfigMgr, ConfigException, confDir } from './configmgr.mjs';
import { ServerConfigs } from './serverconfigs.mjs';
import { clientConfigs } from './src/config.js';

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
try {
  await buildClient(ServerConfigs.OBFUSCATE);
} catch (err) {
  console.error('CRITICAL BUILD ERROR:', err);
}

const HOST = ServerConfigs.HOST;
const PORT = ServerConfigs.PORT;
const ASSETS_DIR = ServerConfigs.ASSETS_DIR;
const SERVERS = ServerConfigs.SERVERS;
const CLIENT_CONFIG = clientConfigs(ConfigMgr);
const portAllowed = (p) => p === 8484 || (p >= 7575 && p <= 7699);

const app = express();
app.use('/assets', express.static(ASSETS_DIR, { maxAge: '1d', fallthrough: false, dotfiles: 'allow' }));
app.get('/servers.json', (req, res) => res.json(Object.keys(SERVERS)));
app.get('/config.json', (req, res) => res.json(CLIENT_CONFIG));
// Many asset files in one response, for the client's batched downloads (src/assets.js Batcher): one round trip
// instead of one per file. Each file is its length (4 bytes, big-endian; 0xFFFFFFFF when there is no such file)
// then its bytes, in the order asked. Only files inside the assets folder.
const ASSETS_ROOT = path.resolve(ASSETS_DIR);
app.get('/assets-batch', async (req, res) => {
  const list = String(req.query.f || '').split('|').filter(Boolean).slice(0, 64);
  const files = await Promise.all(list.map(async (p) => {
    const full = path.resolve(ASSETS_ROOT, p);
    if (!full.startsWith(ASSETS_ROOT + path.sep)) return null;
    try { return await fs.promises.readFile(full); } catch { return null; }
  }));
  const out = [];
  for (const b of files) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b ? b.length : 0xffffffff);
    out.push(len);
    if (b) out.push(b);
  }
  res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(Buffer.concat(out));
});
// The assets' version (their folders' latest change): the client keeps batched files in a local cache under it, so
// new assets aren't hidden behind old copies.
let assetsVersion = '0';
try {
  const times = [ASSETS_ROOT, ...fs.readdirSync(ASSETS_ROOT).map((d) => path.join(ASSETS_ROOT, d))].map((p) => fs.statSync(p).mtimeMs);
  assetsVersion = Math.round(Math.max(...times)).toString(36);
} catch { /* no assets folder: version 0 */ }
app.get('/assets-version', (req, res) => res.json({ v: assetsVersion }));
// every body, head, face and hair the assets have, by id (the client loads them ahead of time in the background)
let characterIndex = null;
app.get('/character-index.json', (req, res) => {
  if (!characterIndex) {
    const ids = (dir) => {
      try {
        return fs.readdirSync(path.join(ASSETS_DIR, 'Character', dir)).map((f) => /^(\d{8})\.img\.json$/.exec(f)?.[1])
          .filter(Boolean).map(Number).sort((a, b) => a - b);
      } catch { return []; }
    };
    const top = ids('');
    characterIndex = { body: top.filter((n) => n >= 2000 && n < 3000), head: top.filter((n) => n >= 12000 && n < 13000), face: ids('Face'), hair: ids('Hair') };
  }
  res.json(characterIndex);
});
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const server = http.createServer(app);

const HEARTBEAT = 10000;
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
  sock.on('data', (d) => ws.readyState === ws.OPEN && ws.send(d));
  sock.on('close', () => ws.close());
  sock.on('error', (e) => { console.log(`bridge ${host}:${port} ${e.message}`); ws.close(1011, e.message); });
  ws.on('message', (d) => sock.write(d));
  ws.on('close', () => sock.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`Voyage client on http://${HOST}:${PORT} (assets: ${ASSETS_DIR})`);
  console.log('Cosmic servers:', SERVERS);
});
