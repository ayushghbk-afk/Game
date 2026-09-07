# SOLAR ODYSSEY 🚀

A polished **3D Solar System exploration game** that runs entirely in the browser —
fly a spacecraft, discover planets, scan moons, mine asteroids, trade at space
stations, upgrade your ship and complete a 10-mission chain from Earth orbit to
Neptune. No backend, no downloads over 200 KB gzipped, plays on desktop **and**
mobile.

> Built with **HTML5 + CSS3 + JavaScript + WebGL (Three.js)**, bundled by **Vite**.
> 100% static — deployable to GitHub Pages as-is.

---

## PLAY

**Desktop:** `W/A/S/D` thrust · mouse look (click to capture) · `Shift` boost ·
`Space`/`Ctrl` up/down · `E` interact (orbit / dock / mine) · `R` scan · `T` target ·
`M` map · `I` info · `L` land · `V` camera · `B` brake · `J` missions · `H` help · `Esc` pause
— **`Esc` and the Android/browser BACK button do the same thing**: close the
topmost panel, or open the pause menu if nothing is open.
— if the browser ever refuses the mouse capture, just **hold the left mouse
button and move** to look (the game detects this and tells you once).

**Mobile (Free Fire / PUBG layout):** left = move joystick, right half of the
screen = drag to look (your finger follows the view), big `E` button =
interact (hold to mine), plus BOOST / BRAKE / ▲ / ▼ and SCAN / TGT / MAP /
LOG / CODEX / LAND / PAUSE. Aim assist (Settings) gently steers the nose
toward the current target, like auto-aim in FFM/PUBG — toggle it off for
full manual control. If your touchscreen isn't detected automatically, turn
the controls on any time from **Settings → Mobile controls → ON**.

### The core loop

```
EXPLORE → DISCOVER → SCAN → MINE → EARN CREDITS → UPGRADE SHIP
   → TRAVEL FARTHER → DISCOVER NEW LOCATIONS → COMPLETE MISSIONS
   → LAND → LIVE AT THE OUTPOST → DRIVE THE ROVER → REPAIR ROVERS
```

First milestone: spawn near Earth Station → fly → target the Moon (`T`) →
enter orbit (`E`) → scan (`R`) → complete FIRST FLIGHT & LUNAR VISIT → save.

### The Land System

When you orbit **any of the 18 bodies** (all 8 planets + 10 moons) press
**`L`** to touch down — the only gate is that you **scanned it first**
(`R` in orbit). Gas/ice giants get a hard **cloud deck** you can walk on.
Every world gets its **own named surface map** built from real planetary
science (see [Surface maps & research sources](#surface-maps--research-sources)),
so Mars has Valles Marineris, Olympus Mons and dune fields, Europa has
lineae and chaos terrain, Titan has methane seas and longitudinal dunes,
and so on. You pilot a hover-shuttle, a drivable **rover** — and you can
**step out of both and walk in your EVA suit**.

- **Outpost (your planetary base).** Land near it and press **`E`** to enter:
  **REST** (restore energy), **EAT** (recover satiety from food rations),
  **MAINTAIN STATION** (a paid job that uses a spare part), **DRIVE / PARK
  ROVER**, **EVA (ON FOOT)**, plus the **SUPPLY LINE — ORDER FROM EARTH**
  panel and a **FIELD JOBS** report (broken rovers + caches still out there).
- **Rover.** Board it with `E` and drive with **W/A/S/D** over the terrain to
  explore and reach field objectives.
- **EVA — on foot.** Step out of the shuttle (landed) or the rover (stopped):
  a full **humanoid astronaut** with a third-person camera. **WASD run,
  SHIFT sprint, SPACE jump** (jump height & hang time scale with the world's
  gravity — try it on Phobos), mouse to look. Find **supply caches** on foot
  and walk back to your vehicles to re-board (`E`).
- **Supply caches (spare parts in the wild).** Crates of **spare parts** (and
  occasional food/water/ice/rare extras) are scattered randomly across every
  world's surface — drive or walk over one and press **`E`** to recover it.
  Recovering 5 earns the **SCAVENGER** achievement.
- **Earth supply line.** At the outpost you can **order spare parts, food,
  water, ice and rare isotopes straight from Earth**. Price and ETA scale
  with the body's distance from Earth (Mercury is cheap & fast; Neptune is
  not). The order travels on game time — crank the **time warp** and watch
  the countdown in the panel. When it lands, a crate appears near the
  outpost: walk/drive over it, press `E`, load it into cargo. First delivery
  loaded earns the **LOGISTICS CHAIN** achievement.
- **Broken rovers.** Scattered on every solid world. Drive up to one and
  press **`E`** to repair it (takes a few seconds, costs 1 spare part) —
  pays **credits + XP** per rover fixed.
- **Sample site.** Every world has a science sample site (a beacon you can
  find by exploring); collect it for a world-specific resource reward + XP.
- **Food / satiety.** Your astronaut gets hungry over time (the FOOD bar
  drains). Eat rations at the outpost to recover; buy more food & spare parts
  at any space station, find them in caches, or order them from Earth.
  Running out of food slows your energy — keep stocked.

**The UI changes with the vehicle.** The HUD shows a mode chip
(🚀 SHIP / 🛬 SHUTTLE / 🚙 ROVER / 🚶 ASTRONAUT) and the right bars per
context — fuel & shield in the ship, the rover cell + cargo on the rover,
O₂/vitals + cargo on foot — and the mobile touch layout swaps its buttons
too (JUMP appears only on foot, EVA/SHUTTLE only on the surface, BOOST
doubles as rover nitro).

Your new career starts with a small kit of **6 food rations** and **3 spare
parts** so you can settle in at your first outpost immediately.

### Surface maps & research sources

Each `SurfaceScene` picks its **theme from `src/surface/SurfaceThemes.js`**
(18 hand-tuned maps: noise amplitude, named features, palette, sky, rewards).
Feature placement follows published planetary science:

- **Mercury** — Borealis Planitia, Caloris basin (peak ring + radial
  troughs), Nathair facula, contraction wrinkle ridges, permanently
  shadowed polar ice (BepiColombo 2024–25 flybys).
- **Venus** — Maat Mons in Atla Regio, tessera highlands, coronae,
  chasmata, young crater-free lava plains (Magellan + 2023 Maat Mons
  reanalysis).
- **Mars** — Valles Marineris, Tharsis / Olympus Mons, Hellas basin,
  Jezero delta, barchan dune fields (Frontiers 2022 dune survey).
- **Moon / Phobos / Deimos** — maria, Tycho ray system; potato-shaped
  low-gravity terrain.
- **Io** — Pele, Tvashtar, Kanehekili, Loki Patera, red sulfur sinter
  (Juno 2023–25).
- **Europa** — lineae double ridges, chaos terrain blocks, plume stains,
  domes (Galileo reprocessing + Juno 2022).
- **Ganymede / Callisto** — two-toned grooved terrain, Utopia Planitia,
  Haworth craters, Styx palimpsest (Juno 2021 flyover).
- **Titan** — Kraken / Ligeia / Punga maria, equatorial longitudinal dune
  fields, dendritic channels (Cassini / Huygens).
- **Enceladus** — the four tiger-stripe fractures (Damascus/Baghdad/Cairo/
  Mumbai Sulci), jet spots, crystalline south polar ice.
- **Triton / Uranus / Neptune** — nitrogen-ice plains, cantaloupe terrain,
  cloud decks.

<details><summary>Selected sources (2021–2025)</summary>

- ESA / BepiColombo Mercury flyby coverage (Dec 2024 – Jan 2025)
- space.com / EarthSky: Borealis Planitia, Caloris, Nathair facula
- NASA JPL: Juno Europa flyby reprocessed Galileo data; Juno 2023–25 Io
  hotspots; Cassini/Huygens Titan sea & dune maps
- Frontiers in Astronomy & Space Sciences (2022): Martian dune-field survey
- APOD / Juno: Ganymede & Callisto flyover (Dec 2025 imagery); Maat Mons
  radar reanalysis (2023); Enceladus tiger-stripe Cassini radar maps

</details>

---

## FEATURES

| Area | What's in |
|---|---|
| **Solar System** | Sun (animated shader) + all 8 planets + 10 moons (Moon, Phobos, Deimos, Io, Europa, Ganymede, Callisto, Titan, Enceladus, Triton), rings for Saturn/Uranus, axial tilts, Kepler-relative orbital speeds |
| **Flight** | 6-DOF ship: thrust, reverse, strafe, vertical, roll, boost, brake, smooth acceleration, momentum, clamped inverse-square gravity, gravity assists, planet collision + shields/hull damage |
| **Interaction** | Targeting, planet orbit mode, landing on **all 18 bodies after scanning** (named research-themed terrain per world, local gravity, cloud decks for gas/ice giants, sample sites), a planetary **outpost** (live · eat · maintain · rover · EVA · Earth supply line), repair broken rovers, scanner with discovery flow, asteroid mining |
| **Economy** | 7 resources (incl. Food rations & Spare Parts), cargo capacity, space stations (Earth/Mars/Jupiter/Saturn) with refuel · repair · trade · upgrades, **supply line from Earth** (cost & ETA scale with distance, time-warp-able transit), plus outpost jobs that pay credits |
| **Progression** | Credits, XP/levels, 5 upgrade systems × 2–3 tiers (Engine, Tank, Shield, Scanner, Cargo), 10-mission chain, 19 achievements |
| **Exploration** | Procedural asteroid belt (instanced, pooled, minable), 3 hidden anomalies, **18 unique surface maps** (Mars canyons & dunes, Europa lineae & chaos terrain, Titan seas, Io volcanoes…), drivable surface **rover** + **humanoid EVA (run/sprint/jump, gravity-scaled)**, random **supply caches** of spare parts, scattered broken rovers to repair, per-world science sample sites, codex encyclopedia that unlocks as you scan |
| **UI** | Loading screen, animated main menu, **vehicle-aware HUD** (mode chip + per-vehicle bars: ship/shuttle/rover/astronaut), mobile touch layout that **re-skins per vehicle** (JUMP/EVA buttons), solar system chart (click to inspect + fast travel), planet info cards, dock + outpost panels, settings, help |
| **Fast travel** | Discovered destinations can be warped to for fuel + a few seconds of travel |
| **Time** | Accelerated sim clock (1 real s = 1 game min), 1×/10×/100× warp — orbits use the same clock |
| **Audio** | Fully synthesized WebAudio: engine hum, boost, scanner, mining laser, mission chimes, alarms + generative ambient music. No audio files. |
| **Save** | **Multi-slot careers** (6 local slots listed in the main menu), auto-save (45 s, on dock/mission/discovery) + manual save, export/import career files, optional **cloud sync** to your account |
| **Settings** | Persisted on their own storage key — they survive NEW GAME, apply before any career loads, and mirror to your account when cloud sync is on |
| **Account** | **Guest by default** (everything in browser storage, no sign-up) or an email account for cloud saves, friends and rocket sharing |
| **Online** | Regional **server browser** (auto-detects your nearest region, shows player counts + estimated ping), host your own server, **friends list** with requests, online status and invites |
| **Rockets** | **Rocket Workshop (VAB)**: 30+ parts across 7 categories, multi-stage stacks, live flight analysis (mass, thrust, Isp, TWR, per-stage delta-v), **launch from Earth to orbit** with a physical staged ascent, save / export / import / publish designs |
| **Streaming** | Planet surfaces generate and erase world objects around the player in deterministic cells, so memory stays flat however far you drive |
| **Performance** | LOD planets, quality presets LOW→ULTRA (auto-detects mobile), bloom toggle, pooled particles/asteroids, FPS cap 30/60, star density scaling |
| **Robustness** | WebGL detection, storage-unavailable handling, corrupted-save recovery, texture fallbacks, no fatal crashes on missing assets (everything is procedural) |

**Zero binary assets.** Every texture (planet surfaces, Earth day/night + city
lights + clouds, gas-giant bands, rings, glows, nebulae) is painted procedurally
on canvases at load time — that's why the whole game is ~195 KB gzipped and
loads in seconds on a phone.

---

## ACCOUNTS, SAVES & ONLINE PLAY

Solar Odyssey is **playable with no account and no server**. Out of the box you
are a **guest**: a random commander name, careers, rocket designs and settings
all stored in this browser's `localStorage`. Nothing is gated behind sign-up.

Connecting a server adds the online layer: cloud saves, friends, the live
server list and shared rocket designs.

### Setting up the server (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql).
   It creates `profiles`, `saves`, `settings`, `friends`, `servers`, `presence`
   and `rockets`, turns on row-level security for all of them, and seeds the
   nine official regional gateways.
3. In the game: **Main menu → ACCOUNT → CONNECT SERVER**, then paste your
   **Project URL** and **anon public key** (Supabase → Project Settings → API).
   They are stored in your browser, never in the repo.
4. **CREATE ACCOUNT** / **SIGN IN**, and turn on **Settings → Cloud sync**.

Prefer to bake the keys into a build? Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` before `npm run build`. The anon key is safe to ship —
row-level security is what protects the data, and the schema above enforces
"you can only read and write your own rows".

### Careers

The main menu lists **every past game** with its level, credits, location,
play time and last-saved time. Each career lives in its own slot (6 max), so
starting a new expedition never erases the old one. **EXPORT** writes a career
file you can back up or hand to a friend; **IMPORT** reads one back.

### Rocket Workshop — 3D drag-and-drop assembly

**Main menu → 🚀 ROCKET WORKSHOP** (also on the pause menu). The workshop is a
real 3D launch pad you can orbit around, not a flat parts list:

| Action | Mouse | Touch |
| --- | --- | --- |
| Add a part | click it in the palette | tap it in the palette |
| Move a part | drag it | drag it |
| Orbit the pad | drag empty space | drag empty space |
| Zoom | scroll wheel | pinch |
| Select / edit | click a part | tap a part |

Parts **snap to attachment nodes** — green dots appear while you drag, and the
nearest one turns amber when it will catch. Stack them nose-to-tail for a
conventional rocket, or push one against the *side* of a tank to strap on a
booster. With **SYMMETRY** on, side-mounted boosters automatically get a twin
on the opposite side so the vehicle stays balanced. The selection toolbar
nudges, mirrors (⇋) or deletes (✕) the highlighted part.

Staging is read from the geometry, not from list order: every decoupler splits
the stack, and strap-on boosters burn with the stage they sit beside. The
rocket you watch lift off is assembled from exactly the parts you placed.

Watch the analysis panel as you build: it
computes real mass, thrust, mass-flow-weighted Isp, thrust-to-weight and
per-stage delta-v via the rocket equation, and refuses to launch anything that
cannot fly — including 3D-only faults like a part left floating in mid-air.
Reaching orbit needs **9,400 m/s of delta-v and TWR ≥ 1.15** — the
same numbers the flight simulation uses, so the readout never lies.

**🚀 LAUNCH FROM EARTH** flies the ascent for real: countdown, lift-off, gravity
turn, staging as tanks run dry, and a circularisation burn. Make orbit and you
are dropped into normal flight in Earth orbit with a mission payout; run out of
propellant and you are told exactly how short you were.

Designs **SAVE** to your career, **EXPORT/IMPORT** as `.rocket.json` files, and
**SHARE** publicly (with an account) for other commanders to download from the
**SHARED** tab.

---

## RUN LOCALLY

```bash
npm install
npm run dev        # dev server → http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve the production build
```

Tests:

```bash
npm test                  # runs all of the following

node test/smoke.mjs         # world/physics/economy/surfaces/EVA/supply — 51 checks
node test/ui-smoke.mjs      # UI modules under jsdom — 29 checks
node test/static-host.mjs   # unbundled boot path (plain static host / CDN three)
node test/css-input-layers.mjs # pointer-events layering (invisible-overlay guard)
node test/modal-state.mjs   # modal bookkeeping / ESC-close regression (jsdom)
node test/aim-assist.mjs    # auto-aim math (cone/range/rate/direction) — 11 checks
node test/browser-clicks.mjs # real-browser click test — runs when a Chromium/
                              # Chrome binary is available (CHROME_PATH),
                              # otherwise skips gracefully
node test/browser-controls.mjs # mouse (pointer lock + drag fallback) & FFM/PUBG
                              # touch layout in a real browser; same CHROME_PATH
                              # opt-in/skip behavior
```

## DEPLOY TO GITHUB PAGES

**Recommended — Build and deployment via GitHub Actions**
(`.github/workflows/deploy.yml` is ready):

1. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or merge a PR into `main`).
3. The workflow installs, builds with Vite, and deploys `dist/` to Pages.

**Fallback — "Deploy from a branch" (`main` /) also works.** Pages then
serves the repo root *unbundled*, and the game handles that: the stylesheet
is loaded via a plain `<link>` and the bare `three` imports are resolved by
the import map in `index.html` (jsDelivr CDN, version-pinned to
`package.json`). If you bump `three`, update the import map too —
`node test/static-host.mjs` enforces the pin.

The Vite build uses a **relative base (`./`)**, so it works from
`https://<user>.github.io/<repo>/` or any subpath without configuration.

## PROJECT STRUCTURE

```
├── index.html
├── vite.config.js               # relative base → GitHub Pages compatible
├── .github/workflows/deploy.yml # Pages CI/CD
├── test/                        # headless smoke tests
└── src/
    ├── main.js                  # entry: WebGL check, boot, fatal errors
    ├── style.css
    ├── config.js                # SOLAR_SYSTEM_CONFIG — every body, station,
    │                            #   anomaly, economy, upgrade & quality preset
    ├── game/
    │   ├── Game.js              # orchestrator: modes, loop, cameras, interactions
    │   ├── GameState.js         # progress + events + achievements
    │   ├── TimeSystem.js        # accelerated sim clock
    │   └── SurfaceScene.js      # planetary surfaces: terrain, vehicles, EVA,
    │                            #   caches, deliveries, sample sites
    ├── surface/
    │   └── SurfaceThemes.js     # 18 research-based surface maps (per world)
    ├── planets/
    │   ├── SolarSystem.js       # sun shader, bodies, stations, orbit lines
    │   ├── Planet.js / Moon.js  # LOD meshes, atmospheres, rings, spin/orbits
    │   ├── PlanetData.js        # real-world facts + formatting
    │   └── ProceduralTextures.js# canvas texture factory (cached)
    ├── spacecraft/
    │   ├── Ship.js / ShipPhysics.js / ShipController.js / ShipUpgrades.js
    ├── physics/GravitySystem.js # clamped μ/d² gravity
    ├── world/
    │   ├── AsteroidField.js     # instanced belt, mining, pooling
    │   ├── SpaceStation.js / Starfield.js / Resources.js
    ├── missions/                # mission chain + manager
    ├── fx/Effects.js            # pooled particles, mining beam, warp/explosions
    ├── audio/AudioManager.js    # synthesized SFX + generative music
    ├── save/SaveSystem.js       # multi-slot careers + standalone settings +
    │                            #   guest identity, export/import
    ├── net/Backend.js           # dependency-free Supabase client (auth, saves,
    │                            #   settings, friends, servers, rockets)
    ├── rockets/
    │   ├── RocketParts.js       # parts catalogue + design analysis (staging,
    │   │                        #   delta-v, TWR, validation, import/export)
    │   ├── RocketMesh.js        # design → 3D model, with stage shedding
    │   └── LaunchSequence.js    # physical Earth-to-orbit ascent simulation
    ├── world/
    │   └── ObjectStreamer.js    # deterministic cell streaming: generate near
    │                            #   the player, erase (and free) behind them
    ├── utils/SpawnSafety.js     # anchored save positions + "never spawn in
    │                            #   the Sun" guard rails
    ├── audio/UISound.js         # global click/tap feedback for every control
    └── ui/                      # HUD, Menu (careers · servers · friends),
                                 #   AccountPanel, RocketBuilder, BackButton,
                                 #   Map, PlanetInfo, MobileControls, Codex,
                                 #   DockPanel, BasePanel, Toasts, LoadingScreen
├── supabase/schema.sql          # run once in your Supabase SQL editor
```

## PERFORMANCE NOTES

- Planets use `THREE.LOD` (high/medium/low geometry by distance).
- The asteroid belt is a single `InstancedMesh`; only near-field rocks re-matrix per frame; depleted rocks are recycled (pooled).
- All particles are ring-buffer pools; nothing allocates per frame.
- Bloom/post-processing only on HIGH/ULTRA; LOW/MED render direct.
- Star count, pixel ratio, terrain detail and particle rates all scale with the quality preset; mobile defaults to LOW.
- Every expensive texture is generated once during the loading screen (with visible progress), then cached.
