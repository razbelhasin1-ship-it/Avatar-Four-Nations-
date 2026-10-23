import type { RegionFactory } from '../../RegionContent';
import { createMeditationIsle } from './isle';
import { createNorthernWaterTribe } from './nwt';
import { createSouthernWaterTribe } from './swt';

/**
 * Water Tribe region modules: the Northern Water Tribe (Water start), the
 * Southern Water Tribe village and Meditation Isle (tutorial grounds).
 */
export const WATER_REGION_FACTORIES: RegionFactory[] = [
  createNorthernWaterTribe, // NWT capital (Water start)
  createSouthernWaterTribe, // SWT village
  createMeditationIsle, // tutorial training grounds
];
