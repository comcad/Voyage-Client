/** Small helpers for the admin page: making elements, and writing numbers and times the same way everywhere. */

/** An element: h('div', { class: 'x', onclick: fn }, 'text', child, [more]). Text always goes in as text. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
/** The same for SVG. */
export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
}
/** Empties an element and puts these in it. */
export function fill(el, ...kids) { el.replaceChildren(); add(el, kids); return el; }

const round = (v, d) => (Math.abs(v) >= 100 || d === 0 ? Math.round(v).toLocaleString('en-US') : String(Number(v.toFixed(Math.abs(v) >= 10 ? Math.min(d, 1) : d))));
export const fmt = {
  /** 1,284 / 12.9K / 4.2M */
  count(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    const a = Math.abs(v);
    return a >= 1e9 ? `${round(v / 1e9, 1)}B` : a >= 1e6 ? `${round(v / 1e6, 1)}M` : a >= 1e4 ? `${round(v / 1e3, 1)}K` : Math.round(v).toLocaleString('en-US');
  },
  bytes(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    const a = Math.abs(v);
    return a >= 1 << 30 ? `${round(v / (1 << 30), 2)} GB` : a >= 1 << 20 ? `${round(v / (1 << 20), 1)} MB` : a >= 1024 ? `${round(v / 1024, 1)} KB` : `${Math.round(v)} B`;
  },
  rate(v) { return v === null || v === undefined ? '-' : `${fmt.bytes(v)}/s`; },
  /** One decimal under 10, none above. */
  num(v, unit = '') { return v === null || v === undefined || Number.isNaN(v) ? '-' : `${round(v, 1)}${unit}`; },
  clock(t) { return new Date(t).toLocaleTimeString('en-GB', { hour12: false }); },
  day(t) { return new Date(t).toLocaleString('en-GB', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); },
  /** How long: "42 s", "3 min", "2 h 5 min", "3 d 4 h". */
  span(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
    return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
  },
  ago(t, now = Date.now()) { return now - t < 1500 ? 'just now' : `${fmt.span(now - t)} ago`; },
  /** A browser, from its user agent, in a couple of words. */
  browser(ua) {
    if (!ua) return '-';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    const m = /Edg\/(\d+)/.exec(ua) || /OPR\/(\d+)/.exec(ua) || /Firefox\/(\d+)/.exec(ua) || /Chrome\/(\d+)/.exec(ua) || /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua);
    const name = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return `${name}${m ? ` ${m[1]}` : ''}${os ? `, ${os}` : ''}`;
  },
};

/** A table: columns [{ name, cell(row) -> text or node, num }] over rows; `empty` when there are none. */
export function table(columns, rows, empty = 'Nothing yet.') {
  if (!rows.length) return h('p', { class: 'empty' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.num ? 'num' : null }, c.name)))),
    h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => h('td', { class: c.num ? 'num' : null }, c.cell(r))))))));
}

/** A short message at the bottom of the page that goes away by itself. */
export function toast(text, bad = false) {
  const el = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3000);
}

/**
 * A window over the page: build(close) makes what is in it and calls close(value) when it is done with; the promise
 * gives that value (undefined when it was just closed). Escape and the Close button close it.
 */
export function dialog(title, build, { wide = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = (value) => { if (done) return; done = true; el.close(); el.remove(); resolve(value); };
    const el = h('dialog', { class: wide ? 'wide' : null },
      h('header', null, h('h2', null, title), h('button', { type: 'button', class: 'quiet', onclick: () => close(undefined), 'aria-label': 'Close' }, 'Close')));
    el.append(h('div', { class: 'dialog-body' }, build(close)));
    el.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
    document.body.append(el);
    el.showModal();
  });
}

/** Waits until nothing more has been typed for a moment before calling fn with the latest value. */
export function settled(fn, ms = 220) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/** Gives the browser a file to save. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** A window with a search box over a list; search(q) gives rows { id, label }; resolves with the row picked. */
export function pickFromList(title, search, hint = 'number or name') {
  return dialog(title, (close) => {
    const list = h('div', { class: 'pick-list' });
    const run = settled(async (q) => {
      let rows = [];
      try { rows = await search(q); } catch (e) { toast(e.message, true); }
      fill(list, rows.length ? rows.map((r) => h('button', { type: 'button', onclick: () => close(r) }, h('strong', null, r.id), ' ', r.label)) : h('p', { class: 'empty' }, q ? 'Nothing by that number or name.' : 'Type a number or a name.'));
    });
    const box = h('input', { type: 'search', placeholder: hint, oninput: (e) => run(e.target.value) });
    setTimeout(() => { box.focus(); run(''); }, 0);
    return [box, list];
  });
}

/** The folder under custom/ each kind is kept in, and a picture's address there (any signed-in page can show it). */
export const DIRS = { map: 'maps', npc: 'npcs', equip: 'equips', item: 'items' };
export const pictureUrl = (kind, name, at = 0) => `/assets/Map/_custom/${DIRS[kind]}/${name}.png${at ? `?t=${at}` : ''}`;
