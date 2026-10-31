import * as THREE from 'three';
import { heightAt } from '../../../Heightfield';
import { brazier, crest, roof } from '../parts';
import { crimsonMat, steelDarkMat } from '../materials';
import type { Cap } from './FireCapital';
import { FNC, HARBOR, atAxis, harborHalf } from './layout';
import { battlement, rng, slabRect, wallFace } from './kit';

/**
 * First Lord's Harbor: a deep basin whose sheer stone walls funnel everything to the Royal Plaza.
 *  - quay faces down to the basin floor on both sides and at the head; quay aprons at y 2.6
 *    backed by tall harbour walls (cliffs dressed in stone) up to the headlands;
 *  - the sea wall across the mouth: rampart with battlements, underwater tidal culverts closed by
 *    rusty steel grates, two great towers with ballista platforms either side of the Gates of
 *    Azulon (two leaves, animated by the harbour traffic in phase 5);
 *  - finger piers from the inner quay, bollards, crates.
 */
export interface HarborRefs {
  /** Gate leaves (pivot groups) — opened by the ship schedule. */
  leaves: THREE.Object3D[];
}
export const harborRefs: HarborRefs = { leaves: [] };

const Q = FNC.harbor;
/** Water's edge at the head of the basin (the inner quay is an apron slab north of it). */
const HEAD = FNC.harbor.s0 + 8;

/** Polyline along one basin edge (side = ±1) at offset `off` beyond the water's edge. */
function edge(side: number, off: number, s0: number, s1: number, step = 6): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (let s = s0; s <= s1 + 0.01; s += step) pts.push(atAxis(side * (harborHalf(s) + off), Math.min(s, s1)));
  // Order so the face (+normal = right of travel) looks into the basin: east side runs north→south reversed.
  return side > 0 ? pts : pts.reverse();
}

export function* buildHarbor(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const major = env.chunks.named('major', 'fnc_harbor');
  const b = major.builder;
  const rnd = rng(0x4a7b);
  const wet = 'stone_dark' as const;
  const cut = 'stone_tan' as const;

  // --- Quay faces (water's edge) and coping, both sides + the head of the basin.
  for (const side of [-1, 1]) {
    // Thick quay face centred just behind the water's edge: the ground's step stays inside it.
    const pts = edge(side, 0.9, HEAD + 2, HARBOR.wallS - 3, 5);
    wallFace(b, wet, pts, { top: () => Q.quayY, bottom: () => Q.bedY, thick: 3.2, collide: true, cap: 'stone_light', capH: 0.35 });
    // Harbour walls behind the aprons, up to the headland / hill ground.
    const back = edge(side, Q.quayW, Q.s0, HARBOR.wallS - 6, 6);
    wallFace(b, cut, back, {
      top: (x, z) => Math.max(Q.quayY + 6, heightAt(x + Math.sign(x - FNC.V.x) * 7, z) + 0.6),
      bottom: () => Q.bedY,
      thick: 3,
      collide: true,
      cap: 'stone_light',
      capH: 0.6,
    });
    // Buttresses on the harbour walls.
    for (let s = Q.s0 + 10; s < HARBOR.wallS - 14; s += 13) {
      const p = atAxis(side * (harborHalf(s) + Q.quayW - 1.4), s);
      const top = heightAt(p.x + side * 9, p.z) + 0.6;
      b.block(cut, { x: p.x, y: Q.quayY - 0.2, z: p.z, sx: 2.2, sy: Math.max(4, top - Q.quayY), sz: 2.4 }, { collide: true, walkable: false });
    }
    yield;
  }
  {
    // Head of the basin: an apron slab from the plaza's end to the head quay face.
    const h0 = harborHalf(Q.s0) + Q.quayW;
    const pts = [atAxis(-h0, HEAD + 0.9), atAxis(h0, HEAD + 0.9)];
    wallFace(b, wet, pts, { top: () => Q.quayY, bottom: () => Q.bedY, thick: 3.2, collide: true, cap: 'stone_light', capH: 0.35 });
    const c = atAxis(0, (Q.s0 + HEAD) / 2);
    b.box('stone_tan', { x: c.x, y: Q.quayY - 0.8, z: c.z, sx: h0 * 2, sy: 1.6, sz: HEAD - Q.s0 + 0.2 }, { collide: true, walkable: true, solid: true });
  }
  // Side aprons: slabs from the quay face back to the harbour walls (over deep water).
  for (const side of [-1, 1]) {
    for (let s = Q.s0 + 0.4; s < HARBOR.wallS - 4; s += 6) {
      const s2 = Math.min(HARBOR.wallS - 4, s + 6);
      const sm = (s + s2) / 2;
      const inner = harborHalf(sm) - 0.6, outer = harborHalf(sm) + Q.quayW + 0.6;
      const a = atAxis(side * inner, s), c2 = atAxis(side * outer, s), e = atAxis(side * inner, s2);
      const m = atAxis(side * (inner + outer) / 2, sm);
      // Funnel walls are slanted: align the slab with the quay edge.
      const yaw = Math.atan2(e.x - a.x, e.z - a.z);
      const w = Math.hypot(c2.x - a.x, c2.z - a.z);
      b.box('stone_tan', { x: m.x, y: Q.quayY - 0.8, z: m.z, sx: w, sy: 1.6, sz: s2 - s + 0.6, yaw }, { collide: true, walkable: true, solid: true });
    }
  }

  // --- Sea wall across the mouth.
  const W = HARBOR.wall;
  const sw = HARBOR.wallS;
  const reach = harborHalf(sw) + Q.quayW + 18;
  const topY = W.h;
  for (const side of [-1, 1]) {
    const t0 = side * (W.gateHalf + W.towerW);
    const t1 = side * reach;
    const len = Math.abs(t1 - t0);
    const c = atAxis((t0 + t1) / 2, sw);
    b.box('stone_dark', { x: c.x, y: (Q.bedY - 2 + topY) / 2, z: c.z, sx: len, sy: topY - Q.bedY + 2, sz: W.d }, { collide: true, walkable: true, solid: true });
    // Rampart paving and battlements both faces.
    slabRect(b, 'paving', { x: c.x, z: c.z, y: topY + 0.12, w: len, d: W.d - 1.4, thick: 0.24 });
    for (const face of [-1, 1]) {
      const a = atAxis(t0, sw + face * (W.d / 2 - 0.35)), e = atAxis(t1, sw + face * (W.d / 2 - 0.35));
      battlement(b, 'stone_tan', face > 0 ? [a, e] : [e, a], { y: () => topY + 0.24, h: 1.2, thick: 0.7, cap: 'stone_light' });
    }
    // Tidal culverts: dark arches at the waterline closed by rusty steel grates.
    const n = Math.floor(len / 16);
    for (let i = 0; i < n; i++) {
      const tt = t0 + side * (8 + i * 16);
      const p = atAxis(tt, sw - W.d / 2 - 0.05);
      b.box('stone_dark', { x: p.x, y: -0.6, z: p.z - 0.02, sx: 5.2, sy: 4.4, sz: 0.3 });
      b.box(voidMat(), { x: p.x, y: -0.9, z: p.z - 0.12, sx: 4.2, sy: 3.4, sz: 0.1 });
      for (let k = -4; k <= 4; k++) b.box(rustMat(), { x: p.x + k * 0.46, y: -0.9, z: p.z - 0.24, sx: 0.12, sy: 3.4, sz: 0.12 });
      for (const yy of [-2.2, -0.9, 0.4]) b.box(rustMat(), { x: p.x, y: yy, z: p.z - 0.26, sx: 4.1, sy: 0.12, sz: 0.12 });
    }
    // Great gate tower.
    const tc = atAxis(side * (W.gateHalf + W.towerW / 2), sw);
    b.box('stone_dark', { x: tc.x, y: (Q.bedY + W.towerH) / 2, z: tc.z, sx: W.towerW, sy: W.towerH - Q.bedY, sz: W.towerW + 4 }, { collide: true, walkable: true, solid: true });
    b.box('stone_tan', { x: tc.x, y: W.towerH - 3, z: tc.z, sx: W.towerW + 1.2, sy: 1.2, sz: W.towerW + 5.2 });
    // Crimson bands, crest facing the sea.
    b.box(crimsonMat(), { x: tc.x, y: W.towerH - 7.5, z: tc.z, sx: W.towerW + 0.3, sy: 2.4, sz: W.towerW + 4.3 });
    crest(b, { x: tc.x, y: W.towerH - 13, z: tc.z + (W.towerW + 4) / 2 + 0.1, yaw: 0, size: 4.4 });
    // Ballista platform: a roofed pavilion on top with battlements.
    battlement(b, 'stone_tan', [
      { x: tc.x - W.towerW / 2, z: tc.z - W.towerW / 2 - 2 },
      { x: tc.x + W.towerW / 2, z: tc.z - W.towerW / 2 - 2 },
      { x: tc.x + W.towerW / 2, z: tc.z + W.towerW / 2 + 2 },
      { x: tc.x - W.towerW / 2, z: tc.z + W.towerW / 2 + 2 },
      { x: tc.x - W.towerW / 2, z: tc.z - W.towerW / 2 - 2 },
    ], { y: () => W.towerH, h: 1.3, thick: 0.8, cap: 'stone_light' });
    roof(b, { x: tc.x, y: W.towerH + 6, z: tc.z, w: 7, d: 7, h: 3.2, style: 'pyramid', mat: 'roof_red', trim: 'gold', tips: 0.5, finial: 1.6 });
    for (const [px, pz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]] as const) b.box('wood_red', { x: tc.x + px, y: W.towerH + 3, z: tc.z + pz, sx: 0.5, sy: 6, sz: 0.5 });
    for (const k of [-1, 1]) brazier(b, cap.flames, { x: tc.x + k * 6.6, y: W.towerH, z: tc.z + 7.4, size: 1.1, collide: false });
    cap.mark(`seaTower${side > 0 ? 'E' : 'W'}`, tc.x, W.towerH, tc.z);
    yield;
  }
  // Gate leaves (pivot at each tower's inner face; closed = across the gap).
  for (const side of [-1, 1]) {
    const hinge = atAxis(side * W.gateHalf, sw);
    const pivot = new THREE.Group();
    pivot.position.set(hinge.x, 0, hinge.z);
    const leafW = W.gateHalf;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, W.h - Q.bedY + 1, 1.6), steelDarkMat());
    leaf.position.set(-side * leafW / 2, (Q.bedY + W.h) / 2, 0);
    leaf.castShadow = true;
    pivot.add(leaf);
    for (let k = 0; k < 5; k++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.4, 0.5, 1.8), rustMat());
      band.position.set(-side * leafW / 2, Q.bedY + 3 + k * 4.4, 0);
      pivot.add(band);
    }
    const em = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), new THREE.MeshStandardMaterial({ color: '#c8a038', metalness: 0.6, roughness: 0.35 }));
    em.position.set(-side * (leafW - 2.8), W.h - 4, 0.9);
    pivot.add(em);
    major.group.add(pivot);
    for (const c of pivot.children) if (c instanceof THREE.Mesh) major.ownedGeos.push(c.geometry);
    major.ownedMats.push(em.material as THREE.Material);
    harborRefs.leaves.push(pivot);
  }
  const sg = atAxis(0, sw);
  cap.mark('seaGate', sg.x, 0, sg.z);

  // --- Finger piers from the inner quay.
  const props = env.chunks.named('props', 'fnc_harbor_props').builder;
  for (const t of HARBOR.piers) {
    const s0 = HEAD, s1 = HEAD + HARBOR.pierLen;
    const c = atAxis(t, (s0 + s1) / 2);
    b.box('stone_tan', { x: c.x, y: Q.quayY - 0.35, z: c.z, sx: HARBOR.pierW, sy: 0.7, sz: s1 - s0 }, { collide: true, walkable: true, solid: true });
    for (let s = s0 + 4; s < s1; s += 8) {
      for (const k of [-1, 1]) {
        const p = atAxis(t + k * (HARBOR.pierW / 2 - 0.6), s);
        b.cylinder('stone_dark', { x: p.x, y: Q.bedY, z: p.z, r: 0.7, h: Q.quayY - 0.7 - Q.bedY, segments: 8 });
        props.cylinder('iron', { x: p.x, y: Q.quayY, z: p.z, r: 0.22, h: 0.7, segments: 8 });
      }
    }
    cap.mark(`pier${t > 0 ? 'E' : 'W'}`, c.x, Q.quayY, c.z);
  }
  // Bollards along both quay edges.
  for (const side of [-1, 1]) {
    for (let s = Q.s0 + 6; s < HARBOR.wallS - 8; s += 9) {
      const p = atAxis(side * (harborHalf(s) + 1.1), s);
      props.cylinder('iron', { x: p.x, y: Q.quayY, z: p.z, r: 0.25, h: 0.75, segments: 8 }, { collide: true, walkable: false });
    }
  }
  // Crate stacks and cargo on the aprons.
  const det = env.chunks.named('detail', 'fnc_harbor_detail').builder;
  for (let i = 0; i < 46; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const s = Q.s0 + 8 + rnd() * (HARBOR.wallS - Q.s0 - 30);
    const t = side * (harborHalf(s) + 4 + rnd() * (Q.quayW - 7));
    const p = atAxis(t, s);
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) det.box(k % 2 ? 'wood_dark' : 'wood', { x: p.x + (rnd() - 0.5) * 0.6, y: Q.quayY + 0.6 + k * 1.15, z: p.z + (rnd() - 0.5) * 0.6, sx: 1.2, sy: 1.15, sz: 1.2, yaw: rnd() * 3 }, k === 0 ? { collide: true, walkable: true } : {});
  }
  // Harbour lamps on the quay edges.
  for (const side of [-1, 1]) {
    for (let s = Q.s0 + 12; s < HARBOR.wallS - 10; s += 22) {
      const p = atAxis(side * (harborHalf(s) + Q.quayW - 2.2), s);
      props.lantern(new THREE.Vector3(p.x, Q.quayY + 3.2, p.z), { color: 'warm', post: true });
    }
  }
  const qw = atAxis(-(harborHalf(700) + 8), 700);
  cap.mark('quayW', qw.x, Q.quayY, qw.z);
  yield;
}

let voidM: THREE.MeshStandardMaterial | null = null;
/** Near-black (culvert mouths, deep openings). */
export function voidMat(): THREE.MeshStandardMaterial {
  if (!voidM) voidM = new THREE.MeshStandardMaterial({ color: '#0a0b0d', roughness: 1 });
  return voidM;
}

let rust: THREE.MeshStandardMaterial | null = null;
/** Rusty steel (grates, bands). */
export function rustMat(): THREE.MeshStandardMaterial {
  if (!rust) rust = new THREE.MeshStandardMaterial({ color: '#6a3a24', roughness: 0.85, metalness: 0.45 });
  return rust;
}
