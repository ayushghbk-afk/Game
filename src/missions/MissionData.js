// MissionData — the mission chain. Each mission has a runtime check() and
// progress() receiving a context snapshot from the Game loop.
export const MISSIONS = [
  {
    id: 'm1', name: 'FIRST FLIGHT',
    desc: 'Leave Earth orbit and head for open space.',
    hint: 'Fly away from Earth (press E near a planet to enter/leave orbit).',
    reward: 500, xp: 100,
    check: (ctx) => ctx.distTo('earth') > 45,
    progress: (ctx) => [Math.min(45, ctx.distTo('earth')), 45]
  },
  {
    id: 'm2', name: 'SCANNER ONLINE',
    desc: 'Use the scanner to survey any celestial body.',
    hint: 'Target a body (T) and press R to scan.',
    reward: 400, xp: 120,
    check: (ctx) => ctx.stats().scans >= 1,
    progress: (ctx) => [Math.min(1, ctx.stats().scans), 1]
  },
  {
    id: 'm3', name: 'LUNAR VISIT',
    desc: 'Reach the Moon and enter its sphere of influence.',
    hint: 'The Moon orbits Earth. Get close — or fast-travel via the map (M).',
    reward: 1000, xp: 200,
    check: (ctx) => ctx.visited('moon'),
    progress: (ctx) => [ctx.visited('moon') ? 1 : 0, 1]
  },
  {
    id: 'm4', name: 'STATION DOCK',
    desc: 'Dock at any space station.',
    hint: 'Earth Station orbits close to your start position. Approach and press E.',
    reward: 800, xp: 150,
    check: (ctx) => ctx.stats().docks >= 1,
    progress: (ctx) => [Math.min(1, ctx.stats().docks), 1]
  },
  {
    id: 'm5', name: 'MARS EXPEDITION',
    desc: 'Reach Mars.',
    hint: 'Mars is the 4th planet. Fast travel from the map if fuel allows.',
    reward: 5000, xp: 500,
    check: (ctx) => ctx.visited('mars'),
    progress: (ctx) => [ctx.visited('mars') ? 1 : 0, 1]
  },
  {
    id: 'm6', name: 'ORE RUN',
    desc: 'Mine 150 units of ore from the asteroid belt.',
    hint: 'Fly to the belt between Mars and Jupiter. Hold E near an asteroid.',
    reward: 2000, xp: 300,
    check: (ctx) => ctx.mined() >= 150,
    progress: (ctx) => [Math.min(150, ctx.mined()), 150]
  },
  {
    id: 'm7', name: 'OUTER SYSTEM',
    desc: 'Reach Jupiter.',
    hint: 'Upgrade your engine at a station before the long haul.',
    reward: 10000, xp: 800,
    check: (ctx) => ctx.visited('jupiter'),
    progress: (ctx) => [ctx.visited('jupiter') ? 1 : 0, 1]
  },
  {
    id: 'm8', name: 'SATURN EXPLORER',
    desc: 'Visit Saturn and its rings.',
    reward: 15000, xp: 1000,
    check: (ctx) => ctx.visited('saturn'),
    progress: (ctx) => [ctx.visited('saturn') ? 1 : 0, 1]
  },
  {
    id: 'm9', name: 'INTO THE ICE',
    desc: 'Reach Uranus.',
    reward: 20000, xp: 1400,
    check: (ctx) => ctx.visited('uranus'),
    progress: (ctx) => [ctx.visited('uranus') ? 1 : 0, 1]
  },
  {
    id: 'm10', name: 'FAR HORIZONS',
    desc: 'Reach Neptune — the edge of the playable system.',
    reward: 25000, xp: 2000,
    check: (ctx) => ctx.visited('neptune'),
    progress: (ctx) => [ctx.visited('neptune') ? 1 : 0, 1]
  }
];
