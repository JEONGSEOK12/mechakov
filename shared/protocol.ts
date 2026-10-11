import type { Theme } from './props.ts';
import type { Profile } from './upgrades.ts';
import type { InputKeys, Phase, Role, Team, Vec3 } from './types.ts';

export interface PlayerSnap {
  id: number;
  name: string;
  role: Role;
  alive: boolean;
  /** Got out through an exit this round. */
  extracted: boolean;
  hp: number;
  maxHp: number;
  /** Movement speed multiplier from upgrades. */
  speed: number;
  /** 0..1 while standing in an exit zone. */
  extracting: number;
  pos: Vec3;
  vy: number;
  onGround: boolean;
  yaw: number;
  pitch: number;
  /** Body facing; differs from yaw when a prop locks its rotation. */
  face: number;
  prop: string | null;
  /** Last input sequence number the server applied. */
  seq: number;
}

/** Who is in the room, without positions; everyone gets the full list. */
export interface RosterEntry {
  id: number;
  name: string;
  role: Role;
  alive: boolean;
  extracted: boolean;
}

export interface Loot {
  id: number;
  type: string;
  pos: Vec3;
}

/** How a player's raid ended for them. */
export type Outcome = 'extracted' | 'survived' | 'died' | 'mia';

export type ClientMsg =
  | { t: 'join'; name: string; token?: string }
  | { t: 'pickup'; lootId: number }
  | { t: 'upgrade'; id: string }
  | { t: 'addBot' }
  | { t: 'input'; seq: number; keys: InputKeys; yaw: number; pitch: number; face: number }
  | { t: 'shoot'; origin: Vec3; dir: Vec3 }
  | { t: 'disguise'; propId: number };

export type ShotHit = 'player' | 'decoy' | 'world' | 'none';

export type ServerMsg =
  | { t: 'welcome'; id: number; seed: number; theme: Theme; room: string; token: string; profile: Profile }
  | { t: 'map'; seed: number; theme: Theme }
  | { t: 'profile'; profile: Profile }
  | { t: 'loot'; items: Loot[] }
  | { t: 'bag'; items: string[]; capacity: number }
  | { t: 'result'; outcome: Outcome; items: string[] }
  /** `players` holds only the players the receiver is allowed to see. */
  | { t: 'snap'; time: number; phase: Phase; timeLeft: number; players: PlayerSnap[]; roster: RosterEntry[] }
  | { t: 'shot'; from: number; origin: Vec3; end: Vec3; hit: ShotHit; target?: number }
  | { t: 'kill'; killer: number | null; victim: number }
  | { t: 'roundEnd'; winner: Team | null }
  | { t: 'error'; message: string };
