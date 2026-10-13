import { boxAt, overlaps, rayBox } from './geometry.ts';
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

/** A flat rectangle on the floor, e.g. a road. */
export interface Area {
  min: [number, number];
  max: [number, number];
}

/** A building's footprint and wall height; the client puts a floor and a roof on it. */
export interface Building extends Area {
  height: number;
}

export type Side = 'n' | 's' | 'w' | 'e';

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
/** Tall walls get a lintel over each doorway from this height, so doors look like doors. */
const LINTEL = 2.6;

/**
 * Collects a map's walls, props and zones. Everything is placed through it so
 * nothing overlaps, doorways stay clear, and areas marked clear stay empty.
 */
export class Builder {
  walls: Box[] = [];
  props: StaticProp[] = [];
  propBoxes: Box[] = [];
  zones: Zone[] = [];
  roads: Area[] = [];
  buildings: Building[] = [];
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

  wall(x0: number, z0: number, x1: number, z1: number, height = 3, y0 = 0) {
    this.walls.push({ min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), height, Math.max(z0, z1)] });
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

  /** A building: outer walls with doorways, a roof (drawn by the client) and its name as a zone. */
  building(name: string, x0: number, z0: number, x1: number, z1: number, doors: Partial<Record<Side, number[]>>, height: number) {
    this.room(x0, z0, x1, z1, doors, height);
    this.buildings.push({ min: [x0, z0], max: [x1, z1], height });
    this.zone(name, x0, z0, x1, z1);
    // Keep a step clear outside every door, so nothing outside blocks the way in.
    for (const d of doors.n ?? []) this.keepClear(d - 1.6, z0 - 3, d + 1.6, z0);
    for (const d of doors.s ?? []) this.keepClear(d - 1.6, z1, d + 1.6, z1 + 3);
    for (const d of doors.w ?? []) this.keepClear(x0 - 3, d - 1.6, x0, d + 1.6);
    for (const d of doors.e ?? []) this.keepClear(x1, d - 1.6, x1 + 3, d + 1.6);
  }

  /** A road: drawn on the ground and kept free of props. */
  road(x0: number, z0: number, x1: number, z1: number) {
    this.roads.push({ min: [x0, z0], max: [x1, z1] });
    this.keepClear(x0, z0, x1, z1);
  }

  /** The same builder with every coordinate given relative to (ox, oz). */
  at(ox: number, oz: number): Local {
    return new Local(this, ox, oz);
  }

  /** A wall along x = `x` from z0 to z1, with doorways centered at `doors`. */
  partitionX(x: number, z0: number, z1: number, doors: number[], height = 3) {
    if (Math.abs(x) >= this.half) return;
    for (const [a, b] of this.segments(z0, z1, doors)) this.wall(x - 0.15, a, x + 0.15, b, height);
    for (const d of doors) {
      this.keepClear(x - 1.6, d - DOOR / 2, x + 1.6, d + DOOR / 2);
      if (height > LINTEL + 0.5) this.wall(x - 0.15, d - DOOR / 2, x + 0.15, d + DOOR / 2, height, LINTEL);
    }
  }

  /** A wall along z = `z` from x0 to x1, with doorways centered at `doors`. */
  partitionZ(z: number, x0: number, x1: number, doors: number[], height = 3) {
    if (Math.abs(z) >= this.half) return;
    for (const [a, b] of this.segments(x0, x1, doors)) this.wall(a, z - 0.15, b, z + 0.15, height);
    for (const d of doors) {
      this.keepClear(d - DOOR / 2, z - 1.6, d + DOOR / 2, z + 1.6);
      if (height > LINTEL + 0.5) this.wall(d - DOOR / 2, z - 0.15, d + DOOR / 2, z + 0.15, height, LINTEL);
    }
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

  /**
   * A hedge maze of `cols` x `rows` cells, `cell` metres square, with its
   * north-west corner at (x0, z0). Every cell can be reached; `loops` knocks
   * out a share of the inner hedges so there's more than one way round.
   * `doors` are gaps in the outside hedge, by side and cell index. Returns
   * the middle of each dead end, for something to find there.
   */
  maze(x0: number, z0: number, cols: number, rows: number, cell: number, height: number, doors: [Side, number][], loops = 0.1): [number, number][] {
    // east[i][j]: hedge between cell (i, j) and (i + 1, j); south[i][j]: between (i, j) and (i, j + 1).
    const east = Array.from({ length: cols }, () => Array<boolean>(rows).fill(true));
    const south = Array.from({ length: cols }, () => Array<boolean>(rows).fill(true));
    const seen = Array.from({ length: cols }, () => Array<boolean>(rows).fill(false));
    const stack: [number, number][] = [[Math.floor(this.rand() * cols), Math.floor(this.rand() * rows)]];
    seen[stack[0][0]][stack[0][1]] = true;
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([di, dj]) => [i + di, j + dj] as const).filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && !seen[a][b]);
      if (!next.length) {
        stack.pop();
        continue;
      }
      const [a, b] = next[Math.floor(this.rand() * next.length)];
      if (a !== i) east[Math.min(a, i)][j] = false;
      else south[i][Math.min(b, j)] = false;
      seen[a][b] = true;
      stack.push([a, b]);
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (i < cols - 1 && east[i][j] && this.chance(loops)) east[i][j] = false;
        if (j < rows - 1 && south[i][j] && this.chance(loops)) south[i][j] = false;
      }
    }
    const door = (side: Side, k: number) => doors.some(([s, at]) => s === side && at === k);
    const t = 0.8;
    // Hedges along x, one line per row edge, joined into long runs.
    for (let j = 0; j <= rows; j++) {
      const z = z0 + j * cell;
      let run = -1;
      for (let i = 0; i <= cols; i++) {
        const closed = i < cols && (j === 0 ? !door('n', i) : j === rows ? !door('s', i) : south[i][j - 1]);
        if (closed && run < 0) run = i;
        if (!closed && run >= 0) {
          this.wall(x0 + run * cell - t / 2, z - t / 2, x0 + i * cell + t / 2, z + t / 2, height);
          run = -1;
        }
      }
    }
    for (let i = 0; i <= cols; i++) {
      const x = x0 + i * cell;
      let run = -1;
      for (let j = 0; j <= rows; j++) {
        const closed = j < rows && (i === 0 ? !door('w', j) : i === cols ? !door('e', j) : east[i - 1][j]);
        if (closed && run < 0) run = j;
        if (!closed && run >= 0) {
          this.wall(x - t / 2, z0 + run * cell - t / 2, x + t / 2, z0 + j * cell + t / 2, height);
          run = -1;
        }
      }
    }
    // Keep the way in clear outside each gap.
    for (const [side, k] of doors) {
      const c = side === 'n' || side === 's' ? x0 + (k + 0.5) * cell : z0 + (k + 0.5) * cell;
      const h = cell / 2;
      if (side === 'n') this.keepClear(c - h, z0 - 3, c + h, z0);
      if (side === 's') this.keepClear(c - h, z0 + rows * cell, c + h, z0 + rows * cell + 3);
      if (side === 'w') this.keepClear(x0 - 3, c - h, x0, c + h);
      if (side === 'e') this.keepClear(x0 + cols * cell, c - h, x0 + cols * cell + 3, c + h);
    }
    const ends: [number, number][] = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const closed = [
          j === 0 ? !door('n', i) : south[i][j - 1],
          j === rows - 1 ? !door('s', i) : south[i][j],
          i === 0 ? !door('w', j) : east[i - 1][j],
          i === cols - 1 ? !door('e', j) : east[i][j],
        ].filter(Boolean).length;
        if (closed === 3) ends.push([x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell]);
      }
    }
    return ends;
  }

  /** A hedge (or any wall) standing on a road: roads are otherwise kept clear. */
  roadBlock(x: number, z: number, w: number, d: number, height: number) {
    const box: Box = { min: [x - w / 2, 0, z - d / 2], max: [x + w / 2, height, z + d / 2] };
    if (this.blocked(box, 0.15, true)) return null;
    this.walls.push(box);
    return box;
  }

  private blocked(b: Box, pad = 0.15, roads = false) {
    const p: Box = { min: [b.min[0] - pad, b.min[1], b.min[2] - pad], max: [b.max[0] + pad, b.max[1], b.max[2] + pad] };
    if (p.min[0] < -this.half || p.max[0] > this.half || p.min[2] < -this.half || p.max[2] > this.half) return true;
    return this.walls.some((w) => overlaps(p, w)) || (!roads && this.clear.some((w) => overlaps(p, w))) || this.propBoxes.some((w) => overlaps(p, w));
  }

  /** A vehicle left on a road: roads are otherwise kept clear, so this skips that check. */
  vehicle(type: string, x: number, z: number, rot: Rot) {
    const box = boxAt([x, 0, z], propSize(type, rot));
    if (this.blocked(box, 0.15, true)) return null;
    this.props.push({ id: this.props.length, type, pos: [x, 0, z], rot });
    this.propBoxes.push(box);
    return box;
  }

  /**
   * Breaks up open ground: wherever you could see far in several directions
   * from eye height, stands a piece of cover across the longest view.
   * `piece` gives its size (width, depth, height) for a view running along x
   * or along z. Leaves buildings, kept-clear areas and a walkable gap around
   * everything else alone.
   */
  fillOpen(piece: (viewAlongX: boolean) => Vec3, reach: number, step = 4, eye = 1.5) {
    const blockers = [...this.walls, ...this.propBoxes].filter((b) => b.min[1] <= eye && b.max[1] >= eye);
    const indoors = (x: number, z: number) => this.buildings.some((b) => x > b.min[0] - 1 && x < b.max[0] + 1 && z > b.min[1] - 1 && z < b.max[1] + 1);
    const cands: [number, number][] = [];
    for (let x = -this.half + step; x < this.half - step / 2; x += step) for (let z = -this.half + step; z < this.half - step / 2; z += step) cands.push([x, z]);
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }
    const dirs: Vec3[] = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), 0, Math.sin((k * Math.PI) / 4)]);
    let placed = 0;
    for (const [x, z] of cands) {
      if (indoors(x, z)) continue;
      const from: Vec3 = [x, eye, z];
      if (blockers.some((b) => from[0] > b.min[0] && from[0] < b.max[0] && from[2] > b.min[2] && from[2] < b.max[2])) continue;
      let alongX = 0;
      let alongZ = 0;
      for (const d of dirs) {
        let near = Infinity;
        for (const b of blockers) {
          const t = rayBox(from, d, b);
          if (t !== null && t < near) near = t;
          if (near < reach) break;
        }
        if (near < reach) continue;
        alongX += Math.abs(d[0]);
        alongZ += Math.abs(d[2]);
      }
      if (alongX + alongZ < 1.9) continue;
      const [w, d, h] = piece(alongX >= alongZ);
      const box: Box = { min: [x - w / 2, 0, z - d / 2], max: [x + w / 2, h, z + d / 2] };
      if (this.blocked(box, 1.4)) continue;
      this.walls.push(box);
      blockers.push(box);
      placed++;
    }
    return placed;
  }

  /** Whether a prop would fit on the floor here. */
  fits(type: string, x: number, z: number, rot: Rot = 0, pad = 0) {
    const size = propSize(type, rot);
    return !this.blocked(boxAt([x, 0, z], [size[0] + pad, size[1], size[2] + pad]));
  }

  /**
   * A blind spot: tall things set in an L, with room in the corner of the L
   * to hide where you can't be seen from most directions, and sometimes
   * something small already tucked in there. Placed whole or not at all.
   */
  nook(tall: readonly string[], hide: readonly string[], x: number, z: number): boolean {
    const type = this.pick(tall);
    const [w, , d] = propSize(type);
    const sx = this.chance(0.5) ? 1 : -1;
    const sz = this.chance(0.5) ? 1 : -1;
    const arm = 1 + Math.floor(this.rand() * 2);
    // The corner piece, then arms running along x (facing in) and along z.
    const pieces: [number, number, Rot][] = [[x, z, sz > 0 ? 0 : 2]];
    for (let i = 1; i <= arm; i++) pieces.push([x + sx * (w + 0.05) * i, z, sz > 0 ? 0 : 2]);
    for (let i = 1; i <= arm; i++) pieces.push([x, z + sz * (d / 2 + w / 2 + 0.05 + (i - 1) * (w + 0.05)), sx > 0 ? 1 : 3]);
    // The hiding spot: in the corner of the L, out of sight from behind it.
    const hx = x + sx * (d / 2 + 0.8);
    const hz = z + sz * (d / 2 + 0.8);
    if (!pieces.every(([px, pz, r]) => this.fits(type, px, pz, r)) || !this.fits('crate', hx, hz, 0, 0.4)) return false;
    for (const [px, pz, r] of pieces) this.dressTop(this.prop(type, px, pz, r), type);
    if (hide.length && this.chance(0.5)) this.prop(this.pick(hide), hx + sx * 0.2, hz + sz * 0.2, Math.floor(this.rand() * 4) as Rot);
    return true;
  }

  /**
   * Fills in along the outer walls so the playable edge wanders instead of
   * running straight: blocks of wall height, `seg` metres along each side,
   * reaching in by a smoothly varying depth up to `maxDepth`. They stop short
   * of walls, buildings and kept-clear areas (roads, exits, doorways) and
   * clear away loose props in their way.
   */
  ragged(maxDepth: number, seg: number, height: number) {
    const h = this.half;
    const inside = (b: Box) => b.max[0] > -h && b.min[0] < h && b.max[2] > -h && b.min[2] < h;
    const taken = [
      ...this.walls.filter(inside),
      ...this.clear,
      ...this.buildings.map((b): Box => ({ min: [b.min[0], 0, b.min[1]], max: [b.max[0], b.height, b.max[1]] })),
    ].map((b): Box => ({ min: [b.min[0] - 1.5, b.min[1], b.min[2] - 1.5], max: [b.max[0] + 1.5, b.max[1], b.max[2] + 1.5] }));
    const outer = this.walls.length;
    for (let side = 0; side < 4; side++) {
      const phase = [this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28];
      for (let a = -h; a < h - 0.01; a += seg) {
        const t = (a + seg / 2) / h;
        const wave = 0.5 + 0.25 * Math.sin(t * 2.1 + phase[0]) + 0.17 * Math.sin(t * 4.7 + phase[1]) + 0.08 * Math.sin(t * 9.3 + phase[2]);
        let depth = Math.round(Math.max(0, Math.min(1, wave)) * maxDepth);
        const at = (dep: number): Box => {
          const [x0, z0, x1, z1] =
            side === 0 ? [a, -h, a + seg, -h + dep] : side === 1 ? [a, h - dep, a + seg, h] : side === 2 ? [-h, a, -h + dep, a + seg] : [h - dep, a, h, a + seg];
          return { min: [x0, 0, z0], max: [x1, height, z1] };
        };
        while (depth > 0 && taken.some((b) => overlaps(at(depth), b))) depth--;
        // Containers are drawn from 2.4 m thick walls, so steer clear of that size.
        if (Math.abs(depth - 2.4) < 0.01) depth = 2;
        if (depth >= 1) this.walls.push(at(depth));
      }
    }
    const added = this.walls.slice(outer);
    const keep = this.propBoxes.map((b) => !added.some((w) => overlaps(b, w)));
    this.props = this.props.filter((_, i) => keep[i]).map((p, id) => ({ ...p, id }));
    this.propBoxes = this.propBoxes.filter((_, i) => keep[i]);
    return added;
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

/**
 * A Builder seen from a local origin, so an area can be laid out around its own
 * middle and then put anywhere on the map. Boxes it returns are in map coordinates.
 */
export class Local {
  constructor(readonly b: Builder, readonly ox: number, readonly oz: number) {}

  pick<T>(list: readonly T[]): T {
    return this.b.pick(list);
  }

  chance(p: number) {
    return this.b.chance(p);
  }

  private doors(d: Partial<Record<Side, number[]>>): Partial<Record<Side, number[]>> {
    return {
      n: d.n?.map((x) => x + this.ox),
      s: d.s?.map((x) => x + this.ox),
      w: d.w?.map((z) => z + this.oz),
      e: d.e?.map((z) => z + this.oz),
    };
  }

  zone(name: string, x0: number, z0: number, x1: number, z1: number) {
    this.b.zone(name, x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz);
  }

  keepClear(x0: number, z0: number, x1: number, z1: number) {
    this.b.keepClear(x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz);
  }

  wall(x0: number, z0: number, x1: number, z1: number, height = 3) {
    this.b.wall(x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz, height);
  }

  room(x0: number, z0: number, x1: number, z1: number, doors: Partial<Record<Side, number[]>>, height = 3) {
    this.b.room(x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz, this.doors(doors), height);
  }

  building(name: string, x0: number, z0: number, x1: number, z1: number, doors: Partial<Record<Side, number[]>>, height: number) {
    this.b.building(name, x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz, this.doors(doors), height);
  }

  partitionX(x: number, z0: number, z1: number, doors: number[], height = 3) {
    this.b.partitionX(x + this.ox, z0 + this.oz, z1 + this.oz, doors.map((d) => d + this.oz), height);
  }

  partitionZ(z: number, x0: number, x1: number, doors: number[], height = 3) {
    this.b.partitionZ(z + this.oz, x0 + this.ox, x1 + this.ox, doors.map((d) => d + this.ox), height);
  }

  prop(type: string, x: number, z: number, rot: Rot = 0, y = 0) {
    return this.b.prop(type, x + this.ox, z + this.oz, rot, y);
  }

  onTop(base: Box | null, type: string, rot: Rot = 0) {
    return this.b.onTop(base, type, rot);
  }

  line(types: readonly string[], x0: number, z0: number, x1: number, z1: number, spacing: number, fill = 0.8, rot?: Rot) {
    this.b.line(types, x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz, spacing, fill, rot);
  }

  edges(types: readonly string[], x0: number, z0: number, x1: number, z1: number, inset: number, spacing: number, fill = 0.7) {
    this.b.edges(types, x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz, inset, spacing, fill);
  }

  scatter(types: readonly string[], x0: number, z0: number, x1: number, z1: number, count: number) {
    this.b.scatter(types, x0 + this.ox, z0 + this.oz, x1 + this.ox, z1 + this.oz, count);
  }

  cluster(types: readonly string[], x: number, z: number, radius: number, count: number) {
    this.b.cluster(types, x + this.ox, z + this.oz, radius, count);
  }

  desk(x: number, z: number, rot: 0 | 1 = 0) {
    this.b.desk(x + this.ox, z + this.oz, rot);
  }

  meetingTable(cx: number, cz: number, length: number) {
    this.b.meetingTable(cx + this.ox, cz + this.oz, length);
  }

  maze(x0: number, z0: number, cols: number, rows: number, cell: number, height: number, doors: [Side, number][], loops = 0.1): [number, number][] {
    return this.b.maze(x0 + this.ox, z0 + this.oz, cols, rows, cell, height, doors, loops).map(([x, z]) => [x - this.ox, z - this.oz]);
  }
}
