const CACHE = 'voyage-shell-v1';
const SHELL = [
  '/',
  '/style.css',
  '/Voyage.js',
  '/FrameWorker.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];
const SHELL_PATHS = new Set(SHELL.map((path) => new URL(path, self.location.origin).pathname));
const FETCH_TIMEOUT = 8000;

async function cacheResponse(cache, key, response) {
  if (!response.ok) return;
  try {
    await cache.put(key, response.clone());
  } catch (error) {
    console.warn('Could not update the offline app shell cache:', error);
  }
}

async function fetchShell(request) {
  let timer;
  try {
    return await Promise.race([
      fetch(request),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('App shell request timed out')), FETCH_TIMEOUT); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
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
    event.respondWith((async () => {
      const cache = await caches.open(CACHE), shell = new Request(new URL('/', self.location.origin));
      let response;
      try {
        response = await fetchShell(request);
      } catch {
        return await cache.match(shell) || Response.error();
      }
      if (!response.ok) return await cache.match(shell) || response;
      await cacheResponse(cache, shell, response);
      return response;
    })());
    return;
  }

  if (!SHELL_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), key = new Request(new URL(url.pathname, self.location.origin));
    let response;
    try {
      response = await fetchShell(request);
    } catch {
      return await cache.match(key) || Response.error();
    }
    if (!response.ok) return await cache.match(key) || response;
    await cacheResponse(cache, key, response);
    return response;
  })());
});
