import { boxAt, overlaps } from './geometry.ts';
import { PROPS } from './props.ts';
import type { Box, Vec3 } from './types.ts';

/** Quarter turns around Y. A prop's front (the side you use it from) faces +z at 0, +x at 1, -z at 2, -x at 3. */
export type Rot = 0 | 1 | 2 | 3;

export function propSize(type: string, rot: Rot = 0): Vec3 {
  const s = PROPS[type].size;
  return rot % 2 ? [s[2], s[1], s[0]] : [s[0], s[1], s[2]];
}

export interface StaticProp {
  id: number;
  type: string;
  /** Bottom center. */
  pos: Vec3;
  rot: Rot;
}

/** A named area of a map, shown on the HUD while you're in it. */
export interface Zone {
  name: string;
  min: [number, number];
  max: [number, number];
}

type Side = 'n' | 's' | 'w' | 'e';

/** Chance and choices for what goes on top of a prop placed in a line. */
const TOPS: Record<string, [number, string[]]> = {
  crate: [0.4, ['crate', 'smallBox', 'smallBox', 'paintCan', 'toolbox']],
  pallet: [0.45, ['smallBox', 'sack', 'crate', 'paintCan']],
  cabinet: [0.3, ['plant', 'archiveBox', 'smallBox']],
  locker: [0.25, ['smallBox', 'archiveBox']],
  barrel: [0.15, ['bucket', 'paintCan']],
  block: [0.3, ['block', 'paintCan', 'bucket']],
  printer: [0.3, ['archiveBox']],
  copier: [0.3, ['archiveBox', 'smallBox']],
  coffeeTable: [0.4, ['plant', 'microwave']],
  spool: [0.3, ['toolbox', 'bucket', 'paintCan']],
  generator: [0.3, ['toolbox', 'gasCan']],
};
const DOOR = 2.4;

/**
 * Collects a map's walls, props and zones. Everything is placed through it so
 * nothing overlaps, doorways stay clear, and areas marked clear stay empty.
 */
export class Builder {
  walls: Box[] = [];
  props: StaticProp[] = [];
  propBoxes: Box[] = [];
  zones: Zone[] = [];
  private clear: Box[] = [];

  constructor(readonly rand: () => number, readonly half: number) {}

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)];
  }

  chance(p: number) {
    return this.rand() < p;
  }

  zone(name: string, x0: number, z0: number, x1: number, z1: number) {
    this.zones.push({ name, min: [x0, z0], max: [x1, z1] });
  }

  /** Keeps props out of an area (doorways, exits, the middle). */
  keepClear(x0: number, z0: number, x1: number, z1: number) {
    this.clear.push({ min: [x0, 0, z0], max: [x1, 3, z1] });
  }

  wall(x0: number, z0: number, x1: number, z1: number, height = 3) {
    this.walls.push({ min: [Math.min(x0, x1), 0, Math.min(z0, z1)], max: [Math.max(x0, x1), height, Math.max(z0, z1)] });
  }

  /**
   * Four thin walls around a rectangle, with doorways (by their center along
   * the side). Sides on the map's edge are left to the outer wall.
   */
  room(x0: number, z0: number, x1: number, z1: number, doors: Partial<Record<Side, number[]>>, height = 3) {
    this.partitionZ(z0, x0, x1, doors.n ?? [], height);
    this.partitionZ(z1, x0, x1, doors.s ?? [], height);
    this.partitionX(x0, z0, z1, doors.w ?? [], height);
    this.partitionX(x1, z0, z1, doors.e ?? [], height);
  }

  /** A wall along x = `x` from z0 to z1, with doorways centered at `doors`. */
  partitionX(x: number, z0: number, z1: number, doors: number[], height = 3) {
    if (Math.abs(x) >= this.half) return;
    for (const [a, b] of this.segments(z0, z1, doors)) this.wall(x - 0.15, a, x + 0.15, b, height);
    for (const d of doors) this.keepClear(x - 1.6, d - DOOR / 2, x + 1.6, d + DOOR / 2);
  }

  /** A wall along z = `z` from x0 to x1, with doorways centered at `doors`. */
  partitionZ(z: number, x0: number, x1: number, doors: number[], height = 3) {
    if (Math.abs(z) >= this.half) return;
    for (const [a, b] of this.segments(x0, x1, doors)) this.wall(a, z - 0.15, b, z + 0.15, height);
    for (const d of doors) this.keepClear(d - DOOR / 2, z - 1.6, d + DOOR / 2, z + 1.6);
  }

  private segments(from: number, to: number, doors: number[]): [number, number][] {
    const out: [number, number][] = [];
    let at = from;
    for (const d of doors.slice().sort((a, b) => a - b)) {
      if (d - DOOR / 2 > at) out.push([at, d - DOOR / 2]);
      at = d + DOOR / 2;
    }
    if (at < to) out.push([at, to]);
    return out;
  }

  private blocked(b: Box) {
    const p: Box = { min: [b.min[0] - 0.15, b.min[1], b.min[2] - 0.15], max: [b.max[0] + 0.15, b.max[1], b.max[2] + 0.15] };
    if (p.min[0] < -this.half || p.max[0] > this.half || p.min[2] < -this.half || p.max[2] > this.half) return true;
    return this.walls.some((w) => overlaps(p, w)) || this.clear.some((w) => overlaps(p, w)) || this.propBoxes.some((w) => overlaps(p, w));
  }

  /** Places a prop if there's room; returns its box. */
  prop(type: string, x: number, z: number, rot: Rot = 0, y = 0): Box | null {
    const pos: Vec3 = [x, y, z];
    const box = boxAt(pos, propSize(type, rot));
    if (y === 0 && this.blocked(box)) return null;
    this.props.push({ id: this.props.length, type, pos, rot });
    this.propBoxes.push(box);
    return box;
  }

  /** Puts something on top of a placed prop. */
  onTop(base: Box | null, type: string, rot: Rot = 0) {
    if (!base) return null;
    const x = (base.min[0] + base.max[0]) / 2;
    const z = (base.min[2] + base.max[2]) / 2;
    return this.prop(type, x, z, rot, base.max[1]);
  }

  /** Props spaced along a line, each chosen from `types`, with some gaps. */
  line(types: readonly string[], x0: number, z0: number, x1: number, z1: number, spacing: number, fill = 0.8, rot?: Rot) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.floor(len / spacing));
    const r = rot ?? (Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : 1);
    for (let i = 0; i <= n; i++) {
      if (!this.chance(fill)) continue;
      const f = n === 0 ? 0 : i / n;
      const type = this.pick(types);
      const box = this.prop(type, x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, r);
      this.dressTop(box, type);
    }
  }

  /** Lines along the inside of a rectangle's walls, set in from the edge, facing into it. */
  edges(types: readonly string[], x0: number, z0: number, x1: number, z1: number, inset: number, spacing: number, fill = 0.7) {
    this.line(types, x0 + inset, z0 + inset, x1 - inset, z0 + inset, spacing, fill, 0);
    this.line(types, x0 + inset, z1 - inset, x1 - inset, z1 - inset, spacing, fill, 2);
    this.line(types, x0 + inset, z0 + inset, x0 + inset, z1 - inset, spacing, fill, 1);
    this.line(types, x1 - inset, z0 + inset, x1 - inset, z1 - inset, spacing, fill, 3);
  }

  /** Random spots inside a rectangle. */
  scatter(types: readonly string[], x0: number, z0: number, x1: number, z1: number, count: number) {
    for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
      const type = this.pick(types);
      const box = this.prop(type, x0 + this.rand() * (x1 - x0), z0 + this.rand() * (z1 - z0), Math.floor(this.rand() * 4) as Rot);
      if (box) i++;
    }
  }

  /** A few props bunched around a point, like a pile. */
  cluster(types: readonly string[], x: number, z: number, radius: number, count: number) {
    this.scatter(types, x - radius, z - radius, x + radius, z + radius, count);
  }

  /** Small things that sit on top of bigger props, so surfaces aren't bare. */
  dressTop(box: Box | null, type: string) {
    const extra = TOPS[type];
    if (!box || !extra || !this.chance(extra[0])) return;
    this.onTop(box, this.pick(extra[1]), Math.floor(this.rand() * 4) as Rot);
  }

  /** A desk facing `rot`, with a chair where you'd sit and things on top. */
  desk(x: number, z: number, rot: 0 | 1 = 0) {
    const d = this.prop('desk', x, z, rot);
    if (!d) return;
    const cx = (d.min[0] + d.max[0]) / 2;
    const cz = (d.min[2] + d.max[2]) / 2;
    const top = d.max[1];
    // A monitor toward the back, and sometimes paperwork beside it.
    if (rot === 0) {
      this.prop(this.pick(['monitor', 'monitor', 'printer']), cx - 0.25, cz - 0.12, 0, top);
      if (this.chance(0.5)) this.prop(this.pick(['archiveBox', 'smallBox']), cx + 0.4, cz - 0.05, 0, top);
      this.prop('chair', x - 0.1, z + 0.8, 2);
    } else {
      this.prop(this.pick(['monitor', 'monitor', 'printer']), cx - 0.12, cz + 0.25, 1, top);
      if (this.chance(0.5)) this.prop(this.pick(['archiveBox', 'smallBox']), cx - 0.05, cz - 0.4, 1, top);
      this.prop('chair', x + 0.8, z + 0.1, 3);
    }
    if (this.chance(0.35)) this.prop('trashCan', rot === 0 ? x - 0.95 : x, rot === 0 ? z : z - 0.95);
  }

  /** Rows of desks filling a rectangle. */
  deskRows(x0: number, z0: number, x1: number, z1: number, fill = 0.85) {
    for (let z = z0 + 1; z < z1 - 1.2; z += 3.6) {
      for (let x = x0 + 1.2; x < x1 - 1; x += 3) {
        if (this.chance(fill)) this.desk(x, z);
      }
    }
  }

  /** A long table of desks end to end with chairs on both sides. */
  meetingTable(cx: number, cz: number, length: number) {
    for (let x = cx - length / 2; x <= cx + length / 2; x += 1.6) {
      this.prop('desk', x, cz);
      this.prop('chair', x, cz - 0.8, 0);
      this.prop('chair', x, cz + 0.8, 2);
    }
  }
}
