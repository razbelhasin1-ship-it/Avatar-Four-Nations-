import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { Persistable } from '../core/Save';
import type { BiomeId, SurfaceType } from '../core/types';
import type { PhysicsWorld } from '../entities/KinematicBody';
import { CollisionWorld } from './Collision';
import { LiftableRocks } from './LiftableRocks';
import { biomeAt, heightAt, initHeightfield, normalAt, terrainSurfaceAt, waterAt, type WaterHit } from './Heightfield';
import type { RegionContent, RegionFactory } from './RegionContent';
import { REGION_FACTORIES } from './regions';
import { envUniforms } from './env/EnvShared';
import { SkySystem } from './Sky';
import { ICE_TOP, TerrainManager } from './Terrain';
import { WaterRenderer } from './Water';
import { LANDMARKS, regionAt, type LandmarkDef, type RegionDef } from './WorldLayout';

/**
 * Environment reaction hooks used by combat, movement and weather. The world
 * tech module provides real implementations (vegetation bending, footprints,
 * scorch decals...). Defaults are no-ops so callers never need to null-check.
 */
export interface EnvironmentFX {
  /** Push grass/foliage/snow away from a point (wind blast, landing, explosion). */
  disturb(pos: THREE.Vector3, radius: number, strength: number): void;
  /** Footprint / trail decal on deformable surfaces (snow, sand, mud). */
  footprint(pos: THREE.Vector3, yaw: number, foot: 'L' | 'R', kind: 'walk' | 'run' | 'land' | 'slide', surface: SurfaceType): void;
  /** Scorch mark from fire. */
  scorch(pos: THREE.Vector3, radius: number): void;
  /** Wet patch from water attacks. */
  wet(pos: THREE.Vector3, radius: number): void;
  /** Frost patch / temporary ice on the ground. */
  frost(pos: THREE.Vector3, radius: number): void;
  /** Ground crack decal from earthbending. */
  crack(pos: THREE.Vector3, radius: number, yaw?: number): void;
}

const noopFX: EnvironmentFX = {
  disturb() {},
  footprint() {},
  scorch() {},
  wet() {},
  frost() {},
  crack() {},
};

export interface GroundSample {
  y: number;
  surface: SurfaceType;
  nx: number;
  ny: number;
  nz: number;
  /** 0 = terrain, else collider id. */
  colliderId: number;
}

export interface WorldUpdatable {
  update(dt: number, ctx: GameContext, focus: THREE.Vector3): void;
  /**
   * Optional loading-screen work around `p` (vegetation, grass...). Do up to
   * `budgetMs` of work and return how many work items are still pending.
   */
  preload?(p: THREE.Vector3, budgetMs: number): number;
  dispose?(): void;
}

export class World implements PhysicsWorld, Persistable {
  readonly saveKey = 'world';
  readonly group = new THREE.Group();
  readonly collision = new CollisionWorld();
  /** Region-placed rocks an earthbender can lift (ContentBuilder.rock / rockInstance). */
  readonly rocks = new LiftableRocks(this.collision);
  readonly terrain = new TerrainManager();
  water!: WaterRenderer;
  sky!: SkySystem;
  fx: EnvironmentFX = noopFX;
  /** Extra per-frame world systems (vegetation, weather, ambient life) registered by modules. */
  private readonly updatables: WorldUpdatable[] = [];
  private readonly regions: RegionContent[] = [];
  private readonly builtRegions = new Set<string>();
  private ctx!: GameContext;
  readonly focus = new THREE.Vector3();
  private readonly tmpN = { x: 0, y: 1, z: 0 };

  // Persistent state
  readonly discovered = new Set<string>();
  readonly visitedRegions = new Set<string>();
  currentRegion: RegionDef | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    initHeightfield();
    this.group.name = 'world';
    ctx.scene.add(this.group);
    this.group.add(this.terrain.group);
    envUniforms.uHeightTex.value = this.terrain.heightTex.texture;
    this.water = new WaterRenderer();
    this.group.add(this.water.group);
    this.sky = new SkySystem(ctx.render);
    for (const f of REGION_FACTORIES) this.addRegion(f);
    this.applySettings();
    ctx.events.on('settings:changed', () => this.applySettings());
  }

  private applySettings(): void {
    const g = this.ctx.settings.data.graphics;
    this.terrain.drawDistance = g.drawDistance;
    this.terrain.lodBias = g.lodBias;
    this.terrain.castShadows = g.shadows !== 'off';
    // Terrain shading tier: 0 = vertex colours + detail (Low), 1 = splat, 2 = splat + anti-tiling.
    const detail = g.effectsQuality === 'low' || g.lodBias >= 0.5 ? 0 : g.effectsQuality === 'high' ? 2 : 1;
    this.terrain.setQuality(detail, detail === 0 ? 1 : detail === 1 ? 4 : 8);
    this.water?.setQuality(g.effectsQuality);
  }

  addRegion(factory: RegionFactory): void {
    try {
      const r = factory();
      this.regions.push(r);
    } catch (err) {
      console.error('[World] region factory failed', err);
    }
  }

  addUpdatable(u: WorldUpdatable): void {
    this.updatables.push(u);
  }

  removeUpdatable(u: WorldUpdatable): void {
    const i = this.updatables.indexOf(u);
    if (i >= 0) this.updatables.splice(i, 1);
  }

  getRegionContent(id: string): RegionContent | undefined {
    return this.regions.find((r) => r.id === id);
  }

  /** Build any region content whose load radius contains `p`. Returns ids built. */
  private ensureRegionsAround(p: THREE.Vector3, force = false): string[] {
    const built: string[] = [];
    for (const r of this.regions) {
      if (this.builtRegions.has(r.id)) continue;
      const d = Math.hypot(p.x - r.center.x, p.z - r.center.z);
      if (d > r.loadRadius && !force) continue;
      try {
        r.build(this.ctx);
        this.group.add(r.group);
        this.builtRegions.add(r.id);
        built.push(r.id);
        if (this.ctx.session.active) r.onSessionStart?.(this.ctx);
      } catch (err) {
        console.error(`[World] building region ${r.id} failed`, err);
        this.builtRegions.add(r.id);
      }
    }
    return built;
  }

  /**
   * Synchronously stream terrain + region content around a point (loading
   * screens). Calls onProgress with 0..1. Yields to the browser between batches.
   */
  async preload(p: THREE.Vector3, onProgress?: (f: number, label: string) => void): Promise<void> {
    this.focus.copy(p);
    onProgress?.(0.05, 'Shaping the land…');
    let pending = this.terrain.update(p, 25);
    const total = Math.max(1, pending + this.terrain.chunkCount);
    let guard = 0;
    while (pending > 0 && guard++ < 2000) {
      pending = this.terrain.update(p, 30);
      onProgress?.(0.05 + 0.55 * (1 - pending / total), 'Shaping the land…');
      await new Promise((r) => setTimeout(r, 0));
    }
    onProgress?.(0.62, 'Raising cities and temples…');
    await new Promise((r) => setTimeout(r, 0));
    this.ensureRegionsAround(p);
    // Environment systems (vegetation, grass...) populate around the spawn.
    const pre = this.updatables.filter((u) => u.preload);
    if (pre.length) {
      let envPending = 0;
      for (const u of pre) envPending += u.preload!(p, 25);
      const envTotal = Math.max(1, envPending);
      guard = 0;
      while (envPending > 0 && guard++ < 2000) {
        envPending = 0;
        for (const u of pre) envPending += u.preload!(p, 30);
        onProgress?.(0.66 + 0.28 * (1 - envPending / envTotal), 'Growing forests and meadows…');
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.(0.95, 'Breathing life into the world…');
    await new Promise((r) => setTimeout(r, 0));
  }

  onSessionStart(): void {
    for (const r of this.regions) if (this.builtRegions.has(r.id)) r.onSessionStart?.(this.ctx);
  }

  onSessionEnd(): void {
    for (const r of this.regions) if (this.builtRegions.has(r.id)) r.onSessionEnd?.(this.ctx);
    this.collision.clearDynamic();
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.focus.copy(focus);
    envUniforms.uEnvTime.value = (envUniforms.uEnvTime.value + dt) % 3600;
    this.terrain.update(focus, 3);
    this.ensureRegionsAround(focus);
    const cam = this.ctx.camera;
    this.sky.update(dt, cam, this.ctx.settings.data.graphics.drawDistance);
    this.water.update(dt, cam, this.ctx.render.sunDir, this.sky.horizonColor, this.sky.sunColor);
    for (const r of this.regions) {
      if (!this.builtRegions.has(r.id)) continue;
      const d = Math.hypot(focus.x - r.center.x, focus.z - r.center.z);
      r.setDetail?.(d < r.loadRadius ? 'full' : d < r.loadRadius * 3 ? 'far' : 'hidden');
      if (d < r.loadRadius * 1.5) r.update?.(dt, this.ctx);
    }
    for (const u of this.updatables) u.update(dt, this.ctx, focus);
    if (this.ctx.session.active) this.updateDiscovery(focus);
  }

  /** Update while in menus (sky/water animation only). */
  updateAmbient(dt: number, focus: THREE.Vector3): void {
    this.focus.copy(focus);
    envUniforms.uEnvTime.value = (envUniforms.uEnvTime.value + dt) % 3600;
    this.terrain.update(focus, 2);
    const cam = this.ctx.camera;
    this.sky.update(dt, cam, this.ctx.settings.data.graphics.drawDistance);
    this.water.update(dt, cam, this.ctx.render.sunDir, this.sky.horizonColor, this.sky.sunColor);
    for (const u of this.updatables) u.update(dt, this.ctx, focus);
  }

  private discoveryTimer = 0;
  private updateDiscovery(p: THREE.Vector3): void {
    this.discoveryTimer -= 1;
    if (this.discoveryTimer > 0) return;
    this.discoveryTimer = 15;
    const region = this.regionAt(p.x, p.z);
    if (region && region !== this.currentRegion) {
      this.currentRegion = region;
      this.visitedRegions.add(region.id);
      this.ctx.events.emit('region:entered', { regionId: region.id, name: region.name });
    }
    for (const l of LANDMARKS) {
      if (this.discovered.has(l.id)) continue;
      const d = Math.hypot(p.x - l.x, p.z - l.z);
      if (d < l.discoverRadius) {
        this.discovered.add(l.id);
        this.ctx.events.emit('location:discovered', { locationId: l.id, name: l.name });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Terrain-only height. */
  heightAt(x: number, z: number): number {
    return heightAt(x, z);
  }

  /** Ground below (x, maxY, z): terrain, frozen water surface or walkable colliders. */
  groundAt(x: number, z: number, maxY = Infinity): GroundSample {
    const th = heightAt(x, z);
    let y = th;
    let surface: SurfaceType | null = null;
    let colliderId = 0;
    const w = waterAt(x, z, th);
    if (w && w.frozen && w.level + ICE_TOP > y) {
      y = w.level + ICE_TOP;
      surface = 'ice';
    }
    const c = this.collision.groundAt(x, z, maxY);
    if (c && c.y > y - 0.05) {
      y = c.y;
      surface = c.surface;
      colliderId = c.colliderId;
    }
    if (colliderId) return { y, surface: surface!, nx: 0, ny: 1, nz: 0, colliderId };
    const n = normalAt(x, z, 0.75, this.tmpN);
    if (!surface) surface = w ? (w.frozen ? 'ice' : 'water') : terrainSurfaceAt(x, z, th, n.y);
    return { y, surface, nx: n.x, ny: n.y, nz: n.z, colliderId: 0 };
  }

  liquidAt(x: number, z: number): { level: number } | null {
    const w = waterAt(x, z);
    if (!w || w.frozen) return null;
    return w;
  }

  waterAt(x: number, z: number): WaterHit | null {
    return waterAt(x, z);
  }

  resolveWalls(pos: THREE.Vector3, radius: number, height: number, stepUp: number): boolean {
    return this.collision.resolveCylinder(pos, radius, height, stepUp);
  }

  surfaceAt(x: number, z: number, y?: number): SurfaceType {
    return this.groundAt(x, z, y === undefined ? Infinity : y + 0.5).surface;
  }

  biomeAt(x: number, z: number): BiomeId {
    return biomeAt(x, z);
  }

  /** Region containing (x,z) — nearest region whose radius covers the point. */
  regionAt(x: number, z: number): RegionDef | null {
    return regionAt(x, z);
  }

  landmark(id: string): LandmarkDef | undefined {
    return LANDMARKS.find((l) => l.id === id);
  }

  /**
   * Raycast against terrain (marching) and colliders. Returns nearest hit.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { distance: number; point: THREE.Vector3; colliderId: number } | null {
    const colHit = this.collision.raycast(origin, dir, maxDist);
    const limit = colHit ? colHit.distance : maxDist;
    // Terrain march (coarse then refine).
    let prevT = 0;
    let step = 1.5;
    for (let t = step; t <= limit; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < heightAt(x, z)) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 8; i++) {
          const m = (lo + hi) / 2;
          const mx = origin.x + dir.x * m, my = origin.y + dir.y * m, mz = origin.z + dir.z * m;
          if (my < heightAt(mx, mz)) hi = m;
          else lo = m;
        }
        return { distance: hi, point: origin.clone().addScaledVector(dir, hi), colliderId: 0 };
      }
      prevT = t;
      step = Math.min(6, step * 1.15);
    }
    if (colHit) return { distance: colHit.distance, point: colHit.point, colliderId: colHit.colliderId };
    return null;
  }

  /** Line of sight between two points (terrain + solid colliders). */
  hasLineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = b.clone().sub(a);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.divideScalar(dist);
    const hit = this.raycast(a, dir, dist - 0.2);
    return !hit;
  }

  // ---------------------------------------------------------------------------
  // Persistence (discoveries)
  // ---------------------------------------------------------------------------

  serialize(): unknown {
    return { discovered: [...this.discovered], visited: [...this.visitedRegions], time: this.sky?.timeOfDay ?? 9 };
  }

  deserialize(data: any): void {
    if (!data) return;
    if (Array.isArray(data.discovered)) for (const id of data.discovered) if (typeof id === 'string') this.discovered.add(id);
    if (Array.isArray(data.visited)) for (const id of data.visited) if (typeof id === 'string') this.visitedRegions.add(id);
    if (typeof data.time === 'number' && this.sky) this.sky.timeOfDay = data.time % 24;
  }

  reset(): void {
    this.discovered.clear();
    this.visitedRegions.clear();
    this.currentRegion = null;
    if (this.sky) this.sky.timeOfDay = 9.5;
  }

  dispose(): void {
    for (const r of this.regions) if (this.builtRegions.has(r.id)) r.dispose(this.ctx);
    for (const u of this.updatables) u.dispose?.();
    this.terrain.dispose();
    this.water.dispose();
    this.sky.dispose();
  }
}
