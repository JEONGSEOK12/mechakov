import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TICK_DT } from '../shared/constants.ts';
import { PROPS } from '../shared/props.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import type { Vec3 } from '../shared/types.ts';
import type { Profile } from '../shared/upgrades.ts';
import { ProfileStore } from '../server/src/profiles.ts';
import { Room, type Player } from '../server/src/room.ts';

const timings = { countdown: 0.1, hide: 0.1, hunt: 2, end: 0.1, extract: 0.5 };

/** A room with the hunters team on, driven tick by tick, with two players and their received messages. */
function setup() {
  const room = new Room('t', 7, timings);
  room.hunters = true;
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

test('with the hunters team on, bots play props and the person is the hunter', () => {
  const room = new Room('bots', 7, timings);
  room.hunters = true;
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

test('by default everyone is a prop on their own: the raid starts straight away and you can extract', () => {
  const room = new Room('practice', 7, timings);
  const msgs: ServerMsg[] = [];
  const human = room.addPlayer({ send: (d) => msgs.push(JSON.parse(d)) }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  room.addBot();
  for (let i = 0; i < 2 / TICK_DT && room.phase !== 'hunt'; i++) room.tick();
  assert.equal(room.phase, 'hunt', 'no hiding phase');
  assert.ok([...room.players.values()].every((p) => p.role === 'prop'));

  const item = grabLoot(room, human);
  const exit = room.map.exits[0];
  human.body.pos = [(exit.min[0] + exit.max[0]) / 2, 0, (exit.min[2] + exit.max[2]) / 2];
  room.phaseEnds = room.time + 20;
  for (let i = 0; i < 1 / TICK_DT && !human.extracted; i++) room.tick();
  assert.ok(human.extracted, 'extracted');
  assert.equal(human.profile.stash[item.type], 1);
  room.phaseEnds = room.time;
  for (let i = 0; i < 3 && (room.phase as string) !== 'end'; i++) room.tick();
  assert.deepEqual(msgs.filter((m) => m.t === 'roundEnd').at(-1), { t: 'roundEnd', winner: null }, 'no winning team');
});

test('solo: wait in the hideout, raid on a raid map, then come back', () => {
  const room = new Room('solo-lobby', 7, timings, undefined, 'hideout');
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
  for (let i = 0; i < 2 / TICK_DT && phase() !== 'hunt'; i++) room.tick();
  assert.equal(phase(), 'hunt');

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
  assert.equal(prop.hp, 100, 'the shooter is not hurt by their own rocket');

  // The cooldown stops a second rocket straight away.
  room.handle(prop, { t: 'rocket', origin, dir: [0, -1, -1] });
  room.tick();
  room.tick();
  assert.equal(prop.pendingRocket, null);
  assert.equal(room.rockets.size, 0);
});

test('a prop can rocket jump off the floor under itself', () => {
  const room = new Room('jump', 7, timings);
  const me = room.addPlayer({ send: () => {} }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  room.addBot();
  for (let i = 0; i < 2 / TICK_DT && room.phase !== 'hunt'; i++) room.tick();
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

test('props can fight each other with rockets, and a dead prop drops its loot', () => {
  const room = new Room('fight', 7, { ...timings, hunt: 60 });
  const me = room.addPlayer({ send: () => {} }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  const other = room.addPlayer({ send: () => {} }, 'other', 'token-other-0123456789', { name: 'other', stash: {}, upgrades: {} });
  for (let i = 0; i < 2 / TICK_DT && room.phase !== 'hunt'; i++) room.tick();
  assert.equal(other.role, 'prop');
  other.bag = ['gpu'];
  me.body.pos = [0, 0, 4];
  other.body.pos = [0, 0, -3];
  const lootBefore = new Set(room.loot.keys());
  const shots = () => {
    me.lastRocket = -Infinity;
    room.handle(me, { t: 'rocket', origin: [0, 1.4, 5.5], dir: [0, -1.4, -8] });
    for (let i = 0; i < 24; i++) room.tick();
    other.body.pos = [0, 0, -3];
    other.body.vx = other.body.vz = other.body.vy = 0;
  };
  shots();
  assert.ok(other.hp < 100, `hurt by another prop (${other.hp})`);
  assert.equal(me.hp, 100);
  for (let i = 0; i < 20 && other.alive; i++) shots();
  assert.equal(other.alive, false, 'killed');
  // Only the new loot: the map may have spawned a gpu of its own.
  const dropped = [...room.loot.values()].filter((l) => !lootBefore.has(l.id));
  assert.equal(dropped.length, 1);
  const gpu = dropped[0];
  assert.equal(gpu.type, 'gpu');
  assert.ok(Math.hypot(gpu.pos[0], gpu.pos[2] + 3) < 1, 'its gpu is on the floor where it fell');
  // And the winner can pick it up.
  me.body.pos = [gpu.pos[0], 0, gpu.pos[2]];
  room.handle(me, { t: 'pickup', lootId: gpu.id });
  assert.deepEqual(me.bag, ['gpu']);
});

test('props can drop bag items on the floor and pick them up again', () => {
  const { room, prop } = setup();
  const item = grabLoot(room, prop);
  const before = room.loot.size;
  room.handle(prop, { t: 'drop', index: 5 });
  assert.deepEqual(prop.bag, [item.type], 'a slot that is empty does nothing');
  room.handle(prop, { t: 'drop', index: 0 });
  assert.deepEqual(prop.bag, []);
  assert.equal(room.loot.size, before + 1);
  const dropped = [...room.loot.values()].at(-1)!;
  assert.equal(dropped.type, item.type);
  assert.ok(Math.hypot(dropped.pos[0] - prop.body.pos[0], dropped.pos[2] - prop.body.pos[2]) < 0.01, 'at their feet');
  room.handle(prop, { t: 'pickup', lootId: dropped.id });
  assert.deepEqual(prop.bag, [item.type]);
});

const idle = (p: Player, seq: number) =>
  p.inputs.push({ t: 'input', seq, keys: { f: false, b: false, l: false, r: false, jump: false, sprint: false }, yaw: 0, pitch: 0, face: 0 });

/** Two players in a free-for-all raid, `me` as the grenadier. */
function grenadierRaid() {
  const room = new Room('chars', 7, { ...timings, hunt: 60 });
  const seen: ServerMsg[] = [];
  const me = room.addPlayer({ send: () => {} }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  const other = room.addPlayer({ send: (d) => seen.push(JSON.parse(d)) }, 'other', 'token-other-0123456789', { name: 'other', stash: {}, upgrades: {} });
  room.handle(me, { t: 'character', id: 'grenadier' });
  for (let i = 0; i < 2 / TICK_DT && room.phase !== 'hunt'; i++) room.tick();
  return { room, me, other, seen };
}

test('characters are picked between raids and decide how you hide', () => {
  const { room, me, other } = grenadierRaid();
  assert.equal(me.profile.character, 'grenadier');
  room.handle(me, { t: 'character', id: 'rocketeer' });
  assert.equal(me.profile.character, 'grenadier', 'no switching mid-raid');
  room.handle(me, { t: 'character', id: 'nobody' });
  assert.equal(me.profile.character, 'grenadier', 'unknown ids are ignored');
  // The grenadier hides by going invisible, not by turning into props; the rocketeer still can.
  const propId = room.map.props.findIndex((p) => PROPS[p.type].tier === 0 && p.type !== 'smallBox');
  const box = room.map.propBoxes[propId];
  for (const p of [me, other]) p.body.pos = [(box.min[0] + box.max[0]) / 2, box.max[1], box.max[2] + 1];
  room.handle(me, { t: 'disguise', propId });
  room.handle(other, { t: 'disguise', propId });
  assert.equal(me.prop, 'smallBox');
  assert.equal(other.prop, room.map.props[propId].type);
});

test('the grenadier vanishes after standing still for 2 seconds', () => {
  const { room, me, other, seen } = grenadierRaid();
  me.body.pos = [0, 0, 4];
  other.body.pos = [0, 0, -4];
  const shown = () => {
    const snap = seen.filter((m) => m.t === 'snap').at(-1);
    return snap?.t === 'snap' && snap.players.some((p) => p.id === me.id);
  };
  for (let i = 0; i < 1.5 / TICK_DT; i++) room.tick();
  assert.ok(shown() && !me.invisible, 'still visible after 1.5 s');
  for (let i = 0; i < 1 / TICK_DT; i++) room.tick();
  assert.ok(me.invisible && !shown(), 'gone from the other player\'s snapshots');
  // Firing gives you away.
  room.handle(me, { t: 'rocket', origin: [0, 1, 6], dir: [0, 0, -1] });
  room.tick();
  assert.ok(!me.invisible && shown());
});

test('grenades arc, bounce, and go off on a direct hit or when the fuse runs out', () => {
  const { room, me, other } = grenadierRaid();
  // A direct hit: aim level at someone close by.
  me.body.pos = [0, 0, 3];
  other.body.pos = [0, 0, -1];
  room.handle(me, { t: 'rocket', origin: [0, 0.6, 5], dir: [0, -0.05, -1] });
  for (let i = 0; i < 20 && other.hp === 100; i++) room.tick();
  assert.ok(other.hp < 100, `hurt by a direct hit (${other.hp})`);
  assert.equal(room.rockets.size, 0);

  // Into the floor far from anyone: it bounces, then the fuse sets it off.
  other.body.pos = [0, 0, -40];
  me.lastRocket = -Infinity;
  room.handle(me, { t: 'rocket', origin: [0, 0.6, 5], dir: [0, -1, -1] });
  for (let i = 0; i < 10; i++) room.tick();
  const g = [...room.rockets.values()][0];
  assert.ok(g && g.kind === 'grenade' && g.bounced, 'bounced off the floor');
  for (let i = 0; i < 3 / TICK_DT && room.rockets.size; i++) room.tick();
  assert.equal(room.rockets.size, 0, 'went off');
});

test('the grenadier leaps in an arc, farther when charged, and rams whoever it lands on', () => {
  const { room, me, other } = grenadierRaid();
  const leap = (power: number) => {
    me.body = { ...me.body, pos: [0, 0, 12], vx: 0, vy: 0, vz: 0, onGround: true, charge: 0 };
    other.body.pos = [40, 0, 0];
    me.lastSkill = -Infinity;
    room.handle(me, { t: 'skill', yaw: 0, power });
    let top = 0;
    for (let i = 0; i < 3 / TICK_DT && me.body.charge > 0; i++) {
      idle(me, i + 1);
      room.tick();
      top = Math.max(top, me.body.pos[1]);
    }
    return { top, dist: 12 - me.body.pos[2] };
  };
  const short = leap(0);
  const long = leap(1);
  assert.ok(short.top > 0.4 && long.top > short.top, `an arc, higher when charged (${short.top.toFixed(1)} / ${long.top.toFixed(1)} m)`);
  assert.ok(long.dist > short.dist * 2, `farther when charged (${short.dist.toFixed(1)} / ${long.dist.toFixed(1)} m)`);

  me.body = { ...me.body, pos: [0, 0, 6], vx: 0, vy: 0, vz: 0, onGround: true, charge: 0 };
  other.body.pos = [0, 0, 3];
  me.lastSkill = -Infinity;
  room.handle(me, { t: 'skill', yaw: 0, power: 0 });
  for (let i = 0; i < 40 && other.hp === 100; i++) {
    idle(me, i + 1);
    room.tick();
  }
  assert.equal(other.hp, 70, 'took the hit');
  assert.ok(other.body.vz < -5, 'thrown back');
  assert.equal(me.body.charge, 0, 'the leap stops on impact');
  room.handle(me, { t: 'skill', yaw: 0, power: 1 });
  assert.equal(me.body.charge, 0, 'and has a cooldown');
});

test('a decoy looks like the player to everyone else and pops at the first hit', () => {
  const room = new Room('decoy', 7, { ...timings, hunt: 60 });
  const seen: ServerMsg[] = [];
  const me = room.addPlayer({ send: () => {} }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  const other = room.addPlayer({ send: (d) => seen.push(JSON.parse(d)) }, 'other', 'token-other-0123456789', { name: 'other', stash: {}, upgrades: {} });
  room.handle(me, { t: 'character', id: 'decoyTest' });
  for (let i = 0; i < 2 / TICK_DT && room.phase !== 'hunt'; i++) room.tick();
  me.body.pos = [0, 0, 4];
  other.body.pos = [0, 0, -4];
  room.handle(me, { t: 'decoy' });
  room.handle(other, { t: 'decoy' });
  const decoys = () => [...room.players.values()].filter((p) => p.decoyOf);
  assert.equal(decoys().length, 1, 'only characters with the decoy ability');
  me.body.pos = [10, 0, 4];
  room.tick();
  const snap = seen.filter((m) => m.t === 'snap').at(-1)!;
  assert.ok(snap.t === 'snap');
  const copy = snap.players.find((p) => p.id === decoys()[0].id)!;
  const real = snap.players.find((p) => p.id === me.id)!;
  assert.equal(copy.name, real.name);
  assert.equal(copy.character, real.character);
  assert.deepEqual(copy.pos, [0, 0, 4], 'stays where it was left');
  assert.ok(!snap.roster.some((r) => r.id === copy.id), 'not listed as a player');

  room.handle(me, { t: 'decoy' });
  assert.equal(decoys().length, 1, 'one at a time, with a cooldown');
  // One rocket pops it, without killing anyone or ending the raid.
  room.handle(other, { t: 'rocket', origin: [0, 0.3, -2], dir: [0, 0, 1] });
  for (let i = 0; i < 20 && decoys().length; i++) room.tick();
  assert.equal(decoys().length, 0, 'popped');
  assert.ok(seen.some((m) => m.t === 'poof'));
  assert.ok(!seen.some((m) => m.t === 'kill'));
  assert.equal(room.phase, 'hunt');
});

test('solo: the practice range has dummies that take hits and stand back up', () => {
  const room = new Room('solo-range', 7, timings, undefined, 'hideout');
  room.autoStart = false;
  const msgs: ServerMsg[] = [];
  const me = room.addPlayer({ send: (d) => msgs.push(JSON.parse(d)) }, 'me', 'token-me-0123456789ab', { name: 'me', stash: {}, upgrades: {} });
  room.handle(me, { t: 'practice', on: true });
  room.tick();
  assert.equal(room.map.theme, 'range');
  const dummies = [...room.players.values()].filter((p) => p.dummy);
  assert.ok(dummies.length >= 4, 'dummies stand in the range');
  assert.equal(room.humans.length, 1, 'dummies are not counted as players');

  // A rocket at the nearest dummy hurts it and tells the shooter how much.
  const dummy = dummies.reduce((a, b) => (Math.hypot(...a.body.pos.map((v, i) => v - me.body.pos[i])) < Math.hypot(...b.body.pos.map((v, i) => v - me.body.pos[i])) ? a : b));
  const origin: Vec3 = [me.body.pos[0], 1.6, me.body.pos[2]];
  const target = dummy.body.pos;
  room.handle(me, { t: 'rocket', origin, dir: [target[0] - origin[0], target[1] + 0.8 - origin[1], target[2] - origin[2]] });
  for (let i = 0; i < 2 / TICK_DT && !msgs.some((m) => m.t === 'dmg'); i++) room.tick();
  const dmg = msgs.find((m) => m.t === 'dmg');
  assert.ok(dmg && dmg.t === 'dmg' && dmg.target === dummy.id && dmg.amount > 0);
  assert.ok(dummy.hp < 100, 'the dummy is hurt');
  for (let i = 0; i < 4 / TICK_DT; i++) room.tick();
  assert.equal(dummy.hp, 100, 'it heals after a while');

  // No raid starts from the range, and leaving goes back to the hideout.
  room.handle(me, { t: 'start' });
  for (let i = 0; i < 1 / TICK_DT; i++) room.tick();
  assert.equal(room.phase, 'lobby');
  assert.equal(room.map.theme, 'range');
  room.handle(me, { t: 'practice', on: false });
  room.tick();
  assert.equal(room.map.theme, 'hideout');
  assert.ok(![...room.players.values()].some((p) => p.dummy), 'dummies are gone');
});
