/**
 * The QUALITY OF LIFE settings of conf/client.conf: server.js serves them as /config.json, loaded before the game
 * starts. Keys and defaults match conf/client.conf.dist. (sheets, custom and assets aren't settings of the game: by
 * them server.js says whether it packs files into sheets, see Assets.json, which files the assets' customs folder
 * changes, each with its version, and which assets these are. Only the keys here are taken from /config.json.)
 */
export function clientConfigs(c) {
  const skipBirthday = c.getBoolean('Account.SkipBirthdayCode', false), code = c.getInt('Account.BirthdayCode', 20050511);
  return {
    // ----------------------------ACCOUNT------------------------------
    skipBirthday,
    // only sent to the browser when it's used
    birthdayCode: !skipBirthday ? 0 : code >= 10000101 && code <= 99991231 ? code : 20050511,
    // ----------------------------BUFFS------------------------------
    buffTimeLeft: c.getBoolean('Buffs.ShowTimeLeft', false),
    // ----------------------------COMBAT------------------------------
    noWhack: c.getBoolean('Combat.NoWhack', false),
    // ----------------------------LADDERS------------------------------
    climbSpeed: Math.min(3, Math.max(1, c.getDouble('Ladders.ClimbSpeedMultiplier', 1))),
    // ----------------------------LOGIN------------------------------
    typePic: c.getBoolean('Login.TypePic', false),
    // ----------------------------MONSTERS------------------------------
    bossHpPercent: c.getBoolean('Monsters.BossHpPercent', false),
    // ----------------------------SKILLS------------------------------
    skillCooldownTime: c.getBoolean('Skills.ShowCooldownTime', false),
    // ----------------------------SERVER------------------------------
    sheets: true,
    // what the assets' customs folder changes, each with its version (customs.mjs)
    custom: {},
    // which assets these are (server.js): the version asset files are asked for by
    assets: '',
  };
}

const DEFAULTS = { getString: (k, d) => d, getBoolean: (k, d) => d, getInt: (k, d) => d, getDouble: (k, d) => d };

export const config = clientConfigs(DEFAULTS);

/**
 * Asks the server again what the customs folder changes (and which assets these are), so a map published, changed
 * or taken out since the page loaded is fetched afresh the next time it is needed:
 * forget(path) drops a file the page already holds (forget(null): all of them). A slow answer is not waited for.
 */
export async function refreshPublished(forget, ms = 1500) {
  let got = null;
  try { got = await Promise.race([fetch('/config.json', { cache: 'no-store' }).then((r) => r.json()), new Promise((r) => setTimeout(() => r(null), ms))]); } catch { return; }
  if (!got || typeof got.custom !== 'object' || !got.custom) return;
  if (typeof got.assets === 'string' && got.assets !== config.assets) { config.assets = got.assets; forget(null); }
  const was = config.custom || {};
  for (const path of new Set([...Object.keys(was), ...Object.keys(got.custom)])) if (was[path] !== got.custom[path]) forget(path);
  config.custom = got.custom;
}

export async function loadConfig() {
  try {
    const got = await fetch('/config.json').then((r) => r.json());
    for (const k of Object.keys(config)) if (typeof got[k] === typeof config[k]) config[k] = got[k];
  } catch { /* the defaults */ }
}
