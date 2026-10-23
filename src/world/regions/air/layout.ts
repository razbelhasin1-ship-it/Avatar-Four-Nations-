import { defineSpots, type Spot } from '../../Spots';
import type { P2 } from '../../WorldLayout';

/**
 * Shared coordinates of the Air Nomad region modules and the named spots they
 * publish (masters, training grounds, habitats, viewpoints, updrafts...).
 * Spots are defined at module load so consumers can resolve them before the
 * geometry is built.
 */

/** Plateau 'air_temple' centre and summit floor height. */
export const SUMMIT: P2 = { x: 1450, z: 1250 };
export const Y0 = 330;

/** World XZ of an offset from the summit centre (+x east, +z south). */
export function sl(x: number, z: number): P2 {
  return { x: SUMMIT.x + x, z: SUMMIT.z + z };
}

/** World XZ at angle `deg` (0 = east, 90 = south) and radius r from the summit centre. */
export function polar(deg: number, r: number): P2 {
  const a = (deg * Math.PI) / 180;
  return { x: SUMMIT.x + Math.cos(a) * r, z: SUMMIT.z + Math.sin(a) * r };
}

/** Stable floor heights used by spots (must match summit.ts). */
export const AIR_FLOORS = { plaza: Y0 + 0.15, terrace: Y0 + 6, sanctum: Y0 + 9, arena: Y0 + 0.9, stable: Y0 + 0.3 } as const;

/** Trailhead (end of the eastern road) and the gorge stair-bridge to the switchbacks. */
export const TRAILHEAD: P2 = { x: 1210, z: 980 };

/** Shrine of the Four Winds: ledge platform (offset from the landmark onto solid footing). */
export const WIND_SHRINE = { x: 1570, z: 1356, y: 161.5, r: 15.5 } as const;

const R = 'southern_air_temple';
const at = (x: number, z: number, o: Partial<Spot> & { y?: number } = {}): Spot => ({ ...sl(x, z), region: R, ...o });
const pol = (deg: number, r: number, o: Partial<Spot> = {}): Spot => ({ ...polar(deg, r), region: R, ...o });
/** Yaw facing from (x,z) toward (tx,tz). */
const face = (x: number, z: number, tx: number, tz: number): number => Math.atan2(tx - x, tz - z);

const F = AIR_FLOORS;

export const AIR_SPOTS: Record<string, Spot> = {
  // --- Masters & training grounds (docs/TECHNIQUES.md) ---------------------
  master_tenzo: at(38, -20.5, { y: F.plaza, yaw: 0, r: 2, label: 'Monk Tenzo — training courtyard' }),
  training_tenzo: at(38, -9, { y: F.plaza, r: 12, label: 'Moon-gate training courtyard' }),
  master_iio: at(51, 23, { y: F.arena, yaw: 0, r: 2, label: 'Sister Iio — air-ball arena' }),
  training_iio: at(51, 35, { y: F.arena, r: 12, label: 'Air-ball arena' }),
  master_pasang: at(52, -56, { y: F.sanctum, yaw: 0, r: 2, label: 'Abbot Pasang — summit sanctum' }),
  training_pasang: at(52, -44, { y: F.sanctum, r: 12, label: 'Summit sanctum' }),
  master_hermit: { x: 1575.6, z: 1347.1, y: WIND_SHRINE.y, yaw: face(1575.6, 1347.1, WIND_SHRINE.x, WIND_SHRINE.z), r: 2, label: 'Hermit of the Four Winds', region: R },
  training_hermit: { x: WIND_SHRINE.x, z: WIND_SHRINE.z, y: WIND_SHRINE.y, r: 12, label: 'Shrine of the Four Winds — ledge', region: R },
  // --- Quest givers / elders -------------------------------------------------
  giver_air_elder: at(-4, 25, { y: F.plaza, yaw: face(-4, 25, -10, 40), r: 2, label: 'Monk Tenzo greets arrivals' }),
  // --- Merchants ---------------------------------------------------------------
  merchant_air_temple_1: at(-23.4, 48, { y: F.plaza, yaw: Math.PI / 2, r: 2, label: 'Nomad trader (plaza)' }),
  merchant_air_temple_2: { x: 1203.5, z: 974, yaw: face(1203.5, 974, 1210, 980), r: 2, label: 'Trailhead pedlar', region: R },
  // --- Creature habitats -------------------------------------------------------
  habitat_bison_stable: { ...polarFrame(-64.3, 44.3, 0, 2), y: F.stable, r: 9, label: 'Sky bison stables', region: R },
  habitat_sky_bison_1: { x: 1340, z: 1080, r: 45, label: 'Sky Bison Meadow', region: R },
  habitat_sky_bison_2: { ...polarFrame(-64.3, 44.3, 0, 2), y: F.stable, r: 9, label: 'Sky bison stables', region: R },
  habitat_bison_meadow: { x: 1340, z: 1080, r: 45, label: 'Sky Bison Meadow', region: R },
  // --- Shrines -------------------------------------------------------------------
  shrine_wind: { x: 1577.05, z: 1344.7, y: WIND_SHRINE.y + 0.5, r: 3, label: 'Shrine of the Four Winds', region: R },
  shrine_air_pavilion: at(-24, -24, { y: Y0 + 0.9, r: 4, label: 'Teal pavilion' }),
  shrine_air_sanctum: at(52, -60.5, { y: F.sanctum + 0.6, r: 2.5, label: 'Sanctum shrine' }),
  shrine_air_avatars: { ...polar(228, 70), y: Y0 + 1.2, r: 6, label: 'Hall of the Avatars', region: R },
  // --- Viewpoints ------------------------------------------------------------------
  viewpoint_air_meditation_1: pol(70, 94, { y: Y0 + 0.3, yaw: (70 * Math.PI) / 180 - Math.PI / 2, r: 4, label: 'Meditation balcony' }),
  viewpoint_air_meditation_2: pol(95, 94, { y: Y0 + 0.3, r: 4, label: 'Meditation balcony' }),
  viewpoint_air_meditation_3: pol(120, 94, { y: Y0 + 0.3, r: 4, label: 'Meditation balcony' }),
  viewpoint_air_sanctum: at(60.5, -62.7, { y: F.sanctum, r: 2.5, label: 'Sanctum ledge' }),
  viewpoint_air_outlook_north: pol(300, 112, { y: Y0 + 0.3, r: 5, label: 'North outlook tower' }),
  viewpoint_air_outlook_south: pol(45, 112, { y: Y0 + 0.3, r: 5, label: 'South-east outlook tower' }),
  viewpoint_air_east_balcony: at(85, -9, { y: F.plaza, r: 5, label: 'East cliff balcony' }),
  // --- Glide launch points (open edges) ------------------------------------------
  glide_launch_east: pol(-5, 96, { y: F.plaza, yaw: Math.PI / 2 + (5 * Math.PI) / 180, r: 1.8, label: 'East glide ledge' }),
  glide_launch_sanctum: at(61.5, -64.3, { y: F.sanctum, yaw: Math.atan2(0.5, -0.866), r: 1.6, label: 'Sanctum glide ledge' }),
  // --- Updrafts (wind corridors an airbender can ride) ----------------------------
  updraft_1: pol(-4, 104, { y: Y0 - 30, r: 9, label: 'East cliff updraft' }),
  updraft_2: at(70, -79, { y: Y0 - 20, r: 9, label: 'Sanctum cliff updraft' }),
  updraft_3: pol(95, 106, { y: Y0 - 30, r: 10, label: 'Meditation cliff updraft' }),
  updraft_4: pol(182, 106, { y: Y0 - 35, r: 9, label: 'West falls updraft' }),
  updraft_5: pol(45, 124, { y: Y0 - 50, r: 10, label: 'South-east outlook updraft' }),
  updraft_6: { x: 1300, z: 1135, y: 175, r: 10, label: 'Switchback gorge updraft', region: R },
  updraft_7: { x: 1594, z: 1366, y: 140, r: 9, label: 'Four Winds updraft', region: R },
};

/** World XZ of a local (u, v) offset in the stables frame (hall faces the summit centre). */
function polarFrame(ox: number, oz: number, u: number, v: number): P2 {
  const o = sl(ox, oz);
  const yaw = Math.atan2(0.823, -0.567);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: o.x + c * u + s * v, z: o.z - s * u + c * v };
}

defineSpots(AIR_SPOTS);
