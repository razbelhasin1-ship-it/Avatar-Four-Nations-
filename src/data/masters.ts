import type { Element } from '../core/types';
import type { DialogueCondition, NPCBehavior } from '../npc/NPCTypes';
import type { Nation } from '../world/WorldLayout';

/**
 * Bending masters, their curricula (lessons → techniques, see docs/TECHNIQUES.md),
 * element awakenings and the grandmasters' Mastery Trials. Interpreted by
 * src/training/TrainingSystem.ts; challenge types live in src/training/challenges.ts.
 *
 * Positions come from region spots `master_<spot>` / `training_<spot>` (src/world/Spots.ts);
 * `fallback` is used while a region does not publish them (Omashu, Kyoshi, Foggy Swamp).
 */

export type ChallengeDef =
  /** Destroy N targets inside the time limit (optionally only with `technique`). */
  | { type: 'targets'; count: number; time: number; layout: 'arc' | 'ring' | 'line' | 'far' | 'cluster' | 'scatter'; dist?: number; hp?: number; technique?: string }
  /** Hit only the marked targets; decoys count as mistakes. `hidden`: targets only show after a seismic pulse. */
  | { type: 'precision'; marked: number; decoys: number; time: number; dist?: number; technique?: string; maxMistakes?: number; hidden?: boolean }
  /** Launchers fire at the player: block / deflect / evade (or absorb while armoured) `need` shots. */
  | { type: 'defense'; launchers: number; shots: number; need: number; time: number; mode: 'block' | 'deflect' | 'evade' | 'any' | 'armor'; technique?: string; maxHits?: number }
  /** Pass through rings in order (credited only while `technique` is in use). */
  | { type: 'rings'; count: number; time: number; path: 'circle' | 'zigzag' | 'climb' | 'line'; technique?: string; radius?: number }
  /** Non-lethal duel(s) (encounters sparring API). */
  | { type: 'spar'; rounds: number; partner: 'master' | 'student'; element: Element; mustUse?: string; level?: number }
  /** Reach a height: stand on a stone ledge (`platform`) or rise above the floor (`height`). */
  | { type: 'ledge'; mode: 'platform' | 'height'; height: number; time: number; technique?: string }
  /** Feed a flame with fire: keep it burning (`sustain`) or bring it to a boil (`fill`). */
  | { type: 'flame'; mode: 'sustain' | 'fill'; time: number; duration?: number; technique?: string }
  /** Hold your ground inside a circle while gusts push you. */
  | { type: 'stance'; duration: number; time: number; radius: number; gust: number }
  /** Start wounded, heal yourself back up with `technique`. */
  | { type: 'heal'; startFrac: number; targetFrac: number; time: number; technique: string }
  /** Gather water into the reserve with `technique`. */
  | { type: 'reserve'; amount: number; time: number; technique: string }
  /** Draw water from the training pool (or snow) and break targets with waterbending. */
  | { type: 'waterTargets'; count: number; time: number; snow?: boolean; technique?: string };

export interface DemoDef {
  /** Technique the master really casts (CombatSystem, force + free). */
  cast?: string;
  /** Extra scripted flourish (passives / movement). */
  fx?: 'jump' | 'stomp' | 'meditate' | 'glow';
  line: string;
}

export interface LessonDef {
  id: string;
  title: string;
  /** Technique taught (awakening lessons: the element's signature starter). */
  technique: string;
  /** Lesson ids (any master) that must be completed first. */
  requires?: string[];
  intro: string;
  demo: DemoDef;
  challenge: ChallengeDef;
  /** Contextual hint shown after learning. `{action}` placeholders (e.g. {attack}) become the player's current control names. */
  hint: string;
}

export interface TrialStage {
  title: string;
  challenge: ChallengeDef;
}

export interface MasterLook {
  seed: number;
  role: string;
  preset?: string;
  frame?: 'slim' | 'average' | 'athletic' | 'broad';
  height?: number;
  build?: number;
  skin?: string;
  hair?: string;
  hairColor?: string;
  facialHair?: string;
  eyes?: string;
  tattoos?: 'none' | 'arrows' | 'spirit_marks' | 'wind_bands';
  tattooColor?: string;
  scars?: string[];
  colors?: { primary: string; secondary: string; accent: string; trim: string };
  outfit?: Record<string, string>;
}

export interface MasterDef {
  /** NPC id. */
  id: string;
  name: string;
  title: string;
  element: Element;
  nation: Nation;
  /** Spot suffix: master_<spot> / training_<spot>. */
  spot: string;
  fallback: { x: number; z: number; yaw: number; tx: number; tz: number };
  region: string;
  location: string;
  grandmaster?: boolean;
  /** Hidden masters spawn (and are marked) only once their clue flag is set. */
  hidden?: { flag: string; hint: string };
  /** Extra spawn condition (e.g. relocation after an opening quest). */
  condition?: DialogueCondition;
  behavior: NPCBehavior;
  look: MasterLook;
  greeting: string;
  philosophy: string;
  farewell: string;
  awaken: string;
  lessons: LessonDef[];
  trial?: TrialStage[];
  trialIntro?: string;
}

// -----------------------------------------------------------------------------
// Element awakenings (offered by any master of an element you cannot bend yet)
// -----------------------------------------------------------------------------

export const AWAKENINGS: Record<Element, LessonDef> = {
  air: {
    id: 'awaken_air',
    title: 'Awakening: Airbending',
    technique: 'air_palm',
    intro: 'Air is the element of freedom. Do not push the wind — let it pass through your palms. Strike the targets with open hands.',
    demo: { cast: 'air_palm', line: 'Watch: the palm opens, and the wind follows.' },
    challenge: { type: 'targets', count: 3, time: 50, layout: 'arc', dist: 5 },
    hint: 'Airbending awakened. Switch elements with {elementNext}; {attack} Air Palm, hold {aim} for Air Blast.',
  },
  water: {
    id: 'awaken_water',
    title: 'Awakening: Waterbending',
    technique: 'water_whip',
    intro: 'Water is never created — only guided. Call it from the pool, then let it lash out. Break the targets.',
    demo: { cast: 'water_whip', line: 'Push and pull. The water remembers the moon.' },
    challenge: { type: 'waterTargets', count: 3, time: 70 },
    hint: 'Waterbending awakened. Stay near real water (rivers, sea, ponds) or carry it in your reserve ({drawWater} draws). {attack} Water Whip.',
  },
  earth: {
    id: 'awaken_earth',
    title: 'Awakening: Earthbending',
    technique: 'earth_strike',
    intro: 'Earth is patient, then decisive. Feel the stone under your feet, pull it up, and strike.',
    demo: { cast: 'earth_strike', line: 'Root yourself. Now — strike!' },
    challenge: { type: 'targets', count: 3, time: 50, layout: 'arc', dist: 6 },
    hint: 'Earthbending awakened. {attack} Rock Strike, hold {aim} for Seismic Slam, Earth Pillar on an ability slot.',
  },
  fire: {
    id: 'awaken_fire',
    title: 'Awakening: Firebending',
    technique: 'fire_jab',
    intro: 'Fire is life, not only destruction. Breathe in; let the breath become flame. Quick, precise strikes.',
    demo: { cast: 'fire_jab', line: 'Breath, then fire. Never the other way around.' },
    challenge: { type: 'targets', count: 3, time: 50, layout: 'arc', dist: 6 },
    hint: 'Firebending awakened. {attack} Flame Punch combo, hold {aim} for a Charged Fireball.',
  },
};

// -----------------------------------------------------------------------------
// Masters
// -----------------------------------------------------------------------------

const SPAR_TRIAL = (e: Element, title: string): TrialStage => ({ title, challenge: { type: 'spar', rounds: 2, partner: 'student', element: e, level: 6 } });

export const MASTERS: MasterDef[] = [
  // ============================== AIR ==============================
  {
    id: 'master_tenzo',
    name: 'Monk Tenzo',
    title: 'Temple Elder',
    element: 'air',
    nation: 'air',
    spot: 'tenzo',
    fallback: { x: 1418, z: 1217, yaw: 0, tx: 1421, tz: 1219 },
    region: 'southern_air_temple',
    location: 'Southern Air Temple — moon-gate training courtyard',
    condition: { flag: 'tenzo_in_courtyard' },
    behavior: { type: 'idle', variant: 'meditate' },
    look: { seed: 101, role: 'elder', preset: 'air_elder', frame: 'slim', height: 0.98, skin: '#e3b48d', hair: 'bald', hairColor: '#d8d8d8', facialHair: 'beard_long', tattoos: 'arrows', tattooColor: '#2f7fd6' },
    greeting: 'Ah, there you are. The wind told me you would come — it is a terrible gossip. I am Tenzo. I teach the young ones to fall without fear.',
    philosophy: 'Air has no walls and no grudges. When you stop holding on, you will find you were never heavy.',
    farewell: 'May the wind be at your back.',
    awaken: 'Breathe in through the nose... and out, slowly. There. Did you feel the breeze answer you? The air remembers the Avatar.',
    lessons: [
      {
        id: 'tenzo_air_jump',
        title: 'Lesson of the Second Breath',
        technique: 'air_jump',
        intro: 'When your jump runs out, the air is still there. Kick off it — once, then again. Pass through the high rings.',
        demo: { fx: 'jump', cast: 'air_dash', line: 'Up — and up again. The sky is a staircase for those who trust it.' },
        challenge: { type: 'rings', count: 5, time: 75, path: 'climb' },
        hint: 'Air Jump: press Jump again in mid-air — now up to two extra leaps while airbending.',
      },
      {
        id: 'tenzo_air_spin_strike',
        title: 'Lesson of the Turning Wheel',
        technique: 'air_spin_strike',
        requires: ['tenzo_air_jump'],
        intro: 'You are surrounded. Good. Spin, and become the center of the storm. Strike every target around you with the Spinning Air Strike.',
        demo: { cast: 'air_spin_strike', line: 'Turn like a prayer wheel. Everything that comes close goes away again.' },
        challenge: { type: 'targets', count: 6, time: 45, layout: 'ring', dist: 3.2, technique: 'air_spin_strike' },
        hint: 'Spinning Air Strike is on an ability slot (1–4): a 360° vortex that pushes everything out.',
      },
    ],
  },
  {
    id: 'master_iio',
    name: 'Brother Iio',
    title: 'Air Acrobat',
    element: 'air',
    nation: 'air',
    spot: 'iio',
    fallback: { x: 1424.7, z: 1319.5, yaw: 0, tx: 1426, tz: 1322 },
    region: 'southern_air_temple',
    location: 'Southern Air Temple — airball court (quarters terrace)',
    behavior: { type: 'train' },
    look: { seed: 102, role: 'student', preset: 'air_acolyte', frame: 'athletic', height: 1.02, build: 0.45, skin: '#efc9a6', hair: 'bald', facialHair: 'none', tattoos: 'arrows', tattooColor: '#3aa0e8', colors: { primary: '#f0b84a', secondary: '#d0702a', accent: '#f8e0a0', trim: '#8a4018' } },
    greeting: 'Oh! You are the one Tenzo keeps humming about. I am Iio. I lose at air-ball to nobody — well, to nobody since Tenzo retired.',
    philosophy: 'Speed is not hurry. A leaf in a gale is fast, and perfectly calm.',
    farewell: 'Try not to fall off the mountain. Or do — just glide after.',
    awaken: 'Close your eyes and run with me — feel the push at your back? That is not me. That is you.',
    lessons: [
      {
        id: 'iio_air_scooter',
        title: 'The Ball of Wind',
        technique: 'air_scooter',
        requires: ['tenzo_air_jump'],
        intro: 'Gather the wind into a ball beneath you and ride it. Through every ring on the arena — and do not stop to think!',
        demo: { cast: 'air_scooter', line: 'Balance on the spin, lean to steer. Wheee — ahem. Like that.' },
        challenge: { type: 'rings', count: 6, time: 50, path: 'circle', radius: 9, technique: 'air_scooter' },
        hint: 'Air Scooter: very fast steerable movement — hold its slot key to keep riding; it can cross water briefly.',
      },
      {
        id: 'iio_air_shield',
        title: 'The Turning Sphere',
        technique: 'air_shield',
        requires: ['iio_air_scooter'],
        intro: 'The novices will throw things at you. Spin the air into a sphere and let the bolts slide away. Deflect them with the Air Shield.',
        demo: { cast: 'air_shield', line: 'Round things do not break. Be round.' },
        challenge: { type: 'defense', launchers: 3, shots: 10, need: 5, time: 50, mode: 'deflect', technique: 'air_shield', maxHits: 4 },
        hint: 'Air Shield is a defense: hold it to spin a sphere that deflects projectiles and pushes attackers away.',
      },
    ],
  },
  {
    id: 'master_hermit',
    name: 'The Hermit',
    title: 'of the Four Winds',
    element: 'air',
    nation: 'air',
    spot: 'hermit',
    fallback: { x: 1575.6, z: 1347.1, yaw: Math.PI, tx: 1580, tz: 1350 },
    region: 'southern_air_temple',
    location: 'Shrine of the Four Winds (hidden ledge east of the temple)',
    hidden: { flag: 'clue_hermit', hint: 'Monks speak of a hermit who lives where the four winds meet, beyond the temple wall.' },
    behavior: { type: 'idle', variant: 'meditate' },
    look: { seed: 103, role: 'elder', preset: 'air_monk', frame: 'slim', height: 0.94, build: 0.2, skin: '#d29f78', hair: 'long_loose', hairColor: '#b0b0b0', facialHair: 'beard_long', tattoos: 'arrows', tattooColor: '#1f5fb0', colors: { primary: '#a88a5a', secondary: '#6a5a40', accent: '#d8c8a0', trim: '#4a3a2a' } },
    greeting: 'Hm? A visitor. The north wind said one would come, the south wind said no one would. The south wind owes me a cup of tea.',
    philosophy: 'Every wind is a returning wind. What is thrown at you is only asking to go home.',
    farewell: 'Go on, go on. The east wind is getting impatient.',
    awaken: 'Sit. Listen to four winds at once. Which one is yours? ...All of them. Of course. You are that kind of guest.',
    lessons: [
      {
        id: 'hermit_air_redirect',
        title: 'The Returning Wind',
        technique: 'air_redirect',
        requires: ['iio_air_shield'],
        intro: 'Do not block. Do not dodge. Catch the bolt in the wind and hand it back to its owner — at the very last moment.',
        demo: { cast: 'air_redirect', line: 'Late. Later. Now! — See? It went home.' },
        challenge: { type: 'defense', launchers: 2, shots: 10, need: 4, time: 60, mode: 'deflect', technique: 'air_redirect', maxHits: 5 },
        hint: 'Wind Redirection: tap it just before a projectile hits to send it back at whoever threw it.',
      },
      {
        id: 'hermit_air_vortex',
        title: 'The Small Storm',
        technique: 'air_vortex',
        requires: ['hermit_air_redirect'],
        intro: 'A tornado is just a breeze that will not stop talking. Send a vortex into the clustered posts and let it fling them.',
        demo: { cast: 'air_vortex', line: 'Round and round, and up, and away.' },
        challenge: { type: 'targets', count: 5, time: 50, layout: 'cluster', dist: 9, technique: 'air_vortex' },
        hint: 'Vortex: a travelling tornado that pulls, lifts and flings enemies. Aim it at groups.',
      },
    ],
  },
  {
    id: 'master_pasang',
    name: 'Abbot Pasang',
    title: 'Grandmaster of Air',
    element: 'air',
    nation: 'air',
    spot: 'pasang',
    fallback: { x: 1457, z: 1262.1, yaw: 0, tx: 1458, tz: 1265 },
    region: 'southern_air_temple',
    location: 'Southern Air Temple — the summit, by the central tower',
    grandmaster: true,
    behavior: { type: 'idle', variant: 'meditate' },
    look: { seed: 104, role: 'elder', preset: 'air_elder', frame: 'broad', height: 1.04, build: 0.4, skin: '#bf8a63', hair: 'bald', hairColor: '#d8d8d8', facialHair: 'mustache', tattoos: 'arrows', tattooColor: '#2f7fd6', colors: { primary: '#d8902a', secondary: '#a8441c', accent: '#f6dc98', trim: '#5a2a10' } },
    greeting: 'Welcome to the summit, young one. Few climb this far for the view; fewer still for the abbot. I am Pasang.',
    philosophy: 'Mastery is not having every answer. It is no longer being afraid of the question.',
    farewell: 'Walk lightly. The mountain remembers every step.',
    awaken: 'The summit is thin of air and thick with spirit. Breathe with me... the wind has been waiting for you.',
    trialIntro: 'The Trial of the Four Winds: spar with my best monks, strike every post on the summit, then turn aside the storm itself. Are you ready?',
    lessons: [],
    trial: [
      SPAR_TRIAL('air', 'North Wind — duels with the monks'),
      { title: 'East Wind — the post gauntlet', challenge: { type: 'targets', count: 8, time: 60, layout: 'scatter', dist: 8 } },
      { title: 'South Wind — turn aside the storm', challenge: { type: 'defense', launchers: 3, shots: 12, need: 7, time: 55, mode: 'any', maxHits: 5 } },
    ],
  },

  // ============================== WATER ==============================
  {
    id: 'master_siku',
    name: 'Master Siku',
    title: 'Grandmaster of Water',
    element: 'water',
    nation: 'water',
    spot: 'siku',
    fallback: { x: -350, z: -1615, yaw: -Math.PI / 2, tx: -359, tz: -1615 },
    region: 'northern_water_tribe',
    location: 'Northern Water Tribe — Waterbending Courtyard',
    grandmaster: true,
    behavior: { type: 'train' },
    look: { seed: 201, role: 'master', preset: 'water_warrior', frame: 'broad', height: 1.0, build: 0.6, skin: '#8d5d3e', hair: 'long_braid', hairColor: '#d8d8d8', facialHair: 'mustache', colors: { primary: '#1e3a66', secondary: '#16304f', accent: '#e9eef5', trim: '#b8a888' } },
    greeting: 'So. The Avatar walks into my courtyard without bowing. Hmph. I am Siku. I have trained chiefs, and I have sent chiefs home crying.',
    philosophy: 'Water is the element of change. Discipline is how you survive it.',
    farewell: 'Practice. Then practice again.',
    awaken: 'Stand in the stance. Lower. LOWER. ...Now push and pull. There — the canal moved. Do not look so pleased.',
    trialIntro: 'The Trial of the Ocean and Moon. Duel my students, break the ice targets with water you draw yourself, and stand behind your own walls. Fail, and you will try again tomorrow.',
    lessons: [
      {
        id: 'siku_ice_wall',
        title: 'The Frozen Rampart',
        technique: 'ice_wall',
        intro: 'My students will throw everything they have. Raise a wall of ice and let it take the blows for you.',
        demo: { cast: 'ice_wall', line: 'Pull the water up — and freeze it in one breath.' },
        challenge: { type: 'defense', launchers: 2, shots: 9, need: 5, time: 50, mode: 'block', technique: 'ice_wall', maxHits: 4 },
        hint: 'Ice Wall is a defense: a solid, walkable wall of ice that blocks projectiles (it also becomes an ice source).',
      },
      {
        id: 'siku_freezing_strike',
        title: 'The Still Water',
        technique: 'freezing_strike',
        requires: ['siku_ice_wall'],
        intro: 'Freeze only the marked posts. A careless waterbender freezes his friends.',
        demo: { cast: 'freezing_strike', line: 'Lash — and lock it in ice.' },
        challenge: { type: 'precision', marked: 3, decoys: 3, time: 50, dist: 8, technique: 'freezing_strike', maxMistakes: 1 },
        hint: 'Freezing Strike: a water lash that freezes the target in place. Frozen foes cannot act.',
      },
    ],
    trial: [
      SPAR_TRIAL('water', 'The Tide — duels with Siku\'s students'),
      { title: 'The Moon — break the targets with drawn water', challenge: { type: 'waterTargets', count: 6, time: 75 } },
      { title: 'The Ocean — stand your ground', challenge: { type: 'defense', launchers: 3, shots: 12, need: 7, time: 55, mode: 'any', maxHits: 5 } },
    ],
  },
  {
    id: 'master_yugoda',
    name: 'Healer Yugoda',
    title: 'Elder Healer',
    element: 'water',
    nation: 'water',
    spot: 'yugoda',
    fallback: { x: -86.5, z: -1622, yaw: Math.PI / 2, tx: -79, tz: -1615 },
    region: 'northern_water_tribe',
    location: 'Northern Water Tribe — healing hut',
    behavior: { type: 'idle', variant: 'work' },
    look: { seed: 202, role: 'healer', preset: 'water_healer', frame: 'slim', height: 0.93, build: 0.2, skin: '#a87350', hair: 'hair_loops', hairColor: '#e0e0e0', facialHair: 'none', colors: { primary: '#5a8ac8', secondary: '#2a4a78', accent: '#eef4fa', trim: '#c8b898' } },
    greeting: 'Come in, come in, out of the wind. I am Yugoda. I have mended more bruised waterbenders than Siku has made — and that is saying something.',
    philosophy: 'Water that heals and water that cuts are the same water. Only the heart is different.',
    farewell: 'Drink something warm. And come back if it hurts.',
    awaken: 'Hold out your hands over the bowl... feel how the water leans toward you? It knows you. It has always known you.',
    lessons: [
      {
        id: 'yugoda_water_heal',
        title: 'Hands of the Moon',
        technique: 'water_heal',
        intro: 'You are hurt — I made sure of it, gently. Draw water to your wounds and let it glow. Heal yourself before the candle burns down.',
        demo: { cast: 'water_heal', line: 'Feel the energy paths under the skin. Guide, do not force.' },
        challenge: { type: 'heal', startFrac: 0.35, targetFrac: 0.9, time: 50, technique: 'water_heal' },
        hint: 'Healing Waters: an ability that heals you over a few seconds — it needs water nearby or in your reserve.',
      },
      {
        id: 'yugoda_water_snow_draw',
        title: 'Snow Remembers',
        technique: 'water_snow_draw',
        requires: ['yugoda_water_heal'],
        intro: 'Snow is only sleeping water. Wake it: draw from the snowdrifts in the yard, then break the practice posts.',
        demo: { fx: 'glow', cast: 'water_whip', line: 'See how the drift melts into my hands? Patience, and warmth.' },
        challenge: { type: 'waterTargets', count: 3, time: 75, snow: true },
        hint: 'Snow Gathering (passive): you now draw water out of snow and ice much faster.',
      },
    ],
  },
  {
    id: 'master_akka',
    name: 'Hunter Akka',
    title: 'Southern Hunter',
    element: 'water',
    nation: 'water',
    spot: 'akka',
    fallback: { x: 230, z: 1585, yaw: 0, tx: 230, tz: 1600 },
    region: 'southern_water_tribe',
    location: 'Southern Water Tribe — the hunting ice',
    behavior: { type: 'train' },
    look: { seed: 203, role: 'master', preset: 'water_south', frame: 'athletic', height: 1.03, build: 0.65, skin: '#8d5d3e', hair: 'wolf_tail', hairColor: '#1a1412', facialHair: 'stubble', scars: ['cheek_r'], colors: { primary: '#3a6aa0', secondary: '#24467a', accent: '#f0f0f0', trim: '#8a6a40' } },
    greeting: 'You are not from the south. You walk on the ice like it might bite. Good — it might. Akka. I hunt, I teach, I do not repeat myself.',
    philosophy: 'On the ice, a wasted strike is a wasted meal. Aim.',
    farewell: 'Keep your spear dry and your water close.',
    awaken: 'Kneel at the edge. Put your hand in the sea... cold, yes? Now pull. The ocean pulls back. That is the conversation.',
    lessons: [
      {
        id: 'akka_ice_shards',
        title: 'Hunter\'s Hail',
        technique: 'ice_shards',
        intro: 'The seal posts are far out on the ice. Throw a fan of ice and bring them down from range.',
        demo: { cast: 'ice_shards', line: 'Spread your fingers. Five shards, one throw.' },
        challenge: { type: 'targets', count: 5, time: 50, layout: 'far', dist: 12, technique: 'ice_shards' },
        hint: 'Ice Shards: a fan of ice projectiles — it can draw on ice as a source.',
      },
      {
        id: 'akka_water_sweep',
        title: 'The Low Wave',
        technique: 'water_sweep',
        requires: ['akka_ice_shards'],
        intro: 'When the pack rushes you, take their legs. Sweep a wave along the ground through every post.',
        demo: { cast: 'water_sweep', line: 'Low and wide. They fall, you walk away.' },
        challenge: { type: 'targets', count: 5, time: 45, layout: 'arc', dist: 5, technique: 'water_sweep' },
        hint: 'Water Sweep: a ground-level wave in a wide arc that knocks enemies down.',
      },
    ],
  },
  {
    id: 'master_huu',
    name: 'Huu',
    title: 'Swamp Sage',
    element: 'water',
    nation: 'neutral',
    spot: 'huu',
    fallback: { x: -1071, z: -140, yaw: Math.PI / 2, tx: -1059, tz: -140 },
    region: 'foggy_swamp',
    location: 'Foggy Swamp — shore of the Great Banyan Tree',
    hidden: { flag: 'clue_huu', hint: 'Travellers whisper of a sage in the Foggy Swamp who bends the water inside the trees.' },
    behavior: { type: 'idle', variant: 'sit' },
    look: { seed: 204, role: 'elder', preset: 'water_south', frame: 'broad', height: 1.05, build: 0.75, skin: '#a87350', hair: 'long_loose', hairColor: '#3f2a1d', facialHair: 'beard_long', colors: { primary: '#4a5a2a', secondary: '#3a3a1a', accent: '#a89a5a', trim: '#5a4a2a' } },
    greeting: 'Well now. Didn\'t think the swamp would let anybody through this season. Name\'s Huu. The swamp brought you here — so I reckon it wants you to learn something.',
    philosophy: 'Everything\'s connected, see. The roots, the water, you, me. One big tree.',
    farewell: 'Watch out for the vines. Some of \'em are just friendly.',
    awaken: 'Put your feet in the mud. Feel the water in the roots? It\'s been talkin\' about you since you got here.',
    lessons: [
      {
        id: 'huu_water_moisture',
        title: 'Water in the Roots',
        technique: 'water_moisture',
        requires: ['yugoda_water_snow_draw'],
        intro: 'There\'s water in every leaf and every breath of fog. Pull it out of the swamp air until your reserve is full.',
        demo: { cast: 'water_moisture', line: 'Not too greedy now — the plants need some too.' },
        challenge: { type: 'reserve', amount: 25, time: 60, technique: 'water_moisture' },
        hint: 'Moisture Extraction: pulls water from plants and humid air into your reserve — strong in swamps and forests, weak in deserts.',
      },
      {
        id: 'huu_water_jet',
        title: 'The Pressure Stream',
        technique: 'water_jet',
        requires: ['huu_water_moisture'],
        intro: 'Squeeze the water tight and let it go all at once. Those old stumps need a good wash — break \'em with a jet.',
        demo: { cast: 'water_jet', line: 'Like a sinkhole in reverse.' },
        challenge: { type: 'targets', count: 3, time: 50, layout: 'arc', dist: 7, hp: 70, technique: 'water_jet' },
        hint: 'Water Jet: a channelled high-pressure stream — hold its slot key to keep pushing and damaging.',
      },
      {
        id: 'huu_water_spout',
        title: 'Standing on the Water',
        technique: 'water_spout',
        requires: ['huu_water_jet'],
        intro: 'Big water, big tricks. Go to the shore, call up a spout and ride it high above the reeds.',
        demo: { cast: 'water_spout', line: 'Up she goes!' },
        challenge: { type: 'ledge', mode: 'height', height: 4.5, time: 50, technique: 'water_spout' },
        hint: 'Water Spout: ride a column of water upward from a large source; aerial water attacks start from it.',
      },
      {
        id: 'huu_ice_spikes',
        title: 'The Frozen Roots',
        technique: 'ice_spikes',
        requires: ['huu_water_spout', 'siku_freezing_strike'],
        intro: 'Roots grow in lines. So does ice, if you ask nicely. Raise a row of spikes through the line of stumps.',
        demo: { cast: 'ice_spikes', line: 'Crack-crack-crack. Heh.' },
        challenge: { type: 'targets', count: 4, time: 50, layout: 'line', dist: 3.5, technique: 'ice_spikes' },
        hint: 'Ice Spikes: a line of ice spikes erupts from the ground ahead of you.',
      },
    ],
  },

  // ============================== EARTH ==============================
  {
    id: 'master_lien',
    name: 'Master Lien',
    title: 'Stone Fist Dojo',
    element: 'earth',
    nation: 'earth',
    spot: 'lien',
    fallback: { x: 710, z: 40, yaw: -Math.PI / 2, tx: 700, tz: 40 },
    region: 'ba_sing_se',
    location: 'Ba Sing Se — Stone Fist Dojo',
    behavior: { type: 'train' },
    look: { seed: 301, role: 'master', preset: 'earth_kingdom', frame: 'athletic', height: 1.02, build: 0.7, skin: '#d29f78', hair: 'bun', hairColor: '#1a1412', facialHair: 'goatee', outfit: { headwear: 'earth_headband', top: 'earth_dojo' }, colors: { primary: '#3f6a2f', secondary: '#2f4f25', accent: '#c9b27a', trim: '#6b4a2a' } },
    greeting: 'A new student at the Stone Fist. Bow when you enter the floor. Good. I am Lien. Here we learn to be a wall — and then to be a hammer.',
    philosophy: 'Earth is the element of substance. Wait, listen, and strike only when the moment is right.',
    farewell: 'Keep your feet heavy and your mind light.',
    awaken: 'Take off your shoes. Feel the stone of the dojo floor... it is cold, it is old, and now it is listening to you.',
    lessons: [
      {
        id: 'lien_stone_wall',
        title: 'The First Wall',
        technique: 'stone_wall',
        intro: 'My students will throw stones. You will not dodge. Raise a wall of rock and let it take every blow.',
        demo: { cast: 'stone_wall', line: 'Stomp — lift — hold. A wall is a decision.' },
        challenge: { type: 'defense', launchers: 2, shots: 9, need: 5, time: 50, mode: 'block', technique: 'stone_wall', maxHits: 4 },
        hint: 'Stone Wall is a defense: raises a wall that blocks projectiles — use it again to punch it forward.',
      },
      {
        id: 'lien_stone_guard',
        title: 'The Unbroken Guard',
        technique: 'stone_guard',
        requires: ['lien_stone_wall'],
        intro: 'Spar with my senior student. Brace with stone on your forearms when the blows come, then answer them.',
        demo: { cast: 'stone_guard', line: 'Absorb. Then return it with interest.' },
        challenge: { type: 'spar', rounds: 1, partner: 'student', element: 'earth', mustUse: 'stone_guard', level: 3 },
        hint: 'Stone Guard: brace with rock forearms for heavy damage reduction — perfect timing counters.',
      },
    ],
  },
  {
    id: 'master_bumo',
    name: 'King Bumo',
    title: 'Grandmaster of Earth',
    element: 'earth',
    nation: 'earth',
    spot: 'bumo',
    fallback: { x: -450, z: -664, yaw: 0, tx: -450, tz: -650 },
    region: 'omashu',
    location: 'Omashu — the king\'s terrace',
    grandmaster: true,
    behavior: { type: 'idle', variant: 'stand' },
    look: { seed: 302, role: 'elder', preset: 'earth_noble', frame: 'slim', height: 1.0, build: 0.4, skin: '#d29f78', hair: 'spiky', hairColor: '#e8e8e8', facialHair: 'stubble', eyes: '#5d7a3a', colors: { primary: '#4a3a6a', secondary: '#2f4f25', accent: '#e8e0c0', trim: '#c9a227' } },
    greeting: 'Hah! A visitor! Do you like rocks? I LOVE rocks. I am Bumo, king of Omashu, and I have a test for you. Everyone gets a test. Even the cabbage man.',
    philosophy: 'You have to think like a mad genius! The obvious path is for obvious people.',
    farewell: 'Lettuce leaf! ...I mean, goodbye!',
    awaken: 'Pick up that rock. No, the other rock. Now — throw it at me! Hah! It came back to you? It LIKES you!',
    trialIntro: 'The Trial of the Unmoving Mountain! Duel my guards, smash my lovely targets, and climb to the top of my ledge. Ready? Of course you are. Probably.',
    lessons: [
      {
        id: 'bumo_boulder_roll',
        title: 'Omashu Bowling',
        technique: 'boulder_roll',
        requires: ['lien_stone_wall'],
        intro: 'Line them up, knock them down! Roll a boulder through every post. Bonus points for style. There are no bonus points.',
        demo: { cast: 'boulder_roll', line: 'And — STRIKE! Hahahaha!' },
        challenge: { type: 'targets', count: 5, time: 50, layout: 'line', dist: 5, technique: 'boulder_roll' },
        hint: 'Boulder Roll: a huge boulder rolls forward and crushes everything in its path.',
      },
      {
        id: 'bumo_earth_launch',
        title: 'The Mail Chute Express',
        technique: 'earth_launch',
        requires: ['bumo_boulder_roll'],
        intro: 'See that ledge? Get on top of it. Stairs are for people who do not have a pillar to stand on!',
        demo: { cast: 'earth_launch', line: 'Wheeee! Ahem. Royal wheee.' },
        challenge: { type: 'ledge', mode: 'platform', height: 6.5, time: 50, technique: 'earth_launch' },
        hint: 'Earth Launch: a pillar catapults you high into the air — glide-free airtime for the earthbound.',
      },
    ],
    trial: [
      SPAR_TRIAL('earth', 'The Foothills — duels with the royal guard'),
      { title: 'The Slopes — smash the targets', challenge: { type: 'targets', count: 8, time: 60, layout: 'scatter', dist: 8 } },
      { title: 'The Unmoving Mountain — hold your stance in the gale', challenge: { type: 'stance', duration: 15, time: 40, radius: 2.6, gust: 7 } },
    ],
  },
  {
    id: 'master_lin',
    name: 'Lin the Blind',
    title: 'Earth Rumble Champion',
    element: 'earth',
    nation: 'earth',
    spot: 'lin',
    fallback: { x: 411, z: 300, yaw: Math.PI / 2, tx: 420, tz: 300 },
    region: 'earth_heartland',
    location: 'Gaoling — Earth Rumble ring',
    hidden: { flag: 'clue_lin', hint: 'A poster in Gaoling advertises a blind champion nobody can beat at the Earth Rumble.' },
    behavior: { type: 'train' },
    look: { seed: 303, role: 'student', preset: 'earth_kingdom', frame: 'slim', height: 0.84, build: 0.35, skin: '#efc9a6', hair: 'bob', hairColor: '#1a1412', facialHair: 'none', eyes: '#c8d0d8', colors: { primary: '#5a7a3a', secondary: '#c9a227', accent: '#e8dcb0', trim: '#3a4a25' } },
    greeting: 'I heard you coming three streets away. You walk like a sack of potatoes with opinions. I\'m Lin. Undefeated. You can clap now.',
    philosophy: 'I see with my feet. Everybody\'s lying with their faces — the ground never lies.',
    farewell: 'Don\'t trip over anything. Oh wait, that\'s my line.',
    awaken: 'Stand still. Stiller. Feel that thump? That\'s my heartbeat through the floor. Yours too. Now push.',
    lessons: [
      {
        id: 'lin_seismic_sense',
        title: 'Seeing with Your Feet',
        technique: 'seismic_sense',
        requires: ['lien_stone_guard'],
        intro: 'The targets are hidden. Stomp — slam the ground, or land hard — and feel where they are. Then break them.',
        demo: { fx: 'stomp', cast: 'earth_slam', line: 'Thump. There, there and there. Easy.' },
        challenge: { type: 'precision', marked: 3, decoys: 0, time: 75, dist: 8, hidden: true },
        hint: 'Seismic Sense (passive): stomps and hard landings reveal nearby enemies and hidden things.',
      },
      {
        id: 'lin_rock_armor',
        title: 'Wear the Mountain',
        technique: 'rock_armor',
        requires: ['lin_seismic_sense'],
        intro: 'Put on some rocks and let them hit you. Seriously. Take the hits while armoured — every one that bounces off counts.',
        demo: { cast: 'rock_armor', line: 'Plink. Plink. Bored now.' },
        challenge: { type: 'defense', launchers: 2, shots: 10, need: 4, time: 55, mode: 'armor', technique: 'rock_armor', maxHits: 4 },
        hint: 'Rock Armor: encase yourself in stone — armour, stagger immunity, but slower movement.',
      },
    ],
  },
  {
    id: 'master_oyagi',
    name: 'Oyagi',
    title: 'of Kyoshi Island',
    element: 'earth',
    nation: 'earth',
    spot: 'oyagi',
    fallback: { x: 1820, z: -454, yaw: 0, tx: 1820, tz: -440 },
    region: 'kyoshi_island',
    location: 'Kyoshi Village — the Avatar statue green',
    behavior: { type: 'train' },
    look: { seed: 304, role: 'elder', preset: 'earth_kingdom', frame: 'average', height: 0.97, build: 0.5, skin: '#e3b48d', hair: 'bun', hairColor: '#a0a0a0', facialHair: 'beard_short', outfit: { top: 'earth_kyoshi' }, colors: { primary: '#3f7a3a', secondary: '#c9a227', accent: '#e7e2d0', trim: '#7a1f1a' } },
    greeting: 'Welcome to Kyoshi Island, traveller. I am Oyagi — I lead this village, and I keep the old Avatar\'s earth forms alive. She was very... firm about that.',
    philosophy: 'Kyoshi said: only justice will bring peace. The earth agrees — it moves only when it must, and then it does not stop.',
    farewell: 'Mind the unagi on the way out.',
    awaken: 'Avatar Kyoshi raised this island from the mainland. A little of that strength is still in the ground. Take it.',
    lessons: [
      {
        id: 'oyagi_ground_spikes',
        title: 'Kyoshi\'s Line',
        technique: 'ground_spikes',
        intro: 'Send a line of stone spikes into the painted posts only. The plain ones belong to the warriors — leave them standing.',
        demo: { cast: 'ground_spikes', line: 'Straight as Kyoshi\'s fan.' },
        challenge: { type: 'precision', marked: 3, decoys: 2, time: 50, dist: 8, technique: 'ground_spikes', maxMistakes: 1 },
        hint: 'Ground Spikes: a line of stone spikes travels forward along the ground.',
      },
      {
        id: 'oyagi_earth_surf',
        title: 'Riding the Ridge',
        technique: 'earth_surf',
        requires: ['oyagi_ground_spikes'],
        intro: 'Ride a wave of earth across the green and through every gate. Lean into it — the island likes speed.',
        demo: { cast: 'earth_surf', line: 'Watch the ground roll — like a wave on the cove.' },
        challenge: { type: 'rings', count: 6, time: 50, path: 'zigzag', technique: 'earth_surf' },
        hint: 'Earth Surf: ride a travelling wave of earth for fast ground movement — hold its slot key.',
      },
    ],
  },

  // ============================== FIRE ==============================
  {
    id: 'master_jeong',
    name: 'Master Jeong',
    title: 'Agni Kai Instructor',
    element: 'fire',
    nation: 'fire',
    spot: 'jeong',
    fallback: { x: -1218, z: 1180, yaw: -Math.PI / 2, tx: -1230, tz: 1180 },
    region: 'fire_nation_capital',
    location: 'Fire Nation Capital — Agni Kai Arena',
    behavior: { type: 'train' },
    look: { seed: 401, role: 'master', preset: 'fire_trainee', frame: 'athletic', height: 1.03, build: 0.8, skin: '#e3b48d', hair: 'topknot', hairColor: '#1a1412', facialHair: 'sideburns', scars: ['brow_l'], colors: { primary: '#8a1a14', secondary: '#1a1414', accent: '#e0b050', trim: '#5a1410' } },
    greeting: 'Stand straight when you enter my arena. I am Master Jeong. I do not teach fire to the timid — I teach it to the precise.',
    philosophy: 'Power without control is a wildfire. It burns the one who lit it first.',
    farewell: 'Dismissed. Keep your breath steady.',
    awaken: 'Breathe in — hold — and out through the fist. A spark. Small, but yours. Now again.',
    lessons: [
      {
        id: 'jeong_fire_dash',
        title: 'The Burning Step',
        technique: 'fire_dash',
        intro: 'Speed decides an Agni Kai. Jet across the arena through every flaming gate before the gong sounds.',
        demo: { cast: 'fire_dash', line: 'Push the fire down and back. You go forward.' },
        challenge: { type: 'rings', count: 5, time: 40, path: 'line', technique: 'fire_dash' },
        hint: 'Fire Dash: a jet-propelled dash that leaves a burning trail.',
      },
      {
        id: 'jeong_spinning_flame_kick',
        title: 'The Agni Kai',
        technique: 'spinning_flame_kick',
        requires: ['jeong_fire_dash'],
        intro: 'An honest duel with my best student. Show me the Spinning Flame Kick at least once — and win.',
        demo: { cast: 'spinning_flame_kick', line: 'Leap, turn, and let the ring of fire finish the sentence.' },
        challenge: { type: 'spar', rounds: 1, partner: 'student', element: 'fire', mustUse: 'spinning_flame_kick', level: 3 },
        hint: 'Spinning Flame Kick: an airborne spinning kick that throws a ring of fire around you.',
      },
    ],
  },
  {
    id: 'master_hira',
    name: 'Sage Hira',
    title: 'Fire Sage',
    element: 'fire',
    nation: 'fire',
    spot: 'hira',
    fallback: { x: -1346, z: 1150, yaw: Math.PI / 2, tx: -1330, tz: 1150 },
    region: 'fire_nation_capital',
    location: 'Fire Nation Capital — Fire Sages\' Temple court',
    condition: { flag: 'hira_at_temple' },
    behavior: { type: 'idle', variant: 'stand' },
    look: { seed: 402, role: 'noble', preset: 'fire_palace', frame: 'slim', height: 1.0, build: 0.3, skin: '#efc9a6', hair: 'topknot_crown', hairColor: '#a0a0a0', facialHair: 'goatee', colors: { primary: '#9a1c14', secondary: '#1a1010', accent: '#e0b040', trim: '#e0b040' } },
    greeting: 'The temple flames bowed when you crossed the court. Welcome, Avatar. The Sages kept this fire burning for a hundred years — for you.',
    philosophy: 'Fire is the breath of the sun. Feed it with patience, and it will never go out.',
    farewell: 'Agni watches over you.',
    awaken: 'Sit before the sacred flame. Breathe as it breathes... there. It leaned toward you. Fire knows its own.',
    lessons: [
      {
        id: 'hira_breath_of_fire',
        title: 'The Sacred Flame',
        technique: 'breath_of_fire',
        intro: 'The sacred brazier must not go out. Feed it with your breath — keep it burning until the incense is gone.',
        demo: { cast: 'breath_of_fire', line: 'From the belly, not the throat.' },
        challenge: { type: 'flame', mode: 'sustain', duration: 20, time: 45, technique: 'breath_of_fire' },
        hint: 'Breath of Fire: a cone of fire breathed out — it also melts ice.',
      },
      {
        id: 'hira_fire_shield',
        title: 'The Temple Ward',
        technique: 'fire_shield',
        requires: ['hira_breath_of_fire'],
        intro: 'For a hundred years the Sages kept the temple flame alive against wind and rain. My acolytes will throw water at you now. Turn your fire into a wheel and burn every bolt to steam before it reaches you.',
        demo: { cast: 'fire_shield', line: 'Turn the fire like a wheel — and nothing passes.' },
        challenge: { type: 'defense', launchers: 3, shots: 10, need: 5, time: 50, mode: 'block', technique: 'fire_shield', maxHits: 4 },
        hint: 'Fire Shield is a defense: hold it to spin a wheel of fire that burns projectiles away and scorches attackers. Raise it just as a blow lands for a counter blast.',
      },
    ],
  },
  {
    id: 'master_iro',
    name: 'General Iro',
    title: 'Retired Tea Enthusiast',
    element: 'fire',
    nation: 'fire',
    spot: 'iro',
    fallback: { x: -1680, z: 1770, yaw: 0, tx: -1680, tz: 1782 },
    region: 'ember_island',
    location: 'Ember Island — the tea house terrace',
    behavior: { type: 'idle', variant: 'sit' },
    look: { seed: 403, role: 'elder', preset: 'fire_citizen', frame: 'broad', height: 0.96, build: 0.8, skin: '#e3b48d', hair: 'topknot', hairColor: '#8c8c8c', facialHair: 'beard_short', colors: { primary: '#8a3a2a', secondary: '#3a2a20', accent: '#d4a43a', trim: '#5a2a1a' } },
    greeting: 'Ah! A guest! Sit, sit. I am Iro — once a general, now merely a man with very good tea. You have the look of someone carrying the world. Have some jasmine first.',
    philosophy: 'Pride is not the opposite of shame, but its source. True humility is the only antidote.',
    farewell: 'Come back any time. The pot is always warm.',
    awaken: 'Fire comes from the breath, and the breath comes from... the tea, mostly. Breathe in the steam. Now — a little flame, under the kettle. Wonderful!',
    lessons: [
      {
        id: 'iro_fire_stream',
        title: 'Heating the Kettle',
        technique: 'fire_stream',
        requires: ['hira_breath_of_fire'],
        intro: 'A steady stream, not a fireball. Keep the flame on the kettle until it sings. Too little and the water cools again.',
        demo: { cast: 'fire_stream', line: 'Gentle and constant. Just like brewing tea.' },
        challenge: { type: 'flame', mode: 'fill', time: 45, technique: 'fire_stream' },
        hint: 'Fire Stream: a channelled flamethrower — hold its slot key to keep it flowing.',
      },
      {
        id: 'iro_fire_lightning',
        title: 'Cold-Blooded Fire',
        technique: 'fire_lightning',
        requires: ['iro_fire_stream', 'jeong_spinning_flame_kick'],
        intro: 'Lightning is fire without emotion. Separate the energies, then strike only the marked posts far out over the beach.',
        demo: { cast: 'fire_lightning', line: 'Positive and negative... and release. Calmly.' },
        challenge: { type: 'precision', marked: 3, decoys: 2, time: 55, dist: 15, technique: 'fire_lightning', maxMistakes: 1 },
        hint: 'Lightning Generation: charge, then release a near-instant bolt that chains between enemies.',
      },
    ],
  },
  {
    id: 'master_ahkon',
    name: 'Sun Chief Ahkon',
    title: 'Grandmaster of Fire',
    element: 'fire',
    nation: 'fire',
    spot: 'ahkon',
    fallback: { x: -1560, z: 948, yaw: Math.PI, tx: -1560, tz: 935 },
    region: 'fire_nation_capital',
    location: 'Sun Warrior Ruins — Altar of the Eternal Flame',
    grandmaster: true,
    behavior: { type: 'train' },
    look: { seed: 404, role: 'master', preset: 'fire_trainee', frame: 'broad', height: 1.06, build: 0.75, skin: '#8d5d3e', hair: 'side_shave', hairColor: '#1a1412', facialHair: 'goatee', tattoos: 'spirit_marks', tattooColor: '#e8f4ff', colors: { primary: '#c08a2a', secondary: '#5a2a10', accent: '#e0c060', trim: '#8a3a10' } },
    greeting: 'The Sun Warriors have not welcomed an outsider in many lifetimes. But the Eternal Flame did not go out when you approached. I am Ahkon. Speak.',
    philosophy: 'Fire is energy, and energy is life. The dragons taught us: fire is not anger — it is the sun inside you.',
    farewell: 'Walk in the light of the sun.',
    awaken: 'Hold this ember from the Eternal Flame. Do not grip it — do not drop it. Feel its heartbeat... now it is yours.',
    trialIntro: 'The Trial of the Eternal Flame. Duel my warriors, keep the sacred fire alive, and burn away every target in the plaza. The sun is watching.',
    lessons: [
      {
        id: 'ahkon_explosive_finisher',
        title: 'The Dancing Dragon',
        technique: 'explosive_finisher',
        requires: ['jeong_spinning_flame_kick'],
        intro: 'Leap with both fists and let the sun explode. Shatter the stone posts in groups — each blast must count.',
        demo: { cast: 'explosive_finisher', line: 'The dragon does not strike twice.' },
        challenge: { type: 'targets', count: 6, time: 50, layout: 'cluster', dist: 7, technique: 'explosive_finisher' },
        hint: 'Explosive Finisher: a leaping two-fisted strike that detonates a large explosion.',
      },
    ],
    trial: [
      SPAR_TRIAL('fire', 'Dawn — duels with the Sun Warriors'),
      { title: 'Noon — keep the Eternal Flame alive', challenge: { type: 'flame', mode: 'sustain', duration: 18, time: 40 } },
      { title: 'Dusk — burn away the targets', challenge: { type: 'targets', count: 8, time: 60, layout: 'scatter', dist: 9 } },
    ],
  },
];

export function masterById(id: string): MasterDef | undefined {
  return MASTERS.find((m) => m.id === id);
}

/** Every lesson (masters' curricula), by id. */
export function lessonById(id: string): { master: MasterDef; lesson: LessonDef } | undefined {
  for (const m of MASTERS) {
    const l = m.lessons.find((x) => x.id === id);
    if (l) return { master: m, lesson: l };
  }
  return undefined;
}

/** First master each seek-quest points to when the player cannot bend the element yet. */
export const FIRST_MASTER: Record<Element, string> = {
  air: 'master_tenzo',
  water: 'master_siku',
  earth: 'master_lien',
  fire: 'master_jeong',
};

export const GRANDMASTER: Record<Element, string> = {
  air: 'master_pasang',
  water: 'master_siku',
  earth: 'master_bumo',
  fire: 'master_ahkon',
};
