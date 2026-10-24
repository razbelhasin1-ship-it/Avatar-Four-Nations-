import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { DEN, ICE_BRIDGE, TUNDRA } from './layout';
import { W, bannerPole, boat, crate, firePit, ground, lanternPost, rng, rock, rockGeo, signpost, v3, yawFacing } from './parts';
import { WildsSite } from './WildsSite';

/**
 * The north between the Water Tribe and the Earth Kingdom:
 *  - Tundra Watchtower: an ice-brick tower with a ramp to its lookout, a
 *    vaulted ice lodge, snow walls, drying racks, sled and a fire pit.
 *  - Snowdrift Den: a sheltered hollow among snow-capped rocks, ice shards and
 *    an overhang, with three polar bear dog nests and tracks.
 *  - Ice path: cairns and blue lanterns from the northern road to the
 *    watchtower, crossing the Great River on an ice bridge.
 */
export class TundraOutpostSite extends WildsSite {
  readonly id = 'wilds_tundra_outpost';
  readonly center = { x: TUNDRA.O.x, z: TUNDRA.O.z };
  override readonly loadRadius = 300;

  protected construct(_ctx: GameContext): void {
    const T = TUNDRA;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const r = rng(1050);

    // --- Watchtower and ramp ----------------------------------------------------------------
    {
      const t = T.tower;
      M.block('ice', { x: t.x, y: T.towerBase - 1.5, z: t.z, sx: t.s, sy: T.towerTop - T.towerBase + 1.5, sz: t.s }, { collide: true, surface: 'ice' });
      M.block('ice_deep', { x: t.x, y: T.towerBase - 1.5, z: t.z, sx: t.s + 0.8, sy: 2.4, sz: t.s + 0.8 });
      M.box('snow', { x: t.x, y: T.towerTop - 0.02, z: t.z, sx: t.s - 0.2, sy: 0.08, sz: t.s - 0.2 });
      // Parapet on three sides (the ramp arrives from the east side).
      for (const [dx, dz, sx, sz] of [[0, -t.s / 2 + 0.3, t.s, 0.6], [0, t.s / 2 - 0.3, t.s, 0.6], [-t.s / 2 + 0.3, 0, 0.6, t.s]] as const) {
        M.block('ice', { x: t.x + dx, y: T.towerTop, z: t.z + dz, sx, sy: 1.1, sz }, { collide: true, walkable: false, surface: 'ice' });
      }
      // Hide canopy on four poles.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) D.box('wood_dark', { x: t.x + sx * (t.s / 2 - 0.5), y: T.towerTop + 1.6, z: t.z + sz * (t.s / 2 - 0.5), sx: 0.18, sy: 3.2, sz: 0.18 }, { collide: true, walkable: false });
      D.roof('cloth_white', { x: t.x, y: T.towerTop + 3.1, z: t.z, w: t.s - 0.6, d: t.s - 0.6, height: 1.6, style: 'hip', overhang: 0.5, ridge: null });
      bannerPole(D, t.x - t.s / 2 + 0.9, t.z, Math.PI / 2, W('banner_water'), { h: 5.5, y: T.towerTop });
      D.lantern(v3(t.x + t.s / 2 - 0.6, T.towerTop + 2.4, t.z + t.s / 2 - 0.6), { color: 'blue' });
      const a = v3(T.ramp.x0, ground(T.ramp.x0, T.ramp.z) + 0.05, T.ramp.z);
      const b = v3(T.ramp.x1, T.towerTop, T.ramp.z);
      M.bridge({ a, b, width: 2.6, deck: 'ice', rail: 'ice_deep', support: null, surface: 'ice' });
      // Ice pillars under the ramp (tops kept below the sloped walking surface).
      for (const f of [0.35, 0.68]) {
        const px = a.x + (b.x - a.x) * f;
        const lowEnd = a.y + (b.y - a.y) * (f - 0.45 / Math.abs(b.x - a.x));
        const gy = ground(px, T.ramp.z);
        const top = lowEnd - 0.55;
        if (top - gy > 0.6) M.box('ice_deep', { x: px, y: (gy - 0.5 + top) / 2, z: T.ramp.z, sx: 0.9, sy: top - gy + 0.5, sz: 2 }, { collide: true, walkable: false, surface: 'ice' });
      }
      this.mark('rampFoot', a.x, a.y, a.z);
      this.mark('towerTop', t.x, T.towerTop, t.z);
    }

    // --- Lodge: vaulted ice hall -------------------------------------------------------------
    {
      const l = T.lodge;
      const yaw = yawFacing(T.O.x - l.x, T.O.z - l.z);
      const y = ground(l.x, l.z) - 0.4;
      M.block('ice', { x: l.x, y, z: l.z, sx: l.w, sy: 2.2, sz: l.d, yaw }, { collide: true, surface: 'ice' });
      const vault = new THREE.CylinderGeometry(l.d / 2, l.d / 2, l.w, 14, 1, false, 0, Math.PI);
      vault.rotateZ(Math.PI / 2);
      M.mesh('ice', vault, { x: l.x, y: y + 2.2, z: l.z, yaw });
      vault.dispose();
      M.collider({ shape: 'box', x: l.x, y: y + 3.4, z: l.z, hx: l.w / 2, hy: 1.4, hz: l.d / 2 - 0.6, yaw, walkable: true, solid: true, surface: 'snow' });
      // Entrance tunnel with a dark doorway on the front.
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const tun = new THREE.CylinderGeometry(1.4, 1.4, 2.4, 10, 1, false, 0, Math.PI);
      tun.rotateZ(Math.PI / 2);
      M.mesh('ice_deep', tun, { x: l.x + fx * (l.d / 2 + 1), y: y + 0.4, z: l.z + fz * (l.d / 2 + 1), yaw: yaw + Math.PI / 2 });
      tun.dispose();
      M.box(W('dark'), { x: l.x + fx * (l.d / 2 + 2.22), y: y + 1.2, z: l.z + fz * (l.d / 2 + 2.22), sx: 1.3, sy: 1.6, sz: 0.04, yaw });
      M.collider({ shape: 'box', x: l.x + fx * (l.d / 2 + 1), y: y + 1.2, z: l.z + fz * (l.d / 2 + 1), hx: 1.4, hy: 1.2, hz: 1.2, yaw, walkable: true, solid: true, surface: 'ice' });
      bannerPole(D, l.x + fx * (l.d / 2 + 2.6) + Math.cos(yaw) * 3, l.z + fz * (l.d / 2 + 2.6) - Math.sin(yaw) * 3, yaw, W('banner_water'), { h: 4.5 });
      // Trader's goods by the door (merchant_tundra_1).
      crate(D, l.x + fx * (l.d / 2 + 3.2) - Math.cos(yaw) * 3.4, l.z + fz * (l.d / 2 + 3.2) + Math.sin(yaw) * 3.4, 0.8, yaw);
      for (let k = 0; k < 3; k++) D.cylinder(W('fur'), { x: l.x + fx * (l.d / 2 + 3.6) - Math.cos(yaw) * (2 - k * 0.7), y: ground(l.x, l.z), z: l.z + fz * (l.d / 2 + 3.6) + Math.sin(yaw) * (2 - k * 0.7), r: 0.45, h: 0.25 + k * 0.1, segments: 8 });
      this.mark('lodge', l.x, y, l.z);
    }

    // --- Fire pit, benches, racks, sled, canoe ------------------------------------------------------
    {
      const f = T.fire;
      const fy = ground(f.x, f.z);
      firePit(D, f.x, f.z, fy);
      this.addFire(f.x, fy + 0.3, f.z, 1);
      for (let k = 0; k < 3; k++) {
        const a = 0.6 + k * 1.9;
        const bx = f.x + Math.cos(a) * 2.8, bz = f.z + Math.sin(a) * 2.8;
        D.box('wood_dark', { x: bx, y: ground(bx, bz) + 0.25, z: bz, sx: 2, sy: 0.4, sz: 0.5, yaw: -a + Math.PI / 2 }, { collide: true, surface: 'wood' });
      }
      // Drying racks with fish.
      for (const [rx, rz] of [[T.O.x + 12, T.O.z + 8], [T.O.x + 15, T.O.z + 2]]) {
        const ry = ground(rx, rz);
        for (const s of [-1, 1]) D.box('wood_dark', { x: rx + s * 1.5, y: ry + 1.1, z: rz, sx: 0.14, sy: 2.2, sz: 0.14 }, { collide: true, walkable: false });
        D.box('wood_dark', { x: rx, y: ry + 2.1, z: rz, sx: 3.2, sy: 0.1, sz: 0.1 });
        for (let k = 0; k < 6; k++) {
          const m = new THREE.Matrix4().compose(v3(rx - 1.2 + k * 0.48, ry + 1.65, rz), new THREE.Quaternion(), v3(0.35, 1, 0.2));
          D.instance('dried_fish', () => new THREE.SphereGeometry(0.4, 8, 6), 'iron', m, false);
        }
      }
      // Sled and canoe.
      const sx = T.O.x - 9, sz = T.O.z + 9;
      const sy = ground(sx, sz);
      D.box('wood', { x: sx, y: sy + 0.45, z: sz, sx: 3, sy: 0.12, sz: 1.1, yaw: 0.4 }, { collide: true, surface: 'wood' });
      for (const s of [-1, 1]) D.box('wood_dark', { x: sx + Math.sin(0.4) * s * 0.5, y: sy + 0.15, z: sz + Math.cos(0.4) * s * 0.5, sx: 3.4, sy: 0.08, sz: 0.08, yaw: 0.4 });
      boat(D, T.O.x - 14, ground(T.O.x - 14, T.O.z + 2) + 0.1, T.O.z + 2, 1.3, 5.5, { collide: true });
      for (const [lx, lz] of [[T.O.x + 7, T.O.z - 7], [T.O.x - 7, T.O.z + 7], [T.O.x + 9, T.O.z + 11]]) lanternPost(D, lx, lz, 'blue');
    }

    // --- Snow walls (windbreak) on the western side -------------------------------------------------------
    for (let i = 0; i < 16; i++) {
      const a = (150 + i * 7) * (Math.PI / 180);
      const rr = 23 + Math.sin(i * 1.3) * 1.2;
      const x = T.O.x + Math.cos(a) * rr, z = T.O.z + Math.sin(a) * rr;
      if (Math.hypot(x - T.tower.x, z - T.tower.z) < 7) continue;
      const y = ground(x, z);
      M.box('ice', { x, y: y + 0.55, z, sx: 1.7, sy: 1.3, sz: 0.9, yaw: -a + Math.PI / 2 }, { collide: true, surface: 'ice' });
      if (i % 2 === 0) Cl.box('snow', { x, y: y + 1.32, z, sx: 1.5, sy: 0.25, sz: 0.8, yaw: -a + Math.PI / 2 });
    }
    for (let i = 0; i < 8; i++) {
      const a = r() * Math.PI * 2, rr = 30 + r() * 15;
      rock(Cl, W('rock_snow'), T.O.x + Math.cos(a) * rr, T.O.z + Math.sin(a) * rr, 1.5 + r() * 2, 1 + r(), 1.4 + r() * 2, { collide: false, variant: i });
    }
  }
}

export class SnowdriftDenSite extends WildsSite {
  readonly id = 'wilds_snowdrift_den';
  readonly center = { x: DEN.C.x, z: DEN.C.z };
  override readonly loadRadius = 260;

  protected construct(_ctx: GameContext): void {
    const C = DEN.C;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const r = rng(1260);
    const RS = W('rock_snow');

    // Sheltering arc of snow-capped boulders on the uphill (east) side.
    for (let i = 0; i < 13; i++) {
      const a = (-115 + i * 19) * (Math.PI / 180);
      const rr = 15 + r() * 4;
      const s = 4 + r() * 4;
      rock(M, RS, C.x + Math.cos(a) * rr, C.z + Math.sin(a) * rr, s * 1.2, s, s, { yaw: r() * 6, variant: i });
    }
    // Overhang slab resting on two boulders: a shelter the pack sleeps under.
    {
      const ox = C.x + 10.5, oz = C.z + 1;
      const gy = ground(ox, oz);
      rock(M, RS, ox + 1.5, oz - 4.2, 3.4, 6.6, 3, { variant: 2 });
      rock(M, RS, ox + 1.5, oz + 4.2, 3.4, 6.8, 3, { variant: 4 });
      M.mesh(RS, rockGeo(5), { x: ox + 1, y: gy + 5.6, z: oz, sx: 8, sy: 1.6, sz: 11, yaw: 0.1 });
      M.collider({ shape: 'box', x: ox + 1, y: gy + 5.6, z: oz, hx: 3.2, hy: 0.6, hz: 4.6, yaw: 0.1, walkable: true, solid: true, surface: 'snow' });
      this.mark('overhang', ox, gy, oz);
    }
    // Ice shards among the rocks.
    for (let i = 0; i < 9; i++) {
      const a = (-90 + i * 22) * (Math.PI / 180) + r() * 0.2;
      const rr = 12 + r() * 6;
      const x = C.x + Math.cos(a) * rr, z = C.z + Math.sin(a) * rr;
      const h = 2.5 + r() * 3.5;
      M.mesh('ice_deep', new THREE.ConeGeometry(0.7, h, 5), { x, y: ground(x, z) + h / 2 - 0.3, z, pitch: (r() - 0.5) * 0.5, roll: (r() - 0.5) * 0.5 });
      M.collider({ shape: 'cylinder', x, y: ground(x, z) + h / 2, z, r: 0.5, hy: h / 2, walkable: false, solid: true });
    }
    // Nests: bedding rings, fur, bones and fish scraps.
    DEN.nests.forEach((n, i) => {
      const x = C.x + n.dx, z = C.z + n.dz;
      const y = ground(x, z);
      const ring = new THREE.TorusGeometry(1.6, 0.45, 6, 14);
      ring.rotateX(Math.PI / 2);
      D.mesh(W('straw'), ring, { x, y: y + 0.18, z, sy: 0.7 });
      ring.dispose();
      D.cylinder(W('fur'), { x, y: y - 0.05, z, r: 1.3, h: 0.18, segments: 12 });
      for (let k = 0; k < 4; k++) {
        const a = r() * Math.PI * 2;
        const m = new THREE.Matrix4().compose(v3(x + Math.cos(a) * 2.6, y + 0.08, z + Math.sin(a) * 2.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, a)), v3(1, 1, 1));
        Cl.instance('bone', () => new THREE.CylinderGeometry(0.07, 0.07, 0.8, 5), 'stone_white', m, false);
      }
      this.mark(`nest_${i + 1}`, x, y, z);
    });
    // Paw-print tracks leading down the slope (west-north-west).
    let px = C.x - 4, pz = C.z - 1, heading = Math.PI + 0.25;
    for (let i = 0; i < 46; i++) {
      heading += Math.sin(i * 0.4) * 0.05;
      px += Math.cos(heading) * 1.3;
      pz += Math.sin(heading) * 1.3;
      for (const s of [-1, 1]) {
        const x = px - Math.sin(heading) * s * 0.35, z = pz + Math.cos(heading) * s * 0.35;
        const m = new THREE.Matrix4().compose(v3(x, ground(x, z) + 0.03, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading), v3(1, 1, 1));
        Cl.instance('paw', () => new THREE.CylinderGeometry(0.22, 0.22, 0.04, 8), 'stone_dark', m, false);
      }
    }
  }
}

export class IcePathSite extends WildsSite {
  readonly id = 'wilds_ice_path';
  readonly center = { x: -50, z: ICE_BRIDGE.a.z };
  override readonly loadRadius = 320;

  protected construct(_ctx: GameContext): void {
    const B = ICE_BRIDGE;
    const M = this.major, D = this.detail;
    // Ice bridge across the Great River.
    const a = v3(B.a.x, B.a.y, B.a.z), c = v3(B.c.x, B.c.y, B.c.z);
    M.bridge({ a, b: c, width: B.width, deck: 'ice', rail: 'ice_deep', support: 'ice_deep', supportBottom: Math.min(B.a.y, B.c.y) - 5, arch: B.hump, surface: 'ice' });
    // Ice arch rib under the deck.
    const R = (c.x - a.x) / 2 - 1;
    const base = Math.min(a.y, c.y) - 1;
    const rise = Math.max(a.y, c.y) + B.hump - 0.55 - base;
    for (const dz of [-B.width / 2 + 0.4, B.width / 2 - 0.4]) {
      const rib = new THREE.TorusGeometry(R, 0.45, 6, 20, Math.PI);
      M.mesh('ice_deep', rib, { x: (a.x + c.x) / 2, y: base, z: a.z + dz, sy: rise / R });
      rib.dispose();
    }
    for (const p of [a, c]) for (const s of [-1, 1]) lanternPost(D, p.x + (p === a ? -1.2 : 1.2), p.z + s * 2.2, 'blue', ground(p.x + (p === a ? -1.2 : 1.2), p.z + s * 2.2));
    this.mark('bridgeA', a.x, a.y, a.z);
    this.mark('bridgeC', c.x, c.y, c.z);
    // Cairn trail from the northern road to the watchtower.
    const m = new THREE.Matrix4();
    let n = 0;
    for (let x = -104; x <= 268; x += 31) {
      if (Math.abs(x - (B.a.x + B.c.x) / 2) < 24) continue;
      const z = B.a.z + 4.5 + Math.sin(x * 0.05) * 3;
      const y = ground(x, z);
      for (let k = 0; k < 3; k++) {
        const s = 0.9 - k * 0.22;
        m.compose(v3(x, y + 0.15 + k * 0.55, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 1.3 + x), v3(s, s * 0.7, s));
        D.instance('cairn', () => rockGeo(3).clone(), W('rock_snow'), m);
      }
      D.collider({ shape: 'cylinder', x, y: y + 0.8, z, r: 0.5, hy: 0.8, walkable: true, solid: true, surface: 'rock' });
      if (n++ % 2 === 0) lanternPost(D, x + 1.2, z + 0.8, 'blue', ground(x + 1.2, z + 0.8));
    }
    signpost(D, -109, B.a.z + 7, [
      { name: 'TUNDRA WATCHTOWER', toward: { x: 300, z: -1050 } },
      { name: 'NORTHERN WATER TRIBE', toward: { x: -220, z: -1600 } },
      { name: 'OMASHU', toward: { x: -450, z: -650 } },
    ]);
  }
}
