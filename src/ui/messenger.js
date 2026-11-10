import { drawParts } from '../character.js';
import { TextField, uiText } from './wzui.js';
import { Win, allCanvases } from './windows.js';
import { UI_W } from '../view.js';

/**
 * Maple Messenger (UIWindow.img/Messenger/backgrnd, 295x364): up to three people chatting from anywhere in
 * the world. Measured from the art:
 *   title bar y 0-20; the portrait panel x 2-290 y 24-142 with three spots (shadows centred on x 52 / 146 / 240
 *   at y 120), a NameBar (89x19) under each
 *   chat x 8-266 y 148-302, its scrollbar at 272; the input line x 12-220 y 318-334, BtEnter beside it
 * Opening it starts a messenger (you take spot 0); type /invite <name> to ask someone in, /q (or Escape and
 * yes) to leave. When someone talks, chatBalloon plays over their portrait. Closing it leaves.
 *
 * The chat is 12px Arial, cut to 240 wide by letters, each following piece of a long line indented by four
 * spaces. Notices are black; each spot's lines have their own colour.
 */
const SPOTS = [52, 146, 240], FEET = 120, CHAT = { x: 10, y: 150, wrap: 240, rows: 10, line: 15 };
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
    const M = mgr.W.Messenger;
    super(mgr, M.backgrnd, 250, 120);
    this.M = M;
    this.reset();
    this.enter = this.button(M.BtEnter, 238, 318, () => this.send());
    this.field = new TextField(mgr.game.statusBar.layer, 0, 0, 206, 15, { max: 256, color: '#000' });
    this.field.show(false);
    this.field.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.send();
      else if (e.key === 'Escape') this.askLeave();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.recall(e.key === 'ArrowUp' ? -1 : 1); }
    });
  }
  frames() { return [...super.frames(), ...allCanvases(this.M)]; }
  reset() {
    this.members = []; this.myPos = 0; this.seated = false; this.lines = []; this.first = null; this.talk = {}; this.active = false;
    // the window's own chat checks and sent-line history, apart from the chat bar's
    this.guard = { game: this.g, history: [], historyAt: 0 };
  }

  // ---------------------------------------------------------------- open / close
  onOpen() {
    this.field.show(true);
    if (this.active) return;
    this.reset();
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
      if (e.announce) this.say(`- '${e.name}' has entered.`);
    } else if (e.op === 'remove') {
      if (e.pos >= 0 && e.pos < 3) this.say(`- '${name(e.pos)}' have left the room.`);
      delete this.members[e.pos];
    } else if (e.op === 'invited') this.say(e.ok ? `- You have sent the invite to '${e.name}'.` : `- '${e.name}' can't be found.`);
    else if (e.op === 'declined') this.say(e.mode ? `'${e.name}' is currently not accepting chat.` : `'${e.name}' denied the request.`);
    else if (e.op === 'chat') {
      // "name : text" from someone in the room, its words from Etc/Curse.img masked; a line with no " : " is a
      // typing notice (the name and 0 or 1), not chat
      const at = e.text.indexOf(' : ');
      if (at < 0) return;
      const who = e.text.slice(0, at), pos = this.members.findIndex((m) => m?.name?.toLowerCase() === who.toLowerCase());
      if (pos < 0) return;
      this.g.maskCurses(e.text.slice(at + 3)).then((t) => this.say(`${who} : ${t}`, SPOT_COLORS[pos]));
      this.talk[pos] = performance.now();
    }
  }
  say(text, color = NOTICE) { this.lines.push({ text, color }); if (this.lines.length > 100) this.lines.shift(); this.first = null; }

  // ---------------------------------------------------------------- your actions
  /**
   * Enter: a line starting with '/' is a command; anything else goes through the same checks as the chat bar
   * (its quiet time after a warning, cursing, then the repeat and flood checks) and is kept for Up / Down.
   */
  async send() {
    const text = this.field.value;
    if (!text || this.myPos < 0) return;
    this.field.value = '';
    if (text[0] === '/') { this.command(text); return; }
    const sb = this.g.statusBar, checks = Object.getPrototypeOf(sb), guard = this.guard;
    if (performance.now() - (guard.spamAt ?? -Infinity) >= 2800 && await this.g.cursed?.(text)) { this.mgr.notice('Cursing is not allowed.'); return; }
    if (!checks.canSay.call(guard, text)) return;
    checks.remember.call(guard, text);
    const line = `${this.g.player.name} : ${text}`;
    this.g.net?.messengerChat(line);
    this.say(line, SPOT_COLORS[this.myPos]);
    this.talk[this.myPos] = performance.now();
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

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    super.draw(ctx);
    this.field.rect.x = this.x + 12; this.field.rect.y = this.y + 319;
    this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / UI_W);
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), now = performance.now();
    SPOTS.forEach((x, pos) => {
      const m = this.members[pos], bar = im(this.M.NameBar[pos] || this.M.NameBar[0]);
      if (bar) ctx.drawImage(bar, x - 44, 123);
      if (!m) return;
      const look = m.look;
      if (look?.compose) {
        ctx.save(); ctx.beginPath(); ctx.rect(x - 46, 26, 92, 96); ctx.clip();
        drawParts(ctx, this.g.assets, look.compose(look.standAction(), 0), x, FEET, false);
        ctx.restore();
      }
      uiText(ctx, m.name, x, 126, { color: '#fff', bold: true, size: 11, align: 'center' });
      // the talk balloon plays over a portrait for a moment after its owner says something
      const t = now - (this.talk[pos] || -1e9);
      if (t < 2000) {
        const fr = this.M.chatBalloon[Math.floor(t / 120) % 5], b = im(fr);
        if (b) ctx.drawImage(b, x + 4, 28);
      }
    });
    // chat, newest at the bottom unless scrolled up
    ctx.save(); ctx.font = '12px Arial, sans-serif';
    const rows = this.lines.flatMap((l) => wrapLine(ctx, l.text).map((text) => ({ text, color: l.color })));
    ctx.restore();
    this.rowCount = rows.length;
    const max = Math.max(0, rows.length - CHAT.rows), first = this.first === null ? max : Math.min(this.first, max);
    rows.slice(first, first + CHAT.rows).forEach((l, i) => uiText(ctx, l.text, CHAT.x, CHAT.y + i * CHAT.line, { color: l.color, size: 12 }));
    this.scrollbar(ctx, 272, 148, 156, first, rows.length, CHAT.rows);
  }
  down(lx, ly) {
    const max = Math.max(0, (this.rowCount || 0) - CHAT.rows);
    const s = this.scrollClick(lx, ly, 272, 148, 156, this.first ?? max, this.rowCount || 0, CHAT.rows);
    if (s !== null) this.first = s >= max ? null : s;
  }
  wheel(dy) {
    const max = Math.max(0, (this.rowCount || 0) - CHAT.rows), cur = this.first ?? max;
    const next = Math.max(0, Math.min(max, cur + Math.sign(dy)));
    this.first = next >= max ? null : next;
  }
}
