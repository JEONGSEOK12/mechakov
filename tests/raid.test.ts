import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TICK_DT } from '../shared/constants.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import type { Profile } from '../shared/upgrades.ts';
import { ProfileStore } from '../server/src/profiles.ts';
import { Room, type Player } from '../server/src/room.ts';

const timings = { countdown: 0.1, hide: 0.1, hunt: 2, end: 0.1, extract: 0.5 };

/** A room driven tick by tick, with two players and their received messages. */
function setup() {
  const room = new Room('t', 7, timings);
  const inbox = new Map<number, ServerMsg[]>();
  const join = (name: string, profile: Profile = { name, stash: {}, upgrades: {} }) => {
    const msgs: ServerMsg[] = [];
    const p = room.addPlayer({ send: (d) => msgs.push(JSON.parse(d)) }, name, `token-${name}-0123456789`, profile);
    inbox.set(p.id, msgs);
    return p;
  };
  const a = join('a');
  const b = join('b');
  const runUntil = (pred: () => boolean, maxSeconds = 5) => {
    for (let i = 0; i < maxSeconds / TICK_DT && !pred(); i++) room.tick();
    assert.ok(pred(), 'condition reached');
  };
  runUntil(() => room.phase === 'hide');
  const hunter = [a, b].find((p) => p.role === 'hunter')!;
  const prop = [a, b].find((p) => p.role === 'prop')!;
  const results = (p: Player) => inbox.get(p.id)!.filter((m) => m.t === 'result');
  return { room, hunter, prop, runUntil, results };
}

function grabLoot(room: Room, p: Player) {
  const item = [...room.loot.values()][0];
  p.body.pos = [item.pos[0], item.pos[1], item.pos[2]];
  room.handle(p, { t: 'pickup', lootId: item.id });
  return item;
}

test('props pick up loot, extract, and keep it', () => {
  const { room, prop, runUntil, results } = setup();
  const item = grabLoot(room, prop);
  assert.deepEqual(prop.bag, [item.type]);
  assert.ok(!room.loot.has(item.id));

  runUntil(() => room.phase === 'hunt');
  const exit = room.map.exits[0];
  prop.body.pos = [(exit.min[0] + exit.max[0]) / 2, 0, (exit.min[2] + exit.max[2]) / 2];
  runUntil(() => prop.extracted);
  assert.equal(prop.profile.stash[item.type], 1);
  assert.deepEqual(results(prop).at(-1), { t: 'result', outcome: 'extracted', items: [item.type] });
});

test('a killed prop loses its bag to the hunter, who keeps it by surviving', () => {
  const { room, hunter, prop, runUntil } = setup();
  const item = grabLoot(room, prop);
  runUntil(() => room.phase === 'hunt');
  // Shoot until dead.
  prop.body.pos = [0, 0, -2];
  hunter.body.pos = [0, 0, 2];
  for (let i = 0; i < 4; i++) {
    hunter.lastShot = -Infinity;
    room.handle(hunter, { t: 'shoot', origin: [0, 1.6, 2], dir: [0, 0.2 - 1.6, -4] });
  }
  assert.equal(prop.alive, false);
  assert.deepEqual(prop.bag, []);
  assert.deepEqual(hunter.bag, [item.type]);
  runUntil(() => room.phase === 'end');
  assert.equal(hunter.profile.stash[item.type], 1);
  assert.equal(prop.profile.stash[item.type], undefined);
});

test('props still hiding when time runs out lose what they carry', () => {
  const { room, prop, runUntil, results } = setup();
  const item = grabLoot(room, prop);
  runUntil(() => room.phase === 'end');
  assert.equal(prop.profile.stash[item.type], undefined);
  assert.equal(results(prop).at(-1)?.t === 'result' && results(prop).at(-1)?.outcome, 'mia');
});

test('bags have a size limit', () => {
  const { room, prop } = setup();
  for (let i = 0; i < 5; i++) grabLoot(room, prop);
  assert.equal(prop.bag.length, 3);
});

test('upgrades cost stash items and only happen between raids', () => {
  const room = new Room('u', 7, timings);
  const profile: Profile = { name: 'u', stash: { scrap: 3, wires: 1 }, upgrades: {} };
  const p = room.addPlayer({ send: () => {} }, 'u', 'token-u-0123456789ab', profile);
  room.handle(p, { t: 'upgrade', id: 'bag' });
  assert.equal(profile.upgrades.bag, 1);
  assert.deepEqual(profile.stash, { scrap: 1 });
  room.handle(p, { t: 'upgrade', id: 'bag' });
  assert.equal(profile.upgrades.bag, 1, 'cannot afford level 2');

  const raid = setup();
  raid.prop.profile.stash = { scrap: 3 };
  raid.room.handle(raid.prop, { t: 'upgrade', id: 'armor' });
  assert.equal(raid.prop.profile.upgrades.armor, undefined, 'not mid-raid');
});

test('the disguise catalog gates bigger props', () => {
  const { room, prop } = setup();
  const crate = room.map.props.find((p) => p.type === 'crate' && p.pos[1] === 0)!;
  prop.body.pos = [crate.pos[0], 0, crate.pos[2] + 1.5];
  room.handle(prop, { t: 'disguise', propId: crate.id });
  assert.equal(prop.prop, 'smallBox');
  prop.profile.upgrades.catalog = 1;
  room.handle(prop, { t: 'disguise', propId: crate.id });
  assert.equal(prop.prop, 'crate');
});

test('profiles survive a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mechakov-')), 'profiles.json');
  const store = new ProfileStore(file);
  const { token, profile } = store.get(undefined, 'kim');
  profile.stash.gpu = 2;
  store.flush();
  const again = new ProfileStore(file).get(token, 'kim');
  assert.equal(again.token, token);
  assert.equal(again.profile.stash.gpu, 2);
});
