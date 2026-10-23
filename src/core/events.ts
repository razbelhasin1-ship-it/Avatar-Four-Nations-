import type {
  Element,
  ElementOrAvatar,
  EntityKind,
  GameMode,
  NotifyKind,
  SessionKind,
  SurfaceType,
  TechniqueFailReason,
  Vec3Like,
  WaterSourceType,
} from './types';

/**
 * Catalogue of every game event. Systems communicate through these instead of
 * importing each other. Quests, UI, audio and achievements subscribe here.
 *
 * Adding an event: add a key + payload type here. Never remove or rename keys
 * other systems may depend on without updating all subscribers.
 */
export interface GameEvents {
  // ---- lifecycle ----
  'game:mode': { from: GameMode; to: GameMode };
  'game:paused': { paused: boolean };
  'session:started': { kind: SessionKind; isNew: boolean };
  'session:ending': { kind: SessionKind };
  'session:ended': { kind: SessionKind };
  'settings:changed': { keys: string[] };
  'save:written': { slot: string; auto: boolean };
  'save:loaded': { slot: string };
  'save:failed': { slot: string; reason: string };

  // ---- player ----
  'player:spawned': { entityId: number };
  'player:damaged': { amount: number; sourceId?: number; element?: ElementOrAvatar };
  'player:healed': { amount: number };
  'player:defeated': {};
  'player:respawned': { position: Vec3Like };
  'player:jumped': { position: Vec3Like; double: boolean };
  'player:landed': { speed: number; surface: SurfaceType; position: Vec3Like };
  'player:footstep': { surface: SurfaceType; position: Vec3Like; foot: 'L' | 'R'; speed: number; yaw: number; heavy: boolean };
  'player:dodged': { position: Vec3Like; element: Element };
  'player:glide': { active: boolean };
  'element:switched': { element: Element };

  // ---- combat ----
  'technique:cast': { id: string; casterId: number; element: ElementOrAvatar; isPlayer: boolean; position: Vec3Like };
  'technique:failed': { id: string; reason: TechniqueFailReason; message?: string };
  hit: {
    attackerId: number;
    targetId: number;
    targetKind: EntityKind;
    damage: number;
    element: ElementOrAvatar;
    techniqueId: string;
    position: Vec3Like;
    killed: boolean;
    blocked: boolean;
    playerIsAttacker: boolean;
  };
  'entity:killed': { entityId: number; kind: EntityKind; tags: string[]; killerId?: number; position: Vec3Like };
  'combo:advanced': { element: Element; index: number };
  'player:blocked': { attackerId: number; perfect: boolean };

  // ---- water sources ----
  'water:drawn': { sourceId: string; sourceType: WaterSourceType; amount: number; position: Vec3Like };
  'water:unavailable': { techniqueId: string; needed: number; available: number };
  'water:reserve': { amount: number; max: number };

  // ---- world ----
  'region:entered': { regionId: string; name: string };
  'location:discovered': { locationId: string; name: string };
  'weather:changed': { regionId: string; weather: string };
  'world:interact': { kind: string; id: string; position: Vec3Like };

  // ---- progression ----
  'technique:learned': { id: string; element: ElementOrAvatar; source: 'start' | 'master' | 'mastery' | 'sphere' | 'quest' | 'debug' };
  'element:unlocked': { element: Element };
  'mastery:progress': { element: Element; progress: number };
  'mastery:achieved': { element: Element };
  'elementsSphere:unlocked': {};
  'xp:gained': { amount: number; total: number };
  'level:up': { level: number };

  // ---- avatar state ----
  'avatarState:changed': { active: boolean; sphere: boolean };
  'ultimate:cast': { id: string };

  // ---- npcs, dialogue, training ----
  'npc:interact': { npcId: string };
  'dialogue:started': { npcId: string; dialogueId: string };
  'dialogue:ended': { npcId: string; dialogueId: string };
  'dialogue:flag': { flag: string };
  'master:discovered': { masterId: string };
  'training:started': { masterId: string; lessonId: string; techniqueId: string };
  'training:completed': { masterId: string; lessonId: string; techniqueId: string; success: boolean };

  // ---- quests ----
  'quest:started': { questId: string };
  'quest:updated': { questId: string; stepId: string };
  'quest:completed': { questId: string };
  'quest:tracked': { questId: string | null };

  // ---- companions ----
  'creature:discovered': { speciesId: string; creatureId: string };
  'creature:trust': { creatureId: string; speciesId: string; trust: number };
  'companion:bonded': { companionId: string; speciesId: string; name: string };
  'companion:summoned': { companionId: string };
  'companion:dismissed': { companionId: string };
  'mount:changed': { companionId: string | null; flying: boolean };

  // ---- inventory & cosmetics ----
  'item:acquired': { itemId: string; count: number };
  'item:used': { itemId: string };
  'cosmetic:unlocked': { cosmeticId: string };
  'appearance:changed': {};
  'currency:changed': { amount: number; delta: number };

  // ---- ui / presentation ----
  'ui:notify': { text: string; kind?: NotifyKind; icon?: string; duration?: number };
  'ui:screen': { screen: string | null };
  'camera:shake': { intensity: number; duration: number; position?: Vec3Like };
  'camera:impulse': { fovKick?: number; pullback?: number; duration: number };

  // ---- bending environment (air / fire / earth module, additive) ----
  /** Fire heats an area: ice constructs in range should melt, standing water steams. */
  'bending:heat': { position: Vec3Like; radius: number; intensity: number; casterId: number };
  /** Seismic Sense pulse: entity ids revealed (enemies, creatures, things tagged 'hidden'). */
  'seismic:pulse': { position: Vec3Like; radius: number; casterId: number; revealed: number[] };
}

export type GameEventName = keyof GameEvents;
