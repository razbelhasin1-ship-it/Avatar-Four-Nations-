import type { RegionFactory } from '../../RegionContent';
import { FireCapital } from './capital';
import './spots';

/**
 * Fire Nation region modules: the capital in the caldera (with the rim gate
 * and terraced city), the Capital Harbor, the Western Causeway, the Sun
 * Warrior Ruins and Ember Island.
 */
export const fireCapitalRegion: RegionFactory = () => new FireCapital();

/** All Fire Nation region factories (registered in ../index.ts). */
export const FIRE_REGION_FACTORIES: RegionFactory[] = [fireCapitalRegion];

export { FIRE_SPOTS } from './spots';
