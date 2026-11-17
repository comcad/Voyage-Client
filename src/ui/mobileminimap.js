/**
 * MOBILE UI's mini map, at the top left in its glass style. It shows what the MiniMap window shows, through that
 * window's own code: the map's mark, name and street; the map's miniMap picture, centred on you and stopped at its
 * edges (at most 210 x 112, as the window's view); and its markers (you, other players, party, guild, buddies and
 * spouse, portals, hired merchants, NPCs with their quest marks). A map that hides its mini map shows the name bar
 * alone. A tap on the picture opens the World Map; the fold button keeps just the name bar (remembered on this
 * device). It steps aside while a sheet is open.
 */
const KEY = 'voyage.mobileMinimap';
const FOLD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>';
const OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg>';

const CSS = `
/* at the screen's very left edge, as the chat (not held in by a phone's side inset) */
.mhud .mh-mm { position: absolute; left: 4px; top: 6px; padding: 5px 6px 6px; pointer-events: auto; max-width: 240px; }
.mhud.mh-sheeting .mh-mm { display: none; }
.mhud .mh-mm-head { display: flex; align-items: center; gap: 6px; padding: 0 1px 5px 2px; min-width: 120px; }
.mhud .mh-mm.mh-folded .mh-mm-head, .mhud .mh-mm.mh-none .mh-mm-head { padding-bottom: 0; }
.mhud .mh-mm-mark { flex: none; width: 22px; height: 22px; object-fit: contain; image-rendering: pixelated; }
.mhud .mh-mm-names { flex: 1; min-width: 0; }
.mhud .mh-mm-names b { display: block; font-size: 11.5px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-mm-names span { display: block; font-size: 9.5px; color: rgba(225, 232, 248, 0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-mm-fold { flex: none; width: 22px; height: 22px; }
.mhud .mh-mm-fold svg { width: 12px; height: 12px; }
.mhud .mh-mm-pic { display: block; border-radius: 8px; background: rgba(0, 0, 0, 0.3); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); cursor: pointer; }
.mhud .mh-mm.mh-folded .mh-mm-pic, .mhud .mh-mm.mh-none .mh-mm-pic { display: none; }
`;

export class MobileMiniMap {
  constructor(hud, root) {
    this.hud = hud; this.g = hud.g;
    if (!document.getElementById('mhud-mm-css')) {
      const s = document.createElement('style');
      s.id = 'mhud-mm-css'; s.textContent = CSS;
      document.head.append(s);
    }
    const el = this.el = document.createElement('div');
    el.className = 'mh-mm mh-glass';
    el.innerHTML = `<div class="mh-mm-head"><img class="mh-mm-mark" alt=""><div class="mh-mm-names"><b></b><span></span></div>
      <div class="mh-btn mh-mm-fold" title="Fold"></div></div><canvas class="mh-mm-pic"></canvas>`;
    root.append(el);
    const $ = (s) => el.querySelector(s);
    this.p = { mark: $('.mh-mm-mark'), name: $('.mh-mm-names b'), street: $('.mh-mm-names span'), fold: $('.mh-mm-fold'), pic: $('.mh-mm-pic') };
    this.ctx = this.p.pic.getContext('2d');
    try { this.folded = localStorage.getItem(KEY) === 'folded'; } catch { this.folded = false; }
    hud.tap(this.p.fold, () => this.setFolded(!this.folded));
    hud.tap(this.p.pic, () => this.win?.openWorldMap());
    this.setFolded(this.folded);
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  get win() { return this.g.windows?.wins.minimap; }
  setFolded(on) {
    this.folded = !!on;
    this.el.classList.toggle('mh-folded', this.folded);
    this.p.fold.innerHTML = this.folded ? OPEN : FOLD;
    this.p.fold.title = this.folded ? 'Show the mini map' : 'Fold the mini map';
    try { localStorage.setItem(KEY, this.folded ? 'folded' : 'open'); } catch { /* storage off */ }
  }

  /** Each frame while it shows: the names when the map changes, then the picture and its markers. */
  frame() {
    const g = this.g, w = this.win;
    if (!w || !g.map || this.hud.el.style.display === 'none' || this.hud.el.classList.contains('mh-sheeting')) return;
    if (this.mapSeen !== g.map) {
      this.mapSeen = g.map;
      const n = w.names() || {};
      this.p.name.textContent = n.mapName || g.map.name || '';
      this.p.street.textContent = n.streetName || '';
      this.p.street.style.display = n.streetName ? '' : 'none';
      const mark = w.mark();
      this.p.mark.style.display = mark?._canvas ? '' : 'none';
      if (mark?._canvas) this.p.mark.src = `${g.assets.base}/${mark._canvas}`;
    }
    const v = w.available() ? w.view() : null;
    this.el.classList.toggle('mh-none', !v);
    if (!v || this.folded) return;
    const img = g.windows.image(v.c);
    if (!img) { g.assets.preload([v.c]); return; }
    // drawn at the screen's own density, pixel for pixel
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1), cv = this.p.pic, ctx = this.ctx;
    if (cv.width !== Math.round(v.vw * dpr) || cv.height !== Math.round(v.vh * dpr)) {
      cv.width = Math.round(v.vw * dpr); cv.height = Math.round(v.vh * dpr);
      cv.style.width = `${v.vw}px`; cv.style.height = `${v.vh}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, v.vw, v.vh);
    const sc = w.scroll(v);
    ctx.drawImage(img, sc.x, sc.y, v.vw, v.vh, 0, 0, v.vw, v.vh);
    // the window's markers, placed from this picture's corner instead of its own
    const left = w.left, top = w.top;
    w.left = 0; w.top = 0;
    try { w.drawMarkers(ctx, v, sc); } finally { w.left = left; w.top = top; }
  }
}
