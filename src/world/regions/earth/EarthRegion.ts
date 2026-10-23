import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { Random } from '../../../core/Random';
import type { NPCDef } from '../../../npc/NPCTypes';
import type { RegionContent } from '../../RegionContent';
import type { P2 } from '../../WorldLayout';
import type { ContentBuilder } from '../../kit/Builder';
import { buildArchetypes } from './archetypes';
import { acquireHouseAtlas, releaseHouseAtlas } from './atlas';
import { ChunkSet, type LodRanges } from './chunks';
import { Exclusions, type BuildEnv } from './env';
import { acquireEarthMaterials, releaseEarthMaterials } from './materials';
import { EARTH_SPOTS } from './spots';

/**
 * Base class for the Earth Kingdom settlements (Ba Sing Se, Gaoling,
 * Riverbend). Content is authored into a ChunkSet (spatial chunks with
 * distance LOD); construction is a generator so a city streamed in while the
 * player walks toward it is built in time slices (a few ms per frame), while a
 * spawn/fast-travel inside it builds synchronously during the loading screen.
 *
 * Detail levels: 'full' = distance LOD per chunk kind; 'far' = only 'major'
 * chunks (walls, gatehouses, palace, viaducts); 'hidden' = nothing.
 * Colliders never depend on detail or quality settings.
 */

const REGISTRY = new Map<string, EarthRegion>();

/** Materials whose shadows are too small to matter at low shadow quality. */
const SMALL_SHADOW = /gold|bronze|banner|plaque|lantern|iron|cloth|rope|jade|wood_red|wood_dark|crate|reed/;

export function earthRegions(): EarthRegion[] {
  return [...REGISTRY.values()];
}

/** window.__game.debug.earth: region stats, region objects (marks, chunks) and published spots. */
function installDebug(): void {
  const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
  if (!g || !g.debug || g.debug.earth) return;
  g.debug.earth = {
    regions: () => earthRegions().map((r) => r.stats()),
    region: (id: string) => REGISTRY.get(id) ?? null,
    spots: () => EARTH_SPOTS,
  };
}

export abstract class EarthRegion implements RegionContent {
  abstract readonly id: string;
  abstract readonly center: P2;
  abstract readonly loadRadius: number;
  readonly group = new THREE.Group();
  protected ctx!: GameContext;
  env!: BuildEnv;
  chunks!: ChunkSet;
  buildMs = 0;
  /** Named points recorded by the builders (tests / debug). */
  readonly marks: Record<string, { x: number; y: number; z: number }> = {};
  protected readonly npcDefs: NPCDef[] = [];
  private detail: 'full' | 'far' | 'hidden' = 'full';
  private pending: Iterator<unknown> | null = null;
  private finished = false;
  private lodTimer = 0;
  private offSettings: (() => void) | null = null;
  private interactOffs: Array<() => void> = [];
  private lod: LodRanges = { houses: 600, props: 170, detail: 90 };
  private built = false;

  /** Seed for deterministic placement. */
  protected abstract readonly seed: number;
  /** Chunk cell size (m). */
  protected readonly cell: number = 128;

  /** Build everything; yield between districts so construction can be time-sliced. */
  protected abstract construct(env: BuildEnv): Generator<unknown, void, unknown>;

  build(ctx: GameContext): void {
    this.ctx = ctx;
    this.group.name = `region_${this.id}`;
    const t0 = performance.now();
    this.chunks = new ChunkSet(ctx, this.group, this.id, this.cell);
    const steps = this.allSteps();
    const p = ctx.player?.position;
    const near = !p || Math.hypot(p.x - this.center.x, p.z - this.center.z) < this.loadRadius * 0.7;
    if (near) {
      while (!steps.next().done);
    } else {
      // Streamed in from afar: build a few ms per frame in update() (atlas painting included).
      this.pending = steps;
    }
    this.applySettings();
    this.offSettings = ctx.events.on('settings:changed', () => this.applySettings());
    this.buildMs = performance.now() - t0;
    REGISTRY.set(this.id, this);
    installDebug();
  }

  private *allSteps(): Generator<unknown, void, unknown> {
    const ctx = this.ctx;
    const mats = acquireEarthMaterials();
    const atlas = acquireHouseAtlas();
    this.built = true;
    yield;
    this.env = {
      ctx,
      chunks: this.chunks,
      mats,
      atlas,
      arch: buildArchetypes(atlas),
      rnd: new Random(this.seed),
      excl: new Exclusions(),
      decor: Math.max(0.3, Math.min(1.5, ctx.settings.data.graphics.foliageDensity)),
      waterIds: [],
      interactables: [],
      animated: [],
    };
    yield* this.construct(this.env);
    yield* this.chunks.finishSteps(this.env.atlas.material);
    this.finished = true;
    this.liftPlayerOut();
    this.applyShadows();
    this.updateLod(true);
    // Built after the session started (streamed in): register NPCs and interactions now.
    if (this.pending && ctx.session.active) this.onSessionStart(ctx);
  }

  /**
   * Shadow casting by quality: big silhouettes (walls, roofs, houses) always cast
   * when shadows are on; small trims and props only on medium/high shadow quality.
   */
  private applyShadows(): void {
    if (!this.chunks || !this.finished) return;
    const g = this.ctx.settings.data.graphics;
    const rich = g.shadows === 'medium' || g.shadows === 'high';
    for (const c of this.chunks.chunks) {
      for (const o of c.group.children) {
        const m = o as THREE.Mesh;
        if (m.userData.cs0 === undefined) m.userData.cs0 = m.castShadow;
        const name = (m.material as THREE.Material | undefined)?.name ?? '';
        const small = SMALL_SHADOW.test(name);
        const allowed = c.kind === 'houses' ? true : c.kind === 'major' ? rich || !small : rich && !small;
        m.castShadow = !!m.userData.cs0 && allowed;
      }
    }
  }

  /** True while deferred construction is still running. */
  get building(): boolean {
    return !this.finished;
  }

  /**
   * If the player stands inside one of our walkable solids (arrived before the
   * region streamed in), put them on top instead of letting the push-out shove
   * them sideways.
   */
  private liftPlayerOut(): void {
    const pl = this.ctx.player;
    if (!pl) return;
    const pos = pl.position;
    const col = this.ctx.world.collision;
    let top = -Infinity;
    col.query(pos.x, pos.z, 0.3, (c) => {
      if (c.tag !== this.id || !c.solid || !c.walkable) return;
      const t = col.topAt(c, pos.x, pos.z);
      if (t === -Infinity) return;
      if (pos.y > c.y - c.hy - 0.5 && pos.y < t - 0.05) top = Math.max(top, t);
    });
    if (top > -Infinity && top - pos.y < 60) pl.teleport(new THREE.Vector3(pos.x, top + 0.05, pos.z));
  }

  // ---------------------------------------------------------------------------
  // Helpers for subclasses
  // ---------------------------------------------------------------------------

  /** Register a water surface (kit) and remember its id for disposal. */
  water(b: ContentBuilder, o: Parameters<ContentBuilder['waterSurface']>[0]): THREE.Mesh {
    const m = b.waterSurface(o);
    this.env.waterIds.push(o.id);
    return m;
  }

  mark(id: string, x: number, y: number, z: number): void {
    this.marks[id] = { x, y, z };
  }

  npc(def: NPCDef): void {
    this.npcDefs.push(def);
  }

  // ---------------------------------------------------------------------------
  // RegionContent
  // ---------------------------------------------------------------------------

  setDetail(level: 'full' | 'far' | 'hidden'): void {
    if (level === this.detail) return;
    this.detail = level;
    this.chunks?.setLevel(level);
    this.updateLod(true);
  }

  get detailLevel(): string {
    return this.detail;
  }

  private applySettings(): void {
    const g = this.ctx.settings.data.graphics;
    const low = g.preset === 'low' || g.drawDistance < 500;
    this.lod = {
      houses: Math.max(320, Math.min(g.shadows === 'high' ? 900 : 520, g.drawDistance * 0.9)),
      props: low ? 120 : 150,
      detail: low ? 60 : 90,
    };
    this.applyShadows();
    this.updateLod(true);
  }

  private updateLod(_force = false): void {
    if (!this.chunks || !this.finished) return;
    const cam = this.ctx.camera?.position ?? this.ctx.player?.position;
    if (!cam) return;
    this.chunks.updateLod(cam, this.lod);
  }

  update(dt: number, ctx: GameContext): void {
    if (this.pending) {
      const t0 = performance.now();
      while (performance.now() - t0 < 5) {
        if (this.pending.next().done) {
          this.pending = null;
          break;
        }
      }
    }
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 0.25;
      this.updateLod();
    }
    if (this.detail === 'full' && this.env?.animated.length) {
      const t = ctx.time.elapsed;
      for (const a of this.env.animated) a(dt, t);
    }
  }

  onSessionStart(ctx: GameContext): void {
    if (!this.env || !this.finished) return;
    for (const d of this.npcDefs) ctx.npcs.addDef(d);
    for (const off of this.interactOffs) off();
    this.interactOffs = this.env.interactables.map((i) => ctx.interactions.register(i));
  }

  onSessionEnd(_ctx: GameContext): void {
    for (const off of this.interactOffs) off();
    this.interactOffs = [];
  }

  dispose(ctx: GameContext): void {
    this.onSessionEnd(ctx);
    this.offSettings?.();
    this.offSettings = null;
    this.pending = null;
    if (this.chunks) this.chunks.dispose();
    for (const id of this.env?.waterIds ?? []) ctx.water.unregister(id);
    if (this.built) {
      releaseHouseAtlas();
      releaseEarthMaterials();
      this.built = false;
    }
    this.group.clear();
    REGISTRY.delete(this.id);
  }

  /** Debug stats. */
  stats(): Record<string, unknown> {
    const s = this.chunks?.stats();
    return { id: this.id, buildMs: Math.round(this.buildMs), building: this.building, detail: this.detail, ...s, water: this.env?.waterIds.length ?? 0, npcs: this.npcDefs.length, interactables: this.env?.interactables.length ?? 0 };
  }
}
