import type { GameContext, GameSystem } from './core/GameContext';
import { WaterbendingSystem } from './combat/water/WaterbendingSystem';
import { bending } from './combat/techniques/bending/runtime';
import { HintSystem } from './tutorial/HintSystem';
import { TutorialSystem } from './tutorial/TutorialSystem';
import { CharacterSystem } from './character/CharacterSystem';
import { EnvironmentSystem } from './world/env/EnvironmentSystem';
import { EncounterDirector } from './ai/EncounterDirector';
import { TrainingSystem } from './training/TrainingSystem';
import { ShopSystem } from './shop/ShopSystem';
import { QuestWorld } from './training/QuestWorld';
import { AmbienceDirector } from './audio/AmbienceDirector';
import { WaterContainers } from './world/WaterContainers';
import { MusicSystem } from './audio/MusicSystem';
import { AudioEvents } from './audio/AudioEvents';

/**
 * Feature modules plug into the game here without editing Game.ts.
 * Each module creates one GameSystem (with optional init/onSessionStart/
 * onSessionEnd/update hooks). Lower `order` updates earlier (default 100).
 * Core systems run at: interactions 10, avatar 20, entities 30, combat 40,
 * water 45, npcs 50, companions 55, quests 60, [modules], vfx 900, world 950, camera 1000.
 *
 * The created system is available to others via ctx.extra.get(name).
 */
export interface GameModule {
  name: string;
  order?: number;
  create(ctx: GameContext): GameSystem;
}

export const MODULES: GameModule[] = [
  { name: 'tutorial', order: 85, create: () => new TutorialSystem() },
  { name: 'hints', order: 86, create: () => new HintSystem() },
  // Draw Water, reserve/water skin, water FX runtime (whips, waves, ice constructs), puddles. Runs right after combat & water sources.
  { name: 'waterbending', order: 46, create: () => new WaterbendingSystem() },
  // Air/fire/earth bending runtime: forced-motion movers + channel input BEFORE the player updates (25),
  // effect loop / constructs / debris / charge & sense visuals after combat (850).
  { name: 'bending', order: 25, create: () => bending.pre },
  { name: 'bending_fx', order: 850, create: () => bending.fx },
  // Avatar State aura / Elements Sphere visuals follow the player after it moved (state logic runs in the core avatar system, 20).
  { name: 'avatar_fx', order: 860, create: (ctx) => ctx.avatar.late },
  // Character LOD/shadow distances from graphics settings + __game.debug.character lab.
  { name: 'character', order: 880, create: () => new CharacterSystem() },
  // World environment: vegetation, grass, ground decals (world.fx), weather, cloud sea, ambient life (__game.debug.env).
  { name: 'environment', order: 940, create: () => new EnvironmentSystem() },
  // Enemies, combat AI and encounters: camps/patrols/ambushes/bosses, attack tokens, loot, enemy HUD, sparring API (__game.debug.enemies).
  { name: 'encounters', order: 70, create: () => new EncounterDirector() },
  // Masters (NPCs at master_<name> spots), lessons = demonstration + interactive challenges at training_<name>,
  // element awakenings, Mastery Trials, Elements Sphere vision, master ✦ markers, journal page (__game.debug.training).
  { name: 'training', order: 75, create: () => new TrainingSystem() },
  // Merchants at merchant_<id> spots + buy/sell shop screen (dialogue action 'shop'; __game.debug.shop).
  { name: 'shop', order: 76, create: () => new ShopSystem() },
  // Spot-placed quest givers & city life NPCs, quest props (pickups, clue tablets, bells, braziers) + their markers (__game.debug.quests).
  { name: 'quest_world', order: 77, create: () => new QuestWorld() },
  // Audio (src/audio, SOUNDS.md): layered ambience by place/time/weather, region music + combat layer + stingers,
  // event→sound bindings and UI sounds. They tick on the audio engine (menu included) (__game.debug.audio).
  // Water jars and rain barrels beside town stalls and quest givers: small, finite waterbending sources.
  { name: 'water_containers', order: 47, create: () => new WaterContainers() },
  { name: 'audio_ambience', order: 970, create: () => new AmbienceDirector() },
  { name: 'audio_music', order: 971, create: () => new MusicSystem() },
  { name: 'audio_events', order: 972, create: () => new AudioEvents() },
];
