import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { P2 } from '../../WorldLayout';
import { CrowdSystem } from './bssCrowd';
import { FigureRenderer } from './bssFigures';
import { BssMats } from './bssKit';
import { C, SEED } from './bssLayout';
import { buildLowerRing, type DistrictSite } from './bssLower';
import { buildMiddleRing } from './bssMiddle';
import { buildFarmland } from './bssFarm';
import { LaogaiRuntime, buildLaogai, type LaogaiBuild } from './bssLaogai';
import { buildPalace } from './bssPalace';
import { buildUpperRing } from './bssUpper';
import { NavGraph } from './bssNav';
import { BssOverlay } from './bssOverlay';
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
  laogai: LaogaiRuntime | null = null;
  crowd: CrowdSystem | null = null;
  overlay: BssOverlay | null = null;
  trains: TrainSystem | null = null;
  figures: FigureRenderer | null = null;
  stations: StationRt[] = [];
  nav: NavGraph | null = null;
  private smoke: Array<{ x: number; y: number; z: number; rate: number; steam?: boolean; acc: number }> = [];
  private readonly camPos = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    this.bm = new BssMats();
    this.gates = new GateRuntime(this.group, this.bm);
    this.nav = new NavGraph();
    const smoke: DistrictSite['smoke'] = [];
    const site: DistrictSite = {
      env,
      bm: this.bm,
      gates: this.gates,
      mark: (id, x, y, z) => this.mark(id, x, y, z),
      nav: this.nav,
      water: (b, o) => this.water(b, o),
      smoke,
      lifts: [],
      shops: [],
      stalls: [],
    };
    const wallSite: WallSite = site;
    buildGrounds(wallSite);
    yield;
    buildOuterWall(wallSite);
    yield;
    buildInnerWall(wallSite);
    yield;
    buildRingWall(wallSite, 'middle');
    yield;
    buildRingWall(wallSite, 'upper');
    yield;
    buildPalaceWall(wallSite);
    yield;
    const rail = buildRailways(wallSite);
    this.stations = rail.stations;
    site.lifts = rail.lifts as LiftDef[];
    yield;
    yield* buildLowerRing(site);
    yield* buildMiddleRing(site);
    yield* buildUpperRing(site);
    buildPalace(site);
    yield;
    yield* buildFarmland(site);
    const laogai: LaogaiBuild = buildLaogai(site);
    yield;
    this.smoke = smoke.map((e) => ({ ...e, acc: Math.random() }));
    this.figures = new FigureRenderer(this.group, 900);
    this.trains = new TrainSystem(this.group, rail.stations);
    this.lifts = new LiftRuntime(this.group, rail.lifts as LiftDef[], this.bm);
    this.laogai = new LaogaiRuntime(this.group, this.bm, laogai);
    this.crowd = new CrowdSystem(this.group, this.nav, this.figures, site.shops, site.stalls, () => this.trains?.summary() ?? [], () => [...(this.gates?.barriers() ?? []), ...(this.laogai?.barriers() ?? [])]);
    this.overlay = new BssOverlay(() => this.overlayLines());
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
    if (ctx.camera) this.figures.view(ctx.camera);
    if (full) {
      this.gates?.update(dt, ctx);
      this.lifts?.update(dt, ctx, this.figures);
    }
    this.trains.update(dt, ctx, this.figures, this.camPos);
    this.laogai?.update(dt, ctx, full);
    this.crowd?.update(dt, ctx, this.camPos, full);
    this.figures.end();
    if (full) this.updateSmoke(dt, ctx);
    this.figures.group.visible = full;
    // Lamps and lanterns are lit at dusk and put out after dawn.
    const h = ctx.world.sky.timeOfDay;
    const lit = h >= 19.5 || h < 5 ? 1 : h >= 17.5 ? (h - 17.5) / 2 : h < 6.5 ? 1 - (h - 5) / 1.5 : 0;
    if (this.bm) this.bm.glow.emissiveIntensity = 0.12 + 1.5 * lit;
    this.overlay?.update(dt);
  }

  /** Debug overlay text (F3). */
  private overlayLines(): string[] {
    const ctx = this.ctx;
    if (!ctx) return ['Ba Sing Se'];
    const r = ctx.render.stats;
    const c = this.crowd?.stats;
    const f = this.figures?.stats;
    let trains = 0, moving = 0, npcs = 0;
    for (const t of this.trains?.summary() ?? []) {
      trains++;
      if (t.moving) moving++;
    }
    for (const n of ctx.npcs.liveNPCs()) if (n) npcs++;
    return [
      `Ba Sing Se  [F3]  ${this.detailLevel}`,
      `fps     ${r.fps.toFixed(0)}  (${r.frameMs.toFixed(1)} ms)`,
      `draws   ${r.drawCalls}  ·  ${(r.triangles / 1e6).toFixed(2)} M tris`,
      `crowd   ${c?.total ?? 0} simulated · ${c?.out ?? 0} out · ${c?.local ?? 0} around (${(c?.ms ?? 0).toFixed(2)} ms)`,
      `drawn   ${(f?.near ?? 0) + (f?.far ?? 0)} people (${f?.near ?? 0} near)`,
      `npcs    ${npcs} named`,
      `trains  ${trains} running · ${moving} moving${this.trains?.riding ? ' · riding' : ''}`,
    ];
  }

  /** Chimney smoke and stall steam near the camera. */
  private updateSmoke(dt: number, ctx: GameContext): void {
    const c = this.camPos;
    for (const e of this.smoke) {
      const d2 = (e.x - c.x) ** 2 + (e.z - c.z) ** 2;
      if (d2 > (e.steam ? 60 * 60 : 320 * 320)) continue;
      e.acc += dt * e.rate * 3;
      if (e.acc < 1) continue;
      e.acc -= 1;
      this.tmpV.set(e.x, e.y, e.z);
      if (e.steam) ctx.vfx.burst('steam', this.tmpV, { count: 2, radius: 0.2, size: 0.6 });
      else ctx.vfx.burst('smoke', this.tmpV, { count: 2, radius: 0.5, size: 2.4 });
    }
  }

  override onSessionStart(ctx: GameContext): void {
    super.onSessionStart(ctx);
    if (this.building) return;
    for (const s of [this.gates, this.lifts, this.trains, this.laogai, this.crowd]) s?.onSessionEnd();
    this.gates?.onSessionStart(ctx);
    this.lifts?.onSessionStart(ctx);
    this.trains?.onSessionStart(ctx);
    this.laogai?.onSessionStart(ctx);
    this.crowd?.onSessionStart(ctx);
  }

  override onSessionEnd(ctx: GameContext): void {
    super.onSessionEnd(ctx);
    this.trains?.onSessionEnd();
    this.lifts?.onSessionEnd();
    this.gates?.onSessionEnd();
    this.laogai?.onSessionEnd();
    this.crowd?.onSessionEnd();
  }

  override dispose(ctx: GameContext): void {
    super.dispose(ctx);
    this.trains?.dispose();
    this.laogai?.dispose();
    this.laogai = null;
    this.crowd?.dispose();
    this.crowd = null;
    this.overlay?.dispose();
    this.overlay = null;
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
      laogai: () => this.laogai?.state ?? null,
      laogaiRaise: () => this.laogai?.raise(),
      laogaiOpen: () => this.laogai?.openDoor(),
      laogaiSet: (rise: number, open: number) => this.laogai?.setState(rise, open),
      crowd: () => (this.crowd ? { ...this.crowd.stats, figures: { ...this.figures?.stats } } : null),
      /** Sample the train schedules over `seconds` from now (no rendering): speeds, gaps, stops. */
      trainsSoak: (seconds = 300) => (this.trains && this.ctx ? this.trains.soak(this.ctx.time.elapsed + this.trains.timeOffset, seconds) : null),
      overlay: (on?: boolean) => this.overlay?.toggle(on) ?? false,
      overlayText: () => this.overlay?.text ?? '',
      /** Fast-forward the crowd alone (no rendering) by `seconds` of game time at 30 Hz. */
      crowdWarm: (seconds: number) => {
        const ctx = this.ctx;
        const cam = ctx?.camera?.position;
        if (!ctx || !cam || !this.crowd || !this.figures) return false;
        this.camPos.copy(cam);
        for (let i = 0; i < seconds * 30; i++) {
          this.figures.begin(this.camPos);
          this.figures.view(ctx.camera);
          this.crowd.update(1 / 30, ctx, this.camPos, true);
          this.figures.end();
        }
        return true;
      },
      stations: () =>
        this.stations.map((s) => {
          const p = railPath(s.line.id).at(s.s);
          return { id: s.id, line: s.line.id, s: +s.s.toFixed(1), top: s.top, tx: p.tx, tz: p.tz, mark: this.marks[`station_${s.id}`] ?? null, lift: this.marks[`lift_${s.id}`] ?? null };
        }),
      figures: () => this.figures?.stats,
      nav: () => (this.nav ? { nodes: this.nav.nodes.length, components: this.nav.components().slice(0, 5) } : null),
    };
  }
}
