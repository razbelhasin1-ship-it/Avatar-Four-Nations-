import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { setOpacity, windMaterial } from '../../vfx/effects/materials';
import { ringWall, shared } from '../../vfx/effects/shapes';
import type { Emitter } from '../../vfx/VFX';
import { spotsWithPrefix, type Spot } from '../../world/Spots';
import { GLIDER } from './flight';

/**
 * Updraft columns: rising air over the temple cliffs (the `updraft_*` spots) that carries an open
 * glider up. Each column is wide enough to circle in at full stick (the glider turns on a ~10 m
 * radius) and lifts hardest in its core, fading to nothing at its rim, below its foot and near its
 * top. Near the camera each column shows as streaks of wind rushing up a slowly turning shell (the
 * core where the lift is full) with wisps of mist rising through it, so you can see where to ride.
 */

export interface UpdraftColumn {
  x: number;
  z: number;
  /** Foot of the column (m): the rising air starts a little below it. */
  base: number;
  /** Rim radius (m). */
  radius: number;
  /** Where the rising air gives out (m). */
  top: number;
}

export const UPDRAFT = {
  /** Columns are at least this wide (radius, m), else spot radius × radiusScale. */
  minRadius: 16,
  radiusScale: 2,
  /** Full lift inside this fraction of the radius. */
  core: 0.55,
  /** Rising air reaches this far below the foot (m), fading in. */
  below: 12,
  /** Height of the column above its foot (m) and the fade under its top (m). */
  height: 240,
  fade: 50,
} as const;

export function columnFromSpot(s: Spot, groundAt: (x: number, z: number) => number): UpdraftColumn {
  const base = s.y ?? groundAt(s.x, s.z);
  return { x: s.x, z: s.z, base, radius: Math.max(UPDRAFT.minRadius, (s.r ?? 9) * UPDRAFT.radiusScale), top: base + UPDRAFT.height };
}

const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Rising air (m/s) at a point: the strongest column there. */
export function updraftLift(columns: readonly UpdraftColumn[], x: number, y: number, z: number): number {
  let best = 0;
  for (const c of columns) {
    const dx = x - c.x, dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= c.radius * c.radius || y < c.base - UPDRAFT.below || y > c.top) continue;
    const d = Math.sqrt(d2) / c.radius;
    const rim = d <= UPDRAFT.core ? 1 : smooth((1 - d) / (1 - UPDRAFT.core));
    const foot = y < c.base ? smooth((y - (c.base - UPDRAFT.below)) / UPDRAFT.below) : 1;
    const head = smooth((c.top - y) / UPDRAFT.fade);
    best = Math.max(best, GLIDER.updraftLift * rim * foot * head);
  }
  return best;
}

/** How many columns show their wisps at once, and from how far (m); streak shells show farther, fading out. */
const SHOW = { max: 3, range: 170, every: 0.4, shellRange: 320, shellFade: 120, shellOpacity: 0.36 };

/** Unit open cylinder (foot at 0, top at 1) whose streaks wind round it as they rise: a spiralling updraft, not a waterfall. */
function twistedShell(): THREE.BufferGeometry {
  const g = ringWall(1, 1, 36, 'up');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // u wraps round the shell; shifting it with height turns the vertical streaks into a helix
  // (2.5 turns over the column; still seamless as the streak repeats across are whole).
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + uv.getY(i) * 2.5);
  uv.needsUpdate = true;
  return g;
}

interface Shell {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

export class UpdraftField {
  private columns: UpdraftColumn[] = [];
  private readonly live = new Map<UpdraftColumn, Emitter>();
  private readonly shells = new Map<UpdraftColumn, Shell>();
  private timer = 0;

  constructor(private readonly ctx: GameContext) {}

  private all(): UpdraftColumn[] {
    if (!this.columns.length) {
      const world = this.ctx.world;
      this.columns = spotsWithPrefix('updraft_').map(([, s]) => columnFromSpot(s, (x, z) => world.heightAt(x, z)));
    }
    return this.columns;
  }

  /** Rising air (m/s) at p. */
  liftAt(p: { x: number; y: number; z: number }): number {
    return updraftLift(this.all(), p.x, p.y, p.z);
  }

  /**
   * Keep the wisps going in the columns nearest the camera (`show`: someone here can ride them —
   * the glider staff is worn — or ambient effects are on).
   */
  update(dt: number, show: boolean): void {
    const ctx = this.ctx;
    this.updateShells(dt, show && ctx.session.active);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = SHOW.every;
    const cam = ctx.camera.position;
    const want = new Set<UpdraftColumn>();
    if (show && ctx.session.active) {
      const near = this.all()
        .map((c) => ({ c, d: Math.hypot(cam.x - c.x, cam.z - c.z) }))
        .filter((e) => e.d < SHOW.range + e.c.radius && cam.y > e.c.base - 60 && cam.y < e.c.top + 60)
        .sort((a, b) => a.d - b.d)
        .slice(0, SHOW.max);
      for (const e of near) want.add(e.c);
    }
    for (const [c, em] of this.live) {
      if (!want.has(c) || !em.active) {
        em.stop();
        this.live.delete(c);
      }
    }
    for (const c of want) {
      let em = this.live.get(c);
      if (!em) {
        // (The particle density setting scales the rate.)
        em = ctx.vfx.emitter('mist', 10, { radius: c.radius * 0.72, speed: 6.5, swirl: 0.55, size: 1.7, spread: 0.25 });
        em.direction.set(0, 1, 0);
        this.live.set(c, em);
      }
      // The wisps rise past the camera's height, within the column.
      em.position.set(c.x, Math.min(c.top - 30, Math.max(c.base, cam.y - 14)), c.z);
    }
  }

  /** Wind streaks rushing up each column's core, fading out with distance (built when first near). */
  private updateShells(dt: number, show: boolean): void {
    const ctx = this.ctx;
    const cam = ctx.camera.position;
    for (const c of show ? this.all() : []) {
      const d = Math.hypot(cam.x - c.x, cam.z - c.z);
      let s = this.shells.get(c);
      if (!s && d > SHOW.shellRange) continue;
      if (!s) {
        const geo = shared('glider_updraft_shell', twistedShell);
        // Streaks ~10 m apart up the shell, rising ~12 m/s (uv speed is in repeat cells per second).
        const mat = windMaterial({ speed: 1.2, repeat: [11, 24], threshold: 0.66, body: 0, opacity: SHOW.shellOpacity, fade: [0.08, 0.25], wrapAcross: true, color: '#ffffff', tint: '#d8ecf8' });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'updraft_shell';
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        // The core (full lift) reaches up from the column's foot; it turns slowly, like the air.
        mesh.position.set(c.x, c.base - UPDRAFT.below * 0.5, c.z);
        mesh.scale.set(c.radius * UPDRAFT.core, c.top - c.base, c.radius * UPDRAFT.core);
        ctx.scene.add(mesh);
        s = { mesh, mat };
        this.shells.set(c, s);
      }
      // Fade with distance; lighter from inside, where the streaks wrap round the view.
      const inside = d < c.radius * UPDRAFT.core * 1.1 ? 0.5 : 1;
      const k = Math.max(0, Math.min(1, (SHOW.shellRange - d) / SHOW.shellFade)) * inside;
      s.mesh.visible = k > 0.01;
      s.mesh.rotation.y += dt * 0.12;
      setOpacity(s.mat, SHOW.shellOpacity * k);
    }
    if (!show) for (const s of this.shells.values()) s.mesh.visible = false;
  }

  /** Stop every wisp and drop the streak shells (session end, the player gone). */
  clear(): void {
    for (const em of this.live.values()) em.stop();
    this.live.clear();
    for (const s of this.shells.values()) {
      s.mesh.removeFromParent();
      s.mat.dispose();
    }
    this.shells.clear();
    this.columns = [];
  }
}
