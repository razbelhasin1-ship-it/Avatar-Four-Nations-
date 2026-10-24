import type { At } from './npcs_life';

/**
 * Quest props streamed by src/training/QuestWorld.ts. Completing a prop sets
 * flag `prop_<id>` (+ `flag`), gives `item`, reveals `reveal` on the map, starts
 * `startQuest`, and emits world:interact { kind: event ?? 'quest_<kind>' }.
 *  - pickup / read / meditate: interact (E)
 *  - bell: ring it with an airbending hit · brazier: light it with a firebending hit
 */
export interface QuestPropDef {
  id: string;
  kind: 'pickup' | 'read' | 'meditate' | 'bell' | 'brazier';
  at: At;
  label: string;
  /** Present while this quest is active (optionally only during step `step`). */
  quest?: string;
  step?: string;
  /** Present until done even without the quest (clues that start their quest). */
  always?: boolean;
  item?: string;
  count?: number;
  flag?: string;
  startQuest?: string;
  reveal?: string;
  text?: string;
  event?: string;
  look?: 'cabbage' | 'fan' | 'scroll' | 'page' | 'letter' | 'crystal' | 'peach' | 'duck' | 'bundle' | 'poster' | 'book' | 'tablet';
  yaw?: number;
}

const ring = (n: number, r: number, a0 = 0): Array<{ dx: number; dz: number }> => Array.from({ length: n }, (_, i) => ({ dx: Math.cos(a0 + (i / n) * Math.PI * 2) * r, dz: Math.sin(a0 + (i / n) * Math.PI * 2) * r }));
/** n points on an arc of radius r, from angle a0 in steps of `step` radians. */
const arc = (n: number, r: number, a0: number, step: number): Array<{ dx: number; dz: number }> => Array.from({ length: n }, (_, i) => ({ dx: Math.cos(a0 + i * step) * r, dz: Math.sin(a0 + i * step) * r }));

export const QUEST_PROPS: QuestPropDef[] = [
  // ---- hidden-master clues (always present until read) ----
  {
    id: 'clue_hermit_tablet',
    kind: 'read',
    look: 'tablet',
    at: { spot: 'giver_air_elder', dx: 3.5, dz: 1.5 },
    label: 'Read the wind-worn tablet',
    always: true,
    quest: 'sq_hermit',
    flag: 'clue_hermit',
    startQuest: 'sq_hermit',
    reveal: 'wind_shrine',
    text: '“Where the north wind meets the south, and the east wind argues with the west, an old monk keeps a cup of tea warm for whoever is curious enough to climb. Follow the ledge east, beyond the wall.” — the carving is so worn it seems the wind itself wrote it.',
  },
  {
    id: 'clue_huu_journal',
    kind: 'read',
    look: 'book',
    at: { spot: 'giver_riverbend_elder', dx: -3, dz: -2.5 },
    label: 'Read the swamp-stained journal',
    always: true,
    quest: 'sq_huu',
    flag: 'clue_huu',
    startQuest: 'sq_huu',
    reveal: 'banyan_tree',
    text: '“...the vines took my boots, the mist took my map, but the old man at the Great Banyan Tree gave me tea brewed from swamp water and taught me that everything is connected. He bends the water INSIDE the plants. Southwest of here, past Lake Hiari, where the fog never lifts.” — a trader\'s journal, pages warped by damp.',
  },
  {
    id: 'clue_lin_poster',
    kind: 'read',
    look: 'poster',
    at: { spot: 'merchant_gaoling_1', dx: -3, dz: 1.5 },
    label: 'Read the Earth Rumble poster',
    always: true,
    quest: 'sq_lin',
    flag: 'clue_lin',
    startQuest: 'sq_lin',
    text: '“EARTH RUMBLE SIX! Tonight at the Gaoling ring! Can ANYONE defeat the undefeated BLIND BANDIT?! Prize: one sack of gold pieces (sack not included).” Someone has scribbled underneath: “she can feel you coming through the floor, don\'t bother.”',
  },
  // ---- sq_cabbage_cart: runaway cabbages around the Omashu gate (an arc over the open square: a full ring put one inside a house) ----
  ...arc(5, 7, 0.3, 0.9).map((o, i) => ({ id: `cabbage_${i}`, kind: 'pickup' as const, look: 'cabbage' as const, at: { spot: 'giver_omashu_gatekeeper', dx: 4 + o.dx, dz: 3 + o.dz }, label: 'Pick up the runaway cabbage', quest: 'sq_cabbage_cart', step: 'gather', item: 'stray_cabbage' })),
  // ---- sq_turtleduck ----
  { id: 'lost_turtleduck', kind: 'pickup', look: 'duck', at: { landmark: 'fn_turtleduck_pond', dx: -14, dz: -9 }, label: 'Pick up the lost turtle-duck', quest: 'sq_turtleduck', step: 'find', item: 'lost_turtleduck' },
  // ---- sq_braziers: four braziers around the Fire Sages' court ----
  ...ring(4, 8, Math.PI / 4).map((o, i) => ({ id: `sage_brazier_${i}`, kind: 'brazier' as const, at: { spot: 'training_hira', dx: o.dx, dz: o.dz }, label: 'Sacred brazier', quest: 'sq_braziers', step: 'light' })),
  // ---- sq_bells: three bells around the great-bell pavilion ----
  ...[{ dx: -5.5, dz: 2 }, { dx: 5.5, dz: 2 }, { dx: 0, dz: 7 }].map((o, i) => ({ id: `temple_bell_${i}`, kind: 'bell' as const, at: { spot: 'shrine_air_bell', ...o }, label: 'Temple bell', quest: 'sq_bells', step: 'ring' })),
  // ---- sq_peaches: moon peaches in the bison meadow ----
  ...ring(6, 9, 0.5).map((o, i) => ({ id: `moon_peach_${i}`, kind: 'pickup' as const, look: 'peach' as const, at: { spot: 'shrine_bison_meadow', dx: o.dx, dz: o.dz }, label: 'Pick a moon peach', quest: 'sq_peaches', step: 'gather', item: 'moon_peaches' })),
  // ---- sq_spirit_oasis ----
  { id: 'oasis_meditate', kind: 'meditate', at: { spot: 'shrine_spirit_oasis', dx: 0, dz: 3 }, label: 'Meditate beside the koi pond', quest: 'sq_spirit_oasis', step: 'meditate', item: 'spirit_water', text: 'The two koi circle each other — one white with a black eye, one black with a white eye. Push and pull. For a moment you feel the Moon and the Ocean breathing with you, and the water in the pond glows.' },
  // ---- sq_ice_caves ----
  { id: 'glacier_crystal', kind: 'pickup', look: 'crystal', at: { spot: 'shrine_ice_caves', dx: 2.5, dz: 2 }, label: 'Take the glowing crystal', quest: 'sq_ice_caves', step: 'search', item: 'glacier_crystal' },
  // ---- sq_buried_library ----
  { id: 'library_scroll', kind: 'pickup', look: 'scroll', at: { spot: 'shrine_buried_library', dx: 1.5, dz: 1 }, label: 'Take the ancient scroll', quest: 'sq_buried_library', step: 'search', item: 'library_scroll' },
  // ---- sq_kyoshi_fans ----
  ...[{ dx: 12, dz: 4 }, { dx: -9, dz: 10 }, { dx: 4, dz: -12 }].map((o, i) => ({ id: `kyoshi_fan_${i}`, kind: 'pickup' as const, look: 'fan' as const, at: { spot: 'shrine_kyoshi', ...o }, label: 'Pick up the war fan', quest: 'sq_kyoshi_fans', step: 'gather', item: 'kyoshi_fan' })),
  // ---- sq_ember_script ----
  ...[{ dx: 10, dz: 3 }, { dx: -12, dz: 2 }, { dx: 4, dz: -9 }].map((o, i) => ({ id: `script_page_${i}`, kind: 'pickup' as const, look: 'page' as const, at: { spot: 'shrine_ember_theater', ...o }, label: 'Pick up the script page', quest: 'sq_ember_script', step: 'gather', item: 'script_page' })),
];
