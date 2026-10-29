# Voyage Client

A MapleStory **v83** (GMS) browser client — pure JavaScript, no WASM.

```
maplestory-v83/
├── webclient/            # the browser client
│   ├── server.js         # Express server + WS↔TCP relay to the Cosmic v83 server
│   ├── index.html
│   ├── src/
│   │   ├── game.js       # game loop, combat, mobs, portals, camera
│   │   ├── map.js        # map rendering + physics
│   │   ├── character.js  # look/equipment/animation
│   │   ├── assets.js     # WZ JSON loader, UOL resolution, image cache
│   │   ├── audio.js      # Sound.wz BGM
│   │   ├── effects.js    # chat balloons, boss gage, quest icons
│   │   ├── skills.js, quests.js, pets.js, physics.js, ...
│   │   ├── net/          # AES-OFB crypto, packet framing, opcodes, login, channel
│   │   └── ui/           # v83 login scene, shop, minimap, status bar, dialogs, HUD
│   └── test/login-test.mjs  # headless protocol test
├── .gitignore            # assets/ is excluded (regenerated)
└── README.md
```

## Requirements

- Node.js ≥ 18
- A folder of MapleStory v83 GMS `*.wz` files
- (Optional) a Cosmic v83 server to log in and play against

## 1. Extract assets

The WZ extractor lives in a separate repo: **[voyage-wz-extractor](https://github.com/xcomcadx/voyage-wz-extractor)** (pure Node, zero deps).

```sh
git clone https://github.com/xcomcadx/voyage-wz-extractor
# all WZs
node voyage-wz-extractor/tools/wz-extract.mjs <path-to-wz-folder> assets

# only some WZs
node voyage-wz-extractor/tools/wz-extract.mjs <path-to-wz-folder> assets Character Mob Map Sound

# one IMG (fast)
node voyage-wz-extractor/tools/wz-extract.mjs <path-to-wz-folder> assets --only=Character/00002000

# JSON only, or resume a partial run
node voyage-wz-extractor/tools/wz-extract.mjs <path-to-wz-folder> assets --json-only
node voyage-wz-extractor/tools/wz-extract.mjs <path-to-wz-folder> assets --resume
```

Extractor features: auto version detection (v83: hash `0x754`, enc byte 172),
encrypted strings + encrypted canvas blocks, all pixel formats (BGRA4444,
BGRA8888, RGB565, 16×16 block RGB565, DXT3, DXT5), UOL / Vector2D / Convex2D,
sounds as MP3 or proper WAV.

## 2. Run the server

```sh
cd webclient
node server.js
# → http://localhost:3000
```

Point it at a Cosmic server by setting `COSMIC_HOST` / `COSMIC_PORT` (or edit
the relay defaults in `server.js`). The browser talks to the server over
WebSocket; the server relays to the Cosmic TCP port with the v83 AES-OFB
crypto + IV shuffle.

## 3. Play

Open `http://localhost:3000`, log in, pick a channel, pick a character.

Offline asset viewer (no server needed): `http://localhost:3000/?offline=1&map=100000000`

## Protocol notes

- SET_FIELD must be followed by PLAYER_MAP_TRANSFER (not PLAYER_ENTER_MAP).
- Sending fixdamage with wrong values autobans the character — the client only
  sends what the server expects.
- See `webclient/src/net/opcodes.js` for the full opcode table.

## Credits

- **Author:** [xcomcadx](https://github.com/xcomcadx)
- WZ format reference: NoLifeWzToNx
- Server: Cosmic v83

## License

MIT. The WZ extractor is published separately as
[voyage-wz-extractor](https://github.com/xcomcadx/voyage-wz-extractor).
