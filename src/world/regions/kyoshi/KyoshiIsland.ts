import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { heightAt } from '../../Heightfield';
import { A, KI } from '../../landforms/kyoshiIsland';
import { EarthRegion } from '../earth/EarthRegion';
import type { BuildEnv } from '../earth/env';

/**
 * Kyoshi Island (zone `kyoshi_island`, its own map): Suki's village, the Kyoshi Dojo and Shrine,
 * Koi Bay, Crystal Falls and the Crescent Bridge, Koi Harbor. Ground and layout come from
 * landforms/kyoshiIsland.ts; content is authored on the EarthRegion chunk framework (distance LOD,
 * time-sliced construction). The whole island is freed when the player travels away
 * (`unloadRadius`) and rebuilt on the next visit.
 */
export class KyoshiIsland extends EarthRegion {
  readonly id = 'kyoshi_isle';
  readonly center = KI.B;
  readonly loadRadius = 1000;
  readonly unloadRadius = 1800;
  protected readonly seed = KI.seed;
  protected override readonly cell = 96;

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    this.anchors();
    yield;
    // Blockout: the Avatar statue's pillar at the village entrance (scale reference).
    const g = A(KI.village.u, KI.village.gateR - 4);
    const y = heightAt(g.x, g.z);
    env.chunks.at('major', g.x, g.z).builder.cylinder('wood_dark', { x: g.x, y, z: g.z, r: 0.9, h: 15, segments: 14 }, { solid: true });
    this.installDebug();
  }

  /** Named anchors (quest markers, tests, journeys). */
  private anchors(): void {
    const at = (id: string, u: number, r: number) => {
      const p = A(u, r);
      this.mark(id, p.x, heightAt(p.x, p.z), p.z);
    };
    at('village_entrance', KI.village.u, KI.village.gateR - 10);
    at('statue', KI.village.u, KI.village.gateR - 4);
    at('meeting_hall', KI.village.u, KI.village.hallR);
    at('dojo', KI.dojo.u, KI.dojo.r);
    at('shrine', KI.shrine.u, KI.shrine.r);
    at('bay_beach', 0.22, KI.Ri + 8);
    at('meadow', KI.meadow.u, KI.meadow.r);
    at('bridge', KI.falls.u, 268);
    at('harbor_pier', 0.82, KI.harbor.quayR);
    at('west_trail', 0.06, 306);
    at('east_headland', 0.965, 298);
  }

  override dispose(ctx: GameContext): void {
    const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (g?.debug && (g.debug.kyoshi as { owner?: unknown } | undefined)?.owner === this) delete g.debug.kyoshi;
    super.dispose(ctx);
    // Rebuilt from scratch on the next visit.
    this.npcDefs.length = 0;
  }

  /** `__game.debug.kyoshi`: anchors and a teleport to them. */
  private installDebug(): void {
    const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (!g?.debug) return;
    g.debug.kyoshi = {
      owner: this,
      marks: () => this.marks,
      stats: () => this.stats(),
      go: (id: string) => {
        const m = this.marks[id];
        if (!m) return false;
        this.ctx.player?.teleport(new THREE.Vector3(m.x, this.ctx.world.groundAt(m.x, m.z, m.y + 30).y + 0.05, m.z));
        return true;
      },
    };
  }
}
