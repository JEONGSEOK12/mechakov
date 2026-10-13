import type { Vec3 } from './types.ts';

export const DEFAULT_PORT = 2567;

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const GRAVITY = 20;
export const JUMP_SPEED = 8;
export const STEP_HEIGHT = 0.4;
export const HUNTER_SPEED = 4;
export const PROP_SPEED = 3.6;
export const SPRINT_MULT = 1.6;
/** Full stamina lasts this many seconds of sprinting... */
export const SPRINT_SECONDS = 6;
/** ...and refills from empty in this many seconds of not sprinting. */
export const STAMINA_REFILL_SECONDS = 9;
/** Once out of breath, sprinting comes back only after refilling to this much. */
export const WINDED_UNTIL = 0.35;

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
  /** Seconds a prop has to stay in an exit zone to get out. */
  extract: number;
}

export const DEFAULT_TIMINGS: Timings = {
  countdown: 5,
  hide: 40,
  hunt: 300,
  end: 8,
  extract: 5,
};

export const SHOT_DAMAGE = 25;
export const FIRE_COOLDOWN = 0.4;
export const SHOT_RANGE = 60;
export const DISGUISE_RANGE = 4;

/**
 * Props' explosive projectiles (rockets and grenades): slow enough to dodge,
 * weak, but they throw people around. Speed, damage, cooldown and knockback
 * come from the character's weapon (`CHARACTERS`).
 */
export const ROCKET_LIFETIME = 4;
export const ROCKET_RADIUS = 2.4;
/** A short wind-up between clicking and the rocket leaving, in seconds. */
export const ROCKET_DELAY = 0.15;
/** How far outside a player's body a rocket or grenade still counts as a direct hit (m). */
export const PROJECTILE_HIT_PAD = 0.4;
/** How far past someone's body a leap still catches them; the hit is weaker the farther off. */
export const LEAP_HIT_PAD = 0.6;
/** The share of a leap's damage and push left for a hit at the very edge of its reach. */
export const LEAP_GLANCE = 0.6;
/** Rockets leave this far to the right of the crosshair line, like a launcher on the shoulder (m). */
export const ROCKET_SIDE = 0.35;
/** Grenades fall at this many m/s², keep this much speed when they bounce, and go off after `GRENADE_FUSE` seconds. */
export const GRENADE_GRAVITY = 14;
export const GRENADE_BOUNCE = 0.45;
export const GRENADE_FUSE = 2.2;
/** Per-second fade of knockback speed. */
export const KNOCKBACK_GROUND_DRAG = 9;
export const KNOCKBACK_AIR_DRAG = 0.4;

export const MAX_BOTS = 6;
export const PICKUP_RANGE = 2;
