import type { GameContext } from '../core/GameContext';

/**
 * Item catalog: consumables, quest objects, collectibles, companion food.
 * `use` returns true if the item was consumed.
 */
export interface ItemDef {
  id: string;
  name: string;
  category: 'consumable' | 'quest' | 'collectible' | 'food' | 'material';
  description: string;
  icon: string;
  stack?: number;
  price?: number;
  use?(ctx: GameContext): boolean;
}

export const ITEMS: ItemDef[] = [
  {
    id: 'healing_herbs',
    name: 'Healing Herbs',
    category: 'consumable',
    description: 'Restores 40 health.',
    icon: '🌿',
    stack: 20,
    price: 25,
    use: (ctx) => {
      const p = ctx.player;
      if (!p?.health || p.health.hp >= p.health.maxHp) return false;
      p.health.heal(40);
      ctx.vfx.burst('heal', p.aimPoint(), { count: 16 });
      return true;
    },
  },
  {
    id: 'jasmine_tea',
    name: 'Jasmine Tea',
    category: 'consumable',
    description: 'Restores all chi and calms the spirit.',
    icon: '🍵',
    stack: 20,
    price: 20,
    use: (ctx) => {
      const p = ctx.player;
      if (!p) return false;
      p.chi = p.maxChi;
      return true;
    },
  },
  { id: 'sea_prunes', name: 'Stewed Sea Prunes', category: 'food', description: 'A Water Tribe delicacy. Polar bear dogs love them.', icon: '🫐', stack: 30, price: 8 },
  { id: 'moon_peaches', name: 'Moon Peaches', category: 'food', description: 'Sweet fruit from the Air Temples. Sky bison adore them.', icon: '🍑', stack: 30, price: 10 },
  { id: 'cabbage', name: 'Cabbage', category: 'food', description: 'MY CABBAGES! Good for most herbivores.', icon: '🥬', stack: 30, price: 4 },
  { id: 'fire_flakes', name: 'Fire Flakes', category: 'food', description: 'Spicy snack from the Fire Nation. Some say dragons can smell them for miles.', icon: '🌶️', stack: 30, price: 12 },
  { id: 'glowing_mushroom', name: 'Glowing Mushroom', category: 'food', description: 'Found in caves. Badgermoles are fond of them.', icon: '🍄', stack: 30, price: 15 },
  { id: 'raw_fish', name: 'Fresh Fish', category: 'food', description: 'Caught in cold waters.', icon: '🐟', stack: 30, price: 6 },
  // [additive: companions] food for winged lemurs and turtle-ducks
  { id: 'lychee_nuts', name: 'Lychee Nuts', category: 'food', description: 'Small sweet fruit. Winged lemurs go wild for them.', icon: '🍒', stack: 30, price: 6 },
  { id: 'bread_crumbs', name: 'Bread Crumbs', category: 'food', description: 'Turtle-ducks paddle over the moment they hear the bag rustle.', icon: '🍞', stack: 30, price: 3 },
  { id: 'sun_stone', name: 'Sun Stone Fragment', category: 'quest', description: 'A warm shard from the Sun Warrior ruins. Dragons respect those who carry it.', icon: '🔶', stack: 5 },
  { id: 'spirit_water', name: 'Spirit Oasis Water', category: 'quest', description: 'Water from the Spirit Oasis. It glows faintly.', icon: '💧', stack: 3 },
  { id: 'pai_sho_tile', name: 'White Lotus Tile', category: 'collectible', description: 'A Pai Sho tile. Someone, somewhere, is collecting these.', icon: '🀄', stack: 40 },
  { id: 'air_scroll', name: 'Ancient Air Scroll', category: 'collectible', description: 'Lore of the Air Nomads.', icon: '📜', stack: 20 },
  { id: 'jade_shard', name: 'Jade Shard', category: 'material', description: 'A polished green stone.', icon: '💚', stack: 99, price: 30 },
  // [additive: enemies] loot dropped by defeated foes (sellable trophies)
  { id: 'fn_insignia', name: 'Fire Nation Insignia', category: 'material', description: 'A flame-crest badge torn from a Fire Nation uniform.', icon: '🔥', stack: 99, price: 12 },
  { id: 'dai_li_seal', name: 'Dai Li Seal', category: 'material', description: 'A jade seal of the Dai Li. Few in Ba Sing Se will admit to recognising it.', icon: '🟩', stack: 99, price: 25 },
  { id: 'pirate_chart', name: 'Pirate Sea Chart', category: 'collectible', description: 'A smudged chart of hidden coves along the southern coast.', icon: '🗺️', stack: 20, price: 18 },
  { id: 'beast_claw', name: 'Beast Claw', category: 'material', description: 'Shed in the struggle — the beast itself ran off to lick its wounds.', icon: '🦴', stack: 99, price: 10 },
  // [additive: quests] side-quest objects (not sellable)
  { id: 'stray_cabbage', name: 'Runaway Cabbage', category: 'quest', description: 'One of the cabbage merchant\'s cabbages. It has seen things.', icon: '🥬', stack: 10 },
  { id: 'lost_turtleduck', name: 'Lost Turtle-Duck', category: 'quest', description: 'A very small, very indignant turtle-duck.', icon: '🐤', stack: 1 },
  { id: 'sealed_letter', name: 'Sealed Letter', category: 'quest', description: 'A letter sealed with the wave of the Northern Water Tribe, for the Chief of the South.', icon: '✉️', stack: 1 },
  { id: 'glacier_crystal', name: 'Glacier Crystal', category: 'quest', description: 'A crystal from deep in the glacier caves. It glows like moonlight.', icon: '💎', stack: 1 },
  { id: 'library_scroll', name: 'Scroll of the Owl', category: 'quest', description: 'An ancient scroll from the Buried Library, dry as the desert.', icon: '📜', stack: 1 },
  { id: 'kyoshi_fan', name: 'Kyoshi War Fan', category: 'quest', description: 'A golden war fan of the Kyoshi Warriors.', icon: '🪭', stack: 5 },
  { id: 'script_page', name: 'Script Page', category: 'quest', description: '"Love Amongst the Dragons", act II. The writing is... ambitious.', icon: '📄', stack: 5 },
];

export function itemById(id: string): ItemDef | undefined {
  return ITEMS.find((i) => i.id === id);
}
