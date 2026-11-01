import { KI } from './landforms/kyoshiIsland';
import type { RegionDef } from './WorldLayout';

/**
 * Far zones: places with their own map, outside the mainland's square (±2048 m) and out of sight
 * of it (several km of open sea, beyond any draw distance or horizon march). They are not on the
 * world map and have no land or sea link: only the travel routes (src/data/travel.ts) lead there.
 *
 * Kept free of value imports from WorldLayout (which imports this file for `regionAt`).
 */
export interface ZoneDef {
  id: string;
  name: string;
  /** Centre and half-size of the zone's square (terrain, feature grid, height texture window). */
  cx: number;
  cz: number;
  half: number;
  /** Swimming or flying farther than this from the centre, currents and winds turn you back. */
  seaLimit: number;
  /** Region used for weather, music, saves and banners while on the zone. */
  region: RegionDef;
}

/** Mirrors WORLD_HALF (kept local: no value imports from WorldLayout). */
const MAINLAND_HALF = 2048;

export const KYOSHI_ZONE: ZoneDef = {
  id: KI.zone,
  name: KI.name,
  cx: KI.B.x,
  cz: KI.B.z,
  half: KI.half,
  seaLimit: KI.seaLimit,
  region: {
    id: KI.regionId,
    name: KI.name,
    nation: 'earth',
    x: KI.B.x,
    z: KI.B.z,
    r: KI.half * 1.5,
    biome: 'temperate',
    blurb: 'A crescent of green ridges around Koi Bay, home of the Kyoshi Warriors.',
    theme: 'kyoshi',
    weather: ['clear', 'clear', 'cloudy'],
    known: true,
  },
};

export const ZONES: readonly ZoneDef[] = [KYOSHI_ZONE];

/** True outside the mainland's square. */
export function offMainland(x: number, z: number): boolean {
  return Math.abs(x) > MAINLAND_HALF || Math.abs(z) > MAINLAND_HALF;
}

/** The far zone whose square contains (x, z), or null (mainland or open sea). */
export function zoneAt(x: number, z: number): ZoneDef | null {
  if (!offMainland(x, z)) return null;
  for (const zn of ZONES) if (Math.abs(x - zn.cx) <= zn.half && Math.abs(z - zn.cz) <= zn.half) return zn;
  return null;
}

export function zoneById(id: string): ZoneDef | null {
  return ZONES.find((z) => z.id === id) ?? null;
}
