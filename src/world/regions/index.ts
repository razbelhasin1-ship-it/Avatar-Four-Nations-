import type { RegionFactory } from '../RegionContent';
import { FIRE_REGION_FACTORIES } from './fire';

/**
 * Registry of region content modules (cities, temples, villages, bridges...).
 * Each module exports a factory; add one line per region here.
 */
export const REGION_FACTORIES: RegionFactory[] = [
  ...FIRE_REGION_FACTORIES, // Fire Nation: capital, harbour, causeway, Sun Warrior ruins, Ember Island
];
