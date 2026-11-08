/**
 * Settings kept on this device: in the browser's storage and in a cookie. The storage belongs to one address and
 * port, so the same client on another port (or the server's name in place of its address) starts from nothing; the
 * cookie is shared by every port of the host, so the newest copy is read from it first. A cookie lasts 400 days
 * (the most a browser keeps one) and is renewed each time it is read or written. Values too big for a cookie stay in
 * storage only.
 */
const MAX_AGE = 400 * 24 * 3600;
const COOKIE_MAX = 3800;

// base64 of the UTF-8 text: a cookie value can't hold the quotes, commas and semicolons JSON is full of
const encode = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

function readCookie(key) {
  try {
    const hit = document.cookie.split('; ').find((p) => p.startsWith(`${key}=`));
    return hit ? decode(hit.slice(key.length + 1)) : null;
  } catch { return null; }
}
function writeCookie(key, text) {
  try {
    const v = encode(text);
    if (v.length > COOKIE_MAX) return;
    document.cookie = `${key}=${v}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax`;
  } catch { /* cookies off */ }
}

/** The kept text for key (the cookie's, else the storage's), or null; found in storage only, it is copied to the cookie. */
export function readKept(key) {
  const c = readCookie(key);
  if (c !== null) { writeCookie(key, c); return c; }
  let s = null;
  try { s = localStorage.getItem(key); } catch { /* storage off */ }
  if (s !== null) writeCookie(key, s);
  return s;
}

/** Keeps text under key in both places. */
export function writeKept(key, text) {
  try { localStorage.setItem(key, text); } catch { /* storage off */ }
  writeCookie(key, text);
}
