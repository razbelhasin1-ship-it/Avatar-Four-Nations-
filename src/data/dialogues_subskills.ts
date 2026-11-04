import type { MasterLook } from './masters';
import type { DialogueDef, NPCDef } from '../npc/NPCTypes';
import { SUB_SITES } from './quests_subskills';

/**
 * People and words of the specialized-bending quests (data only; scripted by
 * src/subskills/quests/QuestScripts.ts through the dialogue action { type: 'custom', id }).
 */

export const HAMA_LOOK: MasterLook = {
  seed: 911,
  role: 'elder',
  preset: 'fire_citizen',
  frame: 'slim',
  height: 0.9,
  build: 0.2,
  skin: '#d9b08c',
  hair: 'bun',
  hairColor: '#e9e9e9',
  facialHair: 'none',
  eyes: '#5b6f80',
  colors: { primary: '#7a3a2a', secondary: '#4a2a22', accent: '#c8a878', trim: '#2a1a14' },
};

/** NPCs (positions absolute; looks for Hama come from HAMA_LOOK). */
export const SUBSKILL_NPCS: Array<NPCDef & { look?: MasterLook }> = [
  {
    id: 'sq_hama',
    name: 'Hama',
    title: 'Innkeeper',
    role: 'villager',
    nation: 'fire',
    x: SUB_SITES.inn.x + 1.5,
    z: SUB_SITES.inn.z + 5.6,
    yaw: 0,
    behavior: { type: 'idle', variant: 'stand' },
    dialogue: 'dlg_hama',
    region: 'fire_nation_capital',
    condition: { notFlag: 'pm_hama_gone' },
    look: HAMA_LOOK,
  },
  {
    id: 'sq_hama_held',
    name: 'Hama',
    title: 'in the village lockup',
    role: 'villager',
    nation: 'fire',
    x: SUB_SITES.lockup.x,
    z: SUB_SITES.lockup.z,
    yaw: Math.PI,
    behavior: { type: 'idle', variant: 'sit' },
    dialogue: 'dlg_hama_held',
    region: 'fire_nation_capital',
    condition: { flag: 'pm_hama_gone' },
    look: HAMA_LOOK,
  },
  { id: 'sq_vil_ming', name: 'Ming', title: 'Villager', role: 'villager', nation: 'fire', appearanceSeed: 9121, x: SUB_SITES.village.x - 10, z: SUB_SITES.village.z + 14, behavior: { type: 'wander', radius: 5 }, dialogue: 'dlg_pm_villager', region: 'fire_nation_capital', schedule: 'day' },
  { id: 'sq_vil_toma', name: 'Toma', title: 'Fisherman', role: 'villager', nation: 'fire', appearanceSeed: 9122, x: SUB_SITES.village.x + 12, z: SUB_SITES.village.z - 9, behavior: { type: 'idle', variant: 'work' }, dialogue: 'dlg_pm_villager', region: 'fire_nation_capital', schedule: 'day' },
  { id: 'sq_vil_ren', name: 'Ren', title: 'Farmer', role: 'villager', nation: 'fire', appearanceSeed: 9123, x: SUB_SITES.village.x - 15, z: SUB_SITES.village.z - 12, behavior: { type: 'wander', radius: 6 }, dialogue: 'dlg_pm_villager', region: 'fire_nation_capital', schedule: 'day' },
];

const hamaIntro =
  'Oh! A traveller — come in, come in. There\'s a room free and the soup is hot. I\'m Hama. You\'d never guess it, but I was born in the Southern Water Tribe, a long, long time ago.';

export const SUBSKILL_DIALOGUES: DialogueDef[] = [
  {
    id: 'dlg_hama',
    start: [
      { node: 'gone', condition: { flag: 'pm_hama_gone' } },
      { node: 'night_hint', condition: { questActive: 'sq_puppetmaster', flag: 'pm_lesson_done', notFlag: 'pm_night' } },
      { node: 'lessons', condition: { questActive: 'sq_puppetmaster', flag: 'pm_met', notFlag: 'pm_lesson_done' } },
      { node: 'intro', condition: { questActive: 'sq_puppetmaster', notFlag: 'pm_met' } },
      { node: 'later' },
    ],
    nodes: {
      intro: {
        text: hamaIntro,
        actions: [{ type: 'setFlag', flag: 'pm_met' }],
        choices: [
          { text: 'The South? How did you end up here?', next: 'past' },
          { text: 'People say villagers vanish on full-moon nights.', next: 'vanish' },
        ],
      },
      past: {
        text: 'The Fire Nation came for the waterbenders of the South, one raid after another, until there were none left. They took me too. I\'ve lived among these people a long time now... a very long time.',
        next: 'offer',
      },
      vanish: {
        text: 'Yes... terrible, isn\'t it? Everyone bolts their doors when the moon is full. Stay inside on those nights, dear, and you\'ll be perfectly safe.',
        next: 'offer',
      },
      offer: {
        text: 'You\'re a waterbender — I can tell by the way you stand. Let an old woman teach you the Southern ways while you\'re here. It has been so long since I had a student.',
        choices: [
          { text: 'Teach me.', end: true, actions: [{ type: 'custom', id: 'hama_lesson' }] },
          { text: 'Maybe later.', end: true },
        ],
      },
      lessons: {
        text: 'Ready for another lesson? Water is everywhere, if you know how to look for it.',
        choices: [
          { text: 'Show me.', end: true, actions: [{ type: 'custom', id: 'hama_lesson' }] },
          { text: 'Not now.', end: true },
        ],
      },
      night_hint: {
        text: 'You learn quickly. Come to the woods by the hill on the night of the full moon — there is one more thing I want to show you. The most important thing.',
        choices: [
          { text: 'I\'ll be there. (Rest at the inn until the full moon.)', end: true, actions: [{ type: 'custom', id: 'rest_full_moon' }] },
          { text: 'I\'ll wait for it myself.', end: true },
        ],
      },
      gone: { text: 'The inn stands empty.', end: true },
      later: { text: 'Mind the woods at night, dear.', end: true },
    },
  },
  {
    id: 'dlg_hama_held',
    start: [
      { node: 'teach', condition: { questActive: 'sq_hama_custody', notFlag: 'pm_custody_taught' } },
      { node: 'bitter' },
    ],
    nodes: {
      teach: {
        text: 'So, the one who beat me without the ultimate technique. You came back. On the full moon, through these bars, I could still teach you. Do you want it?',
        choices: [
          { text: 'Teach me bloodbending.', end: true, actions: [{ type: 'custom', id: 'hama_custody_teach' }] },
          { text: 'No. I only came to see you.', next: 'bitter' },
        ],
      },
      bitter: { text: 'They took everything from me. Remember that, whatever you choose.', end: true },
    },
  },
  {
    id: 'dlg_pm_villager',
    start: [
      { node: 'freed', condition: { flag: 'pm_freed' } },
      { node: 'scared', condition: { questActive: 'sq_puppetmaster' } },
      { node: 'calm' },
    ],
    nodes: {
      scared: {
        text: 'My brother went out the night of the last full moon and never came back. Nobody does. We bolt the doors and pray to Agni the moon passes quickly.',
        choices: [{ text: 'I\'ll find out what is happening.', end: true }, { text: 'What about the innkeeper?', next: 'hama' }],
      },
      hama: { text: 'Old Hama? She\'s the kindest soul in the village. Always has soup for anyone.', end: true },
      freed: { text: 'They\'re home — all of them! You found them in the hill. We don\'t know how to thank you.', end: true },
      calm: { text: 'A quiet village. Mostly.', end: true },
    },
  },
];

/** Strain reactions added to Water Tribe elders and guards (data-driven; patched in by the scripts). */
export const STRAIN_DIALOGUE_NODES = {
  dark: {
    text: 'Stop. Something about you is wrong — the way the water around you goes still. You have touched the darkest art, haven\'t you? Keep your distance from my people.',
    end: true,
  },
  witnessed: {
    text: 'Word travels on the wind. They say you bent a body like a puppet under the moon. I hope it is not true.',
    end: true,
  },
  breaking: {
    text: 'Child — your hands are shaking. That art is eating at you. Sit with me. Breathe. Let the moon go.',
    choices: [
      { text: 'Meditate with the elder.', end: true, actions: [{ type: 'custom' as const, id: 'elder_meditate' }] },
      { text: 'Not now.', end: true },
    ],
  },
};
