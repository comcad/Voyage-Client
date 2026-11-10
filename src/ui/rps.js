import { Win, allCanvases } from './windows.js';
import { Anim } from '../map.js';
import { drawParts } from '../character.js';
import { uiText } from './wzui.js';
import { sfx } from '../audio.js';
import { UI_W, UI_H } from '../view.js';

/**
 * Rock-Paper-Scissors (UI/UIWindow.img/RpsGame, 310x358, centred), opened by RPS_GAME 8 after the NPC's notice.
 * - Your hand (Frock / Fpaper / Fscissor) at (38, 20) and the NPC's (rock / paper / scissor) at (190, 20); you
 *   stand at (52, 261) facing right, the NPC's stand loops at (256, 261).
 * - One button place at (108, 202) holds START (3000), CONTINUE (3001) or RETRY (3002).
 * - The status line: 12px Arial in black, centred in 270px at (20, 294). A longer line scrolls left a pixel a tick
 *   from 135 and comes round again from 270.
 * - RPS_ACTION: START 0, a hand 1 + 0/1/2, time up 2, CONTINUE 3, EXIT 4, RETRY 5.
 * - A round (RPS_GAME 9, or 12 after CONTINUE):
 *   - The NPC's hand reels every 120ms with Sound/MiniGame.img/Reel, and you have 30s to pick (Timer each second for
 *     the last 10).
 *   - Once the server names its hand (11), each step is 1.2 times slower. The reel stops on that hand once a step
 *     takes 720ms or more.
 *   - Then win / lose / draw (timeover when time ran out, 10) shows after 1s, with Win / Loose / Draw and your face
 *     (smile / cry / troubled), and goes 2s later.
 *   - A draw starts the next round at once. Otherwise CONTINUE takes the place for a streak of 1-9, and RETRY
 *     after a loss or 10 wins.
 * - 6 (not enough mesos) and 7 (no room in Etc) say so and go back to START; 14 goes back quietly; 13 closes.
 * - Placed by the art, with no known position (the client's calls lost them): the hand buttons under START, EXIT
 *   on the blue strip, and the result picture centred over the floor.
 */
const W = 310, H = 358, HANDS = ['rock', 'paper', 'scissor'];
const SLOT = [108, 202], HAND_BTNS = [[108, 240], [141, 240], [174, 240]], EXIT_AT = [241, 336], RESULT_AT = [32, 143];
const MY_HAND = [38, 20], NPC_HAND = [190, 20], ME = [52, 261], NPC_AT = [256, 261];
const STATUS = { x: 20, y: 294, w: 270, h: 15 };
const START = 3000, CONTINUE = 3001, RETRY = 3002;
const REEL0 = 120, REEL_STOP = 720, REEL_SLOW = 1.2, ROUND_MS = 30000, REVEAL_MS = 1000, END_MS = 3000;
const FACES = { 2: 'smile', 3: 'troubled', 4: 'cry' };
export const RPS_TEXT = {
  notice: "#e#bRock, Paper, Scissors Notice#n#k\r\nThe participation fee for this Rock, Paper, Scissors game is #r1,000 mesos#k.\r\nWinning games will allow you to obtain various Winning Streak Certificates awarded for each consecutive win, but failure to complete the challenge will result in not receiving the Cerficate.\r\nThe received Certificate can be traded with the NPC's Paul, Jean, Martin, and Tony.",
  start: "Press 'Start' to start the game.",
  pick: 'Please select Rock, Paper, or Scissors in %d seconds.',
  cont: "To challenge the %d-game Winning Streak Challenge, press 'Continue'. A failed challenge will result in no reward.",
  ten: 'Congratulations on conquering the 10-game Winning Streak Challenge!',
  late: "You have lost the game due to being over the time limit. Press 'Restart' to try again, which will cost you the participation fee of 1,000 mesos.",
  first: "Here's 500 mesos as a consolation prize. Press 'Restart' to try again, which will cost you the participation fee of 1,000 mesos.",
  retry: "Press 'Restart' to try again, which will cost you the participation fee of 1,000 mesos.",
  noEtc: 'You may only participate in this game with at least one free slot available in the etc. inventory.',
  noMeso: 'You do not have enough mesos to pay for the participation fee of 1,000 mesos.',
};

export class RpsWin extends Win {
  constructor(mgr, npc) {
    const R = mgr.W.RpsGame;
    super(mgr, R.backgrnd, (UI_W - W) >> 1, Math.max(0, (UI_H - H) >> 1));
    this.buttons = []; this.closeBtn = null; this.R = R; this.npc = npc; this.dragH = 15;
    this.slots = { [START]: this.button(R.BtStart, SLOT[0], SLOT[1], () => this.slotClick(0)),
      [CONTINUE]: this.button(R.BtContinue, SLOT[0], SLOT[1], () => this.slotClick(3)),
      [RETRY]: this.button(R.BtRetry, SLOT[0], SLOT[1], () => this.slotClick(5)) };
    this.hands = ['BtRock', 'BtPaper', 'BtScissor'].map((k, i) => this.button(R[k], HAND_BTNS[i][0], HAND_BTNS[i][1], () => this.pick(i)));
    this.exit = this.button(R.BtExit, EXIT_AT[0], EXIT_AT[1], () => this.slotClick(4));
    for (const b of this.hands) b.enabled = false;
    this.setSlot(START, true);
    this.mine = 0; this.shown = 0; this.npcSel = -1; this.result = 0; this.lostFirst = false;
    this.interval = 0; this.tickAt = 0; this.deadline = 0; this.show = null; this.face = 0; this.lastSecond = null;
    this.offset = null; this.text = null; this.loadNpc();
  }
  frames() { return [...super.frames(), ...allCanvases(this.R)].filter(Boolean); }
  async loadNpc() {
    const id = String(this.npc).padStart(7, '0');
    let img = await this.g.assets.json(`Npc/${id}.img`).catch(() => null);
    const link = img?.info?.link;
    if (link) img = await this.g.assets.json(`Npc/${String(link).padStart(7, '0')}.img`).catch(() => img);
    if (!img?.stand) return;
    const anim = new Anim(img.stand, true);
    await this.g.assets.preload(anim.frames);
    this.npcAnim = anim;
  }
  /** Shows START, CONTINUE or RETRY in the one place, enabled or not. */
  setSlot(id, on) {
    this.slotId = id;
    for (const [k, b] of Object.entries(this.slots)) { b.visible = Number(k) === id; b.enabled = on; }
  }
  get slot() { return this.slots[this.slotId]; }
  send(mode, sel) { this.g.net?.rpsAction(mode, sel); }
  /** START (0), CONTINUE (3), RETRY (5) or EXIT (4): START and EXIT go out until the answer. */
  slotClick(mode) {
    this.send(mode);
    this.slot.enabled = false; this.exit.enabled = false;
  }
  pick(i) {
    this.send(1, i);
    this.deadline = 0; this.mine = i;
    for (const b of this.hands) b.enabled = false;
  }
  /** Back to START (and why, for 6 / 7). */
  reset(text) {
    this.result = 0; this.lostFirst = false; this.deadline = 0; this.interval = 0; this.show = null; this.face = 0;
    for (const b of this.hands) b.enabled = false;
    this.setSlot(START, true); this.exit.enabled = true;
    if (text) this.mgr.notice(text);
  }
  round() {
    const now = performance.now();
    this.npcSel = -1; this.interval = REEL0; this.tickAt = now; this.deadline = now + ROUND_MS; this.lastSecond = null;
    for (const b of this.hands) b.enabled = true;
  }
  /** RPS_GAME modes that reach an open window. */
  game(mode, d) {
    if (mode === 6) this.reset(RPS_TEXT.noMeso);
    else if (mode === 7) this.reset(RPS_TEXT.noEtc);
    else if (mode === 14) this.reset(null);
    else if (mode === 9 || mode === 12) this.round();
    else if (mode === 10) { this.interval = 0; this.npcSel = -1; this.result = -1; this.showResult(); }
    else if (mode === 11) { this.npcSel = d.hand; this.lostFirst = d.result < 0 && this.result === 0; this.result = d.result; }
    else if (mode === 13) this.mgr.close(this);
  }
  showResult() {
    const R = this.R, now = performance.now();
    const img = this.result < 0 ? (this.npcSel < 0 ? R.timeover : R.lose) : this.mine === this.npcSel ? R.draw : R.win;
    const kind = this.result < 0 ? 'lose' : this.mine === this.npcSel ? 'draw' : 'win';
    this.show = { img, kind, reveal: now + REVEAL_MS, end: now + END_MS, shown: false };
  }

  tick(ms = 16) {
    const now = performance.now();
    // a line wider than its place scrolls a pixel each 30ms tick
    this.acc = (this.acc || 0) + ms;
    while (this.acc >= 30) { this.acc -= 30; if (this.offset !== null && this.textW > STATUS.w) { this.offset -= 1; if (this.offset + this.textW < 0) this.offset = STATUS.w; } }
    // the NPC's reel, slowing once its hand is known, stopping on it
    if (this.interval && now - this.tickAt > this.interval) {
      this.shown = (this.shown + 1) % 3; this.tickAt = now;
      sfx.play('MiniGame/Reel', { volume: 1 });
      if (this.npcSel >= 0) {
        this.interval = Math.trunc(this.interval * REEL_SLOW);
        if (this.interval >= REEL_STOP && this.shown === this.npcSel) { this.interval = 0; this.showResult(); }
      }
    }
    // 30s to pick: time up says so; the last 10 seconds tick
    if (this.deadline) {
      const left = this.deadline - now;
      if (left <= 0) { this.deadline = 0; this.send(2); for (const b of this.hands) b.enabled = false; }
      else {
        const sec = Math.ceil(left / 1000);
        if (sec !== this.lastSecond) { this.lastSecond = sec; if (left < 10000) sfx.play('MiniGame/Timer', { volume: 1 }); }
      }
    }
    const s = this.show;
    if (s && !s.shown && now >= s.reveal) {
      s.shown = true;
      if (s.kind === 'lose') { sfx.play('MiniGame/Loose', { volume: 1 }); this.face = 4; }
      else if (s.kind === 'draw') { sfx.play('MiniGame/Draw', { volume: 1 }); this.face = 3; }
      else { sfx.play('MiniGame/Win', { volume: 1 }); this.face = 2; }
    }
    if (s && now >= s.end) {
      this.show = null; this.face = 0;
      if (s.kind === 'draw') this.round();
      else { this.setSlot(this.result >= 1 && this.result <= 9 ? CONTINUE : RETRY, true); this.exit.enabled = true; }
    }
    this.npcAnim?.update(ms);
    this.status();
  }
  /** The status line for where the game stands. */
  status() {
    const on = this.slot.enabled;
    let t = '';
    if (this.slotId === START && on) t = RPS_TEXT.start;
    else if ((this.slotId === START || this.slotId === CONTINUE) && !on) t = this.deadline ? RPS_TEXT.pick.replace('%d', Math.ceil((this.deadline - performance.now()) / 1000)) : '';
    else if (this.slotId === CONTINUE) t = RPS_TEXT.cont.replace('%d', this.result + 1);
    else if (this.slotId === RETRY) t = this.result >= 10 ? RPS_TEXT.ten : this.npcSel < 0 ? RPS_TEXT.late : this.lostFirst ? RPS_TEXT.first : RPS_TEXT.retry;
    if (t !== this.text) { this.text = t; this.offset = null; }
  }

  body(ctx) {
    const im = (n) => this.mgr.image(n), R = this.R;
    const mine = im(R[`F${HANDS[this.mine]}`]), theirs = im(R[HANDS[this.shown]]);
    if (mine) ctx.drawImage(mine, MY_HAND[0], MY_HAND[1]);
    if (theirs) ctx.drawImage(theirs, NPC_HAND[0], NPC_HAND[1]);
    // you, standing facing right with the round's face; the NPC's stand
    const look = this.g.look;
    if (look) {
      const action = look.standAction(), now = performance.now(), a = (this.av ??= { frame: 0, t: 0, at: now });
      a.t += now - a.at; a.at = now;
      while (a.t >= look.delay(action, a.frame)) { a.t -= look.delay(action, a.frame); a.frame = look.nextFrame(action, a.frame, false).frame; }
      const expr = FACES[this.face] ? { name: FACES[this.face], frame: 0 } : null;
      drawParts(ctx, this.g.assets, look.compose(action, a.frame, expr), ME[0], ME[1], true);
    }
    const n = this.npcAnim?.node, ni = n && im(n);
    if (ni) ctx.drawImage(ni, NPC_AT[0] - (n.origin?.[0] || 0), NPC_AT[1] - (n.origin?.[1] || 0));
    const s = this.show, ri = s?.shown && im(s.img);
    if (ri) ctx.drawImage(ri, RESULT_AT[0], RESULT_AT[1]);
    // the status line: centred, or scrolling when wider than its 270px
    if (this.text) {
      ctx.save(); ctx.beginPath(); ctx.rect(STATUS.x, STATUS.y, STATUS.w, STATUS.h); ctx.clip();
      ctx.font = '12px Arial, "Segoe UI", sans-serif';
      const w = this.textW = ctx.measureText(this.text).width;
      let x;
      if (w <= STATUS.w) x = Math.trunc((STATUS.w - w) / 2);
      else { if (this.offset === null) this.offset = STATUS.w / 2; x = this.offset; }
      uiText(ctx, this.text, STATUS.x + x, STATUS.y, { color: '#000' });
      ctx.restore();
    }
  }
}
