import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import WebSocket from 'ws';
import { HUNTER_EYE, SHOT_DAMAGE } from '../shared/constants.ts';
import { boxAt } from '../shared/geometry.ts';
import { PROPS } from '../shared/props.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { startServer } from '../server/src/server.ts';

const server = await startServer({ port: 0, seed: 7, timings: { countdown: 0.2, hide: 0.3, hunt: 30, end: 0.3, extract: 0.3 } });
const MAX_HP = 100;
after(() => server.close());

class Client {
  ws: WebSocket;
  messages: ServerMsg[] = [];
  id = 0;
  constructor(name: string, readonly room: string) {
    this.ws = new WebSocket(`ws://localhost:${server.port}/ws?room=${room}`);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'join', name })));
    this.ws.on('message', (d) => {
      const msg = JSON.parse(d.toString()) as ServerMsg;
      if (msg.t === 'welcome') this.id = msg.id;
      this.messages.push(msg);
    });
  }
  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }
  async waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, timeout = 3000): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = this.messages.find(pred);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timed out');
  }
}

const isPhase = (phase: string) => (m: ServerMsg): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap' && m.phase === phase;

test('a full round: roles are assigned, the hunter shoots the prop, hunters win', async () => {
  const a = new Client('alice', 'round');
  const b = new Client('bob', 'round');
  await a.waitFor(isPhase('hide'));
  const room = server.rooms.get('round')!;
  const players = [...room.players.values()];
  const hunter = players.find((p) => p.role === 'hunter')!;
  const prop = players.find((p) => p.role === 'prop')!;
  assert.ok(hunter && prop, 'one hunter and one prop');
  await a.waitFor(isPhase('hunt'));

  // Put both in the open middle of the map, facing each other.
  hunter.body.pos = [0, 0, 2];
  prop.body.pos = [0, 0, -2];
  const shooter = [a, b].find((c) => c.id === hunter.id)!;
  const eye = [0, HUNTER_EYE, 2];
  const box = boxAt(prop.body.pos, [0.6, 0.45, 0.5]);
  const target = [0, (box.min[1] + box.max[1]) / 2, -2];
  // Aim from a third-person camera behind and above the hunter.
  const origin = [eye[0], eye[1] + 0.3, eye[2] + 3];
  const dir = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];

  const shots = Math.ceil(MAX_HP / SHOT_DAMAGE);
  for (let i = 0; i < shots; i++) {
    shooter.send({ t: 'shoot', origin, dir });
    await new Promise((r) => setTimeout(r, 450));
  }
  const kill = await a.waitFor((m): m is Extract<ServerMsg, { t: 'kill' }> => m.t === 'kill');
  assert.equal(kill.victim, prop.id);
  assert.equal(kill.killer, hunter.id);
  const end = await a.waitFor((m): m is Extract<ServerMsg, { t: 'roundEnd' }> => m.t === 'roundEnd');
  assert.equal(end.winner, 'hunters');

  a.ws.close();
  b.ws.close();
});

test('shooting a decoy hurts the hunter', async () => {
  const a = new Client('carol', 'decoy');
  const b = new Client('dave', 'decoy');
  await a.waitFor(isPhase('hunt'));
  const room = server.rooms.get('decoy')!;
  const hunter = [...room.players.values()].find((p) => p.role === 'hunter')!;
  const decoy = room.map.propBoxes[0];
  const center = [(decoy.min[0] + decoy.max[0]) / 2, (decoy.min[1] + decoy.max[1]) / 2, (decoy.min[2] + decoy.max[2]) / 2];
  hunter.body.pos = [center[0], decoy.max[1] + 0.5, center[2] + 2.5];
  const eye = [hunter.body.pos[0], hunter.body.pos[1] + HUNTER_EYE, hunter.body.pos[2]];
  const shooter = [a, b].find((c) => c.id === hunter.id)!;
  shooter.send({ t: 'shoot', origin: eye, dir: [center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]] });
  const shot = await a.waitFor((m): m is Extract<ServerMsg, { t: 'shot' }> => m.t === 'shot');
  assert.equal(shot.hit, 'decoy');
  assert.ok(hunter.hp < MAX_HP);
  a.ws.close();
  b.ws.close();
});

test('props can disguise only as a prop within reach', async () => {
  const a = new Client('erin', 'disguise');
  await a.waitFor(isPhase('lobby'));
  const room = server.rooms.get('disguise')!;
  const me = room.players.get(a.id)!;
  const target = room.map.props.find((p) => p.type !== 'smallBox' && PROPS[p.type].tier === 0 && p.pos[1] === 0)!;

  me.body.pos = [target.pos[0] + 20, 0, target.pos[2]];
  room.handle(me, { t: 'disguise', propId: target.id });
  assert.equal(me.prop, 'smallBox', 'too far away');

  me.body.pos = [target.pos[0], 0, target.pos[2] + 2];
  room.handle(me, { t: 'disguise', propId: target.id });
  assert.equal(me.prop, target.type);
  a.ws.close();
});
