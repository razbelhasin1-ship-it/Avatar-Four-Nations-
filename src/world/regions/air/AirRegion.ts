import * as THREE from 'three';
import type { WaterSourceDef } from '../../../combat/WaterSources';
import type { GameContext } from '../../../core/GameContext';
import type { Emitter, ParticlePreset } from '../../../vfx/VFX';
import { ContentBuilder } from '../../kit/Builder';
import type { RegionContent } from '../../RegionContent';
import { allSpots } from '../../Spots';
import type { P2 } from '../../WorldLayout';
import { acquireAirMaterials, airMaterialIfCreated, releaseAirMaterials } from './materials';
import type { Kit } from './parts';

/**
 * Base class for the Air Nomad region modules (Southern Air Temple summit,
 * the switchback trail, the Shrine of the Four Winds).
 *
 * Content is organised in spatial *zones* (districts). Each zone owns three
 * kit ContentBuilders, merged per material at finish():
 *   - main:  architecture and big silhouettes — stays visible at 'far' detail
 *   - props: lanterns, balusters, windows, hay, trees — hidden when far or when
 *            the camera is beyond the zone's prop range
 *   - extra: optional clutter (cushions, flag strings on low) — also hidden on
 *            low foliage settings
 * Colliders never depend on quality settings or detail level.
 */

interface Zone {
  name: string;
  kit: Kit;
  builders: ContentBuilder[];
  groups: { main: THREE.Group; props: THREE.Group; extra: THREE.Group };
  center: P2;
  radius: number;
  /** Main group stays visible at 'far' detail. */
  far: boolean;
}

/** Ambient particle site (updraft wisps, waterfall spray, shrine winds). */
export interface AmbientSite {
  x: number;
  y: number;
  z: number;
  preset: ParticlePreset;
  rate: number;
  /** Emit only while the camera is within this distance. */
  range: number;
  dir?: THREE.Vector3;
  speed?: number;
  size?: number;
  radius?: number;
  swirl?: number;
  spread?: number;
}

const REGISTRY = new Map<string, AirRegion>();

/** Extra debug hooks contributed by region modules (e.g. trail sampling). */
export const AIR_DEBUG_EXTRAS: Record<string, unknown> = {};

function installDebug(): void {
  const g = (globalThis as any).__game;
  if (!g || !g.debug) return;
  g.debug.air = {
    regions: () => [...REGISTRY.values()].map((r) => r.stats()),
    region: (id: string) => REGISTRY.get(id) ?? null,
    spots: () => Object.fromEntries(allSpots().filter(([, s]) => s.region === 'southern_air_temple')),
    ...AIR_DEBUG_EXTRAS,
  };
}

/** Ids of the regions whose module is loaded (for tests even before build). */
export function airRegionStats(): unknown[] {
  return [...REGISTRY.values()].map((r) => r.stats());
}

export abstract class AirRegion implements RegionContent {
  abstract readonly id: string;
  abstract readonly center: P2;
  abstract readonly loadRadius: number;
  readonly group = new THREE.Group();
  protected ctx!: GameContext;
  private readonly zones: Zone[] = [];
  private readonly ownedObjects: THREE.Object3D[] = [];
  private readonly ownedGeos = new Set<THREE.BufferGeometry>();
  private readonly ownedMats: THREE.Material[] = [];
  readonly waterIds: string[] = [];
  private detail: 'full' | 'far' | 'hidden' = 'full';
  private offSettings: (() => void) | null = null;
  private built = false;
  private cullTimer = 0;
  private readonly ambientSites: AmbientSite[] = [];
  private readonly liveEmitters = new Map<AmbientSite, Emitter>();
  private ambientTimer = 0;
  buildMs = 0;
  finishMs = 0;
  /** Distance (m) within which a zone's props are drawn (scaled by settings). */
  protected propRange = 170;

  /** Per-part construction timings (ms). */
  readonly timings: Record<string, number> = {};
  private queue: Array<[string, () => void]> = [];
  private finishQueue: Zone[] | null = null;
  private building = false;

  /**
   * Build: when the focus is close (spawn / loading screen) everything is
   * constructed at once; otherwise construction is time-sliced over the next
   * frames (a few ms each) so walking into the region never hitches.
   */
  build(ctx: GameContext): void {
    this.ctx = ctx;
    this.group.name = `region_${this.id}`;
    acquireAirMaterials();
    this.queue = this.parts(ctx);
    this.building = true;
    REGISTRY.set(this.id, this);
    installDebug();
    const f = ctx.world.focus;
    const d = Math.hypot(f.x - this.center.x, f.z - this.center.z);
    this.pump(d < this.loadRadius * 0.55 ? Infinity : 6);
  }

  /** Construction work split into named parts (run in order). */
  protected abstract parts(ctx: GameContext): Array<[string, () => void]>;

  /** Run queued parts (then merge zones) within a time budget in ms. */
  private pump(budget: number): void {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budget) {
      const [name, fn] = this.queue.shift()!;
      const t = performance.now();
      fn();
      const ms = performance.now() - t;
      this.timings[name] = +ms.toFixed(1);
      this.buildMs += ms;
    }
    if (this.queue.length) return;
    if (!this.finishQueue) this.finishQueue = [...this.zones];
    while (this.finishQueue.length && performance.now() - t0 < budget) {
      const t = performance.now();
      const z = this.finishQueue.shift()!;
      for (const b of z.builders) b.finish();
      // Only architecture casts shadows; small props would cost a second pass for little gain.
      z.groups.props.traverse((o) => (o.castShadow = false));
      z.groups.extra.traverse((o) => (o.castShadow = false));
      const ms = performance.now() - t;
      this.finishMs += ms;
      this.buildMs += ms;
    }
    if (this.finishQueue.length) return;
    this.building = false;
    this.built = true;
    this.applySettings();
    this.offSettings = this.ctx.events.on('settings:changed', () => this.applySettings());
    installDebug();
  }

  /** True while time-sliced construction is still running. */
  get constructing(): boolean {
    return this.building;
  }

  /** Per-frame hook while the player is near. */
  protected animate(_dt: number, _ctx: GameContext): void {}

  // ---------------------------------------------------------------------------
  // Construction helpers
  // ---------------------------------------------------------------------------

  /**
   * New spatial zone with its builders. Zones naming the same `district`
   * share one set of builders (fewer draw calls); the district's culling
   * circle grows to cover all its zones.
   */
  protected zone(name: string, center: P2, radius: number, o: { far?: boolean; district?: string } = {}): Kit {
    if (o.district) {
      const d = this.zones.find((z) => z.name === o.district);
      if (d) {
        // Grow the bounding circle to include this zone.
        const dist = Math.hypot(center.x - d.center.x, center.z - d.center.z);
        if (dist + radius > d.radius) {
          const r = (d.radius + dist + radius) / 2;
          const t = dist > 1e-6 ? (r - d.radius) / dist : 0;
          d.center = { x: d.center.x + (center.x - d.center.x) * t, z: d.center.z + (center.z - d.center.z) * t };
          d.radius = r;
        }
        return d.kit;
      }
      name = o.district;
    }
    const root = new THREE.Group();
    root.name = `${this.id}:${name}`;
    this.group.add(root);
    const groups = { main: new THREE.Group(), props: new THREE.Group(), extra: new THREE.Group() };
    groups.main.name = `${name}:main`;
    groups.props.name = `${name}:props`;
    groups.extra.name = `${name}:extra`;
    root.add(groups.main, groups.props, groups.extra);
    const main = new ContentBuilder(this.ctx, groups.main, this.id);
    const props = new ContentBuilder(this.ctx, groups.props, this.id);
    const extra = new ContentBuilder(this.ctx, groups.extra, this.id);
    const kit: Kit = {
      ctx: this.ctx,
      main,
      props,
      extra,
      addMesh: (mesh, g = 'main') => this.own(mesh, groups[g]),
      registerWater: (def) => this.water(def),
    };
    this.zones.push({ name, kit, builders: [main, props, extra], groups, center, radius, far: o.far ?? true });
    return kit;
  }

  /** Track a custom object (added under `parent`) for disposal. */
  protected own<T extends THREE.Object3D>(obj: T, parent: THREE.Object3D = this.group): T {
    parent.add(obj);
    this.ownedObjects.push(obj);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) this.ownedGeos.add(m.geometry);
    });
    return obj;
  }

  /** Track a material created by this region (not the shared caches). */
  protected ownMaterial<T extends THREE.Material>(m: T): T {
    this.ownedMats.push(m);
    return m;
  }

  /** Register a water source owned by this region (unregistered on dispose). */
  protected water(def: WaterSourceDef): string {
    this.ctx.water.register(def);
    this.waterIds.push(def.id);
    return def.id;
  }

  /** Ambient particle site, emitted only near the camera and with ambient effects on. */
  protected ambient(site: AmbientSite): void {
    this.ambientSites.push(site);
  }

  private updateAmbient(dt: number, ctx: GameContext): void {
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 0.5;
    const on = ctx.settings.data.graphics.ambientEffects && this.detail === 'full' && ctx.session.active;
    const cam = ctx.camera.position;
    const want = new Set<AmbientSite>();
    if (on) {
      const ranked = this.ambientSites
        .map((s) => ({ s, d: Math.hypot(cam.x - s.x, cam.y - s.y, cam.z - s.z) }))
        .filter((e) => e.d < e.s.range)
        .sort((a, b) => a.d - b.d)
        .slice(0, 6);
      for (const e of ranked) want.add(e.s);
    }
    for (const [site, em] of this.liveEmitters) {
      if (!want.has(site) || !em.active) {
        em.stop();
        this.liveEmitters.delete(site);
      }
    }
    for (const s of want) {
      if (this.liveEmitters.has(s)) continue;
      const em = ctx.vfx.emitter(s.preset, s.rate, { size: s.size, speed: s.speed, dir: s.dir, radius: s.radius, swirl: s.swirl, spread: s.spread });
      em.position.set(s.x, s.y, s.z);
      if (s.dir) em.direction.copy(s.dir);
      this.liveEmitters.set(s, em);
    }
  }

  private stopAmbient(): void {
    for (const em of this.liveEmitters.values()) em.stop();
    this.liveEmitters.clear();
  }

  // ---------------------------------------------------------------------------
  // RegionContent
  // ---------------------------------------------------------------------------

  setDetail(level: 'full' | 'far' | 'hidden'): void {
    if (level === this.detail) return;
    this.detail = level;
    this.applyVisibility();
  }

  get detailLevel(): string {
    return this.detail;
  }

  private applySettings(): void {
    const g = this.ctx.settings.data.graphics;
    this.propRange = Math.max(110, Math.min(260, g.drawDistance * 0.35));
    this.applyVisibility();
  }

  private extrasAllowed(): boolean {
    return (this.ctx?.settings.data.graphics.foliageDensity ?? 1) >= 0.75;
  }

  private applyVisibility(): void {
    this.group.visible = this.detail !== 'hidden';
    const extraOk = this.extrasAllowed();
    for (const z of this.zones) {
      z.groups.main.visible = this.detail === 'full' || z.far;
      const near = this.detail === 'full';
      z.groups.props.visible = near && z.groups.props.visible;
      z.groups.extra.visible = near && extraOk && z.groups.extra.visible;
      if (near) this.cullTimer = 0; // re-evaluate distance culling next frame
    }
    if (this.detail === 'full') this.cullZones(true);
  }

  /** Hide props/extras of zones far from the camera. */
  private cullZones(force = false): void {
    if (!this.built || this.detail !== 'full') return;
    const cam = this.ctx.camera.position;
    const extraOk = this.extrasAllowed();
    for (const z of this.zones) {
      const d = Math.hypot(cam.x - z.center.x, cam.z - z.center.z) - z.radius;
      const propsVis = d < this.propRange;
      const extraVis = extraOk && d < this.propRange * 0.6;
      if (force || z.groups.props.visible !== propsVis) z.groups.props.visible = propsVis;
      if (force || z.groups.extra.visible !== extraVis) z.groups.extra.visible = extraVis;
    }
  }

  update(dt: number, ctx: GameContext): void {
    if (this.building) {
      this.pump(6);
      return;
    }
    this.cullTimer -= dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.4;
      this.cullZones();
    }
    // Windows glow warm at dusk and night.
    const win = airMaterialIfCreated('window') as THREE.MeshStandardMaterial | undefined;
    if (win) {
      const h = ctx.world.sky.timeOfDay;
      const night = h < 6 ? 1 : h < 7.5 ? 1 - (h - 6) / 1.5 : h > 19 ? 1 : h > 17.5 ? (h - 17.5) / 1.5 : 0;
      win.emissiveIntensity = 0.15 + night * 1.4;
    }
    this.updateAmbient(dt, ctx);
    this.animate(dt, ctx);
  }

  onSessionStart(ctx: GameContext): void {
    this.sessionStart(ctx);
  }

  onSessionEnd(ctx: GameContext): void {
    this.stopAmbient();
    this.sessionEnd(ctx);
  }

  protected sessionStart(_ctx: GameContext): void {}
  protected sessionEnd(_ctx: GameContext): void {}

  stats(): Record<string, unknown> {
    let colliders = 0;
    let meshes = 0;
    let tris = 0;
    for (const z of this.zones) {
      for (const b of z.builders) {
        colliders += b.colliderIds.length;
        meshes += b.meshes.length;
        for (const m of b.meshes) {
          const mesh = m as THREE.Mesh;
          const g = mesh.geometry;
          if (!g) continue;
          const n = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
          tris += n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
        }
      }
    }
    return {
      id: this.id,
      built: this.built,
      buildMs: +this.buildMs.toFixed(1),
      finishMs: +this.finishMs.toFixed(1),
      constructing: this.building,
      timings: this.timings,
      detail: this.detail,
      zones: this.zones.map((z) => ({ name: z.name, props: z.groups.props.visible, extra: z.groups.extra.visible, main: z.groups.main.visible })),
      colliders,
      meshes: meshes + this.ownedObjects.length,
      triangles: Math.round(tris),
      water: [...this.waterIds],
    };
  }

  dispose(ctx: GameContext): void {
    this.stopAmbient();
    this.ambientSites.length = 0;
    this.offSettings?.();
    this.offSettings = null;
    for (const id of this.waterIds) ctx.water.unregister(id);
    this.waterIds.length = 0;
    for (const z of this.zones) for (const b of z.builders) b.dispose();
    this.zones.length = 0;
    for (const o of this.ownedObjects) o.removeFromParent();
    this.ownedObjects.length = 0;
    for (const g of this.ownedGeos) g.dispose();
    this.ownedGeos.clear();
    for (const m of this.ownedMats) m.dispose();
    this.ownedMats.length = 0;
    this.group.clear();
    if (this.built || this.building) releaseAirMaterials();
    this.built = false;
    this.building = false;
    this.queue = [];
    this.finishQueue = null;
    REGISTRY.delete(this.id);
  }
}
