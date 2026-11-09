/**
 * The QUALITY OF LIFE settings of conf/client.conf: server.js serves them as /config.json, loaded before the game
 * starts. Keys and defaults match conf/client.conf.dist.
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
  };
}

const DEFAULTS = { getString: (k, d) => d, getBoolean: (k, d) => d, getInt: (k, d) => d, getDouble: (k, d) => d };

export const config = clientConfigs(DEFAULTS);

export async function loadConfig() {
  try {
    const got = await fetch('/config.json').then((r) => r.json());
    for (const k of Object.keys(config)) if (typeof got[k] === typeof config[k]) config[k] = got[k];
  } catch { /* the defaults */ }
}
