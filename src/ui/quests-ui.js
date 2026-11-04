import { localTalk, npcTalk } from './dialogs.js';

/** One NPC-style dialog page shown by the client itself. Resolves with the clicked button label. */
export function localDialog(game, npcId, text, buttons) {
  return localTalk(game.windows, npcId, String(text), buttons);
}

const SECTION = (n) => `\r\n\r\n#fUI/UIWindow.img/UtilDlgEx/list${n}#\r\n`;
const pos = (game) => ({ x: Math.round(game.player.x), y: Math.round(game.player.y) });

/** The script an NPC runs today: info/script/<n> whose start..end (YYYYMMDD) covers the date. */
function npcScript(game, npc) {
  const set = game.npcScripts?.get(Number(npc.spawn.id));
  if (set) return set;
  const today = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const list = Object.values(npc.src?.info?.script || {}).filter((s) => s?.script);
  return list.find((s) => (Number(s.start) || 19000101) <= today && today <= (Number(s.end) || 20790101))?.script || null;
}

/**
 * Clicking an NPC that has quests. The menu is the NPC's d0 (or its quest/<qid> line once that quest is done), then
 * list3 "QUEST THAT CAN BE COMPLETED", list1 "QUEST AVAILABLE", list0 "QUEST IN PROGRESS" and, for an NPC with a
 * script, list2 "ETC" (worded by Etc/ScriptInfo.img, else the script's name).
 */
export async function npcQuestMenu(game, npc, q) {
  const book = game.quests, npcId = Number(npc.spawn.id), str = game.windows.strings.npc?.[npcId] || {};
  const script = npcScript(game, npc);
  const talk = () => game.net.npcTalk(npc.oid, { x: Math.round(npc.x), y: Math.round(npc.y) });
  let head = str.d0 || '';
  for (const [qid, line] of Object.entries(str.quest || {})) if (book.status(Number(qid)) === 2 && line) { head = line; break; }
  // nothing to offer: an NPC with a script asks the server; one without answers by itself, nothing sent, with its
  // d1 once every one of its quests is done, else its d0 greeting
  if (!q.start.length && !q.progress.length && !q.complete.length) {
    const line = q.done >= q.all ? str.d1 || head : head;
    if (!script && line) await localDialog(game, npcId, line, ['OK', 'End Chat']);
    else talk();
    return;
  }
  const choices = [];
  let text = head;
  const line = (id, suffix) => {
    if (!book.info[id]) return;
    const type = book.info[id].type ? `#r#e${book.info[id].type}#d#n` : '';
    text += `#d#L${choices.length}# ${type}${book.name(id)}${suffix}#l#k\r\n`;
    choices.push(id);
  };
  const section = (n, ids, suffix) => { if (ids.some((id) => book.info[id])) { text += SECTION(n); for (const id of ids) line(id, suffix); } };
  section(3, q.complete, ' (Pre-completion enabled)');
  section(1, q.start, '');
  section(0, q.progress, ' (In Progress)');
  if (script) {
    const info = await game.assets.json('Etc/ScriptInfo.img');
    text += `${SECTION(2)}#d#L${choices.length}# ${info?.[script] || script}#l#k\r\n`;
  }
  if (!choices.length) { talk(); return; }
  const r = await npcTalk(game.windows, { npc: npcId, type: 4, text });
  if (r.action !== 1 || r.sel === null || r.sel === undefined) return;
  if (r.sel >= choices.length) { talk(); return; }
  await questFlow(game, npc, choices[r.sel]);
}

/** Pages of lines with Prev / Next (OK on the last). Resolves true when paged through, false when closed. */
export async function playQuestLines(game, npcId, lines) {
  for (let i = 0; i < lines.length; i++) {
    const last = i === lines.length - 1;
    const b = await localDialog(game, npcId, String(lines[i]), [...(last ? ['OK'] : ['Next']), ...(i > 0 ? ['Prev'] : []), 'End Chat']);
    if (b === 'End Chat') return false;
    if (b === 'Prev') { i -= 2; continue; }
  }
  return true;
}

/**
 * A quest picked at an NPC (or offered next by the server): its "not yet" lines when it can't be handed in yet,
 * a scripted start / end, or its Say.img lines ending in Accept / Decline (start) or the reward page (end).
 */
export async function questFlow(game, npc, id) {
  const book = game.quests, npcId = Number(npc.spawn.id), st = book.status(id);
  const where = book.isAuto(id) ? null : pos(game);
  if (st === 1) {
    const why = book.completeBlock(id, game.textCtx(), npcId);
    if (why) { await notYet(game, npcId, id, why); return; }
  }
  const phase = st === 1 ? '1' : '0';
  if (phase === '0' && book.isScripted(id, '0')) { game.net.questAction(4, id, npcId, pos(game)); return; }
  if (phase === '1' && book.isScripted(id, '1')) { game.net.questAction(5, id, npcId, pos(game)); return; }
  if (phase === '0' && book.isAutoAccept(id)) { game.net.questAction(1, id, npcId, where); return; }
  const d = book.dialogue(id, phase);
  if (phase === '0') {
    if (!(await askLines(game, npcId, id, d, phase))) return;
    if (d.lines.length) {
      const b = await localDialog(game, npcId, d.lines[d.lines.length - 1], ['Accept', 'Decline', 'End Chat']);
      if (b === 'End Chat') return;
      if (b === 'Decline') { if (d.no.length) await playQuestLines(game, npcId, d.no); return; }
    }
    game.net.questAction(1, id, npcId, where);
    return;
  }
  if (!(await askLines(game, npcId, id, d, phase))) return;
  const sel = d.lines.length ? await rewardPage(game, npcId, id, d.lines[d.lines.length - 1]) : -1;
  if (sel === null) return;
  game.net.questAction(2, id, npcId, pos(game), sel);   // with a position, so the choice isn't read as one
}

/** Every line but the last, with Prev / Next; an 'ask' quest's #L choices are checked against stop/<line>/<choice>. */
async function askLines(game, npcId, id, d, phase) {
  const n = d.lines.length - 1;
  for (let i = 0; i < n; i++) {
    const text = String(d.lines[i]);
    if (d.ask && text.includes('#L0#')) {
      const r = await npcTalk(game.windows, { npc: npcId, type: 4, text });
      const stop = d.stop?.[i];
      if (r.action !== 1 || r.sel === null || r.sel === undefined || !stop) return false;
      const wrong = stop[r.sel];
      if (wrong) { await localDialog(game, npcId, wrong, ['OK']); return false; }
      continue;
    }
    const b = await localDialog(game, npcId, text, ['Next', ...(i > 0 ? ['Prev'] : []), 'End Chat']);
    if (b === 'End Chat') return false;
    if (b === 'Prev') i -= 2;
  }
  return true;
}

/**
 * The last completion line with what you get under it: choose-one items (QuestIcon/3) as choices, then QuestIcon/4
 * with the items, skills, mesos, EXP, fame and closeness. Resolves with the chosen index, -1 for none, null if closed.
 */
async function rewardPage(game, npcId, id, last) {
  const r = game.quests.rewards(id, game.stats);
  let text = `${last}#w`;
  const any = r.fixed.length || r.skills.length || r.meso || r.exp || r.fame || r.closeness || r.random.length;
  if (r.choose.length) {
    text += '\r\n\r\n#fUI/UIWindow.img/QuestIcon/3/0#\r\n';
    r.choose.forEach((it, i) => { text += `#L${i}##v${it.id}:# #t${it.id}:# ${it.count}#l\r\n`; });
  }
  if (r.choose.length || (any && !r.next)) {
    text += '\r\n\r\n#fUI/UIWindow.img/QuestIcon/4/0#\r\n';
    for (const it of r.fixed) text += `#v${it.id}:# #t${it.id}:# ${it.count}\r\n`;
    for (const sk of r.skills) text += `#s${sk.id}:# #q${sk.id}:# \r\n`;
    text += '\r\n';
    if (r.meso) text += `#fUI/UIWindow.img/QuestIcon/7/0# ${r.meso} Meso\r\n`;
    if (r.exp) text += `#fUI/UIWindow.img/QuestIcon/8/0# ${r.exp} exp\r\n`;
    if (r.fame) text += `#fUI/UIWindow.img/QuestIcon/6/0# ${r.fame}\r\n`;
    if (r.closeness) text += `#fUI/UIWindow.img/QuestIcon/9/0# ${r.closeness}\r\n`;
    if (r.random.length) text += '#FUI/UIWindow.img/QuestIcon/5/0#\r\n';
  }
  text = text.replace(/#w/g, '');
  if (r.choose.length) {
    const a = await npcTalk(game.windows, { npc: npcId, type: 4, text });
    return a.action === 1 && a.sel !== null && a.sel !== undefined ? a.sel : null;
  }
  const b = await localDialog(game, npcId, text, ['OK', 'End Chat']);
  return b === 'End Chat' ? null : -1;
}

/**
 * Why it can't be handed in yet: Say.img/<id>/1/stop/<npc|item|quest|info|mob>, else stop/default, else the NPC's d0.
 * At the wrong NPC, quest items you were given and have lost come first (the "lost" lines, then QUEST_ACTION 0).
 */
async function notYet(game, npcId, id, why) {
  const book = game.quests, d = book.dialogue(id, '1'), stop = d.stop || {};
  if (why === 'nopet') { await game.windows.notice('Unable to complete the quest\ndue to a lack of pet.\nPlease try again after summoning a pet.'); return; }
  if (why === 'pet') { await game.windows.notice('Unable to complete the quest\nwith the current pet you have summoned.\nPlease try again with a pet\nthat meets the quest requirement.'); return; }
  const lines = (v) => (typeof v === 'string' ? [v] : v ? Object.keys(v).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => v[k]) : []);
  const fallback = () => { const l = lines(stop.default); return l.length ? l : [game.windows.strings.npc?.[npcId]?.d0].filter(Boolean); };
  const pages = (key) => { const l = lines(stop[key]); return l.length ? l : fallback(); };
  if (why === 'npc') {
    const ctx = game.textCtx();
    const lost = lines(book.act[id]?.['0']?.item).filter((it) => (it.count ?? 0) >= 1 && book.held(ctx, it.id) < it.count).map((it) => it.id);
    if (lost.length) {
      const talk = d.lost.length ? d.lost : pages('npc');
      if (talk.length && await playQuestLines(game, npcId, talk)) game.net.questRestore(id, lost);
      return;
    }
  }
  const key = { npc: 'npc', item: 'item', quest: 'quest', info: 'info', mob: 'mob' }[why] || 'default';
  const say = key === 'default' ? fallback() : pages(key);
  if (say.length) await playQuestLines(game, npcId, say);
}
