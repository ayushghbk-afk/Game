import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  googleProvider, 
  db 
} from '../firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { dbService } from '../services/dbService';
import { UserStats, WeaponConfig } from '../types';
import { WEAPONS } from '../constants';
import { 
  Sword, 
  User as UserIcon, 
  Trophy, 
  Settings, 
  LogOut, 
  Play, 
  ShieldAlert, 
  Radio, 
  Crosshair, 
  Loader2,
  Lock,
  Compass
} from 'lucide-react';

interface MenuProps {
  onStartMatch: (options: { mode: '1v1' | 'FFA' | 'TDM'; name: string; email?: string; activeWeapon: WeaponConfig }) => void;
}

export const Menu: React.FC<MenuProps> = ({ onStartMatch }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<UserStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  
  // Tab Navigation
  const [activeTab, setActiveTab] = useState<'matchmake' | 'loadout' | 'rankings'>('matchmake');
  
  // Custom Loadout selection
  const [selectedWeaponId, setSelectedWeaponId] = useState<string>('rifle');
  
  // Manual / Iframe login fallback state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authModalLoading, setAuthModalLoading] = useState(false);

  // Matchmaking parameters
  const [selectedMode, setSelectedMode] = useState<'1v1' | 'FFA' | 'TDM'>('FFA');
  const [matchmakingActive, setMatchmakingActive] = useState(false);

  // Track Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      if (currentUser) {
        setUser(currentUser);
        // Fetch stats from Firestore
        const profile = await dbService.getOrCreateUserProfile(
          currentUser.uid, 
          currentUser.displayName || 'Soldier_' + currentUser.uid.slice(0, 4),
          currentUser.email || undefined
        );
        setStats(profile);
        if (profile.favoriteWeapon) {
          const matchedWeapon = WEAPONS.find(w => w.name === profile.favoriteWeapon);
          if (matchedWeapon) setSelectedWeaponId(matchedWeapon.id);
        }
      } else {
        setUser(null);
        setStats(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Fetch leaderboard when ranking tab opens
  useEffect(() => {
    if (activeTab === 'rankings') {
      fetchLeaderboard();
    }
  }, [activeTab]);

  const fetchLeaderboard = async () => {
    setLeaderboardLoading(true);
    const top = await dbService.getTopPlayers(10);
    setLeaderboard(top);
    setLeaderboardLoading(false);
  };

  // Google Login (which might get blocked in an iframe)
  const handleGoogleLogin = async () => {
    try {
      setAuthError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.warn('Google Sign-In Popup blocked or failed. Showing custom account modal fallback:', err);
      // Fallback: Open custom credentials modal
      setAuthError('Google sign-in is restricted in iframe previews. Please create a custom Soldier ID or login with email below!');
      setShowAuthModal(true);
    }
  };

  // Custom Credentials / Nickname Sign-In Handlers
  const handleCustomAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setAuthError('Please fill out all fields.');
      return;
    }
    setAuthModalLoading(true);
    setAuthError(null);

    try {
      if (isRegistering) {
        if (!authUsername) {
          setAuthError('Please specify a soldier nickname.');
          setAuthModalLoading(false);
          return;
        }
        // Register user
        const res = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        await updateProfile(res.user, { displayName: authUsername });
        
        // Immediately trigger profile provisioning in Firestore
        const profile = await dbService.getOrCreateUserProfile(res.user.uid, authUsername, authEmail);
        setStats(profile);
      } else {
        // Login user
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthUsername('');
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setAuthModalLoading(false);
    }
  };

  const handleGuestPlay = () => {
    // Start game directly as a Guest Soldier
    const guestWeapon = WEAPONS.find(w => w.id === selectedWeaponId) || WEAPONS[0];
    onStartMatch({
      mode: selectedMode,
      name: user?.displayName || 'Guest_Soldier_' + Math.floor(Math.random() * 9000 + 1000),
      email: user?.email || undefined,
      activeWeapon: guestWeapon
    });
  };

  const handleSignOut = () => {
    signOut(auth);
  };

  // Update Favorite Weapon in Firestore
  const handleEquipWeapon = async (weapon: WeaponConfig) => {
    setSelectedWeaponId(weapon.id);
    if (user && stats) {
      const updatedStats = { ...stats, favoriteWeapon: weapon.name };
      setStats(updatedStats);
      await dbService.saveUserProfile(user.uid, { favoriteWeapon: weapon.name });
    }
  };

  const currentEquippedWeapon = WEAPONS.find(w => w.id === selectedWeaponId) || WEAPONS[0];

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col justify-between relative overflow-hidden">
      {/* Visual Ambience Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-slate-900/40 via-slate-950 to-slate-950 z-0" />
      
      {/* Grid Pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-35 z-0" />

      {/* Header Panel */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between z-10 relative">
        <div className="flex items-center gap-3">
          <Crosshair className="w-8 h-8 text-emerald-400 animate-spin-slow" />
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-indigo-400">
              FPS Arena
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">
              Tactical Combat Network
            </p>
          </div>
        </div>

        {/* User Account / Login State */}
        <div className="flex items-center gap-4">
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          ) : user && stats ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-xs font-semibold text-slate-200">{stats.displayName}</span>
                  <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-mono font-bold">
                    LVL {stats.level}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2 text-[10px] text-slate-400">
                  <span className="font-mono text-indigo-400">ELO {stats.elo}</span>
                  <span>•</span>
                  <span>K/D {stats.deaths === 0 ? stats.kills : (stats.kills / stats.deaths).toFixed(2)}</span>
                </div>
              </div>
              <button 
                onClick={handleSignOut}
                className="p-2 bg-slate-900 hover:bg-red-950/20 hover:text-red-400 rounded-lg border border-slate-800 transition-colors cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleGoogleLogin}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-xs font-semibold rounded-lg border border-slate-800 transition-colors cursor-pointer flex items-center gap-2 text-slate-300"
              >
                <UserIcon className="w-3.5 h-3.5" />
                Google Sign-In
              </button>
              <button
                onClick={() => {
                  setAuthError(null);
                  setShowAuthModal(true);
                }}
                className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-xs font-semibold rounded-lg border border-indigo-500 text-indigo-300 transition-colors cursor-pointer"
              >
                Soldier Log-In
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Dashboard */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 flex flex-col md:flex-row gap-8 z-10 relative">
        {/* Navigation Sidebar Panel */}
        <div className="w-full md:w-56 flex flex-col gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('matchmake')}
            className={`flex items-center gap-3 py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider text-left transition-all cursor-pointer ${
              activeTab === 'matchmake' 
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-900/20' 
                : 'bg-slate-900/60 hover:bg-slate-900 text-slate-400 hover:text-white border border-slate-800/80'
            }`}
          >
            <Compass className="w-4 h-4" />
            Matchmaking
          </button>

          <button
            onClick={() => setActiveTab('loadout')}
            className={`flex items-center gap-3 py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider text-left transition-all cursor-pointer ${
              activeTab === 'loadout' 
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-900/20' 
                : 'bg-slate-900/60 hover:bg-slate-900 text-slate-400 hover:text-white border border-slate-800/80'
            }`}
          >
            <Sword className="w-4 h-4" />
            Loadout Armoury
          </button>

          <button
            onClick={() => setActiveTab('rankings')}
            className={`flex items-center gap-3 py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider text-left transition-all cursor-pointer ${
              activeTab === 'rankings' 
                ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg shadow-amber-900/20' 
                : 'bg-slate-900/60 hover:bg-slate-900 text-slate-400 hover:text-white border border-slate-800/80'
            }`}
          >
            <Trophy className="w-4 h-4" />
            Arena Rankings
          </button>

          {/* Quick Account Save Banner */}
          {!user && (
            <div className="mt-6 bg-indigo-950/20 border border-indigo-500/20 p-4 rounded-xl text-center">
              <ShieldAlert className="w-5 h-5 text-indigo-400 mx-auto mb-2" />
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-indigo-200">Progress Unsaved</h4>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                Log in to save stats, secure your ELO rating, level up, and lock in your loadout!
              </p>
            </div>
          )}
        </div>

        {/* Tab View Container */}
        <div className="flex-1 min-h-[420px] bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col justify-between backdrop-blur-sm">
          <AnimatePresence mode="wait">
            {/* Matchmaking Tab */}
            {activeTab === 'matchmake' && (
              <motion.div 
                key="matchmake"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex-1 flex flex-col justify-between"
              >
                <div>
                  <h2 className="text-lg font-bold uppercase tracking-wider mb-1 flex items-center gap-2 text-slate-200">
                    Deploy Operation
                  </h2>
                  <p className="text-xs text-slate-400 mb-6">
                    Select your simulated match conditions and search for combat rooms.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    {/* Free For All */}
                    <button
                      onClick={() => setSelectedMode('FFA')}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        selectedMode === 'FFA'
                          ? 'bg-emerald-500/10 border-emerald-500 shadow-md shadow-emerald-950/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <h3 className="font-bold text-xs uppercase tracking-wide mb-1 text-slate-100">
                        Free-For-All
                      </h3>
                      <p className="text-[10px] text-slate-400 leading-normal mb-3">
                        Solo operative. 10-player sandbox where everyone is a target. Perfect for fast practice.
                      </p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-900 font-mono">
                        POPULAR
                      </span>
                    </button>

                    {/* Team Deathmatch */}
                    <button
                      onClick={() => setSelectedMode('TDM')}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        selectedMode === 'TDM'
                          ? 'bg-indigo-500/10 border-indigo-500 shadow-md shadow-indigo-950/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <h3 className="font-bold text-xs uppercase tracking-wide mb-1 text-slate-100">
                        Team Deathmatch
                      </h3>
                      <p className="text-[10px] text-slate-400 leading-normal mb-3">
                        Red vs Blue squad combat. Coordinated tactical voice strategies rule the arena.
                      </p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-900 font-mono">
                        TACTICAL
                      </span>
                    </button>

                    {/* 1v1 Arena */}
                    <button
                      onClick={() => setSelectedMode('1v1')}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        selectedMode === '1v1'
                          ? 'bg-purple-500/10 border-purple-500 shadow-md shadow-purple-950/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <h3 className="font-bold text-xs uppercase tracking-wide mb-1 text-slate-100">
                        1v1 Duel Arena
                      </h3>
                      <p className="text-[10px] text-slate-400 leading-normal mb-3">
                        High-stakes competitive duel. Pure mechanical shooter skill-ranking ELO focus.
                      </p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-900 font-mono">
                        RANKED 1v1
                      </span>
                    </button>
                  </div>

                  {/* Active Equipped loadout summary */}
                  <div className="bg-slate-950/40 border border-slate-800/80 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">Equipped Loadout Weapon</span>
                      <h4 className="text-xs font-bold text-slate-200 mt-0.5">{currentEquippedWeapon.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">{currentEquippedWeapon.type} • {currentEquippedWeapon.damage} Dmg</p>
                    </div>
                    <button 
                      onClick={() => setActiveTab('loadout')}
                      className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Modify Loadout →
                    </button>
                  </div>
                </div>

                <div className="mt-8 pt-4 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="text-left">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping" />
                      <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                        Main Server Status: Connected
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Voxel physics and Dynamic weather synchronized.
                    </p>
                  </div>

                  <button
                    onClick={handleGuestPlay}
                    className="w-full md:w-auto px-8 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4 fill-slate-950" />
                    Launch Simulation
                  </button>
                </div>
              </motion.div>
            )}

            {/* Loadout Armory Tab */}
            {activeTab === 'loadout' && (
              <motion.div 
                key="loadout"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex-1 flex flex-col"
              >
                <h2 className="text-lg font-bold uppercase tracking-wider mb-1 flex items-center gap-2 text-slate-200">
                  Armoury Weapon Customization
                </h2>
                <p className="text-xs text-slate-400 mb-6">
                  Pick your primary instrument of combat. Favorite weapon locks for subsequent matchmaking matches.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {WEAPONS.map((weapon) => {
                    const isEquipped = selectedWeaponId === weapon.id;
                    return (
                      <div 
                        key={weapon.id}
                        className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${
                          isEquipped 
                            ? 'bg-indigo-500/5 border-indigo-500 shadow-md shadow-indigo-950/15'
                            : 'bg-slate-950/40 border-slate-800'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold text-xs uppercase tracking-wide text-slate-200">
                              {weapon.name}
                            </h3>
                            <span 
                              className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md"
                              style={{ backgroundColor: `${weapon.color}15`, color: weapon.color, border: `1px solid ${weapon.color}25` }}
                            >
                              {weapon.type}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 leading-normal mb-4">
                            {weapon.description}
                          </p>
                        </div>

                        <div>
                          {/* Stats Grid */}
                          <div className="grid grid-cols-3 gap-2 mb-4 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 text-center font-mono">
                            <div>
                              <div className="text-[9px] text-slate-500 uppercase">Damage</div>
                              <div className="text-xs font-bold text-slate-300">{weapon.damage}</div>
                            </div>
                            <div>
                              <div className="text-[9px] text-slate-500 uppercase">Ammo Size</div>
                              <div className="text-xs font-bold text-slate-300">{weapon.ammoMax}</div>
                            </div>
                            <div>
                              <div className="text-[9px] text-slate-500 uppercase">Rate of Fire</div>
                              <div className="text-xs font-bold text-slate-300">{weapon.fireRate} <span className="text-[9px] text-slate-500">rpm</span></div>
                            </div>
                          </div>

                          <button
                            onClick={() => handleEquipWeapon(weapon)}
                            className={`w-full py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                              isEquipped 
                                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30' 
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
                            }`}
                          >
                            {isEquipped ? 'Equipped' : 'Lock as Primary'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Rankings Leaderboard Tab */}
            {activeTab === 'rankings' && (
              <motion.div 
                key="rankings"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex-1 flex flex-col"
              >
                <h2 className="text-lg font-bold uppercase tracking-wider mb-1 flex items-center gap-2 text-slate-200">
                  Arena Competitive Standings
                </h2>
                <p className="text-xs text-slate-400 mb-6">
                  Global combat network rankings. Secure kills and win matches in 1v1 and TDM to climb the ratings.
                </p>

                {leaderboardLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mb-2" />
                    <span className="text-xs text-slate-400 font-mono">Syncing global standings...</span>
                  </div>
                ) : (
                  <div className="bg-slate-950/50 rounded-xl border border-slate-800 overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 bg-slate-900 px-4 py-2.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider font-mono border-b border-slate-800">
                      <div className="col-span-1">Rank</div>
                      <div className="col-span-4">Soldier ID</div>
                      <div className="col-span-2 text-center">Wins</div>
                      <div className="col-span-2 text-center">Kills/Deaths</div>
                      <div className="col-span-3 text-right">ELO Rating</div>
                    </div>

                    <div className="divide-y divide-slate-850">
                      {leaderboard.map((row, index) => {
                        const isCurrentUser = user && user.uid === row.uid;
                        const kdVal = row.deaths === 0 ? row.kills : (row.kills / row.deaths).toFixed(1);
                        return (
                          <div 
                            key={row.uid || index}
                            className={`grid grid-cols-12 gap-2 px-4 py-3.5 items-center text-xs transition-colors ${
                              isCurrentUser ? 'bg-indigo-950/30 text-indigo-200' : 'hover:bg-slate-900/40 text-slate-300'
                            }`}
                          >
                            <div className="col-span-1 font-mono font-bold text-slate-500">
                              #{index + 1}
                            </div>
                            <div className="col-span-4 font-semibold flex items-center gap-1.5 truncate">
                              <span className="truncate">{row.displayName}</span>
                              {row.level && (
                                <span className="text-[8px] px-1 bg-slate-800 text-slate-400 rounded">
                                  L{row.level}
                                </span>
                              )}
                            </div>
                            <div className="col-span-2 text-center font-mono">
                              {row.wins}
                            </div>
                            <div className="col-span-2 text-center font-mono text-slate-400">
                              {row.kills} / {row.deaths} <span className="text-[9px] text-slate-500">({kdVal})</span>
                            </div>
                            <div className="col-span-3 text-right font-mono font-bold text-amber-400">
                              {row.elo}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer System Lines */}
      <footer className="border-t border-slate-900 px-6 py-4 flex flex-col md:flex-row items-center justify-between text-[10px] font-mono text-slate-500 z-10 relative">
        <span>SECURITY LEVEL: ENCRYPTED SUITE</span>
        <span>LATENCY OPTIMIZED • CENTRAL SERVER REGION</span>
        <span>FPS MULTIPLAYER V1.2.4</span>
      </footer>

      {/* Soldier Auth Modal Fallback */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-6 text-white shadow-2xl relative"
            >
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-200 mb-1">
                {isRegistering ? 'Register New Soldier' : 'Soldier Terminal Login'}
              </h3>
              <p className="text-[11px] text-slate-400 mb-4 leading-normal">
                Establish custom identity coordinates to save rankings and armory stats.
              </p>

              {authError && (
                <div className="p-2.5 bg-red-950/35 border border-red-500/20 text-red-300 text-[10px] rounded-lg mb-4 leading-normal">
                  {authError}
                </div>
              )}

              <form onSubmit={handleCustomAuth} className="flex flex-col gap-3">
                {isRegistering && (
                  <div>
                    <label className="text-[10px] text-slate-400 font-mono uppercase">Soldier Nickname</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. GhostOperator"
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium focus:border-indigo-500 outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="text-[10px] text-slate-400 font-mono uppercase">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="soldier@network.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 font-mono uppercase">Secure Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium focus:border-indigo-500 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authModalLoading}
                  className="w-full mt-3 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {authModalLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isRegistering ? (
                    'Register Identity'
                  ) : (
                    'Establish Connection'
                  )}
                </button>
              </form>

              <div className="mt-4 text-center border-t border-slate-800 pt-3 flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  onClick={() => setIsRegistering(!isRegistering)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  {isRegistering ? 'Have an account? Log In' : 'Need an identity? Register'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowAuthModal(false)}
                  className="text-red-400 hover:text-red-300 transition-colors font-bold"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
