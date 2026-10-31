import { localTalk, npcMenu } from './dialogs.js';

/** One NPC-style dialog page shown by the client itself. Resolves with the clicked button label. */
export function localDialog(game, npcId, text, buttons) {
  return localTalk(game.windows, npcId, String(text), buttons);
}

/**
 * Clicking an NPC that has quests: choose between its script and its quests, in the client's sections,
 * each under its UtilDlgEx title: list1 "QUEST AVAILABLE" first, as in the client, then list3 "QUEST THAT CAN BE
 * COMPLETED", list0 "QUEST IN PROGRESS", list2 "ETC" (talking to the NPC).
 */
const HEAD = (n) => ({ header: `UI/UIWindow.img/UtilDlgEx/list${n}` });
/**
 * ETC: only NPCs with a script (Npc.img info/script) offer one, worded by Etc/ScriptInfo.img
 * under the script's name ("medal_rank" -> "I want to see the medal rankings.").
 */
async function talkSection(game, npc) {
  const script = npc.src?.info?.script?.[0]?.script;
  if (!script) return [];
  const info = await game.assets.json('Etc/ScriptInfo.img');
  return [HEAD(2), { talk: true, label: `#d${info?.[script] || `Talk to ${npc.name}.`}#k` }];
}
export async function npcQuestMenu(game, npc, q) {
  const book = game.quests;
  const section = (n, rows) => (rows.length ? [HEAD(n), ...rows] : []);
  const choices = [
    ...section(1, q.start.map((id) => ({ start: id, label: `#d${book.name(id)}#k` }))),
    ...section(3, q.complete.map((id) => ({ complete: id, label: `#d${book.name(id)}#k` }))),
    ...section(0, q.progress.map((id) => ({ progress: id, label: `#d${book.name(id)} (In Progress)#k` }))),
    ...(await talkSection(game, npc))];
  // it opens with the NPC's own greeting (String/Npc.img d0), as the client does
  const greet = game.windows.strings.npc?.[npc.spawn.id]?.d0 || `What would you like to do with #b${npc.name}#k?`;
  const i = await npcMenu(game.windows, npc.spawn.id, greet, choices.map((c) => (c.header ? c : c.label)));
  const choice = i === null ? null : choices[i];
  if (!choice) return;
  if (choice.talk) game.net.npcTalk(npc.oid, { x: Math.round(npc.x), y: Math.round(npc.y) });
  else if (choice.start) await startQuest(game, npc, choice.start);
  else if (choice.complete) await completeQuest(game, npc, choice.complete);
  else if (choice.progress) await progressTalk(game, npc, choice.progress);
}

function pos(game) { return { x: Math.round(game.player.x), y: Math.round(game.player.y) }; }

async function playLines(game, npcId, lines, lastButtons) {
  for (let i = 0; i < lines.length; i++) {
    const last = i === lines.length - 1;
    const b = await localDialog(game, npcId, String(lines[i]), last ? lastButtons : (i > 0 ? ['Next', 'Prev', 'End Chat'] : ['Next', 'End Chat']));
    if (b === 'End Chat') return null;
    if (b === 'Prev') { i -= 2; continue; }
    if (last) return b;
  }
  return lastButtons[0];
}

export async function startQuest(game, npc, id) {
  const book = game.quests;
  if (book.isScripted(id, '0')) { game.net.questAction(4, id, npc.spawn.id, pos(game)); return; }
  const d = book.dialogue(id, '0');
  const lines = d.lines.length ? d.lines : [book.info[id]?.['0'] || book.name(id)];
  const hasChoice = d.yes.length || d.no.length;
  const b = await playLines(game, npc.spawn.id, lines, hasChoice ? ['Accept', 'Decline'] : ['OK', 'End Chat']);
  if (!b || b === 'End Chat') return;
  if (b === 'Decline') { if (d.no.length) await playLines(game, npc.spawn.id, d.no, ['OK']); return; }
  game.net.questAction(1, id, npc.spawn.id, pos(game));
  if (d.yes.length) await playLines(game, npc.spawn.id, d.yes, ['OK']);
}

export async function completeQuest(game, npc, id) {
  const book = game.quests;
  if (book.isScripted(id, '1')) { game.net.questAction(5, id, npc.spawn.id, pos(game)); return; }
  const d = book.dialogue(id, '1');
  const lines = d.lines.length ? d.lines : [book.info[id]?.['2'] || `${book.name(id)} complete.`];
  const b = await playLines(game, npc.spawn.id, lines, ['OK']);
  if (!b) return;
  game.net.questAction(2, id, npc.spawn.id, pos(game));
}

async function progressTalk(game, npc, id) {
  const d = game.quests.dialogue(id, '1');
  const stop = d.stop?.item?.[0] || d.stop?.mob?.[0] || d.stop?.[0] || game.quests.info[id]?.['1'] || 'You have not finished yet.';
  await localDialog(game, npc.spawn.id, String(stop), ['OK']);
}
