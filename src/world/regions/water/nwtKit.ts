import type * as THREE from 'three';
import type { WaterSourceDef } from '../../../combat/WaterSources';
import type { GameContext } from '../../../core/GameContext';
import type { Random } from '../../../core/Random';
import type { NPCDef } from '../../../npc/NPCTypes';
import type { BurstOptions, ParticlePreset } from '../../../vfx/VFX';
import type { Interactable } from '../../Interactables';
import type { ContentBuilder } from '../../kit/Builder';
import type { WaterSheets } from './parts';

/** Everything the Agna Qel'a sub-builders need (bound to the region instance). */
export interface NwtKit {
  ctx: GameContext;
  /** Big architecture (stays visible at 'far' detail). */
  core: ContentBuilder;
  /** Transparent water features (falls, foam) — merged separately. */
  wet: ContentBuilder;
  /** Small dressing (hidden at 'far' detail). */
  props: ContentBuilder;
  sheets: WaterSheets;
  rnd: Random;
  /** Decorative density 0.3..1.5 (follows the foliage setting; never affects colliders). */
  density: number;
  /** Another builder on the main layer (e.g. one district's merged architecture). */
  mainBuilder(): ContentBuilder;
  /** A builder on a detail layer hidden when the camera is farther than `range` from (x, z). */
  layer(name: string, x: number, z: number, range: number): ContentBuilder;
  water(def: WaterSourceDef): void;
  emitter(preset: ParticlePreset, rate: number, pos: THREE.Vector3, opts?: BurstOptions, range?: number, ambient?: boolean): void;
  interact(i: Interactable): void;
  npc(def: NPCDef): void;
  own<T extends THREE.BufferGeometry | THREE.Material>(x: T): T;
  /** Per-frame animation hook (t = elapsed seconds). */
  onTick(fn: (t: number, dt: number) => void): void;
  /** Add an object (owned mesh/instanced mesh) to the props layer. */
  addProp(o: THREE.Object3D): void;
}
