import type { P2 } from '../../WorldLayout';

/**
 * Ba Sing Se master plan (pure data + math, no three.js). The constants in the
 * first block are the knobs: radii, wall heights, street widths, viaduct
 * height, train and crowd counts. Everything else is derived from them.
 *
 * World metres, Y up, north = -Z. Angles θ around the palace centre C use
 * θ = atan2(dz, dx): 0 = east (+X), 90° = south (+Z), 180° = west, 270° = north.
 *
 *   r (m)     % of R   zone
 *   0-40      0-10     Royal Palace inside its own wall (axis N-S, South Gate at θ=90°)
 *   40-86     10-21    Upper Ring (inner loop viaduct at r=47)
 *   86        21       ring wall + 上環 gates (Middle | Upper)
 *   86-156    21-38    Middle Ring
 *   156       38       ring wall + 中環 gates (Lower | Middle)
 *   156-246   38-60    Lower Ring (outer loop viaduct at r=228)
 *   246       60       Inner Wall + main gate
 *   246-410   60-100   Agrarian Zone (Lake Laogai, the zoo, hills)
 *   410       100      Outer Wall + main gate + arrival station
 */

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

/** Palace centre = centre of every ring. */
export const C: P2 = { x: 850, z: -50 };
/** Ground level of the city plateau. */
export const GROUND = 26;
/** Seed for all deterministic placement. */
export const SEED = 4417;
/** Outer Wall centre-line radius (100 %). */
export const R_OUTER = 410;
/** Ring boundaries as a fraction of R_OUTER (palace wall, Middle|Upper, Lower|Middle, Inner Wall). */
export const RING_FRAC = { palace: 0.098, upper: 0.21, middle: 0.38, inner: 0.6 };
/** Wall heights and battered thickness (base → top). */
export const WALL = {
  outer: { h: 180, base: 40, top: 16 },
  inner: { h: 60, base: 18, top: 9 },
  ring: { h: 30, base: 8, top: 5 },
  palace: { h: 9, base: 2.6, top: 2.2 },
};
/** Street widths (player ≈ 0.7 m wide). */
export const STREET = { avenue: 12, ring: 7, lane: 3.6, alley: 2.6 };
/** Monorail: deck heights above GROUND, deck width, track offsets, arcade module. */
export const RAIL = {
  deck: 28,
  loopDeck: 34,
  deckW: 8.6,
  track: 2.15,
  arch: 8,
  pier: 2.2,
  carLen: 8.2,
  carW: 3.0,
  platformLen: 48,
  platformW: 3.6,
};
/** Trains per line (each line keeps a 60-90 s headway), cars per train, speeds and stops. */
export const TRAINS = { radial: 2, outerLoop: 2, innerLoop: 1, carsMin: 3, carsMax: 5, cruise: 13, accel: 1.6, dwell: 17, terminalDwell: 18 };
/** Crowd budget (simulated agents) per zone; scaled by the graphics preset at runtime. */
export const CROWD = { lower: 190, middle: 92, upper: 26, farm: 34, laogai: 8, guards: 36 };

// ---------------------------------------------------------------------------
// Derived radii
// ---------------------------------------------------------------------------

export const R = {
  palace: Math.round(R_OUTER * RING_FRAC.palace * 10) / 10,
  upper: Math.round(R_OUTER * RING_FRAC.upper * 10) / 10,
  middle: Math.round(R_OUTER * RING_FRAC.middle * 10) / 10,
  inner: Math.round(R_OUTER * RING_FRAC.inner * 10) / 10,
  outer: R_OUTER,
};

/** Inner (city-side) and outer foot of each wall at ground level. */
export const FOOT = {
  outerIn: R.outer - WALL.outer.base / 2,
  innerIn: R.inner - WALL.inner.base / 2,
  innerOut: R.inner + WALL.inner.base / 2,
  middleIn: R.middle - WALL.ring.base / 2,
  middleOut: R.middle + WALL.ring.base / 2,
  upperIn: R.upper - WALL.ring.base / 2,
  upperOut: R.upper + WALL.ring.base / 2,
  palaceOut: R.palace + WALL.palace.base / 2,
};

/** Bands people walk in (between wall feet, with a margin). */
export const BAND = {
  palace: [0, R.palace - WALL.palace.base / 2] as [number, number],
  upper: [FOOT.palaceOut, FOOT.upperIn] as [number, number],
  middle: [FOOT.upperOut, FOOT.middleIn] as [number, number],
  lower: [FOOT.middleOut, FOOT.innerIn] as [number, number],
  farm: [FOOT.innerOut, FOOT.outerIn] as [number, number],
};

export const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export function wrapAngle(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/** Signed smallest difference b − a in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = wrapAngle(b) - wrapAngle(a);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function thetaOf(x: number, z: number): number {
  return wrapAngle(Math.atan2(z - C.z, x - C.x));
}

export function radiusOf(x: number, z: number): number {
  return Math.hypot(x - C.x, z - C.z);
}

export function polar(theta: number, r: number): P2 {
  return { x: C.x + Math.cos(theta) * r, z: C.z + Math.sin(theta) * r };
}

/** Point at polar (θ, r) moved `side` metres along the +θ tangent. */
export function polarOff(theta: number, r: number, side: number): P2 {
  const p = polar(theta, r);
  return { x: p.x - Math.sin(theta) * side, z: p.z + Math.cos(theta) * side };
}

/** Unit vectors at θ: radial outward and +θ tangent. */
export function frame(theta: number): { out: P2; tan: P2 } {
  return { out: { x: Math.cos(theta), z: Math.sin(theta) }, tan: { x: -Math.sin(theta), z: Math.cos(theta) } };
}

export function dist(a: P2, b: P2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Yaw that turns local +Z toward the unit direction (dx, dz). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Which zone a point is in (by radius). */
export type Zone = 'palace' | 'upper' | 'middle' | 'lower' | 'farm' | 'outside';
export function zoneAt(x: number, z: number): Zone {
  const r = radiusOf(x, z);
  if (r < R.palace) return 'palace';
  if (r < R.upper) return 'upper';
  if (r < R.middle) return 'middle';
  if (r < R.inner) return 'lower';
  if (r < R.outer) return 'farm';
  return 'outside';
}

/** Deterministic hash → [0, 1). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ SEED;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export type WallId = 'outer' | 'inner' | 'middle' | 'upper' | 'palace';

export interface GateDef {
  id: string;
  wall: WallId;
  theta: number;
  r: number;
  /** Passage width / height (stone slab size). */
  width: number;
  height: number;
  /** Sign above the passage (CJK), if any. */
  sign?: string;
  main?: boolean;
}

/** Main approach angle: the northern road arrives at the Outer Wall here. */
export const THETA_MAIN = 196 * DEG;
export const THETA_SOUTH_ROAD = 97 * DEG;

export const GATES: GateDef[] = [
  { id: 'outer_west', wall: 'outer', theta: THETA_MAIN, r: R.outer, width: 16, height: 24, main: true },
  { id: 'outer_south', wall: 'outer', theta: THETA_SOUTH_ROAD, r: R.outer, width: 12, height: 18 },
  { id: 'outer_east', wall: 'outer', theta: 0, r: R.outer, width: 12, height: 18 },
  { id: 'inner_west', wall: 'inner', theta: THETA_MAIN, r: R.inner, width: 14, height: 18, main: true },
  { id: 'inner_south', wall: 'inner', theta: 90 * DEG, r: R.inner, width: 12, height: 15 },
  { id: 'inner_east', wall: 'inner', theta: 0, r: R.inner, width: 10, height: 13 },
  { id: 'inner_north', wall: 'inner', theta: 270 * DEG, r: R.inner, width: 10, height: 13 },
  { id: 'middle_west', wall: 'middle', theta: THETA_MAIN, r: R.middle, width: 10, height: 12, sign: '中環', main: true },
  { id: 'middle_south', wall: 'middle', theta: 90 * DEG, r: R.middle, width: 10, height: 12, sign: '中環' },
  { id: 'middle_east', wall: 'middle', theta: 0, r: R.middle, width: 8, height: 10, sign: '中環' },
  { id: 'middle_north', wall: 'middle', theta: 270 * DEG, r: R.middle, width: 8, height: 10, sign: '中環' },
  { id: 'upper_west', wall: 'upper', theta: THETA_MAIN, r: R.upper, width: 9, height: 11, sign: '上環', main: true },
  { id: 'upper_south', wall: 'upper', theta: 90 * DEG, r: R.upper, width: 10, height: 12, sign: '上環' },
  { id: 'upper_east', wall: 'upper', theta: 0, r: R.upper, width: 8, height: 10, sign: '上環' },
  { id: 'upper_north', wall: 'upper', theta: 270 * DEG, r: R.upper, width: 8, height: 10, sign: '上環' },
];

export function gate(id: string): GateDef {
  const g = GATES.find((q) => q.id === id);
  if (!g) throw new Error(`[bss] no gate ${id}`);
  return g;
}

export function gatesOf(wall: WallId): GateDef[] {
  return GATES.filter((g) => g.wall === wall);
}

/** Point just inside (toward C) or outside a gate passage. */
export function gateMouth(g: GateDef, inward: boolean, extra = 2): P2 {
  const half = (g.wall === 'outer' ? WALL.outer.base : g.wall === 'inner' ? WALL.inner.base : WALL.ring.base) / 2;
  return polar(g.theta, g.r + (inward ? -1 : 1) * (half + extra));
}

// ---------------------------------------------------------------------------
// Avenues (radial, through the gates) and ring streets
// ---------------------------------------------------------------------------

export interface Avenue {
  id: string;
  theta: number;
  r0: number;
  r1: number;
  width: number;
}

/** Radial avenues inside the Inner Wall (stop at the palace wall / Upper Ring street). */
export const AVENUES: Avenue[] = [
  { id: 'west', theta: THETA_MAIN, r0: R.upper - 18, r1: R.inner, width: STREET.avenue },
  { id: 'south', theta: 90 * DEG, r0: R.palace + 2, r1: R.inner, width: STREET.avenue },
  { id: 'east', theta: 0, r0: R.upper - 18, r1: R.inner, width: 10 },
  { id: 'north', theta: 270 * DEG, r0: R.upper - 18, r1: R.inner, width: 10 },
];

/** Ring streets (circles around C): Upper Ring promenade, Middle and Lower Ring ring roads. */
export const RING_STREETS = {
  upper: { r: 67, width: 9 },
  middleIn: { r: 99, width: 8 },
  middleOut: { r: 143, width: 8 },
  lowerIn: { r: 168, width: 7 },
  lowerMid: { r: 202, width: 6 },
};

/** Agrarian avenues: outer gate → inner gate (paved, 12 m). */
export const FARM_ROADS: Array<{ id: string; points: P2[]; width: number }> = [
  { id: 'west', points: [gateMouth(gate('outer_west'), true, 26), gateMouth(gate('inner_west'), false, 3)], width: 12 },
  { id: 'south', points: [gateMouth(gate('outer_south'), true, 6), { x: C.x, z: C.z + 330 }, gateMouth(gate('inner_south'), false, 3)], width: 11 },
  { id: 'east', points: [gateMouth(gate('outer_east'), true, 6), gateMouth(gate('inner_east'), false, 3)], width: 10 },
];

// ---------------------------------------------------------------------------
// Monorail network
// ---------------------------------------------------------------------------

export interface StationDef {
  id: string;
  name: string;
  /** Platform centre (deck centre line). */
  at: P2;
  /** Ground stair tower side: +1 = +normal of the line, −1 = −normal. */
  stairs: 1 | -1;
}

export interface RailLineDef {
  id: string;
  name: string;
  kind: 'shuttle' | 'loop';
  /** Deck top height above GROUND. */
  deck: number;
  /** Centre-line control points (smoothed at build time). Loops are closed implicitly. */
  pts: P2[];
  stations: StationDef[];
  trains: number;
}

const ARRIVAL_R = 368;
const Y_R = 228;
const MID_STATION_R = 121;
const TERM_R = 60;
const SIDE = 15;

function circlePts(r: number, n: number, t0 = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) out.push(polar(t0 + (i / n) * Math.PI * 2, r));
  return out;
}

export const RAIL_LINES: RailLineDef[] = [
  {
    id: 'central',
    name: 'Central Line',
    kind: 'shuttle',
    deck: RAIL.deck,
    pts: [polar(THETA_MAIN, ARRIVAL_R), polar(THETA_MAIN, Y_R), polar(THETA_MAIN, MID_STATION_R), polar(THETA_MAIN, TERM_R)],
    stations: [
      { id: 'arrival_c', name: 'Outer Wall Arrival Station', at: polar(THETA_MAIN, ARRIVAL_R - 4), stairs: 1 },
      { id: 'y_c', name: 'Lower Ring Junction', at: polar(THETA_MAIN, Y_R), stairs: 1 },
      { id: 'mid_c', name: 'Middle Ring West', at: polar(THETA_MAIN, MID_STATION_R), stairs: -1 },
      { id: 'up_c', name: 'Upper Ring West', at: polar(THETA_MAIN, TERM_R + 4), stairs: -1 },
    ],
    trains: TRAINS.radial,
  },
  {
    id: 'north',
    name: 'North Line',
    kind: 'shuttle',
    deck: RAIL.deck,
    pts: [
      polarOff(THETA_MAIN, ARRIVAL_R, SIDE),
      polarOff(THETA_MAIN, Y_R + 6, SIDE),
      polarOff(THETA_MAIN, Y_R - 14, SIDE),
      polar(214 * DEG, 186),
      polar(229 * DEG, 152),
      polar(242 * DEG, MID_STATION_R),
      polar(255 * DEG, 92),
      polar(266 * DEG, 70),
      polar(270 * DEG, TERM_R),
    ],
    stations: [
      { id: 'arrival_n', name: 'Outer Wall Arrival Station', at: polarOff(THETA_MAIN, ARRIVAL_R - 4, SIDE), stairs: 1 },
      { id: 'y_n', name: 'Lower Ring Junction', at: polarOff(THETA_MAIN, Y_R, SIDE), stairs: 1 },
      { id: 'mid_n', name: 'Middle Ring North', at: polar(242 * DEG, MID_STATION_R), stairs: 1 },
      { id: 'up_n', name: 'Upper Ring North', at: polar(270 * DEG, TERM_R + 4), stairs: 1 },
    ],
    trains: TRAINS.radial,
  },
  {
    id: 'south',
    name: 'South Line',
    kind: 'shuttle',
    deck: RAIL.deck,
    pts: [
      polarOff(THETA_MAIN, ARRIVAL_R, -SIDE),
      polarOff(THETA_MAIN, Y_R + 6, -SIDE),
      polarOff(THETA_MAIN, Y_R - 14, -SIDE),
      polar(178 * DEG, 186),
      polar(163 * DEG, 152),
      polar(146 * DEG, MID_STATION_R),
      polar(124 * DEG, 94),
      polar(102 * DEG, 72),
      polar(90 * DEG, TERM_R),
    ],
    stations: [
      { id: 'arrival_s', name: 'Outer Wall Arrival Station', at: polarOff(THETA_MAIN, ARRIVAL_R - 4, -SIDE), stairs: -1 },
      { id: 'y_s', name: 'Lower Ring Junction', at: polarOff(THETA_MAIN, Y_R, -SIDE), stairs: -1 },
      { id: 'mid_s', name: 'Middle Ring South', at: polar(146 * DEG, MID_STATION_R), stairs: -1 },
      { id: 'up_s', name: 'Palace South Gate', at: polar(90 * DEG, TERM_R + 4), stairs: -1 },
    ],
    trains: TRAINS.radial,
  },
  {
    id: 'outer_loop',
    name: 'Outer Loop',
    kind: 'loop',
    deck: RAIL.loopDeck,
    pts: circlePts(Y_R, 96),
    stations: [
      { id: 'loop_y', name: 'Lower Ring Junction', at: polar(THETA_MAIN, Y_R), stairs: -1 },
      { id: 'loop_ne', name: 'Lower Ring Northeast', at: polar(316 * DEG, Y_R), stairs: -1 },
      { id: 'loop_se', name: 'Lower Ring Southeast', at: polar(76 * DEG, Y_R), stairs: -1 },
    ],
    trains: TRAINS.outerLoop,
  },
  {
    id: 'inner_loop',
    name: 'Palace Loop',
    kind: 'loop',
    deck: RAIL.deck,
    pts: circlePts(47, 48),
    stations: [
      { id: 'pal_w', name: 'Upper Ring West', at: polar(THETA_MAIN, 47), stairs: 1 },
      { id: 'pal_n', name: 'Upper Ring North', at: polar(270 * DEG, 47), stairs: 1 },
      { id: 'pal_s', name: 'Palace South Gate', at: polar(90 * DEG, 47), stairs: 1 },
    ],
    trains: TRAINS.innerLoop,
  },
];

// ---------------------------------------------------------------------------
// Districts and landmarks (shared by builders and published spots)
// ---------------------------------------------------------------------------

const sq = polar(178 * DEG, 199);

/** Hand-placed features (world metres). */
export const BSS = {
  /** Firelight Fountain square in the Lower Ring (Earth start). */
  square: { x: sq.x, z: sq.z, hw: 21, hd: 19 },
  fountain: { x: sq.x + 2, z: sq.z, r: 6.5 },
  spawn: { x: sq.x - 13, z: sq.z + 7 },
  elder: { x: sq.x - 9, z: sq.z + 12 },
  kingStatue: { x: sq.x + 2, z: sq.z - 15 },
  /** Pao Family Tea House (Lower Ring, north side of the square). */
  paoTea: { ...polarOff(181 * DEG, 199, 31), yaw: 0 },
  /** Lower Ring market street: from the square south-east along the ring street. */
  market: { a: polar(170 * DEG, 202), b: polar(152 * DEG, 202), width: 8 },
  factory: polar(204 * DEG, 205),
  /** Stone Fist Dojo (Middle Ring). */
  dojo: { c: polar(214 * DEG, 126), hw: 14, hd: 13 },
  university: polar(160 * DEG, 125),
  townHall: polar(122 * DEG, 118),
  marketPlaza: { c: polar(178 * DEG, 125), r: 18 },
  financial: polar(300 * DEG, 125),
  gardenW: { ...polar(232 * DEG, 108), r: 11 },
  /** Upper Ring landmarks. */
  jasmineDragon: polar(150 * DEG, 68),
  avatarHouse: polar(230 * DEG, 70),
  irohApartment: polar(160 * DEG, 76),
  daySpa: polar(36 * DEG, 70),
  warRoom: polar(320 * DEG, 68),
  upperFountains: [polar(120 * DEG, 67), polar(60 * DEG, 67)],
  /** Palace: South Gate on the palace wall; throne hall platform north of C. */
  palace: { gateZ: C.z + R.palace, hallZ: C.z - 6, innerZ: C.z - 26 },
  /** Lake Laogai (global lake at (1060, 170) r=48). */
  lake: { x: 1060, z: 170, r: 48 },
  lakeDock: { a: { x: 1004, z: 168 }, b: { x: 1022, z: 168 } },
  boathouse: { x: 996, z: 160 },
  /** Dai Li base beneath the meadow north-east of the lake (floor/ceiling heights are absolute). */
  daiLiBase: { x0: 1114, x1: 1178, z0: 67, z1: 123, floor: 9, ceil: 19 },
  zoo: polar(146 * DEG, 322),
  hills: [polar(318 * DEG, 330), polar(258 * DEG, 342), polar(122 * DEG, 352)],
  arrival: polar(THETA_MAIN, ARRIVAL_R),
};

/** Lower Ring blocks keep clear of these (squares, market, landmarks). */
export function landmarkClear(x: number, z: number): boolean {
  if (Math.abs(x - BSS.square.x) < BSS.square.hw + 3 && Math.abs(z - BSS.square.z) < BSS.square.hd + 3) return true;
  return false;
}

export const STATIONS: Record<string, StationDef & { line: string; deck: number }> = Object.fromEntries(
  RAIL_LINES.flatMap((l) => l.stations.map((s) => [s.id, { ...s, line: l.id, deck: l.deck }])),
);
