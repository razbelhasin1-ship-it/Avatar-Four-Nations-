# Avatar: The Four Nations — contributor guide

Browser 3D open-world action RPG inspired by Avatar: The Last Airbender.
Stack: **TypeScript 7 (tsgo) + Vite 8 + three.js r186**, no other runtime deps. Everything
(models, textures, audio) is procedural — no binary assets, no external services at runtime —
except the main menu music, `src/audio/music/tracks/menu-theme.mp3`, chosen by the project owner.

## Commands

```bash
npm run dev          # vite dev server
npm run typecheck    # tsc --noEmit  (must stay at 0 errors)
npm test             # vitest unit tests (tests/**/*.test.ts)
npm run build        # typecheck + production build
node tests/e2e/smoke.e2e.mjs                 # browser smoke test (headless Chromium, SwiftShader)
node scripts/shot.mjs --element water --out /path/a.png [--eval "g => g.teleport(x,z)"] [--wait ms] [--hideui]
MAP_OUT=/path/map.png npx vitest run tests/tools/worldmap.test.ts   # top-down world render
```

Headless WebGL is software-rendered (SwiftShader): ~5-15 fps at 960×540 on the `low` preset. The
harness seeds the `low` preset by default (`launch({ preset: 'medium' })` to override). Prefer
`h.step(n)` (deterministic fixed-step simulation) over wall-clock waits in tests.
Screenshots are how you judge visuals — take them, open them with the Read tool, iterate.

## Architecture (src/)

| Path | What |
|---|---|
| `core/Game.ts` | Orchestrator: owns all systems, frame loop, sessions (campaign/tutorial), menu backdrop |
| `core/GameContext.ts` | `GameContext` service registry passed to every system; `GameSystem` lifecycle hooks |
| `core/events.ts` | **Typed event catalogue** — systems talk through `ctx.events`, not imports |
| `core/Input.ts` | Action mapping (keyboard/mouse/wheel/gamepad/virtual touch), rebinding |
| `core/Settings.ts` | Persistent settings + quality presets; apply live on `settings:changed` |
| `core/Save.ts` | Versioned slot saves; `Persistable` (saveKey/serialize/deserialize/reset) |
| `core/Debug.ts` | `window.__game` automation API (tests use it heavily — extend it for your feature) |
| `modules.ts` | **Plug-in point**: add `{ name, order, create(ctx) => GameSystem }` for new systems |
| `render/Renderer.ts` | WebGLRenderer, composer (bloom), sun/hemi lights, shadow focus, quality |
| `world/WorldLayout.ts` | Macro map: regions, landmarks, starts, rivers, lakes, roads, ranges, plateaus |
| `world/Heightfield.ts` | Pure terrain functions: `heightAt`, `waterAt`, `biomeWeights`, `materialAt`, runtimes for rivers/lakes/roads |
| `world/Terrain.ts` `Water.ts` `Sky.ts` | Chunked LOD terrain, water surfaces, sky/time-of-day |
| `world/World.ts` | Facade: ground/water/surface/region queries, raycast, region content streaming, `world.fx` env hooks, discoveries |
| `world/Collision.ts` | Static/dynamic colliders (Y-rotated boxes, cylinders, spheres; walkable tops, ramps) |
| `world/RegionContent.ts` + `world/regions/` | Cities/temples/villages; register factories in `world/regions/index.ts` |
| `world/Interactables.ts` | E-prompt interactions (`ctx.interactions.register(...)`) |
| `entities/` | `Entity` (health/poise/status/receiveHit), `KinematicBody`, `EntityManager` (spatial queries), `TrainingDummy` |
| `character/` | `Humanoid` (procedural rigged model), `Animator` (clips + procedural locomotion), `Appearance` data, base clips |
| `player/` | `Player` (Combatant; movement styles per element; aim; input→techniques), `CameraRig`; `play/` = held-attack play while exploring (water orb from real sources, lifting real rocks or stones torn from the ground — `Stones.ts` keeps them as re-liftable loose stones, palm flame; never Air) |
| `combat/` | `types.ts` contracts, `CombatSystem` (casts, projectiles, hits), `WaterSources.ts`, `techniques/` |
| `vfx/` | `VFXSystem` (particle presets, emitters, rings, flashes, transients) |
| `audio/AudioEngine.ts` | Procedural WebAudio; `registerSound` / `registerLoop`; music themes |
| `progression/` | Elements, learned techniques, loadouts, mastery (proficiency+lessons+trial), Elements Sphere rule |
| `quests/` + `data/quests.ts` | Data-driven quests; objectives complete from events |
| `npc/` + `data/npcs.ts` `data/dialogues.ts` | NPC streaming, behaviours, dialogue runtime (`ctx.npcs.onAction(type, handler)`) |
| `companions/` | Companion system (bonded records, mount state) |
| `avatar/` | Avatar State / Elements Sphere |
| `inventory/` + `data/items.ts` `data/cosmetics.ts` | Items, currency, cosmetic unlocks |
| `ui/` | DOM UI: `UIManager` (screens, toasts, dialogue, loading, confirm), `hud/HUD.ts`, `screens/*`, `styles.css` |

### Key conventions
- Units: metres, seconds, radians. **Y up, north = −Z, east = +X.** Sea level y = 0. World spans ±2048.
- Facing: an object's local **+Z is forward**; `yaw` → forward `(sin yaw, 0, cos yaw)`; `root.rotation.y = yaw`.
- Character's **left is +X, right is −X**. Pose conventions are documented at the top of `character/Animator.ts` — read them before authoring clips.
- Entities: `root.position` = feet. `aimPoint()` = chest. Teams: `player | ally | hostile | neutral | wildlife`.
- Damage only through `CombatSystem` (`cast.hit`, `cast.areaHit`, projectiles, or `combat.applyHit`) so dedup, events, XP and feedback work. One collision event must never deal repeated damage unless intended.
- Techniques: `registerTechnique({...})` in `combat/techniques/<file>.ts`, import the file from `combat/techniques/index.ts`. Water techniques declare `water: { amount }` — water comes only from `ctx.water.acquire` (reserve → nearby real source). Never conjure water except `canConjure` ultimates.
- New systems: implement `GameSystem`, add to `src/modules.ts`. Persistent state: also implement `Persistable` (Game auto-registers modules with `saveKey`). Tolerate `undefined`/partial data in `deserialize`.
- New regions: implement `RegionContent`, add the factory to `world/regions/index.ts`. Static geometry/colliders/water sources in `build()`; session entities (NPCs, creatures, interactables) in `onSessionStart()` and clean up in `onSessionEnd()`.
- New events: add to `core/events.ts` (append; never rename existing keys).
- Data (quests, NPCs, dialogues, cosmetics, items) lives in `src/data/`. Prefer data over code.
- Settings must affect real behaviour and apply live. Graphics-heavy features read `ctx.settings.data.graphics` and scale (Low must stay playable; never disable gameplay — collision, water detection, damage — to save performance).
- Dispose geometries/materials/textures you create (`dispose()` / `onSessionEnd`). No leaks across travel, Avatar State toggles, companion switching or session restarts.
- Keep `npm run typecheck` at zero errors. Match surrounding style (2-space indent, single quotes, semicolons, explicit types on public APIs).
- Debug hooks: expose test helpers on `(window as any).__game.debug.<feature>` or extend `core/Debug.ts`.

## Team etiquette (multiple agents work concurrently in this tree)
- Stay inside the files/directories your task assigns. If you must touch a shared file (`modules.ts`, `events.ts`, `regions/index.ts`, `techniques/index.ts`, `data/*`), make small additive edits — never reformat or rewrite other people's code.
- Typecheck may show errors from someone else's in-progress files: filter to your own paths (`npx tsc --noEmit 2>&1 | grep src/your/dir`), but leave the tree compiling when you finish.
- Do not `git commit`, `git stash`, `git checkout` or reset — the lead integrates and commits.
- Run browser tests with the harness (it picks a free port). Kill any process you start.

## Quality bar (from the product brief — non-negotiable)
- Real gameplay, not mockups: every button works, every advertised feature is implemented and verified.
- The four elements must feel distinct (movement, rhythm, ranges, shapes), not recoloured copies.
- Waterbending depends on real environmental water. Ordinary attacks never create unlimited water from nothing.
- Masters teach real, usable, persisted techniques. Mastery ≠ knowing techniques.
- Avatar State is available early, at will; Elements Sphere only after all four masteries.
- Effects must match actual collision/gameplay. Never claim something works without verifying it.
