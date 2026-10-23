import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import type { ContentBuilder } from '../../kit/Builder';
import { WaterRegion } from './base';
import { boulder, crystalCluster, disc, emblem, flatRing, mergeParts, panelWithArches, pillow } from './geometry';
import { wtMat, wtWater, wtWaterfall } from './materials';
import {
  COURTYARD,
  COURT_POOL,
  CANALS,
  G0,
  GATE_OPEN,
  HARBOR_OPEN,
  HEALER,
  INNER,
  JETTIES,
  L1,
  L3,
  OASIS,
  PALACE,
  PASSAGE,
  PLAZA,
  PLAZA_C,
  PODIUM_BOTTOM,
  RIVER_ARCH,
  SOUTH_GATE,
  SPAWN,
  T1,
  WALL,
  WL,
  YUGODA_TRAIN,
  gorge,
  gorgeDist,
  gorgeHalf,
  gorgeLevel,
  inRect,
  type Rect,
} from './nwtLayout';
import type { NwtKit } from './nwtKit';
import { buildCaves, buildCourtyard, buildHealer, buildOasis, buildTerraces, disposeFlowerMats } from './nwtPlaces';
import {
  banner,
  barrel,
  canalBoat,
  canalRect,
  crate,
  drift,
  dryingRack,
  flight,
  houseHalf,
  houseKit,
  iceBridge,
  iceSpikes,
  lanternPost,
  parapet,
  placeHouse,
  roundTower,
  V,
  WaterSheets,
  type Archetype,
} from './parts';
import { rasterRects } from './raster';

/**
 * The Northern Water Tribe capital: walls, gates, street podium, canals,
 * the glacier gorge, bridges, residential districts, the Tribal Plaza, the
 * harbor and the outer jetties. Terraces/palace, courtyard, healer, Spirit
 * Oasis and the glacier caves are built in nwtPlaces.ts.
 */

/** Oriented footprint used to keep houses apart and out of streets. */
interface Footprint {
  x: number;
  z: number;
  c: number;
  s: number;
  hw: number;
  hd: number;
}

function inFootprint(f: Footprint, x: number, z: number, m = 0): boolean {
  const dx = x - f.x, dz = z - f.z;
  const lx = dx * f.c - dz * f.s;
  const lz = dx * f.s + dz * f.c;
  return Math.abs(lx) < f.hw + m && Math.abs(lz) < f.hd + m;
}

export function podiumHole(x: number, z: number): boolean {
  for (const k in CANALS) if (inRect(CANALS[k], x, z)) return true;
  if (Math.hypot(x - COURTYARD.x, z - COURTYARD.z) < COURT_POOL.r + 0.8) return true;
  if (x > OASIS[0] + 3 && x < OASIS[2] - 3 && z > OASIS[1] + 3 && z < OASIS[3]) return true;
  const g = gorgeDist(x, z);
  return g.d < g.half + 1.5;
}

export class NorthernWaterTribe extends WaterRegion {
  private readonly ticks: Array<(t: number, dt: number) => void> = [];
  private readonly keepRects: Rect[] = [];
  private readonly keepCircles: Array<{ x: number; z: number; r: number }> = [];
  /** Street corridors (capsules) continuing every bridge on both sides. */
  private readonly keepCaps: Array<{ ax: number; az: number; bx: number; bz: number; r: number }> = [];
  /** Walk-test waypoints published on the debug hook. */
  readonly routes: Record<string, Array<[number, number]>> = {};
  private readonly placed: Footprint[] = [];
  private readonly houseBuilders = new Map<string, ContentBuilder>();
  private readonly propBuilders = new Map<string, ContentBuilder>();
  private kit!: NwtKit;

  constructor() {
    super('nwt_city', { x: -220, z: -1590 }, 560);
  }

  protected construct(ctx: GameContext): void {
    const core = this.builder(this.main);
    const wet = this.builder(this.main);
    const props = this.builder(this.props);
    const sheets = new WaterSheets();
    const g = ctx.settings.data.graphics;
    this.kit = {
      ctx,
      core,
      wet,
      props,
      sheets,
      rnd: new Random(4207),
      density: Math.max(0.3, Math.min(1.5, g.foliageDensity)),
      water: (d) => this.registerWater(d),
      emitter: (p, rate, pos, o, range, amb) => this.ambientEmitter(p, rate, pos, o, range, amb),
      interact: (i) => this.interactable(i),
      npc: (d) => this.ambientNPC(d),
      own: (x) => this.own(x),
      keepRect: (r) => this.keepRects.push(r),
      keepCircle: (x, z, r) => this.keepCircles.push({ x, z, r }),
      onTick: (fn) => this.ticks.push(fn),
      addProp: (o) => this.props.add(o),
    };
    const k = this.kit;
    this.baseKeepOuts();
    this.podium(k);
    this.canals(k);
    this.gorgeWorks(k);
    this.walls(k);
    this.gates(k);
    this.towers(k);
    this.bridges(k);
    buildTerraces(k);
    buildCourtyard(k);
    buildHealer(k);
    buildOasis(k);
    buildCaves(k);
    this.plaza(k);
    this.harbor(k);
    this.outer(k);
    this.houses(k);
    this.streetLife(k);
    this.citizens(k);
    sheets.flush(wet);
  }

  protected override tick(dt: number, ctx: GameContext): void {
    const t = ctx.time.elapsed;
    for (const f of this.ticks) f(t, dt);
  }

  override dispose(ctx: GameContext): void {
    super.dispose(ctx);
    this.ticks.length = 0;
    this.keepRects.length = 0;
    this.keepCircles.length = 0;
    this.placed.length = 0;
    this.houseBuilders.clear();
    this.propBuilders.clear();
    disposeFlowerMats();
  }

  // ---------------------------------------------------------------------------
  // Layout helpers
  // ---------------------------------------------------------------------------

  private baseKeepOuts(): void {
    const kr = (r: Rect) => this.keepRects.push(r);
    const kc = (x: number, z: number, r: number) => this.keepCircles.push({ x, z, r });
    // Canals with their quay streets (Grand Canal quays are wider).
    for (const [id, r] of Object.entries(CANALS)) {
      const m = id.startsWith('grand') || id === 'basin' ? 12 : 5;
      kr([r[0] - m, r[1] - 5, r[2] + m, r[3] + 5]);
    }
    kr([PLAZA[0] - 3, PLAZA[1] - 3, PLAZA[2] + 3, PLAZA[3] + 3]);
    kr([T1[0] - 4, T1[1] - 16, T1[2] + 2, T1[3]]);
    kr([PASSAGE[0] - 1, PASSAGE[1] - 4, PASSAGE[2] + 4, PASSAGE[3]]);
    kr([OASIS[0] - 4, OASIS[1] - 4, OASIS[2] + 4, OASIS[3]]);
    kr([-286, -1744, -246, -1735]); // wall stairs
    kr([WALL.w1, -1508, WALL.w1 + 12, -1492]); // west postern
    kc(COURTYARD.x, COURTYARD.z, COURTYARD.r + 5);
    kc(YUGODA_TRAIN.x, YUGODA_TRAIN.z, YUGODA_TRAIN.r + 2);
    kc(HEALER.x, HEALER.z, 10);
    kc(SPAWN.x, SPAWN.z, 9);
    kc(-220, -1735, 9);
    kc(-60, -1680, 9);
  }

  private fits(f: Footprint): boolean {
    const [ix0, iz0, ix1, iz1] = INNER;
    const pts: Array<[number, number]> = [];
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const lx = u * (f.hw - 0.25), lz = v * (f.hd - 0.25);
        pts.push([f.x + lx * f.c + lz * f.s, f.z - lx * f.s + lz * f.c]);
      }
    }
    for (const [x, z] of pts) {
      if (x < ix0 + 1.5 || x > ix1 - 1.5 || z < iz0 + 1.5 || z > iz1 - 1.5) return false;
      for (const r of this.keepRects) if (inRect(r, x, z)) return false;
      for (const c of this.keepCircles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return false;
      for (const c of this.keepCaps) if (segDist(x, z, c.ax, c.az, c.bx, c.bz) < c.r) return false;
      const g = gorgeDist(x, z);
      if (g.d < g.half + 9.5) return false;
      for (const p of this.placed) if (inFootprint(p, x, z, 1.2)) return false;
    }
    for (const p of this.placed) if (inFootprint(f, p.x, p.z, 1.2)) return false;
    return true;
  }

  private chunkKey(x: number, z: number): string {
    const cx = Math.max(0, Math.min(2, Math.floor((x - INNER[0]) / 112)));
    const cz = Math.max(0, Math.min(2, Math.floor((z - INNER[1]) / 110)));
    return `${cx}_${cz}`;
  }

  private houseBuilder(x: number, z: number): ContentBuilder {
    const key = this.chunkKey(x, z);
    let b = this.houseBuilders.get(key);
    if (!b) {
      b = this.builder(this.main);
      this.houseBuilders.set(key, b);
    }
    return b;
  }

  /** Prop builder for a city chunk (culled by camera distance). */
  private propBuilder(x: number, z: number): ContentBuilder {
    const key = this.chunkKey(x, z);
    let b = this.propBuilders.get(key);
    if (!b) {
      const [cx, cz] = key.split('_').map(Number);
      const g = this.district(`props_${key}`, INNER[0] + (cx + 0.5) * 112, INNER[1] + (cz + 0.5) * 110, 230);
      b = this.builder(g);
      this.propBuilders.set(key, b);
    }
    return b;
  }

  // ---------------------------------------------------------------------------
  // Podium & canals
  // ---------------------------------------------------------------------------

  private podium(k: NwtKit): void {
    const solid = (x: number, z: number) => !podiumHole(x, z);
    const areas: Rect[] = [
      INNER,
      [GATE_OPEN.x0, WALL.n0, GATE_OPEN.x1, WALL.n1],
      [HARBOR_OPEN.x0, WALL.n0, HARBOR_OPEN.x1, WALL.n1],
      [WALL.w0, RIVER_ARCH.z0, WALL.w1, RIVER_ARCH.z1],
      [WALL.w0, -1502, WALL.w1, -1498], // west postern passage
      ...JETTIES,
    ];
    // Visual: only the walkable top (one quad per rectangle, merged) so no internal
    // side faces z-fight; canal walls get explicit facings in canalEdges().
    // Collision: one walkable box per rectangle.
    const paving = wtMat('paving');
    for (const a of areas) {
      for (const r of rasterRects(a[0], a[1], a[2], a[3], 1, solid)) {
        const w = r.x1 - r.x0, d = r.z1 - r.z0;
        const top = new THREE.PlaneGeometry(w, d);
        top.rotateX(-Math.PI / 2);
        k.core.mesh(paving, top, { x: (r.x0 + r.x1) / 2, y: L1, z: (r.z0 + r.z1) / 2 }, { castShadow: false });
        top.dispose();
        k.core.collider({ shape: 'box', x: (r.x0 + r.x1) / 2, y: (L1 + PODIUM_BOTTOM) / 2, z: (r.z0 + r.z1) / 2, hx: w / 2, hy: (L1 - PODIUM_BOTTOM) / 2, hz: d / 2, walkable: true, solid: true, surface: 'packedsnow' });
      }
    }
    // Jetty side walls (they stand on the open snowfield outside the sea wall).
    for (const j of JETTIES) {
      for (const [x, sx] of [[j[0], -1], [j[2], 1]] as const) {
        k.core.box(wtMat('ice_wall'), { x: x - sx * 0.2, y: (L1 + 3.6) / 2, z: (j[1] + j[3]) / 2, sx: 0.4, sy: L1 - 3.6, sz: j[3] - j[1] }, { castShadow: false });
      }
      k.core.box(wtMat('ice_wall'), { x: (j[0] + j[2]) / 2, y: (L1 + 3.6) / 2, z: j[1] + 0.2, sx: j[2] - j[0], sy: L1 - 3.6, sz: 0.4 }, { castShadow: false });
    }
  }

  private canals(k: NwtKit): void {
    const water = wtWater('canal');
    for (const [id, r] of Object.entries(CANALS)) {
      canalRect(k.core, k.sheets, water, r[0], r[1], r[2], r[3], WL, 4.06);
      this.canalEdges(k, r);
      void id;
    }
    // Waterbending sources (linear canals; unlimited like rivers).
    const src = (id: string, label: string, path: Array<{ x: number; z: number }>, r: number) =>
      k.water({ id: `nwt:${id}`, type: 'canal', label, x: path[0].x, y: WL, z: path[0].z, r, path, capacity: Infinity, regen: 0, size: 'large' });
    src('grand_canal', 'Grand Canal', [{ x: -220, z: -1834 }, { x: -220, z: -1636 }], 8);
    src('moon_basin', 'Moon Basin', [{ x: -240, z: -1628 }, { x: -200, z: -1628 }], 8);
    src('north_canal', 'North Canal', [{ x: -328, z: -1707 }, { x: -48, z: -1707 }], 5);
    src('mid_canal', 'Market Canal', [{ x: -258, z: -1648 }, { x: -106, z: -1648 }], 4);
    src('east_canal', 'East Canal', [{ x: -145, z: -1700 }, { x: -145, z: -1608 }], 5);
    src('harbor', 'Harbor Basin', [{ x: -75, z: -1738 }, { x: -75, z: -1646 }], 29);
    src('harbor_channel', 'Harbor Channel', [{ x: -75, z: -1834 }, { x: -75, z: -1742 }], 9);
  }

  /** Ice coping and wall facing along canal edges that border the street. */
  private canalEdges(k: NwtKit, r: Rect): void {
    const edges: Array<[number, number, number, number, number, number]> = [
      // ax, az, bx, bz, outward nx, nz
      [r[0], r[1], r[2], r[1], 0, -1],
      [r[0], r[3], r[2], r[3], 0, 1],
      [r[0], r[1], r[0], r[3], -1, 0],
      [r[2], r[1], r[2], r[3], 1, 0],
    ];
    const step = 2;
    for (const [ax, az, bx, bz, nx, nz] of edges) {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / step));
      let runStart = -1;
      const flush = (i0: number, i1: number) => {
        const t0 = i0 / n, t1 = i1 / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const l = Math.hypot(x1 - x0, z1 - z0);
        if (l < 0.5) return;
        const yaw = Math.atan2(-(z1 - z0), x1 - x0);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        // coping (street side) and ice facing on the wall face
        k.core.box(wtMat('ice_trim'), { x: cx + nx * 0.35, y: L1 - 0.24, z: cz + nz * 0.35, sx: l, sy: 0.52, sz: 0.9, yaw }, { castShadow: false });
        k.core.box(wtMat('ice_wall'), { x: cx - nx * 0.05, y: (L1 - 0.4 + 4.0) / 2, z: cz - nz * 0.05, sx: l, sy: L1 - 0.4 - 4.0, sz: 0.12, yaw }, { castShadow: false });
      };
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = ax + (bx - ax) * t + nx * 0.8, z = az + (bz - az) * t + nz * 0.8;
        const street = !podiumHole(x, z) && inRect([WALL.w0, -1840, WALL.e1, WALL.s1], x, z) && !(z < WALL.n1 && z > WALL.n0 && !inRect([GATE_OPEN.x0, WALL.n0, GATE_OPEN.x1, WALL.n1], x, z) && !inRect([HARBOR_OPEN.x0, WALL.n0, HARBOR_OPEN.x1, WALL.n1], x, z));
        const onJetty = z < WALL.n0 ? JETTIES.some((j) => inRect(j, x, z)) : true;
        if (street && onJetty) {
          if (runStart < 0) runStart = i;
        } else if (runStart >= 0) {
          flush(runStart, i);
          runStart = -1;
        }
      }
      if (runStart >= 0) flush(runStart, n);
    }
  }

  // ---------------------------------------------------------------------------
  // The glacier gorge (river) with quay walls, ghats and a culvert
  // ---------------------------------------------------------------------------

  private gorgeWorks(k: NwtKit): void {
    const g = gorge();
    if (!g) return;
    const line = g.river.line;
    let s = g.s0;
    while (s < g.s1 && line.pointAt(s).x < WALL.w0 - 3) s += 1;
    const sStart = s;
    const SEG = 10;
    const bridgeS = this.gorgeBridgeS();
    const ghatS = [this.sAtZ(-1592), this.sAtZ(-1532)];
    for (s = sStart; s < g.s1 - 0.01; s += SEG) {
      const sb = Math.min(g.s1, s + SEG);
      const pa = line.pointAt(s), pb = line.pointAt(sb);
      const dx = pb.x - pa.x, dz = pb.z - pa.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const tx = dx / len, tz = dz / len;
      const nx = -tz, nz = tx;
      const yaw = Math.atan2(-tz, tx);
      const half = gorgeHalf(g, (s + sb) / 2);
      for (const side of [-1, 1]) {
        const off = half + 2.25;
        const cx = (pa.x + pb.x) / 2 + nx * side * off, cz = (pa.z + pb.z) / 2 + nz * side * off;
        k.core.box(wtMat('ice_massive'), { x: cx, y: (L1 - 2.6) / 2, z: cz, sx: len + 0.9, sy: L1 + 2.6, sz: 4.5, yaw }, { collide: true, walkable: true, surface: 'packedsnow' });
        // Parapet along the edge, interrupted at bridges and ghats.
        const n = Math.max(1, Math.round(len / 2.5));
        let run: number | null = null;
        const emitRun = (i0: number, i1: number) => {
          const sa = s + ((sb - s) * i0) / n, sb2 = s + ((sb - s) * i1) / n;
          const qa = line.pointAt(sa), qb = line.pointAt(sb2);
          const ha = gorgeHalf(g, sa) + 0.3, hb = gorgeHalf(g, sb2) + 0.3;
          parapet(k.core, 'ice_wall', qa.x + nx * side * ha, qa.z + nz * side * ha, qb.x + nx * side * hb, qb.z + nz * side * hb, L1, 0.85, 0.5, 'snow');
        };
        for (let i = 0; i < n; i++) {
          const sm = s + ((sb - s) * (i + 0.5)) / n;
          const blocked = bridgeS.some((b) => Math.abs(b - sm) < 4.2) || ghatS.some((gs, gi) => (gi === 0 ? side === -1 : side === 1) && sm > gs + 7 && sm < gs + 11);
          const outside = line.pointAt(sm).x < WALL.w1 + 0.5;
          if (!blocked && !outside) {
            if (run === null) run = i;
          } else if (run !== null) {
            emitRun(run, i);
            run = null;
          }
        }
        if (run !== null) emitRun(run, n);
      }
    }
    // End wall + culvert where the river disappears under the city.
    {
      const pe = line.pointAt(g.s1);
      const te = line.tangentAt(g.s1 - 0.5);
      const half = gorgeHalf(g, g.s1);
      const yaw = Math.atan2(-te.z, te.x);
      k.core.box(wtMat('ice_massive'), { x: pe.x + te.x * 2.25, y: (L1 - 2.6) / 2, z: pe.z + te.z * 2.25, sx: 4.5, sy: L1 + 2.6, sz: 2 * (half + 4.5), yaw }, { collide: true, walkable: true, surface: 'packedsnow' });
      const arch = panelWithArches(2 * half, L1 + 2.6, 0.6, [{ x: 0, y: 2.6 + gorgeLevel() - 0.6, w: 7, h: 4.2 }]);
      k.core.mesh(wtMat('ice_trim'), arch, { x: pe.x - te.x * 0.2, y: -2.6, z: pe.z - te.z * 0.2, yaw: Math.atan2(te.x, te.z) + Math.PI / 2 });
      arch.dispose();
      const dark = new THREE.PlaneGeometry(7.2, 4.6);
      k.core.mesh(wtMat('dark'), dark, { x: pe.x + te.x * 0.05, y: gorgeLevel() + 1.6, z: pe.z + te.z * 0.05, yaw: Math.atan2(-te.x, -te.z) });
      dark.dispose();
      k.emitter('mist', 2, V(pe.x - te.x * 2, gorgeLevel() + 0.6, pe.z - te.z * 2), { radius: 2.5 }, 60, true);
    }
    // Ghats: stairs down to the water (one per bank) so swimmers can climb out.
    ghatS.forEach((gs, gi) => {
      const side = gi === 0 ? -1 : 1;
      const p0 = line.pointAt(gs), p1 = line.pointAt(gs + 10);
      const t = line.tangentAt(gs + 5);
      const nx = -t.z, nz = t.x;
      const half = Math.min(gorgeHalf(g, gs), gorgeHalf(g, gs + 10)) - 1.3;
      const lvl = gorgeLevel();
      const bx = p0.x + nx * side * half, bz = p0.z + nz * side * half;
      const tx = p1.x + nx * side * half, tz = p1.z + nz * side * half;
      // landing at the water
      k.core.box(wtMat('ice_trim'), { x: bx - t.x * 1.6, y: (lvl + 0.55 - 2.5) / 2, z: bz - t.z * 1.6, sx: 3.4, sy: lvl + 0.55 + 2.5, sz: 2.4, yaw: Math.atan2(-t.z, t.x) }, { collide: true, walkable: true, surface: 'ice' });
      flight(k.core, V(bx, lvl + 0.55, bz), V(tx, L1, tz), 2.4, 'ice_trim', null, 'ice');
    });
  }

  /** Arc length of the gorge centreline nearest to a given z (inside the city). */
  private sAtZ(z: number): number {
    const g = gorge();
    if (!g) return 0;
    let best = g.s0, bd = Infinity;
    for (let s = g.s0; s <= g.s1; s += 0.5) {
      const d = Math.abs(g.river.line.pointAt(s).z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private gorgeBridgeS(): number[] {
    return [this.sAtZ(-1622), this.sAtZ(-1566), this.sAtZ(-1500)];
  }

  // ---------------------------------------------------------------------------
  // Walls, gates, towers
  // ---------------------------------------------------------------------------

  private walls(k: NwtKit): void {
    const cb = k.core;
    const ice = wtMat('ice_massive');
    const wallBox = (x0: number, z0: number, x1: number, z1: number, top: number, walkTop = true) => {
      cb.box(ice, { x: (x0 + x1) / 2, y: (top + 2) / 2, z: (z0 + z1) / 2, sx: x1 - x0, sy: top - 2, sz: z1 - z0 }, { collide: true, walkable: walkTop, surface: 'snow' });
    };
    // North sea wall: three spans around the gates.
    const N = WALL;
    wallBox(N.w0, N.n0, GATE_OPEN.x0 - 12, N.n1, N.nTop);
    wallBox(GATE_OPEN.x1 + 12, N.n0, HARBOR_OPEN.x0 - 8, N.n1, N.nTop);
    wallBox(HARBOR_OPEN.x1 + 8, N.n0, N.e1, N.n1, N.nTop);
    // Battlements and pilasters along the north wall (sea side and city side).
    const rnd = new Random(77);
    for (let x = N.w0 + 6; x < N.e1 - 4; x += 14) {
      if (x > GATE_OPEN.x0 - 14 && x < GATE_OPEN.x1 + 14) continue;
      if (x > HARBOR_OPEN.x0 - 10 && x < HARBOR_OPEN.x1 + 10) continue;
      cb.box(ice, { x, y: (N.nTop + 2) / 2 - 1, z: N.n0 - 1.1, sx: 3.2, sy: N.nTop - 4, sz: 2.2 });
      cb.box(wtMat('ice_trim'), { x, y: L1 + 3, z: N.n1 + 0.6, sx: 2.6, sy: 4, sz: 1.2 });
    }
    for (let x = N.w0 + 2; x < N.e1 - 1; x += 4) {
      if (x > GATE_OPEN.x0 - 13 && x < GATE_OPEN.x1 + 13) continue;
      if (x > HARBOR_OPEN.x0 - 9 && x < HARBOR_OPEN.x1 + 9) continue;
      cb.box(ice, { x, y: N.nTop + 0.7, z: N.n0 + 0.7, sx: 2.2, sy: 1.4, sz: 1.2 });
    }
    // Snow cap along the wall walk.
    const cap = pillow(N.e1 - N.w0, 12.6, 0.4, 0.2, 1);
    cb.mesh(wtMat('snow'), cap, { x: (N.w0 + N.e1) / 2, y: N.nTop - 0.12, z: (N.n0 + N.n1) / 2 }, { castShadow: false });
    cap.dispose();
    // Stairs up to the wall walk (city side, west of the gate).
    flight(cb, V(-250, L1, -1740.5), V(-282, N.nTop, -1740.5), 5, 'ice_trim', 'ice_wall', 'ice');
    cb.box(wtMat('ice_trim'), { x: -284.5, y: (N.nTop + L1) / 2, z: -1740.5, sx: 5, sy: N.nTop - L1, sz: 5 }, { collide: true, walkable: true, surface: 'ice' });

    // West cliffs (with the river arch and the postern).
    wallBox(WALL.w0, N.n0, WALL.w1, -1502.25, WALL.wTop);
    wallBox(WALL.w0, -1497.75, WALL.w1, RIVER_ARCH.z0, WALL.wTop);
    wallBox(WALL.w0, RIVER_ARCH.z1, WALL.w1, WALL.s1, WALL.wTop);
    // East cliffs.
    wallBox(WALL.e0, N.n0, WALL.e1, WALL.s1, WALL.eTop);
    // South glacier cliffs (with the Glacier Pass Gate).
    wallBox(WALL.w0, WALL.s0, SOUTH_GATE.x0 - 6, WALL.s1, WALL.sTop);
    wallBox(SOUTH_GATE.x1 + 6, WALL.s0, WALL.e1, WALL.s1, WALL.sTop);
    // Irregular ice-cliff masses on the outer faces so the walls read as glacier cliffs.
    const cliffMass = (x: number, z: number, w: number, d: number, h: number, yaw: number) => {
      cb.box(ice, { x, y: 2 + h / 2, z, sx: w, sy: h, sz: d, yaw });
      const p = pillow(w + 0.6, d + 0.6, 0.7, 0.3, 1);
      cb.mesh(wtMat('snow'), p, { x, y: 2 + h - 0.2, z, yaw }, { castShadow: false });
      p.dispose();
    };
    for (let z = N.n0 + 8; z < WALL.s1 - 4; z += 16) {
      if (z > RIVER_ARCH.z0 - 10 && z < RIVER_ARCH.z1 + 10) continue;
      cliffMass(WALL.w0 - 4, z + rnd.range(-3, 3), rnd.range(6, 10), rnd.range(12, 17), WALL.wTop - 2 + rnd.range(-6, 8), rnd.range(-0.15, 0.15));
      cliffMass(WALL.e1 + 4, z + rnd.range(-3, 3), rnd.range(6, 10), rnd.range(12, 17), WALL.eTop - 2 + rnd.range(-6, 8), rnd.range(-0.15, 0.15));
    }
    for (let x = WALL.w0 + 6; x < WALL.e1 - 4; x += 15) {
      if (x > SOUTH_GATE.x0 - 14 && x < SOUTH_GATE.x1 + 14) continue;
      cliffMass(x + rnd.range(-3, 3), WALL.s1 + 5, rnd.range(12, 18), rnd.range(7, 11), WALL.sTop + rnd.range(-4, 12), rnd.range(-0.12, 0.12));
    }
    // Inner faces: vertical grooves on the side cliffs.
    for (let z = N.n1 + 10; z < WALL.s0 - 6; z += 12) {
      if (z > RIVER_ARCH.z0 - 6 && z < RIVER_ARCH.z1 + 6) continue;
      if (z > -1508 && z < -1492) continue;
      cb.box(wtMat('ice_trim'), { x: WALL.w1 + 0.5, y: 15, z, sx: 1.0, sy: 22, sz: 2.2 });
      cb.box(wtMat('ice_trim'), { x: WALL.e0 - 0.5, y: 15, z, sx: 1.0, sy: 22, sz: 2.2 });
    }
    // Icicle / crystal clusters on the cliffs.
    for (let i = 0; i < 18; i++) {
      const side = i % 3;
      const x = side === 0 ? WALL.w1 + 0.8 : side === 1 ? WALL.e0 - 0.8 : rnd.range(WALL.w1 + 10, WALL.e0 - 10);
      const z = side === 2 ? WALL.s0 - 0.8 : rnd.range(N.n1 + 20, WALL.s0 - 20);
      if (side === 2 && x > T1[0] - 6 && x < PASSAGE[2] + 6) continue;
      if (side === 2 && x > OASIS[0] - 2 && x < OASIS[2] + 2) continue;
      iceSpikes(k.props, x, L1 - 0.2, z, rnd.range(2.5, 5), 300 + i);
    }
  }

  private gates(k: NwtKit): void {
    const cb = k.core;
    const N = WALL;
    // --- Great Water Gate: a 52 m arched span through the 12 m sea wall.
    {
      const w = GATE_OPEN.x1 - GATE_OPEN.x0 + 24;
      const g = panelWithArches(w, N.nTop - 2, N.n1 - N.n0, [{ x: 0, y: 0, w: GATE_OPEN.x1 - GATE_OPEN.x0, h: GATE_OPEN.top - 2 }], 14);
      cb.mesh(wtMat('ice_massive'), g, { x: (GATE_OPEN.x0 + GATE_OPEN.x1) / 2, y: 2, z: (N.n0 + N.n1) / 2 });
      g.dispose();
      // Pylons and lintel colliders.
      cb.collider({ shape: 'box', x: GATE_OPEN.x0 - 6, y: (N.nTop + 2) / 2, z: (N.n0 + N.n1) / 2, hx: 6, hy: (N.nTop - 2) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      cb.collider({ shape: 'box', x: GATE_OPEN.x1 + 6, y: (N.nTop + 2) / 2, z: (N.n0 + N.n1) / 2, hx: 6, hy: (N.nTop - 2) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      cb.collider({ shape: 'box', x: (GATE_OPEN.x0 + GATE_OPEN.x1) / 2, y: (N.nTop + GATE_OPEN.top) / 2, z: (N.n0 + N.n1) / 2, hx: (GATE_OPEN.x1 - GATE_OPEN.x0) / 2, hy: (N.nTop - GATE_OPEN.top) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      // Archivolt trim and the great emblem on both faces.
      for (const side of [-1, 1]) {
        const fz = side < 0 ? N.n0 - 0.3 : N.n1 + 0.3;
        const ring = panelWithArches(GATE_OPEN.x1 - GATE_OPEN.x0 + 4, GATE_OPEN.top - 0.5, 0.6, [{ x: 0, y: 0, w: GATE_OPEN.x1 - GATE_OPEN.x0, h: GATE_OPEN.top - 2.4 }], 14);
        cb.mesh(wtMat('ice_trim'), ring, { x: -220, y: 2, z: fz });
        ring.dispose();
        const yaw = side < 0 ? Math.PI : 0;
        const d = disc(3.2, 0.5, 32);
        cb.mesh(wtMat('ice_trim'), d, { x: -220, y: N.nTop - 2.2, z: fz + side * 0.2, yaw });
        d.dispose();
        const e = emblem(2.7, 0.3, true);
        cb.mesh(wtMat('snow'), e, { x: -220, y: N.nTop - 2.2, z: fz + side * 0.55, yaw });
        e.dispose();
        banner(k.props, GATE_OPEN.x0 - 6, N.nTop - 3, fz + side * 0.4, yaw, 3.2, 9, 'banner_water');
        banner(k.props, GATE_OPEN.x1 + 6, N.nTop - 3, fz + side * 0.4, yaw, 3.2, 9, 'banner_water');
      }
      // Ice portcullis teeth hanging inside the arch crown (raised).
      for (let i = -5; i <= 5; i++) {
        const x = -220 + i * 2.2;
        const crown = GATE_OPEN.top - 2 - (Math.abs(i) / 6) ** 2 * 6;
        k.core.box(wtMat('ice_clear'), { x, y: 2 + crown - 0.9, z: (N.n0 + N.n1) / 2, sx: 0.5, sy: 1.8, sz: 0.5 }, { castShadow: false });
      }
    }
    // --- Harbor Gate (water only, narrow ledges).
    {
      const w = HARBOR_OPEN.x1 - HARBOR_OPEN.x0 + 16;
      const g = panelWithArches(w, N.nTop - 2, N.n1 - N.n0, [{ x: 0, y: 0, w: HARBOR_OPEN.x1 - HARBOR_OPEN.x0, h: HARBOR_OPEN.top - 2 }], 12);
      const cx = (HARBOR_OPEN.x0 + HARBOR_OPEN.x1) / 2;
      cb.mesh(wtMat('ice_massive'), g, { x: cx, y: 2, z: (N.n0 + N.n1) / 2 });
      g.dispose();
      cb.collider({ shape: 'box', x: HARBOR_OPEN.x0 - 4, y: (N.nTop + 2) / 2, z: (N.n0 + N.n1) / 2, hx: 4, hy: (N.nTop - 2) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      cb.collider({ shape: 'box', x: HARBOR_OPEN.x1 + 4, y: (N.nTop + 2) / 2, z: (N.n0 + N.n1) / 2, hx: 4, hy: (N.nTop - 2) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      cb.collider({ shape: 'box', x: cx, y: (N.nTop + HARBOR_OPEN.top) / 2, z: (N.n0 + N.n1) / 2, hx: (HARBOR_OPEN.x1 - HARBOR_OPEN.x0) / 2, hy: (N.nTop - HARBOR_OPEN.top) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      for (const side of [-1, 1]) {
        const fz = side < 0 ? N.n0 - 0.3 : N.n1 + 0.3;
        const d = disc(2.2, 0.5, 28);
        cb.mesh(wtMat('ice_trim'), d, { x: cx, y: N.nTop - 3.6, z: fz + side * 0.2, yaw: side < 0 ? Math.PI : 0 });
        d.dispose();
        const e = emblem(1.85, 0.3, false);
        cb.mesh(wtMat('snow'), e, { x: cx, y: N.nTop - 3.6, z: fz + side * 0.55, yaw: side < 0 ? Math.PI : 0 });
        e.dispose();
      }
    }
    // --- River arch in the west cliffs (the gorge enters the city).
    {
      const w = RIVER_ARCH.z1 - RIVER_ARCH.z0 + 10;
      const g = panelWithArches(w, WALL.wTop + 2.6, WALL.w1 - WALL.w0, [{ x: 0, y: 0, w: RIVER_ARCH.z1 - RIVER_ARCH.z0, h: RIVER_ARCH.top + 2.6 }], 14);
      cb.mesh(wtMat('ice_massive'), g, { x: (WALL.w0 + WALL.w1) / 2, y: -2.6, z: (RIVER_ARCH.z0 + RIVER_ARCH.z1) / 2, yaw: Math.PI / 2 });
      g.dispose();
      cb.collider({ shape: 'box', x: (WALL.w0 + WALL.w1) / 2, y: (WALL.wTop + RIVER_ARCH.top) / 2, z: (RIVER_ARCH.z0 + RIVER_ARCH.z1) / 2, hx: 6, hy: (WALL.wTop - RIVER_ARCH.top) / 2, hz: (RIVER_ARCH.z1 - RIVER_ARCH.z0) / 2, walkable: true, solid: true, surface: 'snow' });
      k.emitter('mist', 2.5, V(WALL.w0 - 20, 2, -1425), { radius: 4 }, 120, true);
    }
    // --- West postern (path to the glacier caves).
    {
      const g = panelWithArches(16, WALL.wTop - 2, WALL.w1 - WALL.w0, [{ x: 0, y: L1 - 2, w: 4.5, h: 5.6 }], 8);
      cb.mesh(wtMat('ice_massive'), g, { x: (WALL.w0 + WALL.w1) / 2, y: 2, z: -1500, yaw: Math.PI / 2 });
      g.dispose();
      cb.collider({ shape: 'box', x: (WALL.w0 + WALL.w1) / 2, y: (WALL.wTop + L1 + 5.6) / 2, z: -1500, hx: 6, hy: (WALL.wTop - L1 - 5.6) / 2, hz: 2.25, walkable: true, solid: true, surface: 'snow' });
      const outside = heightAt(WALL.w0 - 9, -1500);
      flight(cb, V(WALL.w0 - 9, Math.min(outside, L1 - 0.3), -1500), V(WALL.w0, L1, -1500), 4, 'ice_trim', 'ice_wall', 'ice');
      lanternPost(k.props, WALL.w0 - 11, outside, -1503.5, 'blue');
    }
    // --- Glacier Pass Gate (south) with the ramp down to the northern road.
    {
      const w = SOUTH_GATE.x1 - SOUTH_GATE.x0 + 12;
      const g = panelWithArches(w, WALL.sTop - 2, WALL.s1 - WALL.s0, [{ x: 0, y: 0, w: SOUTH_GATE.x1 - SOUTH_GATE.x0, h: SOUTH_GATE.top - 2 }], 12);
      const cx = (SOUTH_GATE.x0 + SOUTH_GATE.x1) / 2;
      cb.mesh(wtMat('ice_massive'), g, { x: cx, y: 2, z: (WALL.s0 + WALL.s1) / 2 });
      g.dispose();
      cb.collider({ shape: 'box', x: SOUTH_GATE.x0 - 3, y: (WALL.sTop + 2) / 2, z: (WALL.s0 + WALL.s1) / 2, hx: 3, hy: (WALL.sTop - 2) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      cb.collider({ shape: 'box', x: SOUTH_GATE.x1 + 3, y: (WALL.sTop + 2) / 2, z: (WALL.s0 + WALL.s1) / 2, hx: 3, hy: (WALL.sTop - 2) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      cb.collider({ shape: 'box', x: cx, y: (WALL.sTop + SOUTH_GATE.top) / 2, z: (WALL.s0 + WALL.s1) / 2, hx: (SOUTH_GATE.x1 - SOUTH_GATE.x0) / 2, hy: (WALL.sTop - SOUTH_GATE.top) / 2, hz: 6, walkable: true, solid: true, surface: 'snow' });
      // Ramp (walkable) from the passage (L1) down through the gate to the terrain.
      const outsideY = heightAt(cx, WALL.s1 + 2);
      cb.stairs({ from: V(cx, Math.min(outsideY, L1 - 0.25), WALL.s1 + 2), to: V(cx, L1, WALL.s0), width: SOUTH_GATE.x1 - SOUTH_GATE.x0, material: wtMat('paving'), stepHeight: 0.18, surface: 'packedsnow' });
      for (const side of [-1, 1]) {
        const d = disc(2.0, 0.5, 28);
        const fz = side < 0 ? WALL.s0 - 0.3 : WALL.s1 + 0.3;
        cb.mesh(wtMat('ice_trim'), d, { x: cx, y: WALL.sTop - 6, z: fz + side * 0.2, yaw: side < 0 ? Math.PI : 0 });
        d.dispose();
        const e = emblem(1.7, 0.3, false);
        cb.mesh(wtMat('snow'), e, { x: cx, y: WALL.sTop - 6, z: fz + side * 0.55, yaw: side < 0 ? Math.PI : 0 });
        e.dispose();
      }
      // Lanterns guiding to the road outside.
      const road = { x: -194, z: WALL.s1 + 6 };
      for (let i = 0; i < 4; i++) {
        const t = (i + 0.5) / 4;
        const x = cx + (road.x - cx) * t + 4, z = WALL.s1 + 6 + i * 3;
        lanternPost(k.props, x, heightAt(x, z), z, 'blue');
      }
      // Outpost at the glacier pass.
      const ox = -212, oz = -1386;
      roundTower(cb, ox, oz, heightAt(ox, oz) - 0.5, 4.2, 14, 'bulb', true);
      banner(k.props, ox, heightAt(ox, oz) + 12, oz + 4.3, 0, 1.6, 4, 'banner_water');
    }
  }

  private towers(k: NwtKit): void {
    const cb = k.core;
    const T: Array<[number, number, number, number, 'dome' | 'bulb' | 'flat']> = [
      [WALL.w0 + 2, (WALL.n0 + WALL.n1) / 2, 9, 34, 'bulb'],
      [WALL.e1 - 2, (WALL.n0 + WALL.n1) / 2, 9, 34, 'bulb'],
      [GATE_OPEN.x0 - 9, WALL.n0 - 2, 7.5, 38, 'bulb'],
      [GATE_OPEN.x1 + 9, WALL.n0 - 2, 7.5, 38, 'bulb'],
      [HARBOR_OPEN.x0 - 6, WALL.n0 - 1, 5.5, 33, 'dome'],
      [HARBOR_OPEN.x1 + 6, WALL.n0 - 1, 5.5, 33, 'dome'],
      [-318, WALL.n0 - 1, 5, 31, 'dome'],
      [-150, WALL.n0 - 1, 5, 31, 'dome'],
      [WALL.w0 + 2, WALL.s1 - 2, 8, 36, 'dome'],
      [WALL.e1 - 2, WALL.s1 - 2, 8, 36, 'dome'],
      [WALL.w0 + 1, -1600, 6, 32, 'dome'],
      [WALL.e1 - 1, -1600, 6, 32, 'dome'],
    ];
    for (const [x, z, r, h, crown] of T) {
      const top = roundTower(cb, x, z, 2, r, h, crown, true);
      if (crown === 'bulb') {
        k.props.instance('nwt_tower_finial', () => new THREE.ConeGeometry(0.35, 3, 8), wtMat('ice_trim'), new THREE.Matrix4().makeTranslation(x, top + 1.2, z));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Bridges
  // ---------------------------------------------------------------------------

  private bridgeAt(k: NwtKit, ax: number, az: number, bx: number, bz: number, width: number, arch: number, emblem: boolean, baseY = 4.06): void {
    iceBridge(k.core, { a: V(ax, L1, az), b: V(bx, L1, bz), width, arch, baseY, emblem, parapet: 0.9 });
    // Keep a street open on both sides, continuing the bridge axis.
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const reach = baseY < 2 ? 26 : 12;
    this.keepCaps.push({ ax: ax - ux * reach, az: az - uz * reach, bx: bx + ux * reach, bz: bz + uz * reach, r: width / 2 + 1.6 });
    lanternPost(k.props, ax + (Math.abs(bx - ax) > 1 ? 0 : width / 2 + 0.8), 0 + L1, az + (Math.abs(bx - ax) > 1 ? width / 2 + 0.8 : 0), 'blue', 2.4);
  }

  private bridges(k: NwtKit): void {
    // Grand Canal (E-W crossings).
    this.bridgeAt(k, -232, -1735, -208, -1735, 12, 0.7, true); // Great Gate bridge (landmark)
    this.bridgeAt(k, -232, -1688, -208, -1688, 6, 1.4, true);
    this.bridgeAt(k, -232, -1664, -208, -1664, 6, 1.4, false);
    // North Cross Canal (N-S crossings).
    for (const x of [-234, -206]) this.bridgeAt(k, x, -1716, x, -1698, 8, 1.0, x === -234);
    for (const x of [-312, -270, -176, -122]) this.bridgeAt(k, x, -1716, x, -1698, 5, 1.2, x === -270 || x === -122);
    // Market Canal (N-S crossings).
    for (const x of [-234, -206]) this.bridgeAt(k, x, -1656, x, -1640, 8, 0.9, false);
    for (const x of [-250, -178, -120]) this.bridgeAt(k, x, -1656, x, -1640, 5, 1.1, x === -178);
    // East Canal (E-W crossings).
    for (const z of [-1680, -1626]) this.bridgeAt(k, -154, z, -136, z, 5, 1.0, z === -1626);
    // Gorge bridges (high arched spans).
    const g = gorge();
    if (g) {
      this.gorgeBridgeS().forEach((s, i) => {
        const p = g.river.line.pointAt(s);
        const t = g.river.line.tangentAt(s);
        const nx = -t.z, nz = t.x;
        const reach = gorgeHalf(g, s) + 4.6;
        this.bridgeAt(k, p.x - nx * reach, p.z - nz * reach, p.x + nx * reach, p.z + nz * reach, 6, 1.6, i !== 2, gorgeLevel());
        // Westward (a) and eastward (b) landings, 3 m beyond the deck ends.
        const a: [number, number] = [p.x - nx * (reach + 3), p.z - nz * (reach + 3)];
        const b: [number, number] = [p.x + nx * (reach + 3), p.z + nz * (reach + 3)];
        this.routes[`gorge_bridge_${i}`] = a[0] < b[0] ? [b, a] : [a, b];
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Tribal Plaza
  // ---------------------------------------------------------------------------

  private plaza(k: NwtKit): void {
    const { x, z } = PLAZA_C;
    const props = this.propBuilder(x, z);
    // Inlaid water emblem and rings (flush with the paving).
    for (const [r0, r1] of [[10.5, 11.3], [15.2, 15.6]] as const) {
      const ring = flatRing(r0, r1, 64);
      k.core.mesh(wtMat('ice_trim'), ring, { x, y: L1 + 0.012, z }, { castShadow: false });
      ring.dispose();
    }
    const em = emblem(8.6, 0.04, true);
    em.rotateX(-Math.PI / 2);
    k.core.mesh(wtMat('ice_trim'), em, { x, y: L1 + 0.01, z, yaw: Math.PI }, { castShadow: false });
    em.dispose();
    // Moon pillars flanking the basin, with blue spirit lamps.
    for (const sx of [-1, 1]) {
      const px = x + sx * 25, pz = -1617;
      k.core.cylinder(wtMat('ice_trim'), { x: px, y: L1, z: pz, r: 1.1, rTop: 0.8, h: 9, segments: 10 }, { collide: true, walkable: false });
      k.core.cylinder(wtMat('ice_wall'), { x: px, y: L1, z: pz, r: 1.6, h: 0.8, segments: 10 }, { collide: true, walkable: true });
      const orb = new THREE.SphereGeometry(0.75, 14, 10);
      k.props.mesh(wtMat('lantern_blue'), orb, { x: px, y: L1 + 9.7, z: pz }, { castShadow: false });
      orb.dispose();
      const cres = emblem(1.2, 0.2, true);
      k.core.mesh(wtMat('ice_trim'), cres, { x: px, y: L1 + 6.5, z: pz + 0.85, yaw: 0 });
      cres.dispose();
    }
    // Lantern posts around the plaza edge.
    for (let i = 0; i < 6; i++) {
      const lx = PLAZA[0] + 6 + i * ((PLAZA[2] - PLAZA[0] - 12) / 5);
      lanternPost(props, lx, L1, PLAZA[3] - 1.5, 'warm');
      if (Math.abs(lx - x) > 26) lanternPost(props, lx, L1, PLAZA[1] + 1.5, 'blue');
    }
    for (const lz of [-1606, -1590, -1574]) {
      lanternPost(props, PLAZA[0] + 1.5, L1, lz, 'warm');
      lanternPost(props, PLAZA[2] - 1.5, L1, lz, 'warm');
    }
    // Banner masts at the corners.
    for (const [bx, bz] of [[PLAZA[0] + 4, PLAZA[1] + 6], [PLAZA[2] - 4, PLAZA[1] + 6], [PLAZA[0] + 4, PLAZA[3] - 6], [PLAZA[2] - 4, PLAZA[3] - 6]] as const) {
      k.core.cylinder(wtMat('ice_trim'), { x: bx, y: L1, z: bz, r: 0.25, h: 11, segments: 8 }, { collide: true, walkable: false });
      banner(props, bx + 0.0, L1 + 10.5, bz + 0.3, 0, 2.0, 6, bz < PLAZA_C.z ? 'banner_moon' : 'banner_water');
    }
    // Market stalls (west and east sides).
    const stall = (sx: number, sz: number, yaw: number, seed: number) => {
      const m = new THREE.Matrix4().compose(V(sx, L1, sz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(1, 1, 1));
      props.instance('nwt_stall_frame', () => {
        const parts: THREE.BufferGeometry[] = [];
        for (const px of [-1.6, 1.6]) {
          for (const pz of [-1, 1]) {
            const p = new THREE.CylinderGeometry(0.08, 0.09, pz > 0 ? 2.5 : 2.9, 6);
            p.translate(px, (pz > 0 ? 2.5 : 2.9) / 2, pz);
            parts.push(p);
          }
        }
        const counter = new THREE.BoxGeometry(3.4, 0.9, 0.8);
        counter.translate(0, 0.45, 0.9);
        parts.push(counter);
        return mergeAll(parts);
      }, wtMat('wood'), m);
      props.instance('nwt_stall_roof', () => {
        const r = new THREE.PlaneGeometry(4.0, 2.7, 1, 1);
        r.rotateX(-Math.PI / 2 - 0.16);
        r.translate(0, 2.75, 0);
        return r;
      }, wtMat(seed % 2 ? 'hide' : 'hide_dark'), m);
      props.instance('nwt_stall_goods', () => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 4; i++) {
          const f = new THREE.ConeGeometry(0.12, 0.7, 4);
          f.rotateZ(Math.PI / 2);
          f.scale(1, 0.4, 1);
          f.translate(-1.1 + i * 0.7, 0.98, 0.9);
          parts.push(f);
        }
        return mergeAll(parts);
      }, wtMat('fish'), m, false);
      k.core.collider({ shape: 'box', x: sx + Math.sin(yaw) * 0.9, y: L1 + 0.45, z: sz + Math.cos(yaw) * 0.9, hx: 1.7, hy: 0.45, hz: 0.4, yaw, walkable: false, solid: true });
      crate(props, sx + Math.cos(yaw) * 2.3, L1, sz - Math.sin(yaw) * 2.3, seed, 0.8);
      barrel(props, sx - Math.cos(yaw) * 2.3, L1, sz + Math.sin(yaw) * 2.3, 0.9);
    };
    stall(-256, -1604, Math.PI / 2, 1);
    stall(-256, -1594, Math.PI / 2, 2);
    stall(-256, -1584, Math.PI / 2, 3);
    stall(-184, -1604, -Math.PI / 2, 4);
    stall(-184, -1594, -Math.PI / 2, 5);
    stall(-184, -1566, -Math.PI / 2, 6);
    // Ice benches.
    for (const [bx, bz, yaw] of [[-232, -1562, 0], [-208, -1562, 0], [-246, -1590, Math.PI / 2], [-194, -1590, Math.PI / 2]] as const) {
      k.core.box(wtMat('ice_wall'), { x: bx, y: L1 + 0.25, z: bz, sx: 3, sy: 0.5, sz: 0.9, yaw }, { collide: true, walkable: true });
    }
    // Snow drifts at the edges (decorative density).
    const rnd = new Random(31);
    const nDrift = Math.round(10 * k.density);
    for (let i = 0; i < nDrift; i++) {
      const edge = i % 4;
      const dx = edge < 2 ? rnd.range(PLAZA[0] + 3, PLAZA[2] - 3) : edge === 2 ? PLAZA[0] + 1.2 : PLAZA[2] - 1.2;
      const dz = edge >= 2 ? rnd.range(PLAZA[1] + 3, PLAZA[3] - 3) : edge === 0 ? PLAZA[3] - 1 : PLAZA[1] + 6;
      if (Math.hypot(dx - SPAWN.x, dz - SPAWN.z) < 7) continue;
      drift(props, dx, L1, dz, rnd.range(1.5, 3), rnd.range(1, 2), rnd.range(0.2, 0.45), rnd.range(0, 3));
    }
    // Basin landing steps (decorative stairs down to the water, both ends).
    for (const sx of [-1, 1]) {
      const bx = sx < 0 ? -242 + 2.5 : -198 - 2.5;
      flight(k.core, V(bx, 4.06, -1623.5 - 4), V(bx, L1, -1621.5), 3, 'ice_trim', null, 'ice');
    }
    // Boats moored in the basin.
    canalBoat(props, -236, WL, -1630, 0.2);
    canalBoat(props, -204, WL, -1631, -0.15);
  }

  // ---------------------------------------------------------------------------
  // Harbor, outer jetties
  // ---------------------------------------------------------------------------

  private harbor(k: NwtKit): void {
    const props = this.propBuilder(-75, -1690);
    const deck = (x0: number, z0: number, x1: number, z1: number) => {
      const top = L1 - 0.15;
      k.core.box(wtMat('wood'), { x: (x0 + x1) / 2, y: top - 0.15, z: (z0 + z1) / 2, sx: x1 - x0, sy: 0.3, sz: z1 - z0 }, { collide: true, walkable: true, surface: 'wood' });
      // pilings
      for (let x = x0 + 1; x <= x1 - 0.9; x += 3.2) {
        for (const z of [z0 + 0.5, z1 - 0.5]) {
          props.instance('nwt_piling', () => {
            const g = new THREE.CylinderGeometry(0.2, 0.22, 1.9, 6);
            g.translate(0, 0.95, 0);
            return g;
          }, wtMat('wood'), new THREE.Matrix4().makeTranslation(x, 4.0, z));
        }
      }
    };
    deck(-72, -1687, -46, -1673); // main pier (landmark)
    deck(-104, -1724, -84, -1719);
    deck(-104, -1668, -88, -1663);
    // Moored boats & a larger sailing canoe.
    const boats: Array<[number, number, number, number]> = [
      [-80, -1693, Math.PI / 2, 5.2],
      [-80, -1667, Math.PI / 2, 5.6],
      [-94, -1728, Math.PI / 2, 5.0],
      [-94, -1714, -Math.PI / 2, 5.2],
      [-56, -1700, 0.1, 5.4],
      [-95, -1658, Math.PI / 2, 4.8],
    ];
    for (const [bx, bz, yaw, len] of boats) canalBoat(props, bx, WL, bz, yaw, len);
    this.sailboat(k, props, -66, -1712, 0.05);
    this.sailboat(k, props, -88, -1700, Math.PI + 0.1);
    // Quay clutter.
    for (let i = 0; i < 5; i++) {
      crate(props, -47.5, L1, -1650 - i * 1.1 - (i > 2 ? 10 : 0), i * 0.4, 0.9);
      barrel(props, -102, L1, -1646 - i * 0.0 + i * 1.0, 0.9);
    }
    dryingRack(props, -96, L1, -1645.5, 0, 3.6);
    dryingRack(props, -60, L1, -1645.5, 0, 3.6);
    // Crane on the main pier.
    k.core.cylinder(wtMat('wood'), { x: -50, y: L1 - 0.15, z: -1684, r: 0.3, h: 7, segments: 8 }, { collide: true, walkable: false });
    k.core.box(wtMat('wood'), { x: -54, y: L1 + 6.6, z: -1684, sx: 8.5, sy: 0.3, sz: 0.3, yaw: 0.2 });
    const rope = new THREE.CylinderGeometry(0.03, 0.03, 4, 4);
    k.props.mesh(wtMat('rope'), rope, { x: -58, y: L1 + 4.6, z: -1683.2 });
    rope.dispose();
    lanternPost(props, -47, L1, -1674, 'warm');
    lanternPost(props, -47, L1, -1686, 'warm');
  }

  private sailboat(k: NwtKit, props: ContentBuilder, x: number, z: number, yaw: number): void {
    canalBoat(props, x, WL, z, yaw, 9.5);
    const m = new THREE.Matrix4().compose(V(x, WL, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(1, 1, 1));
    props.instance('nwt_mast', () => {
      const mast = new THREE.CylinderGeometry(0.1, 0.14, 8, 6);
      mast.translate(0, 4, 0.6);
      const boom = new THREE.CylinderGeometry(0.07, 0.07, 3.6, 5);
      boom.rotateX(Math.PI / 2);
      boom.translate(0, 1.4, -0.9);
      return mergeAll([mast, boom]);
    }, wtMat('wood'), m);
    props.instance('nwt_sail', () => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(0, 6.4);
      s.lineTo(-3.4, 0.2);
      s.closePath();
      const g = new THREE.ShapeGeometry(s);
      g.rotateY(Math.PI / 2);
      g.translate(0, 1.5, 0.5);
      return g;
    }, wtMat('hide'), m, false);
    void k;
  }

  private outer(k: NwtKit): void {
    const props = k.props;
    // Ramps from the jetties down to the snowfield.
    for (const j of JETTIES) {
      const cx = (j[0] + j[2]) / 2;
      const outerSide = cx < -200 || (cx > -90 && cx < -70) ? -1 : 1;
      const ex = outerSide < 0 ? j[0] : j[2];
      const ground = heightAt(ex + outerSide * 5, -1790);
      if (cx === -234 || cx === -206 || cx === -90 || cx === -60) {
        flight(k.core, V(ex + outerSide * 6, Math.min(ground, L1 - 0.3), -1790), V(ex, L1, -1790), 4, 'ice_trim', 'ice_wall', 'ice');
      }
      // Parapets on the outer sides of the jetties.
      parapet(k.core, 'ice_wall', ex, j[1] + 1, ex, -1795, L1, 0.8, 0.5, 'snow');
      parapet(k.core, 'ice_wall', ex, -1785, ex, j[3] - 1, L1, 0.8, 0.5, 'snow');
    }
    // Sea locks at the canal mouths (closed sluice gates).
    for (const [x0, x1] of [[-228, -212], [-84, -66]] as const) {
      const cx = (x0 + x1) / 2, w = x1 - x0;
      k.core.box(wtMat('ice_massive'), { x: cx, y: (L1 + 7 + 2) / 2, z: -1837.5, sx: w + 8, sy: L1 + 7 - 2, sz: 3 }, { collide: true, walkable: true, surface: 'ice' });
      const lock = panelWithArches(w + 8, 6, 0.6, [{ x: 0, y: 0, w: w - 2, h: 5 }], 8);
      k.core.mesh(wtMat('ice_trim'), lock, { x: cx, y: L1 + 1.5, z: -1835.8 });
      lock.dispose();
      k.core.box(wtMat('wood'), { x: cx, y: WL + 0.8, z: -1835.6, sx: w, sy: 2.2, sz: 0.4 });
      roundTower(k.core, x0 - 6, -1834, 2, 3.4, 13, 'bulb', true);
      roundTower(k.core, x1 + 6, -1834, 2, 3.4, 13, 'bulb', true);
      lanternPost(props, x0 - 1.5, L1, -1828, 'warm');
      lanternPost(props, x1 + 1.5, L1, -1828, 'warm');
      // Overflow spilling to the bay.
      const yb = Math.max(0.2, heightAt(cx, -1842));
      const fall = k.wet;
      const sheet = new THREE.PlaneGeometry(w - 3, Math.max(0.6, WL - yb), 2, 2);
      fall.mesh(wtWaterfall(), sheet, { x: cx, y: (WL + yb) / 2, z: -1839.2, yaw: 0 }, { castShadow: false });
      sheet.dispose();
    }
    // Boats in the outer canals.
    canalBoat(props, -224, WL, -1800, 0.05);
    canalBoat(props, -216, WL, -1782, Math.PI - 0.08);
    canalBoat(props, -78, WL, -1790, 0.1, 6);
    // Shore watchtowers / outposts.
    for (const [x, z] of [[-330, -1812], [-120, -1812], [-20, -1800]] as const) {
      const y = heightAt(x, z);
      roundTower(k.core, x, z, y - 0.5, 3.6, 12, 'dome', true);
      banner(props, x, y + 11, z - 3.7, Math.PI, 1.4, 3.6, 'banner_water');
    }
    // Ice floes / drifts on the outer snowfield.
    const rnd = new Random(9);
    const n = Math.round(14 * k.density);
    for (let i = 0; i < n; i++) {
      const x = rnd.range(-370, -30), z = rnd.range(-1835, -1762);
      if (JETTIES.some((j) => inRect(j, x, z, 4)) || inRect(CANALS.grand_out, x, z, 4) || inRect(CANALS.harbor_out, x, z, 4)) continue;
      drift(props, x, heightAt(x, z), z, rnd.range(2, 5), rnd.range(1.5, 3.5), rnd.range(0.3, 0.8), rnd.range(0, 3));
    }
  }

  // ---------------------------------------------------------------------------
  // Houses
  // ---------------------------------------------------------------------------

  /** Place a row of houses whose fronts line up along a→b, facing `yaw`. */
  private row(k: NwtKit, ax: number, az: number, bx: number, bz: number, yaw: number, kinds: string[], maxDepth = 12, y = L1): void {
    const kitH = houseKit();
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rnd = k.rnd;
    let t = rnd.range(0, 2);
    let guard = 0;
    while (t < len && guard++ < 200) {
      const kind = rnd.pick(kinds);
      const a = kitH.get(kind) as Archetype;
      const s = rnd.range(0.92, 1.12);
      const { hw, hd } = houseHalf(a, s);
      if (2 * hd > maxDepth) {
        t += 1;
        continue;
      }
      if (t + 2 * hw > len) break;
      const rx = ax + ux * (t + hw), rz = az + uz * (t + hw);
      const cx = rx - fx * hd, cz = rz - fz * hd;
      const f: Footprint = { x: cx, z: cz, c: Math.cos(yaw), s: Math.sin(yaw), hw, hd };
      if (this.fits(f)) {
        placeHouse(this.houseBuilder(cx, cz), a, cx, y, cz, yaw, s);
        this.placed.push(f);
        // doorstep lantern / snow drift dressing
        const pb = this.propBuilder(cx, cz);
        if (rnd.chance(0.35)) lanternPost(pb, rx + ux * (hw + 0.6) + fx * 0.8, y, rz + uz * (hw + 0.6) + fz * 0.8, rnd.chance(0.5) ? 'warm' : 'blue', 2.3);
        else if (rnd.chance(0.5 * k.density)) drift(pb, rx - ux * (hw - 1) + fx * 0.6, y, rz - uz * (hw - 1) + fz * 0.6, 1.6, 1.0, 0.3, yaw);
        t += 2 * hw + rnd.range(1.6, 3.6) + (rnd.chance(0.18) ? 5 : 0);
      } else {
        t += 1.5;
      }
    }
  }

  private houses(k: NwtKit): void {
    const lower = ['cottage', 'cottage_dome', 'twostorey', 'dome', 'tier_dome', 'tower', 'cottage'];
    const big = ['twostorey', 'tier_dome', 'hall', 'tower', 'cottage_dome'];
    const noble = ['noble', 'tier_dome', 'twostorey', 'noble'];
    const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
    // North band: along the North Cross Canal, facing it.
    this.row(k, -368, -1717, -246, -1717, S, lower, 13);
    this.row(k, -194, -1717, -110, -1717, S, big, 13);
    // Behind them, facing the wall lane.
    this.row(k, -368, -1736, -290, -1736, N, ['cottage', 'dome', 'cottage_dome'], 8);
    // South of the North Cross Canal.
    this.row(k, -368, -1697, -246, -1697, N, lower, 11);
    this.row(k, -194, -1697, -156, -1697, N, lower, 11);
    this.row(k, -134, -1697, -110, -1697, N, lower, 11);
    // Back-to-back rows facing the Market Canal / gorge end.
    this.row(k, -366, -1670, -280, -1670, S, lower, 11);
    this.row(k, -194, -1657, -156, -1657, S, lower, 10);
    this.row(k, -134, -1657, -110, -1657, S, lower, 10);
    this.row(k, -194, -1677, -156, -1677, N, ['cottage', 'dome'], 8);
    // East canal frontages.
    this.row(k, -155, -1700, -155, -1640, E, lower, 10);
    this.row(k, -135, -1640, -135, -1700, W, lower, 10);
    // South of the Market Canal (facing it), both sides of the basin.
    this.row(k, -258, -1639, -246, -1639, N, lower, 10);
    this.row(k, -194, -1639, -156, -1639, N, lower, 10);
    this.row(k, -134, -1639, -108, -1639, N, lower, 10);
    // Harbor south quay.
    this.row(k, -104, -1639, -50, -1639, N, big, 12);
    // West bank of the gorge (facing it) and along the west cliffs.
    this.gorgeRow(k, -1, -1652, -1586, lower);
    this.gorgeRow(k, -1, -1530, -1452, noble);
    this.row(k, -356, -1742, -356, -1440, E, lower, 12);
    // East bank of the gorge (facing it), and rows facing the plaza.
    this.gorgeRow(k, 1, -1650, -1440, lower);
    this.row(k, -266, -1618, -266, -1552, E, big, 12);
    this.row(k, -262, -1546, -262, -1424, E, noble, 14);
    this.row(k, -290, -1640, -290, -1424, W, noble, 14);
    // Street in front of the terraces (east part) and the east quarter.
    this.row(k, -174, -1618, -174, -1594, W, lower, 10);
    this.row(k, -152, -1546, -60, -1546, N, lower, 12);
    this.row(k, -152, -1564, -60, -1564, S, big, 12);
    this.row(k, -104, -1606, -48, -1606, N, lower, 11);
    this.row(k, -104, -1626, -48, -1626, S, lower, 11);
    this.row(k, -154, -1530, -154, -1484, W, lower, 10);
    this.row(k, -48, -1640, -48, -1424, W, big, 12);
    this.row(k, -86, -1530, -86, -1424, E, noble, 12);
    this.row(k, -150, -1526, -90, -1526, S, ['cottage', 'dome', 'cottage_dome'], 9);
    // Fill the remaining blocks with back-to-back row pairs separated by lanes.
    const fill = ['cottage', 'cottage_dome', 'twostorey', 'tier_dome', 'tower', 'hall', 'cottage'];
    for (let zN = -1735; zN < -1440; zN += 27) {
      this.row(k, INNER[0] + 2, zN, INNER[2] - 2, zN, N, fill, 9.5);
      this.row(k, INNER[0] + 2, zN + 20, INNER[2] - 2, zN + 20, S, fill, 9.5);
    }
  }

  /** Row parallel to the gorge on one bank (side -1 = west/left, 1 = east), between two z values. */
  private gorgeRow(k: NwtKit, side: number, zA: number, zB: number, kinds: string[]): void {
    const g = gorge();
    if (!g) return;
    const sA = this.sAtZ(zA), sB = this.sAtZ(zB);
    const s0 = Math.min(sA, sB), s1 = Math.max(sA, sB);
    // Split into straight pieces (the river polyline bends).
    const STEP = 30;
    for (let s = s0; s < s1 - 4; s += STEP) {
      const sb = Math.min(s1, s + STEP);
      const pa = g.river.line.pointAt(s), pb = g.river.line.pointAt(sb);
      const dx = pb.x - pa.x, dz = pb.z - pa.z;
      const len = Math.hypot(dx, dz);
      const tx = dx / len, tz = dz / len;
      // Left normal of the flow direction is (-tz, tx); side -1 → houses on the right-hand bank.
      const nx = -tz * -side, nz = tx * -side;
      const off = gorgeHalf(g, (s + sb) / 2) + 10;
      const ax = pa.x - nx * off, az = pa.z - nz * off, bx = pb.x - nx * off, bz = pb.z - nz * off;
      // Houses face the gorge: forward = +n (toward the river).
      const yaw = Math.atan2(nx, nz);
      // Walk the row so that the house's local +X follows the row direction.
      const rowDir = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const forward = (bx - ax) * rowDir.x + (bz - az) * rowDir.z >= 0;
      if (forward) this.row(k, ax, az, bx, bz, yaw, kinds, 12);
      else this.row(k, bx, bz, ax, az, yaw, kinds, 12);
    }
  }

  // ---------------------------------------------------------------------------
  // Street life: props along quays, boats in canals
  // ---------------------------------------------------------------------------

  private streetLife(k: NwtKit): void {
    const rnd = new Random(55);
    // Boats moored along the canals.
    const moor: Array<[number, number, number]> = [
      [-224.5, -1712, 0.02],
      [-215.5, -1676, Math.PI],
      [-224, -1652, 0.05],
      [-300, -1704.5, Math.PI / 2],
      [-180, -1709.5, -Math.PI / 2],
      [-130, -1704, Math.PI / 2 + 0.1],
      [-200, -1646, Math.PI / 2],
      [-147.5, -1660, 0.02],
      [-142.5, -1700 + 6, Math.PI],
    ];
    for (const [x, z, yaw] of moor) canalBoat(this.propBuilder(x, z), x, WL, z, yaw, rnd.range(4.6, 5.6));
    // Lantern posts along the Grand Canal quays.
    for (let z = -1730; z < -1640; z += 15) {
      for (const x of [-229.4, -210.6]) {
        if (Math.abs(z + 1688) < 6 || Math.abs(z + 1664) < 6 || Math.abs(z + 1707) < 8) continue;
        lanternPost(this.propBuilder(x, z), x, L1, z, 'blue');
      }
    }
    // Crates and sleds along the north wall lane.
    for (let i = 0; i < Math.round(12 * k.density); i++) {
      const x = rnd.range(-366, -120), z = rnd.range(-1742, -1738);
      if (x > -290 && x < -244) continue;
      if (x > GATE_OPEN.x0 - 8 && x < GATE_OPEN.x1 + 8) continue;
      if (rnd.chance(0.5)) crate(this.propBuilder(x, z), x, L1, z, rnd.range(0, 3), rnd.range(0.7, 1));
      else barrel(this.propBuilder(x, z), x, L1, z, rnd.range(0.8, 1));
    }
    // Snow drifts against the walls (decor).
    for (let i = 0; i < Math.round(26 * k.density); i++) {
      const wallSide = i % 3;
      const x = wallSide === 0 ? WALL.w1 + 1.2 : wallSide === 1 ? WALL.e0 - 1.2 : rnd.range(WALL.w1 + 4, WALL.e0 - 4);
      const z = wallSide === 2 ? WALL.n1 + 1.2 : rnd.range(WALL.n1 + 6, WALL.s0 - 6);
      if (podiumHole(x, z)) continue;
      if (wallSide === 2 && x > GATE_OPEN.x0 - 14 && x < GATE_OPEN.x1 + 14) continue;
      drift(this.propBuilder(x, z), x, L1, z, rnd.range(2.5, 5), rnd.range(1.2, 2), rnd.range(0.4, 0.9), wallSide === 2 ? 0 : Math.PI / 2);
    }
    // Ice crystal clusters at street corners (sparkle).
    for (let i = 0; i < Math.round(10 * k.density); i++) {
      const x = rnd.range(-360, -50), z = rnd.range(-1740, -1430);
      if (podiumHole(x, z) || inRect(PLAZA, x, z, 4) || inRect(T1, x, z, 6)) continue;
      if (this.placed.some((p) => inFootprint(p, x, z, 1.5))) continue;
      const c = crystalCluster(500 + i, 1.0, 4);
      this.propBuilder(x, z).mesh(wtMat('ice_clear'), c, { x, y: L1 - 0.05, z, yaw: rnd.range(0, 6) });
      c.dispose();
    }
    // A few snowy boulders on the outer snowfield.
    for (let i = 0; i < 6; i++) {
      const x = rnd.range(-360, -40), z = rnd.range(-1835, -1765);
      if (JETTIES.some((j) => inRect(j, x, z, 3)) || inRect(CANALS.grand_out, x, z, 3) || inRect(CANALS.harbor_out, x, z, 3)) continue;
      const b = boulder(80 + i, 1.4, 0.9, 1.2, 1);
      k.props.mesh(wtMat('rock'), b, { x, y: heightAt(x, z) - 0.2, z });
      b.dispose();
    }
    void G0;
  }

  private citizens(k: NwtKit): void {
    const R = 'northern_water_tribe';
    const npc = (id: string, name: string, role: 'villager' | 'guard' | 'merchant', x: number, z: number, yaw: number, behavior: NonNullable<Parameters<NwtKit['npc']>[0]>['behavior'], seed: number, y?: number) =>
      k.npc({ id: `nwt_amb_${id}`, name, role, nation: 'water', x, z, y, yaw, behavior, appearanceSeed: seed, region: R, marker: 'none' });
    npc('gate_w', 'Gate Warden', 'guard', -237, -1727, Math.PI, { type: 'idle', variant: 'guard' }, 9101);
    npc('gate_e', 'Gate Warden', 'guard', -203, -1727, Math.PI, { type: 'idle', variant: 'guard' }, 9102);
    npc('palace_w', 'Palace Guard', 'guard', -232, -1468, Math.PI, { type: 'idle', variant: 'guard' }, 9103, L3);
    npc('palace_e', 'Palace Guard', 'guard', -208, -1468, Math.PI, { type: 'idle', variant: 'guard' }, 9104, L3);
    npc('fisher', 'Fisherman', 'villager', -66, -1677, -Math.PI / 2, { type: 'idle', variant: 'work' }, 9105);
    npc('plaza_1', 'Villager', 'villager', -210, -1600, 0, { type: 'wander', radius: 10 }, 9106);
    npc('plaza_2', 'Villager', 'villager', -238, -1584, 0, { type: 'wander', radius: 9 }, 9107);
    npc('children', 'Child', 'villager', -200, -1572, 0, { type: 'wander', radius: 8 }, 9108);
    npc('student_1', 'Waterbending Student', 'villager', COURTYARD.x + 4, COURTYARD.z - 6, -Math.PI / 2, { type: 'train' }, 9109);
    npc('student_2', 'Waterbending Student', 'villager', COURTYARD.x + 4, COURTYARD.z + 6, -Math.PI / 2, { type: 'train' }, 9110);
    npc('quay', 'Canal Poler', 'villager', -234, -1680, 0, { type: 'patrol', path: [{ x: -234, z: -1680 }, { x: -234, z: -1725 }], loop: true }, 9111);
    void PALACE;
    void HEALER;
  }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeParts(parts);
}

export function createNorthernWaterTribe(): NorthernWaterTribe {
  return new NorthernWaterTribe();
}
