import type { RegionFactory } from '../RegionContent';
import { AIR_REGION_FACTORIES } from './air';
import { EARTH_REGION_FACTORIES } from './earth';
import { FIRE_REGION_FACTORIES } from './fire';
import { WATER_REGION_FACTORIES } from './water';
import { WILDS_REGION_FACTORIES } from './wilds';

/**
 * Registry of region content modules (cities, temples, villages, bridges...).
 * Each module exports a factory; add one line per region here.
 */
export const REGION_FACTORIES: RegionFactory[] = [
  ...FIRE_REGION_FACTORIES, // Fire Nation: capital, harbour, causeway, Sun Warrior ruins, Ember Island
  ...AIR_REGION_FACTORIES, // Southern Air Temple: summit temple, switchback trail, Shrine of the Four Winds
  ...WATER_REGION_FACTORIES, // Water Tribes: Northern city, Southern village, Meditation Isle
  ...EARTH_REGION_FACTORIES, // Earth Kingdom: Ba Sing Se, Gaoling, Riverbend Village
  ...WILDS_REGION_FACTORIES, // Between the capitals: Omashu, Kyoshi, Misty Palms, Buried Library, Banyan Tree, north, caves, bridges, roadside, camps
];
