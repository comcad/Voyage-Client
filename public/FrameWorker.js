/*
 * Voyage: makes character frame images off the page's thread (src/framemaker.js asks, src/character.js keeps them).
 *
 * A job is a frame's pieces: for each, the image it is cut from (a character sheet, or a piece's own image), the
 * rectangle cut out of it and where it goes. The pieces are drawn into one image the frame's size, which goes back to
 * the page to be drawn with a single call. The images cut from are loaded and decoded here too, and kept (the ones
 * unused longest let go past SOURCE_PX), so the page's own thread does none of it.
 *
 *   in:   { id, w, h, urls: [...], cuts: [source, sx, sy, sw, sh, dx, dy, ...] }
 *   out:  { id, image }  or  { id, error }
 *   and once, on starting:  { ready: true }  or  { ready: false, error }
 */
const SOURCE_PX = 16e6;
const sources = new Map();   // url -> { image (a promise), px, uses }, the longest unused first
let sourcePx = 0;

function source(url) {
  let s = sources.get(url);
  if (s) { sources.delete(url); sources.set(url, s); s.uses++; return s; }
  s = { px: 0, uses: 1, image: null };
  s.image = fetch(url)
    .then((r) => { if (!r.ok) throw new Error(`${r.status} for ${url}`); return r.blob(); })
    .then((blob) => createImageBitmap(blob))
    .then((image) => { s.px = image.width * image.height; sourcePx += s.px; return image; });
  s.image.catch(() => { if (sources.get(url) === s) sources.delete(url); });   // (asked for again next time)
  sources.set(url, s);
  return s;
}

/** Lets go of the sources unused longest while more than SOURCE_PX are kept (never one a job is using). */
function trim() {
  if (sourcePx <= SOURCE_PX) return;
  for (const [url, s] of sources) {
    if (sourcePx <= SOURCE_PX) break;
    if (s.uses || !s.px) continue;
    sources.delete(url); sourcePx -= s.px;
    s.image.then((image) => image.close());
  }
}

let canvas = null, ctx = null;
try {
  canvas = new OffscreenCanvas(2, 2); ctx = canvas.getContext('2d');
  ctx.fillRect(0, 0, 1, 1);
  canvas.transferToImageBitmap().close();
  if (typeof createImageBitmap !== 'function') throw new Error('no createImageBitmap');
  postMessage({ ready: true });
} catch (e) {
  postMessage({ ready: false, error: String((e && e.message) || e) });
}

onmessage = async (ev) => {
  const { id, w, h, urls, cuts } = ev.data;
  const used = urls.map(source);
  try {
    const images = await Promise.all(used.map((s) => s.image));
    canvas.width = w; canvas.height = h;   // (cleared, and as big as the frame)
    for (let i = 0; i < cuts.length; i += 7) {
      ctx.drawImage(images[cuts[i]], cuts[i + 1], cuts[i + 2], cuts[i + 3], cuts[i + 4], cuts[i + 5], cuts[i + 6], cuts[i + 3], cuts[i + 4]);
    }
    const image = canvas.transferToImageBitmap();
    postMessage({ id, image }, [image]);
  } catch (e) {
    postMessage({ id, error: String((e && e.message) || e) });
  }
  for (const s of used) s.uses--;
  trim();
};
