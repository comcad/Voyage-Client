import express from 'express';
import http from 'http';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// Output of tools/wz-extract.mjs (lives alongside server.js at repo root)
const ASSETS_DIR = process.env.ASSETS_DIR || path.resolve(__dirname, 'assets');
// Cosmic servers the bridge may connect to: "name=host,name2=host2". The first is the default.
const SERVERS = Object.fromEntries((process.env.COSMIC_SERVERS || 'cosmic=192.168.2.2,dev=127.0.0.1')
  .split(',').map((s) => s.split('=').map((x) => x.trim())));
// Login port and channel ports (WWCC: world 0-?, channel 0-19).
const portAllowed = (p) => p === 8484 || (p >= 7575 && p <= 7699);

const app = express();
app.use('/assets', express.static(ASSETS_DIR, { maxAge: '1d', fallthrough: false }));
app.get('/servers.json', (req, res) => res.json(Object.keys(SERVERS)));
app.use(express.static(__dirname, { index: 'index.html' }));

const server = http.createServer(app);

/**
 * WebSocket <-> TCP relay. The browser speaks the full encrypted v83 protocol itself;
 * this only forwards bytes. ws://host/ws?server=cosmic&port=8484
 * Every HEARTBEAT ms each socket gets a text frame 'hb' (game data is always binary) so the browser
 * can tell a dead link from a quiet one, and a ws ping: a browser that missed the last one is gone,
 * and its game connection is dropped instead of lingering.
 */
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Voyage client on http://0.0.0.0:${PORT} (assets: ${ASSETS_DIR})`);
  console.log('Cosmic servers:', SERVERS);
});
