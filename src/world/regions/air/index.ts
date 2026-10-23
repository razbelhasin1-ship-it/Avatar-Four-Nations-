import type { RegionFactory } from '../../RegionContent';
import './layout'; // publishes the region's named spots at module load
import { ShrineOfFourWinds } from './shrine';
import { SouthernAirTemple } from './summit';
import { AirTempleTrail } from './trail';

/** Southern Air Temple region modules: the summit temple, the switchback trail, the Shrine of the Four Winds. */
export const AIR_REGION_FACTORIES: RegionFactory[] = [() => new SouthernAirTemple(), () => new AirTempleTrail(), () => new ShrineOfFourWinds()];
