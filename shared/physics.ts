import {
  GRAVITY, HUNTER_SIZE, HUNTER_SPEED, JUMP_SPEED, PROP_SPEED, SPRINT_MULT, STEP_HEIGHT,
} from './constants.ts';
import { boxAt, overlaps } from './geometry.ts';
import { propSize } from './map.ts';
import type { Box, InputKeys, Role, Vec3 } from './types.ts';

export interface BodyState {
  /** Bottom center. */
  pos: Vec3;
  vy: number;
  onGround: boolean;
}

export function bodySize(role: Role, prop: string | null): Vec3 {
  if (role === 'prop' && prop) return propSize(prop);
  return HUNTER_SIZE;
}

function firstHit(box: Box, solids: Box[]): Box | null {
  for (const s of solids) if (overlaps(box, s)) return s;
  return null;
}

function moveHorizontal(b: BodyState, size: Vec3, axis: 0 | 2, delta: number, solids: Box[]) {
  if (delta === 0) return;
  b.pos[axis] += delta;
  let hit = firstHit(boxAt(b.pos, size), solids);
  if (!hit) return;

  // Walk up low ledges (pallets, tires) when standing on something.
  if (b.onGround) {
    let top = b.pos[1];
    for (const s of solids) if (overlaps(boxAt(b.pos, size), s)) top = Math.max(top, s.max[1]);
    if (top - b.pos[1] <= STEP_HEIGHT) {
      const raised: Vec3 = [b.pos[0], top, b.pos[2]];
      if (!firstHit(boxAt(raised, size), solids)) {
        b.pos[1] = top;
        return;
      }
    }
  }

  for (let i = 0; hit && i < 4; i++) {
    b.pos[axis] = delta > 0
      ? hit.min[axis] - size[axis] / 2 - 1e-3
      : hit.max[axis] + size[axis] / 2 + 1e-3;
    hit = firstHit(boxAt(b.pos, size), solids);
  }
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
) {
  const size = bodySize(role, prop);
  let mx = 0;
  let mz = 0;
  if (!frozen) {
    const fwd = (keys.f ? 1 : 0) - (keys.b ? 1 : 0);
    const side = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
    const len = Math.hypot(fwd, side);
    if (len > 0) {
      const speed = (role === 'prop' ? PROP_SPEED : HUNTER_SPEED) * (keys.sprint ? SPRINT_MULT : 1);
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
  b.vy -= GRAVITY * dt;
  moveHorizontal(b, size, 0, mx, solids);
  moveHorizontal(b, size, 2, mz, solids);
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
