import type { Nation } from '../world/WorldLayout';

/**
 * Merchant stalls: who stands where (spot `merchant_<spot>` or a landmark
 * fallback) and what they sell. Items / cosmetics reference src/data/items.ts
 * and src/data/cosmetics.ts (prices come from those catalogs).
 */

export interface ShopDef {
  /** Shop id (dialogue action { type: 'shop', shop }). */
  id: string;
  /** Spot suffix (merchant_<spot>). */
  spot: string;
  /** Used when the spot does not exist (x,z; y = ground). */
  fallback?: { x: number; z: number; yaw: number };
  merchant: string;
  title: string;
  nation: Nation;
  region: string;
  greeting: string;
  rumor: string;
  items: string[];
  cosmetics?: string[];
  /** Fraction of the price paid when the player sells (default 0.4). */
  sellRate?: number;
  /** Companion species for sale (beast keepers; only species from the shop's own nation, see SPECIES_HOMELAND). */
  companions?: string[];
  /** Placed at `fallback` by design: no merchant spot is expected. */
  fixed?: boolean;
}

/** Copper price of a stable-raised companion. Expensive on purpose: taming one in the wild is free. */
export const COMPANION_PRICES: Readonly<Record<string, number>> = {
  turtle_duck: 350,
  winged_lemur: 500,
  ostrich_horse: 900,
  polar_bear_dog: 1400,
  badgermole: 1500,
  komodo_rhino: 1500,
  sky_bison: 2800,
};

export const SHOPS: ShopDef[] = [
  // ---------------- Northern Water Tribe ----------------
  { id: 'nwt_fish', spot: 'nwt_1', merchant: 'Ataneq', title: 'Fishmonger', nation: 'water', region: 'northern_water_tribe', greeting: 'Fresh from the ice holes this morning! Well — yesterday morning. It is very cold; it keeps.', rumor: 'Hunters say the glacier caves to the west glow at night. Nobody goes in twice.', items: ['raw_fish', 'sea_prunes', 'bread_crumbs', 'healing_herbs'] },
  { id: 'nwt_furrier', spot: 'nwt_2', merchant: 'Pana', title: 'Furrier', nation: 'water', region: 'northern_water_tribe', greeting: 'Nothing keeps the wind out like polar fur. Try one on — the mirror is the canal.', rumor: 'Healer Yugoda once mended a swamp waterbender who came all the way north. Strange fellow. Talked to plants.', items: ['jasmine_tea'], cosmetics: ['water_fur_coat', 'water_warrior_coat'] },
  { id: 'nwt_chandler', spot: 'nwt_3', merchant: 'Old Ukko', title: 'Harbor Chandler', nation: 'water', region: 'northern_water_tribe', greeting: 'Rope, oil, herbs, tea — whatever a sailor forgets, I remember.', rumor: 'A letter-carrier is wanted for the Southern Tribe. Elder Kanna was asking.', items: ['healing_herbs', 'jasmine_tea', 'sea_prunes', 'raw_fish'] },
  { id: 'nwt_carver', spot: 'nwt_4', merchant: 'Siqiniq', title: 'Bone Carver', nation: 'water', region: 'northern_water_tribe', greeting: 'Every carving tells a story. This one is about a very rude walrus.', rumor: 'The koi in the Spirit Oasis never stop circling. Some say they are the Moon and Ocean themselves.', items: ['sea_prunes'], cosmetics: ['water_whalebone', 'arm_bands'] },
  // ---------------- Southern Water Tribe ----------------
  { id: 'swt_trader', spot: 'swt_1', merchant: 'Nuka', title: 'Trader', nation: 'water', region: 'southern_water_tribe', greeting: 'Trade is slow on the bottom of the world. Buy something and make my day!', rumor: 'Hunter Akka teaches on the hunting ice. Mind his temper — and his aim.', items: ['raw_fish', 'sea_prunes', 'healing_herbs', 'bread_crumbs'], cosmetics: ['water_whalebone'] },
  // ---------------- Ba Sing Se ----------------
  { id: 'bss_produce', spot: 'bss_1', merchant: 'Bao', title: 'Produce Seller', nation: 'earth', region: 'ba_sing_se', greeting: 'Cabbages, nuts, crumbs for the ducks — the Lower Ring eats well, if it eats cheap!', rumor: 'There is no war in Ba Sing Se. ...That is what the Dai Li want me to say, anyway.', items: ['cabbage', 'lychee_nuts', 'bread_crumbs', 'healing_herbs'] },
  { id: 'bss_tailor', spot: 'bss_2', merchant: 'Madam Wen', title: 'Tailor', nation: 'earth', region: 'ba_sing_se', greeting: 'Upper Ring cut, Lower Ring prices. Mostly.', rumor: 'They say a blind girl in Gaoling wins every Earth Rumble. Her parents think she is at calligraphy class.', items: [], cosmetics: ['earth_hairpin', 'earth_shoulder_guard', 'earth_soldier_armor', 'earth_formal'] },
  { id: 'bss_market_a', spot: 'bss_3', merchant: 'Jin-Ho', title: 'Market Vendor', nation: 'earth', region: 'ba_sing_se', greeting: 'Mushrooms from the badgermole tunnels! Glows in the dark, tastes like... well, mushroom.', rumor: 'Master Lien at the Stone Fist Dojo takes students — if they can stand still long enough.', items: ['glowing_mushroom', 'cabbage', 'lychee_nuts', 'jasmine_tea'] },
  { id: 'bss_market_b', spot: 'bss_4', merchant: 'Ming', title: 'Herbalist', nation: 'earth', region: 'ba_sing_se', greeting: 'Herbs for bruises, tea for nerves. An earthbender needs both.', rumor: 'The cabbage merchant lost his whole cart on the Gaoling road again. Again!', items: ['healing_herbs', 'jasmine_tea', 'glowing_mushroom'] },
  { id: 'bss_tea', spot: 'bss_tea', merchant: 'Pao', title: 'Tea Shop Owner', nation: 'earth', region: 'ba_sing_se', greeting: 'Welcome to the Jasmine Dragon — no, wait, that is the other one. Welcome to Pao\'s!', rumor: 'An old general retired to Ember Island with nothing but a teapot. Now THERE is a man who knows tea.', items: ['jasmine_tea', 'healing_herbs'] },
  // ---------------- Earth heartland ----------------
  { id: 'gaoling_a', spot: 'gaoling_1', merchant: 'Hu', title: 'Stall Keeper', nation: 'earth', region: 'earth_heartland', greeting: 'Gaoling\'s finest! Ask anyone. Ask the Beifongs — actually, do not.', rumor: 'Earth Rumble tonight! The Blind Bandit defends her belt.', items: ['cabbage', 'glowing_mushroom', 'healing_herbs'], cosmetics: ['earth_hairpin'] },
  { id: 'gaoling_b', spot: 'gaoling_2', merchant: 'Lan', title: 'Trinket Seller', nation: 'earth', region: 'earth_heartland', greeting: 'Arm bands, fans, lucky charms — all genuine. Probably.', rumor: 'Kyoshi Island\'s warriors fight with fans. And they will not let you forget it.', items: ['lychee_nuts', 'jasmine_tea'], cosmetics: ['arm_bands'] },
  { id: 'riverbend_fish', spot: 'riverbend_1', merchant: 'Old Tam', title: 'Fish Seller', nation: 'earth', region: 'earth_heartland', greeting: 'River fish, caught this morning by my grandson. He is a terrible fisherman, so these are very lucky fish.', rumor: 'I keep an old journal from a swamp waterbender who traded here. Ask me if you want it — no wait, ask the elder.', items: ['raw_fish', 'cabbage', 'bread_crumbs'] },
  // ---------------- Fire Nation ----------------
  { id: 'fn_spice', spot: 'fn_1', merchant: 'Kazu', title: 'Spice Merchant', nation: 'fire', region: 'fire_nation_capital', greeting: 'Fire flakes! Hot enough to make a dragon cry!', rumor: 'The Fire Sages keep four braziers in their court. They say the Avatar could light them all with one breath.', items: ['fire_flakes', 'healing_herbs', 'jasmine_tea'], cosmetics: ['fire_cloak', 'fire_hakama'] },
  { id: 'fn_armorer', spot: 'fn_2', merchant: 'Rika', title: 'Armorer', nation: 'fire', region: 'fire_nation_capital', greeting: 'Plate, greaves, swords. The Fire Nation does not do things by halves.', rumor: 'Master Jeong runs the Agni Kai arena like a palace guard drill. Speed, speed, speed.', items: ['healing_herbs'], cosmetics: ['fire_armor_light', 'fire_armored_boots', 'dao_swords'] },
  { id: 'fn_harbor_fish', spot: 'fn_3', merchant: 'Shoji the Younger', title: 'Harbor Fishmonger', nation: 'fire', region: 'fire_nation_capital', greeting: 'Straight off the boats — and the boats came straight from the sea!', rumor: 'There are ruins in the volcano valley west of here. Sun Warriors, the old stories say.', items: ['raw_fish', 'fire_flakes', 'sea_prunes', 'bread_crumbs'] },
  { id: 'ember_fruit', spot: 'ember_1', merchant: 'Mai-Lin', title: 'Fruit Seller', nation: 'fire', region: 'ember_island', greeting: 'Lychee, peaches, fire flakes for the beach! Vacation prices!', rumor: 'The Ember Island Players lost three pages of their script. The play is terrible either way.', items: ['lychee_nuts', 'moon_peaches', 'fire_flakes', 'jasmine_tea'] },
  // ---------------- Air Temple ----------------
  { id: 'air_trader', spot: 'air_temple_1', merchant: 'Brother Dawa', title: 'Nomad Trader', nation: 'air', region: 'southern_air_temple', greeting: 'The monks do not need much — but the bison need moon peaches, and lots of them.', rumor: 'The temple bells have not rung in a long time. They only answer to the wind, they say.', items: ['moon_peaches', 'lychee_nuts', 'jasmine_tea', 'healing_herbs'], cosmetics: ['air_nun_dress'] },
  { id: 'air_pedlar', spot: 'air_temple_2', merchant: 'Pema', title: 'Trailhead Pedlar', nation: 'air', region: 'southern_air_temple', greeting: 'Long climb ahead! Snacks? Herbs? A walking stick? I do not have walking sticks.', rumor: 'A pilgrim told me there is a tablet near the gate with words carved by the wind itself.', items: ['moon_peaches', 'healing_herbs', 'bread_crumbs'] },
  // ---------------- Wilds: Omashu, Kyoshi, Misty Palms, tundra ----------------
  { id: 'misty_cantina', spot: 'misty_1', fallback: { x: 168, z: 846, yaw: Math.PI }, merchant: 'Ghashiun', title: 'Cantina Keeper', nation: 'neutral', region: 'si_wong_desert', greeting: 'Water costs extra in the desert. Everything else costs extra too.', rumor: 'A scholar here is looking for someone brave enough to dig into the Buried Library.', items: ['healing_herbs', 'jasmine_tea', 'glowing_mushroom', 'lychee_nuts'] },
  { id: 'misty_outfitter', spot: 'misty_2', fallback: { x: 177, z: 851, yaw: -Math.PI / 2 }, merchant: 'Sha-Mo', title: 'Sand-sailer Outfitter', nation: 'neutral', region: 'si_wong_desert', greeting: 'Goggles, wraps, water skins — the desert takes the unprepared.', rumor: 'The sandbenders say an owl spirit guards the library. A very large owl.', items: ['healing_herbs', 'bread_crumbs'], cosmetics: ['arm_bands'] },
  { id: 'kyoshi_fish', spot: 'kyoshi_1', fallback: { x: 1834, z: -432, yaw: -Math.PI / 2 }, merchant: 'Koko\'s Father', title: 'Fish Market', nation: 'earth', region: 'kyoshi_island', greeting: 'Welcome to Kyoshi Island! Mind the unagi, buy some fish.', rumor: 'The Kyoshi Warriors lost a few of their fans in the last storm. Their captain would be grateful for help.', items: ['raw_fish', 'sea_prunes', 'cabbage', 'healing_herbs'] },
  { id: 'omashu_cabbage', spot: 'omashu_1', fallback: { x: -438, z: -640, yaw: -Math.PI / 2 }, merchant: 'The Cabbage Merchant', title: 'Cabbage Stall', nation: 'earth', region: 'omashu', greeting: 'Cabbages! Fresh cabbages! Please do not bend anything near the cart.', rumor: 'My cabbages! ...Sorry. Old habit. King Bumo is quite fond of them, you know.', items: ['cabbage', 'lychee_nuts', 'bread_crumbs'] },
  { id: 'omashu_stone', spot: 'omashu_2', fallback: { x: -462, z: -640, yaw: Math.PI / 2 }, merchant: 'Gan Jin', title: 'Stonecutter', nation: 'earth', region: 'omashu', greeting: 'Omashu stone, cut to order. Jade on Tuesdays.', rumor: 'The king set up a boulder arena on the high terrace. He says it is for "bowling".', items: ['glowing_mushroom', 'jade_shard'], cosmetics: ['earth_shoulder_guard'] },
  // ---------------- Beast keepers: companions for sale, each only from its own nation ----------------
  { id: 'nwt_beasts', spot: 'nwt_beasts', fixed: true, fallback: { x: -178, z: -1812, yaw: -Math.PI / 2 }, merchant: 'Kallik', title: 'Beast Keeper', nation: 'water', region: 'northern_water_tribe', greeting: 'Every bear dog in my pens was born on the ice and raised to the saddle. They are not cheap, but they will carry you through a blizzard.', rumor: 'Wild bear dogs den in the Frozen Tundra. Earn a mother\'s trust and you will never need my pens, but that takes patience.', items: ['sea_prunes', 'raw_fish'], companions: ['polar_bear_dog'] },
  { id: 'bss_beasts', spot: 'bss_beasts', fixed: true, fallback: { x: 648.5, z: 23.3, yaw: 1.92 }, merchant: 'Gong', title: 'Beast Keeper', nation: 'earth', region: 'ba_sing_se', greeting: 'Ostrich horses for the road, badgermoles for the stubborn. Earth Kingdom stock only; the Dai Li inspect my papers every week.', rumor: 'Badgermoles taught the first earthbenders. Some of mine still remember, and they sulk if you call them moles.', items: ['cabbage', 'glowing_mushroom'], companions: ['ostrich_horse', 'badgermole'] },
  { id: 'fn_beasts', spot: 'fn_beasts', fixed: true, fallback: { x: -898.2, z: 984.2, yaw: Math.PI / 2 }, merchant: 'Stablemaster Hira', title: 'Beast Keeper', nation: 'fire', region: 'fire_nation_capital', greeting: 'Komodo rhinos from the Royal Cavalry stables, and turtle-ducks for the gentle-hearted. Dragons? Nobody sells a dragon. You would have to earn one.', rumor: 'The Sun Warrior ruins are not as empty as the sages claim. Bring the Sun Stone and see what answers.', items: ['fire_flakes', 'bread_crumbs'], companions: ['komodo_rhino', 'turtle_duck'] },
  { id: 'air_beasts', spot: 'air_beasts', fixed: true, fallback: { x: 1485, z: 1189.4, yaw: 2.6 }, merchant: 'Brother Norbu', title: 'Bison Herder', nation: 'air', region: 'southern_air_temple', greeting: 'The herd chooses its friends, and the temple asks an offering for its keep. A bison from our meadow will fly for you from the first day.', rumor: 'Lemurs nest in the temple eaves. They will steal your peaches whether or not you adopt one.', items: ['moon_peaches'], companions: ['sky_bison', 'winged_lemur'] },
  { id: 'tundra_lodge', spot: 'tundra_1', fallback: { x: 296, z: -1046, yaw: 0 }, merchant: 'Iluq', title: 'Lodge Trader', nation: 'water', region: 'frozen_tundra', greeting: 'Out here you buy what keeps you alive. Furs. Fish. Tea.', rumor: 'Something glitters deep in the glacier caves to the west of the Northern Tribe. The scout by the fire knows more.', items: ['raw_fish', 'sea_prunes', 'jasmine_tea', 'healing_herbs'], cosmetics: ['water_fur_coat'] },
];

export function shopById(id: string): ShopDef | undefined {
  return SHOPS.find((s) => s.id === id);
}
