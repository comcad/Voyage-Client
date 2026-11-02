/** Tiny DOM helpers shared by the UI modules. */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== '') e.append(c instanceof Node ? c : String(c));
  return e;
}

/** Modal with buttons; resolves with the clicked button index. */
export function modal({ title, body, buttons = ['OK'] }) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay' }, el('div', { class: 'panel modal' },
      el('h3', {}, title), el('p', {}, body),
      el('div', { class: 'row' }, ...buttons.map((b, i) => el('button', { class: i === 0 ? 'primary' : '', onclick: () => { overlay.remove(); resolve(i); } }, b)))));
    document.body.append(overlay);
    overlay.querySelector('button')?.focus();
  });
}

export function toast(text, ms = 2500) {
  const t = el('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
