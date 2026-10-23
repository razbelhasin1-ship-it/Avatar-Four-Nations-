import * as THREE from 'three';
import type { WaterSourceDef } from '../../../combat/WaterSources';
import type { GameContext } from '../../../core/GameContext';
import type { Emitter, ParticlePreset } from '../../../vfx/VFX';
import { ContentBuilder } from '../../kit/Builder';
import type { RegionContent } from '../../RegionContent';
import type { P2 } from '../../WorldLayout';
import { FlameField } from './flames';
import { lavaMat } from './materials';

/**
 * Base class for the Fire Nation region modules (capital, harbour, causeway,
 * Sun Warrior ruins, Ember Island).
 *
 * Geometry is organised in *layers* (one kit ContentBuilder each, merged per
 * material at finish()). Layers are spatial districts so the renderer can
 * frustum-cull them, and are tagged:
 *   - far:    stays visible at 'far' detail (big silhouettes); otherwise hidden
 *   - decor:  'extra' layers only show when foliage density >= 0.75
 * Flames for every brazier/torch of the region are one instanced mesh.
 */

export interface LayerOptions {
  /** Keep visible at 'far' detail (default false = hidden when far). */
  far?: boolean;
  /** Meshes cast shadows (default true for far layers, false otherwise). */
  shadows?: boolean;
  /** 'extra' = optional clutter, only on medium+ foliage density. */
  decor?: 'extra';
}

interface Layer {
  name: string;
  b: ContentBuilder;
  g: THREE.Group;
  far: boolean;
  shadows: boolean;
  decor: 'extra' | null;
}

export interface AmbientSite {
  x: number;
  y: number;
  z: number;
  preset: ParticlePreset;
  rate: number;
  /** Start emitting when the player is within this distance. */
  range: number;
  dir?: THREE.Vector3;
  size?: number;
  speed?: number;
  /** Shown even with ambient effects off (smokestacks). */
  essential?: boolean;
}

const REGISTRY = new Map<string, FireRegion>();

/** Debug/test hooks: window.__game.debug.fire */
function installDebug(): void {
  const g = (globalThis as any).__game;
  if (!g || !g.debug || g.debug.fire) return;
  g.debug.fire = {
    regions: () =>
      [...REGISTRY.values()].map((r) => ({
        id: r.id,
        buildMs: +r.buildMs.toFixed(1),
        detail: r.detailLevel,
        layers: r.layerStats(),
        flames: r.flameCount,
        water: r.waterSourceIds,
        colliders: r.colliderCount,
      })),
    region: (id: string) => REGISTRY.get(id) ?? null,
  };
}

export abstract class FireRegion implements RegionContent {
  abstract readonly id: string;
  abstract readonly center: P2;
  abstract readonly loadRadius: number;
  readonly group = new THREE.Group();
  protected ctx!: GameContext;
  protected readonly flames = new FlameField();
  private readonly layers: Layer[] = [];
  private readonly ownedObjects: THREE.Object3D[] = [];
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];
  private readonly waterIds: string[] = [];
  private readonly ambientSites: AmbientSite[] = [];
  private readonly liveEmitters = new Map<AmbientSite, Emitter>();
  private ambientTimer = 0;
  private detail: 'full' | 'far' | 'hidden' = 'full';
  private offSettings: (() => void) | null = null;
  private lavaPhase = 0;
  buildMs = 0;

  build(ctx: GameContext): void {
    this.ctx = ctx;
    this.group.name = `region_${this.id}`;
    const t0 = performance.now();
    this.construct(ctx);
    for (const l of this.layers) {
      l.b.finish();
      for (const m of l.b.meshes) {
        m.castShadow = l.shadows && (m as THREE.Mesh).castShadow;
        if (!l.shadows) m.castShadow = false;
      }
    }
    this.flames.build(this.group);
    this.applySettings();
    this.offSettings = ctx.events.on('settings:changed', () => this.applySettings());
    this.buildMs = performance.now() - t0;
    REGISTRY.set(this.id, this);
    installDebug();
  }

  /** Build all static content (layers, colliders, water sources, spots). */
  protected abstract construct(ctx: GameContext): void;

  /** Per-frame animation hook (only called while the player is near). */
  protected animate(_dt: number, _ctx: GameContext): void {}

  /** Session hooks for subclasses (interactables, extra emitters). */
  protected sessionStart(_ctx: GameContext): void {}
  protected sessionEnd(_ctx: GameContext): void {}

  // -------------------------------------------------------------------------
  // Construction helpers
  // -------------------------------------------------------------------------

  /** New geometry layer (district). */
  protected layer(name: string, o: LayerOptions = {}): ContentBuilder {
    const g = new THREE.Group();
    g.name = `${this.id}:${name}`;
    this.group.add(g);
    const b = new ContentBuilder(this.ctx, g, this.id);
    this.layers.push({ name, b, g, far: o.far ?? false, shadows: o.shadows ?? (o.far ?? false), decor: o.decor ?? null });
    return b;
  }

  /** Track a custom object (added to the region group) for disposal. */
  protected own<T extends THREE.Object3D>(obj: T, parent: THREE.Object3D = this.group): T {
    parent.add(obj);
    this.ownedObjects.push(obj);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) this.ownedGeos.push(m.geometry);
    });
    return obj;
  }

  /** Track a material created by this region (not the shared caches). */
  protected ownMaterial<T extends THREE.Material>(m: T): T {
    this.ownedMats.push(m);
    return m;
  }

  /** Register a water source owned by this region. */
  protected water(def: WaterSourceDef): string {
    this.ctx.water.register(def);
    this.waterIds.push(def.id);
    return def.id;
  }

  /** Ambient particle site (smoke from stacks/vents, embers over braziers). */
  protected ambient(site: AmbientSite): void {
    this.ambientSites.push(site);
  }

  // -------------------------------------------------------------------------
  // RegionContent
  // -------------------------------------------------------------------------

  setDetail(level: 'full' | 'far' | 'hidden'): void {
    if (level === this.detail) return;
    this.detail = level;
    this.applyVisibility();
  }

  get detailLevel(): string {
    return this.detail;
  }

  private applySettings(): void {
    this.applyVisibility();
    const g = this.ctx.settings.data.graphics;
    FlameField.setFadeDistance(Math.max(260, Math.min(700, g.drawDistance * 0.9)));
  }

  private applyVisibility(): void {
    const g = this.ctx?.settings.data.graphics;
    const extraOk = (g?.foliageDensity ?? 1) >= 0.75;
    this.group.visible = this.detail !== 'hidden';
    for (const l of this.layers) {
      let vis = this.detail === 'full' || l.far;
      if (l.decor === 'extra' && !extraOk) vis = false;
      l.g.visible = vis;
    }
    if (this.flames.mesh) this.flames.mesh.visible = this.detail === 'full';
  }

  update(dt: number, ctx: GameContext): void {
    FlameField.tick(ctx.time.elapsed);
    // Lava glow breathes slowly (shared material, idempotent per frame).
    this.lavaPhase = ctx.time.elapsed;
    lavaMat().emissiveIntensity = 1.9 + 0.5 * Math.sin(this.lavaPhase * 1.3) + 0.25 * Math.sin(this.lavaPhase * 3.7);
    if (this.detail === 'full') this.animate(dt, ctx);
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 0.5;
      this.updateAmbience(ctx);
    }
  }

  private updateAmbience(ctx: GameContext): void {
    const p = ctx.player;
    if (!p || !ctx.session.active || !this.ambientSites.length) return;
    const g = ctx.settings.data.graphics;
    const max = g.ambientEffects ? (g.effectsQuality === 'high' ? 12 : 8) : 3;
    const pos = p.position;
    const ranked = this.ambientSites
      .filter((s) => g.ambientEffects || s.essential)
      .map((s) => ({ s, d: Math.hypot(s.x - pos.x, s.z - pos.z) }))
      .filter((e) => e.d < e.s.range)
      .sort((a, b) => a.d - b.d)
      .slice(0, max);
    const want = new Set(ranked.map((e) => e.s));
    for (const [site, em] of this.liveEmitters) {
      if (!want.has(site) || !em.active) {
        em.stop();
        this.liveEmitters.delete(site);
      }
    }
    for (const { s } of ranked) {
      if (this.liveEmitters.has(s)) continue;
      const em = ctx.vfx.emitter(s.preset, s.rate, { size: s.size, speed: s.speed, dir: s.dir });
      em.position.set(s.x, s.y, s.z);
      if (s.dir) em.direction.copy(s.dir);
      this.liveEmitters.set(s, em);
    }
  }

  onSessionStart(ctx: GameContext): void {
    this.ambientTimer = 0;
    this.sessionStart(ctx);
  }

  onSessionEnd(ctx: GameContext): void {
    for (const em of this.liveEmitters.values()) em.stop();
    this.liveEmitters.clear();
    this.sessionEnd(ctx);
  }

  dispose(ctx: GameContext): void {
    this.onSessionEnd(ctx);
    for (const l of this.layers) {
      l.b.dispose();
      l.g.removeFromParent();
    }
    this.layers.length = 0;
    this.flames.dispose();
    for (const o of this.ownedObjects) o.removeFromParent();
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    this.ownedObjects.length = 0;
    this.ownedGeos.length = 0;
    this.ownedMats.length = 0;
    for (const id of this.waterIds) ctx.water.unregister(id);
    this.waterIds.length = 0;
    this.ambientSites.length = 0;
    this.offSettings?.();
    this.offSettings = null;
    REGISTRY.delete(this.id);
    this.group.removeFromParent();
  }

  // -------------------------------------------------------------------------
  // Introspection (debug / tests)
  // -------------------------------------------------------------------------

  layerStats(): Array<{ name: string; meshes: number; visible: boolean; tris: number }> {
    return this.layers.map((l) => {
      let tris = 0;
      for (const m of l.b.meshes) {
        const mesh = m as THREE.Mesh;
        const geo = mesh.geometry;
        if (!geo) continue;
        const n = geo.index ? geo.index.count / 3 : geo.getAttribute('position').count / 3;
        tris += (m as THREE.InstancedMesh).isInstancedMesh ? n * (m as THREE.InstancedMesh).count : n;
      }
      return { name: l.name, meshes: l.b.meshes.length, visible: l.g.visible, tris: Math.round(tris) };
    });
  }

  get flameCount(): number {
    return this.flames.count;
  }

  get waterSourceIds(): string[] {
    return [...this.waterIds];
  }

  get colliderCount(): number {
    let n = 0;
    for (const l of this.layers) n += l.b.colliderIds.length;
    return n;
  }
}
