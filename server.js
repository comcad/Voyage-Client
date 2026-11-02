
import express from 'express';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as esbuild from 'esbuild';
import pkg from 'javascript-obfuscator';
const JavaScriptObfuscator = pkg.default || pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==========================================
// TOGGLE: Set to true to obfuscate, false for plain esbuild minification only
// ==========================================
const ENABLE_OBFUSCATION = false;

// Automatically bundle (and optionally obfuscate) client scripts on every server boot
try {
  console.log('Building client bundle with esbuild...');
  
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/main.js')],
    bundle: true,
    minify: true,
    sourcemap: !ENABLE_OBFUSCATION, // Keep sourcemaps helpful if obfuscation is off
    outfile: path.join(__dirname, 'public/bundle.js'),
  });

  const bundlePath = path.join(__dirname, 'public/bundle.js');
  const bundledCode = fs.readFileSync(bundlePath, 'utf8');
  console.log(`Bundle loaded (${(bundledCode.length / 1024).toFixed(2)} KB).`);

  if (ENABLE_OBFUSCATION) {
    console.log('Running JavaScript obfuscator...');
    const obfuscatedResult = JavaScriptObfuscator.obfuscate(bundledCode, {
      compact: true,
      controlFlowFlattening: false,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.75,
      transformObjectKeys: true,
      unicodeEscapeSequence: false,
    });

    fs.writeFileSync(bundlePath, obfuscatedResult.getObfuscatedCode(), 'utf8');
    console.log('Client bundle generated and heavily obfuscated successfully!');
  } else {
    console.log('Obfuscation skipped (ENABLE_OBFUSCATION is false). Bundle is minified only.');
  }
} catch (err) {
  console.error('CRITICAL BUILD ERROR:', err);
}

const PORT = Number(process.env.PORT) || 2026;
const ASSETS_DIR = process.env.ASSETS_DIR || path.resolve(__dirname, 'assets');
const SERVERS = Object.fromEntries((process.env.COSMIC_SERVERS || 'cosmic=192.168.2.2,dev=127.0.0.1')
  .split(',').map((s) => s.split('=').map((x) => x.trim())));
const portAllowed = (p) => p === 8484 || (p >= 7575 && p <= 7699);

const app = express();
app.use('/assets', express.static(ASSETS_DIR, { maxAge: '1d', fallthrough: false }));
app.get('/servers.json', (req, res) => res.json(Object.keys(SERVERS)));

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Voyage client on http://0.0.0.0:${PORT} (assets: ${ASSETS_DIR})`);
  console.log('Cosmic servers:', SERVERS);
});
