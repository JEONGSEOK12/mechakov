import * as THREE from 'three';
import { DISGUISE_RANGE, FIRE_COOLDOWN, HUNTER_EYE, PICKUP_RANGE, TICK_DT } from '../../shared/constants.ts';
import { lookDir } from '../../shared/geometry.ts';
import { generateMap, type GameMap } from '../../shared/map.ts';
import { bodySize, stepBody, type BodyState } from '../../shared/physics.ts';
import { ITEMS } from '../../shared/items.ts';
import { PROPS } from '../../shared/props.ts';
import type { ClientMsg, Loot, Outcome, PlayerSnap, ServerMsg } from '../../shared/protocol.ts';
import { canDisguiseAs, type Profile } from '../../shared/upgrades.ts';
import type { Phase, Team, Vec3 } from '../../shared/types.ts';
import { Controls } from './controls.ts';
import { Hideout } from './hideout.ts';
import { Hud } from './hud.ts';
import { buildExits, buildWorld, createHunterMesh, createLootMesh, createPropMesh, type World } from './meshes.ts';
import type { Net } from './net.ts';

type InputMsg = Extract<ClientMsg, { t: 'input' }>;

const INTERP_DELAY = 100;

interface Snapshot {
  at: number;
  players: Map<number, PlayerSnap>;
}

class Avatar {
  readonly group = new THREE.Group();
  private look = '';

  setLook(role: PlayerSnap['role'], prop: string | null) {
    const look = role === 'prop' ? `prop:${prop}` : role;
    if (look === this.look) return;
    this.look = look;
    this.group.clear();
    if (role === 'prop' && prop) this.group.add(createPropMesh(prop));
    else if (role === 'hunter') this.group.add(createHunterMesh());
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Game {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
  private raycaster = new THREE.Raycaster();
  private map: GameMap;
  private world: World;
  private hud = new Hud();
  private controls: Controls;

  private snaps: Snapshot[] = [];
  private latest = new Map<number, PlayerSnap>();
  private phase: Phase = 'lobby';
  private timeLeft = 0;
  private timeAt = 0;
  private winner: Team | null = null;
  private avatars = new Map<number, Avatar>();

  // Local prediction for our own body.
  private body: BodyState | null = null;
  private prevPos: Vec3 = [0, 0, 0];
  private offset = new THREE.Vector3();
  private pending: InputMsg[] = [];
  private seq = 0;
  private acc = 0;
  private lastFrame = performance.now();

  private faceLocked = false;
  private lockedFace = 0;
  private lastShot = 0;
  private spectateIndex = 0;
  private scoreboardOpen = false;
  private disguiseTarget: number | null = null;
  /** A prop in reach that the disguise catalog doesn't unlock yet. */
  private disguiseLocked: number | null = null;
  private highlight = new THREE.Box3Helper(new THREE.Box3(), 0xffd27a);
  private tracers: { line: THREE.Line; until: number }[] = [];

  // Raid and hideout state.
  private hideout = new Hideout();
  private bag: string[] = [];
  private bagCapacity = 3;
  private loot = new Map<number, { data: Loot; mesh: THREE.Object3D }>();
  private pickupTarget: number | null = null;
  private result: { outcome: Outcome; items: string[] } | null = null;
  private lastHideoutRender = 0;

  constructor(private net: Net, private myId: number, seed: number, private profile: Profile) {
    this.map = generateMap(seed);
    this.world = buildWorld(this.scene, this.map);
    buildExits(this.scene, this.map);
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.getElementById('app')!.appendChild(this.renderer.domElement);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.controls = new Controls(this.renderer.domElement);
    this.controls.onShoot = () => this.shoot();
    this.controls.onDisguise = () => {
      if (this.disguiseTarget !== null) this.net.send({ t: 'disguise', propId: this.disguiseTarget });
    };
    this.controls.onToggleRotationLock = () => {
      this.faceLocked = !this.faceLocked;
      this.lockedFace = this.controls.yaw;
    };
    this.controls.onScoreboard = (show) => {
      this.scoreboardOpen = show;
    };
    this.controls.onPickup = () => {
      if (this.pickupTarget !== null) this.net.send({ t: 'pickup', lootId: this.pickupTarget });
    };
    this.controls.onHideout = () => {
      this.hideout.toggle();
      this.renderHideout();
    };
    this.hideout.onUpgrade = (id) => this.net.send({ t: 'upgrade', id });

    net.onMessage = (msg) => this.onMessage(msg);
    net.onClose = () => this.hud.center('서버와 연결이 끊겼어요. 새로고침해 주세요.');
  }

  start() {
    const frame = () => {
      this.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private get me() {
    return this.latest.get(this.myId);
  }

  private resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case 'snap':
        this.onSnap(msg);
        break;
      case 'shot':
        this.addTracer(msg.origin, msg.end, msg.hit === 'player' ? 0xff5040 : 0xffe08a);
        if (msg.from === this.myId && msg.hit === 'player') this.hud.hitmarker();
        if (msg.target === this.myId || (msg.from === this.myId && msg.hit === 'decoy')) this.hud.damaged();
        break;
      case 'kill': {
        const name = (id: number | null) => (id === null ? null : this.latest.get(id)?.name ?? '???');
        const killer = name(msg.killer);
        this.hud.kill(killer ? `${killer} ▸ ${name(msg.victim)}` : `${name(msg.victim)} (가짜 사물을 너무 많이 쏨)`);
        break;
      }
      case 'roundEnd':
        this.winner = msg.winner;
        break;
      case 'profile':
        this.profile = msg.profile;
        this.renderHideout();
        break;
      case 'bag':
        this.bag = msg.items;
        this.bagCapacity = msg.capacity;
        break;
      case 'loot':
        this.syncLoot(msg.items);
        break;
      case 'result':
        this.result = { outcome: msg.outcome, items: msg.items };
        break;
    }
  }

  private onSnap(msg: Extract<ServerMsg, { t: 'snap' }>) {
    const prevMe = this.me;
    this.phase = msg.phase;
    this.timeLeft = msg.timeLeft;
    this.timeAt = performance.now();
    this.latest = new Map(msg.players.map((p) => [p.id, p]));
    this.snaps.push({ at: this.timeAt, players: this.latest });
    while (this.snaps.length > 30) this.snaps.shift();

    const me = this.me;
    if (!me || !me.alive || me.role === 'spectator') {
      this.body = null;
      this.pending = [];
      return;
    }
    const before = this.body ? ([...this.body.pos] as Vec3) : null;
    this.body = { pos: [...me.pos], vy: me.vy, onGround: me.onGround };
    this.pending = this.pending.filter((i) => i.seq > me.seq);
    const frozen = this.phase === 'hide' && me.role === 'hunter';
    for (const i of this.pending) {
      stepBody(this.body, me.role, me.prop, i.keys, i.yaw, frozen, TICK_DT, this.map.solids, me.speed);
    }
    const p = this.body.pos;
    const teleported = !before || !prevMe?.alive || prevMe.role !== me.role ||
      Math.hypot(before[0] - p[0], before[1] - p[1], before[2] - p[2]) > 3;
    if (teleported) {
      this.offset.set(0, 0, 0);
      this.prevPos = [...p];
    } else {
      // Keep drawing where we were and ease into the corrected position.
      const d = [before[0] - p[0], before[1] - p[1], before[2] - p[2]];
      this.offset.x += d[0];
      this.offset.y += d[1];
      this.offset.z += d[2];
      this.prevPos = [this.prevPos[0] - d[0], this.prevPos[1] - d[1], this.prevPos[2] - d[2]];
    }
  }

  private fixedTick() {
    const keys = { ...this.controls.keys };
    const yaw = this.controls.yaw;
    const input: InputMsg = {
      t: 'input',
      seq: ++this.seq,
      keys,
      yaw,
      pitch: this.controls.pitch,
      face: this.faceLocked ? this.lockedFace : yaw,
    };
    this.net.send(input);
    const me = this.me;
    if (!this.body || !me) return;
    this.prevPos = [...this.body.pos];
    stepBody(this.body, me.role, me.prop, keys, yaw, this.phase === 'hide' && me.role === 'hunter', TICK_DT, this.map.solids, me.speed);
    this.pending.push(input);
  }

  private shoot() {
    const me = this.me;
    if (!me) return;
    if (!me.alive) {
      this.spectateIndex++;
      return;
    }
    if (me.role !== 'hunter' || this.phase !== 'hunt') return;
    const now = performance.now();
    if (now - this.lastShot < FIRE_COOLDOWN * 1000) return;
    this.lastShot = now;
    const p = this.camera.position;
    this.net.send({ t: 'shoot', origin: [p.x, p.y, p.z], dir: lookDir(this.controls.yaw, this.controls.pitch) });
  }

  private addTracer(from: Vec3, to: Vec3, color: number) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, until: performance.now() + 120 });
  }

  /** Other players, drawn slightly in the past between two snapshots. */
  private interpolated(): Map<number, PlayerSnap> {
    const rt = performance.now() - INTERP_DELAY;
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1].at > rt) i--;
    const b = this.snaps[i];
    const a = this.snaps[i - 1];
    if (!a || !b) return this.latest;
    const t = Math.max(0, Math.min(1, (rt - a.at) / Math.max(1, b.at - a.at)));
    const out = new Map<number, PlayerSnap>();
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      if (!pa) {
        out.set(id, pb);
        continue;
      }
      out.set(id, {
        ...pb,
        pos: [pa.pos[0] + (pb.pos[0] - pa.pos[0]) * t, pa.pos[1] + (pb.pos[1] - pa.pos[1]) * t, pa.pos[2] + (pb.pos[2] - pa.pos[2]) * t],
        face: lerpAngle(pa.face, pb.face, t),
      });
    }
    return out;
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += dt;
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.fixedTick();
    }
    this.offset.multiplyScalar(Math.exp(-dt * 12));

    const me = this.me;
    const players = this.interpolated();

    // Our own position: predicted, interpolated between fixed ticks.
    let myPos: THREE.Vector3 | null = null;
    if (this.body) {
      const alpha = this.acc / TICK_DT;
      const b = this.body.pos;
      myPos = new THREE.Vector3(
        this.prevPos[0] + (b[0] - this.prevPos[0]) * alpha,
        this.prevPos[1] + (b[1] - this.prevPos[1]) * alpha,
        this.prevPos[2] + (b[2] - this.prevPos[2]) * alpha,
      ).add(this.offset);
    }

    for (const [id, avatar] of this.avatars) {
      if (!players.has(id)) {
        this.scene.remove(avatar.group);
        this.avatars.delete(id);
      }
    }
    for (const p of players.values()) {
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        avatar = new Avatar();
        this.avatars.set(p.id, avatar);
        this.scene.add(avatar.group);
      }
      const visible = p.alive && p.role !== 'spectator';
      avatar.group.visible = visible;
      if (!visible) continue;
      const isMe = p.id === this.myId && me;
      avatar.setLook(isMe ? me.role : p.role, isMe ? me.prop : p.prop);
      if (isMe && myPos) {
        avatar.group.position.copy(myPos);
        avatar.group.rotation.y = this.faceLocked ? this.lockedFace : this.controls.yaw;
      } else {
        avatar.group.position.set(...p.pos);
        avatar.group.rotation.y = p.face;
      }
    }

    this.updateCamera(me, myPos, players);
    this.updateDisguiseTarget(me, myPos);
    this.updatePickupTarget(me, myPos);
    for (const { mesh } of this.loot.values()) {
      const spin = mesh.userData.spin as THREE.Object3D;
      spin.rotation.y = now / 600;
      spin.position.y = 0.25 + Math.sin(now / 300) * 0.04;
    }
    if (this.hideout.open && now - this.lastHideoutRender > 500) this.renderHideout();
    this.updateHud(me);

    for (const t of this.tracers) {
      if (now > t.until) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
      }
    }
    this.tracers = this.tracers.filter((t) => now <= t.until);

    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(me: PlayerSnap | undefined, myPos: THREE.Vector3 | null, players: Map<number, PlayerSnap>) {
    let pivot: THREE.Vector3;
    let distance = 3.5;
    let shoulder = 0;
    if (me && myPos) {
      if (me.role === 'hunter') {
        pivot = myPos.clone().add(new THREE.Vector3(0, HUNTER_EYE + 0.25, 0));
        distance = 3;
        shoulder = 1;
      } else {
        const size = bodySize(me.role, me.prop);
        pivot = myPos.clone().add(new THREE.Vector3(0, size[1] + 0.3, 0));
        distance = 2.5 + Math.max(...size) * 1.5;
      }
    } else {
      const alive = [...players.values()].filter((p) => p.alive && p.role !== 'spectator').sort((a, b) => a.id - b.id);
      const target = alive.length ? alive[this.spectateIndex % alive.length] : null;
      pivot = target ? new THREE.Vector3(target.pos[0], target.pos[1] + 1.5, target.pos[2]) : new THREE.Vector3(0, 6, 0);
      distance = target ? 5 : 12;
    }
    const fwd = new THREE.Vector3(...lookDir(this.controls.yaw, this.controls.pitch));
    const right = new THREE.Vector3(Math.cos(this.controls.yaw), 0, -Math.sin(this.controls.yaw));
    const back = fwd.clone().negate().multiplyScalar(distance).addScaledVector(right, shoulder);
    // Pull the camera in when a wall is between it and the player.
    const len = back.length();
    this.raycaster.set(pivot, back.clone().normalize());
    this.raycaster.far = len;
    const hit = this.raycaster.intersectObjects(this.world.colliders, false)[0];
    const camDist = hit ? Math.max(0.3, hit.distance - 0.2) : len;
    this.camera.position.copy(pivot).addScaledVector(back.normalize(), camDist);
    this.camera.lookAt(this.camera.position.clone().add(fwd));
  }

  private updateDisguiseTarget(me: PlayerSnap | undefined, myPos: THREE.Vector3 | null) {
    this.disguiseTarget = null;
    this.disguiseLocked = null;
    this.highlight.visible = false;
    if (!me || !myPos || me.role !== 'prop' || this.phase === 'end') return;
    const fwd = new THREE.Vector3(...lookDir(this.controls.yaw, this.controls.pitch));
    this.raycaster.set(this.camera.position, fwd);
    this.raycaster.far = 20;
    const hit = this.raycaster.intersectObjects(this.world.colliders, false)[0];
    const id = hit?.object.userData.propId as number | undefined;
    if (!hit || id === undefined) return;
    const size = bodySize(me.role, me.prop);
    const center = myPos.clone().add(new THREE.Vector3(0, size[1] / 2, 0));
    if (center.distanceTo(hit.point) > DISGUISE_RANGE) return;
    if (!canDisguiseAs(this.profile, this.map.props[id].type)) {
      this.disguiseLocked = id;
      return;
    }
    this.disguiseTarget = id;
    this.highlight.box.setFromObject(hit.object);
    this.highlight.visible = true;
  }

  private updateHud(me: PlayerSnap | undefined) {
    const left = Math.max(0, this.timeLeft - (performance.now() - this.timeAt) / 1000);
    this.hud.phase(this.phase, left);
    this.hud.me(me, this.phase);
    this.hud.blind(this.phase === 'hide' && me?.role === 'hunter', left);
    this.hud.scoreboard(this.scoreboardOpen, [...this.latest.values()], this.myId);

    if (this.phase === 'end') this.hud.roundEnd(this.winner);
    else if (this.phase === 'countdown') this.hud.center(`라운드 시작까지 ${Math.ceil(left)}`);
    else if (this.phase === 'hide' && me?.role === 'prop' && me.alive) {
      this.hud.center(left > 5 ? '헌터가 오기 전에 숨으세요!' : `헌터 출발까지 ${Math.ceil(left)}`);
    }
    else this.hud.center('');

    const inRaid = !!me?.alive && me.role !== 'spectator' && (this.phase === 'hide' || this.phase === 'hunt');
    this.hud.bag(this.bag, this.bagCapacity, inRaid);
    this.hud.extract(me?.alive ? me.extracting : 0);
    if (this.phase === 'lobby' || this.phase === 'countdown' || this.phase === 'hide') this.result = null;
    this.hud.result(this.result?.outcome ?? null, this.result?.items ?? []);

    const hints: string[] = [];
    if (this.pickupTarget !== null) {
      const name = ITEMS[this.loot.get(this.pickupTarget)!.data.type].name;
      hints.push(this.bag.length >= this.bagCapacity ? `가방이 가득 찼어요 (${name})` : `F: ${name} 줍기`);
    }
    if (this.disguiseTarget !== null) hints.push(`E: ${PROPS[this.map.props[this.disguiseTarget].type].name}(으)로 변신`);
    if (this.disguiseLocked !== null) hints.push(`${PROPS[this.map.props[this.disguiseLocked].type].name}: 변신 도감 업그레이드 필요`);
    let hint = hints.join(' · ');
    if (me?.role === 'prop' && me.alive && this.faceLocked) hint += `${hint ? ' · ' : ''}방향 고정됨 (R)`;
    if (!this.controls.locked && !this.hideout.open) hint = '화면을 클릭하면 조작을 시작해요';
    this.hud.hint(hint);
  }

  private canUpgradeNow() {
    const me = this.me;
    if (!me) return false;
    return !(me.alive && me.role !== 'spectator' && (this.phase === 'hide' || this.phase === 'hunt'));
  }

  private renderHideout() {
    if (!this.hideout.open) return;
    this.lastHideoutRender = performance.now();
    this.hideout.render(this.profile, this.canUpgradeNow());
  }

  private syncLoot(items: Loot[]) {
    const ids = new Set(items.map((i) => i.id));
    for (const [id, l] of this.loot) {
      if (!ids.has(id)) {
        this.scene.remove(l.mesh);
        this.loot.delete(id);
      }
    }
    for (const item of items) {
      if (this.loot.has(item.id)) continue;
      const mesh = createLootMesh(item.type);
      mesh.position.set(...item.pos);
      this.scene.add(mesh);
      this.loot.set(item.id, { data: item, mesh });
    }
  }

  private updatePickupTarget(me: PlayerSnap | undefined, myPos: THREE.Vector3 | null) {
    this.pickupTarget = null;
    if (!me || !myPos || me.role !== 'prop' || (this.phase !== 'hide' && this.phase !== 'hunt')) return;
    const size = bodySize(me.role, me.prop);
    const center = myPos.clone().add(new THREE.Vector3(0, size[1] / 2, 0));
    // Stay a little inside the server's range so a pickup isn't refused over lag.
    let best = PICKUP_RANGE + Math.max(...size) / 2 - 0.2;
    for (const { data } of this.loot.values()) {
      const d = center.distanceTo(new THREE.Vector3(...data.pos));
      if (d < best) {
        best = d;
        this.pickupTarget = data.id;
      }
    }
  }
}
