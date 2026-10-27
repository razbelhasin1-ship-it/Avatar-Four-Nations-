import type { BiomeId, Element } from '../core/types';

/**
 * Macro design of the world map. Pure data — consumed by the heightfield,
 * region builders, map UI, quests, spawners and habitats.
 *
 * Coordinates: metres. X = east, Z = south (north is -Z). Y = up. Sea level = 0.
 * The playable world spans [-WORLD_HALF, WORLD_HALF] on X and Z.
 */

export const WORLD_SIZE = 4096;
export const WORLD_HALF = WORLD_SIZE / 2;
export const SEA_LEVEL = 0;

export interface P2 {
  x: number;
  z: number;
}

export type Nation = 'water' | 'earth' | 'fire' | 'air' | 'neutral';

/** Circular land mass contribution (smooth-unioned, coastline noise added). */
export interface LandBlob extends P2 {
  r: number;
  /** Height bias for this land mass (m). */
  lift?: number;
}

/** Area forced to sea (straits, bays). */
export interface SeaBlob extends P2 {
  r: number;
}

export interface MountainRange {
  id: string;
  points: P2[];
  /** Half-width of the range footprint (m). */
  width: number;
  /** Peak height above surrounding terrain (m). */
  height: number;
  /** 0..1 how jagged (ridged noise mix). */
  roughness: number;
}

export interface RiverDef {
  id: string;
  name: string;
  /** Ordered source -> mouth. */
  points: P2[];
  /** Width at source and mouth (m). */
  width: [number, number];
  depth: number;
  frozen?: boolean;
}

export interface LakeDef extends P2 {
  id: string;
  name: string;
  r: number;
  /** Absolute water surface height (m). If omitted, computed from local terrain. */
  level?: number;
  frozen?: boolean;
  kind: 'lake' | 'pond' | 'oasis' | 'tarn' | 'hotspring';
}

export interface RoadDef {
  id: string;
  points: P2[];
  width: number;
  surface: 'dirt' | 'stone' | 'snow';
}

/** Flattened build site (cities, temples, villages). */
export interface PlateauDef extends P2 {
  id: string;
  /** Inner radius fully flattened. */
  r: number;
  /** Outer blend radius. */
  blend: number;
  /** Target height; if omitted, uses natural height at center. */
  height?: number;
}

export interface RegionDef extends P2 {
  id: string;
  name: string;
  nation: Nation;
  /** Influence radius used for "which region am I in". */
  r: number;
  biome: BiomeId;
  blurb: string;
  /** Ambient/music theme keys. */
  theme: 'water' | 'earth' | 'fire' | 'air' | 'desert' | 'swamp' | 'wild' | 'spirit';
  weather: Array<'clear' | 'cloudy' | 'snow' | 'blizzard' | 'rain' | 'fog' | 'ashfall' | 'sandstorm' | 'wind'>;
  /** Shown on the map from the start. */
  known: boolean;
}

export type LandmarkKind =
  | 'capital'
  | 'city'
  | 'village'
  | 'temple'
  | 'shrine'
  | 'cave'
  | 'viewpoint'
  | 'dock'
  | 'training'
  | 'ruin'
  | 'camp'
  | 'oasis'
  | 'habitat'
  | 'landmark';

export interface LandmarkDef extends P2 {
  id: string;
  name: string;
  regionId: string;
  kind: LandmarkKind;
  /** Radius within which the landmark counts as discovered. */
  discoverRadius: number;
  fastTravel: boolean;
  /** Hidden locations are not marked on the map until discovered. */
  hidden?: boolean;
  blurb?: string;
}

export interface StartDef {
  element: Element;
  regionId: string;
  landmarkId: string;
  spawn: P2;
  /** Facing yaw (radians; 0 = +Z/south, PI = north). */
  yaw: number;
  title: string;
  subtitle: string;
}

// ---------------------------------------------------------------------------
// Land & sea
// ---------------------------------------------------------------------------

export const LAND_BLOBS: LandBlob[] = [
  // Earth Kingdom main continent
  { x: 250, z: -50, r: 1150, lift: 6 },
  { x: -650, z: -350, r: 650, lift: 4 },
  { x: 1250, z: -350, r: 650, lift: 8 },
  { x: 1300, z: 450, r: 560, lift: 8 },
  { x: -150, z: 650, r: 600, lift: 3 },
  { x: 500, z: 900, r: 520, lift: 5 },
  // Northern polar lands (Northern Water Tribe & tundra)
  { x: -250, z: -1300, r: 560, lift: 3 },
  { x: 350, z: -1150, r: 520, lift: 6 },
  { x: -850, z: -1050, r: 430, lift: 4 },
  // South-east Air Temple mountains
  { x: 1450, z: 1180, r: 520, lift: 30 },
  { x: 1050, z: 1150, r: 330, lift: 10 },
  // Southern polar coast (Southern Water Tribe)
  { x: 220, z: 1520, r: 330, lift: 2 },
  { x: 230, z: 1380, r: 150, lift: 2 }, // land bridge from the desert coast
  // Fire Nation island chain (separated by the Western Strait)
  { x: -1380, z: 1120, r: 470, lift: 10 },
  { x: -1180, z: 1480, r: 280, lift: 6 },
  { x: -1720, z: 760, r: 220, lift: 4 },
  // Small islands
  { x: 1830, z: -420, r: 170, lift: 4 }, // Kyoshi Island
  { x: -1700, z: 1760, r: 150, lift: 3 }, // Ember Island
  { x: -1800, z: -1800, r: 130, lift: 3 }, // Meditation Isle (tutorial)
];

export const SEA_BLOBS: SeaBlob[] = [
  // Western Strait between the Earth Kingdom and the Fire Nation
  { x: -880, z: 780, r: 150 },
  { x: -780, z: 960, r: 140 },
  { x: -930, z: 600, r: 120 },
  { x: -720, z: 1150, r: 170 },
  // Northern Water Tribe bay
  { x: -230, z: -1780, r: 190 },
  // Bay south of the desert separating the Southern Water Tribe shelf
  { x: -150, z: 1350, r: 160 },
  { x: 650, z: 1450, r: 190 },
];

// ---------------------------------------------------------------------------
// Relief
// ---------------------------------------------------------------------------

export const MOUNTAIN_RANGES: MountainRange[] = [
  {
    id: 'northern_glaciers',
    points: [{ x: -900, z: -1250 }, { x: -480, z: -1300 }, { x: 60, z: -1260 }, { x: 600, z: -1180 }],
    width: 170,
    height: 120,
    roughness: 0.55,
  },
  {
    id: 'western_spine',
    points: [{ x: -760, z: -880 }, { x: -620, z: -520 }, { x: -560, z: -180 }],
    width: 150,
    height: 140,
    roughness: 0.75,
  },
  {
    id: 'serpent_range',
    points: [{ x: 380, z: 520 }, { x: 760, z: 580 }, { x: 1120, z: 700 }],
    width: 140,
    height: 130,
    roughness: 0.8,
  },
  {
    id: 'eastern_air_range',
    points: [{ x: 1150, z: 820 }, { x: 1420, z: 980 }, { x: 1600, z: 1260 }, { x: 1680, z: 1500 }],
    width: 260,
    height: 270,
    roughness: 0.85,
  },
  {
    id: 'eastern_highlands',
    points: [{ x: 1500, z: -780 }, { x: 1580, z: -350 }, { x: 1560, z: 150 }],
    width: 170,
    height: 110,
    roughness: 0.6,
  },
  {
    id: 'fire_island_ridge',
    points: [{ x: -1650, z: 900 }, { x: -1480, z: 1000 }],
    width: 120,
    height: 90,
    roughness: 0.7,
  },
];

export const RIVERS: RiverDef[] = [
  {
    id: 'great_river',
    name: 'The Great River',
    points: [
      { x: -60, z: -1100 },
      { x: -10, z: -820 },
      { x: 110, z: -540 },
      { x: 200, z: -250 },
      { x: 240, z: 60 },
      { x: 190, z: 330 },
      { x: -40, z: 520 },
      { x: -380, z: 680 },
      { x: -700, z: 820 },
    ],
    width: [10, 30],
    depth: 3.5,
  },
  {
    id: 'glacier_melt',
    name: 'Glacier Melt Stream',
    points: [
      { x: -470, z: -1210 },
      { x: -420, z: -1380 },
      { x: -330, z: -1520 },
      { x: -270, z: -1660 },
    ],
    width: [7, 14],
    depth: 2,
  },
  {
    id: 'misty_river',
    name: 'Misty River',
    points: [
      { x: 1450, z: -560 },
      { x: 1350, z: -380 },
      { x: 1320, z: -120 },
      { x: 1400, z: 160 },
      { x: 1620, z: 300 },
      { x: 1900, z: 330 },
    ],
    width: [8, 22],
    depth: 3,
  },
  {
    id: 'temple_falls',
    name: 'Temple Falls Stream',
    points: [
      { x: 1520, z: 1190 },
      { x: 1640, z: 1120 },
      { x: 1780, z: 1060 },
      { x: 1960, z: 1020 },
    ],
    width: [6, 14],
    depth: 2,
  },
  {
    id: 'caldera_stream',
    name: 'Ember Stream',
    // Rises on the OUTER slope of the volcano (rim crest is ~235 m from the caldera centre); a source inside the
    // rim made the river surface hang over the caldera wall as a sheet.
    points: [
      { x: -1110, z: 975 },
      { x: -1060, z: 960 },
      { x: -960, z: 960 },
    ],
    width: [6, 12],
    depth: 2,
  },
  {
    id: 'swamp_channel',
    name: 'Mistwater Channel',
    points: [
      { x: -1060, z: -260 },
      { x: -1180, z: -120 },
      { x: -1320, z: 40 },
      { x: -1520, z: 120 },
    ],
    width: [10, 20],
    depth: 2,
  },
];

export const LAKES: LakeDef[] = [
  { id: 'lake_laogai', name: 'Lake Laogai', x: 1060, z: 170, r: 48, kind: 'lake' },
  { id: 'frozen_lake', name: 'Moonlit Frozen Lake', x: 330, z: -1330, r: 85, kind: 'lake', frozen: true },
  { id: 'lake_hiari', name: 'Lake Hiari', x: -300, z: -300, r: 90, kind: 'lake' },
  { id: 'swamp_heart', name: 'Heart of the Swamp', x: -1150, z: -140, r: 70, kind: 'lake' },
  { id: 'misty_oasis', name: 'Misty Palms Oasis', x: 120, z: 860, r: 26, kind: 'oasis' },
  { id: 'temple_tarn', name: 'Cloudmirror Tarn', x: 1360, z: 1110, r: 24, kind: 'tarn' },
  { id: 'spirit_pond', name: 'Spirit Pond', x: -1790, z: -1790, r: 14, kind: 'pond' },
  { id: 'kyoshi_pond', name: 'Unagi Cove Pond', x: 1840, z: -380, r: 16, kind: 'pond' },
  { id: 'hot_spring', name: 'Ember Hot Spring', x: -1240, z: 1420, r: 14, kind: 'hotspring' },
];

export const ROADS: RoadDef[] = [
  {
    id: 'northern_road',
    points: [
      { x: -200, z: -1460 },
      { x: -180, z: -1300 },
      { x: -120, z: -1050 },
      { x: -60, z: -800 },
      { x: 60, z: -560 },
      { x: 220, z: -360 },
      { x: 430, z: -170 },
    ],
    width: 6,
    surface: 'dirt',
  },
  {
    id: 'ba_sing_se_west',
    points: [{ x: 430, z: -170 }, { x: 600, z: -100 }, { x: 760, z: -60 }],
    width: 8,
    surface: 'stone',
  },
  {
    id: 'southern_road',
    points: [
      { x: 850, z: 280 },
      { x: 760, z: 420 },
      { x: 600, z: 480 },
      { x: 420, z: 640 },
      { x: 200, z: 820 },
      { x: 150, z: 1050 },
      { x: 210, z: 1350 },
      { x: 220, z: 1480 },
    ],
    width: 6,
    surface: 'dirt',
  },
  {
    id: 'western_road',
    points: [
      { x: 240, z: 60 },
      { x: -100, z: 120 },
      { x: -420, z: 260 },
      { x: -620, z: 520 },
      { x: -780, z: 700 },
    ],
    width: 6,
    surface: 'dirt',
  },
  {
    id: 'fire_causeway_road',
    points: [
      { x: -940, z: 960 },
      { x: -1050, z: 1050 },
      { x: -1170, z: 1100 },
      { x: -1260, z: 1130 },
    ],
    width: 9,
    surface: 'stone',
  },
  {
    id: 'eastern_road',
    points: [
      { x: 1260, z: -50 },
      { x: 1300, z: 250 },
      { x: 1250, z: 520 },
      { x: 1180, z: 760 },
      { x: 1210, z: 980 },
    ],
    width: 6,
    surface: 'dirt',
  },
  {
    id: 'swamp_trail',
    points: [
      { x: -420, z: 260 },
      { x: -700, z: 80 },
      { x: -950, z: -60 },
    ],
    width: 4,
    surface: 'dirt',
  },
  {
    id: 'omashu_road',
    points: [
      { x: -60, z: -800 },
      { x: -260, z: -720 },
      { x: -420, z: -660 },
    ],
    width: 6,
    surface: 'stone',
  },
];

export const PLATEAUS: PlateauDef[] = [
  { id: 'nwt_city', x: -220, z: -1600, r: 230, blend: 120, height: 4 },
  { id: 'ba_sing_se', x: 850, z: -50, r: 430, blend: 160, height: 26 },
  { id: 'fire_caldera', x: -1330, z: 1150, r: 170, blend: 40, height: 42 },
  { id: 'air_temple', x: 1450, z: 1250, r: 95, blend: 60, height: 330 },
  { id: 'swt_village', x: 220, z: 1600, r: 90, blend: 60, height: 3 },
  { id: 'omashu', x: -450, z: -650, r: 85, blend: 40, height: 95 },
  { id: 'kyoshi_village', x: 1820, z: -440, r: 60, blend: 50, height: 6 },
  { id: 'gaoling', x: 420, z: 300, r: 70, blend: 60, height: 22 },
  { id: 'misty_palms', x: 160, z: 860, r: 60, blend: 50 },
  { id: 'river_village', x: 120, z: -560, r: 55, blend: 50 },
  { id: 'meditation_isle', x: -1800, z: -1800, r: 70, blend: 40, height: 4 },
  { id: 'ember_resort', x: -1690, z: 1760, r: 60, blend: 40, height: 4 },
  // Grazing shelf around Cloudmirror Tarn so the sky bison herd has open, level ground on the steep massif.
  { id: 'bison_meadow', x: 1368, z: 1052, r: 36, blend: 26, height: 132 },
];

// ---------------------------------------------------------------------------
// Regions, landmarks, starts
// ---------------------------------------------------------------------------

export const REGIONS: RegionDef[] = [
  {
    id: 'northern_water_tribe',
    name: 'Northern Water Tribe',
    nation: 'water',
    x: -220,
    z: -1550,
    r: 520,
    biome: 'polar',
    blurb: 'A city of ice and canals at the top of the world, guarded by great frozen walls.',
    theme: 'water',
    weather: ['clear', 'snow', 'cloudy', 'blizzard'],
    known: true,
  },
  {
    id: 'frozen_tundra',
    name: 'Frozen Tundra',
    nation: 'neutral',
    x: 250,
    z: -1100,
    r: 480,
    biome: 'tundra',
    blurb: 'Windswept snowfields between the glaciers and the northern forests.',
    theme: 'wild',
    weather: ['clear', 'snow', 'cloudy', 'wind'],
    known: false,
  },
  {
    id: 'ba_sing_se',
    name: 'Ba Sing Se',
    nation: 'earth',
    x: 850,
    z: -50,
    r: 470,
    biome: 'farmland',
    blurb: 'The impenetrable city — rings of colossal walls around the Earth King’s palace.',
    theme: 'earth',
    weather: ['clear', 'cloudy', 'rain'],
    known: true,
  },
  {
    id: 'earth_heartland',
    name: 'Earth Kingdom Heartland',
    nation: 'earth',
    x: 50,
    z: -150,
    r: 650,
    biome: 'temperate',
    blurb: 'Rolling farmland, forests and river villages of the Earth Kingdom.',
    theme: 'earth',
    weather: ['clear', 'cloudy', 'rain', 'fog'],
    known: true,
  },
  {
    id: 'omashu',
    name: 'Omashu',
    nation: 'earth',
    x: -450,
    z: -650,
    r: 200,
    biome: 'alpine',
    blurb: 'A mountain city of stone chutes and towering spires.',
    theme: 'earth',
    weather: ['clear', 'cloudy', 'wind'],
    known: false,
  },
  {
    id: 'foggy_swamp',
    name: 'The Foggy Swamp',
    nation: 'water',
    x: -1150,
    z: -150,
    r: 330,
    biome: 'swamp',
    blurb: 'A tangled wetland where vines move and the fog remembers.',
    theme: 'swamp',
    weather: ['fog', 'rain', 'cloudy'],
    known: false,
  },
  {
    id: 'si_wong_desert',
    name: 'Si Wong Desert',
    nation: 'neutral',
    x: 250,
    z: 950,
    r: 420,
    biome: 'desert',
    blurb: 'An ocean of sand. Sandbenders sail its dunes; something ancient sleeps beneath.',
    theme: 'desert',
    weather: ['clear', 'sandstorm', 'wind'],
    known: false,
  },
  {
    id: 'fire_nation_capital',
    name: 'Fire Nation Capital',
    nation: 'fire',
    x: -1330,
    z: 1150,
    r: 480,
    biome: 'volcanic',
    blurb: 'A royal city cradled inside a sleeping volcano, crowned by the Fire Lord’s palace.',
    theme: 'fire',
    weather: ['clear', 'cloudy', 'ashfall'],
    known: true,
  },
  {
    id: 'ember_island',
    name: 'Ember Island',
    nation: 'fire',
    x: -1700,
    z: 1760,
    r: 170,
    biome: 'tropical',
    blurb: 'A sunny resort isle of beaches and theatre.',
    theme: 'fire',
    weather: ['clear', 'cloudy'],
    known: false,
  },
  {
    id: 'southern_air_temple',
    name: 'Southern Air Temple',
    nation: 'air',
    x: 1450,
    z: 1220,
    r: 420,
    biome: 'alpine',
    blurb: 'Spires of white stone and blue roofs, floating above a sea of clouds.',
    theme: 'air',
    weather: ['clear', 'wind', 'cloudy'],
    known: true,
  },
  {
    id: 'southern_water_tribe',
    name: 'Southern Water Tribe',
    nation: 'water',
    x: 220,
    z: 1600,
    r: 260,
    biome: 'polar',
    blurb: 'A small, proud village on the southern ice.',
    theme: 'water',
    weather: ['clear', 'snow', 'cloudy'],
    known: false,
  },
  {
    id: 'kyoshi_island',
    name: 'Kyoshi Island',
    nation: 'earth',
    x: 1830,
    z: -420,
    r: 200,
    biome: 'forest',
    blurb: 'A forested island guarded by fan-wielding warriors.',
    theme: 'earth',
    weather: ['clear', 'rain', 'fog'],
    known: false,
  },
  {
    id: 'meditation_isle',
    name: 'Meditation Isle',
    nation: 'neutral',
    x: -1800,
    z: -1800,
    r: 150,
    biome: 'temperate',
    blurb: 'A quiet training ground between the worlds.',
    theme: 'spirit',
    weather: ['clear'],
    known: false,
  },
];

/** Region containing (x, z): the nearest region whose radius covers the point (pure; World.regionAt). */
export function regionAt(x: number, z: number): RegionDef | null {
  let best: RegionDef | null = null;
  let bestScore = Infinity;
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.x, z - r.z);
    if (d > r.r) continue;
    const score = d / r.r;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/** In the Northern or Southern Water Tribe: their rocks are ice, never earth (no earthbending them). */
export function waterTribeAt(x: number, z: number): boolean {
  const id = regionAt(x, z)?.id;
  return id === 'northern_water_tribe' || id === 'southern_water_tribe';
}

export const LANDMARKS: LandmarkDef[] = [
  // Northern Water Tribe
  { id: 'nwt_gate', name: 'Great Ice Gate', regionId: 'northern_water_tribe', x: -220, z: -1735, kind: 'landmark', discoverRadius: 60, fastTravel: false },
  { id: 'nwt_plaza', name: 'Tribal Plaza', regionId: 'northern_water_tribe', x: -220, z: -1590, kind: 'capital', discoverRadius: 80, fastTravel: true },
  { id: 'nwt_palace', name: "Chief's Palace", regionId: 'northern_water_tribe', x: -220, z: -1470, kind: 'landmark', discoverRadius: 50, fastTravel: false },
  { id: 'nwt_training', name: 'Waterbending Courtyard', regionId: 'northern_water_tribe', x: -330, z: -1560, kind: 'training', discoverRadius: 40, fastTravel: false },
  { id: 'spirit_oasis', name: 'Spirit Oasis', regionId: 'northern_water_tribe', x: -120, z: -1450, kind: 'shrine', discoverRadius: 30, fastTravel: false, hidden: true },
  { id: 'ice_caves', name: 'Glacier Caves', regionId: 'northern_water_tribe', x: -520, z: -1340, kind: 'cave', discoverRadius: 40, fastTravel: false, hidden: true },
  { id: 'nwt_harbor', name: 'Harbor Canals', regionId: 'northern_water_tribe', x: -60, z: -1680, kind: 'dock', discoverRadius: 50, fastTravel: true },
  { id: 'tundra_outpost', name: 'Tundra Watchtower', regionId: 'frozen_tundra', x: 300, z: -1050, kind: 'camp', discoverRadius: 50, fastTravel: true },
  { id: 'bear_dog_den', name: 'Snowdrift Den', regionId: 'frozen_tundra', x: 520, z: -1260, kind: 'habitat', discoverRadius: 45, fastTravel: false, hidden: true },
  // Earth Kingdom
  { id: 'bss_outer_gate', name: 'Outer Wall Gate', regionId: 'ba_sing_se', x: 430, z: -110, kind: 'landmark', discoverRadius: 70, fastTravel: true },
  { id: 'bss_lower_ring', name: 'Lower Ring', regionId: 'ba_sing_se', x: 650, z: -40, kind: 'city', discoverRadius: 90, fastTravel: true },
  { id: 'bss_middle_ring', name: 'Middle Ring', regionId: 'ba_sing_se', x: 760, z: -50, kind: 'city', discoverRadius: 70, fastTravel: true },
  { id: 'bss_upper_ring', name: 'Upper Ring Palace', regionId: 'ba_sing_se', x: 850, z: -50, kind: 'capital', discoverRadius: 70, fastTravel: true },
  { id: 'bss_dojo', name: 'Stone Fist Dojo', regionId: 'ba_sing_se', x: 700, z: 40, kind: 'training', discoverRadius: 35, fastTravel: false },
  { id: 'gaoling', name: 'Gaoling', regionId: 'earth_heartland', x: 420, z: 300, kind: 'village', discoverRadius: 70, fastTravel: true },
  { id: 'river_village', name: 'Riverbend Village', regionId: 'earth_heartland', x: 120, z: -560, kind: 'village', discoverRadius: 60, fastTravel: true },
  { id: 'omashu_city', name: 'Omashu', regionId: 'omashu', x: -450, z: -650, kind: 'city', discoverRadius: 90, fastTravel: true },
  { id: 'badgermole_caves', name: 'Badgermole Caves', regionId: 'earth_heartland', x: 650, z: 560, kind: 'habitat', discoverRadius: 45, fastTravel: false, hidden: true },
  { id: 'banyan_tree', name: 'Great Banyan Tree', regionId: 'foggy_swamp', x: -1150, z: -140, kind: 'landmark', discoverRadius: 80, fastTravel: true, hidden: true },
  { id: 'kyoshi_village', name: 'Kyoshi Village', regionId: 'kyoshi_island', x: 1820, z: -440, kind: 'village', discoverRadius: 70, fastTravel: true },
  // Desert & south
  { id: 'misty_palms', name: 'Misty Palms Oasis', regionId: 'si_wong_desert', x: 160, z: 860, kind: 'oasis', discoverRadius: 70, fastTravel: true },
  { id: 'buried_library', name: 'Buried Library', regionId: 'si_wong_desert', x: 420, z: 1120, kind: 'ruin', discoverRadius: 50, fastTravel: false, hidden: true },
  { id: 'swt_village', name: 'Southern Water Tribe Village', regionId: 'southern_water_tribe', x: 220, z: 1600, kind: 'village', discoverRadius: 70, fastTravel: true },
  // Fire Nation
  { id: 'fn_harbor', name: 'Capital Harbor', regionId: 'fire_nation_capital', x: -1010, z: 980, kind: 'dock', discoverRadius: 70, fastTravel: true },
  { id: 'fn_plaza', name: 'Royal Plaza', regionId: 'fire_nation_capital', x: -1330, z: 1200, kind: 'capital', discoverRadius: 80, fastTravel: true },
  { id: 'fn_palace', name: "Fire Lord's Palace", regionId: 'fire_nation_capital', x: -1330, z: 1110, kind: 'landmark', discoverRadius: 60, fastTravel: false },
  { id: 'fn_arena', name: 'Agni Kai Arena', regionId: 'fire_nation_capital', x: -1230, z: 1180, kind: 'training', discoverRadius: 40, fastTravel: false },
  { id: 'fn_turtleduck_pond', name: 'Turtle-Duck Pond', regionId: 'fire_nation_capital', x: -1390, z: 1090, kind: 'landmark', discoverRadius: 25, fastTravel: false },
  { id: 'dragon_bone_caldera', name: 'Sun Warrior Ruins', regionId: 'fire_nation_capital', x: -1560, z: 940, kind: 'ruin', discoverRadius: 60, fastTravel: true, hidden: true },
  { id: 'ember_resort', name: 'Ember Island Resort', regionId: 'ember_island', x: -1690, z: 1760, kind: 'village', discoverRadius: 70, fastTravel: true },
  // Air
  { id: 'air_temple', name: 'Southern Air Temple', regionId: 'southern_air_temple', x: 1450, z: 1250, kind: 'temple', discoverRadius: 90, fastTravel: true },
  { id: 'air_trailhead', name: 'Temple Trailhead', regionId: 'southern_air_temple', x: 1210, z: 980, kind: 'landmark', discoverRadius: 50, fastTravel: true },
  { id: 'bison_meadow', name: 'Sky Bison Meadow', regionId: 'southern_air_temple', x: 1340, z: 1080, kind: 'habitat', discoverRadius: 60, fastTravel: false },
  { id: 'wind_shrine', name: 'Shrine of the Four Winds', regionId: 'southern_air_temple', x: 1580, z: 1350, kind: 'shrine', discoverRadius: 35, fastTravel: false, hidden: true },
  // Spirit
  { id: 'meditation_isle', name: 'Meditation Isle', regionId: 'meditation_isle', x: -1800, z: -1800, kind: 'training', discoverRadius: 60, fastTravel: false, hidden: true },
];

export const STARTS: Record<Element, StartDef> = {
  water: {
    element: 'water',
    regionId: 'northern_water_tribe',
    landmarkId: 'nwt_plaza',
    spawn: { x: -250, z: -1560 },
    yaw: Math.PI,
    title: 'Begin your journey in the Northern Water Tribe',
    subtitle: 'Flowing attacks, redirection, water whips and ice.',
  },
  earth: {
    element: 'earth',
    regionId: 'ba_sing_se',
    landmarkId: 'bss_lower_ring',
    spawn: { x: 640, z: -30 },
    yaw: Math.PI / 2,
    title: 'Begin your journey in Ba Sing Se',
    subtitle: 'Grounding, defence, precision and powerful impacts.',
  },
  fire: {
    element: 'fire',
    regionId: 'fire_nation_capital',
    landmarkId: 'fn_plaza',
    spawn: { x: -1310, z: 1230 },
    yaw: Math.PI,
    title: 'Begin your journey in the Fire Nation Capital',
    subtitle: 'Aggressive combinations, precise strikes, controlled bursts.',
  },
  air: {
    element: 'air',
    regionId: 'southern_air_temple',
    landmarkId: 'air_temple',
    spawn: { x: 1440, z: 1290 },
    yaw: Math.PI,
    title: 'Begin your journey at the Southern Air Temple',
    subtitle: 'Agility, evasion, air currents and aerial movement.',
  },
};

/** Tutorial sandbox spawn (Meditation Isle). */
export const TUTORIAL_SPAWN: P2 & { yaw: number } = { x: -1800, z: -1775, yaw: Math.PI };

export function regionById(id: string): RegionDef | undefined {
  return REGIONS.find((r) => r.id === id);
}

export function landmarkById(id: string): LandmarkDef | undefined {
  return LANDMARKS.find((l) => l.id === id);
}
