import type { Element } from '../core/types';

/**
 * Enemy archetypes, bosses and encounter tables (data only; the runtime lives
 * in src/ai/). Techniques are either registered bending techniques (cast
 * through CombatSystem.tryCast like the player's) or AI attacks from
 * src/ai/attacks.ts (ids start with `atk_`, executed as CombatSystem detached
 * casts so damage, dedup, events and feedback stay in the combat pipeline).
 */

export type EnemyFaction = 'fire_nation' | 'earth_bandit' | 'dai_li' | 'pirate' | 'beast';
export type EnemyBody = 'humanoid' | 'platypus_bear' | 'moose_lion';
export type EnemyLook =
  | 'fire_soldier'
  | 'fire_elite'
  | 'fire_archer'
  | 'fire_commander'
  | 'bandit'
  | 'bandit_spear'
  | 'bandit_archer'
  | 'dai_li'
  | 'dai_li_captain'
  | 'water_pirate'
  | 'pirate'
  | 'pirate_captain';
export type PropId = 'helmet' | 'helmet_crest' | 'conical_hat' | 'stone_gloves' | 'spear' | 'bow' | 'quiver' | 'club' | 'dao' | 'bandana' | 'staff';
export type EnemyRank = 'minion' | 'elite' | 'boss';

export interface EnemyTechnique {
  /** Registered bending technique id or an AI attack id (`atk_*`). */
  id: string;
  /** Relative selection weight. 0 = only used as a fallback (e.g. melee for a waterbender without water). */
  weight: number;
  /** Usable distance band (m). */
  min?: number;
  max?: number;
  /** Extra AI cooldown after use (s), on top of the technique's own cooldown. */
  cooldown?: number;
  /** Telegraph seconds before the cast: a readable windup the player can dodge or block. */
  tell?: number;
  /** Consecutive casts in one burst (combo steps). */
  burst?: [number, number];
  /** Charge 0..1 passed to charged (heavy) techniques. */
  charge?: number;
  /** Defensive technique: used in reaction to the player's attacks rather than offensively. */
  defensive?: boolean;
}

export interface EnemyBehaviour {
  /** 0..1 how often it presses the attack when it holds an attack token. */
  aggression: number;
  /** Preferred engagement distance (m). */
  preferred: number;
  /** Backs off when the target is closer than this (m). */
  minRange: number;
  /** 0..1 tendency to circle/strafe around the target. */
  strafe: number;
  /** Chance to guard against a readable attack. */
  block: number;
  /** Chance to dodge a committed windup / incoming projectile. */
  dodge: number;
  /** HP fraction that triggers a retreat episode (0 = never). */
  retreatAt: number;
  /** HP fraction at which it breaks and flees (0 = never). */
  fleeAt: number;
  /** What a beaten enemy does (no gore: humans kneel or flee, beasts flee). */
  surrender: 'kneel' | 'flee' | 'mixed';
  /** Shouts to alert nearby allies when it spots the player. */
  callAllies: boolean;
  /** Sight range (m) and field of view (degrees). */
  sight: number;
  fov: number;
  /** Hearing multiplier (1 = normal). */
  hearing: number;
  /** Max chase distance from home before it gives up and returns (m). */
  leash: number;
}

export interface LootEntry {
  item: string;
  chance: number;
  count?: [number, number];
}

export interface BossPhase {
  /** Enters this phase when HP fraction drops to or below `at`. */
  at: number;
  name: string;
  /** Banner / toast text. */
  text: string;
  /** Techniques added in this phase. */
  techniques?: EnemyTechnique[];
  speedMul?: number;
  powerMul?: number;
  /** Multiplier on AI cooldowns and tells (lower = faster). */
  tempoMul?: number;
  /** Archetypes summoned when the phase starts. */
  summon?: string[];
}

export interface EnemyArchetype {
  id: string;
  name: string;
  /** Shown under the name plate of elites and bosses. */
  title?: string;
  faction: EnemyFaction;
  body: EnemyBody;
  /** Bending element (null = non-bender). */
  element: Element | null;
  look?: EnemyLook;
  props?: PropId[];
  /** Tags emitted with entity:killed (quests count them). */
  tags: string[];
  rank: EnemyRank;
  /** Base stats at level 1. */
  hp: number;
  poise: number;
  /** Damage multiplier for the techniques it casts. */
  power: number;
  /** Incoming damage multiplier (armour). */
  armor?: number;
  speed: { walk: number; run: number };
  chi?: number;
  /** Model scale (bosses are a little larger). */
  scale?: number;
  techniques: EnemyTechnique[];
  behaviour: EnemyBehaviour;
  loot: { coins: [number, number]; items: LootEntry[] };
  xp: number;
  phases?: BossPhase[];
}

const human = (b: Partial<EnemyBehaviour>): EnemyBehaviour => ({
  aggression: 0.6,
  preferred: 8,
  minRange: 3,
  strafe: 0.5,
  block: 0.2,
  dodge: 0.2,
  retreatAt: 0.3,
  fleeAt: 0,
  surrender: 'kneel',
  callAllies: true,
  sight: 32,
  fov: 120,
  hearing: 1,
  leash: 48,
  ...b,
});

export const ENEMY_ARCHETYPES: Record<string, EnemyArchetype> = {
  // ---------------------------------------------------------------- Fire Nation
  fire_soldier: {
    id: 'fire_soldier', name: 'Fire Nation Soldier', faction: 'fire_nation', body: 'humanoid', element: 'fire', look: 'fire_soldier', props: ['helmet'],
    tags: ['fire_soldier', 'fire_nation', 'human', 'bender'], rank: 'minion',
    hp: 70, poise: 32, power: 0.36, speed: { walk: 1.6, run: 4.6 },
    techniques: [
      { id: 'fire_jab', weight: 3, max: 15, tell: 0.4, burst: [2, 3] },
      { id: 'fire_blast', weight: 1.2, min: 5, max: 22, tell: 0.8, charge: 0.6, cooldown: 2 },
    ],
    behaviour: human({ preferred: 9, minRange: 4, strafe: 0.6, block: 0.25, dodge: 0.2 }),
    loot: { coins: [6, 14], items: [{ item: 'fn_insignia', chance: 0.3 }, { item: 'healing_herbs', chance: 0.12 }, { item: 'fire_flakes', chance: 0.15 }] },
    xp: 30,
  },
  fire_elite: {
    id: 'fire_elite', name: 'Agni Kai Duelist', title: 'Fire Nation Elite', faction: 'fire_nation', body: 'humanoid', element: 'fire', look: 'fire_elite',
    tags: ['fire_elite', 'fire_soldier', 'fire_nation', 'human', 'bender', 'elite'], rank: 'elite',
    hp: 140, poise: 55, power: 0.5, speed: { walk: 1.8, run: 5.4 }, chi: 140,
    techniques: [
      { id: 'fire_jab', weight: 2, max: 14, tell: 0.28, burst: [3, 4] },
      { id: 'fire_dash', weight: 0.8, min: 7, max: 14, tell: 0.25, cooldown: 3 },
      { id: 'spinning_flame_kick', weight: 1.2, max: 5.5, tell: 0.45, cooldown: 2 },
      { id: 'fire_stream', weight: 0.8, min: 3, max: 9, tell: 0.5, cooldown: 3 },
    ],
    behaviour: human({ aggression: 0.8, preferred: 5.5, minRange: 2, strafe: 0.7, block: 0.4, dodge: 0.45, retreatAt: 0.25, sight: 36, leash: 55 }),
    loot: { coins: [20, 40], items: [{ item: 'fn_insignia', chance: 0.8 }, { item: 'jasmine_tea', chance: 0.35 }, { item: 'healing_herbs', chance: 0.3 }] },
    xp: 85,
  },
  fire_archer: {
    id: 'fire_archer', name: 'Yuyan Archer', faction: 'fire_nation', body: 'humanoid', element: null, look: 'fire_archer', props: ['bow', 'quiver'],
    tags: ['archer', 'fire_nation', 'human'], rank: 'minion',
    hp: 55, poise: 24, power: 0.6, speed: { walk: 1.7, run: 4.8 },
    techniques: [{ id: 'atk_arrow', weight: 3, min: 6, max: 42, tell: 0.8, burst: [1, 2], cooldown: 0.6 }],
    behaviour: human({ aggression: 0.7, preferred: 22, minRange: 11, strafe: 0.35, block: 0, dodge: 0.3, retreatAt: 0.4, fleeAt: 0.15, surrender: 'flee', sight: 46, fov: 110 }),
    loot: { coins: [5, 12], items: [{ item: 'fn_insignia', chance: 0.25 }, { item: 'jasmine_tea', chance: 0.12 }] },
    xp: 35,
  },
  // ---------------------------------------------------------------- Earth Kingdom bandits
  earth_bandit: {
    id: 'earth_bandit', name: 'Earthbender Bandit', faction: 'earth_bandit', body: 'humanoid', element: 'earth', look: 'bandit', props: ['bandana'],
    tags: ['bandit', 'earth_bandit', 'human', 'bender'], rank: 'minion',
    hp: 78, poise: 40, power: 0.38, speed: { walk: 1.5, run: 4.3 },
    techniques: [
      { id: 'earth_strike', weight: 3, max: 18, tell: 0.45, burst: [1, 3] },
      { id: 'earth_pillar', weight: 1, min: 4, max: 15, tell: 0.6, cooldown: 3 },
    ],
    behaviour: human({ preferred: 10, minRange: 4, strafe: 0.45, block: 0.2, dodge: 0.12, retreatAt: 0.35, fleeAt: 0.18, surrender: 'mixed' }),
    loot: { coins: [8, 18], items: [{ item: 'jade_shard', chance: 0.12 }, { item: 'healing_herbs', chance: 0.15 }, { item: 'cabbage', chance: 0.2 }] },
    xp: 30,
  },
  bandit_spearman: {
    id: 'bandit_spearman', name: 'Bandit Spearman', faction: 'earth_bandit', body: 'humanoid', element: null, look: 'bandit_spear', props: ['spear'],
    tags: ['bandit', 'spearman', 'human'], rank: 'minion',
    hp: 82, poise: 36, power: 0.55, speed: { walk: 1.6, run: 4.9 },
    techniques: [{ id: 'atk_spear_lunge', weight: 3, max: 3.4, tell: 0.45, burst: [1, 3] }],
    behaviour: human({ aggression: 0.75, preferred: 2.6, minRange: 1.1, strafe: 0.4, block: 0.3, dodge: 0.2, retreatAt: 0, fleeAt: 0.2, surrender: 'mixed' }),
    loot: { coins: [6, 15], items: [{ item: 'healing_herbs', chance: 0.15 }, { item: 'jade_shard', chance: 0.08 }] },
    xp: 28,
  },
  bandit_archer: {
    id: 'bandit_archer', name: 'Bandit Archer', faction: 'earth_bandit', body: 'humanoid', element: null, look: 'bandit_archer', props: ['bow', 'quiver'],
    tags: ['bandit', 'archer', 'human'], rank: 'minion',
    hp: 52, poise: 22, power: 0.55, speed: { walk: 1.6, run: 4.6 },
    techniques: [{ id: 'atk_arrow', weight: 3, min: 6, max: 38, tell: 0.9, burst: [1, 2], cooldown: 0.8 }],
    behaviour: human({ preferred: 20, minRange: 10, strafe: 0.35, block: 0, dodge: 0.25, retreatAt: 0.4, fleeAt: 0.2, surrender: 'flee', sight: 42 }),
    loot: { coins: [5, 12], items: [{ item: 'healing_herbs', chance: 0.12 }] },
    xp: 30,
  },
  // ---------------------------------------------------------------- Dai Li
  dai_li_agent: {
    id: 'dai_li_agent', name: 'Dai Li Agent', faction: 'dai_li', body: 'humanoid', element: 'earth', look: 'dai_li', props: ['conical_hat', 'stone_gloves'],
    tags: ['dai_li', 'earth', 'human', 'bender'], rank: 'minion',
    hp: 95, poise: 45, power: 0.42, speed: { walk: 1.7, run: 5.0 }, chi: 120,
    techniques: [
      { id: 'earth_strike', weight: 3, max: 20, tell: 0.35, burst: [2, 3] },
      { id: 'earth_pillar', weight: 0.8, min: 4, max: 16, tell: 0.5, cooldown: 3 },
      { id: 'stone_wall', weight: 0, max: 30, tell: 0.1, defensive: true, cooldown: 4 },
    ],
    behaviour: human({ aggression: 0.65, preferred: 12, minRange: 5, strafe: 0.6, block: 0.35, dodge: 0.25, retreatAt: 0.3, sight: 38 }),
    loot: { coins: [12, 24], items: [{ item: 'dai_li_seal', chance: 0.35 }, { item: 'jade_shard', chance: 0.2 }] },
    xp: 45,
  },
  // ---------------------------------------------------------------- Pirates
  water_pirate: {
    id: 'water_pirate', name: 'Rogue Waterbender', faction: 'pirate', body: 'humanoid', element: 'water', look: 'water_pirate', props: ['staff'],
    tags: ['pirate', 'waterbender', 'human', 'bender'], rank: 'minion',
    hp: 72, poise: 34, power: 0.42, speed: { walk: 1.6, run: 4.7 },
    techniques: [
      { id: 'water_whip', weight: 3, max: 9, tell: 0.32, burst: [2, 3] },
      { id: 'water_blast', weight: 1.2, min: 4, max: 20, tell: 0.65, charge: 0.5, cooldown: 2 },
      { id: 'ice_shards', weight: 1, min: 5, max: 18, tell: 0.5, cooldown: 3 },
      // Melee fallback when no water is within reach.
      { id: 'atk_staff', weight: 0, max: 2.6, tell: 0.4, burst: [1, 2] },
    ],
    behaviour: human({ preferred: 7, minRange: 3, strafe: 0.55, block: 0.15, dodge: 0.3, retreatAt: 0.3, fleeAt: 0.15, surrender: 'mixed' }),
    loot: { coins: [8, 18], items: [{ item: 'raw_fish', chance: 0.25 }, { item: 'pirate_chart', chance: 0.12 }, { item: 'sea_prunes', chance: 0.15 }] },
    xp: 35,
  },
  pirate: {
    id: 'pirate', name: 'Pirate Raider', faction: 'pirate', body: 'humanoid', element: null, look: 'pirate', props: ['club', 'bandana'],
    tags: ['pirate', 'human'], rank: 'minion',
    hp: 72, poise: 34, power: 0.5, speed: { walk: 1.6, run: 4.8 },
    techniques: [{ id: 'atk_club_combo', weight: 3, max: 2.6, tell: 0.38, burst: [2, 3] }],
    behaviour: human({ aggression: 0.75, preferred: 2.2, minRange: 1, strafe: 0.4, block: 0.3, dodge: 0.15, retreatAt: 0, fleeAt: 0.2, surrender: 'mixed' }),
    loot: { coins: [8, 20], items: [{ item: 'pirate_chart', chance: 0.1 }, { item: 'sea_prunes', chance: 0.15 }] },
    xp: 28,
  },
  // ---------------------------------------------------------------- Beasts (subdued, never killed)
  platypus_bear: {
    id: 'platypus_bear', name: 'Platypus Bear', faction: 'beast', body: 'platypus_bear', element: null,
    tags: ['beast', 'platypus_bear'], rank: 'elite',
    hp: 170, poise: 90, power: 0.75, speed: { walk: 2.0, run: 6.8 },
    techniques: [
      { id: 'atk_beast_swipe', weight: 3, max: 3.4, tell: 0.45, burst: [1, 2] },
      { id: 'atk_beast_charge', weight: 1, min: 6, max: 18, tell: 0.85, cooldown: 4 },
      { id: 'atk_beast_roar', weight: 0.5, max: 9, tell: 0.5, cooldown: 12 },
    ],
    behaviour: { aggression: 0.8, preferred: 2.6, minRange: 0, strafe: 0.2, block: 0, dodge: 0, retreatAt: 0, fleeAt: 0.22, surrender: 'flee', callAllies: false, sight: 24, fov: 160, hearing: 1.4, leash: 40 },
    loot: { coins: [0, 0], items: [{ item: 'beast_claw', chance: 0.6 }, { item: 'raw_fish', chance: 0.4, count: [1, 2] }] },
    xp: 70,
  },
  moose_lion: {
    id: 'moose_lion', name: 'Sabertooth Moose Lion', faction: 'beast', body: 'moose_lion', element: null,
    tags: ['beast', 'sabertooth_moose_lion'], rank: 'elite',
    hp: 230, poise: 110, power: 0.85, speed: { walk: 2.2, run: 8.2 },
    techniques: [
      { id: 'atk_beast_swipe', weight: 2.5, max: 3.8, tell: 0.42, burst: [1, 2] },
      { id: 'atk_beast_charge', weight: 1.4, min: 6, max: 22, tell: 0.8, cooldown: 3.5 },
      { id: 'atk_beast_roar', weight: 0.6, max: 10, tell: 0.55, cooldown: 12 },
    ],
    behaviour: { aggression: 0.85, preferred: 3, minRange: 0, strafe: 0.25, block: 0, dodge: 0, retreatAt: 0, fleeAt: 0.2, surrender: 'flee', callAllies: false, sight: 30, fov: 150, hearing: 1.4, leash: 45 },
    loot: { coins: [0, 0], items: [{ item: 'beast_claw', chance: 0.8, count: [1, 2] }] },
    xp: 95,
  },
  // ---------------------------------------------------------------- Bosses
  boss_fire_commander: {
    id: 'boss_fire_commander', name: 'Commander Rokuro', title: 'Fire Nation Commander', faction: 'fire_nation', body: 'humanoid', element: 'fire', look: 'fire_commander', props: ['helmet_crest'],
    tags: ['boss', 'boss_fire_commander', 'fire_nation', 'fire_soldier', 'human', 'bender'], rank: 'boss',
    hp: 520, poise: 150, power: 0.68, speed: { walk: 1.7, run: 5.0 }, chi: 200, scale: 1.1,
    techniques: [
      { id: 'fire_jab', weight: 2, max: 15, tell: 0.32, burst: [3, 4] },
      { id: 'fire_blast', weight: 1.2, min: 4, max: 24, tell: 0.75, charge: 0.85, cooldown: 2 },
      { id: 'flame_sweep', weight: 1, max: 6, tell: 0.45, cooldown: 2 },
    ],
    behaviour: human({ aggression: 0.8, preferred: 8, minRange: 3, strafe: 0.55, block: 0.35, dodge: 0.3, retreatAt: 0, sight: 40, leash: 45 }),
    phases: [
      { at: 0.66, name: 'Reinforcements', text: 'Commander Rokuro calls for reinforcements!', summon: ['fire_soldier', 'fire_archer'], techniques: [{ id: 'fire_stream', weight: 1, min: 3, max: 9, tell: 0.5, cooldown: 3 }, { id: 'fire_dash', weight: 0.7, min: 7, max: 14, tell: 0.25, cooldown: 4 }] },
      { at: 0.33, name: 'Inferno', text: "Rokuro's flames burn white-hot!", powerMul: 1.25, tempoMul: 0.7, speedMul: 1.15, techniques: [{ id: 'spinning_flame_kick', weight: 1.2, max: 5.5, tell: 0.4, cooldown: 2 }, { id: 'explosive_finisher', weight: 0.8, min: 3, max: 10, tell: 0.6, cooldown: 6 }] },
    ],
    loot: { coins: [140, 200], items: [{ item: 'fn_insignia', chance: 1, count: [2, 3] }, { item: 'healing_herbs', chance: 1, count: [2, 3] }, { item: 'jasmine_tea', chance: 1 }] },
    xp: 420,
  },
  boss_dai_li_captain: {
    id: 'boss_dai_li_captain', name: 'Captain Shen Lao', title: 'Dai Li Captain', faction: 'dai_li', body: 'humanoid', element: 'earth', look: 'dai_li_captain', props: ['conical_hat', 'stone_gloves'],
    tags: ['boss', 'boss_dai_li_captain', 'dai_li', 'human', 'bender'], rank: 'boss',
    hp: 560, poise: 170, power: 0.68, speed: { walk: 1.8, run: 5.2 }, chi: 220, scale: 1.08,
    techniques: [
      { id: 'earth_strike', weight: 3, max: 20, tell: 0.3, burst: [2, 3] },
      { id: 'earth_pillar', weight: 1, min: 4, max: 16, tell: 0.45, cooldown: 2.5 },
      { id: 'stone_wall', weight: 0, max: 30, tell: 0.1, defensive: true, cooldown: 3 },
    ],
    behaviour: human({ aggression: 0.75, preferred: 11, minRange: 4, strafe: 0.6, block: 0.45, dodge: 0.3, retreatAt: 0, sight: 40, leash: 45 }),
    phases: [
      { at: 0.66, name: 'Agents of the Earth King', text: 'Captain Shen Lao summons his agents!', summon: ['dai_li_agent', 'dai_li_agent'], techniques: [{ id: 'ground_spikes', weight: 1, min: 4, max: 15, tell: 0.5, cooldown: 4 }] },
      { at: 0.33, name: 'Avalanche', text: 'The ground itself turns against you!', powerMul: 1.25, tempoMul: 0.7, speedMul: 1.1, techniques: [{ id: 'boulder_roll', weight: 1, min: 5, max: 20, tell: 0.6, cooldown: 5 }] },
    ],
    loot: { coins: [150, 220], items: [{ item: 'dai_li_seal', chance: 1, count: [1, 2] }, { item: 'jade_shard', chance: 1, count: [2, 4] }, { item: 'healing_herbs', chance: 1, count: [2, 3] }] },
    xp: 450,
  },
  boss_pirate_captain: {
    id: 'boss_pirate_captain', name: 'Captain Kurou', title: 'The Sea Viper', faction: 'pirate', body: 'humanoid', element: null, look: 'pirate_captain', props: ['dao'],
    tags: ['boss', 'boss_pirate_captain', 'pirate', 'human'], rank: 'boss',
    hp: 480, poise: 140, power: 0.72, speed: { walk: 1.8, run: 5.6 }, scale: 1.08,
    techniques: [
      { id: 'atk_dao_flurry', weight: 3, max: 3, tell: 0.32, burst: [3, 4] },
      { id: 'atk_bomb', weight: 1, min: 6, max: 22, tell: 0.7, cooldown: 3 },
    ],
    behaviour: human({ aggression: 0.8, preferred: 2.6, minRange: 1, strafe: 0.55, block: 0.4, dodge: 0.4, retreatAt: 0, sight: 38, leash: 45 }),
    phases: [
      { at: 0.66, name: 'All Hands', text: 'The Sea Viper whistles for his crew!', summon: ['water_pirate', 'pirate'], techniques: [{ id: 'atk_spear_lunge', weight: 1, max: 4, tell: 0.35 }] },
      { at: 0.33, name: 'Powder Keg', text: 'Captain Kurou lights his last fuses!', powerMul: 1.3, tempoMul: 0.65, speedMul: 1.15, techniques: [{ id: 'atk_bomb', weight: 1.6, min: 4, max: 22, tell: 0.55, cooldown: 2 }] },
    ],
    loot: { coins: [160, 240], items: [{ item: 'pirate_chart', chance: 1, count: [1, 2] }, { item: 'healing_herbs', chance: 1, count: [2, 3] }, { item: 'pai_sho_tile', chance: 0.6 }] },
    xp: 440,
  },
};

export function archetype(id: string): EnemyArchetype | undefined {
  return ENEMY_ARCHETYPES[id];
}

/** Danger rating (1 easy .. 5 hard) per region; scales enemy levels. Wilderness (no region) uses DEFAULT_DANGER. */
export const REGION_DANGER: Record<string, number> = {
  northern_water_tribe: 1,
  frozen_tundra: 2,
  ba_sing_se: 2,
  earth_heartland: 1,
  omashu: 2,
  foggy_swamp: 3,
  si_wong_desert: 3,
  fire_nation_capital: 3,
  ember_island: 2,
  southern_air_temple: 1,
  southern_water_tribe: 1,
  kyoshi_island: 1,
  meditation_isle: 0,
};
export const DEFAULT_DANGER = 2;

// -----------------------------------------------------------------------------
// Encounters
// -----------------------------------------------------------------------------

/** Encounter zone: picked from the location (region nation, biome, coast, landmarks). */
export type EncounterZone = 'fire' | 'earth' | 'laogai' | 'coast' | 'polar' | 'swamp' | 'desert' | 'wild';

export interface EncounterTemplate {
  kind: 'camp' | 'patrol' | 'ambush' | 'beast';
  members: string[];
  weight: number;
}

export const ENCOUNTER_TABLES: Record<EncounterZone, EncounterTemplate[]> = {
  fire: [
    { kind: 'camp', members: ['fire_soldier', 'fire_soldier', 'fire_archer'], weight: 3 },
    { kind: 'camp', members: ['fire_soldier', 'fire_elite'], weight: 1.5 },
    { kind: 'patrol', members: ['fire_soldier', 'fire_soldier'], weight: 2 },
    { kind: 'ambush', members: ['fire_archer', 'fire_archer', 'fire_soldier'], weight: 1 },
  ],
  earth: [
    { kind: 'camp', members: ['earth_bandit', 'earth_bandit', 'bandit_spearman'], weight: 3 },
    { kind: 'camp', members: ['bandit_spearman', 'bandit_spearman', 'bandit_archer'], weight: 2 },
    { kind: 'ambush', members: ['earth_bandit', 'bandit_spearman', 'bandit_archer'], weight: 1.5 },
    { kind: 'beast', members: ['platypus_bear'], weight: 1 },
    { kind: 'beast', members: ['moose_lion'], weight: 0.8 },
  ],
  laogai: [
    { kind: 'camp', members: ['dai_li_agent', 'dai_li_agent', 'dai_li_agent'], weight: 2 },
    { kind: 'patrol', members: ['dai_li_agent', 'dai_li_agent'], weight: 1 },
  ],
  coast: [
    { kind: 'camp', members: ['water_pirate', 'pirate', 'pirate'], weight: 3 },
    { kind: 'camp', members: ['water_pirate', 'water_pirate', 'pirate'], weight: 1.5 },
    { kind: 'ambush', members: ['pirate', 'pirate', 'water_pirate'], weight: 1 },
  ],
  polar: [
    { kind: 'camp', members: ['water_pirate', 'pirate', 'pirate'], weight: 2 },
    { kind: 'patrol', members: ['fire_soldier', 'fire_soldier', 'fire_archer'], weight: 1.5 },
  ],
  swamp: [
    { kind: 'camp', members: ['water_pirate', 'water_pirate', 'pirate'], weight: 2 },
    { kind: 'beast', members: ['platypus_bear'], weight: 2 },
  ],
  desert: [
    { kind: 'camp', members: ['earth_bandit', 'earth_bandit', 'bandit_archer'], weight: 2 },
    { kind: 'ambush', members: ['earth_bandit', 'bandit_spearman', 'bandit_spearman'], weight: 1.5 },
  ],
  wild: [
    { kind: 'beast', members: ['moose_lion'], weight: 1.5 },
    { kind: 'beast', members: ['platypus_bear'], weight: 1.5 },
    { kind: 'camp', members: ['earth_bandit', 'bandit_spearman', 'bandit_archer'], weight: 2 },
  ],
};

export interface BossEncounterDef {
  id: string;
  boss: string;
  guards: string[];
  x: number;
  z: number;
  label: string;
  /** Prefer a published spot with this id (region builders may author a better arena). */
  spot?: string;
}

/** Named bosses (fixed locations; spots override when a region publishes them). */
export const BOSS_ENCOUNTERS: BossEncounterDef[] = [
  { id: 'boss_fire_commander', boss: 'boss_fire_commander', guards: ['fire_soldier', 'fire_soldier', 'fire_archer'], x: -738, z: 652, label: 'Western Causeway gate', spot: 'camp_fire_commander' },
  { id: 'boss_dai_li_captain', boss: 'boss_dai_li_captain', guards: ['dai_li_agent', 'dai_li_agent'], x: 1118, z: 184, label: 'Lake Laogai shore', spot: 'camp_dai_li_captain' },
  { id: 'boss_pirate_captain', boss: 'boss_pirate_captain', guards: ['water_pirate', 'pirate', 'pirate'], x: 500, z: 1380, label: "Sea Viper's Cove", spot: 'camp_pirate_captain' },
];
