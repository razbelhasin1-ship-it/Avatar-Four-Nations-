import type { Element } from '../core/types';

/**
 * Character appearance — pure data, saved verbatim. The Humanoid renderer turns
 * it into meshes/materials. Item ids refer to src/data/cosmetics.ts.
 * Never store three.js objects here.
 */

export type Frame = 'slim' | 'average' | 'athletic' | 'broad';
export type EyeShape = 'round' | 'almond' | 'narrow' | 'wide';
export type TattooStyle = 'none' | 'arrows' | 'arrows_head' | 'arrows_limbs' | 'arrow_partial' | 'wind_bands' | 'spirit_marks';

export interface OutfitSlots {
  top: string;
  bottom: string;
  footwear: string;
  outer: string; // 'none' allowed
  gloves: string; // 'none' allowed
  belt: string; // 'none' allowed
  headwear: string; // 'none' allowed
  necklace: string; // 'none' allowed
  accessory: string; // 'none' allowed
}

export interface Appearance {
  version: 1;
  frame: Frame;
  /** Overall height multiplier 0.9 .. 1.1 */
  height: number;
  /** 0 lean .. 1 muscular */
  build: number;
  skinTone: string;
  face: {
    preset: number; // 0..5
    jaw: number; // -1..1
    cheeks: number; // -1..1
    nose: number; // -1..1
    eyeSpacing: number; // -1..1
  };
  eyes: { color: string; shape: EyeShape };
  brows: { style: number; thickness: number; color: string };
  hair: { style: string; color: string };
  facialHair: string; // 'none' | ids
  scars: string[];
  tattoos: TattooStyle;
  tattooColor: string;
  outfit: OutfitSlots;
  colors: { primary: string; secondary: string; accent: string; trim: string };
}

export const SKIN_TONES = ['#f6dcc4', '#efc9a6', '#e3b48d', '#d29f78', '#bf8a63', '#a87350', '#8d5d3e', '#734a31', '#5c3a26', '#45291b'];
export const HAIR_COLORS = ['#1a1412', '#2b1d16', '#3f2a1d', '#5a3a24', '#7a5233', '#a87b4f', '#c9a36e', '#e0c79a', '#8c8c8c', '#d8d8d8', '#6a1f1a', '#2e3a5a'];
export const EYE_COLORS = ['#3b2a1e', '#5a3d25', '#7a5a32', '#c49a3a', '#d9a520', '#5d7a3a', '#3f6fa6', '#6aa6d6', '#8aa0b0', '#4a4a4a'];
export const TATTOO_COLORS = ['#2f7fd6', '#3aa0e8', '#1f5fb0', '#e8f4ff'];

export const HAIRSTYLES: Array<{ id: string; name: string; nation?: Element }> = [
  { id: 'bald', name: 'Shaved (Monk)', nation: 'air' },
  { id: 'short_crop', name: 'Short Crop' },
  { id: 'messy_short', name: 'Messy Short' },
  { id: 'topknot', name: 'Topknot', nation: 'fire' },
  { id: 'topknot_crown', name: 'Royal Topknot', nation: 'fire' },
  { id: 'wolf_tail', name: 'Warrior Wolf Tail', nation: 'water' },
  { id: 'hair_loops', name: 'Hair Loops & Braid', nation: 'water' },
  { id: 'long_braid', name: 'Long Braid' },
  { id: 'twin_braids', name: 'Twin Braids' },
  { id: 'high_ponytail', name: 'High Ponytail' },
  { id: 'bun', name: 'Scholar Bun', nation: 'earth' },
  { id: 'double_buns', name: 'Double Buns', nation: 'earth' },
  { id: 'long_loose', name: 'Long & Loose' },
  { id: 'bob', name: 'Bob with Bangs', nation: 'earth' },
  { id: 'spiky', name: 'Spiky' },
  { id: 'side_shave', name: 'Side Shave' },
];

export const FACIAL_HAIR = [
  { id: 'none', name: 'None' },
  { id: 'stubble', name: 'Stubble' },
  { id: 'goatee', name: 'Goatee' },
  { id: 'mustache', name: 'Long Mustache' },
  { id: 'beard_short', name: 'Short Beard' },
  { id: 'beard_long', name: 'Sage Beard' },
  { id: 'sideburns', name: 'Sideburns' },
];

export const SCARS = [
  { id: 'eye_burn_l', name: 'Burn Scar (Left Eye)' },
  { id: 'cheek_r', name: 'Cheek Scar' },
  { id: 'brow_l', name: 'Split Brow' },
  { id: 'chin', name: 'Chin Nick' },
  { id: 'lightning_back', name: 'Lightning Scar (Back)' },
];

export const TATTOO_STYLES: Array<{ id: TattooStyle; name: string; desc: string }> = [
  { id: 'none', name: 'No Tattoos', desc: 'An unmarked Avatar.' },
  { id: 'arrows', name: 'Traditional Arrows', desc: 'The full blue arrows of an Airbending master: head, arms, legs and back.' },
  { id: 'arrows_head', name: 'Head Arrow Only', desc: 'A single arrow from the nape over the crown to the brow.' },
  { id: 'arrows_limbs', name: 'Limb Arrows', desc: 'Arrows along the arms and legs, head left bare.' },
  { id: 'arrow_partial', name: 'Initiate Marks', desc: 'A shorter arrow for a novice who has begun the path.' },
  { id: 'wind_bands', name: 'Wind Bands', desc: 'Restrained blue bands around the forearms.' },
  { id: 'spirit_marks', name: 'Spirit Marks', desc: 'Subtle dotted markings across the brow.' },
];

export const FRAME_OPTIONS: Array<{ id: Frame; name: string }> = [
  { id: 'slim', name: 'Slim' },
  { id: 'average', name: 'Average' },
  { id: 'athletic', name: 'Athletic' },
  { id: 'broad', name: 'Broad' },
];

/** Starting looks per element (also used by "randomize"). */
export const DEFAULT_APPEARANCE: Record<Element, Appearance> = {
  air: {
    version: 1,
    frame: 'slim',
    height: 0.97,
    build: 0.35,
    skinTone: '#efc9a6',
    face: { preset: 0, jaw: -0.2, cheeks: 0.1, nose: 0, eyeSpacing: 0 },
    eyes: { color: '#7a5a32', shape: 'round' },
    brows: { style: 0, thickness: 0.4, color: '#2b1d16' },
    hair: { style: 'bald', color: '#2b1d16' },
    facialHair: 'none',
    scars: [],
    tattoos: 'arrows',
    tattooColor: '#2f7fd6',
    outfit: {
      top: 'air_monk_robe',
      bottom: 'air_trousers',
      footwear: 'air_boots',
      outer: 'air_mantle',
      gloves: 'none',
      belt: 'air_sash',
      headwear: 'none',
      necklace: 'air_prayer_beads',
      accessory: 'none',
    },
    colors: { primary: '#e8a33a', secondary: '#c8642a', accent: '#f4d48a', trim: '#7a3a1a' },
  },
  water: {
    version: 1,
    frame: 'average',
    height: 1.0,
    build: 0.45,
    skinTone: '#a87350',
    face: { preset: 1, jaw: 0, cheeks: 0.2, nose: 0, eyeSpacing: 0 },
    eyes: { color: '#3f6fa6', shape: 'almond' },
    brows: { style: 1, thickness: 0.5, color: '#2b1d16' },
    hair: { style: 'wolf_tail', color: '#2b1d16' },
    facialHair: 'none',
    scars: [],
    tattoos: 'none',
    tattooColor: '#2f7fd6',
    outfit: {
      top: 'water_parka',
      bottom: 'water_trousers',
      footwear: 'water_fur_boots',
      outer: 'none',
      gloves: 'water_mittens',
      belt: 'water_belt',
      headwear: 'none',
      necklace: 'water_betrothal',
      accessory: 'none',
    },
    colors: { primary: '#2f5f9e', secondary: '#1e3a66', accent: '#e9eef5', trim: '#d9c9a8' },
  },
  earth: {
    version: 1,
    frame: 'athletic',
    height: 1.0,
    build: 0.6,
    skinTone: '#d29f78',
    face: { preset: 2, jaw: 0.3, cheeks: 0, nose: 0.1, eyeSpacing: 0 },
    eyes: { color: '#5d7a3a', shape: 'narrow' },
    brows: { style: 2, thickness: 0.7, color: '#1a1412' },
    hair: { style: 'bun', color: '#1a1412' },
    facialHair: 'none',
    scars: [],
    tattoos: 'none',
    tattooColor: '#2f7fd6',
    outfit: {
      top: 'earth_tunic',
      bottom: 'earth_trousers',
      footwear: 'earth_boots',
      outer: 'none',
      gloves: 'earth_wraps',
      belt: 'earth_belt',
      headwear: 'none',
      necklace: 'earth_jade',
      accessory: 'none',
    },
    colors: { primary: '#4f7f3a', secondary: '#2f4f25', accent: '#c9b27a', trim: '#6b4a2a' },
  },
  fire: {
    version: 1,
    frame: 'athletic',
    height: 1.02,
    build: 0.55,
    skinTone: '#f6dcc4',
    face: { preset: 3, jaw: 0.1, cheeks: 0.3, nose: 0, eyeSpacing: 0 },
    eyes: { color: '#d9a520', shape: 'almond' },
    brows: { style: 3, thickness: 0.5, color: '#1a1412' },
    hair: { style: 'topknot', color: '#1a1412' },
    facialHair: 'none',
    scars: [],
    tattoos: 'none',
    tattooColor: '#2f7fd6',
    outfit: {
      top: 'fire_tunic',
      bottom: 'fire_trousers',
      footwear: 'fire_boots',
      outer: 'none',
      gloves: 'fire_bracers',
      belt: 'fire_belt',
      headwear: 'fire_hair_crown',
      necklace: 'none',
      accessory: 'none',
    },
    colors: { primary: '#a8241c', secondary: '#2a1a18', accent: '#d4a43a', trim: '#5a1410' },
  },
};

export function cloneAppearance(a: Appearance): Appearance {
  return JSON.parse(JSON.stringify(a));
}

/** Validate/repair loaded appearance data (save migration safety). */
export function sanitizeAppearance(raw: unknown, fallback: Appearance): Appearance {
  const a = cloneAppearance(fallback);
  if (!raw || typeof raw !== 'object') return a;
  const r = raw as any;
  const str = (v: any, d: string) => (typeof v === 'string' && v.length < 64 ? v : d);
  const num = (v: any, d: number, lo: number, hi: number) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  a.frame = (['slim', 'average', 'athletic', 'broad'] as const).includes(r.frame) ? r.frame : a.frame;
  a.height = num(r.height, a.height, 0.88, 1.12);
  a.build = num(r.build, a.build, 0, 1);
  a.skinTone = str(r.skinTone, a.skinTone);
  if (r.face) {
    a.face.preset = Math.round(num(r.face.preset, a.face.preset, 0, 5));
    a.face.jaw = num(r.face.jaw, a.face.jaw, -1, 1);
    a.face.cheeks = num(r.face.cheeks, a.face.cheeks, -1, 1);
    a.face.nose = num(r.face.nose, a.face.nose, -1, 1);
    a.face.eyeSpacing = num(r.face.eyeSpacing, a.face.eyeSpacing, -1, 1);
  }
  if (r.eyes) {
    a.eyes.color = str(r.eyes.color, a.eyes.color);
    a.eyes.shape = (['round', 'almond', 'narrow', 'wide'] as const).includes(r.eyes.shape) ? r.eyes.shape : a.eyes.shape;
  }
  if (r.brows) {
    a.brows.style = Math.round(num(r.brows.style, a.brows.style, 0, 5));
    a.brows.thickness = num(r.brows.thickness, a.brows.thickness, 0, 1);
    a.brows.color = str(r.brows.color, a.brows.color);
  }
  if (r.hair) {
    a.hair.style = str(r.hair.style, a.hair.style);
    a.hair.color = str(r.hair.color, a.hair.color);
  }
  a.facialHair = str(r.facialHair, a.facialHair);
  a.scars = Array.isArray(r.scars) ? r.scars.filter((s: any) => typeof s === 'string').slice(0, 6) : a.scars;
  a.tattoos = TATTOO_STYLES.some((t) => t.id === r.tattoos) ? r.tattoos : a.tattoos;
  a.tattooColor = str(r.tattooColor, a.tattooColor);
  if (r.outfit && typeof r.outfit === 'object') {
    for (const k of Object.keys(a.outfit) as Array<keyof OutfitSlots>) a.outfit[k] = str(r.outfit[k], a.outfit[k]);
  }
  if (r.colors && typeof r.colors === 'object') {
    for (const k of Object.keys(a.colors) as Array<keyof Appearance['colors']>) a.colors[k] = str(r.colors[k], a.colors[k]);
  }
  return a;
}
