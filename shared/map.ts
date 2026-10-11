import { PROPS, PROP_TYPES } from './props.ts';
import { boxAt, overlaps } from './geometry.ts';
import type { Box, Vec3 } from './types.ts';

export interface StaticProp {
  id: number;
  type: string;
  /** Bottom center. */
  pos: Vec3;
  /** Quarter turns around Y (0 or 1). */
  rot: 0 | 1;
}

export interface GameMap {
  seed: number;
  half: number;
  wallHeight: number;
  /** Walls and shelving: everything that is not a prop. */
  walls: Box[];
  props: StaticProp[];
  /** Same order as `props`. */
  propBoxes: Box[];
  /** walls + propBoxes, used for movement and shots. */
  solids: Box[];
  hunterSpawns: Vec3[];
  propSpawns: Vec3[];
  /** Floor zones where props can extract during the hunt. */
  exits: Box[];
  /** Places loot can appear: open floor and the tops of low props. */
  lootSpots: Vec3[];
}

export function propSize(type: string, rot: 0 | 1 = 0): Vec3 {
  const s = PROPS[type].size;
  return rot ? [s[2], s[1], s[0]] : [s[0], s[1], s[2]];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLEAR_ZONE = 5;

/**
 * A warehouse: outer walls, rows of shelving, a small office in one corner and
 * an open area in the middle where hunters spawn. The same seed always gives the
 * same map, so the server only has to send the seed.
 */
export function generateMap(seed: number): GameMap {
  const rand = mulberry32(seed);
  const half = 20;
  const wallHeight = 6;
  const t = 0.5;
  const walls: Box[] = [
    { min: [-half - t, 0, -half - t], max: [half + t, wallHeight, -half] },
    { min: [-half - t, 0, half], max: [half + t, wallHeight, half + t] },
    { min: [-half - t, 0, -half], max: [-half, wallHeight, half] },
    { min: [half, 0, -half], max: [half + t, wallHeight, half] },
  ];

  // Shelving rows on both sides of the middle aisle.
  for (const x of [-15, -10, 10, 15]) {
    for (const [z0, z1] of [[-17, -7], [7, 17]]) {
      walls.push({ min: [x - 0.6, 0, z0], max: [x + 0.6, 3.2, z1] });
    }
  }
  // Office in the far corner, with a doorway facing the middle.
  const o0 = 11;
  walls.push({ min: [o0, 0, -half], max: [o0 + 0.3, 3, -o0 - 2.5] });
  walls.push({ min: [o0, 0, -o0 + 0.5], max: [half, 3, -o0 + 0.8] });
  // Low dividers along the middle aisle.
  walls.push({ min: [-6, 0, -12], max: [-5.7, 1.2, -8] });
  walls.push({ min: [5.7, 0, 8], max: [6, 1.2, 12] });

  const exits: Box[] = [
    { min: [-half, 0, -half], max: [-half + 3, 0.2, -half + 3] },
    { min: [half - 3, 0, half - 3], max: [half, 0.2, half] },
    { min: [-half, 0, half - 3], max: [-half + 3, 0.2, half] },
  ];
  const keepClear = exits.map((e): Box => ({ min: e.min, max: [e.max[0], 3, e.max[2]] }));

  const props: StaticProp[] = [];
  const propBoxes: Box[] = [];
  const totalWeight = PROP_TYPES.reduce((s, k) => s + PROPS[k].weight, 0);
  const pickType = () => {
    let r = rand() * totalWeight;
    for (const k of PROP_TYPES) {
      r -= PROPS[k].weight;
      if (r <= 0) return k;
    }
    return PROP_TYPES[0];
  };
  const blocked = (b: Box) => {
    const padded: Box = {
      min: [b.min[0] - 0.15, b.min[1], b.min[2] - 0.15],
      max: [b.max[0] + 0.15, b.max[1], b.max[2] + 0.15],
    };
    return [...walls, ...keepClear, ...propBoxes].some((w) => overlaps(padded, w));
  };
  const add = (type: string, pos: Vec3, rot: 0 | 1) => {
    props.push({ id: props.length, type, pos, rot });
    propBoxes.push(boxAt(pos, propSize(type, rot)));
  };

  let attempts = 0;
  while (props.length < 120 && attempts < 4000) {
    attempts++;
    const type = pickType();
    const rot = (rand() < 0.5 ? 0 : 1) as 0 | 1;
    const pos: Vec3 = [(rand() * 2 - 1) * (half - 1), 0, (rand() * 2 - 1) * (half - 1)];
    if (Math.abs(pos[0]) < CLEAR_ZONE && Math.abs(pos[2]) < CLEAR_ZONE) continue;
    const box = boxAt(pos, propSize(type, rot));
    if (blocked(box)) continue;
    add(type, pos, rot);
    // Stack something on top of some crates.
    if (type === 'crate' && rand() < 0.35) {
      const top = rand() < 0.5 ? 'crate' : 'smallBox';
      add(top, [pos[0], box.max[1], pos[2]], (rand() < 0.5 ? 0 : 1) as 0 | 1);
    }
  }

  const solids = [...walls, ...propBoxes];

  const hunterSpawns: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    hunterSpawns.push([Math.cos(a) * 2, 0, Math.sin(a) * 2]);
  }
  const propSpawns: Vec3[] = [];
  attempts = 0;
  while (propSpawns.length < 16 && attempts < 2000) {
    attempts++;
    const pos: Vec3 = [(rand() * 2 - 1) * (half - 2), 0, (rand() * 2 - 1) * (half - 2)];
    if (Math.abs(pos[0]) < CLEAR_ZONE + 3 && Math.abs(pos[2]) < CLEAR_ZONE + 3) continue;
    if (solids.some((s) => overlaps(boxAt(pos, [1.2, 2, 1.2]), s))) continue;
    propSpawns.push(pos);
  }

  const lootSpots: Vec3[] = [];
  for (const b of propBoxes) {
    const top = b.max[1];
    const center: Vec3 = [(b.min[0] + b.max[0]) / 2, top, (b.min[2] + b.max[2]) / 2];
    if (top <= 1.2 && b.max[0] - b.min[0] >= 0.5 && !propBoxes.some((o) => o !== b && overlaps(boxAt(center, [0.3, 0.3, 0.3]), o))) {
      lootSpots.push(center);
    }
  }
  attempts = 0;
  let floorSpots = 0;
  while (floorSpots < 40 && attempts < 3000) {
    attempts++;
    const pos: Vec3 = [(rand() * 2 - 1) * (half - 1), 0, (rand() * 2 - 1) * (half - 1)];
    if (Math.abs(pos[0]) < CLEAR_ZONE && Math.abs(pos[2]) < CLEAR_ZONE) continue;
    if ([...solids, ...keepClear].some((s) => overlaps(boxAt(pos, [0.6, 0.6, 0.6]), s))) continue;
    lootSpots.push(pos);
    floorSpots++;
  }

  return { seed, half, wallHeight, walls, props, propBoxes, solids, hunterSpawns, propSpawns, exits, lootSpots };
}
