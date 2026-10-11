import * as THREE from 'three';
import { HUNTER_SIZE } from '../../shared/constants.ts';
import type { GameMap, Station } from '../../shared/map.ts';
import type { Box, Vec3 } from '../../shared/types.ts';
import { ITEMS } from '../../shared/items.ts';
import type { Theme } from '../../shared/props.ts';
import { containerModel, fenceModel, floorStripes, propModel, rackModel } from './models.ts';

/** One tile per 2 m of floor. */
function floorTexture(base: string, half: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(half, half);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const materials = new Map<string, THREE.Material>();

const METAL = new Set(['barrel', 'locker', 'cabinet', 'gasBottle', 'extinguisher', 'generator', 'serverRack', 'pipes', 'handTruck', 'dumpster', 'paintCan']);

/** One material per prop type; colors come from the model's vertex colors. */
function propMaterial(type: string): THREE.Material {
  let m = materials.get(type);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: METAL.has(type) ? 0.5 : 0.8, metalness: METAL.has(type) ? 0.35 : 0 });
    materials.set(type, m);
  }
  return m;
}

/** A prop with its origin at its bottom center. Players disguised as it use the exact same mesh. */
const propGeometry = propModel;

export function createPropMesh(type: string): THREE.Object3D {
  const mesh = new THREE.Mesh(propGeometry(type), propMaterial(type));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createHunterMesh(color = 0xd24b3a): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const [w, h] = HUNTER_SIZE;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(w / 2, h - w, 4, 12), mat);
  body.position.y = h / 2;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.1), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.2 }));
  visor.position.set(0, 1.55, -0.27);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  gun.position.set(0.32, 1.15, -0.35);
  for (const m of [body, visor, gun]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

export interface World {
  /** Everything the camera and the disguise picker can hit. */
  colliders: THREE.Object3D[];
}

interface Palette {
  sky: number;
  floor: string;
  wall: number;
  /** Shelves, partitions, containers: walls lower than the outer ones. */
  inner: number[];
  lamps: boolean;
  ambient: number;
}

const PALETTES: Record<Theme, Palette> = {
  warehouse: { sky: 0x1d2228, floor: '#5a5d61', wall: 0x8a8f94, inner: [0x6a8aa0], lamps: true, ambient: 1.5 },
  office: { sky: 0x26231f, floor: '#4d5868', wall: 0xd9cfbf, inner: [0x9aa8b5], lamps: true, ambient: 1.8 },
  yard: { sky: 0x9cc4e4, floor: '#3d3f42', wall: 0x5d6b4e, inner: [0xb5462f, 0x2f6db5, 0x3a8f4e, 0xc99a2e], lamps: false, ambient: 2.2 },
  hideout: { sky: 0x17140f, floor: '#4a4036', wall: 0x6e6253, inner: [0x8a7a62], lamps: true, ambient: 1.6 },
};

const STATION_LABELS: Record<Station, string> = { stash: '보관함', bench: '작업대', door: '레이드 출발' };

/** A name floating over a hideout station, always facing the camera. */
function createLabel(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10, 12, 16, 0.75)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 12);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 28px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2.8, 0.7, 1);
  return sprite;
}

/**
 * Aisle signs on both ends of each rack ("A-1", "B-3"): a letter per row line
 * and a number per rack along it, like a real warehouse's location codes.
 */
function rackSigns(racks: Box[]): THREE.Group {
  const group = new THREE.Group();
  const alongZ = (w: Box) => w.max[2] - w.min[2] > w.max[0] - w.min[0];
  const line = (w: Box) => `${alongZ(w) ? 'z' : 'x'}${Math.round(alongZ(w) ? w.min[0] + w.max[0] : w.min[2] + w.max[2])}`;
  const lines = [...new Set(racks.map(line))].sort((a, b) => (a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : a < b ? 1 : -1));
  const geo = new THREE.PlaneGeometry(0.9, 0.45);
  for (const w of racks) {
    const li = lines.indexOf(line(w));
    const same = racks.filter((o) => line(o) === line(w)).sort((a, b) => (alongZ(w) ? a.min[2] - b.min[2] : a.min[0] - b.min[0]));
    const text = `${String.fromCharCode(65 + (li % 26))}-${same.indexOf(w) + 1}`;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#16181b';
    g.fillRect(4, 4, 120, 56);
    g.fillStyle = '#f2c230';
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    for (const end of [0, 1]) {
      const sign = new THREE.Mesh(geo, mat);
      const cx = (w.min[0] + w.max[0]) / 2;
      const cz = (w.min[2] + w.max[2]) / 2;
      if (alongZ(w)) {
        sign.position.set(cx, w.max[1] + 0.3, end ? w.max[2] + 0.02 : w.min[2] - 0.02);
      } else {
        sign.position.set(end ? w.max[0] + 0.02 : w.min[0] - 0.02, w.max[1] + 0.3, cz);
        sign.rotation.y = Math.PI / 2;
      }
      group.add(sign);
    }
  }
  return group;
}

/** Builds a map's static scene into `root` (cleared first). */
export function buildWorld(scene: THREE.Scene, root: THREE.Group, map: GameMap): World {
  root.clear();
  const pal = PALETTES[map.theme];
  scene.background = new THREE.Color(pal.sky);
  const fogScale = Math.max(1, map.half / 20);
  scene.fog = new THREE.Fog(pal.sky, (map.theme === 'yard' ? 40 : 25) * fogScale, (map.theme === 'yard' ? 100 : 60) * fogScale);

  root.add(new THREE.HemisphereLight(0xbcd3ff, 0x5a5040, pal.ambient));
  const sun = new THREE.DirectionalLight(0xfff1dc, map.theme === 'yard' ? 2.4 : 1.6);
  sun.position.set(12, 30, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = map.half + 2;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 80 });
  root.add(sun);
  if (pal.lamps) {
    // Ceiling lamps for some local light pools: a 3x3 grid on big maps, corners and middle on small ones.
    const r = map.half > 20 ? map.half * 0.6 : Math.min(8, map.half - 3);
    const spots = map.half > 20
      ? [-r, 0, r].flatMap((x) => [-r, 0, r].map((z) => [x, z]))
      : [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]];
    for (const [x, z] of spots) {
      const lamp = new THREE.PointLight(0xffe2b0, map.half > 20 ? 40 : 18, map.half > 20 ? map.half * 0.8 : 16, 1.6);
      lamp.position.set(x, 5.2, z);
      root.add(lamp);
    }
  }

  const colliders: THREE.Object3D[] = [];
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.half * 2, map.half * 2),
    new THREE.MeshStandardMaterial({ map: floorTexture(pal.floor, map.half), roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  colliders.push(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: pal.wall, roughness: 0.9 });
  const innerMats = pal.inner.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 }));
  // Warehouse shelving and yard containers get detailed models; other walls are plain boxes.
  const thin = (w: Box) => Math.min(w.max[0] - w.min[0], w.max[2] - w.min[2]);
  const isRack = (w: Box) => map.theme === 'warehouse' && [2.4, 3.2, 4.2].includes(w.max[1]) && thin(w) <= 1.3 && thin(w) > 0.5;
  const isFence = (w: Box) => map.theme === 'warehouse' && w.max[1] === 2.5 && thin(w) <= 0.31;
  const isContainer = (w: Box) => map.theme === 'yard' && w.max[1] > 2 && w.max[1] < map.wallHeight + 2 && Math.abs(thin(w) - 2.4) < 0.01;
  const racks = map.walls.filter(isRack);
  const containers = map.walls.filter(isContainer);
  const fences = map.walls.filter(isFence);
  for (const [geo, mat] of [
    [racks.length ? rackModel(racks, map.seed) : null, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 })],
    [containers.length ? containerModel(containers, pal.inner) : null, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 })],
    [fences.length ? fenceModel(fences) : null, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 })],
  ] as const) {
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    colliders.push(mesh);
  }
  map.walls.forEach((w, i) => {
    if (isRack(w) || isContainer(w) || isFence(w)) return;
    const size = [w.max[0] - w.min[0], w.max[1] - w.min[1], w.max[2] - w.min[2]];
    const mat = size[1] < map.wallHeight ? innerMats[i % innerMats.length] : wallMat;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.position.set((w.min[0] + w.max[0]) / 2, (w.min[1] + w.max[1]) / 2, (w.min[2] + w.max[2]) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    colliders.push(mesh);
  });
  if (racks.length) {
    const stripes = new THREE.Mesh(floorStripes(racks), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    stripes.receiveShadow = true;
    root.add(stripes);
    root.add(rackSigns(racks));
  }

  // One instanced mesh per prop type: maps have hundreds of props.
  const byType = new Map<string, typeof map.props>();
  for (const p of map.props) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  for (const [type, list] of byType) {
    const mesh = new THREE.InstancedMesh(propGeometry(type), propMaterial(type), list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, (p.rot * Math.PI) / 2);
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...p.pos), q, one));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.propIds = list.map((p) => p.id);
    root.add(mesh);
    colliders.push(mesh);
  }
  buildExits(root, map);
  if (map.stations) {
    for (const [station, pos] of Object.entries(map.stations) as [Station, Vec3][]) {
      const label = createLabel(STATION_LABELS[station]);
      label.position.set(pos[0], 2.6, pos[2] - (station === 'door' ? 0 : 1));
      root.add(label);
    }
  }
  return { colliders };
}

/** A small glowing pickup. Origin at its bottom. */
export function createLootMesh(type: string): THREE.Object3D {
  const color = ITEMS[type].color;
  const g = new THREE.Group();
  const item = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.3),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4 }),
  );
  item.position.y = 0.25;
  item.castShadow = true;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.25, 0.32, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.6 }),
  );
  ring.position.y = 0.02;
  g.add(item, ring);
  g.userData.spin = item;
  return g;
}

function buildExits(root: THREE.Group, map: GameMap): THREE.Object3D[] {
  return map.exits.map((e) => {
    const w = e.max[0] - e.min[0];
    const d = e.max[2] - e.min[2];
    const g = new THREE.Group();
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.04, d),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.45 }),
    );
    pad.position.y = 0.02;
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(w, 4, d),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    beam.position.y = 2;
    const light = new THREE.PointLight(0x3ddc84, 8, 8, 1.5);
    light.position.y = 2;
    g.add(pad, beam, light);
    g.position.set((e.min[0] + e.max[0]) / 2, 0, (e.min[2] + e.max[2]) / 2);
    root.add(g);
    return g;
  });
}
