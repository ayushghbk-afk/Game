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
```

First milestone: spawn near Earth Station → fly → target the Moon (`T`) →
enter orbit (`E`) → scan (`R`) → complete FIRST FLIGHT & LUNAR VISIT → save.

---

## FEATURES

| Area | What's in |
|---|---|
| **Solar System** | Sun (animated shader) + all 8 planets + 10 moons (Moon, Phobos, Deimos, Io, Europa, Ganymede, Callisto, Titan, Enceladus, Triton), rings for Saturn/Uranus, axial tilts, Kepler-relative orbital speeds |
| **Flight** | 6-DOF ship: thrust, reverse, strafe, vertical, roll, boost, brake, smooth acceleration, momentum, clamped inverse-square gravity, gravity assists, planet collision + shields/hull damage |
| **Interaction** | Targeting, planet orbit mode, landing on **Earth/Moon/Mars** (procedural terrain, local gravity, landing, sample collection), scanner with discovery flow, asteroid mining |
| **Economy** | 5 resources, cargo capacity, space stations (Earth/Mars/Jupiter/Saturn) with refuel · repair · trade · upgrades |
| **Progression** | Credits, XP/levels, 5 upgrade systems × 2–3 tiers (Engine, Tank, Shield, Scanner, Cargo), 10-mission chain, 12 achievements |
| **Exploration** | Procedural asteroid belt (instanced, pooled, minable), 3 hidden anomalies, codex encyclopedia that unlocks as you scan |
| **UI** | Loading screen, animated main menu, HUD (bars/target/prompt/warnings), solar system chart (click to inspect + fast travel), planet info cards, dock panel, settings, help |
| **Fast travel** | Discovered destinations can be warped to for fuel + a few seconds of travel |
| **Time** | Accelerated sim clock (1 real s = 1 game min), 1×/10×/100× warp — orbits use the same clock |
| **Audio** | Fully synthesized WebAudio: engine hum, boost, scanner, mining laser, mission chimes, alarms + generative ambient music. No audio files. |
| **Save** | localStorage auto-save (45 s, on dock/mission/discovery) + manual save, load, reset |
| **Performance** | LOD planets, quality presets LOW→ULTRA (auto-detects mobile), bloom toggle, pooled particles/asteroids, FPS cap 30/60, star density scaling |
| **Robustness** | WebGL detection, storage-unavailable handling, corrupted-save recovery, texture fallbacks, no fatal crashes on missing assets (everything is procedural) |

**Zero binary assets.** Every texture (planet surfaces, Earth day/night + city
lights + clouds, gas-giant bands, rings, glows, nebulae) is painted procedurally
on canvases at load time — that's why the whole game is ~174 KB gzipped and
loads in seconds on a phone.

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

node test/smoke.mjs         # world/physics/economy/missions/save — 44 checks
node test/ui-smoke.mjs      # UI modules under jsdom — 25 checks
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
    │   └── SurfaceScene.js      # procedural planet surfaces (landing)
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
    ├── save/SaveSystem.js       # localStorage
    └── ui/                      # HUD, Menu, Map, PlanetInfo, MobileControls,
                                 #   Codex, DockPanel, Toasts, LoadingScreen
```

## PERFORMANCE NOTES

- Planets use `THREE.LOD` (high/medium/low geometry by distance).
- The asteroid belt is a single `InstancedMesh`; only near-field rocks re-matrix per frame; depleted rocks are recycled (pooled).
- All particles are ring-buffer pools; nothing allocates per frame.
- Bloom/post-processing only on HIGH/ULTRA; LOW/MED render direct.
- Star count, pixel ratio, terrain detail and particle rates all scale with the quality preset; mobile defaults to LOW.
- Every expensive texture is generated once during the loading screen (with visible progress), then cached.
