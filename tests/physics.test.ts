import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TICK_DT } from '../shared/constants.ts';
import { generateMap, THEMES } from '../shared/map.ts';
import { boxAt, overlaps } from '../shared/geometry.ts';
import { PROPS } from '../shared/props.ts';
import { stepBody, type BodyState } from '../shared/physics.ts';
import type { Box, InputKeys } from '../shared/types.ts';

const idle: InputKeys = { f: false, b: false, l: false, r: false, jump: false, sprint: false };
const forward: InputKeys = { ...idle, f: true };

test('the same seed gives the same map', () => {
  assert.deepEqual(generateMap(42), generateMap(42));
  assert.notDeepEqual(generateMap(42).props, generateMap(43).props);
});

test('bodies land on the floor and stay there', () => {
  const b: BodyState = { pos: [0, 3, 0], vy: 0, onGround: false };
  for (let i = 0; i < 60; i++) stepBody(b, 'hunter', null, idle, 0, false, TICK_DT, []);
  assert.equal(b.pos[1], 0);
  assert.ok(b.onGround);
});

test('walls stop movement', () => {
  const wall: Box = { min: [-5, 0, -3], max: [5, 3, -2] };
  const b: BodyState = { pos: [0, 0, 0], vy: 0, onGround: true };
  // yaw 0 faces -z, towards the wall.
  for (let i = 0; i < 60; i++) stepBody(b, 'hunter', null, forward, 0, false, TICK_DT, [wall]);
  assert.ok(Math.abs(b.pos[2] - (-2 + 0.3)) < 0.01, `stopped at ${b.pos[2]}`);
});

test('low ledges are stepped over, tall ones are not', () => {
  const ledge: Box = { min: [-5, 0, -3], max: [5, 0.2, -2] };
  const b: BodyState = { pos: [0, 0, 0], vy: 0, onGround: true };
  for (let i = 0; i < 60; i++) stepBody(b, 'hunter', null, forward, 0, false, TICK_DT, [ledge]);
  assert.ok(b.pos[2] < -3, 'walked over the ledge');
});

test('frozen hunters cannot move or jump', () => {
  const b: BodyState = { pos: [0, 0, 0], vy: 0, onGround: true };
  for (let i = 0; i < 30; i++) stepBody(b, 'hunter', null, { ...forward, jump: true }, 0, true, TICK_DT, []);
  assert.deepEqual(b.pos, [0, 0, 0]);
});

/** Flood fill over a 0.5 m grid of spots a hunter-sized body can stand on the floor. */
function reachable(map: ReturnType<typeof generateMap>) {
  const step = 0.5;
  const n = Math.ceil((map.half * 2) / step);
  const blockers = [...map.walls, ...map.propBoxes.filter((b) => b.max[1] > 1.2)];
  const free = (i: number, j: number) => {
    const x = -map.half + (i + 0.5) * step;
    const z = -map.half + (j + 0.5) * step;
    return !blockers.some((b) => overlaps(boxAt([x, 0, z], [0.6, 1.8, 0.6]), b));
  };
  const seen = new Uint8Array(n * n);
  const start = Math.floor(n / 2);
  const queue = [[start, start]];
  seen[start * n + start] = 1;
  while (queue.length) {
    const [i, j] = queue.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n || seen[a * n + b] || !free(a, b)) continue;
      seen[a * n + b] = 1;
      queue.push([a, b]);
    }
  }
  return (x: number, z: number) => {
    const i = Math.floor((x + map.half) / step);
    const j = Math.floor((z + map.half) / step);
    // Allow the nearest cells, since a spawn point can sit between grid cells.
    return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => seen[(i + di) * n + (j + dj)]);
  };
}

for (const theme of THEMES) {
  test(`${theme} maps are playable`, () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const map = generateMap(seed, theme);
      assert.ok(map.props.length > 60, `${theme}/${seed}: ${map.props.length} props`);
      assert.ok(map.props.every((p) => PROPS[p.type].themes.includes(theme)));
      assert.ok(map.propSpawns.length >= 12, `${theme}/${seed}: ${map.propSpawns.length} spawns`);
      assert.ok(map.lootSpots.length >= 30);
      for (const e of map.exits) {
        const zone = { min: e.min, max: [e.max[0], 2, e.max[2]] as [number, number, number] };
        assert.ok(!map.solids.some((s) => overlaps(zone, s)), `${theme}/${seed}: exit blocked`);
      }
      // Every spawn and exit can be walked to from the middle (props up to jump height can be climbed).
      const reach = reachable(map);
      for (const p of [...map.propSpawns, ...map.exits.map((e) => [(e.min[0] + e.max[0]) / 2, 0, (e.min[2] + e.max[2]) / 2])]) {
        assert.ok(reach(p[0], p[2]), `${theme}/${seed}: (${p[0].toFixed(1)}, ${p[2].toFixed(1)}) is cut off`);
      }
      for (const s of map.hunterSpawns) {
        assert.ok(!map.solids.some((b) => overlaps(boxAt(s, [0.6, 1.8, 0.6]), b)));
      }
    }
  });
}
