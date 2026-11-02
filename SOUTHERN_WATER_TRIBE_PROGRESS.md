# Southern Water Tribe (Wolf Cove) + Water homelands — progress (temporary, delete at the end)

Rollback branch: `before-southern-water-tribe` (pushed). Work branch: `ccr-bee3c9ee-5j48is`.

## Phases
- [x] 0 Explore (start flow, quests, areas) — notes below
- [x] 1 Start options table (data/starts.ts), origin in save + flag origin_<id>, FEATURES.START_WATER_HOMELANDS (core/features.ts), homeland step (NewGameFlow), placeholder Southern start (HOMELAND_STARTS.water_south in the stub village), master_aput + swt_elder + dlg_swt_elder + mq_awakening_water_south (placeholder steps)
- [x] 2 Terrain (landforms/wolfCove.ts: cove opening east, terrace, ramp, hill; polar shores; treeless south), wall.ts (slabs, cap, icicles, 6 lookouts, 2 gate towers, 6 stairs), layout.ts (seeded: 120 igloos, 25 tents, 7 homes)
- [~] 3 Village (village.ts) + interiors (interiors.ts, domes.ts) built; polish lighting/night, verify interiors
- [~] 4 Outskirts (shore.ts): beach, hunting ice + fishing holes (swt:fishing_hole_*, swt:sea_ice), bergs, wreck, sled run + tunnel, tundra; verify
- [~] 5 People (swt/life.ts: 180 villagers, 12 roles, routines, nav grid + wall walk + shore/sled/tundra), figures.ts (parkas, hoods, loops, wolf tails, war paint), wildlife.ts (penguins, tiger seals, dogs, gulls, polar bear dog, canoes/kayaks on a schedule), atmosphere.ts (aurora, raid marks), audio.ts (ice, animals, drums, carving), music theme 'swt', weather + fog; debug `__game.debug.swt`
- [ ] 6 Southern first quest (Master Aput) mirroring mq_awakening_water
- [ ] 7 Preview (menu tour stop), polish, perf, e2e five starts + old saves, screenshots (3 passes), report

## Key facts (phase 0)
- Start screen: `src/ui/screens/NewGameFlow.ts` steps element -> creator -> preview -> confirm -> `game.newGame(cfg)`.
  Cards: `.element-card` (styles.css ~L660). Card art = `getVista(id)` (MainMenu) = snapshot taken by the
  menu backdrop tour (`MENU_SHOTS` in core/Game.ts, `storeVista` accepts element ids only).
- Starts: `STARTS: Record<Element, StartDef>` in WorldLayout (used by Game.newGame/loadGame, Player.deserialize,
  Debug.startPoint, EncounterDirector safe zones, NewGameFlow). Water = Northern (spawn -236,-1606).
- First quests: `src/data/quests.ts` `mq_awakening_<element>` autoStart `{ startingElement }`; Northern water:
  talk nwt_elder -> draw water + cast x3 -> Avatar State; rewards 120 xp / 50 / 5 sea prunes.
  TrainingSystem.syncStoryFlags sets `avatar_awakened` when any `mq_awakening_<e>` is complete (main line starts).
- Masters: `src/data/masters.ts` (Siku = Grandmaster of Water, NWT). SWT stub master: Hunter Akka (keep lessons).
- SWT stub: `src/world/regions/water/swt.ts` (+ PLATEAUS 'swt_village' r90 h3, landmark swt_village (220,1600),
  region southern_water_tribe r260). Spots to keep: master_akka, training_akka, giver_swt_chief, merchant_swt_1,
  dock_swt_ice, viewpoint_swt_tower, shrine_swt_firepit, habitat_otter_penguin_2.
- Crowd infra: FigureRenderer/Pose (earth/bssFigures), NavGraph (earth/bssNav); KI life.ts is the template.
- Speeds (water): walk 2.2, run 7, sprint 9.6 m/s.

## Design decisions
- Wolf Cove centre C (220, 1660), wall radius 74 m (density vs image 1), terrace floor = plain + 8, wall top = floor + 2.
- Sea to the north: carve a cove (bay) into the polar land's north side; reroute the last leg of `southern_road`
  around its west side. Shore ~110 m north of the gate; shipwreck at the cove's SW shore; sled run NW; tundra S.
- Origin ids: earth | air | fire | water_north | water_south. Old saves -> water_north. Flag `origin_<id>`.
