import { SimplexNoise } from '../../core/Noise';

/**
 * Wolf Cove, the Southern Water Tribe's main village (as it stood ~40 years into the war, before
 * the raids), and the coast around it: the landform and master layout (pure: no three.js). Shared
 * by the terrain (Heightfield) and the region builders (regions/water/swt/) so the ground and the
 * village always agree. Tweak the constants here; everything else derives from them.
 *
 * North is −Z. The village sits on the polar coast with the sea to the north:
 *   - the cove: a bay carved into the coast north of the village, opening east into the sea; its
 *     shallow margins freeze into shore ice (Heightfield.polarSeaFactor), open black water beyond
 *   - the village: a circular terrace 8 m above the tundra inside a ring wall whose outer face is a
 *     10 m cliff of ice slabs (walkable top 2.5 m wide, 2 m above the village floor), a gate in the
 *     north wall with a long packed-snow ramp down to the plain and the shore
 *   - the sled hill west of the village, its run sloping north to the shipwreck at the cove's west tip
 *   - the open tundra to the south, down to the polar sea's ice shelf
 */
export const WC = {
  /** Village centre (the Great Igloo). */
  x: 220,
  z: 1660,
  /** Ring wall: outer face radius (m) and walkable top width. */
  R: 74,
  wallT: 2.5,
  /** Heights: the tundra plain, the village floor (terrace) and the wall top. */
  plain: 3,
  floor: 11,
  wallTop: 13,
  /** North gate: half-width of the opening; the ramp down to the plain (length, half-width). */
  gateHalf: 4.5,
  rampLen: 50,
  rampHalf: 4.5,
  /** The cove (ellipse) north of the village; it runs east into the sea. */
  cove: { x: 345, z: 1392, rx: 252, rz: 94, depth: 7 },
  /** Sled hill west of the village: centre, radius, height above the plain. */
  hill: { x: 85, z: 1585, r: 52, h: 16 },
  /** Where the tundra plain is levelled (ellipse) and the fade back to the natural land (m). */
  zone: { x: 225, z: 1650, rx: 330, rz: 270, fade: 90 },
} as const;

/** Gate opening (world): centre of the gap in the north wall. */
export const WC_GATE = { x: WC.x, z: WC.z - WC.R } as const;
/** Foot of the gate ramp on the plain. */
export const WC_RAMP_FOOT = { x: WC.x, z: WC.z - WC.R - WC.rampLen } as const;
/** The shipwreck: a Fire Navy ship grounded in the shore ice at the cove's west tip. */
export const WC_WRECK = { x: 132, z: 1408, yaw: 0.55 } as const;
/** The sled run: from the hill's shoulder north down to the shipwreck (polyline, world). */
export const WC_SLED_RUN: ReadonlyArray<{ x: number; z: number }> = [
  { x: 92, z: 1566 },
  { x: 100, z: 1530 },
  { x: 108, z: 1492 },
  { x: 114, z: 1458 },
  { x: 120, z: 1432 },
];
/** Canoe and kayak landing on the beach north of the gate. */
export const WC_LANDING = { x: 232, z: 1480 } as const;

const noise = new SimplexNoise(9127);
const noiseB = new SimplexNoise(4417);

export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Distance from the village centre. */
export function wcR(x: number, z: number): number {
  return Math.hypot(x - WC.x, z - WC.z);
}

/** Normalised distance to the cove's shoreline (1 on the shore, < 1 in the water); a little ragged. */
export function coveE(x: number, z: number): number {
  const c = WC.cove;
  const ex = (x - c.x) / c.rx, ez = (z - c.z) / c.rz;
  return Math.sqrt(ex * ex + ez * ez) + 0.035 * noise.noise2(x / 38, z / 38) + 0.012 * noiseB.noise2(x / 11, z / 11);
}

/** 0..1 how much of the cove's water the point is in (for the polar sea ice: its shallow margins freeze). */
export function coveWater(x: number, z: number): number {
  return 1 - sstep(0.98, 1.08, coveE(x, z));
}

/** Gentle swells of the tundra plain. */
export function plainHeight(x: number, z: number): number {
  return WC.plain + 0.55 * noise.noise2(x / 72, z / 72) + 0.18 * noiseB.noise2(x / 21, z / 21);
}

/** Ramp surface height at (x, z) and how much it covers the point (side embankments fade). */
function ramp(x: number, z: number): { h: number; w: number } {
  const t = (WC_GATE.z - z) / WC.rampLen; // 0 at the gate, 1 at the foot
  if (t < -0.06 || t > 1.25) return { h: 0, w: 0 };
  const lat = Math.abs(x - WC.x);
  const foot = plainHeight(WC_RAMP_FOOT.x, WC_RAMP_FOOT.z);
  const tt = Math.max(0, Math.min(1, t));
  const h = mix(WC.floor, foot, tt);
  // Full width on the deck; packed-snow embankments slope away on both sides (steeper near the top).
  const side = 3 + 7 * tt;
  const w = (1 - sstep(WC.rampHalf, WC.rampHalf + side, lat)) * (1 - sstep(1.0, 1.25, t));
  return { h, w };
}

/** True inside the gate's opening through the wall (the floor runs out onto the ramp). */
export function inGateGap(x: number, z: number): boolean {
  return Math.abs(x - WC.x) < WC.gateHalf + 0.4 && z < WC.z - WC.R + 4 && z > WC.z - WC.R - 2.5;
}

/** Terrain height with Wolf Cove applied (called by Heightfield after the natural relief). */
export function wolfCoveHeight(x: number, z: number, natural: number): number {
  const Z = WC.zone;
  const zx = (x - Z.x) / Z.rx, zz = (z - Z.z) / Z.rz;
  const zd = Math.sqrt(zx * zx + zz * zz);
  const coveOut = 1.35;
  if (zd > 1 + Z.fade / Math.min(Z.rx, Z.rz) && coveE(x, z) > coveOut) return natural;
  let h = natural;
  // The tundra plain, levelled over the zone (fading back into the land beyond; the deep sea stays sea).
  const zoneW = 1 - sstep(1, 1 + Z.fade / Math.min(Z.rx, Z.rz), zd);
  if (zoneW > 0) h = mix(h, plainHeight(x, z), zoneW * sstep(-6, -1, natural));
  // The sled hill (a smooth dome) with the run's groove cut down its north side.
  {
    const H = WC.hill;
    const d = Math.hypot(x - H.x, z - H.z);
    if (d < H.r * 1.6) {
      const k = Math.max(0, 1 - (d / (H.r * 1.6)) ** 2);
      const dome = H.h * k * k * (0.9 + 0.1 * noise.noise2(x / 30, z / 30));
      h = Math.max(h, plainHeight(x, z) + dome);
    }
  }
  // The cove: a beach of gravel shelving into shallow shore ice, then the open black water.
  {
    const e = coveE(x, z);
    if (e < coveOut) {
      const rz = WC.cove.rz;
      if (e < 1) {
        const d = (1 - e) * rz; // metres in from the shoreline (roughly)
        const bed = d < 16 ? 0.55 - d * 0.14 : -1.7 - Math.min(WC.cove.depth - 1.7, (d - 16) * 0.075);
        h = Math.min(h, bed);
      } else {
        const d = (e - 1) * rz; // metres inland
        h = Math.min(h, 0.55 + d * 0.12 + 0.15 * noiseB.noise2(x / 6, z / 6) * sstep(0, 4, d));
      }
    }
  }
  // The village terrace: flat floor inside the wall; it falls to the plain inside the wall's
  // thickness (hidden by the ice slabs), except through the gate opening onto the ramp.
  const r = wcR(x, z);
  if (r < WC.R + 1) {
    const inner = WC.R - WC.wallT + 0.6;
    const drop = sstep(inner, WC.R - 0.25, r);
    const keep = inGateGap(x, z) ? 0 : drop;
    h = mix(WC.floor, Math.min(h, WC.floor), keep);
  }
  // The gate ramp (packed snow on an embankment of drifts).
  const rp = ramp(x, z);
  if (rp.w > 0 && r >= WC.R - 3) h = mix(h, rp.h, rp.w);
  return h;
}

/** Ground that should read as packed snow (the ramp, the beach path): no drifts or rocks. */
export function wolfCovePacked(x: number, z: number): boolean {
  if (wcR(x, z) < WC.R) return true;
  const t = (WC_GATE.z - z) / WC.rampLen;
  return t > -0.05 && t < 1.05 && Math.abs(x - WC.x) < WC.rampHalf + 1;
}

/** True where Wolf Cove shapes the ground: the levelled tundra round the village, the cove's shores
 *  (trees, bushes and rocks keep off it: the South Pole is a bare frozen plain). */
export function inWolfCove(x: number, z: number): boolean {
  const Z = WC.zone;
  const zx = (x - Z.x) / Z.rx, zz = (z - Z.z) / Z.rz;
  return zx * zx + zz * zz < 1.05 || coveE(x, z) < 1.25;
}
