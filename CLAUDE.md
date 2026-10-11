# Mechakov notes for Claude

- Prop hunt + extraction game: three.js client (`client/`), Node `ws` server (`server/`), shared rules in `shared/` used by both (the client predicts movement with the same `stepBody`).
- Checks: `npm run typecheck`, `npm test`, `npm run build`. CI runs all three.
- Workflow agreed with the owner: when a PR's CI is green, merge it yourself and move on to the next stage.
- Roadmap: 1) multiplayer core (done) 2) raid loot, extraction, hideout upgrades (done) 3) maps, balance, quick play, prop bots (done) 4) anti-cheat basics, Docker/deploy config (done); the owner hasn't picked a host yet, see DEPLOY.md.
- UI text is Korean.
- Testing alone: press B in the lobby to add prop bots (`server/src/bot.ts`); with bots the person is always the hunter.
- `tests/physics.test.ts` flood-fills every map to check spawns and exits are reachable; keep it passing when changing map layouts.
- Solo mode runs `Room` in the browser (`client/src/local.ts`) with `room.hunters = false` and `room.autoStart = false` (owner's calls: start as a prop, no hunter yet, exits open during hide too; a lobby screen between raids shows the stash and upgrades and starts the next raid, and the round ends once the person's raid is decided), so `server/src/room.ts` must stay free of Node-only imports. `npm run build:web` makes the single-file solo page published as a claude.ai artifact (https://claude.ai/artifact/HNCrFpqRfUqzo3xroXEpfe); republish it after gameplay changes.
