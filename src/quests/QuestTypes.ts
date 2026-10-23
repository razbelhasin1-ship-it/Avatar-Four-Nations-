import type { GameEvents } from '../core/events';
import type { Element } from '../core/types';

/**
 * Quest data model. Quests are pure data (src/data/quests*.ts) interpreted by
 * QuestSystem. Objectives complete from game events, so gameplay systems never
 * need to know about quests.
 */

export type ObjectiveDef =
  /** Get within radius of a landmark or point. */
  | { type: 'reach'; text: string; landmark?: string; x?: number; z?: number; radius?: number }
  /** Talk to an NPC (npc:interact). */
  | { type: 'talk'; text: string; npc: string }
  /** Any game event, optionally filtered by payload fields (exact match), counted. */
  | { type: 'event'; text: string; event: keyof GameEvents; where?: Record<string, string | number | boolean>; count?: number }
  /** Defeat entities with a tag (entity:killed). */
  | { type: 'defeat'; text: string; tag: string; count: number }
  /** Know a technique. */
  | { type: 'learn'; text: string; technique: string }
  /** Be able to bend an element. */
  | { type: 'element'; text: string; element: Element }
  /** Master an element. */
  | { type: 'master'; text: string; element: Element }
  /** Bond with a companion (optionally of a species). */
  | { type: 'bond'; text: string; species?: string }
  /** Discover a location. */
  | { type: 'discover'; text: string; location: string }
  /** Hold N of an item. */
  | { type: 'collect'; text: string; item: string; count: number }
  /** Complete a training lesson (optionally specific). */
  | { type: 'training'; text: string; master?: string; lesson?: string }
  /** A story flag set by dialogue or scripts. */
  | { type: 'flag'; text: string; flag: string }
  /** Use a technique N times (technique:cast by player). */
  | { type: 'cast'; text: string; technique?: string; element?: Element | 'avatar'; count: number }
  /** Activate the Avatar State (or Elements Sphere). */
  | { type: 'avatarState'; text: string; sphere?: boolean };

export type QuestAction =
  | { type: 'startQuest'; quest: string }
  | { type: 'setFlag'; flag: string }
  | { type: 'notify'; text: string }
  | { type: 'giveItem'; item: string; count?: number }
  | { type: 'giveCosmetic'; cosmetic: string }
  | { type: 'learn'; technique: string }
  | { type: 'unlockElement'; element: Element }
  | { type: 'currency'; amount: number }
  | { type: 'revealLocation'; location: string };

export interface QuestStepDef {
  id: string;
  /** Journal text describing the step. */
  text: string;
  objectives: ObjectiveDef[];
  /** Complete when any objective is done (default: all). */
  any?: boolean;
  onStart?: QuestAction[];
  onComplete?: QuestAction[];
}

export type QuestCategory = 'main' | 'side' | 'training' | 'companion' | 'mastery' | 'tutorial' | 'exploration';

export interface QuestDef {
  id: string;
  title: string;
  category: QuestCategory;
  summary: string;
  region?: string;
  giver?: string;
  steps: QuestStepDef[];
  rewards?: {
    xp?: number;
    currency?: number;
    items?: Array<{ id: string; count: number }>;
    cosmetics?: string[];
    techniques?: string[];
  };
  /** Automatically start when conditions hold (checked periodically). */
  autoStart?: { startingElement?: Element; afterQuest?: string; flag?: string; element?: Element; always?: boolean };
  /** Hidden from the journal until started. */
  hidden?: boolean;
}

export interface QuestProgress {
  id: string;
  step: number;
  /** Per-objective counters for the current step. */
  counts: number[];
  done: boolean[];
  startedAt: number;
}
