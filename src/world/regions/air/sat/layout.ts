import { SimplexNoise } from '../../../../core/Noise';
import type { P2 } from '../../../WorldLayout';

/**
 * Southern Air Temple master plan (pure data + math, no three.js).
 *
 * One rock pinnacle stands on the flat top of the temple mesa (heightfield
 * plateau 'air_temple', y = 330 out to r ≈ 90): terraces L1–L6 stack up it,
 * joined by one white switchback road that wraps it about 1.6 turns. All
 * heights below are metres above BASE (the mesa top, level L0).
 *
 * Angles θ are in degrees round the centre C: θ = atan2(dz, dx), so
 * 0 = east, 90 = south, 180 = west, 270 = north; a sector [a0, a1] runs with
 * increasing θ (a1 may exceed 360).
 *
 *   level  y     sector θ    r        content
 *   L0     0     ring        ≤ 90     cliff foot, gate plaza where the trail arrives (θ 205), arched bridge
 *   L1     18    262–338     60–86    bison terrace: arched pavilion, hay, landing ledges, stable caves
 *   L2     36    342–92      50–74    orchards, vegetable beds, kitchens, refectory
 *   L3     52    92–176      46–72    monk quarters, practice yards, airball court
 *   L4     68    176–342     26–60    courtyards and gardens
 *   L5     90    342–92      26–50    main halls, meditation terraces
 *   L6     108   ring        ≤ 26     central tower, sanctuary door, launch platform
 *
 * The sanctuary (Avatar statue room) is a round chamber inside the summit rock under the central
 * tower: floor at +63, ceiling just under the summit floor; its door opens off the summit plaza.
 */

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Centre of the pinnacle (= centre of the mesa). */
export const C: P2 = { x: 1450, z: 1250 };
/** World y of L0 (the mesa top). */
export const BASE = 330;
/** Mesa rim radius (flat ground to here). */
export const RIM = 90;
/** Seed for every deterministic placement. */
export const SEED = 8821;
/** Floor height of each level above BASE. */
export const LEVEL_Y = [0, 18, 36, 52, 68, 90, 108] as const;
/** Summit disc radius and the pinnacle's foot radius (where the rock cone meets the mesa). */
export const SUMMIT_R = 26;
export const FOOT_R = 86;
/** Central tower (true cylinder, 6-8x as tall as wide) and secondary towers. */
export const TOWER = { r: 5.6, h: 70 };
/** Agent budgets (scaled by the graphics preset at runtime). */
export const COUNTS = { monks: 170, bison: 46, nearBison: 15, lemurs: 34, statues: 168 };
/** Road width (m). */
export const ROAD_W = 5;
/** Paving top above a level's nominal height (floors are 0.45 m slabs over the rock). */
export const FLOOR_LIFT = 0.2;

/** World y of the walkable floor of a level height. */
export function floorY(y: number): number {
  return BASE + y + FLOOR_LIFT;
}

// ---------------------------------------------------------------------------
// Terraces
// ---------------------------------------------------------------------------

export interface TerraceDef {
  id: string;
  level: number;
  /** Floor height above BASE. */
  y: number;
  a0: number;
  a1: number;
  rIn: number;
  rOut: number;
}

export const TERRACES: TerraceDef[] = [
  { id: 'gate', level: 0, y: 0, a0: 178, a1: 226, rIn: 72, rOut: 94 },
  { id: 'bison', level: 1, y: 18, a0: 262, a1: 338, rIn: 60, rOut: 86 },
  { id: 'orchard', level: 2, y: 36, a0: 342, a1: 452, rIn: 50, rOut: 74 },
  { id: 'quarters', level: 3, y: 52, a0: 92, a1: 176, rIn: 46, rOut: 72 },
  { id: 'courts', level: 4, y: 68, a0: 176, a1: 342, rIn: 26, rOut: 60 },
  { id: 'halls', level: 5, y: 90, a0: 342, a1: 452, rIn: 26, rOut: 50 },
];

export function terrace(id: string): TerraceDef {
  const t = TERRACES.find((q) => q.id === id);
  if (!t) throw new Error(`[sat] no terrace ${id}`);
  return t;
}

/** Cantilevered shelves beyond a terrace edge: landing ledges, the airball court, the launch platform. */
export interface ShelfDef {
  id: string;
  /** Floor height above BASE. */
  y: number;
  /** Centre bearing and radial span. */
  a: number;
  r0: number;
  r1: number;
  /** Width along the tangent (m). */
  w: number;
}

export const SHELVES: ShelfDef[] = [
  { id: 'landing_main', y: 18, a: 280, r0: 82, r1: 100, w: 24 },
  { id: 'landing_ne', y: 18, a: 322, r0: 82, r1: 99, w: 22 },
  { id: 'airball', y: 52, a: 118, r0: 66, r1: 84, w: 26 },
  { id: 'launch', y: 108, a: 140, r0: 22, r1: 36, w: 9 },
];

export function shelf(id: string): ShelfDef {
  const s = SHELVES.find((q) => q.id === id);
  if (!s) throw new Error(`[sat] no shelf ${id}`);
  return s;
}

// ---------------------------------------------------------------------------
// Named places (builders and spots share them): [θ, r, level]
// ---------------------------------------------------------------------------

export const PLACES = {
  arrival: [280, 91, 1],
  landingNE: [322, 90, 1],
  bisonPavilion: [300, 71, 1],
  stables: [314, 62, 1],
  hayYard: [268, 72, 1],
  refectory: [16, 62, 2],
  kitchens: [38, 62, 2],
  orchardA: [352, 62, 2],
  orchardB: [70, 62, 2],
  quartersA: [102, 60, 3],
  quartersB: [160, 60, 3],
  practiceYard: [138, 58, 3],
  airball: [118, 75, 3],
  entranceCourt: [192, 44, 4],
  moonGateCourt: [224, 43, 4],
  labyrinthCourt: [258, 43, 4],
  gardens: [306, 42, 4],
  gardensB: [330, 40, 4],
  mainHall: [354, 38, 5],
  bellPavilion: [12, 43, 5],
  meditation: [48, 47, 5],
  sanctuaryDoor: [100, 14, 6],
  launch: [140, 30, 6],
} as const satisfies Record<string, readonly [number, number, number]>;

export type PlaceId = keyof typeof PLACES;

/** World position (x, z, floor y) of a named place, optionally offset along (θ, r). */
export function place(id: PlaceId, dth = 0, dr = 0): { x: number; z: number; y: number; th: number; r: number } {
  const [th, r, lvl] = PLACES[id];
  const p = polar(th + dth, r + dr);
  return { ...p, y: floorY(LEVEL_Y[lvl]), th: th + dth, r: r + dr };
}

// ---------------------------------------------------------------------------
// Road (one continuous switchback road, waypoints [θ, r, y])
// ---------------------------------------------------------------------------

/** Waypoints along the road, θ increasing; flat runs lie on terraces, climbs are stair flights. */
export const ROAD: Array<[number, number, number]> = [
  [186, 84, 0],
  [214, 84, 0], // gate plaza: the trail arrives at θ ≈ 205
  [262, 83, 18], // climb to L1 along the foot of the courts' cliff
  [324, 81, 18], // through the bison terrace
  [368, 79, 36], // climb past the north-east landing ledge, outside the orchards' cliff
  [380, 70, 36], // onto L2
  [404, 68, 36], // orchards
  [452, 66, 52], // climb to L3 along the orchard terrace
  [494, 66, 52], // quarters
  [536, 58, 68], // climb to L4 (the entrance courtyard)
  [636, 56, 68], // courtyards
  [700, 45, 90], // climb to L5 beside the gardens
  [742, 41, 90], // halls
  [806, 31, 108], // final climb onto the summit
  [816, 22, 108],
];

export interface RoadSample {
  x: number;
  z: number;
  y: number;
  th: number;
  r: number;
  /** Climbing (part of a stair flight) or flat. */
  climb: boolean;
}

/** Road centre-line samples every `step` metres (world x/z, y above BASE). */
export function roadSamples(step = 2): RoadSample[] {
  const out: RoadSample[] = [];
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [t0, r0, y0] = ROAD[i];
    const [t1, r1, y1] = ROAD[i + 1];
    const len = (((t1 - t0) * Math.PI) / 180) * ((r0 + r1) / 2);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const u = k / n;
      const th = t0 + (t1 - t0) * u, r = r0 + (r1 - r0) * u;
      const p = polar(th, r);
      out.push({ x: p.x, z: p.z, y: y0 + (y1 - y0) * u, th, r, climb: y1 !== y0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export const DEG = Math.PI / 180;

/** World XZ at bearing θ (degrees) and radius r from C. */
export function polar(th: number, r: number): P2 {
  return { x: C.x + Math.cos(th * DEG) * r, z: C.z + Math.sin(th * DEG) * r };
}

/** Bearing of a world point (degrees, 0..360). */
export function thetaOf(x: number, z: number): number {
  const a = Math.atan2(z - C.z, x - C.x) / DEG;
  return a < 0 ? a + 360 : a;
}

export function radiusOf(x: number, z: number): number {
  return Math.hypot(x - C.x, z - C.z);
}

/** Is bearing θ inside [a0, a1] (a1 may exceed 360)? */
export function inArc(th: number, a0: number, a1: number): boolean {
  const t = ((th - a0) % 360 + 360) % 360;
  return t <= a1 - a0;
}

/** Yaw (root.rotation.y) that turns local +Z toward bearing θ's outward direction. */
export function yawOut(th: number): number {
  return Math.atan2(Math.cos(th * DEG), Math.sin(th * DEG));
}

/** Local frame at (θ, r): +u along increasing θ (tangent), +v outward; `at(u, v)` gives world XZ. */
export function frameAt(th: number, r: number): { x: number; z: number; yaw: number; at(u: number, v: number): P2 } {
  const c = Math.cos(th * DEG), s = Math.sin(th * DEG);
  const o = polar(th, r);
  return { x: o.x, z: o.z, yaw: Math.atan2(c, s), at: (u, v) => ({ x: o.x - s * u + c * v, z: o.z + c * u + s * v }) };
}

const noise = new SimplexNoise(SEED);

/** Smooth noise in [-1, 1] at a polar point. */
export function pnoise(th: number, r: number, f = 1): number {
  const a = th * DEG;
  return noise.noise2(Math.cos(a) * r * 0.045 * f + 17, Math.sin(a) * r * 0.045 * f - 9);
}

/** Height of the bare rock cone (no terraces) at radius r. */
export function coneY(r: number): number {
  if (r <= SUMMIT_R) return LEVEL_Y[6];
  if (r >= FOOT_R) return 0;
  const t = (r - SUMMIT_R) / (FOOT_R - SUMMIT_R);
  return LEVEL_Y[6] * (1 - Math.pow(t, 0.72));
}

/** How far terrace edges wander outward (m): rock outlines are never perfect circles. */
export const EDGE_AMP = 4.5;

/** Periodic edge noise in [0, 1] round the pinnacle (seeded per level). */
function edgeNoise(th: number, level: number): number {
  const a = th * DEG;
  const n = noise.noise2(Math.cos(a) * 3.4 + level * 7.1, Math.sin(a) * 3.4 - level * 2.3) * 0.7 + noise.noise2(Math.cos(a) * 9 - level, Math.sin(a) * 9 + level * 1.9) * 0.3;
  return Math.min(1, Math.max(0, 0.5 + 0.55 * n));
}

/** Bearing ranges per level where the edge keeps to its nominal radius (stairs run alongside). */
const CALM: Record<number, Array<[number, number]>> = { 2: [[338, 386]] };

function calm(th: number, level: number): number {
  let k = 1;
  for (const [a0, a1] of CALM[level] ?? []) {
    const span = a1 - a0;
    const t = (((th - a0) % 360) + 360) % 360;
    if (t <= span) return 0;
    k = Math.min(k, Math.min(1, Math.min(t - span, 360 - t) / 6));
  }
  return k;
}

/** Outer edge radius of a terrace at bearing θ (the gate plaza stays a clean ring). */
export function rOutAt(t: TerraceDef, th: number): number {
  return t.level === 0 ? t.rOut : t.rOut + EDGE_AMP * edgeNoise(th, t.level) * calm(th, t.level);
}

/** Summit rim radius at bearing θ. */
export function summitRAt(th: number): number {
  return SUMMIT_R + 2.6 * edgeNoise(th, 6);
}

/** The terrace containing (θ, r), if any (shelves excluded); the higher one where edges overlap. */
export function terraceAt(th: number, r: number): TerraceDef | null {
  let best: TerraceDef | null = null;
  for (const t of TERRACES) if (r >= t.rIn && inArc(th, t.a0, t.a1) && r <= rOutAt(t, th) && (!best || t.y > best.y)) best = t;
  return best;
}

/** Walkable floor height above BASE at (θ, r) on the plan (summit, terraces, mesa); null on the cone. */
export function floorAt(th: number, r: number): number | null {
  if (r <= summitRAt(th)) return LEVEL_Y[6];
  const t = terraceAt(th, r);
  if (t) return t.y;
  if (r >= FOOT_R) return 0;
  return null;
}

/**
 * Top of the rock at (θ, r) above BASE: terrace floors sit 0.25 m under their paving, the cone
 * between them is roughened with noise, the mesa ground lies just over the heightfield.
 */
export function rockTop(th: number, r: number): number {
  if (r <= summitRAt(th)) return LEVEL_Y[6] - 0.25;
  const t = terraceAt(th, r);
  if (t) return t.y - 0.25;
  const n = pnoise(th, r, 1.6) * 2.2 + pnoise(th, r, 4.5) * 0.9;
  const y = coneY(r + n);
  return r >= FOOT_R - 1 ? Math.max(0.12, y) : Math.max(0.12, y + n * 0.6);
}
