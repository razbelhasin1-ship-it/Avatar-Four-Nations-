import * as THREE from 'three';
import { heightAt } from '../../Heightfield';
import type { ContentBuilder } from '../../kit/Builder';
import { buildDistrict, Detail } from './agnaBuildings';
import { buildLandmarks, PLATFORM_RECT } from './agnaLandmarks';
import { block, lampPillar, stairFlight } from './agnaParts';
import { buildCliffs } from './agnaCliffs';
import { cityPlans, type DistrictPlan } from './agnaPlan';
import { emblem, flatDisc, flatRing } from './geometry';
import { wtMat, wtWater } from './materials';
import {
  AVENUE,
  AX,
  BED,
  CANALS,
  CLIFF,
  COURT_C,
  COURT_POOL,
  DISTRICTS,
  FOOTBRIDGES_X,
  FOUNTAIN,
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
  OASIS,
  OASIS_POND,
  OASIS_SLOT,
  PALACE_PLAZA,
  PALACE_POOLS,
  PALACE_STAIRS,
  PASS,
  PLAZA,
  PLAZA_C,
  PLAZA_STAIRS,
  TUNE,
  TWIN_BRIDGES_Z,
  WL,
  inRect,
  levelAt,
  segDist,
  type Rect,
} from './nwtLayout';
import type { NwtKit } from './nwtKit';
import { coping, iceBridge, lanternPost, parapet, V, waterfall, type WaterSheets } from './parts';
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

/** Direction the water runs in each channel: from the cliff falls toward the harbor and out through the gate. */
const FLOW: Record<string, '+x' | '-x' | '+z' | '-z'> = { harbor: '-z', twin_w: '-z', twin_e: '-z', branch_w1: '+x', branch_w2: '+x', branch_e1: '-x', branch_e2: '-x' };

/** Canal channel: dark bed, wadeable floor collider and a flowing water surface. */
function channel(cb: ContentBuilder, sheets: WaterSheets, r: Rect, level: number, bed: number, dir: '+x' | '-x' | '+z' | '-z'): void {
  const [x0, z0, x1, z1] = r;
  cb.box(wtMat('canal_bed'), { x: (x0 + x1) / 2, y: bed - 0.2, z: (z0 + z1) / 2, sx: x1 - x0, sy: 0.4, sz: z1 - z0 }, { castShadow: false });
  cb.collider({ shape: 'box', x: (x0 + x1) / 2, y: bed - 0.2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: 0.2, hz: (z1 - z0) / 2, walkable: true, solid: false, surface: 'water' });
  sheets.flow(wtWater('flow'), x0, z0, x1, z1, level, dir);
}

function water(k: NwtKit, g: CityGrid): void {
  const cb = k.core;
  for (const [id, r] of Object.entries(CANALS)) channel(cb, k.sheets, r, WL, BED, FLOW[id] ?? '-z');
  channel(cb, k.sheets, MOAT, MOAT_WL, MOAT_WL - 0.75, '+x');
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

  // Cascades from the plaza terrace into the heads of the twin canals.
  for (const id of ['twin_w', 'twin_e']) {
    const r = CANALS[id];
    const x = (r[0] + r[2]) / 2, z = r[3];
    cb.box(wtMat('dark'), { x, y: L2 - 0.75, z: z - 0.04, sx: r[2] - r[0] - 1, sy: 0.6, sz: 0.08 }, { castShadow: false });
    cb.box(wtMat('ice_trim'), { x, y: L2 - 1.2, z: z - 0.3, sx: r[2] - r[0] - 0.4, sy: 0.3, sz: 0.6 });
    waterfall(k.wet, x, z - 0.55, Math.PI, L2 - 1.05, WL, r[2] - r[0] - 1.6, 0.45);
    k.emitter('mist', 0.8, V(x, WL + 0.8, z - 2), { radius: 4 }, 70, true);
  }
}

// ---------------------------------------------------------------------------
// Masters' courtyards
// ---------------------------------------------------------------------------

export function pool(k: NwtKit, r: Rect, level: number, open: Array<'n' | 's' | 'w' | 'e'>, id: string, label: string): void {
  const cb = k.core;
  const [x0, z0, x1, z1] = r;
  const wy = level + 0.42;
  if (open.includes('n')) parapet(cb, 'ice_trim', x0, z0 + 0.25, x1, z0 + 0.25, level, 0.65, 0.5, 'snow');
  if (open.includes('s')) parapet(cb, 'ice_trim', x0, z1 - 0.25, x1, z1 - 0.25, level, 0.65, 0.5, 'snow');
  if (open.includes('w')) parapet(cb, 'ice_trim', x0 + 0.25, z0, x0 + 0.25, z1, level, 0.65, 0.5, 'snow');
  if (open.includes('e')) parapet(cb, 'ice_trim', x1 - 0.25, z0, x1 - 0.25, z1, level, 0.65, 0.5, 'snow');
  k.sheets.rect(wtWater('pool'), x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, wy);
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
  pool(k, COURT_POOL, L2, ['n', 's', 'e'], 'nwt:courtyard_pool', 'Courtyard Pool');
  lanternPost(k.props, COURT_C.x + COURT_C.r * 0.8, L2, COURT_C.z - COURT_C.r * 0.7, 'blue');
  lanternPost(k.props, COURT_C.x + COURT_C.r * 0.8, L2, COURT_C.z + COURT_C.r * 0.7, 'blue');
  floor(HEALER_C);
  pool(k, HEALER_POOL, L2, ['n', 's', 'w'], 'nwt:healing_pool', 'Healing Spring');
  PALACE_POOLS.forEach((r, i) => pool(k, r, L4, ['w', 'e'], `nwt:palace_pool_${i ? 'e' : 'w'}`, 'Palace Spring'));
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
// Lantern pillars along the quays, the promenade, the plazas and the avenue
// ---------------------------------------------------------------------------

function lampPillars(k: NwtKit, g: CityGrid, det: Detail): void {
  const cb = k.core;
  const nearBridge = (x: number, z: number) => BRIDGES.some(([ax, az, bx, bz, w]) => segDist(x, z, ax, az, bx, bz) < w / 2 + 3);
  const clear = (x: number, z: number, level: number) => {
    if (lvAt(g, x, z) !== level || builtAt(g, x, z) || nearBridge(x, z)) return false;
    // keep a person's width free all round (stairs, doors, parapets)
    for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) if (lvAt(g, x + dx, z + dz) !== level && !Number.isNaN(lvAt(g, x + dx, z + dz))) return false;
    return true;
  };
  const row = (ax: number, az: number, bx: number, bz: number, level: number, step = TUNE.lampSpacing) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step));
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      if (clear(x, z, level)) lampPillar(det, cb, x, level, z);
    }
  };
  const tw = CANALS.twin_w, te = CANALS.twin_e, h = CANALS.harbor;
  // Promenade edges and the twin-canal quays.
  row(tw[2] + 1.2, -1794, tw[2] + 1.2, -1670, L1);
  row(te[0] - 1.2, -1794, te[0] - 1.2, -1670, L1);
  row(tw[0] - 1.1, -1786, tw[0] - 1.1, -1656, L1);
  row(te[2] + 1.1, -1786, te[2] + 1.1, -1656, L1);
  // Harbor quays and the harbor head.
  row(h[0] - 1.4, -1856, h[0] - 1.4, -1804, L1);
  row(h[2] + 1.4, -1856, h[2] + 1.4, -1804, L1);
  // Ceremony plaza: the terrace edge over the canals and the sides.
  row(PLAZA[0] + 4, PLAZA[1] + 1.6, PLAZA[2] - 4, PLAZA[1] + 1.6, L2);
  row(PLAZA[0] + 1.6, PLAZA[1] + 8, PLAZA[0] + 1.6, PLAZA[3] - 8, L2, 16);
  row(PLAZA[2] - 1.6, PLAZA[1] + 8, PLAZA[2] - 1.6, PLAZA[3] - 8, L2, 16);
  // Avenue and the palace plaza approach.
  row(AVENUE[0] + 1.4, AVENUE[1] + 6, AVENUE[0] + 1.4, AVENUE[3] - 2, L3);
  row(AVENUE[2] - 1.4, AVENUE[1] + 6, AVENUE[2] - 1.4, AVENUE[3] - 2, L3);
  row(AX - 12, PALACE_PLAZA[1] + 4, AX - 12, PALACE_PLAZA[3] - 6, L4, 9);
  row(AX + 12, PALACE_PLAZA[1] + 4, AX + 12, PALACE_PLAZA[3] - 6, L4, 9);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Build the whole city into the kit; returns the district plans (citizens walk their routes) and every lantern position. */
export function buildCity(k: NwtKit): { plans: DistrictPlan[]; glow: number[] } {
  const plans = cityPlans(DISTRICTS);
  const g = cityGrid(plans);
  const ground = k.mainBuilder();
  podium(ground, g);
  edges(ground, g);
  stairs(ground);
  water(k, g);
  plaza(k);
  const det = new Detail(k.layer('landmarks', AX, -1660, 520));
  buildLandmarks(k, det);
  const lamps = new Detail(k.layer('lamps', AX, -1660, 420));
  lampPillars(k, g, lamps);
  courtyards(k);
  oasisFloor(k);
  glacierPass(k);
  buildCliffs(k.mainBuilder());
  const glow = [...det.glow, ...lamps.glow];
  for (const p of plans) {
    const [x0, z0, x1, z1] = p.spec.rect;
    glow.push(...buildDistrict(p, { body: k.mainBuilder(), detail: k.layer(`d_${p.id}`, (x0 + x1) / 2, (z0 + z1) / 2, 230 + Math.max(x1 - x0, z1 - z0) / 2) }));
  }
  return { plans, glow };
}
