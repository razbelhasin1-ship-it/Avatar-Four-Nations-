import type { QuestDef } from '../quests/QuestTypes';

/**
 * Unlock quests for the specialized-bending branches (data/subskills.ts). Each starts only after
 * the parent element is mastered (flag subskill_<id>_eligible, set by SubSkillSystem); the beats
 * are scripted by src/subskills/quests/QuestScripts.ts (which sets the flags these steps wait on);
 * the places are built by src/subskills/quests/sites.ts.
 */

/** Places (world coordinates) shared with the scripts and the site builder. */
export const SUB_SITES = {
  /** Lava tunnels: a rock mound at the north-west foot of the Fire Nation capital's volcano. */
  tunnels: { x: -1620, z: 690, yaw: 0 },
  /** Hama's village: a hamlet west of the capital, the cave prison in the hill to its east. */
  village: { x: -1790, z: 800 },
  inn: { x: -1790, z: 800 },
  prison: { x: -1716, z: 806 },
  clearing: { x: -1752, z: 784 },
  /** Hama's lockup after the fight (refusal path: visit her in custody). */
  lockup: { x: -1808, z: 826 },
} as const;

export const SUBSKILL_QUESTS: QuestDef[] = [
  {
    id: 'sq_heart_of_the_mountain',
    title: 'The Heart of the Mountain',
    category: 'mastery',
    summary: 'Old legends say a few earthbenders — Avatars first among them — could melt the earth itself. No master teaches it. It wakes under pressure, deep in the fire under the mountain.',
    region: 'fire_nation_capital',
    autoStart: { flag: 'subskill_lava_eligible' },
    giver: 'master_lien',
    steps: [
      { id: 'legends', text: 'Ask Master Lien at the Stone Fist Dojo about the old earthbending legends.', objectives: [{ type: 'flag', flag: 'hm_legends', text: 'Hear the legends of Szeto, Kyoshi and Roku' }] },
      { id: 'descend', text: 'Find the natural lava tunnels at the north-west foot of the Fire Nation capital\'s volcano and go down into them.', objectives: [{ type: 'flag', flag: 'hm_inside', text: 'Enter the lava tunnels' }] },
      { id: 'flow', text: 'A lava flow cuts the tunnel. Wall it off with your earthbending, then bridge it.', objectives: [{ type: 'flag', flag: 'hm_bridged', text: 'Wall off and bridge the lava flow' }] },
      { id: 'wave', text: 'The mountain answers: a wave of lava! Under pressure, your earthbending changes. Turn the wave aside and cool it into solid earth.', objectives: [{ type: 'flag', flag: 'hm_wave_cooled', text: 'Divert and cool the lava wave' }] },
      { id: 'melt', text: 'Rock seals the way deeper. Melt it.', objectives: [{ type: 'flag', flag: 'hm_melted', text: 'Melt the rock plug' }] },
      {
        id: 'trial',
        text: 'In the deepest chamber, make the molten earth your own: a Lava Disc, a Lava Pool, a Lava Stream and a Lava Moat.',
        objectives: [
          { type: 'cast', technique: 'lava_disc', count: 1, text: 'Throw a Lava Disc' },
          { type: 'cast', technique: 'lava_pool', count: 1, text: 'Open a Lava Pool' },
          { type: 'cast', technique: 'lava_stream', count: 1, text: 'Send a Lava Stream' },
          { type: 'cast', technique: 'lava_moat', count: 1, text: 'Ring yourself in a Lava Moat' },
        ],
      },
    ],
    rewards: { xp: 600, currency: 120 },
  },
  {
    id: 'sq_silent_mind',
    title: 'The Silent Mind',
    category: 'mastery',
    summary: 'Monk Tenzo says the greatest airbenders could leave their bodies behind. It takes a silent mind, a silent place — and a place where the spirit world is near.',
    region: 'southern_air_temple',
    autoStart: { flag: 'subskill_projection_eligible' },
    giver: 'master_tenzo',
    steps: [
      { id: 'tenzo', text: 'Speak with Monk Tenzo at the Southern Air Temple.', objectives: [{ type: 'flag', flag: 'sm_tenzo', text: 'Speak with Monk Tenzo' }] },
      { id: 'focus', text: 'Meditate on the mat in the Avatar sanctuary: hold to focus. Only quiet fills it — noise, movement, enemies and crowds break it.', objectives: [{ type: 'flag', flag: 'sm_focused', text: 'Hold your focus until it fills' }] },
      { id: 'project', text: 'In the sanctuary, where the spirit world is near, let your spirit leave your body (Project).', objectives: [{ type: 'event', event: 'projection:changed', where: { active: true }, text: 'Project your spirit' }] },
      { id: 'trial', text: 'A sealed alcove lies beside the sanctuary. Pass through the stone as spirit, find the hidden spirit with Spirit Sight, and return before your focus runs out.', objectives: [{ type: 'flag', flag: 'sm_spirit_found', text: 'Find the hidden spirit' }, { type: 'flag', flag: 'sm_returned', text: 'Return to your body in time' }] },
    ],
    rewards: { xp: 600, currency: 120 },
  },
  {
    id: 'sq_puppetmaster',
    title: 'The Puppetmaster',
    category: 'mastery',
    summary: 'In a quiet Fire Nation village, people vanish on full-moon nights. The kindly old innkeeper says the woods are dangerous.',
    region: 'fire_nation_capital',
    autoStart: { flag: 'subskill_blood_eligible' },
    giver: 'sq_hama',
    steps: [
      { id: 'village', text: 'Travel to the hamlet west of the Fire Nation capital, where people disappear on full-moon nights.', objectives: [{ type: 'reach', x: SUB_SITES.village.x, z: SUB_SITES.village.z, radius: 30, text: 'Reach the village' }] },
      { id: 'inn', text: 'Take a room at the inn and speak with the innkeeper. Look around — something about her is not what it seems.', objectives: [{ type: 'flag', flag: 'pm_met', text: 'Speak with Hama, the innkeeper' }, { type: 'flag', flag: 'pm_clue_puppets', text: 'Look in the cupboard' }, { type: 'flag', flag: 'pm_clue_comb', text: 'Look at the carved comb' }] },
      { id: 'lessons', text: 'Hama is a waterbender of the Southern Water Tribe. By day she teaches you how the South draws water from the air and from plants.', objectives: [{ type: 'flag', flag: 'pm_lesson_done', text: 'Learn Hama\'s Southern lessons' }] },
      { id: 'fullmoon', text: 'Wait for the full moon (rest at the inn), then find Hama in the woods by the hill.', objectives: [{ type: 'flag', flag: 'pm_night', text: 'Meet Hama under the full moon' }] },
      { id: 'confront', text: 'Hama is the one taking the villagers. Stop her.', objectives: [{ type: 'flag', flag: 'pm_stopped', text: 'Stop Hama' }] },
      { id: 'free', text: 'Free the villagers from the cave prison in the hillside.', objectives: [{ type: 'flag', flag: 'pm_freed', text: 'Open the cave prison' }] },
      { id: 'after', text: 'Hama is taken away. Decide what bloodbending will be to you.', objectives: [{ type: 'flag', flag: 'pm_after', text: 'Face what you have done' }] },
    ],
    rewards: { xp: 700, currency: 150 },
  },
  {
    // Refusal path: Hama was defeated without bloodbending. The skill stays locked; she can teach it in custody.
    id: 'sq_hama_custody',
    title: 'Hama in Custody',
    category: 'mastery',
    summary: 'Hama is held in the village lockup. She still wants to pass her art on — on a full-moon night.',
    region: 'fire_nation_capital',
    autoStart: { flag: 'pm_refused' },
    hidden: true,
    giver: 'sq_hama_held',
    steps: [{ id: 'visit', text: 'If you choose to, visit Hama in the lockup on a full-moon night.', objectives: [{ type: 'flag', flag: 'pm_custody_taught', text: 'Learn bloodbending from Hama' }] }],
    rewards: { xp: 200 },
  },
  {
    // Legend of Korra extension (ENABLE_MOONLESS_BLOODBENDING): only appears while the flag is on.
    id: 'sq_tide_without_moon',
    title: 'The Tide Without a Moon',
    category: 'mastery',
    summary: 'Legend of Korra extension. Yakone\'s family bent blood with no moon at all, after years of training. A long, rare road.',
    autoStart: { flag: 'korra_moonless_available' },
    hidden: true,
    steps: [
      { id: 'moons', text: 'Hold a body under three different full moons to learn the feel of the water inside it.', objectives: [{ type: 'flag', flag: 'mb_three_moons', text: 'Bloodbend under three full moons' }] },
      { id: 'newmoon', text: 'On a new-moon night, meditate at the Spirit Oasis in the Northern Water Tribe.', objectives: [{ type: 'flag', flag: 'mb_newmoon', text: 'Meditate at the Spirit Oasis under the new moon' }] },
    ],
    rewards: { xp: 400 },
  },
];
