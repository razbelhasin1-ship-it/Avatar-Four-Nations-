import type { GameContext, GameSystem } from './core/GameContext';
import { WaterbendingSystem } from './combat/water/WaterbendingSystem';
import { bending } from './combat/techniques/bending/runtime';
import { HintSystem } from './tutorial/HintSystem';
import { TutorialSystem } from './tutorial/TutorialSystem';
import { CharacterSystem } from './character/CharacterSystem';

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
  // Character LOD/shadow distances from graphics settings + __game.debug.character lab.
  { name: 'character', order: 880, create: () => new CharacterSystem() },
];
