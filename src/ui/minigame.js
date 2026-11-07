import { sfx } from '../audio.js';
import { drawParts } from '../character.js';
import { Anim } from '../map.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win } from './windows.js';
import { UI_W, UI_H } from '../view.js';

const centred = (w, h) => [Math.round((UI_W - w) / 2), Math.round((UI_H - h) / 2)];
const play = (name) => sfx.play(`MiniGame/${name}`);
// text at a client (x, y): y is the top of the line, the baseline the font's ascent below it
const say = (ctx, t, x, y, o = {}) => uiText(ctx, t, x, y + Math.round(0.905 * (o.size || 12)), { ...o, base: 'alphabetic' });
const SIZES = ['4 X 3', '5 X 4', '6 X 5'];
const COLORS = { 0: '#ffffff', 1: '#000000', 3: '#ffff20', 6: '#ff2020' };
const cut = (ctx, t, w) => {
  t = String(t ?? ''); ctx.save(); ctx.font = '12px Arial';
  if (ctx.measureText(t).width > w) { while (t && ctx.measureText(`${t}..`).width > w) t = t.slice(0, -1); t += '..'; }
  ctx.restore(); return t;
};
const width = (ctx, t, font = '12px Arial') => { ctx.save(); ctx.font = font; const w = ctx.measureText(String(t)).width; ctx.restore(); return w; };

/**
 * Making a game room from an Omok set or Match Cards (Minigame/Omok/backgrnd2 266x181 or MemoryGame/backgrnd2 266x208,
 * centred): the title (30 letters) at (25, 50), the private box at (60, 94) / (61, 121) with Lock / Unlock at (15, 94)
 * / (15, 121), the password (12) at (115, 115) / (115, 142) - live only while the box is ticked; Match Cards add the
 * size (4 X 3, 5 X 4, 6 X 5) at (160, 83). OK (156, 152) / (176, 180) is lit with a clean title and, ticked, a
 * password; Cancel (197, 152) / (218, 180).
 */
export class MinigameCreateWin extends Win {
  constructor(mgr, card, done) {
    const M = mgr.W.Minigame, bg = card ? M.MemoryGame.backgrnd2 : M.Omok.backgrnd2;
    super(mgr, bg, ...centred(266, card ? 208 : 181));
    this.M = M; this.card = card; this.done = done; this.modal = true; this.closeBtn.visible = false;
    this.checked = false; this.size = 0; this.open = false; this.titleOk = false;
    const py = card ? 142 : 115;
    this.ok = this.button(mgr.B.BtOK2, card ? 176 : 156, card ? 180 : 152, () => this.finish(true));
    this.button(mgr.B.BtCancel2, card ? 218 : 197, card ? 180 : 152, () => this.finish(false));
    this.title = new TextField(this.g.statusBar.layer, 0, 0, card ? 218 : 219, 15, { max: 30, color: '#000' });
    this.pw = new TextField(this.g.statusBar.layer, 0, 0, 130, 15, { max: 12, color: '#000' });
    this.fields = [this.title, this.pw]; this.at = [[25, 50], [115, py]];
    for (const f of this.fields) f.el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.finish(false); else if (e.key === 'Enter' && this.ok.enabled) this.finish(true); });
    this.title.el.addEventListener('input', async () => { const t = this.title.value; this.titleOk = !!t && !(await this.g.cursed(t)) && t === this.title.value; });
    this.pw.el.disabled = true;
  }
  frames() { const C = this.M.Common; return [...super.frames(), C.Lock, C.Unlock, C.text?.normal, C.text?.disabled, this.mgr.B.CheckBox?.[0], this.mgr.B.CheckBox?.[1]].filter(Boolean); }
  onOpen() { setTimeout(() => this.title.focus(), 0); }
  onClose() { for (const f of this.fields) f.remove(); if (!this.answered) { this.answered = true; this.done?.(null); } }
  finish(ok) {
    if (this.answered) return;
    this.answered = true;
    const r = ok ? { title: this.title.value, hasPw: this.checked, pw: this.pw.value, piece: this.size } : null;
    this.mgr.close(this); this.done?.(r);
  }
  key(e) { if (e.key === 'Escape') this.finish(false); }
  down(lx, ly) {
    const cy = this.card ? 121 : 94, cx = this.card ? 61 : 60;
    if (lx >= cx && lx < cx + 12 && ly >= cy && ly < cy + 12) { this.checked = !this.checked; this.pw.el.disabled = !this.checked; if (!this.checked) this.pw.value = ''; return; }
    if (this.card) {
      if (this.open) { const i = Math.floor((ly - 98) / 15); if (lx >= 160 && lx < 245 && i >= 0 && i < 3) this.size = i; this.open = false; return; }
      if (lx >= 160 && lx < 245 && ly >= 83 && ly < 98) this.open = true;
    }
  }
  body(ctx) {
    const C = this.M.Common, im = (n) => this.mgr.image(n), put = (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x, y); };
    const cy = this.card ? 121 : 94;
    put(this.checked ? C.Lock : C.Unlock, 15, cy);
    put(this.mgr.B.CheckBox?.[this.checked ? 1 : 0], this.card ? 61 : 60, cy);
    put(this.checked ? C.text?.normal : C.text?.disabled, 113, this.card ? 141 : 114);
    say(ctx, 'Password', this.card ? 61 : 60, this.card ? 144 : 117, this.checked ? { color: '#000', size: 12 } : { color: '#b2b2b2', size: 11 });
    this.ok.enabled = this.titleOk && (!this.checked || !!this.pw.value);
    if (this.card) {
      const box = (y, t, hi) => { ctx.fillStyle = hi ? '#a5a198' : '#eeeeee'; ctx.fillRect(160, y, 85, 15); ctx.strokeStyle = '#999999'; ctx.strokeRect(160.5, y + 0.5, 84, 14); say(ctx, t, 163, y + 1, { color: '#000', size: 12 }); };
      box(83, SIZES[this.size]);
      if (this.open) SIZES.forEach((t, i) => box(98 + 15 * i, t, i === this.size));
    }
  }
  draw(ctx) {
    super.draw(ctx);
    const k = this.g.canvas.clientWidth / UI_W;
    this.fields.forEach((f, i) => { f.rect.x = this.x + this.at[i][0]; f.rect.y = this.y + this.at[i][1]; f.layout({ left: 0, top: 0 }, k); });
  }
}

const CARD_TABLE = [{ n: 12, cols: 4, left: 89, top: 106 }, { n: 20, cols: 5, left: 61, top: 72 }, { n: 30, cols: 6, left: 33, top: 39 }];

/**
 * An Omok or Match Card room (Minigame/Omok|MemoryGame/backgrnd, 734x429, centred). The right side: the two players
 * (owner at (438, 141), visitor (534, 141)), their names and records (POINT / W / L / T), the title at (507, 22), the
 * chat log (409, 289, four rows) and line (511, 374); Start (owner) / Ready (visitor) at (625, 243), Give up (410,
 * 403), Tie (458, 403), Take back (Omok, 506, 403), Exit (679, 403), Ban (owner, 551, 63). Omok's 15x15 grid has
 * cells every 24px from (25, 32); the newest stone is the animated one. Match Cards lie in rows of 49x62 cards 56 x 67
 * apart. Turns last 30s (Omok) / 10s (cards); at 0 both players' clients send SKIP.
 */
export class MinigameRoomWin extends Win {
  constructor(mgr, room) {
    const M = mgr.W.Minigame, omok = room.type === 1, bg = omok ? M.Omok.backgrnd : M.MemoryGame.backgrnd;
    super(mgr, bg, ...centred(734, 429));
    this.M = M; this.C = M.Common; this.omok = omok; this.closeBtn.visible = false; this.keepOnEscape = true;
    Object.assign(this, { capacity: room.capacity, me: room.mySlot, users: room.users, records: room.records, title: room.title, piece: room.piece, tournament: room.tournament });
    this.state = 0; this.myTurn = false; this.ready = false; this.leaveAfter = false; this.gaveUp = false; this.tieAsked = false; this.tiePending = false;
    this.timer = 0; this.shown = 0; this.lines = []; this.first = 0; this.result = null; this.everTurn = false;
    // Omok
    this.stones = []; this.myColor = 0; this.myStones = 0; this.backAsked = false; this.backPending = false; this.backUsed = false;
    // Match Cards
    this.table = CARD_TABLE[this.piece] || CARD_TABLE[0]; this.cards = []; this.pairs = [0, 0]; this.firstCard = -1; this.step = 0; this.fx = [];
    const C = this.C, B = mgr.B;
    this.button(B.BtClaim, 705, 371, () => {});
    this.startBtn = this.button(C.btStart, 625, 243, () => this.start());
    this.readyBtn = this.button(C.btReady, 625, 243, () => this.toggleReady());
    this.tieBtn = this.button(C.btDraw, 458, 403, () => this.askTie());
    this.giveBtn = this.button(C.btAbsten, 410, 403, () => this.giveUp());
    this.banBtn = this.button(C.btBan, 551, 63, () => this.expel());
    this.backBtn = omok ? this.button(C.btRefund, 506, 403, () => this.askBack()) : null;
    this.exitBtn = this.button(C.btExit, 679, 403, () => this.exit());
    if (this.me === 0) { this.readyBtn.visible = false; this.startBtn.enabled = false; } else { this.startBtn.visible = false; this.banBtn.visible = false; }
    this.banBtn.visible = this.me === 0 && this.count > 1 && !this.tournament;
    if (this.tournament) { this.startBtn.visible = false; this.readyBtn.visible = false; this.exitBtn.visible = false; }
    this.chat = new TextField(this.g.statusBar.layer, 0, 0, 194, 15, { max: 70, color: '#000' });   // 210 wide, its end under the report button
    this.chat.el.style.background = '#e9eff4';
    this.chat.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.chat.value) { const t = this.chat.value; this.chat.value = ''; this.g.sendRoomChat(t); }
    });
    this.fields = [this.chat];
    this.dragH = 20; this.t = performance.now();
  }
  get count() { return this.users.filter(Boolean).length; }
  frames() {
    const C = this.C, M = this.M;
    const art = [C.barBagic, C.mark, C.info2, C.info3, C.turn, C.readyOn, C.readyOff, C.win, C.lose, C.draw, C.charWin, C.charLose];
    if (this.omok) { const st = M.Omok.stone?.[this.piece] || M.Omok.stone?.[0]; art.push(...Object.values(st?.black || {}), ...Object.values(st?.white || {})); }
    else { const G = M.MemoryGame; art.push(...Object.values(G.card || {}), ...Object.values(G.number || {}), ...Object.values(G[`effect${this.piece}`] || {})); }
    return [...super.frames(), ...art].filter((n) => n?._canvas);
  }
  onOpen() { if (this.me === 0) this.g.net?.roomOp(0x0B, (w) => w.byte(1)); }
  onClose() { this.chat.remove(); if (this.g.gameRoom === this) this.g.gameRoom = null; }
  key() {}
  /** A chat log line in a font colour (0 white, 1 black, 3 yellow, 6 red). */
  say(text, font = 0) {
    const ctx = document.createElement('canvas').getContext('2d'); ctx.font = '12px Arial';
    const wrapped = String(text).split(/\r\n|\n/).flatMap((l) => wrapText(ctx, l, 304, 12));
    const atEnd = this.first >= this.lines.length - 4;
    wrapped.forEach((l, i) => this.lines.push({ text: i ? `${font === 0 ? '    ' : '  '}${l}` : l, color: COLORS[font] }));
    if (this.lines.length > 1000) this.lines.splice(0, this.lines.length - 1000);
    if (atEnd) this.first = Math.max(0, this.lines.length - 4);
  }
  name(slot) { return this.users[slot]?.name || ''; }

  // ---------------------------------------------------------------- your actions
  start() { if (this.count > 0) this.g.net?.roomOp(0x3D); }
  toggleReady() { play('Ready'); this.g.net?.roomOp(this.ready ? 0x3B : 0x3A); }
  async askTie() {
    if (this.tieAsked || this.tiePending) return;
    if (!(await this.mgr.confirm('Will you request a tie?'))) return;
    this.tieAsked = true; this.tiePending = true; this.g.net?.roomOp(0x32);
  }
  async giveUp() {
    if (this.gaveUp || (this.omok && this.state !== 1)) return;
    if (!(await this.mgr.confirm('Are you sure you want to give up?'))) return;
    this.gaveUp = true; this.g.net?.roomOp(0x34);
  }
  async askBack() {
    if (this.myStones < 1 || this.backPending || this.backAsked || this.backUsed) {
      if (this.backUsed) this.say('You can only request a handicap once per game.', 3);
      return;
    }
    if (!(await this.mgr.confirm('Request to withdraw your last move?'))) return;
    this.backPending = true; this.backAsked = true; this.g.net?.roomOp(0x36);
  }
  async expel() { if (await this.mgr.confirm('Will you expel the user?')) this.g.net?.roomOp(0x3C); }
  async exit() {
    if (this.state === 1) {
      if (!this.leaveAfter) { if (await this.mgr.confirm('Will you call to leave after this game?')) { this.leaveAfter = true; this.g.net?.roomOp(0x38); } }
      else if (await this.mgr.confirm('Will you cancel the request\r\nto leave after this game?')) { this.leaveAfter = false; this.g.net?.roomOp(0x39); }
      return;
    }
    if (!(await this.mgr.confirm('Are you sure you want to leave?'))) return;
    this.g.net?.roomOp(0x0A);
    this.mgr.close(this);
  }
  /** A click on the board: Omok places a stone on an empty point on your turn; Match Cards turn a card. */
  up() {
    const p = this.pressed; this.pressed = null;
    if (!p || this.state !== 1 || !this.myTurn) return;
    if (this.omok) {
      if (this.stones.some((s) => s.x === p.x && s.y === p.y)) return;
      this.g.net?.roomOp(0x40, (w) => w.int(p.x).int(p.y).byte(this.myColor));
      return;
    }
    const i = p.card, c = this.cards[i];
    if (this.step >= 2 || this.timer > 10000 || !c || c.taken || i === this.firstCard) return;
    if (this.step === 0) { this.g.net?.roomOp(0x44, (w) => w.byte(1).byte(i)); this.flipUp(i); this.firstCard = i; this.step = 1; }
    else { this.g.net?.roomOp(0x44, (w) => w.byte(0).byte(i)); this.secondCard = i; this.step = 2; }
  }
  down(lx, ly) {
    if (ly >= 288 && ly < 362 && lx >= 713 && lx < 725) { const v = this.scrollClick(lx, ly, 713, 288, 74, this.first, this.lines.length, 4); if (v !== null) this.first = v; return; }
    if (this.omok) {
      const cx = Math.floor((lx - 25) / 24), cy = Math.floor((ly - 32) / 24);
      if (cx >= 0 && cx < 15 && cy >= 0 && cy < 15 && lx - 25 - 24 * cx < 14 && ly - 32 - 24 * cy < 14) this.pressed = { x: cx, y: cy };
      return;
    }
    const t = this.table;
    for (let i = 0; i < this.cards.length; i++) {
      const x = t.left + 56 * (i % t.cols), y = t.top + 67 * Math.floor(i / t.cols);
      if (lx >= x && lx < x + 49 && ly >= y && ly < y + 62) { this.pressed = { card: i }; return; }
    }
  }
  wheel(s) { this.first = Math.max(0, Math.min(Math.max(0, this.lines.length - 4), this.first + s)); }

  // ---------------------------------------------------------------- server ops
  visit(slot, user, record) {
    this.users[slot] = user; this.records[slot] = record; this.ready = false;
    if (this.me === 0 && !this.tournament) this.banBtn.visible = true;
    this.say(`[${this.name(1)}] have entered.`, 6); play('Enter');
  }
  left(slot, reason) {
    if (slot !== this.me) {
      this.say(`[${this.name(slot)}] have left.`, 6);
      if (!this.tournament) { this.users[slot] = null; this.records[slot] = null; }
      this.banBtn.visible = false; this.endMark = null; this.ready = false;
      return;
    }
    if (reason === 2) { this.say('The game has ended.\r\nThe room will automatically close in 10 sec.', 0); return; }
    const t = { 0: 'You have left the room.', 4: 'You have left the room.', 5: 'You have been expelled.', 3: 'The room is closed.' }[reason] ?? '';
    this.mgr.close(this);
    if (t) this.mgr.notice(t);
  }
  system(code, name) {
    const t = {
      0: '[%s] have been expelled.', 1: "[%s]'s turn.", 2: '[%s] have forfeited.', 3: '[%s] have requested a handicap.', 4: '[%s] have left.',
      5: '[%s] have called to leave after this game.', 6: '[%s] have cancelled the request to leave after this game.', 7: '[%s] have entered.',
      8: "[%s] can't start the game due to lack of mesos.", 9: '[%s] has matched cards. Please continue.', 0x65: '10 sec. left.',
      0x66: 'The game has started.', 0x67: 'The game has ended.\r\nThe room will automatically close in 10 sec.',
    }[code];
    if (t) this.say(t.replace('%s', name), code < 101 ? 3 : 6);
  }
  async op(op, d) {
    switch (op) {
      case 0x32: { const yes = await this.mgr.confirm('Your opponent requests a tie.\r\nWill you accept it?'); this.g.net?.roomOp(0x33, (w) => w.byte(yes ? 1 : 0)); break; }
      case 0x33: this.tiePending = false; this.say('Your opponent denied your request for a tie.', 6); break;
      case 0x36: { const yes = await this.mgr.confirm('Your oppentent has requested to \r\nwithdraw his/her last move.\r\nDo you accept?'); this.g.net?.roomOp(0x37, (w) => w.byte(yes ? 1 : 0)); break; }
      case 0x37:
        this.backPending = false;
        if (!d.accepted) { this.say('Your opponent denied your request.', 6); break; }
        for (let i = 0; i < d.count && this.stones.length; i++) { const s = this.stones.pop(); if (s.color === this.myColor) this.myStones--; }
        if (this.stones.length) this.stones[this.stones.length - 1].anim = this.stoneAnim(this.stones[this.stones.length - 1].color);
        this.myTurn = d.slot === this.me; if (this.myTurn) this.backUsed = true; this.timer = 30000;
        break;
      case 0x3A: this.ready = true; if (this.me === 0) this.startBtn.enabled = true; break;
      case 0x3B: this.ready = false; if (this.me === 0) this.startBtn.enabled = false; break;
      case 0x3D: this.begin(d); break;
      case 0x3E: this.end(d); break;
      case 0x3F:
        this.myTurn = d.slot === this.me;
        if (!this.omok) { if (this.firstCard >= 0) { this.flipDown(this.firstCard); if (this.secondCard >= 0) this.flipDown(this.secondCard); } this.step = 0; this.firstCard = -1; this.secondCard = -1; this.timer = 10000; }
        else this.timer = 30000;
        break;
      case 0x40: {
        const last = this.stones[this.stones.length - 1];
        if (last) last.anim = null;
        this.stones.push({ x: d.x, y: d.y, color: d.color, anim: this.stoneAnim(d.color) });
        if (d.color === this.myColor) { this.myStones++; this.myTurn = false; } else this.myTurn = true;
        this.tieAsked = false; this.backAsked = false; this.timer = 30000;
        play(d.color === 1 ? 'Mushroom' : 'Slime');
        break;
      }
      case 0x41: this.say(d.code === 0x43 ? '\tYou have double-3\'s.' : "You can't put it there.", 6); break;
      case 0x44: this.card(d); break;
      default: break;
    }
  }
  stoneAnim(color) {
    const st = this.M.Omok.stone?.[this.piece] || this.M.Omok.stone?.[0], node = st?.[color === 1 ? 'black' : 'white'];
    if (!node) return null;
    const a = new Anim(node, true); a.defaultDelay = 180; for (const f of a.frames) f.delay ??= 180;
    return a;
  }
  begin(d) {
    this.state = 1; this.ready = false; this.result = null; this.endMark = null; this.everTurn = true;
    this.myTurn = d.slot !== this.me;
    if (this.omok) {
      this.stones = []; this.myStones = 0; this.myColor = d.slot === this.me ? 2 : 1; this.timer = 30000;
      this.backUsed = false; this.backAsked = false; this.backPending = false;
    } else {
      this.cards = d.cards.map((id) => ({ id, up: false, flipAt: 0, pressed: false })); this.pairs = [0, 0];
      this.firstCard = -1; this.secondCard = -1; this.step = 0; this.timer = d.cards.length * 200 + 11500; this.dealt = performance.now(); this.previewed = d.cards.map(() => 0);
    }
    this.gaveUp = false; this.tieAsked = false; this.tiePending = false; this.leaveAfter = false;
  }
  end(d) {
    const won = d.type !== 1 && d.winner === this.me;
    if (d.type === 1) { this.say("It's a tie.", 6); play('Draw'); }
    else if (won) { this.say('You win.', 6); play('Win'); }
    else { this.say('You lost.', 6); play('Loose'); }
    if (this.omok && d.type !== 1) { const wc = d.winner === this.me ? this.myColor : 3 - this.myColor; this.blink = { color: wc, until: performance.now() + 5 * 180 * 2 }; }
    this.records = [d.records[0], d.records[1]];
    this.result = d.type === 1 ? 'draw' : won ? 'win' : 'lose';
    this.endMark = this.count > 1 && d.type !== 1 ? (won ? 'charLose' : 'charWin') : null;
    this.state = 2; this.flipBack = null; this.ready = false; this.leaveAfter = false; this.tieAsked = false; this.tiePending = false; this.gaveUp = false; this.backAsked = false; this.backPending = false;
    if (this.me === 0) this.startBtn.enabled = false;
    this.state = 0;
  }
  flipUp(i, mismatch = false) {
    const c = this.cards[i];
    if (!c) return;
    c.up = true; c.flipAt = performance.now(); play('Open');
    if (mismatch) this.flipBack = { at: performance.now() + 900, cards: [this.firstCard, i] };
  }
  flipDown(i) { const c = this.cards[i]; if (c) { c.up = false; c.flipAt = performance.now(); } }
  card(d) {
    if (d.turn === 1) { this.flipUp(d.index); this.firstCard = d.index; }
    else if (d.result < this.capacity) {
      this.flipUp(d.index, true); this.secondCard = d.index; this.myTurn = d.result !== this.me; this.timer = 11600; play('NoMatch');
    } else {
      this.flipUp(d.index);
      for (const i of [d.firstIndex, d.index]) { const c = this.cards[i]; if (c) { c.taken = true; this.fx.push({ i, at: performance.now() }); } }
      this.pairs[d.result - 2]++; this.timer = 10000; this.firstCard = -1; this.secondCard = -1; play('Match');
    }
    this.tieAsked = false; this.step = 0;
  }

  // ---------------------------------------------------------------- frame
  tick() {
    const now = performance.now(), dt = now - this.t; this.t = now;
    if (this.flipBack && now >= this.flipBack.at) { for (const i of this.flipBack.cards) this.flipDown(i); this.flipBack = null; this.firstCard = -1; this.secondCard = -1; }
    for (const s of this.stones) s.anim?.update(dt);
    // the deal: card i turns up at step i (200ms each) and back down five steps later
    if (this.dealt) {
      const i = Math.floor((now - this.dealt) / 200), n = this.cards.length;
      if (i < n && !this.previewed[i]) { this.flipUp(i); this.previewed[i] = 1; }
      if (i > 4 && i < n + 5 && this.previewed[i - 5] === 1) { this.flipDown(i - 5); this.previewed[i - 5] = -1; }
      if (i >= n + 5) this.dealt = 0;
    }
    if (this.state !== 1) return;
    this.timer -= dt;
    let shown = Math.max(0, Math.floor((this.timer + 999) / 1000));
    if (!this.omok) shown = Math.min(10, shown);
    if (shown !== this.shown) {
      if (this.myTurn && this.shown >= 1 && this.shown <= 9) play('Timer');
      if (shown === 0) this.g.net?.roomOp(0x3F);
      this.shown = shown;
    }
  }
  body(ctx) {
    this.tick();
    const C = this.C, m = this.mgr, im = (n) => m.image(n), put = (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x, y); };
    const black = { color: '#000', size: 12 }, playing = this.state === 1;
    // the controls each frame
    if (this.me === 0) { this.banBtn.enabled = !playing; this.startBtn.enabled = !playing && this.count > 1 && this.ready; }
    else this.readyBtn.enabled = !playing;
    this.giveBtn.enabled = playing; this.tieBtn.enabled = playing; if (this.backBtn) this.backBtn.enabled = playing;
    put(C.barBagic, 404, 149); put(C.barBagic, 490, 149); put(C.info2, 404, 167); put(C.mark, 460, 63);
    if (this.count > 1) put(C.info2, 490, 167); else put(C.info3, 490, this.omok ? 170 : 167);
    say(ctx, cut(ctx, this.title, 215), 507, this.omok ? 22 : 20, black);
    [[0, 444], [1, 530]].forEach(([slot, cx]) => {
      if (slot === 1 && this.count < 2) return;
      const n = this.users[slot];
      if (!n) return;
      let t = n.name, w = width(ctx, t);
      if (w + 5 > 73) { t = cut(ctx, t, 73); w = width(ctx, t); }
      say(ctx, t, cx - Math.floor((w + 5) / 2), this.omok ? 152 : 150, black);
      if (n.look?.ready) drawParts(ctx, this.g.assets, n.look.compose(n.look.standAction(), 0), slot ? 534 : 438, 141, this.omok ? slot === 0 : true);
      const r = this.records[slot];
      if (!r) return;
      const [pE, wE] = this.omok ? (slot ? [536, 546] : [450, 460]) : (slot ? [538, 551] : [452, 465]), dy = this.omok ? 0 : 1;
      for (const [v, edge, y] of [[r.points, pE, 168], [r.wins, wE, 186], [r.losses, wE, 200], [r.ties, wE, 214]]) say(ctx, String(v), edge - width(ctx, String(v)), y + dy, black);
    });
    if (this.count > 1) put(this.ready ? C.readyOn : C.readyOff, 495, 63);
    if (this.everTurn) put(C.turn, (this.myTurn ? this.me === 0 : this.me !== 0) ? 402 : 488, 55);
    if (playing) {
      const who = this.myTurn ? this.me : 1 - this.me;
      say(ctx, `It's [ ${cut(ctx, this.name(who), 73)} ]'s turn.`, 13, this.omok ? 406 : 404, black);
      say(ctx, `Time left : ${this.shown} sec.`, this.omok ? 300 : 295, this.omok ? 406 : 404, black);
    }
    if (this.omok) this.drawBoard(ctx); else this.drawTable(ctx);
    if (this.endMark) put(C[this.endMark], this.me === 0 ? 496 : 410, 113);
    if (this.result) put(C[this.result], 87, 151);
    // the chat log
    for (let i = 0; i < 4; i++) { const l = this.lines[this.first + i]; if (l) say(ctx, l.text, 409, 289 + 16 * i, { color: l.color, size: 12 }); }
    this.scrollbar(ctx, 713, 288, 74, this.first, this.lines.length, 4);
  }
  drawBoard(ctx) {
    const st = this.M.Omok.stone?.[this.piece] || this.M.Omok.stone?.[0], im = (n) => this.mgr.image(n), now = performance.now();
    const blinking = this.blink && now < this.blink.until;
    for (const s of this.stones) {
      const node = s.anim?.node || st?.[s.color === 1 ? 'black' : 'white']?.[0];
      if (blinking && s.color === this.blink.color && Math.floor(now / 180) % 2) continue;
      const img = node && im(node);
      if (img) { const o = node.origin || [0, 0]; ctx.drawImage(img, 21 + 24 * s.x - o[0], 28 + 24 * s.y - o[1]); }
    }
    if (this.everTurn && this.myColor) {
      const mine = st?.[this.myColor === 1 ? 'black' : 'white']?.[0], theirs = st?.[this.myColor === 1 ? 'white' : 'black']?.[0];
      const [mx, ox] = this.me === 0 ? [411, 497] : [497, 411];
      const draw = (n, x) => { const i = n && im(n); if (i) ctx.drawImage(i, x, 207); };
      draw(mine, mx); if (this.count > 1) draw(theirs, ox);
    }
  }
  drawTable(ctx) {
    const G = this.M.MemoryGame, t = this.table, im = (n) => this.mgr.image(n), now = performance.now();
    this.cards.forEach((c, i) => {
      const x = t.left + 56 * (i % t.cols), y = t.top + 67 * Math.floor(i / t.cols), press = this.pressed?.card === i ? 2 : 0;
      const showing = c.up || c.taken;
      const k = Math.min(1, (now - c.flipAt) / 600), face = showing ? k >= 0.5 : k < 0.5;
      const img = im(face ? G.card?.[c.id] : G.card?.[`back${this.piece}`]);
      if (!img) return;
      const sx = Math.abs(1 - 2 * Math.min(1, k));
      ctx.save(); ctx.translate(x + press + 24.5, y + press); ctx.scale(k < 1 ? Math.max(0.05, sx) : 1, 1); ctx.drawImage(img, -24.5, 0); ctx.restore();
    });
    for (const f of this.fx) {
      const k = Math.floor((now - f.at) / 300);
      if (k >= 5) continue;
      const node = G[`effect${this.piece}`]?.[k] || G[`effect${this.piece}`]?.[0], img = node && im(node);
      if (!img) continue;
      const i = f.i, x = t.left + 56 * (i % t.cols), y = t.top + 67 * Math.floor(i / t.cols), o = node.origin || [0, 0];
      ctx.save(); ctx.globalAlpha = k % 2 ? 0.5 : 1; ctx.drawImage(img, x - o[0], y - o[1]); ctx.restore();
    }
    const num = (n, x) => { const img = im(G.number?.[n]); if (img) ctx.drawImage(img, x, 207); };
    if (this.count > 1 && this.everTurn) { num(this.pairs[0], 411); num(this.pairs[1], 497); }
  }
  draw(ctx) {
    super.draw(ctx);
    this.chat.rect.x = this.x + 511; this.chat.rect.y = this.y + 374;
    this.chat.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
  }
}
