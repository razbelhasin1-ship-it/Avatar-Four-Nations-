import * as THREE from 'three';
import type { SurfaceType } from '../../../core/types';
import { heightAt } from '../../Heightfield';
import type { ContentBuilder } from '../../kit/Builder';
import type { Detail } from './agnaBuildings';
import { mergeParts } from './geometry';
import { wtMat, type WTMaterialName } from './materials';
import { PODIUM_BOTTOM } from './nwtLayout';
import { V } from './parts';

/** Shared Agna Qel'a construction pieces: podium blocks, stair flights, tapered tubes, lantern pillars. */

/** Solid ice block from below the terrain up to `top`, a flat surface on top and a walkable collider. */
export function block(cb: ContentBuilder, x0: number, z0: number, x1: number, z1: number, top: number, surfaceMat: WTMaterialName = 'paving', surface: SurfaceType = 'packedsnow', bottomMax = PODIUM_BOTTOM): void {
  const w = x1 - x0, d = z1 - z0;
  if (w < 0.05 || d < 0.05) return;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let low = Infinity;
  const nx = Math.max(1, Math.ceil(w / 8)), nz = Math.max(1, Math.ceil(d / 8));
  for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) low = Math.min(low, heightAt(x0 + (w * a) / nx, z0 + (d * b) / nz));
  const bottom = Math.min(bottomMax, low - 0.6);
  cb.box(wtMat('ice_massive'), { x: cx, y: (top + bottom) / 2, z: cz, sx: w, sy: top - bottom, sz: d });
  const q = new THREE.PlaneGeometry(w, d);
  q.rotateX(-Math.PI / 2);
  cb.mesh(wtMat(surfaceMat), q, { x: cx, y: top + 0.02, z: cz }, { castShadow: false });
  q.dispose();
  cb.collider({ shape: 'box', x: cx, y: (top + bottom) / 2, z: cz, hx: w / 2, hy: (top - bottom) / 2, hz: d / 2, walkable: true, solid: true, surface });
}

/**
 * Straight flight along Z from (x, y0, z0) up to (x, y1, z1) with a walkable
 * ramp collider; optional stepped cheek walls (solid, matching their visuals)
 * inside the footprint.
 */
export function stairFlight(cb: ContentBuilder, x: number, z0: number, z1: number, y0: number, y1: number, width: number, cheeks: boolean): void {
  cb.stairs({ from: V(x, y0, z0), to: V(x, y1, z1), width: cheeks ? width - 1.0 : width, material: wtMat('ice_trim'), stepHeight: 0.25, surface: 'ice' });
  if (!cheeks) return;
  const run = Math.abs(z1 - z0), rise = y1 - y0;
  const n = Math.max(4, Math.round(run / 2.5));
  for (const s of [-1, 1]) {
    const cx = x + s * (width / 2 - 0.25);
    for (let k = 0; k < n; k++) {
      const za = z0 + ((z1 - z0) * k) / n, zb = z0 + ((z1 - z0) * (k + 1)) / n;
      const top = y0 + (rise * (k + 1)) / n + 0.85;
      cb.box(wtMat('ice_wall'), { x: cx, y: (y0 + top) / 2, z: (za + zb) / 2, sx: 0.5, sy: top - y0, sz: Math.abs(zb - za) + 0.02 }, { collide: true, walkable: false, surface: 'ice' });
    }
  }
}

/** Tube swept along a curve with a radius tapering from r0 to r1 (tusks, horns, curled ornaments). */
export function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, segs = 14, radial = 8): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segs, false);
  const P: number[] = [], I: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a) * r, s = Math.sin(a) * r;
      P.push(p.x + N.x * c + B.x * s, p.y + N.y * c + B.y * s, p.z + N.z * c + B.z * s);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
      I.push(a, b, c, b, d, c);
    }
  }
  // Tip cap.
  const tip = P.length / 3;
  curve.getPointAt(1, p);
  P.push(p.x, p.y, p.z);
  for (let j = 0; j < radial; j++) I.push(segs * radial + j, segs * radial + ((j + 1) % radial), tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/**
 * Lantern pillar along quays and plazas: a carved ice post with a glowing
 * lantern under a small domed cap (instanced) and a slim solid collider.
 * (x, y, z) = foot on the ground.
 */
export function lampPillar(det: Detail, cb: ContentBuilder, x: number, y: number, z: number): void {
  det.put('agna_pillar', () => {
    const base = new THREE.CylinderGeometry(0.34, 0.4, 0.4, 8);
    base.translate(0, 0.2, 0);
    const shaft = new THREE.CylinderGeometry(0.17, 0.23, 2.5, 8);
    shaft.translate(0, 1.65, 0);
    const collar = new THREE.CylinderGeometry(0.3, 0.26, 0.16, 8);
    collar.translate(0, 2.92, 0);
    return mergeParts([base, shaft, collar]);
  }, 'ice_trim', x, y, z, 0, 1, 1, 1, true);
  det.put('agna_pillar_cap', () => {
    const cap = new THREE.SphereGeometry(0.36, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.75, 1);
    cap.translate(0, 3.56, 0);
    const rim = new THREE.CylinderGeometry(0.4, 0.4, 0.07, 10);
    rim.translate(0, 3.55, 0);
    const tip = new THREE.ConeGeometry(0.06, 0.32, 6);
    tip.translate(0, 3.98, 0);
    return mergeParts([cap, rim, tip]);
  }, 'ice_wall', x, y, z, 0);
  det.glow.push(x, y + 3.25, z);
  det.put('agna_pillar_glow', () => {
    const g = new THREE.CylinderGeometry(0.19, 0.22, 0.52, 8);
    g.translate(0, 3.25, 0);
    return g;
  }, 'lantern_warm', x, y, z, 0);
  cb.collider({ shape: 'cylinder', x, y: y + 1.8, z, r: 0.3, hy: 1.8, walkable: false, solid: true, surface: 'ice' });
}

