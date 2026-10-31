import { defineSpots, type Spot } from '../../Spots';
import type { P2 } from '../../WorldLayout';
import { BASE, C, LEVEL_Y, floorY, place, type PlaceId } from './sat/layout';

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

/** Trailhead (end of the eastern road) and the gorge stair-bridge to the switchbacks. */
export const TRAILHEAD: P2 = { x: 1210, z: 980 };

/** Shrine of the Four Winds: ledge platform (offset from the landmark onto solid footing). */
export const WIND_SHRINE = { x: 1570, z: 1356, y: 161.5, r: 15.5 } as const;

const R = 'southern_air_temple';
/** Spot at a named place of the temple (offset along bearing and radius). */
const at = (id: PlaceId, o: Partial<Spot> & { dth?: number; dr?: number } = {}): Spot => {
  const { dth = 0, dr = 0, ...rest } = o;
  const p = place(id, dth, dr);
  return { x: p.x, z: p.z, y: p.y, region: R, ...rest };
};
/** Spot at bearing θ, radius r on a level (0..6) or at an explicit world y. */
const pol = (th: number, r: number, level: number | null, o: Partial<Spot> = {}): Spot => ({ ...polar(th, r), ...(level !== null ? { y: floorY(LEVEL_Y[level]) } : {}), region: R, ...o });
/** Yaw facing from (x,z) toward (tx,tz). */
const face = (x: number, z: number, tx: number, tz: number): number => Math.atan2(tx - x, tz - z);
/** Yaw facing the pinnacle's centre from bearing θ. */
const inward = (th: number): number => Math.atan2(-Math.cos((th * Math.PI) / 180), -Math.sin((th * Math.PI) / 180));

export const AIR_SPOTS: Record<string, Spot> = {
  // --- Masters & training grounds (docs/TECHNIQUES.md) ---------------------
  master_tenzo: at('moonGateCourt', { dth: 3, dr: 4, yaw: inward(227), r: 2, label: 'Monk Tenzo — moon-gate courtyard' }),
  training_tenzo: at('moonGateCourt', { r: 11, label: 'Moon-gate training courtyard' }),
  master_iio: at('airball', { dth: -7, dr: -2, yaw: inward(111) + Math.PI, r: 2, label: 'Brother Iio — airball court' }),
  training_iio: at('airball', { r: 11, label: 'Airball court' }),
  master_pasang: pol(60, 14, 6, { yaw: inward(60) + Math.PI, r: 2, label: 'Abbot Pasang — summit' }),
  training_pasang: pol(40, 17, 6, { r: 8, label: 'Summit plaza' }),
  master_hermit: { x: 1575.6, z: 1347.1, y: WIND_SHRINE.y, yaw: face(1575.6, 1347.1, WIND_SHRINE.x, WIND_SHRINE.z), r: 2, label: 'Hermit of the Four Winds', region: R },
  training_hermit: { x: WIND_SHRINE.x, z: WIND_SHRINE.z, y: WIND_SHRINE.y, r: 12, label: 'Shrine of the Four Winds — ledge', region: R },
  // --- Quest givers / elders -------------------------------------------------
  giver_air_elder: pol(284, 74, 1, { yaw: face(polar(284, 74).x, polar(284, 74).z, place('arrival').x, place('arrival').z), r: 2, label: 'Monk Tenzo greets arrivals (bison terrace)' }),
  // --- Merchants ---------------------------------------------------------------
  merchant_air_temple_1: at('entranceCourt', { dth: -4, dr: 8, yaw: inward(188), r: 2, label: 'Nomad trader (entrance courtyard)' }),
  merchant_air_temple_2: { x: 1203.5, z: 974, yaw: face(1203.5, 974, 1210, 980), r: 2, label: 'Trailhead pedlar', region: R },
  // --- Creature habitats -------------------------------------------------------
  habitat_bison_stable: at('stables', { dr: 4, r: 9, label: 'Sky bison stables' }),
  // On the level grazing shelf beside Cloudmirror Tarn (PLATEAUS 'bison_meadow').
  habitat_sky_bison_1: { x: 1366, z: 1050, r: 32, label: 'Sky Bison Meadow', region: R },
  habitat_sky_bison_2: at('stables', { dr: 4, r: 9, label: 'Sky bison stables' }),
  habitat_bison_meadow: { x: 1366, z: 1050, r: 32, label: 'Sky Bison Meadow', region: R },
  // --- Shrines -------------------------------------------------------------------
  shrine_wind: { x: 1577.05, z: 1344.7, y: WIND_SHRINE.y + 0.5, r: 3, label: 'Shrine of the Four Winds', region: R },
  shrine_air_pavilion: at('labyrinthCourt', { dr: -9, r: 4, label: 'Teal pavilion (labyrinth courtyard)' }),
  shrine_air_sanctum: at('sanctuaryDoor', { dr: 3, r: 2.5, label: 'Sanctuary door' }),
  shrine_air_avatars: { x: C.x, z: C.z + 4, y: BASE + 63.2, r: 6, label: 'Avatar sanctuary (statue room)', region: R },
  shrine_air_chortens: at('gardens', { dr: 3, r: 8, label: 'Garden shrines' }),
  shrine_air_bell: at('bellPavilion', { r: 4, label: 'Great-bell pavilion' }),
  // --- Viewpoints ------------------------------------------------------------------
  viewpoint_air_meditation_1: pol(30, 47.5, 5, { yaw: inward(30) + Math.PI, r: 3, label: 'Meditation terrace' }),
  viewpoint_air_meditation_2: pol(48, 47.5, 5, { yaw: inward(48) + Math.PI, r: 3, label: 'Meditation terrace' }),
  viewpoint_air_meditation_3: pol(66, 47.5, 5, { yaw: inward(66) + Math.PI, r: 3, label: 'Meditation terrace' }),
  viewpoint_air_sanctum: pol(160, 24, 6, { r: 2.5, label: 'Summit rim' }),
  viewpoint_air_outlook_north: at('landingNE', { dr: 7, r: 4, label: 'North-east landing ledge' }),
  viewpoint_air_outlook_south: at('airball', { dr: 7, r: 4, label: 'Airball court rim' }),
  viewpoint_air_east_balcony: pol(96, 70, 3, { r: 4, label: 'East cliff balcony' }),
  // --- Glide launch points (open edges) ------------------------------------------
  glide_launch_east: at('launch', { dr: 5, yaw: inward(140) + Math.PI, r: 1.8, label: 'Summit launch platform' }),
  glide_launch_sanctum: at('arrival', { dr: 7, yaw: inward(280) + Math.PI, r: 1.8, label: 'Landing-ledge launch' }),
  // --- Updrafts (wind corridors an airbender can ride) ----------------------------
  updraft_1: pol(100, 112, null, { y: BASE - 30, r: 9, label: 'East cliff updraft' }),
  updraft_2: pol(20, 112, null, { y: BASE - 26, r: 9, label: 'Orchard cliff updraft' }),
  updraft_3: pol(160, 114, null, { y: BASE - 30, r: 10, label: 'South cliff updraft' }),
  updraft_4: pol(300, 116, null, { y: BASE - 34, r: 9, label: 'Bison terrace updraft' }),
  updraft_5: pol(60, 124, null, { y: BASE - 50, r: 10, label: 'South-east updraft' }),
  updraft_6: { x: 1300, z: 1135, y: 175, r: 10, label: 'Switchback gorge updraft', region: R },
  updraft_7: { x: 1594, z: 1366, y: 140, r: 9, label: 'Four Winds updraft', region: R },
};

defineSpots(AIR_SPOTS);
