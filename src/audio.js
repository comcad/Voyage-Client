/**
 * Background music from Sound.wz (extracted by tools/wz-extract.mjs to assets/Sound/<Bgm>.img/<name>.mp3).
 * Maps name their track in info/bgm, e.g. "Bgm00/FloralLife"; the login uses "BgmUI/Title".
 * Browsers block audio until the first user gesture, so a pending track starts on the first click/key.
 */
/**
 * A volume slider (0-1) as the client hears it (Sound_DX8, openms docs/ingame-audiovisual.md): the slider is a
 * backend level 0-128, attenuated by 625 - 1280000/(15*level + 128) hundredths of a decibel, so each step sounds
 * like an even change instead of all the difference crowding into the quiet end.
 */
export function sliderGain(v) {
  const level = Math.round(Math.max(0, Math.min(1, v)) * 128);
  if (level < 1) return 0;
  if (level >= 128) return 1;
  return Math.min(1, 10 ** ((625 - Math.trunc(1280000 / (15 * level + 128))) / 2000));
}
// a new track starts at once while the old one fades out over 600ms on its own
const BGM_FADE = 600;
const STEPS = 19, DEFAULT_STEP = 15;
const snap = (v) => Math.round(Math.max(0, Math.min(1, v)) * STEPS) / STEPS;
const stepGain = (v) => sliderGain((Math.round(snap(v) * STEPS) + 1) / (STEPS + 1));

class Music {
  constructor() {
    this.level = this.loadVolume();
    this.isMuted = load('maple.bgmMute') === '1';
    this.track = null;          // { el, k: fade factor, timer }
    this.fading = new Set();    // old tracks still fading out
    this.current = null;
    // resume on any gesture: browsers hold audio back until the first one
    const unlock = () => { const el = this.track?.el; if (this.current && el?.src && el.paused && !el.ended) el.play().catch(() => {}); };   // not one that played out
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  loadVolume() {
    try { const v = Number(localStorage.getItem('maple.bgm')); return snap(Number.isFinite(v) && localStorage.getItem('maple.bgm') !== null ? v : DEFAULT_STEP / STEPS); } catch { return DEFAULT_STEP / STEPS; }
  }

  setVolume(v) {
    this.level = snap(v);
    this.applyVolume();
    try { localStorage.setItem('maple.bgm', String(this.level)); } catch { /* ignore */ }
  }
  apply(t) { t.el.volume = Math.max(0, Math.min(1, stepGain(this.level) * t.k)); }
  applyVolume() { for (const t of [this.track, ...this.fading]) if (t) this.apply(t); }
  /** Ramp a track's fade factor to `to` over ms. */
  ramp(t, to, ms) {
    clearInterval(t.timer);
    if (ms <= 0) { t.k = to; this.apply(t); return Promise.resolve(); }
    const from = t.k, t0 = performance.now();
    return new Promise((resolve) => {
      t.timer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        t.k = from + (to - from) * k; this.apply(t);
        if (k >= 1) { clearInterval(t.timer); resolve(); }
      }, 30);
    });
  }
  /** Let the playing track go: it fades out over ms by itself, then stops. */
  release(ms) {
    const t = this.track;
    this.track = null;
    if (!t) return;
    if (t.el.paused || ms <= 0) { clearInterval(t.timer); t.el.pause(); return; }
    this.fading.add(t);
    this.ramp(t, 0, ms).then(() => { t.el.pause(); this.fading.delete(t); });
  }

  get volume() { return this.level; }
  get muted() { return this.isMuted; }
  setMuted(m) {
    this.isMuted = !!m;
    for (const t of [this.track, ...this.fading]) if (t) t.el.muted = this.isMuted;
    save('maple.bgmMute', m ? '1' : '0');
  }

  /**
   * bgm: "Bgm00/FloralLife" style path from map info. Same track keeps playing across maps, unless forced.
   * fadeOut: ms for the old track to fade (it overlaps the new one); fadeIn: ms for the new one to come up (0: at once).
   */
  async play(bgm, { loop = true, fadeOut = BGM_FADE, fadeIn = 0, force = false } = {}) {
    if (!bgm || (bgm === this.current && !force)) return;
    this.current = bgm;
    const [img, ...name] = bgm.split('/');
    const url = `/assets/Sound/${img}.img/${name.join('/')}.mp3`;
    // Sound.wz may not be extracted: check first so a missing file doesn't spam errors
    const ok = await fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    if (this.current !== bgm) return;
    this.release(fadeOut);
    if (!ok) return;
    const el = new Audio(url);
    el.loop = loop; el.muted = this.isMuted;
    const t = { el, k: fadeIn > 0 ? 0 : 1, timer: 0 };
    this.track = t; this.apply(t);
    el.play().catch(() => {});
    if (fadeIn > 0) this.ramp(t, 1, fadeIn);
  }

  /** Stop the music (fading out over fadeOut ms); the next play starts its track from the beginning. */
  stop(fadeOut = 0) {
    this.current = null;
    this.release(fadeOut);
  }
}

function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* storage off */ } }

export const music = new Music();

/**
 * Sound effects from Sound.wz, e.g. sfx.play('Game/Jump'), 'Mob/0100100/Damage', 'Skill/1001004/Use'.
 * Web Audio so effects overlap and start instantly; each <img>.img.json index is fetched once and
 * UOL links (many mobs share another mob's sounds) are followed. Missing sounds are skipped quietly.
 */
class Sfx {
  constructor() {
    this.ctx = null;
    this.imgs = new Map();     // 'Mob' -> Promise<index json>
    this.buffers = new Map();  // url -> Promise<AudioBuffer | null>
    this.last = new Map();     // path -> last start time, so multi-hit lines don't stack the same sound
    this.volume = this.loadVolume();
    this.muted = load('maple.sfxMute') === '1';
    const unlock = () => { this.context()?.resume().catch(() => {}); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    // in-game windows are DOM: every button click gets the client's click sound
    document.addEventListener('click', (e) => { if (e.target.closest?.('button')) this.play('UI/BtMouseClick'); }, true);
  }

  loadVolume() {
    try { const v = localStorage.getItem('maple.sfx'); return snap(v !== null && Number.isFinite(Number(v)) ? Number(v) : DEFAULT_STEP / STEPS); } catch { return DEFAULT_STEP / STEPS; }
  }

  // the volume and mute reach sounds already playing too
  applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : stepGain(this.volume); }
  setVolume(v) {
    this.volume = snap(v); this.applyVolume();
    try { localStorage.setItem('maple.sfx', String(this.volume)); } catch { /* ignore */ }
  }

  setMuted(m) { this.muted = !!m; this.applyVolume(); save('maple.sfxMute', m ? '1' : '0'); }

  context() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return null; }
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination); this.applyVolume();
    }
    return this.ctx;
  }

  /** 'Mob/0100100/Damage' -> mp3 url, following UOLs (relative to the linking node's parent). */
  async resolve(path) {
    // a full path into another file ("Effect/Direction3.img/sound/title") is read from that folder
    const full = path.match(/^([^/]+)\/([^/]+)\.img\/(.*)$/);
    const dir = full ? full[1] : 'Sound';
    const [img, ...parts] = full ? [full[2], ...full[3].split('/')] : path.split('/');
    const key = `${dir}/${img}`;
    if (!this.imgs.has(key)) this.imgs.set(key, fetch(`/assets/${dir}/${img}.img.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    const root = await this.imgs.get(key);
    let stack = [], node = root;
    for (let i = 0; i < parts.length && node; i++) {
      node = node[parts[i]];
      stack.push(parts[i]);
      for (let hops = 0; node?._uol && hops < 4; hops++) {
        const at = stack.slice(0, -1);
        for (const seg of node._uol.split('/')) { if (seg === '..') at.pop(); else if (seg !== '.') at.push(seg); }
        stack = at; node = at.reduce((n, k) => n?.[k], root);
      }
    }
    return node?._sound ? `/assets/${dir}/${node._sound}` : null;
  }

  async buffer(path) {
    const url = await this.resolve(path);
    if (!url) return null;
    if (!this.buffers.has(url)) {
      this.buffers.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b && this.context() ? this.ctx.decodeAudioData(b) : null)).catch(() => null));
    }
    return this.buffers.get(url);
  }

  /** Resolves true when the sound exists (even if muted or not yet unlocked), false when it doesn't. */
  async play(path, { volume = 1 } = {}) {
    const now = performance.now();
    if (now - (this.last.get(path) || 0) < 40) return true;
    this.last.set(path, now);
    const buf = await this.buffer(path);
    if (!buf) return false;
    this.start(buf, volume);
    return true;
  }

  /** Whether path has a sound. */
  async has(path) { return !!(await this.buffer(path)); }

  /** Loop path until the returned stop function is called (null when it doesn't exist or can't play now). */
  async loop(path, { volume = 1 } = {}) {
    const buf = await this.buffer(path);
    return buf ? this.start(buf, volume, true) : null;
  }

  start(buf, volume, loop = false) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;   // muted: the master gain holds it silent
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buf; src.loop = loop; gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start();
    return () => { try { src.stop(); } catch { /* already stopped */ } };
  }
}

export const sfx = new Sfx();

/** A track's length in ms (0 when it can't be loaded), e.g. "Jukebox/Congratulation". */
export function songLength(bgm) {
  const [img, ...name] = String(bgm || '').split('/');
  return new Promise((done) => {
    const el = new Audio();
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0);
    el.onerror = () => done(0);
    el.src = `/assets/Sound/${img}.img/${name.join('/')}.mp3`;
  });
}
