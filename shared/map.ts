import type { Theme } from './props.ts';
import { boxAt, overlaps } from './geometry.ts';
import { Builder, propSize, type Area, type Building, type Local, type Rot, type StaticProp, type Zone } from './layouts.ts';
import type { Box, Vec3 } from './types.ts';

export { propSize, type Area, type Building, type Rot, type StaticProp, type Zone } from './layouts.ts';

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
  /** Roads between the areas, drawn on the ground. */
  roads: Area[];
  /** Buildings: the client gives each a floor and a roof. */
  buildings: Building[];
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

/** Raid maps are 180 m across: eight areas around a middle, with roads between. */
const HALF = 90;
/** Where the roads run (both ways), and how wide they are. */
const ROADS = [-30, 30];
const ROAD_WIDTH = 8;

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

/** Where the eight areas around the middle sit: a 3x3 grid split by the roads. */
const CELL = 62;
const N: [number, number] = [0, -CELL];
const NE: [number, number] = [CELL, -CELL];
const E: [number, number] = [CELL, 0];
const SE: [number, number] = [CELL, CELL];
const S: [number, number] = [0, CELL];
const SW: [number, number] = [-CELL, CELL];
const W: [number, number] = [-CELL, 0];
const NW: [number, number] = [-CELL, -CELL];

/** A shipping container (or a trailer), along z if `alongZ`, sometimes stacked two high. */
function container(L: Local, x: number, z: number, alongZ: boolean, stackChance = 0.3) {
  const [w, d] = alongZ ? [2.4, 6] : [6, 2.4];
  L.wall(x - w / 2, z - d / 2, x + w / 2, z + d / 2, L.chance(stackChance) ? 5.2 : 2.6);
}

/** A cubicle wall (above eye height) along x, with a row of desks backed against it. */
function cubicles(L: Local, x0: number, x1: number, z: number) {
  L.wall(x0, z - 0.08, x1, z + 0.08, 1.8);
  for (let x = x0 + 1.2; x < x1 - 1; x += 3) {
    if (L.chance(0.75)) L.desk(x, z + 0.6, 0);
  }
}

/** Tables with a chair on each side, like a canteen. */
function tables(L: Local, x0: number, x1: number, z0: number, z1: number, step: number) {
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) {
      const t = L.prop('desk', x, z);
      if (!t) continue;
      L.prop('chair', x - 0.3, z - 0.8, 0);
      L.prop('chair', x + 0.3, z + 0.8, 2);
      if (L.chance(0.3)) L.onTop(t, L.pick(['plant', 'microwave', 'trashCan']));
    }
  }
}

/** Sofas facing each other over a low table. */
function sofaGroup(L: Local, x: number, z: number) {
  L.prop('sofa', x, z - 1.4, 0);
  L.prop('coffeeTable', x, z);
  L.prop('sofa', x, z + 1.4, 2);
  if (L.chance(0.5)) L.prop('plant', x + 1.6, z + 1.6);
}

/**
 * A logistics site: separate buildings around a car park in the middle, with
 * roads between them. Two rack halls (general shelving, and tall pallet
 * racking), a bulk freight shed, a workshop with a small-parts cage, an office
 * block, a loading dock with trailers outside, a container stack and a waste yard.
 */
function warehouse(b: Builder) {
  const H = 6;
  /**
   * Three kinds of shelving, told apart by height (the client draws each its own way):
   * general shelving, tall pallet racking, and low small-parts shelving.
   */
  const KINDS = {
    general: { height: 3.2, floor: STORAGE, fill: 0.3 },
    pallet: { height: 4.2, floor: ['pallet', 'forkPallet', 'pallet', 'crate'], fill: 0.35 },
    parts: { height: 2.4, floor: ['smallBox', 'toolbox', 'paintCan', 'archiveBox', 'bucket'], fill: 0.35 },
  };
  type Kind = keyof typeof KINDS;
  /** A rack along z at `x`, with goods on the floor along both sides. */
  const rack = (L: Local, x: number, z0: number, z1: number, kind: Kind = 'general') => {
    const k = KINDS[kind];
    L.wall(x - 0.6, z0, x + 0.6, z1, k.height);
    L.line(k.floor, x - 1.3, z0 + 0.9, x - 1.3, z1 - 0.9, 1.8, k.fill, 1);
    L.line(k.floor, x + 1.3, z0 + 0.9, x + 1.3, z1 - 0.9, 1.8, k.fill, 3);
  };
  /** A rack along x at `z`. */
  const rackX = (L: Local, z: number, x0: number, x1: number, kind: Kind = 'general') => {
    const k = KINDS[kind];
    L.wall(x0, z - 0.6, x1, z + 0.6, k.height);
    L.line(k.floor, x0 + 0.9, z - 1.3, x1 - 0.9, z - 1.3, 1.8, k.fill, 2);
    L.line(k.floor, x0 + 0.9, z + 1.3, x1 - 0.9, z + 1.3, 1.8, k.fill, 0);
  };
  /** A row of crate stacks, one to three high. */
  const stacks = (L: Local, x: number, z0: number, z1: number) => {
    for (let z = z0; z <= z1; z += 1.15) {
      if (!L.chance(0.85)) continue;
      let box = L.prop('crate', x, z);
      const high = L.chance(0.3) ? 3 : L.chance(0.6) ? 2 : 1;
      for (let i = 1; i < high && box; i++) box = L.onTop(box, 'crate');
    }
  };

  // General shelving hall: racks in rows with a cross aisle and a middle aisle.
  let L = b.at(...N);
  L.building('일반 창고', -24, -20, 24, 20, { s: [-16, 0, 16], w: [0], e: [0] }, H);
  for (const x of [-19, -14, -9, 9, 14, 19]) {
    rack(L, x, -17, -3);
    rack(L, x, 3, 17);
  }
  rack(L, 0, -17, -8);
  rack(L, 0, 8, 16);
  L.line(STORAGE, -22, -19.2, 22, -19.2, 1.6, 0.5, 0);
  L.line(['dumpster', 'pallet', 'barrel'], -22, -21.6, 22, -21.6, 4, 0.4, 2);

  // Office block: open office, manager's office, break room.
  L = b.at(...NE);
  L.building('사무동', -18, -14, 18, 14, { w: [4], s: [-8] }, H);
  L.partitionX(2, -14, 14, [-8, 6]);
  L.partitionZ(0, 2, 18, [10]);
  L.zone('사무실', -18, -14, 2, 14);
  for (const z of [-10, -4, 2]) for (const x of [-14, -9.5, -5]) L.desk(x, z, 0);
  L.line(['cabinet', 'bookshelf', 'cabinet', 'cooler'], -17, -13.4, 0, -13.4, 1.4, 0.7, 0);
  L.line(['cabinet', 'plant', 'locker', 'printer'], -17.4, 9, -17.4, 13, 1.6, 0.6, 1);
  L.prop('whiteboard', -8, 13.4, 2);
  L.zone('관리자실', 2, -14, 18, 0);
  L.desk(10, -9, 0);
  L.line(['bookshelf', 'cabinet', 'plant'], 3.5, -13.4, 17, -13.4, 1.2, 0.8, 0);
  L.prop('sofa', 10, -1.4, 2);
  L.prop('coffeeTable', 10, -3.1);
  L.zone('휴게실', 2, 0, 18, 14);
  L.line(['sofa', 'vending', 'cooler'], 4, 12.9, 17, 12.9, 2.2, 0.8, 2);
  tables(L, 7, 13, 6, 6, 6);

  // Workshop with a small-parts cage behind wire fencing.
  L = b.at(...NW);
  L.building('정비동', -20, -15, 20, 15, { e: [0], s: [-10, 10] }, H);
  L.partitionX(0, -15, 15, [-5, 8]);
  L.zone('정비실', -20, -15, 0, 15);
  for (const x of [-17, -13, -9, -5]) L.onTop(L.prop('desk', x, -14.2, 0), L.pick(['toolbox', 'gasCan', 'paintCan']));
  L.line(WORKSHOP, -19.2, -11, -19.2, 12, 1.6, 0.6, 1);
  L.line(['tire', 'tire', 'spool', 'barrel'], -1.5, -12, -1.5, -8, 1.2, 0.8, 3);
  L.cluster(['generator', 'toolbox', 'spool'], -10, 4, 2, 3);
  L.zone('부품 창고', 0, -15, 20, 15);
  L.room(3, -12, 18, 12, { w: [0], s: [10] }, 2.5);
  for (const x of [6.5, 10.5, 14.5]) rack(L, x, -10, 9, 'parts');

  // Bulk freight shed: crates stacked in rows.
  L = b.at(...W);
  L.building('대형 화물', -15, -20, 15, 20, { e: [-10, 10], n: [0] }, H);
  for (const x of [-10, -5, 5, 10]) {
    stacks(L, x, -17, -3);
    stacks(L, x, 3, 17);
  }
  L.line(['pallet', 'forkPallet', 'handTruck'], -14, -19, 14, -19, 2.4, 0.4, 0);

  // Pallet racking hall.
  L = b.at(...E);
  L.building('팔레트 랙', -18, -22, 18, 22, { w: [-12, 12], s: [0] }, H);
  for (const x of [-12, -6, 6, 12]) {
    rack(L, x, -19, -3, 'pallet');
    rack(L, x, 3, 19, 'pallet');
  }
  L.line(['pallet', 'forkPallet', 'handTruck'], 16.6, -20, 16.6, 20, 2, 0.5, 3);

  // Loading dock: goods in rows inside, trailers backed up outside.
  L = b.at(...S);
  L.building('하역장', -25, -12, 25, 12, { n: [-18, -6, 6, 18], e: [0] }, H);
  for (const z of [-6, 0, 5]) L.line(DOCK, -22, z, 22, z, 1.8, 0.45, 0);
  rackX(L, 9.5, -23, -8);
  rackX(L, 9.5, 8, 23);
  L.line(['cone'], -24, -14, 24, -14, 3, 0.5, 0);
  for (const x of [-12, 0, 12]) container(L, x, -21, true, 0);
  L.zone('트럭 주차장', -25, -26, 25, -12);

  // Container stack in the south-west.
  L = b.at(...SW);
  L.zone('컨테이너 적치장', -24, -24, 24, 22);
  for (let x = -16; x <= 18; x += 7) {
    for (let z = -18; z <= 14; z += 8) {
      if (L.chance(0.2) || (x < -12 && z > 10)) continue;
      container(L, x, z, L.chance(0.6), 0.4);
    }
  }
  L.scatter(['pallet', 'crate', 'barrel', 'forkPallet', 'tire'], -22, -22, 22, 18, 8);

  // Waste yard behind a fence in the south-east.
  L = b.at(...SE);
  L.zone('폐기물 처리장', -22, -22, 18, 18);
  L.room(-20, -20, 16, 16, { n: [-2], w: [0], s: [6] }, 2.5);
  for (const z of [-14, -8, -2, 4, 10]) L.line(['dumpster', 'barrel', 'pipes', 'barrel', 'tire'], -16, z, 12, z, 2.6, 0.6, 0);

  // Car park in the middle, open around the hunters' spawn.
  L = b.at(0, 0);
  L.zone('주차장', -22, -22, 22, 22);
  for (const [x, z, along] of [[-15, -14, true], [15, 14, true], [14, -15, false], [-14, 15, false]] as const) container(L, x, z, along, 0);
  for (const z of [-10, 10]) {
    L.line(['forkPallet', 'pallet', 'crate', 'handTruck'], -21, z, -9, z, 1.8, 0.6, 0);
    L.line(['forkPallet', 'pallet', 'crate', 'barrier'], 9, z, 21, z, 1.8, 0.6, 0);
  }
  L.line(['cone'], -8, -18, 8, -18, 2, 0.8, 0);
  L.line(['cone'], -8, 18, 8, 18, 2, 0.8, 0);
}

/**
 * An office park: office buildings, a canteen, a server building, a records
 * building and a lounge around a plaza, with a car park in the south. Inside,
 * high cubicle walls split the open offices so no room shows a whole building.
 */
function office(b: Builder) {
  const H = 6;
  // Main building: a corridor through the middle with rooms on both sides.
  let L = b.at(...N);
  L.building('본관', -24, -18, 24, 18, { w: [0], e: [0], s: [-12, 12] }, H);
  L.partitionZ(-2.5, -24, 24, [-12, 6, 18]);
  L.partitionZ(2.5, -24, 24, [-12, 12]);
  L.partitionX(0, -18, -2.5, []);
  L.partitionX(12, -18, -2.5, []);
  L.partitionX(0, 2.5, 18, []);
  L.zone('복도', -24, -2.5, 24, 2.5);
  L.line(CORRIDOR, -20, -1.9, 20, -1.9, 6, 0.5, 0);
  L.zone('오픈 오피스', -24, -18, 0, -2.5);
  for (const z of [-15, -9]) cubicles(L, -22, -2, z);
  L.zone('회의실', 0, -18, 12, -2.5);
  L.meetingTable(6, -10, 6);
  L.prop('whiteboard', 6, -17.4, 0);
  L.zone('임원실', 12, -18, 24, -2.5);
  L.desk(18, -12, 0);
  L.line(['bookshelf', 'cabinet', 'plant', 'bookshelf'], 13, -17.4, 23, -17.4, 1.4, 0.8, 0);
  L.prop('sofa', 18, -3.9, 2);
  L.prop('coffeeTable', 18, -5.6);
  L.zone('오픈 오피스', -24, 2.5, 0, 18);
  for (const z of [6, 12]) cubicles(L, -22, -2, z);
  L.zone('오픈 오피스', 0, 2.5, 24, 18);
  for (const z of [6, 12]) cubicles(L, 2, 22, z);

  // Server building: racks in rows, and a room of desks for the IT staff.
  L = b.at(...NE);
  L.building('전산동', -15, -13, 15, 13, { w: [0], s: [-8] }, H);
  L.partitionX(3, -13, 13, [-6, 6]);
  L.zone('서버실', 3, -13, 15, 13);
  for (const x of [5.5, 8.5, 11.5]) L.line(SERVER, x, -11, x, 11, 1.1, 0.85, 1);
  L.zone('전산실', -15, -13, 3, 13);
  for (const z of [-8, -2, 4]) for (const x of [-12, -7]) L.desk(x, z, 0);

  // Records building: rows of shelves, and a copy room.
  L = b.at(...NW);
  L.building('자료동', -16, -14, 16, 14, { e: [0], s: [8] }, H);
  L.partitionX(4, -14, 14, [-6, 6]);
  L.zone('자료실', -16, -14, 4, 14);
  for (const z of [-11, -6, -1, 4, 9]) L.line(['bookshelf', 'cabinet', 'bookshelf'], -14, z, 1.5, z, 1.2, 0.75, 0);
  L.zone('복사실', 4, -14, 16, 14);
  L.line(['copier', 'printer', 'copier', 'cabinet'], 5, -13.2, 15, -13.2, 1.6, 0.8, 0);
  L.line(['archiveBox', 'cabinet', 'trashCan'], 5, 13.3, 15, 13.3, 1.8, 0.6, 2);
  L.desk(10, -2, 0);

  // Canteen.
  L = b.at(...W);
  L.building('구내식당', -17, -15, 17, 15, { e: [-6, 6], n: [0] }, H);
  tables(L, -11, 13, -8, 8, 8);
  L.line(['desk', 'vending', 'desk', 'cooler'], -16.2, -13, -16.2, 13, 2, 0.8, 1);

  // Second building: open office in the north half, meeting room and pantry in the south.
  L = b.at(...E);
  L.building('별관', -18, -20, 18, 20, { w: [-10, 10], s: [9] }, H);
  L.partitionZ(0, -18, 18, [-10, 10]);
  L.partitionX(0, 0, 20, [10]);
  L.zone('오픈 오피스', -18, -20, 18, 0);
  for (const z of [-16, -10.5, -5]) cubicles(L, -14, 16, z);
  L.zone('회의실', -18, 0, 0, 20);
  L.meetingTable(-9, 10, 8);
  L.prop('whiteboard', -9, 19.4, 2);
  L.zone('탕비실', 0, 0, 18, 20);
  L.line(['vending', 'cooler', 'vending', 'trashCan'], 17.2, 2, 17.2, 18, 2.4, 0.8, 3);
  sofaGroup(L, 7, 6);
  sofaGroup(L, 7, 14);

  // Car park: rows of barriers between the bays.
  L = b.at(...S);
  L.zone('주차장', -24, -24, 24, 24);
  for (const z of [-14, 0, 14]) L.line(['barrier', 'barrier', 'cone'], -22, z, 22, z, 1.4, 0.7, 0);
  L.line(['dumpster', 'trashCan', 'dumpster'], -22, 22, 0, 22, 4, 0.7, 2);

  // Lounge.
  L = b.at(...SW);
  L.building('라운지', -15, -13, 15, 13, { n: [0], e: [0] }, H);
  for (const x of [-8, 8]) for (const z of [-6, 5]) sofaGroup(L, x, z);
  L.line(['vending', 'cooler', 'vending', 'trashCan'], -14.2, -10, -14.2, 10, 2.4, 0.8, 1);

  // Facilities: a storeroom and the guards' room.
  L = b.at(...SE);
  L.building('관리동', -14, -12, 14, 12, { n: [-6], w: [0] }, H);
  L.partitionX(2, -12, 12, [-4, 6]);
  L.zone('창고방', 2, -12, 14, 12);
  for (const x of [5, 8.5, 12]) L.line(['smallBox', 'archiveBox', 'cabinet', 'locker'], x, -10, x, 10, 1.1, 0.7, 1);
  L.zone('경비실', -14, -12, 2, 12);
  L.desk(-6, -6, 0);
  L.line(['locker', 'locker', 'cabinet'], -13.4, 0, -13.4, 10, 0.8, 0.9, 1);

  // Plaza in the middle: planters around the edge and tables to sit at.
  L = b.at(0, 0);
  L.zone('광장', -22, -22, 22, 22);
  L.edges(['plant', 'trashCan', 'plant', 'vending'], -20, -20, 20, 20, 0, 3, 0.6);
  for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) {
    L.prop('coffeeTable', x, z);
    L.prop('chair', x, z - 0.9, 0);
    L.prop('chair', x, z + 0.9, 2);
  }
}

/**
 * An outdoor yard: container stacks, a workshop shed, a fuel depot, a guard
 * post, a building site and a loading area, spread out with roads between.
 */
function yard(b: Builder) {
  let L = b.at(...NW);
  L.zone('컨테이너 구역', -24, -24, 24, 24);
  for (let x = -17; x <= 18; x += 7) {
    for (let z = -18; z <= 20; z += 8.5) {
      if (L.chance(0.15)) continue;
      container(L, x, z, L.chance(0.6), 0.4);
    }
  }
  L.scatter(['barrier', 'tire', 'pallet', 'crate', 'barrel'], -22, -22, 22, 22, 14);

  L = b.at(...N);
  L.zone('자재 적치장', -22, -22, 22, 22);
  container(L, 16, -6, true, 0.4);
  container(L, -16, 8, true, 0.4);
  for (const z of [-18, -12, -6, 0, 6, 12, 18]) L.line(['spool', 'block', 'pallet', 'pipes', 'sandbag'], -10, z, 10, z, 2, 0.6, 0);

  L = b.at(...NE);
  L.building('정비 창고', -16, -12, 16, 12, { w: [0], s: [-6, 8] }, 4);
  L.line(WORKSHOP, -15, -11.2, 15, -11.2, 1.4, 0.6, 0);
  L.line(['tire', 'spool', 'barrel', 'gasCan'], 15.2, -10, 15.2, 10, 1.5, 0.6, 3);
  for (const x of [-8, -2, 4]) L.onTop(L.prop('desk', x, -3, 0), L.pick(['toolbox', 'gasCan', 'paintCan']));
  L.prop('generator', 10, 4);
  for (const x of [-10, 10]) container(L, x, 20, false, 0.3);

  L = b.at(...W);
  L.zone('폐타이어장', -22, -22, 22, 22);
  L.scatter(['tire', 'tire', 'tire', 'barrel'], -20, -20, 20, 20, 30);
  container(L, -8, -10, false, 0.3);
  container(L, 10, 6, true, 0.3);

  L = b.at(...E);
  L.zone('하역장', -24, -24, 24, 24);
  for (const x of [-16, -8, 0, 8, 16]) {
    for (const z of [-15, -3, 9]) {
      if (L.chance(0.2)) continue;
      container(L, x, z, true, 0.3);
    }
  }
  for (const x of [-12, -4, 4, 12]) L.line(['pallet', 'crate', 'smallBox', 'sack', 'forkPallet'], x, -20, x, 20, 3, 0.5, 1);

  L = b.at(...SW);
  L.zone('연료 저장소', -22, -22, 18, 18);
  L.line(['barrier'], -20, -20, 16, -20, 1.4, 0.85, 0);
  L.line(['barrier'], 16, -20, 16, 16, 1.4, 0.85, 1);
  for (const z of [-14, -9, -4, 1, 6, 11]) L.line(FUEL, -16, z, 12, z, 1.3, 0.6, 0);

  L = b.at(...S);
  L.zone('공사 현장', -22, -22, 22, 22);
  L.line(['sandbag'], -20, -20, 20, -20, 0.9, 0.8, 0);
  container(L, -14, -12, false, 0.5);
  container(L, 14, 10, true, 0.3);
  for (const z of [-4, 1, 6, 11, 16]) L.line(BUILD_SITE, -16, z, 8, z, 1.6, 0.6, 0);

  L = b.at(...SE);
  L.building('경비실', -6, -5, 6, 5, { w: [0], n: [3] }, 4);
  L.desk(0, -2, 0);
  L.prop('cabinet', 5, 4, 3);
  L.prop('locker', 5.4, 2.5, 3);
  L.prop('extinguisher', -5, 4.4);
  for (const x of [-16, -8, 10]) container(L, x, -16, false, 0.4);
  container(L, -16, 12, true, 0.4);
  container(L, 14, 2, true, 0.4);

  // Containers around the middle, leaving gaps to walk through.
  L = b.at(0, 0);
  L.zone('중앙 야적장', -22, -22, 22, 22);
  for (const [x, z, along] of [[-13, -2, true], [13, 2, true], [2, -13, false], [-2, 13, false], [-11, 11, false], [11, -11, true], [-18, -16, false], [18, 16, false]] as const) {
    container(L, x, z, along, 0.2);
  }
  L.scatter(['tire', 'cone', 'barrier', 'block', 'barrel', 'wheelbarrow'], -22, -22, 22, 22, 10);
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
  const r = ROAD_WIDTH / 2;
  for (const v of ROADS) {
    b.road(v - r, -half, v + r, half);
    b.road(-half, v - r, half, v + r);
  }
  LAYOUTS[theme](b);
  // A few cones and barriers along the road sides.
  const roadside = theme === 'office' ? ['cone', 'barrier', 'trashCan'] : ['cone', 'barrier', 'cone', 'tire'];
  for (const v of ROADS) {
    for (const side of [-r - 0.8, r + 0.8]) {
      b.line(roadside, v + side, -half + 6, v + side, half - 6, 5, 0.12, 1);
      b.line(roadside, -half + 6, v + side, half - 6, v + side, 5, 0.12, 0);
    }
  }
  const { walls, props, propBoxes, zones, roads, buildings } = b;
  const keepClear = exits.map((e): Box => ({ min: e.min, max: [e.max[0], 3, e.max[2]] }));
  const solids = [...walls, ...propBoxes];

  const hunterSpawns: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    hunterSpawns.push([Math.cos(a) * 2, 0, Math.sin(a) * 2]);
  }
  const propSpawns: Vec3[] = [];
  let attempts = 0;
  // Props start in the named areas, near things to hide as, not out on the roads.
  while (propSpawns.length < 16 && attempts < 4000) {
    attempts++;
    const z = zones[Math.floor(rand() * zones.length)];
    const pos: Vec3 = [z.min[0] + 1 + rand() * (z.max[0] - z.min[0] - 2), 0, z.min[1] + 1 + rand() * (z.max[1] - z.min[1] - 2)];
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
  // Floor spots, mostly inside buildings and named areas where there's cover.
  while (floorSpots < 260 && attempts < 12000) {
    attempts++;
    const inArea = rand() < 0.75 && zones.length > 0;
    const z = zones[Math.floor(rand() * zones.length)];
    const pos: Vec3 = inArea
      ? [z.min[0] + rand() * (z.max[0] - z.min[0]), 0, z.min[1] + rand() * (z.max[1] - z.min[1])]
      : [(rand() * 2 - 1) * (half - 1), 0, (rand() * 2 - 1) * (half - 1)];
    if (Math.abs(pos[0]) < CLEAR_ZONE && Math.abs(pos[2]) < CLEAR_ZONE) continue;
    if ([...solids, ...keepClear].some((s) => overlaps(boxAt(pos, [0.6, 0.6, 0.6]), s))) continue;
    lootSpots.push(pos);
    floorSpots++;
  }

  return { seed, theme, half, wallHeight, walls, props, propBoxes, solids, hunterSpawns, propSpawns, exits, lootSpots, zones, roads, buildings };
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
    roads: [],
    buildings: [],
    stations: { stash: [-5.1, 0, -7.4], bench: [5, 0, -7.4], door: [0, 0, half - 1] },
  };
}
