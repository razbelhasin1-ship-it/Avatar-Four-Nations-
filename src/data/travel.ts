import { A, KI, yawOutward } from '../world/landforms/kyoshiIsland';

/**
 * Travel routes to Kyoshi Island (its own map) and back. Data only — src/travel/TravelSystem.ts runs
 * the dialog, journey, state and guards; src/travel/points.ts builds the small travel point in each
 * city (prop, sign, staff NPC, trigger, idling travellers).
 */

/** When true, the island's harbormaster / bison keeper also offer the other cities of their transport. */
export const ALLOW_ONWARD_TRAVEL = false;
/** When true, a city's route needs the flag `travel_unlocked_<city>` (story / quest) before it opens. */
export const TRAVEL_REQUIRES_UNLOCK = false;

export type CityId = 'nwt' | 'fnc' | 'bss' | 'sat';
export type PlaceId = CityId | 'kyoshi_island';
export type Transport = 'ship' | 'bison' | 'rail_ferry';
export type JourneyId = 'ship' | 'bison' | 'rail_ferry';
export type ArrivalId = 'ki_pier' | 'ki_meadow' | CityId;

export interface RouteDef {
  id: string;
  from: PlaceId;
  to: PlaceId;
  transport: Transport;
  journey: JourneyId;
  arrival: ArrivalId;
  /** In-game minutes the trip takes (the shared clock advances). */
  minutes: number;
}

export const ROUTES: readonly RouteDef[] = [
  { id: 'nwt_to_kyoshi', from: 'nwt', to: 'kyoshi_island', transport: 'ship', journey: 'ship', arrival: 'ki_pier', minutes: 9 },
  { id: 'fnc_to_kyoshi', from: 'fnc', to: 'kyoshi_island', transport: 'ship', journey: 'ship', arrival: 'ki_pier', minutes: 8 },
  { id: 'bss_to_kyoshi', from: 'bss', to: 'kyoshi_island', transport: 'rail_ferry', journey: 'rail_ferry', arrival: 'ki_pier', minutes: 10 },
  { id: 'sat_to_kyoshi', from: 'sat', to: 'kyoshi_island', transport: 'bison', journey: 'bison', arrival: 'ki_meadow', minutes: 6 },
  { id: 'kyoshi_to_nwt', from: 'kyoshi_island', to: 'nwt', transport: 'ship', journey: 'ship', arrival: 'nwt', minutes: 9 },
  { id: 'kyoshi_to_fnc', from: 'kyoshi_island', to: 'fnc', transport: 'ship', journey: 'ship', arrival: 'fnc', minutes: 8 },
  { id: 'kyoshi_to_bss', from: 'kyoshi_island', to: 'bss', transport: 'rail_ferry', journey: 'rail_ferry', arrival: 'bss', minutes: 10 },
  { id: 'kyoshi_to_sat', from: 'kyoshi_island', to: 'sat', transport: 'bison', journey: 'bison', arrival: 'sat', minutes: 6 },
];

export function routeById(id: string): RouteDef | undefined {
  return ROUTES.find((r) => r.id === id);
}

export interface Placement {
  x: number;
  z: number;
  /** Explicit floor height (decks, ledges); default: ground. */
  y?: number;
  yaw: number;
}

export interface TravelPointDef {
  id: CityId;
  /** City name as shown in "Return to …". */
  city: string;
  /** Mainland region the point stands in. */
  region: string;
  transport: Transport;
  /** Where the traveller stands to talk / arrives back (faces the town). */
  stand: Placement;
  /** Prompt over the trigger. */
  prompt: string;
  /** One-line description in the travel dialog. */
  blurb: string;
  /** Staff NPC id and look (see src/travel/points.ts). */
  staff: { id: string; name: string; title: string };
}

/**
 * The four city travel points (one per city, in that city's style). Positions sit on open quay /
 * station / ledge paving next to existing features; see src/travel/points.ts for the props.
 */
export const TRAVEL_POINTS: Record<CityId, TravelPointDef> = {
  nwt: {
    id: 'nwt',
    city: 'the Northern Water Tribe',
    region: 'northern_water_tribe',
    transport: 'ship',
    stand: { x: -258.5, z: -1852, y: 5.5, yaw: 0 },
    prompt: 'Sail to Kyoshi Island',
    blurb: 'A Water Tribe trade ship sails south-east across the open sea to Koi Harbor.',
    staff: { id: 'travel_nwt_captain', name: 'Captain Kanaq', title: 'Trade Ship Captain' },
  },
  fnc: {
    id: 'fnc',
    city: 'the Fire Nation Capital',
    region: 'fire_nation_capital',
    transport: 'ship',
    stand: { x: -1468, z: 1772, yaw: 0 },
    prompt: 'Sail to Kyoshi Island',
    blurb: 'A merchant ship leaves First Lord’s Harbor for the Earth Kingdom isles and Koi Harbor.',
    staff: { id: 'travel_fnc_harbormaster', name: 'Harbormaster Rin', title: 'Passenger Berth' },
  },
  bss: {
    id: 'bss',
    city: 'Ba Sing Se',
    region: 'ba_sing_se',
    transport: 'rail_ferry',
    stand: { x: 490, z: -171.5, y: 26, yaw: Math.PI },
    prompt: 'Buy passage to Kyoshi Island',
    blurb: 'The monorail runs out through the Outer Wall to the coast, where a ferry crosses to Koi Harbor.',
    staff: { id: 'travel_bss_clerk', name: 'Clerk Bo', title: 'Island Ferries' },
  },
  sat: {
    id: 'sat',
    city: 'the Southern Air Temple',
    region: 'southern_air_temple',
    transport: 'bison',
    stand: { x: 1450.4, z: 1168.5, y: 348.2, yaw: -0.205 },
    prompt: 'Fly to Kyoshi Island',
    blurb: 'A saddled sky bison flies you over the sea of clouds to the meadow above Koi Bay.',
    staff: { id: 'travel_sat_keeper', name: 'Brother Tashi', title: 'Bison Keeper' },
  },
};

/** Arrival markers on Kyoshi Island: ships dock at Koi Harbor's passenger pier; bison land on the meadow. */
export const KYOSHI_ARRIVALS: Record<'ki_pier' | 'ki_meadow', Placement & { title: string; subtitle: string }> = {
  ki_pier: { ...A(0.82, KI.harbor.quayR + 6), yaw: yawOutward(0.82), title: 'Kyoshi Island', subtitle: 'Koi Harbor' },
  ki_meadow: { ...A(KI.meadow.u, KI.meadow.r - 6), yaw: yawOutward(KI.meadow.u) + Math.PI, title: 'Kyoshi Island', subtitle: 'The meadow above Koi Bay' },
};

/** The island's travel staff: ships (and the ferry) leave from the harbor, bison from the meadow. */
export const KYOSHI_STAFF = {
  harbormaster: { id: 'ki_harbormaster', name: 'Harbormaster Ayumi', title: 'Koi Harbor', transports: ['ship', 'rail_ferry'] as Transport[] },
  keeper: { id: 'ki_bison_keeper', name: 'Keeper Hana', title: 'Bison Meadow', transports: ['bison'] as Transport[] },
} as const;
