import * as THREE from 'three';
import * as G from './geom';
import * as P from './parts';
import { am, type Kit, type P2 } from './parts';
import { Y0, polar, sl } from './layout';

/**
 * Temple grounds between the main precincts of the summit: rows of white
 * chortens on the south lawn, moon-peach orchards (green and in blossom), the
 * library tower and the great-bell pavilion, and paved walks linking the
 * plaza with the stables and the library. Fills the open lawns so the summit
 * reads as a lived-in monastery from the air and from the ground.
 *
 * Collisions: chortens, tower, pavilion columns and tree trunks are solid;
 * walks are walkable slabs. Nothing here depends on quality settings.
 */

type ZoneFn = (name: string, center: P2, radius: number, o?: { far?: boolean; district?: string }) => Kit;

/** Great-bell pavilion position (north-east lawn), used by the summit's bell interaction. */
export const BELL_PAVILION: P2 = sl(37.6, -70.6);

export function buildGrounds(zone: ZoneFn): void {
  // --- Chortens on the south lawn, either side of the meditation-balcony walk ---
  const kS = zone('grounds_south', sl(0, 76), 32, { district: 'core' });
  for (const a of [76, 82, 87.5, 102.5, 108, 114]) {
    const p = polar(a, 77);
    chorten(kS, p.x, p.z, P.faceYaw(-Math.cos((a * Math.PI) / 180), -Math.sin((a * Math.PI) / 180)), a === 87.5 || a === 102.5 ? 1.25 : 1);
  }
  // Prayer flags strung between the chorten spires.
  for (const [a0, a1] of [[76, 82], [82, 87.5], [102.5, 108], [108, 114]] as Array<[number, number]>) {
    const p0 = polar(a0, 77), p1 = polar(a1, 77);
    const h0 = a0 === 87.5 || a0 === 102.5 ? 1.25 : 1, h1 = a1 === 87.5 || a1 === 102.5 ? 1.25 : 1;
    P.prayerFlags(kS, new THREE.Vector3(p0.x, Y0 + 4.9 * h0, p0.z), new THREE.Vector3(p1.x, Y0 + 4.9 * h1, p1.z), 0.9);
  }
  // South-west orchard (between the plaza and the rim).
  orchard(kS, [
    [-20, 66, 0, 1.0],
    [-26, 74, 1, 1.15],
    [-16, 79, 2, 0.95],
    [-11, 68, 1, 0.9],
  ]);

  // --- South-east: library tower, orchard, walk from the plaza ---
  const kE = zone('grounds_east', sl(48, 62), 26, { district: 'east' });
  const lib = sl(48, 60.5);
  P.roundTower(kE, { x: lib.x, z: lib.z, y: Y0, r: 3.6, h: 15, roofH: 8.4, balcony: true, door: P.faceYaw(-0.85, -0.53), bands: 3 });
  P.banner(kE, lib.x - 0.85 * 3.95, Y0 + 9.6, lib.z - 0.53 * 3.95, P.faceYaw(-0.85, -0.53), 1.2, 3.2, 'bannerYellow');
  walk(kE, sl(28.5, 58.6), sl(44.6, 59.6), 3.0);
  P.stoneLantern(kE, sl(36, 56.4).x, Y0, sl(36, 56.4).z);
  P.stoneLantern(kE, sl(36, 61.8).x, Y0, sl(36, 61.8).z);
  orchard(kE, [
    [36, 66, 0, 1.0],
    [33, 74, 2, 0.95],
    [44, 70, 1, 1.1],
    [57, 57, 2, 1.0],
    [74, 22, 1, 1.05],
    [76.5, 32, 0, 0.95],
    [71, 42, 2, 1.1],
  ]);

  // --- West: walk from the plaza to the bison stables ---
  const kW = zone('grounds_west', sl(-43, 36), 16, { district: 'west' });
  walk(kW, sl(-56.6, 37.8), sl(-29.6, 33.6), 3.4);
  for (const t of [0.3, 0.7]) {
    const a = sl(-56.6 + 27 * t, 37.8 - 4.2 * t);
    P.stoneLantern(kW, a.x - 0.4, Y0, a.z - 2.6);
  }

  // --- North-east: the great-bell pavilion ---
  const kN = zone('grounds_bell', BELL_PAVILION, 10, { district: 'north' });
  const b = BELL_PAVILION;
  const floor = P.pavilion(kN, { x: b.x, z: b.z, y: Y0, r: 3.4, h: 4.2, roofH: 4.8, steps: 2, entrances: [P.faceYaw(-0.47, 0.88), P.faceYaw(0.47, -0.88)], finial: 0.7 });
  const bell = G.lathe([[0.86, 0], [0.84, 0.1], [0.66, 0.5], [0.56, 1.1], [0.5, 1.55], [0.3, 1.72], [0.0, 1.75]], 18, 1);
  kN.main.mesh('bronze', bell, { x: b.x, y: floor + 1.15, z: b.z });
  bell.dispose();
  kN.main.box('wood_dark', { x: b.x, y: floor + 3.6, z: b.z, sx: 6.0, sy: 0.3, sz: 0.3, yaw: 0.5 });
  kN.main.cylinder('iron', { x: b.x, z: b.z, y: floor + 2.85, r: 0.05, h: 0.75, segments: 6 });
  kN.main.collider({ shape: 'cylinder', x: b.x, y: floor + 1.15 + 0.9, z: b.z, r: 0.86, hy: 0.9, walkable: false, solid: true });
  // Wooden striker beam hanging beside the bell.
  kN.props.box('wood', { x: b.x + 1.25, y: floor + 1.9, z: b.z, sx: 1.6, sy: 0.24, sz: 0.24 });
  for (const [x, z, v] of [[31, -64, 1], [44.5, -77, 0]] as Array<[number, number, number]>) {
    const p = sl(x, z);
    P.pine(kN, p.x, Y0, p.z, v, 1.0, x * 0.2, false);
  }
}

/** Paved walk (walkable slab) from a to b. */
function walk(k: Kit, a: P2, b: P2, width: number): void {
  const dx = b.x - a.x, dz = b.z - a.z;
  P.slab(k, (a.x + b.x) / 2, (a.z + b.z) / 2, Y0 + 0.12, Math.hypot(dx, dz), width, P.alongYaw(dx, dz), 'paving', 0.4);
}

/** White chorten (stupa): stepped base, dome, harmika and a gold spire. Solid. */
function chorten(k: Kit, x: number, z: number, yaw: number, s: number): void {
  const t = { x, y: Y0, z, yaw, sx: s, sy: s, sz: s };
  P.repeatProp(k.main, 'chorten_body', chortenBody, 'plaster_white', t);
  P.repeatProp(k.main, 'chorten_base', chortenBase, 'stone_light', t);
  P.repeatProp(k.main, 'chorten_gold', chortenSpire, 'gold', t);
  k.main.collider({ shape: 'box', x, y: Y0 + 0.8 * s, z, hx: 1.3 * s, hy: 0.8 * s, hz: 1.3 * s, yaw, walkable: false, solid: true, surface: 'stone' });
  k.main.collider({ shape: 'cylinder', x, y: Y0 + 2.6 * s, z, r: 1.1 * s, hy: 1.1 * s, walkable: false, solid: true, surface: 'stone' });
}

function chortenBase(): THREE.BufferGeometry {
  return G.mergeAll([
    new THREE.BoxGeometry(2.6, 0.5, 2.6).translate(0, 0.25, 0),
    new THREE.BoxGeometry(2.15, 0.45, 2.15).translate(0, 0.725, 0),
    new THREE.BoxGeometry(0.8, 0.44, 0.8).translate(0, 2.78, 0),
    new THREE.BoxGeometry(1.0, 0.12, 1.0).translate(0, 3.06, 0),
  ]);
}

function chortenBody(): THREE.BufferGeometry {
  return G.mergeAll([
    new THREE.BoxGeometry(1.8, 0.36, 1.8).translate(0, 1.13, 0),
    G.lathe([[0.92, 1.3], [1.08, 1.48], [1.13, 1.78], [1.04, 2.14], [0.74, 2.42], [0.32, 2.56], [0.0, 2.58]], 18, 1.5),
  ]);
}

function chortenSpire(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.1, 0.32, 1.45, 10).translate(0, 3.12 + 0.725, 0)];
  for (let i = 0; i < 4; i++) parts.push(new THREE.CylinderGeometry(0.3 - i * 0.05, 0.3 - i * 0.05, 0.05, 10).translate(0, 3.35 + i * 0.3, 0));
  parts.push(new THREE.CylinderGeometry(0.34, 0.2, 0.14, 10).translate(0, 4.64, 0));
  parts.push(new THREE.SphereGeometry(0.13, 8, 6).translate(0, 4.84, 0));
  parts.push(new THREE.ConeGeometry(0.06, 0.32, 6).translate(0, 5.1, 0));
  return G.mergeAll(parts);
}

/** Moon-peach trees: [x, z (summit offsets), variant 0-2, scale]. Variant 2 is in blossom. */
function orchard(k: Kit, trees: Array<[number, number, number, number]>): void {
  for (const [ox, oz, v, s] of trees) {
    const p = sl(ox, oz);
    const yaw = ox * 0.37 + oz * 0.21;
    const t = { x: p.x, y: Y0, z: p.z, yaw, sx: s, sy: s, sz: s };
    P.repeatProp(k.props, 'orchard_trunk', orchardTrunk, 'wood_dark', t);
    P.repeatProp(k.props, v === 2 ? 'orchard_blossom' : v === 1 ? 'orchard_leaf_wide' : 'orchard_leaf', () => orchardCanopy(v === 1), am(v === 2 ? 'blossom' : 'leaf'), t);
    k.main.collider({ shape: 'cylinder', x: p.x, y: Y0 + 1.0 * s, z: p.z, r: 0.3 * s, hy: 1.0 * s, walkable: false, solid: true });
  }
}

function orchardTrunk(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.13, 0.22, 2.0, 7).translate(0, 1.0, 0);
  const b1 = new THREE.CylinderGeometry(0.06, 0.1, 1.2, 5).translate(0, 0.6, 0).rotateZ(0.7).translate(0.05, 1.7, 0);
  const b2 = new THREE.CylinderGeometry(0.06, 0.1, 1.1, 5).translate(0, 0.55, 0).rotateZ(-0.6).rotateY(2.1).translate(0, 1.8, 0);
  return G.mergeAll([trunk, b1, b2]);
}

function orchardCanopy(wide: boolean): THREE.BufferGeometry {
  const blobs: Array<[number, number, number, number]> = wide
    ? [[0, 2.9, 0, 1.35], [1.0, 2.6, 0.4, 1.0], [-0.9, 2.7, -0.3, 1.05], [0.2, 3.5, -0.6, 0.85], [-0.3, 2.5, 0.9, 0.85]]
    : [[0, 3.0, 0, 1.2], [0.8, 2.7, -0.5, 0.95], [-0.7, 2.8, 0.5, 0.95], [0.1, 3.6, 0.2, 0.8]];
  return G.mergeAll(blobs.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 1).scale(1, 0.8, 1).translate(x, y, z)));
}
