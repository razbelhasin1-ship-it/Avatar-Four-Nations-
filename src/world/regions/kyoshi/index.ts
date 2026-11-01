import type { RegionFactory } from '../../RegionContent';
import { KyoshiIsland } from './KyoshiIsland';

/** Kyoshi Island: its own map (zone `kyoshi_island`), reached only by the travel routes. */
export const KYOSHI_REGION_FACTORIES: RegionFactory[] = [() => new KyoshiIsland()];
