import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { MISTY } from './layout';
import { W, adobeHouse, barrel, boat, crate, drape, lanternPost, palm, rng, v3 } from './parts';
import { WildsSite } from './WildsSite';

/**
 * Misty Palms Oasis (plateau y = 25.6): a desert outpost around the oasis pool
 * (a natural water source, lake:misty_oasis) — palms, adobe houses, the
 * cantina with an awning and tables, a stone well (registered water source),
 * a jetty into the oasis (dock_misty_oasis), an outfitter stall and two
 * parked sand sailers.
 */
export class MistyPalmsSite extends WildsSite {
  readonly id = 'wilds_misty_palms';
  readonly center = { x: MISTY.C.x, z: MISTY.C.z };
  override readonly loadRadius = 320;

  protected construct(_ctx: GameContext): void {
    const Ms = MISTY;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const Y = Ms.Y;
    const r = rng(860);

    // --- Cantina ------------------------------------------------------------------------------
    {
      const c = Ms.cantina;
      adobeHouse(M, c.x, c.z, Math.PI, { w: c.w, d: c.d, h: 4.4, y: Y - 0.1, dome: true });
      // Awning over the front terrace (front faces north, -Z).
      const fz = c.z - c.d / 2;
      for (const dx of [-6.5, -2, 2.5, 7]) D.box('wood_dark', { x: c.x + dx, y: Y + 1.5, z: fz - 4.2, sx: 0.2, sy: 3, sz: 0.2 }, { collide: true, walkable: false });
      D.box('cloth_orange', { x: c.x + 0.25, y: Y + 3.1, z: fz - 2.1, sx: 15, sy: 0.06, sz: 4.6, pitch: -0.12 }, { castShadow: false });
      D.box('wood_dark', { x: c.x + 0.25, y: Y + 2.95, z: fz - 4.2, sx: 15, sy: 0.16, sz: 0.16 });
      // Counter with jars, tables and stools.
      D.block('wood', { x: c.x - 3, y: Y, z: fz - 2.2, sx: 4, sy: 1.05, sz: 0.8 }, { collide: true, surface: 'wood' });
      for (let k = 0; k < 5; k++) D.cylinder('plaster_tan', { x: c.x - 4.6 + k * 0.8, y: Y + 1.05, z: fz - 2.2, r: 0.18, rTop: 0.1, h: 0.4, segments: 8 });
      for (const [tx, tz] of [[c.x + 1.6, fz - 3.1], [c.x + 5.2, fz - 3.3], [c.x - 6.6, fz - 3.6]]) {
        D.cylinder('wood', { x: tx, y: Y, z: tz, r: 0.75, h: 0.8, segments: 12 }, { collide: true, walkable: true, surface: 'wood' });
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.4;
          D.cylinder('wood_dark', { x: tx + Math.cos(a) * 1.25, y: Y, z: tz + Math.sin(a) * 1.25, r: 0.25, h: 0.5, segments: 8 });
        }
      }
      D.box(W('banner_earth'), { x: c.x + 5.5, y: Y + 3.4, z: fz - 0.05, sx: 1.2, sy: 1.6, sz: 0.05 }, { castShadow: false });
      for (const dx of [-7, 7.5]) D.lantern(v3(c.x + dx, Y + 2.6, fz - 4.2), { color: 'warm', hanging: true });
      this.mark('cantina', c.x, Y, c.z);
    }

    // --- Adobe houses -------------------------------------------------------------------------
    const houses: Array<[number, number, number, number, number, boolean]> = [
      [150, 828, 0, 7, 6, false],
      [172, 825, 0, 6, 5, true],
      [210, 846, -Math.PI / 2, 6.5, 5.5, false],
      [212, 872, -Math.PI / 2, 7, 6, true],
      [207, 897, -Math.PI / 2, 6, 5, false],
      [172.5, 897, Math.PI, 6, 5.5, false],
      [133, 902, Math.PI * 0.85, 6, 5, true],
    ];
    for (const [x, z, yaw, w, d, dome] of houses) adobeHouse(M, x, z, yaw, { w, d, h: 3.2 + r() * 1.2, y: Y - 0.1, dome });
    this.mark('houses', houses.length, 0, 0);

    // --- Well (registered water source) ---------------------------------------------------------
    {
      const w = Ms.well;
      M.cylinder('stone_tan', { x: w.x, y: Y - 0.1, z: w.z, r: 1.35, h: 0.95, segments: 16 }, { collide: true });
      for (const s of [-1, 1]) D.box('wood_dark', { x: w.x + s * 1.2, y: Y + 1.5, z: w.z, sx: 0.16, sy: 2.4, sz: 0.16 });
      D.box('wood_dark', { x: w.x, y: Y + 2.6, z: w.z, sx: 2.6, sy: 0.14, sz: 0.14 });
      D.cylinder('wood', { x: w.x + 0.5, y: Y + 1.5, z: w.z, r: 0.22, h: 0.35, segments: 8 });
      this.waterSurface({ id: 'wilds:misty_well', label: 'Misty Palms Well', x: w.x, y: Y + 0.8, z: w.z, w: 2.2, d: 2.2, circle: true, type: 'fountain', capacity: 50, regen: 1.2 });
      this.mark('well', w.x, Y + 0.8, w.z);
    }

    // --- Oasis jetty, reeds, palms -----------------------------------------------------------------
    {
      const p = Ms.pier;
      M.bridge({ a: v3(p.x0, p.y, p.z), b: v3(p.x1, p.y, p.z), width: 2.6, deck: 'wood', rail: null, support: 'wood_dark', supportBottom: 22, surface: 'wood' });
      boat(D, p.x1 + 2, 24.85, p.z + 2.6, Math.PI, 4.6);
      lanternPost(D, p.x0 + 1, p.z - 1.6, 'warm', Y);
      this.mark('jetty', p.x1 + 1, p.y, p.z);
    }
    const O = Ms.oasis;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + r() * 0.2;
      const rr = O.r + 3 + r() * 5;
      const x = O.x + Math.cos(a) * rr, z = O.z + Math.sin(a) * rr;
      if (Math.abs(z - Ms.pier.z) < 3.5 && x > O.x) continue;
      if (Math.hypot(x - Ms.cantina.x, z - Ms.cantina.z) < 12) continue;
      palm(D, x, z, 7 + r() * 4, 100 + i);
    }
    for (const [x, z] of [[167, 836], [206, 830], [221, 860], [193, 913], [145, 846]]) palm(D, x, z, 6.5 + r() * 3, Math.round(x * 3 + z));
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const x = O.x + Math.cos(a) * (O.r - 0.5 + r() * 2.5), z = O.z + Math.sin(a) * (O.r - 0.5 + r() * 2.5);
      const m = new THREE.Matrix4().compose(v3(x, 24.7, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 3), v3(1, 0.8 + r() * 0.8, 1));
      Cl.instance('reed', () => {
        const g = new THREE.ConeGeometry(0.35, 1.6, 5);
        g.translate(0, 0.8, 0);
        return g;
      }, W('palm_leaf'), m, false);
    }

    // --- Outfitter stall (merchant_misty_2), sand sailers ---------------------------------------
    {
      const sx = 175.6, sz = 851;
      D.block('wood', { x: sx, y: Y, z: sz, sx: 0.9, sy: 1, sz: 3 }, { collide: true, surface: 'wood' });
      for (const dz of [-1.7, 1.7]) for (const dx of [-0.8, 2.6]) D.box('wood_dark', { x: sx + dx, y: Y + 1.3, z: sz + dz, sx: 0.12, sy: 2.6, sz: 0.12 });
      D.box('cloth_yellow', { x: sx + 0.9, y: Y + 2.65, z: sz, sx: 3.8, sy: 0.06, sz: 4 }, { castShadow: false });
      crate(D, sx + 3.6, sz + 2.2, 0.8, 0.3, Y);
      barrel(D, sx + 3.4, sz - 2.3, Y);
      for (const [bx, bz, yaw] of [[229, 852, -1.45], [231, 881, -1.7]]) {
        boat(D, bx, Y + 0.55, bz, yaw, 7.5, { mast: true, sail: 'cloth_white', collide: true });
        // Sand skis under the hull.
        for (const s of [-1, 1]) D.box('wood_dark', { x: bx + Math.sin(yaw) * s * 0.9, y: Y + 0.15, z: bz + Math.cos(yaw) * s * 0.9, sx: 7.8, sy: 0.12, sz: 0.25, yaw });
      }
      this.mark('sailers', 229, Y, 852);
    }

    // --- Clutter: pots, rugs, crates, sand path to the road ------------------------------------------
    drape(D, W('sand'), 176, 862, 30, 6, { lift: 0.03, tile: 6 });
    for (let i = 0; i < 18; i++) {
      const x = 140 + r() * 80, z = 820 + r() * 90;
      if (Math.hypot(x - O.x, z - O.z) < O.r + 3 || Math.hypot(x - Ms.C.x, z - Ms.C.z) < 7) continue;
      if (Math.abs(x - (200 - ((z - 820) * 50) / 230)) < 7) continue; // southern road
      Cl.cylinder('plaster_tan', { x, y: Y, z, r: 0.3 + r() * 0.2, rTop: 0.2, h: 0.7 + r() * 0.4, segments: 8 });
    }
  }
}
