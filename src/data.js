import { pad } from './assets.js';
import { equipPath } from './character.js';

/** constants/game/ExpTable.java: EXP needed to finish level N is EXP[N]. */
export const EXP = [15, 15, 34, 57, 92, 135, 372, 560, 840, 1144, 1242, 1573, 2144, 2800, 3640, 4700, 5893, 7360, 9144, 11120, 13477, 16268, 19320, 22880, 27008, 31477, 36600, 42444, 48720, 55813, 63800, 86784, 98208, 110932, 124432, 139372, 155865, 173280, 192400, 213345, 235372, 259392, 285532, 312928, 342624, 374760, 408336, 445544, 483532, 524160, 567772, 598886, 631704, 666321, 702836, 741351, 781976, 824828, 870028, 917625, 967995, 1021041, 1076994, 1136013, 1198266, 1263930, 1333194, 1406252, 1483314, 1564600, 1650340, 1740778, 1836173, 1936794, 2042930, 2154882, 2272970, 2397528, 2528912, 2667496, 2813674, 2967863, 3130502, 3302053, 3483005, 3673873, 3875201, 4087562, 4311559, 4547832, 4797053, 5059931, 5337215, 5629694, 5938202, 6263614, 6606860, 6968915, 7350811, 7753635, 8178534, 8626718, 9099462, 9598112, 10124088, 10678888, 11264090, 11881362, 12532461, 13219239, 13943653, 14707765, 15513750, 16363902, 17260644, 18206527, 19204245, 20256637, 21366700, 22537594, 23772654, 25075395, 26449526, 27898960, 29427822, 31040466, 32741483, 34535716, 36428273, 38424542, 40530206, 42751262, 45094030, 47565183, 50171755, 52921167, 55821246, 58880250, 62106888, 65510344, 69100311, 72887008, 76881216, 81094306, 85594273, 90225770, 95170142, 100385466, 105886589, 111689174, 117809740, 124265714, 131075474, 138258410, 145834970, 153826726, 162256430, 171148082, 180526997, 190419876, 200854885, 211861732, 223471711, 223471711, 248635353, 262260570, 276632449, 291791906, 307782102, 324648562, 342439302, 361204976, 380999008, 401877754, 423900654, 447130410, 471633156, 497478653, 524740482, 553496261, 583827855, 615821622, 649568646, 685165008, 722712050, 762316670, 804091623, 848155844, 894634784, 943660770, 995373379, 1049919840, 1107455447, 1168144006, 1232158297, 1299680571, 1370903066, 1446028554, 1525246918, 1608855764, 1697021059];

export const JOBS = {
  0: 'Beginner', 100: 'Warrior', 110: 'Fighter', 111: 'Crusader', 112: 'Hero', 120: 'Page', 121: 'White Knight', 122: 'Paladin',
  130: 'Spearman', 131: 'Dragon Knight', 132: 'Dark Knight', 200: 'Magician', 210: 'Wizard (F/P)', 211: 'Mage (F/P)', 212: 'Arch Mage (F/P)',
  220: 'Wizard (I/L)', 221: 'Mage (I/L)', 222: 'Arch Mage (I/L)', 230: 'Cleric', 231: 'Priest', 232: 'Bishop',
  300: 'Bowman', 310: 'Hunter', 311: 'Ranger', 312: 'Bowmaster', 320: 'Crossbowman', 321: 'Sniper', 322: 'Marksman',
  400: 'Thief', 410: 'Assassin', 411: 'Hermit', 412: 'Night Lord', 420: 'Bandit', 421: 'Chief Bandit', 422: 'Shadower',
  500: 'Pirate', 510: 'Brawler', 511: 'Marauder', 512: 'Buccaneer', 520: 'Gunslinger', 521: 'Outlaw', 522: 'Corsair',
  900: 'GM', 910: 'Super GM', 1000: 'Noblesse', 1100: 'Dawn Warrior', 1200: 'Blaze Wizard', 1300: 'Wind Archer',
  1400: 'Night Walker', 1500: 'Thunder Breaker', 2000: 'Legend', 2001: 'Evan', 2100: 'Aran',
};
export const jobName = (id) => JOBS[id] || JOBS[Math.floor(id / 10) * 10] || JOBS[Math.floor(id / 100) * 100] || `Job ${id}`;

/**
 * Body action ids as used in attack packets, in the client's order (not Character/00002000.img's). Some names repeat:
 * 24-26 are a claw's throws, drawn with swingO1-3.
 */
export const ACTIONS = [
  'walk1', 'walk2', 'stand1', 'stand2', 'alert', 'swingO1', 'swingO2', 'swingO3', 'swingOF', 'swingT1', 'swingT2',
  'swingT3', 'swingTF', 'swingP1', 'swingP2', 'swingPF', 'stabO1', 'stabO2', 'stabOF', 'stabT1', 'stabT2', 'stabTF',
  'shoot1', 'shoot2', 'swingO1', 'swingO2', 'swingO3', 'shootF', 'swingO1', 'swingO3', 'stabO1', 'heal', 'proneStab',
  'prone', 'fly', 'jump', 'ladder', 'rope', 'dead', 'sit', 'tired', 'alert2', 'alert3', 'alert4', 'alert5', 'alert6',
  'ladder2', 'rope2', 'shoot6', 'magic1', 'magic2', 'magic3', 'magic5', 'burster1', 'burster2', 'savage', 'avenger',
  'assaulter', 'prone2', 'assassination', 'assassinationS', 'rush', 'rush2', 'brandish1', 'brandish2', 'sanctuary',
  'meteor', 'paralyze', 'blizzard', 'genesis', 'ninjastorm', 'blast', 'holyshield', 'showdown', 'resurrection',
  'chainlightning', 'smokeshell', 'handgun', 'somersault', 'straight', 'eburster', 'backspin', 'eorb', 'screw',
  'doubleupper', 'dragonstrike', 'doublefire', 'triplefire', 'fake', 'airstrike', 'edrain', 'octopus', 'backstep',
  'shot', 'recovery', 'fireburner', 'coolingeffect', 'fist', 'timeleap', 'rapidfire', 'homing', 'ghostwalk',
  'ghoststand', 'ghostjump', 'ghostproneStab', 'ghostfly', 'ghostladder', 'ghostrope', 'ghostsit', 'cannon',
  'torpedo', 'darksight', 'bamboo', 'pyramid', 'wave', 'blade', 'souldriver', 'firestrike', 'flamegear',
  'stormbreak', 'vampire', 'float', 'swingT2PoleArm', 'swingP1PoleArm', 'swingP2PoleArm', 'doubleSwing',
  'tripleSwing', 'fullSwingDouble', 'fullSwingTriple', 'overSwingDouble', 'overSwingTriple', 'rollingSpin',
  'comboSmash', 'comboFenrir', 'comboTempest', 'finalCharge', 'combatStep', 'finalBlow', 'finalToss', 'magicmissile',
  'dragonSpark', 'dragonBreathe', 'breathe_prepare', 'dragonIceBreathe', 'icebreathe_prepare', 'infinityExplosion',
  'superMagicmissile', 'illusion', 'magicFlare', 'elementalReset', 'elementalRegistance', 'dragonAura',
  'magicBooster', 'dragonShield', 'dragonFury', 'dragonFly', 'dragonSkin', 'shockwave', 'demolition', 'snatch',
  'windspear', 'windshot'
];

export const INV_NAMES = { 1: 'Equip', 2: 'Use', 3: 'Set-up', 4: 'Etc', 5: 'Cash' };
export const invType = (id) => Math.floor(id / 1000000);

/** WZ path of an item's .img and the node holding it. */
export function itemNode(id) {
  const t = invType(id);
  if (t === 1) {
    // equips the avatar never draws still have icons: pendants / belts / medals, pet equipment, mounts
    const cat = Math.floor(id / 10000);
    const dir = [112, 113, 114].includes(cat) ? 'Accessory' : cat === 180 || cat === 181 ? 'PetEquip' : cat >= 190 && cat < 200 ? 'TamingMob' : cat === 170 ? 'Weapon' : null;
    return { path: equipPath(id) || (dir && `Character/${dir}/${pad(id, 8)}.img`), key: null };
  }
  const dir = { 2: 'Consume', 3: 'Install', 4: 'Etc', 5: 'Cash' }[t];
  if (Math.floor(id / 10000) === 500) return { path: `Item/Pet/${pad(id, 7)}.img`, key: null };
  return dir ? { path: `Item/${dir}/${pad(Math.floor(id / 10000), 4)}.img`, key: pad(id, 8) } : null;
}

const STRING_FILES = { 1: 'Eqp', 2: 'Consume', 3: 'Ins', 4: 'Etc', 5: 'Cash' };
export async function itemName(assets, id) {
  const t = invType(id);
  if (Math.floor(id / 10000) === 500) return (await assets.json('String/Pet.img'))?.[id]?.name || `#${id}`;   // pets
  const s = await assets.json(`String/${STRING_FILES[t]}.img`);
  if (!s) return `#${id}`;
  if (t === 1) {
    for (const cat of Object.values(s.Eqp || {})) if (cat?.[id]) return cat[id].name;
    return `#${id}`;
  }
  if (t === 4) return s.Etc?.[id]?.name || `#${id}`;
  return s[id]?.name || `#${id}`;
}

/** An item's info node (price, slotMax, unitPrice, reqLevel, ...). */
export async function itemInfo(assets, id) {
  const n = itemNode(id);
  if (!n?.path) return null;
  const img = await assets.json(n.path);
  return (n.key ? img?.[n.key] : img)?.info || null;
}

/** A consumable's spec node (hp, mp, hpR...). */
export async function itemSpec(assets, id) {
  const n = itemNode(id);
  if (!n?.path) return null;
  const img = await assets.json(n.path);
  return (n.key ? img?.[n.key] : img)?.spec || null;
}

/** The icon canvas node for an item id (info/icon). */
export async function itemIcon(assets, id, raw = false) {
  const n = itemNode(id);
  if (!n?.path) return null;
  const img = await assets.json(n.path);
  const node = n.key ? img?.[n.key] : img;
  return node?.info?.[raw ? 'iconRaw' : 'icon'] || node?.info?.icon || null;
}

/** Meso drop icon frames by amount (Item/Special/0900.img). */
export async function mesoIcon(assets, amount) {
  const s = await assets.json('Item/Special/0900.img');
  const id = amount < 50 ? '09000000' : amount < 100 ? '09000001' : amount < 1000 ? '09000002' : '09000003';
  return s?.[id]?.iconRaw || null;
}

/** [swing, stab] damage multipliers where they differ. */
const POSE_MULT = { 31: [4.4, 3.2], 32: [4.4, 3.2], 41: [4.8, 3.4], 42: [4.8, 3.4], 43: [3.0, 5.0], 44: [5.0, 3.0] };

/** ItemInformationProvider.getWeaponType -> max damage multiplier (client/inventory/WeaponType). */
export function weaponMultiplier(weaponId, pose = null) {
  if (!weaponId) return 0;
  const cat = Math.floor(weaponId / 10000) % 100;
  const both = POSE_MULT[cat];
  if (both && /^swing/.test(pose)) return both[0];
  if (both && /^stab/.test(pose)) return both[1];
  const t = [4.0, 4.4, 4.4, 4.0, 0, 0, 0, 3.6, 3.6, 0, 4.6, 4.8, 4.8, 5.0, 5.0, 3.4, 3.6, 3.6, 4.8, 3.6];
  return cat >= 30 && cat <= 49 ? t[cat - 30] || 0 : 0;
}

/** Equipment scrolls (204xxxx, incl. Clean Slate / Chaos 2049xxx): used by dropping them on an equip. */
export const isScroll = (id) => Math.floor(id / 10000) === 204;
/**
 * Whether a scroll fits an equip, as Cosmic's ScrollHandler decides: 2049xxx (Clean Slate, Chaos) fit any,
 * 20492xx (accessory) fits rings / pendants / belts, others match their 3rd-4th digits to the equip's category.
 */
export function scrollFits(scrollId, equipId) {
  const sid = Math.floor(scrollId / 100);
  if (Math.floor(scrollId / 1000) === 2049 && sid !== 20492) return true;
  if (sid === 20492) return [11, 12, 13].includes(Math.floor(equipId / 10000) % 100);
  return sid % 100 === Math.floor(equipId / 10000) % 100;
}
