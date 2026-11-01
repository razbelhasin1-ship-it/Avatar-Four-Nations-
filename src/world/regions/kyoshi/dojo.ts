import * as THREE from 'three';
import { heightAt } from '../../Heightfield';
import { A, KI, yawOutward } from '../../landforms/kyoshiIsland';
import type { P2 } from '../../WorldLayout';
import type { BuildEnv } from '../earth/env';
import { off, type Mat } from './kit';

/**
 * The Kyoshi Dojo (image 4): a walled compound on a grassy shelf north-east of the village —
 * a gatehouse at the front, a big pale training courtyard (swirl paving, almost no furniture),
 * side halls along both flanks and the larger hall at the back, all under blue-grey tile; racks of
 * fans, katanas and shields, practice posts.
 */

export interface DojoOut {
  marks: Record<string, { x: number; y: number; z: number }>;
  /** Courtyard centre, frame and size (drill formations). */
  yard: { x: number; y: number; z: number; yaw: number; w: number; d: number };
  posts: P2[];
  owned: Array<THREE.Material | THREE.Texture>;
}

/** Swirl paving decal for the courtyard centre. */
function swirlTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(120, 128, 140, 0.85)';
  g.lineWidth = 9;
  g.lineCap = 'round';
  for (const s of [1, -1]) {
    g.beginPath();
    for (let a = 0; a < Math.PI * 3.4; a += 0.05) {
      const r = 8 + a * 10.5;
      const x = 128 + s * Math.cos(a) * r, y = 128 + s * Math.sin(a) * r;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function* buildDojo(env: BuildEnv, out: DojoOut): Generator<unknown, void, unknown> {
  const c = A(KI.dojo.u, KI.dojo.r);
  const y = heightAt(c.x, c.z);
  const yaw = yawOutward(KI.dojo.u) + Math.PI; // the gate looks toward the bay and the village
  const W = 52, D = 42;
  const major = env.chunks.at('major', c.x, c.z).builder;
  const props = env.chunks.at('props', c.x, c.z).builder;
  const roof: Mat = 'roof_blue';
  const wallMat: Mat = 'plaster_cream';
  // Platform and courtyard paving.
  major.box('stone_light', { x: c.x, y: y + 0.15, z: c.z, sx: W + 2, sy: 0.3, sz: D + 2, yaw }, { collide: true, walkable: true, solid: true });
  const yd = y + 0.3;
  const pave = new THREE.PlaneGeometry(W - 16, D - 18);
  pave.rotateX(-Math.PI / 2);
  const yardC = off(c, yaw, 0, 1);
  major.mesh('paving', pave, { x: yardC.x, y: yd + 0.02, z: yardC.z, yaw });
  pave.dispose();
  const tex = swirlTexture();
  const swirlMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  swirlMat.name = 'dojo_swirl';
  out.owned.push(swirlMat, tex);
  const sw = new THREE.PlaneGeometry(12, 12);
  sw.rotateX(-Math.PI / 2);
  major.mesh(swirlMat, sw, { x: yardC.x, y: yd + 0.04, z: yardC.z, yaw });
  sw.dispose();
  out.yard = { x: yardC.x, y: yd, z: yardC.z, yaw, w: W - 18, d: D - 20 };
  // Perimeter wall with tiled caps (gap at the gatehouse).
  const wallH = 2.8;
  const seg = (a: P2, b2: P2) => {
    const L = Math.hypot(b2.x - a.x, b2.z - a.z);
    const m = { x: (a.x + b2.x) / 2, z: (a.z + b2.z) / 2 };
    const wy = Math.atan2(b2.x - a.x, b2.z - a.z);
    major.box(wallMat, { x: m.x, y: yd + wallH / 2, z: m.z, sx: 0.7, sy: wallH, sz: L, yaw: wy }, { collide: true, walkable: true, solid: true });
    major.box('stone_grey', { x: m.x, y: yd + 0.25, z: m.z, sx: 0.85, sy: 0.5, sz: L, yaw: wy });
    major.roof(roof, { x: m.x, y: yd + wallH, z: m.z, w: L, d: 0.7, height: 0.5, yaw: wy + Math.PI / 2, overhang: 0.3, curve: 0.3, style: 'gable', ridge: null });
  };
  const P = (r: number, f: number) => off(c, yaw, r, f);
  seg(P(-W / 2, D / 2), P(-6, D / 2));
  seg(P(6, D / 2), P(W / 2, D / 2));
  seg(P(W / 2, D / 2), P(W / 2, -D / 2));
  seg(P(W / 2, -D / 2), P(-W / 2, -D / 2));
  seg(P(-W / 2, -D / 2), P(-W / 2, D / 2));
  yield;
  // Gatehouse straddling the front wall: two flanking rooms, a roofed passage with heavy doors.
  const gh = P(0, D / 2);
  for (const s of [-1, 1]) {
    const q = off(gh, yaw, s * 4.3, 0);
    major.box(wallMat, { x: q.x, y: yd + 1.9, z: q.z, sx: 3.4, sy: 3.8, sz: 6, yaw }, { collide: true, walkable: true, solid: true });
    major.box('wood_dark', { x: q.x, y: yd + 3.9, z: q.z, sx: 3.6, sy: 0.25, sz: 6.2, yaw });
  }
  major.roof(roof, { x: gh.x, y: yd + 4.0, z: gh.z, w: 12, d: 7, height: 2.6, yaw, overhang: 0.8, curve: 0.45, style: 'hip', ridge: 'roof_dark' });
  for (const s of [-1, 1]) {
    const leaf = off(gh, yaw, s * 2.1, -1.4);
    major.box('wood_red', { x: leaf.x, y: yd + 1.55, z: leaf.z, sx: 1.8, sy: 3.1, sz: 0.14, yaw: yaw - s * 1.1 });
  }
  for (const s of [-1, 1]) {
    const q = off(gh, yaw, s * 6.5, 3.6);
    major.lantern(new THREE.Vector3(q.x, yd + 2.9, q.z), { color: 'warm', post: true });
  }
  out.marks.dojo_gate = { x: gh.x, y: yd, z: gh.z };
  // Main hall at the back on a raised plinth, open front facing the yard.
  const mh = P(0, -D / 2 + 7.5);
  major.box('stone_grey', { x: mh.x, y: yd + 0.45, z: mh.z, sx: 28, sy: 0.9, sz: 13, yaw }, { collide: true, walkable: true, solid: true });
  const hy = yd + 0.9;
  const backWall = off(mh, yaw, 0, -6);
  major.box(wallMat, { x: backWall.x, y: hy + 2.8, z: backWall.z, sx: 26, sy: 5.6, sz: 0.3, yaw }, { collide: true, solid: true });
  for (const s of [-1, 1]) {
    const q = off(mh, yaw, s * 13, 0);
    major.box(wallMat, { x: q.x, y: hy + 2.8, z: q.z, sx: 0.3, sy: 5.6, sz: 12, yaw }, { collide: true, solid: true });
  }
  for (let i = 0; i < 7; i++) {
    const q = off(mh, yaw, -12 + i * 4, 5.6);
    major.box('wood_red', { x: q.x, y: hy + 2.8, z: q.z, sx: 0.4, sy: 5.6, sz: 0.4, yaw }, { collide: true, solid: true });
  }
  const inner = off(mh, yaw, 0, -5.6);
  major.box('wood_dark', { x: inner.x, y: hy + 2.6, z: inner.z, sx: 25, sy: 5.2, sz: 0.1, yaw }, { castShadow: false });
  major.box('wood_dark', { x: mh.x, y: hy + 5.7, z: mh.z, sx: 27, sy: 0.35, sz: 12.6, yaw });
  major.roof(roof, { x: mh.x, y: hy + 5.8, z: mh.z, w: 28, d: 13, height: 4.6, yaw, overhang: 1.4, curve: 0.5, style: 'hip', ridge: 'roof_dark' });
  const st0 = off(mh, yaw, 0, 9.6), st1 = off(mh, yaw, 0, 6.6);
  major.stairs({ from: new THREE.Vector3(st0.x, yd - 0.02, st0.z), to: new THREE.Vector3(st1.x, hy, st1.z), width: 7, material: 'stone_grey' });
  out.marks.dojo_hall = { x: mh.x, y: hy, z: mh.z };
  yield;
  // Side halls along both flanks: open verandas to the yard, racks of fans, katanas and shields.
  for (const s of [-1, 1]) {
    const sc = P(s * (W / 2 - 4.2), 2);
    const sideYaw = yaw - s * Math.PI / 2; // facing the yard
    major.box('stone_grey', { x: sc.x, y: yd + 0.3, z: sc.z, sx: 26, sy: 0.6, sz: 7, yaw: sideYaw }, { collide: true, walkable: true, solid: true });
    const back = off(sc, sideYaw, 0, -3.1);
    major.box(wallMat, { x: back.x, y: yd + 2.3, z: back.z, sx: 25, sy: 3.4, sz: 0.25, yaw: sideYaw }, { collide: true, solid: true });
    for (let i = 0; i < 6; i++) {
      const q = off(sc, sideYaw, -12 + i * 4.8, 3.1);
      major.box('wood_dark', { x: q.x, y: yd + 2.3, z: q.z, sx: 0.3, sy: 3.4, sz: 0.3, yaw: sideYaw }, { collide: true, solid: true });
    }
    major.roof(roof, { x: sc.x, y: yd + 4.0, z: sc.z, w: 26, d: 7, height: 2.4, yaw: sideYaw, overhang: 0.9, curve: 0.4, style: 'hip', ridge: 'roof_dark' });
    // Racks under the veranda.
    for (let k = 0; k < 4; k++) {
      const r = off(sc, sideYaw, -9 + k * 6, -2.2);
      props.box('wood_dark', { x: r.x, y: yd + 1.3, z: r.z, sx: 2.6, sy: 1.6, sz: 0.25, yaw: sideYaw }, { collide: true, solid: true });
      for (let n = 0; n < 5; n++) {
        const it = off(r, sideYaw, -1.0 + n * 0.5, 0.18);
        const kind = (k + (s > 0 ? 1 : 0)) % 3;
        if (kind === 0) {
          // war fans (folded gold)
          props.box('gold', { x: it.x, y: yd + 1.55, z: it.z, sx: 0.08, sy: 0.55, sz: 0.06, yaw: sideYaw, roll: 0.15 });
        } else if (kind === 1) {
          // katanas
          props.box('iron', { x: it.x, y: yd + 1.4, z: it.z, sx: 0.04, sy: 1.0, sz: 0.04, yaw: sideYaw });
          props.box('wood_dark', { x: it.x, y: yd + 0.95, z: it.z, sx: 0.06, sy: 0.28, sz: 0.06, yaw: sideYaw });
        } else {
          // forearm shields
          props.box('roof_green', { x: it.x, y: yd + 1.4, z: it.z, sx: 0.36, sy: 0.5, sz: 0.06, yaw: sideYaw });
        }
      }
    }
  }
  yield;
  // Practice posts along the yard's front edge; banners at the hall.
  const posts: P2[] = [];
  for (let i = 0; i < 6; i++) {
    const q = P(-12.5 + i * 5, D / 2 - 6.5);
    props.cylinder('wood', { x: q.x, y: yd, z: q.z, r: 0.22, h: 1.9, segments: 8 }, { collide: true, solid: true });
    props.box('wood_dark', { x: q.x, y: yd + 1.45, z: q.z, sx: 0.9, sy: 0.12, sz: 0.12, yaw });
    posts.push(q);
  }
  out.posts = posts;
  for (const s of [-1, 1]) {
    const q = off(mh, yaw, s * 9, 7.2);
    props.box('wood_dark', { x: q.x, y: yd + 3, z: q.z, sx: 0.12, sy: 6, sz: 0.12, yaw }, { collide: true, solid: true });
    props.box('roof_green', { x: q.x, y: yd + 4.4, z: q.z, sx: 1.1, sy: 2.6, sz: 0.04, yaw }, { castShadow: false });
    props.box('gold', { x: q.x, y: yd + 4.6, z: q.z, sx: 0.5, sy: 0.5, sz: 0.05, yaw }, { castShadow: false });
  }
  out.marks.dojo = { x: yardC.x, y: yd, z: yardC.z };
}
