import { setSoundTrim } from './registry';

/**
 * Gain staging for recipes whose raw output peaks above 0 dBFS at volume 1,
 * measured offline by window.__game.debug.audio.verifyAll() (peak → trim ≈ 0.8 / peak).
 * Applied by the engine to every play of the id (one-shots and loops) and by the
 * offline verifier, so what the verifier measures is what the mix receives.
 *
 * Ids registered by other modules (bend_*, water_*) are trimmed here instead of
 * in their files; owners may rebalance their recipes and drop the entry.
 */
export const TRIMS: Readonly<Record<string, number>> = {
  // shared library (src/audio/recipes)
  'avatar.surge': 0.8,
  avatar_surge: 0.8,
  'creature.dragon.roar': 0.75,
  'fire.explosion': 0.65,
  // bending module (src/combat/techniques/*)
  bend_earth_rise: 0.55,
  bend_earth_slam: 0.42,
  bend_explosion: 0.46,
  bend_fire_whoosh: 0.78,
  bend_flame_loop: 0.72,
  bend_rumble_loop: 0.46,
  // waterbending module
  water_impact: 0.75,
  water_jet: 0.4,
};

for (const [id, g] of Object.entries(TRIMS)) setSoundTrim(id, g);
