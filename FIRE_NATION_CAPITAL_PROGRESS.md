# Fire Nation Capital rework — progress (temporary; delete when done)

Rollback branch: `before-fire-capital-rework` (pushed). Work branch: `ccr-bee3c9ee-5j48is`.
Wiki: avatar.fandom.com is blocked by the environment's network policy — built from the brief + the two series frames.
Story states (invasion, eclipse, comet sky, coronation): **none exist in the game** — nothing to preserve.

## Scope
ONLY the capital: First Lord's Harbor + sea wall, Royal Plaza, Harbor City (+ Zoryu Park, hill districts, foundries),
Sozin's switchback road, crater lip + gate, Hari Bulkan, Royal Palace (+ interiors).
Untouched: Sun Warrior Ruins (terrain around them is blended back to the old volcano flank so they look the same),
Ember Island, Western Causeway bridge, every other region. Shared-system edits must be additive.

## Engine decisions
- New capital = `EarthRegion` subclass (chunks + distance LOD + atlas house archetypes N1..N8 with red roof tint +
  generator build), in `src/world/regions/fire/fnc/`. Fire parts (`fire/parts.ts`: roof/hall/pagoda/brazier/crest…)
  build on chunk builders; FlameField for braziers/torches.
- Crowds: `earth/bssFigures` FigureRenderer (instanced, 2 LODs) + `earth/bssNav` NavGraph, new Fire Nation
  accessories appended additively (flame crown, skull helm, bell helm, sage hat, spear).
- Terrain: `world/landforms/fireCapital.ts` (pure) replaces the old VOLCANO block inside Heightfield;
  old formula kept and blended in around the ruins.

## Frame (all metres; north = −Z, east = +X)
- V = volcano / palace centre = (−1330, 1040). Axis: V → south (+Z) to the sea gate.
- Polar: r = distance from V, φ = atan2(dz, dx) in degrees (0 E, 90 S, 180 W, 270/−90 N).
- Sea gate (sea wall) at s = 720 (z 1760). L = 720.

| s from V (south) | zone | elevation |
|---|---|---|
| 560–720 | First Lord's Harbor basin (funnel 76 → 220 m wide), sea wall + Gates of Azulon at 720 | water 0, quays 2.6 |
| 470–560 | Royal Plaza (forum 36 × 90 between the side halls, pools, gatehouse) | 3.2 |
| 470 | Main tower across the valley head; narrow passage (stair) up to Harbor City | 3.2 → 14 |
| 250–470 | Harbor City, radial (ring streets + spokes), φ −55…185 | 14 → 46 |
| 122–250 | Sozin's road: 8 switchback legs on the south face, towers ~every 90 m | 46 → 142 |
| 0–122 | crater lip 142 (jagged peaks to ~215), floor 136, palace hill to 147 | |

Districts: South hill (both slopes flanking the plaza), North hill (NE, φ −50…10), Foundries (φ 20…55),
East gate (causeway road, φ ≈ 0, r ≈ 320), Zoryu Park (W, φ 150…185), markets on the Royal Way (φ 90) and ring junctions.
Hari Bulkan: palace ring wall 12-gon r 42; square south of it (r 45–78); avenue to the crater gate (φ 90);
big lake E (φ −15…40) with waterfall from the east wall; small lakes W; octagonal plaza W (φ 180, r 85);
Coronation Temple + plaza SE (φ 45, r 78) by the lake; palace garden villa + turtle-duck pond SW (φ 130, r 75);
High Temple (Fire Sages, catacombs entrance) NW (φ 235, r 82); Royal Fire Academy for Girls NE (φ 300, r 88);
tall narrow mansions elsewhere, some on the lip.
Palace: courtyard behind the south gate; central triple-eave tower; two front wings with end towers; throne wing north.
Interiors: throne room (north wing), Royal Gallery (west wing), Agni Kai arena (upper floor, east wing terrace).

## Gameplay hooks (old → new)
- STARTS.fire spawn (−1310,1230) → Royal Plaza central avenue; landmark fn_plaza → plaza.
- fn_harbor (dock, fast travel) → First Lord's Harbor quay; dock_fn_* spots → new quays; merchant_fn_3 → harbour fish market.
- fn_palace → palace gate; fn_arena → palace Agni Kai arena; fn_turtleduck_pond → garden villa pond (habitat_turtleduck_1).
- giver_fn_elder / fn_elder (Sage Hira, quest 'meet') → Royal Plaza. master_jeong + training_jeong → Royal Plaza
  drill yard (first master stays near the start). master_hira + training_hira + shrine_fire_sages (Sage Ryo, braziers
  quest) → High Temple court in Hari Bulkan. merchant_fn_1/2 → Harbor City market; merchant_fn_beasts → Harbor City stables.
- viewpoint_fn_* re-placed (palace stair → crater gate, rim gate → crater lip).
- ROADS fire_causeway_road re-routed from the causeway end to Harbor City's east gate.
- Old modules removed: capital.ts, cityRing.ts, harbor.ts, rimGate.ts (+ old CAPITAL layout).

## Phases
- [x] 0 explore, rollback branch, design (this file)
- [x] 1 layout blockout: terrain, harbor, sea wall, walls, roads, markers
- [x] 2 Royal Plaza + Harbor City
- [x] 3 road, crater, Hari Bulkan
- [x] 4 palace exterior + interiors
- [x] 5 ships, tanks, crowds, vendors, events, audio
- [ ] 6 polish, perf, debug overlay, walk test, 3 comparison passes, screenshots/fire-nation-capital/, report

## Notes / log
- P1: landforms/fireCapital.ts replaces the old VOLCANO in Heightfield (old formula kept near the ruins + perch,
  blended 46→196 m, never within 135 m of V). Plateau fire_caldera removed. City ground = paved (sampleTerrain
  roadType stone via capitalPaved; Zoryu Park + garden stay green). Vegetation blocked by inCapitalFootprint.
- Harbour aprons are slabs over deep bed (sea foam reads a ~4 m height texture; a terrain quay step made foam spikes).
- Region: fnc/FireCapital.ts (EarthRegion 'fire_capital'), builders harbor/plaza/city/road/caldera/palace.
- Lakes in WorldLayout LAKES: hb_lake_n/s, hb_lake_w1/w2, hb_turtleduck_pond (level 134.7).
- P2: plaza (4-tier main tower with rising passage tunnel, 3+3 colonnaded halls + tank bays, gate pavilions,
  gatehouse, quay steps, rim battlements + ballistae, corner walls); Harbor City ~1570 house stamps (N1..N8, cream
  walls, red roof tints; middle alley row), Royal Way market, foundries (stacks in foundryStacks), Zoryu Park.
- Fixed a shared bug in earth/geom.ts roofInto: square hip roofs had zero normals at the apex (black patches);
  now up. Affects BSS roofs only where they were black.
- Road top: H0..H7 hairpins, then a final leg to (0, gateS+13) and straight north into the gate; walls split
  where they'd stand in another leg's roadway; hairpin landings with curved battlements.
- P3: caldera.ts — square + proclamation dais, avenue (lanterns, dragon statues), ring street + spokes, waterfall
  (air/geom waterfallRibbon + own water material, registered 'waterfall' source), Coronation Plaza, garden villa,
  High Temple (+court for training_hira, catacombs stairwell), two academies, octagon plaza, ~5 rings of
  mansions (pagodaTower 4-7 tiers) + noble houses in gaps, lip watchtowers + gate bunkers. Palace hill unpaved
  (TODO P4: dark basalt drape over the hill — natural material shows grass).
- P4: palace.ts — ring wall + insignia gate, basalt drape on the hill, grand stair → courtyard (CY 147.2) → steps →
  palace floor PF 148.2; central tower (hollow hall, triple eaves); front wings + end towers (west = Royal Gallery,
  procedural portraits); throne wing (pillars, black floor, dais + side stair, canopied throne, wall of fire
  (FlameField), gold dragon relief); Agni Kai arena (AY = PF+4.4, roofed, 3-side seating, stair at t 10.2).
  Interiors lit by emissive (interiorMat, portraits, relief, sconces) — no real lights (shader recompiles).
- Walk test (scratchpad/fnc/walk.mjs): quay → plaza → passage → Royal Way → 8 hairpins → gate → square → palace gate OK.
- P5: fnc/vessels.ts (10 moored/anchored warships with colliders, 2 scheduled movers SHIP_IN/OUT
  through the sea gate, gate leaves swing inward, horn 'fnc_horn', boats, 4 tanks with dynamic colliders parked
  during rallies, 3 balloons; unit test tests/unit/fnc-vessels.test.ts keeps hulls over deep water and off
  quays); fnc/life.ts (CapitalLife: NavGraph over quays/plaza grid/passage/Royal Way/rings/spokes/road/caldera/
  palace, 440 agents by LIFE.cast, routines, stalls covered at night, squads, drill + 2 academy formations with
  flame bursts, sages, rally + proclamation events, foundry smoke/clangs, rumble, crowd loop); fnc/people.ts
  (Fire Nation accessories via bssFigures EXTRA_ACC — additive; palettes); fnc/audio.ts (horn, drum, march,
  clang, rumble). Debug: __game.debug.fnc (life, vessels, ships, skipShips, rally(on, instant), proclaim,
  overlay, nav); F3 overlay (SatOverlay reused) while in the capital.
- P5 extras: density bubble (people kept around the camera's focus point in Harbor City: doors in view / corners
  out of view), landmarks fn_harbor_city + fn_hari_bulkan (kind 'city': map labels, city ambience, encounter
  safe zones), fn_elder (Sage Hira) re-placed on the plaza, turtle-ducks + 'fn_feed_turtleducks' restored
  (fnc/ducks.ts). Probe: 440 people, 101-140 drawn in Harbor City views, rally 320, proclamation 24, 0 errors.
  tests: region-fire e2e rewritten (not yet run), perf/audio/enemies coords, env.vegetation volcanic sample moved.
