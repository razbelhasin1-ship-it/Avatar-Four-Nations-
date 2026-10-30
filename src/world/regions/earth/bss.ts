import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { P2 } from '../../WorldLayout';
import { FigureRenderer } from './bssFigures';
import { BssMats } from './bssKit';
import { C, SEED } from './bssLayout';
import { LiftRuntime, buildRailways, type LiftDef, type StationRt } from './bssRail';
import { TrainSystem } from './bssTrains';
import { GateRuntime, railPath, buildGrounds, buildInnerWall, buildOuterWall, buildPalaceWall, buildRingWall, type WallSite } from './bssWalls';
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
  lifts: LiftRuntime | null = null;
  trains: TrainSystem | null = null;
  figures: FigureRenderer | null = null;
  stations: StationRt[] = [];
  private readonly camPos = new THREE.Vector3();

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
    const rail = buildRailways(site);
    this.stations = rail.stations;
    yield;
    this.figures = new FigureRenderer(this.group, 900);
    this.trains = new TrainSystem(this.group, rail.stations);
    this.lifts = new LiftRuntime(this.group, rail.lifts as LiftDef[], this.bm);
    this.installBssDebug();
  }

  override update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    if (this.building) return;
    const cam = ctx.camera?.position ?? ctx.player?.position;
    if (!cam || !this.figures || !this.trains) return;
    this.camPos.copy(cam);
    const full = this.detailLevel === 'full';
    this.figures.begin(this.camPos);
    if (full) {
      this.gates?.update(dt, ctx);
      this.lifts?.update(dt, ctx, this.figures);
    }
    this.trains.update(dt, ctx, this.figures, this.camPos);
    this.figures.end();
    this.figures.group.visible = full;
  }

  override onSessionStart(ctx: GameContext): void {
    super.onSessionStart(ctx);
    if (this.building) return;
    for (const s of [this.gates, this.lifts, this.trains]) s?.onSessionEnd();
    this.gates?.onSessionStart(ctx);
    this.lifts?.onSessionStart(ctx);
    this.trains?.onSessionStart(ctx);
  }

  override onSessionEnd(ctx: GameContext): void {
    super.onSessionEnd(ctx);
    this.trains?.onSessionEnd();
    this.lifts?.onSessionEnd();
    this.gates?.onSessionEnd();
  }

  override dispose(ctx: GameContext): void {
    super.dispose(ctx);
    this.trains?.dispose();
    this.lifts?.dispose();
    this.gates?.dispose();
    this.figures?.dispose();
    this.trains = null;
    this.lifts = null;
    this.gates = null;
    this.figures = null;
    this.bm?.dispose();
    this.bm = null;
    const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (g?.debug?.bss) delete g.debug.bss;
  }

  override stats(): Record<string, unknown> {
    return { ...super.stats(), gates: this.gates?.count ?? 0, lifts: this.lifts?.count ?? 0, trains: this.trains?.trains.length ?? 0, stations: this.stations.length, figures: this.figures?.stats };
  }

  /** window.__game.debug.bss: trains, gates, lifts, boarding (tests). */
  private installBssDebug(): void {
    const g = (globalThis as { __game?: { debug?: Record<string, unknown>; ctx?: GameContext } }).__game;
    if (!g?.debug) return;
    g.debug.bss = {
      region: () => this,
      trains: () => this.trains?.summary() ?? [],
      riding: () => this.trains?.riding ?? null,
      board: (i = 0) => {
        const t = this.trains?.trains[i];
        if (!t || !this.ctx) return false;
        this.trains!.board(t, this.ctx);
        return true;
      },
      alight: () => (this.ctx ? (this.trains?.alight(this.ctx), true) : false),
      timeOffset: (s: number) => this.trains && (this.trains.timeOffset = s),
      gates: () => this.gates?.state() ?? [],
      gate: (id: string, open: number) => this.gates?.set(id, open) ?? false,
      lifts: () => this.lifts?.state() ?? [],
      lift: (id: string, to: number) => this.lifts?.call(id, to) ?? false,
      stations: () =>
        this.stations.map((s) => {
          const p = railPath(s.line.id).at(s.s);
          return { id: s.id, line: s.line.id, s: +s.s.toFixed(1), top: s.top, tx: p.tx, tz: p.tz, mark: this.marks[`station_${s.id}`] ?? null, lift: this.marks[`lift_${s.id}`] ?? null };
        }),
      figures: () => this.figures?.stats,
    };
  }
}
