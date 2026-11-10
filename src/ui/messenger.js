import { drawParts } from '../character.js';
import { TextField, uiText } from './wzui.js';
import { Win, allCanvases, cutText } from './windows.js';
import { UI_W } from '../view.js';

/**
 * Maple Messenger (UIWindow.img/Messenger): up to three people chatting from anywhere in the world. It always opens
 * at its full size; BtMin / BtMax step through three:
 *   0 full (backgrnd, 295x364): the three portraits (each standing at (54 + 94n, 118), its NameBar 45 left of that
 *     and 4 below, the empty chat balloon over it), 11 chat rows, the scrollbar at (273, 148) 154 long, the input
 *     line at (9, 318) 207x15, Report (Basic/BtClaim) at (225, 315) and BtEnter at (249, 317).
 *   1 (backgrnd2, its window 392x240): the name plates moved 94px up into the strip under the title, no portraits,
 *     9 chat rows, the scrollbar at (273, 55) 125 long, the input at (9, 194), Report at (225, 191), BtEnter at
 *     (249, 193).
 *   2 (backgrnd3, 184x22): the title bar alone; a line or someone coming or going makes its blink flash.
 *   BtClose / BtMin / BtMax sit at x 276 / 248 / 262, y 6 (166 / 138 / 152, y 5 on the title bar); BtMin is off at
 *   the smallest size, BtMax at the full one.
 * Chat rows are 12px Arial from (14, 155) at the full size (14, 60 at the next), 13px apart, cut to 240 wide by
 * letters, each following piece of a long line indented by four spaces. Notices are black; each spot's lines have
 * their own colour.
 *
 * Typing: once the input line has letters, "<name>1" goes as a chat line and BtEnter lights; once it is empty again,
 * "<name>0" and BtEnter goes out; after either, the next can't go for 3 seconds. Someone's "1" sets their balloon's
 * dots going and puts "<names> is typing." in white at (26, height - 20); their "0" or their next line stops it.
 * Opening the window starts a messenger (you take spot 0); /invite <name> asks someone in, /q (or Escape and yes)
 * leaves, and so does closing it.
 */
const SIZES = [
  { bg: 'backgrnd', w: 295, h: 364, rows: 11, chatY: 155, bar: [273, 148, 154], input: [9, 318], claim: [225, 315], enter: [249, 317] },
  { bg: 'backgrnd2', w: 392, h: 240, rows: 9, chatY: 60, bar: [273, 55, 125], input: [9, 194], claim: [225, 191], enter: [249, 193] },
  { bg: 'backgrnd3', w: 184, h: 22, rows: 0 },
];
const SPOT_X = (pos) => 54 + 94 * pos, FEET = 118, PLATE_DX = -45, PLATE_DY = [4, -90];
const CHAT = { x: 14, wrap: 240, line: 13 };
const TYPE_GAP = 3000, BLINK_AT = [118, 6];   // the blink's place was lost: placed between the title and BtMin
const NOTICE = '#000000', SPOT_COLORS = ['#006699', '#ff2020', '#336600'];
const HELP = ['[ Maple Messenger Help ]', '-------------------------', 'Invite : /invite character-name', 'End : /q', '-------------------------'];

/** A chat line cut to the chat's width by letters; the pieces after the first are indented by four spaces. */
function wrapLine(ctx, text) {
  const out = [], indent = '    ', iw = ctx.measureText(indent).width;
  let rest = text;
  do {
    const w = out.length ? CHAT.wrap - iw : CHAT.wrap;
    let n = rest.length;
    while (n > 1 && ctx.measureText(rest.slice(0, n)).width > w) n--;
    out.push(out.length ? indent + rest.slice(0, n) : rest.slice(0, n));
    rest = rest.slice(n);
  } while (rest);
  return out;
}

export class MessengerWin extends Win {
  constructor(mgr) {
    const M = mgr.W.Messenger, B = mgr.B;
    super(mgr, M.backgrnd, 250, 120);
    this.M = M; this.closePinned = true;
    this.reset();
    this.minBtn = this.button(B.BtMin, 248, 6, () => this.setSize(this.size + 1));
    this.maxBtn = this.button(B.BtMax, 262, 6, () => this.setSize(this.size - 1));
    this.claimBtn = this.button(B.BtClaim, 225, 315, () => this.report());
    this.enter = this.button(M.BtEnter, 249, 317, () => this.send());
    this.field = new TextField(mgr.game.statusBar.layer, 0, 0, 207, 15, { max: 256, color: '#000' });
    this.field.show(false);
    this.field.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.send();
      else if (e.key === 'Escape') this.askLeave();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.recall(e.key === 'ArrowUp' ? -1 : 1); }
    });
    this.setSize(0);
  }
  frames() { return [...super.frames(), ...allCanvases(this.M)]; }
  reset() {
    this.members = []; this.myPos = 0; this.seated = false; this.lines = []; this.first = null; this.active = false;
    this.typing = [false, false, false];      // who is typing (their balloon's dots, the "is typing." line)
    this.mine = false; this.typeWait = 0; this.acc = 0;   // your own typing notice and the 3s between them
    this.blink = 0;                            // the smallest size's blink: counted down in 30ms ticks
    // the window's own chat checks and sent-line history, apart from the chat bar's
    this.guard = { game: this.g, history: [], historyAt: 0 };
  }
  /** Changes the size (0 full, 1 short, 2 the title bar): background, window size and controls. */
  setSize(n) {
    if (n < 0 || n > 2) return;
    const S = SIZES[n];
    this.size = n; this.S = S; this.first = null;
    this.bg = this.M[S.bg]; this.w = S.w; this.h = S.h;
    const bar = n === 2;
    this.closeBtn.x = bar ? 166 : 276; this.minBtn.x = bar ? 138 : 248; this.maxBtn.x = bar ? 152 : 262;
    for (const b of [this.closeBtn, this.minBtn, this.maxBtn]) b.y = bar ? 5 : 6;
    this.minBtn.enabled = n !== 2; this.maxBtn.enabled = n !== 0;
    this.claimBtn.visible = this.enter.visible = !bar;
    if (!bar) {
      [this.claimBtn.x, this.claimBtn.y] = S.claim; [this.enter.x, this.enter.y] = S.enter;
      this.enter.enabled = this.mine;
    }
    if (this.mgr.isOpen?.('messenger')) { this.field.show(!bar); if (bar) this.field.el.blur(); }
    if (n !== 2) this.blink = 0;
  }

  // ---------------------------------------------------------------- open / close
  onOpen() {
    this.setSize(0);
    this.field.show(true);
    if (this.active) return;
    this.reset();
    this.enter.enabled = false;
    this.active = true;
    for (const t of HELP) this.say(t);
    if (this.joining) { this.joining = false; this.myPos = -1; return; }      // accepting: the server seats you
    // opening it starts a messenger with you in spot 0 (the server sends nothing back for that)
    this.g.net?.messengerJoin(0);
    this.members[0] = this.self(); this.seated = true;
  }
  onClose() {
    this.field.show(false); this.field.el.blur();
    if (this.active) this.g.net?.messengerLeave();
    this.reset();
  }
  /** Accept an invitation: the server places you and tells you who is there. */
  accept(id) {
    if (this.mgr.isOpen('messenger')) this.mgr.close(this);
    this.joining = true;
    this.mgr.open('messenger');
    this.g.net?.messengerJoin(id);
  }
  self() { return { name: this.g.player.name, look: this.g.look, me: true }; }

  // ---------------------------------------------------------------- server events
  event(e) {
    const name = (p) => this.members[p]?.name ?? '';
    if (e.op === 'join') {
      // a spot below 0: the room couldn't be joined, and you sit alone in spot 0
      if (e.pos < 0) this.say('- You have been unable to join the invited chat room.');
      this.myPos = Math.max(0, e.pos); this.members[this.myPos] = this.self(); this.seated = true;
      if (e.pos >= 0) this.say(`- '${this.g.player.name}' has entered.`);
    } else if (e.op === 'add' || e.op === 'update') {
      this.members[e.pos] = { name: e.name, look: this.g.lookFrom(e.look), channel: e.channel };
      this.typing[e.pos] = false;
      if (e.announce) { this.say(`- '${e.name}' has entered.`); this.flash(); }
    } else if (e.op === 'remove') {
      if (e.pos >= 0 && e.pos < 3) { this.say(`- '${name(e.pos)}' have left the room.`); this.flash(); this.typing[e.pos] = false; }
      delete this.members[e.pos];
    } else if (e.op === 'invited') this.say(e.ok ? `- You have sent the invite to '${e.name}'.` : `- '${e.name}' can't be found.`);
    else if (e.op === 'declined') this.say(e.mode ? `'${e.name}' is currently not accepting chat.` : `'${e.name}' denied the request.`);
    else if (e.op === 'chat') {
      // "name : text" from someone in the room, its words from Etc/Curse.img masked; a line with no " : " is a
      // typing notice: the name, then 0 (stopped) or anything else (typing)
      const at = e.text.indexOf(' : ');
      const who = at < 0 ? e.text.slice(0, -1) : e.text.slice(0, at), on = at < 0 && e.text.slice(-1) !== '0';
      const pos = this.members.findIndex((m) => m?.name?.toLowerCase() === who.toLowerCase());
      if (pos < 0) return;
      if (this.size !== 2) this.typing[pos] = on;
      if (at < 0) return;
      this.g.maskCurses(e.text.slice(at + 3)).then((t) => this.say(`${who} : ${t}`, SPOT_COLORS[pos]));
      this.flash();
    }
  }
  say(text, color = NOTICE) { this.lines.push({ text, color }); if (this.lines.length > 100) this.lines.shift(); this.first = null; }
  /** Something came while the window is at its smallest: its blink starts (unless it is going). */
  flash() { if (this.blink < 1) this.blink = 30; }

  // ---------------------------------------------------------------- your actions
  /**
   * Enter: a line starting with '/' is a command; anything else goes through the same checks as the chat bar
   * (its quiet time after a warning, cursing, then the repeat and flood checks) and is kept for Up / Down. Sending
   * ends your typing without a notice (your line ends it for the others) and puts BtEnter out.
   */
  async send() {
    const text = this.field.value;
    if (!text || this.myPos < 0 || this.size === 2) return;
    this.field.value = '';
    this.enter.enabled = false;
    if (text[0] === '/') { this.command(text); return; }
    this.mine = false;
    const sb = this.g.statusBar, checks = Object.getPrototypeOf(sb), guard = this.guard;
    if (performance.now() - (guard.spamAt ?? -Infinity) >= 2800 && await this.g.cursed?.(text)) { this.mgr.notice('Cursing is not allowed.'); return; }
    if (!checks.canSay.call(guard, text)) return;
    checks.remember.call(guard, text);
    const line = `${this.g.player.name} : ${text}`;
    this.g.net?.messengerChat(line);
    this.say(line, SPOT_COLORS[this.myPos]);
  }
  /** A line starting with '/': /q leaves, "/invite name" asks someone in; anything else does nothing. */
  command(text) {
    if (text.toLowerCase() === '/q') { this.mgr.close(this); return; }
    const pre = '/invite ';
    if (text.length > pre.length && text.slice(0, pre.length).toLowerCase() === pre) this.inviteByName(text.slice(pre.length));
  }
  /** /invite: not yourself, and not a name holding a word from Etc/ForbiddenName.img. */
  async inviteByName(name) {
    const me = this.g.player.name;
    if (!me || name.toLowerCase() === me.toLowerCase()) { this.say("- Please enter the user's name."); return; }
    const bad = Object.values((await this.g.assets.json('Etc/ForbiddenName.img')) || {}).map((v) => String(v).toLowerCase());
    if (bad.some((b) => b && name.toLowerCase().includes(b))) { this.say('- The character name is invalid.'); return; }
    this.g.net?.messengerInvite(name);
  }
  /** Report: the Report notice and form, on the room's chat lines (not its notices). */
  report() {
    const log = this.lines.filter((l) => l.color !== NOTICE).map((l) => ({ name: l.text.slice(0, Math.max(0, l.text.indexOf(' : '))), line: l.text }));
    this.g.openReport('', log);
  }
  /** Escape in the input line: "Will you exit this chat room?", and yes leaves. */
  async askLeave() {
    if (await this.mgr.confirm('Will you exit this chat room?')) this.mgr.close(this);
  }
  /** Up / Down: the lines sent before. */
  recall(d) {
    const g = this.guard, n = g.history.length;
    if (!n) return;
    g.historyAt = Math.max(0, Math.min(n, g.historyAt + d));
    this.field.value = g.history[g.historyAt] ?? '';
  }
  /** The window manager's frame time, in the client's 30ms ticks. */
  tick(ms) { this.acc = Math.min(this.acc + ms, 1000); while (this.acc >= 30) { this.acc -= 30; this.step(30); } }
  /**
   * Every 30ms tick: your typing notice when the input line fills or empties (not within 3s of the last), and the
   * smallest size's blink (on for 15 ticks, off for 15, first on 30 ticks after it starts).
   */
  step(ms) {
    if (this.typeWait > 0) { this.typeWait -= ms; return; }
    if (this.size !== 2 && this.active && this.myPos >= 0) {
      const has = !!this.field.value;
      if (has !== this.mine) {
        this.mine = has;
        this.g.net?.messengerChat(`${this.g.player.name}${has ? '1' : '0'}`);
        this.enter.enabled = has;
        this.typeWait = TYPE_GAP;
        return;
      }
    }
    if (this.size === 2 && this.blink > 0) {
      this.blink--;
      if (this.blink === 15) this.blinkOn = false;
      else if (this.blink === 0) { this.blink = 30; this.blinkOn = true; }
    } else { this.blink = 0; this.blinkOn = false; }
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    super.draw(ctx);
    if (this.size !== 2) {
      const [ix, iy] = this.S.input;
      this.field.rect.x = this.x + ix; this.field.rect.y = this.y + iy;
      this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
    }
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), now = performance.now(), n = this.size;
    if (n === 2) {
      const b = this.blinkOn && im(this.M.blink);
      if (b) ctx.drawImage(b, ...BLINK_AT);
      return;
    }
    for (let pos = 0; pos < 3; pos++) {
      const x = SPOT_X(pos), m = this.members[pos], plate = im(this.M.NameBar[pos] || this.M.NameBar[0]), py = FEET + PLATE_DY[n];
      if (plate) ctx.drawImage(plate, x + PLATE_DX, py);
      if (!m) continue;
      uiText(ctx, m.name, x + PLATE_DX + 45, py + 3, { color: '#fff', bold: true, size: 11, align: 'center' });
      if (n !== 0) continue;
      const look = m.look;
      if (look?.compose) {
        ctx.save(); ctx.beginPath(); ctx.rect(x - 48, 26, 92, 96); ctx.clip();
        drawParts(ctx, this.g.assets, look.compose(look.standAction(), 0), x, FEET, false);
        ctx.restore();
      }
      // the balloon: empty, its dots going while they type
      const fr = this.M.chatBalloon[this.typing[pos] ? Math.floor(now / 120) % 5 : 0], b = im(fr);
      if (b) ctx.drawImage(b, x + 2, 28);
    }
    // chat, newest at the bottom unless scrolled up
    const S = this.S;
    ctx.save(); ctx.font = '12px Arial, sans-serif';
    const rows = this.lines.flatMap((l) => wrapLine(ctx, l.text).map((text) => ({ text, color: l.color })));
    const who = this.members.map((m, p) => (m && this.typing[p] ? m.name : null)).filter(Boolean);
    const typingLine = who.length ? cutText(ctx, `${who.join(',')} is typing.`, 262) : '';
    ctx.restore();
    this.rowCount = rows.length;
    const max = Math.max(0, rows.length - S.rows), first = this.first === null ? max : Math.min(this.first, max);
    rows.slice(first, first + S.rows).forEach((l, i) => uiText(ctx, l.text, CHAT.x, S.chatY + i * CHAT.line, { color: l.color, size: 12 }));
    this.scrollbar(ctx, ...S.bar, first, rows.length, S.rows);
    if (typingLine) uiText(ctx, typingLine, 26, S.h - 20, { color: '#fff', size: 12 });
  }
  down(lx, ly) {
    if (this.size === 2) return;
    const S = this.S, max = Math.max(0, (this.rowCount || 0) - S.rows);
    const s = this.scrollClick(lx, ly, ...S.bar, this.first ?? max, this.rowCount || 0, S.rows);
    if (s !== null) this.first = s >= max ? null : s;
  }
  /** The wheel, over the chat's scrollbar or up to 250px left of it. */
  wheel(dy) {
    if (this.size === 2) return;
    const [bx, by, bh] = this.S.bar, lx = this.mgr.mouse.x - this.x, ly = this.mgr.mouse.y - this.y;
    if (lx < bx - 250 || lx >= bx + 12 || ly < by || ly >= by + bh) return;
    const max = Math.max(0, (this.rowCount || 0) - this.S.rows), cur = this.first ?? max;
    const next = Math.max(0, Math.min(max, cur + Math.sign(dy)));
    this.first = next >= max ? null : next;
  }
}
