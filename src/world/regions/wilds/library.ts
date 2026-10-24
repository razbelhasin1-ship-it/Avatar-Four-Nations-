import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { LIBRARY } from './layout';
import { W, rng, rock, v3, yawFacing } from './parts';
import { wildsMaterial } from './materials';
import { WildsSite } from './WildsSite';

/**
 * The Buried Library (Wan Shi Tong's library): only the top of a great
 * sandstone spire rises from a hollow between the dunes, east of the dune
 * crest landmark. A doorway facing the crest leads into a walkable chamber
 * (shrine_buried_library) lined with shelves and scrolls, an owl relief on
 * the back wall and a stairwell sinking into darkness. The reveal: when the
 * player first comes within ~45 m, dust bursts from the base, light shafts
 * fade in through the windows and the owl's eyes kindle.
 */
export class BuriedLibrarySite extends WildsSite {
  readonly id = 'wilds_buried_library';
  readonly center = { x: LIBRARY.S.x, z: LIBRARY.S.z };
  override readonly loadRadius = 300;
  private reveal = -1;
  revealed = false;

  protected construct(_ctx: GameContext): void {
    const L = LIBRARY;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const S = L.S, FY = L.floorY;
    const r = rng(1120);
    const td = L.doorTheta;
    const stone = 'stone_tan';
    const segYaw = (a: number) => yawFacing(Math.cos(a), Math.sin(a));
    const at = (a: number, rr: number) => ({ x: S.x + Math.cos(a) * rr, z: S.z + Math.sin(a) * rr });
    // 8-sided cylinders rotated so their faces line up with the octagonal walls (face centres at td + k·45°).
    const octYaw = Math.PI / 8 - td;
    const oct = (b: ContentBuilder, mat: Parameters<ContentBuilder['mesh']>[0], y0: number, rTop: number, rBot: number, h: number) => {
      const g = new THREE.CylinderGeometry(rTop / Math.cos(Math.PI / 8), rBot / Math.cos(Math.PI / 8), h, 8);
      b.mesh(mat, g, { x: S.x, y: y0 + h / 2, z: S.z, yaw: octYaw });
      g.dispose();
    };

    // --- Buried plinth and chamber floor ----------------------------------------------------
    oct(M, stone, FY - 6.6, L.rOut + 0.9, L.rOut + 1.8, 6);
    M.cylinder('paving', { x: S.x, y: FY - 2.6, z: S.z, r: L.rIn + 0.4, h: 2.6, segments: 24 }, { collide: true, surface: 'stone' });
    this.mark('floor', S.x, FY, S.z);

    // --- Octagonal chamber walls (door segment faces the dune crest) -------------------------
    const rm = (L.rIn + L.rOut) / 2;
    const chord = 2 * rm * Math.tan(Math.PI / 8) + 0.5;
    const thick = L.rOut - L.rIn;
    const H = L.wallH;
    for (let i = 0; i < 8; i++) {
      const a = td + (i * Math.PI) / 4;
      const p = at(a, rm);
      const yaw = segYaw(a);
      if (i === 0) {
        const dw = 2.8, dh = 4.2;
        const side = (chord - dw) / 2;
        for (const s of [-1, 1]) {
          const off = dw / 2 + side / 2;
          M.box(stone, { x: p.x + Math.cos(yaw) * s * off, y: FY - 1 + (H + 1) / 2, z: p.z - Math.sin(yaw) * s * off, sx: side, sy: H + 1, sz: thick, yaw }, { collide: true });
        }
        M.box(stone, { x: p.x, y: FY + dh + (H - dh) / 2, z: p.z, sx: dw + 0.1, sy: H - dh, sz: thick, yaw }, { collide: true });
        // Door frame, steps of sand-worn stone and owl relief above the door.
        const o = at(a, L.rOut + 0.15);
        M.box('stone_light', { x: o.x, y: FY + dh + 0.35, z: o.z, sx: dw + 1.4, sy: 0.7, sz: 0.5, yaw });
        for (const s of [-1, 1]) M.box('stone_light', { x: o.x + Math.cos(yaw) * s * (dw / 2 + 0.35), y: FY + dh / 2, z: o.z - Math.sin(yaw) * s * (dw / 2 + 0.35), sx: 0.7, sy: dh, sz: 0.5, yaw });
        const foot = at(a, L.rOut + 3.6), top = at(a, L.rOut - 0.2);
        const gy = this.ctx.world.heightAt(foot.x, foot.z);
        if (gy < FY - 0.3) M.stairs({ from: v3(foot.x, gy - 0.05, foot.z), to: v3(top.x, FY, top.z), width: 3, material: 'stone_light' });
        this.mark('doorFoot', foot.x, Math.max(gy, FY - 0.3), foot.z);
        this.owl(M, at(a, L.rOut + 0.3), yaw, FY + dh + 2.6, 1.3, false);
        this.mark('door', o.x, FY, o.z);
      } else {
        M.box(stone, { x: p.x, y: FY - 1 + (H + 1) / 2, z: p.z, sx: chord, sy: H + 1, sz: thick, yaw }, { collide: true });
      }
      // Buttress and pinnacle at each outer corner.
      const ca = a + Math.PI / 8;
      const cp = at(ca, L.rOut + 0.2);
      M.box('stone_light', { x: cp.x, y: FY + H / 2 - 1, z: cp.z, sx: 1.3, sy: H + 2, sz: 1.3, yaw: segYaw(ca) });
      if (i % 2 === 1) {
        M.cylinder('stone_light', { x: cp.x, y: FY + H + 1, z: cp.z, r: 0.9, rTop: 0.05, h: 5, segments: 6 });
      }
    }
    // Ceiling slab and cornice.
    oct(M, stone, FY + H, L.rOut + 0.4, L.rOut + 0.4, 1);
    oct(M, 'stone_light', FY + H + 0.6, L.rOut + 1, L.rOut + 1, 0.6);

    // --- Upper tiers: drum with windows, balcony, second drum, dome and finial -----------------------
    let y = FY + H + 1.2;
    const tiers = [
      { r: 6.8, h: 10 },
      { r: 4.9, h: 8 },
    ];
    for (const t of tiers) {
      oct(M, stone, y, t.r, t.r, t.h);
      oct(M, 'stone_light', y - 0.2, t.r + 1.1, t.r + 1.1, 0.45);
      for (let k = 0; k < 8; k++) {
        const a = td + (k * Math.PI) / 4;
        const w = at(a, t.r + 0.03);
        M.box(W('dark'), { x: w.x, y: y + t.h * 0.55, z: w.z, sx: t.r * 0.32, sy: t.h * 0.5, sz: 0.08, yaw: segYaw(a) }, { castShadow: false });
        M.box('stone_light', { x: w.x, y: y + t.h * 0.82, z: w.z, sx: t.r * 0.45, sy: 0.35, sz: 0.3, yaw: segYaw(a) });
      }
      y += t.h;
    }
    oct(M, 'stone_light', y - 0.1, 5.6, 5.6, 0.6);
    const dome = new THREE.SphereGeometry(5 / Math.cos(Math.PI / 8), 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    M.mesh('roof_gold', dome, { x: S.x, y: y + 0.4, z: S.z, sy: 1.5, yaw: octYaw });
    dome.dispose();
    M.cylinder('stone_light', { x: S.x, y: y + 7.6, z: S.z, r: 0.6, rTop: 0.25, h: 3, segments: 8 });
    M.cylinder('gold', { x: S.x, y: y + 10.5, z: S.z, r: 0.25, rTop: 0.02, h: 5, segments: 6 });
    this.mark('top', S.x, y + 15, S.z);

    // --- Owl statues flanking the doorway ------------------------------------------------------------
    for (const s of [-1, 1]) {
      const a = td + s * 0.42;
      const p = at(a, L.rOut + 2.2);
      const gy = Math.min(FY, this.ctx.world.heightAt(p.x, p.z));
      M.block('stone_light', { x: p.x, y: gy - 0.5, z: p.z, sx: 1.6, sy: 1.6, sz: 1.6, yaw: segYaw(td) }, { collide: true });
      this.owl(M, p, segYaw(td), gy + 1.1, 1, true);
    }

    // --- Interior: shelves, scrolls, reading table, stairwell, owl relief --------------------------------
    const scrollM = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      const a = td + (i * Math.PI) / 4;
      const p = at(a, L.rIn - 0.55);
      const yaw = segYaw(a + Math.PI); // front faces the centre
      D.box('wood_dark', { x: p.x, y: FY + 3.2, z: p.z, sx: 4.6, sy: 6.4, sz: 1, yaw }, { collide: true, walkable: false, surface: 'wood' });
      for (let k = 0; k < 5; k++) {
        const sy = FY + 0.5 + k * 1.3;
        D.box('wood', { x: p.x + Math.sin(yaw) * 0.45, y: sy, z: p.z + Math.cos(yaw) * 0.45, sx: 4.5, sy: 0.08, sz: 0.25, yaw });
        for (let n = 0; n < 9; n++) {
          if (r() < 0.2) continue;
          const lx = -2 + n * 0.5;
          q.setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ'));
          scrollM.compose(v3(p.x + Math.cos(yaw) * lx + Math.sin(yaw) * 0.35, sy + 0.17, p.z - Math.sin(yaw) * lx + Math.cos(yaw) * 0.35), q, v3(1, 1, 1));
          D.instance('scroll', () => new THREE.CylinderGeometry(0.12, 0.12, 0.62, 8), r() < 0.5 ? 'cloth_yellow' : 'cloth_white', scrollM, false);
        }
      }
    }
    // Back wall owl relief with glowing eyes.
    {
      const a = td + Math.PI;
      const p = at(a, L.rIn - 0.05);
      this.owl(M, p, segYaw(a + Math.PI), FY + 7.4, 2.4, false);
      D.block('stone_light', { x: at(a, L.rIn - 1.4).x, y: FY, z: at(a, L.rIn - 1.4).z, sx: 3.2, sy: 1.1, sz: 1.2, yaw: segYaw(a) }, { collide: true });
      for (let k = 0; k < 3; k++) {
        const cp = at(a + (k - 1) * 0.18, L.rIn - 1.4);
        D.cylinder('lantern_warm', { x: cp.x, y: FY + 1.1, z: cp.z, r: 0.09, h: 0.3, segments: 6 });
      }
    }
    // Reading table with open scrolls.
    {
      const p = at(td + 1.1, 4.2);
      D.cylinder('wood_dark', { x: p.x, y: FY, z: p.z, r: 1.1, h: 0.85, segments: 14 }, { collide: true, surface: 'wood' });
      D.box('cloth_white', { x: p.x, y: FY + 0.87, z: p.z, sx: 1.2, sy: 0.02, sz: 0.7, yaw: td }, { castShadow: false });
    }
    // Stairwell descending into darkness, ringed by a railing.
    {
      const p = at(td + Math.PI, 3.7);
      D.cylinder(W('dark'), { x: p.x, y: FY - 0.02, z: p.z, r: 1.9, h: 0.06, segments: 20 });
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        D.box('wood_dark', { x: p.x + Math.cos(a) * 2.1, y: FY + 0.5, z: p.z + Math.sin(a) * 2.1, sx: 0.1, sy: 1, sz: 0.1 });
      }
      D.cylinder('wood', { x: p.x, y: FY + 0.95, z: p.z, r: 2.15, h: 0.08, segments: 20 });
      D.collider({ shape: 'cylinder', x: p.x, y: FY + 0.5, z: p.z, r: 2.1, hy: 0.6, walkable: false, solid: true });
      this.mark('stairwell', p.x, FY, p.z);
    }
    // Scroll piles on the floor.
    for (let i = 0; i < 26; i++) {
      const a = td + 0.6 + r() * (Math.PI * 2 - 1.2);
      const rr = 3.5 + r() * 2.6;
      q.setFromEuler(new THREE.Euler(0, r() * 6, Math.PI / 2, 'YXZ'));
      scrollM.compose(v3(S.x + Math.cos(a) * rr, FY + 0.12, S.z + Math.sin(a) * rr), q, v3(1, 1, 1));
      Cl.instance('scroll_floor', () => new THREE.CylinderGeometry(0.12, 0.12, 0.62, 8), 'cloth_yellow', scrollM, false);
    }

    // --- Light shafts through the windows (fade in on reveal) ---------------------------------------
    const shaftMat = wildsMaterial('shaft');
    for (let k = 0; k < 3; k++) {
      const a = td + Math.PI * (0.55 + k * 0.45);
      const top = at(a, L.rIn - 0.4), bot = at(a + Math.PI * 0.85, 2.5);
      const g = new THREE.CylinderGeometry(0.5, 1.6, 1, 10, 1, true);
      const from = v3(top.x, FY + H - 1.5, top.z), to = v3(bot.x, FY, bot.z);
      const len = from.distanceTo(to);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const mesh = new THREE.Mesh(g, shaftMat);
      mesh.position.copy(mid);
      mesh.scale.set(1, len, 1);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      mesh.renderOrder = 3;
      this.detailGroup.add(mesh);
      this.owned.push(g);
    }
    // A window slit high in the wall above each shaft.
    for (let k = 0; k < 3; k++) {
      const a = td + Math.PI * (0.55 + k * 0.45);
      const w = at(a, L.rOut + 0.02);
      M.box('lantern_warm', { x: w.x, y: FY + H - 1.5, z: w.z, sx: 0.5, sy: 1.6, sz: 0.06, yaw: segYaw(a) }, { castShadow: false });
    }

    // --- Dune rocks half buried around the spire ------------------------------------------------------------
    for (let i = 0; i < 9; i++) {
      const a = td + 0.8 + (i / 9) * (Math.PI * 2 - 1.6);
      const rr = L.rOut + 4 + r() * 8;
      const x = S.x + Math.cos(a) * rr, z = S.z + Math.sin(a) * rr;
      rock(D, 'stone_tan', x, z, 1.6 + r() * 2, 1 + r() * 1.4, 1.5 + r() * 2, { yaw: r() * 6, variant: i });
    }
  }

  /** Stylised owl (Wan Shi Tong) facing local +Z: eyes, beak, brows, wings. */
  private owl(b: ContentBuilder, p: { x: number; z: number }, yaw: number, y: number, s: number, statue: boolean): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), cx = Math.cos(yaw), cz = -Math.sin(yaw);
    const eye = wildsMaterial('owl_glow');
    if (statue) {
      b.mesh('stone_light', new THREE.SphereGeometry(0.75 * s, 10, 8), { x: p.x, y: y + 0.6 * s, z: p.z, sy: 1.35 });
      b.mesh('stone_light', new THREE.SphereGeometry(0.6 * s, 10, 8), { x: p.x, y: y + 1.75 * s, z: p.z });
      for (const sd of [-1, 1]) b.cylinder('stone_light', { x: p.x + cx * sd * 0.38 * s, y: y + 2.15 * s, z: p.z + cz * sd * 0.38 * s, r: 0.16 * s, rTop: 0.01, h: 0.5 * s, segments: 5 });
    } else {
      // Relief: wings and head plate.
      for (const sd of [-1, 1]) b.box('stone_light', { x: p.x + cx * sd * 1.25 * s + fx * 0.1, y: y - 0.9 * s, z: p.z + cz * sd * 1.25 * s + fz * 0.1, sx: 1.3 * s, sy: 2.6 * s, sz: 0.25, yaw, roll: sd * 0.35 });
      b.box('stone_light', { x: p.x + fx * 0.15, y: y + 0.1 * s, z: p.z + fz * 0.15, sx: 2.2 * s, sy: 1.5 * s, sz: 0.3, yaw });
    }
    const ez = statue ? 0.5 * s : 0.35;
    const ey = statue ? y + 1.8 * s : y + 0.2 * s;
    for (const sd of [-1, 1]) {
      const g = new THREE.CircleGeometry(statue ? 0.2 * s : 0.42 * s, 16);
      b.mesh(eye, g, { x: p.x + cx * sd * (statue ? 0.24 : 0.55) * s + fx * ez, y: ey, z: p.z + cz * sd * (statue ? 0.24 : 0.55) * s + fz * ez, yaw });
      g.dispose();
    }
    const beak = new THREE.ConeGeometry(0.12 * s * (statue ? 1 : 1.6), 0.35 * s, 4);
    beak.rotateX(Math.PI);
    b.mesh('gold', beak, { x: p.x + fx * (ez + 0.05), y: ey - 0.3 * s, z: p.z + fz * (ez + 0.05) });
    beak.dispose();
  }

  protected override tick(dt: number, ctx: GameContext): void {
    const p = ctx.player?.position;
    if (!p) return;
    const S = LIBRARY.S;
    if (this.reveal < 0 && Math.hypot(p.x - S.x, p.z - S.z) < 45) {
      this.reveal = 0;
      this.revealed = true;
      ctx.vfx.burst('dust', v3(S.x, LIBRARY.floorY + 1, S.z), { count: 60, radius: 9, speed: 3, size: 1.6 });
      ctx.vfx.burst('dust', v3(S.x, LIBRARY.floorY + 14, S.z), { count: 24, radius: 6, speed: 1.5, size: 1.2 });
    }
    if (this.reveal >= 0 && this.reveal < 1) {
      this.reveal = Math.min(1, this.reveal + dt / 4);
      const t = this.reveal * this.reveal * (3 - 2 * this.reveal);
      (wildsMaterial('shaft') as THREE.MeshBasicMaterial).opacity = 0.2 * t;
      (wildsMaterial('owl_glow') as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + 2.6 * t;
    }
  }

  override onSessionStart(ctx: GameContext): void {
    super.onSessionStart(ctx);
    this.reveal = -1;
    (wildsMaterial('shaft') as THREE.MeshBasicMaterial).opacity = 0;
    (wildsMaterial('owl_glow') as THREE.MeshStandardMaterial).emissiveIntensity = 0.15;
  }
}
