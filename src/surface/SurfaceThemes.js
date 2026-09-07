// ============================================================
// SurfaceThemes — research-grounded surface maps for EVERY body.
//
// Each theme shapes an 1800×1800 u procedural map from real planetary
// science, so no two worlds look the same. Feature coordinates below
// are authored in a 900-unit frame and scaled 2× by SurfaceScene so
// landmarks keep their relative layout on the bigger world.
// Morphology follows the latest mapping of each world:
//
//  · MERCURY — BepiColombo M-CAM / MERTIS flybys (Dec 2024 – Jan 2025):
//    Borealis Planitia lava plains flooding old craters, the 1,500 km
//    Caloris peak-ring basin, wrinkle ridges from planetary contraction,
//    bright Nathair facula deposits, and permanently shadowed polar
//    craters (Prokofiev / Kandinsky / Tolkien / Gordimer) that likely
//    hold water ice.
//  · VENUS — Magellan SAR (1990–94) reanalysis incl. 2023 Maat Mons
//    activity study; VERITAS / EnVision (2030s) targets: 8-km shield
//    volcano Maat Mons in Atla Regio, tessera highlands (Aphrodite /
//    Ishtar Terra, Maxwell Montes), chasma rifts (Diana Chasma),
//    coronae, and radar-dark basaltic lava plains covering ~80%.
//  · MARS — Perseverance/Jezero delta work + global mapping: Olympus
//    Mons & Tharsis, Valles Marineris, Hellas basin, Olympia Undae
//    dune fields (network dunes near the N polar, barchan dunes
//    south), polar CO₂ caps.
//  · MOON — mare basalt vs. highlands, Tycho ray system, Hadley Rille.
//  · IO — Juno 2023–2025: Pele & Tvashtar paterae (350 km S plume),
//    Kanehekili Fluctus twin plumes & radiating flows, Loki Patera
//    lava lake, the record 2024 southern hot spot, red sulfur sinters.
//  · EUROPA — Galileo reprocessing + Juno 2022: lineae (double
//    ridges w/ brown salts), rift bands, chaos terrain (Conamara,
//    "the Platypus"), plume stains — a young (40–90 Myr) fracture field.
//  · GANYMEDE — Juno 2021 flyby: two-toned surface, dark grooved
//    terrain (plate-scale ridges) vs. bright cratered Utopia Planitia.
//  · CALLISTO — Voyager/Galileo: the most cratered world, frost-rimmed
//    Haworth, palimpsests (Styx Macula), dark vein networks.
//  · TITAN — Cassini SAR / Huygens (Dragonfly site): equatorial
//    longitudinal dune fields, polar methane–ethane seas (Kraken,
//    Ligeia, Punga Mare), fluvial channels, rounded clasts.
//  · ENCELADUS — Cassini CIRS/VIMS: south-polar "tiger stripes"
//    (Damascus/Baghdad/Cairo/Mumbai Sulci, ~130 km, 40 km apart,
//    180 K jet spots), pristine crystalline ice, near-crater-free.
//  · TRITON — Voyager 2: N₂ geysers (Pampeanusa Fossae), heart-shaped
//    Soho Patera, "cantaloupe" skin terrain, bright south polar cap.
//  · GAS / ICE GIANTS — cloud-deck platforms above the banded
//    atmospheres (Great Red Spot, NEP dark spot, Saturn's hexagon,
//    Uranus's faint major belts — Voyager 2 / Juno).
// ============================================================

// Feature types (evaluated by SurfaceScene):
//   crater   {x,z,r,d,peak,rays,brightFloor,name,label}
//   basin    {x,z,r,d,peak,ring,name,label}      impact basin + peak ring
//   dome     {x,z,r,h,caldera,name,label}        shield volcano
//   patera   {x,z,r,d,glow,name,label}           volcanic pit + lava glow
//   canyon   {x,z,len,w,d,ang,name,label}        linear trough
//   plain    {x,z,r,flat,dark,bright,name,label} flatten zone (+tint)
//   highland {x,z,r,h,blocky,name,label}         uplifted (tessera) block
//   caps     {x,z,r,name,label}                  frost cap
//   linea    {x,z,len,ang,name}                  double-ridge ice crack
//   lineae   {x,z,n,len,ang,gap,name,label}      parallel cracks (Europa)
//   band     {x,z,len,w,ang,flat,dark,name}      wide smooth band
//   chaos    {x,z,r,name,label}                  jumbled hummock terrain
//   dunes    {x,z,r,ang,rows,name,label}         dune-ridge field
//   lake     {x,z,r,lvl,name,label}              liquid pool
//   palimpsest {x,z,r,name,label}                depressed scarp dimple
//   cantaloupe {x,z,r,name,label}                bumpy skin terrain
//   stripe   {x,z,len,ang,name,glow}             hot fault (tiger stripes)
//   shadowed {x,z,r,name,label}                  permanently shadowed (PSR)
//   veins    {x,z,n,len,ang,name}                dark streaks
//   flows    {x,z,n,len,ang,name}                lava flow streaks
//   spot     {x,z,r,amt,name,label}              tinted region (GRS etc.)
//   corona   {x,z,r,name,label}                  ring mountain + central pit

const F = (t, o) => ({ t, ...o });

export const SURFACE_THEMES = {
  // ------------------------------------------------------------ EARTH
  earth: {
    title: 'EARTH — MID-CONTINENT SURVEY',
    amp: 11,
    craters: { count: 0 },
    features: [],
    low: 0x3f7a34, high: 0xe8ecef,
    dark: 0x1a3a18, bright: 0xffffff,
    sky: { stars: 1, sun: 0xfff2dc, sunIntensity: 2.2, ambient: [0x445566, 0.8], fog: [0x8db8e0, 0.0011] },
    props: { count: 90, color: 0x4a5240 },
    water: { level: 0.55, color: 0x1a5f9e, opacity: 0.82 },
    rewards: { water: 12, rare: 1 },
    caches: 5, cacheExtra: 'water',
    brokenRovers: 8
  },

  // ------------------------------------------------------------ MOON
  moon: {
    title: 'LUNA — MARE / HIGHLANDS BOUNDARY',
    amp: 7,
    craters: { count: 26, rMin: 12, rMax: 54 },
    features: [
      F('plain', { name: 'MARE TRANQUILLITATIS', x: -180, z: 120, r: 150, flat: 1.6, dark: 1, label: true }),
      F('plain', { name: 'OCEANUS PROCELLARUM', x: 260, z: 190, r: 175, flat: 2.2, dark: 0.85, label: true }),
      F('crater', { name: 'TYCHO CRATER', x: 220, z: -170, r: 34, d: 1.4, peak: 1, rays: 1, brightFloor: 0.5, label: true }),
      F('crater', { name: 'COPERNICUS CRATER', x: -300, z: -260, r: 42, d: 1.2, peak: 1, rays: 1 }),
      F('canyon', { name: 'HADLEY RILLE', x: -40, z: -260, len: 230, w: 7, d: 1.6, ang: 0.5, label: true })
    ],
    low: 0x6f6f6c, high: 0xc9c9c2,
    dark: 0x3c3f45, bright: 0xf2f2ee,
    sky: { stars: 1, sun: 0xffffff, sunIntensity: 2.6, ambient: [0x2a2f3a, 0.32], fog: null },
    props: { count: 70, color: 0x5a5a58 },
    rewards: { iron: 14, rare: 2 },
    caches: 6, cacheExtra: 'food',
    brokenRovers: 8
  },

  // ------------------------------------------------------------ MARS
  mars: {
    title: 'MARS — THARSIS / VALLES MARINERIS',
    amp: 22,
    craters: { count: 14, rMin: 9, rMax: 34 },
    features: [
      F('highland', { name: 'THARSIS PLATEAU', x: -240, z: -160, r: 260, h: 9 }),
      F('dome', { name: 'OLYMPUS MONS', x: -300, z: -240, r: 150, h: 27, caldera: 1, label: true }),
      F('canyon', { name: 'VALLES MARINERIS', x: 130, z: -250, len: 340, w: 36, d: 14, ang: 0.35, label: true }),
      F('basin', { name: 'HELLAS PLANITIA', x: 290, z: 230, r: 165, d: 11, ring: 1, label: true }),
      F('crater', { name: 'JEZERO CRATER', x: 150, z: 150, r: 26, d: 1.1, brightFloor: 0.6, label: true }),
      F('caps', { name: 'NORTH POLAR CAP', x: -330, z: 330, r: 130, label: true }),
      F('dunes', { name: 'OLYMPIA UNDAE', x: 300, z: -40, r: 115, ang: 0.2, rows: 12, label: true })
    ],
    low: 0x8a3018, high: 0xd88a5a,
    dark: 0x4e1d10, bright: 0xf0e0d8,
    sky: { stars: 1, sun: 0xffd9b0, sunIntensity: 2.1, ambient: [0x664433, 0.35], fog: [0xc47a4a, 0.0015] },
    props: { count: 90, color: 0x7a3a20 },
    rewards: { iron: 10, ice: 8, rare: 1 },
    caches: 6, cacheExtra: 'ice',
    brokenRovers: 8
  },

  // ------------------------------------------------------------ MERCURY
  mercury: {
    title: 'MERCURY — CALORIS / BOREALIS (BepiColombo survey)',
    amp: 10,
    craters: { count: 44, rMin: 8, rMax: 40 },
    features: [
      F('basin', { name: 'CALORIS BASIN', x: -260, z: -190, r: 185, d: 9, ring: 1, peak: 1, label: true }),
      F('plain', { name: 'BOREALIS PLANITIA', x: 230, z: 150, r: 200, flat: 2.4, bright: 0.25, label: true }),
      F('crater', { name: 'MENDELSSOHN CRATER', x: 300, z: 230, r: 30, d: 1.0, brightFloor: 0.5, label: true }),
      F('dome', { name: 'NATHAIR FACULA', x: 90, z: 310, r: 62, h: 6, label: true }),
      F('shadowed', { name: 'KANDINSKY (PERM. SHADOWED)', x: -390, z: 330, r: 48, label: true }),
      F('shadowed', { name: 'PROKOFIEV (PERM. SHADOWED)', x: -300, z: 410, r: 34 }),
      F('lineae', { name: 'WRINKLE RIDGES', x: 120, z: -60, n: 6, len: 200, ang: 0.8, gap: 26 })
    ],
    low: 0x57504a, high: 0x9a8d80,
    dark: 0x241f1c, bright: 0xd8cdbf,
    sky: { stars: 1, sun: 0xfff0d0, sunIntensity: 2.8, ambient: [0x40382f, 0.3], fog: null },
    props: { count: 100, color: 0x57504a },
    rewards: { nickel: 12, rare: 2 },
    caches: 5, cacheExtra: 'rare',
    brokenRovers: 7
  },

  // ------------------------------------------------------------ VENUS
  venus: {
    title: 'VENUS — ATLA REGIO (Magellan radar terrain)',
    amp: 8,
    craters: { count: 6, rMin: 8, rMax: 20 },
    features: [
      F('dome', { name: 'MAAT MONS', x: -260, z: -200, r: 145, h: 25, caldera: 1, label: true }),
      F('highland', { name: 'APHRODITE TERRA', x: 210, z: 170, r: 240, h: 11, blocky: 1, label: true }),
      F('highland', { name: 'MAXWELL MONTES', x: 250, z: -180, r: 95, h: 18, blocky: 1, label: true }),
      F('canyon', { name: 'DIANA CHASMA', x: 0, z: 300, len: 330, w: 24, d: 10, ang: 0.15, label: true }),
      F('corona', { name: 'SEDNA CORONA', x: 70, z: 70, r: 82, label: true }),
      F('flows', { name: 'AKONCHINSKY LAVA FLOWS', x: -130, z: 230, n: 5, len: 170, ang: 0.6 })
    ],
    low: 0xb08a55, high: 0xd8b47c,
    dark: 0x5c421f, bright: 0xf2e2c0,
    sky: { stars: 0, sun: 0xffe8b0, sunIntensity: 1.6, ambient: [0x7a6234, 0.55], fog: [0xd8b878, 0.0028] },
    props: { count: 60, color: 0x8a6a3a },
    rewards: { nickel: 14, rare: 1 },
    caches: 5,
    brokenRovers: 6
  },

  // ================================================== GAS / ICE GIANTS
  // Cloud-deck platforms: soft billowy "ground" inside thick fog.
  jupiter: {
    title: 'JUPITER — CLOUD DECK, SOUTH EQUATORIAL BELT',
    amp: 7,
    craters: { count: 0 },
    features: [
      F('spot', { name: 'GREAT RED SPOT', x: -220, z: -160, r: 62, amt: 1, label: true }),
      F('band', { name: 'SOUTH EQUATORIAL BELT', x: 0, z: 140, len: 820, w: 130, ang: 0.04, flat: 1, dark: 0.25 }),
      F('band', { name: 'NORTH TROPICAL BELT', x: 60, z: -300, len: 820, w: 90, ang: -0.03, flat: 1, dark: 0.35 })
    ],
    low: 0xb48a5e, high: 0xecd8b4,
    dark: 0x7a4a2e, bright: 0xf7ecd8, tint: 0xc25a30,
    sky: { stars: 0, sun: 0xfff2d8, sunIntensity: 1.5, ambient: [0x8a7250, 0.6], fog: [0xd8b890, 0.0042] },
    props: { count: 0 },
    rewards: { water: 8, rare: 1 },
    caches: 3,
    brokenRovers: 0, cloudDeck: true
  },

  saturn: {
    title: 'SATURN — CLOUD DECK, NORTHERN HEXAGON',
    amp: 6,
    craters: { count: 0 },
    features: [
      F('spot', { name: 'NORTHERN HEXAGON', x: -250, z: -190, r: 85, amt: 0.8, label: true }),
      F('band', { name: 'EQUATORIAL ZONE', x: 0, z: 120, len: 820, w: 150, ang: 0.02, flat: 1, dark: 0.18 })
    ],
    low: 0xb8a26e, high: 0xf2e6c2,
    dark: 0x7a6238, bright: 0xfaf3e0, tint: 0xd8c08a,
    sky: { stars: 0, sun: 0xfff4dc, sunIntensity: 1.4, ambient: [0x8a7a58, 0.6], fog: [0xe0d0a0, 0.0045] },
    props: { count: 0 },
    rewards: { ice: 10, rare: 2 },
    caches: 3,
    brokenRovers: 0, cloudDeck: true
  },

  uranus: {
    title: 'URANUS — CLOUD DECK, SOUTHERN MAJOR BELT',
    amp: 5,
    craters: { count: 0 },
    features: [
      F('band', { name: 'SOUTHERN MAJOR BELT', x: 0, z: 160, len: 820, w: 100, ang: 0.02, flat: 1, dark: 0.2 }),
      F('spot', { name: 'FROZEN HAZE CAP', x: -260, z: -200, r: 110, amt: 0.4 })
    ],
    low: 0x8ecfcf, high: 0xd8f2f2,
    dark: 0x4a8a8a, bright: 0xf2ffff, tint: 0xa5dddd,
    sky: { stars: 0, sun: 0xe8f8f8, sunIntensity: 1.3, ambient: [0x5a8a8a, 0.62], fog: [0x9fd8d8, 0.0048] },
    props: { count: 0 },
    rewards: { ice: 14 },
    caches: 3,
    brokenRovers: 0, cloudDeck: true
  },

  neptune: {
    title: 'NEPTUNE — CLOUD DECK, GREAT DARK SPOT',
    amp: 6,
    craters: { count: 0 },
    features: [
      F('spot', { name: 'GREAT DARK SPOT', x: 190, z: -150, r: 58, amt: 1, label: true }),
      F('band', { name: 'SOUTH TEMPEST BAND', x: -120, z: 210, len: 720, w: 80, ang: -0.05, flat: 1, dark: 0.45 })
    ],
    low: 0x2e4fb8, high: 0x6a8ae4,
    dark: 0x141f52, bright: 0xa8c4ff, tint: 0x1a2a70,
    sky: { stars: 0, sun: 0xd8e4ff, sunIntensity: 1.3, ambient: [0x3a4a80, 0.6], fog: [0x5f83e8, 0.0046] },
    props: { count: 0 },
    rewards: { ice: 12, rare: 1 },
    caches: 3,
    brokenRovers: 0, cloudDeck: true
  },

  // ------------------------------------------------------------ IO
  io: {
    title: 'IO — VOLCANIC SOUTHERN HEMISPHERE (Juno survey)',
    amp: 6,
    craters: { count: 5, rMin: 6, rMax: 16 },
    features: [
      F('patera', { name: 'PELE', x: -250, z: -190, r: 72, d: 6, glow: 0xff5a1f, label: true }),
      F('patera', { name: 'TVASHTAR PATERA', x: 200, z: -230, r: 48, d: 5, glow: 0xff7a2f, label: true }),
      F('patera', { name: 'LOKI PATERA', x: -130, z: 250, r: 42, d: 4, glow: 0xff9a3f, label: true }),
      F('flows', { name: 'KANEHEKILI FLOWS', x: 270, z: 190, n: 6, len: 150, ang: 0.5, label: true }),
      F('spot', { name: 'SULFUR SINTER FIELD', x: 70, z: -60, r: 95, amt: 0.8, label: true }),
      F('dome', { name: 'SILICATE DOME FIELD', x: -70, z: -330, r: 70, h: 5 })
    ],
    low: 0xb09a3e, high: 0xe8d97a,
    dark: 0x4e3a14, bright: 0xf8f0c0, tint: 0xc25a20,
    sky: { stars: 1, sun: 0xfff0c0, sunIntensity: 1.9, ambient: [0x5a4a2a, 0.4], fog: [0xd8c890, 0.0022] },
    props: { count: 50, color: 0x8a6a20 },
    rewards: { rare: 3, nickel: 8 },
    caches: 5, cacheExtra: 'rare',
    brokenRovers: 6
  },

  // ------------------------------------------------------------ EUROPA
  europa: {
    title: 'EUROPA — LINEAE & CHAOS TERRAIN',
    amp: 1.6,
    craters: { count: 8, rMin: 5, rMax: 12 },
    features: [
      F('lineae', { name: 'AGENOR LINEA FIELD', x: 0, z: -60, n: 9, len: 720, ang: 0.25, gap: 62, label: true }),
      F('band', { name: 'CONAMARA RIFT BAND', x: -210, z: 210, len: 430, w: 48, ang: 0.5, flat: 1, dark: 0.4, label: true }),
      F('chaos', { name: 'CONAMARA CHAOS', x: -190, z: 220, r: 105, label: true }),
      F('chaos', { name: 'THE PLATYPUS', x: 270, z: 250, r: 62, label: true }),
      F('linea', { name: 'BOOTHYA LINEA', x: 230, z: -170, len: 320, ang: -0.4, label: true }),
      F('linea', { name: 'MURIA LINEA', x: -330, z: -250, len: 260, ang: 1.2 }),
      F('spot', { name: 'PLUME STAIN (BRINE)', x: 130, z: 70, r: 52, amt: 0.7, label: true })
    ],
    low: 0xcfcabb, high: 0xf2efe2,
    dark: 0x7a5a3a, bright: 0xffffff, tint: 0x9a5a2a,
    sky: { stars: 1, sun: 0xf2ecff, sunIntensity: 1.8, ambient: [0x4a4a58, 0.42], fog: null },
    props: { count: 40, color: 0xb8b4a4 },
    rewards: { ice: 16, water: 8, rare: 1 },
    caches: 6, cacheExtra: 'ice',
    brokenRovers: 7
  },

  // ------------------------------------------------------------ GANYMEDE
  ganymede: {
    title: 'GANYMEDE — GROOVED TERRAIN / UTOPIA PLANITIA',
    amp: 8,
    craters: { count: 20, rMin: 8, rMax: 30 },
    features: [
      F('plain', { name: 'UTOPIA PLANITIA', x: -250, z: 190, r: 205, flat: 4.5, bright: 0.5, label: true }),
      F('plain', { name: 'DARK GROOVED TERRAIN', x: 250, z: -170, r: 440, dark: 0.45 }),
      F('lineae', { name: 'GROOVED TERRAIN RIDGES', x: 210, z: -150, n: 10, len: 540, ang: 0.3, gap: 30, label: true }),
      F('crater', { name: 'GALLE CRATER', x: 330, z: 250, r: 46, d: 1.2, peak: 1, label: true })
    ],
    low: 0x6e675e, high: 0xbcb3a4,
    dark: 0x3a352e, bright: 0xe8e2d4,
    sky: { stars: 1, sun: 0xf2ecff, sunIntensity: 1.7, ambient: [0x4a4a52, 0.4], fog: null },
    props: { count: 80, color: 0x7a7268 },
    rewards: { ice: 12, iron: 8 },
    caches: 6, cacheExtra: 'ice',
    brokenRovers: 7
  },

  // ------------------------------------------------------------ CALLISTO
  callisto: {
    title: 'CALLISTO — ANCIENT CRATERED TERRAIN',
    amp: 6,
    craters: { count: 60, rMin: 6, rMax: 38 },
    features: [
      F('crater', { name: 'HAWORTH CRATER', x: -250, z: -170, r: 40, d: 1.3, brightFloor: 0.7, label: true }),
      F('palimpsest', { name: 'STYX MACULA', x: 230, z: 190, r: 95, label: true }),
      F('veins', { name: 'DARK VEIN NETWORK', x: 0, z: -250, n: 5, len: 260, ang: 0.2 }),
      F('plain', { name: 'FROST PLAINS', x: 280, z: -240, r: 130, flat: 2, bright: 0.35 })
    ],
    low: 0x55493d, high: 0x8a7e6e,
    dark: 0x241d16, bright: 0xd8d2c8,
    sky: { stars: 1, sun: 0xf2ecff, sunIntensity: 1.6, ambient: [0x44424a, 0.38], fog: null },
    props: { count: 70, color: 0x655a4e },
    rewards: { iron: 12, rare: 2 },
    caches: 6, cacheExtra: 'rare',
    brokenRovers: 7
  },

  // ------------------------------------------------------------ TITAN
  titan: {
    title: 'TITAN — DUNE FIELDS / POLAR SEAS (Cassini SAR)',
    amp: 5,
    craters: { count: 8, rMin: 8, rMax: 22 },
    features: [
      F('lake', { name: 'KRAKEN MARE', x: -250, z: -190, r: 135, lvl: -1.2, label: true }),
      F('lake', { name: 'LIGEIA MARE', x: 220, z: -250, r: 82, lvl: -1.0, label: true }),
      F('lake', { name: 'PUNGA MARE', x: 130, z: 270, r: 58, lvl: -0.9, label: true }),
      F('dunes', { name: 'SHANGRI-LA DUNE FIELD', x: 0, z: 40, r: 230, ang: 0.05, rows: 26, label: true }),
      F('veins', { name: 'FLUVIAL CHANNELS', x: 280, z: 130, n: 3, len: 190, ang: 0.7 })
    ],
    low: 0x6e4e26, high: 0xb08a4e,
    dark: 0x241806, bright: 0xd8b478,
    sky: { stars: 0, sun: 0xffc880, sunIntensity: 1.5, ambient: [0x6a4a20, 0.5], fog: [0xd89a50, 0.0038] },
    props: { count: 60, color: 0x5c4020 },
    lakes: true, // pools render as dark hydrocarbon liquid
    rewards: { ice: 6, rare: 2 },
    caches: 5, cacheExtra: 'water',
    brokenRovers: 7
  },

  // ------------------------------------------------------------ ENCELADUS
  enceladus: {
    title: 'ENCELADUS — SOUTH POLAR TIGER STRIPES',
    amp: 2.5,
    craters: { count: 6, rMin: 5, rMax: 12 },
    features: [
      F('stripe', { name: 'DAMASCUS SULCUS', x: -260, z: 300, len: 140, ang: 0, glow: 0xffc8a0 }),
      F('stripe', { name: 'BAGHDAD SULCUS', x: -220, z: 300, len: 130, ang: 0, glow: 0xffc8a0 }),
      F('stripe', { name: 'CAIRO SULCUS', x: -180, z: 300, len: 135, ang: 0, glow: 0xffc8a0 }),
      F('stripe', { name: 'MUMBAI SULCUS', x: -140, z: 300, len: 125, ang: 0, glow: 0xffc8a0 }),
      F('plain', { name: 'SOUTH POLAR CAP', x: -200, z: 300, r: 115, flat: 0.6, bright: 0.8, label: true })
    ],
    low: 0xd8dde2, high: 0xffffff,
    dark: 0x8a9298, bright: 0xffffff,
    sky: { stars: 1, sun: 0xf2f4ff, sunIntensity: 1.8, ambient: [0x5a6a78, 0.5], fog: null },
    props: { count: 30, color: 0xc2ccd4 },
    rewards: { ice: 14, water: 10 },
    caches: 5, cacheExtra: 'ice',
    brokenRovers: 6
  },

  // ------------------------------------------------------------ TRITON
  triton: {
    title: 'TRITON — N₂ FROST / CANTALOUPE TERRAIN',
    amp: 5,
    craters: { count: 12, rMin: 7, rMax: 22 },
    features: [
      F('cantaloupe', { name: 'CANTALOUPE TERRAIN', x: -230, z: -170, r: 140, label: true }),
      F('crater', { name: 'SOHO PATERA', x: 230, z: 170, r: 48, d: 1.4, label: true }),
      F('veins', { name: 'PAMPEANUSA FOSSAE GEYSERS', x: 130, z: -270, n: 4, len: 170, ang: 0.3, label: true }),
      F('caps', { name: 'SOUTH POLAR CAP (N₂ FROST)', x: -80, z: 340, r: 125, label: true })
    ],
    low: 0xb8aeb4, high: 0xe8e4ea,
    dark: 0x4a3a44, bright: 0xffffff, tint: 0xc8b0b8,
    sky: { stars: 1, sun: 0xd8e4ff, sunIntensity: 1.6, ambient: [0x3a4050, 0.4], fog: [0x9aa8c8, 0.0026] },
    props: { count: 50, color: 0xa89aa0 },
    rewards: { ice: 12, rare: 1 },
    caches: 5, cacheExtra: 'ice',
    brokenRovers: 6
  },

  // ================================================== IRREGULAR MOONS
  phobos: {
    title: 'PHOBOS — RUBBLE-PILE GROOVES',
    amp: 4,
    craters: { count: 14, rMin: 5, rMax: 18 },
    features: [
      F('crater', { name: 'STEAVENSON CRATER', x: 130, z: -110, r: 24, d: 1.3, label: true }),
      F('lineae', { name: 'HOUDINI GROOVE', x: -150, z: 120, n: 3, len: 130, ang: 0.4, gap: 22 })
    ],
    low: 0x4e443a, high: 0x857767,
    dark: 0x1e1914, bright: 0xb0a494,
    sky: { stars: 1, sun: 0xfff0d0, sunIntensity: 2.0, ambient: [0x3a342c, 0.34], fog: null },
    props: { count: 110, color: 0x5c5148 },
    rewards: { iron: 8, nickel: 4 },
    caches: 3,
    brokenRovers: 3
  },

  deimos: {
    title: 'DEIMOS — SMOOTH DUST PLAINS',
    amp: 3,
    craters: { count: 16, rMin: 4, rMax: 14 },
    features: [
      F('plain', { name: 'DUST PLAINS', x: 0, z: 0, r: 420, flat: 1.2, dark: 0.15 }),
      F('crater', { name: 'MAIN CRATER FIELD', x: -140, z: 140, r: 18, d: 1.1, label: true })
    ],
    low: 0x554a3e, high: 0x8f8070,
    dark: 0x221c16, bright: 0xc8bca8,
    sky: { stars: 1, sun: 0xfff0d0, sunIntensity: 2.0, ambient: [0x3a342c, 0.34], fog: null },
    props: { count: 90, color: 0x665a4f },
    rewards: { iron: 8, nickel: 4 },
    caches: 3,
    brokenRovers: 3
  }
};

/** Resolve the theme for a body config (falls back to the body id). */
export function themeFor(bodyCfg) {
  const key = bodyCfg?.surface?.theme || bodyCfg?.id || 'earth';
  return SURFACE_THEMES[key] || SURFACE_THEMES.earth;
}

/** Gas / ice giants have no solid surface — their "surface" is a cloud deck. */
export function isCloudDeck(bodyCfg) {
  return !!themeFor(bodyCfg).cloudDeck;
}
