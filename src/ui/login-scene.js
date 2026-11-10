import { GameMap } from '../map.js';
import { LoginSession } from '../net/login.js';
import { wsTransport } from '../net/connection.js';
import { CharacterLook, drawParts, lookCanvases } from '../character.js';
import { lookEquipIds } from '../net/proto.js';
import { jobName } from '../data.js';
import { WzSprite, WzButton, TextField, uiText, wrapText } from './wzui.js';
import { config } from '../config.js';
import { bridgeUrl } from './login-ui.js';
import { music, sfx } from '../audio.js';

/**
 * v83 login, drawn like the original client: the UI/MapLogin.img scene inside the Common/frame
 * "book", with the camera panning down one 600px step per screen, and UI.wz/Login.img sprites
 * for every signboard, button and dialog.
 */
export const W = 800, H = 600;
// camera y per step; creation adds 600 per race (Knight, Explorer, Aran each have their own scene)
const STEP = { title: 0, world: -600, char: -1200, race: -1800, create: -2400, vac: -600 };
const STEP_NO = { title: 0, world: 1, char: 2, race: 3, create: 4, vac: 5 };

/**
 * Per-race creation (Login.img NewCharKnight / NewChar / NewCharAran), each in its own scene 600px apart.
 * Board positions are screen positions with that race's camera; offsets inside a board are from its top-left.
 * job = CREATE_CHAR race. OK on the settings boards sits about 74px left of Cancel (measured).
 */
const RACES = {
  knight: {
    job: 0, ui: 'NewCharKnight', info: 'Info', camY: -2400,
    name: { x: 485, y: 95, yes: [31, 181], no: [104, 181], field: [36, 110] },
    set: { x: 469, y: 81, yes: [43, 330], no: [117, 330], left: 70, right: 198, rowY: 116, textX: 140, textY: 117, labelX: 12 },
  },
  normal: {
    job: 1, ui: 'NewChar', info: 'Info', camY: -3000,
    name: { x: 481, y: 95, yes: [27, 178], no: [101, 178], field: [36, 108] },
    set: { x: 481, y: 95, yes: [37, 330], no: [111, 330], left: 68, right: 196, rowY: 106, textX: 139, textY: 107, labelX: 11 },
  },
  aran: {
    job: 2, ui: 'NewCharAran', info: 'Orient', camY: -3600,
    name: { x: 476, y: 106, yes: [34, 138], no: [108, 138], field: [36, 98] },
    set: { x: 443, y: 105, yes: [64, 265], no: [138, 265], left: 86, right: 229, rowY: 86, textX: 169, textY: 87, labelX: 31 },
  },
};
// job names on the character info panel, where they differ from the in-game ones
const LOGIN_JOB = {
  100: 'Swordman', 210: 'Wizard (Fire,Poison)', 211: 'Mage(Fire, Poison)', 212: 'Arch Mage(Fire,Poison)',
  220: 'Wizard (Ice,Lightning)', 221: 'Mage(Ice,Lightning)', 222: 'Arch Mage(Ice,Lightning)', 320: 'Crossbow man', 910: 'SuperGM',
};
const loginJobName = (job) => LOGIN_JOB[job] || (job >= 1000 && job < 2000 && job % 100 ? jobName(Math.floor(job / 100) * 100) : job >= 2100 && job < 2200 ? 'Aran' : jobName(job));
// DELETE_CHAR_RESPONSE result -> Notice/text
const DELETE_NOTICE = {
  6: 15, 9: 18, 10: 19, 0x12: 11, 0x14: 93, 0x16: 34, 0x18: 39, 0x1D: 54,
  0x1A: 'You cannot delete a character that\r\n is currently going through the transfer.',
};
// map point (28, stepY - 8) is the screen centre
const VIEW_X = 372, VIEW_Y = 308;
/** Screen position of a map point while the camera is on stepY. */
const mapAt = (mx, my, stepY) => ({ x: mx + VIEW_X, y: my - stepY + VIEW_Y });
// world tags (filled or empty) hanging from the world select rod: 15 of them, one under each of its strings (27px apart)
const WORLD_TAGS = 15, TAG_STEP = 27;

// Login.img/Notice/text/<n> (pre-rendered messages)
export const NOTICE = {
  WRONG_PASSWORD: 3, NOT_REGISTERED: 20, BLOCKED: 16, ALREADY_LOGGED_IN: 17, UNKNOWN: 18, TOO_MANY: 19,
  CANT_LOG_GAME: 22, CANT_CONNECT: 23, CONNECT_ERROR: 24, NAME_IN_USE: 5, NAME_OK: 6, BAD_NAME: 10,
  NO_MORE_CHARS: 9, DELETE_CONFIRM: 13, DELETE_CONFIRM_CASH: 55, BAD_ID: 28, CREATE_BLOCKED: 36,
  PIC_WRONG: 93, NO_PIC: 94, RETURN_TO_TITLE: 7, LAUNCHER: 15,
};
// LOGIN_STATUS (and CHARLIST / SERVER_IP) result -> Notice/text
const LOGIN_NOTICE = { 3: 16, 4: 3, 5: 20, 6: 15, 7: 17, 8: 15, 9: 15, 255: 15, 10: 19, 11: 14, 13: 21, 16: 33, 21: 33, 17: 27, 25: 40 };
const WORLD_BUSY = 'Since There Are Many\r\nConcurrent Users in This World,\r\nYou May Encounter Some Difficulties During the Game Play.';
const WORLD_FULL = 'The Concurrent Users in This World\r\nHave Reached the Max.\r\nPlease Try Again Later.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NOTICE_AT = { x: 219, y: 170 }, NOTICE_SLIDE_MS = 150;
/** "Ver. %d.%d" with the client's version, 0.83. */
const VERSION_TEXT = 'Ver. 0.83';
/** UPDATE_PINCODE 0: Pincode/text/8 in words (the PIN steps here are text prompts). */
// characters on the select screen
const CHAR_FACING_RIGHT = true;
// the selected character walks on the spot, the rest stand (walk1/2 and stand1/2 by weapon)
const charAct = (look, selected) => (selected ? look.walkAction() : look.standAction());

/** Thrown to drop the session and go back to the title without the can't-connect notice. */
class BackToTitle extends Error {}

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
    this.blockReasons = await a.json('Etc/BlockReason.img');
    this.servers = await fetch('/servers.json').then((r) => r.json()).catch(() => ['cosmic']);
    this.bindInput();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - (this.lastT || t)) / 1000); this.lastT = t;
      this.update(dt); this.draw();
      if (!this.stopped) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const relayout = () => this.layoutFields();
    addEventListener('resize', relayout, { signal: this.listening.signal });
    this.resizer = new ResizeObserver(relayout);
    this.resizer.observe(this.canvas);
  }

  destroy() {
    this.stopped = true;
    // the window listeners go with the scene, so the game's keys don't reach character select
    this.listening?.abort();
    this.resizer?.disconnect();
    for (const f of this.fields) f.remove();
    this.root.replaceChildren();
  }

  bindInput() {
    this.listening = new AbortController();
    const signal = this.listening.signal;
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    this.canvas.addEventListener('pointermove', (e) => { this.mouse = pos(e); this.drag?.(this.mouse); this.hover(); });
    // hit-test at the press/release position itself, so taps and clicks without a prior move work
    this.canvas.addEventListener('pointerdown', (e) => {
      this.mouse = pos(e); this.hover();
      for (const b of this.buttons()) b.down = b.enabled && b.hit(this.mouse.x, this.mouse.y);
      for (const b of this.buttons()) if (b.down && b.downSound) sfx.play(b.downSound);   // a channel sounds as it is pressed
      if (!this.panning() || this.dialogs.length) this.topLayer()?.onPointer?.(this.mouse.x, this.mouse.y);
    });
    addEventListener('pointerup', (e) => {
      this.mouse = pos(e);
      this.drag = null;
      const target = this.buttons().find((b) => b.down && b.enabled && b.hit(this.mouse.x, this.mouse.y));
      for (const b of this.buttons()) b.down = false;
      this.hover();
      // the click, unless the button already sounded on press; a race also plays its own sound after it
      if (target) { if (!target.downSound) sfx.play(target.sound || 'UI/BtMouseClick'); if (target.alsoSound) sfx.play(target.alsoSound); target.onClick?.(); }
    }, { signal });
    this.canvas.addEventListener('wheel', (e) => {
      if (this.panning() || this.dialogs.length) return;
      if (this.screen?.onWheel) { e.preventDefault(); this.screen.onWheel(Math.sign(e.deltaY)); }
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (this.panning() && !this.dialogs.length) return;
      const top = this.topLayer();
      if (top?.onRawKey?.(e)) { e.preventDefault(); return; }
      if (e.key === 'Enter' && top?.onEnter) { e.preventDefault(); top.onEnter(); }
      else if (e.key === 'Escape' && top?.onEscape) { e.preventDefault(); top.onEscape(); }
      else if (top?.onKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) { e.preventDefault(); top.onKey(e.key); }
    }, { signal });
  }

  topLayer() { return this.dialogs[this.dialogs.length - 1] || this.screen; }
  panning() { return !!this.pan; }
  /** Only the top layer (dialog over screen) takes clicks, like the client's modal notices; nothing does while the camera moves. */
  buttons() { return this.panning() && !this.dialogs.length ? [] : this.topLayer()?.buttons || []; }
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
    const ms = dt * 1000;
    if (this.pan) {
      const p = this.pan; p.t += ms;
      const k = Math.min(1, p.t / p.ms);
      // starts at 3.5x the average speed and slows to a stop
      this.camY = p.from + (p.to - p.from) * (1.5 * k * k * k - 4 * k * k + 3.5 * k);
      if (k >= 1) { this.camY = this.camTarget; this.pan = null; this.hover(); p.arrive(); }
    }
    this.scene.update(dt);
    for (const d of [...this.dialogs]) {
      if (d.slide && d.t < NOTICE_SLIDE_MS) d.t = Math.min(NOTICE_SLIDE_MS, d.t + ms);
      if (d.fade !== undefined && (d.fade += ms) >= NOTICE_SLIDE_MS) { this.dialogs.splice(this.dialogs.indexOf(d), 1); this.hover(); }
    }
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
    // while the camera moves, the old step's windows scroll away with the scene and the new step's scroll in
    const shown = [[this.screen, this.camTarget]];
    if (this.pan?.leaving && this.pan.leaving !== this.screen && !this.pan.leaving.closeAtOnce) shown.unshift([this.pan.leaving, this.pan.leavingY]);
    // scene layers above the screen's uiLayer (e.g. the title light rays) draw over its buttons
    const ui = Math.min(...shown.map(([l]) => l?.uiLayer ?? 7));
    for (let l = 0; l <= ui; l++) this.scene.drawLayer(ctx, cam, l);
    for (const [layer, y] of shown) {
      if (!layer) continue;
      ctx.save(); ctx.translate(0, Math.round(y - this.camY));
      this.drawLayerContent(ctx, layer);
      ctx.restore();
    }
    for (let l = ui + 1; l < 8; l++) this.scene.drawLayer(ctx, cam, l);
    this.scene.drawBacks(ctx, cam, true);
    this.frame.draw(ctx, this.assets);
    // the client version, written onto the frame: bold black Arial 12 ending at x 645, y 10
    uiText(ctx, VERSION_TEXT, 645, 10, { color: '#000', bold: true, align: 'right' });
    // step banner and navigation buttons sit on the book's border, above the frame
    for (const o of this.screen?.over || []) o.draw(ctx, this.assets);
    for (const d of this.dialogs) {
      // notices slide in from (+20, -20) while fading in, and fade out on close
      const k = d.fade !== undefined ? 1 - d.fade / NOTICE_SLIDE_MS : d.slide ? d.t / NOTICE_SLIDE_MS : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, k);
      if (d.slide && d.fade === undefined) ctx.translate(Math.round(20 * (1 - k)), Math.round(-20 * (1 - k)));
      this.drawLayerContent(ctx, d);
      ctx.restore();
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

  async setScreen(layer, step, camY = STEP[step]) {
    const parts = [...(layer.buttons || []), ...(layer.sprites || []), ...(layer.over || [])];
    await this.assets.preload([...parts.flatMap((p) => p.frames()), ...(layer.preload || [])]);
    const leaving = this.pan ? this.pan.leaving : this.screen;
    const leavingY = this.pan ? this.pan.leavingY : this.camTarget;
    this.screen = layer;
    let arrived = null;
    if (this.step !== undefined && (camY !== this.camTarget || STEP_NO[step] !== this.step)) {
      // |steps| x 300 + 500 ms, with the ScrollUp whoosh on every step change
      this.pan?.arrive();
      arrived = new Promise((res) => {
        this.pan = { from: this.camY, to: camY, t: 0, ms: Math.abs(STEP_NO[step] - this.step) * 300 + 500, leaving, leavingY, arrive: res };
      });
      sfx.play('UI/ScrollUp');
    }
    this.step = STEP_NO[step];
    this.camTarget = camY;
    this.hover();
    return arrived;
  }

  button(node, x, y, onClick) { return new WzButton(node, x, y, onClick); }

  /**
   * Screen windows over the book's border: the step banner (slides in from x -149 over 300 ms), the
   * "Selected world" box under it (400 ms) and the left-hand buttons. Returns { over, buttons }.
   */
  chrome(stepImg, { back = null, vac = null, view = null, world = null, channel = null } = {}) {
    const C = this.L.Common;
    const over = [slideIn(new WzSprite(C.step[stepImg], 0, 33), 300)];
    if (world) {
      const box = new WzSprite(C.selectWorld, 0, 96);
      // the channel's name split at '-': "Scania-1" -> SCANIA / CH.1
      const [head, tail] = String(channel?.name || world.name).split(/-(.*)/s);
      const name = head.toUpperCase(), ch = `CH.${(tail || '1').toUpperCase()}`;
      over.push(slideIn({
        frames: () => box.frames(),
        draw: (ctx, a) => {
          box.draw(ctx, a);
          uiText(ctx, name, 100, 110, { color: '#D3CCBD', align: 'center', size: 9, font: 'Tahoma' });
          uiText(ctx, ch, 100, 125, { color: '#D3CCBD', align: 'center', size: 9, font: 'Tahoma' });
        },
      }, 400));
    }
    const buttons = [];
    if (view) buttons.push(view);
    const vacBtn = this.button(this.L.ViewAllChar.BtVAC, 0, 375, () => vac?.());
    vacBtn.enabled = !!vac;
    buttons.push(vacBtn);
    if (back) buttons.push(this.button(C.BtStart, 0, 425, back));
    over.push(...buttons);
    return { over, buttons, vacBtn };
  }

  // ------------------------------------------------------------------ dialogs
  /**
   * Login.img/Notice dialog. text: Notice/text index or a string.
   * kind: 'error' (crossed-out mushroom, OK), 'info' (OK), 'yesno' (OK / Cancel), 'nexon' (Go to Nexon.net / Cancel).
   */
  async notice(text, kind = 'error') {
    const N = this.L.Notice;
    const { x, y } = NOTICE_AT;
    return new Promise((resolve) => {
      const d = { buttons: [], sprites: [new WzSprite(N.backgrnd[kind === 'error' ? 1 : 0], x, y)], slide: true, t: 0 };
      if (typeof text === 'number' && N.text[text]) d.sprites.push(new WzSprite(N.text[text], x + 119, y + 21));
      else {
        const lines = String(text).replace(/\r\n?/g, '\n');
        d.drawFront = (ctx) => wrapText(ctx, lines, 215).slice(0, 7).forEach((ln, i) => uiText(ctx, ln, x + 121, y + 30 + i * 15, { color: '#5a3200' }));
      }
      const close = (v) => { this.closeDialog(d); resolve(v); };
      if (kind === 'yesno' || kind === 'nexon') {
        const first = kind === 'nexon' ? this.button(N.BtNexon, x + 108, y + 150, () => { window.open('https://maplestory.nexon.net', '_blank', 'noopener'); close(true); })
          : this.button(N.BtYes, x + 116, y + 150, () => close(true));
        d.buttons.push(first, this.button(N.BtNo, x + 196, y + 150, () => close(false)));
        d.onEscape = () => close(false);
      } else {
        d.buttons.push(this.button(N.BtYes, x + 196, y + 150, () => close(true)));
      }
      d.onEnter = () => d.buttons[0]?.onClick();
      this.assets.preload([...d.sprites.flatMap((s) => s.frames()), ...d.buttons.flatMap((b) => b.frames())]).then(() => { this.dialogs.push(d); this.hover(); });
    });
  }

  /** Stops a dialog taking input and fades it out (or drops it at once if it doesn't slide). */
  closeDialog(d) {
    d.buttons = []; d.onEnter = d.onEscape = d.onPointer = null;
    if (d.slide) d.fade = 0;
    else { this.dialogs.splice(this.dialogs.indexOf(d), 1); }
    this.hover();
  }

  /** Text for a LOGIN_STATUS / CHARLIST / SERVER_IP failure; null when the result shows nothing. */
  loginResult(res) {
    if (res.reason === 2) {
      const ban = res.ban;
      if (!ban || ban.reason === 0) return 16;
      const block = this.blockReasons?.[ban.reason > 20 && ban.reason <= 40 ? 12 : ban.reason]?.msg || '';
      const head = ban.reason === 99 ? 'You have been blocked for typing in an invalid password or pincode 5 times.\r\n' : `${block}\r\n`;
      const d = ban.until;
      if (d.getTime() - Date.now() >= 3 * 365.25 * 86400000) return `${head}The ID has been permanently blocked.\r\nSo you won't be able to use this account.`;
      const h = d.getHours() % 12 || 12, pad = (n, w, c = ' ') => String(n).padStart(w, c);
      return `${head}You can login after\r\n${MONTHS[d.getMonth()]}/${pad(d.getDate(), 2)}/${pad(d.getFullYear(), 4)} ${pad(h, 2)}:${pad(d.getMinutes(), 2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
    }
    return LOGIN_NOTICE[res.reason] ?? null;
  }

  /** Shows a login-table result; result 7 also sends the player back to the title. */
  async loginFailed(res) {
    if (res.reason === 14 || res.reason === 15) { await this.notice(res.reason === 14 ? 27 : 26, 'nexon'); return; }
    const n = this.loginResult(res);
    if (n !== null) await this.notice(n);
    if (res.reason === 7) throw new BackToTitle();
  }

  /**
   * Login.img/Common/SoftKey: the PIC keyboard. 148x278, centred, draggable by any empty spot. Ten keys are
   * shuffled once per opening and keep their places on the 1,2,3 / a,b,c / A,B,C tabs; a letter group cycles
   * its letters on repeated taps until another key (or the right arrow) commits it. Typed characters are
   * refused (Login.TypePic lets letters and digits in); Backspace / Delete / arrows / Home / End edit, Enter is OK and
   * Esc is CANCEL.
   * Resolves with the PIC (6-16 characters) or null.
   */
  async softKey({ tip = null } = {}) {
    const K = this.L.Common.SoftKey, T = this.B?.Tab7 || (this.B = await this.assets.json('UI/Basic.img'))?.Tab7;
    const MIN = 6, MAX = 16;
    const win = { x: (W - 148) >> 1, y: (H - 278) >> 1 };
    const slot = Array.from({ length: 10 }, (_, i) => i);
    for (let i = slot.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [slot[i], slot[j]] = [slot[j], slot[i]]; }
    const keyAt = (p) => ({ x: 16 + (p % 3) * 39, y: 91 + Math.floor(p / 3) * 34 });
    let text = [], caret = 0, pending = -1, shownUntil = 0, tab = 0, tooltip = null;
    const showTip = (msg) => { tooltip = { msg, until: performance.now() + 5000 }; };
    if (tip) showTip(tip);
    const commit = () => { pending = -1; };
    const insert = (ch) => {
      if (text.length >= MAX) return;
      text.splice(caret, 0, ch); caret++;
    };
    const backspace = () => {
      if (pending >= 0) { text.splice(pending, 1); caret = pending; }
      else if (caret > 0) { text.splice(caret - 1, 1); caret--; }
      commit();
    };
    const tapGroup = (g, upper) => {
      const base = (upper ? 'A' : 'a').charCodeAt(0) + 3 * g, size = g === 8 ? 2 : 3;
      const cur = pending >= 0 ? text[pending].charCodeAt(0) - base : -1;
      if (pending >= 0 && cur >= 0 && cur < size) text[pending] = String.fromCharCode(base + (cur + 1) % size);
      else {
        commit();
        if (text.length >= MAX) return;
        insert(String.fromCharCode(base)); pending = caret - 1;
      }
      shownUntil = performance.now() + 500;   // the letter shows for 500 ms, then as *
    };
    return new Promise((resolve) => {
      const d = { buttons: [], hotspots: [] };
      const close = (v) => { this.closeDialog(d); resolve(v); };
      const ok = () => {
        if (text.length < MIN) { showTip(`The password needs to be at least ${MIN} letters long.`); return; }
        close(text.join(''));
      };
      const at = (dx, dy) => [win.x + dx, win.y + dy];
      const btn = (node, dx, dy, fn) => { const b = this.button(node, ...at(dx, dy), fn); b.dx = dx; b.dy = dy; return b; };
      let keys = [];
      const buildKeys = () => {
        const nodes = [K.BtNum, K.BtLowCase, K.BtHighCase][tab];
        keys = slot.map((p, i) => {
          const { x, y } = keyAt(p);
          return btn(nodes[i], x, y, () => {
            if (tab === 0) { commit(); insert(String(i)); commit(); }
            else if (i === 9) commit();        // the blank key only commits
            else tapGroup(i, tab === 2);
          });
        });
        d.buttons = [...keys, ...fixed];
        this.assets.preload(keys.flatMap((b) => b.frames())).then(() => this.hover());
      };
      const fixed = [
        btn(K.BtDel, 55, 193, backspace),
        btn(K.BtNext, 94, 193, commit),
        btn(K.BtOK, 16, 231, ok),
        btn(K.BtCancel, 74, 231, () => close(null)),
      ];
      buildKeys();
      // tabs: spans 15-37, 46-67, 76-100 on a Tab7 strip at (11, 65)
      const spans = [[15, 37], [46, 67], [76, 100]];
      const move = () => { for (const b of d.buttons) { b.x = win.x + b.dx; b.y = win.y + b.dy; } };
      d.onPointer = (mx, my) => {
        const rx = mx - win.x, ry = my - win.y;
        if (ry >= 65 && ry < 85) {
          const i = spans.findIndex(([a, b]) => rx >= a && rx < b);
          if (i >= 0) { if (i !== tab) { commit(); tab = i; buildKeys(); } return; }
        }
        // drag by any empty spot
        if (rx >= 0 && rx < 148 && ry >= 0 && ry < 278 && !d.buttons.some((b) => b.hit(mx, my))) {
          const ox = mx - win.x, oy = my - win.y;
          this.drag = (m) => {
            win.x = Math.max(0, Math.min(W - 148, Math.round(m.x - ox))); win.y = Math.max(0, Math.min(H - 278, Math.round(m.y - oy)));
            move();
          };
        }
      };
      d.onEnter = ok;
      d.onEscape = () => close(null);
      d.onRawKey = (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') return false;
        if (e.key === 'Backspace') backspace();
        else if (e.key === 'Delete') { if (caret < text.length) text.splice(caret, 1); commit(); }
        else if (e.key === 'ArrowLeft') { caret = Math.max(0, caret - 1); commit(); }
        else if (e.key === 'ArrowRight') { caret = Math.min(text.length, caret + 1); commit(); }
        else if (e.key === 'Home') { caret = 0; commit(); }
        else if (e.key === 'End') { caret = text.length; commit(); }
        else if (config.typePic && /^[0-9a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) { commit(); insert(e.key); commit(); }
        else if (e.key.length === 1) commit();   // typed characters are refused
        return true;
      };
      d.update = () => { if (tooltip && performance.now() > tooltip.until) tooltip = null; };
      d.drawBack = (ctx) => {
        const bg = this.assets.image(K.backgrnd);
        if (bg) ctx.drawImage(bg, win.x, win.y);
        // input: white box, every character as * except the pending letter for 500 ms
        ctx.fillStyle = '#fff'; ctx.fillRect(win.x + 12, win.y + 46, 122, 13);
        ctx.save(); ctx.font = '12px Arial';
        let x = win.x + 12, caretX = x;
        text.forEach((ch, i) => {
          const g = i === pending && performance.now() < shownUntil ? ch : '*';
          // on the baseline: 'top' differs between browsers
          uiText(ctx, g, x, win.y + 55, { color: '#000', base: 'alphabetic' });
          x += g === '*' ? 5 : Math.ceil(ctx.measureText(g).width);
          if (i === caret - 1) caretX = x;
        });
        if (caret === 0) caretX = win.x + 12;
        ctx.restore();
        if (Math.floor(performance.now() / 500) % 2 === 0) { ctx.fillStyle = '#000'; ctx.fillRect(caretX, win.y + 46, 1, 12); }
        // Tab7 strip
        const img = (k) => T && this.assets.image(T[k]);
        const put = (k, dx, w) => { const i = img(k); if (i) ctx.drawImage(i, win.x + dx, win.y + 65, w ?? i.width, 20); };
        put(tab === 0 ? 'left1' : 'left0', 11);
        spans.forEach(([a, b], i) => {
          put(i === tab ? 'fill1' : 'fill0', a, b - a);
          if (i < spans.length - 1) put(tab === i ? 'middle1' : tab === i + 1 ? 'middle2' : 'middle0', b);
        });
        put(tab === spans.length - 1 ? 'right1' : 'right0', 100);
        [13, 44, 74].forEach((lx, i) => { const l = this.assets.image(K.Tab[i === tab ? 'selected' : 'normal'][i]); if (l) ctx.drawImage(l, win.x + lx, win.y + 72); });
      };
      d.drawFront = (ctx) => {
        if (!tooltip) return;
        ctx.save(); ctx.font = '12px Arial';
        const w = Math.ceil(ctx.measureText(tooltip.msg).width) + 6;
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,64,0.63)';
        ctx.beginPath(); ctx.roundRect(win.x + 66, win.y + 44, w, 18, 1); ctx.fill();
        uiText(ctx, tooltip.msg, win.x + 69, win.y + 47, { color: '#fff' });
      };
      const art = [K.backgrnd, ...Object.values(T || {}), ...[0, 1, 2].flatMap((i) => [K.Tab.normal[i], K.Tab.selected[i]]),
        ...fixed.flatMap((b) => b.frames()), ...keys.flatMap((b) => b.frames())];
      this.assets.preload(art).then(() => { this.dialogs.push(d); this.hover(); });
    });
  }

  /** After REGISTER_PIC the account has a PIC: ask for it (picFlag 1) from now on. */
  picRegistered(list = null) {
    if (list) list.picFlag = 1;
    this.s.picFlag = 1;
    if (this.account) this.account.picMode = 1;
  }

  /** New PIC: the keyboard twice (the second with "Please re-enter your PIC."), again from the start on a mismatch. */
  async registerPic() {
    for (;;) {
      const a = await this.softKey();
      if (a === null) return null;
      const b = await this.softKey({ tip: 'Please re-enter your PIC.' });
      if (b === null) return null;
      if (a === b) return a;
      await this.notice(41, 'info');
    }
  }

  /** The PIC for entering the game: notice 95 and registration (picFlag 0), the keyboard once (1), or none. */
  async picFor(picFlag) {
    if (picFlag === 0) { await this.notice(95, 'info'); return this.registerPic(); }
    if (picFlag === 1) return this.softKey();
    return '';
  }

  /** Pincode-style prompt with one input line. Resolves with the text or null. */
  async prompt(label, { password = true, pattern = null, max = 16 } = {}) {
    const P = this.L.Pincode;
    const x = (W - 362) / 2, y = (H - 219) / 2;
    let onOk = () => {}, onCancel = () => {};
    const d = {
      sprites: [new WzSprite(P.backgrnd[0], x, y)],
      // Pincode BtYes / BtNo, as v83's PIN window places them: Cancel at (196, 150), OK mirrored at (90, 150) so the
      // pair is centred on the 362-wide window
      buttons: [this.button(P.BtYes, x + 90, y + 150, () => onOk()), this.button(P.BtNo, x + 196, y + 150, () => onCancel())],
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

  /**
   * The gender question (Login.img/Gender), at (355, 200) with no backdrop of its own: scroll/0 unrolls (350 ms) and
   * stays, then text/0 at (22, 25) (the welcome words, with the Gender box drawn in), StatusBar's chatTarget at (157, 99)
   * with the choice - Male by default - in white at (170, 103), and BtYes (190, 150) / BtNo (262, 150). The Male /
   * Female drop-down sits over the box; its place and frame were lost: the box opens a two-row list under it
   * (unverified). Resolves with 0 / 1, or null for No.
   */
  async gender() {
    const G = this.L.Gender, x = 355, y = 200;
    this.SB ??= await this.assets.json('UI/StatusBar.img');
    return new Promise((resolve) => {
      let pick = 0, open = false, shown = false;
      const scroll = new WzSprite(G.scroll[0], x, y, { loop: false });
      const d = { buttons: [], sprites: [scroll], hotspots: [] };
      const box = { x: x + 157, y: y + 99, w: 45, h: 17 }, row = (i) => ({ x: box.x, y: box.y + box.h + i * 17, w: 81, h: 17 });
      const yes = this.button(G.BtYes, x + 190, y + 150, () => close(pick)), no = this.button(G.BtNo, x + 262, y + 150, () => close(null));
      d.hotspots = [box, row(0), row(1)];
      d.onPointer = (mx, my) => {
        if (!shown) return;
        const m = { x: mx, y: my };
        if (open) { for (const i of [0, 1]) if (inRect(m, row(i))) pick = i; open = false; return; }
        if (inRect(m, box)) open = true;
      };
      const im = (n) => n && this.assets.image(n);
      d.drawFront = (ctx) => {
        if (!shown && scroll.anim.done) { shown = true; d.buttons = [yes, no]; this.hover(); }
        if (!shown) return;
        const t = im(G.text?.[0]); if (t) ctx.drawImage(t, x + 22, y + 25);   // its origin isn't used
        const ct = im(this.SB?.base?.chatTarget); if (ct) ctx.drawImage(ct, box.x, box.y);
        uiText(ctx, pick ? 'Female' : 'Male', x + 170, y + 103, { color: '#fff', size: 12 });
        if (open) {
          ['Male', 'Female'].forEach((label, i) => {
            const r = row(i);
            ctx.fillStyle = i === pick ? '#569ab8' : '#315574'; ctx.fillRect(r.x, r.y, r.w, r.h);
            uiText(ctx, label, r.x + 4, r.y + 2, { color: '#fff', size: 12 });
          });
        }
      };
      const close = (v) => { this.dialogs.splice(this.dialogs.indexOf(d), 1); this.hover(); resolve(v); };
      d.onEnter = () => { if (shown) close(pick); };
      d.onEscape = () => { if (shown) close(null); };
      this.assets.preload([...scroll.frames(), G.text?.[0], this.SB?.base?.chatTarget, ...yes.frames(), ...no.frames()].filter((n) => n?._canvas)).then(() => { this.dialogs.push(d); this.hover(); });
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
        if (!(e instanceof BackToTitle)) {
          console.error(e);
          await this.notice(NOTICE.CANT_CONNECT);
        }
      }
      this.s?.close();
    }
  }

  titleScreen() {
    const T = this.L.Title;
    // the Title signboard's top-left, map (-47, -97)
    const sx = 325, sy = 211;
    return new Promise((resolve) => {
      this.clearFields();
      const id = this.field(sx + 116, sy + 24, 145, 22, { max: 12, color: '#fff', autocomplete: 'username' });
      const pw = this.field(sx + 116, sy + 53, 145, 22, { password: true, max: 12, color: '#fff' });
      let saveId = store.get('maple.saveid') !== '0';
      if (saveId) id.value = store.get('maple.user') || '';
      let server = this.servers.includes(store.get('maple.server')) ? store.get('maple.server') : this.servers[0];
      let sent = false;
      const submit = async () => {
        if (sent || this.panning() || this.dialogs.length) return;
        if (id.value.length < 4 || id.value.length > 12 || /[@.]/.test(id.value)) { await this.notice(NOTICE.BAD_ID); id.focus(); return; }
        if (pw.value.length < 5 || pw.value.length > 12) { await this.notice(NOTICE.WRONG_PASSWORD); pw.focus(); return; }
        // the title buttons stay disabled until LOGIN_STATUS arrives
        sent = true;
        for (const b of layer.buttons) b.enabled = false;
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
          this.button(T.BtLoginIDLost, sx + 184, sy + 93, () => this.notice('Please contact the server administrator to recover your ID.', 'info')),
          this.button(T.BtPasswdLost, sx + 283, sy + 93, () => this.notice('Please contact the server administrator to reset your password.', 'info')),
          this.button(T.BtNew, sx + 70, sy + 137, () => this.notice('New IDs are registered automatically: just log in with the ID and password you want.', 'info')),
          this.button(T.BtHomePage, sx + 171, sy + 137, () => window.open('https://github.com/P0nk/Cosmic', '_blank', 'noopener')),
          this.button(T.BtQuit, sx + 271, sy + 137, () => this.notice('You can simply close this browser tab to quit.', 'info')),
        ],
        sprites: [],
        hotspots: this.servers.length > 1 ? [serverBox] : [],
        preload: [T.check[0], T.check[1]],
        uiLayer: 3, // signboard is layer 1, the light rays (Title/effect) layer 4
        enable: () => { for (const b of layer.buttons) b.enabled = true; },
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
      this.titleLayer = layer;
      this.setScreen(layer, 'title').then(() => setTimeout(() => (id.value ? pw : id).focus(), 600));
    });
  }

  async session({ user, password, server }) {
    this.s = new LoginSession(wsTransport(bridgeUrl(server, 8484)));
    await this.s.ready();
    let res = await this.s.login(user, password);
    this.titleLayer?.enable();
    // the license agreement is accepted without being shown
    if (!res.ok && res.reason === 23) res = await this.s.acceptTos();
    if (!res.ok) { await this.loginFailed(res); return null; }
    if (res.regStatus === 2 || res.regStatus === 3) { await this.notice(31, 'yesno'); return null; }
    if (res.regStatus > 3) { await this.notice(NOTICE.LAUNCHER); return null; }
    let account = res.account;
    if (account.gender === 10) {
      const g = await this.gender();
      if (g === null) { this.s.genderCancel(); return null; }
      account = (await this.s.setGender(g)).account;
    }
    this.account = account;
    if (account.pinMode === 0 && !(await this.pin())) return null;
    this.worlds = await this.s.worlds();
    for (;;) {
      const r = await this.worldSelect(server);
      if (r === 'again') { this.worlds = await this.s.worlds(true); continue; }
      if (r === 'vac') { const v = await this.viewAll(server); if (v) return v; continue; }
      return r;
    }
  }

  /**
   * The PIN step, as the client runs CHECK_PINCODE: 0 in; 1 choose a PIN (entered twice, text 0 / 2, text 1 when it
   * isn't 4 long, text 3 when the two differ; Cancel asks text 7 first and starts over on No); 2 / 4 enter it (text 5 /
   * 4), LOGIN sending AFTER_LOGIN 1 and CHANGE PIN AFTER_LOGIN 2 (the server then asks for a new one); 3 and 7 the
   * Login Notice's 15 / 17. A PIN goes as "%04d". After registering, text 8 and back to the title (the server closes).
   */
  async pin() {
    let mode = await this.s.pinStart();
    const fmt = (v) => String(parseInt(v, 10) || 0).padStart(4, '0');
    for (;;) {
      if (mode === 0) return true;
      if (mode === 3 || mode === 7) { await this.notice(mode === 3 ? 15 : 17, 'info'); return false; }
      if (mode === 1) {
        let text = 0, pin = null;
        while (pin === null) {
          const a = await this.pinBox(1, text);
          if (a.code === 0 || a.code === -1) {
            // Cancel: are you sure? (yes leaves, no starts over)
            if (a.code === 0 || (await this.pinBox(0, 7)).code === 1) { this.s.pinRegisterCancel(); return false; }
            text = 0; continue;
          }
          if (a.value.length !== 4) { text = 1; continue; }
          const b = await this.pinBox(1, 2);
          if (b.code === 0 || b.code === -1) {
            if (b.code === 0 || (await this.pinBox(0, 7)).code === 1) { this.s.pinRegisterCancel(); return false; }
            text = 0; continue;
          }
          if (b.value.length !== 4 || fmt(a.value) !== fmt(b.value)) { text = 3; continue; }
          pin = fmt(a.value);
        }
        // the server says how it went and closes the session: back to the title either way
        const r = await this.s.pinRegister(pin);
        if (r === 0) await this.pinBox(2, 8); else await this.notice(15);
        return false;
      }
      let text = mode === 4 ? 4 : 5, r;
      for (;;) {
        r = await this.pinBox(3, text);
        if (r.code === 0 || r.value.length === 4) break;
        text = 5;
      }
      if (r.code === 0) { this.s.pinCancel(); return false; }
      mode = r.code === 2 ? await this.s.pinChange(fmt(r.value)) : await this.s.pinCheck(fmt(r.value));
    }
  }

  /**
   * The PIN window (CUIPincode, Login.img/Pincode, 362x219), sliding in to (219, 170): mode 0 a yes / no question,
   * 1 choosing a PIN, 2 a notice, 3 entering your PIN. Its background is backgrnd/0, or for modes 1 / 3 backgrnd/2
   * (backgrnd/1, the crossed-out mushroom, after an error); text/<n> at (119, 21); the box at (130, 103), 150x15,
   * starred, 8 long. Buttons: mode 0 NO (107, 150) and YES; mode 1 YES and NO (196, 150); mode 2 YES alone; mode 3
   * CHANGE PIN (47, 150), LOGIN and NO (212, 150). The YES / LOGIN places were lost: (189, 150), (114, 150), (196, 150)
   * and (130, 150) (unverified). Enter is OK and Esc cancels; any other key in modes 1 and 3 opens the soft keyboard,
   * which types for you. Resolves with { code: 1 OK, 0 cancel, -1 mode 1's NO, 2 CHANGE PIN; value: the box }.
   */
  async pinBox(mode, text) {
    const P = this.L.Pincode, { x, y } = NOTICE_AT;
    const bg = mode === 1 ? (text === 0 || text === 2 ? 2 : 1) : mode === 3 ? (text === 4 ? 2 : 1) : 0;
    this.UW ??= await this.assets.json('UI/UIWindow.img');
    return new Promise((resolve) => {
      const d = { buttons: [], sprites: [new WzSprite(P.backgrnd[bg], x, y), new WzSprite(P.text[text], x + 119, y + 21)], slide: true, t: 0 };
      const keep = [...this.fields], input = mode === 1 || mode === 3;
      const f = input ? this.field(x + 130, y + 103, 150, 15, { password: true, max: 8, color: '#000' }) : null;
      let kb = null;
      const close = (code) => {
        if (kb) this.closeDialog(kb);
        const value = f ? f.value : '';
        this.clearFields(keep); this.closeDialog(d); resolve({ code, value });
      };
      const b = (node, dx, fn) => d.buttons.push(this.button(node, x + dx, y + 150, fn));
      if (mode === 0) { b(P.BtNo, 107, () => close(0)); b(P.BtYes, 189, () => close(1)); }
      else if (mode === 1) { b(P.BtYes, 114, () => close(1)); b(P.BtNo, 196, () => close(-1)); }
      else if (mode === 2) b(P.BtYes, 196, () => close(1));
      else { b(P.BtChgPin, 47, () => close(2)); b(P.BtLogin, 130, () => close(1)); b(P.BtNo, 212, () => close(0)); }
      d.onEnter = () => close(1); d.onEscape = () => close(0);
      if (f) {
        f.el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') return;
          e.preventDefault();
          if (!kb) kb = this.softKeyboard(f, () => { kb = null; f.focus(); });
        });
      }
      this.assets.preload([...d.sprites.flatMap((s) => s.frames()), ...d.buttons.flatMap((x2) => x2.frames())]).then(() => {
        this.dialogs.push(d); this.hover();
        if (f) setTimeout(() => f.focus(), 50);
      });
    });
  }

  /**
   * The soft keyboard (UIWindow.img/SoftKeyboard, 315x127 at (242, 286)): its keyboard picture at (22, 18) and 36 keys
   * (0-9, A-Z) in the picture's slots, shuffled when it opens and after every key and backspace. It types into the PIN
   * box: digits only while it is under 4 long, nothing once it is 4. Backspace (277, 20), Enter (265, 66) and the close
   * box (283, 1) lost their places: placed on the picture's slots (unverified).
   */
  softKeyboard(f, onClose) {
    const K = this.UW?.SoftKeyboard;
    if (!K) return null;
    const win = { x: 242, y: 286 };
    const ROWS = [[20, [24, 47, 70, 93, 116, 139, 162, 185, 208, 231]], [43, [47, 70, 93, 116, 139, 162, 185, 208, 231, 254]],
      [66, [58, 81, 104, 127, 150, 173, 196, 219, 242]], [89, [74, 97, 120, 143, 166, 189, 212]]];
    const pos = ROWS.flatMap(([yy, xs]) => xs.map((xx) => ({ x: xx, y: yy })));
    const slot = Array.from({ length: 36 }, (_, i) => i);
    const shuffle = () => { for (let i = 0; i < 36; i++) { const j = Math.floor(Math.random() * 36); [slot[i], slot[j]] = [slot[j], slot[i]]; } };
    shuffle();
    const enabled = (id) => f.value.length < 4 && id < 10;
    const inBox = (rx, ry, bx, by, bw, bh) => rx >= bx && rx < bx + bw && ry >= by && ry < by + bh;
    const slotAt = (rx, ry) => pos.findIndex((p) => inBox(rx, ry, p.x, p.y, 21, 22));
    const d = { buttons: [] };
    const close = () => { this.closeDialog(d); onClose?.(); };
    d.onPointer = (mx, my) => {
      const rx = mx - win.x, ry = my - win.y;
      if (inBox(rx, ry, 283, 1, 14, 14) || inBox(rx, ry, 265, 66, 33, 22)) { close(); return; }
      if (inBox(rx, ry, 277, 20, 21, 45)) { f.value = f.value.slice(0, -1); shuffle(); return; }
      const i = slotAt(rx, ry);
      if (i < 0 || !enabled(slot[i])) return;
      const id = slot[i];
      f.value += id < 10 ? String(id) : String.fromCharCode(65 + id - 10);
      sfx.play('UI/BtMouseClick');
      shuffle();
    };
    d.drawFront = (ctx) => {
      const im = (n) => n && this.assets.image(n), at = (n, dx, dy) => { const i = im(n); if (i) ctx.drawImage(i, win.x + dx, win.y + dy); };
      at(K.backgrnd?.[1]?.back, 0, 0); at(K.backgrnd?.[1]?.keyboard, 22, 18);
      const m = this.mouse, over = slotAt(m.x - win.x, m.y - win.y);
      pos.forEach((p, i) => {
        const id = slot[i], k = K.key?.[id], state = !enabled(id) ? 'disabled' : i === over ? 'mouseOver' : 'normal';
        at(k?.[state]?.[0] || k?.normal?.[0], p.x, p.y);
      });
      at(K.funckey?.backspace?.normal?.[0], 277, 20); at(K.funckey?.enter?.normal?.[0], 265, 66);
      at(K.Bt?.[1]?.BtClose?.normal?.[0], 283, 1);
    };
    const art = [K.backgrnd?.[1]?.back, K.backgrnd?.[1]?.keyboard, K.funckey?.backspace?.normal?.[0], K.funckey?.enter?.normal?.[0], K.Bt?.[1]?.BtClose?.normal?.[0],
      ...Object.values(K.key || {}).flatMap((k) => ['normal', 'disabled', 'mouseOver'].map((s) => k?.[s]?.[0]))].filter((n) => n?._canvas);
    this.assets.preload(art).then(() => { this.dialogs.push(d); this.hover(); });
    return d;
  }

  // ------------------------------------------------------------------ world / channel
  worldSelect(server) {
    const WS = this.L.WorldSelect, C = this.L.Common;
    return new Promise((resolve, reject) => {
      let world = null, channel = -1, pending = false;
      const tabX = 232, tabY = 96;                     // the first tag hangs from the rod's third string past the scroll's left end
      // WorldSelect/scroll unrolls over the scene's rolled-up scroll (signboard/2, top-left 171,101);
      // chBackgrn is that scroll's paper: 38,141 into the open frame
      const roll = { x: 158, y: 79 };
      const win = { x: roll.x + 38, y: roll.y + 141 };
      let scroll = null, closing = false;              // the unroll / roll-up animation while it plays or holds open
      const opened = () => !!world && !!scroll && !closing && scroll.anim.done;
      let chButtons = [];
      const go = async () => {
        if (!opened() || channel < 0 || pending) return;
        pending = true;
        let cancelled = false;
        const loading = this.loading(() => { cancelled = true; this.s.close(); });
        try {
          const res = await this.charSelect(server, world, world.channels[channel], loading);
          if (res === 'back') resolve('again'); else if (res) resolve(res);
        } catch (e) { reject(cancelled ? new BackToTitle() : e); } finally { loading.close(); pending = false; }
      };
      let worldStatus = 0;   // the open world's SERVERSTATUS: 1 (busy) puts WorldNotice/Populated/1 on its paper
      const openWorld = (w, status = 0) => {
        worldStatus = status;
        if (!world || closing) { scroll = new WzSprite(WS.scroll[0], roll.x, roll.y, { loop: false }); closing = false; sfx.play('UI/RollDown'); }
        world = w; channel = -1;
        // 20 places, 4 columns 94px apart and rows 32px apart; places past the world's channels are disabled
        chButtons = Array.from({ length: 20 }, (_, i) => {
          const node = WS.channel[i] || WS.channel[0], c = w.channels[i];
          const b = new WzButton({ normal: node.normal, disabled: node.disabled }, win.x + 35 + (i % 4) * 94, win.y + 57 + Math.floor(i / 4) * 32, () => {
            if (channel === i && performance.now() - (b.lastClick || 0) < 400) go(); // double-click enters
            if (channel !== i) select.anim.reset();
            channel = i; b.lastClick = performance.now();
          });
          b.enabled = !!c; b.users = c?.load || 0; b.downSound = 'UI/WorldSelect';
          return b;
        });
        this.assets.preload([...chButtons.flatMap((b) => b.frames()), WS.channel.chgauge, ...select.frames()]).then(() => this.hover());
      };
      const closeWorld = () => {
        if (!world) return;
        world = null; closing = true; channel = -1;
        scroll = new WzSprite(WS.scroll[1], roll.x, roll.y, { loop: false });
        sfx.play('UI/RollUp');
        for (const b of worldButtons) b.enabled = true;
      };
      // a click asks for the world's status first: busy shows a warning, full keeps it closed
      const clickWorld = async (w, btn) => {
        if (pending) return;
        for (const b of worldButtons) b.enabled = true;
        btn.enabled = false;   // the clicked tag stays pressed
        picked = true; focusWorld(w.id);      // and takes the keyboard focus, so no other tag keeps the highlight
        pending = true;
        let status;
        try { status = await this.s.serverStatus(w.id); } catch (e) { reject(e); return; } finally { pending = false; }
        if (status === 2) { await this.notice(WORLD_FULL, 'info'); btn.enabled = true; return; }
        if (status === 1) await this.notice(WORLD_BUSY, 'info');
        openWorld(w, status);
      };
      const hang = WS.BtWorld[0]?.disabled?.[0];
      const worldButtons = this.worlds.map((w, i) => {
        const b = this.button(WS.BtWorld[w.id] || WS.BtWorld[0], tabX + i * TAG_STEP, tabY, () => clickWorld(w, b));
        b.focusRing = true;   // keyFocused is only an outline, drawn over the tag
        // a selected tag hangs 5px lower; only Scania's art has that, so the others reuse its longer string
        const normal = b.anims.normal?.node, down = b.anims.disabled?.node;
        if (normal && down && down._h === normal._h && hang) {
          const draw = b.draw.bind(b);
          b.draw = (ctx, assets) => {
            const img = assets.image(normal), str = assets.image(hang);
            if (!b.visible || b.state !== 'disabled' || !img || !str) { draw(ctx, assets); return; }
            ctx.drawImage(img, b.x, b.y + 5);
            ctx.drawImage(str, 0, 0, str.width, 5, b.x, b.y, str.width, 5);
          };
        }
        return b;
      });
      // places no world takes hang an empty plank (BtWorld/e), as in the client
      const blanks = Array.from({ length: Math.max(0, WORLD_TAGS - this.worlds.length) },
        (_, i) => new WzSprite(WS.BtWorld.e.normal, tabX + (this.worlds.length + i) * TAG_STEP, tabY));
      const goBtn = this.button(WS.BtGoworld, win.x + 315, win.y + 215, go);   // bottom right of the paper (measured)
      const nav = this.chrome(1, {
        back: async () => { if (!pending && await this.notice(NOTICE.RETURN_TO_TITLE, 'yesno')) reject(new BackToTitle()); },
        vac: () => { if (!pending && !rec) resolve('vac'); },
      });
      // the last world played gets the keyboard-focus highlight
      const focusWorld = (id) => worldButtons.forEach((b, i) => { b.focused = this.worlds[i].id === id; });
      // LAST_CONNECTED_WORLD and RECOMMENDED_WORLD_MESSAGE come just after the server list, so both are read live
      let lastShown = null, picked = false;
      const syncLast = () => { if (!picked && this.s.lastWorld !== lastShown) { lastShown = this.s.lastWorld; focusWorld(lastShown); } };
      // Recommended World window (screen (136, 51)): arrows step through the list, Select highlights that world's tag
      const recs = () => (this.s.recommended || []).filter((r) => this.worlds.some((w) => w.id === r.world));
      let rec = null;
      const RW = { x: 136, y: 51 }, A = WS.alert;
      const recStep = (d) => { rec.i = (rec.i + d + recs().length) % recs().length; rec.first = 0; };
      const recArrows = [this.button(A.BtArrowL, RW.x + 45, RW.y + 70, () => recStep(-1)), this.button(A.BtArrowR, RW.x + 215, RW.y + 70, () => recStep(1))];
      const recChoice = this.button(A.BtChoice, RW.x + 113, RW.y + 114, () => { picked = true; focusWorld(recs()[rec.i].world); closeRec(); });
      recChoice.fixedOrigin = true;   // its hover / pressed art is centred, the normal art isn't
      const openRec = () => {
        if (!recs().length || pending) return;
        closeWorld();
        rec = { i: 0, first: 0 };
      };
      const closeRec = () => { rec = null; };
      const viewChoice = this.button(WS.BtViewChoice, 0, 125, openRec), viewAll = this.button(WS.BtViewAll, 0, 125, closeRec);

      // the message: cut by letters at 200px and at each \r\n, six 14px rows from (280, 60), scrolled by a VScr7 at x 502
      // (the scrollbar's top and length were lost: it runs down the right box, 57 to 145)
      const REC_ROWS = 6, REC_BAR = { x: 502, y: 57, h: 88 };
      const loadBar = (B) => this.assets.preload(Object.values(B?.VScr7 || {}).flatMap((st) => Object.values(st || {})).filter((n) => n?._canvas));
      if (this.B) loadBar(this.B); else this.assets.json('UI/Basic.img').then((b) => { this.B ??= b; loadBar(this.B); });
      const recLines = (text) => {
        this.recWrap ??= new Map();
        if (!this.recWrap.has(text)) {
          const ctx = this.ctx, out = [];
          let rest = String(text).replace(/\\r/g, '\r').replace(/\\n/g, '\n');
          ctx.save(); ctx.font = '12px Arial, sans-serif';
          while (rest) {
            let n = rest.length;
            while (n > 1 && ctx.measureText(rest.slice(0, n)).width > 200) n--;
            const cr = rest.indexOf('\r');
            if (cr < 0 || n <= cr) { out.push(rest.slice(0, n)); rest = rest.slice(n); } else { out.push(rest.slice(0, cr)); rest = rest.slice(cr + 2); }
          }
          ctx.restore();
          this.recWrap.set(text, out);
        }
        return this.recWrap.get(text);
      };
      const recBar = () => this.vscr7(RW.x + REC_BAR.x, RW.y + REC_BAR.y, REC_BAR.h);
      const recMax = () => { const r = rec && recs()[rec.i]; return r ? Math.max(0, recLines(r.text).length - REC_ROWS) : 0; };
      const drawRecBar = (ctx) => this.drawVScr(ctx, recBar(), rec.first, recMax());
      /** A click on the message's scrollbar: the arrows step a row, the track jumps there. */
      const recBarClick = (mx, my) => { const f = this.vscrClick(recBar(), mx, my, rec.first, recMax()); if (f !== null) rec.first = f; };
      const recPanel = {
        frames: () => [A.backgrd, ...Object.values(this.B?.VScr7 || {}).flatMap((st) => Object.values(st || {}))].filter((n) => n?._canvas),
        draw: (ctx) => {
          if (!rec) return;
          const bg = this.assets.image(A.backgrd);
          if (bg) ctx.drawImage(bg, RW.x, RW.y);
          const r = recs()[rec.i], img = r && WS.world[r.world] && this.assets.image(WS.world[r.world]);
          if (!r) return;
          if (img) ctx.drawImage(img, RW.x + 145 - Math.round(img.width / 2), RW.y + 61);
          recLines(r.text).slice(rec.first, rec.first + REC_ROWS).forEach((ln, i) => uiText(ctx, ln, RW.x + 280, RW.y + 60 + i * 14, { color: '#000' }));
          drawRecBar(ctx);
          for (const b of [...recArrows, recChoice]) b.draw(ctx, this.assets);
        },
      };
      let autoOpened = false;
      const syncRec = () => {
        viewChoice.enabled = recs().length > 0;
        for (const b of recArrows) b.enabled = recs().length > 1;
        // opens by itself only when the last world is 0xFF
        if (!autoOpened && this.s.lastWorld === 0xFF && recs().length) { autoOpened = true; rec = { i: 0, first: 0 }; }
      };
      // the Events balloon draws over the book frame
      const eventPanel = { frames: () => [], draw: (ctx) => { if (opened() && this.camY === this.camTarget) this.eventBalloon(ctx, world, win); } };
      const select = new WzSprite(WS.channel.chSelect, 0, 0, { loop: false }); // swirls in once per selection
      const layer = {
        // channel window buttons only exist once the scroll is open
        get buttons() {
          const left = [rec ? viewAll : viewChoice, ...nav.buttons];
          if (rec) return [...recArrows, recChoice, ...left];
          return opened() ? [...worldButtons, ...left, ...chButtons, goBtn] : [...worldButtons, ...left];
        },
        sprites: blanks,
        get over() { return [eventPanel, ...nav.over, rec ? viewAll : viewChoice, recPanel]; },
        preload: [WS.chBackgrn, hang, goBtn.frames(), viewChoice.frames(), viewAll.frames(), A.backgrd, ...[...recArrows, recChoice].flatMap((b) => b.frames()),
          ...Object.values(this.L.WorldNotice.BalloonForLoginProcess).filter((n) => n?._canvas), this.L.WorldNotice[1], this.L.WorldNotice[2], this.L.WorldNotice[3], this.L.WorldNotice.Populated?.[1], ...blanks.flatMap((b) => b.frames()), ...Object.values(WS.world).filter((n) => n?._canvas),
          ...new WzSprite(WS.scroll[0]).frames(), ...new WzSprite(WS.scroll[1]).frames()].flat(),
        onEnter: go,
        onEscape: closeWorld,
        onPointer: (mx, my) => { if (rec) recBarClick(mx, my); },
        // the wheel over the message's bar (or 6px left of it)
        onWheel: (d) => {
          const b = rec && recBar(), m = this.mouse;
          if (b && m && m.x >= b.x - 6 && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h) rec.first = Math.max(0, Math.min(recMax(), rec.first + d));
        },
        update: (dt) => {
          syncLast(); syncRec();
          nav.vacBtn.enabled = !rec;
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
          const busy = worldStatus > 0 && this.assets.image(this.L.WorldNotice.Populated?.[worldStatus]);
          if (busy) ctx.drawImage(busy, win.x + 260, win.y + 10);
        },
        drawFront: (ctx) => {  // the worlds' badges, then load gauges and the selection swirl round the CH label
          // a world's flag (1 event, 2 new, 3 hot) puts WorldNotice/<flag> over its tag, 5px left of it and 10px up
          this.worlds.forEach((w, i) => {
            const b = w.flag > 0 && this.assets.image(this.L.WorldNotice[w.flag]);
            if (b) ctx.drawImage(b, tabX + i * TAG_STEP - 5, tabY - 10);
          });
          if (!opened()) return;
          const gauge = this.assets.image(WS.channel.chgauge);
          for (const b of chButtons) {
            if (!gauge || !b.enabled) continue;
            // level = users / 60 + 1 (1-14), width = level x 5 + 2 (+1 at 14)
            const level = Math.min(14, Math.max(1, Math.floor(b.users / 60) + 1));
            const w = Math.min(gauge.width, level * 5 + 2 + (level === 14 ? 1 : 0));
            ctx.drawImage(gauge, 0, 0, w, 8, b.x + 7, b.y + 17, w, 8);
          }
          const sb = chButtons[channel];
          if (sb) { select.x = sb.x + 20; select.y = sb.y + 7; select.draw(ctx, this.assets); }
        },
      };
      this.setScreen(layer, 'world');   // no world is open until one is clicked
    });
  }

  /**
   * The open world's event text in a WorldNotice/BalloonForLoginProcess balloon, its right edge 35px into
   * the channel window: "Events" title image, centred lines in Arial 12 (#b blue, #r red, #k black).
   */
  eventBalloon(ctx, world, win) {
    let text = world.event || '';
    if (world.expRate !== undefined && (world.expRate !== 100 || world.dropRate !== 100)) {
      text += `${text ? '\r' : ''}#kSummer Event\r#b1:00 pm ~ 7:00 pm\r#rEXP x${world.expRate}, Drop Rate x${world.dropRate}`;
    }
    if (!text) return;
    const lines = text.split(/\\r|\r\n?|\n/);
    ctx.save(); ctx.font = '12px Arial';
    const plain = (ln) => ln.replace(/#[a-zA-Z]/g, '');
    const widths = lines.map((ln) => ctx.measureText(plain(ln)).width);
    ctx.restore();
    const W0 = Math.max(Math.max(...widths) + 44, 184), Wd = W0 + 7, H = (lines.length + 4) * 16;
    // its right edge just left of the world's name (measured)
    const x = win.x + 23 - Wd, y = win.y + (lines.length === 1 ? 21 : 15);
    const B = this.L.WorldNotice.BalloonForLoginProcess;
    this.balloon(ctx, B, x, y, Wd, H);
    const title = this.assets.image(B.Title);
    if (title) ctx.drawImage(title, x + Math.floor((Wd - 170) / 2) + 3, y + 17);
    const colors = { b: '#2000FF', r: '#FF2020', k: '#000' };
    lines.forEach((ln, i) => {
      let cx = x + Math.floor((W0 - widths[i]) / 2), color = '#000';
      for (const part of ln.split(/(#[a-zA-Z])/)) {
        if (/^#[a-zA-Z]$/.test(part)) { color = colors[part[1].toLowerCase()] || color; continue; }
        if (!part) continue;
        uiText(ctx, part, cx, y + 38 + 16 * i, { color });
        ctx.save(); ctx.font = '12px Arial'; cx += ctx.measureText(part).width; ctx.restore();
      }
    });
  }

  /** Notice/Loading: "Connecting to server" with a looping bar and Cancel, until close(). */
  loading(onCancel) {
    const Ld = this.L.Notice.Loading;
    const x = Math.round((W - 282) / 2), y = Math.round((H - 144) / 2);
    const d = { sprites: [new WzSprite(Ld.backgrnd, x, y), new WzSprite(Ld.bar, x + 132, y + 98)], buttons: [] };
    let closed = false;
    d.buttons.push(this.button(Ld.BtCancel, x + 189, y + 44, () => { close(); onCancel(); }));
    const close = () => { if (closed) return; closed = true; if (this.dialogs.includes(d)) this.closeDialog(d); };
    this.assets.preload([...d.sprites, ...d.buttons].flatMap((p) => p.frames())).then(() => { if (!closed) { this.dialogs.push(d); this.hover(); } });
    return { close };
  }

  // ------------------------------------------------------------------ character select
  /** known: the list already in hand (after a new character is added to it), shown without asking again. */
  async charSelect(server, world, channel, loading = null, known = null) {
    const list = known || await this.s.chars(world.id, channel.id);
    loading?.close();
    if (list.full) { await this.notice(WORLD_FULL, 'info'); return null; }
    if (list.status) { await this.loginFailed({ reason: list.status }); return null; }
    const CS = this.L.CharSelect;
    const looks = await Promise.all(list.chars.map(async (c) => {
      const cl = new CharacterLook(this.assets, { skin: c.look.skin, face: c.look.face, hair: c.look.hair, gender: c.look.gender, equips: lookEquipIds(c.look) });
      await cl.load();
      await this.assets.preload(lookCanvases(cl, [cl.standAction(), cl.walkAction()]));
      return cl;
    }));
    return new Promise((resolve, reject) => {
      // the buttons run outside session(): a lost connection or a server that never answers is handed to
      // it through reject (back to the title with the can't-connect notice), and one click runs at a time
      let busy = false, done = false;
      const finish = (v) => { done = true; resolve(v); };
      const guard = (fn) => async () => {
        if (busy || done) return;
        busy = true;
        try { await fn(); } catch (e) { done = true; reject(e); } finally { busy = false; }
      };
      // the character last played on this world is selected, else none
      const lastKey = `maple.lastchar.${world.id}`;
      let sel = list.chars.findIndex((c) => String(c.stats.id) === store.get(lastKey));
      const perPage = 3, pages = Math.floor((Math.max(1, list.slots) - 1) / perPage) + 1;
      let page = sel >= 0 ? Math.floor(sel / perPage) : 0;
      // three places 125px apart, feet on the bridge
      const placeX = (c) => 252 + 125 * c, footY = 370;
      const anim = list.chars.map(() => ({ frame: 0, t: 0 }));
      const backdrop = (job) => (Math.floor(job / 1000) === 1 ? CS.knight : Math.floor(job / 100) === 21 || job === 2000 ? CS.aran : CS.adventure);
      const backdrops = list.chars.map((c) => new WzSprite(backdrop(c.stats.job)[0] || backdrop(c.stats.job), 0, 0));
      const beam = new WzSprite(CS.effect[1], 0, 0, { loop: false });
      const sparkle = new WzSprite(CS.effect[0], 0, 0);
      const shadow = new WzSprite(CS.character[0], 0, 0), ghost = new WzSprite(CS.character[1], 0, 0);
      const panel = { scroll: null, t: 0 };
      const ranked = () => sel >= 0 && !!list.chars[sel].rank;
      const panelAt = () => ({ x: 152 + 130 * (sel % perPage), y: ranked() ? 124 : 160 });
      const rollPanel = () => {
        panel.scroll = sel >= 0 ? new WzSprite(CS.scroll[ranked() ? 2 : 0], 0, 0, { loop: false }) : null;
        panel.t = 0; panel.rolled = false;
      };
      // lined up with the signboard's planks (measured)
      const btnSelect = this.button(CS.BtSelect, 576, 149, null), btnNew = this.button(CS.BtNew, 576, 185, null), btnDelete = this.button(CS.BtDelete, 576, 234, null);
      // Tab moves keyboard focus to the board (a leaf marks the focused button); Up / Down move it, Enter presses it
      const board = [btnSelect, btnNew, btnDelete];
      let menu = null, lastMenu = 0;
      for (const b of board) b.focusRing = true;
      const focusMenu = (i) => { menu = i; board.forEach((b, k) => { b.focused = k === i; }); };
      const nextEnabled = (from, d) => {
        for (let k = 0; k < board.length; k++) { const i = (from + d * k + board.length * 3) % board.length; if (board[i].enabled) return i; }
        return null;
      };
      const refresh = () => {
        btnSelect.enabled = btnDelete.enabled = sel >= 0;
        if (menu !== null && !board[menu].enabled) focusMenu(nextEnabled(menu, 1));
      };
      // a click on the board drops the keyboard focus
      for (const [i, b] of board.entries()) {
        const press = () => { lastMenu = i; focusMenu(null); b.action?.(); };
        b.press = press;
      }
      const choose = (idx) => {
        sfx.play('UI/CharSelect');   // every selection, even the one already selected
        if (idx === sel) return;
        sel = idx; beam.anim.reset(); sparkle.anim.reset();
        if (sel >= 0) page = Math.floor(sel / perPage);
        rollPanel(); refresh();
      };
      const pick = async () => {
        if (sel < 0) return;
        const c = list.chars[sel];
        const pic = await this.picFor(list.picFlag);
        if (pic === null) return;
        const res = await this.s.selectChar(c.stats.id, pic);
        if (list.picFlag === 0 && !res.wrongPic) this.picRegistered(list);
        if (res.wrongPic) { await this.notice(NOTICE.PIC_WRONG); return; }
        if (res.code !== undefined) { await this.loginFailed({ reason: res.code }); return; }
        sfx.play('Game/GameIn');
        store.set(lastKey, String(c.stats.id));
        this.s.close();
        finish({ server, charId: c.stats.id, port: res.port, cafe: res.cafe, world: world.id, channel: channel.id, channels: world.channels.length, channelNames: world.channels.map((ch) => ch.name), stats: c.stats, look: c.look, gm: !!this.account?.gm, admin: this.account?.admin || 0, slots: list.slots, charCount: list.chars.length });
      };
      const start = guard(pick);
      const create = async () => {
        if (world.blockCreate) { await this.notice(NOTICE.CREATE_BLOCKED, 'info'); return; }
        if (list.chars.length >= list.slots) { await this.notice(NOTICE.NO_MORE_CHARS); return; }
        // race select <-> name board until a character is made or race select is left
        for (;;) {
          const race = await this.raceSelect(world, channel);
          if (!race) break;
          const c = await this.creator(race, world, channel);
          // ADD_NEW_CHAR_ENTRY: the new character joins this list, selected, with no new list request
          if (c) { list.chars.push(c); store.set(lastKey, String(c.stats.id)); break; }
        }
        finish((await this.charSelect(server, world, channel, null, list)) ?? 'back');
      };
      const remove = async () => {
        if (sel < 0) return;
        const c = list.chars[sel];
        if (list.picFlag !== 1) { await this.notice(NOTICE.NO_PIC, 'info'); return; }
        // the PIC first, then the question (Cygnus and Aran warn about their Cash items)
        const pic = await this.softKey();
        if (pic === null) return;
        const race = Math.floor(c.stats.job / 1000);
        if (!(await this.notice(race === 1 || race === 2 ? NOTICE.DELETE_CONFIRM_CASH : NOTICE.DELETE_CONFIRM, 'yesno'))) return;
        // the selection is cleared as the request goes out
        sel = -1; rollPanel(); refresh();
        const state = await this.s.deleteChar(c.stats.id, pic);
        if (state !== 0) { if (DELETE_NOTICE[state] !== undefined) await this.notice(DELETE_NOTICE[state]); return; }
        // deleted: drop it from this list (the ones after it move left), with no new list request
        const idx = list.chars.indexOf(c);
        for (const arr of [list.chars, looks, anim, backdrops]) arr.splice(idx, 1);
        if (store.get(lastKey) === String(c.stats.id)) store.set(lastKey, '');
      };
      btnSelect.action = start; btnNew.action = guard(create); btnDelete.action = guard(remove);
      for (const b of board) b.onClick = b.press;
      refresh();
      const toTitle = guard(async () => { if (await this.notice(NOTICE.RETURN_TO_TITLE, 'yesno')) throw new BackToTitle(); });
      const nav = this.chrome(2, { world, channel, back: () => { if (!busy && !done) finish('back'); } });
      // page arrows: left goes to the previous page (wrapping) and its last character, right to the next page and its first place
      const pageTo = (d) => {
        page = (page + d + pages) % pages;
        const first = page * perPage, real = list.chars.length;
        const idx = d < 0 ? Math.min(first + perPage, real) - 1 : first;
        choose(idx >= first && idx < real ? idx : -1);
      };
      // pageL / pageR: state 0 normal, 1 while the mouse is over the click area
      const arrow = (node, x, r, d) => ({ r, d, spr: [new WzSprite(node[0], x, 320), new WzSprite(node[1], x, 320)] });
      const arrows = pages >= 2 ? [arrow(CS.pageL, 152, { x: 112, y: 300, w: 80, h: 40 }, -1), arrow(CS.pageR, 592, { x: 552, y: 300, w: 80, h: 40 }, 1)] : [];
      const arrowSpr = (a) => a.spr[inRect(this.mouse, a.r) ? 1 : 0];
      // hit areas: each character's drawn parts
      const hitChar = (idx, mx, my) => hitLook(looks[idx], anim[idx], placeX(idx % perPage), footY, mx, my);
      // the Tab hint shows on arrival; the first Tab fades it out over 1 s for good
      const hint = { fade: null };
      const layer = {
        hotspots: [],
        over: nav.over,
        buttons: [btnSelect, btnNew, btnDelete, ...nav.buttons],
        sprites: [],
        preload: [...beam.frames(), ...sparkle.frames(), ...shadow.frames(), ...ghost.frames(),
          ...[CS.scroll[0], CS.scroll[2]].flatMap((n) => new WzSprite(n).frames()), CS.charInfo, CS.charInfo1,
          CS.knight[0], CS.aran[0], CS.adventure[0], ...Object.values(this.L.WorldNotice.Balloon).filter((n) => n?._canvas), CS.icon.up, CS.icon.down, CS.icon.same, ...Object.values(CS.icon.job),
          ...arrows.flatMap((a) => a.spr.flatMap((sp) => sp.frames())),
          ...Object.values(CS.nameTag[0] || {}), ...Object.values(CS.nameTag[1] || {})],
        onEnter: () => { if (menu !== null) { sfx.play('UI/BtMouseClick'); board[menu].press(); } else start(); },
        onEscape: toTitle,
        onKey: (key) => {
          if (busy) return;
          if (key === 'Tab') {
            hint.fade ??= 0;
            focusMenu(menu === null ? nextEnabled(lastMenu, 1) : null);
          } else if (menu !== null) {
            if (key === 'ArrowUp' || key === 'ArrowDown') {
              const i = nextEnabled(menu + (key === 'ArrowUp' ? -1 : 1), key === 'ArrowUp' ? -1 : 1);
              if (i !== null) focusMenu(i);
            }
          } else if (key === 'ArrowLeft' && sel > 0) choose(sel - 1);
          else if (key === 'ArrowRight' && sel < list.chars.length - 1) choose(sel + 1);
        },
        onPointer: (mx, my) => {
          if (busy) return;
          for (const a of arrows) if (inRect({ x: mx, y: my }, a.r)) { pageTo(a.d); return; }
          for (let i = 0; i < perPage; i++) {
            const idx = page * perPage + i;
            if (idx >= list.chars.length || !hitChar(idx, mx, my)) continue;
            if (sel === idx && performance.now() - (this.lastCharClick || 0) < 400) start();   // double-click enters
            choose(idx); this.lastCharClick = performance.now();
            return;
          }
        },
        update: (dt) => {
          const ms = dt * 1000;
          beam.update(ms); sparkle.update(ms); shadow.update(ms); ghost.update(ms);
          for (const a of arrows) for (const sp of a.spr) sp.update(ms);
          if (hint.fade !== null) hint.fade += ms;
          if (this.camY === this.camTarget && panel.scroll) { // unroll once the camera has arrived
            if (!panel.rolled) { panel.rolled = true; sfx.play('UI/RollDown'); }
            panel.scroll.update(ms);
            if (panel.scroll.anim.done) panel.t += ms;
          }
          advanceLooks(looks, anim, sel, ms);
        },
        drawFront: (ctx) => {
          for (let i = 0; i < perPage; i++) {
            const idx = page * perPage + i, x = placeX(i);
            if (idx >= list.chars.length) {
              if (idx < list.slots) { shadow.x = ghost.x = x; shadow.y = ghost.y = footY; shadow.draw(ctx, this.assets); ghost.draw(ctx, this.assets); }
              continue;
            }
            const c = list.chars[idx], look = looks[idx], a = anim[idx];
            const bd = backdrops[idx]; bd.x = x; bd.y = footY; bd.draw(ctx, this.assets);
            if (idx === sel) { beam.x = 260 + 125 * i; beam.y = 0; beam.draw(ctx, this.assets); }
            drawParts(ctx, this.assets, look.compose(a.act || look.standAction(), a.frame), x, footY, CHAR_FACING_RIGHT);
            if (idx === sel) { sparkle.x = 260 + 125 * i; sparkle.y = 0; sparkle.draw(ctx, this.assets); }
            this.nameTag(ctx, c.stats.name, x, footY + 2, idx === sel);
          }
          for (const a of arrows) arrowSpr(a).draw(ctx, this.assets);
          layer.hotspots = arrows.map((a) => a.r);
          if (sel >= 0 && panel.scroll) {
            const at = panelAt();
            panel.scroll.x = at.x - 20; panel.scroll.y = at.y - 25;
            panel.scroll.draw(ctx, this.assets);
            if (panel.scroll.anim.done) this.drawCharInfo(ctx, list.chars[sel], at.x, at.y, Math.min(1, panel.t / 80));
          }
          if (hint.fade === null || hint.fade < 1000) this.tabHint(ctx, hint.fade === null ? 1 : 1 - hint.fade / 1000);
        },
      };
      rollPanel();
      this.setScreen(layer, 'char').then(() => { if (sel >= 0) sfx.play('UI/CharSelect'); });
    });
  }

  /** "Use the Tab key to toggle the menu." on a WorldNotice/Balloon box, 220x40. */
  tabHint(ctx, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    this.balloon(ctx, this.L.WorldNotice.Balloon, 272, 40, 220, 40);
    uiText(ctx, 'Use the Tab key to toggle the menu.', 282, 55, { color: '#000' });
    ctx.restore();
  }

  /** A 9-slice box (nw/n/ne/w/c/e/sw/s/se) with its top-left at x, y. */
  balloon(ctx, B, x, y, w, h) {
    const img = (k) => this.assets.image(B[k]);
    const [nw, ne, sw, se] = ['nw', 'ne', 'sw', 'se'].map(img);
    if (!nw || !ne || !sw || !se) return;
    const l = nw.width, t = nw.height, r = ne.width, b = sw.height;
    const put = (k, dx, dy, dw, dh) => { const i = img(k); if (i && dw > 0 && dh > 0) ctx.drawImage(i, x + dx, y + dy, dw, dh); };
    put('c', l, t, w - l - r, h - t - b);
    put('n', l, 0, w - l - r, t); put('s', l, h - b, w - l - r, b);
    const wi = img('w'), ei = img('e');
    put('w', l - (wi?.width || l), t, wi?.width || l, h - t - b); put('e', w - r, t, ei?.width || r, h - t - b);
    ctx.drawImage(nw, x, y); ctx.drawImage(ne, x + w - r, y); ctx.drawImage(sw, x, y + h - b); ctx.drawImage(se, x + w - r, y + h - b);
  }


  // ------------------------------------------------------------------ view all characters
  /**
   * Step 5: every world's characters in a 3x3 grid (ViewAllChar/backgrnd/1 at screen (122, 38)), the stats
   * panel for the selected one and Enter Game. Resolves with the game entry, or null back on world select.
   */
  async viewAll(server) {
    let cancelled = false;
    const loading = this.loading(() => { cancelled = true; this.s.close(); });
    let res;
    try { res = await this.s.viewAll(); } catch (e) { throw cancelled ? new BackToTitle() : e; } finally { loading.close(); }
    if (res.error === 'none') { await this.notice('Cannot find any characters.', 'info'); return null; }
    if (res.error) {
      await this.notice(res.error === 'connected' ? 'You are already connected to server.' : res.error === 'timeout' || res.error === 'unknown' ? 'Unknown Error : View-All-Characters.' : res.error, 'info');
      throw new BackToTitle();
    }
    const chars = res.chars.slice(0, 60);
    const VA = this.L.ViewAllChar, CS = this.L.CharSelect;
    this.B ??= await this.assets.json('UI/Basic.img');
    const barArt = Object.values(this.B?.VScr7 || {}).flatMap((st) => Object.values(st || {})).filter((n) => n?._canvas);
    const looks = await Promise.all(chars.map(async (c) => {
      const cl = new CharacterLook(this.assets, { skin: c.look.skin, face: c.look.face, hair: c.look.hair, gender: c.look.gender, equips: lookEquipIds(c.look) });
      await cl.load();
      await this.assets.preload(lookCanvases(cl, [cl.standAction(), cl.walkAction()]));
      return cl;
    }));
    return new Promise((resolve, reject) => {
      const VW = { x: 122, y: 38 }, P = { x: 520, y: 198 };
      let sel = 0, top = 0, busy = false, done = false;
      // fewer than 10 characters don't scroll; otherwise n / 3 - 2 rows (a partial last row can't be reached)
      const maxTop = chars.length < 10 ? 0 : Math.floor(chars.length / 3) - 2;
      // the scrollbar: its create call lost its arguments. A VScr7 (the style of the login's other scrollbar) centred in
      // the art's track beside the grid, whose inside is x 372-393, y 64-413 (350 tall) (unverified). The wheel works
      // over the bar and up to 350px left of it (its +0x34 is 0x15e), so over the grid.
      const bar = () => this.vscr7(VW.x + 375, VW.y + 64, 350);
      const anim = chars.map(() => ({ frame: 0, t: 0 }));
      const selFx = new WzSprite(VA.Select, 0, 0);
      const cell = (i) => { const rel = i - 3 * top; return rel >= 0 && rel <= 8 ? { c: rel % 3, r: Math.floor(rel / 3) } : null; };
      const choose = (i) => { sfx.play('UI/CharSelect'); sel = i; };
      const worldName = (id) => this.worlds.find((w) => w.id === id)?.name || '';
      const enter = async () => {
        if (busy || done || sel < 0) return;
        busy = true;
        try {
          const c = chars[sel], picMode = this.account?.picMode;
          const pic = await this.picFor(picMode);
          if (pic === null) return;
          const r = await this.s.selectFromAll(c.stats.id, c.world, pic, picMode);
          if (picMode === 0 && !r.wrongPic) this.picRegistered();
          if (r.wrongPic) { await this.notice(NOTICE.PIC_WRONG); return; }
          if (r.code !== undefined) { await this.loginFailed({ reason: r.code }); return; }
          sfx.play('Game/GameIn');
          this.s.close();
          done = true;
          const w = this.worlds.find((x) => x.id === c.world);
          resolve({ server, charId: c.stats.id, port: r.port, cafe: r.cafe, world: c.world, channels: w?.channels.length || 1, channelNames: (w?.channels || []).map((ch) => ch.name), stats: c.stats, look: c.look, gm: !!this.account?.gm, admin: this.account?.admin || 0 });
        } catch (e) { done = true; reject(e); } finally { busy = false; }
      };
      const back = async () => {
        if (busy || done) return;
        done = true;
        try { this.worlds = await this.s.leaveViewAll(); resolve(null); } catch (e) { reject(e); }
      };
      const nav = this.chrome(5, { back });
      const enterBtn = this.button(VA.BtEnter, 582, 432, enter);
      const scrollTo = (t) => {
        top = Math.max(0, Math.min(maxTop, t));
        // keep the selection in view, in the same column
        if (sel >= 0 && !cell(sel)) sel = Math.min(chars.length - 1, (sel < 3 * top ? 3 * top : 3 * (top + 2)) + (sel % 3));
      };
      const hit = (i, mx, my) => {
        const at = cell(i);
        if (!at) return false;
        return hitLook(looks[i], anim[i], VW.x + 74 + 117 * at.c, VW.y + 150 + 117 * at.r, mx, my);
      };
      const layer = {
        closeAtOnce: true,   // Back closes the window before the step change
        buttons: [enterBtn, ...nav.buttons],
        over: nav.over,
        sprites: [new WzSprite(VA.backgrnd[1], VW.x + 291, VW.y + 220)],   // origin (291, 220): top-left at (122, 38)
        preload: [...selFx.frames(), ...barArt, ...Object.values(VA.WorldIcons), VA.Job[0], CS.icon.up, CS.icon.down, CS.icon.same, ...Object.values(CS.icon.job),
          ...Object.values(CS.nameTag[0] || {}), ...Object.values(CS.nameTag[1] || {})],
        onEnter: enter,
        onWheel: (d) => {
          const b = bar(), m = this.mouse;
          if (b && !(m.x >= b.x - 350 && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h)) return;
          scrollTo(top + d);
        },
        onPointer: (mx, my) => {
          if (busy) return;
          const f = this.vscrClick(bar(), mx, my, top, maxTop);
          if (f !== null) { scrollTo(f); return; }
          for (let i = 0; i < chars.length; i++) {
            if (!hit(i, mx, my)) continue;
            if (sel === i && performance.now() - (this.lastVacClick || 0) < 400) enter();   // double-click enters
            choose(i); this.lastVacClick = performance.now();
            return;
          }
        },
        update: (dt) => {
          const ms = dt * 1000;
          selFx.update(ms);
          advanceLooks(looks, anim, sel, ms);
        },
        drawFront: (ctx) => {
          this.drawVScr(ctx, bar(), top, maxTop);
          chars.forEach((c, i) => {
            const at = cell(i);
            if (!at) return;
            const cx = VW.x + 117 * at.c, cy = VW.y + 117 * at.r;
            if (i === sel) { selFx.x = cx + 79; selFx.y = cy + 122; selFx.draw(ctx, this.assets); }
            drawParts(ctx, this.assets, looks[i].compose(anim[i].act || looks[i].standAction(), anim[i].frame), cx + 74, cy + 150, CHAR_FACING_RIGHT);
            const icon = this.assets.image(VA.WorldIcons[c.world]);
            if (icon) ctx.drawImage(icon, cx + 26, cy + 155);
            this.nameTag(ctx, c.stats.name, cx + 47, cy + 159, false, { fromLeft: true });   // grey even when selected
          });
          if (sel < 0) return;
          const c = chars[sel], s = c.stats;
          // name box (150x22) on nameTag/1, white text
          this.nameBox(ctx, s.name, VW.x + 409, VW.y + 107);
          const t = (v, dx, dy, align = 'left') => uiText(ctx, String(v), P.x + dx, P.y + dy, { color: '#000', align });
          t(worldName(c.world), 39, 64); t(loginJobName(s.job), 39, 82); t(s.level, 39, 100); t(s.fame, 39, 118);
          t(s.str, 39, 136); t(s.dex, 39, 154); t(s.int, 39, 172); t(s.luk, 39, 190);
          const rank = c.rank && c.rank.world && c.rank.job ? c.rank : null;
          // the job word goes in front of the second bar's "RANKING" (art x 485)
          const labelRight = VW.x + 481, labelY = VW.y + 181;
          if (!rank) {
            t('Ranking Not Available', 26, 0); t('Ranking Not Available', 26, 36);
            const job = this.assets.image(VA.Job[0]);
            if (job) ctx.drawImage(job, labelRight - job.width, labelY);
          } else {
            const section = (pos, move, dy, iconY) => {
              t(`Ranked at ${pos}`, 5, dy); t(Math.abs(move), 159, dy, 'right');
              const icon = this.assets.image(move > 0 ? CS.icon.up : move < 0 ? CS.icon.down : CS.icon.same);
              if (icon) ctx.drawImage(icon, P.x + 160, P.y + iconY(move));
            };
            section(rank.world, rank.worldMove, 0, (m) => (m ? 2 : 6));
            section(rank.job, rank.jobMove, 36, (m) => (m ? 38 : 42));
            const job = CS.icon.job[Math.floor((s.job % 1000) / 100)], label = job && this.assets.image(job);
            if (label) ctx.drawImage(label, labelRight - label.width, labelY);
          }
        },
      };
      this.setScreen(layer, 'vac').then(() => sfx.play('UI/CharSelect'));
    });
  }

  /** A Basic.img VScr7 bar, the login screens' scrollbar: its art and box (null until Basic.img is in). */
  vscr7(x, y, h) {
    const V = this.B?.VScr7;
    return V && { V, x, y, h, w: V.enabled?.prev0?._w || 15, a: V.enabled?.prev0?._h || 14, t: V.enabled?.thumb0?._h || 25 };
  }
  /** Draws bar b scrolled to first of max; greyed, with no thumb, when there is nothing to scroll. */
  drawVScr(ctx, b, first, max) {
    if (!b) return;
    const on = max > 0, S = on ? b.V.enabled : b.V.disabled, im = (n) => n && this.assets.image(n);
    const base = im(S.base), prev = im(on ? S.prev0 : S.prev), next = im(on ? S.next0 : S.next);
    if (base) ctx.drawImage(base, b.x, b.y + b.a, b.w, b.h - 2 * b.a);
    if (prev) ctx.drawImage(prev, b.x, b.y);
    if (next) ctx.drawImage(next, b.x, b.y + b.h - b.a);
    const thumb = on && im(S.thumb0);
    if (thumb) ctx.drawImage(thumb, b.x, b.y + b.a + Math.round((b.h - 2 * b.a - b.t) * first / max));
  }
  /** A click on bar b: the arrows step one, the track jumps there. The new first, or null when the click missed it. */
  vscrClick(b, mx, my, first, max) {
    if (!b || mx < b.x || mx >= b.x + b.w || my < b.y || my >= b.y + b.h) return null;
    if (my < b.y + b.a) return Math.max(0, first - 1);
    if (my >= b.y + b.h - b.a) return Math.min(max, first + 1);
    return Math.max(0, Math.min(max, Math.round(((my - b.y - b.a - b.t / 2) / (b.h - 2 * b.a - b.t)) * max)));
  }

  /** A 150x22 box of CharSelect/nameTag/1 pieces with the name centred in white. */
  nameBox(ctx, text, x, y, w = 150) {
    const node = this.L.CharSelect.nameTag[1];
    const l = this.assets.image(node[0]), m = this.assets.image(node[1]), r = this.assets.image(node[2]);
    if (l && m && r) {
      for (let mx = l.width; mx < w - r.width; mx += m.width) ctx.drawImage(m, x + mx, y);
      ctx.drawImage(l, x, y); ctx.drawImage(r, x + w - r.width, y);
    }
    ctx.save(); ctx.font = '12px Arial';
    const tw = Math.ceil(ctx.measureText(text).width);
    ctx.restore();
    uiText(ctx, text, x + Math.floor((w - tw) / 2) - 1, y + 2, { color: '#fff' });
  }

  // ------------------------------------------------------------------ race select
  /** Login.img/RaceSelect: Cygnus Knights / Explorers / Aran. Resolves with a RACES key or null. */
  raceSelect(world, channel) {
    const R = this.L.RaceSelect;
    return new Promise((resolve) => {
      let pick = 'normal', fade = null;
      // window at screen (0, -20)
      const spots = { knight: { x: 104, y: 59 }, normal: { x: 293, y: 59 }, aran: { x: 511, y: 60 } };
      const btn = { knight: R.knight.BtKnight, normal: R.normal.BtNormal, aran: R.aran.BtAran };
      const keys = Object.keys(spots);
      const on = Object.fromEntries(keys.map((k) => [k, new WzSprite(R[k].OnAnimation, spots[k].x, spots[k].y)]));
      const text = Object.fromEntries(keys.map((k) => [k, new WzSprite(R[k].text, 118, 291)]));
      // the buttons keep their normal art (label included); the chosen race's coloured figures draw over it
      const buttons = keys.map((k) => this.button(btn[k], spots[k].x, spots[k].y, () => {
        if (pick === k) { if (performance.now() - (this.lastRaceClick || 0) < 400) resolve(pick); this.lastRaceClick = performance.now(); return; }
        fade = { from: pick, t: 0 }; pick = k; this.lastRaceClick = performance.now();
      }));
      for (const b of buttons) b.alsoSound = 'UI/RaceSelect';
      const select = this.button(R.BtSelect, 566, 416, () => resolve(pick));
      const nav = this.chrome(3, { world, channel, back: () => resolve(null) });
      this.setScreen({
        buttons: [...buttons, select, ...nav.buttons],
        sprites: [new WzSprite(R.textGL[0], 408, 51)],
        over: nav.over,
        preload: [...Object.values(on).flatMap((s) => s.frames()), ...Object.values(text).flatMap((s) => s.frames())],
        onEnter: () => resolve(pick), onEscape: () => resolve(null),
        update: (dt) => { on[pick].update(dt * 1000); if (fade && (fade.t += dt * 1000) >= 200) fade = null; },
        drawFront: (ctx) => {
          on[pick].draw(ctx, this.assets);
          // the race text cross-fades over 200 ms
          const k = fade ? fade.t / 200 : 1;
          if (fade) { text[fade.from].alpha = 1 - k; text[fade.from].draw(ctx, this.assets); }
          text[pick].alpha = k; text[pick].draw(ctx, this.assets);
          select.draw(ctx, this.assets);
        },
      }, 'race');
    });
  }

  // ------------------------------------------------------------------ character creation
  /**
   * The name board, then the settings board, whose 9 rows (FACE ... WEAPON, GENDER) step through
   * Etc/MakeCharInfo.img and show each option's name. Resolves with the new character, or null when
   * the name board is cancelled (back to race select).
   */
  async creator(race, world, channel) {
    const cfg = RACES[race], NC = this.L[cfg.ui];
    const [mci, eqp] = await Promise.all([this.assets.json('Etc/MakeCharInfo.img'), this.assets.json('String/Eqp.img')]);
    const table = (g) => (cfg.info === 'Orient' ? mci?.[`OrientChar${g ? 'Female' : 'Male'}`] : mci?.Info?.[`Char${g ? 'Female' : 'Male'}`]);
    if (!table(0) || !table(1)) { await this.notice('Etc/MakeCharInfo.img is missing.'); return null; }
    // lists[gender][row]: option ids, rotated so the current one is first; row 8 is the gender itself
    const lists = [0, 1].map((g) => Array.from({ length: 9 }, (_, r) => (r === 8 ? [g] : Object.values(table(g)[r] || {}))));
    let gender = this.account.gender === 1 ? 1 : 0;
    // the current gender's rows start on a random option
    for (const l of lists[gender]) if (l.length > 1) l.push(...l.splice(0, Math.floor(Math.random() * l.length)));
    const value = (r) => lists[gender][r][0];
    const E = eqp?.Eqp || eqp || {};
    const itemName = (id) => { for (const c of ['Face', 'Coat', 'Longcoat', 'Pants', 'Shoes', 'Weapon', 'Hair']) if (E[c]?.[id]?.name) return E[c][id].name; return ''; };
    const optionName = (r) => {
      if (r === 8) return gender ? 'Female' : 'Male';
      const id = value(r);
      if (r >= 1 && r <= 3) return mci?.Name?.[`Char${gender ? 'Female' : 'Male'}`]?.[r]?.[id] ?? (r === 1 ? itemName(id) : '');
      return itemName(id);
    };
    const preview = { x: 394, y: 339 };
    // the preview stands still on its first frame
    let look = null, name = '';
    let build = 0;
    const rebuild = async () => {
      const n = ++build;
      const l = new CharacterLook(this.assets, { skin: value(3), face: value(0), hair: value(1) + value(2), gender, equips: [value(4), value(5), value(6), value(7)] });
      await l.load();
      await this.assets.preload(lookCanvases(l, ['stand1']));
      if (n === build) look = l;   // a later click wins even if an earlier look loads last
    };
    await rebuild();
    const drawPreview = (ctx) => { if (look) drawParts(ctx, this.assets, look.compose('stand1', 0), preview.x, preview.y, true); };
    const nav = this.chrome(3, { world, channel, back: () => leave?.() });
    let leave = null;

    for (;;) {
      // name board
      const chosen = await new Promise((resolve) => {
        const keep = [...this.fields], B = cfg.name, at = (o) => [B.x + o[0], B.y + o[1]];
        const f = this.field(B.x + B.field[0], B.y + B.field[1] - 3, 120, 20, { max: 12, color: '#fff' });
        f.value = name;
        let checking = false;
        const done = (v) => { this.clearFields(keep); leave = null; resolve(v); };
        const check = async () => {
          if (checking) return;
          checking = true;
          try {
            const n = f.value;
            if (!(await this.nameAllowed(n))) { await this.notice(NOTICE.BAD_NAME); f.focus(); return; }
            const r = await this.s.checkName(n);
            if (r !== 0) { await this.notice(r === 1 ? NOTICE.NAME_IN_USE : r === 2 ? NOTICE.BAD_NAME : NOTICE.UNKNOWN); f.focus(); return; }
            done(n);
          } finally { checking = false; }
        };
        leave = () => done(null);
        this.setScreen({
          sprites: [new WzSprite(NC.charName, B.x, B.y)],
          buttons: [this.button(NC.BtYes, ...at(B.yes), check), this.button(NC.BtNo, ...at(B.no), () => done(null)), ...nav.buttons],
          over: nav.over,
          onEnter: () => { if (f.value) check(); }, onEscape: () => done(null), drawFront: drawPreview,
        }, 'create', cfg.camY).then(() => setTimeout(() => f.focus(), 50));
      });
      if (chosen === null) return null;
      name = chosen;

      // settings board
      const created = await new Promise((resolve) => {
        const B = cfg.set, at = (o) => [B.x + o[0], B.y + o[1]];
        const rowY = (i) => B.y + B.rowY + i * 18;
        const arrows = [];
        let busy = false;
        for (let r = 0; r < 9; r++) {
          const step = (d) => {
            if (r === 8) gender = 1 - gender;
            else {
              const l = lists[gender][r];
              if (l.length < 2) return;
              if (d > 0) l.push(l.shift()); else l.unshift(l.pop());
            }
            rebuild();
          };
          arrows.push(this.button(NC.BtLeft, B.x + B.left, rowY(r), () => step(-1)), this.button(NC.BtRight, B.x + B.right, rowY(r), () => step(1)));
        }
        const yes = async () => {
          if (busy) return;
          busy = true;
          try {
            const c = await this.s.createChar({
              name, job: cfg.job, face: value(0), hair: value(1), hairColor: value(2), skin: value(3),
              top: value(4), bottom: value(5), shoes: value(6), weapon: value(7), gender,
            });
            if (!c) { await this.notice(NOTICE.UNKNOWN); return; }
            leave = null;
            resolve(c);
          } finally { busy = false; }
        };
        leave = () => { leave = null; resolve(false); };
        this.setScreen({
          sprites: [new WzSprite(NC.charSet, B.x, B.y), ...Array.from({ length: 9 }, (_, r) => new WzSprite(NC.avatarSel[r].normal, B.x + B.labelX, rowY(r)))],
          buttons: [...arrows, this.button(NC.BtYes, ...at(B.yes), yes), this.button(NC.BtNo, ...at(B.no), () => resolve(false)), ...nav.buttons],
          over: nav.over,
          onEnter: yes, onEscape: () => resolve(false),
          drawFront: (ctx) => {
            drawPreview(ctx);
            for (let r = 0; r < 9; r++) uiText(ctx, optionName(r), B.x + B.textX, B.y + B.textY + r * 18, { color: '#000', align: 'center' });
          },
        }, 'create', cfg.camY);
      });
      if (created) return created;
      // Cancel on the settings board goes back to the name board
    }
  }

  /** 4-12 letters or digits, with no word from Etc/ForbiddenName.img or Etc/Curse.img in it. */
  /** 4-12 letters and digits, fewer than four I / l in all, and no forbidden or curse word (a curse entry up to its ','). */
  async nameAllowed(name) {
    if (!/^[a-zA-Z0-9]{4,12}$/.test(name) || (name.match(/[Il]/g) || []).length >= 4) return false;
    this.badWords ??= await Promise.all(['Etc/ForbiddenName.img', 'Etc/Curse.img'].map((p) => this.assets.json(p)))
      .then((lists) => lists.flatMap((l) => Object.values(l || {})).filter((w) => typeof w === 'string' && w).map((w) => w.split(',')[0].toLowerCase()).filter(Boolean));
    const low = name.toLowerCase();
    return !this.badWords.some((w) => low.includes(w));
  }

  /** Name tag from CharSelect/nameTag/<0|1> (left, middle tiled every 9 px, right); grey text unless selected. */
  nameTag(ctx, text, x, y, selected, { fromLeft = false } = {}) {
    const node = this.L.CharSelect.nameTag[selected ? 1 : 0];
    ctx.save(); ctx.font = '12px Arial';
    const tw = Math.ceil(ctx.measureText(text).width);
    ctx.restore();
    const w = tw < 41 ? 58 : tw + 18, left = fromLeft ? x : Math.round(x - w / 2);
    const l = this.assets.image(node[0]), m = this.assets.image(node[1]), r = this.assets.image(node[2]);
    if (l && m && r) {
      ctx.drawImage(l, left, y);
      for (let mx = l.width; mx < w - r.width; mx += m.width) ctx.drawImage(m, left + mx, y);
      ctx.drawImage(r, left + w - r.width, y);
    } else { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(left, y, w, 20); }
    uiText(ctx, text, left + Math.floor((w - tw) / 2) - 1, y + 2, { color: selected ? '#fff' : '#999999' });
  }

  /** Info panel (charInfo, or charInfo1 with both ranking sections when ranked) with its top-left at x, y. */
  drawCharInfo(ctx, c, x, y, alpha) {
    const CS = this.L.CharSelect, s = c.stats, rank = c.rank;
    ctx.save(); ctx.globalAlpha = alpha;
    const bg = this.assets.image(rank ? CS.charInfo1 : CS.charInfo);
    if (bg) ctx.drawImage(bg, x, y);
    const t = (v, dx, dy, align = 'left') => uiText(ctx, String(v), x + dx, y + dy, { color: '#000', align });
    t(loginJobName(s.job), 46, 1);
    t(s.level, 46, 19); t(s.fame, 136, 19);
    t(s.str, 46, 37); t(s.int, 136, 37);
    t(s.dex, 46, 55); t(s.luk, 136, 55);
    if (!rank) t('Ranking Not Available', 36, 99);
    else {
      const section = (pos, move, ty, iconY) => {
        t(`Ranked at ${pos}`, 115, ty, 'right');
        t(Math.abs(move), 165, ty, 'right');
        const icon = this.assets.image(move > 0 ? CS.icon.up : move < 0 ? CS.icon.down : CS.icon.same);
        if (icon) ctx.drawImage(icon, x + 170, y + iconY(move));
      };
      section(rank.world, rank.worldMove, 99, (m) => (m ? 105 : 101));
      section(rank.job, rank.jobMove, 135, (m) => (m ? 141 : 137));
      // BEGINNER / WARRIOR / MAGICIAN / BOWMAN / THIEF goes before the art's "RANKING" (which starts at x 88)
      const job = CS.icon.job[Math.floor((s.job % 1000) / 100)];
      const label = job && this.assets.image(job);
      if (label) ctx.drawImage(label, x + 84 - label.width, y + 120);
    }
    ctx.restore();
  }
}

/** Whether a point is on a character's drawn parts, its feet at (x, y). */
function hitLook(look, a, x, y, mx, my) {
  return look.compose(a.act || look.standAction(), a.frame).some((p) => {
    const w = p.node?._w || 0, h = p.node?._h || 0, px = CHAR_FACING_RIGHT ? x - p.x - w : x + p.x;
    return mx >= px && mx < px + w && my >= y + p.y && my < y + p.y + h;
  });
}

/** Steps each character's animation: the selected one walks, the rest stand. */
function advanceLooks(looks, anims, sel, ms) {
  looks.forEach((look, i) => {
    const a = anims[i], act = charAct(look, i === sel);
    if (a.act !== act) { a.act = act; a.frame = 0; a.t = 0; }
    a.t += ms;
    while (a.t >= look.delay(act, a.frame)) { a.t -= look.delay(act, a.frame); a.frame = (a.frame + 1) % Math.max(1, look.frameCount(act)); }
  });
}

/** Wraps a drawable so it slides in from x -149 over ms, timed from its first draw. */
function slideIn(item, ms) {
  let t0 = null;
  return {
    frames: () => item.frames(),
    draw(ctx, assets) {
      t0 ??= performance.now();
      const k = Math.min(1, (performance.now() - t0) / ms);
      ctx.save(); ctx.translate(Math.round(-149 * (1 - k)), 0);
      item.draw(ctx, assets);
      ctx.restore();
    },
  };
}

function inRect(p, r) { return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; }
