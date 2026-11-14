/**
 * The assets' customs folder (assets/customs), laid out like the assets: a file there is served in place of the
 * assets' own of the same name, and a file only it has is served as well. Voyage-Editor publishes there, and
 * Voyage-Server reads the same files, so players and the game server see the same game.
 *
 * The page asks for a changed file by its version (/config.json lists them), so a copy a browser kept of the one
 * before isn't used: the list is read again when it is asked for, at most every couple of seconds, which makes a
 * file published while the server runs reach players the next time they change maps.
 */
import fs from 'fs';
import path from 'path';

export class Customs {
  constructor(assetsDir) {
    this.dir = path.join(assetsDir, 'customs');
    this.read = 0;
    this.list = { versions: {}, imgs: new Set() };
  }

  /**
   * What the customs folder holds now: `versions`, a version for each .img it changes (its JSON or any of its
   * pictures: "Npc/9010000.img") and for each other file it has ("Npc/_custom/npcs/x.png"); `imgs`, the .imgs it
   * changes, which are served as they are rather than from the sheets.
   */
  now() {
    if (Date.now() - this.read < 2000) return this.list;
    const versions = {}, imgs = new Set();
    const walk = (dir, rel) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { walk(path.join(dir, e.name), r); continue; }
        let mtime = 0;
        try { mtime = fs.statSync(path.join(dir, e.name)).mtimeMs; } catch { continue; }
        // the .img a file belongs to: its JSON, or a picture in its folder
        const m = /^(.*?\.img)(?:\.json$|\/)/.exec(r);
        const key = m ? m[1] : r;
        if (m) imgs.add(key);
        versions[key] = Math.max(versions[key] || 0, Math.floor(mtime));
      }
    };
    walk(this.dir, '');
    for (const k of Object.keys(versions)) versions[k] = versions[k].toString(36);
    this.list = { versions, imgs };
    this.read = Date.now();
    return this.list;
  }

  /** Whether the customs folder changes this .img ("Npc/9010000.img"): then the sheets leave it to the files. */
  has(img) { return this.now().imgs.has(img); }
}

/**
 * Which assets these are: a short id from when each of the assets' top folders last changed. Extracting the assets
 * again gives a new one, and the page asks for files by it, so copies a browser kept of the old ones aren't used.
 */
export function assetsId(assetsDir) {
  let text = '';
  try {
    for (const e of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'customs') text += `${e.name}:${Math.floor(fs.statSync(path.join(assetsDir, e.name)).mtimeMs)};`;
    }
  } catch { return ''; }
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return text ? (h >>> 0).toString(36) : '';
}
