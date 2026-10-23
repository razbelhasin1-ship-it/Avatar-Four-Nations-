import type * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import type { AvatarStateSystem } from '../avatar/AvatarStateSystem';
import type { CombatSystem } from '../combat/CombatSystem';
import type { WaterSourceSystem } from '../combat/WaterSources';
import type { CompanionSystem } from '../companions/CompanionSystem';
import type { EntityManager } from '../entities/EntityManager';
import type { Inventory } from '../inventory/Inventory';
import type { NPCSystem } from '../npc/NPCSystem';
import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import type { Progression } from '../progression/Progression';
import type { QuestSystem } from '../quests/QuestSystem';
import type { RenderPipeline } from '../render/Renderer';
import type { UIManager } from '../ui/UIManager';
import type { InteractionSystem } from '../world/Interactables';
import type { World } from '../world/World';
import type { EventBus } from './EventBus';
import type { Game } from './Game';
import type { Input } from './Input';
import type { SaveManager } from './Save';
import type { SettingsManager } from './Settings';
import type { SessionKind } from './types';

/**
 * Lifecycle hooks every gameplay system may implement. Systems are created
 * once at boot and live for the whole app; sessions (campaign/tutorial) start
 * and end many times.
 */
export interface GameSystem {
  /** Called once after every system exists (wire events here). */
  init?(ctx: GameContext): void;
  /** A play session began (after save load/new game setup and player spawn). */
  onSessionStart?(ctx: GameContext, isNew: boolean): void;
  /** The session is ending (before entities are cleared). */
  onSessionEnd?(ctx: GameContext): void;
  /** Per-frame while playing and not paused. */
  update?(dt: number, ctx: GameContext): void;
}

export interface SessionInfo {
  active: boolean;
  kind: SessionKind | null;
  slot: string | null;
  /** True for the first session after "New Game" until the next save/load. */
  isNew: boolean;
}

export interface GameTime {
  /** Simulation seconds since boot (pauses with the game). */
  elapsed: number;
  dt: number;
  frame: number;
  /** Real seconds since boot. */
  real: number;
}

/** Service registry passed to every system. */
export interface GameContext {
  readonly game: Game;
  readonly events: EventBus;
  readonly input: Input;
  readonly settings: SettingsManager;
  readonly save: SaveManager;
  readonly render: RenderPipeline;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly entities: EntityManager;
  readonly interactions: InteractionSystem;
  readonly vfx: import('../vfx/VFX').VFXSystem;
  readonly audio: AudioEngine;
  readonly combat: CombatSystem;
  readonly water: WaterSourceSystem;
  readonly progression: Progression;
  readonly quests: QuestSystem;
  readonly npcs: NPCSystem;
  readonly companions: CompanionSystem;
  readonly avatar: AvatarStateSystem;
  readonly inventory: Inventory;
  readonly ui: UIManager;
  readonly cameraRig: CameraRig;
  readonly time: GameTime;
  readonly session: SessionInfo;
  /** The player entity (always exists; only in the world during sessions). */
  readonly player: Player | null;
  /** Systems registered by modules (training, enemies, weather...). Lookup by name. */
  readonly extra: Map<string, unknown>;
}
