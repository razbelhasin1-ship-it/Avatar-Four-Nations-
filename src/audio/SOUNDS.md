# Sound library (`src/audio`)

Everything is synthesised at runtime with WebAudio (noise + oscillators + filters + envelopes,
Karplus-Strong plucks, FM bells, waveshaping, formant voices, comb-filter reverb). The one audio
file is the main menu theme, `music/tracks/menu-theme.mp3` (provided by the project owner): an
extended epic version of the Avatar: The Last Airbender theme, streamed by `music/TrackPlayer.ts`
(see `audio_music` below).
This file lists every id the shared library registers and what it is for. It is generated from
the live registry (keep it in sync when adding ids: `listSounds()` / `listLoops()` in `registry.ts`).

## Using sounds

```ts
ctx.audio.play('stone.impact', { position: p, volume: 0.8 });   // one-shot (positional when position is given)
const h = ctx.audio.loop('loop.fire.crackle', { position: p });  // loop handle
h.setParam('intensity', 0.6); h.setPosition(p); h.stop(0.5);
registerSound('my_module_thing', (ac, out, t, o) => { /* build graph into out at t */ return 0.4; }, { duration: 0.6, desc: '...' });
```

- Library ids are dot-namespaced (`group.name[.variant]`); module-specific ids (registered by other
  modules) use underscores so they never collide. Underscored legacy ids such as `whoosh`, `hit`,
  `jump`, `ui_click`, `water_splash`, `fire_burst`, `rock_impact` are **aliases** of library recipes.
- `PlayOpts`: `position`, `volume` (0..4), `pitch` (0.05..8, ±4 % random variation is added), `bus`
  (`sfx` | `ui` | `ambient` | `music`), `range` (m), `delay` (s).
- Meta (`SoundMeta`): `duration` (declared ring-out, verified offline), `bus`, `maxVoices` per id,
  `cooldown` (anti-spam per id and spot), `priority` (voice stealing), `reverb` send, `range`, `desc`.
- Engine: 28/40 voice cap (low/other presets) with priority stealing and 40 ms click-free fades, per-id
  caps and cooldowns, distance culling + air absorption, damped-comb environment reverb (independent loops, stable in every browser; set by the ambience
  director), glue compressor + limiter, NaN-safe params, unlock on first gesture (safe no-ops while
  locked), suspend while the tab is hidden, `suppress()` so event bindings can replace legacy plays,
  `setMuffled()` for the pause menu, `duck()`, live master/music/sfx/ambient/mute settings.
- `src/audio/trims.ts`: static gain staging for recipes that peaked above 0 dBFS at volume 1
  (measured by `verifyAll`); applied to every play of the id by the engine and by the verifier.

## Modules (registered in `src/modules.ts`)

| Module | File | What it does |
|---|---|---|
| `audio_ambience` | `AmbienceDirector.ts` | Samples region, biome weights, altitude, distance to sea / rivers / waterfalls / lake shores, settlements, markets, harbours, temples, caves, time of day and the weather system 4×/s; crossfades up to 25 looping beds (budget 7 on Low, 10 otherwise), scatters positional spot sounds, sets the environment reverb. Also plays behind the main menu. |
| `audio_music` | `MusicSystem.ts` + `music/` | Generative themes (`water`, `earth`, `fire`, `air`, `desert`, `swamp`, `spirit`, `wild`, `menu`, `battle`) with phrases, motifs, cadences and dynamics; region crossfades; combat layer driven by hits/damage and engaged enemies (bosses = full), decaying ~7 s after combat; stingers (`discovery`, `questStart`, `quest`, `learn`, `mastery`, `levelup`, `sphere`, `defeat`) in the current key; dialogue ducking; Avatar State choir bed. The `menu` theme is the recorded menu track (`TRACKS` in `music/MusicDirector.ts`, -6 dB): fetched once into a blob, streamed by an `<audio>` element into the music bus, looped, fading in on the menu and out (then rewound) when play starts; paused while hidden; the generative `menu` theme is its fallback if the file cannot play. Debug: `music.track('menu')`. |
| `audio_events` | `AudioEvents.ts` | Event → sound bindings (below) and delegated DOM UI sounds; installs `window.__game.debug.audio`. |

### Event bindings

| Event | Sound(s) |
|---|---|
| `player:footstep` | `step.<surface>.<walk|run>` (replaces legacy `footstep*`) |
| `player:landed` | `step.<surface>.land` under the generic landing; `body.fall` on hard falls |
| `player:dodged` | `dodge.<element>` (replaces the generic whoosh) |
| `player:glide` | `loop.glide` while gliding, `speed` param from velocity |
| `element:switched` | `ui.element.<element>` |
| `hit` | `hit.<element>` / `hit.block` / `hit.kill`, plus `hit.player` when the player is hit (replaces the generic `hit` / block sounds) |
| `player:blocked` (perfect) | `hit.parry` |
| `entity:killed` | `body.fall` / `body.fall.heavy` / `body.fall.water` (delayed) |
| `technique:failed` | `fail.nowater` (dry fizz) / `fail.chi` / `fail.cooldown` / `fail.generic` |
| `water:drawn` | `water.draw` / `water.draw.ice` / `water.draw.snow` / `water.draw.mist` / `water.flask` by source type |
| `location:discovered`, `quest:started`, `quest:completed`, `technique:learned`, `mastery:achieved`, `elementsSphere:unlocked`, `level:up` | music stinger when music is audible, else `ui.discovery`, `ui.quest.start`, `ui.quest.complete`, `ui.technique.learned`, `ui.mastery`, `ui.sphere.unlocked`, `ui.levelup` (never both) |
| `quest:updated`, `item:acquired`, `save:written`, `save:failed` | `ui.quest.update`, `ui.pickup`, `ui.save`, `ui.error` |
| notifications (`ui:notify` and direct `ui.notify`) | `ui.notify.<kind>` (replaces legacy `notify`) |
| `dialogue:started` / each line / `dialogue:ended` | `ui.dialogue.open`, `voice.<type>[.ask|.short]` at the NPC (type from role/nation), `ui.dialogue.close` |
| `ui:screen`, `game:paused` | `ui.open` / `ui.close`; pause muffles the world |
| DOM (capture phase) | `ui.hover`, `ui.click` / `ui.confirm` (primary) / `ui.back` (back/cancel/close) / `ui.tab`, `ui.slider` (pitch follows value), `ui.toggle` |
| Avatar State | voiced by the avatar system with `avatar.surge`, `loop.avatar.hum`, `avatar.release`, `avatar.sphere.activate`, `loop.avatar.sphere`; music adds a choir bed |

### Debug / verification (`window.__game.debug.audio`)

`state()`, `unlock()`, `list()`, `has(id)`, `hasLoop(id)`, `meta(id)`, `play(id, opts)`, `loop(id, opts)` / `stopLoop(i)`,
`log(n)` / `clearLog()`, `render(id)` / `renderLoop(id)` (OfflineAudioContext: peak, RMS, NaN, clipping, click,
ring-out, DC), `verifyAll()`, `ambience.{state, override, snap, targetsAt}`, `music.{state, force, stinger, pulse, setCombat}`,
`events()`. Tests: `tests/unit/audio.test.ts`, `tests/e2e/audio.e2e.mjs`.

## One-shots

### Footsteps & movement

| Id | Purpose |
|---|---|
| `step.<surface>.walk` / `.run` / `.land` | footsteps per surface: `ash`, `cobble`, `dirt`, `grass`, `gravel`, `ice`, `lava`, `metal`, `mud`, `packedsnow`, `plaster`, `rock`, `sand`, `snow`, `stone`, `tallgrass`, `water`, `wood` (heel + toe roll on walks, crunch/grit/rustle grain trains, hollow wood, glassy ice, mud suction, water splash). Ring-out 0.52 / 0.50 / 0.70 s. `stepId(surface, speed, landing)` picks the id. |
| `footstep` | walk footstep on dirt (alias of `step.dirt.walk`) (0.52 s) |
| `footstep_snow` | walk footstep on snow (alias of `step.snow.walk`) (0.52 s) |
| `footstep_stone` | walk footstep on stone (alias of `step.stone.walk`) (0.52 s) |
| `footstep_water` | walk footstep on water (alias of `step.water.walk`) (0.52 s) |
| `jump` | jump take-off: cloth swish + air (alias of `move.jump`) (0.45 s) |
| `land` | generic heavy landing (weight + cloth) (alias of `move.land`) (0.45 s) |
| `move.cloth` | cloth rustle (turns, gestures, mounting) (0.50 s) |
| `move.jump` | jump take-off: cloth swish + air (0.45 s) |
| `move.land` | generic heavy landing (weight + cloth) (0.45 s) |
| `move.slide.dirt` | short slide on dirt (0.95 s) |
| `move.slide.ice` | short slide on ice (0.95 s) |
| `move.slide.snow` | short slide on snow (0.95 s) |
| `move.swim` | swim stroke slosh (0.60 s) |

### Water

| Id | Purpose | s |
|---|---|---|
| `water.bubble` | bubbles rising (underwater, swamp gas, hot spring) | 0.75 |
| `water.draw` | water pulled out of a liquid source (gurgle + rising swirl) | 0.95 |
| `water.draw.ice` | water drawn from ice (crackles + creak) | 0.80 |
| `water.draw.mist` | moisture/rain condensed into water (airy shimmer) | 0.95 |
| `water.draw.snow` | water drawn from snow (crunchy swirl) | 0.80 |
| `water.drip` | single drip (caves, swamp, icicles) | 0.50 |
| `water.droplets` | scattered droplets | 0.80 |
| `water.flask` | water skin uncorked and poured | 0.75 |
| `water.splash` | medium splash | 0.90 |
| `water.splash.big` | big splash / wave crash / body into water | 1.30 |
| `water.splash.small` | small splash (droplet impact, stepping in a puddle) | 0.60 |
| `water.whoosh` | water swished through the air (whips, streams) | 0.80 |
| `water_splash` | medium splash (alias of `water.splash`) | 0.90 |
| `water_whoosh` | water swished through the air (whips, streams) (alias of `water.whoosh`) | 0.80 |

### Ice

| Id | Purpose | s |
|---|---|---|
| `ice.crack` | sharp ice crack with whistling stress wave | 0.60 |
| `ice.creak` | deep groan of stressed ice / glaciers | 1.45 |
| `ice.form` | ice crystallising (rising crackle + glassy shimmer) | 1.25 |
| `ice.shatter` | ice construct shattering into shards | 1.20 |
| `ice_crack` | sharp ice crack with whistling stress wave (alias of `ice.crack`) | 0.60 |

### Stone / earth

| Id | Purpose | s |
|---|---|---|
| `rock_impact` | rock hits something hard (thud + crack + debris) (alias of `stone.impact`) | 0.95 |
| `rock_rise` | rock column / wall rising from the ground (alias of `stone.rise`) | 1.15 |
| `stone.crumble` | stone construct crumbling into rubble | 1.30 |
| `stone.debris` | pebbles and small debris scattering | 0.75 |
| `stone.grind` | stone grinding against stone | 1.30 |
| `stone.impact` | rock hits something hard (thud + crack + debris) | 0.95 |
| `stone.rise` | rock column / wall rising from the ground | 1.15 |
| `stone.slam` | huge earth slam (boulder, stomp, collapsing wall) | 1.40 |

### Air

| Id | Purpose | s |
|---|---|---|
| `air.gust` | gust of wind with a faint whistle | 1.80 |
| `air.vortex` | swirling vortex burst (tornado, air spout) | 1.80 |
| `air.whoosh` | generic air whoosh (swings, passes, element switch) | 0.70 |
| `whoosh` | generic air whoosh (swings, passes, element switch) (alias of `air.whoosh`) | 0.70 |

### Fire & lightning

| Id | Purpose | s |
|---|---|---|
| `fire.burst` | fire blast (fist of flame) | 0.90 |
| `fire.explosion` | fire explosion (boom, crack, rumble, debris) | 2.00 |
| `fire.ignite` | "fwoomp" — flames catching (braziers, torches, kindling) | 0.70 |
| `fire.roar` | roaring flames (fire stream, dragon breath, blaze) | 1.70 |
| `fire.whoosh` | fire swept through the air (fire whip, flame arc) | 0.85 |
| `fire_burst` | fire blast (fist of flame) (alias of `fire.burst`) | 0.90 |
| `lightning.crack` | lightning bolt crack (zap + buzz + thunder) | 1.80 |
| `lightning.zap` | small electric arc / sparks | 0.40 |

### Combat: hits, blocks, dodges, failures, falls

| Id | Purpose | s |
|---|---|---|
| `body.fall` | body hits the ground (defeated human) | 0.60 |
| `body.fall.heavy` | heavy body / large creature collapses | 0.80 |
| `body.fall.water` | body falls into water | 0.80 |
| `dodge.air` | airbender dodge: quick rising swoosh with flutter | 0.55 |
| `dodge.earth` | earthbender dodge: grounded scrape ending in a planted thud | 0.65 |
| `dodge.fire` | firebender dodge: flame-propelled burst | 0.60 |
| `dodge.water` | waterbender dodge: flowing swish with droplets | 0.65 |
| `fail.chi` | not enough chi (weak breathy puff) | 0.50 |
| `fail.cooldown` | technique still recovering (soft double tick) | 0.25 |
| `fail.generic` | action not possible (muted double knock) | 0.35 |
| `fail.nowater` | waterbending fails: no water nearby (dry fizz) | 0.60 |
| `hit` | generic body impact (punch, kick, blunt hit) (alias of `hit.physical`) | 0.40 |
| `hit.air` | airbending blast connects (airy thump) | 0.45 |
| `hit.avatar` | Avatar-State strike connects (impact + shimmer) | 0.75 |
| `hit.block` | attack blocked / deflected (muted clack + glance) | 0.45 |
| `hit.earth` | earth strike connects (rock crunch + thud) | 0.55 |
| `hit.fire` | fire strike connects (burst + sizzle) | 0.55 |
| `hit.kill` | finishing blow (deep boom + tail) | 0.90 |
| `hit.parry` | perfect block / parry (bright ring) | 1.00 |
| `hit.physical` | generic body impact (punch, kick, blunt hit) | 0.40 |
| `hit.player` | the player takes damage (punchy, low) | 0.50 |
| `hit.water` | water strike connects (wet slap) | 0.50 |

### UI

| Id | Purpose | s |
|---|---|---|
| `notify` | generic notification (two soft bells) (alias of `ui.notify`) | 2.75 |
| `ui.back` | back / cancel (falling A→D pluck) | 0.75 |
| `ui.click` | button press (wood block click) | 0.43 |
| `ui.close` | menu / screen closes | 0.80 |
| `ui.coins` | coins / currency gained (metal clinks) | 0.80 |
| `ui.confirm` | confirm / accept (rising D→A pluck) | 1.80 |
| `ui.dialogue.close` | conversation ends | 0.70 |
| `ui.dialogue.next` | dialogue advances (soft tick) | 0.47 |
| `ui.dialogue.open` | conversation starts | 0.80 |
| `ui.discovery` | location discovered chime | 3.05 |
| `ui.element.air` | switched to Air | 0.75 |
| `ui.element.earth` | switched to Earth | 0.80 |
| `ui.element.fire` | switched to Fire | 0.80 |
| `ui.element.water` | switched to Water | 2.20 |
| `ui.error` | error / not allowed (low double knock) | 0.65 |
| `ui.hover` | pointer enters a button (tiny bamboo tick) | 0.40 |
| `ui.interact` | interaction prompt used (soft pluck) | 0.65 |
| `ui.levelup` | level up (bright rising chimes) | 3.20 |
| `ui.mastery` | element mastered fanfare (taiko roll, gong, bells) | 5.15 |
| `ui.notify` | generic notification (two soft bells) | 2.75 |
| `ui.notify.avatar` | Avatar-related toast (gong + bell) | 4.50 |
| `ui.notify.discovery` | location discovered chime | 3.05 |
| `ui.notify.error` | error / not allowed (low double knock) | 0.65 |
| `ui.notify.info` | info toast (single soft bell) | 2.75 |
| `ui.notify.learn` | learning toast (short flourish) | 2.70 |
| `ui.notify.quest` | quest toast (bell + pluck) | 2.30 |
| `ui.notify.success` | success toast (rising pluck triad) | 2.40 |
| `ui.notify.warning` | warning toast (low double pluck + tense bell) | 2.10 |
| `ui.open` | menu / screen opens (scroll unrolls) | 1.30 |
| `ui.page` | page turn (journal, map, scrolls) | 0.65 |
| `ui.pickup` | item picked up | 1.60 |
| `ui.quest.complete` | quest complete fanfare | 3.40 |
| `ui.quest.start` | new quest accepted | 2.90 |
| `ui.quest.update` | quest objective updated | 0.95 |
| `ui.save` | game saved (brush stroke + seal knock) | 2.30 |
| `ui.slider` | slider step (pitch follows value) | 0.39 |
| `ui.sphere.unlocked` | Elements Sphere unlocked (choir, cascading bells, gong) | 4.70 |
| `ui.tab` | tab switch (paper flick + tick) | 0.47 |
| `ui.technique.learned` | technique learned fanfare (rising run + bell chord) | 3.75 |
| `ui.toggle` | checkbox / toggle (tick-tock) | 0.47 |
| `ui_back` | back / cancel (falling A→D pluck) (alias of `ui.back`) | 0.75 |
| `ui_click` | button press (wood block click) (alias of `ui.click`) | 0.43 |
| `ui_confirm` | confirm / accept (rising D→A pluck) (alias of `ui.confirm`) | 1.80 |

### NPC voices (formant babble)

| Id | Purpose | s |
|---|---|---|
| `voice.child` | talk babble, child voice (a phrase) | 1.40 |
| `voice.child.ask` | questioning babble (rising), child voice | 1.30 |
| `voice.child.short` | short babble, child voice (greeting / acknowledgement) | 0.75 |
| `voice.crowd.cheer` | small crowd cheer (arena, festival) | 1.60 |
| `voice.effort` | exertion grunt ("hup!") — pitch 1 male, ~1.7 female | 0.40 |
| `voice.elder_f` | talk babble, elder_f voice (a phrase) | 1.40 |
| `voice.elder_f.ask` | questioning babble (rising), elder_f voice | 1.30 |
| `voice.elder_f.short` | short babble, elder_f voice (greeting / acknowledgement) | 0.75 |
| `voice.elder_m` | talk babble, elder_m voice (a phrase) | 1.40 |
| `voice.elder_m.ask` | questioning babble (rising), elder_m voice | 1.30 |
| `voice.elder_m.short` | short babble, elder_m voice (greeting / acknowledgement) | 0.75 |
| `voice.female` | talk babble, female voice (a phrase) | 1.40 |
| `voice.female.ask` | questioning babble (rising), female voice | 1.30 |
| `voice.female.short` | short babble, female voice (greeting / acknowledgement) | 0.75 |
| `voice.gruff` | talk babble, gruff voice (a phrase) | 1.40 |
| `voice.gruff.ask` | questioning babble (rising), gruff voice | 1.30 |
| `voice.gruff.short` | short babble, gruff voice (greeting / acknowledgement) | 0.75 |
| `voice.hurt` | pain grunt ("agh") — pitch 1 male, ~1.7 female | 0.55 |
| `voice.male` | talk babble, male voice (a phrase) | 1.40 |
| `voice.male.ask` | questioning babble (rising), male voice | 1.30 |
| `voice.male.short` | short babble, male voice (greeting / acknowledgement) | 0.75 |
| `voice.monk` | talk babble, monk voice (a phrase) | 1.40 |
| `voice.monk.ask` | questioning babble (rising), monk voice | 1.30 |
| `voice.monk.short` | short babble, monk voice (greeting / acknowledgement) | 0.75 |
| `voice.noble` | talk babble, noble voice (a phrase) | 1.40 |
| `voice.noble.ask` | questioning babble (rising), noble voice | 1.30 |
| `voice.noble.short` | short babble, noble voice (greeting / acknowledgement) | 0.75 |
| `voice.spirit` | talk babble, spirit voice (a phrase) | 1.40 |
| `voice.spirit.ask` | questioning babble (rising), spirit voice | 1.30 |
| `voice.spirit.short` | short babble, spirit voice (greeting / acknowledgement) | 0.75 |

### Creatures & companions

| Id | Purpose | s |
|---|---|---|
| `creature.armadillolizard.hiss` | armadillo-lizard hiss with rattling scales | 1.00 |
| `creature.badgermole.snort` | badgermole snorts and sniff | 1.00 |
| `creature.catowl.hoot` | cat-owl hoots with a purring trill | 1.50 |
| `creature.dragon.roar` | dragon roar (growling, fiery) | 2.30 |
| `creature.dragon.rumble` | dragon low purr / rumble (content, idle) | 2.20 |
| `creature.elephantkoi.splash` | elephant koi breaching splash | 1.30 |
| `creature.hogmonkey.squeal` | hog-monkey squeal (snort + rising squeal) | 0.80 |
| `creature.lemur.chirp` | flying lemur chirps (curious, playful) | 0.65 |
| `creature.ostrichhorse.squawk` | ostrich horse squawk | 0.75 |
| `creature.otterpenguin.honk` | otter-penguin honk (bright, nasal, one or two) | 0.70 |
| `creature.polarbeardog.bark` | polar bear dog bark (one or two woofs) | 0.75 |
| `creature.polarbeardog.growl` | polar bear dog warning growl | 1.60 |
| `creature.skybison.groan` | sky bison deep, friendly groan | 2.60 |
| `creature.skybison.huff` | sky bison breath huff (mounting, idle) | 0.90 |
| `creature.turtleduck.quack` | turtle-duck quack (small, nasal) | 0.60 |
| `creature.wings.flap` | single wing flap (lemur, birds, small creatures) | 0.50 |
| `creature.wings.flap_large` | large wing beat (dragon, eel-hound… any big flyer) | 0.70 |

### Avatar State, Elements Sphere, ultimates

| Id | Purpose | s |
|---|---|---|
| `avatar.release` | Avatar State ends (power settles) | 1.70 |
| `avatar.sphere.activate` | Elements Sphere activation (all four elements converge) | 3.60 |
| `avatar.sphere.release` | Elements Sphere dissipates | 1.80 |
| `avatar.surge` | Avatar State transformation surge | 3.00 |
| `avatar_surge` | Avatar State transformation surge (alias of `avatar.surge`) | 3.00 |
| `ult.cataclysm` | ultimate: cataclysm (all four elements at once) | 4.80 |
| `ult.earthquake` | ultimate: earthquake (sub rumble, cracking ground, debris) | 3.80 |
| `ult.firetornado` | ultimate: fire tornado (roaring, rotating flames) | 3.80 |
| `ult.hurricane` | ultimate: hurricane (howling vortex roar) | 3.60 |
| `ult.tsunami` | ultimate: tsunami (rising roar, crash, foaming wash) | 4.00 |

### Ambience one-shots (spot sounds)

| Id | Purpose | s |
|---|---|---|
| `amb.bell` | temple bell (deep, long) | 5.00 |
| `amb.bird.chirp` | small bird chirp | 0.80 |
| `amb.bird.song` | songbird phrase | 1.50 |
| `amb.bird.warble` | warbling trill | 1.00 |
| `amb.chime` | wind chime cluster | 3.10 |
| `amb.cricket` | a single nearby cricket | 1.20 |
| `amb.drip` | single drip (caves, swamp, icicles) | 0.50 |
| `amb.frog` | frog croak (swamps, ponds at night) | 1.00 |
| `amb.gull` | seagull cries (coasts, harbors) | 1.10 |
| `amb.hawk` | hawk / eagle cry over mountains | 1.20 |
| `amb.lava.pop` | lava bubble pop with spitting embers | 0.65 |
| `amb.owl` | owl hoots (night forests) | 1.20 |
| `amb.thunder` | distant rolling thunder (storms) | 3.80 |
| `amb.vendor` | market vendor calling out | 1.60 |
| `amb.wood.creak` | creaking wood (ships, docks, bridges, old houses) | 1.00 |
| `thunder.distant` | distant rolling thunder (storms) | 3.80 |

## Loops

`setParam(name, v)` names are listed per loop (0..1 unless noted); every loop also takes `setVolume`, `setPitch`, `setPosition`.

| Id | Params | Purpose |
|---|---|---|
| `amb.ashfall` | intensity, density | ashfall: soft sifting hiss, low rumble, faint embers |
| `amb.blizzard` | intensity | blizzard howl (snow-laden roaring wind) |
| `amb.cave` | intensity, density | cave: low room tone and echoing drips |
| `amb.city` | intensity, density | town murmur: distant crowd babble, footsteps, doors, carts |
| `amb.desert` | intensity, density | dry desert wind with hissing, skittering sand |
| `amb.forest` | intensity, density | forest by day: rustling leaves, distant birdsong, the odd woodpecker |
| `amb.harbor` | intensity, density | harbor: lapping water against hulls, creaking moorings |
| `amb.insects` | intensity, density | daytime insects: cicada chorus, passing bees (farmland, tropics, swamp) |
| `amb.market` | intensity, density | busy market: vendor calls, clinking coins and pottery, carts |
| `amb.night` | intensity, density | night: cricket chorus over still air |
| `amb.polar` | intensity, density | polar cold: thin bright wind, ice groans, ice-crystal ticks |
| `amb.rain` | intensity, density | rain: steady wash, patter and close droplets |
| `amb.sandstorm` | intensity, density | sandstorm (roaring wind, blasting grit) |
| `amb.snowfall` | intensity | gentle snowfall (hushed hiss, muffled air) |
| `amb.spirit` | intensity, density | spirit places: shimmering beating tones, breath, rare chimes |
| `amb.surf` | intensity | ocean surf: waves building, crashing and washing back (two overlapping wave trains) |
| `amb.swamp` | intensity, density | swamp: frog chorus, bubbling mud, drips, humid hum |
| `amb.temple` | intensity, density | temple: breeze and pentatonic wind chimes |
| `amb.volcanic` | intensity, density | volcanic: deep rumble, hissing vents, bubbling lava, distant booms |
| `amb.wind` | intensity | general wind with gusts and a faint whistle |
| `amb.wind.high` | intensity | high-altitude wind: strong gusts and howling whistles (mountain summits) |
| `fire_crackle` | intensity | legacy: fire crackle (sustained flames) |
| `loop.air.vortex` | intensity | sustained vortex hum (air spout, tornado, sphere) |
| `loop.avatar.hum` | intensity | sustained Avatar State hum (drone + shimmer + breath) |
| `loop.avatar.sphere` | intensity | Elements Sphere sustained loop (four elements orbiting + chord drone) |
| `loop.fire.crackle` | intensity | crackling fire (campfire, brazier, burning debris) |
| `loop.fire.roar` | intensity | sustained roaring flame (flamethrower, fire tornado core) |
| `loop.glide` | speed | airbender glider wind rush |
| `loop.slide.dirt` | speed | continuous slide on dirt |
| `loop.slide.ice` | speed | continuous slide on ice |
| `loop.slide.snow` | speed | continuous slide on snow |
| `loop.water.lake` | intensity, density | gentle lake-shore lapping |
| `loop.water.river` | intensity, density | broad river flow |
| `loop.water.stream` | intensity, density | babbling brook with bubbling droplets |
| `loop.water.waterfall` | intensity | waterfall roar |
| `loop.wings` | rate, size | continuous wing beats while flying |
| `water_flow` | intensity, density | legacy: flowing water (river) |

## Ids for other modules

- **Companions** (species `sounds` in `src/data/creatures.ts`): `creature.skybison.groan|huff`, `creature.dragon.roar|rumble`,
  `creature.polarbeardog.bark|growl`, `creature.badgermole.snort`, `creature.ostrichhorse.squawk`, `creature.lemur.chirp`,
  `creature.turtleduck.quack`, `creature.otterpenguin.honk`, `creature.hogmonkey.squeal`, `creature.elephantkoi.splash`,
  `creature.catowl.hoot`, `creature.armadillolizard.hiss`, `creature.wings.flap|flap_large`, loop `loop.wings` (`rate`, `size`).
- **Avatar**: `avatar.surge`, `avatar.release`, `loop.avatar.hum`, `avatar.sphere.activate`, `loop.avatar.sphere`, `avatar.sphere.release`,
  ultimates `ult.hurricane`, `ult.tsunami`, `ult.earthquake`, `ult.firetornado`, `ult.cataclysm`, impact accent `hit.avatar`.
- **Bending** (generic recipes you can switch to): `air.whoosh|gust|vortex`, `loop.air.vortex`, `fire.whoosh|burst|roar|ignite|explosion`,
  `loop.fire.crackle|roar`, `lightning.zap|crack`, `stone.rise|grind|impact|slam|crumble|debris`, `ice.form|crack|creak|shatter`,
  `water.whoosh|splash.small|splash|splash.big|droplets|bubble`, `loop.water.stream|river|waterfall|lake`.

## Module-specific ids registered elsewhere

Owned by their modules (not part of the library); verified offline with the rest. Trimmed in `trims.ts`: `bend_air_blast`, `bend_earth_rise`, `bend_earth_slam`, `bend_explosion`, `bend_fire_puff`, `bend_fire_whoosh`, `bend_flame_loop`, `bend_rumble_loop`, `water_impact`, `water_jet`, `water_spout`.

| Id | Kind | File |
|---|---|---|
| `bend_air_blast` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_air_dash` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_air_deflect` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_air_puff` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_air_swirl` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_earth_crumble` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_earth_rise` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_earth_sink` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_earth_slam` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_explosion` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_fire_puff` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_fire_whoosh` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_flame_loop` | loop | `src/combat/techniques/bending/sounds.ts` |
| `bend_lightning_charge` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_lightning_strike` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_perfect_block` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_rock_throw` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_rumble_loop` | loop | `src/combat/techniques/bending/sounds.ts` |
| `bend_seismic_pulse` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_steam` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_stone_block` | sound | `src/combat/techniques/bending/sounds.ts` |
| `bend_wind_loop` | loop | `src/combat/techniques/bending/sounds.ts` |
| `ice_form` | sound | `src/combat/water/sounds.ts` |
| `ice_shatter` | sound | `src/combat/water/sounds.ts` |
| `steam_hiss` | sound | `src/combat/water/sounds.ts` |
| `water_draw` | loop | `src/combat/water/sounds.ts` |
| `water_fizzle` | sound | `src/combat/water/sounds.ts` |
| `water_gather` | sound | `src/combat/water/sounds.ts` |
| `water_heal` | sound | `src/combat/water/sounds.ts` |
| `water_impact` | sound | `src/combat/water/sounds.ts` |
| `water_jet` | loop | `src/combat/water/sounds.ts` |
| `water_launch` | sound | `src/combat/water/sounds.ts` |
| `water_moisture` | sound | `src/combat/water/sounds.ts` |
| `water_shield` | sound | `src/combat/water/sounds.ts` |
| `water_spout` | sound | `src/combat/water/sounds.ts` |
| `water_swirl` | loop | `src/combat/water/sounds.ts` |
| `water_whip` | sound | `src/combat/water/sounds.ts` |
