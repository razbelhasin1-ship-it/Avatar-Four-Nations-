/**
 * Everything the website says about the game, in one place. Every name below is the game's own
 * (techniques, masters, companions, quests, enemies, places); tests/unit/site.catalogue.test.ts
 * checks them against the game's registries so the site never advertises something the game
 * does not have, and never leaves a technique out.
 */

export type ElementId = 'water' | 'earth' | 'fire' | 'air';
export type TechKind = 'basic' | 'heavy' | 'ability' | 'defense' | 'movement' | 'passive' | 'ultimate' | 'combined';

export interface Technique {
  id: string;
  name: string;
  kind: TechKind;
  text: string;
  /** Shown as a small note (how it is unlocked, or that it is optional). */
  note?: string;
}

export const KIND_LABEL: Record<TechKind, string> = {
  basic: 'Combo',
  heavy: 'Charged',
  ability: 'Technique',
  defense: 'Defense',
  movement: 'Movement',
  passive: 'Passive',
  ultimate: 'Ultimate',
  combined: 'All four',
};

export const ELEMENT_NAMES: Record<ElementId, string> = {
  water: 'Water',
  earth: 'Earth',
  fire: 'Fire',
  air: 'Air',
};

/** How each element plays (from the game's start screen and combat design). */
export const ELEMENT_STYLE: Record<ElementId, { motto: string; style: string }> = {
  water: {
    motto: 'Push and pull',
    style:
      'Flowing attacks, redirection, water whips and ice. Waterbending depends on real water: the sea, rivers, lakes, ponds, fountains, jars, snow and ice. You draw it before you bend it, carry it with you, and away from water there is none to bend.',
  },
  earth: {
    motto: 'Stand your ground',
    style:
      'Heavy and defensive: pillars, walls you punch forward, timed stone guard counters, rock armour and earth surfing. Stones come out of the ground, and you can lift the real rocks of the world.',
  },
  fire: {
    motto: 'Breath is power',
    style:
      'Aggressive and combo-driven: four-hit chains, a flamethrower stream, jet dashes, an explosive finisher and lightning that leaps between foes. A small flame lives in your palm while you explore.',
  },
  air: {
    motto: 'Never stand still',
    style:
      'Fast and evasive: a double jump, a glider staff that snaps open into two fans (dive, swoop, bend gusts under it and ride the updrafts by the temple cliffs), the air scooter, shields that deflect and redirect projectiles, and a vortex that lifts foes off the ground. Light on damage, heavy on knockback.',
  },
};

export const TECHNIQUES: Record<ElementId, Technique[]> = {
  water: [
    { id: 'water_whip', name: 'Water Whip', kind: 'basic', text: 'A flowing four-step whip pulled from real water: right and left lashes, a spinning lash all around you, then a crack from overhead.' },
    { id: 'water_blast', name: 'Water Blast', kind: 'heavy', text: 'Gather a churning sphere of water and drive it forward like a battering ram.' },
    { id: 'water_shield', name: 'Water Shield', kind: 'defense', text: 'Spinning rings of water block projectiles, soften blows and put out flames.' },
    { id: 'ice_shards', name: 'Ice Shards', kind: 'ability', text: 'A fan of razor-sharp shards. Carves straight from ice when there is any nearby.' },
    { id: 'ice_wall', name: 'Ice Wall', kind: 'defense', text: 'A climbable wall of ice that blocks attacks and becomes a source of ice itself, then slowly melts.' },
    { id: 'water_sweep', name: 'Water Sweep', kind: 'ability', text: 'Drop low and sweep a wide crescent wave across the ground.' },
    { id: 'freezing_strike', name: 'Freezing Strike', kind: 'ability', text: 'A near-frozen lash that wraps a foe and freezes them solid. Soaked targets stay frozen longer.' },
    { id: 'water_jet', name: 'Water Jet', kind: 'ability', text: 'A thin, high-pressure jet that pushes foes back, slices projectiles and douses flames.' },
    { id: 'water_spout', name: 'Water Spout', kind: 'movement', text: 'Ride a spinning column of water above a lake, a river or the sea, for as long as you like.' },
    { id: 'water_heal', name: 'Healing Waters', kind: 'ability', text: 'Water glows in your hands and knits wounds, yours and those of allies beside you.' },
    { id: 'water_snow_draw', name: 'Snow Gathering', kind: 'passive', text: 'Healer Yugoda’s teaching: draw water from snow and ice much faster.' },
    { id: 'water_moisture', name: 'Moisture Extraction', kind: 'ability', text: 'Pull water from plants and humid air. Rich in swamps and forests, almost nothing in deserts.' },
    { id: 'ice_spikes', name: 'Ice Spikes', kind: 'ability', text: 'A line of jagged ice spikes erupts toward your foe and hurls them into the air.' },
    { id: 'octopus_form', name: 'Octopus Form', kind: 'defense', text: 'A shell of water grows eight tentacles that swat blasts away and lash anyone within reach.' },
    { id: 'ice_prison', name: 'Ice Prison', kind: 'ability', text: 'Water rushes to a foe and freezes around them to the chest. They cannot move or bend until it cracks.' },
  ],
  earth: [
    { id: 'earth_strike', name: 'Rock Strike', kind: 'basic', text: 'Stomp rocks out of the ground and punch them forward, in a combo that ends with a disc of stone kicked at your foe.' },
    { id: 'earth_slam', name: 'Seismic Slam', kind: 'heavy', text: 'A charged stomp sends a shockwave around you and launches foes.' },
    { id: 'earth_pillar', name: 'Earth Pillar', kind: 'ability', text: 'A pillar erupts under your target, or under you to lift you up. You can stand on it.' },
    { id: 'ground_spikes', name: 'Ground Spikes', kind: 'ability', text: 'A line of stone spikes races along the ground, launching anything in its path.' },
    { id: 'boulder_roll', name: 'Boulder Roll', kind: 'ability', text: 'Heave a huge boulder out of the ground and send it rolling over everything in its way.' },
    { id: 'earth_grip', name: 'Earth Grip', kind: 'ability', text: 'The ground closes over your target’s feet like a fist of stone.' },
    { id: 'stone_gloves', name: 'Stone Gloves', kind: 'ability', text: 'Two fists of stone fly from your hands, strike your target and drag them toward you.' },
    { id: 'stone_wall', name: 'Stone Wall', kind: 'defense', text: 'A thick wall that stops projectiles. Punch it to send the whole slab crashing forward.' },
    { id: 'stone_guard', name: 'Stone Guard', kind: 'defense', text: 'Brace with stone-clad forearms. Guard at the instant of a blow for a perfect block and a counter.' },
    { id: 'rock_armor', name: 'Rock Armor', kind: 'defense', text: 'Slabs tear out of the ground and clamp onto you from boots to helmet: half the force of every blow, and nothing staggers you.' },
    { id: 'earth_surf', name: 'Earth Surf', kind: 'movement', text: 'Ride the crest of a wave of earth that builds speed, carves turns and bowls enemies over.' },
    { id: 'earth_launch', name: 'Earth Launch', kind: 'movement', text: 'A pillar of stone catapults you high into the air. Come down hard for a shockwave.' },
    { id: 'earth_pillar_charge', name: 'Pillar Charge', kind: 'movement', text: 'Standing on your raised pillar, ride it across the ground into your enemies and slam it down with a shockwave. Chain up to three charges.' },
    { id: 'seismic_sense', name: 'Seismic Sense', kind: 'passive', text: 'Stomps and hard landings reveal nearby enemies and hidden things, even through walls.' },
  ],
  fire: [
    { id: 'fire_jab', name: 'Flame Punch', kind: 'basic', text: 'A four-hit chain of fire punches with an arcing flame slash and a heavy finishing bolt.' },
    { id: 'fire_blast', name: 'Charged Fireball', kind: 'heavy', text: 'Charge a fireball that explodes and sets foes burning.' },
    { id: 'flame_sweep', name: 'Flame Sweep', kind: 'ability', text: 'A low sweep kick throws an arc of flame across several foes.' },
    { id: 'spinning_flame_kick', name: 'Spinning Flame Kick', kind: 'ability', text: 'Leap into a spinning kick that throws an expanding ring of fire around you.' },
    { id: 'fire_stream', name: 'Fire Stream', kind: 'ability', text: 'A continuous, roaring jet of flame from both palms.' },
    { id: 'breath_of_fire', name: 'Breath of Fire', kind: 'ability', text: 'The oldest firebending form: a billowing cone of fire that melts ice and boils water.' },
    { id: 'explosive_finisher', name: 'Explosive Finisher', kind: 'ability', text: 'Leap with both fists wreathed in fire and drive them into the ground in a massive explosion.' },
    { id: 'fire_lightning', name: 'Lightning Generation', kind: 'ability', text: 'Separate the energies within you and release a near-instant bolt that leaps from foe to foe.' },
    { id: 'fire_whip', name: 'Fire Whip', kind: 'ability', text: 'A long lash of flame cracks across the ground and catches several foes in one stroke.' },
    { id: 'dancing_dragon', name: 'Dancing Dragon', kind: 'ability', text: 'The Sun Warriors’ form: fire coils around you, then two dragons of flame spiral forward together.' },
    { id: 'fire_combustion', name: 'Combustionbending', kind: 'ability', text: 'Gather heat behind the third eye and loose a thin streak from your brow that explodes where it strikes.', note: 'Only for characters painted with the Third Eye' },
    { id: 'fire_shield', name: 'Fire Shield', kind: 'defense', text: 'A roaring wheel of fire burns attacks out of the air. A perfect block bursts into a counter-blast.' },
    { id: 'fire_dash', name: 'Fire Dash', kind: 'movement', text: 'Rocket forward on flame from fists and feet, leaving a burning trail.' },
  ],
  air: [
    { id: 'air_palm', name: 'Air Palm', kind: 'basic', text: 'A four-step combo of palm gusts ending in a crescent kick: fast, wide and full of knockback.' },
    { id: 'air_blast', name: 'Air Blast', kind: 'heavy', text: 'Charge a cone of wind that launches light enemies off their feet.' },
    { id: 'air_sweep', name: 'Air Sweep', kind: 'ability', text: 'A low sweeping kick sends a crescent of wind skimming along the ground.' },
    { id: 'air_spin_strike', name: 'Spinning Air Strike', kind: 'ability', text: 'Spin on the spot and throw everything around you outward, projectiles included.' },
    { id: 'air_vortex', name: 'Vortex', kind: 'ability', text: 'A small tornado drags enemies in, lifts them off the ground, then hurls them away.' },
    { id: 'air_swipe', name: 'Air Swipe', kind: 'ability', text: 'A thin crescent blade of wind that passes through a whole line of foes.' },
    { id: 'air_suction', name: 'Air Suction', kind: 'ability', text: 'Draw the wind back into your palms: foes are dragged toward you and weapons fly from their grip.' },
    { id: 'air_shield', name: 'Air Shield', kind: 'defense', text: 'A spinning sphere of air that deflects projectiles and throws attackers back.' },
    { id: 'air_redirect', name: 'Wind Redirection', kind: 'defense', text: 'Catch incoming attacks in a whirl of wind and send them back, stronger than before.' },
    { id: 'air_dash', name: 'Air Dash', kind: 'movement', text: 'A long, wind-propelled dash, on the ground or in mid-air.' },
    { id: 'air_jump', name: 'Air Jump', kind: 'passive', text: 'Kick off a burst of compressed air to jump again in mid-air.' },
    { id: 'air_scooter', name: 'Air Scooter', kind: 'movement', text: 'Balance on a spinning ball of air and race across the ground, even over water for a few seconds.' },
  ],
};

export const ULTIMATES: Technique[] = [
  { id: 'ult_hurricane', name: 'Hurricane', kind: 'ultimate', text: 'Wheel the sky into a towering hurricane that drags enemies into its eye and hurls them out.' },
  { id: 'ult_tsunami', name: 'Tsunami', kind: 'ultimate', text: 'Heave the nearest sea, river or lake into a wall of water and drive it across the battlefield.' },
  { id: 'ult_earthquake', name: 'Earthquake', kind: 'ultimate', text: 'Stomp with the weight of the world: the ground splits, rock rises and every grounded foe falls.' },
  { id: 'ult_fire_tornado', name: 'Fire Tornado', kind: 'ultimate', text: 'Spin into a blazing column of flame and drive it across the field.' },
  { id: 'ult_cataclysm', name: 'Avatar Cataclysm', kind: 'combined', text: 'Rise into the eye of all four elements, then release them in a single battlefield-scale blast.' },
];

export interface SubArt {
  id: 'lava' | 'projection' | 'blood';
  name: string;
  parent: ElementId;
  unlock: string;
  text: string;
  moves: Technique[];
}

export const SUB_ARTS: SubArt[] = [
  {
    id: 'lava',
    name: 'Lavabending',
    parent: 'earth',
    unlock: 'Master Earth, then complete “The Heart of the Mountain”',
    text: 'Rare earthbending: soften earth into glowing lava that spreads, burns anyone in it (you too) and cools back into stone you can stand on.',
    moves: [
      { id: 'lava_melt', name: 'Melt', kind: 'ability', text: 'A patch of earth softens into lava, spreads a little, then crusts over into stone.' },
      { id: 'lava_disc', name: 'Lava Disc', kind: 'ability', text: 'A spinning disc of molten rock that cuts through wood and shields.' },
      { id: 'lava_pool', name: 'Lava Pool', kind: 'ability', text: 'The ground under your target cracks and gives way into a pool of lava.' },
      { id: 'lava_stream', name: 'Lava Stream', kind: 'ability', text: 'A tendril of lava rolls along the ground and bends to chase your target.' },
      { id: 'lava_moat', name: 'Lava Moat', kind: 'defense', text: 'A ring of lava keeps melee fighters at bay; charge at you and a column rises in the way.' },
      { id: 'lava_cool', name: 'Divert and Cool', kind: 'ability', text: 'Turn lava aside and draw out its heat: instant bridges, steps, walls and safe footing.' },
      { id: 'lava_eruption', name: 'Eruption', kind: 'ability', text: 'In the Avatar State, wake the fire under the earth: fountains of lava, huge and hard to aim.' },
    ],
  },
  {
    id: 'projection',
    name: 'Spiritual Projection',
    parent: 'air',
    unlock: 'Master Air, then complete “The Silent Mind”',
    text: 'Sit, breathe and let go: your spirit leaves your body to scout through walls and water and speak with people, while your body meditates, defenseless.',
    moves: [
      { id: 'spirit_project', name: 'Project', kind: 'ability', text: 'Leave your body as a translucent spirit that passes through walls and water.' },
      { id: 'spirit_sight', name: 'Spirit Sight', kind: 'ability', text: 'Hidden spirits, spirit traces and sealed doors glow through solid walls.' },
      { id: 'spirit_bond', name: 'Bond Lock', kind: 'ability', text: 'Cross great distances in moments to someone you share a strong bond with.' },
      { id: 'spirit_call', name: 'Call Out', kind: 'ability', text: 'Speak to a bonded character from afar; a bonded companion comes to guard your body.' },
      { id: 'spirit_return', name: 'Return', kind: 'ability', text: 'Follow the streak of light back to your body, wherever it is now.' },
    ],
  },
  {
    id: 'blood',
    name: 'Bloodbending',
    parent: 'water',
    unlock: 'Master Water, then complete “The Puppetmaster”',
    text: 'A forbidden art that works only under the full moon. It never harms by itself, a skilled waterbender can break free, the Avatar State nullifies it, and every use strains the mind.',
    moves: [
      { id: 'blood_hold', name: 'Hold', kind: 'ability', text: 'Your target freezes in place, fully aware, unable to move or bend.' },
      { id: 'blood_puppet', name: 'Puppet', kind: 'ability', text: 'Steer a held body on a short leash: walk, turn, a stiff shove, a grip that drops the weapon.' },
      { id: 'blood_redirect', name: 'Redirect', kind: 'ability', text: 'Turn a held foe’s swing or blast on another hostile. Never on an ally or an innocent.' },
      { id: 'blood_second', name: 'Second Hold', kind: 'passive', text: 'At high Water mastery, hold two bodies at once.' },
      { id: 'blood_release', name: 'Release', kind: 'ability', text: 'Let go. The held bodies are their own again.' },
      { id: 'blood_psychic', name: 'Psychic Hold', kind: 'ability', text: 'Bring a body to its knees without a gesture. It can only subdue.', note: 'Optional Legend of Korra extension, off by default' },
      { id: 'blood_lift', name: 'Lift', kind: 'ability', text: 'Raise a held body off its feet and set it down a short distance away, unhurt.', note: 'Optional Legend of Korra extension, off by default' },
    ],
  },
];

export interface Master {
  name: string;
  title: string;
  element: ElementId;
  place: string;
  teaches: string[];
  grandmaster?: boolean;
  hidden?: boolean;
}

/** Every master in src/data/masters.ts, with what they teach (technique names). */
export const MASTERS: Master[] = [
  { name: 'Master Siku', title: 'Grandmaster of Water', element: 'water', place: 'Northern Water Tribe, Waterbending Courtyard', teaches: ['Ice Wall', 'Freezing Strike', 'Octopus Form', 'Trial of the Ocean and Moon'], grandmaster: true },
  { name: 'Healer Yugoda', title: 'Elder Healer', element: 'water', place: 'Northern Water Tribe, healing hut', teaches: ['Healing Waters', 'Snow Gathering'] },
  { name: 'Hunter Akka', title: 'Southern Hunter', element: 'water', place: 'Southern Water Tribe, the hunting ice', teaches: ['Ice Shards', 'Water Sweep', 'Ice Prison'] },
  { name: 'Master Aput', title: 'Tide Elder of Wolf Cove', element: 'water', place: 'Southern Water Tribe, the training circle by the Frozen Pond', teaches: ['Awakens waterbending in visitors to Wolf Cove'] },
  { name: 'Huu', title: 'Swamp Sage', element: 'water', place: 'Foggy Swamp, shore of the Great Banyan Tree', teaches: ['Moisture Extraction', 'Water Jet', 'Water Spout', 'Ice Spikes'], hidden: true },
  { name: 'King Bumo', title: 'Grandmaster of Earth', element: 'earth', place: 'Omashu', teaches: ['Boulder Roll', 'Earth Launch', 'Trial of the Unmoving Mountain'], grandmaster: true },
  { name: 'Master Lien', title: 'Stone Fist Dojo', element: 'earth', place: 'Ba Sing Se, Stone Fist Dojo', teaches: ['Stone Wall', 'Stone Guard', 'Stone Gloves'] },
  { name: 'Lin the Blind', title: 'Earth Rumble Champion', element: 'earth', place: 'Gaoling, Earth Rumble ring', teaches: ['Seismic Sense', 'Rock Armor', 'Earth Grip'], hidden: true },
  { name: 'Oyagi', title: 'of Kyoshi Island', element: 'earth', place: 'Kyoshi Village, the Avatar statue green', teaches: ['Ground Spikes', 'Earth Surf'] },
  { name: 'Sun Chief Ahkon', title: 'Grandmaster of Fire', element: 'fire', place: 'Sun Warrior Ruins, Altar of the Eternal Flame', teaches: ['Explosive Finisher', 'Dancing Dragon', 'Trial of the Eternal Flame'], grandmaster: true },
  { name: 'Master Jeong', title: 'Agni Kai Instructor', element: 'fire', place: 'Fire Nation Capital, Royal Plaza drill yard', teaches: ['Fire Dash', 'Spinning Flame Kick', 'Fire Whip'] },
  { name: 'Sage Hira', title: 'Fire Sage', element: 'fire', place: 'Fire Nation Capital, the High Temple court, Hari Bulkan', teaches: ['Breath of Fire', 'Fire Shield'] },
  { name: 'General Iro', title: 'Retired Tea Enthusiast', element: 'fire', place: 'Ember Island, the tea house terrace', teaches: ['Fire Stream', 'Lightning Generation'] },
  { name: 'Abbot Pasang', title: 'Grandmaster of Air', element: 'air', place: 'Southern Air Temple, the summit by the central tower', teaches: ['Trial of the Four Winds'], grandmaster: true },
  { name: 'Monk Tenzo', title: 'Temple Elder', element: 'air', place: 'Southern Air Temple, moon-gate training courtyard', teaches: ['Air Jump', 'Spinning Air Strike', 'Air Swipe'] },
  { name: 'Brother Iio', title: 'Air Acrobat', element: 'air', place: 'Southern Air Temple, the airball court', teaches: ['Air Scooter', 'Air Shield', 'Air Suction'] },
  { name: 'The Hermit', title: 'of the Four Winds', element: 'air', place: 'Shrine of the Four Winds, a hidden ledge east of the temple', teaches: ['Wind Redirection', 'Vortex'], hidden: true },
];

export interface Companion {
  name: string;
  kind: string;
  how: string;
  perks: string[];
}

/** Bondable companions (src/data/creatures.ts), with their bond perks. */
export const COMPANIONS: Companion[] = [
  { name: 'Sky Bison', kind: 'Flying mount', how: 'Sky Bison Meadow near the Southern Air Temple; sold by the temple’s beast keeper', perks: ['Flight', 'Yip Yip! speed boost', 'Sky Carrier', 'Tail Gust'] },
  { name: 'Sun Warrior Dragon', kind: 'Flying mount', how: 'Only one remains, sleeping near the Sun Warrior Ruins. It answers when the Sun Stone is rekindled. Never for sale', perks: ['Flight', 'Dragonfire', 'Sun Dash', 'Guardian', 'Inferno'] },
  { name: 'Polar Bear Dog', kind: 'Mount', how: 'The Snowdrift Den in the north; sold in the Northern Water Tribe', perks: ['Swims icy water', 'Gallop', 'Charge', 'Guardian', 'Tracker'] },
  { name: 'Badgermole', kind: 'Mount', how: 'The Badgermole Caves; sold in Ba Sing Se’s Lower Ring', perks: ['Dig for mushrooms and jade', 'Burrow under walls', 'Tremor Sense', 'Earth Hide'] },
  { name: 'Ostrich Horse', kind: 'Mount', how: 'The Gaoling Fields; sold in Ba Sing Se’s Lower Ring', perks: ['Full Stride', 'Leap', 'Kick', 'Wind Runner'] },
  { name: 'Komodo Rhino', kind: 'Mount', how: 'The Fire Nation cavalry mount, sold only at the Fire Nation harbour', perks: ['Stampede', 'Horn Charge', 'Armoured Hide', 'War Beast'] },
  { name: 'Winged Lemur', kind: 'Pet', how: 'The Southern Air Temple rooftops; sold at the temple', perks: ['Shoulder Perch', 'Fetch', 'Scout', 'Distract'] },
  { name: 'Turtle-Duck', kind: 'Pet', how: 'The palace turtle-duck pond and Lake Hiari’s shallows; sold at the Fire Nation harbour', perks: ['Pond Friend', 'Comfort', 'Dive for trinkets'] },
];

export const WILDLIFE = ['Otter Penguin', 'Cat Owl', 'Armadillo Lizard', 'Hog Monkey', 'Elephant Koi'];

export const ENEMIES = [
  'Fire Nation Soldier',
  'Agni Kai Duelist',
  'Yuyan Archer',
  'Earthbender Bandit',
  'Bandit Spearman',
  'Bandit Archer',
  'Dai Li Agent',
  'Rogue Waterbender',
  'Pirate Raider',
  'Platypus Bear',
  'Sabertooth Moose Lion',
];

export const BOSSES = [
  { name: 'Commander Rokuro', title: 'Fire Nation Commander' },
  { name: 'Captain Shen Lao', title: 'Dai Li Captain' },
  { name: 'Captain Kurou', title: 'The Sea Viper' },
];

export const SIDE_QUESTS = [
  'The Cabbage Shortage',
  'My Cabbages!',
  'A Letter Across the Sea',
  'The Lost Turtle-Duck',
  'The Sages’ Braziers',
  'The Silent Bells',
  'Moon Peaches for the Bison',
  'The Koi of the Spirit Oasis',
  'Into the Glacier Caves',
  'Knowledge in the Sand',
  'Bandits on the Road',
  'The Warriors’ Fans',
  'Love Amongst the Dragons',
  'The Pilgrim’s Ascent',
];

export const MAIN_QUEST = 'The Avatar Cycle';
/** Discovery quests that lead to the three hidden masters. */
export const DISCOVERY_QUESTS = ['Where the Four Winds Meet', 'The Sage of the Swamp', 'The Blind Bandit'];
/** Quests that open the rare arts (a fifth, “The Tide Without a Moon”, belongs to an optional extension that is off by default). */
export const ART_QUESTS = ['The Heart of the Mountain', 'The Silent Mind', 'The Puppetmaster', 'Hama in Custody'];

export interface Nation {
  id: ElementId;
  name: string;
  people: string;
  capital: string;
  start: string;
  places: string[];
}

export const NATIONS: Nation[] = [
  {
    id: 'water',
    name: 'Water Tribes',
    people: 'Northern and Southern Water Tribes',
    capital: 'Agna Qel’a and Wolf Cove',
    start: 'Start in a polar city of ice and canals in the north, or in Wolf Cove, a walled village of igloos on the southern ice.',
    places: ['Agna Qel’a', 'Great Ice Gate', 'Tribal Plaza', 'Waterbending Courtyard', 'Spirit Oasis', 'Harbor Quays', 'Glacier Caves', 'Tundra Watchtower', 'Moonlit Frozen Lake', 'Wolf Cove', 'The Great Igloo', 'Hearth Plaza', 'The Fire Navy Wreck', 'Penguin Sled Run'],
  },
  {
    id: 'earth',
    name: 'Earth Kingdom',
    people: 'Ba Sing Se and the kingdom’s towns',
    capital: 'Ba Sing Se',
    start: 'Start in the Earth Kingdom’s great walled city, between its rings, its monorail trains and the Agrarian Zone.',
    places: ['Ba Sing Se: Lower, Middle and Upper Ring', 'Stone Fist Dojo', 'Lake Laogai', 'Omashu', 'Gaoling', 'Riverbend Village', 'Kyoshi Island', 'Misty Palms Oasis', 'The Buried Library', 'The Foggy Swamp’s Great Banyan Tree', 'Badgermole Caves', 'Lake Hiari'],
  },
  {
    id: 'fire',
    name: 'Fire Nation',
    people: 'The capital and its islands',
    capital: 'The Fire Nation Capital',
    start: 'Start among the capital’s grand architecture, from the harbour city to the royal palace in the volcano’s crater.',
    places: ['Harbor City', 'Royal Plaza', 'Hari Bulkan', 'The royal palace and throne room', 'Agni Kai Arena', 'Royal Lake', 'Sun Warrior Ruins', 'Ember Island', 'Ember Hot Spring', 'The harbour causeway'],
  },
  {
    id: 'air',
    name: 'Air Nomads',
    people: 'The monks of the Southern Air Temple',
    capital: 'The Southern Air Temple',
    start: 'Start at a mountain temple above the clouds, among monks, sky bison and winged lemurs.',
    places: ['The Southern Air Temple', 'The central tower and sanctuary', 'Airball court', 'Bison terraces', 'Temple Trailhead', 'Sky Bison Meadow', 'Shrine of the Four Winds', 'Cloudmirror Tarn'],
  },
];

export const WEATHER = ['Clear', 'Cloudy', 'Rain', 'Fog', 'Wind', 'Snow', 'Blizzard', 'Ashfall', 'Sandstorm'];

/** Character creator options (src/character/Appearance.ts, Markings.ts, data/cosmetics.ts). */
export const CREATOR = {
  hairstyles: 16,
  hairColors: 12,
  facialHair: ['Stubble', 'Goatee', 'Long Mustache', 'Short Beard', 'Sage Beard', 'Sideburns'],
  scars: ['Burn Scar (Left Eye)', 'Cheek Scar', 'Split Brow', 'Chin Nick', 'Lightning Scar (Back)'],
  arrowDesigns: ['Classic', 'Swirled', 'Ink Glyph', 'Pale Glyph', 'Filigree', 'Ornate', 'Tribal'],
  facePaints: ['Painted Arrow', 'Southern Warrior Paint', 'Mark of the Wise', 'Mark of the Brave', 'Mark of the Trusted', 'Kyoshi Warrior Makeup', 'Freedom Fighter Paint', 'Third Eye', 'The Painted Lady'],
  clothingPieces: 80,
};

export const TECHNIQUE_COUNT =
  Object.values(TECHNIQUES).reduce((n, list) => n + list.length, 0) + ULTIMATES.length + SUB_ARTS.reduce((n, a) => n + a.moves.length, 0);

export interface FeatureItem {
  title: string;
  text: string;
}

export interface FeatureCategory {
  id: string;
  title: string;
  kicker: string;
  intro: string;
  /** Element tint for the category's emblem. */
  tint: ElementId | 'avatar' | 'gold';
  items: FeatureItem[];
  /** A richer block rendered with the category. */
  detail?: 'techniques' | 'ultimates' | 'arts' | 'masters' | 'companions' | 'world' | 'quests' | 'enemies' | 'creator';
}

export const CATEGORIES: FeatureCategory[] = [
  {
    id: 'bending',
    title: 'The four elements',
    kicker: 'Bending',
    intro: 'Four styles that move, sound and hit differently. Each element has its own combo, charged attack, techniques, defenses and ways to move.',
    tint: 'gold',
    detail: 'techniques',
    items: [
      { title: 'Four distinct styles', text: 'Water flows and redirects, Earth stands firm and hits hard, Fire chains fast combos, Air dodges and throws foes around. Each has its own stance, rhythm and range.' },
      { title: 'Real water only', text: 'Waterbending draws from real sources: the sea, rivers, lakes, ponds, fountains, canals, jars and barrels, rain, plants, snow and ice. Away from water there is nothing to bend.' },
      { title: 'Water you can see leave', text: 'Draw from a basin and its level drops, then slowly refills. Bent water takes the colour of the source it came from, and returns to the world as a splash and a puddle.' },
      { title: 'Lift the world’s rocks', text: 'Earthbenders can lift the real rocks placed around the world, or tear stones out of the ground. Too big to lift? The game tells you.' },
      { title: 'Play between fights', text: 'While exploring, a waterbender keeps an orb of water at hand, an earthbender carries a stone and a firebender holds a flame in the palm.' },
      { title: 'Avatar Flow', text: 'Switch element mid-combo and the chain carries on in the new element. Every element woven into one unbroken chain adds damage, up to four.' },
      { title: 'Weight in every hit', text: 'Each blow throws an element-specific burst of wind, spray, debris or embers, a short hit-freeze and a camera kick.' },
      { title: 'Marks on the ground', text: 'Fire leaves scorch marks, water leaves wet patches and earthbending cracks the ground.' },
    ],
  },
  {
    id: 'avatar',
    title: 'Become the Avatar',
    kicker: 'The Avatar',
    intro: 'You are the Avatar from the very first minute: any start can master all four elements.',
    tint: 'avatar',
    detail: 'ultimates',
    items: [
      { title: 'Avatar State at will', text: 'Enter the Avatar State from the start: glowing eyes and tattoos, a wave of energy, a light wind around you, stronger bending and a spirit meter.' },
      { title: 'The Elements Sphere', text: 'Master all four elements and the same input raises the Elements Sphere: a sphere of air, a ring of water, a plate of fire and orbiting rocks.' },
      { title: 'Five ultimate techniques', text: 'Inside the sphere: Hurricane, Tsunami, Earthquake, Fire Tornado and the Avatar Cataclysm, which joins all four.' },
      { title: 'Any nation, all four elements', text: 'Your start chooses your arrival, first quest, first master and starting moves, but never limits what you can learn.' },
    ],
  },
  {
    id: 'arts',
    title: 'Specialized bending',
    kicker: 'Rare arts',
    intro: 'Three rare branches open after mastering their element and finishing a quest. The moon matters too.',
    tint: 'gold',
    detail: 'arts',
    items: [
      { title: 'Lavabending, Spiritual Projection, Bloodbending', text: 'Each is its own branch with its own moves, unlock quest, codex entry and rules.' },
      { title: 'A lunar cycle', text: 'The moon waxes and wanes over eight nights. Waterbending grows stronger while the moon is up, and strongest on the full moon.' },
      { title: 'Solstices', text: 'Twice a year, spirits draw near and spiritual projection lasts longer.' },
      { title: 'Combustionbending', text: 'Paint the Third Eye on your brow in the character creator and your firebending gains combustion.' },
    ],
  },
  {
    id: 'masters',
    title: 'Masters and mastery',
    kicker: 'Training',
    intro: 'Seventeen masters across the world, some hidden behind clues. Every lesson is a demonstration and a real challenge, and every technique they teach is yours to keep.',
    tint: 'gold',
    detail: 'masters',
    items: [
      { title: 'Lessons you play', text: 'Target practice, precision, timed defense, ring courses, sparring, ledge and flame trials. Pass and the technique is learned, usable at once and saved.' },
      { title: 'Grandmaster trials', text: 'Each element has a grandmaster with a three-stage Mastery Trial: the Trials of the Ocean and Moon, the Unmoving Mountain, the Eternal Flame and the Four Winds.' },
      { title: 'Mastery is earned', text: 'Knowing techniques is not mastery. Mastery takes proficiency, three completed lessons and the trial.' },
      { title: 'Awakening', text: 'The first master of an element you cannot yet bend awakens it in you.' },
      { title: 'Find them', text: 'Track any master from the journal: a route on the map and a marker on the compass.' },
    ],
  },
  {
    id: 'world',
    title: 'An open world of four nations',
    kicker: 'The world',
    intro: 'A four-kilometre-wide world with the four capitals, towns, wilds and hidden places, linked by roads with bridges, signposts, inns and farms.',
    tint: 'earth',
    detail: 'world',
    items: [
      { title: 'Four capitals', text: 'Agna Qel’a in the north, Ba Sing Se’s rings and walls, the Fire Nation Capital in its volcano, and the Southern Air Temple above the clouds.' },
      { title: 'Wolf Cove', text: 'The Southern Water Tribe: a walled village of igloos with the Great Igloo, a sled run, a shipwreck and an aurora festival.' },
      { title: 'Kyoshi Island', text: 'Its own map: Kyoshi Village, the dojo, the shrine, the Crescent Bridge and Crystal Falls, and Koi Harbor.' },
      { title: 'Journeys', text: 'Reach Kyoshi Island by trade ship, by rail and ferry from Ba Sing Se, or on a sky bison from the Air Temple, each with its own journey scene.' },
      { title: 'Fast travel', text: 'Travel from the map to any place you have discovered.' },
      { title: 'Discoveries', text: 'Places reveal themselves as you find them, and hidden masters wait behind clues.' },
    ],
  },
  {
    id: 'living',
    title: 'A living world',
    kicker: 'Atmosphere',
    intro: 'Day turns to night, weather rolls in by region, and people go about their lives.',
    tint: 'water',
    items: [
      { title: 'Day and night', text: 'A full day and night cycle with sunsets, lamplit streets and starry skies.' },
      { title: 'Nine kinds of weather', text: 'Clear, cloudy, rain, fog, wind, snow, blizzards, ashfall and sandstorms, each where it belongs.' },
      { title: 'Rain that stays', text: 'Streets darken in the rain, and in Ba Sing Se’s lanes puddles fill, then shrink away as the ground dries.' },
      { title: 'Crowds with routines', text: 'Townsfolk, monks, vendors and guards walk their own daily routines through every city.' },
      { title: 'Grass and trees that react', text: 'Grass parts around you and sways in the wind; forests stream in as you travel.' },
      { title: 'Water that answers', text: 'Ripples spread wherever you wade, splash or draw water, on every surface from the sea to a small jar.' },
      { title: 'Ambient life', text: 'Birds, drifting leaves, embers and motes, plus otter penguins, cat owls, armadillo lizards, hog monkeys and elephant koi.' },
      { title: 'Trains and ships', text: 'Ba Sing Se’s monorail trains run on their viaducts; ships and boats fill the harbours.' },
    ],
  },
  {
    id: 'quests',
    title: 'Quests and story',
    kicker: 'Adventure',
    intro: 'A main story, quests for every element and its mastery, discovery quests for hidden masters, and side quests across the world.',
    tint: 'fire',
    detail: 'quests',
    items: [
      { title: 'The Avatar Cycle', text: 'The main story: seek each nation, learn its element from those who love it most, master all four, and the Elements Sphere will answer.' },
      { title: 'Hidden masters', text: 'Three masters are only found by following clues: rumours of a hermit, a poster in Gaoling, travellers’ whispers about a swamp sage.' },
      { title: 'The Avatar Awakens', text: 'Each start has its own opening quest in its own city.' },
      { title: 'Fourteen side quests', text: 'From cabbage merchants to the koi of the Spirit Oasis.' },
      { title: 'Journal, compass and map', text: 'Every quest and objective is tracked in the journal, on the compass and on the world map.' },
      { title: 'A codex of lore', text: 'Entries on the world, its bending arts and its history fill in as you discover them.' },
    ],
  },
  {
    id: 'combat',
    title: 'Combat and foes',
    kicker: 'Combat',
    intro: 'Readable fights with real tells, camps and patrols, and three bosses.',
    tint: 'fire',
    detail: 'enemies',
    items: [
      { title: 'Combos and charge', text: 'A basic combo per element, a charged heavy attack, four technique slots, dodge, sprint and lock-on.' },
      { title: 'Chi', text: 'Bending spends chi, which flows back quickly and faster out of combat; every landed strike returns a little.' },
      { title: 'Status effects', text: 'Burning, soaking, freezing, knockdowns, launches and stagger.' },
      { title: 'Enemy tells', text: 'Foes signal their attacks before they land, so timing a shield, a guard or a dodge pays off.' },
      { title: 'Camps and patrols', text: 'Bandit camps, Fire Nation patrols, Dai Li agents and pirates in their own territories.' },
    ],
  },
  {
    id: 'companions',
    title: 'Animal companions',
    kicker: 'Companions',
    intro: 'Find animals by their tracks and habitats, earn their trust, never by fighting them, then bond, name and ride them.',
    tint: 'air',
    detail: 'companions',
    items: [
      { title: 'Earn their trust', text: 'The right food, patience and rescues. Each species has its own bonding challenge.' },
      { title: 'Ride and fly', text: 'Ground mounts gallop, charge and burrow; sky bison and dragons fly. On the wing, climb, dive, boost and use the mount’s special.' },
      { title: 'Bonds that grow', text: 'Every bond unlocks perks as it deepens, from shoulder-perching lemurs to dragonfire.' },
      { title: 'Beast keepers', text: 'Each nation has a keeper who sells stable-raised companions of that nation only, at a steep price. Dragons are never for sale.' },
      { title: 'Summon and stable', text: 'Call a companion to your side, switch between them and see them all in the stable.' },
    ],
  },
  {
    id: 'character',
    title: 'Your character',
    kicker: 'Customization',
    intro: 'A character creator with a live, rotatable 3D preview. Your look follows you everywhere, even riding and in the Avatar State.',
    tint: 'water',
    detail: 'creator',
    items: [
      { title: 'Body and face', text: 'Male or female body, face shapes and sliders, eyes and brows.' },
      { title: 'Hair', text: 'Sixteen hairstyles from monk-shaved to the warrior wolf tail, and twelve hair colours.' },
      { title: 'Markings', text: 'Seven Air Nomad arrow designs and nine face paints, from the Kyoshi Warrior makeup to the Painted Lady.' },
      { title: 'Clothes and wardrobe', text: 'Nation outfits and clothing layers, footwear, gloves, belts, headwear and necklaces. Change them any time in the wardrobe.' },
      { title: 'Shops and inventory', text: 'Shops in every nation, an inventory of items and food, currency, and cosmetics to unlock.' },
    ],
  },
  {
    id: 'sound',
    title: 'Sound and music',
    kicker: 'Audio',
    intro: 'Every sound effect in the game is generated as you play.',
    tint: 'air',
    items: [
      { title: 'Generated sound', text: 'Footsteps, every element, creatures, voices, crowds and the interface, all generated by the game’s own audio engine.' },
      { title: 'Music for each region', text: 'Generative music that follows where you are and what you are doing.' },
      { title: 'Ambience', text: 'Wind, water, fire and city life, mixed by place, weather and time of day.' },
      { title: 'A main theme', text: 'The main menu opens to its own theme.' },
    ],
  },
  {
    id: 'controls',
    title: 'Controls and settings',
    kicker: 'Play your way',
    intro: 'Made for touch screens, with every control sized for your thumbs.',
    tint: 'gold',
    items: [
      { title: 'Touch controls', text: 'A floating stick, camera drag and big on-screen buttons, with size, opacity, sensitivity and a left-handed layout.' },
      { title: 'Keyboard, mouse and gamepad', text: 'On a computer it plays with a keyboard and mouse or a gamepad, and every binding can be changed in Settings.' },
      { title: 'Graphics presets', text: 'Low, Medium, High and Ultra, plus render scale, shadows, bloom, effects, particles, grass, foliage and draw distance. Everything applies live.' },
      { title: 'Tutorial', text: 'An interactive tutorial on Meditation Isle, with contextual hints as you go.' },
      { title: 'Saves', text: 'Versioned save slots with autosave.' },
    ],
  },
  {
    id: 'platforms',
    title: 'Made for your phone',
    kicker: 'Platforms',
    intro: 'Free, in your phone’s browser or as an Android app. Tablets work too.',
    tint: 'gold',
    items: [
      { title: 'Phones and tablets', text: 'Touch controls and graphics tuned for phones. Turn your phone sideways: the game plays in landscape, full screen.' },
      { title: 'In your browser', text: 'Runs in current Chrome and Safari on your phone (and Edge or Firefox), with WebGL2. Nothing to install.' },
      { title: 'Android app', text: 'An Android app that runs the same game full-screen, keeping your saves between versions.' },
      { title: 'Built by one fan', text: 'Everything you see is built from code: models, textures, effects and sounds.' },
    ],
  },
];

export const LINKS = {
  apk: 'https://github.com/razbelhasin1-ship-it/Avatar-Four-Nations-/releases/latest/download/avatar-four-nations.apk',
  releases: 'https://github.com/razbelhasin1-ship-it/Avatar-Four-Nations-/releases/latest',
  source: 'https://github.com/razbelhasin1-ship-it/Avatar-Four-Nations-',
};
