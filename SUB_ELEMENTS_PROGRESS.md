# Sub-elements progress (temporary — delete at the end)

Lavabending (Earth), Spiritual Projection (Air) and Bloodbending (Water). Rollback branch: `before-sub-elements` (c420280).

## Phases
- [x] 1 read the systems (this file)
- [x] 2 shared framework (data/subskills.ts, subskills/Moon.ts, subskills/SubSkills.ts, codex, setting, flags)
- [x] 3 lavabending (subskills/lava/LavaSystem.ts, combat/techniques/sub/lava.ts, subskills/sounds.ts; probe ok: melt/spread/burn/cool/disc/pool/stream/moat/eruption)
- [x] 4 spiritual projection (subskills/projection/Projection.ts, combat/techniques/sub/projection.ts; probe ok: gates, sight, return streak, body hit)
- [ ] 5 bloodbending
- [ ] 6 unlock quests and NPCs
- [ ] 7 UI, audio and VFX polish
- [ ] 8 balance and tests, screenshots, report

## What exists (phase 1 findings)
- Techniques: `registerTechnique` (combat/CombatSystem.ts), `TechniqueDef` in combat/types.ts (kind, tier, chiCost, cooldown, precheck, channel/channelUpdate, requires 'avatarState').
  Files under combat/techniques/<x>.ts, imported from combat/techniques/index.ts. Master-tier moves cost ~26-40 chi, 4-8 s CD; player maxChi 100.
- Unlock: progression.learn(id, 'quest'); `knows()`; 4 slots/element (ability/movement/defense kinds are slottable). Master tier = `progression.mastery[e].mastered`.
  `setupSandbox()` and `debugMasterAll()` learn every technique -> must skip sub-skill moves (TechniqueDef.subSkill marker).
- Masters: data/masters.ts, TrainingSystem (awakenings, lessons, trials). Earth first master = master_lien (BSS), grand = master_bumo. Air = master_tenzo (SAT), grand master_pasang. Water = master_siku (NWT).
- Quests: data-driven (quests/QuestTypes.ts, data/quests.ts merges MAIN/SIDE). Objectives: reach/talk/event/flag/learn/cast/master...; actions: setFlag, learn, startQuest, notify, giveItem. Flags: ctx.quests.setFlag/hasFlag (persisted).
- Dialogue: npc/NPCTypes.ts (DialogueDef nodes/choices, conditions flag/notFlag/questActive/mastered/knows..., actions incl. custom -> ctx.npcs.onAction(type, fn)). ctx.npcs.addDef/addDialogue/spawn/despawn/talk/onTalk.
  Quest props (data/quests_props.ts): pickup/read/meditate/bell/brazier.
- Lore/codex: data/lore.ts LoreEntry (group, unlock by flag/element/mastered...), shown in Journal -> Lore.
- Skill tree UI: ui/screens/TechniquesScreen.ts (tabs per element, cards with stats, loadout slots).
- HUD: ui/hud/HUD.ts; modules add their own DOM into ctx.ui.layers.hud with injected CSS (pattern: training/hud.ts).
- Time: world.sky.timeOfDay (0..24, wraps; no day counter, no moon phases). Sun rises 6:00, sets 18:00. Moon disc in sky shader (uMoonDir). World saves `time`.
  No existing night bonus for waterbending. No reputation/morality system. No localization.
- Settings: graphics/audio/controls/gameplay. No "reduce intense effects" setting -> add gameplay.reduceIntenseEffects.
- Saves: Persistable (saveKey/serialize/deserialize/reset); modules with saveKey auto-registered.
- Enemies: ai/Enemy.ts (brain.update -> updateAttack -> updateMotor in update()); Entity has statuses (freeze/stun...), tryCast fails on stunned/freeze.
- Camera: player/CameraRig.ts follows ctx.player; setScripted(fn) for cutscenes.
- Ground: World.groundAt = max(terrain, colliders) -> no underground interiors; sealed interiors are built inside rock masses above terrain (like the Laogai base).
- Avatar State: ctx.avatar.active / sphereActive / activate() / deactivate().
- water_moisture (Moisture Extraction) exists: Hama teaches it (weak sources from air and plants).

## Design
New code lives in `src/subskills/` (systems, fx, quests), `src/combat/techniques/sub/` (TechniqueDefs) and `src/data/subskills*.ts` (data, numbers, dialogue, quests).
- `data/subskills.ts`: SUBSKILL_TUNING (every number), SUB_SKILLS table, KORRA_FLAGS (default off), reactions, codex/tooltips.
- `subskills/Moon.ts`: day counter from the clock, 8 phases, full-moon night every N nights, moon up 18:30-6:00, sky phase uniform, HUD moon chip, water power boost.
- `subskills/SubSkills.ts`: unlocks, vow, Moral Strain, witnesses, flags, debug API (`__game.debug.subskills`), HUD.
- Lava: pooled patches (max 3 player + world patches), shader surface, capped spread, cool -> stone (walkable), steam with water.
- Projection: separate controller + camera follow override; body stays (controlLock + meditate pose); focus meter; tether.
- Bloodbending: `Entity.held` hold state; Enemy think hook; release on sunrise/damage/zone/death/save-load.

## Existing files touched (keep this list current)
- src/combat/types.ts (TechniqueDef.subSkill)
- src/progression/Progression.ts (sandbox / masterAll skip sub-skill moves)
- src/core/Debug.ts (learnAll skips sub-skill moves)
- src/combat/CombatSystem.ts (held caster cannot cast; powerMods hook)
- src/entities/Entity.ts (Entity.held)
- src/core/features.ts (3 Korra flags, default off)
- src/core/events.ts (appended sub-element events)
- src/core/Settings.ts + src/ui/screens/SettingsScreen.ts (gameplay.reduceIntenseEffects)
- src/world/Sky.ts (moon phase on the disc; default full = unchanged look)
- src/data/lore.ts (Specialized Bending codex group)
- src/modules.ts (moon, subskills, lava modules)
- src/combat/techniques/index.ts (import ./sub/lava ...)
- src/ai/Enemy.ts (held bodies skip AI; Enemy.thinkHooks)
- src/core/Debug.ts (cast() also sets player.aimPoint3)
- src/world/Interactables.ts (focus override: Reach out from the spirit)
- src/player/CameraRig.ts (follow override)
- src/player/Player.ts (poseOverride for the meditating body)
- src/combat/CombatSystem.ts (+castGates)

## Notes / gaps
- User asked mid-task for 2 new moves per element (not sub-skills): Earth Grip (Lin), Stone Gloves (Lien), Fire Whip (Jeong), Dancing Dragon (Ahkon), Air Swipe (Tenzo), Air Suction (Pasang), Octopus Form (Siku), Ice Prison (Akka) — after phase 5.
- e2e: hold the slot key (setVirtual) to meditate; move with setVirtual('forward').
- avatar.fandom.com is not reachable from this session (DNS blocked): codex text from the brief + episodes.
- Debug: __game.debug.subskills { unlock, lock, state, setMoonPhase, setHour, fullMoonNight, setStrain, vow, breakVow, korra }.
