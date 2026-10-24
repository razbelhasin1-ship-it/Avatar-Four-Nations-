import type { Appearance } from '../character/Appearance';
import type { Element } from '../core/types';
import type { QuestAction } from '../quests/QuestTypes';
import type { Nation, P2 } from '../world/WorldLayout';

export type NPCRole =
  | 'villager'
  | 'guard'
  | 'merchant'
  | 'master'
  | 'quest'
  | 'child'
  | 'monk'
  | 'healer'
  | 'noble'
  | 'soldier'
  | 'student'
  | 'elder';

export type NPCBehavior =
  | { type: 'idle'; variant?: 'stand' | 'sit' | 'meditate' | 'kneel' | 'work' | 'guard' }
  | { type: 'wander'; radius: number }
  | { type: 'patrol'; path: P2[]; loop?: boolean }
  | { type: 'train' } // practices forms in place
  | { type: 'converse'; with?: string }; // idle chatting gestures

export interface NPCDef {
  id: string;
  name: string;
  title?: string;
  role: NPCRole;
  nation: Nation;
  /** Full appearance or a seed for procedural generation. */
  appearance?: Appearance;
  appearanceSeed?: number;
  /** Bending element for masters/students (affects stance & demonstrations). */
  element?: Element;
  x: number;
  z: number;
  /** Explicit height (e.g. on a building floor). Default: ground height. */
  y?: number;
  yaw?: number;
  behavior: NPCBehavior;
  /** Dialogue id (src/data/dialogues*.ts). */
  dialogue?: string;
  /** Shown above the head: '!' quest available, '?' turn-in, 'master' icon... computed if omitted. */
  marker?: 'quest' | 'master' | 'merchant' | 'none';
  /** Region id for streaming groups. */
  region?: string;
  /** Only spawn when this condition holds (story progression). */
  requiresFlag?: string;
  hidden?: boolean;
  // [additive: training/NPC life] Spawn only while this condition holds (story/relocation),
  // and a cheap day/night routine ('day' NPCs go indoors at night, 'night' ones only appear then).
  condition?: DialogueCondition;
  schedule?: 'day' | 'night' | 'always';
  /** [additive: quests] Quest this NPC offers: shows '!' until it is started. */
  offers?: string;
}

export type DialogueCondition = {
  flag?: string;
  notFlag?: string;
  questActive?: string;
  questComplete?: string;
  questNotStarted?: string;
  canBend?: Element;
  cannotBend?: Element;
  knows?: string;
  notKnows?: string;
  mastered?: Element;
  trialAvailable?: Element;
  startingElement?: Element;
  sphere?: boolean;
  minCurrency?: number;
  hasItem?: string;
};

export type DialogueAction =
  | QuestAction
  | { type: 'train'; master: string; lesson: string }
  | { type: 'trial'; element: Element }
  | { type: 'shop'; shop: string }
  | { type: 'heal' }
  | { type: 'custom'; id: string; arg?: string };

export interface DialogueChoice {
  text: string;
  next?: string;
  end?: boolean;
  condition?: DialogueCondition;
  actions?: DialogueAction[];
}

export interface DialogueNode {
  /** Defaults to the NPC's name. */
  speaker?: string;
  text: string;
  choices?: DialogueChoice[];
  /** Auto-continue to this node (shows a "Continue" button). */
  next?: string;
  actions?: DialogueAction[];
  end?: boolean;
}

export interface DialogueDef {
  id: string;
  /** First matching entry wins; last entry should have no condition. */
  start: Array<{ node: string; condition?: DialogueCondition }>;
  nodes: Record<string, DialogueNode>;
}
