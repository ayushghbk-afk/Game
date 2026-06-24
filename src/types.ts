// Client & Server state definitions

export interface PlayerState {
  id: string;
  name: string;
  email?: string;
  team: 'Red' | 'Blue' | 'FFA';
  x: number;
  y: number;
  z: number;
  ry: number;
  rx: number;
  health: number;
  kills: number;
  deaths: number;
  score: number;
  weapon: string;
  energy: number;
  isSpeaking: boolean;
}

export interface PeerPlayer {
  id: string;
  name: string;
  team: 'Red' | 'Blue' | 'FFA';
  x: number;
  y: number;
  z: number;
  ry: number;
  rx: number;
  health: number;
  weapon: string;
  energy: number;
  isSpeaking: boolean;
  kills: number;
  deaths: number;
  score: number;
  isWalking: boolean;
  isShooting: boolean;
  lastUpdate: number;
}

export interface WeaponConfig {
  id: string;
  name: string;
  type: 'Rifle' | 'Sniper' | 'Shotgun' | 'Pistol';
  damage: number;
  fireRate: number; // shots per minute
  ammoMax: number;
  reloadTime: number; // milliseconds
  recoil: number;
  energyCost: number; // cost if used as active skill/charged shot
  description: string;
  color: string;
}

export interface UserStats {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  kills: number;
  deaths: number;
  wins: number;
  matchesPlayed: number;
  elo: number; // ranking rating
  level: number;
  exp: number;
  unlockedWeapons: string[];
  favoriteWeapon: string;
}

export interface KillFeedItem {
  id: string;
  killerName: string;
  killerTeam?: string;
  victimName: string;
  victimTeam?: string;
  weapon: string;
  isHeadshot: boolean;
}

export interface VoiceMessage {
  id: string;
  name: string;
  team: string;
  isSpeaking: boolean;
  textMacro?: string;
  timestamp: number;
}
export type WeatherType = 'clear' | 'rain' | 'snow' | 'sandstorm';

export interface PlayzoneState {
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

export interface AirdropState {
  id: string;
  x: number;
  y: number;
  z: number;
  looted: boolean;
  item: string;
}

export interface LootBoxState {
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

