/**
 * The admin page (a Voyage tool for whoever runs the server; admin.mjs serves it on Admin.Port): the sign-in, then
 * the tabs. A tab is made the first time it is opened and kept, so going to another and back loses nothing (a map
 * being edited, the console's place); it is told when it is shown and hidden so it only asks the server for news
 * while it is looked at.
 */
import { h, fill, toast } from './ui.js';
import { api, whenSignedOut } from './api.js';
import { debugTab } from './debug.js';
import { playersTab } from './players.js';
import { mapsTab } from './maps.js';
import { thingsTab } from './things.js';
import { importTab } from './import.js';
import { serverTab } from './serverinfo.js';

const TABS = [
  { id: 'debug', name: 'Console & analytics', make: debugTab },
  { id: 'players', name: 'Players', make: playersTab },
  { id: 'maps', name: 'Maps', make: mapsTab },
  { id: 'items', name: 'Items', make: (el) => thingsTab(el, [['item', 'Items'], ['equip', 'Equips']], 'Find an item or an equip by its number or name to change its name, its stats or its icon, or make one of your own from a copy.') },
  { id: 'npcs', name: 'NPCs', make: (el) => thingsTab(el, [['npc', 'NPCs']], 'Find an NPC by its number or name to change it, or make one of your own from a copy or from a picture you brought in.') },
  { id: 'quests', name: 'Quests', make: (el) => thingsTab(el, [['quest', 'Quests']], 'Find a quest by its number or name to change it, or make one of your own: what it says, which NPC gives it, what it needs and what it gives.') },
  { id: 'import', name: 'Import', make: importTab },
  { id: 'server', name: 'Server', make: serverTab },
];
const root = document.getElementById('app');
let session = { in: false, password: false };

async function start() {
  try { session = await api('/session'); } catch (e) { fill(root, h('main', { class: 'signin' }, h('h1', null, 'Voyage admin'), h('p', { class: 'error' }, e.message))); return; }
  if (session.in) shell(); else signIn();
}

function signIn(message = '') {
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Password' });
  const error = h('p', { class: 'error', role: 'alert' }, message);
  const button = h('button', { class: 'primary', type: 'submit' }, 'Sign in');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      button.disabled = true; error.textContent = '';
      try { await api('/login', { method: 'POST', body: { password: pass.value } }); session.in = true; shell(); }
      catch (err) { error.textContent = err.message; button.disabled = false; pass.select(); }
    },
  }, h('label', null, 'Password', pass), button, error);
  fill(root, h('main', { class: 'signin' }, h('h1', null, 'Voyage admin'), h('p', { class: 'muted' }, 'Sign in with the password set as Admin.Password in client.conf.'), form));
  pass.focus();
}

function shell() {
  const made = new Map();
  let current = null;
  const body = h('div', { class: 'tab-body' });
  const links = TABS.map((t) => h('a', { href: `#${t.id}`, role: 'tab', id: `tab-${t.id}` }, t.name));
  const open = () => {
    const tab = TABS.find((t) => t.id === location.hash.slice(1)) || TABS[0];
    if (current === tab) return;
    if (current) { const was = made.get(current.id); was.el.hidden = true; was.tab.hide?.(); }
    current = tab;
    let m = made.get(tab.id);
    if (!m) {
      const el = h('div', { class: `tab tab-${tab.id}`, role: 'tabpanel', 'aria-labelledby': `tab-${tab.id}` });
      body.append(el);
      m = { el, tab: tab.make(el) };
      made.set(tab.id, m);
    }
    m.el.hidden = false;
    m.tab.show?.();
    links.forEach((a, i) => { const on = TABS[i] === tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
    document.title = `${tab.name} - Voyage admin`;
  };
  // leaving the page with a map not yet saved asks first
  addEventListener('beforeunload', (e) => { if ([...made.values()].some((m) => m.tab.unsaved?.())) { e.preventDefault(); e.returnValue = ''; } });
  whenSignedOut(() => { removeEventListener('hashchange', open); for (const m of made.values()) m.tab.hide?.(); signIn('You were signed out. Sign in again.'); });
  const out = session.password ? h('button', { class: 'quiet', onclick: async () => { try { await api('/logout', { method: 'POST' }); } catch { /* signed out either way */ } location.reload(); } }, 'Sign out') : null;
  fill(root,
    h('header', { class: 'top' }, h('div', { class: 'brand' }, 'Voyage admin'), h('nav', { role: 'tablist', 'aria-label': 'Sections' }, links), h('div', { class: 'top-right' }, out)),
    body);
  addEventListener('hashchange', open);
  open();
}

addEventListener('unhandledrejection', (e) => { if (e.reason?.message && e.reason.message !== 'Signed out.') toast(e.reason.message, true); });
start();
