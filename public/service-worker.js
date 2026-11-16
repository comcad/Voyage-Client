// The installed app's service worker: it keeps the start page and the files of the build that page names, so the app
// still opens when the client server can't be reached (playing needs it all the same).
//
// A page only ever gets its own build's files. The server names the script, the stylesheet and the frame worker by the
// build's id (?v=), and a file asked for by build never changes, so each is kept under its whole address: a kept page
// that names build A finds build A's script, never another build's. Keeping a new build's copy lets the older ones go.
// Only the start page itself is kept as the start page; any other page is left to the browser. The network is always
// asked first, however long it takes: a kept copy is used only when there is no answer at all, never because one is
// slow. An answer that is an error is shown as it is, not swapped for a kept page.
const CACHE = 'voyage-shell-v2';
const PAGE = '/';
const STATIC = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
const BUILD_FILES = new Set(['/Voyage.js', '/style.css', '/FrameWorker.js']);

const isPage = (url) => url.pathname === '/' || url.pathname === '/index.html';
const isBuildFile = (url) => BUILD_FILES.has(url.pathname) && url.searchParams.has('v');

async function keep(cache, key, response) {
  if (!response.ok) return;
  try {
    await cache.put(key, response.clone());
  } catch (error) {
    console.warn('Could not update the app cache:', error);
  }
}

/** A build's file is kept under its whole address; the copies of that file other builds asked for go. */
async function keepBuildFile(cache, url, response) {
  if (!response.ok) return;
  for (const old of await cache.keys()) {
    const kept = new URL(old.url);
    if (kept.pathname === url.pathname && kept.search !== url.search) await cache.delete(old);
  }
  await keep(cache, url.href, response);
}

/** The build files a page names, by its build's id: each kept that isn't yet (a fetch that fails: next time). */
async function keepBuild(cache, html) {
  const v = html.match(/\/Voyage\.js\?v=([^"'&]+)/)?.[1];
  if (!v) return;
  for (const file of BUILD_FILES) {
    const url = new URL(`${file}?v=${v}`, self.location.origin);
    if (await cache.match(url.href)) continue;
    try { await keepBuildFile(cache, url, await fetch(url)); } catch { /* next time */ }
  }
}

/** The start page and the build files it names, kept together. */
async function keepPageAndBuild(cache) {
  const page = await fetch(PAGE, { cache: 'no-store' });
  if (!page.ok) return;
  const html = await page.clone().text();
  await keep(cache, PAGE, page);
  await keepBuild(cache, html);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(STATIC.map(async (path) => { try { await keep(cache, path, await fetch(path)); } catch { /* next time */ } }));
    try { await keepPageAndBuild(cache); } catch { /* next time */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('voyage-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    if (!isPage(url)) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      let response;
      try {
        response = await fetch(request);
      } catch {
        return await cache.match(PAGE) || Response.error();
      }
      await keep(cache, PAGE, response);
      // (and the files of the build it names, so the kept page has all of its own build)
      if (response.ok) event.waitUntil(response.clone().text().then((html) => keepBuild(cache, html)).catch(() => {}));
      return response;
    })());
    return;
  }

  if (isBuildFile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE), kept = await cache.match(url.href);
      if (kept) return kept;
      const response = await fetch(request);
      await keepBuildFile(cache, url, response);
      return response;
    })());
    return;
  }

  if (!STATIC.includes(url.pathname) || url.search) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let response;
    try {
      response = await fetch(request);
    } catch {
      return await cache.match(url.pathname) || Response.error();
    }
    await keep(cache, url.pathname, response);
    return response;
  })());
});
