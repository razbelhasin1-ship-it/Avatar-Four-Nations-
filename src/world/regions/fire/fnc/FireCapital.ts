import * as THREE from 'three';
import type { GameContext } from '../../../../core/GameContext';
import type { NPCDef } from '../../../../npc/NPCTypes';
import type { ContentBuilder } from '../../../kit/Builder';
import { EarthRegion } from '../../earth/EarthRegion';
import type { BuildEnv } from '../../earth/env';
import { FlameField } from '../flames';
import { buildCaldera } from './caldera';
import { buildCity } from './city';
import { buildHarbor } from './harbor';
import { CONFIG, REGION_CENTER, REGION_RADIUS } from './layout';
import { buildPalace } from './palace';
import { buildPlaza } from './plaza';
import { buildRoad } from './road';

/**
 * The Fire Nation capital, rebuilt from the sea to the palace (see landforms/fireCapital.ts for the
 * ground and fnc/layout.ts for the master layout): First Lord's Harbor and the sea wall, the Royal
 * Plaza, Harbor City, Sozin's road, the crater lip, Hari Bulkan and the Royal Palace.
 *
 * Built on the EarthRegion chunk framework (spatial chunks with distance LOD, atlas house
 * archetypes, time-sliced construction); braziers and torches share one FlameField.
 */
export interface Cap {
  env: BuildEnv;
  flames: FlameField;
  /** Named point for tests / debug. */
  mark(id: string, x: number, y: number, z: number): void;
  /** Register a water surface (waterbending source) built into a chunk. */
  water(b: ContentBuilder, o: Parameters<ContentBuilder['waterSurface']>[0]): THREE.Mesh;
  npc(def: NPCDef): void;
  /** Per-frame animation while the region is near (ships, gates, flags…). */
  animate(fn: (dt: number, t: number) => void): void;
}

export class FireCapitalCity extends EarthRegion {
  readonly id = 'fire_capital';
  readonly center = REGION_CENTER;
  readonly loadRadius = REGION_RADIUS;
  protected readonly seed = CONFIG.seed;
  protected override readonly cell = 96;
  readonly flames = new FlameField();

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    const cap: Cap = {
      env,
      flames: this.flames,
      mark: (id, x, y, z) => this.mark(id, x, y, z),
      water: (b, o) => this.water(b, o),
      npc: (d) => this.npc(d),
      animate: (fn) => env.animated.push(fn),
    };
    yield* buildHarbor(cap);
    yield* buildPlaza(cap);
    yield* buildCity(cap);
    yield* buildRoad(cap);
    yield* buildCaldera(cap);
    yield* buildPalace(cap);
    this.flames.build(this.group);
  }

  override update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    FlameField.tick(ctx.time.elapsed);
  }

  override dispose(ctx: GameContext): void {
    this.flames.dispose();
    super.dispose(ctx);
  }
}
