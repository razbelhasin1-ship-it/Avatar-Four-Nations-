import type { RegionFactory } from '../../RegionContent';
import { BadgermoleCavesSite } from './badgermole';
import { BanyanSite } from './banyan';
import { CampSite } from './camps';
import { KyoshiSite } from './kyoshi';
import { CAMPS, FARMS, INNS, WILDS_SPOTS } from './layout';
import { BuriedLibrarySite } from './library';
import { MistyPalmsSite } from './mistyPalms';
import { IcePathSite, SnowdriftDenSite, TundraOutpostSite } from './north';
import { OmashuSite } from './omashu';
import { FarmSite, HiariDockSite, InnSite, RoadBridgeSite, RoadsideSite } from './roads';

/**
 * The wilds: hand-assembled places between the capitals — Omashu, Kyoshi
 * Island, Misty Palms Oasis, the Buried Library, the Great Banyan Tree, the
 * Tundra Watchtower and Snowdrift Den, the Badgermole Caves, road bridges,
 * inns, farms, roadside shrines/signposts and enemy camps. Spots are published
 * at module load (layout.ts).
 */
export const WILDS_REGION_FACTORIES: RegionFactory[] = [
  () => new OmashuSite(),
  () => new KyoshiSite(),
  () => new MistyPalmsSite(),
  () => new BuriedLibrarySite(),
  () => new BanyanSite(),
  () => new TundraOutpostSite(),
  () => new SnowdriftDenSite(),
  () => new IcePathSite(),
  () => new BadgermoleCavesSite(),
  () => new RoadBridgeSite('north'),
  () => new RoadBridgeSite('west'),
  () => new HiariDockSite(),
  ...RoadsideSite.factories(),
  ...INNS.map((_, i) => () => new InnSite(i)),
  ...FARMS.map((_, i) => () => new FarmSite(i)),
  ...CAMPS.map((_, i) => () => new CampSite(i)),
];

export { WILDS_SPOTS };
