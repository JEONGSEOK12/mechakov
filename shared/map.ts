import { PROPS, PROP_TYPES, type Theme } from './props.ts';
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
  theme: Theme;
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

export const THEMES: Theme[] = ['warehouse', 'office', 'yard'];
export const THEME_NAMES: Record<Theme, string> = { warehouse: '창고', office: '사무실', yard: '야적장' };

const HALF = 20;

/** Interior walls for each theme. They must leave the middle and the exit corners open. */
function interiorWalls(theme: Theme, rand: () => number, exits: Box[]): Box[] {
  const walls: Box[] = [];
  if (theme === 'warehouse') {
    // Shelving rows on both sides of the middle aisle.
    for (const x of [-15, -10, 10, 15]) {
      for (const [z0, z1] of [[-17, -7], [7, 17]]) walls.push({ min: [x - 0.6, 0, z0], max: [x + 0.6, 3.2, z1] });
    }
    // A small office in the far corner, with a doorway facing the middle.
    walls.push({ min: [11, 0, -HALF], max: [11.3, 3, -13.5] });
    walls.push({ min: [11, 0, -10.5], max: [HALF, 3, -10.2] });
    // Low dividers along the middle aisle.
    walls.push({ min: [-6, 0, -12], max: [-5.7, 1.2, -8] });
    walls.push({ min: [5.7, 0, 8], max: [6, 1.2, 12] });
  } else if (theme === 'office') {
    // Four corner rooms around a cross-shaped hall, each with two doorways.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * 8;
        const z = sz * 8;
        const span = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)];
        // Wall along x = ±8 with a door around z = ±14.
        for (const [z0, z1] of [span(z, sz * 13), span(sz * 15, sz * HALF)]) {
          walls.push({ min: [x - 0.15, 0, z0], max: [x + 0.15, 3, z1] });
        }
        // Wall along z = ±8 with a door around x = ±14.
        for (const [x0, x1] of [span(x, sx * 13), span(sx * 15, sx * HALF)]) {
          walls.push({ min: [x0, 0, z - 0.15], max: [x1, 3, z + 0.15] });
        }
      }
    }
    // Cubicle partitions in the arms of the hall.
    for (const s of [-1, 1]) {
      for (const off of [-4, 4]) {
        walls.push({ min: [off - 0.1, 0, Math.min(s * 10, s * 18)], max: [off + 0.1, 1.4, Math.max(s * 10, s * 18)] });
        walls.push({ min: [Math.min(s * 10, s * 18), 0, off - 0.1], max: [Math.max(s * 10, s * 18), 1.4, off + 0.1] });
      }
    }
  } else {
    // Shipping containers dropped around the yard.
    const keepClear = exits.map((e): Box => ({ min: [e.min[0] - 1, 0, e.min[2] - 1], max: [e.max[0] + 1, 3, e.max[2] + 1] }));
    let attempts = 0;
    while (walls.length < 9 && attempts < 500) {
      attempts++;
      const rot = rand() < 0.5;
      const [w, d] = rot ? [6, 2.4] : [2.4, 6];
      const x = (rand() * 2 - 1) * (HALF - 4);
      const z = (rand() * 2 - 1) * (HALF - 4);
      const box: Box = { min: [x - w / 2, 0, z - d / 2], max: [x + w / 2, 2.6, z + d / 2] };
      const padded: Box = { min: [box.min[0] - 1.5, 0, box.min[2] - 1.5], max: [box.max[0] + 1.5, 3, box.max[2] + 1.5] };
      const middle: Box = { min: [-CLEAR_ZONE - 1, 0, -CLEAR_ZONE - 1], max: [CLEAR_ZONE + 1, 3, CLEAR_ZONE + 1] };
      if ([middle, ...keepClear, ...walls].some((o) => overlaps(padded, o))) continue;
      walls.push(box);
    }
  }
  return walls;
}

/**
 * A map for one of the themes: outer walls, theme-specific interior, props,
 * exits in three corners and an open middle where hunters spawn. The same seed
 * and theme always give the same map, so the server only sends those two.
 */
export function generateMap(seed: number, theme: Theme = 'warehouse'): GameMap {
  const rand = mulberry32(seed);
  const half = HALF;
  const wallHeight = theme === 'yard' ? 4 : 6;
  const t = 0.5;
  const exits: Box[] = [
    { min: [-half, 0, -half], max: [-half + 3, 0.2, -half + 3] },
    { min: [half - 3, 0, half - 3], max: [half, 0.2, half] },
    { min: [-half, 0, half - 3], max: [-half + 3, 0.2, half] },
  ];
  const walls: Box[] = [
    { min: [-half - t, 0, -half - t], max: [half + t, wallHeight, -half] },
    { min: [-half - t, 0, half], max: [half + t, wallHeight, half + t] },
    { min: [-half - t, 0, -half], max: [-half, wallHeight, half] },
    { min: [half, 0, -half], max: [half + t, wallHeight, half] },
    ...interiorWalls(theme, rand, exits),
  ];
  const keepClear = exits.map((e): Box => ({ min: e.min, max: [e.max[0], 3, e.max[2]] }));

  const props: StaticProp[] = [];
  const propBoxes: Box[] = [];
  const types = PROP_TYPES.filter((k) => PROPS[k].themes.includes(theme));
  const totalWeight = types.reduce((s, k) => s + PROPS[k].weight, 0);
  const pickType = () => {
    let r = rand() * totalWeight;
    for (const k of types) {
      r -= PROPS[k].weight;
      if (r <= 0) return k;
    }
    return types[0];
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
    // Stack something on top of some crates and desks.
    if ((type === 'crate' || type === 'desk') && rand() < 0.35) {
      const top = type === 'desk' ? 'smallBox' : rand() < 0.5 ? 'crate' : 'smallBox';
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

  return { seed, theme, half, wallHeight, walls, props, propBoxes, solids, hunterSpawns, propSpawns, exits, lootSpots };
}
