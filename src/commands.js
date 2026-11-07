/**
 * Key commands: skills that come out of a run of key presses and releases instead of a hotkey. The Aran's
 * attack chain (Double Swing, Triple Swing and its finishers), Combo Smash / Fenrir / Tempest, Combo Drain /
 * Barrier, Rolling Spin and Combat Step, the Pirate / Thunder Breaker Dash, and the Pyramid's Rage of Pharaoh.
 *
 * Every key press and release (by scancode) goes through `key()`. A command's steps are matched in order: each
 * names a key, press or release, and how long the run may take from its first key. A step can let some
 * events go by without breaking the run. The last step does the command: most put the skill in a queue that
 * runs once the pose you are in is over (`run()`), so a chained swing follows the one before it.
 */
import { ACTIONS } from './data.js';

const LEFT = 0x4b, RIGHT = 0x4d, UP = 0x48, DOWN = 0x50;
/** Stands for the scancode bound to Attack. */
const ATK = 'atk';

/** Skills. */
const DASHES = [5001005, 15001003, 1014, 10001015];
const DOUBLE_SWING = 21000002, TRIPLE_SWING = 21100001, FINAL_CHARGE = 21100002, COMBAT_STEP = 21001001;
const FINAL_BLOW = 21120005, FINAL_TOSS = 21110003, ROLLING_SPIN = 21110006;
const COMBO_SMASH = 21100004, COMBO_FENRIR = 21110004, COMBO_TEMPEST = 21120006;
const COMBO_DRAIN = 21100005, COMBO_BARRIER = 21120007;
/** The Legend's (job 2000) tutorial versions of Double Swing, Triple Swing and Final Blow. */
const TUTORIAL = [20000014, 20000015, 20000016];
/** The combo a combo skill needs. */
const COMBO_NEED = { [COMBO_SMASH]: 30, [COMBO_DRAIN]: 30, [COMBO_FENRIR]: 100, [COMBO_TEMPEST]: 200, [COMBO_BARRIER]: 200 };

/**
 * How long a queued command waits for the pose before it to end: the chain's finishers (Final Charge, Final Blow,
 * Final Toss) longer, as they can wait behind a queued Triple Swing.
 */
const QUEUE_WAIT = 1000, FINISHER_WAIT = 1500;

const act = (name) => ACTIONS.indexOf(name);
const SWINGS = new Set(['swingT2PoleArm', 'swingP1PoleArm', 'swingP2PoleArm'].map(act));
const DOUBLES = new Set(['doubleSwing', 'fullSwingDouble', 'overSwingDouble'].map(act));
const TRIPLES = new Set(['tripleSwing', 'fullSwingTriple', 'overSwingTriple'].map(act));

/**
 * A step: `key` pressed (down) or let go, and the time it adds to the run's limit. A plain step lets other keys'
 * releases go by; a loose one (a press followed by another press) lets any release go by. `does` is what the
 * last step does.
 */
const step = (key, down, ms, loose = false, does = null, arg) => ({ key, down, ms, loose, does, arg });
const plain = (key, down, ms) => step(key, down, ms);
const press = (key, ms) => step(key, 1, ms, true);

/** The commands, by number; `chain` starts another the moment this one's last step comes up. */
const COMMANDS = [
  /* 0, 1 */ ...[LEFT, RIGHT].map((k) => ({ steps: [plain(k, 1, 300), plain(k, 0, 0), step(k, 1, 0, false, 'dash'), plain(k, 0, 0)] })),
  /* 2 */ { steps: [plain(ATK, 1, 480), plain(ATK, 0, 0), step(ATK, 1, 420, false, 'double'), plain(ATK, 0, 0)] },
  /* 3 */ { steps: [step(ATK, 1, 660, false, 'triple'), plain(ATK, 0, 0)] },
  /* 4, 5 */ ...[LEFT, RIGHT].map((k) => ({ steps: [press(k, 600), step(ATK, 1, 0, false, 'finalCharge', k === LEFT)] })),
  /* 6 */ { steps: [press(DOWN, 300), step(ATK, 1, 0, false, 'finalBlow')] },
  /* 7 */ { steps: [press(UP, 300), step(ATK, 1, 0, false, 'finalToss')] },
  /* 8 */ { steps: [plain(UP, 1, 700), plain(UP, 0, 0), press(UP, 0), step(ATK, 1, 0, true, 'rollingSpin')] },
  /* 9, 10 */ ...[LEFT, RIGHT].map((k) => ({ steps: [press(DOWN, 600), press(k, 0), step(ATK, 1, 0, true, 'smash', k === LEFT)] })),
  /* 11 */ { steps: [plain(DOWN, 1, 600), plain(DOWN, 0, 0), press(DOWN, 0), step(ATK, 1, 0, true, 'drain')] },
  /* 12, 13 */ ...[LEFT, RIGHT].map((k) => ({ steps: [plain(k, 1, 300), plain(k, 0, 0), step(k, 1, 0, false, 'combatStep'), plain(k, 0, 0)] })),
  /* 14 */ { steps: [press(DOWN, 300), press(UP, 0), step(ATK, 1, 0, true, 'pharaoh')] },
];

export class KeyCommands {
  constructor(game) {
    this.game = game;
    /** Runs under way: {cmd, at (index of the last step matched, -1 before the first), t0, limit}. */
    this.runs = [];
    /** Queued skills: {skill, t0, wait, chainId, does, arg}. */
    this.queue = [];
    this.last = null;
  }

  learned(id) { return (this.game.skills?.level(id) || 0) > 0; }
  job() { return this.game.stats?.job || 0; }
  aran() { const j = this.job(); return Math.floor(j / 100) === 21 || j === 2000; }
  /** The Legend's tutorial skill or the Aran's. */
  pick(aranId, i) { return this.job() === 2000 ? TUTORIAL[i] : aranId; }
  /** The Dash for your job: Space Dash on a skill vehicle. */
  dashSkill() {
    const g = this.game, cygnus = Math.floor(this.job() / 1000) === 1;
    if (g.riding) return cygnus ? 10001015 : 1014;
    return cygnus ? 15001003 : 5001005;
  }
  dashing() { const now = Date.now(); return (this.game.buffs || []).some((b) => DASHES.includes(b.source) && b.until > now); }
  /** The scancode bound to Attack (the highest, when more than one is). */
  attackKey() {
    const km = this.game.keymap || {};
    let sc = -1;
    for (let i = 0; i < 0x59; i++) { const k = km[i === 0x36 ? 0x2a : i]; if (k && k.type === 5 && k.action === 52) sc = i; }
    return sc;
  }
  /** The commands open to you now. */
  open() {
    const g = this.game, out = [];
    if (DASHES.some((id) => this.learned(id))) out.push(0, 1);
    if (this.aran() && Math.floor(g.weaponId() / 10000) % 100 === 44) {
      if (this.learned(DOUBLE_SWING) || this.learned(TUTORIAL[0])) out.push(2);
      if (this.learned(FINAL_CHARGE)) out.push(4, 5);
      if (this.learned(FINAL_BLOW) || this.learned(TUTORIAL[2])) out.push(6);
      if (this.learned(FINAL_TOSS)) out.push(7);
      if (this.learned(ROLLING_SPIN)) out.push(8);
      if (this.learned(COMBO_SMASH)) out.push(9, 10);
      if (this.learned(COMBO_DRAIN)) out.push(11);
    }
    if (this.aran() && this.learned(COMBAT_STEP)) out.push(12, 13);
    out.push(14);
    return out;
  }
  /** Triple Swing follows Double Swing once you have it. */
  chainOf(cmd) { return cmd === 2 && (this.learned(TRIPLE_SWING) || this.learned(TUTORIAL[1])) ? [3] : []; }

  matches(s, sc, down) { return (s.key === ATK ? this.atk : s.key) === sc && s.down === down; }
  /** An event the step lets go by without breaking the run. */
  lets(s, sc, down) { return !down && (s.loose || (s.key === ATK ? this.atk : s.key) !== sc); }

  /** A key pressed (down 1) or let go (0). True when a command took the press for itself. */
  key(sc, down) {
    const g = this.game;
    if (g.dead || !g.player) { this.runs = []; return false; }
    if (this.last && this.last.sc === sc && this.last.down === down) return false;
    this.last = { sc, down };
    this.atk = this.attackKey();
    const now = performance.now(), keep = [], held = [], chained = [];
    let took = false;
    for (const r of this.runs) {
      const steps = COMMANDS[r.cmd].steps;
      if (r.at >= 0 && this.lets(steps[r.at], sc, down)) { held.push(r.cmd); keep.push(r); continue; }
      if (r.limit && now > r.t0 + r.limit) continue;
      const i = r.at + 1;
      if (i >= steps.length) continue;
      const s = steps[i];
      let done = false;
      if (i === steps.length - 1 && !chained.length) {
        for (const c of this.chainOf(r.cmd)) chained.push({ cmd: c, at: -1, t0: r.t0, limit: s.ms + r.limit });
        done = chained.length > 0;
      }
      r.at = i;
      r.limit = s.ms < 0 ? 0 : r.limit + s.ms;
      if (!this.matches(s, sc, down)) continue;
      if (s.does && this[s.does](false, s.arg, s.key)) took = true;
      if (!done) keep.push(r);
    }
    if (chained.length) this.runs = chained;
    else {
      this.runs = keep;
      if (!this.dashing()) {
        for (const c of this.open()) {
          if (held.includes(c)) continue;
          const s = COMMANDS[c].steps[0];
          if (this.matches(s, sc, down)) this.runs.push({ cmd: c, at: 0, t0: now, limit: s.ms });
        }
      }
    }
    // letting go of Left or Right ends a Dash
    if (!down && (sc === LEFT || sc === RIGHT) && this.dashing()) g.net?.cancelBuff(this.dashSkill());
    return took;
  }

  /**
   * Queues a command's skill. `force`: straight in (the pose before it is the one it follows, with nothing queued);
   * otherwise only after what it follows (`after`: the skill it must come behind, or -1 for an empty queue; any).
   */
  enqueue(item, force, after) {
    if (!force && after !== undefined) {
      const prev = this.queue.length ? this.queue[this.queue.length - 1].chainId : -1;
      if (prev !== after) return;
    }
    this.queue.push({ t0: performance.now(), wait: QUEUE_WAIT, chainId: 0, ...item });
  }
  /** The pose you are in now, as an action number (-1: none). */
  pose() { const a = this.game.player?.attack; return a ? ACTIONS.indexOf(a) : -1; }

  /** Once the pose you are in is over: the next queued skill that is still in time. True when one went off. */
  run() {
    const g = this.game;
    if (!this.queue.length) return false;
    if (g.dead) { this.queue = []; return false; }
    if (g.player?.attack) return false;
    while (this.queue.length) {
      const q = this.queue[0];
      if (performance.now() < q.t0 + q.wait) {
        const ok = this[q.does](true, q.arg, q.key, q);
        if (ok) this.queue.shift();
        return ok;
      }
      this.queue.shift();
    }
    return false;
  }

  /** Cast now, as from its key, facing `left` when given. */
  cast(id, left) {
    const g = this.game;
    if (left !== undefined && g.player) g.player.facingRight = !left;
    g.skillKeyPressed = true;
    const ok = g.useSkill(id);
    g.skillKeyPressed = false;
    return ok;
  }
  /** The skill of a chain step after a polearm swing (`poses`), queued behind `after` otherwise. */
  chainStep(id, poses, after, item) {
    const force = poses.has(this.pose());
    if (force && this.queue.length) return false;
    this.enqueue(item, force, force ? undefined : after);
    return true;
  }

  dash(now) { const id = this.dashSkill(); if (this.learned(id)) this.cast(id); return true; }
  double(now) {
    const id = this.pick(DOUBLE_SWING, 0);
    if (!this.learned(id)) return false;
    if (now) return this.cast(id);
    if (SWINGS.has(this.pose())) this.enqueue({ does: 'double', chainId: id }, false, -1);
    return false;
  }
  triple(now) {
    const id = this.pick(TRIPLE_SWING, 1);
    if (!this.learned(id)) return false;
    if (now) return this.cast(id);
    this.chainStep(id, DOUBLES, this.pick(DOUBLE_SWING, 0), { does: 'triple', chainId: id });
    return false;
  }
  finalCharge(now, left) {
    if (!this.learned(FINAL_CHARGE)) return false;
    if (now) return this.cast(FINAL_CHARGE, left);
    this.chainStep(FINAL_CHARGE, TRIPLES, TRIPLE_SWING, { does: 'finalCharge', arg: left, wait: FINISHER_WAIT });
    return false;
  }
  finalBlow(now) {
    const id = this.pick(FINAL_BLOW, 2);
    if (!this.learned(id)) return false;
    if (now) return this.cast(id);
    this.chainStep(id, TRIPLES, this.pick(TRIPLE_SWING, 1), { does: 'finalBlow', wait: FINISHER_WAIT });
    return true;
  }
  finalToss(now) {
    if (!this.learned(FINAL_TOSS)) return false;
    if (now) return this.cast(FINAL_TOSS);
    this.chainStep(FINAL_TOSS, TRIPLES, TRIPLE_SWING, { does: 'finalToss', wait: FINISHER_WAIT });
    return true;
  }
  rollingSpin(now) {
    if (!this.learned(ROLLING_SPIN)) return false;
    if (now) return this.cast(ROLLING_SPIN);
    this.enqueue({ does: 'rollingSpin' }, false);
    return true;
  }
  /** The strongest of Tempest, Fenrir and Smash that you have and have the combo for. */
  comboSkill(ids) {
    const combo = this.game.aranCombo || 0;
    return ids.find((id) => combo >= COMBO_NEED[id] && this.learned(id)) || 0;
  }
  smash(now, left) {
    const id = this.comboSkill([COMBO_TEMPEST, COMBO_FENRIR, COMBO_SMASH]);
    if (!id) return false;
    if (now) return this.cast(id, left);
    this.enqueue({ does: 'smash', arg: left }, false);
    return false;
  }
  drain(now) {
    const id = this.comboSkill([COMBO_BARRIER, COMBO_DRAIN]);
    if (!id) return false;
    if (now) return this.cast(id);
    this.enqueue({ does: 'drain' }, false);
    return false;
  }
  /** Rage of Pharaoh, once the Pyramid has given you a skill point (massacre_skill). */
  pharaoh(now) {
    if (!((this.game.massacre?.skill || 0) > 0)) return false;
    if (now) return this.cast(this.game.jobSkillBase() * 10000 + 1020);
    this.enqueue({ does: 'pharaoh' }, false);
    return true;
  }
  combatStep(now, _arg, key, q) {
    if (!this.learned(COMBAT_STEP)) return false;
    if (now) { this.cast(COMBAT_STEP, q.key === LEFT); return true; }
    this.enqueue({ does: 'combatStep', key }, false);
    return true;
  }
}
