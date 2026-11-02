import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { TextField, uiText, wrapText } from './wzui.js';
import { Win, allCanvases } from './windows.js';

/**
 * Maple Messenger (UIWindow.img/Messenger/backgrnd, 295x364): up to three people chatting from anywhere in
 * the world. Measured from the art:
 *   title bar y 0-20; the portrait panel x 2-290 y 24-142 with three spots (shadows centred on x 52 / 146 / 240
 *   at y 120), a NameBar (89x19) under each
 *   chat x 8-266 y 148-302, its scrollbar at 272; the input line x 12-220 y 318-334, BtEnter beside it
 * Opening it starts a messenger (you take spot 0); double-click an empty spot or type /invite <name> to ask
 * someone in. When someone talks, chatBalloon plays over their portrait. Closing it leaves.
 */
const SPOTS = [52, 146, 240], FEET = 120, CHAT = { x: 10, y: 150, w: 254, rows: 10, line: 15 };

export class MessengerWin extends Win {
  constructor(mgr) {
    const M = mgr.W.Messenger;
    super(mgr, M.backgrnd, 250, 120);
    this.M = M;
    this.reset();
    this.enter = this.button(M.BtEnter, 238, 318, () => this.send());
    this.field = new TextField(mgr.game.statusBar.layer, 0, 0, 206, 15, { max: 70, color: '#000' });
    this.field.show(false);
    this.field.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.send();
      else if (e.key === 'Escape') this.field.el.blur();
    });
  }
  frames() { return [...super.frames(), ...allCanvases(this.M)]; }
  reset() { this.members = []; this.myPos = 0; this.seated = false; this.lines = []; this.first = null; this.talk = {}; this.active = false; }

  // ---------------------------------------------------------------- open / close
  onOpen() {
    this.field.show(true);
    if (this.active) return;
    this.reset();
    this.active = true;
    if (this.joining) { this.joining = false; return; }      // accepting: the server seats you
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
    const name = (p) => this.members[p]?.name;
    // joining someone's messenger: those already there arrive first, then your own spot
    if (e.op === 'join') { this.myPos = e.pos; this.members[e.pos] = this.self(); this.seated = true; }
    else if (e.op === 'add' || e.op === 'update') {
      const known = this.members[e.pos]?.name === e.name;
      this.members[e.pos] = { name: e.name, look: this.g.lookFrom(e.look), channel: e.channel };
      if (e.op === 'add' && !known && this.seated) { this.say(`${e.name} has joined.`, '#555'); sfx.play('UI/BtMouseClick'); }
    } else if (e.op === 'remove') {
      if (name(e.pos)) this.say(`${name(e.pos)} has left.`, '#555');
      delete this.members[e.pos];
    } else if (e.op === 'invited') this.say(e.ok ? `You have sent an invitation to ${e.name}.` : `${e.name} could not be found.`, '#555');
    else if (e.op === 'declined') this.say(`${e.name} has declined your invitation.`, '#555');
    else if (e.op === 'chat') {
      this.say(e.text);
      const who = e.text.split(' : ')[0], pos = this.members.findIndex((m) => m?.name === who);
      if (pos >= 0) this.talk[pos] = performance.now();
    }
  }
  say(text, color = '#000') { this.lines.push({ text, color }); if (this.lines.length > 100) this.lines.shift(); this.first = null; }

  // ---------------------------------------------------------------- your actions
  send() {
    const text = this.field.value.trim();
    if (!text) return;
    this.field.value = '';
    const inv = text.match(/^\/invite\s+(\S+)/i);
    if (inv) { this.invite(inv[1]); return; }
    const line = `${this.g.player.name} : ${text}`;
    this.g.net?.messengerChat(line);
    this.say(line);
    this.talk[this.myPos] = performance.now();
  }
  async invite(name) {
    if (!name) name = (await this.mgr.askText('Enter the name of the character you want to invite to the Maple Messenger.'))?.trim();
    if (!name) return;
    if (this.members.filter(Boolean).length >= 3) { this.say('The Maple Messenger is full.', '#555'); return; }
    this.g.net?.messengerInvite(name);
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    super.draw(ctx);
    this.field.rect.x = this.x + 12; this.field.rect.y = this.y + 319;
    this.field.layout({ left: 0, top: 0 }, this.g.canvas.clientWidth / 800);
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
    ctx.save(); ctx.font = '11px Arial, sans-serif';
    const rows = this.lines.flatMap((l) => wrapText(ctx, l.text, CHAT.w - 4, 11).map((text) => ({ text, color: l.color })));
    ctx.restore();
    this.rowCount = rows.length;
    const max = Math.max(0, rows.length - CHAT.rows), first = this.first === null ? max : Math.min(this.first, max);
    rows.slice(first, first + CHAT.rows).forEach((l, i) => uiText(ctx, l.text, CHAT.x, CHAT.y + i * CHAT.line, { color: l.color, size: 11 }));
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
  dblclick(lx, ly) {
    // an empty spot: invite someone into it
    if (ly < 26 || ly > 142) return;
    const pos = SPOTS.findIndex((x) => Math.abs(lx - x) < 46);
    if (pos >= 0 && !this.members[pos]) this.invite();
  }
}
