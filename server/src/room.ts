import {
  DEFAULT_PROP, DEFAULT_TIMINGS, DISGUISE_RANGE, FIRE_COOLDOWN, HUNTER_EYE, LOOT_PER_ROUND,
  MAX_PLAYERS, MIN_PLAYERS, PICKUP_RANGE, SHOT_DAMAGE, SHOT_RANGE, TICK_DT, type Timings,
} from '../../shared/constants.ts';
import { boxAt, pointBoxDistance, rayBox } from '../../shared/geometry.ts';
import { ITEMS, ITEM_TYPES } from '../../shared/items.ts';
import { generateMap, type GameMap } from '../../shared/map.ts';
import { bodySize, stepBody, unstick, type BodyState } from '../../shared/physics.ts';
import type { ClientMsg, Loot, Outcome, PlayerSnap, ServerMsg, ShotHit } from '../../shared/protocol.ts';
import type { InputKeys, Phase, Role, Team, Vec3 } from '../../shared/types.ts';
import {
  bagCapacity, canAfford, canDisguiseAs, maxHp, missPenalty, nextCost, speedMult, UPGRADES, type Profile,
} from '../../shared/upgrades.ts';
import { ProfileStore } from './profiles.ts';

export interface Conn {
  send(data: string): void;
}

type InputMsg = Extract<ClientMsg, { t: 'input' }>;

export class Player {
  role: Role = 'prop';
  alive = true;
  extracted = false;
  hp = 100;
  body: BodyState = { pos: [0, 0, 0], vy: 0, onGround: false };
  prop: string | null = DEFAULT_PROP;
  yaw = 0;
  pitch = 0;
  face = 0;
  seq = 0;
  inputs: InputMsg[] = [];
  lastShot = -Infinity;
  /** Items picked up this raid; lost on death. */
  bag: string[] = [];
  extractTime = 0;
  /** Set once the player's raid is decided; null while still in play. */
  outcome: Outcome | null = null;
  inRound = false;

  constructor(readonly id: number, readonly token: string, readonly profile: Profile, readonly conn: Conn) {}

  get name() {
    return this.profile.name;
  }

  snap(extractTime: number): PlayerSnap {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      alive: this.alive,
      extracted: this.extracted,
      hp: this.hp,
      maxHp: maxHp(this.profile),
      speed: speedMult(this.profile),
      extracting: Math.min(1, this.extractTime / extractTime),
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

function inBox(p: Vec3, b: { min: Vec3; max: Vec3 }) {
  return p[0] >= b.min[0] && p[0] <= b.max[0] && p[2] >= b.min[2] && p[2] <= b.max[2] && p[1] <= b.max[1] + 0.5;
}

export class Room {
  readonly players = new Map<number, Player>();
  readonly map: GameMap;
  phase: Phase = 'lobby';
  time = 0;
  phaseEnds = 0;
  loot = new Map<number, Loot>();
  private nextId = 1;
  private nextLootId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly name: string,
    seed: number,
    readonly timings: Timings = DEFAULT_TIMINGS,
    readonly store = new ProfileStore(),
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

  addPlayer(conn: Conn, rawName: unknown, token: string, profile: Profile): Player {
    const id = this.nextId++;
    profile.name = (typeof rawName === 'string' ? rawName.trim().slice(0, 16) : '') || profile.name || `Player ${id}`;
    const p = new Player(id, token, profile, conn);
    this.players.set(id, p);
    if (this.phase === 'lobby' || this.phase === 'countdown') {
      this.resetForLobby(p);
    } else {
      p.role = 'spectator';
      p.alive = false;
      p.prop = null;
    }
    this.send(p, { t: 'welcome', id, seed: this.map.seed, room: this.name, token, profile });
    this.send(p, { t: 'loot', items: [...this.loot.values()] });
    this.sendBag(p);
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
      case 'pickup':
        if (isNum(msg.lootId)) this.pickup(p, msg.lootId);
        break;
      case 'upgrade':
        if (typeof msg.id === 'string') this.upgrade(p, msg.id);
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
        stepBody(p.body, p.role, p.prop, input.keys, p.yaw, frozen, TICK_DT, this.map.solids, speedMult(p.profile));
        p.seq = input.seq;
      }
      this.updateExtraction(p);
    }

    this.broadcast({
      t: 'snap',
      time: this.time,
      phase: this.phase,
      timeLeft: Math.max(0, this.phaseEnds - this.time),
      players: [...this.players.values()].map((p) => p.snap(this.timings.extract)),
    });
  }

  private updateExtraction(p: Player) {
    if (this.phase !== 'hunt' || p.role !== 'prop' || !this.map.exits.some((e) => inBox(p.body.pos, e))) {
      p.extractTime = 0;
      return;
    }
    p.extractTime += TICK_DT;
    if (p.extractTime >= this.timings.extract) {
      p.extracted = true;
      p.alive = false;
      this.finishRaid(p, 'extracted');
    }
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
        if (living('prop') === 0) this.endRound('noProps');
        else if (living('hunter') === 0) this.endRound('noHunters');
        else if (expired && this.phase === 'hide') this.setPhase('hunt', this.timings.hunt);
        else if (expired) this.endRound('time');
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
    p.extracted = false;
    p.hp = maxHp(p.profile);
    p.prop = DEFAULT_PROP;
    p.bag = [];
    p.outcome = null;
    p.inRound = false;
    p.extractTime = 0;
    this.spawn(p, this.map.propSpawns[Math.floor(Math.random() * this.map.propSpawns.length)]);
  }

  private spawn(p: Player, at: Vec3) {
    p.body = { pos: [at[0] + (Math.random() - 0.5) * 0.5, at[1], at[2] + (Math.random() - 0.5) * 0.5], vy: 0, onGround: false };
    p.inputs.length = 0;
    unstick(p.body, bodySize(p.role, p.prop), this.map.solids);
  }

  private spawnLoot() {
    this.loot.clear();
    const total = ITEM_TYPES.reduce((s, k) => s + ITEMS[k].weight, 0);
    for (const pos of shuffle(this.map.lootSpots).slice(0, LOOT_PER_ROUND)) {
      let r = Math.random() * total;
      const type = ITEM_TYPES.find((k) => (r -= ITEMS[k].weight) <= 0) ?? ITEM_TYPES[0];
      const id = this.nextLootId++;
      this.loot.set(id, { id, type, pos });
    }
    this.broadcast({ t: 'loot', items: [...this.loot.values()] });
  }

  private startRound() {
    const all = shuffle([...this.players.values()]);
    const hunterCount = Math.max(1, Math.round(all.length / 4));
    const propSpawns = shuffle(this.map.propSpawns);
    all.forEach((p, i) => {
      p.alive = true;
      p.extracted = false;
      p.inRound = true;
      p.outcome = null;
      p.bag = [];
      p.extractTime = 0;
      p.hp = maxHp(p.profile);
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
      this.sendBag(p);
    });
    this.spawnLoot();
    this.setPhase('hide', this.timings.hide);
  }

  /** Decides a player's raid: banks their bag unless they died or went missing. */
  private finishRaid(p: Player, outcome: Outcome) {
    if (p.outcome) return;
    p.outcome = outcome;
    const items = p.bag;
    if (outcome === 'extracted' || outcome === 'survived') {
      for (const item of items) p.profile.stash[item] = (p.profile.stash[item] ?? 0) + 1;
      this.store.save();
      this.send(p, { t: 'profile', profile: p.profile });
    }
    p.bag = [];
    this.send(p, { t: 'result', outcome, items });
    this.sendBag(p);
  }

  private endRound(reason: 'noProps' | 'noHunters' | 'time') {
    for (const p of this.players.values()) {
      if (!p.inRound || p.outcome) continue;
      if (!p.alive) this.finishRaid(p, 'died');
      else if (p.role === 'hunter') this.finishRaid(p, 'survived');
      // Props still hiding get out if every hunter is gone; otherwise they are missing in action.
      else this.finishRaid(p, reason === 'noHunters' ? 'survived' : 'mia');
    }
    const propsWon = [...this.players.values()].some(
      (p) => p.inRound && p.role === 'prop' && (p.outcome === 'extracted' || p.outcome === 'survived'),
    );
    const winner: Team = propsWon ? 'props' : 'hunters';
    this.setPhase('end', this.timings.end);
    this.loot.clear();
    this.broadcast({ t: 'loot', items: [] });
    this.broadcast({ t: 'roundEnd', winner });
  }

  private goToLobby() {
    this.setPhase('lobby', 0);
    for (const p of this.players.values()) this.resetForLobby(p);
  }

  private disguise(p: Player, propId: number) {
    if (!p.alive || p.role !== 'prop' || this.phase === 'end') return;
    const target = this.map.props[propId];
    if (!target || !canDisguiseAs(p.profile, target.type)) return;
    const size = bodySize(p.role, p.prop);
    const center: Vec3 = [p.body.pos[0], p.body.pos[1] + size[1] / 2, p.body.pos[2]];
    if (pointBoxDistance(center, this.map.propBoxes[propId]) > DISGUISE_RANGE + 0.5) return;
    p.prop = target.type;
    unstick(p.body, bodySize(p.role, p.prop), this.map.solids);
  }

  private pickup(p: Player, lootId: number) {
    if (!p.alive || p.role !== 'prop' || (this.phase !== 'hide' && this.phase !== 'hunt')) return;
    const item = this.loot.get(lootId);
    if (!item || p.bag.length >= bagCapacity(p.profile)) return;
    const size = bodySize(p.role, p.prop);
    const center: Vec3 = [p.body.pos[0], p.body.pos[1] + size[1] / 2, p.body.pos[2]];
    const d = Math.hypot(center[0] - item.pos[0], center[1] - item.pos[1], center[2] - item.pos[2]);
    if (d > PICKUP_RANGE + Math.max(...size) / 2) return;
    this.loot.delete(lootId);
    p.bag.push(item.type);
    this.sendBag(p);
    this.broadcast({ t: 'loot', items: [...this.loot.values()] });
  }

  private upgrade(p: Player, id: string) {
    // Upgrades happen in the hideout, between raids.
    if (!UPGRADES[id] || (p.inRound && !p.outcome && this.phase !== 'end')) return;
    const cost = nextCost(p.profile, id);
    if (!cost || !canAfford(p.profile, cost)) return;
    for (const [item, n] of Object.entries(cost)) {
      p.profile.stash[item] -= n;
      if (p.profile.stash[item] <= 0) delete p.profile.stash[item];
    }
    p.profile.upgrades[id] = (p.profile.upgrades[id] ?? 0) + 1;
    if (this.phase === 'lobby' || this.phase === 'countdown') p.hp = maxHp(p.profile);
    this.store.save();
    this.send(p, { t: 'profile', profile: p.profile });
    this.sendBag(p);
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
    else if (hit === 'decoy') this.damage(p, missPenalty(p.profile), null);
  }

  private damage(victim: Player, amount: number, killer: Player | null) {
    victim.hp = Math.max(0, victim.hp - amount);
    if (victim.hp > 0) return;
    victim.alive = false;
    // The hunter takes what the prop was carrying, as far as their bag allows.
    if (killer) {
      const room = bagCapacity(killer.profile) - killer.bag.length;
      killer.bag.push(...victim.bag.slice(0, Math.max(0, room)));
      this.sendBag(killer);
    }
    this.finishRaid(victim, 'died');
    this.broadcast({ t: 'kill', killer: killer?.id ?? null, victim: victim.id });
  }

  private sendBag(p: Player) {
    this.send(p, { t: 'bag', items: p.bag, capacity: bagCapacity(p.profile) });
  }

  private send(p: Player, msg: ServerMsg) {
    p.conn.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) p.conn.send(data);
  }
}
