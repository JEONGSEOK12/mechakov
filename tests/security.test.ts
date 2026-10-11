import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import WebSocket from 'ws';
import { TICK_DT } from '../shared/constants.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { cleanName, Room } from '../server/src/room.ts';
import { startServer } from '../server/src/server.ts';

const timings = { countdown: 0.1, hide: 0.1, hunt: 30, end: 0.1, extract: 1 };

test('hunters do not receive props hidden behind walls', () => {
  const room = new Room('los', 7, timings);
  const hunterInbox: ServerMsg[] = [];
  const a = room.addPlayer({ send: (d) => hunterInbox.push(JSON.parse(d)) }, 'a', 'token-a-0123456789ab', { name: 'a', stash: {}, upgrades: {} });
  const b = room.addPlayer({ send: (d) => hunterInbox.push(JSON.parse(d)) }, 'b', 'token-b-0123456789ab', { name: 'b', stash: {}, upgrades: {} });
  for (let i = 0; i < 1 / TICK_DT && room.phase !== 'hunt'; i++) room.tick();
  assert.equal(room.phase, 'hunt');
  const hunter = [a, b].find((p) => p.role === 'hunter')!;
  const prop = [a, b].find((p) => p.role === 'prop')!;
  const inbox: ServerMsg[] = [];
  (hunter as { conn: { send(d: string): void } }).conn.send = (d) => inbox.push(JSON.parse(d));

  const lastSnap = () => {
    const snaps = inbox.filter((m): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap');
    return snaps.at(-1)!;
  };

  // In the open middle, facing each other: visible.
  hunter.body.pos = [0, 0, 3];
  prop.body.pos = [0, 0, -3];
  room.tick();
  assert.ok(lastSnap().players.some((p) => p.id === prop.id));

  // On opposite sides of a shelf row.
  const shelf = room.map.walls.find((w) => w.max[1] > 3 && w.max[1] < room.map.wallHeight)!;
  const z = (shelf.min[2] + shelf.max[2]) / 2;
  hunter.body.pos = [shelf.min[0] - 2, 0, z];
  prop.body.pos = [shelf.max[0] + 1, 0, z];
  room.tick();
  const snap = lastSnap();
  assert.ok(!snap.players.some((p) => p.id === prop.id), 'hidden behind the shelf');
  assert.ok(snap.roster.some((p) => p.id === prop.id), 'still on the scoreboard');
});

test('names lose control and invisible characters', () => {
  assert.equal(cleanName('  kim​\u0007 '), 'kim');
  assert.equal(cleanName('가'.repeat(30)).length, 16);
  assert.equal(cleanName(42), '');
});

const server = await startServer({ port: 0, seed: 7, timings });
after(() => server.close());

test('a client flooding messages gets disconnected', async () => {
  const ws = new WebSocket(`ws://localhost:${server.port}/ws?room=flood`);
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'join', name: 'flood' }));
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  for (let i = 0; i < 2000; i++) ws.send(JSON.stringify({ t: 'pickup', lootId: 1 }));
  assert.equal(await closed, 1008);
});

test('oversized messages are refused', async () => {
  const ws = new WebSocket(`ws://localhost:${server.port}/ws?room=big`);
  await new Promise((r) => ws.on('open', r));
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  ws.send(JSON.stringify({ t: 'join', name: 'x'.repeat(10000) }));
  assert.equal(await closed, 1009);
});
