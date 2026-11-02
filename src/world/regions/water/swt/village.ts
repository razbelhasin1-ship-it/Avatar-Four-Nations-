import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import type { ContentBuilder } from '../../../kit/Builder';
import { WC } from '../../../landforms/wolfCove';
import { boulder, emblem, hull, pillow, tentCone } from '../geometry';
import { wtMat, wtMatTinted } from '../materials';
import { banner, barrel, crate, dryingRack } from '../parts';
import { annexUnit, driftUnit, hollowDome, iglooDoorUnit, iglooUnit } from './domes';
import {
  BOATYARD,
  C,
  CARVERS,
  type Dwelling,
  DOG_PENS,
  FLOOR,
  GREAT,
  HEALER,
  HEARTH,
  PLAZA,
  POND,
  POND_HOLE,
  RACKS_N,
  RI,
  STORAGE,
  STORY_RING,
  SWT,
  TANNERY,
  TRAINING,
  WORKSHOP,
} from './layout';

/**
 * Wolf Cove's village: ~110 igloos of stacked snow blocks (instanced, some joined to a smaller
 * dome, drifts against their north sides) and ~25 sealskin tents on branch frames, packed in
 * clusters with lanes between them; the Great Igloo (council hall) at the centre with the Hearth
 * Plaza before its entrance; the Frozen Pond and training circle (east); drying racks and the
 * tannery (north); the healer's igloo, workshops, the long storage igloo, dog pens, the boat yard.
 */

export interface VillageInfo {
  /** Enterable interiors: centre, radius, entrance yaw (for furnishing, lights and the crowd). */
  interiors: Array<{ id: string; x: number; z: number; r: number; yaw: number; kind: 'great' | 'healer' | 'workshop' | 'home' }>;
  /** Doorways (lamps, comings and goings). */
  doors: Array<{ x: number; z: number; yaw: number }>;
  /** Fire pits (flames, smoke, warm light). */
  fires: Array<{ x: number; y: number; z: number; big: boolean }>;
  /** Seats round the hearth and the story ring (people sit here). */
  seats: Array<{ x: number; z: number; yaw: number }>;
}

const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const mat = (x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx) =>
  m4.compose(new THREE.Vector3(x, y, z), q4.setFromAxisAngle(UP, yaw), new THREE.Vector3(sx, sy, sz)).clone();

/** Snow-block igloos read a little blue against the snow (image 1). */
const IGLOO_MAT = () => wtMatTinted('ice_wall', '#dbe8f7');

export function buildVillage(b: ContentBuilder, props: ContentBuilder, list: Dwelling[], low: boolean): VillageInfo {
  const rnd = new Random(SWT.seed + 21);
  const info: VillageInfo = { interiors: [], doors: [], fires: [], seats: [] };
  const y = FLOOR;
  // --- Dwellings.
  let homeN = 0;
  for (const d of list) {
    if (d.kind === 'igloo') {
      if (d.home) {
        const r = d.r + 0.35;
        hollowDome(b, { x: d.x, y, z: d.z, r, h: r * 0.86, yaw: d.yaw, tunnel: 1.2, tw: 1.15, th: 1.45 });
        info.interiors.push({ id: `home_${homeN++}`, x: d.x, z: d.z, r, yaw: d.yaw, kind: 'home' });
        info.doors.push({ x: d.x + Math.sin(d.yaw) * (r + 1.3), z: d.z + Math.cos(d.yaw) * (r + 1.3), yaw: d.yaw });
      } else {
        b.instance('swt_igloo', iglooUnit, IGLOO_MAT(), mat(d.x, y - 0.04, d.z, d.yaw, d.r));
        props.instance('swt_igloo_door', iglooDoorUnit, wtMat('dark'), mat(d.x, y - 0.04, d.z, d.yaw, d.r), false);
        b.collider({ shape: 'sphere', x: d.x, y: y - d.r * 0.18, z: d.z, r: d.r, walkable: true, solid: true, surface: 'snow' });
        info.doors.push({ x: d.x + Math.sin(d.yaw) * d.r * 1.4, z: d.z + Math.cos(d.yaw) * d.r * 1.4, yaw: d.yaw });
      }
      // Wind-packed drift against the north side.
      props.instance('swt_drift', driftUnit, wtMat('snow'), mat(d.x + (rnd.next() - 0.5) * d.r * 0.4, y - 0.05, d.z - d.r * 0.82, (rnd.next() - 0.5) * 0.5, d.r * (0.85 + rnd.next() * 0.3)), false);
      if (d.annex) {
        const a = d.annex;
        b.instance('swt_annex', annexUnit, IGLOO_MAT(), mat(a.x, y - 0.04, a.z, rnd.next() * 6.28, a.r));
        b.collider({ shape: 'sphere', x: a.x, y: y - a.r * 0.22, z: a.z, r: a.r, walkable: true, solid: true, surface: 'snow' });
      }
    } else {
      // Sealskin tent on a frame of branches: hide cone, poles crossing above the apex, a wave emblem.
      const h = 2.5 + rnd.next() * 0.5;
      b.instance('swt_tent', () => tentCone(1, 1, 9), rnd.next() < 0.35 ? wtMatTinted('hide', '#b9ae9f') : wtMatTinted('hide', '#ddd3c2'), mat(d.x, y - 0.03, d.z, d.yaw, d.r, h, d.r));
      for (let k = 0; k < 4; k++) {
        const a = d.yaw + (k / 4) * Math.PI * 2 + 0.4;
        const pole = new THREE.Matrix4().compose(
          new THREE.Vector3(d.x + Math.sin(a) * 0.12, y + h * 0.88, d.z + Math.cos(a) * 0.12),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35)),
          new THREE.Vector3(1, 1, 1),
        );
        props.instance('swt_tent_pole', () => new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5), wtMat('wood'), pole, false);
      }
      props.instance('swt_tent_door', () => new THREE.PlaneGeometry(0.75, 1.15).translate(0, 0.58, 0), wtMat('dark'), mat(d.x + Math.sin(d.yaw) * d.r * 0.62, y, d.z + Math.cos(d.yaw) * d.r * 0.62, d.yaw, 1), false);
      const ea = d.yaw + Math.PI * 0.6;
      props.instance('swt_tent_emblem', () => emblem(0.3, 0.02), wtMat('banner_water'), mat(d.x + Math.sin(ea) * d.r * 0.5, y + h * 0.48, d.z + Math.cos(ea) * d.r * 0.5, ea, 1), false);
      b.collider({ shape: 'cylinder', x: d.x, y: y + 1.1, z: d.z, r: d.r * 0.82, hy: 1.1, walkable: false, solid: true });
      info.doors.push({ x: d.x + Math.sin(d.yaw) * (d.r + 0.6), z: d.z + Math.cos(d.yaw) * (d.r + 0.6), yaw: d.yaw });
    }
  }
  // --- The Great Igloo: the council hall (enterable; its tunnel and vestibule face north to the gate).
  hollowDome(b, { x: GREAT.x, y, z: GREAT.z, r: GREAT.r, h: GREAT.h, yaw: Math.PI, tunnel: GREAT.tunnel, tw: 2.5, th: 2.9, vestibule: true });
  info.interiors.push({ id: 'great_igloo', x: GREAT.x, z: GREAT.z, r: GREAT.r, yaw: Math.PI, kind: 'great' });
  // Banners on whalebone poles either side of the tunnel mouth.
  for (const s of [-1, 1]) {
    const px = GREAT.x + s * 2.6, pz = GREAT.z - GREAT.r - GREAT.tunnel - 0.6;
    b.mesh(wtMat('bone'), new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6), { x: px, y: y + 2.3, z: pz });
    banner(b, px - s * 0.05, y + 4.4, pz, Math.PI, 0.9, 2.2, 'banner_water');
  }
  // --- Hearth Plaza: the communal fire pit ringed with stones, mats, drying racks, the storyteller's seat.
  hearthPlaza(b, props, info, rnd);
  // --- Frozen Pond (east) with its one thawed hole, and the training circle beside it.
  b.mesh(wtMat('ice_clear'), new THREE.CircleGeometry(POND.r, 40).rotateX(-Math.PI / 2), { x: POND.x, y: y + 0.03, z: POND.z }, { castShadow: false });
  b.mesh(wtMat('snow'), new THREE.TorusGeometry(POND.r + 0.15, 0.35, 5, 40).rotateX(Math.PI / 2).scale(1, 1, 0.45), { x: POND.x, y: y + 0.05, z: POND.z }, { castShadow: false });
  b.mesh(wtMat('dark'), new THREE.CylinderGeometry(POND_HOLE.r, POND_HOLE.r * 0.92, 0.6, 18, 1, true), { x: POND_HOLE.x, y: y - 0.25, z: POND_HOLE.z }, { castShadow: false });
  trainingCircle(b, props, rnd);
  // --- Healer's igloo and the workshop (enterable), the carvers' bench, the tannery, the boat yard.
  hollowDome(b, { x: HEALER.x, y, z: HEALER.z, r: HEALER.r + 0.4, h: (HEALER.r + 0.4) * 0.88, yaw: Math.atan2(C.x - HEALER.x, C.z - HEALER.z), tunnel: 1.3, tw: 1.25, th: 1.55 });
  info.interiors.push({ id: 'healer', x: HEALER.x, z: HEALER.z, r: HEALER.r + 0.4, yaw: Math.atan2(C.x - HEALER.x, C.z - HEALER.z), kind: 'healer' });
  const wy = Math.atan2(C.x - WORKSHOP.x, C.z - WORKSHOP.z);
  hollowDome(b, { x: WORKSHOP.x, y, z: WORKSHOP.z, r: WORKSHOP.r + 0.5, h: (WORKSHOP.r + 0.5) * 0.85, yaw: wy, tunnel: 1.4, tw: 1.5, th: 1.7 });
  info.interiors.push({ id: 'workshop', x: WORKSHOP.x, z: WORKSHOP.z, r: WORKSHOP.r + 0.5, yaw: wy, kind: 'workshop' });
  carvers(b, props, rnd);
  tannery(b, props, rnd);
  boatYard(b, props, rnd);
  // --- Long storage igloo, dog pens, the story ring.
  storage(b);
  dogPens(b, props, rnd);
  storyRing(b, props, info);
  // --- Drying racks north of the plaza (fish and meat), either side of the processional path.
  RACKS_N.forEach((p, i) => {
    const yaw = Math.atan2(p.x - C.x, p.z - C.z) + Math.PI / 2;
    dryingRack(b, p.x, y, p.z, yaw, 3.6);
    dryingRack(b, p.x + Math.sin(yaw + Math.PI / 2) * 1.6, y, p.z + Math.cos(yaw + Math.PI / 2) * 1.6, yaw, 3.2);
    if (i % 2 === 0) barrel(b, p.x + Math.sin(yaw) * 2.6, y, p.z + Math.cos(yaw) * 2.6);
  });
  // --- The processional path: whalebone posts with lamps line it from the gate to the plaza.
  for (let z = WC.z - RI + 6; z < PLAZA.z - PLAZA.r - 1; z += 9) {
    for (const s of [-1, 1]) {
      const px = C.x + s * 3.4;
      props.instance('swt_path_post', () => new THREE.CylinderGeometry(0.08, 0.11, 1.5, 6).translate(0, 0.75, 0), wtMat('bone'), mat(px, y, z, 0, 1), true);
      props.instance('swt_path_lamp', () => new THREE.SphereGeometry(0.16, 8, 6).translate(0, 1.6, 0), wtMat('lantern_warm'), mat(px, y, z, 0, 1), false);
    }
  }
  // Doorway lamps on about a third of the homes (whale-oil lamps, warm at night).
  for (let i = 0; i < info.doors.length; i += 3) {
    const d = info.doors[i];
    props.instance('swt_door_lamp', () => new THREE.SphereGeometry(0.12, 8, 6), wtMat('lantern_warm'), mat(d.x + Math.cos(d.yaw) * 0.6, y + 0.55, d.z - Math.sin(d.yaw) * 0.6, 0, 1), false);
  }
  // Scattered crates, barrels and kayaks on racks in the outer neighbourhoods.
  for (let i = 0; i < (low ? 10 : 22); i++) {
    const a = rnd.next() * Math.PI * 2, fr = 0.72 + rnd.next() * 0.2;
    const x = C.x + Math.sin(a) * RI * fr, z = C.z - Math.cos(a) * RI * fr;
    if (list.some((d) => Math.hypot(d.x - x, d.z - z) < d.r + 1.2)) continue;
    if (i % 3 === 0) kayakRack(b, props, x, z, a + Math.PI / 2);
    else if (i % 3 === 1) crate(b, x, y, z, a, 0.9);
    else barrel(b, x, y, z, 0.9);
  }
  return info;
}

function hearthPlaza(b: ContentBuilder, props: ContentBuilder, info: VillageInfo, rnd: Random): void {
  const y = FLOOR;
  const { x, z } = HEARTH;
  // Stone ring and the fire bed.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    b.mesh(wtMat('rock_dark'), boulder(i * 7 + 3, 0.32, 0.24, 0.28, 0), { x: x + Math.cos(a) * 1.35, y: y + 0.08, z: z + Math.sin(a) * 1.35, yaw: a });
  }
  b.mesh(wtMat('dark'), new THREE.CircleGeometry(1.15, 18).rotateX(-Math.PI / 2), { x, y: y + 0.03, z }, { castShadow: false });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.08, 0.1, 1.3, 6).rotateZ(Math.PI / 2 - 0.35), { x: x + Math.cos(a) * 0.25, y: y + 0.25, z: z + Math.sin(a) * 0.25, yaw: -a });
  }
  b.collider({ shape: 'cylinder', x, y: y + 0.25, z, r: 1.55, hy: 0.25, walkable: true, solid: true, surface: 'stone' });
  info.fires.push({ x, y: y + 0.2, z, big: true });
  // Sitting mats (pelts) round the fire and benches of packed snow behind them.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    const mx = x + Math.cos(a) * 3.1, mz = z + Math.sin(a) * 3.1;
    const yaw = Math.atan2(x - mx, z - mz);
    props.instance('swt_mat', () => pillow(1.1, 0.75, 0.08, 0.06, 1), wtMat(i % 3 === 0 ? 'fur' : 'hide'), mat(mx, y + 0.01, mz, yaw, 1), false);
    if (i % 2 === 0) b.mesh(wtMat('snow'), pillow(1.6, 0.6, 0.42, 0.18, 2), { x: x + Math.cos(a) * 4.1, y, z: z + Math.sin(a) * 4.1, yaw: yaw + Math.PI / 2 });
    info.seats.push({ x: mx, z: mz, yaw });
  }
  // The storyteller's seat: a whalebone chair facing the fire from the Great Igloo's side.
  const sx = x + 0.4, sz = z + 4.6;
  b.mesh(wtMat('bone'), new THREE.BoxGeometry(0.9, 0.45, 0.7), { x: sx, y: y + 0.22, z: sz });
  for (const s of [-1, 1]) b.mesh(wtMat('bone'), new THREE.TorusGeometry(0.75, 0.07, 5, 10, Math.PI * 0.8).rotateZ(Math.PI * 0.1), { x: sx + s * 0.42, y: y + 0.45, z: sz + 0.2, yaw: Math.PI / 2 });
  b.mesh(wtMat('fur'), pillow(0.85, 0.6, 0.1, 0.05, 1), { x: sx, y: y + 0.46, z: sz });
  info.seats.push({ x: sx, z: sz, yaw: Math.PI });
  // Drying racks and melt barrels (water within reach of the start: see WolfCove's sources).
  dryingRack(b, x - 6.2, y, z - 2.5, 0.5, 3.2);
  dryingRack(b, x + 6.4, y, z - 3, -0.45, 3.2);
  for (const [bx, bz] of [[x + 3.6, z - 3.9], [x + 4.4, z - 3.1], [x - 3.9, z - 3.6]]) barrel(b, bx, y, bz, 1.05);
  // A cooking post with a stew pot by the fire.
  b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.05, 0.06, 1.8, 5).rotateZ(-0.5), { x: x - 1.6, y: y + 0.85, z: z - 0.2 });
  b.mesh(wtMat('rock_dark'), new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), { x: x - 0.55, y: y + 0.95, z: z - 0.2 });
  void rnd;
}

function trainingCircle(b: ContentBuilder, props: ContentBuilder, rnd: Random): void {
  const y = FLOOR;
  const { x, z, r } = TRAINING;
  b.mesh(wtMat('ice_trim'), new THREE.TorusGeometry(r, 0.12, 4, 48).rotateX(Math.PI / 2), { x, y: y + 0.04, z }, { castShadow: false });
  b.mesh(wtMat('paving'), new THREE.CircleGeometry(r - 0.1, 40).rotateX(-Math.PI / 2), { x, y: y + 0.02, z }, { castShadow: false });
  // Practice posts with hide targets, and a rack of spears, clubs and boomerangs.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    const px = x + Math.cos(a) * (r + 1.4), pz = z + Math.sin(a) * (r + 1.4);
    b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.12, 0.14, 1.9, 6), { x: px, y: y + 0.95, z: pz });
    b.mesh(wtMat('hide'), new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12).rotateX(Math.PI / 2), { x: px, y: y + 1.45, z: pz, yaw: Math.atan2(x - px, z - pz) });
    b.collider({ shape: 'cylinder', x: px, y: y + 0.95, z: pz, r: 0.2, hy: 0.95, walkable: false, solid: true });
  }
  const rx = x + r + 2.6, rz = z - 1.5;
  b.mesh(wtMat('wood'), new THREE.BoxGeometry(0.1, 1.6, 2.2), { x: rx, y: y + 0.8, z: rz });
  for (let k = 0; k < 4; k++) props.mesh(wtMat(k % 2 ? 'bone' : 'wood'), new THREE.CylinderGeometry(0.03, 0.03, 2.1, 4).rotateZ(0.12), { x: rx - 0.12, y: y + 1.05, z: rz - 0.8 + k * 0.5 });
  void rnd;
}

function carvers(b: ContentBuilder, props: ContentBuilder, rnd: Random): void {
  const y = FLOOR;
  const { x, z } = CARVERS;
  // A low bench of packed snow under a hide awning, bone and whale-tooth pieces, tools.
  b.mesh(wtMat('snow'), pillow(3, 1.1, 0.75, 0.2, 2), { x, y, z, yaw: 0.4 });
  b.mesh(wtMat('hide'), new THREE.PlaneGeometry(3.4, 2.2).rotateX(-Math.PI / 2 + 0.25), { x, y: y + 2.1, z: z + 0.2, yaw: 0.4 });
  for (const s of [-1, 1]) b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.05, 0.06, 2.3, 5), { x: x + Math.cos(0.4) * s * 1.6, y: y + 1.15, z: z - Math.sin(0.4) * s * 1.6 + 1 });
  for (let k = 0; k < 7; k++) props.mesh(wtMat('bone'), new THREE.CylinderGeometry(0.03, 0.06, 0.35 + rnd.next() * 0.3, 5).rotateZ(Math.PI / 2), { x: x - 1 + k * 0.32, y: y + 0.8, z: z + (rnd.next() - 0.5) * 0.4, yaw: rnd.next() * 3 });
  b.collider({ shape: 'box', x, y: y + 0.38, z, hx: 1.5, hy: 0.38, hz: 0.55, yaw: 0.4, walkable: true, solid: true });
}

function tannery(b: ContentBuilder, props: ContentBuilder, rnd: Random): void {
  const y = FLOOR;
  const { x, z } = TANNERY;
  // Hides stretched on frames, a scraping log, a vat.
  for (let i = 0; i < 3; i++) {
    const a = -0.6 + i * 0.6;
    const fx = x + Math.sin(a) * 2.6, fz = z + Math.cos(a) * 2.6;
    const yaw = a;
    for (const s of [-1, 1]) b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.05, 0.06, 2.2, 5), { x: fx + Math.cos(yaw) * s * 0.85, y: y + 1.1, z: fz - Math.sin(yaw) * s * 0.85 });
    b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5).rotateZ(Math.PI / 2), { x: fx, y: y + 2, z: fz, yaw });
    b.mesh(wtMat(i % 2 ? 'hide_dark' : 'hide'), new THREE.PlaneGeometry(1.5, 1.4), { x: fx, y: y + 1.25, z: fz, yaw });
    b.collider({ shape: 'box', x: fx, y: y + 1.1, z: fz, hx: 0.95, hy: 1.1, hz: 0.12, yaw, walkable: false, solid: true });
  }
  b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.22, 0.22, 2.2, 8).rotateZ(Math.PI / 2), { x: x - 1.2, y: y + 0.45, z: z - 1.8, yaw: 0.9 });
  barrel(b, x + 1.6, y, z - 1.6, 1.2);
  void props;
  void rnd;
}

function boatYard(b: ContentBuilder, props: ContentBuilder, rnd: Random): void {
  const y = FLOOR;
  const { x, z } = BOATYARD;
  // Canoes upturned on trestles, a sled with a broken runner, a coil of rope.
  for (let i = 0; i < 2; i++) {
    const bx = x + (i - 0.5) * 3, bz = z + (i - 0.5) * 1.2;
    const yaw = 0.3 + i * 0.25;
    for (const s of [-1, 1]) b.mesh(wtMat('wood'), new THREE.BoxGeometry(0.12, 0.8, 1.1), { x: bx + Math.sin(yaw) * s * 1.4, y: y + 0.4, z: bz + Math.cos(yaw) * s * 1.4, yaw });
    const g = hull(4.6, 0.8, 0.45);
    g.rotateZ(Math.PI);
    b.mesh(wtMat(i ? 'hide_dark' : 'hide'), g, { x: bx, y: y + 1.25, z: bz, yaw });
    b.collider({ shape: 'box', x: bx, y: y + 0.7, z: bz, hx: 0.6, hy: 0.7, hz: 2.3, yaw, walkable: true, solid: true });
  }
  sled(b, x + 1.5, z + 3, 1.2);
  void props;
  void rnd;
}

/** A dog sled (runners, slats, a hide wrap); exported for the shore and the tundra. */
export function sled(b: ContentBuilder, x: number, z: number, yaw: number, y: number = FLOOR): void {
  for (const s of [-1, 1]) {
    const run = new THREE.BoxGeometry(0.06, 0.08, 2.6);
    b.mesh(wtMat('bone'), run, { x: x + Math.cos(yaw) * s * 0.35, y: y + 0.05, z: z - Math.sin(yaw) * s * 0.35, yaw });
    b.mesh(wtMat('bone'), new THREE.TorusGeometry(0.25, 0.04, 4, 8, Math.PI / 2).rotateY(Math.PI / 2), { x: x + Math.cos(yaw) * s * 0.35 + Math.sin(yaw) * 1.25, y: y + 0.28, z: z - Math.sin(yaw) * s * 0.35 + Math.cos(yaw) * 1.25, yaw });
  }
  b.mesh(wtMat('wood'), new THREE.BoxGeometry(0.8, 0.06, 2.2), { x, y: y + 0.32, z, yaw });
  b.mesh(wtMat('hide'), pillow(0.7, 1.2, 0.3, 0.12, 1), { x: x - Math.sin(yaw) * 0.3, y: y + 0.35, z: z - Math.cos(yaw) * 0.3, yaw });
  b.collider({ shape: 'box', x, y: y + 0.3, z, hx: 0.45, hy: 0.3, hz: 1.3, yaw, walkable: true, solid: true });
}

function kayakRack(b: ContentBuilder, props: ContentBuilder, x: number, z: number, yaw: number): void {
  const y = FLOOR;
  for (const s of [-1, 1]) b.mesh(wtMat('wood'), new THREE.BoxGeometry(0.1, 1.5, 0.9), { x: x + Math.sin(yaw) * s * 1.5, y: y + 0.75, z: z + Math.cos(yaw) * s * 1.5, yaw });
  for (let k = 0; k < 2; k++) {
    const g = hull(4.2, 0.55, 0.35);
    props.mesh(wtMat(k ? 'hide_dark' : 'hide'), g, { x: x + Math.cos(yaw) * (k - 0.5) * 0.65, y: y + 1.0 + k * 0.38, z: z - Math.sin(yaw) * (k - 0.5) * 0.65, yaw });
  }
  b.collider({ shape: 'box', x, y: y + 0.8, z, hx: 0.6, hy: 0.8, hz: 2.2, yaw, walkable: false, solid: true });
}

function storage(b: ContentBuilder): void {
  const y = FLOOR;
  const { x, z, len, w, yaw } = STORAGE;
  const g = new THREE.SphereGeometry(1, 22, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(w / 2, 2.6, len / 2);
  b.mesh(wtMat('ice_wall'), g, { x, y, z, yaw });
  b.mesh(wtMat('dark'), new THREE.CircleGeometry(0.75, 10, 0, Math.PI), { x: x + Math.sin(yaw) * (len / 2 - 0.02), y, z: z + Math.cos(yaw) * (len / 2 - 0.02), yaw });
  b.collider({ shape: 'box', x, y: y + 1.1, z, hx: w / 2 - 0.3, hy: 1.1, hz: len / 2 - 0.6, yaw, walkable: false, solid: true });
}

function dogPens(b: ContentBuilder, props: ContentBuilder, rnd: Random): void {
  const y = FLOOR;
  const { x, z, r } = DOG_PENS;
  // A ring of driftwood posts with a rope, an opening toward the village, kennels of snow blocks.
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const gate = Math.abs(Math.atan2(Math.sin(a - Math.atan2(C.z - z, C.x - x)), Math.cos(a - Math.atan2(C.z - z, C.x - x)))) < 0.3;
    if (gate) continue;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    props.instance('swt_pen_post', () => new THREE.CylinderGeometry(0.06, 0.08, 1.2, 5).translate(0, 0.6, 0), wtMat('wood'), new THREE.Matrix4().makeTranslation(px, y, pz), true);
    const a2 = ((i + 1) / n) * Math.PI * 2;
    const len = r * (a2 - a);
    props.mesh(wtMat('rope'), new THREE.CylinderGeometry(0.02, 0.02, len, 3).rotateZ(Math.PI / 2), { x: x + Math.cos((a + a2) / 2) * r, y: y + 0.95, z: z + Math.sin((a + a2) / 2) * r, yaw: -(a + a2) / 2 - Math.PI / 2 });
    b.collider({ shape: 'box', x: x + Math.cos((a + a2) / 2) * r, y: y + 0.6, z: z + Math.sin((a + a2) / 2) * r, hx: len / 2, hy: 0.6, hz: 0.1, yaw: -((a + a2) / 2) - Math.PI / 2, walkable: false, solid: true });
  }
  for (let k = 0; k < 3; k++) {
    const a = 0.8 + k * 1.6;
    const kx = x + Math.cos(a) * (r - 1.8), kz = z + Math.sin(a) * (r - 1.8);
    b.mesh(wtMat('ice_wall'), new THREE.SphereGeometry(0.9, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1), { x: kx, y, z: kz });
    b.mesh(wtMat('dark'), new THREE.CircleGeometry(0.32, 8, 0, Math.PI), { x: kx + Math.cos(a + Math.PI) * 0.9, y, z: kz + Math.sin(a + Math.PI) * 0.9, yaw: -a - Math.PI / 2 });
  }
  void rnd;
}

function storyRing(b: ContentBuilder, props: ContentBuilder, info: VillageInfo): void {
  const y = FLOOR;
  const { x, z, r } = STORY_RING;
  // A ring of snow benches round a small fire: where the elders tell the tribe's stories.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
    const yaw = Math.atan2(x - bx, z - bz);
    b.mesh(wtMat('snow'), pillow(1.4, 0.55, 0.42, 0.18, 2), { x: bx, y, z: bz, yaw: yaw + Math.PI / 2 });
    props.instance('swt_mat', () => pillow(1.1, 0.75, 0.08, 0.06, 1), wtMat('fur'), mat(bx, y + 0.42, bz, yaw + Math.PI / 2, 0.9), false);
    info.seats.push({ x: x + Math.cos(a) * (r - 0.1), z: z + Math.sin(a) * (r - 0.1), yaw });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.mesh(wtMat('rock_dark'), boulder(i + 41, 0.18, 0.14, 0.16, 0), { x: x + Math.cos(a) * 0.75, y: y + 0.05, z: z + Math.sin(a) * 0.75 });
  }
  info.fires.push({ x, y: y + 0.12, z, big: false });
}
