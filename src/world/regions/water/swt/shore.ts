import * as THREE from 'three';
import { Random } from '../../../../core/Random';
import { heightAt } from '../../../Heightfield';
import type { ContentBuilder } from '../../../kit/Builder';
import { coveE, WC, WC_LANDING, WC_SLED_RUN, WC_WRECK } from '../../../landforms/wolfCove';
import { boulder, crystal, hull } from '../geometry';
import { wtMat, wtWater } from '../materials';
import { dryingRack, type WaterSheets } from '../parts';
import { SWT } from './layout';
import { sled } from './village';

/**
 * Wolf Cove's outskirts: the gravel beach and canoe landing north of the gate (canoes and kayaks
 * drawn up, drying racks, tide pools), the hunting ice on the cove's shore ice (Hunter Akka, the
 * fishing holes), floes and icebergs in the open water (the ice-dodging bay), the Fire Navy ship
 * torn open by jutting ice shelves at the cove's west tip, the penguin sled run down the hill with
 * its ice tunnel, and the tundra to the south (sled tracks, caches, seal breathing holes in the sea
 * ice, low ridges on the horizon).
 */

/** Sea-ice surface (Terrain ICE_TOP over sea level). */
const ICE_Y = 0.1;

export const SHORE = {
  iceY: ICE_Y + 0.06,
  beachY: Math.max(0.6, heightAt(WC_LANDING.x, WC_LANDING.z)),
  /** The hunting ice: a sheet of solid shore ice off the beach (Hunter Akka trains here). */
  akka: { x: 266, z: 1458, r: 13 },
  /** Fishing holes in the hunting ice. */
  holes: [
    { x: 257, z: 1452, r: 1.2 },
    { x: 276, z: 1455, r: 1.1 },
    { x: 266, z: 1446, r: 1.25 },
  ],
  penguins: { x: 116, z: 1478, y: Math.max(0.6, heightAt(116, 1478)) },
} as const;

/** Region hooks the shore needs (water sources go through the region so they unregister on dispose). */
export interface ShoreHost {
  addWater(def: { id: string; type: 'pond' | 'ice' | 'fountain'; label: string; x: number; y: number; z: number; r: number; capacity: number; regen: number; frozen?: boolean; size?: 'small' | 'medium' | 'large' }): void;
}

const mat4 = (x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx, pitch = 0, roll = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz));

export function buildShore(host: ShoreHost, b: ContentBuilder, props: ContentBuilder, sheets: WaterSheets, low: boolean): void {
  const rnd = new Random(SWT.seed + 41);
  beach(b, props, sheets, rnd);
  huntingIce(host, b, props, sheets);
  bay(b, props, rnd, low);
  shipwreck(b, props, rnd);
  sledRun(b, props, rnd);
  tundra(b, props, sheets, rnd, low);
}

function beach(b: ContentBuilder, props: ContentBuilder, sheets: WaterSheets, rnd: Random): void {
  const L = WC_LANDING;
  const gy = (x: number, z: number) => heightAt(x, z);
  // Canoes and kayaks drawn up above the waterline, bows to the sea; paddles; a skin boat on its side.
  for (let i = 0; i < 6; i++) {
    const x = L.x - 14 + i * 5.2 + (rnd.next() - 0.5) * 1.5, z = L.z + 5 + (rnd.next() - 0.5) * 2;
    const yaw = Math.PI + (rnd.next() - 0.5) * 0.5;
    const kayak = i % 3 === 2;
    const g = kayak ? hull(4.3, 0.6, 0.38) : hull(5.4, 1.05, 0.55);
    b.mesh(wtMat(i % 2 ? 'hide_dark' : 'hide'), g, { x, y: gy(x, z) + 0.1, z, yaw });
    b.collider({ shape: 'box', x, y: gy(x, z) + 0.35, z, hx: kayak ? 0.35 : 0.55, hy: 0.35, hz: kayak ? 2.1 : 2.7, yaw, walkable: true, solid: true });
    if (!kayak) props.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.03, 0.03, 2, 4).rotateZ(Math.PI / 2 - 0.2), { x: x + 0.9, y: gy(x, z) + 0.2, z, yaw });
  }
  // Drying racks and a whalebone arch over the path down from the gate ramp.
  dryingRack(b, L.x - 22, gy(L.x - 22, L.z + 12), L.z + 12, 0.2, 3.6);
  dryingRack(b, L.x + 18, gy(L.x + 18, L.z + 13), L.z + 13, -0.25, 3.6);
  const ax = WC.x, az = L.z + 22;
  for (const s of [-1, 1]) {
    const rib = new THREE.TorusGeometry(2.8, 0.22, 6, 14, Math.PI * 0.62).rotateZ(Math.PI * 0.19 + (s > 0 ? Math.PI * 0.0 : 0));
    b.mesh(wtMat('bone'), rib, { x: ax + s * 0.2, y: gy(ax, az) - 0.4, z: az, yaw: Math.PI / 2 + (s > 0 ? Math.PI : 0) });
  }
  // Tide pools: little pockets of sea water left in the gravel.
  for (let i = 0; i < 5; i++) {
    const x = L.x - 30 + i * 13 + (rnd.next() - 0.5) * 4;
    const z = L.z - 2 + rnd.next() * 3;
    if (coveE(x, z) < 1.0) continue;
    const r = 0.8 + rnd.next() * 0.9;
    sheets.disc(wtWater('pool'), x, z, r, gy(x, z) + 0.05, 14);
    b.mesh(wtMat('rock_dark'), boulder(i + 201, r * 0.6, 0.25, r * 0.4, 0), { x: x + r, y: gy(x, z), z });
  }
}

function huntingIce(host: ShoreHost, b: ContentBuilder, props: ContentBuilder, sheets: WaterSheets): void {
  const A = SHORE.akka;
  // A solid sheet of shore ice (bevelled extrusion) with the fishing holes cut through it.
  const shape = new THREE.Shape();
  shape.absarc(0, 0, A.r, 0, Math.PI * 2, false);
  for (const h of SHORE.holes) {
    const hole = new THREE.Path();
    hole.absarc(h.x - A.x, -(h.z - A.z), h.r, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const depth = 0.5;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.7, bevelThickness: 0.12, bevelSegments: 2, curveSegments: 40 });
  geo.rotateX(-Math.PI / 2);
  b.mesh(wtMat('ice_clear'), geo, { x: A.x, y: SHORE.iceY - depth - 0.12, z: A.z }, { castShadow: false });
  b.collider({ shape: 'cylinder', x: A.x, y: SHORE.iceY - 0.4, z: A.z, r: A.r, hy: 0.4, walkable: true, solid: false, surface: 'ice' });
  SHORE.holes.forEach((h, i) => {
    sheets.disc(wtWater('pond'), h.x, h.z, h.r + 0.05, SHORE.iceY - 0.3, 18);
    b.mesh(wtMat('canal_bed'), new THREE.CircleGeometry(h.r + 0.1, 16).rotateX(-Math.PI / 2), { x: h.x, y: SHORE.iceY - 1.1, z: h.z }, { castShadow: false });
    host.addWater({ id: `swt:fishing_hole_${i}`, type: 'pond', label: 'Fishing Hole', x: h.x, y: SHORE.iceY - 0.3, z: h.z, r: h.r, capacity: 90, regen: 5, size: 'small' });
    // A fishing pole and a little windbreak of snow blocks beside each hole.
    props.instance('swt_fishing_pole', () => new THREE.CylinderGeometry(0.03, 0.04, 2.4, 5).rotateZ(0.9).translate(0.6, 0.9, 0), wtMat('wood'), new THREE.Matrix4().makeTranslation(h.x + h.r + 0.4, SHORE.iceY, h.z));
    b.mesh(wtMat('snow'), new THREE.BoxGeometry(1.6, 0.6, 0.4), { x: h.x, y: SHORE.iceY + 0.3, z: h.z + h.r + 0.9 });
  });
  host.addWater({ id: 'swt:sea_ice', type: 'ice', label: 'Sea Ice', x: A.x, y: SHORE.iceY, z: A.z, r: A.r, capacity: 400, regen: 6, frozen: true, size: 'large' });
}

function bay(b: ContentBuilder, props: ContentBuilder, rnd: Random, low: boolean): void {
  // Icebergs in the open water (the ice-dodging bay), and flat floes drifting at the ice edge.
  const bergs = low ? 6 : 10;
  let placed = 0;
  for (let i = 0; i < 80 && placed < bergs; i++) {
    const x = 250 + rnd.next() * 260, z = 1340 + rnd.next() * 90;
    if (coveE(x, z) > 0.62 || heightAt(x, z) > -3.5) continue;
    const s = 3 + rnd.next() * 5;
    const h = s * (1 + rnd.next() * 1.3);
    b.mesh(wtMat(rnd.next() < 0.5 ? 'ice_massive' : 'ice_clear'), crystal(s, h, 0.2 + rnd.next() * 0.25), { x, y: -h * 0.18, z, yaw: rnd.next() * 6 });
    b.mesh(wtMat('snow'), boulder(i + 301, s * 0.9, s * 0.35, s * 0.7, 1), { x: x + s * 0.4, y: -0.6, z: z + s * 0.2, yaw: rnd.next() * 6 });
    b.collider({ shape: 'cylinder', x, y: h / 2 - 1, z, r: s * 0.75, hy: h / 2 + 1, walkable: false, solid: true });
    placed++;
  }
  for (let i = 0; i < (low ? 14 : 30); i++) {
    const x = 170 + rnd.next() * 360, z = 1330 + rnd.next() * 120;
    const e = coveE(x, z);
    if (e > 0.85 || e < 0.25) continue;
    const r = 1.2 + rnd.next() * 2.6;
    props.instance('swt_floe', () => new THREE.CylinderGeometry(1, 1.05, 0.35, 7).translate(0, -0.05, 0), wtMat('ice_clear'), mat4(x, 0.05, z, rnd.next() * 6, r, 1, r * (0.6 + rnd.next() * 0.4)), false);
  }
}

function shipwreck(b: ContentBuilder, props: ContentBuilder, rnd: Random): void {
  const W = WC_WRECK;
  const rust = new THREE.MeshStandardMaterial({ color: '#5b3527', roughness: 0.82, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2422', roughness: 0.7, metalness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: '#7a1e14', roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const cy = Math.cos(W.yaw), sy = Math.sin(W.yaw);
  const at = (along: number, side: number) => ({ x: W.x + sy * along + cy * side, z: W.z + cy * along - sy * side });
  const base = 0.1 - 1.4; // the hull sits sunk in the shore ice
  // Two halves split by the ice shelf that tore the ship open; each tilted a little.
  const halves: Array<{ along: number; len: number; roll: number; pitch: number; yawOff: number }> = [
    { along: -10, len: 20, roll: 0.13, pitch: 0.04, yawOff: 0.05 },
    { along: 11.5, len: 18, roll: -0.09, pitch: -0.07, yawOff: -0.12 },
  ];
  halves.forEach((hf, i) => {
    const p = at(hf.along, 0);
    const yaw = W.yaw + hf.yawOff;
    const g = hull(hf.len * 1.85, 8, 5.8);
    // Keep the half nearest the break: clip with a box by scaling (crude: the bow / stern half).
    g.scale(1, 1, 0.54);
    b.mesh(rust, g, { x: p.x, y: base + 2.8, z: p.z, yaw: yaw + (i ? 0 : Math.PI), pitch: hf.pitch, roll: hf.roll });
    // Deck plates and a raised superstructure on the stern half, the funnel.
    b.mesh(dark, new THREE.BoxGeometry(7.2, 0.25, hf.len - 1.5), { x: p.x, y: base + 5.4, z: p.z, yaw, pitch: hf.pitch, roll: hf.roll });
    b.collider({ shape: 'box', x: p.x, y: base + 5.1, z: p.z, hx: 3.4, hy: 0.4, hz: hf.len / 2 - 0.8, yaw, walkable: true, solid: true, surface: 'stone' });
    b.collider({ shape: 'box', x: p.x, y: base + 2.4, z: p.z, hx: 3.8, hy: 2.4, hz: hf.len / 2 - 0.5, yaw, walkable: false, solid: true });
    if (i === 0) {
      const s = at(hf.along - 4, 0);
      b.mesh(rust, new THREE.BoxGeometry(5.6, 3.6, 6), { x: s.x, y: base + 7.3, z: s.z, yaw, roll: hf.roll * 0.8 });
      b.collider({ shape: 'box', x: s.x, y: base + 7.3, z: s.z, hx: 2.8, hy: 1.8, hz: 3, yaw, walkable: true, solid: true });
      const f = at(hf.along - 1, 0.4);
      b.mesh(dark, new THREE.CylinderGeometry(0.95, 1.05, 6, 12), { x: f.x, y: base + 11.5, z: f.z, roll: hf.roll * 1.4 });
      // A torn red banner on a bent mast.
      const m = at(hf.along + 4, -1);
      b.mesh(dark, new THREE.CylinderGeometry(0.12, 0.15, 8, 6), { x: m.x, y: base + 9, z: m.z, roll: 0.35 });
      props.mesh(red, new THREE.PlaneGeometry(1.6, 1.1), { x: m.x + 0.9, y: base + 12, z: m.z, yaw: W.yaw + 1.2, roll: 0.3 });
    }
    // Rust streaks and portholes along the sides.
    for (let k = 0; k < 5; k++) {
      for (const sd of [-1, 1]) {
        const ph = at(hf.along - hf.len / 2 + 2 + k * (hf.len - 4) / 4, sd * 4.05);
        props.mesh(dark, new THREE.CircleGeometry(0.3, 8), { x: ph.x, y: base + 3.9 + sd * hf.roll * 4, z: ph.z, yaw: yaw + (sd > 0 ? Math.PI / 2 : -Math.PI / 2) });
      }
    }
  });
  // The jutting ice shelves through the break (one slopes up to the deck: the way aboard).
  for (let k = 0; k < 5; k++) {
    const p = at(0.8 + (rnd.next() - 0.5) * 3, (k - 2) * 2.2);
    const h = 6 + rnd.next() * 5;
    b.mesh(wtMat('ice_massive'), new THREE.BoxGeometry(2.2 + rnd.next() * 1.5, h, 1.2 + rnd.next()), { x: p.x, y: base + h / 2 - 0.5, z: p.z, yaw: W.yaw + 0.3 + (rnd.next() - 0.5) * 0.6, pitch: (rnd.next() - 0.5) * 0.5, roll: (rnd.next() - 0.5) * 0.4 });
  }
  const ramp = at(-10, 6.5);
  const rampTop = at(-10, 3.2);
  b.mesh(wtMat('ice_massive'), new THREE.BoxGeometry(2.4, 0.6, 7.6), { x: (ramp.x + rampTop.x) / 2, y: base + 3.2, z: (ramp.z + rampTop.z) / 2, yaw: W.yaw + Math.PI / 2, pitch: -0.62 });
  b.stairs({ from: new THREE.Vector3(ramp.x + cy * 3.5, 0.15, ramp.z - sy * 3.5), to: new THREE.Vector3(rampTop.x, base + 5.3, rampTop.z), width: 2.2, material: wtMat('ice_trim'), stepHeight: 0.32, surface: 'ice' });
}

function sledRun(b: ContentBuilder, props: ContentBuilder, rnd: Random): void {
  // A glassy track grooved into the hill's north slope, banked with snow, down to the shore ice.
  const pts = WC_SLED_RUN;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const n = Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 3);
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = a.x + (c.x - a.x) * t0, z0 = a.z + (c.z - a.z) * t0;
      const x1 = a.x + (c.x - a.x) * t1, z1 = a.z + (c.z - a.z) * t1;
      const y0 = heightAt(x0, z0), y1 = heightAt(x1, z1);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      const pitch = -Math.atan2(y1 - y0, len);
      b.mesh(wtMat('ice_clear'), new THREE.BoxGeometry(2.2, 0.12, len + 0.25), { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 0.04, z: (z0 + z1) / 2, yaw, pitch }, { castShadow: false });
      for (const s of [-1, 1]) props.mesh(wtMat('snow'), new THREE.BoxGeometry(0.6, 0.45, len + 0.3), { x: (x0 + x1) / 2 + Math.cos(yaw) * s * 1.4, y: (y0 + y1) / 2 + 0.12, z: (z0 + z1) / 2 - Math.sin(yaw) * s * 1.4, yaw, pitch });
    }
  }
  // The ice tunnel near the bottom: arches of clear ice over the track.
  const t0 = pts[2], t1 = pts[3];
  const tunnelN = 7;
  for (let k = 0; k < tunnelN; k++) {
    const t = (k + 0.5) / tunnelN;
    const x = t0.x + (t1.x - t0.x) * t, z = t0.z + (t1.z - t0.z) * t;
    const yaw = Math.atan2(t1.x - t0.x, t1.z - t0.z);
    const arch = new THREE.CylinderGeometry(2.1, 2.1, 5.2, 14, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
    b.mesh(wtMat(k % 2 ? 'ice_clear' : 'ice_massive'), arch, { x, y: heightAt(x, z) + 0.4, z, yaw }, { castShadow: k % 2 === 0 });
    for (const s of [-1, 1]) b.collider({ shape: 'box', x: x + Math.cos(yaw) * s * 2.1, y: heightAt(x, z) + 1.4, z: z - Math.sin(yaw) * s * 2.1, hx: 0.25, hy: 1.4, hz: 2.7, yaw, walkable: false, solid: true });
  }
  // Sleds left at the top of the run.
  const top = pts[0];
  sled(b, top.x + 3, top.z + 3, 0.3, heightAt(top.x + 3, top.z + 3));
  void rnd;
}

function tundra(b: ContentBuilder, props: ContentBuilder, sheets: WaterSheets, rnd: Random, low: boolean): void {
  // Sled tracks running out across the plain, caches marked by poles, breathing holes in the sea ice.
  for (let t = 0; t < 3; t++) {
    let x = WC.x - 40 + t * 40, z = WC.z + WC.R + 10;
    let yaw = (rnd.next() - 0.5) * 0.6;
    for (let k = 0; k < 18; k++) {
      const nx = x + Math.sin(yaw) * 6, nz = z + Math.cos(yaw) * 6;
      for (const s of [-1, 1]) props.mesh(wtMat('paving'), new THREE.PlaneGeometry(0.16, 6.1).rotateX(-Math.PI / 2), { x: (x + nx) / 2 + Math.cos(yaw) * s * 0.35, y: heightAt((x + nx) / 2, (z + nz) / 2) + 0.03, z: (z + nz) / 2 - Math.sin(yaw) * s * 0.35, yaw }, { castShadow: false });
      x = nx;
      z = nz;
      yaw += (rnd.next() - 0.5) * 0.25;
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = WC.x - 120 + rnd.next() * 240, z = WC.z + WC.R + 25 + rnd.next() * 90;
    const y = heightAt(x, z);
    if (y < 1) continue;
    b.mesh(wtMat('snow'), new THREE.SphereGeometry(1.3, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), { x, y: y - 0.1, z });
    b.mesh(wtMat('wood'), new THREE.CylinderGeometry(0.04, 0.05, 2.2, 5), { x, y: y + 1.2, z });
    props.mesh(wtMat('hide'), new THREE.PlaneGeometry(0.4, 0.3), { x: x + 0.2, y: y + 2.1, z });
  }
  // Seal breathing holes in the polar sea ice south of the coast.
  let holes = 0;
  for (let i = 0; i < 60 && holes < (low ? 4 : 8); i++) {
    const x = WC.x - 160 + rnd.next() * 320, z = 1880 + rnd.next() * 50;
    const h = heightAt(x, z);
    if (h > -0.6 || h < -3) continue;
    sheets.disc(wtWater('pond'), x, z, 0.55, ICE_Y - 0.08, 12);
    b.mesh(wtMat('snow'), new THREE.TorusGeometry(0.7, 0.2, 4, 12).rotateX(Math.PI / 2).scale(1, 1, 0.5), { x, y: ICE_Y + 0.05, z }, { castShadow: false });
    holes++;
  }
  // Low ridges and mountains on the southern horizon (far silhouettes, beyond the sea ice).
  const ridge = new THREE.MeshStandardMaterial({ color: '#e3ecf6', roughness: 0.95, flatShading: true });
  for (let i = 0; i < (low ? 5 : 9); i++) {
    const x = WC.x - 700 + i * 170 + (rnd.next() - 0.5) * 80;
    const z = 2420 + rnd.next() * 260;
    const h = 40 + rnd.next() * 70;
    const g = new THREE.ConeGeometry(110 + rnd.next() * 90, h, 6 + Math.floor(rnd.next() * 3), 2);
    g.scale(1.6, 1, 0.7);
    b.mesh(ridge, g, { x, y: h / 2 - 6, z, yaw: rnd.next() * 0.6 }, { castShadow: false });
  }
}
