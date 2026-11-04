/**
 * Technique registry entry point: importing this module registers every
 * technique. Add one import per technique module.
 */
import './common';
import './air';
import './water';
import './earth';
import './fire';
import './avatar';
// [additive] two more moves per element (taught by masters).
import './more';
// [additive: sub-elements] lavabending, spiritual projection, bloodbending (src/data/subskills.ts).
import './sub/lava';
import './sub/projection';
import './sub/blood';
