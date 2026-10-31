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
import { SatOverlay } from '../../air/sat/overlay';
import { CapitalLife } from './life';
import { Vessels } from './vessels';
import { TurtleDucks } from './ducks';

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
  /** Harbour traffic, tanks, balloons (phase 5). */
  vessels: Vessels | null = null;
  /** The capital's people (phase 5). */
  life: CapitalLife | null = null;
  /** F3 debug overlay while in the capital (frame rate, draw calls, people and vehicles). */
  overlay: SatOverlay | null = null;
  /** The garden pond's turtle-duck family (and the feeding interaction). */
  ducks: TurtleDucks | null = null;
  private fps = 60;

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
    yield;
    this.vessels = new Vessels(this.group);
    this.vessels.build(this.ctx);
    this.life = new CapitalLife(this.group, this.marks);
    this.ducks?.dispose();
    this.ducks = new TurtleDucks(this.group, () => this.ctx.time.elapsed);
    env.interactables.push(this.ducks.interactable);
    this.overlay?.dispose();
    this.overlay = new SatOverlay(
      () => this.overlayLines(),
      () => {
        const p = this.ctx.player?.position;
        return !!p && Math.hypot(p.x - REGION_CENTER.x, p.z - REGION_CENTER.z) < REGION_RADIUS;
      },
    );
    this.installDebug();
  }

  override update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    FlameField.tick(ctx.time.elapsed);
    if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
    const full = this.detailLevel === 'full' && !this.building;
    if (this.vessels) this.vessels.root.visible = this.detailLevel !== 'hidden';
    if (this.life) this.life.group.visible = full;
    if (full && this.vessels && this.life) {
      this.vessels.parked = this.life.rally.on;
      this.vessels.update(dt, ctx);
      this.life.update(dt, ctx, true);
    }
    if (full) this.ducks?.update(dt, ctx.time.elapsed);
    this.overlay?.update(dt);
  }

  override onSessionEnd(ctx: GameContext): void {
    super.onSessionEnd(ctx);
    this.life?.onSessionEnd();
  }

  override dispose(ctx: GameContext): void {
    this.vessels?.dispose(ctx);
    this.vessels = null;
    this.life?.dispose();
    this.life = null;
    this.ducks?.dispose();
    this.ducks = null;
    this.overlay?.dispose();
    this.overlay = null;
    const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (g?.debug && (g.debug.fnc as { owner?: unknown } | undefined)?.owner === this) delete g.debug.fnc;
    this.flames.dispose();
    super.dispose(ctx);
  }

  private overlayLines(): string[] {
    const info = this.ctx.render.renderer.info.render;
    const l = this.life?.stats, v = this.vessels?.counts();
    return [
      'Fire Nation Capital',
      `fps ${this.fps.toFixed(0)}  draw calls ${info.calls}  triangles ${(info.triangles / 1000).toFixed(0)}k`,
      l ? `people ${l.total}: out ${l.out}, drawn ${l.visible}, walking ${l.walking}, drilling ${l.drilling}, squads ${l.squads}` : 'people —',
      l ? `rally ${this.life!.rally.on ? (this.life!.rally.speech ? 'speech' : 'gathering') : 'off'} (${l.rally})  proclamation ${this.life!.proclaim.on ? 'on' : 'off'} (${l.proclaim})  crowd ${l.ms.toFixed(2)} ms` : '',
      v ? `vehicles: warships ${v.warships} (moving ${v.moving}), boats ${v.boats}, tanks ${v.tanks}, balloons ${v.balloons}, sea gate ${(v.gate * 100).toFixed(0)}%` : 'vehicles —',
      `hour ${this.ctx.world.sky.timeOfDay.toFixed(2)}`,
    ];
  }

  /** `__game.debug.fnc`: counts, rally / proclamation switches, ship clock, overlay. */
  private installDebug(): void {
    const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (!g?.debug) return;
    g.debug.fnc = {
      owner: this,
      marks: () => this.marks,
      life: () => this.life?.counts() ?? null,
      vessels: () => this.vessels?.counts() ?? null,
      ships: () => this.vessels?.ships() ?? [],
      skipShips: (s: number) => this.vessels?.skip(s),
      rally: (on: boolean | null, instant = false) => this.life?.setRally(on, instant),
      proclaim: (on: boolean | null) => this.life?.setProclamation(on),
      overlay: (on?: boolean) => this.overlay?.toggle(on),
      overlayText: () => this.overlay?.text ?? '',
      nav: () => ({ nodes: this.life?.nav.nodes.length ?? 0, components: this.life?.nav.components().slice(0, 5) ?? [] }),
    };
  }
}
