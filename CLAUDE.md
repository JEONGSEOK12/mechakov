# Mechakov notes for Claude

- Prop hunt + extraction game: three.js client (`client/`), Node `ws` server (`server/`), shared rules in `shared/` used by both (the client predicts movement with the same `stepBody`).
- Checks: `npm run typecheck`, `npm test`, `npm run build`. CI runs all three.
- Workflow agreed with the owner: when a PR's CI is green, merge it yourself and move on to the next stage.
- Roadmap: 1) multiplayer core (done) 2) raid loot, extraction, hideout upgrades 3) maps, item/upgrade balance, matchmaking, playtesting 4) hosting, anti-cheat basics, web release.
- UI text is Korean.
