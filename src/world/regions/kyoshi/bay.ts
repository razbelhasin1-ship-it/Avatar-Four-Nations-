import * as THREE from 'three';
import { getRiverRuntime, heightAt } from '../../Heightfield';
import { A, KI, yawOutward } from '../../landforms/kyoshiIsland';
import type { BuildEnv } from '../earth/env';
import { off } from './kit';
import type { KyoshiMats } from './materials';
import { shipParts } from '../../../travel/kit';

/**
 * Koi Bay's shore and the island's wild edges: the bison landing meadow above the beach (keeper's
 * hut, hay, a trough), fishing boats drawn up on the sand, the Crescent Bridge over Crystal Falls'
 * stream with its rest spot, rocks at the falls, Corsair Cove's cave mouth, the east headland's
 * beacon and the offshore islet's lone pine.
 */

export interface BayOut {
  marks: Record<string, { x: number; y: number; z: number }>;
  lanterns: THREE.Vector3[];
}

export function* buildBay(env: BuildEnv, out: BayOut, km: KyoshiMats): Generator<unknown, void, unknown> {
  const rnd = env.rnd;
  // ---- Bison meadow: keeper's hut, hay stacks, a water trough ----
  {
    const m = A(KI.meadow.u, KI.meadow.r);
    const yaw = yawOutward(KI.meadow.u) + Math.PI;
    const hut = off(m, yaw, -12, -10);
    const y = heightAt(hut.x, hut.z);
    const b = env.chunks.at('props', hut.x, hut.z).builder;
    b.building({ x: hut.x, y, z: hut.z, w: 5, d: 4.4, h: 2.6, yaw, wall: 'wood', roof: km.thatchOld, trim: 'wood_dark', roofStyle: 'gable', roofHeight: 2.6, windows: false, plinth: null });
    for (const [r, f] of [[8, -8], [10.5, -6], [9, -10.5]] as const) {
      const q = off(m, yaw, r, f);
      const hy = heightAt(q.x, q.z);
      const hay = new THREE.SphereGeometry(1.3, 9, 6);
      hay.scale(1, 0.85, 1);
      b.mesh(env.mats.hay, hay, { x: q.x, y: hy + 0.85, z: q.z });
      hay.dispose();
      b.collider({ shape: 'cylinder', x: q.x, y: hy + 0.9, z: q.z, r: 1.2, hy: 0.9, walkable: true, solid: true, surface: 'grass' });
    }
    const tr = off(m, yaw, 5, -12);
    const ty = heightAt(tr.x, tr.z);
    b.box('wood', { x: tr.x, y: ty + 0.35, z: tr.z, sx: 3, sy: 0.7, sz: 0.9, yaw }, { collide: true, solid: true });
    b.box('ice_deep', { x: tr.x, y: ty + 0.62, z: tr.z, sx: 2.7, sy: 0.05, sz: 0.65, yaw }, { castShadow: false });
    out.marks.meadow = { x: m.x, y: heightAt(m.x, m.z), z: m.z };
  }
  yield;
  // ---- Beach: fishing boats drawn up on the sand, upturned hulls, nets on poles ----
  for (let i = 0; i < 5; i++) {
    const u = 0.15 + i * 0.03 + rnd.range(-0.006, 0.006);
    const p = A(u, KI.Ri + 6 + rnd.range(0, 3));
    const y = heightAt(p.x, p.z);
    const yaw = yawOutward(u) + Math.PI + rnd.range(-0.5, 0.5);
    const b = env.chunks.at('props', p.x, p.z).builder;
    const s = shipParts('fishing');
    for (const part of s.parts) {
      if (part.mat === 'cloth_white' && i % 2) {
        part.geo.dispose();
        continue;
      }
      b.mesh(part.mat, part.geo, { x: p.x, y: y + 0.55, z: p.z, yaw, roll: i % 2 ? 0.12 : -0.08 });
      part.geo.dispose();
    }
    b.collider({ shape: 'box', x: p.x, y: y + 0.6, z: p.z, hx: s.beam / 2, hy: 0.6, hz: s.length / 2, yaw, walkable: true, solid: true, surface: 'wood' });
  }
  out.marks.bay_beach = { ...A(0.22, KI.Ri + 8), y: heightAt(A(0.22, KI.Ri + 8).x, A(0.22, KI.Ri + 8).z) };
  yield;
  // ---- Crescent Bridge over the stream on the coast road, and a rest spot looking up at the falls ----
  {
    const river = getRiverRuntime().find((r) => r.id === 'ki_crystal_stream');
    const bc = A(KI.falls.u, 268);
    let s = 0;
    if (river) {
      let best = Infinity;
      for (let k = 0; k <= river.line.length; k += 1) {
        const p = river.line.pointAt(k);
        const d = Math.hypot(p.x - bc.x, p.z - bc.z);
        if (d < best) {
          best = d;
          s = k;
        }
      }
    }
    const w = river ? river.width(s) : 5;
    const tan = river ? river.line.tangentAt(s) : { x: 1, z: 0 };
    const cross = { x: -tan.z, z: tan.x };
    const half = w / 2 + 9;
    const a = { x: bc.x - cross.x * half, z: bc.z - cross.z * half }, c = { x: bc.x + cross.x * half, z: bc.z + cross.z * half };
    const ya = heightAt(a.x, a.z), yc = heightAt(c.x, c.z);
    const roadA = heightAt(bc.x - cross.x * (half + 5), bc.z - cross.z * (half + 5));
    const roadC = heightAt(bc.x + cross.x * (half + 5), bc.z + cross.z * (half + 5));
    const deckY = Math.max(ya, yc, Math.min(roadA, roadC), (river ? river.surface(s) : 0) + 2.2);
    const b = env.chunks.at('major', bc.x, bc.z).builder;
    b.bridge({ a: new THREE.Vector3(a.x, deckY, a.z), b: new THREE.Vector3(c.x, deckY, c.z), width: 3.4, deck: 'wood', rail: 'wood_red', support: null, arch: 1.9, surface: 'wood' });
    // Stone abutments under both ends.
    for (const p of [a, c]) b.box('stone_grey', { x: p.x, y: deckY - 2.2, z: p.z, sx: 2.4, sy: 4.2, sz: 4.2, yaw: Math.atan2(cross.x, cross.z) }, { collide: true, walkable: true, solid: true });
    // Ramps from the road onto the deck ends where the banks dip.
    for (const [p, py] of [[a, ya], [c, yc]] as const) {
      if (deckY - py > 0.3) {
        const out2 = { x: p.x + (p.x - bc.x) * 0.35, z: p.z + (p.z - bc.z) * 0.35 };
        b.stairs({ from: new THREE.Vector3(out2.x, heightAt(out2.x, out2.z) - 0.05, out2.z), to: new THREE.Vector3(p.x, deckY, p.z), width: 3.2, material: 'wood' });
      }
    }
    out.marks.bridge = { x: bc.x, y: deckY, z: bc.z };
    // Rest spot: a bench, a lantern and a little stone platform upstream of the bridge.
    const rest = A(KI.falls.u + 0.012, 286);
    const ry = heightAt(rest.x, rest.z);
    const yawR = Math.atan2(A(KI.falls.u, 330).x - rest.x, A(KI.falls.u, 330).z - rest.z);
    const pb = env.chunks.at('props', rest.x, rest.z).builder;
    pb.box('stone_grey', { x: rest.x, y: ry + 0.12, z: rest.z, sx: 4.4, sy: 0.24, sz: 3.2, yaw: yawR }, { collide: true, walkable: true, solid: true });
    const bench = off(rest, yawR, 0, -0.6);
    pb.box('wood', { x: bench.x, y: ry + 0.65, z: bench.z, sx: 2.2, sy: 0.1, sz: 0.5, yaw: yawR }, { collide: true, walkable: true, solid: true });
    for (const e of [-0.9, 0.9]) {
      const l = off(bench, yawR, e, 0);
      pb.box('wood_dark', { x: l.x, y: ry + 0.4, z: l.z, sx: 0.1, sy: 0.5, sz: 0.45, yaw: yawR });
    }
    const lq = off(rest, yawR, 1.8, 1.0);
    pb.lantern(new THREE.Vector3(lq.x, ry + 3.1, lq.z), { color: 'warm', post: true });
    out.lanterns.push(new THREE.Vector3(lq.x, ry + 3.1, lq.z));
    out.marks.rest_spot = { x: rest.x, y: ry, z: rest.z };
    // Boulders along the falls (liftable), mossy.
    if (river) {
      for (let k = 0; k < 14; k++) {
        const ss = 40 + k * 18 + rnd.range(-4, 4);
        if (ss > river.line.length - 20) break;
        const p = river.line.pointAt(ss);
        const t2 = river.line.tangentAt(ss);
        const side = k % 2 ? 1 : -1;
        const off2 = river.width(ss) / 2 + rnd.range(1.5, 3.5);
        const x = p.x - t2.z * off2 * side, z = p.z + t2.x * off2 * side;
        const rock = new THREE.DodecahedronGeometry(rnd.range(0.7, 1.4), 0);
        rock.scale(1.2, 0.75, 1);
        env.chunks.at('props', x, z).builder.rock('stone_grey', rock, { x, y: heightAt(x, z) + 0.3, z, yaw: k });
        rock.dispose();
      }
    }
  }
  yield;
  // ---- Corsair Cove: a dark sea-cave mouth in the west arm's outer cliff ----
  {
    const c = A(KI.cove.u, KI.Ri + 0.95 * (KI.thickTip + (KI.thickMid - KI.thickTip) * Math.pow(Math.sin(Math.PI * KI.cove.u), 0.7)));
    const yaw = yawOutward(KI.cove.u);
    const b = env.chunks.at('major', c.x, c.z).builder;
    const arch = new THREE.TorusGeometry(5.5, 1.6, 6, 12, Math.PI);
    b.mesh('stone_dark', arch, { x: c.x, y: 0.5, z: c.z, yaw });
    arch.dispose();
    const mouth = new THREE.CircleGeometry(5.2, 14, 0, Math.PI);
    b.mesh('stone_dark', mouth, { x: c.x - Math.sin(yaw) * 1.2, y: 0.5, z: c.z - Math.cos(yaw) * 1.2, yaw: yaw + Math.PI });
    mouth.dispose();
    out.marks.corsair_cove = { x: c.x, y: 1, z: c.z };
  }
  // ---- East headland beacon ----
  {
    const c = A(0.968, 300);
    const y = heightAt(c.x, c.z);
    const b = env.chunks.at('props', c.x, c.z).builder;
    b.cylinder('stone_grey', { x: c.x, y, z: c.z, r: 1.6, rTop: 1.1, h: 1.6, segments: 8 }, { collide: true, walkable: true, solid: true });
    b.cylinder('wood_dark', { x: c.x, y: y + 1.6, z: c.z, r: 0.15, h: 4.5, segments: 6 });
    b.cylinder('iron', { x: c.x, y: y + 6.0, z: c.z, r: 0.55, rTop: 0.7, h: 0.5, segments: 8 });
    out.marks.east_headland = { x: c.x, y, z: c.z };
  }
}
