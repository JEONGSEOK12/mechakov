import type { Theme } from './props.ts';
import { boxAt, overlaps } from './geometry.ts';
import { Builder, propSize, type StaticProp, type Zone } from './layouts.ts';
import type { Box, Vec3 } from './types.ts';

export { propSize, type StaticProp, type Zone } from './layouts.ts';

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
  /** Named areas, e.g. the office inside the warehouse. */
  zones: Zone[];
  /** Hideout only: where to stand to use the stash, the workbench and the raid door. */
  stations?: Record<Station, Vec3>;
}

export type Station = 'stash' | 'bench' | 'door';
export const STATION_RANGE = 1.8;

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

/** Half-width of the open middle where hunters spawn. */
const CLEAR_ZONE = 6;

export const THEMES: Theme[] = ['warehouse', 'office', 'yard'];
export const THEME_NAMES: Record<Theme, string> = { warehouse: '창고', office: '사무실', yard: '야적장', hideout: '은신처' };

/** Raid maps are 100 m across. */
const HALF = 50;

// Prop groups by what kind of place they belong in.
const STORAGE = ['crate', 'crate', 'smallBox', 'barrel', 'sack', 'pallet', 'bucket'];
const DOCK = ['pallet', 'forkPallet', 'crate', 'crate', 'smallBox', 'sack'];
const WORKSHOP = ['toolbox', 'gasCan', 'spool', 'barrel', 'bucket', 'tire', 'extinguisher'];
const OFFICE_WALL = ['cabinet', 'bookshelf', 'plant', 'cooler', 'printer', 'locker'];
const LOUNGE = ['sofa', 'plant', 'cooler', 'trashCan', 'floorLamp', 'chair'];
const SERVER = ['locker', 'cabinet', 'smallBox', 'smallBox', 'monitor'];
const CORRIDOR = ['plant', 'trashCan', 'extinguisher', 'cooler', 'floorLamp'];
const FUEL = ['barrel', 'barrel', 'gasBottle', 'gasCan', 'extinguisher'];
const BUILD_SITE = ['block', 'block', 'sandbag', 'spool', 'cone', 'tire', 'barrier'];

/**
 * A big warehouse: shelving aisles in the main hall, a walled office block in
 * one corner (open office, manager's office, break room), a workshop on the
 * west side and a loading dock along the south wall.
 */
function warehouse(b: Builder) {
  const h = b.half;
  b.zone('보관 창고', -h, -h, h, 34);
  // Office block in the north-east corner.
  b.zone('사무 구역', 20, -h, h, -25);
  b.room(20, -h, h, -25, { w: [-31], s: [27, 42] });
  b.partitionX(35, -h, -25, [-44, -31]);
  b.partitionZ(-37.5, 35, h, [42.5]);
  b.zone('사무실', 20, -h, 35, -25);
  b.deskRows(21, -48.5, 34, -33);
  b.edges(OFFICE_WALL, 20, -h, 35, -25, 0.6, 2.2, 0.5);
  b.zone('관리자실', 35, -h, h, -37.5);
  b.desk(42.5, -45, 0);
  b.line(['bookshelf', 'cabinet', 'plant'], 36.5, -49.4, 48.5, -49.4, 1.6, 0.8, 0);
  b.prop('sofa', 42.5, -39.3);
  b.zone('휴게실', 35, -37.5, h, -25);
  b.line(LOUNGE, 36.5, -26.2, 48.5, -26.2, 1.9, 0.9, 0);
  b.scatter(['chair', 'trashCan', 'plant', 'cooler'], 37, -35, 48, -29, 6);

  // Workshop on the west wall.
  b.zone('정비실', -h, -24, -32, -6);
  b.room(-h, -24, -32, -6, { e: [-15], s: [-41] });
  b.edges(WORKSHOP, -h, -24, -32, -6, 0.6, 1.4, 0.75);
  b.cluster(['toolbox', 'spool', 'gasCan', 'generator'], -41, -15, 3, 5);

  // Loading dock along the south wall, between the exits.
  b.zone('하역장', -h, 34, h, h);
  for (const x of [-22, -10, 10, 22]) b.wall(x - 1.2, 41, x + 1.2, 49, 2.6);
  for (let x = -40; x <= 40; x += 4) {
    if (Math.abs(x) < 8) continue;
    b.line(DOCK, x, 36, x, 39.5, 1.6, 0.7, 0);
  }
  b.line(['cone'], -6, 37, 6, 37, 1.5, 1);

  // Shelving aisles in the main hall, leaving the middle cross open.
  for (const x of [-27, -22, -17, -12, 12, 17]) {
    for (const [z0, z1] of [[-46, -28], [-22, -9], [9, 30]]) {
      if (x < -30 && z0 === -22) continue;
      b.wall(x - 0.6, z0, x + 0.6, z1, 3.2);
      b.line(STORAGE, x - 1.4, z0 + 0.8, x - 1.4, z1 - 0.8, 1.5, 0.55);
      b.line(STORAGE, x + 1.4, z0 + 0.8, x + 1.4, z1 - 0.8, 1.5, 0.55);
    }
  }
  // East side of the hall: pallet stacks and barrels in blocks.
  for (let x = 24; x <= 44; x += 5) {
    for (let z = -16; z <= 28; z += 6) b.cluster(['pallet', 'crate', 'barrel', 'forkPallet'], x, z, 1.6, 3);
  }
  b.scatter(['cone', 'bucket', 'extinguisher', 'tire'], -h + 2, -h + 2, h - 2, 33, 18);
}

/**
 * An office floor: two corridors crossing in the middle, an open office with
 * cubicles, meeting rooms and private offices, a server room, a lounge and a
 * second open office with a storage room.
 */
function office(b: Builder) {
  const h = b.half;
  const c = 3.5;
  b.zone('복도', -c, -h, c, h);
  b.zone('복도', -h, -c, h, c);
  b.line(CORRIDOR, -c + 0.6, -h + 6, -c + 0.6, -10, 5, 0.7, 1);
  b.line(CORRIDOR, c - 0.6, 10, c - 0.6, h - 6, 5, 0.7, 1);
  b.line(CORRIDOR, 10, -c + 0.6, h - 6, -c + 0.6, 5, 0.7, 0);
  b.line(CORRIDOR, -h + 6, c - 0.6, -10, c - 0.6, 5, 0.7, 0);

  // North-west: open office with cubicle partitions.
  b.zone('오픈 오피스', -h, -h, -c, -c);
  b.room(-h, -h, -c, -c, { e: [-40, -15], s: [-38, -15] });
  for (const z of [-42, -32, -22, -12]) b.wall(-44, z - 0.08, -10, z + 0.08, 1.4);
  b.deskRows(-46, -47, -9, -6, 0.6);
  b.edges(OFFICE_WALL, -h, -h, -c, -c, 0.6, 3, 0.4);

  // North-east: four rooms.
  b.room(c, -h, h, -c, { w: [-38, -15], s: [15, 38] });
  b.partitionX(27, -h, -c, [-38, -15]);
  b.partitionZ(-27, c, h, [15, 38]);
  b.zone('회의실', c, -h, 27, -27);
  b.meetingTable(15, -38.5, 12);
  b.edges(['plant', 'cooler', 'floorLamp'], c, -h, 27, -27, 0.6, 4, 0.5);
  b.zone('서버실', 27, -h, h, -27);
  for (let x = 30; x <= 47; x += 3) b.line(SERVER, x, -47, x, -31, 1.1, 0.8, 1);
  b.zone('임원실', c, -27, 27, -c);
  b.desk(15, -18, 0);
  b.desk(9, -10, 1);
  b.line(['bookshelf', 'cabinet', 'plant'], c + 1, -26.3, 26, -26.3, 1.8, 0.7, 0);
  b.prop('sofa', 21, -8);
  b.zone('복사실', 27, -27, h, -c);
  b.edges(['copier', 'printer', 'cabinet', 'trashCan'], 27, -27, h, -c, 0.8, 2, 0.8);

  // South-west: lounge and cafeteria.
  b.zone('라운지', -h, c, -c, h);
  b.room(-h, c, -c, h, { e: [15, 38], n: [-15, -38] });
  b.edges(LOUNGE, -h, c, -c, h, 0.7, 2.2, 0.6);
  for (let x = -40; x <= -12; x += 7) {
    for (let z = 14; z <= 40; z += 7) {
      const t = b.prop('desk', x, z);
      if (t) for (const [dx, dz] of [[0, -0.8], [0, 0.8]]) b.prop('chair', x + dx, z + dz);
      if (t && b.chance(0.4)) b.onTop(t, b.pick(['smallBox', 'bucket']));
    }
  }

  // South-east: second open office and a storage room.
  b.zone('오픈 오피스', c, c, h, h);
  b.room(c, c, h, h, { w: [15, 38], n: [15, 38] });
  b.deskRows(c + 2, c + 2, 34, h - 2, 0.6);
  b.zone('창고방', 36, 30, h, h);
  b.partitionX(36, 30, h, []);
  b.partitionZ(30, 36, h, [43]);
  b.edges(['smallBox', 'smallBox', 'locker', 'cabinet', 'bucket'], 36, 30, h, h, 0.6, 1.2, 0.85);
}

/**
 * An outdoor yard: stacked shipping containers, a workshop shed, a fuel depot,
 * a guard post by the south gate, a building site and a parking lot.
 */
function yard(b: Builder) {
  const h = b.half;
  b.zone('야적장', -h, -h, h, h);
  // Containers in rows with lanes between them.
  b.zone('컨테이너 구역', -44, -44, -8, -8);
  for (let x = -40; x <= -12; x += 7) {
    for (let z = -42; z <= -12; z += 8.5) {
      if (b.chance(0.2)) continue;
      const rot = b.chance(0.6);
      const [w, d] = rot ? [2.4, 6] : [6, 2.4];
      b.wall(x - w / 2, z - d / 2, x + w / 2, z + d / 2, b.chance(0.3) ? 5.2 : 2.6);
    }
  }
  b.scatter(['barrier', 'tire', 'pallet', 'crate', 'cone'], -44, -44, -8, -8, 22);

  // Workshop shed in the north-east.
  b.zone('정비 창고', 22, -46, 46, -26);
  b.room(22, -46, 46, -26, { w: [-36], s: [30, 40] }, 4);
  b.edges(WORKSHOP, 22, -46, 46, -26, 0.6, 1.4, 0.75);
  b.cluster(['generator', 'spool', 'toolbox', 'barrel'], 34, -36, 4, 7);

  // Fuel depot in the west, fenced with barriers.
  b.zone('연료 저장소', -46, 10, -22, 32);
  b.line(['barrier'], -46, 10, -22, 10, 1.4, 0.85, 0);
  b.line(['barrier'], -22, 10, -22, 32, 1.4, 0.85, 1);
  for (let x = -42; x <= -26; x += 4) for (let z = 14; z <= 28; z += 4.5) b.cluster(FUEL, x, z, 1.2, 3);

  // Guard post at the south gate.
  b.zone('경비실', 12, 38, 22, 46);
  b.room(12, 38, 22, 46, { w: [42] });
  b.desk(17, 40, 0);
  b.prop('cabinet', 21, 45);
  b.prop('extinguisher', 13, 45.5);

  // Building site south of the middle.
  b.zone('공사 현장', -16, 14, 8, 36);
  b.line(['sandbag'], -16, 14, 8, 14, 0.9, 0.8, 0);
  b.scatter(BUILD_SITE, -15, 16, 7, 35, 40);

  // Parking lot / loading area in the east.
  b.zone('하역장', 22, -16, 46, 30);
  for (let x = 25; x <= 43; x += 6) for (let z = -12; z <= 26; z += 7) b.cluster(['pallet', 'crate', 'crate', 'smallBox', 'sack'], x, z, 1.8, 3);
  b.line(['block'], 20, -18, 20, 32, 2.5, 0.6, 1);

  // Building materials stacked north of the middle.
  b.zone('자재 적치장', -2, -46, 18, -20);
  for (let x = 1; x <= 15; x += 4.5) for (let z = -43; z <= -23; z += 5) b.cluster(['spool', 'block', 'pallet', 'sack', 'sandbag'], x, z, 1.6, 3);
  // Scrap tires along the west fence.
  b.zone('폐타이어장', -h, -6, -30, 8);
  b.scatter(['tire', 'tire', 'tire', 'barrel'], -h + 1, -5, -31, 7, 26);

  // Loose clutter everywhere else.
  b.scatter(['tire', 'cone', 'barrier', 'block', 'barrel', 'bucket'], -h + 2, -h + 2, h - 2, h - 2, 60);
  // Junk piles along the outer fence.
  b.edges(['tire', 'pallet', 'barrel', 'block', 'crate', 'spool'], -h, -h, h, h, 0.8, 2.2, 0.45);
}

const LAYOUTS: Record<Exclude<Theme, 'hideout'>, (b: Builder) => void> = { warehouse, office, yard };

/**
 * A map for one of the themes: outer walls, the theme's areas with props that
 * fit each area, exits in three corners and an open middle where hunters
 * spawn. The same seed and theme always give the same map, so the server only
 * sends those two.
 */
export function generateMap(seed: number, theme: Theme = 'warehouse'): GameMap {
  if (theme === 'hideout') return hideoutMap(seed);
  const rand = mulberry32(seed);
  const half = HALF;
  const wallHeight = theme === 'yard' ? 4 : 6;
  const t = 0.5;
  const exits: Box[] = [
    { min: [-half, 0, -half], max: [-half + 4, 0.2, -half + 4] },
    { min: [half - 4, 0, half - 4], max: [half, 0.2, half] },
    { min: [-half, 0, half - 4], max: [-half + 4, 0.2, half] },
  ];
  const b = new Builder(rand, half);
  b.walls.push(
    { min: [-half - t, 0, -half - t], max: [half + t, wallHeight, -half] },
    { min: [-half - t, 0, half], max: [half + t, wallHeight, half + t] },
    { min: [-half - t, 0, -half], max: [-half, wallHeight, half] },
    { min: [half, 0, -half], max: [half + t, wallHeight, half] },
  );
  for (const e of exits) b.keepClear(e.min[0] - 1, e.min[2] - 1, e.max[0] + 1, e.max[2] + 1);
  b.keepClear(-CLEAR_ZONE, -CLEAR_ZONE, CLEAR_ZONE, CLEAR_ZONE);
  LAYOUTS[theme](b);
  const { walls, props, propBoxes, zones } = b;
  const keepClear = exits.map((e): Box => ({ min: e.min, max: [e.max[0], 3, e.max[2]] }));
  const solids = [...walls, ...propBoxes];

  const hunterSpawns: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    hunterSpawns.push([Math.cos(a) * 2, 0, Math.sin(a) * 2]);
  }
  const propSpawns: Vec3[] = [];
  let attempts = 0;
  while (propSpawns.length < 16 && attempts < 4000) {
    attempts++;
    const pos: Vec3 = [(rand() * 2 - 1) * (half - 2), 0, (rand() * 2 - 1) * (half - 2)];
    if (Math.abs(pos[0]) < CLEAR_ZONE + 3 && Math.abs(pos[2]) < CLEAR_ZONE + 3) continue;
    if (solids.some((s) => overlaps(boxAt(pos, [1.2, 2, 1.2]), s))) continue;
    propSpawns.push(pos);
  }

  const lootSpots: Vec3[] = [];
  for (const box of propBoxes) {
    const top = box.max[1];
    const center: Vec3 = [(box.min[0] + box.max[0]) / 2, top, (box.min[2] + box.max[2]) / 2];
    if (top <= 1.2 && box.max[0] - box.min[0] >= 0.5 && !propBoxes.some((o) => o !== box && overlaps(boxAt(center, [0.3, 0.3, 0.3]), o))) {
      lootSpots.push(center);
    }
  }
  attempts = 0;
  let floorSpots = 0;
  while (floorSpots < 150 && attempts < 8000) {
    attempts++;
    const pos: Vec3 = [(rand() * 2 - 1) * (half - 1), 0, (rand() * 2 - 1) * (half - 1)];
    if (Math.abs(pos[0]) < CLEAR_ZONE && Math.abs(pos[2]) < CLEAR_ZONE) continue;
    if ([...solids, ...keepClear].some((s) => overlaps(boxAt(pos, [0.6, 0.6, 0.6]), s))) continue;
    lootSpots.push(pos);
    floorSpots++;
  }

  return { seed, theme, half, wallHeight, walls, props, propBoxes, solids, hunterSpawns, propSpawns, exits, lootSpots, zones };
}

/** The zone a point is in: the smallest one containing it, so rooms win over the area around them. */
export function zoneAt(map: GameMap, x: number, z: number): Zone | null {
  let best: Zone | null = null;
  let bestArea = Infinity;
  for (const zone of map.zones) {
    if (x < zone.min[0] || x > zone.max[0] || z < zone.min[1] || z > zone.max[1]) continue;
    const area = (zone.max[0] - zone.min[0]) * (zone.max[1] - zone.min[1]);
    if (area < bestArea) [best, bestArea] = [zone, area];
  }
  return best;
}

/**
 * The hideout: one fixed room with a row of lockers (the stash), a workbench
 * for upgrades and a door out to the next raid, drawn like an exit.
 */
function hideoutMap(seed: number): GameMap {
  const half = 9;
  const wallHeight = 4;
  const t = 0.5;
  const walls: Box[] = [
    { min: [-half - t, 0, -half - t], max: [half + t, wallHeight, -half] },
    { min: [-half - t, 0, half], max: [half + t, wallHeight, half + t] },
    { min: [-half - t, 0, -half], max: [-half, wallHeight, half] },
    { min: [half, 0, -half], max: [half + t, wallHeight, half] },
  ];
  const props: StaticProp[] = [];
  const propBoxes: Box[] = [];
  const add = (type: string, pos: Vec3, rot: 0 | 1 = 0) => {
    props.push({ id: props.length, type, pos, rot });
    propBoxes.push(boxAt(pos, propSize(type, rot)));
  };
  // Stash lockers along the back wall.
  for (const x of [-6.3, -5.5, -4.7, -3.9]) add('locker', [x, 0, -8.7]);
  // Workbench: two desks with a filing cabinet and some boxes.
  add('desk', [4.3, 0, -8.6]);
  add('desk', [5.75, 0, -8.6]);
  add('cabinet', [7.2, 0, -8.65]);
  add('smallBox', [3.9, 0.75, -8.6]);
  add('bucket', [6.1, 0.75, -8.6]);
  // Clutter in the corners, clear of the paths.
  add('crate', [-7.8, 0, 7.6]);
  add('crate', [-7.8, 1, 7.6]);
  add('crate', [-6.7, 0, 7.8]);
  add('pallet', [-7.6, 0, 5.8]);
  add('barrel', [7.8, 0, 7.8]);
  add('barrel', [6.9, 0, 7.9]);
  add('tire', [7.8, 0, 4.5]);
  add('plant', [-8.3, 0, -2]);
  add('cooler', [8.4, 0, -4]);

  const door: Box = { min: [-1.5, 0, half - 2], max: [1.5, 0.2, half] };
  const spawns: Vec3[] = [[0, 0, 0], [1.5, 0, 0.5], [-1.5, 0, 0.5], [0, 0, 1.5], [1.5, 0, 2], [-1.5, 0, 2]];
  return {
    seed,
    theme: 'hideout',
    half,
    wallHeight,
    walls,
    props,
    propBoxes,
    solids: [...walls, ...propBoxes],
    hunterSpawns: spawns,
    propSpawns: spawns,
    exits: [door],
    lootSpots: [],
    zones: [{ name: '은신처', min: [-half, -half], max: [half, half] }],
    stations: { stash: [-5.1, 0, -7.4], bench: [5, 0, -7.4], door: [0, 0, half - 1] },
  };
}
