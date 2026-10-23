import type { Nation } from '../world/WorldLayout';

/**
 * Cosmetic catalog. Every wearable has a stable id (saved in appearance data).
 * `shape` parameters are interpreted by the character renderer to build the mesh;
 * new items can usually be added here without code changes.
 *
 * unlock: 'start'     — available in the character creator
 *         'merchant'  — buy from a vendor (price in copper pieces)
 *         'quest' | 'master' | 'explore' | 'achievement' — granted by gameplay
 */

export type CosmeticSlot = 'top' | 'bottom' | 'footwear' | 'outer' | 'gloves' | 'belt' | 'headwear' | 'necklace' | 'accessory';

export interface CosmeticDef {
  id: string;
  name: string;
  slot: CosmeticSlot;
  nation: Nation | 'any';
  unlock: 'start' | 'merchant' | 'quest' | 'master' | 'explore' | 'achievement';
  price?: number;
  description: string;
  shape: Record<string, string | number | boolean>;
  /** Suggested palette when equipped from the wardrobe. */
  colors?: Partial<{ primary: string; secondary: string; accent: string; trim: string }>;
  /** Gameplay effect hook (e.g. 'water_flask' grants a carried water supply). */
  effect?: string;
}

export const COSMETICS: CosmeticDef[] = [
  // ---------------- Tops ----------------
  { id: 'air_monk_robe', name: 'Air Nomad Robe', slot: 'top', nation: 'air', unlock: 'start', description: 'Saffron robe of the Air Nomads, wrapped across the chest.', shape: { sleeves: 'long', length: 'hip', collar: 'wrap', pattern: 'trim' } },
  { id: 'air_training_wrap', name: 'Monk Training Wrap', slot: 'top', nation: 'air', unlock: 'start', description: 'Light sleeveless wrap for acrobatics.', shape: { sleeves: 'none', length: 'waist', collar: 'wrap' } },
  { id: 'air_elder_robe', name: 'Elder Monk Vestments', slot: 'top', nation: 'air', unlock: 'master', description: 'Flowing ceremonial vestments of a temple elder.', shape: { sleeves: 'wide', length: 'ankle', collar: 'wrap', pattern: 'swirls', layers: 2 } },
  { id: 'air_nun_dress', name: 'Air Acolyte Dress', slot: 'top', nation: 'air', unlock: 'merchant', price: 120, description: 'A long robe from the Eastern Air Temple.', shape: { sleeves: 'long', length: 'knee', collar: 'round', pattern: 'trim' } },
  { id: 'water_parka', name: 'Northern Parka', slot: 'top', nation: 'water', unlock: 'start', description: 'Fur-trimmed parka of the Northern Water Tribe.', shape: { sleeves: 'long', length: 'thigh', collar: 'high', fur: true, pattern: 'waves' } },
  { id: 'water_tunic', name: 'Southern Tunic', slot: 'top', nation: 'water', unlock: 'start', description: 'Practical blue tunic from the Southern Tribe.', shape: { sleeves: 'long', length: 'hip', collar: 'round', fur: false, pattern: 'trim' } },
  { id: 'water_training', name: 'Waterbender Training Garb', slot: 'top', nation: 'water', unlock: 'start', description: 'Close-fitting garb that lets the arms flow.', shape: { sleeves: 'elbow', length: 'hip', collar: 'wrap', pattern: 'waves' } },
  { id: 'water_ceremonial', name: 'Moon Ceremony Dress', slot: 'top', nation: 'water', unlock: 'quest', description: 'Layered ceremonial dress worn under the full moon.', shape: { sleeves: 'wide', length: 'ankle', collar: 'high', fur: true, pattern: 'waves', layers: 2 } },
  { id: 'water_warrior_coat', name: 'Warrior Coat', slot: 'top', nation: 'water', unlock: 'merchant', price: 160, description: 'Heavy coat of a tribal warrior, war-paint optional.', shape: { sleeves: 'long', length: 'knee', collar: 'high', fur: true, pattern: 'stripes' } },
  { id: 'earth_tunic', name: 'Earth Kingdom Tunic', slot: 'top', nation: 'earth', unlock: 'start', description: 'Sturdy green tunic of the Earth Kingdom.', shape: { sleeves: 'short', length: 'hip', collar: 'wrap', pattern: 'trim' } },
  { id: 'earth_traveler', name: 'Traveler’s Coat', slot: 'top', nation: 'earth', unlock: 'start', description: 'Dust-worn coat for long roads.', shape: { sleeves: 'long', length: 'knee', collar: 'v', pattern: 'none' } },
  { id: 'earth_formal', name: 'Upper Ring Robes', slot: 'top', nation: 'earth', unlock: 'merchant', price: 300, description: 'Embroidered robes fit for the Upper Ring.', shape: { sleeves: 'wide', length: 'ankle', collar: 'high', pattern: 'swirls', layers: 2 } },
  { id: 'earth_dojo', name: 'Dojo Training Vest', slot: 'top', nation: 'earth', unlock: 'master', description: 'Sleeveless vest from the Stone Fist Dojo.', shape: { sleeves: 'none', length: 'waist', collar: 'v', pattern: 'trim' } },
  { id: 'earth_kyoshi', name: 'Kyoshi Warrior Armor', slot: 'top', nation: 'earth', unlock: 'quest', description: 'Lacquered armor of the Kyoshi Warriors.', shape: { sleeves: 'long', length: 'knee', collar: 'high', armor: true, pattern: 'trim' }, colors: { primary: '#3f7a3a', secondary: '#c9a227', accent: '#e7e2d0', trim: '#7a1f1a' } },
  { id: 'fire_tunic', name: 'Fire Nation Tunic', slot: 'top', nation: 'fire', unlock: 'start', description: 'Crimson tunic with a stiff collar.', shape: { sleeves: 'short', length: 'hip', collar: 'high', pattern: 'trim' } },
  { id: 'fire_training', name: 'Firebender Training Top', slot: 'top', nation: 'fire', unlock: 'start', description: 'Sleeveless top for heat and speed.', shape: { sleeves: 'none', length: 'waist', collar: 'round', pattern: 'flames' } },
  { id: 'fire_armor_light', name: 'Light Soldier Armor', slot: 'top', nation: 'fire', unlock: 'merchant', price: 220, description: 'Plated vest of a Fire Nation regular.', shape: { sleeves: 'short', length: 'hip', collar: 'high', armor: true, pattern: 'flames' } },
  { id: 'fire_royal_robe', name: 'Royal Court Robes', slot: 'top', nation: 'fire', unlock: 'quest', description: 'Robes with golden flame embroidery from the palace.', shape: { sleeves: 'wide', length: 'ankle', collar: 'high', pattern: 'flames', layers: 2 }, colors: { primary: '#8a1a14', secondary: '#1a1010', accent: '#e0b040', trim: '#e0b040' } },
  { id: 'fire_traveler', name: 'Ember Traveler Coat', slot: 'top', nation: 'fire', unlock: 'start', description: 'A muted red coat for travelling incognito.', shape: { sleeves: 'long', length: 'knee', collar: 'v', pattern: 'none' } },
  { id: 'avatar_robe', name: 'Robe of the Four Nations', slot: 'top', nation: 'any', unlock: 'achievement', description: 'Woven from all four traditions; granted to a fully realized Avatar.', shape: { sleeves: 'wide', length: 'ankle', collar: 'wrap', pattern: 'swirls', layers: 2 }, colors: { primary: '#e8e2d0', secondary: '#2f6fd6', accent: '#d0362a', trim: '#3f8f3a' } },

  // ---------------- Bottoms ----------------
  { id: 'air_trousers', name: 'Monk Trousers', slot: 'bottom', nation: 'air', unlock: 'start', description: 'Loose trousers tied at the ankle.', shape: { style: 'wrapped', wide: true } },
  { id: 'water_trousers', name: 'Fur-Lined Trousers', slot: 'bottom', nation: 'water', unlock: 'start', description: 'Warm trousers tucked into boots.', shape: { style: 'trousers', wide: false } },
  { id: 'water_skirt', name: 'Tribal Skirt', slot: 'bottom', nation: 'water', unlock: 'start', description: 'Long skirt over leggings.', shape: { style: 'skirt', wide: false } },
  { id: 'earth_trousers', name: 'Earthen Trousers', slot: 'bottom', nation: 'earth', unlock: 'start', description: 'Hard-wearing trousers with wraps.', shape: { style: 'wrapped', wide: false } },
  { id: 'earth_robe_skirt', name: 'Robe Skirt', slot: 'bottom', nation: 'earth', unlock: 'start', description: 'A long divided skirt.', shape: { style: 'robe', wide: true } },
  { id: 'fire_trousers', name: 'Fire Nation Trousers', slot: 'bottom', nation: 'fire', unlock: 'start', description: 'Fitted trousers for firm stances.', shape: { style: 'trousers', wide: false } },
  { id: 'fire_hakama', name: 'Ceremonial Hakama', slot: 'bottom', nation: 'fire', unlock: 'merchant', price: 140, description: 'Pleated trousers for formal occasions.', shape: { style: 'robe', wide: true } },

  // ---------------- Footwear ----------------
  { id: 'air_boots', name: 'Soft Nomad Boots', slot: 'footwear', nation: 'air', unlock: 'start', description: 'Light boots for running along rooftops.', shape: { style: 'boots', height: 0.6 } },
  { id: 'barefoot_wraps', name: 'Foot Wraps', slot: 'footwear', nation: 'any', unlock: 'start', description: 'Cloth wraps — feel the earth.', shape: { style: 'wraps', height: 0.4 } },
  { id: 'water_fur_boots', name: 'Fur Boots', slot: 'footwear', nation: 'water', unlock: 'start', description: 'Seal-fur boots for the ice.', shape: { style: 'fur_boots', height: 1 } },
  { id: 'earth_boots', name: 'Earth Kingdom Boots', slot: 'footwear', nation: 'earth', unlock: 'start', description: 'Stout boots with upturned toes.', shape: { style: 'boots', height: 0.8 } },
  { id: 'earth_sandals', name: 'Straw Sandals', slot: 'footwear', nation: 'earth', unlock: 'start', description: 'Village sandals.', shape: { style: 'sandals', height: 0.2 } },
  { id: 'fire_boots', name: 'Fire Nation Boots', slot: 'footwear', nation: 'fire', unlock: 'start', description: 'Pointed black boots.', shape: { style: 'boots', height: 0.9 } },
  { id: 'fire_armored_boots', name: 'Armored Greaves', slot: 'footwear', nation: 'fire', unlock: 'merchant', price: 120, description: 'Plated boots of the palace guard.', shape: { style: 'armored', height: 1 } },

  // ---------------- Outer layers ----------------
  { id: 'none', name: 'None', slot: 'outer', nation: 'any', unlock: 'start', description: 'Nothing.', shape: {} },
  { id: 'air_mantle', name: 'Nomad Mantle', slot: 'outer', nation: 'air', unlock: 'start', description: 'A short yellow mantle across the shoulders.', shape: { style: 'mantle' } },
  { id: 'air_cape', name: 'Sky Cape', slot: 'outer', nation: 'air', unlock: 'quest', description: 'A long cape that catches the wind.', shape: { style: 'cape' } },
  { id: 'water_fur_coat', name: 'Polar Fur Coat', slot: 'outer', nation: 'water', unlock: 'merchant', price: 180, description: 'A heavy coat of white fur.', shape: { style: 'fur_coat' } },
  { id: 'water_shawl', name: 'Healer’s Shawl', slot: 'outer', nation: 'water', unlock: 'master', description: 'A shawl worn by the healers of the north.', shape: { style: 'shawl' } },
  { id: 'earth_vest', name: 'Stone Vest', slot: 'outer', nation: 'earth', unlock: 'start', description: 'A reinforced vest.', shape: { style: 'vest' } },
  { id: 'earth_shoulder_guard', name: 'Shoulder Guards', slot: 'outer', nation: 'earth', unlock: 'merchant', price: 150, description: 'Ridged pauldrons of an Earth Kingdom officer.', shape: { style: 'shoulder_armor' } },
  { id: 'fire_cloak', name: 'Ember Cloak', slot: 'outer', nation: 'fire', unlock: 'merchant', price: 200, description: 'A dark cloak lined with red.', shape: { style: 'cloak' } },
  { id: 'fire_pauldrons', name: 'Flame Pauldrons', slot: 'outer', nation: 'fire', unlock: 'quest', description: 'Spiked pauldrons from the Agni Kai arena.', shape: { style: 'shoulder_armor' } },

  // ---------------- Gloves ----------------
  { id: 'none_gloves', name: 'Bare Hands', slot: 'gloves', nation: 'any', unlock: 'start', description: 'Nothing.', shape: {} },
  { id: 'water_mittens', name: 'Fur Mittens', slot: 'gloves', nation: 'water', unlock: 'start', description: 'Warm mittens.', shape: { style: 'mittens' } },
  { id: 'earth_wraps', name: 'Hand Wraps', slot: 'gloves', nation: 'earth', unlock: 'start', description: 'Cloth wraps around the knuckles.', shape: { style: 'wraps' } },
  { id: 'fire_bracers', name: 'Leather Bracers', slot: 'gloves', nation: 'fire', unlock: 'start', description: 'Bracers that protect the forearms.', shape: { style: 'bracers' } },
  { id: 'fingerless', name: 'Fingerless Gloves', slot: 'gloves', nation: 'any', unlock: 'start', description: 'Good grip, free fingers.', shape: { style: 'fingerless' } },

  // ---------------- Belts ----------------
  { id: 'none_belt', name: 'No Belt', slot: 'belt', nation: 'any', unlock: 'start', description: 'Nothing.', shape: {} },
  { id: 'air_sash', name: 'Monk Sash', slot: 'belt', nation: 'air', unlock: 'start', description: 'A wide orange sash.', shape: { style: 'sash' } },
  { id: 'water_belt', name: 'Tribal Belt', slot: 'belt', nation: 'water', unlock: 'start', description: 'Leather belt with bone clasp.', shape: { style: 'belt' } },
  { id: 'earth_belt', name: 'Earthen Belt', slot: 'belt', nation: 'earth', unlock: 'start', description: 'Broad belt with a bronze buckle.', shape: { style: 'belt' } },
  { id: 'fire_belt', name: 'Fire Sash', slot: 'belt', nation: 'fire', unlock: 'start', description: 'A sash knotted at the hip.', shape: { style: 'obi' } },
  { id: 'rope_belt', name: 'Rope Belt', slot: 'belt', nation: 'any', unlock: 'start', description: 'Simple and sturdy.', shape: { style: 'rope' } },

  // ---------------- Headwear ----------------
  { id: 'none_head', name: 'None', slot: 'headwear', nation: 'any', unlock: 'start', description: 'Nothing.', shape: {} },
  { id: 'fire_hair_crown', name: 'Topknot Ornament', slot: 'headwear', nation: 'fire', unlock: 'start', description: 'A small flame-shaped hair ornament.', shape: { style: 'crown' } },
  { id: 'fire_royal_crown', name: 'Crown Prince’s Ornament', slot: 'headwear', nation: 'fire', unlock: 'quest', description: 'A golden five-pronged flame crown.', shape: { style: 'crown', gold: true } },
  { id: 'earth_straw_hat', name: 'Farmer’s Straw Hat', slot: 'headwear', nation: 'earth', unlock: 'start', description: 'A wide conical straw hat.', shape: { style: 'hat_straw' } },
  { id: 'earth_headband', name: 'Training Headband', slot: 'headwear', nation: 'earth', unlock: 'start', description: 'Keeps the sweat away.', shape: { style: 'headband' } },
  { id: 'earth_hairpin', name: 'Jade Hairpin', slot: 'headwear', nation: 'earth', unlock: 'merchant', price: 90, description: 'Elegant pins from the Middle Ring.', shape: { style: 'hairpin' } },
  { id: 'water_hood', name: 'Fur Hood', slot: 'headwear', nation: 'water', unlock: 'start', description: 'A warm hood with a fur ruff.', shape: { style: 'hood', fur: true } },
  { id: 'water_beads', name: 'Hair Beads', slot: 'headwear', nation: 'water', unlock: 'start', description: 'Blue beads braided into the hair.', shape: { style: 'beads' } },
  { id: 'air_monk_hat', name: 'Elder’s Cap', slot: 'headwear', nation: 'air', unlock: 'master', description: 'The pointed cap of a temple elder.', shape: { style: 'monk_hat' } },
  { id: 'air_headband', name: 'Wind Headband', slot: 'headwear', nation: 'air', unlock: 'start', description: 'An orange band for the brow.', shape: { style: 'headband' } },

  // ---------------- Necklaces ----------------
  { id: 'none_neck', name: 'None', slot: 'necklace', nation: 'any', unlock: 'start', description: 'Nothing.', shape: {} },
  { id: 'water_betrothal', name: 'Carved Wave Choker', slot: 'necklace', nation: 'water', unlock: 'start', description: 'A blue ribbon choker with a carved stone bearing the wave of the Water Tribes.', shape: { style: 'choker', stone: '#4a8fd6', carving: 'wave' } },
  { id: 'water_moon_pendant', name: 'Moon Spirit Pendant', slot: 'necklace', nation: 'water', unlock: 'start', description: 'A pale crescent on a cord — a prayer to the Moon.', shape: { style: 'pendant', stone: '#e8f0ff', carving: 'moon' } },
  { id: 'water_shell', name: 'Seashell Cord', slot: 'necklace', nation: 'water', unlock: 'start', description: 'Polished shells from the southern shore.', shape: { style: 'shell', stone: '#f2e3d0' } },
  { id: 'water_whalebone', name: 'Whalebone Torc', slot: 'necklace', nation: 'water', unlock: 'merchant', price: 110, description: 'A carved bone collar of a hunter.', shape: { style: 'torc', stone: '#eadfc8', carving: 'wave' } },
  { id: 'water_ocean_tear', name: 'Ocean Tear', slot: 'necklace', nation: 'water', unlock: 'quest', description: 'A teardrop of deep blue glass that never quite stops shimmering.', shape: { style: 'pendant', stone: '#1f5fd6', carving: 'drop' } },
  { id: 'water_ice_crystal', name: 'Glacier Crystal', slot: 'necklace', nation: 'water', unlock: 'explore', description: 'A shard from the Glacier Caves, set in silver.', shape: { style: 'pendant', stone: '#bfe6ff', carving: 'crystal' } },
  { id: 'earth_jade', name: 'Jade Pendant', slot: 'necklace', nation: 'earth', unlock: 'start', description: 'A green jade disc.', shape: { style: 'medallion', stone: '#3f9f5a', carving: 'leaf' } },
  { id: 'fire_ember', name: 'Ember Pendant', slot: 'necklace', nation: 'fire', unlock: 'start', description: 'A red stone that is always warm.', shape: { style: 'pendant', stone: '#e04a2a', carving: 'flame' } },
  { id: 'air_prayer_beads', name: 'Prayer Beads', slot: 'necklace', nation: 'air', unlock: 'start', description: 'Large wooden beads of a monk.', shape: { style: 'beads', stone: '#8a5a2a' } },
  { id: 'avatar_medallion', name: 'Four Nations Medallion', slot: 'necklace', nation: 'any', unlock: 'achievement', description: 'The four emblems joined in one.', shape: { style: 'medallion', stone: '#e8e2d0', carving: 'four' } },

  // ---------------- Accessories ----------------
  { id: 'none_acc', name: 'None', slot: 'accessory', nation: 'any', unlock: 'start', description: 'Nothing.', shape: {} },
  { id: 'air_glider', name: 'Glider Staff', slot: 'accessory', nation: 'air', unlock: 'start', description: 'A folding glider staff, carried on the back. Improves gliding.', shape: { style: 'glider_staff' }, effect: 'glider' },
  { id: 'water_flask', name: 'Water Skin', slot: 'accessory', nation: 'water', unlock: 'start', description: 'A leather water skin at the hip. Carries a small supply of bendable water anywhere.', shape: { style: 'flask' }, effect: 'water_flask' },
  { id: 'fans', name: 'War Fans', slot: 'accessory', nation: 'earth', unlock: 'quest', description: 'Golden fans of the Kyoshi Warriors.', shape: { style: 'fans' } },
  { id: 'dao_swords', name: 'Dual Dao', slot: 'accessory', nation: 'fire', unlock: 'merchant', price: 260, description: 'Twin broadswords, sheathed on the back.', shape: { style: 'swords' } },
  { id: 'satchel', name: 'Scroll Satchel', slot: 'accessory', nation: 'any', unlock: 'start', description: 'For maps, scrolls and snacks.', shape: { style: 'satchel' } },
  { id: 'arm_bands', name: 'Copper Arm Bands', slot: 'accessory', nation: 'any', unlock: 'merchant', price: 60, description: 'Simple decorative bands.', shape: { style: 'arm_bands' } },
];

export function cosmeticById(id: string): CosmeticDef | undefined {
  return COSMETICS.find((c) => c.id === id);
}

export function cosmeticsForSlot(slot: CosmeticSlot): CosmeticDef[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

/** Item ids that count as "nothing" for optional slots. */
export const EMPTY_SLOT_IDS = new Set(['none', 'none_gloves', 'none_belt', 'none_head', 'none_neck', 'none_acc']);
