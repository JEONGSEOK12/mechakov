import * as THREE from 'three';
import { ROCKET_RADIUS } from '../../shared/constants.ts';
import type { RocketSnap } from '../../shared/protocol.ts';
import type { Vec3 } from '../../shared/types.ts';

interface Flying {
  group: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** When the snapshot that placed it arrived; it flies on from there between snapshots. */
  at: number;
  lastPuff: number;
}

interface Fading {
  mesh: THREE.Mesh;
  born: number;
  life: number;
  grow: number;
  opacity: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Props' rockets in flight, their smoke trails and explosions. */
export class RocketFx {
  private flying = new Map<number, Flying>();
  private fading: Fading[] = [];
  /** One light reused for every flash: adding lights at runtime makes three.js recompile shaders. */
  private flash = new THREE.PointLight(0xffa040, 0, 14, 1.6);
  private flashAt = -Infinity;
  private bodyGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.45, 10);
  private noseGeo = new THREE.ConeGeometry(0.07, 0.16, 10);
  private finGeo = new THREE.BoxGeometry(0.22, 0.12, 0.015);
  private flameGeo = new THREE.SphereGeometry(0.09, 10, 8);
  private puffGeo = new THREE.SphereGeometry(0.18, 8, 6);
  private blastGeo = new THREE.SphereGeometry(1, 20, 14);
  private bodyMat = new THREE.MeshStandardMaterial({ color: 0x4d5a3c, roughness: 0.6, metalness: 0.3 });
  private noseMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 });
  private flameMat = new THREE.MeshBasicMaterial({ color: 0xffb040 });

  constructor(private scene: THREE.Scene) {
    scene.add(this.flash);
  }

  private makeRocket(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    const nose = new THREE.Mesh(this.noseGeo, this.noseMat);
    nose.position.y = 0.3;
    const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
    flame.position.y = -0.27;
    flame.scale.set(1, 1.8, 1);
    g.add(body, nose, flame);
    for (const r of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(this.finGeo, this.bodyMat);
      fin.position.y = -0.17;
      fin.rotation.y = r;
      g.add(fin);
    }
    return g;
  }

  /** Matches the rockets in a snapshot: new ones appear, gone ones disappear. */
  sync(rockets: RocketSnap[]) {
    const now = performance.now();
    const seen = new Set<number>();
    for (const r of rockets) {
      seen.add(r.id);
      let f = this.flying.get(r.id);
      if (!f) {
        f = { group: this.makeRocket(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), at: now, lastPuff: 0 };
        this.scene.add(f.group);
        this.flying.set(r.id, f);
      }
      f.pos.set(...r.pos);
      f.vel.set(...r.vel);
      f.at = now;
      f.group.quaternion.setFromUnitVectors(UP, f.vel.clone().normalize());
    }
    for (const [id, f] of this.flying) {
      if (seen.has(id)) continue;
      this.scene.remove(f.group);
      this.flying.delete(id);
    }
  }

  private fade(mesh: THREE.Mesh, life: number, grow: number) {
    this.scene.add(mesh);
    this.fading.push({ mesh, born: performance.now(), life, grow, opacity: (mesh.material as THREE.MeshBasicMaterial).opacity });
  }

  private puff(pos: THREE.Vector3, color: number, size: number, life: number, spread = 0) {
    const mesh = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
    mesh.position.copy(pos);
    if (spread) mesh.position.add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread * 0.6, (Math.random() - 0.5) * spread));
    mesh.scale.setScalar(size);
    this.fade(mesh, life, 2.2);
  }

  /** A fireball, a flash of light and a burst of smoke. */
  boom(at: Vec3) {
    // Sized from the blast radius so what you see matches who gets thrown.
    const k = ROCKET_RADIUS / 3.2;
    const pos = new THREE.Vector3(...at);
    const fire = new THREE.Mesh(this.blastGeo, new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, depthWrite: false }));
    fire.position.copy(pos);
    fire.scale.setScalar(0.4);
    this.fade(fire, 280, ROCKET_RADIUS * 1.2);
    const core = new THREE.Mesh(this.blastGeo, new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 1, depthWrite: false }));
    core.position.copy(pos);
    core.scale.setScalar(0.3);
    this.fade(core, 160, ROCKET_RADIUS * 0.6);
    for (let i = 0; i < 10; i++) this.puff(pos, i % 3 ? 0x5a5a5a : 0x2e2e2e, (1.6 + Math.random() * 1.5) * k, 700 + Math.random() * 500, 2.4 * k);
    this.flash.position.copy(pos);
    this.flashAt = performance.now();
  }

  update() {
    const now = performance.now();
    for (const f of this.flying.values()) {
      const dt = (now - f.at) / 1000;
      f.group.position.copy(f.pos).addScaledVector(f.vel, Math.min(dt, 0.15));
      if (now - f.lastPuff > 30) {
        f.lastPuff = now;
        const tail = f.group.position.clone().addScaledVector(f.vel, -0.02);
        this.puff(tail, 0xb8b8b8, 0.7, 600);
      }
    }
    this.fading = this.fading.filter((p) => {
      const t = (now - p.born) / p.life;
      if (t >= 1) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        return false;
      }
      const s = p.mesh.scale.x;
      p.mesh.scale.setScalar(s + (p.grow - s) * 0.08);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.opacity * (1 - t);
      return true;
    });
    this.flash.intensity = 60 * Math.max(0, 1 - (now - this.flashAt) / 250);
  }

  clear() {
    for (const f of this.flying.values()) this.scene.remove(f.group);
    this.flying.clear();
    for (const p of this.fading) this.scene.remove(p.mesh);
    this.fading = [];
  }
}
