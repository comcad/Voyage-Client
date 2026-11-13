import { h, svg, fill, fmt } from './ui.js';

/**
 * A line chart over time for the admin page: one measure on one axis, one or two series of it. Thin lines on a
 * hairline grid from zero; the latest value is written in the heading rather than on the plot; moving over the plot
 * (or the arrow keys, with it focused) reads off every series at the nearest sample.
 */
const H = 150, L = 46, R = 14, T = 10, B = 22;
/** The top of an axis that holds `max`: a round number whose half is round too (`whole`: both whole numbers). */
const nice = (max, whole) => {
  if (!(max > 0)) return whole ? 2 : 1;
  const p = 10 ** Math.floor(Math.log10(max)), m = max / p;
  const top = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 4 ? 4 : m <= 5 && !whole ? 5 : m <= 6 ? 6 : m <= 8 ? 8 : 10) * p;
  return whole ? Math.max(2, top) : top;
};

export class LineChart {
  /**
   * series: [{ key, name }] (what to read from each sample, and what it is called); format(v) writes a value;
   * top: the least the axis goes up to (so a quiet chart doesn't swing); gap: ms between samples past which the
   * line breaks instead of bridging; whole: what is counted comes in whole numbers (players, hitches).
   */
  constructor({ title, series, format = (v) => fmt.num(v), top = 0, gap = 20000, whole = false }) {
    this.series = series; this.format = format; this.top = top; this.gap = gap; this.whole = whole;
    this.points = []; this.from = 0; this.to = 1; this.at = -1;
    this.now = h('div', { class: 'chart-now' });
    this.plot = h('div', { class: 'plot', tabindex: 0, role: 'img', 'aria-label': `${title}: a line chart over time. Arrow keys read the values.` });
    this.tip = h('div', { class: 'tip', hidden: true });
    this.el = h('section', { class: 'chart' }, h('header', null, h('h3', null, title), this.now), this.plot);
    this.plot.addEventListener('pointermove', (e) => this.hover(e.clientX - this.plot.getBoundingClientRect().left));
    this.plot.addEventListener('pointerleave', () => { if (document.activeElement !== this.plot) this.show(-1); });
    this.plot.addEventListener('blur', () => this.show(-1));
    this.plot.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const n = this.points.length;
      if (n) this.show(Math.min(n - 1, Math.max(0, (this.at < 0 ? n - 1 : this.at) + (e.key === 'ArrowLeft' ? -1 : 1))));
    });
    new ResizeObserver(() => this.draw()).observe(this.plot);
  }

  /** The samples to show (each { t, ...values }) and the stretch of time the axis covers. */
  set(points, from, to) {
    this.points = points.filter((p) => p.t >= from && p.t <= to);
    this.from = from; this.to = to;
    this.draw();
  }

  x(t) { return L + ((t - this.from) / Math.max(1, this.to - this.from)) * (this.w - L - R); }
  y(v) { return T + (1 - v / this.max) * (H - T - B); }

  draw() {
    const w = (this.w = Math.max(240, this.plot.clientWidth)), pts = this.points, many = this.series.length > 1;
    let max = this.top;
    for (const p of pts) for (const s of this.series) if (p[s.key] > max) max = p[s.key];
    this.max = nice(max, this.whole);
    const g = svg('svg', { viewBox: `0 0 ${w} ${H}`, width: w, height: H, 'aria-hidden': 'true' });
    for (const f of [0, 0.5, 1]) {
      const y = this.y(this.max * f);
      g.append(svg('line', { x1: L, x2: w - R, y1: y, y2: y, class: f ? 'grid' : 'axis' }), svg('text', { x: L - 6, y: y + 3.5, class: 'tick', 'text-anchor': 'end' }, this.format(this.max * f)));
    }
    const span = this.to - this.from, step = span / 4;
    for (let i = 0; i <= 4; i++) {
      const t = this.from + step * i;
      g.append(svg('text', { x: this.x(t), y: H - 6, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, fmt.clock(t).slice(0, span <= 600000 ? 8 : 5)));
    }
    this.series.forEach((s, i) => {
      // the line breaks where a value is missing or the samples stopped for a while (the server was restarted)
      let d = '', area = '', run = null, last = null;
      const close = () => { if (run && last && !many) area += `M${this.x(run.t).toFixed(1)},${this.y(0)}${run.d}L${this.x(last.t).toFixed(1)},${this.y(0)}Z`; run = null; };
      for (const p of pts) {
        const v = p[s.key];
        if (v === null || v === undefined || (last && p.t - last.t > this.gap)) { close(); last = null; if (v === null || v === undefined) continue; }
        const seg = `${this.x(p.t).toFixed(1)},${this.y(v).toFixed(1)}`;
        if (!run) { run = { t: p.t, d: '' }; d += `M${seg}`; } else d += `L${seg}`;
        run.d += `L${seg}`;
        last = p;
      }
      const end = last;
      close();
      if (area) g.append(svg('path', { d: area, class: `wash s${i + 1}` }));
      if (d) g.append(svg('path', { d, class: `line s${i + 1}` }));
      if (end) g.append(svg('circle', { cx: this.x(end.t), cy: this.y(end[s.key]), r: 4, class: `dot s${i + 1}` }));
    });
    this.cross = svg('g', { class: 'cross', visibility: 'hidden' }, svg('line', { y1: T, y2: H - B }), this.series.map((s, i) => svg('circle', { r: 4, class: `dot s${i + 1}` })));
    g.append(this.cross);
    fill(this.plot, g, this.tip);
    // the heading: the latest value (one series), or the key with each series' latest (two)
    const latest = pts[pts.length - 1];
    fill(this.now, this.series.map((s, i) => h('span', { class: 'now-item' },
      many ? h('i', { class: `key s${i + 1}` }) : null, many ? h('span', { class: 'now-name' }, s.name) : null,
      h('strong', null, latest && latest[s.key] !== null && latest[s.key] !== undefined ? this.format(latest[s.key]) : '-'))));
    if (this.at >= 0) this.show(Math.min(this.at, pts.length - 1));
  }

  hover(px) {
    const pts = this.points;
    if (!pts.length) return;
    let best = 0, dist = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = Math.abs(this.x(pts[i].t) - px); if (d < dist) { dist = d; best = i; } }
    this.show(best);
  }

  /** The crosshair and the readout at sample i (-1 puts them away). */
  show(i) {
    this.at = i;
    const p = this.points[i];
    if (!p) { this.cross?.setAttribute('visibility', 'hidden'); this.tip.hidden = true; return; }
    const x = this.x(p.t), [line, ...dots] = this.cross.children;
    this.cross.setAttribute('visibility', 'visible');
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    this.series.forEach((s, k) => {
      const v = p[s.key], dot = dots[k];
      if (v === null || v === undefined) { dot.setAttribute('visibility', 'hidden'); return; }
      dot.setAttribute('visibility', 'inherit'); dot.setAttribute('cx', x); dot.setAttribute('cy', this.y(v));
    });
    fill(this.tip, h('div', { class: 'tip-time' }, fmt.clock(p.t)), this.series.map((s, k) => h('div', { class: 'tip-row' },
      h('i', { class: `key s${k + 1}` }), h('strong', null, p[s.key] === null || p[s.key] === undefined ? '-' : this.format(p[s.key])), h('span', null, s.name))));
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${x + 12 + tw > this.w ? Math.max(0, x - 12 - tw) : x + 12}px`;
  }
}
