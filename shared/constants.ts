import type { Vec3 } from './types.ts';

export const DEFAULT_PORT = 2567;

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const GRAVITY = 24;
export const JUMP_SPEED = 8;
export const STEP_HEIGHT = 0.4;
export const HUNTER_SPEED = 5.5;
export const PROP_SPEED = 5;
export const SPRINT_MULT = 1.5;

export const HUNTER_SIZE: Vec3 = [0.6, 1.8, 0.6];
export const HUNTER_EYE = 1.6;
export const DEFAULT_PROP = 'smallBox';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

export interface Timings {
  countdown: number;
  hide: number;
  hunt: number;
  end: number;
}

export const DEFAULT_TIMINGS: Timings = {
  countdown: 5,
  hide: 30,
  hunt: 180,
  end: 8,
};

export const MAX_HP = 100;
export const SHOT_DAMAGE = 25;
/** Hunters lose this much HP when they shoot a decoy prop. */
export const MISS_PENALTY = 5;
export const FIRE_COOLDOWN = 0.4;
export const SHOT_RANGE = 60;
export const DISGUISE_RANGE = 4;
