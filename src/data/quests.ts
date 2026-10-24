import type { QuestDef } from '../quests/QuestTypes';
import { MAIN_QUESTS } from './quests_main';
import { SIDE_QUESTS } from './quests_side';

/**
 * Quest catalog. Opening quests auto-start based on the starting element.
 * Additional quest modules can export arrays merged here.
 */
export const QUESTS: QuestDef[] = [
  {
    id: 'mq_awakening_water',
    title: 'The Avatar Awakens: Water',
    category: 'main',
    summary: 'In the Northern Water Tribe, the elders sense something unusual about you.',
    region: 'northern_water_tribe',
    autoStart: { startingElement: 'water' },
    steps: [
      { id: 'meet', text: 'Speak with Elder Kanna in the Tribal Plaza.', objectives: [{ type: 'talk', npc: 'nwt_elder', text: 'Talk to Elder Kanna' }] },
      { id: 'draw', text: 'Draw water from the canal and practice your water lash.', objectives: [{ type: 'event', event: 'water:drawn', text: 'Draw water from a source', count: 1 }, { type: 'cast', element: 'water', count: 3, text: 'Use waterbending 3 times' }] },
      { id: 'avatar', text: 'Something stirs within you. Enter the Avatar State.', objectives: [{ type: 'avatarState', text: 'Activate the Avatar State' }] },
    ],
    rewards: { xp: 120, currency: 50, items: [{ id: 'sea_prunes', count: 5 }] },
  },
  {
    id: 'mq_awakening_earth',
    title: 'The Avatar Awakens: Earth',
    category: 'main',
    summary: 'In the Lower Ring of Ba Sing Se, an old earthbender notices the way the ground answers you.',
    region: 'ba_sing_se',
    autoStart: { startingElement: 'earth' },
    steps: [
      { id: 'meet', text: 'Speak with Old Man Shoji in the Lower Ring.', objectives: [{ type: 'talk', npc: 'bss_elder', text: 'Talk to Old Man Shoji' }] },
      { id: 'practice', text: 'Throw a few stones to prove yourself.', objectives: [{ type: 'cast', element: 'earth', count: 3, text: 'Use earthbending 3 times' }] },
      { id: 'avatar', text: 'The ground trembles with your heartbeat. Enter the Avatar State.', objectives: [{ type: 'avatarState', text: 'Activate the Avatar State' }] },
    ],
    rewards: { xp: 120, currency: 50, items: [{ id: 'cabbage', count: 5 }] },
  },
  {
    id: 'mq_awakening_fire',
    title: 'The Avatar Awakens: Fire',
    category: 'main',
    summary: 'In the Fire Nation Capital, a palace sage recognizes a fire unlike any other.',
    region: 'fire_nation_capital',
    autoStart: { startingElement: 'fire' },
    steps: [
      { id: 'meet', text: 'Speak with Sage Hira in the Royal Plaza.', objectives: [{ type: 'talk', npc: 'fn_elder', text: 'Talk to Sage Hira' }] },
      { id: 'practice', text: 'Show your control of fire.', objectives: [{ type: 'cast', element: 'fire', count: 4, text: 'Use firebending 4 times' }] },
      { id: 'avatar', text: 'The flame within roars. Enter the Avatar State.', objectives: [{ type: 'avatarState', text: 'Activate the Avatar State' }] },
    ],
    rewards: { xp: 120, currency: 50, items: [{ id: 'fire_flakes', count: 5 }] },
  },
  {
    id: 'mq_awakening_air',
    title: 'The Avatar Awakens: Air',
    category: 'main',
    summary: 'At the Southern Air Temple, the monks have long awaited the next Avatar.',
    region: 'southern_air_temple',
    autoStart: { startingElement: 'air' },
    steps: [
      { id: 'meet', text: 'Speak with Monk Tenzo in the temple courtyard.', objectives: [{ type: 'talk', npc: 'air_elder', text: 'Talk to Monk Tenzo' }] },
      { id: 'practice', text: 'Let the wind move through you.', objectives: [{ type: 'cast', element: 'air', count: 3, text: 'Use airbending 3 times' }, { type: 'event', event: 'player:glide', where: { active: true }, text: 'Glide (hold Jump while falling)', count: 1 }] },
      { id: 'avatar', text: 'The wind howls in answer. Enter the Avatar State.', objectives: [{ type: 'avatarState', text: 'Activate the Avatar State' }] },
    ],
    rewards: { xp: 120, currency: 50, items: [{ id: 'moon_peaches', count: 5 }] },
  },
  // [additive: training/quests] main line, element seek & mastery quests, hidden masters, side quests
  ...MAIN_QUESTS,
  ...SIDE_QUESTS,
];
