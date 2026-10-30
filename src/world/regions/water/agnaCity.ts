import * as THREE from 'three';
import type { SurfaceType } from '../../../core/types';
import { heightAt } from '../../Heightfield';
import type { ContentBuilder } from '../../kit/Builder';
import { buildDistrict, cyl, Detail, grow, MeshAcc, prism, type RBox } from './agnaBuildings';
import { buildCliffs } from './agnaCliffs';
import { cityPlans, type DistrictPlan } from './agnaPlan';
import { bulbDome, disc, dome, emblem, flatDisc, flatRing } from './geometry';
import { wtMat, wtWater, type WTMaterialName } from './materials';
import {
  AX,
  BED,
  CANALS,
  CLIFF,
  COURT_C,
  COURT_POOL,
  DISTRICTS,
  FOOTBRIDGES_X,
  FOUNTAIN,
  GATE_OUT,
  GATE_TOP,
  GATE_Z,
  GRAND_STAIRS,
  HEALER_C,
  HEALER_POOL,
  L1,
  L2,
  L3,
  L4,
  MOAT,
  MOAT_WL,
  MOUTH,
  OASIS,
  OASIS_POND,
  OASIS_SLOT,
  PALACE,
  PALACE_STAIRS,
  PASS,
  PLATFORM,
  PLAZA_C,
  PLAZA_STAIRS,
  PODIUM_BOTTOM,
  TUNE,
  TWIN_BRIDGES_Z,
  WL,
  inRect,
  levelAt,
  segDist,
  type Rect,
} from './nwtLayout';
import type { NwtKit } from './nwtKit';
import { canalRect, coping, iceBridge, lanternPost, parapet, V, waterfall } from './parts';
import { rasterRects } from './raster';

/**
 * Agna Qel'a ground works and landmarks (phase 1 blockout + the street maze):
 *
 *  - the stepped podium (four terrace levels) rasterised from levelAt(),
 *    with retaining walls, balustrades along every drop and ice coping
 *    along the canals;
 *  - canals, the harbor basin and the palace moat (water sources), quay
 *    steps down to the water, arched ice bridges and footbridges;
 *  - stair flights between the terraces;
 *  - the ceremony plaza and its waterfall fountain, the gate wall, the
 *    stepped palace, the masters' courtyards, the oasis floor and the
 *    Glacier Pass ramp;
 *  - the districts (agnaBuildings.ts) and the cliffs (agnaCliffs.ts).
 */

// ---------------------------------------------------------------------------
// Level grid (1 m cells over the cove)
// ---------------------------------------------------------------------------

const G = { x0: CLIFF.w, z0: GATE_Z, x1: CLIFF.e, z1: CLIFF.s };
const NX = G.x1 - G.x0;
const NZ = G.z1 - G.z0;

export interface CityGrid {
  /** Walkable level per cell (NaN = water, cliff or a separately built place). */
  lv: Float32Array;
  /** Cell is canal / harbor / moat water. */
  water: Uint8Array;
  /** Cell is covered by a building (no balustrades there). */
  built: Uint8Array;
  /** Cell is the footprint of a stair flight (on its lower level). */
  stair: Uint8Array;
}

let gridCache: CityGrid | null = null;

/** Every stair flight footprint between terraces (all climb toward +Z). */
export function stairRects(): Rect[] {
  const out: Rect[] = [GRAND_STAIRS, ...PLAZA_STAIRS, PALACE_STAIRS];
  for (const d of DISTRICTS) for (const sx of d.stairsN ?? []) out.push([sx - TUNE.lane / 2, d.rect[1], sx + TUNE.lane / 2, d.rect[1] + TUNE.stairRun]);
  return out;
}

const PLATFORM_RECT: Rect = [PALACE.x - PALACE.w / 2, PALACE.z - PALACE.d / 2, PALACE.x + PALACE.w / 2, PALACE.z + PALACE.d / 2];

export function cityGrid(plans: DistrictPlan[]): CityGrid {
  if (gridCache) return gridCache;
  const n = NX * NZ;
  const lv = new Float32Array(n), water = new Uint8Array(n), built = new Uint8Array(n), stair = new Uint8Array(n);
  const wet: Rect[] = [...Object.values(CANALS), MOAT];
  const stairs = stairRects();
  for (let j = 0; j < NZ; j++) {
    const z = G.z0 + j + 0.5;
    for (let i = 0; i < NX; i++) {
      const x = G.x0 + i + 0.5, k = j * NX + i;
      const l = levelAt(x, z);
      lv[k] = l ?? NaN;
      if (l === null) {
        if (wet.some((r) => inRect(r, x, z))) water[k] = 1;
      } else if (stairs.some((r) => inRect(r, x, z))) stair[k] = 1;
    }
  }
  const mark = (x0: number, z0: number, x1: number, z1: number) => {
    const i0 = Math.max(0, Math.ceil(x0 - G.x0 - 0.5)), i1 = Math.min(NX - 1, Math.floor(x1 - G.x0 - 0.5));
    const j0 = Math.max(0, Math.ceil(z0 - G.z0 - 0.5)), j1 = Math.min(NZ - 1, Math.floor(z1 - G.z0 - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) built[j * NX + i] = 1;
  };
  for (const p of plans) for (const b of p.buildings) mark(b.x0, b.z0, b.x1, b.z1);
  mark(PLATFORM_RECT[0], PLATFORM_RECT[1], PLATFORM_RECT[2], PLATFORM_RECT[3]);
  gridCache = { lv, water, built, stair };
  return gridCache;
}

function lvAt(g: CityGrid, x: number, z: number): number {
  const i = Math.floor(x - G.x0), j = Math.floor(z - G.z0);
  if (i < 0 || j < 0 || i >= NX || j >= NZ) return NaN;
  return g.lv[j * NX + i];
}

function builtAt(g: CityGrid, x: number, z: number): boolean {
  const i = Math.floor(x - G.x0), j = Math.floor(z - G.z0);
  if (i < 0 || j < 0 || i >= NX || j >= NZ) return false;
  return g.built[j * NX + i] === 1;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Solid ice block from below the terrain up to `top`, a flat surface on top and a walkable collider. */
export function block(cb: ContentBuilder, x0: number, z0: number, x1: number, z1: number, top: number, surfaceMat: WTMaterialName = 'paving', surface: SurfaceType = 'packedsnow', bottomMax = PODIUM_BOTTOM): void {
  const w = x1 - x0, d = z1 - z0;
  if (w < 0.05 || d < 0.05) return;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let low = Infinity;
  const nx = Math.max(1, Math.ceil(w / 8)), nz = Math.max(1, Math.ceil(d / 8));
  for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) low = Math.min(low, heightAt(x0 + (w * a) / nx, z0 + (d * b) / nz));
  const bottom = Math.min(bottomMax, low - 0.6);
  cb.box(wtMat('ice_massive'), { x: cx, y: (top + bottom) / 2, z: cz, sx: w, sy: top - bottom, sz: d });
  const q = new THREE.PlaneGeometry(w, d);
  q.rotateX(-Math.PI / 2);
  cb.mesh(wtMat(surfaceMat), q, { x: cx, y: top + 0.02, z: cz }, { castShadow: false });
  q.dispose();
  cb.collider({ shape: 'box', x: cx, y: (top + bottom) / 2, z: cz, hx: w / 2, hy: (top - bottom) / 2, hz: d / 2, walkable: true, solid: true, surface });
}

/**
 * Straight flight along Z from (x, y0, z0) up to (x, y1, z1) with a walkable
 * ramp collider; optional stepped cheek walls (solid, matching their visuals)
 * inside the footprint.
 */
export function stairFlight(cb: ContentBuilder, x: number, z0: number, z1: number, y0: number, y1: number, width: number, cheeks: boolean): void {
  cb.stairs({ from: V(x, y0, z0), to: V(x, y1, z1), width: cheeks ? width - 1.0 : width, material: wtMat('ice_trim'), stepHeight: 0.25, surface: 'ice' });
  if (!cheeks) return;
  const run = Math.abs(z1 - z0), rise = y1 - y0;
  const n = Math.max(4, Math.round(run / 2.5));
  for (const s of [-1, 1]) {
    const cx = x + s * (width / 2 - 0.25);
    for (let k = 0; k < n; k++) {
      const za = z0 + ((z1 - z0) * k) / n, zb = z0 + ((z1 - z0) * (k + 1)) / n;
      const top = y0 + (rise * (k + 1)) / n + 0.85;
      cb.box(wtMat('ice_wall'), { x: cx, y: (y0 + top) / 2, z: (za + zb) / 2, sx: 0.5, sy: top - y0, sz: Math.abs(zb - za) + 0.02 }, { collide: true, walkable: false, surface: 'ice' });
    }
  }
}

// ---------------------------------------------------------------------------
// Podium, balustrades, coping, stairs
// ---------------------------------------------------------------------------

function podium(cb: ContentBuilder, g: CityGrid): void {
  for (const L of [L1, L2, L3, L4]) {
    for (const r of rasterRects(G.x0, G.z0, G.x1, G.z1, 1, (x, z) => lvAt(g, x, z) === L)) block(cb, r.x0, r.z0, r.x1, r.z1, L);
  }
}

interface Edge {
  kind: 'parapet' | 'coping';
  y: number;
  /** +1 = the land (higher) side is the second cell (larger x / z). */
  side: number;
}

/** No balustrade here (stair heads over water, landings handled by flights). */
const NO_PARAPET: Rect[] = [
  [AX - 7, -1461, AX + 7, -1459], // palace stairs over the moat
];

function edgeAt(g: CityGrid, ka: number, kb: number, horizontal: boolean, x: number, z: number): Edge | null {
  const la = g.lv[ka], lb = g.lv[kb];
  const aNull = Number.isNaN(la), bNull = Number.isNaN(lb);
  if (aNull && bNull) return null;
  if (NO_PARAPET.some((r) => inRect(r, x, z))) return null;
  if (aNull || bNull) {
    const kLand = aNull ? kb : ka, kVoid = aNull ? ka : kb;
    if (!g.water[kVoid] || g.built[kLand]) return null;
    const y = g.lv[kLand];
    return { kind: y <= L1 + 0.01 ? 'coping' : 'parapet', y, side: aNull ? 1 : -1 };
  }
  if (Math.abs(la - lb) < 0.5) return null;
  const hiB = lb > la;
  const kHi = hiB ? kb : ka, kLo = hiB ? ka : kb;
  if (g.built[kHi]) return null;
  if (horizontal && g.stair[kLo]) return null; // the head of a flight
  return { kind: 'parapet', y: g.lv[kHi], side: hiB ? 1 : -1 };
}

/** Balustrades along every terrace drop and water edge above the canals; coping along the canals. */
function edges(cb: ContentBuilder, g: CityGrid): void {
  const emit = (e: Edge, ax: number, az: number, bx: number, bz: number) => {
    if (e.kind === 'coping') coping(cb, ax, az, bx, bz, e.y + 0.02, 0.6);
    else parapet(cb, 'ice_wall', ax, az, bx, bz, e.y, 0.9, 0.45, 'snow');
  };
  const same = (a: Edge | null, b: Edge | null) => !!a && !!b && a.kind === b.kind && a.y === b.y && a.side === b.side;
  // Boundaries of constant z (runs along x).
  for (let j = 1; j < NZ; j++) {
    const z = G.z0 + j;
    let run: Edge | null = null, i0 = 0;
    for (let i = 0; i <= NX; i++) {
      const e = i < NX ? edgeAt(g, (j - 1) * NX + i, j * NX + i, true, G.x0 + i + 0.5, z) : null;
      if (run && !same(run, e)) {
        const off = run.side * (run.kind === 'coping' ? 0.3 : 0.23);
        emit(run, G.x0 + i0, z + off, G.x0 + i, z + off);
        run = null;
      }
      if (e && !run) {
        run = e;
        i0 = i;
      }
    }
  }
  // Boundaries of constant x (runs along z).
  for (let i = 1; i < NX; i++) {
    const x = G.x0 + i;
    let run: Edge | null = null, j0 = 0;
    for (let j = 0; j <= NZ; j++) {
      const e = j < NZ ? edgeAt(g, j * NX + i - 1, j * NX + i, false, x, G.z0 + j + 0.5) : null;
      if (run && !same(run, e)) {
        const off = run.side * (run.kind === 'coping' ? 0.3 : 0.23);
        emit(run, x + off, G.z0 + j0, x + off, G.z0 + j);
        run = null;
      }
      if (e && !run) {
        run = e;
        j0 = j;
      }
    }
  }
}

function stairs(cb: ContentBuilder): void {
  stairFlight(cb, (GRAND_STAIRS[0] + GRAND_STAIRS[2]) / 2, GRAND_STAIRS[1], GRAND_STAIRS[3], L1, L2, GRAND_STAIRS[2] - GRAND_STAIRS[0], true);
  for (const r of PLAZA_STAIRS) stairFlight(cb, (r[0] + r[2]) / 2, r[1], r[3], L2, L3, r[2] - r[0], true);
  stairFlight(cb, (PALACE_STAIRS[0] + PALACE_STAIRS[2]) / 2, PALACE_STAIRS[1], PALACE_STAIRS[3], L3, L4, PALACE_STAIRS[2] - PALACE_STAIRS[0], true);
  for (const d of DISTRICTS) for (const sx of d.stairsN ?? []) stairFlight(cb, sx, d.rect[1], d.rect[1] + TUNE.stairRun, d.y - 4, d.y, TUNE.lane - 0.1, false);
}

// ---------------------------------------------------------------------------
// Water: canals, harbor, moat, quay steps, bridges
// ---------------------------------------------------------------------------

/** Bridge crossings [ax, az, bx, bz, width, arch, emblem]. */
const BRIDGES: Array<[number, number, number, number, number, number, boolean]> = [
  // Harbor head: over the mouths of the twin canals.
  [-246, -1797, -228, -1797, 5, 1.1, true],
  [-212, -1797, -194, -1797, 5, 1.1, true],
  // Twin canals, in line with the district lanes.
  ...TWIN_BRIDGES_Z.flatMap((z): Array<[number, number, number, number, number, number, boolean]> => [
    [-245.6, z, -228.6, z, 4.4, 1.4, true],
    [-211.4, z, -194.4, z, 4.4, 1.4, true],
  ]),
  // Footbridges over the branch canals.
  ...[...FOOTBRIDGES_X.w, ...FOOTBRIDGES_X.e].flatMap((x): Array<[number, number, number, number, number, number, boolean]> => [
    [x, -1755, x, -1741, 3.4, 1.0, false],
    [x, -1707, x, -1693, 3.4, 1.0, false],
  ]),
  // Where the branch canals cut the twin canal quays.
  [-245.5, -1755, -245.5, -1741, 4.6, 0.9, false],
  [-245.5, -1707, -245.5, -1693, 4.6, 0.9, false],
  [-194.5, -1755, -194.5, -1741, 4.6, 0.9, false],
  [-194.5, -1707, -194.5, -1693, 4.6, 0.9, false],
];

function water(k: NwtKit, g: CityGrid): void {
  const cb = k.core;
  const canal = wtWater('canal');
  for (const r of Object.values(CANALS)) canalRect(cb, k.sheets, canal, r[0], r[1], r[2], r[3], WL, BED);
  canalRect(cb, k.sheets, canal, MOAT[0], MOAT[1], MOAT[2], MOAT[3], MOAT_WL, MOAT_WL - 0.75);
  const src = (id: string, label: string, y: number, path: Array<{ x: number; z: number }>, r: number) =>
    k.water({ id: `nwt:${id}`, type: 'canal', label, x: path[0].x, y, z: path[0].z, r, path, capacity: Infinity, regen: 0, size: 'large' });
  const h = CANALS.harbor;
  src('harbor', 'Harbor Basin', WL, [{ x: AX, z: h[1] + 1 }, { x: AX, z: h[3] - 1 }], (h[2] - h[0]) / 2);
  for (const id of ['twin_w', 'twin_e']) {
    const r = CANALS[id];
    src(id, id === 'twin_w' ? 'West Canal' : 'East Canal', WL, [{ x: (r[0] + r[2]) / 2, z: r[1] }, { x: (r[0] + r[2]) / 2, z: r[3] - 0.5 }], (r[2] - r[0]) / 2);
  }
  for (const id of ['branch_w1', 'branch_w2', 'branch_e1', 'branch_e2']) {
    const r = CANALS[id];
    const label = id.endsWith('1') ? 'Lantern Canal' : 'Fishers Canal';
    src(id, label, WL, [{ x: r[0] + 0.5, z: (r[1] + r[3]) / 2 }, { x: r[2], z: (r[1] + r[3]) / 2 }], (r[3] - r[1]) / 2);
  }
  src('palace_moat', 'Palace Moat', MOAT_WL, [{ x: MOAT[0] + 0.5, z: (MOAT[1] + MOAT[3]) / 2 }, { x: MOAT[2] - 0.5, z: (MOAT[1] + MOAT[3]) / 2 }], (MOAT[3] - MOAT[1]) / 2);

  // Bridges.
  for (const [ax, az, bx, bz, width, arch, em] of BRIDGES) iceBridge(cb, { a: V(ax, L1, az), b: V(bx, L1, bz), width, arch, baseY: BED, emblem: em });

  // Quay steps down to the water (so anyone who falls in can climb out).
  const nearBridge = (x: number, z: number) => BRIDGES.some(([ax, az, bx, bz, w]) => segDist(x, z, ax, az, bx, bz) < w / 2 + 4);
  const steps = (r: Rect, level: number, bed: number, spacing: number) => {
    const alongX = r[2] - r[0] > r[3] - r[1];
    const len = alongX ? r[2] - r[0] : r[3] - r[1];
    const run = 3.6, w = 1.3;
    for (const side of [-1, 1]) {
      const wall = alongX ? (side < 0 ? r[1] : r[3]) : side < 0 ? r[0] : r[2];
      const inC = wall - side * (w / 2 + 0.03);
      for (let u = 9; u + run < len - 6; u += spacing) {
        const u0 = (alongX ? r[0] : r[1]) + u, u1 = u0 + run;
        const lx = alongX ? u1 - 0.5 : wall + side * 0.7, lz = alongX ? wall + side * 0.7 : u1 - 0.5;
        if (lvAt(g, lx, lz) !== level || builtAt(g, lx, lz) || nearBridge(lx, lz)) continue;
        const from = alongX ? V(u0, bed, inC) : V(inC, bed, u0);
        const to = alongX ? V(u1, level - 0.02, inC) : V(inC, level - 0.02, u1);
        cb.stairs({ from, to, width: w, material: wtMat('ice_trim'), stepHeight: 0.24, surface: 'ice' });
      }
    }
  };
  steps(CANALS.harbor, L1, BED, 26);
  for (const id of ['twin_w', 'twin_e']) steps(CANALS[id], L1, BED, 34);
  for (const id of ['branch_w1', 'branch_w2', 'branch_e1', 'branch_e2']) steps(CANALS[id], L1, BED, 30);
  steps(MOAT, L4, MOAT_WL - 0.75, 18);
}

// ---------------------------------------------------------------------------
// Ceremony plaza and its waterfall fountain
// ---------------------------------------------------------------------------

function plaza(k: NwtKit): void {
  const cb = k.core;
  for (const [r0, r1] of [[21, 21.7], [13, 13.5], [6.4, 6.8]] as const) {
    const g = flatRing(r0, r1, 72);
    cb.mesh(wtMat('ice_trim'), g, { x: PLAZA_C.x, y: L2 + 0.04, z: PLAZA_C.z }, { castShadow: false });
    g.dispose();
  }
  const em = emblem(5.4, 0.05, true);
  em.rotateX(-Math.PI / 2);
  cb.mesh(wtMat('ice_trim'), em, { x: PLAZA_C.x, y: L2 + 0.045, z: PLAZA_C.z }, { castShadow: false });
  em.dispose();

  // Fountain basin at the foot of the avenue terrace; water pours from a long carved slot.
  const [fx0, fz0, fx1, fz1] = FOUNTAIN;
  const wy = L2 + 0.42;
  parapet(cb, 'ice_trim', fx0 + 0.3, fz0 + 0.3, fx1 - 0.3, fz0 + 0.3, L2, 0.65, 0.5, 'snow');
  parapet(cb, 'ice_trim', fx0 + 0.3, fz0 + 0.3, fx0 + 0.3, fz1, L2, 0.65, 0.5, 'snow');
  parapet(cb, 'ice_trim', fx1 - 0.3, fz0 + 0.3, fx1 - 0.3, fz1, L2, 0.65, 0.5, 'snow');
  k.sheets.rect(wtWater('pool'), fx0 + 0.55, fz0 + 0.55, fx1 - 0.55, fz1, wy);
  cb.box(wtMat('dark'), { x: AX, y: L3 - 1.0, z: fz1 - 0.04, sx: 15, sy: 0.7, sz: 0.1 }, { castShadow: false });
  cb.box(wtMat('ice_trim'), { x: AX, y: L3 - 1.45, z: fz1 - 0.35, sx: 16, sy: 0.3, sz: 0.7 });
  waterfall(k.wet, AX, fz1 - 0.6, Math.PI, L3 - 1.3, wy, 14, 0.5);
  k.water({ id: 'nwt:plaza_fountain', type: 'fountain', label: 'Moon Fountain', x: AX, y: wy, z: (fz0 + fz1) / 2, r: 8, capacity: 400, regen: 20, size: 'large' });
  k.emitter('mist', 1.2, V(AX, L2 + 1, fz1 - 1.5), { radius: 6 }, 70, true);
}

// ---------------------------------------------------------------------------
// Gate wall across the harbor mouth
// ---------------------------------------------------------------------------

const GATE_STAIRS_X = [MOUTH.x0 + 3.4, MOUTH.x1 - 3.4];

function gate(k: NwtKit, det: Detail): void {
  const cb = k.mainBuilder();
  const x0 = MOUTH.x0, x1 = MOUTH.x1, top = GATE_TOP;
  block(cb, x0, GATE_OUT, x1, GATE_Z, top, 'paving', 'ice', -12);
  // Gatehouse on the seaward half; the wall walk passes behind it.
  const gz0 = GATE_OUT, gz1 = GATE_OUT + 6;
  cb.box(wtMat('ice_massive'), { x: AX, y: top + 4.5, z: (gz0 + gz1) / 2, sx: 30, sy: 9, sz: gz1 - gz0 }, { collide: true, walkable: true, surface: 'ice' });
  det.merlons({ cx: AX, cz: (gz0 + gz1) / 2, hw: 15, hd: 3, r: 0.1 }, top + 9);
  // The tribe's emblem facing the sea, and the water-gate arches.
  const dsk = disc(6.6, 0.6, 40);
  cb.mesh(wtMat('ice_trim'), dsk, { x: AX, y: top + 2, z: gz0 - 0.3, yaw: Math.PI });
  dsk.dispose();
  const em = emblem(5.6, 0.4, true);
  cb.mesh(wtMat('snow'), em, { x: AX, y: top + 2, z: gz0 - 0.62, yaw: Math.PI });
  em.dispose();
  det.door(AX, -0.5, gz0, Math.PI, false, 5.2);
  det.door(AX, WL - 0.6, GATE_Z, 0, false, 4.4);
  // Wall walk: crenellated seaward parapet, inner balustrade with gaps for the stairs.
  parapet(cb, 'ice_massive', x0 + 0.3, GATE_OUT + 0.25, AX - 15, GATE_OUT + 0.25, top, 1.0, 0.5, null);
  parapet(cb, 'ice_massive', AX + 15, GATE_OUT + 0.25, x1 - 0.3, GATE_OUT + 0.25, top, 1.0, 0.5, null);
  for (let x = x0 + 1.2; x < x1 - 1; x += 1.7) if (Math.abs(x - AX) > 15.5) det.merlon(x, top + 1.0, GATE_OUT + 0.25, 0);
  let xa = x0 + 0.3;
  for (const sx of GATE_STAIRS_X) {
    parapet(cb, 'ice_wall', xa, GATE_Z - 0.23, sx - 2.2, GATE_Z - 0.23, top, 0.9, 0.45, 'snow');
    xa = sx + 2.2;
  }
  parapet(cb, 'ice_wall', xa, GATE_Z - 0.23, x1 - 0.3, GATE_Z - 0.23, top, 0.9, 0.45, 'snow');
  // Stairs up from the harbor quays, along the cliffs.
  for (const sx of GATE_STAIRS_X) stairFlight(cb, sx, -1864, GATE_Z, L1, top, 4.2, true);
  // Lanterns along the walk.
  for (let x = x0 + 8; x < x1 - 4; x += 12) if (Math.abs(x - AX) > 16) det.lantern(x, top + 2.4, GATE_OUT + 0.9);
}

// ---------------------------------------------------------------------------
// The palace: platform over the moat and seven stepped tiers
// ---------------------------------------------------------------------------

function palace(k: NwtKit, det: Detail): void {
  const cb = k.mainBuilder();
  const acc = new MeshAcc();
  const [px0, pz0, px1, pz1] = PLATFORM_RECT;
  block(cb, px0, pz0, px1, pz1, PLATFORM, 'paving', 'ice');
  stairFlight(cb, PALACE.x, -1470, pz0, L4, PLATFORM, 12, true);
  const cz = PALACE.z + 1.5;
  let y = PLATFORM;
  for (let i = 0; i < 7; i++) {
    const hw = 19 - 2.25 * i, hd = 13 - 1.45 * i, h = 5.8 - 0.32 * i;
    const b: RBox = { cx: PALACE.x, cz, hw, hd, r: Math.min(2.2, hd * 0.25) };
    prism(acc, 'ice_wall', b, y, y + h - 0.4);
    prism(acc, 'ice_trim', grow(b, 0.4), y + h - 0.4, y + h, 'snow', 'ice_trim');
    cb.collider({ shape: 'box', x: b.cx, y: y + h / 2, z: b.cz, hx: hw + 0.3, hy: h / 2, hz: hd + 0.3, walkable: true, solid: true, surface: 'ice' });
    // Arched windows on every tier, more of them lit higher up.
    for (const [len, yaw, at] of [
      [2 * hw, Math.PI, (u: number): [number, number] => [b.cx - u, cz - hd]],
      [2 * hw, 0, (u: number): [number, number] => [b.cx + u, cz + hd]],
      [2 * hd, -Math.PI / 2, (u: number): [number, number] => [b.cx - hw, cz - u]],
      [2 * hd, Math.PI / 2, (u: number): [number, number] => [b.cx + hw, cz + u]],
    ] as Array<[number, number, (u: number) => [number, number]]>) {
      const n = Math.floor((len - 2 * b.r - 1) / 2.6);
      for (let q = 0; q < n; q++) {
        const u = (q - (n - 1) / 2) * 2.6;
        if (i === 0 && yaw === Math.PI && Math.abs(u) < 4) continue; // the great doorway
        const [x, z] = at(u);
        det.window(x, y + 1.2, z, yaw, i >= 4, (q + i) % 3 !== 0);
      }
    }
    y += h;
  }
  // Crown: drum, dome and spire.
  cyl(acc, 'ice_trim', PALACE.x, cz, 4.2, y, y + 1.2, 24);
  const dg = dome(3.9, 1.0, 24, 8);
  dg.translate(PALACE.x, y + 1.2, cz);
  acc.add('ice_wall', dg);
  dg.dispose();
  const sp = bulbDome(1.1, 5.5, 14);
  sp.translate(PALACE.x, y + 4.8, cz);
  acc.add('ice_trim', sp);
  sp.dispose();
  // Glowing doorway.
  det.door(PALACE.x, PLATFORM, cz - 13, Math.PI, true, 2.6);
  acc.emit(cb);
}

// ---------------------------------------------------------------------------
// Masters' courtyards
// ---------------------------------------------------------------------------

function pool(k: NwtKit, r: Rect, level: number, open: Array<'n' | 's' | 'w' | 'e'>, id: string, label: string, fall: { x: number; yaw: number; top: number }): void {
  const cb = k.core;
  const [x0, z0, x1, z1] = r;
  const wy = level + 0.42;
  if (open.includes('n')) parapet(cb, 'ice_trim', x0, z0 + 0.25, x1, z0 + 0.25, level, 0.65, 0.5, 'snow');
  if (open.includes('s')) parapet(cb, 'ice_trim', x0, z1 - 0.25, x1, z1 - 0.25, level, 0.65, 0.5, 'snow');
  if (open.includes('w')) parapet(cb, 'ice_trim', x0 + 0.25, z0, x0 + 0.25, z1, level, 0.65, 0.5, 'snow');
  if (open.includes('e')) parapet(cb, 'ice_trim', x1 - 0.25, z0, x1 - 0.25, z1, level, 0.65, 0.5, 'snow');
  k.sheets.rect(wtWater('pool'), x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, wy);
  waterfall(k.wet, fall.x, (z0 + z1) / 2, fall.yaw, fall.top, wy, Math.min(5, z1 - z0 - 2), 0.8);
  k.water({ id, type: 'fountain', label, x: (x0 + x1) / 2, y: wy, z: (z0 + z1) / 2, r: Math.min(x1 - x0, z1 - z0) / 2, capacity: 300, regen: 15, size: 'large' });
  k.emitter('mist', 0.9, V((x0 + x1) / 2, level + 1, (z0 + z1) / 2), { radius: 3 }, 60, true);
}

function courtyards(k: NwtKit): void {
  const cb = k.core;
  const floor = (c: { x: number; z: number; r: number }) => {
    const d = flatDisc(c.r, 56);
    cb.mesh(wtMat('ice_clear'), d, { x: c.x, y: L2 + 0.03, z: c.z }, { castShadow: false });
    d.dispose();
    for (const [r0, r1] of [[c.r - 0.7, c.r - 0.25], [c.r * 0.55, c.r * 0.55 + 0.35]]) {
      const g = flatRing(r0, r1, 56);
      cb.mesh(wtMat('ice_trim'), g, { x: c.x, y: L2 + 0.04, z: c.z }, { castShadow: false });
      g.dispose();
    }
  };
  floor(COURT_C);
  pool(k, COURT_POOL, L2, ['n', 's', 'e'], 'nwt:courtyard_pool', 'Courtyard Pool', { x: COURT_POOL[0] + 0.6, yaw: Math.PI / 2, top: 46 });
  lanternPost(k.props, COURT_C.x + COURT_C.r * 0.8, L2, COURT_C.z - COURT_C.r * 0.7, 'blue');
  lanternPost(k.props, COURT_C.x + COURT_C.r * 0.8, L2, COURT_C.z + COURT_C.r * 0.7, 'blue');
  floor(HEALER_C);
  pool(k, HEALER_POOL, L2, ['n', 's', 'w'], 'nwt:healing_pool', 'Healing Spring', { x: HEALER_POOL[2] - 0.6, yaw: -Math.PI / 2, top: 30 });
  k.emitter('heal', 0.8, V(HEALER_C.x, L2 + 1.2, HEALER_C.z), { radius: 5 }, 40, true);
  lanternPost(k.props, HEALER_C.x - HEALER_C.r * 0.8, L2, HEALER_C.z - HEALER_C.r * 0.7, 'warm');
  lanternPost(k.props, HEALER_C.x - HEALER_C.r * 0.8, L2, HEALER_C.z + HEALER_C.r * 0.7, 'warm');
}

// ---------------------------------------------------------------------------
// Spirit Oasis floor (phase 3 builds the garden) and the Glacier Pass
// ---------------------------------------------------------------------------

function oasisFloor(k: NwtKit): void {
  const cb = k.core;
  block(cb, OASIS_SLOT[0], OASIS_SLOT[1], OASIS_SLOT[2], OASIS_SLOT[3], L4, 'paving', 'ice');
  const P = OASIS_POND;
  const solid = (x: number, z: number) => Math.hypot(x - P.x, z - P.z) > P.r + 0.3;
  for (const r of rasterRects(OASIS[0], OASIS[1], OASIS[2], OASIS[3], 1, solid)) block(cb, r.x0, r.z0, r.x1, r.z1, L4, 'grass', 'grass');
  const bedY = L4 - 1.1, wy = L4 - 0.3;
  const wall = new THREE.CylinderGeometry(P.r + 0.35, P.r + 0.35, L4 - bedY + 0.02, 40, 1, true);
  wall.scale(-1, 1, 1);
  cb.mesh(wtMat('rock'), wall, { x: P.x, y: (L4 + bedY) / 2, z: P.z }, { castShadow: false });
  wall.dispose();
  const bed = flatDisc(P.r + 0.4, 32);
  cb.mesh(wtMat('canal_bed'), bed, { x: P.x, y: bedY, z: P.z }, { castShadow: false });
  bed.dispose();
  k.sheets.disc(wtWater('spirit'), P.x, P.z, P.r + 0.36, wy, 40);
  cb.collider({ shape: 'cylinder', x: P.x, y: bedY - 0.3, z: P.z, r: P.r + 0.4, hy: 0.3, walkable: true, solid: false, surface: 'water' });
  k.water({ id: 'nwt:spirit_oasis', type: 'pond', label: 'Spirit Oasis Pond', x: P.x, y: wy, z: P.z, r: P.r, capacity: 300, regen: 15, size: 'medium' });
}

function glacierPass(k: NwtKit): void {
  const cb = k.core;
  const x = (PASS[0] + PASS[2]) / 2, half = (PASS[2] - PASS[0]) / 2 - 0.8;
  const z0 = CLIFF.s, z1 = PASS[3];
  const yEnd = Math.max(L4, heightAt(x, z1) + 0.15);
  const N = 6;
  const yAt = (t: number) => {
    const z = z0 + (z1 - z0) * t;
    return Math.max(L4 + (yEnd - L4) * t, heightAt(x, z) + 0.15);
  };
  for (let s = 0; s < N; s++) {
    const za = z0 + ((z1 - z0) * s) / N, zb = z0 + ((z1 - z0) * (s + 1)) / N;
    const ya = yAt(s / N), yb = Math.max(ya, yAt((s + 1) / N));
    const len = zb - za, rise = yb - ya;
    cb.box(wtMat('snow'), { x, y: (ya + yb) / 2 - 0.3, z: (za + zb) / 2, sx: 2 * half + 1.2, sy: 0.6, sz: Math.hypot(len, rise) + 0.1, pitch: -Math.atan2(rise, len) }, { castShadow: false });
    cb.collider({ shape: 'box', x, y: ya + rise / 2 - 0.2, z: (za + zb) / 2, hx: len / 2 + 0.05, hy: rise / 2 + 0.2, hz: half + 0.6, yaw: -Math.PI / 2, slopeRise: rise > 0.01 ? rise : 0, walkable: true, solid: true, surface: 'snow' });
  }
  // A snow apron where the pass meets the slope outside.
  cb.box(wtMat('snow'), { x, y: yEnd - 0.4, z: z1 + 3, sx: 2 * half + 4, sy: 0.8, sz: 6 }, { collide: true, walkable: true, surface: 'snow' });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Build the whole city into the kit; returns the district plans (citizens walk their routes). */
export function buildCity(k: NwtKit): DistrictPlan[] {
  const plans = cityPlans(DISTRICTS);
  const g = cityGrid(plans);
  const ground = k.mainBuilder();
  podium(ground, g);
  edges(ground, g);
  stairs(ground);
  water(k, g);
  plaza(k);
  const det = new Detail(k.layer('landmarks', AX, -1660, 520));
  gate(k, det);
  palace(k, det);
  courtyards(k);
  oasisFloor(k);
  glacierPass(k);
  buildCliffs(k.mainBuilder());
  for (const p of plans) {
    const [x0, z0, x1, z1] = p.spec.rect;
    buildDistrict(p, { body: k.mainBuilder(), detail: k.layer(`d_${p.id}`, (x0 + x1) / 2, (z0 + z1) / 2, 230 + Math.max(x1 - x0, z1 - z0) / 2) });
  }
  return plans;
}
