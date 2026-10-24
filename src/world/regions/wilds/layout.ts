import { heightAt, waterAt } from '../../Heightfield';
import { defineSpots, type Spot } from '../../Spots';
import { ROADS, type P2 } from '../../WorldLayout';

/**
 * Layout of the wilds sites (everything between the capitals) and the named
 * spots they publish. Spots are defined at module load so the encounter
 * director (camps), vegetation (clearings) and NPC systems see them before any
 * site is built.
 */

const TAU = Math.PI * 2;

/** Point along a road polyline (WorldLayout ROADS) at arc length s, offset `lat` to the right of travel. */
export function roadPoint(roadId: string, s: number, lat = 0): { x: number; z: number; yaw: number; dir: P2 } {
  const pts = ROADS.find((r) => r.id === roadId)!.points;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= acc + len || i === pts.length - 2) {
      const t = Math.max(0, Math.min(1.2, (s - acc) / len));
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      // Right of travel (x east, z south): (-dz, dx).
      return { x: a.x + (b.x - a.x) * t - dz * lat, z: a.z + (b.z - a.z) * t + dx * lat, yaw: Math.atan2(dx, dz), dir: { x: dx, z: dz } };
    }
    acc += len;
  }
  return { x: pts[0].x, z: pts[0].z, yaw: 0, dir: { x: 0, z: 1 } };
}

export function roadLength(roadId: string): number {
  const pts = ROADS.find((r) => r.id === roadId)!.points;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) acc += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
  return acc;
}

function maxH(x: number, z: number, r: number): number {
  let m = heightAt(x, z);
  for (const f of [0.35, 0.7, 1]) for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    m = Math.max(m, heightAt(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f));
  }
  return m;
}

// ---------------------------------------------------------------------------
// Omashu
// ---------------------------------------------------------------------------

export const OMASHU = (() => {
  const C = { x: -450, z: -650 };
  const Y = 95;
  const gate = { x: -380, z: -680 }; // end of the omashu_ramp trail
  const thetaG = Math.atan2(gate.z - C.z, gate.x - C.x);
  const P = (th: number, r: number) => ({ x: C.x + Math.cos(th) * r, z: C.z + Math.sin(th) * r });
  const terraces = [
    { r: 42, top: 104 },
    { r: 27, top: 114 },
    { r: 15, top: 123 },
  ];
  const arenaTheta = thetaG + 2.0;
  const arena = { ...P(arenaTheta, 59), y: Y + 0.3, r: 12.5, rim: 14.2, theta: arenaTheta };
  const chutes = [thetaG + 1.05, thetaG - 1.3];
  return { C, Y, gate, thetaG, P, terraces, wallR: 76, arena, chutes, stairsRun: [12.9, 13, 11.5] };
})();

// ---------------------------------------------------------------------------
// Kyoshi Island
// ---------------------------------------------------------------------------

export const KYOSHI = (() => {
  const C = { x: 1820, z: -440 };
  const Y = 6;
  // Shoreline east of the village along z = -446.
  let shoreX = 1880;
  while (shoreX < 1960 && heightAt(shoreX, -446) > 0.4) shoreX += 1;
  return {
    C,
    Y,
    statue: { x: 1820, z: -469 },
    dojo: { x: 1786, z: -463, w: 18, d: 12 },
    yard: { x: 1786, z: -432, r: 12.5 },
    pond: { x: 1840, z: -380, r: 16 },
    shoreX,
    pier: { z: -446, x0: shoreX - 7, x1: shoreX + 26, y: 1.7 },
  };
})();

// ---------------------------------------------------------------------------
// Misty Palms
// ---------------------------------------------------------------------------

export const MISTY = {
  C: { x: 160, z: 860 },
  Y: 25.6,
  oasis: { x: 120, z: 860, r: 26 },
  cantina: { x: 154, z: 896, w: 16, d: 11 },
  well: { x: 168, z: 848 },
  pier: { x0: 150, x1: 137, z: 870, y: 25.75 },
};

// ---------------------------------------------------------------------------
// Buried Library
// ---------------------------------------------------------------------------

export const LIBRARY = (() => {
  const S = { x: 446, z: 1128 };
  const L = { x: 420, z: 1120 };
  const floorY = Math.max(17.6, maxH(S.x, S.z, 9.2) + 0.15);
  const doorTheta = Math.atan2(L.z - S.z, L.x - S.x);
  return { S, L, floorY, doorTheta, rIn: 7.6, rOut: 9, wallH: 13 };
})();

// ---------------------------------------------------------------------------
// Great Banyan Tree
// ---------------------------------------------------------------------------

export const BANYAN = (() => {
  const L = { x: -1150, z: -140 };
  const T = { x: -1126, z: -122 };
  const tpA = (6.9 * Math.PI) / 180;
  const TP = { x: T.x + Math.cos(tpA) * 30, z: T.z + Math.sin(tpA) * 30 };
  const HP = { x: -1138, z: -100 };
  // Murky water next to the training platform (first wet point around it).
  let pool = { x: TP.x - 6, z: TP.z + 17 };
  for (let k = 0; k < 24; k++) {
    const a = 1.2 + (k / 24) * TAU;
    const x = TP.x + Math.cos(a) * 16.5, z = TP.z + Math.sin(a) * 16.5;
    if (waterAt(x, z)) {
      pool = { x, z };
      break;
    }
  }
  const lake = waterAt(pool.x, pool.z);
  return {
    L,
    T,
    TP,
    HP,
    pool,
    waterY: lake ? lake.level : 0.7,
    trunkR: 7.5,
    mound: { r: 13.5, top: 2.3 },
    lp: { r: 7.5, top: Math.max(1.05, Math.min(heightAt(L.x, L.z) + 0.4, 1.3)) },
    tp: { r: 13.5, top: 1.35 },
    hp: { r: 6.5, top: 1.5 },
  };
})();

// ---------------------------------------------------------------------------
// North: tundra watchtower, snowdrift den, ice bridge path
// ---------------------------------------------------------------------------

export const TUNDRA = (() => {
  const O = { x: 300, z: -1050 };
  const tower = { x: 283, z: -1068, s: 6.5 };
  const towerBase = maxH(tower.x, tower.z, 4.6);
  const towerTop = towerBase + 12;
  return {
    O,
    tower,
    towerBase,
    towerTop,
    // The ramp reaches the lookout height right at the tower's east face (+0.25 m).
    ramp: { x0: tower.x + tower.s / 2 + 19.5, x1: tower.x + tower.s / 2 + 0.25, z: tower.z - 0.5 },
    lodge: { x: 319, z: -1063, w: 12, d: 7.5 },
    fire: { x: 296, z: -1058.5 },
  };
})();

export const DEN = { C: { x: 520, z: -1260 }, nests: [{ dx: -6, dz: -3 }, { dx: 4, dz: 8 }, { dx: 8, dz: -8 }] };

export const ICE_BRIDGE = (() => {
  const z = -1050;
  const a = { x: -68, z }, c = { x: -33, z };
  return { a: { ...a, y: heightAt(a.x, a.z) + 0.06 }, c: { ...c, y: heightAt(c.x, c.z) + 0.06 }, width: 3.2, hump: 1.7 };
})();

// ---------------------------------------------------------------------------
// Badgermole Caves
// ---------------------------------------------------------------------------

export const BADGER = (() => {
  const L = { x: 650, z: 560 };
  const mouth = { x: 600, z: 552 };
  const back = { x: 629, z: 552 };
  const ledge = { x: L.x, z: L.z, r: 6.5, top: Math.max(heightAt(L.x, L.z) + 0.4, 92) };
  const stepsFoot = { x: 631, z: 567 };
  // Steps reach the ledge height right at its edge (+0.25 m) so the player steps onto the top.
  const dx = stepsFoot.x - L.x, dz = stepsFoot.z - L.z, dl = Math.hypot(dx, dz);
  const stepsTop = { x: L.x + (dx / dl) * (ledge.r + 0.25), z: L.z + (dz / dl) * (ledge.r + 0.25) };
  return { L, mouth, back, halfW: 6, ledge, stepsFoot, stepsTop };
})();

// ---------------------------------------------------------------------------
// Road crossings (computed from the road/river runtimes, see tests/tools/wilds_probe.test.ts):
//   northern_road × great_river  s ≈ 1030..1087  (114,-493)→(150,-447), water 11.6
//   western_road  × great_river  s ≈ 0..11.5     road starts in the river at (240,60)
// ---------------------------------------------------------------------------

export const BRIDGES = (() => {
  const nA = roadPoint('northern_road', 1014), nC = roadPoint('northern_road', 1102);
  const wC = roadPoint('western_road', 24);
  // western_road extended backwards past its start (east bank).
  const w0 = ROADS.find((r) => r.id === 'western_road')!.points;
  const wd = { x: w0[1].x - w0[0].x, z: w0[1].z - w0[0].z };
  const wl = Math.hypot(wd.x, wd.z);
  const wEast = { x: w0[0].x - (wd.x / wl) * 21, z: w0[0].z - (wd.z / wl) * 21 };
  return {
    north: { id: 'northern_road', a: { x: nA.x, z: nA.z, y: heightAt(nA.x, nA.z) + 0.05 }, c: { x: nC.x, z: nC.z, y: heightAt(nC.x, nC.z) + 0.05 }, width: 7, mid: 15.6, arches: 7, waterY: 11.62 },
    west: { id: 'western_road', a: { x: wEast.x, z: wEast.z, y: heightAt(wEast.x, wEast.z) + 0.05 }, c: { x: wC.x, z: wC.z, y: heightAt(wC.x, wC.z) + 0.05 }, width: 7, mid: 15.8, arches: 3, waterY: 11.62 },
  };
})();

// ---------------------------------------------------------------------------
// Roadside: inns, farms, shrines, signposts, Lake Hiari dock
// ---------------------------------------------------------------------------

export const INNS = [
  { id: 'north', name: 'Frostpine Inn', road: 'northern_road', s: 470, lat: -17 },
  { id: 'west', name: 'Willow Tea House', road: 'western_road', s: 380, lat: 16 },
  { id: 'south', name: 'Dusty Lantern Inn', road: 'southern_road', s: 520, lat: -16 },
].map((d) => {
  const p = roadPoint(d.road, d.s, d.lat);
  const r = roadPoint(d.road, d.s, 0);
  return { ...d, x: p.x, z: p.z, face: Math.atan2(r.x - p.x, r.z - p.z), roadX: r.x, roadZ: r.z };
});

export const FARMS = [
  { id: 'west', road: 'western_road', s: 640, lat: -34, seed: 11 },
  { id: 'north', road: 'northern_road', s: 1215, lat: 30, seed: 12 },
  { id: 'south', road: 'southern_road', s: 150, lat: 32, seed: 13 },
].map((d) => {
  const p = roadPoint(d.road, d.s, d.lat);
  const r = roadPoint(d.road, d.s, 0);
  return { ...d, x: p.x, z: p.z, face: Math.atan2(r.x - p.x, r.z - p.z), yaw: r.yaw };
});

export const SHRINES = [
  { id: 'north', road: 'northern_road', s: 760, lat: 9 },
  { id: 'west', road: 'western_road', s: 860, lat: -9 },
  { id: 'south', road: 'southern_road', s: 1180, lat: 9 },
].map((d) => {
  const p = roadPoint(d.road, d.s, d.lat);
  const r = roadPoint(d.road, d.s, 0);
  return { ...d, x: p.x, z: p.z, face: Math.atan2(r.x - p.x, r.z - p.z) };
});

export const HIARI = (() => {
  // Lake Hiari (-300,-300) r 90: small fishing dock on the east shore.
  const shore = { x: -205, z: -296 };
  const pierEnd = { x: -226, z: -296 };
  const lake = waterAt(pierEnd.x, pierEnd.z);
  const deckY = Math.max((lake ? lake.level : 18.8) + 0.95, heightAt(shore.x, shore.z) + 0.05);
  return { shore, pierEnd, deckY, hut: { x: -195, z: -304 } };
})();

// ---------------------------------------------------------------------------
// Camps (consumed by the encounter director: src/ai/EncounterDirector.ts)
// ---------------------------------------------------------------------------

export type CampStyle = 'bandit' | 'fire' | 'pirate' | 'dai_li';

export const CAMPS: Array<{ id: string; x: number; z: number; style: CampStyle; label: string; boss?: boolean }> = [
  { id: 'camp_fire_commander', x: -719, z: 668, style: 'fire', label: 'Fire Nation causeway outpost', boss: true },
  { id: 'camp_dai_li_captain', x: 1113, z: 183, style: 'dai_li', label: 'Dai Li post, Lake Laogai shore', boss: true },
  { id: 'camp_pirate_captain', x: 496, z: 1386, style: 'pirate', label: "Sea Viper's Cove", boss: true },
  { id: 'camp_bandit_west_hills', x: -560, z: 330, style: 'bandit', label: 'Bandit hideout, western hills' },
  { id: 'camp_bandit_north_forest', x: -200, z: -880, style: 'bandit', label: 'Bandit camp, northern woods' },
  { id: 'camp_bandit_heartland', x: 560, z: 700, style: 'bandit', label: 'Bandit camp, heartland plains' },
  { id: 'camp_bandit_east_road', x: 1320, z: 620, style: 'bandit', label: 'Bandit lookout, eastern road' },
  { id: 'camp_bandit_swamp_edge', x: -760, z: -120, style: 'bandit', label: 'Bandit den, swamp edge' },
  { id: 'camp_fire_outpost_west', x: -1600, z: 700, style: 'fire', label: 'Fire Nation coastal outpost' },
  { id: 'camp_fire_coast_watch', x: -1795, z: 1148, style: 'fire', label: 'Fire Nation coast watch' },
  { id: 'camp_pirate_cove_west', x: -206, z: 1254, style: 'pirate', label: 'Pirate cove, southern coast' },
  { id: 'camp_pirate_cove_east', x: 1866, z: 562, style: 'pirate', label: 'Pirate cove, eastern coast' },
];

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------

const O = OMASHU;
const oP = (th: number, r: number) => O.P(th, r);
const facing = (from: P2, to: P2) => Math.atan2(to.x - from.x, to.z - from.z);
const arenaToC = { x: O.C.x - O.arena.x, z: O.C.z - O.arena.z };
const arenaToCL = Math.hypot(arenaToC.x, arenaToC.z);
const bumo = { x: O.arena.x + (arenaToC.x / arenaToCL) * 9.5, z: O.arena.z + (arenaToC.z / arenaToCL) * 9.5 };
const K = KYOSHI;
const M = MISTY;
const BY = BANYAN;
const bTPtoT = { x: BY.T.x - BY.TP.x, z: BY.T.z - BY.TP.z };
const bTPl = Math.hypot(bTPtoT.x, bTPtoT.z);
const huu = { x: BY.TP.x + (bTPtoT.x / bTPl) * 10.5, z: BY.TP.z + (bTPtoT.z / bTPl) * 10.5 };
const T = TUNDRA;
const D = DEN.C;
const LIB = LIBRARY;

export const WILDS_SPOTS: Record<string, Spot> = {
  // Omashu
  master_bumo: { x: bumo.x, z: bumo.z, y: O.arena.y, yaw: facing(bumo, O.arena), r: 2, label: 'King Bumo, the grandmaster of Omashu', region: 'omashu' },
  training_bumo: { x: O.arena.x, z: O.arena.z, y: O.arena.y, r: O.arena.r, label: 'Omashu boulder arena', region: 'omashu' },
  giver_omashu_gatekeeper: { ...oP(O.thetaG + 0.1, 69), y: O.Y, yaw: O.thetaG + Math.PI, r: 2, label: 'Omashu gate captain', region: 'omashu' },
  giver_omashu_advisor: { ...oP(O.thetaG, 12.5), y: O.terraces[2].top, yaw: facing(oP(O.thetaG, 12.5), O.gate), r: 2, label: 'Royal advisor, palace steps', region: 'omashu' },
  merchant_omashu_1: { ...oP(O.thetaG + 0.135, 60), y: O.Y, yaw: facing(oP(O.thetaG + 0.135, 60), oP(O.thetaG, 60)), r: 2, label: 'Omashu cabbage stall', region: 'omashu' },
  merchant_omashu_2: { ...oP(O.thetaG - 0.135, 64), y: O.Y, yaw: facing(oP(O.thetaG - 0.135, 64), oP(O.thetaG, 64)), r: 2, label: 'Omashu stonecutter stall', region: 'omashu' },
  viewpoint_omashu_palace: { ...oP(O.thetaG + Math.PI / 2, 12.5), y: O.terraces[2].top, r: 3, label: 'Palace terrace, Omashu', region: 'omashu' },
  shrine_omashu: { ...oP(O.thetaG + Math.PI / 2, 34.5), y: O.terraces[0].top, yaw: O.thetaG + Math.PI / 2 + Math.PI, r: 3, label: 'Shrine of the Mountain', region: 'omashu' },
  // Kyoshi Island
  master_oyagi: { x: K.yard.x, z: K.yard.z - 10.5, y: K.Y, yaw: 0, r: 2, label: 'Oyagi, dojo master of Kyoshi Island', region: 'kyoshi_island' },
  training_oyagi: { x: K.yard.x, z: K.yard.z, y: K.Y, r: K.yard.r, label: 'Kyoshi dojo training yard', region: 'kyoshi_island' },
  giver_kyoshi_suki: { x: K.dojo.x + 12, z: K.dojo.z + 9, y: K.Y, yaw: Math.PI / 2, r: 2, label: 'Kyoshi Warrior captain', region: 'kyoshi_island' },
  merchant_kyoshi_1: { x: K.shoreX - 14, z: -453, yaw: Math.PI / 2, r: 2, label: 'Kyoshi fish market', region: 'kyoshi_island' },
  dock_kyoshi: { x: K.pier.x1 - 1.5, z: K.pier.z, y: K.pier.y, yaw: Math.PI / 2, r: 3, label: 'Kyoshi Island pier', region: 'kyoshi_island' },
  shrine_kyoshi: { x: 1811, z: -383, yaw: Math.PI / 2, r: 3, label: 'Shrine of Avatar Kyoshi', region: 'kyoshi_island' },
  viewpoint_kyoshi_statue: { x: K.statue.x, z: K.statue.z + 9, y: K.Y, r: 3, label: 'Statue of Avatar Kyoshi', region: 'kyoshi_island' },
  // Misty Palms
  giver_misty_cantina: { x: M.cantina.x + 6.6, z: M.cantina.z - M.cantina.d / 2 - 1.2, y: M.Y, yaw: Math.PI, r: 2, label: 'Misty Palms cantina owner', region: 'si_wong_desert' },
  merchant_misty_1: { x: M.cantina.x - 3, z: M.cantina.z - M.cantina.d / 2 - 0.9, y: M.Y, yaw: Math.PI, r: 2, label: 'Cantina counter', region: 'si_wong_desert' },
  merchant_misty_2: { x: 177, z: 851, y: M.Y, yaw: -Math.PI / 2, r: 2, label: 'Sand-sailer outfitter', region: 'si_wong_desert' },
  dock_misty_oasis: { x: M.pier.x1 + 1, z: M.pier.z, y: M.pier.y, yaw: -Math.PI / 2, r: 2, label: 'Oasis jetty', region: 'si_wong_desert' },
  // Buried Library
  viewpoint_buried_library: { x: LIB.L.x, z: LIB.L.z, r: 6, label: 'Dune above the Buried Library', region: 'si_wong_desert' },
  shrine_buried_library: { x: LIB.S.x, z: LIB.S.z, y: LIB.floorY, r: 4, label: 'Hall of the Owl', region: 'si_wong_desert' },
  // Great Banyan Tree
  master_huu: { x: huu.x, z: huu.z, y: BY.tp.top, yaw: facing(huu, BY.TP), r: 2, label: 'Huu, sage of the Foggy Swamp', region: 'foggy_swamp' },
  training_huu: { x: BY.TP.x, z: BY.TP.z, y: BY.tp.top, r: 12.5, label: 'Root platform of the Banyan Tree', region: 'foggy_swamp' },
  dock_banyan_raft: { x: BY.L.x - 5, z: BY.L.z - 3, y: BY.lp.top, yaw: -Math.PI / 2, r: 3, label: 'Raft landing', region: 'foggy_swamp' },
  viewpoint_banyan_roots: { x: BY.T.x + 10.5, z: BY.T.z - 3, y: BY.mound.top, r: 2.5, label: 'Great Banyan root mound', region: 'foggy_swamp' },
  // North
  giver_tundra_scout: { x: T.fire.x + 4, z: T.fire.z + 2, yaw: facing({ x: T.fire.x + 4, z: T.fire.z + 2 }, T.fire), r: 2, label: 'Water Tribe scout', region: 'frozen_tundra' },
  merchant_tundra_1: { x: T.lodge.x - 6, z: T.lodge.z + 6, yaw: facing({ x: T.lodge.x - 6, z: T.lodge.z + 6 }, T.O), r: 2, label: 'Lodge trader', region: 'frozen_tundra' },
  viewpoint_tundra_tower: { x: T.tower.x, z: T.tower.z, y: T.towerTop, r: 2.5, label: 'Watchtower lookout', region: 'frozen_tundra' },
  viewpoint_tundra_outpost: { x: T.O.x + 4, z: T.O.z - 4, r: 27, label: 'Tundra Watchtower yard', region: 'frozen_tundra' },
  bridge_tundra_ice: { x: (ICE_BRIDGE.a.x + ICE_BRIDGE.c.x) / 2, z: ICE_BRIDGE.a.z, y: Math.max(ICE_BRIDGE.a.y, ICE_BRIDGE.c.y) + ICE_BRIDGE.hump * 0.9, r: 2, label: 'Ice bridge over the Great River', region: 'frozen_tundra' },
  habitat_polar_bear_dog_1: { x: D.x + DEN.nests[0].dx, z: D.z + DEN.nests[0].dz, r: 4, label: 'Snowdrift Den nest', region: 'frozen_tundra' },
  habitat_polar_bear_dog_2: { x: D.x + DEN.nests[1].dx, z: D.z + DEN.nests[1].dz, r: 4, label: 'Snowdrift Den nest', region: 'frozen_tundra' },
  habitat_polar_bear_dog_3: { x: D.x + DEN.nests[2].dx, z: D.z + DEN.nests[2].dz, r: 4, label: 'Snowdrift Den nest', region: 'frozen_tundra' },
  // Badgermole Caves
  habitat_badgermole_1: { x: (BADGER.mouth.x + BADGER.back.x) / 2 + 2, z: BADGER.mouth.z, r: 14, label: 'Badgermole cave', region: 'earth_heartland' },
  habitat_badgermole_2: { x: BADGER.L.x, z: BADGER.L.z, y: BADGER.ledge.top, r: 5, label: 'Badgermole burrow ledge', region: 'earth_heartland' },
  // Bridges
  bridge_northern_road: { x: (BRIDGES.north.a.x + BRIDGES.north.c.x) / 2, z: (BRIDGES.north.a.z + BRIDGES.north.c.z) / 2, y: BRIDGES.north.mid, r: 3, label: 'Great River stone bridge', region: 'earth_heartland' },
  bridge_western_road: { x: (BRIDGES.west.a.x + BRIDGES.west.c.x) / 2, z: (BRIDGES.west.a.z + BRIDGES.west.c.z) / 2, y: BRIDGES.west.mid, r: 3, label: 'West Road bridge', region: 'earth_heartland' },
  // Lake Hiari
  dock_lake_hiari: { x: HIARI.pierEnd.x + 1.5, z: HIARI.pierEnd.z, y: HIARI.deckY, yaw: -Math.PI / 2, r: 3, label: 'Lake Hiari fishing dock', region: 'earth_heartland' },
};

for (const inn of INNS) {
  const f = { x: inn.x + Math.sin(inn.face) * 7.5, z: inn.z + Math.cos(inn.face) * 7.5 };
  WILDS_SPOTS[`merchant_inn_${inn.id}_1`] = { x: f.x, z: f.z, yaw: inn.face + Math.PI, r: 14, label: inn.name, region: 'earth_heartland' };
}
for (const s of SHRINES) WILDS_SPOTS[`shrine_road_${s.id}`] = { x: s.x + Math.sin(s.face) * 2.2, z: s.z + Math.cos(s.face) * 2.2, yaw: s.face + Math.PI, r: 4, label: 'Roadside shrine', region: 'earth_heartland' };
for (const c of CAMPS) WILDS_SPOTS[c.id] = { x: c.x, z: c.z, r: 15, label: c.label };
// Clearings around farms (no trees in the fields).
for (const f of FARMS) WILDS_SPOTS[`viewpoint_farm_${f.id}`] = { x: f.x, z: f.z, r: 24, label: 'Farmstead', region: 'earth_heartland' };

defineSpots(WILDS_SPOTS);
