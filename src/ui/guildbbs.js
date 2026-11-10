import { Win, allCanvases, cutText } from './windows.js';
import { TextField, wrapText } from './wzui.js';
import { drawEmblem } from './social.js';
import { UI_W, UI_H } from '../view.js';

/**
 * The guild bulletin board (UI/GuildBBS.img, 734x526, UI type 0xB), from the Guild tab's BBS button or OPEN_UI 0xB.
 *
 * Left, the threads: the guild's mark at (20, 24) and its name at (58, 22); the notice on the top row (y 103), then
 * this page's threads, ten at most, 31px apart from y 134. A row's text sits 8px down: "<number> <title>" from x 26
 * (the notice has no number), its "[replies]" 2px after that in #64B4F0, the writer centred on 257-323 (cut at 70px),
 * the date from x 332 in #404040 (the time for today's, else MM/DD), the emoticon at (237, row + 5). The page numbers
 * sit under the list, the current one in #64B4F0. A click on a row opens it.
 *
 * Right, backgrnd2 at (398, 18) with the open thread: the title centred on 409-709 at y 36 in bold, the writer at
 * (445, 63) and the date at (576, 63) as YYYY/MM/DD HH:MM; below, four reply rows from y 335, 31px apart: the writer
 * centred on 399-475, the text from x 480 and the date from x 654, with a VScr4 at (710, 326), 125 tall, that starts
 * on the last four. NOTICE (404, 275, rank 1-2), WRITE (540, 275), EDIT and DELETE (602 / 664, 275: your own thread,
 * or rank 1-2); the reply box (424, 459, 256 wide, 25 letters, white) with REPLY at (704, 457); EXIT at (680, 501).
 * Writer names come from the guild's member list; one no longer in it shows none.
 *
 * WRITE, NOTICE (only while there is no notice) and EDIT swap in backgrnd3: the subject (25 letters) and content (600)
 * boxes and the emoticon row, the three basic ones from x 427 and the cash ones owned (5290000-5290006) from x 496,
 * 23px apart, picked by a click. The arrows move the highlight only; what is posted is the one clicked.
 *
 * Placed by the art (no place known): the open thread's text and its scrollbar, the reply delete buttons, the
 * editor's two boxes, REGISTER / CANCEL and the arrows, the emoticon highlight, and the page numbers' spacing.
 */
const W = 734, H = 526, PANEL_X = 398, PANEL_Y = 18;
const NOTICE_Y = 103, ROW0 = 134, ROW_H = 31, PER_PAGE = 10, LIST_L = 22, LIST_R = 366;
const REPLY_Y = 335, REPLY_ROWS = 4, REPLY_BAR = { x: 710, y: 326, h: 125 };
const EMO_Y = 247, EMO_BASIC_X = 427, EMO_CASH_X = 496, EMO_STEP = 23, CASH_EMO_ITEM = 5290000, CASH_EMOTICONS = 7;
const BODY = { x: 407, y: 82, w: 294, line: 15, rows: 12, bar: { x: 704, y: 80, h: 186 } };
const PAGE_X = 199, PAGE_Y = 449, PAGE_GAP = 8;
const F1 = { size: 12, color: '#000' }, F2 = { size: 12, color: '#404040' }, F5 = { size: 12, color: '#64B4F0' };
const FONT = '12px Arial, "Segoe UI", sans-serif';
const MSG = {
  title: 'Please enter the title.', text: 'Please enter the text.', curse: 'Cursing is not allowed.',
  del: 'Are you sure you want to delete the post?', notice: 'Please delete the current notice\r\nand then try again.',
  gone: 'This message had been deleted by another user.\r\nPlease check again.',
};

/** A FILETIME as a Date whose UTC fields are the time the server wrote. */
const ftDate = (ft) => new Date(Number(BigInt(ft) / 10000n) - 11644473600000);
const p2 = (n) => String(n).padStart(2, '0');
/** The list and reply date: H:MM for today, else MM/DD. */
function shortDate(ft) {
  const d = ftDate(ft), now = new Date();
  const today = d.getUTCFullYear() === now.getFullYear() && d.getUTCMonth() === now.getMonth() && d.getUTCDate() === now.getDate();
  return today ? `${d.getUTCHours()}:${p2(d.getUTCMinutes())}` : `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}`;
}
const longDate = (ft) => { const d = ftDate(ft); return `${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };

export class GuildBBSWin extends Win {
  constructor(mgr) {
    super(mgr, null, (UI_W - W) >> 1, Math.max(0, (UI_H - H) >> 1));
    this.w = W; this.h = H;
    this.closeBtn.x = 714; this.closePinned = true;
    this.A = null;
    const layer = mgr.game.statusBar.layer;
    const field = (w, h, opts) => {
      const f = new TextField(layer, 0, 0, w, h, opts);
      f.show(false);
      f.el.addEventListener('keydown', (e) => e.stopPropagation());
      return f;
    };
    this.replyF = field(256, 15, { max: 25, color: '#fff' });
    this.titleF = field(272, 15, { max: 25, color: '#000' });
    this.bodyF = field(270, 182, { max: 600, color: '#000' });
    const ta = document.createElement('textarea');
    ta.maxLength = 600; ta.spellcheck = false; ta.style.cssText = this.bodyF.el.style.cssText;
    Object.assign(ta.style, { resize: 'none', overflow: 'hidden', display: 'none' });
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    this.bodyF.el.replaceWith(ta); this.bodyF.el = ta;
    this.fields = [this.replyF, this.titleF, this.bodyF];
    this.reset();
    this.ready = mgr.assets.json('UI/GuildBBS.img').then((A) => { this.A = A?.GuildBBS; this.build(); return mgr.assets.preload(this.frames()); });
  }
  /** The buttons, each placed by its top-left corner. */
  build() {
    const A = this.A, at = (node, x, y, fn) => {
      const n = node?.normal?.[0] || node?.normal, o = n?.origin || [0, 0];
      return this.button(node, x + o[0], y + o[1], fn);
    };
    this.bg = A.backgrnd;
    this.noticeBtn = at(A.BtNotice, 404, 275, () => this.write(false, true));
    this.writeBtn = at(A.BtWrite, 540, 275, () => this.write(false, false));
    this.editBtn = at(A.BtRetouch, 602, 275, () => this.write(true, false));
    this.delBtn = at(A.BtDelete, 664, 275, () => this.deleteThread());
    this.replyBtn = at(A.BtReply, 704, 457, () => this.reply());
    this.replyDel = [0, 1, 2, 3].map((k) => at(A.BtReplyDelete, 688, REPLY_Y - 3 + k * ROW_H, () => this.deleteReply(k)));
    this.quitBtn = at(A.BtQuit, 680, 501, () => this.mgr.close(this));
    this.regBtn = at(A.BtRegister, 602, 275, () => this.register());
    this.cancelBtn = at(A.BtCancel, 664, 275, () => this.cancel());
    this.leftBtn = at(A.MoveEmoticon?.BtLeft, 405, 244, () => this.moveEmo(-1));
    this.rightBtn = at(A.MoveEmoticon?.BtRight, 700, 244, () => this.moveEmo(1));
  }
  frames() { return [...super.frames(), ...(this.A ? allCanvases(this.A) : [])]; }
  reset() {
    this.notice = null; this.threads = []; this.total = 0; this.page = 0;
    this.thread = null; this.shownId = 0; this.showing = false; this.writing = null;
    this.replyFirst = 0; this.bodyFirst = 0;
    this.emoSel = 0; this.emoIcon = 0; this.owned = [];
    for (const f of this.fields) f.value = '';
  }
  onOpen() {
    this.reset();
    this.ready.then(() => { if (this.mgr.isOpen('guildbbs')) this.g.net?.bbsList(this.page); });
  }
  onClose() { for (const f of this.fields) { f.show(false); f.el.blur(); } }
  key(e) { if (e.key === 'Escape') this.mgr.close(this); }

  get rank() { return this.g.guild?.members?.find((m) => m.id === this.g.player?.id)?.rank ?? 6; }
  memberName(id) { return this.g.guild?.members?.find((m) => m.id === id)?.name || ''; }
  emoticon(icon) { const E = this.A?.Emoticon; return icon < 3 ? E?.Basic?.[icon] : E?.Cash?.[icon - 100]; }
  width(ctx, s, bold = false) { ctx.save(); ctx.font = `${bold ? 'bold ' : ''}${FONT}`; const w = ctx.measureText(s).width; ctx.restore(); return Math.round(w); }

  // ---------------------------------------------------------------- server events
  onPacket(d) {
    if (d.op === 'list') { this.notice = d.notice; this.threads = d.threads.slice(0, PER_PAGE); this.total = d.total; return; }
    if (d.op === 'thread') {
      this.thread = d.thread; this.shownId = d.thread.id;
      this.replyFirst = Math.max(0, d.thread.replies.length - REPLY_ROWS);
      this.rebuild(); this.showing = true;
      return;
    }
    if (d.op === 'deleted') { this.mgr.notice(MSG.gone); this.thread = null; this.rebuild(); }
  }
  /** Back to reading: the editor goes, the reply box starts empty, and the thread shows once it comes. */
  rebuild() { this.writing = null; this.showing = false; this.bodyFirst = 0; this.replyF.value = ''; }

  // ---------------------------------------------------------------- actions
  /** Opens a thread (the notice is 0), with the list again. */
  show(id) { this.shownId = id; this.g.net?.bbsShow(id); this.g.net?.bbsList(this.page); }
  write(edit, notice) {
    if (notice && this.notice) { this.mgr.notice(MSG.notice); return; }
    this.owned = [];
    for (let n = 0; n < CASH_EMOTICONS; n++) if (this.g.itemCount(CASH_EMO_ITEM + n) > 0) this.owned.push(100 + n);
    const t = edit ? this.thread : null;
    this.emoSel = 0; this.emoIcon = 0;
    if (t && t.icon < 3) { this.emoSel = this.emoIcon = t.icon; }
    else if (t) { const k = this.owned.indexOf(t.icon); if (k >= 0) { this.emoSel = k + 3; this.emoIcon = t.icon; } }
    this.writing = { edit, notice };
    this.showing = false;
    this.titleF.value = t ? t.title : '';
    this.bodyF.value = t ? t.body.replace(/\r\n/g, '\n') : '';
  }
  async register() {
    const w = this.writing;
    if (!w) return;
    const title = this.titleF.value, body = this.bodyF.value;
    if (!title) { this.mgr.notice(MSG.title); return; }
    if (!body) { this.mgr.notice(MSG.text); return; }
    if (await this.g.cursed(title) || await this.g.cursed(body)) { this.mgr.notice(MSG.curse); return; }
    this.g.net?.bbsPost(w.edit, w.edit ? this.thread?.id ?? 0 : 0, w.notice, title, body.replace(/\r?\n/g, '\r\n'), this.emoIcon);
    this.page = 0;
    this.g.net?.bbsList(0);
  }
  cancel() { this.rebuild(); this.show(this.shownId); }
  async deleteThread() {
    const t = this.thread;
    if (!t || !(await this.mgr.confirm(MSG.del))) return;
    this.g.net?.bbsDelete(t.id);
    this.thread = null;
    this.g.net?.bbsList(this.page);
    this.rebuild();
  }
  async reply() {
    const t = this.thread;
    if (!t) return;
    const text = this.replyF.value;
    if (!text) { this.mgr.notice(MSG.text); return; }
    if (await this.g.cursed(text)) { this.mgr.notice(MSG.curse); return; }
    this.g.net?.bbsReply(t.id, text);
    this.g.net?.bbsList(this.page);
  }
  /** The reply is picked again once the question is answered, from where the list then stands. */
  async deleteReply(k) {
    if (!this.thread?.replies[this.replyFirst + k] || !(await this.mgr.confirm(MSG.del))) return;
    const t = this.thread, r = t?.replies[this.replyFirst + k];
    if (!r) return;
    this.g.net?.bbsReplyDelete(t.id, r.id);
    this.g.net?.bbsList(this.page);
  }
  moveEmo(d) {
    if (d < 0) { if (this.emoSel >= 1) this.emoSel -= 1; } else if (this.emoSel < this.owned.length + 2) this.emoSel += 1;
  }

  // ---------------------------------------------------------------- mouse
  pages(ctx) {
    const n = Math.trunc((this.total - 1) / PER_PAGE) + 1, first = Math.floor(this.page / PER_PAGE) * PER_PAGE;
    const labels = []; for (let i = first; i < Math.min(n, first + PER_PAGE); i++) labels.push(i);
    const widths = labels.map((i) => this.width(ctx, String(i + 1)));
    let x = Math.round(PAGE_X - (widths.reduce((a, b) => a + b, 0) + PAGE_GAP * (labels.length - 1)) / 2);
    return labels.map((i, k) => { const r = { i, x, w: widths[k] }; x += widths[k] + PAGE_GAP; return r; });
  }
  bodyLines(ctx) {
    if (!this.thread) return [];
    ctx.save(); ctx.font = FONT;
    const out = [];
    for (const line of wrapText(ctx, this.thread.body.replace(/\r\n/g, '\n'), BODY.w)) {
      let s = line;
      while (ctx.measureText(s).width > BODY.w && s.length > 1) {   // a word wider than the box breaks by letters
        let k = s.length - 1;
        while (k > 1 && ctx.measureText(s.slice(0, k)).width > BODY.w) k--;
        out.push(s.slice(0, k)); s = s.slice(k);
      }
      out.push(s);
    }
    ctx.restore();
    return out;
  }
  down(lx, ly) {
    if (!this.A) return;
    if (this.notice && lx >= LIST_L && lx < LIST_R && ly >= NOTICE_Y && ly < ROW0) { this.show(0); return; }
    if (lx >= LIST_L && lx < LIST_R && ly >= ROW0 && ly < ROW0 + this.threads.length * ROW_H) { this.show(this.threads[Math.floor((ly - ROW0) / ROW_H)].id); return; }
    if (this.writing && ly >= EMO_Y - 1 && ly < EMO_Y + 19) {
      for (let k = 0; k < 3; k++) if (lx >= EMO_BASIC_X - 1 + k * EMO_STEP && lx < EMO_BASIC_X + 19 + k * EMO_STEP) { this.emoSel = this.emoIcon = k; return; }
      for (let k = 0; k < this.owned.length; k++) if (lx >= EMO_CASH_X - 1 + k * EMO_STEP && lx < EMO_CASH_X + 19 + k * EMO_STEP) { this.emoSel = k + 3; this.emoIcon = this.owned[k]; return; }
    }
    const ctx = this.g.canvas.getContext('2d');
    for (const r of this.pages(ctx)) if (lx >= r.x && lx < r.x + r.w && ly >= PAGE_Y - 2 && ly < PAGE_Y + 14) { if (r.i !== this.page) { this.page = r.i; this.g.net?.bbsList(r.i); } return; }
    const V = this.mgr.B.VScr4, n = this.thread?.replies.length || 0;
    const rf = this.scrollClick(lx, ly, REPLY_BAR.x, REPLY_BAR.y, REPLY_BAR.h, this.replyFirst, n, REPLY_ROWS, V);
    if (rf !== null) { this.replyFirst = rf; return; }
    if (this.thread && !this.writing) {
      const bf = this.scrollClick(lx, ly, BODY.bar.x, BODY.bar.y, BODY.bar.h, this.bodyFirst, this.bodyLines(ctx).length, BODY.rows, V);
      if (bf !== null) this.bodyFirst = bf;
    }
  }

  // ---------------------------------------------------------------- frame
  draw(ctx) {
    if (!this.A) return;
    const writing = !!this.writing, t = this.thread, me = this.g.player?.id, boss = this.rank <= 2;
    for (const b of [this.noticeBtn, this.writeBtn, this.editBtn, this.delBtn, this.replyBtn]) b.visible = !writing;
    for (const b of [this.regBtn, this.cancelBtn, this.leftBtn, this.rightBtn]) b.visible = writing;
    this.noticeBtn.enabled = boss;
    this.editBtn.enabled = this.delBtn.enabled = !!t && (boss || t.writer === me);
    this.replyBtn.enabled = !!t;
    this.replyDel.forEach((b, k) => { const r = t?.replies[this.replyFirst + k]; b.visible = !writing && !!r && (boss || r.writer === me); });
    super.draw(ctx);
    this.placeFields();
  }
  placeFields() {
    const scale = this.g.canvas.clientWidth / UI_W, open = this.mgr.isOpen('guildbbs');
    const put = (f, x, y, on) => {
      f.show(on);
      if (!on) return;
      f.rect.x = this.x + x; f.rect.y = this.y + y;
      f.layout({ left: 0, top: 0 }, scale);
    };
    put(this.replyF, 424, 459, open && !!this.thread && !this.writing);
    put(this.titleF, 447, 30, open && !!this.writing);
    put(this.bodyF, 447, 55, open && !!this.writing);
    this.bodyF.el.style.lineHeight = `${BODY.line * scale}px`;
  }
  body(ctx) {
    const im = (n) => this.mgr.image(n), put = (n, x, y) => { const i = im(n); if (i) ctx.drawImage(i, x, y); };
    const A = this.A, g = this.g.guild;
    put(this.writing ? A.backgrnd3 : A.backgrnd2, PANEL_X, PANEL_Y);
    if (this.writing) this.drawEmoticons(put);
    if (g?.name) this.text(ctx, g.name, 58, 22, F1);
    if (!drawEmblem(ctx, this.g, g?.emblem, 20, 24)) put(this.mgr.W.UserList?.Guild?.GuildInfo?.guildmark, 20, 24);
    if (this.notice) this.row(ctx, this.notice, NOTICE_Y, put);
    this.threads.forEach((t, i) => this.row(ctx, t, ROW0 + i * ROW_H, put));
    for (const r of this.pages(ctx)) this.text(ctx, String(r.i + 1), r.x, PAGE_Y, r.i === this.page ? F5 : F1);
    if (this.thread && !this.writing) this.drawBody(ctx);
    if (this.showing && this.thread) this.drawThread(ctx);
    this.scrollbar(ctx, REPLY_BAR.x, REPLY_BAR.y, REPLY_BAR.h, this.replyFirst, this.thread?.replies.length || 0, REPLY_ROWS, this.mgr.B.VScr4);
  }
  row(ctx, t, y, put) {
    const ty = y + 8, subject = `${t.id ? t.id : ''} ${t.title}`;
    this.text(ctx, subject, 26, ty, F1);
    if (t.replies) this.text(ctx, `[${t.replies}]`, 28 + this.width(ctx, subject), ty, F5);
    const name = this.memberName(t.writer);
    if (name) {
      ctx.save(); ctx.font = FONT; const n = cutText(ctx, name, 70); ctx.restore();
      this.text(ctx, n, Math.trunc((66 - this.width(ctx, n)) / 2) + 257, ty, F1);
    }
    this.text(ctx, shortDate(t.time), 332, ty, F2);
    put(this.emoticon(t.icon), 237, y + 5);
  }
  drawThread(ctx) {
    const t = this.thread;
    this.text(ctx, t.title, Math.trunc((300 - this.width(ctx, t.title, true)) / 2) + 409, 36, { ...F1, bold: true });
    const name = this.memberName(t.writer);
    if (name) this.text(ctx, name, 445, 63, F2);
    this.text(ctx, longDate(t.time), 576, 63, F2);
    for (let k = 0; k < REPLY_ROWS; k++) {
      const r = t.replies[this.replyFirst + k];
      if (!r) break;
      const y = REPLY_Y + k * ROW_H, rn = this.memberName(r.writer);
      if (rn) this.text(ctx, rn, Math.trunc((76 - this.width(ctx, rn)) / 2) + 399, y, F2);
      this.text(ctx, r.text, 480, y, F2);
      this.text(ctx, shortDate(r.time), 654, y, F2);
    }
  }
  drawBody(ctx) {
    const lines = this.bodyLines(ctx);
    this.bodyFirst = Math.min(this.bodyFirst, Math.max(0, lines.length - BODY.rows));
    lines.slice(this.bodyFirst, this.bodyFirst + BODY.rows).forEach((s, i) => this.text(ctx, s, BODY.x, BODY.y + i * BODY.line, F1));
    if (lines.length > BODY.rows) this.scrollbar(ctx, BODY.bar.x, BODY.bar.y, BODY.bar.h, this.bodyFirst, lines.length, BODY.rows, this.mgr.B.VScr4);
  }
  drawEmoticons(put) {
    const E = this.A.Emoticon;
    for (let k = 0; k < 3; k++) put(E?.Basic?.[k], EMO_BASIC_X + k * EMO_STEP, EMO_Y);
    this.owned.forEach((icon, k) => put(E?.Cash?.[icon - 100], EMO_CASH_X + k * EMO_STEP, EMO_Y));
    const x = this.emoSel < 3 ? EMO_BASIC_X + this.emoSel * EMO_STEP : EMO_CASH_X + (this.emoSel - 3) * EMO_STEP;
    put(E?.Select, x - 2, EMO_Y - 2);
  }
}
