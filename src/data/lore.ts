import type { Element } from '../core/types';

/**
 * Journal lore entries. Each unlocks from game state (an element you can bend,
 * a region visited, a landmark discovered, an item held, a story flag) and is
 * read in Journal → Lore. Region and landmark blurbs are added automatically
 * by the journal from WorldLayout.
 */
export interface LoreEntry {
  id: string;
  title: string;
  /** Section heading in the journal. */
  group: 'The Elements' | 'The Avatar' | 'Relics';
  text: string;
  unlock: { element?: Element; item?: string; flag?: string; always?: boolean; mastered?: Element; sphere?: boolean };
}

export const LORE: LoreEntry[] = [
  {
    id: 'lore_avatar_cycle',
    title: 'The Avatar Cycle',
    group: 'The Avatar',
    text: 'One spirit, reborn again and again, each life in the next nation of the cycle: air, water, earth, fire. The Avatar alone may learn all four arts, and carries the duty of keeping the nations — and the worlds of people and spirits — in balance.',
    unlock: { always: true },
  },
  {
    id: 'lore_avatar_state',
    title: 'The Avatar State',
    group: 'The Avatar',
    text: 'In the Avatar State the strength of every past life flows through the present one. Eyes and markings blaze with light, blows land harder and wounds matter less — but the spirit tires, and must rest before it can rise again.',
    unlock: { always: true },
  },
  {
    id: 'lore_sphere',
    title: 'The Elements Sphere',
    group: 'The Avatar',
    text: 'Only an Avatar who has truly mastered all four arts can draw them together at once. The elements circle the Avatar in a great sphere, and techniques no single nation could perform become possible.',
    unlock: { sphere: true },
  },
  {
    id: 'lore_air_origin',
    title: 'Air: The Sky Bison',
    group: 'The Elements',
    text: 'The first airbenders learned from the sky bison, watching the great beasts ride the currents over the mountain temples. Airbending is the art of freedom: evade, redirect, never meet force head-on.',
    unlock: { element: 'air' },
  },
  {
    id: 'lore_water_origin',
    title: 'Water: Push and Pull',
    group: 'The Elements',
    text: 'The first waterbenders learned from the Moon and the tides it moves. Water flows around obstacles and turns an opponent’s strength back on them. A waterbender cannot make water from nothing — they must find it.',
    unlock: { element: 'water' },
  },
  {
    id: 'lore_earth_origin',
    title: 'Earth: Listening to the Ground',
    group: 'The Elements',
    text: 'The first earthbenders were taught by the blind badgermoles, who feel the world through the stone itself. Earthbending is patience and endurance: wait, listen, and strike when the moment comes.',
    unlock: { element: 'earth' },
  },
  {
    id: 'lore_fire_origin',
    title: 'Fire: The Breath of Dragons',
    group: 'The Elements',
    text: 'The oldest firebending forms came from the dragons, who showed the first benders that fire is life and energy, not only rage. Its power comes from the breath — and from the will behind it.',
    unlock: { element: 'fire' },
  },
  {
    id: 'lore_air_master',
    title: 'The Way of the Wind, Mastered',
    group: 'The Elements',
    text: 'To master air is to let go of what weighs you down. The winds of the four temples now answer to you completely.',
    unlock: { mastered: 'air' },
  },
  {
    id: 'lore_water_master',
    title: 'Ocean and Moon, Mastered',
    group: 'The Elements',
    text: 'Push and pull, give and take. The tides themselves recognise you now.',
    unlock: { mastered: 'water' },
  },
  {
    id: 'lore_earth_master',
    title: 'The Unmoving Mountain, Mastered',
    group: 'The Elements',
    text: 'Neutral jing — you have learned to wait, to listen and to stand your ground until the moment is right.',
    unlock: { mastered: 'earth' },
  },
  {
    id: 'lore_fire_master',
    title: 'The Eternal Flame, Mastered',
    group: 'The Elements',
    text: 'Your fire burns with breath and purpose, not anger. Like the sun, it gives light as much as it destroys.',
    unlock: { mastered: 'fire' },
  },
  {
    id: 'lore_air_scroll',
    title: 'Ancient Air Scroll',
    group: 'Relics',
    text: '“The monks did not fly because they were light of body, but because they were light of heart.” — from a scroll of the Air Nomads.',
    unlock: { item: 'air_scroll' },
  },
  {
    id: 'lore_pai_sho',
    title: 'The White Lotus Tile',
    group: 'Relics',
    text: 'An unremarkable Pai Sho tile — unless you know what it means. Those who do say the order of the White Lotus is older than any nation’s borders.',
    unlock: { item: 'pai_sho_tile' },
  },
  {
    id: 'lore_sun_stone',
    title: 'Sun Stone Fragment',
    group: 'Relics',
    text: 'Warm to the touch even at night. The Sun Warriors set such stones before the dragons as a sign of respect, not command.',
    unlock: { item: 'sun_stone' },
  },
  {
    id: 'lore_spirit_water',
    title: 'Water of the Spirit Oasis',
    group: 'Relics',
    text: 'Drawn from the pool where the Moon and Ocean spirits circle each other. It glows faintly, and is said to heal what ordinary water cannot.',
    unlock: { item: 'spirit_water' },
  },
];
