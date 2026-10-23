import { getRiverRuntime, type RiverRuntime } from '../../Heightfield';
import { defineSpots } from '../../Spots';

/**
 * Northern Water Tribe — city plan (world coordinates, north = -Z).
 *
 *   The city fills the nwt_city plateau (terrain y = 4) inside four ice walls:
 *   the great sea wall (north, z ≈ -1750) with the Great Water Gate on the
 *   Grand Canal and the Harbor Gate; ice cliffs to the west/east; the glacier
 *   cliffs to the south behind the Chief's palace with the Glacier Pass Gate
 *   to the northern road.
 *
 *   Everything inside sits on a raised street podium (L1 = 5.5) so the canals
 *   can run below street level (water WL = 4.75 on the terrain bed). The
 *   glacier_melt river crosses the west quarter diagonally in a deep gorge
 *   (its real water surface, sea level) lined with quay walls.
 *
 *   South of the Tribal Plaza two terraces rise toward the palace:
 *   T1 (L2 = 9.5) and T2 (L3 = 13.5), with grand stairs and cascades.
 */

export const G0 = 4.0; // plateau terrain
export const L1 = 5.5; // streets
export const WL = 4.75; // canal water level
export const BED = 4.06; // canal bed (visual) just above the terrain
export const L2 = 9.5; // first terrace
export const L3 = 13.5; // palace terrace
export const PODIUM_BOTTOM = 3.0;

/** Axis-aligned rectangle [x0, z0, x1, z1] (x0 < x1, z0 < z1). */
export type Rect = readonly [number, number, number, number];

export const inRect = (r: Rect, x: number, z: number, m = 0): boolean => x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m;

// --- Walls -------------------------------------------------------------------

export const WALL = {
  /** North sea wall z-span. */
  n0: -1756,
  n1: -1744,
  nTop: 30,
  /** South glacier cliffs z-span. */
  s0: -1420,
  s1: -1408,
  sTop: 34,
  /** West cliffs x-span. */
  w0: -382,
  w1: -370,
  wTop: 28,
  /** East cliffs x-span. */
  e0: -40,
  e1: -28,
  eTop: 28,
};

/** Inner city bounds (inside the walls). */
export const INNER: Rect = [WALL.w1, WALL.n1, WALL.e0, WALL.s0];

/** Openings in the north wall (x-spans). */
export const GATE_OPEN = { x0: -234, x1: -206, top: 25.5 };
export const HARBOR_OPEN = { x0: -86, x1: -64, top: 21 };
/** South wall opening: the Glacier Pass Gate. */
export const SOUTH_GATE = { x0: -182, x1: -158, top: 18 };
/** West wall opening where the gorge enters (z-span). */
export const RIVER_ARCH = { z0: -1470, z1: -1430, top: 21.5 };

// --- Water -------------------------------------------------------------------

/**
 * Where the two outer canals meet the open sea (north faces of the sea locks):
 * causeway jetties carry them across the beach and the frozen shelf.
 */
export const SEA_END = { grand: -1932, harbor: -1900 };

/** Canal water areas (holes in the podium). Water at WL. */
export const CANALS: Record<string, Rect> = {
  grand_out: [-228, SEA_END.grand, -212, -1756],
  grand_gate: [-228, -1756, -212, -1744],
  grand: [-228, -1744, -212, -1636],
  basin: [-242, -1636, -198, -1620],
  north_cross: [-330, -1712, -46, -1702],
  mid_cross: [-260, -1652, -104, -1644],
  east: [-150, -1702, -140, -1606],
  harbor: [-104, -1740, -46, -1644],
  harbor_gate: [-84, -1756, -66, -1740],
  harbor_out: [-84, SEA_END.harbor, -66, -1756],
};

/** Outer jetties (podium outside the north wall, either side of the canals). */
export const JETTIES: Rect[] = [
  [-240, SEA_END.grand, -228, -1756],
  [-212, SEA_END.grand, -200, -1756],
  [-96, SEA_END.harbor, -84, -1756],
  [-66, SEA_END.harbor, -54, -1756],
];

// --- Districts -----------------------------------------------------------------

export const PLAZA: Rect = [-262, -1620, -178, -1550];
export const PLAZA_C = { x: -220, z: -1590 };
export const T1: Rect = [-256, -1534, -184, -1420];
export const T2: Rect = [-248, -1500, -192, -1420];
export const PALACE = { x: -220, z: -1444, w: 38, d: 36 }; // footprint x[-239,-201], z[-1462,-1426]
export const PASSAGE: Rect = [-182, -1534, -158, -1420];
export const OASIS: Rect = [-150, -1478, -90, -1420];
export const OASIS_FLOOR = 4.45;
export const COURTYARD = { x: -338, z: -1556, r: 14 };
/** Sunken (wadeable) pool at the courtyard centre. */
export const COURT_POOL = { r: 3.2, floor: 5.05, level: 5.38 };
export const HEALER = { x: -128, z: -1590 };
export const YUGODA_TRAIN = { x: -160, z: -1578, r: 12 };
export const SPAWN = { x: -250, z: -1560 };

// --- The glacier gorge ---------------------------------------------------------

export interface Gorge {
  river: RiverRuntime;
  /** Arc-length range inside the city. */
  s0: number;
  s1: number;
}

let gorgeCache: Gorge | null | undefined;

/** The glacier_melt river where it crosses the city (null if missing). */
export function gorge(): Gorge | null {
  if (gorgeCache !== undefined) return gorgeCache;
  const river = getRiverRuntime().find((r) => r.id === 'glacier_melt');
  if (!river) return (gorgeCache = null);
  // First arc length west of the city where the water is at sea level.
  let s0 = 0;
  for (let s = 0; s < river.line.length; s += 1) {
    const p = river.line.pointAt(s);
    if (p.x > WALL.w0 - 30) {
      s0 = s;
      break;
    }
  }
  gorgeCache = { river, s0, s1: river.line.length };
  return gorgeCache;
}

/** Half width of the gorge channel (to the quay wall faces) at arc length s. */
export function gorgeHalf(g: Gorge, s: number): number {
  return g.river.width(Math.min(s, g.s1)) / 2 + 0.25;
}

const tmpS = new Float64Array(2);

/** Distance from (x,z) to the gorge centreline (Infinity beyond its ends) and the half width there. */
export function gorgeDist(x: number, z: number): { d: number; half: number; s: number } {
  const g = gorge();
  if (!g) return { d: Infinity, half: 0, s: 0 };
  const d = g.river.line.distance(x, z, tmpS);
  const s = tmpS[0];
  if (s < g.s0 - 5 || s > g.s1 + 0.5) return { d: Infinity, half: 0, s };
  return { d, half: gorgeHalf(g, s), s };
}

/** Water level of the river in the gorge. */
export function gorgeLevel(): number {
  const g = gorge();
  return g ? g.river.surface(g.s1 - 1) : 0.25;
}

// --- Named spots ------------------------------------------------------------------

const R = 'northern_water_tribe';

defineSpots({
  master_siku: { x: COURTYARD.x - 10, z: COURTYARD.z, y: L1, yaw: Math.PI / 2, r: 2, label: 'Master Siku', region: R },
  training_siku: { x: COURTYARD.x, z: COURTYARD.z, y: L1, r: 13, label: 'Waterbending Courtyard', region: R },
  master_yugoda: { x: HEALER.x - 7.5, z: HEALER.z, y: L1, yaw: -Math.PI / 2, r: 2, label: 'Healer Yugoda', region: R },
  training_yugoda: { x: YUGODA_TRAIN.x, z: YUGODA_TRAIN.z, y: L1, r: YUGODA_TRAIN.r, label: 'Healing Hut Yard', region: R },
  giver_nwt_elder: { x: -232, z: -1572, y: L1, yaw: Math.PI, r: 2, label: 'Elder Kanna', region: R },
  giver_nwt_chief: { x: -220, z: -1468, y: L3, yaw: Math.PI, r: 3, label: "Chief's Palace", region: R },
  merchant_nwt_1: { x: -254, z: -1604, y: L1, yaw: Math.PI / 2, r: 2, label: 'Fishmonger', region: R },
  merchant_nwt_2: { x: -186, z: -1604, y: L1, yaw: -Math.PI / 2, r: 2, label: 'Furrier', region: R },
  merchant_nwt_3: { x: -80, z: -1640.5, y: L1, yaw: Math.PI, r: 2, label: 'Harbor Chandler', region: R },
  merchant_nwt_4: { x: -186, z: -1566, y: L1, yaw: -Math.PI / 2, r: 2, label: 'Carver', region: R },
  dock_nwt_harbor: { x: -60, z: -1680, y: L1, yaw: -Math.PI / 2, r: 5, label: 'Harbor Canals', region: R },
  dock_nwt_grand_canal: { x: -234, z: -1626, y: L1, yaw: 0, r: 3, label: 'Moon Basin Landing', region: R },
  dock_nwt_outer: { x: -234, z: -1800, y: L1, yaw: Math.PI, r: 3, label: 'Outer Jetty', region: R },
  dock_nwt_sea_gate: { x: -220, z: SEA_END.grand - 4.5, y: L1, yaw: Math.PI, r: 6, label: 'Sea Gate Lock', region: R },
  dock_nwt_harbor_mouth: { x: -75, z: SEA_END.harbor - 4.5, y: L1, yaw: Math.PI, r: 6, label: 'Harbor Mouth', region: R },
  // The two causeways across the beach (their radius also keeps trees off them).
  bridge_nwt_sea_causeway: { x: -220, z: -1872, y: L1, yaw: Math.PI, r: 40, label: 'Sea Causeway', region: R },
  bridge_nwt_harbor_causeway: { x: -75, z: -1858, y: L1, yaw: Math.PI, r: 34, label: 'Harbor Causeway', region: R },
  bridge_nwt_gate: { x: -220, z: -1735, y: L1, r: 6, label: 'Great Ice Gate', region: R },
  shrine_spirit_oasis: { x: -120, z: -1446, y: OASIS_FLOOR, r: 4, label: 'Spirit Oasis', region: R },
  viewpoint_nwt_wall: { x: -220, z: -1750, y: WALL.nTop, yaw: 0, r: 4, label: 'Sea Wall Lookout', region: R },
  viewpoint_nwt_palace: { x: -220, z: -1480, y: L3, yaw: Math.PI, r: 5, label: 'Palace Forecourt', region: R },
  viewpoint_nwt_glacier: { x: -520, z: -1352, r: 4, label: 'Glacier Caves', region: R },
  habitat_otter_penguin_1: { x: -150, z: -1820, r: 22, label: 'Outer Shore', region: R },
  shrine_ice_caves: { x: -520, z: -1336, r: 3, label: 'Glacier Caves Shrine', region: R },
});
