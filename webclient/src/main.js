import { Assets } from './assets.js';
import { CharacterLook, loadZmap, lookCanvases } from './character.js';
import { Game, equippedIds } from './game.js';
import { LoginFlow, bridgeUrl } from './ui/login-ui.js';
import { LoginScene } from './ui/login-scene.js';
import { ChannelSession } from './net/channel.js';
import { wsTransport } from './net/connection.js';
import { modal } from './ui/dom.js';

const PRELOAD = ['stand1', 'stand2', 'walk1', 'walk2', 'jump', 'prone', 'ladder', 'rope', 'alert',
  'swingO1', 'swingO2', 'swingO3', 'stabO1', 'swingT1', 'swingT2', 'swingT3', 'stabT1', 'swingP1', 'swingP2'];

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

function loadingHooks() {
  const overlay = $('loading-overlay');
  return {
    onLoading: (on, text) => { overlay.classList.toggle('hidden', !on); if (text) $('loading-text').textContent = text; },
    onError: (msg) => modal({ title: 'Error', body: msg, buttons: ['OK'] }),
  };
}

async function online(assets) {
  $('loading-overlay').classList.add('hidden');
  document.body.classList.add('at-login');
  // ?classic=0 keeps the plain HTML login (handy on very small screens)
  const pick = params.get('classic') === '0'
    ? await new LoginFlow($('login-root'), assets).run()
    : await new LoginScene($('login-root'), assets).run();
  $('login-root').replaceChildren();
  document.body.classList.remove('at-login');

  const hooks = loadingHooks();
  hooks.onLoading(true, 'Connecting to channel...');
  const net = new ChannelSession(wsTransport(bridgeUrl(pick.server, pick.port)));
  await net.ready();
  const entered = await net.enter(pick.charId);
  const s = entered.info.stats;
  hooks.onLoading(true, 'Loading character...');
  const look = new CharacterLook(assets, { skin: s.skin, face: s.face, hair: s.hair, equips: equippedIds(entered.info.inventory.equipped) });
  await look.load();
  await assets.preload(lookCanvases(look, PRELOAD));

  const game = new Game($('game-canvas'), assets, look, hooks, net);
  Object.assign(game, { server: pick.server, worldId: pick.world, channel: entered.channel ?? pick.channel, channelCount: pick.channels || 1 });
  if (new URLSearchParams(location.search).has('debug')) globalThis.maple = game; // inspect from the console
  await game.goOnline(entered, $('ui-root'));
  game.start();
  assets.preload(lookCanvases(look, look.actionList())); // every body action, for skills
  window.game = game;
}

async function offline(assets) {
  document.body.classList.add('offline');
  const hooks = loadingHooks();
  hooks.onLoading(true, 'Loading character...');
  const look = new CharacterLook(assets, { skin: 0, face: 20000, hair: 30030, equips: [1040002, 1060002, 1072001, 1302000] });
  await look.load();
  await assets.preload(lookCanvases(look, PRELOAD));
  const game = new Game($('game-canvas'), assets, look, {
    ...hooks,
    onMap: (map) => { $('hud-map').textContent = map.name; $('hud-id').textContent = map.id; },
  });
  await game.changeMap(Number(params.get('map')) || 100000000);
  game.start();
  $('map-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Number($('map-input').value);
    if (v) game.changeMap(v);
    $('map-input').blur();
  });
  window.game = game;
}

async function main() {
  const assets = new Assets('/assets');
  await loadZmap(assets);
  if (params.has('offline') || params.has('map')) await offline(assets);
  else await online(assets);
}

main().catch((e) => {
  console.error(e);
  $('loading-overlay').classList.remove('hidden');
  $('loading-text').textContent = `Error: ${e.message}`;
});
