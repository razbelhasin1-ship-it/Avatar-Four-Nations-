import * as THREE from 'three';
import { setBendTone } from '../combat/water/WaterMaterials';
import type { GameContext, GameSystem } from '../core/GameContext';
import { activeWaterRipples, addWaterRipple, clearWaterRipples, polarSeaAt, toneForSource } from './env/WaterShared';
import { waterDetail } from './WaterLook';

/**
 * Water that responds (module `water_life`):
 *
 *  - Basins (city fountains, ponds, pools, canals, wells — ContentBuilder.waterSurface) follow
 *    their bending source: drawn down they sink a little, then rise again as they refill.
 *  - Rings spread where water is disturbed: drawn from (any source, sized by the amount), waded
 *    or swum through (a wake while moving, a slow pulse while standing in it), or splashed into
 *    (WaterLife.splash, e.g. spent water returned to a source).
 *  - Bent water takes the colour of the source the player last drew from (WaterShared tones).
 *  - The graphics settings set the water detail level (caustics, rain rings, second ripple layer).
 *
 * Debug: window.__game.debug.waterLife = { ripples(), basins(), splash(x, z, s) }.
 */

interface Basin {
  id: string;
  mesh: THREE.Mesh;
  baseY: number;
  drop: number;
  level: number;
  x: number;
  z: number;
  r: number;
}

const basins = new Map<string, Basin>();

/** A basin's water mesh follows source `id`'s fill (ContentBuilder.waterSurface). */
export function trackBasin(id: string, mesh: THREE.Mesh, baseY: number, r: number, drop: number): void {
  basins.set(id, { id, mesh, baseY, drop, level: baseY, x: mesh.position.x, z: mesh.position.z, r });
}

export function untrackBasin(id: string): void {
  basins.delete(id);
}

const DETAIL = { low: 0, medium: 0.6, high: 1 } as const;

export class WaterLife implements GameSystem {
  private ctx!: GameContext;
  private basinT = 0;
  private wadeT = 0;
  private readonly last = new THREE.Vector3();

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('water:drawn', (e) => {
      // Drawing from a surface pulls it into rings (a flask or the air has no surface to ring).
      if (e.sourceType !== 'flask' && e.sourceType !== 'moisture' && e.sourceType !== 'snow' && e.sourceType !== 'rain') {
        addWaterRipple(e.position.x, e.position.z, Math.min(1.8, 0.6 + e.amount / 20));
      }
      if (e.sourceType !== 'flask') {
        const tone = toneForSource(e.sourceType, ctx.water.get(e.sourceId)?.label ?? '');
        setBendTone(tone === 'sea' && polarSeaAt(e.position.x, e.position.z) ? 'polar' : tone);
      }
    });
    // Spent water falling back into a basin, the sea or a puddle splashes rings across it.
    ctx.events.on('water:released', (e) => addWaterRipple(e.x, e.z, Math.min(2, 0.5 + e.amount / 15)));
    ctx.events.on('settings:changed', () => this.applyDetail());
    this.applyDetail();
    this.installDebug();
  }

  onSessionStart(): void {
    clearWaterRipples();
    this.last.set(0, -9999, 0);
  }

  onSessionEnd(): void {
    clearWaterRipples();
  }

  private applyDetail(): void {
    waterDetail.value = DETAIL[this.ctx.settings.data.graphics.effectsQuality] ?? 1;
  }

  /** A splash at (x, z): rings on whatever water is there. */
  splash(x: number, z: number, strength = 1): void {
    addWaterRipple(x, z, strength);
  }

  update(dt: number): void {
    this.basinT -= dt;
    if (this.basinT <= 0) {
      this.basinT = 0.1;
      for (const b of basins.values()) {
        const s = this.ctx.water.get(b.id);
        if (!s) continue;
        const fill = Number.isFinite(s.capacity) && s.capacity > 0 ? Math.max(0, Math.min(1, s.amount / s.capacity)) : 1;
        const target = b.baseY - (1 - fill) * b.drop;
        b.level += (target - b.level) * 0.3;
        if (Math.abs(b.mesh.position.y - b.level) > 1e-4) b.mesh.position.y = b.level;
      }
    }
    this.wade(dt);
  }

  /** Surface height under (x, z) when (x, y, z) is in water: a city basin or the world's water. */
  private surfaceAt(x: number, y: number, z: number): number | null {
    for (const b of basins.values()) {
      if (Math.abs(y - b.level) < 2 && Math.hypot(x - b.x, z - b.z) < b.r) return b.level;
    }
    const w = this.ctx.world.liquidAt(x, z);
    return w ? w.level : null;
  }

  private wade(dt: number): void {
    const p = this.ctx.player;
    if (!p || !this.ctx.session.active) return;
    const pos = p.position;
    const lvl = this.surfaceAt(pos.x, pos.y, pos.z);
    const moved = this.last.y < -9000 ? 0 : Math.hypot(pos.x - this.last.x, pos.z - this.last.z);
    this.last.copy(pos);
    // Feet below the surface and the body not fully under it.
    if (lvl === null || pos.y > lvl + 0.04 || pos.y < lvl - 2.2) return;
    const speed = moved / Math.max(dt, 1e-3);
    this.wadeT -= dt;
    if (this.wadeT > 0) return;
    const moving = speed > 0.5;
    this.wadeT = moving ? Math.max(0.16, 0.32 - speed * 0.02) : 1.3;
    addWaterRipple(pos.x, pos.z, moving ? Math.min(1.2, 0.35 + speed * 0.12) : 0.2);
  }

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = () => {
      if (!w.__game) return false;
      w.__game.debug.waterLife = {
        sys: this,
        ripples: () => activeWaterRipples(),
        basins: () => [...basins.values()].map((b) => ({ id: b.id, base: +b.baseY.toFixed(3), level: +b.level.toFixed(3), drop: b.drop })),
        splash: (x: number, z: number, s = 1) => this.splash(x, z, s),
        detail: () => waterDetail.value,
      };
      return true;
    };
    if (!install()) setTimeout(install, 0);
  }
}
