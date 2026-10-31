import { heightAt } from '../../../Heightfield';
import { FNC, atAxis, atPolar, footR, footY, harborHalf, polarOf, roadPath, sectorWeight, sstep } from '../../../landforms/fireCapital';

/**
 * Fire Nation capital — master layout for the region builders (data-driven and seeded; tweak the
 * constants at the top). The terrain shape and the frame live in landforms/fireCapital.ts (FNC).
 *
 * Axis coordinates: t = east of the axis (x − V.x), s = south of the volcano centre (z − V.z).
 */
export { FNC, atAxis, atPolar, footR, footY, harborHalf, polarOf, roadPath, sectorWeight, sstep };

export const CONFIG = {
  seed: 0xf17e,
  /** Harbor City ring streets: offsets beyond the volcano's foot (m). */
  ringOffsets: [20, 56, 92, 128, 164, 200] as number[],
  ringW: 6.4,
  /** Spoke streets every ~N degrees between the city's sector edges (plus the Royal Way). */
  spokeStep: 10.5,
  spokeW: 5.2,
  wayW: 12,
  laneW: 3,
  /** Life (phase 5). */
  npcs: 440,
  rallyCrowd: 320,
  warships: 12,
  boats: 14,
  tanks: 6,
  balloons: 3,
} as const;

/** Axis point helper with ground height. */
export function axisPt(t: number, s: number): { x: number; z: number; y: number } {
  const p = atAxis(t, s);
  return { ...p, y: heightAt(p.x, p.z) };
}

/** Yaw that faces from (x,z) toward (tx,tz) (local +Z forward). */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

// ---------------------------------------------------------------------------
// Royal Plaza (valley floor y = FNC.plaza.y)
// ---------------------------------------------------------------------------

export const PLAZA = {
  y: FNC.plaza.y,
  /** Forum between the side halls (|t| < forumHalf). */
  forumHalf: 20,
  /** Side halls (colonnaded, red roofs): |t| from hallIn to hallOut. */
  hallIn: 21,
  hallOut: 33,
  hallS0: 566,
  hallS1: 644,
  /** Pools: |t| in [poolIn, poolOut], s in [poolS0, poolS1]. */
  poolIn: FNC.plaza.pool.in,
  poolOut: FNC.plaza.pool.out,
  poolS0: FNC.plaza.pool.s0,
  poolS1: FNC.plaza.pool.s1,
  water: FNC.plaza.y - 0.32,
  /** Parade ground in front of the main tower (Master Jeong's drill yard). */
  drill: { t: 0, s: 572, r: 13 },
  /** Main tower at the valley head; its passage climbs to the Royal Way. */
  tower: { s0: 530, s1: 557, half: 30, passHalf: FNC.plaza.passHalf, topS: FNC.plaza.passTopS },
  /** Gatehouse on a platform at the harbour end, gate pavilions either side. */
  gatehouse: { t: 0, s: 646, w: 12, d: 9, plat: 1.4 },
  pavilions: [-26, 26] as number[],
  pavilionS: 652,
} as const;

// ---------------------------------------------------------------------------
// Harbour
// ---------------------------------------------------------------------------

export const HARBOR = {
  y: FNC.harbor.quayY,
  s0: FNC.harbor.s0,
  s1: FNC.harbor.s1,
  wallS: FNC.seaWallS,
  /** Sea wall: thickness, height above water, gate width, towers. */
  wall: { d: 10, h: 15, gateHalf: 21, towerW: 17, towerH: 30 },
  /** Finger piers from the inner quay (t offsets) and their length. */
  piers: [-22, 22] as number[],
  pierLen: 54,
  pierW: 7,
} as const;

/** Inner edge (|t|) of the quay apron at axis distance s. */
export function quayEdge(s: number): number {
  return harborHalf(s);
}

// ---------------------------------------------------------------------------
// Harbor City streets
// ---------------------------------------------------------------------------

/** Ring street radius k at bearing phi. */
export function ringR(k: number, phi: number): number {
  return footR(phi) + CONFIG.ringOffsets[k];
}

/** Spoke bearings (degrees), the Royal Way (90) included. */
export function spokeBearings(): number[] {
  const C = FNC.city;
  const out: number[] = [];
  for (let a = C.phi0 + 4; a <= C.phi1 - 4; a += CONFIG.spokeStep) {
    if (Math.abs(a - 90) < CONFIG.spokeStep * 0.55) continue;
    out.push(a);
  }
  out.push(90);
  return out.sort((a, b) => a - b);
}

/** True where Harbor City's street grid stops: the plaza valley + harbour, the park, the coast. */
export function cityBlocked(x: number, z: number): boolean {
  const t = x - FNC.V.x, s = z - FNC.V.z;
  // Plaza valley and the main tower's footprint (plus margin), the harbour.
  if (s > PLAZA.tower.s0 - 6 && Math.abs(t) < FNC.plaza.valleyHalf + 10) return true;
  if (s > FNC.harbor.s0 - 8 && Math.abs(t) < harborHalf(s) + FNC.harbor.quayW + 4) return true;
  // Sea / shore.
  if (heightAt(x, z) < 3.5) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Districts and landmarks (polar around V)
// ---------------------------------------------------------------------------

export const DISTRICTS = {
  foundries: { phi0: 18, phi1: 52, r0: 0.35, r1: 1 },
  northHill: { phi0: -58, phi1: 8 },
  park: { phi0: 136, phi1: 168, rIn: 30, rOut: 190 },
  market: { s0: 404, s1: 474 },
} as const;

/** Hari Bulkan (crater floor y = FNC.floorY). */
export const CALDERA = {
  y: FNC.floorY,
  gate: { t: 0, s: FNC.road.gateS, y: FNC.lipY },
  square: { s0: FNC.ringR + 4, s1: 80, half: 34 },
  bigLake: [
    { phi: -11, r: 82, rad: 21 },
    { phi: 20, r: 79, rad: 22 },
  ],
  smallLakes: [
    { phi: 158, r: 84, rad: 11 },
    { phi: 206, r: 87, rad: 10 },
  ],
  lakeLevel: FNC.floorY - 1.3,
  octagon: { phi: 182, r: 80, rad: 12 },
  coronation: { phi: 50, r: 74 },
  garden: { phi: 131, r: 73, pondR: 9 },
  temple: { phi: 233, r: 78 },
  academy: { phi: 298, r: 84 },
  waterfall: { phi: -6, r: 104 },
} as const;

export const PALACE = {
  ringR: FNC.ringR,
  sides: 12,
  wallH: 9,
  hillY: FNC.hillY,
  gateS: FNC.ringR,
} as const;

// ---------------------------------------------------------------------------
// Key points (shared with spots, tests and the start)
// ---------------------------------------------------------------------------

const ax = (t: number, s: number) => atAxis(t, s);
const pol = (phi: number, r: number) => atPolar(phi, r);

export const POINTS = {
  spawn: { ...ax(0, 606), y: PLAZA.y, yaw: Math.PI },
  elder: { ...ax(6.5, 598), y: PLAZA.y },
  drill: { ...ax(PLAZA.drill.t, PLAZA.drill.s), y: PLAZA.y },
  jeong: { ...ax(10, PLAZA.drill.s - 4), y: PLAZA.y },
  tower: { ...ax(0, (PLAZA.tower.s0 + PLAZA.tower.s1) / 2) },
  passageTop: ax(0, PLAZA.tower.topS),
  harborQuayW: ax(-(harborHalf(700) + 8), 700),
  harborQuayE: ax(harborHalf(680) + 8, 680),
  fishMarket: ax(harborHalf(668) + 9, 668),
  seaGate: ax(0, FNC.seaWallS),
  marketW: ax(-10.5, 440),
  marketE: ax(10.5, 452),
  stables: ax(44, 500),
  roadStart: ax(0, FNC.road.s0 + 10),
  craterGate: ax(0, FNC.road.gateS),
  eastGate: pol(-4.6, 340),
  palaceGate: ax(0, FNC.ringR + 1),
  square: ax(0, 60),
  garden: pol(CALDERA.garden.phi, CALDERA.garden.r),
  temple: pol(CALDERA.temple.phi, CALDERA.temple.r),
  templeCourt: pol(CALDERA.temple.phi, CALDERA.temple.r - 16),
  coronation: pol(CALDERA.coronation.phi, CALDERA.coronation.r),
  octagon: pol(CALDERA.octagon.phi, CALDERA.octagon.r),
  academy: pol(CALDERA.academy.phi, CALDERA.academy.r),
  park: pol(152, footR(152) + 100),
  foundry: pol(34, footR(34) + 110),
} as const;

/** Region bounds for streaming. */
export const REGION_CENTER = { x: FNC.V.x, z: FNC.V.z + 360 };
export const REGION_RADIUS = 760;

/** Smoothstep re-export for builders. */
export const smooth = sstep;

/** Distance from V. */
export function rOf(x: number, z: number): number {
  return polarOf(x, z).r;
}
