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
const BGM_FADE = 600;   // map music hands over in 600ms (the client's transition), not a hard cut

class Music {
  constructor() {
    this.el = new Audio();
    this.el.loop = true;
    this.level = this.loadVolume(); this.fadeK = 1;
    this.applyVolume();
    this.el.muted = load('maple.bgmMute') === '1';
    this.current = null;
    this.blocked = false;
    const unlock = () => { if (this.blocked) this.el.play().then(() => { this.blocked = false; }).catch(() => {}); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  loadVolume() {
    try { const v = Number(localStorage.getItem('maple.bgm')); return Number.isFinite(v) && localStorage.getItem('maple.bgm') !== null ? v : 0.5; } catch { return 0.5; }
  }

  setVolume(v) {
    this.level = Math.max(0, Math.min(1, v));
    this.applyVolume();
    try { localStorage.setItem('maple.bgm', String(this.level)); } catch { /* ignore */ }
  }
  applyVolume() { this.el.volume = sliderGain(this.level) * this.fadeK; }
  /** Ramp the fade factor to `to` over BGM_FADE ms. */
  fade(to) {
    clearInterval(this.fadeTimer);
    const from = this.fadeK, t0 = performance.now();
    return new Promise((resolve) => {
      this.fadeTimer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / BGM_FADE);
        this.fadeK = from + (to - from) * k; this.applyVolume();
        if (k >= 1) { clearInterval(this.fadeTimer); resolve(); }
      }, 30);
    });
  }

  get volume() { return this.level; }
  get muted() { return this.el.muted; }
  setMuted(m) { this.el.muted = !!m; save('maple.bgmMute', m ? '1' : '0'); }

  /** bgm: "Bgm00/FloralLife" style path from map info. Same track keeps playing across maps. */
  async play(bgm) {
    if (!bgm || bgm === this.current) return;
    this.current = bgm;
    const [img, name] = bgm.split('/');
    const url = `/assets/Sound/${img}.img/${name}.mp3`;
    // Sound.wz may not be extracted: check first so a missing file doesn't spam errors
    const ok = await fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    if (this.current !== bgm) return;
    // the old track fades out, the new one fades in
    if (!this.el.paused && this.el.src) { await this.fade(0); if (this.current !== bgm) return; }
    if (!ok) { this.el.pause(); return; }
    this.el.src = url;
    this.fadeK = 0; this.applyVolume();
    this.el.play().then(() => { this.blocked = false; }).catch(() => { this.blocked = true; });
    this.fade(1);
  }

  stop() { this.current = null; this.el.pause(); }
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
    try { const v = localStorage.getItem('maple.sfx'); return v !== null && Number.isFinite(Number(v)) ? Number(v) : 0.6; } catch { return 0.6; }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('maple.sfx', String(this.volume)); } catch { /* ignore */ }
  }

  setMuted(m) { this.muted = !!m; save('maple.sfxMute', m ? '1' : '0'); }

  context() {
    if (!this.ctx) { try { this.ctx = new AudioContext(); } catch { return null; } }
    return this.ctx;
  }

  /** 'Mob/0100100/Damage' -> mp3 url, following UOLs (relative to the linking node's parent). */
  async resolve(path) {
    const [img, ...parts] = path.split('/');
    if (!this.imgs.has(img)) this.imgs.set(img, fetch(`/assets/Sound/${img}.img.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    const root = await this.imgs.get(img);
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
    return node?._sound ? `/assets/Sound/${node._sound}` : null;
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
    const ctx = this.ctx;
    if (!this.volume || this.muted || !ctx || ctx.state !== 'running') return true;
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buf; gain.gain.value = sliderGain(this.volume) * volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
    return true;
  }
}

export const sfx = new Sfx();
