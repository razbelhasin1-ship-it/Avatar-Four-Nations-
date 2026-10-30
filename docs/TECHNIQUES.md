# Canonical technique catalogue

Single source of truth for technique **ids**. Combat modules implement them; masters, quests,
the HUD, ultimates and tests reference them by id. Do not rename ids. New techniques may be
added (append to the table and tell the lead in your report).

Column legend — **kind**: basic (LMB combo) · heavy (hold RMB, charge) · ability (slots 1–4) ·
defense · movement · passive (never cast; knowing it enables behaviour) · ultimate · combined.
**Source**: `starter` = granted when the element is unlocked (set `starter: true`);
`master` = taught by a master lesson; `sphere` = granted with the Elements Sphere.

## Feel and pacing (CombatSystem)

- **Cooldowns** in the technique definitions are tuned for the player; other benders' cooldowns run
  1.8× longer (`NPC_COOLDOWN_SCALE`), so enemies keep their pace.
- **Bending tempo:** the player's windups, recoveries and bending animations run at `PLAYER_TEMPO`
  (1.2×); the player moves freely after the first quarter of a recovery, and a dodge cancels it.
- **Chi:** in-combat regeneration 13/s (26/s out of combat); every landed basic strike refunds 2.5 chi.
- **Impact:** every hit throws an element-specific burst (wind ring, splash crown, debris and dust,
  flame and embers) sized by the blow; the striker and the struck hold their pose for a beat
  (`Humanoid.hitFreeze`) and the camera kicks.
- **Avatar Flow:** switching element mid-combo carries the basic combo on in the new element
  (e.g. Air Palm → Flame Punch continues at step 2). Each extra element woven into one unbroken
  chain adds +12% damage to its basic strikes (up to +36% with all four); the HUD shows the woven
  elements under the combo counter (`combo:weave` event).

## Air — agile, evasive, displacement, low damage / high knockback

| id | name | kind | tier | source | notes |
|---|---|---|---|---|---|
| `air_palm` | Air Palm | basic | 1 | starter | 3-step combo: palm gust → second palm → spinning gust finisher. Fast, wide, strong knockback, low damage |
| `air_blast` | Air Blast | heavy | 1 | starter | Charged cone blast; launches light enemies |
| `air_sweep` | Air Sweep | ability | 1 | starter | Low sweeping kick sends a horizontal crescent of wind; trips (knockdown) |
| `air_dash` | Air Dash | movement | 1 | starter | Long, fast wind-propelled dash (also usable in the air) |
| `air_jump` | Air Jump | passive | 2 | master | Grants a second mid-air jump (Player checks `knows('air_jump')`) |
| `air_spin_strike` | Spinning Air Strike | ability | 2 | master | Spin in place: 360° vortex hit, pushes everything out |
| `air_shield` | Air Shield | defense | 2 | master | Spinning sphere of air: deflects projectiles, pushes melee attackers away (channel) |
| `air_scooter` | Air Scooter | movement | 2 | master | Ride a ball of air: very fast ground movement, crosses water briefly (channel, steerable) |
| `air_redirect` | Wind Redirection | defense | 3 | master | Timed deflection: incoming projectiles in a cone are sent back at their owners |
| `air_vortex` | Vortex | ability | 3 | master | Small tornado travels forward, pulls and lifts enemies, then flings them |

## Water — flowing, redirecting, resource-aware (needs real water), ice control

All water attacks declare `water: { amount }` and obtain it through `ctx.water.acquire` (reserve →
nearest real source). Ice techniques may use ice; snow only with `water_snow_draw` known.

| id | name | kind | tier | source | notes |
|---|---|---|---|---|---|
| `water_whip` | Water Whip | basic | 1 | starter | 3-step flowing whip combo (curved ribbon, medium range), soaks |
| `water_blast` | Water Blast | heavy | 1 | starter | Charged water bullet/wave; big knockback |
| `water_shield` | Water Shield | defense | 1 | starter | Swirling water barrier; blocks projectiles, extinguishes fire |
| `ice_shards` | Ice Shards | ability | 2 | master | Fan of ice projectiles (can use ice sources) |
| `ice_wall` | Ice Wall | defense | 2 | master | Raises a solid, walkable ice wall (collider + becomes an ice source); melts after a while |
| `water_sweep` | Water Sweep | ability | 2 | master | Ground-level wave sweeping a wide arc, knocks down |
| `freezing_strike` | Freezing Strike | ability | 2 | master | Water lash that freezes the target in place (freeze status) |
| `water_jet` | Water Jet | ability | 3 | master | High-pressure channeled stream, pushes and damages over time |
| `water_spout` | Water Spout | movement | 3 | master | Toggle: ride a spinning column of water above a big source with no time limit (3 s cooldown once it falls); glide across the water (it leans over a shore, never leaves the water), aerial water attacks start from it; press again to sink, jump to leap off |
| `water_heal` | Healing Waters | ability | 2 | master | Glowing water heals the bender over a few seconds (needs water) |
| `water_snow_draw` | Snow Gathering | passive | 2 | master | Allows drawing usable water from snow fields |
| `water_moisture` | Moisture Extraction | ability | 3 | master | Pulls a limited amount of water from plants/humid air into the reserve; context-sensitive (swamp, forest, rain good; desert/volcanic poor) |
| `ice_spikes` | Ice Spikes | ability | 4 | master | A line of ice spikes erupts from the ground (advanced ice manipulation) |

## Earth — grounded, heavy, defensive, precise; stones come from the ground

| id | name | kind | tier | source | notes |
|---|---|---|---|---|---|
| `earth_strike` | Rock Strike | basic | 1 | starter | Stomp a rock out of the ground and punch it forward; 2-step + heavy third |
| `earth_slam` | Seismic Slam | heavy | 1 | starter | Charged stomp shockwave around the bender, launches |
| `earth_pillar` | Earth Pillar | ability | 1 | starter | Pillar erupts under the target (launch) or under yourself on a short tap; walkable collider |
| `stone_wall` | Stone Wall | defense | 2 | master | Raise a wall (collider, blocks projectiles); can be punched forward |
| `ground_spikes` | Ground Spikes | ability | 2 | master | Line of stone spikes travels forward |
| `boulder_roll` | Boulder Roll | ability | 2 | master | Huge boulder rolls forward crushing enemies |
| `stone_guard` | Stone Guard | defense | 2 | master | Brace with rock forearms: heavy damage reduction, perfect-timing counter |
| `rock_armor` | Rock Armor | defense | 3 | master | Encase in stone plates: armor status, stagger immunity, slower |
| `earth_surf` | Earth Surf | movement | 2 | master | Ride the crest of a travelling wave of earth (toggle): builds speed, carves, feels slopes, breaks against walls, bowls enemies over; jump off with its momentum |
| `earth_launch` | Earth Launch | movement | 3 | master | Pillar catapults you high into the air |
| `seismic_sense` | Seismic Sense | passive | 3 | master | Stomp/landings briefly reveal nearby enemies and hidden things (outline/markers) |

## Fire — aggressive, fast combos, explosive, controlled

| id | name | kind | tier | source | notes |
|---|---|---|---|---|---|
| `fire_jab` | Flame Punch | basic | 1 | starter | 4-step alternating punches throwing fire bolts; last step kicks a bigger bolt |
| `fire_blast` | Charged Fireball | heavy | 1 | starter | Charged fireball, explodes, burns |
| `flame_sweep` | Flame Sweep | ability | 1 | starter | Low arc of flame in front (sweep kick), hits several |
| `fire_dash` | Fire Dash | movement | 2 | master | Jet-propelled dash leaving a burning trail |
| `spinning_flame_kick` | Spinning Flame Kick | ability | 2 | master | Airborne spinning kick ring of fire |
| `fire_stream` | Fire Stream | ability | 2 | master | Channeled flamethrower stream |
| `breath_of_fire` | Breath of Fire | ability | 2 | master | Cone of fire breathed out; also melts ice |
| `explosive_finisher` | Explosive Finisher | ability | 3 | master | Leaping two-fisted strike detonating a large explosion |
| `fire_lightning` | Lightning Generation | ability | 4 | master | Charged lightning bolt; near-instant, high damage, chains |
| `fire_shield` | Fire Shield | defense | 2 | master | Held wheel of fire: burns projectiles away, blocks 75%, scorches attackers; perfect block bursts into a counter blast |

## Avatar — Elements Sphere only (granted by `Progression.checkSphere`)

| id | name | kind | tier | source | notes |
|---|---|---|---|---|---|
| `ult_hurricane` | Hurricane | ultimate | 4 | sphere | Rotating hurricane, pulls/lifts nearby enemies, disturbs world |
| `ult_tsunami` | Tsunami | ultimate | 4 | sphere | Advancing wall of water; uses nearby water, may conjure (`canConjure`) |
| `ult_earthquake` | Earthquake | ultimate | 4 | sphere | Ground shockwave with cracks and raised earth; knockdowns |
| `ult_fire_tornado` | Fire Tornado | ultimate | 4 | sphere | Directed rotating column of flame, danger zone |
| `ult_cataclysm` | Avatar Cataclysm | combined | 4 | sphere | All four elements converge then release a battlefield-scale blast |

Slot mapping while the Elements Sphere is active (Player.ts): 1 Hurricane, 2 Tsunami,
3 Earthquake, 4 Fire Tornado, 5 Cataclysm. Ultimates also cost Avatar spirit (15 each, 30 for
the Cataclysm; `src/combat/techniques/avatar/common.ts`), checked before any cost is paid.

## Masters (lesson → technique) — implemented by the masters/training module

| Element | Master (suggested) | Location | Teaches |
|---|---|---|---|
| Air | Monk Tenzo | Southern Air Temple courtyard | `air_jump`, `air_spin_strike` |
| Air | Sister Iio (acrobat) | Air Temple terraces | `air_scooter`, `air_shield` |
| Air | Hermit of the Four Winds | Shrine of the Four Winds (hidden) | `air_redirect`, `air_vortex` |
| Air | **Abbot Pasang (grandmaster)** | Air Temple summit | Trial of the Four Winds |
| Water | **Master Siku (grandmaster)** | NWT Waterbending Courtyard | `ice_wall`, `freezing_strike`, Trial of the Ocean and Moon |
| Water | Healer Yugoda | NWT healing hut | `water_heal`, `water_snow_draw` |
| Water | Hunter Akka | Southern Water Tribe | `ice_shards`, `water_sweep` |
| Water | Swamp Sage Huu | Foggy Swamp, Great Banyan Tree | `water_moisture`, `water_jet`, `water_spout`, `ice_spikes` |
| Earth | Master Lien | Stone Fist Dojo, Ba Sing Se | `stone_wall`, `stone_guard` |
| Earth | **King Bumo (grandmaster)** | Omashu | `boulder_roll`, `earth_launch`, Trial of the Unmoving Mountain |
| Earth | Lin the Blind | Gaoling | `seismic_sense`, `rock_armor` |
| Earth | Oyagi of Kyoshi | Kyoshi Village | `ground_spikes`, `earth_surf` |
| Fire | Master Jeong | Agni Kai Arena, Fire Nation Capital | `fire_dash`, `spinning_flame_kick` |
| Fire | Sage Hira | Royal Plaza | `breath_of_fire`, `fire_shield` |
| Fire | General Iro (retired) | Ember Island tea house | `fire_stream`, `fire_lightning` |
| Fire | **Sun Chief Ahkon (grandmaster)** | Sun Warrior Ruins | `explosive_finisher`, Trial of the Eternal Flame |

The first master of an element you cannot yet bend offers an element-unlock lesson
(`progression.unlockElement`). Mastery needs proficiency + 3 completed lessons + the trial.
