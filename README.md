# Voyage Client

A MapleStory **v83** (GMS) browser client — pure JavaScript. (Fully compatible with cosmic server)

Work in progress...

<div align="center">
  <table width="700" align="center">
    <tr>
      <td align="center" width="60%">
        <img src="https://github.com/user-attachments/assets/0ab3508f-e043-4bbb-836f-059d923dc950" width="500" alt="Screenshot" /><br>
        <sub><b>Login</b></sub>
      </td>
      <td align="center" width="100%">
        <img src="https://github.com/user-attachments/assets/6186adc4-f108-4558-9588-0c0362da9c00" width="500" alt="IMG_1494" /><br>
        <sub><b>In-Game</b></sub>
      </td>
    </tr>
  </table>
</div>

```
maplestory-v83/
├── assets/* 
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
- A Cosmic v83 server to log in and play against

## 1. Extract assets

The WZ extractor lives in a separate repo: **[voyage-wz-extractor](https://github.com/xcomcadx/voyage-wz-extractor)** (pure Node, zero deps).

```sh
- git clone https://github.com/xcomcadx/voyage-wz-extractor
- cd voyage-wz-extractor
- mkdir assets
- node wz-extract.mjs <path-to-wz-folder> ./assets
- copy assets folder to the root of the client folder next to the webclient folder
```


## 2. Run the server

```sh
cd webclient
node server.js
# → http://localhost:3000
```

Point it at a Cosmic server by setting `COSMIC_HOST` / `COSMIC_PORT` (or edit
the relay defaults in `server.js`).

## 3. Play

Open `http://localhost:3000`, log in, pick a channel, pick a character.


## Protocol notes

- SET_FIELD must be followed by PLAYER_MAP_TRANSFER (not PLAYER_ENTER_MAP).
- Sending fixdamage with wrong values autobans the character — the client only
  sends what the server expects.

## Credits

- **Author:** [xcomcadx](https://github.com/xcomcadx)
- Server: Cosmic v83

## License

MIT. The WZ extractor is published separately as
[voyage-wz-extractor](https://github.com/xcomcadx/voyage-wz-extractor).
