import { PICKUP_RANGE } from '../../shared/constants.ts';
import { pointBoxDistance } from '../../shared/geometry.ts';
import { propSize } from '../../shared/map.ts';
import type { ClientMsg } from '../../shared/protocol.ts';
import type { InputKeys, Vec3 } from '../../shared/types.ts';
import type { Player, Room } from './room.ts';

type InputMsg = Extract<ClientMsg, { t: 'input' }>;

const BOT_NAMES = ['철수봇', '영희봇', '민수봇', '지수봇', '하늘봇', '바다봇', '별봇', '구름봇'];

export function botName(i: number) {
  return BOT_NAMES[i % BOT_NAMES.length];
}

/**
 * A simple prop player for testing alone: it walks to a nearby prop, turns into
 * it and holds still, then heads for an exit before time runs out. It steers in
 * straight lines and sidesteps when stuck.
 */
export class BotBrain {
  private seq = 0;
  private target: Vec3 | null = null;
  private hidePropId: number | null = null;
  private hidden = false;
  private face = 0;
  private lastPos: Vec3 = [0, 0, 0];
  private stuckFor = 0;
  private detour = 0;
  private detourYaw = 0;
  /** Seconds before the end of the hunt when this bot starts for an exit. */
  private leaveAt = 20 + Math.random() * 50;
  private wasPhase = '';

  next(room: Room, me: Player, dt: number): InputMsg {
    if (room.phase !== this.wasPhase) {
      this.wasPhase = room.phase;
      if (room.phase === 'hide' || room.phase === 'lobby') {
        this.target = null;
        this.hidePropId = null;
        this.hidden = false;
      }
    }

    const pos = me.body.pos;
    if (room.phase === 'lobby' || room.phase === 'countdown') {
      if (!this.target || this.dist(pos, this.target) < 1) {
        this.target = room.map.propSpawns[Math.floor(Math.random() * room.map.propSpawns.length)];
      }
    } else if (room.phase === 'hide' || room.phase === 'hunt') {
      const timeLeft = room.phaseEnds - room.time;
      if (room.phase === 'hunt' && timeLeft < this.leaveAt) {
        this.hidden = false;
        this.target = this.nearestExit(room, pos);
      } else if (!this.hidden) {
        this.planHide(room, me);
      }
      this.grabLoot(room, me);
    } else {
      this.target = null;
    }

    const keys: InputKeys = { f: false, b: false, l: false, r: false, jump: false, sprint: false };
    let yaw = this.face;
    if (this.target && !this.hidden) {
      const dx = this.target[0] - pos[0];
      const dz = this.target[2] - pos[2];
      yaw = Math.atan2(-dx, -dz);
      keys.f = true;
      keys.sprint = room.phase === 'hunt';

      // Sidestep around whatever is in the way.
      const moved = this.dist(pos, this.lastPos);
      this.stuckFor = moved < 0.02 ? this.stuckFor + dt : 0;
      if (this.stuckFor > 0.6 && this.detour <= 0) {
        this.detour = 0.8;
        this.detourYaw = yaw + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
      }
      if (this.detour > 0) {
        this.detour -= dt;
        yaw = this.detourYaw;
        keys.jump = true;
      }
      this.face = yaw;
    }
    this.lastPos = [...pos];
    return { t: 'input', seq: ++this.seq, keys, yaw, pitch: 0, face: this.face };
  }

  private planHide(room: Room, me: Player) {
    const pos = me.body.pos;
    if (this.hidePropId === null) {
      // Pick one of the closer props, not always the closest.
      const near = room.map.props
        .filter((p) => p.pos[1] === 0)
        .map((p) => ({ p, d: this.dist(pos, p.pos) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 6);
      const pick = near[Math.floor(Math.random() * near.length)];
      if (!pick) return;
      this.hidePropId = pick.p.id;
    }
    const prop = room.map.props[this.hidePropId];
    const box = room.map.propBoxes[this.hidePropId];
    if (pointBoxDistance([pos[0], pos[1] + 0.3, pos[2]], box) < 2) {
      room.handle(me, { t: 'disguise', propId: prop.id });
      // Stand next to the original, facing the same way, like a second copy.
      this.face = (prop.rot * Math.PI) / 2;
      this.hidden = true;
      this.target = null;
      return;
    }
    const size = propSize(prop.type, prop.rot);
    this.target = [prop.pos[0] + size[0] / 2 + 0.8, 0, prop.pos[2]];
  }

  private grabLoot(room: Room, me: Player) {
    for (const item of room.loot.values()) {
      if (this.dist(me.body.pos, item.pos) < PICKUP_RANGE) room.handle(me, { t: 'pickup', lootId: item.id });
    }
  }

  private nearestExit(room: Room, pos: Vec3): Vec3 {
    const centers = room.map.exits.map((e): Vec3 => [(e.min[0] + e.max[0]) / 2, 0, (e.min[2] + e.max[2]) / 2]);
    return centers.sort((a, b) => this.dist(pos, a) - this.dist(pos, b))[0];
  }

  private dist(a: Vec3, b: Vec3) {
    return Math.hypot(a[0] - b[0], a[2] - b[2]);
  }
}
