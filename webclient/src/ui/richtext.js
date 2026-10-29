import { uiText } from './wzui.js';

/**
 * NPC / quest script markup laid out for the canvas:
 *   #b #r #g #d #k colours, #e bold, #n normal, #h player name, #t/#z item, #o mob, #p NPC,
 *   #m map, #c item count, #i/#v item icon (inline, 32px), #L<n># ... #l a clickable option.
 * ref supplies names and icons: { player, item(id), mob(id), npc(id), map(id), count(id), icon(id) }.
 * Returns { lines, height }; each line is { y, h, runs, opt } with runs of
 * { t, x, color, bold } or { icon, x }.
 */
const COLORS = { b: '#0047b3', r: '#d00000', g: '#2a8a00', d: '#7a2ad0', k: '#000' };
const LINE_H = 15, ICON_H = 34;

/** Lighter versions for white text on the blue Notice / yes-no boxes, where the dark ones disappear. */
export const LIGHT_COLORS = { b: '#9fd6ff', r: '#ff9a9a', g: '#a6f08a', d: '#e2b6ff' };

export function richText(ctx, text, width, ref, { base = '#000', size = 11, colors = null } = {}) {
  const palette = { ...COLORS, ...colors };
  const tokens = String(text).replace(/\\r\\n|\\n/g, '\n').replace(/\\r/g, '').replace(/\r\n|\r/g, '\n')
    .split(/(#[a-zA-Z](?:\d+#)?|\n)/);
  const lines = [];
  let line = null, color = base, bold = false, opt = null, x = 0;
  const newLine = () => { line = { runs: [], opt, h: LINE_H }; lines.push(line); x = 0; };
  newLine();
  const font = () => `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
  const put = (str) => {
    for (const word of String(str).split(/(\s+)/)) {
      if (!word) continue;
      ctx.font = font();
      const w = ctx.measureText(word).width;
      if (x + w > width && x > 0 && word.trim()) newLine();
      if (x === 0 && !word.trim()) continue;
      line.runs.push({ t: word, x, color, bold });
      if (opt !== null) line.opt = opt;
      x += w;
    }
  };
  const icon = (node) => {
    if (x + 34 > width && x > 0) newLine();
    line.runs.push({ icon: node, x });
    line.h = ICON_H;
    if (opt !== null) line.opt = opt;
    x += 34;
  };
  for (const tk of tokens) {
    if (!tk) continue;
    if (tk === '\n') { newLine(); continue; }
    const m = tk.match(/^#([a-zA-Z])(\d+)?#?$/);
    if (!m) { put(tk); continue; }
    const [, code, num] = m, id = Number(num);
    if (palette[code]) color = code === 'k' ? base : palette[code];
    else if (code === 'e') bold = true;
    else if (code === 'n') { bold = false; color = base; }
    else if (code === 'h') put(ref.player);
    else if (code === 't' || code === 'z') put(ref.item(id));
    else if (code === 'o') put(ref.mob(id));
    else if (code === 'p') put(ref.npc(id));
    else if (code === 'm') put(String(ref.map(id)));
    else if (code === 'c') put(String(ref.count(id)));
    else if (code === 'i' || code === 'v') icon(ref.icon(id));
    else if (code === 'L') { opt = id; if (x > 0) newLine(); line.opt = id; }
    else if (code === 'l') { opt = null; }
  }
  // drop trailing empty lines, then stack the lines
  while (lines.length > 1 && !lines[lines.length - 1].runs.length) lines.pop();
  let y = 0;
  for (const l of lines) { l.y = y; y += l.h; }
  return { lines, height: y };
}

/** Draws laid-out text at (x, y); icons go through drawIcon(node, x, y). hover = option under the mouse. */
export function drawRich(ctx, layout, x, y, { drawIcon, hover = null, size = 11 } = {}) {
  for (const l of layout.lines) {
    const ly = y + l.y + (l.h > LINE_H ? (l.h - LINE_H) / 2 : 0);
    if (l.opt !== null && l.opt !== undefined && l.opt === hover) {
      ctx.fillStyle = 'rgba(79,127,196,0.25)';
      ctx.fillRect(x - 2, y + l.y, Math.max(...l.runs.map((r) => r.x + (r.icon ? 34 : ctx.measureText(r.t).width)), 20) + 4, l.h);
    }
    for (const r of l.runs) {
      if (r.icon) drawIcon?.(r.icon, x + r.x, y + l.y + 1);
      else uiText(ctx, r.t, x + r.x, ly + 1, { color: r.color, bold: r.bold, size });
    }
  }
}

/** The option id at local point (px, py) of a layout drawn at (0, 0), or null. */
export function optionAt(layout, px, py) {
  for (const l of layout.lines) if (l.opt !== null && l.opt !== undefined && py >= l.y && py < l.y + l.h && px >= -2) return l.opt;
  return null;
}
