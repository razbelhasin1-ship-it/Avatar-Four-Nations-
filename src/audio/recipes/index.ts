/**
 * The shared sound library. Importing this module registers every recipe.
 * Ids are namespaced with dots (e.g. 'step.snow.run', 'ui.confirm') so they
 * never collide with module-specific ids (underscored) registered elsewhere.
 * See src/audio/SOUNDS.md for the full list.
 */
import './footsteps';
import './elements';
