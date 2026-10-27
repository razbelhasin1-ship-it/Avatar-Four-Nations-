import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { addEffect } from '../../vfx/effects/loop';

/**
 * Loose stones an earthbender tore out of the ground (RockLift). Once set down they stay where
 * they landed and can be lifted again: a lightweight register of liftable stones for ground
 * that has none of the world's own rocks (the tutorial isle, meadows, town streets). They are
 * small (like the world's small rocks, no collider) and few: past MAX_STONES the oldest sinks
 * back into the earth, as do stones left far behind; session end clears them all.
 */

/** Loose stones kept at once. */
const MAX_STONES = 8;
/** Metres from the bender beyond which a stone quietly goes back into the ground. */
const FORGET = 160;

export interface LooseStone {
  readonly id: number;
  readonly mesh: THREE.Mesh;
  readonly sxz: number;
  readonly sy: number;
  readonly tint: [number, number, number];
  /** Placement point (rock origin, below its visual centre) and heading, from its matrix. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** In a bender's hold (hidden here meanwhile). */
  lifted: boolean;
}

/** Rock material matching the vegetation shader's colouring (vertex colour × instance tint). */
export function rockMaterial(tint: [number, number, number]): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uTint = { value: new THREE.Vector3(...tint) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = uTint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 veg;\nuniform vec3 uTint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb *= mix( vec3( 1.0 ), uTint, veg.y );');
  };
  mat.customProgramCacheKey = () => 'lifted-rock-v1';
  return mat;
}

const tA = new THREE.Vector3();

export class LooseStones {
  private readonly stones: LooseStone[] = [];
  private nextId = 1;
  private cullT = 0;

  constructor(private readonly ctx: GameContext) {}

  get count(): number {
    return this.stones.length;
  }

  /** Register a stone resting at `matrix` (rock-local → world, scale included). */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, sxz: number, sy: number, tint: [number, number, number]): LooseStone {
    // Make room: the oldest stone nobody is holding sinks back into the earth.
    while (this.stones.length >= MAX_STONES) {
      const old = this.stones.find((s) => !s.lifted);
      if (!old) break;
      this.sink(old);
    }
    const mesh = new THREE.Mesh(geometry, rockMaterial(tint));
    mesh.name = 'loose_stone';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.ctx.vfx.group.add(mesh);
    const stone: LooseStone = { id: this.nextId++, mesh, sxz, sy, tint, x: 0, y: 0, z: 0, yaw: 0, lifted: false };
    this.place(stone, matrix);
    this.stones.push(stone);
    return stone;
  }

  /**
   * Nearest stone hit by the ray within maxDist: the same bounding sphere and aim assist as
   * the world's rocks (VegetationSystem.pickRock). Stones in someone's hold are skipped.
   */
  pick(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, slack: number, cone: number): { stone: LooseStone; distance: number } | null {
    let best: { stone: LooseStone; distance: number } | null = null;
    for (const s of this.stones) {
      if (s.lifted) continue;
      const ox = s.x - origin.x, oy = s.y + 0.25 * s.sy - origin.y, oz = s.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      const r = 0.9 * Math.max(s.sxz, 0.7 * s.sy) + slack + cone * Math.max(0, t);
      if (t < 0 || t - r > maxDist) continue;
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      if (d2 > r * r) continue;
      const hitT = Math.max(0, t - Math.sqrt(Math.max(0, r * r - d2)));
      if (best && hitT >= best.distance) continue;
      best = { stone: s, distance: hitT };
    }
    return best;
  }

  /** Nearest free stone within `radius` metres of (x, z) on the ground plane that `accept` agrees to. */
  nearest(x: number, z: number, radius: number, accept?: (s: LooseStone) => boolean): LooseStone | null {
    let best: LooseStone | null = null;
    let bestD = radius;
    for (const s of this.stones) {
      if (s.lifted) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d > bestD || (accept && !accept(s))) continue;
      best = s;
      bestD = d;
    }
    return best;
  }

  /** A bender lifts it: hidden here until put back. False if it is gone or already held. */
  take(stone: LooseStone): boolean {
    if (stone.lifted || !this.stones.includes(stone)) return false;
    stone.lifted = true;
    stone.mesh.visible = false;
    return true;
  }

  /** Set down at `matrix` (or, without one, back where it was). False if it was cleared meanwhile. */
  put(stone: LooseStone, matrix?: THREE.Matrix4): boolean {
    if (!this.stones.includes(stone)) return false;
    if (matrix) this.place(stone, matrix);
    stone.lifted = false;
    stone.mesh.visible = true;
    return true;
  }

  /** Per frame: stones the bender left far behind go back into the ground. */
  update(dt: number, from: THREE.Vector3): void {
    this.cullT -= dt;
    if (this.cullT > 0 || this.stones.length === 0) return;
    this.cullT = 1;
    for (const s of [...this.stones]) {
      if (!s.lifted && Math.hypot(s.x - from.x, s.z - from.z) > FORGET) this.sink(s, false);
    }
  }

  /** Remove every stone at once (session end). */
  clear(): void {
    for (const s of this.stones) this.drop(s.mesh);
    this.stones.length = 0;
  }

  debug(): Array<{ id: number; pos: number[]; scale: number; lifted: boolean }> {
    return this.stones.map((s) => ({ id: s.id, pos: [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)], scale: +s.sxz.toFixed(2), lifted: s.lifted }));
  }

  private place(stone: LooseStone, m: THREE.Matrix4): void {
    stone.mesh.matrix.copy(m);
    stone.mesh.matrixWorldNeedsUpdate = true;
    const e = m.elements;
    stone.x = e[12];
    stone.y = e[13];
    stone.z = e[14];
    stone.yaw = Math.atan2(e[8], e[10]);
  }

  /** Out of the register at once; in view it sinks slowly back into the ground in a little dust. */
  private sink(stone: LooseStone, fx = true): void {
    const i = this.stones.indexOf(stone);
    if (i >= 0) this.stones.splice(i, 1);
    const mesh = stone.mesh;
    if (!fx || !mesh.visible) {
      this.drop(mesh);
      return;
    }
    this.ctx.vfx.burst('dust', tA.set(stone.x, stone.y + 0.1, stone.z), { count: 6, radius: stone.sxz * 0.6, speed: 0.5 });
    const depth = 1.1 * stone.sy + 0.2;
    let t = 0;
    addEffect({
      update: (dt) => {
        t += dt;
        mesh.matrix.elements[13] -= (dt * depth) / 1.4;
        mesh.matrixWorldNeedsUpdate = true;
        return t < 1.4;
      },
      dispose: () => this.drop(mesh),
    });
  }

  private drop(mesh: THREE.Mesh): void {
    mesh.removeFromParent();
    (mesh.material as THREE.Material).dispose();
  }
}
