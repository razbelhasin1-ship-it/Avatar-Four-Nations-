# Character clip library

All clips are registered at module load (`src/character/clips.ts` imports
`combatClips.ts`; `core/Game.ts` imports `character/clips`). Play them on any
humanoid:

```ts
humanoid.animator.play('strike_r', {
  speed: 1.2,                       // optional time scale
  onEvent: (name) => { if (name === 'release') fireProjectile(); },
  onEnd: () => {},
  hold: false,                      // true = hold the last key until animator.stop(id)
});
```

`release` is the frame the blow lands / the element leaves the hands: spawn
projectiles, call `cast.hit` or start the VFX there. Times below are at speed 1
(divide by `speed`). Pose conventions are documented at the top of
`Animator.ts`; helpers for authoring new clips (`legAt`, `stance`, `mirrorPose`)
are exported from `combatClips.ts`.

Masks: **upper** clips leave the legs to locomotion, so they can be played while
walking; when an upper clip sinks the hips (`hipsY`) or lunges (`hipsZ`) the
Animator re-plants the feet with IK, so they never slide or sink into the
ground. **full** clips key the legs (grounded legs are IK-solved at authoring
time) and set `animator.busy` while their weight is above 0.5.

## Combat motion library (`combatClips.ts`)

| id | duration (s) | release (s) | mask | description |
|---|---|---|---|---|
| `strike_r` | 0.50 | 0.16 | upper | Straight right punch / palm strike with hip twist; left fist chambers at the hip. |
| `strike_l` | 0.50 | 0.16 | upper | Mirror of `strike_r`. |
| `whip_r` | 0.55 | 0.26 | upper | Right arm wound back high, lashed forward and down with a wrist snap (water whip, fire whip, air slice). |
| `whip_l` | 0.55 | 0.26 | upper | Mirror of `whip_r`. |
| `push_two` | 0.60 | 0.24 | upper | Two-handed palm push from a chest chamber with a short lunge (air blast, water wave, earth shove). |
| `release_forward` | 0.45 | 0.12 | upper | Explosive two-hand thrust from the `charge_hold` chamber (charged blast, air cannon, water jet). |
| `charge_hold` | 0.60 (loop) | `charged` @ 0.30 | upper | Looping charge stance: sunk hips, fists at the hips, tense tremble. Stop it (or play `release_forward`) to release. |
| `circle_arms` | 1.00 | 0.70 | upper | Flowing circle: arms cross low, rise wide, close forward palms-out (water gather / redirect, air swirl). |
| `lift_up` | 0.90 | 0.60 | upper | Crouch palms-up, rise lifting both hands to shoulder height (raise a boulder, lift water from a pool). |
| `raise_two` | 0.60 | 0.32 | upper | Both arms thrust from low to overhead, palms up (raise a wall or pillar, updraft). |
| `breath` | 1.00 | 0.45 | upper | Fire breath: inhale leaning back, exhale forward with hands framing the mouth. |
| `block_cross` | 0.50 | 0.10 | upper | Forearms crossed in front of the face, braced. Use `hold: true` while blocking. |
| `kick_front` | 0.65 | 0.26 | full | Right front snap kick: chamber, extend, re-chamber, set down. |
| `kick_spin` | 0.80 | 0.45 | full | Spinning roundhouse: full turn on the left foot, right leg sweeps out at hip height. |
| `sweep_low` | 0.90 | 0.42 | full | Low spinning sweep on the bent left leg, right leg extended along the ground, full turn, rise. |
| `stomp` | 0.70 | 0.38 | full | Earth stomp: right knee high, drive down into a sunk wide stance, fists punch down. |
| `slam_down` | 0.75 | 0.42 | full | Fists overhead then slammed to the ground in a deep crouch (earthquake, ground slam). |
| `spin_360` | 0.70 | 0.35 | full | Full-body turn with arms extended and a small hop (air spin, tornado, fire ring). |
| `leap_strike` | 1.00 | 0.70 | full | Crouch, leap (in place: the caller moves the body), tuck, land in a deep crouch driving the right fist down. |

## Movement, reactions and social clips

| id | duration (s) | event | mask | description |
|---|---|---|---|---|
| `dodge_air` | 0.45 | — | full | Airbender evasion: tucked hop with a full spin, arms flung wide. |
| `dodge_water` | 0.45 | — | full | Waterbender evasion: low flowing slide, one leg extended, arms sweeping a wave. |
| `dodge_earth` | 0.42 | — | full | Earthbender evasion: heavy sidestep into a deep horse stance, forearms braced. |
| `dodge_fire` | 0.38 | — | full | Firebender evasion: explosive dash, torso pitched forward, arms driven back like jets. |
| `jump_start` | 0.25 | — | arms | Arms swing up at take-off (jump/fall/land poses are procedural). |
| `knockdown` | 0.60 | — | full | Thrown onto the back; play with `hold: true`, eyes close while down. |
| `getup` | 0.70 | — | full | Roll forward onto the feet from `knockdown`. |
| `avatar_activate` | 0.90 | `release` @ 0.55 | full | Avatar State entry: gather low, then burst upright with arms wide. |
| `interact` | 0.60 | `release` @ 0.25 | armR | Reach out with the right hand. |
| `bow` | 1.20 | — | upper | Respectful bow with hands together. |
| `npc_gesture` | 1.60 | — | arms | Conversational hand gesture. |
| `air_form` `water_form` `earth_form` `fire_form` | 1.40 | — | full | Generic practice forms for students and masters. |

Element-specific technique clips live next to their techniques
(`src/combat/techniques/<element>/clips.ts`, `src/combat/water/clips.ts`).

## Procedural layers (no clip needed)

Set `animator.loco` every frame; the Animator blends these automatically:

- **Locomotion**: `speed`, `sprinting`, `turnRate`, `strafe`, `moveDir` — IK feet with stride synced to
  speed (no sliding), per-style gait: `air` light and bouncy (arms swept back when sprinting),
  `earth` wide and heavy, `fire` forward and aggressive, `water` flowing arms; also `neutral`, `npc`,
  `elder`, `guard`, `child`. Turning leans into the curve.
- **Air states**: `grounded`/`vy` (jump, fall, landing via `notifyLanding(speed)`), `gliding`,
  `swimming`, `mounted`.
- **Idle variants**: `idleVariant` = `stand | meditate | sit | kneel | work | guard | float`.
- **Hit reactions**: `hitReact(strength, dir)` — additive directional flinch.
- **Footsteps**: `onFootstep = (foot) => ...` fires at each foot plant.
