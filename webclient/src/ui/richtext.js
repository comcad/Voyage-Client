import { uiText } from './wzui.js';

/**
 * NPC / quest script markup laid out for the canvas:
 *   #b #r #g #d #k colours, #e bold, #n normal, #h player name, #t/#z item, #o mob, #p NPC,
 *   #m map, #c item count, #i/#v item icon (inline, 32px), #L<n># ... #l a clickable option,
 *   #f<path># a UI image (UtilDlgEx/list0 "QUEST IN PROGRESS" and the like).
 * bullet: indent options this far, leaving room for the dot drawn before each one.
 * ref supplies names and icons: { player, item(id), mob(id), npc(id), map(id), count(id), icon(id) }.
 * Returns { lines, height }; each line is { y, h, runs, opt } with runs of
 * { t, x, color, bold } or { icon, x }.
 */
const COLORS = { b: '#0047b3', r: '#d00000', g: '#2a8a00', d: '#7a2ad0', k: '#000' };
const LINE_H = 15, ICON_H = 34;

/** Lighter versions for white text on the blue Notice / yes-no boxes, where the dark ones disappear. */
export const LIGHT_COLORS = { b: '#9fd6ff', r: '#ff9a9a', g: '#a6f08a', d: '#e2b6ff' };

export function richText(ctx, text, width, ref, { base = '#000', size = 11, colors = null, lineH = LINE_H, bullet = 0 } = {}) {
  const palette = { ...COLORS, ...colors };
  const tokens = String(text).replace(/\\r\\n|\\n/g, '\n').replace(/\\r/g, '').replace(/\r\n|\r/g, '\n')
    .split(/(#f[^#\n]+#|#[a-zA-Z](?:\d+#)?|\n)/);
  const lines = [];
  let line = null, color = base, bold = false, opt = null, x = 0;
  const newLine = () => { line = { runs: [], opt, h: lineH, x0: opt !== null ? bullet : 0 }; lines.push(line); x = line.x0; };
  newLine();
  const font = () => `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
  const put = (str) => {
    for (const word of String(str).split(/(\s+)/)) {
      if (!word) continue;
      ctx.font = font();
      const w = ctx.measureText(word).width;
      if (x + w > width && x > line.x0 && word.trim()) newLine();
      if (x === line.x0 && !word.trim()) continue;
      line.runs.push({ t: word, x, color, bold });
      if (opt !== null) line.opt = opt;
      x += w;
    }
  };
  const icon = (node) => {
    if (x + 34 > width && x > line.x0) newLine();
    line.runs.push({ icon: node, x });
    line.h = ICON_H;
    if (opt !== null) line.opt = opt;
    x += 34;
  };
  const image = (node) => {
    if (!node) return;
    if (x > line.x0) newLine();
    line.runs.push({ img: node, x });
    line.h = Math.max(line.h, (node._h || 0) + (bullet ? 18 : 8));   // section titles get room above and below
    x += (node._w || 0) + 4;
  };
  for (const tk of tokens) {
    if (!tk) continue;
    if (tk === '\n') { newLine(); continue; }
    if (tk.length > 3 && tk.startsWith('#f') && tk.endsWith('#')) { image(ref.image?.(tk.slice(2, -1))); continue; }
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
    else if (code === 'L') { opt = id; if (x > line.x0) newLine(); line.opt = id; line.x0 = bullet; x = Math.max(x, bullet); }
    else if (code === 'l') { opt = null; }
  }
  // drop trailing empty lines, then stack the lines
  while (lines.length > 1 && !lines[lines.length - 1].runs.length) lines.pop();
  let y = 0;
  for (const l of lines) { l.y = y; y += l.h; }
  return { lines, height: y, lineH };
}

/**
 * Draws laid-out text at (x, y); icons go through drawIcon(node, x, y), UI images through drawImage,
 * option dots through drawBullet(x, y, hovered). hover = option under the mouse.
 */
export function drawRich(ctx, layout, x, y, { drawIcon, drawImage, drawBullet, optColor = null, hover = null, size = 11 } = {}) {
  for (const l of layout.lines) {
    // taller custom lines (the NPC dialog's 18px) centre their text; the default 15px keeps its old placement
    const lh = layout.lineH || LINE_H, ly = y + l.y + (l.h > lh ? (l.h - lh) / 2 : lh === LINE_H ? 0 : (lh - size) / 2 - 1);
    const isOpt = l.opt !== null && l.opt !== undefined, on = isOpt && l.opt === hover;
    if (isOpt && l.x0 && drawBullet) {
      // the client's option: a gray dot (red under the mouse), and a dashed rule under the hovered one
      drawBullet(x + l.x0 - 14, ly + Math.round((size - 7) / 2) + 2, on);
      if (on) {
        ctx.font = `${size}px Arial, sans-serif`;
        const end = Math.max(...l.runs.map((r) => r.x + (r.t ? ctx.measureText(r.t).width : 34)));
        ctx.fillStyle = '#a0a0a0';
        for (let dx = x + l.x0 - 4; dx < x + end + 4; dx += 4) ctx.fillRect(dx, ly + size + 4, 2, 1);
      }
    } else if (on) {
      ctx.fillStyle = 'rgba(79,127,196,0.25)';
      ctx.fillRect(x - 2, y + l.y, Math.max(...l.runs.map((r) => r.x + (r.icon ? 34 : r.img ? r.img._w : ctx.measureText(r.t).width)), 20) + 4, l.h);
    }
    for (const r of l.runs) {
      if (r.img) drawImage?.(r.img, x + r.x, y + l.y + Math.round((l.h - (r.img._h || 0)) / 2));
      else if (r.icon) drawIcon?.(r.icon, x + r.x, y + l.y + 1);
      else uiText(ctx, r.t, x + r.x, ly + 1, { color: isOpt && l.x0 && optColor ? optColor : r.color, bold: r.bold, size });
    }
  }
}

/** The option id at local point (px, py) of a layout drawn at (0, 0), or null. */
export function optionAt(layout, px, py) {
  for (const l of layout.lines) if (l.opt !== null && l.opt !== undefined && py >= l.y && py < l.y + l.h && px >= -2) return l.opt;
  return null;
}
