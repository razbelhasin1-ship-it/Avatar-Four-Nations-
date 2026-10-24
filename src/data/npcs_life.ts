import type { NPCDef } from '../npc/NPCTypes';

/**
 * City & village life + side-quest givers. Positions are relative to region
 * spots (giver_*, merchant_*, training_*, shrine_*...) or landmarks and are
 * resolved at boot by src/training/QuestWorld.ts (spots are published by the
 * region modules). Dialogues: src/data/dialogues_life.ts.
 *
 * Routines: schedule 'day' NPCs go indoors at night, 'night' ones appear only
 * after dark; civilians flee from fights (NPCSystem.alarm).
 */
export interface At {
  spot?: string;
  landmark?: string;
  x?: number;
  z?: number;
  dx?: number;
  dz?: number;
  y?: number;
}

export type LifeNPCSpec = Omit<NPCDef, 'x' | 'z' | 'y'> & { at: At };

type Mini = [id: string, name: string, role: NPCDef['role'], at: At, behavior: NPCDef['behavior'], extra?: Partial<LifeNPCSpec>];

function region(nation: NPCDef['nation'], regionId: string, dialogue: string, list: Mini[]): LifeNPCSpec[] {
  return list.map(([id, name, role, at, behavior, extra]) => ({
    id,
    name,
    role,
    nation,
    region: regionId,
    at,
    behavior,
    dialogue: role === 'child' ? 'dlg_life_child' : role === 'guard' || role === 'soldier' ? `dlg_life_guard_${nation}` : dialogue,
    schedule: role === 'guard' || role === 'soldier' ? 'always' : 'day',
    ...extra,
  }));
}

const wander = (r: number): NPCDef['behavior'] => ({ type: 'wander', radius: r });
const idle = (variant: 'stand' | 'sit' | 'meditate' | 'kneel' | 'work' | 'guard' = 'stand'): NPCDef['behavior'] => ({ type: 'idle', variant });

// ---------------------------------------------------------------------------
// Quest givers (one per side quest)
// ---------------------------------------------------------------------------

export const QUEST_GIVERS: LifeNPCSpec[] = [
  { id: 'qg_bss_fen', offers: 'sq_bss_grocer', name: 'Merchant Fen', title: 'Lower Ring Grocer', role: 'quest', nation: 'earth', region: 'ba_sing_se', at: { spot: 'merchant_bss_1', dx: 0, dz: 3.2 }, behavior: idle('work'), dialogue: 'dlg_qg_bss_fen' },
  { id: 'qg_omashu_cabbage', offers: 'sq_cabbage_cart', name: 'Cabbage Merchant', title: 'Unlucky Trader', role: 'quest', nation: 'earth', region: 'omashu', at: { spot: 'giver_omashu_gatekeeper', dx: 4, dz: 3 }, behavior: idle('stand'), dialogue: 'dlg_qg_omashu_cabbage', appearanceSeed: 9911 },
  { id: 'qg_nwt_messenger', offers: 'sq_letter', name: 'Messenger Tulok', title: 'Courier of the North', role: 'quest', nation: 'water', region: 'northern_water_tribe', at: { spot: 'giver_nwt_elder', dx: 3, dz: 1.5 }, behavior: idle('stand'), dialogue: 'dlg_qg_nwt_messenger' },
  { id: 'qg_swt_chief', name: 'Chief Hakoda', title: 'Chief of the Southern Tribe', role: 'quest', nation: 'water', region: 'southern_water_tribe', at: { spot: 'giver_swt_chief' }, behavior: idle('stand'), dialogue: 'dlg_qg_swt_chief' },
  { id: 'qg_fn_child', offers: 'sq_turtleduck', name: 'Little Ursa', title: 'Turtle-duck Keeper', role: 'child', nation: 'fire', region: 'fire_nation_capital', at: { landmark: 'fn_turtleduck_pond', dx: 6, dz: 10 }, behavior: idle('stand'), dialogue: 'dlg_qg_fn_child' },
  { id: 'qg_fn_sage', offers: 'sq_braziers', name: 'Sage Ryo', title: 'Keeper of the Braziers', role: 'quest', nation: 'fire', region: 'fire_nation_capital', at: { spot: 'shrine_fire_sages', dx: 0, dz: 3 }, behavior: idle('stand'), dialogue: 'dlg_qg_fn_sage' },
  { id: 'qg_air_bellkeeper', offers: 'sq_bells', name: 'Brother Sonam', title: 'Bell Keeper', role: 'monk', nation: 'air', region: 'southern_air_temple', at: { spot: 'shrine_air_bell', dx: 0, dz: 4.5 }, behavior: idle('meditate'), dialogue: 'dlg_qg_air_bellkeeper' },
  { id: 'qg_air_bisonkeeper', offers: 'sq_peaches', name: 'Sister Yeshe', title: 'Bison Keeper', role: 'monk', nation: 'air', region: 'southern_air_temple', at: { spot: 'shrine_bison_meadow', dx: 3, dz: 2 }, behavior: wander(4), dialogue: 'dlg_qg_air_bisonkeeper' },
  { id: 'qg_nwt_oasis', offers: 'sq_spirit_oasis', name: 'Moon Priestess Yue-Lan', title: 'Oasis Keeper', role: 'healer', nation: 'water', region: 'northern_water_tribe', at: { spot: 'giver_nwt_chief', dx: -4, dz: 0 }, behavior: idle('stand'), dialogue: 'dlg_qg_nwt_oasis' },
  { id: 'qg_tundra_scout', offers: 'sq_ice_caves', name: 'Scout Aput', title: 'Water Tribe Scout', role: 'guard', nation: 'water', region: 'frozen_tundra', at: { spot: 'giver_tundra_scout' }, behavior: idle('stand'), dialogue: 'dlg_qg_tundra_scout', schedule: 'always' },
  { id: 'qg_misty_scholar', offers: 'sq_buried_library', name: 'Professor Zei', title: 'Scholar of Ba Sing Se University', role: 'quest', nation: 'earth', region: 'si_wong_desert', at: { spot: 'giver_misty_cantina' }, behavior: idle('stand'), dialogue: 'dlg_qg_misty_scholar' },
  { id: 'qg_riverbend_elder', offers: 'sq_bandits', name: 'Elder Bo', title: 'Riverbend Village Elder', role: 'elder', nation: 'earth', region: 'earth_heartland', at: { spot: 'giver_riverbend_elder' }, behavior: idle('stand'), dialogue: 'dlg_qg_riverbend_elder' },
  { id: 'qg_kyoshi_captain', offers: 'sq_kyoshi_fans', name: 'Captain Suki', title: 'Kyoshi Warriors', role: 'guard', nation: 'earth', region: 'kyoshi_island', at: { spot: 'giver_kyoshi_suki' }, behavior: idle('guard'), dialogue: 'dlg_qg_kyoshi_captain', schedule: 'always' },
  { id: 'qg_ember_playwright', offers: 'sq_ember_script', name: 'Pu-On Tim', title: 'Ember Island Players', role: 'quest', nation: 'fire', region: 'ember_island', at: { spot: 'shrine_ember_theater', dx: 2, dz: 0 }, behavior: wander(3), dialogue: 'dlg_qg_ember_playwright' },
  { id: 'qg_air_pilgrim', offers: 'sq_pilgrim', name: 'Brother Norbu', title: 'Pilgrim', role: 'monk', nation: 'air', region: 'southern_air_temple', at: { spot: 'merchant_air_temple_2', dx: 3, dz: 2 }, behavior: idle('stand'), dialogue: 'dlg_qg_air_pilgrim' },
  { id: 'qg_air_pilgrim_top', name: 'Brother Norbu', title: 'Pilgrim', role: 'monk', nation: 'air', region: 'southern_air_temple', at: { spot: 'giver_air_elder', dx: 2.5, dz: -2 }, behavior: idle('meditate'), dialogue: 'dlg_qg_air_pilgrim_top', condition: { questActive: 'sq_pilgrim' }, appearanceSeed: 31337 },
];
// The pilgrim at the trailhead and at the top share a look.
QUEST_GIVERS.find((g) => g.id === 'qg_air_pilgrim')!.appearanceSeed = 31337;

// ---------------------------------------------------------------------------
// City life
// ---------------------------------------------------------------------------

export const CITY_LIFE: LifeNPCSpec[] = [
  // ---- Northern Water Tribe ----
  ...region('water', 'northern_water_tribe', 'dlg_life_nwt', [
    ['life_nwt_1', 'Kallik', 'villager', { spot: 'merchant_nwt_1', dx: 2.5, dz: -2 }, wander(5)],
    ['life_nwt_2', 'Malu', 'villager', { spot: 'merchant_nwt_2', dx: -2.5, dz: 2 }, { type: 'converse' }],
    ['life_nwt_3', 'Nanok', 'guard', { spot: 'giver_nwt_chief', dx: 4, dz: -3 }, idle('guard')],
    ['life_nwt_4', 'Ikaya', 'child', { spot: 'giver_nwt_elder', dx: -3, dz: 3 }, wander(6)],
    ['life_nwt_5', 'Yuka', 'student', { spot: 'training_siku', dx: 6, dz: 6 }, { type: 'train' }, { element: 'water' }],
    ['life_nwt_6', 'Aput', 'student', { spot: 'training_siku', dx: -6, dz: 6 }, { type: 'train' }, { element: 'water' }],
    ['life_nwt_7', 'Atka', 'healer', { spot: 'master_yugoda', dx: 2, dz: 2 }, idle('work')],
    ['life_nwt_8', 'Tulugaq', 'guard', { spot: 'merchant_nwt_3', dx: 3, dz: 0 }, idle('guard'), { schedule: 'night' }],
    ['life_nwt_9', 'Sedna', 'noble', { spot: 'giver_nwt_chief', dx: -3, dz: -4 }, idle('stand')],
  ]),
  // ---- Southern Water Tribe ----
  ...region('water', 'southern_water_tribe', 'dlg_life_swt', [
    ['life_swt_1', 'Nuka', 'villager', { spot: 'merchant_swt_1', dx: -3, dz: 2 }, wander(5)],
    ['life_swt_2', 'Gran-Gran Kya', 'elder', { spot: 'giver_swt_chief', dx: -3, dz: 3 }, idle('sit')],
    ['life_swt_3', 'Siki', 'child', { spot: 'giver_swt_chief', dx: 4, dz: -4 }, wander(6)],
    ['life_swt_4', 'Bato', 'guard', { spot: 'giver_swt_chief', dx: 2, dz: 5 }, idle('guard')],
    ['life_swt_5', 'Ahnah', 'student', { spot: 'training_akka', dx: 7, dz: 3 }, { type: 'train' }, { element: 'water' }],
  ]),
  // ---- Ba Sing Se ----
  ...region('earth', 'ba_sing_se', 'dlg_life_bss', [
    ['life_bss_1', 'Shu', 'villager', { spot: 'merchant_bss_1', dx: 3, dz: -3 }, wander(6)],
    ['life_bss_2', 'Lee', 'villager', { spot: 'merchant_bss_2', dx: 3, dz: 2 }, { type: 'converse' }],
    ['life_bss_3', 'Kuei', 'child', { spot: 'merchant_bss_1', dx: 5, dz: 1 }, wander(7)],
    ['life_bss_4', 'Officer Long', 'guard', { spot: 'giver_bss_elder', dx: 4, dz: 0 }, idle('guard')],
    ['life_bss_5', 'Joo Dee', 'noble', { spot: 'merchant_bss_tea', dx: 1.5, dz: -2 }, idle('stand')],
    ['life_bss_6', 'Haru', 'student', { spot: 'training_lien', dx: 4, dz: 5 }, { type: 'train' }, { element: 'earth' }],
    ['life_bss_7', 'Tyro', 'student', { spot: 'training_lien', dx: -4, dz: -5 }, { type: 'train' }, { element: 'earth' }],
    ['life_bss_8', 'Mrs. Song', 'villager', { spot: 'merchant_bss_3', dx: 2, dz: 2 }, wander(4)],
    ['life_bss_9', 'Lantern Lighter Pao', 'villager', { spot: 'merchant_bss_4', dx: -2, dz: 2 }, wander(5), { schedule: 'night' }],
    ['life_bss_10', 'Soldier Kwan', 'soldier', { spot: 'giver_bss_elder', dx: -5, dz: 4 }, idle('guard')],
  ]),
  // ---- Gaoling & Riverbend ----
  ...region('earth', 'earth_heartland', 'dlg_life_gaoling', [
    ['life_gao_1', 'Xin Fu', 'villager', { spot: 'merchant_gaoling_1', dx: 0, dz: 4 }, wander(4)],
    ['life_gao_2', 'Toph Fan', 'child', { spot: 'merchant_gaoling_2', dx: -2, dz: 4 }, wander(6)],
    ['life_gao_3', 'Estate Guard', 'guard', { spot: 'giver_gaoling_lord', dx: 0, dz: 2 }, idle('guard')],
    ['life_gao_4', 'Lady Poppy', 'noble', { spot: 'giver_gaoling_lord', dx: 2, dz: -2 }, idle('stand')],
  ]),
  ...region('earth', 'earth_heartland', 'dlg_life_riverbend', [
    ['life_rb_1', 'Farmer Ho', 'villager', { spot: 'merchant_riverbend_1', dx: -3, dz: 0 }, wander(5)],
    ['life_rb_2', 'Mei', 'child', { spot: 'giver_riverbend_elder', dx: 3, dz: 3 }, wander(6)],
    ['life_rb_3', 'Old Ling', 'elder', { spot: 'giver_riverbend_elder', dx: -2, dz: 3 }, idle('sit')],
  ]),
  // ---- Omashu & Kyoshi & Misty Palms ----
  ...region('earth', 'omashu', 'dlg_life_omashu', [
    ['life_om_1', 'Omashu Guard', 'guard', { spot: 'giver_omashu_gatekeeper', dx: -3, dz: 0 }, idle('guard')],
    ['life_om_2', 'Flopsie Fan', 'villager', { spot: 'merchant_omashu_1', dx: 3, dz: 2 }, wander(5)],
    ['life_om_3', 'Courtier Wei', 'noble', { spot: 'giver_omashu_advisor', dx: 2, dz: 0 }, idle('stand')],
    ['life_om_4', 'Ting', 'child', { spot: 'merchant_omashu_2', dx: -3, dz: 2 }, wander(6)],
  ]),
  ...region('earth', 'kyoshi_island', 'dlg_life_kyoshi', [
    ['life_ky_1', 'Koko', 'child', { spot: 'merchant_kyoshi_1', dx: 3, dz: 2 }, wander(6)],
    ['life_ky_2', 'Kyoshi Warrior', 'guard', { spot: 'giver_kyoshi_suki', dx: 3, dz: 0 }, { type: 'train' }, { element: 'earth' }],
    ['life_ky_3', 'Fisherman Oyo', 'villager', { spot: 'merchant_kyoshi_1', dx: -2, dz: -3 }, wander(4)],
  ]),
  ...region('neutral', 'si_wong_desert', 'dlg_life_misty', [
    ['life_mp_1', 'Sand-sailer', 'villager', { spot: 'merchant_misty_2', dx: 3, dz: 2 }, wander(5)],
    ['life_mp_2', 'Thirsty Traveller', 'villager', { spot: 'giver_misty_cantina', dx: 3, dz: -2 }, idle('sit')],
  ]),
  // ---- Fire Nation Capital & Ember Island ----
  ...region('fire', 'fire_nation_capital', 'dlg_life_fn', [
    ['life_fn_1', 'Kei', 'villager', { spot: 'merchant_fn_1', dx: 2, dz: 2 }, wander(5)],
    ['life_fn_2', 'Lady Ilah', 'noble', { spot: 'merchant_fn_2', dx: -2, dz: 2 }, { type: 'converse' }],
    ['life_fn_3', 'Palace Guard', 'soldier', { spot: 'giver_fn_elder', dx: 5, dz: -3 }, idle('guard')],
    ['life_fn_4', 'Hide', 'child', { spot: 'giver_fn_elder', dx: -4, dz: 4 }, wander(7)],
    ['life_fn_5', 'Fire Cadet', 'student', { spot: 'training_jeong', dx: 6, dz: 5 }, { type: 'train' }, { element: 'fire' }],
    ['life_fn_6', 'Fire Cadet', 'student', { spot: 'training_jeong', dx: -6, dz: 5 }, { type: 'train' }, { element: 'fire' }],
    ['life_fn_7', 'Harbor Hand', 'villager', { spot: 'merchant_fn_3', dx: 3, dz: -2 }, wander(5)],
    ['life_fn_8', 'Night Patrol', 'soldier', { spot: 'merchant_fn_1', dx: -3, dz: -3 }, wander(8), { schedule: 'night' }],
    ['life_fn_9', 'Sun Warrior', 'student', { spot: 'training_ahkon', dx: 7, dz: 4 }, { type: 'train' }, { element: 'fire' }],
  ]),
  ...region('fire', 'ember_island', 'dlg_life_ember', [
    ['life_em_1', 'Beachgoer Chan', 'villager', { spot: 'merchant_ember_1', dx: 3, dz: 0 }, wander(6)],
    ['life_em_2', 'Ruon-Jian', 'noble', { spot: 'merchant_ember_1', dx: -3, dz: 2 }, { type: 'converse' }],
    ['life_em_3', 'Sandcastle Kid', 'child', { spot: 'merchant_ember_1', dx: 0, dz: 5 }, wander(6)],
  ]),
  // ---- Southern Air Temple ----
  ...region('air', 'southern_air_temple', 'dlg_life_air', [
    ['life_air_1', 'Monk Gyatso the Younger', 'monk', { spot: 'merchant_air_temple_1', dx: 3, dz: -3 }, wander(5)],
    ['life_air_2', 'Novice Kunga', 'child', { spot: 'giver_air_elder', dx: -3, dz: 4 }, wander(7)],
    ['life_air_3', 'Novice Dorje', 'student', { spot: 'training_tenzo', dx: 6, dz: 3 }, { type: 'train' }, { element: 'air' }],
    ['life_air_4', 'Novice Pema', 'student', { spot: 'training_iio', dx: -6, dz: 3 }, { type: 'train' }, { element: 'air' }],
    ['life_air_5', 'Monk Lobsang', 'monk', { spot: 'shrine_air_bell', dx: 4, dz: -2 }, idle('meditate')],
  ]),
];

export const LIFE_NPCS: LifeNPCSpec[] = [...QUEST_GIVERS, ...CITY_LIFE];
