import * as THREE from 'three';
import { HUNTER_SIZE } from '../../shared/constants.ts';
import type { GameMap, Station } from '../../shared/map.ts';
import type { Vec3 } from '../../shared/types.ts';
import { ITEMS } from '../../shared/items.ts';
import { PROPS, type Theme } from '../../shared/props.ts';

function crateTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a8743f';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#6e4724';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 58, 58);
  g.beginPath();
  g.moveTo(6, 6);
  g.lineTo(58, 58);
  g.stroke();
  g.lineWidth = 1;
  for (let y = 16; y < 64; y += 16) g.strokeRect(6, y, 52, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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

function propMaterial(type: string): THREE.Material {
  let m = materials.get(type);
  if (!m) {
    m = type === 'crate'
      ? new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.9 })
      : new THREE.MeshStandardMaterial({ color: PROPS[type].color, roughness: 0.7, metalness: type === 'barrel' || type === 'locker' ? 0.3 : 0 });
    materials.set(type, m);
  }
  return m;
}

/** A prop with its origin at its bottom center. Players disguised as it use the exact same mesh. */
export function createPropMesh(type: string): THREE.Object3D {
  const def = PROPS[type];
  const [w, h, d] = def.size;
  let geo: THREE.BufferGeometry;
  if (def.shape === 'box') geo = new THREE.BoxGeometry(w, h, d);
  else if (def.shape === 'cone') geo = new THREE.ConeGeometry(w / 2, h, 16);
  else if (type === 'tire') geo = new THREE.TorusGeometry(w / 2 - h / 2, h / 2, 10, 20).rotateX(Math.PI / 2);
  else geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 18);
  geo.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(geo, propMaterial(type));
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
  propMeshes: THREE.Object3D[];
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
      const lamp = new THREE.PointLight(0xffe2b0, 18, map.half > 20 ? 22 : 16, 1.6);
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
  map.walls.forEach((w, i) => {
    const size = [w.max[0] - w.min[0], w.max[1] - w.min[1], w.max[2] - w.min[2]];
    const mat = size[1] < map.wallHeight ? innerMats[i % innerMats.length] : wallMat;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.position.set((w.min[0] + w.max[0]) / 2, (w.min[1] + w.max[1]) / 2, (w.min[2] + w.max[2]) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    colliders.push(mesh);
  });

  const propMeshes: THREE.Object3D[] = [];
  for (const p of map.props) {
    const mesh = createPropMesh(p.type);
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.rotation.y = (p.rot * Math.PI) / 2;
    mesh.userData.propId = p.id;
    root.add(mesh);
    colliders.push(mesh);
    propMeshes.push(mesh);
  }
  buildExits(root, map);
  if (map.stations) {
    for (const [station, pos] of Object.entries(map.stations) as [Station, Vec3][]) {
      const label = createLabel(STATION_LABELS[station]);
      label.position.set(pos[0], 2.6, pos[2] - (station === 'door' ? 0 : 1));
      root.add(label);
    }
  }
  return { colliders, propMeshes };
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
