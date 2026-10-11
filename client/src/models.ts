import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box } from '../../shared/types.ts';
import { PROPS } from '../../shared/props.ts';

/**
 * Detailed prop models, each built from simple parts with vertex colors and
 * merged into one geometry, so a map still draws one instanced mesh per prop
 * type. Every model fits inside its prop's collision box, origin at the bottom
 * center, front (the side you use it from) facing +z.
 */

/** Small deterministic random, so every client builds the same books and boxes. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tmp = new THREE.Color();

/** `c` made lighter (f > 1) or darker (f < 1). */
function shade(c: number, f: number): number {
  tmp.setHex(c);
  const hsl = { h: 0, s: 0, l: 0 };
  tmp.getHSL(hsl);
  tmp.setHSL(hsl.h, hsl.s, Math.min(1, hsl.l * f));
  return tmp.getHex();
}

/** Collects colored parts and merges them. */
class Parts {
  private list: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    tmp.setHex(color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.list.push(g);
    return this;
  }

  /** A box with its bottom center at (x, y, z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx || ry || rz) g.rotateX(rx).rotateY(ry).rotateZ(rz);
    return this.add(g.translate(x, y + h / 2, z), color);
  }

  /** An upright cylinder with its bottom center at (x, y, z). */
  cyl(r: number, h: number, x: number, y: number, z: number, color: number, top = r, seg = 14) {
    return this.add(new THREE.CylinderGeometry(top, r, h, seg).translate(x, y + h / 2, z), color);
  }

  /** A cylinder lying along x (axis 'x') or z, centered at (x, y, z). */
  lying(axis: 'x' | 'z', r: number, len: number, x: number, y: number, z: number, color: number, seg = 14) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    else g.rotateX(Math.PI / 2);
    return this.add(g.translate(x, y, z), color);
  }

  /** A ring lying flat (or standing, facing x/z) centered at (x, y, z). */
  ring(R: number, r: number, x: number, y: number, z: number, color: number, facing: 'y' | 'x' | 'z' = 'y', arc = Math.PI * 2) {
    const g = new THREE.TorusGeometry(R, r, 6, 18, arc);
    if (facing === 'y') g.rotateX(Math.PI / 2);
    else if (facing === 'x') g.rotateY(Math.PI / 2);
    return this.add(g.translate(x, y, z), color);
  }

  blob(sx: number, sy: number, sz: number, x: number, y: number, z: number, color: number) {
    return this.add(new THREE.IcosahedronGeometry(1, 1).scale(sx, sy, sz).translate(x, y, z), color);
  }

  sphere(r: number, x: number, y: number, z: number, color: number, sy = 1) {
    return this.add(new THREE.SphereGeometry(r, 12, 8).scale(1, sy, 1).translate(x, y, z), color);
  }

  merge(): THREE.BufferGeometry {
    const geo = mergeGeometries(this.list)!;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

const BLACK = 0x1c1d20;
const STEEL = 0x8e969c;
const DARK_STEEL = 0x4a5056;
const WHITE = 0xe9e9e4;
const WOOD = 0xa87a4a;

type Model = (p: Parts, size: [number, number, number], color: number) => void;

const MODELS: Record<string, Model> = {
  crate(p, [w, h, d], c) {
    p.box(w - 0.06, h - 0.06, d - 0.06, 0, 0.03, 0, shade(c, 1.15));
    const t = 0.08;
    const frame = shade(c, 0.72);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(t, h, t, (sx * (w - t)) / 2, 0, (sz * (d - t)) / 2, frame);
    for (const y of [0, h - t]) {
      for (const sz of [-1, 1]) p.box(w, t, t, 0, y, (sz * (d - t)) / 2, frame);
      for (const sx of [-1, 1]) p.box(t, t, d, (sx * (w - t)) / 2, y, 0, frame);
    }
    const diag = Math.hypot(w, h) - 0.2;
    for (const sz of [-1, 1]) p.box(diag, 0.07, 0.02, 0, h / 2 - 0.035, (sz * d) / 2, frame, 0, 0, Math.atan2(h, w) * sz);
    for (const sx of [-1, 1]) p.box(0.02, 0.07, diag, (sx * w) / 2, h / 2 - 0.035, 0, frame, Math.atan2(h, d) * sx, 0, 0);
    // Plank seams.
    for (const y of [h * 0.35, h * 0.65]) for (const sz of [-1, 1]) p.box(w - 0.1, 0.012, 0.012, 0, y, (sz * d) / 2, shade(c, 0.8));
  },
  smallBox(p, [w, h, d], c) {
    p.box(w, h, d, 0, 0, 0, c);
    p.box(w + 0.004, 0.006, 0.08, 0, h - 0.003, 0, 0xd9c08a);
    p.box(0.08, h * 0.5, d + 0.004, 0, h * 0.5, 0, 0xd9c08a);
    p.box(0.18, 0.1, 0.004, -w * 0.2, h * 0.45, d / 2, WHITE);
    p.box(0.1, 0.012, 0.005, -w * 0.2, h * 0.5, d / 2 + 0.001, BLACK);
    p.box(w + 0.002, 0.008, d + 0.002, 0, h * 0.92, 0, shade(c, 0.85));
  },
  barrel(p, [w, h], c) {
    const r = w / 2 - 0.02;
    p.cyl(r, h - 0.02, 0, 0, 0, c, r, 20);
    for (const y of [0.04, h * 0.33, h * 0.66, h - 0.06]) p.ring(r, 0.02, 0, y, 0, shade(c, 0.7));
    p.cyl(r - 0.03, 0.02, 0, h - 0.02, 0, shade(c, 0.85), r - 0.03, 20);
    p.cyl(0.04, 0.03, r * 0.5, h, 0, DARK_STEEL);
    p.cyl(0.03, 0.02, -r * 0.5, h, 0.1, DARK_STEEL);
    p.box(0.25, 0.18, 0.005, 0, h * 0.42, r + 0.005, WHITE);
    p.box(0.12, 0.1, 0.006, 0, h * 0.46, r + 0.006, 0xe0b020);
  },
  cone(p, [w, h], c) {
    p.box(w, 0.04, w, 0, 0, 0, shade(c, 0.4));
    p.cyl(w * 0.4, h - 0.04, 0, 0.04, 0, c, 0.025, 16);
    const at = (y: number) => w * 0.4 + ((0.025 - w * 0.4) * (y - 0.04)) / (h - 0.04);
    for (const [y0, y1] of [[h * 0.35, h * 0.47], [h * 0.58, h * 0.68]]) p.cyl(at(y0) + 0.004, y1 - y0, 0, y0, 0, WHITE, at(y1) + 0.004, 16);
  },
  locker(p, [w, h, d], c) {
    p.box(w, 0.08, d - 0.04, 0, 0, -0.02, shade(c, 0.5));
    p.box(w, h - 0.08, d - 0.04, 0, 0.08, -0.02, c);
    const door = (w - 0.06) / 2;
    for (const sx of [-1, 1]) {
      const x = (sx * (door + 0.02)) / 2;
      p.box(door, h - 0.18, 0.02, x, 0.12, d / 2 - 0.02, shade(c, 1.12));
      for (let i = 0; i < 4; i++) p.box(door * 0.6, 0.015, 0.005, x, h - 0.35 - i * 0.05, d / 2, BLACK);
      for (let i = 0; i < 4; i++) p.box(door * 0.6, 0.015, 0.005, x, 0.3 + i * 0.05, d / 2, BLACK);
      p.box(0.025, 0.14, 0.03, x - (sx * door) / 2 + sx * 0.05, h * 0.5, d / 2, DARK_STEEL);
      p.box(0.07, 0.04, 0.004, x, h - 0.2, d / 2 + 0.001, WHITE);
    }
    p.box(w, 0.03, d, 0, h - 0.03, 0, shade(c, 0.8));
  },
  tire(p, [w, h], c) {
    const tube = h / 2;
    const R = w / 2 - tube;
    p.ring(R, tube, 0, tube, 0, c);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      p.box(0.05, h * 0.9, 0.12, Math.cos(a) * (w / 2 - 0.02), h * 0.05, Math.sin(a) * (w / 2 - 0.02), shade(c, 0.6), 0, -a, 0);
    }
    p.cyl(R - 0.02, h * 0.55, 0, h * 0.22, 0, STEEL, R - 0.02, 16);
    p.cyl(0.07, h * 0.6, 0, h * 0.2, 0, DARK_STEEL, 0.07, 10);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      p.cyl(0.015, 0.02, Math.cos(a) * 0.1, h * 0.8, Math.sin(a) * 0.1, BLACK);
    }
  },
  bucket(p, [w, h], c) {
    p.cyl(w * 0.38, h - 0.02, 0, 0, 0, c, w / 2 - 0.01, 16);
    p.ring(w / 2 - 0.01, 0.012, 0, h - 0.02, 0, shade(c, 0.8));
    p.cyl(w / 2 - 0.03, 0.01, 0, h - 0.09, 0, 0x4a4436, w / 2 - 0.03, 16);
    p.ring(w / 2 - 0.02, 0.006, 0, h - 0.02, 0, DARK_STEEL, 'z', Math.PI);
    p.ring(w * 0.38 + 0.004, 0.008, 0, h * 0.35, 0, shade(c, 0.85));
  },
  pallet(p, [w, h, d], c) {
    const board = h * 0.2;
    for (let i = 0; i < 6; i++) p.box(w, board, d / 8, 0, h - board, -d / 2 + d / 16 + (i * (d - d / 8)) / 5, shade(c, 1 + (i % 2) * 0.08));
    for (const z of [-d / 2 + 0.05, 0, d / 2 - 0.05]) p.box(w, board, 0.1, 0, 0, z, shade(c, 0.9));
    for (const x of [-w / 2 + 0.07, 0, w / 2 - 0.07]) for (const z of [-d / 2 + 0.07, 0, d / 2 - 0.07]) p.box(0.13, h - board * 2, 0.13, x, board, z, shade(c, 0.75));
  },
  chair(p, [w, h, d], c) {
    for (const r of [0, Math.PI / 2.5, (2 * Math.PI) / 2.5, (3 * Math.PI) / 2.5, (4 * Math.PI) / 2.5]) {
      p.box(0.04, 0.03, w / 2 - 0.03, Math.sin(r) * (w / 4 - 0.015), 0.04, Math.cos(r) * (w / 4 - 0.015), BLACK, 0, r, 0);
      p.sphere(0.025, Math.sin(r) * (w / 2 - 0.05), 0.025, Math.cos(r) * (w / 2 - 0.05), BLACK);
    }
    p.cyl(0.025, 0.36, 0, 0.06, 0, DARK_STEEL);
    p.box(w - 0.04, 0.08, d - 0.06, 0, 0.42, 0.02, c);
    p.box(w - 0.08, 0.42, 0.06, 0, h - 0.42, -d / 2 + 0.05, c);
    p.box(0.04, 0.38, 0.03, 0, 0.42, -d / 2 + 0.04, DARK_STEEL);
    for (const sx of [-1, 1]) {
      p.box(0.03, 0.18, 0.03, (sx * (w - 0.06)) / 2, 0.5, 0.02, DARK_STEEL);
      p.box(0.05, 0.03, 0.24, (sx * (w - 0.06)) / 2, 0.66, 0.02, BLACK);
    }
  },
  plant(p, [w, h], c) {
    p.cyl(w * 0.3, 0.36, 0, 0, 0, 0xb5653a, w * 0.42, 12);
    p.ring(w * 0.42, 0.02, 0, 0.36, 0, 0x9a5230);
    p.cyl(w * 0.4, 0.01, 0, 0.33, 0, 0x3b2a1c, w * 0.4, 12);
    p.cyl(0.025, h * 0.45, 0, 0.34, 0, 0x5a4026, 0.02, 6);
    const r = rng(7);
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const rad = r() * w * 0.25;
      const y = 0.55 + r() * (h - 0.75);
      p.blob(0.09 + r() * 0.06, 0.1 + r() * 0.08, 0.09 + r() * 0.06, Math.cos(a) * rad, y, Math.sin(a) * rad, shade(c, 0.8 + r() * 0.5));
    }
  },
  cooler(p, [w, h], c) {
    const body = w - 0.04;
    p.box(body, h - 0.32, body, 0, 0, 0, WHITE);
    p.box(body * 0.7, 0.2, 0.03, 0, h * 0.45, body / 2, 0x2f3438);
    p.cyl(0.012, 0.05, -0.05, h * 0.52, body / 2 + 0.02, 0x2a6fdb);
    p.cyl(0.012, 0.05, 0.05, h * 0.52, body / 2 + 0.02, 0xd23a2a);
    p.box(body * 0.6, 0.02, 0.08, 0, h * 0.44, body / 2, DARK_STEEL);
    p.cyl(w / 2 - 0.04, 0.24, 0, h - 0.32, 0, c, w / 2 - 0.04, 16);
    p.cyl(w / 2 - 0.04, 0.05, 0, h - 0.08, 0, c, 0.05, 16);
    p.cyl(0.05, 0.03, 0, h - 0.03, 0, 0x2a6fdb);
    for (const y of [h - 0.26, h - 0.16]) p.ring(w / 2 - 0.035, 0.008, 0, y, 0, shade(c, 0.8));
  },
  desk(p, [w, h, d], c) {
    p.box(w, 0.04, d, 0, h - 0.04, 0, c);
    p.box(w + 0.01, 0.015, d + 0.01, 0, h - 0.055, 0, shade(c, 0.7));
    const leg = DARK_STEEL;
    p.box(0.04, h - 0.04, d - 0.1, -w / 2 + 0.04, 0, 0, leg);
    p.box(0.04, 0.03, d - 0.06, -w / 2 + 0.04, 0, 0, leg);
    p.box(w - 0.1, h * 0.5, 0.02, 0, h * 0.4, -d / 2 + 0.04, shade(c, 0.8));
    // Drawer pedestal on the right.
    const pw = 0.42;
    const px = w / 2 - pw / 2 - 0.02;
    p.box(pw, h - 0.06, d - 0.08, px, 0.02, -0.02, shade(c, 0.92));
    for (let i = 0; i < 3; i++) {
      const y = 0.06 + i * 0.22;
      p.box(pw - 0.04, 0.19, 0.015, px, y, d / 2 - 0.05, shade(c, 1.08));
      p.box(0.12, 0.02, 0.02, px, y + 0.15, d / 2 - 0.035, DARK_STEEL);
    }
  },
  cabinet(p, [w, h, d], c) {
    p.box(w, h, d - 0.02, 0, 0, -0.01, c);
    const n = 4;
    const dh = (h - 0.08) / n;
    for (let i = 0; i < n; i++) {
      const y = 0.05 + i * dh;
      p.box(w - 0.05, dh - 0.03, 0.02, 0, y, d / 2 - 0.01, shade(c, 1.1));
      p.box(0.16, 0.025, 0.03, 0, y + dh * 0.62, d / 2, DARK_STEEL);
      p.box(0.09, 0.04, 0.004, 0, y + dh * 0.78, d / 2 + 0.002, WHITE);
    }
    p.box(w, 0.02, d, 0, h - 0.02, 0, shade(c, 0.8));
  },
  toolbox(p, [w, h, d], c) {
    p.box(w, h * 0.62, d, 0, 0, 0, c);
    p.box(w + 0.01, h * 0.08, d + 0.01, 0, h * 0.6, 0, shade(c, 0.7));
    p.box(w - 0.02, h * 0.18, d - 0.02, 0, h * 0.67, 0, shade(c, 1.05));
    for (const sx of [-1, 1]) {
      p.box(0.025, h * 0.15, 0.025, sx * w * 0.22, h * 0.85, 0, BLACK);
      p.box(0.05, 0.04, 0.012, sx * w * 0.32, h * 0.5, d / 2, STEEL);
    }
    p.box(w * 0.5, 0.03, 0.035, 0, h - 0.03, 0, BLACK);
    p.box(w * 0.85, 0.02, 0.004, 0, h * 0.25, d / 2 + 0.001, shade(c, 0.75));
  },
  gasCan(p, [w, h, d], c) {
    const body = h * 0.82;
    p.box(w, body, d, 0, 0, 0, c);
    for (const sz of [-1, 1]) {
      p.box(Math.hypot(w, body) * 0.75, 0.03, 0.01, 0, body / 2 - 0.015, (sz * d) / 2, shade(c, 0.8), 0, 0, Math.atan2(body, w));
      p.box(Math.hypot(w, body) * 0.75, 0.03, 0.01, 0, body / 2 - 0.015, (sz * d) / 2, shade(c, 0.8), 0, 0, -Math.atan2(body, w));
    }
    for (const x of [-w * 0.3, 0, w * 0.3]) p.box(0.03, h - body, 0.03, x * 0.6 - 0.04, body, 0, shade(c, 0.85));
    p.box(w * 0.45, 0.03, 0.04, -0.04, h - 0.03, 0, shade(c, 0.85));
    p.cyl(0.03, 0.06, w / 2 - 0.05, body, 0, DARK_STEEL);
    p.cyl(0.035, 0.03, w / 2 - 0.05, body + 0.05, 0, BLACK);
  },
  extinguisher(p, [w, h], c) {
    const r = w / 2 - 0.02;
    p.cyl(r, h * 0.78, 0, 0, 0, c, r, 16);
    p.sphere(r, 0, h * 0.78, 0, c, 0.5);
    p.box(0.1, 0.04, 0.008, 0, h * 0.45, r, WHITE);
    p.cyl(0.025, 0.06, 0, h * 0.82, 0, DARK_STEEL);
    p.box(0.035, 0.05, 0.05, 0, h * 0.88, 0, BLACK);
    p.box(0.02, 0.015, 0.12, 0, h - 0.04, -0.02, BLACK, -0.25, 0, 0);
    p.box(0.02, 0.012, 0.1, 0, h * 0.95, -0.03, STEEL);
    p.cyl(0.012, h * 0.55, r + 0.01, h * 0.25, 0, BLACK, 0.012, 6);
    p.cyl(0.02, 0.06, r + 0.01, h * 0.2, 0, BLACK, 0.012, 6);
  },
  sack(p, [w, h, d], c) {
    p.blob(w / 2 - 0.03, h / 2, d / 2, 0, h / 2, 0, c);
    for (const sx of [-1, 1]) p.blob(0.05, 0.06, 0.08, sx * (w / 2 - 0.04), h * 0.55, 0, shade(c, 0.85));
    p.box(w * 0.5, 0.005, d * 0.6, 0, h - 0.01, 0, shade(c, 0.75));
    p.box(w * 0.15, 0.006, d * 0.6, w * 0.1, h - 0.008, 0, 0x8a3a2a);
  },
  spool(p, [w, h], c) {
    const R = w / 2;
    for (const y of [0, h - 0.06]) {
      p.cyl(R, 0.06, 0, y, 0, c, R, 20);
      p.ring(R * 0.7, 0.012, 0, y + (y ? 0.06 : 0), 0, shade(c, 0.75));
    }
    p.cyl(R * 0.78, h - 0.14, 0, 0.07, 0, 0x22262a, R * 0.78, 20);
    for (let i = 1; i < 6; i++) p.ring(R * 0.78, 0.012, 0, 0.07 + (i * (h - 0.14)) / 6, 0, 0x34393f);
    p.cyl(0.08, 0.02, 0, h, 0, DARK_STEEL);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      p.cyl(0.02, 0.012, Math.cos(a) * R * 0.85, h, Math.sin(a) * R * 0.85, DARK_STEEL);
    }
  },
  forkPallet(p, size, c) {
    MODELS.pallet(p, [size[0], 0.15, size[2]], PROPS.pallet.color);
    const r = rng(11);
    const [w, h, d] = size;
    const bw = (w - 0.06) / 2;
    const bd = (d - 0.06) / 2;
    const bh = (h - 0.17) / 2;
    for (let lx = 0; lx < 2; lx++)
      for (let lz = 0; lz < 2; lz++)
        for (let ly = 0; ly < 2; ly++)
          p.box(bw - 0.02, bh - 0.01, bd - 0.02, -w / 2 + 0.03 + bw / 2 + lx * bw, 0.15 + ly * bh, -d / 2 + 0.03 + bd / 2 + lz * bd, shade(0xc8a26b, 0.85 + r() * 0.3));
    // Shrink wrap bands and a label.
    for (const y of [0.35, 0.75, 1.05]) p.box(w - 0.04, 0.05, d - 0.04, 0, y, 0, shade(c, 1.3));
    p.box(0.3, 0.2, 0.005, -w * 0.2, 0.5, d / 2 - 0.015, WHITE);
  },
  trashCan(p, [w, h], c) {
    p.cyl(w * 0.4, h - 0.04, 0, 0, 0, c, w / 2 - 0.01, 14);
    p.cyl(w / 2, 0.04, 0, h - 0.04, 0, shade(c, 0.8), w / 2 - 0.02, 14);
    p.box(w * 0.4, 0.015, 0.1, 0, h - 0.005, 0.03, BLACK);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      p.box(0.012, h * 0.7, 0.012, Math.cos(a) * w * 0.43, h * 0.12, Math.sin(a) * w * 0.43, shade(c, 0.75));
    }
  },
  monitor(p, [w, h, d], c) {
    p.box(0.22, 0.015, d - 0.02, 0, 0, -0.01, c);
    p.box(0.04, 0.12, 0.03, 0, 0.015, -0.04, shade(c, 1.3));
    p.box(w, h - 0.08, 0.03, 0, 0.08, 0, c);
    p.box(w - 0.04, h - 0.12, 0.004, 0, 0.1, 0.016, 0x2a4f7a);
    p.box(w - 0.1, 0.03, 0.005, -0.02, h - 0.1, 0.017, 0x4f86c6);
    p.box(w * 0.4, 0.05, 0.005, -0.06, 0.2, 0.017, 0x3a6ea8);
    p.box(0.015, 0.01, 0.005, w / 2 - 0.05, 0.085, 0.016, 0x3ddc84);
  },
  printer(p, [w, h, d], c) {
    p.box(w, h * 0.7, d, 0, 0, 0, c);
    p.box(w - 0.02, h * 0.22, d - 0.06, 0, h * 0.7, -0.03, shade(c, 0.85));
    p.box(w * 0.7, 0.01, d * 0.5, 0, h * 0.92, -0.05, WHITE);
    p.box(w * 0.7, 0.03, 0.02, 0, h * 0.4, d / 2, BLACK);
    p.box(w * 0.6, 0.008, 0.12, 0, h * 0.38, d / 2 - 0.05, WHITE);
    p.box(0.14, 0.05, 0.03, w / 2 - 0.1, h * 0.68, d / 2 - 0.01, 0x30363b);
    p.box(0.02, 0.012, 0.005, w / 2 - 0.15, h * 0.71, d / 2 + 0.006, 0x3ddc84);
    p.box(w - 0.04, 0.012, 0.005, 0, h * 0.15, d / 2, shade(c, 0.7));
  },
  floorLamp(p, [w, h], c) {
    p.cyl(w / 2 - 0.02, 0.03, 0, 0, 0, DARK_STEEL, w / 2 - 0.04, 16);
    p.cyl(0.012, h - 0.35, 0, 0.03, 0, DARK_STEEL, 0.012, 6);
    p.cyl(w / 2, 0.3, 0, h - 0.32, 0, c, w * 0.3, 16);
    p.cyl(w * 0.3, 0.02, 0, h - 0.04, 0, shade(c, 0.85), w * 0.3, 16);
    p.sphere(0.05, 0, h - 0.22, 0, 0xfff3c4);
  },
  copier(p, [w, h, d], c) {
    p.box(w, h * 0.55, d, 0, 0, 0, shade(c, 0.9));
    for (let i = 0; i < 2; i++) {
      p.box(w - 0.06, h * 0.22, 0.015, 0, 0.04 + i * h * 0.25, d / 2, c);
      p.box(0.25, 0.025, 0.02, 0, 0.04 + i * h * 0.25 + h * 0.17, d / 2 + 0.01, DARK_STEEL);
    }
    p.box(w, h * 0.32, d, 0, h * 0.55, 0, c);
    p.box(w - 0.02, h * 0.08, d - 0.02, 0, h * 0.87, 0, shade(c, 0.75));
    p.box(0.32, 0.06, 0.16, w / 2 - 0.2, h * 0.87, d / 2 - 0.06, 0x30363b, -0.3, 0, 0);
    p.box(0.1, 0.04, 0.005, w / 2 - 0.2, h * 0.9, d / 2 - 0.0, 0x4f86c6);
    p.box(0.28, 0.02, d * 0.6, -w / 2 - 0.0 + 0.14, h * 0.62, 0, WHITE);
    p.box(0.25, 0.04, d * 0.5, -w / 2 + 0.14, h * 0.58, 0, shade(c, 0.7));
    p.box(0.04, 0.03, 0.04, 0, 0, 0, BLACK);
  },
  sofa(p, [w, h, d], c) {
    p.box(w, 0.2, d, 0, 0.06, 0, shade(c, 0.75));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.06, 0.06, 0.06, (sx * (w - 0.12)) / 2, 0, (sz * (d - 0.12)) / 2, BLACK);
    const arm = 0.18;
    for (const sx of [-1, 1]) p.box(arm, h * 0.72, d, (sx * (w - arm)) / 2, 0.06, 0, c);
    const seat = (w - arm * 2) / 3;
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + arm + seat / 2 + i * seat;
      p.box(seat - 0.02, 0.16, d - 0.24, x, 0.26, 0.08, shade(c, 1.12));
      p.box(seat - 0.03, h - 0.36, 0.2, x, 0.36, -d / 2 + 0.2, shade(c, 1.05), -0.12, 0, 0);
    }
    p.box(w - arm * 2, h - 0.26, 0.14, 0, 0.26, -d / 2 + 0.07, c);
  },
  bookshelf(p, [w, h, d], c) {
    const t = 0.03;
    for (const sx of [-1, 1]) p.box(t, h, d, (sx * (w - t)) / 2, 0, 0, c);
    p.box(w, t, d, 0, h - t, 0, c);
    p.box(w - t * 2, h, 0.01, 0, 0, -d / 2 + 0.005, shade(c, 0.6));
    const shelves = 5;
    const sh = (h - t) / shelves;
    const r = rng(3);
    const books = [0x8e2b2b, 0x2b4f8e, 0x2f6b3a, 0xc9a24a, 0x6b3a8e, 0xd8d0bf, 0x3a3a3a, 0xb5562b];
    for (let i = 0; i < shelves; i++) {
      const y = i * sh;
      p.box(w - t * 2, t, d - 0.01, 0, y, 0.005, shade(c, 0.9));
      if (i === 0) continue;
      let x = -w / 2 + t + 0.02;
      while (x < w / 2 - t - 0.06) {
        const bw = 0.025 + r() * 0.035;
        if (r() < 0.12) {
          x += bw + 0.05;
          continue;
        }
        const bh = sh * (0.55 + r() * 0.35);
        p.box(bw, bh, d * (0.6 + r() * 0.25), x + bw / 2, y + t, 0.02, books[Math.floor(r() * books.length)]);
        x += bw + 0.003;
      }
    }
    p.box(w - t * 2, sh - t, d - 0.04, 0, t, 0, shade(c, 0.45));
  },
  gasBottle(p, [w, h], c) {
    const r = w / 2 - 0.02;
    p.cyl(r, h * 0.78, 0, 0.02, 0, c, r, 16);
    p.cyl(r - 0.01, 0.02, 0, 0, 0, BLACK, r - 0.01, 16);
    p.sphere(r, 0, h * 0.8, 0, c, 0.55);
    p.cyl(r + 0.004, 0.08, 0, h * 0.6, 0, WHITE, r + 0.004, 16);
    p.cyl(0.04, 0.08, 0, h * 0.85, 0, 0xc0a040);
    p.cyl(0.08, 0.08, 0, h * 0.88, 0, DARK_STEEL, 0.07, 12);
    p.box(0.03, 0.03, 0.08, 0, h - 0.05, 0.03, 0xc0a040);
  },
  sandbag(p, [w, h, d], c) {
    p.blob(w / 2 - 0.02, h / 2, d / 2 - 0.02, 0, h / 2, 0, c);
    p.blob(0.06, 0.05, d * 0.3, w / 2 - 0.06, h * 0.45, 0, shade(c, 0.8));
    p.box(0.01, 0.01, d * 0.7, -w * 0.15, h - 0.015, 0, shade(c, 0.7));
  },
  barrier(p, [w, h, d], c) {
    for (const sx of [-1, 1]) {
      const x = (sx * (w - 0.08)) / 2;
      p.box(0.05, h, 0.05, x, 0, 0, STEEL, 0.25, 0, 0);
      p.box(0.05, h, 0.05, x, 0, 0, STEEL, -0.25, 0, 0);
      p.box(0.06, 0.04, d, x, 0, 0, BLACK);
    }
    for (const y of [h * 0.45, h * 0.8]) {
      const n = 6;
      for (let i = 0; i < n; i++) p.box(w / n, 0.14, 0.03, -w / 2 + w / n / 2 + (i * w) / n, y - 0.07, 0, i % 2 ? WHITE : c);
    }
    p.box(0.08, 0.06, 0.06, 0, h - 0.06, 0, 0xffb020);
  },
  block(p, [w, h, d], c) {
    p.box(w, h, d, 0, 0, 0, c);
    for (const sx of [-1, 1]) p.box(w * 0.32, 0.005, d * 0.55, (sx * w) / 4, h, 0, shade(c, 0.45));
    p.box(w + 0.004, 0.01, d + 0.004, 0, h * 0.5, 0, shade(c, 0.88));
    p.box(w * 0.2, h * 0.3, 0.004, w * 0.2, h * 0.15, d / 2, shade(c, 0.8));
  },
  generator(p, [w, h, d], c) {
    const tube = 0.035;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(tube, h, tube, (sx * (w - tube)) / 2, 0, (sz * (d - tube)) / 2, BLACK);
    for (const y of [0.08, h - tube]) {
      for (const sz of [-1, 1]) p.box(w, tube, tube, 0, y, (sz * (d - tube)) / 2, BLACK);
      for (const sx of [-1, 1]) p.box(tube, tube, d, (sx * (w - tube)) / 2, y, 0, BLACK);
    }
    p.box(w * 0.45, h * 0.45, d * 0.7, -w * 0.18, 0.12, 0, DARK_STEEL);
    p.box(w * 0.35, h * 0.4, d * 0.7, w * 0.22, 0.12, 0, c);
    p.box(w * 0.8, h * 0.25, d * 0.75, 0, h * 0.6, 0, c);
    p.cyl(0.05, 0.05, w * 0.25, h * 0.85, 0, BLACK);
    p.box(0.25, 0.18, 0.02, w * 0.22, 0.25, d * 0.35, 0x30363b);
    for (const x of [0.15, 0.22, 0.29]) p.cyl(0.015, 0.02, w * 0.22 - 0.22 + x, 0.33, d * 0.36 + 0.01, x === 0.22 ? 0xd23a2a : 0xe0e0e0, 0.015, 8);
    p.lying('x', 0.04, 0.2, -w * 0.18, h * 0.4, d * 0.38, STEEL);
    for (const sx of [-1, 1]) p.lying('z', 0.08, 0.05, (sx * w) / 3, 0.08, d / 2 - 0.03, BLACK);
  },

  vending(p, [w, h, d], c) {
    p.box(w, h, d - 0.02, 0, 0, -0.01, c);
    p.box(w * 0.66, h * 0.62, 0.02, -w * 0.12, h * 0.3, d / 2 - 0.01, 0x1b2a33);
    const r = rng(5);
    const goods = [0xd23a2a, 0x2a6fdb, 0xf1c40f, 0x3ddc84, 0xe67e22, 0xffffff, 0x8e44ad];
    for (let row = 0; row < 5; row++) {
      const y = h * 0.33 + row * h * 0.115;
      p.box(w * 0.62, 0.01, 0.15, -w * 0.12, y - 0.01, d / 2 - 0.09, STEEL);
      for (let i = 0; i < 6; i++) {
        const x = -w * 0.12 - w * 0.28 + i * w * 0.11;
        p.cyl(0.03, 0.12, x, y, d / 2 - 0.07, goods[Math.floor(r() * goods.length)], 0.03, 8);
      }
    }
    p.box(w * 0.2, h * 0.3, 0.02, w * 0.36, h * 0.45, d / 2 - 0.01, 0x2a2e33);
    p.box(0.1, 0.06, 0.01, w * 0.36, h * 0.65, d / 2, 0x3ddc84);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) p.box(0.03, 0.03, 0.01, w * 0.32 + i * 0.04, h * 0.52 + j * 0.04, d / 2, STEEL);
    p.box(w * 0.5, 0.12, 0.03, -w * 0.12, h * 0.12, d / 2 - 0.01, BLACK);
    p.box(w * 0.9, h * 0.08, 0.02, 0, h * 0.92, d / 2 - 0.01, shade(c, 1.4));
  },
  whiteboard(p, [w, h, d], c) {
    for (const sx of [-1, 1]) {
      const x = (sx * (w - 0.04)) / 2;
      p.box(0.04, h - 0.05, 0.04, x, 0.05, 0, STEEL);
      p.box(0.05, 0.03, d - 0.04, x, 0.05, 0, DARK_STEEL);
      for (const sz of [-1, 1]) p.cyl(0.025, 0.05, x, 0, (sz * (d - 0.08)) / 2, BLACK);
    }
    p.box(w - 0.08, h * 0.55, 0.03, 0, h * 0.4, 0, STEEL);
    p.box(w - 0.12, h * 0.55 - 0.04, 0.005, 0, h * 0.4 + 0.02, 0.016, c);
    p.box(w - 0.12, 0.03, 0.08, 0, h * 0.4 - 0.02, 0.04, STEEL);
    const marks: [number, number, number, number][] = [[-0.4, 0.82, 0.5, 0x2a6fdb], [-0.45, 0.75, 0.3, 0x2a6fdb], [0.1, 0.8, 0.35, 0xd23a2a], [-0.3, 0.62, 0.6, 0x222222], [0.25, 0.58, 0.25, 0x3a8f4e]];
    for (const [x, y, len, col] of marks) p.box(len, 0.012, 0.003, x, h * y, 0.019, col);
    p.box(0.1, 0.015, 0.015, 0.4, h * 0.4 + 0.01, 0.05, 0xd23a2a);
  },
  paintCan(p, [w, h], c) {
    const r = w / 2 - 0.01;
    p.cyl(r, h - 0.01, 0, 0, 0, STEEL, r, 16);
    p.cyl(r + 0.002, h * 0.55, 0, h * 0.2, 0, WHITE, r + 0.002, 16);
    p.cyl(r + 0.004, h * 0.2, 0, h * 0.32, 0, c, r + 0.004, 16);
    p.cyl(r - 0.02, 0.012, 0, h - 0.01, 0, c, r - 0.02, 16);
    p.ring(r, 0.008, 0, h - 0.005, 0, DARK_STEEL);
    p.ring(r, 0.005, 0, h - 0.01, 0, DARK_STEEL, 'x', Math.PI);
    p.box(0.03, h * 0.3, 0.01, r * 0.7, h * 0.7, r * 0.7, c, 0, Math.PI / 4, 0);
  },
  wheelbarrow(p, [w, h, d], c) {
    p.ring(0.17, 0.05, 0, 0.22, d / 2 - 0.22, BLACK, 'x');
    p.lying('x', 0.06, 0.12, 0, 0.22, d / 2 - 0.22, STEEL);
    p.box(w - 0.04, 0.05, d * 0.5, 0, 0.32, 0.05, c);
    p.box(w - 0.04, 0.24, 0.04, 0, 0.34, 0.05 + d * 0.25, c, -0.5, 0, 0);
    p.box(w - 0.04, 0.22, 0.04, 0, 0.34, 0.05 - d * 0.25, c, 0.4, 0, 0);
    for (const sx of [-1, 1]) {
      p.box(0.04, 0.22, d * 0.5, (sx * (w - 0.06)) / 2, 0.34, 0.05, c, 0, 0, sx * 0.25);
      p.box(0.04, 0.04, d - 0.1, sx * (w / 2 - 0.12), 0.26, -0.05, DARK_STEEL, -0.12, 0, 0);
      p.box(0.035, 0.32, 0.035, sx * (w / 2 - 0.15), 0, -d * 0.18, DARK_STEEL);
      p.box(0.05, 0.05, 0.14, sx * (w / 2 - 0.12), 0.34, -d / 2 + 0.07, BLACK);
    }
    p.box(w * 0.7, 0.03, d * 0.35, 0, 0.36, 0.05, 0x6b5a45);
  },
  pipes(p, [w, h, d], c) {
    const r = 0.14;
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) p.box(0.12, 0.08, d, x, 0, 0, WOOD);
    const rows: [number, number[]][] = [[0.08 + r, [-0.3, 0, 0.3]], [0.08 + r * 2.7, [-0.15, 0.15]]];
    for (const [y, zs] of rows) {
      for (const z of zs) {
        p.lying('x', r, w - 0.02, 0, y, z, c, 12);
        for (const sx of [-1, 1]) p.lying('x', r * 0.72, 0.01, (sx * (w - 0.01)) / 2, y, z, 0x24282c, 12);
      }
    }
    p.box(0.04, h - 0.05, 0.04, w / 2 - 0.2, 0.05, d / 2 - 0.02, WOOD);
    p.box(0.04, h - 0.05, 0.04, w / 2 - 0.2, 0.05, -d / 2 + 0.02, WOOD);
  },
  handTruck(p, [w, h, d], c) {
    for (const sx of [-1, 1]) {
      p.box(0.035, h - 0.05, 0.035, (sx * (w - 0.1)) / 2, 0.05, -d / 2 + 0.1, c);
      p.lying('x', 0.1, 0.05, (sx * (w - 0.06)) / 2, 0.1, -d / 2 + 0.1, BLACK);
    }
    for (const y of [0.4, 0.8, h - 0.05]) p.box(w - 0.1, 0.03, 0.03, 0, y, -d / 2 + 0.1, c);
    p.box(w - 0.08, 0.02, 0.22, 0, 0.02, -d / 2 + 0.2, DARK_STEEL);
    p.lying('x', 0.015, w - 0.1, 0, 0.1, -d / 2 + 0.1, STEEL);
    p.box(w - 0.2, 0.06, 0.04, 0, h - 0.06, -d / 2 + 0.12, BLACK);
    p.box(w - 0.16, 0.4, 0.3, 0, 0.04, -d / 2 + 0.3, 0xc8a26b);
    p.box(w - 0.18, 0.3, 0.26, 0, 0.44, -d / 2 + 0.28, shade(0xc8a26b, 0.85));
  },
  archiveBox(p, [w, h, d], c) {
    p.box(w - 0.01, h - 0.04, d - 0.01, 0, 0, 0, c);
    p.box(w, 0.06, d, 0, h - 0.06, 0, shade(c, 0.92));
    for (const sx of [-1, 1]) p.box(0.004, 0.025, 0.08, (sx * (w - 0.01)) / 2, h * 0.65, 0, BLACK);
    p.box(w * 0.5, h * 0.25, 0.004, 0, h * 0.25, d / 2 - 0.004, WHITE);
    p.box(w * 0.3, 0.008, 0.005, 0, h * 0.4, d / 2, 0x2a6fdb);
  },
  coffeeTable(p, [w, h, d], c) {
    p.box(w, 0.04, d, 0, h - 0.04, 0, c);
    p.box(w - 0.08, 0.02, d - 0.08, 0, 0.1, 0, shade(c, 0.8));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.04, h - 0.04, 0.04, (sx * (w - 0.08)) / 2, 0, (sz * (d - 0.08)) / 2, shade(c, 0.6));
    p.box(0.22, 0.01, 0.28, -0.2, h, 0.03, 0xd23a2a, 0, 0.2, 0);
    p.box(0.2, 0.01, 0.27, -0.18, h + 0.01, 0.0, WHITE, 0, -0.1, 0);
    p.cyl(0.035, 0.08, 0.25, h, -0.05, WHITE);
    p.box(0.3, 0.04, 0.22, 0.1, 0.12, 0, 0x2b4f8e);
  },
  microwave(p, [w, h, d], c) {
    p.box(w, h, d, 0, 0, 0, c);
    p.box(w * 0.65, h * 0.75, 0.01, -w * 0.12, h * 0.12, d / 2, 0x1f2428);
    p.box(w * 0.5, h * 0.55, 0.004, -w * 0.12, h * 0.22, d / 2 + 0.006, 0x3a3226);
    p.box(w * 0.22, h * 0.75, 0.01, w * 0.36, h * 0.12, d / 2, shade(c, 0.6));
    p.box(w * 0.14, 0.04, 0.006, w * 0.36, h * 0.72, d / 2 + 0.006, 0x3ddc84);
    for (let i = 0; i < 4; i++) p.box(w * 0.14, 0.02, 0.006, w * 0.36, h * 0.25 + i * 0.05, d / 2 + 0.006, STEEL);
    p.box(0.02, h * 0.6, 0.03, w * 0.2, h * 0.2, d / 2 + 0.01, STEEL);
  },
  serverRack(p, [w, h, d], c) {
    p.box(w, h, d - 0.04, 0, 0, -0.02, c);
    p.box(w + 0.01, 0.08, d, 0, h - 0.08, 0, shade(c, 0.7));
    const r = rng(9);
    const units = 14;
    const uh = (h - 0.3) / units;
    for (let i = 0; i < units; i++) {
      const y = 0.12 + i * uh;
      if (r() < 0.15) continue;
      p.box(w - 0.08, uh - 0.015, 0.01, 0, y, d / 2 - 0.02, shade(c, 1.5 + r() * 0.5));
      p.box(w * 0.4, 0.01, 0.006, -w * 0.1, y + uh * 0.45, d / 2 - 0.012, BLACK);
      for (let k = 0; k < 3; k++) {
        const on = r();
        p.box(0.012, 0.012, 0.006, w * 0.25 + k * 0.03, y + uh * 0.4, d / 2 - 0.012, on < 0.6 ? 0x3ddc84 : on < 0.85 ? 0x2a9fdb : 0xf39c12);
      }
    }
    for (const sx of [-1, 1]) p.box(0.02, h - 0.1, 0.02, (sx * (w - 0.03)) / 2, 0.02, d / 2 - 0.01, STEEL);
    p.box(w, 0.04, d, 0, 0, 0, BLACK);
  },
  dumpster(p, [w, h, d], c) {
    p.box(w - 0.1, h - 0.25, d - 0.1, 0, 0.15, -0.02, c);
    p.box(w, 0.1, d - 0.05, 0, h - 0.18, 0, shade(c, 0.8));
    for (const sx of [-1, 1]) p.box(w / 2 - 0.02, 0.06, d - 0.02, (sx * w) / 4, h - 0.08, 0.01, BLACK, -0.05, 0, 0);
    for (const sx of [-1, 1]) {
      p.box(0.08, h * 0.6, 0.08, (sx * (w - 0.1)) / 2, 0.15, d / 2 - 0.06, shade(c, 0.75));
      for (const sz of [-1, 1]) p.lying('x', 0.07, 0.05, (sx * (w - 0.3)) / 2, 0.07, (sz * (d - 0.3)) / 2, BLACK);
    }
    for (let i = 0; i < 5; i++) p.box(0.05, h * 0.55, 0.02, -w * 0.3 + i * w * 0.15, 0.25, d / 2 - 0.05, shade(c, 0.85));
    p.box(0.4, 0.12, 0.006, 0, h * 0.55, d / 2 - 0.035, WHITE);
  },
};

const geometries = new Map<string, THREE.BufferGeometry>();

/** The detailed geometry for a prop type, shared by every mesh of that type. */
export function propModel(type: string): THREE.BufferGeometry {
  let geo = geometries.get(type);
  if (!geo) {
    const def = PROPS[type];
    const p = new Parts();
    const model = MODELS[type];
    if (model) model(p, [...def.size], def.color);
    else p.box(def.size[0], def.size[1], def.size[2], 0, 0, 0, def.color);
    geo = p.merge();
    geometries.set(type, geo);
  }
  return geo;
}

export const hasModel = (type: string) => type in MODELS;

/** How a rack wall is drawn, from its height: tall pallet racking, general shelving or small-parts shelving. */
export type RackStyle = 'pallet' | 'general' | 'parts';
export const rackStyle = (height: number): RackStyle => (height >= 4 ? 'pallet' : height <= 2.6 ? 'parts' : 'general');

/** Upright and beam colors for general shelving, one pair per row so rows look like they came from different orders. */
const GENERAL_FRAMES: [number, number][] = [[0xd8742a, 0x2f6db5], [0x3a8f4e, 0xe0b020], [0x7a838c, 0xc0392b], [0x2f6db5, 0xd8742a]];
/** What a row of general shelving holds. */
const GENERAL_GOODS: { colors: number[]; drums: number }[] = [
  { colors: [0xc8a26b, 0xb8925b, 0xd6b47c, 0x9c7a4c], drums: 0 }, // cartons
  { colors: [0x3d6e8f, 0x2e5a75, 0xc0392b], drums: 0.7 }, // drums and chemicals
  { colors: [0xd8c9a0, 0xc9b98a, 0xe6dcc0], drums: 0 }, // sacks
  { colors: [0xc8a26b, 0x3d6e8f, 0xd8c9a0, 0x7d8f69, 0xe6e2d8], drums: 0.15 }, // mixed
];
const BINS = [0x2a6fdb, 0x2a6fdb, 0xc0392b, 0xe0b020, 0x7a838c, 0x3a8f4e];

/**
 * Warehouse shelving, one merged geometry for every rack on a map. Each rack's
 * style comes from its height (see `rackStyle`), and general shelving varies
 * its frame color and goods by row, so the hall doesn't repeat one rack.
 */
export function rackModel(walls: Box[], seed: number): THREE.BufferGeometry {
  const p = new Parts();
  for (const w of walls) {
    const alongZ = w.max[2] - w.min[2] > w.max[0] - w.min[0];
    const len = alongZ ? w.max[2] - w.min[2] : w.max[0] - w.min[0];
    const depth = alongZ ? w.max[0] - w.min[0] : w.max[2] - w.min[2];
    const h = w.max[1];
    const cx = (w.min[0] + w.max[0]) / 2;
    const cz = (w.min[2] + w.max[2]) / 2;
    const r = rng(seed + Math.round(cx * 7 + cz * 131));
    // Local (u along the rack, v across it) to world.
    const at = (u: number, v: number): [number, number] => (alongZ ? [cx + v, cz + u] : [cx + u, cz + v]);
    const box = (lu: number, hy: number, lv: number, u: number, y: number, v: number, color: number) => {
      const [x, z] = at(u, v);
      if (alongZ) p.box(lv, hy, lu, x, y, z, color);
      else p.box(lu, hy, lv, x, y, z, color);
    };
    const style = rackStyle(h);
    // Rows share a frame and goods: pick by the row's line, not the segment.
    const row = Math.abs(Math.round(alongZ ? cx : cz));
    const [upright, beam] = style === 'pallet' ? [0x2f5fa5, 0xe8742a] : style === 'parts' ? [0xa7b0b8, 0xa7b0b8] : GENERAL_FRAMES[row % GENERAL_FRAMES.length];
    const bayLen = style === 'pallet' ? 2.7 : style === 'parts' ? 1.1 : 2.5;
    const bays = Math.max(1, Math.round(len / bayLen));
    const bay = len / bays;
    const levels = style === 'pallet' ? [0, 1.45, 2.85, h - 0.1] : style === 'parts' ? [0.1, 0.55, 1.0, 1.45, 1.9, h - 0.05] : [0.1, 1.1, 2.1, h - 0.08];
    const gd = depth / 2 - 0.12;

    box(len - 0.1, h - 0.1, 0.04, 0, 0.05, 0, style === 'parts' ? 0x8e969c : 0x3a3f44);
    for (let i = 0; i <= bays; i++) {
      const u = -len / 2 + i * bay + (i === 0 ? 0.05 : i === bays ? -0.05 : 0);
      const t = style === 'parts' ? 0.05 : 0.09;
      for (const sv of [-1, 1]) {
        box(t, h, t, u, 0, (sv * (depth - t)) / 2, upright);
        // Yellow-and-black guards at the foot of pallet rack uprights.
        if (style === 'pallet') box(0.14, 0.4, 0.14, u, 0, (sv * (depth - 0.14)) / 2, i % 2 ? 0xe0b020 : 0x1c1d20);
      }
      if (style !== 'parts') for (let y = 0.4; y < h - 0.3; y += 0.9) box(0.03, 0.03, depth - 0.1, u, y, 0, upright);
    }
    for (const y of levels) {
      if (style === 'pallet' && y === 0) continue;
      for (const sv of [-1, 1]) box(len, style === 'pallet' ? 0.12 : 0.07, 0.05, 0, y, (sv * (depth - 0.05)) / 2, beam);
      box(len - 0.1, 0.03, depth - 0.1, 0, y + 0.04, 0, style === 'parts' ? 0xb8c0c8 : 0x8e969c);
    }

    const goods = GENERAL_GOODS[(row * 7 + Math.abs(Math.round(alongZ ? cz : cx))) % GENERAL_GOODS.length];
    for (let i = 0; i < bays; i++) {
      const u0 = -len / 2 + i * bay;
      for (let li = 0; li < levels.length - 1; li++) {
        const y = levels[li] + (style === 'pallet' && li === 0 ? 0 : 0.07);
        const space = levels[li + 1] - y - 0.1;
        for (const sv of [-1, 1]) {
          const v = sv * (gd / 2 + 0.06);
          if (style === 'pallet') {
            // Two pallets per bay, each with a load: cartons, wrapped goods or drums.
            for (let k = 0; k < 2; k++) {
              if (r() < 0.18) continue;
              const u = u0 + bay * (k ? 0.73 : 0.27);
              box(1.0, 0.12, gd, u, y, v, 0xb08850);
              const load = r();
              const lh = Math.min(space - 0.12, 0.7 + r() * 0.5);
              if (load < 0.5) {
                for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) box(0.46, lh * (0.8 + r() * 0.2), gd / 2 - 0.03, u - 0.24 + a * 0.48, y + 0.12, v - gd / 4 + c * (gd / 2), shade(0xc8a26b, 0.85 + r() * 0.3));
              } else if (load < 0.8) {
                box(0.96, lh, gd - 0.04, u, y + 0.12, v, shade(0xdfe4e8, 0.85 + r() * 0.15));
                box(0.97, 0.05, gd - 0.03, u, y + 0.12 + lh * 0.5, v, 0xc0392b);
              } else {
                for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) {
                  const [x, z] = at(u - 0.24 + a * 0.48, v - gd / 4 + c * (gd / 2));
                  p.cyl(0.22, Math.min(lh, 0.9), x, y + 0.12, z, 0x3d6e8f, 0.22, 10);
                }
              }
            }
          } else if (style === 'parts') {
            // Plastic bins in a row, with a white label on each.
            let u = u0 + 0.08;
            while (u < u0 + bay - 0.3) {
              const bw = 0.28 + r() * 0.14;
              if (u + bw > u0 + bay - 0.05) break;
              if (r() < 0.15) {
                u += bw;
                continue;
              }
              const bh = Math.min(space, 0.18 + r() * 0.12);
              const col = r() < 0.2 ? 0xc8a26b : BINS[Math.floor(r() * BINS.length)];
              box(bw - 0.03, bh, gd, u + bw / 2, y, v, col);
              box(bw * 0.5, 0.05, 0.005, u + bw / 2, y + bh * 0.45, sv * (gd + 0.065), 0xf2f2ee);
              u += bw;
            }
          } else {
            let u = u0 + 0.12;
            while (u < u0 + bay - 0.4) {
              const gw = 0.35 + r() * 0.5;
              if (u + gw > u0 + bay - 0.1) break;
              if (r() < 0.2) {
                u += gw;
                continue;
              }
              const gh = Math.min(space, 0.3 + r() * 0.55);
              const col = goods.colors[Math.floor(r() * goods.colors.length)];
              if (r() < goods.drums) {
                const [x, z] = at(u + 0.2, v);
                p.cyl(0.18, Math.min(space, 0.55 + r() * 0.3), x, y, z, col, 0.18, 10);
                u += 0.42;
                continue;
              }
              box(gw - 0.04, gh, gd, u + gw / 2, y, v, col);
              if (gh < space - 0.3 && r() < 0.5) box(gw * 0.6, Math.min(0.25, space - gh - 0.02), gd * 0.8, u + gw / 2, y + gh, v, shade(col, 1.1));
              u += gw;
            }
          }
        }
      }
    }
  }
  return p.merge();
}

/** Yellow safety lines on the floor along both sides of each rack. */
export function floorStripes(walls: Box[]): THREE.BufferGeometry {
  const p = new Parts();
  for (const w of walls) {
    const alongZ = w.max[2] - w.min[2] > w.max[0] - w.min[0];
    for (const side of [-1, 1]) {
      if (alongZ) {
        const x = side < 0 ? w.min[0] - 0.25 : w.max[0] + 0.25;
        p.box(0.1, 0.01, w.max[2] - w.min[2] + 0.5, x, 0.004, (w.min[2] + w.max[2]) / 2, 0xe0b020);
      } else {
        const z = side < 0 ? w.min[2] - 0.25 : w.max[2] + 0.25;
        p.box(w.max[0] - w.min[0] + 0.5, 0.01, 0.1, (w.min[0] + w.max[0]) / 2, 0.004, z, 0xe0b020);
      }
    }
  }
  return p.merge();
}

/** Wire-mesh fencing (a locked parts cage): posts, rails and a fine grid of wires. */
export function fenceModel(walls: Box[]): THREE.BufferGeometry {
  const p = new Parts();
  for (const w of walls) {
    const alongZ = w.max[2] - w.min[2] > w.max[0] - w.min[0];
    const len = alongZ ? w.max[2] - w.min[2] : w.max[0] - w.min[0];
    const h = w.max[1];
    const cx = (w.min[0] + w.max[0]) / 2;
    const cz = (w.min[2] + w.max[2]) / 2;
    const box = (lu: number, hy: number, lv: number, u: number, y: number, color: number) => {
      if (alongZ) p.box(lv, hy, lu, cx, y, cz + u, color);
      else p.box(lu, hy, lv, cx + u, y, cz, color);
    };
    const posts = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= posts; i++) box(0.07, h, 0.07, -len / 2 + (i * len) / posts, 0, 0x6a737d);
    for (const y of [0.05, h / 2, h - 0.06]) box(len, 0.05, 0.05, 0, y, 0x6a737d);
    for (let u = -len / 2 + 0.12; u < len / 2; u += 0.12) box(0.012, h - 0.1, 0.012, u, 0.05, 0x9aa3ad);
    for (let y = 0.2; y < h - 0.1; y += 0.15) box(len, 0.012, 0.012, 0, y, 0x9aa3ad);
  }
  return p.merge();
}

/**
 * Shipping containers in the yard: ribbed steel sides, doors with lock bars on
 * one end, and a frame along the edges. Tall walls are two stacked containers.
 */
export function containerModel(walls: Box[], colors: number[]): THREE.BufferGeometry {
  const p = new Parts();
  walls.forEach((w, i) => {
    const alongZ = w.max[2] - w.min[2] > w.max[0] - w.min[0];
    const len = alongZ ? w.max[2] - w.min[2] : w.max[0] - w.min[0];
    const wid = alongZ ? w.max[0] - w.min[0] : w.max[2] - w.min[2];
    const cx = (w.min[0] + w.max[0]) / 2;
    const cz = (w.min[2] + w.max[2]) / 2;
    const at = (u: number, v: number): [number, number] => (alongZ ? [cx + v, cz + u] : [cx + u, cz + v]);
    const box = (lu: number, hy: number, lv: number, u: number, y: number, v: number, color: number) => {
      const [x, z] = at(u, v);
      if (alongZ) p.box(lv, hy, lu, x, y, z, color);
      else p.box(lu, hy, lv, x, y, z, color);
    };
    const stack = Math.max(1, Math.round(w.max[1] / 2.6));
    const unit = w.max[1] / stack;
    for (let s = 0; s < stack; s++) {
      const c = colors[(i + s * 3) % colors.length];
      const y0 = s * unit;
      box(len - 0.04, unit - 0.04, wid - 0.04, 0, y0 + 0.02, 0, c);
      for (let u = -len / 2 + 0.25; u < len / 2 - 0.2; u += 0.3) {
        for (const sv of [-1, 1]) box(0.12, unit - 0.25, 0.03, u, y0 + 0.12, (sv * (wid - 0.03)) / 2, shade(c, 0.85));
      }
      for (const su of [-1, 1]) for (const sv of [-1, 1]) box(0.12, unit, 0.12, (su * (len - 0.12)) / 2, y0, (sv * (wid - 0.12)) / 2, shade(c, 0.6));
      for (const y of [y0, y0 + unit - 0.1]) for (const sv of [-1, 1]) box(len, 0.1, 0.1, 0, y, (sv * (wid - 0.1)) / 2, shade(c, 0.6));
      box(0.03, unit - 0.2, wid - 0.25, len / 2 - 0.015, y0 + 0.1, 0, shade(c, 0.9));
      for (const v of [-wid * 0.35, -wid * 0.12, wid * 0.12, wid * 0.35]) box(0.06, unit - 0.25, 0.04, len / 2, y0 + 0.12, v, STEEL);
      box(0.02, 0.3, 0.6, -len / 2 + 0.01, y0 + unit * 0.65, 0, WHITE);
    }
  });
  return p.merge();
}
