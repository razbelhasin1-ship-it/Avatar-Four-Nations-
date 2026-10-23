import * as THREE from 'three';
import type { WaterSourceDef } from '../../../combat/WaterSources';
import type { GameContext } from '../../../core/GameContext';
import type { NPCDef } from '../../../npc/NPCTypes';
import type { Emitter, ParticlePreset, BurstOptions } from '../../../vfx/VFX';
import type { Interactable } from '../../Interactables';
import { ContentBuilder } from '../../kit/Builder';
import type { RegionContent } from '../../RegionContent';
import { allSpots } from '../../Spots';
import type { P2 } from '../../WorldLayout';
import { acquireWaterMaterials, animateWaterMaterials, releaseWaterMaterials } from './materials';

/**
 * Shared lifecycle for the Water Tribe regions.
 *
 *  - Two render layers: `main` (architecture, kept at 'far' detail so the
 *    silhouette reads from a distance) and `props` (small dressing, hidden at
 *    'far'). Districts can add their own prop layers that are culled by camera
 *    distance while the region is at full detail.
 *  - Geometry goes through kit ContentBuilders (merged per material, instanced
 *    props); colliders are tagged with the region id.
 *  - Water sources registered here are unregistered on dispose.
 *  - Session-only content (particle emitters, interactables, ambient NPC
 *    definitions) is (re)created in onSessionStart and torn down in onSessionEnd.
 */
export interface DistrictLayer {
  group: THREE.Group;
  center: THREE.Vector3;
  /** Hide when the camera is farther than this (m). */
  range: number;
}

interface AmbientEmitter {
  preset: ParticlePreset;
  rate: number;
  pos: THREE.Vector3;
  options: BurstOptions;
  /** Only emit when the player is within this distance. */
  range: number;
  /** Needs ambient effects enabled in settings (decorative). */
  ambient: boolean;
}

const WATER_REGIONS = ['northern_water_tribe', 'southern_water_tribe', 'meditation_isle'];
const LIVE = new Set<WaterRegion>();

/** Test hooks on window.__game.debug.water (spots, walk routes, built regions). */
function installDebug(): void {
  const g = typeof window !== 'undefined' ? (window as unknown as { __game?: { debug?: Record<string, unknown> } }).__game : undefined;
  if (!g?.debug || g.debug.water) return;
  g.debug.water = {
    spots: () => Object.fromEntries(allSpots().filter(([, s]) => s.region && WATER_REGIONS.includes(s.region))),
    built: () => [...LIVE].map((r) => r.id),
    routes: () => Object.assign({}, ...[...LIVE].map((r) => (r as unknown as { routes?: Record<string, unknown> }).routes ?? {})),
  };
}

export abstract class WaterRegion implements RegionContent {
  readonly group = new THREE.Group();
  readonly main = new THREE.Group();
  readonly props = new THREE.Group();
  protected ctx!: GameContext;
  protected readonly builders: ContentBuilder[] = [];
  protected readonly waterIds: string[] = [];
  protected readonly ownedGeometries: THREE.BufferGeometry[] = [];
  protected readonly ownedMaterials: THREE.Material[] = [];
  protected readonly districts: DistrictLayer[] = [];
  private readonly ambient: AmbientEmitter[] = [];
  private readonly live: Array<{ def: AmbientEmitter; em: Emitter }> = [];
  private readonly interactables: Interactable[] = [];
  private readonly interactOffs: Array<() => void> = [];
  protected readonly npcDefs: NPCDef[] = [];
  private npcDefsAdded = false;
  private detail: 'full' | 'far' | 'hidden' = 'full';
  private built = false;
  private distTimer = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly id: string,
    readonly center: P2,
    readonly loadRadius: number,
  ) {
    this.group.name = `region_${id}`;
    this.main.name = `${id}_main`;
    this.props.name = `${id}_props`;
    this.group.add(this.main, this.props);
  }

  /** Create a builder writing into a layer group. */
  protected builder(layer: THREE.Group = this.main): ContentBuilder {
    const b = new ContentBuilder(this.ctx, layer, this.id);
    this.builders.push(b);
    return b;
  }

  /** A prop layer culled by camera distance (while at full detail). */
  protected district(name: string, x: number, z: number, range: number): THREE.Group {
    const g = new THREE.Group();
    g.name = `${this.id}_${name}`;
    this.props.add(g);
    this.districts.push({ group: g, center: new THREE.Vector3(x, 0, z), range });
    return g;
  }

  protected registerWater(def: WaterSourceDef): void {
    this.ctx.water.register(def);
    this.waterIds.push(def.id);
  }

  /** Decorative particle emitter, active during sessions when the player is near. */
  protected ambientEmitter(preset: ParticlePreset, rate: number, pos: THREE.Vector3, options: BurstOptions = {}, range = 90, ambient = true): void {
    this.ambient.push({ preset, rate, pos: pos.clone(), options, range, ambient });
  }

  /** Interactable registered for each session. */
  protected interactable(i: Interactable): void {
    this.interactables.push(i);
  }

  /** Ambient NPC definition (added to the NPC system once; it streams them near the player). */
  protected ambientNPC(def: NPCDef): void {
    this.npcDefs.push(def);
  }

  /** Track a geometry / material created outside builders. */
  protected own<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    if ((x as THREE.BufferGeometry).isBufferGeometry) this.ownedGeometries.push(x as THREE.BufferGeometry);
    else this.ownedMaterials.push(x as THREE.Material);
    return x;
  }

  build(ctx: GameContext): void {
    if (this.built) return;
    this.ctx = ctx;
    this.built = true;
    LIVE.add(this);
    installDebug();
    acquireWaterMaterials();
    this.construct(ctx);
    for (const b of this.builders) b.finish();
    // Transparent water / falls render after opaque geometry.
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && (m as THREE.Material).transparent) {
        o.renderOrder = 2;
        (o as THREE.Mesh).castShadow = false;
      }
    });
    if (!this.npcDefsAdded) {
      for (const d of this.npcDefs) ctx.npcs.addDef(d);
      this.npcDefsAdded = true;
    }
  }

  /** Build all geometry, colliders and water sources. */
  protected abstract construct(ctx: GameContext): void;

  /** Per-frame hook for subclasses (animation). */
  protected tick(_dt: number, _ctx: GameContext): void {}

  update(dt: number, ctx: GameContext): void {
    animateWaterMaterials(ctx);
    this.distTimer -= dt;
    if (this.distTimer <= 0) {
      this.distTimer = 0.4;
      this.updateDistricts(ctx);
      this.updateEmitters(ctx);
    }
    this.tick(dt, ctx);
  }

  private updateDistricts(ctx: GameContext): void {
    const cam = ctx.camera.position;
    for (const d of this.districts) {
      this.tmp.set(cam.x, 0, cam.z);
      d.group.visible = this.tmp.distanceTo(d.center) < d.range;
    }
  }

  private updateEmitters(ctx: GameContext): void {
    if (!this.live.length) return;
    const p = ctx.player?.position ?? ctx.camera.position;
    for (const l of this.live) {
      const near = p.distanceTo(l.def.pos) < l.def.range;
      l.em.rate = near ? l.def.rate : 0;
    }
  }

  setDetail(level: 'full' | 'far' | 'hidden'): void {
    if (level === this.detail) return;
    this.detail = level;
    this.group.visible = level !== 'hidden';
    this.props.visible = level === 'full';
  }

  onSessionStart(ctx: GameContext): void {
    this.ctx = ctx;
    const ambientOn = ctx.settings.data.graphics.ambientEffects;
    for (const a of this.ambient) {
      if (a.ambient && !ambientOn) continue;
      const em = ctx.vfx.emitter(a.preset, 0, { ...a.options });
      em.position.copy(a.pos);
      if (a.options.dir) em.direction.copy(a.options.dir);
      this.live.push({ def: a, em });
    }
    for (const i of this.interactables) this.interactOffs.push(ctx.interactions.register(i));
    this.onSession(ctx);
  }

  /** Subclass hook at session start (after emitters/interactables). */
  protected onSession(_ctx: GameContext): void {}

  /** Subclass hook at session end. */
  protected offSession(_ctx: GameContext): void {}

  onSessionEnd(ctx: GameContext): void {
    for (const l of this.live) l.em.stop();
    this.live.length = 0;
    for (const off of this.interactOffs) off();
    this.interactOffs.length = 0;
    this.offSession(ctx);
  }

  dispose(ctx: GameContext): void {
    if (!this.built) return;
    this.onSessionEnd(ctx);
    for (const b of this.builders) b.dispose();
    this.builders.length = 0;
    for (const id of this.waterIds) ctx.water.unregister(id);
    this.waterIds.length = 0;
    for (const g of this.ownedGeometries) g.dispose();
    this.ownedGeometries.length = 0;
    for (const m of this.ownedMaterials) m.dispose();
    this.ownedMaterials.length = 0;
    for (const d of this.districts) d.group.removeFromParent();
    this.districts.length = 0;
    this.main.clear();
    this.props.clear();
    releaseWaterMaterials();
    LIVE.delete(this);
    this.built = false;
  }
}
