import { defineSpots, type Spot } from '../../Spots';
import { CALDERA, FNC, PLAZA, POINTS, atPolar, harborHalf } from './fnc/layout';

/**
 * Named spots published by the Fire Nation region modules (defined at module
 * load so masters, quests, merchants, habitats and boats can find them before
 * the geometry streams in). Heights are given explicitly wherever the spot
 * stands on built architecture rather than the bare terrain.
 *
 * Capital spots follow the rebuilt capital (fnc/layout.ts): Sage Hira and Master Jeong on the Royal
 * Plaza, Sage Hira's lessons in the High Temple court in Hari Bulkan, the market on the Royal Way,
 * the docks and fish market in First Lord's Harbor, the turtle-ducks in the palace garden villa.
 */

const R = 'fire_nation_capital';
const PY = PLAZA.y;
const FY = FNC.floorY;
const Q = FNC.harbor.quayY;
const court = atPolar(CALDERA.temple.phi, CALDERA.temple.r - 18);
const sage = atPolar(CALDERA.temple.phi, CALDERA.temple.r - 4);
// Yaw facing from a point toward the volcano centre (local +Z forward).
const faceV = (p: { x: number; z: number }) => Math.atan2(FNC.V.x - p.x, FNC.V.z - p.z);

export const FIRE_SPOTS: Record<string, Spot> = {
  // --- Capital: quest giver, masters & training grounds ---
  giver_fn_elder: { x: POINTS.elder.x, z: POINTS.elder.z, y: PY, yaw: Math.PI, r: 3, label: 'Sage Hira, Royal Plaza', region: R },
  master_jeong: { x: POINTS.jeong.x, z: POINTS.jeong.z, y: PY, yaw: -Math.PI / 2, r: 3, label: 'Master Jeong, Royal Plaza drill yard', region: R },
  training_jeong: { x: POINTS.drill.x, z: POINTS.drill.z, y: PY, yaw: Math.PI, r: PLAZA.drill.r, label: 'Royal Plaza drill yard', region: R },
  master_hira: { x: sage.x, z: sage.z, y: FY, yaw: faceV(sage), r: 3, label: 'Sage Hira, the High Temple', region: R },
  training_hira: { x: court.x, z: court.z, y: FY, yaw: faceV(court) + Math.PI, r: 13, label: 'High Temple court', region: R },
  // --- Capital: merchants ---
  merchant_fn_1: { x: POINTS.marketW.x, z: POINTS.marketW.z, yaw: Math.PI / 2, r: 2, label: 'Royal Way market stall', region: R },
  merchant_fn_2: { x: POINTS.marketE.x, z: POINTS.marketE.z, yaw: -Math.PI / 2, r: 2, label: 'Royal Way market stall', region: R },
  merchant_fn_3: { x: POINTS.fishMarket.x, z: POINTS.fishMarket.z, y: Q, yaw: -Math.PI / 2, r: 2, label: 'Harbor fish market', region: R },
  // --- Capital: harbour ---
  dock_fn_harbor: { ...POINTS.harborQuayW, y: Q, yaw: Math.PI / 2, r: 3, label: "First Lord's Harbor, west quay", region: R },
  dock_fn_harbor_quay: { ...POINTS.harborQuayE, y: Q, yaw: -Math.PI / 2, r: 24, label: "First Lord's Harbor quays", region: R },
  dock_fn_harbor_north: { x: FNC.V.x, z: FNC.V.z + FNC.harbor.s0 + 6, y: Q, yaw: 0, r: 20, label: "First Lord's Harbor, inner quay", region: R },
  viewpoint_fn_harbor: { x: POINTS.seaGate.x - (harborHalf(FNC.seaWallS) + 30), z: POINTS.seaGate.z, y: 15.4, yaw: Math.PI / 2, r: 14, label: 'The sea wall rampart', region: R },
  // --- Capital: points of interest ---
  shrine_fire_sages: { x: sage.x, z: sage.z, y: FY, yaw: faceV(sage), r: 4, label: 'High Temple steps', region: R },
  viewpoint_fn_palace_stair: { x: POINTS.craterGate.x, z: POINTS.craterGate.z, y: FNC.lipY, yaw: Math.PI, r: 6, label: "Crater gate atop Sozin's road", region: R },
  viewpoint_fn_rim_gate: { x: POINTS.roadStart.x, z: POINTS.roadStart.z, r: 18, label: "Foot of Sozin's road", region: R },
  habitat_turtleduck_1: { x: POINTS.garden.x, z: POINTS.garden.z, y: CALDERA.lakeLevel + 0.2, r: CALDERA.garden.pondR, label: 'Turtle-Duck Pond, palace garden', region: R },
};

defineSpots(FIRE_SPOTS);

/** Add spots for content defined by other fire modules (ruins, Ember Island). */
export function addFireSpots(spots: Record<string, Spot>): void {
  Object.assign(FIRE_SPOTS, spots);
  defineSpots(spots);
}
