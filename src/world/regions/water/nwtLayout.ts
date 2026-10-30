import { defineSpots } from '../../Spots';

/**
 * Agna Qel'a — the Northern Water Tribe capital (world coordinates, north = −Z = the sea).
 *
 *   A cove inside colossal ice cliffs (~100 m: strata, flutes, waterfalls),
 *   five to eight times taller than anything built in it. The harbor mouth in
 *   the north is closed by a low gate wall with the tribe's emblem, between
 *   the cliffs' jaw tips that carry watchtowers. Inside, from the sea:
 *
 *     harbor basin and quays (L1) → the twin canals flanking the central
 *     promenade (L1) → grand stairs → ceremony plaza and its waterfall
 *     fountain (L2) → upper city and avenue (L3) → palace plaza and the
 *     stepped palace against the back cliff (L4). The Spirit Oasis hides in
 *     a notch of the back cliff behind the palace, reached by a crevasse
 *     passage; the Glacier Pass cuts through the back cliff to the road south.
 *
 *   Both flanks are dense districts — alleys a few paces wide, stairs, small
 *   courtyards, passages under buildings, branch canals with footbridges —
 *   generated from the seeded specs below by agnaPlan.ts.
 */

// --- Tunables -------------------------------------------------------------------------

export const TUNE = {
  /** District generator seed. */
  seed: 4207,
  /** Main lanes (≈ three player widths). */
  lane: 3.8,
  /** Narrow alleys (two to three player widths). */
  alley: [2.4, 3.2] as [number, number],
  /** Blocks larger than this are split by another alley (m). */
  blockMax: 22,
  /** Building frontage (m). */
  lot: [5.5, 9.5] as [number, number],
  /** Storeys per building and storey height (m). */
  floors: [2, 4] as [number, number],
  storey: 3.3,
  /** Chance an alley stops short (dead end), a block becomes a small courtyard, an alley passes under a building. */
  deadEnds: 0.3,
  courts: 0.12,
  arches: 0.25,
  /** Lamp spacing along canals and lanes (m). */
  lampSpacing: 12,
  /** Height of the cliff tops (y). */
  cliffTop: 104,
  /** Horizontal run of a 4 m terrace stair flight (m). */
  stairRun: 16,
};

// --- Frame and levels -----------------------------------------------------------------

/** City axis (x): gate, promenade, plaza, avenue and palace line up on it. */
export const AX = -220;
export const G0 = 4.0; // plateau terrain
export const L1 = 5.5; // harbor, promenade, lower city
export const WL = 4.75; // canal water level
export const BED = 4.06; // canal bed (visual) just above the terrain
export const L2 = 9.5; // ceremony plaza, middle districts
export const L3 = 13.5; // upper city
export const L4 = 17.5; // palace plaza, noble quarters, oasis
export const PODIUM_BOTTOM = 3.0;
/** Palace platform (above the palace plaza; waterfalls pour from its front). */
export const PLATFORM = L4 + 6;

/** Axis-aligned rectangle [x0, z0, x1, z1] (x0 < x1, z0 < z1). */
export type Rect = readonly [number, number, number, number];

export const inRect = (r: Rect, x: number, z: number, m = 0): boolean => x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m;

// --- The cove ---------------------------------------------------------------------------

/** Inner face of the gate wall; its outer face; the cliffs' jaw tips in the sea. */
export const GATE_Z = -1898;
export const GATE_OUT = -1910;
export const JAW_TIP = -1936;
/** Height of the gate's wall walk. */
export const GATE_TOP = 22;
export const MOUTH = { x0: -264, x1: -176 };
export const CLIFF = { w: -380, e: -60, s: -1408 };

/** Spirit Oasis: a notch of the back cliff behind the palace, and the crevasse passage into it. */
export const OASIS: Rect = [-262, -1392, -184, -1344];
export const OASIS_SLOT: Rect = [-262, -1408, -257, -1392];
/** The koi pond in the oasis. */
export const OASIS_POND = { x: AX, z: -1376, r: 4.6 };
/** Glacier Pass: a canyon through the back cliff to the northern road. */
export const PASS: Rect = [-118, -1408, -104, -1336];

/**
 * The cove outline (inner faces of the cliffs, the gate wall as the closing
 * edge). Walking along it the cliffs are on the right-hand side.
 */
export const COVE: Array<[number, number]> = [
  [MOUTH.x0, GATE_Z],
  [-264, -1860],
  [-290, -1832],
  [-332, -1808],
  [-370, -1796],
  [CLIFF.w, -1782],
  [CLIFF.w, CLIFF.s],
  [OASIS_SLOT[0], CLIFF.s],
  [OASIS[0], OASIS[3]],
  [OASIS[2], OASIS[3]],
  [OASIS[2], OASIS[1]],
  [OASIS_SLOT[2], OASIS[1]],
  [OASIS_SLOT[2], CLIFF.s],
  [PASS[0], CLIFF.s],
  [PASS[0], PASS[3]],
  [PASS[2], PASS[3]],
  [PASS[2], CLIFF.s],
  [CLIFF.e, CLIFF.s],
  [CLIFF.e, -1782],
  [-70, -1796],
  [-108, -1808],
  [-150, -1832],
  [-176, -1860],
  [MOUTH.x1, GATE_Z],
];

/** Point in polygon (even-odd). */
export function inPoly(poly: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to the cove outline (positive inside). */
export function coveDist(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < COVE.length; i++) {
    const [ax, az] = COVE[i], [bx, bz] = COVE[(i + 1) % COVE.length];
    best = Math.min(best, segDist(x, z, ax, az, bx, bz));
  }
  return inPoly(COVE, x, z) ? best : -best;
}

export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Inside the city (the cove minus the oasis, slot and pass, which are built separately), with a margin from the cliffs. */
export function inCity(x: number, z: number, m = 0): boolean {
  if (inRect(OASIS, x, z, m) || inRect(OASIS_SLOT, x, z, m) || (inRect(PASS, x, z, m) && z > CLIFF.s - m)) return false;
  return coveDist(x, z) > m;
}

// --- Water ------------------------------------------------------------------------------

/** Harbor basin, twin canals, branch canals (holes in the podium; water at WL). */
export const CANALS: Record<string, Rect> = {
  harbor: [-254, GATE_Z, -186, -1800],
  twin_w: [-243, -1800, -231, -1650],
  twin_e: [-209, -1800, -197, -1650],
  // Branch canals start at the foot of a cliff waterfall.
  branch_w1: [CLIFF.w + 0.5, -1752, -243, -1744],
  branch_w2: [CLIFF.w + 0.5, -1704, -243, -1696],
  branch_e1: [-197, -1752, CLIFF.e - 0.5, -1744],
  branch_e2: [-197, -1704, CLIFF.e - 0.5, -1696],
};

/** Palace moat (water a little below the plaza). */
export const MOAT: Rect = [-246, -1460, -194, -1452];
export const MOAT_WL = L4 - 0.6;

// --- Open spaces and landmarks -------------------------------------------------------------

/** Harbor quays (open space #1): strips along the basin, and the quay across its head. */
export const HARBOR_QUAY_W: Rect = [-268, -1858, -254, -1800];
export const HARBOR_QUAY_E: Rect = [-186, -1858, -172, -1800];
export const HARBOR_HEAD: Rect = [-268, -1800, -172, -1794];
/** East-west street joining the harbor quays to the lower districts (between harbor quarters and lower city). */
export const HARBOR_STREET_W: Rect = [-378, -1794, -243, -1790];
export const HARBOR_STREET_E: Rect = [-197, -1794, -62, -1790];
/** Central promenade between the twin canals, the grand stairs at its end. */
export const PROMENADE: Rect = [-231, -1800, -209, -1666];
export const GRAND_STAIRS: Rect = [-231, -1666, -209, -1650];
/** Quay streets along the outer sides of the twin canals. */
export const CANAL_QUAY_W: Rect = [-248, -1790, -243, -1650];
export const CANAL_QUAY_E: Rect = [-197, -1790, -192, -1650];
/** Ceremony plaza (open space #3), its waterfall fountain and the stairs either side (L2 → L3). */
export const PLAZA: Rect = [-262, -1650, -178, -1578];
export const PLAZA_C = { x: AX, z: -1614 };
export const FOUNTAIN: Rect = [-240, -1578, -200, -1562];
export const PLAZA_STAIRS: Rect[] = [
  [-258, -1578, -242, -1562],
  [-198, -1578, -182, -1562],
];
/** Avenue (L3) from the fountain to the palace stairs (L3 → L4). */
export const AVENUE: Rect = [-229, -1562, -211, -1522];
export const PALACE_STAIRS: Rect = [-229, -1522, -211, -1506];
/** Palace plaza (open space #2), the palace platform and its side gardens. */
export const PALACE_PLAZA: Rect = [-272, -1506, -168, -1460];
export const PALACE = { x: AX, z: -1433, w: 52, d: 38 }; // platform x[-246,-194], z[-1452,-1414]
export const GARDEN_W: Rect = [-272, -1460, -246, CLIFF.s];
export const GARDEN_E: Rect = [-194, -1460, -168, CLIFF.s];
/** Master Siku's waterbending courtyard (west cliff, waterfall pool) and Yugoda's healing yard (east cliff). */
export const COURTYARD: Rect = [-378, -1632, -346, -1598];
export const COURT_C = { x: -359, z: -1615, r: 13 };
export const COURT_POOL: Rect = [-378, -1626, -371, -1604];
export const HEALER: Rect = [-94, -1632, -62, -1598];
export const HEALER_C = { x: -79, z: -1615, r: 12 };
export const HEALER_POOL: Rect = [-66, -1622, -61.4, -1608];
/** Pools against the back cliff behind the palace platform (fed by cliff falls). */
export const PALACE_POOLS: Rect[] = [
  [AX - 22, CLIFF.s - 6, AX - 10, CLIFF.s],
  [AX + 10, CLIFF.s - 6, AX + 22, CLIFF.s],
];

/**
 * Waterfalls down the cliffs, each in a carved channel: a point on the cove
 * outline, the direction the water falls toward (yaw: the open side), the
 * sheet width and the level it lands on.
 */
export const CLIFF_FALLS: Array<{ x: number; z: number; yaw: number; w: number; bottom: number }> = [
  { x: CLIFF.w, z: -1748, yaw: Math.PI / 2, w: 6, bottom: WL },
  { x: CLIFF.w, z: -1700, yaw: Math.PI / 2, w: 6, bottom: WL },
  { x: CLIFF.e, z: -1748, yaw: -Math.PI / 2, w: 6, bottom: WL },
  { x: CLIFF.e, z: -1700, yaw: -Math.PI / 2, w: 6, bottom: WL },
  { x: CLIFF.w, z: (COURT_POOL[1] + COURT_POOL[3]) / 2, yaw: Math.PI / 2, w: 4.5, bottom: L2 + 0.42 },
  { x: CLIFF.e, z: (HEALER_POOL[1] + HEALER_POOL[3]) / 2, yaw: -Math.PI / 2, w: 3.5, bottom: L2 + 0.42 },
  { x: AX - 16, z: CLIFF.s, yaw: Math.PI, w: 7, bottom: L4 + 0.42 },
  { x: AX + 16, z: CLIFF.s, yaw: Math.PI, w: 7, bottom: L4 + 0.42 },
  { x: -305, z: JAW_TIP - 5, yaw: Math.PI, w: 9, bottom: 0 },
  { x: -135, z: JAW_TIP - 5, yaw: Math.PI, w: 9, bottom: 0 },
];
/** Water start spawn (ceremony plaza, facing the fountain and the palace). */
export const SPAWN = { x: -236, z: -1606, yaw: 0 };

// --- Districts --------------------------------------------------------------------------------

export type Side = 'n' | 's' | 'w' | 'e';

export interface DistrictSpec {
  id: string;
  rect: Rect;
  y: number;
  seed: number;
  /** East-west lanes forced through the district (z positions) and north-south lanes (x positions). */
  lanesX?: number[];
  lanesZ?: number[];
  /** Open areas kept clear of buildings. */
  keep?: Rect[];
  /** Edges against cliffs or walls (no windows, not walkable) and edges with a view but no walkway (canal water, terrace drops). */
  blind?: Side[];
  view?: Side[];
  /** Stair flights climbing into the district from the level 4 m below, at its north edge (x of the lanes). */
  stairsN?: number[];
  /** Override the storey range. */
  floors?: [number, number];
}

const S = TUNE.seed;

/**
 * District specs: west districts mirror the east ones across the axis (with
 * their own seeds). Lanes are forced through bridges, stairs and gates so the
 * maze stays connected.
 */
export const DISTRICTS: DistrictSpec[] = [
  // Harbor quarters (L1), clipped by the cliff jaws.
  { id: 'harbor_w', rect: [-376, -1858, -268, -1794], y: L1, seed: S + 1, lanesX: [-1822], lanesZ: [-312], blind: ['w', 'n'], floors: [2, 3] },
  { id: 'harbor_e', rect: [-172, -1858, -64, -1794], y: L1, seed: S + 2, lanesX: [-1822], lanesZ: [-128], blind: ['e', 'n'], floors: [2, 3] },
  // Lower city (L1) in three bands between the branch canals.
  { id: 'lower_w1', rect: [-378, -1790, -248, -1755], y: L1, seed: S + 3, lanesX: [-1772], lanesZ: [-300, -340], blind: ['w'] },
  { id: 'lower_w2', rect: [-378, -1744, -248, -1707], y: L1, seed: S + 4, lanesX: [-1726], lanesZ: [-300, -340], blind: ['w'], view: ['n'] },
  { id: 'lower_w3', rect: [-378, -1696, -248, -1650], y: L1, seed: S + 5, lanesX: [-1676], lanesZ: [-300, -340], blind: ['w', 's'], view: ['n'] },
  { id: 'lower_e1', rect: [-192, -1790, -62, -1755], y: L1, seed: S + 6, lanesX: [-1772], lanesZ: [-140, -100], blind: ['e'] },
  { id: 'lower_e2', rect: [-192, -1744, -62, -1707], y: L1, seed: S + 7, lanesX: [-1726], lanesZ: [-140, -100], blind: ['e'], view: ['n'] },
  { id: 'lower_e3', rect: [-192, -1696, -62, -1650], y: L1, seed: S + 8, lanesX: [-1676], lanesZ: [-140, -100], blind: ['e', 's'], view: ['n'] },
  // Middle districts (L2) flanking the ceremony plaza; Siku's courtyard and Yugoda's yard against the cliffs.
  { id: 'middle_w', rect: [-378, -1650, -262, -1562], y: L2, seed: S + 9, lanesX: [-1615, -1588], lanesZ: [-300, -340], keep: [COURTYARD], blind: ['w', 's'], view: ['n'], stairsN: [-300, -340] },
  { id: 'middle_e', rect: [-178, -1650, -62, -1562], y: L2, seed: S + 10, lanesX: [-1615, -1588], lanesZ: [-140, -100], keep: [HEALER], blind: ['e', 's'], view: ['n'], stairsN: [-140, -100] },
  // Upper city (L3) either side of the avenue; landings kept open at the top of the plaza stairs and the fountain.
  { id: 'upper_w', rect: [-378, -1562, -229, -1506], y: L3, seed: S + 11, lanesX: [-1534], lanesZ: [-250, -300, -340], keep: [[-258, -1562, -229, -1553]], blind: ['w', 's'], view: ['n'], stairsN: [-300, -340] },
  { id: 'upper_e', rect: [-211, -1562, -62, -1506], y: L3, seed: S + 12, lanesX: [-1534], lanesZ: [-190, -140, -100], keep: [[-211, -1562, -182, -1553]], blind: ['e', 's'], view: ['n'], stairsN: [-140, -100] },
  // Noble quarters (L4) flanking the palace plaza; the east one leads to the Glacier Pass.
  { id: 'noble_w', rect: [-378, -1506, -272, CLIFF.s], y: L4, seed: S + 13, lanesX: [-1468], lanesZ: [-300, -340], blind: ['w', 's'], view: ['n'], stairsN: [-300, -340], floors: [2, 3] },
  { id: 'noble_e', rect: [-168, -1506, -62, CLIFF.s], y: L4, seed: S + 14, lanesX: [-1468], lanesZ: [-140, -111], blind: ['e', 's'], view: ['n'], stairsN: [-140], floors: [2, 3] },
];

/** Footbridges over the branch canals (x positions, both banks) and bridges over the twin canals (z positions). */
export const FOOTBRIDGES_X = { w: [-300, -340], e: [-140, -100] };
export const TWIN_BRIDGES_Z = [-1772, -1726, -1676];

/**
 * Walkable floor level at (x, z) — the podium raster. null = water, cliff,
 * or a special structure built separately (palace platform, oasis, pass).
 */
export function levelAt(x: number, z: number): number | null {
  if (!inCity(x, z)) return null;
  for (const r of Object.values(CANALS)) if (inRect(r, x, z)) return null;
  if (inRect(MOAT, x, z)) return null;
  // Stair footprints sit on the lower level (the flights are built on top).
  if (inRect(GRAND_STAIRS, x, z)) return L1;
  if (PLAZA_STAIRS.some((r) => inRect(r, x, z)) || inRect(FOUNTAIN, x, z)) return L2;
  if (inRect(PALACE_STAIRS, x, z)) return L3;
  for (const d of DISTRICTS) {
    if (!d.stairsN || !inRect(d.rect, x, z)) continue;
    for (const sx of d.stairsN) if (Math.abs(x - sx) < TUNE.lane / 2 && z < d.rect[1] + TUNE.stairRun) return d.y - 4;
  }
  if (z < -1650) return L1;
  if (z < -1562) return L2;
  if (z < -1506) return L3;
  return L4;
}

// --- Named spots --------------------------------------------------------------------------------

const R = 'northern_water_tribe';

defineSpots({
  master_siku: { x: COURT_C.x + 9, z: COURT_C.z, y: L2, yaw: -Math.PI / 2, r: 2, label: 'Master Siku', region: R },
  training_siku: { x: COURT_C.x, z: COURT_C.z, y: L2, r: COURT_C.r, label: 'Waterbending Courtyard', region: R },
  master_yugoda: { x: HEALER_C.x - 7.5, z: HEALER_C.z - 7, y: L2, yaw: Math.PI / 2, r: 2, label: 'Healer Yugoda', region: R },
  training_yugoda: { x: HEALER_C.x, z: HEALER_C.z, y: L2, r: HEALER_C.r, label: 'Healing Hut Yard', region: R },
  giver_nwt_elder: { x: -246, z: -1592, y: L2, yaw: Math.PI / 2, r: 2, label: 'Elder Kanna', region: R },
  giver_nwt_chief: { x: AX, z: -1476, y: L4, yaw: Math.PI, r: 3, label: "Chief's Palace", region: R },
  merchant_nwt_1: { x: -262, z: -1838, y: L1, yaw: Math.PI / 2, r: 2, label: 'Fishmonger', region: R },
  merchant_nwt_2: { x: -258, z: -1626, y: L2, yaw: Math.PI / 2, r: 2, label: 'Furrier', region: R },
  merchant_nwt_3: { x: -178, z: -1838, y: L1, yaw: -Math.PI / 2, r: 2, label: 'Harbor Chandler', region: R },
  merchant_nwt_4: { x: -182, z: -1626, y: L2, yaw: -Math.PI / 2, r: 2, label: 'Carver', region: R },
  merchant_nwt_beasts: { x: -178, z: -1812, y: L1, yaw: -Math.PI / 2, r: 2, label: 'Beast Keeper', region: R },
  dock_nwt_harbor: { x: -180, z: -1846, y: L1, yaw: -Math.PI / 2, r: 4, label: 'Harbor Quay', region: R },
  dock_nwt_grand_canal: { x: AX, z: -1796, y: L1, yaw: Math.PI, r: 4, label: 'Promenade Landing', region: R },
  dock_nwt_sea_gate: { x: MOUTH.x0 + 7.8, z: GATE_Z + 8, y: L1, yaw: Math.PI, r: 2, label: 'Sea Gate', region: R },
  bridge_nwt_gate: { x: AX, z: GATE_Z - 3, y: GATE_TOP, r: 5, label: 'Great Ice Gate', region: R },
  shrine_spirit_oasis: { x: AX, z: -1370, y: L4, r: 4, label: 'Spirit Oasis', region: R },
  viewpoint_nwt_wall: { x: AX + 24, z: GATE_Z - 3, y: GATE_TOP, yaw: 0, r: 2.5, label: 'Gate Wall Lookout', region: R },
  viewpoint_nwt_palace: { x: AX, z: -1486, y: L4, yaw: Math.PI, r: 5, label: 'Palace Plaza', region: R },
  viewpoint_nwt_glacier: { x: -520, z: -1352, r: 4, label: 'Glacier Caves', region: R },
  habitat_otter_penguin_1: { x: -468, z: -1808, r: 22, label: 'Western Shore', region: R },
  shrine_ice_caves: { x: -520, z: -1336, r: 3, label: 'Glacier Caves Shrine', region: R },
});
