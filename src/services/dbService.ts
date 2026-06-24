import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { UserStats } from '../types';

// Default values for newly registered soldiers
const createDefaultStats = (uid: string, name: string, email?: string): UserStats => ({
  uid,
  displayName: name,
  email,
  kills: 0,
  deaths: 0,
  wins: 0,
  matchesPlayed: 0,
  elo: 1000, // standard Chess/competitive starting ELO
  level: 1,
  exp: 0,
  unlockedWeapons: ['rifle', 'pistol'],
  favoriteWeapon: 'M4-Sentinel Rifle'
});

export const dbService = {
  // Retrieve profile or initialize it if first time
  async getOrCreateUserProfile(uid: string, displayName: string, email?: string): Promise<UserStats> {
    try {
      const userRef = doc(db, 'users', uid);
      const docSnap = await getDoc(userRef);

      if (docSnap.exists()) {
        const data = docSnap.data() as UserStats;
        // Merge in case schema changes
        return {
          ...createDefaultStats(uid, displayName, email),
          ...data
        };
      } else {
        const defaultProfile = createDefaultStats(uid, displayName, email);
        await setDoc(userRef, defaultProfile);
        return defaultProfile;
      }
    } catch (error) {
      console.warn('Firestore not reachable or permissions omitted, returning simulated local storage state:', error);
      // Fallback local storage state
      const localStr = localStorage.getItem(`fps_profile_${uid}`);
      if (localStr) {
        return JSON.parse(localStr);
      }
      const defaultProfile = createDefaultStats(uid, displayName, email);
      localStorage.setItem(`fps_profile_${uid}`, JSON.stringify(defaultProfile));
      return defaultProfile;
    }
  },

  // Save changes
  async saveUserProfile(uid: string, stats: Partial<UserStats>): Promise<void> {
    try {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, stats, { merge: true });
    } catch (err) {
      console.warn('Could not save user profile to Firestore:', err);
      // Fallback local storage saving
      const localStr = localStorage.getItem(`fps_profile_${uid}`);
      const current = localStr ? JSON.parse(localStr) : createDefaultStats(uid, 'Guest Soldier');
      const updated = { ...current, ...stats };
      localStorage.setItem(`fps_profile_${uid}`, JSON.stringify(updated));
    }
  },

  // Update post-match stats
  async recordMatchResult(uid: string, matchKills: number, matchDeaths: number, isWin: boolean): Promise<UserStats> {
    try {
      const userRef = doc(db, 'users', uid);
      const docSnap = await getDoc(userRef);
      let currentStats: UserStats;

      if (docSnap.exists()) {
        currentStats = docSnap.data() as UserStats;
      } else {
        currentStats = createDefaultStats(uid, 'Soldier');
      }

      // Calculate new ELO based on win/loss and match KD ratio
      const kdRatio = matchDeaths === 0 ? matchKills : matchKills / matchDeaths;
      const eloModifier = (isWin ? 25 : -15) + Math.min(15, Math.max(-10, Math.floor((kdRatio - 1) * 10)));
      const newElo = Math.max(100, currentStats.elo + eloModifier);

      // Level and experience calculations
      const gainedExp = (matchKills * 50) + (isWin ? 200 : 75);
      let newExp = currentStats.exp + gainedExp;
      let newLevel = currentStats.level;
      const expNeeded = newLevel * 1000;
      
      if (newExp >= expNeeded) {
        newExp -= expNeeded;
        newLevel++;
      }

      const updated: Partial<UserStats> = {
        kills: currentStats.kills + matchKills,
        deaths: currentStats.deaths + matchDeaths,
        wins: currentStats.wins + (isWin ? 1 : 0),
        matchesPlayed: currentStats.matchesPlayed + 1,
        elo: newElo,
        level: newLevel,
        exp: newExp
      };

      await setDoc(userRef, updated, { merge: true });
      const finalResult = { ...currentStats, ...updated };
      
      // Update local storage backup
      localStorage.setItem(`fps_profile_${uid}`, JSON.stringify(finalResult));
      return finalResult;
    } catch (err) {
      console.warn('Could not record match to Firestore, tracking locally:', err);
      const localStr = localStorage.getItem(`fps_profile_${uid}`);
      const current = localStr ? JSON.parse(localStr) : createDefaultStats(uid, 'Guest Soldier');
      
      const kdRatio = matchDeaths === 0 ? matchKills : matchKills / matchDeaths;
      const eloModifier = (isWin ? 25 : -15) + Math.min(15, Math.max(-10, Math.floor((kdRatio - 1) * 10)));
      const newElo = Math.max(100, current.elo + eloModifier);
      const gainedExp = (matchKills * 50) + (isWin ? 200 : 75);
      let newExp = current.exp + gainedExp;
      let newLevel = current.level;
      if (newExp >= newLevel * 1000) {
        newExp -= newLevel * 1000;
        newLevel++;
      }

      const updated: UserStats = {
        ...current,
        kills: current.kills + matchKills,
        deaths: current.deaths + matchDeaths,
        wins: current.wins + (isWin ? 1 : 0),
        matchesPlayed: current.matchesPlayed + 1,
        elo: newElo,
        level: newLevel,
        exp: newExp
      };
      
      localStorage.setItem(`fps_profile_${uid}`, JSON.stringify(updated));
      return updated;
    }
  },

  // Fetch top players list for leaderboard
  async getTopPlayers(limitCount: number = 10): Promise<UserStats[]> {
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, orderBy('elo', 'desc'), limit(limitCount));
      const querySnapshot = await getDocs(q);
      
      const playersList: UserStats[] = [];
      querySnapshot.forEach((docSnap) => {
        playersList.push(docSnap.data() as UserStats);
      });

      if (playersList.length === 0) {
        return getMockLeaderboard();
      }
      return playersList;
    } catch (err) {
      console.warn('Could not fetch leaderboard from Firestore, using mock high scores:', err);
      return getMockLeaderboard();
    }
  }
};

// Elegant mock leaderboard if Firestore is completely empty or restricted
function getMockLeaderboard(): UserStats[] {
  return [
    {
      uid: 'mock1',
      displayName: 'ViperX_Sniper',
      kills: 1420,
      deaths: 720,
      wins: 112,
      matchesPlayed: 180,
      elo: 1650,
      level: 24,
      exp: 420,
      unlockedWeapons: [],
      favoriteWeapon: 'Apex-Valkyrie Railgun'
    },
    {
      uid: 'mock2',
      displayName: 'Spectre_M4',
      kills: 980,
      deaths: 530,
      wins: 76,
      matchesPlayed: 120,
      elo: 1420,
      level: 18,
      exp: 200,
      unlockedWeapons: [],
      favoriteWeapon: 'M4-Sentinel Rifle'
    },
    {
      uid: 'mock3',
      displayName: 'QuantumGamer',
      kills: 750,
      deaths: 480,
      wins: 58,
      matchesPlayed: 100,
      elo: 1310,
      level: 14,
      exp: 950,
      unlockedWeapons: [],
      favoriteWeapon: 'Quantum Blaster'
    },
    {
      uid: 'mock4',
      displayName: 'HavocReaper',
      kills: 820,
      deaths: 610,
      wins: 50,
      matchesPlayed: 115,
      elo: 1240,
      level: 15,
      exp: 110,
      unlockedWeapons: [],
      favoriteWeapon: 'Havoc-Scatter Cannon'
    },
    {
      uid: 'mock5',
      displayName: 'Rookie_101',
      kills: 120,
      deaths: 150,
      wins: 8,
      matchesPlayed: 25,
      elo: 980,
      level: 4,
      exp: 550,
      unlockedWeapons: [],
      favoriteWeapon: 'M4-Sentinel Rifle'
    }
  ];
}
