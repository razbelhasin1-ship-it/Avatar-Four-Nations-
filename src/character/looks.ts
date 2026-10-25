import { Random } from '../core/Random';
import type { Element } from '../core/types';
import { cosmeticById } from '../data/cosmetics';
import {
  cloneAppearance,
  DEFAULT_APPEARANCE,
  EYE_COLORS,
  FACIAL_HAIR,
  HAIR_COLORS,
  SKIN_TONES,
  type Appearance,
  type BodyType,
  type Frame,
  type OutfitSlots,
} from './Appearance';

/**
 * Culturally coherent looks: complete nation outfits (creator presets, NPC citizens),
 * nation palettes, name validation/suggestions and look randomisation.
 * Pure data + functions (no three.js) so they are unit-testable.
 */

export type LookNation = Element;

export interface OutfitPreset {
  id: string;
  name: string;
  nation: LookNation;
  /** Shown under the preset name in the creator. */
  blurb: string;
  outfit: OutfitSlots;
  colors: Appearance['colors'];
  /** Available in the character creator (all items unlock: 'start'). */
  creator: boolean;
}

/** Round to 2 decimals (and never -0, so saved data compares cleanly). */
const r2 = (v: number): number => Math.round(v * 100) / 100 || 0;

const EMPTY: OutfitSlots = { top: 'earth_tunic', bottom: 'earth_trousers', footwear: 'earth_boots', outer: 'none', gloves: 'none_gloves', belt: 'none_belt', headwear: 'none_head', necklace: 'none_neck', accessory: 'none_acc' };
const fit = (o: Partial<OutfitSlots>): OutfitSlots => ({ ...EMPTY, ...o });

export const NATION_NAMES: Record<LookNation, string> = {
  air: 'Air Nomads',
  water: 'Water Tribes',
  earth: 'Earth Kingdom',
  fire: 'Fire Nation',
};

export const OUTFIT_PRESETS: OutfitPreset[] = [
  {
    id: 'air_monk', name: 'Temple Monk', nation: 'air', creator: true, blurb: 'Saffron robe, yellow mantle, prayer beads and a glider staff.',
    outfit: fit({ top: 'air_monk_robe', bottom: 'air_trousers', footwear: 'air_boots', outer: 'air_mantle', belt: 'air_sash', necklace: 'air_prayer_beads', accessory: 'air_glider' }),
    colors: { primary: '#e8a33a', secondary: '#c8642a', accent: '#f4d48a', trim: '#7a3a1a' },
  },
  {
    id: 'air_acolyte', name: 'Wind Acolyte', nation: 'air', creator: true, blurb: 'Sleeveless training wrap and foot wraps for acrobatics.',
    outfit: fit({ top: 'air_training_wrap', bottom: 'air_trousers', footwear: 'barefoot_wraps', belt: 'air_sash', headwear: 'air_headband', accessory: 'air_glider' }),
    colors: { primary: '#f0b84a', secondary: '#d0702a', accent: '#f8e0a0', trim: '#8a4018' },
  },
  {
    id: 'water_north', name: 'Northern Tribe', nation: 'water', creator: true, blurb: 'Deep-blue parka with white fur, mittens and the carved wave choker.',
    outfit: fit({ top: 'water_parka', bottom: 'water_trousers', footwear: 'water_fur_boots', gloves: 'water_mittens', belt: 'water_belt', necklace: 'water_betrothal', accessory: 'water_flask' }),
    colors: { primary: '#2f5f9e', secondary: '#1e3a66', accent: '#e9eef5', trim: '#d9c9a8' },
  },
  {
    id: 'water_south', name: 'Southern Tribe', nation: 'water', creator: true, blurb: 'Hooded fur-trimmed parka, hair beads and a shell cord.',
    outfit: fit({ top: 'water_south_parka', bottom: 'water_trousers', footwear: 'water_fur_boots', belt: 'water_belt', headwear: 'water_beads', necklace: 'water_shell', accessory: 'water_flask' }),
    colors: { primary: '#4a7fb8', secondary: '#2a4a78', accent: '#f0f0f0', trim: '#a07850' },
  },
  {
    id: 'water_healer', name: 'Tribe Healer', nation: 'water', creator: true, blurb: 'Blue tunic over a long skirt with a moon pendant.',
    outfit: fit({ top: 'water_tunic', bottom: 'water_skirt', footwear: 'water_fur_boots', belt: 'water_belt', necklace: 'water_moon_pendant', accessory: 'water_flask' }),
    colors: { primary: '#3a74b8', secondary: '#24467a', accent: '#dfe8f2', trim: '#c8b898' },
  },
  {
    id: 'earth_kingdom', name: 'Kingdom Traveller', nation: 'earth', creator: true, blurb: 'Green wrap tunic, wrapped trousers, hand wraps and a jade pendant.',
    outfit: fit({ top: 'earth_tunic', bottom: 'earth_trousers', footwear: 'earth_boots', gloves: 'earth_wraps', belt: 'earth_belt', necklace: 'earth_jade' }),
    colors: { primary: '#4f7f3a', secondary: '#2f4f25', accent: '#c9b27a', trim: '#6b4a2a' },
  },
  {
    id: 'earth_village', name: 'Farm Village', nation: 'earth', creator: true, blurb: 'Tan travelling coat, straw hat and sandals.',
    outfit: fit({ top: 'earth_traveler', bottom: 'earth_trousers', footwear: 'earth_sandals', belt: 'rope_belt', headwear: 'earth_straw_hat', accessory: 'satchel' }),
    colors: { primary: '#8a7a4a', secondary: '#4f6a3a', accent: '#d8c890', trim: '#5a3a1a' },
  },
  {
    id: 'earth_basingse', name: 'Ba Sing Se Scholar', nation: 'earth', creator: true, blurb: 'Layered formal wrap robes of the Middle Ring.',
    outfit: fit({ top: 'earth_basingse_robe', bottom: 'earth_robe_skirt', footwear: 'earth_boots', belt: 'earth_belt', necklace: 'earth_jade', accessory: 'satchel' }),
    colors: { primary: '#3f6a3a', secondary: '#c9b27a', accent: '#e8dcb0', trim: '#2f3f25' },
  },
  {
    id: 'fire_citizen', name: 'Capital Citizen', nation: 'fire', creator: true, blurb: 'Crimson tunic with stiff collar, bracers and the topknot ornament.',
    outfit: fit({ top: 'fire_tunic', bottom: 'fire_trousers', footwear: 'fire_boots', gloves: 'fire_bracers', belt: 'fire_belt', headwear: 'fire_hair_crown' }),
    colors: { primary: '#a8241c', secondary: '#2a1a18', accent: '#d4a43a', trim: '#5a1410' },
  },
  {
    id: 'fire_palace', name: 'Palace Attendant', nation: 'fire', creator: true, blurb: 'Black-and-crimson palace robes with gold flames.',
    outfit: fit({ top: 'fire_noble_robe', bottom: 'fire_trousers', footwear: 'fire_boots', belt: 'fire_belt', headwear: 'fire_hair_crown', necklace: 'fire_ember' }),
    colors: { primary: '#8a1a14', secondary: '#1a1010', accent: '#e0b040', trim: '#e0b040' },
  },
  {
    id: 'fire_trainee', name: 'Firebender Trainee', nation: 'fire', creator: true, blurb: 'Sleeveless flame-patterned top for heat and speed.',
    outfit: fit({ top: 'fire_training', bottom: 'fire_trousers', footwear: 'fire_boots', gloves: 'fire_bracers', belt: 'fire_belt' }),
    colors: { primary: '#b03a2a', secondary: '#1a1414', accent: '#e0b050', trim: '#6a1a10' },
  },
  // ---- NPC-only looks (contain unlockable items) ----
  {
    id: 'air_elder', name: 'Temple Elder', nation: 'air', creator: false, blurb: '',
    outfit: fit({ top: 'air_elder_robe', bottom: 'air_trousers', footwear: 'air_boots', belt: 'air_sash', necklace: 'air_prayer_beads', headwear: 'air_monk_hat' }),
    colors: { primary: '#e0a040', secondary: '#c05a28', accent: '#f6dc98', trim: '#6a3010' },
  },
  {
    id: 'water_warrior', name: 'Tribe Warrior', nation: 'water', creator: false, blurb: '',
    outfit: fit({ top: 'water_warrior_coat', bottom: 'water_trousers', footwear: 'water_fur_boots', gloves: 'water_mittens', belt: 'water_belt', necklace: 'water_whalebone' }),
    colors: { primary: '#24467a', secondary: '#16304f', accent: '#e9eef5', trim: '#b8a888' },
  },
  {
    id: 'earth_soldier', name: 'Earth Kingdom Soldier', nation: 'earth', creator: false, blurb: '',
    outfit: fit({ top: 'earth_soldier_armor', bottom: 'earth_trousers', footwear: 'earth_boots', outer: 'earth_shoulder_guard', belt: 'earth_belt', gloves: 'earth_wraps' }),
    colors: { primary: '#3f5f2f', secondary: '#7a6a4a', accent: '#c9b27a', trim: '#2a3a1f' },
  },
  {
    id: 'earth_noble', name: 'Upper Ring Noble', nation: 'earth', creator: false, blurb: '',
    outfit: fit({ top: 'earth_formal', bottom: 'earth_robe_skirt', footwear: 'earth_boots', belt: 'earth_belt', headwear: 'earth_hairpin', necklace: 'earth_jade' }),
    colors: { primary: '#2f5f3a', secondary: '#d8c890', accent: '#e8e0c0', trim: '#7a5a2a' },
  },
  {
    id: 'fire_soldier', name: 'Fire Nation Soldier', nation: 'fire', creator: false, blurb: '',
    outfit: fit({ top: 'fire_armor_light', bottom: 'fire_trousers', footwear: 'fire_armored_boots', outer: 'fire_pauldrons', gloves: 'fire_bracers', belt: 'fire_belt' }),
    colors: { primary: '#7a1a14', secondary: '#1e1614', accent: '#9aa0a8', trim: '#3a0e0a' },
  },
  {
    id: 'fire_noble', name: 'Royal Court', nation: 'fire', creator: false, blurb: '',
    outfit: fit({ top: 'fire_royal_robe', bottom: 'fire_hakama', footwear: 'fire_boots', belt: 'fire_belt', headwear: 'fire_hair_crown', necklace: 'fire_ember' }),
    colors: { primary: '#8a1a14', secondary: '#1a1010', accent: '#e0b040', trim: '#e0b040' },
  },
];

export function outfitPreset(id: string): OutfitPreset | undefined {
  return OUTFIT_PRESETS.find((p) => p.id === id);
}

/** Creator-selectable presets grouped by nation (display order). */
export function creatorPresets(nation: LookNation): OutfitPreset[] {
  return OUTFIT_PRESETS.filter((p) => p.creator && p.nation === nation);
}

/** Nation palettes: [primary, secondary, accent, trim]. */
export const NATION_PALETTES: Record<LookNation, Array<Appearance['colors']>> = {
  air: [
    { primary: '#e8a33a', secondary: '#c8642a', accent: '#f4d48a', trim: '#7a3a1a' },
    { primary: '#d9a040', secondary: '#b8582a', accent: '#f0e0b0', trim: '#6a3010' },
    { primary: '#f0c060', secondary: '#d87a30', accent: '#fff0c8', trim: '#8a4a1a' },
  ],
  water: [
    { primary: '#2f5f9e', secondary: '#1e3a66', accent: '#e9eef5', trim: '#d9c9a8' },
    { primary: '#3a74b8', secondary: '#24467a', accent: '#dfe8f2', trim: '#c8b898' },
    { primary: '#5a7ea8', secondary: '#2a3f5f', accent: '#f0f0f0', trim: '#a89878' },
  ],
  earth: [
    { primary: '#4f7f3a', secondary: '#2f4f25', accent: '#c9b27a', trim: '#6b4a2a' },
    { primary: '#6a8a3a', secondary: '#3a5a2a', accent: '#d8c890', trim: '#5a3a1a' },
    { primary: '#8a7a4a', secondary: '#4f6a3a', accent: '#d8c890', trim: '#4a3a2a' },
  ],
  fire: [
    { primary: '#a8241c', secondary: '#2a1a18', accent: '#d4a43a', trim: '#5a1410' },
    { primary: '#8a2a1a', secondary: '#3a2020', accent: '#c09030', trim: '#4a1010' },
    { primary: '#b03a2a', secondary: '#1a1414', accent: '#e0b050', trim: '#6a1a10' },
  ],
};

/** Hairstyles that read as belonging to each nation (weighted pools for randomisation and NPCs). */
export const NATION_HAIR: Record<LookNation | 'neutral', string[]> = {
  air: ['bald', 'bald', 'bald', 'high_ponytail', 'short_crop', 'bun'],
  water: ['wolf_tail', 'hair_loops', 'long_braid', 'twin_braids', 'short_crop', 'long_loose'],
  earth: ['bun', 'double_buns', 'short_crop', 'messy_short', 'bob', 'long_loose', 'high_ponytail'],
  fire: ['topknot', 'topknot', 'high_ponytail', 'long_loose', 'short_crop', 'spiky', 'side_shave'],
  neutral: ['messy_short', 'long_braid', 'short_crop', 'long_loose'],
};

const SKIN_POOLS: Record<LookNation | 'neutral', string[]> = {
  air: SKIN_TONES.slice(1, 6),
  water: SKIN_TONES.slice(4, 9),
  earth: SKIN_TONES.slice(1, 8),
  fire: SKIN_TONES.slice(0, 4),
  neutral: SKIN_TONES.slice(1, 8),
};
const EYE_POOLS: Record<LookNation | 'neutral', string[]> = {
  air: ['#7a5a32', '#5a3d25', '#8aa0b0', '#3b2a1e'],
  water: ['#3f6fa6', '#6aa6d6', '#5a3d25', '#3b2a1e'],
  earth: ['#3b2a1e', '#5a3d25', '#5d7a3a', '#7a5a32'],
  fire: ['#d9a520', '#c49a3a', '#3b2a1e', '#7a5a32'],
  neutral: EYE_COLORS,
};

// -----------------------------------------------------------------------------
// Names
// -----------------------------------------------------------------------------

export const NAME_MIN = 2;
export const NAME_MAX = 20;

/** Returns null when valid, otherwise a short player-facing reason. */
export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < NAME_MIN) return `Names need at least ${NAME_MIN} letters.`;
  if (name.length > NAME_MAX) return `Names can be at most ${NAME_MAX} characters.`;
  if (!/^[\p{L}][\p{L}\p{M}' \-]*$/u.test(name)) return 'Use letters, spaces, apostrophes or hyphens, starting with a letter.';
  if (/[ '\-]{2,}/.test(name)) return 'Avoid repeated spaces or punctuation.';
  if (/[ '\-]$/.test(name)) return 'Names cannot end with punctuation.';
  return null;
}

/** Tidy a valid name (trim, collapse spaces, capitalise first letter). */
export function normalizeName(raw: string): string {
  const n = raw.trim().replace(/\s+/g, ' ');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

const NAME_POOLS: Record<LookNation, Record<BodyType, string[]>> = {
  air: { male: ['Tashi', 'Dawa', 'Norbu', 'Sonam', 'Jamyang', 'Kunga', 'Tenzin', 'Lobsang'], female: ['Pema', 'Lhamo', 'Dolma', 'Yeshe', 'Dechen', 'Tsering', 'Kalsang', 'Nyima'] },
  water: { male: ['Atka', 'Siku', 'Tulok', 'Aput', 'Kallik', 'Nanok', 'Anuk', 'Tornak'], female: ['Nuka', 'Malu', 'Yuka', 'Ikaya', 'Sila', 'Aluki', 'Tika', 'Kiana'] },
  earth: { male: ['Bao', 'Shen', 'Jun', 'Tao', 'Kang', 'Wen', 'Hao', 'Long'], female: ['Lin', 'Mei', 'Hua', 'Lian', 'Ying', 'Xiu', 'Lan', 'Jia'] },
  fire: { male: ['Riku', 'Hiro', 'Kenji', 'Ren', 'Daichi', 'Haru', 'Takeo', 'Kaito'], female: ['Aiko', 'Akemi', 'Natsu', 'Sora', 'Yumi', 'Hana', 'Kiyomi', 'Emi'] },
};

export function suggestName(nation: LookNation, rng: Random = new Random((Math.random() * 1e9) | 0), body: BodyType = 'male'): string {
  return rng.pick(NAME_POOLS[nation][body]);
}

/** True for a stock suggestion (not a name the player typed), so a nation or body change may replace it. */
export function isSuggestedName(name: string): boolean {
  const n = name.trim();
  return Object.values(NAME_POOLS).some((p) => p.male.includes(n) || p.female.includes(n));
}

// -----------------------------------------------------------------------------
// Randomisation
// -----------------------------------------------------------------------------

function applyPreset(a: Appearance, p: OutfitPreset): void {
  a.outfit = { ...p.outfit };
  a.colors = { ...p.colors };
}

/** Apply a nation outfit preset (outfit + palette) to an appearance, keeping body and face. */
export function withPreset(a: Appearance, presetId: string): Appearance {
  const out = cloneAppearance(a);
  const p = outfitPreset(presetId);
  if (p) applyPreset(out, p);
  return out;
}

/** A complete random look that still reads as the given nation (creator "Randomize"). */
export function randomLook(nation: LookNation, rng: Random): Appearance {
  const a = cloneAppearance(DEFAULT_APPEARANCE[nation]);
  a.frame = rng.pick<Frame>(['slim', 'average', 'athletic', 'broad']);
  a.height = r2(rng.range(0.93, 1.07));
  a.build = r2(rng.range(0.2, 0.8));
  a.skinTone = rng.pick(SKIN_POOLS[nation]);
  a.face = { preset: rng.int(0, 5), jaw: r2(rng.range(-0.6, 0.6)), cheeks: r2(rng.range(-0.6, 0.6)), nose: r2(rng.range(-0.6, 0.6)), eyeSpacing: r2(rng.range(-0.5, 0.5)) };
  a.eyes = { color: rng.pick(EYE_POOLS[nation]), shape: rng.pick(['round', 'almond', 'narrow', 'wide'] as const) };
  a.hair = { style: rng.pick(NATION_HAIR[nation]), color: rng.pick(HAIR_COLORS.slice(0, 7)) };
  a.brows = { style: rng.int(0, 5), thickness: r2(rng.range(0.25, 0.85)), color: a.hair.color };
  a.facialHair = rng.chance(0.22) ? rng.pick(FACIAL_HAIR.slice(1)).id : 'none';
  a.scars = rng.chance(0.12) ? [rng.pick(['cheek_r', 'brow_l', 'chin'])] : [];
  a.tattoos = nation === 'air' ? rng.pick(['arrows', 'arrows', 'arrows_head', 'arrow_partial', 'none'] as const) : rng.chance(0.08) ? 'arrows' : 'none';
  const presets = creatorPresets(nation);
  applyPreset(a, rng.pick(presets));
  if (rng.chance(0.35)) a.colors = { ...rng.pick(NATION_PALETTES[nation]) };
  return a;
}

// -----------------------------------------------------------------------------
// NPC citizens
// -----------------------------------------------------------------------------

const ROLE_PRESETS: Record<LookNation, Record<string, string[]>> = {
  air: { default: ['air_monk', 'air_acolyte'], elder: ['air_elder'], master: ['air_elder', 'air_monk'], monk: ['air_monk', 'air_monk', 'air_elder'], student: ['air_acolyte'], child: ['air_acolyte'] },
  water: { default: ['water_north', 'water_south', 'water_healer'], guard: ['water_warrior'], soldier: ['water_warrior'], healer: ['water_healer'], master: ['water_north', 'water_warrior'], noble: ['water_north'], elder: ['water_healer', 'water_north'] },
  earth: { default: ['earth_kingdom', 'earth_village', 'earth_village', 'earth_basingse'], guard: ['earth_soldier'], soldier: ['earth_soldier'], noble: ['earth_noble', 'earth_basingse'], merchant: ['earth_kingdom', 'earth_basingse'], elder: ['earth_basingse', 'earth_village'] },
  fire: { default: ['fire_citizen', 'fire_citizen', 'fire_palace', 'fire_trainee'], guard: ['fire_soldier'], soldier: ['fire_soldier'], noble: ['fire_noble', 'fire_palace'], student: ['fire_trainee'], master: ['fire_trainee', 'fire_palace'] },
};

/**
 * Deterministic, nation-appropriate appearance for an NPC (same seed → same look).
 * `nation` may be any string ('neutral' etc. map to Earth Kingdom travellers).
 */
export function npcLook(seed: number, nation: string, role: string): Appearance {
  const rng = new Random(seed * 7919 + 13);
  const n: LookNation = nation === 'air' || nation === 'water' || nation === 'fire' ? nation : 'earth';
  const neutral = nation !== n;
  const a = cloneAppearance(DEFAULT_APPEARANCE[n]);
  const child = role === 'child';
  const elder = role === 'elder';
  const soldier = role === 'guard' || role === 'soldier';
  a.frame = child ? 'slim' : soldier ? rng.pick<Frame>(['athletic', 'broad', 'average']) : elder ? rng.pick<Frame>(['slim', 'average']) : rng.pick<Frame>(['slim', 'average', 'athletic', 'broad']);
  a.height = child ? r2(rng.range(0.66, 0.74)) : r2(rng.range(0.93, 1.06));
  a.build = soldier ? r2(rng.range(0.55, 0.9)) : r2(rng.range(0.15, 0.75));
  a.skinTone = rng.pick(SKIN_POOLS[neutral ? 'neutral' : n]);
  a.face = { preset: child ? 0 : elder ? rng.pick([4, 3, 2]) : rng.int(0, 5), jaw: r2(rng.range(-0.7, 0.7)), cheeks: r2(rng.range(-0.7, 0.7)), nose: r2(rng.range(-0.7, 0.7)), eyeSpacing: r2(rng.range(-0.5, 0.5)) };
  a.eyes = { color: rng.pick(EYE_POOLS[neutral ? 'neutral' : n]), shape: rng.pick(['round', 'almond', 'narrow', 'wide'] as const) };
  a.hair.color = elder ? rng.pick(['#8c8c8c', '#d8d8d8', '#b0b0b0', '#a0a0a0']) : rng.pick(HAIR_COLORS.slice(0, 7));
  a.hair.style = role === 'monk' || (n === 'air' && (elder || role === 'master')) ? 'bald' : rng.pick(NATION_HAIR[neutral ? 'neutral' : n]);
  if (soldier && n === 'fire') a.hair.style = rng.pick(['topknot', 'short_crop']);
  a.brows = { style: rng.int(0, 5), thickness: r2(rng.range(0.25, 0.9)), color: a.hair.color };
  a.facialHair = child ? 'none' : elder && rng.chance(0.65) ? rng.pick(['beard_long', 'mustache', 'goatee']) : rng.chance(0.14) ? rng.pick(['goatee', 'beard_short', 'stubble', 'sideburns']) : 'none';
  a.scars = soldier && rng.chance(0.25) ? [rng.pick(['cheek_r', 'brow_l', 'chin'])] : [];
  a.tattoos = n === 'air' && (role === 'monk' || role === 'master' || elder) ? 'arrows' : 'none';
  const table = ROLE_PRESETS[n];
  const presetId = rng.pick(neutral ? ['earth_village', 'earth_kingdom'] : table[role] ?? table.default);
  const preset = outfitPreset(presetId) ?? creatorPresets(n)[0];
  applyPreset(a, preset);
  // Palette variation within the nation (soldiers keep their uniform colours).
  if (!soldier && !preset.id.endsWith('_noble') && rng.chance(0.6)) a.colors = { ...rng.pick(NATION_PALETTES[n]) };
  // Small personal touches.
  if (!soldier && a.outfit.necklace === 'none_neck' && rng.chance(0.3)) {
    const necks: Record<LookNation, string[]> = { air: ['air_prayer_beads'], water: ['water_betrothal', 'water_moon_pendant', 'water_shell'], earth: ['earth_jade'], fire: ['fire_ember'] };
    a.outfit.necklace = rng.pick(necks[n]);
  }
  if (role === 'merchant' && rng.chance(0.6)) a.outfit.accessory = 'satchel';
  if (child) {
    a.outfit.accessory = 'none_acc';
    a.outfit.outer = 'none';
  }
  if (n === 'earth' && role === 'villager' && rng.chance(0.3)) a.outfit.headwear = 'earth_straw_hat';
  // Drop unknown ids defensively (cosmetics may be edited independently).
  for (const k of Object.keys(a.outfit) as Array<keyof OutfitSlots>) if (!cosmeticById(a.outfit[k]) && a.outfit[k] !== 'none') a.outfit[k] = EMPTY[k];
  return a;
}
