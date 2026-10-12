import {
  DEFAULT_PROP, DEFAULT_TIMINGS, DISGUISE_RANGE, FIRE_COOLDOWN, HUNTER_EYE, MAX_BOTS,
  MAX_PLAYERS, MIN_PLAYERS, PICKUP_RANGE, ROCKET_LIFETIME,
  GRENADE_BOUNCE, GRENADE_FUSE, GRENADE_GRAVITY, ROCKET_DELAY, ROCKET_SIDE, ROCKET_RADIUS, SHOT_DAMAGE, SHOT_RANGE, TICK_DT, type Timings,
} from '../../shared/constants.ts';
import { ammoAfter, CHARACTER_IDS, skillUses, spendSkill, CHARACTERS, characterOf, DECOY_COOLDOWN, INVISIBLE_AFTER } from '../../shared/characters.ts';
import { boxAt, overlaps, pointBoxDistance, rayBox } from '../../shared/geometry.ts';
import { ITEMS, ITEM_TYPES } from '../../shared/items.ts';
import { generateMap, THEMES, type GameMap } from '../../shared/map.ts';
import type { Theme } from '../../shared/props.ts';
import { bodySize, newBody, stepBody, unstick, type BodyState } from '../../shared/physics.ts';
import type { ClientMsg, Loot, Outcome, PlayerSnap, RocketSnap, ServerMsg, ShotHit } from '../../shared/protocol.ts';
import type { Box, InputKeys, Phase, Role, Team, Vec3 } from '../../shared/types.ts';
import {
  bagCapacity, canAfford, canDisguiseAs, maxHp, missPenalty, nextCost, speedMult, UPGRADES, type Profile,
} from '../../shared/upgrades.ts';
import { BotBrain, botName } from './bot.ts';

export interface Conn {
  send(data: string): void;
}

type InputMsg = Extract<ClientMsg, { t: 'input' }>;

export class Player {
  role: Role = 'prop';
  alive = true;
  extracted = false;
  hp = 100;
  body: BodyState = newBody([0, 0, 0]);
  prop: string | null = DEFAULT_PROP;
  yaw = 0;
  pitch = 0;
  face = 0;
  seq = 0;
  inputs: InputMsg[] = [];
  lastShot = -Infinity;
  lastRocket = -Infinity;
  /** Shots left in the clip right after `lastRocket`; see `ammoAfter`. */
  ammo = 0;
  /** When every saved skill use is back; see `skillUses`. */
  skillFullAt = -Infinity;
  /** Seconds without moving or attacking, for the `invisible` disguise. */
  stillFor = 0;
  lastDecoy = -Infinity;
  /** Set on a decoy: the player it copies. Decoys live in `players` so everything can hit them. */
  decoyOf: Player | null = null;
  /** Set on a practice range target dummy. */
  dummy: { moving: boolean; lastHit: number } | null = null;
  /** A rocket winding up: where it starts relative to the prop's centre, its direction and when it leaves. */
  pendingRocket: { offset: Vec3; dir: Vec3; at: number } | null = null;
  /** Items picked up this raid; lost on death. */
  bag: string[] = [];
  extractTime = 0;
  /** Set once the player's raid is decided; null while still in play. */
  outcome: Outcome | null = null;
  inRound = false;
  /** Set for server-controlled test players. */
  bot: BotBrain | null = null;

  constructor(readonly id: number, readonly token: string, readonly profile: Profile, readonly conn: Conn) {}

  get name() {
    return this.profile.name;
  }

  get character() {
    return characterOf(this.profile.character);
  }

  get weapon() {
    return this.character.weapon;
  }

  /** Decoys and target dummies: in `players` so attacks hit them, but not really playing. */
  get fake() {
    return !!this.decoyOf || !!this.dummy;
  }

  /** Vanished from everyone else's view by standing still. */
  get invisible() {
    return this.alive && this.role === 'prop' && this.character.disguise === 'invisible' && this.stillFor >= INVISIBLE_AFTER;
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
      vx: this.body.vx,
      vz: this.body.vz,
      onGround: this.body.onGround,
      stamina: this.body.stamina,
      winded: this.body.winded,
      charge: this.body.charge,
      chargeX: this.body.chargeX,
      chargeZ: this.body.chargeZ,
      invisible: this.invisible,
      yaw: this.yaw,
      pitch: this.pitch,
      face: this.face,
      prop: this.prop,
      ...(this.dummy ? { dummy: true } : {}),
      character: CHARACTERS[this.profile.character ?? ''] ? this.profile.character! : CHARACTER_IDS[0],
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

const NO_KEYS: InputKeys = { f: false, b: false, l: false, r: false, jump: false, sprint: false };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BOUNTY = ['scrap', 'bolts', 'wires'];

/** Trims a display name and drops control and invisible characters. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\p{C}\u200B-\u200F\u2060-\u206F]/gu, '').trim().slice(0, 16);
}

interface Rocket extends RocketSnap {
  owner: number;
  born: number;
  damage: number;
  knockback: number;
  /** Grenades only go off on a player they hit before their first bounce. */
  bounced: boolean;
}

/** Which axis's face of a box a point just outside it is closest to. */
function faceAxis(p: Vec3, b: Box): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  let bestD = Infinity;
  for (const i of [0, 1, 2] as const) {
    const d = Math.min(Math.abs(p[i] - b.min[i]), Math.abs(p[i] - b.max[i]));
    if (d < bestD) [best, bestD] = [i, d];
  }
  return best;
}

function inBox(p: Vec3, b: { min: Vec3; max: Vec3 }) {
  return p[0] >= b.min[0] && p[0] <= b.max[0] && p[2] >= b.min[2] && p[2] <= b.max[2] && p[1] <= b.max[1] + 0.5;
}

export class Room {
  readonly players = new Map<number, Player>();
  map: GameMap;
  phase: Phase = 'lobby';
  time = 0;
  phaseEnds = 0;
  loot = new Map<number, Loot>();
  rockets = new Map<number, Rocket>();
  private nextRocketId = 1;
  private nextId = 1;
  private nextLootId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Off by default: the game is every player for themselves, all props, and
   * the raid is loot, fight and extract. On brings back the hunters team.
   */
  hunters = false;
  /**
   * Off for solo: between raids everyone waits in the hideout map until the
   * person walks out its door, and the round ends as soon as every person's
   * raid is decided.
   */
  autoStart = true;
  private startRequested = false;
  /** The raid map most recently played, so the next one rotates. */
  private lastRaid: Theme = THEMES[Math.floor(Math.random() * THEMES.length)];

  constructor(
    readonly name: string,
    seed: number,
    readonly timings: Timings = DEFAULT_TIMINGS,
    readonly store: { save(): void } = { save() {} },
    theme: Theme = 'warehouse',
  ) {
    this.map = generateMap(seed, theme);
  }

  get humans() {
    return [...this.players.values()].filter((p) => !p.bot && !p.fake);
  }

  /** Everyone actually playing: people and bots, not decoys. */
  get real() {
    return [...this.players.values()].filter((p) => !p.fake);
  }

  start() {
    this.timer ??= setInterval(() => this.tick(), TICK_DT * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get full() {
    return this.real.length >= MAX_PLAYERS;
  }

  addPlayer(conn: Conn, rawName: unknown, token: string, profile: Profile): Player {
    const id = this.nextId++;
    profile.name = cleanName(rawName) || profile.name || `Player ${id}`;
    const p = new Player(id, token, profile, conn);
    this.players.set(id, p);
    if (this.phase === 'lobby' || this.phase === 'countdown') {
      this.resetForLobby(p);
    } else {
      p.role = 'spectator';
      p.alive = false;
      p.prop = null;
    }
    this.send(p, { t: 'welcome', id, seed: this.map.seed, theme: this.map.theme, room: this.name, token, profile, manualStart: !this.autoStart });
    this.send(p, { t: 'loot', items: [...this.loot.values()] });
    this.sendBag(p);
    return p;
  }

  /** Adds a prop bot, for testing with fewer people. Only between rounds. */
  addBot(): Player | null {
    const bots = [...this.players.values()].filter((p) => p.bot).length;
    if (this.full || bots >= MAX_BOTS || (this.phase !== 'lobby' && this.phase !== 'countdown')) return null;
    const id = this.nextId++;
    // Bots know every disguise so they blend in anywhere.
    const character = CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)];
    const profile: Profile = { name: botName(bots), stash: {}, upgrades: { catalog: 2 }, character };
    const p = new Player(id, `bot-${id}`, profile, { send: () => {} });
    p.bot = new BotBrain();
    this.players.set(id, p);
    this.resetForLobby(p);
    return p;
  }

  /** Makes space for a person by dropping a bot. */
  removeBot() {
    const bot = [...this.players.values()].find((p) => p.bot);
    if (bot) this.players.delete(bot.id);
  }

  removePlayer(id: number) {
    const p = this.players.get(id);
    this.players.delete(id);
    if (p) this.removeDecoys(p);
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
      case 'rocket':
        if (isVec3(msg.origin) && isVec3(msg.dir)) this.fireRocket(p, msg.origin, msg.dir);
        break;
      case 'skill':
        if (isNum(msg.yaw) && isNum(msg.power)) this.useSkill(p, msg.yaw, isNum(msg.pitch) ? Math.max(-1.4, Math.min(1.4, msg.pitch)) : 0, Math.max(0, Math.min(1, msg.power)));
        break;
      case 'decoy':
        this.placeDecoy(p);
        break;
      case 'practice':
        if (typeof msg.on === 'boolean') this.practice(p, msg.on);
        break;
      case 'disguise':
        if (isNum(msg.propId)) this.disguise(p, msg.propId);
        break;
      case 'pickup':
        if (isNum(msg.lootId)) this.pickup(p, msg.lootId);
        break;
      case 'drop':
        if (isNum(msg.index)) this.drop(p, msg.index);
        break;
      case 'upgrade':
        if (typeof msg.id === 'string') this.upgrade(p, msg.id);
        break;
      case 'character':
        if (typeof msg.id === 'string') this.pickCharacter(p, msg.id);
        break;
      case 'addBot':
        this.addBot();
        break;
      case 'start':
        if (this.phase === 'lobby' && this.map.theme !== 'range') this.startRequested = true;
        break;
    }
  }

  tick() {
    this.time += TICK_DT;
    this.updatePhase();

    const frozenHunters = this.phase === 'hide';
    for (const p of this.players.values()) {
      if (p.bot && p.alive) p.inputs.push(p.bot.next(this, p, TICK_DT));
      // Decoys stand still, but still fall and get thrown about like anyone.
      if (p.decoyOf) p.inputs.push({ t: 'input', seq: p.seq + 1, keys: NO_KEYS, yaw: p.yaw, pitch: 0, face: p.face });
      if (p.dummy) this.driveDummy(p);
      if (!p.alive) {
        const last = p.inputs.at(-1);
        if (last) p.seq = last.seq;
        p.inputs.length = 0;
        continue;
      }
      const was: Vec3 = [...p.body.pos];
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
      const moved = Math.hypot(p.body.pos[0] - was[0], p.body.pos[1] - was[1], p.body.pos[2] - was[2]) > 0.005;
      p.stillFor = moved || p.body.charge > 0 ? 0 : p.stillFor + TICK_DT;
      if (p.body.charge > 0) this.chargeHit(p);
      if (!p.fake) this.updateExtraction(p);
    }
    this.launchRockets();
    this.moveRockets();

    this.sendSnapshots();
  }

  /**
   * Hunters only receive props they could actually see, and nobody receives
   * invisible players, so a modified client can't show hiding players.
   * Everyone else gets everything.
   */
  private sendSnapshots() {
    const all = [...this.players.values()];
    // Bots wait off stage while the person is in their hideout.
    const shown = all.filter((p) => !this.offStage(p));
    const snaps = new Map(shown.map((p) => [p.id, p.snap(this.timings.extract)]));
    const roster = all.filter((p) => !p.fake).map((p) => ({ id: p.id, name: p.name, role: p.role, alive: p.alive, extracted: p.extracted }));
    const rockets = [...this.rockets.values()].map(({ id, kind, pos, vel }) => ({ id, kind, pos, vel }));
    const base = { t: 'snap' as const, time: this.time, phase: this.phase, timeLeft: Math.max(0, this.phaseEnds - this.time), roster, rockets };
    const everything = JSON.stringify({ ...base, players: [...snaps.values()] });
    // Invisible players are left out for everyone but themselves.
    const anyInvisible = shown.some((p) => p.invisible);
    for (const viewer of all) {
      if (viewer.fake) continue;
      const hunting = viewer.role === 'hunter' && viewer.alive && (this.phase === 'hide' || this.phase === 'hunt');
      if (!hunting && !anyInvisible) {
        viewer.conn.send(everything);
        continue;
      }
      const visible = shown.filter((p) => p === viewer || (!p.invisible &&
        (!hunting || p.role !== 'prop' || !p.alive || (this.phase === 'hunt' && this.canSee(viewer, p)))));
      viewer.conn.send(JSON.stringify({ ...base, players: visible.map((p) => snaps.get(p.id)!) }));
    }
  }

  /** Line of sight from a hunter's eye to a player's center, blocked only by walls. */
  canSee(viewer: Player, target: Player): boolean {
    const eye: Vec3 = [viewer.body.pos[0], viewer.body.pos[1] + HUNTER_EYE, viewer.body.pos[2]];
    const size = bodySize(target.role, target.prop);
    // Check the top and middle so something peeking over a low wall still shows.
    for (const h of [size[1] / 2, size[1] * 0.95]) {
      const to: Vec3 = [target.body.pos[0], target.body.pos[1] + h, target.body.pos[2]];
      const d = Math.hypot(to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]);
      if (d < 3) return true;
      const dir: Vec3 = [(to[0] - eye[0]) / d, (to[1] - eye[1]) / d, (to[2] - eye[2]) / d];
      if (!this.map.walls.some((w) => {
        const t = rayBox(eye, dir, w);
        return t !== null && t < d;
      })) return true;
    }
    return false;
  }

  private updateExtraction(p: Player) {
    // With no hunters there is nothing to wait for, so exits open from the start.
    const open = this.phase === 'hunt' || (this.phase === 'hide' && !this.hunters);
    if (!open || p.role !== 'prop' || !this.map.exits.some((e) => inBox(p.body.pos, e))) {
      p.extractTime = 0;
      return;
    }
    p.extractTime += TICK_DT;
    if (p.extractTime >= this.timings.extract) {
      p.extracted = true;
      p.alive = false;
      this.removeDecoys(p);
      this.finishRaid(p, 'extracted');
    }
  }

  private updatePhase() {
    const count = this.real.length;
    const expired = this.time >= this.phaseEnds;
    switch (this.phase) {
      case 'lobby':
        // Raids start from the hideout door, not the practice range.
        if (this.map.theme === 'range') break;
        if (count >= MIN_PLAYERS && (this.autoStart || this.startRequested)) {
          this.startRequested = false;
          // Leave the hideout for the next raid map; the countdown runs there.
          if (this.map.theme === 'hideout') this.changeMap(this.nextRaidTheme());
          this.setPhase('countdown', this.timings.countdown);
        }
        break;
      case 'countdown':
        if (count < MIN_PLAYERS) this.setPhase('lobby', 0);
        else if (expired) this.startRound();
        break;
      case 'hide':
      case 'hunt': {
        const living = (role: Role) => this.real.filter((p) => p.role === role && p.alive).length;
        if (living('prop') === 0) this.endRound('noProps');
        else if (this.hunters && living('hunter') === 0) this.endRound('noHunters');
        // Nobody to wait for once the people are out; bots still in the raid go missing.
        else if (!this.autoStart && this.humans.every((p) => p.outcome)) this.endRound('time');
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
    p.lastRocket = -Infinity;
    p.bag = [];
    p.outcome = null;
    p.inRound = false;
    p.extractTime = 0;
    this.spawn(p, this.map.propSpawns[Math.floor(Math.random() * this.map.propSpawns.length)]);
  }

  private spawn(p: Player, at: Vec3) {
    p.body = newBody([at[0] + (Math.random() - 0.5) * 0.5, at[1], at[2] + (Math.random() - 0.5) * 0.5]);
    p.inputs.length = 0;
    unstick(p.body, bodySize(p.role, p.prop), this.map.solids);
  }

  private spawnLoot() {
    this.loot.clear();
    this.rockets.clear();
    for (const p of this.players.values()) p.pendingRocket = null;
    const total = ITEM_TYPES.reduce((s, k) => s + ITEMS[k].weight, 0);
    const count = 16 + 4 * this.players.size;
    for (const pos of shuffle(this.map.lootSpots).slice(0, count)) {
      let r = Math.random() * total;
      const type = ITEM_TYPES.find((k) => (r -= ITEMS[k].weight) <= 0) ?? ITEM_TYPES[0];
      const id = this.nextLootId++;
      this.loot.set(id, { id, type, pos });
    }
    this.broadcast({ t: 'loot', items: [...this.loot.values()] });
  }

  private startRound() {
    this.removeDecoys();
    // Bots only play props, so hunters come from the people in the room.
    const all = [...shuffle(this.humans), ...shuffle([...this.players.values()].filter((p) => p.bot))];
    const hunterCount = !this.hunters ? 0 : Math.min(this.humans.length, Math.max(1, Math.round(all.length / 4)));
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
      p.lastRocket = -Infinity;
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
    // Without hunters nobody needs time to hide: the whole raid is one fight.
    if (this.hunters) this.setPhase('hide', this.timings.hide);
    else this.setPhase('hunt', this.timings.hide + this.timings.hunt);
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
    this.removeDecoys();
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
    // Every player for themselves: each one's own result says how they did.
    const winner: Team | null = !this.hunters ? null : propsWon ? 'props' : 'hunters';
    this.setPhase('end', this.timings.end);
    this.loot.clear();
    this.rockets.clear();
    for (const p of this.players.values()) p.pendingRocket = null;
    this.broadcast({ t: 'loot', items: [] });
    this.broadcast({ t: 'roundEnd', winner });
  }

  private goToLobby() {
    // A different map every round, or back to the hideout between solo raids.
    this.setPhase('lobby', 0);
    this.changeMap(this.autoStart ? this.nextRaidTheme() : 'hideout');
  }

  private nextRaidTheme(): Theme {
    const current = this.map.theme === 'hideout' || this.map.theme === 'range' ? this.lastRaid : this.map.theme;
    return THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  }

  private changeMap(theme: Theme) {
    this.rockets.clear();
    for (const p of this.players.values()) p.pendingRocket = null;
    if (this.map.theme !== 'hideout' && this.map.theme !== 'range') this.lastRaid = this.map.theme;
    this.map = generateMap(Math.floor(Math.random() * 1e9), theme);
    this.broadcast({ t: 'map', seed: this.map.seed, theme: this.map.theme });
    for (const p of this.players.values()) if (p.fake) this.players.delete(p.id);
    for (const p of this.players.values()) this.resetForLobby(p);
    if (theme === 'range') this.spawnDummies();
  }

  private disguise(p: Player, propId: number) {
    if (!p.alive || p.role !== 'prop' || p.character.disguise !== 'prop' || this.phase === 'end') return;
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

  /** Puts one bag item back on the floor at the player's feet, for anyone to pick up. */
  private drop(p: Player, index: number) {
    if (!p.alive || p.outcome || (this.phase !== 'hide' && this.phase !== 'hunt')) return;
    if (!Number.isInteger(index) || index < 0 || index >= p.bag.length) return;
    const [type] = p.bag.splice(index, 1);
    const id = this.nextLootId++;
    this.loot.set(id, { id, type, pos: [p.body.pos[0], p.body.pos[1], p.body.pos[2]] });
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

  private pickCharacter(p: Player, id: string) {
    if (!CHARACTERS[id] || (this.phase !== 'lobby' && this.phase !== 'countdown')) return;
    p.profile.character = id;
    p.hp = maxHp(p.profile);
    p.lastRocket = -Infinity;
    this.store.save();
    this.send(p, { t: 'profile', profile: p.profile });
  }

  /**
   * Hunters' rifles, and the props whose character carries a gun. Props shoot
   * whenever they may fire rockets; hunters only once the hunt is on.
   */
  private shoot(p: Player, origin: Vec3, rawDir: Vec3) {
    if (!p.alive || this.phase === 'end') return;
    const hunter = p.role === 'hunter';
    const weapon = p.weapon;
    if (hunter ? this.phase !== 'hunt' : p.role !== 'prop' || weapon.kind !== 'hitscan' || (this.phase === 'hide' && this.hunters)) return;
    const cooldown = hunter ? FIRE_COOLDOWN : weapon.cooldown;
    if (this.time - p.lastShot < cooldown - 0.05) return;
    const len = Math.hypot(...rawDir);
    if (len < 1e-6) return;
    const dir: Vec3 = [rawDir[0] / len, rawDir[1] / len, rawDir[2] / len];
    const size = bodySize(p.role, p.prop);
    const eye: Vec3 = [p.body.pos[0], p.body.pos[1] + (hunter ? HUNTER_EYE : size[1] * 0.75), p.body.pos[2]];
    // The client aims from its third-person camera; accept that ray only if the
    // camera is near the shooter, and start it level with them so it can't
    // hit things behind them.
    if (Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) > (hunter ? 6 : 8)) return;
    p.lastShot = this.time;
    p.stillFor = 0;
    const along = Math.max(0, (eye[0] - origin[0]) * dir[0] + (eye[1] - origin[1]) * dir[1] + (eye[2] - origin[2]) * dir[2]);
    const start: Vec3 = [origin[0] + dir[0] * along, origin[1] + dir[1] * along, origin[2] + dir[2] * along];

    let best = hunter ? SHOT_RANGE : weapon.range;
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

    // Props only hurt each other once the fighting has started, like rockets.
    if (!hunter && !this.fighting) return;
    if (target) this.damage(target, hunter ? SHOT_DAMAGE : weapon.damage, p);
    else if (hit === 'decoy' && (hunter || weapon.decoyPenalty)) this.damage(p, missPenalty(p.profile), null);
  }

  /**
   * Props fire slow explosive rockets along their camera ray. Allowed whenever
   * a prop can move about (not while hunters are blind in the hiding phase,
   * unless there are no hunters at all).
   */
  private fireRocket(p: Player, origin: Vec3, rawDir: Vec3) {
    const kind = p.weapon.kind;
    if (!p.alive || p.role !== 'prop' || (kind !== 'rocket' && kind !== 'grenade') || this.phase === 'end' || (this.phase === 'hide' && this.hunters)) return;
    if (this.time - p.lastRocket < p.weapon.cooldown - 0.05) return;
    // A little slack for the client's clock running ahead of ours.
    const ammo = ammoAfter(p.weapon, p.ammo, p.lastRocket, this.time + 0.1);
    if (ammo < 1) return;
    const len = Math.hypot(...rawDir);
    if (len < 1e-6) return;
    const dir: Vec3 = [rawDir[0] / len, rawDir[1] / len, rawDir[2] / len];
    const size = bodySize(p.role, p.prop);
    const center: Vec3 = [p.body.pos[0], p.body.pos[1] + size[1] / 2, p.body.pos[2]];
    if (Math.hypot(origin[0] - center[0], origin[1] - center[1], origin[2] - center[2]) > 8) return;
    p.lastRocket = this.time;
    p.ammo = ammo - 1;
    p.stillFor = 0;
    // Start on the camera ray where it passes the prop, so it flies at the crosshair.
    const along = Math.max(0, (center[0] - origin[0]) * dir[0] + (center[1] - origin[1]) * dir[1] + (center[2] - origin[2]) * dir[2]);
    const offset: Vec3 = [origin[0] + dir[0] * along - center[0], origin[1] + dir[1] * along - center[1], origin[2] + dir[2] * along - center[2]];
    p.pendingRocket = { offset, dir, at: this.time + ROCKET_DELAY };
  }

  /** Rockets leave after their wind-up, from wherever the prop has moved to. */
  private launchRockets() {
    for (const p of this.players.values()) {
      const pending = p.pendingRocket;
      if (!pending || this.time < pending.at - 1e-6) continue;
      p.pendingRocket = null;
      if (!p.alive || p.role !== 'prop' || this.phase === 'end') continue;
      const size = bodySize(p.role, p.prop);
      const { offset, dir } = pending;
      let pos: Vec3 = [p.body.pos[0] + offset[0], p.body.pos[1] + size[1] / 2 + offset[1], p.body.pos[2] + offset[2]];
      const { kind, speed, damage, knockback } = p.weapon;
      if (kind !== 'rocket' && kind !== 'grenade') continue;
      // Rockets come off the right shoulder (unless a wall is right there)
      // and fly to whatever the crosshair was on, so they still hit where you aim.
      let aim = dir;
      const side = Math.hypot(dir[0], dir[2]);
      if (kind === 'rocket' && side > 1e-3) {
        const right: Vec3 = [-dir[2] / side, 0, dir[0] / side];
        const wall = Math.min(...this.map.solids.map((b) => rayBox(pos, right, b) ?? Infinity));
        const go = Math.min(ROCKET_SIDE, wall - 0.1);
        if (go > 0) {
          const boxes = [...this.map.solids, ...[...this.players.values()].filter((o) => o !== p && o.alive && !this.offStage(o)).map((o) => boxAt(o.body.pos, bodySize(o.role, o.prop)))];
          const far = Math.min(60, ...boxes.map((b) => rayBox(pos, dir, b) ?? Infinity));
          const target: Vec3 = [pos[0] + dir[0] * far, pos[1] + dir[1] * far, pos[2] + dir[2] * far];
          pos = [pos[0] + right[0] * go, pos[1], pos[2] + right[2] * go];
          const to: Vec3 = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
          const len = Math.hypot(...to);
          if (len > 1) aim = [to[0] / len, to[1] / len, to[2] / len];
        }
      }
      // Grenades get a little lift so they arc toward the crosshair.
      const vel: Vec3 = [aim[0] * speed, aim[1] * speed + (kind === 'grenade' ? 2.5 : 0), aim[2] * speed];
      const id = this.nextRocketId++;
      this.rockets.set(id, { id, kind, owner: p.id, pos, vel, born: this.time, damage, knockback, bounced: false });
    }
  }

  /**
   * Flies every projectile one tick. A rocket goes off on the first thing it
   * touches. A grenade falls, bounces off walls and the floor, and goes off on
   * a player it hits before bouncing or when its fuse runs out.
   */
  private moveRockets() {
    for (const r of this.rockets.values()) {
      const grenade = r.kind === 'grenade';
      if (grenade) r.vel[1] -= GRENADE_GRAVITY * TICK_DT;
      const speed = Math.hypot(...r.vel);
      if (speed < 1e-6) {
        if (this.time - r.born > GRENADE_FUSE) this.explode(r);
        continue;
      }
      const step = speed * TICK_DT;
      const dir: Vec3 = [r.vel[0] / speed, r.vel[1] / speed, r.vel[2] / speed];
      let t = step;
      let wall: Box | null = null;
      let player = false;
      for (const s of this.map.solids) {
        const d = rayBox(r.pos, dir, s);
        if (d !== null && d < t) [t, wall] = [d, s];
      }
      for (const other of this.players.values()) {
        if (other.id === r.owner || !other.alive || this.offStage(other)) continue;
        const d = rayBox(r.pos, dir, boxAt(other.body.pos, bodySize(other.role, other.prop)));
        if (d !== null && d < t) [t, wall, player] = [d, null, true];
      }
      let floor = false;
      if (dir[1] < 0 && -r.pos[1] / dir[1] < t) [t, wall, player, floor] = [-r.pos[1] / dir[1], null, false, true];
      const hit = t < step;
      // Stop just short of the surface so the blast centre isn't inside it.
      const go = hit ? Math.max(0, t - 0.05) : step;
      r.pos = [r.pos[0] + dir[0] * go, r.pos[1] + dir[1] * go, r.pos[2] + dir[2] * go];
      if (!grenade) {
        if (hit) this.explode(r);
        else if (this.time - r.born > ROCKET_LIFETIME) this.rockets.delete(r.id);
        continue;
      }
      if (hit && player && !r.bounced) this.explode(r);
      else if (this.time - r.born > GRENADE_FUSE) this.explode(r);
      else if (hit) {
        r.bounced = true;
        // Flip the speed along the face it struck, and lose some of it.
        const axis = floor ? 1 : wall ? faceAxis(r.pos, wall) : 1;
        r.vel = r.vel.map((v, i) => (i === axis ? -v : v) * GRENADE_BOUNCE) as Vec3;
        if (axis === 1 && Math.abs(r.vel[1]) < 1) r.vel[1] = 0;
      }
    }
  }

  /**
   * The leap skill: throw yourself in an arc toward `yaw`, farther the longer
   * it was charged, and the first player you meet before landing takes the hit.
   */
  private useSkill(p: Player, yaw: number, pitch: number, power: number) {
    const skill = p.character.skill;
    if (!skill || !p.alive || p.role !== 'prop' || p.decoyOf || this.phase === 'end' || (this.phase === 'hide' && this.hunters)) return;
    if (skillUses(skill, p.skillFullAt, this.time + 0.05) < 1 || p.body.charge > 0) return;
    p.skillFullAt = spendSkill(skill, p.skillFullAt, this.time);
    p.stillFor = 0;
    const speed = skill.speed[0] + (skill.speed[1] - skill.speed[0]) * power;
    const lift = skill.lift[0] + (skill.lift[1] - skill.lift[0]) * power;
    const b = p.body;
    // Along where you look, up and down too, like a Left 4 Dead hunter's
    // pounce, with a little lift on top so a level leap still arcs. Off the
    // ground you can dive; on it you can't leap into the floor.
    [b.chargeX, b.chargeZ] = [-Math.sin(yaw), -Math.cos(yaw)];
    const flat = Math.cos(pitch) * speed;
    [b.vx, b.vz, b.vy] = [b.chargeX * flat, b.chargeZ * flat, Math.sin(pitch) * speed + lift];
    if (b.onGround) b.vy = Math.max(b.vy, lift);
    b.onGround = false;
    b.charge = 3;
  }

  /** The `decoy` disguise: a copy of the player that stands where they were, one at a time. */
  private placeDecoy(p: Player) {
    if (!p.alive || p.role !== 'prop' || p.decoyOf || p.character.disguise !== 'decoy' || this.phase === 'end') return;
    if (this.time - p.lastDecoy < DECOY_COOLDOWN - 0.05) return;
    p.lastDecoy = this.time;
    this.removeDecoys(p);
    const id = this.nextId++;
    const profile: Profile = { name: p.name, stash: {}, upgrades: { ...p.profile.upgrades }, character: p.profile.character };
    const d = new Player(id, `decoy-${id}`, profile, { send: () => {} });
    d.decoyOf = p;
    d.prop = p.prop;
    d.hp = p.hp;
    d.body = { ...p.body, pos: [...p.body.pos], charge: 0, vx: 0, vz: 0 };
    [d.yaw, d.face, d.pitch] = [p.yaw, p.face, p.pitch];
    this.players.set(id, d);
  }

  /** Takes away one player's decoy, or every decoy. */
  private removeDecoys(owner?: Player) {
    for (const p of this.players.values()) if (p.decoyOf && (!owner || p.decoyOf === owner)) this.players.delete(p.id);
  }

  /**
   * Props hurt each other in the hunt, any time in a raid without hunters,
   * and on the practice range.
   */
  get fighting() {
    return this.phase === 'hunt' || (this.phase === 'hide' && !this.hunters) || this.map.theme === 'range';
  }

  /** Bots wait out of sight while the person is in the hideout or on the range. */
  private offStage(p: Player) {
    return !!p.bot && (this.map.theme === 'hideout' || this.map.theme === 'range');
  }

  /** Walks between the hideout and its practice range; solo only, between raids. */
  private practice(p: Player, on: boolean) {
    if (this.autoStart || this.phase !== 'lobby' || p.fake) return;
    if (on && this.map.theme === 'hideout') this.changeMap('range');
    else if (!on && this.map.theme === 'range') this.changeMap('hideout');
  }

  private spawnDummies() {
    for (const { pos, moving } of this.map.dummies ?? []) {
      const id = this.nextId++;
      const d = new Player(id, `dummy-${id}`, { name: '허수아비', stash: {}, upgrades: {} }, { send: () => {} });
      d.dummy = { moving, lastHit: -Infinity };
      d.prop = null;
      d.body = newBody([...pos]);
      // Facing where players come in.
      d.yaw = d.face = Math.PI;
      this.players.set(id, d);
    }
  }

  /** Dummies stand still or walk side to side, and heal up a few seconds after being hit. */
  private driveDummy(p: Player) {
    const dummy = p.dummy!;
    const right = Math.floor(this.time / 1.6) % 2 === 0;
    const keys = dummy.moving ? { ...NO_KEYS, l: !right, r: right } : NO_KEYS;
    p.inputs.push({ t: 'input', seq: p.seq + 1, keys, yaw: p.yaw, pitch: 0, face: p.face });
    if (this.time - dummy.lastHit > 3) p.hp = maxHp(p.profile);
  }

  private chargeHit(p: Player) {
    const skill = p.character.skill;
    if (!skill) return;
    const size = bodySize(p.role, p.prop);
    // A little ahead of and below the body, so you hit people you fly into or come down on.
    const reach = boxAt([p.body.pos[0] + p.body.chargeX * 0.3, p.body.pos[1] - 0.6, p.body.pos[2] + p.body.chargeZ * 0.3], [size[0], size[1] + 0.6, size[2]]);
    for (const other of this.players.values()) {
      if (other === p || !other.alive || this.offStage(other)) continue;
      if (!overlaps(reach, boxAt(other.body.pos, bodySize(other.role, other.prop)))) continue;
      p.body.charge = 0;
      other.body.vx += p.body.chargeX * skill.knockback;
      other.body.vz += p.body.chargeZ * skill.knockback;
      other.body.vy = Math.max(other.body.vy, 0) + skill.knockback * 0.4;
      other.body.onGround = false;
      other.stillFor = 0;
      this.broadcast({ t: 'bash', from: p.id, victim: other.id, pos: [...other.body.pos] });
      if (this.fighting) this.damage(other, skill.damage, p);
      return;
    }
  }

  /**
   * Pushes everyone near the blast away from it (the shooter too, so props can
   * rocket jump) and lightly hurts everyone but the shooter, other props
   * included, once the fighting has started. Walls block the blast.
   */
  private explode(r: Rocket) {
    this.rockets.delete(r.id);
    const owner = this.players.get(r.owner) ?? null;
    const hit: number[] = [];
    const fighting = this.fighting;
    for (const p of this.players.values()) {
      if (!p.alive || this.offStage(p)) continue;
      const size = bodySize(p.role, p.prop);
      const box = boxAt(p.body.pos, size);
      const dist = pointBoxDistance(r.pos, box);
      if (dist > ROCKET_RADIUS) continue;
      const center: Vec3 = [p.body.pos[0], p.body.pos[1] + size[1] / 2, p.body.pos[2]];
      let d: Vec3 = [center[0] - r.pos[0], center[1] - r.pos[1], center[2] - r.pos[2]];
      const len = Math.hypot(...d);
      if (len > 0.3 && this.map.walls.some((w) => {
        const t = rayBox(r.pos, [d[0] / len, d[1] / len, d[2] / len], w);
        return t !== null && t < len - 0.3;
      })) continue;
      d = len > 1e-3 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 1, 0];
      const strength = 1 - dist / ROCKET_RADIUS;
      const push = r.knockback * (0.35 + 0.65 * strength);
      p.body.vx += d[0] * push;
      p.body.vz += d[2] * push;
      // Always some lift, so a shot at someone's feet throws them up.
      p.body.vy = Math.max(p.body.vy, 0) + Math.max(d[1], 0.45) * push;
      p.body.onGround = false;
      p.stillFor = 0;
      hit.push(p.id);
      if (p.id !== r.owner && fighting) this.damage(p, Math.round(r.damage * (0.3 + 0.7 * strength)), owner);
    }
    this.broadcast({ t: 'boom', from: r.owner, pos: r.pos, hit });
  }

  private damage(victim: Player, amount: number, killer: Player | null) {
    if (killer && killer !== victim) {
      const killed = !victim.decoyOf && victim.hp <= amount;
      this.send(killer, { t: 'dmg', target: victim.id, amount: Math.min(amount, victim.hp), pos: [...victim.body.pos], killed });
    }
    // A target dummy takes the hit, and starts over when it would have died.
    if (victim.dummy) {
      victim.dummy.lastHit = this.time;
      victim.hp -= amount;
      if (victim.hp <= 0) {
        victim.hp = maxHp(victim.profile);
        this.broadcast({ t: 'poof', pos: [...victim.body.pos] });
      }
      return;
    }
    // A decoy pops at the first hit.
    if (victim.decoyOf) {
      this.players.delete(victim.id);
      this.broadcast({ t: 'poof', pos: [...victim.body.pos] });
      return;
    }
    victim.hp = Math.max(0, victim.hp - amount);
    if (victim.hp > 0) return;
    victim.alive = false;
    this.removeDecoys(victim);
    // Hunters can't pick things up, so one who kills takes what the prop
    // carried, plus a small bounty, as far as their bag allows. Anything
    // else falls to the floor for whoever gets there first.
    if (killer?.role === 'hunter') {
      const take = [...victim.bag, BOUNTY[Math.floor(Math.random() * BOUNTY.length)]];
      const room = Math.max(0, bagCapacity(killer.profile) - killer.bag.length);
      killer.bag.push(...take.slice(0, room));
      victim.bag = victim.bag.slice(room);
      this.sendBag(killer);
    }
    this.dropBag(victim);
    this.finishRaid(victim, 'died');
    this.broadcast({ t: 'kill', killer: killer?.id ?? null, victim: victim.id });
  }

  /** Spills what a dead player carried around where they fell, for anyone to pick up. */
  private dropBag(p: Player) {
    if (p.bag.length === 0) return;
    const start = Math.random() * Math.PI * 2;
    p.bag.forEach((type, i) => {
      const a = start + (i / p.bag.length) * Math.PI * 2;
      const r = p.bag.length > 1 ? 0.6 : 0;
      const pos: Vec3 = [p.body.pos[0] + Math.cos(a) * r, p.body.pos[1], p.body.pos[2] + Math.sin(a) * r];
      const id = this.nextLootId++;
      this.loot.set(id, { id, type, pos });
    });
    this.broadcast({ t: 'loot', items: [...this.loot.values()] });
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
