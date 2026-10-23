import type * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { Random } from '../../../core/Random';
import type { ArchetypeId, HouseArchetype } from './archetypes';
import type { HouseAtlas } from './atlas';
import type { ChunkSet } from './chunks';
import type { EarthMaterials } from './materials';

/**
 * Shared state for the district builders of an Earth settlement.
 */
export interface BuildEnv {
  ctx: GameContext;
  chunks: ChunkSet;
  mats: EarthMaterials;
  atlas: HouseAtlas;
  arch: Record<ArchetypeId, HouseArchetype>;
  rnd: Random;
  excl: Exclusions;
  /** 0..1.5 decorative density (foliage setting at build time; instanced decor can thin live). */
  decor: number;
  /** Registered water source ids (unregistered on dispose). */
  waterIds: string[];
  /** Session interactables to register on session start. */
  interactables: InteractableSpec[];
  /** Animated objects updated each frame while near. */
  animated: Array<(dt: number, t: number) => void>;
}

export interface InteractableSpec {
  id: string;
  position: THREE.Vector3;
  radius: number;
  label: string;
  priority?: number;
  interact(ctx: GameContext): void;
}

type Shape =
  | { k: 'c'; x: number; z: number; r: number }
  | { k: 's'; ax: number; az: number; bx: number; bz: number; hw: number }
  | { k: 'b'; x: number; z: number; hx: number; hz: number; c: number; s: number };

const CELL = 32;

/**
 * Placement exclusion zones (plazas, avenues, stairs, piers, landmark clear
 * zones...). Houses/props test their footprint against these.
 */
export class Exclusions {
  private readonly shapes: Shape[] = [];
  private readonly grid = new Map<string, number[]>();

  private insert(s: Shape, x0: number, z0: number, x1: number, z1: number): void {
    const idx = this.shapes.length;
    this.shapes.push(s);
    for (let i = Math.floor((x0 - 8) / CELL); i <= Math.floor((x1 + 8) / CELL); i++) {
      for (let j = Math.floor((z0 - 8) / CELL); j <= Math.floor((z1 + 8) / CELL); j++) {
        const k = `${i}:${j}`;
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(idx);
      }
    }
  }

  circle(x: number, z: number, r: number): void {
    this.insert({ k: 'c', x, z, r }, x - r, z - r, x + r, z + r);
  }

  seg(ax: number, az: number, bx: number, bz: number, hw: number): void {
    this.insert({ k: 's', ax, az, bx, bz, hw }, Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw);
  }

  polyline(points: Array<{ x: number; z: number }>, hw: number): void {
    for (let i = 0; i < points.length - 1; i++) this.seg(points[i].x, points[i].z, points[i + 1].x, points[i + 1].z, hw);
  }

  box(x: number, z: number, hx: number, hz: number, yaw = 0): void {
    const r = Math.hypot(hx, hz);
    this.insert({ k: 'b', x, z, hx, hz, c: Math.cos(yaw), s: Math.sin(yaw) }, x - r, z - r, x + r, z + r);
  }

  /** Axis-aligned rectangle by bounds. */
  rect(x0: number, z0: number, x1: number, z1: number): void {
    this.box((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2, Math.abs(z1 - z0) / 2);
  }

  pointBlocked(x: number, z: number, margin = 0): boolean {
    const l = this.grid.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`);
    if (!l) return false;
    for (const i of l) {
      const s = this.shapes[i];
      if (s.k === 'c') {
        if (Math.hypot(x - s.x, z - s.z) < s.r + margin) return true;
      } else if (s.k === 's') {
        const abx = s.bx - s.ax, abz = s.bz - s.az;
        const l2 = abx * abx + abz * abz;
        let t = l2 > 0 ? ((x - s.ax) * abx + (z - s.az) * abz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(x - (s.ax + abx * t), z - (s.az + abz * t)) < s.hw + margin) return true;
      } else {
        const dx = x - s.x, dz = z - s.z;
        const lx = dx * s.c - dz * s.s, lz = dx * s.s + dz * s.c;
        if (Math.abs(lx) < s.hx + margin && Math.abs(lz) < s.hz + margin) return true;
      }
    }
    return false;
  }

  /** Oriented rectangle test (samples a grid over the footprint). */
  rectBlocked(x: number, z: number, hw: number, hd: number, yaw: number, margin = 0): boolean {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const nx = Math.max(2, Math.ceil((hw * 2) / 3)), nz = Math.max(2, Math.ceil((hd * 2) / 3));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const lx = -hw + (i / nx) * hw * 2, lz = -hd + (j / nz) * hd * 2;
        // Local +X → (cos yaw, -sin yaw); local +Z → (sin yaw, cos yaw)
        const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
        if (this.pointBlocked(px, pz, margin)) return true;
      }
    }
    return false;
  }
}
