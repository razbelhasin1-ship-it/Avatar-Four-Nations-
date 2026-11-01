import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { KYOSHI_ARRIVALS, KYOSHI_STAFF } from '../../../data/travel';
import { heightAt } from '../../Heightfield';
import { A, KI } from '../../landforms/kyoshiIsland';
import { EarthRegion } from '../earth/EarthRegion';
import type { BuildEnv } from '../earth/env';
import { buildDojo, type DojoOut } from './dojo';
import { kyoshiLook } from './people';
import { buildShrine, type ShrineOut } from './shrine';
import './spots';
import { buildVillage, type VillageOut } from './village';

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
  private complete = false;
  /** Painted textures / materials owned by the island (fans, mural, swirl paving). */
  private owned: Array<THREE.Material | THREE.Texture> = [];
  /** Built outputs (crowd and life read them). */
  village: VillageOut | null = null;
  dojo: DojoOut | null = null;
  shrine: ShrineOut | null = null;

  /** Built and finished (travel waits for this before anyone steps ashore). */
  get ready(): boolean {
    return this.complete && !this.building;
  }

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    this.anchors();
    yield;
    const v: VillageOut = { marks: {}, doors: [], stalls: [], kitchens: [], fields: [], wells: [], lanterns: [], owned: [] };
    yield* buildVillage(env, v);
    const d: DojoOut = { marks: {}, yard: { x: 0, y: 0, z: 0, yaw: 0, w: 0, d: 0 }, posts: [], owned: [] };
    yield* buildDojo(env, d);
    const s: ShrineOut = { marks: {}, owned: [], lanterns: [] };
    yield* buildShrine(env, s);
    for (const out of [v, d, s]) {
      for (const [k, m] of Object.entries(out.marks)) this.mark(k, m.x, m.y, m.z);
      this.owned.push(...out.owned);
    }
    this.village = v;
    this.dojo = d;
    this.shrine = s;
    this.staff();
    this.installDebug();
    this.complete = true;
  }

  /** The island's travel staff: the harbormaster at the passenger pier, the bison keeper on the meadow. */
  private staff(): void {
    const pier = KYOSHI_ARRIVALS.ki_pier, meadow = KYOSHI_ARRIVALS.ki_meadow;
    const hm = KYOSHI_STAFF.harbormaster, kp = KYOSHI_STAFF.keeper;
    const side = (p: { x: number; z: number; yaw: number }, dd: number) => ({ x: p.x + Math.cos(p.yaw) * dd, z: p.z - Math.sin(p.yaw) * dd });
    const a = side(pier, 3.2), b = side(meadow, -3.4);
    this.npc({ id: hm.id, name: hm.name, title: hm.title, role: 'merchant', nation: 'earth', appearance: kyoshiLook(4101), x: a.x, z: a.z, yaw: pier.yaw + Math.PI, behavior: { type: 'idle', variant: 'stand' }, dialogue: 'travel_staff', region: 'kyoshi_isle', marker: 'none', schedule: 'always' });
    this.npc({ id: kp.id, name: kp.name, title: kp.title, role: 'villager', nation: 'earth', appearance: kyoshiLook(4102), x: b.x, z: b.z, yaw: meadow.yaw + Math.PI, behavior: { type: 'idle', variant: 'stand' }, dialogue: 'travel_staff', region: 'kyoshi_isle', marker: 'none', schedule: 'always' });
  }

  /** Named anchors (quest markers, tests, journeys). */
  private anchors(): void {
    const at = (id: string, u: number, r: number) => {
      const p = A(u, r);
      this.mark(id, p.x, heightAt(p.x, p.z), p.z);
    };
    at('village_entrance', KI.village.u, KI.village.gateR - 10);
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
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.village = this.dojo = this.shrine = null;
    // Rebuilt from scratch on the next visit.
    this.npcDefs.length = 0;
    this.complete = false;
  }

  /** `__game.debug.kyoshi`: anchors, stats and a teleport to them. */
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
