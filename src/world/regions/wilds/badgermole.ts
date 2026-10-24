import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { BADGER } from './layout';
import { W, ground, rng, rock, v3 } from './parts';
import { WildsSite } from './WildsSite';

/**
 * Badgermole Caves: a rocky outcrop at the foot of the cliff west of the
 * landmark with a large cave mouth facing the valley and a short walk-in cave
 * (floor = natural ground, walls and roof solid) glowing with crystals and
 * mushrooms (habitat_badgermole_1). Carved steps climb to a burrow ledge at
 * the landmark itself (habitat_badgermole_2).
 */
export class BadgermoleCavesSite extends WildsSite {
  readonly id = 'wilds_badgermole_caves';
  readonly center = { x: BADGER.L.x - 20, z: BADGER.L.z - 6 };
  override readonly loadRadius = 280;

  protected construct(_ctx: GameContext): void {
    const Bm = BADGER;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const r = rng(560);
    const x0 = Bm.mouth.x, x1 = Bm.back.x, zc = Bm.mouth.z, hw = Bm.halfW;
    const ROCK = W('rock');
    const maxAlong = (xa: number, xb: number, z0: number, z1: number) => {
      let m = -Infinity;
      for (let x = xa; x <= xb; x += 2) for (let z = z0; z <= z1; z += 2) m = Math.max(m, ground(x, z));
      return m;
    };
    const minAlong = (xa: number, xb: number, z0: number, z1: number) => {
      let m = Infinity;
      for (let x = xa; x <= xb; x += 2) for (let z = z0; z <= z1; z += 2) m = Math.min(m, ground(x, z));
      return m;
    };

    // --- Walls and roof (box colliders + boulder visuals) ------------------------------------
    const pieces = 3;
    const pl = (x1 + 2 - (x0 - 2)) / pieces;
    for (let k = 0; k < pieces; k++) {
      const xa = x0 - 2 + k * pl, xb = xa + pl;
      const floorMax = maxAlong(xa, xb, zc - hw, zc + hw);
      const roofY = floorMax + 7.2;
      for (const side of [-1, 1]) {
        const z = zc + side * (hw + 1.1);
        const base = minAlong(xa, xb, z - 1, z + 1) - 1;
        M.collider({ shape: 'box', x: (xa + xb) / 2, y: (base + roofY) / 2, z, hx: pl / 2 + 0.2, hy: (roofY - base) / 2, hz: 1.1, walkable: false, solid: true, surface: 'rock' });
        for (let j = 0; j < 2; j++) {
          const s = 5 + r() * 2.5;
          rock(M, ROCK, xa + pl * (0.25 + j * 0.5), z + side * 1.9, s * 1.1, roofY - base + 1.5, s * 0.75, { y: base, yaw: (r() - 0.5) * 0.5, variant: k * 2 + j, collide: false });
        }
      }
      M.collider({ shape: 'box', x: (xa + xb) / 2, y: roofY + 1, z: zc, hx: pl / 2 + 0.2, hy: 1, hz: hw + 2.2, walkable: true, solid: true, surface: 'rock' });
      for (let j = 0; j < 2; j++) {
        rock(M, ROCK, xa + pl * (0.25 + j * 0.5), zc + (r() - 0.5) * 3, pl * 0.75, 3.4, hw * 2 + 5, { y: roofY - 0.4, yaw: (r() - 0.5) * 0.4, variant: 3 + j + k, collide: false });
      }
      this.mark(`roof_${k}`, (xa + xb) / 2, roofY, zc);
    }
    {
      const base = minAlong(x1, x1 + 2, zc - hw, zc + hw) - 1;
      const roofY = maxAlong(x1 - 6, x1, zc - hw, zc + hw) + 7.2;
      M.collider({ shape: 'box', x: x1 + 1.6, y: (base + roofY) / 2, z: zc, hx: 1.2, hy: (roofY - base) / 2, hz: hw + 2, walkable: false, solid: true, surface: 'rock' });
      rock(M, ROCK, x1 + 3, zc, 6, roofY - base + 3, hw * 2 + 6, { y: base, variant: 1, collide: false });
      // Burrow hole at the back.
      const by = ground(x1 - 0.3, zc);
      D.box(W('dark'), { x: x1 + 0.35, y: by + 1.2, z: zc + 1.5, sx: 0.05, sy: 2.4, sz: 3, yaw: 0 }, { castShadow: false });
      rock(D, W('sand'), x1 - 1.6, zc - 2.6, 2.4, 0.9, 2, { collide: false, variant: 2 });
    }
    // Mouth frame: two tall rocks and a lintel boulder.
    {
      const gy = ground(x0, zc);
      for (const side of [-1, 1]) rock(M, ROCK, x0 - 1.5, zc + side * (hw + 0.6), 4, 9.5, 3.5, { y: gy - 1, variant: side > 0 ? 4 : 5 });
      rock(M, ROCK, x0 - 1.2, zc, 4, 3, hw * 2 + 6, { y: maxAlong(x0 - 2, x0 + 4, zc - hw, zc + hw) + 6.6, variant: 0, collide: false });
      this.mark('mouth', x0 - 3, gy, zc);
    }
    // Boulders blending the outcrop into the hillside.
    for (let i = 0; i < 10; i++) {
      const x = x0 + r() * (x1 - x0 + 10), z = zc + (r() < 0.5 ? -1 : 1) * (hw + 4 + r() * 5);
      const s = 3 + r() * 4;
      rock(Cl, ROCK, x, z, s, s * 0.8, s, { yaw: r() * 6, variant: i, collide: false });
    }

    // --- Glowing crystals and mushrooms ----------------------------------------------------------
    const crystal = W('crystal');
    for (let i = 0; i < 9; i++) {
      const along = x0 + 4 + (i / 8) * (x1 - x0 - 6);
      const side = i % 2 === 0 ? -1 : 1;
      const z = zc + side * (hw - 0.6);
      const y = ground(along, z);
      for (let k = 0; k < 4; k++) {
        const h = 0.8 + r() * 1.6;
        const g = new THREE.OctahedronGeometry(0.35, 0);
        D.mesh(crystal, g, { x: along + (r() - 0.5) * 1.2, y: y + h * 0.4 + r() * 1.5, z: z - side * r() * 0.5, sx: 0.8, sy: h * 1.6, sz: 0.8, pitch: side * (0.3 + r() * 0.4), roll: (r() - 0.5) * 0.6 });
        g.dispose();
      }
    }
    for (let i = 0; i < 4; i++) {
      const along = x0 + 6 + i * 6;
      const g = new THREE.OctahedronGeometry(0.3, 0);
      D.mesh(crystal, g, { x: along, y: maxAlong(along - 2, along + 2, zc - 2, zc + 2) + 6.6, z: zc + (r() - 0.5) * 6, sx: 1, sy: 2.6, sz: 1, pitch: Math.PI });
      g.dispose();
    }
    const mm = new THREE.Matrix4();
    for (let i = 0; i < 34; i++) {
      const x = x0 + 2 + r() * (x1 - x0 - 3), side = r() < 0.5 ? -1 : 1;
      const z = zc + side * (hw - 0.4 - r() * 1.4);
      const s = 0.6 + r() * 0.8;
      mm.compose(v3(x, ground(x, z), z), new THREE.Quaternion(), v3(s, s, s));
      D.instance('mushroom_cap', () => {
        const g = new THREE.SphereGeometry(0.28, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
        g.translate(0, 0.32, 0);
        return g;
      }, W('mushroom'), mm, false);
      Cl.instance('mushroom_stem', () => {
        const g = new THREE.CylinderGeometry(0.06, 0.08, 0.34, 6);
        g.translate(0, 0.17, 0);
        return g;
      }, 'plaster_white', mm, false);
    }
    this.mark('interior', (x0 + x1) / 2, ground((x0 + x1) / 2, zc), zc);

    // --- Burrow ledge at the landmark, reached by carved steps ---------------------------------------
    {
      const l = Bm.ledge;
      M.cylinder('stone_dark', { x: l.x, y: l.top - 10, z: l.z, r: l.r, rTop: l.r - 0.2, h: 10, segments: 16 }, { collide: true, surface: 'rock' });
      rock(M, ROCK, l.x - 1.5, l.z, l.r * 2.3, 9, l.r * 2.1, { y: l.top - 9.6, variant: 2, collide: false });
      const foot = Bm.stepsFoot, top = Bm.stepsTop;
      M.stairs({ from: v3(foot.x, ground(foot.x, foot.z) - 0.05, foot.z), to: v3(top.x, l.top, top.z), width: 2.6, material: 'stone_dark', stepHeight: 0.32 });
      D.cylinder(W('dark'), { x: l.x + 2.4, y: l.top - 0.02, z: l.z - 1.5, r: 1.5, h: 0.05, segments: 14 });
      rock(D, W('sand'), l.x + 3.6, l.z - 3.2, 2.2, 0.8, 1.8, { y: l.top - 0.2, collide: false, variant: 1 });
      this.mark('ledge', l.x, l.top, l.z);
      this.mark('stepsFoot', foot.x, ground(foot.x, foot.z), foot.z);
    }
  }
}
