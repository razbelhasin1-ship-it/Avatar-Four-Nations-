import type { Element } from '../core/types';
import type { FeatureName } from '../core/features';

/**
 * Specialized bending (sub-skills): lavabending (Earth), spiritual projection (Air) and
 * bloodbending (Water). Every tunable number lives in the constants right below; the SUB_SKILLS
 * table holds the branch definitions (parent element, requirements, unlock quest, moves, tooltip
 * and codex text, Legend of Korra flags). Runtime: src/subskills/, moves: src/combat/techniques/sub/.
 *
 * Sources, in order of trust: The Last Airbender episodes ("The Puppetmaster", "The Southern
 * Raiders", "Winter Solstice" Parts 1-2, "The Avatar and the Fire Lord", "The Siege of the North"),
 * the Avatar Wiki, then the design brief. Legend of Korra material only where flagged.
 */

// ---------------------------------------------------------------------------------------------
// Tuning (all numbers). Master-tier moves for comparison: ~26-40 chi, 4-8 s cooldown, 100 max chi.
// ---------------------------------------------------------------------------------------------

/** Lunar cycle and the moon's pull on waterbending. Hours are in-game hours (0-24). */
export const MOON = {
  /** In-game nights per lunar cycle (one full-moon night each cycle). */
  cycleNights: 8,
  /** Night index (0 = the first night of a new game) of the first full moon. */
  firstFullNight: 5,
  /** The moon is up from moonrise to sunrise. */
  moonriseHour: 18.5,
  sunriseHour: 6,
  /** Waterbending power while the moon is up (any phase but the new moon). */
  boostMoonUp: 1.1,
  /** Waterbending power on the full-moon night. */
  boostFullMoon: 1.25,
  /** Days per year; the two solstices fall on these days of the year (spirits draw near). */
  yearDays: 56,
  solsticeDays: [14, 42] as readonly number[],
} as const;

/** Lavabending. Costs are ~1.5-2.5x a comparable master move; cooldowns are long. */
export const LAVA = {
  /** Earth must lie within this distance of the point you melt (a little is enough). */
  earthProbe: 3,
  /** Loose stones / rubble within this distance let you melt on ice, snow or metal floors. */
  looseStoneReach: 6,
  /** Simultaneous lava patches you can keep alive (oldest cools first). World lava is separate. */
  maxPlayerPatches: 3,
  /** Spreading cells a patch may add while it lives (capped), and how often it tries. */
  maxSpreadCells: 5,
  spreadEvery: 0.9,
  /** Seconds a fresh patch lasts before it crusts over into stone. */
  patchLife: 7,
  /** Damage per tick to anything standing in lava (environment: hurts you and allies too). */
  tickDamage: 6,
  tickEvery: 0.5,
  /** Cooled lava leaves stone for this long (walkable, liftable). */
  stoneLife: 45,
  melt: { chi: 45, cooldown: 8, range: 12, radius: 2.3 },
  disc: { chi: 55, cooldown: 9, range: 18, damage: 34, speed: 26, pierce: 3 },
  pool: { chi: 60, cooldown: 14, range: 16, radius: 2.6, life: 5 },
  stream: { chi: 65, cooldown: 14, range: 18, length: 16, speed: 9, radius: 1.1 },
  moat: { chi: 75, cooldown: 22, radius: 4.6, width: 1.2, life: 8, columnRange: 9 },
  cool: { chi: 40, cooldown: 6, range: 14, radius: 4.5 },
  eruption: { chi: 90, cooldown: 45, range: 30, radius: 11, delay: 1.6, vents: 7, damage: 26 },
  /** Enemies treat this much distance from lava as unsafe and step out. */
  enemyAvoid: 1.4,
} as const;

/** Spiritual projection (scouting only: no attacks, no bending, no carrying). */
export const PROJECTION = {
  chi: 50,
  cooldown: 30,
  /** Seconds of quiet meditation before the spirit leaves the body. */
  meditateTime: 2.5,
  focusMax: 100,
  /** Focus drained per second while projecting (about 45 s), and the spiritual-place multiplier. */
  focusDrain: 2.2,
  spiritualDrainMul: 0.5,
  solsticeDrainMul: 0.6,
  /** Local roaming is limited to this distance from the body (Bond Lock can go farther). */
  roamRadius: 100,
  spiritSpeed: 7,
  spiritClimb: 4,
  /** Bond Lock: seconds to reach a bonded character, focus spent. */
  bondTravel: 3,
  bondFocus: 20,
  callOutFocus: 15,
  /** Quiet: no aware hostile this close, at most this many people this close. */
  quietHostileRadius: 25,
  crowdRadius: 12,
  crowdMax: 6,
  /** Meditation breaks if a hostile comes this close. */
  disturbRadius: 15,
  /** Return along the streak of light: seconds. */
  returnTime: 1.1,
  /** Places strong in spiritual energy: [x, z, radius]; the Air Temple sanctuary and the Spirit Oasis are added from landmarks. */
  spiritualRadius: 40,
} as const;

/** Bloodbending (The Last Airbender level). */
export const BLOOD = {
  hold: { chi: 40, cooldown: 16, range: 14 },
  /** Continuous chi per held target per second. */
  chiPerSecond: 9,
  puppet: { chi: 15, cooldown: 1.5, speed: 2.2, leash: 7 },
  redirect: { chi: 20, cooldown: 4, range: 14 },
  /** Water proficiency needed for the Second Hold (master tier is 320). */
  secondHoldProficiency: 480,
  /** Taking this much damage in one hit breaks your concentration. */
  breakOnDamage: 1,
  /** Resist check: seconds of struggle shown before an equal or stronger waterbender breaks free. */
  struggleTime: 1.6,
  lift: { chi: 30, cooldown: 10, height: 1.6, launch: 6 },
} as const;

/** Moral Strain (bloodbending): 0-100. */
export const STRAIN = {
  max: 100,
  unease: 25,
  dark: 55,
  breaking: 85,
  /** Added when a hold starts, and per second held: against hostiles / against anyone else. */
  holdStartHostile: 4,
  holdStartInnocent: 10,
  perSecondHostile: 0.8,
  perSecondInnocent: 2.5,
  redirect: 3,
  vowBroken: 35,
  /** Falls: per in-game hour of not bloodbending (rest), per meditation, per completed quest. */
  restPerHour: 0.4,
  meditation: 12,
  goodDeed: 5,
  /** Meditating with an elder brings strain down to this and lifts the Breaking lock. */
  elderFloor: 15,
  /** People this close who can see a hold witness it. */
  witnessRadius: 25,
} as const;

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

export type SubSkillId = 'lava' | 'projection' | 'blood';

export interface SubSkillAbility {
  technique: string;
  /** One line of lore for the tooltip. */
  lore: string;
}

export interface SubSkillDef {
  id: SubSkillId;
  parent: Element;
  name: string;
  /** Short line under the name on the branch card. */
  tagline: string;
  requirements: { masteredParent: true; quest: string };
  /** Quest that unlocks it (never XP alone). */
  unlockQuest: string;
  /** Hint shown on the locked branch card. */
  questHint: string;
  abilities: SubSkillAbility[];
  tooltip: string;
  codex: { id: string; title: string; text: string };
  /** Legend of Korra extensions (all default off: src/core/features.ts). */
  flags: Array<{ name: FeatureName; label: string }>;
  /** Story flag set when the branch is unlocked. */
  unlockedFlag: string;
}

export const SUB_SKILLS: Record<SubSkillId, SubSkillDef> = {
  lava: {
    id: 'lava',
    parent: 'earth',
    name: 'Lavabending',
    tagline: 'Melt earth into lava, steer it, cool it back into stone.',
    requirements: { masteredParent: true, quest: 'sq_heart_of_the_mountain' },
    unlockQuest: 'sq_heart_of_the_mountain',
    questHint: 'Master earthbending, then ask Master Lien about the old legends. No one teaches this art: it wakes under pressure, deep in the lava tunnels beneath the Fire Nation capital.',
    abilities: [
      { technique: 'lava_melt', lore: 'Only a little earth is needed; Bolin found the art by turning a lava wave back into stone.' },
      { technique: 'lava_disc', lore: 'Ghazan of the Red Lotus spun three bits of earth into molten shuriken that burned through wood.' },
      { technique: 'lava_pool', lore: 'The ground under a foe softens and glows: move, or burn.' },
      { technique: 'lava_stream', lore: 'Lava moves like slow water, and so does a lavabender.' },
      { technique: 'lava_moat', lore: 'Ghazan ringed himself in lava to keep his attackers at bay.' },
      { technique: 'lava_cool', lore: 'Avatar Roku diverted a lava flow to save the people of his island.' },
      { technique: 'lava_eruption', lore: 'Avatar Szeto erupted four volcanoes at once. Avatars only, and only in the Avatar State.' },
    ],
    tooltip: 'Rare earthbending sub-skill. Needs earth within reach; scarce on ice, snow and metal. Lava spreads a little and burns anyone, you included, until it cools.',
    codex: {
      id: 'lore_lavabending',
      title: 'Lavabending',
      text:
        'A rare earthbending sub-skill: the bender melts earth into lava, steers flows that already exist and cools lava back into stone. Avatars showed it first. Kyoshi split her peninsula from the mainland with fissures and lava; Szeto erupted four volcanoes at once; Roku diverted a lava flow to save his island when its volcano woke ("The Avatar and the Fire Lord"), and, through Aang, brought down the Fire Temple on Crescent Island with a pillar of lava ("Winter Solstice, Part 2: Avatar Roku"). Generations later Ghazan of the Red Lotus fought with lava shuriken, pools and moats, and Bolin awakened the art under pressure by turning a lava wave back into solid earth (The Legend of Korra). Only a little earth is needed; the movements are fluid, like waterbending. Left alone, lava spreads and keeps burning, like fire, until it cools.',
    },
    flags: [],
    unlockedFlag: 'subskill_lava',
  },
  projection: {
    id: 'projection',
    parent: 'air',
    name: 'Spiritual Projection',
    tagline: 'Leave the body behind and travel as spirit.',
    requirements: { masteredParent: true, quest: 'sq_silent_mind' },
    unlockQuest: 'sq_silent_mind',
    questHint: 'Master airbending, then return to Monk Tenzo at the Southern Air Temple. The art needs a silent mind, a silent place and a strong bond with the spirit world.',
    abilities: [
      { technique: 'spirit_project', lore: 'Aang\'s spirit left his body at the Spirit Oasis while Katara stood guard over it.' },
      { technique: 'spirit_sight', lore: 'Jinora explored the sealed ruins under Lake Laogai without leaving the city.' },
      { technique: 'spirit_bond', lore: 'A projected spirit can find the people it loves, across any distance.' },
      { technique: 'spirit_call', lore: 'Jinora called for help and was heard by those who knew her.' },
      { technique: 'spirit_return', lore: 'When Zuko carried his body away, Aang\'s spirit followed a streak of light back to it.' },
    ],
    tooltip: 'Master airbenders with a strong spiritual connection can send their spirit out of the body to scout. No attacks, no bending; the body sits defenseless.',
    codex: {
      id: 'lore_spiritual_projection',
      title: 'Spiritual Projection',
      text:
        'A sub-skill of master airbenders with a deep spiritual connection. The spirit leaves the body, passes through walls and solid matter, moves under water, speaks with people as it would in person, crosses great distances in moments and can find someone it shares a strong bond with. It demands a silent place free of distractions and immense focus, and is strongest when spiritual energy runs high: at the solstice, or in places like the Spirit Oasis. It has no power to harm; it is a way of seeing. In "The Siege of the North", Aang\'s body sat guarded at the Spirit Oasis while his spirit was away, and when Zuko carried the body off, the spirit was stranded until it returned along a streak of light. The Air Nomad Mangal practised the art in Kyoshi\'s era; long after, Jinora used it to explore the Dai Li ruins under Lake Laogai, to call for help and to overhear the Red Lotus (The Legend of Korra).',
    },
    flags: [],
    unlockedFlag: 'subskill_projection',
  },
  blood: {
    id: 'blood',
    parent: 'water',
    name: 'Bloodbending',
    tagline: 'Seize the water in a living body. The darkest art.',
    requirements: { masteredParent: true, quest: 'sq_puppetmaster' },
    unlockQuest: 'sq_puppetmaster',
    questHint: 'Master waterbending. On full-moon nights, people vanish from a Fire Nation village — and a kindly old innkeeper there knows the Southern ways.',
    abilities: [
      { technique: 'blood_hold', lore: 'Hama learned it in a Fire Nation prison, practising on the rats in her cell under the full moon.' },
      { technique: 'blood_puppet', lore: 'Hama moved like a puppeteer, rigid and abrupt; Katara\'s motions stayed fluid.' },
      { technique: 'blood_redirect', lore: 'A bloodbender cannot make a victim bend, but can stop a bending act or turn an attack aside.' },
      { technique: 'blood_second', lore: 'Hama held Aang and Sokka at once and made them attack Katara.' },
      { technique: 'blood_release', lore: 'Katara vowed never to use it again — and broke that vow only once.' },
    ],
    tooltip: 'Full moon only: every hold ends at sunrise. Never harms by itself. A waterbender of equal skill can break free, and the Avatar State nullifies it. Every use strains the mind.',
    codex: {
      id: 'lore_bloodbending',
      title: 'Bloodbending',
      text:
        'Hama of the Southern Water Tribe invented it in a Fire Nation prison: under the full moon she practised on the rats in her cell until she could seize the water in a guard\'s body and walk out. A very advanced waterbender takes hold of the water inside a living body and moves its muscles; the victim stays fully aware but cannot control their body, and cannot be made to bend, though a bending act can be stopped or an attack turned aside. It works only under the full moon, and the hold fades at sunrise. A waterbender of equal or greater skill can break the hold, as Katara broke Hama\'s by drawing on the moon, and the Avatar State nullifies it. In "The Puppetmaster" Hama taught it to Katara and held Aang and Sokka at once; Katara vowed never to use it again, broke that vow once in "The Southern Raiders", and later saw it outlawed. It is the only bending art known to endanger the bender\'s own mind. It leaves no lasting harm.',
    },
    flags: [
      { name: 'ENABLE_MOONLESS_BLOODBENDING', label: 'Moonless bloodbending (Legend of Korra extension): usable without the full moon after a long, rare training quest.' },
      { name: 'ENABLE_PSYCHIC_BLOODBENDING', label: 'Psychic bloodbending (Legend of Korra extension): no hand motions, barely moving; it can only subdue.' },
      { name: 'ENABLE_BLOODBENDING_LIFT', label: 'Bloodbending lift (Legend of Korra extension): levitate a held body and launch it a short distance.' },
    ],
    unlockedFlag: 'subskill_blood',
  },
};

export const SUB_SKILL_IDS: SubSkillId[] = ['lava', 'projection', 'blood'];

/** Legend of Korra-only moves: hidden and unusable while their flag is off. */
export const KORRA_TECHNIQUES: Record<string, FeatureName> = {
  blood_psychic: 'ENABLE_PSYCHIC_BLOODBENDING',
  blood_lift: 'ENABLE_BLOODBENDING_LIFT',
};

// ---------------------------------------------------------------------------------------------
// Reactions (data-driven): how people and creatures respond to the three arts.
// ---------------------------------------------------------------------------------------------

export type ReactionTrigger = 'lava' | 'lavaMoat' | 'spirit' | 'bloodHold' | 'strainDark';

export interface ReactionDef {
  trigger: ReactionTrigger;
  /** Who reacts: enemies, civilians (npc), creatures, spirit-sensitive people. */
  who: 'enemy' | 'npc' | 'creature' | 'spiritSensitive';
  /** What they do. */
  response: 'avoid' | 'panic' | 'wonder' | 'fear' | 'flee' | 'hostile';
  radius: number;
  /** Lines one of them may say (toast), picked at random. */
  lines?: string[];
}

export const REACTIONS: ReactionDef[] = [
  { trigger: 'lava', who: 'enemy', response: 'avoid', radius: LAVA.enemyAvoid },
  { trigger: 'lavaMoat', who: 'enemy', response: 'panic', radius: 7, lines: ['Lava! Fall back!', 'Get away from the lava!', 'It melts the ground itself!'] },
  { trigger: 'lava', who: 'npc', response: 'flee', radius: 14, lines: ['The ground is burning!', 'Run!'] },
  { trigger: 'spirit', who: 'spiritSensitive', response: 'wonder', radius: 8, lines: ['A spirit... no, a person? You glow like the moon.', 'I can see you. You are not really here, are you?'] },
  { trigger: 'bloodHold', who: 'npc', response: 'fear', radius: STRAIN.witnessRadius, lines: ['What are you doing to them?!', 'Their arms — they are moving on their own!', 'Spirits protect us...'] },
  { trigger: 'bloodHold', who: 'enemy', response: 'hostile', radius: STRAIN.witnessRadius },
  { trigger: 'strainDark', who: 'npc', response: 'fear', radius: 6, lines: ['Stay back.', 'Something is wrong with you.', 'Please... just go.'] },
];

/** Moral Strain stages, shown on the meter (it appears only after the first bloodbending use). */
export const STRAIN_STAGES: Array<{ id: 'calm' | 'unease' | 'dark' | 'breaking'; label: string; min: number; note: string }> = [
  { id: 'calm', label: 'Calm', min: 0, note: 'Your mind is your own.' },
  { id: 'unease', label: 'Unease', min: STRAIN.unease, note: 'Faint whispers. People sense that something is off.' },
  { id: 'dark', label: 'Dark', min: STRAIN.dark, note: 'People fear you. Some will not help you; Water Tribe elders and guards notice.' },
  { id: 'breaking', label: 'Breaking', min: STRAIN.breaking, note: 'Bloodbending is locked until you meditate with an elder.' },
];

/** Moon phase names, index 0 (new) .. 4 (full) .. 7 (waning crescent). */
export const MOON_PHASES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'] as const;
