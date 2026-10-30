import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { SurfaceType } from '../../core/types';
import type { EnvironmentFX, WorldUpdatable } from '../World';
import { envUniforms, MAX_IMPULSES } from './EnvShared';
import { DECAL_KIND, DECAL_SURFACE, DecalPool, type DecalHeightFn } from './GroundDecals';

/**
 * Real implementation of world.fx (EnvironmentFX):
 * - footprint: persistent prints on snow / sand / mud / ash (walk, run, heavy
 *   landing crater, slide streak), fading over 60-90 s;
 * - scorch / wet / frost / crack: ground decals for fire, water, ice and earth;
 * - disturb: grass & foliage push impulses plus surface puffs (snow, sand,
 *   dust) and falling leaves from nearby trees.
 * The player's slides are detected here (the Player only reports steps and
 * landings) and leave streaks on deformable ground.
 */

const DEFORMABLE: ReadonlySet<SurfaceType> = new Set<SurfaceType>(['snow', 'packedsnow', 'sand', 'mud', 'ash']);
const PRINT_LIFE: Partial<Record<SurfaceType, number>> = { snow: 90, packedsnow: 70, sand: 70, mud: 85, ash: 60 };
const PRINT_DEPTH: Partial<Record<SurfaceType, number>> = { snow: 1, packedsnow: 0.55, sand: 0.8, mud: 0.9, ash: 0.75 };

interface Impulse {
  x: number;
  z: number;
  r: number;
  s: number;
}

interface Recent {
  x: number;
  z: number;
  r: number;
  t: number;
}

export interface TreeQuery {
  query(x: number, z: number, r: number): Array<{ species: string; x: number; y: number; z: number; scale: number }>;
}

export class EnvFXSystem implements EnvironmentFX, WorldUpdatable {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  readonly prints: DecalPool;
  readonly patches: DecalPool;
  readonly frosts: DecalPool;
  private readonly impulses: Impulse[] = [];
  private readonly recent: Record<'scorch' | 'wet' | 'frost' | 'crack' | 'print' | 'puff', Recent[]> = { scorch: [], wet: [], frost: [], crack: [], print: [], puff: [] };
  private slideDist = 0;
  private readonly lastSlide = new THREE.Vector3(Infinity, 0, 0);
  private readonly tmp = new THREE.Vector3();
  enabled = true;
  /** Footprints / slide streaks / ambient puffs follow settings.graphics.ambientEffects. */
  footprintsEnabled = true;
  /** Counters for tests / debugging. */
  readonly counts = { footprint: 0, scorch: 0, wet: 0, frost: 0, crack: 0, disturb: 0, slide: 0 };

  constructor(private readonly ctx: GameContext, private readonly trees: TreeQuery | null) {
    this.group.name = 'ground_decals';
    this.prints = new DecalPool(768, 3, 'mod2x', this.time, 'decals_prints');
    this.patches = new DecalPool(192, 9, 'mod2x', this.time, 'decals_patches');
    this.frosts = new DecalPool(64, 9, 'alpha', this.time, 'decals_frost');
    this.group.add(this.prints.mesh, this.patches.mesh, this.frosts.mesh);
    ctx.world.group.add(this.group);
  }

  get now(): number {
    return this.time.value;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Height function matching what is rendered under (x,z): collider top, sea ice or terrain. */
  private heightFn(x: number, z: number, refY: number): { fn: DecalHeightFn; surface: SurfaceType; y: number } {
    const w = this.ctx.world;
    const g = w.groundAt(x, z, refY + 0.8);
    if (g.colliderId) {
      const top = g.y;
      return {
        fn: (px, pz) => {
          const c = w.collision.groundAt(px, pz, refY + 0.8);
          return c && Math.abs(c.y - top) < 0.6 ? c.y : top;
        },
        surface: g.surface,
        y: top,
      };
    }
    if (g.surface === 'ice' && Math.abs(g.y - w.terrain.heightAt(x, z)) > 0.05) return { fn: () => g.y, surface: g.surface, y: g.y };
    return { fn: (px, pz) => w.terrain.heightAt(px, pz), surface: g.surface, y: g.y };
  }

  /** True (and records it) unless a similar decal was made close by very recently. */
  private admit(list: Recent[], x: number, z: number, r: number, minGap: number, window: number): boolean {
    const now = this.time.value;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (now - e.t > window) {
        list.splice(i, 1);
        continue;
      }
      if (Math.hypot(e.x - x, e.z - z) < Math.max(minGap, Math.min(e.r, r) * 0.45)) return false;
    }
    list.push({ x, z, r, t: now });
    if (list.length > 64) list.shift();
    return true;
  }

  private get ambientOn(): boolean {
    return this.enabled && this.footprintsEnabled;
  }

  // ---------------------------------------------------------------------------
  // EnvironmentFX
  // ---------------------------------------------------------------------------

  disturb(pos: THREE.Vector3, radius: number, strength: number): void {
    if (!(radius > 0) || !(strength > 0)) return;
    this.counts.disturb++;
    // Grass / foliage impulse (shader push), strongest new impulses replace the weakest.
    const imp: Impulse = { x: pos.x, z: pos.z, r: Math.min(radius, 14), s: Math.min(1.5, strength) };
    if (this.impulses.length < MAX_IMPULSES) this.impulses.push(imp);
    else {
      let wi = 0;
      for (let i = 1; i < this.impulses.length; i++) if (this.impulses[i].s < this.impulses[wi].s) wi = i;
      if (this.impulses[wi].s < imp.s) this.impulses[wi] = imp;
    }
    if (!this.ambientOn) return;
    if (!this.admit(this.recent.puff, pos.x, pos.z, radius, 1.2, 0.25)) return;
    const g = this.ctx.world.groundAt(pos.x, pos.z, pos.y + 1.5);
    if (pos.y - g.y > Math.max(3, radius)) return;
    const p = this.tmp.set(pos.x, g.y + 0.1, pos.z);
    const count = Math.round(Math.min(14, 2 + radius * strength * 1.6));
    const vfx = this.ctx.vfx;
    switch (g.surface) {
      case 'snow':
      case 'packedsnow':
        vfx.burst('snowpuff', p, { count, radius: radius * 0.45, speed: 1 + strength * 2 });
        vfx.burst('snow', p, { count: Math.ceil(count / 2), radius: radius * 0.4 });
        break;
      case 'sand':
        vfx.burst('sand', p, { count, radius: radius * 0.45 });
        break;
      case 'ash':
        vfx.burst('ash', p, { count, radius: radius * 0.5 });
        vfx.burst('dust', p, { count: Math.ceil(count / 3), radius: radius * 0.4, color: '#6d6662' });
        break;
      case 'dirt':
      case 'gravel':
      case 'mud':
        vfx.burst('dust', p, { count: Math.ceil(count / 2), radius: radius * 0.4 });
        break;
      case 'grass':
        vfx.burst('leaves', p, { count: Math.ceil(count / 3), radius: radius * 0.5, color: '#6f9a3c', color2: '#9bb85a' });
        break;
      default:
        break;
    }
    // Leaves shaken loose from trees inside the blast.
    if (this.trees && strength > 0.45) {
      const near = this.trees.query(pos.x, pos.z, radius + 2);
      let n = 0;
      for (const t of near) {
        if (n >= 3) break;
        if (t.species === 'rock' || t.species === 'ice_rock' || t.species === 'deadtree' || t.species === 'pine_snow' || t.species === 'bush_snow') {
          if (t.species === 'pine_snow') {
            vfx.burst('snow', this.tmp.set(t.x, t.y + 3.5 * t.scale, t.z), { count: 8, radius: 1.5, speed: 0.6 });
            n++;
          }
          continue;
        }
        const leafy = t.species === 'blossom' ? { color: '#f4b6c8', color2: '#ffd6e2' } : t.species === 'acacia' || t.species === 'shrub_dry' ? { color: '#a3a04a', color2: '#c2b25a' } : { color: '#5f8f34', color2: '#9cbf54' };
        const hgt = t.species === 'bush' || t.species === 'fern' || t.species === 'flowers' || t.species === 'reeds' ? 0.8 : 4.2;
        vfx.burst('leaves', this.tmp.set(t.x, t.y + hgt * t.scale, t.z), { count: 6, radius: hgt * 0.4, speed: 0.8, ...leafy });
        n++;
      }
    }
  }

  footprint(pos: THREE.Vector3, yaw: number, foot: 'L' | 'R', kind: 'walk' | 'run' | 'land' | 'slide', surface: SurfaceType): void {
    if (!this.ambientOn) return;
    if (!DEFORMABLE.has(surface)) return;
    if (kind !== 'land' && !this.admit(this.recent.print, pos.x, pos.z, 0.2, 0.12, 0.12)) return;
    const h = this.heightFn(pos.x, pos.z, pos.y);
    // Surfaces can change between the step and the sample (e.g. stepping onto a road).
    const surf = DEFORMABLE.has(h.surface) ? h.surface : surface;
    const life = PRINT_LIFE[surf] ?? 75;
    const depth = PRINT_DEPTH[surf] ?? 0.8;
    const fam = DECAL_SURFACE[surf] ?? 4;
    const now = this.time.value;
    this.counts.footprint++;
    if (kind === 'land') {
      this.patches.spawn({ x: pos.x, z: pos.z, sizeX: 1.35, sizeZ: 1.35, yaw, kind: DECAL_KIND.land, life: life * 0.9, mirror: 1, surface: fam, intensity: depth }, now, h.fn, 0.03);
      return;
    }
    if (kind === 'slide') {
      this.patches.spawn({ x: pos.x, z: pos.z, sizeX: 0.62, sizeZ: 1.25, yaw, kind: DECAL_KIND.slide, life: life * 0.8, mirror: 1, surface: fam, intensity: depth }, now, h.fn, 0.03);
      return;
    }
    const run = kind === 'run';
    this.prints.spawn(
      { x: pos.x, z: pos.z, sizeX: 0.34, sizeZ: run ? 0.48 : 0.43, yaw: yaw + (foot === 'L' ? 0.08 : -0.08), kind: run ? DECAL_KIND.run : DECAL_KIND.walk, life, mirror: foot === 'L' ? 1 : -1, surface: fam, intensity: depth },
      now,
      h.fn,
      0.025,
    );
  }

  scorch(pos: THREE.Vector3, radius: number): void {
    if (!this.enabled || !(radius > 0)) return;
    const h = this.heightFn(pos.x, pos.z, pos.y);
    if (h.surface === 'water' || pos.y - h.y > 2.5) return;
    if (!this.admit(this.recent.scorch, pos.x, pos.z, radius, 0.5, 1.2)) return;
    this.counts.scorch++;
    // Marks stay modest and fade within a fight, so a battle does not blacken the ground.
    const r = Math.min(radius, 4) * 1.6;
    const yaw = Math.random() * Math.PI * 2;
    if (h.surface === 'snow' || h.surface === 'packedsnow' || h.surface === 'ice') {
      // Fire melts snow and ice rather than charring it.
      this.patches.spawn({ x: pos.x, z: pos.z, sizeX: r * 1.1, sizeZ: r * 1.1, yaw, kind: DECAL_KIND.wet, life: 20, mirror: 1, surface: 0, intensity: 1 }, this.time.value, h.fn, 0.03);
      return;
    }
    this.patches.spawn({ x: pos.x, z: pos.z, sizeX: r, sizeZ: r, yaw, kind: DECAL_KIND.scorch, life: 20, mirror: 1, surface: 0, intensity: h.surface === 'grass' ? 0.9 : 0.75 }, this.time.value, h.fn, 0.03);
  }

  wet(pos: THREE.Vector3, radius: number): void {
    if (!this.enabled || !(radius > 0)) return;
    const h = this.heightFn(pos.x, pos.z, pos.y);
    if (h.surface === 'water' || pos.y - h.y > 2.5) return;
    if (!this.admit(this.recent.wet, pos.x, pos.z, radius, 0.6, 0.8)) return;
    this.counts.wet++;
    const r = Math.min(radius, 5) * 1.7;
    this.patches.spawn({ x: pos.x, z: pos.z, sizeX: r, sizeZ: r, yaw: Math.random() * Math.PI * 2, kind: DECAL_KIND.wet, life: 12, mirror: 1, surface: 0, intensity: h.surface === 'snow' ? 0.5 : 0.85 }, this.time.value, h.fn, 0.03);
  }

  frost(pos: THREE.Vector3, radius: number): void {
    if (!this.enabled || !(radius > 0)) return;
    const h = this.heightFn(pos.x, pos.z, pos.y);
    if (h.surface === 'water' || pos.y - h.y > 2.5) return;
    if (!this.admit(this.recent.frost, pos.x, pos.z, radius, 0.5, 0.8)) return;
    this.counts.frost++;
    const r = Math.min(radius, 6) * 2;
    this.frosts.spawn({ x: pos.x, z: pos.z, sizeX: r, sizeZ: r, yaw: Math.random() * Math.PI * 2, kind: DECAL_KIND.frost, life: 20, mirror: 1, surface: 0, intensity: 1 }, this.time.value, h.fn, 0.035);
  }

  crack(pos: THREE.Vector3, radius: number, yaw?: number): void {
    if (!this.enabled || !(radius > 0)) return;
    const h = this.heightFn(pos.x, pos.z, pos.y);
    if (h.surface === 'water' || pos.y - h.y > 2.5) return;
    if (!this.admit(this.recent.crack, pos.x, pos.z, radius, 0.6, 0.6)) return;
    this.counts.crack++;
    const r = Math.min(radius, 4) * 1.6;
    this.patches.spawn({ x: pos.x, z: pos.z, sizeX: r, sizeZ: r, yaw: yaw ?? Math.random() * Math.PI * 2, kind: DECAL_KIND.crack, life: 14, mirror: 1, surface: 0, intensity: 0.85 }, this.time.value, h.fn, 0.03);
  }

  // ---------------------------------------------------------------------------
  // WorldUpdatable
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext): void {
    this.time.value += dt;
    // Impulses decay; feed the shared uniform array.
    const arr = envUniforms.uImpulse.value;
    for (let i = this.impulses.length - 1; i >= 0; i--) {
      const im = this.impulses[i];
      im.s *= Math.exp(-dt * 2.6);
      if (im.s < 0.02) this.impulses.splice(i, 1);
    }
    for (let i = 0; i < MAX_IMPULSES; i++) {
      const im = this.impulses[i];
      if (im) arr[i].set(im.x, im.z, im.r, im.s);
      else arr[i].set(0, 0, 0, 0);
    }
    this.detectSlide(ctx);
  }

  /** Slides leave streaks on deformable ground (the Player does not report them). */
  private detectSlide(ctx: GameContext): void {
    const p = ctx.player;
    const b = p?.body;
    if (!p || !b || !ctx.session.active || !b.sliding || !b.grounded || !DEFORMABLE.has(b.surface)) {
      this.slideDist = 0;
      this.lastSlide.set(Infinity, 0, 0);
      return;
    }
    const pos = p.position;
    if (!Number.isFinite(this.lastSlide.x)) {
      this.lastSlide.copy(pos);
      return;
    }
    const d = Math.hypot(pos.x - this.lastSlide.x, pos.z - this.lastSlide.z);
    if (d < 0.9) return;
    const yaw = Math.atan2(pos.x - this.lastSlide.x, pos.z - this.lastSlide.z);
    this.tmp.set((pos.x + this.lastSlide.x) / 2, pos.y, (pos.z + this.lastSlide.z) / 2);
    this.lastSlide.copy(pos);
    this.counts.slide++;
    this.footprint(this.tmp, yaw, 'L', 'slide', b.surface);
  }

  liveCounts(): { prints: number; patches: number; frost: number } {
    const now = this.time.value;
    return { prints: this.prints.liveCount(now), patches: this.patches.liveCount(now), frost: this.frosts.liveCount(now) };
  }

  /** Remove every decal (session restart / travel). */
  clear(): void {
    this.prints.clear();
    this.patches.clear();
    this.frosts.clear();
    this.impulses.length = 0;
    for (const k of Object.keys(this.recent) as Array<keyof typeof this.recent>) this.recent[k].length = 0;
  }

  dispose(): void {
    this.prints.dispose();
    this.patches.dispose();
    this.frosts.dispose();
    this.group.removeFromParent();
  }
}
