import path from 'path';
import { fileURLToPath } from 'url';
import { ConfigMgr } from './configmgr.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SERVERS = 'gameserver=127.0.0.1';

/** server.js's settings from conf/client.conf. Keys and defaults match conf/client.conf.dist. */
export const ServerConfigs = {
  // ----------------------------SERVER------------------------------
  get HOST() { return ConfigMgr.getString('Server.Host', '0.0.0.0'); },
  get PORT() {
    const port = ConfigMgr.getInt('Server.Port', 3000);
    if (port >= 1 && port <= 65535) return port;
    console.warn(`Config key Server.Port = ${port} isn't a port (1-65535); defaulting to 3000`);
    return 3000;
  },
  /** The assets folder the Voyage extractor made, shared with Voyage-Server and Voyage-Editor. */
  get ASSETS_DIR() { return path.resolve(ROOT, ConfigMgr.getString('Server.AssetsDir', '../voyage-assets')); },
  /** Where the server keeps what it makes from the assets (the sheets). */
  get CACHE_DIR() { return path.resolve(ROOT, ConfigMgr.getString('Server.CacheDir', 'cache')); },
  /** Server.Sheets (a client.conf that still has only the name it had first, Server.CharacterSheets, goes by that). */
  get SHEETS() {
    const old = !ConfigMgr.values.has('Server.Sheets') && ConfigMgr.values.has('Server.CharacterSheets');
    return ConfigMgr.getBoolean(old ? 'Server.CharacterSheets' : 'Server.Sheets', true);
  },


  // ----------------------------RELAY------------------------------
  /** name -> host, the first the default; a bare host is named after itself. */
  get SERVERS() {
    const list = [];
    for (const entry of ConfigMgr.getString('Relay.Servers', SERVERS).split(',').map((s) => s.trim()).filter(Boolean)) {
      const [name, host] = entry.includes('=') ? entry.split('=').map((s) => s.trim()) : [entry, entry];
      if (name && host) list.push([name, host]);
      else console.warn(`Relay.Servers: "${entry}" needs a name and a host, so it is skipped`);
    }
    if (list.length) return Object.fromEntries(list);
    console.warn(`Relay.Servers has no servers; defaulting to "${SERVERS}"`);
    return Object.fromEntries([SERVERS.split('=')]);
  },

  // ----------------------------BUILD------------------------------
  get OBFUSCATE() { return ConfigMgr.getBoolean('Build.Obfuscate', false); },
};
