import type { Element } from '../core/types';
import { HOMELAND_STARTS, STARTS, type StartDef } from '../world/WorldLayout';

/**
 * Where a journey begins ("Begin your journey as the Avatar"): one start per element, and two
 * homelands for Water. The chosen option is saved as the journey's origin (Progression.origin) and
 * set as the story flag `origin_<id>` so dialogue can react to it. Shared code asks for a start by
 * origin id (originStart), never by "Northern"/"Southern".
 */
export type OriginId = 'earth' | 'air' | 'fire' | 'water_north' | 'water_south';

export interface StartOption {
  id: OriginId;
  element: Element;
  /** Homeland shown on the Water step (null: the element has a single start). */
  homeland: string | null;
  /** Zone, landmark, spawn point, facing and the "Begin your journey in ..." line. */
  start: StartDef;
  /** Master named on the card (MASTERS id) and the opening quest (QUESTS id). */
  master: string;
  quest: string;
  /** Card preview: the menu tour's snapshot of the start (MainMenu getVista id). */
  vista: string;
  /** Card copy: the "Begin your journey ..." line and the short description. */
  where: string;
  desc: string;
}

export const START_OPTIONS: readonly StartOption[] = [
  {
    id: 'earth',
    element: 'earth',
    homeland: null,
    start: STARTS.earth,
    master: 'master_lien',
    quest: 'mq_awakening_earth',
    vista: 'earth',
    where: 'Begin your journey in Ba Sing Se',
    desc: 'Start in the Earth Kingdom’s great walled city. Grounding, defence, precision and powerful impacts.',
  },
  {
    id: 'air',
    element: 'air',
    homeland: null,
    start: STARTS.air,
    master: 'master_tenzo',
    quest: 'mq_awakening_air',
    vista: 'air',
    where: 'Begin your journey at an Air Temple',
    desc: 'Start at a mountain temple above the clouds. Agility, evasion, air currents and aerial movement.',
  },
  {
    id: 'fire',
    element: 'fire',
    homeland: null,
    start: STARTS.fire,
    master: 'master_jeong',
    quest: 'mq_awakening_fire',
    vista: 'fire',
    where: 'Begin your journey in the Fire Nation Capital',
    desc: 'Start among the capital’s grand architecture and royal palace. Aggressive combinations and controlled bursts.',
  },
  {
    id: 'water_south',
    element: 'water',
    homeland: 'Southern Water Tribe',
    start: HOMELAND_STARTS.water_south,
    master: 'master_aput',
    quest: 'mq_awakening_water_south',
    vista: 'water_south',
    where: 'Begin your journey in the Southern Water Tribe',
    desc: 'Start in Wolf Cove, a walled village of igloos on the southern ice. Flowing attacks, redirection, water whips and ice.',
  },
  {
    id: 'water_north',
    element: 'water',
    homeland: 'Northern Water Tribe',
    start: STARTS.water,
    master: 'master_siku',
    quest: 'mq_awakening_water',
    vista: 'water',
    where: 'Begin your journey in the Northern Water Tribe',
    desc: 'Start in a polar city of ice and canals. Flowing attacks, redirection, water whips and ice.',
  },
];

export const ORIGIN_IDS: readonly OriginId[] = START_OPTIONS.map((o) => o.id);

export function isOrigin(v: unknown): v is OriginId {
  return typeof v === 'string' && (ORIGIN_IDS as readonly string[]).includes(v);
}

/** The element's start when no homeland was chosen (Water: the Northern Water Tribe, as before). */
export function defaultOrigin(e: Element): OriginId {
  return e === 'water' ? 'water_north' : e;
}

export function startOption(origin: OriginId): StartOption {
  return START_OPTIONS.find((o) => o.id === origin)!;
}

/** The start for a journey's origin (falls back to the element's default start). */
export function originStart(origin: string | null | undefined, element: Element): StartDef {
  return startOption(isOrigin(origin) && startOption(origin).element === element ? origin : defaultOrigin(element)).start;
}

/** The homeland options of an element (Water: South then North; others: one). */
export function homelandsOf(e: Element): StartOption[] {
  return START_OPTIONS.filter((o) => o.element === e);
}
