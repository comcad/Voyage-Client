/**
 * MOBILE UI's look for the client's conversations, message boxes, shops, trades and notices, in its glass style:
 *   - NPC and quest conversations: a panel over the status line, the speaker standing on the left (on the right when
 *     you or another speaker talk) with its name under it, the words with the game's own names, pictures and icons,
 *     choices as rows to tap, a box for a number or a line to type, and the page's buttons (Prev / Next / OK, Yes /
 *     No, Accept / Decline, End Chat);
 *   - message boxes (notices, questions, how many): a card in the middle, a number with - / + / Max beside it;
 *   - NPC shops: the shopkeeper standing on the left, the goods and your items side by side, and the one picked
 *     under them with its description and BUY, or SELL and RECHARGE;
 *   - trades: a panel on the left (your inventory opens on the right, to offer from): your partner's offer and
 *     yours, the mesos, who has confirmed, the trade's chat, TRADE and Cancel;
 *   - Maple Messenger: a panel on the left with the three seats (who sits there, standing), the room's chat, who is
 *     typing, and a line to type on; Invite, Report and Leave;
 *   - the Quest Helper: a little tracker under the buttons (folding as its menu entry folds it), each quest's
 *     objectives with how far along they are;
 *   - the World Map (Find NPC's too): a large panel with the map as the window draws it, tapped to go into a region
 *     or to see a spot's name, Back up a level;
 *   - a player's info (a double tap on them): who they are, standing, with Party, Trade, Family and fame, and their
 *     equipment, wish list, pets, mount and Monster Book;
 *   - invitations and notices (trade, party, guild, buddy, messenger, family, parcels, notes, quests): cards at the
 *     top with their own buttons, fading in and out as the balloons do.
 * The client's own windows stay open behind them and do all the work (WindowManager.skin keeps them from drawing or
 * taking the pointer), so every answer, check and prompt is theirs; only the look and the place differ. Should one of
 * its views fail on what it is given, that window goes back to the client's own look rather than to nothing, and the
 * rest carry on.
 */
import { settings } from '../settings.js';
import { invType, itemDesc } from '../data.js';
import { drawParts } from '../character.js';
import { sfx } from '../audio.js';
import { NpcDialog, UtilBox, ShopWin, textRef, potionPrice } from './dialogs.js';
import { TradeWin } from './trade.js';
import { StorageWin } from './storage.js';
import { Balloon, QuestNotice } from './notifier.js';
import { MessengerWin } from './messenger.js';
import { QuestAlarmWin } from './questalarm.js';
import { WorldMapWin, MAP_BOX } from './worldmap.js';
import { CharInfoWin } from './social.js';
import { jobName } from '../data.js';
import { richText, LIGHT_COLORS } from './richtext.js';

/** The message boxes shown as cards (all of them, their name and group lists too). */
const BOX_KINDS = new Set(['ok', 'okcancel', 'okcancelLeft', 'quantity', 'text', 'whisper', 'buddy', 'group']);
const SELL_TABS = [[1, 'Equip'], [2, 'Use'], [3, 'Set-up'], [4, 'Etc'], [5, 'Cash']];
/** The trade log's colours (made for the window's white log) on the dark glass. */
const LOG_COLORS = { '#000': '#e8edf8', '#000000': '#e8edf8', '#555': 'rgba(225, 232, 248, 0.6)', '#0047b3': '#8cc2ff', '#006699': '#7fd4ff',
  '#ff2020': '#ff9a9a', '#336600': '#a6f08a' };
const TEXT = { base: '#eef2fb', colors: LIGHT_COLORS, size: 12 };
const X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const CSS = `
.mhud .mh-skins { position: absolute; inset: 0; pointer-events: none; }
.mhud .mh-skins input { -webkit-user-select: text; user-select: text; }
.mhud .mh-sp { flex: 1; }
.mhud .mh-in { flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(0, 0, 0, 0.4);
  color: #fff; font: 14px -apple-system, "Segoe UI", system-ui, sans-serif; outline: none; }
.mhud .mh-in:focus { border-color: rgba(255, 210, 94, 0.6); }
.mhud .mh-ln { white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.45em; }
.mhud .mh-skins .mh-pic { display: inline-block; vertical-align: middle; margin: 4px 6px 3px 0; image-rendering: pixelated; }
.mhud .mh-skins .mh-ic { width: 32px; height: 32px; object-fit: none; vertical-align: middle; image-rendering: pixelated; }
.mhud .mh-ico { position: relative; flex: none; width: 36px; height: 36px; border-radius: 8px; background: rgba(0, 0, 0, 0.3);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07); display: grid; place-items: center; }
.mhud .mh-ico b { position: absolute; right: 2px; bottom: 0; font-size: 9.5px; font-weight: 800; text-shadow: 0 0 2px #000, 0 0 2px #000; }
.mhud .mh-skins .mh-coin { width: auto; height: auto; max-height: 13px; object-fit: contain; vertical-align: -2px; margin-right: 4px; image-rendering: pixelated; }
.mhud .mh-name { max-width: 100%; padding: 2px 9px; border-radius: 9px; font-size: 11px; font-weight: 800; color: #ffd978; background: rgba(0, 0, 0, 0.35);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-stage { position: relative; flex: none; width: 108px; height: 112px; border-radius: 10px;
  background: radial-gradient(ellipse 60% 20% at 50% 90%, rgba(0, 0, 0, 0.45), transparent 70%),
    radial-gradient(ellipse at 50% 70%, rgba(255, 226, 150, 0.2), transparent 65%), linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.22));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
.mhud .mh-stage img, .mhud .mh-stage canvas { position: absolute; image-rendering: pixelated; pointer-events: none; }
@keyframes mh-rise { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes mh-page { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes mh-pop { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: none; } }
@keyframes mh-fade { from { opacity: 0; } to { opacity: 1; } }

/* a conversation */
.mhud .mh-nd { position: absolute; left: 50%; bottom: calc(52px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 1;
  width: min(620px, calc(100% - 24px - env(safe-area-inset-left) - env(safe-area-inset-right))); min-height: 150px;
  max-height: calc(100% - 62px - env(safe-area-inset-bottom)); display: none; gap: 10px; padding: 10px 10px 10px 8px; pointer-events: auto; }
.mhud .mh-nd.mh-open { display: flex; animation: mh-rise 0.24s cubic-bezier(0.2, 0.85, 0.25, 1); }
.mhud .mh-nd.mh-stale { opacity: 0.55; pointer-events: none; transition: opacity 0.2s; }
.mhud .mh-nd.mh-mirror { flex-direction: row-reverse; padding: 10px 8px 10px 10px; }
.mhud .mh-nd-side { flex: none; width: 108px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 5px; }
.mhud .mh-nd-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.mhud .mh-nd-text { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 4px 4px 2px; font-size: 12.5px; line-height: 1.45; color: #eef2fb;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.mhud .mh-nd-text.mh-page { animation: mh-page 0.2s ease; }
.mhud .mh-nd-opt { position: relative; min-height: 32px; margin: 3px 0; padding: 6px 10px 6px 24px; border-radius: 9px; background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); cursor: pointer; white-space: pre-wrap; overflow-wrap: anywhere; }
.mhud .mh-nd-opt::before { content: ''; position: absolute; left: 10px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%;
  background: #f0b22e; box-shadow: 0 0 6px rgba(240, 178, 46, 0.6); }
.mhud .mh-nd-opt:active { background: rgba(255, 210, 94, 0.22); }
.mhud .mh-nd-field { flex: none; display: flex; gap: 6px; padding-top: 6px; }
.mhud .mh-nd-btns { flex: none; display: flex; gap: 6px; align-items: center; padding-top: 8px; }

/* a message box */
.mhud .mh-bx-dim { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; background: rgba(4, 8, 18, 0.38); pointer-events: auto;
  animation: mh-fade 0.15s ease; }
.mhud .mh-bx { width: min(300px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 10px; padding: 14px 14px 12px;
  animation: mh-pop 0.18s cubic-bezier(0.2, 0.85, 0.25, 1); }
.mhud .mh-bx-text { max-height: 50vh; overflow-y: auto; font-size: 12.5px; line-height: 1.45; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; }
.mhud .mh-bx-text.mh-left { text-align: left; }
.mhud .mh-bx-row { display: flex; gap: 6px; align-items: center; }
.mhud .mh-bx-btns { display: flex; gap: 6px; justify-content: flex-end; }
.mhud .mh-step { flex: none; width: 30px; height: 30px; padding: 0; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.09);
  color: #fff; font: 800 16px/1 system-ui, sans-serif; cursor: pointer; }

/* invitations and notices */
.mhud .mh-toasts { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); width: min(300px, calc(100% - 24px)); z-index: 3;
  display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.mhud .mh-toast { display: flex; align-items: center; gap: 8px; padding: 6px 7px 6px 9px; pointer-events: auto; }
.mhud .mh-toast.mh-closing { pointer-events: none; }
.mhud .mh-toast > img { flex: none; width: 24px; height: 24px; object-fit: none; image-rendering: pixelated; }
.mhud .mh-toast-text { flex: 1; min-width: 0; font-size: 11px; line-height: 1.3; }
.mhud .mh-toast-text b, .mhud .mh-toast-text span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-toast-text b { font-weight: 800; }
.mhud .mh-toast-text span { color: rgba(225, 232, 248, 0.7); }
.mhud .mh-toast .mh-cta { height: 26px; padding: 0 10px; font-size: 11px; }

/* a shop */
.mhud .mh-shop { position: absolute; left: 50%; top: 6px; bottom: calc(50px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 1;
  width: min(780px, calc(100% - 12px - env(safe-area-inset-left) - env(safe-area-inset-right))); display: flex; gap: 8px; padding: 8px; pointer-events: auto;
  animation: mh-fade 0.2s ease; }
.mhud.mh-shopping .mh-mm, .mhud.mh-shopping .mh-act, .mhud.mh-shopping .mh-menu { display: none; }
.mhud .mh-shop-side { flex: none; width: 100px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.mhud .mh-shop-side .mh-stage { width: 100px; height: 104px; }
.mhud .mh-shop-side .mh-stage img { transform: scaleX(-1); }
.mhud .mh-shop-meso { max-width: 100%; display: flex; align-items: center; padding: 3px 8px; border-radius: 10px; background: rgba(0, 0, 0, 0.3);
  font-size: 11px; font-weight: 800; white-space: nowrap; overflow: hidden; }
.mhud .mh-shop-side .mh-cta { width: 100%; }
/* the storage: laid out as the shop, the keeper as it stands, each list's mesos at its foot */
.mhud .mh-store .mh-shop-side .mh-stage img { transform: none; }
.mhud .mh-st-count { font-size: 10px; font-weight: 700; color: rgba(225, 232, 248, 0.55); padding-right: 9px; }
.mhud .mh-st-meso { flex: none; display: flex; align-items: center; gap: 6px; padding: 5px 6px 6px 9px; border-top: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 11px; font-weight: 800; white-space: nowrap; }
.mhud .mh-st-meso span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.mhud .mh-st-meso .mh-cta { flex: none; height: 24px; padding: 0 10px; font-size: 10.5px; }
.mhud .mh-shop-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.mhud .mh-shop-lists { flex: 1; min-height: 0; display: flex; gap: 8px; }
.mhud .mh-shop-col { flex: 1; min-width: 0; display: flex; flex-direction: column; border-radius: 10px; background: rgba(0, 0, 0, 0.18);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.mhud .mh-shop-top { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 0 0 9px; }
.mhud .mh-shop-h { flex: none; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: rgba(240, 190, 80, 0.85); }
.mhud .mh-shop-top .mh-sh-tabs { flex: 1; min-width: 0; padding: 0 6px 6px 0; }
.mhud .mh-shop-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 5px 5px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.mhud .mh-shop-list .mh-li-sub s { opacity: 0.55; }
.mhud .mh-shop-list .mh-li-sub .mh-sale { font-style: normal; font-weight: 800; color: #ff8a8a; }
.mhud .mh-shop-foot { flex: none; display: flex; align-items: center; gap: 9px; min-height: 50px; padding: 6px 8px; border-radius: 10px;
  background: rgba(0, 0, 0, 0.22); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.mhud .mh-shop-ft { flex: 1; min-width: 0; }
.mhud .mh-shop-ft b { display: block; font-size: 12px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-shop-ft span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 10.5px; line-height: 1.3;
  color: rgba(225, 232, 248, 0.7); }
.mhud .mh-shop-hint { flex: 1; text-align: center; font-size: 11px; color: rgba(225, 232, 248, 0.5); }

/* a trade */
.mhud .mh-tr { position: absolute; left: calc(6px + env(safe-area-inset-left)); top: 6px; bottom: calc(6px + env(safe-area-inset-bottom)); z-index: 1;
  width: min(340px, calc(100% - min(400px, 62%) - 18px - env(safe-area-inset-left)));
  display: flex; flex-direction: column; gap: 6px; padding: 8px; pointer-events: auto; animation: mh-fade 0.2s ease; }
.mhud.mh-trading .mh-mm, .mhud.mh-trading .mh-st { display: none; }
.mhud .mh-tr-head { flex: none; display: flex; align-items: center; gap: 8px; padding-left: 4px; }
.mhud .mh-tr-tip { flex: 1; min-width: 0; font-size: 10.5px; color: rgba(225, 232, 248, 0.8); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-tr-sides { flex: none; display: flex; gap: 6px; }
.mhud .mh-tr-side { flex: 1; min-width: 0; padding: 6px; border-radius: 10px; background: rgba(0, 0, 0, 0.2); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  transition: box-shadow 0.2s; }
.mhud .mh-tr-side.mh-ok { box-shadow: inset 0 0 0 2px #ffd25e, 0 0 10px rgba(255, 210, 94, 0.35); }
.mhud .mh-tr-who { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; font-size: 11px; white-space: nowrap; }
.mhud .mh-tr-who b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 800; }
.mhud .mh-tr-who em { flex: none; font-style: normal; font-size: 9px; font-weight: 800; padding: 1px 6px; border-radius: 6px; color: #2e1d00;
  background: linear-gradient(180deg, #ffe58a, #f0b22e); }
.mhud .mh-tr-grid { display: grid; grid-template-columns: repeat(3, 36px); gap: 3px; justify-content: center; }
.mhud .mh-tr-meso { margin-top: 5px; display: flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 8px; background: rgba(0, 0, 0, 0.28);
  font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; }
.mhud .mh-tr-log { flex: 1; min-height: 36px; overflow-y: auto; padding: 5px 8px; border-radius: 9px; background: rgba(0, 0, 0, 0.25); font-size: 10.5px;
  line-height: 1.35; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.mhud .mh-tr-log div { overflow-wrap: anywhere; }
.mhud .mh-tr-say, .mhud .mh-tr-btns { flex: none; display: flex; gap: 6px; }
.mhud .mh-tr-btns .mh-cta { flex: 1; }

/* Maple Messenger */
.mhud .mh-ms { position: absolute; left: calc(6px + env(safe-area-inset-left)); top: 6px; bottom: calc(54px + env(safe-area-inset-bottom)); z-index: 1;
  width: min(330px, 42%); display: flex; flex-direction: column; gap: 6px; padding: 8px; pointer-events: auto; animation: mh-fade 0.2s ease; }
.mhud .mh-ms.mh-folded { bottom: auto; }
.mhud .mh-ms.mh-folded > :not(.mh-tr-head) { display: none; }
.mhud.mh-messaging .mh-mm { display: none; }
.mhud .mh-ms-fold { width: 26px; height: 26px; font-weight: 900; font-size: 15px; }
.mhud .mh-ms-seats { flex: none; display: flex; gap: 6px; }
.mhud .mh-ms-seat { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 2px 5px;
  border-radius: 10px; background: rgba(0, 0, 0, 0.22); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.mhud .mh-ms-seat canvas { width: 64px; height: 70px; image-rendering: pixelated; }
.mhud .mh-ms-seat b { max-width: 100%; font-size: 10.5px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-ms-seat.mh-me b { color: #ffd978; }
.mhud .mh-ms-seat.mh-empty-seat b { color: rgba(225, 232, 248, 0.4); font-weight: 600; }
.mhud .mh-ms-seat i { position: absolute; top: 3px; right: 7px; font-style: normal; font-size: 16px; font-weight: 900; color: #fff; animation: mhud-pulse 0.9s ease-in-out infinite; }
.mhud .mh-ms-typing { flex: none; min-height: 13px; font-size: 10px; color: rgba(225, 232, 248, 0.65); }

/* the Quest Helper */
.mhud .mh-qa { position: absolute; right: 4px; top: 50px; width: 236px; max-height: calc(100% - 112px - env(safe-area-inset-bottom)); display: flex;
  flex-direction: column; padding: 5px 6px 6px 9px; pointer-events: auto; }
.mhud.mh-sheeting .mh-qa, .mhud.mh-shopping .mh-qa, .mhud .mh-menu.mh-open ~ .mh-skins .mh-qa { display: none; }
.mhud .mh-qa-head { flex: none; display: flex; align-items: center; gap: 5px; }
.mhud .mh-qa-head b { font-size: 11px; font-weight: 800; white-space: nowrap; }
.mhud .mh-qa-auto { flex: none; padding: 2px 7px; border-radius: 8px; font-size: 9px; font-weight: 800; color: rgba(225, 232, 248, 0.7); background: rgba(255, 255, 255, 0.08); cursor: pointer; }
.mhud .mh-qa-auto.mh-on { color: #2e1d00; background: linear-gradient(180deg, #ffe58a, #f0b22e); }
.mhud .mh-qa .mh-btn { width: 22px; height: 22px; font-weight: 900; font-size: 13px; }
.mhud .mh-qa .mh-btn svg { width: 11px; height: 11px; }
.mhud .mh-qa-body { flex: 1; min-height: 0; overflow-y: auto; margin-top: 4px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.mhud .mh-qa.mh-folded .mh-qa-body { display: none; }
.mhud .mh-qa-q { display: flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 11px; font-weight: 800; color: #ffd978; }
.mhud .mh-qa-q.mh-auto { color: #9fc6ff; }
.mhud .mh-qa-q > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; padding: 2px 0; }
.mhud .mh-qa-qx { flex: none; width: 20px; text-align: center; font-size: 14px; color: rgba(225, 232, 248, 0.6); cursor: pointer; }
.mhud .mh-qa-r { display: flex; gap: 6px; padding: 1px 0 1px 8px; font-size: 10.5px; color: rgba(232, 237, 248, 0.88); }
.mhud .mh-qa-r span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mhud .mh-qa-r em { flex: none; font-style: normal; font-weight: 700; }

/* the World Map */
.mhud .mh-wm { position: absolute; left: 50%; top: 6px; bottom: calc(50px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 2;
  width: min(760px, calc(100% - 12px - env(safe-area-inset-left) - env(safe-area-inset-right))); display: flex; flex-direction: column; gap: 6px;
  padding: 8px; pointer-events: auto; animation: mh-fade 0.2s ease; }
.mhud .mh-wm .mh-tr-head .mh-cta { height: 26px; padding: 0 12px; }
.mhud.mh-mapping .mh-mm, .mhud.mh-mapping .mh-act, .mhud.mh-mapping .mh-menu, .mhud.mh-mapping .mh-qa { display: none; }
.mhud .mh-wm-where { font-size: 11px; color: rgba(225, 232, 248, 0.65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mhud .mh-wm-stage { flex: 1; min-height: 0; display: grid; place-items: center; }
.mhud .mh-wm-stage canvas { border-radius: 8px; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12); image-rendering: pixelated; cursor: pointer; }
.mhud .mh-wm-info { flex: none; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-height: 18px; font-size: 11px; color: rgba(225, 232, 248, 0.75); }
.mhud .mh-wm-info b { font-size: 12px; font-weight: 800; color: #ffd978; }
.mhud .mh-wm-hint { color: rgba(225, 232, 248, 0.5); }

/* a player's info */
.mhud .mh-pi { position: absolute; left: 50%; top: 6px; transform: translateX(-50%); z-index: 2;
  width: min(560px, calc(100% - 24px - env(safe-area-inset-left) - env(safe-area-inset-right))); max-height: calc(100% - 56px - env(safe-area-inset-bottom));
  display: flex; flex-direction: column; gap: 6px; padding: 8px; pointer-events: auto; animation: mh-fade 0.2s ease; }
.mhud .mh-pi-top { flex: none; display: flex; gap: 12px; align-items: stretch; }
.mhud .mh-pi-side { flex: none; width: 108px; display: flex; flex-direction: column; align-items: center; gap: 5px; }
.mhud .mh-pi-facts { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.mhud .mh-pi .mh-kv em { display: flex; align-items: center; gap: 6px; }
.mhud .mh-pi .mh-minus { background: linear-gradient(180deg, #c9d4ea, #8d9bb8); }
.mhud .mh-pi-acts { flex: none; display: flex; flex-wrap: wrap; gap: 6px; }
.mhud .mh-pi-acts:empty { display: none; }
.mhud .mh-pi-tabs { flex: none; }
.mhud .mh-pi button.mh-tab { border: 0; font-family: inherit; }
.mhud .mh-pi-body { flex: 1; min-height: 60px; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.mhud .mh-pi-body .mh-cta { flex: none; height: 26px; padding: 0 12px; }
`;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
/** An item's text without the client's colour codes, on one line. */
const plain = (s) => String(s || '').replace(/\\n/g, ' ').replace(/#[a-zA-Z]/g, '').replace(/#/g, '').replace(/\s+/g, ' ').trim();
/** A box's own keys stay with it: Enter / Escape answer, nothing reaches the game. */
function keys(input, enter, escape) {
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); enter(); } else if (e.key === 'Escape') { e.preventDefault(); escape?.(); }
  });
  for (const t of ['keyup', 'keypress', 'pointerdown']) input.addEventListener(t, (e) => e.stopPropagation());
}
/** Typing at once with a keyboard; on a touch screen the box waits for a tap (a phone opens its keyboard only for one). */
function focusSoft(input, select = false) {
  if (globalThis.matchMedia?.('(pointer: coarse)').matches) return;
  setTimeout(() => { input.focus(); if (select) input.select(); }, 0);
}
const textInput = (max, value) => {
  const i = el('input', 'mh-in');
  Object.assign(i, { type: 'text', maxLength: max, value, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  i.setAttribute('autocorrect', 'off');
  return i;
};

export class MobileSkins {
  constructor(hud) {
    this.hud = hud; this.g = hud.g;
    if (!document.getElementById('mhud-skin-css')) {
      const s = document.createElement('style');
      s.id = 'mhud-skin-css'; s.textContent = CSS;
      document.head.append(s);
    }
    this.el = el('div', 'mh-skins');
    this.toasts = el('div', 'mh-toasts');
    this.npc = new NpcPanel(this);
    this.el.append(this.npc.el, this.toasts);
    hud.el.append(this.el);
    this.views = new Map();   // window -> its view (the conversation has the one panel, reused page to page)
    this.descs = new Map(); this.descV = 0;
    this.broken = new WeakSet();   // windows whose view failed: drawn as the client's own again
    this.skinned = (w) => this.active && !this.broken.has(w) && !!this.kindOf(w);
    const loop = () => {
      try { this.sync(); } catch (e) { if (!this.failed) { this.failed = true; console.error('MOBILE UI windows', e); } }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  get wm() { return this.g.windows; }
  get active() { return !!settings.mobileUi && this.hud.shown; }
  kindOf(w) {
    if (w instanceof NpcDialog) return 'npc';
    if (w instanceof UtilBox) return BOX_KINDS.has(w.kind) ? 'box' : null;
    if (w instanceof ShopWin) return 'shop';
    if (w instanceof TradeWin) return 'trade';
    if (w instanceof StorageWin) return 'storage';
    if (w instanceof Balloon) return 'toast';
    if (w instanceof MessengerWin) return 'messenger';
    if (w instanceof QuestAlarmWin) return 'questhelper';
    if (w instanceof WorldMapWin) return 'worldmap';
    if (w instanceof CharInfoWin) return 'charinfo';
    return null;
  }
  /** A view that failed: its window goes back to the client's own look (said once in the console, by its kind). */
  fail(w, what, e) {
    if (w) this.broken.add(w);
    (this.reported ??= new Set());
    if (!this.reported.has(what)) { this.reported.add(what); console.error(`MOBILE UI ${what} failed: the window is shown as the client's own`, e); }
  }
  /** Each frame: a view for each window it stands in for (made, ticked, dropped as they open and close). */
  sync() {
    const wm = this.wm;
    if (!wm?.order) return;
    if (wm.skin !== this.skinned) wm.skin = this.skinned;
    const on = this.active, now = performance.now(), live = new Set();
    let talk = null;
    if (on) {
      for (const w of wm.order) {
        const k = this.kindOf(w);
        if (!k || this.broken.has(w)) continue;
        if (k === 'npc') { talk = w; continue; }
        live.add(w);
        if (!this.views.has(w)) { try { this.views.set(w, new VIEWS[k](this, w)); } catch (e) { live.delete(w); this.fail(w, k, e); } }
      }
    }
    for (const [w, v] of this.views) if (!live.has(w)) { try { v.destroy(); } catch { /* gone anyway */ } this.views.delete(w); }
    // each on its own: one failing never holds back the others (a request card waiting on its tick to show or time out)
    try { this.npc.show(talk); this.npc.tick(now); } catch (e) { const w = this.npc.w; this.npc.show(null); this.fail(w, 'npc', e); }
    let shop = false, trade = false, chat = false, map = false;
    for (const [w, v] of this.views) {
      try { v.tick(now); } catch (e) { try { v.destroy(); } catch { /* gone anyway */ } this.views.delete(w); this.fail(w, v.constructor.name, e); continue; }
      if (v instanceof ShopView || v instanceof StorageView) shop = true; else if (v instanceof TradeView) trade = true; else if (v instanceof MessengerView) chat = true;
      else if (v instanceof WorldMapView) map = true;
    }
    const c = this.hud.el.classList;
    if (c.contains('mh-shopping') !== shop) c.toggle('mh-shopping', shop);
    if (c.contains('mh-trading') !== trade) c.toggle('mh-trading', trade);
    if (c.contains('mh-messaging') !== chat) c.toggle('mh-messaging', chat);
    if (c.contains('mh-mapping') !== map) c.toggle('mh-mapping', map);
  }

  // ---------------------------------------------------------------- pieces
  tap(node, fn) { this.hud.tap(node, fn); }
  button(label, fn, cls = '') {
    const b = el('button', `mh-cta${cls ? ` ${cls}` : ''}`, label);
    b.type = 'button';
    this.tap(b, () => { if (!b.disabled) fn(); });
    return b;
  }
  /** One of the game's images from its node, or an empty one until it is in. */
  img(node, cls = '') {
    const i = el('img', cls || null); i.alt = ''; i.draggable = false;
    if (node?._canvas) i.src = `${this.g.assets.base}/${node._canvas}`;
    else i.style.visibility = 'hidden';
    return i;
  }
  /** An item's icon in its little cell, with a count when there is one. */
  icon(id, count = 0) {
    const c = el('div', 'mh-ico');
    c.append(this.img(this.wm.icon(id)));
    if (count > 1) c.append(el('b', null, fmt(count)));
    return c;
  }
  /** An item's description, loaded once (what shows it is drawn again when it arrives). */
  desc(id) {
    if (!this.descs.has(id)) { this.descs.set(id, null); itemDesc(this.g.assets, id).then((d) => { this.descs.set(id, d || ''); this.descV++; }); }
    return this.descs.get(id) || '';
  }
  /** Text runs (from richText): words in their colours, item icons and pictures. */
  runs(row, runs) {
    for (const r of runs) {
      if (r.img || r.icon) { row.append(this.img(r.img || r.icon, r.img ? 'mh-pic' : 'mh-ic')); continue; }
      if (r.t === undefined) continue;
      const s = el('span', null, r.t);
      if (r.color && r.color !== TEXT.base) s.style.color = r.color;
      if (r.bold) s.style.fontWeight = '800';
      row.append(s);
    }
  }
  /** Dialogue text (its #codes) with the game's own names, line by line; on a menu page its #L choices are rows to tap. */
  rich(box, text, { onOpt = null, boldE = true } = {}) {
    const ctx = (this.measure ??= document.createElement('canvas').getContext('2d'));
    const { lines } = richText(ctx, String(text ?? ''), 100000, textRef(this.wm), { ...TEXT, boldE });
    for (const l of lines) {
      const opt = !!onOpt && l.opt !== null && l.opt !== undefined, row = el('div', opt ? 'mh-nd-opt' : 'mh-ln');
      this.runs(row, l.runs);
      if (opt) this.tap(row, () => onOpt(l.opt));
      else if (!row.textContent.trim() && !row.querySelector('img')) row.textContent = ' ';
      box.append(row);
    }
    return box;
  }
}

/** A little stage the speaker stands on: its own frames, by their delays, or you (your look standing). */
class Stage {
  constructor(box, footX, footY) { this.box = box; this.fx = footX; this.fy = footY; }
  stop() { clearTimeout(this.timer); this.list = null; this.cv = null; this.box.replaceChildren(); }
  frames(list, base) {
    if (this.list && this.list.length === list.length && this.list[0] === list[0]) return;   // already up and moving
    this.stop();
    this.list = list;
    const img = el('img'); img.alt = ''; img.draggable = false;
    this.box.append(img);
    let i = 0;
    const show = () => {
      const f = list[i++ % list.length], o = f.origin || [(f._w || 0) / 2, f._h || 0];
      img.src = `${base}/${f._canvas}`;
      img.style.left = `${this.fx - o[0]}px`; img.style.top = `${this.fy - o[1]}px`;
      if (list.length > 1) this.timer = setTimeout(show, Number(f.delay) || 180);
    };
    show();
  }
  /** Someone standing: you (g.look), or another's look. */
  look(g, look = g.look) {
    if (!look) return;
    const now = performance.now();
    if (this.cv && this.drawnLook === look && now - this.drawn < 250) return;   // (its parts may still be coming in)
    this.drawnLook = look;
    if (!this.cv) { this.stop(); this.cv = el('canvas'); this.box.append(this.cv); }
    const W = this.box.clientWidth || 108, H = this.box.clientHeight || 112, dpr = Math.min(3, globalThis.devicePixelRatio || 1), cv = this.cv;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); Object.assign(cv.style, { left: '0', top: '0', width: `${W}px`, height: `${H}px` }); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, H);
    drawParts(ctx, g.assets, look.compose(look.standAction(), 0), this.fx, this.fy, false);
    this.drawn = now;
  }
}

/**
 * The conversation: one panel, kept from page to page (the next page swaps in without it going away; it goes a
 * moment after the last). It answers through the dialog's own reply / pick / submit.
 */
class NpcPanel {
  constructor(sk) {
    this.sk = sk;
    const n = this.el = el('div', 'mh-nd mh-glass');
    n.innerHTML = `<div class="mh-nd-side"><div class="mh-stage"></div><div class="mh-name"></div></div>
      <div class="mh-nd-main"><div class="mh-nd-text" data-scroll="y"></div><div class="mh-nd-field"></div><div class="mh-nd-btns"></div></div>`;
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    const $ = (s) => n.querySelector(s);
    this.p = { stage: $('.mh-stage'), name: $('.mh-name'), text: $('.mh-nd-text'), field: $('.mh-nd-field'), btns: $('.mh-nd-btns') };
    this.stage = new Stage(this.p.stage, 54, 104);
    this.w = null;
  }
  show(w) {
    if (w === this.w) return;
    const n = this.el;
    clearTimeout(this.hideT);
    if (!w) {
      this.w = null;
      n.classList.add('mh-stale');
      this.hideT = setTimeout(() => { if (!this.w) { n.classList.remove('mh-open', 'mh-stale'); this.stage.stop(); this.speaker = null; } }, 240);
      return;
    }
    if (!n.classList.contains('mh-open')) { this.sk.hud.sheets?.close(); this.sk.hud.closeMenu(); }
    this.w = w;
    n.classList.remove('mh-stale'); n.classList.add('mh-open');
    w.field?.show(false);   // (its own box: this panel has one)
    this.build();
  }
  /** Only while the dialog is still up, once. */
  answer(fn, silent = false) {
    const w = this.w;
    if (!w || !this.sk.wm.order.includes(w)) return;
    if (!silent) sfx.play('UI/BtMouseClick');
    fn(w);
  }
  build() {
    const w = this.w, d = w.d, p = this.p, sk = this.sk;
    this.el.classList.toggle('mh-mirror', !!w.mirror);
    this.drawText(true);
    p.field.replaceChildren();
    this.input = null;
    if (w.field) {
      const i = this.input = textInput(w.field.el.maxLength, w.field.value);
      i.enterKeyHint = 'done';
      if (d.type === 3) i.inputMode = 'numeric';
      const submit = () => this.answer((x) => { x.field.value = i.value; x.submit(); });
      keys(i, submit, w.closeBtn2 ? () => this.answer((x) => x.reply(0)) : null);
      p.field.append(i, sk.button('OK', submit, 'mh-main'));
      focusSoft(i, true);
    }
    p.field.style.display = w.field ? '' : 'none';
    // END CHAT on the left (when the page has it), the page's answers on the right
    p.btns.replaceChildren();
    const end = w.menu || w.field ? 0 : -1;
    if (w.closeBtn2) p.btns.append(sk.button('End Chat', () => this.answer((x) => x.reply(end))));
    p.btns.append(el('span', 'mh-sp'));
    const add = (label, action, main = false) => p.btns.append(sk.button(label, () => this.answer((x) => x.reply(action)), main ? 'mh-main' : ''));
    if (d.type === 0) { if (d.prev) add('Prev', 0); add(d.next ? 'Next' : 'OK', 1, true); }
    else if (d.type === 1) { add('No', 0); add('Yes', 1, true); }
    else if (d.type === 12) { add('Decline', 0); add('Accept', 1, true); }
    p.btns.style.display = p.btns.childElementCount > 1 ? '' : 'none';
    this.drawStage();
  }
  drawText(fresh = false) {
    const w = this.w, p = this.p, keep = p.text.scrollTop;
    this.names = this.sk.wm.namesVersion;
    p.text.replaceChildren();
    const onOpt = w.menu ? (o) => { const i = w.opts.indexOf(o); if (i >= 0) this.answer((x) => { x.sel = i; x.pick(i); }, true); } : null;
    this.sk.rich(p.text, w.words, { onOpt, boldE: false });
    p.text.scrollTop = fresh ? 0 : keep;
    if (fresh) { p.text.classList.remove('mh-page'); void p.text.offsetWidth; p.text.classList.add('mh-page'); }
  }
  /** The speaker: the NPC's frames (as the dialog loaded them), or you; its name under it. */
  drawStage() {
    const w = this.w, p = this.p, who = w.avatar ? 'me' : w.d.npc;
    p.name.textContent = w.name || '';
    p.name.style.display = w.name ? '' : 'none';
    if (who !== this.speaker) { this.stage.stop(); this.speaker = who; }
    this.faceOf = w.avatar ? 'me' : w.face;
    if (w.avatar) this.stage.look(this.sk.g);
    else if (w.face?.length) this.stage.frames(w.face, this.sk.g.assets.base);
  }
  tick() {
    const w = this.w;
    if (!w) return;
    if (this.names !== this.sk.wm.namesVersion && !this.sk.hud.busy) this.drawText();   // (not under a finger on a choice)
    if ((w.avatar ? 'me' : w.face) !== this.faceOf || (w.name || '') !== this.p.name.textContent) this.drawStage();
    if (w.avatar) this.stage.look(this.sk.g);
  }
}

/** A message box as a card in the middle: its lines, its box for a number or a name, and OK (and Cancel). */
class BoxView {
  constructor(sk, w) {
    this.sk = sk; this.w = w;
    const dim = this.el = el('div', 'mh-bx-dim'), card = el('div', 'mh-bx mh-glass');
    dim.addEventListener('pointerdown', (e) => e.stopPropagation());
    dim.append(card);
    const text = el('div', 'mh-bx-text');
    if (w.centred) for (const l of w.lines) { const row = el('div'); sk.runs(row, l.runs); if (!row.textContent.trim() && !row.querySelector('img')) row.textContent = ' '; text.append(row); }
    else { text.classList.add('mh-left'); text.textContent = w.lines.join('\n'); }
    card.append(text);
    if (w.field) {
      w.field.show(false);
      const row = el('div', 'mh-bx-row'), i = this.input = textInput(w.field.el.maxLength, w.field.value);
      i.enterKeyHint = 'done';
      if (w.kind === 'quantity') {
        i.inputMode = 'numeric';
        const lo = w.opts.min ?? 1, hi = w.opts.max;
        const step = (d) => { const v = Math.floor(Number(i.value) || 0) + d; i.value = String(Math.max(lo, hi !== undefined ? Math.min(hi, v) : v)); };
        const stepper = (t, d) => { const b = el('button', 'mh-step', t); b.type = 'button'; sk.tap(b, () => step(d)); return b; };
        row.append(stepper('−', -1), i, stepper('+', 1));
        if (hi !== undefined && hi > lo) row.append(sk.button('Max', () => { i.value = String(hi); }));
      } else row.append(i);
      card.append(row);
      keys(i, () => this.finish(true), () => this.finish(false));
      focusSoft(i, true);
    }
    // Add Buddy's and To Group's group list (the one picked is the box's); the names whispered before, to tap one in
    if ((w.kind === 'buddy' || w.kind === 'group') && w.names?.length) {
      const s = el('select', 'mh-select');
      for (const n of w.names) { const o = el('option', null, n); o.value = n; s.append(o); }
      s.value = w.group;
      for (const t of ['pointerdown', 'keydown', 'keyup']) s.addEventListener(t, (e) => e.stopPropagation());
      s.addEventListener('change', () => { w.group = s.value; });
      const r = el('div', 'mh-bx-row'); r.append(s); card.append(r);
    }
    if (w.kind === 'whisper' && w.names?.length && this.input) {
      const chips = el('div', 'mh-seg');
      for (const n of w.names) { const b = el('button', 'mh-tab', n); b.type = 'button'; sk.tap(b, () => { this.input.value = n; }); chips.append(b); }
      card.append(chips);
    }
    const btns = el('div', 'mh-bx-btns');
    if (w.kind !== 'ok') btns.append(sk.button('Cancel', () => this.finish(false)));
    btns.append(sk.button('OK', () => this.finish(true), 'mh-main'));
    card.append(btns);
    sk.el.append(dim);
  }
  finish(ok) {
    const w = this.w;
    if (w.answered || !this.sk.wm.order.includes(w)) return;
    if (ok && w.field && this.input) w.field.value = this.input.value;
    sfx.play('UI/BtMouseClick');
    w.finish(ok);
  }
  tick() {}
  destroy() { this.el.remove(); if (this.sk.wm.order.includes(this.w)) this.w.field?.show(true); }
}

/** An invitation or notice: a card at the top with its buttons, fading as its balloon does (the balloon keeps time). */
class ToastView {
  constructor(sk, w) {
    this.sk = sk; this.w = w;
    const n = this.el = el('div', 'mh-toast mh-glass'), s = w.summary();
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    n.style.opacity = '0';
    if (s.icon) n.append(sk.img(s.icon));
    const t = el('div', 'mh-toast-text');
    s.lines.filter(Boolean).forEach((line, i) => t.append(el(i ? 'span' : 'b', null, line)));
    n.append(t);
    if (w instanceof QuestNotice) sk.tap(t, () => w.down());   // the body opens the quest, as the balloon's does
    if (s.x) n.append(sk.button(s.x.label, s.x.fn));
    if (s.ok) n.append(sk.button(s.ok.label, s.ok.fn, 'mh-main'));
    sk.toasts.append(n);
  }
  tick(now) {
    const w = this.w;
    w.update(now);   // (its own draw, which would, is skipped)
    const a = String(Math.round(w.alpha * 100) / 100);
    if (this.el.style.opacity !== a) this.el.style.opacity = a;
    if (this.el.classList.contains('mh-closing') !== !!w.closing) this.el.classList.toggle('mh-closing', !!w.closing);
  }
  destroy() { this.el.remove(); }
}

/** An NPC shop: the shopkeeper, the goods and your items side by side, and the one picked with BUY / SELL / RECHARGE. */
class ShopView {
  constructor(sk, w) {
    this.sk = sk; this.w = w;
    const n = this.el = el('div', 'mh-shop mh-glass');
    n.innerHTML = `<div class="mh-shop-side"><div class="mh-stage"></div><div class="mh-name"></div><div class="mh-shop-meso"></div><div class="mh-sp"></div></div>
      <div class="mh-shop-main"><div class="mh-shop-lists">
        <div class="mh-shop-col"><div class="mh-shop-top"><span class="mh-shop-h">Buy</span><div class="mh-sh-tabs" data-scroll="x"></div></div><div class="mh-list mh-shop-list" data-scroll="y"></div></div>
        <div class="mh-shop-col"><div class="mh-shop-top"><span class="mh-shop-h">Sell</span><div class="mh-sh-tabs" data-scroll="x"></div></div><div class="mh-list mh-shop-list" data-scroll="y"></div></div>
      </div><div class="mh-shop-foot"></div></div>`;
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    const [b, s] = n.querySelectorAll('.mh-shop-col'), $ = (q) => n.querySelector(q);
    this.p = { stage: $('.mh-stage'), name: $('.mh-name'), meso: $('.mh-shop-meso'), side: $('.mh-shop-side'), foot: $('.mh-shop-foot'),
      buyTabs: b.querySelector('.mh-sh-tabs'), buy: b.querySelector('.mh-shop-list'), sellTabs: s.querySelector('.mh-sh-tabs'), sell: s.querySelector('.mh-shop-list') };
    this.p.side.append(sk.button('Leave', () => w.close()));
    this.stage = new Stage(this.p.stage, 50, 98);
    sk.el.append(n);
    sk.hud.sheets?.close(); sk.hud.closeMenu();
  }
  tick(now) {
    if (now - (this.at || 0) < 100 || this.sk.hud.busy) return;   // (not redrawn under a finger)
    this.at = now;
    const w = this.w, g = this.sk.g;
    if (w.npc && !this.npcUp) { this.npcUp = true; this.stage.frames(w.npc.frames, g.assets.base); }
    const sells = w.sellItems();
    const sig = JSON.stringify([w.buyTab, w.tab, w.selBuy, w.selSell, w.pending, g.meso, this.sk.wm.namesVersion, w.must.length, w.all.length,
      sells.map((r) => `${r.pos}:${r.it.id}:${r.qty}`), this.sk.descV, g.potionRate]);
    if (sig !== this.sig) { this.sig = sig; this.render(sells); }
  }
  tabs(box, list, cur, set) {
    box.replaceChildren(...list.map(([k, label]) => {
      const t = el('div', `mh-tab${k === cur ? ' mh-on' : ''}`, label);
      this.sk.tap(t, () => { if (k !== cur) { set(k); sfx.play('UI/Tab'); this.at = 0; } });
      return t;
    }));
  }
  render(sells) {
    const w = this.w, sk = this.sk, g = sk.g, p = this.p;
    p.name.textContent = sk.wm.strings.npc?.[w.shop.npc]?.name || 'Shop';
    p.meso.replaceChildren(sk.img(w.S.meso, 'mh-coin'), fmt(g.meso));
    this.tabs(p.buyTabs, [[0, 'All'], ...(w.must.length ? [[1, 'Must']] : [])], w.buyTab, (k) => { w.buyTab = k; w.selBuy = -1; });
    this.tabs(p.sellTabs, SELL_TABS, w.tab, (k) => { w.tab = k; w.firstSell = 0; w.selSell = -1; });
    const goods = w.buyItems(), tabs = `${w.buyTab}|${w.tab}`, same = this.tabsSeen === tabs;
    const keep = [same ? p.buy.scrollTop : 0, same ? p.sell.scrollTop : 0];
    this.tabsSeen = tabs;
    p.buy.replaceChildren(...goods.map((e, i) => this.goodsRow(e, i)).filter(Boolean));
    if (!p.buy.childElementCount) p.buy.append(el('div', 'mh-empty', 'Nothing for sale here.'));
    p.sell.replaceChildren(...sells.map((r, i) => this.sellRow(r, i)));
    if (!sells.length) p.sell.append(el('div', 'mh-empty', 'Nothing here the shop takes.'));
    [p.buy.scrollTop, p.sell.scrollTop] = keep;
    this.foot(goods, sells);
  }
  row(sel, id, count, name, sub, pick) {
    const r = el('div', `mh-li${sel ? ' mh-sel' : ''}`), m = el('div', 'mh-li-main');
    r.append(this.sk.icon(id, count));
    m.append(el('div', 'mh-li-name', name), sub);
    r.append(m);
    this.sk.tap(r, () => { pick(); this.at = 0; });
    return r;
  }
  /** A good: icon, name, and its price in mesos (a potion discount beside it) or in Perfect Pitches. */
  goodsRow({ it }, i) {
    const w = this.w, sk = this.sk;
    if (it.price && it.token) return null;
    const sub = el('div', 'mh-li-sub'), d = it.price ? potionPrice(sk.g, it.price, it.id) : 0;
    sub.append(sk.img(it.price ? w.S.meso : w.S.token, 'mh-coin'));
    if (d) sub.append(el('s', null, fmt(it.price)), ' ', el('em', 'mh-sale', `${fmt(d)} meso`));
    else sub.append(it.price ? `${fmt(it.price)} meso` : fmt(it.token));
    return this.row(i === w.selBuy, it.id, it.quantity, sk.wm.itemName(it.id) || '...', sub, () => { w.selBuy = i; w.selSell = -1; });
  }
  /** One of yours: icon (with its count for Use / Set-up / Etc), name, what it sells for and a recharge's price. */
  sellRow(r, i) {
    const w = this.w, sk = this.sk, id = r.it.id;
    const sub = el('div', 'mh-li-sub', `${fmt(r.price)} meso${r.recharge > 0 ? ` · recharge ${fmt(r.recharge)}` : ''}`);
    return this.row(i === w.selSell, id, [2, 3, 4].includes(invType(id)) ? r.qty : 0, sk.wm.itemName(id) || '...', sub, () => { w.selSell = i; w.selBuy = -1; });
  }
  foot(goods, sells) {
    const w = this.w, sk = this.sk, f = this.p.foot;
    f.replaceChildren();
    const e = w.selBuy >= 0 ? goods[w.selBuy] : null, r = !e && w.selSell >= 0 ? sells[w.selSell] : null;
    if (!e && !r) { f.append(el('div', 'mh-shop-hint', 'Tap an item to buy it, or one of yours to sell it.')); return; }
    const id = e ? e.it.id : r.it.id, t = el('div', 'mh-shop-ft'), desc = plain(sk.desc(id));
    t.append(el('b', null, sk.wm.itemName(id) || '...'));
    if (desc) t.append(el('span', null, desc));
    f.append(sk.icon(id), t);
    const act = (label, fn, main) => { const b = sk.button(label, fn, main ? 'mh-main' : ''); b.disabled = !!w.pending; f.append(b); };
    if (e) act('Buy', () => w.buy(), true);
    else { if (r.recharge > 0) act('Recharge', () => w.recharge()); act('Sell', () => w.sell(), true); }
  }
  destroy() { this.el.remove(); }
}

/**
 * The storage, laid out as the shop: the keeper (Arrange, Leave) beside what is stored and your inventory by tab,
 * each list with its mesos and a button to move them; the chosen row's item at the foot with Take out or Store. All
 * of it goes through the window's own actions, so its questions, fees and one-request-at-a-time hold here too.
 */
class StorageView {
  constructor(sk, w) {
    this.sk = sk; this.w = w;
    const n = this.el = el('div', 'mh-shop mh-store mh-glass');
    n.innerHTML = `<div class="mh-shop-side"><div class="mh-stage"></div><div class="mh-name"></div><div class="mh-sp"></div></div>
      <div class="mh-shop-main"><div class="mh-shop-lists">
        <div class="mh-shop-col"><div class="mh-shop-top"><span class="mh-shop-h">Storage</span><div class="mh-sp"></div><span class="mh-st-count"></span></div><div class="mh-list mh-shop-list" data-scroll="y"></div><div class="mh-st-meso"></div></div>
        <div class="mh-shop-col"><div class="mh-shop-top"><span class="mh-shop-h">Inventory</span><div class="mh-sh-tabs" data-scroll="x"></div></div><div class="mh-list mh-shop-list" data-scroll="y"></div><div class="mh-st-meso"></div></div>
      </div><div class="mh-shop-foot"></div></div>`;
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    const [a, b] = n.querySelectorAll('.mh-shop-col'), $ = (q) => n.querySelector(q);
    this.p = { stage: $('.mh-stage'), name: $('.mh-name'), side: $('.mh-shop-side'), foot: $('.mh-shop-foot'), count: a.querySelector('.mh-st-count'),
      kept: a.querySelector('.mh-shop-list'), keptMeso: a.querySelector('.mh-st-meso'), tabs: b.querySelector('.mh-sh-tabs'), mine: b.querySelector('.mh-shop-list'), myMeso: b.querySelector('.mh-st-meso') };
    this.p.side.append(sk.button('Arrange', () => w.arrange()), sk.button('Leave', () => w.close()));
    this.stage = new Stage(this.p.stage, 50, 98);
    sk.el.append(n);
    sk.hud.sheets?.close(); sk.hud.closeMenu();
  }
  tick(now) {
    if (now - (this.at || 0) < 100 || this.sk.hud.busy) return;   // (not redrawn under a finger)
    this.at = now;
    const w = this.w, g = this.sk.g, mine = w.mine();
    if (w.keeper && !this.keeperUp) { this.keeperUp = true; this.stage.frames(w.keeper.frames, g.assets.base); }
    const sig = JSON.stringify([w.tab, w.sel, w.pending, w.meso, g.meso, w.slots, w.items.map((it) => `${it.id}:${it.quantity}`),
      mine.map((r) => `${r.pos}:${r.it.id}:${r.it.quantity}`), this.sk.wm.namesVersion, this.sk.descV]);
    if (sig !== this.sig) { this.sig = sig; this.render(mine); }
  }
  render(mine) {
    const w = this.w, sk = this.sk, g = sk.g, p = this.p, S = sk.wm.W.Shop;
    p.name.textContent = sk.wm.strings.npc?.[w.npc]?.name || 'Storage';
    p.count.textContent = `${w.items.length} / ${w.slots}`;
    p.tabs.replaceChildren(...SELL_TABS.map(([k, label]) => {
      const t = el('div', `mh-tab${k === w.tab ? ' mh-on' : ''}`, label);
      sk.tap(t, () => { w.setTab(k); this.at = 0; });
      return t;
    }));
    const same = this.tabSeen === w.tab, keep = [p.kept.scrollTop, same ? p.mine.scrollTop : 0];
    this.tabSeen = w.tab;
    p.kept.replaceChildren(...w.items.map((it, i) => this.row(w.sel.side === 0 && w.sel.idx === i, it, () => w.choose(0, i))));
    if (!w.items.length) p.kept.append(el('div', 'mh-empty', 'Nothing stored yet.'));
    p.mine.replaceChildren(...mine.map((r, i) => this.row(w.sel.side === 1 && w.sel.idx === i, r.it, () => w.choose(1, i))));
    if (!mine.length) p.mine.append(el('div', 'mh-empty', 'Nothing here that can be stored.'));
    [p.kept.scrollTop, p.mine.scrollTop] = keep;
    const meso = (box, v, label, fn) => {
      const b = sk.button(label, fn); b.disabled = !!w.pending;
      const t = el('span'); t.append(sk.img(S?.meso, 'mh-coin'), fmt(v));
      box.replaceChildren(t, b);
    };
    meso(p.keptMeso, w.meso, 'Take out', () => w.mesoOut());
    meso(p.myMeso, g.meso, 'Store', () => w.mesoIn());
    this.foot(mine);
  }
  row(sel, it, pick) {
    const sk = this.sk, r = el('div', `mh-li${sel ? ' mh-sel' : ''}`), m = el('div', 'mh-li-main');
    r.append(sk.icon(it.id, [2, 3, 4].includes(invType(it.id)) ? it.quantity : 0));
    m.append(el('div', 'mh-li-name', sk.wm.itemName(it.id) || '...'), el('div', 'mh-li-sub', SELL_TABS[invType(it.id) - 1]?.[1] || ''));
    r.append(m);
    sk.tap(r, () => { pick(); this.at = 0; });
    return r;
  }
  foot(mine) {
    const w = this.w, sk = this.sk, f = this.p.foot;
    f.replaceChildren();
    const it = w.sel.side === 0 ? w.items[w.sel.idx] : w.sel.side === 1 ? mine[w.sel.idx]?.it : null;
    if (!it) { f.append(el('div', 'mh-shop-hint', 'Tap a stored item to take it out, or one of yours to store it.')); return; }
    const t = el('div', 'mh-shop-ft'), desc = plain(sk.desc(it.id));
    t.append(el('b', null, sk.wm.itemName(it.id) || '...'));
    if (desc) t.append(el('span', null, desc));
    f.append(sk.icon(it.id), t);
    const b = w.sel.side === 0 ? sk.button('Take out', () => w.takeOut(), 'mh-main') : sk.button('Store', () => w.store(), 'mh-main');
    b.disabled = !!w.pending;
    f.append(b);
  }
  destroy() { this.stage.stop(); this.el.remove(); }
}

/** A trade: both offers side by side (your partner's on the left, as the window has them), its chat, TRADE and Cancel. */
class TradeView {
  constructor(sk, w) {
    this.sk = sk; this.w = w;
    w.chat?.show(false);
    const n = this.el = el('div', 'mh-tr mh-glass');
    n.innerHTML = `<div class="mh-tr-head"><span class="mh-sh-title">Trade</span><span class="mh-tr-tip"></span><div class="mh-btn mh-sh-x" title="Cancel the trade">${X_ICON}</div></div>
      <div class="mh-tr-sides"><div class="mh-tr-side"></div><div class="mh-tr-side"></div></div><div class="mh-tr-log" data-scroll="y"></div>
      <div class="mh-tr-say"></div><div class="mh-tr-btns"></div>`;
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    const $ = (q) => n.querySelector(q);
    this.p = { tip: $('.mh-tr-tip'), sides: [...n.querySelectorAll('.mh-tr-side')], log: $('.mh-tr-log'), say: $('.mh-tr-say'), btns: $('.mh-tr-btns') };
    sk.tap($('.mh-sh-x'), () => w.cancel());
    const i = this.input = textInput(70, '');
    i.enterKeyHint = 'send'; i.placeholder = 'Say something';
    keys(i, () => this.say(), () => i.blur());
    this.p.say.append(i, sk.button('Send', () => this.say()));
    this.mesoBtn = sk.button('Offer mesos', () => w.offerMesos());
    this.tradeBtn = sk.button('Trade', () => w.confirm(), 'mh-main');
    this.p.btns.append(this.mesoBtn, this.tradeBtn);
    sk.el.append(n);
    // your inventory beside it, to offer from (its Offer in trade)
    const sh = sk.hud.sheets;
    if (sh && sh.kind !== 'items') { sh.show('items'); this.openedItems = true; }
  }
  /** A line for the trade's chat, through the same checks as the window's. */
  say() {
    const t = this.input.value;
    this.input.value = '';
    if (t) this.sk.g.roomChat?.(t);
  }
  tick(now) {
    if (now - (this.at || 0) < 100 || this.sk.hud.busy) return;   // (not redrawn under a finger)
    this.at = now;
    const w = this.w;
    const sig = JSON.stringify([w.partner?.name, w.items.map((s) => Object.entries(s).map(([k, it]) => `${k}:${it?.id}:${it?.quantity}`)), w.meso, w.confirmed, this.sk.wm.namesVersion]);
    if (sig !== this.sig) { this.sig = sig; this.sides(); }
    const last = w.lines[w.lines.length - 1];
    if (last !== this.logLast || w.lines.length !== this.logN) this.log();
  }
  sides() {
    const w = this.w, sk = this.sk;
    [[1, w.partner?.name || 'Waiting...'], [0, sk.g.player?.name || 'You']].forEach(([side, name], k) => {
      const box = this.p.sides[k], who = el('div', 'mh-tr-who'), grid = el('div', 'mh-tr-grid'), meso = el('div', 'mh-tr-meso');
      box.classList.toggle('mh-ok', !!w.confirmed[side]);
      who.append(el('b', null, name));
      if (w.confirmed[side]) who.append(el('em', null, 'Confirmed'));
      for (let s = 1; s <= 9; s++) {
        const it = w.items[side][s], c = el('div', 'mh-cell');
        if (it) {
          c.append(sk.img(sk.wm.icon(it.id)));
          if (invType(it.id) !== 1 && it.quantity > 1) c.append(el('b', null, String(it.quantity)));
          sk.tap(c, () => { this.p.tip.textContent = `${sk.wm.itemName(it.id) || ''}${it.quantity > 1 ? ` ×${fmt(it.quantity)}` : ''}`; });
        }
        grid.append(c);
      }
      meso.append(sk.img(sk.wm.W?.Shop?.meso, 'mh-coin'), fmt(w.meso[side]));
      box.replaceChildren(who, grid, meso);
    });
    this.tradeBtn.disabled = !w.partner || !!w.confirmed[0];
    this.tradeBtn.textContent = w.confirmed[0] ? 'Confirmed' : 'Trade';
    this.mesoBtn.disabled = !!w.confirmed[0];
  }
  log() {
    const w = this.w, log = this.p.log;
    log.replaceChildren(...w.lines.map((l) => { const d = el('div', null, l.text); d.style.color = LOG_COLORS[l.color] || '#e8edf8'; return d; }));
    log.scrollTop = log.scrollHeight;
    this.logN = w.lines.length; this.logLast = w.lines[w.lines.length - 1];
  }
  destroy() {
    this.el.remove();
    if (this.sk.wm.order.includes(this.w)) this.w.chat?.show(true);
    else if (this.openedItems && this.sk.hud.sheets?.kind === 'items') this.sk.hud.sheets.close();
  }
}

/**
 * Maple Messenger, through its window (kept open: its room, its lines and typing notices): the three seats with who
 * sits there, standing, the room's chat in its colours, who is typing, and a line to type on; Invite, Report and
 * Leave as the window's. It sits at the left, over the status line; it folds to its title.
 */
const MS_SEAT = { w: 64, h: 70, feet: 66 };
class MessengerView {
  constructor(sk, w) {
    this.sk = sk; this.w = w;
    w.field?.show(false);
    const n = this.el = el('div', 'mh-ms mh-glass');
    n.innerHTML = `<div class="mh-tr-head"><span class="mh-sh-title">Messenger</span><span class="mh-sp"></span>
      <div class="mh-btn mh-ms-fold" title="Fold">–</div><div class="mh-btn mh-sh-x" title="Leave">${X_ICON}</div></div>
      <div class="mh-ms-seats"></div><div class="mh-ms-typing"></div><div class="mh-tr-log" data-scroll="y"></div>
      <div class="mh-tr-say"></div><div class="mh-tr-btns"></div>`;
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    const $ = (q) => n.querySelector(q);
    this.p = { seats: $('.mh-ms-seats'), typing: $('.mh-ms-typing'), log: $('.mh-tr-log'), say: $('.mh-tr-say'), btns: $('.mh-tr-btns'), fold: $('.mh-ms-fold') };
    sk.tap($('.mh-sh-x'), () => w.askLeave());
    sk.tap(this.p.fold, () => { const f = n.classList.toggle('mh-folded'); this.p.fold.textContent = f ? '+' : '–'; });
    this.seats = [0, 1, 2].map(() => {
      const s = el('div', 'mh-ms-seat'), cv = el('canvas'), name = el('b'), dots = el('i', null, '…');
      s.append(cv, name, dots); this.p.seats.append(s);
      return { s, cv, name, dots };
    });
    // typing: the window's line follows this one, so its typing notices go as they do
    const i = this.input = textInput(256, '');
    i.enterKeyHint = 'send'; i.placeholder = 'Say something';
    i.addEventListener('input', () => { if (w.field) w.field.value = i.value; });
    keys(i, () => this.send(), () => i.blur());
    this.p.say.append(i, sk.button('Send', () => this.send()));
    this.p.btns.append(sk.button('Invite', async () => {
      const name = (await sk.wm.askText('Who do you want to invite to the chat?', '', { max: 13 }))?.trim();
      if (name) w.inviteByName(name);
    }, 'mh-main'), sk.button('Report', () => w.report()), sk.button('Leave', () => w.askLeave(), 'mh-warn'));
    sk.el.append(n);
  }
  send() {
    const w = this.w;
    if (w.field) w.field.value = this.input.value;
    w.send();
    this.input.value = w.field?.value || '';
  }
  tick(now) {
    if (now - (this.at || 0) < 150) return;
    this.at = now;
    const w = this.w, g = this.sk.g;
    this.seats.forEach((seat, pos) => {
      const m = w.members[pos];
      seat.s.className = `mh-ms-seat${!m ? ' mh-empty-seat' : ''}${m?.me ? ' mh-me' : ''}`;
      if (seat.name.textContent !== (m?.name || 'Empty')) seat.name.textContent = m?.name || 'Empty';
      seat.dots.style.display = m && !m.me && w.typing[pos] ? '' : 'none';
      this.drawSeat(seat, m?.me ? g.look : m?.look, now);
    });
    const typing = w.members.map((m, pos) => (m && !m.me && w.typing[pos] ? m.name : null)).filter(Boolean);
    const t = typing.length ? `${typing.join(', ')} is typing.` : '';
    if (this.p.typing.textContent !== t) this.p.typing.textContent = t;
    const last = w.lines[w.lines.length - 1];
    if (last !== this.logLast || w.lines.length !== this.logN) {
      const log = this.p.log;
      log.replaceChildren(...w.lines.map((l) => { const d = el('div', null, l.text); d.style.color = LOG_COLORS[l.color] || '#e8edf8'; return d; }));
      log.scrollTop = log.scrollHeight;
      this.logLast = last; this.logN = w.lines.length;
    }
  }
  /** Someone in a seat, standing (drawn again now and then, as their look's parts come in). */
  drawSeat(seat, look, now) {
    const cv = seat.cv, dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    if (cv.width !== MS_SEAT.w * dpr) { cv.width = MS_SEAT.w * dpr; cv.height = MS_SEAT.h * dpr; }
    if (seat.look === look && now - (seat.drawn || 0) < 600) return;
    seat.look = look; seat.drawn = now;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, MS_SEAT.w, MS_SEAT.h);
    if (look?.compose) drawParts(ctx, this.sk.g.assets, look.compose(look.standAction(), 0), MS_SEAT.w / 2, MS_SEAT.feet, false);
  }
  destroy() { this.el.remove(); if (this.sk.wm.order.includes(this.w)) this.w.field?.show(true); }
}

/** The Quest Helper's colours for how far along an objective is (made for its white rows), on the dark glass. */
const QA_COLOR = (have, need) => { const p = (have * 100) / (need || 1); return p < 33 ? '#ff8a8a' : p < 66 ? '#ff8ad1' : p < 100 ? '#ffc266' : '#a6f08a'; };
/**
 * The Quest Helper as a little tracker under the buttons, through its window (kept open: its list, Auto, its 10
 * minutes): "Quest Helper (n/5)", Auto, fold and clear; each quest's title (tapped: registered when Auto put it there,
 * else opened in the Quests sheet; x leaves it out of Auto until you log on again) and its objectives.
 */
class QuestHelperView {
  constructor(sk, w) {
    this.sk = sk; this.w = w;
    const n = this.el = el('div', 'mh-qa mh-glass');
    n.innerHTML = `<div class="mh-qa-head"><b></b><span class="mh-sp"></span><span class="mh-qa-auto"></span><div class="mh-btn mh-qa-fold"></div>
      <div class="mh-btn mh-qa-x" title="Clear">${X_ICON}</div></div><div class="mh-qa-body" data-scroll="y"></div>`;
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    const $ = (q) => n.querySelector(q);
    this.p = { title: $('.mh-qa-head b'), auto: $('.mh-qa-auto'), fold: $('.mh-qa-fold'), body: $('.mh-qa-body') };
    sk.tap(this.p.auto, () => { w.state.auto = !w.state.auto; w.save(); this.at = 0; });
    sk.tap(this.p.fold, () => { w.state.min = !w.state.min; w.save(); this.at = 0; });
    sk.tap($('.mh-qa-x'), () => w.clearAll());
    sk.el.append(n);
  }
  tick(now) {
    this.w.update(0);   // Auto's quests going after 10 minutes, as its own draw (skipped) would
    if (now - (this.at || 0) < 300 || this.sk.hud.busy) return;
    this.at = now;
    const w = this.w, s = w.state, list = w.entries();
    const sig = JSON.stringify([s.min, s.auto, s.ids.length, list, this.sk.wm.namesVersion]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.p.title.textContent = `Quest Helper (${s.ids.length}/5)`;
    this.p.auto.textContent = s.auto ? 'Auto on' : 'Auto off';
    this.p.auto.classList.toggle('mh-on', !!s.auto);
    this.p.fold.textContent = s.min || !list.length ? '+' : '\u2013';
    this.el.classList.toggle('mh-folded', !!s.min || !list.length);
    const body = this.p.body;
    body.replaceChildren();
    for (const e of list) {
      const head = el('div', `mh-qa-q${e.blue ? ' mh-auto' : ''}`), name = el('span', null, e.name), x = el('span', 'mh-qa-qx', '\u00d7');
      this.sk.tap(name, () => { if (w.isAutoAdded(e.id)) { w.keep(e.id); this.at = 0; } else this.sk.g.openQuest(e.id); });
      this.sk.tap(x, () => {
        w.excluded.add(e.id); w.remove(e.id);
        this.sk.g.hud.message(`[${this.sk.g.quests.name(e.id)}] It has been excluded from the auto alarm and it will not be automatically reigstered until you re log-on`, '#bbbbbb');
        this.at = 0;
      });
      head.append(name, x);
      body.append(head);
      for (const r of e.rows) {
        const row = el('div', 'mh-qa-r'), right = el('em');
        row.append(el('span', null, r.label));
        if (r.status) { right.textContent = r.status.replace(/[()]/g, ''); right.style.color = r.status.includes('Incomplete') ? '#ff8a8a' : '#a6f08a'; }
        else if (r.amount) { right.textContent = Number(r.amount).toLocaleString('en-US'); right.style.color = r.color === '#336600' ? '#a6f08a' : '#ff8a8a'; }
        else { const h = el('b', null, String(r.have)); h.style.color = QA_COLOR(r.have, r.need); right.append(h, ` / ${r.need}`); }
        row.append(right);
        body.append(row);
      }
    }
  }
  destroy() { this.el.remove(); }
}

/**
 * The World Map (and Find NPC's, from a quest) as a large panel over its window (kept open): the map as the window
 * draws it - its base, spots, the path of the spot picked, where you, your party and your spouse are, a looked-for
 * NPC's marks - scaled to fit; a tap goes into a region, or picks a spot and shows its name, street and words. Back
 * goes up a level; the X closes it.
 */
class WorldMapView {
  constructor(sk, w) {
    this.sk = sk; this.w = w;
    const n = this.el = el('div', 'mh-wm mh-glass');
    n.innerHTML = `<div class="mh-tr-head"><span class="mh-sh-title">World Map</span><span class="mh-wm-where"></span><span class="mh-sp"></span>
      <div class="mh-btn mh-sh-x" title="Close">${X_ICON}</div></div><div class="mh-wm-stage"><canvas></canvas></div><div class="mh-wm-info"></div>`;
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    const $ = (q) => n.querySelector(q);
    this.p = { where: $('.mh-wm-where'), stage: $('.mh-wm-stage'), cv: $('canvas'), info: $('.mh-wm-info') };
    this.back = sk.button('Back', () => { this.spot = null; w.back(); });
    $('.mh-tr-head').insertBefore(this.back, $('.mh-sh-x'));
    sk.tap($('.mh-sh-x'), () => sk.wm.close(w));
    sk.tap(this.p.cv, (e) => this.tapAt(e));
    sk.el.append(n);
  }
  /** Where a tap lands on the map, in the window's own coordinates (its picking takes it from there). */
  tapAt(e) {
    const r = this.p.cv.getBoundingClientRect(), w = this.w;
    if (!r.width || e.clientX === undefined) return;
    const lx = MAP_BOX.x + ((e.clientX - r.left) / r.width) * MAP_BOX.w, ly = MAP_BOX.y + ((e.clientY - r.top) / r.height) * MAP_BOX.h;
    const p = w.pick(lx, ly);
    if (p?.link?.link?.linkMap) { sfx.play('UI/BtMouseClick'); this.spot = null; w.hover = null; w.show(p.link.link.linkMap); return; }
    w.hover = p?.spot ? { spot: p.spot } : null;
    this.spot = p?.spot ? w.tooltip(lx, ly) : null;
    this.info();
  }
  info() {
    const i = this.p.info, t = this.spot;
    i.replaceChildren();
    if (!t) { i.append(el('span', 'mh-wm-hint', 'Tap a region to go in, or a spot to see its name.')); return; }
    i.append(el('b', null, t.title || ''));
    for (const l of t.lines || []) if (l) i.append(el('span', null, l));
  }
  tick(now) {
    const w = this.w, d = w.data;
    if (this.drawnName !== w.name) { this.drawnName = w.name; this.spot = null; this.info(); }
    this.back.disabled = !d?.info?.parentMap;
    const label = d?.info?.parentMap ? '' : 'The whole world';
    if (this.p.where.textContent !== label) this.p.where.textContent = label;
    if (now - (this.drawn || 0) < 66) return;   // (its marks bob: about 15 frames a second)
    this.drawn = now;
    // the biggest it fits in its stage, at the map's own shape
    const st = this.p.stage, sw = st.clientWidth, sh = st.clientHeight;
    if (!sw || !sh) return;
    const k = Math.min(sw / MAP_BOX.w, sh / MAP_BOX.h), cw = Math.floor(MAP_BOX.w * k), ch = Math.floor(MAP_BOX.h * k);
    const cv = this.p.cv, dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); cv.style.width = `${cw}px`; cv.style.height = `${ch}px`;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, -MAP_BOX.x * k * dpr, -MAP_BOX.y * k * dpr);
    ctx.save(); ctx.beginPath(); ctx.rect(MAP_BOX.x, MAP_BOX.y, MAP_BOX.w, MAP_BOX.h); ctx.clip();
    try { w.body(ctx); } finally { ctx.restore(); }
  }
  destroy() { this.el.remove(); }
}

/**
 * A player's info (a double tap on them, or yours) over its window: the character standing with the name under it,
 * their level, job, fame (+ / - as the window allows), guild and alliance; Party, Trade and Family as the window's
 * (Family opening MOBILE UI's own sheet; Party inviting even with no party yet, the server making one first); and their
 * equipment, wish list (Present), pets, mount and Monster Book.
 */
const PI_TABS = [['item', 'Equipment'], ['wish', 'Wish List'], ['pet', 'Pets'], ['mount', 'Mount'], ['book', 'Monster Book']];
class PlayerInfoView {
  constructor(sk, w) {
    this.sk = sk; this.w = w; this.tab = w.info.pets?.length ? 'pet' : 'item';
    const n = this.el = el('div', 'mh-pi mh-glass');
    n.innerHTML = `<div class="mh-tr-head"><span class="mh-sh-title">Character Info</span><span class="mh-sp"></span>
      <div class="mh-btn mh-sh-x" title="Close">${X_ICON}</div></div>
      <div class="mh-pi-top"><div class="mh-pi-side"><div class="mh-stage"></div><div class="mh-name"></div></div><div class="mh-pi-facts"></div></div>
      <div class="mh-pi-acts"></div><div class="mh-seg mh-pi-tabs"></div><div class="mh-pi-body mh-list" data-scroll="y"></div>`;
    n.addEventListener('pointerdown', (e) => e.stopPropagation());
    const $ = (q) => n.querySelector(q);
    this.p = { stage: $('.mh-stage'), name: $('.mh-name'), facts: $('.mh-pi-facts'), acts: $('.mh-pi-acts'), tabs: $('.mh-pi-tabs'), body: $('.mh-pi-body') };
    this.stage = new Stage(this.p.stage, 54, 104);
    sk.tap($('.mh-sh-x'), () => sk.wm.close(w));
    const g = sk.g, other = w.info.id !== g.player.id;
    if (other) {
      // Party invites them whether or not you are in a party yet (the server makes one with you as its leader first)
      this.p.acts.append(sk.button('Party', () => { const name = w.name(); if (name) g.net?.partyOp(4, name); }, 'mh-main'),
        sk.button('Trade', () => { const rp = g.others.get(w.info.id); if (rp) g.requestTrade(rp); }));
    }
    this.p.acts.append(sk.button('Family', () => {
      const sh = sk.hud.sheets, name = w.name();
      sk.wm.close(w);
      if (name === g.player.name) sh.show('family');
      else { sh.tab.family = 'tree'; sk.wm.wins.familytree?.load(name); sh.show('family'); }
    }));
    sk.el.append(n);
  }
  tick(now) {
    const w = this.w, g = this.sk.g, i = w.info, look = i.id === g.player.id ? g.look : g.others.get(i.id)?.look;
    if (look) this.stage.look(g, look);
    if (now - (this.at || 0) < 250 || this.sk.hud.busy) return;
    this.at = now;
    const sig = JSON.stringify([i, w.name(), this.tab, this.sk.wm.namesVersion, !!w.commodity, w.fameUp.enabled]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.render();
  }
  render() {
    const w = this.w, sk = this.sk, g = sk.g, i = w.info, p = this.p, wm = sk.wm;
    p.name.textContent = `${i.married ? '\u2665 ' : ''}${w.name()}`;
    const kv = (label, ...value) => { const r = el('div', 'mh-kv'), e = el('em'); e.append(...value); r.append(el('span', null, label), e); return r; };
    const fame = [String(i.fame)];
    if (w.fameUp.enabled) {
      const up = el('button', 'mh-plus', '+'), down = el('button', 'mh-plus mh-minus', '\u2212');
      up.type = down.type = 'button';
      sk.tap(up, () => g.giveFame(w.name(), 1)); sk.tap(down, () => g.giveFame(w.name(), 0));
      fame.push(down, up);   // (- then +)
    }
    p.facts.replaceChildren(kv('Level', String(i.level)), kv('Job', jobName(i.job)), kv('Fame', ...fame), kv('Guild', i.guild || '-'), kv('Alliance', i.alliance || '-'));
    // the lists, one at a time
    p.tabs.replaceChildren(...PI_TABS.map(([k, label]) => {
      const b = el('button', `mh-tab${k === this.tab ? ' mh-on' : ''}`, label);
      b.type = 'button';
      sk.tap(b, () => { this.tab = k; this.sig = ''; this.at = 0; });
      return b;
    }));
    const body = p.body, keep = this.shownTab === this.tab ? body.scrollTop : 0;
    body.replaceChildren();
    const row = (icon, name, sub, extra) => {
      const r = el('div', 'mh-li'), m = el('div', 'mh-li-main');
      if (icon !== undefined) { const c = el('div', 'mh-ico'); c.append(sk.img(icon)); r.append(c); }
      m.append(el('div', 'mh-li-name', name)); if (sub) m.append(el('div', 'mh-li-sub', sub));
      r.append(m); if (extra) r.append(extra);
      body.append(r);
    };
    const none = (t) => body.append(el('div', 'mh-empty', t));
    if (this.tab === 'item') {
      const ids = w.equipped();
      if (!ids.length) none('Nothing equipped that shows.');
      for (const id of ids) row(wm.icon(id), wm.itemName(id) || '...', wm.info(id)?.reqLevel ? `Req. Lv. ${wm.info(id).reqLevel}` : '');
    } else if (this.tab === 'wish') {
      const list = w.wishItems();
      if (!(i.wish || []).length) none('The wish list is empty.');
      else if (!list.length) none('Loading the wish list...');
      w.sideFirst = 0;
      list.forEach((c, k) => {
        const give = w.canPresent(k) ? sk.button('Present', () => w.present(k), 'mh-main') : null;
        row(wm.icon(c.ItemId), `${wm.itemName(c.ItemId) || '...'}${c.Count > 1 ? ` \u00d7${c.Count}` : ''}`, `${Number(c.Price || 0).toLocaleString('en-US')} NX`, give);
      });
    } else if (this.tab === 'pet') {
      const pets = i.pets || [];
      if (!pets.length) none('No pets are out.');
      for (const pt of pets) row(wm.icon(pt.id), pt.name, `${wm.itemName(pt.id) || 'Pet'} \u00b7 Lv. ${pt.level} \u00b7 Closeness ${pt.closeness} \u00b7 Fullness ${pt.fullness}`);
    } else if (this.tab === 'mount') {
      const t = i.mount, { shown } = w.slots(), ids = [18, 19, 20].map(shown).filter((id) => [190, 191].includes(Math.floor(id / 10000)));
      if (!t) none('No taming mob.');
      else {
        const mount = ids.find((id) => Math.floor(id / 10000) === 190);
        row(mount ? wm.icon(mount) : null, mount ? wm.itemName(mount) || 'Taming mob' : 'Taming mob', `Lv. ${t.level} \u00b7 EXP ${t.exp} \u00b7 Tiredness ${t.tiredness}`);
        for (const id of ids.filter((x) => x !== mount)) row(wm.icon(id), wm.itemName(id) || '...', '');
      }
    } else {
      const b = i.book || {};
      body.append(kv('Book level', String(b.level ?? 0)), kv('Cover', b.cover ? wm.strings.mob?.[b.cover]?.name || '-' : '-'),
        kv('Cards', `${b.total ?? 0} (${b.normal ?? 0} normal, ${b.special ?? 0} special)`));
      if (i.medal) row(wm.icon(i.medal), wm.itemName(i.medal) || 'Medal', 'Medal worn');
      const quests = i.medalQuests || [];
      body.append(el('div', 'mh-sec', `Medal quests: ${quests.length}`));
      for (const q of quests) body.append(el('div', 'mh-dt-text', g.quests?.name(q) || `Quest ${q}`));
    }
    body.scrollTop = keep; this.shownTab = this.tab;
  }
  destroy() { this.el.remove(); }
}

const VIEWS = { box: BoxView, shop: ShopView, storage: StorageView, trade: TradeView, toast: ToastView, messenger: MessengerView, questhelper: QuestHelperView, worldmap: WorldMapView,
  charinfo: PlayerInfoView };
