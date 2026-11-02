import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import type { ContentBuilder } from '../../../kit/Builder';
import { boulder, pillow, tentCone } from '../geometry';
import { wtMat } from '../materials';
import { barrel } from '../parts';
import { FLOOR, GREAT, SWT } from './layout';
import type { VillageInfo } from './village';

/**
 * Furnishing of Wolf Cove's enterable igloos (warm firelight comes from WolfCove's interior light):
 *  - the Great Igloo: the Council of Elders' hall — a central hearth, a ring of seats with pelts,
 *    the elders' platform opposite the entrance, ceremonial headdresses, spears and skins on the walls
 *  - the healer's igloo: a low fire, a bed of furs, the healing basin, herbs drying overhead
 *  - the workshop: benches of bone and whale-tooth carving, a kayak frame, tools and spears
 *  - the family igloo kit (several homes): pelts on a bamboo floor, a sealskin sleeping tent at one
 *    end, a square fire pit ringed by one line of bricks with mats on all four sides and a stew post
 *    hanging over the fire, a headdress, spears and skins on the walls
 */

type Interior = VillageInfo['interiors'][number];

/** Point on the inner wall at height y above the floor, at local angle a (0 = toward +X, local). */
function wallPoint(it: Interior, h: number, a: number, y: number, inset = 0.42): { x: number; z: number; yaw: number } {
  const ri = it.r - 0.32;
  const rr = ri * Math.sqrt(Math.max(0, 1 - (y / (h - 0.3)) ** 2)) - inset;
  // Local frame of the dome: entrance along local +Z rotated by it.yaw.
  const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
  const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
  const x = it.x + lx * c + lz * s, z = it.z - lx * s + lz * c;
  return { x, z, yaw: Math.atan2(it.x - x, it.z - z) };
}

/** World point from the dome's local frame (entrance toward local +Z). */
function local(it: Interior, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
  return { x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c };
}

export function furnishInteriors(b: ContentBuilder, props: ContentBuilder, info: VillageInfo, low: boolean): void {
  const rnd = new Random(SWT.seed + 31);
  for (const it of info.interiors) {
    if (it.kind === 'great') greatHall(b, props, it, info, rnd);
    else if (it.kind === 'healer') healer(b, props, it, info, rnd);
    else if (it.kind === 'workshop') workshop(b, props, it, info, rnd);
    else familyHome(b, props, it, info, rnd, low);
  }
}

/** A ceremonial headdress on the wall: a fan of white feathers (or bone) on a band. */
function headdress(props: ContentBuilder, x: number, y: number, z: number, yaw: number): void {
  props.mesh(wtMat('hide_dark'), new THREE.TorusGeometry(0.22, 0.04, 4, 10, Math.PI), { x, y, z, yaw });
  for (let k = 0; k < 7; k++) {
    const a = -0.9 + (k / 6) * 1.8;
    const f = new THREE.ConeGeometry(0.05, 0.42, 4).translate(0, 0.21, 0).rotateZ(-a);
    props.mesh(wtMat(k % 2 ? 'fur' : 'bone'), f, { x, y: y + 0.12, z, yaw });
  }
}

/** Crossed spears and a stretched skin on the wall. */
function wallTrophy(props: ContentBuilder, x: number, y: number, z: number, yaw: number, skin: boolean): void {
  for (const s of [-1, 1]) props.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.025, 0.025, 1.7, 4).rotateZ(s * 0.55), { x, y, z, yaw });
  for (const s of [-1, 1]) props.mesh(wtMat('bone'), new THREE.ConeGeometry(0.05, 0.22, 4).translate(0, 0.95, 0).rotateZ(s * 0.55), { x, y, z, yaw });
  if (skin) props.mesh(wtMat('hide'), new THREE.CircleGeometry(0.45, 7), { x, y: y - 0.05, z, yaw });
}

function greatHall(b: ContentBuilder, props: ContentBuilder, it: Interior, info: VillageInfo, rnd: Random): void {
  const y = FLOOR;
  // Pelts covering the floor.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    props.mesh(wtMat(i % 2 ? 'fur' : 'hide'), new THREE.CircleGeometry(1.1 + rnd.next() * 0.4, 7).rotateX(-Math.PI / 2), { x: it.x + Math.cos(a) * 3.3, y: y + 0.02 + i * 0.001, z: it.z + Math.sin(a) * 3.3, yaw: rnd.next() * 3 });
  }
  // The central hearth: a ring of stones, the fire, a smoke hole's draught.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.mesh(wtMat('rock_dark'), boulder(i + 61, 0.26, 0.2, 0.24, 0), { x: it.x + Math.cos(a) * 1.1, y: y + 0.07, z: it.z + Math.sin(a) * 1.1 });
  }
  b.collider({ shape: 'cylinder', x: it.x, y: y + 0.2, z: it.z, r: 1.3, hy: 0.2, walkable: true, solid: true, surface: 'stone' });
  info.fires.push({ x: it.x, y: y + 0.15, z: it.z, big: true });
  // A ring of seats: snow benches with pelts, a gap toward the entrance.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const p = local(it, Math.cos(a) * 4.6, Math.sin(a) * 4.6);
    if (Math.abs(Math.atan2(Math.cos(a), Math.sin(a))) < 0.4) continue; // the aisle from the tunnel
    const yaw = Math.atan2(it.x - p.x, it.z - p.z);
    b.mesh(wtMat('snow'), pillow(1.3, 0.6, 0.45, 0.16, 2), { x: p.x, y, z: p.z, yaw: yaw + Math.PI / 2 });
    props.mesh(wtMat(i % 3 ? 'fur' : 'hide'), pillow(1.1, 0.55, 0.07, 0.05, 1), { x: p.x, y: y + 0.45, z: p.z, yaw: yaw + Math.PI / 2 });
    info.seats.push({ x: p.x, z: p.z, yaw });
  }
  // The elders' platform opposite the entrance.
  const plat = local(it, 0, -5.6);
  b.mesh(wtMat('snow'), pillow(3.6, 1.4, 0.6, 0.2, 2), { x: plat.x, y, z: plat.z, yaw: it.yaw });
  props.mesh(wtMat('fur'), pillow(3.2, 1.1, 0.08, 0.05, 1), { x: plat.x, y: y + 0.6, z: plat.z, yaw: it.yaw });
  b.collider({ shape: 'box', x: plat.x, y: y + 0.3, z: plat.z, hx: 1.8, hy: 0.3, hz: 0.7, yaw: it.yaw, walkable: true, solid: true });
  // Headdresses, spears and skins round the walls; banners either side of the platform.
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i - 4.5) * 0.48;
    const w = wallPoint(it, GREAT.h, a, 2.1);
    if (i % 3 === 0) headdress(props, w.x, y + 2.2, w.z, w.yaw);
    else wallTrophy(props, w.x, y + 2, w.z, w.yaw, i % 3 === 1);
  }
}

function healer(b: ContentBuilder, props: ContentBuilder, it: Interior, info: VillageInfo, rnd: Random): void {
  const y = FLOOR;
  const h = it.r * 1.0;
  // A low fire, a bed of furs, the healing basin of clear water, bundles of herbs hanging overhead.
  const fire = local(it, 0, 0.4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.mesh(wtMat('rock_dark'), boulder(i + 81, 0.14, 0.11, 0.13, 0), { x: fire.x + Math.cos(a) * 0.55, y: y + 0.05, z: fire.z + Math.sin(a) * 0.55 });
  }
  info.fires.push({ x: fire.x, y: y + 0.08, z: fire.z, big: false });
  const bed = local(it, 0, -it.r + 1.4);
  b.mesh(wtMat('snow'), pillow(2.2, 1.1, 0.4, 0.15, 2), { x: bed.x, y, z: bed.z, yaw: it.yaw + Math.PI / 2 });
  props.mesh(wtMat('fur'), pillow(2, 1, 0.12, 0.06, 1), { x: bed.x, y: y + 0.4, z: bed.z, yaw: it.yaw + Math.PI / 2 });
  b.collider({ shape: 'box', x: bed.x, y: y + 0.2, z: bed.z, hx: 1.1, hy: 0.2, hz: 0.55, yaw: it.yaw + Math.PI / 2, walkable: true, solid: true });
  const basin = local(it, it.r - 1.2, -0.6);
  b.mesh(wtMat('ice_trim'), new THREE.CylinderGeometry(0.45, 0.38, 0.5, 14), { x: basin.x, y: y + 0.25, z: basin.z });
  props.mesh(wtMat('ice_clear'), new THREE.CircleGeometry(0.4, 14).rotateX(-Math.PI / 2), { x: basin.x, y: y + 0.47, z: basin.z }, { castShadow: false });
  for (let k = 0; k < 6; k++) {
    const w = wallPoint(it, h, (k / 6) * Math.PI * 2 + 0.3, 1.9, 0.7);
    props.mesh(wtMat(k % 2 ? 'leaf' : 'grass'), new THREE.ConeGeometry(0.1, 0.45, 5).rotateX(Math.PI), { x: w.x, y: y + 1.9, z: w.z });
  }
  void rnd;
}

function workshop(b: ContentBuilder, props: ContentBuilder, it: Interior, info: VillageInfo, rnd: Random): void {
  const y = FLOOR;
  const h = it.r * 0.98;
  // A bench of bone and whale-tooth carvings, a kayak frame on trestles, tools and spears on the walls.
  const bench = local(it, -it.r + 1.4, -0.4);
  b.mesh(wtMat('wood'), new THREE.BoxGeometry(0.8, 0.75, 2.2), { x: bench.x, y: y + 0.38, z: bench.z, yaw: it.yaw });
  b.collider({ shape: 'box', x: bench.x, y: y + 0.38, z: bench.z, hx: 0.4, hy: 0.38, hz: 1.1, yaw: it.yaw, walkable: true, solid: true });
  for (let k = 0; k < 6; k++) props.mesh(wtMat('bone'), new THREE.CylinderGeometry(0.03, 0.06, 0.3 + rnd.next() * 0.25, 5).rotateZ(Math.PI / 2), { x: bench.x, y: y + 0.8, z: bench.z - 0.8 + k * 0.32, yaw: rnd.next() * 3 });
  const frame = local(it, 0.8, -0.6);
  for (let k = 0; k < 7; k++) {
    props.mesh(wtMat('bone'), new THREE.TorusGeometry(0.3, 0.03, 4, 8, Math.PI), { x: frame.x, y: y + 0.85, z: frame.z, yaw: it.yaw + Math.PI / 2 });
  }
  props.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.03, 0.03, 3.4, 4).rotateX(Math.PI / 2), { x: frame.x, y: y + 0.85, z: frame.z, yaw: it.yaw + Math.PI / 2 });
  barrel(b, local(it, it.r - 1.3, 0.6).x, y, local(it, it.r - 1.3, 0.6).z, 0.9);
  for (let i = 0; i < 4; i++) {
    const w = wallPoint(it, h, Math.PI + (i - 1.5) * 0.6, 1.6);
    wallTrophy(props, w.x, y + 1.6, w.z, w.yaw, i % 2 === 0);
  }
  info.fires.push({ x: local(it, 0.6, 1.2).x, y: y + 0.06, z: local(it, 0.6, 1.2).z, big: false });
}

function familyHome(b: ContentBuilder, props: ContentBuilder, it: Interior, info: VillageInfo, rnd: Random, low: boolean): void {
  const y = FLOOR;
  const h = it.r * 1.0;
  // Bamboo floor (slats) under the pelts.
  props.mesh(wtMat('wood'), new THREE.CircleGeometry(it.r - 0.5, 16).rotateX(-Math.PI / 2), { x: it.x, y: y + 0.015, z: it.z }, { castShadow: false });
  if (!low) {
    for (let k = -3; k <= 3; k++) {
      const p = local(it, k * 0.5, 0);
      props.mesh(wtMat('hide_dark'), new THREE.BoxGeometry(0.03, 0.01, (it.r - 0.6) * 2), { x: p.x, y: y + 0.022, z: p.z, yaw: it.yaw });
    }
  }
  for (let i = 0; i < 3; i++) {
    const p = local(it, (i - 1) * 1.1, -0.2 + (i % 2) * 0.6);
    props.mesh(wtMat(i % 2 ? 'fur' : 'hide'), new THREE.CircleGeometry(0.75, 7).rotateX(-Math.PI / 2), { x: p.x, y: y + 0.03 + i * 0.002, z: p.z, yaw: rnd.next() * 3 });
  }
  // The square fire pit: one line of bricks, mats on all four sides, the stew post over the fire.
  const fp = local(it, 0, 0.3);
  for (let i = 0; i < 4; i++) {
    const a = it.yaw + (i * Math.PI) / 2;
    const ox = Math.sin(a) * 0.5, oz = Math.cos(a) * 0.5;
    b.mesh(wtMat('rock_dark'), new THREE.BoxGeometry(1.1, 0.16, 0.16), { x: fp.x + ox, y: y + 0.08, z: fp.z + oz, yaw: a });
    props.mesh(wtMat(i % 2 ? 'fur' : 'hide'), pillow(0.95, 0.6, 0.06, 0.04, 1), { x: fp.x + ox * 2.3, y: y + 0.03, z: fp.z + oz * 2.3, yaw: a });
    info.seats.push({ x: fp.x + ox * 2.3, z: fp.z + oz * 2.3, yaw: a + Math.PI });
  }
  b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.04, 0.05, 1.7, 5).rotateZ(0.5), { x: fp.x - 0.65, y: y + 0.75, z: fp.z, yaw: it.yaw });
  b.mesh(wtMat('rock_dark'), new THREE.SphereGeometry(0.18, 8, 5, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7), { x: fp.x - 0.05, y: y + 0.85, z: fp.z });
  info.fires.push({ x: fp.x, y: y + 0.05, z: fp.z, big: false });
  // A sealskin sleeping tent at the far end.
  const st = local(it, 0, -it.r + 1.2);
  props.mesh(wtMat('hide'), tentCone(0.95, 1.5, 7), { x: st.x, y, z: st.z, yaw: it.yaw });
  // Headdress, spears and skins on the walls.
  const hw = wallPoint(it, h, -Math.PI * 0.15, 1.5);
  headdress(props, hw.x, y + 1.55, hw.z, hw.yaw);
  const tw = wallPoint(it, h, Math.PI * 1.15, 1.4);
  wallTrophy(props, tw.x, y + 1.35, tw.z, tw.yaw, true);
}
