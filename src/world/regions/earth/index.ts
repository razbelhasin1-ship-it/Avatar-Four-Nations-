import type { RegionFactory } from '../../RegionContent';
import { BaSingSe } from './bss';
import { Gaoling } from './gaoling';
import { Riverbend } from './riverbend';
import { EARTH_SPOTS } from './spots';

/**
 * Earth Kingdom region modules: Ba Sing Se (Earth start), Gaoling (Earth Rumble
 * arena) and Riverbend Village. Spots are published at module load (spots.ts).
 */
export const baSingSeRegion: RegionFactory = () => new BaSingSe();
export const gaolingRegion: RegionFactory = () => new Gaoling();
export const riverbendRegion: RegionFactory = () => new Riverbend();

/** All Earth Kingdom region factories (registered in ../index.ts). */
export const EARTH_REGION_FACTORIES: RegionFactory[] = [baSingSeRegion, gaolingRegion, riverbendRegion];

export { EARTH_SPOTS };
