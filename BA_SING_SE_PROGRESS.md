# Ba Sing Se rework — progress (temporary; delete when done)

Rollback branch: `before-ba-sing-se` (= a260485). Work branch: `ccr-bee3c9ee-5j48is`.
Wiki (avatar.fandom.com) is blocked by the session network policy: built from the brief + images.

## Decisions
- Concentric rings around the palace at C = (850, -50), ground y = 26 (existing plateau r=430).
- Radii (R = 410 = Outer Wall): palace wall 40 (9.8%), Middle|Upper wall 86 (21%),
  Lower|Middle wall 156 (38%), Inner Wall 246 (60%), Outer Wall 410 (100%).
- Wall heights: Outer 180 m (backdrop scale, gate + arrival station built), Inner 60 m earthen,
  ring walls 30 m (gates signed 中環 / 上環), palace wall 9 m. Gates = sliding earthbent slabs.
- Main approach: west Outer Wall gate where the northern road arrives (θ≈196°), arrival station inside.
- Palace axis N-S, South Gate at θ=90° (z = C.z + 40).
- Monorail deck 28 m (outer loop 34 m so it passes over the radials at the Y-junction).
  3 radial lines (C, N, S) leave the arrival station side by side, pass the Inner Wall main gate,
  split at the Lower Ring Y-junction station (r≈228), Middle Ring stations (r≈120),
  terminate at Upper Ring stations next to the inner loop (r≈60; S = Palace South Gate station).
  Outer loop r=228 (3 stations), inner loop r=47 (3 stations). Shuttles reverse at stub terminals.
  Trains: 2 per radial line, 2 on the outer loop, 1 on the inner loop (= 9, keeps 60-90 s headway).
- Riding: `player.mountAnchor` = seat on a train car (same mechanism as companion mounts).
- Dai Li base: real underground under the meadow beside Lake Laogai. Needs an additive World API
  (underground volumes: terrain ignored by groundAt/raycast inside them) + lighting dim while inside.
- Story: `entity:killed` with tag `boss_dai_li_captain` → quest flag `laogai_raided` → entrance shown wrecked.
- Crowds: new instanced crowd (vertex-animated low-poly figures, 2 LODs, waypoint graph, schedules).
- Spot IDs in spots.ts are kept (NPCs, shops, masters reference them); only positions move.

## Phases
- [x] 0 explore + plan (this file)
- [x] 1 layout blockout: walls + gates (commit)
- [x] 2 monorail + trains (commit)
- [x] 3 Lower Ring (commit)
- [x] 4 Middle Ring (commit)
- [x] 5 Upper Ring + palace (commit)
- [x] 6 Agrarian Zone, Lake Laogai, Dai Li base (commit)
- [x] 7 crowds, shops, vendors, audio (commit)
- [ ] 8 polish, perf, screenshots (screenshots/ba-sing-se), 3 comparison passes, walk test, report (commit)

## Files
src/world/regions/earth/bss*.ts (BSS only). Shared, additive: World.ts (underground), atlas.ts +
archetypes.ts (new roof tiles / archetypes appended), WorldLayout.ts (BSS road/landmark coords),
data/npcs.ts (bss_elder coords), spots.ts, tests/e2e/region-earth.e2e.mjs (BSS checks).

## Notes / state
- Phase 1: bssLayout (knobs + gates + rail lines + BSS spots), bssKit (BssMats, batteredSegment,
  gateBlock, pillarTower, medallion, sign, RailPath), bssWalls (outer/inner/ring/palace walls, grounds,
  GateRuntime slabs). Old bssLower/bssRings/bssOuter removed. Shots: scratchpad/lead/bss_shots.mjs JSON poses
  (camera y is ABSOLUTE; ground = 26).
- TODO later: Lower Ring mud ground material (groundLower looks like paving).
- Phase 2 layout change: palace arcade r=44 (inner loop on it), 上環 wall r=102, 中環 wall r=170; trunk lateral
  offsets N +26.5 / C +10.5 / S -10.5 (west avenue runs between C and S); outer loop deck 36; terminal stubs at r=58.
  Trains: cruise 18 m/s, accel 2.6, dwell 15/16 s → headways 73-89 s (tests/unit/bss_rail.test.ts).
  Files: bssRail.ts (viaducts, stations, lifts), bssTrains.ts (schedules, cars, benders, passengers, riding),
  bssFigures.ts (instanced people, poses, accessories), bssAudio.ts. Debug: __game.debug.bss.
  Check script: scratchpad/lead/bss_ride.mjs (lift, trains move, board, alight, gate).
- Phase 3: layout v3 — junction stations r=210, outer loop r=232 deck 40 (flat spans over other lines), pier-only
  exclusions so houses sit under arches. Neutral roof tile 'roofN' + archetypes N1..N8 tinted per house (roofMask).
  bssNav.ts (walk graph), bssLower.ts (fillRing rows R1..R4, square + Firelight Fountain, Pao tea house, factory,
  stable (beast keeper Gong at 648.5,23.3), market (marketStalls follows the arc), dressing, smoke/steam emitters).
  ~494 houses. Shots: use steps>=15 so chunk LOD refreshes.
- Phase 4: bssMiddle.ts. Landmark blocks (BSS.dojo/university/townHall/financial/marketPlaza/gardenW/spa/poetry,
  ring frame via ringLocal) moved into sectors clear of the N/S viaducts (EARTH_PROBE=blocks in
  tests/tools/earth_probe.test.ts prints free sectors). Streets planned before claiming ground: flank radials per
  block, evenly spaced cross streets, tree-lined lane r=136 with tiled garden walls, lift access paths.
  Ground = bm.lawn (flagstone streets read against lawns). Markers moved: master_lien / training_lien
  (ringLocal(dojo)), bridge_bss_garden, WorldLayout bss_dojo (822,-183). ~75 Middle Ring houses.
  Polish later: plaza pavilion roof proportions; Town Hall second eave.
- Phase 5: bssUpper.ts (walled estates with yellow roofs fitted between viaducts/lifts/avenues; landmarks
  BSS.upper: War Room (floor map bm.warMap + tokens), Fancy Lady Day Spa, Jasmine Dragon, Iroh/Zuko apartment,
  Team Avatar house, 2 fountain plazas; promenade trees/lamps; 4 pagoda pillar towers on the axis; park trees).
  bssPalace.ts (South Gate block + pavilion, Golden Water canal + 5 bridges, 3-tier platform BSS.palace.tiers,
  throne hall with interior/throne, bell/drum pavilions, inner court: wall, pond, quarters, kitchens, menagerie).
  Inner-loop lifts now outside the palace (stairs -1); pal_s moved to 40 deg ("Upper Ring East"); palace gate
  opening 24 m; piers kept out of both palace gates. Upper band ground = lawn. Marker: viewpoint_bss_palace
  (terraceZ 15, y = tier 3). Fixed: cylinder() takes the BOTTOM centre (Middle/Lower Ring props were floating).
  Polish later: up_s lift tower stands on the promenade; lift towers look like scaffolds.
- Phase 6: bssFarm.ts (field patchwork in 4 rings: paddies (flooded ones = real water), cabbage, grain,
  orchards, pasture, fallow; canal ring r=316 = merged strip + hidden water sources every 12 m; dirt tracks;
  farmsteads; 3 rock hills (bm.rock); zoo with 4 pens + primitive animals; arrival gateway 歡迎光臨永固城 +
  passport hall 護照/入城登記 + paved plaza; guide NPC bss_guide (data/npcs.ts, dlg_bss_guide)).
  bssLaogai.ts: shore (reeds, liftable boulders, trees, pier + boathouse), the Dai Li base sealed inside a rock
  hill (terrain cannot be dug: no engine change), spur with the concealed door, 9 stepping stones that rise
  (interaction bss_laogai_path), door (bss_laogai_door), rooms (ante, bison cavern, prison 8 cells, training,
  brainwashing chamber + spinning lantern), GateRuntime sliding doors, green lamps, lights/fog dimmed while
  inside (after Sky), flag laogai_raided on boss_dai_li_captain kill -> door rubble + stones up.
  Debug: __game.debug.bss.laogai()/laogaiRaise()/laogaiOpen()/laogaiSet(r,o).
  Harness note: SwiftShader screenshots of the full city take 10-60 s: pass a 240 s timeout (bss_one.mjs does).
  Draw calls at street level: Lower ~800, Middle ~400, farm ~700-1000 (perf pass in phase 8).
- Phase 7: bssCrowd.ts (CrowdSystem on the nav graph, drawn by FigureRenderer, which now culls to the view
  frustum). ~490 people simulated (CROWD in bssLayout × graphics density) + 67 stall/shop keepers + gate guards and
  wall soldiers. Roles per district (ROLES) and clothing by class (PAL); daily routine (activity(): out at dawn,
  busiest by day, tea houses at dusk, home at night; walk to a door when seen). Density bubble: people out of
  sight are moved into the streets around the camera (BUBBLE_TARGET per district within 80 m: Lower 200, Middle 90,
  Upper 16, farm 18), arriving out of view or from doorways/stations; around the camera people mostly pick local
  destinations weighted by place type (squares, stalls, shops, tea). Shops: shutters and stall covers 21:00-06:00,
  keepers sweep at dawn, haggle, greet the player; hawking calls rate-limited. Lamps (bm.glow) lit at dusk.
  Dai Li patrol the base and (new) a shore loop round Lake Laogai at night. Audio (bssAudio): crowd murmur by
  local density, train rumble at the nearest moving train, Laogai hum, farm animals and birds by day.
  Debug: __game.debug.bss.crowd() stats, crowdWarm(seconds) fast-forwards the crowd without rendering (shots).
  Update cost ~0.1-0.4 ms/frame.
