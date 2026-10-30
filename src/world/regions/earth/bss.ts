import type { GameContext } from '../../../core/GameContext';
import type { P2 } from '../../WorldLayout';
import { BssMats } from './bssKit';
import { C, SEED } from './bssLayout';
import { GateRuntime, buildGrounds, buildInnerWall, buildOuterWall, buildPalaceWall, buildRingWall, type WallSite } from './bssWalls';
import { EarthRegion } from './EarthRegion';
import type { BuildEnv } from './env';

/**
 * Ba Sing Se, the impenetrable city (Earth start): the backdrop-scale Outer
 * Wall and the arrival station, the Agrarian Zone with Lake Laogai and the Dai
 * Li base beneath it, the earthen Inner Wall, the Lower, Middle and Upper
 * Rings behind 30 m walls, the Earth King's palace, and the monorail that ties
 * them together. See bssLayout.ts for the master plan and its knobs.
 */
export class BaSingSe extends EarthRegion {
  readonly id = 'ba_sing_se';
  readonly center: P2 = { x: C.x, z: C.z };
  readonly loadRadius = 760;
  protected readonly seed = SEED;
  protected override readonly cell = 128;
  bm: BssMats | null = null;
  gates: GateRuntime | null = null;

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    this.bm = new BssMats();
    this.gates = new GateRuntime(this.group, this.bm);
    const site: WallSite = { env, bm: this.bm, gates: this.gates, mark: (id, x, y, z) => this.mark(id, x, y, z) };
    buildGrounds(site);
    yield;
    buildOuterWall(site);
    yield;
    buildInnerWall(site);
    yield;
    buildRingWall(site, 'middle');
    yield;
    buildRingWall(site, 'upper');
    yield;
    buildPalaceWall(site);
    yield;
  }

  override update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    if (this.building || this.detailLevel !== 'full') return;
    this.gates?.update(dt, ctx);
  }

  override onSessionStart(ctx: GameContext): void {
    super.onSessionStart(ctx);
    if (this.building) return;
    this.gates?.onSessionEnd();
    this.gates?.onSessionStart(ctx);
  }

  override onSessionEnd(ctx: GameContext): void {
    super.onSessionEnd(ctx);
    this.gates?.onSessionEnd();
  }

  override dispose(ctx: GameContext): void {
    super.dispose(ctx);
    this.gates?.dispose();
    this.gates = null;
    this.bm?.dispose();
    this.bm = null;
  }

  override stats(): Record<string, unknown> {
    return { ...super.stats(), gates: this.gates?.count ?? 0 };
  }
}
