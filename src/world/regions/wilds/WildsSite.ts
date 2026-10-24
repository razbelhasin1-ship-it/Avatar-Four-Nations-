import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { RegionContent } from '../../RegionContent';
import type { P2 } from '../../WorldLayout';
import { ContentBuilder } from '../../kit/Builder';
import type { Emitter } from '../../../vfx/VFX';
import { acquireWildsMaterials, releaseWildsMaterials } from './materials';

/**
 * Base class for the hand-assembled places between the capitals (Omashu,
 * Kyoshi Island, Misty Palms, the Buried Library, the Great Banyan Tree, the
 * northern outposts, the Badgermole Caves, road bridges, inns, farms, camps).
 *
 * Three builders share the region group:
 *  - `major`   silhouettes (walls, terraces, buildings, bridges) — kept at 'far'
 *  - `detail`  props (crates, lanterns, stalls, fences) — hidden at 'far'
 *  - `clutter` purely decorative, never collides — hidden on the Low preset
 * Colliders never depend on detail level or quality settings.
 */

const REGISTRY = new Map<string, WildsSite>();

export function wildsSites(): WildsSite[] {
  return [...REGISTRY.values()];
}

export interface FireSpot {
  pos: THREE.Vector3;
  emitter: Emitter | null;
  smoke: Emitter | null;
  scale: number;
}

export abstract class WildsSite implements RegionContent {
  abstract readonly id: string;
  abstract readonly center: P2;
  readonly loadRadius: number = 320;
  readonly group = new THREE.Group();
  protected ctx!: GameContext;
  major!: ContentBuilder;
  detail!: ContentBuilder;
  clutter!: ContentBuilder;
  protected readonly majorGroup = new THREE.Group();
  protected readonly detailGroup = new THREE.Group();
  protected readonly clutterGroup = new THREE.Group();
  /** Named points recorded by the builders (tests / debug). */
  readonly marks: Record<string, { x: number; y: number; z: number }> = {};
  /** Water sources this site registered (unregistered on dispose). */
  readonly waterIds: string[] = [];
  /** Fires (camp fires, braziers) — particle emitters run only while the player is near. */
  protected readonly fires: FireSpot[] = [];
  /** Extra objects/resources owned by the site (disposed on dispose). */
  protected readonly owned: Array<{ dispose(): void }> = [];
  buildMs = 0;
  private level: 'full' | 'far' | 'hidden' = 'full';
  private offSettings: (() => void) | null = null;
  protected built = false;

  /** Build all static content (called once from build()). */
  protected abstract construct(ctx: GameContext): void;

  build(ctx: GameContext): void {
    this.ctx = ctx;
    this.group.name = `wilds_${this.id}`;
    this.majorGroup.name = 'major';
    this.detailGroup.name = 'detail';
    this.clutterGroup.name = 'clutter';
    this.group.add(this.majorGroup, this.detailGroup, this.clutterGroup);
    acquireWildsMaterials();
    const tag = `wilds:${this.id}`;
    this.major = new ContentBuilder(ctx, this.majorGroup, tag);
    this.detail = new ContentBuilder(ctx, this.detailGroup, tag);
    this.clutter = new ContentBuilder(ctx, this.clutterGroup, tag);
    const t0 = performance.now();
    this.construct(ctx);
    this.major.finish();
    this.detail.finish();
    this.clutter.finish();
    for (const o of this.clutterGroup.children) o.castShadow = false;
    this.buildMs = performance.now() - t0;
    this.applyQuality();
    this.offSettings = ctx.events.on('settings:changed', () => this.applyQuality());
    REGISTRY.set(this.id, this);
    installDebug();
    this.built = true;
  }

  /** Low preset hides decorative clutter (never colliders). */
  private applyQuality(): void {
    const g = this.ctx.settings.data.graphics;
    this.clutterGroup.visible = this.level === 'full' && g.foliageDensity >= 0.6;
  }

  setDetail(level: 'full' | 'far' | 'hidden'): void {
    if (level === this.level) return;
    this.level = level;
    this.group.visible = level !== 'hidden';
    this.detailGroup.visible = level === 'full';
    this.applyQuality();
    this.onDetail?.(level);
  }

  protected onDetail?(level: 'full' | 'far' | 'hidden'): void;

  get detailLevel(): 'full' | 'far' | 'hidden' {
    return this.level;
  }

  mark(name: string, x: number, y: number, z: number): void {
    this.marks[name] = { x, y, z };
  }

  /** Register a water source owned by this site. */
  protected water(def: Parameters<GameContext['water']['register']>[0]): void {
    this.ctx.water.register(def);
    this.waterIds.push(def.id);
  }

  /** Kit water surface (mesh + registered source). */
  protected waterSurface(o: Parameters<ContentBuilder['waterSurface']>[0]): THREE.Mesh {
    const m = this.detail.waterSurface(o);
    this.waterIds.push(o.id);
    return m;
  }

  protected addFire(x: number, y: number, z: number, scale = 1): void {
    this.fires.push({ pos: new THREE.Vector3(x, y, z), emitter: null, smoke: null, scale });
  }

  update(dt: number, ctx: GameContext): void {
    const p = ctx.player?.position;
    if (p && this.fires.length) {
      const fx = ctx.settings.data.graphics.particleDensity > 0;
      for (const f of this.fires) {
        const near = fx && this.level === 'full' && Math.hypot(p.x - f.pos.x, p.z - f.pos.z) < 110;
        if (near && !f.emitter) {
          f.emitter = ctx.vfx.emitter('flame', 7 * f.scale, { radius: 0.25 * f.scale, speed: 1.1, size: 0.55 * f.scale });
          f.emitter.position.copy(f.pos);
          f.smoke = ctx.vfx.emitter('smoke', 1.2 * f.scale, { radius: 0.2, speed: 0.8, size: 0.9 * f.scale });
          f.smoke.position.copy(f.pos).y += 0.9;
        } else if (!near && f.emitter) {
          f.emitter.stop();
          f.smoke?.stop();
          f.emitter = f.smoke = null;
        }
      }
    }
    this.tick?.(dt, ctx);
  }

  protected tick?(dt: number, ctx: GameContext): void;

  onSessionStart(_ctx: GameContext): void {
    for (const f of this.fires) f.emitter = f.smoke = null;
  }

  onSessionEnd(_ctx: GameContext): void {
    for (const f of this.fires) {
      f.emitter?.stop();
      f.smoke?.stop();
      f.emitter = f.smoke = null;
    }
  }

  stats(): Record<string, unknown> {
    let meshes = 0, tris = 0, instances = 0;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      const g = m.geometry;
      const n = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      const k = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : 1;
      instances += k > 1 ? k : 0;
      tris += n * k;
    });
    return {
      id: this.id,
      built: this.built,
      buildMs: Math.round(this.buildMs * 10) / 10,
      meshes,
      triangles: Math.round(tris),
      instances,
      colliders: this.major.colliderIds.length + this.detail.colliderIds.length + this.clutter.colliderIds.length,
      water: [...this.waterIds],
      detail: this.level,
    };
  }

  dispose(ctx: GameContext): void {
    this.onSessionEnd(ctx);
    this.offSettings?.();
    this.offSettings = null;
    this.major?.dispose();
    this.detail?.dispose();
    this.clutter?.dispose();
    for (const id of this.waterIds) ctx.water.unregister(id);
    this.waterIds.length = 0;
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.group.removeFromParent();
    this.group.clear();
    if (this.built) releaseWildsMaterials();
    this.built = false;
    REGISTRY.delete(this.id);
  }
}

/** window.__game.debug.wilds: site stats, marks, spots. */
function installDebug(): void {
  const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
  if (!g || !g.debug || g.debug.wilds) return;
  g.debug.wilds = {
    sites: () => wildsSites().map((s) => s.stats()),
    site: (id: string) => REGISTRY.get(id) ?? null,
    marks: (id: string) => (REGISTRY.get(id) ? JSON.parse(JSON.stringify(REGISTRY.get(id)!.marks)) : null),
  };
}
