# Avatar: The Four Nations

An open-world 3D action RPG for the browser, inspired by *Avatar: The Last Airbender*.
You play the Avatar. Begin in one of the Four Nations, learn all four elements from masters
across the world, tame and ride animal companions, enter the Avatar State at will, and, once
all four elements are mastered, awaken the **Elements Sphere**.

Built with TypeScript, Vite and three.js. Every model, texture, sound and piece of music is
generated procedurally at runtime: there are no asset downloads and no external services.
It runs on desktop browsers and on phones and tablets (touch controls, mobile-safe graphics).

## Run

```bash
npm install
npm run dev        # open the printed URL (add --host to try it on a phone on your network)
npm run build      # typecheck + production build in dist/
npm run preview    # serve the production build
```

Requires a WebGL2 browser (current Chrome, Edge, Firefox, Safari). On phones, landscape is the
intended orientation; the main menu and Settings have a fullscreen toggle where the browser
supports it.

## What is in the game

- **Begin as any nation.** Choose Water (Northern Water Tribe), Earth (Ba Sing Se), Fire (Fire
  Nation Capital) or Air (Southern Air Temple). The start changes your arrival, opening quest,
  first master and starting moves, but never limits what you can learn: every start can master
  all four elements.
- **Character creator** with a live, rotatable 3D preview: face shapes and sliders, eyes, brows,
  16 hairstyles, facial hair, scars, body, nation outfits and clothing layers, footwear, gloves,
  belts, headwear, necklaces, colours, and Air Nomad tattoos. Your look persists everywhere,
  including riding and the Avatar State.
- **Four bending styles that play differently.** Air is fast and evasive (double jump, glide,
  air scooter, shields that deflect and redirect projectiles, a lifting vortex). Earth is heavy
  and defensive (pillars, walls you can punch forward, timed stone guard counters, rock armour,
  earth surfing). Fire is aggressive and combo-driven (4-hit chains, flamethrower stream, jet
  dash, explosive finisher, chaining lightning). Water is fluid and **depends on real water**:
  rivers, lakes, the sea, ponds, fountains, ice, snow (once learned), rain and plant moisture.
  Away from water the game tells you there is none nearby instead of conjuring it. 43
  techniques in all, listed in `docs/TECHNIQUES.md`.
- **16 masters** across the world, some hidden behind clues. Each lesson is a demonstration
  followed by a real training challenge (target practice, precision, timed defence, ring
  courses, sparring, ledge and flame trials and more). Passing teaches a technique you can use
  immediately and that is saved. Grandmasters hold a three-stage Mastery Trial per element.
- **Avatar State** from the start, toggled at will (glowing eyes and tattoos, an energy wave,
  power boosts, a spirit meter). After mastering all four elements the same input summons the
  **Elements Sphere** with five ultimate techniques: Hurricane, Tsunami, Earthquake, Fire
  Tornado and the combined Avatar Cataclysm.
- **A living world**: the four capitals plus the Southern Water Tribe, Meditation Isle, Omashu,
  Kyoshi Island, Gaoling, Riverbend, Misty Palms Oasis, the Buried Library, the Foggy Swamp's
  Great Banyan Tree, the Sun Warrior Ruins, Ember Island, the Fire Nation harbour and causeway,
  the tundra and more. Roads with bridges, signposts, inns and farms connect them. There is
  weather, a day/night cycle, vegetation and grass that react to you, and city crowds on daily
  routines. Fast travel from the map to discovered places.
- **Quests**: the main line *The Avatar Cycle*, element and mastery quests, discovery quests
  for hidden masters and 14 side quests, tracked in the journal and on the compass and map.
- **Enemies**: Fire Nation soldiers and elites, bandits, Dai Li agents, rogue waterbenders,
  pirates, archers and wild beasts, with readable attack tells, camps, patrols and three bosses.
- **Animal companions**: sky bison, dragon (rare and gated), polar bear dog, badgermole, ostrich
  horse, winged lemur and turtle-duck, plus ambient wildlife. Find them by their tracks and
  habitats, earn their trust with the right food, patience and rescues (never by fighting
  them), bond and name them, then ride on the ground or fly. Bonds unlock perks.
- **Shops, inventory and wardrobe**, procedural music and ambience per region, an interactive
  tutorial, and versioned save slots with autosave.

## Controls

Every keyboard, mouse and gamepad binding can be changed in **Settings → Controls**.

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move / camera | WASD (or arrows) / mouse | Left stick / right stick |
| Basic attack / aim and charge heavy | Left mouse / hold right mouse | RT / LT |
| Techniques 1–4 (5: Avatar Cataclysm in the Elements Sphere) | 1–4 (5) | D-pad ← ↑ →, X |
| Switch element | Tab / mouse wheel | RB / LB |
| Jump (hold while falling to glide as an Airbender) | Space | A |
| Sprint / dodge | Shift / Q | Left stick click / B |
| Interact / companion (summon, mount) | E / F | Y / D-pad ↓ |
| Draw water from a nearby source | R | |
| Avatar State / Elements Sphere | T | Right stick click |
| Lock-on | Middle mouse / Z | |
| Map / journal / inventory / techniques / companions / character | M / J / I / K / P / C | Back (map) |
| Pause | Esc | Start |

**Riding**: F mounts and dismounts. On a flying mount, Jump climbs, Dodge descends and lands,
Sprint boosts, and Interact uses the mount's special (tail gust or dragonfire).

**Touch**: a floating stick on the left half of the screen moves you, dragging on the right half
turns the camera, and on-screen buttons cover attack, heavy, techniques, jump, dodge, sprint,
interact (labelled with what you can interact with), companion, draw water (highlighted near a
source), Avatar State, element switching, lock-on and a menu button for the map, journal and
other screens. Button size, opacity, sensitivity and a left-handed layout are in Settings.

## Settings and performance

Graphics presets Low / Medium / High / Ultra with individual options (render scale, shadows,
post-processing, bloom, effects, particles, grass and foliage density, draw distance), audio
volumes, sensitivity, camera shake and UI scale. Everything applies live and is saved. Phones and
tablets start on a mobile-safe setup (Low preset, reduced render scale and draw distance).

## Tests

```bash
npm run typecheck                    # 0 errors
npm test                             # unit tests (vitest)
node tests/e2e/smoke.e2e.mjs         # headless browser smoke test
```

`tests/e2e/` holds one browser suite per area (tutorial, playthrough, front end, mobile, UI,
creator, water, combat-air/fire/earth, avatar, enemies, companions, masters, quests, shop,
audio, each region and the environment). They drive the real game in headless Chromium with
software WebGL through the `window.__game` automation API (`src/core/Debug.ts`). Run them one at
a time; each takes a few minutes. `node tests/perf/perf.mjs [preset]` reports frame time, draw
calls and triangles at key locations.

## Project layout

See `CLAUDE.md` for the architecture and contributor conventions, `docs/TECHNIQUES.md` for the
technique and master catalogue, `src/character/CLIPS.md` for the animation library and
`src/audio/SOUNDS.md` for the sound library.

*A non-commercial fan project. Avatar: The Last Airbender belongs to its respective owners.*
