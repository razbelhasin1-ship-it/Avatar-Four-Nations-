import type { RegionFactory } from '../../RegionContent';
import { WesternCauseway } from './causeway';
import { EmberIsland } from './ember';
import { FireCapitalCity } from './fnc/FireCapital';
import { SunWarriorRuins } from './ruins';
import './spots';

/**
 * Fire Nation region modules: the capital in the caldera (with the rim gate
 * and terraced city), the Capital Harbor, the Western Causeway, the Sun
 * Warrior Ruins and Ember Island.
 */
export const fireCapitalRegion: RegionFactory = () => new FireCapitalCity();
export const westernCausewayRegion: RegionFactory = () => new WesternCauseway();
export const sunWarriorRuinsRegion: RegionFactory = () => new SunWarriorRuins();
export const emberIslandRegion: RegionFactory = () => new EmberIsland();

/** All Fire Nation region factories (registered in ../index.ts). */
export const FIRE_REGION_FACTORIES: RegionFactory[] = [fireCapitalRegion, westernCausewayRegion, sunWarriorRuinsRegion, emberIslandRegion];

export { FIRE_SPOTS } from './spots';
