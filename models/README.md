# 🚀 Solar Odyssey — Complete 3D Model, Animation & Effect Pack

Every 3D model, animation and effect used by **Solar Odyssey** (the browser
solar-system game in this repository), extracted into standard **glTF-Binary
(`.glb`)** files you can open anywhere — plus the original generating code.

The game ships with **zero binary assets**: all of its models, textures,
animations and effects are generated procedurally by JavaScript at runtime.
This pack runs that exact code (`tools/export-models.mjs`) and saves the
results as real 3D files. Same geometries, same materials, same procedural
textures, same seeds — pixel-for-pixel what players see in-game.

---

## 👀 How to view these models

| Method | How |
|---|---|
| **Included viewer** | Open **`viewer.html`** and drag any `.glb` onto it (needs internet for the three.js CDN). |
| **Blender** | `File → Import → glTF 2.0 (.glb/.gltf)` |
| **Windows** | Right-click a `.glb` → *Open with → 3D Viewer* |
| **macOS** | Double-click — Finder previews `.glb` natively |
| **Browser (no install)** | Drag a `.glb` onto <https://gltf-viewer.donmccurdy.com> or <https://threejs.org/editor> |

Planet and sun files include **spin animations** (Venus & Uranus spin
retrograde, exactly like in-game) — the viewer and Blender both play them.

---

## 📦 What's inside

**102 models · 10.6 MB** — see `MANIFEST.json` for the complete indexed list.

### `glb/ship.glb` — Player spacecraft
The Odyssey ship: capsule fuselage, nose cone, glass cockpit, swept wings,
tail fin, engine block, engine light.

### `glb/sun.glb` — SOL
The Sun's live fBm shader surface, baked to a texture, with its slow-rotation
animation. (In-game it churns in real time — see `source-code/planets/SolarSystem.js`.)

### `glb/planets/` — all 8 planets
`mercury, venus, earth, mars, jupiter, saturn, uranus, neptune` — each with its
procedural surface texture (Earth also gets clouds + night-city-lights, Saturn
and Uranus get their rings), axial tilt, atmosphere shell where the game has
one, and the game's spin animation. Textures are generated with the **exact
seeds** `SolarSystem.buildPlanets()` uses in-game.

### `glb/moons/` — all 10 moons
`moon, phobos, deimos, io, europa, ganymede, callisto, titan, enceladus, triton`.

### `glb/stations/` — the 4 orbital stations
`earth-station, mars-station, jupiter-station, saturn-station` — torus
habitat ring, docking hub, spokes, glowing window strip, beacon.

### `glb/asteroids/` — the 4 asteroid types
`iron, nickel, ice, rare` — the shared deformed-icosahedron rock (seed 777)
in each ore colour.

### `glb/starfield.glb`
The game's seed-42 sky: three star brightness layers + three nebula billboards.

### `glb/rockets/` — the rocket fleet
* `odyssey-i.glb` — the stock starter rocket, assembled by the game's own
  builder. Stage groups are kept as separate nodes, so you can animate
  staging (the game drops them bottom-up via `dropStage(n)`).
* `parts/` — **all 56 Vehicle Assembly Building parts**, each as its own
  model with its in-game geometry, material and procedural texture
  (capsules, tanks, engines, SRBs, fairings, satellites, chutes, solar
  arrays…). Build any rocket the game can build.

### `glb/surface/` — planetary surface worlds
* `props/` — the models shared by every world: **outpost base** (landing pad,
  habitat dome, connecting tube, comms mast + beacon, solar array), **rover**,
  **astronaut** (EVA suit with visor, backpack, limbs), **supply cache crate**,
  **sample site** science dish.
* `scenes/` — three complete generated worlds (`earth`, `mars`, `moon`):
  terrain, water, glowing features, ridges, rock fields, streamed props,
  outpost, rover, caches, sample site and astronaut — laid out exactly as
  when you land in-game. Any other world can be exported on demand (below).

### `glb/effects/` — effects & particles
* `particles-engine-sparks / particles-mining-sparks / particles-explosion` —
  snapshots of the game's pooled particle systems mid-burst (90 / 70 / 140
  particle pools).
* `mining-beam` — the mining laser beam.
* `landing-dust-ring` — the touchdown dust ring from the landing cinematic.
* `entry-streaks` — atmospheric entry streak particles.
* `glow-heat-shield`, `glow-engine-plume` — the glow billboards used during
  re-entry and retro-burns.

---

## 🎬 About the animations

Two kinds live in this game:

1. **Baked into these `.glb` files** — planet/moon/sun rotation and Earth's
   1.25×-faster cloud drift (glTF animation clips, faithful to the in-game
   rates, including retrograde Venus & Uranus).
2. **Procedural, driven by code** — glTF can't encode particle systems,
   shader animations or gameplay-driven motion, so those ship as the exact
   source code in **`source-code/`**:

| Animation / effect | Where it lives |
|---|---|
| Orbits, sun shader churn, anomaly beacons | `source-code/planets/SolarSystem.js` |
| Planet/moon spin, clouds, rings, atmospheres | `source-code/planets/Planet.js`, `Moon.js` |
| Rocket staging, flame ignition, launch ascent | `source-code/rockets/RocketMesh.js`, `LaunchSequence.js` |
| Landing cinematic (entry glow, retro plume, dust, streaks) | `source-code/fx/LandingSequence.js` |
| Pooled particles (engine, mining, explosions), mining beam | `source-code/fx/Effects.js` |
| Ship engine flame + fading flight trail | `source-code/spacecraft/Ship.js` |
| Astronaut walk cycle, rover wheels, beacon pulse | `source-code/game/SurfaceScene.js` |
| Station orbit + beacon blink | `source-code/world/SpaceStation.js` |
| Asteroid tumbling | `source-code/world/AsteroidField.js` |
| Every procedural texture (planets, parts, glows, nebulae) | `source-code/planets/ProceduralTextures.js`, `rockets/PartTextures.js` |
| Terrain generation + per-world themes | `source-code/game/SurfaceScene.js`, `surface/SurfaceThemes.js` |

All textures are embedded inside the `.glb` files (no external images needed),
and each module keeps its original game comments.

---

## ♻️ Regenerating / exporting more worlds

Everything here is reproducible from the repo root:

```bash
npm install
node tools/export-models.mjs
```

Export the full surface scene of any other scanned world by id:

```bash
node tools/export-models.mjs --surface=europa,titan,io
```

(planet & moon ids come from `src/config.js`)

---

*Extracted from [Solar Odyssey](../README.md) — a 3D solar-system exploration
game that runs entirely in the browser. If you share these models, keep this
folder (or the repo link) with them so others know where they came from.*
