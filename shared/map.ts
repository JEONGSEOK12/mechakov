import type { Theme } from './props.ts';
import { boxAt, overlaps } from './geometry.ts';
import { Builder, propSize, type Rot, type StaticProp, type Zone } from './layouts.ts';
import type { Box, Vec3 } from './types.ts';

export { propSize, type Rot, type StaticProp, type Zone } from './layouts.ts';

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
const STORAGE = ['crate', 'crate', 'smallBox', 'barrel', 'sack', 'pallet', 'bucket', 'paintCan', 'smallBox'];
const DOCK = ['pallet', 'forkPallet', 'crate', 'crate', 'smallBox', 'sack', 'handTruck'];
const WORKSHOP = ['toolbox', 'gasCan', 'spool', 'barrel', 'bucket', 'tire', 'extinguisher', 'paintCan', 'cabinet', 'handTruck'];
const OFFICE_WALL = ['cabinet', 'bookshelf', 'plant', 'cooler', 'printer', 'locker', 'whiteboard', 'bookshelf', 'cabinet'];
const LOUNGE = ['sofa', 'plant', 'cooler', 'trashCan', 'floorLamp', 'vending', 'sofa'];
const SERVER = ['serverRack', 'serverRack', 'serverRack', 'cabinet'];
const CORRIDOR = ['plant', 'trashCan', 'extinguisher', 'cooler', 'floorLamp', 'vending'];
const FUEL = ['barrel', 'barrel', 'gasBottle', 'gasCan', 'extinguisher'];
const BUILD_SITE = ['block', 'block', 'sandbag', 'spool', 'cone', 'tire', 'barrier', 'wheelbarrow', 'pipes', 'paintCan'];

/**
 * A big warehouse: rows of shelving racks fill the hall so you can't see far
 * down it, with cross racks breaking up the aisles. A walled office block sits
 * in one corner (open office, manager's office, break room), a workshop on the
 * west side and a loading dock along the south wall behind a row of racks.
 */
function warehouse(b: Builder) {
  const h = b.half;
  /** A rack along z at `x`, with goods on the floor along both sides. */
  const rack = (x: number, z0: number, z1: number, fill = 0.4) => {
    b.wall(x - 0.6, z0, x + 0.6, z1, 3.2);
    b.line(STORAGE, x - 1.3, z0 + 0.9, x - 1.3, z1 - 0.9, 1.8, fill, 1);
    b.line(STORAGE, x + 1.3, z0 + 0.9, x + 1.3, z1 - 0.9, 1.8, fill, 3);
  };
  /** A rack along x at `z`. */
  const rackX = (z: number, x0: number, x1: number, fill = 0.4) => {
    b.wall(x0, z - 0.6, x1, z + 0.6, 3.2);
    b.line(STORAGE, x0 + 0.9, z - 1.3, x1 - 0.9, z - 1.3, 1.8, fill, 2);
    b.line(STORAGE, x0 + 0.9, z + 1.3, x1 - 0.9, z + 1.3, 1.8, fill, 0);
  };

  b.zone('보관 창고', -h, -h, h, 34);
  // Office block in the north-east corner.
  b.zone('사무 구역', 20, -h, h, -25);
  b.room(20, -h, h, -25, { w: [-31], s: [27, 42] });
  b.partitionX(35, -h, -25, [-44, -31]);
  b.partitionZ(-37.5, 35, h, [42.5]);
  b.zone('사무실', 20, -h, 35, -25);
  for (const z of [-46, -41.5, -37]) for (const x of [23, 27, 31]) b.desk(x, z, 0);
  b.line(['cabinet', 'bookshelf', 'cabinet', 'cooler'], 21, -49.4, 34, -49.4, 1.4, 0.7, 0);
  b.line(['cabinet', 'plant', 'locker', 'printer'], 20.6, -34, 20.6, -27, 1.6, 0.6, 1);
  b.prop('whiteboard', 31, -33.2, 0);
  b.zone('관리자실', 35, -h, h, -37.5);
  b.desk(42.5, -45, 0);
  b.line(['bookshelf', 'cabinet', 'plant'], 36.5, -49.4, 48.5, -49.4, 1.2, 0.8, 0);
  b.prop('sofa', 42.5, -38.9, 2);
  b.prop('coffeeTable', 42.5, -40.6);
  b.prop('plant', 36.3, -38.4);
  b.zone('휴게실', 35, -37.5, h, -25);
  b.line(['sofa', 'vending', 'cooler'], 37, -26.1, 48, -26.1, 2.2, 0.8, 2);
  for (const x of [39, 45]) {
    const t = b.prop('desk', x, -32);
    if (!t) continue;
    b.prop('chair', x - 0.3, -32.8, 0);
    b.prop('chair', x + 0.3, -31.2, 2);
    if (b.chance(0.5)) b.onTop(t, b.pick(['microwave', 'plant']));
  }

  // Workshop on the west wall: benches along the north wall, tools along the rest.
  b.zone('정비실', -h, -24, -32, -6);
  b.room(-h, -24, -32, -6, { e: [-15], s: [-41] });
  for (const x of [-47, -43, -39, -35]) b.onTop(b.prop('desk', x, -23.2, 0), b.pick(['toolbox', 'gasCan', 'paintCan']));
  b.line(WORKSHOP, -49.2, -21, -49.2, -8, 1.6, 0.6, 1);
  b.line(['tire', 'tire', 'spool', 'barrel'], -33, -22, -33, -18, 1.2, 0.8, 3);
  b.cluster(['generator', 'toolbox', 'spool'], -41, -14, 2, 3);

  // Shelving: rows of racks in the hall, three long blocks per row with cross aisles between.
  for (const x of [-45, -40, -35]) rack(x, -42, -28);
  for (const x of [-45, -40, -35]) rack(x, 10, 29);
  for (const x of [-27, -22, -17, -12, 12, 17]) {
    rack(x, -46, -30);
    rack(x, -25, -10);
    rack(x, 10, 29);
  }
  for (const x of [25, 31, 37, 43]) {
    rack(x, -21, -9);
    rack(x, 10, 29);
  }
  // Cross racks in the middle aisle so it isn't one long open lane.
  rackX(0, -31, -9.5);
  rackX(0, 9.5, 21);
  rackX(0, 27, 46);
  rack(-38, -5, 5);
  rack(24, -5, 5, 0.3);
  rackX(-27.5, -9, 9, 0.3);
  // Racks between the hall and the dock, with ways through.
  for (const [x0, x1] of [[-46, -30], [-26, -10], [10, 26], [30, 46]]) rackX(33, x0, x1, 0.3);
  // And across the wide middle aisle, short of the open spot in the centre.
  rackX(-40, -8, 8, 0.3);
  rackX(-17, -8, 8, 0.3);
  rackX(17, -8, 8, 0.3);
  rack(0, 21, 29, 0.3);

  // Loading dock along the south wall, between the exits.
  b.zone('하역장', -h, 34, h, h);
  for (const x of [-22, -10, 10, 22]) b.wall(x - 1.2, 41, x + 1.2, 49, 2.6);
  for (const x of [-38, -30, -16, 16, 30, 38]) b.line(DOCK, x, 36.5, x, 40, 1.6, 0.8, 0);
  b.line(['cone'], -6, 37, 6, 37, 2, 1);
  for (const x of [-34, -16, 0, 16, 34]) b.line(['forkPallet', 'pallet', 'crate', 'handTruck'], x - 2, 46, x + 2, 46, 1.6, 0.7, 0);
  b.line(['barrel', 'dumpster', 'pipes', 'barrel'], -44, -h + 1.2, 16, -h + 1.2, 4, 0.5, 0);
}

/**
 * An office floor: two corridors crossing in the middle, closed by fire doors
 * halfway down, and four blocks of rooms. Open offices are split into smaller
 * rooms with high cubicle walls, so no room shows the whole floor.
 */
function office(b: Builder) {
  const h = b.half;
  const c = 3.5;
  b.zone('복도', -c, -h, c, h);
  b.zone('복도', -h, -c, h, c);
  // Fire doors: a wall across each corridor arm with one door in it.
  b.partitionZ(-25, -c, c, [0]);
  b.partitionZ(25, -c, c, [0]);
  b.partitionX(-25, -c, c, [0]);
  b.partitionX(25, -c, c, [0]);
  b.line(CORRIDOR, -c + 0.6, -h + 6, -c + 0.6, -10, 6, 0.6, 1);
  b.line(CORRIDOR, c - 0.6, 10, c - 0.6, h - 6, 6, 0.6, 3);
  b.line(CORRIDOR, 10, -c + 0.6, h - 6, -c + 0.6, 6, 0.6, 0);
  b.line(CORRIDOR, -h + 6, c - 0.6, -10, c - 0.6, 6, 0.6, 2);

  /** A cubicle wall (above eye height) along x, with a row of desks backed against it. */
  const cubicles = (x0: number, x1: number, z: number) => {
    b.wall(x0, z - 0.08, x1, z + 0.08, 1.8);
    for (let x = x0 + 1.2; x < x1 - 1; x += 3) {
      if (b.chance(0.75)) b.desk(x, z + 0.6, 0);
    }
  };

  // North-west: a records room and three open offices.
  b.room(-h, -h, -c, -c, { e: [-40, -15], s: [-38, -15] });
  b.partitionX(-27, -h, -c, [-38, -15]);
  b.partitionZ(-27, -h, -c, [-38, -15]);
  b.zone('자료실', -h, -h, -27, -27);
  for (const z of [-46, -41, -36, -31]) b.line(['bookshelf', 'cabinet', 'bookshelf'], -46, z, -31, z, 1.2, 0.8, 0);
  b.zone('오픈 오피스', -27, -h, -c, -27);
  for (const z of [-44, -38, -32]) cubicles(-25, -6, z);
  b.zone('오픈 오피스', -h, -27, -27, -c);
  for (const z of [-21, -15, -9]) cubicles(-47, -29, z);
  b.zone('오픈 오피스', -27, -27, -c, -c);
  for (const z of [-21, -15, -9]) cubicles(-25, -6, z);

  // North-east: four rooms.
  b.room(c, -h, h, -c, { w: [-38, -15], s: [15, 38] });
  b.partitionX(27, -h, -c, [-38, -15]);
  b.partitionZ(-27, c, h, [15, 38]);
  b.zone('회의실', c, -h, 27, -27);
  b.meetingTable(15, -38.5, 12);
  b.prop('whiteboard', 15, -48.9, 0);
  b.line(['plant', 'cooler', 'plant'], c + 1, -28.2, 26, -28.2, 6, 0.8, 2);
  b.zone('서버실', 27, -h, h, -27);
  for (let x = 30; x <= 47; x += 3) b.line(SERVER, x, -47, x, -31, 1.1, 0.85, 1);
  b.zone('임원실', c, -27, 27, -c);
  b.desk(15, -18, 0);
  b.line(['bookshelf', 'cabinet', 'plant', 'bookshelf'], c + 1, -26.3, 26, -26.3, 1.4, 0.8, 0);
  b.prop('sofa', 21, -4.6, 2);
  b.prop('coffeeTable', 21, -6.4);
  b.prop('floorLamp', 26.2, -4.6);
  b.zone('복사실', 27, -27, h, -c);
  b.line(['copier', 'printer', 'copier', 'cabinet'], 28, -26, 49, -26, 1.6, 0.8, 0);
  b.line(['archiveBox', 'cabinet', 'trashCan'], 28, -4.3, 49, -4.3, 1.8, 0.6, 2);

  // South-west: lounge, and a cafeteria behind a wall.
  b.room(-h, c, -c, h, { e: [15, 38], n: [-15, -38] });
  b.partitionZ(27, -h, -c, [-38, -15]);
  b.zone('라운지', -h, c, -c, 27);
  for (const [x, z] of [[-42, 10], [-30, 10], [-18, 10], [-42, 20], [-30, 20], [-18, 20]]) {
    b.prop('sofa', x, z - 1.4, 0);
    b.prop('coffeeTable', x, z);
    b.prop('sofa', x, z + 1.4, 2);
    if (b.chance(0.5)) b.prop('plant', x + 1.6, z + 1.6);
  }
  b.line(['vending', 'cooler', 'vending', 'trashCan'], -49.2, 6, -49.2, 25, 2.4, 0.8, 1);
  b.zone('구내식당', -h, 27, -c, h);
  for (let x = -42; x <= -12; x += 7.5) {
    for (let z = 32; z <= 44; z += 6) {
      const t = b.prop('desk', x, z);
      if (!t) continue;
      b.prop('chair', x - 0.3, z - 0.8, 0);
      b.prop('chair', x + 0.3, z + 0.8, 2);
      if (b.chance(0.3)) b.onTop(t, b.pick(['plant', 'trashCan']));
    }
  }
  b.line(['desk', 'vending', 'desk', 'cooler'], -46, 49.2, -8, 49.2, 2, 0.8, 2);

  // South-east: open offices split in three, and a storage room.
  b.room(c, c, h, h, { w: [15, 38], n: [15, 38] });
  b.partitionX(20, c, h, [15, 38]);
  b.partitionZ(27, 20, 36, [28]);
  b.zone('오픈 오피스', c, c, 20, h);
  for (const z of [8, 19, 24, 30, 43]) cubicles(c + 1.5, 18.5, z);
  b.zone('오픈 오피스', 20, c, h, 27);
  for (const z of [8, 19, 23.5]) cubicles(22, 48, z);
  b.zone('창고방', 36, 30, h, h);
  b.partitionX(36, 27, h, [40]);
  b.partitionZ(27, 36, h, [43]);
  for (const x of [39, 43, 47]) b.line(['smallBox', 'archiveBox', 'cabinet', 'locker'], x, 31, x, 47, 1.1, 0.7, 1);
  b.zone('회의실', 20, 27, 36, h);
  b.meetingTable(28, 38.5, 8);
  b.prop('whiteboard', 28, 49, 2);
}

/**
 * An outdoor yard: shipping containers stand in rows all over it, so lanes
 * between them limit how far you can see. Inside that: a container stack, a
 * workshop shed, a fuel depot, a guard post, a building site and a loading area.
 */
function yard(b: Builder) {
  const h = b.half;
  /** A shipping container, along z if `alongZ`, sometimes stacked two high. */
  const container = (x: number, z: number, alongZ: boolean, stackChance = 0.3) => {
    const [w, d] = alongZ ? [2.4, 6] : [6, 2.4];
    b.wall(x - w / 2, z - d / 2, x + w / 2, z + d / 2, b.chance(stackChance) ? 5.2 : 2.6);
  };

  b.zone('야적장', -h, -h, h, h);
  b.zone('컨테이너 구역', -44, -44, -8, -8);
  for (let x = -40; x <= -12; x += 7) {
    for (let z = -42; z <= -12; z += 8.5) {
      if (b.chance(0.15)) continue;
      container(x, z, b.chance(0.6), 0.4);
    }
  }
  b.scatter(['barrier', 'tire', 'pallet', 'crate', 'barrel'], -44, -44, -8, -8, 14);

  // Containers around the middle, leaving gaps to walk through.
  for (const [x, z, along] of [[-13, -2, true], [13, 2, true], [2, -13, false], [-2, 13, false], [-11, 11, false], [11, -11, true]] as const) container(x, z, along, 0.2);

  // Workshop shed in the north-east.
  b.zone('정비 창고', 22, -46, 46, -26);
  b.room(22, -46, 46, -26, { w: [-36], s: [30, 40] }, 4);
  b.line(WORKSHOP, 23, -45.2, 45, -45.2, 1.4, 0.6, 0);
  b.line(['tire', 'spool', 'barrel', 'gasCan'], 45.2, -44, 45.2, -28, 1.5, 0.6, 3);
  for (const x of [28, 34, 40]) b.onTop(b.prop('desk', x, -38, 0), b.pick(['toolbox', 'gasCan', 'paintCan']));
  b.prop('generator', 34, -31);

  // Fuel depot in the west, fenced with barriers, tanks in rows.
  b.zone('연료 저장소', -46, 10, -22, 32);
  b.line(['barrier'], -46, 10, -22, 10, 1.4, 0.85, 0);
  b.line(['barrier'], -22, 10, -22, 32, 1.4, 0.85, 1);
  for (const z of [14, 19, 24, 29]) b.line(FUEL, -43, z, -26, z, 1.3, 0.6, 0);

  // Guard post at the south gate.
  b.zone('경비실', 12, 38, 22, 46);
  b.room(12, 38, 22, 46, { w: [42] });
  b.desk(17, 40, 0);
  b.prop('cabinet', 21, 45, 3);
  b.prop('locker', 21.4, 43.5, 3);
  b.prop('extinguisher', 13, 45.5);

  // Building site south of the middle: site offices, then materials in rows.
  b.zone('공사 현장', -16, 14, 8, 36);
  b.line(['sandbag'], -16, 14, 8, 14, 0.9, 0.8, 0);
  container(-12, 20, false, 0.5);
  container(4, 30, true, 0.3);
  for (const z of [25, 29, 33]) b.line(BUILD_SITE, -14, z, -2, z, 1.6, 0.6, 0);

  // Loading area in the east: container rows with pallets in the lanes.
  b.zone('하역장', 22, -16, 46, 30);
  for (const x of [27, 35, 43]) {
    for (const z of [-10, 2, 14, 26]) {
      if (b.chance(0.2)) continue;
      container(x, z, true, 0.3);
    }
  }
  for (const x of [31, 39]) b.line(['pallet', 'crate', 'smallBox', 'sack', 'forkPallet'], x, -12, x, 28, 3, 0.5, 1);
  b.line(['block'], 20, -18, 20, 32, 3, 0.6, 1);

  // Building materials north of the middle.
  b.zone('자재 적치장', -2, -46, 18, -20);
  container(14, -30, true, 0.4);
  for (const z of [-43, -38, -33, -28, -23]) b.line(['spool', 'block', 'pallet', 'pipes', 'sandbag'], 0, z, 9, z, 2, 0.6, 0);
  // Scrap tires along the west fence.
  b.zone('폐타이어장', -h, -6, -30, 8);
  b.scatter(['tire', 'tire', 'tire', 'barrel'], -h + 1, -5, -31, 7, 18);
  // South-west: a row of containers waiting to ship, and more by the south-east exit.
  for (const x of [-42, -34, -26]) container(x, 40, false, 0.4);
  container(30, 40, false, 0.4);
  container(38, 36, true, 0.4);
  // Odd containers between the areas, so no lane runs the whole yard.
  for (const [x, z, along] of [
    [-24, -2, true], [-24, 8, false], [-8, 42, false], [2, 40, true], [-4, -24, false], [8, -17, true],
    [17, -6, true], [17, 10, true], [-19, 24, true], [12, 22, true], [14, 31, false], [30, -21, false], [40, -21, false],
  ] as const) container(x, z, along, 0.3);

  // A little loose clutter, and junk along the outer fence.
  b.scatter(['tire', 'cone', 'barrier', 'block', 'barrel', 'wheelbarrow'], -h + 2, -h + 2, h - 2, h - 2, 25);
  b.edges(['tire', 'pallet', 'barrel', 'block', 'crate', 'dumpster'], -h, -h, h, h, 0.8, 2.4, 0.3);
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
  const add = (type: string, pos: Vec3, rot: Rot = 0) => {
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
  add('vending', [8.4, 0, -1.5], 3);
  add('coffeeTable', [-7.6, 0, 1.5], 1);
  add('chair', [-6.7, 0, 1.2], 3);

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
