# Kyoshi Island expansion — progress (temporary; delete at the end)

Rollback branch: `before-kyoshi-island` (pushed, = 6105f8d). Work branch: `ccr-bee3c9ee-5j48is`.
Wiki (avatar.fandom.com) blocked by the network policy — working from the series frames + brief.

## Key decisions
- **Zone, not a main-map region.** The island lives in its own coordinate space far off the
  mainland's east edge: bay centre B = (7200, 0), zone square ±1024 m around B. The mainland ends at
  ±2048; max draw distance 1600 and the Horizon march (3 km) never reach across, so neither map
  sees the other. Zone registry: `src/world/Zones.ts` (zone id `kyoshi_island`).
- The main map ALREADY had a small "Kyoshi Island" (region id `kyoshi_island` at (1830,−420):
  Oyagi, Captain Suki's fan quest, fish market). Untouched (brief: no existing quest/NPC/marker may
  change). The new island's region id is `kyoshi_isle` (name "Kyoshi Island"). Flag in the report.
- Engine hooks (small, additive; mainland behaviour identical):
  - Heightfield: zone feature grid, island natural height (`landforms/kyoshiIsland.ts`), island
    roads/river/plateaus appended to the runtime lists, island biome weights.
  - Terrain: chunk range includes zone squares; WorldHeightTexture window re-centres on the zone.
  - World: `uHeightTexInfo` follows the window; RegionContent `unloadRadius` frees the island.
  - WorldLayout.regionAt: falls back to zone regions off the mainland.
  - Game.validSpawn: zone positions are valid (saves on the island).
- Travel: `src/travel/` system (routes table in `src/data/travel.ts`, flags ALLOW_ONWARD_TRAVEL /
  TRAVEL_REQUIRES_UNLOCK), confirm dialog, guards, journeys (scripted camera), state persisted
  (saveKey `travel`), return NPCs on the island, debug `__game.debug.travel`.
- City travel points are their own tiny RegionContent (`travel/points.ts`) so city files stay
  untouched.

## Island layout (polar frame around B; bearing b: 0 = north (−Z), 90 = east (+X))
Crescent arc from b = 255 (west tip, u = 0) clockwise 300° to b = 195 (east tip, u = 1); bay opens SW.
Inner shore r = 205; band thickness 170 (tips) → 430 (middle); ridge crest at t ≈ 0.64 of the band.
- u 0–0.12 west arm trail/cliffs, Corsair Cove (outer cliffs u≈0.06)
- u 0.12–0.30 Koi Bay beach; bison meadow u≈0.215 r≈330
- u 0.33–0.47 Suki's village: statue at the entrance (u 0.385, r≈268), street radially up to the
  Meeting Hall (r≈380)
- u≈0.52 r≈405 Kyoshi Dojo (NE of the village); shrine knoll u 0.58 r≈305 (h≈46)
- u≈0.665 Crystal Falls stream + Crescent Bridge on the coast road (r≈270)
- u 0.74–0.90 Koi Harbor (piers into the bay); u 0.92–1 east headland
- Islet: b 235, r 640.

## Phases
- [x] 1 terrain + layout blockout (crescent, bay, islet, stacks, cove, roads, Crystal Falls stream with
      auto stepped falls, plateaus; island biome/surface; trees allowed to 47° on the island)
- [ ] 2 travel system + placeholder island
- [ ] 3 travel points in NWT / FNC / BSS / SAT
- [ ] 4 village, dojo, shrine
- [ ] 5 bay, bridge, falls, harbor
- [ ] 6 people, boats, animals, routines, audio
- [ ] 7 journey cutscenes
- [ ] 8 polish, perf, verification, report (delete this file)

## USER OVERRIDE (mid-task message)
"I want everyone at the island to dress like that (there are only females at the island)" + image of
Kyoshi Warriors: green kimono + dark green skirt, dark armour plates with gold studs, gold headdresses
(several styles, captain's tasseled), white face paint, red eye make-up, red lips, gold fans.
=> ALL island people (crowd + named NPCs incl. harbormaster / bison keeper) are women in that outfit;
   roles/routines stay (farmers, fishers, cooks, traders, warriors) but the costume is the warrior
   outfit with small variations. City travel staff (NWT/FNC/BSS/SAT) keep their own city style.

## Existing files touched (keep for the report)
- src/world/Heightfield.ts (zone grid, island height/biome/surface, island feature lists)
- src/world/Terrain.ts (zone chunk range, height-texture window)
- src/world/env/WorldHeightTexture.ts (movable window)
- src/world/env/VegetationPlacement.ts (island-only: trees on steeper slopes)
- src/world/World.ts (height window uniform, RegionContent.unloadRadius)
- src/world/RegionContent.ts (optional unloadRadius)
- src/world/WorldLayout.ts (regionAt: far-zone fallback)
- src/world/regions/index.ts (Kyoshi factory line)
- src/core/Game.ts (validSpawn accepts far zones)

## Notes / resume hints
- Probe: node $S/ki/look.mjs OUTDIR [aerial,top,village,beach,harbor,falls,heights] (FAR=1600 for
  far views); slopes: node $S/ki/slopes.mjs. ($S = scratchpad dir)
- Steep (>40°) planar-projected grass/dirt look striped: keep rock on cliffs, forest the flanks.
- Scratch scripts: /tmp/claude-0/-home-user-Avatar-Four-Nations-/109f6a46-95c8-5cb7-b442-4929e597d312/scratchpad/ki/
