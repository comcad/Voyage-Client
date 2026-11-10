
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
