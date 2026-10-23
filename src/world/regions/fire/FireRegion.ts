import * as THREE from 'three';
import type { WaterSourceDef } from '../../../combat/WaterSources';
import type { GameContext } from '../../../core/GameContext';
import type { NPCDef } from '../../../npc/NPCTypes';
import type { Interactable } from '../../Interactables';
import type { Emitter, ParticlePreset } from '../../../vfx/VFX';
import { ContentBuilder } from '../../kit/Builder';
import type { RegionContent } from '../../RegionContent';
import type { P2 } from '../../WorldLayout';
import { FlameField } from './flames';
import { lavaMat } from './materials';
import { FIRE_SPOTS } from './spots';

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
  finished: boolean;
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
        npcs: r.npcCount,
        interactables: r.interactableIds,
      })),
    region: (id: string) => REGISTRY.get(id) ?? null,
    /** All spots published by the Fire Nation modules. */
    spots: () => JSON.parse(JSON.stringify(FIRE_SPOTS)),
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
  private readonly npcDefs: NPCDef[] = [];
  private readonly interactables: Interactable[] = [];
  private interactOffs: Array<() => void> = [];
  buildMs = 0;

  build(ctx: GameContext): void {
    this.ctx = ctx;
    this.group.name = `region_${this.id}`;
    const t0 = performance.now();
    this.construct(ctx);
    // Deferred construction: drained now when the player is close (spawn, fast travel
    // into the region), otherwise time-sliced in update() so walking in never hitches.
    const p = ctx.player?.position;
    const near = !p || Math.hypot(p.x - this.center.x, p.z - this.center.z) < this.loadRadius * 0.5;
    if (this.pending && near) {
      while (!this.pending.next().done);
      this.pending = null;
    }
    this.finishLayers();
    this.liftPlayerOut(ctx);
    this.flames.build(this.group);
    this.applySettings();
    this.offSettings = ctx.events.on('settings:changed', () => this.applySettings());
    this.buildMs = performance.now() - t0;
    REGISTRY.set(this.id, this);
    installDebug();
  }

  private pending: Iterator<unknown> | null = null;

  /** Register a step-wise construction (a generator yielding between chunks of work). */
  protected deferBuild(steps: Iterator<unknown>): void {
    this.pending = steps;
  }

  /** Merge every layer not merged yet (after construct and after deferred steps). */
  private finishLayers(): void {
    for (const l of this.layers) {
      if (l.finished) continue;
      l.finished = true;
      l.b.finish();
      for (const m of l.b.meshes) {
        m.castShadow = l.shadows && (m as THREE.Mesh).castShadow;
        if (!l.shadows) m.castShadow = false;
      }
    }
  }

  /**
   * If the region was built around a player standing at terrain height inside one of
   * its walkable solids (fast travel lands before the region streams in), put them on
   * top instead of letting the push-out shove them sideways (possibly into the sea).
   */
  private liftPlayerOut(ctx: GameContext): void {
    const pl = ctx.player;
    if (!pl) return;
    const pos = pl.position;
    const col = ctx.world.collision;
    let top = -Infinity;
    col.query(pos.x, pos.z, 0.3, (c) => {
      if (c.tag !== this.id || !c.solid || !c.walkable) return;
      const t = col.topAt(c, pos.x, pos.z);
      if (t === -Infinity) return;
      if (pos.y > c.y - c.hy - 0.5 && pos.y < t - 0.05) top = Math.max(top, t);
    });
    if (top > -Infinity && top - pos.y < 40) pl.teleport(new THREE.Vector3(pos.x, top + 0.05, pos.z));
  }

  /** True while deferred construction is still running. */
  get building(): boolean {
    return this.pending !== null;
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
    // Same name → same layer (districts can share one merged batch set).
    const existing = this.layers.find((l) => l.name === name);
    if (existing) return existing.b;
    const g = new THREE.Group();
    g.name = `${this.id}:${name}`;
    this.group.add(g);
    const b = new ContentBuilder(this.ctx, g, this.id);
    this.layers.push({ name, b, g, far: o.far ?? false, shadows: o.shadows ?? (o.far ?? false), decor: o.decor ?? null, finished: false });
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

  /** Ambient NPC (registered with the NPC system at session start; streamed by distance). */
  protected npc(def: NPCDef): void {
    this.npcDefs.push(def);
  }

  /** E-prompt interaction registered for the session. */
  protected interactable(i: Interactable): void {
    this.interactables.push(i);
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
    if (this.pending) {
      const t0 = performance.now();
      while (performance.now() - t0 < 4) {
        if (this.pending.next().done) {
          this.pending = null;
          this.finishLayers();
          this.applyVisibility();
          break;
        }
      }
    }
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
    for (const d of this.npcDefs) ctx.npcs.addDef(d);
    for (const off of this.interactOffs) off();
    this.interactOffs = this.interactables.map((i) => ctx.interactions.register(i));
    this.sessionStart(ctx);
  }

  onSessionEnd(ctx: GameContext): void {
    for (const em of this.liveEmitters.values()) em.stop();
    this.liveEmitters.clear();
    for (const off of this.interactOffs) off();
    this.interactOffs = [];
    this.sessionEnd(ctx);
  }

  get npcCount(): number {
    return this.npcDefs.length;
  }

  get interactableIds(): string[] {
    return this.interactables.map((i) => i.id);
  }

  dispose(ctx: GameContext): void {
    this.pending = null;
    this.onSessionEnd(ctx);
    for (const l of this.layers) {
      l.b.dispose();
      l.g.removeFromParent();
    }
    this.layers.length = 0;
    this.flames.dispose();
    for (const o of this.ownedObjects) {
      o.removeFromParent();
      o.traverse((c) => {
        if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
      });
    }
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
