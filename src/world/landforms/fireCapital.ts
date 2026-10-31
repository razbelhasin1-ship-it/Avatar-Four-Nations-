import { SimplexNoise } from '../../core/Noise';

/**
 * The Fire Nation capital's landform and master layout (pure: no three.js). Shared by the
 * terrain (Heightfield) and the capital region builders so the ground and the buildings always
 * agree. Tweak the constants here; everything else derives from them.
 *
 * Frame: V is the volcano / palace centre. The main axis runs south (+Z) from V to the sea gate.
 * `s` = distance south of V along the axis, `t` = east offset from the axis (x − V.x).
 * Polar: r = distance from V, phi = atan2(dz, dx) in degrees (0 east, 90 south, 180 west, −90 north).
 *
 *   s 780        sea wall + Gates of Azulon
 *   s 655–780    First Lord's Harbor: a stone-walled funnel basin (34 → 120 m half-width)
 *   s 548–655    Royal Plaza in a valley between cliffs (floor 3.2); main tower across its head
 *   s 290–548    Harbor City (radial, rising to the volcano's foot)
 *   s 110–290    Sozin's road: switchbacks on the volcano's south face
 *   s 0–110      crater lip (142, jagged peaks), floor 136, palace hill 147, Hari Bulkan
 */
export const FNC = {
  V: { x: -1300, z: 990 },
  seed: 0xf17e,
  // Crater and palace.
  ringR: 38,
  hillTopR: 28,
  hillFootR: 44,
  hillY: 147,
  floorR: 103,
  lipR: 111,
  floorY: 136,
  lipY: 142,
  // Volcano foot (where Harbor City begins): south / elsewhere.
  footR: { s: 290, o: 252 },
  footY: { s: 48, e: 36, n: 30, w: 44 },
  // Harbor City.
  city: { phi0: -58, phi1: 188, outerR: 470, gradeS: 0.12, gradeE: 0.26 },
  // Royal Plaza valley (s0 = foot of the main tower's passage wall).
  plaza: { s0: 528, s1: 655, valleyHalf: 34, forumHalf: 16, y: 3.2, towerS: 544, passHalf: 2.6, passTopS: 508, passFootS: 556, pool: { in: 7.6, out: 11.6, s0: 586, s1: 634, depth: 1.3 } },
  // Harbour: quay strip beside the water, basin funnel, sea wall.
  harbor: { s0: 655, s1: 780, half0: 34, half1: 122, quayY: 2.6, quayW: 16, bedY: -9, headW: 62, headY: 13 },
  seaWallS: 780,
  // Sozin's road: hairpins alternate east/west of the axis.
  road: { legs: 8, half: 2.6, lateral: 46, s0: 292, s1: 122, y0: 47, y1: 142, gateS: 114 },
  // Sun Warrior Ruins (outside the capital): the old volcano's flank is kept around them.
  ruins: { a: { x: -1560, z: 940 }, b: { x: -1512, z: 988 }, keep: 46, blend: 150 },
} as const;

const DEG = Math.PI / 180;
const noise = new SimplexNoise(0x51ed);
const noiseB = new SimplexNoise(0x77aa);

export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Polar coordinates around V. */
export function polarOf(x: number, z: number): { r: number; phi: number } {
  const dx = x - FNC.V.x, dz = z - FNC.V.z;
  return { r: Math.hypot(dx, dz), phi: Math.atan2(dz, dx) / DEG };
}
/** World point at polar (phi deg, r) around V. */
export function atPolar(phi: number, r: number): { x: number; z: number } {
  return { x: FNC.V.x + Math.cos(phi * DEG) * r, z: FNC.V.z + Math.sin(phi * DEG) * r };
}
/** World point at axis coordinates (t east of the axis, s south of V). */
export function atAxis(t: number, s: number): { x: number; z: number } {
  return { x: FNC.V.x + t, z: FNC.V.z + s };
}

/** Volcano foot radius / height by bearing (wider and higher on the south, toward the city's heart). */
export function footR(phi: number): number {
  const south = Math.max(0, Math.sin(phi * DEG));
  return mix(FNC.footR.o, FNC.footR.s, south * south);
}
export function footY(phi: number): number {
  const c = Math.cos(phi * DEG), s = Math.sin(phi * DEG);
  // Weighted blend of the four quarter heights.
  const wE = Math.max(0, c) ** 2, wW = Math.max(0, -c) ** 2, wS = Math.max(0, s) ** 2, wN = Math.max(0, -s) ** 2;
  return (FNC.footY.e * wE + FNC.footY.w * wW + FNC.footY.s * wS + FNC.footY.n * wN) / (wE + wW + wS + wN);
}

/** Harbour basin half-width at axis distance s (funnel widening toward the sea wall). */
export function harborHalf(s: number): number {
  const h = FNC.harbor;
  return mix(h.half0, h.half1, Math.min(1, Math.max(0, (s - h.s0) / (h.s1 - h.s0))));
}

// ---------------------------------------------------------------------------
// Sozin's road (hairpins H0..H8 on the south face, then the gate)
// ---------------------------------------------------------------------------

export interface RoadPoint {
  t: number;
  s: number;
  y: number;
}
let roadCache: RoadPoint[] | null = null;
/** Road polyline in axis coordinates: Royal Way end → hairpins → crater gate. */
export function roadPath(): RoadPoint[] {
  if (roadCache) return roadCache;
  const R = FNC.road;
  const pts: RoadPoint[] = [{ t: 0, s: R.s0 + 10, y: R.y0 - 0.6 }];
  // Hairpins H0..H(legs-1), then one last rising leg that turns straight north into the gate.
  for (let k = 0; k < R.legs; k++) {
    const s = R.s0 - ((R.s0 - R.s1) * k) / R.legs;
    const y = R.y0 + ((R.y1 - R.y0) * k) / R.legs;
    pts.push({ t: (k % 2 === 0 ? 1 : -1) * R.lateral, s, y });
  }
  pts.push({ t: 0, s: R.gateS + 13, y: R.y1 - 1.6 });
  pts.push({ t: 0, s: R.gateS, y: R.y1 });
  roadCache = pts;
  return pts;
}

/** Distance (in the t/s plane) to the road polyline, with the road height at the closest point. */
export function roadNear(t: number, s: number): { d: number; y: number; leg: number } {
  const pts = roadPath();
  let best = 1e9, by = 0, bl = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ex = b.t - a.t, ez = b.s - a.s;
    const L2 = ex * ex + ez * ez;
    let u = ((t - a.t) * ex + (s - a.s) * ez) / L2;
    u = Math.min(1, Math.max(0, u));
    const px = a.t + ex * u, pz = a.s + ez * u;
    const d = Math.hypot(t - px, s - pz);
    if (d < best) {
      best = d;
      by = a.y + (b.y - a.y) * u;
      bl = i;
    }
  }
  return { d: best, y: by, leg: bl };
}

// ---------------------------------------------------------------------------
// Crater lip peaks
// ---------------------------------------------------------------------------

/** Jagged dark peaks ringing the crater (bearing, extra height, angular half-width). None at the gate. */
export const PEAKS: ReadonlyArray<{ phi: number; h: number; w: number; r: number }> = [
  { phi: -168, h: 58, w: 7, r: 118 },
  { phi: -146, h: 44, w: 6, r: 114 },
  { phi: -128, h: 66, w: 8, r: 120 },
  { phi: -108, h: 38, w: 6, r: 115 },
  { phi: -88, h: 72, w: 8, r: 121 },
  { phi: -66, h: 46, w: 6, r: 116 },
  { phi: -46, h: 60, w: 7, r: 119 },
  { phi: -26, h: 40, w: 6, r: 114 },
  { phi: -6, h: 74, w: 7, r: 120 }, // the waterfall peak
  { phi: 16, h: 42, w: 6, r: 116 },
  { phi: 36, h: 56, w: 7, r: 119 },
  { phi: 56, h: 34, w: 6, r: 114 },
  { phi: 70, h: 26, w: 5, r: 116 },
  { phi: 110, h: 28, w: 5, r: 116 },
  { phi: 126, h: 40, w: 6, r: 115 },
  { phi: 146, h: 60, w: 7, r: 119 },
  { phi: 166, h: 36, w: 6, r: 114 },
  { phi: 184, h: 52, w: 7, r: 118 },
];

function angDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function peaksAt(r: number, phi: number): number {
  let add = 0;
  for (const p of PEAKS) {
    const da = Math.abs(angDiff(phi, p.phi));
    if (da > p.w * 2.2) continue;
    const dr = Math.abs(r - p.r);
    const rw = 9 + p.h * 0.18;
    if (dr > rw * 1.6) continue;
    // Sharp pyramidal spike with a ragged crown.
    const fa = Math.max(0, 1 - da / (p.w * 2.2));
    const fr = Math.max(0, 1 - dr / (rw * 1.6));
    const sharp = Math.pow(fa * fr, 1.7);
    add = Math.max(add, p.h * sharp * (0.9 + 0.1 * noise.noise2(r / 7, phi / 3)));
  }
  return add;
}

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

/** Volcano + crater height (r < foot); null outside. */
function coneHeight(r: number, phi: number, t: number, s: number): number {
  const fr = footR(phi), fy = footY(phi);
  const F = FNC;
  let h: number;
  if (r <= F.floorR) {
    h = F.floorY;
    // The palace's scorched hill.
    if (r < F.hillFootR) h = mix(F.floorY, F.hillY, sstep(F.hillFootR, F.hillTopR, r));
  } else if (r <= F.lipR) {
    h = mix(F.floorY, F.lipY, sstep(F.floorR, F.lipR, r));
  } else {
    const u = Math.min(1, (r - F.lipR) / (fr - F.lipR));
    h = fy + (F.lipY - fy) * Math.pow(1 - u, 1.35);
    // Lava gullies on the flanks (not on the road face).
    const roadFace = sstep(30, 14, Math.abs(angDiff(phi, 90)));
    const gully = Math.pow(Math.abs(noise.noise2(Math.cos(phi * DEG) * 7 + 2.3, Math.sin(phi * DEG) * 7 - 1.1 + r / 600)), 0.6);
    h -= (1 - gully) * 7 * sstep(0, 0.2, u) * sstep(1, 0.55, u) * (1 - roadFace);
    h += 1.6 * noiseB.noise2(r / 14, phi / 4) * sstep(0, 0.2, u) * (1 - roadFace);
  }
  // Peaks on the lip (none at the gate).
  h += peaksAt(r, phi);
  // Road benches on the south face.
  if (s > FNC.road.gateS - 10 && s < FNC.road.s0 + 24 && Math.abs(t) < FNC.road.lateral + 16) {
    const rn = roadNear(t, s);
    const half = FNC.road.half + 1.2;
    if (rn.d < half + 2.5) {
      const w = 1 - sstep(half, half + 2.5, rn.d);
      h = mix(h, rn.y - 0.02, w);
    }
  }
  return h;
}

/** Harbor City ground (outside the volcano foot). */
function cityHeight(x: number, z: number, r: number, phi: number, t: number, s: number): number {
  const C = FNC.city;
  const fr = footR(phi), fy = footY(phi);
  const east = Math.max(0, Math.cos(phi * DEG)) ** 4;
  const grade = mix(C.gradeS, C.gradeE, east);
  let h = Math.max(6, fy - (r - fr) * grade);
  // Gentle undulation (none on the Royal Way).
  const way = sstep(18, 6, Math.abs(t)) * sstep(FNC.plaza.s0 + 20, FNC.road.s0, s);
  h += 2.2 * noise.noise2(x / 130, z / 130) * (1 - way);
  // North hill district (NE) and the two south hills flanking the plaza.
  const nh = atPolar(-30, 310);
  h += 20 * Math.exp(-((x - nh.x) ** 2 + (z - nh.z) ** 2) / (2 * 58 * 58));
  for (const side of [-1, 1]) {
    const dx = t - side * 92, ds = s - 610;
    h += 13 * Math.exp(-(dx * dx + ds * ds) / (2 * 46 * 46));
  }
  return h;
}

/**
 * Plaza valley + harbour region (designed ground: plaza floor, valley sides, quay aprons, the basin,
 * headlands and the sea beyond them) and its weight (1 inside, soft edges).
 */
function coastHeight(t: number, s: number, around: number): { h: number; w: number } {
  const P = FNC.plaza, H = FNC.harbor;
  const at = Math.abs(t);
  if (s < P.s0 - 40 || s > H.s1 + 90) return { h: around, w: 0 };
  // Lateral reach of the designed ground at this s.
  const half = harborHalf(s);
  const rag = 14 * noise.noise2(s / 46, t > 0 ? 3.7 : -5.2) + 6 * noiseB.noise2(s / 13, t / 13);
  const reach = (s < H.s0 ? P.valleyHalf + 70 + 26 * sstep(P.s0, H.s0, s) : half + H.quayW + H.headW) + rag;
  const w = sstep(P.s0 - 40, P.s0 - 16, s) * sstep(reach + 52, reach + 8, at) * sstep(H.s1 + 90, H.s1 + 60, s);
  if (w <= 0) return { h: around, w: 0 };
  // Hills either side of the plaza / harbour head (Harbor City climbs them).
  const hill = Math.max(around, H.headY + 6 * sstep(H.s0 + 40, P.s0, s));
  let h = hill;
  if (s <= H.s0 + 4) {
    // Plaza valley: flat floor, steep sides; the valley head is the main tower's wall.
    const side = sstep(P.valleyHalf, P.valleyHalf + 7, at);
    const head = sstep(P.s0 + 1, P.s0 - 5, s);
    h = mix(P.y, hill, Math.max(side, head));
  }
  // The two long pools down the forum.
  if (s > P.pool.s0 && s < P.pool.s1 && at > P.pool.in && at < P.pool.out) h = P.y - P.pool.depth;
  // The passage behind the main tower: a stair cut climbing from the plaza to the Royal Way.
  if (at < P.passHalf + 0.6 && s > P.passTopS - 2 && s < P.passFootS) {
    const u = Math.min(1, Math.max(0, (P.passFootS - s) / (P.passFootS - P.passTopS)));
    h = Math.min(h, mix(P.y, around, u));
  }
  if (s > H.s0 - 2) {
    const quay = half + H.quayW;
    const head = quay + H.headW + rag;
    // The quay aprons are built slabs over deep water (the sea's foam reads a coarse height
    // texture: the bed must stay deep right up to the walls), then the harbour walls rise.
    let land: number;
    if (at < quay) land = H.bedY;
    else land = mix(H.bedY, hill, sstep(quay, quay + 3, at));
    // Beyond the headlands: the island's own shore (land or sea); off the sea wall: open water for the ships.
    land = mix(land, around, sstep(head, head + 24, at));
    const approach = sstep(H.s1 + 12, H.s1 + 34, s) * sstep(head + 40, head, at);
    land = mix(land, Math.min(land, -8), approach);
    h = mix(h, land, sstep(H.s0 + 0.4, H.s0 + 1.6, s));
  }
  return { h, w };
}

/** Old volcano (kept around the Sun Warrior Ruins so they sit on the flank they were built for). */
function oldVolcano(x: number, z: number, h: number): number {
  const O = { x: -1330, z: 1150, rimR: 235, outerR: 470, rimH: 150 };
  const dx = x - O.x, dz = z - O.z;
  const d = Math.hypot(dx, dz);
  if (d >= O.outerR) return h;
  const ang = Math.atan2(dz, dx);
  const rimNoise = 1 + 0.18 * noise.noise2(Math.cos(ang) * 3, Math.sin(ang) * 3);
  let cone: number;
  if (d > O.rimR) {
    const tt = 1 - (d - O.rimR) / (O.outerR - O.rimR);
    cone = O.rimH * rimNoise * Math.pow(Math.max(0, tt), 1.6);
  } else {
    cone = mix(40, O.rimH * rimNoise, Math.pow(d / O.rimR, 3.2));
  }
  return Math.max(h, cone + 3 * noiseB.noise2(x / 25, z / 25));
}

function ruinsKeep(x: number, z: number): number {
  const R = FNC.ruins;
  const ex = R.b.x - R.a.x, ez = R.b.z - R.a.z;
  let u = ((x - R.a.x) * ex + (z - R.a.z) * ez) / (ex * ex + ez * ez);
  u = Math.min(1, Math.max(0, u));
  const ang = Math.atan2(z - R.a.z, x - R.a.x);
  const d = Math.hypot(x - (R.a.x + ex * u), z - (R.a.z + ez * u)) * (1 + 0.28 * noise.noise2(Math.cos(ang) * 1.6 + 7.3, Math.sin(ang) * 1.6 - 3.1));
  const r = Math.hypot(x - FNC.V.x, z - FNC.V.z);
  return (1 - sstep(R.keep, R.keep + R.blend, d)) * sstep(FNC.lipR + 24, FNC.lipR + 150, r);
}

/** 0..1 inside Harbor City's angular sector (phi0 → phi1 clockwise through the south; wrap-safe). */
export function sectorWeight(phi: number): number {
  const C = FNC.city;
  let a = phi;
  while (a < C.phi0 - 60) a += 360;
  while (a >= C.phi0 + 300) a -= 360;
  return sstep(C.phi0 - 14, C.phi0, a) * sstep(C.phi1 + 14, C.phi1, a);
}

/** Bounding radius of the capital's influence around V (cheap early-out). */
export const FNC_INFLUENCE = 880;

/**
 * Final natural height inside the capital's influence (replaces the old volcano). `natural` is the
 * island's base height (land/sea field + ranges) at (x, z).
 */
export function fireCapitalHeight(x: number, z: number, natural: number): number {
  const dx = x - FNC.V.x, dz = z - FNC.V.z;
  if (dx * dx + dz * dz > FNC_INFLUENCE * FNC_INFLUENCE) return oldVolcano(x, z, natural);
  const r = Math.hypot(dx, dz);
  const phi = Math.atan2(dz, dx) / DEG;
  const t = dx, s = dz;
  const fr = footR(phi);
  let h: number;
  if (r < fr) {
    h = coneHeight(r, phi, t, s);
  } else {
    // City sector weight (soft angular edges) and outer radius fade.
    const C = FNC.city;
    const inSector = sectorWeight(phi);
    const outer = sstep(C.outerR + 90, C.outerR, r);
    const city = cityHeight(x, z, r, phi, t, s);
    // Outside the city: the volcano's skirt, fading into the island (never raising the deep sea).
    const cont = footY(phi) * Math.pow(Math.max(0, 1 - (r - fr) / 170), 1.5);
    const skirt = natural + Math.max(0, cont - natural) * sstep(-10, 0, natural);
    // The city replaces the island's ground only where the island is land (the coast stays the coast).
    const w = inSector * outer * sstep(-4, 3, natural);
    h = mix(skirt, city, w);
    const coast = coastHeight(t, s, h);
    if (coast.w > 0) h = mix(h, coast.h, coast.w);
  }
  // The ruins keep the old volcano's flank.
  const keep = ruinsKeep(x, z);
  if (keep > 0) h = mix(h, oldVolcano(x, z, natural), keep);
  return h;
}

/** Green ground inside the capital: Zoryu Park (west) and the palace garden villa (crater, south-west). */
export function capitalGreen(x: number, z: number): boolean {
  const { r, phi } = polarOf(x, z);
  if (phi > 134 && phi < 170 && r > footR(phi) + 26 && r < footR(phi) + 196) return true;
  const g = atPolar(131, 73);
  return Math.hypot(x - g.x, z - g.z) < 21;
}

/** Paved ground (streets, plaza, quays, crater floor): stone underfoot, no grass. */
export function capitalPaved(x: number, z: number, h: number): boolean {
  if (h <= 1.4 || !inCapitalFootprint(x, z) || capitalGreen(x, z)) return false;
  // Inside the palace ring wall: the barren, scorched rock of the palace hill.
  return Math.hypot(x - FNC.V.x, z - FNC.V.z) > FNC.ringR + 1;
}

/** True where the capital forces the ground (vegetation is kept off streets, plaza, crater floor). */
export function inCapitalFootprint(x: number, z: number): boolean {
  const { r, phi } = polarOf(x, z);
  if (r < FNC.lipR) return true;
  if (r < footR(phi)) return false; // volcano flanks keep their scrub
  const C = FNC.city;
  if (sectorWeight(phi) > 0.5 && r < C.outerR + 30) return true;
  const s = z - FNC.V.z, t = Math.abs(x - FNC.V.x);
  return s > FNC.plaza.s0 - 10 && s < FNC.harbor.s1 + 10 && t < harborHalf(s) + FNC.harbor.quayW + FNC.harbor.headW;
}
