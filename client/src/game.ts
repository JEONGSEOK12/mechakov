import * as THREE from 'three';
import { ammoAfter, CHARACTER_IDS, CHARACTERS, characterOf, DECOY_COOLDOWN, nextSkillIn, skillUses, spendSkill, type WeaponDef } from '../../shared/characters.ts';
import { DISGUISE_RANGE, FIRE_COOLDOWN, HUNTER_EYE, PICKUP_RANGE, ROCKET_DELAY, TICK_DT } from '../../shared/constants.ts';
import { lookDir } from '../../shared/geometry.ts';
import { generateMap, STATION_RANGE, THEME_NAMES, zoneAt, type GameMap, type Station } from '../../shared/map.ts';
import { bodySize, stepBody, type BodyState } from '../../shared/physics.ts';
import { ITEMS } from '../../shared/items.ts';
import { PROPS, type Theme } from '../../shared/props.ts';
import type { ClientMsg, Loot, Outcome, PlayerSnap, RosterEntry, ServerMsg } from '../../shared/protocol.ts';
import { canDisguiseAs, type Profile } from '../../shared/upgrades.ts';
import type { Phase, Team, Vec3 } from '../../shared/types.ts';
import { Controls } from './controls.ts';
import { Hideout } from './hideout.ts';
import { Hud } from './hud.ts';
import { buildWorld, createDummyMesh, createHunterMesh, createLootMesh, createPropMesh, type World } from './meshes.ts';
import type { Connection } from './net.ts';
import { MapView } from './mapview.ts';
import { RocketFx } from './rockets.ts';
import { sfx, toggleMute } from './sfx.ts';

type InputMsg = Extract<ClientMsg, { t: 'input' }>;

const INTERP_DELAY = 100;

interface Snapshot {
  at: number;
  players: Map<number, PlayerSnap>;
}

class Avatar {
  readonly group = new THREE.Group();
  private look = '';
  private ghost = false;

  setLook(role: PlayerSnap['role'], prop: string | null, dummy = false) {
    const look = dummy ? 'dummy' : role === 'prop' ? `prop:${prop}` : role;
    if (look === this.look) return;
    this.look = look;
    this.ghost = false;
    this.group.clear();
    if (dummy) this.group.add(createDummyMesh());
    else if (role === 'prop' && prop) this.group.add(createPropMesh(prop));
    else if (role === 'hunter') this.group.add(createHunterMesh());
  }

  /** See-through, for showing yourself while invisible. Uses copies since prop materials are shared. */
  setGhost(on: boolean) {
    if (on === this.ghost) return;
    this.ghost = on;
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (on) {
        o.userData.solid = o.material;
        const m = (o.material as THREE.Material).clone();
        Object.assign(m, { transparent: true, opacity: 0.28, depthWrite: false });
        o.material = m;
      } else if (o.userData.solid) {
        (o.material as THREE.Material).dispose();
        o.material = o.userData.solid;
      }
    });
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const upgradeCount = (p: Profile) => Object.values(p.upgrades).reduce((a, b) => a + b, 0);

const STATION_HINTS: Record<Station, string> = { stash: 'F: 보관함 열기', bench: 'F: 작업대에서 업그레이드', door: 'F: 레이드 출발', range: 'F: 연습실 가기', leave: 'F: 은신처로 돌아가기' };

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
  private roster = new Map<number, RosterEntry>();
  private phase: Phase = 'lobby';
  private timeLeft = 0;
  private timeAt = 0;
  private winner: Team | null = null;
  private avatars = new Map<number, Avatar>();

  // Local prediction for our own body.
  private body: BodyState | null = null;
  private prevPos: Vec3 = [0, 0, 0];
  private offset = new THREE.Vector3();
  // Game feel: footstep stride, camera shake and sprint field of view.
  private stride = 0;
  private shakeUntil = 0;
  private shakeAmount = 0;
  private fov = 70;
  private countdownBeep = 0;
  private extractStep = 0;
  private pending: InputMsg[] = [];
  private seq = 0;
  private acc = 0;
  private lastFrame = performance.now();

  private faceLocked = false;
  private lockedFace = 0;
  private lastShot = 0;
  private lastRocket = -Infinity;
  /** Shots left in the clip right after `lastRocket`; see `ammoAfter`. */
  private ammo = 0;
  /** When every saved skill use is back; see `skillUses`. */
  private skillFullAt = -Infinity;
  /** Damage numbers floating up from where your hits landed. */
  private floats: { el: HTMLElement; pos: THREE.Vector3; born: number }[] = [];
  /** When the skill button went down, while it's held and charging. */
  private skillHeldSince: number | null = null;
  private lastDecoy = -Infinity;
  /** When the current raid began, for the opening tip. */
  private raidStartedAt = 0;
  private rocketFx = new RocketFx(this.scene);
  private spectateIndex = 0;
  private inventoryOpen = false;
  private mapView = new MapView(document.getElementById('hud')!);
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
  /** The hideout station you're standing at, if any. */
  private station: Station | null = null;
  private result: { outcome: Outcome; items: string[] } | null = null;
  private lastHideoutRender = 0;

  private worldRoot = new THREE.Group();

  constructor(private net: Connection, private myId: number, seed: number, theme: Theme, private profile: Profile, private manualStart = false) {
    this.scene.add(this.worldRoot);
    this.map = generateMap(seed, theme);
    this.world = buildWorld(this.scene, this.worldRoot, this.map);
    this.mapView.setMap(this.map);
    sfx.ambience(theme === 'yard');
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
    this.controls.onSkill = (down) => this.useSkill(down);
    this.controls.onDisguise = () => {
      const me = this.me;
      if (me?.alive && me.role === 'prop' && characterOf(me.character).disguise === 'decoy') {
        if (performance.now() - this.lastDecoy < DECOY_COOLDOWN * 1000) return;
        this.lastDecoy = performance.now();
        this.net.send({ t: 'decoy' });
        sfx.disguise();
        return;
      }
      if (this.disguiseTarget !== null) this.net.send({ t: 'disguise', propId: this.disguiseTarget });
    };
    this.controls.onToggleRotationLock = () => {
      this.faceLocked = !this.faceLocked;
      this.lockedFace = this.controls.yaw;
    };
    this.controls.onInventory = () => {
      this.inventoryOpen = !this.inventoryOpen;
      // Free the mouse so bag items can be clicked; click the screen to look around again.
      if (this.inventoryOpen) document.exitPointerLock();
    };
    document.getElementById('inventory')!.addEventListener('pointerdown', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
      if (!slot) return;
      const index = Number(slot.dataset.drop);
      if (!this.bag[index]) return;
      this.net.send({ t: 'drop', index });
      sfx.drop();
      this.hud.kill(`- ${ITEMS[this.bag[index]].name}`);
    });
    this.controls.onMute = () => this.hud.kill(toggleMute() ? '소리 끔 (N)' : '소리 켬 (N)');
    this.controls.onMap = () => this.mapView.toggle();
    this.controls.onPickup = () => {
      if (this.pickupTarget !== null && this.bag.length >= this.bagCapacity) sfx.bagFull();
      if (this.pickupTarget !== null) this.net.send({ t: 'pickup', lootId: this.pickupTarget });
      else if (this.station) this.useStation(this.station);
    };
    this.controls.onHideout = () => {
      if (!this.hideout.open) sfx.open();
      this.hideout.toggle(!this.hideout.open, 'all');
      this.renderHideout();
    };
    this.hideout.onUpgrade = (id) => this.net.send({ t: 'upgrade', id });
    this.controls.onCharacter = () => {
      if (this.phase !== 'lobby' && this.phase !== 'countdown') return;
      const next = CHARACTER_IDS[(CHARACTER_IDS.indexOf(this.me?.character ?? '') + 1) % CHARACTER_IDS.length];
      this.net.send({ t: 'character', id: next });
      sfx.disguise();
    };
    this.controls.onAddBot = () => {
      if (this.phase === 'lobby' || this.phase === 'countdown') this.net.send({ t: 'addBot' });
    };

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
        sfx.shot(this.camera.position.distanceTo(new THREE.Vector3(...msg.origin)));
        if (msg.from === this.myId) this.shake(0.06, 120);
        if (msg.from === this.myId && msg.hit === 'player') {
          this.hud.hitmarker();
          sfx.hitConfirm();
        }
        if (msg.target === this.myId || (msg.from === this.myId && msg.hit === 'decoy' && this.decoyHurts())) {
          this.hud.damaged();
          sfx.hurt();
          this.shake(0.25, 300);
        }
        break;
      case 'dmg':
        this.floatDamage(msg.pos, msg.killed ? `${msg.amount} 처치!` : `${msg.amount}`, msg.killed);
        break;
      case 'poof':
        this.rocketFx.poof(msg.pos);
        sfx.disguise();
        break;
      case 'bash': {
        const d = this.camera.position.distanceTo(new THREE.Vector3(...msg.pos));
        sfx.bash(d);
        if (msg.from === this.myId) {
          this.hud.hitmarker();
          sfx.hitConfirm();
          this.shake(0.2, 200);
        }
        if (msg.victim === this.myId) {
          this.hud.damaged();
          this.shake(0.35, 300);
        }
        break;
      }
      case 'boom': {
        this.rocketFx.boom(msg.pos);
        const d = this.camera.position.distanceTo(new THREE.Vector3(...msg.pos));
        sfx.explosion(d);
        this.shake(Math.max(0, 0.45 * (1 - d / 14)), 350);
        if (msg.from === this.myId && msg.hit.some((id) => id !== this.myId)) {
          this.hud.hitmarker();
          sfx.hitConfirm();
        }
        break;
      }
      case 'kill': {
        const name = (id: number | null) => (id === null ? null : this.roster.get(id)?.name ?? '???');
        const killer = name(msg.killer);
        this.hud.kill(killer ? `${killer} ▸ ${name(msg.victim)}` : `${name(msg.victim)} (가짜 사물을 너무 많이 쏨)`);
        if (msg.killer === this.myId) sfx.kill();
        break;
      }
      case 'roundEnd':
        this.winner = msg.winner;
        break;
      case 'map':
        if (this.map.theme === 'hideout' && msg.theme !== 'hideout') sfx.raidStart();
        this.map = generateMap(msg.seed, msg.theme);
        this.world = buildWorld(this.scene, this.worldRoot, this.map);
        this.mapView.setMap(this.map);
        this.rocketFx.clear();
        this.faceLocked = false;
        sfx.ambience(msg.theme === 'yard');
        break;
      case 'profile':
        if (upgradeCount(msg.profile) > upgradeCount(this.profile)) sfx.upgrade();
        this.profile = msg.profile;
        this.renderHideout();
        break;
      case 'bag':
        if (msg.items.length > this.bag.length && this.phase !== 'lobby') {
          sfx.pickup();
          this.hud.kill(`+ ${ITEMS[msg.items[msg.items.length - 1]].name}`);
        }
        this.bag = msg.items;
        this.bagCapacity = msg.capacity;
        break;
      case 'loot':
        this.syncLoot(msg.items);
        break;
      case 'result':
        this.result = { outcome: msg.outcome, items: msg.items };
        if (msg.outcome === 'extracted' || msg.outcome === 'survived') sfx.extracted();
        else sfx.failed();
        break;
    }
  }

  private onSnap(msg: Extract<ServerMsg, { t: 'snap' }>) {
    const prevMe = this.me;
    this.phaseSounds(this.phase, msg.phase);
    // The last raid's result stays up (and in the lobby) until the next one starts.
    if (msg.phase === 'countdown' && this.phase !== 'countdown') this.result = null;
    const newPhase = msg.phase !== this.phase;
    this.phase = msg.phase;
    this.timeLeft = msg.timeLeft;
    this.timeAt = performance.now();
    this.latest = new Map(msg.players.map((p) => [p.id, p]));
    this.roster = new Map(msg.roster.map((p) => [p.id, p]));
    // The server fills the clip when a raid starts or you switch character.
    if (newPhase || this.me?.character !== prevMe?.character) this.lastRocket = -Infinity;
    this.snaps.push({ at: this.timeAt, players: this.latest });
    this.rocketFx.sync(msg.rockets ?? []);
    while (this.snaps.length > 30) this.snaps.shift();

    const me = this.me;
    if (me && prevMe && me.alive && me.role === 'prop' && prevMe.role === 'prop' && me.prop !== prevMe.prop && msg.phase !== 'lobby') sfx.disguise();
    const step = me?.alive ? Math.floor((me.extracting ?? 0) * 5) : 0;
    if (step > this.extractStep) sfx.extractTick(step);
    this.extractStep = step;
    if (!me || !me.alive || me.role === 'spectator') {
      this.body = null;
      this.pending = [];
      return;
    }
    const before = this.body ? ([...this.body.pos] as Vec3) : null;
    this.body = {
      pos: [...me.pos], vy: me.vy, vx: me.vx ?? 0, vz: me.vz ?? 0, onGround: me.onGround, stamina: me.stamina, winded: me.winded,
      charge: me.charge ?? 0, chargeX: me.chargeX ?? 0, chargeZ: me.chargeZ ?? 0,
    };
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
    const was = { onGround: this.body.onGround, vy: this.body.vy, winded: this.body.winded };
    stepBody(this.body, me.role, me.prop, keys, yaw, this.phase === 'hide' && me.role === 'hunter', TICK_DT, this.map.solids, me.speed);
    this.pending.push(input);
    this.movementSounds(was, keys.sprint);
  }

  /** Footsteps, jumps and landings from our own predicted movement. */
  private movementSounds(was: { onGround: boolean; vy: number; winded: boolean }, sprintKey: boolean) {
    const b = this.body!;
    if (b.winded && !was.winded) sfx.winded();
    if (was.onGround && !b.onGround && b.vy > 0) sfx.jump();
    if (!was.onGround && b.onGround && was.vy < -6) {
      sfx.land();
      this.shake(0.08, 120);
    }
    const moved = Math.hypot(b.pos[0] - this.prevPos[0], b.pos[2] - this.prevPos[2]);
    if (!b.onGround || moved < 1e-3) return;
    const sprinting = sprintKey && !b.winded && b.stamina > 0;
    this.stride += moved;
    if (this.stride > (sprinting ? 1.9 : 1.5)) {
      this.stride = 0;
      sfx.footstep(sprinting);
    }
  }

  private get raidElapsed() {
    return (performance.now() - this.raidStartedAt) / 1000;
  }

  private phaseSounds(from: Phase, to: Phase) {
    if (from === 'countdown') this.raidStartedAt = performance.now();
    if (from === 'countdown' && (to === 'hide' || to === 'hunt')) sfx.countdown(true);
    if (from === 'hide' && to === 'hunt' && this.huntersInRound()) sfx.huntStart();
  }

  private floatDamage(pos: Vec3, text: string, killed: boolean) {
    const el = document.createElement('div');
    el.className = killed ? 'dmg-float kill' : 'dmg-float';
    el.textContent = text;
    document.body.appendChild(el);
    const at = new THREE.Vector3(pos[0] + (Math.random() - 0.5) * 0.4, pos[1] + 1.9, pos[2] + (Math.random() - 0.5) * 0.4);
    this.floats.push({ el, pos: at, born: performance.now() });
  }

  private updateFloats(now: number) {
    const v = new THREE.Vector3();
    this.floats = this.floats.filter((f) => {
      const age = (now - f.born) / 1000;
      if (age > 1) {
        f.el.remove();
        return false;
      }
      v.copy(f.pos).setY(f.pos.y + age * 0.8).project(this.camera);
      const behind = v.z > 1;
      f.el.style.display = behind ? 'none' : '';
      f.el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, 2.5 * (1 - age)));
      return true;
    });
  }

  private shake(amount: number, ms: number) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeUntil = Math.max(this.shakeUntil, performance.now() + ms);
  }

  private shoot() {
    const me = this.me;
    if (!me) return;
    if (!me.alive) {
      this.spectateIndex++;
      return;
    }
    if (me.role === 'prop') {
      const weapon = characterOf(me.character).weapon;
      if (weapon.kind === 'hitscan') this.fireGun(weapon.cooldown);
      else this.fireRocket(weapon);
      return;
    }
    if (me.role !== 'hunter' || this.phase !== 'hunt') return;
    this.fireGun(FIRE_COOLDOWN);
  }

  /** Hitscan: the server traces the ray and broadcasts the shot. */
  private fireGun(cooldown: number) {
    if (this.phase === 'end' || this.huntersBlind()) return;
    const now = performance.now();
    if (now - this.lastShot < cooldown * 1000) return;
    this.lastShot = now;
    const p = this.camera.position;
    this.net.send({ t: 'shoot', origin: [p.x, p.y, p.z], dir: lookDir(this.controls.yaw, this.controls.pitch) });
  }

  /** Props fire a rocket where the crosshair points; the server decides if it's allowed. */
  private fireRocket(weapon: WeaponDef) {
    if (this.phase === 'end' || this.huntersBlind()) return;
    const now = performance.now();
    if (now - this.lastRocket < weapon.cooldown * 1000) return;
    const ammo = ammoAfter(weapon, this.ammo, this.lastRocket / 1000, now / 1000);
    if (ammo < 1) return;
    this.ammo = ammo - 1;
    this.lastRocket = now;
    const p = this.camera.position;
    this.net.send({ t: 'rocket', origin: [p.x, p.y, p.z], dir: lookDir(this.controls.yaw, this.controls.pitch) });
    // The server launches it after a short wind-up; the whoosh matches.
    const grenade = characterOf(this.me?.character).weapon.kind === 'grenade';
    setTimeout(() => {
      if (grenade) sfx.grenadeFire();
      else sfx.rocketFire();
      this.shake(0.05, 100);
    }, ROCKET_DELAY * 1000);
  }

  /**
   * The character's right-click skill: hold to charge, let go to use it.
   * The server checks the cooldown too.
   */
  private useSkill(down: boolean) {
    const me = this.me;
    const skill = me && characterOf(me.character).skill;
    if (!me?.alive || me.role !== 'prop' || !skill || this.phase === 'end' || this.huntersBlind()) {
      this.skillHeldSince = null;
      return;
    }
    const now = performance.now();
    if (down) {
      if (skillUses(skill, this.skillFullAt, now / 1000) >= 1) this.skillHeldSince = now;
      return;
    }
    if (this.skillHeldSince === null) return;
    const power = this.skillPower(skill.chargeTime);
    this.skillHeldSince = null;
    this.skillFullAt = spendSkill(skill, this.skillFullAt, now / 1000);
    this.net.send({ t: 'skill', yaw: this.controls.yaw, pitch: this.controls.pitch, power });
    sfx.charge();
    this.shake(0.12 + 0.15 * power, 250);
  }

  /** 0..1: how far the held skill has charged. */
  private skillPower(chargeTime: number) {
    return this.skillHeldSince === null ? 0 : Math.min(1, (performance.now() - this.skillHeldSince) / 1000 / chargeTime);
  }

  /** Props hold fire while hunters wait out the hiding phase. */
  private huntersBlind() {
    return this.phase === 'hide' && this.huntersInRound();
  }

  private huntersInRound() {
    return [...this.roster.values()].some((p) => p.role === 'hunter');
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
    if (this.controls.firing && this.me?.role === 'prop' && characterOf(this.me.character).weapon.auto) this.shoot();
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.updateFloats(now);
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
      avatar.setLook(isMe ? me.role : p.role, isMe ? me.prop : p.prop, !!p.dummy);
      avatar.setGhost(!!isMe && me.invisible);
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
    this.updateStation(myPos);
    for (const { mesh } of this.loot.values()) {
      const spin = mesh.userData.spin as THREE.Object3D;
      spin.rotation.y = now / 600;
      spin.position.y = 0.25 + Math.sin(now / 300) * 0.04;
    }
    if (this.hideout.open && now - this.lastHideoutRender > 500) this.renderHideout();
    this.updateHud(me);
    this.rocketFx.update();
    this.world.follow(this.camera.position.x, this.camera.position.z);
    if (myPos) this.mapView.draw(myPos.x, myPos.z, this.controls.yaw);

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

    // A little shake on hits and landings, and a wider view while sprinting.
    const now = performance.now();
    if (now < this.shakeUntil) {
      const a = this.shakeAmount * ((this.shakeUntil - now) / 300);
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
    } else {
      this.shakeAmount = 0;
    }
    const b = this.body;
    const moving = this.controls.keys.f || this.controls.keys.b || this.controls.keys.l || this.controls.keys.r;
    const sprinting = !!b && moving && this.controls.keys.sprint && !b.winded && b.stamina > 0;
    const targetFov = sprinting ? 77 : 70;
    if (Math.abs(this.fov - targetFov) > 0.05) {
      this.fov += (targetFov - this.fov) * 0.12;
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateDisguiseTarget(me: PlayerSnap | undefined, myPos: THREE.Vector3 | null) {
    this.disguiseTarget = null;
    this.disguiseLocked = null;
    this.highlight.visible = false;
    if (!me || !myPos || me.role !== 'prop' || characterOf(me.character).disguise !== 'prop' || this.phase === 'end') return;
    const fwd = new THREE.Vector3(...lookDir(this.controls.yaw, this.controls.pitch));
    this.raycaster.set(this.camera.position, fwd);
    this.raycaster.far = 20;
    const hit = this.raycaster.intersectObjects(this.world.colliders, false)[0];
    const ids = hit?.object.userData.propIds as number[] | undefined;
    const id = ids && hit?.instanceId !== undefined ? ids[hit.instanceId] : undefined;
    if (!hit || id === undefined) return;
    const size = bodySize(me.role, me.prop);
    const center = myPos.clone().add(new THREE.Vector3(0, size[1] / 2, 0));
    if (center.distanceTo(hit.point) > DISGUISE_RANGE) return;
    if (!canDisguiseAs(this.profile, this.map.props[id].type)) {
      this.disguiseLocked = id;
      return;
    }
    this.disguiseTarget = id;
    const box = this.map.propBoxes[id];
    this.highlight.box.min.set(...box.min);
    this.highlight.box.max.set(...box.max);
    this.highlight.visible = true;
  }

  private updateHud(me: PlayerSnap | undefined) {
    const left = Math.max(0, this.timeLeft - (performance.now() - this.timeAt) / 1000);
    this.hud.phase(this.phase, left, THEME_NAMES[this.map.theme], this.manualStart, !this.huntersInRound());
    this.hud.me(me, this.phase, this.map.theme);
    this.hud.stamina(this.body ? this.body.stamina : null, !!this.body?.winded);
    const weapon = me?.alive && me.role === 'prop' ? characterOf(me.character).weapon : null;
    if (weapon?.clip) {
      const now = performance.now() / 1000;
      const left = ammoAfter(weapon, this.ammo, this.lastRocket / 1000, now);
      this.hud.ammo(left, weapon.clip, left < 1 ? weapon.reload - (now - this.lastRocket / 1000) : 0);
    } else this.hud.ammo(null, 0, 0);
    const at = this.body?.pos ?? [this.camera.position.x, 0, this.camera.position.z];
    const zone = this.map.theme === 'hideout' ? null : zoneAt(this.map, at[0], at[2]);
    this.hud.zone(zone?.name ?? '');
    this.hud.blind(this.phase === 'hide' && me?.role === 'hunter', left);
    this.hud.inventory(this.inventoryOpen, {
      bag: this.bag,
      capacity: this.bagCapacity,
      stash: this.map.theme === 'hideout' ? this.profile.stash : null,
      players: [...this.roster.values()],
      visible: this.latest,
      myId: this.myId,
      canDrop: !!me?.alive && (this.phase === 'hide' || this.phase === 'hunt') && !this.map.stations,
    });

    const beep = this.phase === 'countdown' && left > 0 ? Math.ceil(left) : 0;
    if (beep && beep <= 3 && beep !== this.countdownBeep) sfx.countdown(false);
    this.countdownBeep = beep;
    if (this.phase === 'end') this.hud.roundEnd(this.winner, this.result?.outcome ?? null);
    else if (this.phase === 'countdown') this.hud.center(`라운드 시작까지 ${Math.ceil(left)}`);
    else if (this.phase === 'hide' && me?.role === 'prop' && me.alive && this.huntersInRound()) {
      this.hud.center(left > 5 ? '헌터가 오기 전에 숨으세요!' : `헌터 출발까지 ${Math.ceil(left)}`);
    } else if (me?.role === 'prop' && me.alive && !this.huntersInRound() && (this.phase === 'hide' || this.phase === 'hunt') && this.raidElapsed < 15) {
      this.hud.center('모두가 적이에요 · 챙겨서 탈출하세요');
    }
    else this.hud.center('');

    const inRaid = !!me?.alive && me.role !== 'spectator' && (this.phase === 'hide' || this.phase === 'hunt');
    this.hud.bag(this.bag, this.bagCapacity, inRaid);
    this.hud.extract(me?.alive ? me.extracting : 0);
    this.hud.result(this.phase === 'lobby' && this.map.theme !== 'hideout' ? null : this.result?.outcome ?? null, this.result?.items ?? []);

    const hints: string[] = [];
    if (this.station && this.pickupTarget === null) hints.push(STATION_HINTS[this.station]);
    if (this.pickupTarget !== null) {
      const name = ITEMS[this.loot.get(this.pickupTarget)!.data.type].name;
      hints.push(this.bag.length >= this.bagCapacity ? `가방이 가득 찼어요 (${name})` : `F: ${name} 줍기`);
    }
    if (me?.alive && me.role === 'prop' && this.map.theme !== 'hideout') {
      const char = characterOf(me.character);
      if (char.disguise === 'invisible') hints.push(me.invisible ? '투명 상태 (움직이거나 공격하면 풀려요)' : '가만히 2초 있으면 투명');
      if (char.disguise === 'decoy') {
        const left = DECOY_COOLDOWN - (performance.now() - this.lastDecoy) / 1000;
        hints.push(`E: 분신 세우기${left > 0 ? ` (${Math.ceil(left)}초)` : ''}`);
      }
      if (char.skill) {
        const now = performance.now() / 1000;
        const uses = skillUses(char.skill, this.skillFullAt, now);
        const next = nextSkillIn(char.skill, this.skillFullAt, now);
        const pips = '●'.repeat(uses) + '○'.repeat(char.skill.stacks - uses);
        if (this.skillHeldSince !== null) hints.push(`${char.skill.name} 충전 ${Math.round(this.skillPower(char.skill.chargeTime) * 100)}%`);
        else hints.push(`우클릭 누르고 떼기: ${char.skill.name} ${pips}${next > 0 ? ` (${Math.ceil(next)}초)` : ''}`);
      }
    }
    if (this.disguiseTarget !== null) hints.push(`E: ${PROPS[this.map.props[this.disguiseTarget].type].name}(으)로 변신`);
    if (this.disguiseLocked !== null) hints.push(`${PROPS[this.map.props[this.disguiseLocked].type].name}: 변신 도감 업그레이드 필요`);
    if (me && me.role !== 'spectator' && (this.phase === 'lobby' || this.phase === 'countdown')) {
      hints.push(`C: 캐릭터 변경 (${CHARACTERS[me.character]?.name ?? ''})`);
    }
    if (!this.manualStart && (this.phase === 'lobby' || this.phase === 'countdown')) hints.push('B: 프롭 봇 추가');
    let hint = hints.join(' · ');
    if (me?.role === 'prop' && me.alive && this.faceLocked) hint += `${hint ? ' · ' : ''}방향 고정됨 (R)`;
    if (!this.controls.active && !this.hideout.open) hint = '화면을 클릭하면 조작을 시작해요';
    else if (this.controls.dragMode && !this.hideout.open && !hint) hint = '드래그해서 둘러보고, 짧게 클릭하면 사격해요';
    this.hud.hint(hint);
  }

  /** Hunters, and props with a sniper rifle, pay for shooting a map prop. */
  private decoyHurts() {
    const me = this.me;
    return !!me && (me.role === 'hunter' || characterOf(me.character).weapon.decoyPenalty);
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

  private updateStation(myPos: THREE.Vector3 | null) {
    this.station = null;
    if (!myPos || !this.map.stations || this.phase !== 'lobby') return;
    let best = STATION_RANGE;
    for (const [station, at] of Object.entries(this.map.stations) as [Station, Vec3][]) {
      const d = Math.hypot(at[0] - myPos.x, at[2] - myPos.z);
      if (d < best) {
        best = d;
        this.station = station;
      }
    }
  }

  private useStation(station: Station) {
    if (station === 'door' || station === 'range' || station === 'leave') {
      this.hideout.toggle(false);
      this.net.send(station === 'door' ? { t: 'start' } : { t: 'practice', on: station === 'range' });
      return;
    }
    sfx.open();
    this.hideout.toggle(true, station);
    this.renderHideout();
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
