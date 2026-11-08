/**
 * Set effects (Effect/SetEff.img): wearing every part of a set shows its `effect` (and `backgrnd`) on the character,
 * looping, from its feet: the Wizet hat, suit or pants shows the GM wings. Each set's `info/<part>` lists the items
 * that count for that part; `info/multipet` lists pets, of which all three out must be. A `cash` set that is worn
 * wins at once; otherwise the first other set worn, then the first multipet one.
 */

/** The look slots an item can be worn in: part 0 is the hair; rings go on any of the four ring slots. */
function slotsFor(part, id) {
  if (part === 0) return [0];
  const cat = Math.floor(id / 10000);
  if (cat === 111) return [12, 13, 15, 16];
  if (cat >= 130 && cat <= 170) return [11];
  const map = { 100: 1, 101: 2, 102: 3, 103: 4, 104: 5, 105: 5, 106: 6, 107: 7, 108: 8, 109: 10, 110: 9, 112: 17, 113: 50, 114: 49 };
  return map[cat] ? [map[cat]] : [];
}

const ids = (n) => Object.values(n || {}).map(Number).filter((v) => v > 0);

/** The sets in their order in the file, each { index, cash, multipet, parts: [[part, ids]], pets: ids }. */
export function readSets(img) {
  return Object.keys(img || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k, index) => {
    const s = img[k], info = s.info || {};
    const type = Number(s.cash) ? 1 : s.multipet !== undefined ? 2 : 0;
    const parts = Object.entries(info).filter(([p]) => p !== 'multipet').map(([p, n]) => [Number(p), ids(n)]).filter(([, l]) => l.length);
    return { index, type, parts, pets: ids(info.multipet) };
  });
}

/**
 * The set index worn, or -1. `equips`: what shows in each look slot (slot 0 the hair), `cashWeapon` the cash weapon
 * drawn over the weapon, `pets` the three pets' item ids.
 */
export function wornSet(sets, equips, cashWeapon, pets) {
  let other = -1, multi = -1;
  for (const s of sets) {
    const worn = s.parts.every(([part, list]) => slotsFor(part, list[0]).some((slot) => {
      const id = slot === 11 && cashWeapon ? cashWeapon : equips[slot];
      return list.includes(id);
    }));
    if (!worn) continue;
    if (s.pets.length && ![0, 1, 2].every((i) => s.pets.includes(pets?.[i]))) continue;
    if (s.type === 1) return s.index;
    if (s.type === 2) { if (multi < 0) multi = s.index; } else if (other < 0) other = s.index;
  }
  return other >= 0 ? other : multi;
}
