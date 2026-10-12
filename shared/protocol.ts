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
  vx: number;
  vz: number;
  onGround: boolean;
  stamina: number;
  winded: boolean;
  charge: number;
  chargeX: number;
  chargeZ: number;
  /** Vanished by standing still (only ever sent to the player themselves). */
  invisible: boolean;
  yaw: number;
  pitch: number;
  /** Body facing; differs from yaw when a prop locks its rotation. */
  face: number;
  prop: string | null;
  /** A practice-range target dummy. */
  dummy?: boolean;
  /** See `CHARACTERS`. */
  character: string;
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
  /** Drops the bag item at `index` on the floor. */
  | { t: 'drop'; index: number }
  | { t: 'upgrade'; id: string }
  /** Picks a character; only between raids. */
  | { t: 'character'; id: string }
  | { t: 'addBot' }
  | { t: 'start' }
  | { t: 'input'; seq: number; keys: InputKeys; yaw: number; pitch: number; face: number }
  | { t: 'shoot'; origin: Vec3; dir: Vec3 }
  /** Props with a rocket or grenade weapon: fire it along the camera ray. */
  | { t: 'rocket'; origin: Vec3; dir: Vec3 }
  /** The character's right-click skill, e.g. a leap toward `yaw`; `power` 0..1 is how long it was held. */
  | { t: 'skill'; yaw: number; power: number }
  /** The `decoy` disguise: leave a copy of yourself here. */
  | { t: 'decoy' }
  /** Solo, between raids: go to the practice range (true) or back to the hideout. */
  | { t: 'practice'; on: boolean }
  | { t: 'disguise'; propId: number };

export interface RocketSnap {
  id: number;
  kind: 'rocket' | 'grenade';
  pos: Vec3;
  vel: Vec3;
}

export type ShotHit = 'player' | 'decoy' | 'world' | 'none';

export type ServerMsg =
  | { t: 'welcome'; id: number; seed: number; theme: Theme; room: string; token: string; profile: Profile; manualStart: boolean }
  | { t: 'map'; seed: number; theme: Theme }
  | { t: 'profile'; profile: Profile }
  | { t: 'loot'; items: Loot[] }
  | { t: 'bag'; items: string[]; capacity: number }
  | { t: 'result'; outcome: Outcome; items: string[] }
  /** `players` holds only the players the receiver is allowed to see. */
  | { t: 'snap'; time: number; phase: Phase; timeLeft: number; players: PlayerSnap[]; roster: RosterEntry[]; rockets: RocketSnap[] }
  | { t: 'shot'; from: number; origin: Vec3; end: Vec3; hit: ShotHit; target?: number }
  /** A rocket went off: `hit` lists who it pushed or hurt. */
  | { t: 'boom'; from: number; pos: Vec3; hit: number[] }
  /** To the attacker: how much a hit did, for damage numbers. `killed` when it finished off a target dummy. */
  | { t: 'dmg'; target: number; amount: number; pos: Vec3; killed: boolean }
  /** A decoy was hit and popped. */
  | { t: 'poof'; pos: Vec3 }
  /** A leap skill ran into someone. */
  | { t: 'bash'; from: number; victim: number; pos: Vec3 }
  | { t: 'kill'; killer: number | null; victim: number }
  | { t: 'roundEnd'; winner: Team | null }
  | { t: 'error'; message: string };
