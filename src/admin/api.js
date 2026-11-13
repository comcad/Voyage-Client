/** The admin page talking to its server: JSON both ways, and the live stream. */

let onSignedOut = () => {};
/** What to do when the server says the page isn't signed in any more. */
export function whenSignedOut(fn) { onSignedOut = fn; }

/** GET (or `method` with a `body`) /api<path>; the answer as JSON, or an Error with the server's own words. */
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: { ...(method !== 'GET' ? { 'X-Voyage-Admin': '1' } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/login') { onSignedOut(); throw new Error('Signed out.'); }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `The server answered ${res.status}.`);
  return data;
}

/** The live stream: handlers by event name ({ log, sample, fps }); returns a function that closes it. */
export function live(handlers) {
  const es = new EventSource('/api/stream');
  for (const [name, fn] of Object.entries(handlers)) es.addEventListener(name, (e) => { try { fn(JSON.parse(e.data)); } catch { /* a line it can't read */ } });
  return () => es.close();
}

/** Sends a picture (a PNG blob) to /api<path>; the server's answer as JSON. */
export async function sendPicture(path, blob) {
  const res = await fetch(`/api${path}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Voyage-Admin': '1', 'Content-Type': 'image/png' }, body: blob });
  if (res.status === 401) { onSignedOut(); throw new Error('Signed out.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `The server answered ${res.status}.`);
  return data;
}
