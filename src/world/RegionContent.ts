import type * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { P2 } from './WorldLayout';

/**
 * A chunk of hand-authored (procedurally assembled) world content: a city,
 * temple, village, bridge, ruin... Region modules live in src/world/regions/
 * and are listed in src/world/regions/index.ts.
 *
 * Lifecycle (managed by World):
 *  - build() is called once, the first time the focus comes within loadRadius
 *    (or during the loading screen if the spawn point is inside).
 *    Create meshes under `group`, register colliders (ctx.world.collision),
 *    water sources (ctx.water.register...), interactables, NPC/creature spawn
 *    requests via the relevant systems.
 *  - update() runs every frame while built.
 *  - setDetail() lets the region swap to a cheap far representation.
 *  - dispose() frees everything (called when the session ends).
 *
 * Content must never move or destroy quest-critical geometry permanently.
 */
export interface RegionContent {
  readonly id: string;
  readonly center: P2;
  /** Distance from center at which build() is triggered. */
  readonly loadRadius: number;
  /** Root object for all meshes of this content (added to the scene by World). */
  readonly group: THREE.Group;
  build(ctx: GameContext): void;
  update?(dt: number, ctx: GameContext): void;
  setDetail?(level: 'full' | 'far' | 'hidden'): void;
  /** Called when a session starts/ends, after build, to (re)spawn session entities (NPCs, creatures). */
  onSessionStart?(ctx: GameContext): void;
  onSessionEnd?(ctx: GameContext): void;
  dispose(ctx: GameContext): void;
}

export type RegionFactory = () => RegionContent;
