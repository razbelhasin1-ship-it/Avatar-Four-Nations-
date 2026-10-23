/**
 * Shared domain types used across all systems.
 * Keep this file dependency-free (no three.js imports) so data modules and tests can use it.
 */

export type Element = 'air' | 'water' | 'earth' | 'fire';
export const ELEMENTS: readonly Element[] = ['air', 'water', 'earth', 'fire'] as const;
export type ElementOrAvatar = Element | 'avatar';

export const ELEMENT_INFO: Record<Element, { name: string; nation: string; color: string; glow: string; bender: string }> = {
  air: { name: 'Air', nation: 'Air Nomads', color: '#e8b04a', glow: '#ffe6a8', bender: 'Airbender' },
  water: { name: 'Water', nation: 'Water Tribes', color: '#2f6fd6', glow: '#9fd8ff', bender: 'Waterbender' },
  earth: { name: 'Earth', nation: 'Earth Kingdom', color: '#3f8f3a', glow: '#b9e59a', bender: 'Earthbender' },
  fire: { name: 'Fire', nation: 'Fire Nation', color: '#d0362a', glow: '#ffb070', bender: 'Firebender' },
};

/** Ground / material surface classification, drives footsteps, footprints, movement feel. */
export type SurfaceType =
  | 'grass'
  | 'tallgrass'
  | 'dirt'
  | 'mud'
  | 'gravel'
  | 'sand'
  | 'rock'
  | 'stone' // cut stone / paved streets
  | 'cobble'
  | 'plaster' // architectural / concrete-like
  | 'snow'
  | 'packedsnow'
  | 'ice'
  | 'wood'
  | 'water'
  | 'ash'
  | 'lava'
  | 'metal';

export type BiomeId =
  | 'ocean'
  | 'coast'
  | 'polar'
  | 'tundra'
  | 'boreal'
  | 'temperate'
  | 'farmland'
  | 'forest'
  | 'swamp'
  | 'desert'
  | 'savanna'
  | 'volcanic'
  | 'alpine'
  | 'tropical';

export type Team = 'player' | 'ally' | 'hostile' | 'neutral' | 'wildlife';

export type EntityKind = 'player' | 'enemy' | 'npc' | 'creature' | 'target' | 'object';

export type GameMode = 'boot' | 'menu' | 'loading' | 'play';
export type SessionKind = 'campaign' | 'tutorial';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Vec2Like {
  x: number;
  z: number;
}

export type WaterSourceType =
  | 'ocean'
  | 'river'
  | 'stream'
  | 'lake'
  | 'pond'
  | 'canal'
  | 'fountain'
  | 'puddle'
  | 'waterfall'
  | 'ice'
  | 'snow'
  | 'rain'
  | 'moisture' // plants / humid air via advanced technique
  | 'flask'; // carried water skin

export type NotifyKind = 'info' | 'success' | 'warning' | 'learn' | 'discovery' | 'quest' | 'error' | 'avatar';

export type TechniqueFailReason = 'cooldown' | 'chi' | 'water' | 'locked' | 'state' | 'airborne' | 'busy' | 'target';
