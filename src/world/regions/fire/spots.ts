import { defineSpots, type Spot } from '../../Spots';
import { boulevardStall, CAPITAL } from './layout';

/**
 * Named spots published by the Fire Nation region modules (defined at module
 * load so masters, quests, merchants, habitats and boats can find them before
 * the geometry streams in). Heights are given explicitly wherever the spot
 * stands on built architecture rather than the bare terrain.
 */

const C = CAPITAL;
const stall1 = boulevardStall(C.boulevard.stallSegments[0]);
const stall2 = boulevardStall(C.boulevard.stallSegments[1]);

export const FIRE_SPOTS: Record<string, Spot> = {
  // --- Capital: quest giver, masters & training grounds ---
  giver_fn_elder: { x: C.elder.x, z: C.elder.z, y: C.plaza.y, yaw: 0, r: 3, label: 'Sage Hira, Royal Plaza', region: 'fire_nation_capital' },
  master_hira: { x: C.temple.court.x - 16, z: C.temple.court.z, y: 42.3, yaw: Math.PI / 2, r: 3, label: "Sage Hira, Fire Sages' Temple", region: 'fire_nation_capital' },
  training_hira: { x: C.temple.court.x, z: C.temple.court.z, y: 42.3, yaw: -Math.PI / 2, r: 13, label: "Fire Sages' Court", region: 'fire_nation_capital' },
  master_jeong: { x: C.arena.x + C.arena.dais / 2 - 4, z: C.arena.z, y: C.arena.y, yaw: -Math.PI / 2, r: 3, label: 'Master Jeong, Agni Kai Arena', region: 'fire_nation_capital' },
  training_jeong: { x: C.arena.x, z: C.arena.z, y: C.arena.y, yaw: Math.PI / 2, r: 13, label: 'Agni Kai Arena', region: 'fire_nation_capital' },
  // --- Capital: merchants ---
  merchant_fn_1: { x: stall1.mx, z: stall1.mz, y: 42.25, yaw: stall1.yaw, r: 2, label: 'Boulevard market stall', region: 'fire_nation_capital' },
  merchant_fn_2: { x: stall2.mx, z: stall2.mz, y: 42.25, yaw: stall2.yaw, r: 2, label: 'Boulevard market stall', region: 'fire_nation_capital' },
  // --- Capital: points of interest ---
  shrine_fire_sages: { x: C.temple.x + C.temple.podX / 2 - 4.5, z: C.temple.z, y: 45.2, yaw: Math.PI / 2, r: 4, label: "Fire Sages' Temple steps", region: 'fire_nation_capital' },
  viewpoint_fn_palace_stair: { x: C.cx, z: C.terrace.z1 + 0.5, y: C.terrace.y, yaw: 0, r: 5, label: 'Top of the Grand Stair', region: 'fire_nation_capital' },
  viewpoint_fn_rim_gate: { x: C.rimGate.x, z: C.rimGate.z, r: 24, label: 'Rim gate of the caldera', region: 'fire_nation_capital' },
  habitat_turtleduck_1: { x: C.pond.x, z: C.pond.z, y: C.pond.y, r: C.pond.r, label: 'Turtle-Duck Pond', region: 'fire_nation_capital' },
};

defineSpots(FIRE_SPOTS);

/** Add spots for content defined by other fire modules (harbour, ruins, Ember Island). */
export function addFireSpots(spots: Record<string, Spot>): void {
  Object.assign(FIRE_SPOTS, spots);
  defineSpots(spots);
}
