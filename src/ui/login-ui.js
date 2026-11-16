import { LoginSession } from '../net/login.js';
import { wsTransport } from '../net/connection.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { lookEquipIds } from '../net/proto.js';
import { jobName } from '../data.js';
import { el, modal, toast } from './dom.js';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function bridgeUrl(server, port) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?server=${encodeURIComponent(server)}&port=${port}`;
}

/**
 * Drives the login server from the title screen to SERVER_IP.
 * Resolves with { server, charId, port, channel, world } when a character is chosen.
 */
export class LoginFlow {
  constructor(root, assets) {
    this.root = root; this.assets = assets;
  }

  async run() {
    const servers = await fetch('/servers.json').then((r) => r.json()).catch(() => ['gameserver']);
    for (;;) {
      const creds = await this.titleScreen(servers);
      try {
        const res = await this.session(creds);
        if (res) return res;
      } catch (e) {
        console.error(e);
        await modal({ title: 'Connection lost', body: e.message || String(e), buttons: ['OK'] });
      }
      this.s?.close();
    }
  }

  screen(...children) {
    this.root.replaceChildren(el('div', { class: 'login-screen' }, el('div', { class: 'login-logo' }, 'MapleStory'), ...children));
  }

  titleScreen(servers) {
    return new Promise((resolve) => {
      const user = el('input', { placeholder: 'Maple ID', value: store.get('maple.user') || '', autocomplete: 'username', maxlength: 12 });
      const pass = el('input', { placeholder: 'Password', type: 'password', autocomplete: 'current-password', maxlength: 12 });
      const server = el('select', {}, ...servers.map((s) => el('option', { value: s, selected: s === store.get('maple.server') }, s)));
      const submitBtn = el('button', { class: 'primary', type: 'submit' }, 'Login');
      const submit = () => {
        if (!user.value || !pass.value) return;
        store.set('maple.user', user.value); store.set('maple.server', server.value);
        resolve({ user: user.value, password: pass.value, server: server.value });
      };
      // the button says whether the form can be submitted: a click on a blank form used to do nothing at all.
      // style.css has no :disabled rule, so the faded look is set here
      const sync = () => {
        submitBtn.disabled = !user.value || !pass.value;
        submitBtn.style.opacity = submitBtn.disabled ? '0.5' : '';
        submitBtn.style.cursor = submitBtn.disabled ? 'default' : '';
      };
      user.addEventListener('input', sync); pass.addEventListener('input', sync); sync();
      const form = el('form', { class: 'panel login-box', onsubmit: (e) => { e.preventDefault(); submit(); } },
        el('label', {}, 'Server', server), user, pass, submitBtn,
        el('p', { class: 'hint' }, 'New IDs are registered automatically if the server allows it.'));
      this.screen(form);
      (user.value ? pass : user).focus();
    });
  }

  async session({ user, password, server }) {
    this.screen(el('div', { class: 'panel' }, 'Connecting...'));
    this.s = new LoginSession(wsTransport(bridgeUrl(server, 8484)));
    await this.s.ready();
    let res = await this.s.login(user, password);
    if (!res.ok && res.reason === 23) res = await this.s.acceptTos();
    if (!res.ok) { await modal({ title: 'Login failed', body: res.message, buttons: ['OK'] }); return null; }
    let account = res.account;
    if (account.gender === 10) {
      // Cancel is last: modal() styles button 0 as primary, and SET_GENDER 0 tells the server and it closes the
      // session, as the scene does
      const g = await modal({ title: 'Choose gender', body: 'Select the gender for this account.', buttons: ['Male', 'Female', 'Cancel'] });
      if (g === 2) { this.s.genderCancel(); return null; }
      res = await this.s.setGender(g === 1 ? 1 : 0);
      if (!res.ok) { await modal({ title: 'Login failed', body: res.message, buttons: ['OK'] }); return null; }
      account = res.account;
    }
    this.account = account;
    if (account.pinMode === 0 && !(await this.pin())) return null;
    return this.worldSelect(server);
  }

  async pin() {
    let mode = await this.s.pinStart();
    for (;;) {
      if (mode === 0) return true;
      if (mode === 1) {
        const a = await promptText('Register PIN', 'Choose a 4-digit PIN.', { password: true, pattern: /^\d{4}$/ });
        if (a === null) { this.s.pinRegisterCancel(); return false; }
        const b = await promptText('Register PIN', 'Enter the PIN again.', { password: true, pattern: /^\d{4}$/ });
        if (b === null) { this.s.pinRegisterCancel(); return false; }
        if (a !== b) { toast('PINs did not match'); continue; }
        return (await this.s.pinRegister(a)) === 0;   // 0 = registered
      }
      if (mode === 3) { await modal({ title: 'PIN', body: 'The PIN service failed. Please log in again.', buttons: ['OK'] }); return false; }
      const p = await promptText('Enter PIN', mode === 2 ? 'Wrong PIN. Try again.' : 'Enter your 4-digit PIN.', { password: true, pattern: /^\d{4}$/ });
      if (p === null) { this.s.pinCancel(); return false; }
      mode = await this.s.pinCheck(p);
    }
  }

  async worldSelect(server) {
    let worlds = await this.s.worlds();
    for (;;) {
      const pick = await new Promise((resolve) => {
        const list = el('div', { class: 'panel worlds' }, el('h2', {}, 'Select a world'),
          ...worlds.map((w) => el('div', { class: 'world' },
            el('div', { class: 'world-name' }, w.name, w.event ? el('span', { class: 'hint' }, ` ${w.event}`) : ''),
            el('div', { class: 'channels' }, ...w.channels.map((c) => el('button', { onclick: () => resolve({ w, c }) },
              `Ch. ${c.id + 1}`, el('div', { class: 'load', style: `--load:${Math.min(100, c.load / 10)}%` })))))));
        this.screen(list);
      });
      const res = await this.charSelect(server, pick.w, pick.c);
      if (res) return res;
      // back from character select: the load bars were stale, so ask again (SERVERLIST_REREQUEST)
      worlds = await this.s.worlds(true);
    }
  }

  async charSelect(server, world, channel) {
    for (;;) {
      const list = await this.s.chars(world.id, channel.id);
      if (list.full || list.status) { await modal({ title: world.name, body: 'This world is full or the channel is unavailable.', buttons: ['OK'] }); return null; }
      const action = await new Promise((resolve) => {
        const key = list.chars.map((c) => c.stats.id).join(',');
        if (this.cardKey !== key) {
          // cache the expensive part (look load + preload); canvases redraw in place on reuse
          this.cardCanvases = new Map(list.chars.map((c) => {
            const canvas = el('canvas', { width: 120, height: 110 });
            this.preview(canvas, c.look).catch((e) => console.error(e));
            return [c.stats.id, canvas];
          }));
          this.cardKey = key;
        }
        const cards = list.chars.map((c) => el('div', { class: 'char-card', onclick: () => resolve({ select: c }) },
          this.cardCanvases.get(c.stats.id),
          el('div', { class: 'char-name' }, c.stats.name),
          el('div', { class: 'hint' }, `Lv. ${c.stats.level} ${jobName(c.stats.job)}`)));
        const canCreate = list.chars.length < list.slots;
        this.screen(el('div', { class: 'panel chars' },
          el('h2', {}, `${world.name} - Channel ${channel.id + 1}`),
          el('div', { class: 'char-list' }, ...cards, canCreate ? el('div', { class: 'char-card new', onclick: () => resolve({ create: true }) }, '+ New character') : ''),
          el('div', { class: 'row' }, el('button', { onclick: () => resolve({ back: true }) }, 'Back to worlds'))));
      });
      if (action.back) return null;
      if (action.create) { await this.creator(); continue; }
      const c = action.select;
      let pic = '';
      if (list.picFlag === 0) {
        pic = await promptText('Register PIC', 'Create a PIC (6-16 characters) to protect your characters.', { password: true, pattern: /^.{6,16}$/ });
        if (pic === null) continue;
        // registered twice, as the scene does: one masked prompt commits a typo permanently
        const again = await promptText('Register PIC', 'Enter the PIC again.', { password: true, pattern: /^.{6,16}$/ });
        if (again === null) continue;
        if (again !== pic) { toast('PICs did not match'); continue; }
      } else if (list.picFlag === 1) {
        pic = await promptText('Enter PIC', `Enter your PIC to play ${c.stats.name}.`, { password: true, pattern: /^.{6,16}$/ });
        if (pic === null) continue;
      }
      const res = await this.s.selectChar(c.stats.id, pic);
      if (res.wrongPic) { toast('Wrong PIC'); continue; }
      if (res.code !== undefined) { await modal({ title: 'Cannot enter', body: `Cannot enter the game (${res.code}).`, buttons: ['OK'] }); continue; }
      this.s.close();
      return { server, charId: c.stats.id, port: res.port, world: world.id, channel: channel.id, stats: c.stats, look: c.look };
    }
  }

  /** alive(): when given and it answers false after the loads, a later click has won and nothing is drawn. */
  async preview(canvas, look, action = 'stand1', alive = null) {
    const cl = new CharacterLook(this.assets, { skin: look.skin, face: look.face, hair: look.hair, gender: look.gender, equips: lookEquipIds(look) });
    await cl.load();
    await this.assets.preload(lookCanvases(cl, [action]));
    if (alive && !alive()) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawParts(ctx, this.assets, cl.compose(action, 0), canvas.width / 2, canvas.height - 12, false);
  }

  async creator() {
    const info = (await this.assets.json('Etc/MakeCharInfo.img'))?.Info;
    const female = this.account.gender === 1;
    const opts = info?.[female ? 'CharFemale' : 'CharMale'];
    if (!opts) { toast('Etc/MakeCharInfo.img missing'); return; }
    const list = (k) => Object.values(opts[k]);
    const LABELS = ['Face', 'Hair', 'Hair color', 'Skin', 'Top', 'Bottom', 'Shoes', 'Weapon'];
    const sel = [0, 0, 0, 0, 0, 0, 0, 0];
    const value = (k) => list(k)[sel[k]];
    const canvas = el('canvas', { width: 160, height: 140, class: 'creator-preview' });
    // last click wins even if an earlier look loads last (the scene's build counter)
    let build = 0;
    const redraw = () => {
      const n = ++build;
      this.preview(canvas, {
        skin: value(3), face: value(0), hair: value(1) + value(2),
        equips: { 5: value(4), 6: value(5), 7: value(6), 11: value(7) }, cashWeapon: 0,
      }, 'stand1', () => n === build).catch((e) => console.error(e));
    };
    const name = el('input', { placeholder: 'Character name', maxlength: 12 });
    const rows = LABELS.map((label, k) => {
      const out = el('span', { class: 'opt-val' }, `${sel[k] + 1}/${list(k).length}`);
      const step = (d) => { sel[k] = (sel[k] + d + list(k).length) % list(k).length; out.textContent = `${sel[k] + 1}/${list(k).length}`; redraw(); };
      return el('div', { class: 'opt' }, el('span', {}, label), el('button', { type: 'button', onclick: () => step(-1) }, '<'), out, el('button', { type: 'button', onclick: () => step(1) }, '>'));
    });
    redraw();
    await new Promise((resolve) => {
      // one Create at a time: a double-click used to send two CREATE_CHAR packets for the same name
      let busy = false;
      const create = async () => {
        if (busy) return;
        busy = true;
        try {
          const n = name.value.trim();
          if (!/^[a-zA-Z0-9]{4,12}$/.test(n)) { toast('Names are 4-12 letters or digits'); return; }
          // CHAR_NAME_RESPONSE: 0 free, 1 taken, 2 not allowed
          const r = await this.s.checkName(n);
          if (r === 1) { toast('That name is taken'); return; }
          if (r !== 0) { toast('That name is not allowed'); return; }
          const c = await this.s.createChar({
            name: n, job: 1, face: value(0), hair: value(1), hairColor: value(2), skin: value(3),
            top: value(4), bottom: value(5), shoes: value(6), weapon: value(7), gender: female ? 1 : 0,
          });
          if (!c) { toast('The server refused this character'); return; }
          resolve();
        } finally { busy = false; }
      };
      this.screen(el('div', { class: 'panel creator' }, el('h2', {}, 'Create an Explorer'),
        el('div', { class: 'creator-body' }, canvas, el('div', { class: 'opts' }, ...rows)),
        name, el('div', { class: 'row' }, el('button', { class: 'primary', onclick: create }, 'Create'), el('button', { onclick: resolve }, 'Cancel'))));
      name.focus();
    });
  }
}

export function promptText(title, text, { password = false, pattern = null } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type: password ? 'password' : 'text' });
    const done = (v) => { removeEventListener('keydown', onKey, true); overlay.remove(); resolve(v); };
    const ok = () => { if (pattern && !pattern.test(input.value)) { input.classList.add('bad'); return; } done(input.value); };
    // a corrected field stops looking invalid; Escape is the Cancel button
    input.addEventListener('input', () => input.classList.remove('bad'));
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    const overlay = el('div', { class: 'modal-overlay' }, el('form', { class: 'panel modal', onsubmit: (e) => { e.preventDefault(); ok(); } },
      el('h3', {}, title), el('p', {}, text), input,
      el('div', { class: 'row' }, el('button', { class: 'primary', type: 'submit' }, 'OK'), el('button', { type: 'button', onclick: () => done(null) }, 'Cancel'))));
    document.body.append(overlay);
    addEventListener('keydown', onKey, true);
    input.focus();
  });
}
