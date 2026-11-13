/**
 * What this page tells its server about itself, for the server's admin page (a Voyage tool; only when the server
 * has the admin page on, config.reports, and only to that server): how the game is running every half minute (frame
 * rate, hitches, the map and how many are on it), errors as they happen, and a /fps copy report when one is made.
 */
import { config } from './config.js';
import { BUILD } from './build.js';

const ID = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
const EVERY = 30000, HITCH_MS = 50, MAX_ERRORS = 20;
let game = null, said = false, errors = 0, lastError = '';

function send(body) {
  if (!config.reports) return;
  try {
    fetch('/report', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ID, build: BUILD, name: game?.stats?.name || '', map: game?.map?.id || 0, ...body }),
    }).catch(() => { /* the server is away: nothing to do about it here */ });
  } catch { /* never in the game's way */ }
}

/** Starts the half-minute reports for this game, and passes on errors nothing caught. */
export function startReports(g) {
  game = g;
  if (!config.reports || said) return;
  said = true;
  // frames counted by the browser's own beat, apart from the game's loop: the frame rate as it really was, the
  // lowest second, and the frames that came 50ms or more late
  let frames = 0, second = 0, secondAt = performance.now(), low = Infinity, seconds = 0, total = 0, hitches = 0, last = 0;
  const beat = (t) => {
    requestAnimationFrame(beat);
    if (last && t - last >= HITCH_MS && t - last < 1000) hitches++;
    last = t; frames++; second++;
    if (t - secondAt >= 1000) { const fps = (second * 1000) / (t - secondAt); if (fps < low) low = fps; total += fps; seconds++; second = 0; secondAt = t; }
  };
  requestAnimationFrame(beat);
  setInterval(() => {
    const hidden = document.hidden || !seconds;
    send({
      kind: 'stats', ua: navigator.userAgent, players: (game?.others?.size || 0) + (game?.map ? 1 : 0), hidden,
      fps: seconds ? total / seconds : 0, low: Number.isFinite(low) ? low : 0, hitches,
      stalls: game?.perf?.wire?.stalls?.filter((x) => performance.now() - x.t < EVERY).length || 0,
      w: game?.canvas?.width || 0, h: game?.canvas?.height || 0, dpr: window.devicePixelRatio || 1,
    });
    frames = 0; low = Infinity; seconds = 0; total = 0; hitches = 0; last = 0; second = 0; secondAt = performance.now();
  }, EVERY);
  addEventListener('error', (e) => reportError(e.error || e.message, 'uncaught'));
  addEventListener('unhandledrejection', (e) => reportError(e.reason, 'a promise'));
}

/** An error, with where it was caught; the same one again and again is said once, and no more than a few in all. */
export function reportError(e, where) {
  const message = `${where}: ${e?.message || e}`;
  if (!config.reports || message === lastError || errors >= MAX_ERRORS) return;
  lastError = message; errors++;
  send({ kind: 'error', message, stack: typeof e?.stack === 'string' ? e.stack : '' });
}

/** A /fps copy report, for the admin page's list. Says whether it was sent. */
export function sendFpsReport(text) {
  if (!config.reports) return false;
  send({ kind: 'fps', text });
  return true;
}
