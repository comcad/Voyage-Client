/**
 * What the page does between frames besides the game's update and drawing (for the /fps meter): reading a file's
 * tree, taking a frame back from the worker. It holds the page's thread just the same, so a frame that comes late
 * after a lot of it is the page's doing, not the browser's. Each kind adds its time here; the meter looks at the
 * totals at every frame.
 */
export const between = { files: { n: 0, ms: 0 }, worker: { n: 0, ms: 0 } };
/** `kind` took from t0 until now; `n` more of them done (0 for a second part of the same one). */
export function spent(kind, t0, n = 1) { const k = between[kind]; k.n += n; k.ms += performance.now() - t0; }
