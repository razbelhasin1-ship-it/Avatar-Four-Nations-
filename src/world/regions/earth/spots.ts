import { defineSpots, type Spot } from '../../Spots';
import { DEG, GROUND, MID, outerR, PALACE, polar, STATIONS, UP } from './bssLayout';

/**
 * Named places of the Earth Kingdom settlements (pure data). Builders read
 * these constants so the published spots always match the geometry.
 */

/** Ba Sing Se hand-placed features (world metres). */
export const BSS = {
  spawn: { x: 640, z: -30 },
  elder: { x: 652, z: -22 },
  /** Lower Ring Square (Earth start). */
  square: { x0: 618, x1: 690, z0: -104, z1: -6 },
  fountain: { x: 644, z: -68, r: 5.5 },
  kingStatue: { x: 646, z: -90 },
  /** Square stalls along the inner wall (west edge), counters face east. */
  squareStalls: [-78, -66, -54, -42, -16].map((z) => ({ x: 630.5, z })),
  /** Market street (Lower Ring, north of the square). */
  market: { a: { x: 652, z: -106 }, b: { x: 684, z: -160 }, width: 9 },
  /** Stone Fist Dojo on the Middle terrace. */
  dojo: { yard: { x: 704, z: 36, hw: 13, hd: 13 }, hall: { x: 726, z: 37, w: 14, d: 24 }, street: { x: 704, z0: -42, z1: 23 } },
  teaShop: { x: 742, z: -82 },
  university: { x: 770, z: -132 },
  gardenW: { x: 772, z: 32, r: 12 },
  gardenE: { x: 962, z: -12, r: 10 },
  middlePlaza: { x: 760, z: -50, r: 13 },
  upperFountains: [
    { x: 797, z: -68 },
    { x: 797, z: -32 },
  ],
  lakeDock: { a: { x: 1004, z: 168 }, b: { x: 1030, z: 168 } },
  boathouse: { x: 994, z: 160 },
};

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
const st = STATIONS.lowerWest;

export const EARTH_SPOTS: Record<string, Spot> = {
  // Ba Sing Se
  giver_bss_elder: { x: BSS.elder.x, z: BSS.elder.z, y: GROUND, yaw: -Math.PI / 2, r: 3, label: 'Old Man Shoji', region: R },
  master_lien: { x: BSS.dojo.yard.x + 10.5, z: BSS.dojo.yard.z, y: MID.level, yaw: -Math.PI / 2, r: 2, label: 'Master Lien, Stone Fist Dojo', region: R },
  training_lien: { x: BSS.dojo.yard.x, z: BSS.dojo.yard.z, y: MID.level, r: 12.5, label: 'Stone Fist Dojo sparring floor', region: R },
  merchant_bss_1: { x: BSS.squareStalls[2].x - 1.9, z: BSS.squareStalls[2].z, y: GROUND, yaw: Math.PI / 2, r: 2, label: 'Lower Ring Square stall', region: R },
  merchant_bss_2: { x: BSS.squareStalls[1].x - 1.9, z: BSS.squareStalls[1].z, y: GROUND, yaw: Math.PI / 2, r: 2, label: 'Lower Ring Square stall', region: R },
  merchant_bss_3: { x: 0, z: 0, y: GROUND, r: 2, label: 'Market Street stall', region: R },
  merchant_bss_4: { x: 0, z: 0, y: GROUND, r: 2, label: 'Market Street stall', region: R },
  merchant_bss_tea: { x: BSS.teaShop.x, z: BSS.teaShop.z + 6.4, y: MID.level, yaw: 0, r: 2, label: 'Tea shop counter', region: R },
  shrine_bss_earth_king: { x: BSS.kingStatue.x, z: BSS.kingStatue.z + 5, y: GROUND, yaw: Math.PI, r: 4, label: 'Statue of the Earth King', region: R },
  viewpoint_bss_palace: { x: UP.x - 6, z: UP.z, y: PALACE.tiers[2].top, r: 6, label: 'Palace terrace', region: R },
  viewpoint_bss_outer_wall: { ...polar(189 * DEG, outerR(189 * DEG)), y: GROUND + 34, r: 4, label: 'Outer Wall walkway', region: R },
  station_bss_lower_west: { x: st.x, z: st.z, y: st.y, r: 6, label: 'Monorail station', region: R },
  dock_laogai: { x: BSS.lakeDock.b.x - 1, z: BSS.lakeDock.b.z, y: 26.3, yaw: Math.PI / 2, r: 3, label: 'Lake Laogai boathouse pier', region: R },
  habitat_turtleduck_laogai: { x: 1040, z: 205, r: 14, label: 'Lake Laogai reeds', region: R },
  bridge_bss_garden: { x: BSS.gardenW.x, z: BSS.gardenW.z, y: MID.level + 2.6, r: 2, label: 'Moon bridge', region: R },
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

/** Market street stall positions (shared with the builder). */
export function marketStalls(): Array<{ x: number; z: number; yaw: number; side: number; mx: number; mz: number }> {
  const { a, b, width } = BSS.market;
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
  const nx = -tz, nz = tx;
  const out: Array<{ x: number; z: number; yaw: number; side: number; mx: number; mz: number }> = [];
  for (let s = 6; s < L - 4; s += 7) {
    for (const side of [-1, 1]) {
      const off = width / 2 + 1.4;
      const x = a.x + tx * s + nx * side * off, z = a.z + tz * s + nz * side * off;
      // Counter faces the street centre: local +Z toward -side * n.
      const yaw = Math.atan2(-side * nx, -side * nz);
      out.push({ x, z, yaw, side, mx: x + nx * side * 1.9, mz: z + nz * side * 1.9 });
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
