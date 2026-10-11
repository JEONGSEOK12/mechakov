import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TICK_DT } from '../shared/constants.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import type { Vec3 } from '../shared/types.ts';
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
  assert.equal(hunter.bag[0], item.type, "the prop's item");
  assert.ok(['scrap', 'bolts', 'wires'].includes(hunter.bag[1]), 'plus a bounty');
  runUntil(() => room.phase === 'end');
  assert.ok(hunter.profile.stash[item.type] >= 1);
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

test('bots play props: they hide as a prop, and the person is the hunter', () => {
  const room = new Room('bots', 7, timings);
  const human = room.addPlayer({ send: () => {} }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  const bots = [room.addBot()!, room.addBot()!, room.addBot()!];
  for (let i = 0; i < 2 / TICK_DT && room.phase !== 'hide'; i++) room.tick();
  assert.equal(room.phase, 'hide');
  assert.equal(human.role, 'hunter');
  assert.ok(bots.every((b) => b.role === 'prop'));
  // Give them a long hiding phase to walk over and disguise.
  room.phaseEnds = room.time + 20;
  for (let i = 0; i < 15 / TICK_DT; i++) room.tick();
  const hidden = bots.filter((b) => b.bot!.isHidden);
  assert.equal(hidden.length, 3, `${hidden.length} of 3 bots hidden`);
});

test('with hunters off, the person is a prop and can loot and extract right away', () => {
  const room = new Room('practice', 7, timings);
  room.hunters = false;
  const human = room.addPlayer({ send: () => {} }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  room.addBot();
  for (let i = 0; i < 2 / TICK_DT && room.phase !== 'hide'; i++) room.tick();
  assert.equal(room.phase, 'hide');
  assert.ok([...room.players.values()].every((p) => p.role === 'prop'));

  const item = grabLoot(room, human);
  const exit = room.map.exits[0];
  human.body.pos = [(exit.min[0] + exit.max[0]) / 2, 0, (exit.min[2] + exit.max[2]) / 2];
  room.phaseEnds = room.time + 20;
  for (let i = 0; i < 1 / TICK_DT && !human.extracted; i++) room.tick();
  assert.ok(human.extracted, 'extracted during the hiding phase');
  assert.equal(human.profile.stash[item.type], 1);
});

test('solo: wait in the hideout, raid on a raid map, then come back', () => {
  const room = new Room('solo-lobby', 7, timings, undefined, 'hideout');
  room.hunters = false;
  room.autoStart = false;
  const msgs: ServerMsg[] = [];
  const human = room.addPlayer({ send: (d) => msgs.push(JSON.parse(d)) }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  room.addBot();
  const phase = () => room.phase;
  for (let i = 0; i < 1 / TICK_DT; i++) room.tick();
  assert.equal(phase(), 'lobby', 'waits without a start');
  assert.equal(room.map.theme, 'hideout');
  const snap = msgs.filter((m) => m.t === 'snap').at(-1)!;
  assert.deepEqual(snap.t === 'snap' && snap.players.map((p) => p.id), [human.id], 'bots are not shown in the hideout');

  room.handle(human, { t: 'start' });
  room.tick();
  assert.notEqual(room.map.theme, 'hideout', 'the raid is on a raid map');
  assert.ok(msgs.some((m) => m.t === 'map' && m.theme === room.map.theme));
  for (let i = 0; i < 2 / TICK_DT && phase() !== 'hide'; i++) room.tick();
  assert.equal(phase(), 'hide');

  const exit = room.map.exits[0];
  human.body.pos = [(exit.min[0] + exit.max[0]) / 2, 0, (exit.min[2] + exit.max[2]) / 2];
  room.phaseEnds = room.time + 20;
  for (let i = 0; i < 1 / TICK_DT && phase() !== 'end'; i++) room.tick();
  assert.equal(human.outcome, 'extracted');
  assert.equal(phase(), 'end', 'round ends without waiting for the bot');
  for (let i = 0; i < 1 / TICK_DT; i++) room.tick();
  assert.equal(phase(), 'lobby', 'back in the lobby, waiting again');
  assert.equal(room.map.theme, 'hideout');
});

test('prop rockets throw a hunter into the air and hurt them a little', () => {
  const { room, hunter, prop, runUntil } = setup();
  runUntil(() => room.phase === 'hunt');
  // Somewhere open, so nothing is in the way: the middle of the map.
  hunter.body.pos = [0, 0, -3];
  prop.body.pos = [0, 0, 3];
  hunter.body.onGround = true;
  const hp = hunter.hp;
  // Aim at the floor right in front of the hunter's feet.
  const origin: Vec3 = [0, 1.5, 4.5];
  const target: Vec3 = [0, 0, -2.5];
  room.handle(prop, { t: 'rocket', origin, dir: [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]] });
  assert.equal(room.rockets.size, 0, 'a short wind-up before it leaves');
  for (let i = 0; i < 0.15 / TICK_DT + 1 && room.rockets.size === 0; i++) room.tick();
  assert.equal(room.rockets.size, 1);
  let launched = false;
  for (let i = 0; i < 30 && !launched; i++) {
    room.tick();
    launched = hunter.body.vy > 3;
  }
  assert.ok(launched, `hunter launched (vy ${hunter.body.vy.toFixed(1)})`);
  assert.equal(room.rockets.size, 0, 'the rocket went off');
  assert.ok(Math.abs(hunter.body.vz) > 1, 'pushed away from the blast');
  assert.ok(hunter.hp < hp && hunter.hp > hp - 25, `a little damage (${hp} -> ${hunter.hp})`);
  assert.equal(prop.hp, 100, 'props are not hurt by rockets');

  // The cooldown stops a second rocket straight away.
  room.handle(prop, { t: 'rocket', origin, dir: [0, -1, -1] });
  room.tick();
  room.tick();
  assert.equal(prop.pendingRocket, null);
  assert.equal(room.rockets.size, 0);
});

test('a prop can rocket jump off the floor under itself', () => {
  const room = new Room('jump', 7, timings);
  room.hunters = false;
  const me = room.addPlayer({ send: () => {} }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  room.addBot();
  for (let i = 0; i < 2 / TICK_DT && room.phase !== 'hide'; i++) room.tick();
  me.body.pos = [0, 0, 2];
  me.body.onGround = true;
  room.handle(me, { t: 'rocket', origin: [0, 1.6, 4], dir: [0, -1.6, -2] });
  let top = 0;
  for (let i = 0; i < 40; i++) {
    me.inputs.push({ t: 'input', seq: i + 1, keys: { f: false, b: false, l: false, r: false, jump: false, sprint: false }, yaw: 0, pitch: 0, face: 0 });
    room.tick();
    top = Math.max(top, me.body.pos[1]);
  }
  assert.ok(top > 1.5, `flew ${top.toFixed(2)} m up`);
});
