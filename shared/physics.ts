import { CHARGE_SPEED } from './characters.ts';
import {
  GRAVITY, HUNTER_SIZE, HUNTER_SPEED, JUMP_SPEED, KNOCKBACK_AIR_DRAG, KNOCKBACK_GROUND_DRAG, PROP_SPEED, SPRINT_MULT, SPRINT_SECONDS, STAMINA_REFILL_SECONDS,
  STEP_HEIGHT, WINDED_UNTIL,
} from './constants.ts';
import { boxAt, overlaps } from './geometry.ts';
import { propSize } from './map.ts';
import type { Box, InputKeys, Role, Vec3 } from './types.ts';

export interface BodyState {
  /** Bottom center. */
  pos: Vec3;
  vy: number;
  /** Horizontal velocity from knockback (explosions); walking is separate. Fades fast on the ground. */
  vx: number;
  vz: number;
  onGround: boolean;
  /** 0..1, spent by sprinting. */
  stamina: number;
  /** Ran out of stamina and hasn't refilled to WINDED_UNTIL yet. */
  winded: boolean;
  /** Seconds left of a charge skill, flying along (chargeX, chargeZ) instead of walking. */
  charge: number;
  chargeX: number;
  chargeZ: number;
}

export const newBody = (pos: Vec3): BodyState =>
  ({ pos, vy: 0, vx: 0, vz: 0, onGround: false, stamina: 1, winded: false, charge: 0, chargeX: 0, chargeZ: 0 });

export function bodySize(role: Role, prop: string | null): Vec3 {
  if (role === 'prop' && prop) return propSize(prop);
  return HUNTER_SIZE;
}

function firstHit(box: Box, solids: Box[]): Box | null {
  for (const s of solids) if (overlaps(box, s)) return s;
  return null;
}

/** Moves along one axis; returns true if a wall stopped it. */
function moveHorizontal(b: BodyState, size: Vec3, axis: 0 | 2, delta: number, solids: Box[]): boolean {
  if (delta === 0) return false;
  b.pos[axis] += delta;
  let hit = firstHit(boxAt(b.pos, size), solids);
  if (!hit) return false;

  // Walk up low ledges (pallets, tires) when standing on something.
  if (b.onGround) {
    let top = b.pos[1];
    for (const s of solids) if (overlaps(boxAt(b.pos, size), s)) top = Math.max(top, s.max[1]);
    if (top - b.pos[1] <= STEP_HEIGHT) {
      const raised: Vec3 = [b.pos[0], top, b.pos[2]];
      if (!firstHit(boxAt(raised, size), solids)) {
        b.pos[1] = top;
        return false;
      }
    }
  }

  for (let i = 0; hit && i < 4; i++) {
    b.pos[axis] = delta > 0
      ? hit.min[axis] - size[axis] / 2 - 1e-3
      : hit.max[axis] + size[axis] / 2 + 1e-3;
    hit = firstHit(boxAt(b.pos, size), solids);
  }
  return true;
}

function moveVertical(b: BodyState, size: Vec3, delta: number, solids: Box[]) {
  b.onGround = false;
  b.pos[1] += delta;
  if (b.pos[1] <= 0) {
    b.pos[1] = 0;
    b.vy = 0;
    b.onGround = true;
  }
  let hit = firstHit(boxAt(b.pos, size), solids);
  for (let i = 0; hit && i < 4; i++) {
    if (delta <= 0) {
      b.pos[1] = hit.max[1];
      b.onGround = true;
    } else {
      b.pos[1] = hit.min[1] - size[1] - 1e-3;
    }
    b.vy = 0;
    hit = firstHit(boxAt(b.pos, size), solids);
  }
}

/** One fixed simulation step. Shared by the server and the client's prediction. */
export function stepBody(
  b: BodyState,
  role: Role,
  prop: string | null,
  keys: InputKeys,
  yaw: number,
  frozen: boolean,
  dt: number,
  solids: Box[],
  speedMult = 1,
) {
  const size = bodySize(role, prop);
  let mx = 0;
  let mz = 0;
  let sprinting = false;
  const charging = b.charge > 0;
  if (charging) {
    // Flying straight ahead; no steering or jumping until it's over.
    mx = b.chargeX * CHARGE_SPEED * dt;
    mz = b.chargeZ * CHARGE_SPEED * dt;
    b.charge = Math.max(0, b.charge - dt);
  } else if (!frozen) {
    const fwd = (keys.f ? 1 : 0) - (keys.b ? 1 : 0);
    const side = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
    const len = Math.hypot(fwd, side);
    if (len > 0) {
      sprinting = keys.sprint && !b.winded && b.stamina > 0;
      const speed = (role === 'prop' ? PROP_SPEED : HUNTER_SPEED) * (sprinting ? SPRINT_MULT : 1) * speedMult;
      const f = fwd / len;
      const s = side / len;
      mx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed * dt;
      mz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed * dt;
    }
    if (keys.jump && b.onGround) {
      b.vy = JUMP_SPEED;
      b.onGround = false;
    }
  }
  if (sprinting) {
    b.stamina = Math.max(0, b.stamina - dt / SPRINT_SECONDS);
    if (b.stamina === 0) b.winded = true;
  } else {
    b.stamina = Math.min(1, b.stamina + dt / STAMINA_REFILL_SECONDS);
    if (b.stamina >= WINDED_UNTIL) b.winded = false;
  }
  b.vy -= GRAVITY * dt;
  // Knockback carries you through the air and dies off quickly once you land.
  const drag = Math.exp(-(b.onGround ? KNOCKBACK_GROUND_DRAG : KNOCKBACK_AIR_DRAG) * dt);
  b.vx *= drag;
  b.vz *= drag;
  if (Math.abs(b.vx) < 0.05) b.vx = 0;
  if (Math.abs(b.vz) < 0.05) b.vz = 0;
  let blocked = false;
  if (moveHorizontal(b, size, 0, mx + b.vx * dt, solids)) [b.vx, blocked] = [0, true];
  if (moveHorizontal(b, size, 2, mz + b.vz * dt, solids)) [b.vz, blocked] = [0, true];
  // A charge ends against a wall.
  if (charging && blocked) b.charge = 0;
  moveVertical(b, size, b.vy * dt, solids);
}

/** Pushes a body up out of anything it overlaps, e.g. after changing size. */
export function unstick(b: BodyState, size: Vec3, solids: Box[]) {
  for (let i = 0; i < 10; i++) {
    const hit = firstHit(boxAt(b.pos, size), solids);
    if (!hit) return;
    b.pos[1] = hit.max[1];
  }
}
