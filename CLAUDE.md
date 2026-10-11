# Mechakov notes for Claude

- Prop hunt + extraction game: three.js client (`client/`), Node `ws` server (`server/`), shared rules in `shared/` used by both (the client predicts movement with the same `stepBody`).
- Checks: `npm run typecheck`, `npm test`, `npm run build`. CI runs all three.
- Workflow agreed with the owner: when a PR's CI is green, merge it yourself and move on to the next stage.
- Roadmap: 1) multiplayer core (done) 2) raid loot, extraction, hideout upgrades (done) 3) maps, balance, quick play, prop bots (done) 4) anti-cheat basics, Docker/deploy config (done); the owner hasn't picked a host yet, see DEPLOY.md.
- UI text is Korean.
- Sounds are synthesized with Web Audio in `client/src/sfx.ts` (no audio files); M mutes.
- Testing alone: press B in the lobby to add prop bots (`server/src/bot.ts`); with bots the person is always the hunter.
- `tests/physics.test.ts` flood-fills every map to check spawns and exits are reachable; keep it passing when changing map layouts.
- Solo mode runs `Room` in the browser (`client/src/local.ts`) with `room.hunters = false` and `room.autoStart = false` (owner's calls: start as a prop, no hunter yet, exits open during hide too; between raids you walk around the `hideout` map (`shared/map.ts`, stations: stash lockers, workbench, raid door; bots are hidden there), and the round ends once the person's raid is decided), so `server/src/room.ts` must stay free of Node-only imports. `npm run build:web` makes the single-file solo page published as a claude.ai artifact (https://claude.ai/artifact/HNCrFpqRfUqzo3xroXEpfe); republish it after gameplay changes.
- Raid maps are 100 m across (`HALF = 50` in `shared/map.ts`), built from named zones per theme (`warehouse`/`office`/`yard` functions) with props chosen to fit each zone. Place walls and props only through `Builder` (`shared/layouts.ts`), which keeps doorways, exits and the middle clear. Sprint stamina lives in `BodyState` so the client predicts it with the same `stepBody`; snapshots carry it for reconciliation.
- Props are drawn from detailed models in `client/src/models.ts` (parts with vertex colors merged into one geometry per type, front facing +z; `rot` is 0-3 quarter turns so things face into rooms). Collision is still the box in `shared/props.ts`, so keep models inside it. Warehouse racks and yard containers are drawn there too, from their wall boxes.
- Owner's calls on layouts: orderly rows rather than random scatter, things that block sight (racks, high cubicle walls, fire doors, containers) so you can't see across the map, and not too many props (about 300 to 600 per map).
