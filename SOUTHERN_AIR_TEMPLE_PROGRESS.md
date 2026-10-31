# Southern Air Temple rework — progress (temporary; delete at the end)

Rollback branch: `before-air-temple-rework` (pushed). Work branch: `ccr-bee3c9ee-5j48is`.
Wiki (avatar.fandom.com) unreachable from this environment (connection refused) — sources: reference images 1–7 + brief.

## Key decisions
- Terrain untouched: the heightfield mesa (plateau `air_temple`, flat 330 m to r≈90, cliffs to ~150) is L0.
  The trail (`air_temple_switchbacks`, ends θ≈205°, r≈83 at 330), the Shrine of the Four Winds, the bison
  meadow and the world cloud sea (146–186 m) stay as they are.
- The pinnacle is region geometry: a polar height map (flat terrace floors, near-vertical cliffs, a rock
  cone between them) shaded in a world-space shader (strata, cracks, moss on tops); colliders are boxes per
  terrace sector + stacked cylinders for the cone.
- Temple-local mist sheets (fade near the camera) fill 280–326 m around the pinnacle: "above a sea of cloud".
- Angles θ: 0 = east, 90 = south, 180 = west, 270 = north (atan2(dz, dx)); centre C = (1450, 1250).

## Master plan (y above 330)
| Level | y | sector θ | r | content |
|---|---|---|---|---|
| L0 | 0 | ring | ≤ 90 | cliff foot, gate plaza (trail arrives θ 205), pools/falls, arched bridge to a gatehouse rock (θ≈150) |
| L1 | 18 | 262–338 | 60–86 | bison terrace: arched pavilion, hay, troughs, pond, 2 landing ledges, stable caves |
| L2 | 36 | 338–58 | 46–74 | orchards, vegetable beds, kitchens, refectory |
| L3 | 52 | 58–176 | 46–72 | quarters (pagoda halls), practice yards, airball court (cliff-edge shelf) |
| L4 | 68 | 176–342 | 26–60 | entrance courtyard (fountain, Gyatso statue), double-stair + moon gate, labyrinth + pavilion, gardens |
| L5 | 88 | 342–100 | 26–46 | main pagoda halls, meditation terraces |
| L6 | 110 | full | ≤ 26 | central tower (r 5.6, 70 m), sanctuary door, secondary towers, launch platform |
Road: one white switchback road, ~1.6 turns, L0 θ 190 → L1 → L2 → L3 → L4 → L5 → summit; shortcut stairs.

## Files
- `src/world/regions/air/sat/*` — new temple (layout, rock, road, buildings, courts, sanctuary, bison, lemurs, monks, audio, overlay)
- `src/world/regions/air/summit.ts` — SouthernAirTemple region class (rewritten to use sat/*)
- `src/world/regions/air/layout.ts` — spots re-placed

## Phases
- [x] 0 explore, branch, plan (fc20391)
- [x] 1 terrain + terrace blockout, road, mist, spires (walk test: 146 road points gate → summit, 0 stuck)
- [ ] 2 buildings + statue room
- [ ] 3 sky bison + lemurs + calling
- [ ] 4 monks + routines
- [ ] 5 atmosphere + audio
- [ ] 6 polish, perf, quests, tests, screenshots, report

## Markers moved
- Landmark `air_temple` and the Air start spawn → main landing ledge (L1, θ 280, r 91): fast travel and new Air games arrive by the bison terrace.
- `air_elder` (Monk Tenzo, greets arrivals) → bison terrace by the landing; masters: Tenzo → moon-gate courtyard (L4), Iio → airball court (L3), Pasang → summit (L6); fallbacks updated.
- Spots in `air/layout.ts` now come from `sat/layout.ts` PLACES (trail, trailhead, meadow, Four Winds unchanged).
- Shop `air_beasts` fallback → bison terrace.

## Notes / open items
- Level heights final: L0 0, L1 18, L2 36, L3 52, L4 68, L5 90, L6 108 (summit floor 438.2 world).
- Edge noise (EDGE_AMP 4.5) calmed where the L2 stairs run alongside (CALM table); flat road off-terrace = causeways.
- Old `grounds.ts` removed; `towers.ts` buildSpires is now unused (spires in sat/spires.ts).
- Masters "Sister Iio" and "Sister Yeshe": the monastery is men and boys only → renamed Brother (ids kept).
