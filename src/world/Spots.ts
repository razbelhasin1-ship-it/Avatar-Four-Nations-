/**
 * Named world spots — the contract between region builders and the systems
 * that populate the world (masters, quest givers, merchants, training grounds,
 * enemy camps, creature habitats, boats/fast travel).
 *
 * Region modules call defineSpots() at module load (or in build()) for places
 * they author (e.g. the dojo floor in Ba Sing Se); consumers call getSpot(id)
 * and fall back to a landmark when a spot does not exist yet.
 *
 * Naming conventions (lower_snake_case):
 *   master_<name>        where a master stands (see docs/TECHNIQUES.md master table)
 *   training_<name>      open, flat area (radius >= 12 m) for that master's challenges
 *   giver_<id>           quest giver / elder / notable NPC
 *   merchant_<region>_<n>
 *   camp_<id>            hostile camp centre (wilderness)
 *   habitat_<species>_<n>
 *   dock_<id>, bridge_<id>, viewpoint_<id>, shrine_<id>
 * `y` is optional (default: ground height at x,z); `yaw` faces local +Z.
 * `r` is the usable clear radius around the spot.
 */
export interface Spot {
  x: number;
  z: number;
  y?: number;
  yaw?: number;
  r?: number;
  label?: string;
  region?: string;
}

const SPOTS = new Map<string, Spot>();

export function defineSpots(spots: Record<string, Spot>): void {
  for (const [id, s] of Object.entries(spots)) SPOTS.set(id, s);
}

export function getSpot(id: string): Spot | undefined {
  return SPOTS.get(id);
}

export function allSpots(): Array<[string, Spot]> {
  return [...SPOTS.entries()];
}

export function spotsWithPrefix(prefix: string): Array<[string, Spot]> {
  return [...SPOTS.entries()].filter(([id]) => id.startsWith(prefix));
}
