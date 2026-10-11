import type { Box, Vec3 } from './types.ts';

/** Axis-aligned box for something whose `pos` is its bottom center. */
export function boxAt(pos: Vec3, size: Vec3): Box {
  return {
    min: [pos[0] - size[0] / 2, pos[1], pos[2] - size[2] / 2],
    max: [pos[0] + size[0] / 2, pos[1] + size[1], pos[2] + size[2] / 2],
  };
}

const EPS = 1e-4;

export function overlaps(a: Box, b: Box): boolean {
  return (
    a.min[0] < b.max[0] - EPS && a.max[0] > b.min[0] + EPS &&
    a.min[1] < b.max[1] - EPS && a.max[1] > b.min[1] + EPS &&
    a.min[2] < b.max[2] - EPS && a.max[2] > b.min[2] + EPS
  );
}

/** Distance along a normalized ray to a box, or null if it misses. */
export function rayBox(origin: Vec3, dir: Vec3, box: Box): number | null {
  let tmin = 0;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < box.min[i] || origin[i] > box.max[i]) return null;
      continue;
    }
    const inv = 1 / dir[i];
    let t1 = (box.min[i] - origin[i]) * inv;
    let t2 = (box.max[i] - origin[i]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Distance from a point to the closest point of a box (0 when inside). */
export function pointBoxDistance(p: Vec3, box: Box): number {
  let sq = 0;
  for (let i = 0; i < 3; i++) {
    const v = Math.max(box.min[i] - p[i], 0, p[i] - box.max[i]);
    sq += v * v;
  }
  return Math.sqrt(sq);
}

export function lookDir(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}
