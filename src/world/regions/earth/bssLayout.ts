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
 *   0-44      0-11     Royal Palace inside the arcaded wall ring (the palace loop viaduct runs on it)
 *   44-102    11-25    Upper Ring (radial lines end on curved stubs at r=58)
 *   102       25       ring wall + 上環 gates (Middle | Upper)
 *   102-170   25-41    Middle Ring
 *   170       41       ring wall + 中環 gates (Lower | Middle)
 *   170-246   41-60    Lower Ring (outer loop viaduct at r=232, against the Inner Wall)
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
export const RING_FRAC = { palace: 0.1073, upper: 0.2488, middle: 0.4146, inner: 0.6 };
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
  loopDeck: 40,
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
export const TRAINS = { radial: 2, outerLoop: 2, innerLoop: 1, carsMin: 3, carsMax: 5, cruise: 18, accel: 2.6, dwell: 15, terminalDwell: 16 };
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

/** Block frame at p: local +Z faces the palace, local +X runs along the ring (+θ). */
export function ringLocal(p: P2): { yaw: number; at(lx: number, lz: number): P2 } {
  const t = Math.atan2(p.z - C.z, p.x - C.x);
  const tx = -Math.sin(t), tz = Math.cos(t), fx = -Math.cos(t), fz = -Math.sin(t);
  return { yaw: Math.atan2(fx, fz), at: (lx, lz) => ({ x: p.x + tx * lx + fx * lz, z: p.z + tz * lx + fz * lz }) };
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
  { id: 'west', theta: THETA_MAIN, r0: 66, r1: R.inner, width: STREET.avenue },
  { id: 'south', theta: 90 * DEG, r0: R.palace + 4, r1: R.inner, width: STREET.avenue },
  { id: 'east', theta: 0, r0: 66, r1: R.inner, width: 10 },
  { id: 'north', theta: 270 * DEG, r0: 66, r1: R.inner, width: 10 },
];

/** Ring streets (circles around C): Upper Ring promenade, Middle and Lower Ring ring roads. */
export const RING_STREETS = {
  upper: { r: 70, width: 8 },
  middleIn: { r: 116, width: 8 },
  middleOut: { r: 156, width: 8 },
  lowerIn: { r: 182, width: 7 },
  lowerMid: { r: 212, width: 6 },
};

/** Narrow muddy ring lanes of the Lower Ring (back alleys and the lane along the viaduct arcade). */
export const LOWER_LANES = [
  { r: 197, width: STREET.lane },
  { r: 225, width: STREET.lane },
];

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
  /** CJK station name for the signboards. */
  cjk: string;
  /** Lift tower side: +1 = +normal of the line, −1 = −normal, 0 = none (reached across a neighbouring platform). */
  stairs: 1 | -1 | 0;
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
/** Lower Ring junction stations (platform centres) and the outer loop radius. */
const Y_R = 210;
export const LOOP_R = 232;
const MID_R = 136;
const TERM_R = 58;
/** Trunk lateral offsets from the west avenue axis (+ = north). The avenue runs between C and S. */
export const TRUNK = { north: 26.5, central: 10.5, south: -10.5 };

function circlePts(r: number, n: number, t0 = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) out.push(polar(t0 + (i / n) * Math.PI * 2, r));
  return out;
}

const tm = THETA_MAIN;

export const RAIL_LINES: RailLineDef[] = [
  {
    id: 'central',
    name: 'Central Line',
    kind: 'shuttle',
    deck: RAIL.deck,
    pts: [
      polarOff(tm, ARRIVAL_R, TRUNK.central),
      polarOff(tm, Y_R, TRUNK.central),
      polarOff(tm, MID_R, TRUNK.central),
      polarOff(tm, 94, TRUNK.central),
      polar(tm + 14 * DEG, 68),
      polar(tm + 28 * DEG, TERM_R),
      polar(tm + 44 * DEG, TERM_R),
    ],
    stations: [
      { id: 'arrival_c', name: 'Outer Wall Arrival Station', cjk: '外城站', at: polarOff(tm, ARRIVAL_R, TRUNK.central), stairs: 0 },
      { id: 'y_c', name: 'Lower Ring Junction', cjk: '下環站', at: polarOff(tm, Y_R, TRUNK.central), stairs: 0 },
      { id: 'mid_c', name: 'Middle Ring West', cjk: '中環站', at: polarOff(tm, MID_R, TRUNK.central), stairs: 1 },
      { id: 'up_c', name: 'Upper Ring West', cjk: '上環站', at: polar(tm + 44 * DEG, TERM_R), stairs: 1 },
    ],
    trains: TRAINS.radial,
  },
  {
    id: 'north',
    name: 'North Line',
    kind: 'shuttle',
    deck: RAIL.deck,
    pts: [
      polarOff(tm, ARRIVAL_R, TRUNK.north),
      polarOff(tm, Y_R + 26, TRUNK.north),
      polarOff(tm, Y_R - 26, TRUNK.north),
      polar(214 * DEG, 164),
      polar(228 * DEG, 148),
      polar(240 * DEG, MID_R),
      polar(252 * DEG, 108),
      polar(262 * DEG, 80),
      polar(272 * DEG, 63),
      polar(284 * DEG, TERM_R),
      polar(298 * DEG, TERM_R),
    ],
    stations: [
      { id: 'arrival_n', name: 'Outer Wall Arrival Station', cjk: '外城站', at: polarOff(tm, ARRIVAL_R, TRUNK.north), stairs: 1 },
      { id: 'y_n', name: 'Lower Ring Junction', cjk: '下環站', at: polarOff(tm, Y_R, TRUNK.north), stairs: 1 },
      { id: 'mid_n', name: 'Middle Ring North', cjk: '中環站', at: polar(240 * DEG, MID_R), stairs: 1 },
      { id: 'up_n', name: 'Upper Ring North', cjk: '上環站', at: polar(298 * DEG, TERM_R), stairs: 1 },
    ],
    trains: TRAINS.radial,
  },
  {
    id: 'south',
    name: 'South Line',
    kind: 'shuttle',
    deck: RAIL.deck,
    pts: [
      polarOff(tm, ARRIVAL_R, TRUNK.south),
      polarOff(tm, Y_R + 26, TRUNK.south),
      polarOff(tm, Y_R - 26, TRUNK.south),
      polar(178 * DEG, 164),
      polar(164 * DEG, 148),
      polar(154 * DEG, MID_R),
      polar(136 * DEG, 110),
      polar(118 * DEG, 80),
      polar(104 * DEG, 63),
      polar(92 * DEG, TERM_R),
      polar(70 * DEG, TERM_R),
    ],
    stations: [
      { id: 'arrival_s', name: 'Outer Wall Arrival Station', cjk: '外城站', at: polarOff(tm, ARRIVAL_R, TRUNK.south), stairs: -1 },
      { id: 'y_s', name: 'Lower Ring Junction', cjk: '下環站', at: polarOff(tm, Y_R, TRUNK.south), stairs: -1 },
      { id: 'mid_s', name: 'Middle Ring South', cjk: '中環站', at: polar(154 * DEG, MID_R), stairs: -1 },
      { id: 'up_s', name: 'Palace South Gate', cjk: '王宮南門', at: polar(70 * DEG, TERM_R), stairs: 1 },
    ],
    trains: TRAINS.radial,
  },
  {
    id: 'outer_loop',
    name: 'Outer Loop',
    kind: 'loop',
    deck: RAIL.loopDeck,
    pts: circlePts(LOOP_R, 100),
    stations: [
      { id: 'loop_y', name: 'Lower Ring Junction', cjk: '下環站', at: polar(tm, LOOP_R), stairs: 1 },
      { id: 'loop_ne', name: 'Lower Ring Northeast', cjk: '下環站', at: polar(316 * DEG, LOOP_R), stairs: 1 },
      { id: 'loop_se', name: 'Lower Ring Southeast', cjk: '下環站', at: polar(76 * DEG, LOOP_R), stairs: 1 },
    ],
    trains: TRAINS.outerLoop,
  },
  {
    id: 'inner_loop',
    name: 'Palace Loop',
    kind: 'loop',
    deck: RAIL.deck,
    pts: circlePts(R.palace, 56),
    stations: [
      { id: 'pal_w', name: 'Upper Ring West', cjk: '上環站', at: polar(tm + 36 * DEG, R.palace), stairs: -1 },
      { id: 'pal_n', name: 'Upper Ring North', cjk: '上環站', at: polar(291 * DEG, R.palace), stairs: -1 },
      { id: 'pal_s', name: 'Upper Ring East', cjk: '上環站', at: polar(40 * DEG, R.palace), stairs: -1 },
    ],
    trains: TRAINS.innerLoop,
  },
];

// ---------------------------------------------------------------------------
// Districts and landmarks (shared by builders and published spots)
// ---------------------------------------------------------------------------

const sq = polar(174 * DEG, 204);

/** Hand-placed features (world metres). */
export const BSS = {
  /** Firelight Fountain square in the Lower Ring (Earth start). */
  square: { x: sq.x, z: sq.z, hw: 21, hd: 19 },
  fountain: { x: sq.x + 2, z: sq.z, r: 6.5 },
  spawn: { x: sq.x - 13, z: sq.z + 7 },
  elder: { x: sq.x - 9, z: sq.z + 12 },
  kingStatue: { x: sq.x + 2, z: sq.z - 15 },
  /** Pao Family Tea House (Lower Ring, north side of the square). */
  paoTea: { ...polarOff(177 * DEG, 204, 16.5), yaw: 0 },
  /** Lower Ring market street: from the square south-east along the ring street. */
  /** Lower Ring market: the 212 m ring street between these angles, widened for stalls on both sides. */
  market: { t0: 148 * DEG, t1: 166 * DEG, r: 212, width: 13 },
  factory: polar(186.5 * DEG, 204),
  stable: polar(160 * DEG, 219),
  /** Middle Ring (r 106-166) blocks between the ring streets: centre, hw along the ring, hd radial.
   *  Kept clear of the viaducts and stations (tests/tools/earth_probe.test.ts, EARTH_PROBE=blocks). */
  dojo: { c: polar(258 * DEG, 136), hw: 14, hd: 14.5 },
  university: { c: polar(315 * DEG, 136), hw: 19, hd: 14.5 },
  townHall: { c: polar(30 * DEG, 136), hw: 15, hd: 14.5 },
  /** Counting houses fronting the inner ring street. */
  financial: { c: polar(290 * DEG, 126.2), hw: 17, hd: 5.5 },
  marketPlaza: { c: polar(181 * DEG, 136), r: 15 },
  gardenW: { c: polar(212.75 * DEG, 136), r: 11 },
  spa: { c: polar(112 * DEG, 136), hw: 10, hd: 14.5 },
  poetry: { c: polar(62 * DEG, 136), hw: 9, hd: 14.5 },
  /** Upper Ring landmark blocks in the outer row (r 76-96.5): centre angle and half-width along the ring.
   *  Sectors clear of the viaducts (EARTH_PROBE=blocks BSS_R0=74.5 BSS_R1=97). */
  upper: {
    warRoom: { t: 322 * DEG, hw: 12 },
    fancyLady: { t: 36 * DEG, hw: 11 },
    jasmineDragon: { t: 150 * DEG, hw: 12 },
    irohApartment: { t: 171 * DEG, hw: 7.5 },
    avatarHouse: { t: 232 * DEG, hw: 11 },
    fountains: [{ t: 60 * DEG, hw: 7 }, { t: 300 * DEG, hw: 7 }],
  },
  /** Palace (offsets from C; +z = south, the axis runs from the South Gate north to the throne hall).
   *  Three-tier platform (tops 2/4/6 m), throne hall on the top tier, Golden Water canal inside the gate. */
  palace: {
    tiers: [
      { hw: 24, z0: -20, z1: 28, h: 2 },
      { hw: 21, z0: -17, z1: 25, h: 4 },
      { hw: 18, z0: -14, z1: 22, h: 6 },
    ],
    hall: { hw: 15, z0: -11, z1: 3 },
    terraceZ: 15,
    canalZ: 34,
    gate: { hw: 12, z0: 39.5, z1: 48.5, h: 9 },
    innerWallZ: -24,
  },
  /** Lake Laogai (global lake at (1060, 170) r=48). */
  lake: { x: 1060, z: 170, r: 48 },
  lakeDock: { a: { x: 1004, z: 168 }, b: { x: 1022, z: 168 } },
  boathouse: { x: 996, z: 160 },
  /** The Dai Li base, sealed inside a rock hill on the north-east shore (the terrain cannot be dug, so the
   *  hill is the "underground"). The concealed door is in the hill's lakeside spur; stepping stones rise
   *  from the water between the east shore and the door. */
  laogai: {
    hill: { x: 1142, z: 98, rx: 36, rz: 33, h: 21 },
    door: { x: 1092.3, z: 141.6 },
    path: { a: { x: 1108.1, z: 153.2 }, b: { x: 1092.0, z: 144.8 } },
  },
  /** Welcome gateway over the West road just inside the Outer Wall (radius on THETA_MAIN). */
  arrivalGate: { r: 381 },
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
