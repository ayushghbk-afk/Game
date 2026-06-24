import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WEAPONS, SKILLS } from '../constants';
import { WeaponConfig, KillFeedItem, PeerPlayer, PlayzoneState } from '../types';
import { 
  Heart, 
  Zap, 
  Target, 
  Clock, 
  CloudSun, 
  CloudRain, 
  CloudSnow, 
  Wind, 
  Users, 
  UserX,
  Radio,
  Sliders,
  Sparkles
} from 'lucide-react';

interface GameHUDProps {
  health: number;
  energy: number;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
  equippedWeapon: WeaponConfig;
  activeWeather: 'clear' | 'rain' | 'snow' | 'sandstorm';
  weatherTimer: number;
  matchTimer: number;
  mode: '1v1' | 'FFA' | 'TDM';
  team: 'Red' | 'Blue' | 'FFA';
  kills: number;
  deaths: number;
  score: number;
  peers: Map<string, PeerPlayer>;
  killFeed: KillFeedItem[];
  voiceSpeakingPeers: string[]; // List of peer names currently speaking
  onTriggerSkill: (skillId: 'dash' | 'heal' | 'scan') => void;
  onExitGame: () => void;
  // --- Battle Royale Custom Props ---
  playzone?: PlayzoneState;
  helmetLevel: number;
  vestLevel: number;
  medkits: number;
  boosters: number;
  isGliding: boolean;
  distanceToSafeZone: number; // distance in meters
  closestInteractiveLoot?: { id: string; name: string; type: 'airdrop' | 'lootbox' } | null;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  health,
  energy,
  ammo,
  maxAmmo,
  reloading,
  equippedWeapon,
  activeWeather,
  weatherTimer,
  matchTimer,
  mode,
  team,
  kills,
  deaths,
  score,
  peers,
  killFeed,
  voiceSpeakingPeers,
  onTriggerSkill,
  onExitGame,
  playzone,
  helmetLevel,
  vestLevel,
  medkits,
  boosters,
  isGliding,
  distanceToSafeZone,
  closestInteractiveLoot
}) => {
  // Scoreboard overlay state (toggled with Tab key)
  const [showScoreboard, setShowScoreboard] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowScoreboard(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowScoreboard(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const formatTimer = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  // Weather descriptions and multipliers
  const getWeatherMeta = () => {
    switch (activeWeather) {
      case 'rain':
        return {
          icon: <CloudRain className="w-5 h-5 text-blue-400 animate-bounce-slow" />,
          title: 'Acid Rainstorm',
          effect: 'Visibility -30% • Muddy ground',
          color: 'from-blue-500/10 to-blue-900/10 border-blue-500/30'
        };
      case 'snow':
        return {
          icon: <CloudSnow className="w-5 h-5 text-sky-200 animate-spin-slow" />,
          title: 'Vortex Blizzard',
          effect: 'Visibility -50% • Friction -20%',
          color: 'from-sky-500/10 to-indigo-900/10 border-sky-400/30'
        };
      case 'sandstorm':
        return {
          icon: <Wind className="w-5 h-5 text-amber-500 animate-pulse" />,
          title: 'Solar Sandstorm',
          effect: 'Visibility -75% • Kinetic drag +10%',
          color: 'from-amber-600/10 to-yellow-900/10 border-amber-600/30'
        };
      default:
        return {
          icon: <CloudSun className="w-5 h-5 text-emerald-400" />,
          title: 'Optimal Clear',
          effect: 'Visibility 100% • Standard movement',
          color: 'from-emerald-500/10 to-slate-900/10 border-emerald-500/20'
        };
    }
  };

  const weatherMeta = getWeatherMeta();

  return (
    <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-between p-6 font-sans select-none">
      
      {/* Top HUD Layout (Weather, Timer, Scores) */}
      <div className="flex items-start justify-between">
        
        {/* Match Timer & Game Stats */}
        <div className="flex gap-4">
          {/* Match timer block */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg backdrop-blur-md">
            <Clock className="w-5 h-5 text-indigo-400" />
            <div className="text-left">
              <div className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">MATCH TIME</div>
              <div className="text-md font-bold text-slate-100 font-mono leading-none mt-0.5">
                {formatTimer(matchTimer)}
              </div>
            </div>
          </div>

          {/* Player Personal Stat Block */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-4 shadow-lg backdrop-blur-md">
            <div>
              <div className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">KILLS</div>
              <div className="text-md font-extrabold text-emerald-400 text-center font-mono mt-0.5">{kills}</div>
            </div>
            <div className="border-r border-slate-800 h-6" />
            <div>
              <div className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">DEATHS</div>
              <div className="text-md font-extrabold text-red-400 text-center font-mono mt-0.5">{deaths}</div>
            </div>
            <div className="border-r border-slate-800 h-6" />
            <div>
              <div className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">SCORE</div>
              <div className="text-md font-extrabold text-amber-400 text-center font-mono mt-0.5">{score}</div>
            </div>
          </div>
        </div>

        {/* Dynamic Weather Sync Box */}
        <div className={`bg-gradient-to-br ${weatherMeta.color} bg-slate-950/85 border rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg backdrop-blur-md transition-all duration-300`}>
          {weatherMeta.icon}
          <div className="text-left">
            <div className="flex items-center gap-1.5 justify-between">
              <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase">{weatherMeta.title}</span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 bg-slate-900 border border-slate-800 text-slate-400 rounded-md">
                {weatherTimer}s
              </span>
            </div>
            <div className="text-xs font-bold text-slate-200 mt-0.5 uppercase tracking-wide">
              {weatherMeta.effect}
            </div>
          </div>
        </div>

        {/* Tactical Voice Activity Indicator Overlay */}
        <div className="flex flex-col gap-1.5 items-end">
          {voiceSpeakingPeers.length > 0 && (
            <div className="bg-slate-950/90 border border-green-500/30 p-2.5 rounded-xl shadow-lg backdrop-blur-md flex flex-col gap-1">
              <div className="flex items-center gap-1.5 mb-1">
                <Radio className="w-3.5 h-3.5 text-green-400 animate-pulse" />
                <span className="text-[9px] font-bold text-green-400 uppercase tracking-wider font-mono">RADIO RX ACTIVE</span>
              </div>
              <div className="flex flex-col gap-1">
                {voiceSpeakingPeers.map((name, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[10px] text-slate-200 font-semibold font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping" />
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick HUD controls */}
          <button 
            onClick={onExitGame}
            className="pointer-events-auto px-3 py-1.5 bg-red-600/10 hover:bg-red-600/25 border border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer"
          >
            Abondon Match
          </button>
        </div>
      </div>

      {/* Center Reticle and Damage Crosshair Overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Precision Crosshairs */}
        <div className="relative">
          <div className="absolute w-3 h-[1px] bg-emerald-400 -left-4" />
          <div className="absolute w-3 h-[1px] bg-emerald-400 -right-4" />
          <div className="absolute h-3 w-[1px] bg-emerald-400 -top-4" />
          <div className="absolute h-3 w-[1px] bg-emerald-400 -bottom-4" />
          {/* Centered precision point */}
          <div className="w-1 h-1 bg-emerald-400 rounded-full" />
        </div>
      </div>

      {/* Mid Left HUD: Kill Feed & Notifications */}
      <div className="flex-1 flex items-end justify-between py-6">
        
        {/* Left Side: Dynamic Match Kill-feed */}
        <div className="flex flex-col gap-1.5 max-w-sm">
          <AnimatePresence>
            {killFeed.map((feed) => (
              <motion.div
                key={feed.id}
                initial={{ opacity: 0, x: -20, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                className="bg-slate-950/80 border border-slate-800/80 px-3 py-1.5 rounded-lg text-[10px] font-mono flex items-center gap-2 shadow-md backdrop-blur-sm"
              >
                <span className={`font-bold ${
                  feed.killerTeam === 'Red' ? 'text-red-400' : feed.killerTeam === 'Blue' ? 'text-blue-400' : 'text-emerald-400'
                }`}>
                  {feed.killerName}
                </span>
                
                <span className="text-slate-500 uppercase font-bold px-1.5 py-0.2 bg-slate-900 rounded border border-slate-800">
                  {feed.weapon}
                </span>

                {feed.isHeadshot && (
                  <span className="text-amber-400 font-bold" title="Headshot kill!">
                    🎯 HEADSHOT
                  </span>
                )}

                <span className="text-slate-500">killed</span>

                <span className={`font-bold ${
                  feed.victimTeam === 'Red' ? 'text-red-400' : feed.victimTeam === 'Blue' ? 'text-blue-400' : 'text-slate-300'
                }`}>
                  {feed.victimName}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Right Side: Quick Instructions Tip */}
        <div className="text-right text-[10px] text-slate-500 font-mono hidden md:block">
          <p>HOLD <span className="text-slate-300 px-1 py-0.5 bg-slate-900 border border-slate-800 rounded">TAB</span> KEY FOR COMPETITIVE SCOREBOARD</p>
          <p className="mt-1">PRESS <span className="text-slate-300 px-1 py-0.5 bg-slate-900 border border-slate-800 rounded">MOUSE CLICK</span> TO SHOOT ENEMY/BLOCKS</p>
        </div>
      </div>

      {/* Bottom HUD: Health, Ammo, Energy & Skill dashboard */}
      <div className="flex items-end justify-between">
        
        {/* Vital Health (HP) Indicator with Armor & Consumables */}
        <div className="flex flex-col gap-2">
          {/* Main Health Card */}
          <div className="w-80 bg-slate-950/90 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <Heart className={`w-5 h-5 ${health < 30 ? 'text-red-500 animate-pulse' : 'text-rose-400'}`} />
                <span className="text-[11px] font-mono font-extrabold text-slate-300 uppercase tracking-wider font-bold">VITAL HEALTH</span>
              </div>
              <span className={`text-md font-mono font-extrabold ${health < 30 ? 'text-red-400 animate-pulse' : 'text-slate-100'}`}>
                {health} <span className="text-[10px] text-slate-500 font-normal">HP</span>
              </span>
            </div>
            <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-850 mb-3">
              <div 
                className={`h-full transition-all duration-150 ${
                  health < 30 ? 'bg-gradient-to-r from-red-600 to-rose-500 animate-pulse' : 'bg-gradient-to-r from-rose-500 to-emerald-500'
                }`}
                style={{ width: `${health}%` }}
              />
            </div>

            {/* Helmet & Vest Armor Levels */}
            <div className="grid grid-cols-2 gap-2 border-t border-slate-800/50 pt-2.5 mb-2.5">
              <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-2 flex items-center gap-2 font-mono">
                <span className="text-xs">🪖</span>
                <div className="text-left">
                  <div className="text-[8px] text-slate-500 uppercase leading-none">HELMET</div>
                  <div className="text-[10px] font-bold text-slate-200">LVL {helmetLevel || 0}</div>
                </div>
              </div>
              <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-2 flex items-center gap-2 font-mono">
                <span className="text-xs">🛡️</span>
                <div className="text-left">
                  <div className="text-[8px] text-slate-500 uppercase leading-none">VEST</div>
                  <div className="text-[10px] font-bold text-slate-200">LVL {vestLevel || 0}</div>
                </div>
              </div>
            </div>

            {/* Medkit & Booster Counters (H / J to consume) */}
            <div className="grid grid-cols-2 gap-2 border-t border-slate-800/50 pt-2.5 font-mono">
              <div className="flex items-center justify-between bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800/80 rounded-lg p-2 cursor-pointer transition-all">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-1 rounded font-bold">H</span>
                  <div className="text-left">
                    <div className="text-[8px] text-slate-500 leading-none font-bold">MEDKIT</div>
                    <div className="text-[10px] font-bold text-emerald-400">×{medkits}</div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800/80 rounded-lg p-2 cursor-pointer transition-all">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-1 rounded font-bold">J</span>
                  <div className="text-left">
                    <div className="text-[8px] text-slate-500 leading-none font-bold">BOOSTER</div>
                    <div className="text-[10px] font-bold text-amber-400">×{boosters}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tactical Skills cast controller */}
        <div className="pointer-events-auto bg-slate-950/85 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-md flex flex-col items-center">
          <div className="flex items-center gap-2 mb-2 text-[10px] text-slate-400 font-mono uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Energy recovery grid</span>
          </div>
          
          {/* Energy bar */}
          <div className="w-64 h-2 bg-slate-900 rounded-full overflow-hidden mb-3 border border-slate-850">
            <div 
              className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-all duration-150"
              style={{ width: `${energy}%` }}
            />
          </div>

          {/* Core Skill Trigger Buttons */}
          <div className="flex gap-2">
            {SKILLS.map((skill) => {
              const canCast = energy >= skill.cost;
              return (
                <button
                  key={skill.id}
                  onClick={() => canCast && onTriggerSkill(skill.id as any)}
                  className={`px-3 py-2 rounded-xl text-left transition-all relative group flex flex-col justify-between h-14 w-24 cursor-pointer border ${
                    canCast 
                      ? 'bg-slate-900 border-amber-500/30 hover:border-amber-500 hover:bg-slate-850 text-slate-200' 
                      : 'bg-slate-950 border-slate-850 text-slate-500 cursor-not-allowed'
                  }`}
                  title={`${skill.description} (Cost: ${skill.cost} energy)`}
                >
                  <span className="text-[9px] font-bold uppercase truncate leading-none mb-1">
                    {skill.name.split(' ')[0]}
                  </span>
                  <div className="flex items-center justify-between w-full mt-auto">
                    <span className="text-[9px] font-mono px-1 py-0.2 bg-slate-950 text-slate-400 border border-slate-850 rounded">
                      {skill.id === 'dash' ? 'SHIFT' : skill.id === 'heal' ? 'Q' : 'E'}
                    </span>
                    <span className="text-[10px] font-bold text-amber-400 font-mono">
                      -{skill.cost}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Weapons Ammo & Mag Status */}
        <div className="w-56 bg-slate-950/85 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur-md text-right flex items-center justify-between">
          <div className="text-left">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">CURRENT WEAPON</span>
            <span className="text-xs font-bold text-slate-200 uppercase">{equippedWeapon.name}</span>
          </div>

          <div>
            <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-0.5">AMMO CLIP</div>
            {reloading ? (
              <span className="text-xs font-extrabold text-amber-400 uppercase font-mono tracking-widest animate-pulse">
                RELOADING...
              </span>
            ) : (
              <span className="text-xl font-extrabold text-slate-100 font-mono">
                {ammo} <span className="text-sm font-normal text-slate-500">/ {maxAmmo}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Global Tab Scoreboard Overlay */}
      <AnimatePresence>
        {showScoreboard && (
          <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-40 flex items-center justify-center p-6 pointer-events-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-xl text-white shadow-2xl flex flex-col gap-4"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-widest text-indigo-400 flex items-center gap-1.5">
                    <Sliders className="w-4 h-4" />
                    Lobby Leaderboard standings
                  </h3>
                  <p className="text-[10px] text-slate-400 font-mono">Mode: {mode} • Syncing active players performance</p>
                </div>
                <div className="text-[10px] font-mono text-slate-500 uppercase">
                  ACTIVE LOBBY
                </div>
              </div>

              {/* Grid content */}
              <div className="flex-1 overflow-y-auto max-h-96">
                <div className="grid grid-cols-12 gap-2 text-[10px] font-mono font-bold uppercase text-slate-500 border-b border-slate-850 pb-2 mb-2 px-2">
                  <div className="col-span-1">Status</div>
                  <div className="col-span-5">Soldier Name</div>
                  <div className="col-span-2 text-center">Team</div>
                  <div className="col-span-2 text-center">Kills</div>
                  <div className="col-span-2 text-center">Deaths</div>
                </div>

                <div className="flex flex-col gap-1 px-2">
                  {/* Current Player Row */}
                  <div className="grid grid-cols-12 gap-2 py-2 items-center text-xs font-semibold bg-indigo-950/30 text-indigo-200 border border-indigo-900/40 rounded-lg px-2">
                    <div className="col-span-1 text-emerald-400 flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    </div>
                    <div className="col-span-5 truncate">
                      {peers.size === 0 ? 'You (Self)' : 'You (Operative)'}
                    </div>
                    <div className="col-span-2 text-center">
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                        team === 'Red' ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 
                        team === 'Blue' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20' : 
                        'bg-slate-800 text-slate-400'
                      }`}>
                        {team}
                      </span>
                    </div>
                    <div className="col-span-2 text-center font-mono text-emerald-400">{kills}</div>
                    <div className="col-span-2 text-center font-mono text-red-400">{deaths}</div>
                  </div>

                  {/* Other peers mapping */}
                  {(Array.from(peers.values()) as PeerPlayer[]).map((peer) => (
                    <div 
                      key={peer.id}
                      className="grid grid-cols-12 gap-2 py-2 items-center text-xs text-slate-300 hover:bg-slate-850 rounded px-2"
                    >
                      <div className="col-span-1">
                        <div className="w-2 h-2 rounded-full bg-slate-500" />
                      </div>
                      <div className="col-span-5 truncate flex items-center gap-1.5">
                        <span className="truncate">{peer.name}</span>
                        {peer.isSpeaking && (
                          <Radio className="w-3 h-3 text-green-400 animate-pulse" />
                        )}
                      </div>
                      <div className="col-span-2 text-center">
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                          peer.team === 'Red' ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 
                          peer.team === 'Blue' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20' : 
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {peer.team}
                        </span>
                      </div>
                      <div className="col-span-2 text-center font-mono text-emerald-500">{peer.kills}</div>
                      <div className="col-span-2 text-center font-mono text-red-500">{peer.deaths}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-[10px] font-mono text-slate-500 text-center border-t border-slate-850 pt-3">
                Release TAB key to close scoreboard and resume tactical simulation.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Battle Royale Centered Warn and Loot Prompts --- */}
      {playzone && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center gap-1 bg-slate-950/90 border border-blue-500/30 px-5 py-2.5 rounded-2xl shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <div className={`w-2 h-2 rounded-full ${playzone.state === 'shrinking' ? 'bg-red-500 animate-ping' : 'bg-blue-500'}`} />
            <span className="text-slate-300 tracking-wider font-extrabold uppercase">
              {playzone.state === 'shrinking' ? 'ZONE IS SHRINKING!' : `NEXT SHRINK IN ${playzone.timer}S`}
            </span>
          </div>
          
          <div className="flex items-center gap-3 font-mono mt-1 text-xs">
            <div className="text-slate-400 uppercase leading-none">
              STAGE <span className="text-blue-400 font-black">{playzone.stage}</span>
            </div>
            <div className="w-[1px] h-3 bg-slate-800" />
            <div className="flex items-center gap-1">
              <span className="text-slate-500 uppercase font-semibold">SAFE DISTANCE:</span>
              <span className={`font-black ${distanceToSafeZone > 0 ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`}>
                {distanceToSafeZone > 0 ? `${Math.round(distanceToSafeZone)}M` : 'INSIDE'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Interactable loot prompt */}
      {closestInteractiveLoot && (
        <div className="absolute bottom-48 left-1/2 transform -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center gap-1.5">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: [1, 1.05, 1], opacity: 1 }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className="bg-slate-950/90 border-2 border-emerald-500 px-5 py-2.5 rounded-xl flex items-center gap-3 shadow-2xl backdrop-blur-md"
          >
            <span className="bg-emerald-500 text-slate-950 text-xs font-black px-2 py-1 rounded font-mono">F</span>
            <div className="text-left font-mono">
              <div className="text-[9px] text-slate-400 uppercase leading-none">PRESS TO LOOT</div>
              <div className="text-xs font-bold text-slate-100 uppercase">{closestInteractiveLoot.name}</div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Glider Parachute display overlay */}
      {isGliding && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-sky-950/10 pointer-events-none">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-slate-950/90 border border-sky-500/40 px-6 py-4 rounded-2xl flex flex-col items-center shadow-2xl text-center max-w-sm backdrop-blur-md"
          >
            <span className="text-2xl animate-bounce">🪂</span>
            <h2 className="text-md font-extrabold uppercase tracking-widest text-sky-400 mt-2">PARACHUTE DEPLOYED</h2>
            <p className="text-[10px] text-slate-300 font-mono mt-1 uppercase leading-relaxed">
              Steer with <span className="text-white bg-slate-800 px-1 py-0.5 rounded">W A S D</span> to glide and steer towards high-tier supply drops or defensive cover.
            </p>
          </motion.div>
        </div>
      )}
    </div>
  );
};
