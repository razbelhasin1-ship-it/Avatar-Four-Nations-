import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { KYOSHI } from './layout';
import { W, barrel, boat, crate, disc, drape, ekHouse, fence, lanternPost, rng, roadShrine, v3 } from './parts';
import { WildsSite } from './WildsSite';

/**
 * Kyoshi Island village (plateau y = 6): timber houses with dark tiled roofs
 * around a plaza, the great statue of Avatar Kyoshi holding her fans, the
 * Kyoshi Warriors' dojo with an open training yard (training_oyagi), a pier
 * with moored boats (dock_kyoshi), fences, gardens and a shrine by the pond.
 */
export class KyoshiSite extends WildsSite {
  readonly id = 'wilds_kyoshi_village';
  readonly center = { x: KYOSHI.C.x, z: KYOSHI.C.z };
  override readonly loadRadius = 330;

  protected construct(_ctx: GameContext): void {
    const K = KYOSHI;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const Y = K.Y;
    const r = rng(1820);

    // --- Plaza ------------------------------------------------------------------------------
    disc(D, 'paving', K.C.x, Y + 0.04, K.C.z, 12.5, 0.12, 36);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      if (Math.abs(Math.sin(a)) > 0.92) continue; // keep north (statue) and south openings
      lanternPost(D, K.C.x + Math.cos(a) * 13.5, K.C.z + Math.sin(a) * 13.5, 'red', Y);
    }

    // --- Statue of Avatar Kyoshi (faces south over the plaza) ----------------------------------
    {
      const s = K.statue;
      M.block('stone_grey', { x: s.x, y: Y - 0.3, z: s.z, sx: 9, sy: 1.1, sz: 9 }, { collide: true });
      M.block('stone_light', { x: s.x, y: Y + 0.8, z: s.z, sx: 6.6, sy: 2.2, sz: 6.6 }, { collide: true });
      const by = Y + 3;
      const robe = 'stone_green';
      M.cylinder(robe, { x: s.x, y: by, z: s.z, r: 2.3, rTop: 1.25, h: 5.6, segments: 16 });
      M.cylinder('gold', { x: s.x, y: by + 2.6, z: s.z, r: 1.85, rTop: 1.8, h: 0.35, segments: 16 });
      M.box(robe, { x: s.x, y: by + 7, z: s.z, sx: 2.6, sy: 3, sz: 1.5 });
      M.box('jade', { x: s.x, y: by + 7.1, z: s.z + 0.78, sx: 1.4, sy: 2.4, sz: 0.06 });
      for (const sd of [-1, 1]) {
        // Shoulder plates and arms raised outward holding the fans.
        M.box('gold', { x: s.x + sd * 1.55, y: by + 8.3, z: s.z, sx: 1.1, sy: 0.4, sz: 1.6, roll: sd * 0.35 });
        M.mesh(robe, new THREE.CylinderGeometry(0.42, 0.5, 3.6, 10), { x: s.x + sd * 2.6, y: by + 9.1, z: s.z + 0.3, roll: -sd * 1.05, pitch: -0.25 });
        // Golden war fans (double-sided cloth) with dark ribs.
        const fan = new THREE.CircleGeometry(2.4, 18, 0, Math.PI);
        M.mesh('cloth_yellow', fan, { x: s.x + sd * 4.2, y: by + 10.6, z: s.z + 0.7, roll: -sd * 0.5 });
        fan.dispose();
        for (let k = 0; k < 5; k++) {
          const a = (k / 4) * Math.PI;
          const rr = -sd * 0.5;
          const lx = Math.cos(a) * 1.2, ly = Math.sin(a) * 1.2;
          M.box('wood_dark', { x: s.x + sd * 4.2 + lx * Math.cos(rr) - ly * Math.sin(rr), y: by + 10.6 + lx * Math.sin(rr) + ly * Math.cos(rr), z: s.z + 0.73, sx: 2.4, sy: 0.06, sz: 0.04, roll: a + rr });
        }
      }
      M.mesh('stone_light', new THREE.SphereGeometry(0.85, 14, 10), { x: s.x, y: by + 9.4, z: s.z + 0.05 });
      // Headdress: gold crown band with a raised front plate.
      M.cylinder('roof_gold', { x: s.x, y: by + 9.75, z: s.z, r: 0.92, h: 0.38, segments: 14 });
      M.box('roof_gold', { x: s.x, y: by + 10.5, z: s.z + 0.55, sx: 1.3, sy: 1.1, sz: 0.12, pitch: -0.2 });
      M.box('black_lacquer', { x: s.x, y: by + 9.15, z: s.z + 0.8, sx: 0.9, sy: 0.18, sz: 0.06 });
      M.collider({ shape: 'cylinder', x: s.x, y: by + 5, z: s.z, r: 2.3, hy: 5, walkable: false, solid: true });
      for (const sd of [-1, 1]) D.lantern(v3(s.x + sd * 4, Y + 2.2, s.z + 4.4), { color: 'warm', post: true });
      this.mark('statue', s.x, by + 10, s.z);
    }

    // --- Dojo and training yard -------------------------------------------------------------
    {
      const d = K.dojo;
      M.block('stone_grey', { x: d.x, y: Y - 0.4, z: d.z, sx: d.w + 1.2, sy: 1, sz: d.d + 1.2 }, { collide: true });
      M.building({ x: d.x, y: Y + 0.6, z: d.z, w: d.w, d: d.d, h: 5.4, wall: 'wood', roof: 'roof_dark', trim: 'wood_red', roofStyle: 'hip', plinth: null, roofHeight: 4, windows: true });
      // Veranda posts and steps facing the yard (south).
      for (let k = -4; k <= 4; k += 2) M.box('wood_red', { x: d.x + k * 2, y: Y + 3.1, z: d.z + d.d / 2 + 1.4, sx: 0.3, sy: 5, sz: 0.3 }, { collide: true, walkable: false });
      M.box('roof_dark', { x: d.x, y: Y + 5.7, z: d.z + d.d / 2 + 1.5, sx: d.w + 1, sy: 0.25, sz: 3.4, pitch: 0.25 });
      M.box('wood', { x: d.x, y: Y + 0.2, z: d.z + d.d / 2 + 1.4, sx: d.w, sy: 0.4, sz: 2.6 }, { collide: true, surface: 'wood' });
      M.box(W('banner_earth'), { x: d.x, y: Y + 4.2, z: d.z + d.d / 2 + 0.05, sx: 2.2, sy: 2.6, sz: 0.05 }, { castShadow: false });
      // Yard: packed sand square with a low fence on the west and south sides.
      const y = K.yard;
      drape(D, 'paving', y.x, y.z, 27, 26, { lift: 0.05, tile: 3 });
      fence(D, [{ x: y.x - 14, z: y.z - 13 }, { x: y.x - 14, z: y.z + 14 }, { x: y.x + 6, z: y.z + 14 }], { h: 1 });
      // Practice posts and fan racks outside the open radius.
      for (const [dx, dz] of [[-13, -6], [-13, 3], [-8, 13.2], [0, 13.2]]) {
        const px = y.x + dx, pz = y.z + dz;
        D.cylinder('wood', { x: px, y: Y, z: pz, r: 0.22, h: 2, segments: 8 }, { collide: true, walkable: false });
        D.box('wood_dark', { x: px, y: Y + 1.5, z: pz, sx: 1.2, sy: 0.14, sz: 0.14 });
      }
      for (const dz of [-9, -6.5]) {
        D.box('wood_dark', { x: y.x + 13.4, y: Y + 1, z: y.z + dz, sx: 0.4, sy: 2, sz: 2 }, { collide: true, walkable: false });
        D.box('gold', { x: y.x + 13.15, y: Y + 1.4, z: y.z + dz, sx: 0.05, sy: 0.9, sz: 1.5 }, { castShadow: false });
      }
      this.mark('yard', y.x, Y, y.z);
    }

    // --- Houses ---------------------------------------------------------------------------------
    const houses: Array<[number, number, number, number, number]> = [
      // x, z, yaw (front), w, d
      [1790, -490, 0, 8, 6],
      [1806, -492, 0, 7, 6],
      [1836, -491, 0, 8, 6.5],
      [1853, -486, -0.3, 7, 6],
      [1853, -455, -Math.PI / 2, 7.5, 6],
      [1857, -427, -Math.PI / 2, 8, 6],
      [1872, -470, -Math.PI / 2, 7, 6],
      [1874, -412, -Math.PI / 2, 7, 6],
      [1800, -403, Math.PI, 8, 6],
      [1781, -401, Math.PI, 7, 6],
      [1760, -430, Math.PI / 2, 7, 6.5],
      [1760, -455, Math.PI / 2, 7, 6],
      [1858, -400, -Math.PI / 2 - 0.5, 6.5, 5.5],
    ];
    for (const [x, z, yaw, w, d] of houses) {
      ekHouse(M, x, z, yaw, { w, d, floors: r() < 0.3 ? 2 : 1, wall: 'wood', roof: r() < 0.7 ? 'roof_dark' : 'roof_teal', base: 'stone_grey' });
      // Garden fence behind the house.
      const bx = x - Math.sin(yaw) * (d / 2 + 4), bz = z - Math.cos(yaw) * (d / 2 + 4);
      const cx = Math.cos(yaw), sz = -Math.sin(yaw);
      if (r() < 0.6) fence(D, [{ x: bx + cx * (w / 2), z: bz + sz * (w / 2) }, { x: bx - cx * (w / 2), z: bz - sz * (w / 2) }], { h: 0.9 });
      if (r() < 0.5) barrel(D, x + Math.sin(yaw) * (d / 2 + 0.8) + cx * (w / 2 - 0.6), z + Math.cos(yaw) * (d / 2 + 0.8) + sz * (w / 2 - 0.6));
    }
    this.mark('houses', houses.length, 0, 0);

    // --- Pier, boats, fish market --------------------------------------------------------------
    {
      const p = K.pier;
      const gy = this.ctx.world.heightAt(p.x0, p.z);
      M.bridge({ a: v3(p.x0, gy + 0.05, p.z), b: v3(p.x1, p.y, p.z), width: 3.2, deck: 'wood', rail: 'wood_dark', support: 'wood_dark', supportBottom: -4, surface: 'wood' });
      M.box('wood', { x: p.x1 - 2, y: p.y - 0.2, z: p.z, sx: 4, sy: 0.4, sz: 7 }, { collide: true, surface: 'wood' });
      for (const sd of [-1, 1]) for (const dx of [-3.6, -0.4]) D.cylinder('wood_dark', { x: p.x1 + dx, y: -3, z: p.z + sd * 3.3, r: 0.18, h: p.y + 3.8, segments: 6 }, { collide: true, walkable: false });
      boat(D, p.x1 - 10, 0.05, p.z + 4.2, 0.05, 7, { mast: true, sail: 'cloth_white' });
      boat(D, p.x1 - 2, 0.05, p.z - 6.6, Math.PI + 0.1, 8.5, { mast: true, sail: W('sail') });
      boat(D, p.x0 + 9, 0.05, p.z - 4.3, 0.2, 5);
      for (const sd of [-1, 1]) D.lantern(v3(p.x1 - 0.3, p.y + 2.3, p.z + sd * 1.5), { color: 'warm', post: true });
      // Fish market stall near the pier root (merchant_kyoshi_1 stands west of the counter).
      const mx = K.shoreX - 12.5, mz = -453;
      const my = this.ctx.world.heightAt(mx, mz);
      D.block('wood', { x: mx, y: my, z: mz, sx: 1, sy: 1, sz: 3.2 }, { collide: true, surface: 'wood' });
      for (let k = 0; k < 6; k++) {
        const m = new THREE.Matrix4().compose(v3(mx, my + 1.08, mz - 1.2 + k * 0.48), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3 * k), v3(1, 0.5, 0.4));
        D.instance('fish', () => new THREE.SphereGeometry(0.32, 8, 6), 'iron', m, false);
      }
      for (const dz of [-1.8, 1.8]) for (const dx of [-0.6, 1.8]) D.box('wood_dark', { x: mx + dx, y: my + 1.3, z: mz + dz, sx: 0.12, sy: 2.6, sz: 0.12 });
      D.box('cloth_blue', { x: mx + 0.6, y: my + 2.65, z: mz, sx: 3.2, sy: 0.06, sz: 4.2, roll: 0.15 }, { castShadow: false });
      crate(D, mx + 2.6, mz + 2.4, 0.8, 0.2);
      crate(D, mx + 2.4, mz - 2.6, 0.9, 0.6);
      // Path from the plaza to the pier.
      drape(D, 'paving_dark', (K.C.x + 13 + p.x0) / 2, p.z + 0.5, p.x0 - K.C.x - 12, 3.2, { lift: 0.04, tile: 3 });
      this.mark('pierEnd', p.x1 - 1.5, p.y, p.z);
    }

    // --- Shrine by the pond, garden plots, nets -----------------------------------------------
    roadShrine(D, 1811, -383, Math.PI / 2, { roof: 'roof_dark' });
    for (let i = 0; i < 3; i++) {
      const gx = 1772 + i * 9, gz = -503;
      fence(D, [{ x: gx - 3.5, z: gz - 3 }, { x: gx + 3.5, z: gz - 3 }, { x: gx + 3.5, z: gz + 3 }, { x: gx - 3.5, z: gz + 3 }], { h: 0.8, closed: true });
      drape(Cl, W('crops'), gx, gz, 6.4, 5.4, { lift: 0.05, tile: 2 });
    }
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2, rr = 16 + r() * 30;
      const x = K.C.x + Math.cos(a) * rr, z = K.C.z + Math.sin(a) * rr;
      if (Math.hypot(x - K.yard.x, z - K.yard.z) < 15 || Math.hypot(x - K.statue.x, z - K.statue.z) < 8 || Math.hypot(x - 1840, z - -380) < 18) continue;
      const m = new THREE.Matrix4().compose(v3(x, Y + 0.4, z), new THREE.Quaternion(), v3(1.2 + r(), 0.8 + r() * 0.5, 1.2 + r()));
      Cl.instance('kyoshi_bush', () => new THREE.IcosahedronGeometry(0.7, 1), W('foliage'), m);
    }
  }
}
