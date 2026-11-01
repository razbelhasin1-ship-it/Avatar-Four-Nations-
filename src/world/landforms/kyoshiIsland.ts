import { SimplexNoise } from '../../core/Noise';
import type { BiomeWeights } from '../Heightfield';
import type { LakeDef, P2, PlateauDef, RiverDef, RoadDef } from '../WorldLayout';

/**
 * Kyoshi Island — its own map (zone `kyoshi_island`), far off the mainland's east edge, reached only
 * by the travel routes (src/data/travel.ts). Pure landform + master layout (no three.js), shared by
 * the terrain (Heightfield) and the island's region builders so ground and buildings always agree.
 * Tweak the constants here; everything else derives from them.
 *
 * Frame: B is the bay centre (= zone centre). Polar coordinates around B use the compass bearing
 * b in degrees (0 = north / −Z, 90 = east / +X). The island is a crescent of ridges wrapped around
 * Koi Bay, which opens to the south-west. Along the crescent, u runs 0 → 1 from the west tip
 * (b = 255) clockwise through north and east to the east tip (b = 195):
 *
 *   u 0–0.12      west arm: forest trail, sea cliffs, Corsair Cove
 *   u 0.12–0.30   Koi Bay beach; the bison landing meadow above it (u ≈ 0.215)
 *   u 0.33–0.47   Suki's village: Avatar statue at the entrance, street up to the Meeting Hall
 *   u ≈ 0.52      Kyoshi Dojo (north-east of the village); shrine knoll at u ≈ 0.58
 *   u ≈ 0.665     Crystal Falls stream and the Crescent Bridge on the coast road
 *   u 0.74–0.90   Koi Harbor: piers into the bay, fish market, warehouses, the traders' inn
 *   u 0.92–1      east arm: rocky headland
 *
 * `r` is the distance from B; the land band runs from the bay shore (r = Ri) to the outer coast
 * (r = Ri + thick(u)); `t` = (r − Ri) / thick is the position across the band (crest ≈ 0.64).
 */
export const KI = {
  /** Zone id (its own map) and the region id used on it (the mainland already has a `kyoshi_island` region). */
  zone: 'kyoshi_island',
  regionId: 'kyoshi_isle',
  name: 'Kyoshi Island',
  seed: 0x6b51,
  /** Bay centre = zone centre: ~4.5 km of open sea east of the mainland (whose edge is x = 2048). */
  B: { x: 7200, z: 0 },
  /** Half-size of the zone's square (terrain, feature grid, height texture window). */
  half: 1280,
  /** Swimming or flying farther than this from B, currents and winds turn you back. */
  seaLimit: 1080,
  /** West tip bearing and the crescent's angular span (clockwise). */
  b0: 255,
  span: 300,
  /** Bay (inner shore) radius. */
  Ri: 205,
  /** Land band thickness at the tips and in the middle. */
  thickTip: 200,
  thickMid: 600,
  /** Ridge crest position across the band (farther back behind the village and the dojo). */
  crest: 0.58,
  /** Offshore islet (bearing, distance, radius, height). */
  islet: { b: 236, r: 660, rad: 30, h: 22 },
  /** Sea stacks off the outer coast: [u, offshore distance, radius, height]. */
  stacks: [
    [0.035, 34, 10, 30],
    [0.105, 44, 12, 36],
    [0.45, 40, 9, 24],
    [0.6, 30, 11, 28],
    [0.955, 36, 10, 22],
  ] as ReadonlyArray<readonly [number, number, number, number]>,
  /** Corsair Cove: an inlet in the west arm's outer cliffs (u, radius). */
  cove: { u: 0.06, rad: 26 },
  // ---- Settlements (u, r) ----
  meadow: { u: 0.215, r: 336 },
  village: { u: 0.385, gateR: 268, hallR: 384 },
  dojo: { u: 0.52, r: 404 },
  shrine: { u: 0.58, r: 306, y: 46 },
  falls: { u: 0.665 },
  harbor: { u0: 0.745, u1: 0.895, quayR: 216, y: 2.6 },
} as const;

const noise = new SimplexNoise(KI.seed);
const noiseB = new SimplexNoise(KI.seed + 17);

const D2R = Math.PI / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smooth bump that is 1 on [a, b] and fades to 0 over `f` on each side. */
const band = (x: number, a: number, b: number, f: number) => sstep(a - f, a, x) * (1 - sstep(b, b + f, x));

// ---------------------------------------------------------------------------
// Polar frame
// ---------------------------------------------------------------------------

/** True inside the zone's square (its own map). */
export function inKyoshiZone(x: number, z: number): boolean {
  return Math.abs(x - KI.B.x) <= KI.half && Math.abs(z - KI.B.z) <= KI.half;
}

/** Compass bearing (deg, 0..360) of (x, z) seen from B. */
export function bearingOf(x: number, z: number): number {
  const b = Math.atan2(x - KI.B.x, -(z - KI.B.z)) / D2R;
  return b < 0 ? b + 360 : b;
}

/** Crescent parameter for a bearing: 0 at the west tip, 1 at the east tip, beyond either in the bay mouth. */
export function arcU(b: number): number {
  let d = (((b - KI.b0) % 360) + 360) % 360;
  // The mouth (the gap between the tips) splits halfway: its first half lies past the east tip.
  if (d > KI.span + (360 - KI.span) / 2) d -= 360;
  return d / KI.span;
}

/** World point at crescent parameter u and distance r from B. */
export function A(u: number, r: number): P2 {
  const b = (KI.b0 + KI.span * u) * D2R;
  return { x: KI.B.x + Math.sin(b) * r, z: KI.B.z - Math.cos(b) * r };
}

/** World point at bearing b (deg) and distance r from B. */
export function atBearing(b: number, r: number): P2 {
  return { x: KI.B.x + Math.sin(b * D2R) * r, z: KI.B.z - Math.cos(b * D2R) * r };
}

/** Yaw (root.rotation.y; local +Z forward) that faces from B outward along bearing b. */
export function yawOutward(u: number): number {
  const b = (KI.b0 + KI.span * u) * D2R;
  // forward (sin yaw, cos yaw) must equal (sin b, −cos b)
  return Math.atan2(Math.sin(b), -Math.cos(b));
}

/** Land band thickness at u. */
export function thickAt(u: number): number {
  const uc = clamp01(u);
  return KI.thickTip + (KI.thickMid - KI.thickTip) * Math.pow(Math.sin(Math.PI * uc), 0.7);
}

/** Ridge height along the crescent (before noise): summits behind the village and above the falls. */
const RIDGE: ReadonlyArray<readonly [number, number]> = [
  [-0.08, 30],
  [0.0, 60],
  [0.07, 118],
  [0.15, 98],
  [0.26, 126],
  [0.35, 136],
  [0.43, 152],
  [0.52, 136],
  [0.6, 150],
  [0.7, 158],
  [0.8, 118],
  [0.88, 106],
  [0.95, 88],
  [1.0, 58],
  [1.08, 28],
];

/**
 * 0..1 rise whose slope ramps up over the first fifth, holds, and eases off over the last fifth: the
 * steepest point is 1.25x the average (a smoothstep's is 1.5x), so long hillsides stay grass and forest.
 */
function rise(k: number): number {
  const a = 0.2;
  if (k <= a) return (k * k) / (2 * a * (1 - a));
  if (k >= 1 - a) return 1 - ((1 - k) * (1 - k)) / (2 * a * (1 - a));
  return (k - a / 2) / (1 - a);
}

function ridgeHeight(u: number): number {
  if (u <= RIDGE[0][0]) return RIDGE[0][1];
  for (let i = 1; i < RIDGE.length; i++) {
    const [u1, h1] = RIDGE[i];
    if (u <= u1) {
      const [u0, h0] = RIDGE[i - 1];
      const k = (u - u0) / (u1 - u0);
      return mix(h0, h1, k * k * (3 - 2 * k));
    }
  }
  return RIDGE[RIDGE.length - 1][1];
}

export interface KyoshiPolar {
  r: number;
  b: number;
  u: number;
  /** Position across the land band (0 bay shore → 1 outer coast). */
  t: number;
  thick: number;
}

/** Polar description of (x, z) (no noise). */
export function kyoshiPolar(x: number, z: number, out: KyoshiPolar = { r: 0, b: 0, u: 0, t: 0, thick: 1 }): KyoshiPolar {
  const dx = x - KI.B.x, dz = z - KI.B.z;
  out.r = Math.sqrt(dx * dx + dz * dz);
  out.b = bearingOf(x, z);
  out.u = arcU(out.b);
  out.thick = thickAt(out.u);
  out.t = (out.r - KI.Ri) / out.thick;
  return out;
}

const pol: KyoshiPolar = { r: 0, b: 0, u: 0, t: 0, thick: 1 };
const capR = KI.thickTip / 2;
const tipW = A(0, KI.Ri + capR);
const tipE = A(1, KI.Ri + capR);
const isletP = atBearing(KI.islet.b, KI.islet.r);
const stackP = KI.stacks.map(([u, off, rad, h]) => {
  const p = A(u, KI.Ri + thickAt(u) + off);
  return { x: p.x, z: p.z, rad, h };
});
const coveP = A(KI.cove.u, KI.Ri + thickAt(KI.cove.u) - 6);

/**
 * Signed distance to the crescent's coastline (negative on land), before coast noise.
 * Inside the angular range: the annulus band; beyond a tip: a rounded cap.
 */
function bandSdf(x: number, z: number, p: KyoshiPolar): number {
  let d: number;
  if (p.u >= 0 && p.u <= 1) d = Math.max(KI.Ri - p.r, p.r - (KI.Ri + p.thick));
  else d = Infinity;
  // Rounded caps at both tips (also cover the band's cut ends).
  const cw = Math.hypot(x - tipW.x, z - tipW.z) - capR;
  const ce = Math.hypot(x - tipE.x, z - tipE.z) - capR;
  return Math.min(d, cw, ce);
}

/**
 * Natural terrain height on the island's map (before plateaus, roads, rivers — Heightfield applies
 * those from KI_PLATEAUS / KI_ROADS / KI_RIVERS like on the mainland).
 */
export function kyoshiNaturalHeight(x: number, z: number): number {
  // Gentle domain warp so coasts and ridges are not drawn with a compass.
  const wx = x + 16 * noise.noise2(x / 170, z / 170);
  const wz = z + 16 * noise.noise2(x / 170 + 41.3, z / 170 - 7.9);
  const p = kyoshiPolar(wx, wz, pol);
  const outerness = sstep(0.32, 0.7, p.t);
  // Coast: smooth along the bay (beaches), ragged on the outer coast; Corsair Cove bites into the west arm.
  let d = bandSdf(wx, wz, p);
  d += mix(4, 20, outerness) * noise.fbm2(x / 95, z / 95, 3);
  const cove = KI.cove.rad - Math.hypot(x - coveP.x, z - coveP.z);
  if (cove > -30) d = Math.max(d, cove * 0.9);
  const s = -d;

  let h: number;
  if (s < 0) {
    // Sea floor: shallow, sandy shelves in the bay (clear shallows), a deep channel down its middle
    // (the unagi's), steeper and deeper off the outer coasts.
    const inBay = sstep(KI.Ri + 40, KI.Ri - 20, p.r) * band(p.u, 0.02, 0.98, 0.06);
    h = 0.3 + s * mix(0.2, 0.085, inBay);
    h = Math.max(h, mix(-46, -9, inBay));
    const channel = sstep(150, 40, p.r) * inBay;
    h = Math.min(h, mix(h, -22 + 3 * noiseB.noise2(x / 60, z / 60), channel));
    h += 0.8 * noiseB.noise2(x / 30, z / 30);
  } else {
    const u = p.u;
    const t = clamp01(p.t);
    // Settlement sectors: the ridge rises farther inland where the village, dojo, meadow and harbour sit.
    const village = band(u, 0.335, 0.455, 0.03);
    const dojo = band(u, 0.49, 0.555, 0.03);
    const harbor = band(u, 0.73, 0.9, 0.04);
    const meadow = band(u, 0.18, 0.25, 0.03);
    // (the ridge foot lies beyond the hall's, the dojo's and the meadow's flat platforms)
    const tStart = 0.1 + 0.28 * village + 0.32 * dojo + 0.05 * harbor + 0.3 * meadow;
    // Piedmont: from the beach up toward the ridge foot; flatter behind the harbour.
    const pied = 2.6 + (48 - 22 * harbor) * Math.pow(Math.min(t, 0.62), 1.7);
    // Ridge: the village sits in a valley whose head rises well behind the Meeting Hall; the outer
    // side falls steeply to sea cliffs; notched where Crystal Falls comes down.
    const crest = KI.crest + 0.16 * village + 0.16 * dojo + 0.18 * meadow;
    const shape = t < crest ? rise(clamp01((t - tStart) / (crest - tStart))) : Math.pow(1 - sstep(crest, 1.04, t), 0.85);
    const notch = 1 - 0.5 * Math.exp(-(((u - KI.falls.u) / 0.022) ** 2));
    const rough = 0.82 + 0.28 * noise.ridged2(x / 320, z / 320, 3);
    const ridge = Math.min(200, ridgeHeight(u) * rough) * notch;
    h = pied * (1 - 0.72 * sstep(0.74, 1.0, t)) + ridge * shape;
    // Gullies and spurs on the flanks, and small ground undulation.
    h += 3.5 * noiseB.fbm2(x / 70, z / 70, 3) * sstep(0.25, 0.55, t);
    h += 0.6 * noise.noise2(x / 13, z / 13);
    // Coastal clamp: sandy beaches along the bay, sea cliffs on the outer coast (higher on the west arm).
    // `s` is the distance to the nearest coast: on the bay side the clamp only keeps the shore low and
    // lets go within ~90 m, so the hillsides follow the ridge profile instead of a clamped wall.
    const westCliff = band(u, -0.1, 0.16, 0.06) * outerness;
    const kIn = 0.15 + 1.1 * sstep(25, 90, s);
    const k = mix(kIn, 1.7 + 0.9 * westCliff, sstep(0.42, 0.56, t));
    h = Math.min(h, 0.5 + k * s);
    if (s < 3 && outerness < 0.5) h = Math.min(h, 0.6 + 0.5 * s); // the last metres of a beach are sand-flat
  }

  // Offshore islet: a rocky knob with a reef skirt.
  {
    const di = Math.hypot(x - isletP.x, z - isletP.z);
    const R = KI.islet.rad;
    if (di < R * 1.8) {
      h = Math.max(h, mix(-10, 0.4, sstep(R * 1.8, R * 1.05, di)));
      if (di < R) {
        const c = 1 - di / R;
        h = Math.max(h, 0.8 + KI.islet.h * Math.pow(c, 1.15) * (0.75 + 0.4 * noise.ridged2(x / 22, z / 22, 3)));
      }
    }
  }
  // Sea stacks: tall pillars just off the outer coast.
  for (let i = 0; i < stackP.length; i++) {
    const st = stackP[i];
    const di = Math.hypot(x - st.x, z - st.z);
    if (di > st.rad * 2.2) continue;
    const wob = 1 + 0.18 * noise.noise2(Math.atan2(z - st.z, x - st.x) * 1.4 + i * 3.1, i * 1.7);
    const q = di / (st.rad * wob);
    if (q < 1) h = Math.max(h, st.h * (1 - Math.pow(q, 6)) * (0.9 + 0.1 * noise.noise2(x / 6, z / 6)));
    else if (q < 2.2) h = Math.max(h, mix(-6, 1.5, sstep(2.2, 1, q)));
  }
  return h;
}

/**
 * Surface weights on the island (9 channels: grass, dirt, rock, sand, snow, ice, ash, mud, gravel):
 * its ridges are green and brown to the crests (grass, scrub, bare earth); rock shows only on cliffs.
 */
export function kyoshiSurface(w: Float32Array, slope: number, h: number): void {
  const keep = sstep(0.36, 0.46, slope) + 0.45 * sstep(140, 185, h) * sstep(0.2, 0.3, slope);
  const moved = w[2] * (1 - clamp01(keep));
  w[2] -= moved;
  w[0] += moved * 0.62;
  w[1] += moved * 0.38;
  // No mountain scree on the island's hillsides (it reads as grey bands): grass and earth instead;
  // gravel stays on the stream banks.
  const scree = w[8] * sstep(36, 56, h) * sstep(0.1, 0.15, slope) * 0.9;
  w[8] -= scree;
  w[0] += scree * 0.7;
  w[1] += scree * 0.3;
}

/**
 * Paved ground on the island (road type code: 1 dirt, 2 stone; 0 none) — the shrine's round plaza,
 * the dojo's platform and the village's entrance plaza (no grass or trees through them).
 */
export function kyoshiPaved(x: number, z: number): number {
  const s = A(KI.shrine.u, KI.shrine.r);
  if (Math.hypot(x - s.x, z - s.z) < 12) return 2;
  const d = A(KI.dojo.u, KI.dojo.r);
  const yaw = yawOutward(KI.dojo.u) + Math.PI;
  const dx = x - d.x, dz = z - d.z;
  const f = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const r = -dx * Math.cos(yaw) + dz * Math.sin(yaw);
  if (Math.abs(r) < 27.5 && Math.abs(f) < 22.5) return 2;
  const g = A(KI.village.u, KI.village.gateR - 2);
  if (Math.hypot(x - g.x, z - g.z) < 13) return 1;
  return 0;
}

/** Biome weights on the island: lush temperate lowlands, pines on the upper slopes, browner outer flanks. */
export function kyoshiBiome(x: number, z: number, o: BiomeWeights): BiomeWeights {
  const p = kyoshiPolar(x, z, pol);
  const t = p.t;
  o.cold = 0;
  o.desert = 0;
  o.volcanic = 0;
  o.swamp = 0;
  o.tropical = 0;
  o.boreal = 0.78 * sstep(0.36, 0.56, t) * (1 - sstep(0.92, 1.05, t));
  o.dry = 0.3 * sstep(0.62, 0.95, t) + 0.12 * sstep(0.2, 0.45, noise.noise2(x / 240, z / 240));
  return o;
}

// ---------------------------------------------------------------------------
// Terrain features (appended to the Heightfield runtime lists)
// ---------------------------------------------------------------------------

const P = (list: Array<[number, number]>): P2[] => list.map(([u, r]) => A(u, r));
const V = KI.village;

export const KI_ROADS: RoadDef[] = [
  {
    // Bison meadow → village entrance → along the bay → Crescent Bridge → Koi Harbor → east headland.
    id: 'ki_coast_road',
    width: 5,
    surface: 'dirt',
    points: P([
      [0.215, 332], [0.25, 312], [0.3, 290], [0.345, 276], [V.u, 272], [0.43, 268], [0.48, 274], [0.53, 268],
      [0.575, 256], [0.62, 262], [KI.falls.u, 268], [0.71, 266], [0.75, 258], [0.8, 250], [0.85, 250], [0.89, 256],
      [0.935, 284], [0.972, 300],
    ]),
  },
  // The village street climbs straight from the statue at the entrance to the Meeting Hall.
  { id: 'ki_village_street', width: 6, surface: 'dirt', points: P([[V.u, 270], [V.u, 300], [V.u, 330], [V.u, 360], [V.u, V.hallR - 6]]) },
  { id: 'ki_dojo_path', width: 3.6, surface: 'dirt', points: P([[V.u, 336], [0.42, 350], [0.46, 366], [0.495, 378], [0.508, 382]]) },
  { id: 'ki_shrine_path', width: 3, surface: 'stone', points: P([[0.508, 382], [0.528, 364], [0.548, 340], [0.565, 320], [0.577, 310]]) },
  { id: 'ki_west_trail', width: 3, surface: 'dirt', points: P([[0.215, 332], [0.18, 338], [0.14, 332], [0.1, 320], [0.065, 306], [0.03, 294]]) },
];

export const KI_RIVERS: RiverDef[] = [
  {
    // Crystal Falls: down the notch in the ridge in a stair of falls, under the Crescent Bridge, into the bay.
    id: 'ki_crystal_stream',
    name: 'Crystal Falls',
    width: [2.6, 6.5],
    depth: 1.1,
    points: P([[0.668, 530], [0.666, 480], [0.664, 430], [0.663, 380], [0.663, 330], [KI.falls.u, 268], [0.666, 232], [0.667, 190]]),
  },
];

export const KI_PLATEAUS: PlateauDef[] = [
  { id: 'ki_meadow', ...A(KI.meadow.u, KI.meadow.r), r: 30, blend: 40 },
  { id: 'ki_village_gate', ...A(V.u, V.gateR - 2), r: 20, blend: 22 },
  { id: 'ki_hall', ...A(V.u, V.hallR), r: 18, blend: 24 },
  { id: 'ki_dojo', ...A(KI.dojo.u, KI.dojo.r), r: 34, blend: 30 },
  { id: 'ki_shrine', ...A(KI.shrine.u, KI.shrine.r), r: 15, blend: 64, height: KI.shrine.y },
  { id: 'ki_harbor_w', ...A(0.775, 246), r: 26, blend: 20, height: KI.harbor.y },
  { id: 'ki_harbor_m', ...A(0.82, 244), r: 28, blend: 20, height: KI.harbor.y },
  { id: 'ki_harbor_e', ...A(0.865, 246), r: 26, blend: 20, height: KI.harbor.y },
];

export const KI_LAKES: LakeDef[] = [];
