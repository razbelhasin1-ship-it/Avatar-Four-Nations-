import type { GameContext, GameSystem } from './core/GameContext';
import { TutorialSystem } from './tutorial/TutorialSystem';

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
];
