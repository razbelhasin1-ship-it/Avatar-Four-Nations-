import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import type { ContentBuilder } from '../../../kit/Builder';
import { WC, WC_GATE } from '../../../landforms/wolfCove';
import { archSlab, dome } from '../geometry';
import { banner } from '../parts';
import { wtMat, wtMatTinted } from '../materials';
import { C, GATE_TOWERS, stairFoot, SWT, TOWER_ANGLES } from './layout';

/**
 * Wolf Cove's ring wall (image 1): the outer face a sheer 10 m cliff of tall vertical ice slabs with
 * visible seams, a snow cap and icicles; a walkable top 2.5 m wide, only 2 m above the village floor;
 * six small domed towers (enterable lookouts the wall walk runs through) and the two taller gate
 * towers either side of the north opening; six stair ramps up from the village floor.
 */

const TAU = Math.PI * 2;
/** Compass angle → world point at radius r from the centre. */
const P = (a: number, r: number) => ({ x: C.x + Math.sin(a) * r, z: C.z - Math.cos(a) * r });
/** Box yaw whose local X runs along the ring (clockwise tangent) at compass angle a. */
const tangentYaw = (a: number) => -a;

/** Half-angle of the gate's opening, from the centre line to the gate towers' far faces. */
const GATE_SPAN = (WC.gateHalf + 3.2 + 3) / WC.R;

export interface WallInfo {
  /** Tower doorways and lookout floors (for lights, sentries, the crowd). */
  towers: Array<{ x: number; z: number; floorY: number; a: number }>;
  gateTowers: Array<{ x: number; z: number; floorY: number }>;
  /** Stair ramps: foot (village floor) and head (wall top). */
  stairs: Array<{ foot: THREE.Vector3; head: THREE.Vector3 }>;
}

export function buildWall(b: ContentBuilder, props: ContentBuilder, low: boolean): WallInfo {
  const rnd = new Random(SWT.seed + 11);
  const R = WC.R, T = WC.wallT;
  const base = WC.plain - 1.2;
  const top = WC.wallTop;
  // Three tints of slab so neighbours read apart (with their offsets, the seams) as in image 1.
  const slabMats = [wtMat('ice_massive'), wtMatTinted('ice_massive', '#dce9f5'), wtMatTinted('ice_massive', '#c3d6ea')];
  const snowM = wtMat('snow');
  // --- Slabs of the outer face (merged), each a little proud of or behind its neighbours (seams).
  const span0 = GATE_SPAN, span1 = TAU - GATE_SPAN;
  let a = span0;
  while (a < span1) {
    const w = 1.25 + rnd.next() * 1.15;
    const da = w / R;
    const am = Math.min(span1, a + da / 2);
    const proud = rnd.next() * 0.45;
    const hTop = top + 0.05 + rnd.next() * 0.35;
    const p = P(am, R - T / 2 + proud / 2);
    const m = slabMats[Math.floor(rnd.next() * slabMats.length)];
    b.mesh(m, new THREE.BoxGeometry(w - 0.09, hTop - base, T + proud), { x: p.x, y: (hTop + base) / 2, z: p.z, yaw: tangentYaw(am) });
    a += da;
  }
  // --- Snow cap: a soft rounded strip along the top with a lip over the outer edge, and icicles.
  const capSeg = low ? 64 : 120;
  const icicle = (len: number) => new THREE.ConeGeometry(0.07 + len * 0.05, len, 5, 1).rotateX(Math.PI).translate(0, -len / 2, 0);
  for (let i = 0; i < capSeg; i++) {
    const a0 = (i / capSeg) * TAU, a1 = ((i + 1) / capSeg) * TAU;
    const am = (a0 + a1) / 2;
    if (am < span0 + 0.01 || am > span1 - 0.01) continue;
    const len = (a1 - a0) * R + 0.12;
    const p = P(am, R - T / 2 + 0.06);
    const cap = new THREE.CapsuleGeometry(0.32, len - 0.64, 2, 6).rotateZ(Math.PI / 2).scale(1, 0.75, (T + 0.5) / 0.64);
    b.mesh(snowM, cap, { x: p.x, y: top + 0.42, z: p.z, yaw: tangentYaw(am) }, { castShadow: false });
    // Icicles hanging from the outer lip (instanced).
    const n = low ? 2 : 4;
    for (let k = 0; k < n; k++) {
      const ak = a0 + (a1 - a0) * (k + rnd.next()) / n;
      const l = 0.35 + rnd.next() * rnd.next() * 1.3;
      const q = P(ak, R + 0.18);
      const m = new THREE.Matrix4().makeTranslation(q.x, top + 0.3, q.z);
      m.multiply(new THREE.Matrix4().makeScale(1, l, 1));
      props.instance('swt_icicle', () => icicle(1), wtMat('ice_clear'), m, false);
    }
  }
  // --- Colliders: the wall body (walkable top), polygonal ring segments.
  const segs = 96;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
    const am = (a0 + a1) / 2;
    if (a1 < span0 - 0.005 || a0 > span1 + 0.005) continue;
    const p = P(am, R - T / 2);
    const len = (a1 - a0) * R + 0.15;
    b.collider({ shape: 'box', x: p.x, y: (top + base) / 2, z: p.z, hx: len / 2, hy: (top - base) / 2, hz: T / 2, yaw: tangentYaw(am), walkable: true, solid: true, surface: 'packedsnow' });
  }
  // --- Small towers on the wall: hollow round lookouts the wall walk passes through.
  const info: WallInfo = { towers: [], gateTowers: [], stairs: [] };
  for (const ta of TOWER_ANGLES) {
    const c = P(ta, R - T / 2);
    roundLookout(b, c.x, c.z, ta, top, low);
    info.towers.push({ x: c.x, z: c.z, floorY: top, a: ta });
  }
  // --- Gate towers: square, taller, their rooms open onto the gate passage.
  GATE_TOWERS.forEach((g, i) => {
    squareGateTower(b, g.x, g.z, i === 0 ? 1 : -1, low);
    info.gateTowers.push({ x: g.x, z: g.z, floorY: WC.floor });
    // Water Tribe banners on the towers' outer faces.
    banner(b, g.x + (i === 0 ? 1.4 : -1.4), WC.wallTop + 9.5, g.z - 3.15, Math.PI, 1.6, 4.2, 'banner_water');
  });
  // --- Stair ramps from the village floor up to the wall top beside each tower.
  for (const ta of TOWER_ANGLES.slice(0, SWT.stairs)) {
    const s = stairFoot(ta);
    const foot = new THREE.Vector3(s.x, WC.floor, s.z);
    const head = new THREE.Vector3(s.headX, WC.wallTop, s.headZ);
    b.stairs({ from: foot, to: head, width: 1.7, material: wtMat('ice_trim'), stepHeight: 0.25, surface: 'packedsnow' });
    info.stairs.push({ foot, head });
  }
  return info;
}

/** Curved ice wall piece between two angles of a circle (local to a tower centre), y0..y1. */
function arcPiece(b: ContentBuilder, cx: number, cz: number, r: number, t: number, a0: number, a1: number, y0: number, y1: number, collide: boolean): void {
  const am = (a0 + a1) / 2;
  const len = (a1 - a0) * r + 0.06;
  const px = cx + Math.cos(am) * r, pz = cz + Math.sin(am) * r;
  const yaw = Math.PI / 2 - am; // local +Z points outward
  b.mesh(wtMat('ice_massive'), new THREE.BoxGeometry(len, y1 - y0, t), { x: px, y: (y0 + y1) / 2, z: pz, yaw });
  if (collide) b.collider({ shape: 'box', x: px, y: (y0 + y1) / 2, z: pz, hx: len / 2, hy: (y1 - y0) / 2, hz: t / 2, yaw, walkable: false, solid: true });
}

/** A small round lookout tower on the wall (4 m wide, 8 m above the wall top, domed, arched windows). */
function roundLookout(b: ContentBuilder, cx: number, cz: number, compass: number, floor: number, low: boolean): void {
  const r = 2.05, t = 0.36, h = 7.6;
  // Buttress below the wall top (proud of the cliff face), solid.
  b.mesh(wtMat('ice_massive'), new THREE.CylinderGeometry(r, r + 0.25, floor - WC.plain + 1.2, 16, 1), { x: cx, y: (floor + WC.plain - 1.2) / 2, z: cz });
  b.collider({ shape: 'cylinder', x: cx, y: (floor + WC.plain - 1.2) / 2, z: cz, r: r + 0.1, hy: (floor - WC.plain + 1.2) / 2, walkable: true, solid: true, surface: 'packedsnow' });
  // The room: doors where the wall walk passes through (along the ring), windows between.
  // The ring's tangent at compass angle a is (cos a, sin a): the wall walk enters and leaves there.
  const n = 16;
  const doors = [compass, compass + Math.PI];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
    const am = (a0 + a1) / 2;
    const nearDoor = doors.some((d) => Math.abs(Math.atan2(Math.sin(am - d), Math.cos(am - d))) < 0.42);
    if (nearDoor) {
      // Lintel over the doorway.
      arcPiece(b, cx, cz, r - t / 2, t, a0, a1, floor + 2.45, floor + h, false);
      continue;
    }
    const window = i % 4 === 1;
    if (window && !low) {
      arcPiece(b, cx, cz, r - t / 2, t, a0, a1, floor, floor + 1.3, true);
      arcPiece(b, cx, cz, r - t / 2, t, a0, a1, floor + 2.75, floor + h, false);
    } else arcPiece(b, cx, cz, r - t / 2, t, a0, a1, floor, floor + h, true);
  }
  // Arched dark heads over the doorways and windows (outside), a trim band, the dome and a ceiling.
  for (const d of doors) {
    const g = archSlab(1.5, 2.55, 0.12, 6);
    b.mesh(wtMat('ice_trim'), g, { x: cx + Math.cos(d) * (r + 0.02), y: floor, z: cz + Math.sin(d) * (r + 0.02), yaw: Math.PI / 2 - d }, { castShadow: false });
  }
  b.mesh(wtMat('ice_trim'), new THREE.CylinderGeometry(r + 0.1, r + 0.1, 0.35, 18, 1, true), { x: cx, y: floor + h - 0.4, z: cz });
  b.mesh(wtMat('snow'), dome(r + 0.12, 0.9, 16, 7), { x: cx, y: floor + h, z: cz });
  b.mesh(wtMat('ice_trim'), new THREE.CircleGeometry(r - t + 0.02, 16).rotateX(Math.PI / 2), { x: cx, y: floor + h - 0.02, z: cz }, { castShadow: false });
}

/** A square gate tower (6 m wide), its room at the village floor opening onto the gate passage. */
function squareGateTower(b: ContentBuilder, cx: number, cz: number, side: 1 | -1, low: boolean): void {
  const hw = 3, t = 0.45;
  const floor = WC.floor;
  const roomTop = floor + 6.5;
  const top = WC.wallTop + 11;
  const ice = wtMat('ice_massive');
  // Solid base from the plain to the floor, and the solid upper body above the room.
  b.mesh(ice, new THREE.BoxGeometry(hw * 2, floor - WC.plain + 1.2, hw * 2), { x: cx, y: (floor + WC.plain - 1.2) / 2, z: cz });
  b.collider({ shape: 'box', x: cx, y: (floor + WC.plain - 1.2) / 2, z: cz, hx: hw, hy: (floor - WC.plain + 1.2) / 2, hz: hw, walkable: true, solid: true, surface: 'packedsnow' });
  b.mesh(ice, new THREE.BoxGeometry(hw * 2, top - roomTop, hw * 2), { x: cx, y: (top + roomTop) / 2, z: cz });
  b.collider({ shape: 'box', x: cx, y: (top + roomTop) / 2, z: cz, hx: hw, hy: (top - roomTop) / 2, hz: hw, walkable: true, solid: true });
  // Room walls: the side facing the gate passage has the doorway; windows look out north and outward.
  const wallPiece = (x: number, z: number, w: number, d: number, y0: number, y1: number, collide = true) => {
    b.mesh(ice, new THREE.BoxGeometry(w, y1 - y0, d), { x, y: (y0 + y1) / 2, z });
    if (collide) b.collider({ shape: 'box', x, y: (y0 + y1) / 2, z, hx: w / 2, hy: (y1 - y0) / 2, hz: d / 2, walkable: false, solid: true });
  };
  const inX = cx + side * (hw - t / 2); // face toward the passage (x toward the gate centre)
  const outX = cx - side * (hw - t / 2);
  // Passage side: a 1.6 m doorway in the middle.
  wallPiece(inX, cz - 1.8, t, 2.4, floor, roomTop);
  wallPiece(inX, cz + 1.8, t, 2.4, floor, roomTop);
  wallPiece(inX, cz, t, 1.2, floor + 2.5, roomTop, false);
  // Outer side and the north / south sides (window openings on the north and outer sides).
  const win = !low;
  for (const [x, z, w, d, hasWin] of [
    [outX, cz, t, hw * 2, win],
    [cx, cz - (hw - t / 2), hw * 2, t, win],
    [cx, cz + (hw - t / 2), hw * 2, t, false],
  ] as Array<[number, number, number, number, boolean]>) {
    if (hasWin) {
      wallPiece(x, z, w, d, floor, floor + 1.4);
      wallPiece(x, z, w, d, floor + 2.9, roomTop, false);
      // Jambs either side of a 1.4 m window.
      const along = w > d ? 'x' : 'z';
      const half = (along === 'x' ? w : d) / 2;
      for (const s of [-1, 1]) {
        const off = s * (half - (half - 0.7) / 2);
        wallPiece(along === 'x' ? x + off : x, along === 'z' ? z + off : z, along === 'x' ? half - 0.7 : w, along === 'z' ? half - 0.7 : d, floor + 1.4, floor + 2.9, false);
      }
    } else wallPiece(x, z, w, d, floor, roomTop);
  }
  // An ice-trim arch frames the open doorway.
  b.mesh(wtMat('ice_trim'), archSlab(1.9, 2.75, 0.14, 6), { x: inX + side * 0.3, y: floor, z: cz, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 }, { castShadow: false });
  // Trim bands, crenellated crown and a small dome.
  b.mesh(wtMat('ice_trim'), new THREE.BoxGeometry(hw * 2 + 0.3, 0.4, hw * 2 + 0.3), { x: cx, y: WC.wallTop + 0.2, z: cz });
  b.mesh(wtMat('ice_trim'), new THREE.BoxGeometry(hw * 2 + 0.3, 0.5, hw * 2 + 0.3), { x: cx, y: top - 0.25, z: cz });
  b.mesh(wtMat('snow'), dome(hw * 0.95, 0.75, 16, 7), { x: cx, y: top, z: cz });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.mesh(wtMat('ice_massive'), new THREE.BoxGeometry(1, 1.1, 1), { x: cx + dx * (hw - 0.5), y: top + 0.55, z: cz + dz * (hw - 0.5) });
  // Arched windows high on the outer faces (dark recesses).
  for (const [x, z, yaw] of [[cx, cz - hw - 0.03, Math.PI], [cx - side * (hw + 0.03), cz, side > 0 ? -Math.PI / 2 : Math.PI / 2]] as Array<[number, number, number]>) {
    b.mesh(wtMat('dark'), archSlab(1.1, 2, 0.1, 6), { x, y: WC.wallTop + 5.5, z, yaw }, { castShadow: false });
  }
  void WC_GATE;
}
