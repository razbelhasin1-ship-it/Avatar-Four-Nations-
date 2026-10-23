import * as THREE from 'three';
import { heightAt } from '../../Heightfield';
import type { P2 } from '../../WorldLayout';
import { kitMaterial } from '../../kit/Materials';
import type { ArchetypeId } from './archetypes';
import { pavedStrip } from './cityKit';
import { EarthRegion } from './EarthRegion';
import type { BuildEnv } from './env';
import { crates, lanternPost, marketStall, tree } from './parts';
import { RIVERBEND } from './spots';

/**
 * Riverbend Village: a small timber village on the east bank of the Great
 * River. A main street with wooden houses, a little square with a well and a
 * fish stall, a long trestle footbridge across the gorge, a water mill with a
 * turning waterwheel on a stilt platform, and a boardwalk down the bank to a
 * fishing dock. The river itself is a global water source.
 */
export class Riverbend extends EarthRegion {
  readonly id = 'river_village';
  readonly center: P2 = { x: RIVERBEND.c.x, z: RIVERBEND.c.z };
  readonly loadRadius = 320;
  protected readonly seed = 6631;
  protected override readonly cell = 96;

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    const { chunks, mats, excl, rnd } = env;
    const Y = RIVERBEND.y;
    const B = RIVERBEND.bridge, M = RIVERBEND.mill, D = RIVERBEND.dock, S = RIVERBEND.square;
    const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const street: P2[] = [{ x: 152, z: -636 }, { x: 152, z: -500 }];
    excl.polyline(street, 4.5);
    excl.circle(S.x, S.z, S.r + 2);
    excl.seg(B.a.x + 10, B.a.z, B.a.x - 4, B.a.z, 5);
    excl.seg(M.rampTop.x + 6, M.z, M.hutX, M.z, 5);
    excl.seg(D.top.x + 6, D.top.z, D.end.x, D.end.z, 4);

    // Main street (packed earth with planks) and the square.
    pavedStrip(chunks.named('major', 'street').builder, mats.groundDirt, street, 6, Y + 0.04, 4);
    {
      const b = chunks.named('props', 'square').builder;
      const g = new THREE.CylinderGeometry(S.r, S.r, 0.1, 28);
      b.mesh(mats.groundDirt, g, { x: S.x, y: Y - 0.02, z: S.z }, { castShadow: false });
      g.dispose();
      // Village well (small water source).
      b.cylinder('stone_grey', { x: S.x - 3, y: Y, z: S.z - 2, r: 1.2, h: 0.9, segments: 12 }, { collide: true, walkable: true });
      for (const sd of [-1, 1]) b.box('wood_dark', { x: S.x - 3 + sd * 1.05, y: Y + 1.3, z: S.z - 2, sx: 0.15, sy: 2.6, sz: 0.15 });
      b.roof('roof_dark', { x: S.x - 3, y: Y + 2.5, z: S.z - 2, w: 2.4, d: 1.8, height: 0.8, overhang: 0.3, style: 'gable', curve: 0.2 });
      this.water(b, { id: 'riverbend_well', label: 'Village well', x: S.x - 3, z: S.z - 2, y: Y + 0.75, w: 1.9, d: 1.9, circle: true, capacity: 40, regen: 1, type: 'pond' });
      marketStall(b, S.x + 5, Y, S.z + 8.4, Math.PI, 'cloth_blue', rnd, 3.2, 2);
      crates(chunks.named('detail', 'square_detail').builder, S.x + 8.5, Y, S.z + 9.5, rnd, 3);
      for (const [dx, dz] of [[-8, -6], [8, -6], [-8, 6]]) lanternPost(b, S.x + dx, Y, S.z + dz, 'warm');
    }
    yield;

    // Footbridge across the gorge (deck heights follow the banks).
    {
      const b = chunks.named('major', 'bridge').builder;
      const ya = heightAt(B.a.x, B.a.z) + 0.2, yb = heightAt(B.b.x, B.b.z) + 0.2;
      b.bridge({ a: v3(B.a.x, ya, B.a.z), b: v3(B.b.x, yb, B.b.z), width: 3.2, deck: 'wood', rail: 'wood_dark', support: 'wood_dark', supportBottom: 6, arch: 1.2, surface: 'wood' });
      this.mark('bridgeA', B.a.x, ya, B.a.z);
      this.mark('bridgeB', B.b.x, yb, B.b.z);
      for (const p of [B.a, B.b]) for (const sd of [-1, 1]) lanternPost(chunks.named('props', 'bridge_props').builder, p.x + (p === B.a ? 1.5 : -1.5), heightAt(p.x, p.z), p.z + sd * 2.4, 'red');
    }
    // Water mill: ramp down the bank, stilt platform, hut and the turning wheel.
    {
      const b = chunks.named('major', 'mill').builder;
      const rt = M.rampTop;
      const yTop = heightAt(rt.x, rt.z) + 0.15;
      const px0 = M.hutX - 6, px1 = M.hutX + 6;
      b.bridge({ a: v3(rt.x, yTop, rt.z), b: v3(px1, M.deckY, M.z), width: 2.6, deck: 'wood', rail: 'wood_dark', support: 'wood_dark', supportBottom: 9, surface: 'wood' });
      b.box('wood', { x: M.hutX, y: M.deckY - 0.2, z: M.z, sx: px1 - px0, sy: 0.4, sz: 9 }, { collide: true, walkable: true, surface: 'wood' });
      for (const lx of [px0 + 0.4, M.hutX, px1 - 0.4]) for (const lz of [-4, 4]) {
        const g = heightAt(lx, M.z + lz);
        b.box('wood_dark', { x: lx, y: (g - 1 + M.deckY - 0.4) / 2, z: M.z + lz, sx: 0.4, sy: M.deckY - 0.4 - g + 1, sz: 0.4 });
      }
      b.building({ x: M.hutX + 1, y: M.deckY, z: M.z, w: 6, d: 5.5, h: 3.4, yaw: -Math.PI / 2, wall: 'wood', roof: 'roof_dark', trim: 'wood_dark', roofStyle: 'gable', roofHeight: 1.8, plinth: null });
      // Platform rails on the river side.
      b.box('wood_dark', { x: px0 + 0.2, y: M.deckY + 0.55, z: M.z - 3.2, sx: 0.12, sy: 1.1, sz: 2.4 }, { collide: true, walkable: false });
      // Waterwheel (animated): rim, spokes and paddles; axle along X.
      const parts: THREE.BufferGeometry[] = [];
      const R = M.wheelR;
      for (const sx of [-0.7, 0.7]) {
        const rim = new THREE.TorusGeometry(R, 0.16, 6, 28);
        rim.rotateY(Math.PI / 2);
        rim.translate(sx, 0, 0);
        parts.push(rim);
      }
      for (let i = 0; i < 8; i++) {
        const sp = new THREE.BoxGeometry(0.18, R * 2, 0.18);
        sp.rotateX((i / 8) * Math.PI);
        parts.push(sp);
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const pd = new THREE.BoxGeometry(1.7, 0.1, 0.9);
        pd.rotateX(a);
        pd.translate(0, Math.sin(a) * (R - 0.2), Math.cos(a) * (R - 0.2));
        parts.push(pd);
      }
      const axle = new THREE.CylinderGeometry(0.25, 0.25, (px0 - M.wheelX) + 2.5, 8);
      axle.rotateZ(Math.PI / 2);
      axle.translate(((px0 - M.wheelX) + 2.5) / 2 - 1, 0, 0);
      parts.push(axle);
      const geo = mergeSimple(parts);
      const wheel = new THREE.Mesh(geo, kitMaterial('wood_dark'));
      wheel.position.set(M.wheelX, M.wheelY, M.z);
      wheel.castShadow = true;
      chunks.named('major', 'mill').add(wheel);
      env.animated.push((dt) => {
        wheel.rotation.x -= dt * 0.7;
      });
      this.mark('mill', M.hutX, M.deckY, M.z);
    }
    // Boardwalk down the bank (follows the terrain) and the fishing pier.
    {
      const b = chunks.named('major', 'dock').builder;
      const nodes: Array<{ x: number; y: number; z: number }> = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const x = D.top.x + ((D.foot.x - D.top.x) * i) / steps;
        const y = i === steps ? D.y : heightAt(x, D.top.z) + 0.25;
        nodes.push({ x, y: Math.max(y, D.y), z: D.top.z });
      }
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i], c = nodes[i + 1];
        b.bridge({ a: v3(a.x, a.y, a.z), b: v3(c.x, c.y, c.z), width: 2.4, deck: 'wood', rail: i === 0 ? null : 'wood_dark', support: null, surface: 'wood' });
      }
      b.bridge({ a: v3(D.foot.x, D.y, D.foot.z), b: v3(D.end.x, D.y, D.end.z), width: 3.2, deck: 'wood', rail: 'wood_dark', support: 'wood_dark', supportBottom: 7, surface: 'wood' });
      // A moored boat.
      b.block('wood_dark', { x: (D.foot.x + D.end.x) / 2, y: D.y - 1.6, z: D.end.z + 3.4, sx: 7, sy: 0.9, sz: 2.2 });
      b.box('wood', { x: (D.foot.x + D.end.x) / 2, y: D.y - 0.66, z: D.end.z + 3.4, sx: 6.6, sy: 0.08, sz: 1.9 });
      this.mark('dockEnd', D.end.x + 1.5, D.y, D.end.z);
      this.mark('dockTop', D.top.x, nodes[0].y, D.top.z);
      this.npc({ id: 'riverbend_amb_fisher', name: 'Fisherman', role: 'villager', nation: 'earth', appearanceSeed: 9100, x: D.end.x + 3, z: D.end.z - 1, y: D.y, yaw: -Math.PI / 2, behavior: { type: 'idle', variant: 'sit' }, region: 'earth_heartland', marker: 'none' });
    }
    yield;

    // Wooden houses along the street (only where the bank is flat).
    const types: Array<[ArchetypeId, number]> = [['R1', 3], ['R1s', 1], ['F1', 1.5], ['F3', 1], ['F2', 0.6]];
    let count = 0;
    for (const side of [-1, 1, 2]) {
      let z = side === 2 ? -625 : -632;
      while (z < -504) {
        const id = pick(rnd, types);
        const a = env.arch[id];
        const w = a.spanW;
        const zc = z + w / 2;
        z += w + rnd.range(1.5, 4);
        // Two rows facing the street, plus a back row on the east side facing the fields.
        const x = side === 2 ? 152 + 5 + 10 + 3 + a.spanD / 2 : 152 + side * (5 + a.spanD / 2);
        const yaw = side === 2 ? Math.PI / 2 : side > 0 ? -Math.PI / 2 : Math.PI / 2;
        if (excl.rectBlocked(x, zc, a.spanD / 2, w / 2, 0, 0.5)) continue;
        const hs = [heightAt(x, zc), heightAt(x - a.d / 2, zc - a.w / 2), heightAt(x + a.d / 2, zc + a.w / 2), heightAt(x - a.d / 2, zc + a.w / 2), heightAt(x + a.d / 2, zc - a.w / 2)];
        const lo = Math.min(...hs), hi = Math.max(...hs);
        if (hi - lo > 1.2) continue;
        env.chunks.addHouse(a, x, lo, zc, yaw, { tint: new THREE.Color().setHSL(0.08, 0.2, 0.9 + rnd.range(-0.06, 0.06)) });
        count++;
        const tx = x + Math.sign(side) * (a.spanD / 2 + 2);
        if (rnd.chance(0.35) && !excl.pointBlocked(tx, zc, 1)) tree(chunks.at('props', x, zc).builder, mats, tx, heightAt(tx, zc), zc, rnd.range(0.9, 1.3), rnd.chance(0.5) ? 'round' : 'pine', rnd.range(0, 6));
      }
    }
    this.mark('houses', count, 0, 0);
    // Villagers.
    this.npc({ id: 'riverbend_amb_1', name: 'Villager', role: 'villager', nation: 'earth', appearanceSeed: 9101, x: 150, z: -560, y: Y, yaw: 0, behavior: { type: 'wander', radius: 12 }, region: 'earth_heartland', marker: 'none' });
    this.npc({ id: 'riverbend_amb_2', name: 'Fishmonger', role: 'merchant', nation: 'earth', appearanceSeed: 9102, x: S.x - 5, z: S.z + 10.3, y: Y, yaw: Math.PI, behavior: { type: 'idle', variant: 'work' }, region: 'earth_heartland', marker: 'none' });
    this.npc({ id: 'riverbend_amb_3', name: 'Miller', role: 'villager', nation: 'earth', appearanceSeed: 9103, x: M.hutX + 4.5, z: M.z + 3, y: M.deckY, yaw: -Math.PI / 2, behavior: { type: 'idle', variant: 'work' }, region: 'earth_heartland', marker: 'none' });
  }
}

function pick<T>(rnd: { next(): number }, list: Array<[T, number]>): T {
  let tot = 0;
  for (const [, w] of list) tot += w;
  let r = rnd.next() * tot;
  for (const [v, w] of list) {
    r -= w;
    if (r <= 0) return v;
  }
  return list[list.length - 1][0];
}

/** Merge non-indexed/indexed geometries (position + normal) into one. */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    const na = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      nrm.push(na.getX(i), na.getY(i), na.getZ(i));
    }
    if (g !== p) g.dispose();
    p.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}
