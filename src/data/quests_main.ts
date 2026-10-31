import { ELEMENTS, ELEMENT_INFO, type Element } from '../core/types';
import type { QuestDef } from '../quests/QuestTypes';

/** Mirrors progression MASTERY_REQUIREMENTS (kept local: data must not import runtime modules). */
const MASTERY_REQUIREMENTS: Record<Element, { proficiency: number; lessons: number; trialName: string }> = {
  air: { proficiency: 320, lessons: 3, trialName: 'Trial of the Four Winds' },
  water: { proficiency: 320, lessons: 3, trialName: 'Trial of the Ocean and Moon' },
  earth: { proficiency: 320, lessons: 3, trialName: 'Trial of the Unmoving Mountain' },
  fire: { proficiency: 320, lessons: 3, trialName: 'Trial of the Eternal Flame' },
};

/**
 * Main line "The Avatar Cycle" (one variant per starting element), the
 * "seek the other nations" quests, per-element mastery quests and the hidden
 * masters' discovery quests. Flags used here are set by src/training/TrainingSystem.ts
 * (avatar_awakened, lessons3_<e>, proficient_<e>, clue_*) and quest props (src/data/quests_props.ts).
 */

const NATION_START: Record<Element, { landmark: string; place: string; first: string; firstName: string; where: string }> = {
  air: { landmark: 'air_temple', place: 'the Southern Air Temple', first: 'master_tenzo', firstName: 'Monk Tenzo', where: 'in the moon-gate training courtyard' },
  water: { landmark: 'nwt_plaza', place: 'the Northern Water Tribe', first: 'master_siku', firstName: 'Master Siku', where: 'in the Waterbending Courtyard' },
  earth: { landmark: 'bss_lower_ring', place: 'Ba Sing Se', first: 'master_lien', firstName: 'Master Lien', where: 'at the Stone Fist Dojo' },
  fire: { landmark: 'fn_plaza', place: 'the Fire Nation Capital', first: 'master_jeong', firstName: 'Master Jeong', where: 'in the Royal Plaza drill yard' },
};

/** Who the main line sends you to first for your starting element. */
const START_MASTER: Record<Element, { id: string; name: string; where: string }> = {
  air: { id: 'master_tenzo', name: 'Monk Tenzo', where: 'in the moon-gate training courtyard' },
  water: { id: 'master_siku', name: 'Master Siku', where: 'in the Waterbending Courtyard' },
  earth: { id: 'master_lien', name: 'Master Lien', where: 'at the Stone Fist Dojo' },
  fire: { id: 'master_hira', name: 'Sage Hira', where: 'in the High Temple court in Hari Bulkan' },
};

const GRAND: Record<Element, { id: string; name: string }> = {
  air: { id: 'master_pasang', name: 'Abbot Pasang' },
  water: { id: 'master_siku', name: 'Master Siku' },
  earth: { id: 'master_bumo', name: 'King Bumo' },
  fire: { id: 'master_ahkon', name: 'Sun Chief Ahkon' },
};

const bender = (e: Element) => `${ELEMENT_INFO[e].name.toLowerCase()}bending`;

/** The Avatar cycle. The "seek" quests start in this order after the start element; the first one is tracked. */
const CYCLE: Element[] = ['water', 'earth', 'fire', 'air'];

function avatarCycle(start: Element): QuestDef {
  const sm = START_MASTER[start];
  const others = ELEMENTS.filter((e) => e !== start);
  const ci = CYCLE.indexOf(start);
  const seekOrder = [1, 2, 3].map((k) => CYCLE[(ci + k) % CYCLE.length]);
  return {
    id: `mq_avatar_cycle_${start}`,
    title: 'The Avatar Cycle',
    category: 'main',
    summary: 'Water, earth, fire, air. The Avatar must learn all four from those who love them most — and master each before the Elements Sphere will answer.',
    autoStart: { startingElement: start, flag: 'avatar_awakened' },
    steps: [
      { id: 'meet', text: `Your first true teacher waits: find ${sm.name} ${sm.where}.`, objectives: [{ type: 'talk', npc: sm.id, text: `Meet ${sm.name}` }] },
      { id: 'learn', text: `Complete a lesson with ${sm.name}. Masters demonstrate, then test you on their training ground.`, objectives: [{ type: 'training', master: sm.id, text: `Complete a lesson with ${sm.name}` }] },
      {
        id: 'nations',
        text: 'Seek the other nations. A master of each element can awaken it in you.',
        onStart: seekOrder.map((e) => ({ type: 'startQuest' as const, quest: `mq_seek_${e}` })),
        objectives: others.map((e) => ({ type: 'element' as const, element: e, text: `Learn ${bender(e)}` })),
      },
      {
        id: 'mastery',
        text: 'Master each element: three lessons, true proficiency, and a grandmaster\'s trial for each.',
        objectives: ELEMENTS.map((e) => ({ type: 'master' as const, element: e, text: `Master ${bender(e)}` })),
      },
      { id: 'sphere', text: 'The past Avatars have spoken. Enter the Avatar State — all four elements will answer as one.', objectives: [{ type: 'avatarState', sphere: true, text: 'Summon the Elements Sphere (Avatar State)' }] },
    ],
    rewards: { xp: 1500, currency: 500, cosmetics: ['avatar_robe'] },
  };
}

function seek(e: Element): QuestDef {
  const n = NATION_START[e];
  return {
    id: `mq_seek_${e}`,
    title: `Seek the ${ELEMENT_INFO[e].nation}`,
    category: 'main',
    summary: `${ELEMENT_INFO[e].name} waits for the Avatar in ${n.place}. ${n.firstName} can awaken it in you.`,
    // `any` + the element objective: a player who already awakened it elsewhere is not sent back.
    steps: [
      { id: 'travel', text: `Travel to ${n.place}.`, any: true, objectives: [{ type: 'reach', landmark: n.landmark, radius: 120, text: `Reach ${n.place}` }, { type: 'element', element: e, text: `Awaken ${bender(e)}` }] },
      { id: 'meet', text: `Find ${n.firstName} ${n.where}.`, any: true, objectives: [{ type: 'talk', npc: n.first, text: `Talk to ${n.firstName}` }, { type: 'element', element: e, text: `Awaken ${bender(e)}` }] },
      { id: 'awaken', text: `Pass ${n.firstName}'s awakening lesson.`, objectives: [{ type: 'element', element: e, text: `Awaken ${bender(e)}` }] },
    ],
    rewards: { xp: 200, currency: 60 },
  };
}

function mastery(e: Element): QuestDef {
  const g = GRAND[e];
  const req = MASTERY_REQUIREMENTS[e];
  return {
    id: `mq_mastery_${e}`,
    title: `Path of the ${ELEMENT_INFO[e].name} Master`,
    category: 'mastery',
    summary: `Mastery is not knowing techniques. Earn ${req.lessons} master lessons and true proficiency in ${bender(e)}, then pass the ${req.trialName}.`,
    autoStart: { element: e, flag: 'avatar_awakened' },
    steps: [
      {
        id: 'prepare',
        text: `Learn from ${ELEMENT_INFO[e].name} masters and bend in earnest (Journal → Element Mastery shows your progress).`,
        objectives: [
          { type: 'flag', flag: `lessons3_${e}`, text: `Complete ${req.lessons} master lessons` },
          { type: 'flag', flag: `proficient_${e}`, text: `Reach ${req.proficiency} ${bender(e)} proficiency` },
        ],
      },
      { id: 'grandmaster', text: `${g.name} will judge you.`, objectives: [{ type: 'talk', npc: g.id, text: `Go to ${g.name}` }] },
      { id: 'trial', text: `Pass the ${req.trialName}.`, objectives: [{ type: 'master', element: e, text: req.trialName }] },
    ],
    rewards: { xp: 400, currency: 150 },
  };
}

export const MAIN_QUESTS: QuestDef[] = [
  ...ELEMENTS.map(avatarCycle),
  ...ELEMENTS.map(seek),
  ...ELEMENTS.map(mastery),
  // ---- hidden masters ----
  {
    id: 'sq_hermit',
    title: 'Where the Four Winds Meet',
    category: 'exploration',
    summary: 'Brother Iio spoke of a hermit beyond the temple gate who left his teachings on a wind-worn tablet.',
    region: 'southern_air_temple',
    steps: [
      { id: 'tablet', text: 'Find the wind-worn tablet near the temple gate and read it.', objectives: [{ type: 'flag', flag: 'clue_hermit', text: 'Read the wind-worn tablet' }] },
      { id: 'shrine', text: 'Follow the ledge east of the temple to the Shrine of the Four Winds.', objectives: [{ type: 'reach', landmark: 'wind_shrine', radius: 30, text: 'Reach the Shrine of the Four Winds' }] },
      { id: 'meet', text: 'Speak with the Hermit of the Four Winds.', objectives: [{ type: 'talk', npc: 'master_hermit', text: 'Talk to the Hermit' }] },
    ],
    rewards: { xp: 150, items: [{ id: 'air_scroll', count: 1 }] },
  },
  {
    id: 'sq_huu',
    title: 'The Sage of the Swamp',
    category: 'exploration',
    summary: 'A swamp waterbender once traded in Riverbend Village. His journal might lead to the Great Banyan Tree.',
    region: 'foggy_swamp',
    steps: [
      { id: 'journal', text: 'Find the swamp-stained journal in Riverbend Village.', objectives: [{ type: 'flag', flag: 'clue_huu', text: 'Read the swamp-stained journal' }] },
      { id: 'swamp', text: 'Travel into the Foggy Swamp, to the Great Banyan Tree.', objectives: [{ type: 'reach', landmark: 'banyan_tree', radius: 110, text: 'Reach the Great Banyan Tree' }] },
      { id: 'meet', text: 'Find the sage on the shore of the banyan lake.', objectives: [{ type: 'talk', npc: 'master_huu', text: 'Talk to Huu' }] },
    ],
    rewards: { xp: 150, items: [{ id: 'glowing_mushroom', count: 3 }] },
  },
  {
    id: 'sq_lin',
    title: 'The Blind Bandit',
    category: 'exploration',
    summary: 'Gaoling\'s Earth Rumble has an undefeated champion. Some say she sees with her feet.',
    region: 'earth_heartland',
    steps: [
      { id: 'poster', text: 'Find an Earth Rumble poster in the Gaoling market.', objectives: [{ type: 'flag', flag: 'clue_lin', text: 'Read the Earth Rumble poster' }] },
      { id: 'meet', text: 'Find the champion at the Earth Rumble ring.', objectives: [{ type: 'talk', npc: 'master_lin', text: 'Talk to Lin the Blind' }] },
    ],
    rewards: { xp: 150, currency: 40 },
  },
];
