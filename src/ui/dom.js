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

/**
 * Modal with buttons; resolves with the clicked button index. A one-button modal (the error and connection notices)
 * can also be dismissed with Escape or a click on the backdrop, which answers its one button: a modal nothing can
 * dismiss is an await that never settles (the login retry loop, main.js's onError). A modal that offers a real choice
 * (e.g. the gender question, whose answer is sent to the server) ignores both and waits for a button. The first
 * button is focused as the modal opens, so Enter answers that one: the keyboard default is the first button, chosen
 * by position rather than by the caller.
 */
export function modal({ title, body, buttons = ['OK'] }) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay' }, el('div', { class: 'panel modal' },
      el('h3', {}, title), el('p', {}, body),
      el('div', { class: 'row' }, ...buttons.map((b, i) => el('button', { class: i === 0 ? 'primary' : '', onclick: () => answer(i) }, b)))));
    document.body.append(overlay);
    const only = buttons.length === 1;
    const answer = (i) => { removeEventListener('keydown', onKey, true); overlay.remove(); resolve(i); };
    const onKey = (e) => { if (only && e.key === 'Escape') { e.preventDefault(); answer(0); } };
    if (only) overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) answer(0); });
    addEventListener('keydown', onKey, true);
    overlay.querySelector('button')?.focus();
  });
}

export function toast(text, ms = 2500) {
  const t = el('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
