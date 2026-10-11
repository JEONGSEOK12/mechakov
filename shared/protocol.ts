import type { InputKeys, Phase, Role, Team, Vec3 } from './types.ts';

export interface PlayerSnap {
  id: number;
  name: string;
  role: Role;
  alive: boolean;
  hp: number;
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

export type ClientMsg =
  | { t: 'join'; name: string }
  | { t: 'input'; seq: number; keys: InputKeys; yaw: number; pitch: number; face: number }
  | { t: 'shoot'; origin: Vec3; dir: Vec3 }
  | { t: 'disguise'; propId: number };

export type ShotHit = 'player' | 'decoy' | 'world' | 'none';

export type ServerMsg =
  | { t: 'welcome'; id: number; seed: number; room: string }
  | { t: 'snap'; time: number; phase: Phase; timeLeft: number; players: PlayerSnap[] }
  | { t: 'shot'; from: number; origin: Vec3; end: Vec3; hit: ShotHit; target?: number }
  | { t: 'kill'; killer: number | null; victim: number }
  | { t: 'roundEnd'; winner: Team | null }
  | { t: 'error'; message: string };
