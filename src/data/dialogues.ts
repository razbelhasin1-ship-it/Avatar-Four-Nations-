import type { DialogueDef } from '../npc/NPCTypes';
import { LIFE_DIALOGUES } from './dialogues_life';

/** Dialogue catalog (see npc/NPCTypes.ts for the node format). */
export const DIALOGUES: DialogueDef[] = [
  {
    id: 'dlg_nwt_elder',
    start: [{ node: 'intro', condition: { questActive: 'mq_awakening_water' } }, { node: 'later' }],
    nodes: {
      intro: {
        text: 'There you are, child. The moon was strange last night, and the water in my bowl turned against the current when you passed. Some of the old ones are whispering a word I have not heard in a hundred years.',
        next: 'intro2',
      },
      intro2: {
        text: 'Avatar. If it is true, your path begins here — with water. Go to the Moon Fountain at the head of this plaza, or down the grand stairs to the canals, and call it to you. Water is never created, only guided. Remember that.',
        choices: [
          { text: 'I will try.', end: true },
          { text: 'And if I am the Avatar?', next: 'avatar' },
        ],
      },
      avatar: {
        text: 'Then one day you must learn all four elements, from masters across the world. But a river begins as a single drop. Go.',
        end: true,
      },
      later: { text: 'The tribe is proud of you. Travel safely — and keep your parka buttoned.', end: true },
    },
  },
  {
    id: 'dlg_swt_elder',
    start: [{ node: 'intro', condition: { questActive: 'mq_awakening_water_south' } }, { node: 'later' }],
    nodes: {
      intro: {
        text: 'So you are the one the ice keeps talking about. Three nights now the sea ice under the cove has cracked toward your igloo and nowhere else. The old women say it is a story. I say the ice does not tell stories.',
        next: 'intro2',
      },
      intro2: {
        text: 'If you are the Avatar, it begins with water — here, with us. Go to the Frozen Pond past the drying racks, or any fishing hole, and pull. Push. Shape it. Water is never made, child, only asked.',
        choices: [
          { text: 'I will go to the pond.', end: true },
          { text: 'And if I am the Avatar?', next: 'avatar' },
        ],
      },
      avatar: {
        text: 'Then one day you will learn all four, from masters across the world, and the North will want you too. But every voyage starts at a shore. Go.',
        end: true,
      },
      later: { text: 'Wolf Cove is proud of you. Keep your hood up and your water close.', end: true },
    },
  },
  {
    id: 'dlg_bss_guide',
    start: [{ node: 'intro' }],
    nodes: {
      intro: {
        text: 'Welcome, welcome, to Ba Sing Se! I am Lin Mei, and I will be your guide. Please show your papers at the passport counters — it only takes a moment.',
        next: 'intro2',
      },
      intro2: {
        text: 'The trains will carry you inward, ring by ring: the Lower Ring, the Middle Ring, and — with the proper invitation — the Upper Ring. Everyone here is so very happy. You will be too.',
        choices: [{ text: 'What is that hill across the lake?', next: 'lake' }, { text: 'Thank you.', end: true }],
      },
      lake: { text: 'Lake Laogai? A lovely, quiet lake. Nothing there at all. Shall we look at the farms instead?', end: true },
    },
  },
  {
    id: 'dlg_bss_elder',
    start: [{ node: 'intro', condition: { questActive: 'mq_awakening_earth' } }, { node: 'later' }],
    nodes: {
      intro: {
        text: 'Hm. You walk like the earth is listening to you. I felt that once — before my knees gave out. The stones in this street shifted when you stepped on them.',
        next: 'intro2',
      },
      intro2: {
        text: 'Pull a stone from the ground and throw it, like this. Be patient, then be decisive. That is earthbending.',
        choices: [{ text: 'Like this?', end: true }],
      },
      later: { text: 'The walls of this city have never fallen. Neither should you.', end: true },
    },
  },
  {
    id: 'dlg_fn_elder',
    start: [{ node: 'intro', condition: { questActive: 'mq_awakening_fire' } }, { node: 'later' }],
    nodes: {
      intro: {
        text: 'The palace lanterns flared when you entered the plaza. Fire recognizes its own — but this was more than a firebender. The Sages have been waiting a long time.',
        next: 'intro2',
      },
      intro2: {
        text: 'Fire is life, not only destruction. Show me control: quick, precise strikes. Breathe.',
        choices: [{ text: 'I am ready.', end: true }],
      },
      later: { text: 'Agni watches over you, young one.', end: true },
    },
  },
  {
    id: 'dlg_air_elder',
    start: [{ node: 'intro', condition: { questActive: 'mq_awakening_air' } }, { node: 'later' }],
    nodes: {
      intro: {
        text: 'Ah, you finally came down from the bison stables. Sit with me a moment... The wind changed direction when you were born. We monks noticed. We always notice.',
        next: 'intro2',
      },
      intro2: {
        text: 'Push the air with your palms, then leap from the terrace and let it carry you. Fear is heavy; leave it behind.',
        choices: [{ text: 'Leap from the terrace?!', next: 'fear' }, { text: 'I will fly.', end: true }],
      },
      fear: { text: 'Hold your jump as you fall. The wind will catch you. It always has.', end: true },
      later: { text: 'May the wind be at your back.', end: true },
    },
  },
  // [additive: quests/NPC life] side-quest givers and city flavour dialogues
  ...LIFE_DIALOGUES,
];
