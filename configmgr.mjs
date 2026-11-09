import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'smol-toml';

/** A settings file that can't be used: the server stops with this message. */
export class ConfigException extends Error {}

const TABLE = 'voyage';
const DEFAULT_DIR = fileURLToPath(new URL('./conf', import.meta.url));
const TEMPLATE = path.join(DEFAULT_DIR, 'client.conf.dist');

/**
 * conf/client.conf (made from client.conf.dist when it's missing), then the folder's other .conf files by name.
 * A missing key or a value of the wrong type gives the default, warned once; before load() it's the default quietly.
 */
export const ConfigMgr = {
  MAIN_FILE: 'client.conf',
  DIST_FILE: 'client.conf.dist',
  values: new Map(),
  warned: new Set(),
  loaded: false,
  files: [],
  created: false,

  load(dir) {
    const main = path.join(dir, this.MAIN_FILE);
    const missing = !fs.existsSync(main);
    if (missing) {
      const dist = path.join(dir, this.DIST_FILE);
      // a folder without the template (a fresh Docker volume) gets the one shipped with the client
      const from = fs.existsSync(dist) ? dist : TEMPLATE;
      if (!fs.existsSync(from)) throw new ConfigException(`${dist} not found: can't create ${main}`);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(from, main);
      } catch (e) { throw new ConfigException(`can't create ${main}: ${e.message}`); }
    }
    const { files, values } = this.read(dir);
    Object.assign(this, { values, files, warned: new Set(), created: missing, loaded: true });
  },

  /** The values in `dir`'s conf files, without loading them. */
  read(dir) {
    const others = readable(dir, () => fs.readdirSync(dir))
      .filter((n) => n.endsWith('.conf') && n !== this.MAIN_FILE && fs.statSync(path.join(dir, n), { throwIfNoEntry: false })?.isFile())
      .sort();
    const files = [this.MAIN_FILE, ...others].map((n) => path.join(dir, n));
    const values = new Map();
    for (const file of files) {
      const text = readable(file, () => fs.readFileSync(file, 'utf8'));
      let toml;
      try {
        toml = parse(text, { integersAsBigInt: true });
      } catch (e) {
        throw new ConfigException(`TOML errors in ${file}:\n${e.message.replace(/^/gm, '  ')}`);
      }
      const stray = new Map();
      for (const [k, v] of Object.entries(toml)) if (k !== TABLE) add(stray, { [k]: v }, file);
      for (const k of stray.keys()) console.warn(`${file}: ${k} is outside the [${TABLE}] table, so it is ignored`);
      add(values, toml[TABLE], file);
    }
    return { files, values };
  },

  getString(key, def) { return this.value(key, def, (v) => (typeof v === 'string' ? v : null)); },
  getBoolean(key, def) { return this.value(key, def, (v) => (typeof v === 'boolean' ? v : null)); },
  // TOML integers come as BigInts
  getInt(key, def) { return this.value(key, def, (v) => (typeof v === 'bigint' && v >= -(2n ** 31n) && v < 2n ** 31n ? Number(v) : null)); },
  // a float, or a whole number written without the decimal point
  getDouble(key, def) { return this.value(key, def, (v) => { const n = typeof v === 'bigint' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; }); },

  value(key, def, cast) {
    const v = this.values.get(key);
    const result = v === undefined ? null : cast(v);
    if (result !== null) return result;
    if (this.loaded && !this.warned.has(key)) {
      this.warned.add(key);
      console.warn(v === undefined
        ? `Config key ${key} not found in any .conf file; defaulting to ${def}`
        : `Config key ${key} = ${v} isn't a ${typeof def}; defaulting to ${def}`);
    }
    return def;
  },
};

/** `--conf <dir>`: the settings from another folder (default conf/ next to server.js). */
export function confDir(args) {
  const i = args.indexOf('--conf');
  if (i < 0) return DEFAULT_DIR;
  if (!args[i + 1]) throw new ConfigException('usage: --conf <dir>');
  return path.resolve(args[i + 1]);
}

function readable(file, read) {
  try { return read(); } catch (e) { throw new ConfigException(`can't read ${file}: ${e.message}`); }
}

function add(values, table, file, prefix = '') {
  for (const [k, v] of Object.entries(table ?? {})) {
    const key = prefix + k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) { add(values, v, file, `${key}.`); continue; }
    if (values.has(key)) throw new ConfigException(`Config key ${key} is defined more than once (again in ${file})`);
    values.set(key, v);
  }
}
