import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

// Define Interface structures
interface Player {
  id: string;
  name: string;
  email?: string;
  team: 'Red' | 'Blue' | 'FFA';
  x: number;
  y: number;
  z: number;
  ry: number; // yaw rotation
  rx: number; // pitch rotation
  health: number;
  kills: number;
  deaths: number;
  score: number;
  weapon: string;
  energy: number; // Energy recovery system
  isSpeaking: boolean;
  ping: number;
  roomId: string | null;
  lastActive: number;
  helmetLevel: number;
  vestLevel: number;
  medkits: number;
  boosters: number;
}

interface Playzone {
  centerX: number;
  centerZ: number;
  radius: number;
  targetCenterX: number;
  targetCenterZ: number;
  targetRadius: number;
  state: 'waiting' | 'shrinking';
  timer: number;
  stage: number;
}

interface Airdrop {
  id: string;
  x: number;
  y: number;
  z: number;
  looted: boolean;
  item: string;
}

interface LootBox {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  medkits: number;
  boosters: number;
  helmetLevel: number;
  vestLevel: number;
  weapon: string;
  looted: boolean;
}

interface MatchRoom {
  id: string;
  mode: '1v1' | 'FFA' | 'TDM';
  status: 'waiting' | 'active' | 'ended';
  players: string[]; // Player IDs
  scores: { Red: number; Blue: number; [key: string]: number }; // TDM/FFA scores
  weather: 'clear' | 'rain' | 'snow' | 'sandstorm';
  weatherTimeRemaining: number;
  destructibles: { [blockId: string]: number }; // ID -> HP (0 means destroyed)
  timer: number; // seconds remaining
  playzone?: Playzone;
  airdrops?: Airdrop[];
  lootBoxes?: LootBox[];
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // Track rooms and players
  const players: Map<string, Player> = new Map();
  const rooms: Map<string, MatchRoom> = new Map();
  // WebSocket connection mapping
  const wsClients: Map<string, WebSocket> = new Map();

  // API Check endpoint
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'online',
      playersCount: players.size,
      roomsCount: rooms.size,
      time: new Date().toISOString()
    });
  });

  // Create WebSocket Server attached to HTTP server
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // Unique ID generator
  const generateId = () => Math.random().toString(36).substring(2, 9);

  // Broadcaster
  const broadcastToRoom = (roomId: string, message: object, excludeId?: string) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const dataStr = JSON.stringify(message);
    room.players.forEach(pid => {
      if (pid === excludeId) return;
      const client = wsClients.get(pid);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(dataStr);
      }
    });
  };

  // Helper to destroy or damage a block in a room
  const damageDestructibleBlock = (room: MatchRoom, blockId: string, damage: number) => {
    if (room.destructibles[blockId] === undefined) {
      room.destructibles[blockId] = 100; // block starts with 100 HP
    }
    if (room.destructibles[blockId] <= 0) return 0; // already broken

    room.destructibles[blockId] = Math.max(0, room.destructibles[blockId] - damage);
    return room.destructibles[blockId];
  };

  // Cycle weather in active rooms
  const weatherOptions: ('clear' | 'rain' | 'snow' | 'sandstorm')[] = ['clear', 'rain', 'snow', 'sandstorm'];
  
  // Game Loop interval for weather, room timers, and passive energy recovery
  setInterval(() => {
    rooms.forEach((room, roomId) => {
      if (room.status === 'active') {
        // Decrease room match timer
        room.timer = Math.max(0, room.timer - 1);
        if (room.timer <= 0) {
          room.status = 'ended';
          broadcastToRoom(roomId, {
            type: 'match_ended',
            scores: room.scores,
            winner: room.mode === 'TDM' 
              ? (room.scores.Red > room.scores.Blue ? 'Red' : room.scores.Red < room.scores.Blue ? 'Blue' : 'Tie')
              : 'FFA_Winner_Check'
          });
        }

        // Handle dynamic weather transitions
        room.weatherTimeRemaining--;
        if (room.weatherTimeRemaining <= 0) {
          const currentIdx = weatherOptions.indexOf(room.weather);
          let nextIdx = Math.floor(Math.random() * weatherOptions.length);
          if (nextIdx === currentIdx) nextIdx = (nextIdx + 1) % weatherOptions.length;
          
          room.weather = weatherOptions[nextIdx];
          room.weatherTimeRemaining = 45; // 45 seconds per weather cycle
          
          broadcastToRoom(roomId, {
            type: 'weather_change',
            weather: room.weather,
            timeRemaining: room.weatherTimeRemaining
          });
        }

        // --- Battle Royale Playzone (Blue Zone) Ticking Logic ---
        if (!room.playzone) {
          room.playzone = {
            centerX: 0,
            centerZ: 0,
            radius: 80,
            targetCenterX: (Math.random() - 0.5) * 30,
            targetCenterZ: (Math.random() - 0.5) * 30,
            targetRadius: 50,
            state: 'waiting',
            timer: 30, // 30s countdown to shrink
            stage: 1
          };
          room.airdrops = [];
          room.lootBoxes = [];
        }

        const pz = room.playzone;
        if (pz.state === 'waiting') {
          pz.timer = Math.max(0, pz.timer - 1);
          if (pz.timer <= 0) {
            pz.state = 'shrinking';
            broadcastToRoom(roomId, {
              type: 'playzone_announcement',
              message: 'THE BLUE PLAYZONE IS SHRINKING!'
            });
          }
        } else if (pz.state === 'shrinking') {
          // Slowly contract the playzone radius
          const shrinkStep = 0.5;
          if (pz.radius > pz.targetRadius) {
            pz.radius = Math.max(pz.targetRadius, pz.radius - shrinkStep);
          }

          // Move current center towards targeted center coordinates
          const dx = pz.targetCenterX - pz.centerX;
          const dz = pz.targetCenterZ - pz.centerZ;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > 0.1) {
            const moveStep = Math.min(dist, 0.15);
            pz.centerX += (dx / dist) * moveStep;
            pz.centerZ += (dz / dist) * moveStep;
          } else {
            pz.centerX = pz.targetCenterX;
            pz.centerZ = pz.targetCenterZ;
          }

          // Shrink phase finished, calculate next playzone stage
          if (Math.abs(pz.radius - pz.targetRadius) < 0.1 && Math.abs(pz.centerX - pz.targetCenterX) < 0.1) {
            pz.radius = pz.targetRadius;
            pz.centerX = pz.targetCenterX;
            pz.centerZ = pz.targetCenterZ;
            pz.state = 'waiting';
            pz.stage++;

            pz.timer = 40; // Wait 40s before next restriction

            let nextRadius = 45;
            if (pz.stage === 2) nextRadius = 25;
            else if (pz.stage === 3) nextRadius = 12;
            else if (pz.stage === 4) nextRadius = 5;
            else nextRadius = 1.5; // Final shrink stage

            pz.targetRadius = nextRadius;

            // Target center is always nested inside current playzone
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * (pz.radius - nextRadius) * 0.75;
            pz.targetCenterX = pz.centerX + Math.cos(angle) * distance;
            pz.targetCenterZ = pz.centerZ + Math.sin(angle) * distance;

            broadcastToRoom(roomId, {
              type: 'playzone_announcement',
              message: 'SAFE ZONE RE-CONFIGURED. ESCAPE THE BLUE ZONE.'
            });
          }
        }

        // --- Battle Royale Supply Drops / Airdrops Spawning ---
        if (room.timer > 0 && room.timer % 40 === 0) {
          const adId = 'airdrop_' + Math.random().toString(36).substring(2, 9);
          // Spawn within 70% of current playzone boundary
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * pz.radius * 0.7;
          const adX = pz.centerX + Math.cos(angle) * dist;
          const adZ = pz.centerZ + Math.sin(angle) * dist;

          const itemsList = ['AWM-Vanguard Bolt Sniper', 'M249-Titan Heavy LMG', 'Groza-S Bullpup AR', 'Vector-Vortex SMG', 'Deagle-Plasma Sidearm', 'Ghillie Suit'];
          const chosenItem = itemsList[Math.floor(Math.random() * itemsList.length)];

          const newAd = {
            id: adId,
            x: adX,
            y: 40, // falling from above!
            z: adZ,
            looted: false,
            item: chosenItem
          };
          if (!room.airdrops) room.airdrops = [];
          room.airdrops.push(newAd);

          broadcastToRoom(roomId, {
            type: 'airdrop_spawn',
            airdrop: newAd
          });
        }

        // Periodically damage players outside playzone
        room.players.forEach(pid => {
          const p = players.get(pid);
          if (p && p.health > 0) {
            const dx = p.x - pz.centerX;
            const dz = p.z - pz.centerZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > pz.radius) {
              // Out of Safe Zone! Apply damage
              const outDamage = pz.stage * 3 + 2; // Damage scales per stage
              p.health = Math.max(0, p.health - outDamage);

              // Notify client
              const client = wsClients.get(pid);
              if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'playzone_damage',
                  damage: outDamage,
                  health: p.health
                }));
              }

              // Sync to peer indicators
              broadcastToRoom(roomId, {
                type: 'player_damaged',
                id: pid,
                health: p.health,
                damagedBy: 'playzone',
                isHeadshot: false,
                damageDealt: outDamage
              });

              // Check death by zone
              if (p.health <= 0) {
                p.deaths++;
                broadcastToRoom(roomId, {
                  type: 'player_killed',
                  victimId: pid,
                  killerId: 'playzone',
                  weapon: 'Blue Playzone',
                  isHeadshot: false,
                  victimDeaths: p.deaths,
                  killerKills: 0,
                  killerScore: 0
                });

                // Auto respawn after 4 seconds
                setTimeout(() => {
                  const checkTarget = players.get(pid);
                  if (checkTarget && checkTarget.health <= 0 && checkTarget.roomId) {
                    checkTarget.health = 100;
                    checkTarget.energy = 100;
                    checkTarget.helmetLevel = 0;
                    checkTarget.vestLevel = 0;
                    checkTarget.medkits = 1;
                    checkTarget.boosters = 2;

                    const spawnX = pz.centerX + (Math.random() - 0.5) * pz.radius * 0.5;
                    const spawnZ = pz.centerZ + (Math.random() - 0.5) * pz.radius * 0.5;
                    checkTarget.x = spawnX;
                    checkTarget.y = 80;
                    checkTarget.z = spawnZ;

                    broadcastToRoom(checkTarget.roomId, {
                      type: 'player_respawned',
                      id: pid,
                      health: 100,
                      energy: 100,
                      x: spawnX,
                      y: 80,
                      z: spawnZ
                    });
                  }
                }, 4000);
              }
            }
          }
        });

        // Sync room state periodically
        broadcastToRoom(roomId, {
          type: 'room_sync',
          timer: room.timer,
          weather: room.weather,
          weatherTimeRemaining: room.weatherTimeRemaining,
          scores: room.scores,
          playzone: room.playzone,
          airdrops: room.airdrops,
          lootBoxes: room.lootBoxes
        });
      }
    });

    // Recover player energies passively (+5 energy per second, up to 100)
    players.forEach((player, pid) => {
      if (player.roomId) {
        const oldEnergy = player.energy;
        player.energy = Math.min(100, player.energy + 8);
        if (oldEnergy !== player.energy) {
          const client = wsClients.get(pid);
          if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'energy_update',
              energy: player.energy
            }));
          }
        }
      }
    });
  }, 1000);

  // WebSocket Connection Handlers
  wss.on('connection', (ws) => {
    const clientId = generateId();
    console.log(`WebSocket client connected: ${clientId}`);

    // Create initial player state
    const player: Player = {
      id: clientId,
      name: 'Soldier_' + clientId.slice(0, 4),
      team: 'FFA',
      x: (Math.random() - 0.5) * 40,
      y: 80, // Sky spawn altitude for glider parachuting!
      z: (Math.random() - 0.5) * 40,
      ry: 0,
      rx: 0,
      health: 100,
      kills: 0,
      deaths: 0,
      score: 0,
      weapon: 'Assault Rifle',
      energy: 100,
      isSpeaking: false,
      ping: 0,
      roomId: null,
      lastActive: Date.now(),
      helmetLevel: 1, // Level 1 Helmet starting out
      vestLevel: 1, // Level 1 Vest starting out
      medkits: 1,
      boosters: 2
    };

    players.set(clientId, player);
    wsClients.set(clientId, ws);

    // Welcome client and provide ID
    ws.send(JSON.stringify({
      type: 'welcome',
      id: clientId
    }));

    ws.on('message', (messageStr) => {
      try {
        const data = JSON.parse(messageStr.toString());
        player.lastActive = Date.now();

        switch (data.type) {
          case 'join_lobby': {
            player.name = data.name || player.name;
            player.email = data.email || undefined;
            
            // Matchmaking queue placement
            const selectedMode: '1v1' | 'FFA' | 'TDM' = data.mode || 'FFA';
            
            // Find an open room
            let assignedRoom: MatchRoom | null = null;
            rooms.forEach(r => {
              if (r.mode === selectedMode && r.status === 'waiting' && r.players.length < (r.mode === '1v1' ? 2 : 10)) {
                assignedRoom = r;
              }
            });

            // If no room, create one
            if (!assignedRoom) {
              const newRoomId = 'room_' + generateId();
              assignedRoom = {
                id: newRoomId,
                mode: selectedMode,
                status: 'waiting',
                players: [],
                scores: { Red: 0, Blue: 0 },
                weather: 'clear',
                weatherTimeRemaining: 45,
                destructibles: {},
                timer: selectedMode === '1v1' ? 180 : 300, // 3 min or 5 min
                playzone: {
                  centerX: 0,
                  centerZ: 0,
                  radius: 80,
                  targetCenterX: (Math.random() - 0.5) * 20,
                  targetCenterZ: (Math.random() - 0.5) * 20,
                  targetRadius: 45,
                  state: 'waiting',
                  timer: 30, // 30s warm up countdown
                  stage: 1
                },
                airdrops: [],
                lootBoxes: []
              };
              
              // Seed initial destructible barricade cubes
              // Coordinates correspond to voxel clusters
              for (let i = 0; i < 20; i++) {
                assignedRoom.destructibles[`box_${i}`] = 100; // 100 hp
              }
              rooms.set(newRoomId, assignedRoom);
            }

            // Assign player to room
            const room: MatchRoom = assignedRoom;
            player.roomId = room.id;
            room.players.push(clientId);

            // Assign team based on mode
            if (room.mode === 'TDM') {
              // Balance team distribution
              let redCount = 0;
              let blueCount = 0;
              room.players.forEach(pId => {
                const p = players.get(pId);
                if (p) {
                  if (p.team === 'Red') redCount++;
                  else if (p.team === 'Blue') blueCount++;
                }
              });
              player.team = redCount <= blueCount ? 'Red' : 'Blue';
            } else {
              player.team = 'FFA';
            }

            // If room hits minimum players, start game
            const minPlayersNeeded = room.mode === '1v1' ? 2 : 1; // start immediately or wait
            if (room.players.length >= minPlayersNeeded) {
              room.status = 'active';
            }

            // Send joined feedback with room detail
            ws.send(JSON.stringify({
              type: 'joined_room',
              room: {
                id: room.id,
                mode: room.mode,
                status: room.status,
                weather: room.weather,
                weatherTimeRemaining: room.weatherTimeRemaining,
                destructibles: room.destructibles,
                timer: room.timer,
                scores: room.scores
              },
              playerState: {
                id: player.id,
                name: player.name,
                team: player.team,
                energy: player.energy
              }
            }));

            // Tell everyone in the room about the new player
            broadcastToRoom(room.id, {
              type: 'player_joined',
              player: {
                id: player.id,
                name: player.name,
                team: player.team,
                x: player.x,
                y: player.y,
                z: player.z,
                ry: player.ry,
                rx: player.rx,
                health: player.health,
                weapon: player.weapon,
                energy: player.energy,
                isSpeaking: player.isSpeaking,
                kills: player.kills,
                deaths: player.deaths,
                score: player.score
              }
            }, clientId);

            // Sync other existing players in room back to this joining client
            room.players.forEach(pId => {
              if (pId === clientId) return;
              const otherP = players.get(pId);
              if (otherP) {
                ws.send(JSON.stringify({
                  type: 'player_joined',
                  player: {
                    id: otherP.id,
                    name: otherP.name,
                    team: otherP.team,
                    x: otherP.x,
                    y: otherP.y,
                    z: otherP.z,
                    ry: otherP.ry,
                    rx: otherP.rx,
                    health: otherP.health,
                    weapon: otherP.weapon,
                    energy: otherP.energy,
                    isSpeaking: otherP.isSpeaking,
                    kills: otherP.kills,
                    deaths: otherP.deaths,
                    score: otherP.score
                  }
                }));
              }
            });

            break;
          }

          case 'player_update': {
            if (!player.roomId) return;
            // Update movement state
            player.x = typeof data.x === 'number' ? data.x : player.x;
            player.y = typeof data.y === 'number' ? data.y : player.y;
            player.z = typeof data.z === 'number' ? data.z : player.z;
            player.ry = typeof data.ry === 'number' ? data.ry : player.ry;
            player.rx = typeof data.rx === 'number' ? data.rx : player.rx;
            player.weapon = data.weapon || player.weapon;
            
            // Broadcast moving positions to other room players
            broadcastToRoom(player.roomId, {
              type: 'peer_update',
              id: player.id,
              x: player.x,
              y: player.y,
              z: player.z,
              ry: player.ry,
              rx: player.rx,
              weapon: player.weapon,
              isWalking: data.isWalking || false,
              isShooting: data.isShooting || false
            }, player.id);
            break;
          }

          case 'weapon_fire': {
            if (!player.roomId) return;
            // Broadcast muzzle flashes, tracers or bullet spawning to peers
            broadcastToRoom(player.roomId, {
              type: 'peer_fire',
              id: player.id,
              origin: data.origin,
              direction: data.direction,
              weapon: player.weapon
            }, player.id);
            break;
          }

          case 'use_skill': {
            if (!player.roomId) return;
            // Energy cost reduction
            const cost = data.cost || 40;
            if (player.energy >= cost) {
              player.energy -= cost;
              // Trigger skill broadcast (e.g. speed boost, scan, barrier)
              broadcastToRoom(player.roomId, {
                type: 'peer_skill',
                id: player.id,
                skillType: data.skillType,
                energyLeft: player.energy
              });
            } else {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Insufficient energy for skill!'
              }));
            }
            break;
          }

          case 'destroy_block': {
            if (!player.roomId) return;
            const room = rooms.get(player.roomId);
            if (!room) return;
            const blockId = data.blockId;
            const dmg = data.damage || 25;
            const currentHp = damageDestructibleBlock(room, blockId, dmg);

            broadcastToRoom(player.roomId, {
              type: 'block_damaged',
              blockId,
              hp: currentHp
            });
            break;
          }

          case 'hit_player': {
            if (!player.roomId) return;
            const targetId = data.targetId;
            const dmg = data.damage || 20;
            const isHeadshot = data.isHeadshot || false;

            const target = players.get(targetId);
            if (target && target.roomId === player.roomId && target.health > 0) {
              // --- Apply Battle Royale Armor Damage Mitigation ---
              let finalDmg = dmg;
              if (isHeadshot) {
                // Helmet Level 1: 30%, Level 2: 45%, Level 3: 60% reduction
                const helmetMitigations = [1.0, 0.70, 0.55, 0.40];
                const lvl = target.helmetLevel || 0;
                finalDmg = dmg * (helmetMitigations[lvl] ?? 1.0);
              } else {
                // Vest Level 1: 20%, Level 2: 35%, Level 3: 50% reduction
                const vestMitigations = [1.0, 0.80, 0.65, 0.50];
                const lvl = target.vestLevel || 0;
                finalDmg = dmg * (vestMitigations[lvl] ?? 1.0);
              }
              finalDmg = Math.round(finalDmg);

              // Apply damage
              target.health = Math.max(0, target.health - finalDmg);

              // Notify players about hit damage indicators
              broadcastToRoom(player.roomId, {
                type: 'player_damaged',
                id: targetId,
                health: target.health,
                damagedBy: player.id,
                isHeadshot,
                damageDealt: finalDmg
              });

              // Check if dead
              if (target.health <= 0) {
                target.deaths++;
                player.kills++;
                player.score += isHeadshot ? 150 : 100;

                const room = rooms.get(player.roomId);
                if (room) {
                  // Increment room scores
                  if (room.mode === 'TDM') {
                    if (player.team === 'Red') room.scores.Red++;
                    else if (player.team === 'Blue') room.scores.Blue++;
                  } else {
                    // FFA score tracker using player clientIds
                    room.scores[player.id] = (room.scores[player.id] || 0) + 1;
                  }

                  // --- Spawn dead player Death Loot Box ---
                  const boxId = 'box_' + Math.random().toString(36).substring(2, 9);
                  const newLootBox: LootBox = {
                    id: boxId,
                    name: `${target.name}'s Death Crate`,
                    x: target.x,
                    y: 0.5, // ground level
                    z: target.z,
                    medkits: target.medkits || 0,
                    boosters: target.boosters || 0,
                    helmetLevel: target.helmetLevel || 0,
                    vestLevel: target.vestLevel || 0,
                    weapon: target.weapon || 'Assault Rifle',
                    looted: false
                  };
                  if (!room.lootBoxes) room.lootBoxes = [];
                  room.lootBoxes.push(newLootBox);

                  broadcastToRoom(player.roomId, {
                    type: 'loot_box_spawn',
                    lootBox: newLootBox
                  });
                }

                // Broadcast death feed
                broadcastToRoom(player.roomId, {
                  type: 'player_killed',
                  victimId: targetId,
                  killerId: player.id,
                  weapon: player.weapon,
                  isHeadshot,
                  victimDeaths: target.deaths,
                  killerKills: player.kills,
                  killerScore: player.score
                });

                // Auto respawn target after 4 seconds
                setTimeout(() => {
                  const checkTarget = players.get(targetId);
                  if (checkTarget && checkTarget.health <= 0 && checkTarget.roomId) {
                    checkTarget.health = 100;
                    checkTarget.energy = 100;
                    // Reset to Lvl 1 starter equipment, with 1 medkit and 2 boosters
                    checkTarget.helmetLevel = 1;
                    checkTarget.vestLevel = 1;
                    checkTarget.medkits = 1;
                    checkTarget.boosters = 2;

                    // Spawn coordinates in a scatter map
                    const roomObj = rooms.get(checkTarget.roomId);
                    const spawnRadius = roomObj?.playzone?.radius || 40;
                    const spawnX = (roomObj?.playzone?.centerX || 0) + (Math.random() - 0.5) * spawnRadius * 0.8;
                    const spawnZ = (roomObj?.playzone?.centerZ || 0) + (Math.random() - 0.5) * spawnRadius * 0.8;
                    
                    checkTarget.x = spawnX;
                    checkTarget.y = 80; // Sky-spawn altitude for gliding parachutes!
                    checkTarget.z = spawnZ;

                    broadcastToRoom(checkTarget.roomId, {
                      type: 'player_respawned',
                      id: targetId,
                      health: 100,
                      energy: 100,
                      x: spawnX,
                      y: 80, // Parachute ready!
                      z: spawnZ
                    });
                  }
                }, 4000);
              }
            }
            break;
          }

          case 'loot_airdrop': {
            if (!player.roomId) return;
            const room = rooms.get(player.roomId);
            if (!room || !room.airdrops) return;

            const adId = data.airdropId;
            const ad = room.airdrops.find(a => a.id === adId);
            if (ad && !ad.looted) {
              ad.looted = true;

              // Upgrade player weapons & armor
              if (ad.item === 'AWM-Vanguard Bolt Sniper' || ad.item === 'M249-Titan Heavy LMG' || ad.item === 'Groza-S Bullpup AR' || ad.item === 'Vector-Vortex SMG' || ad.item === 'Deagle-Plasma Sidearm') {
                player.weapon = ad.item;
              }
              player.helmetLevel = 3; // Loot drop always gives Lvl 3 Helmet
              player.vestLevel = 3; // and Lvl 3 Vest!
              player.medkits = Math.min(5, player.medkits + 1);
              player.boosters = Math.min(5, player.boosters + 1);

              // Notify sender of success
              ws.send(JSON.stringify({
                type: 'loot_success',
                item: ad.item,
                helmetLevel: player.helmetLevel,
                vestLevel: player.vestLevel,
                medkits: player.medkits,
                boosters: player.boosters,
                weaponName: player.weapon
              }));

              // Sync to peer movement displays
              broadcastToRoom(player.roomId, {
                type: 'peer_update',
                id: player.id,
                x: player.x,
                y: player.y,
                z: player.z,
                ry: player.ry,
                rx: player.rx,
                weapon: player.weapon,
                isWalking: false,
                isShooting: false
              }, player.id);

              // Announcement to everyone
              broadcastToRoom(room.id, {
                type: 'playzone_announcement',
                message: `${player.name} LOOTED THE AIRDROP: ${ad.item.toUpperCase()}!`
              });
            }
            break;
          }

          case 'loot_box': {
            if (!player.roomId) return;
            const room = rooms.get(player.roomId);
            if (!room || !room.lootBoxes) return;

            const boxId = data.boxId;
            const boxIndex = room.lootBoxes.findIndex(b => b.id === boxId);
            if (boxIndex !== -1) {
              const box = room.lootBoxes[boxIndex];
              if (!box.looted) {
                box.looted = true;

                // Inherit dead player weapons/items if higher/better
                if (box.weapon && box.weapon !== 'Assault Rifle') {
                  player.weapon = box.weapon;
                }
                player.helmetLevel = Math.max(player.helmetLevel, box.helmetLevel);
                player.vestLevel = Math.max(player.vestLevel, box.vestLevel);
                player.medkits = Math.min(5, player.medkits + box.medkits);
                player.boosters = Math.min(5, player.boosters + box.boosters);

                // Notify sender of success
                ws.send(JSON.stringify({
                  type: 'loot_success',
                  item: `Crate of ${box.weapon}`,
                  helmetLevel: player.helmetLevel,
                  vestLevel: player.vestLevel,
                  medkits: player.medkits,
                  boosters: player.boosters,
                  weaponName: player.weapon
                }));

                // Sync to peer displays
                broadcastToRoom(player.roomId, {
                  type: 'peer_update',
                  id: player.id,
                  x: player.x,
                  y: player.y,
                  z: player.z,
                  ry: player.ry,
                  rx: player.rx,
                  weapon: player.weapon,
                  isWalking: false,
                  isShooting: false
                }, player.id);

                // Remove the looted death crate from the active list
                room.lootBoxes.splice(boxIndex, 1);

                // Update everyone
                broadcastToRoom(room.id, {
                  type: 'loot_box_removed',
                  id: boxId
                });
              }
            }
            break;
          }

          case 'use_item': {
            const itemType = data.itemType; // 'medkit' or 'booster'
            if (itemType === 'medkit' && player.medkits > 0) {
              player.medkits--;
              player.health = 100;
              
              // Send sync back to sender
              ws.send(JSON.stringify({
                type: 'inventory_sync',
                health: player.health,
                energy: player.energy,
                medkits: player.medkits,
                boosters: player.boosters
              }));

              // Sync health update to peers
              broadcastToRoom(player.roomId!, {
                type: 'player_damaged',
                id: player.id,
                health: player.health,
                damagedBy: 'heal',
                isHeadshot: false,
                damageDealt: 0
              });
            } else if (itemType === 'booster' && player.boosters > 0) {
              player.boosters--;
              player.energy = 100;

              // Send sync back to sender
              ws.send(JSON.stringify({
                type: 'inventory_sync',
                health: player.health,
                energy: player.energy,
                medkits: player.medkits,
                boosters: player.boosters
              }));
            }
            break;
          }

          // Voice chat packets routing
          case 'voice_data': {
            if (!player.roomId) return;
            player.isSpeaking = data.isSpeaking || false;
            
            // Send audio frame / voice indication to team members
            broadcastToRoom(player.roomId, {
              type: 'peer_voice',
              id: player.id,
              isSpeaking: player.isSpeaking,
              audioData: data.audioData, // Raw chunks (if sent) or voice animation states
              textMacro: data.textMacro // Tactical voice communication macro (e.g., "Need Backup!", "Enemy Spotted!")
            }, player.id);
            break;
          }

          case 'voice_indicator': {
            if (!player.roomId) return;
            player.isSpeaking = data.isSpeaking;
            broadcastToRoom(player.roomId, {
              type: 'peer_voice_indicator',
              id: player.id,
              isSpeaking: player.isSpeaking
            }, player.id);
            break;
          }

          case 'leave_match': {
            handlePlayerLeave(clientId);
            break;
          }

          case 'ping': {
            ws.send(JSON.stringify({
              type: 'pong',
              time: data.time
            }));
            break;
          }
        }
      } catch (err) {
        console.error('WebSocket message parsing error:', err);
      }
    });

    const handlePlayerLeave = (pId: string) => {
      const p = players.get(pId);
      if (!p) return;

      if (p.roomId) {
        const room = rooms.get(p.roomId);
        if (room) {
          // Remove from room list
          room.players = room.players.filter(id => id !== pId);
          
          // Broadcast leaving
          broadcastToRoom(room.id, {
            type: 'player_left',
            id: pId
          });

          // Clean up empty rooms
          if (room.players.length === 0) {
            rooms.delete(p.roomId);
            console.log(`Room deleted as empty: ${room.id}`);
          }
        }
      }
      p.roomId = null;
    };

    ws.on('close', () => {
      console.log(`WebSocket client disconnected: ${clientId}`);
      handlePlayerLeave(clientId);
      players.delete(clientId);
      wsClients.delete(clientId);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket client error [${clientId}]:`, err);
    });
  });

  // Vite Integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`FPS Arena Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Error starting server:', err);
});
