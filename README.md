<div align="center">

<img src="https://github.com/user-attachments/assets/f3327f7f-5a19-403d-b881-d540287cdf14" width="120" height="120" alt="Voyage MapleStory web client logo" />

# Voyage Client: MapleStory Web Client

**An open-source MapleStory v83 (GMS) web client that runs in your browser.**
Pure JavaScript · Fully compatible with [Cosmic](https://github.com/P0nk/Cosmic)

<br />

![MapleStory v83](https://img.shields.io/badge/MapleStory-v83%20GMS-orange?style=for-the-badge)
![Status](https://img.shields.io/badge/status-alpha-yellow?style=for-the-badge)
![License](https://img.shields.io/github/license/comcad/Voyage-Client?style=for-the-badge)

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2018-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white)
![Cosmic v83](https://img.shields.io/badge/Server-Cosmic%20v83-blue?style=flat-square)
[![Stars](https://img.shields.io/github/stars/comcad/Voyage-Client?style=flat-square&logo=github)](https://github.com/comcad/Voyage-Client/stargazers)
[![Forks](https://img.shields.io/github/forks/comcad/Voyage-Client?style=flat-square&logo=github)](https://github.com/comcad/Voyage-Client/forks)
[![Last commit](https://img.shields.io/github/last-commit/comcad/Voyage-Client?style=flat-square)](https://github.com/comcad/Voyage-Client/commits/main)

<img width="1440" height="809" alt="MapleStory web client screenshot: Voyage Client running MapleStory v83 in a browser" src="https://github.com/user-attachments/assets/cd54cd23-7aa3-4436-8568-8e955ca61fab" />

</div>

<br />

**Voyage Client** is an open-source **MapleStory web client** for **v83 (GMS)**. It brings the classic MapleStory client to modern web browsers using pure JavaScript, so players can open a URL and play without installing a desktop MapleStory client. It is designed to work with the **Cosmic** v83 server.

The repository contains the Node.js build tools, the local web services used by the browser runtime, and Docker entrypoints for running the whole stack.

> [!WARNING]
> Voyage Client is in **alpha**. Expect rough edges, and some classes and skills are still being worked on.

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
│     Browser      │ ◄───────────► │    server.js     │ ◄─────────► │   Cosmic v83     │
│   (Voyage.js)    │               │  Express + relay │             │   game server    │
└──────────────────┘               └────────▲─────────┘             └──────────────────┘
                                            │
                                   ┌────────┴─────────┐
                                   │     assets/      │
                                   │  (extracted WZ)  │
                                   └──────────────────┘
```

The browser talks to `server.js` over WebSocket. The server relays that traffic over TCP to your Cosmic server and serves the extracted WZ assets.

## 📋 Requirements

- A folder of MapleStory v83 GMS `*.wz` files (use the Cosmic-provided WZ for full compatibility)
- A **Cosmic v83** server to log in and play against
- **Either** Node.js ≥ 18 **or** Docker

## 🚀 Quick Start: Run the MapleStory Web Client

### 1. Clone the repo

```sh
git clone https://github.com/comcad/Voyage-Client.git
cd Voyage-Client
```

### 2. Extract assets

The WZ extractor lives in its own repo: **[Voyage-Wz-Extractor](https://github.com/comcad/Voyage-Wz-Extractor)** (pure Node, zero dependencies).

> [!NOTE]
> Use the `.wz` files provided by Cosmic for full compatibility.

```sh
git clone https://github.com/comcad/Voyage-Wz-Extractor
cd Voyage-Wz-Extractor
node wz-extract.mjs <path-to-wz-folder> ./assets
# then copy the ./assets folder into the root of Voyage-Client
```

### 3. Run it

<details>
<summary><b>🐳 Option A: Docker (recommended)</b></summary>

<br />

Builds the image (installs dependencies and bundles the client), then runs it with the assets folder mounted in. It uses **host networking** so it can reach the Cosmic server on your LAN and bind `:3000` directly.

```sh
cd Voyage-Client
docker compose up --build -d
# → http://<your-host-ip>:3000
```

Manage it with:

```sh
docker compose logs -f      # tail logs
docker compose restart      # restart
docker compose down         # stop
```

Settings live in `conf/client.conf`, which is mounted into the container (see [Settings](#%EF%B8%8F-settings)).

> [!TIP]
> The assets folder is **not** baked into the image. It's mounted read-only from `./assets` at the repo root, so the image stays small and you can swap WZ files freely.

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

The server bundles the client (`src/main.js` → `public/Voyage.js`) on boot via `build.mjs`. Point it at your Cosmic server with `Relay.Servers` in `conf/client.conf` (see [Settings](#%EF%B8%8F-settings)). Run `node build.mjs` to rebuild the bundle on its own.

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
| `Server.AssetsDir` | `"assets"` | The extracted WZ folder, relative to `server.js` |
| `Relay.Servers` | `"cosmic=192.168.2.2"` | `name=host` pairs, comma-separated. First is default |
| `Build.Obfuscate` | `false` | Minify + obfuscate the bundle |
| `Account.SkipBirthdayCode` | `false` | Send `Account.BirthdayCode` instead of asking for the birthday code |
| `Account.BirthdayCode` | `20050511` | The code sent when the prompt is skipped (`YYYYMMDD`) |
| `Buffs.ShowTimeLeft` | `false` | Show time left under each buff icon |
| `Combat.NoWhack` | `false` | Bows, crossbows, claws and guns never swing at close monsters |
| `Ladders.ClimbSpeedMultiplier` | `1.0` | Climbing speed on ladders and ropes, 1.0 to 3.0 |
| `Login.TypePic` | `false` | Type your PIC on the keyboard as well as clicking it |
| `Monsters.BossHpPercent` | `false` | Show the boss's HP % on the boss HP bar |
| `Skills.ShowCooldownTime` | `false` | Show time left on quick slot skill cooldowns |

## 📁 Project Layout

<details>
<summary><b>Click to expand the directory tree</b></summary>

```
Voyage-Client/
├── assets/               # extracted WZ (JSON + PNG): gitignored, generated by the extractor
├── public/
│   ├── index.html
│   ├── style.css
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
├── server.js             # Express server + WS↔TCP relay to the Cosmic v83 server
├── build.mjs             # bundles src/ → public/Voyage.js (esbuild, optional obfuscation)
├── configmgr.mjs         # reads conf/*.conf (TOML)
├── serverconfigs.mjs     # server.js's settings
├── package.json          # Node dependencies
├── LICENSE.txt
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .gitignore            # assets/, test/, node_modules/ are excluded
└── README.md
```

</details>

## ❓ FAQ

<details>
<summary><b>What is a MapleStory web client?</b></summary>

<br />

A MapleStory web client is a version of the MapleStory game client that runs inside a web browser instead of as a downloaded desktop program. Voyage Client is a MapleStory v83 web client written in pure JavaScript.

</details>

<details>
<summary><b>Can I play MapleStory in my browser?</b></summary>

<br />

Yes, with Voyage Client. It renders maps, characters, monsters, and the v83 UI in the browser and connects to a compatible server. You need a Cosmic v83 server to log in and play.

</details>

<details>
<summary><b>Which MapleStory version and server does this client support?</b></summary>

<br />

Voyage Client targets **MapleStory v83 (GMS)** and is fully compatible with the **Cosmic** v83 server.

</details>


<details>
<summary><b>Does it work on phones and tablets?</b></summary>

<br />

Yes. It includes drag-arrangeable touch controls for phones and touch screens, plus gamepad support.

</details>

<details>
<summary><b>Where do the game assets come from?</b></summary>

<br />

You supply your own MapleStory v83 GMS `.wz` files (the Cosmic-provided WZ files are recommended). The [Voyage-Wz-Extractor](https://github.com/comcad/Voyage-Wz-Extractor) converts them to JSON and PNG for the web client.

</details>

## 💬 Community

Questions, feedback, or want to help test? Come hang out on Discord.

[![Discord](https://img.shields.io/badge/Discord-discord.gg%2FSCVxm6tB4g-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/SCVxm6tB4g)

## 🙏 Credits

- **Server:** [Cosmic v83](https://github.com/P0nk/Cosmic)

## 📄 License

- **License:** [MIT](LICENSE.txt) 


## ⚠️ Disclaimer

**Voyage Client is an unofficial, fan-made, non-commercial project. It is not affiliated with, endorsed by, sponsored by, or connected to Nexon Korea Corporation, Nexon America Inc., or any of their subsidiaries or affiliates ("Nexon").**

### Trademarks & Copyright
MapleStory, its name, logos, characters, artwork, music, sound effects, text, game data, and all related assets are the property of Nexon and its licensors. All trademarks and copyrights belong to their respective owners. The name "MapleStory" is used in this repository for identification and compatibility description only and does not imply any association with Nexon.

### No Game Assets Included
This repository contains **no** copyrighted Nexon assets. That includes `.wz` files, extracted images, audio, maps, and any other game data. It contains only original source code written by the contributors.

To use this software, you must supply your own legally obtained copy of the game files. You are solely responsible for ensuring you have the legal right to possess and use them. The contributors do not provide, host, link to, or distribute these files and will not assist in obtaining them.

### No Nexon Code
This is an independent implementation. It does not contain and was not derived from Nexon's proprietary client source code or binaries. It was written from observed network protocol behavior for interoperability purposes.

### Intended Use
This software is provided for educational, research, and interoperability purposes, and for use with self-hosted servers on a private, non-commercial basis. It is not intended to circumvent any technological protection measure, to replace or compete with any official Nexon product or service, or to be used for commercial gain.

The contributors do not sell this software, charge for access, or accept payment for in-game items or advantages. Anyone who does so with this software acts on their own account and at their own risk.

### Official Servers
Use of this software with Nexon's official servers is **not supported** and may violate Nexon's Terms of Service, potentially resulting in account action. Do not use it for that purpose.

### License Scope
The MIT license in this repository applies **only** to the original source code written by the contributors. It grants no rights to any Nexon trademarks, assets, or other intellectual property.

### No Warranty
THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY ARISING FROM THE USE OF THIS SOFTWARE.

### Your Responsibility
You are responsible for complying with all applicable laws and with any license or terms of service that apply to the game files and servers you use.

### Takedown Requests
If you are a rights holder and believe this repository infringes your rights, please contact **[xcomcadx@gmail.com]** or open an issue. Your request will be reviewed and addressed promptly.


<div align="right">

[⬆ Back to top](#voyage-client-maplestory-web-client)

</div>
