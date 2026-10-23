/**
 * Waterbending moveset (docs/TECHNIQUES.md ids). Importing this module
 * registers every water technique plus the water clips and sounds.
 *
 * Water comes only from ctx.water.acquire (reserve → real source → water
 * skin); see src/combat/WaterSources.ts and src/combat/water/*.
 */
import '../../water/clips';
import '../../water/sounds';
import './whip';
import './blast';
import './shield';
import './ice';
import './sweep';
import './jet';
import './spout';
import './heal';
import './moisture';
