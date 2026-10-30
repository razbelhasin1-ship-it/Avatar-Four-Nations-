import { defineSpots, type Spot } from '../../Spots';
import { BSS, C, GROUND, RAIL, STATIONS, polar, ringLocal } from './bssLayout';

/**
 * Named places of the Earth Kingdom settlements (pure data). Builders read
 * these constants so the published spots always match the geometry.
 * Ba Sing Se features live in bssLayout.ts (BSS); re-exported here.
 */

export { BSS };

/** Lower Ring square stalls along the west edge (counters face east). */
export function squareStalls(): Array<{ x: number; z: number }> {
  return [-12, -4, 4].map((dz) => ({ x: BSS.square.x - BSS.square.hw + 2.6, z: BSS.square.z + dz }));
}

export const GAOLING = {
  c: { x: 420, z: 300 },
  y: 22,
  wallR: 62,
  /** Gates (angle around the centre, radians): east toward the Southern Road, north. */
  gates: [0, -Math.PI / 2],
  arena: { x: 448, z: 318, floorR: 13, standIn: 16, standOut: 24 },
  estate: { x: 392, z: 290, hw: 21, hd: 19 },
  square: { x: 424, z: 282, r: 11 },
};

export const RIVERBEND = {
  c: { x: 150, z: -565 },
  y: 20.8,
  bridge: { a: { x: 151, z: -545 }, b: { x: 72, z: -545 }, y: 21.05 },
  mill: { hutX: 106, z: -590, deckY: 15.5, wheelX: 96.5, wheelY: 12.8, wheelR: 5.2, rampTop: { x: 128, z: -590 } },
  dock: { top: { x: 116, z: -616 }, foot: { x: 88, z: -616 }, end: { x: 74, z: -616 }, y: 12.5 },
  square: { x: 152, z: -575, r: 9 },
};

const R = 'ba_sing_se';

export const EARTH_SPOTS: Record<string, Spot> = {
  // Ba Sing Se
  giver_bss_elder: { x: BSS.elder.x, z: BSS.elder.z, y: GROUND, yaw: -Math.PI / 2, r: 3, label: 'Old Man Shoji', region: R },
  master_lien: { ...ringLocal(BSS.dojo.c).at(0, -1), y: GROUND, yaw: ringLocal(BSS.dojo.c).yaw, r: 2, label: 'Master Lien, Stone Fist Dojo', region: R },
  training_lien: { ...ringLocal(BSS.dojo.c).at(0, 5.5), y: GROUND, r: 11, label: 'Stone Fist Dojo sparring floor', region: R },
  merchant_bss_1: { x: squareStalls()[1].x + 1.9, z: squareStalls()[1].z, y: GROUND, yaw: -Math.PI / 2, r: 2, label: 'Lower Ring Square stall', region: R },
  merchant_bss_2: { x: squareStalls()[0].x + 1.9, z: squareStalls()[0].z, y: GROUND, yaw: -Math.PI / 2, r: 2, label: 'Lower Ring Square stall', region: R },
  merchant_bss_3: { x: 0, z: 0, y: GROUND, r: 2, label: 'Market Street stall', region: R },
  merchant_bss_4: { x: 0, z: 0, y: GROUND, r: 2, label: 'Market Street stall', region: R },
  merchant_bss_tea: { x: BSS.paoTea.x, z: BSS.paoTea.z + 5.2, y: GROUND, yaw: 0, r: 2, label: 'Pao Family Tea House counter', region: R },
  shrine_bss_earth_king: { x: BSS.kingStatue.x, z: BSS.kingStatue.z + 4, y: GROUND, yaw: Math.PI, r: 4, label: 'Statue of the Earth King', region: R },
  viewpoint_bss_palace: { x: C.x, z: C.z + BSS.palace.terraceZ, y: GROUND + BSS.palace.tiers[2].h, r: 6, label: 'Palace terrace', region: R },
  viewpoint_bss_outer_wall: { x: STATIONS.arrival_c.at.x, z: STATIONS.arrival_c.at.z, y: GROUND + RAIL.deck, r: 4, label: 'Arrival station platform', region: R },
  station_bss_lower_west: { x: STATIONS.y_c.at.x, z: STATIONS.y_c.at.z, y: GROUND + RAIL.deck, r: 6, label: 'Monorail station', region: R },
  dock_laogai: { x: BSS.lakeDock.b.x - 1, z: BSS.lakeDock.b.z, y: 26.3, yaw: Math.PI / 2, r: 3, label: 'Lake Laogai boathouse pier', region: R },
  habitat_turtleduck_laogai: { x: 1040, z: 205, r: 14, label: 'Lake Laogai reeds', region: R },
  bridge_bss_garden: { x: BSS.gardenW.c.x, z: BSS.gardenW.c.z, y: GROUND + 2.6, r: 2, label: 'Moon bridge', region: R },
  // Gaoling
  master_lin: { x: GAOLING.arena.x - 9, z: GAOLING.arena.z, y: GAOLING.y + 0.3, yaw: Math.PI / 2, r: 2, label: 'Lin the Blind, Earth Rumble champion', region: 'earth_heartland' },
  training_lin: { x: GAOLING.arena.x, z: GAOLING.arena.z, y: GAOLING.y + 0.3, r: 12.5, label: 'Earth Rumble ring', region: 'earth_heartland' },
  giver_gaoling_lord: { x: GAOLING.estate.x + GAOLING.estate.hw + 3, z: GAOLING.estate.z, y: GAOLING.y, yaw: Math.PI / 2, r: 3, label: 'Estate gate', region: 'earth_heartland' },
  merchant_gaoling_1: { x: GAOLING.square.x - 6, z: GAOLING.square.z - 11.4, y: GAOLING.y, yaw: 0, r: 2, label: 'Gaoling market stall', region: 'earth_heartland' },
  merchant_gaoling_2: { x: GAOLING.square.x + 6, z: GAOLING.square.z - 11.4, y: GAOLING.y, yaw: 0, r: 2, label: 'Gaoling market stall', region: 'earth_heartland' },
  habitat_ostrich_horse_gaoling: { x: GAOLING.c.x - 30, z: GAOLING.c.z + 38, r: 8, label: 'Estate stables', region: 'earth_heartland' },
  // Riverbend Village
  giver_riverbend_elder: { x: RIVERBEND.square.x + 2, z: RIVERBEND.square.z - 2, y: RIVERBEND.y, yaw: -Math.PI / 2, r: 3, label: 'Village elder', region: 'earth_heartland' },
  merchant_riverbend_1: { x: RIVERBEND.square.x + 5, z: RIVERBEND.square.z + 10.3, y: RIVERBEND.y, yaw: Math.PI, r: 2, label: 'Riverbend fish stall', region: 'earth_heartland' },
  dock_riverbend: { x: RIVERBEND.dock.end.x + 1.5, z: RIVERBEND.dock.end.z, y: RIVERBEND.dock.y, yaw: -Math.PI / 2, r: 3, label: 'Riverbend dock', region: 'earth_heartland' },
  bridge_riverbend: { x: (RIVERBEND.bridge.a.x + RIVERBEND.bridge.b.x) / 2, z: RIVERBEND.bridge.a.z, y: RIVERBEND.bridge.y, r: 2, label: 'Riverbend footbridge', region: 'earth_heartland' },
};

/** Lower Ring market stall positions along the curved market street (shared with the builder). */
export function marketStalls(): Array<{ x: number; z: number; yaw: number; side: number; mx: number; mz: number }> {
  const m = BSS.market;
  const out: Array<{ x: number; z: number; yaw: number; side: number; mx: number; mz: number }> = [];
  const step = 7.2 / m.r;
  for (let t = m.t0 + step * 0.6; t < m.t1 - step * 0.4; t += step) {
    for (const side of [-1, 1]) {
      const r = m.r + side * (m.width / 2 - 1.7);
      const p = polar(t, r);
      // Counter faces the street centre (−side × radial); the merchant stands behind it.
      const yaw = Math.atan2(-side * Math.cos(t), -side * Math.sin(t));
      const mp = polar(t, r + side * 1.9);
      out.push({ x: p.x, z: p.z, yaw, side, mx: mp.x, mz: mp.z });
    }
  }
  return out;
}

{
  const ms = marketStalls();
  const s3 = ms[2], s4 = ms[7];
  EARTH_SPOTS.merchant_bss_3 = { ...EARTH_SPOTS.merchant_bss_3, x: s3.mx, z: s3.mz, yaw: s3.yaw };
  EARTH_SPOTS.merchant_bss_4 = { ...EARTH_SPOTS.merchant_bss_4, x: s4.mx, z: s4.mz, yaw: s4.yaw };
}

defineSpots(EARTH_SPOTS);
