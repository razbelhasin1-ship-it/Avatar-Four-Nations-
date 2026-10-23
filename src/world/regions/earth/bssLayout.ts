import { ROADS, type P2 } from '../../WorldLayout';

/**
 * Ba Sing Se master plan (pure data + math, no three.js).
 *
 * Coordinates are world metres. Angles θ are measured around the city centre
 * with θ = atan2(dz, dx): 0 = east (+X), 90° = south (+Z), 180° = west, 270° = north.
 *
 *   Outer Wall  — irregular loop r≈398..419 around C, 34 m tall, walkable top.
 *   Agrarian Zone — farmland between the walls (Lake Laogai sits here).
 *   Inner Wall  — circle r=232 around C, 20 m tall.
 *   Lower Ring  — ground level (y=26) between the Inner Wall and the Middle terrace.
 *   Middle Ring — raised terrace (y=31), circle r=165 around M (offset south-west).
 *   Upper Ring  — raised terrace (y=37), circle r=75 around U; palace platform on top.
 */

export const C: P2 = { x: 850, z: -50 };
export const GROUND = 26;
export const DEG = Math.PI / 180;

export const OUTER = { height: 34, thick: 14, batter: 1.8, top: GROUND + 34 };
/** Outer wall centre-line radius control points every 30° starting at θ = 0 (east). */
const OUTER_CTRL = [398, 404, 413, 409, 412, 417, 409, 403, 411, 418, 414, 404];

export const INNER = { r: 232, thick: 10, height: 20, top: GROUND + 20 };
export const INNER_FACE_IN = INNER.r - INNER.thick / 2; // 227
export const INNER_FACE_OUT = INNER.r + INNER.thick / 2; // 237

export const MID = { x: 835, z: -15, r: 165, wallT: 3, level: GROUND + 5 };
export const MID_FACE = MID.r + MID.wallT / 2; // 166.5 outer face (lower ring side)
export const MID_INNER = MID.r - MID.wallT / 2; // 163.5 inner face (terrace side)

export const UP = { x: 856, z: -50, r: 75, wallT: 3, level: GROUND + 11 };
export const UP_FACE = UP.r + UP.wallT / 2; // 76.5
export const UP_INNER = UP.r - UP.wallT / 2; // 73.5

/** Palace platform tiers (axis-aligned boxes in x/z) and their top heights. */
export const PALACE = {
  x: 866,
  z: -50,
  tiers: [
    { x0: 818, x1: 908, z0: -88, z1: -12, top: UP.level + 6 },
    { x0: 829, x1: 899, z0: -80, z1: -20, top: UP.level + 12 },
    { x0: 841, x1: 891, z0: -72, z1: -28, top: UP.level + 18 },
  ],
  /** Main hall footprint on the top tier. */
  hall: { x0: 858, x1: 886, z0: -68, z1: -32 },
  /** West grand stair flights (x from → to) — 16 m wide, centred on z = -50. */
  flights: [
    { x0: 811, x1: 818, y0: UP.level, y1: UP.level + 6 },
    { x0: 822, x1: 829, y0: UP.level + 6, y1: UP.level + 12 },
    { x0: 834, x1: 841, y0: UP.level + 12, y1: UP.level + 18 },
  ],
  stairWidth: 16,
};

/** N-S main avenue x and E-W main avenue z. */
export const AXIS_X = 856;
export const AXIS_Z = -50;

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export function wrapAngle(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

export function thetaOf(x: number, z: number, c: P2 = C): number {
  return wrapAngle(Math.atan2(z - c.z, x - c.x));
}

export function polar(theta: number, r: number, c: P2 = C): P2 {
  return { x: c.x + Math.cos(theta) * r, z: c.z + Math.sin(theta) * r };
}

/** Quadrant of the city (relative to C) used to merge big static content into few chunks. */
export function qkey(x: number, z: number): string {
  return `${x < C.x ? 'w' : 'e'}${z < C.z ? 'n' : 's'}`;
}

export function dist(a: P2, b: P2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Periodic Catmull-Rom radius of the outer wall centre line. */
export function outerR(theta: number): number {
  const n = OUTER_CTRL.length;
  const f = (wrapAngle(theta) / (Math.PI * 2)) * n;
  const i = Math.floor(f);
  const t = f - i;
  const p0 = OUTER_CTRL[(i - 1 + n) % n], p1 = OUTER_CTRL[i % n], p2 = OUTER_CTRL[(i + 1) % n], p3 = OUTER_CTRL[(i + 2) % n];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Distance from C along θ to a circle (centre q, radius R) that contains C. */
export function rayToCircle(theta: number, q: P2, R: number): number {
  const dx = Math.cos(theta), dz = Math.sin(theta);
  const ox = C.x - q.x, oz = C.z - q.z;
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - R * R;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

/** Lower Ring band along θ: [inner edge = middle wall face, outer edge = inner wall inner face]. */
export function lowerBand(theta: number): [number, number] {
  return [rayToCircle(theta, MID, MID_FACE), INNER_FACE_IN];
}

export function insideMiddle(x: number, z: number, margin = 0): boolean {
  return Math.hypot(x - MID.x, z - MID.z) < MID_INNER - margin;
}

export function insideUpper(x: number, z: number, margin = 0): boolean {
  return Math.hypot(x - UP.x, z - UP.z) < UP_FACE + margin;
}

/** Intersection of a polyline with the loop r = f(θ) around C (first crossing from outside to inside). */
function crossLoop(points: P2[], f: (t: number) => number): { p: P2; theta: number; dir: P2 } | null {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const steps = Math.ceil(dist(a, b) / 0.5);
    let prev = dist(a, C) - f(thetaOf(a.x, a.z));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const s = dist(p, C) - f(thetaOf(p.x, p.z));
      if ((prev > 0) !== (s > 0)) {
        const l = dist(a, b);
        return { p, theta: thetaOf(p.x, p.z), dir: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } };
      }
      prev = s;
    }
  }
  return null;
}

function road(id: string): P2[] {
  return ROADS.find((r) => r.id === id)?.points ?? [];
}

export interface GateDef {
  id: string;
  /** Angle around C of the gate centre. */
  theta: number;
  /** Gate centre on the wall centre line. */
  x: number;
  z: number;
  /** Wall radius at the gate. */
  r: number;
}

function gateAt(id: string, theta: number, rf: (t: number) => number): GateDef {
  const r = rf(theta);
  const p = polar(theta, r);
  return { id, theta, x: p.x, z: p.z, r };
}

const westRoad = [...road('northern_road').slice(-2), ...road('ba_sing_se_west').slice(1)];
const westCross = crossLoop(westRoad, outerR);
const southRoad = road('southern_road');
const southCross = crossLoop([...southRoad].reverse(), outerR);

export const OUTER_GATES: GateDef[] = [
  gateAt('west', westCross ? westCross.theta : 196 * DEG, outerR),
  gateAt('south', southCross ? southCross.theta : 97 * DEG, outerR),
  gateAt('east', 0, outerR),
];

const innerRoadCross = crossLoop(road('ba_sing_se_west'), () => INNER.r);

/** Inner wall gates (centre line r = 232). */
export const INNER_GATES: GateDef[] = [
  gateAt('west', innerRoadCross ? innerRoadCross.theta : 191 * DEG, () => INNER.r),
  gateAt('south', thetaOf(AXIS_X, C.z + Math.sqrt(INNER.r ** 2 - (AXIS_X - C.x) ** 2)), () => INNER.r),
  gateAt('east', 0, () => INNER.r),
  gateAt('north', thetaOf(AXIS_X, C.z - Math.sqrt(INNER.r ** 2 - (AXIS_X - C.x) ** 2)), () => INNER.r),
];

/** Middle terrace stair-gates: point on the outer face + outward unit direction (from M). */
export interface TerraceGate {
  id: string;
  x: number;
  z: number;
  /** Outward unit vector (stairs descend this way). */
  nx: number;
  nz: number;
}

function circleLineX(q: P2, R: number, x: number, sign: number): P2 {
  return { x, z: q.z + sign * Math.sqrt(R * R - (x - q.x) ** 2) };
}

function circleLineZ(q: P2, R: number, z: number, sign: number): P2 {
  return { x: q.x + sign * Math.sqrt(R * R - (z - q.z) ** 2), z };
}

const mw = circleLineZ(MID, MID_FACE, AXIS_Z, -1);
const ms = circleLineX(MID, MID_FACE, AXIS_X, 1);
const me = circleLineZ(MID, MID_FACE, AXIS_Z, 1);
const mn = circleLineX(MID, MID_FACE, AXIS_X, -1);

/** Middle ring gates. Stairs are axis-aligned along the avenues. */
export const MID_GATES: TerraceGate[] = [
  { id: 'west', x: mw.x, z: mw.z, nx: -1, nz: 0 },
  { id: 'south', x: ms.x, z: ms.z, nx: 0, nz: 1 },
  { id: 'east', x: me.x, z: me.z, nx: 1, nz: 0 },
  { id: 'north', x: mn.x, z: mn.z, nx: 0, nz: -1 },
];

export const UP_GATES: TerraceGate[] = [
  { id: 'west', x: UP.x - UP_FACE, z: UP.z, nx: -1, nz: 0 },
  { id: 'south', x: UP.x, z: UP.z + UP_FACE, nx: 0, nz: 1 },
  { id: 'east', x: UP.x + UP_FACE, z: UP.z, nx: 1, nz: 0 },
  { id: 'north', x: UP.x, z: UP.z - UP_FACE, nx: 0, nz: -1 },
];

/** Inner mouth of an outer gate (inside the city) and outer mouth (outside). */
export function gateMouth(g: GateDef, thick: number, inward: boolean, extra = 0): P2 {
  return polar(g.theta, g.r + (inward ? -1 : 1) * (thick / 2 + extra));
}

// ---------------------------------------------------------------------------
// Avenues & squares
// ---------------------------------------------------------------------------

export interface Avenue {
  id: string;
  points: P2[];
  width: number;
}

const ogW = OUTER_GATES[0], ogS = OUTER_GATES[1], ogE = OUTER_GATES[2];
const igW = INNER_GATES[0], igS = INNER_GATES[1], igE = INNER_GATES[2], igN = INNER_GATES[3];

/** Paved avenues across the Agrarian Zone (gate to gate). */
export const AGRARIAN_AVENUES: Avenue[] = [
  { id: 'west', points: [gateMouth(ogW, OUTER.thick, true, 6), { x: 600, z: -100 }, gateMouth(igW, INNER.thick, false, 4)], width: 12 },
  { id: 'south', points: [gateMouth(ogS, OUTER.thick, true, 6), { x: 850, z: 280 }, { x: AXIS_X, z: 236 }, gateMouth(igS, INNER.thick, false, 4)], width: 12 },
  { id: 'east', points: [gateMouth(ogE, OUTER.thick, true, 6), gateMouth(igE, INNER.thick, false, 4)], width: 12 },
];

/** Avenues inside the Lower Ring (inner gate → middle stairs). */
export const LOWER_AVENUES: Avenue[] = [
  { id: 'south', points: [gateMouth(igS, INNER.thick, true, 1), { x: AXIS_X, z: MID_GATES[1].z + 9 }], width: 12 },
  { id: 'east', points: [gateMouth(igE, INNER.thick, true, 1), { x: MID_GATES[2].x + 9, z: AXIS_Z }], width: 12 },
  { id: 'north', points: [gateMouth(igN, INNER.thick, true, 1), { x: AXIS_X, z: MID_GATES[3].z - 9 }], width: 12 },
];

/** Avenues on the Middle terrace (middle gate → upper stairs). */
export const MIDDLE_AVENUES: Avenue[] = [
  { id: 'west', points: [{ x: MID_GATES[0].x, z: AXIS_Z }, { x: UP_GATES[0].x - 10, z: AXIS_Z }], width: 16 },
  { id: 'south', points: [{ x: AXIS_X, z: MID_GATES[1].z }, { x: AXIS_X, z: UP_GATES[1].z + 10 }], width: 12 },
  { id: 'east', points: [{ x: MID_GATES[2].x, z: AXIS_Z }, { x: UP_GATES[2].x + 10, z: AXIS_Z }], width: 12 },
  { id: 'north', points: [{ x: AXIS_X, z: MID_GATES[3].z }, { x: AXIS_X, z: UP_GATES[3].z - 10 }], width: 12 },
];

/** Lower Ring Square (Earth start). Polygon (convex), clipped visually by the walls. */
export const LOWER_SQUARE = { x0: 622, x1: 690, z0: -104, z1: -6 };

export const LANDMARK_PTS = {
  outerGate: { x: 430, z: -110 },
  lower: { x: 650, z: -40 },
  middle: { x: 760, z: -50 },
  upper: { x: 850, z: -50 },
  dojo: { x: 700, z: 40 },
  spawn: { x: 640, z: -30 },
  elder: { x: 652, z: -22 },
};

export const LAKE_LAOGAI = { x: 1060, z: 170, r: 48 };

// ---------------------------------------------------------------------------
// Monorail
// ---------------------------------------------------------------------------

export const RAIL = {
  deck: GROUND + 22, // lower ring line deck top (y = 48)
  wallDeck: OUTER.top, // outer wall stations (y = 60)
};

/** Middle of the Lower Ring band at θ (used by the loop line). */
export function lowerMid(theta: number): number {
  const [a, b] = lowerBand(theta);
  return (a + b) / 2;
}

export interface RailLine {
  id: string;
  points: Array<P2 & { y: number }>;
}

function loopPoints(t0: number, t1: number, step: number, y: number): Array<P2 & { y: number }> {
  const out: Array<P2 & { y: number }> = [];
  const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / step));
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const p = polar(t, lowerMid(t));
    out.push({ ...p, y });
  }
  return out;
}

/** Station positions (deck centre). */
export const STATIONS = {
  lowerWest: { ...polar(222 * DEG, lowerMid(222 * DEG)), y: RAIL.deck, theta: 222 * DEG },
  lowerNorth: { ...polar(270 * DEG, lowerMid(270 * DEG)), y: RAIL.deck, theta: 270 * DEG },
  lowerEast: { ...polar(338 * DEG, lowerMid(338 * DEG)), y: RAIL.deck, theta: 338 * DEG },
  outerWest: { ...polar(222 * DEG, outerR(222 * DEG)), y: RAIL.wallDeck, theta: 222 * DEG },
  outerEast: { ...polar(338 * DEG, outerR(338 * DEG)), y: RAIL.wallDeck, theta: 338 * DEG },
  outerSouth: { ...polar(84 * DEG, outerR(84 * DEG)), y: RAIL.wallDeck, theta: 84 * DEG },
};

/** Half-width of a station platform (spurs end at its side). */
export const STATION_HALF = 7.5;

export const RAIL_LINES: RailLine[] = [
  // Ring line through the Lower Ring (west → north → east).
  { id: 'loop', points: loopPoints(222 * DEG, 352 * DEG, 3 * DEG, RAIL.deck) },
  // Spurs from the outer wall stations to the loop / inner wall (straight, graded).
  {
    id: 'west_spur',
    points: [
      { ...polar(222 * DEG, outerR(222 * DEG) - OUTER.thick / 2 - 4), y: RAIL.wallDeck },
      { ...polar(222 * DEG, lowerMid(222 * DEG) + STATION_HALF), y: RAIL.deck },
    ],
  },
  {
    id: 'east_spur',
    points: [
      { ...polar(338 * DEG, outerR(338 * DEG) - OUTER.thick / 2 - 4), y: RAIL.wallDeck },
      { ...polar(338 * DEG, lowerMid(338 * DEG) + STATION_HALF), y: RAIL.deck },
    ],
  },
  {
    id: 'south_spur',
    points: [
      { ...polar(84 * DEG, outerR(84 * DEG) - OUTER.thick / 2 - 4), y: RAIL.wallDeck },
      { ...polar(84 * DEG, INNER.r + INNER.thick / 2 + 2), y: INNER.top + 4 },
    ],
  },
];
