import { GameMap } from '../map.js';
import { LoginSession } from '../net/login.js';
import { wsTransport } from '../net/connection.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { lookEquipIds } from '../net/proto.js';
import { jobName } from '../data.js';
import { WzSprite, WzButton, TextField, uiText, wrapText } from './wzui.js';
import { bridgeUrl } from './login-ui.js';
import { music, sfx } from '../audio.js';

/**
 * v83 login, drawn like the original client: the UI/MapLogin.img scene inside the Common/frame
 * "book", with the camera panning down one 600px step per screen, and UI.wz/Login.img sprites
 * for every signboard, button and dialog.
 */
export const W = 800, H = 600;
const STEP = { title: 0, world: -600, char: -1200, race: -1785, create: -2400 };

/**
 * Per-race creation boards (Login.img NewChar / NewCharKnight / NewCharAran). Offsets are relative
 * to the board's top-left and were measured from each board's sprite. job = CREATE_CHAR job type.
 */
const RACES = {
  knight: {
    job: 0, ui: 'NewCharKnight', info: 'PremiumChar', board: { x: 476, y: 58 },
    nameField: [26, 104, 150], nameCheck: [30, 184], nameNo: [100, 176],
    rows: [14, 112], yes: [35, 329], no: [120, 329],
  },
  normal: {
    job: 1, ui: 'NewChar', info: 'Char', board: { x: 478, y: 58 },
    // CHECK beside the label, OK / Cancel on the bottom plank (all cut from charName / charSet)
    nameField: [32, 104, 142], nameCheck: [131, 66], nameYes: [28, 178], nameNo: [101, 177],
    rows: [11, 110], yes: [37, 331], no: [110, 330],
  },
  aran: {
    job: 2, ui: 'NewCharAran', info: 'OrientChar', board: { x: 440, y: 58 },
    // no room by the label, so CHECK (the Cygnus one, 47x21) sits in the slot's right end
    nameField: [33, 92, 92], nameCheck: [131, 93], checkUi: 'NewCharKnight', nameNo: [120, 140],
    rows: [36, 92], yes: [50, 268], no: [150, 268],
  },
};
// Delete results (DeleteCharHandler) -> Notice/text
const DELETE_NOTICE = { 0x14: 42, 0x16: 34, 0x1A: 'This character has a pending world transfer.', 0x1D: 'Leave your family before deleting this character.', 0x09: 25 };
// world (0, stepY) appears here on screen, so the scene sits inside the book's page
const VIEW_X = 385, VIEW_Y = 330;
// world tags (filled or empty) hanging from the world select rod: 15 of them, one under each of its strings (27px apart)
const WORLD_TAGS = 15, TAG_STEP = 27;

// Login.img/Notice/text/<n> (pre-rendered messages)
export const NOTICE = {
  WRONG_PASSWORD: 3, NOT_REGISTERED: 20, BLOCKED: 16, ALREADY_LOGGED_IN: 17, UNKNOWN: 18, TOO_MANY: 19,
  CANT_LOG_GAME: 22, CANT_CONNECT: 23, CONNECT_ERROR: 24, NAME_RESTRICTED: 0, NAME_IN_USE: 5, NAME_OK: 6,
  NO_MORE_CHARS: 9, DELETE_CONFIRM: 13, SELECT_CHANNEL: 37, PIC_WRONG: 42,
};
const LOGIN_REASON_TO_NOTICE = { 2: 16, 3: 16, 4: 3, 5: 20, 7: 17, 10: 19, 13: 21, 16: 33, 21: 33 };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export class LoginScene {
  constructor(root, assets) {
    this.root = root; this.assets = assets;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.canvas.className = 'login-canvas';
    this.layer = document.createElement('div');
    this.layer.className = 'login-layer';
    root.replaceChildren(this.canvas, this.layer);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.camY = 0; this.camTarget = 0;
    this.screen = null; this.dialogs = [];
    this.mouse = { x: -1, y: -1 };
    this.fields = [];
  }

  // ------------------------------------------------------------------ setup / loop
  async init() {
    const a = this.assets;
    this.L = await a.json('UI/Login.img');
    this.scene = new GameMap(a, 0);
    await this.scene.load(null, { path: 'UI/MapLogin.img', life: false });
    // drop the Neo City promo art from the world select backdrop
    for (const l of this.scene.layers) l.objs = l.objs.filter((o) => !(o.l0 === 'WorldSelect' && o.l1 === 'neoCity'));
    music.play(this.scene.info.bgm || 'BgmUI/Title');
    this.frame = new WzSprite(this.L.Common.frame, W / 2, H / 2); // origin (400, 300)
    await a.preload(this.frame.frames());
    this.servers = await fetch('/servers.json').then((r) => r.json()).catch(() => ['cosmic']);
    this.bindInput();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - (this.lastT || t)) / 1000); this.lastT = t;
      this.update(dt); this.draw();
      if (!this.stopped) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const relayout = () => this.layoutFields();
    addEventListener('resize', relayout);
    new ResizeObserver(relayout).observe(this.canvas);
  }

  destroy() {
    this.stopped = true;
    for (const f of this.fields) f.remove();
    this.root.replaceChildren();
  }

  bindInput() {
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    this.canvas.addEventListener('pointermove', (e) => { this.mouse = pos(e); this.hover(); });
    // hit-test at the press/release position itself, so taps and clicks without a prior move work
    this.canvas.addEventListener('pointerdown', (e) => {
      this.mouse = pos(e); this.hover();
      for (const b of this.buttons()) b.down = b.enabled && b.hit(this.mouse.x, this.mouse.y);
      this.topLayer()?.onPointer?.(this.mouse.x, this.mouse.y);
    });
    addEventListener('pointerup', (e) => {
      this.mouse = pos(e);
      const target = this.buttons().find((b) => b.down && b.enabled && b.hit(this.mouse.x, this.mouse.y));
      for (const b of this.buttons()) b.down = false;
      this.hover();
      if (target) { sfx.play(target.sound || 'UI/BtMouseClick'); target.onClick?.(); }   // a button may have its own click sound
    });
    addEventListener('keydown', (e) => {
      const top = this.topLayer();
      if (e.key === 'Enter' && top?.onEnter) { e.preventDefault(); top.onEnter(); }
      else if (e.key === 'Escape' && top?.onEscape) { e.preventDefault(); top.onEscape(); }
    });
  }

  topLayer() { return this.dialogs[this.dialogs.length - 1] || this.screen; }
  /** Only the top layer (dialog over screen) takes clicks, like the client's modal notices. */
  buttons() { return this.topLayer()?.buttons || []; }
  hover() {
    let any = false;
    for (const l of [this.screen, ...this.dialogs]) for (const b of l?.buttons || []) b.hover = false;
    let over = null;
    for (const b of this.buttons()) { b.hover = b.visible && b.hit(this.mouse.x, this.mouse.y); any ||= b.hover && b.enabled; if (b.hover && b.enabled) over = b; }
    if (over && over !== this.hovered) sfx.play('UI/BtMouseOver');
    this.hovered = over;
    const hot = this.topLayer()?.hotspots?.some((h) => inRect(this.mouse, h));
    this.canvas.style.cursor = any || hot ? 'pointer' : 'default';
  }

  update(dt) {
    this.camY += (this.camTarget - this.camY) * (1 - Math.exp(-dt * 6));
    if (Math.abs(this.camTarget - this.camY) < 0.5) this.camY = this.camTarget;
    this.scene.update(dt);
    const ms = dt * 1000;
    for (const l of [this.screen, ...this.dialogs]) {
      for (const b of l?.buttons || []) b.update(ms);
      for (const s of l?.sprites || []) s.update(ms);
      l?.update?.(dt);
    }
    // inputs only show once the camera has arrived (the client fades them in the same way)
    const settled = this.camY === this.camTarget;
    for (const f of this.fields) f.show(settled && !f.hidden);
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const cam = { x: -VIEW_X, y: this.camY - VIEW_Y, w: W, h: H };
    this.scene.drawBacks(ctx, cam, false);
    // scene layers above the screen's uiLayer (e.g. the title light rays) draw over its buttons
    const ui = this.screen?.uiLayer ?? 7;
    for (let l = 0; l <= ui; l++) this.scene.drawLayer(ctx, cam, l);
    // screen content scrolls with the scene while the camera pans
    const dy = Math.round(this.camTarget - this.camY);
    if (this.screen) {
      ctx.save(); ctx.translate(0, dy);
      this.drawLayerContent(ctx, this.screen);
      ctx.restore();
    }
    for (let l = ui + 1; l < 8; l++) this.scene.drawLayer(ctx, cam, l);
    this.scene.drawBacks(ctx, cam, true);
    this.frame.draw(ctx, this.assets);
    // step banner and navigation buttons sit on the book's border, above the frame
    for (const o of this.screen?.over || []) o.draw(ctx, this.assets);
    for (const d of this.dialogs) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);
      this.drawLayerContent(ctx, d);
    }
  }

  drawLayerContent(ctx, l) {
    l.drawBack?.(ctx);
    for (const s of l.sprites || []) s.draw(ctx, this.assets);
    const over = new Set(l.over || []);
    for (const b of l.buttons || []) if (!over.has(b)) b.draw(ctx, this.assets);
    l.drawFront?.(ctx);
  }

  layoutFields() {
    const r = this.canvas.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    const box = { left: r.left - root.left, top: r.top - root.top };
    for (const f of this.fields) f.layout(box, r.width / W);
  }

  field(x, y, w, h, opts) {
    const f = new TextField(this.layer, x, y, w, h, opts);
    this.fields.push(f);
    this.layoutFields();
    return f;
  }
  clearFields(keep = []) {
    for (const f of this.fields) if (!keep.includes(f)) f.remove();
    this.fields = this.fields.filter((f) => keep.includes(f));
  }

  async setScreen(layer, step) {
    const parts = [...(layer.buttons || []), ...(layer.sprites || []), ...(layer.over || [])];
    await this.assets.preload([...parts.flatMap((p) => p.frames()), ...(layer.preload || [])]);
    this.screen = layer;
    this.camTarget = STEP[step];
    this.hover();
  }

  button(node, x, y, onClick) { return new WzButton(node, x, y, onClick); }

  // ------------------------------------------------------------------ dialogs
  /** Login.img/Notice dialog. text: Notice/text index or a string. buttons: 'ok' | 'yesno'. */
  async notice(text, buttons = 'ok') {
    const N = this.L.Notice;
    const x = (W - 362) / 2, y = (H - 219) / 2;
    return new Promise((resolve) => {
      const d = { buttons: [], sprites: [new WzSprite(N.backgrnd[buttons === 'yesno' ? 1 : 0], x, y)] };
      if (typeof text === 'number' && N.text[text]) d.sprites.push(new WzSprite(N.text[text], x + 112, y + 30));
      else d.drawFront = (ctx) => wrapText(ctx, String(text), 210).slice(0, 7).forEach((ln, i) => uiText(ctx, ln, x + 114, y + 40 + i * 15, { color: '#5a3200' }));
      const close = (v) => { this.dialogs.splice(this.dialogs.indexOf(d), 1); this.hover(); resolve(v); };
      if (buttons === 'yesno') {
        d.buttons.push(this.button(N.BtYes, x + 196, y + 172, () => close(true)), this.button(N.BtNo, x + 276, y + 172, () => close(false)));
        d.onEscape = () => close(false);
      } else d.buttons.push(this.button(N.BtYes, x + 276, y + 172, () => close(true)));
      d.onEnter = () => close(true);
      this.assets.preload([...d.sprites.flatMap((s) => s.frames()), ...d.buttons.flatMap((b) => b.frames())]).then(() => { this.dialogs.push(d); this.hover(); });
    });
  }

  /** Pincode-style prompt with one input line. Resolves with the text or null. */
  async prompt(label, { password = true, pattern = null, max = 16 } = {}) {
    const P = this.L.Pincode, N = this.L.Notice;
    const x = (W - 362) / 2, y = (H - 219) / 2;
    let onOk = () => {}, onCancel = () => {};
    const d = {
      sprites: [new WzSprite(P.backgrnd[0], x, y)],
      buttons: [this.button(N.BtYes, x + 196, y + 172, () => onOk()), this.button(N.BtNo, x + 276, y + 172, () => onCancel())],
    };
    await this.assets.preload([...d.sprites, ...d.buttons].flatMap((p) => p.frames()));
    return new Promise((resolve) => {
      const keep = [...this.fields];
      // the input only appears together with its dialog, so Enter can't reach the screen behind
      const f = this.field(x + 114, y + 112, 200, 20, { password, max, color: '#000' });
      let bad = false;
      d.drawFront = (ctx) => {
        wrapText(ctx, label, 210).slice(0, 4).forEach((ln, i) => uiText(ctx, ln, x + 114, y + 40 + i * 15, { color: '#5a3200', bold: i === 0 }));
        ctx.fillStyle = bad ? 'rgba(255,90,90,0.35)' : 'rgba(255,255,255,0.75)';
        ctx.fillRect(x + 112, y + 110, 204, 24);
        ctx.strokeStyle = '#a8763c'; ctx.strokeRect(x + 112.5, y + 110.5, 203, 23);
      };
      const close = (v) => { this.dialogs.splice(this.dialogs.indexOf(d), 1); this.clearFields(keep); this.hover(); resolve(v); };
      const ok = () => { if (pattern && !pattern.test(f.value)) { bad = true; f.focus(); return; } close(f.value); };
      onOk = ok; onCancel = () => close(null);
      d.onEnter = ok; d.onEscape = onCancel;
      this.dialogs.push(d); this.hover();
      setTimeout(() => f.focus(), 50);
    });
  }

  /** Terms of service (Login.img/TOS) with Accept / Decline. */
  async tos() {
    const T = this.L.TOS[0], N = this.L.Notice;
    return new Promise((resolve) => {
      const d = { buttons: [], sprites: [new WzSprite(T, W / 2, H / 2)] };
      const close = (v) => { this.dialogs.splice(this.dialogs.indexOf(d), 1); this.hover(); resolve(v); };
      d.buttons.push(this.button(N.BtYes, W / 2 - 80, H / 2 + 165, () => close(true)), this.button(N.BtNo, W / 2 + 5, H / 2 + 165, () => close(false)));
      d.onEscape = () => close(false);
      this.assets.preload([...d.sprites.flatMap((s) => s.frames()), ...d.buttons.flatMap((b) => b.frames())]).then(() => { this.dialogs.push(d); this.hover(); });
    });
  }

  /** Login.img/Gender: pick male or female for a new account. */
  async gender() {
    const G = this.L.Gender;
    const x = (W - 362) / 2, y = (H - 219) / 2;
    return new Promise((resolve) => {
      let pick = 0;
      const d = { buttons: [], sprites: [new WzSprite(G.backgrnd[0], x, y)], hotspots: [] };
      const opts = [{ label: 'Male', r: { x: x + 120, y: y + 100, w: 90, h: 22 } }, { label: 'Female', r: { x: x + 220, y: y + 100, w: 90, h: 22 } }];
      d.hotspots = opts.map((o) => o.r);
      d.onPointer = (mx, my) => opts.forEach((o, i) => { if (inRect({ x: mx, y: my }, o.r)) pick = i; });
      d.drawFront = (ctx) => {
        uiText(ctx, 'Please choose your gender.', x + 114, y + 45, { color: '#5a3200', bold: true });
        uiText(ctx, 'This cannot be changed later.', x + 114, y + 62, { color: '#5a3200' });
        opts.forEach((o, i) => {
          ctx.fillStyle = i === pick ? '#f4c06a' : 'rgba(255,255,255,0.6)'; ctx.fillRect(o.r.x, o.r.y, o.r.w, o.r.h);
          ctx.strokeStyle = '#a8763c'; ctx.strokeRect(o.r.x + 0.5, o.r.y + 0.5, o.r.w - 1, o.r.h - 1);
          uiText(ctx, o.label, o.r.x + o.r.w / 2, o.r.y + 5, { color: '#5a3200', align: 'center', bold: i === pick });
        });
      };
      const close = (v) => { this.dialogs.splice(this.dialogs.indexOf(d), 1); this.hover(); resolve(v); };
      d.buttons.push(this.button(G.BtYes, x + 196, y + 172, () => close(pick)), this.button(G.BtNo, x + 276, y + 172, () => close(null)));
      d.onEnter = () => close(pick);
      this.assets.preload([...d.sprites.flatMap((s) => s.frames()), ...d.buttons.flatMap((b) => b.frames())]).then(() => { this.dialogs.push(d); this.hover(); });
    });
  }

  // ------------------------------------------------------------------ flow
  /** Same contract as LoginFlow.run(): resolves with the chosen character + channel port. */
  async run() {
    await this.init();
    for (;;) {
      const creds = await this.titleScreen();
      try {
        const res = await this.session(creds);
        if (res) { this.destroy(); return res; }
      } catch (e) {
        console.error(e);
        await this.notice(NOTICE.CANT_CONNECT);
      }
      this.s?.close();
    }
  }

  titleScreen() {
    const T = this.L.Title;
    // the Title signboard object sits at (338, 233) on screen
    const sx = 338, sy = 233;
    return new Promise((resolve) => {
      this.clearFields();
      const id = this.field(sx + 116, sy + 24, 145, 22, { max: 13, color: '#fff' });
      const pw = this.field(sx + 116, sy + 53, 145, 22, { password: true, max: 32, color: '#fff' });
      let saveId = store.get('maple.saveid') !== '0';
      if (saveId) id.value = store.get('maple.user') || '';
      let server = this.servers.includes(store.get('maple.server')) ? store.get('maple.server') : this.servers[0];
      const submit = () => {
        if (!id.value) { id.focus(); return; }
        if (!pw.value) { pw.focus(); return; }
        store.set('maple.saveid', saveId ? '1' : '0');
        store.set('maple.user', saveId ? id.value : '');
        store.set('maple.server', server);
        const creds = { user: id.value, password: pw.value, server };
        this.clearFields();
        resolve(creds);
      };
      // rows are spaced evenly across the signboard planks (middle: x 56-365 y 89-119, bottom: x 59-363 y 129-183)
      const check = { x: sx + 73, y: sy + 93 };
      const serverBox = { x: 120, y: 470, w: 160, h: 18 };
      const layer = {
        buttons: [
          this.button(T.BtLogin, sx + 270, sy + 12, submit), // tucked against the board edge; also where its wood edges best match the signboard
          this.button(T.BtLoginIDSave, sx + 91, sy + 93, () => { saveId = !saveId; }),
          this.button(T.BtLoginIDLost, sx + 184, sy + 93, () => this.notice('Please contact the server administrator to recover your ID.')),
          this.button(T.BtPasswdLost, sx + 283, sy + 93, () => this.notice('Please contact the server administrator to reset your password.')),
          this.button(T.BtNew, sx + 70, sy + 137, () => this.notice('New IDs are registered automatically: just log in with the ID and password you want.')),
          this.button(T.BtHomePage, sx + 171, sy + 137, () => window.open('https://github.com/P0nk/Cosmic', '_blank', 'noopener')),
          this.button(T.BtQuit, sx + 271, sy + 137, () => this.notice('You can simply close this browser tab to quit.')),
        ],
        sprites: [],
        hotspots: this.servers.length > 1 ? [serverBox] : [],
        preload: [T.check[0], T.check[1]],
        uiLayer: 3, // signboard is layer 1, the light rays (Title/effect) layer 4
        onEnter: submit,
        onPointer: (mx, my) => {
          if (this.servers.length > 1 && inRect({ x: mx, y: my }, serverBox)) server = this.servers[(this.servers.indexOf(server) + 1) % this.servers.length];
        },
        drawFront: (ctx) => {
          const img = this.assets.image(T.check[saveId ? 1 : 0]);
          if (img) ctx.drawImage(img, check.x, check.y);
          if (this.servers.length > 1) {
            ctx.fillStyle = 'rgba(60,30,0,0.55)'; ctx.fillRect(serverBox.x, serverBox.y, serverBox.w, serverBox.h);
            uiText(ctx, `Server: ${server}  (click to change)`, serverBox.x + 6, serverBox.y + 3, { color: '#ffe9b0', size: 11 });
          }
        },
      };
      this.setScreen(layer, 'title').then(() => setTimeout(() => (id.value ? pw : id).focus(), 600));
    });
  }

  async session({ user, password, server }) {
    this.s = new LoginSession(wsTransport(bridgeUrl(server, 8484)));
    await this.s.ready();
    let res = await this.s.login(user, password);
    if (!res.ok && res.reason === 23) {
      if (!(await this.tos())) return null;
      res = await this.s.acceptTos();
    }
    if (!res.ok) {
      const n = LOGIN_REASON_TO_NOTICE[res.reason];
      await this.notice(n !== undefined ? n : res.message);
      return null;
    }
    let account = res.account;
    if (account.gender === 10) {
      const g = await this.gender();
      if (g === null) return null;
      account = (await this.s.setGender(g)).account;
    }
    this.account = account;
    if (account.pinMode === 0 && !(await this.pin())) return null;
    this.worlds = await this.s.worlds();
    return this.worldSelect(server);
  }

  async pin() {
    let mode = await this.s.pinStart();
    for (;;) {
      if (mode === 0) return true;
      if (mode === 1) {
        const a = await this.prompt('Register your PIN\nChoose a 4-digit PIN.', { pattern: /^\d{4}$/, max: 4 });
        if (a === null) return false;
        const b = await this.prompt('Register your PIN\nEnter the same PIN again.', { pattern: /^\d{4}$/, max: 4 });
        if (b === null) return false;
        if (a !== b) { await this.notice('The PINs do not match. Please try again.'); continue; }
        await this.s.pinRegister(a);
        return true;
      }
      const p = await this.prompt(mode === 2 ? 'Wrong PIN\nPlease enter your PIN again.' : 'Enter your PIN\nPlease enter your 4-digit PIN.', { pattern: /^\d{4}$/, max: 4 });
      if (p === null) return false;
      mode = await this.s.pinCheck(p);
    }
  }

  // ------------------------------------------------------------------ world / channel
  worldSelect(server) {
    const WS = this.L.WorldSelect, C = this.L.Common;
    return new Promise((resolve, reject) => {
      let world = null, channel = 0;
      const tabX = 245, tabY = 118;                    // the first tag hangs from the rod's third string past the scroll's left end
      // WorldSelect/scroll unrolls over the scene's rolled-up scroll (signboard/2, top-left 171,101);
      // chBackgrn is that scroll's paper: 38,146 into the open frame
      const roll = { x: 171, y: 101 };
      const win = { x: roll.x + 38, y: roll.y + 146 };
      let scroll = null, closing = false;              // the unroll / roll-up animation while it plays or holds open
      const opened = () => !!world && !!scroll && !closing && scroll.anim.done;
      let chButtons = [];
      const go = async () => {
        if (!opened()) return;
        try {
          const res = await this.charSelect(server, world, world.channels[channel]);
          if (res) resolve(res); else this.setScreen(layer, 'world');
        } catch (e) { reject(e); }
      };
      const openWorld = (w) => {
        if (!world || closing) { scroll = new WzSprite(WS.scroll[0], roll.x, roll.y, { loop: false }); closing = false; sfx.play('UI/RollDown'); }
        world = w; channel = 0;
        // four columns centred on the paper, rows from just under the header rule (y 52)
        chButtons = w.channels.map((c, i) => {
          const node = WS.channel[i] || WS.channel[0];
          const b = new WzButton({ normal: node.normal, disabled: node.disabled }, win.x + 20 + (i % 4) * 106, win.y + 60 + Math.floor(i / 4) * 31, () => {
            if (channel === i && performance.now() - (b.lastClick || 0) < 400) go(); // double-click enters
            if (channel !== i) select.anim.reset();
            channel = i; b.lastClick = performance.now();
          });
          b.load = c.load; b.sound = 'UI/WorldSelect';
          return b;
        });
        this.assets.preload([...chButtons.flatMap((b) => b.frames()), WS.channel.chgauge, ...select.frames()]).then(() => this.hover());
      };
      const closeWorld = () => {
        if (!world) return;
        world = null; closing = true;
        scroll = new WzSprite(WS.scroll[1], roll.x, roll.y, { loop: false });
      };
      const worldButtons = this.worlds.map((w, i) => this.button(WS.BtWorld[w.id] || WS.BtWorld[0], tabX + i * TAG_STEP, tabY, () => openWorld(w)));
      // places no world takes hang an empty plank (BtWorld/e), as in the client
      const blanks = Array.from({ length: Math.max(0, WORLD_TAGS - this.worlds.length) },
        (_, i) => new WzSprite(WS.BtWorld.e.normal, tabX + (this.worlds.length + i) * TAG_STEP, tabY));
      const goBtn = this.button(WS.BtGoworld, win.x + 331, win.y + 6, go);
      const exitBtn = this.button(C.BtExit, 12, 520, () => { this.s.close(); location.reload(); });
      const select = new WzSprite(WS.channel.chSelect, 0, 0, { loop: false }); // swirls in once per selection
      const layer = {
        // channel window buttons only exist once the scroll is open
        get buttons() { return opened() ? [...worldButtons, exitBtn, ...chButtons, goBtn] : [...worldButtons, exitBtn]; },
        sprites: blanks,
        over: [new WzSprite(C.step[1], 0, 36), exitBtn],
        preload: [WS.chBackgrn, goBtn.frames(), ...blanks.flatMap((b) => b.frames()), ...Object.values(WS.world).filter((n) => n?._canvas),
          ...new WzSprite(WS.scroll[0]).frames(), ...new WzSprite(WS.scroll[1]).frames()].flat(),
        onEnter: go,
        onEscape: closeWorld,
        update: (dt) => {
          select.update(dt * 1000);
          // hold the unroll until the camera has arrived, so it is seen
          if (scroll && this.camY === this.camTarget) {
            scroll.update(dt * 1000);
            if (closing && scroll.anim.done) { scroll = null; closing = false; }
          }
        },
        drawBack: (ctx) => {  // under the buttons
          scroll?.draw(ctx, this.assets);
          if (!opened()) return;
          const bg = this.assets.image(WS.chBackgrn);
          if (bg) ctx.drawImage(bg, win.x, win.y);
          const name = WS.world[world.id] && this.assets.image(WS.world[world.id]);
          if (name) ctx.drawImage(name, win.x + 12, win.y + 3);
          else uiText(ctx, world.name, win.x + 20, win.y + 16, { color: '#5a3200', bold: true, size: 14 });
        },
        drawFront: (ctx) => {  // load gauges (on each button's track at 7,15) and the selection swirl round the CH label
          if (!opened()) return;
          const gauge = this.assets.image(WS.channel.chgauge);
          for (const b of chButtons) {
            if (!gauge) break;
            const w = Math.max(1, Math.round(gauge.width * Math.min(1, (b.load || 0) / 1000)));
            ctx.drawImage(gauge, 0, 0, w, gauge.height, b.x + 7, b.y + 15, w, gauge.height);
          }
          const sb = chButtons[channel];
          if (sb) { select.x = sb.x + 18; select.y = sb.y + 8; select.draw(ctx, this.assets); }
        },
      };
      sfx.play('UI/ScrollUp');   // the whoosh as the camera leaves the title for world select
      this.setScreen(layer, 'world');   // no world is open until one is clicked
    });
  }

  // ------------------------------------------------------------------ character select
  async charSelect(server, world, channel) {
    const list = await this.s.chars(world.id, channel.id);
    if (list.error) { await this.notice(NOTICE.SELECT_CHANNEL); return null; }
    const CS = this.L.CharSelect, C = this.L.Common;
    const objCS = (await this.assets.json('Map/Obj/login.img'))?.CharSelect;
    const looks = await Promise.all(list.chars.map(async (c) => {
      const cl = new CharacterLook(this.assets, { skin: c.look.skin, face: c.look.face, hair: c.look.hair, equips: lookEquipIds(c.look) });
      await cl.load();
      await this.assets.preload(lookCanvases(cl, ['stand1', 'walk1']));
      return cl;
    }));
    return new Promise((resolve, reject) => {
      // the buttons run outside session(): a lost connection or a server that never answers is handed to
      // it through reject (back to the title with the can't-connect notice), and one click runs at a time
      let busy = false;
      const guard = (fn) => async () => {
        if (busy) return;
        busy = true;
        try { await fn(); } catch (e) { reject(e); } finally { busy = false; }
      };
      let page = 0, sel = list.chars.length ? 0 : -1;
      const perPage = 3;
      const shown = Math.min(list.slots, list.chars.length + 1); // characters plus the next free slot
      const slotX = (i) => 318 + i * 120, footY = 390; // on top of the bridge deck logs (y 391-419)
      const anim = list.chars.map(() => ({ frame: 0, t: 0 }));
      const glow = new WzSprite(CS.character[0], 0, 0);
      const info = new WzSprite(CS.charInfo, 0, 0);
      // the selected character gets a beam of light (grows once, then holds) with sparkles rising round it;
      // both anchor 337px above the feet, the beam's full height
      const beam = new WzSprite(CS.effect[1], 0, 0, { loop: false });
      const sparkle = new WzSprite(CS.effect[0], 0, 0);
      // empty slots show a pulsing ghost on a shadow
      const ghost = objCS && new WzSprite(objCS.character[1], 0, 0), ghostShadow = objCS && new WzSprite(objCS.character[0], 0, 0);
      // stats sit on a small scroll that unrolls (scroll/0) on each selection; charInfo is 17,22 into the open scroll
      const scrollAt = { x: 104, y: 120 };
      let infoScroll = new WzSprite(CS.scroll[0], scrollAt.x, scrollAt.y, { loop: false });
      const choose = (idx) => {
        sfx.play('UI/CharSelect');   // every click on a character, even the one already selected
        if (idx === sel) return;
        sel = idx; beam.anim.reset(); sparkle.anim.reset();
        infoScroll = new WzSprite(CS.scroll[0], scrollAt.x, scrollAt.y, { loop: false });
      };
      const pick = async () => {
        if (sel < 0) return;
        const c = list.chars[sel];
        let pic = '';
        if (list.picFlag === 0) {
          pic = await this.prompt('Register your PIC\nCreate a 6-16 character 2nd password to protect your characters.', { pattern: /^.{6,16}$/ });
          if (pic === null) return;
        } else if (list.picFlag === 1) {
          pic = await this.prompt(`Enter your PIC\nEnter your 2nd password to play ${c.stats.name}.`);
          if (pic === null) return;
        }
        const res = await this.s.selectChar(c.stats.id, pic);
        if (res.wrongPic) { await this.notice(NOTICE.PIC_WRONG); return; }
        if (res.error) { await this.notice(res.error); return; }
        this.s.close();
        resolve({ server, charId: c.stats.id, port: res.port, world: world.id, channel: channel.id, channels: world.channels.length, stats: c.stats, look: c.look, gm: !!this.account?.gm });
      };
      const start = guard(pick);
      const create = async () => {
        if (list.chars.length >= list.slots) { await this.notice(NOTICE.NO_MORE_CHARS); return; }
        const race = await this.raceSelect();
        if (race) await this.creator(race);
        resolve(await this.charSelect(server, world, channel));
      };
      const remove = async () => {
        if (sel < 0) return;
        const c = list.chars[sel];
        if (list.picFlag !== 1) { await this.notice('Register a PIC first: start the game with any character once, then you can delete characters.'); return; }
        if (!(await this.notice(NOTICE.DELETE_CONFIRM, 'yesno'))) return;
        const pic = await this.prompt(`Delete ${c.stats.name}\nEnter your PIC to confirm.`);
        if (pic === null) return;
        const state = await this.s.deleteChar(c.stats.id, pic);
        if (state !== 0) { await this.notice(DELETE_NOTICE[state] ?? `The character could not be deleted (${state}).`); return; }
        resolve(await this.charSelect(server, world, channel));
      };
      const backBtn = this.button(C.BtWselect, 12, 524, () => resolve(null));
      const layer = {
        hotspots: [],
        over: [new WzSprite(C.step[2], 0, 36), backBtn],
        buttons: [
          // cut from the scene signboard (top-left 572,153) at 17,18 / 17,54 / 17,103
          this.button(CS.BtSelect, 589, 171, start),
          this.button(CS.BtNew, 589, 207, guard(create)),
          this.button(CS.BtDelete, 589, 256, guard(remove)),
          backBtn,
          ...(shown > perPage ? [
            this.button(CS.pageL[0] && { normal: CS.pageL[0], mouseOver: CS.pageL[1] || CS.pageL[0] }, 205, 400, () => { page = Math.max(0, page - 1); }),
            this.button(CS.pageR[0] && { normal: CS.pageR[0], mouseOver: CS.pageR[1] || CS.pageR[0] }, 690, 400, () => { page = Math.min(Math.floor((shown - 1) / perPage), page + 1); }),
          ] : []),
        ],
        sprites: [],
        preload: [...glow.frames(), ...info.frames(), ...beam.frames(), ...sparkle.frames(), ...infoScroll.frames(),
          ...(ghost ? [...ghost.frames(), ...ghostShadow.frames()] : []),
          ...Object.values(CS.nameTag[0] || {}), ...Object.values(CS.nameTag[1] || {})],
        onEnter: start,
        onPointer: (mx, my) => {
          for (let i = 0; i < perPage; i++) {
            const idx = page * perPage + i;
            if (idx >= list.chars.length) break;
            if (mx > slotX(i) - 35 && mx < slotX(i) + 35 && my > footY - 85 && my < footY + 20) {
              if (sel === idx && performance.now() - (this.lastCharClick || 0) < 400) start();
              choose(idx); this.lastCharClick = performance.now();
            }
          }
        },
        update: (dt) => {
          glow.update(dt * 1000); beam.update(dt * 1000); sparkle.update(dt * 1000); ghost?.update(dt * 1000);
          if (this.camY === this.camTarget) { // unroll once the camera has arrived
            if (sel >= 0 && !infoScroll.rolled) { infoScroll.rolled = true; sfx.play('UI/RollDown'); }
            infoScroll.update(dt * 1000);
          }
          list.chars.forEach((c, i) => {
            const a = anim[i], look = looks[i];
            const act = i === sel ? 'walk1' : 'stand1';
            if (a.act !== act) { a.act = act; a.frame = 0; a.t = 0; }
            a.t += dt * 1000;
            while (a.t >= look.delay(act, a.frame)) { a.t -= look.delay(act, a.frame); a.frame = (a.frame + 1) % Math.max(1, look.frameCount(act)); }
          });
        },
        drawFront: (ctx) => {
          for (let i = 0; i < perPage; i++) {
            const idx = page * perPage + i, x = slotX(i);
            if (idx >= list.chars.length) {
              if (idx < list.slots && ghost) { ghostShadow.x = ghost.x = x; ghostShadow.y = ghost.y = footY; ghostShadow.draw(ctx, this.assets); ghost.draw(ctx, this.assets); }
              continue;
            }
            const c = list.chars[idx], look = looks[idx], a = anim[idx];
            if (idx === sel) { beam.x = x; beam.y = footY - 372; beam.draw(ctx, this.assets); glow.x = x; glow.y = footY; glow.draw(ctx, this.assets); }
            drawParts(ctx, this.assets, look.compose(a.act || 'stand1', a.frame), x, footY, false);
            if (idx === sel) { sparkle.x = x; sparkle.y = footY - 337; sparkle.draw(ctx, this.assets); }
            this.nameTag(ctx, c.stats.name, x, footY + 4, CS.nameTag[idx === sel ? 1 : 0] || CS.nameTag[0]);
          }
          layer.hotspots = Array.from({ length: Math.min(perPage, list.chars.length - page * perPage) }, (_, i) => ({ x: slotX(i) - 35, y: footY - 85, w: 70, h: 105 }));
          // info panel (origin 45,57) on its scroll, once unrolled
          if (sel >= 0) {
            infoScroll.draw(ctx, this.assets);
            if (infoScroll.anim.done) this.drawCharInfo(ctx, info, list.chars[sel], scrollAt.x + 17 + 45, scrollAt.y + 22 + 57);
          }
          uiText(ctx, `${world.name} - Channel ${channel.id + 1}`, 118, 104, { color: '#fff', bold: true, outline: '#3a2200' });
        },
      };
      this.setScreen(layer, 'char').then(() => { if (sel >= 0) sfx.play('UI/CharSelect'); });   // the first character is selected on arrival
    });
  }

  // ------------------------------------------------------------------ race select
  /** Login.img/RaceSelect: Cygnus Knights / Explorers / Aran. Resolves with a RACES key or null. */
  raceSelect() {
    const R = this.L.RaceSelect, C = this.L.Common;
    return new Promise((resolve) => {
      let pick = 'normal';
      const spots = { knight: { x: 100, y: 88 }, normal: { x: 296, y: 86 }, aran: { x: 525, y: 85 } };
      const btn = { knight: R.knight.BtKnight, normal: R.normal.BtNormal, aran: R.aran.BtAran };
      const on = Object.fromEntries(Object.keys(spots).map((k) => [k, new WzSprite(R[k].OnAnimation, spots[k].x, spots[k].y)]));
      const text = Object.fromEntries(Object.keys(spots).map((k) => [k, new WzSprite(R[k].text, 112, 305)]));
      const buttons = Object.keys(spots).map((k) => this.button(btn[k], spots[k].x, spots[k].y, () => {
        if (pick === k && performance.now() - (this.lastRaceClick || 0) < 400) resolve(pick);
        pick = k; this.lastRaceClick = performance.now(); showPick();
      }));
      const select = this.button(R.BtSelect, 560, 430, () => resolve(pick)); // centred in the panel's slot (413-483, 112-137)
      const keys = Object.keys(spots);
      const showPick = () => keys.forEach((k, i) => { buttons[i].forceState = k === pick ? 'disabled' : null; });
      showPick();
      const back = this.button(C.BtWselect, 12, 524, () => resolve(null));
      this.setScreen({
        buttons: [...buttons, select, back],
        sprites: [new WzSprite(R.textGL[0], 405, 62)],
        over: [new WzSprite(C.step[3], 0, 36), back],
        preload: [...Object.values(on).flatMap((s) => s.frames()), ...Object.values(text).flatMap((s) => s.frames())],
        onEnter: () => resolve(pick), onEscape: () => resolve(null),
        update: (dt) => on[pick].update(dt * 1000),
        drawFront: (ctx) => {
          on[pick].draw(ctx, this.assets);  // the chosen race lights up in colour
          text[pick].draw(ctx, this.assets);
          select.draw(ctx, this.assets);
        },
      }, 'race');
    });
  }

  // ------------------------------------------------------------------ character creation
  /**
   * Creation with Login.img NewChar / NewCharKnight / NewCharAran: the name board (name + Check), then
   * the settings board, whose rows (FACE ... WEAPON) cycle through Etc/MakeCharInfo.img for that race.
   * Resolves once the character is created or the player backs out.
   */
  async creator(race = 'normal') {
    const cfg = RACES[race], NC = this.L[cfg.ui];
    const mci = await this.assets.json('Etc/MakeCharInfo.img');
    const female = this.account.gender === 1;
    const section = cfg.info === 'Char' ? mci?.Info : mci;
    const opts = section?.[`${cfg.info}${female ? 'Female' : 'Male'}`];
    if (!opts) { await this.notice('Etc/MakeCharInfo.img is missing.'); return; }
    const choices = (k) => Object.values(opts[k] || {});
    const sel = [0, 0, 0, 0, 0, 0, 0, 0];
    const value = (k) => choices(k)[sel[k]];
    const board = cfg.board;
    const preview = { x: 410, y: 361 }; // on the gazebo's round platform
    let look = null, frame = 0, frameT = 0, name = '';
    const at = (o) => [board.x + o[0], board.y + o[1]];

    const rebuild = async () => {
      const l = new CharacterLook(this.assets, { skin: value(3), face: value(0), hair: value(1) + value(2), equips: [value(4), value(5), value(6), value(7)] });
      await l.load();
      await this.assets.preload(lookCanvases(l, ['stand1']));
      look = l; frame = 0; frameT = 0;
    };
    await rebuild();
    const drawPreview = (ctx) => {
      if (!look) return;
      drawParts(ctx, this.assets, look.compose('stand1', frame), preview.x, preview.y, true);
      if (name) this.nameTag(ctx, name, preview.x, preview.y + 4, this.L.CharSelect.nameTag[1]);
    };
    const tick = (dt) => {
      if (!look) return;
      frameT += dt * 1000;
      while (frameT >= look.delay('stand1', frame)) { frameT -= look.delay('stand1', frame); frame = (frame + 1) % Math.max(1, look.frameCount('stand1')); }
    };
    const banner = new WzSprite(this.L.Common.step[3], 0, 36);

    for (;;) {
      // step 1: name
      const chosen = await new Promise((resolve) => {
        const keep = [...this.fields];
        const [fx, fy] = at(cfg.nameField);
        const f = this.field(fx, fy, cfg.nameField[2] || 165, 22, { max: 12, color: '#fff' });
        f.value = name;
        const done = (v) => { this.clearFields(keep); resolve(v); };
        const check = async () => {
          const n = f.value.trim();
          if (!/^[a-zA-Z0-9]{4,12}$/.test(n)) { await this.notice(NOTICE.NAME_RESTRICTED); f.focus(); return; }
          if (!(await this.s.nameAvailable(n))) { await this.notice(NOTICE.NAME_IN_USE); f.focus(); return; }
          done(n);
        };
        this.setScreen({
          sprites: [new WzSprite(NC.charName, board.x, board.y)],
          buttons: [this.button((cfg.checkUi ? this.L[cfg.checkUi] : NC).BtCheck, ...at(cfg.nameCheck), check),
            ...(cfg.nameYes ? [this.button(NC.BtYes, ...at(cfg.nameYes), check)] : []), // OK checks the name too, then moves on
            this.button(NC.BtNo, ...at(cfg.nameNo), () => done(null))],
          over: [banner],
          onEnter: check, onEscape: () => done(null), update: tick, drawFront: drawPreview,
        }, 'create').then(() => setTimeout(() => f.focus(), 650));
      });
      if (chosen === null) return;
      name = chosen;

      // step 2: settings
      const created = await new Promise((resolve) => {
        const [rx, ry] = at(cfg.rows);
        const rowY = (i) => ry + i * 19;
        const arrows = [];
        for (let k = 0; k < 8; k++) {
          if (choices(k).length < 2) continue; // fixed items (Aran gear) have no arrows
          const step = (d) => { sel[k] = (sel[k] + d + choices(k).length) % choices(k).length; rebuild(); };
          arrows.push(this.button(NC.BtLeft, rx + 102, rowY(k) + 1, () => step(-1)), this.button(NC.BtRight, rx + 183, rowY(k) + 1, () => step(1)));
        }
        const yes = async () => {
          const c = await this.s.createChar({
            name, job: cfg.job, face: value(0), hair: value(1), hairColor: value(2), skin: value(3),
            top: value(4), bottom: value(5), shoes: value(6), weapon: value(7), gender: female ? 1 : 0,
          });
          if (!c) { await this.notice('The server refused this character.'); return; }
          resolve(true);
        };
        this.setScreen({
          sprites: [new WzSprite(NC.charSet, board.x, board.y), ...Array.from({ length: 8 }, (_, k) => new WzSprite(NC.avatarSel[k].normal, rx, rowY(k)))],
          buttons: [...arrows, this.button(NC.BtYes, ...at(cfg.yes), yes), this.button(NC.BtNo, ...at(cfg.no), () => resolve(false))],
          over: [banner],
          onEnter: yes, onEscape: () => resolve(false), update: tick,
          drawFront: (ctx) => {
            drawPreview(ctx);
            for (let k = 0; k < 8; k++) uiText(ctx, `${sel[k] + 1} / ${choices(k).length}`, rx + 149, rowY(k) + 3, { color: '#5a3200', align: 'center', size: 11 });
          },
        }, 'create');
      });
      if (created) return;
      // "No" on the settings board goes back to the name board
    }
  }

  /** NameTag made of left / middle (stretched) / right pieces, like the in-game tag. */
  nameTag(ctx, text, x, y, node) {
    ctx.save(); ctx.font = '12px Arial';
    const tw = Math.ceil(ctx.measureText(text).width) + 4;
    ctx.restore();
    const l = node && this.assets.image(node[0]), m = node && this.assets.image(node[1]), r = node && this.assets.image(node[2]);
    if (l && m && r) {
      const left = Math.round(x - tw / 2 - l.width);
      ctx.drawImage(l, left, y); ctx.drawImage(m, left + l.width, y, tw, m.height); ctx.drawImage(r, left + l.width + tw, y);
    } else { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - tw / 2, y, tw, 16); }
    uiText(ctx, text, x, y + 4, { color: '#fff', align: 'center' });
  }

  drawCharInfo(ctx, info, c, x, y) {
    info.x = x; info.y = y; info.draw(ctx, this.assets);
    const o = [45, 57], left = x - o[0], top = y - o[1], s = c.stats;
    const v = (t, dx, dy) => uiText(ctx, String(t), left + dx, top + dy, { color: '#5a3200', align: 'right' });
    v(jobName(s.job), 178, 4);
    v(s.level, 88, 23); v(s.fame, 178, 23);
    v(s.str, 88, 42); v(s.int, 178, 42);
    v(s.dex, 88, 61); v(s.luk, 178, 61);
    if (c.rank) uiText(ctx, `#${c.rank.world}  (job #${c.rank.job})`, left + 92, top + 102, { color: '#5a3200', align: 'center' });
  }
}

function inRect(p, r) { return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; }
