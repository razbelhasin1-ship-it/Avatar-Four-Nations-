# Pillar Charge — progress (temporary, deleted when the feature ships)

Rollback branch: `before-pillar-charge` (pushed; = ba82dec, the tree before this feature).

## Phases
- [x] 1. Read the systems (notes below)
- [ ] 2. Charge motion with a stable rider (no damage)
- [ ] 3. Hit detection, damage, knockback, slam
- [ ] 4. Targeting, steering, terrain and obstacles
- [ ] 5. Camera, animation, VFX, audio, haptics
- [ ] 6. Controls, UI, tutorial
- [ ] 7. Tuning, edge cases, tests

## Phase 1 notes (how the existing systems work)
- **Earth Pillar** (`combat/techniques/earth/constructs.ts`): with no target it raises a `RockPillar` under you
  (radius 1.05, height 3.0, rise 0.38 s, stand 6 s, sink 0.8 s), chi 14, cooldown 1.4 s.
- **RockPillar** (`vfx/effects/constructs.ts`): an `EarthConstruct` live effect with a DYNAMIC walkable
  cylinder collider (`tag: 'bending'`, `owner`); phases rise/stand/sink/move/gone; `level` 0..1; `carry()` lifts
  entities on its top while rising. Constructs age in `updateEffects` (bending_fx, order 850). The punched
  StoneWall already slides along the ground (`phase = 'move'`), the model for a moving construct.
- **Frame order** (`core/Game.ts updatePlay`): systems < 30 (bending.pre @25: movers + `hook.pre`) → entities
  (player first) → systems ≥ 30 → bending_fx @850 (constructs) → vfx/world → camera @1000.
  So the charge drives the pillar AND the rider in a `bending.hook({ pre })`: pillar → player → camera.
- **Player** (`player/Player.ts`): `updateMovement` handles Dodge (`input.wasPressed('dodge')`, dodge roll that
  would throw you off the pillar) and Jump. `Input.consume(action)` hides a press from later readers, so the
  charge can take Dodge on a pillar without touching Player. Earth `MOVE_STYLES.earth.sprint` = 9 m/s.
- **KinematicBody**: `kinematic` skips gravity/ground/walls (pos += velocity·dt); `groundColliderId` tells which
  collider you stand on (the pillar's id when on it).
- **Casts** (`combat/CombatSystem.ts`, `combat/types.ts`): `registerTechnique` with windup/channel/
  `channelUpdate`/`end`; `cast.hit(target, info, allowRepeat)` dedups per cast; `cast.areaHit`;
  `combat.startCooldown(c, id, s)`, `cooldownFraction`; tryCast checks knows (unless `force`), cooldown, chi,
  busy, grounded, precheck, and emits `technique:failed` (HUD flashes the chi bar on 'chi').
- **Camera** (`player/CameraRig.ts`): `extraDistance`, `extraFov` (fov damped at 6/s), pivot smoothing, lock-on
  framing; `camera:shake` scaled by `settings.controls.cameraShake` (0 = off).
- **Touch** (`ui/TouchControls.ts`): buttons relabel by context (`setCap`, label signature); ability buttons have
  a conic cooldown ring (`.tcd`); `Input.setTouchCaption` makes hints name a relabelled button.
- **Earth heavy** = Earth Slam (`earth/basic.ts`): `(14 + 18·k)·mul`, 32 at full charge.

## Design decisions
- New technique `earth_pillar_charge` in `combat/techniques/earth/pillarCharge.ts` (tuning block at the top),
  innate with Earth Pillar (not taught, never auto-slotted, cast with `force` when you know Earth Pillar).
- A `PillarCharge` driver (bending pre hook) owns the move: wind-up → charge → slam → chain window → lower.
- Additive API on `RockPillar` so an external driver can hold, move, tilt and lower it.
