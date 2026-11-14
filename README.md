<div align="center">

<img src="https://github.com/user-attachments/assets/f3327f7f-5a19-403d-b881-d540287cdf14" width="120" height="120" alt="Voyage MapleStory web client logo" />

# Voyage Client: Version 83 Web Client

**An open-source Version 83 web client that runs in your browser.**
Pure JavaScript · Part of Voyage, with Voyage-Server and Voyage-Editor

<br />

![Status](https://img.shields.io/badge/status-alpha-yellow?style=for-the-badge)
![License](https://img.shields.io/github/license/comcad/Voyage-Client?style=for-the-badge)

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2018-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white)
[![Voyage-Server](https://img.shields.io/badge/Server-Voyage--Server-blue?style=flat-square)](https://github.com/comcad/Voyage-Server)
[![Stars](https://img.shields.io/github/stars/comcad/Voyage-Client?style=flat-square&logo=github)](https://github.com/comcad/Voyage-Client/stargazers)
[![Forks](https://img.shields.io/github/forks/comcad/Voyage-Client?style=flat-square&logo=github)](https://github.com/comcad/Voyage-Client/forks)
[![Last commit](https://img.shields.io/github/last-commit/comcad/Voyage-Client?style=flat-square)](https://github.com/comcad/Voyage-Client/commits/main)

<img width="1440" height="809" alt="MapleStory web client screenshot: Voyage Client running MapleStory v83 in a browser" src="https://github.com/user-attachments/assets/cd54cd23-7aa3-4436-8568-8e955ca61fab" />

</div>

<br />

**Voyage Client** is an open-source **Version 83 web client**. It brings the classic Version 83 client to modern web browsers using pure JavaScript, so players can open a URL and play without installing a desktop Version 83 Client. It plays on [Voyage-Server](https://github.com/comcad/Voyage-Server), its v83 game server.

The repository contains the browser game, the small Node.js server that serves it and relays players to the game server, and a Dockerfile for running it.

> [!WARNING]
> Voyage Client is in **alpha**. Expect rough edges, and some classes and skills are still being worked on.

## 🧭 The Voyage Projects

Voyage is four projects that work together, all reading one assets folder made from your own game files:

| Project | What it does |
|---|---|
| **Voyage-Client** (this one) | The web client: serves the game to browsers and relays them to the game server |
| [Voyage-Server](https://github.com/comcad/Voyage-Server) | The game server: reads the same assets, with an admin page |
| [Voyage-Editor](https://github.com/comcad/Voyage-Editor) | The map, item, NPC and quest editor: publishes what you make into the assets' `customs` folder |
| [Voyage-Wz-Extractor](https://github.com/comcad/Voyage-Wz-Extractor) | Turns your own `.wz` files into the assets folder the other three read |

```
voyage-assets/                 # made by the extractor from your own .wz files
├── Map/ Npc/ String/ ...
└── customs/                   # what Voyage-Editor publishes: files that stand in for the assets' own
Voyage-Client/  Voyage-Server/  Voyage-Editor/    # each pointed at ../voyage-assets
```

## ✨ Features of the MapleStory Web Client

| | Area | What's included |
|---|---|---|
| 🔐 | **Login & account** | v83 login scene, PIN, PIC soft keyboard, world / channel / character select, server-ban and client-update notices |
| 🗺️ | **Maps** | Full map rendering from extracted WZ, NPCs, portals, ladders and ropes, reactors, weather, ranking statues, forced map equipment, obstacles and traps |
| ⚔️ | **Combat** | Monster spawns, deaths, statuses and immunities, auto-aggro and banishing monsters, damage and hit rules, multi-line attacks, buffs and curses |
| 🪄 | **Skills** | Every class line, including the full Pirate line (Pirate → Corsair, Brawler → Outlaw, Marauder → Gunslinger) and Thunder Breaker skills, plus the skill macro editor and quick slots |
| 👹 | **Bosses** | Boss HP bar, plus Horntail and Zakum parts (order, boxes, icons, and hits landing on the part struck) |
| 🪟 | **Windows** | Inventory, stats, trade, Maker, Dojo, Pyramid, Transform, Cash Shop, Player Shop (MTS), guild (alliance invitations), party, messenger and world map |
| 💬 | **Social** | Give and take fame from other players |
| 🌊 | **Aran** | Energy charge and combo count |
| 📱 | **Touch & gamepad** | Play on phones and touch screens with drag-arrangeable touch controls, plus gamepad support |
| 🎛️ | **Settings** | Server and quality-of-life options in `conf/client.conf` (see [Settings](#%EF%B8%8F-settings)) |

## 🧩 How the MapleStory Client Works in a Browser

```
┌──────────────────┐   WebSocket   ┌──────────────────┐     TCP     ┌──────────────────┐
│     Browser      │ ◄───────────► │    server.js     │ ◄─────────► │  Voyage-Server   │
│   (Voyage.js)    │               │  Express + relay │             │   game server    │
└──────────────────┘               └────────▲─────────┘             └────────▲─────────┘
                                            │ reads                    reads │
                                   ┌────────┴────────────────────────────────┴──┐
                                   │  voyage-assets/  (extracted WZ: JSON, PNG) │
                                   │  └── customs/  ◄── Voyage-Editor publishes │
                                   └────────────────────────────────────────────┘
```

The browser talks to `server.js` over WebSocket. The server relays that traffic over TCP to the game server and serves the assets, with the `customs` folder's files in place of the assets' own. Voyage-Server reads the same folder, so players and the game server see the same game.

## 📋 Requirements

- A folder of Version 83 `*.wz` files (your own)
- [Voyage-Server](https://github.com/comcad/Voyage-Server) to log in and play against
- **Either** Node.js ≥ 18 **or** Docker

## 🚀 Quick Start: Run the Voyage-Client

### 1. Clone the repo

```sh
git clone https://github.com/comcad/Voyage-Client.git
cd Voyage-Client
```

### 2. Extract assets

The WZ extractor lives in its own repo: **[Voyage-Wz-Extractor](https://github.com/comcad/Voyage-Wz-Extractor)** (pure Node, zero dependencies).

> [!NOTE]
> Use your own Version 83 `.wz` files.

```sh
cd ..                                # beside Voyage-Client, not inside it
git clone https://github.com/comcad/Voyage-Wz-Extractor
cd Voyage-Wz-Extractor
node wz-extract.mjs <path-to-wz-folder> ../voyage-assets
cd ../Voyage-Client
```

The assets folder is shared: Voyage-Client, [Voyage-Server](https://github.com/comcad/Voyage-Server) and
[Voyage-Editor](https://github.com/comcad/Voyage-Editor) all point at the same one (here `voyage-assets`, beside
the three repos; `Server.AssetsDir` in `conf/client.conf`). Its `customs` folder is where the editor publishes: see
[Customs](#-customs).

### 3. Run it

<details>
<summary><b>🐳 Option A: Docker</b></summary>

<br />

Builds the image (installs dependencies and bundles the client), then runs it with the assets folder mounted in. It uses **host networking** so it reaches the game server on your machine or LAN and binds `Server.Port` directly.

```sh
cd Voyage-Client
docker compose up --build -d
# → http://<your-host-ip>:3000
```

Manage it with `docker compose logs -f`, `docker compose restart` and `docker compose down`. Settings live in `conf/client.conf`, mounted into the container (see [Settings](#%EF%B8%8F-settings)); the assets folder is `../voyage-assets` unless `VOYAGE_ASSETS` says otherwise (a `.env` file beside `docker-compose.yml` will do).

</details>

<details>
<summary><b>🟢 Option B: Node directly</b></summary>

<br />

```sh
cd Voyage-Client
npm install          # if you haven't already
node server.js
# → http://localhost:3000
```

The server bundles the client (`src/main.js` → `public/Voyage.js`) on boot via `build.mjs`. Point it at the game server with `Relay.Servers` in `conf/client.conf` (see [Settings](#%EF%B8%8F-settings)). Run `node build.mjs` to rebuild the bundle on its own.

On start the server also packs your character, NPC, monster and tile-set files into sheets, so crowds and towns load in far fewer requests. The first start takes a little longer; the sheets are kept in `cache/` (delete it any time, it is made again) and your assets folder is never written to. Turn it off with `Server.Sheets = false`.

</details>

### 4. Play

Open `http://<host>:3000`, log in, pick a channel, pick a character. 🎮

## ⚙️ Settings

`conf/client.conf` (TOML) holds every setting. The server creates it from the tracked `conf/client.conf.dist` on first start; that template documents each key and its default. `client.conf` is gitignored, so your settings stay local.

Other `conf/*.conf` files are read too (each key in only one file), and `node server.js --conf <dir>` reads another folder. **Restart the server after a change.**

| Key | Default | Meaning |
|---|---|---|
| `Server.Host` | `"0.0.0.0"` | Address the client listens on |
| `Server.Port` | `3000` | Port the client listens on |
| `Server.AssetsDir` | `"../voyage-assets"` | The assets folder the extractor made, shared with Voyage-Server and Voyage-Editor, relative to `server.js`; its `customs` folder is served in front of it |
| `Server.Sheets` | `true` | Pack each character file's, NPC's, monster's and tile set's images into a few sheets (made from your assets on start) |
| `Server.CacheDir` | `"cache"` | Where the server keeps the sheets it makes, relative to `server.js` |
| `Relay.Servers` | `"gameserver=127.0.0.1"` | `name=host` pairs, comma-separated. First is default |
| `Build.Obfuscate` | `false` | Minify + obfuscate the bundle |
| `Account.SkipBirthdayCode` | `false` | Send `Account.BirthdayCode` instead of asking for the birthday code |
| `Account.BirthdayCode` | `20050511` | The code sent when the prompt is skipped (`YYYYMMDD`) |
| `Buffs.ShowTimeLeft` | `false` | Show time left under each buff icon |
| `Combat.NoWhack` | `false` | Bows, crossbows, claws and guns never swing at close monsters |
| `Ladders.ClimbSpeedMultiplier` | `1.0` | Climbing speed on ladders and ropes, 1.0 to 3.0 |
| `Login.TypePic` | `false` | Type your PIC on the keyboard as well as clicking it |
| `Monsters.BossHpPercent` | `false` | Show the boss's HP % on the boss HP bar |
| `Skills.ShowCooldownTime` | `false` | Show time left on quick slot skill cooldowns |

## 🗂️ Customs

The assets folder's `customs` folder holds changes and additions to the game's data, laid out like the assets folder
itself:

```
voyage-assets/
├── Map/ Npc/ String/ ...          # the game's own, as the extractor made them
└── customs/
    ├── Map/Map/Map1/100000000.img.json      # served in place of the assets' own Henesys
    ├── Map/Map/Map9/990000001.img.json      # a map of your own: only customs has it
    ├── String/Map.img.json                  # the names, with yours in them
    └── Npc/_custom/npcs/guide.png           # a picture of your own
```

A file in `customs` is served in place of the assets' file of the same name, and one only `customs` has is served as
well. [Voyage-Editor](https://github.com/comcad/Voyage-Editor) writes them when you publish, and
[Voyage-Server](https://github.com/comcad/Voyage-Server) reads the same files, so players and the game server see the
same game. The client looks at `customs` again whenever a page asks for its settings (a couple of seconds apart at
most), and players get a changed file the next time they change maps; restarting the client does no harm either.
The assets folder itself is only ever read. Delete a file from `customs` and the game is as the assets have it again.

## 📁 Project Layout

<details>
<summary><b>Click to expand the directory tree</b></summary>

```
voyage-assets/            # Extracted assets json and image files
Voyage-Client/
├── cache/                # sheets the server makes from your assets on start: gitignored
├── public/
│   ├── index.html
│   ├── style.css
│   ├── FrameWorker.js    # worker that puts character frames together off the page's thread (/fps worker)
│   └── Voyage.js         # built client bundle: gitignored, generated at build/boot
├── src/
│   ├── main.js           # entry point
│   ├── game.js           # game loop, combat, mobs, portals, camera
│   ├── map.js            # map rendering + physics
│   ├── character.js      # look / equipment / animation
│   ├── assets.js         # WZ JSON loader, UOL resolution, image cache
│   ├── audio.js          # Sound.wz BGM
│   ├── effects.js        # chat balloons, boss gage, quest icons
│   ├── skills.js, quests.js, pets.js, physics.js, reactors.js, ...
│   ├── net/              # crypto, packet framing, opcodes, login, channel
│   └── ui/               # v83 login scene, shop, minimap, status bar, dialogs, HUD
├── conf/
│   ├── client.conf.dist  # settings template; server.js creates client.conf from it
│   └── client.conf       # your local config (gitignored)
├── server.js             # Express server + WS↔TCP relay to the game server
├── build.mjs             # bundles src/ → public/Voyage.js (esbuild, optional obfuscation)
├── configmgr.mjs         # reads conf/*.conf (TOML)
├── serverconfigs.mjs     # server.js's settings
├── sheets.mjs            # packs character, NPC, monster and tile-set images into sheets (made on start, kept in cache/)
├── png.mjs               # the small PNG reader/writer sheets.mjs uses
├── customs.mjs           # the assets' customs folder: what it changes, served in front of the assets
├── package.json          # Node dependencies
├── Dockerfile, docker-compose.yml, .dockerignore
├── LICENSE.txt
├── .gitignore            # assets/, test/, node_modules/ are excluded
└── README.md
```

</details>

## ❓ FAQ

<details>
<summary><b>What is a Voyage web client?</b></summary>

<br />

A Voyage web client is a version 83 game client that runs inside a web browser instead of as a downloaded desktop program. Voyage Client is a version 83 web client written in pure JavaScript.

</details>

<details>
<summary><b>Can I play Voyage-Client in my browser?</b></summary>

<br />

Yes, with Voyage Client. It renders maps, characters, monsters, and the v83 UI in the browser and connects to a compatible server: [Voyage-Server](https://github.com/comcad/Voyage-Server), which reads the same assets.

</details>

<details>
<summary><b>Does it work on phones and tablets?</b></summary>

<br />

Yes. It includes drag-arrangeable touch controls for phones and touch screens, plus gamepad support.

</details>

<details>
<summary><b>Where do the game assets come from?</b></summary>

<br />

You supply your own version 83 `.wz` files. The [Voyage-Wz-Extractor](https://github.com/comcad/Voyage-Wz-Extractor) converts them to JSON and PNG, into the assets folder the client, the server and the editor share.

</details>

<details>
<summary><b>How do I change maps, items, NPCs or quests?</b></summary>

<br />

With [Voyage-Editor](https://github.com/comcad/Voyage-Editor). Publishing writes the changed files into the assets' `customs` folder: players get them the next time they change maps, and Voyage-Server reads them when it restarts. Delete a file from `customs` and the game is as the assets have it again.

</details>

## 💬 Community

Questions, feedback, or want to help test? Come hang out on Discord.

[![Discord](https://img.shields.io/badge/Discord-discord.gg%2FSCVxm6tB4g-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/SCVxm6tB4g)

## 🙏 Credits

- **Server:** [Voyage-Server](https://github.com/comcad/Voyage-Server)

## 📄 License

- **License:** [MIT](LICENSE.txt) 


## ⚠️ Disclaimer

### No Game Assets Included
This repository contains **no** copyrighted Nexon assets. That includes `.wz` files, extracted images, audio, maps, and any other game data. It contains only original source code written by the contributors.

To use this software, you must supply your own legally obtained copy of the game files. You are solely responsible for ensuring you have the legal right to possess and use them. The contributors do not provide, host, link to, or distribute these files and will not assist in obtaining them.

### Intended Use
This software is provided for educational, research, and interoperability purposes, and for use with self-hosted servers on a private, non-commercial basis. It is not intended to circumvent any technological protection measure, to replace or compete with any official Nexon product or service, or to be used for commercial gain.

The contributors do not sell this software, charge for access, or accept payment for in-game items or advantages. Anyone who does so with this software acts on their own account and at their own risk.

### License Scope
The MIT license in this repository applies **only** to the original source code written by the contributors. It grants no rights to any Nexon trademarks, assets, or other intellectual property.

### No Warranty
THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY ARISING FROM THE USE OF THIS SOFTWARE.

### Your Responsibility
You are responsible for complying with all applicable laws and with any license or terms of service that apply to the game files and servers you use.


<div align="right">

[⬆ Back to top](#voyage-client)

</div>
