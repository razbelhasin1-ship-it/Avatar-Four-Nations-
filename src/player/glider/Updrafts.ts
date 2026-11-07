import type { GameContext } from '../../core/GameContext';
import type { Emitter } from '../../vfx/VFX';
import { spotsWithPrefix, type Spot } from '../../world/Spots';
import { GLIDER } from './flight';

/**
 * Updraft columns: rising air over the temple cliffs (the `updraft_*` spots) that carries an open
 * glider up. Each column is wide enough to circle in at full stick (the glider turns on a ~10 m
 * radius) and lifts hardest in its core, fading to nothing at its rim, below its foot and near its
 * top. Nothing is drawn for them while you walk the temple; while you glide, faint wisps of mist
 * rise through the nearest columns (and streaks of air rush past you inside one), so you can find
 * them from the air.
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

/** How many columns show their wisps at once, and from how far (m). */
const SHOW = { max: 3, range: 170, every: 0.4 };

export class UpdraftField {
  private columns: UpdraftColumn[] = [];
  private readonly live = new Map<UpdraftColumn, Emitter>();
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

  /** Keep faint wisps rising in the columns nearest the camera while `show` (gliding). */
  update(dt: number, show: boolean): void {
    const ctx = this.ctx;
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
        em = ctx.vfx.emitter('mist', 6, { radius: c.radius * 0.6, speed: 5, swirl: 0.55, size: 1.4, spread: 0.25 });
        em.direction.set(0, 1, 0);
        this.live.set(c, em);
      }
      // The wisps rise past the camera's height, within the column.
      em.position.set(c.x, Math.min(c.top - 30, Math.max(c.base, cam.y - 12)), c.z);
    }
  }

  /** Stop every wisp (session end, the player gone). */
  clear(): void {
    for (const em of this.live.values()) em.stop();
    this.live.clear();
    this.columns = [];
  }
}
