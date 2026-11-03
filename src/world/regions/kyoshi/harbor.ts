import * as THREE from 'three';
import { heightAt } from '../../Heightfield';
import { A, KI, yawOutward } from '../../landforms/kyoshiIsland';
import type { P2 } from '../../WorldLayout';
import type { BuildEnv } from '../earth/env';
import { barrel, dryingRack, house, off } from './kit';

/**
 * Koi Harbor, the island's fishing and trading port on the east side of the bay: a timber quay and
 * boardwalk, five wooden piers (the middle one the passenger pier where ships from the mainland
 * dock), the fish market (elephant koi fillets, barrels of fish oil), drying racks, warehouses under
 * grey tile, the traders' inn, and lanterns along the water. Rowdier than the village.
 */

export interface HarborOut {
  marks: Record<string, { x: number; y: number; z: number }>;
  /** Pier heads and berths (boats), bow direction outward to the bay. */
  piers: Array<{ u: number; root: P2; head: P2; yaw: number }>;
  stalls: Array<{ x: number; z: number; yaw: number }>;
  doors: Array<{ x: number; z: number; yaw: number }>;
  lanterns: THREE.Vector3[];
}

export const PIER_US = [0.765, 0.793, 0.82, 0.848, 0.875];
export const PASSENGER_PIER = 2;
const QUAY_R = 213;
const DECK_Y = KI.harbor.y + 0.05;
const PIER_END_R = 168;

export function* buildHarbor(env: BuildEnv, out: HarborOut): Generator<unknown, void, unknown> {
  const rnd = env.rnd;
  // Quay: timber bulkhead and a plank boardwalk along the water from one end of the harbor to the other.
  const u0 = KI.harbor.u0 + 0.005, u1 = KI.harbor.u1 - 0.005;
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const ua = u0 + ((u1 - u0) * i) / steps, ub = u0 + ((u1 - u0) * (i + 1)) / steps;
    const a = A(ua, QUAY_R + 4), c = A(ub, QUAY_R + 4);
    const m = { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 };
    const L = Math.hypot(c.x - a.x, c.z - a.z) + 0.15;
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    const b = env.chunks.at('major', m.x, m.z).builder;
    b.box('wood', { x: m.x, y: DECK_Y - 0.15, z: m.z, sx: 8.5, sy: 0.3, sz: L, yaw }, { collide: true, walkable: true, solid: true, surface: 'wood' });
    const wall = A((ua + ub) / 2, QUAY_R - 0.1);
    b.box('wood_dark', { x: wall.x, y: DECK_Y - 2.3, z: wall.z, sx: 0.5, sy: 4.3, sz: L, yaw }, { collide: true, solid: true });
    if (i % 2 === 0) {
      const lp = A((ua + ub) / 2, QUAY_R + 1.0);
      env.chunks.at('props', lp.x, lp.z).builder.lantern(new THREE.Vector3(lp.x, DECK_Y + 2.9, lp.z), { color: 'warm', post: true });
      out.lanterns.push(new THREE.Vector3(lp.x, DECK_Y + 2.9, lp.z));
    }
  }
  yield;
  // Piers out into the bay on piles, bollards along their edges.
  for (const [k, u] of PIER_US.entries()) {
    const root = A(u, QUAY_R), head = A(u, PIER_END_R);
    const yaw = yawOutward(u) + Math.PI; // pointing into the bay
    const m = { x: (root.x + head.x) / 2, z: (root.z + head.z) / 2 };
    const L = QUAY_R - PIER_END_R + 1;
    const w = k === PASSENGER_PIER ? 5 : 3.6;
    const b = env.chunks.at('major', m.x, m.z).builder;
    b.box('wood', { x: m.x, y: DECK_Y - 0.15, z: m.z, sx: w, sy: 0.3, sz: L, yaw }, { collide: true, walkable: true, solid: true, surface: 'wood' });
    const pb = env.chunks.at('props', m.x, m.z).builder;
    for (let i = 0; i <= Math.floor(L / 4); i++) {
      for (const s of [-1, 1]) {
        const q = off(root, yaw, s * (w / 2 - 0.15), i * 4);
        pb.cylinder('wood_dark', { x: q.x, y: -4, z: q.z, r: 0.2, h: DECK_Y + 3.6, segments: 7 });
        if (i % 2 === 1) pb.cylinder('wood_dark', { x: q.x, y: DECK_Y, z: q.z, r: 0.17, h: 0.55, segments: 7 }, { collide: true, solid: true });
      }
    }
    out.piers.push({ u, root, head, yaw });
    if (k === PASSENGER_PIER) {
      // The harbormaster's booth and a signal mast at the passenger pier.
      const bc = off(root, yaw + Math.PI, 3.6, 3.4);
      const by = DECK_Y;
      pb.box('wood_dark', { x: bc.x, y: by + 1.2, z: bc.z, sx: 2.6, sy: 2.4, sz: 2.2, yaw }, { collide: true, solid: true });
      pb.roof('roof_dark', { x: bc.x, y: by + 2.4, z: bc.z, w: 2.6, d: 2.2, height: 1.1, yaw, overhang: 0.4, curve: 0.3, style: 'gable', ridge: 'wood' });
      const mast = off(head, yaw, 1.6, -1.2);
      pb.cylinder('wood', { x: mast.x, y: DECK_Y, z: mast.z, r: 0.12, h: 7, segments: 7 });
      pb.box('cloth_green', { x: mast.x, y: DECK_Y + 6.2, z: mast.z, sx: 0.04, sy: 0.9, sz: 1.5, yaw }, { castShadow: false });
      out.marks.harbor_pier = { x: root.x, y: DECK_Y, z: root.z };
      out.marks.pier_head = { x: head.x, y: DECK_Y, z: head.z };
    }
  }
  yield;
  // Fish market: open stalls with koi fillets, baskets of fish, barrels of fish oil.
  for (let i = 0; i < 6; i++) {
    const u = 0.802 + i * 0.0085;
    const c = A(u, QUAY_R + 12.5);
    const y = Math.max(DECK_Y, heightAt(c.x, c.z));
    const yaw = yawOutward(u) + Math.PI; // facing the water
    const b = env.chunks.at('props', c.x, c.z).builder;
    b.box('wood', { x: c.x, y: y + 0.45, z: c.z, sx: 2.4, sy: 0.9, sz: 1.2, yaw }, { collide: true, solid: true });
    for (const r of [-1, 1]) for (const f of [-1, 1]) {
      const q = off(c, yaw, r * 1.15, f * 0.55);
      b.box('wood_dark', { x: q.x, y: y + 1.25, z: q.z, sx: 0.08, sy: 2.5, sz: 0.08, yaw });
    }
    const awn = off(c, yaw, 0, 0.35);
    b.box(i % 2 ? 'cloth_blue' : 'cloth_white', { x: awn.x, y: y + 2.5, z: awn.z, sx: 2.9, sy: 0.05, sz: 2.0, yaw, pitch: -0.2 }, { castShadow: false });
    for (let n = 0; n < 6; n++) {
      const f = off(c, yaw, -0.9 + n * 0.36, 0.1);
      b.box(n % 2 ? 'cloth_orange' : 'cloth_red', { x: f.x, y: y + 0.96, z: f.z, sx: 0.26, sy: 0.07, sz: 0.5, yaw: yaw + 0.2 }, { castShadow: false });
    }
    const bq = off(c, yaw, 1.7, -0.4);
    barrel(b, bq.x, y, bq.z, 0.85);
    out.stalls.push({ ...off(c, yaw, 0, 1.4), yaw: yaw + Math.PI });
  }
  out.marks.fish_market = { ...A(0.825, QUAY_R + 12.5), y: DECK_Y };
  yield;
  // Drying racks and coiled nets along the boardwalk ends.
  for (let i = 0; i < 6; i++) {
    const u = i < 3 ? 0.752 + i * 0.006 : 0.879 + (i - 3) * 0.006;
    const c = A(u, QUAY_R + 9);
    dryingRack(env.chunks.at('detail', c.x, c.z).builder, c.x, Math.max(DECK_Y, heightAt(c.x, c.z)), c.z, yawOutward(u) + Math.PI / 2, i % 2 === 0);
  }
  // Warehouses (long sheds under grey tile) behind the market, the traders' inn, harbor houses.
  // QUAY_R + 25 keeps them clear of the coast road behind (its chord cuts in to ~QUAY_R + 34 here).
  for (let i = 0; i < 3; i++) {
    const u = 0.776 + i * 0.03;
    const c = A(u, QUAY_R + 25);
    const y = heightAt(c.x, c.z);
    const yaw = yawOutward(u) + Math.PI;
    const b = env.chunks.at('houses', c.x, c.z).builder;
    b.building({ x: c.x, y, z: c.z, w: 18, d: 10, h: 5.2, yaw, wall: 'wood_dark', roof: 'roof_dark', trim: 'wood', roofStyle: 'gable', roofHeight: 3.4, windows: false, plinth: 'stone_grey' });
    const door = off(c, yaw, 0, 5.05);
    b.box('wood', { x: door.x, y: y + 1.7, z: door.z, sx: 3.6, sy: 3.4, sz: 0.12, yaw });
    out.doors.push({ ...off(c, yaw, 0, 6.5), yaw });
    for (let n = 0; n < 4; n++) {
      const q = off(c, yaw, -6 + n * 1.2 + rnd.range(-0.2, 0.2), 6.4);
      b.box('wood_dark', { x: q.x, y: y + 0.45, z: q.z, sx: 0.9, sy: 0.9, sz: 0.9, yaw: rnd.range(0, 1) }, { collide: true, solid: true });
    }
  }
  {
    const u = 0.862;
    const c = A(u, QUAY_R + 30);
    const y = heightAt(c.x, c.z);
    const yaw = yawOutward(u) + Math.PI;
    const b = env.chunks.at('houses', c.x, c.z).builder;
    b.building({ x: c.x, y, z: c.z, w: 13, d: 10, h: 7.2, yaw, wall: 'wood', roof: 'roof_dark', trim: 'wood_dark', roofStyle: 'hip', roofHeight: 3.2, floors: 2, plinth: 'stone_grey' });
    const bal = off(c, yaw, 0, 5.8);
    b.box('wood_dark', { x: bal.x, y: y + 3.6, z: bal.z, sx: 12, sy: 0.2, sz: 1.6, yaw }, { collide: true, walkable: true, solid: true, surface: 'wood' });
    for (let n = 0; n < 5; n++) {
      const q = off(bal, yaw, -5 + n * 2.5, 0.75);
      b.lantern(new THREE.Vector3(q.x, y + 4.6, q.z), { color: 'red', hanging: true });
      out.lanterns.push(new THREE.Vector3(q.x, y + 4.4, q.z));
    }
    const sign = off(c, yaw, 0, 5.25);
    b.box('cloth_blue', { x: sign.x, y: y + 2.9, z: sign.z, sx: 3.4, sy: 0.7, sz: 0.06, yaw }, { castShadow: false });
    out.doors.push({ ...off(c, yaw, 0, 7), yaw });
    out.marks.traders_inn = { ...off(c, yaw, 0, 7), y };
  }
  yield;
  for (let i = 0; i < 6; i++) {
    const u = 0.77 + i * 0.022 + rnd.range(-0.004, 0.004);
    const c = A(u, QUAY_R + 52 + (i % 2) * 9);
    const y = heightAt(c.x, c.z);
    const yaw = yawOutward(u) + Math.PI;
    house(env.chunks.at('houses', c.x, c.z).builder, { x: c.x, z: c.z, y, yaw, w: rnd.range(5.4, 6.4), d: rnd.range(5, 5.8), h: 2.7, floor: rnd.range(0.5, 0.9), roofH: 3, roof: 'roof_dark', wall: 'wood_dark', trim: 'wood', stairs: 'front', porch: rnd.chance(0.5) });
    out.doors.push({ ...off(c, yaw, 0, 4.6), yaw });
  }
  // Crates, barrels and boat hulls on the boardwalk.
  for (let i = 0; i < 10; i++) {
    const u = 0.758 + i * 0.013;
    const c = A(u, QUAY_R + 6.5 + (i % 3) * 0.8);
    const b = env.chunks.at('detail', c.x, c.z).builder;
    if (i % 3 === 0) barrel(b, c.x, DECK_Y, c.z, 0.9);
    else b.box('wood_dark', { x: c.x, y: DECK_Y + 0.4, z: c.z, sx: 0.8, sy: 0.8, sz: 0.8, yaw: i }, { collide: true, solid: true });
  }
}
