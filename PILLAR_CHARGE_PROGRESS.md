# Pillar Charge — progress (temporary, deleted when the feature ships)

Rollback branch: `before-pillar-charge` (pushed; = ba82dec, the tree before this feature).

## Phases
- [x] 1. Read the systems (notes below)
- [x] 2. Charge motion with a stable rider (no damage)
- [x] 3. Hit detection, damage, knockback, slam
- [x] 4. Targeting, steering, terrain and obstacles
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

## Phase 2 (charge motion, stable rider)
- `combat/techniques/earth/pillarCharge.ts`: `PILLAR_CHARGE` tuning block, the `earth_pillar_charge` technique
  (innate with Earth Pillar, cast with `force`, windup 0, channel while the pillar moves) and the driver.
- Driver phases: windup (0.1 s, leans back 4°, the stone shudders) → charge (smoothstep ease-in over 0.2 s to
  3× Earth sprint = 27 m/s, cruise, constant deceleration over the last 0.12 s, sub-steps of 1/60 s) → slam
  (pitch 15° in 0.12 s, back in 0.25 s) → chain window or lower (0.5 s smoothstep, never below the ground).
- Rider: `body.kinematic` while attached; each pre-frame the feet are put on the (tilted) top at the offset
  they had, velocities zeroed (knockback cannot move you), grounded on the pillar's collider. Jump = off.
- Terrain: ground sampled below the pillar's own top; slopes followed exactly, steps eased out.
- `RockPillar` (vfx/effects/constructs.ts): additive `takeOver / place / letGo / vanish / colliderId / isHeld`.
- `core/events.ts`: `pillarcharge:ready|launched|slam|ended` appended.
- Measured (fixed 1/60 steps, live loop stopped): 14 m no-target run slams 0.75 s after the tap; rider offset
  in the stone's frame constant to 0.4 mm over 98 frames; lowering 0.5 s.

## Phase 3 (hits, damage, knockback, slam)
- Swept front box each sub-step: width = 2·(radius + 0.35), full height, from the front before the step to the
  front after it (+0.25 m reach), queried through `EntityManager.queryRadius` into a reused buffer.
- Once per charge each: enemies (`combat.canHarm`) take the ram through the cast (1.5× Earth heavy = 48,
  knockback 8 m/s along the travel + out to their side, pop 3 m/s, stun 0.4 s, unblockable); heavy ones
  (`isHeavy`: dummies, bosses, beasts, poise ≥ 90, radius ≥ 0.75) stop the pillar dead with its front on them.
  Allies, NPCs, companions and animals get a gentle shove (body impulse, no damage).
- Slam shockwave 5 m around the ground ahead: 2× Earth heavy (64) at the centre falling to 50% at the rim,
  thrown outward (12 m/s × falloff), pop, stun 0.6 s, unblockable; walls/ledges make a 60%, half-power slam.
- Measured: line of three bandits rammed (−48 each) and bowled aside, slam on the locked target; a platypus
  bear stops the pillar ('heavy'); chain window → lowered → 5 s cooldown. Chi 100 → 70.

## Phase 4 (targeting, steering, terrain, obstacles)
- Target at launch: the locked enemy; else the harmable one within a 60° cone of the camera's view and 4..30 m,
  scored by angle from the reticle (then distance); else straight along the reticle for 14 m (ground slam).
- Homing on a (moving) target at 5 rad/s; the stick nudges the heading camera-relative at ≤ 1.1 rad/s.
  A target that dies keeps its last known position.
- Look-ahead once per frame along the heading (braking distance + margin, 0.35 m samples): solid colliders
  across the pillar's whole width (`solidAt`, own collider ignored, kerbs < 0.5 m climbed), per-sample rises
  > step + 35° and sustained rises over 2 m, drops > 1.2 m (ledges), water and non-earth ground, the world's
  edge. The braking curve then stops the front short of it; the slam is the small one ('blocked'/'ledge').
- Measured: cone picks the enemy 14 m ahead (skips one 50° off and one 3 m away); a 0.3 m wall stops it from
  27 m/s with the front 0.18 m short; a 5 m platform edge stops it with the front 0.2 m short; a 20° slope
  is ridden (+4.9 m), base change ≤ 0.17 m per frame.
