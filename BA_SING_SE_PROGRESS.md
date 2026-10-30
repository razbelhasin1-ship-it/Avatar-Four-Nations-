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
- [ ] 2 monorail + trains (commit)
- [ ] 3 Lower Ring (commit)
- [ ] 4 Middle Ring (commit)
- [ ] 5 Upper Ring + palace (commit)
- [ ] 6 Agrarian Zone, Lake Laogai, Dai Li base (commit)
- [ ] 7 crowds, shops, vendors, audio (commit)
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
