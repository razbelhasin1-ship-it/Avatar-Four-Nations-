import type { BiomeId } from '../core/types';
import type { Nation } from '../world/WorldLayout';

/**
 * Creature catalogue: tameable companions (mounts and pets), ambient wildlife,
 * habitats, diets, taming profiles and bond unlocks. Pure data — consumed by
 * src/companions/* (spawning, AI, taming, riding, stable UI) and unit tests.
 *
 * Units: metres, seconds, radians. Trust and bond are 0..100.
 */

export type CreatureRole = 'mount' | 'pet' | 'ambient';
export type Locomotion = 'ground' | 'flyer' | 'swimmer' | 'amphibious';
export type Temperament = 'gentle' | 'wary' | 'skittish' | 'blind' | 'proud' | 'playful';
export type BondChallenge = 'none' | 'follow_flight' | 'race' | 'fearless';
export type RescueKind = 'injured' | 'ice_trap';
export type ClueKind = 'tracks' | 'nest' | 'burrow' | 'fur' | 'scratches' | 'bones' | 'scorch' | 'feathers';

export interface BondUnlock {
  /** Bond value (0..100) at which this unlocks. */
  at: number;
  ability: string;
  name: string;
  description: string;
}

export interface TamingProfile {
  /** Trust gained per second while the player stays calm nearby (within `calmRange`). */
  calmGain: number;
  /** Calm-approach trust is capped here — food and help do the rest. */
  calmCap: number;
  calmRange: number;
  /** Trust per feeding: preferred / liked food. */
  feedPreferred: number;
  feedLiked: number;
  /** Seconds before the same individual accepts food again (patience). */
  feedCooldown: number;
  /** Trust lost when frightened by sprinting / combat / bending nearby / being hit. */
  scareSprint: number;
  scareCombat: number;
  scareHit: number;
  /** Distance at which a nervous animal starts backing away from a stranger. */
  comfort: number;
  /** Distance at which noisy players (sprinting, fighting) are heard. */
  hearing: number;
  /** Trust needed before it accepts food at all. */
  feedMinTrust: number;
  /** Bond challenge (unlocks at challengeAt); 'none' bonds at 100 trust. */
  challenge: BondChallenge;
  challengeAt: number;
  /** Max interaction distance for feeding (m, from the creature's edge). */
  reach: number;
}

export interface SpeciesDef {
  id: string;
  name: string;
  plural: string;
  role: CreatureRole;
  locomotion: Locomotion;
  /** Can be ridden. */
  rideable: boolean;
  /** Can fly while ridden / as a companion. */
  flying: boolean;
  tameable: boolean;
  /** Body size (m): nose-to-tail length, height of the back, width. */
  size: { length: number; height: number; width: number };
  /** Collision radius for movement (m). */
  radius: number;
  /** Ground speeds (m/s). */
  walk: number;
  run: number;
  sprint: number;
  /** Turn rate on the ground (rad/s). */
  turn: number;
  /** Ground acceleration responsiveness (1/s). */
  accel: number;
  /** Jump take-off speed (m/s), 0 = cannot jump. */
  jump: number;
  /** Max climbable step (m). */
  stepUp: number;
  /** Minimum ground normal Y it will walk onto (cos of max slope). */
  maxSlopeNy: number;
  /** Deepest water it wades through; deeper water is swum (canSwim) or refused. */
  wadeDepth: number;
  canSwim: boolean;
  swimSpeed: number;
  /** Flight (flyers / flying mounts). */
  fly?: { cruise: number; boost: number; climb: number; descend: number; turn: number; stamina: number; bank: number };
  temperament: Temperament;
  diet: { preferred: string[]; liked: string[] };
  taming?: TamingProfile;
  bondUnlocks: BondUnlock[];
  /** Biomes for ambient spawns (ambient wildlife only). */
  biomes?: BiomeId[];
  /** Active at night instead of by day. */
  nocturnal?: boolean;
  /** Group size for ambient spawns. */
  group?: [number, number];
  clues: ClueKind[];
  /** Sound ids (shared audio library 'creature.*'; fallbacks in src/companions/sounds.ts). */
  sounds: { call: string; alarm: string; content?: string };
  description: string;
  habitatText: string;
  tamingTips: string;
  /** Names offered when bonding. */
  names: string[];
  /** Health of a bonded companion. */
  hp: number;
}

/** `{action}` placeholders in descriptions become the player's control names (keyHints). */
const L = (at: number, ability: string, name: string, description: string): BondUnlock => ({ at, ability, name, description });

export const SPECIES: SpeciesDef[] = [
  {
    id: 'sky_bison',
    name: 'Sky Bison',
    plural: 'Sky Bison',
    role: 'mount',
    locomotion: 'flyer',
    rideable: true,
    flying: true,
    tameable: true,
    size: { length: 7.6, height: 3.4, width: 4.0 },
    radius: 2.1,
    walk: 2.0,
    run: 4.2,
    sprint: 5.2,
    turn: 0.9,
    accel: 1.6,
    jump: 0,
    stepUp: 1.1,
    maxSlopeNy: 0.7,
    wadeDepth: 2.6,
    canSwim: true,
    swimSpeed: 2.2,
    fly: { cruise: 16, boost: 27, climb: 7, descend: 9, turn: 1.05, stamina: 70, bank: 0.32 },
    temperament: 'gentle',
    diet: { preferred: ['moon_peaches'], liked: ['cabbage'] },
    taming: {
      calmGain: 0.9,
      calmCap: 30,
      calmRange: 22,
      feedPreferred: 16,
      feedLiked: 7,
      feedCooldown: 14,
      scareSprint: 3,
      scareCombat: 9,
      scareHit: 18,
      comfort: 9,
      hearing: 30,
      feedMinTrust: 0,
      challenge: 'follow_flight',
      challengeAt: 85,
      reach: 3.2,
    },
    bondUnlocks: [
      L(0, 'flight', 'Flight', 'Space takes off and climbs, Q descends. Lands by itself when you descend near flat ground.'),
      L(20, 'endurance', 'Endurance', 'Flies three times longer before it needs to rest.'),
      L(45, 'boost', 'Yip Yip!', 'Hold {sprint} in flight for a burst of speed.'),
      L(70, 'carry', 'Sky Carrier', 'Your pet rides along on the saddle, and cruising no longer tires it.'),
      L(90, 'gust', 'Tail Gust', 'Press {interact} while riding: a mighty tail stroke sweeps enemies away.'),
    ],
    clues: ['tracks', 'fur'],
    sounds: { call: 'creature.skybison.groan', alarm: 'creature.skybison.groan', content: 'creature.skybison.huff' },
    description: 'Gentle six-legged giants that swim through the sky with their broad flat tails. The original airbenders learned from them.',
    habitatText: 'Herds graze the high meadows below the Southern Air Temple and circle the spires on warm currents.',
    tamingTips: 'Walk, never run. Moon peaches win their hearts; a hurt bison remembers who tended it. The herd leader will test you in the sky.',
    names: ['Appa', 'Bumi', 'Lefty', 'Pepper', 'Nimbus', 'Cirrus', 'Momo-Pa', 'Thunderpaws'],
    hp: 650,
  },
  {
    id: 'dragon',
    name: 'Sun Warrior Dragon',
    plural: 'Dragons',
    role: 'mount',
    locomotion: 'flyer',
    rideable: true,
    flying: true,
    tameable: true,
    size: { length: 17, height: 2.6, width: 2.2 },
    radius: 1.7,
    walk: 2.8,
    run: 6.5,
    sprint: 8,
    turn: 1.3,
    accel: 2.2,
    jump: 0,
    stepUp: 1.2,
    maxSlopeNy: 0.62,
    wadeDepth: 2.0,
    canSwim: false,
    swimSpeed: 0,
    fly: { cruise: 22, boost: 35, climb: 10, descend: 12, turn: 1.45, stamina: 0, bank: 0.55 },
    temperament: 'proud',
    diet: { preferred: [], liked: ['fire_flakes'] },
    taming: {
      calmGain: 0,
      calmCap: 0,
      calmRange: 20,
      feedPreferred: 0,
      feedLiked: 4,
      feedCooldown: 30,
      scareSprint: 0,
      scareCombat: 0,
      scareHit: 10,
      comfort: 6,
      hearing: 40,
      feedMinTrust: 30,
      challenge: 'fearless',
      challengeAt: 30,
      reach: 4,
    },
    bondUnlocks: [
      L(0, 'flight', 'Flight', 'Space takes off and climbs, Q descends. It lands on its own when you descend near flat ground.'),
      L(20, 'fire_breath', 'Dragonfire', 'Press {interact} while riding to breathe fire where you aim. Summoned, it scorches enemies that come near you.'),
      L(45, 'boost', 'Sun Dash', 'Hold {sprint} in flight for a burst of speed.'),
      L(70, 'guard', 'Guardian', 'Attacks enemies that strike you.'),
      L(90, 'inferno', 'Inferno', 'Dragonfire burns hotter and wider.'),
    ],
    clues: ['scorch', 'bones'],
    sounds: { call: 'creature.dragon.rumble', alarm: 'creature.dragon.roar', content: 'creature.dragon.rumble' },
    description: 'The original firebenders. Long, serpentine and imposing, they judge the hearts of those who seek their fire.',
    habitatText: 'Only one is said to remain, sleeping near the Sun Warrior ruins. It answers when the Sun Stone is rekindled.',
    tamingTips: 'Gather three Sun Stone fragments at the ruins and rekindle the Sun Stone altar — only a firebender can. Then stand within the dragon\'s fire and bend without flinching.',
    names: ['Ran', 'Shaw', 'Druk', 'Ember', 'Solace', 'Agni', 'Huo'],
    hp: 900,
  },
  {
    id: 'polar_bear_dog',
    name: 'Polar Bear Dog',
    plural: 'Polar Bear Dogs',
    role: 'mount',
    locomotion: 'ground',
    rideable: true,
    flying: false,
    tameable: true,
    size: { length: 3.6, height: 2.0, width: 1.5 },
    radius: 0.95,
    walk: 2.6,
    run: 9,
    sprint: 14,
    turn: 2.6,
    accel: 4,
    jump: 7.5,
    stepUp: 0.8,
    maxSlopeNy: 0.64,
    wadeDepth: 1.3,
    canSwim: true,
    swimSpeed: 3.6,
    temperament: 'wary',
    diet: { preferred: ['sea_prunes', 'raw_fish'], liked: [] },
    taming: {
      calmGain: 0.5,
      calmCap: 20,
      calmRange: 16,
      feedPreferred: 12,
      feedLiked: 0,
      feedCooldown: 18,
      scareSprint: 8,
      scareCombat: 15,
      scareHit: 25,
      comfort: 11,
      hearing: 38,
      feedMinTrust: 8,
      challenge: 'none',
      challengeAt: 100,
      reach: 2.2,
    },
    bondUnlocks: [
      L(0, 'ride', 'Rideable', 'Press {companion} beside it to ride. Swims through icy water.'),
      L(20, 'sprint', 'Gallop', 'Hold {sprint} while riding to gallop.'),
      L(45, 'charge', 'Charge', 'Press {interact} while riding to bowl enemies over.'),
      L(70, 'guard', 'Guardian', 'Leaps at enemies that strike you.'),
      L(90, 'tracker', 'Tracker', 'Sniffs out nearby creatures and clues.'),
    ],
    clues: ['tracks', 'bones'],
    sounds: { call: 'creature.polarbeardog.bark', alarm: 'creature.polarbeardog.growl' },
    description: 'Loyal, powerful beasts of the polar north — part bear, part dog, all heart. Water Tribe warriors have ridden them for generations.',
    habitatText: 'Families den in the snowdrifts of the Frozen Tundra, north-east of the Tundra Watchtower.',
    tamingTips: 'Bear dogs are wary and protective. Never run near the den. Sea prunes and fresh fish help — but a mother will not eat while her pup is in danger.',
    names: ['Naga', 'Kodiak', 'Tikaani', 'Siku', 'Nanuq', 'Aput', 'Blizzard'],
    hp: 380,
  },
  {
    id: 'badgermole',
    name: 'Badgermole',
    plural: 'Badgermoles',
    role: 'mount',
    locomotion: 'ground',
    rideable: true,
    flying: false,
    tameable: true,
    size: { length: 3.4, height: 1.7, width: 1.9 },
    radius: 1.05,
    walk: 1.8,
    run: 5.5,
    sprint: 7,
    turn: 1.9,
    accel: 2.5,
    jump: 4,
    stepUp: 1.0,
    maxSlopeNy: 0.6,
    wadeDepth: 1.0,
    canSwim: false,
    swimSpeed: 0,
    temperament: 'blind',
    diet: { preferred: ['glowing_mushroom', 'cabbage'], liked: ['moon_peaches'] },
    taming: {
      calmGain: 2.2,
      calmCap: 65,
      calmRange: 9,
      feedPreferred: 14,
      feedLiked: 6,
      feedCooldown: 16,
      scareSprint: 12,
      scareCombat: 10,
      scareHit: 20,
      comfort: 5,
      hearing: 30,
      feedMinTrust: 20,
      challenge: 'none',
      challengeAt: 100,
      reach: 2.4,
    },
    bondUnlocks: [
      L(0, 'ride', 'Rideable', 'Press {companion} beside it to ride. Slow, steady and unstoppable.'),
      L(20, 'dig', 'Dig', 'Press {interact} while riding on soft ground to unearth mushrooms and jade.'),
      L(45, 'burrow', 'Burrow', 'Hold {sprint} while riding to tunnel beneath walls, rock and buildings.'),
      L(70, 'tremor', 'Tremor Sense', 'Every few seconds while riding, a seismic pulse reveals hidden foes nearby.'),
      L(90, 'fortify', 'Earth Hide', 'You take a third less damage while riding.'),
    ],
    clues: ['burrow', 'scratches'],
    sounds: { call: 'creature.badgermole.snort', alarm: 'creature.badgermole.snort' },
    description: 'Blind tunnellers who "see" through the earth — the original earthbenders. They feel every footstep.',
    habitatText: 'A pair lives in the Badgermole Caves in the hills south-east of Gaoling. Fresh mounds give their tunnels away.',
    tamingTips: 'Stand perfectly still and let it feel you. Running or jumping nearby is shouting in its ears. Earthbenders who bend gently speak its language. Cabbage and glowing mushrooms are favourites.',
    names: ['Toph-Toph', 'Burrow', 'Pebble', 'Rumble', 'Mudslide', 'Granite'],
    hp: 420,
  },
  {
    id: 'ostrich_horse',
    name: 'Ostrich Horse',
    plural: 'Ostrich Horses',
    role: 'mount',
    locomotion: 'ground',
    rideable: true,
    flying: false,
    tameable: true,
    size: { length: 2.3, height: 1.7, width: 0.9 },
    radius: 0.6,
    walk: 2.8,
    run: 11,
    sprint: 16.5,
    turn: 3.2,
    accel: 4.5,
    jump: 8.5,
    stepUp: 0.6,
    maxSlopeNy: 0.7,
    wadeDepth: 0.9,
    canSwim: false,
    swimSpeed: 0,
    temperament: 'skittish',
    diet: { preferred: ['cabbage'], liked: ['moon_peaches', 'lychee_nuts'] },
    taming: {
      calmGain: 0.6,
      calmCap: 25,
      calmRange: 14,
      feedPreferred: 15,
      feedLiked: 6,
      feedCooldown: 12,
      scareSprint: 10,
      scareCombat: 12,
      scareHit: 20,
      comfort: 12,
      hearing: 34,
      feedMinTrust: 0,
      challenge: 'race',
      challengeAt: 80,
      reach: 1.8,
    },
    bondUnlocks: [
      L(0, 'ride', 'Rideable', 'Press {companion} beside it to ride. The fastest thing on two legs.'),
      L(20, 'sprint', 'Full Stride', 'Hold {sprint} while riding to sprint.'),
      L(45, 'leap', 'Leap', 'Jumps far higher.'),
      L(70, 'kick', 'Kick', 'Press {interact} while riding: a powerful kick sends enemies flying.'),
      L(90, 'windrunner', 'Wind Runner', 'Sprints even faster.'),
    ],
    clues: ['tracks', 'feathers'],
    sounds: { call: 'creature.ostrichhorse.squawk', alarm: 'creature.ostrichhorse.squawk' },
    description: 'Long-legged Earth Kingdom mounts — the body of a bird, the head of a horse and a temper all their own.',
    habitatText: 'Flocks graze the farmland east of Gaoling, near the cabbage fields.',
    tamingTips: 'Very skittish: approach at a walk and stop if it backs away. Cabbage works wonders. Win its respect by outrunning a rival in a race.',
    names: ['Dash', 'Feathers', 'Bolt', 'Sandy', 'Rooster', 'Kicker'],
    hp: 260,
  },
  {
    id: 'komodo_rhino',
    name: 'Komodo Rhino',
    plural: 'Komodo Rhinos',
    role: 'mount',
    locomotion: 'ground',
    rideable: true,
    flying: false,
    // Stable-bred cavalry beasts: never wild, only sold by Fire Nation beast keepers.
    tameable: false,
    size: { length: 3.8, height: 1.8, width: 1.5 },
    radius: 0.95,
    walk: 2.4,
    run: 8.5,
    sprint: 13,
    turn: 2.3,
    accel: 3.4,
    jump: 6,
    stepUp: 0.8,
    maxSlopeNy: 0.66,
    wadeDepth: 1.2,
    canSwim: false,
    swimSpeed: 0,
    temperament: 'proud',
    diet: { preferred: ['fire_flakes'], liked: ['raw_fish', 'cabbage'] },
    bondUnlocks: [
      L(0, 'ride', 'Rideable', 'Press {companion} beside it to ride. Armoured, stubborn and hard to knock down.'),
      L(20, 'sprint', 'Stampede', 'Hold {sprint} while riding to stampede.'),
      L(45, 'charge', 'Horn Charge', 'Press {interact} while riding to ram through enemies.'),
      L(70, 'fortify', 'Armoured Hide', 'You take a third less damage while riding.'),
      L(90, 'guard', 'War Beast', 'Charges enemies that strike you.'),
    ],
    clues: ['tracks', 'scorch'],
    sounds: { call: 'creature.badgermole.snort', alarm: 'creature.armadillolizard.hiss' },
    description: 'Armoured, horned war beasts of the Fire Nation cavalry: part rhinoceros, part komodo dragon, and very hard to stop once they get going.',
    habitatText: 'Never found in the wild. They are bred in Fire Nation stables; the Beast Keeper in the Fire Nation Capital sells them.',
    tamingTips: 'Cannot be tamed in the wild. Buy one from a Fire Nation beast keeper.',
    names: ['Ember', 'Ironhide', 'Cinder', 'Brute', 'Magma', 'Tank'],
    hp: 420,
  },
  {
    id: 'winged_lemur',
    name: 'Winged Lemur',
    plural: 'Winged Lemurs',
    role: 'pet',
    locomotion: 'flyer',
    rideable: false,
    flying: true,
    tameable: true,
    size: { length: 0.55, height: 0.42, width: 0.3 },
    radius: 0.2,
    walk: 1.6,
    run: 5,
    sprint: 6,
    turn: 6,
    accel: 8,
    jump: 5,
    stepUp: 0.3,
    maxSlopeNy: 0.4,
    wadeDepth: 0.15,
    canSwim: false,
    swimSpeed: 0,
    fly: { cruise: 9, boost: 12, climb: 6, descend: 7, turn: 4, stamina: 0, bank: 0.7 },
    temperament: 'playful',
    diet: { preferred: ['lychee_nuts'], liked: ['moon_peaches'] },
    taming: {
      calmGain: 0.4,
      calmCap: 15,
      calmRange: 10,
      feedPreferred: 30,
      feedLiked: 15,
      feedCooldown: 10,
      scareSprint: 6,
      scareCombat: 10,
      scareHit: 20,
      comfort: 4,
      hearing: 20,
      feedMinTrust: 0,
      challenge: 'none',
      challengeAt: 100,
      reach: 1.8,
    },
    bondUnlocks: [
      L(0, 'perch', 'Shoulder Perch', 'Rides on your shoulder when you are calm.'),
      L(20, 'fetch', 'Fetch', 'Now and then it brings you fruit.'),
      L(45, 'scout', 'Scout', 'Chitters toward nearby creatures and clues.'),
      L(70, 'distract', 'Distract', 'Harries enemies that attack you, leaving them blinded.'),
    ],
    clues: ['nest'],
    sounds: { call: 'creature.lemur.chirp', alarm: 'creature.lemur.chirp' },
    description: 'Big ears, bigger appetite. Winged lemurs glide between temple rooftops and steal fruit from anyone who is not looking.',
    habitatText: 'They nest among the spires and rooftops of the Southern Air Temple.',
    tamingTips: 'Offer lychee nuts (moon peaches will do) and do not chase it. Three snacks and it is yours.',
    names: ['Momo', 'Pip', 'Lychee', 'Zephyr', 'Nibbles', 'Ears'],
    hp: 60,
  },
  {
    id: 'turtle_duck',
    name: 'Turtle-Duck',
    plural: 'Turtle-Ducks',
    role: 'pet',
    locomotion: 'amphibious',
    rideable: false,
    flying: false,
    tameable: true,
    size: { length: 0.42, height: 0.32, width: 0.3 },
    radius: 0.18,
    walk: 1.1,
    run: 2.4,
    sprint: 2.6,
    turn: 4,
    accel: 6,
    jump: 0,
    stepUp: 0.25,
    maxSlopeNy: 0.6,
    wadeDepth: 0.12,
    canSwim: true,
    swimSpeed: 1.8,
    temperament: 'gentle',
    diet: { preferred: ['bread_crumbs'], liked: ['cabbage'] },
    taming: {
      calmGain: 0.8,
      calmCap: 20,
      calmRange: 10,
      feedPreferred: 35,
      feedLiked: 15,
      feedCooldown: 8,
      scareSprint: 6,
      scareCombat: 10,
      scareHit: 20,
      comfort: 3,
      hearing: 18,
      feedMinTrust: 0,
      challenge: 'none',
      challengeAt: 100,
      reach: 1.5,
    },
    bondUnlocks: [
      L(0, 'follow', 'Pond Friend', 'Follows you, and swims alongside in water.'),
      L(20, 'comfort', 'Comfort', 'You recover health faster while it is near.'),
      L(45, 'dive', 'Dive', 'Finds trinkets when you rest by water.'),
    ],
    clues: ['feathers', 'nest'],
    sounds: { call: 'creature.turtleduck.quack', alarm: 'creature.turtleduck.quack' },
    description: 'A duck wearing a little turtle shell. Turtle-duck mothers are fiercely protective of their ducklings.',
    habitatText: 'Families paddle in the palace pond of the Fire Nation capital and along the shores of Lake Hiari.',
    tamingTips: 'Bread crumbs, a calm voice, no sudden moves. Easy friends — if you are gentle.',
    names: ['Dumpling', 'Shellby', 'Puddle', 'Waddles', 'Bao'],
    hp: 40,
  },
  // ---- Ambient wildlife (not tameable) ----
  {
    id: 'otter_penguin',
    name: 'Otter Penguin',
    plural: 'Otter Penguins',
    role: 'ambient',
    locomotion: 'amphibious',
    rideable: false,
    flying: false,
    tameable: false,
    size: { length: 0.8, height: 0.75, width: 0.45 },
    radius: 0.3,
    walk: 1.0,
    run: 3,
    sprint: 7,
    turn: 4,
    accel: 5,
    jump: 0,
    stepUp: 0.3,
    maxSlopeNy: 0.7,
    wadeDepth: 0.3,
    canSwim: true,
    swimSpeed: 3.5,
    temperament: 'skittish',
    diet: { preferred: ['raw_fish'], liked: [] },
    bondUnlocks: [],
    biomes: ['polar', 'tundra'],
    group: [3, 6],
    clues: ['tracks'],
    sounds: { call: 'creature.otterpenguin.honk', alarm: 'creature.otterpenguin.honk' },
    description: 'Playful polar birds with otter faces. They toboggan on their bellies — and so can you, if you ask nicely.',
    habitatText: 'Polar shores and ice floes of both Water Tribes.',
    tamingTips: 'Cannot be tamed. Sprint at them to watch them belly-slide away.',
    names: [],
    hp: 30,
  },
  {
    id: 'cat_owl',
    name: 'Cat Owl',
    plural: 'Cat Owls',
    role: 'ambient',
    locomotion: 'flyer',
    rideable: false,
    flying: true,
    tameable: false,
    size: { length: 0.5, height: 0.45, width: 0.35 },
    radius: 0.2,
    walk: 0.8,
    run: 2,
    sprint: 3,
    turn: 4,
    accel: 5,
    jump: 3,
    stepUp: 0.3,
    maxSlopeNy: 0.4,
    wadeDepth: 0.1,
    canSwim: false,
    swimSpeed: 0,
    fly: { cruise: 8, boost: 11, climb: 4, descend: 6, turn: 3, stamina: 0, bank: 0.6 },
    temperament: 'wary',
    diet: { preferred: [], liked: [] },
    bondUnlocks: [],
    biomes: ['forest', 'boreal', 'temperate', 'swamp'],
    nocturnal: true,
    group: [1, 2],
    clues: ['feathers'],
    sounds: { call: 'creature.catowl.hoot', alarm: 'creature.catowl.hoot' },
    description: 'Feathered hunters with the face and ears of a cat. Most active after dusk.',
    habitatText: 'Forests and swamps of the Earth Kingdom.',
    tamingTips: 'Cannot be tamed.',
    names: [],
    hp: 20,
  },
  {
    id: 'armadillo_lizard',
    name: 'Armadillo Lizard',
    plural: 'Armadillo Lizards',
    role: 'ambient',
    locomotion: 'ground',
    rideable: false,
    flying: false,
    tameable: false,
    size: { length: 1.0, height: 0.45, width: 0.45 },
    radius: 0.35,
    walk: 1.2,
    run: 3,
    sprint: 8,
    turn: 3,
    accel: 5,
    jump: 0,
    stepUp: 0.3,
    maxSlopeNy: 0.65,
    wadeDepth: 0.2,
    canSwim: false,
    swimSpeed: 0,
    temperament: 'skittish',
    diet: { preferred: [], liked: [] },
    bondUnlocks: [],
    biomes: ['desert', 'savanna'],
    group: [1, 3],
    clues: ['tracks'],
    sounds: { call: 'creature.armadillolizard.hiss', alarm: 'creature.armadillolizard.hiss' },
    description: 'Armoured desert lizards. Startle one and it curls into a ball and rolls away.',
    habitatText: 'The Si Wong Desert and dry savanna.',
    tamingTips: 'Cannot be tamed.',
    names: [],
    hp: 30,
  },
  {
    id: 'hog_monkey',
    name: 'Hog Monkey',
    plural: 'Hog Monkeys',
    role: 'ambient',
    locomotion: 'ground',
    rideable: false,
    flying: false,
    tameable: false,
    size: { length: 0.9, height: 0.7, width: 0.45 },
    radius: 0.3,
    walk: 1.2,
    run: 4,
    sprint: 6,
    turn: 4,
    accel: 6,
    jump: 5,
    stepUp: 0.4,
    maxSlopeNy: 0.6,
    wadeDepth: 0.3,
    canSwim: false,
    swimSpeed: 0,
    temperament: 'playful',
    diet: { preferred: [], liked: [] },
    bondUnlocks: [],
    biomes: ['tropical', 'forest', 'temperate', 'farmland'],
    group: [2, 4],
    clues: ['tracks'],
    sounds: { call: 'creature.hogmonkey.squeal', alarm: 'creature.hogmonkey.squeal' },
    description: 'Noisy, nosy monkeys with a pig\'s snout. They hoot at travellers from the roadside.',
    habitatText: 'Forests, farmland edges and Kyoshi Island.',
    tamingTips: 'Cannot be tamed.',
    names: [],
    hp: 30,
  },
  {
    id: 'elephant_koi',
    name: 'Elephant Koi',
    plural: 'Elephant Koi',
    role: 'ambient',
    locomotion: 'swimmer',
    rideable: false,
    flying: false,
    tameable: false,
    size: { length: 5.5, height: 1.6, width: 1.5 },
    radius: 1.2,
    walk: 3,
    run: 6,
    sprint: 9,
    turn: 1.2,
    accel: 2,
    jump: 0,
    stepUp: 0,
    maxSlopeNy: 1,
    wadeDepth: 0,
    canSwim: true,
    swimSpeed: 6,
    temperament: 'gentle',
    diet: { preferred: [], liked: [] },
    bondUnlocks: [],
    biomes: ['ocean', 'coast'],
    group: [1, 3],
    clues: [],
    sounds: { call: 'creature.elephantkoi.splash', alarm: 'creature.elephantkoi.splash' },
    description: 'Enormous orange-and-white fish that leap from the waves. Brave riders hold on to their fins.',
    habitatText: 'Coastal waters — especially around Kyoshi Island.',
    tamingTips: 'Cannot be tamed.',
    names: [],
    hp: 80,
  },
];

export function speciesById(id: string): SpeciesDef | undefined {
  return SPECIES.find((s) => s.id === id);
}

/** Bond level 1..5 for a bond value 0..100. */
export const BOND_LEVELS: ReadonlyArray<{ at: number; name: string }> = [
  { at: 0, name: 'New Friend' },
  { at: 20, name: 'Familiar' },
  { at: 45, name: 'Trusted' },
  { at: 70, name: 'Devoted' },
  { at: 90, name: 'Soulbound' },
];

export function bondLevel(bond: number): number {
  let lvl = 1;
  for (let i = 0; i < BOND_LEVELS.length; i++) if (bond >= BOND_LEVELS[i].at) lvl = i + 1;
  return lvl;
}

export function bondLevelName(bond: number): string {
  return BOND_LEVELS[bondLevel(bond) - 1].name;
}

/** Abilities a companion of `speciesId` has at `bond`. */
export function abilitiesAt(speciesId: string, bond: number): string[] {
  const s = speciesById(speciesId);
  if (!s) return [];
  return s.bondUnlocks.filter((u) => bond >= u.at).map((u) => u.ability);
}

/** Trust stage of a wild individual. */
export function trustStage(trust: number): 'wary' | 'curious' | 'friendly' | 'devoted' {
  if (trust >= 85) return 'devoted';
  if (trust >= 55) return 'friendly';
  if (trust >= 25) return 'curious';
  return 'wary';
}

/** How much a food item is worth to a species: 'preferred' | 'liked' | null. */
export function foodValue(speciesId: string, itemId: string): 'preferred' | 'liked' | null {
  const s = speciesById(speciesId);
  if (!s) return null;
  if (s.diet.preferred.includes(itemId)) return 'preferred';
  if (s.diet.liked.includes(itemId)) return 'liked';
  return null;
}

// ---------------------------------------------------------------------------
// Habitats
// ---------------------------------------------------------------------------

export interface ForageDef {
  item: string;
  count: number;
  label: string;
  /** Seconds before it can be harvested again. */
  regrow: number;
  /** Offset from the habitat centre (searched for flat ground nearby). */
  dx: number;
  dz: number;
}

export interface HabitatDef {
  id: string;
  name: string;
  species: string;
  /** Landmark used as the fallback centre (when no habitat_* spot is published). */
  landmark?: string;
  x: number;
  z: number;
  /** Roaming radius around the centre. */
  radius: number;
  /** Members spawned (individual ids are `${id}#${i}`). */
  count: number;
  group: 'herd' | 'family' | 'pair' | 'solitary' | 'flock';
  /** Water-loving habitats (turtle-ducks) — prefer spawning on/near water. */
  water?: boolean;
  /** Rare spawn that needs a story requirement (flag in the companion state). */
  requires?: 'dragon_called';
  rescue?: { kind: RescueKind; member: number };
  forage?: ForageDef;
  clues: Array<{ kind: ClueKind; dx: number; dz: number; text: string }>;
  /** Spawn/despawn distances. */
  spawnRadius: number;
}

export const HABITATS: HabitatDef[] = [
  {
    id: 'bison_meadow',
    name: 'Sky Bison Meadow',
    species: 'sky_bison',
    landmark: 'bison_meadow',
    x: 1340,
    z: 1080,
    radius: 150,
    count: 5,
    group: 'herd',
    rescue: { kind: 'injured', member: 3 },
    forage: { item: 'moon_peaches', count: 3, label: 'Moon peach tree', regrow: 150, dx: -30, dz: -70 },
    clues: [
      { kind: 'tracks', dx: -110, dz: -60, text: 'Enormous six-toed tracks, deep in the earth — something huge walks here, and then simply… stops. As if it flew away.' },
      { kind: 'fur', dx: -40, dz: -95, text: 'Tufts of soft white fur snagged on the rocks, longer than your arm.' },
    ],
    spawnRadius: 330,
  },
  {
    id: 'bear_dog_den',
    name: 'Snowdrift Den',
    species: 'polar_bear_dog',
    landmark: 'bear_dog_den',
    x: 520,
    z: -1260,
    radius: 80,
    count: 3,
    group: 'family',
    rescue: { kind: 'ice_trap', member: 2 },
    forage: { item: 'raw_fish', count: 2, label: 'Ice-fishing hole', regrow: 120, dx: 10, dz: -70 },
    clues: [
      { kind: 'tracks', dx: -90, dz: 60, text: 'Huge paw prints in the snow, with claws like a bear and toes like a dog. They lead north-east.' },
      { kind: 'bones', dx: 40, dz: -45, text: 'Picked-clean fish bones scattered around a snow mound.' },
    ],
    spawnRadius: 300,
  },
  {
    id: 'badgermole_caves',
    name: 'Badgermole Caves',
    species: 'badgermole',
    landmark: 'badgermole_caves',
    x: 650,
    z: 560,
    radius: 70,
    count: 2,
    group: 'pair',
    forage: { item: 'glowing_mushroom', count: 3, label: 'Glowing mushrooms', regrow: 120, dx: -25, dz: -10 },
    clues: [
      { kind: 'burrow', dx: -60, dz: -60, text: 'A fresh mound of churned earth with a tunnel mouth big enough to crawl into. The ground hums faintly.' },
      { kind: 'scratches', dx: 25, dz: -55, text: 'Deep claw grooves gouged straight through solid rock.' },
    ],
    spawnRadius: 280,
  },
  {
    id: 'ostrich_fields',
    name: 'Gaoling Fields',
    species: 'ostrich_horse',
    x: 560,
    z: 420,
    radius: 110,
    count: 4,
    group: 'flock',
    forage: { item: 'cabbage', count: 3, label: 'Cabbage patch', regrow: 100, dx: -50, dz: 10 },
    clues: [
      { kind: 'tracks', dx: -110, dz: -40, text: 'Big three-toed prints with a hoof-like heel, spaced far apart. Whatever made them was running.' },
      { kind: 'feathers', dx: -70, dz: 60, text: 'Long brown feathers caught in the fence posts.' },
    ],
    spawnRadius: 300,
  },
  {
    id: 'temple_lemurs',
    name: 'Temple Rooftops',
    species: 'winged_lemur',
    landmark: 'air_temple',
    x: 1450,
    z: 1250,
    radius: 60,
    count: 3,
    group: 'flock',
    forage: { item: 'lychee_nuts', count: 3, label: 'Lychee bush', regrow: 90, dx: 18, dz: 26 },
    clues: [{ kind: 'nest', dx: -26, dz: 30, text: 'A nest of woven prayer-flag scraps, littered with peach pits. Something small and hungry lives up here.' }],
    spawnRadius: 240,
  },
  {
    id: 'palace_pond',
    name: 'Turtle-Duck Pond',
    species: 'turtle_duck',
    landmark: 'fn_turtleduck_pond',
    x: -1390,
    z: 1090,
    radius: 22,
    count: 4,
    group: 'family',
    water: true,
    forage: { item: 'bread_crumbs', count: 3, label: 'Picnic basket', regrow: 80, dx: 9, dz: 8 },
    clues: [{ kind: 'nest', dx: -12, dz: 10, text: 'A tidy nest of reeds by the water, with a few cracked eggshells.' }],
    spawnRadius: 200,
  },
  {
    id: 'hiari_shore',
    name: 'Lake Hiari Shallows',
    species: 'turtle_duck',
    x: -300,
    z: -300,
    radius: 100,
    count: 4,
    group: 'family',
    water: true,
    forage: { item: 'bread_crumbs', count: 2, label: 'Fisher\'s lunch basket', regrow: 120, dx: 96, dz: 0 },
    clues: [],
    spawnRadius: 240,
  },
  {
    id: 'sun_warrior_ruins',
    name: 'Sun Warrior Ruins',
    species: 'dragon',
    landmark: 'dragon_bone_caldera',
    x: -1560,
    z: 940,
    radius: 110,
    count: 1,
    group: 'solitary',
    requires: 'dragon_called',
    clues: [
      { kind: 'scorch', dx: -50, dz: 30, text: 'Rock fused to glass in long, sweeping arcs. No firebender burns this hot.' },
      { kind: 'bones', dx: 40, dz: -60, text: 'An ancient carving: two great serpents circling a dancer, flames pouring around — not at — the dancer.' },
    ],
    spawnRadius: 420,
  },
];

export function habitatById(id: string): HabitatDef | undefined {
  return HABITATS.find((h) => h.id === id);
}

/** Sun Stone fragment pickups at the Sun Warrior ruins (offsets from the habitat centre). */
export const SUN_STONE_SHARDS: ReadonlyArray<{ id: string; dx: number; dz: number }> = [
  { id: 'shard_a', dx: -70, dz: 10 },
  { id: 'shard_b', dx: 30, dz: 55 },
  { id: 'shard_c', dx: 60, dz: -30 },
];

/** Fragments the altar needs to rekindle the Sun Stone. */
export const SUN_STONES_NEEDED = 3;

/**
 * Nation each companion species comes from. Beast keepers only sell their own nation's animals
 * (a polar bear dog is bought in the Water Tribes, a komodo rhino only in the Fire Nation).
 */
export const SPECIES_HOMELAND: Readonly<Record<string, Nation>> = {
  sky_bison: 'air',
  winged_lemur: 'air',
  polar_bear_dog: 'water',
  badgermole: 'earth',
  ostrich_horse: 'earth',
  komodo_rhino: 'fire',
  turtle_duck: 'fire',
  dragon: 'fire',
};

/** Homeland supplies granted on a new campaign (the creator's starting kit food). */
export const HOMELAND_FOOD: Readonly<Record<string, { item: string; count: number }>> = {
  water: { item: 'sea_prunes', count: 5 },
  earth: { item: 'cabbage', count: 5 },
  fire: { item: 'fire_flakes', count: 5 },
  air: { item: 'moon_peaches', count: 5 },
};
