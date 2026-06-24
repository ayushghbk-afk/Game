import { useState, useEffect, useRef } from 'react';
import { Menu } from './components/Menu';
import { GameHUD } from './components/GameHUD';
import { ThreeGame } from './components/ThreeGame';
import { AudioVoiceController } from './components/AudioVoiceController';
import { WeaponConfig, PeerPlayer, KillFeedItem, PlayzoneState } from './types';
import { auth } from './firebase';
import { dbService } from './services/dbService';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RefreshCw, LogOut, CheckCircle, Crosshair } from 'lucide-react';

export default function App() {
  const [inGame, setInGame] = useState(false);
  const [matchOptions, setMatchOptions] = useState<{
    mode: '1v1' | 'FFA' | 'TDM';
    name: string;
    email?: string;
    activeWeapon: WeaponConfig;
  } | null>(null);

  // Connection and client reference
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Dynamic game hud properties
  const [health, setHealth] = useState(100);
  const [energy, setEnergy] = useState(100);
  const [ammo, setAmmo] = useState(30);
  const [maxAmmo, setMaxAmmo] = useState(30);
  const [reloading, setReloading] = useState(false);
  const [activeWeather, setActiveWeather] = useState<'clear' | 'rain' | 'snow' | 'sandstorm'>('clear');
  const [weatherTimer, setWeatherTimer] = useState(45);
  const [matchTimer, setMatchTimer] = useState(300);

  // Scores and stats
  const [kills, setKills] = useState(0);
  const [deaths, setDeaths] = useState(0);
  const [score, setScore] = useState(0);
  
  // Lobby tracking
  const [peers, setPeers] = useState<Map<string, PeerPlayer>>(new Map());
  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);
  const [voiceSpeakingPeers, setVoiceSpeakingPeers] = useState<string[]>([]);

  // Battle Royale dynamic states
  const [playzone, setPlayzone] = useState<PlayzoneState | undefined>(undefined);
  const [helmetLevel, setHelmetLevel] = useState<number>(1);
  const [vestLevel, setVestLevel] = useState<number>(1);
  const [medkits, setMedkits] = useState<number>(1);
  const [boosters, setBoosters] = useState<number>(2);
  const [isGliding, setIsGliding] = useState<boolean>(false);
  const [distanceToSafeZone, setDistanceToSafeZone] = useState<number>(0);
  const [closestInteractiveLoot, setClosestInteractiveLoot] = useState<{ id: string; name: string; type: 'airdrop' | 'lootbox' } | null>(null);

  // Post match review screen
  const [showSummary, setShowSummary] = useState(false);
  const [summarySaving, setSummarySaving] = useState(false);
  const [eloGained, setEloGained] = useState(0);

  // Parent -> Child Ref to trigger HUD actions inside ThreeJS engine
  const gameTriggerRef = useRef<((skillType: 'dash' | 'heal' | 'scan') => void) | null>(null);

  // Start match session
  const handleStartMatch = (options: {
    mode: '1v1' | 'FFA' | 'TDM';
    name: string;
    email?: string;
    activeWeapon: WeaponConfig;
  }) => {
    setMatchOptions(options);
    setKills(0);
    setDeaths(0);
    setScore(0);
    setHealth(100);
    setEnergy(100);
    setAmmo(options.activeWeapon.ammoMax);
    setMaxAmmo(options.activeWeapon.ammoMax);
    setPeers(new Map());
    setKillFeed([]);
    setVoiceSpeakingPeers([]);

    // Reset Battle Royale HUD variables
    setPlayzone(undefined);
    setHelmetLevel(1);
    setVestLevel(1);
    setMedkits(1);
    setBoosters(2);
    setIsGliding(false);
    setDistanceToSafeZone(0);
    setClosestInteractiveLoot(null);
    
    // Connect to WebSocket Server on same port 3000
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Connecting to Tactical Comms Server: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;
    setSocket(ws);

    ws.onopen = () => {
      console.log('Tactical Comms Link established.');
      setInGame(true);
      setShowSummary(false);
    };

    ws.onclose = () => {
      console.log('Comms link terminated.');
      setInGame(false);
    };

    // Global listeners for room configurations
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'room_sync') {
          setMatchTimer(msg.timer);
          setActiveWeather(msg.weather);
          setWeatherTimer(msg.weatherTimeRemaining);
        } else if (msg.type === 'weather_change') {
          setActiveWeather(msg.weather);
          setWeatherTimer(msg.timeRemaining);
        } else if (msg.type === 'energy_update') {
          setEnergy(msg.energy);
        } else if (msg.type === 'match_ended') {
          handleMatchFinished();
        }
      } catch (err) {
        console.warn(err);
      }
    };
  };

  const handleMatchFinished = async () => {
    // Unlocks pointer locks
    document.exitPointerLock();
    setShowSummary(true);
    setSummarySaving(true);

    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        // Did we win? TDM check or simple 1v1 ELO check
        const isWin = kills >= deaths;
        const oldElo = await dbService.getOrCreateUserProfile(currentUser.uid, currentUser.displayName || 'Soldier');
        const updated = await dbService.recordMatchResult(currentUser.uid, kills, deaths, isWin);
        setEloGained(updated.elo - oldElo.elo);
      } catch (err) {
        console.warn('Could not record ELO to Firebase: ', err);
      }
    } else {
      // Local Guest ELO modify
      setEloGained(kills * 5 - deaths * 3);
    }
    setSummarySaving(false);

    // Close Comms
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
      setSocket(null);
    }
  };

  const handleExitMatch = () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
      setSocket(null);
    }
    setInGame(false);
    setShowSummary(false);
  };

  // Triggers visual quick feed items
  const handleKillFeedUpdate = (item: KillFeedItem) => {
    setKillFeed(prev => [item, ...prev].slice(0, 5)); // Keep only last 5 feed events
  };

  // Client microphone voice state change transmitter
  const handleVoiceStateChange = (isSpeaking: boolean) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'voice_indicator',
        isSpeaking
      }));
    }
  };

  return (
    <div className="w-screen h-screen bg-slate-950 text-white relative select-none overflow-hidden">
      {!inGame && !showSummary && (
        <Menu onStartMatch={handleStartMatch} />
      )}

      {inGame && matchOptions && (
        <div className="w-full h-full relative">
          {/* Main 3D ThreeJS scene */}
          <ThreeGame
            socket={socket}
            mode={matchOptions.mode}
            team={matchOptions.mode === 'TDM' ? 'Red' : 'FFA'} // default
            playerName={matchOptions.name}
            activeWeapon={matchOptions.activeWeapon}
            activeWeather={activeWeather}
            onStatsUpdate={(k, d, s) => {
              setKills(k);
              setDeaths(d);
              setScore(s);
            }}
            onHealthChange={setHealth}
            onEnergyChange={setEnergy}
            onAmmoChange={(a, m, r) => {
              setAmmo(a);
              setMaxAmmo(m);
              setReloading(r);
            }}
            onKillFeedUpdate={handleKillFeedUpdate}
            onPeerSpeakingUpdate={setVoiceSpeakingPeers}
            gameTriggerRef={gameTriggerRef}
            onInventoryUpdate={(inv) => {
              setHelmetLevel(inv.helmetLevel);
              setVestLevel(inv.vestLevel);
              setMedkits(inv.medkits);
              setBoosters(inv.boosters);
            }}
            onWeaponUpdate={(newWeapon) => {
              setMatchOptions(prev => prev ? { ...prev, activeWeapon: newWeapon } : null);
            }}
            onPlayzoneUpdate={(pz, dist) => {
              setPlayzone(pz);
              setDistanceToSafeZone(dist);
            }}
            onGlidingChange={setIsGliding}
            onLootProximityChange={setClosestInteractiveLoot}
          />

          {/* HUD Overlay */}
          <GameHUD
            health={health}
            energy={energy}
            ammo={ammo}
            maxAmmo={maxAmmo}
            reloading={reloading}
            equippedWeapon={matchOptions.activeWeapon}
            activeWeather={activeWeather}
            weatherTimer={weatherTimer}
            matchTimer={matchTimer}
            mode={matchOptions.mode}
            team={matchOptions.mode === 'TDM' ? 'Red' : 'FFA'}
            kills={kills}
            deaths={deaths}
            score={score}
            peers={peers}
            killFeed={killFeed}
            voiceSpeakingPeers={voiceSpeakingPeers}
            playzone={playzone}
            helmetLevel={helmetLevel}
            vestLevel={vestLevel}
            medkits={medkits}
            boosters={boosters}
            isGliding={isGliding}
            distanceToSafeZone={distanceToSafeZone}
            closestInteractiveLoot={closestInteractiveLoot}
            onTriggerSkill={(skillId) => {
              if (gameTriggerRef.current) {
                gameTriggerRef.current(skillId);
              }
            }}
            onExitGame={handleExitMatch}
          />

          {/* Tactical Voice Comms Sidepanel */}
          <div className="absolute right-6 top-24 z-30 pointer-events-auto">
            <AudioVoiceController
              socket={socket}
              onVoiceStateChange={handleVoiceStateChange}
              team={matchOptions.mode === 'TDM' ? 'Red' : 'FFA'}
              playerName={matchOptions.name}
            />
          </div>
        </div>
      )}

      {/* Post Match review screen */}
      <AnimatePresence>
        {showSummary && matchOptions && (
          <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50 p-6">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 p-8 rounded-2xl w-full max-w-md text-center shadow-2xl flex flex-col items-center gap-6"
            >
              <Trophy className="w-16 h-16 text-amber-400 animate-pulse" />
              <div>
                <h2 className="text-xl font-extrabold uppercase tracking-widest text-slate-100">
                  Simulation Concluded
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  TACTICAL DEPLOYMENT REPORT
                </p>
              </div>

              {/* Stats Block */}
              <div className="grid grid-cols-3 gap-3 w-full bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Kills</div>
                  <div className="text-md font-bold text-emerald-400 mt-1">{kills}</div>
                </div>
                <div className="border-r border-slate-800 h-10" />
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Deaths</div>
                  <div className="text-md font-bold text-red-400 mt-1">{deaths}</div>
                </div>
                <div className="border-r border-slate-800 h-10" />
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Score</div>
                  <div className="text-md font-bold text-amber-400 mt-1">{score}</div>
                </div>
              </div>

              {/* ELO Modify review */}
              <div className="w-full bg-slate-950/40 p-3 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400 uppercase">Rank rating performance</span>
                {summarySaving ? (
                  <span className="text-slate-500 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Syncing...
                  </span>
                ) : (
                  <span className={`font-bold ${eloGained >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {eloGained >= 0 ? `+${eloGained}` : eloGained} ELO Rating
                  </span>
                )}
              </div>

              {/* Return button */}
              <button
                onClick={handleExitMatch}
                className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-bold uppercase tracking-wider rounded-xl hover:opacity-90 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Return to Tactical Base
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
