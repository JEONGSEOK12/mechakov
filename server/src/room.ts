import {
  DEFAULT_PROP, DEFAULT_TIMINGS, DISGUISE_RANGE, FIRE_COOLDOWN, HUNTER_EYE, MAX_HP, MAX_PLAYERS,
  MIN_PLAYERS, MISS_PENALTY, SHOT_DAMAGE, SHOT_RANGE, TICK_DT, type Timings,
} from '../../shared/constants.ts';
import { boxAt, pointBoxDistance, rayBox } from '../../shared/geometry.ts';
import { generateMap, type GameMap } from '../../shared/map.ts';
import { bodySize, stepBody, unstick, type BodyState } from '../../shared/physics.ts';
import type { ClientMsg, PlayerSnap, ServerMsg, ShotHit } from '../../shared/protocol.ts';
import type { InputKeys, Phase, Role, Team, Vec3 } from '../../shared/types.ts';

export interface Conn {
  send(data: string): void;
}

type InputMsg = Extract<ClientMsg, { t: 'input' }>;

export class Player {
  role: Role = 'prop';
  alive = true;
  hp = MAX_HP;
  body: BodyState = { pos: [0, 0, 0], vy: 0, onGround: false };
  prop: string | null = DEFAULT_PROP;
  yaw = 0;
  pitch = 0;
  face = 0;
  seq = 0;
  inputs: InputMsg[] = [];
  lastShot = -Infinity;

  constructor(readonly id: number, public name: string, readonly conn: Conn) {}

  snap(): PlayerSnap {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      alive: this.alive,
      hp: this.hp,
      pos: [...this.body.pos],
      vy: this.body.vy,
      onGround: this.body.onGround,
      yaw: this.yaw,
      pitch: this.pitch,
      face: this.face,
      prop: this.prop,
      seq: this.seq,
    };
  }
}

const isBool = (v: unknown) => typeof v === 'boolean';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

function validKeys(k: unknown): k is InputKeys {
  if (!k || typeof k !== 'object') return false;
  const o = k as Record<string, unknown>;
  return ['f', 'b', 'l', 'r', 'jump', 'sprint'].every((key) => isBool(o[key]));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Room {
  readonly players = new Map<number, Player>();
  readonly map: GameMap;
  phase: Phase = 'lobby';
  time = 0;
  phaseEnds = 0;
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly name: string,
    seed: number,
    readonly timings: Timings = DEFAULT_TIMINGS,
  ) {
    this.map = generateMap(seed);
  }

  start() {
    this.timer ??= setInterval(() => this.tick(), TICK_DT * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get full() {
    return this.players.size >= MAX_PLAYERS;
  }

  addPlayer(conn: Conn, rawName: unknown): Player {
    const id = this.nextId++;
    const name = (typeof rawName === 'string' ? rawName.trim().slice(0, 16) : '') || `Player ${id}`;
    const p = new Player(id, name, conn);
    this.players.set(id, p);
    if (this.phase === 'lobby' || this.phase === 'countdown') {
      this.resetForLobby(p);
    } else {
      p.role = 'spectator';
      p.alive = false;
      p.prop = null;
    }
    this.send(p, { t: 'welcome', id, seed: this.map.seed, room: this.name });
    return p;
  }

  removePlayer(id: number) {
    this.players.delete(id);
  }

  handle(p: Player, msg: ClientMsg) {
    switch (msg.t) {
      case 'input':
        if (!isNum(msg.seq) || !validKeys(msg.keys) || !isNum(msg.yaw) || !isNum(msg.pitch) || !isNum(msg.face)) return;
        p.inputs.push(msg);
        if (p.inputs.length > 10) p.inputs.shift();
        break;
      case 'shoot':
        if (isVec3(msg.origin) && isVec3(msg.dir)) this.shoot(p, msg.origin, msg.dir);
        break;
      case 'disguise':
        if (isNum(msg.propId)) this.disguise(p, msg.propId);
        break;
    }
  }

  tick() {
    this.time += TICK_DT;
    this.updatePhase();

    const frozenHunters = this.phase === 'hide';
    for (const p of this.players.values()) {
      if (!p.alive) {
        const last = p.inputs.at(-1);
        if (last) p.seq = last.seq;
        p.inputs.length = 0;
        continue;
      }
      // Normally one input per tick; catch up a little when a client falls behind.
      const steps = p.inputs.length > 2 ? 2 : 1;
      for (let i = 0; i < steps; i++) {
        const input = p.inputs.shift();
        if (!input) break;
        p.yaw = input.yaw;
        p.pitch = Math.max(-1.5, Math.min(1.5, input.pitch));
        p.face = input.face;
        const frozen = frozenHunters && p.role === 'hunter';
        stepBody(p.body, p.role, p.prop, input.keys, p.yaw, frozen, TICK_DT, this.map.solids);
        p.seq = input.seq;
      }
    }

    this.broadcast({
      t: 'snap',
      time: this.time,
      phase: this.phase,
      timeLeft: Math.max(0, this.phaseEnds - this.time),
      players: [...this.players.values()].map((p) => p.snap()),
    });
  }

  private updatePhase() {
    const count = this.players.size;
    const expired = this.time >= this.phaseEnds;
    switch (this.phase) {
      case 'lobby':
        if (count >= MIN_PLAYERS) this.setPhase('countdown', this.timings.countdown);
        break;
      case 'countdown':
        if (count < MIN_PLAYERS) this.setPhase('lobby', 0);
        else if (expired) this.startRound();
        break;
      case 'hide':
      case 'hunt': {
        const living = (role: Role) => [...this.players.values()].filter((p) => p.role === role && p.alive).length;
        if (living('prop') === 0) this.endRound('hunters');
        else if (living('hunter') === 0) this.endRound('props');
        else if (expired && this.phase === 'hide') this.setPhase('hunt', this.timings.hunt);
        else if (expired) this.endRound('props');
        break;
      }
      case 'end':
        if (expired) this.goToLobby();
        break;
    }
  }

  private setPhase(phase: Phase, duration: number) {
    this.phase = phase;
    this.phaseEnds = this.time + duration;
  }

  private resetForLobby(p: Player) {
    p.role = 'prop';
    p.alive = true;
    p.hp = MAX_HP;
    p.prop = DEFAULT_PROP;
    this.spawn(p, this.map.propSpawns[Math.floor(Math.random() * this.map.propSpawns.length)]);
  }

  private spawn(p: Player, at: Vec3) {
    p.body = { pos: [at[0] + (Math.random() - 0.5) * 0.5, at[1], at[2] + (Math.random() - 0.5) * 0.5], vy: 0, onGround: false };
    p.inputs.length = 0;
    unstick(p.body, bodySize(p.role, p.prop), this.map.solids);
  }

  private startRound() {
    const all = shuffle([...this.players.values()]);
    const hunterCount = Math.max(1, Math.round(all.length / 4));
    const propSpawns = shuffle(this.map.propSpawns);
    all.forEach((p, i) => {
      p.alive = true;
      p.hp = MAX_HP;
      p.lastShot = -Infinity;
      if (i < hunterCount) {
        p.role = 'hunter';
        p.prop = null;
        this.spawn(p, this.map.hunterSpawns[i % this.map.hunterSpawns.length]);
      } else {
        p.role = 'prop';
        p.prop = DEFAULT_PROP;
        this.spawn(p, propSpawns[(i - hunterCount) % propSpawns.length]);
      }
    });
    this.setPhase('hide', this.timings.hide);
  }

  private endRound(winner: Team | null) {
    this.setPhase('end', this.timings.end);
    this.broadcast({ t: 'roundEnd', winner });
  }

  private goToLobby() {
    this.setPhase('lobby', 0);
    for (const p of this.players.values()) this.resetForLobby(p);
  }

  private disguise(p: Player, propId: number) {
    if (!p.alive || p.role !== 'prop' || this.phase === 'end') return;
    const target = this.map.props[propId];
    if (!target) return;
    const size = bodySize(p.role, p.prop);
    const center: Vec3 = [p.body.pos[0], p.body.pos[1] + size[1] / 2, p.body.pos[2]];
    if (pointBoxDistance(center, this.map.propBoxes[propId]) > DISGUISE_RANGE + 0.5) return;
    p.prop = target.type;
    unstick(p.body, bodySize(p.role, p.prop), this.map.solids);
  }

  private shoot(p: Player, origin: Vec3, rawDir: Vec3) {
    if (!p.alive || p.role !== 'hunter' || this.phase !== 'hunt') return;
    if (this.time - p.lastShot < FIRE_COOLDOWN - 0.05) return;
    const len = Math.hypot(...rawDir);
    if (len < 1e-6) return;
    const dir: Vec3 = [rawDir[0] / len, rawDir[1] / len, rawDir[2] / len];
    const eye: Vec3 = [p.body.pos[0], p.body.pos[1] + HUNTER_EYE, p.body.pos[2]];
    // The client aims from its third-person camera; accept that ray only if the
    // camera is near the hunter, and start it level with the hunter so it can't
    // hit things behind them.
    if (Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) > 6) return;
    p.lastShot = this.time;
    const along = Math.max(0, (eye[0] - origin[0]) * dir[0] + (eye[1] - origin[1]) * dir[1] + (eye[2] - origin[2]) * dir[2]);
    const start: Vec3 = [origin[0] + dir[0] * along, origin[1] + dir[1] * along, origin[2] + dir[2] * along];

    let best = SHOT_RANGE;
    let hit: ShotHit = 'none';
    let target: Player | null = null;
    for (const w of this.map.walls) {
      const t = rayBox(start, dir, w);
      if (t !== null && t < best) [best, hit, target] = [t, 'world', null];
    }
    for (const b of this.map.propBoxes) {
      const t = rayBox(start, dir, b);
      if (t !== null && t < best) [best, hit, target] = [t, 'decoy', null];
    }
    for (const other of this.players.values()) {
      if (other === p || !other.alive) continue;
      const t = rayBox(start, dir, boxAt(other.body.pos, bodySize(other.role, other.prop)));
      if (t !== null && t < best) [best, hit, target] = [t, other.role === 'prop' ? 'player' : 'world', other.role === 'prop' ? other : null];
    }
    // The floor.
    if (dir[1] < 0) {
      const t = -start[1] / dir[1];
      if (t < best) [best, hit, target] = [t, 'world', null];
    }

    const end: Vec3 = [start[0] + dir[0] * best, start[1] + dir[1] * best, start[2] + dir[2] * best];
    this.broadcast({ t: 'shot', from: p.id, origin: eye, end, hit, target: target?.id });

    if (target) this.damage(target, SHOT_DAMAGE, p);
    else if (hit === 'decoy') this.damage(p, MISS_PENALTY, null);
  }

  private damage(victim: Player, amount: number, killer: Player | null) {
    victim.hp = Math.max(0, victim.hp - amount);
    if (victim.hp > 0) return;
    victim.alive = false;
    this.broadcast({ t: 'kill', killer: killer?.id ?? null, victim: victim.id });
  }

  private send(p: Player, msg: ServerMsg) {
    p.conn.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) p.conn.send(data);
  }
}
