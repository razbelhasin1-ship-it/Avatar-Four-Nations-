import * as THREE from 'three';
import type { ContentBuilder } from '../../../kit/Builder';
import { crimsonMat, steelDarkMat, steelMat } from '../materials';

/**
 * Fire Nation machines for the capital: tundra tanks (armoured hull on two treads, a ram at the
 * front, a cupola with a flame nozzle) and ballistae (bolt throwers on a turntable). Geometries are
 * built once (local frame: +Z forward, origin on the ground) and merged per material, so many tanks
 * cost a few draw calls; animated tanks (phase 5) reuse the same geometry.
 */

export interface MachineGeo {
  steel: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  red: THREE.BufferGeometry;
}

function boxAt(sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Simple non-indexed merge (position + normal).
  let n = 0;
  const parts = list.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    n += ng.getAttribute('position').count;
    return ng;
  });
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const p = g.getAttribute('position'), q = g.getAttribute('normal');
    pos.set(p.array as Float32Array, o * 3);
    nrm.set(q.array as Float32Array, o * 3);
    o += p.count;
  }
  for (const g of list) g.dispose();
  for (const g of parts) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

let tankCache: MachineGeo | null = null;
/** Tundra tank, ~7.6 m long, 3.6 m wide, 3.3 m tall. */
export function tankGeometry(): MachineGeo {
  if (tankCache) return tankCache;
  const steel: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [], red: THREE.BufferGeometry[] = [];
  // Treads (dark) with wheels showing as discs.
  for (const sx of [-1, 1]) {
    dark.push(boxAt(0.9, 1.0, 7.0, sx * 1.35, 0.55, 0));
    for (let k = -3; k <= 3; k++) {
      const w = new THREE.CylinderGeometry(0.42, 0.42, 0.95, 10);
      w.rotateZ(Math.PI / 2);
      w.translate(sx * 1.35, 0.5, k * 0.95);
      dark.push(w);
    }
  }
  // Hull: lower box, sloped glacis, upper deck.
  steel.push(boxAt(2.6, 1.0, 6.0, 0, 1.45, -0.2));
  steel.push(boxAt(2.6, 0.9, 1.6, 0, 1.4, 3.0, -0.55));
  steel.push(boxAt(3.4, 0.25, 6.6, 0, 2.05, -0.1));
  // Ram / plough at the front.
  dark.push(boxAt(3.2, 0.8, 0.35, 0, 0.75, 3.7, 0.35));
  // Cupola and the flame nozzle.
  steel.push(boxAt(1.6, 0.9, 1.8, 0, 2.6, -0.6));
  const nz = new THREE.CylinderGeometry(0.16, 0.22, 1.8, 8);
  nz.rotateX(Math.PI / 2);
  nz.translate(0, 2.6, 0.9);
  dark.push(nz);
  // Exhaust stacks at the back.
  for (const sx of [-0.8, 0.8]) {
    const c = new THREE.CylinderGeometry(0.16, 0.18, 1.1, 8);
    c.translate(sx, 2.6, -3.0);
    dark.push(c);
  }
  // Crimson armour bands and the side skirts.
  red.push(boxAt(3.45, 0.32, 0.4, 0, 2.05, 2.6));
  for (const sx of [-1, 1]) red.push(boxAt(0.12, 0.5, 6.2, sx * 1.83, 1.55, 0));
  tankCache = { steel: merge(steel), dark: merge(dark), red: merge(red) };
  return tankCache;
}

/** Stamp a parked tank into a builder (instanced per material key). */
export function tank(b: ContentBuilder, x: number, y: number, z: number, yaw: number): void {
  const g = tankGeometry();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  b.instance('fnc_tank_steel', () => g.steel.clone(), steelMat(), m);
  b.instance('fnc_tank_dark', () => g.dark.clone(), steelDarkMat(), m);
  b.instance('fnc_tank_red', () => g.red.clone(), crimsonMat(), m);
  b.collider({ shape: 'box', x, y: y + 1.4, z, hx: 1.8, hy: 1.4, hz: 3.8, yaw, walkable: true, solid: true });
}

let ballistaCache: { wood: THREE.BufferGeometry; iron: THREE.BufferGeometry } | null = null;
/** Ballista on a turntable (bolt thrower), ~3 m. */
export function ballista(b: ContentBuilder, x: number, y: number, z: number, yaw: number): void {
  if (!ballistaCache) {
    const wood: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = [];
    const base = new THREE.CylinderGeometry(1.1, 1.2, 0.4, 12);
    base.translate(0, 0.2, 0);
    iron.push(base);
    wood.push(boxAt(0.5, 1.1, 0.5, 0, 0.95, 0));
    wood.push(boxAt(0.45, 0.4, 3.2, 0, 1.6, 0.4));
    // Bow arms.
    const armL = boxAt(1.8, 0.18, 0.22, -0.9, 1.65, 1.6);
    armL.rotateY(0.35);
    const armR = boxAt(1.8, 0.18, 0.22, 0.9, 1.65, 1.6);
    armR.rotateY(-0.35);
    wood.push(armL, armR);
    // Loaded bolt (harpoon).
    const bolt = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6);
    bolt.rotateX(Math.PI / 2);
    bolt.translate(0, 1.85, 0.7);
    iron.push(bolt);
    const tip = new THREE.ConeGeometry(0.14, 0.45, 6);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 1.85, 2.4);
    iron.push(tip);
    ballistaCache = { wood: merge(wood), iron: merge(iron) };
  }
  const g = ballistaCache;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  b.instance('fnc_ballista_wood', () => g.wood.clone(), 'wood_dark', m);
  b.instance('fnc_ballista_iron', () => g.iron.clone(), 'iron', m);
}
